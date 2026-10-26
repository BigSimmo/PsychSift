import { describe, expect, it } from "vitest";

import {
  findSpecifier,
  normalizeSpecifierSelection,
  searchSpecifiers,
  specifierAppliesToBuilderDiagnosis,
  specifierRecords,
} from "@/lib/specifiers";

describe("psychiatric specifier catalogue", () => {
  it("keeps slugs unique and related links valid", () => {
    const slugs = specifierRecords.map((record) => record.slug);
    expect(new Set(slugs).size).toBe(slugs.length);

    for (const record of specifierRecords) {
      expect(record.name).toBeTruthy();
      expect(record.summary).toBeTruthy();
      expect(record.fit.length).toBeGreaterThanOrEqual(2);
      expect(record.notFit.length).toBeGreaterThanOrEqual(2);
      expect(record.wording).toBeTruthy();
      for (const relatedSlug of record.relatedSlugs) {
        expect(findSpecifier(relatedSlug)).toBeTruthy();
      }
    }
  });

  it("matches natural clinical language to the deciding specifier", () => {
    expect(searchSpecifiers("depressed but racing thoughts and barely sleeping")[0]?.record.slug).toBe(
      "with-mixed-features",
    );
    expect(searchSpecifiers("depression returns every winter and lifts in spring")[0]?.record.slug).toBe(
      "with-seasonal-pattern",
    );
    expect(searchSpecifiers("stopped speaking and holds the same posture")[0]?.record.slug).toBe("with-catatonia");
    expect(searchSpecifiers("much better but not fully recovered")[0]?.record.slug).toBe("in-partial-remission");
  });

  it("filters by diagnostic role and diagnosis context", () => {
    const courseResults = searchSpecifiers("", { family: "course-onset" });
    expect(courseResults.length).toBeGreaterThan(0);
    expect(courseResults.every(({ record }) => record.family === "course-onset")).toBe(true);

    const psychoticResults = searchSpecifiers("", { diagnosis: "psychotic" });
    expect(psychoticResults.map(({ record }) => record.slug)).toContain("with-catatonia");

    const depressiveResults = searchSpecifiers("mild", { diagnosis: "depressive" });
    expect(depressiveResults.map(({ record }) => record.slug)).toContain("mild-severity");

    const moodEpisodeResults = searchSpecifiers("", { diagnosis: "mood" });
    expect(moodEpisodeResults.map(({ record }) => record.slug)).toEqual(
      expect.arrayContaining(["with-anxious-distress", "with-rapid-cycling", "mild-severity"]),
    );
  });

  it("normalizes seeded builder selections to one severity or remission descriptor", () => {
    expect(
      normalizeSpecifierSelection([
        "with-anxious-distress",
        "in-partial-remission",
        "missing-specifier",
        "in-full-remission",
        "with-anxious-distress",
      ]),
    ).toEqual(["with-anxious-distress", "in-full-remission"]);

    expect(normalizeSpecifierSelection(["mild-severity", "with-psychotic-features"])).toEqual([
      "with-psychotic-features",
    ]);
    expect(normalizeSpecifierSelection(["with-psychotic-features", "mild-severity"])).toEqual(["mild-severity"]);
  });

  it("never keeps 'severe with psychotic features' alongside a remission descriptor", () => {
    for (const remission of ["in-partial-remission", "in-full-remission"]) {
      expect(normalizeSpecifierSelection(["with-psychotic-features", remission])).toEqual([remission]);
      expect(normalizeSpecifierSelection([remission, "with-psychotic-features"])).toEqual(["with-psychotic-features"]);
      expect(normalizeSpecifierSelection(["with-anxious-distress", "with-psychotic-features", remission])).toEqual([
        "with-anxious-distress",
        remission,
      ]);
    }
  });

  it("matches builder specifiers to the selected diagnosis and episode", () => {
    const rapidCycling = findSpecifier("with-rapid-cycling");
    const melancholic = findSpecifier("with-melancholic-features");
    expect(rapidCycling).toBeDefined();
    expect(melancholic).toBeDefined();

    expect(specifierAppliesToBuilderDiagnosis(rapidCycling!, "mdd-recurrent")).toBe(false);
    expect(specifierAppliesToBuilderDiagnosis(rapidCycling!, "bipolar-i-manic")).toBe(true);
    expect(specifierAppliesToBuilderDiagnosis(melancholic!, "bipolar-i-manic")).toBe(false);
    expect(specifierAppliesToBuilderDiagnosis(melancholic!, "bipolar-i-depressed")).toBe(true);
  });

  it("does not expose provenance columns in the specifier search records", () => {
    for (const record of specifierRecords) {
      expect(Object.hasOwn(record, "source")).toBe(false);
      expect(Object.hasOwn(record, "sourceStatus")).toBe(false);
    }
  });
});
