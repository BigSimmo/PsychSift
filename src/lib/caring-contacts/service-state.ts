// src/lib/caring-contacts/service-state.ts
//
// The service-wide safety stop: one control that halts ALL caring-contact sending, across every
// patient and every team, the moment a confirmed wrong-recipient message, duplicate send,
// unauthorised content, material privacy or security incident, or loss of audit integrity is
// found (spec §4.2).
//
// Two properties this module exists to guarantee, and neither is recoverable elsewhere:
//
//   1. The stop holds. A stop is a service-wide fact, not a per-patient one, and the FIRST record
//      of it is permanent -- a second stop is refused rather than allowed to overwrite the reason,
//      the actor, or the time the first responder recorded. `serviceStopBlocksDispatch` is the
//      single question every dispatch path must ask, and it is true for exactly as long as the
//      service is stopped.
//
//   2. The restart cannot be a single person's decision. Restarting requires recorded approval
//      from all three of the incident lead, the privacy/security owner, and the clinical
//      programme lead -- three ROLES held by three DIFFERENT people. One actor cannot supply a
//      second approval by changing which role they are wearing, and the service does not restart
//      until the approval that completes the third distinct role arrives. There is deliberately
//      no other route back to running: no force flag, no override, no single-actor path.
//
// This is a pure transition module. It reads no ambient time (the caller injects a `Clock`),
// touches no storage, and performs no permission check -- the caller has already asked
// `canPerformCaringContactAction`. Recording the transition in the audit trail is likewise the
// caller's job; see ./audit.
import { awstIsoTimestamp, type Clock } from "./clock";
import type { ActorId, TeamId } from "./ids";
import type { TransitionResult } from "./model";

export type ServiceStopReason =
  | "wrong-recipient"
  | "duplicate-send"
  | "unauthorised-content"
  | "privacy-or-security-incident"
  | "audit-integrity-loss";

export type ServiceRestartApprovalRole = "incidentLead" | "privacySecurityOwner" | "clinicalProgrammeLead";

export type ServiceRestartApproval = {
  role: ServiceRestartApprovalRole;
  actorId: ActorId;
  /** AWST ISO-8601 instant with an explicit `+08:00` offset -- the same form ./audit records. */
  approvedAt: string;
};

/**
 * The state of the WHOLE service, not of one team.
 *
 * `reportedByTeamId` records which team reported the incident. It is provenance and nothing more:
 * it does NOT scope the stop. A stop halts sending across every patient and every team, including
 * teams that had no part in the incident, because the failure modes in spec 4.2 (wrong recipient,
 * duplicate send, unauthorised content, privacy or security incident, loss of audit integrity) are
 * evidence that the sending path itself cannot currently be trusted.
 *
 * **Storage must persist this as a single service-wide record, never one row per team.** A
 * per-team table keyed on this field would look correct in the reporting team's screens while
 * every other team kept sending straight through the incident -- which is the exact outcome the
 * stop exists to prevent. The field is named `reportedByTeamId` rather than `teamId` so that
 * mistake cannot be made by reading the type.
 */
export type ServiceState =
  | { stopped: false; reportedByTeamId: TeamId }
  | {
      stopped: true;
      reportedByTeamId: TeamId;
      reason: ServiceStopReason;
      stoppedBy: ActorId;
      /** AWST ISO-8601 instant with an explicit `+08:00` offset -- the same form ./audit records. */
      stoppedAt: string;
      /**
       * Free text written by a responder mid-incident: which message, which number, which patient.
       * Treat it as patient data. It is deliberately NOT reachable from `describeServiceStop`,
       * whose parameter type omits it -- see `ServiceStopBannerFacts`.
       */
      note: string;
      restartApprovals: readonly ServiceRestartApproval[];
    };

/**
 * The only fields the banner may see.
 *
 * `note` is absent by construction, not by convention. `describeServiceStop` renders on every
 * screen, including ones showing no patient at all, so it must never be able to leak the incident
 * note -- and a doc comment asking a future editor not to interpolate a field that is sitting in
 * scope is not a guarantee. Narrowing the parameter makes the leak a type error rather than a
 * judgement call. `ServiceState` is structurally assignable to this, so callers just pass the state.
 */
export type ServiceStopBannerFacts =
  | { stopped: false }
  | { stopped: true; reason: ServiceStopReason; restartApprovals: readonly ServiceRestartApproval[] };

