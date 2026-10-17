import { env } from "@/lib/env";
import { PublicApiError } from "@/lib/http";
import type { RagFallbackReasonCode } from "@/lib/types";

export type RagProviderMode = "auto" | "openai" | "offline";

/**
 * How the answer/search stack should treat the OpenAI provider.
 *
 * - "auto" (default): use OpenAI when a usable key is present and calls succeed; degrade to a
 *   source-only (embedding-free, deterministic) path when the key is missing or a call fails.
 * - "openai": always attempt OpenAI; do not pre-empt or silently degrade (legacy behaviour).
 * - "offline": never call OpenAI at all (no embeddings, no generation); lexical retrieval +
 *   deterministic source-only answers only, failing closed when evidence is weak.
 */
export function ragProviderMode(): RagProviderMode {
  return env.RAG_PROVIDER_MODE;
}

export function hasUsableOpenAIKey(): boolean {
  return Boolean(env.OPENAI_API_KEY);
}

/**
 * True when retrieval and answering must run without any OpenAI call. This is the case in
 * "offline" mode always, and in "auto" mode when no usable key is configured.
 */
export function isSourceOnlyMode(): boolean {
  const mode = ragProviderMode();
  if (mode === "offline") return true;
  if (mode === "openai") return false;
  return !hasUsableOpenAIKey();
}

/**
 * True when a runtime OpenAI failure should be degraded to a source-only answer rather than
 * surfaced as an error. Only "auto" mode degrades; "openai" surfaces, "offline" never calls.
 */
export function allowsAutoDegrade(): boolean {
  return ragProviderMode() === "auto";
}

export type ProviderFailureKind =
  "missing_key" | "auth_failed" | "quota_exhausted" | "rate_limited" | "timeout" | "provider_failed";

/**
 * Classify why an OpenAI call failed, for telemetry and user-facing fallback messaging.
 * Works on both raw provider errors and the PublicApiError produced by mapOpenAIError.
 * Never returns provider internals â€” only a stable, coarse kind.
 */
export function classifyProviderFailure(error: unknown): ProviderFailureKind {
  const status =
    error instanceof PublicApiError
      ? error.status
      : typeof (error as { status?: unknown })?.status === "number"
        ? (error as { status: number }).status
        : undefined;
  const code =
    error instanceof PublicApiError
      ? error.details?.code
      : typeof (error as { code?: unknown })?.code === "string"
        ? (error as { code: string }).code
        : undefined;
  const message = (error instanceof Error ? error.message : String(error ?? "")).toLowerCase();

  if (code === "insufficient_quota" || /quota|billing/.test(message)) return "quota_exhausted";
  if (
    code === "openai_invalid_api_key" ||
    code === "openai_access_denied" ||
    status === 401 ||
    status === 403 ||
    /authentication|unauthori[sz]ed|api key/.test(message)
  ) {
    return "auth_failed";
  }
  if (code === "rate_limit_exceeded" || (status === 429 && /rate limit/.test(message))) return "rate_limited";
  if (
    code === "openai_timeout" ||
    code === "ETIMEDOUT" ||
    status === 408 ||
    status === 504 ||
    /timed out|timeout|aborted/.test(message)
  )
    return "timeout";
  return "provider_failed";
}

const providerFallbackCodes: Record<ProviderFailureKind, RagFallbackReasonCode> = {
  missing_key: "provider_missing_key",
  auth_failed: "provider_auth",
  quota_exhausted: "provider_quota",
  rate_limited: "provider_rate_limit",
  timeout: "provider_timeout",
  provider_failed: "provider_failure",
};

export function providerFallbackReasonCode(error?: unknown): RagFallbackReasonCode {
  if (error !== undefined) return providerFallbackCodes[classifyProviderFailure(error)];
  return ragProviderMode() === "offline" ? "provider_offline" : "provider_missing_key";
}

/**
 * Reason string recorded on a degraded answer/search so the UI and telemetry can explain that
 * the response is source-only and may be lower quality. Maps a failure (or the static no-key
 * case) to a stable token.
 */
export function sourceOnlyReason(error?: unknown): string {
  if (error === undefined) {
    return ragProviderMode() === "offline" ? "source_only_offline_mode" : "source_only_no_api";
  }
  return `source_only_${classifyProviderFailure(error)}`;
}

