import { describe, expect, it } from "vitest";

import {
  dsmCategories,
  dsmCriteriaView,
  dsmDiagnoses,
  dsmStaticParams,
  getDsmDiagnosis,
  rankDsmDiagnoses,
  resolveDsmCompareIds,
  resolveDsmDifferential,
} from "@/lib/dsm";

describe("DSM clinical catalogue", () => {
  it("interprets natural-language symptom phrases as diagnosis catalogue search", () => {
    expect(rankDsmDiagnoses("Which diagnoses involve elevated mood?", 3, [], true)[0]?.diagnosis.slug).toBe(
      "bipolar-i-disorder",
    );
  });

  it("loads every supplied diagnosis and keeps slugs unique", () => {
    expect(dsmDiagnoses).toHaveLength(146);
    expect(new Set(dsmDiagnoses.map((diagnosis) => diagnosis.slug)).size).toBe(146);
    expect(dsmStaticParams()).toHaveLength(146);
    expect(dsmCategories.reduce((total, category) => total + category.diagnosis_count, 0)).toBe(146);
  });

  it("keeps each record complete enough for the five DSM surfaces", () => {
    for (const diagnosis of dsmDiagnoses) {
      expect(diagnosis.title).toBeTruthy();
      expect(diagnosis.icd_code).toBeTruthy();
      expect(diagnosis.category.label).toBeTruthy();
      expect(dsmCriteriaView(diagnosis).rows.length).toBeGreaterThan(0);
      expect(diagnosis.documentation_template).toBeTruthy();
    }
  });

  it("shows key features when a separate criteria display was not supplied, but does not call them criteria", () => {
    const diagnosis = getDsmDiagnosis("major-depressive-disorder");
    expect(diagnosis).toBeDefined();
    expect(diagnosis?.criteria_display).toEqual([]);
    const view = dsmCriteriaView(diagnosis!);
    expect(view.rows).toEqual(diagnosis?.key_features);
    expect(view.isDsmCriteria).toBe(false);
    expect(view.provenance).toBe("key_features_summary");
  });

  it("searches titles, ICD codes, categories, and criteria", () => {
    expect(rankDsmDiagnoses("major depressive disorder", 1)[0]?.diagnosis.slug).toBe("major-depressive-disorder");
    expect(rankDsmDiagnoses("F31.81", 1)[0]?.diagnosis.slug).toBe("bipolar-ii-disorder");
    expect(rankDsmDiagnoses("Mood Disorders", 20).length).toBeGreaterThan(1);
    expect(
      rankDsmDiagnoses("hypomanic episode", 5).some((match) => match.diagnosis.slug === "bipolar-ii-disorder"),
    ).toBe(true);
  });

  it("keeps a typo-corrected diagnosis title ahead of incidental clinical mentions", () => {
    expect(rankDsmDiagnoses("schizophrnia", 5).some((match) => match.diagnosis.slug === "schizophrenia")).toBe(true);
  });

  it("links named differential considerations back to catalogue records", () => {
    const diagnosis = getDsmDiagnosis("major-depressive-disorder");
    const bipolar = diagnosis?.differentials.find((item) => item.startsWith("Bipolar I or II"));
    expect(bipolar).toBeTruthy();
    expect(resolveDsmDifferential("Bipolar II disorder (hypomanic periods identified)")?.slug).toBe(
      "bipolar-ii-disorder",
    );
  });

  it("resolves initialisms after stripping title parentheticals", () => {
    expect(resolveDsmDifferential("MDD")?.slug).toBe("major-depressive-disorder");
    expect(resolveDsmDifferential("PDD")?.slug).toBe("persistent-depressive-disorder-dysthymia");
    expect(
      rankDsmDiagnoses("PDD", 5).some((match) => match.diagnosis.slug === "persistent-depressive-disorder-dysthymia"),
    ).toBe(true);
  });

  it("ranks abbreviation queries above incidental differential mentions", () => {
    expect(rankDsmDiagnoses("MDD", 1)[0]?.diagnosis.slug).toBe("major-depressive-disorder");
    expect(rankDsmDiagnoses("PDD", 1)[0]?.diagnosis.slug).toBe("persistent-depressive-disorder-dysthymia");
  });

  it("ranks Major depressive disorder first for a plain search for depression", () => {
    expect(rankDsmDiagnoses("depression", 4, [], true)[0]?.diagnosis.slug).toBe("major-depressive-disorder");
    expect(rankDsmDiagnoses("major depression", 1, [], true)[0]?.diagnosis.slug).toBe("major-depressive-disorder");
    expect(rankDsmDiagnoses("chronic depression", 1, [], true)[0]?.diagnosis.slug).toBe(
      "persistent-depressive-disorder-dysthymia",
    );
  });

  it("ranks US DSM spellings to the matching catalogue diagnoses", () => {
    expect(rankDsmDiagnoses("generalized anxiety disorder", 1)[0]?.diagnosis.slug).toBe("generalised-anxiety-disorder");
  });

  it("deduplicates compare ids after canonical slug resolution", () => {
    const result = resolveDsmCompareIds([
      "Major-Depressive-Disorder",
      "major-depressive-disorder",
      "bipolar-ii-disorder",
    ]);
    expect(result.diagnoses.map((diagnosis) => diagnosis.slug)).toEqual([
      "major-depressive-disorder",
      "bipolar-ii-disorder",
    ]);
    expect(result.selectedIds).toEqual(["major-depressive-disorder", null, "bipolar-ii-disorder"]);
  });

  it("keeps compare-id holes and drops unknown slugs", () => {
    const result = resolveDsmCompareIds([null, "not-a-diagnosis", "bipolar-ii-disorder"]);
    expect(result.diagnoses.map((diagnosis) => diagnosis.slug)).toEqual(["bipolar-ii-disorder"]);
    expect(result.selectedIds).toEqual([null, null, "bipolar-ii-disorder"]);
  });
});
