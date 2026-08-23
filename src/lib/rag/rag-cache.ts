import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildClinicalTextSearchQuery } from "@/lib/clinical-search";
import { readExpiringCacheEntry, writeBoundedExpiringCacheEntry } from "@/lib/bounded-ttl-cache";
import { ragDeepMemoryVersion } from "@/lib/deep-memory";
import { env } from "@/lib/env";
import { queryCacheKeyForStorage } from "@/lib/query-privacy";
import { ragCacheKeyMatchesOwner } from "@/lib/rag/rag-cache-utils";
import { retrievalAccessScopeForArgs, retrievalAccessScopeKey } from "@/lib/owner-scope";
import { compactContextText } from "@/lib/rag/rag-source-block";
import { committedIndexGeneration } from "@/lib/reindex-pipeline";
import { normalizeSourceMetadata } from "@/lib/source-metadata";
import { retrievalPlanForQueryClass, type SearchChunksArgs, type SearchTelemetry } from "@/lib/rag/rag-contracts";
import type { Json } from "@/lib/supabase/database.types";
import type { RagAnswer, RagQueryClass, SearchResult } from "@/lib/types";
import {
  ragAnswerPromptVersion,
  ragAnswerSchemaVersion,
  ragIndexingPromptVersion,
  ragQueryClassifierPromptVersion,
} from "@/lib/rag/rag-versioning";

const answerCache = new Map<string, { expiresAt: number; answer: RagAnswer; indexingVersion: string }>();
export const answerInflight = new Map<string, Promise<RagAnswer>>();
const searchCache = new Map<
  string,
  { expiresAt: number; results: SearchResult[]; telemetry: SearchTelemetry; indexingVersion: string }
>();
const ragCacheDependencyVersion = "rag-cache-v20";
const cacheIndexingVersionTtlMs = 5000;
const cacheIndexingVersionMaxEntries = 512;
const cacheIndexingVersionCache = new Map<string, { expiresAt: number; value: string }>();
const publicSourceAuthorityUnavailable = `${ragDeepMemoryVersion}:public-authority-unavailable`;

function cacheAuthorityAvailable(indexingVersion: string) {
  return indexingVersion !== publicSourceAuthorityUnavailable;
}
/**
 * Invalidation generations for deferred `setCachedAnswer` promotions. Review /
 * table-fact mutations do not change the documents indexing stamp, so the
 * mid-request staleness guard alone cannot catch them. Epochs are owner-scoped
 * so one tenant's invalidation cannot suppress another tenant's valid write;
 * a null/undefined ownerId bump (full clear) advances the global epoch.
 */
let ragCacheGlobalInvalidationEpoch = 0;
const ragCacheOwnerInvalidationEpoch = new Map<string, number>();

type InvalidationEpochStamp = { global: number; owner: number };

function captureInvalidationEpoch(ownerId?: string | null): InvalidationEpochStamp {
  return {
    global: ragCacheGlobalInvalidationEpoch,
    owner: ownerId ? (ragCacheOwnerInvalidationEpoch.get(ownerId) ?? 0) : 0,
  };
}

function invalidationEpochChanged(ownerId: string | null | undefined, stamp: InvalidationEpochStamp) {
  if (ragCacheGlobalInvalidationEpoch !== stamp.global) return true;
  if (ownerId && (ragCacheOwnerInvalidationEpoch.get(ownerId) ?? 0) !== stamp.owner) return true;
  return false;
}

function bumpInvalidationEpoch(ownerId?: string | null) {
  if (!ownerId) {
    ragCacheGlobalInvalidationEpoch += 1;
    return;
  }
  ragCacheOwnerInvalidationEpoch.set(ownerId, (ragCacheOwnerInvalidationEpoch.get(ownerId) ?? 0) + 1);
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted.", "AbortError");
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortReason(signal);
}

function documentScopeKey(args: Pick<SearchChunksArgs, "documentId" | "documentIds">) {
  const scope = args.documentIds?.length
    ? [...args.documentIds].sort().join(",")
    : args.documentId
      ? args.documentId
      : "all-documents";
  return scope;
}

function scopeKey(args: Pick<SearchChunksArgs, "documentId" | "documentIds" | "ownerId" | "accessScope">) {
  return `${retrievalAccessScopeKey(retrievalAccessScopeForArgs(args))}|${documentScopeKey(args)}`;
}

function normalizedCacheQuery(query: string) {
  return buildClinicalTextSearchQuery(query).toLowerCase().replace(/\s+/g, " ").trim();
}

function cacheIndexingVersionCacheKey(
  args: Pick<SearchChunksArgs, "documentId" | "documentIds" | "ownerId" | "accessScope">,
) {
  return scopeKey(args);
}

function modeKey(args: Pick<SearchChunksArgs, "queryMode">) {
  return args.queryMode ?? "auto";
}

export type AnswerGenerationFingerprintInput = {
  answerModel: string;
  fastModel: string;
  strongModel: string;
  classifierModel: string;
  indexingModel: string;
  embeddingModel: string;
  embeddingDimensions: number;
  fastReasoningEffort: string;
  strongReasoningEffort: string;
  answerVerbosity: string;
  maxOutputTokens: number;
  providerMode: string;
  promptVersion: string;
  schemaVersion: string;
  classifierPromptVersion: string;
  retrievalVersion: string;
  indexingPromptVersion: string;
  semanticRerankEnabled: boolean;
  semanticRerankModel: string;
};

