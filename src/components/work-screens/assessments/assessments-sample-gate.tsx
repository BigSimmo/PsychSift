"use client";

import { ClipboardCheck, Info } from "lucide-react";
import { useState, type ReactNode } from "react";

import { WorkBody, WorkButton, WorkEmpty } from "@/components/mode-kit/work";
import { useTeachingDemoMode } from "@/components/teaching/use-teaching-sample";
import { cn, textMuted } from "@/components/ui-primitives";
import { useAuthSession } from "@/lib/supabase/client";

/**
 * The made-up records' own line, the same words the Assessments page uses: nothing is kept or sent.
 */
export function AssessmentsSampleLine({ children }: { readonly children?: ReactNode }) {
  return (
    <p
      role="status"
      className={cn("flex items-start gap-1.5 text-sm", textMuted)}
      data-testid="work-screens-assessments-sample"
    >
      <Info aria-hidden="true" className="mt-0.5 size-icon-sm shrink-0" />
      <span>{children ?? "Made-up example records. Nothing is saved or sent."}</span>
    </p>
  );
}

function Gate({ demoMode, render }: { demoMode: boolean; render: () => ReactNode }) {
  const [practice, setPractice] = useState(false);
  if (demoMode || practice) return <>{render()}</>;
  return (
    <main className="min-w-0" data-testid="work-screens-assessments-not-kept">
      <WorkBody>
        <WorkEmpty
          icon={ClipboardCheck}
          title="Records can't be kept here yet"
          body="Forms and EPAs stay in Clinical Learning Australia (CLA) and with your Medical Education Unit (MEU). Try this page on made-up records. Nothing is saved or sent."
          action={
            <WorkButton onClick={() => setPractice(true)} testId="work-screens-assessments-try">
              Try with made-up records
            </WorkButton>
          }
        />
      </WorkBody>
    </main>
  );
}

/**
 * Assessments has nowhere to keep real records, so every Assessments screen runs on made-up records
 * only: a demo or a signed-out visitor sees them at once, a signed-in doctor is told so and offered
 * them, exactly as `/teaching/assessments` does. Keyed on the account, so a sign-in starts again.
 */
export function AssessmentsSampleGate({ demoMode, render }: { demoMode: boolean; render: () => ReactNode }) {
  const auth = useAuthSession();
  const demo = useTeachingDemoMode(demoMode);
  return <Gate key={`${auth.authEpoch}:${demo}`} demoMode={demo} render={render} />;
}
