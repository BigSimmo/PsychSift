import type {
  ClinicalQueryMode,
  CorpusGroundingVerdict,
  DocumentLabel,
  EvidenceRelevance,
  RagAnswer,
  RagProgrammeMode,
  RagQueryClass,
  SearchResult,
  RetrievalIntent,
  RetrievalSelectionSummary,
  SmartRagApiPlan,
} from "@/lib/types";
import type { RetrievalAccessScope } from "@/lib/owner-scope";
import type { VerifiedUnit } from "@/lib/answer-preview";
import type { ResolvedRagContextSnapshot } from "@/lib/rag/rag-context-snapshot";
import type { RankingConfig } from "@/lib/ranking-config";
import type { OpenAIReasoningEffort, OpenAITextResult } from "@/lib/openai";
import type { SemanticRerankGenerator } from "@/lib/semantic-rerank";
import type { ZodType } from "zod";

export type RagEvaluationSide = "baseline" | "candidate";

export type RagEvaluationOperation =
  | "adjacent_chunks"
  | "aliases"
  | "chunks_by_ids"
  | "chunks_by_indexes"
  | "corpus_terms"
  | "correct_terms"
  | "documents"
  | "embedding_fields"
  | "hybrid_chunks"
  | "images_by_ids"
  | "images_by_pages"
  | "index_units"
  | "lookup_chunk_prefix"
  | "lookup_chunk_terms"
  | "lookup_chunks"
  | "lookup_document_terms"
  | "lookup_documents"
  | "memory_cards_hybrid"
  | "memory_cards_lexical"
  | "quality"
  | "ranking_metadata"
  | "related_documents"
  | "table_facts"
  | "text_chunks"
  | "vector_chunks"
  | "visual_rows";

export type RagEvaluationReadBinding = Readonly<{
  sessionId: string;
  side: RagEvaluationSide;
  operation: RagEvaluationOperation;
  documentIds: readonly string[];
  snapshotDigest: string;
  ownerId: string | null;
  includePublic: boolean;
  provenanceDigest: string;
}>;

export type RagEvaluationReadResult<T> =
  | Readonly<{ kind: "success"; binding: RagEvaluationReadBinding; value: T }>
  | Readonly<{ kind: "unavailable"; binding: RagEvaluationReadBinding; reason: string }>;

export type RagEvaluationFailureCode =
  | "context_mismatch"
  | "dependency_error"
  | "dependency_unavailable"
  | "malformed_result"
  | "provider_error";

export type RagEvaluationProviderOperation = "embed_query" | "classify_query" | "rerank" | "generate_answer";

export type RagEvaluationFailureCollector = Readonly<{
  record(
    failure: Readonly<{
      code: RagEvaluationFailureCode;
      operation: RagEvaluationOperation | RagEvaluationProviderOperation | "context";
    }>,
  ): void;
  assertComplete(): void;
}>;

export type RagEvaluationReadScope = Readonly<{
  sessionId: string;
  side: RagEvaluationSide;
  documentIds: readonly string[];
  snapshotDigest: string;
  ownerId: string | null;
  includePublic: boolean;
}>;

type ScopedRequest<T extends object> = Readonly<RagEvaluationReadScope & T>;
type BoundRows<T> = Promise<RagEvaluationReadResult<readonly T[]>>;

export type RagEvaluationAliasRow = Readonly<{
  alias: string;
  canonical: string;
  alias_type: string;
  weight: number;
  owner_id: string | null;
}>;

export type RagEvaluationCorpusTermRow = Readonly<{
  term: string;
  has_ts_signal: boolean;
  title_doc_count: number;
  chunk_present: boolean;
  total_doc_count: number;
}>;

export type RagEvaluationDocumentMetadataRow = Readonly<{
  document_id: string;
  labels: readonly DocumentLabel[];
  summary: string | null;
}>;

export type RagEvaluationRelatedDocumentRow = RagEvaluationDocumentMetadataRow;

