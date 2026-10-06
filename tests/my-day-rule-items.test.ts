import { describe, expect, it } from "vitest";

import { createAustralianRanzcpPreset } from "@/lib/cme/presets";
import { cpdCoachingMyDayItems, fatigueMyDayItems, ruleEnginesOn } from "@/lib/my-day/rule-items";
import { addDaysToDate, perthWallToIso } from "@/lib/roster/shifts/perth-time";

/** After the owner's 4 October 2026 sign-offs and before the fatigue source's review date. */
const now = new Date("2026-10-10T01:00:00.000Z"); // 09:00 Perth, Saturday 10 October

function shift(id: string, date: string, from: string, to: string, title = "Ward") {
  const endDate = to <= from ? addDaysToDate(date, 1) : date;
  return { id, title, startsAt: perthWallToIso(date, from)!, endsAt: perthWallToIso(endDate, to)! };
}

describe("My Day rule items", () => {
  it("reads the committed sign-offs: fatigue and CPD coaching are switched on", () => {
    expect(ruleEnginesOn(now)).toEqual({ fatigue: true, cpd: true });
  });

  it("shows a fatigue warning for an upcoming shift, and none for a past one", () => {
    const shifts = [
      shift("past-a", "2026-10-05", "08:00", "22:00"),
      shift("past-b", "2026-10-06", "07:00", "15:00"),
      shift("next-a", "2026-10-11", "08:00", "22:00"),
      shift("next-b", "2026-10-12", "07:00", "15:00"),
    ];
    const items = fatigueMyDayItems(shifts, now);
    expect(items.map((item) => [item.id, item.mode, item.severity])).toEqual([
      ["roster:fatigue:next-b:minBreakHours", "roster", "info"],
    ]);
    expect(items[0]!.detail).toContain("15(4)(a)");
  });

  it("infers a shift's kind from its title when the roster row has none", () => {
    const onCall = [
      shift("call-a", "2026-10-11", "08:00", "22:00", "On call"),
      shift("call-b", "2026-10-12", "07:00", "15:00"),
    ];
    expect(fatigueMyDayItems(onCall, now)).toEqual([]);
  });

  it("lists unmet Medical Board lines for the confirmed year", () => {
    const set = createAustralianRanzcpPreset(2026, "2026-01-05");
    const items = cpdCoachingMyDayItems(set, [], now);
    expect(items.map((item) => item.id)).toEqual([
      "cme:board-minimum:2026:total",
      "cme:board-minimum:2026:educational",
      "cme:board-minimum:2026:reviewing-and-measuring",
      "cme:board-minimum:2026:reviewing",
      "cme:board-minimum:2026:measuring",
    ]);
    expect(items.every((item) => item.mode === "cme" && item.severity === "info")).toBe(true);
  });

  it("shows no CPD coaching without a confirmed year, or for a closed year", () => {
    expect(cpdCoachingMyDayItems(null, [], now)).toEqual([]);
    const closed = { ...createAustralianRanzcpPreset(2026, "2026-01-05"), closedAt: "2026-12-31T00:00:00.000Z" };
    expect(cpdCoachingMyDayItems(closed, [], now)).toEqual([]);
  });
});
