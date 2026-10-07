"use client";

import { ChevronLeft, ChevronRight, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { cn } from "@/components/ui-primitives";
import { addDaysToDate } from "@/lib/roster/shifts/perth-time";

/**
 * The month on Browse. Each date in the 14-day window carries the number of
 * shifts that match the filters (the same rows as the list below it); a date
 * with an urgent one carries a small warning mark, and a ring on the date
 * means the reader is rostered that day. Past dates and dates outside the
 * window carry no number.
 *
 * Drawn like the Roster month (mockup `.rost-mc rost-oc`, work-mode redesign
 * 6 Oct 2026): a filled tile for the chosen day, a count pill per day (amber,
 * with the warning mark, when it includes an urgent shift) and a ring on the
 * date when you're rostered. The meanings never rest on colour alone: the
 * mark, the number and each day's spoken label carry them too.
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
}: {
  today: string;
  windowEnd: string;
  selected: string;
  onSelect: (date: string) => void;
  perDay: ReadonlyMap<string, number>;
  urgentDays: ReadonlySet<string>;
  rosteredDays: ReadonlySet<string>;
}) {
  const [month, setMonth] = useState(() => monthOf(selected));
  // Follow the chosen day when it moves to another month ("Go to …" can jump past the month shown).
  const [shownFor, setShownFor] = useState(selected);
  if (shownFor !== selected) {
    setShownFor(selected);
    if (monthOf(selected) !== monthOf(shownFor)) setMonth(monthOf(selected));
  }
  const firstMonth = monthOf(today);
  const lastMonth = monthOf(windowEnd);
  const cells = gridFor(month);
  const title = monthTitle.format(new Date(`${month}-01T00:00:00Z`));

  return (
    <section aria-label={`${title} calendar`} className="px-3 pt-2" data-no-tab-swipe>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h2 className="nums text-base-minus font-bold text-[color:var(--text-heading)]">{title}</h2>
        <span className="sr-only" aria-live="polite">
          {title}
        </span>
        <div className="-mr-2 flex">
          <button
            type="button"
            aria-label="Previous month"
            disabled={month <= firstMonth}
            onClick={() => setMonth((value) => shiftMonth(value, -1))}
            className="grid size-12 place-items-center rounded-full text-[color:var(--mode-identity)] focus-visible:outline-2 focus-visible:outline-[color:var(--mode-identity)] disabled:text-[color:var(--disabled)]"
          >
            <ChevronLeft aria-hidden="true" strokeWidth={2.2} className="size-icon-md" />
          </button>
          <button
            type="button"
            aria-label="Next month"
            disabled={month >= lastMonth}
            onClick={() => setMonth((value) => shiftMonth(value, 1))}
            className="grid size-12 place-items-center rounded-full text-[color:var(--mode-identity)] focus-visible:outline-2 focus-visible:outline-[color:var(--mode-identity)] disabled:text-[color:var(--disabled)]"
          >
            <ChevronRight aria-hidden="true" strokeWidth={2.2} className="size-icon-md" />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-y-0.5 text-center">
        <div aria-hidden="true" className="contents">
          {DOW.map((letter, index) => (
            <div
              key={DOW_FULL[index]}
              className="pb-1 text-3xs font-bold tracking-label text-[color:var(--text-muted)]"
            >
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
              const count = inRange ? (perDay.get(date) ?? 0) : 0;
              const urgent = inRange && urgentDays.has(date);
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
                    className={cn(
                      "mx-auto grid min-h-12 w-full max-w-12 content-start justify-items-center gap-0.75 rounded-md pb-1.25 pt-0.75 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--mode-identity)] motion-safe:transition-colors",
                      isSelected &&
                        "bg-[color:var(--mode-identity-soft)] shadow-[var(--work-edge-inset)_var(--mode-identity)] forced-colors:outline-2 forced-colors:-outline-offset-2 forced-colors:outline-[Highlight]",
                    )}
                  >
                    <b
                      aria-hidden="true"
                      className={cn(
                        "nums grid size-[1.5625rem] place-items-center rounded-full text-xs",
                        isToday
                          ? "bg-[color:var(--mode-identity)] font-bold text-[color:var(--mode-identity-contrast)] forced-colors:border"
                          : inMonth && !past
                            ? "font-semibold text-[color:var(--text-heading)]"
                            : "font-normal text-[color:var(--text-muted)]",
                        rostered &&
                          !isToday &&
                          "shadow-[var(--work-edge-inset-strong)_var(--mode-identity)] forced-colors:border forced-colors:border-[CanvasText]",
                      )}
                    >
                      {Number(date.slice(8))}
                    </b>
                    {count || urgent ? (
                      <span
                        aria-hidden="true"
                        className={cn(
                          "nums inline-flex h-[0.9375rem] min-w-[1.375rem] items-center justify-center gap-0.5 rounded-full px-1 text-3xs font-extrabold leading-none",
                          urgent
                            ? "border border-[color:var(--warning-border)] text-[color:var(--warning-text)]"
                            : "bg-[color:var(--mode-identity-soft)] text-[color:var(--mode-identity)]",
                        )}
                      >
                        {urgent ? <TriangleAlert aria-hidden="true" strokeWidth={2.2} className="size-2.5" /> : null}
                        {count ? count : null}
                      </span>
                    ) : (
                      <i aria-hidden="true" className="block h-[0.9375rem]" />
                    )}
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
