import { rankClinicalResults } from "@/lib/clinical-search";
import type { ChunkImage, ClinicalImageUseClass, RagQueryClass, SearchResult } from "@/lib/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchRelatedDocumentMetadata } from "@/lib/document-enrichment";
import { normalizeImageBbox } from "@/lib/image-filtering";
import { committedIndexGeneration, isCommittedGenerationMetadata } from "@/lib/reindex-pipeline";
import { metadataText, safeRecord } from "@/lib/rag/rag-answer-text";
import { compactContextText } from "@/lib/rag/rag-source-block";
import type { RetrievalAccessScope } from "@/lib/owner-scope";
import type { SearchTelemetry } from "@/lib/rag/rag-contracts";
import type { Database } from "@/lib/supabase/database.types";
import {
  applyMemoryBoostArtifacts,
  loadMemoryBoostArtifacts,
  type ChunkLoadCache,
  type MemoryCardCache,
} from "@/lib/rag/rag-candidate-sources";
import { applySecondStageRerankIfNeeded } from "@/lib/rag/rag-second-stage";
import { measureSearchPhase, startRerankClock, type SearchTiming } from "@/lib/rag/rag-search-timing";
import { selectRetrievalEvidence } from "@/lib/retrieval-selection";

// Extracted from rag.ts (maturity X3 / #101): per-request hydration of retrieved
// results — document ranking metadata, cached index quality, and page visual
// evidence — behind one bounded per-request cache. Behaviour-preserving: the
// function bodies are byte-identical to their previous rag.ts definitions.

export type DocumentRankingMetadataCache = {
  documentMetadata: Map<
    string,
    { labels: SearchResult["document_labels"]; summary: SearchResult["document_summary"] } | null
  >;
  indexQuality: Map<string, SearchResult["indexing_quality"] | null>;
  /** Page-image rows already read in this search; see attachPageVisualEvidence. */
  pageVisuals?: PageVisualCache;
};

type PageImageRow = Pick<
  Database["public"]["Tables"]["document_images"]["Row"],
  | "id"
  | "document_id"
  | "page_number"
  | "storage_path"
  | "caption"
  | "bbox"
  | "image_type"
  | "searchable"
  | "clinical_relevance_score"
  | "source_kind"
  | "width"
  | "height"
  | "labels"
  | "metadata"
>;

/**
 * Page-image rows one search has already read. `pages` holds a complete row list for every
 * (document, page) pair a page read covered without reaching its row limit; `imagesById` holds each
 * directly requested image id, null when no qualifying row exists.
 */
export type PageVisualCache = {
  pages: Map<string, PageImageRow[]>;
  imagesById: Map<string, PageImageRow | null>;
};

export type PageVisualEvidenceCache = PageVisualCache;
export type HydrationCacheBundle = DocumentRankingMetadataCache;

/** Create page visual evidence cache. */
export function createPageVisualEvidenceCache(): PageVisualEvidenceCache {
  return {
    pages: new Map(),
    imagesById: new Map(),
  };
}

/** Create document ranking metadata cache. */
export function createDocumentRankingMetadataCache(): DocumentRankingMetadataCache {
  return {
    documentMetadata: new Map(),
    indexQuality: new Map(),
    pageVisuals: createPageVisualEvidenceCache(),
  };
}

function resolvePageVisualCache(
  cache?: DocumentRankingMetadataCache | PageVisualEvidenceCache,
): PageVisualCache | undefined {
  if (!cache) return undefined;
  if ("pages" in cache && "imagesById" in cache) return cache;
  return cache.pageVisuals;
}

const PAGE_IMAGE_ROW_LIMIT = 80;

function pageVisualKey(documentId: string, pageNumber: number | null) {
  return `${documentId}:${pageNumber}`;
}

/** Select ranked retrieval results and record the shared selection diagnostics. */
export function selectRankedRetrievalResults(args: {
  query: string;
  queryClass: RagQueryClass;
  candidates: SearchResult[];
  topK: number;
  maxResultsPerDocument: number;
  telemetry?: SearchTelemetry;
}) {
  const selection = selectRetrievalEvidence({
    query: args.query,
    queryClass: args.queryClass,
    results: rankClinicalResults(args.query, args.candidates),
    topK: args.topK,
    maxResultsPerDocument: args.maxResultsPerDocument,
  });
  if (args.telemetry) {
    args.telemetry.retrieval_intent = selection.intent;
    args.telemetry.retrieval_selection = selection.summary;
  }
  return selection.results;
}

