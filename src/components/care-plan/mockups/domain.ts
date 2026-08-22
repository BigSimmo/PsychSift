/**
 * Care Plan — pure domain selectors.
 *
 * Every function here is a pure function of the arguments it is given. Nothing
 * reads a clock, a network, storage, or a random source: `now` is always passed
 * in, so the whole prototype is reproducible. Nothing mutates its inputs.
 *
 * These selectors read and derive. They never enrol a patient, create a plan,
 * or turn an observation into an eligibility decision.
 */

import {
  REVIEW_DUE_SOON_DAYS,
  type AmendableField,
  type CmhtContact,
  type EdPresentation,
  type PresentationAmendment,
  type ManagementPlanVersion,
  type Patient,
  type PatientPlanVersion,
  type PatientSnapshot,
  type PatientSnapshotSource,
  type PersonalSafetyPlanVersion,
  type PresentationActivity,
  type PrototypeCapability,
  type PrototypeRole,
  type ReviewQueueSource,
  type ReviewQueues,
  type ReviewState,
  type SyntheticId,
} from "./types";

const PERTH_OFFSET_MINUTES = 8 * 60;
const PERTH_OFFSET_SUFFIX = "+08:00";
const MILLISECONDS_PER_DAY = 86_400_000;

/** Australia/Perth never observes daylight saving, so a fixed offset is exact. */
function toPerthWallClock(iso: string): Date {
  return new Date(Date.parse(iso) + PERTH_OFFSET_MINUTES * 60_000);
}

function formatPerthIso(wallClock: Date): string {
  return `${wallClock.toISOString().slice(0, 19)}${PERTH_OFFSET_SUFFIX}`;
}

/** Shift an ISO timestamp by whole days, returning Perth-local ISO. */
export function addIsoDays(iso: string, days: number): string {
  return formatPerthIso(new Date(toPerthWallClock(iso).getTime() + days * MILLISECONDS_PER_DAY));
}

/** Shift an ISO timestamp by whole calendar months, clamping to the last day of
 *  a shorter target month so 31 January plus one month is 28 or 29 February. */
export function addIsoMonths(iso: string, months: number): string {
  const base = toPerthWallClock(iso);
  const shifted = new Date(base.getTime());
  shifted.setUTCMonth(shifted.getUTCMonth() + months);
  if (shifted.getUTCDate() !== base.getUTCDate()) shifted.setUTCDate(0);
  return formatPerthIso(shifted);
}

/**
 * The named observation window for Presentation Activity. It describes what is
 * counted and over what period. It is not a threshold: no count here creates
 * eligibility, a label, a risk state, a care pathway, or a plan.
 */
export const PRESENTATION_ACTIVITY_WINDOW_MONTHS = 12;

/**
 * Prohibitive admission phrasings, banned outright in plan content, interface
 * copy, and examples. A continuity plan that says the person should not be
 * admitted can be read at 3am as a pre-authorised refusal by a clinician who
 * has never met them, and the person is not there to argue with it. The agreed
 * ED approach is written as an agreed default that names who agreed it and
 * when, never as a ceiling on care.
 *
 * Compared case-insensitively against the candidate text.
 */
export const BANNED_ADMISSION_CONSTRUCTIONS: readonly string[] = [
  "should not be admitted",
  "should not admit",
  "must not be admitted",
  "not to be admitted",
  "do not admit",
  "never admit",
  "no admission",
  "not for admission",
  "avoid admission",
  "admission should be avoided",
  "admission is not indicated",
  "admission is not appropriate",
  "admission is not warranted",
  "does not require admission",
  "does not need admission",
  "should be discharged",
  "must be discharged",
];

