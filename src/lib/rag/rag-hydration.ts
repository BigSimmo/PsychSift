import type { ChunkImage, ClinicalImageUseClass, SearchResult } from "@/lib/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchRelatedDocumentMetadata } from "@/lib/document-enrichment";
import { normalizeImageBbox } from "@/lib/image-filtering";
import { committedIndexGeneration, isCommittedGenerationMetadata } from "@/lib/reindex-pipeline";
import { metadataText, safeRecord } from "@/lib/rag/rag-answer-text";
import { compactContextText } from "@/lib/rag/rag-source-block";
import type { RetrievalAccessScope } from "@/lib/owner-scope";
import {
  acceptRagEvaluationRead,
  ragEvaluationReadScope,
  type RagEvaluationContext,
  type RagEvaluationStoredImageRow,
} from "@/lib/rag/rag-contracts";
import {
  applyMemoryBoostArtifacts,
  loadMemoryBoostArtifacts,
  type MemoryCardCache,
} from "@/lib/rag/rag-candidate-sources";

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
};

/** Create document ranking metadata cache. */
export function createDocumentRankingMetadataCache(): DocumentRankingMetadataCache {
  return {
    documentMetadata: new Map(),
    indexQuality: new Map(),
  };
}

/** Overlap independent metadata and memory reads, then merge them deterministically. */
export async function hydrateCandidatesWithMetadataAndMemory(args: {
  supabase: ReturnType<typeof createAdminClient> | null;
  query: string;
  candidates: SearchResult[];
  queryEmbedding?: number[];
  ownerId?: string;
  accessScope?: RetrievalAccessScope;
  documentIds?: string[];
  matchCount: number;
  metadataCache: DocumentRankingMetadataCache;
  cardCache: MemoryCardCache;
  measurePhase: <T>(phase: string, operation: () => Promise<T>) => Promise<T>;
  evaluation?: RagEvaluationContext;
}) {
  // Neither read consumes the other's result. Candidate assembly remains ordered because
  // memory boosts are applied only after both promises settle, preserving the serial output.
  const [metadataCandidates, memoryArtifacts] = await args.measurePhase("metadata_and_memory_hydration", () =>
    Promise.all([
      attachDocumentRankingMetadata(args.supabase, args.candidates, args.ownerId, args.metadataCache, args.evaluation),
      loadMemoryBoostArtifacts({
        supabase: args.supabase,
        query: args.query,
        queryEmbedding: args.queryEmbedding,
        ownerId: args.ownerId,
        accessScope: args.accessScope,
        documentIds: args.documentIds,
        matchCount: args.matchCount,
        cardCache: args.cardCache,
        evaluation: args.evaluation,
      }),
    ]),
  );
  return { ...applyMemoryBoostArtifacts(args.query, metadataCandidates, memoryArtifacts), metadataCandidates };
}

/** Attach document ranking metadata. */
export async function attachDocumentRankingMetadata(
  supabase: ReturnType<typeof createAdminClient> | null,
  results: SearchResult[],
  ownerId?: string,
  cache = createDocumentRankingMetadataCache(),
  evaluation?: RagEvaluationContext,
) {
  const documentIds = Array.from(new Set(results.map((result) => result.document_id)));
  if (documentIds.length === 0) return results;
  if (evaluation) {
    const metadataRows = await acceptRagEvaluationRead(evaluation, "ranking_metadata", () =>
      evaluation.readers.readRankingMetadata({
        ...ragEvaluationReadScope(evaluation),
        document_ids: documentIds,
      }),
    );
    const qualityRows = await acceptRagEvaluationRead(evaluation, "quality", () =>
      evaluation.readers.readQuality({
        ...ragEvaluationReadScope(evaluation),
        document_ids: documentIds,
      }),
    );
    const metadataByDocument = new Map(metadataRows.map((row) => [row.document_id, row] as const));
    const qualityByDocument = new Map(
      qualityRows.map((row) => [
        row.document_id,
        {
          ...row,
          metrics: safeRecord(row.metrics),
          issues: [...row.issues],
        } satisfies NonNullable<SearchResult["indexing_quality"]>,
      ] as const),
    );
    return results.map((result) => {
      const metadata = metadataByDocument.get(result.document_id);
      return {
        ...result,
        document_labels: metadata?.labels ? [...metadata.labels] : result.document_labels,
        document_summary: metadata?.summary ?? result.document_summary,
        indexing_quality: qualityByDocument.get(result.document_id) ?? result.indexing_quality ?? null,
      };
    });
  }
  if (!supabase) throw new Error("Supabase client is required outside U04 evaluation.");
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
    return attachIndexQualityMetadata(supabase, enriched, ownerId, cache);
  }

  const [metadataRows, indexedResults] = await Promise.all([
    fetchRelatedDocumentMetadata({
      supabase,
      ownerId,
      documentIds: missingDocumentIds,
    }).catch(() => null),
    attachIndexQualityMetadata(supabase, results, ownerId, cache),
  ]);
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
): Promise<SearchResult[]> {
  const documentIds = Array.from(new Set(results.map((result) => result.document_id)));
  if (documentIds.length === 0) return results;
  const missingDocumentIds = documentIds.filter((documentId) => !cache.indexQuality.has(documentId));
  if (missingDocumentIds.length === 0) return withCachedIndexQuality(results, cache);
  try {
    let query = supabase
      .from("document_index_quality")
      .select("document_id,owner_id,quality_score,extraction_quality,metrics,issues,updated_at")
      .in("document_id", missingDocumentIds);
    if (ownerId) query = query.eq("owner_id", ownerId);
    const { data, error } = await query;
    if (error) return results;
    for (const documentId of missingDocumentIds) cache.indexQuality.set(documentId, null);
    for (const row of data ?? []) cache.indexQuality.set(row.document_id, row as SearchResult["indexing_quality"]);
    return withCachedIndexQuality(results, cache);
  } catch {
    return results;
  }
}

