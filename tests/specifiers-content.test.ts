import { describe, expect, it } from "vitest";

import {
  curatedEnrichmentFor,
  getSpecifierCatalogItem,
  popularCatalogSlugs,
  specifierCatalogItems,
  specifierSlug,
  specifiersStats,
} from "@/lib/specifiers-content";
import { searchSpecifierCatalog, specifierIndexItems, specifierVerifiedCount } from "@/lib/specifiers-search-index";
import { specifierSiteContentRecords } from "@/lib/site-content/adapters/specifiers";

describe("specifiers content catalog", () => {
  it("flattens to the stats-reported item count", () => {
    // Assert stats↔content consistency plus a sanity floor, rather than a brittle
    // exact count (the dataset can gain/lose rows via governance edits).
    expect(specifierCatalogItems().length).toBe(specifiersStats().specifierItems);
    expect(specifiersStats().specifierItems).toBeGreaterThan(550);
  });

  it("assigns a unique slug to every item", () => {
    const items = specifierCatalogItems();
    const slugs = new Set(items.map((item) => item.slug));
    expect(slugs.size).toBe(items.length);
  });

  it("derives URL-safe slugs from the row key", () => {
    expect(specifierSlug("specifier:ndv:x:severity:mild")).toBe("specifier-ndv-x-severity-mild");
    expect(specifierCatalogItems().every((item) => /^[a-z0-9-]+$/.test(item.slug))).toBe(true);
  });

  it("round-trips getSpecifierCatalogItem by slug", () => {
    const sample = specifierCatalogItems()[0];
    expect(getSpecifierCatalogItem(sample.slug)?.label).toBe(sample.label);
    expect(getSpecifierCatalogItem("does-not-exist")).toBeUndefined();
  });

  it("keeps the compact client index in sync with the full catalog", () => {
    const catalogSlugs = new Set(specifierCatalogItems().map((item) => item.slug));
    expect(specifierIndexItems.length).toBe(catalogSlugs.size);
    expect(specifierIndexItems.every((item) => catalogSlugs.has(item.slug))).toBe(true);
  });

  it("never invents a definition for self-explanatory items", () => {
    for (const item of specifierCatalogItems()) {
      if (item.definitionStatus === "obvious-no-definition") {
        expect(item.definition).toBeNull();
      }
    }
  });

  it("pre-renders a bounded subset (source-verified) rather than all 586", () => {
    const slugs = popularCatalogSlugs();
    expect(slugs.length).toBeGreaterThan(0);
    expect(slugs.length).toBeLessThan(specifierCatalogItems().length);
    expect(slugs.length).toBe(Math.min(96, specifierVerifiedCount));
  });

  it("enriches a catalog item that matches a curated record", () => {
    const anxious = specifierCatalogItems().find((item) => /anxious distress/i.test(item.label));
    expect(anxious).toBeDefined();
    const enrichment = curatedEnrichmentFor(anxious!);
    expect(enrichment?.fit.length).toBeGreaterThan(0);
  });

  it("does not enrich generic labels from unrelated diagnostic categories", () => {
    // An Intellectual Developmental Disorder "Mild" severity row must not pick up
    // the mood "Mild severity" curated guidance.
    const nonMoodMild = specifierCatalogItems().find(
      (item) => item.categoryId === "ndv" && item.label.toLowerCase() === "mild",
    );
    expect(nonMoodMild).toBeDefined();
    expect(curatedEnrichmentFor(nonMoodMild!)).toBeUndefined();
  });

  it("confines enrichment to mood (bipolar/depressive) categories", () => {
    for (const item of specifierCatalogItems()) {
      if (!["bip", "dep"].includes(item.categoryId)) {
        expect(curatedEnrichmentFor(item)).toBeUndefined();
      }
    }
  });

  it("withholds unverified generated definitions behind a verification gate", () => {
    // Unverified auto-generated definitions were systematically mis-templated in the
    // source export, so every non-source-verified defined item must be demoted to
    // needs-manual-or-clinician-verification with a neutral placeholder — never
    // presenting fabricated clinical guidance as fact.
    for (const item of specifierCatalogItems()) {
      if (item.review.sourceVerificationStatus !== "source-verified" && item.definition) {
        expect(item.definitionStatus).toBe("needs-manual-or-clinician-verification");
        expect(item.definition.meaning).toMatch(/pending clinician verification/i);
      }
    }
  });

  it("withholds all generated definition text from the client index", () => {
    // Generated definitions — even on source-verified rows — are withheld pending
    // qualified clinician review (automated review found scattered clinical errors
    // among the "source-verified" subset), so the compact search index carries no
    // meaning text: nothing generated is displayed or ranked on.
    expect(specifierIndexItems.some((item) => item.meaning)).toBe(false);
  });

  it("keeps every specifier manifest record reviewed-ineligible without generated definition prose", () => {
    const records = specifierSiteContentRecords();
    expect(records).toHaveLength(specifierCatalogItems().length);
    expect(records.every((record) => record.validationStatus === "unverified")).toBe(true);
    expect(records.every((record) => record.sourceStatus === "review_due")).toBe(true);
    expect(records.some((record) => /pending clinician verification/i.test(record.body))).toBe(false);
  });

  it("does not mislabel timing/onset specifiers as symptom-count thresholds", () => {
    // PTSD "delayed expression" is a timing threshold and Conduct "adolescent-onset"
    // is an age-of-onset threshold — neither is a symptom-count rule, so the
    // source-verified clinical note must not claim otherwise.
    const rows = specifierCatalogItems().filter(
      (item) =>
        (/post-traumatic stress disorder/i.test(item.disorderName) && /delayed expression/i.test(item.label)) ||
        (/conduct disorder/i.test(item.disorderName) && /adolescent-onset/i.test(item.label)),
    );
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const item of rows) {
      expect(item.definition?.clinicalNote ?? "").not.toMatch(/symptom-count threshold/i);
    }
  });

  it("does not attach compensatory-behaviour notes to non-purging severity rows", () => {
    // Binge-Eating and Hypersomnolence severity is frequency-based; compensatory
    // behaviours belong to Bulimia, so those rows must not cite them.
    const rows = specifierCatalogItems().filter(
      (item) =>
        /(binge-eating disorder|hypersomnolence disorder)/i.test(item.disorderName) &&
        /episodes|days/i.test(item.label),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const item of rows) {
      expect(item.definition?.clinicalNote ?? "").not.toMatch(/compensatory behaviour/i);
    }
  });

  it("frames possession per ICD-11: DID covers both forms; Trance splits into 6B63", () => {
    const items = specifierCatalogItems();
    // DID (ICD-11 6B64) genuinely encompasses both possession and non-possession forms
    // within one diagnosis, so its meaning must acknowledge both states.
    const did = items.find(
      (item) => /dissociative identity/i.test(item.disorderName) && /possession/i.test(item.label),
    );
    expect(did?.definition?.meaning ?? "").toMatch(/with or without|both|may occur/i);
    // Trance Disorder must NOT frame possession as a with/without specifier — ICD-11
    // codes possession trance as the separate diagnosis 6B63.
    const trance = items.filter(
      (item) => /^trance disorder/i.test(item.disorderName) && /possession/i.test(item.label),
    );
    expect(trance.length).toBeGreaterThanOrEqual(1);
    for (const item of trance) {
      expect(item.label).toMatch(/6B63|separate/i);
      expect(item.definition?.meaning ?? "").toMatch(/6B62|6B63|separate diagnosis/i);
    }
  });

  it("labels ARFID drivers per ICD-11 (lack of interest, not limited availability)", () => {
    // ICD-11 6B83 lists three drivers: sensory-based avoidance, fear of aversive
    // consequences, and lack of interest in eating. "Limited availability" is an
    // ICD-11 exclusion, not a driver, so it must not appear as a specifier label.
    const arfid = specifierCatalogItems().filter((item) => /avoidant.restrictive food intake/i.test(item.disorderName));
    const labels = arfid.map((item) => item.label.toLowerCase());
    expect(labels.some((label) => /limited availability/.test(label))).toBe(false);
    expect(labels.some((label) => /lack of interest/.test(label))).toBe(true);
  });

  it("keeps DSM Section III (AMPD) provenance DSM-specific, not ICD-11", () => {
    // The AMPD trait domains are DSM-5-TR Section III; the reference page derives the
    // source badge from sourceFamily, so it must not carry an ICD-11/WHO provenance.
    const ampd = specifierCatalogItems().filter((item) => /alternative model|ampd/i.test(item.disorderName));
    expect(ampd.length).toBeGreaterThan(0);
    for (const item of ampd) {
      expect(item.definition?.sourceFamily ?? "").not.toMatch(/icd-11|who/i);
    }
  });

  it("gives Gaming Disorder online/offline subtypes direction-specific definitions", () => {
    // The generator originally merged both subtypes into one "online or offline"
    // string; each subtype must describe its own direction.
    const gaming = specifierCatalogItems().filter(
      (item) => /gaming disorder/i.test(item.disorderName) && /predominantly (on|off)line/i.test(item.label),
    );
    expect(gaming.length).toBeGreaterThanOrEqual(2);
    for (const item of gaming) {
      const meaning = item.definition?.meaning ?? "";
      expect(meaning).not.toMatch(/online or offline/i);
      expect(meaning).toMatch(/online/i.test(item.label) ? /\bonline\b/i : /\boffline\b/i);
    }
  });
});

describe("searchSpecifierCatalog", () => {
  it("finds a known specifier by label", () => {
    const results = searchSpecifierCatalog("anxious distress");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((result) => /anxious distress/i.test(result.item.label))).toBe(true);
  });

  it("returns the whole filtered category with an empty query", () => {
    const results = searchSpecifierCatalog("", { categoryId: "dep" });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((result) => result.item.categoryId === "dep")).toBe(true);
  });

  it("filters to source-verified items only", () => {
    const results = searchSpecifierCatalog("", { reviewedOnly: true });
    expect(results.length).toBe(specifierVerifiedCount);
    expect(results.every((result) => result.item.src === "source-verified")).toBe(true);
  });

  it("ranks an exact label match above incidental substring matches (case-insensitive)", () => {
    // A lowercase "mild" query must reward an exact "Mild" label (via the exact /
    // prefix / phrase bonuses) over rows that merely contain "mild" inside a
    // parenthetical severity range — which requires normalizing the haystacks.
    const results = searchSpecifierCatalog("mild");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].item.label.toLowerCase()).toBe("mild");
  });
});
