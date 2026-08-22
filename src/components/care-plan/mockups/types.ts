/**
 * Care Plan — synthetic prototype domain vocabulary.
 *
 * Every type here is data only: plain, JSON-serialisable values with no `Date`,
 * `Map`, `Set`, class instance, or function member, so the memory-only prototype
 * could later gain storage without redesigning the domain. Nothing in this file
 * reads a clock, a network, or a browser API.
 *
 * Australian English, `en-AU`, `Australia/Perth`, ISO source timestamps.
 */

export type SyntheticId = `SYN-${string}`;

export type PrototypeRole =
  "ed_clinician" | "liaison_clinician" | "cmht_clinician" | "senior_clinician" | "plan_coordinator";

export type ManagementPlanVersionState = "draft" | "awaiting_approval" | "current" | "superseded" | "withdrawn";
export type SafetyPlanVersionState = "draft" | "current" | "superseded";
export type ReviewState = "within_review" | "due_soon" | "overdue";
export type ParticipationState = "co_produced" | "discussed" | "declined" | "patient_unavailable";
export type PatientConfirmationState = "confirmed" | "discussed_not_confirmed" | "declined" | "unavailable";

export type Disposition =
  | "discharged_home"
  | "short_stay"
  | "mental_health_admission"
  | "medical_admission"
  | "transfer"
  | "left_before_completion"
  | "other";

export type PlanAvailability = "available" | "unavailable" | "not_applicable";
export type PlanUse = "used" | "partially_used" | "not_used" | "not_applicable";
export type PlanHelpfulness = "helpful" | "mixed" | "not_helpful" | "not_assessed";

export type PrototypeScenario =
  | "normal"
  | "empty"
  | "no-current-plan"
  | "overdue-plan"
  | "withdrawn-plan"
  | "unverified-contact"
  | "identity-uncertain"
  | "version-conflict"
  | "offline"
  | "permission-unavailable"
  | "launch-failure"
  | "print-failure";

export type ManagementPlanContent = {
  // First-minute tier. All five are required before a version can be approved,
  // and together they are the entire Current Plan summary card, in this order.
  howToApproach: readonly string[];
  whatHelps: readonly string[];
  whatMakesItWorse: readonly string[];
  agreedEdApproach: readonly string[];
  whatWouldMakeThisDifferent: readonly string[];
  // Full-plan tier. Only whyThisPlanExists is required; the rest may be empty
  // and render as `Not recorded` rather than being silently omitted.
  whyThisPlanExists: string;
  whatThePersonWants: readonly string[];
  practicalNeeds: readonly string[];
  physicalHealthAndMedication: readonly string[];
  whoElseIsInvolved: readonly string[];
  reviewTriggers: readonly string[];
};

export const MANAGEMENT_PLAN_REQUIRED_CONTENT_KEYS = [
  "howToApproach",
  "whatHelps",
  "whatMakesItWorse",
  "agreedEdApproach",
  "whatWouldMakeThisDifferent",
  "whyThisPlanExists",
] as const satisfies readonly (keyof ManagementPlanContent)[];

export const FIRST_MINUTE_CONTENT_KEYS = [
  "howToApproach",
  "whatHelps",
  "whatMakesItWorse",
  "agreedEdApproach",
  "whatWouldMakeThisDifferent",
] as const satisfies readonly (keyof ManagementPlanContent)[];

/** Review clock. Default next-review interval and the amber warning window,
 *  shared by the Management Plan and the Personal Safety Plan. The interval is
 *  an editable default per version, never an enforced rule. */
export const REVIEW_INTERVAL_MONTHS = 12;
export const REVIEW_DUE_SOON_DAYS = 28;

export type SafetyPlanContent = {
  warningSigns: readonly string[];
  saferSurroundings: readonly string[];
  reasonsForLiving: readonly string[];
  selfStrategies: readonly string[];
  connectionPeopleAndPlaces: readonly string[];
  personalSupports: readonly { name: string; relationship: string; phone: string }[];
  professionalAndEmergencySupport: readonly string[];
};

export type IdentificationPolicy = {
  id: SyntheticId;
  status: "pending_governance";
  thresholdCount: null;
  thresholdLookbackMonths: null;
  manualReferralEnabled: true;
  explanation: string;
};

export type PrototypeUser = {
  id: SyntheticId;
  displayName: string;
  title: string;
  role: PrototypeRole;
};

export type Patient = {
  id: SyntheticId;
  fullName: string;
  preferredName: string;
  aliases: readonly string[];
  mrn: SyntheticId;
  dateOfBirth: string;
  ageCohort: "adult" | "older_adult";
  pronouns: string;
  homeHealthService: string;
  cmhtId: SyntheticId;
  managementPlanId: SyntheticId;
  personalSafetyPlanId: SyntheticId;
};

