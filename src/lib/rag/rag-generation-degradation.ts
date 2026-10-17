import {
  legacyAnswerGenerationContract,
  adaptiveAnswerGenerationContract,
  isRagAnswerGenerationContract,
  type RagAnswerGenerationContract,
} from "@/lib/rag/rag-versioning";
import type { AnswerCoveragePlan, RagAnswer } from "@/lib/types";
import type { OpenAITextResult } from "@/lib/openai";

/** Private, bounded observations. No model/query/source/error/request identifiers. */
export type RagGenerationDegradationReason =
  | "provider_initial_attempt_timeout"
  | "provider_quality_retry_exhausted"
  | "provider_incomplete_max_output_tokens"
  | "parse_failure_after_healthy_retrieval"
  | "verification_collapse_after_healthy_retrieval";
export type GenerationAttemptOutcome =
  "completed" | "incomplete_max_output_tokens" | "incomplete_other" | "timeout" | "caller_aborted" | "provider_failed";
export type GenerationRetryAdmission =
  "not_requested" | "admitted" | "denied_budget" | "recovery_selected" | "exhausted";
const qualityReasons = [
  "template_like_answer",
  "fast_invalid_evidence_retry_strong",
  "fast_source_gap_retry_strong",
  "fast_unsupported_retry_strong",
  "fast_unusable_retry_strong",
  "fast_template_retry_strong",
  "fast_overexpanded_simple_retry_strong",
  "fast_quality_retry_strong",
  "incomplete_opening_sentence",
  "bad_final_answer_quality",
  "fragment_like_answer",
  "low_yield_answer",
  "missing_query_overlap",
  "empty_after_sanitize",
  "provider_source_gap",
  "quality_gate",
] as const;
type QualityReason = (typeof qualityReasons)[number];
export type GenerationAttempt = {
  ordinal: number;
  stage: "initial" | "quality_retry" | "truncation_recovery";
  route: "fast" | "strong";
  outcome: GenerationAttemptOutcome;
  responseReceived: boolean;
  latencyMs: number;
  timeoutMs: number;
  outputChars: number;
  outputTokens: number;
  reasoningTokens: number;
  outputBudget: "standard" | "recovery";
  retrievalHealthy: boolean;
  coverage: AnswerCoveragePlan["overall"] | "unavailable";
  contextCount: number;
  qualityReason: QualityReason | null;
  retryAdmission: GenerationRetryAdmission;
  retryRemainingMs: number | null;
  parseFailed: boolean;
  verificationFailed: boolean;
};
export type GenerationCompletedOutput = {
  answerChars: number;
  answerWords: number;
  validCitationCount: number;
  invalidCitationCount: number;
  unverifiedNumericCount: number;
  grounded: boolean;
  useful: boolean;
};
export type RagGenerationDegradationRecord = RagAnswerGenerationContract & {
  version: "generation-degradation-v1";
  policy: "legacy-generation-policy-v1";
  cacheVersion: "rag-cache-v25";
  routeBudgetMs: number;
  observationComplete: boolean;
  reason: RagGenerationDegradationReason | null;
  attempts: GenerationAttempt[];
  completedResponseCount: number;
  totalAttemptLatencyMs: number;
  completedOutput: GenerationCompletedOutput;
};
const count = (value: unknown, cap = 1_000_000) =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(cap, Math.floor(value))) : 0;
const qualityReason = (value: string): QualityReason =>
  qualityReasons.includes(value as QualityReason) ? (value as QualityReason) : "quality_gate";
const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

