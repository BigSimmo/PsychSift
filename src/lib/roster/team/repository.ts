import "server-only";
import { randomUUID } from "node:crypto";

import type { createAdminClient } from "@/lib/supabase/admin";
import { PublicApiError } from "@/lib/http";
import { rosterApiError, rosterError, rosterUnavailable } from "@/lib/roster/team/errors";
import {
  ROSTER_READ_SCHEMAS,
  rosterCommandResultSchema,
  rosterRulesSchema,
  rosterTeamsSchema,
  type RosterAction,
  type RosterAssignment,
  type RosterCommandResult,
  type RosterReadResult,
  type RosterReadWhat,
  type RosterRules,
  type RosterTeam,
} from "@/lib/roster/team/model";
import { swapRuleFlags } from "@/lib/roster/team/rule-flags";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Every team read and write goes through `roster_read` and `roster_command`,
 * which check membership, confirmation and role in SQL on every call. The
 * actor is always the session user the route passes in, never anything the
 * request carried. Answers are parsed with their schema and fail closed: a
 * shape the app doesn't recognise is 503, never a half-parsed object.
 */

function requireActor(actorId: string) {
  if (!actorId) throw new PublicApiError("Sign in to open Roster.", 401, { code: "roster_auth_required" });
}

export function ruleLookbackDays(rules: RosterRules): number {
  const { minBreakHours, maxNightsInRow, maxDaysInRow, maxHours7d, maxHours14d } = rules;
  return Math.max(
    0,
    minBreakHours === undefined ? 0 : Math.ceil(minBreakHours / 24) + 2,
    maxNightsInRow === undefined ? 0 : maxNightsInRow + 1,
    maxDaysInRow === undefined ? 0 : maxDaysInRow + 1,
    maxHours7d === undefined ? 0 : 8,
    maxHours14d === undefined ? 0 : 15,
  );
}

function chainCall(target: unknown, method: string, ...args: unknown[]): unknown {
  if (target && typeof (target as Record<string, unknown>)[method] === "function") {
    const next = (target as Record<string, (...a: unknown[]) => unknown>)[method]!(...args);
    return next !== undefined ? next : target;
  }
  return target;
}

async function resolveSingle(
  target: unknown,
): Promise<{ data: Record<string, unknown> | null; error: { message?: string | null; code?: string | null } | null }> {
  if (!target) return { data: null, error: null };
  const record = target as Record<string, unknown>;
  const terminal =
    typeof record.maybeSingle === "function"
      ? (record.maybeSingle as () => unknown)()
      : typeof record.single === "function"
        ? (record.single as () => unknown)()
        : target;
  const resolved = (await terminal) as {
    data?: unknown;
    error?: { message?: string | null; code?: string | null } | null;
  } | null;
  if (!resolved || typeof resolved !== "object") return { data: null, error: null };
  const raw = Array.isArray(resolved.data) ? (resolved.data[0] ?? null) : (resolved.data ?? null);
  return {
    data: raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null,
    error: resolved.error ?? null,
  };
}

async function resolveList(
  target: unknown,
): Promise<{ data: Record<string, unknown>[]; error: { message?: string | null; code?: string | null } | null }> {
  if (!target) return { data: [], error: null };
  const resolved = (await target) as {
    data?: unknown;
    error?: { message?: string | null; code?: string | null } | null;
  } | null;
  if (!resolved || typeof resolved !== "object") return { data: [], error: null };
  return {
    data: Array.isArray(resolved.data)
      ? resolved.data.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
      : [],
    error: resolved.error ?? null,
  };
}

