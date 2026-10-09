import { CALENDAR_UTC_OFFSET_MINUTES } from "@/lib/calendar/calendar-event";
import { currentWorkTimeZone } from "@/lib/work-time/current-zone";
import { zonedWallToIso, zoneOffsetMs } from "@/lib/work-time/format";
import { DEFAULT_WORK_TIME_ZONE, isWorkTimeZone } from "@/lib/work-time/zones";

/**
 * Shared wall-clock and calendar-date arithmetic in the WORK time zone.
 *
 * The names say Perth because Perth is the default and was once the only zone;
 * every reader and writer here now takes a trailing `zone`, defaulting to the
 * one the doctor chose (`currentWorkTimeZone()`, Perth on the server and when
 * nothing is chosen). Reads and the write (`perthWallToIso`) move together, so
 * an 08:00 shift typed in Sydney is stored as 08:00 Sydney and shown as 08:00.
 *
 * Perth (AWST) is UTC+8 with no daylight saving, so in Perth these are the
 * same fixed-offset sums they always were. Other zones go through Intl with the
 * zone named. Nothing here reads the device's own zone.
 */

export const PERTH_TIME_ZONE = "Australia/Perth";
export const PERTH_UTC_OFFSET_MINUTES = CALENDAR_UTC_OFFSET_MINUTES; // 480
export const PERTH_OFFSET_MS = PERTH_UTC_OFFSET_MINUTES * 60 * 1000;

/**
 * Derives the Perth calendar date `YYYY-MM-DD` for an instant (Date, ISO string, or epoch ms).
 * Defaults to current time when omitted.
 */
export function perthCalendarDate(
  instant: Date | string | number = new Date(),
  zone: string = currentWorkTimeZone(),
): string {
  const ms =
    typeof instant === "string" ? Date.parse(instant) : typeof instant === "number" ? instant : instant.getTime();
  if (Number.isNaN(ms)) {
    throw new Error(`perthCalendarDate: invalid instant ${String(instant)}`);
  }
  return new Date(ms + zoneOffsetMs(ms, zone)).toISOString().slice(0, 10);
}

/** The work-zone (default Perth) calendar date of an instant, `YYYY-MM-DD`. */
export function perthDateOf(
  instant: string | Date | number = new Date(),
  zone: string = currentWorkTimeZone(),
): string {
  return perthCalendarDate(instant, zone);
}

/** The work-zone (default Perth) wall-clock time of an instant, `HH:MM`. */
export function perthTimeOf(instant: string | Date | number, zone: string = currentWorkTimeZone()): string {
  const ms =
    typeof instant === "string" ? Date.parse(instant) : typeof instant === "number" ? instant : instant.getTime();
  if (Number.isNaN(ms)) {
    throw new Error(`perthTimeOf: invalid instant ${String(instant)}`);
  }
  return new Date(ms + zoneOffsetMs(ms, zone)).toISOString().slice(11, 16);
}

/**
 * `YYYY-MM-DD` + `HH:MM` on the work zone's (default Perth) wall clock → ISO
 * instant, or null for an impossible date or time, or one skipped by a
 * daylight-saving jump in an eastern zone.
 */
export function perthWallToIso(date: string, time: string, zone: string = currentWorkTimeZone()): string | null {
  if (isWorkTimeZone(zone) && zone !== DEFAULT_WORK_TIME_ZONE) return zonedWallToIso(date, time, zone);
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dateMatch || !timeMatch) return null;
  const [year, month, day] = [Number(dateMatch[1]), Number(dateMatch[2]), Number(dateMatch[3])];
  const [hour, minute] = [Number(timeMatch[1]), Number(timeMatch[2])];
  if (hour > 23 || minute > 59) return null;
  const utc = Date.UTC(year, month - 1, day, hour, minute) - PERTH_OFFSET_MS;
  const check = new Date(utc + PERTH_OFFSET_MS);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return new Date(utc).toISOString();
}

/** `YYYY-MM-DD` plus `days`. */
export function addDaysToDate(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`) + days * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Alias for addDaysToDate for parity with CME date arithmetic. */
export function addCalendarDays(date: string, days: number): string {
  return addDaysToDate(date, days);
}

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "Mon 3 Oct" for a `YYYY-MM-DD` date (already a zone date, so no zone is needed). */
export function formatPerthDay(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  return `${WEEKDAYS[parsed.getUTCDay()]} ${parsed.getUTCDate()} ${MONTHS[parsed.getUTCMonth()]}`;
}