/** Terminal stage takes precedence over earlier retry history; caller abort never degrades. */
export function classifyGenerationDegradation(
  attempts: readonly GenerationAttempt[],
  failed: boolean,
): RagGenerationDegradationReason | null {
  const last = attempts.at(-1);
  if (!last || last.outcome === "caller_aborted" || !last.retrievalHealthy || last.coverage !== "complete") return null;
  if (last.parseFailed) return "parse_failure_after_healthy_retrieval";
  if (last.outcome === "incomplete_max_output_tokens") return "provider_incomplete_max_output_tokens";
  if (last.verificationFailed) return "verification_collapse_after_healthy_retrieval";
  if (!failed) return null;
  const rejectedResponse = attempts.some((a) => a.responseReceived && a.qualityReason !== null);
  if (
    rejectedResponse &&
    (last.outcome === "timeout" || last.retryAdmission === "denied_budget" || last.retryAdmission === "exhausted")
  )
    return "provider_quality_retry_exhausted";
  if (attempts.length === 1 && !last.responseReceived && last.outcome === "timeout")
    return "provider_initial_attempt_timeout";
  return null;
}

type OutputLike = Pick<
  RagAnswer,
  "answer" | "grounded" | "unverifiedNumericTokens" | "routingReason" | "responseMode"
> & {
  citations: Array<{ chunk_id: string; document_id: string }>;
  sources: Array<{ id: string; document_id: string }>;
};
export function generationCompletedOutput(answer: OutputLike): GenerationCompletedOutput {
  const validCitationCount = answer.citations.filter((c) =>
    answer.sources.some((s) => s.id === c.chunk_id && s.document_id === c.document_id),
  ).length;
  const invalidCitationCount = answer.citations.length - validCitationCount;
  const unverifiedNumericCount = answer.unverifiedNumericTokens?.length ?? 0;
  const text = answer.answer.trim();
  return {
    answerChars: count(text.length),
    answerWords: count(text ? text.split(/\s+/).length : 0),
    validCitationCount: count(validCitationCount),
    invalidCitationCount: count(invalidCitationCount),
    unverifiedNumericCount: count(unverifiedNumericCount),
    grounded: answer.grounded === true,
    useful:
      answer.grounded === true &&
      validCitationCount > 0 &&
      invalidCitationCount === 0 &&
      unverifiedNumericCount === 0 &&
      text.length > 0 &&
      answer.responseMode !== "evidence_gap" &&
      !/source_backed_review_fallback|final_quality_gate/.test(answer.routingReason ?? "") &&
      !/could not generate|review the source snippets/i.test(text),
  };
}

export function generationDegradationLogMetadata(
  degradation: RagGenerationDegradationRecord | null | undefined,
): Record<string, unknown> {
  const projected = projectGenerationDegradation(degradation ?? undefined);
  if (!projected || projected.attempts.length === 0) return {};
  return {
    generation_degradation_reason: projected.reason,
    generation_degradation_attempt_count: projected.attempts.length,
    generation_degradation_completed_response_count: projected.completedResponseCount,
    generation_degradation_total_attempt_latency_ms: projected.totalAttemptLatencyMs,
    generation_degradation_remaining_route_budget_ms: Math.max(
      0,
      projected.routeBudgetMs - projected.totalAttemptLatencyMs,
    ),
    provider_initial_attempt_timeout: projected.reason === "provider_initial_attempt_timeout",
    provider_quality_retry_exhausted: projected.reason === "provider_quality_retry_exhausted",
  };
}

