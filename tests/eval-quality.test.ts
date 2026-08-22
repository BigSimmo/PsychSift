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
  selectRagQualityCasesForQuestion,
  sourceGovernanceResultsFromArtifact,
  sourceGovernanceDangerFailuresForAnswer,
  sourceWarningsForRagQualityAnswer,
  type RagQualityResult,
} from "../scripts/eval-quality";
import { evaluateGoldenRetrievalCase, type GoldenRetrievalResult } from "../scripts/eval-retrieval";

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
    // None of these three ids is in the allowance, so every one is named as unaccounted. The
    // gate reports WHICH case degraded and why, not merely how many did.
    expect(report.blocking_threshold_failures).toEqual(
      expect.arrayContaining([
        expect.stringContaining("RAG source_backed_review_fallback unaccounted:"),
        expect.stringContaining("agitation-arousal-typo-dosing"),
      ]),
    );
    expect(renderEvalQualityMarkdown(report)).toContain("| Source-backed review fallbacks | 3 |");
    expect(renderEvalQualityMarkdown(report)).toContain("| Substantive grounded answers | 2 |");
  });

  // The substitution a bare count cannot see (Codex P1 on PR #2301). The two conversions canary
  // 32589154243 attributed to `guidance_wrapper_fragment` are accounted for; swap one of them for
  // an unrelated case and the total is still 2, while grounded_supported_rate absorbs a single
  // swap in a run this size. Keying the allowance by case id AND reason is what makes the swap
  // visible.
  it("accounts for the allowed fallbacks by case id and reason, not by how many there are", () => {
    const allowed = buildEvalQualityReport({
      generatedAt: "2026-08-22T00:00:00.000Z",
      retrievalResults: [],
      ragResults: [
        ragResult({
          id: "quality-antipsychotic-metabolic-monitoring",
          routingReason:
            "high_confidence_extractive_retrieval; source_backed_review_fallback; final_quality_gate:guidance_wrapper_fragment",
        }),
        ragResult({
          id: "quality-discharge-documentation",
          routingReason:
            "high_confidence_extractive_retrieval; source_backed_review_fallback; final_quality_gate:guidance_wrapper_fragment",
        }),
      ],
    });
    expect(allowed.rag.summary.source_backed_review_fallback_count).toBe(2);
    expect(allowed.rag.summary.source_backed_review_fallback_unaccounted).toEqual([]);
    expect(allowed.blocking_threshold_failures).not.toEqual(
      expect.arrayContaining([expect.stringContaining("source_backed_review_fallback")]),
    );

    // Same count, one substituted case: the old count-based gate passed this.
    const substituted = buildEvalQualityReport({
      generatedAt: "2026-08-22T00:00:00.000Z",
      retrievalResults: [],
      ragResults: [
        ragResult({
          id: "quality-discharge-documentation",
          routingReason:
            "high_confidence_extractive_retrieval; source_backed_review_fallback; final_quality_gate:guidance_wrapper_fragment",
        }),
        ragResult({
          id: "quality-lithium-toxicity-action",
          routingReason:
            "high_confidence_extractive_retrieval; source_backed_review_fallback; extractive_quality_gate:missing_query_overlap",
        }),
      ],
    });
    expect(substituted.rag.summary.source_backed_review_fallback_count).toBe(2);
    expect(substituted.rag.summary.source_backed_review_fallback_unaccounted).toEqual([
      "quality-lithium-toxicity-action (high_confidence_extractive_retrieval; source_backed_review_fallback; extractive_quality_gate:missing_query_overlap)",
    ]);
    expect(substituted.blocking_threshold_failures).toEqual(
      expect.arrayContaining([expect.stringContaining("quality-lithium-toxicity-action")]),
    );

    // An allowed case degrading for a DIFFERENT reason is also unaccounted: the allowance
    // covers one specific defect, not that case in perpetuity.
    const otherReason = buildEvalQualityReport({
      generatedAt: "2026-08-22T00:00:00.000Z",
      retrievalResults: [],
      ragResults: [
        ragResult({
          id: "quality-antipsychotic-metabolic-monitoring",
          routingReason:
            "high_confidence_extractive_retrieval; source_backed_review_fallback; extractive_quality_gate:missing_query_overlap",
        }),
      ],
    });
    expect(otherReason.rag.summary.source_backed_review_fallback_unaccounted).toHaveLength(1);
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
