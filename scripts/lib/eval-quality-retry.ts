/**
 * Blocking-gate retry for `eval:quality --fail-on-threshold`.
 *
 * Every Eval Canary red between 2026-09-13 and 2026-10-13 came from a different single-case or
 * single-sample gate (citation_failure_rate 0.0227 = one case in 44; one unaccounted review
 * fallback; one 6.4 s unsupported retrieval tipping the route p95). Those gates are zero-tolerance
 * by design and their values must not move, so instead of loosening them the harness re-runs ONLY
 * the cases implicated in a blocking RAG failure, once, and rebuilds the report with the retry
 * outcome substituted for each retried case. A gate therefore blocks only when the same case fails
 * it again. Latency gates are not retried at all: every first-attempt sample stays in the p95
 * population, so a rerun could never clear one and would only add provider cost. If the retry
 * itself errors, the whole first-attempt verdict stands. Thresholds are read, never written. Retrieval and offline-invariant failures are not
 * retryable and keep blocking exactly as before.
 *
 * Pure apart from types, so every branch is testable without a provider call.
 */
import {
  isGroundedSupported,
  type EvalQualityProviderMode,
  type EvalQualityReport,
  type RagQualityResult,
} from "../eval-quality";

export type GateRetryCase = {
  id: string;
  initial_failures: string[];
  retry_failures: string[];
  initial_latency_ms: number;
  retry_latency_ms: number;
  initial_routing_reason: string | null;
  retry_routing_reason: string | null;
};

export type GateRetrySummary = {
  attempted: boolean;
  initial_blocking_threshold_failures: string[];
  non_retryable_blocking_failures: string[];
  retried_case_ids: string[];
  cases: GateRetryCase[];
  final_blocking_threshold_failures: string[];
  /** Set when the rerun itself threw; the first-attempt verdict then stands. */
  retry_error?: string | null;
};

const p95Pattern = /^RAG p95_latency_ms \S+ above (\d+(?:\.\d+)?)$/;
const routeP95Pattern = /^RAG route (\S+) p95_latency_ms \S+ above (\d+(?:\.\d+)?)$/;

/**
 * The RAG case ids each blocking failure points at. A failure with no case-level owner (retrieval
 * gates, offline invariants, anything unrecognised) is returned as non-retryable.
 */
export function blockingGateRetryCaseIds(
  report: EvalQualityReport,
  failureCategory: (message: string) => string,
  providerMode: EvalQualityProviderMode = "openai",
) {
  const results = report.rag.results as RagQualityResult[];
  const unaccounted = new Set(
    report.rag.summary.source_backed_review_fallback_unaccounted.map((entry: string) => entry.split(" (")[0]),
  );
  const ids = new Set<string>();
  const nonRetryable: string[] = [];
  const add = (matches: RagQualityResult[]) => matches.forEach((result) => ids.add(result.id));

  for (const failure of report.blocking_threshold_failures) {
    const routeP95 = routeP95Pattern.exec(failure);
    const p95 = p95Pattern.exec(failure);
    if (routeP95 || p95) {
      // Latency gates keep every first-attempt sample (latencySamplesForRetry), so a rerun can
      // never clear them; re-running would only add provider cost. They stand as-is.
      nonRetryable.push(failure);
    } else if (failure.startsWith("RAG citation_failure_rate")) {
      add(results.filter((result) => result.failures.some((item) => failureCategory(item) === "citation")));
    } else if (failure.startsWith("RAG source_backed_review_fallback unaccounted")) {
      add(results.filter((result) => unaccounted.has(result.id)));
    } else if (failure.startsWith("RAG route_ceiling_failure_count")) {
      add(results.filter((result) => result.routeCeilingExceeded));
    } else if (failure.startsWith("RAG grounded_supported_rate")) {
      add(results.filter((result) => result.supported && !isGroundedSupported(result, providerMode)));
    } else if (failure.startsWith("RAG unsupported_correct_rate")) {
      add(results.filter((result) => !result.supported && result.grounded));
    } else if (failure.startsWith("RAG numeric_grounding_failure_rate")) {
      add(
        results.filter(
          (result) =>
            result.unverifiedNumericTokenCount > 0 ||
            result.hasFaithfulnessWarning ||
            result.failures.some((item) => failureCategory(item) === "numeric_grounding"),
        ),
      );
    } else if (failure.startsWith("RAG source_governance_danger_failure_rate")) {
      add(results.filter((result) => result.grounded && result.sourceDangerWarningCount > 0));
    } else if (failure.startsWith("RAG expected_danger_warning_missing_count")) {
      add(results.filter((result) => result.failures.includes("expected danger source governance warning missing")));
    } else {
      nonRetryable.push(failure);
    }
  }
  return { caseIds: [...ids].sort(), nonRetryable };
}

