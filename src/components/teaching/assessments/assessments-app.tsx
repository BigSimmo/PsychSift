"use client";

import { Info } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { AssessmentsHome } from "@/components/teaching/assessments/assessments-home";
import { AllAssessments, TermDetails, YearRequirements } from "@/components/teaching/assessments/assessments-year";
import { AssessmentForm } from "@/components/teaching/assessments/assessments-form";
import { AskSupervisor, BookMeeting, EndOfTermSteps } from "@/components/teaching/assessments/assessments-steps";
import { AssessmentReport, SignForm } from "@/components/teaching/assessments/assessments-report";
import { ConcernsHelp, AssessmentsSheets, type SheetState } from "@/components/teaching/assessments/assessments-help";
import { AssessmentsExtrasProvider } from "@/components/teaching/assessments/assessments-extras";
import { AssessmentsInbox } from "@/components/teaching/assessments/assessments-inbox";
import { AssessmentsTermOverview } from "@/components/teaching/assessments/assessments-term-overview";
import { SideBySide, SupervisorHome, SupervisorTimes } from "@/components/teaching/assessments/assessments-supervisor";
import { viewHref, type AssessmentsView } from "@/components/teaching/assessments/assessments-parts";
import type { Role, ScreenProps } from "@/components/teaching/assessments/teaching-assessments";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn, fieldControlPlain, textMuted } from "@/components/ui-primitives";
import { assessmentsReducer, dayLabel, initialAssessmentsState } from "@/lib/teaching/assessments/model";
import { WINDOW_DAYS } from "@/lib/teaching/assessments/sample";

/*
 * The made-up Assessments app. It lives apart from the page so a signed-in doctor, who only sees the
 * "not kept yet" card, never downloads these screens until they choose to try the made-up records.
 */

/* The printable form is heavy and opened rarely, so it loads only when asked for. */
const FormPdf = dynamic(() => import("@/components/teaching/assessments/assessments-pdf").then((m) => m.FormPdf), {
  loading: () => <ModeModuleSkeleton rows={3} />,
});

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
  if (view === "inbox") return <AssessmentsInbox {...props} />;
  if (view === "overview") return <AssessmentsTermOverview {...props} />;
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
function SampleBar({ s, dispatch, showDate }: Pick<ScreenProps, "s" | "dispatch"> & { showDate: boolean }) {
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
      data-testid="teaching-assessments-sample"
    >
      <p role="status" className={cn("flex items-center gap-1.5 text-sm", textMuted)}>
        <Info aria-hidden="true" className="size-icon-sm shrink-0" />
        Made-up example records. Nothing is saved or sent.
      </p>
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

export function AssessmentsApp() {
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
