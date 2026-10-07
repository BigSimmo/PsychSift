import { currentWorkTimeZone } from "@/lib/work-time/current-zone";
import { zoneOffsetMs } from "@/lib/work-time/format";

/**
 * Dates and times as On Call writes them (standard §2), in the work time zone
 * (Perth unless the doctor chose another; every export takes a trailing `zone`).
 *
 *   date        `12 Mar 2026`, then a muted age: `12 Mar 2026 · 6 months ago`
 *   short day   `Sat 26 Sep`
 *   time        `02:14`, 24-hour
 *   range       `22:00–08:00` plus a muted `+1` when it crosses midnight
 *
 * A fixed month table rather than `Intl`, which prints "Sept" and "June" on
 * Node 24 (plan correction C20) — the same approach as `formatPerthDay` in
 * `shifts/perth-time.ts`. Each instant is shifted by the zone's offset at that
 * instant and its UTC fields read; Perth keeps UTC+8 all year, so in Perth that
 * is the same fixed eight hours it always was.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A Date whose UTC fields read as the zone's wall-clock fields, or null. */
function perth(value: string | number | Date | null | undefined, zone: string): Date | null {
  if (value == null) return null;
  const time = typeof value === "string" ? Date.parse(value) : typeof value === "number" ? value : value.getTime();
  return Number.isFinite(time) ? new Date(time + zoneOffsetMs(time, zone)) : null;
}

const two = (value: number) => String(value).padStart(2, "0");

/** `20 Sep 2026`, or an empty string for a date that cannot be read. */
export function formatOnCallDate(
  value: string | number | Date | null | undefined,
  zone: string = currentWorkTimeZone(),
): string {
  const date = perth(value, zone);
  return date ? `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}` : "";
}

/** `20 Sep 2026, 4:14 pm`, or an empty string for a date that cannot be read. */
export function formatOnCallDateTime(
  value: string | number | Date | null | undefined,
  zone: string = currentWorkTimeZone(),
): string {
  const date = perth(value, zone);
  if (!date) return "";
  const hours = date.getUTCHours();
  const minutes = two(date.getUTCMinutes());
  const ampm = hours >= 12 ? "pm" : "am";
  const hour12 = hours % 12 || 12;
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}, ${hour12}:${minutes} ${ampm}`;
}

/** `Sat 26 Sep`. */
export function formatOnCallShortDay(
  value: string | number | Date | null | undefined,
  zone: string = currentWorkTimeZone(),
): string {
  const date = perth(value, zone);
  return date ? `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}` : "";
}

/** `02:14`, 24-hour. */
export function formatOnCallTime(
  value: string | number | Date | null | undefined,
  zone: string = currentWorkTimeZone(),
): string {
  const date = perth(value, zone);
  return date ? `${two(date.getUTCHours())}:${two(date.getUTCMinutes())}` : "";
}

/** `22:00–08:00` and whether the end falls on the next work-zone day (shown as a muted `+1`). */
export function formatOnCallTimeRange(
  start: string | Date,
  end: string | Date,
  zone: string = currentWorkTimeZone(),
): { readonly range: string; readonly nextDay: boolean } {
  const from = perth(start, zone);
  const to = perth(end, zone);
  if (!from || !to) return { range: "", nextDay: false };
  const fromDay = Math.floor(from.getTime() / DAY_MS);
  const toDay = Math.floor(to.getTime() / DAY_MS);
  return { range: `${formatOnCallTime(start, zone)}–${formatOnCallTime(end, zone)}`, nextDay: toDay > fromDay };
}

/**
 * How long ago, in the words a tired reader takes in at a glance: `today`,
 * `yesterday`, `6 days ago`, `3 weeks ago`, `6 months ago`, `2 years ago`.
 * Counted in work-zone calendar days, so "yesterday" means the reader's yesterday.
 */
export function onCallAgo(value: string | Date, now: Date = new Date(), zone: string = currentWorkTimeZone()): string {
  const then = perth(value, zone);
  const today = perth(now, zone);
  if (!then || !today) return "";
  const days = Math.floor(today.getTime() / DAY_MS) - Math.floor(then.getTime() / DAY_MS);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  const months =
    (today.getUTCFullYear() - then.getUTCFullYear()) * 12 +
    (today.getUTCMonth() - then.getUTCMonth()) -
    (today.getUTCDate() < then.getUTCDate() ? 1 : 0);
  if (months < 12) return `${Math.max(months, 2)} months ago`;
  const years = Math.floor(months / 12);
  return years === 1 ? "1 year ago" : `${years} years ago`;
}
