import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";

import { isAdministratorUser } from "@/lib/authorization";
import { PublicApiError } from "@/lib/http";
import { cleanRanking, type Placement, type RotationLock } from "@/lib/roster/rotations/allocate";
import {
  placementMoveSchema,
  ROUND_STATUSES,
  rotationIdSchema,
  roundSetupSchema,
  savePreferenceSchema,
  type ManagedRound,
  type MyRound,
  type RotationAllocation,
  type RotationPreferenceRecord,
  type RotationRound,
  type RoundSetup,
  type RoundStatus,
} from "@/lib/roster/rotations/model";
import {
  closeRound,
  createManagedRound,
  editRoundSetup,
  movePlacement,
  myRoundView,
  openRound,
  publishRound,
  RotationRuleError,
  runAllocation,
  savePreference,
  setPlacementLock,
  withdrawPreference,
} from "@/lib/roster/rotations/operations";
import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Rotation preference rounds on the server. Every rule runs through the pure
 * functions in `operations.ts` (the same ones the example store runs), applied
 * to the round as it was loaded, and the result is saved only if nobody else
 * changed the round in between.
 *
 * Access, checked here on every call with the session user the route passes in:
 * - a doctor sees a round only while they are an active member of its team and
 *   named in it, and may only save or withdraw their own preference;
 * - every other action needs `canManageRotationsFor` for the round's team.
 *
 * The tables are service-role only (no policies), so nothing here is reachable
 * from the browser except through these checks.
 */

// ---------------------------------------------------------------- errors

export const ROTATIONS_NOT_LIVE_MESSAGE = "Rotations are not live for real teams yet.";

/** Missing table or function: the database change has not been applied yet. */
const NOT_LIVE_CODES = new Set(["42P01", "PGRST205", "42883", "PGRST202"]);

export function rotationsNotLive(): PublicApiError {
  return new PublicApiError(ROTATIONS_NOT_LIVE_MESSAGE, 503, { code: "rotations_not_live" });
}

export function isRotationsNotLiveError(error: { code?: string | null } | null | undefined): boolean {
  return Boolean(error?.code && NOT_LIVE_CODES.has(error.code));
}

/** A database error as a safe public error. Database text never reaches the browser. */
function databaseError(error: { code?: string | null }): PublicApiError {
  if (isRotationsNotLiveError(error)) return rotationsNotLive();
  return new PublicApiError("Rotations couldn't be reached. Try again shortly.", 503, {
    code: "rotations_unavailable",
    sqlState: error.code ?? null,
  });
}

const CONFLICT = () =>
  new PublicApiError("Someone else changed this round. Reload and try again.", 409, { code: "rotations_conflict" });
const NOT_FOUND = () => new PublicApiError("That round is no longer here.", 404, { code: "rotations_not_found" });
const MANAGER_ONLY = () =>
  new PublicApiError("Only the team's rotation administrator can do that.", 403, { code: "rotations_role_denied" });

/** Rule codes that describe the round's state rather than a bad request. */
const STATE_CONFLICT_CODES = new Set([
  "round_closed",
  "not_draft",
  "not_open",
  "published",
  "still_draft",
  "no_allocation",
  "no_placement",
  "rotation_full",
  "rotation_repeated",
  "placement_orphaned",
  "placement_over_capacity",
  "not_closed",
]);

/** A broken rule as the public error the route returns: 409 for the round's state, else 400. */
export function rotationRuleToPublicError(error: unknown): unknown {
  if (!(error instanceof RotationRuleError)) return error;
  return new PublicApiError(error.message, STATE_CONFLICT_CODES.has(error.code) ? 409 : 400, { code: error.code });
}

// ---------------------------------------------------------------- request bodies

export const createRoundBodySchema = z
  .object({
    action: z.literal("create"),
    setup: roundSetupSchema,
    /** Optional: which team. Defaults to the first team the reader runs rotations for. */
    serviceId: z.string().uuid().optional(),
  })
  .strict();

const bare = <A extends string>(action: A) => z.object({ action: z.literal(action) }).strict();

