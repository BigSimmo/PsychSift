import { env } from "@/lib/env";
import { rankAnswerEvidence } from "@/lib/answer-ranking";
import { buildCrossDocumentFusionBrief, buildCrossDocumentSynthesisPlan } from "@/lib/cross-document-synthesis";
import { buildAnswerScoreExplanations, buildIndexingQuality, collectMemoryCards } from "@/lib/rag/rag-answer-support";
import { memoryCardChunkScore } from "@/lib/rag/rag-candidate-sources";
import type { RagAnswer, RagQueryClass } from "@/lib/types";

type AnswerLatencyTimings = NonNullable<RagAnswer["latencyTimings"]>;

/**
 * Packet B1 (docs/rag-improvement/README.md §B1): the tail latency fields every
 * answer-path `rag_queries.metadata` block persists, plus the extended fields added
 * behind `RAG_TELEMETRY_EXTENDED` (default false — that flag is the whole-surface
 * rollback for B1).
 *
 * The extended projection is fail-closed by construction: only keys named in
 * `EXTENDED_ANSWER_TELEMETRY_ALLOWLIST` are read from the timings object, and only
 * finite numbers are emitted, so free text — including the adversarial-fixture canary
 * tokens — can never reach the telemetry sink through this path even from a
 * contaminated input. `tests/rag-telemetry-canary-absence.test.ts` pins both
 * properties against the registered canary tokens, and pins that the flag-off shape
 * is byte-identical to the legacy three-field output.
 */
export const EXTENDED_ANSWER_TELEMETRY_ALLOWLIST = ["verification_latency_ms"] as const;

type ExtendedAnswerTelemetryKey = (typeof EXTENDED_ANSWER_TELEMETRY_ALLOWLIST)[number];

export function extendedAnswerTelemetryFields(
  timings: AnswerLatencyTimings | null | undefined,
): Partial<Record<ExtendedAnswerTelemetryKey, number>> {
  if (!env.RAG_TELEMETRY_EXTENDED) return {};
  const source: Record<string, unknown> = timings ?? {};
  const fields: Partial<Record<ExtendedAnswerTelemetryKey, number>> = {};
  for (const key of EXTENDED_ANSWER_TELEMETRY_ALLOWLIST) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) fields[key] = value;
  }
  return fields;
}

export function answerLatencyMetadata(
  searchLatencyMs: number,
  generationLatencyMs: number,
  timings: AnswerLatencyTimings | null | undefined,
  startedAt: number,
): Record<string, unknown> {
  return {
    search_latency_ms: searchLatencyMs,
    generation_latency_ms: generationLatencyMs,
    total_latency_ms: timings?.total_latency_ms ?? Date.now() - startedAt,
    ...extendedAnswerTelemetryFields(timings),
  };
}

/** Persist answer-scoped evidence metadata from the exact sources that survived final retention. */
export function answerScopedEvidenceMetadata(
  query: string,
  queryClass: RagQueryClass,
  answer: Pick<RagAnswer, "sources" | "indexingVersion">,
) {
  const sources = answer.sources;
  const ranking = rankAnswerEvidence(query, sources, queryClass);
  const crossDocumentPlan = buildCrossDocumentSynthesisPlan(query, sources, queryClass);
  const fusionBrief = crossDocumentPlan.enabled
    ? buildCrossDocumentFusionBrief(query, crossDocumentPlan.results)
    : null;
  const memoryCards = collectMemoryCards(sources);
  const indexingQuality = buildIndexingQuality(sources, memoryCards);
  const scoreExplanations = buildAnswerScoreExplanations(sources);
  return {
    answer_rank_top_score: ranking.topScore,
    answer_ranked_source_count: ranking.rankedSourceCount,
    answer_rank_strategy: ranking.strategy,
    answer_rank_query_class: ranking.queryClass,
    cross_document_synthesis: crossDocumentPlan.enabled,
    cross_document_reason: crossDocumentPlan.reason,
    cross_document_count: crossDocumentPlan.documentCount,
    cross_document_selected_count: crossDocumentPlan.selectedDocumentCount,
    cross_document_selected_source_count: crossDocumentPlan.selectedSourceCount,
    cross_document_fusion_bullets: fusionBrief?.bulletCount ?? 0,
    cross_document_fusion_source_chunk_ids: fusionBrief?.sourceChunkIds ?? [],
    memory_card_count: memoryCards.length,
    memory_top_score: Number(
      Math.max(
        0,
        ...sources.map((source) => source.memory_score ?? 0),
        ...memoryCards.map(memoryCardChunkScore),
      ).toFixed(4),
    ),
    indexing_version: answer.indexingVersion ?? indexingQuality.indexingVersion ?? null,
    indexing_extraction_quality: indexingQuality.extractionQuality,
    indexing_stale: indexingQuality.stale,
    ...scoreExplanationLogMetadata(scoreExplanations),
  };
}

export function scoreExplanationLogMetadata(scoreExplanations: NonNullable<RagAnswer["scoreExplanations"]>) {
  return {
    score_explanation_count: scoreExplanations.length,
    top_cited_score_explanations: scoreExplanations.slice(0, 8).map((entry) => ({
      chunk_id: entry.chunk_id,
      document_id: entry.document_id,
      final_score: entry.finalScore,
      vector_score: entry.score_explanation?.vectorScore ?? null,
      text_rank: entry.score_explanation?.textRank ?? null,
      weighted_hybrid_score: entry.score_explanation?.weightedHybridScore ?? null,
      rrf_score: entry.score_explanation?.rrfScore ?? null,
      memory_boost: entry.score_explanation?.memoryBoost ?? null,
      title_boost: entry.score_explanation?.titleBoost ?? null,
      metadata_boost: entry.score_explanation?.metadataBoost ?? null,
      lexical_coverage_score: entry.score_explanation?.lexicalCoverageScore ?? null,
      metadata_match_score: entry.score_explanation?.metadataMatchScore ?? null,
      section_title_match_boost: entry.score_explanation?.sectionTitleMatchBoost ?? null,
      freshness_recency_boost: entry.score_explanation?.freshnessRecencyBoost ?? null,
      clinical_signal_boost: entry.score_explanation?.clinicalSignalBoost ?? null,
      penalty: entry.score_explanation?.penalty ?? null,
      final_rank: entry.score_explanation?.finalRank ?? null,
    })),
  };
}