export function buildAnswerGenerationFingerprint(input: AnswerGenerationFingerprintInput) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 20);
}

export function answerGenerationFingerprint() {
  return buildAnswerGenerationFingerprint({
    answerModel: env.OPENAI_ANSWER_MODEL,
    fastModel: env.OPENAI_FAST_ANSWER_MODEL,
    strongModel: env.OPENAI_STRONG_ANSWER_MODEL,
    classifierModel: env.OPENAI_QUERY_CLASSIFIER_MODEL,
    indexingModel: env.OPENAI_INDEXING_MODEL,
    embeddingModel: env.OPENAI_EMBEDDING_MODEL,
    embeddingDimensions: env.EMBEDDING_DIMENSIONS,
    fastReasoningEffort: env.OPENAI_FAST_REASONING_EFFORT,
    strongReasoningEffort: env.OPENAI_STRONG_REASONING_EFFORT,
    answerVerbosity: env.OPENAI_TEXT_VERBOSITY,
    maxOutputTokens: env.OPENAI_MAX_OUTPUT_TOKENS,
    providerMode: env.RAG_PROVIDER_MODE,
    promptVersion: ragAnswerPromptVersion,
    schemaVersion: ragAnswerSchemaVersion,
    classifierPromptVersion: ragQueryClassifierPromptVersion,
    retrievalVersion: ragDeepMemoryVersion,
    indexingPromptVersion: ragIndexingPromptVersion,
    semanticRerankEnabled: env.RAG_SEMANTIC_RERANK_ENABLED,
    semanticRerankModel: env.OPENAI_RERANK_MODEL,
  });
}

function sharedAnswerNormalizedQuery(args: Pick<SearchChunksArgs, "query" | "queryMode">) {
  const query = normalizedCacheQuery(`${modeKey(args)} ${args.query}`);
  return queryCacheKeyForStorage(`${query}|generation:${answerGenerationFingerprint()}`);
}

export function scopedAnswerCacheKey(
  args: Pick<SearchChunksArgs, "query" | "documentId" | "documentIds" | "ownerId" | "accessScope" | "queryMode">,
) {
  return [
    ragCacheDependencyVersion,
    scopeKey(args),
    modeKey(args),
    `generation:${answerGenerationFingerprint()}`,
    args.query.trim().toLowerCase().replace(/\s+/g, " "),
  ].join("|");
}

export function cloneAnswer(answer: RagAnswer) {
  return structuredClone(answer);
}

/** Anonymous callers share no stable identity, so their PHI-bearing answers must never be cached or coalesced. */
export function answerCacheAllowedForOwner(ownerId?: string | null) {
  return Boolean(ownerId);
}

export async function getCachedAnswer(
  args: Pick<
    SearchChunksArgs,
    "query" | "documentId" | "documentIds" | "ownerId" | "accessScope" | "skipCache" | "queryMode"
  >,
  startedAt: number,
  options?: { indexingVersionAtRequestStart?: string | null },
): Promise<RagAnswer | null> {
  if (!answerCacheAllowedForOwner(args.ownerId) || args.skipCache) return null;
  if (env.RAG_ANSWER_CACHE_TTL_MS <= 0 || env.RAG_ANSWER_CACHE_SIZE <= 0) return null;

  const indexingVersion = await cacheIndexingVersion(args);
  if (!indexingVersion || !cacheAuthorityAvailable(indexingVersion)) return null;
  if (options?.indexingVersionAtRequestStart && options.indexingVersionAtRequestStart !== indexingVersion) return null;
  const key = scopedAnswerCacheKey(args);
  const cached = answerCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    answerCache.delete(key);
    return null;
  }
  if (cached.indexingVersion !== indexingVersion) {
    answerCache.delete(key);
    return null;
  }

  const finalIndexingVersion = await cacheIndexingVersion(args);
  if (finalIndexingVersion !== indexingVersion) return null;
  const answer = cloneAnswer(cached.answer);
  answer.routingReason = answer.routingReason ? `${answer.routingReason}; answer_cache_hit` : "answer_cache_hit";
  answer.latencyTimings = {
    ...answer.latencyTimings,
    total_latency_ms: Date.now() - startedAt,
  };
  return answer;
}

/**
 * Store an answer in the process-local cache (and, fire-and-forget, the shared cache).
 *
 * Callers may deliberately NOT await this — it is a cache write, never part of the
 * response contract. `answerQuestionWithScopeUncoalesced` defers it on a shared-cache
 * hit precisely so the fastest path in the system does not pay this function's
 * `documents` round trip before responding (latency audit 2026-07-28, L1-1). Deferring
 * is safe only while nothing mutates `answer` after the call: the clone below happens
 * after an `await`, so a caller that mutates it in the meantime would cache the mutation.
 *
 * Do NOT drop the `forceRefresh: true` below to save that round trip. The freshly read
 * indexing version is compared against `indexingVersionAtRetrievalStart` to DISCARD the
 * write when the corpus changed mid-request; reusing an already-held stamp would defeat
 * that staleness guard.
 *
 * Deferred callers must also survive `invalidateRagCachesForOwner` during the await:
 * the owner-scoped invalidation epoch checks below discard a post-invalidation write
 * even when the documents indexing stamp is unchanged (table-fact / review mutations),
 * including after the shared-cache row commit so a late invalidation cannot leave a
 * stale shared answer behind.
 *
 * The shared-cache promote itself stays off the response path (fire-and-forget): cold
 * generation callers `await setCachedAnswer` only for the local write + indexing stamp
 * round trip, not for the `rag_response_cache` delete/insert.
 */
