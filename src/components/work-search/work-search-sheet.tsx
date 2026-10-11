"use client";

import {
  BookOpen,
  ChevronRight,
  Clock,
  CornerDownLeft,
  FileText,
  History,
  LayoutGrid,
  Phone,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  WifiOff,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react";

import {
  mayRecordRecentSearches,
  readAppPreferences,
  subscribeAppPreferences,
} from "@/components/clinical-dashboard/use-app-preferences";
import { WorkButton, WorkEmpty } from "@/components/mode-kit/work";
import { useWorkModeRouteVisible } from "@/components/work-mode-launch/work-mode-launch-provider";
import { useWorkSearchRecords } from "@/components/work-search/use-work-search-records";
import { AnswerCard } from "@/components/work-search/work-search-answer-card";
import {
  ActionRow,
  AREA_ICONS,
  GroupHead,
  LabelAction,
  ListCard,
  moveFocus,
  onPlainClick,
  ResultRow,
  SectionLabel,
} from "@/components/work-search/work-search-parts";
import { WorkSearchGlyph } from "@/components/work-search/work-search-glyph";
import { workFrameIcons } from "@/components/work-frame/work-frame-icons";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/components/ui-primitives";
import { appModeHomeHref } from "@/lib/app-modes";
import { documentsSearchHref } from "@/lib/document-flow-routes";
import { addDaysToDate, formatPerthDay, perthDateOf } from "@/lib/perth-time";
import { AGREEMENT_PAGE_HREF } from "@/lib/work-profile/agreement-answers";
import { answerWorkQuestion, type WorkAnswer } from "@/lib/work-search/answers";
import { workSearchAreaLabels, workSearchAreas, type WorkAreaRead, type WorkSearchArea } from "@/lib/work-search/model";
import {
  clearedNoticeOwed,
  clearRecents,
  closedByNavigating,
  forgetRecent,
  holdHistoryStep,
  holdsHistoryStep,
  markKeystroke,
  measureKeystrokeToResults,
  measureOpenToFirstResult,
  noteClosing,
  recentsFor,
  rememberQuery,
  resumableSearch,
  takeClearedFlag,
  takeHistoryStep,
} from "@/lib/work-search/memory";
import { agreementWorkAnswer } from "@/lib/work-search/feature-pages";
import { searchWorkPages } from "@/lib/work-search/pages";
import {
  buildWorkSearchIndex,
  collapseSeries,
  type WorkSearchHit,
  searchWork,
  seriesKey,
  workComingUp,
  workSearchCorrection,
  workSearchCounts,
  workSearchNothingFound,
} from "@/lib/work-search/search";
import {
  clinicalSearchHref,
  looksLikePatientDetails,
  patientClinicalHandOff,
  workSearchGate,
} from "@/lib/work-search/signals";

/**
 * "AI Search", restyled to the locked work-mode mockup (work-mode
 * redesign, owner request 6 Oct 2026): a flat full screen (solid, so the page
 * under it never shows through), a pill field in that page's colour, area chips with counts,
 * answers as a hero, and every result a row from the work-mode kit.
 *
 * Fast: results follow typing after a short pause (about 80 ms), from an index
 * built once from the records already read; the screen's code is fetched while
 * the page is idle. Smart without AI: built-in answers to plain questions, read
 * through small typos and synonyms, urgency first. Pages are found by name.
 *
 * Safe: anything that looks like patient details is never looked up, never kept
 * in Recent, and is cleared from the box if left there; the next opening says
 * so. A clinical question is handed to clinical search as a link only.
 */

/** The built-in questions, offered on the empty screen and as "Ask" suggestions while typing. */
const QUESTIONS = [
  "When am I next on nights?",
  "What is due this month?",
  "Am I working tomorrow?",
  "How many CPD hours do I still need?",
  "When is my next shift?",
  "What am I doing this weekend?",
  "When is my next leave?",
  "Am I presenting?",
  "How many nights this month?",
  "Which days am I off this week?",
] as const;

const TRY_ASKING = QUESTIONS.slice(0, 3);

/** How long typing must pause before the results follow it. Short enough to feel instant. */
const DEBOUNCE_MS = 80;
/** Patient details left in the box this long are cleared from it. */
const PATIENT_CLEAR_MS = 10_000;

function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Built-in questions every typed word starts a word of: "next nig" finds "When am I next on nights?". */
function suggestQuestions(query: string): string[] {
  const typed = wordsOf(query);
  if (typed.join("").length < 3) return [];
  return QUESTIONS.filter((question) => {
    const words = wordsOf(question);
    return typed.every((word) => words.some((candidate) => candidate.startsWith(word)));
  }).slice(0, 2);
}

const GROUP_PREVIEW = 4;
/** A single group opens fuller, but still not to every record at once. */
const SINGLE_GROUP_PREVIEW = 12;
const PAGES_PREVIEW = 3;

/** Which area a no-match query was most likely about, for "Open …" in Try instead. */
function guessArea(query: string, fallback: WorkSearchArea): WorkSearchArea {
  const text = query.toLowerCase();
  if (/\b(rost\w*|shifts?|nights?|leave|swap|on ?call shift)\b/.test(text)) return "roster";
  if (/\b(teach\w*|sessions?|talks?|journal|tutorial|lecture)\b/.test(text)) return "teaching";
  if (/\b(cpd|cme|hours|reflection|college)\b/.test(text)) return "cme";
  if (/\b(forms?|polic\w*|renew\w*|expir\w*|pay|claims?|admin|permits?|parking)\b/.test(text)) return "my-work";
  if (/\b(phones?|pager|contacts?|referr\w*|switch\w*|extension|ext)\b/.test(text)) return "on-call";
  return fallback;
}

/** What each area holds, under "Open …" when nothing matched. */
const AREA_HOLDS: Readonly<Record<WorkSearchArea, string>> = {
  roster: "Shifts, leave and swaps",
  teaching: "Sessions, talks and assessments",
  cme: "Your CPD log and targets",
  "my-work": "Forms, policies and renewals",
  "on-call": "Contacts, referrals and guides",
};

/** A notice card: a flat tile, a bold line over a short one, and an optional action. */
function Notice({
  icon: Icon,
  tone = "neutral",
  title,
  body,
  action,
  live = false,
  testId,
}: {
  icon: LucideIcon;
  tone?: "neutral" | "amber";
  title: string;
  body: string;
  action?: ReactNode;
  live?: boolean;
  testId?: string;
}) {
  return (
    <div role={live ? "status" : "note"} className="work-card" data-testid={testId}>
      <div className="work-row">
        <span aria-hidden="true" className="work-ic" data-tone={tone}>
          <Icon aria-hidden="true" strokeWidth={2} />
        </span>
        <span className="work-row__text">
          <span className="work-row__title">{title}</span>
          <span className="work-row__sub">{body}</span>
        </span>
        {action}
      </div>
    </div>
  );
}

function RetryButton({ onRetry, label }: { onRetry: () => void; label: string }) {
  return (
    <button type="button" onClick={onRetry} aria-label={label} className="work-button" data-variant="secondary">
      <RotateCcw aria-hidden="true" strokeWidth={2} />
      Retry
    </button>
  );
}

function AreaNotices({
  areas,
  missing,
  offline,
  onRetry,
}: {
  areas: readonly WorkAreaRead[];
  /** What the answer below may lack because of it: "Your talks". */
  missing?: string;
  /** The browser reports no network: say that, not which area. */
  offline: boolean;
  onRetry: () => void;
}) {
  const failed = areas.filter((area) => area.status === "failed").map((area) => workSearchAreaLabels[area.area]);
  // Admin and On Call share one read, so name it once.
  const names = [...new Set(failed)];
  if (names.length === 0) return null;
  if (offline) {
    return (
      <Notice
        icon={WifiOff}
        title="No connection"
        body="Your records could not be reached. Check your connection and retry."
        action={<RetryButton onRetry={onRetry} label="Retry loading your records" />}
        live
      />
    );
  }
  return (
    <Notice
      icon={TriangleAlert}
      title={`Couldn't check ${names.join(", ")}`}
      body={
        missing
          ? `${missing} may be missing from this answer.`
          : `${names.length === 1 ? "It wasn't" : "They weren't"} searched, so something may be missing.`
      }
      action={<RetryButton onRetry={onRetry} label={`Retry loading ${names.join(" and ")}`} />}
      live
    />
  );
}

/** The line at the foot of the screen, in the flow of the page (never a fixed bar): what is never searched. */
function FootNote({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 flex items-start gap-1.5 px-1 pb-2 pt-1 text-2xs font-semibold leading-snug text-[color:var(--text-muted)]">
      <ShieldCheck aria-hidden="true" className="mt-px size-3.5 shrink-0 text-[color:var(--success)]" strokeWidth={2} />
      <span>{children}</span>
    </p>
  );
}

/** A built-in question offered while typing: tap (or Enter) to ask it. */
function AskCard({ question, query, onAsk }: { question: string; query: string; onAsk: () => void }) {
  return (
    <button type="button" onClick={onAsk} className="work-row">
      <span
        aria-hidden="true"
        className="grid size-6.5 shrink-0 place-items-center rounded-full bg-[color:var(--mode-identity-soft)] text-[color:var(--mode-identity)]"
      >
        <Sparkles aria-hidden="true" className="size-3.5" strokeWidth={2} />
      </span>
      <span className="work-row__text">
        <span className="text-3xs font-bold uppercase tracking-widest text-[color:var(--mode-identity)]">Ask</span>
        <span className="work-row__title font-semibold">
          <AskHighlight text={question} query={query} />
        </span>
      </span>
      <span
        aria-hidden="true"
        className="grid size-7 shrink-0 place-items-center rounded-lg bg-[color:var(--mode-identity-soft)] text-[color:var(--mode-identity)]"
      >
        <CornerDownLeft aria-hidden="true" className="size-3.5" strokeWidth={2} />
      </span>
    </button>
  );
}

/** Marks the typed letters at the start of each matching word in a suggested question ("nigh" in "nights"). */
function AskHighlight({ text, query }: { text: string; query: string }) {
  const typed = wordsOf(query);
  return (
    <>
      {text.split(/(\s+)/).map((part, index) => {
        const plain = part.toLowerCase().replace(/[’']/g, "");
        const hit = typed.find((word) => word.length > 0 && plain.startsWith(word));
        if (!hit || /^\s+$/.test(part)) return <span key={index}>{part}</span>;
        const length = part.length - plain.length + hit.length;
        return (
          <span key={index}>
            <mark className="rounded-xs bg-[color:color-mix(in_srgb,var(--mode-identity)_12%,transparent)] font-extrabold text-[color:var(--text-heading)] forced-colors:bg-[Mark] forced-colors:text-[MarkText]">
              {part.slice(0, length)}
            </mark>
            {part.slice(length)}
          </span>
        );
      })}
    </>
  );
}

/** Every record the lists can show, once, without the ones the answer card already shows. */
function listedResults(answer: WorkAnswer | null, hits: readonly WorkSearchHit[], today: string, now: number) {
  const answerItems = answer?.items ?? [];
  const extraFromAnswer = Boolean(answer && answer.area !== "all" && answerItems.length > 1);
  // An answer about one record (or a whole-work list) shows its records itself, so they are not repeated.
  const hiddenIds = new Set(answer && !extraFromAnswer ? answerItems.map((item) => item.id) : []);
  // The answer's own records are folded like search results, so "Am I presenting?" shows a weekly
  // talk once with "+2 more". Search results are folded already, so their series are not counted twice.
  const extra = extraFromAnswer
    ? collapseSeries(
        answerItems.map((item) => ({ item, rank: 0 as const })),
        today,
        now,
      )
    : [];
  const extraSeries = new Set(extra.filter((hit) => hit.item.kind === "session").map((hit) => seriesKey(hit.item)));
  const seen = new Set<string>();
  return [...extra, ...hits].filter((hit, position) => {
    if (seen.has(hit.item.id) || hiddenIds.has(hit.item.id)) return false;
    if (position >= extra.length && hit.item.kind === "session" && extraSeries.has(seriesKey(hit.item))) return false;
    seen.add(hit.item.id);
    return true;
  });
}

/** The groups under the answer: the answer's area first, then the area the search was opened from. */
function groupResults(
  listed: readonly WorkSearchHit[],
  filter: WorkSearchArea | "all",
  currentArea: WorkSearchArea | null,
  answer: WorkAnswer | null,
) {
  const pool = listed.filter((hit) => filter === "all" || hit.item.area === filter);
  const order = currentArea
    ? [currentArea, ...workSearchAreas.filter((area) => area !== currentArea)]
    : workSearchAreas;
  const leading = answer && answer.area !== "all" ? [answer.area] : [];
  const areas = [...new Set([...leading, ...order])];
  return areas
    .map((area) => ({ area, hits: pool.filter((hit) => hit.item.area === area) }))
    .filter((group) => group.hits.length > 0);
}

export interface WorkSearchSheetProps {
  readonly open: boolean;
  /** `navigated` is true when the reader opened a result, so focus belongs to the new page. */
  readonly onClose: (navigated?: boolean) => void;
  /** The work area the search was opened from: its results come first. */
  readonly currentArea: WorkSearchArea | null;
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
}

function returnFocusAfterClose(): HTMLElement | null {
  return closedByNavigating() ? document.getElementById("main-content") : null;
}

function usesFinePointer(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(hover: hover) and (pointer: fine)").matches === true;
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/**
 * The pill field: a 42px glass pill with a ring in the page's colour (amber for patient details) and a
 * soft halo just outside it. Its buttons keep 48px taps, overhanging the pill by 3px top and bottom.
 */
const fieldShell =
  "search-shell my-0.75 flex h-10.5 min-w-0 flex-1 items-center gap-2 rounded-full bg-[color:var(--surface-raised)] pl-3.5 pr-0.5 ring-inset outline-4 forced-colors:outline-1 forced-colors:outline-[CanvasText]";
const fieldRing =
  "ring-2 ring-[color:color-mix(in_srgb,var(--mode-identity)_45%,transparent)] outline-[color:color-mix(in_srgb,var(--mode-identity)_10%,transparent)] focus-within:ring-[color:var(--mode-identity)] focus-within:outline-[color:color-mix(in_srgb,var(--mode-identity)_16%,transparent)]";
const fieldRingWarn =
  "ring-2 ring-[color:var(--warning)] outline-[color:color-mix(in_srgb,var(--warning)_14%,transparent)]";

function readSaveRecentSearches(): boolean {
  return readAppPreferences().saveRecentSearches;
}

export function WorkSearchSheet({ open, onClose, currentArea, returnFocusRef }: WorkSearchSheetProps) {
  const [now, setNow] = useState(() => Date.now());
  const today = perthDateOf(now);
  const records = useWorkSearchRecords(now);
  // The agreement page is a new-work-mode screen: its answers are offered only where it can open.
  const agreementVisible = useWorkModeRouteVisible()(AGREEMENT_PAGE_HREF);
  const epoch = records.epoch;
  const accent = currentArea ?? "my-day";
  // Reopened within a few minutes, the last search comes back (selected, so typing replaces it).
  const [query, setQuery] = useState(() => resumableSearch(epoch));
  // The results follow the box after a short pause, so a fast typist is never held up.
  const [settledQuery, setSettledQuery] = useState(query);
  // An emptied box empties the results at once; anything typed follows after the pause.
  const searchQuery = query.trim() === "" ? "" : settledQuery;
  const [filter, setFilter] = useState<WorkSearchArea | "all">("all");
  const [expanded, setExpanded] = useState<WorkSearchArea | "pages" | null>(null);
  // Privacy's "Save recent searches" off: nothing is kept, and nothing kept before is shown. Read live, so
  // turning it off in another tab (or the account copy arriving) hides Recent at once.
  const keepRecents = useSyncExternalStore(subscribeAppPreferences, readSaveRecentSearches, () => false);
  const [storedRecents, setRecents] = useState(() => (keepRecents ? recentsFor(epoch) : []));
  const recents = keepRecents ? storedRecents : [];
  const [scrolled, setScrolled] = useState(false);
  const [chipsMore, setChipsMore] = useState(false);
  /** The query "Search for … exactly" was tapped for: one-letter-out matching is off until it changes. */
  const [exactFor, setExactFor] = useState<string | null>(null);
  const [liveText, setLiveText] = useState("");
  /** "Cleared what you typed", shown until the next keystroke. */
  const [clearedNotice, setClearedNotice] = useState(() => clearedNoticeOwed(epoch));
  const [offline, setOffline] = useState(isOffline);
  const inputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const chipsRef = useRef<HTMLDivElement>(null);
  const [pendingFocus, setPendingFocus] = useState<{ area: WorkSearchArea | "pages"; index: number } | null>(null);

  // The notice is shown once: the flag is spent as it is read.
  useEffect(() => {
    takeClearedFlag(epoch);
  }, [epoch]);

  // "Today" and "on now" stay right if the search is left open across a shift change or midnight.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!query) return;
    const frame = window.requestAnimationFrame(() => inputRef.current?.select());
    return () => window.cancelAnimationFrame(frame);
    // Only on opening, to select a restored search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (query.trim() === "") return;
    const timer = window.setTimeout(() => setSettledQuery(query), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  // Patient details are spotted on the box itself, at once, not after the pause.
  const patientNow = looksLikePatientDetails(query);
  const trimmed = searchQuery.trim();
  const typed = query.trim().length > 0;
  const gate = workSearchGate(trimmed);
  const patient = patientNow || gate.patient;
  const clinical = !patient && gate.clinical;
  // Patient details with a clinical question in them: clinical search is offered too, empty.
  const clinicalHandOff = patientClinicalHandOff(query);
  const searchable = gate.search && !patient;
  const exact = exactFor !== null && exactFor === trimmed;

  const clearPatientDetails = (automatic: boolean) => {
    setQuery("");
    setSettledQuery("");
    setExpanded(null);
    // Cleared while the search is open: the notice shows here and now, so nothing is left for the next opening.
    if (automatic) setClearedNotice(true);
    setLiveText(automatic ? "Cleared what you typed. It looked like patient details." : "Cleared.");
  };
  const autoClear = useEffectEvent(() => clearPatientDetails(true));

  // Patient details left in the box are cleared from it, in place, after a short while.
  useEffect(() => {
    if (!patientNow) return;
    const timer = window.setTimeout(() => autoClear(), PATIENT_CLEAR_MS);
    return () => window.clearTimeout(timer);
  }, [patientNow, query]);

  // Leaving the tab or the app with patient details in the box clears them straight away.
  useEffect(() => {
    if (!patientNow) return;
    const onHidden = () => {
      if (document.visibilityState === "hidden") autoClear();
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => document.removeEventListener("visibilitychange", onHidden);
  }, [patientNow]);

  // Coming back online retries the areas that could not be reached.
  const router = useRouter();
  const retry = records.retry;
  useEffect(() => {
    const onOnline = () => {
      setOffline(false);
      if (records.areas.some((area) => area.status === "failed")) retry();
    };
    const onOffline = () => setOffline(true);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [records.areas, retry]);

  // The records, indexed once when they arrive rather than on every keystroke.
  // (The React Compiler memoises each of these on its inputs, so the index is built once per read of the
  // records, and a keystroke recomputes only what depends on the query.)
  const index = buildWorkSearchIndex({ items: records.items, entries: records.entries });
  // Patient details are not looked up at all: the notice is the whole answer.
  const hits = !searchable ? [] : searchWork(index, searchQuery, { currentArea, today, exact, now });
  const pageHits = !searchable || filter !== "all" ? [] : searchWorkPages(searchQuery, records.pages);
  const allItems = [...records.items, ...records.entries.map(({ item }) => item)];
  const correction = exact || hits.length === 0 ? null : workSearchCorrection(index, searchQuery);
  const nextUp = workComingUp(allItems, today, now, 3);
  const loadingAreas = records.areas.filter((area) => area.status === "loading");
  // Patient details are never searched, so nothing is "still searching" for them.
  const loading = loadingAreas.length > 0 && !patient;
  // A clinical question or patient details never get a work answer: the notice says what to do instead.
  const answer =
    !gate.answer || patient
      ? null
      : (answerWorkQuestion(searchQuery, { items: allItems, areas: records.areas, today, now, cpd: records.cpd }) ??
        // An entitlement question ("can I be rostered 16 hours") gets the agreement's own words.
        (agreementVisible ? agreementWorkAnswer(searchQuery) : null));
  const suggestions = answer || patient || !typed ? [] : suggestQuestions(query.trim());

  const close = (navigated: boolean) => {
    // Search history never keeps a query run over example records (signed out, or an area showing examples).
    noteClosing(query, epoch, navigated, Date.now(), !records.anySample && mayRecordRecentSearches());
    // Closed in place (Cancel, Esc, the backdrop): take back the history step the opening added.
    if (!navigated && takeHistoryStep()) window.history.back();
    onClose(navigated);
  };
  const closeFromBack = useEffectEvent(() => close(false));

  // The phone's back gesture or button closes the search rather than leaving the page under it: the
  // opening adds one history step (same address), and going back from it closes the search.
  useEffect(() => {
    const state: unknown = window.history.state;
    const marked = typeof state === "object" && state !== null && "workSearch" in state;
    if (!marked) window.history.pushState({ ...(state as object | null), workSearch: true }, "");
    holdHistoryStep();
    const onPopState = () => {
      if (takeHistoryStep()) closeFromBack();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Opening a result replaces that history step, so Back from the result returns to the page in one press.
  const replaceHistoryStep = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!holdsHistoryStep() || event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as Element).closest<HTMLAnchorElement>("a[href]");
    if (!anchor || anchor.target || anchor.hasAttribute("download")) return;
    const url = new URL(anchor.href);
    if (url.origin !== window.location.origin) return;
    event.preventDefault();
    takeHistoryStep();
    router.replace(`${url.pathname}${url.search}${url.hash}`);
  };
  const found = hits.length > 0 || pageHits.length > 0 || Boolean(answer && !answer.unavailable);
  const openResult = () => {
    if (!records.anySample && mayRecordRecentSearches()) rememberQuery(query, epoch);
    close(true);
  };
  const resetScroll = () => bodyRef.current?.scrollTo({ top: 0 });
  const runQuery = (value: string) => {
    setQuery(value);
    // A question tapped, or Recent, needs no pause.
    setSettledQuery(value);
    setExpanded(null);
    setClearedNotice(false);
    resetScroll();
    inputRef.current?.focus();
  };

  // Records an answer shows (in its card, or as the one record it is about) are not repeated below it,
  // and chip counts come from the same list the groups show, so a count always matches what is beneath it.
  const listed = listedResults(answer, hits, today, now);
  const counts = workSearchCounts(listed);
  const groups = groupResults(listed, filter, currentArea, answer);
  const visibleCount = groups.reduce((sum, group) => sum + group.hits.length, 0);

  // "Also tomorrow": the Teaching talks you give on the day a roster answer is about.
  const alsoThatDay =
    !answer || answer.area !== "roster" || !answer.date || answer.unavailable
      ? []
      : allItems
          .filter((item) => item.kind === "session" && item.facet === "presenting" && item.date === answer.date)
          .sort((a, b) => (a.startsAt ?? "").localeCompare(b.startsAt ?? ""));
  const alsoLabel = !answer?.date
    ? ""
    : answer.date === today
      ? "Also today"
      : answer.date === addDaysToDate(today, 1)
        ? "Also tomorrow"
        : `Also on ${formatPerthDay(answer.date)}`;

  // How long the screen takes, on this device only: opening to the first records, and a key to its results.
  const firstResultShown = useRef(false);
  const showsRecords = nextUp.length > 0 || hits.length > 0 || Boolean(answer);
  useEffect(() => {
    if (firstResultShown.current || !showsRecords) return;
    firstResultShown.current = true;
    measureOpenToFirstResult();
  }, [showsRecords]);
  // Runs after the render in which the results caught up with the box, so it times the whole key-to-screen path.
  useEffect(() => {
    if (searchQuery === query && query.trim()) measureKeystrokeToResults();
  }, [searchQuery, query]);

  // Spoken once the typing settles, not on every key.
  const announcement = !typed
    ? ""
    : patient
      ? "Looks like patient details. Not searched or saved."
      : clinical && visibleCount === 0 && !loading
        ? "Clinical question. Open in clinical search is available."
        : answer
          ? `${answer.label}: ${answer.headline}.`
          : loading && visibleCount === 0
            ? "Searching."
            : `${clinical ? "Clinical question. " : ""}${visibleCount} ${visibleCount === 1 ? "result" : "results"}${filter === "all" ? "" : ` in ${workSearchAreaLabels[filter]}`}${pageHits.length > 0 ? `, ${pageHits.length} ${pageHits.length === 1 ? "page" : "pages"}` : ""}.`;
  useEffect(() => {
    if (!announcement) return;
    const timer = window.setTimeout(() => setLiveText(announcement), 600);
    return () => window.clearTimeout(timer);
  }, [announcement]);

  // After "See all", focus moves to the first newly shown record, not to the page.
  useEffect(() => {
    if (!pendingFocus) return;
    rootRef.current
      ?.querySelectorAll<HTMLElement>(
        `[aria-labelledby="work-search-group-${pendingFocus.area}"] [data-work-search-result]`,
      )
      [pendingFocus.index]?.focus();
  }, [pendingFocus]);

  // The chip row fades its edge only while there is more to scroll to.
  const updateChipsMore = useCallback(() => {
    const row = chipsRef.current;
    setChipsMore(Boolean(row && row.scrollLeft + row.clientWidth < row.scrollWidth - 4));
  }, []);
  useEffect(updateChipsMore, [updateChipsMore, typed, counts]);

  const fallbackArea: WorkSearchArea = filter !== "all" ? filter : guessArea(trimmed, currentArea ?? "my-work");
  const firstWord = trimmed.split(/\s+/)[0] ?? "";
  const retryAll = () => {
    records.retry();
    inputRef.current?.focus();
  };

  const seeAll = (area: WorkSearchArea | "pages", count: number, label: string, shown: number) => (
    <LabelAction
      onClick={() => {
        setPendingFocus({ area, index: shown });
        setExpanded(area);
      }}
      ariaLabel={`See all ${count} ${label} results`}
    >
      See all {count}
    </LabelAction>
  );

  const pagesBlock =
    pageHits.length > 0
      ? (() => {
          const shown = expanded === "pages" ? pageHits : pageHits.slice(0, PAGES_PREVIEW);
          return (
            <section className="grid grid-cols-[minmax(0,1fr)] gap-2">
              <GroupHead
                id="work-search-group-pages"
                icon={LayoutGrid}
                label="Pages"
                count={`${pageHits.length} ${pageHits.length === 1 ? "page" : "pages"}`}
                action={
                  shown.length < pageHits.length ? seeAll("pages", pageHits.length, "page", shown.length) : undefined
                }
              />
              <ListCard labelledBy="work-search-group-pages" onKeyDown={(event) => moveFocus(event, inputRef)}>
                {shown.map(({ page }) => {
                  const Icon = workFrameIcons[page.icon];
                  return (
                    <li key={page.id} data-mode-identity={page.identity}>
                      <Link
                        href={page.href}
                        onClick={onPlainClick(openResult)}
                        data-work-search-result=""
                        className="work-row scroll-mb-6 scroll-mt-40"
                      >
                        <span aria-hidden="true" className="work-ic">
                          <Icon aria-hidden="true" strokeWidth={2} />
                        </span>
                        <span className="work-row__text">
                          <span className="work-row__title">{page.label}</span>
                          <span className="work-row__sub">{[page.area, page.sub].filter(Boolean).join(" · ")}</span>
                        </span>
                        <ChevronRight aria-hidden="true" className="work-row__chev" strokeWidth={2} />
                      </Link>
                    </li>
                  );
                })}
              </ListCard>
            </section>
          );
        })()
      : null;

  const resultGroups = groups.map((group) => {
    const groupOpen = filter !== "all" || expanded === group.area;
    const preview = groups.length === 1 ? SINGLE_GROUP_PREVIEW : GROUP_PREVIEW;
    const visible = groupOpen ? group.hits : group.hits.slice(0, preview);
    const headingId = `work-search-group-${group.area}`;
    const count = group.hits.length;
    return (
      <section key={group.area} className="grid grid-cols-[minmax(0,1fr)] gap-2">
        <GroupHead
          id={headingId}
          area={group.area}
          icon={AREA_ICONS[group.area]}
          label={workSearchAreaLabels[group.area]}
          count={`${count} ${count === 1 ? "match" : "matches"}`}
          action={
            visible.length < count
              ? seeAll(group.area, count, workSearchAreaLabels[group.area], visible.length)
              : undefined
          }
        />
        <ListCard labelledBy={headingId} onKeyDown={(event) => moveFocus(event, inputRef)}>
          {visible.map((hit) => (
            <ResultRow
              key={hit.item.id}
              item={hit.item}
              today={today}
              now={now}
              query={searchQuery}
              onOpen={openResult}
            />
          ))}
        </ListCard>
      </section>
    );
  });

  const askCards =
    suggestions.length > 0 ? (
      <div className="work-card">
        {suggestions.map((question) => (
          <AskCard key={question} question={question} query={query} onAsk={() => runQuery(question)} />
        ))}
      </div>
    ) : null;

  const neverSearched = <FootNote>Call notes, handover drafts and MHA timers are never searched.</FootNote>;

  const patientBlock = (
    <>
      <div
        role="note"
        data-testid="work-search-patient"
        className="flex items-start gap-3 rounded-2xl border border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] p-3"
      >
        <span aria-hidden="true" className="work-ic" data-tone="amber">
          <ShieldAlert aria-hidden="true" strokeWidth={2} />
        </span>
        <span className="min-w-0 flex-1">
          <b className="block text-sm-minus font-bold text-[color:var(--warning)]">Looks like patient details</b>
          <span className="mt-0.5 block text-xs leading-snug text-[color:var(--text)]">
            Not searched or saved. Please don&apos;t type patient details here.
          </span>
        </span>
      </div>
      <WorkButton
        variant="primary"
        size="wide"
        icon={X}
        onClick={() => {
          clearPatientDetails(false);
          inputRef.current?.focus();
        }}
        testId="work-search-clear-patient"
      >
        Clear
      </WorkButton>
      {clinicalHandOff ? (
        <Link
          href={clinicalHandOff}
          onClick={onPlainClick(() => close(true))}
          data-testid="work-search-patient-clinical"
          className="work-button"
          data-variant="secondary"
          data-size="wide"
        >
          <BookOpen aria-hidden="true" strokeWidth={2} />
          Ask clinical search without them
        </Link>
      ) : null}
      <SectionLabel id="work-search-never">Never searched</SectionLabel>
      <ul aria-labelledby="work-search-never" className="m-0 flex list-none flex-wrap gap-1.5 p-0">
        {(
          [
            [Phone, "Call notes"],
            [FileText, "Handover drafts"],
            [Clock, "MHA timers"],
          ] as const
        ).map(([Icon, label]) => (
          <li
            key={label}
            className="inline-flex h-7.5 items-center gap-1.5 rounded-full bg-[color:var(--surface-raised)] px-3 text-xs font-semibold text-[color:var(--text-muted)] ring-1 ring-inset ring-[color:var(--border-strong)]"
          >
            <Icon aria-hidden="true" className="size-3.5" strokeWidth={2.2} />
            {label}
          </li>
        ))}
      </ul>
    </>
  );

  const clinicalCard = (
    <div className="work-card grid justify-items-center gap-1.5 px-4 pb-2 pt-4 text-center">
      <span
        aria-hidden="true"
        className="mb-1 grid size-11.5 place-items-center rounded-full bg-[color:var(--mode-identity-soft)] text-[color:var(--mode-identity)]"
      >
        <BookOpen aria-hidden="true" className="size-5" strokeWidth={2} />
      </span>
      <b className="text-base font-bold tracking-tight text-[color:var(--text-heading)]">Clinical question?</b>
      <p className="m-0 mb-1 max-w-64 text-xs leading-normal text-[color:var(--text-muted)]">
        {visibleCount > 0
          ? "Clinical search answers from guidelines, with citations."
          : "Clinical search answers from guidelines, with citations. AI Search only looks at your own records."}
      </p>
      <Link
        href={clinicalSearchHref(trimmed)}
        onClick={onPlainClick(() => close(true))}
        data-work-search-primary=""
        className="work-button w-full"
        data-variant="primary"
        data-size="wide"
      >
        <Search aria-hidden="true" strokeWidth={2} />
        Open in clinical search
      </Link>
    </div>
  );

  const stillSearching =
    typed && loading && visibleCount > 0 ? (
      <>
        <p
          role="status"
          className="work-card m-0 flex items-center gap-2.5 px-3 py-3 text-xs font-semibold text-[color:var(--text-muted)]"
        >
          <span
            aria-hidden="true"
            className="size-4 shrink-0 rounded-full border-2 border-[color:color-mix(in_srgb,var(--mode-identity)_18%,transparent)] border-t-[color:var(--mode-identity)] motion-safe:animate-spin"
          />
          Still searching {[...new Set(loadingAreas.map((area) => workSearchAreaLabels[area.area]))].join(", ")}. Other
          areas are shown.
        </p>
        <SkeletonRows count={1} />
      </>
    ) : null;

  // Typed: only areas with matches get a chip, and the chips go when there is nothing to choose between.
  const tabAreas = typed
    ? workSearchAreas.filter((area) => (counts[area] ?? 0) > 0 || filter === area)
    : workSearchAreas;
  const showTabs = !patient && (!typed || tabAreas.length >= 2 || filter !== "all");
  const listedCount = listed.length;
  const newUser =
    !records.sample &&
    records.items.length === 0 &&
    records.entries.length === 0 &&
    records.areas.every((area) => area.status === "ready");
  const nothing = !answer && groups.length === 0 && pageHits.length === 0;

  return (
    <Sheet
      open={open}
      onClose={() => close(false)}
      ariaLabel="AI Search"
      initialFocusRef={inputRef}
      returnFocusRef={returnFocusRef}
      resolveReturnFocusTarget={returnFocusAfterClose}
      portal
      mobilePlacement="fullscreen"
      mobileSize="viewport"
      testId="work-search-sheet"
      contentClassName="bg-[color:var(--surface-wash)] lg:h-[min(46rem,calc(100dvh-8rem))] lg:max-h-[calc(100dvh-8rem)] lg:max-w-2xl lg:rounded-2xl lg:border-[color:var(--border)]"
      bodyClassName="p-0 sm:p-0"
      bodyRef={bodyRef}
      onBodyScroll={(event) => setScrolled(event.currentTarget.scrollTop > 2)}
    >
      <div
        ref={rootRef}
        onClickCapture={replaceHistoryStep}
        data-work-search-root=""
        data-work-frame="srch"
        data-mode-identity={accent}
        className="flex min-h-full flex-col text-[color:var(--text-heading)]"
      >
        <h2 className="sr-only">AI Search</h2>
        <div
          className={cn(
            "sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)] border-b bg-[color:var(--surface-wash)] px-3.5 pt-[max(0.25rem,var(--safe-area-top))] transition-colors motion-reduce:transition-none lg:pt-4 [@media(max-height:500px)]:static",
            scrolled ? "border-[color:var(--border)]" : "border-transparent",
          )}
        >
          {/* At large text sizes Cancel moves under the field rather than squeezing what was typed out of sight. */}
          <div className="flex flex-wrap items-center gap-x-2.5">
            <form
              role="search"
              aria-label="My work"
              onSubmit={(event) => {
                event.preventDefault();
                if (patient) return;
                if (found && !records.anySample && mayRecordRecentSearches()) rememberQuery(query, epoch);
                setRecents(keepRecents ? recentsFor(epoch) : []);
                // With a keyboard and mouse, Enter opens the top result; on a phone it puts the keyboard away.
                if (usesFinePointer()) {
                  rootRef.current
                    ?.querySelector<HTMLElement>("[data-work-search-primary], [data-work-search-result]")
                    ?.click();
                } else {
                  inputRef.current?.blur();
                }
              }}
              data-warn={patient ? "" : undefined}
              className={cn(fieldShell, "min-w-40", patient ? fieldRingWarn : fieldRing)}
            >
              <WorkSearchGlyph
                className={cn(
                  "size-icon-lg",
                  patient ? "text-[color:var(--warning)]" : "text-[color:var(--mode-identity)]",
                )}
              />
              <input
                ref={inputRef}
                type="search"
                value={query}
                onChange={(event) => {
                  markKeystroke();
                  setQuery(event.target.value);
                  setExpanded(null);
                  setClearedNotice(false);
                  resetScroll();
                }}
                onKeyDown={(event) => moveFocus(event, inputRef)}
                placeholder="Search shifts, leave, CPD"
                aria-label="Search shifts, leave, teaching, CPD, admin and on-call"
                aria-invalid={patient || undefined}
                aria-describedby={patient ? "work-search-patient-note" : undefined}
                enterKeyHint="search"
                inputMode="search"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                className={cn(
                  "search-shell-input min-w-0 flex-1 bg-transparent py-2.25 text-base font-semibold text-[color:var(--text-heading)] outline-none placeholder:font-normal placeholder:text-[color:var(--text-muted)] [&::-webkit-search-cancel-button]:hidden",
                  patient ? "caret-[color:var(--warning)]" : "caret-[color:var(--mode-identity)]",
                )}
              />
              <span id="work-search-patient-note" className="sr-only">
                {patient ? "Looks like patient details. Not searched or saved." : ""}
              </span>
              {typed ? (
                <button
                  type="button"
                  onClick={() => (patient ? clearPatientDetails(false) : runQuery(""))}
                  aria-label="Clear search"
                  className="-my-0.75 grid size-12 shrink-0 place-items-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-[color:var(--focus)]"
                >
                  <span className="grid size-5.5 place-items-center rounded-full bg-[color:color-mix(in_srgb,var(--text-heading)_14%,transparent)] text-[color:var(--surface-raised)]">
                    <X aria-hidden="true" className="size-3" strokeWidth={3} />
                  </span>
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => close(false)}
                aria-label="Close search"
                title="Close (Esc)"
                className="-my-0.75 hidden min-h-12 shrink-0 items-center px-2 lg:inline-flex"
              >
                <kbd className={keyCap}>esc</kbd>
              </button>
            </form>
            <button
              type="button"
              onClick={() => close(false)}
              className="ml-auto min-h-12 shrink-0 px-1 text-base font-semibold text-[color:var(--mode-identity)] lg:hidden"
            >
              Cancel
            </button>
          </div>
          {showTabs ? (
            <div
              ref={chipsRef}
              onScroll={updateChipsMore}
              className={cn(
                "-mx-3.5 flex gap-1.5 overflow-x-auto overscroll-x-contain px-3.5 pb-0.5 pt-1 [scrollbar-width:none]",
                chipsMore && "[mask-image:linear-gradient(90deg,black_calc(100%-28px),transparent)]",
              )}
              role="group"
              aria-label="Filter by area"
            >
              {(["all", ...tabAreas] as const).map((area) => {
                const selected = filter === area;
                const count = area === "all" ? listedCount : (counts[area] ?? 0);
                const label = area === "all" ? "All" : workSearchAreaLabels[area];
                return (
                  <button
                    key={area}
                    type="button"
                    aria-pressed={selected}
                    aria-label={typed ? `${label}, ${count} ${count === 1 ? "result" : "results"}` : label}
                    onClick={() => {
                      setFilter(area);
                      setExpanded(null);
                      resetScroll();
                    }}
                    data-mode-identity={area === "all" ? undefined : area}
                    className="group inline-flex min-h-12 shrink-0 items-center focus-visible:outline-none"
                  >
                    {/* A 28px pill inside the 48px tap. */}
                    <span
                      className={cn(
                        "inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-semibold group-focus-visible:outline group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-[color:var(--focus)] forced-colors:outline-1 forced-colors:outline-[ButtonBorder]",
                        selected
                          ? "bg-[color:var(--text-heading)] text-[color:var(--surface-raised)] forced-colors:outline-[Highlight]"
                          : "bg-[color:color-mix(in_srgb,var(--surface-raised)_85%,transparent)] text-[color:var(--text-muted)] ring-1 ring-inset ring-[color:var(--border-strong)]",
                      )}
                    >
                      {area === "all" ? null : (
                        <span
                          aria-hidden="true"
                          className="size-1.75 shrink-0 rounded-full bg-[color:var(--mode-identity)]"
                        />
                      )}
                      {label}
                      {typed && count > 0 ? <span className="text-2xs font-bold tabular-nums">{count}</span> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="h-2" />
          )}
        </div>

        <div
          onTouchMove={() => {
            // Scrolling the results on a phone puts the keyboard away, as iOS search screens do.
            if (document.activeElement === inputRef.current && !usesFinePointer()) inputRef.current?.blur();
          }}
          className="flex min-w-0 flex-1 flex-col gap-2.5 px-3 pb-[calc(1.5rem+var(--keyboard-height,0px)+var(--safe-area-bottom))] pt-2.5 lg:pb-0"
        >
          <p className="sr-only" role="status" aria-live="polite">
            {liveText}
          </p>
          {!typed && clearedNotice ? (
            <Notice
              icon={ShieldAlert}
              tone="amber"
              title="Cleared what you typed"
              body="It looked like patient details, so it was removed and not saved."
              testId="work-search-cleared"
            />
          ) : null}
          {patient ? null : (
            <AreaNotices areas={records.areas} missing={answer?.missing} offline={offline} onRetry={retryAll} />
          )}
          {typed && correction && !patient ? (
            <p className="m-0 px-1 text-xs leading-normal text-[color:var(--text-muted)]">
              Showing matches for <b className="font-bold text-[color:var(--text-heading)]">{correction.read}</b>.
              <br />
              <button
                type="button"
                onClick={() => {
                  setExactFor(trimmed);
                  // The line goes away once the search is exact, so the box keeps the focus.
                  inputRef.current?.focus();
                }}
                className="-my-3 min-h-12 font-bold text-[color:var(--mode-identity)] underline decoration-[color:color-mix(in_srgb,var(--mode-identity)_35%,transparent)] underline-offset-[3px]"
              >
                Search for &ldquo;{correction.typed}&rdquo; exactly
              </button>
            </p>
          ) : null}

          {!typed ? (
            <>
              {recents.length > 0 ? (
                <section className="grid gap-2">
                  <SectionLabel
                    id="work-search-recent"
                    action={
                      <LabelAction
                        onClick={() => {
                          clearRecents(epoch);
                          setRecents([]);
                          setLiveText("Recent searches cleared.");
                          inputRef.current?.focus();
                        }}
                        ariaLabel="Clear recent searches"
                      >
                        Clear
                      </LabelAction>
                    }
                  >
                    Recent
                  </SectionLabel>
                  <ul aria-labelledby="work-search-recent" className="work-card work-rows">
                    {recents.map((value) => (
                      <li key={value} className="flex items-center">
                        <button type="button" onClick={() => runQuery(value)} className="work-row min-w-0 flex-1">
                          <span aria-hidden="true" className="work-ic" data-tone="neutral">
                            <History aria-hidden="true" strokeWidth={2} />
                          </span>
                          <span className="work-row__text">
                            <span className="work-row__title truncate font-semibold">{value}</span>
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            forgetRecent(value, epoch);
                            setRecents(recentsFor(epoch));
                            inputRef.current?.focus();
                          }}
                          aria-label={`Remove ${value} from recent searches`}
                          className="grid size-12 shrink-0 place-items-center text-[color:var(--text-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-[color:var(--focus)]"
                        >
                          <X aria-hidden="true" className="size-4" strokeWidth={2} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {newUser ? (
                <div className="work-card">
                  <WorkEmpty
                    icon={Search}
                    title="Nothing to search yet"
                    body="Add your roster, sessions or renewals and they will show up here. Forms, guides and contacts work straight away."
                    action={
                      <Link
                        href="/roster"
                        onClick={onPlainClick(() => close(true))}
                        className="work-button"
                        data-variant="primary"
                      >
                        Add your roster
                      </Link>
                    }
                  />
                </div>
              ) : nextUp.length > 0 || loading ? (
                <section className="grid gap-2">
                  <SectionLabel id="work-search-next">Next up</SectionLabel>
                  {nextUp.length > 0 ? (
                    <ListCard labelledBy="work-search-next" onKeyDown={(event) => moveFocus(event, inputRef)}>
                      {nextUp.map((item) => (
                        <ResultRow key={item.id} item={item} today={today} now={now} onOpen={openResult} />
                      ))}
                    </ListCard>
                  ) : (
                    <SkeletonRows count={3} />
                  )}
                </section>
              ) : null}
              <section className="grid gap-2">
                <SectionLabel id="work-search-try">Try asking</SectionLabel>
                <ul aria-labelledby="work-search-try" className="work-card work-rows">
                  {TRY_ASKING.map((value) => (
                    <ActionRow
                      key={value}
                      icon={<Sparkles aria-hidden="true" strokeWidth={2} />}
                      onClick={() => runQuery(value)}
                      weight="semibold"
                    >
                      {value}
                    </ActionRow>
                  ))}
                </ul>
              </section>
              {neverSearched}
            </>
          ) : patient ? (
            patientBlock
          ) : (
            <>
              {clinical ? clinicalCard : null}
              {askCards}
              {answer ? (
                <div
                  className={cn(
                    "grid grid-cols-[minmax(0,1fr)] gap-2.5",
                    groups.length > 0 && "lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-start",
                  )}
                >
                  <div className="grid grid-cols-[minmax(0,1fr)] gap-2.5">
                    <AnswerCard
                      answer={answer}
                      today={today}
                      now={now}
                      onOpen={openResult}
                      onListKeyDown={(event) => moveFocus(event, inputRef)}
                      onRetry={retryAll}
                    />
                    {alsoThatDay.length > 0 ? (
                      <section className="grid gap-2">
                        <SectionLabel id="work-search-also">{alsoLabel}</SectionLabel>
                        <ListCard labelledBy="work-search-also" onKeyDown={(event) => moveFocus(event, inputRef)}>
                          {alsoThatDay.map((item) => (
                            <ResultRow key={item.id} item={item} today={today} now={now} onOpen={openResult} />
                          ))}
                        </ListCard>
                      </section>
                    ) : null}
                  </div>
                  {groups.length > 0 || pageHits.length > 0 ? (
                    <div className="grid grid-cols-[minmax(0,1fr)] gap-2.5">
                      {pagesBlock}
                      {resultGroups}
                      {stillSearching}
                    </div>
                  ) : null}
                </div>
              ) : (
                <>
                  {clinical && groups.length > 0 ? <SectionLabel>Your own records</SectionLabel> : null}
                  {pagesBlock}
                  {resultGroups}
                  {stillSearching}
                </>
              )}
              {nothing && loading ? (
                <>
                  <p role="status" className="m-0 px-1 pt-1 text-xs font-semibold text-[color:var(--text-muted)]">
                    Searching your work…
                  </p>
                  <SkeletonRows count={2} />
                </>
              ) : nothing && clinical ? (
                <p className="m-0 px-4 text-center text-2xs leading-snug text-[color:var(--text-muted)]">
                  Nothing in your own records matched.
                </p>
              ) : nothing ? (
                <>
                  <div className="work-card grid justify-items-center gap-1.5 px-4 pb-4 pt-4.5 text-center">
                    <span
                      aria-hidden="true"
                      className="mb-1 grid size-11.5 place-items-center rounded-full bg-[color:var(--surface-wash)] text-[color:var(--text-muted)]"
                    >
                      <Search aria-hidden="true" className="size-5" strokeWidth={2} />
                    </span>
                    <b className="break-words text-base font-bold tracking-tight text-[color:var(--text-heading)]">
                      Nothing for &ldquo;{trimmed}&rdquo;
                    </b>
                    <p className="m-0 max-w-64 text-xs leading-normal text-[color:var(--text-muted)]">
                      {workSearchNothingFound(records.areas, filter)}
                    </p>
                  </div>
                  <section className="grid gap-2">
                    <SectionLabel id="work-search-instead">Try instead</SectionLabel>
                    <ul aria-labelledby="work-search-instead" className="work-card work-rows">
                      {filter !== "all" && listedCount > 0 ? (
                        <ActionRow
                          icon={<Search aria-hidden="true" strokeWidth={2} />}
                          tone="neutral"
                          onClick={() => setFilter("all")}
                        >
                          Search all areas ({listedCount})
                        </ActionRow>
                      ) : null}
                      {firstWord && firstWord !== trimmed ? (
                        <ActionRow
                          icon={<Search aria-hidden="true" strokeWidth={2} />}
                          tone="neutral"
                          onClick={() => runQuery(firstWord)}
                        >
                          Search for &ldquo;{firstWord}&rdquo;
                        </ActionRow>
                      ) : null}
                      <ActionRow
                        icon={<BookOpen aria-hidden="true" strokeWidth={2} />}
                        tone="neutral"
                        href={documentsSearchHref({ query: trimmed })}
                        onNavigate={() => close(true)}
                        sub={<>For &ldquo;{trimmed}&rdquo;</>}
                      >
                        Search clinical documents
                      </ActionRow>
                      <ActionRow
                        icon={<AreaTileIcon area={fallbackArea} />}
                        area={fallbackArea}
                        href={appModeHomeHref(fallbackArea)}
                        onNavigate={() => close(true)}
                        sub={AREA_HOLDS[fallbackArea]}
                      >
                        Open {workSearchAreaLabels[fallbackArea]}
                      </ActionRow>
                    </ul>
                  </section>
                </>
              ) : null}
              {neverSearched}
            </>
          )}

          <div className="sticky bottom-0 -mx-3 mt-auto hidden items-center gap-4 border-t border-[color:var(--border)] bg-[color:var(--surface-wash)] px-4 py-3 text-xs text-[color:var(--text-muted)] [@media(hover:hover)_and_(pointer:fine)_and_(min-width:48rem)]:flex">
            <span className="flex items-center gap-1.5">
              <kbd className={keyCap}>↑</kbd>
              <kbd className={keyCap}>↓</kbd>
              move
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className={keyCap}>↵</kbd>
              open
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className={keyCap}>esc</kbd>
              close
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className={keyCap}>?</kbd>
              keys
            </span>
            <span className="ml-auto flex items-center gap-1.5">
              <ShieldCheck aria-hidden="true" className="size-3.5 text-[color:var(--success)]" strokeWidth={2} />
              Your own records only
            </span>
          </div>
        </div>
      </div>
    </Sheet>
  );
}

const keyCap =
  "rounded border border-[color:var(--border-strong)] bg-[color:var(--surface-raised)] px-1.5 font-sans text-2xs leading-5 text-[color:var(--text-muted)]";

/** Placeholder rows while an area is still being read: a tile and two bars, shimmering only if motion is allowed. */
function SkeletonRows({ count }: { count: number }) {
  return (
    <ul aria-hidden="true" className="work-card work-rows">
      {Array.from({ length: count }, (_, index) => (
        <li key={index} className="work-row">
          <span className="size-8.5 shrink-0 rounded-lg bg-[color:var(--surface-wash)] motion-safe:animate-pulse" />
          <span className="grid flex-1 gap-1.5">
            <span className="h-2.25 rounded-full bg-[color:var(--surface-wash)] motion-safe:animate-pulse" />
            <span className="h-1.75 w-3/5 rounded-full bg-[color:var(--surface-wash)] motion-safe:animate-pulse" />
          </span>
        </li>
      ))}
    </ul>
  );
}

function AreaTileIcon({ area }: { area: WorkSearchArea }) {
  const Icon = AREA_ICONS[area];
  return <Icon aria-hidden="true" strokeWidth={2} />;
}
