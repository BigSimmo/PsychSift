// Pure builders for the extraction metrics and document_index_quality payload. Moved verbatim
// from worker/main.ts.
import type { buildChunks } from "../src/lib/chunking";
import { assessDocumentIndexQuality } from "../src/lib/index-quality";
import type { ExtractedDocument } from "../src/lib/types";
import type { uploadAndCaptionImages } from "./image-captioning";
import type { OptionalIndexWriteIssue } from "./ingestion-errors";
import type { JobRow } from "./types";

export function buildIndexQualityPayload(args: {
  job: JobRow;
  metrics: ReturnType<typeof extractionMetrics>;
  chunks: ReturnType<typeof buildChunks>;
  insertedImages: Awaited<ReturnType<typeof uploadAndCaptionImages>>["insertedImages"];
  sectionCount: number;
  memoryCardCount: number;
  documentEmbeddingFieldTypes?: string[];
  optionalIndexWriteIssues?: OptionalIndexWriteIssue[];
}) {
  const assessment = assessDocumentIndexQuality({
    metrics: args.metrics,
    chunks: args.chunks,
    insertedImages: args.insertedImages,
    sectionCount: args.sectionCount,
    memoryCardCount: args.memoryCardCount,
    documentEmbeddingFieldTypes: args.documentEmbeddingFieldTypes,
  });
  const optionalIssues = args.optionalIndexWriteIssues ?? [];
  const optionalIssueMessages = optionalIssues.map((issue) => `Optional ${issue.stage} write failed.`);
  const extractionQuality =
    optionalIssues.length > 0 && assessment.extractionQuality === "good" ? "partial" : assessment.extractionQuality;

  return {
    document_id: args.job.document_id,
    owner_id: args.job.documents.owner_id,
    quality_score: assessment.qualityScore,
    extraction_quality: extractionQuality,
    issues: [...assessment.issues, ...optionalIssueMessages],
    metrics: {
      ...args.metrics,
      ...assessment.metrics,
      optional_index_write_issues: optionalIssues,
      search_eval_hit_rate: null,
    },
    updated_at: new Date().toISOString(),
  };
}

export function extractionMetrics(
  extracted: ExtractedDocument,
  skippedImages: number,
  imageSkipReasons: Record<string, number>,
  imageTypeCounts: Record<string, number>,
) {
  const textCharacterCount = extracted.pages.reduce((sum, page) => sum + page.text.length, 0);
  const ocrPageCount = extracted.pages.filter((page) => page.ocrUsed).length;
  // CI-6: pages the extractor flagged as image-only but could NOT OCR (JS fallback without
  // the Python OCR prerequisites). Threaded into index quality so these documents are marked
  // poor and surfaced to eval governance rather than indexed near-empty.
  const needsOcrPageCount = extracted.pages.filter((page) => page.needsOcr).length;
  const warnings = [...(extracted.warnings ?? [])];
  if (textCharacterCount < 80) warnings.push("Low extracted text volume; inspect OCR quality.");

  return {
    page_count: extracted.pages.length,
    ocr_page_count: ocrPageCount,
    needs_ocr_page_count: needsOcrPageCount,
    text_character_count: textCharacterCount,
    extracted_image_count: extracted.images.length,
    searchable_image_count: Object.values(imageTypeCounts).reduce((sum, count) => sum + count, 0),
    skipped_image_count: skippedImages,
    skipped_image_reasons: imageSkipReasons,
    image_type_counts: imageTypeCounts,
    extraction_warnings: warnings,
  };
}
