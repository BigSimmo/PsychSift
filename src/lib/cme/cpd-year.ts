/**
 * The CPD year is a Perth year.
 *
 * Perth is UTC+8 with no daylight saving. Every date question this mode asks —
 * which year an activity belongs to, how far through the year we are, what the
 * current rate projects to — must be asked in that zone. Asked in UTC, an
 * activity logged between midnight and 08:00 on 1 January is filed against the
 * year that just closed, which is silent and wrong in the one record its owner
 * cannot afford to have wrong.
 *
 * `en-CA` is not a locale choice: it is the one built-in locale whose short date
 * format is already `YYYY-MM-DD`, so no reassembly is needed.
 */
import { addDaysToDate, PERTH_TIME_ZONE } from "@/lib/perth-time";

export const CPD_TIME_ZONE = PERTH_TIME_ZONE;

/**
 * Below this, a projection is arithmetic on noise: four weeks of a 52-week year
 * cannot say anything useful about December, and a confident wrong number in
 * January is worse than silence. The dashboard renders nothing about pace while
 * `paceProjection` returns null.
 */
export const CPD_PACE_MINIMUM_ELAPSED_DAYS = 28;

const perthDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: CPD_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const MS_PER_DAY = 86_400_000;

export function perthCalendarDate(instant: Date): string {
  return perthDateFormatter.format(instant);
}

export function cpdYearOf(instant: Date): number {
  return Number.parseInt(perthCalendarDate(instant).slice(0, 4), 10);
}

export function cpdYearBounds(year: number): { start: string; end: string } {
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

export function daysInCpdYear(year: number): number {
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return isLeap ? 366 : 365;
}

/** Whole days from 1 January of `year` to the Perth calendar date of `instant`, inclusive of the first. */
export function daysElapsedInCpdYear(instant: Date, year: number): number {
  const today = Date.parse(`${perthCalendarDate(instant)}T00:00:00Z`);
  const start = Date.parse(`${year}-01-01T00:00:00Z`);
  return Math.round((today - start) / MS_PER_DAY) + 1;
}

export function daysRemainingInCpdYear(instant: Date, year: number): number {
  return daysInCpdYear(year) - daysElapsedInCpdYear(instant, year);
}

/** Hours are read as hours. Two decimals, so no float artefact reaches a screen. */
function roundHours(value: number): number {
  return Math.round(value * 100) / 100;
}

const FULL_MONTH_NAMES = [
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

const SHORT_MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/**
 * Renders a Perth calendar date (`YYYY-MM-DD`) as "19 September 2026".
 *
 * Deliberately plain string arithmetic, not `Date` + `Intl.DateTimeFormat` —
 * the same approach `formatRoutineDueDate` in `routines.ts` documents and
 * this mode's whole date discipline requires: the value is already the
 * correct Perth calendar day, so parsing it back into an instant via
 * `Date.UTC` and re-projecting it through a time zone is a needless round
 * trip, one a runtime whose local zone sits behind UTC could roll onto the
 * wrong day. Splitting the string cannot.
 */
export function formatCalendarDateLong(dateOnly: string): string {
  const [year, month, day] = dateOnly.split("-");
  const monthIndex = Number.parseInt(month, 10) - 1;
  return `${Number.parseInt(day, 10)} ${FULL_MONTH_NAMES[monthIndex]} ${year}`;
}

/** Renders a Perth calendar date (`YYYY-MM-DD`) as "3 February": the long form without its year, for a line already about one year. */
export function formatCalendarDayMonth(dateOnly: string): string {
  const [, month, day] = dateOnly.split("-");
  return `${Number.parseInt(day, 10)} ${FULL_MONTH_NAMES[Number.parseInt(month, 10) - 1]}`;
}

/**
 * Renders a Perth calendar date (`YYYY-MM-DD`) as "16 Sep" — no year, for a
 * list already grouped or tabbed by year. Same plain-string approach as
 * `formatCalendarDateLong` above, for the same reason.
 */
export function formatCalendarDateShort(dateOnly: string): string {
  const [, month, day] = dateOnly.split("-");
  const monthIndex = Number.parseInt(month, 10) - 1;
  return `${Number.parseInt(day, 10)} ${SHORT_MONTH_NAMES[monthIndex]}`;
}

/**
 * Renders a `YYYY-MM` month key as "September 2026". Same plain-string
 * approach as `formatCalendarDateLong` above, for the same reason.
 */
export function formatCalendarMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-");
  const monthIndex = Number.parseInt(month, 10) - 1;
  return `${FULL_MONTH_NAMES[monthIndex]} ${year}`;
}

export function paceProjection(args: {
  hoursSoFar: number;
  targetHours: number;
  instant: Date;
  year: number;
}): { projectedHours: number; shortfallHours: number } | null {
  // A rate is only meaningful inside the year it was measured in. Asked about a
  // closed year, or one that has not started, `daysElapsedInCpdYear` returns a
  // number outside 1..365 and the projection built on it is confidently wrong —
  // the exact failure this module exists to prevent. Say nothing instead.
  if (cpdYearOf(args.instant) !== args.year) return null;
  const elapsed = daysElapsedInCpdYear(args.instant, args.year);
  if (elapsed < CPD_PACE_MINIMUM_ELAPSED_DAYS) return null;
  const projectedHours = roundHours((args.hoursSoFar / elapsed) * daysInCpdYear(args.year));
  return { projectedHours, shortfallHours: roundHours(Math.max(0, args.targetHours - projectedHours)) };
}

const SHORT_WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Sakamoto's month offsets for `weekdayOf`. */
const WEEKDAY_MONTH_OFFSETS = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4] as const;

