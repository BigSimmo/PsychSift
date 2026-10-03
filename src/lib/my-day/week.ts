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
