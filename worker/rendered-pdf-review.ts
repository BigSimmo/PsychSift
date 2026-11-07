/** Source-anchored human render review. This contract grants no ingestion,
 * provider, publication or clinical authority. The native-v2 route stays separate. */
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  bytesDigest,
  freezeGenerationEvidence,
  generationEvidenceDigest,
} from "../src/lib/ingestion-generation-evidence";
import { PDF_EXTRACTION_BUDGET } from "../src/lib/extractors/pdf-extraction-budget";
import type { ExtractedDocument } from "../src/lib/types";
import type { RenderedPdfInspection } from "./rendered-pdf-inspection-producer";

export const RENDERED_PDF_REVIEW_VERSION = "administrator-rendered-pdf-inspection-v1" as const;
const sha = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const positive = z.number().int().positive();
const index = z.number().int().nonnegative();
const pageNumber = positive.max(PDF_EXTRACTION_BUDGET.maxPages);
const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const rect = z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]);
const text = z
  .string()
  .max(PDF_EXTRACTION_BUDGET.maxTextBytes)
  .refine((value) => value.isWellFormed());
const artifact = z.object({ sha256: sha, byteLength: positive.max(PDF_EXTRACTION_BUDGET.maxArtifactBytes) }).strict();
const render = artifact.extend({ width: positive, height: positive }).strict();
const runtimeVersion = z.string().regex(/^[A-Za-z0-9.+_-]{1,128}$/);
const runtime = z
  .object({
    pythonVersion: runtimeVersion,
    pymupdfVersion: runtimeVersion,
    mupdfVersion: runtimeVersion,
    tesseractVersion: runtimeVersion,
    pillowVersion: runtimeVersion,
    pytesseractVersion: runtimeVersion,
    rendererScriptSha256: sha,
    extractorScriptSha256: sha,
  })
  .strict();
/** Offsets are JavaScript UTF-16 indices into this page's exact render OCR text.
 * Manual transcriptions are trusted only through the independently allowed digest. */
const reviewedText = z.discriminatedUnion("origin", [
  z.object({ origin: z.literal("render_ocr"), region: rect, start: index, end: index, text }).strict(),
  z.object({ origin: z.literal("manual_render_transcription"), region: rect, text }).strict(),
]);
const table = z
  .object({
    id,
    region: rect,
    relationships: z.literal("reviewed_complete"),
    rows: z
      .array(
        z
          .object({
            rowIndex: index,
            cells: z
              .array(z.object({ columnIndex: index, content: reviewedText }).strict())
              .min(1)
              .max(128),
          })
          .strict(),
      )
      .min(1)
      .max(1000),
  })
  .strict();
const diagram = z
  .object({
    id,
    region: rect,
    relationships: z.literal("reviewed_complete"),
    nodes: z
      .array(z.object({ id, content: reviewedText }).strict())
      .min(1)
      .max(1000),
    edges: z
      .array(
        z
          .object({
            id,
            fromNodeId: id,
            toNodeId: id,
            direction: z.enum(["directed", "undirected"]),
            label: reviewedText.nullable(),
            region: rect,
          })
          .strict(),
      )
      .max(4000),
  })
  .strict();
const tableCoverage = z.discriminatedUnion("status", [
  z.object({ status: z.literal("absent") }).strict(),
  z.object({ status: z.literal("reviewed_complete"), records: z.array(table).min(1).max(1000) }).strict(),
]);
const diagramCoverage = z.discriminatedUnion("status", [
  z.object({ status: z.literal("absent") }).strict(),
  z.object({ status: z.literal("reviewed_complete"), records: z.array(diagram).min(1).max(1000) }).strict(),
]);

