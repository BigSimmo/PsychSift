"use client";

import { ClipboardCheck } from "lucide-react";
import dynamic from "next/dynamic";
import { Suspense, useEffect, useState, type Dispatch } from "react";

import { InformationPageShell } from "@/components/information-page-shell";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { modeModuleSurface } from "@/components/mode-kit/recipes";
import type { SheetState } from "@/components/teaching/assessments/assessments-help";
import { TeachingAccountPage } from "@/components/teaching/teaching-depth-page";
import { Button } from "@/components/ui/button";
import { cn, textMuted } from "@/components/ui-primitives";
import type { AssessmentsAction, AssessmentsState } from "@/lib/teaching/assessments/model";

/*
 * The made-up app is large and signed-in doctors only see the "not kept yet" card, so it loads on its own.
 * It still renders on the server, so the sample page's first HTML is unchanged.
 */
const loadAssessmentsApp = () => import("@/components/teaching/assessments/assessments-app");
const AssessmentsApp = dynamic(() => loadAssessmentsApp().then((m) => m.AssessmentsApp), {
  loading: () => <ModeModuleSkeleton rows={4} />,
});

export type Role = "doctor" | "supervisor";

export type ScreenProps = {
  s: AssessmentsState;
  dispatch: Dispatch<AssessmentsAction>;
  params: URLSearchParams;
  role: Role;
  openSheet: (sheet: SheetState) => void;
  go: (href: string) => void;
};

/** Signed in, there is nowhere to keep real records yet: say so, and offer the made-up ones. */
function NotKeptYet({ onTry }: { onTry: () => void }) {
  useEffect(() => {
    // Fetch the made-up app quietly once the page is idle, so "Try it" opens it without a loading gap.
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(() => void loadAssessmentsApp().catch(() => undefined));
      return () => window.cancelIdleCallback(id);
    }
    const timer = window.setTimeout(() => void loadAssessmentsApp().catch(() => undefined), 1500);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <section data-testid="teaching-assessments-not-yet" className={cn(modeModuleSurface, "grid gap-2 p-4")}>
      <ClipboardCheck aria-hidden="true" className="size-icon-lg text-[color:var(--text-muted)]" />
      <h2 className="text-base font-semibold text-[color:var(--text-heading)]">
        Assessment records can&apos;t be kept in PsychSift yet
      </h2>
      <p className={cn("text-sm", textMuted)}>
        Your term assessments and EPAs stay in Clinical Learning Australia (CLA) and with your Medical Education Unit
        (MEU). You can walk through how this page will work on made-up records. Nothing is saved or sent.
      </p>
      <Button variant="secondary" block onClick={onTry}>
        Try it with made-up records
      </Button>
    </section>
  );
}

function AssessmentsPage({ demoMode }: { demoMode: boolean }) {
  const [practice, setPractice] = useState(false);
  const sample = demoMode || practice;
  return (
    <InformationPageShell width="narrow" gap={false} testId="teaching-assessments">
      <h1 className="sr-only">Assessments</h1>
      {sample ? (
        <Suspense fallback={<ModeModuleSkeleton rows={4} />}>
          <AssessmentsApp />
        </Suspense>
      ) : (
        <NotKeptYet onTry={() => setPractice(true)} />
      )}
    </InformationPageShell>
  );
}

export function TeachingAssessments(props: { demoMode: boolean }) {
  return <TeachingAccountPage component={AssessmentsPage} {...props} />;
}
