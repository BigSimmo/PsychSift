import { describe, expect, it } from "vitest";

import { ruleContentSha256, UNSIGNED, type RuleSignOff } from "@/lib/admin/rule-sign-off";
import { fatigueWarnings, fatigueWarningsUngated, type FatigueShift } from "@/lib/roster/fatigue-rules";
import { FATIGUE_RULE_SET } from "@/lib/roster/fatigue-rules-source";
import { addDaysToDate, perthWallToIso } from "@/lib/roster/shifts/perth-time";
import type { ShiftKind } from "@/lib/roster/shift-kind";

const signers = [{ userId: "11111111-1111-4111-8111-111111111111", name: "Dr Jane Example" }];
const signOff: RuleSignOff = {
  enabled: true,
  signedBy: "Dr Jane Example",
  signedByUserId: "11111111-1111-4111-8111-111111111111",
  signedAt: "2026-10-02T01:30:00.000Z",
  signedContentSha256: ruleContentSha256(FATIGUE_RULE_SET),
};

let counter = 0;
/** A shift from a Perth date and wall times; an end time at or before the start runs into the next day. */
function shift(date: string, from: string, to: string, kind: ShiftKind = "day"): FatigueShift {
  const endDate = to <= from ? addDaysToDate(date, 1) : date;
  counter += 1;
  return { id: `s${counter}`, startsAt: perthWallToIso(date, from)!, endsAt: perthWallToIso(endDate, to)!, kind };
}

function run(firstDate: string, count: number, from: string, to: string, kind: ShiftKind): FatigueShift[] {
  return Array.from({ length: count }, (_, index) => shift(addDaysToDate(firstDate, index), from, to, kind));
}

const rules = (shifts: FatigueShift[]) => fatigueWarningsUngated(shifts).map((warning) => warning.rule);

describe("fatigue rule source", () => {
  it("stays off while unsigned, whatever the committed store holds", () => {
    const result = fatigueWarnings(run("2026-10-05", 6, "21:00", "09:00", "night"), UNSIGNED);
    expect(result).toEqual({ gate: { on: false, reason: "unsigned" }, warnings: [] });
  });

  it("every quote states the figure the engine uses", () => {
    const r = FATIGUE_RULE_SET.rules;
    expect(r.minBreakHours.quote).toContain(`${r.minBreakHours.hours} hour`);
    expect(r.maxHours7d.quote).toContain(`${r.maxHours7d.hours} hours`);
    expect(r.maxHours14d.quote).toContain(`${r.maxHours14d.hours} hours`);
    expect(r.maxShiftHours.quote).toContain(`${r.maxShiftHours.hours} consecutive hours`);
    expect(r.maxShiftHoursAfterNoon.quote).toContain(`${r.maxShiftHoursAfterNoon.hours} consecutive hours`);
    expect(r.maxNightsInRow.nights).toBe(4);
    expect(r.maxNightsInRow.quote).toContain("four consecutive nights");
    expect(r.maxNightsInRow.exception).toMatchObject({ nights: 5, maxTotalHours: 50 });
    expect(r.maxNightsInRow.exception.quote).toContain("five consecutive nights");
    expect(r.maxNightsInRow.exception.quote).toContain("exceed fifty");
    expect(r.restAfterNights.bands.map((band) => [band.upToNights, band.hours])).toEqual([
      [3, 24],
      [5, 48],
    ]);
    for (const band of r.restAfterNights.bands) expect(band.quote.startsWith(`${band.hours} hours`)).toBe(true);
    expect(r.maxDaysBeforeTwoDaysOff).toMatchObject({ days: 12, hoursOff: 48 });
    expect(r.maxDaysBeforeTwoDaysOff.quote).toContain("Forty eight consecutive hours");
    expect(r.maxDaysBeforeTwoDaysOff.quote).toContain("12 days");
  });
});