export async function setCachedAnswer(
  args: Pick<
    SearchChunksArgs,
    "query" | "documentId" | "documentIds" | "ownerId" | "accessScope" | "skipCache" | "queryMode"
  >,
  answer: RagAnswer,
  options?: { indexingVersionAtRetrievalStart?: string | null },
): Promise<void> {
  if (!answerCacheAllowedForOwner(args.ownerId) || args.skipCache) return;
  if (env.RAG_ANSWER_CACHE_TTL_MS <= 0 || env.RAG_ANSWER_CACHE_SIZE <= 0) return;

  const invalidationEpochAtStart = captureInvalidationEpoch(args.ownerId);
  const indexingVersion = await cacheIndexingVersion(args, { forceRefresh: true });
  if (!indexingVersion) return;
  if (!cacheAuthorityAvailable(indexingVersion)) return;
  if (invalidationEpochChanged(args.ownerId, invalidationEpochAtStart)) return;
  if (options?.indexingVersionAtRetrievalStart && indexingVersion !== options.indexingVersionAtRetrievalStart) return;
  const key = scopedAnswerCacheKey(args);
  answerCache.set(key, {
    expiresAt: Date.now() + env.RAG_ANSWER_CACHE_TTL_MS,
    answer: cloneAnswer(answer),
    indexingVersion,
  });

  while (answerCache.size > env.RAG_ANSWER_CACHE_SIZE) {
    const oldestKey = answerCache.keys().next().value;
    if (!oldestKey) break;
    answerCache.delete(oldestKey);
  }
  if (invalidationEpochChanged(args.ownerId, invalidationEpochAtStart)) {
    answerCache.delete(key);
    return;
  }
  void (async () => {
    await setSharedCachedAnswer(args, answer, indexingVersion);
    if (!invalidationEpochChanged(args.ownerId, invalidationEpochAtStart)) return;
    answerCache.delete(key);
    await deleteSharedCachedAnswerRow(args, indexingVersion);
  })().catch(() => undefined);
}

function stableHash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function retrievalPlanCacheQuery(
  args: Pick<
    SearchChunksArgs,
    | "query"
    | "documentId"
    | "documentIds"
    | "ownerId"
    | "queryMode"
    | "topK"
    | "minSimilarity"
    | "forceEmbedding"
    | "lexicalOnly"
  >,
  queryClass?: RagQueryClass,
  queryVariants: string[] = [],
) {
  const normalizedQuery = normalizedCacheQuery(args.query);
  const variantHash = stableHash(queryVariants.join("\n"));
  const cacheKey = [
    `plan:${retrievalPlanForQueryClass(queryClass)}`,
    `class:${queryClass ?? "unknown"}`,
    `query:${normalizedQuery}`,
    `variants:${variantHash}`,
    `mode:${modeKey(args)}`,
    `topK:${args.topK ?? 8}`,
    `min:${args.minSimilarity ?? 0.15}`,
    `forceEmbedding:${args.forceEmbedding ? "1" : "0"}`,
    `lexicalOnly:${args.lexicalOnly ? "1" : "0"}`,
    `rag:${ragDeepMemoryVersion}`,
    `force:${args.forceEmbedding ? 1 : 0}`,
    ...(env.RAG_SEMANTIC_RERANK_ENABLED ? [`semanticRerank:${env.OPENAI_RERANK_MODEL}`] : []),
  ].join("|");
  return queryCacheKeyForStorage(cacheKey);
}

function scopedSearchCacheKey(args: SearchChunksArgs, queryClass?: RagQueryClass, queryVariants: string[] = []) {
  return [ragCacheDependencyVersion, scopeKey(args), retrievalPlanCacheQuery(args, queryClass, queryVariants)].join(
    "|",
  );
}

function cloneSearchResults(results: SearchResult[]) {
  return structuredClone(results);
}

function normalizeCacheStorageTelemetry(telemetry: SearchTelemetry): SearchTelemetry {
  return {
    ...telemetry,
    shared_cache_hit: false,
    shared_cache_status: undefined,
    shared_cache_miss_reason: null,
    search_total_latency_ms: undefined,
    retrieval_phase_latencies_ms: undefined,
  };
}

// Single source of truth for whether the process-local search cache is active
// for a request. Shared with the observability counter so a size-0 (or TTL-0 /
// skipCache) deployment records the lookup as neither hit nor miss rather than a
// false miss (the shared-cache lookup does not itself short-circuit on size).
export function isSearchCacheEnabled(args: Pick<SearchChunksArgs, "skipCache">): boolean {
  return !args.skipCache && env.RAG_SEARCH_CACHE_TTL_MS > 0 && env.RAG_SEARCH_CACHE_SIZE > 0;
}

export function isSearchCacheLookupEnabled(args: Pick<SearchChunksArgs, "skipCache">): boolean {
  return !args.skipCache && env.RAG_SEARCH_CACHE_TTL_MS > 0;
}

