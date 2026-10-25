import { describe, expect, it } from "vitest";

import { expandEvents, type CalendarEvent } from "@/lib/calendar/calendar-event";
import { toIcs } from "@/lib/calendar/ics";
import { cmeDeadlineEvents, cmeLoggedEvents, cmeRoutineEvents } from "@/lib/cme/calendar-events";
import { createAustralianRanzcpPreset } from "@/lib/cme/presets";
import { onCallExpiryEvents, onCallTeachingEvents } from "@/lib/on-call/calendar-events";
import { DEMO_ON_CALL_ENTRIES } from "@/lib/on-call/demo-entries";
import type { OnCallEntry } from "@/lib/on-call/entry-model";
import {
  onCallNotificationReminderType,
  visibleOnCallNotifications,
  type OnCallNotification,
} from "@/lib/on-call/notifications";
import {
  alarmFor,
  applyQuietHours,
  applyReminderAlarms,
  DEFAULT_REMINDER_SETTINGS,
  isSnoozed,
  mergeReminderSettings,
  normalizeReminderSettings,
  perthDateKey,
  REMINDER_TYPES,
  resumeReminder,
  showsReminderInApp,
  snoozeReminder,
  updateReminderType,
  type ReminderLeadTime,
  type ReminderSettings,
  type ReminderType,
} from "@/lib/reminders/settings";

// Invented events only. Perth is UTC+8, so 12:30 Perth is 04:30Z.
const TIMED: CalendarEvent = {
  id: "teaching-1",
  title: "Registrar teaching",
  date: "2026-10-10",
  startTime: "12:30",
  kind: "teaching",
  reminderType: "teaching",
};
const ALL_DAY: CalendarEvent = {
  id: "deadline-1",
  title: "End of the CPD year",
  date: "2026-10-10",
  kind: "deadline",
  reminderType: "cpd-year-end",
};

/** A settings object with one type's alert set, everything else default. */
function withAlert(
  type: ReminderType,
  lead: ReminderLeadTime,
  extra: Partial<ReminderSettings> = {},
): ReminderSettings {
  return { ...updateReminderType(DEFAULT_REMINDER_SETTINGS, type, { calendarAlert: lead }), ...extra };
}

const EARLY = new Date("2026-09-01T00:00:00Z");

describe("alarmFor: lead times", () => {
  it.each([
    ["at-time", "2026-10-10T04:30:00.000Z"],
    ["1h", "2026-10-10T03:30:00.000Z"],
    ["1d", "2026-10-09T04:30:00.000Z"],
    ["1w", "2026-10-03T04:30:00.000Z"],
  ] as const)("%s before a timed event", (lead, expected) => {
    expect(alarmFor(TIMED, withAlert("teaching", lead))?.toISOString()).toBe(expected);
  });

  it("anchors an all-day event at 09:00 Perth", () => {
    expect(alarmFor(ALL_DAY, withAlert("cpd-year-end", "at-time"))?.toISOString()).toBe("2026-10-10T01:00:00.000Z");
    expect(alarmFor(ALL_DAY, withAlert("cpd-year-end", "1d"))?.toISOString()).toBe("2026-10-09T01:00:00.000Z");
    expect(alarmFor(ALL_DAY, withAlert("cpd-year-end", "1h"))?.toISOString()).toBe("2026-10-10T00:00:00.000Z");
  });

  it("gives no alarm when the type's alert is off, or the event has no reminder type", () => {
    expect(alarmFor(TIMED, DEFAULT_REMINDER_SETTINGS)).toBeNull();
    expect(alarmFor({ ...TIMED, reminderType: undefined }, withAlert("teaching", "1d"))).toBeNull();
    expect(alarmFor(TIMED, withAlert("cpd-routines", "1d"))).toBeNull();
  });
});

