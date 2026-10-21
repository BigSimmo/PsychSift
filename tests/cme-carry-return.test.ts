import { describe, expect, it } from "vitest";

import { cmeCarryConfirmHref, cmeCarryGoalId, cmeCarryReturnHref } from "@/lib/cme/carry-return";

const GOAL_ID = "33333333-3333-4333-8333-333333333333";

describe("CPD carry round trip", () => {
  it("builds the set-up link with the year it came from and the chosen goal", () => {
    expect(cmeCarryConfirmHref(2026)).toBe("/cme/setup?year=2027&carryFrom=2026");
    expect(cmeCarryConfirmHref(2026, GOAL_ID)).toBe(`/cme/setup?year=2027&carryFrom=2026&carryGoal=${GOAL_ID}`);
  });

  it("returns to the plan for the year before, at its carry section", () => {
    expect(cmeCarryReturnHref(2027, "2026", GOAL_ID)).toBe(`/cme/plan?year=2026&carry=${GOAL_ID}#cme-carry-goals`);
    expect(cmeCarryReturnHref(2027, "2026", undefined)).toBe("/cme/plan?year=2026#cme-carry-goals");
  });

  it("drops a bad goal id but keeps a valid return", () => {
    expect(cmeCarryReturnHref(2027, "2026", "not-a-uuid")).toBe("/cme/plan?year=2026#cme-carry-goals");
    expect(cmeCarryGoalId("../admin")).toBeNull();
    expect(cmeCarryGoalId(["a", "b"])).toBeNull();
  });

  it("refuses any year that is not exactly the year before", () => {
    expect(cmeCarryReturnHref(2027, "2025", GOAL_ID)).toBeNull();
    expect(cmeCarryReturnHref(2027, "2027", GOAL_ID)).toBeNull();
    expect(cmeCarryReturnHref(2027, "2026x", GOAL_ID)).toBeNull();
    expect(cmeCarryReturnHref(2027, undefined, GOAL_ID)).toBeNull();
    expect(cmeCarryReturnHref(2027, "https://example.com", GOAL_ID)).toBeNull();
  });
});
