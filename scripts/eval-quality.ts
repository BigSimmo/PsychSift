import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadEnvConfig } from "@next/env";

import {
  capturedRagCaseToGoldenCase,
  evaluateGoldenRetrievalCase,
  loadGoldenRetrievalCases,
  retrievalLimitForGoldenCase,
  summarizeGoldenRetrievalResults,
  type GoldenRetrievalResult,
} from "./eval-retrieval";
import {
  estimateCostUsd,
  loadAdminClient,
  percentile,
  resolveEvalOwnerId,
  validateRagAnswer,
  withProviderBackoff,
} from "./eval-utils";
import {
  loadCapturedRagEvalCases,
  mergeRagEvalCases,
  ragEvalCases,
  selectRagEvalCases,
  type RagEvalCase,
  type SupabaseEvalCaseClient,
} from "@/lib/rag/rag-eval-cases";
import { sourceGovernanceWarnings } from "@/lib/source-governance";
import { answerRouteBudgetMs } from "@/lib/rag/rag-route-budget";
import type { AnswerRouteMode } from "@/lib/rag/rag-routing";
import type { RagAnswer } from "@/lib/types";
import { buildRagDiagnosticDumpRecord, resolveLocalDiagnosticOutputPath } from "./eval-answer-quality";

loadEnvConfig(process.cwd());

export type EvalQualityProviderMode = "openai" | "offline";

type EvalQualityArgs = {
  fixture: string;
  sourceGovernanceResults?: string;
  ownerEmail?: string;
  ownerId?: string;
  limit?: number;
  query?: string;
  question?: string;
  dumpRagCases?: string;
  outputDir: string;
  sourceMetadataDebt?: string;
  json: boolean;
  failOnThreshold: boolean;
  retrievalOnly: boolean;
  ragOnly: boolean;
  skipPreflight: boolean;
  forceEmbedding: boolean;
  providerMode: EvalQualityProviderMode;
};

export type RagQualityResult = {
  id: string;
  question: string;
  category: RagEvalCase["category"];
  supported: boolean;
  expectedFiles: string[];
  matchedFiles: string[];
  missingFiles: string[];
  topFiles: string[];
  expectedHit: boolean;
  grounded: boolean;
  acceptSourceOnly?: boolean;
  latencyMs: number;
  searchLatencyMs?: number;
  generationLatencyMs?: number;
  rpcLatencyMs?: number;
  embeddingLatencyMs?: number;
  route: string;
  latencyRoute: string;
  model: string | null;
  citations: number;
  visualEvidence: number;
  failures: string[];
  sourceWarningCount: number;
  sourceDangerWarningCount: number;
  unverifiedNumericTokenCount: number;
  hasFaithfulnessWarning: boolean;
  routingReason?: string;
  timings?: {
    retrievalMs: number;
    routingMs: number;
    generationMs: number;
    verificationMs: number;
    totalMs: number;
    routeBudgetMs: number;
    routeDeadlineExceeded: boolean;
    budgetExhaustedByRetrieval?: boolean;
  };
  routeCeilingExceeded?: boolean;
  executionType: "cached" | "api" | "rule-based";
  estimatedCostUsd: number | null;
  openAIRequestIds?: string[];
  openAIUsage?: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
  };
};

export type QualityFailureCategory =
  | "query_class"
  | "expected_source"
  | "expected_content"
  | "table_evidence"
  | "grounding"
  | "unsupported_correctness"
  | "citation"
  | "visual_evidence"
  | "latency"
  | "numeric_grounding"
  | "source_governance"
  | "other";

export type EvalQualityReport = ReturnType<typeof buildEvalQualityReport>;

export type EvalQualityRunContext = {
  git_sha: string | null;
  github_run_id: string | null;
  github_run_attempt: string | null;
  latency_context: string;
};

export function evalQualityRunContext(env: Record<string, string | undefined> = process.env): EvalQualityRunContext {
  return {
    git_sha: env.EVAL_GIT_SHA?.trim() || env.GITHUB_SHA?.trim() || null,
    github_run_id: env.GITHUB_RUN_ID?.trim() || null,
    github_run_attempt: env.GITHUB_RUN_ATTEMPT?.trim() || null,
    latency_context: env.EVAL_LATENCY_CONTEXT?.trim() || "default",
  };
}

export type SourceMetadataDebtAcceptance = {
  path?: string;
  accepted_by: string;
  accepted_at: string;
  expires_at?: string;
  reason: string;
  max_stale_rate: number;
  max_review_required_rate: number;
  max_outdated_top_results: number;
  max_poor_extraction_top_results: number;
  max_source_governance_danger_failure_rate: number;
};

export function sourceWarningsForRagQualityAnswer(
  answer: Pick<RagAnswer, "sourceGovernanceWarnings" | "sources" | "relevance">,
) {
  return (
    answer.sourceGovernanceWarnings ??
    sourceGovernanceWarnings({ results: answer.sources, relevance: answer.relevance })
  );
}

export function deliveredGroundedAfterSourceGovernancePolicy(
  answer: Pick<RagAnswer, "grounded" | "confidence" | "responseMode">,
  warnings: Array<{ severity: string }>,
) {
  const shouldUseSourceGovernanceRefusal =
    answer.grounded !== false && answer.confidence !== "unsupported" && answer.responseMode !== "evidence_gap";
  if (shouldUseSourceGovernanceRefusal && warnings.some((warning) => warning.severity === "danger")) return false;
  return answer.grounded;
}

const crossRegionRunnerLatencyContext = process.env.EVAL_LATENCY_CONTEXT === "cross-region-runner";

export function ragAnswerTimingDiagnostics(
  answer: Pick<RagAnswer, "latencyTimings" | "routingMode">,
  options?: { crossRegionRunner?: boolean },
) {
  const latencyTimings = answer.latencyTimings;
  const answerRoute = answer.routingMode ?? "unsupported";
  const defaultRouteBudgetMs = answerRouteBudgetMs[answerRoute as AnswerRouteMode] ?? 0;
  const routeBudgetMs = latencyTimings?.route_budget_ms ?? defaultRouteBudgetMs;
  const totalMs = latencyTimings?.total_latency_ms ?? 0;
  const generationMs = latencyTimings?.generation_latency_ms ?? 0;
  const routeDeadlineExceeded = latencyTimings?.route_deadline_exceeded ?? false;
  const budgetExhaustedByRetrieval = latencyTimings?.route_budget_exhausted_by_retrieval ?? false;
  const crossRegionRunner = options?.crossRegionRunner ?? crossRegionRunnerLatencyContext;
  // Cross-region carve-out (E-3b): when GitHub's US runner spends the whole route budget on
  // retrieval alone and the runtime then behaves optimally (zero generation), the ceiling is
  // runner geography, not a runtime regression. Requires ALL THREE: the sanctioned cross-region
  // context, the runtime's own authoritative flag, and no generation time. Local/release
  // contexts (EVAL_LATENCY_CONTEXT unset) are unaffected — the gate is not weakened there.
  const ceilingExcusedByCrossRegionRetrieval = crossRegionRunner && budgetExhaustedByRetrieval && generationMs === 0;
  return {
    timings: {
      retrievalMs: latencyTimings?.retrieval_latency_ms ?? latencyTimings?.search_latency_ms ?? 0,
      routingMs: latencyTimings?.routing_latency_ms ?? 0,
      generationMs,
      verificationMs: latencyTimings?.verification_latency_ms ?? 0,
      totalMs,
      routeBudgetMs,
      routeDeadlineExceeded,
      budgetExhaustedByRetrieval,
    },
    routeCeilingExceeded: ceilingExcusedByCrossRegionRetrieval
      ? false
      : routeDeadlineExceeded || (routeBudgetMs === 0 ? generationMs > 0 : totalMs > routeBudgetMs),
  };
}