function toRosterAssignment(raw: Record<string, unknown> | null | undefined): RosterAssignment | null {
  if (!raw || typeof raw !== "object") return null;
  const id = typeof raw.id === "string" ? raw.id : null;
  const startsAt =
    typeof raw.startsAt === "string" ? raw.startsAt : typeof raw.starts_at === "string" ? raw.starts_at : null;
  const endsAt = typeof raw.endsAt === "string" ? raw.endsAt : typeof raw.ends_at === "string" ? raw.ends_at : null;
  if (!id || !startsAt || !endsAt) return null;
  return {
    id,
    userId: typeof raw.userId === "string" ? raw.userId : typeof raw.user_id === "string" ? raw.user_id : null,
    name: typeof raw.name === "string" ? raw.name : typeof raw.roster_name === "string" ? raw.roster_name : null,
    grade: typeof raw.grade === "string" ? (raw.grade as RosterAssignment["grade"]) : null,
    siteId: typeof raw.siteId === "string" ? raw.siteId : typeof raw.site_id === "string" ? raw.site_id : null,
    siteName: typeof raw.siteName === "string" ? raw.siteName : null,
    startsAt,
    endsAt,
    shiftCode:
      typeof raw.shiftCode === "string" ? raw.shiftCode : typeof raw.shift_code === "string" ? raw.shift_code : "D",
    kind: typeof raw.kind === "string" ? (raw.kind as RosterAssignment["kind"]) : "day",
  };
}

function parseRules(raw: unknown): RosterRules {
  if (!raw || typeof raw !== "object") return {};
  const filtered = Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter(([key]) => key in rosterRulesSchema.shape),
  );
  const parsed = rosterRulesSchema.safeParse(filtered);
  return parsed.success ? parsed.data : {};
}

async function verifySwapApproveRules(
  client: AdminClient,
  actorId: string,
  serviceId: string,
  swapId: string,
): Promise<void> {
  if (typeof client.from !== "function") return;
  const fromFn = client.from.bind(client) as (table: string) => unknown;

  let swapQuery = fromFn("roster_swaps");
  swapQuery = chainCall(swapQuery, "select", "*");
  swapQuery = chainCall(swapQuery, "eq", "service_id", serviceId);
  swapQuery = chainCall(swapQuery, "eq", "id", swapId);
  const swapRes = await resolveSingle(swapQuery);
  if (swapRes?.error) throw rosterApiError(swapRes.error);
  const swapRow = swapRes.data;
  if (!swapRow) return;
  if (swapRow.status !== undefined && swapRow.status !== "accepted") return;

  const expiresAt =
    typeof swapRow.expires_at === "string"
      ? swapRow.expires_at
      : typeof swapRow.expiresAt === "string"
        ? swapRow.expiresAt
        : null;
  if (expiresAt && Date.parse(expiresAt) <= Date.now()) return;

  const requesterId =
    typeof swapRow.requesterId === "string"
      ? swapRow.requesterId
      : typeof swapRow.requester_id === "string"
        ? swapRow.requester_id
        : null;
  const counterpartyId =
    typeof swapRow.counterpartyId === "string"
      ? swapRow.counterpartyId
      : typeof swapRow.counterparty_id === "string"
        ? swapRow.counterparty_id
        : null;
  if (!requesterId || !counterpartyId) return;
  if (actorId === requesterId || actorId === counterpartyId) return;

  let roleQuery: unknown;
  try {
    roleQuery = fromFn("roster_member_roles");
  } catch {
    roleQuery = null;
  }
  if (roleQuery) {
    roleQuery = chainCall(roleQuery, "select", "*");
    roleQuery = chainCall(roleQuery, "eq", "service_id", serviceId);
    roleQuery = chainCall(roleQuery, "eq", "user_id", actorId);
    roleQuery = chainCall(roleQuery, "eq", "role", "manager");
    roleQuery = chainCall(roleQuery, "is", "revoked_at", null);
    const roleRes = await resolveSingle(roleQuery);
    if (roleRes?.error) throw rosterApiError(roleRes.error);
    if (
      !roleRes.data ||
      roleRes.data.revoked_at != null ||
      roleRes.data.revokedAt != null ||
      ("confirmed_at" in roleRes.data && roleRes.data.confirmed_at == null) ||
      ("confirmedAt" in roleRes.data && roleRes.data.confirmedAt == null)
    ) {
      return;
    }
  }

  if (await swapBreaksTeamRules(fromFn, serviceId, swapRow, requesterId, counterpartyId)) {
    throw rosterError("roster_swap_rule_warning");
  }
}

