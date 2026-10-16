import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

import { PublicApiError } from "@/lib/http";
import { hashServiceInvitation } from "@/lib/on-call/service-repository";
import { teachingDisplayPath } from "@/lib/teaching/checkin-token";
import {
  attendanceMarkSchema,
  auditResultSchema,
  calendarSetSchema,
  checkinCodeSchema,
  checkinCompletedSchema,
  checkinOpenedSchema,
  collectionReadResultSchema,
  collectionSavedSchema,
  collectionSectionSavedSchema,
  cpdSavedSchema,
  displayCodeSchema,
  displayCreatedSchema,
  exportResultSchema,
  groupDeletedSchema,
  groupMembersSetSchema,
  groupSavedSchema,
  invitationCreatedSchema,
  logbookSchema,
  membersResultSchema,
  noticeReadResultSchema,
  occurrenceChangedSchema,
  organiseResultSchema,
  registerResultSchema,
  resourceAddedSchema,
  resourceRemovedSchema,
  resourceSaveResultSchema,
  resourcesForSessionSchema,
  resourcesForWeekSchema,
  roleSetSchema,
  seriesOpenToResultSchema,
  seriesSavedSchema,
  sessionDetailSchema,
  sessionNextResultSchema,
  supervisionPendingSchema,
  teachingWeekSchema,
  unloggedCountSchema,
  weekAddResultSchema,
  whatsOnReadResultSchema,
  type AttendanceMark,
  type CheckinCompleted,
  type CheckinOpened,
  type DisplayCode,
  type LogbookRow,
  type SessionDetail,
  type TeachingAction,
  type TeachingCpdBody,
  type TeachingResourcesQuery,
  type TeachingResourceTeamAction,
  type TeachingServiceAction,
  type TeachingServiceQuery,
  type TeachingWeek,
  type TeachingWhatsOnAction,
  type WhatsOnRead,
} from "@/lib/teaching/model";

type AdminClient = ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>;

/** Codes the Teaching SQL raises, as plain words a doctor can act on (spec §11). */
export const teachingErrors: Record<string, { status: number; message: string }> = {
  teaching_auth_required: { status: 401, message: "Sign in to use Teaching." },
  teaching_invalid_request: { status: 400, message: "Check the details and try again." },
  teaching_access_denied: {
    status: 403,
    message: "You're not a member of this service. Ask your organiser for an invitation.",
  },
  teaching_role_denied: { status: 403, message: "Your Teaching role doesn't allow this." },
  teaching_team_unverified: {
    status: 403,
    message: "This service isn't approved for real records yet. Until it is, only the demo service can be used.",
  },
  teaching_not_found: { status: 404, message: "This session isn't available." },
  teaching_code_expired: { status: 410, message: "The code changed. Scan the screen again." },
  teaching_code_invalid: { status: 400, message: "That code isn't right. Check it and try again." },
  teaching_code_other_team: {
    status: 403,
    message: "This code is for a service you're not in. Ask that service's organiser for an invitation.",
  },
  teaching_window_closed: { status: 409, message: "Check-in isn't open for this session right now." },
  teaching_link_expired: {
    status: 410,
    message: "This display link has expired. Open a new one from the session page.",
  },
  teaching_not_attended: { status: 409, message: "You can log this to CPD once your attendance is recorded." },
  cme_year_missing: {
    status: 409,
    message: "Set up your CPD year for this session's date first. You can do that in CPD.",
  },
  cme_year_closed: {
    status: 409,
    message: "The CPD year for this session is closed. Add it as an amendment in CPD.",
  },
  cme_retry_conflict: {
    status: 409,
    message: "This save was already used for different details. Reload and try again.",
  },
  teaching_limit: { status: 409, message: "This service has reached its limit for this item." },
  teaching_last_admin: { status: 409, message: "A service needs at least one Teaching admin." },
  // Raised by `teaching_whats_on_command` (S9/S10); mapped here so the migration and this map agree.
  teaching_no_health_service: {
    status: 409,
    message: "Your service has no health service yet. Ask for it to be set.",
  },
};

/** PostgREST "function not found", Postgres "undefined function" and "undefined table". */
const SETUP_PENDING_CODES = new Set(["PGRST202", "42883", "42P01"]);

