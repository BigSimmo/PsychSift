import { describe, expect, it } from "vitest";

import { ruleContentSha256, UNSIGNED, type RuleSignOff } from "@/lib/admin/rule-sign-off";
import { cpdCategoryCoaching, cpdCategoryCoachingUngated, cpdStandardMismatches } from "@/lib/cme/category-coaching";
import { CPD_CATEGORY_RULE_SET } from "@/lib/cme/category-rules-source";
import { createAustralianRanzcpPreset } from "@/lib/cme/presets";
import type { CmeCategory, CmeEntry, CmeRequirementSet } from "@/lib/cme/types";

const signers = [{ userId: "11111111-1111-4111-8111-111111111111", name: "Dr Jane Example" }];
const signOff: RuleSignOff = {
  enabled: true,
  signedBy: "Dr Jane Example",
  signedByUserId: "11111111-1111-4111-8111-111111111111",
  signedAt: "2026-10-02T01:30:00.000Z",
  signedContentSha256: ruleContentSha256(CPD_CATEGORY_RULE_SET),
};

let counter = 0;
function entry(hours: Partial<Record<CmeCategory, number>>, extra: Partial<CmeEntry> = {}): CmeEntry {
  counter += 1;
  return {
    id: `e${counter}`,
    date: "2026-03-01",
    title: "Invented activity",
    allocations: Object.entries(hours).map(([category, value]) => ({
      category: category as CmeCategory,
      hours: value!,
    })),
    reflection: "",
    costCents: null,
    transcribed: false,
    routineId: null,
    documentId: null,
    buckets: [],
    ...extra,
  };
}

const preset = createAustralianRanzcpPreset(2026, "2026-01-05");

describe("CPD category rule source", () => {
  it("stays off while unsigned, whatever the committed store holds", () => {
    expect(cpdCategoryCoaching(preset, [], UNSIGNED)).toEqual({
      gate: { on: false, reason: "unsigned" },
      coaching: null,
    });
  });

  it("every quote states the figure the engine uses", () => {
    const r = CPD_CATEGORY_RULE_SET.rules;
    expect(r.totalHours.quote).toContain(`minimum of ${r.totalHours.hours} hours per year`);
    expect(r.educationalHours.quote).toContain(`at least ${r.educationalHours.hours} hours`);
    expect(r.reviewingAndMeasuringHours.quote).toContain(`at least ${r.reviewingAndMeasuringHours.hours} hours`);
    expect(r.reviewingAndMeasuringHours.minimumEachHours).toBe(5);
    expect(r.reviewingAndMeasuringHours.quote).toContain("a minimum of five hours for each category");
    expect(r.remainingHours.quote).toContain(`remaining ${r.remainingHours.hours} hours`);
    expect(r.educationalHours.hours + r.reviewingAndMeasuringHours.hours + r.remainingHours.hours).toBe(
      r.totalHours.hours,
    );
  });

  it("the starting preset carries exactly the Board's national figures", () => {
    expect(cpdStandardMismatches(preset)).toEqual([]);
    expect(preset.totalHours).toBe(CPD_CATEGORY_RULE_SET.rules.totalHours.hours);
  });
});

describe("cpdStandardMismatches", () => {
  it("flags a target below the Board's minimum, and accepts a higher one", () => {
    const lowered: CmeRequirementSet = {
      ...preset,
      totalHours: 40,
      requirements: preset.requirements.map((requirement) =>
        requirement.id === "educational" && requirement.spec.shape === "hours-in-category"
          ? { ...requirement, spec: { ...requirement.spec, minimumHours: 10 } }
          : requirement,
      ),
    };
    expect(cpdStandardMismatches(lowered).map((mismatch) => [mismatch.id, mismatch.yours, mismatch.standard])).toEqual([
      ["total", 40, 50],
      ["educational", 10, 12.5],
    ]);
    expect(cpdStandardMismatches({ ...preset, totalHours: 60 })).toEqual([]);
  });

  it("flags a missing national line", () => {
    const missing = {
      ...preset,
      requirements: preset.requirements.filter((requirement) => requirement.id !== "combined"),
    };
    expect(cpdStandardMismatches(missing)).toEqual([
      expect.objectContaining({ id: "reviewing-and-measuring", yours: null, standard: 25 }),
    ]);
  });

  it("does not accept a combined line that also includes another category", () => {
    const widened = {
      ...preset,
      requirements: preset.requirements.map((requirement) =>
        requirement.spec.shape === "hours-across-categories"
          ? {
              ...requirement,
              spec: { ...requirement.spec, categories: [...requirement.spec.categories, "educational" as const] },
            }
          : requirement,
      ),
    };
    expect(cpdStandardMismatches(widened)).toEqual([
      expect.objectContaining({ id: "reviewing-and-measuring", yours: null, standard: 25 }),
    ]);
  });
});

describe("cpdCategoryCoaching", () => {
  it("runs once a named clinician signs and switches it on", () => {
    const result = cpdCategoryCoaching(preset, [], signOff, signers);
    expect(result.gate).toEqual({ on: true });
    expect(result.coaching?.lines.map((line) => [line.id, line.hoursShort])).toEqual([
      ["total", 50],
      ["educational", 12.5],
      ["reviewing-and-measuring", 25],
      ["reviewing", 5],
      ["measuring", 5],
    ]);
  });

  it("gives no coaching for years before the standard took effect", () => {
    const old = createAustralianRanzcpPreset(2022, "2022-01-05");
    expect(cpdCategoryCoaching(old, [], signOff, signers)).toEqual({
      gate: { on: false, reason: "standard-not-in-force" },
      coaching: null,
    });
    expect(cpdCategoryCoaching({ ...old, year: 2023 }, [], signOff, signers).gate).toEqual({ on: true });
  });

  it("counts the per-category floors inside the combined 25 hours", () => {
    const { lines } = cpdCategoryCoachingUngated(preset, [entry({ educational: 20, reviewing: 22 })]);
    const byId = Object.fromEntries(lines.map((line) => [line.id, line]));
    expect(byId.educational).toMatchObject({ met: true, hoursShort: 0 });
    // 22 h reviewing: 3 h short of 25 combined, but 5 h short in measuring, so 5 h is the least left.
    expect(byId["reviewing-and-measuring"]).toMatchObject({ met: false, hoursLogged: 22, hoursShort: 5 });
    expect(byId.measuring).toMatchObject({ met: false, hoursShort: 5 });
    expect(byId.total).toMatchObject({ hoursLogged: 42, hoursShort: 8 });
  });

  it("ignores archived entries, like the CPD page does", () => {
    const { lines } = cpdCategoryCoachingUngated(preset, [entry({ educational: 13 }, { archivedAt: "2026-04-01" })]);
    expect(lines.find((line) => line.id === "educational")).toMatchObject({ hoursLogged: 0, met: false });
  });

  it("is met when every line is met", () => {
    const { lines } = cpdCategoryCoachingUngated(preset, [
      entry({ educational: 12.5, reviewing: 15, measuring: 10 }),
      entry({ educational: 12.5 }),
    ]);
    expect(lines.every((line) => line.met && line.hoursShort === 0)).toBe(true);
  });
});
