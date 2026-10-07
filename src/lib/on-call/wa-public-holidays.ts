import { onCallLocalDateKey } from "@/lib/on-call/local-date";
import { currentWorkTimeZone } from "@/lib/work-time/current-zone";

/**
 * Western Australian public holidays, as published by the WA Government
 * ("Public holidays in Western Australia", wa.gov.au, page last updated
 * 2 September 2026, read 2026-09-25). Includes the substitute Mondays and
 * Tuesdays the page lists when a holiday falls on a weekend.
 *
 * Used only to decide which escalation steps to lead with: on a public holiday
 * a service runs its after-hours arrangements. Every step stays visible either
 * way, so a missing date costs a glance, not a missed call.
 *
 * The published list is authoritative for the years it covers. For any later
 * year the dates come from `waPublicHolidaysByRule`, which applies the rules
 * the WA Public and Bank Holidays Act 1972 sets out and reproduces every date
 * above exactly (pinned by a test). One date in the rules is set by
 * proclamation rather than by law, King's Birthday, taken here as the last
 * Monday of September as in every recent year; add each year's published list
 * when it appears so a moved proclamation is caught. Regional King's Birthday
 * dates (Karratha, Port Hedland) are not included.
 */
export const WA_PUBLIC_HOLIDAYS: ReadonlySet<string> = new Set([
  // 2026
  "2026-01-01",
  "2026-01-26",
  "2026-03-02",
  "2026-04-03",
  "2026-04-05",
  "2026-04-06",
  "2026-04-25",
  "2026-04-27",
  "2026-06-01",
  "2026-09-28",
  "2026-12-25",
  "2026-12-26",
  "2026-12-28",
  // 2027
  "2027-01-01",
  "2027-01-26",
  "2027-03-01",
  "2027-03-26",
  "2027-03-28",
  "2027-03-29",
  "2027-04-25",
  "2027-04-26",
  "2027-06-07",
  "2027-09-27",
  "2027-12-25",
  "2027-12-26",
  "2027-12-27",
  "2027-12-28",
]);

/** The last year the published list covers. Later years use the rules below. */
export const WA_PUBLIC_HOLIDAYS_LAST_YEAR = 2027;

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** 0 = Sunday … 6 = Saturday, for a calendar date (no time zone involved). */
function weekday(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function addDays(year: number, month: number, day: number, days: number): string {
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return isoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/** Western (Gregorian) Easter Sunday, by the anonymous Gregorian algorithm. */
function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

function firstMonday(year: number, month: number): string {
  const offset = (8 - weekday(year, month, 1)) % 7;
  return isoDate(year, month, 1 + offset);
}

function lastMonday(year: number, month: number): string {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const offset = (weekday(year, month, lastDay) + 6) % 7;
  return isoDate(year, month, lastDay - offset);
}

/** The day itself, plus the following Monday when it falls on a weekend. */
function withMondaySubstitute(year: number, month: number, day: number): string[] {
  const dow = weekday(year, month, day);
  if (dow === 6) return [isoDate(year, month, day), addDays(year, month, day, 2)];
  if (dow === 0) return [isoDate(year, month, day), addDays(year, month, day, 1)];
  return [isoDate(year, month, day)];
}

/**
 * WA public holidays for a year, from the rules rather than the published list.
 * Christmas and Boxing Day share a weekend, so their substitutes are the next
 * weekdays not already holidays: Saturday Christmas gives Monday 27 and Tuesday
 * 28; Sunday Christmas gives Tuesday 27 (Boxing Day is the Monday); Saturday
 * Boxing Day gives Monday 28.
 *
 * Anzac Day can fall on Easter Sunday (next in 2038) or Easter Monday (last in
 * 2011). The Act then names no extra day, but WA has proclaimed one, as in
 * 2011, so the next weekday that is not already a holiday is taken as the
 * expected extra day. Each year's published list, once added, overrides this.
 */
export function waPublicHolidaysByRule(year: number): string[] {
  const easter = easterSunday(year);
  const easterSundayDate = isoDate(year, easter.month, easter.day);
  const easterMondayDate = addDays(year, easter.month, easter.day, 1);
  const christmasDow = weekday(year, 12, 25);
  const christmas: string[] = [isoDate(year, 12, 25), isoDate(year, 12, 26)];
  if (christmasDow === 6) christmas.push(isoDate(year, 12, 27), isoDate(year, 12, 28));
  else if (christmasDow === 0) christmas.push(isoDate(year, 12, 27));
  else if (christmasDow === 5) christmas.push(isoDate(year, 12, 28));
  const days = new Set([
    ...withMondaySubstitute(year, 1, 1),
    ...withMondaySubstitute(year, 1, 26),
    firstMonday(year, 3), // Labour Day
    addDays(year, easter.month, easter.day, -2), // Good Friday
    easterSundayDate,
    easterMondayDate,
    ...withMondaySubstitute(year, 4, 25), // Anzac Day
    firstMonday(year, 6), // Western Australia Day
    lastMonday(year, 9), // King's Birthday (by proclamation; see above)
    ...christmas,
  ]);
  const anzac = isoDate(year, 4, 25);
  if (anzac === easterSundayDate || anzac === easterMondayDate) {
    for (let offset = 1; offset <= 7; offset += 1) {
      const candidate = addDays(year, 4, 25, offset);
      const [, m, d] = candidate.split("-").map(Number);
      const dow = weekday(year, m!, d!);
      if (dow !== 0 && dow !== 6 && !days.has(candidate)) {
        days.add(candidate);
        break;
      }
    }
  }
  return [...days].sort();
}

const ruleCache = new Map<number, ReadonlySet<string>>();

function holidaysFor(year: number): ReadonlySet<string> {
  if (year <= WA_PUBLIC_HOLIDAYS_LAST_YEAR) return WA_PUBLIC_HOLIDAYS;
  let set = ruleCache.get(year);
  if (!set) {
    set = new Set(waPublicHolidaysByRule(year));
    ruleCache.set(year, set);
  }
  return set;
}

/**
 * Read in the work time zone, like `isOnCallOutOfHours` beside it in "Who do I
 * call now?": the two answers combine into one "in hours or not", so they must
 * read the same clock, and both take the same `zone`.
 */
export function isWaPublicHoliday(now: Date, zone: string = currentWorkTimeZone()): boolean {
  const key = onCallLocalDateKey(now, zone);
  return holidaysFor(Number(key.slice(0, 4))).has(key);
}
