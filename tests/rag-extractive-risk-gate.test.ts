import { describe, expect, it } from "vitest";

import {
  doseWithoutNamedMedicationReason,
  extractiveFallbackRiskReason,
  querySubjectNotInAnswerReason,
} from "@/lib/rag/rag-extractive-risk-gate";

// Synthetic re-creations of the A2R-01 wrong answers from the 26 Oct 2026 answer safety re-audit.
describe("extractiveFallbackRiskReason", () => {
  const base = { routeReason: "strong_routine_retrieval; generation_fallback:generation_quality_failed" };

  it("sends dose and threshold quoted fallbacks for review", () => {
    expect(
      extractiveFallbackRiskReason({
        ...base,
        query: "What thiamine dose should be given to prevent Wernicke's encephalopathy?",
        queryClass: "medication_dose_risk",
        answerText: "Thiamine 100 mg orally daily.",
      }),
    ).toBe("high_risk_extractive_after_failed_generation");
    expect(
      extractiveFallbackRiskReason({
        ...base,
        query: "At what CIWA-Ar score should diazepam be given?",
        queryClass: "table_threshold",
        answerText: "Monitor hourly.",
      }),
    ).toBe("high_risk_extractive_after_failed_generation");
  });

  it("sends weak-retrieval quoted fallbacks for review", () => {
    expect(
      extractiveFallbackRiskReason({
        query: "Within how many hours must a community treatment order be confirmed?",
        queryClass: "document_lookup",
        routeReason: "limited_retrieval_strength; generation_fallback:generation_quality_failed",
        answerText: "The order must be confirmed within 2 hours.",
      }),
    ).toBe("weak_retrieval_extractive_after_failed_generation");
  });

  it("sends a quoted answer that never names the query subject for review", () => {
    expect(
      extractiveFallbackRiskReason({
        ...base,
        query: "What anaesthetic agent is preferred for ECT in pregnancy?",
        queryClass: "unsupported_or_general",
        answerText: "The guidance for anaesthetic is that gynae +/- surgical referral.",
      }),
    ).toBe("query_subject_not_in_answer");
  });

  it("keeps an on-subject routine quoted answer", () => {
    expect(
      extractiveFallbackRiskReason({
        ...base,
        query: "How many ECT sessions are usual in a course?",
        queryClass: "unsupported_or_general",
        answerText: "A course of ECT is usually 6 to 12 treatments.",
      }),
    ).toBeNull();
  });
});

describe("doseWithoutNamedMedicationReason", () => {
  it("flags a dose quote that names no medicine", () => {
    expect(
      doseWithoutNamedMedicationReason(
        "For recommended, second Choice Less than 40 kg is 2.5 – 10 mg IM (max dose 10 mg in 24 hours).",
        "medication_dose_risk",
      ),
    ).toBe("dose_without_named_medication");
  });

  it("keeps a dose quote that names the medicine, and non-dose classes", () => {
    expect(doseWithoutNamedMedicationReason("Olanzapine 10 mg IM.", "medication_dose_risk")).toBeNull();
    expect(doseWithoutNamedMedicationReason("Give 10 mg IM.", "document_lookup")).toBeNull();
  });
});

describe("querySubjectNotInAnswerReason", () => {
  it("ignores route and place abbreviations and matches whole words", () => {
    expect(querySubjectNotInAnswerReason("What IM dose is used in WA?", "Give 5 mg.")).toBeNull();
    expect(querySubjectNotInAnswerReason("CIWA-Ar score for diazepam", "Use the CIWA-Ar chart.")).toBeNull();
    expect(querySubjectNotInAnswerReason("When is a CTO confirmed?", "A doctor must review.")).toBe(
      "query_subject_not_in_answer",
    );
  });
});
