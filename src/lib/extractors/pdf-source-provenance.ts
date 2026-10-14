import { z } from "zod";
import { extractedTextSha256 } from "@/lib/extractors/docx-source-provenance";

const sha = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const rect = z
  .tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()])
  .refine(([x0, y0, x1, y1]) => x0 < x1 && y0 < y1, "pdf_geometry_invalid");
const runtime = z.string().min(1).max(256).nullable();
export const pdfPageSourceProvenanceSchema = z
  .object({
    version: z.literal("extracted-page-source-v1"),
    format: z.literal("pdf"),
    coordinateSpace: z.literal("pymupdf_observed_page_points"),
    physicalPageNumber: z.number().int().positive(),
    sourceContentSha256: sha,
    producer: z
      .object({
        contractVersion: z.literal("pdf-native-page-source-v1"),
        route: z.literal("python_pdf"),
        scriptSha256: sha,
        pythonVersion: runtime,
        pymupdfVersion: runtime,
      })
      .strict(),
    pageGeometry: z
      .object({
        pageRect: rect,
        cropBox: rect,
        mediaBox: rect,
        rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
      })
      .strict(),
    nativeTextSha256: sha,
    structuralDisposition: z.enum(["retained", "unverified"]),
    reasonCodes: z
      .array(z.enum(["pdf_geometry_transform_unverified", "pdf_ocr_unverified", "pdf_runtime_identity_unknown"]))
      .max(3),
    ocr: z
      .object({
        status: z.enum(["not_requested", "unverified"]),
        confidence: z.null(),
        confidenceStatus: z.literal("unavailable"),
        textToPageMapping: z.literal("not_established"),
        comparison: z.enum(["not_applicable", "not_compared"]),
      })
      .strict(),
    textMapping: z.object({ status: z.literal("not_established"), offsets: z.null() }).strict(),
    textIdentity: z
      .object({
        originalExtractedTextSha256: sha,
        persistedTextSha256: sha,
        normalizationApplied: z.boolean(),
        metadataNormalizationApplied: z.boolean(),
        qualification: z.literal("UTF-8 extracted/persisted text bytes; not original PDF spans"),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    const expected = [
      ...(value.pageGeometry.rotation !== 0 ||
      value.pageGeometry.cropBox.some((n, i) => n !== value.pageGeometry.mediaBox[i])
        ? ["pdf_geometry_transform_unverified"]
        : []),
      ...(value.ocr.status === "unverified" ? ["pdf_ocr_unverified"] : []),
      ...(value.producer.pythonVersion === null || value.producer.pymupdfVersion === null
        ? ["pdf_runtime_identity_unknown"]
        : []),
    ];
    if (
      new Set(value.reasonCodes).size !== value.reasonCodes.length ||
      value.reasonCodes.length !== expected.length ||
      expected.some((reason) => !value.reasonCodes.includes(reason as (typeof value.reasonCodes)[number])) ||
      value.structuralDisposition !== (expected.length ? "unverified" : "retained") ||
      value.ocr.comparison !== (value.ocr.status === "unverified" ? "not_compared" : "not_applicable")
    ) {
      context.addIssue({ code: "custom", message: "pdf_source_observations_inconsistent" });
    }
  });
export type PdfPageSourceProvenance = z.infer<typeof pdfPageSourceProvenanceSchema>;
export type PdfSourceProvenanceErrorCode = "PDF_SOURCE_PROVENANCE_INVALID" | "PDF_SOURCE_PROVENANCE_IDENTITY_MISMATCH";
export class PdfSourceProvenanceError extends Error {
  constructor(public readonly code: PdfSourceProvenanceErrorCode) {
    super(code);
    this.name = "PdfSourceProvenanceError";
  }
}

/** Validate supplied observations without treating artifact hashes as source-span mappings. */
export function validatePdfSourcePages(
  pages: Array<{
    pageNumber: number;
    text: string;
    ocrUsed?: boolean;
    needsOcr?: boolean;
    metadata?: { source_provenance?: unknown };
  }>,
  identity?: { sourceSha256: string; scriptSha256: string; requireEveryPage: boolean },
) {
  const supplied = pages.some((page) => page?.metadata && Object.hasOwn(page.metadata, "source_provenance"));
  if (!supplied && !identity?.requireEveryPage) return;
  const seen = new Set<number>();
  let sourceHash: string | undefined;
  for (const page of pages) {
    if (!page || !Number.isInteger(page.pageNumber) || page.pageNumber < 1 || typeof page.text !== "string")
      throw new PdfSourceProvenanceError("PDF_SOURCE_PROVENANCE_INVALID");
    const raw = page.metadata?.source_provenance;
    // DOCX retains its separate frozen branch; native PDF output may never substitute it.
    if (!identity && raw && typeof raw === "object" && "format" in raw && raw.format === "docx") continue;
    if (
      !identity &&
      raw &&
      typeof raw === "object" &&
      "format" in raw &&
      raw.format === "txt" &&
      "version" in raw &&
      raw.version === "extracted-page-source-v1"
    )
      continue;
    if (
      !identity &&
      raw &&
      typeof raw === "object" &&
      "format" in raw &&
      raw.format === "xlsx" &&
      "version" in raw &&
      raw.version === "extracted-page-source-v1"
    )
      continue;
    if (raw === undefined && !identity?.requireEveryPage && !supplied) continue;
    const parsed = pdfPageSourceProvenanceSchema.safeParse(raw);
    if (!parsed.success) throw new PdfSourceProvenanceError("PDF_SOURCE_PROVENANCE_INVALID");
    const provenance = parsed.data;
    if (
      provenance.physicalPageNumber !== page.pageNumber ||
      page.pageNumber > pages.length ||
      seen.has(page.pageNumber) ||
      ((page.ocrUsed || page.needsOcr) && provenance.ocr.status !== "unverified")
    ) {
      throw new PdfSourceProvenanceError("PDF_SOURCE_PROVENANCE_INVALID");
    }
    seen.add(page.pageNumber);
    if (
      (sourceHash && sourceHash !== provenance.sourceContentSha256) ||
      provenance.textIdentity.persistedTextSha256 !== extractedTextSha256(page.text) ||
      (!provenance.textIdentity.normalizationApplied &&
        provenance.textIdentity.originalExtractedTextSha256 !== provenance.textIdentity.persistedTextSha256) ||
      (identity &&
        (provenance.sourceContentSha256 !== identity.sourceSha256 ||
          provenance.producer.scriptSha256 !== identity.scriptSha256 ||
          provenance.textIdentity.originalExtractedTextSha256 !== extractedTextSha256(page.text) ||
          provenance.textIdentity.normalizationApplied ||
          provenance.textIdentity.metadataNormalizationApplied))
    ) {
      throw new PdfSourceProvenanceError("PDF_SOURCE_PROVENANCE_IDENTITY_MISMATCH");
    }
    sourceHash = provenance.sourceContentSha256;
  }
  if (identity?.requireEveryPage && pages.length === 0)
    throw new PdfSourceProvenanceError("PDF_SOURCE_PROVENANCE_INVALID");
}
