"use client";

import { CalendarDays, ChevronDown, CircleHelp, Info, ListFilter, Shield, TriangleAlert } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";

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
  const now = useMemo(() => new Date(), []);
  const today = perthDateOf(now);
  const { end: windowEnd } = windowOf(today);
  const [filters, setFilters] = useState<BrowseFilters>(DEFAULT_FILTERS);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [chosenDay, setChosenDay] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);

  const summary = useMemo(
    () => summariseBrowse(state.listings, state.roster, filters, now, state.rosterStatus),
    [state.listings, state.roster, filters, now, state.rosterStatus],
  );
  const rosteredDays = useMemo(
    () => new Set(state.sample ? [] : (state.roster ?? []).map((shift) => perthDateOf(shift.startsAt))),
    [state.roster, state.sample],
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

      {state.status === "no-team" ? (
        <NoTeam />
      ) : state.status === "error" ? (
        <LoadFailed message={state.message} onRetry={state.reload} />
      ) : state.status === "loading" ? (
        <ListSkeleton rows={4} />
      ) : (
        <>
          {!sample ? (
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
                  onClick={() => setSheetOpen(true)}
                >
                  <ListFilter aria-hidden="true" strokeWidth={1.6} className="size-icon-sm" />
                  Filters
                  {filterCount ? <span className="nums text-xs">{filterCount}</span> : null}
                </button>
                <button
                  type="button"
                  aria-pressed={filters.hideClashes}
                  className={filters.hideClashes ? chipOn : chipOff}
                  onClick={() => setFilters({ ...filters, hideClashes: !filters.hideClashes })}
                >
                  <Shield aria-hidden="true" strokeWidth={1.6} className="size-icon-sm" />
                  No clashes
                </button>
                {summary.sites.length > 1 ? (
                  <button
                    type="button"
                    className={filters.siteIds.length ? chipOn : chipOff}
                    aria-haspopup="dialog"
                    onClick={() => setSheetOpen(true)}
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
                  onClick={() => setSheetOpen(true)}
                >
                  {filters.includeLowerLevels ? "All levels" : gradeLabel(myGrade)}
                  <ChevronDown aria-hidden="true" strokeWidth={1.6} className="size-icon-xs" />
                </button>
                <button
                  type="button"
                  className={filters.starts.length ? chipOn : chipOff}
                  aria-haspopup="dialog"
                  onClick={() => setSheetOpen(true)}
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
                  open shifts match · next 14 days
                </span>
                {filterCount ? (
                  <button
                    type="button"
                    onClick={() => setFilters(DEFAULT_FILTERS)}
                    className="inline-flex min-h-12 items-center font-medium text-[color:var(--mode-identity)]"
                  >
                    Reset
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

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
          <div className="flex flex-wrap gap-x-4 gap-y-1 px-3 pt-2 text-xs text-[color:var(--text-muted)]">
            <span>
              {sample ? "Number under a date: open shifts" : "Number under a date: shifts that match your filters"}
            </span>
            <span className="inline-flex items-center gap-1">
              <TriangleAlert
                aria-hidden="true"
                strokeWidth={1.6}
                className="size-icon-xs text-[color:var(--danger-text)]"
              />
              Includes an urgent shift
            </span>
            {state.roster && state.roster.length > 0 ? (
              <span className="inline-flex items-center gap-1">
                <span
                  aria-hidden="true"
                  className="inline-block h-0.5 w-3 rounded-full bg-[color:var(--info,var(--command))]"
                />
                You&apos;re rostered
              </span>
            ) : null}
          </div>

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
              {sample ? `${day.shown.length} open` : `${partial ? "at least " : ""}${day.shown.length} match`}
            </span>
          </div>

          {day.shown.length > 0 ? (
            <FlatList label={`Open shifts on ${formatDayLong(selected)}`}>
              {day.shown.map((row) => (
                <ShiftRow
                  key={row.listing.id}
                  listing={row.listing}
                  check={sample ? null : row.check}
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
                {partial ? "None found on this day in the teams read" : "No shifts match on this day"}
              </h3>
              <p className="mt-1 text-sm text-[color:var(--text-muted)]">
                {partial
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

          {day.hidden.length > 0 && !sample ? (
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

          {state.sample === "signed-out" ? <SignInAction label="Sign in to request shifts" /> : null}

          {sheetOpen ? (
            <OpenShiftsFiltersSheet
              open={sheetOpen}
              onClose={() => setSheetOpen(false)}
              filters={filters}
              onChange={setFilters}
              summary={summary}
              matchingCount={summary.matching.length}
              myGrade={myGrade}
              rosterAsOf={null}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
