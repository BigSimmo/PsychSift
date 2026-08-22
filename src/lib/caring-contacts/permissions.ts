// src/lib/caring-contacts/permissions.ts
import type { ActorId, TeamId } from "./ids";

export type CaringContactRole =
  "coordinator" | "teamLead" | "auditor" | "clinicalProgrammeLead" | "livedExperienceRepresentative";

/**
 * Roles held by software, not by a person. A system actor exists because a contact's provider
 * status (sent, delivered, not delivered, number invalid) is written by the dispatcher and by
 * nothing else: there is no human in that loop, and without a non-human actor those writes had no
 * attributable author at all -- which is why `Episode.counts.contactsSent` could only ever be 0.
 *
 * It is deliberately a separate union from `CaringContactRole` rather than a fourth role: the two
 * grant tables never overlap (pinned by a test), so a system actor can never acquire a human
 * capability by having a role list extended, and a human can never fabricate a delivery receipt.
 */
export type CaringContactSystemRole = "contactDispatcher";

export type CaringContactAction =
  | "viewReferral"
  | "acceptReferral"
  | "claimPlan"
  | "activatePlan"
  | "pausePlan"
  | "resumePlan"
  | "withdrawPlan"
  | "reassignPlan"
  | "moveContactWithinDay"
  | "changeContactDate"
  | "authorPathwayVersion"
  | "approvePathwayVersion"
  | "viewAccessTrail"
  | "recordHospitalStatusEvent"
  | "triggerServiceSafetyStop"
  | "approveServiceRestart"
  | "generateClinicalRecordSummary"
  | "startContactDispatch"
  | "recordContactSent"
  | "recordContactProviderStatus"
  | "recordContactMissed"
  | "createReferral"
  | "returnReferralForClarification"
  | "declineReferral"
  | "publishPathwayVersion"
  | "retirePathwayVersion"
  | "reconcileProviderDispatch"
  | "manageNotificationPreferences"
  | "enterTrainingMode"
  | "viewPatientRecord"
  | "coverCoordinator";

export type Actor = { id: ActorId; teamId: TeamId; roles: readonly CaringContactRole[] };

/** Software acting on its own: one system role, never a list, and never a human role alongside it. */
export type SystemActor = { id: ActorId; teamId: TeamId; systemRole: CaringContactSystemRole };

/** Anything that can be attributed a caring-contact action. Every capability check takes this. */
export type CaringContactActor = Actor | SystemActor;

export type Resource = { teamId: TeamId };
export type CapabilityDecision = { allowed: true } | { allowed: false; reason: string };

// Exhaustiveness guard: a `Record<CaringContactAction, true>` object literal must have
// exactly one key per union member -- TypeScript rejects it if an action is missing or if
// a stray key is added. ALL_ACTIONS is derived from this registry, so it can never drift
// from the CaringContactAction type.
const ACTION_REGISTRY: Record<CaringContactAction, true> = {
  viewReferral: true,
  acceptReferral: true,
  claimPlan: true,
  activatePlan: true,
  pausePlan: true,
  resumePlan: true,
  withdrawPlan: true,
  reassignPlan: true,
  moveContactWithinDay: true,
  changeContactDate: true,
  authorPathwayVersion: true,
  approvePathwayVersion: true,
  viewAccessTrail: true,
  recordHospitalStatusEvent: true,
  triggerServiceSafetyStop: true,
  approveServiceRestart: true,
  generateClinicalRecordSummary: true,
  startContactDispatch: true,
  recordContactSent: true,
  recordContactProviderStatus: true,
  recordContactMissed: true,
  createReferral: true,
  returnReferralForClarification: true,
  declineReferral: true,
  publishPathwayVersion: true,
  retirePathwayVersion: true,
  reconcileProviderDispatch: true,
  manageNotificationPreferences: true,
  enterTrainingMode: true,
  viewPatientRecord: true,
  coverCoordinator: true,
};

export const ALL_ACTIONS: readonly CaringContactAction[] = Object.freeze(
  Object.keys(ACTION_REGISTRY) as CaringContactAction[],
);

