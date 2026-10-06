import { NextResponse } from "next/server";
import type { Json } from "@/lib/supabase/database.types";
import { z } from "zod";
import { demoImages, demoSearch } from "@/lib/demo-data";
import { isDemoMode, isLocalNoAuthMode } from "@/lib/env";
import { buildSmartPanel, buildVisualEvidence, diversifySearchResults } from "@/lib/evidence";
import { annotateDocumentMatches, annotateSearchResults, buildEvidenceRelevance } from "@/lib/evidence-relevance";
import { fetchRelatedDocuments, toDocumentMatch } from "@/lib/document-enrichment";
import { projectRelatedDocumentForClient } from "@/lib/client-source-projection";
import { jsonError, PublicApiError } from "@/lib/http";
import { isClinicalImageEvidence } from "@/lib/image-filtering";
import { searchChunksWithTelemetry } from "@/lib/rag/rag";
import { weakRetrievalTopScoreThreshold } from "@/lib/rag/rag-routing";
import { classifyRagQuery, normalizedClinicalSearchTokens } from "@/lib/clinical-search";
import { buildSmartRagApiPlan } from "@/lib/smart-rag-api";
import { SOURCE_ONLY_EMBEDDING_SKIP_REASON } from "@/lib/rag/rag-provider";
import { createAdminClient } from "@/lib/supabase/admin";
import * as serverAuth from "@/lib/supabase/auth";
import {
  allowRateLimitInMemoryFallbackOnUnavailable,
  consumeSubjectApiRateLimit,
  rateLimitJsonResponse,
} from "@/lib/api-rate-limit";
import { publicAccessContext } from "@/lib/public-api-access";
import { clinicalQueryModeSchema, queryClassForClinicalMode, queryForClinicalMode } from "@/lib/clinical-query-mode";
import { parseJsonBody } from "@/lib/validation/body";
import { resolveSearchScope, searchScopeFiltersSchema } from "@/lib/search-scope";
import { retrievalHealthFromTelemetry } from "@/lib/search-retrieval-health";
import { resolveRetrievalAccessScope } from "@/lib/owner-scope";
import { sourceGovernanceWarnings } from "@/lib/source-governance";
import {
  normalizedQueryTextForStorage,
  queryDerivedTokensForStorage,
  queryPrivacyMetadata,
  queryTextForStorage,
  queryVocabularyAliasesForStorage,
} from "@/lib/query-privacy";
import { safeErrorLogDetails } from "@/lib/privacy";
import { buildServerTimingHeader, preambleServerTimingEntries } from "@/lib/server-timing";
import { nonProductionSupabaseDemoFallbackReason } from "@/lib/supabase/errors";
import type { ChunkImage, ClinicalSourceMetadata, SearchResult } from "@/lib/types";

export const runtime = "nodejs";

type RetrievalLogWriteMetrics = {
  attempts: number;
  failures: number;
  lastFailureAt: string | null;
  lastFailureMessage: string | null;
};

const retrievalLogWriteMetrics: RetrievalLogWriteMetrics = {
  attempts: 0,
  failures: 0,
  lastFailureAt: null,
  lastFailureMessage: null,
};

const searchSchema = z.object({
  query: z.string().trim().min(1).max(2000),
  topK: z.number().int().min(1).max(20).optional(),
  documentId: z.string().uuid().optional(),
  documentIds: z.array(z.string().uuid()).max(25).optional(),
  filters: searchScopeFiltersSchema.optional(),
  queryMode: clinicalQueryModeSchema.optional().default("auto"),
  mode: z.enum(["answer", "documents", "differentials"]).optional().default("answer"),
  documentLimit: z.number().int().min(1).max(50).optional().default(20),
  includeRelatedDocuments: z.boolean().optional().default(true),
});

type SearchRequestBody = z.infer<typeof searchSchema>;

type ScopedSearchInflight = {
  promise: Promise<Record<string, unknown>>;
  controller: AbortController;
  waiters: number;
  settled: boolean;
};
const scopedSearchInflight = new Map<string, ScopedSearchInflight>();

function isSourceLibrarySearchMode(mode: SearchRequestBody["mode"]) {
  return mode === "documents" || mode === "differentials";
}

function scopedSearchKey(body: SearchRequestBody, ownerId?: string | null, publicOnly = false) {
  return JSON.stringify({
    ownerId: ownerId ?? undefined,
    publicOnly,
    query: body.query.toLowerCase().replace(/\s+/g, " ").trim(),
    topK: body.topK ?? null,
    documentId: body.documentId ?? null,
    documentIds: body.documentIds?.length ? [...body.documentIds].sort() : [],
    filters: body.filters ?? {},
    queryMode: body.queryMode,
    mode: body.mode,
    documentLimit: body.documentLimit,
    includeRelatedDocuments: body.includeRelatedDocuments,
  });
}

function callerAbortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted.", "AbortError");
}

function awaitWithCallerSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(callerAbortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(callerAbortReason(signal));
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

async function coalesceScopedSearch<T extends Record<string, unknown>>(
  key: string,
  producer: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  let entry = scopedSearchInflight.get(key);
  // Skip a flight already aborted by its last waiter (the `startFlight` pattern in
  // `site-content/site-content-record-cache.ts`, which is where it now lives).
  if (entry?.controller.signal.aborted) {
    if (scopedSearchInflight.get(key) === entry) scopedSearchInflight.delete(key);
    entry = undefined;
  }
  const coalesced = Boolean(entry);
  if (!entry) {
    const controller = new AbortController();
    const created: ScopedSearchInflight = {
      promise: Promise.resolve({}),
      controller,
      waiters: 0,
      settled: false,
    };
    created.promise = producer(controller.signal).finally(() => {
      created.settled = true;
      if (scopedSearchInflight.get(key) === created) scopedSearchInflight.delete(key);
    });
    scopedSearchInflight.set(key, created);
    entry = created;
  }
  entry.waiters += 1;
  try {
    return { payload: (await awaitWithCallerSignal(entry.promise, signal)) as T, coalesced };
  } finally {
    entry.waiters -= 1;
    // Drop the map entry immediately on last-waiter abort so a new healthy
    // caller cannot join the dying promise before the producer's .finally runs.
    if (entry.waiters === 0 && !entry.settled) {
      entry.controller.abort();
      if (scopedSearchInflight.get(key) === entry) scopedSearchInflight.delete(key);
    }
  }
}

function buildDocumentMatchesFromResults(results: SearchResult[], limit: number) {
  const grouped = new Map<
    string,
    {
      document_id: string;
      title: string;
      file_name: string;
      bestPages: number[];
      bestChunkIds: string[];
      // Track unique image ids: the same image is often hydrated onto several of
      // a document's chunks, so summing per-chunk counts would inflate the badge.
      imageIds: Set<string>;
      tableImageIds: Set<string>;
      score: number;
    }
  >();
  for (const result of results) {
    const score = result.hybrid_score ?? result.similarity;
    const page = result.page_number ?? null;
    const clinicalImages = result.images?.filter((image) => isClinicalImageEvidence(image)) ?? [];
    let current = grouped.get(result.document_id);
    if (!current) {
      current = {
        document_id: result.document_id,
        title: result.title,
        file_name: result.file_name,
        bestPages: [],
        bestChunkIds: [],
        imageIds: new Set<string>(),
        tableImageIds: new Set<string>(),
        score,
      };
      grouped.set(result.document_id, current);
    }
    current.score = Math.max(current.score, score);
    if (page && !current.bestPages.includes(page)) current.bestPages.push(page);
    if (!current.bestChunkIds.includes(result.id)) current.bestChunkIds.push(result.id);
    for (const image of clinicalImages) {
      if (!image.id) continue;
      current.imageIds.add(image.id);
      if (image.source_kind === "table_crop") current.tableImageIds.add(image.id);
    }
  }

  const coverByDocument = new Map<string, string>();
  for (const image of demoImages) {
    if (image.source_kind === "cover_page" && image.id && !coverByDocument.has(image.document_id)) {
      coverByDocument.set(image.document_id, image.id);
    }
  }

  return Array.from(grouped.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ imageIds, tableImageIds, ...document }) => ({
      ...document,
      imageCount: imageIds.size,
      tableCount: tableImageIds.size,
      coverImageId: coverByDocument.get(document.document_id) ?? null,
      labels: [],
      summarySnippet: null,
      matchReason: `Matched ${document.bestChunkIds.length} indexed passage${
        document.bestChunkIds.length === 1 ? "" : "s"
      }`,
    }));
}

function compactText(value: string, limit = 900) {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= limit) return compact;
  return `${compact.slice(0, limit - 3).trim()}...`;
}

function compactSourceMetadata(metadata: SearchResult["source_metadata"]): Partial<ClinicalSourceMetadata> | undefined {
  if (!metadata) return undefined;
  return {
    source_title: metadata.source_title,
    publisher: metadata.publisher,
    jurisdiction: metadata.jurisdiction,
    version: metadata.version,
    review_date: metadata.review_date,
    publication_date: metadata.publication_date,
    document_status: metadata.document_status,
    clinical_validation_status: metadata.clinical_validation_status,
    extraction_quality: metadata.extraction_quality,
    indexed_at: metadata.indexed_at,
  };
}

function compactImage(image: ChunkImage) {
  return {
    id: image.id,
    page_number: image.page_number,
    source_kind: image.source_kind,
    sourceKind: image.sourceKind,
    image_type: image.image_type,
    clinicalUseClass: image.clinicalUseClass,
    caption: image.caption ? compactText(image.caption, 240) : "",
    searchable: image.searchable,
    clinical_relevance_score: image.clinical_relevance_score,
    tableLabel: image.tableLabel,
    tableTitle: image.tableTitle,
  };
}

function buildMatchExplanation(queryTerms: readonly string[], result: SearchResult) {
  if (result.match_explanation) return result.match_explanation;
  const titleText = `${result.title} ${result.file_name}`.toLowerCase();
  const sectionText = `${result.section_heading ?? ""} ${(result.section_path ?? []).join(" ")}`.toLowerCase();
  const labelText = (result.document_labels ?? []).map((label) => label.label.toLowerCase()).join(" ");
  const contentText = `${result.retrieval_synopsis ?? ""} ${result.content}`.toLowerCase();
  const tableHit = Boolean(
    result.table_facts?.length ||
    result.images?.some((image) => image.source_kind === "table_crop" || image.sourceKind === "table_crop"),
  );
  const titleHit = queryTerms.some((term) => titleText.includes(term));
  const sectionHit = queryTerms.some((term) => sectionText.includes(term));
  const labelHit = queryTerms.some((term) => labelText.includes(term));
  const contentHit = queryTerms.some((term) => contentText.includes(term));
  const metadata = result.source_metadata;
  return {
    titleHit,
    labelHit,
    sectionHit,
    contentHit,
    tableHit,
    indexUnitType: result.index_unit?.unit_type ?? null,
    vectorSimilarity: result.similarity ?? null,
    textRank: result.text_rank ?? null,
    freshness: metadata?.document_status ?? null,
    extractionQuality: metadata?.extraction_quality ?? null,
    indexQualityScore: result.indexing_quality?.quality_score ?? null,
    indexQualityIssues: result.indexing_quality?.issues?.slice(0, 4) ?? [],
    reasons: [
      titleHit ? "title" : "",
      labelHit ? "label" : "",
      sectionHit ? "section" : "",
      contentHit ? "content" : "",
      tableHit ? "table" : "",
      result.index_unit?.unit_type ? `unit:${result.index_unit.unit_type}` : "",
      metadata?.document_status ? `status:${metadata.document_status}` : "",
      metadata?.extraction_quality ? `extraction:${metadata.extraction_quality}` : "",
      result.indexing_quality?.quality_score !== undefined
        ? `index:${Number(result.indexing_quality.quality_score).toFixed(2)}`
        : "",
    ].filter(Boolean),
  };
}

