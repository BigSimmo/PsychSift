"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { TextField } from "@/components/ui/text-field";
import { EmptyState, InlineNotice, ignoreUnavailableActivation } from "@/components/ui-primitives";

import styles from "./care-plan.module.css";
import { ContactActions } from "./contact-actions";
import { addIsoMonths, buildPatientSnapshot, canPerformAction, deriveReviewState } from "./domain";
import { PROTOTYPE_NOW } from "./fixtures";
import { PatientNavigation } from "./patient-navigation";
import { useCarePlanPrototype } from "./prototype-provider";
import { getPrototypeMutationBlockReason } from "./prototype-state";
import {
  CurrentPlanSummary,
  DefinitionRow,
  FIRST_MINUTE_SECTION_LABEL,
  FULL_PLAN_SECTION_KEYS,
  FULL_PLAN_SECTION_LABEL,
  MANAGEMENT_VERSION_STATE_LABEL,
  NOT_RECORDED,
  PROTOTYPE_OUTCOME_TONE,
  ParticipationMarker,
  PinnedSafetyBoundary,
  PlanTextArea,
  ReviewWarning,
  SectionFrame,
  StatusMark,
  SyntheticMarker,
  WHY_THIS_PLAN_EXISTS_LABEL,
  formatPerthDate,
} from "./prototype-ui";
import { CARE_PLAN_ROUTES, carePlanRoute } from "./routes";
import {
  FIRST_MINUTE_CONTENT_KEYS,
  REVIEW_INTERVAL_MONTHS,
  type CmhtContact,
  type ManagementPlanContent,
  type ManagementPlanVersion,
  type Patient,
  type PrototypeScenario,
  type PrototypeUser,
  type SyntheticId,
} from "./types";

/**
 * The full Management Plan reading surface.
 *
 * Reading comes first. The authoring and governance controls Task 6 added sit in
 * one block at the very foot of the page — below the plan, below the version in
 * progress, and below the team's telephone number — and each one appears only
 * for a role that carries it. A reader without authoring permission still sees a
 * clean reading surface with no placeholders standing in for controls they can
 * never use.
 *
 * The pinned safety boundary and the Current Plan summary card are the shared
 * components the Clinical Snapshot also renders, so a safety-critical element
 * cannot drift into two different renderings of itself.
 */

function displayName(users: readonly PrototypeUser[], id: SyntheticId | null): string | undefined {
  if (id === null) return undefined;
  return users.find((user) => user.id === id)?.displayName;
}

