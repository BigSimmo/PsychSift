// src/lib/caring-contacts/repository.ts
//
// The storage contract every caring-contact change passes through.
//
// Contract (decision lock, 2026-08-19):
//   * every write carries an idempotency key; replaying that key returns the ORIGINAL result and
//     performs no second change, so a retried request can never send a second caring contact;
//   * every write appends exactly one audit event, atomically with the change — if the audit
//     record cannot be produced or accepted, the change does not happen either;
//   * every write states the version it expected; a write against a stale version is refused by
//     name rather than overwriting whatever another actor did in between;
//   * a patient may have only one non-terminal plan at a time;
//   * reads are scoped to the actor's team and return EMPTY for anything outside it — never a
//     refusal that would reveal a record exists.
//
// Every refusal is a named, machine-readable reason. Nothing here is thrown for an expected
// condition; a throw means the write could not be completed at all and nothing was recorded.
//
// WHAT THE REPLAY RECORD MAY HOLD. Both stores persist two things per write: an opaque fingerprint
// of the request (see ./fingerprint — hashed there so neither store can write the request's text
// into a row) and the ORIGINAL result, which a replay returns verbatim. The result is therefore
// bounded by the return types declared below, and those already exclude patient-identifying detail:
// every write returns a `PlanRecord`, `StoredContact`, `Referral`, `PathwayVersion`,
// `PlanAssignment`, `DispatchRecord`, `ServiceState`, `NotificationPreferences`, `TrainingRecord`
// or `void`, and `StoredPlan`'s `patientDetail` is released through `getEpisode` alone. A new write
// that would put anything else identifying in a result needs a NARROWER RETURN TYPE, not a filter on
// the way into storage: the stored result is the answer a replay must return, so filtering it makes
// a genuine retry receive less than the first call did.
//
// The one free-text field that does reach it is `ServiceState.note`, and it is a KNOWN RESIDUAL
// rather than a settled decision. `stopService`'s row is written under the reporting team's own id,
// which is fine. `approveServiceRestart`'s is not: restart approvals are service-wide, so another
// team's approver stores the reporting team's note under THEIR team id, and this table's row-level
// security is team-scoped -- while `narrowServiceStateForActor` on the server surface gates that
// note behind `viewPatientRecord` for the reporting team. Narrowing `approveServiceRestart`'s
// return type is the recommended fix; it spans this contract and the API surface, so it was left
// for a decision rather than guessed at. See the wave A review report.
//
// This module is types, named constants, and the few pure helpers both stores would otherwise each
// declare for themselves. Both the in-memory store (Task 9) and the Postgres store (Task 11)
// implement it, and both are exercised by the identical contract suite.
import { teamId } from "./ids";
import type { AccessedObjectType, AccessRecord } from "./access-audit";
import type { AssignmentAction, PlanAssignment } from "./assignment";
import type { AuditEvent } from "./audit";
import type { Clock } from "./clock";
import type { ContactDateChangeRequest, ContactMoveRequest } from "./contact-rescheduling";
import type { HospitalStatusEvent, PlanException, PlanIncident, WithdrawalOrigin } from "./hospital-events";
import type {
  ActorId,
  ContactId,
  IdempotencyKey,
  PathwayVersionId,
  PatientId,
  PlanId,
  ReferralId,
  TeamId,
} from "./ids";
import { TERMINAL_PLAN_STATES } from "./model";
import type { Contact, Plan, PlanState, ProviderStatus, Referral, SendingPreference, TransitionResult } from "./model";
import type { NotificationPreferences } from "./notification-preferences";
import type { PathwayVersion, PathwayVersionAction } from "./pathway-versions";
import type { CaringContactAction, CaringContactActor } from "./permissions";
import type { ReferralAction } from "./referrals";
import type {
  ServiceRestartApprovalRole,
  ServiceRestartOutcome,
  ServiceState,
  ServiceStopReason,
} from "./service-state";
import type { TrainingCompetency, TrainingRecord } from "./training";
import type { Episode, EpisodeState } from "./episode";
import type { PlannedContact } from "./schedule";

/**
 * Episode reconciliation (carried finding from Task 8).
 *
 * `Episode` and `DeidentifiedEpisode` are adopted verbatim from ./episode; this module defines no
 * competing episode shape. The division is:
 *   * `StoredPlan` is what the datastore holds — identifiers, versions, contacts, patient detail;
 *   * `Episode` is the reporting projection assembled from a `StoredPlan` on demand
 *     (`CaringContactRepository.getEpisode`), so the domain still has exactly one episode type.
 *
 * The projection maps `Plan.state` straight onto `Episode.state`. Those two unions are declared in
 * different modules, so the assertion below pins them as the same set: if a future edit adds a
 * state to one and not the other, this line stops compiling instead of the projection silently
 * narrowing an episode's state.
 */
