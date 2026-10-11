import { describe, expect, it } from "vitest";

import {
  STAFFING_COUNTED_KINDS,
  STAFFING_COUNTS_WORDS,
  alternativeDates,
  dayCount,
  dayList,
  isIsoDate,
  leaveStaffing,
  leaveStaffingWords,
  mondayOf,
  onIfAway,
  spanWords,
  staffingDayLabel,
  staffingDays,
  staffingWindow,
  sundayOf,
  type StaffingDay,
  staffingAskText,
} from "@/lib/roster/staffing/team-staffing";
import type { RosterAssignment } from "@/lib/roster/team/model";

const ME = "5e000000-0000-4000-8000-000000000001";
let next = 100;
function shift(
  userId: string | null,
  date: string,
  kind: RosterAssignment["kind"] = "day",
  name: string | null = null,
) {
  next += 1;
  return {
    id: `5e000000-0000-4000-8000-${String(next).padStart(12, "0")}`,
    userId,
    name,
    grade: "registrar",
    siteId: null,
    siteName: null,
    // 08:00 Perth on `date`.
    startsAt: `${date}T00:00:00Z`,
    endsAt: `${date}T08:30:00Z`,
    shiftCode: kind === "leave" ? "AL" : "D",
    kind,
  } satisfies RosterAssignment;
}
const person = (n: number) => `5e000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;

describe("dates", () => {
  it("checks real calendar dates only", () => {
    expect(isIsoDate("2026-10-22")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("22/10/2026")).toBe(false);
    expect(isIsoDate(null)).toBe(false);
  });

  it("finds whole weeks, Monday to Sunday", () => {
    expect(mondayOf("2026-10-22")).toBe("2026-10-19");
    expect(mondayOf("2026-10-19")).toBe("2026-10-19");
    expect(mondayOf("2026-10-25")).toBe("2026-10-19");
    expect(sundayOf("2026-10-22")).toBe("2026-10-25");
    expect(dayCount("2026-10-22", "2026-10-23")).toBe(2);
  });

  it("reads three weeks from this Monday with nothing picked", () => {
    expect(staffingWindow("2026-10-07", null)).toEqual({ from: "2026-10-05", to: "2026-10-25", capped: false });
  });

  it("keeps the same read when picked dates sit inside the three weeks", () => {
    expect(staffingWindow("2026-10-07", { from: "2026-10-08", to: "2026-10-09" })).toEqual({
      from: "2026-10-05",
      to: "2026-10-25",
      capped: false,
    });
  });

  it("reads a week either side of later leave, never more than 62 days", () => {
    expect(staffingWindow("2026-10-07", { from: "2026-11-12", to: "2026-11-13" })).toEqual({
      from: "2026-11-02",
      to: "2026-11-22",
      capped: false,
    });
    const long = staffingWindow("2026-10-07", { from: "2026-11-02", to: "2027-03-01" });
    expect(long.capped).toBe(true);
    expect(dayCount(long.from, long.to)).toBeLessThanOrEqual(62);
  });

  it("writes spans in words", () => {
    expect(spanWords({ from: "2026-10-22", to: "2026-10-22" })).toBe("Thu 22 Oct");
    expect(spanWords({ from: "2026-10-21", to: "2026-10-22" })).toBe("Wed 21 to Thu 22 Oct");
    expect(spanWords({ from: "2026-11-30", to: "2026-12-01" })).toBe("Mon 30 Nov to Tue 1 Dec");
    expect(dayList(["2026-10-23"])).toBe("Fri 23");
    expect(dayList(["2026-10-22", "2026-10-23"])).toBe("Thu 22 and Fri 23");
    expect(dayList(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22"])).toBe("4 days");
  });
});

describe("counting", () => {
  const assignments = [
    shift(ME, "2026-10-22"),
    shift(person(2), "2026-10-22"),
    shift(person(3), "2026-10-22"),
    shift(person(3), "2026-10-22", "evening"), // the same person twice counts once
    shift(ME, "2026-10-23"),
    shift(person(2), "2026-10-23"),
    shift(person(4), "2026-10-23", "leave"),
    shift(null, "2026-10-24", "day", "Dr Unlinked"),
    shift(null, "2026-10-24", "day", "Dr Unlinked"),
  ];

  it("counts distinct people on, not leave, and notes who is on leave", () => {
    const days = staffingDays(
      assignments,
      { from: "2026-10-22", to: "2026-10-25" },
      { actorId: ME, knownThrough: "2026-10-24" },
    );
    expect(days.map((day) => [day.date, day.on, day.youWork, day.onLeave])).toEqual([
      ["2026-10-22", 3, true, 0],
      ["2026-10-23", 2, true, 1],
      ["2026-10-24", 1, false, 0],
      ["2026-10-25", null, false, 0],
    ]);
  });

  it("counts only Day and Evening shifts as people on, never night, on call or other work", () => {
    // Fri 23: three on Day, one on Night and the consultant on call. The spec counts Day and Late.
    const friday = [
      shift(person(8), "2026-10-23"),
      shift(person(2), "2026-10-23"),
      shift(ME, "2026-10-23", "evening"),
      shift(person(3), "2026-10-23", "night"),
      shift(person(5), "2026-10-23", "on_call"),
      shift(person(6), "2026-10-23", "other"),
    ];
    const [day] = staffingDays(
      friday,
      { from: "2026-10-23", to: "2026-10-23" },
      { actorId: ME, knownThrough: "2026-10-31" },
    );
    expect(day!.on).toBe(3);
    expect(day!.youWork).toBe(true);
    expect(onIfAway(day!)).toBe(2);
    expect(STAFFING_COUNTED_KINDS).toEqual(["day", "evening"]);
    expect(STAFFING_COUNTS_WORDS).toMatch(/Day and Evening/);
    expect(STAFFING_COUNTS_WORDS).not.toMatch(/safe/i);
  });

  it("your night or on call shift is not taken off the count, but leave still names it as your shift", () => {
    const rows = [shift(person(8), "2026-10-23"), shift(ME, "2026-10-23", "night")];
    const days = staffingDays(
      rows,
      { from: "2026-10-23", to: "2026-10-23" },
      { actorId: ME, knownThrough: "2026-10-31" },
    );
    expect(days[0]!.on).toBe(1);
    expect(days[0]!.youWork).toBe(false);
    const result = leaveStaffing(days, { from: "2026-10-23", to: "2026-10-23" });
    expect(result).toEqual({ kind: "checked", lowest: 1, lowestDays: ["2026-10-23"], yourShifts: 1 });
  });

  it("with no publication, counts only days that hold roster rows", () => {
    const days = staffingDays(
      assignments,
      { from: "2026-10-24", to: "2026-10-25" },
      { actorId: ME, knownThrough: null },
    );
    expect(days.map((day) => day.on)).toEqual([1, null]);
  });

  it("takes you off a day you work while on leave", () => {
    const day: StaffingDay = { date: "2026-10-22", on: 3, youWork: true, onLeave: 0 };
    expect(onIfAway(day)).toBe(2);
    expect(onIfAway({ ...day, youWork: false })).toBe(3);
    expect(onIfAway({ ...day, on: null })).toBeNull();
  });

  it("gives every column a full sentence for screen readers", () => {
    const leave = { from: "2026-10-23", to: "2026-10-23" };
    expect(staffingDayLabel({ date: "2026-10-23", on: 2, youWork: true, onLeave: 1 }, leave)).toBe(
      "Fri 23: 1 on, you off on leave, 1 on leave",
    );
    expect(staffingDayLabel({ date: "2026-10-22", on: 3, youWork: true, onLeave: 0 }, leave)).toBe(
      "Thu 22: 3 on, including you",
    );
    expect(staffingDayLabel({ date: "2026-10-25", on: null, youWork: false, onLeave: 0 }, leave)).toBe(
      "Sun 25: not checked, roster not published",
    );
  });
});

describe("the leave result", () => {
  const days: StaffingDay[] = [
    { date: "2026-10-19", on: 5, youWork: false, onLeave: 0 },
    { date: "2026-10-20", on: 6, youWork: false, onLeave: 0 },
    { date: "2026-10-21", on: 5, youWork: true, onLeave: 0 },
    { date: "2026-10-22", on: 5, youWork: true, onLeave: 0 },
    { date: "2026-10-23", on: 4, youWork: true, onLeave: 0 },
    { date: "2026-10-24", on: 3, youWork: false, onLeave: 0 },
    { date: "2026-10-25", on: null, youWork: false, onLeave: 0 },
  ];

  it("finds the fewest on with you away, and your shifts", () => {
    const result = leaveStaffing(days, { from: "2026-10-22", to: "2026-10-23" });
    expect(result).toEqual({ kind: "checked", lowest: 3, lowestDays: ["2026-10-23"], yourShifts: 2 });
    expect(leaveStaffingWords(result)).toEqual({
      lead: "Fewest on: 3 people, Fri 23.",
      rest: "You're rostered on 2 of these days.",
    });
  });

  it("never calls an unpublished day fine", () => {
    expect(leaveStaffing(days, { from: "2026-10-25", to: "2026-10-25" })).toEqual({ kind: "unchecked", days: 1 });
    const partial = leaveStaffing(days, { from: "2026-10-24", to: "2026-10-25" });
    expect(partial).toEqual({ kind: "partial", lowest: 3, lowestDays: ["2026-10-24"], unchecked: 1 });
    expect(leaveStaffingWords(partial).rest).toBe("1 day isn't published yet, so not checked.");
    expect(leaveStaffingWords({ kind: "unchecked", days: 3 }).lead).toBe("Can't check yet.");
  });

  it("never uses the word safe", () => {
    const words = JSON.stringify([
      leaveStaffingWords(leaveStaffing(days, { from: "2026-10-22", to: "2026-10-23" })),
      leaveStaffingWords({ kind: "unchecked", days: 1 }),
    ]);
    expect(words).not.toMatch(/safe/i);
  });

  it("offers same-length dates with more on, nearest first, after today and all checked", () => {
    const options = alternativeDates(days, { from: "2026-10-22", to: "2026-10-23" }, "2026-10-18");
    expect(options.map((option) => [option.from, option.to, option.lowest])).toEqual([
      ["2026-10-21", "2026-10-22", 4],
      ["2026-10-20", "2026-10-21", 4],
    ]);
    expect(options[0]!.counts).toEqual([4, 4]);
  });

  it("offers nothing when the picked dates are unchecked or nothing beats them", () => {
    expect(alternativeDates(days, { from: "2026-10-25", to: "2026-10-25" }, "2026-10-18")).toEqual([]);
    expect(alternativeDates(days, { from: "2026-10-20", to: "2026-10-20" }, "2026-10-18")).toEqual([]);
    // Past starts are never offered.
    expect(
      alternativeDates(days, { from: "2026-10-23", to: "2026-10-23" }, "2026-10-22").every(
        (o) => o.from > "2026-10-22",
      ),
    ).toBe(true);
  });
});

describe("staffingAskText", () => {
  it("asks for the team's number without stating one, with or without dates", () => {
    expect(staffingAskText(null, null)).toBe(
      "Hi, what is the fewest doctors our team needs on each day? I would like to plan my leave around it.\n\nThanks",
    );
    const dated = staffingAskText({ from: "2026-11-30", to: "2026-12-01" }, "Ward 4");
    expect(dated).toContain("leave Mon 30 Nov to Tue 1 Dec");
    expect(dated).not.toMatch(/\d+ doctors/);
  });
});

describe("staffingDays: the caller's work zone", () => {
  it("puts a shift on the day it falls in the given zone, not Perth's", () => {
    // 22:30 Thu in Perth is 01:30 Fri in Sydney.
    const late = { ...shift(ME, "2026-10-22"), startsAt: "2026-10-22T14:30:00Z" };
    const window = { from: "2026-10-22", to: "2026-10-23" };
    const perth = staffingDays([late], window, { actorId: ME, knownThrough: "2026-10-23", zone: "Australia/Perth" });
    const sydney = staffingDays([late], window, {
      actorId: ME,
      knownThrough: "2026-10-23",
      zone: "Australia/Sydney",
    });
    expect(perth.map((day) => day.on)).toEqual([1, 0]);
    expect(sydney.map((day) => day.on)).toEqual([0, 1]);
  });
});
