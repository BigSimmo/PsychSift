/**
 * Care Plan — the pure lifecycle reducer.
 *
 * `prototypeReducer` is a plain `(state, action) => state` function. It reads no
 * clock, network, storage, browser API, or random source, and it holds no
 * module-level mutable state: every timestamp is derived from `PROTOTYPE_NOW`
 * and every identifier from the identifiers already in the state it was given,
 * so the same action sequence always produces the same state byte for byte.
 *
 * The reducer is the final guard, not the interface. Every changing action
 * rechecks the acting role through `canPerformAction` and every degraded state
 * through `getPrototypeMutationBlockReason`, so a control that should never have
 * been offered still cannot change a clinical record. Nothing here mutates an
 * array or an object in place; every change replaces the whole value.
 *
 * Australian English, `en-AU`, `Australia/Perth`, ISO source timestamps.
 */

import {
  addIsoMonths,
  assertSingleCurrentVersion,
  canPerformAction,
  getCurrentManagementPlanVersion,
  getCurrentPatientPlanVersion,
  getCurrentSafetyPlanVersion,
  getEffectivePresentationValue,
  getOpenManagementDraft,
  getOpenPatientPlanDraft,
} from "./domain";
import { getPatientResources, syntheticPatientResources } from "./patient-plan-fixtures";
import { buildPatientPlanDraft, unfilledGapSections } from "./patient-plan-transform";
import {
  PROTOTYPE_NOW,
  identificationPolicy,
  syntheticCmhtContacts,
  syntheticEdPresentations,
  syntheticEdSites,
  syntheticIdentificationReviews,
  syntheticManagementPlanVersions,
  syntheticManagementPlans,
  syntheticPatients,
  syntheticPersonalSafetyPlanVersions,
  syntheticPersonalSafetyPlans,
  syntheticPresentationAmendments,
  syntheticReviewTriggers,
  syntheticUsers,
} from "./fixtures";
import {
  MANAGEMENT_PLAN_REQUIRED_CONTENT_KEYS,
  REVIEW_INTERVAL_MONTHS,
  type AmendableField,
  type AuditEvent,
  type AuditEventType,
  type CarePlanPrototypeAction,
  type CarePlanPrototypeState,
  type CmhtContact,
  type Disposition,
  type EdPresentation,
  type EdSite,
  type IdentificationDecision,
  type IdentificationPolicy,
  type IdentificationReview,
  type ManagementPlan,
  type ManagementPlanContent,
  type ManagementPlanVersion,
  type Patient,
  type PatientPlan,
  type PatientPlanVersion,
  type PatientResource,
  type PersonalSafetyPlan,
  type PersonalSafetyPlanVersion,
  type PlanAvailability,
  type PlanHelpfulness,
  type PlanUse,
  type PresentationAmendment,
  type PrototypeCapability,
  type PrototypeOutcome,
  type PrototypeRole,
  type PrototypeScenario,
  type PrototypeUser,
  type ReviewTrigger,
  type SafetyPlanContent,
  type SyntheticId,
} from "./types";

// --- Deterministic clock and identifiers --------------------------------------

const PERTH_OFFSET_SUFFIX = "+08:00";
const MILLISECONDS_PER_MINUTE = 60_000;
const PERTH_OFFSET_MILLISECONDS = 8 * 60 * MILLISECONDS_PER_MINUTE;

/** Australia/Perth never observes daylight saving, so a fixed offset is exact. */
function addIsoMinutes(iso: string, minutes: number): string {
  const shifted = new Date(Date.parse(iso) + PERTH_OFFSET_MILLISECONDS + minutes * MILLISECONDS_PER_MINUTE);
  return `${shifted.toISOString().slice(0, 19)}${PERTH_OFFSET_SUFFIX}`;
}

/**
 * The prototype clock. `PROTOTYPE_NOW` advanced by one minute for every audit
 * event already recorded, plus a stable offset for each further record the same
 * action appends. It is a function of the state it is given, so it never reads a
 * wall clock and never returns the same timestamp twice in one sequence.
 */
function prototypeTimestamp(state: CarePlanPrototypeState, offsetMinutes = 0): string {
  return addIsoMinutes(PROTOTYPE_NOW, state.auditEvents.length + 1 + offsetMinutes);
}

/**
 * The next identifier in a `SYN-` series, derived from the identifiers already
 * present. Deterministic by construction: no counter, clock, or random source.
 */
export function nextSyntheticId(prefix: string, existingIds: readonly string[]): SyntheticId {
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  const highest = existingIds.reduce((largest, id) => {
    const matched = pattern.exec(id);
    return matched === null ? largest : Math.max(largest, Number(matched[1]));
  }, 0);
  return `${prefix}-${String(highest + 1).padStart(3, "0")}` as SyntheticId;
}

export function nextPresentationId(state: CarePlanPrototypeState): SyntheticId {
  return nextSyntheticId(
    "SYN-PRESENTATION",
    state.edPresentations.map(({ id }) => id),
  );
}

// --- Initial state -------------------------------------------------------------

/**
 * Every value in the state tree is plain JSON, so a round trip is an exact and
 * obviously deterministic copy. Copying rather than sharing matters here: two
 * versions of one clinical record must never share the array a later in-place
 * edit could reach through.
 */
function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneFixtures<T>(values: readonly T[]): T[] {
  return JSON.parse(JSON.stringify(values)) as T[];
}

/**
 * Which synthetic patient each specimen scenario opens on, so the scenario name
 * describes what is actually on screen. Rowan is the default: a Current Plan
 * that is within review.
 */
const SCENARIO_PATIENT: Record<PrototypeScenario, SyntheticId | null> = {
  normal: "SYN-PATIENT-001",
  empty: null,
  "no-current-plan": "SYN-PATIENT-003",
  "overdue-plan": "SYN-PATIENT-002",
  "withdrawn-plan": "SYN-PATIENT-004",
  "unverified-contact": "SYN-PATIENT-003",
  // A record is selected so the interface has something to refuse to show. The
  // uncertainty flag is what stops a nearby person's plan being displayed.
  "identity-uncertain": "SYN-PATIENT-001",
  "version-conflict": "SYN-PATIENT-002",
  offline: "SYN-PATIENT-001",
  "permission-unavailable": "SYN-PATIENT-001",
  "launch-failure": "SYN-PATIENT-001",
  "print-failure": "SYN-PATIENT-001",
};

/**
 * The deterministic starting world. It deep-clones the fixtures so nothing in a
 * session can reach back and change them, and derives the four degraded-state
 * flags from the scenario without reading a browser API.
 *
 * The Patient Plan collections start empty. A Patient Plan is produced from an
 * approved Management Plan Version when somebody makes one; inventing fixture
 * editions here would put patient-facing wording on the record that nobody
 * wrote. The resource catalogue is not an edition of anything, so it is seeded:
 * it is the list a clinician chooses from, and an empty one would mean every
 * patient copy started with nothing to offer.
 */
export function createInitialPrototypeState(scenario: PrototypeScenario = "normal"): CarePlanPrototypeState {
  return {
    scenario,
    persistence: "memory-only",
    activeUserId: "SYN-USER-ED-001",
    selectedPatientId: SCENARIO_PATIENT[scenario],
    connectivity: { online: scenario !== "offline" },
    permission: { available: scenario !== "permission-unavailable" },
    identity: { certain: scenario !== "identity-uncertain" },
    versionConflict: { active: scenario === "version-conflict" },
    users: cloneFixtures<PrototypeUser>(syntheticUsers),
    patients: cloneFixtures<Patient>(syntheticPatients),
    edSites: cloneFixtures<EdSite>(syntheticEdSites),
    cmhtContacts: cloneFixtures<CmhtContact>(syntheticCmhtContacts),
    managementPlans: cloneFixtures<ManagementPlan>(syntheticManagementPlans),
    managementPlanVersions: cloneFixtures<ManagementPlanVersion>(syntheticManagementPlanVersions),
    personalSafetyPlans: cloneFixtures<PersonalSafetyPlan>(syntheticPersonalSafetyPlans),
    personalSafetyPlanVersions: cloneFixtures<PersonalSafetyPlanVersion>(syntheticPersonalSafetyPlanVersions),
    patientPlans: [],
    patientPlanVersions: [],
    patientResources: cloneFixtures<PatientResource>(syntheticPatientResources),
    edPresentations: cloneFixtures<EdPresentation>(syntheticEdPresentations),
    presentationAmendments: cloneFixtures<PresentationAmendment>(syntheticPresentationAmendments),
    reviewTriggers: cloneFixtures<ReviewTrigger>(syntheticReviewTriggers),
    identificationPolicy: cloneJson<IdentificationPolicy>(identificationPolicy),
    identificationReviews: cloneFixtures<IdentificationReview>(syntheticIdentificationReviews),
    auditEvents: [],
    lastOutcome: null,
  };
}

// --- Permission and degraded-state guard ---------------------------------------

const ROLE_LABEL: Record<PrototypeRole, string> = {
  ed_clinician: "emergency department clinician",
  liaison_clinician: "emergency department mental health liaison clinician",
  cmht_clinician: "community mental health team clinician",
  senior_clinician: "named senior clinician",
  plan_coordinator: "care planning coordinator",
};

/**
 * The capability each action needs. `null` means the action changes no clinical
 * record — choosing who is signed in, which record is open, or which specimen
 * scenario is displayed — so it carries no permission or degraded-state gate.
 */