type SameUnion<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
export const EPISODE_STATE_MATCHES_PLAN_STATE: SameUnion<PlanState, EpisodeState> = true;

/** The patient-identifying half of an `Episode`, taken from that type so it cannot drift from it. */
export type EpisodePatientDetail = Pick<
  Episode,
  "patientName" | "patientMobileNumber" | "patientIdentifiers" | "culturalIdentity"
>;

/**
 * Seeds the running-service singleton before any stop has ever been raised. It names no real
 * team, so an unstopped store cannot be mistaken for one that has already recorded an incident.
 *
 * It lives here, on the contract, rather than in either store: `ServiceState.reportedByTeamId` is
 * carried forward across a restart, so a store that seeded a different placeholder would hand back
 * a different running state than the other for the same history -- a divergence the shared contract
 * suite would only catch if it happened to assert on the field.
 */
export const SERVICE_STATE_UNSET_TEAM: TeamId = teamId("service-state-unset");

/**
 * Every mutating call is attributed to an actor and keyed for replay. The actor may be a person or
 * the dispatcher: a provider status has no human author, and an unattributable write is not one
 * this layer accepts.
 */
export type WriteContext = { actor: CaringContactActor; idempotencyKey: IdempotencyKey };

/** Every read is attributed to an actor, which is what scopes it to a team. */
export type ReadContext = { actor: CaringContactActor };

/**
 * Named refusals this layer adds on top of the domain reasons it passes through unchanged
 * (`plan-not-active`, `plan-terminal`, `third-party-withdrawal-refused`, the schedule's
 * `first-contact-out-of-range`, and so on).
 *
 * `notFound` deliberately covers both "no such plan" and "that plan belongs to another team": a
 * cross-team actor must not be able to tell those two apart.
 */
export const REPOSITORY_REFUSALS = Object.freeze({
  notFound: "not-found",
  permissionDenied: "permission-denied",
  staleVersion: "stale-version",
  duplicateActivePlan: "duplicate-active-plan",
  planAlreadyExists: "plan-already-exists",
  idempotencyKeyReused: "idempotency-key-reused-for-a-different-write",
  /**
   * A dispatch may only START while the plan is active. Deliberately checked at the start of a
   * dispatch and nowhere else: once a contact is `processing` the send is committed, and a plan
   * change arriving mid-flight must resolve that one contact rather than strand it in a state the
   * contact lifecycle has no exit from. A death is not carried by this refusal at all -- it cancels
   * every unsent contact outright, so the refusal there is `contact-terminal`.
   */
  contactDispatchRequiresActivePlan: "contact-dispatch-requires-active-plan",
  /**
   * The service-wide safety stop (./service-state) blocks this write. Applied inside `runWrite`
   * itself -- see the in-memory store -- to every mutating method except `stopService`,
   * `approveServiceRestart`, and `recordHospitalStatusEvent`, so no future write can forget the
   * gate by omission.
   */
  serviceStopped: "service-stopped",
  /** A referral id already used by another referral. */
  referralAlreadyExists: "referral-already-exists",
  /** A pathway version id already used by another version. */
  pathwayVersionAlreadyExists: "pathway-version-already-exists",
  /** That attempt's discrepancy already has a recorded resolution; a second one would overwrite it. */
  dispatchDiscrepancyAlreadyResolved: "dispatch-discrepancy-already-resolved",
  /** `resolveDispatchDiscrepancy` requires a non-blank note, the same convention every other named-reason write in this domain uses for free text. */
  dispatchDiscrepancyNoteRequired: "dispatch-discrepancy-note-required",
} as const);

export type RepositoryRefusal = (typeof REPOSITORY_REFUSALS)[keyof typeof REPOSITORY_REFUSALS];

/** What the episode ended as. Held separately from `Plan.state` because it outlives the plan. */
export type PlanOutcome = "inProgress" | "withdrawn" | "cancelled" | "completed";

/**
 * The capability each read surface requires.
 *
 * This is an ACCESS-CONTROL RULE, not a value list, which is why it lives on the contract rather
 * than in either store. Both stores had written their own identical copy — the Postgres one
 * commented "kept identical to the in-memory store on purpose" — so a change to who may read an
 * episode could land in one store and not the other, and the shared contract would only notice if
 * it happened to exercise that surface with that role.
 *
 * Kept as a map rather than inline so every read surface has to name the capability it requires,
 * and a new read cannot default to visible.
 */