export function createGenerationDegradationRecorder(options: {
  enabled?: boolean;
  args?: { ragProgrammeRollout?: { servedMode?: string } | null; ragQueryPlanMode?: string | null };
  routeBudgetMs: number;
  contract?: RagAnswerGenerationContract;
}) {
  const enabled =
    options.enabled ??
    (options.args?.ragProgrammeRollout?.servedMode === "candidate" ||
      options.args?.ragQueryPlanMode === "shadow" ||
      options.args?.ragQueryPlanMode === "canary");
  const contract = options.contract ?? legacyAnswerGenerationContract;
  const attempts: GenerationAttempt[] = [];
  let nextStage: GenerationAttempt["stage"] = "initial";
  // The current ladder is initial + truncation self-heal + fast escalation + strong repair.
  // Fail closed if a future ladder exceeds that bound; never mutate the fourth record for a fifth call.
  let observationComplete = true;
  let lastRecord: RagGenerationDegradationRecord | undefined;
  const current = () => (observationComplete ? attempts.at(-1) : undefined);
  return {
    enabled,
    start(
      input: Pick<
        GenerationAttempt,
        "route" | "timeoutMs" | "outputBudget" | "retrievalHealthy" | "coverage" | "contextCount"
      >,
    ) {
      if (attempts.length >= 4) {
        observationComplete = false;
        return;
      }
      attempts.push({
        ordinal: attempts.length + 1,
        stage: nextStage,
        route: input.route,
        timeoutMs: count(input.timeoutMs, 30000),
        outputBudget: input.outputBudget,
        retrievalHealthy: input.retrievalHealthy,
        coverage: input.coverage,
        contextCount: count(input.contextCount, 100),
        outcome: "provider_failed",
        responseReceived: false,
        latencyMs: 0,
        outputChars: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        qualityReason: null,
        retryAdmission: "not_requested",
        retryRemainingMs: null,
        parseFailed: false,
        verificationFailed: false,
      });
    },
    respond(
      result: Pick<OpenAITextResult, "text" | "usage" | "status">,
      latencyMs: number,
      outcome: GenerationAttemptOutcome = "completed",
    ) {
      const attempt = current();
      if (!attempt) return;
      Object.assign(attempt, {
        responseReceived: true,
        outcome,
        latencyMs: count(latencyMs, 35000),
        outputChars: count(result.text.length),
        outputTokens: count(result.usage?.output_tokens),
        reasoningTokens: count(result.usage?.reasoning_output_tokens),
      });
    },
    fail(outcome: "timeout" | "caller_aborted" | "provider_failed", latencyMs: number) {
      const attempt = current();
      if (attempt) Object.assign(attempt, { outcome, latencyMs: count(latencyMs, 35000) });
    },
    retry(reason: string | null, admission: GenerationRetryAdmission, remainingMs: number, truncation = false) {
      const attempt = current();
      if (!attempt) return;
      Object.assign(attempt, {
        qualityReason: reason === null ? null : qualityReason(reason),
        retryAdmission: admission,
        retryRemainingMs: count(remainingMs, 35000),
      });
      nextStage = truncation ? "truncation_recovery" : "quality_retry";
    },
    parsed<T extends { routingReason?: string }>(answer: T): T {
      const attempt = current();
      if (attempt) attempt.parseFailed = answer.routingReason === "structured_parse_fallback";
      return answer;
    },
    verificationFailed() {
      const attempt = current();
      if (attempt) attempt.verificationFailed = true;
    },
    finish(answer: OutputLike, failed: boolean): RagGenerationDegradationRecord | undefined {
      if (!isRagAnswerGenerationContract(contract)) {
        lastRecord = undefined;
        return undefined;
      }
      const last = current();
      if (failed && last?.qualityReason && last.retryAdmission === "not_requested") last.retryAdmission = "exhausted";
      lastRecord =
        projectGenerationDegradation({
          version: "generation-degradation-v1",
          policy: "legacy-generation-policy-v1",
          ...contract,
          cacheVersion: "rag-cache-v25",
          routeBudgetMs: options.routeBudgetMs,
          observationComplete,
          reason: observationComplete ? classifyGenerationDegradation(attempts, failed) : null,
          attempts,
          completedResponseCount: attempts.filter((a) => a.responseReceived).length,
          totalAttemptLatencyMs: attempts.reduce((sum, a) => sum + a.latencyMs, 0),
          completedOutput: generationCompletedOutput(answer),
        }) ?? undefined;
      return enabled ? lastRecord : undefined;
    },
    metadata(): Record<string, unknown> {
      return generationDegradationLogMetadata(lastRecord);
    },
  };
}
export type GenerationDegradationRecorder = ReturnType<typeof createGenerationDegradationRecorder>;

