import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { allCalculatorFixtures, calculators, calculatorEvidence } from "@/lib/calculators/calculator-fixtures";
import { actionsForBand } from "@/components/calculators/calculator-pathways";
import { deriveCalculator } from "@/components/calculators/calculator-ui";

const ROOT = process.cwd();

const fixture = (id: string) => allCalculatorFixtures.find((calc) => calc.id === id);
const source = (id: string) => calculatorEvidence.sources.find((entry) => entry.id === id);
const claim = (id: string) => calculatorEvidence.claims.find((entry) => entry.id === id);

describe("K10 is described as one accepted measure, not the standard", () => {
  it("does not claim K10 is the standard for Australian mental-health care plans", () => {
    const k10 = fixture("k10");
    expect(k10).toBeDefined();
    expect(k10?.indication).not.toMatch(/standard for Australian mental-health care plans/i);
    // The replacement must not assert program policy either: source:k10 is a 2003 ABS
    // information paper covering scoring and population bands, not Better Access eligibility.
    expect(k10?.indication).not.toMatch(/better access/i);
    expect(k10?.indication).toMatch(/not a diagnostic instrument/i);
  });

  it("keeps the same wording out of the mockup fixture set", () => {
    for (const path of [
      "src/lib/calculators/calculator-fixtures.ts",
      "src/components/calculator-mockups/calculator-fixtures.ts",
    ]) {
      expect(readFileSync(resolve(ROOT, path), "utf8"), path).not.toContain(
        "standard for Australian mental-health care plans",
      );
    }
  });

  it("keeps distress bands out of diagnostic language", () => {
    for (const band of fixture("k10")?.bands ?? []) {
      expect(band.interpretation).toMatch(/not a diagnostic category/i);
    }
  });

  it("names the cut-off convention its bands follow", () => {
    // ABS 4817.0.55.001: there is no agreed standard for K10 cut-offs, so the result says which
    // convention (the 2001 National Health Survey bands) it uses.
    for (const band of fixture("k10")?.bands ?? []) {
      expect(band.interpretation).toContain("ABS 2001 National Health Survey convention");
      expect(band.interpretation).toMatch(/other Australian conventions exist/i);
    }
  });
});

describe("AUDIT-C states a named threshold convention rather than a universal cut-point", () => {
  const auditc = fixture("auditc");

  it("no longer labels a single score as 'at threshold' without qualification", () => {
    expect(auditc?.bands.map((band) => band.label)).toEqual([
      "Below both thresholds",
      "At the threshold for women",
      "At or above both thresholds",
    ]);
  });

  it("separates the score that is positive for women only from the score positive for both", () => {
    // Bradley et al. 2007: 4 or more for men, 3 or more for women. A total of 3 is therefore
    // positive for women and negative for men, which a single band boundary cannot express.
    const bandFor = (score: number) => auditc?.bands.find((band) => score >= band.min && score <= band.max);
    expect(bandFor(2)?.label).toBe("Below both thresholds");
    expect(bandFor(3)?.label).toBe("At the threshold for women");
    expect(bandFor(4)?.label).toBe("At or above both thresholds");
    expect(bandFor(12)?.label).toBe("At or above both thresholds");
  });

  it("names the convention and its sex-specific values in every band interpretation", () => {
    for (const band of auditc?.bands ?? []) {
      expect(band.interpretation).toMatch(/4 or more for men, 3 or more for women/);
      expect(band.interpretation).toMatch(/does not establish a diagnosis/i);
    }
  });
});

describe("the Australian standard-drinks guide is not AUDIT-C validation evidence", () => {
  it("attaches the standard-drinks guide only to the unit-context claim", () => {
    const drinksGuide = source("source:auditc");
    expect(drinksGuide?.title).toMatch(/standard drinks guide/i);
    expect(drinksGuide?.claimsSupported).toEqual(["claim:auditc:units"]);
    expect(drinksGuide?.limitations.join(" ")).toMatch(/does not validate AUDIT-C/i);
  });

  it("supports the all-adults interpretation with a women-inclusive validation source", () => {
    // Bush et al. 1998 excluded women, so it cannot alone carry a claim stated for adult men and
    // women. Bradley et al. 2007 reports AUROCs in both sexes and is what extends it.
    const interpretation = claim("claim:auditc:interpretation");
    expect(interpretation?.population).toMatch(/men and women/i);
    expect(interpretation?.sourceIds).toContain("source:auditc:thresholds");
    expect(source("source:auditc:thresholds")?.claimsSupported).toContain("claim:auditc:interpretation");
  });

  it("registers the screening-performance and threshold studies under their own source ids", () => {
    expect(source("source:auditc:validation")?.claimsSupported).toContain("claim:auditc:interpretation");
    expect(source("source:auditc:thresholds")?.claimsSupported).toContain("claim:auditc:thresholds");
    // The derivation study excluded women, so it cannot be the support for a women's threshold.
    expect(source("source:auditc:validation")?.limitations.join(" ")).toMatch(/women were excluded/i);
  });

  it("does not repurpose source:auditc for the interpretation claim", () => {
    expect(claim("claim:auditc:interpretation")?.sourceIds).not.toContain("source:auditc");
    expect(claim("claim:auditc:units")?.sourceIds).toContain("source:auditc");
  });

  it("cites the matching source on each AUDIT-C clinical consideration", () => {
    const auditcFixture = fixture("auditc");
    expect(auditcFixture).toBeDefined();
    if (!auditcFixture) return;
    const derived = deriveCalculator(auditcFixture, { a1: 1, a2: 1, a3: 1 });
    const pairs = actionsForBand(auditcFixture, derived).map((entry) => [entry.sourceIds, entry.claimIds]);
    expect(pairs).toContainEqual([
      ["source:auditc:validation", "source:auditc:thresholds"],
      ["claim:auditc:interpretation"],
    ]);
    expect(pairs).toContainEqual([["source:auditc:thresholds"], ["claim:auditc:thresholds"]]);
    expect(pairs).toContainEqual([["source:auditc"], ["claim:auditc:units"]]);
  });

  it("surfaces all three AUDIT-C sources and claims on the fixture", () => {
    expect(fixture("auditc")?.sourceIds).toEqual([
      "source:auditc:validation",
      "source:auditc:thresholds",
      "source:auditc",
      "source:governance",
    ]);
    expect(fixture("auditc")?.claimIds).toEqual([
      "claim:auditc:interpretation",
      "claim:auditc:thresholds",
      "claim:auditc:units",
    ]);
  });
});