export function isTeachingSetupPending(error: { code?: string | null }): boolean {
  return Boolean(error.code && SETUP_PENDING_CODES.has(error.code));
}

/** A database error as a safe public error. Database text never reaches the browser. */
export function teachingRpcError(error: { message: string; code?: string | null }): PublicApiError {
  const known = teachingErrors[error.message];
  if (known) return new PublicApiError(known.message, known.status, { code: error.message });
  if (isTeachingSetupPending(error))
    return new PublicApiError("Teaching is being set up. Try again later.", 503, { code: "teaching_setup_pending" });
  if (error.code === "23505") return new PublicApiError("That already exists.", 409, { code: "teaching_duplicate" });
  // The SQL state is logged on the server only; it never reaches the response body.
  return new PublicApiError("Teaching could not be loaded or updated.", 503, {
    code: "teaching_unavailable",
    sqlState: error.code ?? null,
  });
}

/** Parses a database result; unknown keys are dropped, and a missing field fails closed without echoing the data. */
export function parseTeachingResult<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const parsed = schema.safeParse(data);
  if (!parsed.success)
    throw new PublicApiError("Teaching could not be loaded or updated.", 503, { code: "teaching_unavailable" });
  return parsed.data;
}

/** 32 random bytes as lower-case hex: display links, claim secrets and invitation codes. */
export function newTeachingSecret(): string {
  return randomBytes(32).toString("hex");
}

export function hashTeachingSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function payloadOf<T extends { action: string }>(input: T): Omit<T, "action"> {
  const copy: Partial<T> = { ...input };
  delete copy.action;
  return copy as Omit<T, "action">;
}

/** Actor is supplied only by requireAuthenticatedUser, never by a request payload. */
export async function teachingCommand(
  client: AdminClient,
  actorId: string,
  serviceId: string | null,
  action: TeachingAction,
  payload: object = {},
): Promise<unknown> {
  if (!actorId)
    throw new PublicApiError(teachingErrors.teaching_auth_required.message, 401, { code: "teaching_auth_required" });
  const { data, error } = await client.rpc("teaching_command", {
    p_actor_id: actorId,
    p_service_id: serviceId,
    p_action: action,
    p_payload: payload,
  });
  if (error) throw teachingRpcError(error);
  return data;
}

export async function readWeek(
  client: AdminClient,
  actorId: string,
  range: { from: string; to: string },
): Promise<TeachingWeek> {
  const week = parseTeachingResult(
    teachingWeekSchema,
    await teachingCommand(client, actorId, null, "week.read", range),
  );
  if (week.teams.length === 0) return week;
  // The service-role client must constrain both owner and the membership-authorized teams.
  // A failed consent read fails the whole response rather than displaying a false opt-out.
  const { data, error } = await client
    .from("teaching_calendar_optins")
    .select("service_id")
    .eq("user_id", actorId)
    .in(
      "service_id",
      week.teams.map((team) => team.id),
    );
  if (error) throw teachingRpcError(error);
  const optedIn = new Set(
    parseTeachingResult(z.array(z.object({ service_id: z.uuid() })), data).map((row) => row.service_id),
  );
  return { ...week, teams: week.teams.map((team) => ({ ...team, inCalendar: optedIn.has(team.id) })) };
}

export async function readLogbook(client: AdminClient, actorId: string): Promise<LogbookRow[]> {
  return parseTeachingResult(logbookSchema, await teachingCommand(client, actorId, null, "logbook.read")).attendance;
}

/** For CPD's Today: how many attended, ended sessions have no CPD entry yet. A count only (plan-contracts §10). */
export async function fetchTeachingUnloggedCount(client: AdminClient, ownerId: string): Promise<number> {
  return parseTeachingResult(unloggedCountSchema, await teachingCommand(client, ownerId, null, "cpd.unlogged")).count;
}

/** The Organise page's editors: every series of the team, its groups, and its active members. */
export async function readOrganise(client: AdminClient, actorId: string, serviceId: string) {
  return parseTeachingResult(organiseResultSchema, await teachingCommand(client, actorId, serviceId, "organise.read"));
}

/** The quiet-day hero: the actor's next listed session across every active team, or none. No team named. */
export async function readNextSession(client: AdminClient, actorId: string) {
  return parseTeachingResult(sessionNextResultSchema, await teachingCommand(client, actorId, null, "session.next"))
    .session;
}

