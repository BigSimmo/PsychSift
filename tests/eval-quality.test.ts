import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildEvalQualityReport,
  configureEvalProviderEnvironment,
  deliveredGroundedAfterSourceGovernancePolicy,
  evalQualityRunContext,
  parseEvalQualityArgs,
  qualityFailureCategory,
  ragAnswerTimingDiagnostics,
  renderEvalQualityMarkdown,
  retrievalCasesForProviderMode,
  runRagQualityCases,
  runBoundEvalQualityWorkload,
  runRetrievalQualityCases,
  selectRagQualityCasesForQuestion,
  sourceGovernanceResultsFromArtifact,
  sourceGovernanceDangerFailuresForAnswer,
  sourceWarningsForRagQualityAnswer,
  type EvalQualityRunnerEvent,
  type EvalQualitySearchOutput,
  type RagQualityResult,
} from "../scripts/eval-quality";
import {
  evaluateGoldenRetrievalCase,
  type GoldenRetrievalCase,
  type GoldenRetrievalResult,
} from "../scripts/eval-retrieval";
import type { RagAnswer } from "../src/lib/types";

describe("eval quality diagnostic arguments", () => {
  it("keeps provider execution behind the import-safe main guard", () => {
    const source = readFileSync(new URL("../scripts/eval-quality.ts", import.meta.url), "utf8");
    expect(source).toContain("import.meta.url === pathToFileURL(process.argv[1]).href");
    expect(typeof parseEvalQualityArgs).toBe("function");
  });

  it("keeps RAG case dumping opt-in and restricted to rag-only runs", () => {
    expect(parseEvalQualityArgs(["--rag-only"]).dumpRagCases).toBeUndefined();
    expect(parseEvalQualityArgs(["--rag-only", "--dump-rag-cases", ".local/case.json"]).dumpRagCases).toBe(
      ".local/case.json",
    );
    expect(() => parseEvalQualityArgs(["--dump-rag-cases", ".local/case.json"])).toThrow(
      "--dump-rag-cases requires --rag-only.",
    );
    expect(() => parseEvalQualityArgs(["--rag-only", "--dump-rag-cases", "docs/case.json"])).toThrow(
      "repo-local file under .local/ or output/",
    );
    expect(() => parseEvalQualityArgs(["--rag-only", "--dump-rag-cases", ".local/../../case.json"])).toThrow(
      "repo-local file under .local/ or output/",
    );
  });

  it("selects a named full RAG case exactly by fixture ID", () => {
    const selected = selectRagQualityCasesForQuestion("agitation-arousal-typo-dosing");
    expect(selected).toHaveLength(1);
    expect(selected[0]).toMatchObject({
      id: "agitation-arousal-typo-dosing",
      question: "What agitaton and arousl dosing guidance applies to psychiatric inpatients?",
    });
  });
});

describe("eval quality run context", () => {
  it("records stable run identity without requiring GitHub Actions", () => {
    expect(
      evalQualityRunContext({
        EVAL_GIT_SHA: " candidate-sha ",
        GITHUB_SHA: "ignored-fallback",
        GITHUB_RUN_ID: "123",
        GITHUB_RUN_ATTEMPT: "2",
        EVAL_LATENCY_CONTEXT: "cross-region-runner",
      }),
    ).toEqual({
      git_sha: "candidate-sha",
      github_run_id: "123",
      github_run_attempt: "2",
      latency_context: "cross-region-runner",
    });
    expect(evalQualityRunContext({})).toEqual({
      git_sha: null,
      github_run_id: null,
      github_run_attempt: null,
      latency_context: "default",
    });
  });
});

function retrievalResult(overrides: Partial<GoldenRetrievalResult> = {}): GoldenRetrievalResult {
  const base: GoldenRetrievalResult = {
    id: "retrieval-1",
    query: "What ANC threshold should withhold clozapine?",
    forceEmbedding: false,
    expectedQueryClass: "table_threshold",
    actualQueryClass: "table_threshold",
    expectedDocumentSubstrings: ["clozapine.pdf"],
    missingDocumentSubstrings: [],
    expectedContentTerms: ["anc"],
    missingContentTerms: [],
    documentRecallAt5: 1,
    contentRecallAt5: 1,
    hitAtK: true,
    topK: 8,
    reciprocalRankAt10: 1,
    contentReciprocalRankAt10: 1,
    declaredSignalCount: 2,
    ndcgAt10: 1,
    irrelevantSourceRateAt10: 0,
    requiredSignalCoverageAt10: 1,
    latencyMs: 120,
    retrievalStrategy: "hybrid",
    retrievalPlan: "table_threshold:table_facts_visual_units_then_chunks",
    embeddingSkipped: false,
    embeddingSkipReason: null,
    textFastPathReason: null,
    textCandidateBudget: 40,
    textCandidateCount: 12,
    vectorCandidateCount: 16,
    secondStageRerankUsed: false,
    resultCount: 3,
    tableEvidenceFound: true,
    failures: [],
    topResults: [
      {
        rank: 1,
        title: "Clozapine monitoring",
        file_name: "clozapine.pdf",
        chunk_id: "chunk-1",
        page_number: 2,
        document_status: "current",
        clinical_validation_status: "approved",
        extraction_quality: "good",
        hybrid_score: 0.9,
        similarity: 0.82,
        text_rank: 0.6,
        rrf_score: 0.03,
        relevanceGrade: 2,
        matchedDeclaredSignals: ["document:clozapine.pdf", "content:anc"],
        content_preview: "Withhold clozapine at the source threshold.",
      },
    ],
  };
  return {
    ...base,
    ...overrides,
    retrievalPlan: overrides.retrievalPlan === undefined ? base.retrievalPlan : overrides.retrievalPlan,
  };
}

const evaluatorRetry = { maxAttempts: 1, initialDelayMs: 1, maxDelayMs: 1 };

function runnerRetrievalCase(overrides: Partial<GoldenRetrievalCase> = {}): GoldenRetrievalCase {
  return {
    id: "runner-retrieval",
    query: "runner retrieval question",
    expectedQueryClass: "unsupported_or_general",
    expectedDocumentSubstrings: [],
    expectedContentTerms: [],
    topK: 8,
    expectTableEvidence: false,
    ...overrides,
  };
}

function runnerSearchOutput(): EvalQualitySearchOutput {
  return {
    results: [],
    telemetry: {
      query_class: "unsupported_or_general",
      retrieval_strategy: "hybrid",
      embedding_skipped: false,
      search_cache_hit: false,
      embedding_cache_hit: false,
      text_fast_path_latency_ms: 0,
      embedding_latency_ms: 2,
      supabase_rpc_latency_ms: 3,
      rerank_latency_ms: 1,
      retrieval_layer_counts: {},
      retrieval_layer_top_scores: {},
      retrieval_layer_latencies_ms: {},
    },
  };
}