// Actions deliberately granted to no role at all, human or system. Kept as an explicit
// registry (rather than left implicit) so that every action in CaringContactAction must be
// classified here, in ROLE_ACTIONS, or in SYSTEM_ROLE_ACTIONS -- a new action that is added
// to the type but forgotten fails the table-driven completeness test instead of silently
// defaulting to allowed.
export const UNGRANTED_ACTIONS: readonly CaringContactAction[] = Object.freeze([]);

const COORDINATOR_ACTIONS: readonly CaringContactAction[] = Object.freeze([
  "viewReferral",
  "acceptReferral",
  "claimPlan",
  "activatePlan",
  "pausePlan",
  "resumePlan",
  "withdrawPlan",
  "moveContactWithinDay",
  "authorPathwayVersion",
  "generateClinicalRecordSummary",
  "recordHospitalStatusEvent",
  "triggerServiceSafetyStop",
  "createReferral",
  "returnReferralForClarification",
  "declineReferral",
  "reconcileProviderDispatch",
  "manageNotificationPreferences",
  "enterTrainingMode",
  "viewPatientRecord",
]);

const TEAM_LEAD_ACTIONS: readonly CaringContactAction[] = Object.freeze([
  "viewReferral",
  "acceptReferral",
  "claimPlan",
  "activatePlan",
  "pausePlan",
  "resumePlan",
  "withdrawPlan",
  "reassignPlan",
  "moveContactWithinDay",
  "changeContactDate",
  "authorPathwayVersion",
  "approvePathwayVersion",
  "generateClinicalRecordSummary",
  "recordHospitalStatusEvent",
  "triggerServiceSafetyStop",
  "approveServiceRestart",
  "createReferral",
  "returnReferralForClarification",
  "declineReferral",
  "reconcileProviderDispatch",
  "manageNotificationPreferences",
  "enterTrainingMode",
  "viewPatientRecord",
  "retirePathwayVersion",
  "coverCoordinator",
]);

// Rule 6 carves triggerServiceSafetyStop out for every role, auditor included -- stopping
// the service must never be blocked by a permission check. Every other action stays
// outside the auditor's grant (rule 3): the auditor may view the access trail and stop the
// service, and nothing else.
//
// recordHospitalStatusEvent is deliberately NOT here. Recording a readmission, a changed
// mobile number, or a third-party pause request is a clinical write, and rule 3 confines
// the auditor to reading. The one hospital event that must never be blocked -- a recorded
// death -- stays reachable for every role because the store accepts triggerServiceSafetyStop
// as an alternative capability for that event alone (see in-memory-repository.ts).
const AUDITOR_ACTIONS: readonly CaringContactAction[] = Object.freeze([
  "viewAccessTrail",
  "triggerServiceSafetyStop",
  "viewPatientRecord",
  "manageNotificationPreferences",
  "enterTrainingMode",
]);

// The two Phase 2 approver roles for pathway version dual approval. Both may approve; only
// the clinical programme lead may publish, because publication is the clinical act while
// approval (by either seat) and retirement (programme lead or team lead) are not. Neither
// approver role gains a plan-mutating action -- their footprint outside pathway
// governance and the always-available safety stop is deliberately read-only.
const CLINICAL_PROGRAMME_LEAD_ACTIONS: readonly CaringContactAction[] = Object.freeze([
  "approvePathwayVersion",
  "publishPathwayVersion",
  "retirePathwayVersion",
  "approveServiceRestart",
  "viewPatientRecord",
  "manageNotificationPreferences",
  "enterTrainingMode",
  "triggerServiceSafetyStop",
]);

const LIVED_EXPERIENCE_REPRESENTATIVE_ACTIONS: readonly CaringContactAction[] = Object.freeze([
  "approvePathwayVersion",
  "viewPatientRecord",
  "manageNotificationPreferences",
  "enterTrainingMode",
  "triggerServiceSafetyStop",
]);

export const ROLE_ACTIONS: Readonly<Record<CaringContactRole, readonly CaringContactAction[]>> = Object.freeze({
  coordinator: COORDINATOR_ACTIONS,
  teamLead: TEAM_LEAD_ACTIONS,
  auditor: AUDITOR_ACTIONS,
  clinicalProgrammeLead: CLINICAL_PROGRAMME_LEAD_ACTIONS,
  livedExperienceRepresentative: LIVED_EXPERIENCE_REPRESENTATIVE_ACTIONS,
});

