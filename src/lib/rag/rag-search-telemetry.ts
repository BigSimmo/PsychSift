import { retrievalPlanForQueryClass, type SearchTelemetry } from "@/lib/rag/rag-contracts";
import { buildRetrievalIntent } from "@/lib/retrieval-selection";
import type { RagQueryClass } from "@/lib/types";


/** Create the baseline telemetry shared by normal and fail-closed retrieval paths. */
export function createSearchTelemetry(query: string, queryClass: RagQueryClass): SearchTelemetry {
  return {
    search_cache_hit: false,
    query_class: queryClass,
    vector_candidate_count: 0,
    text_candidate_count: 0,
    embedding_field_count: 0,
    retrieval_query_variant_count: 0,
    rag_alias_count: 0,
    rag_alias_expansion_count: 0,
    text_fast_path_latency_ms: 0,
    text_candidate_budget: 0,
    text_fast_path_reason: null,
    embedding_skipped: false,
    embedding_skip_reason: null,
    embedding_latency_ms: 0,
    embedding_cache_hit: false,
    supabase_rpc_latency_ms: 0,
    rerank_latency_ms: 0,
    memory_card_count: 0,
    memory_top_score: 0,
    index_unit_count: 0,
    index_unit_top_score: 0,
    retrieval_plan: retrievalPlanForQueryClass(queryClass),
    retrieval_intent: buildRetrievalIntent(query, queryClass),
    retrieval_layer_counts: {},
    retrieval_layer_top_scores: {},
    retrieval_layer_latencies_ms: {},
    retrieval_provenance_counts: {},
    coverage_gate_decision: "not_applicable",
    coverage_gate_reason: null,
    vector_skipped_reason: null,
    source_image_required: false,
    source_image_satisfied: false,
    second_stage_rerank_used: false,
    second_stage_rerank_latency_ms: 0,
    visual_direct_image_count: 0,
    weighted_top_score: 0,
    rrf_top_score: 0,
  };
}