function compactSearchResult(result: SearchResult, queryTerms: readonly string[]) {
  const evidenceImages = result.images?.filter((image) => isClinicalImageEvidence(image)).slice(0, 3) ?? [];
  return {
    id: result.id,
    document_id: result.document_id,
    title: result.title,
    file_name: result.file_name,
    page_number: result.page_number,
    chunk_index: result.chunk_index,
    section_heading: result.section_heading,
    section_path: result.section_path ?? [],
    heading_level: result.heading_level ?? null,
    parent_heading: result.parent_heading ?? null,
    anchor_id: result.anchor_id ?? null,
    content: compactText(result.content),
    retrieval_synopsis: result.retrieval_synopsis ? compactText(result.retrieval_synopsis, 520) : null,
    image_ids: result.image_ids?.slice(0, 8) ?? [],
    similarity: result.similarity,
    text_rank: result.text_rank,
    hybrid_score: result.hybrid_score,
    rrf_score: result.rrf_score,
    source_strength: result.source_strength,
    score_explanation: result.score_explanation,
    source_metadata: compactSourceMetadata(result.source_metadata),
    relevance: result.relevance,
    match_explanation: buildMatchExplanation(queryTerms, result),
    index_unit: result.index_unit
      ? {
          id: result.index_unit.id,
          unit_type: result.index_unit.unit_type,
          title: result.index_unit.title,
          content: compactText(result.index_unit.content, 360),
          page_start: result.index_unit.page_start,
          page_end: result.index_unit.page_end,
          heading_path: result.index_unit.heading_path?.slice(0, 6) ?? [],
          quality_score: result.index_unit.quality_score,
          extraction_mode: result.index_unit.extraction_mode,
          source_span: result.index_unit.source_span ?? null,
          hybrid_score: result.index_unit.hybrid_score ?? null,
        }
      : null,
    table_facts: result.table_facts?.slice(0, 4).map((fact) => ({
      id: fact.id,
      source_chunk_id: fact.source_chunk_id,
      source_image_id: fact.source_image_id,
      page_number: fact.page_number,
      table_title: fact.table_title,
      row_label: fact.row_label,
      clinical_parameter: fact.clinical_parameter,
      threshold_value: fact.threshold_value,
      action: fact.action,
      match_reason: fact.match_reason,
    })),
    indexing_quality: result.indexing_quality ?? null,
    images: evidenceImages.map(compactImage),
  };
}

function compactSearchResults(query: string, results: SearchResult[]) {
  const queryTerms = Array.from(new Set(normalizedClinicalSearchTokens(query)));
  return results.map((result) => compactSearchResult(result, queryTerms));
}

function searchDegradedModeSignal(telemetry?: { embedding_skip_reason?: string | null }) {
  const reason = telemetry?.embedding_skip_reason ?? null;
  const active =
    reason === SOURCE_ONLY_EMBEDDING_SKIP_REASON || (typeof reason === "string" && reason.startsWith("source_only_"));
  return {
    active,
    reason: active ? (reason ?? "source_only") : null,
  };
}

function buildDemoSearchPayload(body: SearchRequestBody, fallbackReason?: string) {
  const searchFocusQuery = queryForClinicalMode(body.query, body.queryMode);
  const queryClass = queryClassForClinicalMode(body.queryMode) ?? classifyRagQuery(searchFocusQuery).queryClass;
  const results = annotateSearchResults(
    searchFocusQuery,
    demoSearch(body.query, body.topK ?? 8, body.documentId, body.documentIds),
  );
  const relevance = buildEvidenceRelevance(searchFocusQuery, results);
  const documentMatches = isSourceLibrarySearchMode(body.mode)
    ? annotateDocumentMatches(searchFocusQuery, buildDocumentMatchesFromResults(results, body.documentLimit), results)
    : [];
  const cachedVisualEvidence = buildVisualEvidence(results);
  return {
    results: compactSearchResults(searchFocusQuery, results),
    facets: buildSearchFacets(results),
    visualEvidence: cachedVisualEvidence,
    relevance,
    smartPanel: {
      ...buildSmartPanel(searchFocusQuery, results, { relevance, visualEvidence: cachedVisualEvidence }),
      relevance,
    },
    smartApiPlan: buildSmartRagApiPlan({
      query: searchFocusQuery,
      queryClass,
      results,
      retrievalStrategy: "hybrid",
      routeMode: isSourceLibrarySearchMode(body.mode) ? undefined : "fast",
      preferredResponseMode: isSourceLibrarySearchMode(body.mode) ? "document_lookup" : undefined,
    }),
    relatedDocuments: [],
    documentMatches,
    demoMode: true,
    degradedMode: fallbackReason ? { active: true, reason: fallbackReason } : searchDegradedModeSignal(),
    ...(fallbackReason ? { fallbackMode: "non_production_demo", fallbackReason } : {}),
  };
}

