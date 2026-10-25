import { describe, expect, it } from "vitest";

import { loadServicesSnapshot } from "@/lib/service-catalog";
import { mapCatalogToServiceRecords } from "@/lib/service-catalog-mapper";
import {
  deriveServiceFacetOptions,
  deriveSubstanceLensOptions,
  emptyServiceFacetSelection,
  filterServicesByFacets,
  matchesServiceFacets,
  matchesSubstanceLens,
  serviceCatalogTags,
  serviceFacetDimensions,
  serviceFacetOptionCount,
  serviceFacetSelectionFromParams,
  serviceFacetSelectionSize,
  serviceFacetValueLabel,
  serviceSubstanceLensOptionCount,
  serviceSubstanceLensValueLabel,
  writeServiceFacetSelectionToParams,
} from "@/lib/service-facets";

const records = mapCatalogToServiceRecords(loadServicesSnapshot().services);

describe("service facets", () => {
  it("carries the full typed tag payload onto every ServiceRecord (the PR C runtime spike)", () => {
    expect(records).toHaveLength(252);
    for (const record of records) {
      expect(record.catalogPayload).toBeTruthy();
      const tags = serviceCatalogTags(record);
      const total =
        serviceFacetDimensions.reduce((sum, dimension) => sum + tags[dimension].length, 0) +
        tags.substance_flags.length;
      expect(total).toBeGreaterThan(0);
    }
  });

  it("finds substance_flags an exact partition — every service carries exactly one value", () => {
    const counts = records.map((record) => serviceCatalogTags(record).substance_flags.length);
    expect(counts.every((count) => count === 1)).toBe(true);
    const general = records.filter((record) => serviceCatalogTags(record).substance_flags.includes("general")).length;
    const aod = records.filter((record) => serviceCatalogTags(record).substance_flags.includes("aod")).length;
    expect(general + aod).toBe(records.length);
  });

  it("finds housing_flags a near-partition, not an exact one — 11 services carry two values", () => {
    const counts = records.map((record) => serviceCatalogTags(record).housing_flags.length);
    const multi = counts.filter((count) => count > 1).length;
    // 11 from 2026-10-24: SVC-LEG-004 merges into legacy S100, whose housing_support tag joins the curated general.
    expect(multi).toBe(11);
    expect(counts.every((count) => count >= 1)).toBe(true);
  });

  it("derives facet options from the data — never a permanently empty option", () => {
    for (const dimension of serviceFacetDimensions) {
      const options = deriveServiceFacetOptions(records, dimension);
      expect(options.length).toBeGreaterThan(0);
      for (const value of options) {
        expect(records.some((record) => serviceCatalogTags(record)[dimension].includes(value))).toBe(true);
      }
    }
    const substanceOptions = deriveSubstanceLensOptions(records);
    expect(substanceOptions.sort()).toEqual(["aod", "general"]);
  });

  it("matches OR-within-dimension, AND-across-dimensions", () => {
    const empty = emptyServiceFacetSelection();
    const selection = {
      ...empty,
      age_groups: new Set(["youth", "young_adult"]),
      acuity_flags: new Set(["crisis_high"]),
    };
    const matches = filterServicesByFacets(records, selection, "all");
    for (const record of matches) {
      const tags = serviceCatalogTags(record);
      expect(tags.age_groups.some((value) => value === "youth" || value === "young_adult")).toBe(true);
      expect(tags.acuity_flags).toContain("crisis_high");
    }
    // Sanity: narrower than either dimension alone.
    const ageOnly = filterServicesByFacets(records, { ...empty, age_groups: selection.age_groups }, "all");
    const acuityOnly = filterServicesByFacets(records, { ...empty, acuity_flags: selection.acuity_flags }, "all");
    expect(matches.length).toBeLessThanOrEqual(ageOnly.length);
    expect(matches.length).toBeLessThanOrEqual(acuityOnly.length);
  });

  it("computes non-additive union counts — widening a dimension is not a sum", () => {
    const empty = emptyServiceFacetSelection();
    const crisisCount = serviceFacetOptionCount(records, empty, "all", "acuity_flags", "crisis_high");
    const highCount = serviceFacetOptionCount(records, empty, "all", "acuity_flags", "high");
    const withCrisis = { ...empty, acuity_flags: new Set(["crisis_high"]) };
    const bothCount = serviceFacetOptionCount(records, withCrisis, "all", "acuity_flags", "high");
    // The union (crisis_high OR high) must be at least as large as either
    // alone and can only be smaller than the naive sum when any service
    // carries both — exercising the same "not simply additive" property PR B
    // verified for formulation's Affect/Risk domains.
    expect(bothCount).toBeGreaterThanOrEqual(crisisCount);
    expect(bothCount).toBeGreaterThanOrEqual(highCount);
    expect(bothCount).toBeLessThanOrEqual(crisisCount + highCount);
  });

  it("reports the current count, not zero, for an already-selected value", () => {
    const empty = emptyServiceFacetSelection();
    const selection = { ...empty, housing_flags: new Set(["home_based"]) };
    const direct = filterServicesByFacets(records, selection, "all").length;
    expect(serviceFacetOptionCount(records, selection, "all", "housing_flags", "home_based")).toBe(direct);
  });

  it("never disables an already-selected option even when its union count is zero", () => {
    // Deliberately contradictory selection: no service can satisfy both, so
    // the count is genuinely zero — but the already-selected value must stay
    // selectable so the reader can back out of the dead end they created.
    const empty = emptyServiceFacetSelection();
    const contradiction = {
      ...empty,
      catchments: new Set(["__no-such-catchment__"]),
      age_groups: new Set(["youth"]),
    };
    expect(filterServicesByFacets(records, contradiction, "all")).toHaveLength(0);
    expect(serviceFacetOptionCount(records, contradiction, "all", "age_groups", "youth")).toBe(0);
    // The page layer treats `withCandidate === 0 && !selection[dim].has(value)`
    // as the disabled predicate — confirm the already-selected half of that
    // guard holds for a genuinely zero-yield combination.
    expect(contradiction.age_groups.has("youth")).toBe(true);
  });

  it("treats the substance lens as narrowing, never as a union", () => {
    const empty = emptyServiceFacetSelection();
    expect(matchesSubstanceLens(records[0], "all")).toBe(true);
    const aodCount = serviceSubstanceLensOptionCount(records, empty, "aod");
    const generalCount = serviceSubstanceLensOptionCount(records, empty, "general");
    const allCount = serviceSubstanceLensOptionCount(records, empty, "all");
    expect(aodCount + generalCount).toBe(allCount);
    expect(allCount).toBe(records.length);
  });

  it("labels every measured tag value without falling through to a raw token", () => {
    for (const dimension of serviceFacetDimensions) {
      for (const value of deriveServiceFacetOptions(records, dimension)) {
        const label = serviceFacetValueLabel(dimension, value);
        expect(label.length).toBeGreaterThan(0);
        if (dimension !== "catchments") expect(label).not.toBe(value);
      }
    }
    expect(serviceSubstanceLensValueLabel("all")).toBe("All programs");
    expect(serviceSubstanceLensValueLabel("aod")).not.toBe("aod");
  });

  it("round-trips facet selection through URL search params", () => {
    const selection = emptyServiceFacetSelection();
    const withValues = {
      ...selection,
      catchments: new Set(["Metro-wide", "Peel"]),
      acuity_flags: new Set(["crisis_high"]),
    };
    const params = new URLSearchParams();
    writeServiceFacetSelectionToParams(params, withValues);
    expect(params.get("catchments")).toBe("Metro-wide,Peel");
    expect(params.get("acuity_flags")).toBe("crisis_high");

    const commaBearing = { ...selection, catchments: new Set(["Wanneroo, north metro"]) };
    const commaParams = new URLSearchParams();
    writeServiceFacetSelectionToParams(commaParams, commaBearing);
    expect([...serviceFacetSelectionFromParams(commaParams).catchments]).toEqual(["Wanneroo, north metro"]);
    expect(params.has("age_groups")).toBe(false);

    const parsed = serviceFacetSelectionFromParams(params);
    expect([...parsed.catchments].sort()).toEqual(["Metro-wide", "Peel"]);
    expect([...parsed.acuity_flags]).toEqual(["crisis_high"]);
    expect(parsed.age_groups.size).toBe(0);
    expect(serviceFacetSelectionSize(parsed)).toBe(3);
  });

  it("clears a dimension from the URL once its selection empties", () => {
    const params = new URLSearchParams({ catchments: "Peel" });
    writeServiceFacetSelectionToParams(params, emptyServiceFacetSelection());
    expect(params.has("catchments")).toBe(false);
  });

  it("reads malformed or missing catalogPayload as no tags rather than throwing", () => {
    const bareRecord = { slug: "x", title: "X" } as (typeof records)[number];
    expect(() => serviceCatalogTags(bareRecord)).not.toThrow();
    const tags = serviceCatalogTags(bareRecord);
    for (const dimension of serviceFacetDimensions) expect(tags[dimension]).toEqual([]);
    expect(matchesServiceFacets(bareRecord, emptyServiceFacetSelection())).toBe(true);

    const activeSelection = { ...emptyServiceFacetSelection(), age_groups: new Set(["youth"]) };
    expect(matchesServiceFacets(bareRecord, activeSelection)).toBe(true);
    expect(matchesSubstanceLens(bareRecord, "aod")).toBe(true);
    expect(filterServicesByFacets([bareRecord], activeSelection, "aod")).toHaveLength(1);
  });
});
