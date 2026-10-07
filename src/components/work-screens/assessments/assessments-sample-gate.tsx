"use client";

import type { ReactNode } from "react";

import { ExampleOnlyGate } from "@/components/example-data/example-only-gate";
import { WorkBody } from "@/components/mode-kit/work";
import { WorkScreenLoading } from "@/components/work-screens/work-screen-loading";
import { useExampleData } from "@/lib/example-data/store";
import { useAuthSession } from "@/lib/supabase/client";

/**
 * Assessments has nowhere to keep real records yet, so its Export and trainee screens are example
 * only: the shared `ExampleOnlyGate` shows them while the Assessments example data is on, and
 * otherwise says plainly they are not connected. The local demo build always shows them. The frame's
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
  const auth = useAuthSession();
  const { active } = useExampleData("assess");
  if (demoMode) return <>{render()}</>;
  // Until the sign-in status is known, hold the page's space: a signed-out visitor sees example records,
  // so the "not connected" notice must not flash first.
  if (auth.status === "loading")
    return <WorkScreenLoading label="Loading Assessments" testId="work-screens-assessments-gate-loading" rows={3} />;
  if (active) return <>{render()}</>;
  // Off: the shared gate draws its "not connected" notice, inside the page's own frame.
  return (
    <main className="min-w-0" data-testid="work-screens-assessments-not-kept">
      <WorkBody>
        <ExampleOnlyGate area="assess" what={what}>
          {render()}
        </ExampleOnlyGate>
      </WorkBody>
    </main>
  );
}
