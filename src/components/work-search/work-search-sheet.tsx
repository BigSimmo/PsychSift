"use client";

import {
  ChevronRight,
  Clock,
  CloudOff,
  CornerDownLeft,
  FileText,
  Info,
  Loader2,
  Lock,
  Search,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

import { useWorkSearchRecords } from "@/components/work-search/use-work-search-records";
import { AnswerCard } from "@/components/work-search/work-search-answer-card";
import {
  ActionRow,
  AREA_ICONS,
  cardSurface,
  focusRing,
  Kicker,
  ListCard,
  moveFocus,
  onPlainClick,
  ResultRow,
} from "@/components/work-search/work-search-parts";
import { WorkSearchGlyph } from "@/components/work-search/work-search-glyph";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/components/ui-primitives";
import { appModeHomeHref } from "@/lib/app-modes";
import { documentsSearchHref } from "@/lib/document-flow-routes";
import { perthDateOf } from "@/lib/perth-time";
import { answerWorkQuestion } from "@/lib/work-search/answers";
import { workSearchAreaLabels, workSearchAreas, type WorkAreaRead, type WorkSearchArea } from "@/lib/work-search/model";
import {
  collapseSeries,
  searchWork,
  workComingUp,
  workSearchCorrection,
  workSearchCounts,
  type WorkSearchHit,
} from "@/lib/work-search/search";
import { clinicalSearchHref, looksClinical, looksLikePatientDetails } from "@/lib/work-search/signals";

/** The built-in questions, offered on the empty screen and as "Ask" suggestions while typing. */
const QUESTIONS = [
  "When am I next on nights?",
  "What's due this month?",
  "How many CPD hours do I still need?",
  "When is my next shift?",
  "Am I working tomorrow?",
  "What am I doing this weekend?",
  "When is my next leave?",
  "Am I presenting?",
  "How many nights this month?",
  "Free days this month",
] as const;

const TRY_ASKING = QUESTIONS.slice(0, 3);

function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Built-in questions every typed word starts a word of: "next nig" → "When am I next on nights?". */
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

/**
 * Recent searches and the last unfinished search, kept in this tab's memory only:
 * never in browser storage, because a shared ward computer cannot tell a typed
 * patient name from a word. Both belong to one account (auth epoch) and are
 * dropped when another signs in. Anything that looks like patient details, or
 * that found nothing, is never kept.
 */
let recentMemory: { epoch: number; list: string[] } = { epoch: -1, list: [] };
/** Set as the search closes: true when a result was opened, so focus is left to the new page. */
let navigatedAway = false;
let lastSearch: { epoch: number; query: string; at: number } | null = null;
const RECENT_LIMIT = 5;
const RESUME_FOR_MS = 5 * 60 * 1000;

function recentsFor(epoch: number): string[] {
  return recentMemory.epoch === epoch ? recentMemory.list : [];
}

function rememberQuery(query: string, epoch: number) {
  const trimmed = query.trim();
  if (trimmed.length < 2 || looksLikePatientDetails(trimmed)) return;
  const list = recentsFor(epoch);
  recentMemory = {
    epoch,
    list: [trimmed, ...list.filter((value) => value.toLowerCase() !== trimmed.toLowerCase())].slice(0, RECENT_LIMIT),
  };
}

/** Which area a no-match query was most likely about, for "Open …" in Try instead. */
function guessArea(query: string, fallback: WorkSearchArea): WorkSearchArea {
  const text = query.toLowerCase();
  if (/\b(rost\w*|shifts?|nights?|leave|swap|on ?call shift)\b/.test(text)) return "roster";
  if (/\b(teach\w*|sessions?|talks?|journal|tutorial|lecture)\b/.test(text)) return "teaching";
  if (/\b(cpd|cme|hours|reflection|college)\b/.test(text)) return "cme";
  if (/\b(forms?|polic\w*|renew\w*|expir\w*|pay|claims?|admin)\b/.test(text)) return "my-work";
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

function AreaNotices({
  areas,
  missing,
  onRetry,
}: {
  areas: readonly WorkAreaRead[];
  /** What the answer below may lack because of it: "Your talks". */
  missing?: string;
  onRetry: () => void;
}) {
  const failed = areas.filter((area) => area.status === "failed").map((area) => workSearchAreaLabels[area.area]);
  // Admin and On Call share one read, so name it once.
  const names = [...new Set(failed)];
  if (names.length === 0) return null;
  return (
    <div role="status" className={cn(cardSurface, "flex items-start gap-3 p-4")}>
      <CloudOff
        aria-hidden="true"
        className="mt-0.5 size-icon-md shrink-0 text-[color:var(--text-muted)]"
        strokeWidth={1.6}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-[color:var(--text-heading)]">Couldn&apos;t check {names.join(", ")}</p>
        <p className="mt-0.5 text-sm text-[color:var(--text-muted)]">
          {missing
            ? `${missing} may be missing from this answer.`
            : `${names.length === 1 ? "It wasn't" : "They weren't"} searched, so something may be missing.`}
        </p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        aria-label={`Retry loading ${names.join(" and ")}`}
        className={cn(
          "inline-flex min-h-12 shrink-0 items-center self-center rounded-md border border-[color:var(--border-strong)] px-3.5 text-sm font-semibold text-[color:var(--text-heading)]",
          focusRing,
        )}
      >
        Retry
      </button>
    </div>
  );
}

function FootNote({ children, icon: Icon = Lock }: { children: ReactNode; icon?: LucideIcon }) {
  return (
    <p className="flex items-start gap-2 pb-2 pt-1 text-xs text-[color:var(--text-muted)]">
      <Icon aria-hidden="true" className="mt-0.5 size-icon-xs shrink-0" strokeWidth={1.6} />
      <span>{children}</span>
    </p>
  );
}

/** A built-in question offered while typing: tap (or Enter) to ask it. */
function AskCard({ question, onAsk }: { question: string; onAsk: () => void }) {
  return (
    <button
      type="button"
      onClick={onAsk}
      className={cn(
        "flex min-h-12 w-full items-center gap-3 py-2.5 text-left transition-colors motion-reduce:transition-none [@media(hover:hover)]:hover:bg-[color:var(--surface-subtle)]",
        focusRing,
      )}
    >
      <span className="grid w-8 shrink-0 justify-items-center text-[color:var(--text-muted)]">
        <Sparkles aria-hidden="true" className="size-icon-md" strokeWidth={1.6} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-2xs font-semibold text-[color:var(--text-muted)]">Ask</span>
        <span className="block text-sm font-semibold leading-snug text-[color:var(--text-heading)]">{question}</span>
      </span>
      <span
        aria-hidden="true"
        className="grid size-6 shrink-0 place-items-center rounded-sm border border-[color:var(--border-strong)] text-[color:var(--text-muted)]"
      >
        <CornerDownLeft aria-hidden="true" className="size-icon-xs" strokeWidth={1.6} />
      </span>
    </button>
  );
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
  return navigatedAway ? document.getElementById("main-content") : null;
}

function usesFinePointer(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(hover: hover) and (pointer: fine)").matches === true;
}

export function WorkSearchSheet({ open, onClose, currentArea, returnFocusRef }: WorkSearchSheetProps) {
  const [now, setNow] = useState(() => Date.now());
  const today = perthDateOf(now);
  const records = useWorkSearchRecords(now);
  const epoch = records.epoch;
  // Reopened within a few minutes, the last search comes back (selected, so typing replaces it).
  const [query, setQuery] = useState(() =>
    lastSearch && lastSearch.epoch === epoch && Date.now() - lastSearch.at < RESUME_FOR_MS ? lastSearch.query : "",
  );
  const searchQuery = useDeferredValue(query);
  const [filter, setFilter] = useState<WorkSearchArea | "all">("all");
  const [expanded, setExpanded] = useState<WorkSearchArea | null>(null);
  const [recents, setRecents] = useState(() => recentsFor(epoch));
  const [scrolled, setScrolled] = useState(false);
  const [chipsMore, setChipsMore] = useState(false);
  /** The query "Search for … exactly" was tapped for: one-letter-out matching is off until it changes. */
  const [exactFor, setExactFor] = useState<string | null>(null);
  const [liveText, setLiveText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const chipsRef = useRef<HTMLDivElement>(null);
  const [pendingFocus, setPendingFocus] = useState<{ area: WorkSearchArea; index: number } | null>(null);

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

  const trimmed = searchQuery.trim();
  const typed = query.trim().length > 0;
  const patient = trimmed.length > 0 && looksLikePatientDetails(trimmed);
  const clinical = trimmed.length > 0 && !patient && looksClinical(trimmed);
  const exact = exactFor !== null && exactFor === trimmed;
  const hits = useMemo(
    () =>
      // Patient details and clinical questions are not looked up at all: the notice is the whole answer.
      patient || clinical
        ? []
        : collapseSeries(
            searchWork({ items: records.items, entries: records.entries }, searchQuery, { currentArea, today, exact }),
          ),
    [patient, clinical, records.items, records.entries, searchQuery, currentArea, today, exact],
  );
  const allItems = useMemo(
    () => [...records.items, ...records.entries.map(({ item }) => item)],
    [records.items, records.entries],
  );
  const correction = useMemo(
    () => (exact || hits.length === 0 ? null : workSearchCorrection(allItems, searchQuery)),
    [exact, hits.length, allItems, searchQuery],
  );
  const nextUp = useMemo(() => workComingUp(allItems, today, now, 3), [allItems, today, now]);
  const loadingAreas = records.areas.filter((area) => area.status === "loading");
  const loading = loadingAreas.length > 0;
  // A clinical question or patient details never get a work answer: the notice says what to do instead.
  const answer = useMemo(
    () =>
      patient || clinical
        ? null
        : answerWorkQuestion(searchQuery, { items: allItems, areas: records.areas, today, now, cpd: records.cpd }),
    [patient, clinical, searchQuery, allItems, records.areas, records.cpd, today, now],
  );
  const suggestions = useMemo(() => (answer || patient ? [] : suggestQuestions(trimmed)), [answer, patient, trimmed]);

  const close = useCallback(
    (navigated: boolean) => {
      const current = query.trim();
      lastSearch =
        !navigated && current && !looksLikePatientDetails(current) ? { epoch, query: current, at: Date.now() } : null;
      navigatedAway = navigated;
      onClose(navigated);
    },
    [epoch, onClose, query],
  );
  const found = hits.length > 0 || Boolean(answer && !answer.unavailable);
  const openResult = () => {
    rememberQuery(query, epoch);
    close(true);
  };
  const resetScroll = () => bodyRef.current?.scrollTo({ top: 0 });
  const runQuery = (value: string) => {
    setQuery(value);
    setExpanded(null);
    resetScroll();
    inputRef.current?.focus();
  };

  // Records an answer shows (in its card, or as the one record it is about) are not repeated below it.
  const answerItems = useMemo(() => answer?.items ?? [], [answer]);
  const extraFromAnswer = answer && answer.area !== "all" && answerItems.length > 1;
  const hiddenIds = useMemo(
    () => new Set(answer && !extraFromAnswer ? answerItems.map((item) => item.id) : []),
    [answer, extraFromAnswer, answerItems],
  );
  // Every record the lists can show, once, without the ones the answer card already shows.
  const listed = useMemo(() => {
    const extra: WorkSearchHit[] = extraFromAnswer ? answerItems.map((item) => ({ item, rank: 0 as const })) : [];
    const seen = new Set<string>();
    return [...extra, ...hits].filter((hit) => {
      if (seen.has(hit.item.id) || hiddenIds.has(hit.item.id)) return false;
      seen.add(hit.item.id);
      return true;
    });
  }, [extraFromAnswer, answerItems, hits, hiddenIds]);
  // Tab counts come from the same list the groups show, so a count always matches what is beneath it.
  const counts = useMemo(() => workSearchCounts(listed), [listed]);
  const groups = useMemo(() => {
    const pool = listed.filter((hit) => filter === "all" || hit.item.area === filter);
    const order = currentArea
      ? [currentArea, ...workSearchAreas.filter((area) => area !== currentArea)]
      : workSearchAreas;
    const leading = answer && answer.area !== "all" ? [answer.area] : [];
    const areas = [...new Set([...leading, ...order])];
    return areas
      .map((area) => ({ area, hits: pool.filter((hit) => hit.item.area === area) }))
      .filter((group) => group.hits.length > 0);
  }, [answer, listed, filter, currentArea]);
  const visibleCount = groups.reduce((sum, group) => sum + group.hits.length, 0);

  // Spoken once the typing settles, not on every key.
  const announcement = !typed
    ? ""
    : answer
      ? `${answer.label}: ${answer.headline}.`
      : loading && visibleCount === 0
        ? "Searching."
        : `${visibleCount} ${visibleCount === 1 ? "result" : "results"}${filter === "all" ? "" : ` in ${workSearchAreaLabels[filter]}`}.`;
  useEffect(() => {
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

  const resultGroups = groups.map((group) => {
    const open = filter !== "all" || expanded === group.area;
    const preview = groups.length === 1 ? SINGLE_GROUP_PREVIEW : GROUP_PREVIEW;
    const visible = open ? group.hits : group.hits.slice(0, preview);
    const headingId = `work-search-group-${group.area}`;
    return (
      <section key={group.area} className="grid grid-cols-[minmax(0,1fr)] gap-1">
        <Kicker
          id={headingId}
          area={group.area}
          action={
            visible.length < group.hits.length ? (
              <button
                type="button"
                onClick={() => {
                  setPendingFocus({ area: group.area, index: visible.length });
                  setExpanded(group.area);
                }}
                aria-label={`See all ${group.hits.length} ${workSearchAreaLabels[group.area]} results`}
                className={cn(
                  "-my-3 min-h-12 px-1 text-sm font-semibold text-[color:var(--text-muted)] [@media(hover:hover)]:hover:text-[color:var(--text-heading)]",
                  focusRing,
                )}
              >
                See all
              </button>
            ) : null
          }
        >
          {`${workSearchAreaLabels[group.area]} · ${group.hits.length} ${group.hits.length === 1 ? "match" : "matches"}`}
        </Kicker>
        <ListCard labelledBy={headingId} onKeyDown={(event) => moveFocus(event, inputRef)}>
          {visible.map((hit) => (
            <ResultRow key={hit.item.id} item={hit.item} today={today} query={searchQuery} onOpen={openResult} />
          ))}
        </ListCard>
      </section>
    );
  });

  const askCards =
    suggestions.length > 0 ? (
      <div className="grid divide-y divide-[color:var(--border)]">
        {suggestions.map((question) => (
          <AskCard key={question} question={question} onAsk={() => runQuery(question)} />
        ))}
      </div>
    ) : null;

  const neverSearched = <FootNote>Call notes, handover drafts and MHA timers are never searched.</FootNote>;

  const notices = (
    <>
      {patient ? (
        <div
          role="note"
          className="flex items-center gap-3 rounded-lg border border-[color:var(--warning-border)] bg-[color:var(--surface-raised)] py-2 pl-4 pr-2"
        >
          <Lock
            aria-hidden="true"
            className="size-icon-md shrink-0 self-start text-[color:var(--warning)] mt-2.5"
            strokeWidth={1.6}
          />
          <p className="min-w-0 flex-1 py-1.5 text-sm text-[color:var(--text-muted)]">
            <b className="block font-semibold text-[color:var(--text-heading)]">Looks like patient details</b>
            Not saved to Recent. Please don&apos;t type patient details here.
          </p>
          <button
            type="button"
            onClick={() => runQuery("")}
            className={cn(
              "inline-flex min-h-12 shrink-0 items-center rounded-md bg-[color:var(--command)] px-4 text-sm font-semibold text-[color:var(--command-contrast)]",
              focusRing,
            )}
          >
            Clear
          </button>
        </div>
      ) : null}
      {clinical ? (
        <div className={cn(cardSurface, "grid gap-3 p-4")}>
          <div className="flex items-start gap-3">
            <Search
              aria-hidden="true"
              className="mt-0.5 size-icon-md shrink-0 text-[color:var(--clinical-accent)]"
              strokeWidth={1.6}
            />
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold leading-snug text-[color:var(--text-heading)]">
                Clinical question?
              </p>
              <p className="mt-0.5 text-sm text-[color:var(--text-muted)]">
                Work search only looks at your staff records. Clinical search answers from guidelines, with citations.
              </p>
            </div>
          </div>
          <Link
            href={clinicalSearchHref(trimmed)}
            onClick={onPlainClick(() => close(true))}
            className={cn(
              "inline-flex min-h-12 items-center justify-self-start gap-1.5 rounded-md border border-[color:var(--clinical-accent-border)] px-4 text-sm font-semibold text-[color:var(--clinical-accent)]",
              focusRing,
            )}
          >
            Open in clinical search
            <ChevronRight aria-hidden="true" className="size-icon-sm" strokeWidth={1.6} />
          </Link>
        </div>
      ) : null}
    </>
  );

  const stillSearching =
    typed && loading && visibleCount > 0 ? (
      <p
        role="status"
        className={cn(cardSurface, "flex items-center gap-2.5 px-4 py-3 text-sm text-[color:var(--text-muted)]")}
      >
        <Loader2 aria-hidden="true" className="size-icon-md shrink-0 motion-safe:animate-spin" strokeWidth={1.6} />
        Still searching {[...new Set(loadingAreas.map((area) => workSearchAreaLabels[area.area]))].join(", ")}. Other
        areas are shown.
      </p>
    ) : null;

  // Typed: only areas with matches get a tab, and the tabs go when there is nothing to choose between.
  const tabAreas = typed
    ? workSearchAreas.filter((area) => (counts[area] ?? 0) > 0 || filter === area)
    : workSearchAreas;
  const showTabs = !typed || tabAreas.length >= 2 || filter !== "all";
  const listedCount = listed.length;

  return (
    <Sheet
      open={open}
      onClose={() => close(false)}
      ariaLabel="Search my work"
      initialFocusRef={inputRef}
      returnFocusRef={returnFocusRef}
      resolveReturnFocusTarget={returnFocusAfterClose}
      portal
      mobilePlacement="fullscreen"
      mobileSize="viewport"
      testId="work-search-sheet"
      contentClassName="bg-[color:var(--surface-raised)] lg:h-[min(46rem,calc(100dvh-8rem))] lg:max-h-[calc(100dvh-8rem)] lg:max-w-2xl lg:rounded-2xl lg:border-[color:var(--border)]"
      bodyClassName="p-0 sm:p-0"
      bodyRef={bodyRef}
      onBodyScroll={(event) => setScrolled(event.currentTarget.scrollTop > 2)}
    >
      <div ref={rootRef} data-work-search-root="" className="flex min-h-full flex-col">
        <h2 className="sr-only">Search my work</h2>
        <div
          className={cn(
            "sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)] gap-1 border-b bg-[color:var(--surface-raised)] px-4 pt-[max(0.75rem,var(--safe-area-top))] transition-colors motion-reduce:transition-none lg:pt-4 [@media(max-height:500px)]:static",
            scrolled ? "border-[color:var(--border)]" : "border-transparent",
          )}
        >
          <div className="flex items-center gap-2">
            <form
              role="search"
              aria-label="My work"
              onSubmit={(event) => {
                event.preventDefault();
                if (found) rememberQuery(query, epoch);
                setRecents(recentsFor(epoch));
                // With a keyboard and mouse, Enter opens the top result; on a phone it puts the keyboard away.
                if (usesFinePointer()) {
                  rootRef.current
                    ?.querySelector<HTMLElement>("[data-work-search-primary], [data-work-search-result]")
                    ?.click();
                } else {
                  inputRef.current?.blur();
                }
              }}
              className="search-shell flex min-h-12 min-w-0 flex-1 items-center gap-2.5 rounded-lg bg-[color:var(--surface-inset)] pl-3.5 pr-1 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[color:var(--focus)]"
            >
              <WorkSearchGlyph className="size-icon-md text-[color:var(--text-heading)]" />
              <input
                ref={inputRef}
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setExpanded(null);
                  resetScroll();
                }}
                onKeyDown={(event) => moveFocus(event, inputRef)}
                placeholder="Search shifts, leave, CPD…"
                aria-label="Search shifts, leave, teaching, CPD, admin and on-call"
                enterKeyHint="search"
                inputMode="search"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                className="search-shell-input min-w-0 flex-1 bg-transparent py-3 text-base text-[color:var(--text-heading)] outline-none placeholder:text-[color:var(--text-muted)] [&::-webkit-search-cancel-button]:hidden"
              />
              {typed ? (
                <button
                  type="button"
                  onClick={() => runQuery("")}
                  aria-label="Clear search"
                  className={cn(
                    "grid size-tap shrink-0 place-items-center rounded-full text-[color:var(--text-muted)]",
                    focusRing,
                  )}
                >
                  <X aria-hidden="true" className="size-icon-sm" strokeWidth={1.6} />
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => close(false)}
                aria-label="Close search"
                title="Close (Esc)"
                className={cn("hidden min-h-12 shrink-0 items-center px-2 lg:inline-flex", focusRing)}
              >
                <kbd className="rounded-md border border-[color:var(--border-strong)] px-1.5 py-0.5 font-sans text-2xs text-[color:var(--text-muted)]">
                  esc
                </kbd>
              </button>
            </form>
            <button
              type="button"
              onClick={() => close(false)}
              className={cn("min-h-12 shrink-0 px-1 text-base text-[color:var(--text-heading)] lg:hidden", focusRing)}
            >
              Cancel
            </button>
          </div>
          {showTabs ? (
            <div
              ref={chipsRef}
              onScroll={updateChipsMore}
              className={cn(
                "-mx-4 flex gap-5 overflow-x-auto overscroll-x-contain px-4",
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
                    className={cn(
                      "relative inline-flex min-h-12 shrink-0 items-center gap-1 whitespace-nowrap text-sm font-semibold focus-visible:outline-offset-[-2px] forced-colors:border-b-2 forced-colors:border-transparent",
                      selected && "forced-colors:border-[Highlight]",
                      selected ? "text-[color:var(--text-heading)]" : "text-[color:var(--text-muted)]",
                      focusRing,
                    )}
                  >
                    {label}
                    {typed && count > 0 ? (
                      <span
                        className={cn(
                          "font-medium tabular-nums",
                          selected && area !== "all"
                            ? "text-[color:var(--mode-identity)]"
                            : "text-[color:var(--text-muted)]",
                        )}
                      >
                        {count}
                      </span>
                    ) : null}
                    {selected ? (
                      <span
                        aria-hidden="true"
                        className={cn(
                          "absolute inset-x-0 bottom-1.5 h-0.5 rounded-full forced-colors:bg-[Highlight]",
                          area === "all" ? "bg-[color:var(--text-heading)]" : "bg-[color:var(--mode-identity)]",
                        )}
                      />
                    ) : null}
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
          className="flex min-w-0 flex-1 flex-col gap-4 px-4 pb-[calc(1.5rem+var(--keyboard-height,0px)+var(--safe-area-bottom))] pt-3 lg:pb-0"
        >
          <p className="sr-only" role="status" aria-live="polite">
            {liveText}
          </p>
          {records.anySample ? (
            <p role="note" className="flex items-start gap-2 text-xs text-[color:var(--text-muted)]">
              <Info aria-hidden="true" className="mt-0.5 size-icon-xs shrink-0" strokeWidth={1.6} />
              <span>
                {records.sample
                  ? "Sample records, not yours. Sign in to see your own."
                  : "Some of what's shown here is sample data, not yours."}
              </span>
            </p>
          ) : null}
          <AreaNotices
            areas={records.areas}
            missing={answer?.missing}
            onRetry={() => {
              records.retry();
              inputRef.current?.focus();
            }}
          />
          {typed && correction && !patient && !clinical ? (
            <p className="text-sm text-[color:var(--text-muted)]">
              Showing matches for <b className="font-semibold text-[color:var(--text-heading)]">{correction.read}</b>.
              <br />
              <button
                type="button"
                onClick={() => setExactFor(trimmed)}
                className={cn(
                  "-my-3 min-h-12 font-semibold text-[color:var(--text-heading)] underline decoration-[color:var(--border-strong)] underline-offset-4",
                  focusRing,
                )}
              >
                Search for &ldquo;{correction.typed}&rdquo; exactly
              </button>
            </p>
          ) : null}

          {!typed ? (
            <>
              {recents.length > 0 ? (
                <section className="grid gap-1">
                  <Kicker
                    id="work-search-recent"
                    action={
                      <button
                        type="button"
                        onClick={() => {
                          recentMemory = { epoch, list: [] };
                          setRecents([]);
                          inputRef.current?.focus();
                        }}
                        aria-label="Clear recent searches"
                        className={cn(
                          "-my-3 min-h-12 px-1 text-sm font-semibold text-[color:var(--text-heading)]",
                          focusRing,
                        )}
                      >
                        Clear
                      </button>
                    }
                  >
                    Recent
                  </Kicker>
                  <ul aria-labelledby="work-search-recent" className="divide-y divide-[color:var(--border)]">
                    {recents.map((value) => (
                      <li key={value} className="flex items-center">
                        <button
                          type="button"
                          onClick={() => runQuery(value)}
                          className={cn(
                            "flex min-h-12 min-w-0 flex-1 items-center gap-3 text-left text-sm text-[color:var(--text-heading)]",
                            focusRing,
                          )}
                        >
                          <span className="grid w-8 shrink-0 justify-items-center text-[color:var(--text-muted)]">
                            <Clock aria-hidden="true" className="size-icon-md" strokeWidth={1.6} />
                          </span>
                          <span className="min-w-0 flex-1 truncate">{value}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            recentMemory = { epoch, list: recentsFor(epoch).filter((item) => item !== value) };
                            setRecents(recentsFor(epoch));
                          }}
                          aria-label={`Remove ${value} from recent searches`}
                          className={cn(
                            "grid size-tap shrink-0 place-items-center text-[color:var(--text-muted)]",
                            focusRing,
                          )}
                        >
                          <X aria-hidden="true" className="size-icon-sm" strokeWidth={1.6} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {nextUp.length > 0 || loading ? (
                <section className="grid gap-1">
                  <Kicker id="work-search-next">Next up</Kicker>
                  {nextUp.length > 0 ? (
                    <ListCard labelledBy="work-search-next" onKeyDown={(event) => moveFocus(event, inputRef)}>
                      {nextUp.map((item) => (
                        <ResultRow
                          key={item.id}
                          item={item}
                          today={today}
                          onOpen={openResult}
                          onNow={Boolean(
                            item.startsAt &&
                            item.endsAt &&
                            Date.parse(item.startsAt) <= now &&
                            Date.parse(item.endsAt) > now,
                          )}
                        />
                      ))}
                    </ListCard>
                  ) : (
                    <ul aria-hidden="true" className="grid divide-y divide-[color:var(--border)]">
                      {[0, 1, 2].map((index) => (
                        <li key={index} className="flex min-h-14 items-center gap-3 py-2.5">
                          <span className="h-8 w-8 rounded-md bg-[color:var(--surface-inset)] motion-safe:animate-pulse" />
                          <span className="h-3 flex-1 rounded bg-[color:var(--surface-inset)] motion-safe:animate-pulse" />
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ) : null}
              <section className="grid gap-1">
                <Kicker id="work-search-try">Try asking</Kicker>
                <ListCard labelledBy="work-search-try">
                  {TRY_ASKING.map((value) => (
                    <ActionRow
                      key={value}
                      icon={<Sparkles aria-hidden="true" className="size-icon-md" strokeWidth={1.6} />}
                      trailing={<ChevronRight aria-hidden="true" className="size-icon-sm" strokeWidth={1.6} />}
                      onClick={() => runQuery(value)}
                    >
                      {value}
                    </ActionRow>
                  ))}
                </ListCard>
              </section>
              {neverSearched}
            </>
          ) : answer ? (
            <div
              className={cn(
                "grid grid-cols-[minmax(0,1fr)] gap-4",
                groups.length > 0 && "lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-start",
              )}
            >
              <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
                <AnswerCard
                  answer={answer}
                  today={today}
                  onOpen={openResult}
                  onRetry={() => {
                    records.retry();
                    inputRef.current?.focus();
                  }}
                />
                {answer.footnote ? <FootNote icon={Info}>{answer.footnote}</FootNote> : null}
              </div>
              {groups.length > 0 ? (
                <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
                  {resultGroups}
                  {stillSearching}
                </div>
              ) : null}
            </div>
          ) : groups.length > 0 ? (
            <>
              {notices}
              {askCards}
              {resultGroups}
              {stillSearching}
              {neverSearched}
            </>
          ) : loading ? (
            <>
              {notices}
              {askCards}
              <p role="status" className="py-8 text-center text-sm text-[color:var(--text-muted)]">
                Searching your work…
              </p>
            </>
          ) : patient || clinical ? (
            <>
              {notices}
              {patient ? neverSearched : null}
            </>
          ) : (
            <>
              {askCards}
              <div className="grid justify-items-center gap-1 px-3 pb-2 pt-6 text-center">
                <p className="text-base font-semibold text-[color:var(--text-heading)]">
                  Nothing for &ldquo;{trimmed}&rdquo;
                </p>
                <p className="max-w-xs text-sm text-[color:var(--text-muted)]">
                  {filter === "all"
                    ? "It isn't in your Roster, Teaching, CPD, Admin or On Call records."
                    : `It isn't in your ${workSearchAreaLabels[filter]} records.`}
                </p>
              </div>
              <section className="grid gap-1">
                <Kicker id="work-search-instead">Try instead</Kicker>
                <ListCard labelledBy="work-search-instead">
                  {filter !== "all" && listedCount > 0 ? (
                    <ActionRow
                      icon={<Search aria-hidden="true" className="size-icon-md" strokeWidth={1.6} />}
                      trailing={<ChevronRight aria-hidden="true" className="size-icon-sm" strokeWidth={1.6} />}
                      onClick={() => setFilter("all")}
                    >
                      Search all areas ({listedCount})
                    </ActionRow>
                  ) : null}
                  {firstWord && firstWord !== trimmed ? (
                    <ActionRow
                      icon={<WorkSearchGlyph className="size-icon-md" />}
                      trailing={<ChevronRight aria-hidden="true" className="size-icon-sm" strokeWidth={1.6} />}
                      onClick={() => runQuery(firstWord)}
                    >
                      Search for &ldquo;{firstWord}&rdquo;
                    </ActionRow>
                  ) : null}
                  <ActionRow
                    icon={<FileText aria-hidden="true" className="size-icon-md" strokeWidth={1.6} />}
                    trailing={<ChevronRight aria-hidden="true" className="size-icon-sm" strokeWidth={1.6} />}
                    href={documentsSearchHref({ query: trimmed })}
                    onNavigate={() => close(true)}
                  >
                    Search clinical documents for &ldquo;{trimmed}&rdquo;
                  </ActionRow>
                  <ActionRow
                    icon={<AreaTileIcon area={fallbackArea} />}
                    trailing={<ChevronRight aria-hidden="true" className="size-icon-sm" strokeWidth={1.6} />}
                    href={appModeHomeHref(fallbackArea)}
                    onNavigate={() => close(true)}
                  >
                    <span className="block">Open {workSearchAreaLabels[fallbackArea]}</span>
                    <span className="block text-xs text-[color:var(--text-muted)]">{AREA_HOLDS[fallbackArea]}</span>
                  </ActionRow>
                </ListCard>
              </section>
            </>
          )}

          <div className="sticky bottom-0 -mx-4 mt-auto hidden items-center gap-4 border-t border-[color:var(--border)] bg-[color:var(--surface-raised)] px-4 py-3 text-xs text-[color:var(--text-muted)] [@media(hover:hover)_and_(pointer:fine)_and_(min-width:48rem)]:flex">
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
            <span className="ml-auto flex items-center gap-1.5">
              <Lock aria-hidden="true" className="size-icon-xs" strokeWidth={1.6} />
              Your own records only
            </span>
          </div>
        </div>
      </div>
    </Sheet>
  );
}

const keyCap =
  "rounded border border-[color:var(--border-strong)] px-1.5 font-sans text-2xs leading-5 text-[color:var(--text-muted)]";

function AreaTileIcon({ area }: { area: WorkSearchArea }) {
  const Icon = AREA_ICONS[area];
  return <Icon aria-hidden="true" className="size-icon-md" strokeWidth={1.6} />;
}
