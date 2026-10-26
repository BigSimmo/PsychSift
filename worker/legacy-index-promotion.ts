import { assessDocumentIndexQuality, type IndexQualityChunk, type IndexQualityImage } from "../src/lib/index-quality";
import type { ExtractedDocument } from "../src/lib/types";

function refuse(reason: string): never {
  // Keep the error content-free and deterministic: retrying cannot repair missing source evidence.
  throw new Error(`legacy_index_promotion_refused:${reason}`);
}

/** Known extractor-reported defects only; this is not independent source completeness proof. */
export function assertLegacyExtractionComplete(extracted: ExtractedDocument): void {
  if (extracted.pages.some((page) => page.needsOcr === true)) refuse("unresolved_ocr");
  if (extracted.budgetUsage && extracted.budgetUsage.pages !== extracted.pages.length)
    refuse("source_page_count_mismatch");
  if (extracted.images.some((image) => image.metadata?.rows_truncated === true)) refuse("truncated_table");
}

/** Call before the sole live-generation commit; optional enrichment never supplies this evidence. */
export function assertLegacyIndexPromotion(args: {
  extracted: ExtractedDocument;
  chunks: IndexQualityChunk[];
  insertedImages: IndexQualityImage[];
}): void {
  assertLegacyExtractionComplete(args.extracted);
  const core = assessDocumentIndexQuality({
    metrics: {
      page_count: args.extracted.pages.length,
      text_character_count: args.extracted.pages.reduce((sum, page) => sum + page.text.length, 0),
      extracted_image_count: args.extracted.images.length,
      searchable_image_count: args.insertedImages.length,
      ocr_page_count: args.extracted.pages.filter((page) => page.ocrUsed).length,
      needs_ocr_page_count: args.extracted.pages.filter((page) => page.needsOcr).length,
    },
    chunks: args.chunks,
    insertedImages: args.insertedImages,
    sectionCount: 0,
    memoryCardCount: 0,
    includeOptionalEnrichment: false,
  });
  if (core.extractionQuality === "poor") refuse("poor_core_extraction");
}