export async function getCachedSearch(
  args: SearchChunksArgs,
  queryClass?: RagQueryClass,
  queryVariants: string[] = [],
  options?: { indexingVersionAtRequestStart?: string | null },
): Promise<{ results: SearchResult[]; telemetry: SearchTelemetry } | null> {
  throwIfAborted(args.signal);
  if (!isSearchCacheEnabled(args)) return null;

  const indexingVersion = await cacheIndexingVersion(args);
  if (!indexingVersion || !cacheAuthorityAvailable(indexingVersion)) return null;
  if (options?.indexingVersionAtRequestStart && options.indexingVersionAtRequestStart !== indexingVersion) return null;
  const key = scopedSearchCacheKey(args, queryClass, queryVariants);
  const cached = searchCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    searchCache.delete(key);
    return null;
  }
  throwIfAborted(args.signal);
  if (cached.indexingVersion !== indexingVersion) {
    searchCache.delete(key);
    return null;
  }

  const finalIndexingVersion = await cacheIndexingVersion(args);
  if (finalIndexingVersion !== indexingVersion) return null;
  return {
    results: cloneSearchResults(cached.results),
    telemetry: {
      ...cached.telemetry,
      search_cache_hit: true,
      retrieval_strategy: "search_cache" as const,
      text_fast_path_latency_ms: 0,
      embedding_latency_ms: 0,
      supabase_rpc_latency_ms: 0,
      rerank_latency_ms: 0,
      semantic_rerank_invoked: false,
      semantic_rerank_candidate_count: 0,
      semantic_rerank_latency_ms: 0,
      semantic_rerank_outcome: "not_invoked" as const,
      semantic_rerank_fallback_reason: undefined,
      shared_cache_hit: false,
      shared_cache_status: undefined,
      shared_cache_miss_reason: null,
    },
  };
}

export async function setCachedSearch(
  args: SearchChunksArgs,
  results: SearchResult[],
  telemetry: SearchTelemetry,
  queryVariants: string[] = [],
  options?: { indexingVersionAtRetrievalStart?: string | null },
): Promise<void> {
  throwIfAborted(args.signal);
  if (args.skipCache || env.RAG_SEARCH_CACHE_TTL_MS <= 0 || env.RAG_SEARCH_CACHE_SIZE <= 0) return;
  const cacheTelemetry = normalizeCacheStorageTelemetry(telemetry);

  const indexingVersion = await cacheIndexingVersion(args, { forceRefresh: true });
  if (!indexingVersion) return;
  if (!cacheAuthorityAvailable(indexingVersion)) return;
  throwIfAborted(args.signal);
  if (options?.indexingVersionAtRetrievalStart && indexingVersion !== options.indexingVersionAtRetrievalStart) return;
  const key = scopedSearchCacheKey(args, telemetry.query_class, queryVariants);
  searchCache.set(key, {
    expiresAt: Date.now() + env.RAG_SEARCH_CACHE_TTL_MS,
    results: cloneSearchResults(results),
    telemetry: { ...cacheTelemetry },
    indexingVersion,
  });

  while (searchCache.size > env.RAG_SEARCH_CACHE_SIZE) {
    const oldestKey = searchCache.keys().next().value;
    if (!oldestKey) break;
    searchCache.delete(oldestKey);
  }
  setSharedCachedSearch(args, results, cacheTelemetry, indexingVersion, queryVariants);
}

type SharedCacheKind = "search" | "answer";
type SharedCacheMissReason =
  "cache_lookup_error" | "cache_lookup_exception" | "cache_payload_invalid" | "unknown_filter_miss";

function sharedCacheSelector(
  supabase: ReturnType<typeof createAdminClient>,
  kind: SharedCacheKind,
  args: Pick<
    SearchChunksArgs,
    "query" | "documentId" | "documentIds" | "ownerId" | "accessScope" | "queryMode" | "forceEmbedding" | "signal"
  >,
  indexingVersion: string,
  normalizedQuery: string = queryCacheKeyForStorage(normalizedCacheQuery(`${modeKey(args)} ${args.query}`)),
) {
  let query = supabase
    .from("rag_response_cache")
    .select("payload")
    .eq("cache_kind", kind)
    .eq("scope_key", scopeKey(args))
    .eq("normalized_query", normalizedQuery)
    .eq("indexing_version", indexingVersion)
    .eq("dependency_version", ragCacheDependencyVersion)
    .gt("expires_at", new Date().toISOString())
    .limit(1);

  query = args.ownerId ? query.eq("owner_id", args.ownerId) : query.is("owner_id", null);
  return query;
}

const GENERATION_FALLBACK_MARKER = /(?:^|;\s*)generation_fallback(?::|$)/i;
function isGenerationFallbackAnswer(answer: Pick<RagAnswer, "routingReason" | "degradedMode">) {
  return (
    GENERATION_FALLBACK_MARKER.test(answer.routingReason ?? "") ||
    GENERATION_FALLBACK_MARKER.test(answer.degradedMode?.reason ?? "")
  );
}

