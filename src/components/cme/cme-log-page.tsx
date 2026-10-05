"use client";

import { Check, ChevronDown, Download, Ellipsis, FileText, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { focusRing } from "@/components/card-recipes";
import { CmeDraftsSection } from "@/components/cme/cme-drafts-section";
import { CmeFlatList, CmeFlatRow, CmeGroup, CmeNote, CmeTextLink } from "@/components/cme/cme-flat-list";
import { CmeLogCopySheet } from "@/components/cme/cme-log-copy-sheet";
import { CmeLogMonthList } from "@/components/cme/cme-log-entry-list";
import { CmeLogMonthChart } from "@/components/cme/cme-log-month-chart";
import { CmeLogFilterPanel, useWideLogLayout } from "@/components/cme/cme-log-filter-panel";
import {
  ATTENTION_FILTERS,
  CATEGORY_OPTIONS,
  cmeCpdHomeWords,
  cmeFilledButton,
  groupByMonth,
  type CategoryFilter,
  type CmeLogAttention,
} from "@/components/cme/cme-log-shared";
import { CmeMissedSessionsSection } from "@/components/cme/cme-missed-sessions-section";
import { buttonFaceClass } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { SearchField } from "@/components/ui/text-field";
import { cn, EmptyState, InlineNotice, textMuted } from "@/components/ui-primitives";
import { perthCalendarDate } from "@/lib/cme/cpd-year";
import type { CmeDraft } from "@/lib/cme/drafts";
import type { CmeMissedSession } from "@/lib/cme/missed-sessions";
import type { CmeRoutine } from "@/lib/cme/routines";
import type { CmeCategory, CmeEntry, CmeRequirementSet } from "@/lib/cme/types";
import { cmePageTitle } from "@/components/cme/cme-page-frame";

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
  /**
   * Kept for the route's call. The Log no longer carries the floating quick-log
   * panel (mock-up screen 02 has one filled button, "Log an activity"), so routines are not read here.
   */
  readonly routines?: readonly CmeRoutine[];
};

type SheetSection = "year" | "category";

