"use client";

import { ClipboardCheck, Info } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useReducer, useState, type Dispatch } from "react";

import { InformationPageShell } from "@/components/information-page-shell";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { modeModuleSurface } from "@/components/mode-kit/recipes";
import { AssessmentsHome } from "@/components/teaching/assessments/assessments-home";
import { AllAssessments, TermDetails, YearRequirements } from "@/components/teaching/assessments/assessments-year";
import { AssessmentForm } from "@/components/teaching/assessments/assessments-form";
import { AskSupervisor, BookMeeting, EndOfTermSteps } from "@/components/teaching/assessments/assessments-steps";
import { AssessmentReport, SignForm } from "@/components/teaching/assessments/assessments-report";
import { ConcernsHelp, AssessmentsSheets, type SheetState } from "@/components/teaching/assessments/assessments-help";
import { SideBySide, SupervisorHome, SupervisorTimes } from "@/components/teaching/assessments/assessments-supervisor";
import { viewHref, type AssessmentsView } from "@/components/teaching/assessments/assessments-parts";
import { TeachingAccountPage } from "@/components/teaching/teaching-depth-page";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn, textMuted } from "@/components/ui-primitives";
import {
  assessmentsReducer,
  dayLabel,
  initialAssessmentsState,
  type AssessmentsAction,
  type AssessmentsState,
} from "@/lib/teaching/assessments/model";
import { WINDOW_DAYS } from "@/lib/teaching/assessments/sample";

/* The printable form is heavy and opened rarely, so it loads only when asked for. */
const FormPdf = dynamic(() => import("@/components/teaching/assessments/assessments-pdf").then((m) => m.FormPdf), {
  loading: () => <ModeModuleSkeleton rows={3} />,
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

const VIEWS: readonly AssessmentsView[] = [
  "home",
  "hub",
  "reqs",
  "term",
  "all",
  "form",
  "request",
  "book",
  "report",
  "sign",
  "pdf",
  "help",
  "times",
  "side",
];

const DATE_OPTIONS = [
  { value: "-1", label: "Mon 5 Oct (week 6)" },
  ...WINDOW_DAYS.map((_, i) => ({ value: String(i), label: `${dayLabel(i)} (booking window)` })),
];

function Screen(props: ScreenProps & { view: AssessmentsView }) {
  const { view, role } = props;
  if (role === "supervisor") {
    if (view === "form") return <AssessmentForm {...props} who="sup" />;
    if (view === "sign") return <SignForm {...props} who="sup" />;
    if (view === "side") return <SideBySide {...props} />;
    if (view === "times") return <SupervisorTimes {...props} />;
    if (view === "pdf") return <FormPdf {...props} />;
    return <SupervisorHome {...props} />;
  }
  switch (view) {
    case "hub":
      return <EndOfTermSteps {...props} />;
    case "reqs":
      return <YearRequirements {...props} />;
    case "term":
      return <TermDetails {...props} />;
    case "all":
      return <AllAssessments {...props} />;
    case "form":
      return <AssessmentForm {...props} who="self" />;
    case "request":
      return <AskSupervisor {...props} />;
    case "book":
      return <BookMeeting {...props} />;
    case "report":
      return <AssessmentReport {...props} />;
    case "sign":
      return <SignForm {...props} who="self" />;
    case "pdf":
      return <FormPdf {...props} />;
    case "help":
      return <ConcernsHelp {...props} />;
    default:
      return <AssessmentsHome {...props} />;
  }
}

/** The made-up records' own controls: a plain statement that nothing is kept, and a made-up date to move. */
function SampleBar({ s, dispatch }: Pick<ScreenProps, "s" | "dispatch">) {
  return (
    <div className="grid gap-2" data-testid="teaching-assessments-sample">
      <p role="status" className={cn("flex items-center gap-1.5 text-sm-minus", textMuted)}>
        <Info aria-hidden="true" className="size-icon-sm shrink-0" />
        Made-up example records. Nothing here is saved or sent.
      </p>
      <Select
        label="Made-up date"
        hint="Move the made-up date to walk through the booking window."
        value={String(s.now)}
        onChange={(event) => dispatch({ type: "set-now", now: Number(event.target.value) })}
        options={DATE_OPTIONS}
      />
    </div>
  );
}

function AssessmentsApp() {
  const params = useSearchParams();
  const router = useRouter();
  const [s, dispatch] = useReducer(assessmentsReducer, undefined, initialAssessmentsState);
  const [sheet, setSheet] = useState<SheetState>(null);
  const requested = params.get("view") as AssessmentsView | null;
  const view: AssessmentsView = requested && VIEWS.includes(requested) ? requested : "home";
  const role: Role = params.get("as") === "supervisor" ? "supervisor" : "doctor";
  const go = useCallback((href: string) => router.push(href), [router]);
  const props: ScreenProps = { s, dispatch, params, role, openSheet: setSheet, go };
  const home = view === "home";
  return (
    <div className="grid gap-4">
      {home ? (
        <>
          <SampleBar s={s} dispatch={dispatch} />
          <SegmentedControl
            label="Whose assessments"
            layout="equal"
            value={role}
            onChange={(next) => go(viewHref("home", next === "supervisor" ? { as: "supervisor" } : {}))}
            options={[
              { value: "doctor", label: "My training" },
              { value: "supervisor", label: "I supervise" },
            ]}
          />
        </>
      ) : null}
      <Screen {...props} view={view} />
      <AssessmentsSheets sheet={sheet} close={() => setSheet(null)} {...props} />
    </div>
  );
}

/** Signed in, there is nowhere to keep real records yet: say so, and offer the made-up ones. */
function NotKeptYet({ onTry }: { onTry: () => void }) {
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
