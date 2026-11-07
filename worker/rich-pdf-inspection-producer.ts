import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { bytesDigest, generationEvidenceDigest } from "../src/lib/ingestion-generation-evidence";
import type { ProviderEgressBinding } from "../src/lib/document-ingress-safety";
import type { ExtractedDocument, ExtractedImage } from "../src/lib/types";
import { extractPdf } from "../src/lib/extractors/document";
import { PDF_EXTRACTION_BUDGET } from "../src/lib/extractors/pdf-extraction-budget";
import { resolvePythonBin } from "../src/lib/python-bin";
import { assertLegacyExtractionComplete } from "./legacy-index-promotion";
import { captureGenerationImages } from "./generation-evidence";
import {
  RICH_PDF_INSPECTION_VERSION,
  inspectRichPdfSource,
  richPdfSourceInventorySchema,
  type RichPdfInspectionResult,
  type RichPdfInspectionReview,
} from "./rich-pdf-inspection";

const sourcePageSchema = z
  .object({
    pageNumber: z.number().int().positive(),
    nativeText: z.string(),
    nativeTextSha256: z.string(),
    sourceFeatures: richPdfSourceInventorySchema.omit({
      pageNumber: true,
      nativeTextSha256: true,
      rasterBboxes: true,
      vectorBboxes: true,
      tableBboxes: true,
    }),
    rasterBboxes: richPdfSourceInventorySchema.shape.rasterBboxes,
    vectorBboxes: richPdfSourceInventorySchema.shape.vectorBboxes,
    tableBboxes: richPdfSourceInventorySchema.shape.tableBboxes,
    coverageImage: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
const originalSchema = z
  .object({
    version: z.literal("rich-pdf-structural-inspection-v2"),
    status: z.literal("inspected"),
    sourceSha256: z.string(),
    sourceByteLength: z.number(),
    pageCount: z.number(),
    pages: z.array(sourcePageSchema),
    pageInventory: z.literal("complete"),
    activeContent: z.literal("absent"),
    encryption: z.literal("not_encrypted"),
    hiddenText: z.literal("consistent"),
    profile: z.literal("original-feature-inventory-v2"),
    producer: z.object({ pymupdfVersion: z.string() }),
    limitations: z.array(z.string()),
  })
  .strict();
function refuse(reason: string): never {
  throw new Error(`rich_pdf_inspection_producer_${reason}`);
}
function contains(outer: readonly number[] | null | undefined, inner: readonly number[]): boolean {
  return (
    !!outer &&
    outer.length === 4 &&
    outer[0]! <= inner[0]! + 1 &&
    outer[1]! <= inner[1]! + 1 &&
    outer[2]! >= inner[2]! - 1 &&
    outer[3]! >= inner[3]! - 1
  );
}

/** One independent original inventory plus the unchanged production extractor/OCR.
 * The successful caller owns temporaryPaths; failures always release local files. */
export async function inspectRichPdfBytes(
  input: Uint8Array,
  binding: Readonly<ProviderEgressBinding>,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<RichPdfInspectionResult> {
  options.signal?.throwIfAborted();
  const original = Buffer.from(input),
    started = Date.now(),
    timeout = options.timeoutMs ?? PDF_EXTRACTION_BUDGET.totalTimeoutMs;
  if (
    !Number.isInteger(timeout) ||
    timeout < 1 ||
    timeout > PDF_EXTRACTION_BUDGET.totalTimeoutMs ||
    original.length > 150 * 1024 * 1024 ||
    bytesDigest(original) !== binding.contentSha256
  )
    refuse("source_or_budget");
  const root = await mkdtemp(path.join(os.tmpdir(), "psychsift-rich-inspection-"));
  let extracted: ExtractedDocument | undefined;
  let success = false;
  try {
    const file = path.join(root, "source.pdf");
    await writeFile(file, original, { mode: 0o600, flag: "wx" });
    const stdout = await new Promise<string>((resolve, reject) =>
      execFile(
        resolvePythonBin(),
        [
          path.join(process.cwd(), "worker", "python", "inspect_native_pdf_source.py"),
          file,
          String(Math.min(timeout, 120000) / 1000),
          "rich",
        ],
        {
          encoding: "utf8",
          timeout: Math.min(timeout, 120000),
          maxBuffer: PDF_EXTRACTION_BUDGET.maxResultBytes,
          signal: options.signal,
          windowsHide: true,
        },
        (error, output) => {
          if (error) {
            let reason = "structural_refused";
            try {
              const r = JSON.parse(output) as { reason?: unknown };
              if (typeof r.reason === "string" && /^[a-z_]{1,80}$/.test(r.reason)) reason = r.reason;
            } catch {
              /* never print raw parser output */
            }
            reject(new Error(`rich_pdf_inspection_producer_${reason}`));
          } else resolve(output);
        },
      ),
    );
    const inventory = originalSchema.parse(JSON.parse(stdout));
    if (
      inventory.sourceSha256 !== binding.contentSha256 ||
      inventory.sourceByteLength !== original.length ||
      inventory.pageCount !== inventory.pages.length
    )
      refuse("original_binding");
    options.signal?.throwIfAborted();
    const remaining = timeout - (Date.now() - started);
    if (remaining < 1) refuse("timeout");
    extracted = await extractPdf(original, { limits: { ...PDF_EXTRACTION_BUDGET, totalTimeoutMs: remaining } });
    options.signal?.throwIfAborted();
    assertLegacyExtractionComplete(extracted);
    if (extracted.pages.length !== inventory.pageCount) refuse("page_population");
    // Retain an original full-page render only where existing producer crops fail
    // to cover an inventoried original visual. No original figure is discarded.
    for (const page of inventory.pages) {
      const boxes = [...page.rasterBboxes, ...page.vectorBboxes, ...page.tableBboxes];
      const existing = extracted.images.filter(
        (image) => image.pageNumber === page.pageNumber && image.sourceKind !== "cover_page",
      );
      if (boxes.some((box) => !existing.some((image) => contains(image.bbox, box)))) {
        if (!page.coverageImage) refuse("visual_inventory_unrepresented");
        const image = page.coverageImage as unknown as ExtractedImage;
        if (
          image.pageNumber !== page.pageNumber ||
          image.sourceKind !== "page_region" ||
          !boxes.every((box) => contains(image.bbox, box))
        )
          refuse("visual_capture_binding");
        extracted.images.push(image);
      }
    }
    extracted.temporaryPaths = [...(extracted.temporaryPaths ?? []), root];
    const capturedImages = await captureGenerationImages({
      extracted,
      trustedTemporaryRoots: extracted.temporaryPaths,
      fileName: "source.pdf",
      mimeType: "application/pdf",
      check: () => options.signal?.throwIfAborted(),
    });
    const tables: RichPdfInspectionReview["tables"] = [];
    for (const image of capturedImages) {
      const rows = image.descriptor.metadata?.table_rows;
      if (rows !== undefined && Array.isArray(rows) && rows.length) {
        if (
          image.descriptor.metadata?.rows_truncated === true ||
          rows.some((row) => !Array.isArray(row) || row.some((cell) => typeof cell !== "string"))
        )
          refuse("table_rows_incomplete");
        tables.push({
          ordinal: tables.length,
          imageOrdinal: image.ordinal,
          pageNumber: image.descriptor.pageNumber!,
          rows: rows as string[][],
          rowsSha256: generationEvidenceDigest(rows),
          metadataSha256: generationEvidenceDigest(image.descriptor.metadata ?? {}),
        });
      }
    }
    for (const page of inventory.pages) {
      if (
        page.tableBboxes.some(
          (box) =>
            !tables.some(
              (table) =>
                table.pageNumber === page.pageNumber &&
                contains(capturedImages.find((image) => image.ordinal === table.imageOrdinal)?.descriptor.bbox, box),
            ),
        )
      )
        refuse("native_table_inventory_unrepresented");
    }
    const pages: RichPdfInspectionReview["pages"] = extracted.pages.map((page, index) => {
      const source = inventory.pages[index]!;
      const provenance = page.metadata?.source_provenance;
      if (
        page.pageNumber !== source.pageNumber ||
        !provenance ||
        !("nativeTextSha256" in provenance) ||
        provenance.nativeTextSha256 !== source.nativeTextSha256
      )
        refuse("page_provenance");
      if (!source.nativeText.trim() && source.sourceFeatures.rasterImages > 0 && (!page.ocrUsed || !page.text.trim()))
        refuse("ocr_incomplete");
      return {
        pageNumber: page.pageNumber,
        text: page.text,
        textSha256: bytesDigest(Buffer.from(page.text)),
        nativeTextSha256: source.nativeTextSha256,
        ocrUsed: !!page.ocrUsed,
        sourceProvenanceSha256: generationEvidenceDigest(provenance),
        originalFeatures: source.sourceFeatures,
        imageOrdinals: capturedImages
          .filter((image) => image.descriptor.pageNumber === page.pageNumber)
          .map((image) => image.ordinal),
        tableOrdinals: tables.filter((table) => table.pageNumber === page.pageNumber).map((table) => table.ordinal),
      };
    });
    const review: RichPdfInspectionReview = {
      version: RICH_PDF_INSPECTION_VERSION,
      binding: { ...binding },
      sourceSha256: binding.contentSha256,
      sourceByteLength: original.length,
      pageCount: pages.length,
      pageInventory: "complete",
      pages,
      images: capturedImages.map((image) => ({
        ordinal: image.ordinal,
        pageNumber: image.descriptor.pageNumber!,
        sha256: image.sha256,
        byteLength: image.byteLength,
        sourceKind: image.descriptor.sourceKind ?? "fallback",
        width: image.descriptor.width ?? null,
        height: image.descriptor.height ?? null,
        metadataSha256: generationEvidenceDigest(image.descriptor.metadata ?? {}),
        descriptorSha256: generationEvidenceDigest(image.descriptor),
      })),
      tables,
      sourceInventory: inventory.pages.map((page) => ({
        pageNumber: page.pageNumber,
        nativeTextSha256: page.nativeTextSha256,
        ...page.sourceFeatures,
        rasterBboxes: page.rasterBboxes,
        vectorBboxes: page.vectorBboxes,
        tableBboxes: page.tableBboxes,
      })),
      featureCoverage: {
        nativeText: inventory.pages.some((page) => page.sourceFeatures.nativeText) ? "complete" : "not_present",
        nativeTables: inventory.pages.some((page) => page.sourceFeatures.nativeTables > 0) ? "complete" : "not_present",
        raster: inventory.pages.some((page) => page.sourceFeatures.rasterImages > 0) ? "complete" : "not_present",
        ocr: pages.some((page) => page.ocrUsed) ? "complete" : "not_present",
        figures: inventory.pages.some(
          (page) => page.sourceFeatures.rasterImages > 0 || page.sourceFeatures.vectorDrawings > 0,
        )
          ? "complete"
          : "not_present",
      },
      activeContent: "absent",
      encryption: "not_encrypted",
      hiddenText: "consistent",
      inspectedAt: new Date(started).toISOString(),
      expiresAt: new Date(started + 3600000).toISOString(),
      verificationScope: "structural_and_extracted_bytes_not_clinical_semantic_approval",
    };
    inspectRichPdfSource(review, original, binding);
    success = true;
    return { review, extracted, capturedImages };
  } finally {
    if (!success)
      await Promise.all(
        [root, ...(extracted?.temporaryPaths ?? [])].map((directory) =>
          rm(directory, { recursive: true, force: true }),
        ),
      );
  }
}
