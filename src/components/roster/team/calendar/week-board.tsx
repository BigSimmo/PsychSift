"use client";

import { TriangleAlert } from "lucide-react";

import { focusRing } from "@/components/card-recipes";
import { formatShiftRange } from "@/components/roster/roster-format";
import { cn } from "@/components/ui-primitives";
import { isWaPublicHolidayDate } from "@/lib/on-call/wa-public-holidays";
import { SHIFT_KIND_LABEL, SHIFT_LETTER } from "@/lib/roster/shift-kind";
import { formatPerthDay, perthDateOf } from "@/lib/roster/shifts/perth-time";
import { coverText, type CoverCount } from "@/lib/roster/team/cover";
import { COVER_STATE_WORDS, COVER_TONE } from "./cover-tone";
import type { RosterAssignment, RosterOpenShift } from "@/lib/roster/team/model";
import type { RuleFlag } from "@/lib/roster/team/rule-flags";
import type { BoardRow } from "@/lib/roster/team/calendar-model";

const AMBER = "border-[color:var(--warning-border)] bg-[color:var(--warning-bg)] text-[color:var(--warning-text)]";
const HAIRLINE = "border-b border-[color:var(--border)]";

/** Open shifts still waiting on someone, or waiting on a manager's decision. */
const SHOWN_OPEN_STATUSES: readonly RosterOpenShift["status"][] = ["open", "claimed"];

function shiftLabel(row: RosterAssignment, name: string, notes: readonly string[]): string {
  return [`${name}, ${SHIFT_KIND_LABEL[row.kind]} ${formatShiftRange(row)}`, ...notes].join(", ");
}

/**
 * The week as one row per person and one column per day, scrolling sideways on
 * a phone with the names column pinned. Each shift sits on the day it starts;
 * an overnight shift shows "+1" for its end and is never repeated on the next day.
 *
 * `cover` is keyed by date and `flags` by assignment id; both are optional, and
 * without them the board shows no counts and no flags.
 */
