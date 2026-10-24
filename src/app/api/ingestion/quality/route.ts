import { NextResponse } from "next/server";
import { z } from "zod";
import { parseListRows } from "@/lib/api-list-response";
import { consumeApiRateLimit, rateLimitJsonResponse } from "@/lib/api-rate-limit";
import { isDemoMode } from "@/lib/env";
import { currentDocumentPageRows } from "@/lib/reindex-pipeline";
import { jsonError } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, requireAuthenticatedUser, unauthorizedResponse } from "@/lib/supabase/auth";
import { parseRequestQuery, queryInteger } from "@/lib/validation/query";

export const runtime = "nodejs";

type Severity = "danger" | "warning" | "info";
type ReviewType =
  "failed_ocr" | "low_extraction_confidence" | "missing_tables" | "image_only_pages" | "failed_job" | "manual_review";

const nullableRecordSchema = z.record(z.string(), z.unknown()).nullable();
const nullableStringSchema = z.string().nullable();
const nullableNumberSchema = z.number().nullable();

const documentRowSchema = z
  .object({
    id: z.string(),
    title: nullableStringSchema,
    file_name: nullableStringSchema,
    status: nullableStringSchema,
    page_count: nullableNumberSchema,
    chunk_count: nullableNumberSchema,
    image_count: nullableNumberSchema,
    error_message: nullableStringSchema,
    metadata: nullableRecordSchema,
    updated_at: nullableStringSchema,
  })
  .passthrough();

const qualityRowSchema = z
  .object({
    document_id: z.string(),
    quality_score: nullableNumberSchema,
    extraction_quality: nullableStringSchema,
    metrics: nullableRecordSchema,
    issues: z.array(z.string()).nullable(),
    updated_at: nullableStringSchema,
  })
  .passthrough();

const jobRowSchema = z
  .object({
    id: z.string(),
    document_id: z.string(),
    status: nullableStringSchema,
    stage: nullableStringSchema,
    error_message: nullableStringSchema,
    updated_at: nullableStringSchema,
  })
  .passthrough();

const stageRowSchema = z
  .object({
    id: z.string(),
    document_id: z.string(),
    job_id: nullableStringSchema,
    stage_name: nullableStringSchema,
    stage_status: nullableStringSchema,
    error_message: nullableStringSchema,
    metadata: nullableRecordSchema,
    artifact_counts: nullableRecordSchema,
    finished_at: nullableStringSchema,
    started_at: nullableStringSchema,
  })
  .passthrough();

const pageRowSchema = z
  .object({
    document_id: z.string(),
    page_number: nullableNumberSchema,
    text: nullableStringSchema,
    ocr_used: z.boolean().nullable(),
    metadata: nullableRecordSchema,
    index_generation_id: z.string().nullable().optional(),
  })
  .passthrough();

function currentPagesByDocument<T extends { document_id: string; index_generation_id?: string | null }>(
  pages: T[],
  documents: Array<{ id: string; metadata?: unknown }>,
) {
  const byDocument = new Map<string, T[]>();
  for (const page of pages) byDocument.set(page.document_id, [...(byDocument.get(page.document_id) ?? []), page]);
  return documents.flatMap((document) => currentDocumentPageRows(byDocument.get(document.id) ?? [], document.metadata));
}

const imageRowSchema = z
  .object({
    document_id: z.string(),
    page_number: nullableNumberSchema,
    source_kind: nullableStringSchema,
    searchable: z.boolean().nullable(),
    metadata: nullableRecordSchema,
  })
  .passthrough();

type DocumentRow = z.infer<typeof documentRowSchema>;
type QualityRow = z.infer<typeof qualityRowSchema>;
type JobRow = z.infer<typeof jobRowSchema>;
type StageRow = z.infer<typeof stageRowSchema>;
type PageRow = z.infer<typeof pageRowSchema>;
type ImageRow = z.infer<typeof imageRowSchema>;

type ReviewItem = {
  id: string;
  type: ReviewType;
  severity: Severity;
  title: string;
  detail: string;
  documentId: string;
  documentTitle: string;
  fileName: string;
  jobId: string | null;
  qualityScore: number | null;
  extractionQuality: string | null;
  reasons: string[];
  metrics: Record<string, unknown>;
  updatedAt: string | null;
};

const ingestionQualityQuerySchema = z.object({
  limit: queryInteger({ fallback: 120, min: 1, max: 200 }),
});

