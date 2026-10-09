"use client";

import { AssessmentsSupervisorBack } from "@/components/work-screens/assessments/assessments-back";
import type { ReactNode } from "react";

import { ExampleOnlyGate } from "@/components/example-data/example-only-gate";
import { AssessmentsKeptInCla, useAssessmentsAccess } from "@/components/teaching/assessments/assessments-kept-in-cla";
import { WorkBody } from "@/components/mode-kit/work";
import { WorkScreenLoading } from "@/components/work-screens/work-screen-loading";
import { useExampleData } from "@/lib/example-data/store";

/**
 * Assessment records stay in CLA, so its Export and trainee screens are example only: signed in they
 * say where the records are kept, and signed out the shared `ExampleOnlyGate` shows them while the
 * Assessments example data is on, and otherwise says plainly they are not connected. The local demo build always shows them. The frame's
 * example data banner labels the records, so this adds no banner of its own.
 */
export function AssessmentsSampleGate({
  demoMode,
  what,
  render,
}: {
  readonly demoMode: boolean;
  /** For the gate's sentence, "<what> is not connected yet". */
  readonly what: string;
  readonly render: () => ReactNode;
}) {
  const access = useAssessmentsAccess();
  const { active } = useExampleData("assess");
  if (demoMode)
    return (
      <>
        <AssessmentsSupervisorBack />
        {render()}
      </>
    );
  // Until the sign-in status is known, hold the page's space: a signed-out visitor sees example records,
  // so the "not connected" notice must not flash first.
  if (access === "loading")
    return (
      <>
        <AssessmentsSupervisorBack />
        <WorkScreenLoading label="Loading Assessments" testId="work-screens-assessments-gate-loading" rows={3} />
      </>
    );
  // Signed in, records stay in CLA (owner decision 7 Oct 2026): the made-up ones never show.
  if (access === "signed-in")
    return (
      <>
        <AssessmentsSupervisorBack />
        <main className="min-w-0" data-testid="work-screens-assessments-not-kept">
          <WorkBody>
            <AssessmentsKeptInCla />
          </WorkBody>
        </main>
      </>
    );
  if (active)
    return (
      <>
        <AssessmentsSupervisorBack />
        {render()}
      </>
    );
  // Off: the shared gate draws its "not connected" notice, inside the page's own frame.
  return (
    <>
      <AssessmentsSupervisorBack />
      <main className="min-w-0" data-testid="work-screens-assessments-not-kept">
        <WorkBody>
          <ExampleOnlyGate area="assess" what={what}>
            {render()}
          </ExampleOnlyGate>
        </WorkBody>
      </main>
    </>
  );
}
