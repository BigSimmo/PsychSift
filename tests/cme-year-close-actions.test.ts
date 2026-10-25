import { describe, expect, it } from "vitest";

import { DEMO_CME_ENTRIES, DEMO_CME_PLAN_GOALS, DEMO_CME_YEAR } from "@/lib/cme/demo-year";
import {
  buildCmeYearEndActions,
  canCarryCmeGoals,
  canOfferCmeYearEnd,
  carryableCmeGoals,
} from "@/lib/cme/year-close-actions";

const set = { ...DEMO_CME_YEAR, year: 2026, closedAt: null };

describe("year-end actions", () => {
  it("opens on 17 December and remains offered in January only while the year is open", () => {
    expect(canOfferCmeYearEnd(set, new Date("2026-12-16T12:00:00+08:00"))).toBe(false);
    expect(canOfferCmeYearEnd(set, new Date("2026-12-17T12:00:00+08:00"))).toBe(true);
    expect(canOfferCmeYearEnd(set, new Date("2027-01-10T12:00:00+08:00"))).toBe(true);
    expect(
      canOfferCmeYearEnd({ ...set, closedAt: "2027-01-09T00:00:00Z" }, new Date("2027-01-10T12:00:00+08:00")),
    ).toBe(false);
    expect(canCarryCmeGoals(set, new Date("2027-01-31T23:59:00+08:00"))).toBe(true);
    expect(canCarryCmeGoals(set, new Date("2027-02-01T00:00:00+08:00"))).toBe(false);
  });

  it("derives five plain statuses and destinations from saved records", () => {
    const actions = buildCmeYearEndActions({
      set,
      entries: DEMO_CME_ENTRIES,
      goals: DEMO_CME_PLAN_GOALS,
      now: new Date("2027-01-10T12:00:00+08:00"),
      nextYearConfirmed: null,
    });
    expect(actions.map(({ id }) => id)).toEqual(["copy", "evaluation", "goals", "targets", "summary"]);
    expect(actions.find(({ id }) => id === "copy")?.status).toMatch(/\d+ to copy|All copied/);
    expect(actions.find(({ id }) => id === "targets")?.status).toBe("Not checked");
    expect(actions.find(({ id }) => id === "summary")?.href).toBe("/cme/summary?year=2026");
    // The self-evaluation date is recorded in the Set up form, not the read-only targets page.
    expect(actions.find(({ id }) => id === "evaluation")?.href).toBe("/cme/setup?year=2026&edit=1#cme-setup-steps");
    expect(
      buildCmeYearEndActions({
        set,
        entries: [],
        goals: DEMO_CME_PLAN_GOALS,
        now: new Date("2027-02-01T12:00:00+08:00"),
        nextYearConfirmed: true,
      }).some(({ id }) => id === "goals"),
    ).toBe(false);
  });

  it("never infers that linked activity hours completed a goal", () => {
    const [goal] = DEMO_CME_PLAN_GOALS;
    expect(goal).toBeDefined();
    expect(carryableCmeGoals([goal!], [])).toEqual([goal]);
    expect(carryableCmeGoals([goal!], [{ ...goal!, id: "another-id", goal: goal!.goal.toUpperCase() }])).toEqual([]);
  });
});
