import {
  addDaysToDate as sharedAddDaysToDate,
  formatPerthDay as sharedFormatPerthDay,
  PERTH_OFFSET_MS,
  PERTH_TIME_ZONE,
  PERTH_UTC_OFFSET_MINUTES,
  perthCalendarDate as sharedPerthCalendarDate,
  perthDateOf as sharedPerthDateOf,
  perthTimeOf as sharedPerthTimeOf,
  perthWallToIso as sharedPerthWallToIso,
} from "@/lib/perth-time";

export { PERTH_OFFSET_MS, PERTH_TIME_ZONE, PERTH_UTC_OFFSET_MINUTES };

export const OFFSET_MS = PERTH_OFFSET_MS;
export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/*
 * Each wrapper passes `zone` through; leaving it out reads the work time zone
 * (Perth by default). See `@/lib/perth-time`.
 */

/** `YYYY-MM-DD` + `HH:MM` on the work zone's wall clock → ISO instant, or null for an impossible date or time. */
export function perthWallToIso(date: string, time: string, zone?: string): string | null {
  return sharedPerthWallToIso(date, time, zone);
}

/** The work-zone calendar date of an instant, `YYYY-MM-DD`. */
export function perthDateOf(instant: string | Date, zone?: string): string {
  return sharedPerthDateOf(instant, zone);
}

/** The work-zone wall-clock time of an instant, `HH:MM`. */
export function perthTimeOf(instant: string | Date, zone?: string): string {
  return sharedPerthTimeOf(instant, zone);
}

/** `YYYY-MM-DD` plus `days`. */
export function addDaysToDate(date: string, days: number): string {
  return sharedAddDaysToDate(date, days);
}

/** "Mon 3 Oct" for a Perth date. */
export function formatPerthDay(date: string): string {
  return sharedFormatPerthDay(date);
}

export function perthCalendarDate(date: string | Date, zone?: string): string {
  return sharedPerthCalendarDate(date, zone);
}
