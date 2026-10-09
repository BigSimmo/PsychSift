"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import type { KeyboardEvent } from "react";

import { cn } from "@/components/ui-primitives";
import { addDays } from "@/lib/calendar/calendar-event";
import { monthGrid, monthKeyOf } from "@/lib/calendar/month-grid";
import { SHIFT_KIND_LABEL, SHIFT_LETTER, type ShiftKind } from "@/lib/roster/shift-kind";

/**
 * The Roster Month calendar (work-mode redesign, owner request 6 Oct 2026):
 * the mockup's `.rost-mc`. Seven columns, Monday first; each day is a 48px
 * button with its number and a shift-code chip. Today has a filled number,
 * the chosen day a soft tint and a 1px line, past days are quieter, weekends
 * grey. A WA public holiday carries a small "PH" under its chip.
 *
 * Built separately from the shared `CalendarView` on purpose (that one serves
 * On Call and CPD). Months change on the arrows only: a sideways drag here
 * would fight the frame's tab swipe, so the grid opts out of it.
 */

export type RosterMonthDay = {
  readonly kinds: readonly ShiftKind[];
  /** A swap you asked for that would give this day away (drawn dashed). */
  readonly swapAsked?: boolean;
  /** The shift a waiting swap would give you on this day (drawn as a faint dashed chip). */
  readonly ghost?: ShiftKind;
  /** What begins this day besides shifts, e.g. "Consultation liaison starts" (a small corner dot). */
  readonly starts?: readonly string[];
};

