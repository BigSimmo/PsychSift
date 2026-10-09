import { describe, expect, it } from "vitest";

import {
  alternativeDates,
  belowSafeDays,
  hasGradeOrSiteNeeds,
  hasSafeNumber,
  judgeDay,
  leaveStaffing,
  leaveStaffingWords,
  safeNumberNote,
  safeNumberOn,
  safeWords,
  staffingDayLabel,
  staffingDays,
  type StaffingNeed,
} from "@/lib/roster/staffing/team-staffing";
import type { RosterAssignment } from "@/lib/roster/team/model";

const ME = "5e000000-0000-4000-8000-000000000001";
const person = (n: number) => `5e000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
let next = 100;
function shift(userId: string, date: string, kind: RosterAssignment["kind"] = "day"): RosterAssignment {
  next += 1;
  return {
    id: `5e000000-0000-4000-8000-${String(next).padStart(12, "0")}`,
    userId,
    name: null,
    grade: "registrar",
    siteId: null,
    siteName: null,
    startsAt: `${date}T00:00:00Z`,
    endsAt: `${date}T08:30:00Z`,
    shiftCode: kind === "evening" ? "E" : "D",
    kind,
  };
}
const need = (fields: Partial<StaffingNeed>): StaffingNeed => ({
  weekday: null,
  date: null,
  kind: "day",
  grade: null,
  siteId: null,
  needed: 1,
  ...fields,
});
// Mon 19 to Fri 23 Oct 2026: ISO weekdays 1 to 5.
const weekdayDays = [1, 2, 3, 4, 5].map((weekday) => need({ weekday, kind: "day", needed: 3 }));

describe("safeNumberOn", () => {
  it("sums the whole-team weekday needs for Day and Evening only", () => {
    const needs = [
      need({ weekday: 1, kind: "day", needed: 2 }),
      need({ weekday: 1, kind: "day", needed: 1 }),
      need({ weekday: 1, kind: "evening", needed: 1 }),
      need({ weekday: 1, kind: "night", needed: 1 }),
      need({ weekday: 1, kind: "day", grade: "consultant", needed: 1 }),
      need({ weekday: 1, kind: "day", siteId: person(50), needed: 5 }),
    ];
    expect(safeNumberOn("2026-10-19", needs)).toEqual({ day: 3, evening: 1 });
    expect(safeNumberOn("2026-10-20", needs)).toEqual({});
  });

  it("a need for that exact date replaces the weekday need, as on the Cover tab", () => {
    const needs = [need({ weekday: 5, needed: 4 }), need({ date: "2026-10-23", needed: 2 })];
    expect(safeNumberOn("2026-10-23", needs)).toEqual({ day: 2 });
    expect(safeNumberOn("2026-10-30", needs)).toEqual({ day: 4 });
    // A dated need for one grade leaves the whole-team weekday need in place.
    const graded = [need({ weekday: 5, needed: 4 }), need({ date: "2026-10-23", grade: "registrar", needed: 1 })];
    expect(safeNumberOn("2026-10-23", graded)).toEqual({ day: 4 });
  });

  it("knows whether a safe number is set and whether grade or site needs are left out", () => {
    expect(hasSafeNumber(null)).toBe(false);
    expect(hasSafeNumber([])).toBe(false);
    expect(hasSafeNumber([need({ weekday: 1, kind: "night" })])).toBe(false);
    expect(hasSafeNumber([need({ weekday: 1, grade: "consultant" })])).toBe(false);
    expect(hasSafeNumber(weekdayDays)).toBe(true);
    expect(hasGradeOrSiteNeeds(weekdayDays)).toBe(false);
    expect(hasGradeOrSiteNeeds([need({ weekday: 1, siteId: person(50) })])).toBe(true);
  });
});

describe("judgeDay", () => {
  const window = { from: "2026-10-19", to: "2026-10-25" };
  const rows = [
    // Mon 19: you and two others on Day, one on Evening.
    shift(ME, "2026-10-19"),
    shift(person(2), "2026-10-19"),
    shift(person(3), "2026-10-19"),
    shift(person(4), "2026-10-19", "evening"),
    // Tue 20: three on Day, nobody on Evening.
    shift(person(2), "2026-10-20"),
    shift(person(3), "2026-10-20"),
    shift(person(4), "2026-10-20"),
  ];
  const days = staffingDays(rows, window, { actorId: ME, knownThrough: "2026-10-25" });
  const day = (date: string) => days.find((item) => item.date === date)!;

  it("counts each kind and the kinds you work", () => {
    expect(day("2026-10-19").byKind).toEqual({ day: 3, evening: 1 });
    expect(day("2026-10-19").yourKinds).toEqual(["day"]);
    expect(day("2026-10-20").yourKinds).toEqual([]);
  });

  it("is below the safe number only once you are away from a day you work", () => {
    const here = judgeDay(day("2026-10-19"), weekdayDays, false)!;
    expect(here).toMatchObject({ on: 4, needed: 3, below: false, short: [] });
    const away = judgeDay(day("2026-10-19"), weekdayDays, true)!;
    expect(away.below).toBe(true);
    expect(away.short).toEqual([{ kind: "day", on: 2, needed: 3 }]);
    expect(safeWords(away)).toBe("2 on Day shifts, needs 3");
    // Leave on a day you don't work changes nothing.
    expect(judgeDay(day("2026-10-20"), weekdayDays, true)!.below).toBe(false);
  });

  it("a full Day never hides an empty Evening", () => {
    const needs = [need({ weekday: 2, kind: "day", needed: 2 }), need({ weekday: 2, kind: "evening", needed: 1 })];
    const judgement = judgeDay(day("2026-10-20"), needs, false)!;
    expect(judgement).toMatchObject({ on: 3, needed: 3, below: true });
    expect(safeWords(judgement)).toBe("0 on Evening shifts, needs 1");
  });

  it("says plainly '3 on, needs 4' when the total is short", () => {
    const needs = [need({ weekday: 2, needed: 4 })];
    const judgement = judgeDay(day("2026-10-20"), needs, false)!;
    expect(judgement.below).toBe(true);
    expect(safeWords(judgement)).toBe("3 on, needs 4");
  });

  it("does not judge a day with no need, an unpublished day, or a need of zero", () => {
    expect(judgeDay(day("2026-10-24"), weekdayDays, false)).toBeNull();
    const unpublished = staffingDays(rows, window, { actorId: ME, knownThrough: "2026-10-19" });
    expect(judgeDay(unpublished[1]!, weekdayDays, false)).toBeNull();
    expect(judgeDay(day("2026-10-21"), [need({ weekday: 3, needed: 0 })], false)!.below).toBe(false);
  });

  it("reads each day out with its need and lists the days below", () => {
    expect(staffingDayLabel(day("2026-10-20"), null, weekdayDays)).toBe("Tue 20: 3 on, needs 3");
    expect(staffingDayLabel(day("2026-10-19"), { from: "2026-10-19", to: "2026-10-19" }, weekdayDays)).toBe(
      "Mon 19: 2 on Day shifts, needs 3, below safe number, you off on leave",
    );
    // Wed 21 to Fri 23 have nobody on and need 3.
    expect(belowSafeDays(days, null, weekdayDays)).toEqual(["2026-10-21", "2026-10-22", "2026-10-23"]);
    expect(belowSafeDays(days, null, null)).toEqual([]);
  });
});

describe("leave against the safe number", () => {
  const window = { from: "2026-10-19", to: "2026-11-01" };
  const rows: RosterAssignment[] = [];
  for (let day = 19; day <= 31; day += 1) {
    const date = `2026-10-${day}`;
    for (const n of [2, 3, 4]) rows.push(shift(person(n), date));
  }
  // You work Thu 22 and Fri 23. Fri 23 is one short already.
  rows.push(shift(ME, "2026-10-22"), shift(ME, "2026-10-23"));
  const fri = rows.findIndex((row) => row.userId === person(4) && row.startsAt.startsWith("2026-10-23"));
  rows.splice(fri, 1);
  const days = staffingDays(rows, window, { actorId: ME, knownThrough: "2026-11-01" });
  const leave = { from: "2026-10-22", to: "2026-10-23" };

  it("names the days below with you away, worst first, and never anyone else", () => {
    const result = leaveStaffing(days, leave, weekdayDays);
    expect(result.kind).toBe("checked");
    if (result.kind === "unchecked") throw new Error("checked expected");
    expect(result.safe).toEqual({
      set: true,
      judged: 2,
      below: [
        {
          date: "2026-10-23",
          judgement: { on: 2, needed: 3, below: true, short: [{ kind: "day", on: 2, needed: 3 }] },
        },
      ],
    });
    expect(leaveStaffingWords(result)).toEqual({
      lead: "Below safe number: Fri 23.",
      rest: "With you away, Fri 23 has 2 on, needs 3. You're rostered on 2 of these days.",
    });
  });

  it("says no day is below when none is, and keeps the old words without needs", () => {
    const fine = leaveStaffing(days, { from: "2026-10-19", to: "2026-10-20" }, weekdayDays);
    expect(leaveStaffingWords(fine)).toEqual({
      lead: "Fewest on: 3 people, Mon 19 and Tue 20.",
      rest: "No day is below the safe number. You have no shifts on these days.",
    });
    const plain = leaveStaffing(days, { from: "2026-10-19", to: "2026-10-20" });
    expect("safe" in plain).toBe(false);
    expect(leaveStaffingWords(plain).rest).toBe("You have no shifts on these days.");
    // A weekend has no need set, so nothing is judged and nothing is claimed.
    const weekend = leaveStaffing(days, { from: "2026-10-24", to: "2026-10-25" }, weekdayDays);
    expect(leaveStaffingWords(weekend).rest).toBe("You have no shifts on these days.");
  });

  it("never offers other dates that would take the team below its safe number", () => {
    const needs = [...weekdayDays, need({ date: "2026-10-27", needed: 4 })];
    const offered = alternativeDates(days, leave, "2026-10-18", 20, needs);
    expect(offered.length).toBeGreaterThan(0);
    for (const option of offered) expect(option.from <= "2026-10-27" && option.to >= "2026-10-27").toBe(false);
    const unjudged = alternativeDates(days, leave, "2026-10-18", 20);
    expect(unjudged.some((option) => option.from <= "2026-10-27" && option.to >= "2026-10-27")).toBe(true);
  });
});

describe("safeNumberNote", () => {
  it("says what the safe number is, or plainly that there isn't one", () => {
    expect(safeNumberNote(undefined)).toBe("Checking your team's safe number.");
    expect(safeNumberNote(null)).toContain("couldn't be checked");
    expect(safeNumberNote([])).toBe(
      "Your roster manager hasn't set a safe number for this team yet. This shows how many are on, not whether that is enough.",
    );
    expect(safeNumberNote(weekdayDays)).toBe(
      "The safe number is the Day and Evening cover your roster manager set for the whole team. Your roster manager decides.",
    );
    expect(safeNumberNote([...weekdayDays, need({ weekday: 1, grade: "consultant" })])).toContain(
      "Needs for one grade or one site aren't judged here.",
    );
    for (const words of [safeNumberNote([]), safeNumberNote(weekdayDays), safeNumberNote(null)]) {
      expect(words).not.toMatch(/[;→]/);
    }
  });
});