function runnerUnsupportedAnswer(overrides: Partial<RagAnswer> = {}): RagAnswer {
  return {
    answer: "No relevant clinical source was found.",
    grounded: false,
    confidence: "unsupported",
    responseMode: "evidence_gap",
    routingMode: "unsupported",
    routingReason: "unsupported query",
    queryClass: "unsupported_or_general",
    citations: [],
    sources: [],
    latencyTimings: { total_latency_ms: 10, generation_latency_ms: 0 },
    ...overrides,
  } as unknown as RagAnswer;
}

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

describe("eval quality reporting", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("categorizes common retrieval and answer failures", () => {
    expect(qualityFailureCategory("expected query class table_threshold, got document_lookup")).toBe("query_class");
    expect(qualityFailureCategory("missing expected document(s) in top 5")).toBe("expected_source");
    expect(qualityFailureCategory("expected at least 2 citations")).toBe("citation");
    expect(qualityFailureCategory("numeric faithfulness warning present")).toBe("numeric_grounding");
  });

  it("enforces route ceilings while allowing unsupported retrieval time", () => {
    expect(
      ragAnswerTimingDiagnostics({
        routingMode: "unsupported",
        latencyTimings: { total_latency_ms: 2_000, generation_latency_ms: 0, route_budget_ms: 0 },
      }).routeCeilingExceeded,
    ).toBe(false);
    expect(
      ragAnswerTimingDiagnostics({
        routingMode: "unsupported",
        latencyTimings: { total_latency_ms: 2_000, generation_latency_ms: 1, route_budget_ms: 0 },
      }).routeCeilingExceeded,
    ).toBe(true);
    expect(
      ragAnswerTimingDiagnostics({
        routingMode: "fast",
        latencyTimings: { total_latency_ms: 25_001, generation_latency_ms: 10_000 },
      }).routeCeilingExceeded,
    ).toBe(true);
  });

  it("builds source governance, retrieval, and RAG summaries", () => {
    const report = buildEvalQualityReport({
      generatedAt: "2026-06-25T00:00:00.000Z",
      retrievalResults: [
        retrievalResult(),
        retrievalResult({
          id: "retrieval-2",
          documentRecallAt5: 0,
          contentRecallAt5: 0,
          hitAtK: false,
          reciprocalRankAt10: 0,
          embeddingSkipped: true,
          embeddingSkipReason: "structured_threshold_text_match",
          textFastPathReason: "structured_threshold_text_match",
          secondStageRerankUsed: true,
          failures: ["missing expected document(s) in top 5: Missing.pdf"],
          expectedDocumentSubstrings: ["Missing.pdf"],
          missingDocumentSubstrings: ["Missing.pdf"],
          expectedContentTerms: ["anc"],
          missingContentTerms: ["anc"],
          topResults: [
            {
              ...retrievalResult().topResults[0],
              document_status: "outdated",
              clinical_validation_status: "unverified",
              extraction_quality: "poor",
            },
          ],
        }),
      ],
      ragResults: [
        ragResult(),
        ragResult({
          id: "rag-2",
          supported: false,
          grounded: true,
          expectedHit: false,
          citations: 0,
          failures: ["expected unsupported answer", "numeric faithfulness warning present"],
          unverifiedNumericTokenCount: 1,
          hasFaithfulnessWarning: true,
          sourceWarningCount: 1,
          sourceDangerWarningCount: 0,
        }),
        ragResult({
          id: "rag-3",
          failures: ["danger source governance warning present"],
          sourceWarningCount: 1,
          sourceDangerWarningCount: 1,
        }),
      ],
    });

    expect(report.retrieval.summary.case_count).toBe(2);
    expect(report.retrieval.summary.top_k_hit_rate).toBe(0.5);
    expect(report.retrieval.source_governance.stale_top_results).toBe(1);
    expect(report.retrieval.source_governance.unverified_top_results).toBe(1);
    expect(report.retrieval.source_governance.review_required_top_results).toBe(1);
    expect(report.retrieval.source_governance.metadata_policy).toContain("review-required");
    expect(report.retrieval.summary.embedding_skipped_rate).toBe(0.5);
    expect(report.retrieval.summary.embedding_skip_reason_counts).toMatchObject({
      embedding_used: 1,
      structured_threshold_text_match: 1,
    });
    expect(report.retrieval.summary.second_stage_rerank_rate).toBe(0.5);
    expect(report.retrieval.summary.force_embedding_case_count).toBe(0);
    expect(report.retrieval.summary.force_embedding_failure_count).toBe(0);
    expect(report.rag.summary.unsupported_correct_rate).toBe(0);
    expect(report.rag.summary.numeric_grounding_failure_rate).toBeCloseTo(0.3333, 4);
    expect(report.rag.summary.source_governance_danger_failure_rate).toBeCloseTo(0.3333, 4);
    expect(report.threshold_failures).toEqual(
      expect.arrayContaining([
        expect.stringContaining("retrieval top_k_hit_rate"),
        expect.stringContaining("top-result review_required_rate"),
        expect.stringContaining("RAG unsupported_correct_rate"),
        expect.stringContaining("RAG numeric_grounding_failure_rate"),
        expect.stringContaining("RAG source_governance_danger_failure_rate"),
      ]),
    );
  });

  it("reports governance from a separate retrieval artifact without enabling retrieval gates", () => {
    const governanceResult = retrievalResult({
      topResults: [
        {
          ...retrievalResult().topResults[0],
          document_status: "outdated",
          clinical_validation_status: "unverified",
          extraction_quality: "poor",
        },
      ],
    });
    const parsedResults = sourceGovernanceResultsFromArtifact({ results: [governanceResult] });
    const report = buildEvalQualityReport({
      generatedAt: "2026-07-24T00:00:00.000Z",
      retrievalResults: [],
      sourceGovernanceResults: parsedResults,
      ragResults: [],
    });

    expect(report.retrieval.summary.case_count).toBe(0);
    expect(report.retrieval.source_governance).toMatchObject({
      total_top_results: 1,
      stale_top_results: 1,
      unverified_top_results: 1,
      poor_extraction_top_results: 1,
      review_required_top_results: 1,
    });
    expect(report.threshold_failures).not.toEqual(expect.arrayContaining([expect.stringContaining("top-result")]));
  });

  it("rejects a malformed source-governance retrieval artifact", () => {
    expect(() => sourceGovernanceResultsFromArtifact({ results: [{ id: "missing-top-results" }] })).toThrow(
      "topResults must be an array",
    );
  });

  it("counts an acceptSourceOnly source-only answer as grounded-supported only when expected docs are cited", () => {
    const acceptedSourceOnly = buildEvalQualityReport({
      generatedAt: "2026-07-13T00:00:00.000Z",
      retrievalResults: [retrievalResult()],
      ragResults: [
        ragResult({
          id: "discharge-documentation",
          supported: true,
          acceptSourceOnly: true,
          grounded: false,
          expectedHit: true,
          citations: 4,
        }),
      ],
    });
    expect(acceptedSourceOnly.rag.summary.grounded_supported_rate).toBe(1);
    expect(acceptedSourceOnly.blocking_threshold_failures).not.toEqual(
      expect.arrayContaining([expect.stringContaining("grounded_supported_rate")]),
    );

    // A real retrieval regression (source-only but expected docs no longer surfaced)
    // is NOT accepted: it drags the rate below threshold and hard-fails.
    const regressed = buildEvalQualityReport({
      generatedAt: "2026-07-13T00:00:00.000Z",
      retrievalResults: [retrievalResult()],
      ragResults: [
        ragResult({
          id: "discharge-documentation",
          supported: true,
          acceptSourceOnly: true,
          grounded: false,
          expectedHit: false,
          citations: 0,
        }),
      ],
    });
    expect(regressed.rag.summary.grounded_supported_rate).toBe(0);
    expect(regressed.blocking_threshold_failures).toEqual(
      expect.arrayContaining([expect.stringContaining("RAG grounded_supported_rate")]),
    );
  });

  it("does not apply the supported-answer grounding gate to an unsupported-only run", () => {
    const report = buildEvalQualityReport({
      generatedAt: "2026-07-27T00:00:00.000Z",
      retrievalResults: [],
      ragResults: [
        ragResult({
          id: "unsupported-only",
          supported: false,
          grounded: false,
          expectedHit: false,
          route: "unsupported",
          latencyRoute: "unsupported",
          model: null,
          citations: 0,
          executionType: "rule-based",
          estimatedCostUsd: 0,
        }),
      ],
    });

    expect(report.rag.summary).toMatchObject({
      supported_count: 0,
      unsupported_count: 1,
      grounded_supported_rate: 0,
      unsupported_correct_rate: 1,
    });
    expect(report.blocking_threshold_failures).not.toEqual(
      expect.arrayContaining([expect.stringContaining("grounded_supported_rate")]),
    );
  });

  it("budgets a model-attempt extractive fallback against the fallback latency route", () => {
    // A failed generation followed by a source-backed fallback structurally costs the
    // generation timeout plus the fallback work, so it is budgeted in its own "fallback"
    // bucket (50s) rather than the plain fast budget (25s) or the tight no-model
    // extractive budget (12s). 35s here would fail both of those but must pass fallback.
    const report = buildEvalQualityReport({
      generatedAt: "2026-07-13T00:00:00.000Z",
      retrievalResults: [],
      ragResults: [
        ragResult({
          route: "extractive",
          latencyRoute: "fallback",
          latencyMs: 35_000,
          generationLatencyMs: 30_000,
          model: null,
          routingReason: "strong_routine_retrieval; generation_fallback:provider_timeout",
        }),
      ],
    });

    expect(report.rag.summary.route_p95_latency_ms).toEqual({ fallback: 35_000 });
    expect(report.threshold_failures).not.toEqual(
      expect.arrayContaining([expect.stringContaining("route extractive")]),
    );
    expect(report.threshold_failures).not.toEqual(expect.arrayContaining([expect.stringContaining("route fallback")]));
  });

  it("reports fallback stubs separately from comparison and other generation fallbacks", () => {
    const report = buildEvalQualityReport({
      generatedAt: "2026-07-27T00:00:00.000Z",
      retrievalResults: [],
      ragResults: [
        ragResult({
          id: "community-home-visits",
          routingReason:
            "strong_routine_retrieval; generation_fallback:generation_quality_failed; source_backed_review_fallback; extractive_quality_gate:ungrounded_extractive_fallback",
        }),
        ragResult({
          id: "clozapine-fbc-acronym-threshold",
          routingReason: "high_confidence_extractive_retrieval; source_backed_review_fallback",
        }),
        ragResult({
          id: "agitation-arousal-typo-dosing",
          routingReason:
            "clinical_fast_grounded_synthesis; generation_fallback:provider_timeout; source_backed_review_fallback; extractive_quality_gate:fragment_like_answer",
        }),
        ragResult({
          id: "comparison-fallback",
          routingReason:
            "multi_document_comparison_synthesis; generation_fallback:generation_quality_failed; comparison_source_extractive_fallback",
        }),
        ragResult({ id: "ordinary-answer", routingReason: "strong_routine_retrieval" }),
      ],
    });

    expect(report.rag.summary).toMatchObject({
      generation_fallback_count: 3,
      source_backed_review_fallback_count: 3,
      source_backed_review_fallback_rate: 0.6,
      substantive_grounded_count: 2,
      substantive_grounded_rate: 0.4,
      comparison_source_extractive_fallback_count: 1,
    });
    expect(report.blocking_threshold_failures).toContain("RAG source_backed_review_fallback_count 3 above 0");
    expect(renderEvalQualityMarkdown(report)).toContain("| Source-backed review fallbacks | 3 |");
    expect(renderEvalQualityMarkdown(report)).toContain("| Substantive grounded answers | 2 |");
  });

  it("fails forced-embedding retrieval cases that return from cache, coverage, or lexical paths", () => {
    const result = evaluateGoldenRetrievalCase({
      testCase: {
        id: "vector-regression",
        query: "How is panic disorder managed?",
        expectedQueryClass: "broad_summary",
        expectedDocumentSubstrings: [],
        expectedContentTerms: [],
        topK: 8,
        expectTableEvidence: false,
        forceEmbedding: true,
      },
      results: [],
      telemetry: {
        query_class: "broad_summary",
        retrieval_strategy: "text_fast_path",
        embedding_skipped: true,
        embedding_skip_reason: "strong_document_text_score",
        text_fast_path_reason: "strong_document_text_score",
        text_candidate_budget: 32,
        text_candidate_count: 5,
        vector_candidate_count: 0,
        retrieval_layer_counts: { text_candidates: 5 },
        coverage_gate_decision: "accepted",
        coverage_gate_reason: "document_title_evidence_gate",
        second_stage_rerank_used: false,
      },
      latencyMs: 10,
    });

    expect(result.forceEmbedding).toBe(true);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        "forceEmbedding expected embedding to run",
        "forceEmbedding returned lexical strategy text_fast_path",
        "forceEmbedding returned coverage gate",
        "forceEmbedding found no vector-layer candidates",
      ]),
    );
    const report = buildEvalQualityReport({ retrievalResults: [result], ragResults: [] });
    expect(report.retrieval.summary.force_embedding_case_count).toBe(1);
    expect(report.retrieval.summary.force_embedding_failure_count).toBe(1);
    expect(report.blocking_threshold_failures).toEqual(
      expect.arrayContaining([expect.stringContaining("retrieval force_embedding_failure_count 1 above 0")]),
    );
  });

  it("derives source governance warnings for direct RAG answers without precomputed warnings", () => {
    const warnings = sourceWarningsForRagQualityAnswer({
      sourceGovernanceWarnings: undefined,
      relevance: undefined,
      sources: [
        {
          document_id: "doc-outdated",
          title: "Outdated policy",
          source_metadata: {
            document_status: "outdated",
            clinical_validation_status: "approved",
            extraction_quality: "good",
          },
        },
      ],
    } as never);

    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "outdated_source",
          severity: "danger",
          document_id: "doc-outdated",
        }),
      ]),
    );
  });

  it("accepts explicit warning-class source metadata debt without clearing danger failures", () => {
    const report = buildEvalQualityReport({
      generatedAt: "2026-06-25T00:00:00.000Z",
      retrievalResults: [
        retrievalResult({
          topResults: [
            {
              ...retrievalResult().topResults[0],
              document_status: "unknown",
              clinical_validation_status: "unverified",
              extraction_quality: "partial",
            },
          ],
        }),
      ],
      ragResults: [
        ragResult({
          failures: ["danger source governance warning present"],
          sourceWarningCount: 1,
          sourceDangerWarningCount: 1,
        }),
      ],
      sourceMetadataDebtAcceptance: {
        accepted_by: "release owner",
        accepted_at: "2026-06-25T00:00:00.000Z",
        expires_at: "2099-01-01T00:00:00.000Z",
        reason: "Temporary corpus metadata debt while source records are reviewed.",
        max_stale_rate: 1,
        max_review_required_rate: 1,
        max_outdated_top_results: 0,
        max_poor_extraction_top_results: 0,
        max_source_governance_danger_failure_rate: 0,
      },
    });

    expect(report.accepted_threshold_failures).toEqual(
      expect.arrayContaining([expect.stringContaining("top-result review_required_rate")]),
    );
    expect(report.accepted_threshold_failures).not.toEqual(
      expect.arrayContaining([expect.stringContaining("top-result stale_rate")]),
    );
    expect(report.blocking_threshold_failures).toEqual(
      expect.arrayContaining([expect.stringContaining("RAG source_governance_danger_failure_rate")]),
    );
  });

  it("treats danger warnings as failures only for delivered grounded answers", () => {
    // Grounded answer delivered on dangerous sourcing: a governance failure.
    expect(sourceGovernanceDangerFailuresForAnswer({ grounded: true, sourceDangerWarningCount: 1 })).toEqual([
      "danger source governance warning present",
    ]);
    // Declined answer (grounded=false): the danger warning is the expected
    // refusal signal, not a failure -- regardless of the preserved routingMode,
    // so evidence-gap refusals converted from fast/strong routes are exempt too.
    expect(sourceGovernanceDangerFailuresForAnswer({ grounded: false, sourceDangerWarningCount: 1 })).toEqual([]);
    // Grounded answer with no danger warning: clean.
    expect(sourceGovernanceDangerFailuresForAnswer({ grounded: true, sourceDangerWarningCount: 0 })).toEqual([]);
  });

  it("mirrors API source-governance refusals before delivery accounting", () => {
    expect(
      deliveredGroundedAfterSourceGovernancePolicy(
        { grounded: true, confidence: "high", responseMode: "clinical_pathway" },
        [{ severity: "danger" }],
      ),
    ).toBe(false);
    expect(
      deliveredGroundedAfterSourceGovernancePolicy(
        { grounded: true, confidence: "high", responseMode: "clinical_pathway" },
        [{ severity: "warning" }],
      ),
    ).toBe(true);
    expect(
      deliveredGroundedAfterSourceGovernancePolicy(
        { grounded: false, confidence: "unsupported", responseMode: "evidence_gap" },
        [{ severity: "danger" }],
      ),
    ).toBe(false);
  });

  it("flags refusals that drop an expected danger warning, regardless of grounded", () => {
    // Refusal expected to surface a danger warning but missing it: a
    // refusal-safety regression, failing even though grounded=false.
    expect(
      sourceGovernanceDangerFailuresForAnswer({
        grounded: false,
        sourceDangerWarningCount: 0,
        expectsDangerWarning: true,
      }),
    ).toEqual(["expected danger source governance warning missing"]);
    // Refusal that still carries its expected danger warning: clean (the warning
    // is the expected refusal signal, not a failure).
    expect(
      sourceGovernanceDangerFailuresForAnswer({
        grounded: false,
        sourceDangerWarningCount: 1,
        expectsDangerWarning: true,
      }),
    ).toEqual([]);
    // No expectation set: unchanged behavior (ungrounded, no warning => clean).
    expect(sourceGovernanceDangerFailuresForAnswer({ grounded: false, sourceDangerWarningCount: 0 })).toEqual([]);
    // The failure is categorized under source governance for reporting.
    expect(qualityFailureCategory("expected danger source governance warning missing")).toBe("source_governance");
  });

  it("hard-blocks release when a refusal drops an expected danger warning (not waivable by debt)", () => {
    const report = buildEvalQualityReport({
      generatedAt: "2026-07-02T00:00:00.000Z",
      retrievalResults: [retrievalResult()],
      ragResults: [
        ragResult({
          id: "refusal-missing-expected-danger",
          supported: false,
          grounded: false,
          route: "unsupported",
          citations: 0,
          failures: ["expected danger source governance warning missing"],
        }),
      ],
      // A permissive debt acceptance must NOT waive this refusal-safety failure.
      sourceMetadataDebtAcceptance: {
        accepted_by: "release owner",
        accepted_at: "2026-07-02T00:00:00.000Z",
        expires_at: "2099-01-01T00:00:00.000Z",
        reason: "Broad metadata debt acceptance for the test.",
        max_stale_rate: 1,
        max_review_required_rate: 1,
        max_outdated_top_results: 0,
        max_poor_extraction_top_results: 0,
        max_source_governance_danger_failure_rate: 0,
      },
    });
    expect(report.rag.summary.expected_danger_warning_missing_count).toBe(1);
    const blocker = "RAG expected_danger_warning_missing_count 1 above 0";
    expect(report.threshold_failures).toContain(blocker);
    expect(report.blocking_threshold_failures).toContain(blocker);
    expect(report.accepted_threshold_failures).not.toContain(blocker);
  });

  it("excludes declined answers from the danger failure rate regardless of route", () => {
    const declinedOnly = buildEvalQualityReport({
      generatedAt: "2026-07-02T00:00:00.000Z",
      retrievalResults: [retrievalResult()],
      ragResults: [
        // Declined via the unsupported route.
        ragResult({
          id: "unsupported-declined",
          supported: false,
          grounded: false,
          route: "unsupported",
          citations: 0,
          sourceWarningCount: 1,
          sourceDangerWarningCount: 1,
        }),
        // Declined via a fast-route answer converted to an evidence-gap refusal:
        // grounded=false but the original route is preserved.
        ragResult({
          id: "fast-route-evidence-gap-refusal",
          grounded: false,
          route: "fast",
          citations: 0,
          sourceWarningCount: 1,
          sourceDangerWarningCount: 1,
        }),
        ragResult({ id: "answered-clean" }),
      ],
    });
    expect(declinedOnly.rag.summary.source_governance_danger_failure_rate).toBe(0);

    const answeredDangerous = buildEvalQualityReport({
      generatedAt: "2026-07-02T00:00:00.000Z",
      retrievalResults: [retrievalResult()],
      ragResults: [ragResult({ grounded: true, sourceWarningCount: 1, sourceDangerWarningCount: 1 })],
    });
    expect(answeredDangerous.rag.summary.source_governance_danger_failure_rate).toBeGreaterThan(0);
  });

  it("rejects source metadata debt acceptance when outdated sources are present", () => {
    const report = buildEvalQualityReport({
      generatedAt: "2026-06-25T00:00:00.000Z",
      retrievalResults: [
        retrievalResult({
          topResults: [
            {
              ...retrievalResult().topResults[0],
              document_status: "outdated",
              clinical_validation_status: "unverified",
              extraction_quality: "partial",
            },
          ],
        }),
      ],
      ragResults: [],
      sourceMetadataDebtAcceptance: {
        accepted_by: "release owner",
        accepted_at: "2026-06-25T00:00:00.000Z",
        expires_at: "2099-01-01T00:00:00.000Z",
        reason: "Temporary corpus metadata debt while source records are reviewed.",
        max_stale_rate: 1,
        max_review_required_rate: 1,
        max_outdated_top_results: 0,
        max_poor_extraction_top_results: 0,
        max_source_governance_danger_failure_rate: 0,
      },
    });

    expect(report.accepted_threshold_failures).toEqual([]);
    expect(report.blocking_threshold_failures).toEqual(report.threshold_failures);
    expect(report.source_metadata_debt_acceptance.rejection_reasons.join(" ")).toContain("outdated top results");
  });

  it("marks source metadata debt acceptance passed when no metadata thresholds need accepting", () => {
    const report = buildEvalQualityReport({
      generatedAt: "2026-06-25T00:00:00.000Z",
      retrievalResults: [retrievalResult()],
      ragResults: [ragResult()],
      sourceMetadataDebtAcceptance: {
        accepted_by: "release owner",
        accepted_at: "2026-06-25T00:00:00.000Z",
        expires_at: "2099-01-01T00:00:00.000Z",
        reason: "Temporary corpus metadata debt while source records are reviewed.",
        max_stale_rate: 0,
        max_review_required_rate: 0,
        max_outdated_top_results: 0,
        max_poor_extraction_top_results: 0,
        max_source_governance_danger_failure_rate: 0,
      },
    });

    expect(report.threshold_failures).toEqual([]);
    expect(report.source_metadata_debt_acceptance).toMatchObject({
      status: "accepted",
      accepted_failures: [],
      rejection_reasons: [],
    });
  });

  it("renders a readable Markdown report", () => {
    const report = buildEvalQualityReport({
      generatedAt: "2026-06-25T00:00:00.000Z",
      retrievalResults: [retrievalResult()],
      ragResults: [ragResult()],
    });
    const markdown = renderEvalQualityMarkdown(report);

    expect(markdown).toContain("# Retrieval Quality Report");
    expect(markdown).toContain("## Retrieval Metrics");
    expect(markdown).toContain("## Retrieval Decision Metrics");
    expect(markdown).toContain("## Source Governance");
    expect(markdown).toContain("## Answer Metrics");
    expect(markdown).toContain("## Answer Case Diagnostics");
    expect(markdown).toContain(
      "| rag-1 | fast | generation | test_route | 900 | 500 | 10 | 200 | 650 | 40 | 150 | 25 | 25000 | no | test-model | passed |",
    );
    expect(markdown).toContain("| Hit@K | 1 |");
    expect(markdown).toContain("Policy: unknown, unverified");
  });

  it("hard-fails any answer case that exceeds its route ceiling", () => {
    const report = buildEvalQualityReport({
      generatedAt: "2026-07-13T00:00:00.000Z",
      retrievalResults: [retrievalResult()],
      ragResults: [
        ragResult({
          latencyMs: 25_001,
          routeCeilingExceeded: true,
          failures: ["route latency ceiling exceeded: 25001ms total, 25000ms budget"],
          timings: {
            retrievalMs: 1_000,
            routingMs: 10,
            generationMs: 23_951,
            verificationMs: 40,
            totalMs: 25_001,
            routeBudgetMs: 25_000,
            routeDeadlineExceeded: true,
          },
        }),
      ],
    });

    expect(report.rag.summary.route_ceiling_failure_count).toBe(1);
    expect(report.blocking_threshold_failures).toContain("RAG route_ceiling_failure_count 1 above 0");
  });

  it("sums estimated cost across priced and zero-cost cases, going n/a only when a case cannot be estimated", () => {
    // Issue #014: extractive/unsupported cases make no provider call and cost
    // exactly $0 when rates are configured — they must not null the run total.
    // null stays reserved for "rates unconfigured" (cannot estimate).
    const priced = ragResult({ estimatedCostUsd: 0.002 });
    const zeroCost = ragResult({ estimatedCostUsd: 0 });
    const unpriced = ragResult({ estimatedCostUsd: null });

    const summed = buildEvalQualityReport({ retrievalResults: [], ragResults: [priced, zeroCost] });
    expect(summed.rag.summary.estimated_cost_usd).toBe(0.002);

    const unknown = buildEvalQualityReport({ retrievalResults: [], ragResults: [priced, zeroCost, unpriced] });
    expect(unknown.rag.summary.estimated_cost_usd).toBeNull();
  });

  it("accepts an offline source-only result only when expected sources are retrieved and cited", () => {
    const sourceOnly = ragResult({
      grounded: false,
      model: null,
      generationLatencyMs: 0,
      estimatedCostUsd: 0,
      openAIRequestIds: [],
      openAIUsage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
      timings: {
        retrievalMs: 500,
        routingMs: 10,
        generationMs: 0,
        verificationMs: 40,
        totalMs: 550,
        routeBudgetMs: 25_000,
        routeDeadlineExceeded: false,
      },
    });
    const passing = buildEvalQualityReport({ retrievalResults: [], ragResults: [sourceOnly], providerMode: "offline" });
    expect(passing.provider).toMatchObject({ mode: "offline", passed: true });
    expect(passing.rag.summary.grounded_supported_rate).toBe(1);

    const missingEvidence = buildEvalQualityReport({
      retrievalResults: [],
      ragResults: [{ ...sourceOnly, expectedHit: false, citations: 0 }],
      providerMode: "offline",
    });
    expect(missingEvidence.rag.summary.grounded_supported_rate).toBe(0);
    expect(missingEvidence.blocking_threshold_failures).toContain("RAG grounded_supported_rate 0 below 0.9");
  });

  it("hard-fails offline reports containing provider evidence", () => {
    const report = buildEvalQualityReport({
      retrievalResults: [],
      ragResults: [
        ragResult({
          openAIRequestIds: ["req_leak"],
          openAIUsage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 },
        }),
      ],
      providerMode: "offline",
    });
    expect(report.provider.passed).toBe(false);
    expect(report.blocking_threshold_failures).toEqual(
      expect.arrayContaining([
        "offline provider invariant model_case_count 1 above 0",
        "offline provider invariant openai_request_id_count 1 above 0",
        "offline provider invariant token_usage_case_count 1 above 0",
        "offline provider invariant nonzero_cost_case_count 1 above 0",
        "offline provider invariant generation_latency_case_count 1 above 0",
      ]),
    );
  });

  it("removes OpenAI credentials before offline RAG imports", () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_ORG_ID", "test-org");
    vi.stubEnv("OPENAI_PROJECT_ID", "test-project");
    configureEvalProviderEnvironment("offline");
    expect(process.env.RAG_PROVIDER_MODE).toBe("offline");
    expect(process.env.OPENAI_API_KEY).toBeUndefined();
    expect(process.env.OPENAI_ORG_ID).toBeUndefined();
    expect(process.env.OPENAI_PROJECT_ID).toBeUndefined();
  });

  it("makes the selected provider mode authoritative over ambient configuration", () => {
    vi.stubEnv("RAG_PROVIDER_MODE", "offline");
    vi.stubEnv("OPENAI_API_KEY", "test-key");

    configureEvalProviderEnvironment("openai");

    expect(process.env.RAG_PROVIDER_MODE).toBe("openai");
    expect(process.env.OPENAI_API_KEY).toBe("test-key");
  });

  it("omits force-embedding retrieval cases from the offline profile", () => {
    const cases = [{ id: "lexical", forceEmbedding: false }, { id: "vector", forceEmbedding: true }, { id: "default" }];

    expect(retrievalCasesForProviderMode(cases, "offline").map((item) => item.id)).toEqual(["lexical", "default"]);
    expect(retrievalCasesForProviderMode(cases, "openai")).toEqual(cases);
  });
});

