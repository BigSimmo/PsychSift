"use client";

import Link from "next/link";
import type { Ref } from "react";

import { InlineNotice } from "@/components/ui-primitives";

import styles from "./care-plan.module.css";
import { PRESENTATION_ACTIVITY_WINDOW_MONTHS } from "./domain";
import { PatientNavigation, type PatientSectionKey } from "./patient-navigation";
import { ContactActions } from "./contact-actions";
import {
  CurrentPlanSummary,
  DefinitionRow,
  MANAGEMENT_VERSION_STATE_LABEL,
  PROTOTYPE_OUTCOME_TONE,
  ParticipationMarker,
  PinnedSafetyBoundary,
  ReviewWarning,
  SectionFrame,
  StatusMark,
  SyntheticMarker,
  formatPerthDate,
} from "./prototype-ui";
import { carePlanRoute } from "./routes";
import type {
  CmhtContact,
  PatientSnapshot,
  PrototypeOutcome,
  PrototypeScenario,
  PrototypeUser,
  SyntheticId,
} from "./types";

const AGE_COHORT_LABEL = { adult: "Adult", older_adult: "Older adult" } as const;

function displayName(users: readonly PrototypeUser[], id: SyntheticId | null): string | undefined {
  if (id === null) return undefined;
  return users.find((user) => user.id === id)?.displayName;
}

export type PatientWorkspaceProps = {
  snapshot: PatientSnapshot;
  users: readonly PrototypeUser[];
  scenario: PrototypeScenario;
  outcome: PrototypeOutcome | null;
  /** `null` when the surrounding surface is not itself a patient section. */
  activeSection: PatientSectionKey | null;
  reviewsHref: string;
  onRecordContactIntent: (contact: CmhtContact, channel: "email" | "call") => void;
  contactActionBlockedReason: string | null;
  /** Home renders the workspace beside the directory and offers the full record. */
  showFullRecordLink?: boolean;
  /**
   * The workspace region is a focus target. Selecting a patient from the
   * directory changes no address, so the shell's route-heading focus never
   * fires; the caller moves focus here instead, and the region's accessible name
   * is what gets announced.
   */
  ref?: Ref<HTMLElement>;
};

/**
 * One patient's Clinical Snapshot: who this is, whether the plan is current, the
 * five first-minute sections, anything being written that is not yet in use, and
 * how to reach the team.
 *
 * Reading comes first. Task 4 builds no authoring surface at all, so a reader
 * without authoring permission sees a clean reading surface rather than a wall of
 * controls they cannot use.
 */