export type EdSite = { id: SyntheticId; name: string; healthService: string };

export type CmhtContact = {
  id: SyntheticId;
  name: string;
  catchment: string;
  sharedMailbox: string;
  dutyTelephoneDisplay: string;
  dutyTelephoneUri: string;
  operatingHours: string;
  timezone: "Australia/Perth";
  careCoordinator: string | null;
  afterHoursLabel: string;
  afterHoursTelephoneDisplay: string;
  afterHoursTelephoneUri: string;
  verifiedAt: string;
  verificationState: "verified" | "review_due" | "unverified";
};

/**
 * The only intentionally non-fictional contact details in the prototype: the
 * verified public crisis lines. Everything else in the fixtures is invented.
 */
export type PublicCrisisContact = {
  id: SyntheticId;
  name: string;
  telephoneDisplay: string;
  telephoneUri: string;
  coverage: string;
  availability: string;
  isEmergencyService: boolean;
  /** Stated limitation shown wherever the number is shown, or null when none applies. */
  caveat: string | null;
  sourceUrl: string;
  verifiedOn: string;
};

export type PatientPlanVersionState = "draft" | "current" | "superseded";

export const PATIENT_PLAN_SECTION_KEYS = [
  "whyWeWroteThis",
  "whatMattersToYou",
  "whatHelpsYou",
  "whatMakesThingsHarder",
  "whatWeAgreedWillHappen",
  "ifSomethingNewIsHappening",
  "whoIsInvolved",
  "thingsThatMightHelp",
] as const;

export type PatientPlanSectionKey = (typeof PATIENT_PLAN_SECTION_KEYS)[number];

export type PatientPlanSection = {
  key: PatientPlanSectionKey;
  heading: string;
  /** Converted content. Always empty when `gap` is true — the transformation
   *  never guesses, so a gap carries no partial text to be mistaken for one. */
  body: readonly string[];
  gap: boolean;
  gapReason: string | null;
};

export type PatientResourceCategory =
  | "care_team"
  | "local_service"
  | "housing"
  | "financial"
  | "transport"
  | "carer_support"
  | "alcohol_and_other_drugs"
  | "cultural_or_peer"
  | "crisis_contact"
  | "self_help_reading";

export type PatientResource = {
  id: SyntheticId;
  /** Resources are chosen for one person, not offered from a single national
   *  list: a housing service in one catchment is no use in another, and a
   *  resource sheet that cannot be wrong for somebody is not a resource sheet.
   *  So every entry names the person it was chosen for. */
  patientId: SyntheticId;
  category: PatientResourceCategory;
  name: string;
  detail: string;
  contact: string | null;
  sourceUrl: string | null;
  /** True only for the verified public crisis lines. Everything else in the
   *  prototype is invented, and a printed sheet must be able to say which is
   *  which rather than leaving a reader to dial a fictional number. */
  isRealContact: boolean;
};

export type PatientPlan = {
  id: SyntheticId;
  patientId: SyntheticId;
  versionIds: readonly SyntheticId[];
  currentVersionId: SyntheticId | null;
};

export type PatientPlanVersion = {
  id: SyntheticId;
  planId: SyntheticId;
  version: number;
  state: PatientPlanVersionState;
  derivedFromManagementVersionId: SyntheticId;
  sections: readonly PatientPlanSection[];
  resources: readonly PatientResource[];
  approvedBy: SyntheticId | null;
  approvedAt: string | null;
  createdAt: string;
};

export type ManagementPlan = {
  id: SyntheticId;
  patientId: SyntheticId;
  versionIds: readonly SyntheticId[];
  currentVersionId: SyntheticId | null;
};

export type ManagementPlanVersion = {
  id: SyntheticId;
  planId: SyntheticId;
  version: number;
  state: ManagementPlanVersionState;
  authorId: SyntheticId;
  ownerId: SyntheticId;
  approverId: SyntheticId | null;
  createdAt: string;
  submittedAt: string | null;
  approvedAt: string | null;
  reviewDueAt: string | null;
  revisionReason: string;
  participationState: ParticipationState;
  consentedSupportPeople: readonly string[];
  returnedReason: string | null;
  withdrawalReason: string | null;
  withdrawnBy: SyntheticId | null;
  withdrawnAt: string | null;
  /** When the person was shown their own plan, or null if they have not been. */
  sharedWithPatientAt: string | null;
  content: ManagementPlanContent;
};