/**
 * Day of the week (0 = Sunday) of a calendar date, by Sakamoto's method:
 * integer arithmetic only, so no `Date`, no runtime time zone and no chance
 * of a Perth date being read as the day before.
 */
function weekdayOf(year: number, month: number, day: number): number {
  const y = month < 3 ? year - 1 : year;
  return (
    (y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) + WEEKDAY_MONTH_OFFSETS[month - 1] + day) % 7
  );
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return daysInCpdYear(year) === 366 ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/**
 * Renders a Perth calendar date (`YYYY-MM-DD`) as "Sat 26 Sep", adding the
 * year ("Wed 31 Dec 2025") only when it is not `today`'s year. `today` is a
 * Perth calendar date too, normally `perthCalendarDate(new Date())`. Plain
 * arithmetic on the string, like `formatCalendarDateLong` above.
 */
export function formatCmeRowDate(date: string, today: string): string {
  const [year, month, day] = date.split("-").map((part) => Number.parseInt(part, 10));
  const label = `${SHORT_WEEKDAY_NAMES[weekdayOf(year, month, day)]} ${day} ${SHORT_MONTH_NAMES[month - 1]}`;
  return date.slice(0, 4) === today.slice(0, 4) ? label : `${label} ${date.slice(0, 4)}`;
}

export function addCalendarDays(dateOnly: string, days: number): string {
  return addDaysToDate(dateOnly, days);
}

/** `YYYY-MM-DD` as the Australian "26/09/2026" the date box shows. Empty for anything else. */
export function formatCmeDayInput(dateOnly: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return "";
  const [year, month, day] = dateOnly.split("-");
  return `${day}/${month}/${year}`;
}

const DAY_INPUT_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_INPUT_NUMERIC = /^(\d{1,2})[/.\- ](\d{1,2})[/.\- ](\d{4})$/;
/** Eight digits, day first: the iPhone number pad has no "/" key. */
const DAY_INPUT_COMPACT = /^(\d{2})(\d{2})(\d{4})$/;
const DAY_INPUT_WORDED = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})$/;

/**
 * Reads a day typed the Australian way — "26/9/2026", "26/09/2026",
 * "26-09-2026", "26.09.2026", "26092026", "26 Sep 2026", "26 September 2026" —
 * or a pasted ISO "2026-09-26", as a Perth calendar date (`YYYY-MM-DD`).
 * Day first, always: "9/26/2026" is refused, never read as the US order.
 * Returns null for anything that is not a real day, such as 31/2/2026.
 */
export function parseCmeDayInput(text: string): string | null {
  const trimmed = text.trim();
  let parts: [number, number, number] | null = null;
  const iso = DAY_INPUT_ISO.exec(trimmed);
  const numeric = DAY_INPUT_NUMERIC.exec(trimmed) ?? DAY_INPUT_COMPACT.exec(trimmed);
  const worded = DAY_INPUT_WORDED.exec(trimmed);
  if (iso) {
    parts = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (numeric) {
    parts = [Number(numeric[3]), Number(numeric[2]), Number(numeric[1])];
  } else if (worded) {
    const word = worded[2].toLowerCase();
    const monthIndex = FULL_MONTH_NAMES.findIndex((name) => name.toLowerCase().startsWith(word));
    if (monthIndex >= 0) parts = [Number(worded[3]), monthIndex + 1, Number(worded[1])];
  }
  if (!parts) return null;
  const [year, month, day] = parts;
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