describe("quiet hours", () => {
  const overnight = { enabled: true, start: "21:00", end: "07:00" };
  // Perth wall-clock `HH:MM` on 10 Oct 2026, as a UTC instant.
  const perth = (time: string, day = "2026-10-10") => Date.parse(`${day}T${time}:00+08:00`);

  it("moves an early-morning alarm to the end of an overnight window", () => {
    expect(new Date(applyQuietHours(perth("06:30"), overnight)).toISOString()).toBe(
      new Date(perth("07:00")).toISOString(),
    );
  });

  it("moves a late-evening alarm across midnight to the next morning", () => {
    expect(applyQuietHours(perth("23:00"), overnight)).toBe(perth("07:00", "2026-10-11"));
    expect(applyQuietHours(perth("21:00"), overnight)).toBe(perth("07:00", "2026-10-11"));
  });

  it("leaves alarms outside the window, and at its very end, alone", () => {
    expect(applyQuietHours(perth("07:00"), overnight)).toBe(perth("07:00"));
    expect(applyQuietHours(perth("20:59"), overnight)).toBe(perth("20:59"));
    expect(applyQuietHours(perth("12:00"), overnight)).toBe(perth("12:00"));
  });

  it("handles a daytime window that does not cross midnight", () => {
    const lunch = { enabled: true, start: "12:00", end: "14:00" };
    expect(applyQuietHours(perth("12:30"), lunch)).toBe(perth("14:00"));
    expect(applyQuietHours(perth("11:59"), lunch)).toBe(perth("11:59"));
  });

  it("does nothing when off, or when the window is empty", () => {
    expect(applyQuietHours(perth("23:00"), { ...overnight, enabled: false })).toBe(perth("23:00"));
    expect(applyQuietHours(perth("23:00"), { enabled: true, start: "08:00", end: "08:00" })).toBe(perth("23:00"));
  });

  it("is applied after the lead time", () => {
    // 1 hour before a 07:30 session is 06:30, inside 21:00-07:00, so it moves to 07:00.
    const early = { ...TIMED, startTime: "07:30" };
    const settings = withAlert("teaching", "1h", { quietHours: overnight });
    expect(alarmFor(early, settings)?.getTime()).toBe(perth("07:00"));
  });
});

