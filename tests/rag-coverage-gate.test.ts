import { describe, expect, it } from "vitest";

import { buildClinicalTextSearchQuery } from "@/lib/clinical-search";
import { evaluateEvidenceCoverageGate } from "@/lib/rag/rag-coverage-gate";
import type { SearchResult } from "@/lib/types";

function makeSource(id: string, content: string): SearchResult {
  return {
    id,
    document_id: `doc-${id}`,
    title: "Clozapine Monitoring Guideline",
    file_name: "clozapine-guideline.pdf",
    page_number: 1,
    chunk_index: 0,
    section_heading: "Haematological monitoring",
    content,
    image_ids: [],
    images: [],
    similarity: 0.88,
  };
}

describe("Clozapine blood-action threshold coverage gate (#ES3KTG)", () => {
  it.each([
    "When should clozapine be ceased based on ANC?",
    "clozapine discontinuing threshold for neutrophils",
    "clozapin stop threshold wbc",
  ])("rejects evidence lacking structured blood-action thresholds for %s", (query) => {
    const nonThresholdSource = makeSource(
      "general-cloz",
      "Clozapine requires registration with a monitoring service before dispensing.",
    );

    const gate = evaluateEvidenceCoverageGate(query, [nonThresholdSource], "table_threshold");
    expect(gate.accepted).toBe(false);
    expect(gate.reason).toBe("missing_clozapine_blood_action_structured_threshold");
  });

  it.each([
    [
      "When should clozapine be ceased based on ANC?",
      "In the red range (ANC < 1.0 x 10^9/L or WBC < 2.0 x 10^9/L), immediately cease clozapine.",
    ],
    [
      "clozapine discontinuing threshold for neutrophils",
      "Discontinuation of clozapine is mandatory when neutrophil count falls below 1.0 x 10^9/L.",
    ],
    ["clozapin stop threshold wbc", "Stopping clozapine is required for red-range results with ANC < 1.0 x 10^9/L."],
  ])("accepts evidence when threshold and action inflections are present for %s", (query, evidenceText) => {
    const thresholdSource = makeSource("threshold-cloz", evidenceText);

    const gate = evaluateEvidenceCoverageGate(query, [thresholdSource], "table_threshold");
    expect(gate.accepted).toBe(true);
    expect(gate.reason).toBe("clozapine_blood_action_structured_threshold");
  });

  it("expands 'When should clozapine be ceased based on ANC?' into the clozapine blood-action threshold query", () => {
    const searchQuery = buildClinicalTextSearchQuery("When should clozapine be ceased based on ANC?");
    expect(searchQuery).toBe("clozapine wbc neutrophils red range stop");
  });
});