/** Every action on one round. Strict, so a body can never name an actor. */
export const roundCommandSchema = z.discriminatedUnion("action", [
  savePreferenceSchema.extend({ action: z.literal("save-preference") }).strict(),
  bare("withdraw-preference"),
  z.object({ action: z.literal("edit"), setup: roundSetupSchema }).strict(),
  bare("open"),
  bare("close"),
  bare("allocate"),
  z.object({ action: z.literal("move"), move: placementMoveSchema }).strict(),
  z
    .object({
      action: z.literal("lock"),
      personId: rotationIdSchema(80),
      termId: rotationIdSchema(64),
      lock: z.boolean(),
    })
    .strict(),
  bare("publish"),
  bare("delete"),
]);
export type RoundCommand = z.infer<typeof roundCommandSchema>;

// ---------------------------------------------------------------- who may manage

/** True when the account holds the site administrator claim. Any failure reads as false. */
export async function isSiteAdministrator(client: AdminClient, userId: string): Promise<boolean> {
  try {
    const { data, error } = await client.auth.admin.getUserById(userId);
    if (error || !data?.user) return false;
    return isAdministratorUser(data.user);
  } catch {
    return false;
  }
}

/**
 * The ONE check for running a team's rotation rounds: the site administrator,
 * or an active member holding the team's Roster manager role (the SQL helper
 * `roster_rotation_can_manage`).
 *
 * TODO(PR 3375): once the Hospital roles work merges, swap the body for
 * `canManageRotations(ctx, serviceId)` from "@/lib/work-roles/server". Every
 * caller already goes through this function, so nothing else changes.
 *
 * Pass `known.siteAdministrator` when the caller has already looked it up, to
 * save a second auth read.
 */
export async function canManageRotationsFor(
  client: AdminClient,
  userId: string,
  serviceId: string,
  known: { siteAdministrator?: boolean } = {},
): Promise<boolean> {
  if (!userId || !serviceId) return false;
  const siteAdministrator = known.siteAdministrator ?? (await isSiteAdministrator(client, userId));
  if (siteAdministrator) return true;
  const { data, error } = await client.rpc("roster_rotation_can_manage", {
    p_service_id: serviceId,
    p_user_id: userId,
  });
  if (error) throw databaseError(error);
  return data === true;
}

// ---------------------------------------------------------------- teams and people

type Team = { readonly serviceId: string; readonly name: string };

