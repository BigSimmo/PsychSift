import "server-only";

import { z } from "zod";
import { getDemoDocumentPayload } from "@/lib/demo-data";
import { parseDocumentDetailPayload } from "@/lib/document-client-contracts";
import { isDemoMode, isLocalNoAuthMode } from "@/lib/env";
import { PublicApiError } from "@/lib/http";
import {
  callerOwnsDocumentRow,
  enforceDocumentReadRateLimit,
  withOwnerReadScope,
  redactNonOwnedDocumentFields,
} from "@/lib/public-api-access";
import {
  committedIndexGeneration,
  currentDocumentPageRows,
  isCommittedGenerationMetadata,
} from "@/lib/reindex-pipeline";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError } from "@/lib/supabase/auth";
import { parseRouteParams } from "@/lib/validation/params";
import { optionalQueryString, optionalUuidQuery, queryInteger } from "@/lib/validation/query";
import { normalizeImageBbox } from "@/lib/image-filtering";
import type { ApiRateLimitResult } from "@/lib/api-rate-limit";
import type { ClinicalDocument } from "@/lib/types";
import type {
  DocumentAssetScope,
  DocumentChunkWindow,
  DocumentDetailChunk,
  DocumentDetailImage,
  DocumentDetailPage,
  DocumentDetailPayload,
  DocumentDetailTableFact,
  DocumentPageWindow,
} from "@/lib/document-detail-contract";

const defaultPageWindow = 9;
const maxPageWindow = 40;
const defaultChunkWindow = 16;
const maxChunkWindow = 80;
const selectedChunkNeighborCount = 3;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const documentDetailProjection =
  "id,owner_id,title,description,file_name,file_type,file_size,storage_path,content_hash,source_path,import_batch_id,status,page_count,chunk_count,image_count,error_message,metadata,page_storage_mode,created_at,updated_at" as const;
// Matches the TableFactRow DTO in components/document-viewer/types.ts field for
// field. Selecting these explicitly keeps the generated `search_tsv` tsvector and
// `owner_id` off the wire; the table-facts route shares it for the same reason.
export const tableFactDetailProjection =
  "id,document_id,source_image_id,page_number,table_title,row_label,clinical_parameter,threshold_value,action,metadata" as const;
const documentLabelDetailProjection =
  "id,document_id,owner_id,label,label_type,source,confidence,metadata,created_at,updated_at" as const;
const documentSummaryDetailProjection =
  "id,document_id,owner_id,summary,clinical_specifics,source_chunk_ids,source_image_ids,model,generated_at,created_at,updated_at" as const;

const documentRouteParamsSchema = z.object({
  id: z.string().uuid(),
});

export const documentDetailQuerySchema = z.object({
  chunk: optionalQueryString({ maxLength: 80 }),
  page: queryInteger({ fallback: 1, min: 1, max: 1_000_000 }),
  pageLimit: queryInteger({ fallback: defaultPageWindow, min: 1, max: maxPageWindow }),
  chunkLimit: queryInteger({ fallback: defaultChunkWindow, min: 1, max: maxChunkWindow }),
  chunkOffset: queryInteger({ fallback: 0, min: 0, max: 1_000_000 }),
  assetScope: z.enum(["document", "window"]).default("document"),
});

/** API requests only accept persisted chunk UUIDs; the page schema remains broad for demo anchors. */
export const documentDetailApiQuerySchema = documentDetailQuerySchema.extend({
  chunk: optionalUuidQuery(),
});

export type DocumentDetailQuery = {
  chunk?: string;
  page: number;
  pageLimit: number;
  chunkLimit: number;
  chunkOffset: number;
  assetScope: "document" | "window";
};

export class DocumentDetailRateLimitError extends Error {
  constructor(readonly rateLimit: ApiRateLimitResult) {
    super("Document requests are rate limited. Try again shortly.");
    this.name = "DocumentDetailRateLimitError";
  }
}