const CAPABILITY_BY_ACTION: Record<CarePlanPrototypeAction["type"], PrototypeCapability | null> = {
  "select-patient": null,
  "set-active-user": null,
  "create-management-draft": "author_management_draft",
  "save-management-draft": "author_management_draft",
  "submit-management-draft": "submit_management_draft",
  "return-management-version": "approve_management_version",
  "approve-management-version": "approve_management_version",
  "withdraw-current-management-version": "withdraw_management_version",
  "record-formal-management-review": "record_formal_review",
  // Showing someone their own plan is something any role that may read the plan
  // can do at a bedside; recording that it happened is the same event written
  // down. Gating it to the authoring roles would leave the commonest person to
  // actually do it — the clinician in front of the patient — unable to say so.
  "record-plan-shared-with-patient": "read_plan",
  "record-presentation": "record_presentation",
  "amend-presentation": "record_presentation",
  "create-safety-plan-draft": "author_safety_plan",
  "save-safety-plan-draft": "author_safety_plan",
  "make-safety-plan-current": "author_safety_plan",
  // Writing the patient copy and approving it carry the same capability, which
  // every clinical role holds and the non-clinical plan coordinator does not.
  // Approval deliberately does not need a senior clinician: requiring one would
  // mean a person waits days for their own copy of their own plan.
  "create-patient-plan-draft": "approve_patient_plan",
  "save-patient-plan-draft": "approve_patient_plan",
  "approve-patient-plan-version": "approve_patient_plan",
  "record-patient-plan-print-intent": "read_plan",
  "record-safety-plan-print-intent": "read_plan",
  "record-management-plan-print-intent": "read_plan",
  "record-contact-intent": "contact_cmht",
  "create-identification-review": "refer_for_identification_review",
  "close-identification-review": "close_identification_review",
  "verify-cmht-contact": "verify_cmht_contact",
  "resolve-review-trigger": "manage_worklists",
  "apply-scenario": null,
  "clear-outcome": null,
  reset: null,
};

/**
 * Both print intents. Printing is the single action you most want available when
 * systems are down, and it appends an audit event rather than changing any
 * clinical record — and both of those are properties of the action, not of which
 * document it happens to print.
 *
 * This list named only the Personal Safety Plan until Task 5, because that was
 * the only print route in existence when the exemption was written. Narrowing
 * the rule to the document it happened to name would have made two identical
 * operations diverge, and in the worse direction: the browser print dialogue
 * opens either way, so a refused Management Plan print meant paper could leave
 * the building while `auditEvents` said nothing had happened and the reader was
 * told the device was offline and nothing was changed. An application's own
 * account of itself must not underclaim what it did.
 *
 * Connectivity is the only block either intent skips. Printing the wrong
 * person's plan is a real harm, so identity uncertainty, unavailable permission,
 * and a version conflict all still apply to both.
 */
const CONNECTIVITY_EXEMPT_ACTIONS: readonly CarePlanPrototypeAction["type"][] = [
  "record-safety-plan-print-intent",
  "record-management-plan-print-intent",
  "record-patient-plan-print-intent",
];

/**
 * The single funnel every changing action passes through, so no transition can
 * reach a clinical record without being rechecked here. Each refusal names
 * itself, so the interface can say what happened, what it means, and what is
 * available, and every one of them leaves the clinical record untouched.
 *
 * Returns the reason the action cannot proceed, or `null` when it may.
 */
export function getPrototypeMutationBlockReason(
  state: CarePlanPrototypeState,
  action: CarePlanPrototypeAction,
): string | null {
  const capability = CAPABILITY_BY_ACTION[action.type];
  if (capability === null) return null;

  if (!state.connectivity.online && !CONNECTIVITY_EXEMPT_ACTIONS.includes(action.type)) {
    return "This device is offline, so nothing was changed. What is shown is the last synthetic state held in memory.";
  }
  if (!state.permission.available) {
    return "Permission for this action could not be confirmed, so nothing was changed.";
  }
  if (!state.identity.certain) {
    return "This record has not been confirmed as the right person, so nothing was changed. Return to search and choose the record again.";
  }
  if (state.versionConflict.active) {
    return "A newer version of this record exists in the synthetic prototype, so nothing was changed. Compare the two versions before deciding.";
  }

  const actor = state.users.find(({ id }) => id === state.activeUserId) ?? null;
  if (actor === null) {
    return "No synthetic user is selected, so no action can be attributed and nothing was changed.";
  }
  if (!canPerformAction(actor.role, capability)) {
    return `${actor.displayName} is signed in with the ${ROLE_LABEL[actor.role]} role, which does not carry this action. Nothing was changed.`;
  }
  return null;
}

// --- Small shared helpers -------------------------------------------------------

function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

/** Free text a clinician typed, placed inside an audit sentence. Without this
 *  a reason with no full stop runs straight into the sentence after it. */
function asSentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function isParsableTimestamp(value: string): boolean {
  return !isBlank(value) && !Number.isNaN(Date.parse(value));
}

function refuse(
  state: CarePlanPrototypeState,
  message: string,
  kind: PrototypeOutcome["kind"] = "error",
): CarePlanPrototypeState {
  return { ...state, lastOutcome: { kind, message } };
}

type AuditDraft = {
  type: AuditEventType;
  patientId: SyntheticId | null;
  objectId: SyntheticId;
  evidence: string;
};

/**
 * Appends one attributed audit event. `evidence` describes only what this
 * application actually did — never that a message reached anyone, that a call
 * was answered, or that a page was printed.
 */
function withAudit(state: CarePlanPrototypeState, draft: AuditDraft, offsetMinutes = 0): AuditEvent[] {
  return [
    ...state.auditEvents,
    {
      id: nextSyntheticId(
        "SYN-AUDIT",
        state.auditEvents.map(({ id }) => id),
      ),
      type: draft.type,
      patientId: draft.patientId,
      objectId: draft.objectId,
      actorId: state.activeUserId,
      occurredAt: prototypeTimestamp(state, offsetMinutes),
      evidence: draft.evidence,
    },
  ];
}

function findPatient(state: CarePlanPrototypeState, patientId: SyntheticId): Patient | null {
  return state.patients.find(({ id }) => id === patientId) ?? null;
}

function findManagementPlan(state: CarePlanPrototypeState, patient: Patient): ManagementPlan | null {
  return state.managementPlans.find(({ id }) => id === patient.managementPlanId) ?? null;
}

function findSafetyPlan(state: CarePlanPrototypeState, patient: Patient): PersonalSafetyPlan | null {
  return state.personalSafetyPlans.find(({ id }) => id === patient.personalSafetyPlanId) ?? null;
}

function patientOfManagementPlan(state: CarePlanPrototypeState, planId: SyntheticId): SyntheticId | null {
  return state.managementPlans.find(({ id }) => id === planId)?.patientId ?? null;
}

function patientOfSafetyPlan(state: CarePlanPrototypeState, planId: SyntheticId): SyntheticId | null {
  return state.personalSafetyPlans.find(({ id }) => id === planId)?.patientId ?? null;
}

function patientOfPatientPlan(state: CarePlanPrototypeState, planId: SyntheticId): SyntheticId | null {
  return state.patientPlans.find(({ id }) => id === planId)?.patientId ?? null;
}

/**
 * The person's Patient Plan record, or a new empty one.
 *
 * Unlike the Management Plan and the Personal Safety Plan, a Patient Plan record
 * is not seeded per patient in the fixtures. Inventing fixture editions would
 * have put patient-facing wording on the record that nobody wrote, so the plan
 * record comes into existence the first time somebody actually makes a copy.
 * The caller adds it to the state; this only decides its identity.
 */
function findOrCreatePatientPlan(state: CarePlanPrototypeState, patient: Patient): PatientPlan {
  const existing = state.patientPlans.find((plan) => plan.patientId === patient.id) ?? null;
  if (existing !== null) return existing;
  return {
    id: nextSyntheticId(
      "SYN-PATIENT-PLAN",
      state.patientPlans.map(({ id }) => id),
    ),
    patientId: patient.id,
    versionIds: [],
    currentVersionId: null,
  };
}

function nextVersionNumber(versions: readonly { planId: SyntheticId; version: number }[], planId: SyntheticId): number {
  return (
    versions
      .filter((version) => version.planId === planId)
      .reduce((highest, { version }) => Math.max(highest, version), 0) + 1
  );
}

const EMPTY_MANAGEMENT_CONTENT: ManagementPlanContent = {
  howToApproach: [],
  whatHelps: [],
  whatMakesItWorse: [],
  agreedEdApproach: [],
  whatWouldMakeThisDifferent: [],
  whyThisPlanExists: "",
  whatThePersonWants: [],
  practicalNeeds: [],
  physicalHealthAndMedication: [],
  whoElseIsInvolved: [],
  reviewTriggers: [],
};

const EMPTY_SAFETY_CONTENT: SafetyPlanContent = {
  warningSigns: [],
  saferSurroundings: [],
  reasonsForLiving: [],
  selfStrategies: [],
  connectionPeopleAndPlaces: [],
  personalSupports: [],
  professionalAndEmergencySupport: [],
};

function missingRequiredContentKeys(content: ManagementPlanContent): string[] {
  return MANAGEMENT_PLAN_REQUIRED_CONTENT_KEYS.filter((key) => {
    const value = content[key];
    return typeof value === "string" ? isBlank(value) : !value.some((line) => !isBlank(line));
  });
}

