import { describe, expect, it } from "vitest";

import {
  buildExtractiveAnswer,
  completeExtractiveSentence,
  finalizeRagAnswerQuality,
} from "../src/lib/rag/rag-extractive-answer";
import { factSupportsAnswerIntent } from "../src/lib/rag/rag-extractive-builder";
import { medicationClassInText } from "../src/lib/medication-entities";
import type { SearchResult } from "../src/lib/types";

// Eval Canary 39614340500 (21 Oct 2026). "What metabolic monitoring is required for
// antipsychotics?" led with the metabolic screening policy's governance section, then (after
// prose recovery) with its glossary row, while the schedule sat in a lower-ranked source. The
// lithium level timing case shipped "The guidance for lithium is that therapeutic Drug
// Monitoring. Blood taken…", a section heading laundered by the wrapper. Synthetic text below
// keeps the captured shapes without quoting the sources.
const METABOLIC_QUERY = "What metabolic monitoring is required for antipsychotics?";
const METABOLIC_CLASS = "medication_dose_risk" as const;

function result(id: string, fileName: string, content: string, score: number): SearchResult {
  return {
    id,
    document_id: fileName,
    title: fileName.replace(/\.pdf$/, ""),
    file_name: fileName,
    page_number: 1,
    chunk_index: 0,
    section_heading: null,
    content,
    image_ids: [],
    similarity: score,
    hybrid_score: score,
    text_rank: 0.1,
    source_metadata: {
      source_title: fileName,
      publisher: "Local service",
      jurisdiction: "Australia/WA",
      version: "1",
      publication_date: null,
      review_date: null,
      uploaded_at: null,
      indexed_at: null,
      uploaded_by: null,
      document_status: "current",
      clinical_validation_status: "approved",
      extraction_quality: "good",
    },
    images: [],
  };
}

const POLICY_GOVERNANCE =
  "8. Compliance, monitoring and evaluation Compliance against this policy will be evaluated with audit when a related clinical incident is investigated. 11. Glossary The following definitions are relevant to this policy. Term Definition Metabolic Screen An evidence-based process for services to regularly review physical health status via assessment, monitoring and input.";
const CLINICAL_SCHEDULE =
  "Atypical antipsychotic medications require careful monitoring for metabolic adverse effects. Weight should be monitored at every visit. A baseline fasting glucose should be obtained before treatment starts.";

describe("metabolic monitoring answer (#J8SJQ9)", () => {
  it("recognises a named medicine class", () => {
    expect(medicationClassInText(METABOLIC_QUERY)).toBe("antipsychotics");
    expect(medicationClassInText("Monitoring for mood stabilisers")).toBe("mood stabilisers");
    expect(medicationClassInText("What monitoring is required for clozapine?")).toBeNull();
  });

  it("does not admit a policy's own governance or glossary text as monitoring evidence", () => {
    for (const sentence of [
      "Compliance, monitoring and evaluation Compliance against this policy will be evaluated with audit.",
      "Metabolic Screen An evidence-based process for services to regularly review physical health status via assessment, monitoring and input.",
    ]) {
      expect(factSupportsAnswerIntent("monitoring", sentence, METABOLIC_QUERY, "monitoring_schedule", true)).toBe(
        false,
      );
    }
    expect(
      factSupportsAnswerIntent(
        "monitoring",
        "Weight should be monitored at every visit.",
        METABOLIC_QUERY,
        "monitoring_schedule",
        true,
      ),
    ).toBe(true);
  });

  it("leads with the clinical schedule when the top source is the policy's administration page", () => {
    const answer = finalizeRagAnswerQuality(
      buildExtractiveAnswer({
        query: METABOLIC_QUERY,
        queryClass: METABOLIC_CLASS,
        results: [
          result("policy", "Metabolic Screening (AKG).pdf", POLICY_GOVERNANCE, 0.95),
          result("schedule", "Schizoaffective disorder.pdf", CLINICAL_SCHEDULE, 0.8),
        ],
        quoteCards: [],
        documentBreakdown: [],
        evidenceSummary: undefined,
        sourceCoverage: undefined,
        conflictsOrGaps: [],
        visualEvidence: [],
        bestSource: null,
        smartPanel: undefined,
        relatedDocuments: [],
        routeReason: "high_confidence_extractive_retrieval",
        timings: undefined,
        allowSourceProseRecovery: true,
      }),
      METABOLIC_QUERY,
      METABOLIC_CLASS,
    );

    expect(answer.grounded).toBe(true);
    expect(answer.answer).toMatch(/^For antipsychotics, weight should be monitored at every visit\./);
    expect(answer.answer).not.toMatch(/compliance|glossary|evidence-based process/i);
    expect(answer.citations[0]?.file_name).toBe("Schizoaffective disorder.pdf");
  });
});

describe("a section heading glued to its sentence", () => {
  it("is dropped rather than wrapped", () => {
    expect(
      completeExtractiveSentence(
        "Therapeutic Drug Monitoring. Blood for serum lithium levels should be taken 12 hours after the last dose",
        "When should lithium levels be taken?",
      ),
    ).toBe("Blood for serum lithium levels should be taken 12 hours after the last dose.");
  });

  it("still wraps a fragment that has no sentence after it", () => {
    expect(completeExtractiveSentence("compliance, monitoring and evaluation", METABOLIC_QUERY)).toBe(
      "The guidance is that compliance, monitoring and evaluation.",
    );
  });
});
