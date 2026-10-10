import { describe, expect, it } from "vitest";

import { analyzeClinicalQuery } from "@/lib/clinical-search";
import {
  isNonClinicalConsumerText,
  isUnsupportedSoftTailAnalysis,
  shouldShortCircuitUnsupportedSearch,
} from "@/lib/query-classification";

describe("query-classification - bare and qualified psychiatric terms (#3944SV)", () => {
  it.each([
    "bipolar",
    "schizoaffective",
    "schizoaffective disorder",
    "schizophrenia",
    "depression",
    "catatonia",
    "mania",
  ])("does not reject bare psychiatric condition %j as non-clinical", (term) => {
    expect(isNonClinicalConsumerText(term)).toBe(false);
  });

  it.each([
    "schizoaffective phone contact",
    "bipolar holiday leave",
    "schizoaffective car accident trauma",
    "bipolar and laptop use in insomnia",
  ])("protects psychiatric terms even when co-occurring with consumer words: %j", (query) => {
    expect(isNonClinicalConsumerText(query)).toBe(false);
    const analysis = analyzeClinicalQuery(query);
    const refusedByConsumerWord =
      shouldShortCircuitUnsupportedSearch(query, analysis) && !isUnsupportedSoftTailAnalysis(query, analysis);
    expect(refusedByConsumerWord).toBe(false);
  });

  it.each(["best espresso coffee machine", "cheap hotel holiday booking", "mortgage insurance calculator"])(
    "still identifies clearly non-clinical consumer queries: %j",
    (query) => {
      expect(isNonClinicalConsumerText(query)).toBe(true);
    },
  );
});
