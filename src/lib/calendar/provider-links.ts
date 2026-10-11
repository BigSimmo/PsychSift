import {
  allDayEndExclusive,
  CALENDAR_TIME_ZONE,
  eventUtcRange,
  type CalendarEvent,
} from "@/lib/calendar/calendar-event";
import { compactDate, compactUtc, recurrenceRule } from "@/lib/calendar/ics";

/**
 * "Add to Google Calendar" and "Add to Outlook" links: the public pages each
 * provider offers for creating one event, pre-filled from the URL.
 *
 * Opening one sends the event's title, time and notes to that provider, so the
 * app only ever does it when the owner taps the link, and the calendar sheet
 * says so beside the buttons. Nothing is sent in the background, and no
 * account is connected — that is the later, separate step `CalendarSource`
 * leaves room for.
 */

export function googleCalendarUrl(event: CalendarEvent): string {
  const range = eventUtcRange(event);
  const dates = range
    ? `${compactUtc(range.start)}/${compactUtc(range.end)}`
    : `${compactDate(event.date)}/${compactDate(allDayEndExclusive(event))}`;
  const params = new URLSearchParams({ action: "TEMPLATE", text: event.title, dates, ctz: CALENDAR_TIME_ZONE });
  if (event.notes) params.set("details", event.notes);
  if (event.location) params.set("location", event.location);
  if (event.recurrence)
    params.set("recur", `RRULE:${recurrenceRule(event.recurrence, event.seriesStartDate ?? event.date)}`);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Outlook on the web (work and school accounts, which is what a health service
 * issues). Its compose link cannot carry a repeat rule, so a repeating event
 * opens as its first occurrence; the sheet says to set the repeat in Outlook,
 * or to use the calendar file, which does carry it.
 */
export function outlookCalendarUrl(event: CalendarEvent): string {
  const range = eventUtcRange(event);
  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: event.title,
  });
  if (range) {
    params.set("startdt", range.start.toISOString());
    params.set("enddt", range.end.toISOString());
  } else {
    params.set("startdt", event.date);
    params.set("enddt", allDayEndExclusive(event));
    params.set("allday", "true");
  }
  if (event.notes) params.set("body", event.notes);
  if (event.location) params.set("location", event.location);
  return `https://outlook.office.com/calendar/0/deeplink/compose?${params.toString()}`;
}