describe("cross-region retrieval-exhausted carve-out (E-3b)", () => {
  const exhaustedTimings = {
    total_latency_ms: 13_352,
    generation_latency_ms: 0,
    route_budget_ms: 12_000,
    route_deadline_exceeded: true,
    route_budget_exhausted_by_retrieval: true,
  };

  it("keeps the strict gate in local/release contexts even when the flag is set", () => {
    expect(
      ragAnswerTimingDiagnostics({ routingMode: "extractive", latencyTimings: exhaustedTimings }).routeCeilingExceeded,
    ).toBe(true);
  });

  it("suppresses the ceiling only for cross-region + runtime flag + zero generation", () => {
    expect(
      ragAnswerTimingDiagnostics(
        { routingMode: "extractive", latencyTimings: exhaustedTimings },
        { crossRegionRunner: true },
      ).routeCeilingExceeded,
    ).toBe(false);
  });

  it("still fails cross-region when the runtime flag is absent", () => {
    expect(
      ragAnswerTimingDiagnostics(
        {
          routingMode: "extractive",
          latencyTimings: { ...exhaustedTimings, route_budget_exhausted_by_retrieval: false },
        },
        { crossRegionRunner: true },
      ).routeCeilingExceeded,
    ).toBe(true);
  });

  it("still fails cross-region when generation consumed time", () => {
    expect(
      ragAnswerTimingDiagnostics(
        {
          routingMode: "extractive",
          latencyTimings: { ...exhaustedTimings, generation_latency_ms: 1 },
        },
        { crossRegionRunner: true },
      ).routeCeilingExceeded,
    ).toBe(true);
  });

  it("carries the flag through timings for report auditing", () => {
    expect(
      ragAnswerTimingDiagnostics({ routingMode: "extractive", latencyTimings: exhaustedTimings }).timings
        .budgetExhaustedByRetrieval,
    ).toBe(true);
  });
});

