import { normalizedQueryTextForStorage, queryTextForStorage } from "@/lib/query-privacy";
import { retrievalProgrammeTelemetryMetadata } from "@/lib/rag/rag-answer-telemetry-metadata";
import type { RagObservationContext } from "@/lib/rag/rag-contracts";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import type { RagAnswer } from "@/lib/types";

// Per-answer observability (threat-model §7 follow-up).
//
// The retrieval-side /api/search path writes rag_retrieval_logs, but the answer
// paths (/api/answer and /api/answer/stream) wrote NOTHING — so an answer's
// generation route, model, token usage, and cost were only observable via
// eval:rag, never in production. This records one rag_retrieval_logs row per
// answered request (the answer path DOES retrieve, so a retrieval-log row is
// the right home) and carries the answer-side telemetry in the freeform
// `metadata.answer` object. Using the existing table + `metadata` JSONB keeps
// this a zero-migration, zero-schema-drift change; a dedicated `rag_answer_logs`
// table with typed cost columns is the fuller Phase-7 design.
//
// Rows are tagged `metadata.answer.log_source = "answer"` so answer-path
// retrievals are filterable apart from the search-path retrieval telemetry that
// shares the table.

const UUID_PATTERN = /^[0-9a-f-]{36}$/i;

// The subset of a generated answer this telemetry reads. Kept as a Pick so the
// builder is decoupled from the full RagAnswer surface and trivially testable.
export type AnswerTelemetrySource = Pick<
  RagAnswer,
  | "grounded"
  | "confidence"
  | "sources"
  | "queryClass"
  | "modelUsed"
  | "routingMode"
  | "routingReason"
  | "providerMode"
  | "answerQualityTier"
  | "responseMode"
  | "fallbackReason"
  | "degradedMode"
  | "openAIUsage"
  | "openAIRequestIds"
  | "latencyTimings"
  | "retrievalDiagnostics"
>;

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function meanHybridScore(sources: AnswerTelemetrySource["sources"]): number | null {
  const scores = (sources ?? []).slice(0, 20).map((source) => source.hybrid_score ?? source.similarity ?? 0);
  if (scores.length === 0) return null;
  const mean = scores.reduce((total, score) => total + score, 0) / scores.length;
  return mean || null;
}