export type RagEvaluationQualityRow = Readonly<{
  document_id: string;
  owner_id: string | null;
  quality_score: number;
  extraction_quality: string;
  metrics: unknown;
  issues: readonly string[];
  updated_at: string;
}>;
export type RagEvaluationStoredImageRow = Readonly<{
  id: string;
  document_id: string;
  page_number: number | null;
  storage_path: string;
  caption: string;
  bbox: unknown;
  image_type: string;
  searchable: boolean;
  clinical_relevance_score: number;
  source_kind: string;
  width: number | null;
  height: number | null;
  labels: readonly string[];
  metadata: unknown;
}>;
export type RagEvaluationHydratedChunkRow = Readonly<{
  id: string;
  document_id: string;
  page_number: number | null;
  chunk_index: number;
  section_heading: string | null;
  section_path: readonly string[];
  heading_level: number | null;
  parent_heading: string | null;
  anchor_id: string | null;
  content: string;
  retrieval_synopsis: string | null;
  image_ids: readonly string[];
  index_generation_id: string | null;
}>;
export type RagEvaluationDocumentRow = Readonly<{
  id: string;
  title: string;
  file_name: string;
  metadata: unknown;
  owner_id: string | null;
  status: string;
}>;
export type RagEvaluationLookupDocumentRow = RagEvaluationDocumentRow &
  Readonly<{ page_count: number; chunk_count: number; image_count: number; text_rank?: number; match_reason?: string }>;
export type RagEvaluationLookupChunkRow = Omit<RagEvaluationHydratedChunkRow, "index_generation_id"> &
  Readonly<{ text_rank?: number }>;
export type RagEvaluationTableFactRow = Readonly<{
  id: string;
  document_id: string;
  source_chunk_id: string | null;
  source_image_id: string | null;
  page_number: number | null;
  table_title: string | null;
  row_label: string | null;
  clinical_parameter: string | null;
  threshold_value: string | null;
  action: string | null;
  text_rank: number;
  match_reason: string;
  metadata: unknown;
}>;
export type RagEvaluationEmbeddingFieldRow = Readonly<{
  id: string;
  document_id: string;
  source_chunk_id: string;
  field_type: string;
  content: string;
  similarity: number;
  text_rank: number;
  hybrid_score: number;
}>;
export type RagEvaluationIndexUnitRow = Readonly<{
  id: string;
  document_id: string;
  source_chunk_id: string;
  source_image_id: string | null;
  unit_type: string;
  title: string;
  content: string;
  page_start: number | null;
  page_end: number | null;
  heading_path: readonly string[];
  normalized_terms: readonly string[];
  source_span: unknown;
  quality_score: number;
  extraction_mode: string;
  similarity: number;
  text_rank: number;
  hybrid_score: number;
  metadata: unknown;
}>;
export type RagEvaluationVisualRow = Readonly<{
  id: string;
  document_id: string;
  page_number: number | null;
  source_kind: string;
  searchable: boolean;
  image_type: string;
  clinical_relevance_score: number;
  metadata: unknown;
}>;

export type RagEvaluationAdjacentChunkRow = Readonly<{
  id: string;
  document_id: string;
  page_number: number | null;
  chunk_index: number;
  section_heading: string | null;
  content: string;
  retrieval_synopsis: string | null;
  index_generation_id: string | null;
}>;