const qualityThresholds = {
  retrievalTopKHitRate: 0.8,
  retrievalDocumentRecallAt5: 0.8,
  retrievalContentRecallAt5: 0.8,
  ragGroundedSupportedRate: 0.9,
  ragUnsupportedCorrectRate: 1,
  ragCitationFailureRate: 0,
  // A source-backed review fallback is a DEGRADED answer, not a defective one: the written
  // answer failed a quality gate, so the reader is shown the cited documents instead of prose
  // that cannot be checked against them. A threshold of 0 encoded the opposite assumption —
  // that any degradation is a failure — which only held while the quality gates were missing
  // the answers they should have caught. Packet 2 of #231 (PR #2285, ledger #NPQJKP) added the
  // `guidance_wrapper_fragment` predicate, and canary run 32589154243 (2026-08-22) converted
  // exactly the two answers it was built for — `antipsychotic-metabolic-monitoring` and
  // `discharge-documentation`, both `final_quality_gate:guidance_wrapper_fragment` — from
  // fluent non-sentences into source pointers. That is the gate working, so a permanently red
  // weekly canary would teach us to ignore it.
  //
  // The allowance is keyed by CASE ID AND REASON, never by a bare count. A count of 2 would let
  // a substitution through: one named case recovers while an unrelated supported case starts
  // returning a review stub, the total stays at 2, and `ragGroundedSupportedRate` (0.9) absorbs
  // a single swap in a 30-44 case run, so neither gate fires. Keying both dimensions means the
  // gate answers "are these the degradations we accounted for?" rather than "how many are there?".
  //
  // Do not add an entry to clear a red run. A block here names the offending case and reason:
  // investigate that case, exactly as canary 32589154243 did for these two.
  ragSourceBackedReviewFallbackAllowance: [
    { id: "quality-antipsychotic-metabolic-monitoring", reason: "guidance_wrapper_fragment" },
    { id: "quality-discharge-documentation", reason: "guidance_wrapper_fragment" },
  ] as ReadonlyArray<{ id: string; reason: string }>,
  numericGroundingFailureRate: 0,
  staleTopResultRate: 0.25,
  reviewRequiredTopResultRate: 0.25,
  // Latency gates default to the strict near-region ceilings that release and
  // local runs are held to. The Eval Canary measures from cross-region GitHub
  // runners → Sydney Supabase + OpenAI, where a real grounded answer pays full
  // generation time (issue #459 post-#606: quality metrics perfect, p95
  // measured 48,256ms) — that workflow opts into the wider allowance by setting
  // EVAL_LATENCY_CONTEXT=cross-region-runner, so eval:quality:release keeps the
  // strict gate. User-facing latency is enforced separately by the answer SLO
  // deep probe, not this eval.
  ragP95LatencyMs: crossRegionRunnerLatencyContext ? 60_000 : 25_000,
  ragRouteP95LatencyMs: {
    // Refusals must stay fast — a slow refusal means the pipeline burned generation time
    // before giving up, which is exactly the waste mode #580 eliminated.
    unsupported: 4_000,
    // Direct source-stitching with no model generation. Generation-fallback chains no
    // longer land in this bucket (see "fallback" below), so the runner allowance only
    // needs cross-region RPC headroom — not the blanket 60s that pre-fallback-bucket
    // calibration required — and a no-model extraction slowdown stays visible.
    extractive: crossRegionRunnerLatencyContext ? 35_000 : 12_000,
    fast: 25_000,
    // Generation-fallback chains (latencyRouteForAnswer buckets any answer whose routing
    // reason records a generation_fallback here): the failed generation spends up to
    // OPENAI_ANSWER_TIMEOUT_MS (30s) before the source-backed fallback stitches an
    // answer. Timeout-dominated, so the budget is region-insensitive.
    fallback: 50_000,
    // Strong may retry a truncated generation at a larger budget (self-heal) = up to two
    // sequential generations; near-region runs keep the strict single-generation gate.
    strong: crossRegionRunnerLatencyContext ? 60_000 : 35_000,
  } as Record<string, number>,
};