// Hosted Supabase/PostgREST silently caps a single response at 1,000 rows —
// the same limit search-scope.ts already names and pages around (#075). This
// route's child reads (pages, images, jobs, stages) had no `.limit()` at all,
// so a corpus whose newest documents-window holds more than 1,000 combined
// pages/images/jobs/stages would have rows dropped past the cut with no
// error, and the review heuristics below would score whichever rows survived
// as if that were the whole document set — a document past the cut can be
// reported clean when it is not (#M11). Bounding explicitly, rather than
// relying on the platform default, lets the route detect exactly hitting the
// cap and say so instead of staying silent.
const CHILD_QUERY_ROW_CAP = 1000;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function unique(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))));
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function includesAny(value: string, needles: string[]) {
  const normalized = value.toLowerCase();
  return needles.some((needle) => normalized.includes(needle));
}

function tableRowsFromMetadata(metadata: Record<string, unknown>) {
  const rows = metadata.table_rows;
  return Array.isArray(rows) ? rows.length : 0;
}

function groupRowsByDocument<Row extends { document_id: string }>(rows: Row[]) {
  const groupedRows = new Map<string, Row[]>();
  for (const row of rows) {
    const documentRows = groupedRows.get(row.document_id);
    if (documentRows) {
      documentRows.push(row);
    } else {
      groupedRows.set(row.document_id, [row]);
    }
  }
  return groupedRows;
}

function itemPriority(item: ReviewItem) {
  const severityRank = item.severity === "danger" ? 0 : item.severity === "warning" ? 1 : 2;
  const typeRank: Record<ReviewType, number> = {
    failed_job: 0,
    failed_ocr: 1,
    image_only_pages: 2,
    missing_tables: 3,
    low_extraction_confidence: 4,
    manual_review: 5,
  };
  return severityRank * 10 + typeRank[item.type];
}

