"use client";

import {
  Check,
  ChevronDown,
  Copy,
  Download,
  Ellipsis,
  FileText,
  NotebookPen,
  Paperclip,
  Plus,
  Presentation,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CmeDraftsSection } from "@/components/cme/cme-drafts-section";
import { CmeFlatList, CmeFlatRow, CmeGroup, CmeTextLink } from "@/components/cme/cme-flat-list";
import { CmeLogCopySheet } from "@/components/cme/cme-log-copy-sheet";
import { CmeLogMonthList } from "@/components/cme/cme-log-entry-list";
import { CmeLogMonthChart } from "@/components/cme/cme-log-month-chart";
import { CmeLogFilterPanel, useWideLogLayout } from "@/components/cme/cme-log-filter-panel";
import {
  ATTENTION_FILTERS,
  CATEGORY_OPTIONS,
  cmeCpdHomeWords,
  formatHoursShort,
  groupByMonth,
  type CategoryFilter,
  type CmeLogAttention,
} from "@/components/cme/cme-log-shared";
import { CmeMissedSessionsSection } from "@/components/cme/cme-missed-sessions-section";
import { useCmeFinishCount } from "@/components/cme/cme-page-tabs";
import { CME_LOG_TRIGGER_ATTRIBUTE, CmeQuickLog } from "@/components/cme/cme-quick-log";
import { useCmeTeachingUnloggedCount } from "@/components/cme/cme-teaching-prompt";
import { CmeBandAction, CmeBanner, CmeHint, CmeNoteLine } from "@/components/cme/cme-work-kit";
import { useModeBandHeading } from "@/components/mode-band/mode-band";
import { useWorkUndoToast, WorkBody } from "@/components/mode-kit/work";
import { Sheet } from "@/components/ui/sheet";
import { SearchField } from "@/components/ui/text-field";
import { cn, InlineNotice } from "@/components/ui-primitives";
import { perthCalendarDate } from "@/lib/cme/cpd-year";
import { groupDrafts, type CmeDraft } from "@/lib/cme/drafts";
import { totalAllocatedHours } from "@/lib/cme/evaluate";
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
  /**
   * Kept for the route's call. The Log no longer carries the floating quick-log
   * panel (mock-up screen 02 has one filled button, "Log an activity"), so routines are not read here.
   */
  readonly routines?: readonly CmeRoutine[];
  /** The loader's clock. When given, Log an activity opens the quick-log sheet, as on Summary. */
  readonly nowIso?: string;
  /** Ask Teaching for its count of sessions not yet logged (never in the demo or in isolated tests). */
  readonly loadTeachingCount?: boolean;
};