describe("applyReminderAlarms", () => {
  it("changes nothing with the default settings", () => {
    const events = [TIMED, ALL_DAY];
    const result = applyReminderAlarms(events, DEFAULT_REMINDER_SETTINGS, EARLY);
    expect(result).toEqual(events);
    expect(result.some((event) => "alarmAt" in event)).toBe(false);
  });

  it("keeps the highest-priority alarms when a day is over the cap", () => {
    const sameDay = (id: string, reminderType: ReminderType): CalendarEvent => ({
      id,
      title: id,
      date: "2026-10-10",
      kind: "other",
      reminderType,
    });
    const events = [
      sameDay("teaching", "teaching"),
      sameDay("routine", "cpd-routines"),
      sameDay("compliance", "compliance-dates"),
      sameDay("year-end", "cpd-year-end"),
    ];
    let settings: ReminderSettings = { ...DEFAULT_REMINDER_SETTINGS, maxAlertsPerDay: 2 };
    for (const type of REMINDER_TYPES) settings = updateReminderType(settings, type, { calendarAlert: "1d" });
    const result = applyReminderAlarms(events, settings, EARLY);
    const alarmed = result.filter((event) => event.alarmAt).map((event) => event.id);
    expect(alarmed).toEqual(["compliance", "year-end"]);
    expect(result.find((event) => event.id === "compliance")?.alarmAt).toBe("2026-10-09T01:00:00.000Z");
  });

  it("counts the cap per Perth day, not per file", () => {
    const events: CalendarEvent[] = [
      { ...ALL_DAY, id: "a" },
      { ...ALL_DAY, id: "b", date: "2026-10-11" },
    ];
    const result = applyReminderAlarms(events, withAlert("cpd-year-end", "at-time", { maxAlertsPerDay: 1 }), EARLY);
    expect(result.map((event) => Boolean(event.alarmAt))).toEqual([true, true]);
  });

  it("drops an alarm that is already in the past", () => {
    const result = applyReminderAlarms([ALL_DAY], withAlert("cpd-year-end", "1w"), new Date("2026-10-05T00:00:00Z"));
    expect(result[0].alarmAt).toBeUndefined();
  });

  it("gives each upcoming occurrence of a repeating event its own absolute alarm, after the unchanged series", () => {
    const weekly: CalendarEvent = {
      id: "routine",
      title: "Journal club",
      date: "2026-09-01",
      kind: "due",
      recurrence: "weekly",
      reminderType: "cpd-routines",
    };
    // 26 Sep 2026, 08:00 Perth. Occurrences fall on Tuesdays; the next is 29 Sep.
    const [series, first, second] = applyReminderAlarms(
      [weekly],
      withAlert("cpd-routines", "at-time"),
      new Date("2026-09-26T00:00:00Z"),
    );
    expect(series).toEqual(weekly);
    expect(first).toMatchObject({ id: "routine", date: "2026-09-29", seriesOccurrence: true });
    expect(first.recurrence).toBeUndefined();
    // 09:00 Perth on an all-day date.
    expect(first.alarmAt).toBe("2026-09-29T01:00:00.000Z");
    expect(second).toMatchObject({ date: "2026-10-06", alarmAt: "2026-10-06T01:00:00.000Z" });
  });

  it("never lets repeating series that converge on one day exceed the daily cap", () => {
    // Four monthly all-day events anchored 28-31 Jan all fall on 28 Feb.
    const series: CalendarEvent[] = [28, 29, 30, 31].map((day) => ({
      id: `monthly-${day}`,
      title: `Monthly ${day}`,
      date: `2027-01-${day}`,
      kind: "due",
      recurrence: "monthly",
      reminderType: "cpd-routines",
    }));
    const result = applyReminderAlarms(
      series,
      withAlert("cpd-routines", "at-time", { maxAlertsPerDay: 3 }),
      new Date("2027-01-01T00:00:00Z"),
    );
    expect(result.filter((event) => event.recurrence)).toEqual(series);
    const perDay = new Map<string, number>();
    for (const event of result) {
      if (!event.alarmAt) continue;
      const day = perthDateKey(new Date(event.alarmAt));
      perDay.set(day, (perDay.get(day) ?? 0) + 1);
    }
    expect(perDay.get("2027-02-28")).toBe(3);
    expect(Math.max(...perDay.values())).toBeLessThanOrEqual(3);
    // January's alarms fall on four different days, so all four keep theirs.
    expect(["2027-01-28", "2027-01-29", "2027-01-30", "2027-01-31"].map((day) => perDay.get(day))).toEqual([
      1, 1, 1, 1,
    ]);
    expect(result.every((event) => !event.recurrence || event.alarmAt === undefined)).toBe(true);
  });

  it("does not let a cancelled event take a real alarm's place under the daily cap", () => {
    const cancelled: CalendarEvent = { ...ALL_DAY, id: "cancelled-1", status: "cancelled" };
    const result = applyReminderAlarms(
      [cancelled, ALL_DAY],
      withAlert("cpd-year-end", "at-time", { maxAlertsPerDay: 1 }),
      EARLY,
    );
    expect(result[0].alarmAt).toBeUndefined();
    expect(result[1].alarmAt).toBeDefined();
  });

  it("gives a one-off event a single alarm and no occurrence overrides", () => {
    const result = applyReminderAlarms([TIMED], withAlert("teaching", "1h"), EARLY);
    expect(result).toHaveLength(1);
    expect(result[0].alarmAt).toBe("2026-10-10T03:30:00.000Z");
    expect(result[0].seriesOccurrence).toBeUndefined();
  });
});

