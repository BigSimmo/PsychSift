import { describe, expect, it } from "vitest";

import {
  doseWithoutNamedMedicationReason,
  extractiveFallbackRiskReason,
  querySubjectNotInAnswerReason,
} from "@/lib/rag/rag-extractive-risk-gate";

// Synthetic re-creations of the A2R-01 wrong answers from the 26 Oct 2026 answer safety re-audit.
describe("extractiveFallbackRiskReason", () => {
  const base = { routeReason: "strong_routine_retrieval; generation_fallback:generation_quality_failed" };

  it("sends a dose or threshold quote about another medicine for review", () => {
    expect(
      extractiveFallbackRiskReason({
        ...base,
        query: "Is zuranolone approved in Australia for postnatal depression and what is the dose?",
        queryClass: "medication_dose_risk",
        answerText: "Bupropion 150 mg once daily, increasing to 300 mg.",
      }),
    ).toBe("answer_names_unasked_medication");
    expect(
      extractiveFallbackRiskReason({
        ...base,
        query: "How many days of missed clozapine doses means I need to re-titrate?",
        queryClass: "table_threshold",
        answerText: "Lithium levels are taken 12 hours after the last dose.",
      }),
    ).toBe("medication_subject_not_in_answer");
  });

  it("keeps a dose quote about the medicine asked for", () => {
    expect(
      extractiveFallbackRiskReason({
        ...base,
        query: "When should I take a lithium level after the last dose?",
        queryClass: "medication_dose_risk",
        answerText: "Lithium blood samples should be taken 12 hours after the last dose.",
      }),
    ).toBeNull();
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
        "What IM medication doses are recommended for agitation?",
      ),
    ).toBe("dose_without_named_medication");
  });

  it("keeps a dose quote that names the medicine, and non-dose classes", () => {
    expect(
      doseWithoutNamedMedicationReason("Olanzapine 10 mg IM.", "medication_dose_risk", "IM doses for agitation?"),
    ).toBeNull();
    expect(doseWithoutNamedMedicationReason("Give 10 mg IM.", "document_lookup", "IM doses for agitation?")).toBeNull();
  });

  it("keeps a dose quote that repeats an unrecognised medicine named in the question", () => {
    expect(
      doseWithoutNamedMedicationReason(
        "Adults commence zolinapine 25 mg nocte.",
        "medication_dose_risk",
        "What is the recommended starting dose of zolinapine for adults?",
      ),
    ).toBeNull();
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
