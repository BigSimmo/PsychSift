"use client";

import { cn } from "@/components/ui-primitives";
import { buildCmeWeekBars, type CmeWeekBar } from "@/lib/cme/pace";
import type { CmeEntry } from "@/lib/cme/types";

/**
 * "EACH WEEK": the year's hours as one thin bar per seven-day span from
 * 1 January, grouped under the month each span starts in (the 5 Oct mock-up).
 *
 * Grey bars are weeks gone by (a hairline stub when nothing was logged), this
 * week is the one accent mark, and weeks still to come are a dashed baseline.
 * Colour never judges: a tall bar is not "good" and a stub is not "bad".
 * The picture is hidden from screen readers, which get the month totals in
 * words instead.
 */

const MONTH_LETTERS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"] as const;
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const MS_PER_DAY = 86_400_000;

/** The month (0–11) a week starts in: week `index` starts `7 × index` days after 1 January. */
function weekStartMonth(year: number, index: number): number {
  return new Date(Date.UTC(year, 0, 1) + index * 7 * MS_PER_DAY).getUTCMonth();
}

// Literal classes (tenths of the 30px track) so a bar's height needs no inline style.
const BAR_HEIGHTS = [
  "h-[10%]",
  "h-[20%]",
  "h-[30%]",
  "h-[40%]",
  "h-[50%]",
  "h-[60%]",
  "h-[70%]",
  "h-[80%]",
  "h-[90%]",
  "h-full",
] as const;

/** A logged week's height against the year's tallest week: never below a tenth, so it never reads as empty. */
function weekBarHeight(hours: number, tallest: number): string {
  const step = Math.round((Math.min(hours, tallest) / tallest) * 10);
  return BAR_HEIGHTS[Math.max(1, step) - 1];
}

function formatHours(hours: number): string {
  return Number(hours.toFixed(2)).toString();
}

export type CmeMonthOfWeeks = {
  readonly month: number;
  readonly weeks: readonly CmeWeekBar[];
  /** Hours logged in the calendar month itself (by activity date), for the words. */
  readonly hours: number;
  readonly current: boolean;
};

/** The year's week bars, grouped by the month each week starts in, with each month's own total. */
export function groupCmeWeeksByMonth(entries: readonly CmeEntry[], year: number, today: string): CmeMonthOfWeeks[] {
  const bars = buildCmeWeekBars(entries, year, today);
  const monthHours = Array.from({ length: 12 }, () => 0);
  for (const entry of entries) {
    if (entry.archivedAt || !entry.date.startsWith(`${year}-`)) continue;
    const month = Number.parseInt(entry.date.slice(5, 7), 10) - 1;
    if (month < 0 || month > 11) continue;
    monthHours[month] += entry.allocations.reduce((sum, allocation) => sum + allocation.hours, 0);
  }
  const currentMonth = today.startsWith(`${year}-`) ? Number.parseInt(today.slice(5, 7), 10) - 1 : -1;
  return MONTH_NAMES.map((_, month) => ({
    month,
    weeks: bars.filter((bar) => weekStartMonth(year, bar.index) === month),
    hours: Math.round(monthHours[month] * 100) / 100,
    current: month === currentMonth,
  }));
}

/** Months that have started, in words: "January 3.5 h; February 1.5 h; …". */
function monthWords(months: readonly CmeMonthOfWeeks[], year: number, today: string): string {
  const lastMonth = today < `${year}-01-01` ? -1 : today > `${year}-12-31` ? 11 : Number(today.slice(5, 7)) - 1;
  return months
    .filter(({ month }) => month <= lastMonth)
    .map(({ month, hours }) => `${MONTH_NAMES[month]} ${formatHours(hours)} h`)
    .join("; ");
}

export function CmeYearInWeeks({
  entries,
  year,
  today,
  testId = "cme-year-in-weeks",
}: {
  readonly entries: readonly CmeEntry[];
  readonly year: number;
  /** Perth calendar date, `YYYY-MM-DD`. */
  readonly today: string;
  readonly testId?: string;
}) {
  const months = groupCmeWeeksByMonth(entries, year, today);
  const tallest = Math.max(1, ...months.flatMap(({ weeks }) => weeks.map(({ hours }) => hours)));
  const words = monthWords(months, year, today);

  return (
    <div data-testid={testId} className="min-w-0">
      <div aria-hidden="true" className="grid grid-cols-12 items-end gap-1">
        {months.map(({ month, weeks, current }) => (
          <div key={month} className="grid justify-items-center gap-1">
            <span className="flex h-7.5 items-end gap-0.5">
              {weeks.map((week) => (
                <i
                  key={week.index}
                  data-testid="cme-week-bar"
                  data-state={week.state}
                  data-hours={week.hours}
                  className={cn(
                    "block w-0.75 rounded-xs forced-colors:bg-[CanvasText]",
                    week.state === "now"
                      ? "h-full bg-[color:var(--clinical-accent)]"
                      : week.state === "future"
                        ? "h-0.5 border-b border-dashed border-[color:var(--border-strong)] bg-transparent forced-colors:bg-transparent"
                        : week.hours > 0
                          ? cn("bg-[color:var(--border-strong)]", weekBarHeight(week.hours, tallest))
                          : "h-0.5 bg-[color:var(--border)]",
                  )}
                />
              ))}
            </span>
            <small
              className={cn(
                "text-2xs leading-none",
                current ? "font-semibold text-[color:var(--text-heading)]" : "text-[color:var(--text-muted)]",
              )}
            >
              {MONTH_LETTERS[month]}
            </small>
          </div>
        ))}
      </div>
      {words ? <span className="sr-only">{`Hours by month: ${words}.`}</span> : null}
    </div>
  );
}
