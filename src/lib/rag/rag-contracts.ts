import type {
  ClinicalQueryMode,
  CorpusGroundingVerdict,
  RagProgrammeMode,
  RagQueryClass,
  RetrievalIntent,
  RetrievalSelectionSummary,
} from "@/lib/types";
import type { RetrievalAccessScope } from "@/lib/owner-scope";

export type SearchChunksArgs = {
  query: string;
  topK?: number;
  minSimilarity?: number;
  documentId?: string;
  documentIds?: string[];
  ownerId?: string;
  accessScope?: RetrievalAccessScope;
  allowGlobalSearch?: boolean;
  skipCache?: boolean;
  queryMode?: ClinicalQueryMode;
  signal?: AbortSignal;
  // Internal: set when this call is a re-run on a trigram-corrected query, to prevent the
  // unsupported-short-circuit typo-correction path from recursing more than once.
  typoCorrected?: boolean;
  // Diagnostic/eval-only: bypass every lexical text-fast-path so retrieval always exercises
  // the embedding/vector stage. Never set on production paths.
  forceEmbedding?: boolean;
  // Lightweight-preview only: return lexical/trigram candidates without an embedding call.
  lexicalOnly?: boolean;
  /** Internal: shares one request-start indexing-version resolution across nested cache reads. */
  cacheContext?: {
    indexingVersionAtRequestStart?: Promise<string>;
  };
};

export type RagObservationContext = {
  interactionId: string;
  rolloutMode: RagProgrammeMode;
};

export type SearchTelemetry = {
  search_cache_hit: boolean;
  search_total_latency_ms?: number;
  retrieval_phase_latencies_ms?: Record<string, number>;
  shared_cache_hit?: boolean;
  shared_cache_status?: "hit" | "miss";
  shared_cache_miss_reason?: string | null;
  query_class?: RagQueryClass;
  vector_candidate_count?: number;
  text_candidate_count?: number;
  embedding_field_count?: number;
  retrieval_query_variant_count?: number;
  rag_alias_count?: number;
  rag_alias_expansion_count?: number;
  text_fast_path_latency_ms: number;
  text_candidate_budget?: number;
  text_fast_path_reason?: string | null;
  text_or_relaxation_used?: "none" | "empty_fallback" | "weak_augment";
  /** RPCs actually issued per lexical surface after variant early-exit (PT-02). */
  text_variant_rpc_calls?: Record<string, number>;
  /** True when at least one lexical surface skipped its sibling variants. */
  text_variant_early_exit?: boolean;
  corpus_grounding?: CorpusGroundingVerdict;
  synthetic_similarity_count?: number;
  embedding_skipped: boolean;
  embedding_skip_reason?: string | null;
  embedding_latency_ms: number;
  embedding_cache_hit: boolean;
  /** True when the query-embedding warm-up flight was started ahead of the lexical stages. */
  embedding_prefetched?: boolean;
  supabase_rpc_latency_ms: number;
  rerank_latency_ms: number;
  memory_card_count?: number;
  memory_top_score?: number;
  index_unit_count?: number;
  index_unit_top_score?: number;
  retrieval_layer_counts?: Record<string, number>;
  retrieval_layer_top_scores?: Record<string, number>;
  retrieval_layer_latencies_ms?: Record<string, number>;
  hybrid_rpc_errors?: Record<string, string>;
  retrieval_provenance_counts?: Record<string, number>;
  retrieval_plan?: string;
  retrieval_intent?: RetrievalIntent;
  retrieval_selection?: RetrievalSelectionSummary;
  coverage_gate_decision?: "accepted" | "rejected" | "not_applicable";
  coverage_gate_reason?: string | null;
  vector_skipped_reason?: string | null;
  source_image_required?: boolean;
  source_image_satisfied?: boolean;
  second_stage_rerank_used?: boolean;
  second_stage_rerank_latency_ms?: number;
  semantic_rerank_eligibility?:
    | "disabled"
    | "provider_unavailable"
    | "request_mode"
    | "insufficient_candidates"
    | "unambiguous"
    | "eligible_score_gap"
    | "eligible_ranking_disagreement";
  semantic_rerank_invoked?: boolean;
  semantic_rerank_model?: string;
  semantic_rerank_candidate_count?: number;
  semantic_rerank_latency_ms?: number;
  semantic_rerank_outcome?: "not_invoked" | "reordered" | "unchanged" | "fallback";
  semantic_rerank_fallback_reason?:
    | "timeout"
    | "refusal"
    | "malformed_output"
    | "missing_candidate_id"
    | "duplicate_candidate_id"
    | "unknown_candidate_id"
    | "provider_error";
  visual_direct_image_count?: number;
  weighted_top_score?: number;
  rrf_top_score?: number;
  top_score?: number;
  second_top_score?: number;
  score_spread?: number;
  score_distinct_documents?: number;
  retrieval_candidate_count?: number;
  retrieval_strategy?:
    | "search_cache"
    | "text_fast_path"
    | "document_lookup_fast_path"
    | "hybrid"
    | "vector_fallback"
    | "unsupported_short_circuit";
};

export function retrievalPlanForQueryClass(queryClass?: RagQueryClass) {
  switch (queryClass) {
    case "document_lookup":
      return "document_lookup:title_label_section_then_chunks";
    case "table_threshold":
      return "table_threshold:table_facts_visual_units_then_chunks";
    case "medication_dose_risk":
      return "medication_dose_risk:medication_rows_thresholds_monitoring_then_chunks";
    case "comparison":
      return "comparison:diverse_documents_sections_memory_then_chunks";
    case "broad_summary":
      return "broad_summary:document_summaries_sections_memory_then_chunks";
    default:
      return "balanced_hybrid:chunks_fields_units_memory";
  }
}