/** Hydrate, select, and rerank the evidence used by the coverage gate. */
export async function prepareCoverageGateResults(args: {
  supabase: ReturnType<typeof createAdminClient>;
  query: string;
  candidates: SearchResult[];
  ownerId?: string;
  topK: number;
  maxResultsPerDocument: number;
  queryClass: RagQueryClass;
  telemetry: SearchTelemetry;
  metadataCache: DocumentRankingMetadataCache;
  timing: SearchTiming;
  signal?: AbortSignal;
}) {
  const rerankElapsedMs = startRerankClock(args.timing);
  const candidates = await measureSearchPhase(args.timing, "metadata_hydration", () =>
    attachDocumentRankingMetadata(args.supabase, args.candidates, args.ownerId, args.metadataCache, args.signal),
  );
  const selected = selectRankedRetrievalResults({
    query: args.query,
    queryClass: args.queryClass,
    candidates,
    topK: args.topK,
    maxResultsPerDocument: args.maxResultsPerDocument,
    telemetry: args.telemetry,
  });
  let results = await measureSearchPhase(args.timing, "visual_hydration", () =>
    attachPageVisualEvidence(args.supabase, selected, args.signal, args.metadataCache),
  );
  results = applySecondStageRerankIfNeeded({
    queryClass: args.queryClass,
    results,
    telemetry: args.telemetry,
    topK: args.topK,
  });
  args.telemetry.rerank_latency_ms += rerankElapsedMs();
  return results;
}

/** Overlap independent metadata and memory reads, then merge them deterministically. */
export async function hydrateCandidatesWithMetadataAndMemory(args: {
  supabase: ReturnType<typeof createAdminClient>;
  query: string;
  candidates: SearchResult[];
  queryEmbedding?: number[];
  ownerId?: string;
  accessScope?: RetrievalAccessScope;
  documentIds?: string[];
  matchCount: number;
  metadataCache: DocumentRankingMetadataCache;
  cardCache: MemoryCardCache;
  chunkLoadCache?: ChunkLoadCache;
  signal?: AbortSignal;
  measurePhase: <T>(phase: string, operation: () => Promise<T>) => Promise<T>;
}) {
  // Neither read consumes the other's result. Candidate assembly remains ordered because
  // memory boosts are applied only after both promises settle, preserving the serial output.
  const [metadataCandidates, memoryArtifacts] = await args.measurePhase("metadata_and_memory_hydration", () =>
    Promise.all([
      attachDocumentRankingMetadata(args.supabase, args.candidates, args.ownerId, args.metadataCache, args.signal),
      loadMemoryBoostArtifacts({
        supabase: args.supabase,
        query: args.query,
        queryEmbedding: args.queryEmbedding,
        ownerId: args.ownerId,
        accessScope: args.accessScope,
        documentIds: args.documentIds,
        matchCount: args.matchCount,
        cardCache: args.cardCache,
        chunkLoadCache: args.chunkLoadCache,
        signal: args.signal,
      }),
    ]),
  );
  return { ...applyMemoryBoostArtifacts(args.query, metadataCandidates, memoryArtifacts), metadataCandidates };
}

/** Attach document ranking metadata. */
export async function attachDocumentRankingMetadata(
  supabase: ReturnType<typeof createAdminClient>,
  results: SearchResult[],
  ownerId?: string,
  cache = createDocumentRankingMetadataCache(),
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const documentIds = Array.from(new Set(results.map((result) => result.document_id)));
  if (documentIds.length === 0) return results;
  const missingDocumentIds = documentIds.filter(
    (documentId) =>
      !cache.documentMetadata.has(documentId) &&
      results.some(
        (result) =>
          result.document_id === documentId &&
          (result.document_labels === undefined || result.document_labels.length === 0) &&
          (result.document_summary === undefined || result.document_summary === null),
      ),
  );
  if (missingDocumentIds.length === 0) {
    const enriched = results.map((result) => {
      const metadata = cache.documentMetadata.get(result.document_id);
      if (!metadata) return result;
      if (
        (result.document_labels !== undefined && result.document_labels.length > 0) ||
        (result.document_summary !== undefined && result.document_summary !== null)
      ) {
        return result;
      }
      return {
        ...result,
        document_labels: metadata.labels,
        document_summary: metadata.summary,
      };
    });
    return attachIndexQualityMetadata(supabase, enriched, ownerId, cache, signal);
  }

  const [metadataRows, indexedResults] = await Promise.all([
    fetchRelatedDocumentMetadata({
      supabase,
      ownerId,
      documentIds: missingDocumentIds,
      signal,
    }).catch(() => {
      signal?.throwIfAborted();
      return null;
    }),
    attachIndexQualityMetadata(supabase, results, ownerId, cache, signal),
  ]);
  signal?.throwIfAborted();
  if (!metadataRows) return indexedResults;

  try {
    for (const documentId of missingDocumentIds) cache.documentMetadata.set(documentId, null);
    for (const row of metadataRows) {
      cache.documentMetadata.set(row.document_id, { labels: row.labels, summary: row.summary });
    }
    return indexedResults.map((result) => {
      const metadata = cache.documentMetadata.get(result.document_id);
      if (!metadata) return result;
      return {
        ...result,
        document_labels: metadata.labels,
        document_summary: metadata.summary,
      };
    });
  } catch {
    return indexedResults;
  }
}