export function PatientWorkspace({
  snapshot,
  users,
  scenario,
  outcome,
  activeSection,
  reviewsHref,
  onRecordContactIntent,
  contactActionBlockedReason,
  showFullRecordLink = false,
  ref,
}: PatientWorkspaceProps) {
  const {
    patient,
    cmht,
    currentManagementVersion,
    openManagementDraft,
    withdrawnManagementVersion,
    currentSafetyPlanVersion,
    reviewState,
    presentationActivity,
  } = snapshot;

  const safetyPlanStatus =
    currentSafetyPlanVersion === null
      ? "No current version"
      : `Current version ${currentSafetyPlanVersion.version}, confirmed ${formatPerthDate(currentSafetyPlanVersion.confirmedAt)}`;

  const planCurrency =
    currentManagementVersion !== null
      ? `Current version ${currentManagementVersion.version}`
      : withdrawnManagementVersion !== null
        ? `Withdrawn on ${formatPerthDate(withdrawnManagementVersion.withdrawnAt)}`
        : "None in use";

  // Identity uncertainty is the one state where showing the record is the harm.
  // A nearby patient's plan is never displayed as a fallback.
  const identityUncertain = scenario === "identity-uncertain";

  return (
    <section ref={ref} tabIndex={-1} aria-label={`${patient.fullName} clinical snapshot`} className={styles.workspace}>
      <div data-testid="care-plan-identity-band" className={styles.identityBand}>
        <SyntheticMarker />
        <h2 className={styles.patientName}>{patient.fullName}</h2>
        <dl className={styles.definitionGrid}>
          <DefinitionRow term="MRN">{patient.mrn}</DefinitionRow>
          <DefinitionRow term="Date of birth">{formatPerthDate(patient.dateOfBirth)}</DefinitionRow>
          <DefinitionRow term="Age cohort">{AGE_COHORT_LABEL[patient.ageCohort]}</DefinitionRow>
          <DefinitionRow term="Preferred name">{patient.preferredName}</DefinitionRow>
          <DefinitionRow term="Pronouns">{patient.pronouns}</DefinitionRow>
          <DefinitionRow term="Home health service">{patient.homeHealthService}</DefinitionRow>
          <DefinitionRow term="Current Plan">{planCurrency}</DefinitionRow>
          <DefinitionRow term="Personal Safety Plan">{safetyPlanStatus}</DefinitionRow>
          <DefinitionRow term="Team contact details">
            {cmht === null
              ? undefined
              : cmht.verificationState === "verified"
                ? `Verified on ${formatPerthDate(cmht.verifiedAt)}`
                : `Not verified since ${formatPerthDate(cmht.verifiedAt)}`}
          </DefinitionRow>
          <DefinitionRow term="Presentation activity">
            {`${presentationActivity.total} recorded in the ${PRESENTATION_ACTIVITY_WINDOW_MONTHS} months to ${formatPerthDate(presentationActivity.windowEnd)}. Counts describe what happened and decide nothing.`}
          </DefinitionRow>
        </dl>
        {showFullRecordLink ? (
          <Link href={carePlanRoute.patient(patient.id)} className={styles.inlineLink} data-print-hide="true">
            {`Open the full record for ${patient.fullName}`}
          </Link>
        ) : null}
        <PatientNavigation patientId={patient.id} activeSection={activeSection} />
      </div>

      {identityUncertain ? (
        <p role="alert" data-testid="care-plan-identity-uncertain" className={styles.identityUncertain}>
          <strong>This record has not been confirmed as the right person.</strong> No plan content is shown, because
          showing a nearby person&rsquo;s plan would be worse than showing none. Return to search and choose the record
          again.
        </p>
      ) : (
        <>
          {currentManagementVersion === null ? null : (
            <PinnedSafetyBoundary content={currentManagementVersion.content} />
          )}

          {outcome === null ? null : (
            <div data-testid="care-plan-outcome">
              <InlineNotice tone={PROTOTYPE_OUTCOME_TONE[outcome.kind]}>{outcome.message}</InlineNotice>
            </div>
          )}

          {/*
            Deliberately not gated on `reviewState !== null`. A Current version
            with no review date derives no state at all, and silently showing
            nothing there would make an undated plan look healthier than one
            whose date is merely unreadable — the opposite of how
            `deriveReviewState` degrades.
          */}
          {currentManagementVersion === null ? null : (
            <ReviewWarning reviewState={reviewState} reviewDueAt={currentManagementVersion.reviewDueAt} />
          )}

          {currentManagementVersion !== null ? (
            <CurrentPlanSummary
              version={currentManagementVersion}
              ownerName={displayName(users, currentManagementVersion.ownerId) ?? "Not recorded"}
              approverName={displayName(users, currentManagementVersion.approverId) ?? null}
              reviewState={reviewState}
              cmhtName={cmht?.name ?? null}
              cmhtOperatingHours={cmht?.operatingHours ?? null}
              safetyPlanHref={carePlanRoute.safetyPlan(patient.id)}
              safetyPlanStatus={safetyPlanStatus}
            />
          ) : withdrawnManagementVersion !== null ? (
            <SectionFrame id="care-plan-withdrawn" heading="Withdrawn plan" tone="boundary">
              <p data-testid="care-plan-withdrawn-notice" className={styles.withdrawnNotice}>
                {`Plan withdrawn on ${formatPerthDate(withdrawnManagementVersion.withdrawnAt)} by ${
                  displayName(users, withdrawnManagementVersion.withdrawnBy) ?? "an unrecorded clinician"
                } — ${withdrawnManagementVersion.withdrawalReason ?? "No reason was recorded."}`}
              </p>
              <p className={styles.sectionDescription}>
                {`${patient.preferredName} previously had an agreed plan. Superseded and withdrawn versions stay readable in History; no older version has been restored in its place.`}
              </p>
            </SectionFrame>
          ) : (
            <SectionFrame id="care-plan-no-current" heading="Management Plan" tone="boundary">
              <p className={styles.noCurrentPlan}>No Current Plan</p>
              <p className={styles.sectionDescription}>
                {`Nothing has been agreed for ${patient.preferredName} in this prototype. Assess and treat as you would for anyone else.`}
              </p>
            </SectionFrame>
          )}

          {openManagementDraft === null ? null : (
            <SectionFrame id="care-plan-open-draft" heading="Version in progress" tone="secondary">
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
              reviewsHref={reviewsHref}
              onIntent={(channel) => onRecordContactIntent(cmht, channel)}
              blockedReason={contactActionBlockedReason}
            />
          )}
        </>
      )}
    </section>
  );
}