export type RagEvaluationReadDependencies = Readonly<{
  readAliases(
    request: ScopedRequest<Record<never, never>>,
  ): Promise<
    RagEvaluationReadResult<
      Readonly<{ ownerRows: readonly RagEvaluationAliasRow[]; publicRows: readonly RagEvaluationAliasRow[] }>
    >
  >;
  readCorpusTermStats(request: ScopedRequest<{ terms: readonly string[] }>): BoundRows<RagEvaluationCorpusTermRow>;
  correctClinicalTerms(
    request: ScopedRequest<{ input_query: string; min_sim: number }>,
  ): Promise<RagEvaluationReadResult<string>>;
  readTextChunks(
    request: ScopedRequest<{ query_text: string; match_count: number; document_filters: readonly string[] | null }>,
  ): BoundRows<SearchResult>;
  readHybridChunks(
    request: ScopedRequest<{
      query_embedding: string;
      query_text: string;
      match_count: number;
      min_similarity: number;
      document_filters: readonly string[] | null;
    }>,
  ): BoundRows<SearchResult>;
  readVectorChunks(
    request: ScopedRequest<{
      query_embedding: string;
      match_count: number;
      min_similarity: number;
      document_filter: string | null;
    }>,
  ): BoundRows<SearchResult>;
  readLookupChunks(
    request: ScopedRequest<{ query_text: string; document_filters: readonly string[] | null; match_count: number }>,
  ): BoundRows<RagEvaluationLookupChunkRow>;
  readLookupDocuments(
    request: ScopedRequest<{ query_text: string; match_count: number }>,
  ): BoundRows<RagEvaluationLookupDocumentRow>;
  readLookupChunkPrefix(
    request: ScopedRequest<{ document_filters: readonly string[] | null; match_count: number }>,
  ): BoundRows<RagEvaluationLookupChunkRow>;
  readLookupChunkTerms(
    request: ScopedRequest<{ document_filters: readonly string[] | null; terms: readonly string[]; match_count: number }>,
  ): BoundRows<RagEvaluationLookupChunkRow>;
  readLookupDocumentTerms(
    request: ScopedRequest<{ terms: readonly string[] }>,
  ): BoundRows<RagEvaluationLookupDocumentRow>;
  readTableFacts(
    request: ScopedRequest<{ query_text: string; match_count: number; document_filters: readonly string[] | null }>,
  ): BoundRows<RagEvaluationTableFactRow>;
  readEmbeddingFields(
    request: ScopedRequest<{
      query_embedding: string;
      query_text: string;
      match_count: number;
      min_similarity: number;
      document_filters: readonly string[] | null;
    }>,
  ): BoundRows<RagEvaluationEmbeddingFieldRow>;
  readIndexUnits(
    request: ScopedRequest<{
      query_embedding: string;
      query_text: string;
      match_count: number;
      min_similarity: number;
      document_filters: readonly string[] | null;
    }>,
  ): BoundRows<RagEvaluationIndexUnitRow>;
  readMemoryCardsLexical(
    request: ScopedRequest<{ query_text: string; document_filters: readonly string[] | null; match_count: number }>,
  ): BoundRows<import("@/lib/types").DocumentMemoryCard>;
  readMemoryCardsHybrid(
    request: ScopedRequest<{
      query_embedding: string;
      query_text: string;
      match_count: number;
      min_similarity: number;
      document_filters: readonly string[] | null;
    }>,
  ): BoundRows<import("@/lib/types").DocumentMemoryCard>;
  readChunksByIds(request: ScopedRequest<{ ids: readonly string[] }>): BoundRows<RagEvaluationHydratedChunkRow>;
  readChunksByIndexes(
    request: ScopedRequest<{ document_ids: readonly string[]; indexes: readonly number[]; match_count: number }>,
  ): BoundRows<RagEvaluationHydratedChunkRow>;
  readDocumentSnapshots(request: ScopedRequest<{ ids: readonly string[] }>): BoundRows<RagEvaluationDocumentRow>;
  readRankingMetadata(
    request: ScopedRequest<{ document_ids: readonly string[] }>,
  ): BoundRows<RagEvaluationDocumentMetadataRow>;
  readQuality(request: ScopedRequest<{ document_ids: readonly string[] }>): BoundRows<RagEvaluationQualityRow>;
  readImagesByIds(request: ScopedRequest<{ ids: readonly string[] }>): BoundRows<RagEvaluationStoredImageRow>;
  readImagesByPages(
    request: ScopedRequest<{ document_ids: readonly string[]; page_numbers: readonly number[] }>,
  ): BoundRows<RagEvaluationStoredImageRow>;
  readVisualCounts(request: ScopedRequest<{ document_ids: readonly string[] }>): BoundRows<RagEvaluationVisualRow>;
  readRelatedDocuments(
    request: ScopedRequest<{ document_ids: readonly string[] }>,
  ): BoundRows<RagEvaluationRelatedDocumentRow>;
  readAdjacentChunks(
    request: ScopedRequest<{ document_ids: readonly string[]; chunk_indexes: readonly number[] }>,
  ): BoundRows<RagEvaluationAdjacentChunkRow>;
}>;

export type RagEvaluationGenerationConfiguration = Readonly<{
  answerModel: string;
  fastModel: string;
  strongModel: string;
  classifierModel: string;
  indexingModel: string;
  embeddingModel: string;
  embeddingDimensions: number;
  fastReasoningEffort: OpenAIReasoningEffort;
  strongReasoningEffort: OpenAIReasoningEffort;
  answerVerbosity: "low" | "medium" | "high";
  maxOutputTokens: number;
  providerMode: "openai" | "offline";
  promptVersion: string;
  schemaVersion: string;
  classifierPromptVersion: string;
  retrievalVersion: string;
  indexingPromptVersion: string;
  semanticRerankEnabled: boolean;
  semanticRerankModel: string;
}>;