const DISPOSITIONS: readonly Disposition[] = [
  "discharged_home",
  "short_stay",
  "mental_health_admission",
  "medical_admission",
  "transfer",
  "left_before_completion",
  "other",
];
const PLAN_AVAILABILITIES: readonly PlanAvailability[] = ["available", "unavailable", "not_applicable"];
const PLAN_USES: readonly PlanUse[] = ["used", "partially_used", "not_used", "not_applicable"];
const PLAN_HELPFULNESS_VALUES: readonly PlanHelpfulness[] = ["helpful", "mixed", "not_helpful", "not_assessed"];
const IDENTIFICATION_DECISIONS: readonly IdentificationDecision[] = [
  "proceed_to_plan",
  "not_needed_now",
  "revisit_later",
];

const AMENDABLE_FIELDS: readonly AmendableField[] = [
  "assessmentOutcome",
  "disposition",
  "note",
  "planAvailability",
  "planUse",
  "planHelpfulness",
];

/** The amendable fields whose replacement must parse to a recorded answer. The
 *  two free-text fields are absent because any prose is a legitimate correction. */
const AMENDABLE_FIELD_ANSWERS: Partial<Record<AmendableField, readonly string[]>> = {
  disposition: DISPOSITIONS,
  planAvailability: PLAN_AVAILABILITIES,
  planUse: PLAN_USES,
  planHelpfulness: PLAN_HELPFULNESS_VALUES,
};

/**
 * The value a correction is replacing: the latest amendment for that field when
 * the field has already been corrected, otherwise the recorded original. The
 * episode itself is never rewritten, so the stored original always survives.
 *
 * The rule lives in `domain.ts` because the reading surfaces need the same
 * answer. A second private copy here would be free to drift, and a drift would
 * mean a correction refused as a no-op against a value the screen never showed.
 */
function effectiveFieldValue(
  state: CarePlanPrototypeState,
  presentation: EdPresentation,
  field: AmendableField,
): string {
  return getEffectivePresentationValue(state.presentationAmendments, presentation, field);
}

/**
 * Whether one episode gives the team a reason to reconsider the Current Plan,
 * and what to record as that reason. A trigger never changes a plan; it asks a
 * person to look. The first matching reason wins, so one episode raises at most
 * one trigger.
 */
function reviewTriggerReasonFor(
  presentation: EdPresentation,
): { source: ReviewTrigger["source"]; reason: string } | null {
  if (presentation.reviewSuggested && presentation.reviewReason !== null && !isBlank(presentation.reviewReason)) {
    return { source: "plan_use_feedback", reason: presentation.reviewReason.trim() };
  }
  if (presentation.planHelpfulness === "not_helpful") {
    return {
      source: "plan_use_feedback",
      reason:
        "The plan-use feedback recorded for this episode says the Current Plan did not help. The team should look at whether it still describes what happens.",
    };
  }
  if (presentation.planHelpfulness === "mixed") {
    return {
      source: "plan_use_feedback",
      reason:
        "The plan-use feedback recorded for this episode says the Current Plan helped only in part. The team should look at whether it still describes what happens.",
    };
  }
  if (
    presentation.deviationOccurred &&
    presentation.deviationReason !== null &&
    !isBlank(presentation.deviationReason)
  ) {
    return { source: "plan_deviation", reason: presentation.deviationReason.trim() };
  }
  if (presentation.disposition === "mental_health_admission" || presentation.disposition === "medical_admission") {
    return {
      source: "presentation_outcome",
      reason:
        "This episode ended in an admission. The team should check whether the Current Plan still describes what happens.",
    };
  }
  return null;
}

// --- The reducer ----------------------------------------------------------------