/** A supervisor's pending confirmations across active teams, as a count only. */
export async function readSupervisionPending(client: AdminClient, actorId: string): Promise<number> {
  return parseTeachingResult(
    supervisionPendingSchema,
    await teachingCommand(client, actorId, null, "supervision.pending"),
  ).count;
}

/** `serviceId` null: the database takes the service from the occurrence (a calendar link knows only the occurrence). */
export async function readSession(
  client: AdminClient,
  actorId: string,
  serviceId: string | null,
  occurrenceId: string,
): Promise<SessionDetail> {
  return parseTeachingResult(
    sessionDetailSchema,
    await teachingCommand(client, actorId, serviceId, "session.read", { occurrenceId }),
  );
}

export async function markSelfAttendance(
  client: AdminClient,
  actorId: string,
  serviceId: string,
  occurrenceId: string,
): Promise<AttendanceMark> {
  return parseTeachingResult(
    attendanceMarkSchema,
    await teachingCommand(client, actorId, serviceId, "attendance.self", { occurrenceId }),
  );
}

export async function completeCheckin(
  client: AdminClient,
  actorId: string,
  claimHash: string,
): Promise<CheckinCompleted> {
  return parseTeachingResult(
    checkinCompletedSchema,
    await teachingCommand(client, actorId, null, "checkin.complete", { claimHash }),
  );
}

/** No actor: records a single-use, 10-minute claim for a scanned token. */
export async function openCheckinClaim(client: AdminClient, token: string, claimHash: string): Promise<CheckinOpened> {
  const { data, error } = await client.rpc("teaching_checkin_open", { p_token: token, p_claim_hash: claimHash });
  if (error) throw teachingRpcError(error);
  return parseTeachingResult(checkinOpenedSchema, data);
}

/** No actor: the current code for a live display link. */
export async function readDisplayCode(client: AdminClient, linkHash: string): Promise<DisplayCode> {
  const { data, error } = await client.rpc("teaching_display_code", { p_link_hash: linkHash });
  if (error) throw teachingRpcError(error);
  return parseTeachingResult(displayCodeSchema, data);
}

export async function teachingServiceRead(
  client: AdminClient,
  actorId: string,
  serviceId: string,
  query: TeachingServiceQuery,
): Promise<unknown> {
  const data = await teachingCommand(client, actorId, serviceId, query.action, payloadOf(query));
  switch (query.action) {
    case "session.read":
      return parseTeachingResult(sessionDetailSchema, data);
    case "register.read":
      return parseTeachingResult(registerResultSchema, data);
    case "checkin.code":
      return parseTeachingResult(checkinCodeSchema, data);
    case "members.read":
      return parseTeachingResult(membersResultSchema, data);
    case "audit.read":
      return parseTeachingResult(auditResultSchema, data);
    case "export.attendance":
      return parseTeachingResult(exportResultSchema, data);
    case "organise.read":
      return parseTeachingResult(organiseResultSchema, data);
  }
}