/** With cached index quality. */
function withCachedIndexQuality(results: SearchResult[], cache: DocumentRankingMetadataCache) {
  return results.map((result) => ({
    ...result,
    indexing_quality: cache.indexQuality.get(result.document_id) ?? result.indexing_quality ?? null,
  }));
}

/** Attach index quality metadata. */
async function attachIndexQualityMetadata(
  supabase: ReturnType<typeof createAdminClient>,
  results: SearchResult[],
  ownerId?: string,
  cache = createDocumentRankingMetadataCache(),
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  signal?.throwIfAborted();
  const documentIds = Array.from(new Set(results.map((result) => result.document_id)));
  if (documentIds.length === 0) return results;
  const missingDocumentIds = documentIds.filter((documentId) => !cache.indexQuality.has(documentId));
  if (missingDocumentIds.length === 0) return withCachedIndexQuality(results, cache);
  try {
    let query = supabase
      .from("document_index_quality")
      .select("document_id,owner_id,quality_score,extraction_quality,metrics,issues,updated_at")
      .in("document_id", missingDocumentIds);
    if (ownerId) {
      query =
        typeof query.or === "function"
          ? query.or(`owner_id.eq.${ownerId},owner_id.is.null`)
          : query.eq("owner_id", ownerId);
    } else if (typeof query.is === "function") {
      query = query.is("owner_id", null);
    }
    if (signal) query = query.abortSignal(signal);
    const { data, error } = await query;
    signal?.throwIfAborted();
    if (error) return results;
    for (const documentId of missingDocumentIds) cache.indexQuality.set(documentId, null);
    for (const row of data ?? []) {
      const { owner_id: rowOwnerId, ...qualityRow } = row;
      if (rowOwnerId && rowOwnerId !== ownerId) continue;
      cache.indexQuality.set(row.document_id, qualityRow as SearchResult["indexing_quality"]);
    }
    return withCachedIndexQuality(results, cache);
  } catch {
    signal?.throwIfAborted();
    return results;
  }
}

