import { createHash } from "node:crypto";

export type IndexQualityChunk = {
  content: string;
  section_heading?: string | null;
  section_path?: string[] | null;
  metadata?: Record<string, unknown> | null;
};

export type IndexQualityImage = {
  sourceKind?: string | null;
  tableRows?: unknown[] | null;
  imageQualityScore?: number | null;
  cropCompleteness?: number | null;
  ocrTextDensity?: number | null;
  structuredVisualProfile?: {
    confidence?: number | null;
    thresholds?: unknown[] | null;
    flowchart_nodes?: unknown[] | null;
    risk_matrix_cells?: unknown[] | null;
    chart_findings?: unknown[] | null;
  } | null;
  metadata?: Record<string, unknown> | null;
};

export type IndexQualityMetrics = {
  page_count: number;
  text_character_count: number;
  extracted_image_count: number;
  searchable_image_count: number;
  ocr_page_count?: number;
  // CI-6: pages flagged image-only but not OCR'd (JS fallback without Python OCR prereqs).
  needs_ocr_page_count?: number;
};

export function hashIndexQualityText(text: string) {
  return createHash("sha256").update(text.replace(/\s+/g, " ").trim()).digest("hex");
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export function assessDocumentIndexQuality(args: {
  metrics: IndexQualityMetrics;
  chunks: IndexQualityChunk[];
  insertedImages: IndexQualityImage[];
  sectionCount: number;
  memoryCardCount: number;
  documentEmbeddingFieldTypes?: string[];
  /** Core promotion is assessed before optional sections/cards/document fields exist. */
  includeOptionalEnrichment?: boolean;
}) {
  const chunkCount = args.chunks.length;
  const headingCount = args.chunks.filter((chunk) => chunk.section_heading).length;
  const sectionPathCount = args.chunks.filter((chunk) => chunk.section_path?.length).length;
  const tableImages = args.insertedImages.filter((image) => image.sourceKind === "table_crop");
  const tableImagesWithRows = tableImages.filter((image) => image.tableRows?.length);
  const searchableVisuals = args.insertedImages.length;
  const visualQualityScores = args.insertedImages
    .map((image) => Number(image.imageQualityScore ?? image.metadata?.image_quality_score))
    .filter((score) => Number.isFinite(score));
  const cropCompletenessScores = args.insertedImages
    .map((image) => Number(image.cropCompleteness ?? image.metadata?.crop_completeness))
    .filter((score) => Number.isFinite(score));
  const structuredConfidenceScores = args.insertedImages
    .map((image) =>
      Number(
        image.structuredVisualProfile?.confidence ??
          image.metadata?.structured_extraction_confidence ??
          (image.metadata?.structured_visual_profile as { confidence?: unknown } | undefined)?.confidence,
      ),
    )
    .filter((score) => Number.isFinite(score));
  const visualUnitCoverage = searchableVisuals
    ? args.insertedImages.filter((image) => {
        const profile =
          image.structuredVisualProfile ??
          (image.metadata?.structured_visual_profile as typeof image.structuredVisualProfile);
        return Boolean(
          profile &&
          ((profile.thresholds?.length ?? 0) +
            (profile.flowchart_nodes?.length ?? 0) +
            (profile.risk_matrix_cells?.length ?? 0) +
            (profile.chart_findings?.length ?? 0) >
            0 ||
            image.tableRows?.length),
        );
      }).length / searchableVisuals
    : null;
  const fingerprints = args.chunks.map((chunk) => hashIndexQualityText(chunk.content));
  const duplicateChunkRatio = chunkCount ? 1 - new Set(fingerprints).size / Math.max(fingerprints.length, 1) : 0;
  const avgChunkLength = chunkCount
    ? args.chunks.reduce((sum, chunk) => sum + chunk.content.length, 0) / chunkCount
    : 0;
  const headingDensity = chunkCount ? headingCount / chunkCount : 0;
  const sectionPathCoverage = chunkCount ? sectionPathCount / chunkCount : 0;
  const tableExtractionCoverage = tableImages.length ? tableImagesWithRows.length / tableImages.length : null;
  const ocrCoverage = args.metrics.page_count ? Number(args.metrics.ocr_page_count ?? 0) / args.metrics.page_count : 0;
  const needsOcrPageCount = Number(args.metrics.needs_ocr_page_count ?? 0);
  const needsOcrCoverage = args.metrics.page_count ? needsOcrPageCount / args.metrics.page_count : 0;
  const averagePageTextChars = args.metrics.page_count
    ? args.metrics.text_character_count / args.metrics.page_count
    : 0;
  const searchableImageCoverage = args.metrics.extracted_image_count
    ? args.metrics.searchable_image_count / args.metrics.extracted_image_count
    : null;
  const fieldTypes = new Set(args.documentEmbeddingFieldTypes ?? []);
  const issues: string[] = [];

  if (chunkCount === 0) issues.push("no indexed chunks");
  if (args.metrics.page_count > 0 && chunkCount < Math.ceil(args.metrics.page_count * 0.35))
    issues.push("low chunk coverage for page count");
  if (args.metrics.page_count >= 2 && averagePageTextChars < 180) issues.push("low text coverage for page count");
  if (avgChunkLength < 120 && chunkCount > 0) issues.push("short average chunks");
  if (headingDensity < 0.08 && chunkCount >= 8) issues.push("low heading density");
  if (sectionPathCoverage < 0.3 && chunkCount >= 8) issues.push("low section path coverage");
  if (duplicateChunkRatio > 0.18) issues.push("high duplicate chunk ratio");
  if (tableImages.length > 0 && tableExtractionCoverage !== null && tableExtractionCoverage < 0.5)
    issues.push("low table row extraction coverage");
  if (args.metrics.extracted_image_count >= 3 && searchableImageCoverage !== null && searchableImageCoverage < 0.5) {
    issues.push("low searchable image coverage");
  }
  if (searchableVisuals >= 2 && visualUnitCoverage !== null && visualUnitCoverage < 0.45) {
    issues.push("low visual unit coverage");
  }
  if (structuredConfidenceScores.length >= 2 && average(structuredConfidenceScores) < 0.5) {
    issues.push("low structured visual extraction confidence");
  }
  if (args.metrics.text_character_count < 80) issues.push("low extracted text volume");
  if (needsOcrPageCount > 0)
    issues.push(
      `image-only pages not OCR'd (${needsOcrPageCount} of ${args.metrics.page_count}); install Python OCR prerequisites`,
    );
  if (args.includeOptionalEnrichment !== false) {
    if (args.sectionCount === 0) issues.push("no structured sections");
    if (args.memoryCardCount === 0) issues.push("no memory cards");
    if (!fieldTypes.has("document_title")) issues.push("missing document title embedding");
    if (!fieldTypes.has("document_summary")) issues.push("missing document summary embedding");
  }

  let qualityScore = 1;
  qualityScore -= issues.length * 0.055;
  qualityScore -= Math.min(0.22, duplicateChunkRatio * 0.55);
  qualityScore -= Math.max(0, 0.12 - headingDensity) * 0.45;
  qualityScore -= Math.max(0, 0.55 - sectionPathCoverage) * 0.08;
  if (args.metrics.page_count >= 2) qualityScore -= (Math.max(0, 220 - averagePageTextChars) / 220) * 0.1;
  if (tableExtractionCoverage !== null) qualityScore -= Math.max(0, 0.75 - tableExtractionCoverage) * 0.14;
  if (searchableImageCoverage !== null) qualityScore -= Math.max(0, 0.65 - searchableImageCoverage) * 0.06;
  if (visualUnitCoverage !== null) qualityScore -= Math.max(0, 0.62 - visualUnitCoverage) * 0.08;
  if (visualQualityScores.length) qualityScore -= Math.max(0, 0.55 - average(visualQualityScores)) * 0.06;
  if (cropCompletenessScores.length) qualityScore -= Math.max(0, 0.55 - average(cropCompletenessScores)) * 0.05;
  if (structuredConfidenceScores.length) {
    qualityScore -= Math.max(0, 0.58 - average(structuredConfidenceScores)) * 0.08;
  }
  if (chunkCount > 0 && args.metrics.page_count > 0) {
    const chunkPageCoverage = Math.min(1, chunkCount / Math.max(args.metrics.page_count * 0.75, 1));
    qualityScore -= Math.max(0, 0.82 - chunkPageCoverage) * 0.08;
  }
  qualityScore -= Math.min(0.5, needsOcrCoverage * 0.6);
  qualityScore = Math.max(0, Math.min(1, qualityScore));
  let extractionQuality = qualityScore >= 0.82 ? "good" : qualityScore >= 0.52 ? "partial" : "poor";
  // CI-6: a scanned / image-only PDF whose pages could not be OCR'd is effectively unindexed
  // even when incidental header text nudges the heuristics up to "partial". Force "poor" so it
  // is visible to eval governance and never silently treated as a good index.
  if (needsOcrPageCount > 0 && (needsOcrCoverage >= 0.5 || chunkCount === 0)) {
    extractionQuality = "poor";
  }

  return {
    qualityScore: Number(qualityScore.toFixed(3)),
    extractionQuality,
    issues,
    metrics: {
      avg_chunk_length: Number(avgChunkLength.toFixed(1)),
      duplicate_chunk_ratio: Number(duplicateChunkRatio.toFixed(3)),
      heading_density: Number(headingDensity.toFixed(3)),
      section_path_coverage: Number(sectionPathCoverage.toFixed(3)),
      table_extraction_coverage: tableExtractionCoverage === null ? null : Number(tableExtractionCoverage.toFixed(3)),
      searchable_image_coverage: searchableImageCoverage === null ? null : Number(searchableImageCoverage.toFixed(3)),
      visual_unit_coverage: visualUnitCoverage === null ? null : Number(visualUnitCoverage.toFixed(3)),
      average_image_quality_score: visualQualityScores.length ? Number(average(visualQualityScores).toFixed(3)) : null,
      average_crop_completeness: cropCompletenessScores.length
        ? Number(average(cropCompletenessScores).toFixed(3))
        : null,
      average_structured_visual_confidence: structuredConfidenceScores.length
        ? Number(average(structuredConfidenceScores).toFixed(3))
        : null,
      ocr_coverage: Number(ocrCoverage.toFixed(3)),
      average_page_text_chars: Number(averagePageTextChars.toFixed(1)),
      section_count: args.sectionCount,
      memory_card_count: args.memoryCardCount,
      document_embedding_field_types: Array.from(fieldTypes).sort(),
    },
  };
}
