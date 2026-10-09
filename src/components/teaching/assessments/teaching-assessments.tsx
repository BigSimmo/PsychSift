"use client";

import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useReducer, useRef, useState, type Dispatch } from "react";

import { useModeBandCount } from "@/components/mode-band/mode-band";
import { WorkBody, WorkButton, WorkSectionLabel, useWorkUndoToast } from "@/components/mode-kit/work";
import { AssessSegmented, AssessSkeleton } from "@/components/teaching/assessments/assess-kit";
import {
  rememberDct,
  rememberRole,
  rememberStory,
  rememberedDct,
  rememberedRole,
  rememberedStory,
  type AssessRole,
} from "@/components/teaching/assessments/assess-memory";
import { AssessorForm } from "@/components/teaching/assessments/assessments-assessor";
import { DctHome, DctPlan, DctSignoff, type DctProps } from "@/components/teaching/assessments/assessments-dct";
import { AssessmentsHome } from "@/components/teaching/assessments/assessments-home";
import {
  AllAssessments,
  BeginningOfTerm,
  TermDetails,
  YearRequirements,
} from "@/components/teaching/assessments/assessments-year";
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
import { AssessmentsExtrasProvider } from "@/components/teaching/assessments/assessments-extras";
import { AssessmentsKeptInCla, useAssessmentsAccess } from "@/components/teaching/assessments/assessments-kept-in-cla";
import { ExampleOnlyGate } from "@/components/example-data/example-only-gate";
import { AssessmentsInbox } from "@/components/teaching/assessments/assessments-inbox";
import { AssessmentsTermOverview } from "@/components/teaching/assessments/assessments-term-overview";
import { viewHref, type AssessmentsView } from "@/components/teaching/assessments/assessments-parts";
import { TeachingAccountPage } from "@/components/teaching/teaching-depth-page";
import { perthDateKey } from "@/components/teaching/teaching-dates";
import { useTeachingNow } from "@/components/teaching/use-teaching-now";
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
import { dctReducer, dctWaiting, initialDctState, type DctState } from "@/lib/teaching/assessments/dct";
import { useAuthSession } from "@/lib/supabase/client";
import { useExampleData } from "@/lib/example-data/store";

/* Teaching's term card, with the doctor's own EPA tally, loads only on a signed-in doctor's Progress tab. */
const TeachingTermCard = dynamic(
  () => import("@/components/teaching/teaching-term-card").then((m) => m.TeachingTermCard),
  { loading: () => <AssessSkeleton label="Loading your EPA counts" /> },
);

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
  /** Records an EPA and offers Undo for a few seconds ("EPA 1 saved for Dr Sam Karri"). */
  saveEpa: (action: EpaSave) => void;
  /** The DCT's sign-offs, so the doctor's and supervisor's sides show when Sam's form is signed off. */
  dct: DctState;
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
  "inbox",
  "overview",
  "dctsign",
  "plan",
  "epaform",
  "botd",
];

/** Views that are the doctor's own: they never take the supervisor's side. */
const DOCTOR_ONLY: ReadonlySet<AssessmentsView> = new Set(["hub", "reqs", "term", "request", "book", "report", "botd"]);
/** Views that are the DCT's own. */
const DCT_ONLY: ReadonlySet<AssessmentsView> = new Set(["dctsign", "plan"]);
/**
 * The only views the DCT side draws. Any other view with the DCT side named or remembered (History, a form,
 * the PDF) is the doctor's, so it never draws the DCT's home under another title (site audit B2).
 */
const DCT_VIEWS: ReadonlySet<AssessmentsView> = new Set([
  "home",
  "progress",
  "overview",
  "words",
  "help",
  "dctsign",
  "plan",
  "epaform",
]);
/** The tabs show the role switch. */
const TAB_VIEWS: ReadonlySet<AssessmentsView> = new Set(["home", "progress"]);
/**
 * Screens both sides have (the tabs, History, Help and words, Get help): with no `as`
 * in the address they keep whoever's assessments were last shown, so a supervisor who
 * opens one from the tabs or More stays the supervisor.
 */
const ROLE_KEPT: ReadonlySet<AssessmentsView> = new Set([
  "home",
  "progress",
  "all",
  "words",
  "help",
  "overview",
  "epaform",
]);

const isRole = (as: string | null): as is Role => as === "doctor" || as === "supervisor" || as === "dct";

const DATE_OPTIONS = [
  { value: "-1", label: "Mon 5 Oct (week 6)" },
  ...WINDOW_DAYS.map((_, i) => ({ value: String(i), label: dayLabel(i) })),
];

