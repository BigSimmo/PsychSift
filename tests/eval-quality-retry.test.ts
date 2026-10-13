import { describe, expect, it } from "vitest";

import {
  buildEvalQualityReport,
  qualityFailureCategory,
  qualityThresholds,
  renderEvalQualityMarkdown,
  type RagQualityResult,
} from "../scripts/eval-quality";
import {
  blockingGateRetryCaseIds,
  mergeRetriedRagResults,
  summarizeGateRetry,
} from "../scripts/lib/eval-quality-retry";

function ragResult(overrides: Partial<RagQualityResult> = {}): RagQualityResult {
  return {
    id: "rag-1",
    question: "What safety monitoring is required for clozapine?",
    category: "routine",
    supported: true,
    expectedFiles: ["clozapine.pdf"],
    matchedFiles: ["clozapine.pdf"],
    missingFiles: [],
    topFiles: ["clozapine.pdf"],
    expectedHit: true,
    grounded: true,
    latencyMs: 900,
    searchLatencyMs: 200,
    generationLatencyMs: 650,
    rpcLatencyMs: 150,
    embeddingLatencyMs: 25,
    route: "fast",
    executionType: "api",
    latencyRoute: "generation",
    model: "test-model",
    citations: 2,
    visualEvidence: 0,
    failures: [],
    sourceWarningCount: 0,
    sourceDangerWarningCount: 0,
    unverifiedNumericTokenCount: 0,
    hasFaithfulnessWarning: false,
    routingReason: "test_route",
    timings: {
      retrievalMs: 500,
      routingMs: 10,
      generationMs: 350,
      verificationMs: 40,
      totalMs: 900,
      routeBudgetMs: 25_000,
      routeDeadlineExceeded: false,
    },
    routeCeilingExceeded: false,
    estimatedCostUsd: 0.001,
    ...overrides,
  };
}

const unsupportedLimit = qualityThresholds.ragRouteP95LatencyMs.unsupported;

function report(results: RagQualityResult[]) {
  return buildEvalQualityReport({ retrievalResults: [], ragResults: results, skippedComponents: ["retrieval"] });
}

// Shapes of the three reds before this change: 38363682098 (one citation failure in 44),
// 38383361787 (one unaccounted review fallback), 38419027058 (one slow refusal, route p95 6360 > 4000).
const healthy = Array.from({ length: 10 }, (_, index) => ragResult({ id: `ok-${index}` }));
const refusals = Array.from({ length: 4 }, (_, index) =>
  ragResult({
    id: `refusal-${index}`,
    supported: false,
    grounded: false,
    route: "unsupported",
    latencyRoute: "unsupported",
    latencyMs: 300,
    model: null,
  }),
);
const slowRefusal = ragResult({
  id: "unsupported-coffee-machine",
  supported: false,
  grounded: false,
  route: "unsupported",
  latencyRoute: "unsupported",
  latencyMs: 6360,
  model: null,
});
const citationMiss = ragResult({ id: "citation-miss", failures: ["citation chunk ids missing from sources"] });
const reviewFallback = ragResult({
  id: "discharge-documentation",
  routingReason:
    "strong_routine_retrieval; generation_fallback:x; source_backed_review_fallback; extractive_quality_gate:guidance_wrapper_fragment",
});

describe("blocking-gate retry", () => {
  it("keeps every threshold value untouched", () => {
    expect(qualityThresholds.ragCitationFailureRate).toBe(0);
    expect(unsupportedLimit).toBe(4_000);
  });

  it("names only the cases behind each blocking RAG failure", () => {
    const initial = report([...healthy, ...refusals, slowRefusal, citationMiss, reviewFallback]);
    expect(initial.blocking_threshold_failures).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^RAG citation_failure_rate/),
        expect.stringMatching(/^RAG source_backed_review_fallback unaccounted/),
        expect.stringMatching(/^RAG route unsupported p95_latency_ms 6360 above 4000$/),
      ]),
    );
    expect(blockingGateRetryCaseIds(initial, qualityFailureCategory)).toEqual({
      caseIds: ["citation-miss", "discharge-documentation", "unsupported-coffee-machine"],
      nonRetryable: [],
    });
  });

  it("clears a gate when the retried case passes, using p95 over the retry samples", () => {
    const first = [...healthy, ...refusals, slowRefusal];
    const initial = report(first);
    const retried = [{ ...slowRefusal, latencyMs: 280 }];
    const merged = mergeRetriedRagResults(first, retried);
    const final = report(merged);
    expect(final.blocking_threshold_failures).toEqual([]);
    expect(merged.map((result) => result.id)).toEqual(first.map((result) => result.id));

    const withRetry = buildEvalQualityReport({
      retrievalResults: [],
      ragResults: merged,
      skippedComponents: ["retrieval"],
      gateRetry: summarizeGateRetry({ initial, final, retried, nonRetryable: [] }),
    });
    const markdown = renderEvalQualityMarkdown(withRetry);
    expect(markdown).toContain("## Blocking-Gate Retry");
    expect(markdown).toContain("RAG route unsupported p95_latency_ms 6360 above 4000");
    expect(markdown).toMatch(/\| unsupported-coffee-machine \| none \| none \| 6360 \| 280 \|/);
    expect(withRetry.gate_retry?.final_blocking_threshold_failures).toEqual([]);
  });

  it("still blocks when the same case fails again", () => {
    const first = [...healthy, citationMiss];
    const final = report(mergeRetriedRagResults(first, [{ ...citationMiss, latencyMs: 950 }]));
    expect(final.blocking_threshold_failures).toEqual([expect.stringMatching(/^RAG citation_failure_rate/)]);
  });

  it("treats failures without a case owner as non-retryable", () => {
    const initial = report(healthy);
    const forged = { ...initial, blocking_threshold_failures: ["retrieval document_recall_at_5 0.9 below 1"] };
    expect(blockingGateRetryCaseIds(forged, qualityFailureCategory)).toEqual({
      caseIds: [],
      nonRetryable: ["retrieval document_recall_at_5 0.9 below 1"],
    });
  });

  it("renders nothing extra when no retry ran", () => {
    expect(renderEvalQualityMarkdown(report(healthy))).not.toContain("Blocking-Gate Retry");
  });
});