export const renderedPdfReviewSchema = z
  .object({
    version: z.literal(RENDERED_PDF_REVIEW_VERSION),
    verificationScope: z.literal("source_anchored_render_review_not_clinical_signoff"),
    authority: z.literal("render_review_only_no_ingestion_provider_publication_or_clinical_approval"),
    sourceSha256: sha,
    sourceByteLength: positive.max(150 * 1024 * 1024),
    pageCount: pageNumber,
    nativeLayerDisposition: z.literal("excluded_from_admitted_evidence"),
    originalNativeConflict: z.literal("unresolved"),
    runtime,
    rasterContainer: artifact,
    reviewer: z.object({ reviewerId: z.uuid(), reviewedAt: z.iso.datetime(), referenceSha256: sha }).strict(),
    pageCoverage: z.literal("reviewed_complete"),
    pages: z
      .array(
        z
          .object({
            pageNumber,
            fullPageReviewed: z.literal(true),
            coordinateSpace: z.literal("render_pixels"),
            originalGeometrySha256: sha,
            render,
            ocrTextSha256: sha,
            ocrTextByteLength: index.max(PDF_EXTRACTION_BUDGET.maxTextBytes),
            textCoverage: z.literal("reviewed_complete"),
            text: z.array(reviewedText).max(10000),
            tables: tableCoverage,
            diagrams: diagramCoverage,
            unresolvedHolds: z.array(z.never()).max(0),
          })
          .strict(),
      )
      .min(1)
      .max(PDF_EXTRACTION_BUDGET.maxPages),
  })
  .strict();

export type RenderedPdfReview = z.infer<typeof renderedPdfReviewSchema>;
const validatedReviews = new WeakSet<object>();
export function assertValidatedRenderedPdfReview(result: RenderedPdfReviewResult): void {
  if (!validatedReviews.has(result)) throw new Error("rendered_pdf_review_validated_result_required");
}
export type ReviewedRenderText = z.infer<typeof reviewedText>;
export type ReviewedRenderTable = z.infer<typeof table>;
export type ReviewedRenderDiagram = z.infer<typeof diagram>;
export type RenderedPdfReviewResult = {
  review: RenderedPdfReview;
  reviewSha256: string;
  reviewedPages: RenderedPdfReview["pages"];
  reviewedTables: Array<{ pageNumber: number; table: ReviewedRenderTable }>;
  reviewedDiagrams: Array<{ pageNumber: number; diagram: ReviewedRenderDiagram }>;
  fullPageRenders: Array<{
    pageNumber: number;
    path: string;
    sha256: string;
    byteLength: number;
    width: number;
    height: number;
  }>;
  extracted: ExtractedDocument;
  retention: {
    rasterContainer: RenderedPdfInspection["rasterContainer"];
    pages: Array<{
      pageNumber: number;
      originalGeometry: RenderedPdfInspection["renderPages"][number]["originalGeometry"];
      ocrText: string;
    }>;
  };
};
function refuse(reason: string): never {
  throw new Error(`rendered_pdf_review_${reason}`);
}
const same = (a: unknown, b: unknown) => generationEvidenceDigest(a) === generationEvidenceDigest(b);
export function renderedPdfReviewDigest(input: unknown): string {
  const parsed = renderedPdfReviewSchema.safeParse(input);
  if (!parsed.success) refuse("record_invalid");
  return generationEvidenceDigest(parsed.data);
}
async function verifyFile(file: string, expected: { sha256: string; byteLength: number }) {
  if (!path.isAbsolute(file)) refuse("artifact_path_invalid");
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size !== expected.byteLength) refuse("artifact_changed");
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(file)) {
    const bytes = chunk as Buffer;
    size += bytes.length;
    if (size > expected.byteLength) refuse("artifact_changed");
    hash.update(bytes);
  }
  if (size !== expected.byteLength || `sha256:${hash.digest("hex")}` !== expected.sha256) refuse("artifact_changed");
}
function contains(outer: readonly number[], inner: readonly number[]) {
  return (
    inner[0] >= outer[0] &&
    inner[1] >= outer[1] &&
    inner[2] <= outer[2] &&
    inner[3] <= outer[3] &&
    inner[0] < inner[2] &&
    inner[1] < inner[3]
  );
}
function validateText(value: ReviewedRenderText, ocr: string, bounds: readonly number[], allowEmptyCell = false) {
  if (!contains(bounds, value.region)) refuse("region_mapping_invalid");
  if (
    value.origin === "render_ocr" &&
    (value.end <= value.start || value.end > ocr.length || ocr.slice(value.start, value.end) !== value.text)
  )
    refuse("ocr_mapping_invalid");
  if (!value.text.trim() && !(allowEmptyCell && value.origin === "manual_render_transcription"))
    refuse("empty_reviewed_text");
}
function rejectNativeMix(value: unknown): void {
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (/native.*(?:text|table)/i.test(key) && !(key === "nativeTables" && item === "not_inspected_strings_excluded"))
      refuse("native_layer_mixed");
    rejectNativeMix(item);
  }
}

