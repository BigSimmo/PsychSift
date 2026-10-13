import {
  allDayEndExclusive,
  eventUtcRange,
  type CalendarEvent,
  type CalendarRecurrence,
} from "@/lib/calendar/calendar-event";

/**
 * An iCalendar (RFC 5545) file for a set of events: the one format every
 * calendar — Apple, Google, Outlook — imports. Built on the device and handed
 * to the owner as a download; nothing is sent anywhere.
 *
 * Timed events are written in UTC (`Z`) rather than with a `TZID`, which is
 * exact for Perth (no daylight saving) and avoids shipping a VTIMEZONE block.
 */

const PRODUCT_ID = "-//PsychSift//Calendar//EN";
const UID_DOMAIN = "psychiatry.tools";

/** RFC 5545 §3.3.11: backslash, semicolon and comma are escaped; newlines become `\n`. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/**
 * RFC 5545 §3.1: lines longer than 75 octets are folded with CRLF + one space.
 * Counted in UTF-8 bytes, and never splitting a multi-byte character.
 */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  let currentBytes = 0;
  for (const character of line) {
    const bytes = encoder.encode(character).length;
    // The first line may hold 75 octets; continuation lines lose one to the leading space.
    const limit = parts.length === 0 ? 75 : 74;
    if (currentBytes + bytes > limit) {
      parts.push(current);
      current = "";
      currentBytes = 0;
    }
    current += character;
    currentBytes += bytes;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

export function compactDate(date: string): string {
  return date.replace(/-/g, "");
}

export function compactUtc(instant: Date): string {
  return instant
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

/**
 * The repeat rule for a series starting on `startDate` (`YYYY-MM-DD`).
 *
 * A monthly series from the 29th, 30th or 31st needs more than `FREQ=MONTHLY`.
 * RFC 5545 skips a month that lacks the start day, so a bare rule from 31 January
 * never lands in February, April, June, September or November, while the app
 * (`addMonthsClamped`) shows those months on their last day. "The last of the
 * 28th up to the start day that this month has" (`BYMONTHDAY` + `BYSETPOS=-1`)
 * is that same clamp written as a rule, so the file and the app agree.
 */
export function recurrenceRule(recurrence: CalendarRecurrence, startDate?: string): string {
  switch (recurrence) {
    case "weekly":
      return "FREQ=WEEKLY";
    case "fortnightly":
      return "FREQ=WEEKLY;INTERVAL=2";
    case "monthly":
      return `FREQ=MONTHLY${monthEndClamp(startDate)}`;
    case "quarterly":
      return `FREQ=MONTHLY;INTERVAL=3${monthEndClamp(startDate)}`;
  }
}

function monthEndClamp(startDate: string | undefined): string {
  const day = Number(startDate?.slice(8, 10));
  if (!Number.isInteger(day) || day <= 28 || day > 31) return "";
  const days = Array.from({ length: day - 27 }, (_, index) => 28 + index);
  return `;BYMONTHDAY=${days.join(",")};BYSETPOS=-1`;
}

/**
 * RFC 5545 §3.6.6: a display alarm at an absolute UTC instant, one VALARM
 * block per instant in `[alarmAt, ...alarmsAt]`. Written only when the event
 * carries at least one alarm instant, so an event with neither field is
 * byte-for-byte what it was before either existed.
 */
function alarmLines(event: CalendarEvent): string[] {
  const instants = [event.alarmAt, ...(event.alarmsAt ?? [])];
  const lines: string[] = [];
  for (const value of instants) {
    if (!value) continue;
    const instant = new Date(value);
    if (Number.isNaN(instant.getTime())) continue;
    lines.push(
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `TRIGGER;VALUE=DATE-TIME:${compactUtc(instant)}`,
      `DESCRIPTION:${escapeIcsText(event.title)}`,
      "END:VALARM",
    );
  }
  return lines;
}

function eventLines(event: CalendarEvent, stamp: Date): string[] {
  const lines = ["BEGIN:VEVENT", `UID:${event.id}@${UID_DOMAIN}`, `DTSTAMP:${compactUtc(stamp)}`];
  const range = eventUtcRange(event);
  if (range) {
    lines.push(`DTSTART:${compactUtc(range.start)}`, `DTEND:${compactUtc(range.end)}`);
  } else {
    // All-day: DTEND is the day after, exclusive.
    lines.push(
      `DTSTART;VALUE=DATE:${compactDate(event.date)}`,
      `DTEND;VALUE=DATE:${compactDate(allDayEndExclusive(event))}`,
    );
  }
  if (event.seriesOccurrence) {
    // Overrides the series occurrence that starts at this same moment (RFC 5545 §3.8.4.4).
    lines.push(
      range ? `RECURRENCE-ID:${compactUtc(range.start)}` : `RECURRENCE-ID;VALUE=DATE:${compactDate(event.date)}`,
    );
  } else if (event.recurrence) {
    lines.push(`RRULE:${recurrenceRule(event.recurrence, event.seriesStartDate ?? event.date)}`);
  }
  lines.push(`SUMMARY:${escapeIcsText(event.title)}`);
  if (event.status === "cancelled") lines.push("STATUS:CANCELLED");
  if (event.location) lines.push(`LOCATION:${escapeIcsText(event.location)}`);
  if (event.notes) lines.push(`DESCRIPTION:${escapeIcsText(event.notes)}`);
  // A cancelled event never rings, whatever reminder settings gave it: an alarm would send a
  // doctor to an empty room.
  if (event.status !== "cancelled") lines.push(...alarmLines(event));
  lines.push("END:VEVENT");
  return lines;
}

export function toIcs(
  events: readonly CalendarEvent[],
  options: { name?: string; now?: Date; refreshHours?: number } = {},
): string {
  const stamp = options.now ?? new Date();
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:${PRODUCT_ID}`, "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  if (options.name) lines.push(`X-WR-CALNAME:${escapeIcsText(options.name)}`);
  // A subscribed feed asks the calendar app to re-read it this often. Apple and
  // Outlook honour it; Google keeps its own schedule (roughly daily).
  if (options.refreshHours && Number.isInteger(options.refreshHours) && options.refreshHours > 0) {
    lines.push(
      `REFRESH-INTERVAL;VALUE=DURATION:PT${options.refreshHours}H`,
      `X-PUBLISHED-TTL:PT${options.refreshHours}H`,
    );
  }
  for (const event of events) lines.push(...eventLines(event, stamp));
  lines.push("END:VCALENDAR");
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}

/** A file name safe on every platform: letters, digits and hyphens. */
export function icsFileName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "calendar"}.ics`;
}
