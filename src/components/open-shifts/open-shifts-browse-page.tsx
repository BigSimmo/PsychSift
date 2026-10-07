"use client";

import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  CircleHelp,
  Info,
  ListFilter,
  Shield,
  TriangleAlert,
} from "lucide-react";
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
import { TIME_OF_DAY_LABEL, gradeLabel, windowOf } from "@/lib/open-shifts/model";
import { rosterCoveredUntil } from "@/lib/open-shifts/roster-check";
import { perthDateOf, perthTimeOf } from "@/lib/roster/shifts/perth-time";

import { OpenShiftsCalendar } from "./open-shifts-calendar";
import { clearSavedFilters, readSavedFilters, saveFilters } from "./open-shifts-saved-filters";
import { useSignedOut } from "@/components/mode-kit/use-signed-out-sample";
import { SignInAction } from "./open-shifts-sign-in";
import { FlatList, ListSkeleton, Note, ShiftRow, advertHref, formatDayLong, formatDayShort } from "./open-shifts-ui";
import { LoadFailed, NoTeam, openShiftsStatus } from "./open-shifts-states";
import { useOpenShifts } from "./use-open-shifts";

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
  const state = useOpenShifts();
  const signedOut = useSignedOut();
  const now = useRosterNow();
  const today = perthDateOf(now);
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
    <div className="mx-auto w-full max-w-reading pb-10" data-mode-identity="open-shifts">
      <PageTitleUnderBand className="px-3 pt-4 text-xl font-semibold text-[color:var(--text-heading)]">
        Open shifts
      </PageTitleUnderBand>
      <ModeBandStatus value={openShiftsStatus(state)} testId="open-shifts-status" />
      {sample && state.status === "ready" ? (
        <div
          className="flex flex-wrap items-center gap-x-3 px-3 pt-1 text-sm text-[color:var(--text-muted)]"
          data-testid="open-shifts-sample-context"
        >
          <Link
            href="/my-day"
            aria-label="Back to My Day"
            className="inline-flex min-h-12 items-center gap-0.5 font-medium text-[color:var(--mode-identity)]"
          >
            <ChevronLeft aria-hidden="true" strokeWidth={1.6} className="size-icon-sm" />
            My Day
          </Link>
          <span>{`Example list updated ${perthTimeOf(now.toISOString())} · example roster as of ${formatDayShort(today)}`}</span>
        </div>
      ) : null}

      {state.status === "signed-out" ? (
        <SignInAction label="Sign in to see open shifts" />
      ) : state.status === "no-team" ? (
        <NoTeam />
      ) : state.status === "error" ? (
        <LoadFailed message={state.message} onRetry={state.reload} />
      ) : state.status === "loading" ? (
        <ListSkeleton rows={4} />
      ) : (
        <>
          <div className="relative">
            <div
              className="flex gap-2 overflow-x-auto px-3 pt-3 pb-1 [scrollbar-width:none]"
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
            {/* A fade at the edge says more chips sit off-screen; the row scrolls without a scrollbar. */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute top-3 right-0 h-12 w-8 bg-gradient-to-l from-[color:var(--background)] to-transparent forced-colors:hidden"
            />
            <div className="flex min-h-10 items-center justify-between px-3 text-sm text-[color:var(--text-muted)]">
              <span>
                <span className="font-semibold text-[color:var(--text-heading)] nums">
                  {`${partial ? "At least " : ""}${summary.matching.length} of ${summary.total}`}
                </span>{" "}
                open shifts match · next 14 days
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

          <OpenShiftsCalendar
            today={today}
            windowEnd={windowEnd}
            selected={selected}
            onSelect={(date) => {
              setChosenDay(date);
              setShowHidden(false);
            }}
            perDay={summary.perDay}
            urgentDays={summary.urgentDays}
            rosteredDays={rosteredDays}
          />
          <ul
            className="m-0 mt-1 flex list-none flex-wrap justify-center gap-x-3 gap-y-1.5 p-0 px-3 text-[0.65625rem] font-semibold text-[color:var(--text)]"
            aria-label="Calendar key"
          >
            <li className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="nums inline-flex h-[0.9375rem] min-w-[1.375rem] items-center justify-center rounded-full bg-[color:var(--mode-identity-soft)] px-1 text-[0.5625rem] font-extrabold text-[color:var(--mode-identity)]"
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

          {state.rosterStatus === "error" && !sample ? (
            <Note icon={<TriangleAlert aria-hidden="true" strokeWidth={1.6} className="size-icon-sm" />} tone="warn">
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

          <div className="mt-4 flex items-baseline justify-between px-3">
            <h2 className="text-base font-semibold text-[color:var(--text-heading)]">{formatDayLong(selected)}</h2>
            <span className="text-xs text-[color:var(--text-muted)] nums">
              {`${partial ? "at least " : ""}${day.shown.length} match`}
            </span>
          </div>

          {day.shown.length > 0 ? (
            <FlatList label={`Open shifts on ${formatDayLong(selected)}`}>
              {day.shown.map((row) => (
                <ShiftRow key={row.listing.id} listing={row.listing} check={row.check} href={advertHref(row.listing)} />
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
                  ? "Nothing is posted for the next 14 days. New shifts appear here when a roster manager posts them."
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
