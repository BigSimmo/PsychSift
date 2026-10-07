import { currentWorkTimeZone } from "@/lib/work-time/current-zone";
import { zonedDateOf, zonedWallToIso, zoneOffsetMinutes } from "@/lib/work-time/format";

/**
 * The calendar day in the work time zone, as a `YYYY-MM-DD` key.
 *
 * Its own module, and deliberately a tiny one. It used to live in
 * `home-modules.ts`, which is about the home's tag-driven modules and has
 * nothing to do with dates; that misplacement became a real problem the moment
 * `compliance.ts` needed the same helper, because `home-modules.ts` also needs
 * to ask `compliance.ts` which rows are requirements — a cycle that TypeScript
 * accepts, no lint rule here catches, and ES modules resolve by handing one
 * side an undefined binding if either ever reads the other at module-init
 * time. A leaf module both can depend on removes the trap rather than
 * documenting it.
 */

/**
 * `YYYY-MM-DD` for a date, in the work time zone (Perth unless the doctor chose
 * another), never UTC and never the phone's own zone.
 *
 * Not `toISOString()`: in Perth (UTC+8) the UTC day is still yesterday until
 * 08:00, so a UTC key would call this morning "yesterday" every morning. Not the
 * device fields either: a phone still on Sydney time after a trip is a day
 * ahead of Perth from 22:00, and the hospital day is the one that counts.
 * `zone` is for tests and callers that already hold it.
 */
export function onCallLocalDateKey(now: Date, zone: string = currentWorkTimeZone()): string {
  return zonedDateOf(now, zone);
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * The instant the work-zone hour holding `now` began, in milliseconds. Not
 * `setMinutes(0)` on the device clock: Adelaide and Darwin hours start on the
 * half hour in UTC, and the phone may be in neither. Australian daylight saving
 * moves by a whole hour, so stepping an hour of real time from here always lands
 * on the next top of the hour in the zone.
 */
export function onCallZonedHourStart(now: Date | number, zone: string = currentWorkTimeZone()): number {
  const ms = typeof now === "number" ? now : now.getTime();
  const offsetMs = zoneOffsetMinutes(ms, zone) * 60_000;
  const wall = ms + offsetMs;
  return wall - (((wall % HOUR_MS) + HOUR_MS) % HOUR_MS) - offsetMs;
}

/**
 * Milliseconds until the next midnight in the work time zone, when
 * `onCallLocalDateKey` starts returning a different day. A page left open
 * overnight uses this to move "today" instead of keeping the day it opened on.
 * Never less than one second, so a timer set from it cannot spin.
 */
export function msUntilNextOnCallLocalDay(now: Date, zone: string = currentWorkTimeZone()): number {
  const today = zonedDateOf(now, zone);
  const tomorrow = new Date(
    Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)) + 1),
  )
    .toISOString()
    .slice(0, 10);
  // Australian daylight saving changes at 02:00 or 03:00, so midnight always exists.
  const midnight = Date.parse(zonedWallToIso(tomorrow, "00:00", zone) ?? `${tomorrow}T00:00:00.000Z`);
  return Math.max(1000, midnight - now.getTime());
}