export function WeekBoard({
  rows,
  days,
  onPickShift,
  cover,
  flags,
  pendingSwapIds,
  openShifts,
}: {
  rows: BoardRow[];
  days: string[];
  onPickShift: (row: RosterAssignment) => void;
  cover?: Map<string, CoverCount[]>;
  flags?: Map<string, RuleFlag[]>;
  pendingSwapIds?: ReadonlySet<string>;
  openShifts?: readonly RosterOpenShift[];
}) {
  const open = (openShifts ?? []).filter(
    (shift) => SHOWN_OPEN_STATUSES.includes(shift.status) && days.includes(perthDateOf(shift.startsAt)),
  );
  const showCover = cover && days.some((date) => (cover.get(date)?.length ?? 0) > 0);
  const rowHeader = "sticky left-0 z-10 w-28 min-w-28 max-w-28 bg-background px-2 py-1 text-left align-middle";
  // `relative` keeps the absolutely placed screen-reader text inside the board's
  // own scroll; without it that text escapes and widens the page on a phone.
  return (
    <div className="relative overflow-x-auto">
      <table aria-label="Week roster" className="w-full min-w-[46rem] border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th scope="col" className={cn(rowHeader, HAIRLINE, "text-xs font-normal text-[color:var(--text-muted)]")}>
              <span className="sr-only">Person</span>
            </th>
            {days.map((date) => (
              <th
                key={date}
                scope="col"
                className={cn(HAIRLINE, "min-w-24 px-1 py-1 text-xs font-normal text-[color:var(--text-muted)]")}
              >
                <span className="block">{formatPerthDay(date).split(" ").slice(0, 2).join(" ")}</span>
                {isWaPublicHolidayDate(date) ? <span className="block">Public holiday</span> : null}
              </th>
            ))}
          </tr>
          {/* Cover sits just under the dates, so on a phone it is seen with the days
              it counts; the row exists only when at least one day has a count. */}
          {showCover ? (
            <tr data-testid="week-cover">
              <th scope="row" className={cn(rowHeader, HAIRLINE, "text-xs font-medium")}>
                Cover
              </th>
              {days.map((date) => (
                <td key={date} className={cn(HAIRLINE, "min-w-24 px-1 py-1 align-top")}>
                  <ul className="grid gap-0.5 text-xs">
                    {(cover.get(date) ?? []).map((count) => (
                      <li
                        key={count.kind}
                        data-cover={count.state}
                        className={cn("nums rounded border px-1", COVER_TONE[count.state])}
                      >
                        {coverText(count)}
                        {count.state !== "met" ? (
                          <span className="sr-only">{COVER_STATE_WORDS[count.state]}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </td>
              ))}
            </tr>
          ) : null}
        </thead>
        <tbody>
          {rows.map((person) => {
            const name = person.isMe ? "You" : person.name;
            return (
              <tr key={person.userId ?? `open:${person.name}`}>
                <th scope="row" className={cn(rowHeader, HAIRLINE)}>
                  <span className="block break-words font-medium">{name}</span>
                  {person.grade ? (
                    <span className="block text-xs font-normal capitalize text-[color:var(--text-muted)]">
                      {person.grade}
                    </span>
                  ) : null}
                </th>
                {days.map((date, index) => (
                  <td key={date} className={cn(HAIRLINE, "min-w-24 px-1 py-1 align-top")}>
                    <div className="grid gap-1">
                      {person.days[index]?.map((shift) => {
                        const flagged = flags?.get(shift.id) ?? [];
                        const pending = pendingSwapIds?.has(shift.id) ?? false;
                        return (
                          <button
                            key={shift.id}
                            type="button"
                            aria-label={shiftLabel(shift, name, [
                              ...(pending ? ["swap pending"] : []),
                              ...flagged.map((flag) => flag.words),
                            ])}
                            data-pending-swap={pending ? "true" : undefined}
                            data-flagged={flagged.length ? "true" : undefined}
                            title={flagged.map((flag) => flag.words).join(" ") || undefined}
                            onClick={() => onPickShift(shift)}
                            className={cn(
                              focusRing,
                              "flex min-h-12 w-full min-w-0 flex-col items-start justify-center rounded border px-1.5 py-1 text-left",
                              pending
                                ? "border-dashed border-[color:var(--mode-identity)]"
                                : "border-[color:var(--border)]",
                              person.isMe && "bg-[color:var(--surface-wash)]",
                            )}
                          >
                            <span aria-hidden="true" className="flex items-center gap-1 font-medium">
                              {SHIFT_LETTER[shift.kind]}
                              {flagged.length ? (
                                <TriangleAlert aria-hidden="true" className="size-icon-xs shrink-0" />
                              ) : null}
                            </span>
                            <span aria-hidden="true" className="nums text-xs">
                              {formatShiftRange(shift)}
                            </span>
                            {pending ? (
                              <span aria-hidden="true" className="text-xs">
                                Swap pending
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </td>
                ))}
              </tr>
            );
          })}
          {open.length ? (
            <tr data-testid="week-open-shifts">
              <th scope="row" className={cn(rowHeader, HAIRLINE, "font-medium")}>
                Open shifts
              </th>
              {days.map((date) => (
                <td key={date} className={cn(HAIRLINE, "min-w-24 px-1 py-1 align-top")}>
                  <div className="grid gap-1">
                    {open
                      .filter((shift) => perthDateOf(shift.startsAt) === date)
                      .map((shift) => (
                        <div
                          key={shift.id}
                          data-open-shift
                          className={cn("grid min-h-12 content-center rounded border px-1.5 py-1", AMBER)}
                        >
                          <span className="font-medium">Open shift</span>
                          <span className="nums text-xs">
                            {SHIFT_LETTER[shift.kind]} {formatShiftRange(shift)}
                          </span>
                          {shift.status === "claimed" ? <span className="text-xs">Claimed</span> : null}
                        </div>
                      ))}
                  </div>
                </td>
              ))}
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