export type RagEvaluationProviderPolicy = Readonly<{
  requestTimeoutMs: number;
  answerTimeoutMs: number;
  embeddingMaxRetries: number;
  generationMaxRetries: number;
  promptCacheRetention: "off" | "in_memory" | "24h";
  promptCacheTtl: "off" | "30m" | null;
  storeResponses: boolean;
  routeBudgetMs: Readonly<{ unsupported: number; extractive: number; fast: number; strong: number }>;
  generationRecoveryReserveMs: number;
  minimumGenerationRetryMs: number;
}>;

export type RagEvaluationSdkRequestPolicy = Readonly<{
  promptCacheRetention: RagEvaluationProviderPolicy["promptCacheRetention"];
  promptCacheTtl: RagEvaluationProviderPolicy["promptCacheTtl"];
  storeResponses: boolean;
}>;

export type RagEvaluationConfiguration = Readonly<{
  generation: RagEvaluationGenerationConfiguration;
  retrieval: Readonly<{
    textWeakOrRelaxation: boolean;
  }>;
  ranking: Readonly<RankingConfig>;
}>;

export type RagEvaluationAnswerGenerationOptions = Readonly<{
  model: string;
  maxOutputTokens: number;
  operation: "answer";
  schemaName: "clinical_rag_answer";
  instructions: string;
  promptCacheKey: string;
  timeoutMs: number;
  maxRetries: 0;
  reasoningEffort: OpenAIReasoningEffort;
  textVerbosity: "low" | "medium" | "high";
  promptCacheRetention: RagEvaluationProviderPolicy["promptCacheRetention"];
  promptCacheTtl: RagEvaluationProviderPolicy["promptCacheTtl"];
  storeResponses: boolean;
  signal?: AbortSignal;
}>;

export type RagEvaluationProviderDependencies = Readonly<{
  embedQuery(
    request: Readonly<{
      query: string;
      model: string;
      dimensions: number;
      timeoutMs: number;
      maxRetries: number;
      signal?: AbortSignal;
    }>,
  ): Promise<Readonly<{ embedding: readonly number[]; cacheHit: boolean }>>;
  generateClassifier(
    input: readonly Readonly<Record<string, unknown>>[],
    schema: ZodType<unknown>,
    options: Readonly<{
      model: string;
      maxOutputTokens: 220;
      operation: "text_generation";
      instructions: string;
      reasoningEffort: "low";
      textVerbosity: "low";
      schemaName: "clinical_rag_query_classifier";
      promptCacheKey: string;
      timeoutMs: number;
      maxRetries: number;
      promptCacheRetention: RagEvaluationProviderPolicy["promptCacheRetention"];
      promptCacheTtl: RagEvaluationProviderPolicy["promptCacheTtl"];
      storeResponses: boolean;
      signal?: AbortSignal;
    }>,
  ): Promise<Readonly<{ parsed: unknown }>>;
  generateRerank(
    input: Parameters<SemanticRerankGenerator>[0],
    schema: Parameters<SemanticRerankGenerator>[1],
    options: Parameters<SemanticRerankGenerator>[2],
    policy: RagEvaluationSdkRequestPolicy,
  ): ReturnType<SemanticRerankGenerator>;
  generateAnswer(
    input: string,
    schema: Readonly<Record<string, unknown>>,
    options: RagEvaluationAnswerGenerationOptions,
  ): Promise<OpenAITextResult>;
}>;

export type RagEvaluationContext = Readonly<{
  kind: "u04-rag-evaluation-context-v1";
  sessionId: string;
  side: RagEvaluationSide;
  documentIds: readonly string[];
  snapshotDigest: string;
  ownerId: string | null;
  includePublic: boolean;
  sourceOnly: boolean;
  providerAvailable: boolean;
  configuration: RagEvaluationConfiguration;
  providerPolicy: RagEvaluationProviderPolicy;
  ragContextSnapshot: ResolvedRagContextSnapshot;
  indexingVersionAtRequestStart: Promise<string>;
  readers: RagEvaluationReadDependencies;
  providers: RagEvaluationProviderDependencies;
  failures: RagEvaluationFailureCollector;
  now(): number;
}>;

