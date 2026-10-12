import type { CalendarEvent } from "@/lib/calendar/calendar-event";
import { perthDateOf, perthTimeOf } from "@/lib/roster/shifts/perth-time";

import { endsNextDay, formatHours, gradeLabel, hoursBetween, kindLabel, type OpenShiftListing } from "./model";

/**
 * Sharing an open shift and putting a booked one in a phone calendar (12 Oct
 * 2026). Both carry only what the advert already shows: the shift, the site and
 * the team. Never a patient detail, never pay.
 */

type Shareable = Pick<
  OpenShiftListing,
  "id" | "startsAt" | "endsAt" | "minGrade" | "kind" | "siteName" | "teamName" | "urgent"
>;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function shortDay(date: string): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return `${WEEKDAYS[weekday]} ${day} ${MONTHS[month - 1]}`;
}

function title(listing: Shareable): string {
  return `${gradeLabel(listing.minGrade)} · ${kindLabel(listing.kind)}`;
}

/** "Registrar · Night shift, Tue 13 Oct, 21:30 to 08:00 next day (10.5 h), Example Health Campus · ED team." */
export function openShiftShareText(listing: Shareable, link: string | null = null): string {
  const times = `${perthTimeOf(listing.startsAt)} to ${perthTimeOf(listing.endsAt)}${endsNextDay(listing.startsAt, listing.endsAt) ? " next day" : ""}`;
  const place = [listing.siteName, listing.teamName].filter(Boolean).join(" · ");
  const lines = [
    `Open shift${listing.urgent ? " (urgent)" : ""}: ${title(listing)}, ${shortDay(perthDateOf(listing.startsAt))}, ${times} (${formatHours(hoursBetween(listing.startsAt, listing.endsAt))})${place ? `, ${place}` : ""}.`,
    "Request it in PsychSift, Roster, Open shifts.",
  ];
  if (link) lines.push(link);
  return lines.join("\n");
}

/** One calendar event for a booked extra shift. The id is stable, so adding it again updates it. */
export function openShiftCalendarEvent(listing: Shareable): CalendarEvent {
  const place = [listing.siteName, listing.teamName].filter(Boolean).join(" · ");
  return {
    id: `psychsift-open-shift-${listing.id}`,
    title: `${title(listing)} (extra shift)`,
    date: perthDateOf(listing.startsAt),
    startTime: perthTimeOf(listing.startsAt),
    durationMinutes: Math.round((Date.parse(listing.endsAt) - Date.parse(listing.startsAt)) / 60_000),
    kind: "other",
    ...(place ? { location: place } : {}),
  };
}
