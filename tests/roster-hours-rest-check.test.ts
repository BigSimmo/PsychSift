import { describe, expect, it } from "vitest";

import { ruleContentSha256, UNSIGNED, type RuleSignOff } from "@/lib/admin/rule-sign-off";
import type { FatigueShift } from "@/lib/roster/fatigue-rules";
import { FATIGUE_RULE_SET } from "@/lib/roster/fatigue-rules-source";
import { hoursRestCheck } from "@/lib/roster/hours-rest-check";
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
function shift(date: string, from: string, to: string, kind: ShiftKind = "day"): FatigueShift {
  const endDate = to <= from ? addDaysToDate(date, 1) : date;
  counter += 1;
  return { id: `s${counter}`, startsAt: perthWallToIso(date, from)!, endsAt: perthWallToIso(endDate, to)!, kind };
}

// 08:00 Perth on Monday 5 October 2026.
const now = new Date(perthWallToIso("2026-10-05", "08:00")!);
const check = (shifts: FatigueShift[]) => {
  const result = hoursRestCheck(shifts, now, signOff, signers);
  if (!result.on) throw new Error("expected the check to be on");
  return result;
};
const gauge = (shifts: FatigueShift[], rule: string) => check(shifts).gauges.find((g) => g.rule === rule);

describe("hours and rest check", () => {
  it("measures nothing while the rules are unsigned", () => {
    expect(hoursRestCheck([shift("2026-10-05", "08:00", "17:00")], now, UNSIGNED, signers)).toEqual({ on: false });
  });

  it("covers today and the 13 days after, with the signed limits", () => {
    const result = check([]);
    expect([result.start, result.end]).toEqual(["2026-10-05", "2026-10-18"]);
    expect(result.gauges.map((g) => [g.rule, g.limit, g.value])).toEqual([
      ["maxHours7d", 75, 0],
      ["maxHours14d", 140, 0],
      ["maxShiftHours", 14, 0],
      ["maxNightsInRow", 4, 0],
    ]);
    expect(result.minBreakHours).toBe(10);
  });

  it("counts 7 and 14 day hours as the warnings do, leaving out leave and on call", () => {
    const shifts = [
      ...Array.from({ length: 5 }, (_, i) => shift(addDaysToDate("2026-10-05", i), "08:00", "18:00")),
      shift("2026-10-10", "08:00", "18:00", "leave"),
      shift("2026-10-11", "18:00", "08:00", "on_call"),
    ];
    expect(gauge(shifts, "maxHours7d")?.value).toBe(50);
    expect(gauge(shifts, "maxHours14d")?.value).toBe(50);
  });

  it("picks the shift closest to its own limit, 12 hours after noon", () => {
    const shifts = [shift("2026-10-05", "08:00", "21:00"), shift("2026-10-07", "13:00", "00:30")];
    expect(gauge(shifts, "maxShiftHoursAfterNoon")).toMatchObject({ value: 11.5, limit: 12, clause: "15(6)(d)" });
  });

  it("counts a night run that began before today", () => {
    const shifts = Array.from({ length: 5 }, (_, i) =>
      shift(addDaysToDate("2026-10-03", i), "21:00", "08:00", "night"),
    );
    expect(gauge(shifts, "maxNightsInRow")?.value).toBe(5);
  });

  it("lists each break ahead and keeps the warnings for shifts in the window", () => {
    const shifts = [
      shift("2026-10-05", "08:00", "22:00"),
      shift("2026-10-06", "06:00", "14:00"),
      shift("2026-10-30", "08:00", "17:00"),
    ];
    const result = check(shifts);
    expect(result.breaks).toEqual([{ shiftId: shifts[1]!.id, fromDate: "2026-10-05", toDate: "2026-10-06", hours: 8 }]);
    expect(result.warnings.map((w) => w.rule)).toEqual(["minBreakHours"]);
  });
});
