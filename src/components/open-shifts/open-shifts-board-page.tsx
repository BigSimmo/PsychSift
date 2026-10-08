"use client";

import { ChevronLeft, ChevronRight, Plus, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { WorkButton, WorkCard, WorkChip, WorkChips, WorkIconRow, WorkSectionLabel } from "@/components/mode-kit/work";
import { useRosterNow } from "@/components/roster/roster-format";
import { boardWeek, type BoardCellStatus } from "@/lib/open-shifts/board";
import { addDaysToDate, perthDateOf, perthTimeOf } from "@/lib/roster/shifts/perth-time";

import { SignInAction } from "./open-shifts-sign-in";
import { LoadFailed, NoTeam } from "./open-shifts-states";
import {
  ListSkeleton,
  OPEN_SHIFTS_HREF,
  SubHeader,
  formatDayShort,
  formatShiftTimes,
  postedShiftHref,
} from "./open-shifts-ui";
import { usePostedShifts } from "./use-posted-shifts";
import { zonedDateOf } from "@/lib/work-time/format";
import { useWorkTimeZone } from "@/components/work-time/use-work-time-zone";

const STATUS: Readonly<Record<BoardCellStatus, { label: string; className: string }>> = {
  requested: {
    label: "Requested",
    className: "border-[color:var(--mode-identity)] bg-[color:var(--mode-identity-soft)]",
  },
  open: { label: "Open", className: "border-[color:var(--border-strong)] bg-[color:var(--surface-raised)]" },
  unfilled: {
    label: "Unfilled, next 48 h",
    className: "border-[color:var(--text-heading)] bg-[color:var(--surface-raised)]",
  },
  filled: { label: "Filled", className: "border-[color:var(--border)] bg-[color:var(--surface-subtle)]" },
  reported: { label: "Reported", className: "border-[color:var(--warning-border)] bg-[color:var(--surface-raised)]" },
};

type BoardFilter = "all" | BoardCellStatus;

const FILTERS: readonly { id: BoardFilter; label: string; none: string }[] = [
  { id: "all", label: "All", none: "posted" },
  { id: "open", label: "Open", none: "open" },
  { id: "requested", label: "Requested", none: "requested" },
  { id: "unfilled", label: "Unfilled", none: "unfilled in the next 48 h" },
  { id: "filled", label: "Filled", none: "filled" },
  { id: "reported", label: "Reported", none: "reported" },
];

/** The week board for roster managers: their teams' open shifts by site and day, on a wide screen. */
export function OpenShiftsBoardPage() {
  const { zone } = useWorkTimeZone();
  const state = usePostedShifts();
  const nowMs = useRosterNow().getTime();
  const today = zonedDateOf(nowMs, zone);
  const [weekOffset, setWeekOffset] = useState(0);
  // Board chips (mockup `rost_board`, work-mode redesign 6 Oct 2026): counts add up to All.
  const [filter, setFilter] = useState<BoardFilter>("all");
  const week = useMemo(
    () => boardWeek(state.shifts, addDaysToDate(today, weekOffset * 7), new Date(nowMs)),
    [state.shifts, today, weekOffset, nowMs],
  );
  const weekTitle = `${formatDayShort(week.days[0]!)} to ${formatDayShort(week.days[6]!)}`;
  const rows = useMemo(
    () =>
      filter === "all"
        ? week.rows
        : week.rows
            .map((row) => ({ ...row, cells: row.cells.map((cell) => cell.filter((item) => item.status === filter)) }))
            .filter((row) => row.cells.some((cell) => cell.length > 0)),
    [week.rows, filter],
  );
  const unfilled = useMemo(
    () =>
      week.rows
        .flatMap((row) =>
          row.cells
            .flat()
            .flatMap((item) => (item.status === "unfilled" ? [{ ...item, site: row.site, team: row.team }] : [])),
        )
        .sort((a, b) => a.shift.startsAt.localeCompare(b.shift.startsAt)),
    [week.rows],
  );
  const active = FILTERS.find((item) => item.id === filter)!;

  return (
    <div className="mx-auto w-full max-w-6xl pb-10" data-mode-identity="open-shifts">
      <SubHeader
        backHref={`${OPEN_SHIFTS_HREF}/post`}
        backLabel="Post"
        title="Week board"
        action={
          <Link
            href="/open-shifts/post/new"
            className="mr-2 inline-flex min-h-12 items-center gap-1.5 rounded-md bg-[color:var(--work-primary,var(--mode-identity))] px-4 text-sm font-semibold text-[color:var(--work-primary-text,var(--mode-identity-contrast))] no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--command)]"
          >
            <Plus aria-hidden="true" strokeWidth={1.6} className="size-icon-sm" />
            Post a shift
          </Link>
        }
      />
      {state.status === "loading" ? (
        <ListSkeleton rows={5} />
      ) : state.status === "error" ? (
        <LoadFailed what="Your posted shifts" message={state.message} onRetry={state.reload} />
      ) : state.status === "signed-out" ? (
        <SignInAction label="Sign in to see the week board" />
      ) : state.status === "no-team" ? (
        <NoTeam />
      ) : state.status !== "ready" ? (
        <p className="px-3 py-8 text-sm text-[color:var(--text-muted)]">
          Only a team&apos;s roster managers can see the week board.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 px-3 pt-2">
            <div className="flex items-center">
              <button
                type="button"
                aria-label="Previous week"
                onClick={() => setWeekOffset((value) => value - 1)}
                className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-md focus-visible:outline-2 focus-visible:outline-[color:var(--command)]"
              >
                <ChevronLeft aria-hidden="true" strokeWidth={1.6} className="size-icon-md" />
              </button>
              <h2 className="text-base font-semibold nums text-[color:var(--text-heading)]">{weekTitle}</h2>
              <span className="sr-only" aria-live="polite">
                {weekTitle}
              </span>
              <button
                type="button"
                aria-label="Next week"
                onClick={() => setWeekOffset((value) => value + 1)}
                className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-md focus-visible:outline-2 focus-visible:outline-[color:var(--command)]"
              >
                <ChevronRight aria-hidden="true" strokeWidth={1.6} className="size-icon-md" />
              </button>
            </div>
            <WorkChips label="Show on the board" scroll>
              {FILTERS.filter((item) => item.id !== "reported" || week.counts.reported > 0).map((item) => (
                <WorkChip
                  key={item.id}
                  selected={filter === item.id}
                  onClick={() => setFilter(item.id)}
                  count={week.counts[item.id]}
                  testId={`open-shifts-board-chip-${item.id}`}
                >
                  {item.label}
                </WorkChip>
              ))}
            </WorkChips>
          </div>

          {week.rows.length === 0 ? (
            <p className="px-3 py-8 text-sm text-[color:var(--text-muted)]">
              {state.failedTeams.length > 0
                ? `None this week in the teams read. Couldn't read ${state.failedTeams.join(", ")}.`
                : "No shifts posted this week."}
            </p>
          ) : rows.length === 0 ? (
            <div className="grid justify-items-start gap-2 px-3 py-6" data-testid="open-shifts-board-none">
              <p className="m-0 text-sm text-[color:var(--text-muted)]">None {active.none} this week.</p>
              <WorkButton variant="quiet" onClick={() => setFilter("all")}>
                Show all
              </WorkButton>
            </div>
          ) : (
            <div className="mt-3 overflow-x-auto px-3">
              <table className="w-full min-w-4xl table-fixed border-collapse text-sm">
                <caption className="sr-only">Posted shifts by site and day</caption>
                <thead>
                  <tr>
                    <th
                      scope="col"
                      className="w-40 border-b border-[color:var(--border)] py-2 text-left text-xs font-semibold text-[color:var(--text-muted)]"
                    >
                      Site
                    </th>
                    {week.days.map((day) => (
                      <th
                        key={day}
                        scope="col"
                        className={`border-b border-[color:var(--border)] py-2 text-left text-xs font-semibold nums ${day === today ? "text-[color:var(--mode-identity)]" : "text-[color:var(--text-muted)]"}`}
                      >
                        {formatDayShort(day).replace(/ \S+$/, "")}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.key}>
                      <th scope="row" className="border-b border-[color:var(--border)] py-2 pr-2 text-left align-top">
                        <span className="block font-medium text-[color:var(--text-heading)]">{row.site}</span>
                        <span className="block text-xs font-normal text-[color:var(--text-muted)]">{row.team}</span>
                      </th>
                      {row.cells.map((cell, index) => (
                        <td
                          key={week.days[index]}
                          className="border-b border-[color:var(--border)] px-1 py-2 align-top"
                        >
                          <ul className="flex flex-col gap-1">
                            {cell.map(({ shift, status }) => (
                              <li key={shift.id}>
                                <Link
                                  href={postedShiftHref(shift.serviceId, shift.id)}
                                  aria-label={`${STATUS[status].label}, ${formatShiftTimes(shift.startsAt, shift.endsAt)}${shift.claimantName ? `, ${shift.claimantName}` : ""}`}
                                  className={`flex min-h-12 flex-col justify-center rounded-md border px-2 py-1 no-underline focus-visible:outline-2 focus-visible:outline-[color:var(--command)] ${STATUS[status].className}`}
                                >
                                  <span className="text-2xs font-semibold uppercase tracking-label text-[color:var(--text-muted)]">
                                    {status === "unfilled" ? "Unfilled" : STATUS[status].label}
                                  </span>
                                  <span className="nums text-xs text-[color:var(--text-heading)]">
                                    {`${perthTimeOf(shift.startsAt)} to ${perthTimeOf(shift.endsAt)}`}
                                  </span>
                                  {shift.claimantName ? (
                                    <span className="truncate text-xs text-[color:var(--text-muted)]">
                                      {shift.claimantName}
                                    </span>
                                  ) : null}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {unfilled.length ? (
            <section
              className="grid gap-2 px-3 pt-4"
              aria-labelledby="open-shifts-board-unfilled"
              data-testid="open-shifts-board-unfilled"
            >
              <WorkSectionLabel id="open-shifts-board-unfilled" count={unfilled.length}>
                Unfilled, next 48 h
              </WorkSectionLabel>
              <WorkCard as="ul">
                {unfilled.map(({ shift, site, team }) => (
                  <li key={shift.id}>
                    <WorkIconRow
                      icon={TriangleAlert}
                      tone="amber"
                      title={`${formatDayShort(perthDateOf(shift.startsAt))} · ${perthTimeOf(shift.startsAt)} to ${perthTimeOf(shift.endsAt)}`}
                      sub={[site, team].filter(Boolean).join(" · ")}
                      href={postedShiftHref(shift.serviceId, shift.id)}
                    />
                  </li>
                ))}
              </WorkCard>
            </section>
          ) : null}
          <p className="px-3 pt-3 text-xs text-[color:var(--text-muted)]">
            Shows shifts posted in Open shifts only, not the whole roster.
          </p>
        </>
      )}
    </div>
  );
}
