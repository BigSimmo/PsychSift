"use client";

import { CalendarDays, ChevronDown, CircleHelp, Info, ListFilter, Shield, TriangleAlert } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";

import { useRosterNow } from "@/components/roster/roster-format";
import { ModeBandStatus, PageTitleUnderBand } from "@/components/mode-band/mode-band";
import {
  DEFAULT_FILTERS,
  activeFilterCount,
  dayRows,
  nextMatchingDate,
  summariseBrowse,
  type BrowseFilters,
} from "@/lib/open-shifts/browse";
import { TIME_OF_DAY_LABEL, WINDOW_DAYS, gradeLabel, windowOf } from "@/lib/open-shifts/model";
import { rosterCoveredUntil } from "@/lib/open-shifts/roster-check";
import { perthDateOf, perthTimeOf } from "@/lib/roster/shifts/perth-time";

import { OpenShiftsCalendar } from "./open-shifts-calendar";
import { OpenShiftsFitsYou, OpenShiftsRequestsStrip, fitsYou } from "./open-shifts-for-you";
import { clearSavedFilters, readSavedFilters, saveFilters } from "./open-shifts-saved-filters";
import { useSignedOut } from "@/components/mode-kit/use-signed-out-sample";
import { SignInAction } from "./open-shifts-sign-in";
import { WorkSignInNotice } from "@/components/mode-kit/work-sign-in-notice";
import {
  FlatList,
  ListSkeleton,
  Note,
  SectionHeading,
  ShiftRow,
  advertHref,
  formatDayLong,
  formatDayShort,
} from "./open-shifts-ui";
import { LoadFailed, NoTeam, openShiftsStatus } from "./open-shifts-states";
import { useOpenShifts } from "./use-open-shifts";
import { zonedDateOf } from "@/lib/work-time/format";
import { useWorkTimeZone } from "@/components/work-time/use-work-time-zone";

// The sheet loads only when someone opens it.
const OpenShiftsFiltersSheet = dynamic(
  () => import("./open-shifts-filters-sheet").then((module) => module.OpenShiftsFiltersSheet),
  { ssr: false },
);

const chip =
  "inline-flex min-h-12 shrink-0 items-center gap-1.5 rounded-md border px-3 text-sm font-medium whitespace-nowrap focus-visible:outline-2 focus-visible:outline-[color:var(--command)]";
const chipOff = `${chip} border-[color:var(--border-strong)] text-[color:var(--text-heading)]`;
const chipOn = `${chip} border-[color:var(--mode-identity)] bg-[color:var(--mode-identity-soft)] text-[color:var(--text-heading)] forced-colors:border-2 forced-colors:border-[Highlight]`;