export function prototypeReducer(
  state: CarePlanPrototypeState,
  action: CarePlanPrototypeAction,
): CarePlanPrototypeState {
  const blocked = getPrototypeMutationBlockReason(state, action);
  if (blocked !== null) return refuse(state, blocked, "blocked");

  switch (action.type) {
    case "select-patient": {
      const patient = findPatient(state, action.patientId);
      if (patient === null) return refuse(state, "That synthetic patient record does not exist.");
      return { ...state, selectedPatientId: patient.id, lastOutcome: null };
    }

    case "set-active-user": {
      const user = state.users.find(({ id }) => id === action.userId) ?? null;
      if (user === null) return refuse(state, "That synthetic user does not exist.");
      return { ...state, activeUserId: user.id, lastOutcome: null };
    }

    case "create-management-draft": {
      const patient = findPatient(state, action.patientId);
      if (patient === null) return refuse(state, "That synthetic patient record does not exist.");
      const plan = findManagementPlan(state, patient);
      if (plan === null) {
        return refuse(state, `${patient.preferredName} has no Management Plan record to add a version to.`);
      }
      if (getOpenManagementDraft(state.managementPlanVersions, plan.id) !== null) {
        return refuse(
          state,
          `A version of ${patient.preferredName}'s Management Plan is already open for editing or awaiting approval. Continue that one rather than starting another.`,
        );
      }

      const current = getCurrentManagementPlanVersion(state.managementPlanVersions, plan.id);
      const createdAt = prototypeTimestamp(state);
      const draft: ManagementPlanVersion = {
        id: nextSyntheticId(
          "SYN-MGMT-VERSION",
          state.managementPlanVersions.map(({ id }) => id),
        ),
        planId: plan.id,
        version: nextVersionNumber(state.managementPlanVersions, plan.id),
        state: "draft",
        authorId: state.activeUserId,
        ownerId: state.activeUserId,
        approverId: null,
        createdAt,
        submittedAt: null,
        approvedAt: null,
        reviewDueAt: addIsoMonths(createdAt, REVIEW_INTERVAL_MONTHS),
        revisionReason: "",
        // Nobody has recorded this person's part in this edition yet. Saying they
        // took part would put an unearned statement on the record, so the draft
        // starts at the answer that carries the visible marker until an author
        // replaces it with what actually happened.
        participationState: "patient_unavailable",
        consentedSupportPeople: [],
        returnedReason: null,
        withdrawalReason: null,
        withdrawnBy: null,
        withdrawnAt: null,
        sharedWithPatientAt: null,
        content: cloneJson(current === null ? EMPTY_MANAGEMENT_CONTENT : current.content),
      };

      return {
        ...state,
        managementPlanVersions: [...state.managementPlanVersions, draft],
        managementPlans: state.managementPlans.map((candidate) =>
          candidate.id === plan.id ? { ...candidate, versionIds: [...candidate.versionIds, draft.id] } : candidate,
        ),
        auditEvents: withAudit(state, {
          type: "management_draft_created",
          patientId: patient.id,
          objectId: draft.id,
          evidence:
            current === null
              ? `Draft version ${draft.version} started from an empty Management Plan.`
              : `Draft version ${draft.version} started from the content of Current Plan version ${current.version}.`,
        }),
        lastOutcome: {
          kind: "success",
          message: `Draft version ${draft.version} created. The Current Plan is unchanged and is still the version in use.`,
        },
      };
    }

    case "save-management-draft": {
      const version = state.managementPlanVersions.find(({ id }) => id === action.versionId) ?? null;
      if (version === null) return refuse(state, "That Management Plan Version does not exist.");
      if (version.state !== "draft") {
        return refuse(
          state,
          version.state === "awaiting_approval"
            ? `Version ${version.version} is awaiting approval and read-only. Nothing was changed.`
            : `Version ${version.version} is ${version.state} and can no longer be edited. Nothing was changed.`,
        );
      }
      if (!isParsableTimestamp(action.input.reviewDueAt)) {
        return refuse(
          state,
          "The next review date could not be read as a date, so nothing was saved. A date that cannot be read shows as overdue and tells a reader nothing.",
        );
      }
      if (!state.users.some(({ id }) => id === action.input.ownerId)) {
        return refuse(state, "The named plan owner is not a synthetic user in this prototype, so nothing was saved.");
      }

      const saved: ManagementPlanVersion = {
        ...version,
        ownerId: action.input.ownerId,
        reviewDueAt: action.input.reviewDueAt,
        revisionReason: action.input.revisionReason,
        participationState: action.input.participationState,
        consentedSupportPeople: [...action.input.consentedSupportPeople],
        content: cloneJson(action.input.content),
      };

      return {
        ...state,
        managementPlanVersions: state.managementPlanVersions.map((candidate) =>
          candidate.id === saved.id ? saved : candidate,
        ),
        auditEvents: withAudit(state, {
          type: "management_draft_saved",
          patientId: patientOfManagementPlan(state, version.planId),
          objectId: saved.id,
          evidence: `Draft version ${saved.version} saved. Next review date recorded as ${saved.reviewDueAt}.`,
        }),
        lastOutcome: {
          kind: "success",
          message: `Draft version ${saved.version} saved. It is not approved for use.`,
        },
      };
    }

    case "submit-management-draft": {
      const version = state.managementPlanVersions.find(({ id }) => id === action.versionId) ?? null;
      if (version === null) return refuse(state, "That Management Plan Version does not exist.");
      if (version.state !== "draft") {
        return refuse(
          state,
          `Only a Draft can be submitted for approval. Version ${version.version} is ${version.state}.`,
        );
      }

      const submitted: ManagementPlanVersion = {
        ...version,
        state: "awaiting_approval",
        submittedAt: prototypeTimestamp(state),
        returnedReason: null,
      };

      return {
        ...state,
        managementPlanVersions: state.managementPlanVersions.map((candidate) =>
          candidate.id === submitted.id ? submitted : candidate,
        ),
        auditEvents: withAudit(state, {
          type: "management_version_submitted",
          patientId: patientOfManagementPlan(state, version.planId),
          objectId: submitted.id,
          evidence: `Version ${submitted.version} submitted for senior-clinician approval.`,
        }),
        lastOutcome: {
          kind: "success",
          message: `Version ${submitted.version} submitted for approval. The Current Plan stays in use until a senior clinician approves it.`,
        },
      };
    }

    case "return-management-version": {
      const version = state.managementPlanVersions.find(({ id }) => id === action.versionId) ?? null;
      if (version === null) return refuse(state, "That Management Plan Version does not exist.");
      if (version.state !== "awaiting_approval") {
        return refuse(
          state,
          `Only a version awaiting approval can be returned for changes. Version ${version.version} is ${version.state}.`,
        );
      }
      if (isBlank(action.reason)) {
        return refuse(
          state,
          "A returned version needs a reason, so the author knows what to change. Nothing was changed.",
        );
      }

      const returned: ManagementPlanVersion = {
        ...version,
        state: "draft",
        returnedReason: action.reason.trim(),
      };

      return {
        ...state,
        // Returning touches only the submitted version. The Current Plan was
        // never displaced by it and is not touched now.
        managementPlanVersions: state.managementPlanVersions.map((candidate) =>
          candidate.id === returned.id ? returned : candidate,
        ),
        auditEvents: withAudit(state, {
          type: "management_version_returned",
          patientId: patientOfManagementPlan(state, version.planId),
          objectId: returned.id,
          evidence: `Version ${returned.version} returned for changes: ${asSentence(returned.returnedReason ?? "")}`,
        }),
        lastOutcome: {
          kind: "success",
          message: `Version ${returned.version} returned to Draft for changes. The Current Plan is unchanged.`,
        },
      };
    }

    case "approve-management-version": {
      const version = state.managementPlanVersions.find(({ id }) => id === action.versionId) ?? null;
      if (version === null) return refuse(state, "That Management Plan Version does not exist.");
      if (version.state !== "awaiting_approval") {
        return refuse(
          state,
          `Only a version awaiting approval can be approved. Version ${version.version} is ${version.state}.`,
        );
      }
      const plan = state.managementPlans.find(({ id }) => id === version.planId) ?? null;
      if (plan === null) {
        return refuse(state, "That version has no Management Plan record, so it cannot become the Current Plan.");
      }

      const approver = state.users.find(({ id }) => id === state.activeUserId) ?? null;
      if (approver === null || isBlank(approver.displayName)) {
        return refuse(state, "Approval must name the senior clinician approving it. Nothing was changed.");
      }

      const missing = missingRequiredContentKeys(version.content);
      if (missing.length > 0) {
        return refuse(
          state,
          `Version ${version.version} cannot become the Current Plan while required sections are empty: ${missing.join(", ")}.`,
        );
      }
      // A version must not become the Current Plan without a stated reason for
      // existing. A later reader comparing two versions has nothing else to tell
      // them why this one replaced the last.
      if (isBlank(version.revisionReason)) {
        return refuse(
          state,
          `Version ${version.version} cannot become the Current Plan without a stated reason for the change. Nothing was changed.`,
        );
      }

      const approvedAt = prototypeTimestamp(state);
      const managementPlanVersions = state.managementPlanVersions.map((candidate) => {
        if (candidate.id === version.id) {
          return {
            ...candidate,
            state: "current" as const,
            approverId: approver.id,
            approvedAt,
            // Review state is always derived from this date, never stored.
            reviewDueAt: candidate.reviewDueAt ?? addIsoMonths(approvedAt, REVIEW_INTERVAL_MONTHS),
          };
        }
        if (candidate.planId === version.planId && candidate.state === "current") {
          return { ...candidate, state: "superseded" as const };
        }
        return candidate;
      });
      // Two Current versions would show two plans both approved for use now.
      assertSingleCurrentVersion(managementPlanVersions);

      // A version may be approved at any participation state — the person's
      // absence must never block their plan being written. What it does raise is
      // an open trigger, so going through the plan with them lands in the Reviews
      // queue where somebody owns it. The persistent on-screen marker is not
      // enough on its own: a marker is read only by whoever opens that plan.
      const involvementNotRecorded =
        version.participationState === "declined" || version.participationState === "patient_unavailable";
      const participationAlreadyOpen = state.reviewTriggers.some(
        (trigger) =>
          trigger.managementPlanId === plan.id && trigger.source === "participation" && trigger.status === "open",
      );
      const participationTrigger: ReviewTrigger | null =
        involvementNotRecorded && !participationAlreadyOpen
          ? {
              id: nextSyntheticId(
                "SYN-TRIGGER",
                state.reviewTriggers.map(({ id }) => id),
              ),
              patientId: plan.patientId,
              managementPlanId: plan.id,
              source: "participation",
              sourceId: version.id,
              reason:
                version.participationState === "declined"
                  ? `Version ${version.version} was approved after this person chose not to take part in writing it. Offer again at the next contact, and record what they decide.`
                  : // A new draft starts at this state before anybody records
                    // anything, so the reason says only what is known: that no
                    // involvement is on the record. It does not assert that the
                    // person was absent.
                    `Version ${version.version} was approved with no involvement recorded for this person. Go through the plan with them at the next contact, and record what they say.`,
              status: "open",
              createdAt: prototypeTimestamp(state, 1),
              resolvedAt: null,
              resolution: null,
            }
          : null;

      /**
       * The person may already hold a patient copy of the version this one
       * replaces — possibly on paper, in a bag, at home. Nothing here touches
       * it: it is not regenerated, hidden, or withdrawn, because the
       * application cannot reach the sheet and must not claim to have. What it
       * does instead is put the discrepancy in front of a human, once. The
       * trigger is deduplicated per plan, so approving three versions in a row
       * raises one item rather than three.
       */
      const patientPlan = state.patientPlans.find((candidate) => candidate.patientId === plan.patientId) ?? null;
      const currentPatientVersion =
        patientPlan === null ? null : getCurrentPatientPlanVersion(state.patientPlanVersions, patientPlan.id);
      const patientCopyNowStale =
        currentPatientVersion !== null && currentPatientVersion.derivedFromManagementVersionId !== version.id;
      const staleTriggerAlreadyOpen = state.reviewTriggers.some(
        (trigger) =>
          trigger.managementPlanId === plan.id && trigger.source === "patient_plan_stale" && trigger.status === "open",
      );
      const staleTrigger: ReviewTrigger | null =
        patientCopyNowStale && !staleTriggerAlreadyOpen && currentPatientVersion !== null
          ? {
              id: nextSyntheticId("SYN-TRIGGER", [
                ...state.reviewTriggers.map(({ id }) => id),
                ...(participationTrigger === null ? [] : [participationTrigger.id]),
              ]),
              patientId: plan.patientId,
              managementPlanId: plan.id,
              source: "patient_plan_stale",
              sourceId: currentPatientVersion.id,
              reason: `Patient Plan version ${currentPatientVersion.version} was written from Management Plan version ${version.version - 1} or earlier, and the Current Plan is now version ${version.version}. The person may be holding a printed copy, so it stays readable and unchanged until somebody goes through it with them.`,
              status: "open",
              createdAt: prototypeTimestamp(state, 2),
              resolvedAt: null,
              resolution: null,
            }
          : null;

      const raisedTriggers = [participationTrigger, staleTrigger].filter(
        (trigger): trigger is ReviewTrigger => trigger !== null,
      );

      return {
        ...state,
        managementPlanVersions,
        managementPlans: state.managementPlans.map((candidate) =>
          candidate.id === plan.id ? { ...candidate, currentVersionId: version.id } : candidate,
        ),
        reviewTriggers: [...state.reviewTriggers, ...raisedTriggers],
        auditEvents: withAudit(state, {
          type: "management_version_approved",
          patientId: plan.patientId,
          objectId: version.id,
          evidence: `Version ${version.version} approved by ${approver.displayName} and is now the Current Plan. The previously Current version is Superseded and stays readable in history.`,
        }),
        lastOutcome: {
          kind: "success",
          message:
            raisedTriggers.length === 0
              ? `Version ${version.version} is now the Current Plan, approved by ${approver.displayName}.`
              : staleTrigger === null
                ? `Version ${version.version} is now the Current Plan, approved by ${approver.displayName}. No involvement was recorded for this person, so an open Review Trigger was raised for the team.`
                : `Version ${version.version} is now the Current Plan, approved by ${approver.displayName}. This person's Patient Plan was written from an earlier version and now needs updating; it stays readable and an open Review Trigger was raised.`,
        },
      };
    }

    case "withdraw-current-management-version": {
      const patient = findPatient(state, action.patientId);
      if (patient === null) return refuse(state, "That synthetic patient record does not exist.");
      const plan = findManagementPlan(state, patient);
      if (plan === null) return refuse(state, `${patient.preferredName} has no Management Plan record.`);
      const current = getCurrentManagementPlanVersion(state.managementPlanVersions, plan.id);
      if (current === null) return refuse(state, `${patient.preferredName} has no Current Plan to withdraw.`);
      if (isBlank(action.reason)) {
        return refuse(
          state,
          "Withdrawing a plan needs a recorded reason, so a later reader can see why it was taken out of use. Nothing was changed.",
        );
      }

      const withdrawnAt = prototypeTimestamp(state);
      const actor = state.users.find(({ id }) => id === state.activeUserId);

      /**
       * Withdrawal leaves the plan with no Current version at all — not merely
       * a different one — and a Current Patient Plan copy derived from what
       * was just withdrawn is exactly as out of date as one derived from a
       * superseded version. The same mechanism `approve-management-version`
       * uses applies here: the copy is never touched, and the discrepancy goes
       * in front of a human once, deduplicated per plan.
       */
      const patientPlan = state.patientPlans.find((candidate) => candidate.patientId === plan.patientId) ?? null;
      const currentPatientVersion =
        patientPlan === null ? null : getCurrentPatientPlanVersion(state.patientPlanVersions, patientPlan.id);
      const staleTriggerAlreadyOpen = state.reviewTriggers.some(
        (trigger) =>
          trigger.managementPlanId === plan.id && trigger.source === "patient_plan_stale" && trigger.status === "open",
      );
      const staleTrigger: ReviewTrigger | null =
        currentPatientVersion !== null && !staleTriggerAlreadyOpen
          ? {
              id: nextSyntheticId(
                "SYN-TRIGGER",
                state.reviewTriggers.map(({ id }) => id),
              ),
              patientId: plan.patientId,
              managementPlanId: plan.id,
              source: "patient_plan_stale",
              sourceId: currentPatientVersion.id,
              reason: `Version ${current.version} was withdrawn and ${patient.preferredName} now has no Current Plan. Patient Plan version ${currentPatientVersion.version} was written from it, so it stays readable and unchanged until somebody goes through it with them.`,
              status: "open",
              createdAt: prototypeTimestamp(state, 1),
              resolvedAt: null,
              resolution: null,
            }
          : null;

      return {
        ...state,
        managementPlanVersions: state.managementPlanVersions.map((candidate) =>
          candidate.id === current.id
            ? {
                ...candidate,
                state: "withdrawn" as const,
                withdrawalReason: action.reason.trim(),
                withdrawnBy: state.activeUserId,
                withdrawnAt,
              }
            : candidate,
        ),
        // No Current Plan afterwards, and no Superseded version put back in use.
        managementPlans: state.managementPlans.map((candidate) =>
          candidate.id === plan.id ? { ...candidate, currentVersionId: null } : candidate,
        ),
        reviewTriggers: staleTrigger === null ? state.reviewTriggers : [...state.reviewTriggers, staleTrigger],
        auditEvents: withAudit(state, {
          type: "management_version_withdrawn",
          patientId: patient.id,
          objectId: current.id,
          evidence: `Version ${current.version} withdrawn by ${actor?.displayName ?? state.activeUserId}: ${asSentence(action.reason)} ${patient.preferredName} now has no Current Plan.`,
        }),
        lastOutcome: {
          kind: "success",
          message:
            staleTrigger === null
              ? `Version ${current.version} withdrawn. ${patient.preferredName} now has no Current Plan, and no earlier version was put back into use.`
              : `Version ${current.version} withdrawn. ${patient.preferredName} now has no Current Plan, and their Patient Plan stays readable but needs updating; an open Review Trigger was raised.`,
        },
      };
    }

    case "record-formal-management-review": {
      const patient = findPatient(state, action.patientId);
      if (patient === null) return refuse(state, "That synthetic patient record does not exist.");
      const plan = findManagementPlan(state, patient);
      if (plan === null) return refuse(state, `${patient.preferredName} has no Management Plan record.`);
      const current = getCurrentManagementPlanVersion(state.managementPlanVersions, plan.id);
      if (current === null) {
        return refuse(state, `${patient.preferredName} has no Current Plan to record a formal review against.`);
      }
      if (isBlank(action.reason)) {
        return refuse(state, "A formal review needs a recorded account of what was reviewed. Nothing was changed.");
      }
      if (!isParsableTimestamp(action.nextReviewDueAt)) {
        return refuse(
          state,
          "The next review date could not be read as a date, so the review was not recorded and the existing date is unchanged.",
        );
      }

      return {
        ...state,
        // A formal review moves the review date on the version already in use.
        // It creates no new version, and the plan's content is unchanged.
        managementPlanVersions: state.managementPlanVersions.map((candidate) =>
          candidate.id === current.id ? { ...candidate, reviewDueAt: action.nextReviewDueAt } : candidate,
        ),
        auditEvents: withAudit(state, {
          type: "management_review_recorded",
          patientId: patient.id,
          objectId: current.id,
          evidence: `Formal review recorded against Current Plan version ${current.version}: ${asSentence(action.reason)} Next review date set to ${action.nextReviewDueAt}.`,
        }),
        lastOutcome: {
          kind: "success",
          message: `Formal review recorded. Version ${current.version} stays the Current Plan and its next review date has moved.`,
        },
      };
    }

    case "record-plan-shared-with-patient": {
      const patient = findPatient(state, action.patientId);
      if (patient === null) return refuse(state, "That synthetic patient record does not exist.");
      const plan = findManagementPlan(state, patient);
      const current = plan === null ? null : getCurrentManagementPlanVersion(state.managementPlanVersions, plan.id);
      if (current === null) {
        return refuse(state, `${patient.preferredName} has no Current Plan to show them.`);
      }
      // One date, so a second record would replace a recorded fact with another
      // and the first sharing would leave the record with nothing saying so.
      if (current.sharedWithPatientAt !== null) {
        return refuse(
          state,
          `Version ${current.version} is already recorded as shown to ${patient.preferredName} on ${current.sharedWithPatientAt}. Nothing was changed.`,
          "info",
        );
      }

      const sharedWithPatientAt = prototypeTimestamp(state);

      return {
        ...state,
        // The plan's content is untouched. This records only that a clinician
        // went through the existing Current Plan with the person; it writes no
        // patient-facing edition, which is a separate document with its own
        // wording, its own version, and its own approval.
        managementPlanVersions: state.managementPlanVersions.map((candidate) =>
          candidate.id === current.id ? { ...candidate, sharedWithPatientAt } : candidate,
        ),
        auditEvents: withAudit(state, {
          type: "management_plan_shared_with_patient",
          patientId: patient.id,
          objectId: current.id,
          evidence: `Current Plan version ${current.version} was recorded as shown to ${patient.preferredName}. This records what a clinician entered, and is not evidence of what was understood or agreed.`,
        }),
        lastOutcome: {
          kind: "success",
          message: `Recorded that ${patient.preferredName} has been shown version ${current.version}. No patient copy was written, and the plan itself is unchanged.`,
        },
      };
    }

    case "record-presentation": {
      if (!action.presentationId.startsWith("SYN-PRESENTATION-")) {
        return refuse(
          state,
          "That episode identifier does not belong to the synthetic presentation series, so nothing was recorded.",
        );
      }
      if (state.edPresentations.some(({ id }) => id === action.presentationId)) {
        return refuse(
          state,
          "An ED Presentation with that identifier already exists. These records are append-only, so nothing was recorded.",
        );
      }

      const input = action.input;
      const patient = findPatient(state, input.patientId);
      if (patient === null) return refuse(state, "That synthetic patient record does not exist.");
      if (!state.edSites.some(({ id }) => id === input.siteId)) {
        return refuse(state, "That synthetic emergency department does not exist, so nothing was recorded.");
      }
      if (!DISPOSITIONS.includes(input.disposition)) {
        return refuse(state, "That disposition is not one of the recorded answers, so nothing was recorded.");
      }
      if (!isParsableTimestamp(input.arrivedAt)) {
        return refuse(state, "The arrival date and time could not be read as a date, so nothing was recorded.");
      }
      if (
        input.managementPlanVersionId !== null &&
        !state.managementPlanVersions.some(({ id }) => id === input.managementPlanVersionId)
      ) {
        return refuse(state, "That Management Plan Version does not exist, so nothing was recorded.");
      }
      if (input.reviewSuggested && (input.reviewReason === null || isBlank(input.reviewReason))) {
        return refuse(
          state,
          "Suggesting a plan review needs a reason, so the team knows what to look at. Nothing was recorded.",
        );
      }
      if (input.deviationOccurred && (input.deviationReason === null || isBlank(input.deviationReason))) {
        return refuse(
          state,
          "Recording that the agreed approach was not followed needs a reason. Nothing was recorded.",
        );
      }

      const presentation: EdPresentation = {
        ...input,
        id: action.presentationId,
        recordedBy: state.activeUserId,
        recordedAt: prototypeTimestamp(state),
      };

      // A Review Trigger asks the team to reconsider this person's Management
      // Plan, so the line is whether they have ever had a version — not whether
      // one is Current right now. Someone whose plan was withdrawn, who then
      // presents and is admitted, is precisely who the Reviews queue exists for;
      // gating on a live Current version drops that cohort silently. Only a
      // person who has never had any version raises none, because for them the
      // pathway is Identification Review rather than plan review.
      const plan = findManagementPlan(state, patient);
      const hasEverHadAVersion =
        plan !== null && state.managementPlanVersions.some((existing) => existing.planId === plan.id);
      const candidate = hasEverHadAVersion ? reviewTriggerReasonFor(presentation) : null;
      // One open trigger per plan per source. A team reconsiders the plan once;
      // a queue that fills with the same reason stops being read at all.
      const alreadyOpen =
        plan !== null &&
        candidate !== null &&
        state.reviewTriggers.some(
          (trigger) =>
            trigger.managementPlanId === plan.id && trigger.source === candidate.source && trigger.status === "open",
        );
      const newTrigger: ReviewTrigger | null =
        plan !== null && candidate !== null && !alreadyOpen
          ? {
              id: nextSyntheticId(
                "SYN-TRIGGER",
                state.reviewTriggers.map(({ id }) => id),
              ),
              patientId: patient.id,
              managementPlanId: plan.id,
              source: candidate.source,
              sourceId: presentation.id,
              reason: candidate.reason,
              status: "open",
              createdAt: prototypeTimestamp(state, 1),
              resolvedAt: null,
              resolution: null,
            }
          : null;

      return {
        ...state,
        edPresentations: [...state.edPresentations, presentation],
        reviewTriggers: newTrigger === null ? state.reviewTriggers : [...state.reviewTriggers, newTrigger],
        auditEvents: withAudit(state, {
          type: "presentation_recorded",
          patientId: patient.id,
          objectId: presentation.id,
          evidence: `ED Presentation recorded for arrival on ${presentation.arrivedAt}, with disposition ${presentation.disposition}.`,
        }),
        lastOutcome: {
          kind: "success",
          message:
            newTrigger === null
              ? "ED Presentation recorded. The Management Plan is unchanged."
              : "ED Presentation recorded, and an open Review Trigger was raised for the team to look at. The Management Plan is unchanged.",
        },
      };
    }

    case "amend-presentation": {
      const presentation = state.edPresentations.find(({ id }) => id === action.presentationId) ?? null;
      if (presentation === null) return refuse(state, "That ED Presentation does not exist.");
      if (!AMENDABLE_FIELDS.includes(action.field)) {
        return refuse(state, "That part of an ED Presentation cannot be corrected, so nothing was changed.");
      }
      if (isBlank(action.reason)) {
        return refuse(
          state,
          "A correction needs a reason, so a later reader can see why the record changed. Nothing was changed.",
        );
      }
      if (isBlank(action.replacementValue)) {
        return refuse(state, "A correction needs a replacement value. Nothing was changed.");
      }

      const answers = AMENDABLE_FIELD_ANSWERS[action.field];
      if (answers !== undefined && !answers.includes(action.replacementValue)) {
        return refuse(
          state,
          `"${action.replacementValue}" is not one of the recorded answers for ${action.field}, so nothing was changed.`,
        );
      }

      const originalValue = effectiveFieldValue(state, presentation, action.field);
      if (originalValue === action.replacementValue) {
        return refuse(
          state,
          "The replacement is the same as the value already recorded, so there is nothing to correct.",
          "info",
        );
      }

      const amendment: PresentationAmendment = {
        id: nextSyntheticId(
          "SYN-AMENDMENT",
          state.presentationAmendments.map(({ id }) => id),
        ),
        presentationId: presentation.id,
        field: action.field,
        originalValue,
        replacementValue: action.replacementValue,
        reason: action.reason.trim(),
        authorId: state.activeUserId,
        amendedAt: prototypeTimestamp(state),
      };

      // The timeline renders an amendment over the original record. Review
      // triggers must make the same decision from that effective record; using
      // the stored original here leaves a newly corrected admission or adverse
      // plan-use answer visible on screen but absent from Reviews.
      const amendments = [...state.presentationAmendments, amendment];
      const reviewRelevant = action.field === "planHelpfulness" || action.field === "disposition";
      const effectivePresentation: EdPresentation = {
        ...presentation,
        planHelpfulness: getEffectivePresentationValue(amendments, presentation, "planHelpfulness") as PlanHelpfulness,
        disposition: getEffectivePresentationValue(amendments, presentation, "disposition") as Disposition,
      };
      const patient = findPatient(state, presentation.patientId);
      const plan = patient === null ? null : findManagementPlan(state, patient);
      const hasEverHadAVersion =
        plan !== null && state.managementPlanVersions.some((existing) => existing.planId === plan.id);
      const candidate = reviewRelevant && hasEverHadAVersion ? reviewTriggerReasonFor(effectivePresentation) : null;
      const alreadyOpen =
        plan !== null &&
        candidate !== null &&
        state.reviewTriggers.some(
          (trigger) =>
            trigger.managementPlanId === plan.id && trigger.source === candidate.source && trigger.status === "open",
        );
      const newTrigger: ReviewTrigger | null =
        plan !== null && candidate !== null && !alreadyOpen
          ? {
              id: nextSyntheticId(
                "SYN-TRIGGER",
                state.reviewTriggers.map(({ id }) => id),
              ),
              patientId: presentation.patientId,
              managementPlanId: plan.id,
              source: candidate.source,
              sourceId: presentation.id,
              reason: candidate.reason,
              status: "open",
              createdAt: prototypeTimestamp(state, 1),
              resolvedAt: null,
              resolution: null,
            }
          : null;

      return {
        ...state,
        // The episode is untouched. A correction is appended beside it, with who
        // made it, when, what it replaced, and why.
        presentationAmendments: amendments,
        reviewTriggers: newTrigger === null ? state.reviewTriggers : [...state.reviewTriggers, newTrigger],
        auditEvents: withAudit(state, {
          type: "presentation_amended",
          patientId: presentation.patientId,
          objectId: presentation.id,
          evidence: `Correction recorded for ${amendment.field}. Recorded as "${amendment.originalValue}"; corrected to "${amendment.replacementValue}". Reason: ${asSentence(amendment.reason)} The original ED Presentation record is unchanged.`,
        }),
        lastOutcome: {
          kind: "success",
          message:
            newTrigger === null
              ? "Correction recorded beside the original. The original ED Presentation record is unchanged."
              : "Correction recorded beside the original. The original ED Presentation record is unchanged, and an open Review Trigger was raised for the team to look at.",
        },
      };
    }

    case "create-safety-plan-draft": {
      const patient = findPatient(state, action.patientId);
      if (patient === null) return refuse(state, "That synthetic patient record does not exist.");
      const plan = findSafetyPlan(state, patient);
      if (plan === null) return refuse(state, `${patient.preferredName} has no Personal Safety Plan record.`);
      if (state.personalSafetyPlanVersions.some((version) => version.planId === plan.id && version.state === "draft")) {
        return refuse(
          state,
          `A Personal Safety Plan draft for ${patient.preferredName} is already open. Continue that one rather than starting another.`,
        );
      }

      const current = getCurrentSafetyPlanVersion(state.personalSafetyPlanVersions, plan.id);
      const createdAt = prototypeTimestamp(state);
      const draft: PersonalSafetyPlanVersion = {
        id: nextSyntheticId(
          "SYN-SAFETY-VERSION",
          state.personalSafetyPlanVersions.map(({ id }) => id),
        ),
        planId: plan.id,
        version: nextVersionNumber(state.personalSafetyPlanVersions, plan.id),
        state: "draft",
        authorId: state.activeUserId,
        createdAt,
        confirmedAt: null,
        reviewDueAt: addIsoMonths(createdAt, REVIEW_INTERVAL_MONTHS),
        // As with a Management Plan draft, nothing is yet known about this
        // person's part in this edition, so the record claims none.
        patientConfirmation: "unavailable",
        collaborationNote: "",
        content: cloneJson(current === null ? EMPTY_SAFETY_CONTENT : current.content),
      };

      return {
        ...state,
        personalSafetyPlanVersions: [...state.personalSafetyPlanVersions, draft],
        personalSafetyPlans: state.personalSafetyPlans.map((candidate) =>
          candidate.id === plan.id ? { ...candidate, versionIds: [...candidate.versionIds, draft.id] } : candidate,
        ),
        auditEvents: withAudit(state, {
          type: "safety_plan_draft_created",
          patientId: patient.id,
          objectId: draft.id,
          evidence: `Personal Safety Plan draft version ${draft.version} started.`,
        }),
        lastOutcome: {
          kind: "success",
          message: `Personal Safety Plan draft version ${draft.version} created. It is not in use until it is made current.`,
        },
      };
    }

    case "save-safety-plan-draft": {
      const version = state.personalSafetyPlanVersions.find(({ id }) => id === action.versionId) ?? null;
      if (version === null) return refuse(state, "That Personal Safety Plan Version does not exist.");
      if (version.state !== "draft") {
        return refuse(state, `Only a draft can be edited. Version ${version.version} is ${version.state}.`);
      }
      if (!isParsableTimestamp(action.input.reviewDueAt)) {
        return refuse(
          state,
          "The next review date could not be read as a date, so nothing was saved. A date that cannot be read shows as overdue and tells a reader nothing.",
        );
      }

      const saved: PersonalSafetyPlanVersion = {
        ...version,
        reviewDueAt: action.input.reviewDueAt,
        patientConfirmation: action.input.patientConfirmation,
        collaborationNote: action.input.collaborationNote,
        content: cloneJson(action.input.content),
      };

      return {
        ...state,
        personalSafetyPlanVersions: state.personalSafetyPlanVersions.map((candidate) =>
          candidate.id === saved.id ? saved : candidate,
        ),
        auditEvents: withAudit(state, {
          type: "safety_plan_draft_saved",
          patientId: patientOfSafetyPlan(state, version.planId),
          objectId: saved.id,
          evidence: `Personal Safety Plan draft version ${saved.version} saved, with the person's involvement recorded as ${saved.patientConfirmation}.`,
        }),
        lastOutcome: {
          kind: "success",
          message: `Personal Safety Plan draft version ${saved.version} saved.`,
        },
      };
    }

    case "make-safety-plan-current": {
      const version = state.personalSafetyPlanVersions.find(({ id }) => id === action.versionId) ?? null;
      if (version === null) return refuse(state, "That Personal Safety Plan Version does not exist.");
      if (version.state !== "draft") {
        return refuse(
          state,
          `Only a draft can be made the current Personal Safety Plan. Version ${version.version} is ${version.state}.`,
        );
      }
      const plan = state.personalSafetyPlans.find(({ id }) => id === version.planId) ?? null;
      if (plan === null) return refuse(state, "That version has no Personal Safety Plan record.");

      const madeCurrentAt = prototypeTimestamp(state);

      return {
        ...state,
        // The Personal Safety Plan is the patient's own. It is versioned on its
        // own and never waits on Management Plan senior approval.
        personalSafetyPlanVersions: state.personalSafetyPlanVersions.map((candidate) => {
          if (candidate.id === version.id) {
            return {
              ...candidate,
              state: "current" as const,
              confirmedAt:
                candidate.patientConfirmation === "confirmed" && candidate.confirmedAt === null
                  ? madeCurrentAt
                  : candidate.confirmedAt,
            };
          }
          if (candidate.planId === version.planId && candidate.state === "current") {
            return { ...candidate, state: "superseded" as const };
          }
          return candidate;
        }),
        personalSafetyPlans: state.personalSafetyPlans.map((candidate) =>
          candidate.id === plan.id ? { ...candidate, currentVersionId: version.id } : candidate,
        ),
        auditEvents: withAudit(state, {
          type: "safety_plan_made_current",
          patientId: plan.patientId,
          objectId: version.id,
          evidence: `Personal Safety Plan version ${version.version} is now the current one. Any earlier current version is superseded and stays readable in history.`,
        }),
        lastOutcome: {
          kind: "success",
          message: `Personal Safety Plan version ${version.version} is now the current one.`,
        },
      };
    }

    case "create-patient-plan-draft": {
      const patient = findPatient(state, action.patientId);
      if (patient === null) return refuse(state, "That synthetic patient record does not exist.");
      const managementPlan = findManagementPlan(state, patient);
      const currentManagement =
        managementPlan === null
          ? null
          : getCurrentManagementPlanVersion(state.managementPlanVersions, managementPlan.id);
      // A patient copy of a plan nobody has approved would be a document in
      // somebody's hands describing care nobody agreed to.
      if (currentManagement === null) {
        return refuse(
          state,
          `${patient.preferredName} has no Current Plan, so there is nothing to make a patient copy of. A draft or a withdrawn version is not an agreed plan.`,
        );
      }

      const plan = findOrCreatePatientPlan(state, patient);
      if (getOpenPatientPlanDraft(state.patientPlanVersions, plan.id) !== null) {
        return refuse(
          state,
          `A Patient Plan draft for ${patient.preferredName} is already open. Continue that one rather than starting another.`,
        );
      }

      const draftContent = buildPatientPlanDraft(
        currentManagement,
        patient,
        getPatientResources(state.patientResources, patient.id),
      );
      const draft: PatientPlanVersion = {
        id: nextSyntheticId(
          "SYN-PATIENT-PLAN-VERSION",
          state.patientPlanVersions.map(({ id }) => id),
        ),
        planId: plan.id,
        version: nextVersionNumber(state.patientPlanVersions, plan.id),
        state: "draft",
        derivedFromManagementVersionId: currentManagement.id,
        sections: cloneJson(draftContent.sections),
        resources: cloneJson(draftContent.resources),
        approvedBy: null,
        approvedAt: null,
        createdAt: prototypeTimestamp(state),
      };

      const gaps = unfilledGapSections(draft.sections).length;

      return {
        ...state,
        patientPlans: state.patientPlans.some(({ id }) => id === plan.id)
          ? state.patientPlans.map((candidate) =>
              candidate.id === plan.id ? { ...candidate, versionIds: [...candidate.versionIds, draft.id] } : candidate,
            )
          : [...state.patientPlans, { ...plan, versionIds: [draft.id] }],
        patientPlanVersions: [...state.patientPlanVersions, draft],
        auditEvents: withAudit(state, {
          type: "patient_plan_draft_created",
          patientId: patient.id,
          objectId: draft.id,
          evidence: `Patient Plan draft version ${draft.version} produced from Management Plan version ${currentManagement.version} by the offline plain-language conversion. ${gaps} of ${draft.sections.length} sections were left as gaps for a clinician to write. No language model was used.`,
        }),
        lastOutcome: {
          kind: gaps === 0 ? "success" : "info",
          message:
            gaps === 0
              ? `Patient Plan draft version ${draft.version} created. Read it through before approving it.`
              : `Patient Plan draft version ${draft.version} created, with ${gaps} of ${draft.sections.length} sections left blank for you to write. The conversion refuses to guess, so a gap is a section it would not risk getting wrong.`,
        },
      };
    }

    case "save-patient-plan-draft": {
      const version = state.patientPlanVersions.find(({ id }) => id === action.versionId) ?? null;
      if (version === null) return refuse(state, "That Patient Plan Version does not exist.");
      if (version.state !== "draft") {
        return refuse(
          state,
          `Only a draft can be edited. Patient Plan version ${version.version} is ${version.state}, and a copy the person may already be holding is never rewritten underneath them.`,
        );
      }

      const saved: PatientPlanVersion = {
        ...version,
        // Replaced whole rather than patched: half a converted sentence and half
        // a clinician's rewrite in one paragraph is nobody's voice.
        sections: cloneJson(action.input.sections),
        resources: cloneJson(action.input.resources),
      };
      const remaining = unfilledGapSections(saved.sections).length;

      return {
        ...state,
        patientPlanVersions: state.patientPlanVersions.map((candidate) =>
          candidate.id === saved.id ? saved : candidate,
        ),
        auditEvents: withAudit(state, {
          type: "patient_plan_draft_saved",
          patientId: patientOfPatientPlan(state, version.planId),
          objectId: saved.id,
          evidence: `Patient Plan draft version ${saved.version} saved with ${saved.sections.length} sections and ${saved.resources.length} resources. ${remaining} sections are still gaps.`,
        }),
        lastOutcome: {
          kind: "success",
          message:
            remaining === 0
              ? `Patient Plan draft version ${saved.version} saved. Every section now has something in it.`
              : `Patient Plan draft version ${saved.version} saved. ${remaining} sections are still blank and it cannot be approved until they are written.`,
        },
      };
    }

    case "approve-patient-plan-version": {
      const version = state.patientPlanVersions.find(({ id }) => id === action.versionId) ?? null;
      if (version === null) return refuse(state, "That Patient Plan Version does not exist.");
      if (version.state !== "draft") {
        return refuse(
          state,
          `Only a draft can be approved. Patient Plan version ${version.version} is ${version.state}.`,
        );
      }
      const plan = state.patientPlans.find(({ id }) => id === version.planId) ?? null;
      if (plan === null) return refuse(state, "That version has no Patient Plan record.");

      const patient = findPatient(state, plan.patientId);
      const managementPlan = patient === null ? null : findManagementPlan(state, patient);
      const currentManagement =
        managementPlan === null
          ? null
          : getCurrentManagementPlanVersion(state.managementPlanVersions, managementPlan.id);
      if (currentManagement === null || currentManagement.id !== version.derivedFromManagementVersionId) {
        return refuse(
          state,
          `Patient Plan version ${version.version} was made from a Management Plan that is no longer Current, so it cannot be approved. Start a new copy from the agreed plan instead.`,
        );
      }

      const approver = state.users.find(({ id }) => id === state.activeUserId) ?? null;
      if (approver === null || isBlank(approver.displayName)) {
        return refuse(state, "Approval must name the clinician approving it. Nothing was changed.");
      }

      /**
       * The gap block. A gap is a place the conversion refused to guess, and an
       * unfilled one prints as a heading with nothing under it — handed to the
       * person it is about. The form makes the control unavailable with this
       * reason; the reducer is the guard that means it cannot happen anyway.
       */
      const gaps = unfilledGapSections(version.sections);
      if (gaps.length > 0) {
        return refuse(
          state,
          `Patient Plan version ${version.version} cannot be approved while ${gaps.length} ${gaps.length === 1 ? "section is" : "sections are"} still blank: ${gaps.map((section) => section.heading).join("; ")}. A blank heading on a copy handed to somebody reads as though nothing about them was worth writing.`,
        );
      }

      const approvedAt = prototypeTimestamp(state);

      return {
        ...state,
        patientPlanVersions: state.patientPlanVersions.map((candidate) => {
          if (candidate.id === version.id) {
            return { ...candidate, state: "current" as const, approvedBy: approver.id, approvedAt };
          }
          if (candidate.planId === version.planId && candidate.state === "current") {
            return { ...candidate, state: "superseded" as const };
          }
          return candidate;
        }),
        patientPlans: state.patientPlans.map((candidate) =>
          candidate.id === plan.id ? { ...candidate, currentVersionId: version.id } : candidate,
        ),
        auditEvents: withAudit(state, {
          type: "patient_plan_approved",
          patientId: plan.patientId,
          objectId: version.id,
          evidence: `Patient Plan version ${version.version} approved by ${approver.displayName} and is now the copy given to this person. Any earlier copy is superseded and stays readable in history.`,
        }),
        lastOutcome: {
          kind: "success",
          message: `Patient Plan version ${version.version} approved by ${approver.displayName}. It can now be printed and given to this person.`,
        },
      };
    }

    case "record-patient-plan-print-intent": {
      const patient = findPatient(state, action.patientId);
      if (patient === null) return refuse(state, "That synthetic patient record does not exist.");
      const plan = state.patientPlans.find((candidate) => candidate.patientId === patient.id) ?? null;
      const current = plan === null ? null : getCurrentPatientPlanVersion(state.patientPlanVersions, plan.id);
      if (current === null) {
        return refuse(state, `${patient.preferredName} has no approved Patient Plan to print.`);
      }

      return {
        ...state,
        auditEvents: withAudit(state, {
          type: "patient_plan_print_intent_opened",
          patientId: patient.id,
          objectId: current.id,
          evidence: `The browser print view was opened for Patient Plan version ${current.version}. This records the request only, and is not evidence that anything reached a printer or reached this person.`,
        }),
        lastOutcome: {
          kind: "info",
          message:
            "The print view was opened. What happens after that is handled by the browser and is not recorded here.",
        },
      };
    }

    case "record-safety-plan-print-intent": {
      const patient = findPatient(state, action.patientId);
      if (patient === null) return refuse(state, "That synthetic patient record does not exist.");
      const plan = findSafetyPlan(state, patient);
      const current = plan === null ? null : getCurrentSafetyPlanVersion(state.personalSafetyPlanVersions, plan.id);
      if (current === null) {
        return refuse(state, `${patient.preferredName} has no current Personal Safety Plan to print.`);
      }

      return {
        ...state,
        auditEvents: withAudit(state, {
          type: "safety_plan_print_intent_opened",
          patientId: patient.id,
          objectId: current.id,
          evidence: `The browser print view was opened for Personal Safety Plan version ${current.version}. This records the request only, and is not evidence that anything reached a printer.`,
        }),
        lastOutcome: {
          kind: "info",
          message:
            "The print view was opened. What happens after that is handled by the browser and is not recorded here.",
        },
      };
    }

    case "record-management-plan-print-intent": {
      const patient = findPatient(state, action.patientId);
      if (patient === null) return refuse(state, "That synthetic patient record does not exist.");
      const plan = findManagementPlan(state, patient);
      const current = plan === null ? null : getCurrentManagementPlanVersion(state.managementPlanVersions, plan.id);
      if (current === null) {
        return refuse(state, `${patient.preferredName} has no Current Plan to print.`);
      }

      return {
        ...state,
        // A print intent changes no clinical record. It appends an attributed
        // note that a print view was opened, which is all this application can
        // honestly know: it never sees a printer, a sheet of paper, or a reader.
        auditEvents: withAudit(state, {
          type: "management_plan_print_intent_opened",
          patientId: patient.id,
          objectId: current.id,
          evidence: `The browser print view was opened for Management Plan version ${current.version}. This records the request only, and is not evidence that anything reached a printer.`,
        }),
        lastOutcome: {
          kind: "info",
          message:
            "The print view was opened. What happens after that is handled by the browser and is not recorded here.",
        },
      };
    }

    case "record-contact-intent": {
      const patient = findPatient(state, action.patientId);
      if (patient === null) return refuse(state, "That synthetic patient record does not exist.");
      const contact = state.cmhtContacts.find(({ id }) => id === action.cmhtId) ?? null;
      if (contact === null) return refuse(state, "That community mental health team record does not exist.");

      const isEmail = action.channel === "email";

      return {
        ...state,
        // A contact action records an attempt to open an external application.
        // It is never evidence that anyone was reached.
        auditEvents: withAudit(state, {
          type: isEmail ? "email_intent_opened" : "call_intent_opened",
          patientId: patient.id,
          objectId: contact.id,
          evidence: isEmail
            ? `An external email application was asked to open, addressed to the ${contact.name} shared mailbox with a generic subject and no patient information. This application transmitted nothing and holds no evidence of delivery, readership, or reply.`
            : `An external telephone application was asked to open with the ${contact.name} duty number displayed. This application holds no evidence of a connection, a conversation, or any outcome.`,
        }),
        lastOutcome: {
          kind: "info",
          message: isEmail
            ? "An email application was asked to open. This prototype records only that request, not what happens next."
            : "A telephone application was asked to open. This prototype records only that request, not what happens next.",
        },
      };
    }

    case "create-identification-review": {
      const patient = findPatient(state, action.patientId);
      if (patient === null) return refuse(state, "That synthetic patient record does not exist.");
      if (isBlank(action.reason)) {
        return refuse(
          state,
          "A referral for Identification Review needs a stated reason. No numeric rule exists, so the reason is the whole referral. Nothing was changed.",
        );
      }
      if (state.identificationReviews.some((review) => review.patientId === patient.id && review.status === "open")) {
        return refuse(
          state,
          `An Identification Review for ${patient.preferredName} is already open, so a second referral was not added.`,
        );
      }

      const review: IdentificationReview = {
        id: nextSyntheticId(
          "SYN-IDENT-REVIEW",
          state.identificationReviews.map(({ id }) => id),
        ),
        patientId: patient.id,
        reason: action.reason.trim(),
        referredBy: state.activeUserId,
        referredAt: prototypeTimestamp(state),
        status: "open",
        decision: null,
        decisionReason: null,
        decidedBy: null,
        decidedAt: null,
      };

      return {
        ...state,
        // A referral asks a group of people to consider coordinated care. It
        // enrols nobody, creates no plan, and raises no Review Trigger.
        identificationReviews: [...state.identificationReviews, review],
        auditEvents: withAudit(state, {
          type: "identification_review_created",
          patientId: patient.id,
          objectId: review.id,
          evidence: `Referred for Identification Review with a stated reason: ${asSentence(review.reason)} No plan was created and no eligibility was decided.`,
        }),
        lastOutcome: {
          kind: "success",
          message: `${patient.preferredName} was referred for Identification Review. No plan was created, and being referred decides nothing.`,
        },
      };
    }

    case "close-identification-review": {
      const review = state.identificationReviews.find(({ id }) => id === action.reviewId) ?? null;
      if (review === null) return refuse(state, "That Identification Review does not exist.");
      if (review.status !== "open") {
        return refuse(
          state,
          "That Identification Review was already closed, so nothing was changed. Its recorded decision and reason stay as they are.",
          "info",
        );
      }
      if (!IDENTIFICATION_DECISIONS.includes(action.decision)) {
        return refuse(state, "That is not one of the recorded Identification Review decisions. Nothing was changed.");
      }
      if (isBlank(action.decisionReason)) {
        return refuse(
          state,
          "Closing an Identification Review needs a short reason, so a later reader can see what was concluded. Nothing was changed.",
        );
      }

      const closed: IdentificationReview = {
        ...review,
        status: "closed",
        decision: action.decision,
        decisionReason: action.decisionReason.trim(),
        decidedBy: state.activeUserId,
        decidedAt: prototypeTimestamp(state),
      };

      return {
        ...state,
        // Closing records a conclusion. Even on `proceed_to_plan` it creates no
        // Management Plan and no version: someone still has to choose to write one.
        identificationReviews: state.identificationReviews.map((candidate) =>
          candidate.id === closed.id ? closed : candidate,
        ),
        auditEvents: withAudit(state, {
          type: "identification_review_closed",
          patientId: review.patientId,
          objectId: closed.id,
          evidence: `Identification Review closed with the decision ${action.decision}: ${asSentence(closed.decisionReason ?? "")} No plan and no version were created by closing it.`,
        }),
        lastOutcome: {
          kind: "success",
          message:
            action.decision === "proceed_to_plan"
              ? "Identification Review closed. Nothing was created; starting a Management Plan draft is a separate decision."
              : "Identification Review closed. The decision and its reason stay visible in the person's history.",
        },
      };
    }

    case "verify-cmht-contact": {
      const contact = state.cmhtContacts.find(({ id }) => id === action.cmhtId) ?? null;
      if (contact === null) return refuse(state, "That community mental health team record does not exist.");

      const verifiedAt = prototypeTimestamp(state);

      return {
        ...state,
        cmhtContacts: state.cmhtContacts.map((candidate) =>
          candidate.id === contact.id
            ? { ...candidate, verifiedAt, verificationState: "verified" as const }
            : candidate,
        ),
        auditEvents: withAudit(state, {
          type: "cmht_contact_verified",
          patientId: null,
          objectId: contact.id,
          evidence: `The shared mailbox, duty number, and operating hours displayed for ${contact.name} were checked on ${verifiedAt}. Checking the details is not a guarantee that the service is available.`,
        }),
        lastOutcome: {
          kind: "success",
          message: `${contact.name} contact details recorded as checked. That says the details were checked, not that the service is available.`,
        },
      };
    }

    case "resolve-review-trigger": {
      const trigger = state.reviewTriggers.find(({ id }) => id === action.triggerId) ?? null;
      if (trigger === null) return refuse(state, "That Review Trigger does not exist.");
      if (trigger.status !== "open") {
        return refuse(state, "That Review Trigger was already resolved, so nothing was changed.", "info");
      }
      if (isBlank(action.resolution)) {
        return refuse(state, "Resolving a Review Trigger needs an account of what was decided. Nothing was changed.");
      }

      return {
        ...state,
        reviewTriggers: state.reviewTriggers.map((candidate) =>
          candidate.id === trigger.id
            ? {
                ...candidate,
                status: "resolved" as const,
                resolvedAt: prototypeTimestamp(state),
                resolution: action.resolution.trim(),
              }
            : candidate,
        ),
        auditEvents: withAudit(state, {
          type: "review_trigger_resolved",
          patientId: trigger.patientId,
          objectId: trigger.id,
          evidence: `Review Trigger resolved: ${asSentence(action.resolution)} Resolving it changed no plan.`,
        }),
        lastOutcome: { kind: "success", message: "Review Trigger resolved. No plan was changed." },
      };
    }

    case "apply-scenario": {
      // Switching to the scenario already displayed is a no-op, so a repeated or
      // spurious switch cannot discard work that is only held in memory.
      if (action.scenario === state.scenario) return state;
      return createInitialPrototypeState(action.scenario);
    }

    case "clear-outcome":
      return { ...state, lastOutcome: null };

    case "reset":
      return createInitialPrototypeState();
  }
}