export function ragEvaluationReadScope(context: RagEvaluationContext): RagEvaluationReadScope {
  return {
    sessionId: context.sessionId,
    side: context.side,
    documentIds: context.documentIds,
    snapshotDigest: context.snapshotDigest,
    ownerId: context.ownerId,
    includePublic: context.includePublic,
  };
}

export async function acceptRagEvaluationRead<T>(
  context: RagEvaluationContext,
  operation: RagEvaluationOperation,
  read: () => Promise<RagEvaluationReadResult<T>>,
): Promise<T> {
  let result: RagEvaluationReadResult<T>;
  try {
    result = await read();
  } catch (error) {
    context.failures.record({ code: "dependency_error", operation });
    throw error;
  }
  try {
    const binding = result?.binding;
    if (
      !result || (result.kind !== "success" && result.kind !== "unavailable") || !binding ||
      binding.sessionId !== context.sessionId || binding.side !== context.side || binding.operation !== operation ||
      binding.snapshotDigest !== context.snapshotDigest || binding.ownerId !== context.ownerId ||
      binding.includePublic !== context.includePublic || !Array.isArray(binding.documentIds) ||
      binding.documentIds.length !== context.documentIds.length ||
      binding.documentIds.some((documentId, index) => documentId !== context.documentIds[index]) ||
      typeof binding.provenanceDigest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(binding.provenanceDigest) ||
      (result.kind === "success" && !Object.hasOwn(result, "value")) ||
      (result.kind === "unavailable" && typeof result.reason !== "string")
    ) throw new Error("Invalid evaluation result.");
  } catch {
    context.failures.record({ code: "malformed_result", operation });
    throw new Error(`Invalid U04 evaluation result binding for ${operation}.`);
  }
  if (result.kind === "unavailable") {
    context.failures.record({ code: "dependency_unavailable", operation });
    throw new Error(`U04 evaluation dependency unavailable for ${operation}.`);
  }
  return result.value;
}

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
  /** Internal immutable authority resolved once before request cache/coalescing lookup. */
  ragContextSnapshot?: ResolvedRagContextSnapshot;
  /** Internal bounded query-plan contract version; raw subquestions never enter cache identity. */
  ragQueryPlanVersion?: string;
  /** Internal: shares one request-start indexing-version resolution across nested cache reads. */
  cacheContext?: {
    indexingVersionAtRequestStart?: Promise<string>;
    ragContextSnapshot?: ResolvedRagContextSnapshot;
  };
};

export type RagObservationContext = {
  interactionId: string;
  rolloutMode: RagProgrammeMode;
};

export type AnswerProgressEvent = {
  stage:
    | "retrieved"
    | "ranking"
    | "routing"
    | "generating"
    | "retrying"
    | "fallback"
    | "verifying"
    | "finalizing"
    | "cached"
    | "complete";
  message: string;
  resultCount?: number;
  selectedContextCount?: number;
  australianSourceCount?: number;
  waSourceCount?: number;
  usedSupplementaryFallback?: boolean;
  visibleSourceCount?: number;
  directSourceCount?: number;
  weakSourceCount?: number;
  timingMs?: number;
  relevance?: EvidenceRelevance;
  mode?: RagAnswer["routingMode"];
  model?: string | null;
  reason?: string;
  smartApiPlan?: SmartRagApiPlan;
  verifiedUnit?: VerifiedUnit;
};

export type AnswerQuestionWithScopeArgs = SearchChunksArgs & {
  finalizeTelemetryAnswer?: (answer: RagAnswer) => RagAnswer;
  logQuery?: boolean;
  onProgress?: (event: AnswerProgressEvent) => void | Promise<void>;
  observationContext?: RagObservationContext;
};

export type SearchTelemetry = {
  search_cache_hit: boolean;
  site_content_state?: "current" | "updating" | "stale" | "unavailable" | "disabled";
  site_content_static_manifest_match?: boolean;
  site_content_pending_bucket?: "none" | "one" | "few" | "many";
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
  query_plan_kind?: import("@/lib/types").RagQueryPlanKind;
  subquestion_count?: number;
  query_plan_reason_codes?: string[];
  candidate_retrieval_query_variant_count?: number;
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
