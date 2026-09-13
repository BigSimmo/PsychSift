import { describe, expect, it } from "vitest";
import { applySecondStageRerankIfNeeded, stabilizeReleasedSearchOrder } from "../src/lib/rag/rag";
import type { SearchTelemetry } from "../src/lib/rag/rag-contracts";
import { rankingConfig } from "../src/lib/ranking-config";
import type { SearchResult, SearchScoreExplanation } from "../src/lib/types";

function explanation(rankScore: number): SearchScoreExplanation {
  return {
    vectorScore: 0.8,
    textRank: 0.4,
    lexicalCoverageScore: 0.5,
    metadataMatchScore: 0,
    sectionTitleMatchBoost: 0,
    freshnessRecencyBoost: 0,
    weightedHybridScore: 0.8,
    rrfScore: null,
    rrfBoost: 0,
    memoryBoost: 0,
    titleBoost: 0,
    metadataBoost: 0,
    clinicalSignalBoost: 0,
    penalty: 0,
    rankScore,
    finalScore: Math.min(1, Math.max(0, rankScore)),
    preClampFinalScore: rankScore,
    strategy: "weighted_hybrid",
  };
}

function result(overrides: Partial<SearchResult>): SearchResult {
  return {
    id: overrides.id ?? "chunk-1",
    document_id: overrides.document_id ?? "doc-1",
    title: overrides.title ?? "Guideline",
    file_name: overrides.file_name ?? "guideline.pdf",
    page_number: 1,
    chunk_index: 0,
    section_heading: null,
    content: "Clinical evidence",
    image_ids: [],
    images: [],
    similarity: overrides.similarity ?? 0.8,
    hybrid_score: overrides.hybrid_score ?? 0.8,
    score_explanation: overrides.score_explanation ?? explanation(0.8),
    ...overrides,
  };
}

describe("U04 captured ranking configuration", () => {
  it("uses the supplied second-stage weights without mutating the ordinary singleton", () => {
    const captured = {
      ...rankingConfig,
      secondStage: {
        ...rankingConfig.secondStage,
        positionBase: 0.5,
        positionStep: 0.5,
      },
    };
    const ranked = applySecondStageRerankIfNeeded({
      queryClass: "comparison",
      results: [
        result({ id: "first", score_explanation: explanation(0.8) }),
        result({ id: "second", score_explanation: explanation(0.79) }),
      ],
      telemetry: {} as SearchTelemetry,
      topK: 1,
      ranking: captured,
    });

    expect(ranked.find((item) => item.id === "first")?.score_explanation?.rankScore).toBe(1.3);
    expect(rankingConfig.secondStage.positionBase).toBe(0.09);
  });
});