/** Telemetry skip reason set on retrieval when embeddings are bypassed for provider reasons. */
export const SOURCE_ONLY_EMBEDDING_SKIP_REASON = "provider_source_only";

/** One existing answer attempt, with request-local observations; this helper never retries. */
export function createObservedAnswerGenerator<T>(args: {
  generate: typeof import("@/lib/openai").generateStructuredTextResult;
  buildInput: (context: T) => string;
  schemaFor: (context: T) => Parameters<typeof import("@/lib/openai").generateStructuredTextResult>[1];
  deadline: import("@/lib/rag/rag-route-budget").AnswerRouteDeadline;
  callerSignal?: AbortSignal;
  recorder: import("@/lib/rag/rag-generation-degradation").GenerationDegradationRecorder;
  contextObservation: (
    context: T,
  ) => Pick<
    import("@/lib/rag/rag-generation-degradation").GenerationAttempt,
    "retrievalHealthy" | "coverage" | "contextCount"
  >;
  instructions: string;
  promptCacheKey: string;
  safetyIdentifier?: string;
  fastReasoningEffort: import("@/lib/openai").OpenAIReasoningEffort;
  strongReasoningEffort: import("@/lib/openai").OpenAIReasoningEffort;
  onResult: (result: import("@/lib/openai").OpenAITextResult) => void;
  onLatency: (latencyMs: number) => void;
}) {
  return async (
    model: string,
    context: T,
    options?: { strong?: boolean; qualityRetryInstruction?: string; maxOutputTokensOverride?: number },
  ) => {
    const input = options?.qualityRetryInstruction
      ? `${args.buildInput(context)}\n\nQuality retry instruction:\n${options.qualityRetryInstruction}`
      : args.buildInput(context);
    const startedAt = Date.now();
    let attempted = false;
    try {
      const timeoutMs = args.deadline.generationRequestTimeoutMs(env.OPENAI_ANSWER_TIMEOUT_MS);
      args.recorder.start({
        ...args.contextObservation(context),
        route: options?.strong ? "strong" : "fast",
        timeoutMs,
        outputBudget: options?.maxOutputTokensOverride ? "recovery" : "standard",
      });
      attempted = true;
      const result = await args.deadline.race(
        args.generate(input, args.schemaFor(context), {
          model,
          maxOutputTokens: options?.maxOutputTokensOverride ?? env.OPENAI_MAX_OUTPUT_TOKENS,
          operation: "answer",
          schemaName: "clinical_rag_answer",
          instructions: args.instructions,
          promptCacheKey: args.promptCacheKey,
          timeoutMs,
          maxRetries: 0,
          reasoningEffort: options?.strong ? args.strongReasoningEffort : args.fastReasoningEffort,
          signal: args.deadline.signal,
          safetyIdentifier: args.safetyIdentifier,
        }),
      );
      args.recorder.respond(
        result,
        Date.now() - startedAt,
        result.truncated
          ? result.incompleteReason === "max_output_tokens"
            ? "incomplete_max_output_tokens"
            : "incomplete_other"
          : "completed",
      );
      args.onResult(result);
      return result;
    } catch (error) {
      if (attempted)
        args.recorder.fail(
          classifyGenerationAttemptFailure(error, args.callerSignal, args.deadline.deadlineExceeded),
          Date.now() - startedAt,
        );
      throw error;
    } finally {
      args.onLatency(Date.now() - startedAt);
    }
  };
}

/** Caller cancellation is provenance, never inferred from the coarse timeout message. */
export function classifyGenerationAttemptFailure(
  error: unknown,
  callerSignal?: AbortSignal,
  deadlineExceeded = false,
): "caller_aborted" | "timeout" | "provider_failed" {
  if (callerSignal?.aborted || (error instanceof DOMException && error.name === "AbortError" && !deadlineExceeded))
    return "caller_aborted";
  return classifyProviderFailure(error) === "timeout" || deadlineExceeded ? "timeout" : "provider_failed";
}

export function generationIncompleteReason(result: import("@/lib/openai").OpenAITextResult) {
  return result.incompleteReason ?? (result.status === "incomplete" ? "incomplete" : "unknown");
}
export function generationRetryReason(prefix: string, result: import("@/lib/openai").OpenAITextResult) {
  const reason = generationIncompleteReason(result);
  return reason === "max_output_tokens" ? `${prefix}_max_output_tokens` : `${prefix}_incomplete_${reason}`;
}
