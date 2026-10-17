import { z } from "zod";
import {
  ACTIVE_INDEXING_POLL_MS,
  indexingListResponse,
  offsetPagination,
  parseListRows,
} from "@/lib/api-list-response";
import { rateLimitJsonResponse } from "@/lib/api-rate-limit";
import { demoDocuments } from "@/lib/demo-data";
import { isDemoMode } from "@/lib/env";
import { jsonError } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, unauthorizedResponse } from "@/lib/supabase/auth";
import {
  callerOwnsDocumentRow,
  enforceDocumentReadRateLimit,
  redactNonOwnedDocumentFields,
  withOwnerReadScope,
} from "@/lib/public-api-access";
import { committedIndexGeneration, isCommittedGenerationMetadata } from "@/lib/reindex-pipeline";
import { parseRequestQuery, queryBoolean, queryInteger } from "@/lib/validation/query";

export const runtime = "nodejs";

const PUBLIC_DOCUMENT_LIST_COLUMNS = [
  "id",
  "title",
  "description",
  "file_name",
  "file_type",
  "status",
  "page_count",
  "chunk_count",
  "image_count",
  "created_at",
  "updated_at",
].join(",");

// Public rows are read with `metadata` only so the hidden-label and committed-generation filters can
// run server-side; `projectPublicFields` strips it (and anything else not in the public list) before
// the response is built.
const PUBLIC_DOCUMENT_QUERY_COLUMNS = `${PUBLIC_DOCUMENT_LIST_COLUMNS},metadata`;

const DOCUMENT_LIST_COLUMNS = [
  "id",
  "owner_id",
  "title",
  "description",
  "file_name",
  "file_type",
  "file_size",
  "storage_path",
  "content_hash",
  "source_path",
  "import_batch_id",
  "status",
  "page_count",
  "chunk_count",
  "image_count",
  "error_message",
  "metadata",
  "created_at",
  "updated_at",
].join(",");

const PUBLIC_LABEL_LIST_COLUMNS = [
  "id",
  "document_id",
  "label",
  "label_type",
  "source",
  "confidence",
  "created_at",
  "updated_at",
].join(",");

const PUBLIC_LABEL_QUERY_COLUMNS = `${PUBLIC_LABEL_LIST_COLUMNS},metadata`;

const LABEL_LIST_COLUMNS = [
  "id",
  "document_id",
  "owner_id",
  "label",
  "label_type",
  "source",
  "confidence",
  "metadata",
  "created_at",
  "updated_at",
].join(",");

const PUBLIC_SUMMARY_LIST_COLUMNS = ["id", "document_id", "summary", "clinical_specifics", "generated_at"].join(",");

const PUBLIC_SUMMARY_QUERY_COLUMNS = `${PUBLIC_SUMMARY_LIST_COLUMNS},metadata`;

const SUMMARY_LIST_COLUMNS = [
  "id",
  "document_id",
  "owner_id",
  "summary",
  "clinical_specifics",
  "source_chunk_ids",
  "source_image_ids",
  "model",
  "metadata",
  "generated_at",
  "created_at",
  "updated_at",
].join(",");

const VALID_STATUSES = new Set(["queued", "processing", "indexed", "failed"]);
const ACTIVE_DOCUMENT_STATUSES = new Set(["queued", "processing"]);

const documentListRowSchema = z
  .object({
    id: z.string(),
    owner_id: z.unknown().optional(),
    status: z.string().nullable().optional(),
  })
  .passthrough();
const labelListRowSchema = z.object({ document_id: z.string() }).passthrough();
const summaryListRowSchema = z.object({ document_id: z.string() }).passthrough();

type DocumentListRow = z.infer<typeof documentListRowSchema>;

function projectPublicFields<T extends Record<string, unknown>>(row: T, columns: string): Partial<T> {
  const projected: Record<string, unknown> = {};
  for (const field of columns.split(",")) {
    if (Object.hasOwn(row, field)) projected[field] = row[field];
  }
  return projected as Partial<T>;
}

const documentListQuerySchema = z.object({
  limit: queryInteger({ fallback: 100, min: 1, max: 200 }),
  // Cap the offset at 10k (matching the jobs list) so a deep-offset request cannot force
  // PostgREST to skip through a million rows as a slow-query/DoS lever. `queryInteger` clamps.
  offset: queryInteger({ fallback: 0, min: 0, max: 10_000 }),
  q: z.string().optional().default("").transform(safeSearchTerm),
  status: z
    .string()
    .optional()
    .default("")
    .transform((value) => value.trim()),
  includeMeta: queryBoolean({ defaultValue: true }),
});