/** Confirmed (or demo) teams the user is an active member of, by name. */
async function readMyTeams(client: AdminClient, userId: string): Promise<Team[]> {
  const { data: memberships, error } = await client
    .from("on_call_service_members")
    .select("service_id")
    .eq("user_id", userId)
    .is("revoked_at", null);
  if (error) throw databaseError(error);
  const ids = [...new Set((memberships ?? []).map((row) => row.service_id))];
  if (!ids.length) return [];
  const { data: services, error: servicesError } = await client
    .from("on_call_services")
    .select("id,name,verified_at,is_demo")
    .in("id", ids);
  if (servicesError) throw databaseError(servicesError);
  return (services ?? [])
    .filter((service) => service.verified_at !== null || service.is_demo)
    .map((service) => ({ serviceId: service.id, name: service.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function serviceNames(client: AdminClient, ids: readonly string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const { data, error } = await client
    .from("on_call_services")
    .select("id,name")
    .in("id", [...ids]);
  if (error) throw databaseError(error);
  return new Map((data ?? []).map((row) => [row.id, row.name]));
}

export type RotationTeamPerson = { readonly id: string; readonly name: string; readonly grade?: string };

const GRADE_LABEL: Record<string, string> = {
  intern: "Intern",
  resident: "Resident",
  registrar: "Registrar",
  fellow: "Fellow",
  consultant: "Consultant",
};

/** The team's active members, for the new-round form. The id is the member's account id. */
async function readTeamPeople(client: AdminClient, serviceId: string): Promise<RotationTeamPerson[]> {
  const [members, roles] = await Promise.all([
    client
      .from("on_call_service_members")
      .select("user_id,display_name")
      .eq("service_id", serviceId)
      .is("revoked_at", null),
    client
      .from("roster_member_roles")
      .select("user_id,roster_name,grade")
      .eq("service_id", serviceId)
      .is("revoked_at", null),
  ]);
  if (members.error) throw databaseError(members.error);
  if (roles.error) throw databaseError(roles.error);
  const roleById = new Map((roles.data ?? []).map((row) => [row.user_id, row]));
  return (members.data ?? [])
    .map((member) => {
      const role = roleById.get(member.user_id);
      const name = (role?.roster_name ?? member.display_name ?? "").trim() || "Team member";
      const grade = role?.grade ? GRADE_LABEL[role.grade] : undefined;
      return grade ? { id: member.user_id, name, grade } : { id: member.user_id, name };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Everyone newly named in a round must be an active member of its team, and
 * every name and grade comes from the team list, never from the request body:
 * a round can only show a colleague as the team knows them. Someone already in
 * the round who has since left the team keeps the name the round holds.
 */
async function withTeamNames(
  client: AdminClient,
  serviceId: string,
  setup: RoundSetup,
  alreadyInRound: readonly RoundSetup["people"][number][] = [],
): Promise<RoundSetup> {
  const team = new Map((await readTeamPeople(client, serviceId)).map((person) => [person.id, person]));
  const before = new Map(alreadyInRound.map((person) => [person.id, person]));
  const people = setup.people.map((person) => team.get(person.id) ?? before.get(person.id));
  if (people.some((person) => person === undefined)) {
    throw new PublicApiError("Someone in this round is not in the team. Choose people from the team list.", 400, {
      code: "rotations_not_member",
    });
  }
  return {
    ...setup,
    people: people.map((person) =>
      person!.grade
        ? { id: person!.id, name: person!.name, grade: person!.grade }
        : { id: person!.id, name: person!.name },
    ),
  };
}

/** The name doctors see as the round's administrator. */
async function adminNameFor(client: AdminClient, serviceId: string, userId: string): Promise<string> {
  const [member, role] = await Promise.all([
    client
      .from("on_call_service_members")
      .select("display_name")
      .eq("service_id", serviceId)
      .eq("user_id", userId)
      .maybeSingle(),
    client
      .from("roster_member_roles")
      .select("roster_name")
      .eq("service_id", serviceId)
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  const name = (role.data?.roster_name ?? member.data?.display_name ?? "").trim();
  return name ? name.slice(0, 80) : "Rotation administrator";
}

// ---------------------------------------------------------------- rows

type RoundRow = {
  id: string;
  service_id: string;
  status: string;
  setup: unknown;
  locks: unknown;
  allocation: unknown;
  admin_name: string;
  version: number;
  created_at: string;
  opened_at: string | null;
  published_at: string | null;
  updated_at: string;
};

type PreferenceRow = {
  round_id: string;
  user_id: string;
  ranking: unknown;
  submitted_at: string | null;
  updated_at: string;
};

const ROUND_COLUMNS =
  "id,service_id,status,setup,locks,allocation,admin_name,version,created_at,opened_at,published_at,updated_at";
const PREFERENCE_COLUMNS = "round_id,user_id,ranking,submitted_at,updated_at";
const MAX_ROUNDS = 200;

const rankingSchema = z.array(rotationIdSchema(64)).max(60);

function isStatus(value: string): value is RoundStatus {
  return (ROUND_STATUSES as readonly string[]).includes(value);
}

function toPreference(row: PreferenceRow): RotationPreferenceRecord {
  const ranking = rankingSchema.safeParse(row.ranking);
  return {
    personId: row.user_id,
    ranking: ranking.success ? ranking.data : [],
    submittedAt: row.submitted_at,
    updatedAt: row.updated_at,
  };
}

/** A stored round as the app's shape. A row the app cannot read fails closed. */
function toManagedRound(row: RoundRow, teamName: string, preferences: readonly PreferenceRow[]): ManagedRound {
  const setup = roundSetupSchema.safeParse(row.setup);
  if (!setup.success || !isStatus(row.status)) {
    throw new PublicApiError("Rotations couldn't be read. Try again shortly.", 503, { code: "rotations_unreadable" });
  }
  const round: RotationRound = {
    ...setup.data,
    id: row.id,
    serviceId: row.service_id,
    teamName,
    status: row.status,
    adminName: row.admin_name,
    createdAt: row.created_at,
    openedAt: row.opened_at,
    publishedAt: row.published_at,
    version: row.version,
  };
  // Locks and the allocation are written only by this module, after the rules ran.
  const locks = Array.isArray(row.locks) ? (row.locks as RotationLock[]) : [];
  const allocation =
    row.allocation &&
    typeof row.allocation === "object" &&
    Array.isArray((row.allocation as RotationAllocation).placements)
      ? (row.allocation as RotationAllocation)
      : null;
  // Read as the round's rules say they should be, whatever the stored rows hold: only people still in the
  // round, and only rotations still on offer. A round edit that saved but did not finish tidying its
  // preference rows (see `savePreferenceChanges`) then reads exactly as if it had.
  const inRound = new Set(round.people.map((person) => person.id));
  const offered = new Set(round.rotations.map((rotation) => rotation.id));
  const healed = preferences
    .map(toPreference)
    .filter((pref) => inRound.has(pref.personId))
    .map((pref) => ({ ...pref, ranking: cleanRanking(pref.ranking, offered) }));
  return { round, preferences: healed, locks, allocation };
}

function setupOf(round: RotationRound): RoundSetup {
  return {
    name: round.name,
    closesAt: round.closesAt,
    minRanked: round.minRanked,
    terms: round.terms,
    rotations: round.rotations,
    people: round.people,
    ...(round.note ? { note: round.note } : {}),
  };
}

function roundColumns(managed: ManagedRound) {
  const { round } = managed;
  return {
    status: round.status,
    setup: setupOf(round),
    locks: managed.locks,
    allocation: managed.allocation,
    admin_name: round.adminName,
    version: round.version,
    opened_at: round.openedAt,
    published_at: round.publishedAt,
  };
}

async function loadPreferences(
  client: AdminClient,
  roundIds: readonly string[],
  onlyUserId?: string,
): Promise<PreferenceRow[]> {
  if (!roundIds.length) return [];
  let query = client
    .from("roster_rotation_preferences")
    .select(PREFERENCE_COLUMNS)
    .in("round_id", [...roundIds]);
  if (onlyUserId) query = query.eq("user_id", onlyUserId);
  const { data, error } = await query;
  if (error) throw databaseError(error);
  return (data ?? []) as PreferenceRow[];
}

// ---------------------------------------------------------------- read

export type RotationsOverview = {
  readonly mine: MyRound[];
  readonly managed: ManagedRound[];
  readonly canManage: boolean;
  readonly team: { readonly serviceId: string; readonly name: string; readonly people: RotationTeamPerson[] } | null;
};

/** Everything the rotation screens read for one signed-in user. */
export async function readRotations(client: AdminClient, userId: string): Promise<RotationsOverview> {
  if (!userId) throw new PublicApiError("Sign in to open Roster.", 401, { code: "roster_auth_required" });
  const [siteAdministrator, teams] = await Promise.all([
    isSiteAdministrator(client, userId),
    readMyTeams(client, userId),
  ]);
  const manageable = (
    await Promise.all(
      teams.map(async (team) =>
        (await canManageRotationsFor(client, userId, team.serviceId, { siteAdministrator })) ? team : null,
      ),
    )
  ).filter((team): team is Team => team !== null);
  const memberIds = new Set(teams.map((team) => team.serviceId));
  const manageIds = new Set(manageable.map((team) => team.serviceId));

  // The site administrator can run every team's rounds; anyone else reads their own teams' only.
  let roundsQuery = client
    .from("roster_rotation_rounds")
    .select(ROUND_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(MAX_ROUNDS);
  if (!siteAdministrator) {
    if (!memberIds.size) return { mine: [], managed: [], canManage: false, team: null };
    roundsQuery = roundsQuery.in("service_id", [...memberIds]);
  }
  const { data, error } = await roundsQuery;
  if (error) throw databaseError(error);
  const rows = (data ?? []) as RoundRow[];

  const names = new Map(teams.map((team) => [team.serviceId, team.name]));
  const unnamed = [...new Set(rows.map((row) => row.service_id).filter((id) => !names.has(id)))];
  for (const [id, name] of await serviceNames(client, unnamed)) names.set(id, name);

  const managedRows = rows.filter((row) => siteAdministrator || manageIds.has(row.service_id));
  const managedIds = new Set(managedRows.map((row) => row.id));
  const otherIds = rows.filter((row) => !managedIds.has(row.id)).map((row) => row.id);
  const [allPreferences, myPreferences] = await Promise.all([
    loadPreferences(client, [...managedIds]),
    loadPreferences(client, otherIds, userId),
  ]);
  const preferencesByRound = new Map<string, PreferenceRow[]>();
  for (const pref of [...allPreferences, ...myPreferences]) {
    preferencesByRound.set(pref.round_id, [...(preferencesByRound.get(pref.round_id) ?? []), pref]);
  }

  const mine: MyRound[] = [];
  const managed: ManagedRound[] = [];
  for (const row of rows) {
    const round = toManagedRound(row, names.get(row.service_id) ?? "Team", preferencesByRound.get(row.id) ?? []);
    if (managedIds.has(row.id)) managed.push(round);
    const inRound = round.round.people.some((person) => person.id === userId);
    if (memberIds.has(row.service_id) && round.round.status !== "draft" && inRound) {
      mine.push(myRoundView(round, userId));
    }
  }

  const teamForNewRounds = manageable[0] ?? (siteAdministrator ? teams[0] : undefined);
  return {
    mine,
    managed,
    canManage: siteAdministrator || manageable.length > 0,
    team: teamForNewRounds
      ? { ...teamForNewRounds, people: await readTeamPeople(client, teamForNewRounds.serviceId) }
      : null,
  };
}

// ---------------------------------------------------------------- write

/** A new draft round for a team the user runs rotations for. */
export async function createRotationRound(
  client: AdminClient,
  userId: string,
  body: { setup: RoundSetup; serviceId?: string },
  now = new Date(),
): Promise<{ roundId: string }> {
  if (!userId) throw new PublicApiError("Sign in to open Roster.", 401, { code: "roster_auth_required" });
  const siteAdministrator = await isSiteAdministrator(client, userId);
  const teams = await readMyTeams(client, userId);
  let team: Team | undefined;
  if (body.serviceId) {
    if (!(await canManageRotationsFor(client, userId, body.serviceId, { siteAdministrator }))) throw MANAGER_ONLY();
    team = teams.find((candidate) => candidate.serviceId === body.serviceId);
    if (!team) {
      const names = await serviceNames(client, [body.serviceId]);
      const name = names.get(body.serviceId);
      if (!name) throw new PublicApiError("That team is no longer here.", 404, { code: "rotations_team_not_found" });
      team = { serviceId: body.serviceId, name };
    }
  } else {
    for (const candidate of teams) {
      if (await canManageRotationsFor(client, userId, candidate.serviceId, { siteAdministrator })) {
        team = candidate;
        break;
      }
    }
    if (!team) throw MANAGER_ONLY();
  }
  const setup = await withTeamNames(client, team.serviceId, body.setup);
  const created = createManagedRound(setup, {
    id: randomUUID(),
    serviceId: team.serviceId,
    teamName: team.name,
    adminName: await adminNameFor(client, team.serviceId, userId),
    now,
  });
  const { error } = await client.from("roster_rotation_rounds").insert({
    id: created.round.id,
    service_id: team.serviceId,
    created_by: userId,
    created_at: created.round.createdAt,
    ...roundColumns(created),
  });
  if (error) throw databaseError(error);
  return { roundId: created.round.id };
}

async function loadRoundRow(client: AdminClient, roundId: string): Promise<RoundRow> {
  const { data, error } = await client
    .from("roster_rotation_rounds")
    .select(ROUND_COLUMNS)
    .eq("id", roundId)
    .maybeSingle();
  if (error) throw databaseError(error);
  if (!data) throw NOT_FOUND();
  return data as RoundRow;
}

async function teamNameOf(client: AdminClient, serviceId: string): Promise<string> {
  return (await serviceNames(client, [serviceId])).get(serviceId) ?? "Team";
}

async function isActiveMember(client: AdminClient, serviceId: string, userId: string): Promise<boolean> {
  const { data, error } = await client.rpc("service_member_active", { p_service_id: serviceId, p_user_id: userId });
  if (error) throw databaseError(error);
  return data === true;
}

/** Save the round's own row, only if it is unchanged since it was read. */
async function saveRound(client: AdminClient, row: RoundRow, next: ManagedRound): Promise<void> {
  const { data, error } = await client
    .from("roster_rotation_rounds")
    .update(roundColumns(next))
    .eq("id", row.id)
    .eq("updated_at", row.updated_at)
    .select("id");
  if (error) throw databaseError(error);
  if (!data?.length) throw CONFLICT();
}

/**
 * After an edit, the preference rows the rules changed: people removed, choices no longer on offer. It runs
 * after the round itself is saved, so it can fail on its own. Reads never depend on it (`toManagedRound`
 * reads every row as the rules say it should be), and running it again is safe: `before` is the stored rows
 * as they are, so a second run makes only the changes the first one did not finish.
 */
async function savePreferenceChanges(
  client: AdminClient,
  roundId: string,
  before: readonly RotationPreferenceRecord[],
  after: readonly RotationPreferenceRecord[],
): Promise<void> {
  const kept = new Map(after.map((pref) => [pref.personId, pref]));
  const removed = before.filter((pref) => !kept.has(pref.personId)).map((pref) => pref.personId);
  if (removed.length) {
    const { error } = await client
      .from("roster_rotation_preferences")
      .delete()
      .eq("round_id", roundId)
      .in("user_id", removed);
    if (error) throw databaseError(error);
  }
  for (const pref of before) {
    const next = kept.get(pref.personId);
    if (!next || next.ranking.join("\n") === pref.ranking.join("\n")) continue;
    const { error } = await client
      .from("roster_rotation_preferences")
      .update({ ranking: [...next.ranking] })
      .eq("round_id", roundId)
      .eq("user_id", pref.personId);
    if (error) throw databaseError(error);
  }
}

function applyManagerAction(managed: ManagedRound, command: RoundCommand, now: Date): ManagedRound {
  switch (command.action) {
    case "edit":
      return editRoundSetup(managed, command.setup);
    case "open":
      return openRound(managed, now);
    case "close":
      return closeRound(managed);
    case "allocate":
      return runAllocation(managed, now);
    case "move":
      return movePlacement(managed, command.move);
    case "lock":
      return setPlacementLock(managed, command.personId, command.termId, command.lock);
    case "publish":
      return publishRound(managed, now);
    default:
      throw new Error(`Not a manager action: ${command.action}`);
  }
}

/** One action on one round, by the session user. */
export async function runRoundCommand(
  client: AdminClient,
  userId: string,
  roundId: string,
  command: RoundCommand,
  now = new Date(),
): Promise<{ ok: true }> {
  if (!userId) throw new PublicApiError("Sign in to open Roster.", 401, { code: "roster_auth_required" });
  const row = await loadRoundRow(client, roundId);

  // A doctor's own preference: the round must be one they can see, and only their row is written.
  if (command.action === "save-preference" || command.action === "withdraw-preference") {
    if (!(await isActiveMember(client, row.service_id, userId))) throw NOT_FOUND();
    const own = await loadPreferences(client, [row.id], userId);
    const managed = toManagedRound(row, await teamNameOf(client, row.service_id), own);
    if (managed.round.status === "draft" || !managed.round.people.some((person) => person.id === userId)) {
      throw NOT_FOUND();
    }
    const next =
      command.action === "save-preference"
        ? savePreference(managed, userId, command.ranking, command.submit, now)
        : withdrawPreference(managed, userId, now);
    const record = next.preferences.find((pref) => pref.personId === userId);
    if (!record) return { ok: true };
    // The rules above were checked against the round as it was read. The write lands only while the round
    // is still that version, under a lock on the round row, so a close, allocation or edit by the
    // administrator cannot slip in between. If the round moved on, nothing is written and the doctor
    // reloads (409).
    const { data, error } = await client.rpc("roster_rotation_save_preference", {
      p_round_id: row.id,
      p_user_id: userId,
      p_round_updated_at: row.updated_at,
      p_round_status: row.status,
      p_ranking: [...record.ranking],
      p_submitted_at: record.submittedAt,
      p_updated_at: record.updatedAt,
    });
    if (error) throw databaseError(error);
    if (data !== true) throw CONFLICT();
    return { ok: true };
  }

  // Everything else runs the round: the site administrator or the team's rotation administrator.
  if (!(await canManageRotationsFor(client, userId, row.service_id))) {
    // A non-member learns nothing about the round; a member who is not its administrator is told why.
    if (!(await isActiveMember(client, row.service_id, userId))) throw NOT_FOUND();
    throw MANAGER_ONLY();
  }

  if (command.action === "delete") {
    if (row.status !== "draft") throw new RotationRuleError("Only a draft round can be deleted.", "not_draft");
    const { data, error } = await client
      .from("roster_rotation_rounds")
      .delete()
      .eq("id", row.id)
      .eq("updated_at", row.updated_at)
      .select("id");
    if (error) throw databaseError(error);
    if (!data?.length) throw CONFLICT();
    return { ok: true };
  }

  const preferences = await loadPreferences(client, [row.id]);
  const managed = toManagedRound(row, await teamNameOf(client, row.service_id), preferences);
  // The rows as stored, not as read: what `savePreferenceChanges` tidies after an edit.
  const stored = preferences.map(toPreference);
  const trusted: RoundCommand =
    command.action === "edit"
      ? { ...command, setup: await withTeamNames(client, row.service_id, command.setup, managed.round.people) }
      : command;
  const next = applyManagerAction(managed, trusted, now);
  await saveRound(client, row, next);
  if (trusted.action === "edit") {
    try {
      await savePreferenceChanges(client, row.id, stored, next.preferences);
    } catch {
      // The round is saved and reads correctly already. Saving the same edit again finishes the tidy-up.
      throw new PublicApiError(
        "The round was saved, but tidying the team's rankings did not finish. Save again to finish it.",
        503,
        { code: "rotations_edit_incomplete" },
      );
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------- calendar feed

export type FeedPlacement = {
  readonly roundId: string;
  readonly placement: Placement;
  readonly round: RotationRound;
};

/**
 * The feed owner's own published placements, for their private calendar link.
 * Only rounds in teams they are still an active member of. Before the tables
 * exist this returns nothing.
 */
export async function fetchPublishedPlacementsFor(client: AdminClient, ownerId: string): Promise<FeedPlacement[]> {
  if (!ownerId) throw new Error("Missing calendar feed owner.");
  try {
    const teams = await readMyTeams(client, ownerId);
    if (!teams.length) return [];
    const { data, error } = await client
      .from("roster_rotation_rounds")
      .select(ROUND_COLUMNS)
      .in(
        "service_id",
        teams.map((team) => team.serviceId),
      )
      .eq("status", "published")
      .order("created_at", { ascending: false })
      .limit(MAX_ROUNDS);
    if (error) throw databaseError(error);
    const names = new Map(teams.map((team) => [team.serviceId, team.name]));
    return ((data ?? []) as RoundRow[]).flatMap((row) => {
      const managed = toManagedRound(row, names.get(row.service_id) ?? "Team", []);
      return myRoundView(managed, ownerId).placements.map((placement) => ({
        roundId: row.id,
        placement,
        round: managed.round,
      }));
    });
  } catch (error) {
    if (error instanceof PublicApiError && error.details?.code === "rotations_not_live") return [];
    throw error;
  }
}
