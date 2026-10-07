import { zoneShort } from "@/lib/work-time/format";
import { WORK_TIME_ZONES, workTimeZoneLabel } from "@/lib/work-time/zones";

/** "Perth (AWST)": the zone's label and its abbreviation at `now`. */
export function formatWorkZoneValue(zone: string, now: number = Date.now()): string {
  return `${workTimeZoneLabel(zone)} (${zoneShort(zone, now)})`;
}

/**
 * A friendly name for the phone's own zone: the settings label for an
 * Australian zone ("Sydney and Canberra"), otherwise the city part of the
 * IANA id ("America/New_York" reads "New York").
 */
export function deviceZoneLabel(zone: string): string {
  const known = WORK_TIME_ZONES.find((option) => option.id === zone);
  if (known) return known.label;
  const city = zone.split("/").pop() ?? zone;
  return city.replace(/_/g, " ");
}

/** "AEDT, daylight saving" in summer, "AEST" otherwise. */
export function zoneAbbreviationLine(zone: string, now: number = Date.now()): string {
  const short = zoneShort(zone, now);
  return short.endsWith("DT") ? `${short}, daylight saving` : short;
}

/** The line under the time zone setting: the device hint when the phone is on another clock, else the note. */
export function workZoneNote(zone: string, deviceZone: string | null, differs: boolean): string {
  return differs && deviceZone
    ? `This phone is on ${deviceZoneLabel(deviceZone)} time. Shifts show in ${workTimeZoneLabel(zone)} time.`
    : "Roster and shift times show in this time zone, whatever your phone is set to.";
}
