import "server-only";

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
    minBreakHours === undefined ? 0 : Math.ceil(minBreakHours / 24) + 1,
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

async function verifySwapApproveRules(client: AdminClient, serviceId: string, swapId: string): Promise<void> {
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

  let settingsQuery = fromFn("roster_team_settings");
  settingsQuery = chainCall(settingsQuery, "select", "rules");
  settingsQuery = chainCall(settingsQuery, "eq", "service_id", serviceId);
  const settingsRes = await resolveSingle(settingsQuery);
  if (settingsRes?.error) throw rosterApiError(settingsRes.error);
  const settingsRow = settingsRes.data;

  const rules = parseRules(settingsRow?.rules);
  const lookbackDays = ruleLookbackDays(rules);
  if (lookbackDays === 0) return;

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

  const inlineGive = toRosterAssignment(swapRow.give as Record<string, unknown> | undefined);
  const inlineTake = toRosterAssignment(swapRow.take as Record<string, unknown> | undefined);
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
    anchorQuery = chainCall(anchorQuery, "in", "id", missingAnchorIds);
    const anchorRes = await resolveList(anchorQuery);
    if (anchorRes?.error) throw rosterApiError(anchorRes.error);
    const anchorAssignments = anchorRes.data
      .map((row) => toRosterAssignment(row))
      .filter((row): row is RosterAssignment => row !== null);
    if (!resolvedGive && giveId) {
      resolvedGive = anchorAssignments.find((row) => row.id === giveId) ?? null;
    }
    if (!resolvedTake && takeId) {
      resolvedTake = anchorAssignments.find((row) => row.id === takeId) ?? null;
    }
  }

  let assignQuery = fromFn("roster_assignments");
  assignQuery = chainCall(assignQuery, "select", "*");
  assignQuery = chainCall(assignQuery, "eq", "service_id", serviceId);
  assignQuery = chainCall(assignQuery, "is", "superseded_at", null);

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
    .map((row) => toRosterAssignment(row))
    .filter((row): row is RosterAssignment => row !== null);

  const give = resolvedGive ?? (giveId ? (assignments.find((row) => row.id === giveId) ?? null) : null);
  const take = resolvedTake ?? (takeId ? (assignments.find((row) => row.id === takeId) ?? null) : null);
  if (!give && !take) return;

  const flags = swapRuleFlags(assignments, rules, {
    requesterId,
    counterpartyId,
    give,
    take,
  });
  if (flags.length > 0) {
    throw rosterError("roster_swap_rule_warning");
  }
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

/** A team write. `action` has already passed `rosterActionSchema` (or is a publish-route action). */
export async function rosterCommand(
  client: AdminClient,
  actorId: string,
  serviceId: string,
  action: RosterAction | { action: "publish" | "codes.set"; [key: string]: unknown },
): Promise<RosterCommandResult> {
  requireActor(actorId);
  if (action.action === "swap.approve" && !action.acknowledgeRuleWarnings) {
    await verifySwapApproveRules(client, serviceId, action.swapId);
  }
  const { action: name, ...payload } = action;
  // The safe number goes through the stale check, which refuses it once anyone has saved since the editor's read.
  // Taking back an open-shift request has its own function, which only the doctor who asked can call.
  const { data, error } =
    action.action === "open.withdraw"
      ? await client.rpc("roster_open_withdraw", {
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
