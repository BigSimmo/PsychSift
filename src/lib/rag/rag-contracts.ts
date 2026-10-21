import type {
  ClinicalQueryMode,
  CorpusGroundingVerdict,
  RagQueryClass,
  RagQueryPlan,
  RetrievalIntent,
  RetrievalSelectionSummary,
} from "@/lib/types";
import type { RetrievalAccessScope } from "@/lib/owner-scope";
import type { RagProgrammeMode } from "@/lib/rag/rag-programme-eval";
import type { RagContextSnapshotInput, RagRequestContext } from "@/lib/rag/rag-context-snapshot";
import type { SiteContentDomain, SiteContentPartitionState } from "@/lib/types";
import type { SourcePolicyConflict } from "@/lib/types";

export type { RagContextSnapshotInput, RagRequestContext } from "@/lib/rag/rag-context-snapshot";
export type { RagContextSnapshot } from "@/lib/site-content/site-content-contracts";

export type RagObservationContext = {
  interactionId: string;
  rolloutMode: RagProgrammeMode;
};

export type RagCandidateMatchCounts = { matched: number; partial_match: number; absent: number };

export function sanitizeRagCandidateMatchCounts(
  value: unknown,
  expectedSubquestionCount?: number,
): RagCandidateMatchCounts | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const counts = value as Record<keyof RagCandidateMatchCounts, unknown>;
  const bounded = (count: unknown) => Number.isInteger(count) && Number(count) >= 0 && Number(count) <= 4;
  if (!bounded(counts.matched) || !bounded(counts.partial_match) || !bounded(counts.absent)) return undefined;
  const sanitized = {
    matched: Number(counts.matched),
    partial_match: Number(counts.partial_match),
    absent: Number(counts.absent),
  };
  if (
    expectedSubquestionCount !== undefined &&
    (!Number.isInteger(expectedSubquestionCount) ||
      expectedSubquestionCount < 0 ||
      expectedSubquestionCount > 4 ||
      Object.values(sanitized).reduce((sum, count) => sum + count, 0) !== expectedSubquestionCount)
  )
    return undefined;
  return sanitized;
}

export type SearchChunksArgs = {
  query: string;
  /** Explicit request policy; document filters remain restrictive in either mode. */
  answerSourcePolicy?: "only_this_source" | "primary_plus_approved_supplements";
  /** Server-configured reviewed-input adapter; never accepted from an HTTP payload. */
  loadReviewedSourcePolicyInput?: import("@/lib/rag/rag-reviewed-policy-input").ReviewedSourcePolicyLoader;
  reviewedPolicyRequest?: import("@/lib/rag/rag-reviewed-policy-input").ReviewedPolicyRequest;
  captureSourcePolicyConflicts?: (conflicts: readonly SourcePolicyConflict[]) => void;
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
  /** Caller-injected immutable public-corpus facts, resolved once at the exported request boundary. */
  ragContextSnapshotInput?: RagContextSnapshotInput;
  /** Internal: the exact frozen request snapshot shared by nested retrieval/cache calls. */
  ragRequestContext?: RagRequestContext;
  /** Internal bounded query-plan contract version; raw subquestions never enter cache identity. */
  ragQueryPlanVersion?: string;
  /** Internal programme mode for shadow diagnostics and cache partitioning. */
  ragQueryPlanMode?: RagProgrammeMode;
  /** Server-issued immutable decision; unissued caller objects cannot activate a rollout. */
  ragProgrammeRollout?: import("@/lib/rag/rag-rollout").RagProgrammeRolloutDecision;
  /** Internal bounded diagnostics carried into answer cache/programme observation. */
  ragQueryPlanKind?: import("@/lib/rag/rag-programme-eval").RagQueryPlanKind;
  ragSubquestionCount?: number;
  /** Internal shadow-only, content-free per-subquestion candidate-match diagnostics. */
  ragCandidateMatchCounts?: RagCandidateMatchCounts;
  /** Internal default-off candidate-lane policy. Absence disables all governed v3 work. */
  governedCorpusComponents?: GovernedCorpusComponents;
  /** @deprecated Supplementary retrieval derives from request-local eligible coverage gaps. */
  governedInternationalCoverageGap?: boolean;
  /** Request-local canonical policy inputs; never serialized into cache or telemetry identity. */
  sourcePolicyConflicts?: readonly SourcePolicyConflict[];
  /** Request-local handoff of the exact served plan; never persisted in cache identity or telemetry. */
  captureRagQueryPlan?: (plan: RagQueryPlan) => void;
};

