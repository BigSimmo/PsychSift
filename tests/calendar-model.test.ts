import { describe, expect, it } from "vitest";

import {
  addMonthsClamped,
  eventUtcRange,
  expandEvents,
  formatEventTime,
  type CalendarEvent,
} from "@/lib/calendar/calendar-event";
import { escapeIcsText, foldIcsLine, icsFileName, toIcs } from "@/lib/calendar/ics";
import { monthGrid, monthGridRange, shiftMonth } from "@/lib/calendar/month-grid";
import { googleCalendarUrl, outlookCalendarUrl } from "@/lib/calendar/provider-links";

const NOW = new Date("2026-09-25T02:00:00Z");

const TIMED: CalendarEvent = {
  id: "teaching-1",
  title: "Registrar teaching",
  date: "2026-09-30",
  startTime: "12:30",
  durationMinutes: 90,
  kind: "teaching",
  location: "Room 4, Fiona Stanley",
  notes: "Bring cases; lunch provided",
};

const ALL_DAY: CalendarEvent = { id: "cpd-end", title: "End of the CPD year", date: "2026-12-31", kind: "deadline" };

describe("calendar dates", () => {
  it("converts a Perth wall-clock time to UTC by eight hours", () => {
    const range = eventUtcRange(TIMED)!;
    expect(range.start.toISOString()).toBe("2026-09-30T04:30:00.000Z");
    expect(range.end.toISOString()).toBe("2026-09-30T06:00:00.000Z");
    expect(eventUtcRange(ALL_DAY)).toBeNull();
  });

  it("clamps a monthly series anchored on the 31st to the end of short months", () => {
    expect(addMonthsClamped("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsClamped("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonthsClamped("2026-01-31", 2)).toBe("2026-03-31");
  });

  it("expands repeating events inside a range only, with a distinct key per occurrence", () => {
    const events = expandEvents([{ ...TIMED, date: "2026-09-02", recurrence: "fortnightly" }, ALL_DAY], {
      start: "2026-09-01",
      end: "2026-09-30",
    });
    expect(events.map((event) => event.date)).toEqual(["2026-09-02", "2026-09-16", "2026-09-30"]);
    expect(new Set(events.map((event) => event.occurrenceKey)).size).toBe(3);
  });

  it("still shows a long-running series far from its first date", () => {
    // Counting occurrences from the anchor gave up after 400, so a weekly series
    // started ten years ago vanished from the calendar.
    const weekly = expandEvents([{ ...TIMED, date: "2016-09-06", recurrence: "weekly" }], {
      start: "2026-09-01",
      end: "2026-09-30",
    });
    expect(weekly.map((event) => event.date)).toEqual([
      "2026-09-01",
      "2026-09-08",
      "2026-09-15",
      "2026-09-22",
      "2026-09-29",
    ]);
    const monthly = expandEvents([{ ...TIMED, date: "1990-01-31", recurrence: "monthly" }], {
      start: "2026-02-01",
      end: "2026-04-30",
    });
    expect(monthly.map((event) => event.date)).toEqual(["2026-02-28", "2026-03-31", "2026-04-30"]);
  });

  it("drops an event whose date does not exist", () => {
    expect(expandEvents([{ ...ALL_DAY, date: "2026-02-30" }], { start: "2026-01-01", end: "2026-12-31" })).toEqual([]);
  });

  it("formats times in 24-hour time", () => {
    expect(formatEventTime("12:30")).toBe("12:30");
    expect(formatEventTime("00:05")).toBe("00:05");
    expect(formatEventTime("9:00")).toBe("09:00");
  });
});

describe("calendar file", () => {
  it("escapes the characters the format reserves", () => {
    expect(escapeIcsText("a;b,c\\d\ne")).toBe("a\\;b\\,c\\\\d\\ne");
  });

  it("folds long lines at 75 bytes without splitting a character", () => {
    const folded = foldIcsLine(`SUMMARY:${"é".repeat(60)}`);
    for (const line of folded.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, "")).toBe(`SUMMARY:${"é".repeat(60)}`);
  });

  it("writes timed events in UTC and all-day events as dates, with a repeat rule", () => {
    const ics = toIcs([{ ...TIMED, recurrence: "fortnightly" }, ALL_DAY], { name: "CME", now: NOW });
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("DTSTART:20260930T043000Z");
    expect(ics).toContain("DTEND:20260930T060000Z");
    expect(ics).toContain("RRULE:FREQ=WEEKLY;INTERVAL=2");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261231");
    expect(ics).toContain("DTEND;VALUE=DATE:20270101");
    expect(ics).toContain("UID:teaching-1@psychiatry.tools");
    expect(ics).toContain("DTSTAMP:20260925T020000Z");
    expect(ics).toContain("LOCATION:Room 4\\, Fiona Stanley");
    expect(ics).toContain("DESCRIPTION:Bring cases\\; lunch provided");
    expect(ics.split("\r\n").filter((line) => line === "BEGIN:VEVENT")).toHaveLength(2);
  });

  it("keeps a monthly series on the 29th to 31st clamped to short months, as the app shows it", () => {
    // A bare FREQ=MONTHLY from the 31st makes every calendar app skip the months
    // without a 31st, while the app clamps them to the last day. Both must agree.
    const monthly = toIcs([{ ...TIMED, date: "2026-01-31", recurrence: "monthly" }], { now: NOW });
    expect(monthly).toContain("RRULE:FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1");
    const quarterly = toIcs([{ ...TIMED, date: "2026-08-30", recurrence: "quarterly" }], { now: NOW });
    expect(quarterly).toContain("RRULE:FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=28,29,30;BYSETPOS=-1");
    // Up to the 28th every month has the day, so the plain rule is already exact.
    expect(toIcs([{ ...TIMED, date: "2026-01-28", recurrence: "monthly" }], { now: NOW })).toContain(
      "RRULE:FREQ=MONTHLY\r\n",
    );
  });

  it("exports a February occurrence using the original January 31 series rule", () => {
    const [february] = expandEvents([{ ...TIMED, date: "2026-01-31", recurrence: "monthly" }], {
      start: "2026-02-28",
      end: "2026-02-28",
    });
    expect(february.date).toBe("2026-02-28");
    expect(february.seriesStartDate).toBe("2026-01-31");
    expect(toIcs([february], { now: NOW })).toContain("RRULE:FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1");
    expect(new URL(googleCalendarUrl(february)).searchParams.get("recur")).toBe(
      "RRULE:FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1",
    );
  });

  it("names the file safely", () => {
    expect(icsFileName("CME: 2026 deadlines!")).toBe("cme-2026-deadlines.ics");
    expect(icsFileName("***")).toBe("calendar.ics");
  });
});