describe("addressed callable quality-runner lifecycle", () => {
  it("retains completed retrieval output when a later duplicate-ID occurrence is cancelled", async () => {
    const firstOutput = runnerSearchOutput();
    const cancellation = Object.assign(new Error("evaluation cancelled"), { name: "AbortError" });
    const events: EvalQualityRunnerEvent[] = [];
    const cases = [runnerRetrievalCase(), runnerRetrievalCase()];

    await expect(
      runRetrievalQualityCases({
        cases,
        forceEmbedding: undefined,
        evaluatorRetry,
        search: async (_input, address) => {
          if (address.ordinal === 0) return firstOutput;
          throw cancellation;
        },
        observe: (event) => events.push(event),
      }),
    ).rejects.toBe(cancellation);

    const terminalEvents = events.filter(
      (entry) => entry.event.type === "case-complete" || entry.event.type === "case-failed",
    );
    expect(terminalEvents.map((entry) => [entry.address.ordinal, entry.event.type])).toEqual([
      [0, "case-complete"],
      [1, "case-failed"],
    ]);
    const completed = terminalEvents[0];
    expect(completed.event.type).toBe("case-complete");
    if (completed.event.type !== "case-complete") throw new Error("expected completed event");
    expect(completed.event.occurrence.output).toBe(firstOutput);

    const failed = terminalEvents[1];
    expect(failed.event.type).toBe("case-failed");
    if (failed.event.type !== "case-failed") throw new Error("expected failed event");
    expect(failed.event).toMatchObject({ stage: "provider", error: cancellation, output: null, occurrence: null });
    expect(failed.event.completedOccurrences).toHaveLength(1);
    expect(failed.event.completedOccurrences[0].output).toBe(firstOutput);
    expect(events.some((entry) => entry.address.ordinal === 1 && entry.event.type === "case-complete")).toBe(false);
  });

  it("emits a scored retrieval failure and continues with unchanged scorer output", async () => {
    const failedCase = runnerRetrievalCase({ expectedQueryClass: "table_threshold" });
    const passingCase = runnerRetrievalCase();
    const outputs = [runnerSearchOutput(), runnerSearchOutput()];
    const events: EvalQualityRunnerEvent[] = [];

    const run = await runRetrievalQualityCases({
      cases: [failedCase, passingCase],
      forceEmbedding: undefined,
      evaluatorRetry,
      search: async (_input, address) => outputs[address.ordinal],
      observe: (event) => events.push(event),
    });
    const unobservedRun = await runRetrievalQualityCases({
      cases: [failedCase, passingCase],
      forceEmbedding: undefined,
      evaluatorRetry,
      search: async (_input, address) => outputs[address.ordinal],
    });

    expect(unobservedRun).toEqual(run);
    expect(run.results).toEqual([
      evaluateGoldenRetrievalCase({
        testCase: failedCase,
        results: outputs[0].results,
        telemetry: outputs[0].telemetry,
        latencyMs: 6,
      }),
      evaluateGoldenRetrievalCase({
        testCase: passingCase,
        results: outputs[1].results,
        telemetry: outputs[1].telemetry,
        latencyMs: 6,
      }),
    ]);
    const terminalEvents = events.filter(
      (entry) => entry.event.type === "case-complete" || entry.event.type === "case-failed",
    );
    expect(terminalEvents.map((entry) => [entry.address.ordinal, entry.event.type])).toEqual([
      [0, "case-failed"],
      [1, "case-complete"],
    ]);
    const failed = terminalEvents[0];
    if (failed.event.type !== "case-failed") throw new Error("expected failed event");
    expect(failed.event).toMatchObject({ stage: "scoring", error: null, output: outputs[0] });
    expect(failed.event.occurrence?.result).toBe(run.results[0]);
    expect(Object.isFrozen(failed.event.completedOccurrences)).toBe(true);
  });

  it("emits validation failure and completion in case order while retaining each full answer", async () => {
    const testCase = selectRagQualityCasesForQuestion("unsupported-coffee-machine")[0];
    const failedAnswer = runnerUnsupportedAnswer({ grounded: true });
    const passingAnswer = runnerUnsupportedAnswer();
    const events: EvalQualityRunnerEvent[] = [];

    const run = await runRagQualityCases({
      cases: [testCase, testCase],
      evaluatorRetry,
      costRates: null,
      crossRegionRunner: false,
      answer: async (_input, address) => (address.ordinal === 0 ? failedAnswer : passingAnswer),
      observe: (event) => events.push(event),
    });

    expect(run.results).toHaveLength(2);
    expect(run.results[0].failures).toEqual(
      expect.arrayContaining(["expected unsupported answer", "false-positive control produced grounded answer"]),
    );
    expect(run.results[1].failures).toEqual([]);
    const terminalEvents = events.filter(
      (entry) => entry.event.type === "case-complete" || entry.event.type === "case-failed",
    );
    expect(terminalEvents.map((entry) => [entry.address.ordinal, entry.event.type])).toEqual([
      [0, "case-failed"],
      [1, "case-complete"],
    ]);
    const failed = terminalEvents[0];
    if (failed.event.type !== "case-failed") throw new Error("expected failed event");
    expect(failed.event).toMatchObject({ stage: "validation", error: null, output: failedAnswer });
    expect(failed.event.occurrence?.output).toBe(failedAnswer);
    const completed = terminalEvents[1];
    if (completed.event.type !== "case-complete") throw new Error("expected completed event");
    expect(completed.event.occurrence.output).toBe(passingAnswer);
  });

  it("emits validation exception without fabricating case completion", async () => {
    const testCase = selectRagQualityCasesForQuestion("unsupported-coffee-machine")[0];
    const validationError = new Error("validation exploded");
    const answer = new Proxy(runnerUnsupportedAnswer(), {
      get(target, property, receiver) {
        if (property === "sources") throw validationError;
        return Reflect.get(target, property, receiver);
      },
    });
    const events: EvalQualityRunnerEvent[] = [];

    await expect(
      runRagQualityCases({
        cases: [testCase],
        evaluatorRetry,
        costRates: null,
        crossRegionRunner: false,
        answer: async () => answer,
        observe: (event) => events.push(event),
      }),
    ).rejects.toBe(validationError);

    const failed = events.find((entry) => entry.event.type === "case-failed");
    expect(failed?.address).toMatchObject({ kind: "quality", ordinal: 0, id: testCase.id });
    if (!failed || failed.event.type !== "case-failed") throw new Error("expected failed event");
    expect(failed.event).toMatchObject({ stage: "validation", error: validationError, occurrence: null });
    expect(failed.event.output).toBe(answer);
    expect(events.some((entry) => entry.event.type === "case-complete")).toBe(false);
  });
});