/**
 * Whether the roster as this swap would leave it breaks one of the team's own
 * rules (`swapRuleFlags`: minimum break, hours in 7 or 14 days, nights or days
 * in a row). Shared by the manager's approval and the other doctor's accept.
 */
async function swapBreaksTeamRules(
  fromFn: (table: string) => unknown,
  serviceId: string,
  swapRow: Record<string, unknown>,
  requesterId: string,
  counterpartyId: string,
): Promise<boolean> {
  let settingsQuery = fromFn("roster_team_settings");
  settingsQuery = chainCall(settingsQuery, "select", "rules");
  settingsQuery = chainCall(settingsQuery, "eq", "service_id", serviceId);
  const settingsRes = await resolveSingle(settingsQuery);
  if (settingsRes?.error) throw rosterApiError(settingsRes.error);
  const settingsRow = settingsRes.data;

  const rules = parseRules(settingsRow?.rules);
  const lookbackDays = ruleLookbackDays(rules);
  if (lookbackDays === 0) return false;

  const rawGive =
    swapRow.give && typeof swapRow.give === "object" ? (swapRow.give as Record<string, unknown>) : undefined;
  const rawTake =
    swapRow.take && typeof swapRow.take === "object" ? (swapRow.take as Record<string, unknown>) : undefined;
  if (
    (rawGive && (rawGive.superseded_at != null || rawGive.supersededAt != null)) ||
    (rawTake && (rawTake.superseded_at != null || rawTake.supersededAt != null))
  ) {
    return false;
  }

  const inlineGive = toRosterAssignment(rawGive);
  const inlineTake = toRosterAssignment(rawTake);
  const giveId =
    inlineGive?.id ??
    (typeof swapRow.giveAssignmentId === "string"
      ? swapRow.giveAssignmentId
      : typeof swapRow.give_assignment_id === "string"
        ? swapRow.give_assignment_id
        : null);
  const takeId =
    inlineTake?.id ??
    (typeof swapRow.takeAssignmentId === "string"
      ? swapRow.takeAssignmentId
      : typeof swapRow.take_assignment_id === "string"
        ? swapRow.take_assignment_id
        : null);

  let resolvedGive = inlineGive;
  let resolvedTake = inlineTake;
  const missingAnchorIds = [!resolvedGive && giveId ? giveId : null, !resolvedTake && takeId ? takeId : null].filter(
    (id): id is string => Boolean(id),
  );

  if (missingAnchorIds.length > 0) {
    let anchorQuery = fromFn("roster_assignments");
    anchorQuery = chainCall(anchorQuery, "select", "*");
    anchorQuery = chainCall(anchorQuery, "eq", "service_id", serviceId);
    anchorQuery = chainCall(anchorQuery, "is", "superseded_at", null);
    anchorQuery = chainCall(anchorQuery, "in", "id", missingAnchorIds);
    const anchorRes = await resolveList(anchorQuery);
    if (anchorRes?.error) throw rosterApiError(anchorRes.error);
    const anchorAssignments = anchorRes.data
      .filter((row) => row.superseded_at == null && row.supersededAt == null)
      .map((row) => toRosterAssignment(row))
      .filter((row): row is RosterAssignment => row !== null);
    if (!resolvedGive && giveId) {
      resolvedGive = anchorAssignments.find((row) => row.id === giveId) ?? null;
    }
    if (!resolvedTake && takeId) {
      resolvedTake = anchorAssignments.find((row) => row.id === takeId) ?? null;
    }
  }

  // Only the two people's shifts: the rules are judged per person, and a whole team's window can
  // pass the API's row cap, which would silently drop shifts the rules need.
  let assignQuery = fromFn("roster_assignments");
  assignQuery = chainCall(assignQuery, "select", "*");
  assignQuery = chainCall(assignQuery, "eq", "service_id", serviceId);
  assignQuery = chainCall(assignQuery, "is", "superseded_at", null);
  assignQuery = chainCall(assignQuery, "in", "user_id", [requesterId, counterpartyId]);

  const anchorTimes = [resolvedGive?.startsAt, resolvedGive?.endsAt, resolvedTake?.startsAt, resolvedTake?.endsAt]
    .filter((value): value is string => Boolean(value))
    .map((value) => Date.parse(value))
    .filter((ms) => Number.isFinite(ms));

  if (anchorTimes.length > 0) {
    const windowMs = lookbackDays * 86_400_000;
    const fromIso = new Date(Math.min(...anchorTimes) - windowMs).toISOString();
    const toIso = new Date(Math.max(...anchorTimes) + windowMs).toISOString();
    assignQuery = chainCall(assignQuery, "gte", "starts_at", fromIso);
    assignQuery = chainCall(assignQuery, "lte", "starts_at", toIso);
  }

  const assignmentsRes = await resolveList(assignQuery);
  if (assignmentsRes?.error) throw rosterApiError(assignmentsRes.error);
  const assignments = assignmentsRes.data
    .filter((row) => row.superseded_at == null && row.supersededAt == null)
    .map((row) => toRosterAssignment(row))
    .filter((row): row is RosterAssignment => row !== null);

  const give = resolvedGive ?? (giveId ? (assignments.find((row) => row.id === giveId) ?? null) : null);
  const take = resolvedTake ?? (takeId ? (assignments.find((row) => row.id === takeId) ?? null) : null);
  if ((giveId && !give) || (takeId && !take) || (!give && !take)) return false;

  const flags = swapRuleFlags(assignments, rules, {
    requesterId,
    counterpartyId,
    give,
    take,
  });
  return flags.length > 0;
}

