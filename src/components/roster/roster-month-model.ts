import { addDays } from "@/lib/calendar/calendar-event";
import { monthKeyOf } from "@/lib/calendar/month-grid";
import type { ShiftKind } from "@/lib/roster/shift-kind";
import { perthDateOf, perthTimeOf } from "@/lib/roster/shifts/perth-time";

/**
 * Month tab and Payslip check figures (work-mode redesign, owner request
 * 6 Oct 2026). Pure, so every count can be pinned by a test. They read only
 * the shifts the page already loaded and the WA public holiday list; nothing
 * here guesses a figure the roster does not hold.
 */

export type MonthShift = {
  readonly id: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly kind: ShiftKind;
};

export type MonthDayEntry = { readonly kinds: ShiftKind[]; readonly ids: string[] };

const WORK_KINDS: ReadonlySet<ShiftKind> = new Set(["day", "evening", "night", "on_call", "other"]);

/** The last day an entry touches: one ending at midnight does not reach the next day. */
function lastDateOf(shift: MonthShift): string {
  return perthDateOf(new Date(Date.parse(shift.endsAt) - 1).toISOString());
}

/**
 * What is on each day. A working shift belongs to the day it starts (as the
 * agenda and hours say); leave covers every day it spans.
 */
export function rosterDays(shifts: readonly MonthShift[]): Map<string, MonthDayEntry> {
  const days = new Map<string, MonthDayEntry>();
  const add = (date: string, shift: MonthShift) => {
    const entry = days.get(date) ?? { kinds: [], ids: [] };
    if (!entry.ids.includes(shift.id)) {
      entry.kinds.push(shift.kind);
      entry.ids.push(shift.id);
    }
    days.set(date, entry);
  };
  const sorted = [...shifts].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  for (const shift of sorted) {
    const first = perthDateOf(shift.startsAt);
    if (shift.kind !== "leave") {
      add(first, shift);
      continue;
    }
    // A runaway entry is capped at 62 days, the longest span the roster exports.
    const last = lastDateOf(shift);
    for (let date = first, guard = 0; date <= last && guard < 62; date = addDays(date, 1), guard += 1) add(date, shift);
  }
  return days;
}

export type MonthTotals = {
  readonly day: number;
  readonly evening: number;
  readonly night: number;
  readonly on_call: number;
  /** Days in the month with nothing rostered and no leave. */
  readonly off: number;
  /** WA public holidays in the month on which you have a working shift. */
  readonly holidaysWorked: number;
  /** The first counted date when the start of the month is before what loaded; null when the whole month counts. */
  readonly countedFrom: string | null;
};

/** Counts for one month: shifts by kind, days off, and public holidays worked. */
export function monthTotals(
  shifts: readonly MonthShift[],
  month: string,
  holidays: ReadonlySet<string>,
  loadedFrom: string | null,
): MonthTotals {
  const counts = { day: 0, evening: 0, night: 0, on_call: 0 };
  const first = `${month}-01`;
  const countedFrom = loadedFrom && loadedFrom > first && monthKeyOf(loadedFrom) === month ? loadedFrom : null;
  const start = countedFrom ?? first;
  for (const shift of shifts) {
    const date = perthDateOf(shift.startsAt);
    if (monthKeyOf(date) !== month || date < start) continue;
    if (shift.kind in counts) counts[shift.kind as keyof typeof counts] += 1;
  }
  const days = rosterDays(shifts);
  let off = 0;
  let holidaysWorked = 0;
  for (let date = start; monthKeyOf(date) === month; date = addDays(date, 1)) {
    const kinds = days.get(date)?.kinds ?? [];
    if (kinds.length === 0) off += 1;
    if (holidays.has(date) && kinds.some((kind) => WORK_KINDS.has(kind))) holidaysWorked += 1;
  }
  return { ...counts, off, holidaysWorked, countedFrom };
}

export type ComingNights = {
  readonly first: MonthShift;
  readonly count: number;
  readonly dates: readonly string[];
};

/** The next run of nights (consecutive night shifts), from now on. */
export function nextNights(shifts: readonly MonthShift[], now: Date): ComingNights | null {
  const nights = shifts
    .filter((shift) => shift.kind === "night" && Date.parse(shift.endsAt) > now.getTime())
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const first = nights[0];
  if (!first) return null;
  const dates = [perthDateOf(first.startsAt)];
  for (const shift of nights.slice(1)) {
    const date = perthDateOf(shift.startsAt);
    if (date === dates[dates.length - 1]) continue;
    if (date !== addDays(dates[dates.length - 1]!, 1)) break;
    dates.push(date);
  }
  return { first, count: dates.length, dates };
}

export type ComingLeave = {
  readonly shift: MonthShift;
  readonly from: string;
  readonly to: string;
  readonly days: number;
};

/** The next leave that has not ended, with its span in days. */
export function nextLeave(shifts: readonly MonthShift[], now: Date): ComingLeave | null {
  const leave = shifts
    .filter((shift) => shift.kind === "leave" && Date.parse(shift.endsAt) > now.getTime())
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];
  if (!leave) return null;
  const from = perthDateOf(leave.startsAt);
  const to = lastDateOf(leave) < from ? from : lastDateOf(leave);
  let days = 1;
  for (let date = from; date < to && days < 400; date = addDays(date, 1)) days += 1;
  return { shift: leave, from, to, days };
}

export type PayslipFigures = {
  readonly shifts: number;
  readonly nights: number;
  readonly onCall: number;
  readonly weekend: number;
  readonly holidays: number;
};

/**
 * What a payslip should reflect for one pay fortnight, counted from the
 * roster: working shifts, nights, on-call shifts, shifts that start on a
 * Saturday or Sunday, and shifts that start on a WA public holiday. Leave is
 * not a shift. Hours come from the existing hours summary, not from here.
 */
export function payslipFigures(
  shifts: readonly MonthShift[],
  fortnight: { readonly start: string; readonly end: string },
  holidays: ReadonlySet<string>,
): PayslipFigures {
  let total = 0;
  let nights = 0;
  let onCall = 0;
  let weekend = 0;
  let onHolidays = 0;
  for (const shift of shifts) {
    if (shift.kind === "leave") continue;
    const date = perthDateOf(shift.startsAt);
    if (date < fortnight.start || date > fortnight.end) continue;
    total += 1;
    if (shift.kind === "night") nights += 1;
    if (shift.kind === "on_call") onCall += 1;
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (weekday === 0 || weekday === 6) weekend += 1;
    if (holidays.has(date)) onHolidays += 1;
  }
  return { shifts: total, nights, onCall, weekend, holidays: onHolidays };
}

/** "Fri 16 and Sat 17", "Fri 16 to Sun 18". */
export function runWords(dates: readonly string[], dayWords: (date: string) => string): string {
  if (dates.length === 1) return dayWords(dates[0]!);
  if (dates.length === 2) return `${dayWords(dates[0]!)} and ${dayWords(dates[1]!)}`;
  return `${dayWords(dates[0]!)} to ${dayWords(dates[dates.length - 1]!)}`;
}

/** "21:00 to 08:30" for a shift, with no date. */
export function clockSpan(shift: MonthShift): string {
  return `${perthTimeOf(shift.startsAt)} to ${perthTimeOf(shift.endsAt)}`;
}