// Build the rag_retrieval_logs insert row for an answered request. Pure and
// synchronous so it can be unit-tested without a database.
export function buildAnswerLogRow(args: {
  query: string;
  ownerId?: string | null;
  answer: AnswerTelemetrySource;
  observationContext?: RagObservationContext;
}) {
  const { answer } = args;
  const sources = answer.sources ?? [];
  const topSource = sources[0] ?? null;
  const topScore = topSource ? (topSource.hybrid_score ?? topSource.similarity ?? 0) : 0;
  const timings = answer.latencyTimings ?? {};
  const usage = answer.openAIUsage ?? {};
  const isMiss = answer.grounded === false || answer.confidence === "unsupported";

  const answerTelemetry = {
    ...retrievalProgrammeTelemetryMetadata(args.observationContext, answer, sources.length),
    log_source: "answer",
    route: answer.routingMode ?? answer.retrievalDiagnostics?.routeMode ?? null,
    model: answer.modelUsed ?? null,
    provider_mode: answer.providerMode ?? null,
    quality_tier: answer.answerQualityTier ?? null,
    confidence: answer.confidence,
    grounded: answer.grounded,
    response_mode: answer.responseMode ?? null,
    routing_reason: answer.routingReason ?? null,
    fallback_reason: answer.fallbackReason ?? null,
    degraded: answer.degradedMode?.active ?? false,
    generation_latency_ms: finiteOrNull(timings.generation_latency_ms),
    search_latency_ms: finiteOrNull(timings.search_latency_ms),
    answer_retry_count: finiteOrNull(timings.answer_retry_count),
    embedding_prefetched: typeof timings.embedding_prefetched === "boolean" ? timings.embedding_prefetched : null,
    request_ids: answer.openAIRequestIds ?? [],
    // Raw token counts are the durable primitive — USD cost = tokens × per-model
    // price is derived downstream from a pricing table, not baked into the row.
    tokens: {
      input: finiteOrNull(usage.input_tokens),
      output: finiteOrNull(usage.output_tokens),
      total: finiteOrNull(usage.total_tokens),
      cached_input: finiteOrNull(usage.cached_input_tokens),
      reasoning_output: finiteOrNull(usage.reasoning_output_tokens),
    },
  };

  return {
    owner_id: args.ownerId ?? null,
    query: queryTextForStorage(args.query),
    normalized_query: normalizedQueryTextForStorage(args.query),
    query_class: answer.queryClass ?? answer.retrievalDiagnostics?.queryClass ?? null,
    candidate_count: sources.length,
    top_similarity: finiteOrNull(topSource?.similarity),
    top_hybrid_score: finiteOrNull(topScore),
    mean_hybrid_score: meanHybridScore(sources),
    selected_chunk_ids: sources
      .slice(0, 12)
      .map((source) => source.id)
      .filter((id) => UUID_PATTERN.test(id)),
    selected_document_ids: [...new Set(sources.slice(0, 12).map((source) => source.document_id))].filter((id) =>
      UUID_PATTERN.test(id),
    ),
    selected_count: Math.min(sources.length, 12),
    embedding_latency_ms: finiteOrNull(timings.embedding_latency_ms),
    rpc_latency_ms: finiteOrNull(timings.supabase_rpc_latency_ms),
    rerank_latency_ms: finiteOrNull(timings.rerank_latency_ms),
    total_latency_ms: finiteOrNull(timings.total_latency_ms),
    vector_candidate_count: finiteOrNull(timings.vector_candidate_count),
    text_candidate_count: finiteOrNull(timings.text_candidate_count),
    embedding_field_count: finiteOrNull(timings.embedding_field_count),
    embedding_cache_hit: typeof timings.embedding_cache_hit === "boolean" ? timings.embedding_cache_hit : null,
    is_miss: isMiss,
    miss_reason: isMiss ? (answer.fallbackReason ?? answer.responseMode ?? "unsupported") : null,
    metadata: { answer: answerTelemetry } as unknown as Json,
  };
}

// Fire-and-forget writer, mirroring logRetrievalDiagnostics in /api/search: a
// logging failure must never affect the answer response, so the insert is
// detached and its error swallowed (with a throttled warning).
let answerLogFailureCount = 0;

export async function logAnswerDiagnostics(args: {
  supabase: ReturnType<typeof createAdminClient>;
  query: string;
  ownerId?: string | null;
  answer: AnswerTelemetrySource;
  observationContext?: RagObservationContext;
}) {
  try {
    const { error } = await args.supabase.from("rag_retrieval_logs").insert(buildAnswerLogRow(args));
    if (error) throw error;
  } catch (error) {
    answerLogFailureCount += 1;
    if (answerLogFailureCount <= 3 || answerLogFailureCount % 25 === 0) {
      console.warn("rag_retrieval_logs answer insert failed", {
        failures: answerLogFailureCount,
        message: error instanceof Error ? error.message : "unknown answer logging error",
      });
    }
  }
}

export const DEFAULT_RETRIEVAL_LOG_RETENTION_DAYS = 90;

export async function pruneExpiredRetrievalLogs(
  supabase: ReturnType<typeof createAdminClient>,
  retentionDays: number = DEFAULT_RETRIEVAL_LOG_RETENTION_DAYS,
): Promise<{ deletedCount: number | null; error: Error | null }> {
  try {
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const { count, error } = await supabase
      .from("rag_retrieval_logs")
      .delete({ count: "exact" })
      .lt("created_at", cutoffDate);
    if (error) throw new Error(error.message);
    return { deletedCount: count, error: null };
  } catch (err) {
    return { deletedCount: null, error: err instanceof Error ? err : new Error(String(err)) };
  }
}
