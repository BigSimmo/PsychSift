// Audit 26 Oct 2026, findings #5 and #6: symptom/feature terms expand one way only
// (syndrome -> features), AU spellings are present, and synonym groups match whole terms.

import { describe, expect, it } from "vitest";

import { analyzeClinicalQuery, expandClinicalQuery } from "../src/lib/clinical-search";
import { clinicalVocabularyMatches, expandClinicalVocabularyText } from "../src/lib/clinical-vocabulary";

describe("one-way symptom expansion", () => {
  it("does not expand 'clozapine fever' to serotonin syndrome", () => {
    expect(expandClinicalVocabularyText("clozapine fever")).not.toContain("serotonin syndrome");
    expect(clinicalVocabularyMatches("clozapine fever").map((entry) => entry.canonical)).not.toContain(
      "serotonin syndrome",
    );
    expect(expandClinicalQuery("clozapine fever").toLowerCase()).not.toContain("serotonin syndrome");
  });

  it.each([
    ["muscle rigidity", "neuroleptic malignant syndrome"],
    ["constipation", "anticholinergic side effects"],
    ["weight gain", "metabolic syndrome"],
    ["hypertension", "blood pressure"],
  ])("a feature query (%o) no longer pulls in %o", (query, canonical) => {
    expect(expandClinicalVocabularyText(query)).not.toContain(canonical);
  });

  it("still expands the syndrome to its features", () => {
    const expanded = expandClinicalVocabularyText("serotonin syndrome");
    expect(expanded).toEqual(expect.arrayContaining(["serotonin toxicity", "diarrhoea", "fever"]));
    expect(expandClinicalVocabularyText("nms")).toEqual(
      expect.arrayContaining(["neuroleptic malignant syndrome", "hyperthermia", "muscle rigidity"]),
    );
  });

  it("includes AU spellings", () => {
    expect(expandClinicalVocabularyText("metabolic syndrome")).toEqual(
      expect.arrayContaining(["hyperglycaemia", "dyslipidaemia"]),
    );
    expect(expandClinicalVocabularyText("hyperprolactinaemia")).toContain("prolactin level");
  });
});

describe("whole-term synonym group matching", () => {
  it("does not pull the dose/route group into 'lithium renal impairment'", () => {
    const expanded = analyzeClinicalQuery("lithium renal impairment").expandedTerms.map((term) => term.toLowerCase());
    expect(expanded).not.toContain("intramuscular");
    expect(expanded).not.toContain("prn");
    const query = expandClinicalQuery("lithium renal impairment").toLowerCase();
    expect(query).not.toContain("intramuscular");
    expect(query).not.toContain("maximum dose");
  });

  it.each(["routine bloods", "patient information leaflet", "behavioral activation"])(
    "%o does not trigger the dose/route group by substring",
    (q) => {
      expect(expandClinicalQuery(q).toLowerCase()).not.toContain("intramuscular");
    },
  );

  it("still expands a real dose query", () => {
    expect(expandClinicalQuery("olanzapine im dose").toLowerCase()).toContain("intramuscular");
  });
});
