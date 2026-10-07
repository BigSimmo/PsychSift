import { currentWorkTimeZone } from "@/lib/work-time/current-zone";
import { zonedWallToIso, zoneOffsetMs } from "@/lib/work-time/format";
import { DEFAULT_WORK_TIME_ZONE, isWorkTimeZone } from "@/lib/work-time/zones";

/**
 * Wall-clock times for Teaching, in the work time zone (Perth unless the doctor
 * chose another; every export takes a trailing `zone`). Never the server's or
 * the phone's own zone. Perth has been UTC+8 all year since 2009, so in Perth
 * the conversion is the same fixed eight hours it always was
 * (`src/lib/calendar/calendar-event.ts` makes the same choice). Weekday and month names are written out here rather than
 * taken from `Intl`: current ICU data spells September "Sept" for en-AU, and the
 * design says "Sep". Hours and minutes are built by hand for the same reason, so
 * midnight is "00:00" everywhere and never "24:00".
 */

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** A Date whose UTC fields read as the zone's wall-clock fields, or null. */
function perthWallClock(iso: string, zone: string): Date | null {
  const millis = Date.parse(iso);
  return Number.isFinite(millis) ? new Date(millis + zoneOffsetMs(millis, zone)) : null;
}

export function perthDate(iso: string, zone: string = currentWorkTimeZone()): string {
  const wall = perthWallClock(iso, zone);
  if (!wall) return "";
  return `${wall.getUTCFullYear()}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())}`;
}

export function perthTime(iso: string, zone: string = currentWorkTimeZone()): string {
  const wall = perthWallClock(iso, zone);
  if (!wall) return "";
  return `${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}`;
}

export function perthToday(now: Date = new Date(), zone: string = currentWorkTimeZone()): string {
  return perthDate(now.toISOString(), zone);
}

/**
 * The UTC instant of a work-zone (default Perth) date and 24-hour time. Throws
 * on a day or time that does not exist, including one skipped by a
 * daylight-saving jump in an eastern zone.
 */
export function perthInstant(date: string, time: string, zone: string = currentWorkTimeZone()): string {
  const clock = TIME.exec(time);
  if (!DATE_KEY.test(date) || !clock) throw new RangeError("Not a Perth date and time.");
  const midnight = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(midnight)) throw new RangeError("Not a Perth date and time.");
  if (isWorkTimeZone(zone) && zone !== DEFAULT_WORK_TIME_ZONE) {
    const zoned = zonedWallToIso(date, time, zone);
    if (!zoned) throw new RangeError("Not a Perth date and time.");
    return zoned;
  }
  const minutes = Number(clock[1]) * 60 + Number(clock[2]);
  const result = new Date(midnight + minutes * 60_000 - zoneOffsetMs(midnight, zone)).toISOString();
  // V8 reads 30 February as 2 March; a date that does not round-trip never existed.
  if (perthDate(result, zone) !== date) throw new RangeError("Not a Perth date and time.");
  return result;
}

function dayLabel(wall: Date): string {
  return `${WEEKDAYS[wall.getUTCDay()]} ${wall.getUTCDate()} ${MONTHS[wall.getUTCMonth()]}`;
}

/** "Wed 30 Sep, 12:30 to 13:30"; a session that crosses midnight names both days. */
export function formatSessionTime(startsAt: string, endsAt: string, zone: string = currentWorkTimeZone()): string {
  const start = perthWallClock(startsAt, zone);
  const end = perthWallClock(endsAt, zone);
  if (!start || !end) return "";
  const from = `${dayLabel(start)}, ${perthTime(startsAt, zone)}`;
  if (perthDate(startsAt, zone) === perthDate(endsAt, zone)) return `${from} to ${perthTime(endsAt, zone)}`;
  return `${from} to ${dayLabel(end)}, ${perthTime(endsAt, zone)}`;
}

/** Minutes as hours to two decimal places, with trailing zeros dropped: 90 → "1.5". */
export function formatHours(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "0";
  return String(Math.round((minutes / 60) * 100) / 100);
}
