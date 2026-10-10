import { describe, expect, it } from "vitest";

import { toIcs } from "@/lib/calendar/ics";
import { googleCalendarUrl } from "@/lib/calendar/provider-links";
import type { MyDayItem } from "@/lib/my-day/model";
import type { MyRound } from "@/lib/roster/rotations/model";
import {
  adminRequestItems,
  alertCalendarItems,
  bandsOverlapping,
  calendarExportEvents,
  calendarItemEvent,
  dayList,
  filterByArea,
  itemsOnDate,
  leaveItems,
  mergeCalendarItems,
  myDayCalendarItems,
  reminderCalendarItems,
  workEntryItems,
  type MainCalendarItem,
} from "@/lib/work-calendar/main-calendar";
import { rotationDeadlineEntries, type WorkCalendarEntry } from "@/lib/work-calendar/entries";
import type { AdminRequest } from "@/lib/work-screens/admin/paperwork-model";

const ZONE = "Australia/Perth";

const rotation: WorkCalendarEntry = {
  id: "rotation:r1:t1",
  kind: "rotation",
  title: "Consultation liaison",
  detail: "Term 1 · Example Hospital",
  start: "2026-10-05",
  end: "2026-12-20",
  allDay: true,
  href: "/roster/rotations/r1",
};

const course: WorkCalendarEntry = {
  id: "booking:c1",
  kind: "course",
  title: "ALS refresher",
  start: "2026-10-14",
  end: "2026-10-14",
  startTime: "09:00",
  endTime: "12:00",
  location: "Room 2",
  href: "/admin/bookings?course=c1",
};

function item(overrides: Partial<MyDayItem> & Pick<MyDayItem, "id">): MyDayItem {
  return {
    mode: "my-work",
    title: "Item",
    due: null,
    severity: "info",
    href: "/admin",
    ...overrides,
  } as MyDayItem;
}