function facetCounts(values: Array<string | null | undefined>, limit = 12) {
  const counts = new Map<string, number>();
  for (const raw of values) {
    const value = raw?.trim();
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

function buildSearchFacets(results: SearchResult[]) {
  const labelFacet = (labelType: string) =>
    facetCounts(
      results.flatMap(
        (result) =>
          result.document_labels?.filter((label) => label.label_type === labelType).map((label) => label.label) ?? [],
      ),
    );

  return {
    status: facetCounts(results.map((result) => result.source_metadata?.document_status)),
    validation: facetCounts(results.map((result) => result.source_metadata?.clinical_validation_status)),
    extractionQuality: facetCounts(results.map((result) => result.source_metadata?.extraction_quality)),
    sections: facetCounts(results.map((result) => result.section_heading)),
    labels: facetCounts(results.flatMap((result) => result.document_labels?.map((label) => label.label) ?? [])),
    sites: labelFacet("site"),
    documentTypes: labelFacet("document_type"),
    services: labelFacet("service"),
    settings: labelFacet("setting"),
    populations: labelFacet("population"),
    risks: labelFacet("risk"),
    clinicalActions: labelFacet("clinical_action"),
    carePhases: labelFacet("care_phase"),
    documentIntents: labelFacet("document_intent"),
    contentFeatures: labelFacet("content_feature"),
    evidence: [
      { value: "has_images", count: results.filter((result) => result.images?.length).length },
      {
        value: "has_tables",
        count: results.filter(
          (result) =>
            result.table_facts?.length ||
            result.images?.some((image) => image.source_kind === "table_crop" || image.sourceKind === "table_crop"),
        ).length,
      },
    ].filter((facet) => facet.count > 0),
  };
}

function candidatePromotions(query: string, results: SearchResult[]) {
  const queryTerms = normalizedClinicalSearchTokens(query);
  const topLabels = results
    .flatMap((result) => result.document_labels ?? [])
    .filter((label) => label.confidence >= 0.55)
    .slice(0, 8)
    .map((label) => ({
      label: label.label,
      label_type: label.label_type,
      document_id: label.document_id,
      confidence: label.confidence,
    }));
  const rawTokens = queryDerivedTokensForStorage(Array.from(new Set(queryTerms)).slice(0, 10), query);
  return {
    // With raw retention off, fall back to curated clinical-vocabulary matches — output text
    // comes from the fixed vocabulary table, never the query, so it is RET-H4 safe and keeps
    // the alias-promotion pipeline fed (rag-hybrid-findings item 17).
    aliases: rawTokens.length ? rawTokens : queryVocabularyAliasesForStorage(query),
    labels: topLabels,
  };
}

function logWeakSearch(args: {
  supabase: ReturnType<typeof createAdminClient>;
  ownerId?: string | null;
  query: string;
  queryClass: string;
  route?: string | null;
  retrievalStrategy?: string | null;
  relevance: ReturnType<typeof buildEvidenceRelevance>;
  results: SearchResult[];
}) {
  const topScore = Math.max(
    0,
    ...args.results
      .slice(0, 5)
      .map((result) => result.score_explanation?.finalScore ?? result.hybrid_score ?? result.similarity ?? 0),
  );
  const weak =
    args.results.length === 0 ||
    args.relevance.verdict === "none" ||
    args.relevance.verdict === "nearby" ||
    topScore < weakRetrievalTopScoreThreshold;
  if (!weak) return;
  const promotions = candidatePromotions(args.query, args.results);
  void args.supabase
    .from("rag_query_misses")
    .insert({
      owner_id: args.ownerId,
      query: queryTextForStorage(args.query),
      normalized_query: normalizedQueryTextForStorage(args.query),
      query_class: args.queryClass,
      route: args.route ?? null,
      retrieval_strategy: args.retrievalStrategy ?? null,
      top_score: topScore,
      top_files: Array.from(new Set(args.results.slice(0, 5).map((result) => result.file_name))),
      top_chunk_ids: args.results
        .slice(0, 8)
        .map((result) => result.id)
        .filter((id) => /^[0-9a-f-]{36}$/i.test(id)),
      miss_reason: args.results.length === 0 ? "no_results" : `weak_${args.relevance.verdict}`,
      candidate_aliases: promotions.aliases,
      candidate_labels: promotions.labels,
      metadata: {
        relevance_score: args.relevance.score,
        direct_source_count: args.relevance.directSourceCount,
        weak_source_count: args.relevance.weakSourceCount,
        ...queryPrivacyMetadata(args.query),
      },
    })
    .then(undefined, () => undefined);
}

function telemetryLatencyMs(telemetry: Record<string, unknown>) {
  const total = telemetry.search_total_latency_ms;
  if (typeof total === "number" && Number.isFinite(total)) return total;
  const keys = ["text_fast_path_latency_ms", "embedding_latency_ms", "supabase_rpc_latency_ms", "rerank_latency_ms"];
  return keys.reduce((sum, key) => {
    const value = telemetry[key];
    return sum + (typeof value === "number" && Number.isFinite(value) ? value : 0);
  }, 0);
}

function latencyBucket(ms: number) {
  if (ms < 500) return "lt_500ms";
  if (ms < 1500) return "500_1500ms";
  if (ms < 5000) return "1500_5000ms";
  return "gte_5000ms";
}

function telemetryNumber(telemetry: Record<string, unknown>, key: string) {
  const value = telemetry[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function telemetryBoolean(telemetry: Record<string, unknown>, key: string) {
  const value = telemetry[key];
  return typeof value === "boolean" ? value : null;
}

function telemetryString(telemetry: Record<string, unknown>, key: string) {
  const value = telemetry[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function telemetryRecord(telemetry: Record<string, unknown>, key: string) {
  const value = telemetry[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function retrievalDecisionTelemetry(telemetry: Record<string, unknown>) {
  return {
    search_total_latency_ms: telemetryNumber(telemetry, "search_total_latency_ms"),
    retrieval_phase_latencies_ms: telemetryRecord(telemetry, "retrieval_phase_latencies_ms"),
    retrieval_plan: telemetryString(telemetry, "retrieval_plan"),
    retrieval_query_variant_count: telemetryNumber(telemetry, "retrieval_query_variant_count"),
    text_candidate_budget: telemetryNumber(telemetry, "text_candidate_budget"),
    text_candidate_count: telemetryNumber(telemetry, "text_candidate_count"),
    text_fast_path_reason: telemetryString(telemetry, "text_fast_path_reason"),
    embedding_skip_reason: telemetryString(telemetry, "embedding_skip_reason"),
    embedding_prefetched: telemetryBoolean(telemetry, "embedding_prefetched"),
    vector_candidate_count: telemetryNumber(telemetry, "vector_candidate_count"),
    embedding_field_count: telemetryNumber(telemetry, "embedding_field_count"),
    retrieval_layer_counts: telemetryRecord(telemetry, "retrieval_layer_counts"),
    retrieval_layer_top_scores: telemetryRecord(telemetry, "retrieval_layer_top_scores"),
    retrieval_layer_latencies_ms: telemetryRecord(telemetry, "retrieval_layer_latencies_ms"),
    retrieval_provenance_counts: telemetryRecord(telemetry, "retrieval_provenance_counts"),
    coverage_gate_decision: telemetryString(telemetry, "coverage_gate_decision"),
    coverage_gate_reason: telemetryString(telemetry, "coverage_gate_reason"),
    vector_skipped_reason: telemetryString(telemetry, "vector_skipped_reason"),
    source_image_required: telemetryBoolean(telemetry, "source_image_required"),
    source_image_satisfied: telemetryBoolean(telemetry, "source_image_satisfied"),
    second_stage_rerank_used: telemetryBoolean(telemetry, "second_stage_rerank_used"),
    second_stage_rerank_latency_ms: telemetryNumber(telemetry, "second_stage_rerank_latency_ms"),
    visual_direct_image_count: telemetryNumber(telemetry, "visual_direct_image_count"),
    // RC9/P8b observability: these feed the synthetic-similarity gate recalibration and the
    // weak-match OR-augmentation review (rag-hybrid-findings items 21 and the P8b extension) —
    // without persisting them the recalibration has no data to work from.
    text_or_relaxation_used: telemetryString(telemetry, "text_or_relaxation_used"),
    synthetic_similarity_count: telemetryNumber(telemetry, "synthetic_similarity_count"),
    // The degraded-retrieval case is the one most worth diagnosing after the
    // fact — it is invisible in the result count, which is just zero — and this
    // whitelist is what both observation writers persist. Omitting it meant the
    // failure map reached the reader's screen and nothing else.
    hybrid_rpc_errors: telemetryRecord(telemetry, "hybrid_rpc_errors"),
  };
}

function logRetrievalDiagnostics(args: {
  supabase: ReturnType<typeof createAdminClient>;
  ownerId?: string | null;
  query: string;
  results: SearchResult[];
  telemetry: Record<string, unknown>;
  relevance: { verdict: string; score: number };
}) {
  void (async () => {
    retrievalLogWriteMetrics.attempts += 1;
    try {
      const topResult = args.results[0] ?? null;
      const topScore = topResult ? (topResult.hybrid_score ?? topResult.similarity ?? 0) : 0;
      const scores = args.results.slice(0, 20).map((r) => r.hybrid_score ?? r.similarity ?? 0);
      const meanScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
      const isMiss =
        args.results.length === 0 ||
        args.relevance.verdict === "none" ||
        args.relevance.verdict === "nearby" ||
        topScore < weakRetrievalTopScoreThreshold;
      const latencyMs = telemetryLatencyMs(args.telemetry);

      await args.supabase.from("rag_retrieval_logs").insert({
        owner_id: args.ownerId,
        query: queryTextForStorage(args.query),
        normalized_query: normalizedQueryTextForStorage(args.query),
        query_class: (args.telemetry.query_class as string) ?? null,
        retrieval_strategy: (args.telemetry.retrieval_strategy as string) ?? null,
        candidate_count: args.results.length,
        top_similarity: topResult?.similarity ?? null,
        top_text_rank: topResult?.text_rank ?? null,
        top_hybrid_score: Number.isFinite(topScore) ? topScore : null,
        top_rrf_score: topResult?.rrf_score ?? null,
        mean_hybrid_score: meanScore || null,
        selected_chunk_ids: args.results
          .slice(0, 12)
          .map((r) => r.id)
          .filter((id) => /^[0-9a-f-]{36}$/i.test(id)),
        selected_document_ids: Array.from(new Set(args.results.slice(0, 12).map((r) => r.document_id))).filter((id) =>
          /^[0-9a-f-]{36}$/i.test(id),
        ),
        selected_count: Math.min(args.results.length, 12),
        embedding_latency_ms:
          typeof args.telemetry.embedding_latency_ms === "number" ? args.telemetry.embedding_latency_ms : null,
        vector_candidate_count:
          typeof args.telemetry.vector_candidate_count === "number" ? args.telemetry.vector_candidate_count : null,
        text_candidate_count:
          typeof args.telemetry.text_candidate_count === "number" ? args.telemetry.text_candidate_count : null,
        embedding_field_count:
          typeof args.telemetry.embedding_field_count === "number" ? args.telemetry.embedding_field_count : null,
        rpc_latency_ms:
          typeof args.telemetry.supabase_rpc_latency_ms === "number" ? args.telemetry.supabase_rpc_latency_ms : null,
        rerank_latency_ms:
          typeof args.telemetry.rerank_latency_ms === "number" ? args.telemetry.rerank_latency_ms : null,
        total_latency_ms: latencyMs || null,
        memory_card_count:
          typeof args.telemetry.memory_card_count === "number" ? args.telemetry.memory_card_count : null,
        index_unit_count: typeof args.telemetry.index_unit_count === "number" ? args.telemetry.index_unit_count : null,
        is_miss: isMiss,
        miss_reason: isMiss ? (args.results.length === 0 ? "no_results" : `weak_${args.relevance.verdict}`) : null,
        embedding_cache_hit:
          typeof args.telemetry.embedding_cache_hit === "boolean" ? args.telemetry.embedding_cache_hit : null,
        metadata: {
          relevance_score: args.relevance.score,
          latency_bucket: latencyBucket(latencyMs),
          ...retrievalDecisionTelemetry(args.telemetry),
          // Telemetry values are JSON-serializable; some are typed wider than Json.
        } as unknown as Json,
      });
    } catch (error) {
      retrievalLogWriteMetrics.failures += 1;
      retrievalLogWriteMetrics.lastFailureAt = new Date().toISOString();
      const safe = safeErrorLogDetails(error);
      retrievalLogWriteMetrics.lastFailureMessage =
        typeof safe.message === "string" ? safe.message : "Unknown retrieval logging error";
      if (retrievalLogWriteMetrics.failures <= 3 || retrievalLogWriteMetrics.failures % 25 === 0) {
        console.warn("rag_retrieval_logs insert failed", {
          ...retrievalLogWriteMetrics,
          ownerId: args.ownerId,
        });
      }
    }
  })();
}

function logSearchObservation(args: {
  supabase: ReturnType<typeof createAdminClient>;
  ownerId?: string | null;
  query: string;
  results: SearchResult[];
  payload: Record<string, unknown>;
  failure?: { code: string; causeName?: string | null; causeMessage?: string | null; sqlState?: string | null };
}) {
  void (async () => {
    try {
      const telemetry =
        args.payload.telemetry && typeof args.payload.telemetry === "object"
          ? (args.payload.telemetry as Record<string, unknown>)
          : {};
      const payloadBytes = Buffer.byteLength(JSON.stringify(args.payload), "utf8");
      const topResult = args.results[0] ?? null;
      const latencyMs = telemetryLatencyMs(telemetry);
      await args.supabase.from("rag_queries").insert({
        owner_id: args.ownerId,
        query: queryTextForStorage(args.query),
        answer: null,
        source_chunk_ids: args.results.map((result) => result.id),
        model: "search",
        metadata: {
          ...queryPrivacyMetadata(args.query),
          event_type: args.failure ? "private_search_failure" : "private_search",
          failure_code: args.failure?.code ?? null,
          failure_cause_name: args.failure?.causeName ?? null,
          failure_cause_message: args.failure?.causeMessage ?? null,
          failure_sql_state: args.failure?.sqlState ?? null,
          query_class: telemetry.query_class ?? null,
          retrieval_strategy: telemetry.retrieval_strategy ?? null,
          payload_bytes: payloadBytes,
          result_count: args.results.length,
          top_document_id: topResult?.document_id ?? null,
          top_document_title: topResult?.title ?? null,
          top_file_name: topResult?.file_name ?? null,
          top_score: topResult ? (topResult.hybrid_score ?? topResult.similarity ?? null) : null,
          latency_ms: latencyMs,
          latency_bucket: latencyBucket(latencyMs),
          search_cache_hit: telemetry.search_cache_hit ?? null,
          embedding_skipped: telemetry.embedding_skipped ?? null,
          ...retrievalDecisionTelemetry(telemetry),
        } as unknown as Json,
      });
    } catch {
      // Search telemetry must not affect the user-facing search path.
    }
  })();
}

async function buildScopedSearchPayload(
  body: SearchRequestBody,
  supabase: ReturnType<typeof createAdminClient>,
  ownerId?: string | null,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const searchFocusQuery = queryForClinicalMode(body.query, body.queryMode);
  const effectiveQueryClass =
    queryClassForClinicalMode(body.queryMode) ?? classifyRagQuery(searchFocusQuery).queryClass;
  const accessScope = resolveRetrievalAccessScope(ownerId);
  const scope = await resolveSearchScope({
    supabase,
    accessScope,
    documentIds: body.documentIds ?? (body.documentId ? [body.documentId] : undefined),
    filters: body.filters,
    signal,
  });
  signal?.throwIfAborted();
  if (scope.documentIds?.length === 0) {
    const relevance = buildEvidenceRelevance(searchFocusQuery, []);
    const payload = {
      results: [],
      facets: buildSearchFacets([]),
      visualEvidence: [],
      relevance,
      relatedDocuments: [],
      documentMatches: [],
      smartPanel: { ...buildSmartPanel(body.query, []), relevance, relatedDocuments: [] },
      smartApiPlan: buildSmartRagApiPlan({
        query: searchFocusQuery,
        queryClass: effectiveQueryClass,
        results: [],
        retrievalStrategy: "unknown",
        routeMode: "unsupported",
        preferredResponseMode: isSourceLibrarySearchMode(body.mode) ? "document_lookup" : undefined,
      }),
      scope: { ...scope, queryMode: body.queryMode },
      sourceGovernanceWarnings: sourceGovernanceWarnings({ results: [], relevance }),
      degradedMode: searchDegradedModeSignal(),
      telemetry: {
        query_class: effectiveQueryClass,
        relevance_verdict: relevance.verdict,
        relevance_score: relevance.score,
        direct_source_count: 0,
        weak_source_count: 0,
        shared_cache_status: "miss",
        shared_cache_miss_reason: "no_entry",
      },
    };
    logSearchObservation({ supabase, ownerId, query: body.query, results: [], payload });
    return payload;
  }
  const search = await searchChunksWithTelemetry({
    query: body.query,
    topK: isSourceLibrarySearchMode(body.mode)
      ? Math.max(body.topK ?? 12, Math.min(20, body.documentLimit))
      : (body.topK ?? 8),
    documentIds: scope.documentIds ?? body.documentIds ?? (body.documentId ? [body.documentId] : undefined),
    ownerId: ownerId ?? undefined,
    accessScope,
    allowGlobalSearch: !ownerId,
    queryMode: body.queryMode,
    signal,
  });
  const resultLimit = isSourceLibrarySearchMode(body.mode)
    ? Math.max(body.topK ?? 12, Math.min(20, body.documentLimit))
    : (body.topK ?? 8);
  // RC7: cap the search-results panel at 3 chunks per document (was 4) so one verbose document
  // cannot crowd out sibling sources — the corpus has many near-duplicate guidelines (e.g. several
  // "Safety Planning" / "Active Community Patients in ED" versions), and surfacing more distinct
  // documents makes the panel more useful. diversifySearchResults backfills from remaining chunks
  // when few documents match, so this never reduces the result count.
  const results = annotateSearchResults(searchFocusQuery, diversifySearchResults(search.results, resultLimit, 3, true));

  const relatedDocuments = body.includeRelatedDocuments
    ? await fetchRelatedDocuments({
        supabase,
        ownerId: ownerId ?? undefined,
        accessScope,
        query: searchFocusQuery,
        results,
        limit: isSourceLibrarySearchMode(body.mode) ? body.documentLimit : undefined,
        signal,
      })
    : [];
  // Audit L10: compute relevance/visual evidence ONCE and share with the
  // smart panel — the panel's own recomputation was discarded by the spread
  // at payload build time anyway.
  const relevance = buildEvidenceRelevance(searchFocusQuery, results);
  const visualEvidence = buildVisualEvidence(results);
  const smartPanel = buildSmartPanel(searchFocusQuery, results, { relevance, visualEvidence });
  const smartApiPlan = buildSmartRagApiPlan({
    query: searchFocusQuery,
    queryClass: effectiveQueryClass,
    results,
    retrievalStrategy: search.telemetry.retrieval_strategy,
    routeMode: isSourceLibrarySearchMode(body.mode) ? undefined : "fast",
    preferredResponseMode: isSourceLibrarySearchMode(body.mode) ? "document_lookup" : undefined,
  });
  logWeakSearch({
    supabase,
    ownerId,
    query: body.query,
    queryClass: effectiveQueryClass,
    route: body.mode,
    retrievalStrategy: search.telemetry.retrieval_strategy,
    relevance,
    results,
  });

  // Privacy: relatedDocuments carries DocumentLabel[], which has server-only
  // owner_id and arbitrary metadata fields. Never spread the raw array into a
  // client-facing payload — project each document (and its labels) through
  // projectRelatedDocumentForClient first.
  // Labels are capped inside projectRelatedDocumentForClient (before
  // match_reason projection) so the reason cannot name a dropped label.
  // documentMatches must be built from the same projected documents; toDocumentMatch
  // copies labels verbatim, so mapping raw relatedDocuments would re-leak owner_id
  // and raw metadata on the documents/differentials path.
  const clientRelatedDocuments = relatedDocuments.map(projectRelatedDocumentForClient).map((document) => ({
    ...document,
    summary: document.summary ? compactText(document.summary, 360) : null,
    table_count: document.table_count ?? 0,
    cover_image_id: document.cover_image_id ?? null,
  }));
  const documentMatches = isSourceLibrarySearchMode(body.mode)
    ? annotateDocumentMatches(searchFocusQuery, clientRelatedDocuments.map(toDocumentMatch), results)
    : [];

  const payload = {
    results: compactSearchResults(searchFocusQuery, results),
    facets: buildSearchFacets(results),
    visualEvidence,
    relevance,
    relatedDocuments: clientRelatedDocuments,
    documentMatches,
    smartPanel: { ...smartPanel, relevance, relatedDocuments: clientRelatedDocuments },
    smartApiPlan,
    scope: { ...scope, queryMode: body.queryMode, retrieval: retrievalHealthFromTelemetry(search.telemetry) },
    sourceGovernanceWarnings: sourceGovernanceWarnings({ results, relevance }),
    degradedMode: searchDegradedModeSignal(search.telemetry),
    telemetry: {
      query_class: effectiveQueryClass,
      relevance_verdict: relevance.verdict,
      relevance_score: relevance.score,
      direct_source_count: relevance.directSourceCount,
      weak_source_count: relevance.weakSourceCount,
      retrieval_strategy: search.telemetry.retrieval_strategy,
      retrieval_plan: search.telemetry.retrieval_plan,
      corpus_grounding: search.telemetry.corpus_grounding,
      smart_api_intent: smartApiPlan.intent,
      smart_api_response_mode: smartApiPlan.responseMode,
      smart_api_display_mode: smartApiPlan.displayMode,
      smart_api_source_link_count: smartApiPlan.sourceLinkCount,
      search_cache_hit: search.telemetry.search_cache_hit,
      search_total_latency_ms: search.telemetry.search_total_latency_ms,
      retrieval_phase_latencies_ms: search.telemetry.retrieval_phase_latencies_ms,
      shared_cache_hit: search.telemetry.shared_cache_hit,
      shared_cache_status: search.telemetry.shared_cache_status,
      shared_cache_miss_reason: search.telemetry.shared_cache_miss_reason,
      embedding_skipped: search.telemetry.embedding_skipped,
      embedding_skip_reason: search.telemetry.embedding_skip_reason,
      embedding_cache_hit: search.telemetry.embedding_cache_hit,
      embedding_prefetched: search.telemetry.embedding_prefetched,
      text_fast_path_latency_ms: search.telemetry.text_fast_path_latency_ms,
      text_candidate_budget: search.telemetry.text_candidate_budget,
      text_candidate_count: search.telemetry.text_candidate_count,
      text_fast_path_reason: search.telemetry.text_fast_path_reason,
      embedding_latency_ms: search.telemetry.embedding_latency_ms,
      vector_candidate_count: search.telemetry.vector_candidate_count,
      embedding_field_count: search.telemetry.embedding_field_count,
      retrieval_query_variant_count: search.telemetry.retrieval_query_variant_count,
      supabase_rpc_latency_ms: search.telemetry.supabase_rpc_latency_ms,
      rerank_latency_ms: search.telemetry.rerank_latency_ms,
      second_stage_rerank_used: search.telemetry.second_stage_rerank_used,
      second_stage_rerank_latency_ms: search.telemetry.second_stage_rerank_latency_ms,
      memory_card_count: search.telemetry.memory_card_count,
      memory_top_score: search.telemetry.memory_top_score,
      index_unit_count: search.telemetry.index_unit_count,
      index_unit_top_score: search.telemetry.index_unit_top_score,
      retrieval_layer_counts: search.telemetry.retrieval_layer_counts,
      retrieval_layer_top_scores: search.telemetry.retrieval_layer_top_scores,
      retrieval_layer_latencies_ms: search.telemetry.retrieval_layer_latencies_ms,
      retrieval_provenance_counts: search.telemetry.retrieval_provenance_counts,
      coverage_gate_decision: search.telemetry.coverage_gate_decision,
      coverage_gate_reason: search.telemetry.coverage_gate_reason,
      vector_skipped_reason: search.telemetry.vector_skipped_reason,
      source_image_required: search.telemetry.source_image_required,
      source_image_satisfied: search.telemetry.source_image_satisfied,
      visual_direct_image_count: search.telemetry.visual_direct_image_count,
      weighted_top_score: search.telemetry.weighted_top_score,
      rrf_top_score: search.telemetry.rrf_top_score,
      hybrid_rpc_errors: search.telemetry.hybrid_rpc_errors,
    },
  };
  logRetrievalDiagnostics({ supabase, ownerId, query: body.query, results, telemetry: search.telemetry, relevance });
  logSearchObservation({ supabase, ownerId, query: body.query, results, payload });
  return payload;
}

function classifySearchFailure(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  const sqlState = extractSqlState(error);
  if (message.includes("rate limit") || message.includes("429")) return "search_rate_limited";
  if (message.includes("type ") && message.includes("does not exist")) return "search_schema_type_missing";
  if (message.includes("public.vector") || message.includes("extensions.vector")) return "search_vector_type_mismatch";
  if (sqlState) return `search_sqlstate_${sqlState}`;
  if (message.includes("pgrst")) return "search_postgrest_failure";
  if (message.includes("embedding") || message.includes("openai")) return "embedding_or_model_failure";
  if (message.includes("rpc") || message.includes("function") || message.includes("match_document"))
    return "supabase_rpc_failure";
  if (message.includes("timeout") || message.includes("timed out") || message.includes("network"))
    return "search_timeout";
  if (message.includes("permission") || message.includes("jwt") || message.includes("auth"))
    return "search_auth_context_failure";
  if (message.includes("schema") || message.includes("column") || message.includes("relation"))
    return "search_schema_mismatch";
  return error instanceof Error && error.name !== "Error" ? error.name : "search_unknown_failure";
}

function extractSqlState(error: unknown) {
  const value = error as { code?: unknown; details?: unknown; message?: unknown };
  const candidates = [value?.code, value?.details, value?.message, error instanceof Error ? error.message : null]
    .filter((item): item is string => typeof item === "string")
    .join(" ");
  const match = candidates.match(/\b([0-9A-Z]{5})\b/);
  return match?.[1]?.toLowerCase() ?? null;
}

export async function POST(request: Request) {
  let supabase: ReturnType<typeof createAdminClient> | null = null;
  let ownerId: string | null = null;
  let body: SearchRequestBody | null = null;
  const routeStartedAt = Date.now();

  try {
    const searchBody = await parseJsonBody(request, searchSchema, "Invalid search request.");
    body = searchBody;
    if (isDemoMode()) {
      return NextResponse.json(buildDemoSearchPayload(searchBody));
    }

    supabase = createAdminClient();
    const authStartedAt = Date.now();
    const access = await publicAccessContext(request, supabase);
    const authMs = Date.now() - authStartedAt;
    ownerId = access.ownerId ?? null;
    const publicOnly = !access.authenticated && !isLocalNoAuthMode();

    const rateLimitStartedAt = Date.now();
    const rateLimit = await consumeSubjectApiRateLimit({
      supabase,
      subject: access.rateLimitSubject,
      bucket: "search",
      allowInMemoryFallbackOnUnavailable: allowRateLimitInMemoryFallbackOnUnavailable(),
    });
    const rateLimitMs = Date.now() - rateLimitStartedAt;
    if (rateLimit.limited) {
      return rateLimitJsonResponse(
        "Search is temporarily rate limited because too many requests were received. Retry shortly.",
        rateLimit,
      );
    }

    const key = scopedSearchKey(searchBody, ownerId, publicOnly);
    const searchStartedAt = Date.now();
    const { payload, coalesced } = await coalesceScopedSearch(
      key,
      (signal) => buildScopedSearchPayload(searchBody, supabase!, ownerId, signal),
      request.signal,
    );
    const searchMs = Date.now() - searchStartedAt;

    // Durations only — see server-timing.ts for the trust-boundary constraint.
    const serverTiming = buildServerTimingHeader([
      ...preambleServerTimingEntries({ authMs, rateLimitMs }),
      { name: "search", durMs: searchMs },
      { name: "total", durMs: Date.now() - routeStartedAt },
    ]);
    return NextResponse.json(
      {
        ...payload,
        telemetry: {
          ...payload.telemetry,
          coalesced,
        },
      },
      serverTiming ? { headers: { "Server-Timing": serverTiming } } : undefined,
    );
  } catch (error) {
    if ((error instanceof DOMException && error.name === "AbortError") || request.signal?.aborted) {
      return new Response(null, { status: 499 });
    }
    if (error instanceof serverAuth.AuthenticationError) {
      return serverAuth.unauthorizedResponse(error);
    }
    if (error instanceof z.ZodError) {
      return jsonError(error, 400);
    }
    if (error instanceof PublicApiError) {
      return jsonError(error, error.status);
    }
    if (error instanceof SyntaxError || error instanceof URIError) {
      return jsonError(new PublicApiError("Invalid search request.", 400, { code: "invalid_request" }), 400);
    }
    if (error instanceof Error && error.message.trim()) {
      const code = classifySearchFailure(error);
      const fallbackBody = body;
      const fallbackReason = fallbackBody ? nonProductionSupabaseDemoFallbackReason(error) : null;
      if (fallbackBody && fallbackReason) {
        return NextResponse.json(buildDemoSearchPayload(fallbackBody, fallbackReason), {
          headers: { "X-Clinical-KB-Fallback": fallbackReason },
        });
      }
      const failurePayload = {
        results: [],
        telemetry: {
          query_class: fallbackBody
            ? classifyRagQuery(fallbackBody.query).queryClass
            : classifyRagQuery(error.message).queryClass,
          retrieval_strategy: null,
          failure_code: code,
        },
      };
      if (ownerId && supabase) {
        logSearchObservation({
          supabase,
          ownerId,
          query: fallbackBody?.query ?? "unknown",
          results: [],
          payload: failurePayload,
          failure: {
            code,
            causeName: error.name,
            causeMessage: error.message,
            sqlState: extractSqlState(error),
          },
        });
      }
      return jsonError(
        new PublicApiError("Search failed. Retry with a narrower question.", 500, {
          code,
        }),
        500,
      );
    }
    return jsonError(error, 500);
  }
}

export async function GET() {
  return jsonError(
    new PublicApiError("Method Not Allowed. Search requires a POST request.", 405, { code: "method_not_allowed" }),
    405,
  );
}
