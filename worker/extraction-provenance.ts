// Audit F04 (#2F8K1V): the per-document record of which reader, OCR engine and chunker produced
// a generation, so a parser defect can be traced to the documents it touched
// (scripts/extraction-provenance-report.ts). Metadata only: nothing here changes page text,
// chunk text or anything retrieval reads.
import type { buildChunks } from "../src/lib/chunking";
import type { ExtractedDocument } from "../src/lib/types";

const MAX_VERSION_LENGTH = 100;

function distinctVersions(values: Iterable<unknown>) {
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value === "string" && value.length > 0 && value.length <= MAX_VERSION_LENGTH) seen.add(value);
  }
  return [...seen].sort();
}

/**
 * Builds documents.metadata.extraction_provenance. The PDF reader block is carried as before;
 * the chunker versions come from the chunks this generation committed, and the OCR engine
 * versions from the per-page source provenance of pages that were OCR'd. A document indexed
 * before this was recorded simply lacks the key.
 */
export function buildExtractionProvenance(args: {
  extracted: Pick<ExtractedDocument, "extractor" | "pages">;
  chunks: Pick<ReturnType<typeof buildChunks>[number], "metadata">[];
  recordedAt: string;
}) {
  const ocrPages = args.extracted.pages.filter((page) => page.ocrUsed === true);
  // Audit EXT-08 (24 Oct 2026): whether the optional image-table reader, or its maths helper,
  // produced any cell text, so a fault found later in either can be traced to its documents.
  const rasterPages = args.extracted.pages.flatMap((page) => {
    const record = page.metadata?.raster_table_ocr;
    return record && typeof record === "object" ? [record as { crops?: unknown }] : [];
  });
  const rasterCrops = rasterPages.flatMap((record) => (Array.isArray(record.crops) ? record.crops : []));
  return {
    ...(args.extracted.extractor ?? {}),
    chunker_versions: distinctVersions(args.chunks.map((chunk) => chunk.metadata?.chunker_version)),
    ocr_page_count: ocrPages.length,
    ocr_engine_versions: distinctVersions(
      ocrPages.map((page) => {
        const provenance = page.metadata?.source_provenance;
        return provenance && provenance.format === "pdf" ? provenance.producer.tesseractVersion : undefined;
      }),
    ),
    raster_table_ocr_page_count: rasterPages.length,
    raster_math_transform_count: rasterCrops.filter(
      (crop) => crop && typeof crop === "object" && "ocrInputTransform" in crop && crop.ocrInputTransform,
    ).length,
    recorded_at: args.recordedAt,
  };
}