describe("provider links", () => {
  it("builds a Google link with UTC times, the Perth zone and the repeat rule", () => {
    const url = new URL(googleCalendarUrl({ ...TIMED, recurrence: "monthly" }));
    expect(url.origin).toBe("https://calendar.google.com");
    expect(url.searchParams.get("dates")).toBe("20260930T043000Z/20260930T060000Z");
    expect(url.searchParams.get("ctz")).toBe("Australia/Perth");
    // From the 30th, clamped so February is not skipped (see `recurrenceRule`).
    expect(url.searchParams.get("recur")).toBe("RRULE:FREQ=MONTHLY;BYMONTHDAY=28,29,30;BYSETPOS=-1");
    expect(url.searchParams.get("text")).toBe("Registrar teaching");
  });

  it("builds a Google all-day link with an exclusive end date", () => {
    expect(new URL(googleCalendarUrl(ALL_DAY)).searchParams.get("dates")).toBe("20261231/20270101");
  });

  it("builds an Outlook link for timed and all-day events", () => {
    const timed = new URL(outlookCalendarUrl(TIMED));
    expect(timed.hostname).toBe("outlook.office.com");
    expect(timed.searchParams.get("startdt")).toBe("2026-09-30T04:30:00.000Z");
    expect(timed.searchParams.get("subject")).toBe("Registrar teaching");
    const allDay = new URL(outlookCalendarUrl(ALL_DAY));
    expect(allDay.searchParams.get("allday")).toBe("true");
    expect(allDay.searchParams.get("enddt")).toBe("2027-01-01");
  });
});

describe("month grid", () => {
  it("lays September 2026 out Monday-first in whole weeks", () => {
    const weeks = monthGrid("2026-09");
    expect(weeks[0][0]).toEqual({ date: "2026-08-31", inMonth: false });
    expect(weeks[0][1]).toEqual({ date: "2026-09-01", inMonth: true });
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(monthGridRange("2026-09")).toEqual({ start: "2026-08-31", end: "2026-10-04" });
  });

  it("moves across year boundaries", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });
});