describe("snooze and Show in the app", () => {
  it("snoozes for a week and shows again on the snooze date", () => {
    const snoozed = snoozeReminder(DEFAULT_REMINDER_SETTINGS, "cpd-routines", "2026-09-26");
    expect(snoozed.types["cpd-routines"].snoozedUntil).toBe("2026-10-03");
    expect(isSnoozed(snoozed, "cpd-routines", "2026-10-02")).toBe(true);
    expect(isSnoozed(snoozed, "cpd-routines", "2026-10-03")).toBe(false);
    expect(isSnoozed(snoozed, "teaching", "2026-09-27")).toBe(false);
    expect(resumeReminder(snoozed, "cpd-routines").types["cpd-routines"].snoozedUntil).toBeNull();
  });

  it("hides a type that is turned off, whatever the snooze says", () => {
    const off = updateReminderType(DEFAULT_REMINDER_SETTINGS, "cpd-year-end", { showInApp: false });
    expect(showsReminderInApp(off, "cpd-year-end", "2026-09-26")).toBe(false);
    expect(showsReminderInApp(DEFAULT_REMINDER_SETTINGS, "cpd-year-end", "2026-09-26")).toBe(true);
  });

  it("reads today in Perth, not UTC", () => {
    expect(perthDateKey(new Date("2026-09-25T16:30:00Z"))).toBe("2026-09-26");
    expect(perthDateKey(new Date("2026-09-25T15:59:00Z"))).toBe("2026-09-25");
  });
});

describe("normalizeReminderSettings", () => {
  it("keeps today's behaviour as the default", () => {
    expect(normalizeReminderSettings(undefined)).toEqual(DEFAULT_REMINDER_SETTINGS);
    for (const type of REMINDER_TYPES) {
      expect(DEFAULT_REMINDER_SETTINGS.types[type]).toEqual({
        showInApp: true,
        calendarAlert: "off",
        snoozedUntil: null,
      });
    }
    expect(DEFAULT_REMINDER_SETTINGS.quietHours.enabled).toBe(false);
    expect(DEFAULT_REMINDER_SETTINGS.maxAlertsPerDay).toBe(3);
  });

  it("replaces each bad value with its default, field by field", () => {
    const result = normalizeReminderSettings({
      types: {
        teaching: { showInApp: "no", calendarAlert: "2d", snoozedUntil: "2026-02-30" },
        "cpd-routines": { showInApp: false, calendarAlert: "1w", snoozedUntil: "2026-10-03" },
        "made-up": { showInApp: false },
      },
      quietHours: { enabled: "yes", start: "25:00", end: "06:00" },
      maxAlertsPerDay: 11,
    });
    expect(result.types.teaching).toEqual({ showInApp: true, calendarAlert: "off", snoozedUntil: null });
    expect(result.types["cpd-routines"]).toEqual({ showInApp: false, calendarAlert: "1w", snoozedUntil: "2026-10-03" });
    expect(Object.keys(result.types)).toEqual([...REMINDER_TYPES]);
    expect(result.quietHours).toEqual({ enabled: false, start: "21:00", end: "06:00" });
    expect(result.maxAlertsPerDay).toBe(3);
    expect(normalizeReminderSettings({ maxAlertsPerDay: 2.5 }).maxAlertsPerDay).toBe(3);
    expect(normalizeReminderSettings({ maxAlertsPerDay: 0 }).maxAlertsPerDay).toBe(3);
    expect(normalizeReminderSettings("nope")).toEqual(DEFAULT_REMINDER_SETTINGS);
  });

  it("merges a partial update without resetting what it omits", () => {
    const stored = updateReminderType(DEFAULT_REMINDER_SETTINGS, "compliance-dates", { calendarAlert: "1d" });
    const merged = mergeReminderSettings(stored, { types: { teaching: { showInApp: false } }, maxAlertsPerDay: 5 });
    expect(merged.types["compliance-dates"].calendarAlert).toBe("1d");
    expect(merged.types.teaching).toEqual({ showInApp: false, calendarAlert: "off", snoozedUntil: null });
    expect(merged.maxAlertsPerDay).toBe(5);
    expect(merged.quietHours).toEqual(stored.quietHours);
  });
});