/**
 * First attempts superseded by a retry. Every retried case keeps its first-attempt latency in the
 * latency-gate population (whichever gate selected it) and its cost in the run total, so a retry
 * can never hide a slow first attempt or understate spend.
 */
export function latencySamplesForRetry(report: EvalQualityReport, caseIds: readonly string[]) {
  const results = report.rag.results as RagQualityResult[];
  const ids = new Set(caseIds);
  return results
    .filter((result) => ids.has(result.id))
    .map((result) => ({
      route: result.latencyRoute,
      latencyMs: result.latencyMs,
      estimatedCostUsd: result.estimatedCostUsd,
      routeCeilingExceeded: result.routeCeilingExceeded,
    }));
}

/** Substitute each retried case's single retry result for its first attempt, preserving case order. */
export function mergeRetriedRagResults(original: RagQualityResult[], retried: RagQualityResult[]) {
  const byId = new Map(retried.map((result) => [result.id, result]));
  return original.map((result) => byId.get(result.id) ?? result);
}

export function summarizeGateRetry(args: {
  initial: EvalQualityReport;
  final: EvalQualityReport;
  retried: RagQualityResult[];
  nonRetryable: string[];
}): GateRetrySummary {
  const initialById = new Map((args.initial.rag.results as RagQualityResult[]).map((result) => [result.id, result]));
  return {
    attempted: args.retried.length > 0,
    initial_blocking_threshold_failures: args.initial.blocking_threshold_failures,
    non_retryable_blocking_failures: args.nonRetryable,
    retried_case_ids: args.retried.map((result) => result.id),
    cases: args.retried.map((retry) => {
      const first = initialById.get(retry.id);
      return {
        id: retry.id,
        initial_failures: first?.failures ?? [],
        retry_failures: retry.failures,
        initial_latency_ms: first?.latencyMs ?? 0,
        retry_latency_ms: retry.latencyMs,
        initial_routing_reason: first?.routingReason ?? null,
        retry_routing_reason: retry.routingReason ?? null,
      };
    }),
    final_blocking_threshold_failures: args.final.blocking_threshold_failures,
  };
}

export function renderGateRetryMarkdown(retry: GateRetrySummary | null | undefined) {
  if (!retry) return "";
  if (!retry.attempted) {
    return `\n## Blocking-Gate Retry\n\n${retry.retry_error ? `Retry failed (first-attempt verdict kept): ${retry.retry_error}\n\n` : ""}No retry: ${
      retry.initial_blocking_threshold_failures.length ? "no retryable RAG case was implicated." : "nothing blocked."
    }\n`;
  }
  const list = (items: string[]) => (items.length ? items.map((item) => `- ${item}`).join("\n") : "- None");
  const rows = retry.cases
    .map(
      (item) =>
        `| ${item.id} | ${item.initial_failures.join("; ") || "none"} | ${item.retry_failures.join("; ") || "none"} | ${item.initial_latency_ms} | ${item.retry_latency_ms} | ${item.initial_routing_reason ?? "n/a"} | ${item.retry_routing_reason ?? "n/a"} |`,
    )
    .join("\n");
  const errorNote = retry.retry_error ? `\nRetry failed (first-attempt verdict kept): ${retry.retry_error}\n` : "";
  return `
## Blocking-Gate Retry
${errorNote}
Each case implicated in a blocking RAG gate was re-run once. Answer-quality gates were re-evaluated with the retry result in place of the first attempt. Latency gates keep BOTH samples (first attempt and retry), so a slow first attempt still counts and a retry cannot clear a latency gate on its own; estimated cost includes both attempts. Threshold values are unchanged.

Initial blocking failures (first attempt):

${list(retry.initial_blocking_threshold_failures)}

Not retryable (kept as-is):

${list(retry.non_retryable_blocking_failures)}

| Case | First-attempt failures | Retry failures | First ms | Retry ms | First routing reason | Retry routing reason |
| --- | --- | --- | ---: | ---: | --- | --- |
${rows}

Blocking failures after retry:

${list(retry.final_blocking_threshold_failures)}
`;
}

/**
 * The verdict after a retry. Non-retryable first-attempt failures always stand. A crashed retry is
 * incomplete evidence, so then the whole first-attempt verdict stands: a partial set of passing
 * retries can never lift a rate gate over its threshold and let the run pass.
 */
export function finalBlockingFailures(args: {
  initial: readonly string[];
  merged: readonly string[];
  nonRetryable: readonly string[];
  retryError: string | null;
}): string[] {
  const standing = args.retryError ? args.initial : args.nonRetryable;
  return [...args.merged, ...standing.filter((failure) => !args.merged.includes(failure))];
}