/**
 * LOG — every activity the owner has recorded, by year (mock-up screen 02).
 *
 * Top to bottom: the year picker beside "Log an activity" (the page's one
 * filled button), the search field, then one wrapping row of quiet chips — the
 * category, and the three audit questions with their counts (not marked
 * copied, no reflection, no evidence). A twelve-bar hours-by-month chart jumps
 * through the year, grey with the current month in indigo. A plain note
 * offers to copy the activities not yet marked copied, one at a time, into
 * MyCPD (or "your CPD home" when the year is not known to be RANZCP's); PsychSift cannot see it, so it only ever says "marked copied".
 * Entries follow in flat month lists, most recent first, each row a link to
 * its own entry screen (`/cme/log/[id]`), its category a small indigo-shade
 * dot beside the name in grey words. The foot reminds the owner to keep
 * patient details out of reflections and holds the archived-records link.
 * Download CSV and the annual summary sit behind "More".
 *
 * **No colour carries status here.** Design decision §12 bans red, amber and
 * green from this mode outright, so a row says what is missing in grey words.
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
  const [sheetSection, setSheetSection] = useState<SheetSection | null>(null);
  const yearButtonRef = useRef<HTMLButtonElement>(null);
  const categoryButtonRef = useRef<HTMLButtonElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const [attention, setAttention] = useState<CmeLogAttention | null>(initialAttention);
  const [showArchived, setShowArchived] = useState(false);
  // The attention chips are hidden while archived records show, so their filter must not narrow that list unseen.
  const attentionFilter = showArchived
    ? null
    : (ATTENTION_FILTERS.find((filter) => filter.value === attention) ?? null);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>(initialCategory ?? "all");
  const [copiedOverride, setCopiedOverride] = useState<Record<string, boolean>>({});
  const [lastCopiedId, setLastCopiedId] = useState<string | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copySession, setCopySession] = useState(0);
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
  // The copy note counts the whole year shown, like the "Not marked copied" chip, whatever the search or category.
  const uncopied = useMemo(
    () =>
      yearEntries
        .filter((entry) => !entry.transcribed && !entry.archivedAt)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [yearEntries],
  );

  const yearLabel = allYears ? "All years" : String(effectiveYear);
  const cpdHome = cmeCpdHomeWords(set);
  const categoryLabel = CATEGORY_OPTIONS.find((option) => option.value === categoryFilter)?.label ?? "All categories";

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
      setCopyError("Could not undo the marked-copied status. Try again.");
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

  const panelProps = {
    availableYears,
    navigationYears,
    effectiveYear,
    setYear: set.year,
    allYears,
    onAllYears: setAllYears,
    onSelectYear: setSelectedYear,
    visibleEntries,
    yearEntries,
    hasAllYears: Boolean(allYearsEntries),
    categoryFilter,
    onCategory: setCategoryFilter,
    showArchived,
  };

  return (
    <main
      data-testid="cme-log-page"
      data-mode-identity="cme"
      className={cn(
        "mx-auto w-full max-w-3xl px-4 pb-[calc(max(1rem,env(safe-area-inset-bottom))+2rem)] pt-6 sm:px-6",
        !showFinish && "lg:max-w-5xl",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className={cmePageTitle}>{showFinish ? "To finish" : "Log"}</h1>
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
            open={sheetSection !== null && !wide}
            onClose={() => setSheetSection(null)}
            title={sheetSection === "category" ? "Show a category" : "Choose a year"}
            placement="responsive-right"
            mobilePlacement="bottom"
            returnFocusRef={sheetSection === "category" ? categoryButtonRef : yearButtonRef}
            testId="cme-log-filter-sheet"
            footer={
              <button
                type="button"
                onClick={() => setSheetSection(null)}
                className={cn(buttonFaceClass({ variant: "secondary", block: true }))}
              >
                Show {filtered.length} {filtered.length === 1 ? "activity" : "activities"}
              </button>
            }
          >
            <CmeLogFilterPanel {...panelProps} section={sheetSection ?? "year"} />
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
          />
        </>
      ) : null}

      {showFinish ? (
        <>
          <CmeGroup label="Activities needing attention" className="mt-5">
            <CmeFlatList>
              {ATTENTION_FILTERS.map((filter) => {
                const count = yearEntries.filter(filter.matches).length;
                if (!count) return null;
                const href =
                  filter.value === "copy"
                    ? `/cme/log?year=${effectiveYear}&copy=todo`
                    : `/cme/log?year=${effectiveYear}&fix=${filter.value}`;
                return (
                  <CmeFlatRow
                    key={filter.value}
                    href={href}
                    testId={`cme-finish-attention-${filter.value}`}
                    title={filter.label}
                    subtitle={`${count} ${count === 1 ? "activity" : "activities"} in ${effectiveYear}`}
                  />
                );
              })}
            </CmeFlatList>
          </CmeGroup>
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
              <CmeLogFilterPanel {...panelProps} />
            </aside>
          ) : null}
          <div className="grid min-w-0 gap-4">
            <div className="flex items-center gap-2.5">
              <button
                ref={yearButtonRef}
                type="button"
                onClick={() => setSheetSection("year")}
                data-testid="cme-log-open-filters"
                aria-haspopup="dialog"
                aria-label={`Year: ${yearLabel}. Choose a year`}
                className={cn(
                  focusRing,
                  "inline-flex min-h-12 shrink-0 items-center gap-1.5 rounded-md border border-[color:var(--border-strong)] px-4 text-sm font-semibold text-[color:var(--text-heading)] lg:hidden",
                )}
              >
                <span className="nums font-normal">{yearLabel}</span>
                <ChevronDown aria-hidden="true" strokeWidth={1.6} className="size-4" />
              </button>
              <Link
                href={`/cme/new?year=${set.year}`}
                data-testid="cme-log-new-entry"
                className={cn(focusRing, cmeFilledButton, "flex-1 lg:flex-none")}
              >
                <Plus aria-hidden="true" strokeWidth={1.6} className="size-4 shrink-0" />
                <span>Log an activity</span>
              </Link>
            </div>

            <div data-testid="cme-log-search" className="min-w-0">
              <SearchField
                label="Search your log"
                placeholder="Search titles and reflections"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onClear={() => setQuery("")}
                clearLabel="Clear the log search"
              />
            </div>

            <div role="group" aria-label="Narrow the log" className="flex flex-wrap gap-x-2">
              <button
                ref={categoryButtonRef}
                type="button"
                onClick={() => setSheetSection("category")}
                aria-haspopup="dialog"
                data-testid="cme-log-category-chip"
                className={cn(chipButton, "lg:hidden")}
              >
                {/* Always drawn as the chosen chip: it shows the category in force, "All categories" included. */}
                <span className={cn(chipFace, chipFaceOn)}>
                  {categoryLabel}
                  <ChevronDown aria-hidden="true" strokeWidth={1.6} className="size-3.5" />
                </span>
              </button>
              {!showArchived ? (
                <div role="group" aria-label="Needs attention" data-testid="cme-log-attention" className="contents">
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
                        className={chipButton}
                      >
                        <span className={cn(chipFace, pressed && chipFaceOn)}>
                          {filter.label}
                          <span className="nums font-normal text-[color:var(--text-heading)]">{count}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>

            {showArchived ? (
              <p className={cn(textMuted, "text-sm-minus")} data-testid="cme-log-archived-help">
                Archived activities keep their records and evidence. They add nothing to totals, downloads and annual
                summaries. Open one to restore it.
              </p>
            ) : null}

            {!allYears && groups.length > 0 ? (
              <CmeLogMonthChart year={effectiveYear} groups={groups} today={today} />
            ) : null}

            {!showArchived && uncopied.length > 0 ? (
              <CmeNote
                testId="cme-log-copy-help"
                icon={<Check aria-hidden="true" strokeWidth={1.6} />}
                title={`${uncopied.length} ${uncopied.length === 1 ? "activity" : "activities"} not marked copied to ${cpdHome.name}`}
              >
                <span>
                  Copy one, paste it into {cpdHome.name}, then mark it copied. PsychSift sends nothing to{" "}
                  {cpdHome.college}.
                </span>
                <span className="-my-3 flex">
                  <CmeTextLink onClick={openCopySheet} testId="cme-log-copy-next">
                    Copy the next one
                  </CmeTextLink>
                </span>
              </CmeNote>
            ) : null}
            {lastCopiedId && !copyOpen ? (
              <div role="status" data-testid="cme-log-copy-done" className="flex flex-wrap items-center gap-2 text-sm">
                <span>Marked copied.</span>
                <button
                  type="button"
                  disabled={copyBusy}
                  onClick={() => void undoFromPage()}
                  className="min-h-tap font-medium text-[color:var(--clinical-accent)] underline underline-offset-2"
                >
                  Undo
                </button>
              </div>
            ) : null}
            {copyError ? (
              <p role="alert" className="text-sm">
                {copyError}
              </p>
            ) : null}

            <div className="mt-1 flex flex-col gap-6">
              {groups.length === 0 ? (
                <EmptyState
                  testId="cme-log-empty"
                  title={
                    yearEntries.length === 0
                      ? showArchived
                        ? `No archived activities in ${yearLabel}.`
                        : `Nothing logged for ${effectiveYear} yet.`
                      : "Nothing matched your search and filter."
                  }
                  body={
                    yearEntries.length === 0
                      ? showArchived
                        ? "Activities you archive appear here."
                        : "Log your first activity for this year to see it here."
                      : "Try a shorter word, or clear the category filter."
                  }
                />
              ) : (
                <CmeLogMonthList groups={groups} today={today} showYear={allYears} />
              )}
            </div>

            <div className="grid justify-items-start">
              <p className="text-xs text-[color:var(--text-muted)]" data-testid="cme-log-privacy-reminder">
                Reflections are yours: leave out patient names, dates of birth and record numbers.
              </p>
              <span className="-mt-2.5 flex">
                <CmeTextLink onClick={() => setShowArchived((value) => !value)} testId="cme-log-show-archived">
                  {showArchived ? "Back to active activities" : "Show archived"}
                </CmeTextLink>
              </span>
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
    </main>
  );
}

/** A chip's 48 px tap area around its 32 px face (mock-up `.chip`). */
const chipButton = cn(focusRing, "inline-flex min-h-12 items-center rounded-md");
const chipFace =
  "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border border-[color:var(--border-strong)] px-3 text-sm-minus text-[color:var(--text-muted)]";
const chipFaceOn = "border-[color:var(--text-heading)] text-[color:var(--text-heading)]";

/** One row of the More sheet: a full-width 48 px choice, the label at 500 beside its icon. */
const moreRow =
  "flex min-h-tap w-full items-center gap-2.5 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3 text-left font-medium text-[color:var(--text-heading)] transition-colors duration-[var(--duration-instant)] hover:border-[color:var(--border-strong)] hover:bg-[color:var(--surface-raised)]";
