"use client";

import type { ReactNode } from "react";

import { ClinicalSignInNotice } from "@/components/mode-kit/clinical-sign-in-notice";
import { useClinicalToolAccess } from "@/components/mode-kit/use-clinical-tool-access";
import { CLINICAL_SIGN_IN_COPY } from "@/lib/front-door-content";

/**
 * Where the Patient details form would be, a signed-out reader sees the sign-in card
 * instead: patient-tailored considerations and interaction checks are for signed-in
 * health professionals (see `useClinicalToolAccess`). `line` is for the slim strip
 * above the prescribing list; `className` places the card the way the form was placed.
 */
export function PatientDetailsGate({
  children,
  line,
  className,
}: {
  readonly children: ReactNode;
  readonly line?: boolean;
  readonly className?: string;
}) {
  const access = useClinicalToolAccess();
  if (access === "allowed") return children;
  // Still checking the session: show neither the patient details nor a sign-in prompt yet.
  if (access === "checking") return null;
  return (
    <div className={className}>
      <ClinicalSignInNotice
        copy={CLINICAL_SIGN_IN_COPY.patientDetails}
        line={line}
        bare={!line}
        testId="patient-details-sign-in"
      />
    </div>
  );
}
