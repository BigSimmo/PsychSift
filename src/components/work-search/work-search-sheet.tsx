"use client";

import {
  ChevronRight,
  Clock,
  FileText,
  Info,
  Lock,
  RotateCcw,
  Search,
  Sparkles,
  Stethoscope,
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
  AreaTile,
  cardSurface,
  dayMonthLong,
  detailWithoutDay,
  focusRing,
  Kicker,
  ListCard,
  moveFocus,
  onPlainClick,
  relativeDay,
  ResultRow,
} from "@/components/work-search/work-search-parts";
import { WorkSearchGlyph } from "@/components/work-search/work-search-glyph";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/components/ui-primitives";
import { appModeHomeHref } from "@/lib/app-modes";
import { documentsSearchHref } from "@/lib/document-flow-routes";
import { perthDateOf, perthTimeOf } from "@/lib/perth-time";
import { answerWorkQuestion } from "@/lib/work-search/answers";
import {
  workSearchAreaLabels,
  workSearchAreas,
  type WorkAreaRead,
  type WorkItem,
  type WorkSearchArea,
} from "@/lib/work-search/model";
import { searchWork, workComingUp, workSearchCounts, type WorkSearchHit } from "@/lib/work-search/search";
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

function groupNoun(hits: readonly WorkSearchHit[]): string {
  const kinds = new Set(hits.map((hit) => hit.item.kind));
  const many = hits.length !== 1;
  if (kinds.size === 1 && kinds.has("shift")) return many ? "shifts" : "shift";
  if (kinds.size === 1 && kinds.has("session")) return many ? "sessions" : "session";
  if (kinds.size === 1 && kinds.has("cpd-activity")) return many ? "entries" : "entry";
  if (kinds.size === 1 && kinds.has("renewal")) return many ? "renewals" : "renewal";
  return many ? "matches" : "match";
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

/** The small label and the big word on a "Coming up" card. */
function comingUpFace(
  item: WorkItem,
  today: string,
  now: number,
): { label: string; big: string; small: string; warning: boolean } {
  const date = item.date ?? today;
  const rest = detailWithoutDay(item) ?? "";
  switch (item.kind) {
    case "shift":
      if (item.startsAt && item.endsAt && Date.parse(item.startsAt) <= now) {
        return { label: "On now", big: `Until ${perthTimeOf(item.endsAt)}`, small: item.title, warning: false };
      }
      return { label: "Next shift", big: relativeDay(today, date), small: rest, warning: false };
    case "session":
      return item.facet === "presenting"
        ? { label: "Presenting", big: relativeDay(today, date), small: item.title, warning: false }
        : { label: "Teaching", big: relativeDay(today, date), small: rest || item.title, warning: false };
    case "leave":
      return date <= today
        ? {
            label: "On leave",
            big: "Now",
            small: item.until ? `To ${dayMonthLong(item.until)}` : item.title,
            warning: false,
          }
        : { label: "Leave", big: relativeDay(today, date), small: dayMonthLong(date), warning: false };
    case "renewal":
      return date < today
        ? { label: "Overdue", big: item.title, small: `Was due ${dayMonthLong(date)}`, warning: true }
        : { label: "Renewal", big: item.title, small: `Due ${dayMonthLong(date)}`, warning: false };
    default:
      return { label: workSearchAreaLabels[item.area], big: item.title, small: dayMonthLong(date), warning: false };
  }
}

function ComingUpCards({
  items,
  today,
  now,
  onOpen,
}: {
  items: readonly WorkItem[];
  today: string;
  now: number;
  onOpen: () => void;
}) {
  return (
    <ul className="-mx-4 flex scroll-px-4 gap-2 overflow-x-auto overscroll-x-contain px-4 pb-2 pt-1">
      {items.map((item) => {
        const face = comingUpFace(item, today, now);
        return (
          <li key={item.id} data-mode-identity={item.area} className="w-36 shrink-0">
            <Link
              href={item.href}
              onClick={onPlainClick(onOpen)}
              data-work-search-result=""
              aria-label={`${face.label}: ${item.title}, ${face.big}${face.small ? `, ${face.small}` : ""}`}
              className={cn(
                cardSurface,
                "grid h-full min-h-12 content-start gap-0.5 px-3 py-2.5",
                face.warning && "border-[color:var(--warning-border)]",
                focusRing,
              )}
            >
              <span
                className={cn(
                  "flex items-center gap-1.5 truncate text-2xs font-extrabold uppercase tracking-wider",
                  face.warning ? "text-[color:var(--warning)]" : "text-[color:var(--mode-identity)]",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    face.warning ? "bg-[color:var(--warning)]" : "bg-[color:var(--mode-identity)]",
                  )}
                />
                {face.label}
              </span>
              <span className="mt-1 line-clamp-2 text-base-minus font-bold leading-snug text-[color:var(--text-heading)]">
                {face.big}
              </span>
              <span className="line-clamp-2 text-xs text-[color:var(--text-muted)]">{face.small}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function AreaNotices({ areas, onRetry }: { areas: readonly WorkAreaRead[]; onRetry: () => void }) {
  const failed = areas.filter((area) => area.status === "failed").map((area) => workSearchAreaLabels[area.area]);
  // Admin and On Call share one read, so name it once.
  const names = [...new Set(failed)];
  if (names.length === 0) return null;
  return (
    <div role="status" className={cn(cardSurface, "flex items-start gap-3 p-3.5")}>
      <Info aria-hidden="true" className="mt-0.5 size-icon-md shrink-0 text-[color:var(--text-muted)]" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-[color:var(--text-heading)]">{names.join(", ")} couldn&apos;t load</p>
        <p className="mt-0.5 text-xs text-[color:var(--text-muted)]">
          {names.length === 1 ? "It isn't" : "They aren't"} searched yet, so if something is missing, it may just be
          there.
        </p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        aria-label={`Retry loading ${names.join(" and ")}`}
        className={cn("inline-flex min-h-12 shrink-0 items-center self-center", focusRing)}
      >
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--border-strong)] px-3 py-1.5 text-xs font-bold text-[color:var(--text-heading)]">
          <RotateCcw aria-hidden="true" className="size-icon-xs" />
          Retry
        </span>
      </button>
    </div>
  );
}

function FootNote({ children, icon: Icon = Lock }: { children: ReactNode; icon?: LucideIcon }) {
  return (
    <p className="flex items-start justify-center gap-2 px-1.5 pb-2 pt-1 text-center text-xs text-[color:var(--text-muted)]">
      <Icon aria-hidden="true" className="mt-0.5 size-icon-xs shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/** A built-in question offered while typing: tap to ask it. Drawn to the approved "Ask" row. */
function AskCard({ question, onAsk }: { question: string; onAsk: () => void }) {
  return (
    <button
      type="button"
      onClick={onAsk}
      className={cn(
        cardSurface,
        "flex min-h-12 w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-[color:var(--surface-subtle)] motion-reduce:transition-none",
        focusRing,
      )}
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-subtle)] text-[color:var(--text-heading)]">
        <Sparkles aria-hidden="true" className="size-icon-sm" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold text-[color:var(--text-muted)]">Ask</span>
        <span className="block text-sm font-bold leading-snug text-[color:var(--text-heading)]">{question}</span>
      </span>
      <span className="shrink-0 rounded-lg border border-[color:var(--border-strong)] px-2 py-1 text-xs font-bold text-[color:var(--text-muted)]">
        Ask
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

  const hits = useMemo(
    () => searchWork({ items: records.items, entries: records.entries }, searchQuery, { currentArea, today }),
    [records.items, records.entries, searchQuery, currentArea, today],
  );
  const counts = useMemo(() => workSearchCounts(hits), [hits]);
  const shown = useMemo(
    () => (filter === "all" ? hits : hits.filter((hit) => hit.item.area === filter)),
    [hits, filter],
  );
  const allItems = useMemo(
    () => [...records.items, ...records.entries.map(({ item }) => item)],
    [records.items, records.entries],
  );
  const comingUp = useMemo(() => workComingUp(allItems, today, now, 5), [allItems, today, now]);
  const loadingAreas = records.areas.filter((area) => area.status === "loading");
  const loading = loadingAreas.length > 0;
  const answer = useMemo(
    () => answerWorkQuestion(searchQuery, { items: allItems, areas: records.areas, today, now, cpd: records.cpd }),
    [searchQuery, allItems, records.areas, records.cpd, today, now],
  );
  const trimmed = searchQuery.trim();
  const typed = query.trim().length > 0;
  const patient = trimmed.length > 0 && looksLikePatientDetails(trimmed);
  const clinical = trimmed.length > 0 && !patient && looksClinical(trimmed);
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
  const groups = useMemo(() => {
    const extra: WorkSearchHit[] = extraFromAnswer ? answerItems.map((item) => ({ item, rank: 0 as const })) : [];
    const seen = new Set<string>();
    const pool = [...extra, ...shown].filter((hit) => {
      if (seen.has(hit.item.id) || hiddenIds.has(hit.item.id)) return false;
      seen.add(hit.item.id);
      return filter === "all" || hit.item.area === filter;
    });
    const order = currentArea
      ? [currentArea, ...workSearchAreas.filter((area) => area !== currentArea)]
      : workSearchAreas;
    const leading = answer && answer.area !== "all" ? [answer.area] : [];
    const areas = [...new Set([...leading, ...order])];
    return areas
      .map((area) => ({ area, hits: pool.filter((hit) => hit.item.area === area) }))
      .filter((group) => group.hits.length > 0);
  }, [answer, answerItems, extraFromAnswer, shown, hiddenIds, filter, currentArea]);
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
      <section key={group.area} className="grid grid-cols-[minmax(0,1fr)] gap-3">
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
                  "-my-3 min-h-12 px-1 text-sm font-semibold text-[color:var(--text-muted)] hover:text-[color:var(--text-heading)]",
                  focusRing,
                )}
              >
                See all
              </button>
            ) : null
          }
        >
          {`${workSearchAreaLabels[group.area]} · ${group.hits.length} ${groupNoun(group.hits)}`}
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
      <div className="grid gap-2">
        {suggestions.map((question) => (
          <AskCard key={question} question={question} onAsk={() => runQuery(question)} />
        ))}
      </div>
    ) : null;

  const notices = (
    <>
      {patient ? (
        <div
          role="note"
          className="flex items-center gap-3 rounded-2xl border border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] py-1 pl-3.5 pr-1"
        >
          <Lock aria-hidden="true" className="size-icon-sm shrink-0 text-[color:var(--warning)]" />
          <p className="min-w-0 flex-1 py-2 text-xs text-[color:var(--text-heading)]">
            <b>Looks like patient details.</b> Not saved to Recent. Please don&apos;t type patient details here.
          </p>
          <button
            type="button"
            onClick={() => runQuery("")}
            className={cn("inline-flex min-h-12 shrink-0 items-center px-1", focusRing)}
          >
            <span className="rounded-full border border-[color:var(--warning-border)] bg-[color:var(--surface-raised)] px-3 py-1.5 text-xs font-bold text-[color:var(--text-heading)]">
              Clear
            </span>
          </button>
        </div>
      ) : null}
      {clinical ? (
        <div className="grid gap-3 rounded-2xl border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] p-4">
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[color:var(--surface-raised)] text-[color:var(--clinical-accent)]">
              <Stethoscope aria-hidden="true" className="size-icon-sm" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-base-minus font-bold leading-snug text-[color:var(--text-heading)]">
                This looks like a clinical question
              </p>
              <p className="mt-1 text-xs text-[color:var(--text-muted)]">
                Clinical search answers it from guidelines, with citations. Work search only looks at your staff
                records.
              </p>
            </div>
          </div>
          <Link
            href={clinicalSearchHref(trimmed)}
            onClick={onPlainClick(() => close(true))}
            className={cn(
              "inline-flex min-h-12 items-center justify-center gap-1.5 rounded-full bg-[color:var(--clinical-accent)] px-5 text-sm font-bold text-[color:var(--clinical-accent-contrast)]",
              focusRing,
            )}
          >
            Ask clinical search
            <ChevronRight aria-hidden="true" className="size-icon-sm" />
          </Link>
        </div>
      ) : null}
    </>
  );

  const stillSearching =
    typed && loading && visibleCount > 0 ? (
      <p role="status" className="px-1 text-xs text-[color:var(--text-muted)]">
        Still searching {[...new Set(loadingAreas.map((area) => workSearchAreaLabels[area.area]))].join(", ")}…
      </p>
    ) : null;

  const chipAreas = typed
    ? workSearchAreas.filter((area) => (counts[area] ?? 0) > 0 || filter === area)
    : workSearchAreas;

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
      contentClassName="bg-[color:var(--surface-inset)] lg:h-[min(46rem,calc(100dvh-8rem))] lg:max-h-[calc(100dvh-8rem)] lg:max-w-2xl lg:rounded-3xl lg:border-[color:var(--border)]"
      bodyClassName="p-0 sm:p-0"
      bodyRef={bodyRef}
      onBodyScroll={(event) => setScrolled(event.currentTarget.scrollTop > 2)}
    >
      <div ref={rootRef} data-work-search-root="" className="flex min-h-full flex-col">
        <h2 className="sr-only">Search my work</h2>
        <div
          className={cn(
            "sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)] gap-2 border-b bg-[color:var(--surface-inset)] px-4 pb-1 pt-[max(0.75rem,var(--safe-area-top))] transition-colors motion-reduce:transition-none lg:pt-4 [@media(max-height:500px)]:static",
            scrolled ? "border-[color:var(--border)]" : "border-transparent",
          )}
        >
          {records.anySample ? (
            <p
              role="note"
              className="flex items-center gap-2 rounded-xl border border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] px-3 py-2 text-xs text-[color:var(--text-heading)]"
            >
              <Info aria-hidden="true" className="size-icon-sm shrink-0 text-[color:var(--warning)]" />
              <span>
                {records.sample ? (
                  <>
                    <b>Sample data.</b> Sign in to search your own records.
                  </>
                ) : (
                  <>
                    <b>Example records.</b> Some of what&apos;s shown here is sample data, not yours.
                  </>
                )}
              </span>
            </p>
          ) : null}
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1 rounded-2xl ring-4 ring-[color:var(--border)]">
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
                className="search-shell flex min-h-12 min-w-0 items-center gap-2.5 rounded-2xl border border-[color:var(--border-strong)] bg-[color:var(--surface-raised)] pl-3.5 pr-1"
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
                  placeholder="Search shifts, leave, CPD, forms…"
                  aria-label="Search shifts, leave, teaching, CPD, admin and on-call"
                  enterKeyHint="search"
                  inputMode="search"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  className="search-shell-input min-w-0 flex-1 bg-transparent py-3 text-base font-medium text-[color:var(--text-heading)] outline-none placeholder:font-normal placeholder:text-[color:var(--text-muted)] lg:text-base-minus [&::-webkit-search-cancel-button]:hidden"
                />
                {typed ? (
                  <button
                    type="button"
                    onClick={() => runQuery("")}
                    aria-label="Clear search"
                    className={cn("grid size-tap shrink-0 place-items-center rounded-full", focusRing)}
                  >
                    <span className="grid size-6 place-items-center rounded-full bg-[color:var(--text-muted)] text-[color:var(--surface-raised)]">
                      <X aria-hidden="true" className="size-icon-xs" strokeWidth={3} />
                    </span>
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => close(false)}
                  aria-label="Close search"
                  title="Close (Esc)"
                  className={cn("hidden min-h-12 shrink-0 items-center px-2 lg:inline-flex", focusRing)}
                >
                  <span className="rounded-md border border-[color:var(--border-strong)] bg-[color:var(--surface-subtle)] px-1.5 py-0.5 text-xs font-bold text-[color:var(--text-muted)]">
                    esc
                  </span>
                </button>
              </form>
            </div>
            <button
              type="button"
              onClick={() => close(false)}
              className={cn(
                "min-h-12 shrink-0 px-2 text-base-minus font-semibold text-[color:var(--text-heading)] lg:hidden",
                focusRing,
              )}
            >
              Cancel
            </button>
          </div>
          <div
            ref={chipsRef}
            onScroll={updateChipsMore}
            className={cn(
              "-mx-4 flex gap-1.5 overflow-x-auto overscroll-x-contain px-4 py-1",
              chipsMore && "[mask-image:linear-gradient(90deg,black_85%,transparent)]",
            )}
            role="group"
            aria-label="Filter by area"
          >
            {(["all", ...chipAreas] as const).map((area) => {
              const selected = filter === area;
              const count = area === "all" ? hits.length : (counts[area] ?? 0);
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
                  className={cn("inline-flex min-h-12 shrink-0 items-center", focusRing)}
                >
                  <span
                    className={cn(
                      "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold transition-colors motion-reduce:transition-none",
                      selected && "forced-colors:border-2",
                      selected && area === "all"
                        ? "border-[color:var(--border-strong)] bg-[color:var(--border)] text-[color:var(--text-heading)]"
                        : selected
                          ? "border-[color:var(--mode-identity-border)] bg-[color:var(--mode-identity-soft)] text-[color:var(--mode-identity)]"
                          : "border-[color:var(--border)] bg-[color:var(--surface-raised)] text-[color:var(--text-muted)]",
                    )}
                  >
                    {area === "all" ? null : (
                      <span aria-hidden="true" className="size-2 rounded-full bg-[color:var(--mode-identity)]" />
                    )}
                    {label}
                    {typed && count > 0 ? <span className="text-xs font-bold">{count}</span> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div
          onTouchMove={() => {
            // Scrolling the results on a phone puts the keyboard away, as iOS search screens do.
            if (document.activeElement === inputRef.current && !usesFinePointer()) inputRef.current?.blur();
          }}
          className="grid flex-1 grid-cols-[minmax(0,1fr)] content-start gap-3 px-4 pb-[calc(1.5rem+var(--keyboard-height,0px)+var(--safe-area-bottom))] pt-2 lg:pb-0"
        >
          <p className="sr-only" role="status" aria-live="polite">
            {liveText}
          </p>
          <AreaNotices
            areas={records.areas}
            onRetry={() => {
              records.retry();
              inputRef.current?.focus();
            }}
          />

          {!typed ? (
            <>
              {comingUp.length > 0 ? (
                <>
                  <Kicker>{records.anySample ? "Coming up · Sample" : "Coming up"}</Kicker>
                  <ComingUpCards items={comingUp} today={today} now={now} onOpen={openResult} />
                </>
              ) : loading ? (
                <>
                  <Kicker>Coming up</Kicker>
                  <ul aria-hidden="true" className="-mx-4 flex gap-2 overflow-hidden px-4 pb-2 pt-1">
                    {[0, 1, 2].map((index) => (
                      <li key={index} className={cn(cardSurface, "h-24 w-36 shrink-0 motion-safe:animate-pulse")} />
                    ))}
                  </ul>
                </>
              ) : null}
              <Kicker>Go to</Kicker>
              <ul className="grid grid-cols-5 gap-1">
                {workSearchAreas.map((area) => (
                  <li key={area}>
                    <Link
                      href={appModeHomeHref(area)}
                      onClick={onPlainClick(() => close(true))}
                      className={cn(
                        "flex min-h-12 flex-col items-center gap-1.5 rounded-xl py-1 text-center text-xs font-semibold text-[color:var(--text-muted)]",
                        focusRing,
                      )}
                    >
                      <AreaTile area={area} size="lg" />
                      {workSearchAreaLabels[area]}
                    </Link>
                  </li>
                ))}
              </ul>
              {recents.length > 0 ? (
                <>
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
                          "-my-3 min-h-12 px-1 text-sm font-semibold text-[color:var(--text-muted)] hover:text-[color:var(--text-heading)]",
                          focusRing,
                        )}
                      >
                        Clear
                      </button>
                    }
                  >
                    Recent
                  </Kicker>
                  <ListCard labelledBy="work-search-recent">
                    {recents.map((value) => (
                      <ActionRow
                        key={value}
                        icon={<Clock aria-hidden="true" className="size-icon-sm" />}
                        trailing={<ChevronRight aria-hidden="true" className="size-icon-sm" />}
                        onClick={() => runQuery(value)}
                      >
                        {value}
                      </ActionRow>
                    ))}
                  </ListCard>
                </>
              ) : null}
              <Kicker id="work-search-try">Try asking</Kicker>
              <ListCard labelledBy="work-search-try">
                {TRY_ASKING.map((value) => (
                  <ActionRow
                    key={value}
                    icon={<Sparkles aria-hidden="true" className="size-icon-sm" />}
                    trailing={<ChevronRight aria-hidden="true" className="size-icon-sm" />}
                    onClick={() => runQuery(value)}
                  >
                    {value}
                  </ActionRow>
                ))}
              </ListCard>
            </>
          ) : answer ? (
            <div
              className={cn(
                "grid grid-cols-[minmax(0,1fr)] gap-3",
                groups.length > 0 && "lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-start",
              )}
            >
              <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
                {notices}
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
                <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
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
              <FootNote>Call notes, handover drafts and MHA timers are never searched.</FootNote>
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
              <p className="px-1 pt-1 text-center text-sm text-[color:var(--text-muted)]">
                Nothing for &ldquo;{trimmed}&rdquo; in your work records.
              </p>
            </>
          ) : (
            <>
              {askCards}
              <div className="grid justify-items-center gap-1.5 px-3 pb-4 pt-6 text-center">
                <span className="mb-1.5 grid size-14 place-items-center rounded-full border border-[color:var(--border)] bg-[color:var(--surface-raised)] text-[color:var(--text-muted)]">
                  <WorkSearchGlyph className="size-icon-lg" />
                </span>
                <p className="text-lg font-bold text-[color:var(--text-heading)]">
                  Nothing found for &ldquo;{trimmed}&rdquo;
                </p>
                <p className="max-w-xs text-sm text-[color:var(--text-muted)]">
                  {filter === "all"
                    ? "It isn't in your Roster, Teaching, CPD, Admin or On Call records."
                    : `It isn't in your ${workSearchAreaLabels[filter]} records.`}
                </p>
              </div>
              <Kicker id="work-search-instead">Try instead</Kicker>
              <ListCard labelledBy="work-search-instead">
                {filter !== "all" && hits.length > 0 ? (
                  <ActionRow
                    icon={<Search aria-hidden="true" className="size-icon-sm" />}
                    trailing={<ChevronRight aria-hidden="true" className="size-icon-sm" />}
                    onClick={() => setFilter("all")}
                  >
                    Search all areas ({hits.length})
                  </ActionRow>
                ) : null}
                {firstWord && firstWord !== trimmed ? (
                  <ActionRow
                    icon={<WorkSearchGlyph className="size-icon-sm" />}
                    trailing={<ChevronRight aria-hidden="true" className="size-icon-sm" />}
                    onClick={() => runQuery(firstWord)}
                  >
                    Search for &ldquo;{firstWord}&rdquo;
                  </ActionRow>
                ) : null}
                <ActionRow
                  icon={<FileText aria-hidden="true" className="size-icon-sm" />}
                  trailing={<ChevronRight aria-hidden="true" className="size-icon-sm" />}
                  href={documentsSearchHref({ query: trimmed })}
                  onNavigate={() => close(true)}
                >
                  Search clinical documents for &ldquo;{trimmed}&rdquo;
                </ActionRow>
                <ActionRow
                  icon={<AreaTileIcon area={fallbackArea} />}
                  trailing={<ChevronRight aria-hidden="true" className="size-icon-sm" />}
                  href={appModeHomeHref(fallbackArea)}
                  onNavigate={() => close(true)}
                >
                  Open {workSearchAreaLabels[fallbackArea]}
                </ActionRow>
              </ListCard>
            </>
          )}

          <div className="sticky bottom-0 mt-auto hidden items-center gap-4 border-t border-[color:var(--border)] bg-[color:var(--surface-inset)] px-1 py-3 text-xs text-[color:var(--text-muted)] [@media(hover:hover)_and_(pointer:fine)_and_(min-width:48rem)]:flex">
            <span className="flex items-center gap-1.5">
              <kbd className="rounded-md border border-[color:var(--border-strong)] bg-[color:var(--surface-subtle)] px-1.5 font-sans text-xs">
                ↑↓
              </kbd>
              move
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="rounded-md border border-[color:var(--border-strong)] bg-[color:var(--surface-subtle)] px-1.5 font-sans text-xs">
                ↵
              </kbd>
              open top result
            </span>
            <span className="ml-auto flex items-center gap-1.5">
              <Lock aria-hidden="true" className="size-icon-xs" />
              Your own records only
            </span>
          </div>
        </div>
      </div>
    </Sheet>
  );
}

function AreaTileIcon({ area }: { area: WorkSearchArea }) {
  const Icon = AREA_ICONS[area];
  return <Icon aria-hidden="true" className="size-icon-sm" />;
}
