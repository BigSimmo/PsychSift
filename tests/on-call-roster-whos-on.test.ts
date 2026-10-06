import { describe, expect, it } from "vitest";

import {
  perthDayBounds,
  rosterDayCoverage,
  rosterNowMark,
  rosterProvenance,
  rosterRailLabel,
  rosterShiftSpan,
  rosterWhosOnDate,
  rosterWhosOnRange,
  rosterWhosOnRows,
  rosterWhosOnSearchRecords,
} from "@/lib/on-call/roster-whos-on";
import type { RosterAssignment } from "@/lib/roster/team/model";

// 21:40 Perth on Tue 6 Oct 2026 (UTC+8, no daylight saving).
const NOW = new Date("2026-10-06T13:40:00Z");
const ME = "00000000-0000-4000-8000-0000000000aa";

let counter = 0;
function shift(over: Partial<RosterAssignment> & { start: string; end: string }): RosterAssignment {
  counter += 1;
  const { start, end, ...rest } = over;
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    userId: `00000000-0000-4000-8000-1${String(counter).padStart(11, "0")}`,
    name: "Dr Example",
    grade: "registrar",
    siteId: null,
    siteName: null,
    startsAt: `${start}+08:00`,
    endsAt: `${end}+08:00`,
    shiftCode: "D",
    kind: "day",
    ...rest,
  };
}

describe("days and windows", () => {
  it("names yesterday, today and tomorrow in Perth, and reads one four-day window", () => {
    expect(rosterWhosOnDate("today", NOW)).toBe("2026-10-06");
    expect(rosterWhosOnDate("yesterday", NOW)).toBe("2026-10-05");
    expect(rosterWhosOnDate("tomorrow", NOW)).toBe("2026-10-07");
    expect(rosterWhosOnRange(NOW)).toEqual({ from: "2026-10-05", to: "2026-10-08" });
    // 23:30 UTC on 6 Oct is already 7 Oct in Perth.
    expect(rosterWhosOnDate("today", new Date("2026-10-06T23:30:00Z"))).toBe("2026-10-07");
  });

  it("bounds a Perth day", () => {
    const bounds = perthDayBounds("2026-10-06")!;
    expect(new Date(bounds.start).toISOString()).toBe("2026-10-05T16:00:00.000Z");
    expect(bounds.end - bounds.start).toBe(86_400_000);
    expect(perthDayBounds("2026-02-30")).toBeNull();
  });
});