function buildReviewItems(args: {
  documents: DocumentRow[];
  qualityRows: QualityRow[];
  jobs: JobRow[];
  stages: StageRow[];
  pages: PageRow[];
  images: ImageRow[];
}) {
  const qualityByDocument = new Map(args.qualityRows.map((row) => [row.document_id, row]));
  const jobsByDocument = groupRowsByDocument(args.jobs);
  const stagesByDocument = groupRowsByDocument(args.stages);
  const pagesByDocument = groupRowsByDocument(args.pages);
  const imagesByDocument = groupRowsByDocument(args.images);

  const items: ReviewItem[] = [];
  const pushItem = (document: DocumentRow, item: Omit<ReviewItem, "documentId" | "documentTitle" | "fileName">) => {
    items.push({
      ...item,
      documentId: document.id,
      documentTitle: document.title || document.file_name || "Document",
      fileName: document.file_name || document.title || "document",
    });
  };

  for (const document of args.documents) {
    const metadata = asRecord(document.metadata);
    const quality = qualityByDocument.get(document.id);
    const issues = unique([...(quality?.issues ?? []), ...stringArray(metadata.index_quality_issues)]);
    const metrics = { ...asRecord(quality?.metrics), ...asRecord(metadata.index_quality_metrics) };
    const qualityScore = Number(quality?.quality_score ?? metadata.index_quality_score ?? NaN);
    const normalizedQualityScore = Number.isFinite(qualityScore) ? qualityScore : null;
    const extractionQuality = String(quality?.extraction_quality ?? metadata.extraction_quality ?? "unknown");
    const documentJobs = jobsByDocument.get(document.id) ?? [];
    const documentStages = stagesByDocument.get(document.id) ?? [];
    const documentPages = pagesByDocument.get(document.id) ?? [];
    const documentImages = imagesByDocument.get(document.id) ?? [];
    const latestJob = documentJobs[0];
    const failedJob =
      latestJob?.status === "failed"
        ? latestJob
        : document.status === "failed"
          ? documentJobs.find((job) => job.status === "failed")
          : undefined;
    const ingestionJobIds = new Set(documentJobs.map((job) => job.id));
    const latestStagesByName = new Map<string, (typeof documentStages)[number]>();
    for (const stage of documentStages) {
      const key = stage.stage_name ?? stage.id;
      if (!latestStagesByName.has(key)) latestStagesByName.set(key, stage);
    }
    const failedOcrStage = Array.from(latestStagesByName.values()).find((stage) => {
      if (stage.stage_status !== "failed") return false;
      if (!includesAny(`${stage.stage_name ?? ""} ${stage.error_message ?? ""}`, ["ocr", "extract"])) return false;
      if (latestJob?.status !== "completed") return true;
      if (stage.job_id && ingestionJobIds.has(stage.job_id)) {
        return stage.job_id === latestJob.id;
      }
      const stageTimestamp = stage.finished_at ?? stage.started_at;
      return !latestJob.updated_at || !stageTimestamp || stageTimestamp >= latestJob.updated_at;
    });
    const warnings = Array.isArray(metadata.extraction_warnings) ? metadata.extraction_warnings.map(String) : [];
    const ocrWarning = unique([...warnings, ...issues]).find((warning) => includesAny(warning, ["ocr", "scanned"]));
    const lowTextPages = documentPages.filter((page) => String(page.text ?? "").trim().length < 80);
    const needsOcrPages = documentPages.filter((page) => Boolean(asRecord(page.metadata).needsOcr));
    const tableImages = documentImages.filter((image) => image.source_kind === "table_crop");
    const tablesWithoutRows = tableImages.filter((image) => tableRowsFromMetadata(asRecord(image.metadata)) === 0);
    const tableIssue = issues.find((issue) => includesAny(issue, ["table row", "table extraction", "weak table"]));

    if (failedJob) {
      pushItem(document, {
        id: `failed_job:${document.id}:${failedJob.id}`,
        type: "failed_job",
        severity: "danger",
        title: "Failed indexing job",
        detail: failedJob.error_message || document.error_message || "The most recent indexing job failed.",
        jobId: failedJob.id,
        qualityScore: normalizedQualityScore,
        extractionQuality,
        reasons: unique([failedJob.stage ?? null, failedJob.error_message ?? null]),
        metrics,
        updatedAt: failedJob.updated_at ?? document.updated_at,
      });
    }

    if (failedOcrStage || ocrWarning) {
      pushItem(document, {
        id: `failed_ocr:${document.id}:${failedOcrStage?.id ?? "warning"}`,
        type: "failed_ocr",
        severity: "danger",
        title: "OCR or extraction failed",
        detail:
          failedOcrStage?.error_message || ocrWarning || "OCR/extraction warnings were recorded for this document.",
        jobId: failedOcrStage?.job_id && ingestionJobIds.has(failedOcrStage.job_id) ? failedOcrStage.job_id : null,
        qualityScore: normalizedQualityScore,
        extractionQuality,
        reasons: unique([failedOcrStage?.stage_name, failedOcrStage?.error_message, ocrWarning]),
        metrics,
        updatedAt:
          failedOcrStage?.finished_at ?? failedOcrStage?.started_at ?? quality?.updated_at ?? document.updated_at,
      });
    }

    if (
      needsOcrPages.length > 0 ||
      (document.page_count && lowTextPages.length >= Math.max(1, Math.ceil(document.page_count * 0.35))) ||
      issues.some((issue) => includesAny(issue, ["low text coverage", "low extracted text volume"]))
    ) {
      pushItem(document, {
        id: `image_only_pages:${document.id}`,
        type: "image_only_pages",
        severity: "warning",
        title: "Image-heavy pages need review",
        detail: `${Math.max(needsOcrPages.length, lowTextPages.length)} page${Math.max(needsOcrPages.length, lowTextPages.length) === 1 ? "" : "s"} have little extracted text or need OCR.`,
        jobId: null,
        qualityScore: normalizedQualityScore,
        extractionQuality,
        reasons: unique([
          "low page text coverage",
          ...issues.filter((issue) => includesAny(issue, ["text coverage", "text volume"])),
        ]),
        metrics,
        updatedAt: quality?.updated_at ?? document.updated_at,
      });
    }

    if (tableIssue || tablesWithoutRows.length > 0) {
      pushItem(document, {
        id: `missing_tables:${document.id}`,
        type: "missing_tables",
        severity: "warning",
        title: "Table extraction needs review",
        detail:
          tableIssue ||
          `${tablesWithoutRows.length} detected table image${tablesWithoutRows.length === 1 ? "" : "s"} have no structured rows.`,
        jobId: null,
        qualityScore: normalizedQualityScore,
        extractionQuality,
        reasons: unique([tableIssue, tablesWithoutRows.length ? "table crop without rows" : null]),
        metrics,
        updatedAt: quality?.updated_at ?? document.updated_at,
      });
    }

    if (
      extractionQuality === "poor" ||
      extractionQuality === "partial" ||
      (normalizedQualityScore !== null && normalizedQualityScore < 0.72) ||
      issues.some((issue) =>
        includesAny(issue, ["low structured visual extraction confidence", "low visual unit coverage"]),
      )
    ) {
      pushItem(document, {
        id: `low_extraction_confidence:${document.id}`,
        type: "low_extraction_confidence",
        severity:
          extractionQuality === "poor" || (normalizedQualityScore !== null && normalizedQualityScore < 0.52)
            ? "danger"
            : "warning",
        title: "Low extraction confidence",
        detail: `Extraction is ${extractionQuality}; index quality is ${normalizedQualityScore === null ? "unknown" : normalizedQualityScore.toFixed(2)}.`,
        jobId: null,
        qualityScore: normalizedQualityScore,
        extractionQuality,
        reasons: issues.slice(0, 6),
        metrics,
        updatedAt: quality?.updated_at ?? document.updated_at,
      });
    }

    if (metadata.clinical_validation_status === "unverified" || metadata.document_status === "review_due") {
      pushItem(document, {
        id: `manual_review:${document.id}`,
        type: "manual_review",
        severity: "info",
        title: "Manual source review pending",
        detail: "The source is unverified or review due.",
        jobId: null,
        qualityScore: normalizedQualityScore,
        extractionQuality,
        reasons: unique([String(metadata.clinical_validation_status ?? ""), String(metadata.document_status ?? "")]),
        metrics,
        updatedAt: quality?.updated_at ?? document.updated_at,
      });
    }
  }

  return items.sort(
    (a, b) => itemPriority(a) - itemPriority(b) || (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""),
  );
}

