"use client";

import { AssessmentsExportPage } from "@/components/work-screens/assessments/assessments-export-page";
import { AssessmentsSampleGate } from "@/components/work-screens/assessments/assessments-sample-gate";
import { AssessmentsTraineePage } from "@/components/work-screens/assessments/assessments-trainee-page";

/*
 * The Assessments work screens as their routes render them: each behind the same made-up records gate
 * as `/teaching/assessments`. Client side, because the gate reads the account and the demo switch.
 */

export function AssessmentsExportScreen({ demoMode }: { readonly demoMode: boolean }) {
  return <AssessmentsSampleGate demoMode={demoMode} render={() => <AssessmentsExportPage />} />;
}

export function AssessmentsTraineeScreen({
  demoMode,
  doctorId,
}: {
  readonly demoMode: boolean;
  readonly doctorId: string;
}) {
  return (
    <AssessmentsSampleGate
      demoMode={demoMode}
      render={() => <AssessmentsTraineePage key={doctorId} doctorId={doctorId} />}
    />
  );
}
