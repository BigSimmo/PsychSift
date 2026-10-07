import { DEFAULT_WORK_TIME_ZONE, isWorkTimeZone, workTimeZoneOption } from "@/lib/work-time/zones";

/**
 * Wall-clock dates and times in the work time zone, never the device's.
 *
 * Same shapes as `src/lib/perth-time.ts` (`YYYY-MM-DD`, `HH:MM`) with the zone
 * as an argument, so a Perth call site swaps one for one. Perth has no daylight
 * saving and could use a fixed offset; the eastern zones do not, so every
 * conversion here goes through Intl with the zone named. Formatters are cached
 * per zone because building one is the slow part.
 */

type Instant = Date | string | number;

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function safeZone(zone: string | null | undefined): string {
  return isWorkTimeZone(zone) ? zone : DEFAULT_WORK_TIME_ZONE;
}

function toMs(instant: Instant, caller: string): number {
  const ms =
    typeof instant === "string" ? Date.parse(instant) : typeof instant === "number" ? instant : instant.getTime();
  if (Number.isNaN(ms)) throw new Error(`${caller}: invalid instant ${String(instant)}`);
  return ms;
}

function partsFormatter(zone: string): Intl.DateTimeFormat {
  let formatter = partsFormatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-AU", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsFormatters.set(zone, formatter);
  }
  return formatter;
}

type WallParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function wallParts(ms: number, zone: string): WallParts {
  const out: Record<string, number> = {};
  for (const part of partsFormatter(zone).formatToParts(new Date(ms))) {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  }
  return {
    year: out.year!,
    month: out.month!,
    day: out.day!,
    hour: out.hour === 24 ? 0 : out.hour!,
    minute: out.minute!,
    second: out.second!,
  };
}

const pad = (value: number) => String(value).padStart(2, "0");

/** Minutes the zone is ahead of UTC at an instant (480 for Perth, 600 or 660 for Sydney). */
export function zoneOffsetMinutes(instant: Instant, zone: string): number {
  const ms = toMs(instant, "zoneOffsetMinutes");
  const parts = wallParts(ms, safeZone(zone));
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((asUtc - (ms - (ms % 1000))) / 60000);
}

const PERTH_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * Milliseconds the zone is ahead of UTC at an instant, for helpers that shift an
 * instant and read its UTC fields. Perth, which has no daylight saving, is the
 * fixed eight hours with no Intl lookup, so the Perth answer is exactly what the
 * old fixed-offset helpers gave. Unknown zones read as Perth.
 */
export function zoneOffsetMs(ms: number, zone: string): number {
  const resolved = safeZone(zone);
  return resolved === DEFAULT_WORK_TIME_ZONE ? PERTH_OFFSET_MS : zoneOffsetMinutes(ms, resolved) * 60_000;
}

/** The calendar date of an instant in the zone, `YYYY-MM-DD`. */
export function zonedDateOf(instant: Instant, zone: string): string {
  const parts = wallParts(toMs(instant, "zonedDateOf"), safeZone(zone));
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

/** The wall-clock time of an instant in the zone, `HH:MM` (24 hour). */
export function zonedTimeOf(instant: Instant, zone: string): string {
  const parts = wallParts(toMs(instant, "zonedTimeOf"), safeZone(zone));
  return `${pad(parts.hour)}:${pad(parts.minute)}`;
}

/** Today's date in the zone, `YYYY-MM-DD`. */
export function zonedToday(zone: string, now: Instant = Date.now()): string {
  return zonedDateOf(now, zone);
}

/**
 * `YYYY-MM-DD` + `HH:MM` on the zone's wall clock to an ISO instant. Null for an
 * impossible date or time, and for a time skipped by a daylight-saving jump
 * (02:30 on the first Sunday in October in Sydney does not exist).
 */
export function zonedWallToIso(date: string, time: string, zone: string): string | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dateMatch || !timeMatch) return null;
  const [year, month, day] = [Number(dateMatch[1]), Number(dateMatch[2]), Number(dateMatch[3])];
  const [hour, minute] = [Number(timeMatch[1]), Number(timeMatch[2])];
  if (hour > 23 || minute > 59) return null;
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  const check = new Date(wallAsUtc);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  const resolved = safeZone(zone);
  // Two passes settle the offset on either side of a daylight-saving change.
  let guess = wallAsUtc - zoneOffsetMinutes(wallAsUtc, resolved) * 60000;
  guess = wallAsUtc - zoneOffsetMinutes(guess, resolved) * 60000;
  if (zonedDateOf(guess, resolved) !== date || zonedTimeOf(guess, resolved) !== time) return null;
  return new Date(guess).toISOString();
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "Mon 3 Oct" for a `YYYY-MM-DD` date. The date is already a zone date, so no zone is needed. */
export function formatZonedDay(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return `${WEEKDAYS[parsed.getUTCDay()]} ${parsed.getUTCDate()} ${MONTHS[parsed.getUTCMonth()]}`;
}

/** "08:00" for an instant in the zone. Same as zonedTimeOf; named for display call sites. */
export function formatZonedTime(instant: Instant, zone: string): string {
  return zonedTimeOf(instant, zone);
}

/** "08:00 to 16:30" for a shift. Overnight shifts read the same way; the date is shown elsewhere. */
export function formatZonedRange(start: Instant, end: Instant, zone: string): string {
  return `${zonedTimeOf(start, zone)} to ${zonedTimeOf(end, zone)}`;
}

const shortNameFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * The zone's abbreviation at an instant: "AWST", or "AEDT" in a Sydney summer.
 * Browsers name Australian zones inconsistently (some give "GMT+10"), so a
 * non-letter answer falls back to the zone's own standard abbreviation, with
 * "D" for daylight time when the offset says so.
 */
export function zoneShort(zone: string, instant: Instant = Date.now()): string {
  const resolved = safeZone(zone);
  const option = workTimeZoneOption(resolved);
  let formatter = shortNameFormatters.get(resolved);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-AU", { timeZone: resolved, timeZoneName: "short" });
    shortNameFormatters.set(resolved, formatter);
  }
  const ms = toMs(instant, "zoneShort");
  const name = formatter.formatToParts(new Date(ms)).find((part) => part.type === "timeZoneName")?.value ?? "";
  if (/^[A-Z]{3,5}$/.test(name)) return name;
  const standard = zoneOffsetMinutes(Date.UTC(new Date(ms).getUTCFullYear(), 6, 1), resolved);
  return zoneOffsetMinutes(ms, resolved) > standard ? option.short.replace(/ST$/, "DT") : option.short;
}