/** Supplied observations must be measurements, not values repaired into plausible measurements. */
function isObservedCount(value: unknown, maximum = 1_000_000): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const degradationReasons: readonly RagGenerationDegradationReason[] = [
  "provider_initial_attempt_timeout",
  "provider_quality_retry_exhausted",
  "provider_incomplete_max_output_tokens",
  "parse_failure_after_healthy_retrieval",
  "verification_collapse_after_healthy_retrieval",
];

/** Explicit projection rejects malformed evidence and copies only content-free fields. */
export function projectGenerationDegradation(
  record: RagGenerationDegradationRecord | undefined | null,
): RagGenerationDegradationRecord | null {
  if (
    !isRecord(record) ||
    record.version !== "generation-degradation-v1" ||
    record.policy !== "legacy-generation-policy-v1" ||
    !isRagAnswerGenerationContract(record) ||
    record.cacheVersion !== "rag-cache-v25" ||
    ![0, 12000, 25000, 35000].includes(record.routeBudgetMs) ||
    typeof record.observationComplete !== "boolean" ||
    (record.reason !== null && !degradationReasons.includes(record.reason)) ||
    !Array.isArray(record.attempts) ||
    record.attempts.length > 4 ||
    !isObservedCount(record.completedResponseCount, 4) ||
    !isObservedCount(record.totalAttemptLatencyMs, 140000)
  )
    return null;
  if (
    Array.from(record.attempts).some(
      (a, index) =>
        !isRecord(a) ||
        a.ordinal !== index + 1 ||
        !["initial", "quality_retry", "truncation_recovery"].includes(a.stage) ||
        !["fast", "strong"].includes(a.route) ||
        ![
          "completed",
          "incomplete_max_output_tokens",
          "incomplete_other",
          "timeout",
          "caller_aborted",
          "provider_failed",
        ].includes(a.outcome) ||
        !["standard", "recovery"].includes(a.outputBudget) ||
        !["complete", "partial", "conflicting", "absent", "unavailable"].includes(a.coverage) ||
        !["not_requested", "admitted", "denied_budget", "recovery_selected", "exhausted"].includes(a.retryAdmission) ||
        [a.responseReceived, a.retrievalHealthy, a.parseFailed, a.verificationFailed].some(
          (value) => typeof value !== "boolean",
        ) ||
        !isObservedCount(a.latencyMs, 35000) ||
        !isObservedCount(a.timeoutMs, 30000) ||
        [a.outputChars, a.outputTokens, a.reasoningTokens].some((value) => !isObservedCount(value)) ||
        !isObservedCount(a.contextCount, 100) ||
        (a.retryRemainingMs != null && !isObservedCount(a.retryRemainingMs, 35000)) ||
        (a.qualityReason != null && typeof a.qualityReason !== "string"),
    )
  )
    return null;
  const output = record.completedOutput;
  if (
    !isRecord(output) ||
    [
      output.answerChars,
      output.answerWords,
      output.validCitationCount,
      output.invalidCitationCount,
      output.unverifiedNumericCount,
    ].some((value) => !isObservedCount(value)) ||
    typeof output.grounded !== "boolean" ||
    typeof output.useful !== "boolean"
  )
    return null;
  if (
    record.completedResponseCount !== record.attempts.filter((a) => a.responseReceived).length ||
    record.totalAttemptLatencyMs !== record.attempts.reduce((sum, a) => sum + a.latencyMs, 0)
  )
    return null;
  const attempts = record.attempts.map((a): GenerationAttempt => ({
    ordinal: a.ordinal,
    stage: a.stage,
    route: a.route,
    outcome: a.outcome,
    responseReceived: a.responseReceived,
    latencyMs: a.latencyMs,
    timeoutMs: a.timeoutMs,
    outputChars: a.outputChars,
    outputTokens: a.outputTokens,
    reasoningTokens: a.reasoningTokens,
    outputBudget: a.outputBudget,
    retrievalHealthy: a.retrievalHealthy,
    coverage: a.coverage,
    contextCount: a.contextCount,
    qualityReason: a.qualityReason == null ? null : qualityReason(a.qualityReason),
    retryAdmission: a.retryAdmission,
    retryRemainingMs: a.retryRemainingMs ?? null,
    parseFailed: a.parseFailed,
    verificationFailed: a.verificationFailed,
  }));
  return {
    version: "generation-degradation-v1",
    policy: "legacy-generation-policy-v1",
    ...(record.promptVersion === adaptiveAnswerGenerationContract.promptVersion
      ? adaptiveAnswerGenerationContract
      : legacyAnswerGenerationContract),
    cacheVersion: "rag-cache-v25",
    routeBudgetMs: record.routeBudgetMs,
    observationComplete: record.observationComplete,
    reason: record.reason,
    attempts,
    completedResponseCount: record.completedResponseCount,
    totalAttemptLatencyMs: record.totalAttemptLatencyMs,
    completedOutput: {
      answerChars: output.answerChars,
      answerWords: output.answerWords,
      validCitationCount: output.validCitationCount,
      invalidCitationCount: output.invalidCitationCount,
      unverifiedNumericCount: output.unverifiedNumericCount,
      grounded: output.grounded,
      useful: output.useful,
    },
  };
}

