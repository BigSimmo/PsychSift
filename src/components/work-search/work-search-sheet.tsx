"use client";

import {
  ArrowUpLeft,
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
} from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState, type RefObject } from "react";

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
  relativeDay,
  ResultRow,
} from "@/components/work-search/work-search-parts";
import { WorkSearchGlyph } from "@/components/work-search/work-search-glyph";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/components/ui-primitives";
import { appModeHomeHref } from "@/lib/app-modes";
import { documentsSearchHref } from "@/lib/document-flow-routes";
import { perthDateOf } from "@/lib/perth-time";
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

const TRY_ASKING = [
  "When am I next on nights?",
  "What's due this month?",
  "How many CPD hours do I still need?",
] as const;

/** A single word that has a built-in question behind it, offered under the word matches. */
const QUESTION_HINTS: ReadonlyArray<[RegExp, string, string]> = [
  [/^leave$/i, "Looking for your leave dates?", "When is my next leave?"],
  [/^nights?$/i, "Looking for your next night?", "When am I next on nights?"],
  [/^(?:due|renewals?|expir\w*)$/i, "Looking for what's coming due?", "What's due this month?"],
  [/^(?:cpd|hours)$/i, "Checking your CPD year?", "How many CPD hours do I still need?"],
  [/^(?:present\w*|talks?)$/i, "Looking for your next talk?", "Am I presenting?"],
];

const GROUP_PREVIEW = 4;

/**
 * Recent searches, kept in this tab's memory only: never in browser storage,
 * because a shared ward computer cannot tell a typed patient name from a word.
 * Gone on reload or sign-out, and anything that looks like patient details is
 * never kept at all.
 */
let recentQueries: string[] = [];
const RECENT_LIMIT = 5;