export const READ_ACTIONS = Object.freeze({
  plan: "viewReferral",
  contacts: "viewReferral",
  auditTrail: "viewAccessTrail",
  episode: "generateClinicalRecordSummary",
  referral: "viewReferral",
} as const satisfies Record<string, CaringContactAction>);

/** Either governance action reading a pathway version's content is granted by. Same rule, same reason. */
export const PATHWAY_VERSION_READ_ACTIONS: readonly CaringContactAction[] = Object.freeze([
  "authorPathwayVersion",
  "approvePathwayVersion",
]);

/**
 * Whether a plan has ended, and what it ended as.
 *
 * Both were written twice, once per store, over a `TERMINAL_PLAN_STATES` that was itself written
 * three times. They are here rather than in ./model because `PlanOutcome` is a storage projection
 * that outlives the plan, and `outcomeFor` is the one mapping from the lifecycle state to it.
 */
export function isTerminalPlan(state: PlanState): boolean {
  return TERMINAL_PLAN_STATES.includes(state);
}

export function outcomeFor(state: PlanState): PlanOutcome {
  return state === "withdrawn" || state === "cancelled" || state === "completed" ? state : "inProgress";
}

/**
 * What every store writes in place of the patient-identifying detail once a retention clearance is
 * recorded (`markRetentionCleared`).
 *
 * It lives on the contract rather than in either store because the clearance is the one write whose
 * WHOLE meaning is what is no longer held: two stores clearing to two different shapes would be two
 * different answers to "was this episode de-identified", and the contract could only catch the
 * difference where it happened to look. The four fields are exactly ../retention's list — name,
 * mobile number, identifiers, cultural identity — and `Episode` types the first two as `string`
 * rather than `string | null`, so an emptied field is the cleared value.
 */
export const CLEARED_PATIENT_DETAIL: EpisodePatientDetail = Object.freeze({
  patientName: "",
  patientMobileNumber: "",
  patientIdentifiers: Object.freeze([]),
  culturalIdentity: null,
});

/**
 * A stored contact keeps its planned entry verbatim, including the real `sendAt` of an absorbed
 * entry. Sendability is carried by `contact.state`, which is set to the terminal `suppressed` at
 * creation for an absorbed entry — so an absorbed contact is not merely filtered out of a dispatch
 * list, it can never be in one.
 */
export type StoredContact = { contact: Contact; planned: PlannedContact };

/** What a read returns. Deliberately carries no patient-identifying detail — see `getEpisode`. */
export type PlanRecord = {
  plan: Plan;
  patientId: PatientId;
  referralId: ReferralId;
  pathwayVersionId: PathwayVersionId;
  dischargeAt: Date;
  /** The instant the plan reached a terminal state; null while it is still open. */
  completedAt: Date | null;
  outcome: PlanOutcome;
  contacts: readonly StoredContact[];
};

/** What the datastore holds. The patient detail is released only through `getEpisode`. */
export type StoredPlan = PlanRecord & { patientDetail: EpisodePatientDetail };

export type CreatePlanInput = {
  planId: PlanId;
  referralId: ReferralId;
  patientId: PatientId;
  pathwayVersionId: PathwayVersionId;
  dischargeAt: Date;
  sendingPreference: SendingPreference;
  firstContactDate?: string;
  firstContactReason?: string;
  patientDetail: EpisodePatientDetail;
};

export type PlanLifecycleInput = { planId: PlanId; expectedVersion: number };
export type WithdrawPlanInput = PlanLifecycleInput & { origin: WithdrawalOrigin };
export type HospitalStatusInput = PlanLifecycleInput & { event: HospitalStatusEvent };

export type HospitalStatusOutcome = {
  record: PlanRecord;
  exceptions: readonly PlanException[];
  incident?: PlanIncident;
  /** How many stored contacts this event cancelled outright. */
  contactsCancelled: number;
};

/**
 * An additional append-only destination for audit events — an external trail, for instance. It is
 * called inside the write, before anything is committed: if it throws, the change is abandoned,
 * because a change nobody can prove happened is worse than a change refused.
 */
export type AuditSink = { record(event: AuditEvent): void | Promise<void> };

/**
 * A contact-status write. It states the contact version it expected for the same reason a plan
 * write does: two dispatchers racing the same contact must not both believe they started it.
 */
export type ContactStatusInput = { planId: PlanId; contactId: ContactId; expectedContactVersion: number };

