import { APP_PREFERENCES_STORAGE_KEY } from "@/lib/account-scoped-browser-state";
import { zonedToday } from "@/lib/work-time/format";
import { DEFAULT_WORK_TIME_ZONE, isWorkTimeZone } from "@/lib/work-time/zones";

/**
 * The work time zone for code outside React (lib helpers, timers), read from
 * the device's cached account preferences. On the server, before hydration,
 * signed out with nothing chosen, or with storage blocked it is Perth. React
 * screens use `useWorkTimeZone()` instead so they re-render when it changes.
 */
export function currentWorkTimeZone(): string {
  if (typeof window === "undefined") return DEFAULT_WORK_TIME_ZONE;
  try {
    const raw = window.localStorage.getItem(APP_PREFERENCES_STORAGE_KEY);
    const zone = raw ? (JSON.parse(raw) as { timeZone?: unknown } | null)?.timeZone : undefined;
    return isWorkTimeZone(zone) ? zone : DEFAULT_WORK_TIME_ZONE;
  } catch {
    return DEFAULT_WORK_TIME_ZONE;
  }
}

/**
 * This calendar year in the work time zone, for lib defaults that need a work
 * or CPD year. On New Year's Eve a phone still on Sydney time is already in the
 * new year for three hours while Perth is not, so never `getFullYear()`.
 */
export function currentWorkYear(now: number = Date.now(), zone: string = currentWorkTimeZone()): number {
  return Number(zonedToday(zone, now).slice(0, 4));
}