/** Attach page visual evidence. */
export async function attachPageVisualEvidence(
  supabase: ReturnType<typeof createAdminClient>,
  results: SearchResult[],
  signal?: AbortSignal,
  cache?: DocumentRankingMetadataCache | PageVisualEvidenceCache,
): Promise<SearchResult[]> {
  signal?.throwIfAborted();
  const documentIds = Array.from(new Set(results.map((result) => result.document_id)));
  const pageNumbers = Array.from(
    new Set(results.map((result) => result.page_number).filter((page): page is number => Boolean(page))),
  );
  const sourceImageIds = Array.from(
    new Set(
      // Index-unit and table-fact source images come first, so a chunk's ordinary image links
      // can never push an explicitly cited source image out of the bounded fetch.
      results.flatMap((result) => [
        result.index_unit?.source_image_id ?? null,
        ...(result.table_facts ?? []).map((fact) => fact.source_image_id),
        ...(result.image_ids ?? []),
      ]),
    ),
  )
    .filter((id): id is string => Boolean(id))
    .slice(0, 80);
  if (documentIds.length === 0 || (pageNumbers.length === 0 && sourceImageIds.length === 0)) return results;

  const selectColumns =
    "id,document_id,page_number,storage_path,caption,bbox,image_type,searchable,clinical_relevance_score,source_kind,width,height,labels,metadata";
  // Within one search the same pages are hydrated several times (text lane, memory boost, final
  // selection). A page read that stayed under its row limit returned every qualifying row for each
  // (document, page) pair it covered, so when a later call's pairs are already covered or partially
  // covered, only the missing (document, page) pairs are queried.
  const visualCache = resolvePageVisualCache(cache);
  const requestedPairsMap = new Map<string, { key: string; documentId: string; pageNumber: number }>();
  for (const result of results) {
    if (!result.page_number) continue;
    const key = pageVisualKey(result.document_id, result.page_number);
    if (!requestedPairsMap.has(key)) {
      requestedPairsMap.set(key, { key, documentId: result.document_id, pageNumber: result.page_number });
    }
  }
  const requestedPairs = Array.from(requestedPairsMap.values());
  const missingPairs = visualCache ? requestedPairs.filter((pair) => !visualCache.pages.has(pair.key)) : requestedPairs;
  const queryDocumentIds = Array.from(new Set(missingPairs.map((pair) => pair.documentId)));
  const queryPageNumbers = Array.from(new Set(missingPairs.map((pair) => pair.pageNumber)));
  const queryPairKeys = queryDocumentIds.flatMap((documentId) =>
    queryPageNumbers.map((page) => pageVisualKey(documentId, page)),
  );
  const missingImageIds = visualCache ? sourceImageIds.filter((id) => !visualCache.imagesById.has(id)) : sourceImageIds;
  const [pageData, directData] = await Promise.all([
    missingPairs.length === 0
      ? Promise.resolve({ data: [] as PageImageRow[], error: null })
      : (() => {
          let query = supabase
            .from("document_images")
            .select(selectColumns)
            .in("document_id", queryDocumentIds)
            .in("page_number", queryPageNumbers)
            .eq("searchable", true)
            .neq("image_type", "logo_decorative")
            .order("clinical_relevance_score", { ascending: false })
            .limit(PAGE_IMAGE_ROW_LIMIT);
          if (signal) query = query.abortSignal(signal);
          return query;
        })(),
    missingImageIds.length > 0
      ? (() => {
          let query = supabase
            .from("document_images")
            .select(selectColumns)
            .in("id", missingImageIds)
            .eq("searchable", true)
            .neq("image_type", "logo_decorative")
            .limit(missingImageIds.length);
          if (signal) query = query.abortSignal(signal);
          return query;
        })()
      : Promise.resolve({ data: [], error: null }),
  ]);
  signal?.throwIfAborted();

  if (visualCache && missingPairs.length > 0 && !pageData.error) {
    const rows = (pageData.data ?? []) as PageImageRow[];
    if (rows.length < PAGE_IMAGE_ROW_LIMIT) {
      const rowsByPair = new Map(queryPairKeys.map((key) => [key, [] as PageImageRow[]]));
      for (const row of rows) rowsByPair.get(pageVisualKey(row.document_id, row.page_number))?.push(row);
      for (const [key, pairRows] of rowsByPair) visualCache.pages.set(key, pairRows);
    }
  }
  if (visualCache && missingImageIds.length > 0 && !directData.error) {
    const fetchedById = new Map(((directData.data ?? []) as PageImageRow[]).map((row) => [row.id, row]));
    for (const id of missingImageIds) visualCache.imagesById.set(id, fetchedById.get(id) ?? null);
  }
  const missingPairKeys = new Set(missingPairs.map((pair) => pair.key));
  const pageRows =
    visualCache && requestedPairs.every((pair) => visualCache.pages.has(pair.key))
      ? requestedPairs
          .flatMap((pair) => visualCache.pages.get(pair.key) ?? [])
          .sort((left, right) => right.clinical_relevance_score - left.clinical_relevance_score)
          .slice(0, PAGE_IMAGE_ROW_LIMIT)
      : [
          ...(visualCache
            ? requestedPairs
                .filter((pair) => visualCache.pages.has(pair.key))
                .flatMap((pair) => visualCache.pages.get(pair.key) ?? [])
            : []),
          ...((pageData.data ?? []) as PageImageRow[]).filter((row) => {
            const key = pageVisualKey(row.document_id, row.page_number);
            return visualCache ? missingPairKeys.has(key) : requestedPairsMap.has(key);
          }),
        ]
          .sort((left, right) => right.clinical_relevance_score - left.clinical_relevance_score)
          .slice(0, PAGE_IMAGE_ROW_LIMIT);
  const directRows = visualCache
    ? sourceImageIds.flatMap((id) => {
        const row = visualCache.imagesById.get(id);
        return row ? [row] : [];
      })
    : ((directData.data ?? []) as PageImageRow[]);
  const directError = visualCache ? missingImageIds.length > 0 && directData.error : directData.error;
  const pageError = visualCache ? missingPairs.length > 0 && pageData.error : pageData.error;

  const data = [...pageRows, ...directRows];
  if ((pageError && directError) || data.length === 0) return results;

  const committedGenerationByDocument = new Map(
    results.map((result) => [result.document_id, committedIndexGeneration(result.source_metadata)] as const),
  );
  const imagesByPage = new Map<string, ChunkImage[]>();
  const imagesById = new Map<string, ChunkImage>();
  const documentIdByImageId = new Map<string, string>();
  for (const image of data) {
    if (imagesById.has(image.id)) continue;
    const metadata = safeRecord(image.metadata);
    if (
      !isCommittedGenerationMetadata({
        rowMetadata: metadata,
        committedGeneration: committedGenerationByDocument.get(image.document_id),
      })
    ) {
      continue;
    }
    const rawTableText = metadataText(metadata, "table_text");
    const tableText = metadataText(metadata, "table_text_snippet") ?? rawTableText;
    const publicImage: ChunkImage = {
      id: image.id,
      page_number: image.page_number,
      storage_path: image.storage_path,
      caption: image.caption,
      bbox: normalizeImageBbox(image.bbox),
      image_type: image.image_type as ChunkImage["image_type"],
      searchable: image.searchable,
      clinical_relevance_score: image.clinical_relevance_score,
      source_kind: image.source_kind,
      sourceKind: image.source_kind,
      tableLabel: metadataText(metadata, "table_label"),
      tableTitle: metadataText(metadata, "table_title"),
      tableRole: metadataText(metadata, "table_role"),
      clinicalUseClass:
        typeof metadata.clinical_use_class === "string" ? (metadata.clinical_use_class as ClinicalImageUseClass) : null,
      clinicalUseReason: typeof metadata.clinical_use_reason === "string" ? metadata.clinical_use_reason : null,
      accessibleTableMarkdown:
        typeof metadata.accessible_table_markdown === "string" ? metadata.accessible_table_markdown : rawTableText,
      tableRows: Array.isArray(metadata.table_rows) ? (metadata.table_rows as string[][]) : null,
      tableColumns: Array.isArray(metadata.table_columns) ? (metadata.table_columns as string[]) : null,
      tableTextSnippet: tableText ? compactContextText(tableText, 500) : null,
      labels: Array.isArray(image.labels) ? image.labels : [],
      metadata,
    };
    imagesById.set(image.id, publicImage);
    documentIdByImageId.set(image.id, image.document_id);
    const key = `${image.document_id}:${image.page_number}`;
    imagesByPage.set(key, [...(imagesByPage.get(key) ?? []), publicImage]);
  }

  return results.map((result) => {
    const pageImages = imagesByPage.get(`${result.document_id}:${result.page_number}`) ?? [];
    // A chunk's own image_ids link is attached only when the image belongs to the result's
    // document, so a stale or mismatched id can never carry another document's caption or table text.
    const directImages = [
      result.index_unit?.source_image_id ? imagesById.get(result.index_unit.source_image_id) : null,
      ...(result.table_facts ?? []).map((fact) => (fact.source_image_id ? imagesById.get(fact.source_image_id) : null)),
      ...(result.image_ids ?? [])
        .filter((id) => documentIdByImageId.get(id) === result.document_id)
        .map((id) => imagesById.get(id)),
    ].filter((image): image is ChunkImage => Boolean(image));
    if (pageImages.length === 0 && directImages.length === 0) return result;
    const seen = new Set((result.images ?? []).map((image) => image.id));
    const mergedImages = [
      ...(result.images ?? []),
      ...directImages.filter((image) => {
        if (seen.has(image.id)) return false;
        seen.add(image.id);
        return true;
      }),
      ...pageImages.filter((image) => {
        if (seen.has(image.id)) return false;
        seen.add(image.id);
        return true;
      }),
    ].slice(0, 4);
    return { ...result, images: mergedImages };
  });
}
