/**
 * My Day Week: pure day-grouping rules. The seven days run from today, in Perth
 * time (UTC+8, no daylight saving), so dates are exact arithmetic on
 * `YYYY-MM-DD` strings. Nothing here reads or stores anything.
 */

import { duePerthDate } from "@/lib/my-day/merge";
import type { MyDayItem } from "@/lib/my-day/model";
import { addDaysToDate, formatPerthDay } from "@/lib/roster/shifts/perth-time";

export const MY_DAY_WEEK_DAYS = 7;

/** Today and the six Perth days after it. */
export function myDayWeekDates(today: string): string[] {
  return Array.from({ length: MY_DAY_WEEK_DAYS }, (_, index) => addDaysToDate(today, index));
}

const RANGE_PART = new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", timeZone: "UTC" });
const RANGE_MONTH = new Intl.DateTimeFormat("en-AU", { month: "long", timeZone: "UTC" });

/**
 * The window's range in words, `Sun 4 to Sat 10 October`. The month is named once when both ends share it,
 * otherwise on each end (`Sun 27 September to Sat 3 October`). Counted from today, never a fixed week.
 */
export function myDayWeekRangeLabel(today: string): string {
  const last = addDaysToDate(today, MY_DAY_WEEK_DAYS - 1);
  const at = (date: string) => new Date(`${date}T12:00:00Z`);
  const month = (date: string) => RANGE_MONTH.format(at(date));
  const part = (date: string) => RANGE_PART.format(at(date)).replace(",", "");
  const sameMonth = today.slice(0, 7) === last.slice(0, 7);
  return sameMonth
    ? `${part(today)} to ${part(last)} ${month(last)}`
    : `${part(today)} ${month(today)} to ${part(last)} ${month(last)}`;
}

/** `Today · Sat 3 Oct`, `Tomorrow · Sun 4 Oct`, then `Mon 5 Oct`. */
export function myDayWeekDayLabel(date: string, today: string): string {
  const day = formatPerthDay(date);
  if (date === today) return `Today · ${day}`;
  if (date === addDaysToDate(today, 1)) return `Tomorrow · ${day}`;
  return day;
}

/**
 * Rows keyed by the Perth day they fall on, for exactly the days given. Rows on
 * other days are left out; order within a day follows the input order.
 */
export function groupByPerthDay<T>(
  rows: readonly T[],
  dates: readonly string[],
  dateOf: (row: T) => string | null,
): Map<string, T[]> {
  const byDay = new Map<string, T[]>(dates.map((date) => [date, []]));
  for (const row of rows) {
    const date = dateOf(row);
    if (date !== null) byDay.get(date)?.push(row);
  }
  return byDay;
}

/**
 * The Perth day a dated My Day item shows on this week. An item due before
 * today is still waiting on the reader, so it shows under Today; an item with no
 * date, or one past the seventh day, is not in the week at all.
 */
export function myDayItemWeekDate(item: MyDayItem, today: string, lastDate: string): string | null {
  const date = duePerthDate(item.due);
  if (date === null) return null;
  if (date > lastDate) return null;
  return date < today ? today : date;
}
