import { perthDate, perthTime } from "@/lib/teaching/time";

/*
 * Perth dates and labels for Teaching's screens. The Perth clock is part 2's
 * `time.ts`, so server and screen never disagree about a session's day. Names
 * come from these arrays rather than `Intl`, because some en-AU ICU builds
 * write "Sept" where the design standard writes "Sep".
 */
export { perthTime };

const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const MONTHS_LONG = [
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

function fromKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function perthDateKey(value: Date | string): string {
  return perthDate(typeof value === "string" ? value : value.toISOString());
}

export function addDays(dateKey: string, days: number): string {
  const date = fromKey(dateKey);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The Monday on or before `dateKey`. Weeks run Monday to Sunday. */
export function mondayOf(dateKey: string): string {
  return addDays(dateKey, -((fromKey(dateKey).getUTCDay() + 6) % 7));
}

/**
 * The Monday of the week Teaching's Week page opens on. On a Sunday the week that is ending has almost
 * nothing left in it, so the page opens on the coming Monday-to-Sunday week instead; any other day it
 * is the week `dateKey` is in.
 */
export function openingMondayOf(dateKey: string): string {
  return fromKey(dateKey).getUTCDay() === 0 ? addDays(dateKey, 1) : mondayOf(dateKey);
}

export function dayParts(dateKey: string): { weekday: string; day: string; month: string } {
  const date = fromKey(dateKey);
  return {
    weekday: WEEKDAYS_SHORT[date.getUTCDay()],
    day: String(date.getUTCDate()),
    month: MONTHS_SHORT[date.getUTCMonth()],
  };
}

export function shortDayLabel(dateKey: string): string {
  const parts = dayParts(dateKey);
  return `${parts.weekday} ${parts.day} ${parts.month}`;
}

export function longDayLabel(dateKey: string): string {
  const date = fromKey(dateKey);
  return `${WEEKDAYS_LONG[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS_LONG[date.getUTCMonth()]}`;
}

export function monthLabel(dateKey: string): string {
  const date = fromKey(dateKey);
  return `${MONTHS_LONG[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export function durationMinutes(startIso: string, endIso: string): number {
  return Math.max(0, Math.round((Date.parse(endIso) - Date.parse(startIso)) / 60_000));
}

/** "12:30–13:30": an en dash, no spaces. */
export function timeRange(startIso: string, endIso: string): string {
  return `${perthTime(startIso)}–${perthTime(endIso)}`;
}