/** Whose screen this is: the address says, or a tab keeps the last choice, or it is the doctor's. */
export function resolveRole(view: AssessmentsView, as: string | null, remembered: Role): Role {
  if (DOCTOR_ONLY.has(view)) return "doctor";
  if (DCT_ONLY.has(view)) return "dct";
  const role = isRole(as) ? as : ROLE_KEPT.has(view) ? remembered : "doctor";
  return role === "dct" && !DCT_VIEWS.has(view) ? "doctor" : role;
}

function Screen(props: ScreenProps & Omit<DctProps, keyof ScreenProps> & { view: AssessmentsView }) {
  const { view, role } = props;
  if (view === "help") return <ConcernsHelp {...props} />;
  if (view === "words") return <SupervisorWords {...props} />;
  // What an assessor gets from a request: the same page from the doctor's or the supervisor's side.
  if (view === "epaform") return <AssessorForm {...props} />;
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
  if (role === "dct") {
    // The DCT has a home, a form to sign and a plan. Their Progress tab is the whole service's term overview.
    if (view === "dctsign") return <DctSignoff {...props} />;
    if (view === "plan") return <DctPlan {...props} />;
    if (view === "progress")
      return (
        <ExampleOnlyGate area="assess" what="The term overview">
          <AssessmentsTermOverview {...props} />
        </ExampleOnlyGate>
      );
    return <DctHome {...props} />;
  }
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
    case "botd":
      return <BeginningOfTerm {...props} />;
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
  const [dct, dctDispatch] = useReducer(dctReducer, undefined, () => rememberedDct(memoryKey) ?? initialDctState());
  useEffect(() => rememberDct(memoryKey, dct), [memoryKey, dct]);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const requested = params.get("view") as AssessmentsView | null;
  const view: AssessmentsView = requested && VIEWS.includes(requested) ? requested : "home";
  const as = params.get("as");
  // The remembered side lives outside React (module memory), read fresh on each screen.
  const role = resolveRole(view, as, rememberedRole());
  useEffect(() => {
    // An address that names a side makes the tabs keep it.
    if (isRole(as) && !DOCTOR_ONLY.has(view) && !DCT_ONLY.has(view)) {
      rememberRole(as);
    }
  }, [as, view]);
  const go = useCallback((href: string) => router.push(href), [router]);
  const toast = useWorkUndoToast();
  const saveEpa = useCallback(
    (action: EpaSave) => {
      const index = action.type === "record-epa" ? action.index : s.epaRequests.length;
      const previous = action.type === "record-epa" ? s.epaRequests[index] : undefined;
      const epa = action.type === "record-epa" ? previous?.epa : action.epa;
      dispatch(action);
      setSavedNote(null);
      const message = `EPA ${epa ?? ""} saved for ${SAMPLE_DOCTOR.name}`;
      const undo = () => {
        dispatch({ type: "undo-record-epa", index, ...(previous ? { previous } : {}) });
        setSavedNote(`EPA ${epa ?? ""} taken back.`);
      };
      if (toast) toast(message, undo, 6000);
      else setSavedNote(`${message}.`);
    },
    [s.epaRequests, toast],
  );
  const props: ScreenProps = { s, dispatch, params, role, openSheet: setSheet, go, saveEpa, dct };
  const onTab = TAB_VIEWS.has(view);
  const root = useRef<HTMLDivElement>(null);
  const place = params.toString();
  const first = useRef(true);
  useModeBandCount(
    "assess-todo",
    role === "dct" ? dctWaiting(s, dct).length : role === "supervisor" ? supervisorTodo(s) : doctorActions(s),
  );
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
    go(viewHref(tab, { as: next }));
  };
  return (
    <div ref={root} className="contents [&_:is(input,textarea,select,button)]:scroll-mb-24">
      {onTab ? (
        <AssessSegmented
          // The switch shows "DCT" (owner decision). Its options take plain text only, so the group's name
          // gives screen readers the full title (site audit P8).
          label="Whose assessments. DCT is the Director of Clinical Training"
          value={role}
          onChange={switchRole}
          options={[
            { value: "doctor", label: "My training" },
            { value: "supervisor", label: "I supervise" },
            { value: "dct", label: "DCT" },
          ]}
        />
      ) : null}
      <AssessmentsExtrasProvider memoryKey={memoryKey}>
        <Screen {...props} dctDispatch={dctDispatch} view={view} />
      </AssessmentsExtrasProvider>
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

/**
 * Get help and Help and words hold no records (WA routes for concerns, phone lines, the 14-day written reply,
 * plain-word definitions), so every reader can open them, signed in or not (site audit A1). Nothing here
 * comes from the made-up story: the disagree draft lives in this page only.
 */
function AssessmentsOpenPage({ view }: { view: "help" | "words" }) {
  const params = useSearchParams();
  const router = useRouter();
  const [s, dispatch] = useReducer(assessmentsReducer, undefined, initialAssessmentsState);
  const [dct] = useState(initialDctState);
  const [sheet, setSheet] = useState<SheetState>(null);
  const as = params.get("as");
  const props: ScreenProps = {
    s,
    dispatch,
    params,
    role: as === "supervisor" || as === "dct" ? as : "doctor",
    openSheet: setSheet,
    go: (href) => router.push(href),
    saveEpa: () => undefined,
    dct,
  };
  return (
    <>
      {view === "help" ? <ConcernsHelp {...props} /> : <SupervisorWords {...props} />}
      <AssessmentsSheets sheet={sheet} close={() => setSheet(null)} {...props} />
    </>
  );
}

/** The address's view when it is one every reader may open, else null. */
function useOpenView(): "help" | "words" | null {
  const view = useSearchParams().get("view");
  return view === "help" || view === "words" ? view : null;
}

/** Signed in, or signed out with the example off: the CLA notice, except on the pages that hold no records. */
function AssessmentsNoExample({ signedOut }: { signedOut: boolean }) {
  const open = useOpenView();
  const progress = useSearchParams().get("view") === "progress";
  const { turnOn } = useExampleData("assess");
  const router = useRouter();
  if (open) return <AssessmentsOpenPage view={open} />;
  // Signed in, the Progress tab shows the doctor's own EPA counts from Teaching, not a second copy of the notice.
  if (progress && !signedOut) return <AssessmentsSignedInProgress />;
  return (
    <>
      <AssessmentsKeptInCla />
      {signedOut ? (
        // A signed-out reader who turned the example off can turn it back on here (site audit B6), as
        // ExampleOnlyGate does on the export and trainee pages.
        <WorkButton
          variant="secondary"
          size="wide"
          onClick={() => {
            turnOn();
            router.refresh();
          }}
          testId="teaching-assessments-look-around"
        >
          Look around with example data
        </WorkButton>
      ) : null}
    </>
  );
}

/**
 * A signed-in doctor's Progress tab (site audit A2): the counts-only EPA tally they keep themselves under
 * Teaching > Term, reused as the term card, with the full counter one tap away. It reads the term tracker the
 * doctor already keeps on this device (backed up to their account), so nothing new is stored. Records themselves
 * stay in CLA.
 */
function AssessmentsSignedInProgress() {
  const now = useTeachingNow();
  return (
    <section data-testid="teaching-assessments-progress" aria-label="Your EPA counts" className="grid gap-3">
      <WorkSectionLabel id="assess-progress-counts" action={{ label: "Count EPAs", href: "/teaching/term" }}>
        Your EPA counts
      </WorkSectionLabel>
      {now ? <TeachingTermCard demoMode={false} today={perthDateKey(now)} /> : <AssessSkeleton />}
      <p className="m-0 px-1 text-sm text-[color:var(--text-muted)]">
        Counts you log yourself in Teaching, with no case details. Your forms and EPAs themselves stay in CLA.
      </p>
    </section>
  );
}

function AssessmentsPage({ demoMode }: { demoMode: boolean }) {
  // Signed out, the Assessments example shows by itself under the shared banner. Signed in, records stay
  // in CLA (owner decision 7 Oct 2026), so the made-up ones never show, even with the example data on.
  const { active } = useExampleData("assess");
  const access = useAssessmentsAccess();
  const sample = demoMode || (active && access === "signed-out");
  return (
    <WorkBody testId="teaching-assessments">
      <h1 className="sr-only">Assessments</h1>
      {!demoMode && access === "loading" ? (
        <AssessSkeleton />
      ) : sample ? (
        <Suspense fallback={<AssessSkeleton />}>
          <AssessmentsApp />
        </Suspense>
      ) : (
        <Suspense fallback={<AssessSkeleton />}>
          <AssessmentsNoExample signedOut={access === "signed-out"} />
        </Suspense>
      )}
    </WorkBody>
  );
}

export function TeachingAssessments(props: { demoMode: boolean }) {
  return <TeachingAccountPage component={AssessmentsPage} {...props} />;
}