export async function cacheIndexingVersion(
  args: Pick<SearchChunksArgs, "documentId" | "documentIds" | "ownerId" | "accessScope" | "signal">,
  options?: { forceRefresh?: boolean },
) {
  throwIfAborted(args.signal);
  const cacheKey = cacheIndexingVersionCacheKey(args);
  if (options?.forceRefresh) cacheIndexingVersionCache.delete(cacheKey);
  const cached = readExpiringCacheEntry(cacheIndexingVersionCache, cacheKey);

  let value: string;
  try {
    const supabase = createAdminClient();
    const { data: authorityData, error: authorityError } = await supabase.rpc("public_source_serving_authority_stamp");
    const publicSourceAuthorityStamp =
      typeof authorityData === "string" || typeof authorityData === "number" ? String(authorityData) : null;
    if (authorityError) return publicSourceAuthorityUnavailable;
    if (!publicSourceAuthorityStamp) return publicSourceAuthorityUnavailable;
    if (cached) return `${cached.value}:public:${publicSourceAuthorityStamp}`;
    value = `${ragDeepMemoryVersion}:no-indexed-documents`;
    const documentFilters = args.documentIds?.length ? args.documentIds : args.documentId ? [args.documentId] : null;
    let query = supabase
      .from("documents")
      .select("id,updated_at,metadata")
      .eq("status", "indexed")
      .order("updated_at", { ascending: false })
      .limit(1);
    const accessScope = retrievalAccessScopeForArgs(args);
    if (accessScope.ownerId && accessScope.includePublic) {
      query = query.or(`owner_id.eq.${accessScope.ownerId},owner_id.is.null`);
    } else if (accessScope.ownerId) {
      query = query.eq("owner_id", accessScope.ownerId);
    } else {
      query = query.is("owner_id", null);
    }
    if (documentFilters?.length) query = query.in("id", documentFilters);
    if (args.signal) query = query.abortSignal(args.signal);
    const { data, error } = await query;
    throwIfAborted(args.signal);
    if (error || !data?.length) {
      value = `${ragDeepMemoryVersion}:no-indexed-documents`;
    } else {
      const latest = data[0] as { id?: string; updated_at?: string | null; metadata?: unknown };
      const metadata = normalizeSourceMetadata(latest.metadata);
      const indexedAt = metadata.indexed_at ?? latest.updated_at ?? "unknown";
      const generationId =
        latest.metadata && typeof latest.metadata === "object" && "index_generation_id" in latest.metadata
          ? String((latest.metadata as { index_generation_id?: unknown }).index_generation_id ?? "")
          : "";
      value = `${ragDeepMemoryVersion}:${latest.id ?? "all"}:${indexedAt}:${generationId}`;
    }
  } catch {
    if (args.signal?.aborted) throw abortReason(args.signal);
    return publicSourceAuthorityUnavailable;
  }
  throwIfAborted(args.signal);
  writeBoundedExpiringCacheEntry(
    cacheIndexingVersionCache,
    cacheKey,
    { value, expiresAt: Date.now() + cacheIndexingVersionTtlMs },
    cacheIndexingVersionMaxEntries,
  );
  let finalAuthority;
  try {
    finalAuthority = await createAdminClient().rpc("public_source_serving_authority_stamp");
  } catch {
    return publicSourceAuthorityUnavailable;
  }
  const finalPublicSourceAuthorityStamp =
    typeof finalAuthority.data === "string" || typeof finalAuthority.data === "number"
      ? String(finalAuthority.data)
      : null;
  if (finalAuthority.error || !finalPublicSourceAuthorityStamp) return publicSourceAuthorityUnavailable;
  return `${value}:public:${finalPublicSourceAuthorityStamp}`;
}

export async function getSharedCachedSearch(
  args: SearchChunksArgs,
  queryClass?: RagQueryClass,
  queryVariants: string[] = [],
  options?: { indexingVersionAtRequestStart?: string | null },
): Promise<
  | { kind: "hit"; results: SearchResult[]; telemetry: SearchTelemetry }
  | { kind: "miss"; reason: SharedCacheMissReason }
  | null