/**
 * Whether the other doctor's accept would let a swap approve itself while
 * breaking a team rule. The SQL's own accept check covers clashes and the
 * minimum break only, so a swap that breaks an hours or run-length rule is sent
 * to the manager instead (`roster_swap_accept_for_manager`). Anything this
 * cannot judge (not the counterparty, no longer waiting, expired) is left to the
 * SQL, which refuses or cancels it as before.
 */
async function swapAcceptBreaksTeamRules(
  client: AdminClient,
  actorId: string,
  serviceId: string,
  swapId: string,
): Promise<boolean> {
  if (typeof client.from !== "function") return false;
  const fromFn = client.from.bind(client) as (table: string) => unknown;
  let swapQuery = fromFn("roster_swaps");
  swapQuery = chainCall(swapQuery, "select", "*");
  swapQuery = chainCall(swapQuery, "eq", "service_id", serviceId);
  swapQuery = chainCall(swapQuery, "eq", "id", swapId);
  const swapRes = await resolveSingle(swapQuery);
  if (swapRes?.error) throw rosterApiError(swapRes.error);
  const swapRow = swapRes.data;
  if (!swapRow || swapRow.status !== "requested") return false;
  const expiresAt = typeof swapRow.expires_at === "string" ? swapRow.expires_at : null;
  if (expiresAt && Date.parse(expiresAt) <= Date.now()) return false;
  const requesterId = typeof swapRow.requester_id === "string" ? swapRow.requester_id : null;
  const counterpartyId = typeof swapRow.counterparty_id === "string" ? swapRow.counterparty_id : null;
  if (!requesterId || counterpartyId !== actorId) return false;
  return swapBreaksTeamRules(fromFn, serviceId, swapRow, requesterId, counterpartyId);
}

export type RosterReadPayload = { from?: string; to?: string };

export async function rosterRead<W extends RosterReadWhat>(
  client: AdminClient,
  actorId: string,
  serviceId: string,
  what: W,
  payload: RosterReadPayload = {},
): Promise<RosterReadResult<W>> {
  requireActor(actorId);
  // The team's members have their own member-readable function, outside roster_read.
  const { data, error } =
    what === "members"
      ? await client.rpc("roster_team_members", { p_actor_id: actorId, p_service_id: serviceId })
      : await client.rpc("roster_read", {
          p_actor_id: actorId,
          p_service_id: serviceId,
          p_what: what,
          p_payload: payload,
        });
  if (error) throw rosterApiError(error);
  const parsed = ROSTER_READ_SCHEMAS[what].safeParse(data);
  if (!parsed.success) throw rosterUnavailable();
  return parsed.data as RosterReadResult<W>;
}