const MONTH_LONG = [
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
export const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const HEAD = ["M", "T", "W", "T", "F", "S", "S"] as const;

/** "October 2026". */
export function monthTitle(month: string): string {
  return `${MONTH_LONG[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

/** "Wednesday 7 October". */
export function longDay(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return `${WEEKDAY_LONG[weekday]} ${Number(date.slice(8, 10))} ${MONTH_LONG[Number(date.slice(5, 7)) - 1]}`;
}

function shortDay(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return `${WEEKDAY_SHORT[weekday]} ${Number(date.slice(8, 10))} ${MONTH_LONG[Number(date.slice(5, 7)) - 1]!.slice(0, 3)}`;
}

/**
 * The chip colours, from the shared shift tokens: a soft fill of the shift's
 * own colour with its letter in that colour. The letter is always there, so
 * colour is never the only signal.
 */
export const SHIFT_CHIP_TONE: Record<ShiftKind, string> = {
  day: "bg-[color:color-mix(in_srgb,var(--work-shift-d)_14%,var(--surface-raised))] text-[color:var(--work-shift-d)]",
  evening:
    "bg-[color:color-mix(in_srgb,var(--work-shift-l)_14%,var(--surface-raised))] text-[color:var(--work-shift-l)]",
  night: "bg-[color:color-mix(in_srgb,var(--work-shift-n)_16%,var(--surface-raised))] text-[color:var(--work-shift-n)]",
  on_call:
    "bg-[color:color-mix(in_srgb,var(--work-shift-oc)_14%,var(--surface-raised))] text-[color:var(--work-shift-oc)]",
  leave:
    "bg-[color:color-mix(in_srgb,var(--work-shift-al)_14%,var(--surface-raised))] text-[color:var(--work-shift-al)]",
  other: "bg-[color:var(--surface-wash)] text-[color:var(--text-muted)]",
};

/** One shift-code chip ("D", "N", "OC"). `dashed` marks a shift a swap would change. */
export function RosterShiftChip({
  kind,
  dashed = false,
  className,
}: {
  readonly kind: ShiftKind | null;
  readonly dashed?: boolean;
  readonly className?: string;
}) {
  if (!kind) return <i aria-hidden="true" className={cn("block h-[0.9375rem] min-w-[1.375rem]", className)} />;
  return (
    <i
      aria-hidden="true"
      data-kind={kind}
      className={cn(
        "nums block h-[0.9375rem] min-w-[1.375rem] rounded-sm px-0.75 text-center text-3xs font-extrabold not-italic leading-3.75 tracking-normal forced-colors:border",
        SHIFT_CHIP_TONE[kind],
        dashed && "bg-[color:var(--surface-raised)] outline-dashed outline-[1.3px] -outline-offset-[1.3px]",
        className,
      )}
    >
      {SHIFT_LETTER[kind]}
    </i>
  );
}

const LEGEND_KINDS: readonly ShiftKind[] = ["day", "evening", "night", "on_call", "leave"];

/** The corner dot on a day something begins (a rotation). Not a shift colour, so it never reads as one. */
function RosterStartDot({ className }: { readonly className?: string }) {
  return (
    <i
      aria-hidden="true"
      data-testid="roster-month-start-dot"
      className={cn(
        "block size-1.5 rounded-full bg-[color:var(--mode-identity)] forced-colors:bg-[CanvasText]",
        className,
      )}
    />
  );
}

/**
 * The key under the grid. "Swap asked" only when a dashed chip is on screen,
 * and "Rotation starts" only when a start dot is.
 */
export function RosterMonthLegend({
  swapAsked = false,
  starts = false,
}: {
  readonly swapAsked?: boolean;
  readonly starts?: boolean;
}) {
  return (
    <ul
      className="mt-2.5 flex flex-wrap justify-center gap-x-2.5 gap-y-1.5 text-3xs font-semibold text-[color:var(--text)]"
      aria-label="Key"
    >
      {LEGEND_KINDS.map((kind) => (
        <li key={kind} className="inline-flex items-center gap-1.5">
          <RosterShiftChip kind={kind} className="min-w-5" />
          {SHIFT_KIND_LABEL[kind]}
        </li>
      ))}
      <li className="inline-flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className="nums text-3xs font-extrabold tracking-label text-[color:var(--warning-text)]"
        >
          PH
        </span>
        Public holiday
      </li>
      {swapAsked ? (
        <li className="inline-flex items-center gap-1.5">
          <RosterShiftChip kind="day" dashed className="min-w-5" />
          Swap asked
        </li>
      ) : null}
      {starts ? (
        <li className="inline-flex items-center gap-1.5">
          <RosterStartDot />
          Rotation starts
        </li>
      ) : null}
    </ul>
  );
}

export function RosterMonthGrid({
  month,
  today,
  selected,
  days,
  holidays,
  loadedFrom,
  onSelect,
  onMonthChange,
  previousDisabled = false,
  testId = "roster-month-grid",
}: {
  /** YYYY-MM. */
  readonly month: string;
  readonly today: string;
  readonly selected: string | null;
  /** What is on each date (YYYY-MM-DD). A date missing here is a day off. */
  readonly days: ReadonlyMap<string, RosterMonthDay>;
  readonly holidays: ReadonlySet<string>;
  /** The first date whose shifts were loaded. Earlier days say so rather than looking free. */
  readonly loadedFrom?: string | null;
  readonly onSelect: (date: string) => void;
  readonly onMonthChange: (step: -1 | 1) => void;
  /** No arrow back past what the roster can load. */
  readonly previousDisabled?: boolean;
  readonly testId?: string;
}) {
  const weeks = monthGrid(month);
  // One Tab stop for the whole month: the chosen day, else today, else the 1st.
  const tabDate =
    selected && monthKeyOf(selected) === month ? selected : monthKeyOf(today) === month ? today : `${month}-01`;
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const from = (event.target as HTMLElement).closest<HTMLElement>("[data-date]")?.dataset.date;
    if (!from) return;
    const weekday = (new Date(`${from}T00:00:00Z`).getUTCDay() + 6) % 7;
    const step: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
      Home: -weekday,
      End: 6 - weekday,
    };
    if (!(event.key in step)) return;
    const next = addDays(from, step[event.key]!);
    const target = event.currentTarget.querySelector<HTMLElement>(`[data-date="${next}"]`);
    if (!target) return;
    event.preventDefault();
    target.focus();
  }
  return (
    <div data-testid={testId} data-no-tab-swipe="">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h2 className="nums text-base-minus font-bold text-[color:var(--text-heading)]">{monthTitle(month)}</h2>
        {/* The month change is announced by a hidden twin, never by the visible heading (SPEC §9.2). */}
        <span className="sr-only" aria-live="polite">
          {monthTitle(month)}
        </span>
        <div className="-mr-2 flex">
          <button
            type="button"
            aria-label="Previous month"
            aria-disabled={previousDisabled || undefined}
            onClick={() => {
              if (!previousDisabled) onMonthChange(-1);
            }}
            className="grid size-12 place-items-center rounded-full text-[color:var(--mode-identity)] focus-visible:outline-2 focus-visible:outline-[color:var(--mode-identity)] aria-disabled:text-[color:var(--disabled)]"
          >
            <ChevronLeft aria-hidden="true" strokeWidth={2.2} className="size-icon-md" />
          </button>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => onMonthChange(1)}
            className="grid size-12 place-items-center rounded-full text-[color:var(--mode-identity)] focus-visible:outline-2 focus-visible:outline-[color:var(--mode-identity)]"
          >
            <ChevronRight aria-hidden="true" strokeWidth={2.2} className="size-icon-md" />
          </button>
        </div>
      </div>
      <div
        role="grid"
        aria-label={`Your shifts, ${monthTitle(month)}`}
        className="grid gap-y-0.5"
        onKeyDown={onKeyDown}
      >
        <div role="row" className="grid grid-cols-7 text-center">
          {HEAD.map((label, index) => (
            <span
              key={index}
              role="columnheader"
              aria-label={WEEKDAY_LONG[(index + 1) % 7]}
              className="pb-1 text-3xs font-bold tracking-label text-[color:var(--text-muted)]"
            >
              {label}
            </span>
          ))}
        </div>
        {weeks.map((week) => (
          <div role="row" key={week[0]!.date} className="grid grid-cols-7">
            {week.map(({ date, inMonth }, index) => {
              if (!inMonth) return <span key={date} role="gridcell" aria-hidden="true" />;
              const entry = days.get(date);
              const kinds = entry?.kinds ?? [];
              const notLoaded = Boolean(loadedFrom && date < loadedFrom);
              const isToday = date === today;
              const isSelected = date === selected;
              const past = date < today;
              const weekend = index > 4;
              const holiday = holidays.has(date);
              const words = notLoaded
                ? "not loaded"
                : kinds.length
                  ? kinds.map((kind) => SHIFT_KIND_LABEL[kind]).join(" and ")
                  : "Off";
              const label = [
                `${shortDay(date)}: ${words}`,
                entry?.swapAsked ? "swap asked" : null,
                entry?.ghost && !kinds.length
                  ? `a swap would give you ${SHIFT_KIND_LABEL[entry.ghost].toLowerCase()}`
                  : null,
                holiday ? "WA public holiday" : null,
                ...(entry?.starts ?? []),
                isToday ? "today" : null,
              ]
                .filter(Boolean)
                .join(", ");
              return (
                <span key={date} role="gridcell" className="grid">
                  <button
                    type="button"
                    aria-label={label}
                    aria-pressed={isSelected}
                    aria-current={isToday ? "date" : undefined}
                    onClick={() => onSelect(date)}
                    tabIndex={date === tabDate ? 0 : -1}
                    data-date={date}
                    className={cn(
                      "relative grid min-h-12 content-start justify-items-center gap-0.75 rounded-md pb-1.25 pt-0.75 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--mode-identity)] motion-safe:transition-colors",
                      isSelected &&
                        "bg-[color:var(--mode-identity-soft)] shadow-[var(--work-edge-inset)_var(--mode-identity)] forced-colors:border",
                    )}
                  >
                    <b
                      aria-hidden="true"
                      className={cn(
                        "nums grid size-[1.5625rem] place-items-center rounded-full text-xs font-semibold",
                        isToday
                          ? "bg-[color:var(--mode-identity)] font-bold text-[color:var(--mode-identity-contrast)] forced-colors:border"
                          : past || notLoaded
                            ? "text-[color:var(--text-muted)]"
                            : weekend
                              ? "text-[color:var(--text-muted)]"
                              : "text-[color:var(--text-heading)]",
                      )}
                    >
                      {Number(date.slice(8, 10))}
                    </b>
                    {notLoaded ? (
                      <i
                        aria-hidden="true"
                        className="block h-[0.9375rem] text-3xs leading-3.75 not-italic text-[color:var(--text-muted)]"
                      >
                        ·
                      </i>
                    ) : (
                      <RosterShiftChip
                        kind={kinds[0] ?? entry?.ghost ?? null}
                        dashed={entry?.swapAsked || (!kinds.length && Boolean(entry?.ghost))}
                      />
                    )}
                    {entry?.starts?.length ? <RosterStartDot className="absolute right-1 top-1" /> : null}
                    {holiday ? (
                      <span
                        aria-hidden="true"
                        className="-mt-0.5 text-3xs font-extrabold leading-none tracking-label text-[color:var(--warning-text)]"
                      >
                        PH
                      </span>
                    ) : null}
                  </button>
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
