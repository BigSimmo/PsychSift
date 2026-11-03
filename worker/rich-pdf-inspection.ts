import { z } from "zod";
import { bytesDigest, generationEvidenceDigest } from "../src/lib/ingestion-generation-evidence";
import type { ProviderEgressBinding } from "../src/lib/document-ingress-safety";
import type { ExtractedDocument } from "../src/lib/types";
import { PDF_EXTRACTION_BUDGET } from "../src/lib/extractors/pdf-extraction-budget";
import { generalPdfInspectionReviewSchema } from "./general-pdf-inspection";
import type { CapturedGenerationImage } from "./generation-evidence";

export const RICH_PDF_INSPECTION_VERSION = "administrator-rich-pdf-inspection-v2" as const;
const sha = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const integer = z.number().int().nonnegative();
const pageNumber = z.number().int().positive().max(PDF_EXTRACTION_BUDGET.maxPages);
const rect = z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]);
const featureSchema = z
  .object({ nativeText: z.boolean(), rasterImages: integer, vectorDrawings: integer, nativeTables: integer })
  .strict();
export const richPdfSourceInventorySchema = featureSchema
  .extend({
    pageNumber,
    nativeTextSha256: sha,
    rasterBboxes: z.array(rect).max(10000),
    vectorBboxes: z.array(rect).max(10000),
    tableBboxes: z.array(rect).max(10000),
  })
  .strict();
const coverage = z.enum(["complete", "not_present"]);
export const richPdfInspectionReviewSchema = z
  .object({
    version: z.literal(RICH_PDF_INSPECTION_VERSION),
    binding: generalPdfInspectionReviewSchema.shape.binding,
    sourceSha256: sha,
    sourceByteLength: z
      .number()
      .int()
      .positive()
      .max(150 * 1024 * 1024),
    pageCount: z.number().int().positive().max(PDF_EXTRACTION_BUDGET.maxPages),
    pageInventory: z.literal("complete"),
    pages: z
      .array(
        z
          .object({
            pageNumber,
            text: z.string().max(2 * 1024 * 1024),
            textSha256: sha,
            nativeTextSha256: sha,
            ocrUsed: z.boolean(),
            sourceProvenanceSha256: sha,
            originalFeatures: featureSchema,
            imageOrdinals: z.array(integer).max(10000),
            tableOrdinals: z.array(integer).max(10000),
          })
          .strict(),
      )
      .min(1)
      .max(PDF_EXTRACTION_BUDGET.maxPages),
    images: z
      .array(
        z
          .object({
            ordinal: integer,
            pageNumber,
            sha256: sha,
            byteLength: z.number().int().positive(),
            sourceKind: z.string().min(1).max(80),
            width: z.number().int().positive().nullable(),
            height: z.number().int().positive().nullable(),
            metadataSha256: sha,
            descriptorSha256: sha,
          })
          .strict(),
      )
      .max(PDF_EXTRACTION_BUDGET.maxArtifacts),
    tables: z
      .array(
        z
          .object({
            ordinal: integer,
            imageOrdinal: integer,
            pageNumber,
            rows: z.array(z.array(z.string().max(100000)).max(128)).max(1000),
            rowsSha256: sha,
            metadataSha256: sha,
          })
          .strict(),
      )
      .max(PDF_EXTRACTION_BUDGET.maxArtifacts),
    sourceInventory: z.array(richPdfSourceInventorySchema).min(1).max(PDF_EXTRACTION_BUDGET.maxPages),
    featureCoverage: z
      .object({ nativeText: coverage, nativeTables: coverage, raster: coverage, ocr: coverage, figures: coverage })
      .strict(),
    activeContent: z.literal("absent"),
    encryption: z.literal("not_encrypted"),
    hiddenText: z.literal("consistent"),
    inspectedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    verificationScope: z.literal("structural_and_extracted_bytes_not_clinical_semantic_approval"),
  })
  .strict();
export type RichPdfInspectionReview = z.infer<typeof richPdfInspectionReviewSchema>;
/** Caller owns all temporary paths and must release them after fenced staging. */
export type RichPdfInspectionResult = {
  review: RichPdfInspectionReview;
  extracted: ExtractedDocument;
  capturedImages: readonly CapturedGenerationImage[];
};
function refuse(reason: string): never {
  throw new Error(`rich_pdf_inspection_${reason}`);
}

