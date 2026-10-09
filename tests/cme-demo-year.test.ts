import { describe, expect, it } from "vitest";

import { DEMO_CME_ENTRIES, DEMO_CME_INSTANT, DEMO_CME_YEAR } from "@/lib/cme/demo-year";
import { evaluateYear, totalAllocatedHours } from "@/lib/cme/evaluate";
import { cpdYearOf } from "@/lib/cme/cpd-year";

describe("the demo year", () => {
  it("matches the figures the design boards and the pixel baselines assume", () => {
    expect(DEMO_CME_ENTRIES).toHaveLength(47);
    expect(totalAllocatedHours(DEMO_CME_ENTRIES)).toBe(32.5);
    expect(cpdYearOf(DEMO_CME_INSTANT)).toBe(2026);
  });

  it("leaves exactly the gaps the screens are drawn around", () => {
    const result = evaluateYear({ set: DEMO_CME_YEAR, entries: DEMO_CME_ENTRIES });
    expect(result.unmet.map((status) => status.requirementId).sort()).toEqual(
      ["combined", "domains", "measuring", "peer-review", "self-evaluation"].sort(),
    );
  });

  it("states no clinical fact", () => {
    const text = DEMO_CME_ENTRIES.map((entry) => `${entry.title} ${entry.reflection}`).join(" ");
    expect(text).not.toMatch(/\b\d+(?:\.\d+)?\s?(?:mg|mcg|mmol|ng\/mL|units?)\b/i);
  });

  it("lives inside its year", () => {
    for (const entry of DEMO_CME_ENTRIES) expect(entry.date.startsWith("2026-")).toBe(true);
  });

  it("includes multi-allocation and routine-sourced entries while preserving category totals", () => {
    const multi = DEMO_CME_ENTRIES.filter((e) => e.allocations.length > 1);
    expect(multi.length).toBeGreaterThanOrEqual(1);

    const routineLinked = DEMO_CME_ENTRIES.filter((e) => e.routineId !== null);
    expect(routineLinked.length).toBeGreaterThanOrEqual(1);

    const categorySums = { educational: 0, reviewing: 0, measuring: 0 };
    for (const e of DEMO_CME_ENTRIES) {
      for (const a of e.allocations) {
        categorySums[a.category] += a.hours;
      }
    }
    expect(categorySums).toEqual({
      educational: 22.5,
      reviewing: 8.0,
      measuring: 2.0,
    });
  });
});