/** inspection must come from a fresh inspectRenderedPdfOriginal call. Its files,
 * OCR/provenance, runtime scripts and source are rechecked here. A JSON clone is
 * never an opaque capability. approvedReviewSha256 is trusted server policy;
 * it MUST NOT come from the request, document metadata, or this review record.
 * Caller retains ownership of the wrapper's temporary paths. */
export async function validateRenderedPdfReview(input: {
  review: unknown;
  inspection: RenderedPdfInspection;
  sourcePath: string;
  originalBytes: Uint8Array;
  approvedReviewSha256: ReadonlySet<string>;
}): Promise<RenderedPdfReviewResult> {
  try {
    const parsed = renderedPdfReviewSchema.safeParse(input.review);
    if (!parsed.success) refuse("record_invalid");
    const review = parsed.data;
    const reviewSha256 = renderedPdfReviewDigest(review);
    if (!input.approvedReviewSha256.has(reviewSha256)) refuse("not_approved");
    if (Date.parse(review.reviewer.reviewedAt) > Date.now()) refuse("review_time_invalid");
    // Copy before the first awaited file read; do not mutate the held result or
    // let caller-side object changes replace identities during validation.
    const inspected = structuredClone(input.inspection);
    rejectNativeMix(inspected);
    if (
      review.sourceSha256 !== bytesDigest(Buffer.from(input.originalBytes)) ||
      review.sourceByteLength !== input.originalBytes.length ||
      inspected.sourceSha256 !== review.sourceSha256 ||
      inspected.sourceByteLength !== review.sourceByteLength
    )
      refuse("source_binding_mismatch");
    if (!Buffer.from(input.originalBytes.subarray(0, 5)).equals(Buffer.from("%PDF-"))) refuse("source_format_invalid");
    await verifyFile(input.sourcePath, { sha256: review.sourceSha256, byteLength: review.sourceByteLength });
    if (
      inspected.version !== "rendered-pdf-source-v1" ||
      inspected.status !== "held_for_review" ||
      inspected.nativeLayerDisposition !== review.nativeLayerDisposition ||
      inspected.activeContent !== "absent" ||
      inspected.encryption !== "absent" ||
      !same(inspected.runtime, review.runtime)
    )
      refuse("wrapper_binding_mismatch");
    for (const [script, expected] of [
      ["worker/python/inspect_rendered_pdf_source.py", review.runtime.rendererScriptSha256],
      ["worker/python/extract_pdf_assets.py", review.runtime.extractorScriptSha256],
    ] as const) {
      const file = path.resolve(script);
      const info = await lstat(file);
      await verifyFile(file, { sha256: expected, byteLength: info.size });
    }
    if (
      review.pageCount !== review.pages.length ||
      inspected.pageCount !== review.pageCount ||
      inspected.renderPages.length !== review.pageCount ||
      inspected.extraction.pages.length !== review.pageCount
    )
      refuse("page_coverage_invalid");
    if (inspected.temporaryPaths.length !== 1) refuse("artifact_path_invalid");
    const root = await realpath(inspected.temporaryPaths[0]!);
    if (!(await lstat(root)).isDirectory()) refuse("artifact_path_invalid");
    const verifiedFiles = new Map<string, { sha256: string; byteLength: number }>();
    let artifactBytes = 0;
    for (const item of inspected.artifactInventory) {
      const resolved = await realpath(item.path);
      const relative = path.relative(root, resolved);
      if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
        refuse("artifact_path_invalid");
      if (verifiedFiles.has(resolved)) refuse("artifact_inventory_invalid");
      artifactBytes += item.byteLength;
      if (
        verifiedFiles.size >= PDF_EXTRACTION_BUDGET.maxArtifacts ||
        artifactBytes > PDF_EXTRACTION_BUDGET.maxArtifactBytes
      )
        refuse("artifact_budget_exceeded");
      await verifyFile(item.path, item);
      verifiedFiles.set(resolved, item);
    }
    const verifyArtifact = async (
      item: { path: string; sha256: string; byteLength: number },
      identity: z.infer<typeof artifact>,
    ) => {
      const observed = verifiedFiles.get(await realpath(item.path));
      if (
        !observed ||
        !same({ sha256: item.sha256, byteLength: item.byteLength }, identity) ||
        !same({ sha256: observed.sha256, byteLength: observed.byteLength }, identity)
      )
        refuse("artifact_binding_mismatch");
    };
    await verifyArtifact(inspected.rasterContainer, review.rasterContainer);
    const reviewedTables: RenderedPdfReviewResult["reviewedTables"] = [];
    const reviewedDiagrams: RenderedPdfReviewResult["reviewedDiagrams"] = [];
    const fullPageRenders: RenderedPdfReviewResult["fullPageRenders"] = [];
    const extracted: ExtractedDocument = {
      pages: [],
      images: [],
      temporaryPaths: [...inspected.temporaryPaths],
      extractor: { name: "administrator-rendered-pdf-review", version: RENDERED_PDF_REVIEW_VERSION },
    };
    let textBytes = 0;
    for (const [ordinal, page] of review.pages.entries()) {
      const sourcePage = inspected.extraction.pages[ordinal]!;
      const rendered = inspected.renderPages[ordinal]!;
      const provenance = sourcePage.metadata.source_provenance;
      const ocr = sourcePage.text;
      if (
        page.pageNumber !== ordinal + 1 ||
        sourcePage.pageNumber !== page.pageNumber ||
        rendered.pageNumber !== page.pageNumber ||
        page.ocrTextSha256 !== bytesDigest(Buffer.from(ocr)) ||
        page.ocrTextByteLength !== Buffer.byteLength(ocr) ||
        !ocr.isWellFormed() ||
        !sourcePage.ocrUsed ||
        page.originalGeometrySha256 !== generationEvidenceDigest(rendered.originalGeometry) ||
        !same(page.render, {
          sha256: rendered.artifact.sha256,
          byteLength: rendered.artifact.byteLength,
          width: rendered.artifact.width,
          height: rendered.artifact.height,
        }) ||
        provenance.sourceContentSha256 !== review.sourceSha256 ||
        provenance.physicalPageNumber !== page.pageNumber ||
        provenance.renderSha256 !== page.render.sha256 ||
        provenance.rasterContainerSha256 !== review.rasterContainer.sha256 ||
        provenance.nativeLayerDisposition !== review.nativeLayerDisposition ||
        provenance.producer.route !== "python_pdf_rendered" ||
        provenance.producer.scriptSha256 !== review.runtime.extractorScriptSha256 ||
        provenance.producer.rendererScriptSha256 !== review.runtime.rendererScriptSha256 ||
        ["pythonVersion", "pymupdfVersion", "mupdfVersion", "tesseractVersion"].some(
          (key) =>
            provenance.producer[key as keyof typeof provenance.producer] !==
            review.runtime[key as keyof typeof review.runtime],
        ) ||
        provenance.textIdentity.originalExtractedTextSha256 !== page.ocrTextSha256 ||
        provenance.textIdentity.persistedTextSha256 !== page.ocrTextSha256
      )
        refuse("page_binding_mismatch");
      if (provenance.reasonCodes.includes("pdf_runtime_identity_unknown")) refuse("unresolved_runtime_hold");
      if (page.render.width * page.render.height > PDF_EXTRACTION_BUDGET.maxRenderPixels)
        refuse("render_budget_exceeded");
      await verifyArtifact(rendered.artifact, { sha256: page.render.sha256, byteLength: page.render.byteLength });
      const bounds = [0, 0, page.render.width, page.render.height];
      const parts: string[] = [];
      for (const item of page.text) {
        validateText(item, ocr, bounds);
        parts.push(item.text);
      }
      const ids = new Set<string>();
      if (page.tables.status === "reviewed_complete")
        for (const item of page.tables.records) {
          if (ids.has(item.id) || !contains(bounds, item.region)) refuse("table_mapping_invalid");
          ids.add(item.id);
          const width = item.rows[0]!.cells.length;
          for (const [rowIndex, row] of item.rows.entries()) {
            if (row.rowIndex !== rowIndex || row.cells.length !== width) refuse("table_relationships_invalid");
            for (const [columnIndex, cell] of row.cells.entries()) {
              if (cell.columnIndex !== columnIndex) refuse("table_relationships_invalid");
              validateText(cell.content, ocr, item.region, true);
            }
            parts.push(row.cells.map((cell) => cell.content.text).join("\t"));
          }
          reviewedTables.push({ pageNumber: page.pageNumber, table: item });
        }
      if (page.diagrams.status === "reviewed_complete")
        for (const item of page.diagrams.records) {
          if (ids.has(item.id) || !contains(bounds, item.region)) refuse("diagram_mapping_invalid");
          ids.add(item.id);
          const nodes = new Map(item.nodes.map((node) => [node.id, node]));
          if (nodes.size !== item.nodes.length) refuse("diagram_relationships_invalid");
          for (const node of item.nodes) {
            validateText(node.content, ocr, item.region);
            parts.push(node.content.text);
          }
          const edges = new Set<string>();
          for (const edge of item.edges) {
            if (
              edges.has(edge.id) ||
              !nodes.has(edge.fromNodeId) ||
              !nodes.has(edge.toNodeId) ||
              !contains(item.region, edge.region)
            )
              refuse("diagram_relationships_invalid");
            edges.add(edge.id);
            if (edge.label) validateText(edge.label, ocr, edge.region);
            parts.push(
              `${nodes.get(edge.fromNodeId)!.content.text}${edge.direction === "directed" ? " -> " : " -- "}${nodes.get(edge.toNodeId)!.content.text}${edge.label ? `: ${edge.label.text}` : ""}`,
            );
          }
          reviewedDiagrams.push({ pageNumber: page.pageNumber, diagram: item });
        }
      const pageText = parts.join("\n");
      textBytes += Buffer.byteLength(pageText);
      if (textBytes > PDF_EXTRACTION_BUDGET.maxTextBytes) refuse("text_budget_exceeded");
      const metadata = {
        rendered_pdf_review: {
          version: review.version,
          reviewSha256,
          sourceSha256: review.sourceSha256,
          renderSha256: page.render.sha256,
          ocrTextSha256: page.ocrTextSha256,
          nativeLayerDisposition: review.nativeLayerDisposition,
          originalNativeConflict: review.originalNativeConflict,
          verificationScope: review.verificationScope,
        },
      };
      extracted.pages.push({ pageNumber: page.pageNumber, text: pageText, ocrUsed: true, needsOcr: false, metadata });
      fullPageRenders.push({ pageNumber: page.pageNumber, path: rendered.artifact.path, ...page.render });
      extracted.images.push({
        pageNumber: page.pageNumber,
        path: rendered.artifact.path,
        mimeType: "image/png",
        width: page.render.width,
        height: page.render.height,
        sourceKind: "page_region",
        metadata: { ...metadata, source_kind: "rendered_page_pixels", full_page_render: true },
      });
    }
    const result = freezeGenerationEvidence({
      review,
      reviewSha256,
      reviewedPages: review.pages,
      reviewedTables,
      reviewedDiagrams,
      fullPageRenders,
      extracted,
      retention: {
        rasterContainer: inspected.rasterContainer,
        pages: inspected.renderPages.map((page, index) => ({
          pageNumber: page.pageNumber,
          originalGeometry: page.originalGeometry,
          ocrText: inspected.extraction.pages[index]!.text,
        })),
      },
    });
    validatedReviews.add(result);
    return result;
  } catch (error) {
    if (error instanceof Error && /^rendered_pdf_review_[a-z_]+$/.test(error.message)) throw error;
    return refuse("validation_failed");
  }
}
