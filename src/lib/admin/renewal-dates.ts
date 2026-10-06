import { addDays } from "@/lib/calendar/calendar-event";
import { dateKeyToUtcMillis } from "@/lib/calendar/date-keys";
import { complianceExpiresOn } from "@/lib/on-call/compliance";
import type { OnCallEntry } from "@/lib/on-call/entry-model";
import { perthCalendarDate } from "@/lib/cme/cpd-year";
import { onCallTeachingDateParts } from "@/lib/on-call/teaching-schedule";

/** Spec: "The lead time defaults to 30 days, and the doctor can change it when editing an item." */
export const ADMIN_DEFAULT_LEAD_TIME_DAYS = 30;

export function complianceLeadTimeDays(entry: OnCallEntry): number {
  const details = entry.details;
  const value =
    typeof details === "object" && details !== null ? (details as { leadTimeDays?: unknown }).leadTimeDays : undefined;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : ADMIN_DEFAULT_LEAD_TIME_DAYS;
}

/**
 * The day to start renewing: the recorded date minus the lead time. Never a
 * guessed date. A stored date that has the right shape but is not a real day
 * ("2026-02-30") has no window, rather than throwing and blanking every page
 * that reads the checklist.
 */
export function renewalStartOn(entry: OnCallEntry): string | undefined {
  const expiresOn = complianceExpiresOn(entry);
  if (!expiresOn) return undefined;
  try {
    return addDays(expiresOn, -complianceLeadTimeDays(entry));
  } catch {
    return undefined;
  }
}

/** `YYYY-MM-DD` as "12 Mar 2027", exactly as the Renewals page prints it. */
export function formatRecordedDate(date: string): string {
  const { day, month, year } = onCallTeachingDateParts(date);
  return day && month ? `${day} ${month} ${year}` : date;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "Aug 2026" for the neutral "Updated <month year>" line (spec review 7). Instants use the Perth day, not UTC. */
export function formatUpdatedMonth(value: string): string {
  const key = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : Number.isNaN(Date.parse(value))
      ? ""
      : perthCalendarDate(new Date(value));
  const match = /^(\d{4})-(\d{2})/.exec(key);
  return match ? `${MONTHS[Number(match[2]) - 1]} ${match[1]}` : "";
}

const DAY_MS = 86_400_000;
/** A `YYYY-MM-DD` calendar date as a whole day count, for subtracting two dates. Exported so every
 *  Admin selector that measures "how many days between two calendar dates" shares this one parse. */
export function utcDay(date: string): number | null {
  const ms = dateKeyToUtcMillis(date);
  return ms === null ? null : ms / DAY_MS;
}

/**
 * The muted companion after an absolute date (Josh, 16:31Z: "the date plus weeks"):
 * "30 Nov 2026 · in 9 weeks". One ladder, rounded down so it never overstates the
 * time left: today, tomorrow, in 6 days (up to 13), in 9 weeks (up to 90 days),
 * in 5 months, in 2 years, and the same in the past ("3 days ago"). Never a
 * countdown timer (spec rule 3). Both sides are Perth calendar days
 * (`perthCalendarDate`), so it turns over at Perth midnight.
 */
export function formatRelativeDate(date: string, today: string): string {
  const target = utcDay(date);
  const base = utcDay(today);
  if (target === null || base === null) return "";
  const days = Math.round(target - base);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  const size = Math.abs(days);
  const [later, earlier] = days > 0 ? [date, today] : [today, date];
  const [ly, lm, ld] = later.split("-").map(Number);
  const [ey, em, ed] = earlier.split("-").map(Number);
  const months = (ly - ey) * 12 + (lm - em) - (ld < ed ? 1 : 0);
  const plural = (count: number, unit: string) => `${count} ${unit}${count === 1 ? "" : "s"}`;
  const span =
    size <= 13
      ? plural(size, "day")
      : size < 91
        ? plural(Math.floor(size / 7), "week")
        : months < 24
          ? plural(months, "month")
          : plural(Math.floor(months / 12), "year");
  return days > 0 ? `in ${span}` : `${span} ago`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/**
 * A typed date echoed back in words under the field: "Thu 30 Sep 2027". The input
 * is a calendar day, so it is read at UTC midnight to keep the day it names. Built
 * from fixed tables rather than `Intl`, because en-AU's short month is "Sept" in
 * current ICU and "Sep" in older builds; the page prints "Sep" everywhere.
 */
export function formatDateEcho(date: string): string {
  const day = utcDay(date);
  if (day === null) return "";
  const [year, month, dayOfMonth] = date.split("-").map(Number);
  return `${WEEKDAYS[new Date(day * DAY_MS).getUTCDay()]} ${dayOfMonth} ${MONTHS[month - 1]} ${year}`;
}