const CAPABILITIES_BY_ROLE: Record<PrototypeRole, readonly PrototypeCapability[]> = {
  // ED clinician: find and read the Current Plan, record a presentation,
  // capture plan-use feedback, and reach the team.
  ed_clinician: [
    "read_plan",
    "contact_cmht",
    "record_presentation",
    "author_safety_plan",
    "approve_patient_plan",
    "refer_for_identification_review",
  ],
  // Liaison and CMHT clinicians: create and edit drafts, co-produce the
  // Personal Safety Plan, verify contacts, and respond to review triggers.
  liaison_clinician: [
    "read_plan",
    "contact_cmht",
    "record_presentation",
    "author_management_draft",
    "submit_management_draft",
    "author_safety_plan",
    "approve_patient_plan",
    "verify_cmht_contact",
    "refer_for_identification_review",
    "close_identification_review",
    "manage_worklists",
  ],
  cmht_clinician: [
    "read_plan",
    "contact_cmht",
    "record_presentation",
    "author_management_draft",
    "submit_management_draft",
    "author_safety_plan",
    "approve_patient_plan",
    "verify_cmht_contact",
    "refer_for_identification_review",
    "close_identification_review",
    "manage_worklists",
  ],
  // Named senior clinician: additionally compare, return, approve, withdraw,
  // and record formal review.
  senior_clinician: [
    "read_plan",
    "contact_cmht",
    "record_presentation",
    "author_management_draft",
    "submit_management_draft",
    "approve_management_version",
    "withdraw_management_version",
    "record_formal_review",
    "author_safety_plan",
    "approve_patient_plan",
    "verify_cmht_contact",
    "refer_for_identification_review",
    "close_identification_review",
    "manage_worklists",
  ],
  // Plan coordinator is non-clinical: worklists, without clinical authorship,
  // approval, or any clinical-severity judgment.
  plan_coordinator: [
    "read_plan",
    "contact_cmht",
    "refer_for_identification_review",
    "close_identification_review",
    "manage_worklists",
  ],
};

/** Generic, non-clinical subject line. It carries no patient information. */
export const CMHT_CONTACT_SUBJECT = "Care Plan — team contact request";

export type CmhtTelephoneChannel = "duty" | "after_hours";

function byIsoAscending<T>(select: (item: T) => string): (left: T, right: T) => number {
  return (left, right) => Date.parse(select(left)) - Date.parse(select(right));
}

function formatDisplayDateOfBirth(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return year && month && day ? `${day}/${month}/${year}` : isoDate;
}

/** The only fields patient search is allowed to read. Deliberately no plan,
 *  presentation, safety-plan, cultural, support-person, or clinical text. */
function searchableIdentityFields(patient: Patient): readonly string[] {
  return [
    patient.fullName,
    patient.preferredName,
    ...patient.aliases,
    patient.mrn,
    patient.dateOfBirth,
    formatDisplayDateOfBirth(patient.dateOfBirth),
  ];
}

export function searchPatients(patients: readonly Patient[], query: string): Patient[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [];
  return patients.filter((patient) =>
    searchableIdentityFields(patient).some((field) => field.toLowerCase().includes(needle)),
  );
}

export function getPatientById(patients: readonly Patient[], id: SyntheticId): Patient | null {
  return patients.find((patient) => patient.id === id) ?? null;
}

export function getCurrentManagementPlanVersion(
  versions: readonly ManagementPlanVersion[],
  planId: SyntheticId,
): ManagementPlanVersion | null {
  return versions.find((version) => version.planId === planId && version.state === "current") ?? null;
}

/**
 * The version being worked on: a Draft, or a Draft already submitted and
 * awaiting a senior decision. It never displaces the Current Plan; callers show
 * both. When more than one exists the highest version number wins.
 */
export function getOpenManagementDraft(
  versions: readonly ManagementPlanVersion[],
  planId: SyntheticId,
): ManagementPlanVersion | null {
  const open = versions.filter(
    (version) => version.planId === planId && (version.state === "draft" || version.state === "awaiting_approval"),
  );
  if (open.length === 0) return null;
  return open.reduce((latest, version) => (version.version > latest.version ? version : latest));
}

export function getCurrentSafetyPlanVersion(
  versions: readonly PersonalSafetyPlanVersion[],
  planId: SyntheticId,
): PersonalSafetyPlanVersion | null {
  return versions.find((version) => version.planId === planId && version.state === "current") ?? null;
}

