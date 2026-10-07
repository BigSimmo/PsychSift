import { currentWorkTimeZone } from "@/lib/work-time/current-zone";
import { zonedDateOf, zonedTimeOf } from "@/lib/work-time/format";

/**
 * Every clock time a reader sees: 24-hour, "17:30" (Josh, 16:29Z), in the work
 * time zone (Perth unless the doctor chose another), never the phone's.
 * `zonedTimeOf` keeps the output "HH:MM" whatever the runtime's en-AU
 * separator is, and midnight is "00:00", never "24:00".
 */

function toDate(value: Date | string): Date | null {
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatClockTime(value: Date | string, zone: string = currentWorkTimeZone()): string {
  const date = toDate(value);
  return date ? zonedTimeOf(date, zone) : "";
}

/** "08:00–16:30", or "22:00–08:00 +1" when the end falls on a later work-zone day (standard §2). */
export function formatClockRange(
  start: Date | string,
  end: Date | string,
  zone: string = currentWorkTimeZone(),
): string {
  const from = toDate(start);
  const to = toDate(end);
  if (!from || !to) return "";
  const dayGap = Math.round(
    (Date.parse(`${zonedDateOf(to, zone)}T00:00:00Z`) - Date.parse(`${zonedDateOf(from, zone)}T00:00:00Z`)) /
      86_400_000,
  );
  return `${formatClockTime(from, zone)}–${formatClockTime(to, zone)}${dayGap > 0 ? ` +${dayGap}` : ""}`;
}

/** The work-zone (default Perth) hour, 0–23, for a greeting. */
export function perthHour(now: Date, zone: string = currentWorkTimeZone()): number {
  return Number(zonedTimeOf(now, zone).slice(0, 2));
}