function pageWindowAround(pageNumber: number, limit: number, maxPage?: number | null) {
  const half = Math.floor(limit / 2);
  const max = Math.max(1, maxPage ?? Number.MAX_SAFE_INTEGER);
  const from = Math.max(1, Math.min(pageNumber - half, Math.max(1, max - limit + 1)));
  const to = Math.min(max, from + limit - 1);
  return { from, to };
}

function safeMetadata(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function metadataText(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function compactTableText(value: string | null, limit = 500) {
  if (!value) return null;
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return null;
  return compact.length > limit ? `${compact.slice(0, limit - 3).trim()}...` : compact;
}

function metadataStringArrayRows(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  if (!Array.isArray(value)) return null;
  const rows = value
    .filter((row): row is unknown[] => Array.isArray(row))
    .map((row) => row.map((cell) => String(cell ?? "").trim()));
  return rows.length ? rows : null;
}

function metadataStringArray(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  if (!Array.isArray(value)) return null;
  const items = value.map((item) => String(item ?? "").trim()).filter(Boolean);
  return items.length ? items : null;
}

function metadataNumber(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
}

function metadataBoolean(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "boolean" ? value : null;
}

function withImageTableMetadata<T extends object>(image: T) {
  const metadata = safeMetadata((image as { metadata?: unknown }).metadata);
  const rawTableText = metadataText(metadata, "table_text");
  const tableText = rawTableText ?? metadataText(metadata, "table_text_snippet");
  const publicImage = { ...image } as Record<string, unknown>;
  delete publicImage.metadata;
  delete publicImage.document_id;
  delete publicImage.storage_path;
  delete publicImage.signed_url;
  delete publicImage.mime_type;
  return {
    ...publicImage,
    tableLabel: publicImage.tableLabel ?? metadataText(metadata, "table_label"),
    tableTitle: publicImage.tableTitle ?? metadataText(metadata, "table_title"),
    tableRole: publicImage.tableRole ?? metadataText(metadata, "table_role"),
    tableTextSnippet: publicImage.tableTextSnippet ?? compactTableText(tableText),
    clinicalUseClass: publicImage.clinicalUseClass ?? metadataText(metadata, "clinical_use_class"),
    clinicalUseReason: publicImage.clinicalUseReason ?? metadataText(metadata, "clinical_use_reason"),
    accessibleTableMarkdown:
      publicImage.accessibleTableMarkdown ?? metadataText(metadata, "accessible_table_markdown") ?? rawTableText,
    tableRows: publicImage.tableRows ?? metadataStringArrayRows(metadata, "table_rows"),
    tableColumns: publicImage.tableColumns ?? metadataStringArray(metadata, "table_columns"),
    rowCount: publicImage.rowCount ?? metadataNumber(metadata, "row_count"),
    rowsTruncated: publicImage.rowsTruncated ?? metadataBoolean(metadata, "rows_truncated"),
    columnCount: publicImage.columnCount ?? metadataNumber(metadata, "column_count"),
    cropCompleteness: publicImage.cropCompleteness ?? metadataNumber(metadata, "crop_completeness"),
    imageQualityScore: publicImage.imageQualityScore ?? metadataNumber(metadata, "image_quality_score"),
    ocrTextDensity: publicImage.ocrTextDensity ?? metadataNumber(metadata, "ocr_text_density"),
    structuredExtractionConfidence:
      publicImage.structuredExtractionConfidence ?? metadataNumber(metadata, "structured_extraction_confidence"),
    retainedForDocumentView:
      publicImage.retainedForDocumentView ?? metadataBoolean(metadata, "retained_for_document_view"),
    bbox: normalizeImageBbox((image as { bbox?: unknown }).bbox),
  };
}

function withoutMetadata<T extends { metadata?: unknown }>(row: T) {
  const projected = { ...row };
  delete projected.metadata;
  return projected;
}

function withoutPageInternals<T extends { metadata?: unknown; index_generation_id?: string | null }>(row: T) {
  const projected = withoutMetadata(row);
  delete projected.index_generation_id;
  return projected;
}

function projectDetailPage(page: DocumentDetailPage) {
  return {
    id: page.id,
    page_number: page.page_number,
    text: page.text,
    ocr_used: page.ocr_used,
    ...(page.metadata === undefined ? {} : { metadata: page.metadata }),
  };
}

function projectDetailChunk(chunk: DocumentDetailChunk) {
  return {
    id: chunk.id,
    page_number: chunk.page_number,
    chunk_index: chunk.chunk_index,
    section_heading: chunk.section_heading,
    content: chunk.content,
    image_ids: chunk.image_ids,
    ...(chunk.metadata === undefined ? {} : { metadata: chunk.metadata }),
  };
}

function withTableFactReviewMetadata<T extends { metadata?: unknown }>(fact: T) {
  const metadata = safeMetadata(fact.metadata);
  const projected = withoutMetadata(fact);
  const reviewClass = metadataText(metadata, "review_class");
  return reviewClass ? { ...projected, metadata: { review_class: reviewClass } } : projected;
}

function isHiddenDocumentLabel(label: { metadata?: unknown }) {
  const metadata = safeMetadata(label.metadata);
  return metadata.hidden === true || metadata.review_status === "hidden" || metadata.label_review_status === "hidden";
}

function withDocumentLabelReviewMetadata<T extends { metadata?: unknown }>(label: T) {
  const metadata = safeMetadata(label.metadata);
  const projected = withoutMetadata(label);
  const reviewStatus = metadataText(metadata, "review_status");
  const legacyReviewStatus = metadataText(metadata, "label_review_status");
  const reviewMetadata = {
    ...(reviewStatus ? { review_status: reviewStatus } : {}),
    ...(legacyReviewStatus ? { label_review_status: legacyReviewStatus } : {}),
    ...(metadata.hidden === true ? { hidden: true } : {}),
  };
  return Object.keys(reviewMetadata).length > 0 ? { ...projected, metadata: reviewMetadata } : projected;
}

function committedRows<T extends { metadata?: unknown }>(document: { metadata?: unknown }, rows: T[]) {
  const committedGeneration = committedIndexGeneration(document.metadata);
  return rows.filter((row) => isCommittedGenerationMetadata({ rowMetadata: row.metadata, committedGeneration }));
}

function committedGenerationFilter(document: { metadata?: unknown }) {
  const committedGeneration = committedIndexGeneration(document.metadata);
  if (!committedGeneration || !uuidPattern.test(committedGeneration)) return null;
  return `metadata->>index_generation_id.is.null,metadata->>index_generation_id.eq.${committedGeneration}`;
}

function selectedImageIds(selectedChunk: DocumentDetailChunk | null) {
  return Array.from(
    new Set(
      (selectedChunk?.image_ids ?? []).filter((id): id is string => typeof id === "string" && uuidPattern.test(id)),
    ),
  );
}

const documentViewImageVisibility =
  "or(searchable.eq.true,source_kind.eq.table_crop,metadata->>retained_for_document_view.eq.true)";

function imageWindowFilter(pageWindow: { from: number; to: number }, imageIds: string[]) {
  const filters = [
    `and(image_type.neq.logo_decorative,${documentViewImageVisibility},page_number.gte.${pageWindow.from},page_number.lte.${pageWindow.to})`,
  ];
  if (imageIds.length > 0) filters.push(`id.in.(${imageIds.join(",")})`);
  return filters.join(",");
}

function tableFactWindowFilter(pageWindow: { from: number; to: number }, imageIds: string[]) {
  const filters = ["page_number.is.null", `and(page_number.gte.${pageWindow.from},page_number.lte.${pageWindow.to})`];
  if (imageIds.length > 0) filters.push(`source_image_id.in.(${imageIds.join(",")})`);
  return filters.join(",");
}

function windowMetadata(args: {
  requestedPage: number;
  effectivePage: number;
  selectedChunk: DocumentDetailChunk | null;
  pageWindow: { from: number; to: number };
  pageLimit: number;
  pageTotal: number | null;
  chunkRangeStart: number;
  chunkRangeEnd: number;
  chunkLimit: number;
  chunkTotal: number | null;
}) {
  const pageWindow: DocumentPageWindow = {
    from: args.pageWindow.from,
    to: args.pageWindow.to,
    limit: args.pageLimit,
    total: args.pageTotal,
    hasBefore: args.pageWindow.from > 1,
    hasAfter: Boolean(args.pageTotal && args.pageWindow.to < args.pageTotal),
  };
  const chunkWindow: DocumentChunkWindow = {
    offset: args.chunkRangeStart,
    limit: args.selectedChunk ? args.chunkRangeEnd - args.chunkRangeStart + 1 : args.chunkLimit,
    total: args.chunkTotal,
    hasBefore: args.chunkRangeStart > 0,
    hasAfter: Boolean(args.chunkTotal && args.chunkRangeEnd + 1 < args.chunkTotal),
    selectedChunkId: args.selectedChunk?.id ?? null,
  };
  return {
    pageWindow,
    chunkWindow,
    window: {
      requestedPage: args.requestedPage,
      effectivePage: args.effectivePage,
      selectedChunkId: args.selectedChunk?.id ?? null,
      pages: pageWindow,
      chunks: chunkWindow,
    },
  };
}

function filterDemoAssets<T extends { page_number: number | null }>(
  rows: T[],
  assetScope: DocumentAssetScope,
  pageWindow: { from: number; to: number },
  preserve: (row: T) => boolean,
  includeGlobal: boolean,
) {
  if (assetScope === "document") return rows;
  return rows.filter(
    (row) =>
      (includeGlobal && row.page_number === null) ||
      (row.page_number !== null && row.page_number >= pageWindow.from && row.page_number <= pageWindow.to) ||
      preserve(row),
  );
}

function loadDemoDocumentDetail(rawId: string, query: DocumentDetailQuery): DocumentDetailPayload {
  const rawPayload = getDemoDocumentPayload(rawId);
  if (!rawPayload) throw new PublicApiError("Demo document not found.", 404);

  const payload = rawPayload as {
    document: ClinicalDocument;
    pages: DocumentDetailPage[];
    images: DocumentDetailImage[];
    chunks: DocumentDetailChunk[];
    tableFacts?: DocumentDetailTableFact[];
    indexHealth?: DocumentDetailPayload["indexHealth"];
  };
  const allChunks = payload.chunks ?? [];

  const selectedChunk = query.chunk ? (allChunks.find((chunk) => chunk.id === query.chunk) ?? null) : null;
  const requestedPage = Math.min(query.page, Math.max(1, payload.document.page_count ?? 1));
  const effectivePage = selectedChunk?.page_number ?? requestedPage;
  const pageRange = pageWindowAround(effectivePage, query.pageLimit, payload.document.page_count);
  const chunkRangeStart = selectedChunk
    ? Math.max(0, selectedChunk.chunk_index - selectedChunkNeighborCount)
    : query.chunkOffset;
  const chunkRangeEnd = selectedChunk
    ? selectedChunk.chunk_index + selectedChunkNeighborCount
    : query.chunkOffset + query.chunkLimit - 1;
  const chunks = allChunks.filter(
    (chunk) => chunk.chunk_index >= chunkRangeStart && chunk.chunk_index <= chunkRangeEnd,
  );
  const preservedImageIds = new Set(selectedChunk?.image_ids ?? []);
  const images = filterDemoAssets(
    payload.images ?? [],
    query.assetScope,
    pageRange,
    (image) => preservedImageIds.has(image.id),
    false,
  ).map(withImageTableMetadata);
  const tableFacts = filterDemoAssets(
    payload.tableFacts ?? [],
    query.assetScope,
    pageRange,
    (fact) => Boolean(fact.source_image_id && preservedImageIds.has(fact.source_image_id)),
    true,
  );
  const metadata = windowMetadata({
    requestedPage,
    effectivePage,
    selectedChunk,
    pageWindow: pageRange,
    pageLimit: query.pageLimit,
    pageTotal: payload.document.page_count ?? null,
    chunkRangeStart,
    chunkRangeEnd,
    chunkLimit: query.chunkLimit,
    chunkTotal: payload.document.chunk_count ?? allChunks.length,
  });

  return parseDocumentDetailPayload({
    document: payload.document,
    pages: (payload.pages ?? [])
      .filter((page) => page.page_number >= pageRange.from && page.page_number <= pageRange.to)
      .map(projectDetailPage),
    images,
    tableFacts,
    chunks: chunks.map(projectDetailChunk),
    ...(payload.indexHealth ? { indexHealth: payload.indexHealth } : {}),
    demoMode: true,
    assetScope: query.assetScope,
    ...metadata,
  });
}

/**
 * Loads the minimal authorized document-detail DTO shared by the API route and
 * the Server Component page. The document authorization check is completed
 * before any child table is queried.
 */
export async function loadAuthorizedDocumentDetail(args: {
  request: Request;
  rawId: string;
  query: DocumentDetailQuery;
}): Promise<DocumentDetailPayload> {
  const { rawId, query } = args;
  args.request.signal.throwIfAborted();
  if (isDemoMode()) return loadDemoDocumentDetail(rawId, query);

  const { id } = parseRouteParams({ id: rawId }, documentRouteParamsSchema, "Invalid document id.");
  const supabase = createAdminClient();
  const { access, rateLimit } = await enforceDocumentReadRateLimit(args.request, supabase);
  if (rateLimit.limited) throw new DocumentDetailRateLimitError(rateLimit);
  args.request.signal.throwIfAborted();

  const { data: documentRow, error: documentError } = await withOwnerReadScope(
    supabase.from("documents").select(documentDetailProjection).eq("id", id),
    access.ownerId,
  )
    .abortSignal(args.request.signal)
    .maybeSingle();
  if (documentError) throw new Error(documentError.message);
  if (!documentRow) throw new PublicApiError("Document not found.", 404);
  // The page mode only picks which page rows are current; it is not part of the response.
  const { page_storage_mode: pageStorageMode, ...document } = documentRow;
  args.request.signal.throwIfAborted();

  const isOwner = callerOwnsDocumentRow(document, access.ownerId);
  const responseDocument = isOwner
    ? document
    : redactNonOwnedDocumentFields(document as unknown as Record<string, unknown>, access.ownerId);
  const documentMetadata = safeMetadata(document.metadata);
  // The authorisation scope has already restricted non-owned rows to the public
  // corpus. Project this single clinical date without disclosing raw metadata.
  const recordedReviewDate = documentMetadata.review_date ?? documentMetadata.reviewDate;
  const publicReviewDate =
    !isOwner &&
    documentMetadata.public_corpus === true &&
    typeof recordedReviewDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(recordedReviewDate)
      ? recordedReviewDate
      : null;

  // Signed-out visitors get the document's title and source details only, not
  // its indexed text, figures, tables or summary. The library text sits behind
  // sign-in with Answer and the originals, so no child table is read here.
  // See docs/decisions/2026-10-22-library-document-text-needs-sign-in.md.
  if (!access.authenticated && !isLocalNoAuthMode()) {
    const requestedPage = Math.min(query.page, Math.max(1, document.page_count ?? 1));
    return parseDocumentDetailPayload({
      document: { ...responseDocument, labels: [], summary: null } as unknown as ClinicalDocument,
      ...(!isOwner ? { publicReviewDate } : {}),
      pages: [],
      images: [],
      tableFacts: [],
      chunks: [],
      demoMode: false,
      assetScope: query.assetScope,
      ...windowMetadata({
        requestedPage,
        effectivePage: requestedPage,
        selectedChunk: null,
        pageWindow: pageWindowAround(requestedPage, query.pageLimit, document.page_count),
        pageLimit: query.pageLimit,
        pageTotal: document.page_count ?? null,
        chunkRangeStart: query.chunkOffset,
        chunkRangeEnd: query.chunkOffset + query.chunkLimit - 1,
        chunkLimit: query.chunkLimit,
        chunkTotal: document.chunk_count ?? null,
      }),
    });
  }

  let selectedChunk: DocumentDetailChunk | null = null;
  if (query.chunk) {
    const { data, error } = await supabase
      .from("document_chunks")
      .select("id,page_number,chunk_index,section_heading,content,image_ids,metadata")
      .eq("document_id", id)
      .eq("id", query.chunk)
      .abortSignal(args.request.signal)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data && committedRows(document, [data]).length > 0) {
      selectedChunk = {
        ...data,
        image_ids: Array.isArray(data.image_ids) ? data.image_ids : [],
      } as DocumentDetailChunk;
    }
    args.request.signal.throwIfAborted();
  }

  const requestedPage = Math.min(query.page, Math.max(1, document.page_count ?? 1));
  const effectivePage = selectedChunk?.page_number ?? requestedPage;
  const pageRange = pageWindowAround(effectivePage, query.pageLimit, document.page_count);
  const chunkRangeStart = selectedChunk
    ? Math.max(0, selectedChunk.chunk_index - selectedChunkNeighborCount)
    : query.chunkOffset;
  const chunkRangeEnd = selectedChunk
    ? selectedChunk.chunk_index + selectedChunkNeighborCount
    : query.chunkOffset + query.chunkLimit - 1;
  const preservedImageIds = selectedImageIds(selectedChunk);
  const generationFilter = committedGenerationFilter(document);

  const pagesRequest = supabase
    .from("document_pages")
    .select("id,page_number,text,ocr_used,metadata,index_generation_id")
    .eq("document_id", id)
    .gte("page_number", pageRange.from)
    .lte("page_number", pageRange.to)
    .order("page_number", { ascending: true })
    .abortSignal(args.request.signal);

  const chunkQuery = supabase
    .from("document_chunks")
    .select("id,page_number,chunk_index,section_heading,content,image_ids,metadata")
    .eq("document_id", id);
  const filteredChunkQuery = generationFilter ? chunkQuery.or(generationFilter) : chunkQuery;
  const orderedChunkQuery = filteredChunkQuery.order("chunk_index", { ascending: true });
  const chunksRequest = (
    selectedChunk
      ? orderedChunkQuery.gte("chunk_index", chunkRangeStart).lte("chunk_index", chunkRangeEnd)
      : orderedChunkQuery.range(chunkRangeStart, chunkRangeEnd)
  ).abortSignal(args.request.signal);

  let imagesRequest = supabase
    .from("document_images")
    .select(
      "id,page_number,storage_path,caption,bbox,mime_type,image_type,searchable,clinical_relevance_score,source_kind,width,height,labels,metadata",
    )
    .eq("document_id", id);
  if (query.assetScope === "window") {
    imagesRequest = imagesRequest.or(imageWindowFilter(pageRange, preservedImageIds));
  } else {
    imagesRequest = imagesRequest.neq("image_type", "logo_decorative").or(documentViewImageVisibility);
  }
  const imagesPending = imagesRequest.order("page_number", { ascending: true }).abortSignal(args.request.signal);

  let tableFactsRequest = supabase.from("document_table_facts").select(tableFactDetailProjection).eq("document_id", id);
  if (generationFilter) {
    tableFactsRequest = tableFactsRequest.or(generationFilter);
  }
  if (query.assetScope === "window") {
    tableFactsRequest = tableFactsRequest.or(tableFactWindowFilter(pageRange, preservedImageIds));
  }
  const tableFactsPending = tableFactsRequest
    .order("page_number", { ascending: true })
    .limit(200)
    .abortSignal(args.request.signal);

  const labelsRequest = supabase
    .from("document_labels")
    .select(documentLabelDetailProjection)
    .eq("document_id", id)
    .order("confidence", { ascending: false })
    .abortSignal(args.request.signal);
  const summaryRequest = supabase
    .from("document_summaries")
    .select(documentSummaryDetailProjection)
    .eq("document_id", id)
    .abortSignal(args.request.signal)
    .maybeSingle();

  const [pagesResult, chunksResult, imagesResult, tableFactsResult, labelsResult, summaryResult] = await Promise.all([
    pagesRequest,
    chunksRequest,
    imagesPending,
    tableFactsPending,
    labelsRequest,
    summaryRequest,
  ]);

  for (const result of [pagesResult, chunksResult, imagesResult, tableFactsResult, labelsResult, summaryResult]) {
    if (result.error) throw new Error(result.error.message);
  }

  const publicRows = <T extends Record<string, unknown>>(rows: T[]) =>
    isOwner ? rows : rows.map((row) => redactNonOwnedDocumentFields(row, access.ownerId));
  const labels = (labelsResult.data ?? [])
    .filter((label) => !isHiddenDocumentLabel(label))
    .map(withDocumentLabelReviewMetadata);
  const metadata = windowMetadata({
    requestedPage,
    effectivePage,
    selectedChunk,
    pageWindow: pageRange,
    pageLimit: query.pageLimit,
    pageTotal: document.page_count ?? null,
    chunkRangeStart,
    chunkRangeEnd,
    chunkLimit: query.chunkLimit,
    chunkTotal: document.chunk_count ?? null,
  });

  return parseDocumentDetailPayload({
    document: {
      ...responseDocument,
      labels: publicRows(labels as Record<string, unknown>[]),
      summary:
        isOwner || !summaryResult.data
          ? (summaryResult.data ?? null)
          : redactNonOwnedDocumentFields(summaryResult.data as Record<string, unknown>, access.ownerId),
    } as unknown as ClinicalDocument,
    ...(!isOwner ? { publicReviewDate } : {}),
    pages: publicRows(
      currentDocumentPageRows(pagesResult.data ?? [], document.metadata, pageStorageMode).map(
        withoutPageInternals,
      ) as Record<string, unknown>[],
    ) as DocumentDetailPage[],
    images: publicRows(
      committedRows(document, imagesResult.data ?? []).map(withImageTableMetadata) as Record<string, unknown>[],
    ) as DocumentDetailImage[],
    tableFacts: publicRows(
      committedRows(document, tableFactsResult.data ?? []).map(withTableFactReviewMetadata) as Record<
        string,
        unknown
      >[],
    ) as DocumentDetailTableFact[],
    chunks: publicRows(
      committedRows(document, chunksResult.data ?? []).map(withoutMetadata) as Record<string, unknown>[],
    ) as DocumentDetailChunk[],
    ...(isOwner
      ? {
          indexHealth: {
            extractionQuality: metadataText(documentMetadata, "extraction_quality"),
            indexedAt: metadataText(documentMetadata, "indexed_at"),
            indexVersion: metadataText(documentMetadata, "rag_indexing_version"),
            warnings: documentMetadata.extraction_warnings ?? [],
          },
        }
      : {}),
    demoMode: false,
    assetScope: query.assetScope,
    ...metadata,
  });
}

export function sanitizeDocumentDetailError(error: unknown) {
  if (error instanceof DocumentDetailRateLimitError) return error.message;
  if (error instanceof AuthenticationError) return "Sign in to open private source documents.";
  if (error instanceof PublicApiError) return error.message;
  return "Document could not be loaded.";
}