export type ContactProviderStatusInput = ContactStatusInput & { status: ProviderStatus };

export type RepositoryOptions = { auditSink?: AuditSink };

export type CreateReferralInput = { referralId: ReferralId; patientId: PatientId };
export type ReferralTransitionInput = { referralId: ReferralId; action: ReferralAction };
export type SavePathwayVersionInput = { version: PathwayVersion };
export type PathwayVersionTransitionInput = { pathwayVersionId: PathwayVersionId; action: PathwayVersionAction };

/**
 * One recorded dispatch attempt for one contact, the reconciliation surface between what the
 * dispatcher expected and what the provider reported. `discrepancyResolution` is null until
 * `resolveDispatchDiscrepancy` records one, and `unresolvedNoResend` is as final an answer as
 * `confirmedDelivered` -- there is no method anywhere in this contract that re-dispatches a
 * contact whose status is uncertain.
 */
export type DispatchRecord = {
  contactId: ContactId;
  planId: PlanId;
  attempt: number;
  startedAt: Date;
  expectedStatus: ProviderStatus | null;
  reportedStatus: ProviderStatus | null;
  discrepancyResolvedAt: Date | null;
  discrepancyResolution: DispatchDiscrepancyResolution | null;
};
export type DispatchDiscrepancyResolution = "confirmedDelivered" | "confirmedNotDelivered" | "unresolvedNoResend";
export type ResolveDiscrepancyInput = {
  contactId: ContactId;
  attempt: number;
  resolution: DispatchDiscrepancyResolution;
  note: string;
};
export type AccessTrailQuery = {
  fromIso?: string;
  toIso?: string;
  actorId?: ActorId;
  objectType?: AccessedObjectType;
  limit: number;
  offset: number;
};

export interface CaringContactRepository {
  createPlan(input: CreatePlanInput, context: WriteContext): Promise<TransitionResult<PlanRecord>>;
  activatePlan(input: PlanLifecycleInput, context: WriteContext): Promise<TransitionResult<PlanRecord>>;
  pausePlan(input: PlanLifecycleInput, context: WriteContext): Promise<TransitionResult<PlanRecord>>;
  resumePlan(input: PlanLifecycleInput, context: WriteContext): Promise<TransitionResult<PlanRecord>>;
  withdrawPlan(input: WithdrawPlanInput, context: WriteContext): Promise<TransitionResult<PlanRecord>>;
  recordHospitalStatusEvent(
    input: HospitalStatusInput,
    context: WriteContext,
  ): Promise<TransitionResult<HospitalStatusOutcome>>;

  /**
   * The dispatch path. Four separate writes rather than one, because each is a distinct fact with
   * its own audit record: the send was begun, the message left, the provider said what happened,
   * or the window closed without a send. Every one of them is a system-actor capability; no human
   * role is granted any of them, so a delivery receipt cannot be written by hand.
   */
  startContactDispatch(input: ContactStatusInput, context: WriteContext): Promise<TransitionResult<StoredContact>>;
  recordContactSent(input: ContactStatusInput, context: WriteContext): Promise<TransitionResult<StoredContact>>;
  recordContactProviderStatus(
    input: ContactProviderStatusInput,
    context: WriteContext,
  ): Promise<TransitionResult<StoredContact>>;
  recordContactMissed(input: ContactStatusInput, context: WriteContext): Promise<TransitionResult<StoredContact>>;

  /**
   * Moves a contact within its scheduled day, or changes its date with team-lead approval --
   * Task 7's `moveContactWithinDay` / `changeContactDate` given somewhere to persist. Refuses the
   * exact reasons those functions do, unchanged; adds `notFound`, `permissionDenied`, and
   * `staleVersion` on top, the same as every other contact-status write.
   */
  rescheduleContact(
    input: {
      planId: PlanId;
      contactId: ContactId;
      expectedContactVersion: number;
      change: ContactMoveRequest | ContactDateChangeRequest;
    },
    context: WriteContext,
  ): Promise<TransitionResult<StoredContact>>;

  // Referrals
  createReferral(input: CreateReferralInput, context: WriteContext): Promise<TransitionResult<Referral>>;
  transitionReferral(input: ReferralTransitionInput, context: WriteContext): Promise<TransitionResult<Referral>>;
  listReferrals(context: ReadContext): Promise<Referral[]>;

  // Pathway versions
  savePathwayVersion(input: SavePathwayVersionInput, context: WriteContext): Promise<TransitionResult<PathwayVersion>>;
  transitionPathwayVersion(
    input: PathwayVersionTransitionInput,
    context: WriteContext,
  ): Promise<TransitionResult<PathwayVersion>>;
  getPathwayVersion(id: PathwayVersionId, context: ReadContext): Promise<PathwayVersion | null>;
  listPathwayVersions(context: ReadContext): Promise<PathwayVersion[]>;

