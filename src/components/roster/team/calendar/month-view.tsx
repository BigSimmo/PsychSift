"use client";

import { focusRing } from "@/components/card-recipes";
import { cn } from "@/components/ui-primitives";
import { WEEKDAY_SHORT_LABELS } from "@/lib/calendar/month-grid";
import { SHIFT_KINDS, SHIFT_LETTER, SHIFT_LETTER_TONE } from "@/lib/roster/shift-kind";
import { formatPerthDay } from "@/lib/roster/shifts/perth-time";
import type { MonthCell } from "@/lib/roster/team/calendar-model";
import { coverText, type CoverCount } from "@/lib/roster/team/cover";

import { COVER_TONE } from "./cover-tone";

const LETTERS_SHOWN = 3;

/** A day's shifts by kind, in the usual kind order, for the full (lg and print) cell. */
function byKind(shifts: MonthCell["shifts"]) {
  return SHIFT_KINDS.map((kind) => [kind, shifts.filter((shift) => shift.kind === kind)] as const).filter(
    ([, list]) => list.length > 0,
  );
}

function cellLabel(cell: MonthCell, counts: readonly CoverCount[]): string {
  const parts = [formatPerthDay(cell.date)];
  parts.push(...counts.map(coverText));
  if (cell.shifts.length) parts.push(`${cell.shifts.length} ${cell.shifts.length === 1 ? "shift" : "shifts"}`);
  if (cell.mine.length) parts.push("including yours");
  if (cell.holiday) parts.push("Public holiday");
  return parts.join(", ");
}

/**
 * The month as a grid of Monday-first weeks. On a phone each day shows up to
 * three shift letters and "+n" for the rest; from `lg`, and always on paper,
 * each day lists every shift grouped by kind with names. Print has its own
 * rule rather than trusting `lg` to fire at A4 width. A shift sits on the day
 * it starts, so a night is never counted twice. Tapping a day hands its date
 * to `onPickDay`.
 */
export function MonthView({
  cells,
  onPickDay,
  today,
  cover,
}: {
  cells: MonthCell[][];
  onPickDay: (date: string) => void;
  today?: string;
  /** Manager cover counts by date; without it the cells show no counts. */
  cover?: Map<string, CoverCount[]>;
}) {
  return (
    <div role="grid" aria-label="Month" className="grid gap-px">
      <div role="row" className="grid grid-cols-7 text-center">
        {WEEKDAY_SHORT_LABELS.map((label) => (
          <span key={label} role="columnheader" className="pb-1 text-xs text-[color:var(--text-muted)]">
            {label}
          </span>
        ))}
      </div>
      {cells.map((week) => (
        <div key={week[0].date} role="row" className="grid grid-cols-7 gap-px">
          <span role="rowheader" className="sr-only">
            Week of {formatPerthDay(week[0].date)}
          </span>
          {week.map((cell) => {
            const extra = cell.shifts.length - LETTERS_SHOWN;
            return (
              <div
                key={cell.date}
                role="gridcell"
                data-date={cell.date}
                data-mine={cell.mine.length ? "true" : undefined}
                className={cn(
                  // Ring owns the cell outline so a non-mine cell still has a
                  // border; the "mine" branch swaps the ring width and colour
                  // rather than layering a second edge (the design-system
                  // contract forbids border + ring on the same element).
                  cell.mine.length > 0
                    ? "min-w-0 rounded-lg bg-[color:var(--surface-wash)] ring-2 ring-inset ring-[color:var(--mode-identity)]"
                    : "min-w-0 rounded-lg ring-1 ring-inset ring-[color:var(--border)]",
                )}
                data-dim={cell.inMonth ? undefined : ""}
              >
                <button
                  type="button"
                  aria-label={cellLabel(cell, cover?.get(cell.date) ?? [])}
                  onClick={() => onPickDay(cell.date)}
                  className={cn(
                    focusRing,
                    "flex min-h-12 w-full min-w-0 flex-col items-stretch gap-0.5 rounded-lg p-1 text-left text-xs lg:min-h-24",
                  )}
                >
                  <span className="flex items-center justify-between gap-1">
                    <span className={cn("nums text-sm", cell.date === today && "font-semibold")}>
                      {Number(cell.date.slice(8))}
                    </span>
                    {cell.holiday ? (
                      <span aria-hidden="true" className="text-3xs text-[color:var(--text-muted)]">
                        PH
                      </span>
                    ) : null}
                  </span>
                  {cell.holiday ? <span className="sr-only">Public holiday</span> : null}
                  <span data-month-summary className="flex min-w-0 flex-wrap gap-x-1 lg:hidden print:hidden">
                    {cell.shifts.slice(0, LETTERS_SHOWN).map((shift) => (
                      <span
                        key={shift.id}
                        data-shift-letter
                        className={cn("nums font-medium", SHIFT_LETTER_TONE[shift.kind])}
                      >
                        {SHIFT_LETTER[shift.kind]}
                      </span>
                    ))}
                    {extra > 0 ? <span className="nums text-[color:var(--text-muted)]">{`+${extra}`}</span> : null}
                  </span>
                  <span data-month-full className="hidden min-w-0 gap-0.5 lg:grid print:grid">
                    {byKind(cell.shifts).map(([kind, list]) => (
                      <span key={kind} data-kind-group className="flex min-w-0 items-baseline gap-1">
                        <span className={cn("nums shrink-0 font-medium", SHIFT_LETTER_TONE[kind])}>
                          {SHIFT_LETTER[kind]}
                        </span>
                        <span className="min-w-0 break-words">
                          {list
                            .map((shift) => (cell.mine.includes(shift) ? "You" : (shift.name ?? "Name not available")))
                            .join(", ")}
                        </span>
                      </span>
                    ))}
                  </span>
                  {(cover?.get(cell.date) ?? []).map((count) => (
                    <span
                      key={count.kind}
                      data-cover={count.state}
                      className={cn(
                        "nums rounded border px-0.5 text-3xs",
                        COVER_TONE[count.state],
                        count.state === "met" && "text-[color:var(--text-muted)]",
                      )}
                    >
                      <span className="sr-only">{coverText(count)}</span>
                      <span aria-hidden="true">
                        {SHIFT_LETTER[count.kind]} {count.rostered}/{count.needed}
                      </span>
                    </span>
                  ))}
                </button>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