/**
 * What recording a restart approval hands back (Ruling 65).
 *
 * `ServiceState` minus `note`, `stoppedBy` and `reportedByTeamId` — narrow BY CONSTRUCTION, the
 * same technique as `ServiceStopBannerFacts` above and for a sharper reason.
 *
 * Restart approvals are deliberately service-wide: the three seats need not sit in the team that
 * reported the incident, and the first two approvals leave the service stopped. So a store method
 * returning the whole record handed a cross-team approver the reporting team's incident note — and
 * because every store persists a write's return value as its idempotency replay result, that note
 * then sat at rest in a row scoped by row-level security to the APPROVING team, which the API
 * boundary's own narrowing could not reach. Narrowing the return type removes it from the reply and
 * from storage at once, and keeps a replay truthful: the original answer never contained it either.
 *
 * What survives is what an approval is for — the stop still standing, what kind of failure it was,
 * when it was raised, and the approvals recorded so far, the approver's own among them.
 */
export type ServiceRestartOutcome =
  | { stopped: false }
  | {
      stopped: true;
      reason: ServiceStopReason;
      /** AWST ISO-8601 instant with an explicit `+08:00` offset. */
      stoppedAt: string;
      restartApprovals: readonly ServiceRestartApproval[];
    };

/**
 * Projects a state onto that outcome. It lives here, beside the type, rather than in either store:
 * two stores projecting separately would be two answers to "what does an approver receive", and the
 * shared contract would only catch the difference where it happened to look.
 */
export function restartOutcomeOf(state: ServiceState): ServiceRestartOutcome {
  if (!state.stopped) return Object.freeze({ stopped: false as const });
  return Object.freeze({
    stopped: true as const,
    reason: state.reason,
    stoppedAt: state.stoppedAt,
    restartApprovals: state.restartApprovals,
  });
}

/** The five confirmed events that stop the whole service under spec §4.2. */
export const SERVICE_STOP_REASONS: readonly ServiceStopReason[] = Object.freeze([
  "wrong-recipient",
  "duplicate-send",
  "unauthorised-content",
  "privacy-or-security-incident",
  "audit-integrity-loss",
]);

/**
 * All three must be recorded, by three different people, before sending resumes. Shortening this
 * list -- or letting one person cover two entries -- converts a three-person governance decision
 * into one person's call, which is the specific failure this module exists to prevent.
 */
export const REQUIRED_RESTART_APPROVAL_ROLES: readonly ServiceRestartApprovalRole[] = Object.freeze([
  "incidentLead",
  "privacySecurityOwner",
  "clinicalProgrammeLead",
]);

/** Plain-words wording for the banner. Deliberately describes the event, never the patient. */
const STOP_REASON_WORDING: Readonly<Record<ServiceStopReason, string>> = Object.freeze({
  "wrong-recipient": "a message reached the wrong recipient",
  "duplicate-send": "the same message was sent more than once",
  "unauthorised-content": "a message went out with content nobody had approved",
  "privacy-or-security-incident": "a privacy or security incident was confirmed",
  "audit-integrity-loss": "the record of what was sent can no longer be trusted",
});

const APPROVAL_ROLE_WORDING: Readonly<Record<ServiceRestartApprovalRole, string>> = Object.freeze({
  incidentLead: "the incident lead",
  privacySecurityOwner: "the privacy and security owner",
  clinicalProgrammeLead: "the clinical programme lead",
});

export function runningService(reportedByTeamId: TeamId): ServiceState {
  return Object.freeze({ stopped: false as const, reportedByTeamId });
}

/**
 * Records a service-wide stop.
 *
 * Refuses `service-already-stopped` when the service is already stopped: the first record is the
 * account of the incident and is never overwritten, so a later responder cannot replace the
 * original reason, actor, time, or note. Refuses `service-stop-note-required` when the note is
 * blank -- the categorised reason answers "what kind of failure", the note answers "which one",
 * and an incident with no "which one" cannot be reviewed afterwards.
 */
export function applyServiceStop(
  state: ServiceState,
  input: { reason: ServiceStopReason; actorId: ActorId; note: string },
  clock: Clock,
): TransitionResult<ServiceState> {
  if (state.stopped) return { ok: false, reason: "service-already-stopped" };
  if (input.note.trim() === "") return { ok: false, reason: "service-stop-note-required" };

  return {
    ok: true,
    value: Object.freeze({
      stopped: true as const,
      reportedByTeamId: state.reportedByTeamId,
      reason: input.reason,
      stoppedBy: input.actorId,
      stoppedAt: awstIsoTimestamp(clock.now()),
      note: input.note,
      restartApprovals: Object.freeze([]),
    }),
  };
}