function PlanList({ items }: { items: readonly string[] }) {
  if (items.length === 0) return <p className={styles.sectionEmpty}>{NOT_RECORDED}</p>;
  return (
    <ul className={styles.contentList}>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function PlanSubsection({ id, heading, children }: { id: string; heading: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className={styles.fullPlanSection}>
      <h3 id={id} className={styles.subsectionHeading}>
        {heading}
      </h3>
      {children}
    </section>
  );
}

/** The full-plan tier beneath the summary card. */
function FullPlanTier({ content }: { content: ManagementPlanContent }) {
  return (
    <SectionFrame
      id="care-plan-full-plan"
      heading="The full plan"
      testId="care-plan-full-plan"
      description="Everything agreed beyond the first minute. Read it when there is time; the summary above is what to read when there is not."
    >
      <PlanSubsection id="care-plan-full-plan-whyThisPlanExists" heading={WHY_THIS_PLAN_EXISTS_LABEL}>
        {content.whyThisPlanExists.trim() === "" ? (
          <p className={styles.sectionEmpty}>{NOT_RECORDED}</p>
        ) : (
          <p className={styles.fullPlanProse}>{content.whyThisPlanExists}</p>
        )}
      </PlanSubsection>
      {FULL_PLAN_SECTION_KEYS.map((key) => (
        <PlanSubsection key={key} id={`care-plan-full-plan-${key}`} heading={FULL_PLAN_SECTION_LABEL[key]}>
          <PlanList items={content[key]} />
        </PlanSubsection>
      ))}
    </SectionFrame>
  );
}

/**
 * A version that is no longer in use, kept fully readable. Withdrawing a plan
 * takes it out of use; it does not delete what was agreed, and a later reader
 * asking what the team used to do has nowhere else to look.
 */
function SupersededContent({ version }: { version: ManagementPlanVersion }) {
  return (
    <SectionFrame
      id="care-plan-superseded-content"
      heading={`${MANAGEMENT_VERSION_STATE_LABEL[version.state]} version ${version.version}`}
      tone="secondary"
      testId="care-plan-superseded-content"
      description="This version is not in use. It stays readable so a reader can see what was agreed before, and no part of it has been restored."
    >
      {FIRST_MINUTE_CONTENT_KEYS.map((key) => (
        <PlanSubsection key={key} id={`care-plan-superseded-${key}`} heading={FIRST_MINUTE_SECTION_LABEL[key]}>
          <PlanList items={version.content[key]} />
        </PlanSubsection>
      ))}
    </SectionFrame>
  );
}

/**
 * The governance actions on a plan, and the only authoring entry point on this
 * page.
 *
 * Each control is rendered only when the signed-in role carries the capability
 * behind it. That is deliberate and is not the stated-reason pattern: a control
 * this role can never use tells a reader nothing they can act on, and five of
 * them in a row at the foot of a clinical document is exactly the crowding that
 * pushes reading content off a phone screen. Where the role *does* carry the
 * action but something else blocks it — offline, an unconfirmed identity, a
 * version conflict — the control stays, with the reducer's own reason beside it.
 *
 * The reducer is still the final guard for every one of them.
 */
function PlanActions({
  patient,
  currentVersion,
  openDraft,
}: {
  patient: Patient;
  currentVersion: ManagementPlanVersion | null;
  openDraft: ManagementPlanVersion | null;
}) {
  const { state, dispatch } = useCarePlanPrototype();
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawReason, setWithdrawReason] = useState("");
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewReason, setReviewReason] = useState("");
  const [reviewDate, setReviewDate] = useState(() => addIsoMonths(PROTOTYPE_NOW, REVIEW_INTERVAL_MONTHS).slice(0, 10));
  const [reviewError, setReviewError] = useState<string | null>(null);

  const actor = state.users.find((user) => user.id === state.activeUserId) ?? null;
  if (actor === null) return null;

  const mayAuthor = canPerformAction(actor.role, "author_management_draft");
  const mayWithdraw = canPerformAction(actor.role, "withdraw_management_version");
  const mayRecordReview = canPerformAction(actor.role, "record_formal_review");
  const mayShare = currentVersion !== null;

  if (!mayAuthor && !mayWithdraw && !mayRecordReview && !mayShare) return null;

  /**
   * Every one of these actions changes a record, so every one of them can be
   * refused for the same reasons, and each control says so for itself. Computing
   * the reason for only one of them left withdrawal — the most consequential
   * control here — looking available until a clinician had opened the sheet,
   * typed a reason, and confirmed.
   *
   * Identical reasons are stated once and shared. Offline blocks all three at
   * the same moment, and three identical paragraphs would be noise rather than
   * emphasis.
   */
  const shareBlockedReason = getPrototypeMutationBlockReason(state, {
    type: "record-plan-shared-with-patient",
    patientId: patient.id,
  });
  const reviewBlockedReason = getPrototypeMutationBlockReason(state, {
    type: "record-formal-management-review",
    patientId: patient.id,
    reason: "",
    nextReviewDueAt: "",
  });
  const withdrawBlockedReason = getPrototypeMutationBlockReason(state, {
    type: "withdraw-current-management-version",
    patientId: patient.id,
    reason: "",
  });

  const blockedReasonIds = new Map<string, string>();
  for (const reason of [shareBlockedReason, reviewBlockedReason, withdrawBlockedReason]) {
    if (reason !== null && !blockedReasonIds.has(reason)) {
      blockedReasonIds.set(reason, `care-plan-plan-actions-blocked-${blockedReasonIds.size + 1}`);
    }
  }
  const describedByFor = (reason: string | null) => (reason === null ? undefined : blockedReasonIds.get(reason));

  const draftHref =
    openDraft === null || openDraft.state === "draft"
      ? carePlanRoute.managementPlanEdit(patient.id)
      : carePlanRoute.managementPlanReview(patient.id);
  const draftLabel =
    openDraft === null
      ? "Draft a replacement version"
      : openDraft.state === "draft"
        ? `Continue Draft version ${openDraft.version}`
        : `Open the version awaiting approval`;

  function recordFormalReview() {
    if (reviewReason.trim() === "") {
      setReviewError("Say what was reviewed, so a later reader can see what the review covered.");
      return;
    }
    setReviewOpen(false);
    setReviewError(null);
    dispatch({
      type: "record-formal-management-review",
      patientId: patient.id,
      reason: reviewReason,
      nextReviewDueAt: `${reviewDate}T12:00:00+08:00`,
    });
  }

  function withdrawPlan() {
    if (withdrawReason.trim() === "") {
      setWithdrawError("Withdrawing a plan needs a recorded reason, so a later reader can see why.");
      return;
    }
    setWithdrawOpen(false);
    setWithdrawError(null);
    dispatch({ type: "withdraw-current-management-version", patientId: patient.id, reason: withdrawReason });
  }

  return (
    <SectionFrame
      id="care-plan-plan-actions"
      heading="Plan actions"
      testId="care-plan-plan-actions"
      tone="secondary"
      className={styles.planActions}
      description="Everything here changes the record rather than the reading of it. Nothing above this line depends on any of it."
    >
      {[...blockedReasonIds].map(([reason, id]) => (
        <p key={id} id={id} role="alert" data-testid="care-plan-plan-actions-blocked" className={styles.contactWarning}>
          {reason}
        </p>
      ))}

      <div className={styles.actionRow} data-print-hide="true">
        {mayAuthor ? (
          <Link href={draftHref} className={styles.contactAction}>
            {draftLabel}
          </Link>
        ) : null}

        {mayShare ? (
          <Button
            variant="secondary"
            aria-disabled={shareBlockedReason === null ? undefined : true}
            aria-describedby={describedByFor(shareBlockedReason)}
            onClick={
              shareBlockedReason === null
                ? () => dispatch({ type: "record-plan-shared-with-patient", patientId: patient.id })
                : ignoreUnavailableActivation
            }
          >
            Record that this plan has been shown to this person
          </Button>
        ) : null}

        {mayRecordReview && currentVersion !== null ? (
          <Button
            variant="secondary"
            aria-disabled={reviewBlockedReason === null ? undefined : true}
            aria-describedby={describedByFor(reviewBlockedReason)}
            onClick={reviewBlockedReason === null ? () => setReviewOpen(true) : ignoreUnavailableActivation}
          >
            Record a formal review
          </Button>
        ) : null}

        {mayWithdraw && currentVersion !== null ? (
          <Button
            variant="danger"
            aria-disabled={withdrawBlockedReason === null ? undefined : true}
            aria-describedby={describedByFor(withdrawBlockedReason)}
            onClick={withdrawBlockedReason === null ? () => setWithdrawOpen(true) : ignoreUnavailableActivation}
          >
            Withdraw this plan
          </Button>
        ) : null}
      </div>

      <Sheet
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        title="Record a formal review"
        description="A formal review records that the plan was looked at and moves its next review date. It writes no new version and changes no plan content."
        closeLabel="Cancel"
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setReviewOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={recordFormalReview}>
              Record this review
            </Button>
          </div>
        }
      >
        <PlanTextArea
          id="care-plan-formal-review-reason"
          label="What was reviewed"
          required
          value={reviewReason}
          error={reviewError ?? undefined}
          onChange={(text) => setReviewReason(text)}
        />
        <TextField
          id="care-plan-formal-review-date"
          label="Next review date"
          type="date"
          required
          value={reviewDate}
          onChange={(event) => setReviewDate(event.target.value)}
        />
      </Sheet>

      <Sheet
        open={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
        title="Withdraw this plan"
        description={`${patient.preferredName} will have no Current Plan afterwards. No earlier version is put back into use, and nothing is deleted: the withdrawn version stays readable, and the withdrawal date, your name, and your reason are shown wherever the plan would have been.`}
        closeLabel="Cancel"
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setWithdrawOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={withdrawPlan}>
              Withdraw this plan
            </Button>
          </div>
        }
      >
        <PlanTextArea
          id="care-plan-withdraw-reason"
          label="Why is this plan being withdrawn"
          required
          value={withdrawReason}
          error={withdrawError ?? undefined}
          onChange={(text) => setWithdrawReason(text)}
        />
      </Sheet>
    </SectionFrame>
  );
}