describe("second-stage rank score", () => {
  it("applies signed demotions to rankScore while preserving hybrid coverage scores", () => {
    const telemetry = {} as SearchTelemetry;
    const demoted = result({
      id: "demoted",
      document_id: "old-doc",
      hybrid_score: 0.8,
      score_explanation: explanation(0.4),
      source_metadata: {
        source_title: "Older guideline",
        publisher: "Test publisher",
        jurisdiction: "Australia/WA",
        version: "1",
        publication_date: null,
        review_date: null,
        uploaded_at: null,
        indexed_at: null,
        uploaded_by: null,
        document_status: "outdated",
        clinical_validation_status: "locally_reviewed",
        extraction_quality: "good",
      },
    });
    const relevant = result({
      id: "relevant",
      document_id: "current-doc",
      hybrid_score: 0.79,
      score_explanation: explanation(0.5),
    });

    const ranked = applySecondStageRerankIfNeeded({
      queryClass: "medication_dose_risk",
      results: [demoted, relevant],
      telemetry,
      topK: 2,
    });

    expect(ranked.map((item) => item.id)).toEqual(["relevant", "demoted"]);
    expect(ranked.map((item) => item.score_explanation?.finalRank)).toEqual([1, 2]);
    expect(ranked.find((item) => item.id === "demoted")?.hybrid_score).toBe(0.8);
    expect(ranked.find((item) => item.id === "relevant")?.hybrid_score).toBe(0.79);
    expect(ranked[0].score_explanation?.finalScore).toBeGreaterThanOrEqual(0);
    expect(ranked[0].score_explanation?.finalScore).toBeLessThanOrEqual(1);
    expect(telemetry.second_stage_rerank_used).toBe(true);
  });

  it("does not leak ranking-only magnitude into the clamped confidence signal", () => {
    const highRank = explanation(1.4);
    highRank.finalScore = 0.6;
    const ranked = applySecondStageRerankIfNeeded({
      queryClass: "medication_dose_risk",
      results: [
        result({ id: "high-rank", score_explanation: highRank }),
        result({ id: "runner-up", hybrid_score: 0.79, score_explanation: explanation(0.79) }),
      ],
      telemetry: {} as SearchTelemetry,
      topK: 2,
    });

    expect(ranked[0].id).toBe("high-rank");
    expect(ranked[0].score_explanation?.rankScore).toBe(1.49);
    expect(ranked[0].score_explanation?.releaseRankScore).toBe(0.8);
    expect(ranked[1].score_explanation?.releaseRankScore).toBeGreaterThan(0.8);
    expect(ranked[0].score_explanation?.preClampFinalScore).toBe(1.49);
    expect(ranked[0].score_explanation?.finalScore).toBe(0.69);
    expect(ranked.map((item) => item.score_explanation?.finalRank)).toEqual([1, 2]);
    expect(stabilizeReleasedSearchOrder(ranked, true).map((item) => item.id)).toEqual(["runner-up", "high-rank"]);
  });

  it("caps wrong-subject monitoring evidence at its released hybrid score", () => {
    const wrongSubject = explanation(1.4);
    wrongSubject.finalScore = 1;
    const rightSubject = explanation(0.79);
    const ranked = applySecondStageRerankIfNeeded({
      queryClass: "medication_dose_risk",
      results: [
        result({
          id: "cardiac-dose",
          document_id: "cardiac-doc",
          content: "Cardiac monitoring includes a 5 mg treatment note.",
          hybrid_score: 0.8,
          score_explanation: wrongSubject,
          match_explanation: { reasons: ["retrieval_required_signal:clinical_subject"] },
        }),
        result({
          id: "lithium-monitoring",
          document_id: "lithium-doc",
          content: "Lithium monitoring requires serum levels.",
          hybrid_score: 0.79,
          score_explanation: rightSubject,
          match_explanation: {
            reasons: ["retrieval_required_signal:clinical_subject", "retrieval_signal:clinical_subject"],
          },
        }),
      ],
      telemetry: {} as SearchTelemetry,
      topK: 2,
    });

    const stabilized = stabilizeReleasedSearchOrder(ranked, true);
    expect(stabilized.map((item) => item.id)).toEqual(["lithium-monitoring", "cardiac-dose"]);
    expect(stabilized[1].score_explanation?.releaseRankScore).toBe(0.8);
  });

  it("sorts by the computed second-stage score even when score explanations are absent", () => {
    const doseEvidenceWithoutExplanation = result({
      id: "dose-evidence-without-explanation",
      document_id: "dose-doc",
      hybrid_score: 0.82,
      content: "Give 5 mg orally when clinically indicated.",
    });
    delete doseEvidenceWithoutExplanation.score_explanation;
    const supported = result({
      id: "supported",
      document_id: "current-doc",
      hybrid_score: 0.84,
      score_explanation: explanation(0.84),
    });

    const ranked = applySecondStageRerankIfNeeded({
      queryClass: "medication_dose_risk",
      results: [doseEvidenceWithoutExplanation, supported],
      telemetry: {} as SearchTelemetry,
      topK: 2,
    });

    expect(ranked.map((item) => item.id)).toEqual(["dose-evidence-without-explanation", "supported"]);
    expect(ranked[1].score_explanation?.finalRank).toBe(2);
  });

  it("sorts distinct chunks by the bounded release score and keeps the strongest duplicate copy", () => {
    const telemetry = {} as SearchTelemetry;
    const strongerHybridDuplicate = result({
      id: "stronger-hybrid",
      document_id: "older-doc",
      hybrid_score: 0.8,
      score_explanation: explanation(0.4),
      source_metadata: {
        source_title: "Older guideline",
        publisher: "Test publisher",
        jurisdiction: "Australia/WA",
        version: "1",
        publication_date: null,
        review_date: null,
        uploaded_at: null,
        indexed_at: null,
        uploaded_by: null,
        document_status: "outdated",
        clinical_validation_status: "locally_reviewed",
        extraction_quality: "good",
      },
    });
    const higherRankScore = result({
      id: "higher-rank-score",
      document_id: "current-doc",
      hybrid_score: 0.79,
      score_explanation: explanation(0.5),
    });
    const weakerDuplicate = {
      ...strongerHybridDuplicate,
      hybrid_score: 0.78,
      score_explanation: explanation(0.41),
      content: "Weaker duplicate",
    };

    const secondStage = applySecondStageRerankIfNeeded({
      queryClass: "medication_dose_risk",
      results: [higherRankScore, weakerDuplicate, strongerHybridDuplicate],
      telemetry,
      topK: 3,
    });
    expect(secondStage.map((item) => item.id)).toEqual(["higher-rank-score", "stronger-hybrid", "stronger-hybrid"]);

    const stabilized = stabilizeReleasedSearchOrder(secondStage, true);

    expect(stabilized.map((item) => item.id)).toEqual(["higher-rank-score", "stronger-hybrid"]);
    expect(stabilized[1].hybrid_score).toBe(0.8);
    expect(stabilized[1].content).toBe(strongerHybridDuplicate.content);
    expect(stabilized[0].score_explanation?.releaseRankScore).toBeGreaterThan(
      stabilized[1].score_explanation?.releaseRankScore ?? 0,
    );
    expect(stabilized.map((item) => item.score_explanation?.finalRank)).toEqual([1, 2]);
  });

  it("preserves sticky second-stage order while retaining raw-hybrid fallback when release scores are absent", () => {
    const clinicallyOrdered = [
      result({
        id: "lithium-monitoring",
        hybrid_score: 0.79,
        content: "Lithium monitoring evidence selected first by the clinical layer.",
        score_explanation: explanation(0.9),
      }),
      result({
        id: "cardiac-dose",
        hybrid_score: 0.95,
        score_explanation: explanation(0.5),
      }),
      result({
        id: "lithium-monitoring",
        hybrid_score: 0.85,
        content: "Stronger released-hybrid copy of the lithium evidence.",
        score_explanation: explanation(0.85),
      }),
    ];

    const stabilized = stabilizeReleasedSearchOrder([...clinicallyOrdered], true);

    expect(stabilized.map((item) => item.id)).toEqual(["lithium-monitoring", "cardiac-dose"]);
    expect(stabilized[0].content).toBe("Stronger released-hybrid copy of the lithium evidence.");
    expect(stabilized.map((item) => item.score_explanation?.finalRank)).toEqual([1, 2]);

    const hybridFallback = stabilizeReleasedSearchOrder([...clinicallyOrdered], false);
    expect(hybridFallback.map((item) => item.id)).toEqual(["cardiac-dose", "lithium-monitoring"]);
    expect(hybridFallback[1].content).toBe("Stronger released-hybrid copy of the lithium evidence.");
  });

  it("only applies bounded release ordering when the current result set carries releaseRankScore", () => {
    const withReleaseScore = result({
      id: "release-ranked",
      hybrid_score: 0.79,
      score_explanation: { ...explanation(0.79), releaseRankScore: 0.95 },
    });
    const withoutReleaseScore = result({
      id: "hybrid-leading",
      hybrid_score: 0.84,
      score_explanation: explanation(0.84),
    });

    expect(stabilizeReleasedSearchOrder([withoutReleaseScore, withReleaseScore], true).map((item) => item.id)).toEqual([
      "release-ranked",
      "hybrid-leading",
    ]);
    expect(stabilizeReleasedSearchOrder([withReleaseScore, withoutReleaseScore], false).map((item) => item.id)).toEqual(
      ["hybrid-leading", "release-ranked"],
    );
  });

  it("preserves semantic rerank order when release scores are absent", () => {
    const semanticallyOrdered = [
      result({
        id: "semantic-first",
        hybrid_score: 0.7,
        score_explanation: explanation(0.7),
      }),
      result({
        id: "semantic-second",
        hybrid_score: 0.9,
        score_explanation: explanation(0.9),
      }),
    ];

    expect(stabilizeReleasedSearchOrder([...semanticallyOrdered], false, true).map((item) => item.id)).toEqual([
      "semantic-first",
      "semantic-second",
    ]);
  });

  it("preserves clinical order when releaseRankScore values are not finite", () => {
    const clinicallyOrdered = [
      result({
        id: "first",
        hybrid_score: 0.7,
        score_explanation: { ...explanation(0.7), releaseRankScore: Number.NaN },
      }),
      result({
        id: "second",
        hybrid_score: 0.9,
        score_explanation: { ...explanation(0.9), releaseRankScore: Number.POSITIVE_INFINITY },
      }),
    ];

    expect(stabilizeReleasedSearchOrder([...clinicallyOrdered], true).map((item) => item.id)).toEqual([
      "first",
      "second",
    ]);
  });
});