/** Checks exact current source and every reviewed artifact identity. Complete means
 * observed feature coverage only; it never asserts OCR or clinical correctness. */
export function inspectRichPdfSource(
  input: unknown,
  original: Uint8Array,
  binding: Readonly<ProviderEgressBinding>,
): RichPdfInspectionReview {
  const parsed = richPdfInspectionReviewSchema.safeParse(input);
  if (!parsed.success) return refuse("review_invalid");
  const r = parsed.data;
  const start = Date.parse(r.inspectedAt),
    end = Date.parse(r.expiresAt),
    now = Date.now();
  if (start > now || end <= now || end <= start || end - start > 86400000) refuse("review_not_current");
  if (
    r.sourceByteLength !== original.length ||
    r.sourceSha256 !== bytesDigest(Buffer.from(original)) ||
    r.sourceSha256 !== binding.contentSha256 ||
    generationEvidenceDigest(r.binding) !== generationEvidenceDigest(binding)
  )
    refuse("source_binding_mismatch");
  if (!Buffer.from(original.subarray(0, 5)).equals(Buffer.from("%PDF-"))) refuse("source_format");
  if (r.pageCount !== r.pages.length || r.sourceInventory.length !== r.pageCount) refuse("page_inventory");
  let textBytes = 0;
  for (const [index, p] of r.pages.entries()) {
    const inventory = r.sourceInventory[index]!;
    if (
      p.pageNumber !== index + 1 ||
      inventory.pageNumber !== p.pageNumber ||
      p.textSha256 !== bytesDigest(Buffer.from(p.text, "utf8")) ||
      !p.text.isWellFormed() ||
      p.nativeTextSha256 !== inventory.nativeTextSha256 ||
      inventory.rasterImages !== inventory.rasterBboxes.length ||
      inventory.vectorDrawings !== inventory.vectorBboxes.length ||
      inventory.nativeTables !== inventory.tableBboxes.length ||
      !["nativeText", "rasterImages", "vectorDrawings", "nativeTables"].every(
        (key) =>
          p.originalFeatures[key as keyof typeof p.originalFeatures] ===
          inventory[key as keyof typeof p.originalFeatures],
      )
    )
      refuse("page_binding");
    textBytes += Buffer.byteLength(p.text);
    if (
      new Set(p.imageOrdinals).size !== p.imageOrdinals.length ||
      new Set(p.tableOrdinals).size !== p.tableOrdinals.length ||
      generationEvidenceDigest(p.imageOrdinals) !==
        generationEvidenceDigest(
          r.images.filter((image) => image.pageNumber === p.pageNumber).map((image) => image.ordinal),
        ) ||
      generationEvidenceDigest(p.tableOrdinals) !==
        generationEvidenceDigest(
          r.tables.filter((table) => table.pageNumber === p.pageNumber).map((table) => table.ordinal),
        )
    )
      refuse("page_artifact_inventory");
  }
  if (textBytes > PDF_EXTRACTION_BUDGET.maxTextBytes) refuse("text_budget");
  let imageBytes = 0;
  for (const [index, image] of r.images.entries()) {
    if (image.ordinal !== index + 1 || image.pageNumber > r.pageCount) refuse("image_inventory");
    imageBytes += image.byteLength;
  }
  if (imageBytes > PDF_EXTRACTION_BUDGET.maxArtifactBytes) refuse("image_budget");
  for (const [index, table] of r.tables.entries()) {
    if (
      table.ordinal !== index ||
      !table.rows.length ||
      table.rowsSha256 !== generationEvidenceDigest(table.rows) ||
      !r.images.some((image) => image.ordinal === table.imageOrdinal && image.pageNumber === table.pageNumber)
    )
      refuse("table_inventory");
  }
  const expected = {
    nativeText: r.sourceInventory.some((p) => p.nativeText),
    nativeTables: r.sourceInventory.some((p) => p.nativeTables > 0),
    raster: r.sourceInventory.some((p) => p.rasterImages > 0),
    ocr: r.pages.some((p) => p.ocrUsed),
    figures: r.sourceInventory.some((p) => p.vectorDrawings > 0 || p.rasterImages > 0),
  };
  for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
    if (r.featureCoverage[key] !== (expected[key] ? "complete" : "not_present")) refuse("feature_coverage");
  }
  if (expected.nativeTables && !r.tables.length) refuse("native_table_coverage");
  if ((expected.figures || expected.raster) && !r.images.length) refuse("visual_coverage");
  return r;
}