export function ManagementPlanSurface({
  patientId,
  scenario,
}: {
  patientId: string | null;
  scenario: PrototypeScenario;
}) {
  const { state, dispatch } = useCarePlanPrototype();
  const snapshot = patientId === null ? null : buildPatientSnapshot(state, patientId as SyntheticId, PROTOTYPE_NOW);

  if (snapshot === null) {
    return (
      <EmptyState
        testId="care-plan-no-plan-patient"
        title="No patient is open."
        body="Open a synthetic patient from Home or Patients, then choose Management Plan."
      />
    );
  }

  const { patient, cmht, currentManagementVersion, openManagementDraft, withdrawnManagementVersion } = snapshot;

  // Identity uncertainty is the one state where showing the record is the harm.
  // A nearby patient's plan is never displayed as a fallback, on this route any
  // more than on the Clinical Snapshot.
  if (scenario === "identity-uncertain") {
    return (
      <section aria-label={`${patient.fullName} Management Plan`} className={styles.workspace}>
        <p role="alert" data-testid="care-plan-identity-uncertain" className={styles.identityUncertain}>
          <strong>This record has not been confirmed as the right person.</strong> No plan content is shown, because
          showing a nearby person&rsquo;s plan would be worse than showing none. Return to search and choose the record
          again.
        </p>
      </section>
    );
  }

  // Derived at render, never stored. A stored indicator can tell a clinician a
  // plan is current when the date it claims to describe says otherwise.
  const reviewState =
    currentManagementVersion === null || currentManagementVersion.reviewDueAt === null
      ? null
      : deriveReviewState(currentManagementVersion.reviewDueAt, PROTOTYPE_NOW);

  const safetyPlanStatus =
    snapshot.currentSafetyPlanVersion === null
      ? "No current version"
      : `Current version ${snapshot.currentSafetyPlanVersion.version}, confirmed ${formatPerthDate(snapshot.currentSafetyPlanVersion.confirmedAt)}`;

  const openTriggers = state.reviewTriggers.filter(
    (trigger) => trigger.patientId === patient.id && trigger.status === "open",
  );

  const patientPlan = state.patientPlans.find((plan) => plan.patientId === patient.id) ?? null;
  const currentPatientPlanVersion =
    patientPlan === null
      ? null
      : (state.patientPlanVersions.find(
          (version) => version.planId === patientPlan.id && version.state === "current",
        ) ?? null);

  function recordContactIntent(contact: CmhtContact, channel: "email" | "call") {
    dispatch({ type: "record-contact-intent", patientId: patient.id, cmhtId: contact.id, channel });
  }

  return (
    <section aria-label={`${patient.fullName} Management Plan`} className={styles.workspace}>
      <div data-testid="care-plan-plan-identity" className={styles.identityBand}>
        <SyntheticMarker />
        <h2 className={styles.patientName}>{patient.fullName}</h2>
        <dl className={styles.definitionGrid}>
          <DefinitionRow term="MRN">{patient.mrn}</DefinitionRow>
          <DefinitionRow term="Date of birth">{formatPerthDate(patient.dateOfBirth)}</DefinitionRow>
          <DefinitionRow term="Preferred name">{patient.preferredName}</DefinitionRow>
          <DefinitionRow term="Pronouns">{patient.pronouns}</DefinitionRow>
        </dl>
        <PatientNavigation patientId={patient.id} activeSection="managementPlan" />
      </div>

      {currentManagementVersion === null ? null : <PinnedSafetyBoundary content={currentManagementVersion.content} />}

      {state.lastOutcome === null ? null : (
        <div data-testid="care-plan-outcome" data-print-hide="true">
          <InlineNotice tone={PROTOTYPE_OUTCOME_TONE[state.lastOutcome.kind]}>{state.lastOutcome.message}</InlineNotice>
        </div>
      )}

      {currentManagementVersion === null ? null : (
        <ReviewWarning reviewState={reviewState} reviewDueAt={currentManagementVersion.reviewDueAt} />
      )}

      {currentManagementVersion !== null ? (
        <>
          <CurrentPlanSummary
            version={currentManagementVersion}
            ownerName={displayName(state.users, currentManagementVersion.ownerId) ?? NOT_RECORDED}
            approverName={displayName(state.users, currentManagementVersion.approverId) ?? null}
            reviewState={reviewState}
            cmhtName={cmht?.name ?? null}
            cmhtOperatingHours={cmht?.operatingHours ?? null}
            safetyPlanHref={carePlanRoute.safetyPlan(patient.id)}
            safetyPlanStatus={safetyPlanStatus}
          />

          <FullPlanTier content={currentManagementVersion.content} />

          {/*
            Deliberately carries no version mark, review-state mark, or
            participation marker. All three are on the summary card above, and
            the same fact stated twice on one page is not emphasis — it is a
            second copy that a later edit can leave saying something different.
          */}
          <SectionFrame
            id="care-plan-plan-governance"
            heading="Review and sharing"
            testId="care-plan-plan-governance"
            tone="secondary"
          >
            <dl className={styles.definitionGrid}>
              <DefinitionRow term="Open Review Triggers">
                {openTriggers.length === 0
                  ? "No open Review Triggers."
                  : `${openTriggers.length} open Review Trigger${openTriggers.length === 1 ? "" : "s"}. ${openTriggers
                      .map((trigger) => trigger.reason)
                      .join(" ")}`}
              </DefinitionRow>
              <DefinitionRow term="Shown to this person">
                {currentManagementVersion.sharedWithPatientAt === null
                  ? "Not yet shown to this person."
                  : `Shown on ${formatPerthDate(currentManagementVersion.sharedWithPatientAt)}.`}
              </DefinitionRow>
              <DefinitionRow term="Patient Plan">
                {currentPatientPlanVersion === null
                  ? "No current Patient Plan has been written from this version."
                  : `Current Patient Plan version ${currentPatientPlanVersion.version}.`}
              </DefinitionRow>
            </dl>
          </SectionFrame>
        </>
      ) : withdrawnManagementVersion !== null ? (
        <>
          <SectionFrame id="care-plan-withdrawn" heading="Withdrawn plan" tone="boundary">
            <p data-testid="care-plan-withdrawn-notice" className={styles.withdrawnNotice}>
              {`Plan withdrawn on ${formatPerthDate(withdrawnManagementVersion.withdrawnAt)} by ${
                displayName(state.users, withdrawnManagementVersion.withdrawnBy) ?? "an unrecorded clinician"
              } — ${withdrawnManagementVersion.withdrawalReason ?? "No reason was recorded."}`}
            </p>
            <p className={styles.sectionDescription}>
              {`${patient.preferredName} previously had an agreed plan. No older version has been restored in its place, and there is no Current Plan to follow.`}
            </p>
          </SectionFrame>
          <SupersededContent version={withdrawnManagementVersion} />
        </>
      ) : (
        <SectionFrame id="care-plan-no-current" heading="Management Plan" tone="boundary">
          <p className={styles.noCurrentPlan}>No Current Plan</p>
          <p className={styles.sectionDescription}>
            {`Nothing has been agreed for ${patient.preferredName} in this prototype. Assess and treat as you would for anyone else.`}
          </p>
        </SectionFrame>
      )}

      {openManagementDraft === null ? null : (
        <SectionFrame
          id="care-plan-awaiting-version"
          heading="Version in progress"
          tone="secondary"
          testId="care-plan-awaiting-version"
        >
          <div className={styles.metadataMarks}>
            <StatusMark
              tone="neutral"
              label={`${MANAGEMENT_VERSION_STATE_LABEL[openManagementDraft.state]} version ${openManagementDraft.version}`}
            />
            <ParticipationMarker participationState={openManagementDraft.participationState} />
          </div>
          <p className={styles.sectionDescription}>
            {`This is not a plan in use. ${
              currentManagementVersion === null
                ? `There is no Current Plan for ${patient.fullName}, and a version being written is not one.`
                : `Current version ${currentManagementVersion.version} remains in use until this version is approved.`
            }`}
          </p>
          <p className={styles.sectionDescription}>{openManagementDraft.revisionReason}</p>
        </SectionFrame>
      )}

      {cmht === null ? null : (
        <ContactActions
          contact={cmht}
          scenario={scenario}
          reviewsHref={CARE_PLAN_ROUTES.reviews}
          onIntent={(channel) => recordContactIntent(cmht, channel)}
          blockedReason={getPrototypeMutationBlockReason(state, {
            type: "record-contact-intent",
            patientId: patient.id,
            cmhtId: cmht.id,
            channel: "email",
          })}
        />
      )}

      {/*
        Authoring is supporting machinery, so it sits last: below the plan, below
        the version in progress, and below the team's telephone number. A reader
        whose role carries none of these actions sees none of them — an absent
        control is quieter than a refused one, and the reading surface is the
        primary use of this page.
      */}
      <PlanActions patient={patient} currentVersion={currentManagementVersion} openDraft={openManagementDraft} />

      <p className={styles.planFooterLink} data-print-hide="true">
        <Link href={carePlanRoute.managementPlanPrint(patient.id)} className={styles.inlineLink}>
          Print this plan
        </Link>
        {" — a printed clinician summary to carry to the bedside or send with a handover."}
      </p>
    </section>
  );
}