export async function teachingServiceMutation(
  client: AdminClient,
  actorId: string,
  serviceId: string,
  input: TeachingServiceAction,
): Promise<unknown> {
  switch (input.action) {
    case "invitation.create": {
      // Redeemed through the shared On Call join, so it uses the same hash as that join.
      const code = newTeachingSecret();
      const data = await teachingCommand(client, actorId, serviceId, input.action, {
        email: input.email,
        tokenHash: hashServiceInvitation(code),
      });
      return { ...parseTeachingResult(invitationCreatedSchema, data), code };
    }
    case "display.create": {
      const secret = newTeachingSecret();
      const data = await teachingCommand(client, actorId, serviceId, input.action, {
        occurrenceId: input.occurrenceId,
        stream: input.stream,
        linkHash: hashTeachingSecret(secret),
      });
      // `token` for the UI part's own link building, `path` for callers that only need the address.
      return { ...parseTeachingResult(displayCreatedSchema, data), token: secret, path: teachingDisplayPath(secret) };
    }
    case "display.revoke": {
      const tokenHash = hashTeachingSecret(input.token);
      if (typeof client.from === "function") {
        const linkTable = client.from("teaching_display_links");
        if (linkTable && typeof linkTable.select === "function") {
          const linkQuery = linkTable
            .select("id, created_by, teaching_occurrences!inner(service_id)")
            .eq("link_hash", tokenHash)
            .eq("teaching_occurrences.service_id", serviceId);
          const linkRes = (
            typeof linkQuery.maybeSingle === "function" ? await linkQuery.maybeSingle() : await linkQuery
          ) as { data?: unknown; error?: { message: string; code?: string | null } | null } | null;
          if (linkRes?.error) throw teachingRpcError(linkRes.error);
          const link = linkRes?.data;
          const linkRow = (Array.isArray(link) ? link[0] : link) as { id?: string; created_by?: string | null } | null;
          if (linkRow && (!linkRow.created_by || linkRow.created_by !== actorId)) {
            const roleTable = client.from("teaching_member_roles");
            if (roleTable && typeof roleTable.select === "function") {
              const roleQuery = roleTable
                .select("role")
                .eq("service_id", serviceId)
                .eq("user_id", actorId)
                .eq("role", "organiser")
                .is("revoked_at", null);
              const roleRes = (
                typeof roleQuery.maybeSingle === "function" ? await roleQuery.maybeSingle() : await roleQuery
              ) as { data?: unknown; error?: { message: string; code?: string | null } | null } | null;
              if (roleRes?.error) throw teachingRpcError(roleRes.error);
              const roleRow = roleRes?.data;
              const activeOrganiser = Array.isArray(roleRow) ? roleRow[0] : roleRow;
              if (!activeOrganiser) {
                throw teachingRpcError({ message: "teaching_role_denied" });
              }
            }
          }
        }
      }
      await teachingCommand(client, actorId, serviceId, input.action, { linkHash: tokenHash });
      return {};
    }
    case "series.save":
      return parseTeachingResult(
        seriesSavedSchema,
        await teachingCommand(client, actorId, serviceId, input.action, payloadOf(input)),
      );
    case "group.save":
      return parseTeachingResult(
        groupSavedSchema,
        await teachingCommand(client, actorId, serviceId, input.action, payloadOf(input)),
      );
    case "attendance.self":
    case "checkin.typed":
      return parseTeachingResult(
        attendanceMarkSchema,
        await teachingCommand(client, actorId, serviceId, input.action, payloadOf(input)),
      );
    // Reconciliation with part 1 (master plan S10): these six were returned unchecked before.
    case "notice.read":
      return parseTeachingResult(
        noticeReadResultSchema,
        await teachingCommand(client, actorId, serviceId, input.action, payloadOf(input)),
      );
    case "calendar.set":
      return parseTeachingResult(
        calendarSetSchema,
        await teachingCommand(client, actorId, serviceId, input.action, payloadOf(input)),
      );
    case "occurrence.change":
      return parseTeachingResult(
        occurrenceChangedSchema,
        await teachingCommand(client, actorId, serviceId, input.action, payloadOf(input)),
      );
    case "group.delete":
      return parseTeachingResult(
        groupDeletedSchema,
        await teachingCommand(client, actorId, serviceId, input.action, payloadOf(input)),
      );
    case "group.members.set":
      return parseTeachingResult(
        groupMembersSetSchema,
        await teachingCommand(client, actorId, serviceId, input.action, payloadOf(input)),
      );
    case "role.set":
      return parseTeachingResult(
        roleSetSchema,
        await teachingCommand(client, actorId, serviceId, input.action, payloadOf(input)),
      );
    default:
      return teachingCommand(client, actorId, serviceId, input.action, payloadOf(input));
  }
}

/**
 * `cme_save_teaching_entry` raises `teaching_window_closed` while the session has not ended yet.
 * The shared message talks about check-in, so the CPD save says what is actually true.
 */
export const TEACHING_CPD_NOT_ENDED_MESSAGE = "You can log this to CPD once the session has ended.";

/**
 * "Log to CPD" (plan-contracts §10): one CPD entry for one attended session, made by the CPD
 * function that owns the rule (attendance required, an open CPD year for the session's Perth
 * date, an archived entry reused). Never CPD's generic entries API, and no Teaching audit row, so
 * no CPD detail enters any Teaching log. `requestId` makes a retried tap return the same entry.
 */