export type PersonalSafetyPlan = {
  id: SyntheticId;
  patientId: SyntheticId;
  versionIds: readonly SyntheticId[];
  currentVersionId: SyntheticId | null;
};

export type PersonalSafetyPlanVersion = {
  id: SyntheticId;
  planId: SyntheticId;
  version: number;
  state: SafetyPlanVersionState;
  authorId: SyntheticId;
  createdAt: string;
  confirmedAt: string | null;
  reviewDueAt: string | null;
  patientConfirmation: PatientConfirmationState;
  collaborationNote: string;
  content: SafetyPlanContent;
};

export type EdPresentation = {
  id: SyntheticId;
  patientId: SyntheticId;
  arrivedAt: string;
  siteId: SyntheticId;
  /** Optional detail. Empty string means the recorder did not fill it in; render
   *  as `Not recorded`, never as an invented or inferred value. */
  presentingIndication: string;
  /** Optional detail, as above. */
  assessmentOutcome: string;
  /** Required free text: anything worth flagging. May be an empty string only
   *  when the recorder explicitly had nothing to add. */
  note: string;
  disposition: Disposition;
  /** Optional detail, as above. */
  cmhtContactAttempt: "not_attempted" | "attempted";
  /** Optional detail, as above. */
  cmhtContactOutcome: string;
  managementPlanVersionId: SyntheticId | null;
  planAvailability: PlanAvailability;
  planUse: PlanUse;
  planHelpfulness: PlanHelpfulness;
  deviationOccurred: boolean;
  deviationReason: string | null;
  reviewSuggested: boolean;
  reviewReason: string | null;
  recordedBy: SyntheticId;
  recordedAt: string;
};

/** The fields an ED Presentation correction may replace. The three plan-use
 *  answers are grouped in the interface, but each changed answer records its own
 *  attributed amendment, so one amendment is always exactly one field. */
export type AmendableField =
  "assessmentOutcome" | "disposition" | "note" | "planAvailability" | "planUse" | "planHelpfulness";

export type PresentationAmendment = {
  id: SyntheticId;
  presentationId: SyntheticId;
  field: AmendableField;
  originalValue: string;
  replacementValue: string;
  reason: string;
  authorId: SyntheticId;
  amendedAt: string;
};

export type ReviewTrigger = {
  id: SyntheticId;
  patientId: SyntheticId;
  managementPlanId: SyntheticId;
  source:
    | "plan_use_feedback"
    | "presentation_outcome"
    | "plan_deviation"
    | "formal_review"
    | "contact_verification"
    /** Raised when a version is approved at `declined` or `patient_unavailable`
     *  participation, so involving the person stays on somebody's list. The
     *  persistent on-screen marker alone is not enough: a marker is read only
     *  by whoever opens that plan, while a trigger reaches the Reviews queue. */
    | "participation"
    /** Raised when a newer Management Plan Version is approved while the person
     *  holds a Current Patient Plan derived from the version it replaced. The
     *  patient copy is never regenerated or withdrawn automatically — the person
     *  may be holding it on paper — so the discrepancy has to reach a human
     *  instead. Deduplicated per plan: one open trigger, however many versions
     *  are approved before somebody acts on it. */
    | "patient_plan_stale";
  sourceId: SyntheticId;
  reason: string;
  status: "open" | "resolved";
  createdAt: string;
  resolvedAt: string | null;
  resolution: string | null;
};

export type IdentificationDecision = "proceed_to_plan" | "not_needed_now" | "revisit_later";

export type IdentificationReview = {
  id: SyntheticId;
  patientId: SyntheticId;
  reason: string;
  referredBy: SyntheticId;
  referredAt: string;
  status: "open" | "closed";
  decision: IdentificationDecision | null;
  decisionReason: string | null;
  decidedBy: SyntheticId | null;
  decidedAt: string | null;
};

export type AuditEventType =
  | "management_draft_created"
  | "management_draft_saved"
  | "management_version_submitted"
  | "management_version_returned"
  | "management_version_approved"
  | "management_version_withdrawn"
  | "management_review_recorded"
  | "presentation_recorded"
  | "presentation_amended"
  | "safety_plan_draft_created"
  | "safety_plan_draft_saved"
  | "safety_plan_made_current"
  | "safety_plan_print_intent_opened"
  | "management_plan_print_intent_opened"
  | "management_plan_shared_with_patient"
  | "patient_plan_draft_created"
  | "patient_plan_draft_saved"
  | "patient_plan_approved"
  | "patient_plan_print_intent_opened"
  | "email_intent_opened"
  | "call_intent_opened"
  | "identification_review_created"
  | "identification_review_closed"
  | "cmht_contact_verified"
  | "review_trigger_resolved";

