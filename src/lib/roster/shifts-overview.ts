import { isWorkedKind, SHIFT_KIND_LABEL, type ShiftKind } from "@/lib/roster/shift-kind";
import { WEEKDAYS, addDaysToDate, perthDateOf, perthTimeOf } from "@/lib/roster/shifts/perth-time";

/**
 * The words on Roster Shifts, worked out once from the doctor's own shifts so
 * the page only draws them: the shift that leads the page (on now, or next),
 * and the week as one row per day. A shift belongs to the day it starts; one
 * that ends on a later day names that day ("21:00 to Sat 08:00"). A day with
 * no shift is "Off", and says so when a night ended that morning.
 */

export type OverviewShift = {
  readonly id: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly kind: ShiftKind;
  readonly place: string | null;
};

const HOUR_MS = 3_600_000;

function weekdayOf(date: string): string {
  return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]!;
}

/** "14:00 to 22:30", or "21:00 to Sat 08:00" when it ends on a later Perth day. */
export function shiftSpan(shift: Pick<OverviewShift, "startsAt" | "endsAt">): string {
  const startDate = perthDateOf(shift.startsAt);
  const endDate = perthDateOf(shift.endsAt);
  const end = perthTimeOf(shift.endsAt);
  // A shift ending exactly at midnight ends on its own day, as a printed roster reads it.
  const later = endDate !== startDate && !(end === "00:00" && addDaysToDate(startDate, 1) === endDate);
  return `${perthTimeOf(shift.startsAt)} to ${later ? `${weekdayOf(endDate)} ` : ""}${end === "00:00" && !later ? "24:00" : end}`;
}

/** "19 h 10 min", "45 min", "3 h". Never negative. */
export function formatSpanUntil(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

export type LeadShift =
  | { readonly state: "none" }
  | { readonly state: "on_now"; readonly shift: OverviewShift }
  | { readonly state: "next"; readonly shift: OverviewShift };

/**
 * The shift the page leads with: the worked or on-call shift happening now,
 * otherwise the next one to start. Leave never leads.
 */
export function leadShift(shifts: readonly OverviewShift[], now: Date): LeadShift {
  const at = now.getTime();
  const duty = shifts
    .filter((shift) => shift.kind !== "leave" && Date.parse(shift.endsAt) > at)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const current = duty.find((shift) => Date.parse(shift.startsAt) <= at && isWorkedKind(shift.kind));
  if (current) return { state: "on_now", shift: current };
  const next = duty.find((shift) => Date.parse(shift.startsAt) > at);
  return next ? { state: "next", shift: next } : { state: "none" };
}

/** "today", "tomorrow", or the weekday and date, for the lead card's eyebrow. */
export function relativeDay(date: string, today: string): string {
  if (date === today) return "today";
  if (date === addDaysToDate(today, 1)) return "tomorrow";
  return `${weekdayOf(date)} ${Number(date.slice(8, 10))}`;
}

export type WeekRow = {
  readonly date: string;
  readonly weekday: string;
  readonly day: number;
  /** The shifts starting this day, in order; empty for a day off. */
  readonly shifts: readonly OverviewShift[];
  /** For a day off: the end of a night that finished this morning ("Night shift ends 08:00"). */
  readonly offNote: string | null;
};

/** One row per day, Monday to Sunday, from the doctor's own shifts. */
export function weekRows(shifts: readonly OverviewShift[], monday: string): WeekRow[] {
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDaysToDate(monday, index);
    const starting = shifts
      .filter((shift) => perthDateOf(shift.startsAt) === date)
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
    const endingHere = starting.length
      ? null
      : shifts.find(
          (shift) =>
            isWorkedKind(shift.kind) &&
            perthDateOf(shift.endsAt) === date &&
            perthDateOf(shift.startsAt) !== date &&
            perthTimeOf(shift.endsAt) !== "00:00",
        );
    return {
      date,
      weekday: weekdayOf(date),
      day: Number(date.slice(8, 10)),
      shifts: starting,
      offNote: endingHere ? `${SHIFT_KIND_LABEL[endingHere.kind]} shift ends ${perthTimeOf(endingHere.endsAt)}` : null,
    };
  });
}

/** "4 shifts and 1 on call", "No shifts", "1 shift". Leave is not counted as a shift. */
export function weekCountWords(rows: readonly WeekRow[]): string {
  const all = rows.flatMap((row) => row.shifts);
  const worked = all.filter((shift) => isWorkedKind(shift.kind)).length;
  const onCall = all.filter((shift) => shift.kind === "on_call").length;
  const parts: string[] = [];
  if (worked) parts.push(`${worked} ${worked === 1 ? "shift" : "shifts"}`);
  if (onCall) parts.push(`${onCall} on call`);
  return parts.length ? parts.join(" and ") : "No shifts";
}

/**
 * Hours from the end of `shift` to the start of the next on-call or worked
 * shift, or null when the roster holds none after it.
 */
export function hoursUntilNextDuty(
  shifts: readonly OverviewShift[],
  shift: OverviewShift,
): { readonly hours: number; readonly next: OverviewShift } | null {
  const end = Date.parse(shift.endsAt);
  const next = shifts
    .filter((other) => other.id !== shift.id && other.kind !== "leave" && Date.parse(other.startsAt) >= end)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];
  if (!next) return null;
  return { hours: Math.round(((Date.parse(next.startsAt) - end) / HOUR_MS) * 10) / 10, next };
}