/**
 * The Personal Safety Plan version being worked on. There is at most one — the
 * reducer refuses to open a second — and it never displaces the version in use:
 * a draft is not this person's plan yet, and both the reading surface and the
 * authoring form show that plainly.
 *
 * Unlike the Management Plan there is no `awaiting_approval` state to consider,
 * because this document is the person's own and waits on no senior decision.
 */
export function getOpenSafetyPlanDraft(
  versions: readonly PersonalSafetyPlanVersion[],
  planId: SyntheticId,
): PersonalSafetyPlanVersion | null {
  const open = versions.filter((version) => version.planId === planId && version.state === "draft");
  if (open.length === 0) return null;
  return open.reduce((latest, version) => (version.version > latest.version ? version : latest));
}

export function getCurrentPatientPlanVersion(
  versions: readonly PatientPlanVersion[],
  planId: SyntheticId,
): PatientPlanVersion | null {
  return versions.find((version) => version.planId === planId && version.state === "current") ?? null;
}

/** The patient edition being worked on. As with the Personal Safety Plan there
 *  is no `awaiting_approval` state: a patient copy waits on any clinical role,
 *  not on a senior decision. */
export function getOpenPatientPlanDraft(
  versions: readonly PatientPlanVersion[],
  planId: SyntheticId,
): PatientPlanVersion | null {
  const open = versions.filter((version) => version.planId === planId && version.state === "draft");
  if (open.length === 0) return null;
  return open.reduce((latest, version) => (version.version > latest.version ? version : latest));
}

/**
 * Whether a patient copy still describes the Management Plan in use.
 *
 * Always derived from the two identifiers, never stored. A stored flag would
 * have to be written by whatever changed the Management Plan, and the one thing
 * certain about a document already printed and carried away is that nothing in
 * this application can reach it — so the flag would be the part most likely to
 * be wrong, on the question that most needs to be right.
 *
 * A stale copy stays fully readable and is never regenerated, hidden, or
 * withdrawn on the person's behalf. They may be holding the paper; the
 * application's account of what they were given has to stay true to it.
 *
 * A `null` Management Plan current-version identifier means the Management
 * Plan was withdrawn with nothing approved to replace it — not that nothing
 * ever compares. A current Patient Plan version can only exist if a
 * Management Plan was once approved for it to be derived from, so a source
 * that is now current-less is exactly the "moved on underneath the copy"
 * case this function exists to catch, and is stale by the same reasoning as
 * a source that moved on to a different version.
 */
export function isPatientPlanVersionStale(
  version: PatientPlanVersion | null,
  managementPlanCurrentVersionId: SyntheticId | null,
): boolean {
  if (version === null || version.state !== "current") return false;
  // A withdrawn source is not a safe exception. The patient copy still exists
  // and may already be on paper, but there is no Current Management Plan for it
  // to represent, so it has to carry the same needs-updating state as a copy
  // made from an older Current version. `derivedFromManagementVersionId` is
  // never `null` on a real version, so this comparison alone already covers
  // it without a separate early return.
  return version.derivedFromManagementVersionId !== managementPlanCurrentVersionId;
}

/** The most recent withdrawn version, used only to keep a withdrawn plan from
 *  rendering identically to a patient who never had one. */
function getWithdrawnManagementVersion(
  versions: readonly ManagementPlanVersion[],
  planId: SyntheticId,
): ManagementPlanVersion | null {
  const withdrawn = versions.filter((version) => version.planId === planId && version.state === "withdrawn");
  if (withdrawn.length === 0) return null;
  return withdrawn.reduce((latest, version) => (version.version > latest.version ? version : latest));
}

/**
 * Objective counts over a named window. The window is half-open: a presentation
 * exactly on the window start falls outside it, and one at the window end falls
 * inside. Counts are an observation; they decide nothing.
 */