describe("toIcs alarms", () => {
  const now = new Date("2026-09-25T00:00:00Z");

  it("writes a display alarm at the absolute UTC instant", () => {
    const text = toIcs([{ ...ALL_DAY, alarmAt: "2026-10-09T01:00:00.000Z" }], { now });
    expect(text).toContain(
      "BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER;VALUE=DATE-TIME:20261009T010000Z\r\nDESCRIPTION:End of the CPD year\r\nEND:VALARM\r\nEND:VEVENT\r\n",
    );
  });

  it("writes a series occurrence as a RECURRENCE-ID override with an absolute alarm and no RRULE", () => {
    const timed = toIcs(
      [
        { ...TIMED, recurrence: "weekly" },
        { ...TIMED, seriesOccurrence: true, alarmAt: "2026-10-10T03:30:00.000Z" },
      ],
      { now },
    );
    expect(timed.match(/UID:teaching-1@/g)).toHaveLength(2);
    expect(timed.match(/RRULE:/g)).toHaveLength(1);
    expect(timed).toContain("RECURRENCE-ID;TZID=Australia/Perth:20261010T123000\r\n");
    expect(timed.match(/BEGIN:VTIMEZONE/g)).toHaveLength(1);
    expect(timed).toContain("TRIGGER;VALUE=DATE-TIME:20261010T033000Z");
    expect(timed).not.toContain("RELATED=START");
    const allDay = toIcs([{ ...ALL_DAY, seriesOccurrence: true, alarmAt: "2026-10-10T01:00:00.000Z" }], { now });
    expect(allDay).toContain("RECURRENCE-ID;VALUE=DATE:20261010\r\n");
    expect(allDay).not.toContain("RRULE:");
  });

  it("writes no alarm for an event without one, or with an unreadable one", () => {
    expect(toIcs([ALL_DAY], { now })).not.toContain("VALARM");
    expect(toIcs([{ ...ALL_DAY, alarmAt: "not a date" }], { now })).not.toContain("VALARM");
  });

  it("leaves a file with no alarms byte-for-byte as before", () => {
    const withoutType = toIcs([{ ...TIMED, reminderType: undefined }], { now });
    expect(toIcs([TIMED], { now })).toBe(withoutType);
  });

  it("writes one VALARM per extra alarm instant, and an event without alarms is unchanged", () => {
    const text = toIcs([{ ...ALL_DAY, alarmAt: "2026-10-09T01:00:00.000Z", alarmsAt: ["2026-09-25T01:00:00.000Z"] }], {
      now,
    });
    expect(text.match(/BEGIN:VALARM/g)).toHaveLength(2);
    expect(text).toContain(
      "BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER;VALUE=DATE-TIME:20261009T010000Z\r\nDESCRIPTION:End of the CPD year\r\nEND:VALARM\r\n",
    );
    expect(text).toContain(
      "BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER;VALUE=DATE-TIME:20260925T010000Z\r\nDESCRIPTION:End of the CPD year\r\nEND:VALARM\r\n",
    );
    // An event with neither field is unchanged: same byte-for-byte output as before `alarmsAt` existed.
    expect(toIcs([ALL_DAY], { now })).not.toContain("VALARM");
  });
});