export async function saveTeachingCpdEntry(
  client: AdminClient,
  ownerId: string,
  body: TeachingCpdBody,
): Promise<{ entryId: string; created: boolean }> {
  if (!ownerId)
    throw new PublicApiError(teachingErrors.teaching_auth_required.message, 401, { code: "teaching_auth_required" });
  const { data, error } = await client.rpc("cme_save_teaching_entry", {
    p_owner_id: ownerId,
    p_occurrence_id: body.occurrenceId,
    p_hours: body.hours,
    p_request_id: body.requestId,
  });
  if (error) {
    if (error.message === "teaching_window_closed")
      throw new PublicApiError(TEACHING_CPD_NOT_ENDED_MESSAGE, 409, { code: "teaching_window_closed" });
    throw teachingRpcError(error);
  }
  return parseTeachingResult(cpdSavedSchema, data);
}

// ---- What's on and Resources (spec §5a, part 1 D4b) ------------------------------

type WhatsOnCommandAction =
  | "whats_on.read"
  | TeachingWhatsOnAction["action"]
  | TeachingResourcesQuery["action"]
  | TeachingResourceTeamAction["action"];

/**
 * `teaching_whats_on_command`, not `teaching_command`: the viewer's own actions across services
 * (service id null) and the resource writes for one service. Membership and role are checked in the
 * database, and its codes map through the same `teachingErrors` as every other Teaching call.
 */
async function teachingWhatsOnCommand(
  client: AdminClient,
  actorId: string,
  serviceId: string | null,
  action: WhatsOnCommandAction,
  payload: object = {},
): Promise<unknown> {
  if (!actorId)
    throw new PublicApiError(teachingErrors.teaching_auth_required.message, 401, { code: "teaching_auth_required" });
  const { data, error } = await client.rpc("teaching_whats_on_command", {
    p_actor_id: actorId,
    p_service_id: serviceId,
    p_action: action,
    p_payload: payload,
  });
  if (error) throw teachingRpcError(error);
  return data;
}

/** What's on for one week: the viewer's own services' sessions and those opened to their health service. */
export async function readWhatsOn(client: AdminClient, actorId: string, weekStart: string): Promise<WhatsOnRead> {
  return parseTeachingResult(
    whatsOnReadResultSchema,
    await teachingWhatsOnCommand(client, actorId, null, "whats_on.read", { weekStart }),
  );
}

export async function teachingWhatsOnMutation(
  client: AdminClient,
  actorId: string,
  input: TeachingWhatsOnAction,
): Promise<unknown> {
  const data = await teachingWhatsOnCommand(client, actorId, null, input.action, payloadOf(input));
  switch (input.action) {
    case "week_add.set":
    case "week_add.unset":
      return parseTeachingResult(weekAddResultSchema, data);
    case "whats_on.attend":
      // Stored as method `self` with the visitor flag (master plan R15); never a fourth method.
      return parseTeachingResult(attendanceMarkSchema, data);
    case "resource_save.set":
    case "resource_save.unset":
      return parseTeachingResult(resourceSaveResultSchema, data);
  }
}

export async function teachingResourcesRead(
  client: AdminClient,
  actorId: string,
  query: TeachingResourcesQuery,
): Promise<unknown> {
  const data = await teachingWhatsOnCommand(client, actorId, null, query.action, payloadOf(query));
  if (query.action === "collection.read") return parseTeachingResult(collectionReadResultSchema, data);
  return query.occurrenceId
    ? parseTeachingResult(resourcesForSessionSchema, data)
    : parseTeachingResult(resourcesForWeekSchema, data);
}

export async function teachingResourceTeamMutation(
  client: AdminClient,
  actorId: string,
  serviceId: string,
  input: TeachingResourceTeamAction,
): Promise<unknown> {
  const data = await teachingWhatsOnCommand(client, actorId, serviceId, input.action, payloadOf(input));
  switch (input.action) {
    case "resource.add":
      return parseTeachingResult(resourceAddedSchema, data);
    case "resource.remove":
      return parseTeachingResult(resourceRemovedSchema, data);
    case "series.set_open_to":
      return parseTeachingResult(seriesOpenToResultSchema, data);
    case "collection.save":
      return parseTeachingResult(collectionSavedSchema, data);
    case "collection.section.save":
      return parseTeachingResult(collectionSectionSavedSchema, data);
  }
}