export function countPresentationActivity(
  presentations: readonly EdPresentation[],
  patientId: SyntheticId,
  now: string,
  windowMonths: number = PRESENTATION_ACTIVITY_WINDOW_MONTHS,
): PresentationActivity {
  const windowEnd = now;
  const windowStart = addIsoMonths(now, -windowMonths);
  const startMs = Date.parse(windowStart);
  const endMs = Date.parse(windowEnd);

  const inWindow = presentations.filter((presentation) => {
    if (presentation.patientId !== patientId) return false;
    const arrivedMs = Date.parse(presentation.arrivedAt);
    return arrivedMs > startMs && arrivedMs <= endMs;
  });

  const countsBySite = new Map<SyntheticId, number>();
  for (const presentation of inWindow) {
    countsBySite.set(presentation.siteId, (countsBySite.get(presentation.siteId) ?? 0) + 1);
  }

  const bySite = [...countsBySite.entries()]
    .map(([siteId, count]) => ({ siteId, count }))
    .sort((left, right) => right.count - left.count || left.siteId.localeCompare(right.siteId));

  return { patientId, windowMonths, windowStart, windowEnd, total: inWindow.length, bySite };
}

/**
 * Every correction recorded against one episode, oldest first, optionally
 * narrowed to a single field. Corrections are appended, never rewritten, so the
 * array order is the chronology.
 */
export function getPresentationAmendments(
  amendments: readonly PresentationAmendment[],
  presentationId: SyntheticId,
  field?: AmendableField,
): PresentationAmendment[] {
  return amendments.filter(
    (amendment) => amendment.presentationId === presentationId && (field === undefined || amendment.field === field),
  );
}

/**
 * The value an amendable field currently carries: the latest correction for that
 * field when it has been corrected, otherwise the value stored on the episode.
 * The episode itself is never rewritten, so the stored value always survives.
 *
 * The write path in `prototype-state.ts` resolves the same question before it
 * appends a correction, and calls this rather than keeping its own copy — a
 * reading surface and the reducer disagreeing about what "the current value" is
 * would let a correction be refused as a no-op while the screen showed something
 * else.
 */
export function getEffectivePresentationValue(
  amendments: readonly PresentationAmendment[],
  presentation: EdPresentation,
  field: AmendableField,
): string {
  return getPresentationAmendments(amendments, presentation.id, field).at(-1)?.replacementValue ?? presentation[field];
}

/**
 * The value the field was first recorded as, which is what a reader must still
 * see beside every correction.
 *
 * It reads the first correction's `originalValue` rather than the stored field.
 * For anything this prototype records the two are the same string, because the
 * reducer never rewrites an episode — but the seeded fixtures carry the
 * corrected value on the episode as well, so reading the stored field there
 * would print the correction twice and lose the thing it replaced.
 */
export function getRecordedPresentationValue(
  amendments: readonly PresentationAmendment[],
  presentation: EdPresentation,
  field: AmendableField,
): string {
  return getPresentationAmendments(amendments, presentation.id, field)[0]?.originalValue ?? presentation[field];
}

export function buildPatientSnapshot(
  source: PatientSnapshotSource,
  patientId: SyntheticId,
  now: string,
): PatientSnapshot | null {
  const patient = getPatientById(source.patients, patientId);
  if (patient === null) return null;

  const managementPlan = source.managementPlans.find((plan) => plan.id === patient.managementPlanId) ?? null;
  const currentManagementVersion =
    managementPlan === null ? null : getCurrentManagementPlanVersion(source.managementPlanVersions, managementPlan.id);
  const openManagementDraft =
    managementPlan === null ? null : getOpenManagementDraft(source.managementPlanVersions, managementPlan.id);
  const withdrawnManagementVersion =
    managementPlan === null || currentManagementVersion !== null
      ? null
      : getWithdrawnManagementVersion(source.managementPlanVersions, managementPlan.id);

  const personalSafetyPlan =
    source.personalSafetyPlans.find((plan) => plan.id === patient.personalSafetyPlanId) ?? null;
  const currentSafetyPlanVersion =
    personalSafetyPlan === null
      ? null
      : getCurrentSafetyPlanVersion(source.personalSafetyPlanVersions, personalSafetyPlan.id);

  const reviewDueAt = currentManagementVersion?.reviewDueAt ?? null;

  return {
    patient,
    cmht: source.cmhtContacts.find((contact) => contact.id === patient.cmhtId) ?? null,
    managementPlan,
    currentManagementVersion,
    openManagementDraft,
    withdrawnManagementVersion,
    currentSafetyPlanVersion,
    reviewState: reviewDueAt === null ? null : deriveReviewState(reviewDueAt, now),
    presentationActivity: countPresentationActivity(source.edPresentations, patient.id, now),
    presentations: source.edPresentations
      .filter((presentation) => presentation.patientId === patient.id)
      .sort((left, right) => Date.parse(right.arrivedAt) - Date.parse(left.arrivedAt)),
  };
}