export function parseEvalQualityArgs(argv: string[]): EvalQualityArgs {
  const args: EvalQualityArgs = {
    fixture: join(process.cwd(), "scripts", "fixtures", "rag-retrieval-golden.json"),
    ownerEmail: process.env.RAG_EVAL_OWNER_EMAIL,
    ownerId: process.env.RAG_EVAL_OWNER_ID ?? process.env.LOCAL_NO_AUTH_OWNER_ID,
    outputDir: join(process.cwd(), "output", "evals"),
    json: false,
    failOnThreshold: false,
    retrievalOnly: false,
    ragOnly: false,
    skipPreflight: false,
    forceEmbedding: false,
    providerMode: "openai",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;

    if (token === "--json") {
      args.json = true;
      continue;
    }
    if (token === "--fail-on-threshold") {
      args.failOnThreshold = true;
      continue;
    }
    if (token === "--retrieval-only") {
      args.retrievalOnly = true;
      continue;
    }
    if (token === "--rag-only") {
      args.ragOnly = true;
      continue;
    }
    if (token === "--skip-preflight") {
      args.skipPreflight = true;
      continue;
    }
    if (token === "--force-embedding") {
      args.forceEmbedding = true;
      continue;
    }

    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${token}`);
    index += 1;

    if (token === "--fixture") args.fixture = value;
    if (token === "--source-governance-results") args.sourceGovernanceResults = value;
    if (token === "--owner-email") args.ownerEmail = value;
    if (token === "--owner-id") args.ownerId = value;
    if (token === "--limit") args.limit = Number.parseInt(value, 10);
    if (token === "--query") args.query = value;
    if (token === "--question") args.question = value;
    if (token === "--dump-rag-cases") args.dumpRagCases = value;
    if (token === "--output-dir") args.outputDir = value;
    if (token === "--source-metadata-debt") args.sourceMetadataDebt = value;
    if (token === "--provider-mode") {
      if (value !== "openai" && value !== "offline") {
        throw new Error("--provider-mode must be openai or offline.");
      }
      args.providerMode = value;
    }
  }

  if (args.retrievalOnly && args.ragOnly) throw new Error("Use only one of --retrieval-only or --rag-only.");
  if (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit <= 0)) {
    throw new Error("--limit must be a positive integer.");
  }
  if (args.dumpRagCases && !args.ragOnly) {
    throw new Error("--dump-rag-cases requires --rag-only.");
  }
  if (args.dumpRagCases) resolveLocalDiagnosticOutputPath(args.dumpRagCases);

  return args;
}

export function selectRagQualityCasesForQuestion(question?: string) {
  if (!question) return selectRagEvalCases({});
  const exactCase = ragEvalCases.find((testCase) => testCase.id === question.trim());
  return exactCase ? [exactCase] : selectRagEvalCases({ question });
}

export function configureEvalProviderEnvironment(providerMode: EvalQualityProviderMode) {
  process.env.RAG_PROVIDER_MODE = providerMode;
  if (providerMode !== "offline") return;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_ORG_ID;
  delete process.env.OPENAI_PROJECT_ID;
}

export function retrievalCasesForProviderMode<T extends { forceEmbedding?: boolean }>(
  cases: T[],
  providerMode: EvalQualityProviderMode,
) {
  return providerMode === "offline" ? cases.filter((testCase) => !testCase.forceEmbedding) : cases;
}

export function qualityFailureCategory(message: string): QualityFailureCategory {
  const normalized = message.toLowerCase();
  if (normalized.includes("query class")) return "query_class";
  if (normalized.includes("expected document") || normalized.includes("retrieved sources")) return "expected_source";
  if (normalized.includes("expected content")) return "expected_content";
  if (normalized.includes("table evidence") || normalized.includes("visual evidence")) {
    return normalized.includes("visual evidence") ? "visual_evidence" : "table_evidence";
  }
  if (normalized.includes("grounded answer")) return "grounding";
  if (normalized.includes("unsupported answer") || normalized.includes("false-positive"))
    return "unsupported_correctness";
  if (normalized.includes("citation")) return "citation";
  if (normalized.includes("latency")) return "latency";
  if (normalized.includes("numeric") || normalized.includes("faithfulness") || normalized.includes("verify against")) {
    return "numeric_grounding";
  }
  if (
    normalized.includes("source governance") ||
    normalized.includes("outdated") ||
    normalized.includes("unverified")
  ) {
    return "source_governance";
  }
  return "other";
}

export function sourceGovernanceDangerFailuresForAnswer(args: {
  grounded: boolean;
  sourceDangerWarningCount: number;
  expectsDangerWarning?: boolean;
}): string[] {
  const failures: string[] = [];
  // A danger warning is a governance failure only when a grounded answer was
  // actually delivered on that sourcing. Declined answers carry the danger
  // warning as the expected refusal signal, not a failure. `grounded` is the
  // robust signal for "an answer was delivered": it covers both `unsupported`
  // routes and answers that a fast/strong/extractive route converted into an
  // evidence-gap refusal (finalizeRagAnswerQualityCore sets grounded=false
  // while preserving the original routingMode).
  if (args.grounded && args.sourceDangerWarningCount > 0) {
    failures.push("danger source governance warning present");
  }
  // Refusal-safety guard: exempting ungrounded answers above must not let a
  // refusal that is *expected* to surface a danger warning pass as clean when it
  // silently drops that warning. For cases flagged expectsSourceDangerWarning,
  // a missing danger warning is a failure regardless of grounded — otherwise a
  // regression that stops emitting the warning would keep the danger failure
  // rate at 0 and go undetected.
  if (args.expectsDangerWarning && args.sourceDangerWarningCount === 0) {
    failures.push("expected danger source governance warning missing");
  }
  return failures;
}

function rate(numerator: number, denominator: number) {
  return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(4));
}

function isSourceBackedReviewFallback(routingReason: string | undefined) {
  return (routingReason ?? "")
    .split(";")
    .some((reason) => reason.trim().toLowerCase() === "source_backed_review_fallback");
}

function failureCategoryCounts(results: Array<{ failures: string[] }>) {
  return results.reduce<Record<QualityFailureCategory, number>>(
    (counts, result) => {
      for (const failure of result.failures) {
        const category = qualityFailureCategory(failure);
        counts[category] = (counts[category] ?? 0) + 1;
      }
      return counts;
    },
    {} as Record<QualityFailureCategory, number>,
  );
}

function isSourceMetadataDebtThresholdFailure(failure: string) {
  return failure.startsWith("top-result stale_rate") || failure.startsWith("top-result review_required_rate");
}

function isIsoDateString(value: string) {
  return !Number.isNaN(Date.parse(value));
}

function evaluateSourceMetadataDebtAcceptance(args: {
  acceptance?: SourceMetadataDebtAcceptance;
  thresholdFailures: string[];
  governance: ReturnType<typeof topResultGovernanceCounts>;
  ragSummary: ReturnType<typeof summarizeRagQualityResults>;
}) {
  const metadataFailures = args.thresholdFailures.filter(isSourceMetadataDebtThresholdFailure);
  const rejectionReasons: string[] = [];

  if (!args.acceptance) {
    return {
      status: "not_requested" as const,
      accepted_failures: [] as string[],
      rejection_reasons: rejectionReasons,
    };
  }

  const acceptance = args.acceptance;
  if (!acceptance.accepted_by.trim()) rejectionReasons.push("accepted_by is required");
  if (!acceptance.reason.trim()) rejectionReasons.push("reason is required");
  if (!isIsoDateString(acceptance.accepted_at)) rejectionReasons.push("accepted_at must be an ISO-compatible date");
  if (acceptance.expires_at) {
    if (!isIsoDateString(acceptance.expires_at)) {
      rejectionReasons.push("expires_at must be an ISO-compatible date");
    } else if (Date.parse(acceptance.expires_at) < Date.now()) {
      rejectionReasons.push(`acceptance expired at ${acceptance.expires_at}`);
    }
  }
  if (args.governance.stale_rate > acceptance.max_stale_rate) {
    rejectionReasons.push(
      `stale rate ${args.governance.stale_rate} exceeds accepted ceiling ${acceptance.max_stale_rate}`,
    );
  }
  if (args.governance.review_required_rate > acceptance.max_review_required_rate) {
    rejectionReasons.push(
      `review-required rate ${args.governance.review_required_rate} exceeds accepted ceiling ${acceptance.max_review_required_rate}`,
    );
  }
  if (args.governance.stale_top_results > acceptance.max_outdated_top_results) {
    rejectionReasons.push(
      `outdated top results ${args.governance.stale_top_results} exceeds accepted ceiling ${acceptance.max_outdated_top_results}`,
    );
  }
  if (args.governance.poor_extraction_top_results > acceptance.max_poor_extraction_top_results) {
    rejectionReasons.push(
      `poor-extraction top results ${args.governance.poor_extraction_top_results} exceeds accepted ceiling ${acceptance.max_poor_extraction_top_results}`,
    );
  }
  const acceptedFailures = rejectionReasons.length === 0 ? metadataFailures : [];
  return {
    status: rejectionReasons.length > 0 ? ("rejected" as const) : ("accepted" as const),
    path: acceptance.path,
    accepted_by: acceptance.accepted_by,
    accepted_at: acceptance.accepted_at,
    expires_at: acceptance.expires_at,
    reason: acceptance.reason,
    accepted_failures: acceptedFailures,
    rejection_reasons: rejectionReasons,
  };
}

function topResultGovernanceCounts(results: GoldenRetrievalResult[]) {
  let total = 0;
  let stale = 0;
  let reviewDue = 0;
  let unknown = 0;
  let unverified = 0;
  let unknownExtraction = 0;
  let poorExtraction = 0;
  let reviewRequired = 0;

  for (const result of results) {
    for (const topResult of result.topResults) {
      total += 1;
      const status = topResult.document_status ?? "unknown";
      const validation = topResult.clinical_validation_status ?? "unverified";
      const extraction = topResult.extraction_quality ?? "unknown";
      if (status === "outdated") stale += 1;
      if (status === "review_due") reviewDue += 1;
      if (status === "unknown") unknown += 1;
      if (validation === "unverified") unverified += 1;
      if (extraction === "unknown") unknownExtraction += 1;
      if (extraction === "poor") poorExtraction += 1;
      if (
        status === "outdated" ||
        status === "review_due" ||
        status === "unknown" ||
        validation === "unverified" ||
        extraction === "unknown" ||
        extraction === "poor"
      ) {
        reviewRequired += 1;
      }
    }
  }

  return {
    total_top_results: total,
    stale_top_results: stale,
    review_due_top_results: reviewDue,
    unknown_status_top_results: unknown,
    unverified_top_results: unverified,
    unknown_extraction_top_results: unknownExtraction,
    poor_extraction_top_results: poorExtraction,
    stale_rate: rate(stale, total),
    stale_review_unknown_rate: rate(stale + reviewDue + unknown, total),
    review_required_top_results: reviewRequired,
    review_required_rate: rate(reviewRequired, total),
    metadata_policy:
      "unknown, unverified, review_due, outdated, unknown extraction, and poor extraction metadata are treated as review-required; do not silently default them to current or approved.",
  };
}

function summarizeRagQualityResults(results: RagQualityResult[], providerMode: EvalQualityProviderMode) {
  const supported = results.filter((result) => result.supported);
  const unsupported = results.filter((result) => !result.supported);
  // A supported case counts as grounded-supported when it grounds, OR — for
  // acceptSourceOnly cases (diffuse questions with no single authoritative source) —
  // when it returns a source-only answer that still cites the expected documents.
  // Requiring expectedHit keeps the guard honest: a real retrieval regression that
  // stops surfacing the expected docs is NOT accepted and still drags the rate below
  // threshold, hard-failing the canary.
  const groundedSupported = supported.filter((result) => {
    if (providerMode === "offline") {
      return result.model === null && result.expectedHit && result.citations > 0;
    }
    return result.grounded || (result.acceptSourceOnly && result.expectedHit && result.citations > 0);
  }).length;
  const unsupportedCorrect = unsupported.filter((result) => !result.grounded).length;
  const citationFailures = results.filter((result) =>
    result.failures.some((failure) => qualityFailureCategory(failure) === "citation"),
  );
  const numericFailures = results.filter(
    (result) =>
      result.unverifiedNumericTokenCount > 0 ||
      result.hasFaithfulnessWarning ||
      result.failures.some((failure) => qualityFailureCategory(failure) === "numeric_grounding"),
  );
  const sourceGovernanceWarnings = results.filter((result) => result.sourceWarningCount > 0);
  const sourceGovernanceDangerFailures = results.filter(
    (result) => result.grounded && result.sourceDangerWarningCount > 0,
  );
  const expectedDangerWarningMissing = results.filter((result) =>
    result.failures.includes("expected danger source governance warning missing"),
  ).length;
  const routeCeilingFailures = results.filter((result) => result.routeCeilingExceeded).length;
  const generationFallbacks = results.filter((result) =>
    /(?:^|;\s*)generation_fallback:/i.test(result.routingReason ?? ""),
  ).length;
  const sourceBackedReviewFallbackResults = results.filter((result) =>
    isSourceBackedReviewFallback(result.routingReason),
  );
  const sourceBackedReviewFallbacks = sourceBackedReviewFallbackResults.length;
  // Every fallback that the allowance does not account for, by BOTH its case id and the quality
  // reason that produced it. Reported as data so the threshold check can name what to investigate
  // instead of printing a count that cannot say which case moved.
  const sourceBackedReviewFallbackUnaccounted = sourceBackedReviewFallbackResults
    .filter(
      (result) =>
        !qualityThresholds.ragSourceBackedReviewFallbackAllowance.some(
          (allowed) => allowed.id === result.id && (result.routingReason ?? "").toLowerCase().includes(allowed.reason),
        ),
    )
    .map((result) => `${result.id} (${result.routingReason ?? "no routing reason"})`)
    .sort();
  const substantiveGrounded = supported.filter(
    (result) => result.grounded === true && !isSourceBackedReviewFallback(result.routingReason),
  ).length;
  const comparisonSourceExtractiveFallbacks = results.filter((result) =>
    /(?:^|;\s*)comparison_source_extractive_fallback(?:;|$)/i.test(result.routingReason ?? ""),
  ).length;
  const latencies = results.map((result) => result.latencyMs);
  const routeLatencyP95 = Object.fromEntries(
    Array.from(
      results.reduce((accumulator, result) => {
        const current = accumulator.get(result.latencyRoute) ?? [];
        current.push(result.latencyMs);
        accumulator.set(result.latencyRoute, current);
        return accumulator;
      }, new Map<string, number[]>()),
    ).map(([route, routeLatencies]) => [route, percentile(routeLatencies, 95)]),
  );
  const estimatedCostUsd = results.some((result) => result.estimatedCostUsd === null)
    ? null
    : results.reduce((sum, result) => sum + (result.estimatedCostUsd ?? 0), 0);

  return {
    case_count: results.length,
    supported_count: supported.length,
    unsupported_count: unsupported.length,
    grounded_supported_rate: rate(groundedSupported, supported.length),
    unsupported_correct_rate: rate(unsupportedCorrect, unsupported.length),
    expected_hit_rate: rate(results.filter((result) => result.expectedHit).length, results.length),
    citation_failure_rate: rate(citationFailures.length, results.length),
    numeric_grounding_failure_rate: rate(numericFailures.length, results.length),
    source_warning_count: results.reduce((sum, result) => sum + result.sourceWarningCount, 0),
    source_governance_warning_rate: rate(sourceGovernanceWarnings.length, results.length),
    source_governance_danger_failure_rate: rate(sourceGovernanceDangerFailures.length, results.length),
    expected_danger_warning_missing_count: expectedDangerWarningMissing,
    route_ceiling_failure_count: routeCeilingFailures,
    generation_fallback_count: generationFallbacks,
    source_backed_review_fallback_count: sourceBackedReviewFallbacks,
    source_backed_review_fallback_unaccounted: sourceBackedReviewFallbackUnaccounted,
    source_backed_review_fallback_rate: rate(sourceBackedReviewFallbacks, results.length),
    substantive_grounded_count: substantiveGrounded,
    substantive_grounded_rate: rate(substantiveGrounded, supported.length),
    comparison_source_extractive_fallback_count: comparisonSourceExtractiveFallbacks,
    median_latency_ms: percentile(latencies, 50),
    p95_latency_ms: percentile(latencies, 95),
    route_p95_latency_ms: routeLatencyP95,
    estimated_cost_usd: estimatedCostUsd === null ? null : Number(estimatedCostUsd.toFixed(6)),
    failure_category_counts: failureCategoryCounts(results),
    failed_cases: results.filter((result) => result.failures.length > 0),
  };
}

export function buildEvalQualityReport(args: {
  generatedAt?: string;
  retrievalResults: GoldenRetrievalResult[];
  sourceGovernanceResults?: GoldenRetrievalResult[];
  ragResults: RagQualityResult[];
  sourceMetadataDebtAcceptance?: SourceMetadataDebtAcceptance;
  providerMode?: EvalQualityProviderMode;
}) {
  const providerMode = args.providerMode ?? "openai";
  const retrievalSummary = summarizeGoldenRetrievalResults(args.retrievalResults);
  const ragSummary = summarizeRagQualityResults(args.ragResults, providerMode);
  // `--rag-only` intentionally leaves retrieval metrics and gates empty. The
  // canary can still supply the preceding golden-retrieval artifact so this
  // report renders its source-governance metadata without rerunning retrieval
  // or changing the answer gate's pass/fail contract.
  const governance = topResultGovernanceCounts(args.sourceGovernanceResults ?? args.retrievalResults);
  const thresholdFailures: string[] = [];
  const providerEvidence = {
    mode: providerMode,
    model_case_count: args.ragResults.filter((result) => Boolean(result.model)).length,
    openai_request_id_count: args.ragResults.reduce((sum, result) => sum + (result.openAIRequestIds?.length ?? 0), 0),
    token_usage_case_count: args.ragResults.filter((result) => {
      const usage = result.openAIUsage;
      return Boolean(usage && usage.inputTokens + usage.cachedInputTokens + usage.outputTokens > 0);
    }).length,
    nonzero_cost_case_count: args.ragResults.filter((result) => (result.estimatedCostUsd ?? 0) > 0).length,
    generation_latency_case_count: args.ragResults.filter(
      (result) => (result.generationLatencyMs ?? result.timings?.generationMs ?? 0) > 0,
    ).length,
  };
  if (providerMode === "offline") {
    for (const [key, count] of Object.entries(providerEvidence)) {
      if (key === "mode" || count === 0) continue;
      thresholdFailures.push(`offline provider invariant ${key} ${count} above 0`);
    }
  }

  if (args.retrievalResults.length > 0) {
    if (retrievalSummary.top_k_hit_rate < qualityThresholds.retrievalTopKHitRate) {
      thresholdFailures.push(
        `retrieval top_k_hit_rate ${retrievalSummary.top_k_hit_rate} below ${qualityThresholds.retrievalTopKHitRate}`,
      );
    }
    if (retrievalSummary.document_recall_at_5 < qualityThresholds.retrievalDocumentRecallAt5) {
      thresholdFailures.push(
        `retrieval document_recall_at_5 ${retrievalSummary.document_recall_at_5} below ${qualityThresholds.retrievalDocumentRecallAt5}`,
      );
    }
    if (retrievalSummary.content_recall_at_5 < qualityThresholds.retrievalContentRecallAt5) {
      thresholdFailures.push(
        `retrieval content_recall_at_5 ${retrievalSummary.content_recall_at_5} below ${qualityThresholds.retrievalContentRecallAt5}`,
      );
    }
    if (retrievalSummary.force_embedding_failure_count > 0) {
      thresholdFailures.push(
        `retrieval force_embedding_failure_count ${retrievalSummary.force_embedding_failure_count} above 0`,
      );
    }
    if (governance.stale_rate > qualityThresholds.staleTopResultRate) {
      thresholdFailures.push(
        `top-result stale_rate ${governance.stale_rate} above ${qualityThresholds.staleTopResultRate}`,
      );
    }
    if (governance.review_required_rate > qualityThresholds.reviewRequiredTopResultRate) {
      thresholdFailures.push(
        `top-result review_required_rate ${governance.review_required_rate} above ${qualityThresholds.reviewRequiredTopResultRate}`,
      );
    }
  }

  if (args.ragResults.length > 0) {
    if (
      ragSummary.supported_count > 0 &&
      ragSummary.grounded_supported_rate < qualityThresholds.ragGroundedSupportedRate
    ) {
      thresholdFailures.push(
        `RAG grounded_supported_rate ${ragSummary.grounded_supported_rate} below ${qualityThresholds.ragGroundedSupportedRate}`,
      );
    }
    if (
      ragSummary.unsupported_count > 0 &&
      ragSummary.unsupported_correct_rate < qualityThresholds.ragUnsupportedCorrectRate
    ) {
      thresholdFailures.push(
        `RAG unsupported_correct_rate ${ragSummary.unsupported_correct_rate} below ${qualityThresholds.ragUnsupportedCorrectRate}`,
      );
    }
    if (ragSummary.citation_failure_rate > qualityThresholds.ragCitationFailureRate) {
      thresholdFailures.push(`RAG citation_failure_rate ${ragSummary.citation_failure_rate} above 0`);
    }
    if (ragSummary.source_backed_review_fallback_unaccounted.length > 0) {
      thresholdFailures.push(
        `RAG source_backed_review_fallback unaccounted: ${ragSummary.source_backed_review_fallback_unaccounted.join(", ")}`,
      );
    }
    if (ragSummary.numeric_grounding_failure_rate > qualityThresholds.numericGroundingFailureRate) {
      thresholdFailures.push(`RAG numeric_grounding_failure_rate ${ragSummary.numeric_grounding_failure_rate} above 0`);
    }
    if (ragSummary.source_governance_danger_failure_rate > 0) {
      thresholdFailures.push(
        `RAG source_governance_danger_failure_rate ${ragSummary.source_governance_danger_failure_rate} above 0`,
      );
    }
    if (ragSummary.expected_danger_warning_missing_count > 0) {
      // A refusal that was expected to surface a danger warning dropped it. This
      // is a refusal-safety regression and hard-blocks release — it is never
      // waivable via the source-metadata debt acceptance below.
      thresholdFailures.push(
        `RAG expected_danger_warning_missing_count ${ragSummary.expected_danger_warning_missing_count} above 0`,
      );
    }
    if (ragSummary.route_ceiling_failure_count > 0) {
      thresholdFailures.push(`RAG route_ceiling_failure_count ${ragSummary.route_ceiling_failure_count} above 0`);
    }
    if (ragSummary.p95_latency_ms > qualityThresholds.ragP95LatencyMs) {
      thresholdFailures.push(
        `RAG p95_latency_ms ${ragSummary.p95_latency_ms} above ${qualityThresholds.ragP95LatencyMs}`,
      );
    }
    for (const [route, maxP95] of Object.entries(qualityThresholds.ragRouteP95LatencyMs)) {
      const routeP95 = ragSummary.route_p95_latency_ms?.[route];
      if (typeof routeP95 === "number" && routeP95 > maxP95) {
        thresholdFailures.push(`RAG route ${route} p95_latency_ms ${routeP95} above ${maxP95}`);
      }
    }
  }

  const sourceMetadataDebtAcceptance = evaluateSourceMetadataDebtAcceptance({
    acceptance: args.sourceMetadataDebtAcceptance,
    thresholdFailures,
    governance,
    ragSummary,
  });
  const acceptedThresholdFailures = new Set(sourceMetadataDebtAcceptance.accepted_failures);
  const blockingThresholdFailures = thresholdFailures.filter((failure) => !acceptedThresholdFailures.has(failure));

  return {
    generated_at: args.generatedAt ?? new Date().toISOString(),
    run_context: evalQualityRunContext(),
    provider: {
      ...providerEvidence,
      passed:
        providerMode !== "offline" ||
        Object.entries(providerEvidence).every(([key, value]) => key === "mode" || value === 0),
    },
    thresholds: qualityThresholds,
    retrieval: {
      summary: retrievalSummary,
      source_governance: governance,
      failure_category_counts: failureCategoryCounts(args.retrievalResults),
      results: args.retrievalResults,
    },
    rag: {
      summary: ragSummary,
      results: args.ragResults,
    },
    threshold_failures: thresholdFailures,
    accepted_threshold_failures: sourceMetadataDebtAcceptance.accepted_failures,
    blocking_threshold_failures: blockingThresholdFailures,
    source_metadata_debt_acceptance: sourceMetadataDebtAcceptance,
  };
}

function markdownTable(rows: Array<[string, string | number | null]>) {
  return [
    "| Metric | Value |",
    "| --- | --- |",
    ...rows.map(([metric, value]) => `| ${metric} | ${value ?? "n/a"} |`),
  ].join("\n");
}

function markdownCell(value: string | number | null | undefined) {
  return String(value ?? "n/a")
    .replace(/\|/g, "\\|")
    .replace(/[\r\n]+/g, " ");
}

function ragCaseDiagnosticsTable(results: RagQualityResult[]) {
  if (results.length === 0) return "- None";
  const rows = [...results]
    .sort((left, right) => right.latencyMs - left.latencyMs)
    .map((result) =>
      [
        result.id,
        result.route,
        result.latencyRoute,
        result.routingReason,
        result.latencyMs,
        result.timings?.retrievalMs,
        result.timings?.routingMs,
        result.searchLatencyMs,
        result.generationLatencyMs,
        result.timings?.verificationMs,
        result.rpcLatencyMs,
        result.embeddingLatencyMs,
        result.timings?.routeBudgetMs,
        // "retrieval-exhausted" keeps cross-region-suppressed ceilings auditable in
        // run-over-run comparisons even though they no longer fail the gate.
        result.timings?.routeDeadlineExceeded
          ? result.timings?.budgetExhaustedByRetrieval
            ? "retrieval-exhausted"
            : "yes"
          : "no",
        result.model,
        result.failures.length > 0 ? `failed (${result.failures.length})` : "passed",
      ]
        .map(markdownCell)
        .join(" | "),
    );
  return [
    "| Case | Route | Latency SLO | Reason | Total ms | Retrieval ms | Routing ms | Search ms | Generation ms | Verification ms | RPC ms | Embedding ms | Budget ms | Deadline | Model | Result |",
    "| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |",
    ...rows.map((row) => `| ${row} |`),
  ].join("\n");
}

function latencyRouteForAnswer(answer: RagAnswer) {
  const route = answer.routingMode ?? "none";
  if ((answer.latencyTimings?.generation_latency_ms ?? 0) <= 0) return route;
  // A generation ran and failed before a source-backed answer was assembled (e.g.
  // provider_timeout -> extractive fallback). These chains structurally cost the failed
  // generation's timeout PLUS the fallback work, so they get their own latency budget
  // instead of inflating the plain fast budget, hiding inside the no-model extractive
  // one, or — for strong-classified reasons (e.g. multi_document_comparison_synthesis) —
  // blending into the strong budget. This check deliberately outranks the strong
  // classifiers below: a successful strong generation (including quality retries) never
  // records a generation_fallback, so genuine strong answers keep the strong budget.
  if (/\bgeneration_fallback:/i.test(answer.routingReason ?? "")) return "fallback";
  if (route === "strong") return "strong";
  if (
    /^(?:broad_clinical_management_synthesis|clinical_risk_or_complex_query|limited_retrieval_strength|multi_document_comparison_synthesis|retrieval_gap_or_conflict)\b/i.test(
      answer.routingReason ?? "",
    )
  ) {
    return "strong";
  }
  return "fast";
}

export function renderEvalQualityMarkdown(report: EvalQualityReport) {
  const retrieval = report.retrieval.summary;
  const governance = report.retrieval.source_governance;
  const rag = report.rag.summary;
  const failures = report.threshold_failures.length
    ? report.threshold_failures.map((item) => `- ${item}`).join("\n")
    : "- None";
  const blockingFailures = report.blocking_threshold_failures.length
    ? report.blocking_threshold_failures.map((item) => `- ${item}`).join("\n")
    : "- None";
  const acceptedFailures = report.accepted_threshold_failures.length
    ? report.accepted_threshold_failures.map((item) => `- ${item}`).join("\n")
    : "- None";
  const debtAcceptance = report.source_metadata_debt_acceptance;
  const debtAcceptanceRows =
    debtAcceptance.status === "not_requested"
      ? markdownTable([["Status", "not_requested"]])
      : markdownTable([
          ["Status", debtAcceptance.status],
          ["Accepted by", debtAcceptance.accepted_by ?? "n/a"],
          ["Accepted at", debtAcceptance.accepted_at ?? "n/a"],
          ["Expires at", debtAcceptance.expires_at ?? "n/a"],
          ["Path", debtAcceptance.path ?? "n/a"],
          ["Reason", debtAcceptance.reason ?? "n/a"],
          ["Rejection reasons", debtAcceptance.rejection_reasons.join("; ") || "none"],
        ]);
  const failedRetrieval = report.retrieval.summary.failed_cases
    .slice(0, 10)
    .map(
      (item) =>
        `- ${item.id}: ${item.failures.join("; ")}\n  Expected documents: ${
          item.expectedDocumentSubstrings.join(", ") || "none"
        }; missing: ${item.missingDocumentSubstrings.join(", ") || "none"}\n  Expected content: ${
          item.expectedContentTerms.join(", ") || "none"
        }; missing content: ${item.missingContentTerms.join(", ") || "none"}\n  Actual top files: ${
          item.topResults
            .slice(0, 5)
            .map((source) => `${source.rank}:${source.file_name}`)
            .join(" | ") || "none"
        }`,
    )
    .join("\n");
  const failedRag = report.rag.summary.failed_cases
    .slice(0, 10)
    .map(
      (item) =>
        `- ${item.id}: ${item.failures.join("; ")}\n  Expected files: ${
          item.expectedFiles.join(", ") || "none"
        }; missing: ${item.missingFiles.join(", ") || "none"}\n  Actual top files: ${
          item.topFiles.join(" | ") || "none"
        }\n  route=${item.route} grounded=${item.grounded} citations=${item.citations} numericWarnings=${
          item.unverifiedNumericTokenCount
        } faithfulnessWarning=${item.hasFaithfulnessWarning ? "yes" : "no"} sourceWarnings=${
          item.sourceWarningCount
        }\n  reason=${item.routingReason ?? "none"}\n  timings retrieval=${
          item.timings?.retrievalMs ?? "n/a"
        }ms routing=${item.timings?.routingMs ?? "n/a"}ms generation=${
          item.timings?.generationMs ?? "n/a"
        }ms verification=${item.timings?.verificationMs ?? "n/a"}ms total=${
          item.timings?.totalMs ?? item.latencyMs
        }ms budget=${item.timings?.routeBudgetMs ?? "n/a"}ms deadline=${
          item.timings?.routeDeadlineExceeded
            ? item.timings?.budgetExhaustedByRetrieval
              ? "retrieval-exhausted"
              : "yes"
            : "no"
        }`,
    )
    .join("\n");
  return `# Retrieval Quality Report

Generated: ${report.generated_at}

## Provider Profile

${markdownTable([
  ["Mode", report.provider.mode],
  ["Model cases", report.provider.model_case_count],
  ["OpenAI request IDs", report.provider.openai_request_id_count],
  ["Token-usage cases", report.provider.token_usage_case_count],
  ["Nonzero-cost cases", report.provider.nonzero_cost_case_count],
  ["Generation-latency cases", report.provider.generation_latency_case_count],
  ["Provider-free invariants", report.provider.passed ? "passed" : "failed"],
])}

## Threshold Status

Blocking failures:

${blockingFailures}

Accepted metadata-debt failures:

${acceptedFailures}

All threshold failures:

${failures}

## Source Metadata Debt Acceptance

${debtAcceptanceRows}

## Retrieval Metrics

${markdownTable([
  ["Cases", retrieval.case_count],
  ["Hit@K", retrieval.top_k_hit_rate],
  ["Document recall@5", retrieval.document_recall_at_5],
  ["Content recall@5", retrieval.content_recall_at_5],
  ["MRR@10", retrieval.mrr_at_10],
  ["nDCG@10", retrieval.ndcg_at_10],
  ["Irrelevant source rate@10", retrieval.irrelevant_source_rate_at_10],
  ["Required signal coverage@10", retrieval.required_signal_coverage_at_10],
  ["Signal metric cases", retrieval.signal_metric_case_count],
  ["Content MRR@10", retrieval.content_mrr_at_10],
  ["Content MRR cases", retrieval.content_mrr_case_count],
  ["Median latency ms", retrieval.median_latency_ms],
  ["Failed cases", retrieval.failed_cases.length],
])}

## Retrieval Decision Metrics

${markdownTable([
  ["Force-embedding cases", retrieval.force_embedding_case_count],
  ["Force-embedding failures", retrieval.force_embedding_failure_count],
  ["Embedding skipped rate", retrieval.embedding_skipped_rate],
  ["Median text candidate budget", retrieval.median_text_candidate_budget],
  ["Second-stage rerank rate", retrieval.second_stage_rerank_rate],
  ["Strategy counts", JSON.stringify(retrieval.retrieval_strategy_counts)],
  ["Embedding skip reasons", JSON.stringify(retrieval.embedding_skip_reason_counts)],
  ["Text fast-path reasons", JSON.stringify(retrieval.text_fast_path_reason_counts)],
])}

## Source Governance

${markdownTable([
  ["Top results", governance.total_top_results],
  ["Outdated top results", governance.stale_top_results],
  ["Review-due top results", governance.review_due_top_results],
  ["Unknown-status top results", governance.unknown_status_top_results],
  ["Unverified top results", governance.unverified_top_results],
  ["Unknown-extraction top results", governance.unknown_extraction_top_results],
  ["Poor-extraction top results", governance.poor_extraction_top_results],
  ["Stale rate", governance.stale_rate],
  ["Stale/review/unknown rate", governance.stale_review_unknown_rate],
  ["Review-required top results", governance.review_required_top_results],
  ["Review-required rate", governance.review_required_rate],
])}

Policy: ${governance.metadata_policy}

## Answer Metrics

${markdownTable([
  ["Cases", rag.case_count],
  ["Grounded supported rate", rag.grounded_supported_rate],
  ["Substantive grounded answers", rag.substantive_grounded_count],
  ["Substantive grounded rate", rag.substantive_grounded_rate],
  ["Unsupported correct rate", rag.unsupported_correct_rate],
  ["Expected source hit rate", rag.expected_hit_rate],
  ["Citation failure rate", rag.citation_failure_rate],
  ["Numeric grounding failure rate", rag.numeric_grounding_failure_rate],
  ["Source governance warning rate", rag.source_governance_warning_rate],
  ["Source governance danger failure rate", rag.source_governance_danger_failure_rate],
  ["Route ceiling failures", rag.route_ceiling_failure_count],
  ["Generation fallbacks", rag.generation_fallback_count],
  ["Source-backed review fallbacks", rag.source_backed_review_fallback_count],
  ["Source-backed review fallback rate", rag.source_backed_review_fallback_rate],
  ["Comparison extractive fallbacks", rag.comparison_source_extractive_fallback_count],
  ["P95 latency ms", rag.p95_latency_ms],
  ["Estimated cost USD", rag.estimated_cost_usd],
])}

## Answer Case Diagnostics

${ragCaseDiagnosticsTable(report.rag.results)}

## Failing Retrieval Cases

${failedRetrieval || "- None"}

## Failing Answer Cases

${failedRag || "- None"}
`;
}

async function assertSafeToRunEvals(supabase: Awaited<ReturnType<typeof loadAdminClient>>) {
  const { probeSupabaseHealth } = await import("@/lib/supabase/health");
  const health = await probeSupabaseHealth(supabase);
  if (!health.ok) {
    throw new Error(`Supabase is unavailable. Do not run retrieval or RAG evals now: ${health.message}`);
  }
}

async function runRetrievalQualityCases(args: {
  fixture: string;
  ownerId?: string;
  limit?: number;
  query?: string;
  forceEmbedding?: boolean;
  providerMode: EvalQualityProviderMode;
  supabase: Awaited<ReturnType<typeof loadAdminClient>>;
}) {
  const [{ searchChunksWithTelemetry }, capturedCases] = await Promise.all([
    import("@/lib/rag/rag"),
    loadCapturedRagEvalCases({
      supabase: args.supabase as unknown as SupabaseEvalCaseClient,
      ownerId: args.ownerId,
      limit: args.limit,
    }),
  ]);
  const allCases = retrievalCasesForProviderMode(
    [...capturedCases.map(capturedRagCaseToGoldenCase), ...loadGoldenRetrievalCases(args.fixture)],
    args.providerMode,
  );
  const filtered = args.query
    ? allCases.filter((item) => item.id === args.query || item.query.toLowerCase().includes(args.query!.toLowerCase()))
    : allCases;
  const cases = filtered.slice(0, args.limit ?? filtered.length);
  const results: GoldenRetrievalResult[] = [];

  for (const testCase of cases) {
    const startedAt = Date.now();
    const search = await withProviderBackoff(`quality-retrieval:${testCase.id}`, () =>
      searchChunksWithTelemetry({
        query: testCase.query,
        ownerId: args.ownerId,
        // Fetch ≥10 ranked rows so content_mrr@10 is scored over a true top-10 in this path
        // too (fixtures with topK<10 would otherwise silently degrade it to content_mrr@topK).
        topK: retrievalLimitForGoldenCase(testCase),
        minSimilarity: 0.12,
        skipCache: true,
        forceEmbedding: testCase.forceEmbedding || args.forceEmbedding,
      }),
    );
    const latencyMs =
      (search.telemetry.supabase_rpc_latency_ms ?? 0) +
        (search.telemetry.embedding_latency_ms ?? 0) +
        (search.telemetry.rerank_latency_ms ?? 0) || Date.now() - startedAt;
    results.push(
      evaluateGoldenRetrievalCase({
        testCase,
        globalForceEmbedding: args.forceEmbedding,
        results: search.results,
        telemetry: search.telemetry,
        latencyMs,
      }),
    );
  }

  return results;
}

async function runRagQualityCases(args: {
  ownerId?: string;
  limit?: number;
  question?: string;
  captureDiagnostics?: boolean;
  providerMode: EvalQualityProviderMode;
  supabase: Awaited<ReturnType<typeof loadAdminClient>>;
}) {
  const [{ answerQuestionWithScope }, capturedCases] = await Promise.all([
    import("@/lib/rag/rag"),
    loadCapturedRagEvalCases({
      supabase: args.supabase as unknown as SupabaseEvalCaseClient,
      ownerId: args.ownerId,
      limit: args.limit,
    }),
  ]);
  const baseCases = selectRagQualityCasesForQuestion(args.question);
  const allCases = args.question ? baseCases : mergeRagEvalCases(baseCases, capturedCases);
  const cases = allCases.slice(0, args.limit ?? allCases.length);
  const results: RagQualityResult[] = [];
  const diagnosticCases: Array<ReturnType<typeof buildRagDiagnosticDumpRecord>> = [];

  for (const testCase of cases) {
    const answer = (await withProviderBackoff(`quality-rag:${testCase.id}`, () =>
      answerQuestionWithScope({
        query: testCase.question,
        ownerId: args.ownerId,
        logQuery: false,
        skipCache: true,
      }),
    )) as RagAnswer;
    if (args.captureDiagnostics) {
      diagnosticCases.push(buildRagDiagnosticDumpRecord(testCase.id, testCase.question, answer));
    }
    const validation = validateRagAnswer(testCase, answer);
    const failures = [...validation.failures];
    const sourceWarnings = sourceWarningsForRagQualityAnswer(answer);
    const sourceDangerWarningCount = sourceWarnings.filter((warning) => warning.severity === "danger").length;
    const deliveredGrounded = deliveredGroundedAfterSourceGovernancePolicy(answer, sourceWarnings);
    failures.push(
      ...sourceGovernanceDangerFailuresForAnswer({
        grounded: deliveredGrounded,
        sourceDangerWarningCount,
        expectsDangerWarning: testCase.expectsSourceDangerWarning,
      }),
    );
    const { timings, routeCeilingExceeded } = ragAnswerTimingDiagnostics(answer);
    if (routeCeilingExceeded) {
      failures.push(
        `route latency ceiling exceeded: ${timings.totalMs}ms total, ${timings.generationMs}ms generation, ${timings.routeBudgetMs}ms budget`,
      );
    }
    const openAIUsage = {
      inputTokens: answer.openAIUsage?.input_tokens ?? 0,
      cachedInputTokens: answer.openAIUsage?.cached_input_tokens ?? 0,
      outputTokens: answer.openAIUsage?.output_tokens ?? 0,
    };
    const hasOpenAIUsage = openAIUsage.inputTokens + openAIUsage.cachedInputTokens + openAIUsage.outputTokens > 0;
    const openAIRequestIds = answer.openAIRequestIds?.filter(Boolean) ?? [];
    const generationLatencyMs = answer.latencyTimings?.generation_latency_ms ?? 0;

    results.push({
      id: testCase.id,
      question: testCase.question,
      category: testCase.category,
      supported: testCase.supported,
      expectedFiles: validation.expectedCoverage.expectedFiles,
      matchedFiles: validation.expectedCoverage.matchedFiles,
      missingFiles: validation.expectedCoverage.missingFiles,
      topFiles: answer.sources.slice(0, 5).map((source) => source.file_name),
      expectedHit: validation.expectedHit,
      grounded: deliveredGrounded,
      acceptSourceOnly: testCase.acceptSourceOnly,
      latencyMs: answer.latencyTimings?.total_latency_ms ?? 0,
      searchLatencyMs: answer.latencyTimings?.search_latency_ms,
      generationLatencyMs: generationLatencyMs > 0 ? generationLatencyMs : undefined,
      rpcLatencyMs: answer.latencyTimings?.supabase_rpc_latency_ms,
      embeddingLatencyMs: answer.latencyTimings?.embedding_latency_ms,
      route: answer.routingMode ?? "none",
      latencyRoute: latencyRouteForAnswer(answer),
      model: answer.modelUsed ?? null,
      citations: answer.citations.length,
      visualEvidence: answer.visualEvidence?.length ?? 0,
      failures,
      sourceWarningCount: sourceWarnings.length,
      sourceDangerWarningCount,
      unverifiedNumericTokenCount: answer.unverifiedNumericTokens?.length ?? 0,
      hasFaithfulnessWarning: Boolean(answer.faithfulnessWarning),
      routingReason: answer.routingReason,
      timings,
      routeCeilingExceeded,
      executionType:
        hasOpenAIUsage || openAIRequestIds.length > 0 || answer.modelUsed || generationLatencyMs > 0
          ? "api"
          : answer.routingMode === "unsupported"
            ? "rule-based"
            : "cached",
      // A case that never touched the provider costs exactly $0.
      // null stays reserved for "cannot estimate" — either
      // rates unconfigured, or a provider call was attempted without usage metadata.
      estimatedCostUsd: hasOpenAIUsage
        ? estimateCostUsd(openAIUsage)
        : openAIRequestIds.length > 0 || answer.modelUsed || generationLatencyMs > 0
          ? null
          : 0,
      openAIRequestIds: openAIRequestIds.length > 0 ? openAIRequestIds : undefined,
      openAIUsage: hasOpenAIUsage ? openAIUsage : undefined,
    });
  }

  return { results, diagnosticCases };
}

async function writeReports(report: EvalQualityReport, outputDir: string) {
  await mkdir(outputDir, { recursive: true });
  const stamp = report.generated_at.replace(/[:.]/g, "-");
  const jsonPath = join(outputDir, `retrieval-quality-${stamp}.json`);
  const markdownPath = join(outputDir, `retrieval-quality-${stamp}.md`);
  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
    writeFile(markdownPath, renderEvalQualityMarkdown(report), "utf8"),
  ]);
  return { jsonPath, markdownPath };
}

function asRecord(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

export function sourceGovernanceResultsFromArtifact(value: unknown): GoldenRetrievalResult[] {
  const artifact = asRecord(value, "source governance results artifact");
  if (!Array.isArray(artifact.results)) {
    throw new Error("source governance results artifact results must be an array.");
  }

  return artifact.results.map((result, resultIndex) => {
    const record = asRecord(result, `source governance results[${resultIndex}]`);
    if (typeof record.id !== "string" || !record.id.trim()) {
      throw new Error(`source governance results[${resultIndex}] id must be a non-empty string.`);
    }
    if (!Array.isArray(record.topResults)) {
      throw new Error(`source governance results[${resultIndex}] topResults must be an array.`);
    }
    record.topResults.forEach((topResult, topResultIndex) => {
      asRecord(topResult, `source governance results[${resultIndex}].topResults[${topResultIndex}]`);
    });
    return record as unknown as GoldenRetrievalResult;
  });
}

async function loadSourceGovernanceResults(path: string) {
  const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  return sourceGovernanceResultsFromArtifact(parsed);
}

function requiredString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`source metadata debt ${key} is required.`);
  return value;
}

function optionalString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) throw new Error(`source metadata debt ${key} must be a string.`);
  return value;
}

function requiredNumber(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`source metadata debt ${key} must be a finite number.`);
  }
  return value;
}

async function loadSourceMetadataDebtAcceptance(path: string): Promise<SourceMetadataDebtAcceptance> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  const record = asRecord(parsed, "source metadata debt acceptance");
  const ceilings = asRecord(record.ceilings, "source metadata debt acceptance ceilings");

  if (record.accepted !== true) {
    throw new Error("source metadata debt acceptance must set accepted to true.");
  }

  return {
    path,
    accepted_by: requiredString(record, "accepted_by"),
    accepted_at: requiredString(record, "accepted_at"),
    expires_at: optionalString(record, "expires_at"),
    reason: requiredString(record, "reason"),
    max_stale_rate: requiredNumber(ceilings, "max_stale_rate"),
    max_review_required_rate: requiredNumber(ceilings, "max_review_required_rate"),
    max_outdated_top_results: requiredNumber(ceilings, "max_outdated_top_results"),
    max_poor_extraction_top_results: requiredNumber(ceilings, "max_poor_extraction_top_results"),
    max_source_governance_danger_failure_rate: requiredNumber(ceilings, "max_source_governance_danger_failure_rate"),
  };
}

async function main() {
  const args = parseEvalQualityArgs(process.argv.slice(2));
  if (args.providerMode === "offline" && args.forceEmbedding) {
    throw new Error("--force-embedding cannot be used with --provider-mode offline.");
  }
  configureEvalProviderEnvironment(args.providerMode);
  const [{ requireOpenAIEnv, requireServerEnv }, supabase] = await Promise.all([
    import("@/lib/env"),
    loadAdminClient(),
  ]);

  requireServerEnv();
  if (args.providerMode === "openai") requireOpenAIEnv();
  if (!args.skipPreflight) await assertSafeToRunEvals(supabase);
  const sourceMetadataDebtAcceptance = args.sourceMetadataDebt
    ? await loadSourceMetadataDebtAcceptance(args.sourceMetadataDebt)
    : undefined;
  const sourceGovernanceResults = args.sourceGovernanceResults
    ? await loadSourceGovernanceResults(args.sourceGovernanceResults)
    : undefined;

  const ownerId = await resolveEvalOwnerId(supabase, args);
  const retrievalResults = args.ragOnly ? [] : await runRetrievalQualityCases({ ...args, ownerId, supabase });
  const ragRun = args.retrievalOnly
    ? { results: [] as RagQualityResult[], diagnosticCases: [] }
    : await runRagQualityCases({
        ...args,
        ownerId,
        supabase,
        captureDiagnostics: Boolean(args.dumpRagCases),
      });
  const ragResults = ragRun.results;
  const report = buildEvalQualityReport({
    retrievalResults,
    sourceGovernanceResults,
    ragResults,
    sourceMetadataDebtAcceptance,
    providerMode: args.providerMode,
  });
  const paths = await writeReports(report, args.outputDir);
  if (args.dumpRagCases) {
    const dumpPath = resolveLocalDiagnosticOutputPath(args.dumpRagCases);
    await mkdir(dirname(dumpPath), { recursive: true });
    await writeFile(
      dumpPath,
      `${JSON.stringify(
        {
          generated_at: new Date().toISOString(),
          case_count: ragRun.diagnosticCases.length,
          cases: ragRun.diagnosticCases,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }

  if (args.json) {
    console.log(JSON.stringify({ ...report, output: paths }, null, 2));
  } else {
    console.log(renderEvalQualityMarkdown(report));
    console.log(`Reports written:\n  JSON: ${paths.jsonPath}\n  Markdown: ${paths.markdownPath}`);
  }

  if (args.failOnThreshold && report.blocking_threshold_failures.length > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