describe("U04 bound quality workload", () => {
  const generatedAt = "2026-09-13T02:03:04.000Z";
  const runContext = {
    git_sha: "synthetic-bound-sha",
    github_run_id: null,
    github_run_attempt: null,
    latency_context: " cross-region-runner ",
  };
  const qualityCase = selectRagQualityCasesForQuestion("unsupported-coffee-machine")[0];

  it("runs the exact retrieval then quality population with unchanged scorer and report output", async () => {
    const retrievalCase = runnerRetrievalCase();
    const searchOutput = runnerSearchOutput();
    const answerOutput = runnerUnsupportedAnswer();
    const ownerId = "bound-quality-owner";
    const directRetrieval = await runRetrievalQualityCases({
      cases: [retrievalCase], ownerId, forceEmbedding: false, evaluatorRetry,
      search: async () => searchOutput,
    });
    const directRag = await runRagQualityCases({
      cases: [qualityCase], ownerId, evaluatorRetry, costRates: null, crossRegionRunner: false,
      answer: async () => answerOutput,
    });
    const expectedReport = buildEvalQualityReport({
      generatedAt, retrievalResults: directRetrieval.results, ragResults: directRag.results,
      providerMode: "offline", runContext, crossRegionRunner: false,
    });

    const search = vi.fn(async () => searchOutput);
    const answer = vi.fn(async () => answerOutput);
    const result = await runBoundEvalQualityWorkload({
      retrievalCases: [retrievalCase], qualityCases: [qualityCase],
      ownerId,
      globalForceEmbedding: false, evaluatorRetry, costRates: null, providerMode: "offline",
      runContext, crossRegionRunner: false, generatedAt, search, answer,
    });

    expect(search).toHaveBeenCalledOnce();
    expect(search).toHaveBeenCalledWith({
      query: retrievalCase.query,
      ownerId,
      topK: 10,
      minSimilarity: 0.12,
      skipCache: true,
      forceEmbedding: false,
    }, { kind: "retrieval", ordinal: 0, id: retrievalCase.id });
    expect(answer).toHaveBeenCalledOnce();
    expect(answer).toHaveBeenCalledWith({
      query: qualityCase.question,
      ownerId,
      logQuery: false,
      skipCache: true,
    }, { kind: "quality", ordinal: 0, id: qualityCase.id });
    expect(result).toMatchObject({ kind: "u04-bound-eval-quality-workload",
      complete: true, failureLatched: false, error: null });
    expect(result.retrieval.results).toEqual(directRetrieval.results);
    expect(result.rag.results).toEqual(directRag.results);
    expect(result.retrieval.occurrences[0]?.testCase).toBe(retrievalCase);
    expect(result.rag.occurrences[0]?.testCase).toBe(qualityCase);
    expect(result.retrieval.occurrences[0]?.output).toBe(searchOutput);
    expect(result.rag.occurrences[0]?.output).toBe(answerOutput);
    expect(result.report).toEqual(expectedReport);
    expect(result.report?.run_context).toEqual(runContext);
    expect(result.report?.thresholds.ragP95LatencyMs).toBe(25_000);
    expect(result.events.map(event => `${event.address.kind}:${event.address.ordinal}:${event.event.type}`)).toEqual([
      "retrieval:0:attempt",
      "retrieval:0:success",
      "retrieval:0:case-complete",
      "quality:0:attempt",
      "quality:0:success",
      "quality:0:case-complete",
    ]);
  });

  it("keeps a retried provider failure and fallback latched after both complete outputs return", async () => {
    const searchOutput = runnerSearchOutput();
    const answerOutput = runnerUnsupportedAnswer({ fallbackReason: "provider_timeout" });
    const rateLimit = Object.assign(new Error("rate limited"), { status: 429 });
    let attempts = 0;
    const result = await runBoundEvalQualityWorkload({
      retrievalCases: [runnerRetrievalCase()], qualityCases: [qualityCase],
      globalForceEmbedding: false,
      evaluatorRetry: { maxAttempts: 2, initialDelayMs: 1, maxDelayMs: 1 },
      costRates: null, providerMode: "offline", runContext, crossRegionRunner: false, generatedAt,
      search: async () => {
        attempts += 1;
        if (attempts === 1) throw rateLimit;
        return searchOutput;
      },
      answer: async () => answerOutput,
    });

    expect(result).toMatchObject({ complete: false, failureLatched: true, error: null });
    expect(result.report).not.toBeNull();
    expect(result.retrieval.occurrences[0]?.output).toBe(searchOutput);
    expect(result.rag.occurrences[0]?.output).toBe(answerOutput);
    expect(result.events.some(event => event.event.type === "error")).toBe(true);
    expect(result.events.some(event => event.event.type === "fallback")).toBe(true);
    expect(result.events.filter(event => event.event.type === "case-complete")).toHaveLength(2);
  });

  it("retains completed retrieval and earlier quality outputs when a later quality call throws", async () => {
    const retrievalOutput = runnerSearchOutput();
    const firstAnswer = runnerUnsupportedAnswer();
    const laterFailure = new Error("later bound quality provider failed");
    const result = await runBoundEvalQualityWorkload({
      retrievalCases: [runnerRetrievalCase()], qualityCases: [qualityCase, qualityCase],
      globalForceEmbedding: false, evaluatorRetry, costRates: null, providerMode: "offline",
      runContext, crossRegionRunner: false, generatedAt,
      search: async () => retrievalOutput,
      answer: async (_input, address) => {
        if (address.ordinal === 0) return firstAnswer;
        throw laterFailure;
      },
    });

    expect(result).toMatchObject({ complete: false, failureLatched: true, error: laterFailure, report: null });
    expect(result.retrieval.occurrences).toHaveLength(1);
    expect(result.retrieval.occurrences[0]?.output).toBe(retrievalOutput);
    expect(result.rag.occurrences).toHaveLength(1);
    expect(result.rag.occurrences[0]?.output).toBe(firstAnswer);
    expect(result.events.filter(event => event.event.type === "case-complete")
      .map(event => [event.address.kind, event.address.ordinal])).toEqual([["retrieval", 0], ["quality", 0]]);
    const failure = result.events.find(event =>
      event.address.kind === "quality" && event.address.ordinal === 1 && event.event.type === "case-failed");
    expect(failure?.event).toMatchObject({ type: "case-failed", stage: "provider", error: laterFailure });
  });

  it("returns unchanged report arithmetic but never marks a scored-failure workload complete", async () => {
    const failingCase = runnerRetrievalCase({ expectedQueryClass: "table_threshold" });
    const result = await runBoundEvalQualityWorkload({
      retrievalCases: [failingCase], qualityCases: [qualityCase],
      globalForceEmbedding: false, evaluatorRetry, costRates: null, providerMode: "offline",
      runContext, crossRegionRunner: false, generatedAt,
      search: async () => runnerSearchOutput(),
      answer: async () => runnerUnsupportedAnswer(),
    });

    expect(result.report).not.toBeNull();
    expect(result).toMatchObject({ complete: false, failureLatched: true, error: null });
    expect(result.report).toEqual(buildEvalQualityReport({
      generatedAt, retrievalResults: [...result.retrieval.results], ragResults: [...result.rag.results],
      providerMode: "offline", runContext, crossRegionRunner: false,
    }));
    expect(result.events.some(event => event.event.type === "case-failed" &&
      event.address.kind === "retrieval" && event.address.ordinal === 0)).toBe(true);
  });
});