> {
  throwIfAborted(args.signal);
  if (args.skipCache || env.RAG_SEARCH_CACHE_TTL_MS <= 0) return null;
  const normalizedQuery = retrievalPlanCacheQuery(args, queryClass, queryVariants);
  const indexingVersion = await cacheIndexingVersion(args);
  if (!indexingVersion || !cacheAuthorityAvailable(indexingVersion)) return null;
  if (options?.indexingVersionAtRequestStart && options.indexingVersionAtRequestStart !== indexingVersion) return null;
  try {
    let query = sharedCacheSelector(createAdminClient(), "search", args, indexingVersion, normalizedQuery);
    if (args.signal) query = query.abortSignal(args.signal);
    const { data, error } = await query.maybeSingle();
    throwIfAborted(args.signal);
    if (error) return { kind: "miss", reason: "cache_lookup_error" };
    // The selector deliberately folds TTL, dependency, and indexing-version
    // validity into the hit query. Keep a filtered miss coarse rather than pay
    // a second cross-region lookup solely to distinguish those miss classes.
    if (!data?.payload) return { kind: "miss", reason: "unknown_filter_miss" };
    const payload = data.payload as { results?: SearchResult[]; telemetry?: Partial<SearchTelemetry> };
    if (!Array.isArray(payload.results)) {
      return { kind: "miss", reason: "cache_payload_invalid" };
    }
    const finalIndexingVersion = await cacheIndexingVersion(args);
    if (finalIndexingVersion !== indexingVersion) return { kind: "miss", reason: "unknown_filter_miss" };
    return {
      kind: "hit",
      results: cloneSearchResults(payload.results),
      telemetry: {
        search_cache_hit: true,
        shared_cache_hit: true,
        shared_cache_status: "hit",
        shared_cache_miss_reason: null,
        query_class: payload.telemetry?.query_class,
        corpus_grounding: payload.telemetry?.corpus_grounding,
        vector_candidate_count: payload.telemetry?.vector_candidate_count,
        text_candidate_count: payload.telemetry?.text_candidate_count,
        embedding_field_count: payload.telemetry?.embedding_field_count,
        retrieval_query_variant_count: payload.telemetry?.retrieval_query_variant_count ?? 0,
        text_fast_path_latency_ms: 0,
        text_candidate_budget: payload.telemetry?.text_candidate_budget,
        text_fast_path_reason: payload.telemetry?.text_fast_path_reason ?? null,
        embedding_skipped: true,
        embedding_skip_reason: payload.telemetry?.embedding_skip_reason ?? "search_cache",
        embedding_latency_ms: 0,
        embedding_cache_hit: false,
        supabase_rpc_latency_ms: 0,
        rerank_latency_ms: 0,
        memory_card_count: payload.telemetry?.memory_card_count ?? 0,
        memory_top_score: payload.telemetry?.memory_top_score ?? 0,
        index_unit_count: payload.telemetry?.index_unit_count ?? 0,
        index_unit_top_score: payload.telemetry?.index_unit_top_score ?? 0,
        retrieval_plan: payload.telemetry?.retrieval_plan ?? retrievalPlanForQueryClass(payload.telemetry?.query_class),
        retrieval_intent: payload.telemetry?.retrieval_intent,
        retrieval_selection: payload.telemetry?.retrieval_selection,
        retrieval_layer_counts: payload.telemetry?.retrieval_layer_counts ?? {},
        retrieval_layer_top_scores: payload.telemetry?.retrieval_layer_top_scores ?? {},
        retrieval_layer_latencies_ms: payload.telemetry?.retrieval_layer_latencies_ms ?? {},
        retrieval_provenance_counts: payload.telemetry?.retrieval_provenance_counts ?? {},
        coverage_gate_decision: payload.telemetry?.coverage_gate_decision,
        coverage_gate_reason: payload.telemetry?.coverage_gate_reason ?? null,
        vector_skipped_reason: payload.telemetry?.vector_skipped_reason ?? null,
        source_image_required: payload.telemetry?.source_image_required ?? false,
        source_image_satisfied: payload.telemetry?.source_image_satisfied ?? false,
        second_stage_rerank_used: payload.telemetry?.second_stage_rerank_used ?? false,
        second_stage_rerank_latency_ms: 0,
        semantic_rerank_eligibility: payload.telemetry?.semantic_rerank_eligibility,
        semantic_rerank_invoked: false,
        semantic_rerank_model: payload.telemetry?.semantic_rerank_model,
        semantic_rerank_candidate_count: 0,
        semantic_rerank_latency_ms: 0,
        semantic_rerank_outcome: "not_invoked" as const,
        semantic_rerank_fallback_reason: undefined,
        visual_direct_image_count: payload.telemetry?.visual_direct_image_count ?? 0,
        weighted_top_score: payload.telemetry?.weighted_top_score ?? 0,
        rrf_top_score: payload.telemetry?.rrf_top_score ?? 0,
        retrieval_strategy: "search_cache" as const,
      },
    };
  } catch {
    if (args.signal?.aborted) throw abortReason(args.signal);
    return { kind: "miss", reason: "cache_lookup_exception" };
  }
}

export async function getSharedCachedAnswer(
  args: Pick<
    SearchChunksArgs,
    "query" | "documentId" | "documentIds" | "ownerId" | "skipCache" | "queryMode" | "forceEmbedding"
  >,
  startedAt: number,
  options?: { indexingVersionAtRequestStart?: string | null },
) {
  if (!answerCacheAllowedForOwner(args.ownerId) || args.skipCache || env.RAG_ANSWER_CACHE_TTL_MS <= 0) return null;
  try {
    const indexingVersion = await cacheIndexingVersion(args);
    if (!indexingVersion || !cacheAuthorityAvailable(indexingVersion)) return null;
    if (options?.indexingVersionAtRequestStart && options.indexingVersionAtRequestStart !== indexingVersion)
      return null;
    const { data, error } = await sharedCacheSelector(
      createAdminClient(),
      "answer",
      args,
      indexingVersion,
      sharedAnswerNormalizedQuery(args),
    ).maybeSingle();
    if (error || !data?.payload) return null;
    const finalIndexingVersion = await cacheIndexingVersion(args);
    if (finalIndexingVersion !== indexingVersion) return null;
    const answer = cloneAnswer((data.payload as { answer: RagAnswer }).answer);
    if (isGenerationFallbackAnswer(answer)) {
      await deleteSharedCachedAnswerRow({ ...args, accessScope: retrievalAccessScopeForArgs(args) }, indexingVersion);
      return null;
    }
    answer.routingReason = answer.routingReason
      ? `${answer.routingReason}; shared_answer_cache_hit`
      : "shared_answer_cache_hit";
    answer.latencyTimings = {
      ...answer.latencyTimings,
      search_cache_hit: true,
      shared_cache_hit: true,
      shared_cache_status: "hit",
      shared_cache_miss_reason: null,
      total_latency_ms: Date.now() - startedAt,
    };
    return answer;
  } catch {
    return null;
  }
}