/**
 * Records one restart approval, and restarts the service only on the approval that completes all
 * three required roles.
 *
 * Refusals:
 *   * `service-not-stopped` -- there is nothing to approve a restart of.
 *   * `restart-approval-role-already-recorded` -- that role has already spoken; a second holder of
 *     the same role does not add a second independent check.
 *   * `restart-approval-actor-already-recorded` -- this person has already approved in some role.
 *     Without this check, one person could supply all three approvals by changing role, and the
 *     interface would permit a single-person restart.
 *
 * Two approvals leave the service stopped with both approvals recorded; only the third distinct
 * role returns a running service.
 */
export function applyServiceRestartApproval(
  state: ServiceState,
  input: { role: ServiceRestartApprovalRole; actorId: ActorId },
  clock: Clock,
): TransitionResult<ServiceState> {
  if (!state.stopped) return { ok: false, reason: "service-not-stopped" };
  if (state.restartApprovals.some((approval) => approval.role === input.role)) {
    return { ok: false, reason: "restart-approval-role-already-recorded" };
  }
  if (state.restartApprovals.some((approval) => approval.actorId === input.actorId)) {
    return { ok: false, reason: "restart-approval-actor-already-recorded" };
  }

  const approvals: readonly ServiceRestartApproval[] = Object.freeze([
    ...state.restartApprovals,
    Object.freeze({ role: input.role, actorId: input.actorId, approvedAt: awstIsoTimestamp(clock.now()) }),
  ]);

  const everyRequiredRoleApproved = REQUIRED_RESTART_APPROVAL_ROLES.every((role) =>
    approvals.some((approval) => approval.role === role),
  );
  if (everyRequiredRoleApproved) return { ok: true, value: runningService(state.reportedByTeamId) };

  return { ok: true, value: Object.freeze({ ...state, restartApprovals: approvals }) };
}

/**
 * The single question every dispatch path asks before sending anything. True for exactly as long
 * as the service is stopped -- there is no reason, actor, or approval count that makes a stopped
 * service dispatchable.
 */
export function serviceStopBlocksDispatch(state: ServiceState): boolean {
  return state.stopped;
}

/**
 * Banner text: why sending is stopped and how far the restart approvals have got. `null` while the
 * service is running.
 *
 * Takes `ServiceStopBannerFacts`, not the full `ServiceState`, so the incident `note` is not in
 * scope here and cannot be interpolated into the banner by a later edit. The banner therefore
 * carries no patient information -- no name, no mobile number, no plan or patient identifier.
 *
 * A stopped state can hold at most two approvals (the third restarts the service), so there is
 * always at least one role outstanding to name.
 */
/**
 * Ruling 61, applied to this lookup. `STOP_REASON_WORDING` is a frozen OBJECT LITERAL, so every key
 * an ordinary object inherits resolves to something: `STOP_REASON_WORDING["constructor"]` is a
 * function, and the banner would have interpolated its source into a sentence rendered on every
 * screen in the workspace.
 *
 * It throws rather than falling back, and the difference matters here more than most places. The key
 * is a member of a CLOSED union, so an unknown one is a programming error, not a runtime condition
 * needing a named refusal -- and a fallback would render a plausible sentence about a stop nobody
 * described, on the one banner whose whole job is to say truthfully why sending has halted. Same
 * treatment as `blockReasonWording` in the overlay host; a per-lookup fix does not travel between
 * lookups, which is the actual lesson.
 */
function stopReasonWording(reason: ServiceStopReason): string {
  if (!Object.hasOwn(STOP_REASON_WORDING, reason)) {
    throw new Error(
      `No plain-words wording for the service stop reason "${reason}". Ruling 61: add an entry to ` +
        `STOP_REASON_WORDING deliberately. Do not derive it from the identifier and do not add a ` +
        `default branch -- an undescribed reason must be visible, not plausible.`,
    );
  }
  return STOP_REASON_WORDING[reason];
}

export function describeServiceStop(state: ServiceStopBannerFacts): string | null {
  if (!state.stopped) return null;

  const recorded = state.restartApprovals.length;
  const total = REQUIRED_RESTART_APPROVAL_ROLES.length;
  const outstanding = REQUIRED_RESTART_APPROVAL_ROLES.filter(
    (role) => !state.restartApprovals.some((approval) => approval.role === role),
  ).map((role) => APPROVAL_ROLE_WORDING[role]);

  return (
    `All caring-contact sending is stopped for the whole service because ${stopReasonWording(state.reason)}. ` +
    `${recorded} of ${total} restart approvals recorded. ` +
    `Still needed: ${formatList(outstanding)}, each from a different person.`
  );
}

function formatList(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
