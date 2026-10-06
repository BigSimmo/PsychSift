/**
 * My Day merge, sort and wording rules. Pure functions only: every mode's
 * adapter hands over items, and this file decides the one order the reader sees.
 *
 * Perth keeps UTC+8 all year, so a Perth calendar date is exact arithmetic on
 * `YYYY-MM-DD` strings and needs no time-zone data. `src/lib` may not import
 * `@/components`, so the few date helpers needed are repeated here (same
 * approach as `src/components/mode-kit/dates.ts`).
 */

import { perthCalendarDate } from "@/lib/cme/cpd-year";
import {
  MY_DAY_SOON_DAYS,
  myDaySeverities,
  myDaySourceModes,
  type MyDayItem,
  type MyDaySeverity,
} from "@/lib/my-day/model";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const PERTH_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const two = (value: number) => String(value).padStart(2, "0");

/** Whole days from Perth calendar date `from` to `to`; both `YYYY-MM-DD`. */
function dayDifference(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/**
 * A due value as a UTC instant in ms. A date-only value is Perth midnight, so
 * it sorts before any instant later that Perth day. `null` when absent or unreadable.
 */
function dueInstant(due: string | null): number | null {
  if (due === null) return null;
  const ms = DATE_ONLY.test(due) ? Date.parse(`${due}T00:00:00Z`) - PERTH_OFFSET_MS : Date.parse(due);
  return Number.isFinite(ms) ? ms : null;
}

/** The Perth calendar date a due value falls on, or `null` when unreadable. */
export function duePerthDate(due: string | null): string | null {
  if (due === null) return null;
  if (DATE_ONLY.test(due)) return Number.isFinite(Date.parse(`${due}T00:00:00Z`)) ? due : null;
  const ms = Date.parse(due);
  return Number.isFinite(ms) ? perthCalendarDate(new Date(ms)) : null;
}

/**
 * How urgent a due value is right now. A date-only value is overdue from the
 * day after it falls; an instant is overdue the moment it passes, so an
 * appointment at 09:00 reads as overdue at 09:01 but not at 08:00 the same day.
 */
export function myDaySeverityForDue(due: string | null, now: Date, soonDays: number = MY_DAY_SOON_DAYS): MyDaySeverity {
  const date = duePerthDate(due);
  if (due === null || date === null) return "info";
  const days = dayDifference(perthCalendarDate(now), date);
  if (DATE_ONLY.test(due)) {
    if (days < 0) return "overdue";
  } else if (Date.parse(due) < now.getTime()) {
    return "overdue";
  }
  return days <= soonDays - 1 ? "soon" : "info";
}

/**
 * Severity, then due (earliest first, undated last), then the mode's place on
 * the page, then title and id so the order never depends on input order.
 */
export function compareMyDayItems(a: MyDayItem, b: MyDayItem): number {
  const severity = myDaySeverities.indexOf(a.severity) - myDaySeverities.indexOf(b.severity);
  if (severity !== 0) return severity;

  const aDue = dueInstant(a.due);
  const bDue = dueInstant(b.due);
  if (aDue !== bDue) {
    if (aDue === null) return 1;
    if (bDue === null) return -1;
    return aDue - bDue;
  }

  const mode = myDaySourceModes.indexOf(a.mode) - myDaySourceModes.indexOf(b.mode);
  if (mode !== 0) return mode;

  const title = a.title.localeCompare(b.title, "en");
  if (title !== 0) return title;

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Flatten every source, keep the first of any repeated id, and sort a new array. */
export function mergeMyDayItems(groups: readonly (readonly MyDayItem[])[]): MyDayItem[] {
  const seen = new Set<string>();
  const merged: MyDayItem[] = [];
  for (const group of groups) {
    for (const item of group) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      merged.push(item);
    }
  }
  return merged.sort(compareMyDayItems);
}

/**
 * `Today`, `Tomorrow`, `Yesterday` or `9 Oct 2026`, with ` · 14:30` (24-hour,
 * Perth) when the due value carries a time. Empty for no date or an unreadable one.
 */
export function formatMyDayDue(due: string | null, now: Date): string {
  const date = duePerthDate(due);
  if (due === null || date === null) return "";
  const days = dayDifference(perthCalendarDate(now), date);
  const [year, month, day] = date.split("-").map((part) => Number.parseInt(part, 10));
  const label =
    days === 0 ? "Today" : days === 1 ? "Tomorrow" : days === -1 ? "Yesterday" : `${day} ${MONTHS[month - 1]} ${year}`;
  if (DATE_ONLY.test(due)) return label;
  const perth = new Date(Date.parse(due) + PERTH_OFFSET_MS);
  return `${label} · ${two(perth.getUTCHours())}:${two(perth.getUTCMinutes())}`;
}

/** Counts by severity, for the home card and the page header. */
export function summariseMyDay(items: readonly MyDayItem[]): {
  total: number;
  overdue: number;
  soon: number;
  info: number;
} {
  const counts = { total: items.length, overdue: 0, soon: 0, info: 0 };
  for (const item of items) counts[item.severity] += 1;
  return counts;
}
