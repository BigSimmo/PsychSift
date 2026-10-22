import { addDays } from "@/lib/calendar/calendar-event";
import { compactDate, compactUtc, escapeIcsText, foldIcsLine, icsFileName } from "@/lib/calendar/ics";
import type { LearningDirectoryItem } from "@/lib/cme/learning-directory";

const UID_DOMAIN = "psychiatry.tools";
const PRODUCT_ID = "-//PsychSift//Learning//EN";
const PERTH_OFFSET_HOURS = 8;

/** A confirmed dated course or event can be exported; guessed dates never can. */
export function canAddLearningToCalendar(item: LearningDirectoryItem): boolean {
  return item.datesConfirmed && item.startsOn !== null && !item.cancelled;
}

function perthWallTimeUtc(date: string, time: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return compactUtc(new Date(Date.UTC(year, month - 1, day, hour - PERTH_OFFSET_HOURS, minute)));
}

/**
 * One deterministic, public-only event. The stable UID lets a calendar update
 * an existing import. The alert is one day before the start, including for
 * all-day events; no CPD activity or private data enters the file.
 */
export function learningCalendarEventIcs(item: LearningDirectoryItem): string | null {
  if (!canAddLearningToCalendar(item)) return null;
  const startDate = item.startsOn!;
  const endDate = item.endsOn ?? startDate;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODUCT_ID}`,
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${item.id}@${UID_DOMAIN}`,
    `DTSTAMP:${compactDate(item.lastCheckedOn)}T000000Z`,
  ];
  if (item.startsAt && item.endsAt) {
    lines.push(
      `DTSTART:${perthWallTimeUtc(startDate, item.startsAt)}`,
      `DTEND:${perthWallTimeUtc(endDate, item.endsAt)}`,
    );
  } else {
    lines.push(`DTSTART;VALUE=DATE:${compactDate(startDate)}`);
    lines.push(`DTEND;VALUE=DATE:${compactDate(addDays(endDate, 1))}`);
  }
  lines.push(`SUMMARY:${escapeIcsText(item.title)}`);
  if (item.location) lines.push(`LOCATION:${escapeIcsText(item.location)}`);
  lines.push(
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "TRIGGER:-P1D",
    `DESCRIPTION:${escapeIcsText(item.title)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  );
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}

export function learningCalendarFileName(item: Pick<LearningDirectoryItem, "title">): string {
  return icsFileName(item.title);
}