/**
 * Opens an external mail application with the team's shared mailbox and a
 * generic subject. It carries no name, MRN, date of birth, presentation
 * content, or plan content, and it is never evidence that anything was sent.
 */
export function buildCmhtMailto(contact: CmhtContact): string {
  return `mailto:${contact.sharedMailbox}?${new URLSearchParams({ subject: CMHT_CONTACT_SUBJECT }).toString()}`;
}

/** Opens an external telephone application. It is never evidence of a call. */
export function buildCmhtTel(contact: CmhtContact, channel: CmhtTelephoneChannel = "duty"): string {
  return `tel:${channel === "duty" ? contact.dutyTelephoneUri : contact.afterHoursTelephoneUri}`;
}

/**
 * The four action worklists, each ordered oldest-actionable-first. They are
 * never ranked by severity, clinical urgency, or presentation count.
 */
export function getReviewQueues(source: ReviewQueueSource): ReviewQueues {
  return {
    awaitingApproval: source.managementPlanVersions
      .filter((version) => version.state === "awaiting_approval")
      .sort(byIsoAscending((version) => version.submittedAt ?? version.createdAt)),
    reviewSuggested: source.reviewTriggers
      .filter((trigger) => trigger.status === "open")
      .sort(byIsoAscending((trigger) => trigger.createdAt)),
    contactVerification: source.cmhtContacts
      .filter((contact) => contact.verificationState !== "verified")
      .sort(byIsoAscending((contact) => contact.verifiedAt)),
    identificationReview: source.identificationReviews
      .filter((review) => review.status === "open")
      .sort(byIsoAscending((review) => review.referredAt)),
  };
}

/** Interaction modelling only: it explains why an action is offered. It is not
 *  authentication, authorisation, or any protection of data. */
export function canPerformAction(role: PrototypeRole, capability: PrototypeCapability): boolean {
  return CAPABILITIES_BY_ROLE[role].includes(capability);
}

/**
 * The currency of a Current Plan against its review date. Past the date is
 * `overdue`; on or within `REVIEW_DUE_SOON_DAYS` of it is `due_soon`. An
 * overdue plan stays Current until it is reviewed, replaced, or withdrawn.
 *
 * Review state is always derived here and never stored on a version, so a
 * stored value cannot drift away from the date it claims to describe.
 */
export function deriveReviewState(reviewDueAt: string, now: string): ReviewState {
  const dueMs = Date.parse(reviewDueAt);
  const nowMs = Date.parse(now);
  // Degrade conservatively. An unreadable date must not resolve to the most
  // reassuring state on a clinical currency indicator, so it reads as overdue
  // and sends someone to look at the plan.
  if (Number.isNaN(dueMs) || Number.isNaN(nowMs)) return "overdue";
  if (nowMs > dueMs) return "overdue";
  if (dueMs - nowMs <= REVIEW_DUE_SOON_DAYS * MILLISECONDS_PER_DAY) return "due_soon";
  return "within_review";
}

/** Approval must produce exactly one Current version per plan. This guards that
 *  invariant wherever a version set is assembled. */
export function assertSingleCurrentVersion(versions: readonly ManagementPlanVersion[]): void {
  const currentIdsByPlan = new Map<SyntheticId, SyntheticId[]>();
  for (const version of versions) {
    if (version.state !== "current") continue;
    const existing = currentIdsByPlan.get(version.planId) ?? [];
    existing.push(version.id);
    currentIdsByPlan.set(version.planId, existing);
  }

  for (const [planId, ids] of currentIdsByPlan) {
    if (ids.length > 1) {
      throw new Error(`Management plan ${planId} has more than one current version: ${ids.join(", ")}`);
    }
  }
}