describe("main calendar items", () => {
  it("draws a rotation as a band and a course on its day with its time", () => {
    const items = workEntryItems([rotation, course, { ...course, id: "booking:c2", status: "waitlisted" }]);
    expect(items).toHaveLength(2);
    const [band, booked] = items;
    expect(band).toMatchObject({ band: true, area: "roster", label: "Rotation" });
    expect(booked).toMatchObject({ band: false, area: "my-work", label: "Course", time: "09:00" });
    expect(booked!.detail).toBe("09:00 to 12:00 · Room 2");
    expect(itemsOnDate(items, "2026-10-14").map((entry) => entry.key)).toEqual(["entry:booking:c1"]);
    expect(dayList(items, "2026-10-14").map((entry) => entry.key)).toEqual([
      "entry:rotation:r1:t1",
      "entry:booking:c1",
    ]);
    expect(bandsOverlapping(items, "2026-11-01", "2026-11-30")).toHaveLength(1);
    expect(bandsOverlapping(items, "2027-01-01", "2027-01-31")).toHaveLength(0);
  });

  it("covers every day of leave and marks leave not yet approved", () => {
    const items = leaveItems([
      { id: "l1", kind: "annual", startsOn: "2026-11-02", endsOn: "2026-11-06", status: "applied" },
      { id: "l2", kind: "exam", startsOn: "2026-11-10", endsOn: "2026-11-09", status: "approved" },
    ]);
    // The second has its dates the wrong way round, so it is left out.
    expect(items).toHaveLength(1);
    const merged = mergeCalendarItems([items]);
    expect(itemsOnDate(merged, "2026-11-04")[0]).toMatchObject({ title: "Annual leave", state: "Applied" });
    expect(itemsOnDate(merged, "2026-11-07")).toHaveLength(0);
  });

  it("puts sent Admin requests on the day to chase them", () => {
    const base = {
      kind: "question",
      to: "Medical Workforce",
      message: "",
      createdOn: "2026-10-01",
    } as const;
    const requests = [
      { ...base, id: "a", title: "Leave form", status: "sent", followUpOn: "2026-10-20" },
      { ...base, id: "b", title: "Done", status: "decided", followUpOn: "2026-10-21" },
      { ...base, id: "c", title: "No date", status: "sent" },
    ] as AdminRequest[];
    expect(adminRequestItems(requests)).toEqual([
      expect.objectContaining({ key: "request:a", title: "Chase: Leave form", start: "2026-10-20" }),
    ]);
  });

  it("keeps dated My Day items on their own date and leaves out work calendar edges", () => {
    const items = myDayCalendarItems(
      [
        item({
          id: "my-work:renewal:1",
          title: "AHPRA renewal",
          due: "2026-09-30",
          severity: "overdue",
          detail: "Date passed",
        }),
        item({ id: "roster:swap:1", mode: "roster", title: "Answer swap", due: "2026-10-12T01:30:00Z" }),
        item({ id: "roster:calendar-start:rotation:r1:t1", mode: "roster", due: "2026-10-05" }),
        item({ id: "cme:no-date" }),
      ],
      (mode) => mode,
      ZONE,
    );
    expect(items.map((entry) => entry.key)).toEqual(["item:my-work:renewal:1", "item:roster:swap:1"]);
    expect(items[0]).toMatchObject({ start: "2026-09-30", state: "Date passed", warn: true, detail: null });
    expect(items[1]).toMatchObject({ start: "2026-10-12", time: "09:30" });
  });

  it("filters by area and lists each key once", () => {
    const items = mergeCalendarItems([workEntryItems([course]), workEntryItems([course])]);
    expect(items).toHaveLength(1);
    expect(filterByArea(items, new Set(["my-work"]))).toHaveLength(0);
    expect(filterByArea(items, new Set())).toHaveLength(1);
  });

  it("puts open Remind me notes at their time, kept on this device", () => {
    const items = reminderCalendarItems(
      [
        {
          id: "r1",
          text: "Call pharmacy",
          dueAt: "2026-10-12T00:30:00Z",
          createdAt: "2026-10-10T00:00:00Z",
          doneAt: null,
        },
        {
          id: "r2",
          text: "Done one",
          dueAt: "2026-10-12T00:30:00Z",
          createdAt: "2026-10-10T00:00:00Z",
          doneAt: "2026-10-11T00:00:00Z",
        },
      ],
      new Date("2026-10-10T00:00:00Z"),
      ZONE,
    );
    expect(items).toEqual([
      expect.objectContaining({ key: "remind:r1", area: "my-day", start: "2026-10-12", time: "08:30", warn: false }),
    ]);
    expect(calendarItemEvent(items[0]!)).toBeNull();
  });

  it("adds the bell's dated alerts and leaves undated ones in the bell", () => {
    const items = alertCalendarItems(
      [
        {
          id: "contract:end",
          title: "Contract ends",
          due: "2026-12-01",
          area: "my-work",
          href: "/admin",
          kind: "action",
        },
        { id: "on-call:x", title: "Check entry", due: null, area: "on-call", href: "/on-call", kind: "update" },
      ],
      (mode) => mode,
      ZONE,
    );
    expect(items.map((item) => item.key)).toEqual(["alert:contract:end"]);
  });

  it("exports what may leave the app, on Perth's clock, and nothing kept on the device or made up", () => {
    const shift: MainCalendarItem = {
      key: "shift:s1",
      area: "roster",
      label: "Shift",
      title: "Day shift",
      start: "2026-10-12",
      end: "2026-10-12",
      time: "08:00",
      detail: "until 16:30",
      state: null,
      warn: false,
      href: "/roster/shifts",
      band: false,
      startsAt: "2026-10-12T00:00:00Z",
      minutes: 510,
      reminder: "shifts",
    };
    expect(calendarItemEvent(shift)).toMatchObject({
      date: "2026-10-12",
      startTime: "08:00",
      durationMinutes: 510,
      reminderType: "shifts",
    });
    const [rotationItem] = workEntryItems([rotation]);
    const event = calendarItemEvent(rotationItem!);
    expect(event).toMatchObject({ date: "2026-10-05", endDate: "2026-12-20" });
    expect(toIcs([event!])).toContain("DTEND;VALUE=DATE:20261221");
    expect(googleCalendarUrl(event!)).toContain("dates=20261005%2F20261221");
    const example = workEntryItems([{ ...course, id: "example:booking:c9" }]);
    const requests = adminRequestItems([
      {
        id: "a",
        kind: "question",
        to: "HR",
        message: "",
        createdOn: "2026-10-01",
        title: "Form",
        status: "sent",
        followUpOn: "2026-10-20",
      },
    ] as never);
    expect(calendarExportEvents([shift, ...example, ...requests])).toHaveLength(1);
  });

  it("exports a course at its exact start and without the organiser's name", () => {
    const [sydney] = workEntryItems([
      { ...course, detail: "Course · Dr Example Organiser", startsAt: "2026-10-13T22:00:00.000Z" },
    ]);
    const event = calendarItemEvent(sydney!);
    expect(event).toMatchObject({ date: "2026-10-14", startTime: "06:00", location: "Room 2" });
    expect(JSON.stringify(event)).not.toContain("Organiser");
    expect(googleCalendarUrl(event!)).not.toContain("Organiser");
    // 01:30 to 03:30 in Sydney on the night clocks go forward lasts one hour, not two.
    const [dst] = workEntryItems([
      {
        ...course,
        start: "2026-10-04",
        end: "2026-10-04",
        startTime: "01:30",
        endTime: "03:30",
        startsAt: "2026-10-03T15:30:00.000Z",
        endsAt: "2026-10-03T16:30:00.000Z",
      },
    ]);
    expect(dst!.minutes).toBe(60);
  });

  it("puts the close of an open rotation round on the calendar", () => {
    const round = {
      round: { id: "r1", name: "2027 rotations", status: "open", closesAt: "2026-10-20T09:00:00Z" },
      personId: "p1",
      ranking: [],
      submittedAt: null,
      placements: [],
    } as unknown as MyRound;
    const closed = { ...round, round: { ...round.round, id: "r2", status: "published" } } as unknown as MyRound;
    const entries = rotationDeadlineEntries([round, closed], ZONE);
    expect(entries).toEqual([
      expect.objectContaining({
        id: "rotation-close:r1",
        kind: "deadline",
        start: "2026-10-20",
        startTime: "17:00",
        detail: "2027 rotations · yours aren't sent yet",
      }),
    ]);
    expect(workEntryItems(entries)[0]).toMatchObject({ label: "Deadline", time: "17:00", area: "roster" });
    // A reader on Sydney's clock sees 20:00, but the export still lands at 17:00 Perth.
    const [sydney] = workEntryItems(rotationDeadlineEntries([round], "Australia/Sydney"));
    expect(sydney).toMatchObject({ time: "20:00" });
    expect(calendarItemEvent(sydney!)).toMatchObject({ date: "2026-10-20", startTime: "17:00" });
    const [alert] = alertCalendarItems(
      [
        {
          id: "swap:1",
          title: "Answer swap",
          due: "2026-10-12T15:30:00Z",
          area: "roster",
          href: "/roster",
          kind: "action",
        },
      ],
      (mode) => mode,
      "Australia/Sydney",
    );
    expect(alert).toMatchObject({ start: "2026-10-13", time: "02:30" });
    expect(calendarItemEvent(alert!)).toMatchObject({ date: "2026-10-12", startTime: "23:30" });
  });
});