export type GovernedCorpusComponents = Readonly<{
  siteContent: boolean;
  australianAugmentation: boolean;
  australianCurrent: boolean;
}>;

export type GovernedCorpusComponentState = Readonly<{
  siteContent: "enabled" | "disabled";
  australianAugmentation: "enabled_current" | "enabled_unavailable" | "disabled";
}>;

export function governedCorpusComponentState(components?: GovernedCorpusComponents): GovernedCorpusComponentState {
  return {
    siteContent: components?.siteContent ? "enabled" : "disabled",
    australianAugmentation: !components?.australianAugmentation
      ? "disabled"
      : components.australianCurrent
        ? "enabled_current"
        : "enabled_unavailable",
  };
}

export type RetrievalCorpusScopePolicy = Readonly<{
  siteContentEnabled: boolean;
  siteContentState: SiteContentPartitionState;
  australianAugmentationEnabled: boolean;
  australianCurrent: boolean;
  /** @deprecated Retained for call-site compatibility; it has no retrieval effect. */
  internationalCoverageGap?: boolean;
}>;

export type GovernedCorpusRetrievalPhase = Readonly<{
  corpusScopes: import("@/lib/types").SourceCorpusScope[];
  accessScope: RetrievalAccessScope;
  phase: "primary" | "supplementary";
}>;

export type GovernedCorpusCandidateDiagnostics = Readonly<{
  rpcCalls: number;
  resultCount: number;
  selectedSiteDomains: SiteContentDomain[];
}>;

export type SearchTelemetry = {
  shadow_retrieval_state?: "pending" | "completed" | "failed" | "cancelled";
  reviewed_input_state?: "not_assessed" | "unavailable" | "reviewed";
  search_cache_hit: boolean;
  search_total_latency_ms?: number;
  retrieval_phase_latencies_ms?: Record<string, number>;
  /** Measurement only: start/finish offsets (ms from search start) of each sequential retrieval stage. */
  retrieval_stage_timeline_ms?: RetrievalStageTiming[];
  shared_cache_hit?: boolean;
  shared_cache_status?: "hit" | "miss";
  shared_cache_miss_reason?: string | null;
  query_class?: RagQueryClass;
  vector_candidate_count?: number;
  text_candidate_count?: number;
  embedding_field_count?: number;
  retrieval_query_variant_count?: number;
  query_plan_kind?: import("@/lib/rag/rag-programme-eval").RagQueryPlanKind;
  subquestion_count?: number;
  query_plan_reason_codes?: string[];
  candidate_retrieval_query_variant_count?: number;
  candidate_match_counts?: RagCandidateMatchCounts;
  governed_component_state?: GovernedCorpusComponentState;
  governed_candidate_rpc_calls?: number;
  governed_candidate_count?: number;
  governed_candidate_site_domains?: SiteContentDomain[];
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
  /** Measurement only: one entry per lexical text-RPC variant (ran or skipped), in issue order. */
  text_rpc_variant_timings?: TextRpcVariantTiming[];
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

/** Measurement-only record of one lexical text-RPC variant. Offsets are ms from the text stage start. */
export type TextRpcVariantTiming = {
  rpc: string;
  variant_index: number;
  role: "primary" | "follow_up" | "weak_or" | "corrected" | "relaxed";
  ran: boolean;
  skipped_reason?: string;
  started_offset_ms: number | null;
  finished_offset_ms: number | null;
  rpc_ms: number | null;
  row_count: number | null;
  rpc_error?: boolean;
};

/** Measurement-only record of one sequential retrieval stage. Offsets are ms from search start. */
export type RetrievalStageTiming = { stage: string; started_offset_ms: number; finished_offset_ms: number };
