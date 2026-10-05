"use client";

import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { boardWeek, type BoardCellStatus } from "@/lib/open-shifts/board";
import { addDaysToDate, perthDateOf, perthTimeOf } from "@/lib/roster/shifts/perth-time";

import { LoadFailed } from "./open-shifts-states";
import {
  ListSkeleton,
  OPEN_SHIFTS_HREF,
  SubHeader,
  formatDayShort,
  formatShiftTimes,
  postedShiftHref,
} from "./open-shifts-ui";
import { usePostedShifts } from "./use-posted-shifts";

const STATUS: Readonly<Record<BoardCellStatus, { label: string; className: string }>> = {
  requested: {
    label: "Requested",
    className: "border-[color:var(--mode-identity)] bg-[color:var(--mode-identity-soft)]",
  },
  open: { label: "Open", className: "border-[color:var(--border-strong)] bg-[color:var(--surface-raised)]" },
  unfilled: {
    label: "Unfilled, next 48 h",
    className: "border-[color:var(--danger-border)] bg-[color:var(--surface-raised)]",
  },
  filled: { label: "Filled", className: "border-[color:var(--border)] bg-[color:var(--surface-subtle)]" },
  reported: { label: "Reported", className: "border-[color:var(--warning-border)] bg-[color:var(--surface-raised)]" },
};

/** The week board for roster managers: their teams' open shifts by site and day, on a wide screen. */
export function OpenShiftsBoardPage() {
  const state = usePostedShifts();
  const [nowMs] = useState(() => Date.now());
  const today = perthDateOf(new Date(nowMs));
  const [weekOffset, setWeekOffset] = useState(0);
  const week = useMemo(
    () => boardWeek(state.shifts, addDaysToDate(today, weekOffset * 7), new Date(nowMs)),
    [state.shifts, today, weekOffset, nowMs],
  );

  return (
    <div className="mx-auto w-full max-w-6xl pb-10" data-mode-identity="open-shifts">
      <SubHeader
        backHref={`${OPEN_SHIFTS_HREF}/post`}
        backLabel="Post"
        title="Week board"
        action={
          <Link
            href={`${OPEN_SHIFTS_HREF}/post/new`}
            className="mr-2 inline-flex min-h-12 items-center gap-1.5 rounded-md bg-[color:var(--command)] px-4 text-sm font-semibold text-[color:var(--command-contrast)] no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--command)]"
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
              <h2 className="text-base font-semibold nums text-[color:var(--text-heading)]" aria-live="polite">
                {`${formatDayShort(week.days[0]!)} to ${formatDayShort(week.days[6]!)}`}
              </h2>
              <button
                type="button"
                aria-label="Next week"
                onClick={() => setWeekOffset((value) => value + 1)}
                className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-md focus-visible:outline-2 focus-visible:outline-[color:var(--command)]"
              >
                <ChevronRight aria-hidden="true" strokeWidth={1.6} className="size-icon-md" />
              </button>
            </div>
            <ul
              className="flex flex-wrap gap-x-5 gap-y-1 text-sm nums text-[color:var(--text-muted)]"
              aria-label="This week"
            >
              <li>
                <b className="font-semibold text-[color:var(--text-heading)]">{week.counts.all}</b> posted
              </li>
              <li>
                <b className="font-semibold text-[color:var(--text-heading)]">{week.counts.open}</b> open
              </li>
              <li>
                <b className="font-semibold text-[color:var(--text-heading)]">{week.counts.requested}</b> requested
              </li>
              <li>
                <b className="font-semibold text-[color:var(--danger-text)]">{week.counts.unfilled}</b> unfilled, next
                48 h
              </li>
              <li>
                <b className="font-semibold text-[color:var(--text-heading)]">{week.counts.filled}</b> filled
              </li>
            </ul>
          </div>

          {week.rows.length === 0 ? (
            <p className="px-3 py-8 text-sm text-[color:var(--text-muted)]">No shifts posted this week.</p>
          ) : (
            <div className="mt-3 overflow-x-auto px-3">
              <table className="w-full min-w-[56rem] table-fixed border-collapse text-sm">
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
                  {week.rows.map((row) => (
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
                                  <span className="text-2xs font-semibold uppercase tracking-[0.06em] text-[color:var(--text-muted)]">
                                    {status === "unfilled" ? "Unfilled" : STATUS[status].label}
                                  </span>
                                  <span className="nums text-xs text-[color:var(--text-heading)]">
                                    {`${perthTimeOf(shift.startsAt)}–${perthTimeOf(shift.endsAt)}`}
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
          <p className="px-3 pt-3 text-xs text-[color:var(--text-muted)]">
            Shows shifts posted in Open shifts only, not the whole roster.
          </p>
        </>
      )}
    </div>
  );
}
