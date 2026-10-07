"use client";

import { RotateCcw } from "lucide-react";

import { WorkBody, WorkButton, WorkEmpty } from "@/components/mode-kit/work";
import { AssessmentsExportPage } from "@/components/work-screens/assessments/assessments-export-page";
import { AssessmentsSampleGate } from "@/components/work-screens/assessments/assessments-sample-gate";
import { AssessmentsTraineePage } from "@/components/work-screens/assessments/assessments-trainee-page";
import { useRegistryDataset } from "@/components/work-screens/use-registry-dataset";
import { WorkScreenLoading } from "@/components/work-screens/work-screen-loading";
import { useAuthSession } from "@/lib/supabase/client";

/*
 * The Assessments work screens as their routes render them: each behind the example-only gate, because
 * Assessments has no store for real records yet. Client side, because the gate reads the example data
 * switch and the account.
 */

export function AssessmentsExportScreen({ demoMode }: { readonly demoMode: boolean }) {
  return (
    <AssessmentsSampleGate demoMode={demoMode} what="Assessments Export" render={() => <AssessmentsExportPage />} />
  );
}

/** The trainee view with its example supervision, read from the shared registry. */
function TraineeWithSupervision({ doctorId }: { readonly doctorId: string }) {
  const supervision = useRegistryDataset("assessments.supervision", true);
  const memoryKey = String(useAuthSession().authEpoch);
  if (supervision.status === "ready")
    return (
      <AssessmentsTraineePage key={doctorId} doctorId={doctorId} supervision={supervision.data} memoryKey={memoryKey} />
    );
  if (supervision.status === "error")
    return (
      <main className="min-w-0" data-testid="assessments-trainee-load-error">
        <WorkBody>
          <WorkEmpty
            icon={RotateCcw}
            title="This page didn't load"
            body="Check your connection, then try again."
            action={
              <WorkButton onClick={supervision.retry} testId="assessments-trainee-retry">
                Try again
              </WorkButton>
            }
          />
        </WorkBody>
      </main>
    );
  return <WorkScreenLoading label="Loading the doctor" testId="assessments-trainee-loading" rows={4} />;
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
      what="Your trainee's record"
      render={() => <TraineeWithSupervision doctorId={doctorId} />}
    />
  );
}