describe("fatigueWarnings review date", () => {
  it("fails closed once the source review date has passed", () => {
    const shifts = [shift("2027-09-05", "08:00", "23:00")];
    const before = Date.parse("2027-09-02T12:00:00+08:00");
    const after = Date.parse("2027-09-03T00:00:00+08:00");
    expect(fatigueWarnings(shifts, signOff, signers, before).gate).toEqual({ on: true });
    expect(fatigueWarnings(shifts, signOff, signers, after)).toEqual({
      gate: { on: false, reason: "review-date-passed" },
      warnings: [],
    });
  });
});

describe("fatigueWarnings", () => {
  it("runs once a named clinician signs and switches it on", () => {
    const result = fatigueWarnings([shift("2026-10-05", "08:00", "23:00")], signOff, signers);
    expect(result.gate).toEqual({ on: true });
    expect(result.warnings.map((warning) => warning.rule)).toEqual(["maxShiftHours"]);
  });

  it("warns on a break under 10 hours, with the clause's words", () => {
    const [warning] = fatigueWarningsUngated([
      shift("2026-10-05", "08:00", "22:00"),
      shift("2026-10-06", "07:00", "15:00"),
    ]);
    expect(warning).toMatchObject({ rule: "minBreakHours", words: "9 hours' break before this shift." });
    expect(warning!.citation).toEqual({ clause: "15(4)(a)", quote: FATIGUE_RULE_SET.rules.minBreakHours.quote });
  });

  it("allows exactly 10 hours' break", () => {
    expect(rules([shift("2026-10-05", "08:00", "21:00"), shift("2026-10-06", "07:00", "15:00")])).toEqual([]);
  });

  it("checks shift length against 14 hours, or 12 after 12 noon", () => {
    expect(rules([shift("2026-10-05", "08:00", "22:30")])).toEqual(["maxShiftHours"]);
    expect(rules([shift("2026-10-05", "08:00", "22:00")])).toEqual([]);
    expect(rules([shift("2026-10-05", "12:00", "02:00", "evening")])).toEqual([]);
    const [late] = fatigueWarningsUngated([shift("2026-10-05", "13:00", "01:30", "evening")]);
    expect(late).toMatchObject({ rule: "maxShiftHoursAfterNoon", exception: { clause: "15(6)(e)" } });
  });

  it("allows a fifth night only when the five total no more than fifty hours", () => {
    expect(rules(run("2026-10-05", 5, "21:00", "07:00", "night"))).toEqual([]);
    const over = fatigueWarningsUngated(run("2026-10-05", 5, "21:00", "07:30", "night"));
    expect(over.map((warning) => [warning.rule, warning.words])).toEqual([
      ["maxNightsInRow", "5th night in a row, with 52.5 rostered hours across the five."],
    ]);
  });

  it("always warns on a sixth night in a row", () => {
    const sixShort = fatigueWarningsUngated(run("2026-10-05", 6, "22:00", "06:00", "night"));
    expect(sixShort.map((warning) => [warning.rule, warning.words])).toEqual([
      ["maxNightsInRow", "6th night in a row."],
    ]);
  });

  it("asks for 24 hours free after up to three nights, counting on call as duty", () => {
    const nights = run("2026-10-05", 3, "21:00", "07:00", "night");
    const onCall = shift("2026-10-08", "17:00", "08:00", "on_call");
    const [warning] = fatigueWarningsUngated([...nights, onCall]);
    expect(warning).toMatchObject({
      shiftId: onCall.id,
      rule: "restAfterNights",
      words: "10 hours free after 3 nights in a row before this on call.",
    });
    expect(warning!.citation.quote).toContain("24 hours following a single night, two or three consecutive nights");
    expect(rules([...nights, shift("2026-10-09", "08:00", "16:00")])).toEqual([]);
  });

  it("treats duty overlapping the end of the last night as no time free", () => {
    const nights = run("2026-10-05", 3, "21:00", "07:00", "night");
    const onCall = shift("2026-10-07", "17:00", "08:00", "on_call");
    const warnings = fatigueWarningsUngated([...nights, onCall]).filter(
      (warning) => warning.rule === "restAfterNights",
    );
    expect(warnings).toEqual([
      expect.objectContaining({
        shiftId: onCall.id,
        words: "0 hours free after 3 nights in a row before this on call.",
      }),
    ]);
  });

  it("asks for 48 hours free after four or five nights", () => {
    const nights = run("2026-10-05", 4, "21:00", "07:00", "night");
    const day = shift("2026-10-10", "08:00", "16:00");
    const [warning] = fatigueWarningsUngated([...nights, day]);
    expect(warning).toMatchObject({ shiftId: day.id, rule: "restAfterNights" });
    expect(warning!.words).toBe("25 hours free after 4 nights in a row before this shift.");
    expect(rules([...nights, shift("2026-10-11", "08:00", "16:00")])).toEqual([]);
  });

  it("warns from the 13th day in a row", () => {
    const days = run("2026-10-05", 13, "08:00", "16:00", "day");
    const warnings = fatigueWarningsUngated(days);
    expect(warnings.map((warning) => [warning.rule, warning.shiftId, warning.words])).toEqual([
      ["maxDaysBeforeTwoDaysOff", days[12]!.id, "13th day of work without 48 hours free from all duty."],
    ]);
    expect(rules(days.slice(0, 12))).toEqual([]);
  });

  it("does not let one empty day restart the 12 day count", () => {
    const first = run("2026-10-05", 12, "08:00", "16:00", "day");
    const second = run("2026-10-18", 1, "08:00", "16:00", "day"); // one free date: 40 hours off
    expect(fatigueWarningsUngated([...first, ...second]).map((warning) => [warning.rule, warning.shiftId])).toEqual([
      ["maxDaysBeforeTwoDaysOff", second[0]!.id],
    ]);
    const afterTwoDays = run("2026-10-19", 1, "08:00", "16:00", "day"); // two free dates: 64 hours off
    expect(rules([...first, ...afterTwoDays])).toEqual([]);
  });

  it("counts on call as duty when looking for the 48 hours free", () => {
    const first = run("2026-10-05", 12, "08:00", "16:00", "day");
    const onCall = shift("2026-10-17", "17:00", "08:00", "on_call");
    const next = run("2026-10-19", 1, "08:00", "16:00", "day");
    expect(rules([...first, onCall, ...next])).toEqual(["maxDaysBeforeTwoDaysOff", "maxDaysBeforeTwoDaysOff"]);
  });

  it("warns on an on-call period that interrupts the 48 hours free, with no later shift", () => {
    const first = run("2026-10-05", 12, "08:00", "16:00", "day");
    const onCall = shift("2026-10-17", "08:00", "20:00", "on_call"); // 16 hours after the 12th shift
    expect(fatigueWarningsUngated([...first, onCall]).map((warning) => [warning.rule, warning.shiftId])).toEqual([
      ["maxDaysBeforeTwoDaysOff", onCall.id],
    ]);
    const afterBreak = shift("2026-10-19", "08:00", "20:00", "on_call"); // 64 hours free
    expect(rules([...first, afterBreak])).toEqual([]);
  });

  it("treats a start 30 seconds after noon as after noon", () => {
    const startsAt = perthWallToIso("2026-10-05", "12:00")!;
    const mk = (offsetSeconds: number, hours: number): FatigueShift => {
      const start = Date.parse(startsAt) + offsetSeconds * 1000;
      return {
        id: `n${offsetSeconds}`,
        startsAt: new Date(start).toISOString(),
        endsAt: new Date(start + hours * 3_600_000).toISOString(),
        kind: "evening",
      };
    };
    expect(rules([mk(30, 13.9)])).toEqual(["maxShiftHoursAfterNoon"]);
    expect(rules([mk(0, 13.9)])).toEqual([]);
  });

  it("warns past 75 hours in seven days", () => {
    const days = run("2026-10-05", 7, "08:00", "19:00", "day");
    const warnings = fatigueWarningsUngated(days);
    expect(warnings.map((warning) => [warning.rule, warning.shiftId])).toEqual([["maxHours7d", days[6]!.id]]);
  });

  it("ignores leave and on call when counting worked hours and breaks", () => {
    expect(rules([shift("2026-10-05", "08:00", "18:00"), shift("2026-10-05", "19:00", "08:00", "on_call")])).toEqual(
      [],
    );
    expect(rules([shift("2026-10-05", "00:00", "23:59", "leave")])).toEqual([]);
  });
});
