/**
 * Audit RAG-B-07 (limited scope): the source-backed review fallback answer used to be built
 * inline at three sites in the main answer function. They now share one builder. This is a pure
 * refactor, so each test pins the builder's output to a frozen copy of the inline object the
 * site built before, compared byte for byte through JSON.
 *
 * Answer assembly only. Nothing here touches retrieval, ranking or ordering — see
 * docs/rag-behaviour/safeguards.md. All data is synthetic.
 */
import { describe, expect, it } from "vitest";

import { buildSourceBackedReviewFallbackAnswer } from "../src/lib/rag/rag";
import { sourceBackedGenerationTimeoutAnswer } from "../src/lib/rag/rag-answer-quality-gate";
import type { Citation, RagAnswer, SmartRagApiPlan } from "../src/lib/types";

// Frozen copy of `asReviewOnlyCitations` as the three inline sites used it.
const legacyReviewOnly = (citations: readonly Citation[]) =>
  citations.map((citation) => ({ ...citation, provenance: "review_only" as const }));

const citation = (id: string): Citation => ({
  chunk_id: id,
  document_id: "synthetic-doc",
  title: "Synthetic guideline",
  file_name: "synthetic-guideline.pdf",
  page_number: 2,
  chunk_index: 0,
  provenance: "deterministic_support",
});

const plan = { displayMode: "evidence_gap", routeMode: "extractive" } as unknown as SmartRagApiPlan;
const queryAnalysis = { intent: "synthetic" } as unknown as RagAnswer["queryAnalysis"];
const relevance = { directSourceCount: 1, weakSourceCount: 0 } as unknown as RagAnswer["relevance"];
const scoreExplanations = [{ chunkId: "c1" }] as unknown as RagAnswer["scoreExplanations"];

// A realistic base: like the extractive answer and `baseFallbackAnswer`, it already carries
// every field the sites overwrite, so key order is set by the base.
function base(): RagAnswer {
  return {
    answer: "Synthetic rejected candidate text.",
    grounded: true,
    confidence: "medium",
    citations: [citation("c1"), citation("c2")],
    sources: [],
    modelUsed: "synthetic-model",
    routingMode: "fast",
    routingReason: "synthetic_route",
    queryClass: "broad_summary",
    queryAnalysis: { intent: "stale" } as unknown as RagAnswer["queryAnalysis"],
    responseMode: "clinical_pathway",
    answerSections: [{ heading: "Old", body: "Old body", citation_chunk_ids: ["c1"] }],
    relevance: { directSourceCount: 0, weakSourceCount: 3 } as unknown as RagAnswer["relevance"],
    smartApiPlan: { displayMode: "direct" } as unknown as SmartRagApiPlan,
    scoreExplanations: [],
    quoteCards: [],
  };
}

describe("RAG-B-07 shared source-backed review fallback builder", () => {
  it("matches the extractive-route review fallback exactly", () => {
    const answer = base();
    const reviewCitations = answer.citations;
    const reviewRouteReason = "route; source_backed_review_fallback; extractive_quality_gate:x";
    const legacy: RagAnswer = {
      ...answer,
      answer: sourceBackedGenerationTimeoutAnswer(),
      grounded: false,
      confidence: "unsupported",
      citations: legacyReviewOnly(reviewCitations),
      modelUsed: null,
      routingMode: "extractive",
      routingReason: reviewRouteReason,
      responseMode: plan.displayMode,
      smartApiPlan: plan,
      answerSections: [],
      sourceBackedReviewFallback: true,
    };

    const built = buildSourceBackedReviewFallbackAnswer(answer, {
      reviewCitations,
      routingReason: reviewRouteReason,
      plan,
      carried: { modelUsed: null },
    });

    expect(JSON.stringify(built)).toBe(JSON.stringify(legacy));
    expect(built).toStrictEqual(legacy);
  });

  it("matches the generation-fallback review answer exactly", () => {
    const baseFallbackAnswer = base();
    const reviewRouteReason = "route; generation_fallback:x; source_backed_review_fallback; extractive_quality_gate:y";
    const legacy = {
      ...baseFallbackAnswer,
      answer: sourceBackedGenerationTimeoutAnswer(),
      grounded: false,
      confidence: "unsupported",
      citations: legacyReviewOnly(baseFallbackAnswer.citations),
      routingMode: "extractive",
      routingReason: reviewRouteReason,
      queryAnalysis,
      responseMode: plan.displayMode,
      smartApiPlan: plan,
      answerSections: [],
      sourceBackedReviewFallback: true,
      relevance,
      scoreExplanations,
    } satisfies RagAnswer;

    const built = buildSourceBackedReviewFallbackAnswer(baseFallbackAnswer, {
      reviewCitations: baseFallbackAnswer.citations,
      routingReason: reviewRouteReason,
      plan,
      carried: { queryAnalysis, relevance, scoreExplanations },
    });

    expect(JSON.stringify(built)).toBe(JSON.stringify(legacy));
    expect(built).toStrictEqual(legacy);
  });

  it("matches the post-generation claim-gate review answer exactly", () => {
    const baseFallbackAnswer = base();
    const reviewRouteReason =
      "route; generation_fallback:x; source_backed_review_fallback; post_generation_claim_quality_gate";
    const legacy: RagAnswer = {
      ...baseFallbackAnswer,
      answer: sourceBackedGenerationTimeoutAnswer(),
      grounded: false,
      confidence: "unsupported",
      citations: legacyReviewOnly(baseFallbackAnswer.citations),
      modelUsed: null,
      routingMode: "extractive",
      routingReason: reviewRouteReason,
      responseMode: plan.displayMode,
      smartApiPlan: plan,
      answerSections: [],
      sourceBackedReviewFallback: true,
      queryAnalysis,
      relevance,
      scoreExplanations,
    };

    const built = buildSourceBackedReviewFallbackAnswer(baseFallbackAnswer, {
      reviewCitations: baseFallbackAnswer.citations,
      routingReason: reviewRouteReason,
      plan,
      carried: { modelUsed: null, queryAnalysis, relevance, scoreExplanations },
    });

    expect(JSON.stringify(built)).toBe(JSON.stringify(legacy));
    expect(built).toStrictEqual(legacy);
  });

  it("always yields the ungrounded, unsupported, review-only shape and leaves its inputs untouched", () => {
    const answer = base();
    const before = JSON.stringify(answer);

    const built = buildSourceBackedReviewFallbackAnswer(answer, {
      reviewCitations: answer.citations,
      routingReason: "r",
      plan,
    });

    expect(built).toMatchObject({
      grounded: false,
      confidence: "unsupported",
      routingMode: "extractive",
      answerSections: [],
      sourceBackedReviewFallback: true,
      responseMode: "evidence_gap",
    });
    expect(built.citations.every((entry) => entry.provenance === "review_only")).toBe(true);
    expect(built.modelUsed).toBe("synthetic-model");
    expect(JSON.stringify(answer)).toBe(before);
  });
});
