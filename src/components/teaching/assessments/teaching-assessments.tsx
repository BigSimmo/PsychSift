"use client";

import { FileText } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useReducer, useRef, useState, type Dispatch } from "react";

import { useModeBandCount } from "@/components/mode-band/mode-band";
import { WorkBody, WorkButton, WorkEmpty, useWorkUndoToast } from "@/components/mode-kit/work";
import { AssessSample, AssessSegmented, AssessSkeleton } from "@/components/teaching/assessments/assess-kit";
import {
  rememberRole,
  rememberStory,
  rememberedRole,
  rememberedStory,
  type AssessRole,
} from "@/components/teaching/assessments/assess-memory";
import { AssessmentsHome } from "@/components/teaching/assessments/assessments-home";
import { AllAssessments, TermDetails, YearRequirements } from "@/components/teaching/assessments/assessments-year";
import { AssessmentForm } from "@/components/teaching/assessments/assessments-form";
import { AskSupervisor, BookMeeting, EndOfTermSteps } from "@/components/teaching/assessments/assessments-steps";
import { AssessmentReport, SignForm } from "@/components/teaching/assessments/assessments-report";
import { ConcernsHelp, AssessmentsSheets, type SheetState } from "@/components/teaching/assessments/assessments-help";
import {
  DoctorRecord,
  SideBySide,
  SupervisorHistory,
  SupervisorHome,
  SupervisorProgress,
  SupervisorTimes,
  SupervisorWords,
} from "@/components/teaching/assessments/assessments-supervisor";
import { viewHref, type AssessmentsView } from "@/components/teaching/assessments/assessments-parts";
import { TeachingAccountPage } from "@/components/teaching/teaching-depth-page";
import { useWorkFrameAction } from "@/components/work-frame/work-frame-store";
import {
  assessmentsReducer,
  dayLabel,
  doctorActions,
  initialAssessmentsState,
  supervisorTodo,
  type AssessmentsAction,
  type AssessmentsState,
} from "@/lib/teaching/assessments/model";
import { SAMPLE_DOCTOR, WINDOW_DAYS } from "@/lib/teaching/assessments/sample";
import { useAuthSession } from "@/lib/supabase/client";

/* The printable form is heavy and opened rarely, so it loads only when asked for. */
const FormPdf = dynamic(() => import("@/components/teaching/assessments/assessments-pdf").then((m) => m.FormPdf), {
  loading: () => <AssessSkeleton label="Loading the form" />,
});

export type Role = AssessRole;

export type EpaSave = Extract<AssessmentsAction, { type: "record-epa" | "record-epa-direct" }>;

export type ScreenProps = {
  s: AssessmentsState;
  dispatch: Dispatch<AssessmentsAction>;
  params: URLSearchParams;
  role: Role;
  openSheet: (sheet: SheetState) => void;
  go: (href: string) => void;
  /** Records an EPA and offers Undo for a few seconds ("EPA 1 saved for Dr Sam Lee"). */
  saveEpa: (action: EpaSave) => void;
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
  "progress",
  "record",
  "words",
];

/** Views that are the doctor's own: they never take the supervisor's side. */
const DOCTOR_ONLY: ReadonlySet<AssessmentsView> = new Set(["hub", "reqs", "term", "request", "book", "report"]);
/** The tabs: with no `as` in the address they keep whoever's assessments were last shown. */
const TAB_VIEWS: ReadonlySet<AssessmentsView> = new Set(["home", "progress"]);

const DATE_OPTIONS = [
  { value: "-1", label: "Mon 5 Oct (week 6)" },
  ...WINDOW_DAYS.map((_, i) => ({ value: String(i), label: dayLabel(i) })),
];

/** Whose screen this is: the address says, or a tab keeps the last choice, or it is the doctor's. */
export function resolveRole(view: AssessmentsView, as: string | null, remembered: Role): Role {
  if (DOCTOR_ONLY.has(view)) return "doctor";
  if (as === "supervisor" || as === "doctor") return as;
  return TAB_VIEWS.has(view) ? remembered : "doctor";
}

function Screen(props: ScreenProps & { view: AssessmentsView }) {
  const { view, role } = props;
  if (view === "help") return <ConcernsHelp {...props} />;
  if (view === "words") return <SupervisorWords {...props} />;
  if (role === "supervisor") {
    if (view === "form") return <AssessmentForm {...props} who="sup" />;
    if (view === "sign") return <SignForm {...props} who="sup" />;
    if (view === "side") return <SideBySide {...props} />;
    if (view === "times") return <SupervisorTimes {...props} />;
    if (view === "pdf") return <FormPdf {...props} />;
    if (view === "progress") return <SupervisorProgress {...props} />;
    if (view === "record") return <DoctorRecord {...props} />;
    if (view === "all") return <SupervisorHistory {...props} />;
    return <SupervisorHome {...props} />;
  }
  switch (view) {
    case "hub":
      return <EndOfTermSteps {...props} />;
    case "reqs":
    case "record":
      return <YearRequirements {...props} />;
    case "progress":
      return <YearRequirements {...props} tab />;
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
    default:
      return <AssessmentsHome {...props} />;
  }
}

/**
 * The made-up story's own tool: move the made-up date to walk the end-of-term
 * steps. A demo control, so it sits at the foot of the To do tab.
 */