export type AuditEvent = {
  id: SyntheticId;
  type: AuditEventType;
  patientId: SyntheticId | null;
  objectId: SyntheticId;
  actorId: SyntheticId;
  occurredAt: string;
  evidence: string;
};

export type PrototypeOutcome = {
  kind: "success" | "blocked" | "info" | "error";
  message: string;
};

export type CarePlanPrototypeState = {
  scenario: PrototypeScenario;
  persistence: "memory-only";
  activeUserId: SyntheticId;
  selectedPatientId: SyntheticId | null;
  connectivity: { online: boolean };
  permission: { available: boolean };
  identity: { certain: boolean };
  versionConflict: { active: boolean };
  users: PrototypeUser[];
  patients: Patient[];
  edSites: EdSite[];
  cmhtContacts: CmhtContact[];
  managementPlans: ManagementPlan[];
  managementPlanVersions: ManagementPlanVersion[];
  personalSafetyPlans: PersonalSafetyPlan[];
  personalSafetyPlanVersions: PersonalSafetyPlanVersion[];
  patientPlans: PatientPlan[];
  patientPlanVersions: PatientPlanVersion[];
  patientResources: PatientResource[];
  edPresentations: EdPresentation[];
  presentationAmendments: PresentationAmendment[];
  reviewTriggers: ReviewTrigger[];
  identificationPolicy: IdentificationPolicy;
  identificationReviews: IdentificationReview[];
  auditEvents: AuditEvent[];
  lastOutcome: PrototypeOutcome | null;
};

export type ManagementDraftInput = {
  ownerId: SyntheticId;
  reviewDueAt: string;
  revisionReason: string;
  participationState: ParticipationState;
  consentedSupportPeople: readonly string[];
  content: ManagementPlanContent;
};

export type SafetyPlanDraftInput = {
  reviewDueAt: string;
  patientConfirmation: PatientConfirmationState;
  collaborationNote: string;
  content: SafetyPlanContent;
};

/**
 * What a clinician's edit of a patient copy replaces. Sections and resources are
 * replaced whole rather than patched: a partial update of a document written in
 * somebody's own voice is how half a converted sentence and half a clinician's
 * rewrite end up in one paragraph.
 */
export type PatientPlanDraftInput = {
  sections: readonly PatientPlanSection[];
  resources: readonly PatientResource[];
};

export type NewEdPresentationInput = Omit<EdPresentation, "id" | "recordedBy" | "recordedAt">;

/**
 * Objective Presentation Activity over one explicitly named observation window.
 * Counts describe what happened. They never create eligibility, a label, a risk
 * state, a severity claim, or a plan — that is the Identification Policy's job,
 * and it stays `pending_governance` with no numeric rule.
 */
export type PresentationActivity = {
  patientId: SyntheticId;
  windowMonths: number;
  windowStart: string;
  windowEnd: string;
  total: number;
  bySite: readonly { siteId: SyntheticId; count: number }[];
};

/** The four action worklists on the Reviews route. Worklists, not dashboards:
 *  they are ordered oldest-actionable-first and never ranked by severity. */
export type ReviewQueues = {
  awaitingApproval: readonly ManagementPlanVersion[];
  reviewSuggested: readonly ReviewTrigger[];
  contactVerification: readonly CmhtContact[];
  identificationReview: readonly IdentificationReview[];
};

export type ReviewQueueSource = {
  managementPlanVersions: readonly ManagementPlanVersion[];
  reviewTriggers: readonly ReviewTrigger[];
  cmhtContacts: readonly CmhtContact[];
  identificationReviews: readonly IdentificationReview[];
};

export type PatientSnapshotSource = {
  patients: readonly Patient[];
  cmhtContacts: readonly CmhtContact[];
  managementPlans: readonly ManagementPlan[];
  managementPlanVersions: readonly ManagementPlanVersion[];
  personalSafetyPlans: readonly PersonalSafetyPlan[];
  personalSafetyPlanVersions: readonly PersonalSafetyPlanVersion[];
  edPresentations: readonly EdPresentation[];
};

/** Everything the reading surface needs about one patient, assembled once. */
export type PatientSnapshot = {
  patient: Patient;
  cmht: CmhtContact | null;
  managementPlan: ManagementPlan | null;
  currentManagementVersion: ManagementPlanVersion | null;
  openManagementDraft: ManagementPlanVersion | null;
  /** Set only when there is no Current version and the plan was withdrawn, so a
   *  withdrawn plan never renders as though the person never had one. */
  withdrawnManagementVersion: ManagementPlanVersion | null;
  currentSafetyPlanVersion: PersonalSafetyPlanVersion | null;
  reviewState: ReviewState | null;
  presentationActivity: PresentationActivity;
  /** Reverse-chronological, newest first. */
  presentations: readonly EdPresentation[];
};