/** Attach page visual evidence. */
export async function attachPageVisualEvidence(
  supabase: ReturnType<typeof createAdminClient> | null,
  results: SearchResult[],
  evaluation?: RagEvaluationContext,
): Promise<SearchResult[]> {
  const documentIds = Array.from(new Set(results.map((result) => result.document_id)));
  const pageNumbers = Array.from(
    new Set(results.map((result) => result.page_number).filter((page): page is number => Boolean(page))),
  );
  const sourceImageIds = Array.from(
    new Set(
      results.flatMap((result) => [
        result.index_unit?.source_image_id ?? null,
        ...(result.table_facts ?? []).map((fact) => fact.source_image_id),
      ]),
    ),
  )
    .filter((id): id is string => Boolean(id))
    .slice(0, 80);
  if (documentIds.length === 0 || (pageNumbers.length === 0 && sourceImageIds.length === 0)) return results;
  let data: readonly RagEvaluationStoredImageRow[];
  if (evaluation) {
    const [pageImages, directImages] = await Promise.all([
      pageNumbers.length
        ? acceptRagEvaluationRead(evaluation, "images_by_pages", () =>
            evaluation.readers.readImagesByPages({
              ...ragEvaluationReadScope(evaluation),
              document_ids: documentIds,
              page_numbers: pageNumbers,
            }),
          )
        : Promise.resolve([]),
      sourceImageIds.length
        ? acceptRagEvaluationRead(evaluation, "images_by_ids", () =>
            evaluation.readers.readImagesByIds({
              ...ragEvaluationReadScope(evaluation),
              ids: sourceImageIds,
            }),
          )
        : Promise.resolve([]),
    ]);
    data = [...pageImages, ...directImages];
  } else {
    if (!supabase) throw new Error("Supabase client is required outside U04 evaluation.");

    const selectColumns =
      "id,document_id,page_number,storage_path,caption,bbox,image_type,searchable,clinical_relevance_score,source_kind,width,height,labels,metadata";
    const [pageData, directData] = await Promise.all([
      pageNumbers.length > 0
        ? supabase
            .from("document_images")
            .select(selectColumns)
            .in("document_id", documentIds)
            .in("page_number", pageNumbers)
            .eq("searchable", true)
            .neq("image_type", "logo_decorative")
            .order("clinical_relevance_score", { ascending: false })
            .limit(80)
        : Promise.resolve({ data: [], error: null }),
      sourceImageIds.length > 0
        ? supabase
            .from("document_images")
            .select(selectColumns)
            .in("id", sourceImageIds)
            .eq("searchable", true)
            .neq("image_type", "logo_decorative")
            .limit(sourceImageIds.length)
        : Promise.resolve({ data: [], error: null }),
    ]);
    data = [...(pageData.data ?? []), ...(directData.data ?? [])];
    if (pageData.error && directData.error) return results;
  }
  if (data.length === 0) return results;

  const committedGenerationByDocument = new Map(
    results.map((result) => [result.document_id, committedIndexGeneration(result.source_metadata)] as const),
  );
  const imagesByPage = new Map<string, ChunkImage[]>();
  const imagesById = new Map<string, ChunkImage>();
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
      labels: Array.isArray(image.labels) ? [...image.labels] : [],
      metadata,
    };
    imagesById.set(image.id, publicImage);
    const key = `${image.document_id}:${image.page_number}`;
    imagesByPage.set(key, [...(imagesByPage.get(key) ?? []), publicImage]);
  }

  return results.map((result) => {
    const pageImages = imagesByPage.get(`${result.document_id}:${result.page_number}`) ?? [];
    const directImages = [
      result.index_unit?.source_image_id ? imagesById.get(result.index_unit.source_image_id) : null,
      ...(result.table_facts ?? []).map((fact) => (fact.source_image_id ? imagesById.get(fact.source_image_id) : null)),
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
