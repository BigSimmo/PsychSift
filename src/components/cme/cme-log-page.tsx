"use client";

import { Check, Copy, Download, Ellipsis, FileText, ListFilter, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { CmeDraftsSection } from "@/components/cme/cme-drafts-section";
import { CmeLogCopySheet } from "@/components/cme/cme-log-copy-sheet";
import { CmeLogMonthList, CmeLogMonthStrip } from "@/components/cme/cme-log-entry-list";
import { CmeLogFilterPanel, useWideLogLayout } from "@/components/cme/cme-log-filter-panel";
import {
  ATTENTION_FILTERS,
  groupByMonth,
  type CategoryFilter,
  type CmeLogAttention,
} from "@/components/cme/cme-log-shared";
import { CmeMissedSessionsSection } from "@/components/cme/cme-missed-sessions-section";
import { CmeQuickLog } from "@/components/cme/cme-quick-log";
import { buttonFaceClass } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { SearchField } from "@/components/ui/text-field";
import { cn, EmptyState, eyebrowText, InlineNotice, textMuted } from "@/components/ui-primitives";
import { perthCalendarDate } from "@/lib/cme/cpd-year";
import type { CmeDraft } from "@/lib/cme/drafts";
import type { CmeMissedSession } from "@/lib/cme/missed-sessions";
import type { CmeRoutine } from "@/lib/cme/routines";
import type { CmeCategory, CmeEntry, CmeRequirementSet } from "@/lib/cme/types";
import { cmePageTitle } from "@/components/cme/cme-page-frame";
import { PageTitleUnderBand } from "@/components/mode-band/mode-band";

export type { CmeLogAttention } from "@/components/cme/cme-log-shared";

export type CmeLogPageProps = {
  /** Every entry the owner has recorded, any year — loaded from the owner-scoped API / repository. */
  readonly entries: readonly CmeEntry[];
  /** The confirmed programme — only its `year` is required for the year tabs. */
  readonly set: CmeRequirementSet;
  /** Server-backed year destinations. Omit in isolated component tests with a multi-year entry fixture. */
  readonly navigationYears?: readonly number[];
  /** Set by the new-entry page after a save, so the owner sees it landed. */
  readonly justSaved?: boolean;
  /** Set when the saved activity could not be linked to the missed session it was meant to replace. */
  readonly missedLinkFailed?: boolean;
  readonly demoMode?: boolean;
  /** Opens the log already narrowed to activities needing one kind of attention (from the year check). */
  readonly initialAttention?: CmeLogAttention | null;
  readonly initialCategory?: CmeCategory | null;
  /** Owner-scoped entries across years, when the route has loaded them. */
  readonly allYearsEntries?: readonly CmeEntry[];
  readonly allYearsFailed?: boolean;
  /** Saved drafts. Listed apart from the log and never counted toward hours. */
  readonly drafts?: readonly CmeDraft[];
  /** Missed teaching and supervision. Never counted toward hours. */
  readonly missedSessions?: readonly CmeMissedSession[];
  /** Drafts or missed sessions could not be read. */
  readonly recordsFailed?: boolean;
  /** Today in Perth (`YYYY-MM-DD`), so a row adds the year only to another year's date. The route passes the loader's clock. */
  readonly today?: string;
  /** The To finish address shows unfinished records without the activity filters. */
  readonly initialTab?: "activities" | "finish";
  readonly routines?: readonly CmeRoutine[];
};

/**
 * LOG — every activity the owner has recorded, by year.
 *
 * Built for one hand on a phone: the search field and one Filters button share
 * the first row, so the first activity sits near the top of the screen. The
 * year, another year by number, the category and archived records live in the
 * filter sheet (a side column at `lg+`), and the button says which year is
 * showing and how many filters are on. The three audit questions (evidence,
 * reflection, copied) stay one tap away as a single sideways-scrolling chip
 * row. A twelve-bar month strip jumps through the year; entries below are
 * grouped by month, most recent first, under headers that stay pinned while
 * their month scrolls. Each row is a single link to its own entry screen
 * (`/cme/log/[id]`). Download CSV and the annual summary sit behind "More".
 *
 * **No colour carries status here.** Design decision §12 bans red, amber and
 * green from this mode outright, so a row says what is missing in grey words
 * ("No certificate") and shows no ticks: in CPD a tick appears only where
 * tapping it toggles something (spec §5).
 *
 * The closing "New entry" link stays as the standing way to reach the full
 * form, outlined: the floating "+ Log" is this page's one dark button.
 */
export function CmeLogPage({
  entries,
  set,
  navigationYears,
  justSaved = false,
  missedLinkFailed = false,
  demoMode = false,
  initialAttention = null,
  initialCategory = null,
  allYearsEntries,
  allYearsFailed = false,
  drafts = [],
  missedSessions = [],
  recordsFailed = false,
  today = perthCalendarDate(new Date()),
  initialTab = "activities",
  routines = [],
}: CmeLogPageProps) {
  const showFinish = initialTab === "finish";
  const wide = useWideLogLayout();
  const availableYears = useMemo(() => {
    const years = new Set<number>((allYearsEntries ?? entries).map((entry) => Number(entry.date.slice(0, 4))));
    for (const year of navigationYears ?? []) years.add(year);
    years.add(set.year);
    return [...years].sort((a, b) => b - a);
  }, [entries, allYearsEntries, navigationYears, set.year]);

  const [selectedYear, setSelectedYear] = useState<number>(() =>
    availableYears.includes(set.year) ? set.year : (availableYears[0] ?? set.year),
  );
  const effectiveYear = navigationYears ? set.year : selectedYear;
  const [allYears, setAllYears] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterButtonRef = useRef<HTMLButtonElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const [attention, setAttention] = useState<CmeLogAttention | null>(initialAttention);
  const attentionFilter = ATTENTION_FILTERS.find((filter) => filter.value === attention) ?? null;
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>(initialCategory ?? "all");
  const [copiedOverride, setCopiedOverride] = useState<Record<string, boolean>>({});
  const [lastCopiedId, setLastCopiedId] = useState<string | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copySession, setCopySession] = useState(0);
  const copyButtonRef = useRef<HTMLButtonElement>(null);
  const [copyBusy, setCopyBusy] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const visibleEntries = useMemo(
    () =>
      (allYearsEntries ?? entries).map((entry) =>
        Object.hasOwn(copiedOverride, entry.id) ? { ...entry, transcribed: copiedOverride[entry.id]! } : entry,
      ),
    [allYearsEntries, entries, copiedOverride],
  );
  const entriesById = useMemo(() => new Map(visibleEntries.map((entry) => [entry.id, entry])), [visibleEntries]);

  // The page's Undo fades after a few seconds; while the copy sheet is open its own Undo stays until the next step.
  useEffect(() => {
    if (!lastCopiedId || copyOpen) return;
    const timer = window.setTimeout(() => setLastCopiedId(null), 6000);
    return () => window.clearTimeout(timer);
  }, [lastCopiedId, copyOpen]);

  const yearEntries = useMemo(
    () =>
      visibleEntries.filter(
        (entry) =>
          (allYears || entry.date.startsWith(`${effectiveYear}-`)) && Boolean(entry.archivedAt) === showArchived,
      ),
    [visibleEntries, effectiveYear, allYears, showArchived],
  );

  const trimmedQuery = query.trim().toLowerCase();
  const searched = useMemo(() => {
    if (trimmedQuery.length === 0) return yearEntries;
    return yearEntries.filter(
      (entry) =>
        entry.title.toLowerCase().includes(trimmedQuery) || entry.reflection.toLowerCase().includes(trimmedQuery),
    );
  }, [yearEntries, trimmedQuery]);

  const filtered = useMemo(() => {
    return searched.filter(
      (entry) =>
        (!attentionFilter || attentionFilter.matches(entry)) &&
        (categoryFilter === "all" || entry.allocations.some((allocation) => allocation.category === categoryFilter)),
    );
  }, [searched, categoryFilter, attentionFilter]);

  const sorted = useMemo(() => [...filtered].sort((a, b) => b.date.localeCompare(a.date)), [filtered]);
  const groups = useMemo(() => groupByMonth(sorted), [sorted]);
  const uncopied = useMemo(() => sorted.filter((entry) => !entry.transcribed && !entry.archivedAt), [sorted]);

  // Only what the sheet hides counts here: the year is already in the button's words, and the chips show themselves.
  const activeFilterCount = (categoryFilter !== "all" ? 1 : 0) + (showArchived ? 1 : 0);
  const yearLabel = allYears ? "All years" : String(effectiveYear);

  async function patchCopied(id: string, transcribed: boolean) {
    const response = await fetch(`/api/cme/entries/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcribed }),
    });
    if (!response.ok) throw new Error("Could not save the copied status.");
  }

  /** Called only from the copy sheet's "Mark copied, next" — never on a copy alone. */
  async function markCopied(id: string) {
    if (demoMode) throw new Error("Demo records are read-only.");
    await patchCopied(id, true);
    setCopiedOverride((current) => ({ ...current, [id]: true }));
    setLastCopiedId(id);
  }

  async function undoCopied() {
    if (!lastCopiedId) return;
    const copiedId = lastCopiedId;
    await patchCopied(copiedId, false);
    setCopiedOverride((current) => ({ ...current, [copiedId]: false }));
    setLastCopiedId(null);
  }

  async function undoFromPage() {
    if (!lastCopiedId || copyBusy) return;
    setCopyBusy(true);
    setCopyError(null);
    try {
      await undoCopied();
    } catch {
      setCopyError("Could not undo the copied status. Try again.");
    } finally {
      setCopyBusy(false);
    }
  }

  function openCopySheet() {
    if (uncopied.length === 0) return;
    setCopyError(null);
    setCopySession((session) => session + 1);
    setCopyOpen(true);
  }

  const filterPanel = (
    <CmeLogFilterPanel
      availableYears={availableYears}
      navigationYears={navigationYears}
      effectiveYear={effectiveYear}
      setYear={set.year}
      allYears={allYears}
      onAllYears={setAllYears}
      onSelectYear={setSelectedYear}
      visibleEntries={visibleEntries}
      yearEntries={yearEntries}
      hasAllYears={Boolean(allYearsEntries)}
      categoryFilter={categoryFilter}
      onCategory={setCategoryFilter}
      showArchived={showArchived}
      onToggleArchived={() => setShowArchived((value) => !value)}
    />
  );

  return (
    <main
      data-testid="cme-log-page"
      className={cn(
        "mx-auto w-full max-w-3xl px-4 pb-[calc(max(1rem,env(safe-area-inset-bottom))+6rem)] pt-6 sm:px-6",
        !showFinish && "lg:max-w-5xl",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <PageTitleUnderBand className={cmePageTitle}>{showFinish ? "To finish" : "Log"}</PageTitleUnderBand>
          {showFinish ? null : (
            <p className={cn(textMuted, "mt-1 text-sm")}>Every activity you have recorded, by year.</p>
          )}
        </div>
        {showFinish ? null : (
          // A native button rather than `IconButton`, which takes no ref: the More sheet returns focus here.
          <button
            ref={moreButtonRef}
            type="button"
            aria-label="More log actions"
            aria-haspopup="dialog"
            onClick={() => setMoreOpen(true)}
            data-testid="cme-log-more"
            className="-mr-2 grid size-tap min-h-tap shrink-0 place-items-center rounded-lg text-[color:var(--text-muted)] transition-colors duration-[var(--duration-instant)] hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
          >
            <Ellipsis aria-hidden="true" className="size-icon-md" />
          </button>
        )}
      </div>
      <div role="status" data-testid="cme-log-saved">
        {justSaved ? (
          <p className="mt-3 inline-flex min-h-tap items-center gap-2 rounded-lg bg-[color:var(--clinical-accent-soft)] px-3 text-sm font-semibold text-[color:var(--clinical-accent)]">
            <Check aria-hidden="true" className="size-icon-sm" />
            Saved to your log.
          </p>
        ) : null}
        {missedLinkFailed ? (
          <div className="mt-3" data-testid="cme-log-missed-unlinked">
            <InlineNotice tone="warning">
              The activity was saved, but it could not be linked to the missed session. Link it from Missed teaching and
              supervision below.
            </InlineNotice>
          </div>
        ) : null}
      </div>
      {allYearsFailed ? (
        <p role="status" className={cn(textMuted, "mt-2 text-sm")}>
          All years could not be loaded. This year is still available.
        </p>
      ) : null}

      {!showFinish ? (
        <>
          <Sheet
            open={moreOpen}
            onClose={() => setMoreOpen(false)}
            title="Log actions"
            placement="responsive-right"
            mobilePlacement="bottom"
            returnFocusRef={moreButtonRef}
            testId="cme-log-more-sheet"
          >
            <div className="grid gap-2 text-sm">
              <a
                href={`/api/cme/export?year=${effectiveYear}`}
                download
                data-testid="cme-log-download-csv"
                className={moreRow}
              >
                <Download aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--text-muted)]" />
                Download CSV
              </a>
              <Link
                href={`/cme/summary?year=${effectiveYear}`}
                data-testid="cme-log-annual-summary"
                className={moreRow}
              >
                <FileText aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--text-muted)]" />
                Annual summary
              </Link>
            </div>
          </Sheet>
          <Sheet
            open={filterOpen && !wide}
            onClose={() => setFilterOpen(false)}
            title="Filter your log"
            placement="responsive-right"
            mobilePlacement="bottom"
            returnFocusRef={filterButtonRef}
            testId="cme-log-filter-sheet"
            footer={
              <button
                type="button"
                onClick={() => setFilterOpen(false)}
                className={cn(buttonFaceClass({ variant: "primary", block: true }))}
              >
                Show {filtered.length} {filtered.length === 1 ? "activity" : "activities"}
              </button>
            }
          >
            {filterPanel}
          </Sheet>
          <CmeLogCopySheet
            key={copySession}
            open={copyOpen}
            onClose={() => setCopyOpen(false)}
            candidates={uncopied}
            lookup={(id) => entriesById.get(id)}
            set={set}
            demoMode={demoMode}
            onMark={markCopied}
            onUndo={undoCopied}
            lastMarkedId={lastCopiedId}
            returnFocusRef={copyButtonRef}
          />
        </>
      ) : null}

      {showFinish ? (
        <>
          <section className="mt-5" aria-labelledby="cme-attention-heading">
            <h2 id="cme-attention-heading" className={eyebrowText}>
              Activities needing attention
            </h2>
            <ul className="mt-2 divide-y divide-[color:var(--border)] rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-4">
              {ATTENTION_FILTERS.map((filter) => {
                const count = yearEntries.filter(filter.matches).length;
                if (!count) return null;
                const href =
                  filter.value === "copy"
                    ? `/cme/log?year=${effectiveYear}&copy=todo`
                    : `/cme/log?year=${effectiveYear}&fix=${filter.value}`;
                return (
                  <li key={filter.value}>
                    <Link
                      href={href}
                      className="flex min-h-tap items-center justify-between gap-3 py-2 text-sm text-[color:var(--text)]"
                    >
                      <span>{filter.label}</span>
                      <span className={textMuted}>{count}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
          <div id="cme-drafts" className="mt-5">
            <CmeDraftsSection drafts={drafts} demoMode={demoMode} loadFailed={recordsFailed} />
          </div>
        </>
      ) : null}

      {!showFinish ? (
        <div className="mt-4 lg:grid lg:grid-cols-[16rem_minmax(0,1fr)] lg:items-start lg:gap-8">
          {wide ? (
            <aside
              aria-label="Filter your log"
              data-testid="cme-log-filter-column"
              className="hidden lg:sticky lg:top-4 lg:block"
            >
              {filterPanel}
            </aside>
          ) : null}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div data-testid="cme-log-search" className="min-w-0 flex-1">
                <SearchField
                  label="Search your log"
                  placeholder="Search titles and reflections"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onClear={() => setQuery("")}
                  clearLabel="Clear the log search"
                />
              </div>
              <button
                ref={filterButtonRef}
                type="button"
                onClick={() => setFilterOpen(true)}
                data-testid="cme-log-open-filters"
                aria-haspopup="dialog"
                className={cn(buttonFaceClass({ variant: "secondary" }), "shrink-0 gap-1.5 px-3 lg:hidden")}
              >
                <ListFilter aria-hidden="true" className="size-icon-sm" />
                <span>
                  Filters<span aria-hidden="true"> ·</span> <span className="nums font-normal">{yearLabel}</span>
                </span>
                {activeFilterCount > 0 ? (
                  <span
                    data-testid="cme-log-filter-count"
                    className="nums grid min-w-5 place-items-center rounded-full bg-[color:var(--clinical-accent-soft)] px-1.5 text-xs font-normal text-[color:var(--clinical-accent)]"
                  >
                    <span className="sr-only">, </span>
                    {activeFilterCount}
                    <span className="sr-only"> on</span>
                  </span>
                ) : null}
              </button>
            </div>

            {!showArchived ? (
              <div
                role="group"
                aria-label="Needs attention"
                data-testid="cme-log-attention"
                className="-mx-4 mt-3 flex flex-nowrap gap-2 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0"
              >
                {ATTENTION_FILTERS.map((filter) => {
                  const count = yearEntries.filter(filter.matches).length;
                  const pressed = attention === filter.value;
                  return (
                    <button
                      key={filter.value}
                      type="button"
                      aria-pressed={pressed}
                      data-testid={`cme-log-attention-${filter.value}`}
                      onClick={() => setAttention(pressed ? null : filter.value)}
                      className={cn(
                        "inline-flex min-h-tap shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-sm font-medium",
                        pressed
                          ? "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                          : "border-[color:var(--border)] text-[color:var(--text)]",
                      )}
                    >
                      {filter.label}
                      <span className="nums text-xs font-normal opacity-80">{count}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}

            {attention === "copy" && !showArchived ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  ref={copyButtonRef}
                  type="button"
                  onClick={openCopySheet}
                  disabled={uncopied.length === 0}
                  aria-haspopup="dialog"
                  data-testid="cme-log-copy-next"
                  className={buttonFaceClass({ variant: "primary" })}
                >
                  <Copy aria-hidden="true" className="size-icon-sm" />
                  Copy next
                </button>
              </div>
            ) : null}
            {attention === "copy" && lastCopiedId && !copyOpen ? (
              <div
                role="status"
                data-testid="cme-log-copy-done"
                className="mt-2 flex flex-wrap items-center gap-2 text-sm"
              >
                <span>Marked as copied.</span>
                <button
                  type="button"
                  disabled={copyBusy}
                  onClick={() => void undoFromPage()}
                  className="min-h-tap font-semibold underline underline-offset-2"
                >
                  Undo
                </button>
              </div>
            ) : null}
            {copyError ? (
              <p role="alert" className="mt-2 text-sm">
                {copyError}
              </p>
            ) : null}
            {attention === "copy" ? (
              <p className={cn(textMuted, "mt-2 text-sm")} data-testid="cme-log-copy-help">
                Open each one and tap <span className="font-semibold">Copy for your CPD home</span>, then paste it into
                your CPD home&rsquo;s own record. Each is ticked off here as you copy it.
              </p>
            ) : null}
            {showArchived ? (
              <p className={cn(textMuted, "mt-2 text-sm")}>
                Archived entries retain their records and evidence. They contribute zero to totals, downloads and annual
                summaries. Open an entry to restore it.
              </p>
            ) : null}

            {!allYears && groups.length > 0 ? (
              <div className="mt-4">
                <CmeLogMonthStrip year={effectiveYear} groups={groups} today={today} />
              </div>
            ) : null}

            <div className="mt-4 flex flex-col gap-5">
              {groups.length === 0 ? (
                <EmptyState
                  testId="cme-log-empty"
                  title={
                    yearEntries.length === 0
                      ? `Nothing logged for ${effectiveYear} yet.`
                      : "Nothing matched your search and filter."
                  }
                  body={
                    yearEntries.length === 0
                      ? "Log your first activity for this year to see it here."
                      : "Try a shorter word, or clear the category filter."
                  }
                />
              ) : (
                <CmeLogMonthList groups={groups} today={today} />
              )}
            </div>

            <div className="mt-6 flex justify-center">
              <Link
                href={`/cme/new?year=${set.year}`}
                data-testid="cme-log-new-entry"
                className={cn(buttonFaceClass({ variant: "secondary" }))}
              >
                <Plus aria-hidden="true" className="size-icon-md shrink-0" />
                <span>New entry</span>
              </Link>
            </div>
          </div>
        </div>
      ) : null}
      {showFinish ? (
        <div className="mt-8">
          <CmeMissedSessionsSection
            sessions={missedSessions}
            entries={entries
              .filter((entry) => !entry.archivedAt)
              .map((entry) => ({ id: entry.id, title: entry.title, date: entry.date }))}
            state={recordsFailed ? "load-failed" : "ready"}
            demoMode={demoMode}
          />
        </div>
      ) : null}
      {!showFinish && set.totalHours > 0 && !set.closedAt ? (
        <CmeQuickLog set={set} entries={entries} routines={routines} demoMode={demoMode} />
      ) : null}
    </main>
  );
}

/** One row of the More sheet: a full-width 48 px choice, the label at 500 beside its icon. */
const moreRow =
  "flex min-h-tap w-full items-center gap-2.5 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3 text-left font-medium text-[color:var(--text-heading)] transition-colors duration-[var(--duration-instant)] hover:border-[color:var(--border-strong)] hover:bg-[color:var(--surface-raised)]";
