import { describe, expect, it } from "vitest";
import {
  clinicalVocabularyEntries,
  expandClinicalVocabularyText,
  type ClinicalVocabularyEntry,
} from "../src/lib/clinical-vocabulary";

// Structural invariants for the vocabulary seed. Aliases MAY be shared across
// entries (e.g. "muscle rigidity" belongs to both NMS and serotonin syndrome —
// deliberate symptom overlap), so uniqueness is asserted within an entry and on
// the type:canonical dedup key that clinicalVocabularyMatches uses, not globally.

function normalize(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

describe("clinical vocabulary structural invariants", () => {
  const entries: ClinicalVocabularyEntry[] = clinicalVocabularyEntries();

  it("has a unique type:canonical dedup key per entry", () => {
    const keys = entries.map((entry) => `${entry.type}:${entry.canonical}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps weights inside the established 1.0-1.3 band", () => {
    for (const entry of entries) {
      if (entry.weight === undefined) continue;
      expect(entry.weight, `${entry.canonical} weight out of band`).toBeGreaterThanOrEqual(1.0);
      expect(entry.weight, `${entry.canonical} weight out of band`).toBeLessThanOrEqual(1.3);
    }
  });

  it("has at least one alias or related term per entry and no term that normalizes to nothing", () => {
    for (const entry of entries) {
      const terms = [...entry.aliases, ...(entry.relatedTerms ?? [])];
      expect(terms.length, `${entry.canonical} has no aliases`).toBeGreaterThan(0);
      expect(normalize(entry.canonical), `${entry.canonical} normalizes empty`).not.toBe("");
      for (const alias of terms) {
        expect(normalize(alias), `${entry.canonical} alias "${alias}" normalizes empty`).not.toBe("");
      }
    }
  });

  it("has no duplicate aliases within an entry after normalization", () => {
    for (const entry of entries) {
      const normalized = entry.aliases.map(normalize);
      expect(new Set(normalized).size, `${entry.canonical} has duplicate aliases`).toBe(normalized.length);
    }
  });

  it("expands every retrieval-eligible alias back to its canonical (CI-14 bidirectionality)", () => {
    // Only the first 6 aliases survive expandClinicalVocabularyText's slice, so
    // those are the retrieval-eligible set that must round-trip.
    for (const entry of entries) {
      for (const alias of entry.aliases.slice(0, 6)) {
        const expanded = expandClinicalVocabularyText(alias);
        expect(expanded, `alias "${alias}" does not expand to "${entry.canonical}"`).toContain(entry.canonical);
      }
    }
  });
});

describe("psychiatry vocabulary seed expansions", () => {
  it("bridges screening-instrument abbreviations to full names", () => {
    expect(expandClinicalVocabularyText("PHQ-9 score on admission")).toContain("patient health questionnaire");
    expect(expandClinicalVocabularyText("K10 outcome measure")).toContain("kessler psychological distress scale");
    expect(expandClinicalVocabularyText("document the MSE")).toContain("mental state examination");
  });

  it("bridges AU and US spellings for therapies and sedation", () => {
    expect(expandClinicalVocabularyText("rapid tranquilization protocol")).toContain("rapid tranquillisation");
    expect(expandClinicalVocabularyText("cognitive behavior therapy referral")).toContain(
      "cognitive behavioural therapy",
    );
    expect(expandClinicalVocabularyText("mood stabilizer options")).toContain("mood stabiliser");
  });

  it("bridges legislation and risk shorthand", () => {
    expect(expandClinicalVocabularyText("CTO review due")).toContain("community treatment order");
    expect(expandClinicalVocabularyText("code black response")).toContain("acute behavioural disturbance");
    expect(expandClinicalVocabularyText("DSH presentation")).toContain("deliberate self harm");
  });

  it("bridges medication brands to generics", () => {
    expect(expandClinicalVocabularyText("commence epilim")).toContain("sodium valproate");
    expect(expandClinicalVocabularyText("avanza at night")).toContain("mirtazapine");
  });
});
