"use client";

import { useEffect, useMemo, useRef } from "react";

import { EmptyState } from "@/components/ui-primitives";

import styles from "./care-plan.module.css";
import { buildPatientSnapshot, getCurrentManagementPlanVersion } from "./domain";
import { PROTOTYPE_NOW } from "./fixtures";
import { PatientDirectory } from "./patient-directory";
import { PatientWorkspace } from "./patient-workspace";
import { useCarePlanPrototype } from "./prototype-provider";
import { getPrototypeMutationBlockReason } from "./prototype-state";
import { CARE_PLAN_ROUTES } from "./routes";
import type { CmhtContact, Patient, PatientSnapshot, PrototypeScenario, SyntheticId } from "./types";

export type ClinicalSnapshotVariant = "home" | "patients" | "patient";

/**
 * The Clinical Snapshot surface behind Home, Patients, and a patient's Overview.
 *
 * Home and Patients own their own in-flow directory search — the shell composer
 * stands down on those two routes, so there is never a second search field on
 * one page. A patient route derives its patient from the address rather than
 * from the selection, so a deep link always opens the record it names.
 */
export function ClinicalSnapshotSurface({
  variant,
  patientId,
  scenario,
  initialSearchQuery = "",
}: {
  variant: ClinicalSnapshotVariant;
  patientId?: string;
  scenario: PrototypeScenario;
  initialSearchQuery?: string;
}) {
  const { state, dispatch } = useCarePlanPrototype();

  const resolvedPatientId: SyntheticId | null =
    variant === "patient" ? ((patientId as SyntheticId | undefined) ?? null) : state.selectedPatientId;

  const snapshot: PatientSnapshot | null = useMemo(
    () => (resolvedPatientId === null ? null : buildPatientSnapshot(state, resolvedPatientId, PROTOTYPE_NOW)),
    [state, resolvedPatientId],
  );

  function planStatusFor(patient: Patient): { label: string; tone: "success" | "warning" | "neutral" } {
    const current = getCurrentManagementPlanVersion(state.managementPlanVersions, patient.managementPlanId);
    if (current !== null) return { label: `Current version ${current.version}`, tone: "success" };
    const withdrawn = state.managementPlanVersions.some(
      (version) => version.planId === patient.managementPlanId && version.state === "withdrawn",
    );
    return withdrawn ? { label: "Withdrawn", tone: "warning" } : { label: "No plan in use", tone: "neutral" };
  }

  function recordContactIntent(contact: CmhtContact, channel: "email" | "call") {
    if (snapshot === null) return;
    dispatch({ type: "record-contact-intent", patientId: snapshot.patient.id, cmhtId: contact.id, channel });
  }

  const contactActionBlockedReason =
    snapshot === null || snapshot.cmht === null
      ? null
      : getPrototypeMutationBlockReason(state, {
          type: "record-contact-intent",
          patientId: snapshot.patient.id,
          cmhtId: snapshot.cmht.id,
          channel: "email",
        });

  const workspaceRef = useRef<HTMLElement>(null);
  const lastVariant = useRef<ClinicalSnapshotVariant | null>(null);

  // Choosing a patient from the directory changes no address, so the shell's
  // route-heading focus never fires. Without this the workspace appears in the
  // next column on a desktop, and below the whole directory list on a phone,
  // with no focus move and nothing announced. Focusing the region announces its
  // accessible name — the same mechanism the shell uses for the route heading,
  // rather than a second live region that would double-announce.
  //
  // Exactly one thing may move focus per commit, and on any address change that
  // one thing is the shell. This effect therefore fires only when the surface
  // stayed put and the selection moved underneath it.
  //
  // The previous *variant* is tracked rather than a "is this a directory
  // surface" boolean. The component is rendered at one JSX position for all
  // three variants (`routable-suite.tsx`), so React never remounts it and these
  // refs survive every Home ⇄ patient address ⇄ Patients move — which is how the
  // earlier boolean version came to fire on the way back from a patient address
  // with the selection unchanged. A boolean also cannot see Home → Patients at
  // all, since it does not change across that pair.
  useEffect(() => {
    const previousVariant = lastVariant.current;
    lastVariant.current = variant;

    // Two cases, one guard, because `null` never equals a variant: this is the
    // first commit, or the address changed. Both belong to the shell — it
    // focuses the route heading, and on the first commit stealing that would
    // make every page load jump past the line saying where you are.
    //
    // Written as one comparison deliberately. A separate `previousVariant ===
    // null` line reads as a second rule but is unreachable, and a positive
    // control confirmed removing it changed no behaviour at all.
    if (previousVariant !== variant) return;
    // A patient address has no directory to select from.
    if (variant === "patient") return;
    if (resolvedPatientId === null) return;
    workspaceRef.current?.focus();
  }, [variant, resolvedPatientId]);

  const workspace =
    snapshot === null ? (
      <EmptyState
        testId="care-plan-no-selection"
        title="No patient is open."
        body="Search by synthetic name, MRN, or date of birth, then choose a record to read its Clinical Snapshot."
      />
    ) : (
      <PatientWorkspace
        ref={workspaceRef}
        snapshot={snapshot}
        users={state.users}
        scenario={scenario}
        outcome={state.lastOutcome}
        // Only a patient address is itself the Overview section. Home and
        // Patients embed the workspace, so no patient link is the current page.
        activeSection={variant === "patient" ? "overview" : null}
        reviewsHref={CARE_PLAN_ROUTES.reviews}
        onRecordContactIntent={recordContactIntent}
        contactActionBlockedReason={contactActionBlockedReason}
        showFullRecordLink={variant !== "patient"}
      />
    );

  if (variant === "patient") return workspace;

  return (
    <div className={styles.snapshotSplit}>
      <PatientDirectory
        // A shell-submitted query changes the key so the directory's deliberately
        // local editing state is seeded on navigation without a state-setting effect.
        key={`${variant}:${initialSearchQuery}`}
        patients={state.patients}
        presentations={state.edPresentations}
        now={PROTOTYPE_NOW}
        selectedPatientId={state.selectedPatientId}
        onSelectPatient={(id) => dispatch({ type: "select-patient", patientId: id })}
        reviewsHref={CARE_PLAN_ROUTES.reviews}
        initialQuery={initialSearchQuery}
        listAllWhenEmpty={variant === "patients"}
        planStatusFor={planStatusFor}
      />
      <div className={styles.snapshotWorkspaceColumn}>{workspace}</div>
    </div>
  );
}