export async function GET(request: Request) {
  try {
    if (isDemoMode()) return NextResponse.json({ items: [], demoMode: true });

    const supabase = createAdminClient();
    const user = await requireAuthenticatedUser(request, supabase, { administrator: true });

    const rateLimit = await consumeApiRateLimit({
      supabase,
      ownerId: user.id,
      bucket: "ingestion_admin",
      allowInMemoryFallbackOnUnavailable: true,
    });
    if (rateLimit.limited) {
      return rateLimitJsonResponse("Too many ingestion administration requests. Retry shortly.", rateLimit);
    }

    const { limit } = parseRequestQuery(request, ingestionQualityQuerySchema, "Invalid ingestion quality query.");

    const { data: documentsData, error: documentsError } = await supabase
      .from("documents")
      .select("id,title,file_name,status,page_count,chunk_count,image_count,error_message,metadata,updated_at")
      .eq("owner_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (documentsError) throw new Error(documentsError.message);

    const documents = parseListRows(documentsData, documentRowSchema);
    const documentIds = documents.map((document) => document.id);
    if (documentIds.length === 0) return NextResponse.json({ items: [] });

    const [qualityResult, jobsResult, stagesResult, pagesResult, imagesResult] = await Promise.all([
      supabase
        .from("document_index_quality")
        .select("document_id,quality_score,extraction_quality,metrics,issues,updated_at")
        .in("document_id", documentIds),
      supabase
        .from("ingestion_jobs")
        .select("id,document_id,status,stage,error_message,updated_at")
        .in("document_id", documentIds)
        .order("updated_at", { ascending: false })
        .limit(CHILD_QUERY_ROW_CAP),
      supabase
        .from("ingestion_job_stages")
        .select(
          "id,document_id,job_id,stage_name,stage_status,error_message,metadata,artifact_counts,finished_at,started_at",
        )
        .in("document_id", documentIds)
        .order("started_at", { ascending: false })
        .limit(CHILD_QUERY_ROW_CAP),
      supabase
        .from("document_pages")
        .select("document_id,page_number,text,ocr_used,metadata,index_generation_id")
        .in("document_id", documentIds)
        .limit(CHILD_QUERY_ROW_CAP),
      supabase
        .from("document_images")
        .select("document_id,page_number,source_kind,searchable,metadata")
        .in("document_id", documentIds)
        .limit(CHILD_QUERY_ROW_CAP),
    ]);

    for (const result of [qualityResult, jobsResult, stagesResult, pagesResult, imagesResult]) {
      if (result.error) throw new Error(result.error.message);
    }

    // A result that lands exactly on the explicit cap means rows may have
    // been cut off (#M11) — report which tables so a caller does not treat a
    // capped read as a complete one. `qualityResult` has no `.limit()` (one
    // row per document, itself already bounded by the document-window limit
    // above), so it is deliberately not in this list.
    const cappedChildTables: Array<[string, unknown[] | null]> = [
      ["ingestion_jobs", jobsResult.data],
      ["ingestion_job_stages", stagesResult.data],
      ["document_pages", pagesResult.data],
      ["document_images", imagesResult.data],
    ];
    const partialTables = cappedChildTables
      .filter(([, data]) => Array.isArray(data) && data.length >= CHILD_QUERY_ROW_CAP)
      .map(([table]) => table);

    return NextResponse.json({
      items: buildReviewItems({
        documents,
        qualityRows: parseListRows(qualityResult.data, qualityRowSchema),
        jobs: parseListRows(jobsResult.data, jobRowSchema),
        stages: parseListRows(stagesResult.data, stageRowSchema),
        // Only each document's current page copies: after a re-index the older copies stay stored
        // for rollback, and counting them inflated page and OCR totals (audit 2026-10-24, E2E-02).
        pages: currentPagesByDocument(parseListRows(pagesResult.data, pageRowSchema), documents),
        images: parseListRows(imagesResult.data, imageRowSchema),
      }).slice(0, 80),
      ...(partialTables.length > 0 ? { partial: true, partialTables } : {}),
    });
  } catch (error) {
    if (error instanceof AuthenticationError) return unauthorizedResponse();
    return jsonError(error);
  }
}