  // Service state
  /**
   * The one service-wide record -- never one per team. Visible unconditionally to every actor of
   * every team: the whole point of the singleton is that a stop raised by one team's actor blocks
   * dispatch for every other team's plans too, and the banner it feeds must render on every
   * screen, including ones with no patient in view at all.
   */
  getServiceState(context: ReadContext): Promise<ServiceState>;
  stopService(
    input: { reason: ServiceStopReason; note: string },
    context: WriteContext,
  ): Promise<TransitionResult<ServiceState>>;
  /**
   * Ruling 65: returns `ServiceRestartOutcome`, NOT the record. Restart approvals are service-wide,
   * so the approver may sit outside the reporting team, and every store persists a write's return
   * value as its replay result -- under the APPROVING team's id. Returning the record put the
   * reporting team's incident note in a row that team could read. The narrow type removes it from
   * the reply and from storage together, and a replay stays truthful because the original answer
   * never carried it either.
   */
  approveServiceRestart(
    input: { role: ServiceRestartApprovalRole },
    context: WriteContext,
  ): Promise<TransitionResult<ServiceRestartOutcome>>;

  // Assignment
  getAssignment(planId: PlanId, context: ReadContext): Promise<PlanAssignment | null>;
  applyAssignment(
    input: { planId: PlanId; action: AssignmentAction },
    context: WriteContext,
  ): Promise<TransitionResult<PlanAssignment>>;

  // Reconciliation
  listDispatches(input: { fromIso: string; toIso: string }, context: ReadContext): Promise<DispatchRecord[]>;
  /** Never resends. `unresolvedNoResend` is as final an outcome as any other -- see `DispatchRecord`. */
  resolveDispatchDiscrepancy(
    input: ResolveDiscrepancyInput,
    context: WriteContext,
  ): Promise<TransitionResult<DispatchRecord>>;

  // Access trail
  /**
   * Records a view/search/export/administrative access. No `WriteContext` -- the caller already
   * knows who is accessing what, `AccessRecord` carries it, and this is a best-effort append with
   * no refusal to report: recording that "every search, view, decision, mutation, write-back and
   * administrative access" happened must not itself be blockable by the service safety stop, or
   * the trail would go dark for exactly the incidents (including `audit-integrity-loss`) it exists
   * to prove happened.
   */
  recordAccess(record: AccessRecord): Promise<void>;
  listAccessTrail(input: AccessTrailQuery, context: ReadContext): Promise<AuditEvent[]>;

  // Preferences, training, retention
  getNotificationPreferences(context: ReadContext): Promise<NotificationPreferences>;
  saveNotificationPreferences(
    input: NotificationPreferences,
    context: WriteContext,
  ): Promise<TransitionResult<NotificationPreferences>>;
  getTrainingRecord(context: ReadContext): Promise<TrainingRecord>;
  recordTrainingCompetency(
    input: { competency: TrainingCompetency },
    context: WriteContext,
  ): Promise<TransitionResult<TrainingRecord>>;
  markRetentionCleared(input: { planId: PlanId }, context: WriteContext): Promise<TransitionResult<void>>;

  /** Null for a plan that does not exist AND for one belonging to another team. */
  getPlan(planId: PlanId, context: ReadContext): Promise<PlanRecord | null>;
  listPlans(context: ReadContext): Promise<PlanRecord[]>;
  listContacts(planId: PlanId, context: ReadContext): Promise<StoredContact[]>;
  /** The contacts that may actually go out. Keyed off contact state, never off `sendAt`. */
  listSendableContacts(planId: PlanId, context: ReadContext): Promise<StoredContact[]>;
  listAuditEvents(context: ReadContext): Promise<AuditEvent[]>;
  getEpisode(planId: PlanId, context: ReadContext): Promise<Episode | null>;
}

/**
 * Every store in this domain is built this way, so one contract suite can run against all of them.
 * Task 11's Postgres store returns a promise here; the in-memory store returns directly.
 */
export type CaringContactRepositoryFactory = (
  clock: Clock,
  options?: RepositoryOptions,
) => CaringContactRepository | Promise<CaringContactRepository>;

/** Deterministic contact identifier, so the same plan always produces the same contact ids. */
export function contactIdentifierFor(planId: PlanId, sequence: number): string {
  return `${planId}--contact-${sequence}`;
}