function TryTheStory({ s, dispatch }: Pick<ScreenProps, "s" | "dispatch">) {
  return (
    <div className="grid gap-1.5 pt-2">
      <label htmlFor="assess-made-up-date" className="work-label">
        Try the story
      </label>
      <select
        id="assess-made-up-date"
        value={String(s.now)}
        onChange={(event) => dispatch({ type: "set-now", now: Number(event.target.value) })}
        className="assess-txt cursor-pointer"
        aria-describedby="assess-made-up-date-note"
      >
        {DATE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {`Made-up date: ${o.label}`}
          </option>
        ))}
      </select>
      <p id="assess-made-up-date-note" className="assess-note">
        <span>
          Move the made-up date to open the booking window and the signing steps. It can&apos;t go back before something
          already recorded.
        </span>
      </p>
    </div>
  );
}

function AssessmentsApp() {
  const params = useSearchParams();
  const router = useRouter();
  const auth = useAuthSession();
  const memoryKey = String(auth.authEpoch);
  const [s, dispatch] = useReducer(
    assessmentsReducer,
    undefined,
    () => rememberedStory(memoryKey) ?? initialAssessmentsState(),
  );
  useEffect(() => rememberStory(memoryKey, s), [memoryKey, s]);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const requested = params.get("view") as AssessmentsView | null;
  const view: AssessmentsView = requested && VIEWS.includes(requested) ? requested : "home";
  const as = params.get("as");
  // The remembered side lives outside React (module memory), read fresh on each screen.
  const role = resolveRole(view, as, rememberedRole());
  useEffect(() => {
    // An address that names a side makes the tabs keep it.
    if ((as === "supervisor" || as === "doctor") && !DOCTOR_ONLY.has(view)) {
      rememberRole(as);
    }
  }, [as, view]);
  const go = useCallback((href: string) => router.push(href), [router]);
  const toast = useWorkUndoToast();
  const saveEpa = useCallback(
    (action: EpaSave) => {
      const index = action.type === "record-epa" ? action.index : s.epaRequests.length;
      const epa = action.type === "record-epa" ? s.epaRequests[index]?.epa : action.epa;
      dispatch(action);
      setSavedNote(null);
      const message = `EPA ${epa ?? ""} saved for ${SAMPLE_DOCTOR.name}`;
      const undo = () => {
        dispatch({ type: "undo-record-epa", index });
        setSavedNote(`EPA ${epa ?? ""} taken back.`);
      };
      if (toast) toast(message, undo, 6000);
      else setSavedNote(`${message}.`);
    },
    [s.epaRequests, toast],
  );
  const props: ScreenProps = { s, dispatch, params, role, openSheet: setSheet, go, saveEpa };
  const onTab = TAB_VIEWS.has(view);
  const root = useRef<HTMLDivElement>(null);
  const place = params.toString();
  const first = useRef(true);
  useModeBandCount("assess-todo", role === "supervisor" ? supervisorTodo(s) : doctorActions(s));
  // More's "Record an EPA": the supervisor's two-tap EPA, from wherever the page is.
  useWorkFrameAction("assess-record-epa", role === "supervisor" ? () => setSheet({ kind: "recordepa" }) : null);
  useEffect(() => {
    // On every move to another screen (not the first load): close any open sheet and put focus on the new screen's title.
    if (first.current) {
      first.current = false;
      return;
    }
    setSheet(null);
    setSavedNote(null);
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
  const switchRole = (next: Role) => {
    if (next === role) return;
    rememberRole(next);
    const tab = view === "progress" ? "progress" : "home";
    go(viewHref(tab, next === "supervisor" ? { as: "supervisor" } : { as: "doctor" }));
  };
  return (
    <div ref={root} className="contents [&_:is(input,textarea,select,button)]:scroll-mb-24">
      <AssessSample testId="teaching-assessments-sample">
        Made-up example records. Nothing is saved or sent.
      </AssessSample>
      {onTab ? (
        <AssessSegmented
          label="Whose assessments"
          value={role}
          onChange={switchRole}
          options={[
            { value: "doctor", label: "My training" },
            { value: "supervisor", label: "I supervise" },
          ]}
        />
      ) : null}
      <Screen {...props} view={view} />
      {view === "home" ? <TryTheStory s={s} dispatch={dispatch} /> : null}
      {savedNote ? (
        <p role="status" className="assess-note" data-center="">
          <span>{savedNote}</span>
        </p>
      ) : null}
      <AssessmentsSheets sheet={sheet} close={() => setSheet(null)} {...props} />
    </div>
  );
}

/** Signed in, there is nowhere to keep real records yet: say so, and offer the made-up ones. */
function NotKeptYet({ onTry }: { onTry: () => void }) {
  return (
    <section data-testid="teaching-assessments-not-yet" aria-label="Assessment records">
      <WorkEmpty
        icon={FileText}
        title="Records can't be kept here yet"
        body="Forms and EPAs stay in Clinical Learning Australia (CLA) and with your Medical Education Unit (MEU). Try this page on made-up records. Nothing is saved or sent."
        action={<WorkButton onClick={onTry}>Try with made-up records</WorkButton>}
      />
    </section>
  );
}

function AssessmentsPage({ demoMode }: { demoMode: boolean }) {
  const [practice, setPractice] = useState(false);
  const sample = demoMode || practice;
  return (
    <WorkBody testId="teaching-assessments">
      <h1 className="sr-only">Assessments</h1>
      {sample ? (
        <Suspense fallback={<AssessSkeleton />}>
          <AssessmentsApp />
        </Suspense>
      ) : (
        <NotKeptYet onTry={() => setPractice(true)} />
      )}
    </WorkBody>
  );
}

export function TeachingAssessments(props: { demoMode: boolean }) {
  return <TeachingAccountPage component={AssessmentsPage} {...props} />;
}
