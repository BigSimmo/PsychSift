import { SHIFT_KIND_LABEL, SHIFT_LETTER, type ShiftKind } from "@/lib/roster/shift-kind";
import type { RosterDisplayShift as OnCallShift } from "@/lib/roster/team/team-view";
import { addDaysToDate, formatPerthDay } from "@/lib/roster/shifts/perth-time";
import { cn } from "@/components/ui-primitives";

import { kindOf } from "./roster-format";
import { zonedDateOf } from "@/lib/work-time/format";
import { useWorkTimeZone } from "@/components/work-time/use-work-time-zone";

/**
 * This week as seven letter squares (Today), and as a 24-hour chart (Shifts).
 * The squares are greys only, as chosen: darker for nights, outlined for on
 * call, a dashed edge for leave. The letter is always there, so shape and fill
 * are never the only signal. The chart fills its bars in the roster violet
 * (deepest for nights) so a shift reads as a block, not an empty outline.
 */

const LETTER_SHAPE: Record<ShiftKind, string> = {
  day: "border-[color:var(--border)] bg-[color:var(--surface-subtle)] text-[color:var(--text-heading)]",
  evening: "border-[color:var(--border-strong)] bg-[color:var(--surface-wash)] text-[color:var(--text-heading)]",
  night: "border-[color:var(--command)] bg-[color:var(--command)] text-[color:var(--command-contrast)]",
  on_call: "border-[color:var(--text-heading)] bg-[color:var(--surface-raised)] text-[color:var(--text-heading)]",
  leave: "border-dashed border-[color:var(--border-strong)] bg-[color:var(--surface-raised)] text-[color:var(--text)]",
  other: "border-[color:var(--border)] bg-[color:var(--surface-subtle)] text-[color:var(--text-heading)]",
};

/** One letter square. With no kind it is a quiet dash: a day with nothing on. */
export function RosterLetter({ kind, className }: { readonly kind: ShiftKind | null; readonly className?: string }) {
  if (!kind) {
    return (
      <span
        aria-hidden="true"
        className={cn("grid size-8 shrink-0 place-items-center text-sm text-[color:var(--text-muted)]", className)}
      >
        –
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      data-kind={kind}
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-md border text-sm font-normal forced-colors:border",
        LETTER_SHAPE[kind],
        className,
      )}
    >
      {SHIFT_LETTER[kind]}
    </span>
  );
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function weekdayOf(date: string): string {
  return WEEKDAY[new Date(`${date}T00:00:00Z`).getUTCDay()]!;
}