// Exactly the four contact-status writes the dispatcher performs, and nothing else. It cannot
// activate, pause, resume, withdraw, reassign, move a date, author or approve a pathway version,
// read the access trail, stop the service, or generate a clinical record summary. Recording that a
// message went out is the only authority software has in this domain.
const CONTACT_DISPATCHER_ACTIONS: readonly CaringContactAction[] = Object.freeze([
  "startContactDispatch",
  "recordContactSent",
  "recordContactProviderStatus",
  "recordContactMissed",
]);

export const SYSTEM_ROLE_ACTIONS: Readonly<Record<CaringContactSystemRole, readonly CaringContactAction[]>> =
  Object.freeze({
    contactDispatcher: CONTACT_DISPATCHER_ACTIONS,
  });

/**
 * The grant a role holds, looked up by OWN property only.
 *
 * `ROLE_ACTIONS` and `SYSTEM_ROLE_ACTIONS` are frozen object literals, so every key an ordinary
 * object inherits resolves to something: `ROLE_ACTIONS["constructor"]` is a function, and calling
 * `.includes` on a function is a TypeError -- an unknown-shaped role CRASHED the capability check
 * rather than being refused by it. A `?? []` guard beside such a lookup is not a guard, because a
 * function is not nullish.
 *
 * This exact shape has been found and fixed twice already on this branch, in
 * `tests/caring-contacts-overlay-definitions.test.ts` and in `overlay-host.tsx`, and neither fix
 * travelled. It is a helper rather than a repeated `Object.hasOwn` so the third site is also the
 * last one: both lookups below go through here.
 */
function grantedActionsFor(
  table: Readonly<Record<string, readonly CaringContactAction[]>>,
  role: string,
): readonly CaringContactAction[] {
  return Object.hasOwn(table, role) ? table[role] : [];
}

/**
 * True for a system actor. An object carrying `systemRole` is treated as system-only even if it
 * also carries a `roles` array, so smuggling human roles onto a dispatcher grants nothing.
 */
export function isSystemActor(actor: CaringContactActor): actor is SystemActor {
  return typeof (actor as Partial<SystemActor>).systemRole === "string";
}

/** The role names to attribute an action to, for the audit trail. Never patient data. */
export function actorRoleNames(actor: CaringContactActor): readonly string[] {
  return isSystemActor(actor) ? [actor.systemRole] : actor.roles;
}

/**
 * Deny-by-default capability check. Order matters:
 * 1. Team scope is checked first, so a cross-team actor learns only that the team is
 *    wrong -- never which actions exist for their role.
 * 2. A system actor is answered from SYSTEM_ROLE_ACTIONS alone -- its human roles, if any
 *    were smuggled onto the object, are never consulted.
 * 3. An actor with no roles at all is refused with a distinct reason.
 * 4. Otherwise the action must be explicitly granted to at least one of the actor's
 *    roles in the frozen ROLE_ACTIONS map, or it is denied.
 */
export function canPerformCaringContactAction(
  actor: CaringContactActor,
  action: CaringContactAction,
  resource: Resource,
): CapabilityDecision {
  if (resource.teamId !== actor.teamId) {
    return { allowed: false, reason: "cross-team-denied" };
  }
  if (isSystemActor(actor)) {
    const granted = grantedActionsFor(SYSTEM_ROLE_ACTIONS, actor.systemRole).includes(action);
    return granted ? { allowed: true } : { allowed: false, reason: "action-not-granted" };
  }
  if (actor.roles.length === 0) {
    return { allowed: false, reason: "no-roles" };
  }
  const granted = actor.roles.some((role) => grantedActionsFor(ROLE_ACTIONS, role).includes(action));
  return granted ? { allowed: true } : { allowed: false, reason: "action-not-granted" };
}

/**
 * No single actor may both author and approve the same pathway version's clinical message
 * content. Separate from the role-grant check in canPerformCaringContactAction so callers
 * combine it with an approvePathwayVersion permission check rather than the two rules
 * being conflated into one reason.
 */
export function canApproveOwnAuthoredVersion(authorId: ActorId, approverId: ActorId): CapabilityDecision {
  return authorId === approverId ? { allowed: false, reason: "self-approval-denied" } : { allowed: true };
}