async function replaceSharedCacheRow(
  kind: SharedCacheKind,
  args: Pick<
    SearchChunksArgs,
    "query" | "documentId" | "documentIds" | "ownerId" | "accessScope" | "queryMode" | "forceEmbedding" | "signal"
  >,
  payload: unknown,
  ttlMs: number,
  indexingVersion: string,
  normalizedQuery: string = queryCacheKeyForStorage(normalizedCacheQuery(`${modeKey(args)} ${args.query}`)),
) {
  if (ttlMs <= 0) return;
  try {
    if (args.signal?.aborted) return;
    const supabase = createAdminClient();
    let deleteQuery = supabase
      .from("rag_response_cache")
      .delete()
      .eq("cache_kind", kind)
      .eq("scope_key", scopeKey(args))
      .eq("normalized_query", normalizedQuery)
      .eq("indexing_version", indexingVersion)
      .eq("dependency_version", ragCacheDependencyVersion);
    deleteQuery = args.ownerId ? deleteQuery.eq("owner_id", args.ownerId) : deleteQuery.is("owner_id", null);
    if (args.signal) deleteQuery = deleteQuery.abortSignal(args.signal);
    await deleteQuery;
    if (args.signal?.aborted) return;
    let insertQuery = supabase.from("rag_response_cache").insert({
      owner_id: args.ownerId ?? null,
      cache_kind: kind,
      scope_key: scopeKey(args),
      normalized_query: normalizedQuery,
      indexing_version: indexingVersion,
      dependency_version: ragCacheDependencyVersion,
      // JSON-serializable by contract of the response cache.
      payload: payload as Json,
      expires_at: new Date(Date.now() + ttlMs).toISOString(),
    });
    if (args.signal) insertQuery = insertQuery.abortSignal(args.signal);
    await insertQuery;
  } catch {
    // Shared cache must never be part of the correctness path.
  }
}

function setSharedCachedSearch(
  args: SearchChunksArgs,
  results: SearchResult[],
  telemetry: SearchTelemetry,
  indexingVersion: string,
  queryVariants: string[] = [],
) {
  if (args.skipCache || env.RAG_SEARCH_CACHE_TTL_MS <= 0) return;
  void replaceSharedCacheRow(
    "search",
    args,
    { results: cloneSearchResults(results), telemetry },
    env.RAG_SEARCH_CACHE_TTL_MS,
    indexingVersion,
    retrievalPlanCacheQuery(args, telemetry.query_class, queryVariants),
  );
}

async function setSharedCachedAnswer(
  args: Pick<
    SearchChunksArgs,
    "query" | "documentId" | "documentIds" | "ownerId" | "skipCache" | "queryMode" | "forceEmbedding"
  >,
  answer: RagAnswer,
  indexingVersion: string,
) {
  if (!answerCacheAllowedForOwner(args.ownerId) || args.skipCache || env.RAG_ANSWER_CACHE_TTL_MS <= 0) return;
  await replaceSharedCacheRow(
    "answer",
    args,
    { answer: cloneAnswer(answer) },
    env.RAG_ANSWER_CACHE_TTL_MS,
    indexingVersion,
    sharedAnswerNormalizedQuery(args),
  );
}

async function deleteSharedCachedAnswerRow(
  args: Pick<SearchChunksArgs, "query" | "documentId" | "documentIds" | "ownerId" | "accessScope" | "queryMode">,
  indexingVersion: string,
) {
  try {
    const normalizedQuery = sharedAnswerNormalizedQuery(args);
    let deleteQuery = createAdminClient()
      .from("rag_response_cache")
      .delete()
      .eq("cache_kind", "answer")
      .eq("scope_key", scopeKey(args))
      .eq("normalized_query", normalizedQuery)
      .eq("indexing_version", indexingVersion)
      .eq("dependency_version", ragCacheDependencyVersion);
    deleteQuery = args.ownerId ? deleteQuery.eq("owner_id", args.ownerId) : deleteQuery.is("owner_id", null);
    await deleteQuery;
  } catch (error) {
    // Shared cache cleanup after a raced invalidation is best effort.
    console.warn("Shared answer cache post-invalidation cleanup failed:", error);
  }
}

export function invalidateRagCachesForOwner(ownerId?: string | null) {
  // Epoch first so any in-flight deferred promotion that resumes after this
  // clear still sees a mismatch and discards its write.
  bumpInvalidationEpoch(ownerId);
  if (!ownerId) {
    answerCache.clear();
    answerInflight.clear();
    searchCache.clear();
    cacheIndexingVersionCache.clear();
    void (async () => {
      try {
        await createAdminClient().from("rag_response_cache").delete().in("cache_kind", ["search", "answer"]);
      } catch (error) {
        // Shared cache invalidation is best effort.
        console.warn("Shared cache invalidation failed (all kinds):", error);
      }
    })();
    return;
  }

  const sharedCacheOwnerId = ownerId === "anonymous" ? null : ownerId;
  for (const key of answerCache.keys()) {
    if (ragCacheKeyMatchesOwner(key, ownerId)) answerCache.delete(key);
  }
  for (const key of answerInflight.keys()) {
    if (ragCacheKeyMatchesOwner(key, ownerId)) answerInflight.delete(key);
  }
  for (const key of searchCache.keys()) {
    if (ragCacheKeyMatchesOwner(key, ownerId)) searchCache.delete(key);
  }
  for (const key of cacheIndexingVersionCache.keys()) {
    if (ragCacheKeyMatchesOwner(key, ownerId)) cacheIndexingVersionCache.delete(key);
  }
  void (async () => {
    try {
      const deleteQuery = createAdminClient().from("rag_response_cache").delete();
      const scopedQuery = sharedCacheOwnerId
        ? deleteQuery.eq("owner_id", sharedCacheOwnerId)
        : deleteQuery.is("owner_id", null);
      await scopedQuery.in("cache_kind", ["search", "answer"]);
    } catch (error) {
      // Shared cache invalidation is best effort.
      console.warn("Shared cache invalidation failed for owner:", error);
    }
  })();
}

function invalidateAnonymousSharedRagCaches() {
  void (async () => {
    try {
      await createAdminClient()
        .from("rag_response_cache")
        .delete()
        .is("owner_id", null)
        .in("cache_kind", ["search", "answer"]);
    } catch (error) {
      // Shared cache invalidation is best effort.
      console.warn("Shared cache invalidation failed for anonymous:", error);
    }
  })();
}

