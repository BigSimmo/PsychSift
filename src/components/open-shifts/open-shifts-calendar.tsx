"use client";

import { ChevronLeft, ChevronRight, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { addDaysToDate } from "@/lib/roster/shifts/perth-time";

/**
 * The month on Browse. Each date in the 14-day window carries the number of
 * shifts that match the filters (the same rows as the list below it); a date
 * with an urgent one carries a small warning mark, and a line under the date
 * means the reader is rostered that day. Past dates and dates outside the
 * window carry no number.
 */

const monthTitle = new Intl.DateTimeFormat("en-AU", { month: "long", year: "numeric", timeZone: "UTC" });
const DOW = ["M", "T", "W", "T", "F", "S", "S"];
const DOW_FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function monthOf(date: string): string {
  return date.slice(0, 7);
}

function shiftMonth(month: string, by: number): string {
  const [year, m] = month.split("-").map(Number);
  const next = new Date(Date.UTC(year!, m! - 1 + by, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Monday-first grid of dates covering the month. */
function gridFor(month: string): string[] {
  const first = `${month}-01`;
  const weekday = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  const [year, m] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year!, m!, 0)).getUTCDate();
  const total = Math.ceil((weekday + daysInMonth) / 7) * 7;
  const start = addDaysToDate(first, -weekday);
  return Array.from({ length: total }, (_, index) => addDaysToDate(start, index));
}

export function OpenShiftsCalendar({
  today,
  windowEnd,
  selected,
  onSelect,
  perDay,
  urgentDays,
  rosteredDays,
  showCounts = true,
}: {
  today: string;
  windowEnd: string;
  selected: string;
  onSelect: (date: string) => void;
  perDay: ReadonlyMap<string, number>;
  urgentDays: ReadonlySet<string>;
  rosteredDays: ReadonlySet<string>;
  showCounts?: boolean;
}) {
  const [month, setMonth] = useState(() => monthOf(selected));
  const firstMonth = monthOf(today);
  const lastMonth = monthOf(windowEnd);
  const cells = gridFor(month);
  const title = monthTitle.format(new Date(`${month}-01T00:00:00Z`));

  return (
    <section aria-label={`${title} calendar`} className="px-3 pt-2">
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous month"
          disabled={month <= firstMonth}
          onClick={() => setMonth((value) => shiftMonth(value, -1))}
          className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-md text-[color:var(--text-heading)] disabled:text-[color:var(--disabled)]"
        >
          <ChevronLeft aria-hidden="true" strokeWidth={1.6} className="size-icon-md" />
        </button>
        <h2 className="text-base font-semibold text-[color:var(--text-heading)]" aria-live="polite">
          {title}
        </h2>
        <button
          type="button"
          aria-label="Next month"
          disabled={month >= lastMonth}
          onClick={() => setMonth((value) => shiftMonth(value, 1))}
          className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-md text-[color:var(--text-heading)] disabled:text-[color:var(--disabled)]"
        >
          <ChevronRight aria-hidden="true" strokeWidth={1.6} className="size-icon-md" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-y-1 text-center">
        <div aria-hidden="true" className="contents">
          {DOW.map((letter, index) => (
            <div key={DOW_FULL[index]} className="py-1 text-2xs font-medium text-[color:var(--text-muted)]">
              {letter}
            </div>
          ))}
        </div>
        {Array.from({ length: cells.length / 7 }, (_, week) => (
          <div className="contents" key={cells[week * 7]}>
            {cells.slice(week * 7, week * 7 + 7).map((date) => {
              const inMonth = monthOf(date) === month;
              const past = date < today;
              const inRange = date >= today && date <= windowEnd;
              const count = showCounts && inRange ? (perDay.get(date) ?? 0) : 0;
              const urgent = showCounts && inRange && urgentDays.has(date);
              const rostered = rosteredDays.has(date) && !past;
              const isSelected = date === selected;
              const isToday = date === today;
              const label = [
                new Date(`${date}T12:00:00Z`).toLocaleDateString("en-AU", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  timeZone: "UTC",
                }),
                count ? `${count} ${count === 1 ? "shift matches" : "shifts match"}` : null,
                urgent ? "includes an urgent shift" : null,
                rostered ? "you're rostered" : null,
                isToday ? "today" : null,
              ]
                .filter(Boolean)
                .join(", ");
              return (
                <div key={date}>
                  <button
                    type="button"
                    aria-label={label}
                    aria-current={isToday ? "date" : undefined}
                    aria-pressed={isSelected}
                    disabled={!inRange}
                    onClick={() => onSelect(date)}
                    className={`mx-auto flex min-h-12 w-full max-w-12 flex-col items-center justify-center gap-0.5 rounded-md text-sm nums ${
                      isSelected
                        ? "bg-[color:var(--mode-identity-soft)] font-semibold text-[color:var(--text-heading)] outline outline-1 outline-[color:var(--mode-identity)] forced-colors:border-2 forced-colors:border-[Highlight]"
                        : inMonth && !past
                          ? "font-medium text-[color:var(--text-heading)]"
                          : "font-normal text-[color:var(--text-soft)]"
                    } ${isToday && !isSelected ? "text-[color:var(--mode-identity)]" : ""}`}
                  >
                    <span>{Number(date.slice(8))}</span>
                    <span className="flex h-3.5 items-center gap-0.5 text-3xs font-medium text-[color:var(--text-muted)]">
                      {urgent ? (
                        <TriangleAlert
                          aria-hidden="true"
                          strokeWidth={1.6}
                          className="size-2.5 text-[color:var(--danger-text)]"
                        />
                      ) : null}
                      {count ? count : null}
                    </span>
                    <span
                      aria-hidden="true"
                      className={`h-0.5 w-4 rounded-full [forced-color-adjust:none] ${rostered ? "bg-[color:var(--info,var(--command))] forced-colors:bg-[CanvasText]" : "bg-transparent"}`}
                    />
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}