/** Seven columns: weekday, date number, letter square. Today is marked with a ring and `aria-current`. */
export function RosterWeekStrip({
  week,
  today,
  testId,
}: {
  readonly week: readonly { readonly date: string; readonly kinds: readonly ShiftKind[] }[];
  readonly today: string;
  readonly testId?: string;
}) {
  return (
    <ol className="grid grid-cols-7 gap-1" data-testid={testId}>
      {week.map(({ date, kinds }) => {
        const kind = kinds[0] ?? null;
        const words = kinds.length ? kinds.map((item) => SHIFT_KIND_LABEL[item]).join(" and ") : "Nothing on";
        const isToday = date === today;
        return (
          <li
            key={date}
            aria-current={isToday ? "date" : undefined}
            aria-label={`${formatPerthDay(date)}: ${words}`}
            className="grid justify-items-center gap-1"
          >
            <span
              aria-hidden="true"
              className={cn(
                "nums text-xs leading-4",
                isToday ? "text-[color:var(--text-heading)]" : "text-[color:var(--text-muted)]",
              )}
            >
              {weekdayOf(date)}
            </span>
            <span
              aria-hidden="true"
              data-mode-identity={isToday ? "roster" : undefined}
              className={cn(
                "nums grid size-6 place-items-center rounded-full text-xs",
                isToday
                  ? "bg-[color:var(--mode-identity)] text-[color:var(--mode-identity-contrast)] forced-colors:border"
                  : "text-[color:var(--text-muted)]",
              )}
            >
              {Number(date.slice(8, 10))}
            </span>
            <RosterLetter kind={kind} />
          </li>
        );
      })}
    </ol>
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

/* Read inside the chart's `data-mode-identity="roster"` scope, so these are the violet tokens. */
const BAR_SHAPE: Record<ShiftKind, string> = {
  day: "border-[color:var(--mode-identity)] bg-[color:var(--mode-identity-border)]",
  evening: "border-[color:var(--mode-identity)] bg-[color:var(--mode-identity-border)]",
  night: "border-[color:var(--mode-identity)] bg-[color:var(--mode-identity)]",
  on_call: "border-[color:var(--mode-identity)] bg-[color:var(--mode-identity-soft)]",
  leave: "border-dashed border-[color:var(--mode-identity)] bg-[color:var(--mode-identity-soft)]",
  other: "border-[color:var(--mode-identity)] bg-[color:var(--mode-identity-border)]",
};

type Segment = { key: string; top: number; height: number; kind: ShiftKind };

function segmentsFor(date: string, shifts: readonly OnCallShift[]): Segment[] {
  const dayStart = Date.parse(`${date}T00:00:00+08:00`);
  const dayEnd = dayStart + DAY_MS;
  return shifts.flatMap((shift) => {
    const start = Math.max(Date.parse(shift.startsAt), dayStart);
    const end = Math.min(Date.parse(shift.endsAt), dayEnd);
    if (end <= start) return [];
    return [
      {
        key: `${shift.id}-${date}`,
        top: ((start - dayStart) / DAY_MS) * 100,
        height: ((end - start) / DAY_MS) * 100,
        kind: kindOf(shift),
      },
    ];
  });
}

/**
 * Seven days on a 24-hour axis, 00 at the top. A night that crosses midnight
 * is drawn on both days it touches; its hours still belong to the day it
 * starts, which is what the agenda underneath says. Now is one line.
 */
export function RosterWeekChart({
  monday,
  shifts,
  now,
  testId,
}: {
  readonly monday: string;
  readonly shifts: readonly OnCallShift[];
  readonly now: Date;
  readonly testId?: string;
}) {
  const { zone } = useWorkTimeZone();
  const days = Array.from({ length: 7 }, (_, index) => addDaysToDate(monday, index));
  const today = zonedDateOf(now, zone);
  const nowTop = ((now.getTime() - Date.parse(`${today}T00:00:00+08:00`)) / DAY_MS) * 100;
  return (
    <div
      className="grid grid-cols-[1.75rem_repeat(7,minmax(0,1fr))] gap-1"
      aria-hidden="true"
      data-mode-identity="roster"
      data-testid={testId}
    >
      <span />
      {days.map((date) => (
        <span
          key={date}
          className={cn(
            "nums text-center text-xs",
            date === today ? "font-semibold text-[color:var(--mode-identity)]" : "text-[color:var(--text-muted)]",
          )}
        >
          {weekdayOf(date).slice(0, 1)} {Number(date.slice(8, 10))}
        </span>
      ))}
      <span className="relative h-48">
        {["00", "06", "12", "18", "24"].map((hour, index) => (
          <span
            key={hour}
            className="nums absolute left-0 -translate-y-1/2 text-xs text-[color:var(--text-muted)]"
            style={{ top: `${index * 25}%` }}
          >
            {hour}
          </span>
        ))}
      </span>
      {days.map((date) => (
        <span
          key={date}
          data-today={date === today ? "" : undefined}
          className={cn(
            "relative h-48 overflow-hidden rounded-md border bg-[color:var(--surface-raised)]",
            date === today ? "border-[color:var(--mode-identity)]" : "border-[color:var(--border)]",
          )}
        >
          {segmentsFor(date, shifts).map((segment) => (
            <span
              key={segment.key}
              className={cn("absolute inset-x-1 rounded-sm border", BAR_SHAPE[segment.kind])}
              style={{ top: `${segment.top}%`, height: `${segment.height}%` }}
            />
          ))}
          {date === today ? (
            <span className="absolute inset-x-0 h-px bg-[color:var(--clinical-accent)]" style={{ top: `${nowTop}%` }} />
          ) : null}
        </span>
      ))}
    </div>
  );
}