const alternatives = [
  "retry_admission",
  "prompt_context",
  "model_route",
  "output_reasoning_budget",
  "single_truncation_recovery",
] as const;
/** Evidence-only comparison of already supplied observations. Never calls a provider or writes a cache. */
export function compareGenerationAlternatives(input: {
  mode: "shadow";
  alternative: (typeof alternatives)[number];
  baseline: RagGenerationDegradationRecord;
  candidate: RagGenerationDegradationRecord;
  sameEvidence: boolean;
  safetyContractUnchanged: boolean;
}) {
  const alternative = oneOf(input.alternative, alternatives, "retry_admission");
  const baseline = projectGenerationDegradation(input.baseline);
  const candidate = projectGenerationDegradation(input.candidate);
  const comparable =
    alternatives.includes(input.alternative) &&
    input.mode === "shadow" &&
    input.sameEvidence === true &&
    input.safetyContractUnchanged === true &&
    baseline &&
    candidate &&
    baseline.observationComplete &&
    candidate.observationComplete &&
    baseline.attempts.length > 0 &&
    candidate.attempts.length > 0 &&
    [...baseline.attempts, ...candidate.attempts].every((a) => a.retrievalHealthy && a.coverage === "complete") &&
    (alternative !== "retry_admission" || baseline.reason === "provider_quality_retry_exhausted") &&
    baseline.routeBudgetMs === candidate.routeBudgetMs &&
    candidate.totalAttemptLatencyMs <= candidate.routeBudgetMs &&
    candidate.attempts.length <= baseline.attempts.length &&
    candidate.completedOutput.invalidCitationCount === 0 &&
    candidate.completedOutput.unverifiedNumericCount === 0;
  const improved =
    comparable &&
    candidate.completedOutput.useful &&
    candidate.completedOutput.grounded &&
    candidate.completedOutput.validCitationCount > 0 &&
    (!baseline.completedOutput.useful ||
      (baseline.reason !== null && candidate.reason === null) ||
      candidate.totalAttemptLatencyMs < baseline.totalAttemptLatencyMs);
  return {
    mode: "shadow" as const,
    activationAllowed: false as const,
    alternative,
    cacheIdentity: `generation-shadow-v1:${alternative}`,
    verdict: !comparable ? "incomparable" : improved ? "candidate_improved" : "no_measured_benefit",
    baseline,
    candidate,
  };
}