describe("rosterWhosOnRows", () => {
  it("lists everyone whose shift touches the day, on now first, and never shows leave", () => {
    const night = shift({ name: "Dr Nguyen", kind: "night", start: "2026-10-06T21:00", end: "2026-10-07T08:30" });
    const day = shift({ name: "Dr Grant", kind: "day", start: "2026-10-06T08:00", end: "2026-10-06T16:30" });
    const leave = shift({ name: "Dr Away", kind: "leave", start: "2026-10-06T00:00", end: "2026-10-07T00:00" });
    const lastNight = shift({ name: "Dr Lowe", kind: "night", start: "2026-10-05T21:00", end: "2026-10-06T08:30" });
    const tomorrow = shift({ name: "Dr Patel", kind: "day", start: "2026-10-07T08:00", end: "2026-10-07T16:30" });
    const rows = rosterWhosOnRows([day, night, leave, lastNight, tomorrow], {
      date: "2026-10-06",
      now: NOW,
      actorId: ME,
    });
    expect(rows.map((row) => row.name)).toEqual(["Dr Nguyen", "Dr Lowe", "Dr Grant"]);
    expect(rows[0]).toMatchObject({ onNow: true, kindLabel: "Night", span: "21:00 to 08:30 Wed" });
    expect(rows[1].span).toBe("From Mon 21:00 to 08:30");
    expect(rows.some((row) => row.name === "Dr Away")).toBe(false);
  });

  it("marks the reader as You, and never guesses a missing name", () => {
    const mine = shift({
      userId: ME,
      name: "Dr Me",
      kind: "on_call",
      start: "2026-10-06T21:00",
      end: "2026-10-07T08:00",
    });
    const blank = shift({
      userId: null,
      name: "  ",
      kind: "evening",
      start: "2026-10-06T13:00",
      end: "2026-10-06T22:00",
    });
    const rows = rosterWhosOnRows([mine, blank], { date: "2026-10-06", now: NOW, actorId: ME });
    expect(rows.find((row) => row.id === mine.id)).toMatchObject({ isMe: true, kindLabel: "On call" });
    expect(rows.find((row) => row.id === blank.id)).toMatchObject({ name: null, onNow: true });
    expect(rosterRailLabel(rows.find((row) => row.id === blank.id)!)).toBe(
      "Name not on the roster, evening, 13:00 to 22:00, on now",
    );
  });

  it("names who comes next at handover, preferring the same grade", () => {
    const night = shift({
      name: "Dr Nguyen",
      kind: "night",
      grade: "registrar",
      start: "2026-10-06T21:00",
      end: "2026-10-07T08:30",
    });
    const consultant = shift({
      name: "Dr Grant",
      kind: "day",
      grade: "consultant",
      start: "2026-10-07T08:00",
      end: "2026-10-07T16:30",
    });
    const registrar = shift({
      name: "Dr Patel",
      kind: "day",
      grade: "registrar",
      start: "2026-10-07T08:00",
      end: "2026-10-07T16:30",
    });
    const far = shift({
      name: "Dr Late",
      kind: "evening",
      grade: "registrar",
      start: "2026-10-07T13:00",
      end: "2026-10-07T21:30",
    });
    const [row] = rosterWhosOnRows([night, consultant, registrar, far], {
      date: "2026-10-06",
      now: NOW,
      actorId: null,
    });
    expect(row.next).toEqual({ name: "Dr Patel", startsAt: registrar.startsAt });
  });

  it("places each shift on the day's rail, clipped to the day", () => {
    const night = shift({ kind: "night", start: "2026-10-06T21:00", end: "2026-10-07T08:30" });
    const day = shift({ kind: "day", start: "2026-10-06T06:00", end: "2026-10-06T18:00" });
    const rows = rosterWhosOnRows([night, day], { date: "2026-10-06", now: NOW, actorId: null });
    expect(rows.find((row) => row.id === night.id)?.rail).toEqual({ left: 87.5, width: 12.5 });
    expect(rows.find((row) => row.id === day.id)?.rail).toEqual({ left: 25, width: 50 });
    expect(rosterNowMark("2026-10-06", NOW)).toBe(90.3);
    expect(rosterNowMark("2026-10-07", NOW)).toBeNull();
  });

  it("returns nothing for a day nobody is rostered, and for an impossible day", () => {
    expect(rosterWhosOnRows([], { date: "2026-10-06", now: NOW, actorId: null })).toEqual([]);
    expect(
      rosterWhosOnRows([shift({ start: "2026-10-06T08:00", end: "2026-10-06T16:00" })], {
        date: "2026-13-01",
        now: NOW,
        actorId: null,
      }),
    ).toEqual([]);
  });
});

describe("spans and provenance", () => {
  it("says a shift ending at midnight as midnight on its own day", () => {
    expect(rosterShiftSpan(shift({ start: "2026-10-06T16:00", end: "2026-10-07T00:00" }), "2026-10-06")).toBe(
      "16:00 to midnight",
    );
  });

  it("says whether the chosen day is published", () => {
    const publication = {
      version: 4,
      publishedAt: "2026-10-03T08:10:00Z",
      periodStart: "2026-09-28",
      periodEnd: "2026-10-25",
    };
    expect(rosterDayCoverage(null, "2026-10-06")).toBe("none");
    expect(rosterDayCoverage(publication, "2026-10-06")).toBe("published");
    expect(rosterDayCoverage(publication, "2026-10-26")).toBe("not-published");
    expect(rosterDayCoverage(publication, "2026-09-27")).toBe("before");
    expect(rosterProvenance(publication)).toBe("Published Sat 3 Oct 16:10, version 4");
  });

  it("gives a search record with no roster names in it", () => {
    const [record] = rosterWhosOnSearchRecords();
    expect(record).toMatchObject({ area: "On Call", href: "/on-call/whos-on/roster" });
    expect(record.keywords).toContain("who is on");
  });
});