/**
 * Illustrative responsibilities, not authentication, RBAC, relationship-based
 * access, or break-glass evidence. The displayed synthetic role explains why an
 * action is offered; nothing here protects data.
 */
export type PrototypeCapability =
  | "read_plan"
  | "contact_cmht"
  | "record_presentation"
  | "author_management_draft"
  | "submit_management_draft"
  | "approve_management_version"
  | "withdraw_management_version"
  | "record_formal_review"
  | "author_safety_plan"
  | "approve_patient_plan"
  | "verify_cmht_contact"
  | "refer_for_identification_review"
  | "close_identification_review"
  | "manage_worklists";

/**
 * Every state change in the prototype travels through one of these actions, so
 * the reducer is the single place a lifecycle rule can be enforced. Each action
 * joins this union in the task that implements it: an action nobody dispatches
 * would only be a dead branch in an otherwise exhaustive switch, and a dead
 * branch is where an unenforced transition hides.
 *
 * The four Patient Plan actions joined in Task 9, which is the task that
 * implements them. Nothing else is outstanding.
 */
export type CarePlanPrototypeAction =
  | { type: "select-patient"; patientId: SyntheticId }
  | { type: "set-active-user"; userId: SyntheticId }
  | { type: "create-management-draft"; patientId: SyntheticId }
  | { type: "save-management-draft"; versionId: SyntheticId; input: ManagementDraftInput }
  | { type: "submit-management-draft"; versionId: SyntheticId }
  | { type: "return-management-version"; versionId: SyntheticId; reason: string }
  | { type: "approve-management-version"; versionId: SyntheticId }
  | { type: "withdraw-current-management-version"; patientId: SyntheticId; reason: string }
  | {
      type: "record-formal-management-review";
      patientId: SyntheticId;
      reason: string;
      nextReviewDueAt: string;
    }
  /** Records that the person has been shown their own Current Plan. It writes one
   *  date and one audit event; it never produces a Patient Plan. */
  | { type: "record-plan-shared-with-patient"; patientId: SyntheticId }
  | { type: "record-presentation"; presentationId: SyntheticId; input: NewEdPresentationInput }
  | {
      type: "amend-presentation";
      presentationId: SyntheticId;
      field: AmendableField;
      replacementValue: string;
      reason: string;
    }
  | { type: "create-safety-plan-draft"; patientId: SyntheticId }
  | { type: "save-safety-plan-draft"; versionId: SyntheticId; input: SafetyPlanDraftInput }
  | { type: "make-safety-plan-current"; versionId: SyntheticId }
  /** Derives a patient edition from the Current Management Plan Version. It
   *  refuses when there is none: a patient copy of a plan nobody has approved
   *  would be a document in somebody's hands describing care nobody agreed. */
  | { type: "create-patient-plan-draft"; patientId: SyntheticId }
  | { type: "save-patient-plan-draft"; versionId: SyntheticId; input: PatientPlanDraftInput }
  /** Any clinical role may approve a patient copy. Requiring a senior clinician
   *  would mean a person waits days for their own copy of their own plan, which
   *  defeats the point of giving them one. What approval does require is that
   *  every flagged gap has been filled: a gap is a place the transformation
   *  refused to guess, and an unfilled one would print as a blank heading. */
  | { type: "approve-patient-plan-version"; versionId: SyntheticId }
  | { type: "record-patient-plan-print-intent"; patientId: SyntheticId }
  | { type: "record-safety-plan-print-intent"; patientId: SyntheticId }
  | { type: "record-management-plan-print-intent"; patientId: SyntheticId }
  | { type: "record-contact-intent"; patientId: SyntheticId; cmhtId: SyntheticId; channel: "email" | "call" }
  | { type: "create-identification-review"; patientId: SyntheticId; reason: string }
  | {
      type: "close-identification-review";
      reviewId: SyntheticId;
      decision: IdentificationDecision;
      decisionReason: string;
    }
  | { type: "verify-cmht-contact"; cmhtId: SyntheticId }
  | { type: "resolve-review-trigger"; triggerId: SyntheticId; resolution: string }
  | { type: "apply-scenario"; scenario: PrototypeScenario }
  | { type: "clear-outcome" }
  | { type: "reset" };
