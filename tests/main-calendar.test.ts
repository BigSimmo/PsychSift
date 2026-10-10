import { describe, expect, it } from "vitest";

import type { MyDayItem } from "@/lib/my-day/model";
import {
  adminRequestItems,
  bandsOverlapping,
  dayList,
  filterByArea,
  itemsOnDate,
  leaveItems,
  mergeCalendarItems,
  myDayCalendarItems,
  workEntryItems,
} from "@/lib/work-calendar/main-calendar";
import type { WorkCalendarEntry } from "@/lib/work-calendar/entries";
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
});
