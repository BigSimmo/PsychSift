/**
 * The work time zone: the zone every roster, shift and "today" in work mode is
 * read in, whatever the phone itself is set to.
 *
 * Shift times are hospital wall-clock times. A doctor whose phone is still on
 * Sydney time after a trip must still see an 08:00 Perth shift at 08:00, so no
 * work screen may use the device zone. The default is Perth because the app is
 * built for WA hospitals; the other Australian zones are here for doctors who
 * work elsewhere. Saved to the account as `preferences.timeZone`.
 */

export const DEFAULT_WORK_TIME_ZONE = "Australia/Perth";

export type WorkTimeZoneOption = {
  /** IANA zone id. */
  readonly id: string;
  /** What the settings list shows. */
  readonly label: string;
  /** Standard-time abbreviation, used when the live one cannot be read. */
  readonly short: string;
};

export const WORK_TIME_ZONES: readonly WorkTimeZoneOption[] = [
  { id: "Australia/Perth", label: "Perth", short: "AWST" },
  { id: "Australia/Darwin", label: "Darwin", short: "ACST" },
  { id: "Australia/Adelaide", label: "Adelaide", short: "ACST" },
  { id: "Australia/Brisbane", label: "Brisbane", short: "AEST" },
  { id: "Australia/Sydney", label: "Sydney and Canberra", short: "AEST" },
  { id: "Australia/Melbourne", label: "Melbourne", short: "AEST" },
  { id: "Australia/Hobart", label: "Hobart", short: "AEST" },
];

export function isWorkTimeZone(value: unknown): value is string {
  return typeof value === "string" && WORK_TIME_ZONES.some((option) => option.id === value);
}

/** The option for a zone id, falling back to Perth for anything unknown. */
export function workTimeZoneOption(zone: string): WorkTimeZoneOption {
  return WORK_TIME_ZONES.find((option) => option.id === zone) ?? WORK_TIME_ZONES[0]!;
}

/** "Perth" for a zone id. Unknown ids read as Perth, the zone they fall back to. */
export function workTimeZoneLabel(zone: string): string {
  return workTimeZoneOption(zone).label;
}

/** The phone's own zone, or null where the browser will not say (or on the server). */
export function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}