describe("which reminder governs each calendar event", () => {
  const set = createAustralianRanzcpPreset(2026, "2026-01-05");

  it("tags CME routines, year dates and nothing logged", () => {
    const routines = cmeRoutineEvents([
      {
        id: "r1",
        title: "Peer review group",
        cadence: "monthly",
        usualHours: 1,
        usualAllocations: [],
        nextDue: "2026-10-01",
        archivedAt: null,
      },
    ]);
    expect(routines.map((event) => event.reminderType)).toEqual(["cpd-routines"]);
    const deadlines = cmeDeadlineEvents(set);
    expect(deadlines.length).toBeGreaterThan(0);
    expect(new Set(deadlines.map((event) => event.reminderType))).toEqual(new Set(["cpd-year-end"]));
    const logged = cmeLoggedEvents([
      {
        id: "e1",
        date: "2026-09-02",
        title: "Invented lecture",
        allocations: [{ category: "educational", hours: 1 }],
        reflection: "",
        costCents: null,
        transcribed: false,
        routineId: null,
        documentId: null,
        buckets: [],
      },
    ]);
    expect(logged[0].reminderType).toBeUndefined();
  });

  it("tags On Call teaching and compliance dates", () => {
    const teaching = onCallTeachingEvents(
      [
        {
          id: "t1",
          section: "education",
          slug: "invented-teaching",
          title: "Invented teaching",
          subtitle: null,
          body: null,
          details: { nextOccurrenceDate: "2026-10-01", nextOccurrence: "12:30" },
          linkedDocumentIds: [],
          tags: [],
          isPersonal: false,
          includeOnCard: false,
          sortOrder: 0,
          lastVerifiedAt: null,
        } as OnCallEntry,
      ],
      "2026-09-26",
    );
    expect(teaching.map((event) => event.reminderType)).toEqual(["teaching"]);

    // A repeating session keeps the owner's own anchor as the series start, so
    // a monthly session on the 31st is not re-anchored to the 28th after the
    // roll-forward lands in February.
    const monthly = onCallTeachingEvents(
      [
        {
          id: "t2",
          section: "education",
          slug: "invented-monthly",
          title: "Invented monthly",
          subtitle: null,
          body: null,
          details: { nextOccurrenceDate: "2026-01-31", recurrenceRule: { frequency: "monthly" } },
          linkedDocumentIds: [],
          tags: [],
          isPersonal: false,
          includeOnCard: false,
          sortOrder: 0,
          lastVerifiedAt: null,
        } as OnCallEntry,
      ],
      "2026-02-15",
    );
    expect(monthly.map((event) => event.date)).toEqual(["2026-01-31"]);
    expect(expandEvents(monthly, { start: "2026-02-15", end: "2026-05-31" }).map((event) => event.date)).toEqual([
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
    ]);
    const expiries = onCallExpiryEvents(DEMO_ON_CALL_ENTRIES);
    expect(expiries.length).toBeGreaterThan(0);
    expect(new Set(expiries.map((event) => event.reminderType))).toEqual(new Set(["compliance-dates"]));
  });
});

describe("On Call notifications and reminder settings", () => {
  const entry = {} as OnCallEntry;
  const notifications: OnCallNotification[] = [
    { id: "a:compliance-date-passed", kind: "compliance-date-passed", title: "A", detail: "", entry },
    { id: "b:never-verified", kind: "never-verified", title: "B", detail: "", entry },
    { id: "c:overdue", kind: "overdue", title: "C", detail: "", entry },
  ];

  it("maps a passed date to compliance dates and freshness to On Call checks", () => {
    expect(onCallNotificationReminderType("compliance-date-passed")).toBe("compliance-dates");
    expect(onCallNotificationReminderType("never-verified")).toBe("on-call-checks");
    expect(onCallNotificationReminderType("overdue")).toBe("on-call-checks");
  });

  it("keeps everything by default, and drops a hidden or snoozed type", () => {
    expect(visibleOnCallNotifications(notifications, DEFAULT_REMINDER_SETTINGS, "2026-09-26")).toEqual(notifications);
    const snoozed = snoozeReminder(DEFAULT_REMINDER_SETTINGS, "on-call-checks", "2026-09-26");
    expect(visibleOnCallNotifications(notifications, snoozed, "2026-09-27").map((item) => item.title)).toEqual(["A"]);
    expect(visibleOnCallNotifications(notifications, snoozed, "2026-10-03")).toHaveLength(3);
    const hidden = updateReminderType(DEFAULT_REMINDER_SETTINGS, "compliance-dates", { showInApp: false });
    expect(visibleOnCallNotifications(notifications, hidden, "2026-09-26").map((item) => item.title)).toEqual([
      "B",
      "C",
    ]);
  });
});