type SheetSection = "all" | "category";

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
  routines = [],
  nowIso,
  loadTeachingCount = false,
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

  /** Called only from the copy sheet's "Mark copied, next", never on a copy alone. */
  async function markCopied(id: string) {
    if (demoMode) throw new Error("Demo records are read-only.");
    await patchCopied(id, true);
    setCopiedOverride((current) => ({ ...current, [id]: true }));
    setLastCopiedId(id);
  }

  async function undoCopiedId(id: string) {
    await patchCopied(id, false);
    setCopiedOverride((current) => ({ ...current, [id]: false }));
    setLastCopiedId((current) => (current === id ? null : current));
  }

  async function undoCopied() {
    if (!lastCopiedId) return;
    await undoCopiedId(lastCopiedId);
  }

  /** Undo from the page: the toast's Undo, or the inline one without a toast. Focus returns to the row. */
  async function undoFromPage(id: string | null = lastCopiedId) {
    if (!id || copyBusy) return;
    setCopyBusy(true);
    setCopyError(null);
    try {
      await undoCopiedId(id);
      window.requestAnimationFrame(() =>
        document.querySelector<HTMLElement>(`[data-testid="cme-log-row-${id}"]`)?.focus(),
      );
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

  // Closing the copy sheet after marking one says so in the work toast, with Undo
  // (mock-up cpd_logUndo). Without the app's toast the page keeps its own line.
  const undoToast = useWorkUndoToast();
  function closeCopySheet() {
    setCopyOpen(false);
    if (!undoToast || !lastCopiedId) return;
    const id = lastCopiedId;
    const title = entriesById.get(id)?.title ?? "activity";
    undoToast(`Marked copied · ${title}`, () => void undoFromPage(id));
    setLastCopiedId(null);
  }

  // The band: the page name, and what the year holds or what is left to finish.
  const activeYear = useMemo(
    () => visibleEntries.filter((entry) => !entry.archivedAt && entry.date.startsWith(`${effectiveYear}-`)),
    [visibleEntries, effectiveYear],
  );
  const teachingCount = useCmeTeachingUnloggedCount(loadTeachingCount && !demoMode);
  const openMissed = missedSessions.filter((session) => session.replacementEntryId === null).length;
  const draftsToDo = groupDrafts(drafts).nextAction.length;
  const finishCount = draftsToDo + openMissed + (teachingCount ?? 0);
  useCmeFinishCount(finishCount > 0 ? finishCount : null);
  const tidyCounts = ATTENTION_FILTERS.map((filter) => ({ filter, count: activeYear.filter(filter.matches).length }));
  const tidyCount = tidyCounts.reduce((sum, item) => sum + item.count, 0);
  useModeBandHeading({
    eyebrow: showFinish
      ? `${finishCount} to finish · ${tidyCount} to tidy`
      : `${activeYear.length} ${activeYear.length === 1 ? "activity" : "activities"} · ${formatHoursShort(totalAllocatedHours(activeYear))} h`,
    title: "Log",
  });

  const quickLog = Boolean(nowIso) && set.confirmedOn !== "";
  const logTrigger = quickLog ? { [CME_LOG_TRIGGER_ATTRIBUTE]: "" } : {};
  const openFilter = useCallback(() => setSheetSection("all"), []);

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

  const yearChip = (
    <button
      ref={yearButtonRef}
      type="button"
      onClick={openFilter}
      data-testid="cme-log-open-filters"
      aria-haspopup="dialog"
      aria-label={`Year: ${yearLabel}. Choose a year`}
      className="work-chip cpd-chip-on min-h-12 lg:hidden"
    >
      <span className="nums font-normal">{yearLabel}</span>
      <ChevronDown aria-hidden="true" strokeWidth={2.2} />
    </button>
  );

  const activities = (
    <div className="lg:grid lg:grid-cols-[16rem_minmax(0,1fr)] lg:items-start lg:gap-8">
      {wide ? (
        <aside
          aria-label="Filter your log"
          data-testid="cme-log-filter-column"
          className="hidden lg:sticky lg:top-4 lg:block"
        >
          <CmeLogFilterPanel
            {...panelProps}
            attention={{ value: attention, onChange: setAttention }}
            onShowArchived={setShowArchived}
          />
        </aside>
      ) : null}
      <div className="grid min-w-0 gap-2.5">
        <div className="flex items-center gap-1">
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
          {/* A native button rather than `IconButton`, which takes no ref: the More sheet returns focus here. */}
          <button
            ref={moreButtonRef}
            type="button"
            aria-label="More log actions"
            aria-haspopup="dialog"
            onClick={() => setMoreOpen(true)}
            data-testid="cme-log-more"
            className="grid size-tap min-h-tap shrink-0 place-items-center rounded-full text-[color:var(--text-muted)] hover:bg-[color:var(--work-wash)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--mode-identity)]"
          >
            <Ellipsis aria-hidden="true" className="size-icon-md" />
          </button>
        </div>

        <div role="group" aria-label="Narrow the log" className="work-chips flex-wrap">
          {yearChip}
          <button
            ref={categoryButtonRef}
            type="button"
            onClick={() => setSheetSection("category")}
            aria-haspopup="dialog"
            data-testid="cme-log-category-chip"
            className={cn("work-chip min-h-12 lg:hidden", categoryFilter !== "all" && "cpd-chip-on")}
          >
            {categoryLabel}
            <ChevronDown aria-hidden="true" strokeWidth={2.2} />
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
                    className="work-chip min-h-12"
                  >
                    {pressed ? <Check aria-hidden="true" strokeWidth={2.4} /> : null}
                    {filter.label}
                    <span className="work-chip__count nums font-normal">{count}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        {showArchived ? (
          <CmeHint testId="cme-log-archived-help">
            Archived activities keep their records and evidence. They add nothing to totals, downloads and annual
            summaries. Open one to restore it.
          </CmeHint>
        ) : null}

        {!allYears && !showArchived && groups.length > 0 ? (
          <CmeLogMonthChart
            year={effectiveYear}
            groups={groups}
            today={today}
            filtered={trimmedQuery.length > 0 || attentionFilter !== null || categoryFilter !== "all"}
          />
        ) : null}

        {!showArchived && uncopied.length > 0 ? (
          <div className="cpd-sug" data-testid="cme-log-copy-help">
            <span aria-hidden="true" className="work-ic">
              <Copy aria-hidden="true" strokeWidth={2} />
            </span>
            <span className="work-row__text">
              <span className="work-row__title">
                <span className="nums font-normal">{uncopied.length}</span>
                {` not marked copied`}
                <span className="sr-only">{` to ${cpdHome.name}`}</span>
              </span>
              <span className="work-row__sub">
                {`Copy one, paste it into ${cpdHome.name}, then mark it copied. PsychSift sends nothing to ${cpdHome.college}.`}
              </span>
            </span>
            <button
              type="button"
              onClick={openCopySheet}
              data-testid="cme-log-copy-next"
              className="work-button min-h-tap shrink-0"
              data-variant="tinted"
            >
              Copy next
            </button>
          </div>
        ) : null}
        {lastCopiedId && !copyOpen && !undoToast ? (
          <div role="status" data-testid="cme-log-copy-done" className="cpd-ban">
            <Check aria-hidden="true" strokeWidth={2} />
            <span>Marked copied.</span>
            <button
              type="button"
              disabled={copyBusy}
              onClick={() => void undoFromPage()}
              className="work-label__link min-h-tap"
            >
              Undo
            </button>
          </div>
        ) : null}
        {copyError ? (
          <p role="alert" className="cpd-hint">
            {copyError}
          </p>
        ) : null}

        <div className="grid gap-3">
          {groups.length === 0 ? (
            <div className="work-card" data-testid="cme-log-empty">
              <div className="work-empty">
                <span aria-hidden="true" className="work-empty__badge">
                  <NotebookPen aria-hidden="true" strokeWidth={2} />
                </span>
                <p className="work-empty__title">
                  {yearEntries.length === 0
                    ? showArchived
                      ? `No archived activities in ${yearLabel}.`
                      : `Nothing logged for ${effectiveYear} yet.`
                    : "Nothing matched your search and filter."}
                </p>
                <p className="work-empty__body">
                  {yearEntries.length === 0
                    ? showArchived
                      ? "Activities you archive appear here."
                      : "Log your first activity for this year to see it here."
                    : "Try a shorter word, or clear the category filter."}
                </p>
              </div>
            </div>
          ) : (
            <CmeLogMonthList groups={groups} today={today} showYear={allYears} />
          )}
        </div>

        <div data-testid="cme-log-privacy-reminder">
          <CmeNoteLine icon={ShieldCheck}>
            Reflections are yours: leave out patient names, dates of birth and record numbers.
          </CmeNoteLine>
        </div>
        <span className="flex justify-center">
          <CmeTextLink onClick={() => setShowArchived((value) => !value)} testId="cme-log-show-archived">
            {showArchived ? "Back to active activities" : "Show archived"}
          </CmeTextLink>
        </span>
      </div>
    </div>
  );

  const finish = (
    <>
      {teachingCount !== null && teachingCount > 0 ? (
        <CmeGroup label={`Teaching to log · ${teachingCount}`} testId="cme-finish-teaching">
          <CmeFlatList>
            <CmeFlatRow
              href="/teaching/review"
              lead={<Presentation aria-hidden="true" strokeWidth={2} />}
              leadTone="mode"
              title="Teaching you gave"
              subtitle={`${teachingCount} ${teachingCount === 1 ? "session is" : "sessions are"} not logged yet`}
            />
          </CmeFlatList>
        </CmeGroup>
      ) : null}
      <div id="cme-drafts">
        <CmeDraftsSection
          // Re-seeded whenever a refresh brings a different draft list, so its groups never go stale.
          key={drafts.map((draft) => `${draft.id}:${draft.updatedAt}`).join("|")}
          drafts={drafts}
          demoMode={demoMode}
          loadFailed={recordsFailed}
        />
      </div>
      {tidyCount > 0 ? (
        <CmeGroup label={`Records to tidy · ${tidyCount}`} testId="cme-finish-tidy">
          <CmeFlatList>
            {tidyCounts.map(({ filter, count }) => {
              if (!count) return null;
              const subtitle = `${count} ${count === 1 ? "activity" : "activities"} in ${effectiveYear}`;
              const Icon = filter.value === "copy" ? Copy : filter.value === "reflection" ? NotebookPen : Paperclip;
              const lead = <Icon aria-hidden="true" strokeWidth={2} />;
              if (filter.value === "copy") {
                return (
                  <li key={filter.value} className="work-row min-w-0" data-testid="cme-finish-attention-copy">
                    <span className="cpd-lead">{lead}</span>
                    <span className="work-row__text">
                      <span className="work-row__title">{filter.label}</span>
                      <span className="work-row__sub nums">{subtitle}</span>
                    </span>
                    <button
                      type="button"
                      onClick={openCopySheet}
                      className="work-button min-h-tap shrink-0"
                      data-variant="tinted"
                    >
                      Copy next
                    </button>
                  </li>
                );
              }
              return (
                <CmeFlatRow
                  key={filter.value}
                  href={`/cme/log?year=${effectiveYear}&fix=${filter.value}`}
                  testId={`cme-finish-attention-${filter.value}`}
                  lead={lead}
                  title={filter.label}
                  subtitle={subtitle}
                  linkEnd={
                    <span aria-hidden="true" className="work-button pointer-events-none" data-variant="secondary">
                      Show
                    </span>
                  }
                />
              );
            })}
          </CmeFlatList>
        </CmeGroup>
      ) : null}
      <CmeMissedSessionsSection
        sessions={missedSessions}
        entries={entries
          .filter((entry) => !entry.archivedAt)
          .map((entry) => ({ id: entry.id, title: entry.title, date: entry.date }))}
        state={recordsFailed ? "load-failed" : "ready"}
        demoMode={demoMode}
      />
    </>
  );

  return (
    <main data-testid="cme-log-page" data-mode-identity="cme" className="w-full">
      {showFinish ? null : (
        <CmeBandAction
          icon={SlidersHorizontal}
          label="Filter your log"
          onClick={openFilter}
          testId="cme-log-filter-action"
        />
      )}
      <WorkBody>
        <PageTitleUnderBand className={cmePageTitle}>{showFinish ? "To finish" : "Log"}</PageTitleUnderBand>
        <div role="status" data-testid="cme-log-saved" className="contents">
          {justSaved ? <CmeBanner icon={Check}>Saved to your log.</CmeBanner> : null}
          {missedLinkFailed ? (
            <div data-testid="cme-log-missed-unlinked">
              <InlineNotice tone="warning">
                The activity was saved, but it could not be linked to the missed session. Link it from Missed teaching
                and supervision below.
              </InlineNotice>
            </div>
          ) : null}
        </div>
        {allYearsFailed ? (
          <p role="status" className="cpd-hint">
            All years could not be loaded. This year is still available.
          </p>
        ) : null}

        {showFinish ? finish : activities}

        <div className="work-dock" role="group" aria-label="Log actions">
          <div className="work-dock__capsule">
            <Link
              href={`/cme/new?year=${set.year}`}
              data-testid="cme-log-new-entry"
              className="work-button min-h-tap"
              data-variant="primary"
              {...logTrigger}
            >
              <Plus aria-hidden="true" strokeWidth={2.2} />
              <span>Log an activity</span>
            </Link>
            {!showFinish && !showArchived && uncopied.length > 0 ? (
              <button
                type="button"
                onClick={openCopySheet}
                data-testid="cme-log-dock-copy"
                className="work-button min-h-tap"
                data-variant="secondary"
              >
                <Copy aria-hidden="true" strokeWidth={2.2} />
                Copy next
              </button>
            ) : null}
          </div>
        </div>
      </WorkBody>

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
            <div className="work-card work-rows">
              <a
                href={`/api/cme/export?year=${effectiveYear}`}
                download
                data-testid="cme-log-download-csv"
                className="work-row min-h-tap"
              >
                <span className="cpd-lead">
                  <Download aria-hidden="true" strokeWidth={2} />
                </span>
                <span className="work-row__text">
                  <span className="work-row__title">Download CSV</span>
                  <span aria-hidden="true" className="work-row__sub">
                    Every activity in {effectiveYear}, for a spreadsheet
                  </span>
                </span>
              </a>
              <Link
                href={`/cme/summary?year=${effectiveYear}`}
                data-testid="cme-log-annual-summary"
                className="work-row min-h-tap"
              >
                <span className="cpd-lead">
                  <FileText aria-hidden="true" strokeWidth={2} />
                </span>
                <span className="work-row__text">
                  <span className="work-row__title">Annual summary</span>
                  <span aria-hidden="true" className="work-row__sub">
                    A page to print or save as PDF
                  </span>
                </span>
              </Link>
            </div>
          </Sheet>
          <Sheet
            open={sheetSection !== null && !wide}
            onClose={() => setSheetSection(null)}
            title={sheetSection === "category" ? "Category" : "Filter"}
            description={`${yearEntries.length} ${yearEntries.length === 1 ? "activity" : "activities"} in ${yearLabel}`}
            placement="responsive-right"
            mobilePlacement="bottom"
            returnFocusRef={sheetSection === "category" ? categoryButtonRef : yearButtonRef}
            testId="cme-log-filter-sheet"
            footer={
              <div className="cpd-two">
                <button
                  type="button"
                  className="work-button min-h-tap"
                  data-variant="secondary"
                  data-testid="cme-log-filter-clear"
                  onClick={() => {
                    setCategoryFilter("all");
                    setAttention(null);
                    setShowArchived(false);
                    setAllYears(false);
                  }}
                >
                  Clear
                </button>
                <button
                  type="button"
                  className="work-button min-h-tap"
                  data-variant="primary"
                  data-testid="cme-log-filter-show"
                  onClick={() => setSheetSection(null)}
                >
                  Show <span className="nums font-normal">{filtered.length}</span>
                </button>
              </div>
            }
          >
            <CmeLogFilterPanel
              {...panelProps}
              section={sheetSection ?? "all"}
              attention={{ value: attention, onChange: setAttention }}
              onShowArchived={setShowArchived}
            />
          </Sheet>
        </>
      ) : null}
      <CmeLogCopySheet
        key={copySession}
        open={copyOpen}
        onClose={closeCopySheet}
        candidates={uncopied}
        lookup={(id) => entriesById.get(id)}
        set={set}
        demoMode={demoMode}
        onMark={markCopied}
        onUndo={undoCopied}
        lastMarkedId={lastCopiedId}
      />
      {quickLog ? (
        <CmeQuickLog set={set} entries={entries} routines={routines} nowIso={nowIso} demoMode={demoMode} />
      ) : null}
    </main>
  );
}
