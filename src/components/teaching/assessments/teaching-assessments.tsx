"use client";

import { ClipboardCheck } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useReducer, useRef, useState, type Dispatch } from "react";

import { InformationPageShell } from "@/components/information-page-shell";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { modeModuleSurface } from "@/components/mode-kit/recipes";
import { AssessmentsHome } from "@/components/teaching/assessments/assessments-home";
import { AllAssessments, TermDetails, YearRequirements } from "@/components/teaching/assessments/assessments-year";
import { AssessmentForm } from "@/components/teaching/assessments/assessments-form";
import { AskSupervisor, BookMeeting, EndOfTermSteps } from "@/components/teaching/assessments/assessments-steps";
import { AssessmentReport, SignForm } from "@/components/teaching/assessments/assessments-report";
import { ConcernsHelp, AssessmentsSheets, type SheetState } from "@/components/teaching/assessments/assessments-help";
import { AssessmentsExtrasProvider } from "@/components/teaching/assessments/assessments-extras";
import { ExampleOnlyGate } from "@/components/example-data/example-only-gate";
import { AssessmentsInbox } from "@/components/teaching/assessments/assessments-inbox";
import { AssessmentsTermOverview } from "@/components/teaching/assessments/assessments-term-overview";
import { SideBySide, SupervisorHome, SupervisorTimes } from "@/components/teaching/assessments/assessments-supervisor";
import { viewHref, type AssessmentsView } from "@/components/teaching/assessments/assessments-parts";
import { TeachingAccountPage } from "@/components/teaching/teaching-depth-page";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn, fieldControlPlain, textMuted } from "@/components/ui-primitives";
import {
  assessmentsReducer,
  dayLabel,
  initialAssessmentsState,
  type AssessmentsAction,
  type AssessmentsState,
} from "@/lib/teaching/assessments/model";
import { useExampleData } from "@/lib/example-data/store";
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
  "inbox",
  "overview",
];

const DATE_OPTIONS = [
  { value: "-1", label: "Mon 5 Oct (week 6)" },
  ...WINDOW_DAYS.map((_, i) => ({ value: String(i), label: dayLabel(i) })),
];

function Screen(props: ScreenProps & { view: AssessmentsView }) {
  const { view, role } = props;
  // The two added sample views (features 16 and 4) read the same made-up records from either role.
  // They have no real data source yet, so a real user only reaches them with Assessments example data on.
  if (view === "inbox")
    return (
      <ExampleOnlyGate area="assess" what="The inbox">
        <AssessmentsInbox {...props} />
      </ExampleOnlyGate>
    );
  if (view === "overview")
    return (
      <ExampleOnlyGate area="assess" what="The term overview">
        <AssessmentsTermOverview {...props} />
      </ExampleOnlyGate>
    );
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

/** The made-up records' own control: a made-up date to move. The shared example data banner says nothing is kept. */
function SampleBar({ s, dispatch, showDate }: Pick<ScreenProps, "s" | "dispatch"> & { showDate: boolean }) {
  if (!showDate) return null;
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1" data-testid="teaching-assessments-sample">
      {showDate ? (
        <label className={cn("flex items-center gap-2 text-sm", textMuted)}>
          Made-up date
          <select
            value={String(s.now)}
            onChange={(event) => dispatch({ type: "set-now", now: Number(event.target.value) })}
            className={cn(fieldControlPlain, "w-auto pr-8")}
          >
            {DATE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
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
  const root = useRef<HTMLDivElement>(null);
  const place = params.toString();
  const first = useRef(true);
  useEffect(() => {
    // On every move to another screen (not the first load): close any open sheet and put focus on the new screen's title.
    if (first.current) {
      first.current = false;
      return;
    }
    setSheet(null);
    const heading =
      root.current?.querySelector<HTMLElement>("[data-screen-heading]") ??
      root.current?.querySelector<HTMLElement>("h2");
    if (heading && !heading.hasAttribute("tabindex")) {
      heading.setAttribute("tabindex", "-1");
      // A title focused for screen readers is not a control, so it gets no focus ring.
      heading.classList.add("outline-none");
    }
    heading?.focus({ preventScroll: true });
  }, [place]);
  return (
    <div
      ref={root}
      className="grid gap-3 [&_:is(input,textarea,select,button)]:scroll-mb-20"
      data-mode-identity="teaching"
    >
      <SampleBar s={s} dispatch={dispatch} showDate={home} />
      {home ? (
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
      ) : null}
      <AssessmentsExtrasProvider>
        <Screen {...props} view={view} />
      </AssessmentsExtrasProvider>
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
  // "Try it with made-up records" turns on the one example data switch, so the shared banner shows and Turn off works.
  const { active, turnOn } = useExampleData("assess");
  const sample = demoMode || active;
  return (
    <InformationPageShell width="narrow" gap={false} testId="teaching-assessments">
      <h1 className="sr-only">Assessments</h1>
      {sample ? (
        <Suspense fallback={<ModeModuleSkeleton rows={4} />}>
          <AssessmentsApp />
        </Suspense>
      ) : (
        <NotKeptYet onTry={turnOn} />
      )}
    </InformationPageShell>
  );
}

export function TeachingAssessments(props: { demoMode: boolean }) {
  return <TeachingAccountPage component={AssessmentsPage} {...props} />;
}