export function OpenShiftsBrowsePage() {
  const { zone } = useWorkTimeZone();
  const state = useOpenShifts();
  const signedOut = useSignedOut();
  const now = useRosterNow();
  const today = zonedDateOf(now, zone);
  const { end: windowEnd } = windowOf(today);
  const [filters, setFilters] = useState<BrowseFilters>(DEFAULT_FILTERS);
  // Remembered choices (spec B2) apply to your own list only, never the signed-out example.
  const remember = state.status === "ready" && state.sample === null;
  const [restored, setRestored] = useState(false);
  if (remember && !restored) {
    setRestored(true);
    const saved = readSavedFilters();
    if (saved) setFilters(saved);
  }
  function chooseFilters(next: BrowseFilters) {
    setFilters(next);
    if (remember) saveFilters(next);
  }
  function resetFilters() {
    setFilters(DEFAULT_FILTERS);
    clearSavedFilters();
  }
  const [sheetOpen, setSheetOpen] = useState(false);
  // Loaded on first open, then kept mounted so closing can hand focus back to the chip that opened it.
  const [sheetLoaded, setSheetLoaded] = useState(false);
  const openSheet = () => {
    setSheetLoaded(true);
    setSheetOpen(true);
  };
  const [chosenDay, setChosenDay] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  // A list on a phone, the calendar one tap away (12 Oct 2026). From 1024px both show side by side.
  const [view, setView] = useState<"list" | "calendar">("list");

  // The made-up examples are filtered like real ones, against the made-up example roster in the sample data.
  const summary = useMemo(
    () => summariseBrowse(state.listings, state.roster, filters, now, state.rosterStatus),
    [state.listings, state.roster, filters, now, state.rosterStatus],
  );
  const rosteredDays = useMemo(
    () => new Set((state.roster ?? []).map((shift) => perthDateOf(shift.startsAt))),
    [state.roster],
  );
  const coveredUntil = state.roster ? rosterCoveredUntil(state.roster) : null;
  const myGrade = state.listings.find((listing) => listing.myGrade)?.myGrade ?? null;

  const firstMatch = [...summary.perDay.keys()].sort()[0] ?? today;
  const selected = chosenDay ?? (summary.perDay.has(today) ? today : firstMatch);
  const day = dayRows(summary, selected);
  const next = nextMatchingDate(summary, selected);
  const partial = state.failedTeams.length > 0 || state.offline;
  const sample = state.sample !== null;
  const filterCount = activeFilterCount(filters);
  const startsLabel =
    filters.starts.length === 0
      ? "Any time"
      : filters.starts.length === 1
        ? TIME_OF_DAY_LABEL[filters.starts[0]!].label
        : `${filters.starts.length} times`;

  return (
    <div className="mx-auto w-full max-w-reading pb-10" data-mode-identity="open-shifts" data-page-width="wide">
      <PageTitleUnderBand className="px-3 pt-4 text-xl font-semibold text-[color:var(--text-heading)]">
        Open shifts
      </PageTitleUnderBand>
      <ModeBandStatus value={openShiftsStatus(state)} testId="open-shifts-status" />
      {sample && state.status === "ready" ? (
        // The header's Back already returns to My Day, so this line carries only the freshness note.
        <p className="m-0 px-3 pt-3 text-sm text-[color:var(--text-muted)]" data-testid="open-shifts-sample-context">
          {`List updated ${perthTimeOf(now.toISOString())} · roster as of ${formatDayShort(today)}`}
        </p>
      ) : null}

      {state.status === "signed-out" ? (
        <WorkSignInNotice title="Sign in to see open shifts" testId="open-shifts-signed-out" />
      ) : state.status === "no-team" ? (
        <NoTeam />
      ) : state.status === "error" ? (
        <LoadFailed message={state.message} onRetry={state.reload} />
      ) : state.status === "loading" ? (
        <ListSkeleton rows={4} />
      ) : (
        <>
          <div className="min-[1024px]:grid min-[1024px]:grid-cols-[minmax(0,1fr)_24rem] min-[1024px]:items-start min-[1024px]:gap-6">
            <div className="min-w-0">
              {/* Roster and freshness notes sit above the list, so a phone in List view still sees them. */}
              {state.rosterStatus === "error" && !sample ? (
                <Note
                  icon={<TriangleAlert aria-hidden="true" strokeWidth={1.6} className="size-icon-sm" />}
                  tone="warn"
                >
                  <b className="font-semibold">Your roster couldn&apos;t be read,</b> so clashes aren&apos;t checked or
                  hidden.{" "}
                  <button
                    type="button"
                    onClick={state.reload}
                    className="font-medium text-[color:var(--mode-identity)] underline"
                  >
                    Try again
                  </button>
                </Note>
              ) : null}
              {state.rosterStatus === "ready" && (!state.roster || state.roster.length === 0) && !sample ? (
                <Note icon={<CircleHelp aria-hidden="true" strokeWidth={1.6} className="size-icon-sm" />}>
                  <b className="font-semibold text-[color:var(--text-heading)]">No roster to check against.</b> Add your
                  roster so each shift shows whether it clashes.{" "}
                  <Link href="/roster/shifts" className="font-medium text-[color:var(--mode-identity)]">
                    Add your roster
                  </Link>
                </Note>
              ) : coveredUntil && coveredUntil < windowEnd && !sample ? (
                <Note icon={<CircleHelp aria-hidden="true" strokeWidth={1.6} className="size-icon-sm" />}>
                  <b className="font-semibold text-[color:var(--text-heading)]">{`Your roster stops at ${formatDayShort(coveredUntil)}.`}</b>{" "}
                  We can&apos;t check shifts after that until you add more.{" "}
                  <Link href="/roster/shifts" className="font-medium text-[color:var(--mode-identity)]">
                    Update roster
                  </Link>
                </Note>
              ) : null}
              {state.offline && state.readAt ? (
                <Note icon={<Info aria-hidden="true" strokeWidth={1.6} className="size-icon-sm" />}>
                  <b className="font-semibold text-[color:var(--text-heading)]">{`Showing the list from ${perthTimeOf(state.readAt)}.`}</b>{" "}
                  Counts and the roster check may be out of date until you reconnect.
                </Note>
              ) : null}

              <OpenShiftsRequestsStrip listings={state.listings} roster={state.roster} now={now} />
              <OpenShiftsFitsYou rows={fitsYou(summary.matching)} requestable={!signedOut && !sample} />
              <div className="relative">
                <div
                  // `work-chips` gives the one-line sideways scroll and the edge
                  // fade every chip row shares (work-mode.css).
                  className="work-chips px-3 pt-3 pb-1"
                  role="group"
                  aria-label="Quick filters"
                >
                  <button
                    type="button"
                    className={filterCount ? chipOn : chipOff}
                    aria-haspopup="dialog"
                    onClick={openSheet}
                  >
                    <ListFilter aria-hidden="true" strokeWidth={1.6} className="size-icon-sm" />
                    Filters
                    {filterCount ? <span className="nums text-xs">{filterCount}</span> : null}
                  </button>
                  <button
                    type="button"
                    aria-pressed={filters.hideClashes}
                    className={filters.hideClashes ? chipOn : chipOff}
                    onClick={() => chooseFilters({ ...filters, hideClashes: !filters.hideClashes })}
                  >
                    <Shield aria-hidden="true" strokeWidth={1.6} className="size-icon-sm" />
                    No clashes
                  </button>
                  {summary.sites.length > 1 ? (
                    <button
                      type="button"
                      className={filters.siteIds.length ? chipOn : chipOff}
                      aria-haspopup="dialog"
                      onClick={openSheet}
                    >
                      Sites
                      {filters.siteIds.length ? <span className="nums text-xs">{filters.siteIds.length}</span> : null}
                      <ChevronDown aria-hidden="true" strokeWidth={1.6} className="size-icon-xs" />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={filters.includeLowerLevels ? chipOn : chipOff}
                    aria-haspopup="dialog"
                    onClick={openSheet}
                  >
                    {filters.includeLowerLevels ? "All levels" : gradeLabel(myGrade)}
                    <ChevronDown aria-hidden="true" strokeWidth={1.6} className="size-icon-xs" />
                  </button>
                  <button
                    type="button"
                    className={filters.starts.length ? chipOn : chipOff}
                    aria-haspopup="dialog"
                    onClick={openSheet}
                  >
                    {startsLabel}
                    <ChevronDown aria-hidden="true" strokeWidth={1.6} className="size-icon-xs" />
                  </button>
                </div>
                <div className="flex min-h-10 items-center justify-between px-3 text-sm text-[color:var(--text-muted)]">
                  <span>
                    <span className="font-semibold text-[color:var(--text-heading)] nums">
                      {`${partial ? "At least " : ""}${summary.matching.length} of ${summary.total}`}
                    </span>{" "}
                    {`open shifts match · next ${WINDOW_DAYS} days`}
                  </span>
                  {filterCount ? (
                    <button
                      type="button"
                      onClick={resetFilters}
                      className="inline-flex min-h-12 items-center font-medium text-[color:var(--mode-identity)]"
                    >
                      Reset
                    </button>
                  ) : null}
                </div>
              </div>
              <div
                className="mx-3 mt-2 flex gap-1 rounded-lg border border-[color:var(--border)] p-1 min-[1024px]:hidden"
                role="group"
                aria-label="Show as"
              >
                {(["list", "calendar"] as const).map((choice) => (
                  <button
                    key={choice}
                    type="button"
                    aria-pressed={view === choice}
                    onClick={() => setView(choice)}
                    className={`inline-flex min-h-12 flex-1 items-center justify-center rounded-md text-sm font-semibold ${view === choice ? "bg-[color:var(--mode-identity-soft)] text-[color:var(--text-heading)]" : "text-[color:var(--text-muted)]"}`}
                  >
                    {choice === "list" ? "List" : "Calendar"}
                  </button>
                ))}
              </div>
              <div className={view === "list" ? "" : "max-[1023px]:hidden"} data-testid="open-shifts-list">
                <OpenShiftsDayList summary={summary} partial={partial} filtered={filterCount > 0} />
              </div>
            </div>
            <div
              className={`min-w-0 min-[1024px]:sticky min-[1024px]:top-4 ${view === "calendar" ? "" : "max-[1023px]:hidden"}`}
            >
              <OpenShiftsCalendar
                today={today}
                windowEnd={windowEnd}
                selected={selected}
                onSelect={(date) => {
                  setChosenDay(date);
                  setShowHidden(false);
                  // From 1024px the list sits beside the calendar, so a tapped day scrolls the list to it.
                  if (window.matchMedia("(min-width: 1024px)").matches) {
                    document
                      .getElementById(`open-shifts-day-${date}`)
                      ?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }
                }}
                perDay={summary.perDay}
                urgentDays={summary.urgentDays}
                rosteredDays={rosteredDays}
              />
              <ul
                className="m-0 mt-1 flex list-none flex-wrap justify-center gap-x-3 gap-y-1.5 p-0 px-3 text-3xs font-semibold text-[color:var(--text)]"
                aria-label="Calendar key"
              >
                <li className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="nums inline-flex h-[0.9375rem] min-w-[1.375rem] items-center justify-center rounded-full bg-[color:var(--mode-identity-soft)] px-1 text-3xs font-extrabold text-[color:var(--mode-identity)]"
                  >
                    3
                  </span>
                  Shifts that match
                </li>
                <li className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="inline-flex h-[0.9375rem] min-w-[1.375rem] items-center justify-center rounded-full border border-[color:var(--warning-border)] text-[color:var(--warning-text)]"
                  >
                    <TriangleAlert aria-hidden="true" strokeWidth={2.2} className="size-2.5" />
                  </span>
                  Includes an urgent shift
                </li>
                {state.roster && state.roster.length > 0 ? (
                  <li className="inline-flex items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className="inline-block size-3.5 rounded-full shadow-[var(--work-edge-inset-strong)_var(--mode-identity)] forced-colors:border"
                    />
                    You&apos;re rostered
                  </li>
                ) : null}
              </ul>

              {/* The chosen day. From 1024px the list beside the calendar already shows every day. */}
              <div className="min-[1024px]:hidden">
                <div className="mt-4 flex items-baseline justify-between px-3">
                  <h2 className="text-base font-semibold text-[color:var(--text-heading)]">
                    {formatDayLong(selected)}
                  </h2>
                  <span className="text-xs text-[color:var(--text-muted)] nums">
                    {`${partial ? "at least " : ""}${day.shown.length} match`}
                  </span>
                </div>

                {day.shown.length > 0 ? (
                  <FlatList label={`Open shifts on ${formatDayLong(selected)}`}>
                    {day.shown.map((row) => (
                      <ShiftRow
                        key={row.listing.id}
                        listing={row.listing}
                        check={row.check}
                        href={advertHref(row.listing)}
                      />
                    ))}
                  </FlatList>
                ) : (
                  <div className="flex flex-col items-center px-6 py-8 text-center">
                    <CalendarDays
                      aria-hidden="true"
                      strokeWidth={1.6}
                      className="size-icon-lg text-[color:var(--text-muted)]"
                    />
                    <h3 className="mt-3 text-base font-semibold text-[color:var(--text-heading)]">
                      {partial
                        ? "None found on this day in the teams read"
                        : summary.total === 0
                          ? "No open shifts in your teams"
                          : "No shifts match on this day"}
                    </h3>
                    <p className="mt-1 text-sm text-[color:var(--text-muted)]">
                      {!partial && summary.total === 0
                        ? `Nothing is posted for the next ${WINDOW_DAYS} days. New shifts appear here when a roster manager posts them.`
                        : partial
                          ? `Some of your teams couldn't be read, so there may be more.${next ? ` The next day with a match is ${formatDayLong(next)}.` : ""}`
                          : day.hidden.length === 0
                            ? `None are hidden by your filters either.${next ? ` The next day with a match is ${formatDayLong(next)}.` : ""}`
                            : `${day.hidden.length} ${day.hidden.length === 1 ? "is" : "are"} hidden by your filters.`}
                    </p>
                    {next ? (
                      <button
                        type="button"
                        onClick={() => setChosenDay(next)}
                        className="mt-3 inline-flex min-h-12 items-center text-sm font-medium text-[color:var(--mode-identity)]"
                      >
                        {`Go to ${formatDayLong(next)}`}
                      </button>
                    ) : null}
                  </div>
                )}

                {day.hidden.length > 0 ? (
                  <>
                    <div className="mx-3 mt-2 flex min-h-12 items-center justify-between gap-3 border-t border-[color:var(--border)] text-sm text-[color:var(--text-muted)]">
                      <span>
                        {`${day.hidden.length} hidden: ${[
                          day.hiddenClash
                            ? `${day.hiddenClash} ${day.hiddenClash === 1 ? "overlaps" : "overlap"} your roster`
                            : null,
                          day.hiddenLevel
                            ? `${day.hiddenLevel} ${day.hiddenLevel === 1 ? "is" : "are"} for a lower level`
                            : null,
                          day.hidden.length - day.hiddenClash - day.hiddenLevel > 0
                            ? `${day.hidden.length - day.hiddenClash - day.hiddenLevel} outside your site or time choices`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(", ")}`}
                      </span>
                      <button
                        type="button"
                        aria-expanded={showHidden}
                        onClick={() => setShowHidden((value) => !value)}
                        className="inline-flex min-h-12 shrink-0 items-center font-medium text-[color:var(--mode-identity)]"
                      >
                        {showHidden ? "Hide" : "Show"}
                      </button>
                    </div>
                    {showHidden ? (
                      <FlatList label="Hidden shifts">
                        {day.hidden.map((row) => (
                          <ShiftRow
                            key={row.listing.id}
                            listing={row.listing}
                            check={row.check}
                            href={advertHref(row.listing)}
                          />
                        ))}
                      </FlatList>
                    ) : null}
                  </>
                ) : null}
              </div>
            </div>
          </div>

          {signedOut ? <SignInAction label="Sign in to request shifts" /> : null}

          {sheetLoaded ? (
            <OpenShiftsFiltersSheet
              open={sheetOpen}
              onClose={() => setSheetOpen(false)}
              filters={filters}
              onChange={chooseFilters}
              summary={summary}
              myGrade={myGrade}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

/** Every matching shift, day by day: the phone's first view and the desktop's left column. */
/** Days shown before "Show later days", so a phone list stays short. */
const FIRST_DAYS = 5;

function OpenShiftsDayList({
  summary,
  partial,
  filtered,
}: {
  readonly summary: ReturnType<typeof summariseBrowse>;
  /** Some teams couldn't be read, or the list is an offline copy. */
  readonly partial: boolean;
  readonly filtered: boolean;
}) {
  const [all, setAll] = useState(false);
  const allDays = [...summary.perDay.keys()].sort();
  // Later days stay in the page on a computer, where the calendar scrolls to them; a phone shows them on request.
  const later = all ? 0 : Math.max(0, allDays.length - FIRST_DAYS);
  if (allDays.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-sm text-[color:var(--text-muted)]">
        {partial
          ? "None found in the teams read. Some of your teams couldn't be read, so there may be more."
          : summary.total === 0
            ? `Nothing is posted for the next ${WINDOW_DAYS} days. New shifts appear here when a roster manager posts them.`
            : `None match. ${summary.total} ${summary.total === 1 ? "is" : "are"} hidden by ${filtered ? "your filters" : "the clash and level settings"}; open Filters to see ${summary.total === 1 ? "it" : "them"}.`}
      </p>
    );
  }
  return (
    <>
      {allDays.map((date, index) => {
        const { shown } = dayRows(summary, date);
        return (
          <section
            key={date}
            id={`open-shifts-day-${date}`}
            aria-label={formatDayLong(date)}
            className={`scroll-mt-4 ${!all && index >= FIRST_DAYS ? "max-[1023px]:hidden" : ""}`}
          >
            <SectionHeading count={shown.length}>{formatDayLong(date)}</SectionHeading>
            <FlatList label={`Shifts on ${formatDayLong(date)}`}>
              {shown.map((row) => (
                <ShiftRow key={row.listing.id} listing={row.listing} check={row.check} href={advertHref(row.listing)} />
              ))}
            </FlatList>
          </section>
        );
      })}
      {later > 0 ? (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="mx-3 mt-3 inline-flex min-h-12 w-[calc(100%-1.5rem)] min-[1024px]:hidden items-center justify-center rounded-md border border-[color:var(--border)] text-sm font-semibold text-[color:var(--mode-identity)]"
        >
          {`Show ${later} later ${later === 1 ? "day" : "days"}`}
        </button>
      ) : null}
    </>
  );
}