/** The teams the actor belongs to, confirmed or not. */
export async function rosterReadTeams(client: AdminClient, actorId: string): Promise<RosterTeam[]> {
  requireActor(actorId);
  const { data, error } = await client.rpc("roster_read", {
    p_actor_id: actorId,
    p_service_id: null,
    p_what: "teams",
    p_payload: {},
  });
  if (error) throw rosterApiError(error);
  const parsed = rosterTeamsSchema.safeParse(data);
  if (!parsed.success) throw rosterUnavailable();
  return parsed.data.teams;
}

function withoutPostKey(payload: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...payload };
  delete rest.postKey;
  return rest;
}

/** A team write. `action` has already passed `rosterActionSchema` (or is a publish-route action). */
export async function rosterCommand(
  client: AdminClient,
  actorId: string,
  serviceId: string,
  action: RosterAction | { action: "publish" | "codes.set"; [key: string]: unknown },
): Promise<RosterCommandResult> {
  requireActor(actorId);
  if (action.action === "swap.approve" && !action.acknowledgeRuleWarnings) {
    await verifySwapApproveRules(client, actorId, serviceId, action.swapId);
  }
  // A swap that would approve itself while breaking a team rule waits for the manager instead.
  if (action.action === "swap.accept" && (await swapAcceptBreaksTeamRules(client, actorId, serviceId, action.swapId))) {
    const routed = await client.rpc("roster_swap_accept_for_manager", {
      p_actor_id: actorId,
      p_service_id: serviceId,
      p_swap_id: action.swapId,
    });
    if (routed.error) throw rosterApiError(routed.error);
    const parsedRouted = rosterCommandResultSchema.safeParse(routed.data);
    if (!parsedRouted.success) throw rosterUnavailable();
    return parsedRouted.data;
  }
  const { action: name, ...payload } = action;
  // The safe number goes through the stale check, which refuses it once anyone has saved since the editor's read.
  // Taking back an open-shift request has its own function, which only the doctor who asked can call.
  // A post that carries a key goes through roster_open_post_once, which answers a repeat of the same
  // key with the shift already saved instead of saving another; the key itself is not part of the post.
  const { data, error } =
    action.action === "open.withdraw"
      ? await client.rpc("roster_open_withdraw", {
          p_actor_id: actorId,
          p_service_id: serviceId,
          p_open_shift_id: action.openShiftId,
        })
      : action.action === "open.decline"
        ? // Declining answers with the claimer it cleared (declinedClaimedBy), read under the decline's own lock.
          await client.rpc("roster_open_decline", {
            p_actor_id: actorId,
            p_service_id: serviceId,
            p_open_shift_id: action.openShiftId,
          })
        : action.action === "needs.set"
          ? await client.rpc("roster_needs_replace", {
              p_actor_id: actorId,
              p_service_id: serviceId,
              p_expected_ids: action.expectedIds as never,
              p_needs: action.needs as never,
            })
          : action.action === "open.post"
            ? await client.rpc("roster_open_post_once", {
                p_actor_id: actorId,
                p_service_id: serviceId,
                // A keyless post gets a one-use server key so it still records a post key, which is what
                // enqueues its durable offer alert; without one the post saved but no one was alerted.
                p_post_key: action.postKey ?? randomUUID(),
                p_payload: withoutPostKey(payload) as never,
              })
            : await client.rpc("roster_command", {
                p_actor_id: actorId,
                p_service_id: serviceId,
                p_action: name,
                p_payload: payload as never,
              });
  if (error) throw rosterApiError(error);
  const parsed = rosterCommandResultSchema.safeParse(data);
  if (!parsed.success) throw rosterUnavailable();
  return parsed.data;
}