function rememberQuery(query: string) {
  const trimmed = query.trim();
  if (trimmed.length < 2 || looksLikePatientDetails(trimmed)) return;
  recentQueries = [trimmed, ...recentQueries.filter((value) => value.toLowerCase() !== trimmed.toLowerCase())].slice(
    0,
    RECENT_LIMIT,
  );
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

/** The small label and the big word on a "Coming up" card. */
function comingUpFace(item: WorkItem, today: string): { label: string; big: string; small: string } {
  const date = item.date ?? today;
  const rest = detailWithoutDay(item) ?? "";
  switch (item.kind) {
    case "shift":
      return { label: "Next shift", big: relativeDay(today, date), small: rest };
    case "session":
      return item.facet === "presenting"
        ? { label: "Presenting", big: relativeDay(today, date), small: dayMonthLong(date) }
        : { label: "Teaching", big: relativeDay(today, date), small: rest || dayMonthLong(date) };
    case "leave":
      return { label: "Leave", big: relativeDay(today, date), small: dayMonthLong(date) };
    case "renewal":
      return { label: "Renewal", big: item.title, small: dayMonthLong(date) };
    default:
      return { label: workSearchAreaLabels[item.area], big: item.title, small: dayMonthLong(date) };
  }
}

function ComingUpCards({ items, today, onOpen }: { items: readonly WorkItem[]; today: string; onOpen: () => void }) {
  return (
    <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
      {items.map((item) => {
        const face = comingUpFace(item, today);
        return (
          <li key={item.id} data-mode-identity={item.area} className="w-28 shrink-0">
            <Link
              href={item.href}
              onClick={onOpen}
              data-work-search-result=""
              aria-label={`${face.label}: ${item.title}, ${face.big}${face.small ? `, ${face.small}` : ""}`}
              className={cn(cardSurface, "grid h-full min-h-12 gap-px px-2.5 py-2.5", focusRing)}
            >
              <span className="flex items-center gap-1.5 truncate text-3xs font-extrabold uppercase tracking-wider text-[color:var(--mode-identity)]">
                <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-[color:var(--mode-identity)]" />
                {face.label}
              </span>
              <span className="mt-1 truncate text-base-minus font-bold text-[color:var(--text-heading)]">
                {face.big}
              </span>
              <span className="truncate text-xs text-[color:var(--text-muted)]">{face.small}</span>
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
          {names.length === 1 ? "It isn't" : "They aren't"} searched yet, so nothing here doesn&apos;t mean nothing is
          there.
        </p>
      </div>
      <button
        type="button"
        onClick={onRetry}
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

function FootNote({ children }: { children: string }) {
  return (
    <p className="flex items-start justify-center gap-2 px-1.5 pb-2 pt-1 text-xs text-[color:var(--text-muted)]">
      <Lock aria-hidden="true" className="mt-0.5 size-icon-xs shrink-0" />
      <span>{children}</span>
    </p>
  );
}

export interface WorkSearchSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** The work area the search was opened from: its results come first. */
  readonly currentArea: WorkSearchArea | null;
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
}

export function WorkSearchSheet({ open, onClose, currentArea, returnFocusRef }: WorkSearchSheetProps) {
  const [now] = useState(() => new Date());
  const today = perthDateOf(now);
  const records = useWorkSearchRecords(now);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<WorkSearchArea | "all">("all");
  const [expanded, setExpanded] = useState<WorkSearchArea | null>(null);
  const [recents, setRecents] = useState(() => recentQueries);
  const inputRef = useRef<HTMLInputElement>(null);

  const hits = useMemo(
    () => searchWork({ items: records.items, entries: records.entries }, query, { currentArea, today }),
    [records.items, records.entries, query, currentArea, today],
  );
  const counts = useMemo(() => workSearchCounts(hits), [hits]);
  const shown = filter === "all" ? hits : hits.filter((hit) => hit.item.area === filter);
  const allItems = useMemo(
    () => [...records.items, ...records.entries.map(({ item }) => item)],
    [records.items, records.entries],
  );
  const comingUp = useMemo(() => workComingUp(allItems, today, 5), [allItems, today]);
  const loading = records.areas.some((area) => area.status === "loading");
  const answer = useMemo(
    () => answerWorkQuestion(query, { items: allItems, areas: records.areas, today, cpd: records.cpd }),
    [query, allItems, records.areas, records.cpd, today],
  );
  const trimmed = query.trim();
  const typed = trimmed.length > 0;
  const patient = typed && looksLikePatientDetails(trimmed);
  const clinical = typed && !patient && looksClinical(trimmed);
  const hint = !answer && !patient ? QUESTION_HINTS.find(([pattern]) => pattern.test(trimmed)) : undefined;

  const openResult = () => {
    rememberQuery(query);
    onClose();
  };
  const runQuery = (value: string) => {
    setQuery(value);
    setExpanded(null);
    inputRef.current?.focus();
  };

  // Records an answer already lists inside its card are not repeated below it.
  const insideAnswer = useMemo(
    () => new Set(answer?.area === "all" ? answer.items.map((item) => item.id) : []),
    [answer],
  );
  const groups = useMemo(() => {
    const extra: WorkSearchHit[] =
      answer && answer.area !== "all" ? answer.items.map((item) => ({ item, rank: 0 as const })) : [];
    const seen = new Set<string>();
    const pool = [...extra, ...shown].filter((hit) => {
      if (seen.has(hit.item.id) || insideAnswer.has(hit.item.id)) return false;
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
  }, [answer, shown, insideAnswer, filter, currentArea]);

  const fallbackArea: WorkSearchArea = filter !== "all" ? filter : (currentArea ?? "my-work");
  const firstWord = trimmed.split(/\s+/)[0] ?? "";

  const resultGroups = groups.map((group) => {
    const open = filter !== "all" || expanded === group.area || groups.length === 1;
    const visible = open ? group.hits : group.hits.slice(0, GROUP_PREVIEW);
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
                onClick={() => setExpanded(group.area)}
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
            <ResultRow key={hit.item.id} item={hit.item} today={today} query={query} onOpen={openResult} />
          ))}
        </ListCard>
      </section>
    );
  });

  const notices = (
    <>
      {patient ? (
        <div className="flex items-start gap-3 rounded-2xl border border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] p-3.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[color:var(--surface-raised)] text-[color:var(--warning)]">
            <Lock aria-hidden="true" className="size-icon-sm" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-[color:var(--text-heading)]">Kept on this device</p>
            <p className="mt-0.5 text-xs text-[color:var(--text-muted)]">
              This looks like it has patient details, so it won&apos;t be saved to Recent. Only your own staff records
              are searched.
            </p>
            <button
              type="button"
              onClick={() => runQuery("")}
              className={cn("-mb-2 inline-flex min-h-12 items-center", focusRing)}
            >
              <span className="rounded-full border border-[color:var(--warning-border)] bg-[color:var(--surface-raised)] px-3 py-1.5 text-xs font-bold text-[color:var(--text-heading)]">
                Clear search
              </span>
            </button>
          </div>
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
            onClick={onClose}
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

  return (
    <Sheet
      open={open}
      onClose={onClose}
      ariaLabel="Search my work"
      initialFocusRef={inputRef}
      returnFocusRef={returnFocusRef}
      portal
      mobilePlacement="fullscreen"
      mobileSize="viewport"
      testId="work-search-sheet"
      contentClassName="bg-[color:var(--surface-inset)] lg:mt-14 lg:max-w-2xl lg:self-start lg:rounded-3xl lg:border-[color:var(--border)]"
      bodyClassName="p-0 sm:p-0"
    >
      <div data-work-search-root="" className="flex min-h-full flex-col">
        <div className="sticky top-0 grid grid-cols-[minmax(0,1fr)] gap-3 bg-[color:var(--surface-inset)] px-4 pb-2 pt-[max(0.75rem,var(--safe-area-top))] lg:pt-4">
          {records.sample ? (
            <p className="flex items-center gap-2 rounded-xl bg-[color:var(--border)] px-3 py-2 text-xs text-[color:var(--text-muted)]">
              <Info aria-hidden="true" className="size-icon-sm shrink-0 text-[color:var(--text-heading)]" />
              <span>
                <b className="text-[color:var(--text-heading)]">Sample data.</b> Sign in to search your own records.
              </span>
            </p>
          ) : null}
          <div className="flex items-center gap-2.5">
            <div className="min-w-0 flex-1 rounded-2xl ring-4 ring-[color:var(--border)]">
              <form
                role="search"
                aria-label="Search my work"
                onSubmit={(event) => {
                  event.preventDefault();
                  rememberQuery(query);
                  setRecents(recentQueries);
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
                  }}
                  onKeyDown={(event) => moveFocus(event, inputRef)}
                  placeholder="Shifts, CPD, forms, renewals..."
                  aria-label="Search your shifts, teaching, CPD, admin and on-call information"
                  enterKeyHint="search"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  className="search-shell-input min-w-0 flex-1 bg-transparent py-3 text-base-minus font-medium text-[color:var(--text-heading)] outline-none placeholder:font-normal placeholder:text-[color:var(--text-muted)] [&::-webkit-search-cancel-button]:hidden"
                />
                {typed ? (
                  <button
                    type="button"
                    onClick={() => runQuery("")}
                    aria-label="Clear search"
                    className={cn("grid size-tap shrink-0 place-items-center rounded-full", focusRing)}
                  >
                    <span className="grid size-6 place-items-center rounded-full bg-[color:var(--border-strong)] text-[color:var(--surface-raised)]">
                      <X aria-hidden="true" className="size-icon-xs" strokeWidth={3} />
                    </span>
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close search"
                  className={cn("hidden min-h-12 shrink-0 items-center px-2 lg:inline-flex", focusRing)}
                >
                  <span className="rounded-md border border-[color:var(--border-strong)] bg-[color:var(--surface-subtle)] px-1.5 py-0.5 text-2xs font-bold text-[color:var(--text-muted)]">
                    esc
                  </span>
                </button>
              </form>
            </div>
            <button
              type="button"
              onClick={onClose}
              className={cn(
                "min-h-12 shrink-0 px-1 text-base-minus font-semibold text-[color:var(--text-heading)] lg:hidden",
                focusRing,
              )}
            >
              Cancel
            </button>
          </div>
          <div
            className="-mx-4 flex gap-2 overflow-x-auto px-4 [mask-image:linear-gradient(90deg,black_85%,transparent)] lg:[mask-image:none]"
            role="group"
            aria-label="Filter by area"
          >
            {(["all", ...workSearchAreas] as const).map((area) => {
              const selected = filter === area;
              const count = area === "all" ? hits.length : (counts[area] ?? 0);
              const zero = typed && count === 0 && !selected;
              return (
                <button
                  key={area}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    setFilter(area);
                    setExpanded(null);
                  }}
                  data-mode-identity={area === "all" ? undefined : area}
                  className={cn("inline-flex min-h-12 shrink-0 items-center", focusRing)}
                >
                  <span
                    className={cn(
                      "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold transition-colors motion-reduce:transition-none",
                      selected && area === "all"
                        ? "border-[color:var(--border-strong)] bg-[color:var(--border)] text-[color:var(--text-heading)]"
                        : selected
                          ? "border-[color:var(--mode-identity-border)] bg-[color:var(--mode-identity-soft)] text-[color:var(--mode-identity)]"
                          : zero
                            ? "border-[color:var(--border)] bg-transparent text-[color:var(--text-muted)] opacity-60"
                            : "border-[color:var(--border)] bg-[color:var(--surface-raised)] text-[color:var(--text-muted)]",
                    )}
                  >
                    {area === "all" ? null : (
                      <span aria-hidden="true" className="size-2 rounded-full bg-[color:var(--mode-identity)]" />
                    )}
                    {area === "all" ? "All" : workSearchAreaLabels[area]}
                    {typed && count > 0 ? <span className="text-xs font-bold">{count}</span> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid flex-1 grid-cols-[minmax(0,1fr)] content-start gap-3 px-4 pb-6 pt-2">
          <p className="sr-only" aria-live="polite">
            {typed
              ? answer
                ? `${answer.label}: ${answer.headline}. ${answer.understood}.`
                : loading
                  ? "Searching."
                  : `${shown.length} ${shown.length === 1 ? "result" : "results"}.`
              : ""}
          </p>
          <AreaNotices areas={records.areas} onRetry={records.retry} />

          {!typed ? (
            <>
              {comingUp.length > 0 ? (
                <>
                  <Kicker>{records.sample ? "Coming up · Sample" : "Coming up"}</Kicker>
                  <ComingUpCards items={comingUp} today={today} onOpen={openResult} />
                </>
              ) : null}
              <Kicker>Go to</Kicker>
              <ul className="grid grid-cols-5 gap-1">
                {workSearchAreas.map((area) => (
                  <li key={area}>
                    <Link
                      href={appModeHomeHref(area)}
                      onClick={onClose}
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
              <Kicker>Try asking</Kicker>
              <ListCard>
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
              {recents.length > 0 ? (
                <>
                  <Kicker
                    action={
                      <button
                        type="button"
                        onClick={() => {
                          recentQueries = [];
                          setRecents([]);
                        }}
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
                  <ListCard>
                    {recents.map((value) => (
                      <ActionRow
                        key={value}
                        icon={<Clock aria-hidden="true" className="size-icon-sm" />}
                        trailing={<ArrowUpLeft aria-hidden="true" className="size-icon-sm" />}
                        onClick={() => runQuery(value)}
                      >
                        {value}
                      </ActionRow>
                    ))}
                  </ListCard>
                </>
              ) : null}
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
                <AnswerCard answer={answer} today={today} onOpen={openResult} onRetry={records.retry} />
                {answer.footnote ? <FootNote>{answer.footnote}</FootNote> : null}
              </div>
              {groups.length > 0 ? <div className="grid grid-cols-[minmax(0,1fr)] gap-3">{resultGroups}</div> : null}
            </div>
          ) : groups.length > 0 ? (
            <>
              {notices}
              {resultGroups}
              {hint ? (
                <button
                  type="button"
                  onClick={() => runQuery(hint[2])}
                  className={cn(
                    "flex min-h-12 items-start gap-2.5 rounded-2xl border border-dashed border-[color:var(--border-strong)] px-3.5 py-3 text-left text-sm text-[color:var(--text-muted)]",
                    focusRing,
                  )}
                >
                  <Sparkles
                    aria-hidden="true"
                    className="mt-0.5 size-icon-sm shrink-0 text-[color:var(--text-heading)]"
                  />
                  <span>
                    {hint[1]} Try{" "}
                    <b className="font-semibold text-[color:var(--text-heading)]">
                      &ldquo;{hint[2].toLowerCase()}&rdquo;
                    </b>
                  </span>
                </button>
              ) : null}
              <FootNote>
                {patient
                  ? "Call notes, handover drafts and MHA timers are never searched. Please don't type patient names."
                  : "Call notes, handover drafts and MHA timers are never searched."}
              </FootNote>
            </>
          ) : loading ? (
            <>
              {notices}
              <p className="py-8 text-center text-sm text-[color:var(--text-muted)]">Searching your work...</p>
            </>
          ) : patient || clinical ? (
            <>
              {notices}
              <p className="px-1 pt-1 text-center text-sm text-[color:var(--text-muted)]">
                Nothing for &ldquo;{trimmed}&rdquo; in your Roster, Teaching, CPD, Admin or On Call records.
              </p>
            </>
          ) : (
            <>
              <div className="grid justify-items-center gap-1.5 px-3 pb-4 pt-7 text-center">
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
              <Kicker>Try instead</Kicker>
              <ListCard>
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
                  onNavigate={onClose}
                >
                  Look in Documents
                </ActionRow>
                <ActionRow
                  icon={<AreaTileIcon area={fallbackArea} />}
                  trailing={<ChevronRight aria-hidden="true" className="size-icon-sm" />}
                  href={appModeHomeHref(fallbackArea)}
                  onNavigate={onClose}
                >
                  Open {workSearchAreaLabels[fallbackArea]}
                </ActionRow>
              </ListCard>
            </>
          )}

          <div className="mt-auto hidden items-center gap-4 px-1 pt-2 text-xs text-[color:var(--text-muted)] lg:flex">
            <span className="flex items-center gap-1.5">
              <kbd className="rounded-md border border-[color:var(--border-strong)] bg-[color:var(--surface-subtle)] px-1.5 font-sans text-2xs">
                ↑↓
              </kbd>
              move
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="rounded-md border border-[color:var(--border-strong)] bg-[color:var(--surface-subtle)] px-1.5 font-sans text-2xs">
                ↵
              </kbd>
              open
            </span>
            <span className="flex items-center gap-1.5">
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