export function invalidateRagCachesForDocumentMutation(
  ownerId: string,
  options: { affectsPublicCorpus?: boolean } = {},
) {
  invalidateRagCachesForOwner(ownerId);
  if (options.affectsPublicCorpus !== false) invalidateAnonymousSharedRagCaches();
}

function sourceContextPackLimit(queryClass: RagQueryClass, options: { crossDocument?: boolean } = {}) {
  return options.crossDocument || queryClass === "comparison" || queryClass === "broad_summary" ? 8 : 5;
}

export function packedContextCacheKey(
  results: SearchResult[],
  queryClass: RagQueryClass,
  options: { crossDocument?: boolean; documentIds?: string[] } = {},
) {
  const contextLimit = sourceContextPackLimit(queryClass, options);
  const scopeKey = options.documentIds?.length
    ? stableHash([...new Set(options.documentIds)].sort().join("|"))
    : "all-documents";
  return [
    queryClass,
    options.crossDocument ? "cross-document" : "single-document",
    `scope:${scopeKey}`,
    contextLimit,
    ...results
      .slice(0, contextLimit)
      .map((result) => `${result.id}:${result.document_id}:${result.chunk_index}:${result.page_number ?? "na"}`),
  ].join("|");
}

export async function packAdjacentSourceContext(
  supabase: ReturnType<typeof createAdminClient>,
  results: SearchResult[],
  queryClass: RagQueryClass,
  options: { crossDocument?: boolean } = {},
) {
  const contextLimit = sourceContextPackLimit(queryClass, options);
  const targetResults = results.slice(0, contextLimit);
  const documentIds = Array.from(new Set(targetResults.map((result) => result.document_id)));
  const chunkIndexes = Array.from(
    new Set(
      targetResults.flatMap((result) => [result.chunk_index - 1, result.chunk_index + 1]).filter((index) => index >= 0),
    ),
  );
  if (documentIds.length === 0 || chunkIndexes.length === 0) return results;

  try {
    const { data, error } = await supabase
      .from("document_chunks")
      .select("id,document_id,page_number,chunk_index,section_heading,content,retrieval_synopsis,index_generation_id")
      .in("document_id", documentIds)
      .in("chunk_index", chunkIndexes)
      .order("chunk_index", { ascending: true })
      .limit(80);

    if (error || !data?.length) return results;

    const chunksByDocumentAndIndex = new Map<
      string,
      { id: string; section_heading: string | null; content: string; retrieval_synopsis?: string | null }
    >();
    const committedGenerationByDocument = new Map(
      targetResults.map((result) => [result.document_id, committedIndexGeneration(result.source_metadata)] as const),
    );
    for (const chunk of data) {
      const committedGeneration = committedGenerationByDocument.get(chunk.document_id);
      if (chunk.index_generation_id && chunk.index_generation_id !== committedGeneration) continue;
      chunksByDocumentAndIndex.set(`${chunk.document_id}:${chunk.chunk_index}`, {
        id: chunk.id,
        section_heading: chunk.section_heading,
        content: chunk.content,
        retrieval_synopsis: chunk.retrieval_synopsis ?? null,
      });
    }

    const targetIds = new Set(targetResults.map((result) => result.id));
    return results.map((result) => {
      if (!targetIds.has(result.id)) return result;
      const adjacent = [result.chunk_index - 1, result.chunk_index + 1]
        .map((index) => chunksByDocumentAndIndex.get(`${result.document_id}:${index}`))
        .filter(
          (
            chunk,
          ): chunk is {
            id: string;
            section_heading: string | null;
            content: string;
            retrieval_synopsis?: string | null;
          } => Boolean(chunk && chunk.id !== result.id && chunk.content.trim()),
        )
        .map((chunk) => {
          const heading = chunk.section_heading ? `${chunk.section_heading}: ` : "";
          return compactContextText(`${heading}${chunk.retrieval_synopsis || chunk.content}`, 520);
        });

      if (adjacent.length === 0) return result;
      return {
        ...result,
        adjacent_context: adjacent.join(" "),
      };
    });
  } catch {
    return results;
  }
}

// The numeric-faithfulness gate must verify answer figures against the SAME text
// the model was shown. Generation runs on the packed context (packAdjacentSourceContext
// merges neighbour-chunk text into adjacent_context), but answer.sources is the
// unpacked answer-input set — so a dose/threshold the model faithfully copied from a
// neighbour chunk would be absent from the finalize-time verification corpus and wrongly
// flagged unverified, blanking a correct answer. Overlay the packed adjacent_context onto
// the answer-input results (by chunk id) to rebuild the exact verification corpus, WITHOUT
// mutating answer.sources itself (the route-boundary client trim and eval byte-identity
// both depend on answer.sources staying unpacked — see answer-client-payload.ts).
export function attachAdjacentContext(results: SearchResult[], packed: SearchResult[]): SearchResult[] {
  const adjacentById = new Map<string, string>();
  for (const source of packed) {
    if (source.adjacent_context) adjacentById.set(source.id, source.adjacent_context);
  }
  if (adjacentById.size === 0) return results;
  return results.map((result) => {
    const adjacent = adjacentById.get(result.id);
    return adjacent && adjacent !== result.adjacent_context ? { ...result, adjacent_context: adjacent } : result;
  });
}