function ilikePattern(value: string) {
  return `%${value.replace(/\\/g, "\\\\").replace(/[%_]/g, "\\$&")}%`;
}

function safeSearchTerm(value: string) {
  return value
    .replace(/[,%()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function indexingState(documents: DocumentListRow[]) {
  const active = documents.some((document) => ACTIVE_DOCUMENT_STATUSES.has(String(document.status ?? "")));
  return {
    active,
    pollAfterMs: active ? ACTIVE_INDEXING_POLL_MS : null,
  };
}

function documentsResponse(payload: Record<string, unknown>, indexing: ReturnType<typeof indexingState>) {
  return indexingListResponse({ ...payload, indexing }, indexing);
}

export async function GET(request: Request) {
  try {
    if (isDemoMode()) {
      return documentsResponse({ documents: demoDocuments, demoMode: true }, { active: false, pollAfterMs: null });
    }

    const {
      limit,
      offset,
      q: search,
      status,
      includeMeta,
    } = parseRequestQuery(request, documentListQuerySchema, "Invalid document list query.");

    const supabase = createAdminClient();
    const { access, rateLimit } = await enforceDocumentReadRateLimit(request, supabase);
    if (rateLimit.limited) {
      return rateLimitJsonResponse("Document requests are rate limited. Try again shortly.", rateLimit);
    }

    const effectiveIncludeMeta = access.authenticated ? includeMeta : false;
    const listColumns = access.authenticated ? DOCUMENT_LIST_COLUMNS : PUBLIC_DOCUMENT_QUERY_COLUMNS;
    let query = withOwnerReadScope(supabase.from("documents").select(listColumns, { count: "exact" }), access.ownerId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (status && VALID_STATUSES.has(status)) {
      query = query.eq("status", status);
    }
    if (search) {
      const pattern = ilikePattern(search);
      query = query.or(`title.ilike.${pattern},file_name.ilike.${pattern}`);
    }

    const { data, error, count } = await query;

    // An `offset` past the end of the result set makes PostgREST return PGRST103
    // ("Requested range not satisfiable"). That is an empty page, not a server
    // error, so return an empty page instead of throwing a 500.
    if (error && error.code !== "PGRST103") throw new Error(error.message);
    // An authenticated caller reads PUBLIC (owner_id IS NULL) documents alongside their own via
    // withOwnerReadScope. Redact operator-internal storage fields on the rows they do not own so a
    // shared public document never exposes its owner's storage_path/content_hash/etc. (S1/D1).
    const rawDocuments = parseListRows(error ? [] : data, documentListRowSchema);
    const ownedDocumentIds = new Set(
      rawDocuments.filter((document) => callerOwnsDocumentRow(document, access.ownerId)).map((document) => document.id),
    );
    const publicDocumentIds = rawDocuments
      .filter((document) => !ownedDocumentIds.has(document.id))
      .map((document) => document.id);
    const documents = rawDocuments.map((document) => redactNonOwnedDocumentFields(document, access.ownerId));
    const responseDocuments = documents.map((document) =>
      ownedDocumentIds.has(document.id) ? document : projectPublicFields(document, PUBLIC_DOCUMENT_LIST_COLUMNS),
    );
    const documentIds = documents.map((document) => document.id);
    const indexing = indexingState(documents);

    const pagination = offsetPagination({ limit, offset, pageLength: documents.length, count });

    if (documentIds.length === 0 || !effectiveIncludeMeta) {
      return documentsResponse({ documents: responseDocuments, pagination }, indexing);
    }

    const ownedIds = [...ownedDocumentIds];
    const ownedLabelsPromises = [];
    for (let i = 0; i < ownedIds.length; i += 100) {
      ownedLabelsPromises.push(
        supabase
          .from("document_labels")
          .select(LABEL_LIST_COLUMNS)
          .in("document_id", ownedIds.slice(i, i + 100)),
      );
    }
    const publicLabelsPromises = [];
    for (let i = 0; i < publicDocumentIds.length; i += 100) {
      publicLabelsPromises.push(
        supabase
          .from("document_labels")
          .select(PUBLIC_LABEL_QUERY_COLUMNS)
          .in("document_id", publicDocumentIds.slice(i, i + 100)),
      );
    }
    const ownedSummariesPromises = [];
    for (let i = 0; i < ownedIds.length; i += 100) {
      ownedSummariesPromises.push(
        supabase
          .from("document_summaries")
          .select(SUMMARY_LIST_COLUMNS)
          .in("document_id", ownedIds.slice(i, i + 100))
          .order("generated_at", { ascending: false }),
      );
    }
    const publicSummariesPromises = [];
    for (let i = 0; i < publicDocumentIds.length; i += 100) {
      publicSummariesPromises.push(
        supabase
          .from("document_summaries")
          .select(PUBLIC_SUMMARY_QUERY_COLUMNS)
          .in("document_id", publicDocumentIds.slice(i, i + 100))
          .order("generated_at", { ascending: false }),
      );
    }

    const [ownedLabelsResults, publicLabelsResults, ownedSummariesResults, publicSummariesResults] = await Promise.all([
      Promise.all(ownedLabelsPromises),
      Promise.all(publicLabelsPromises),
      Promise.all(ownedSummariesPromises),
      Promise.all(publicSummariesPromises),
    ]);

    for (const res of [
      ...ownedLabelsResults,
      ...publicLabelsResults,
      ...ownedSummariesResults,
      ...publicSummariesResults,
    ]) {
      if (res.error) throw new Error(res.error.message);
    }

    const committedGenerationByDocument = new Map<string, string | null>(
      rawDocuments.map((doc) => [doc.id, committedIndexGeneration((doc as { metadata?: unknown }).metadata)]),
    );
    const isHiddenLabelRow = (row: Record<string, unknown>) => {
      if (!row.metadata || typeof row.metadata !== "object" || Array.isArray(row.metadata)) return false;
      const meta = row.metadata as Record<string, unknown>;
      return (
        meta.hidden === true ||
        meta.hidden === "true" ||
        meta.review_status === "hidden" ||
        meta.label_review_status === "hidden"
      );
    };

    const labelsByDocument = new Map<string, unknown[]>();
    const labelRows = parseListRows(
      [...ownedLabelsResults.flatMap((res) => res.data ?? []), ...publicLabelsResults.flatMap((res) => res.data ?? [])],
      labelListRowSchema,
    );
    for (const label of labelRows) {
      if (isHiddenLabelRow(label)) continue;
      if (
        !isCommittedGenerationMetadata({
          rowMetadata: label.metadata,
          committedGeneration: committedGenerationByDocument.get(label.document_id) ?? null,
        })
      ) {
        continue;
      }
      const existing = labelsByDocument.get(label.document_id) ?? [];
      existing.push(
        ownedDocumentIds.has(label.document_id) ? label : projectPublicFields(label, PUBLIC_LABEL_LIST_COLUMNS),
      );
      labelsByDocument.set(label.document_id, existing);
    }
    const summaryRows = parseListRows(
      [
        ...ownedSummariesResults.flatMap((res) => res.data ?? []),
        ...publicSummariesResults.flatMap((res) => res.data ?? []),
      ],
      summaryListRowSchema,
    );
    const summariesByDocument = new Map<string, { row: unknown; generatedAt: string }>();
    for (const summary of summaryRows) {
      if (
        !isCommittedGenerationMetadata({
          rowMetadata: summary.metadata,
          committedGeneration: committedGenerationByDocument.get(summary.document_id) ?? null,
        })
      ) {
        continue;
      }
      const generatedAt = typeof summary.generated_at === "string" ? summary.generated_at : "";
      const existing = summariesByDocument.get(summary.document_id);
      if (!existing || (generatedAt && (!existing.generatedAt || generatedAt > existing.generatedAt))) {
        summariesByDocument.set(summary.document_id, {
          row: ownedDocumentIds.has(summary.document_id)
            ? summary
            : projectPublicFields(summary, PUBLIC_SUMMARY_LIST_COLUMNS),
          generatedAt,
        });
      }
    }

    return documentsResponse(
      {
        documents: documents.map((document) => ({
          ...(ownedDocumentIds.has(document.id)
            ? document
            : projectPublicFields(document, PUBLIC_DOCUMENT_LIST_COLUMNS)),
          labels: labelsByDocument.get(document.id) ?? [],
          summary: summariesByDocument.get(document.id)?.row ?? null,
        })),
        pagination,
      },
      indexing,
    );
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return unauthorizedResponse();
    }
    return jsonError(error);
  }
}