describe("every claim records what it asserts, for whom, and where it is supported", () => {
  it.each(calculatorEvidence.claims.map((entry) => entry.id))("%s carries its own text", (id) => {
    const entry = claim(id);
    expect(entry?.text?.trim()).toBeTruthy();
    expect(entry?.population?.trim()).toBeTruthy();
    expect(entry?.supportLocator?.trim()).toBeTruthy();
  });

  it("never leaves the internal governance record as a claim's only support", () => {
    for (const entry of calculatorEvidence.claims) {
      const clinical = entry.sourceIds.filter((id) => source(id)?.type !== "internal_governance_record");
      expect(clinical.length, `${entry.id} has only governance support`).toBeGreaterThan(0);
    }
  });

  it("agrees in both directions between claim and source", () => {
    for (const entry of calculatorEvidence.claims) {
      for (const sourceId of entry.sourceIds) {
        expect(source(sourceId)?.claimsSupported, `${entry.id} -> ${sourceId}`).toContain(entry.id);
      }
    }
    const claimIds = new Set(calculatorEvidence.claims.map((entry) => entry.id));
    for (const entry of calculatorEvidence.sources) {
      for (const claimId of entry.claimsSupported) {
        expect(claimIds.has(claimId), `${entry.id} -> ${claimId}`).toBe(true);
      }
    }
  });

  it("resolves every source and claim referenced by an active calculator", () => {
    const sourceIds = new Set(calculatorEvidence.sources.map((entry) => entry.id));
    const claimIds = new Set(calculatorEvidence.claims.map((entry) => entry.id));
    for (const calc of calculators) {
      for (const id of calc.sourceIds) expect(sourceIds.has(id), `${calc.id} -> ${id}`).toBe(true);
      for (const id of calc.claimIds) expect(claimIds.has(id), `${calc.id} -> ${id}`).toBe(true);
    }
  });
});

describe("the content gate rejects impossible review dates", () => {
  // The checker runs against an isolated copy of the content it validates. Mutating the real
  // data/calculators/evidence.json in place would corrupt it for any other suite running
  // concurrently, including the governance test that snapshots the same files.
  const COPIED = [
    "scripts/check-calculator-content.mjs",
    "data/calculators/evidence.json",
    "data/calculators/golden-vectors.json",
    "src/lib/calculators/calculator-fixtures.ts",
  ];

  function runCheckerWith(mutate: (registry: { sources: Record<string, unknown>[] }) => void): string {
    const tempRoot = mkdtempSync(join(tmpdir(), "calculator-clinical-content-"));
    try {
      for (const relPath of COPIED) {
        const dest = join(tempRoot, relPath);
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(resolve(ROOT, relPath), dest);
      }
      const evidencePath = join(tempRoot, "data/calculators/evidence.json");
      const registry = JSON.parse(readFileSync(evidencePath, "utf8"));
      mutate(registry);
      writeFileSync(evidencePath, `${JSON.stringify(registry, null, 2)}\n`);
      try {
        execFileSync(process.execPath, [join(tempRoot, "scripts/check-calculator-content.mjs")], {
          encoding: "utf8",
          stdio: "pipe",
        });
        return "";
      } catch (error) {
        const failure = error as { stderr?: string };
        return failure.stderr ?? "";
      }
    } finally {
      rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }

  it("passes on an unmutated copy, so a failure below comes from the mutation", () => {
    expect(runCheckerWith(() => {})).toBe("");
  });

  // Date.parse accepts these and silently rolls them into the following month, which would move
  // a source's next review forward without anyone editing it.
  it.each(["2027-02-30", "2027-04-31", "2027-06-31"])("fails on the non-existent date %s", (date) => {
    const stderr = runCheckerWith((registry) => {
      registry.sources[1].nextReview = date;
    });
    expect(stderr).toContain("CALCULATOR_CONTENT_FAIL");
    expect(stderr).toContain("nextReview must be an ISO date");
  });

  it("still accepts a real leap day", () => {
    const stderr = runCheckerWith((registry) => {
      registry.sources[1].lastReviewed = "2028-02-28";
      registry.sources[1].nextReview = "2028-02-29";
    });
    expect(stderr).toBe("");
  });

  it("fails when a claim loses its text", () => {
    const stderr = runCheckerWith((registry) => {
      (registry as unknown as { claims: Record<string, unknown>[] }).claims[0].text = "";
    });
    expect(stderr).toContain("text must be a non-empty string");
  });
});
