import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bytesDigest as sha, generationEvidenceDigest } from "../src/lib/ingestion-generation-evidence";

const processBoundary = vi.hoisted(() => ({ spawn: vi.fn(), terminate: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: processBoundary.spawn }));
vi.mock("../src/lib/extractors/document", () => ({ terminateProcessTree: processBoundary.terminate }));
import { inspectRenderedPdfOriginal } from "../worker/rendered-pdf-inspection-producer";
import {
  renderedPdfReviewDigest,
  validateRenderedPdfReview,
  type RenderedPdfReview,
} from "../worker/rendered-pdf-review";

const folders: string[] = [];
const hash = (value: string | Buffer) => sha(Buffer.from(value));
afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

async function fixture() {
  const folder = await mkdtemp(path.join(os.tmpdir(), "review-render-synthetic-"));
  folders.push(folder);
  const sourcePath = path.join(folder, "synthetic.pdf");
  const originalBytes = Buffer.from("%PDF-1.7\nSYNTHETIC ORIGINAL NATIVE EXCLUDED\n%%EOF");
  await writeFile(sourcePath, originalBytes);
  processBoundary.spawn.mockImplementation((_bin: string, args: string[]) => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      pid: 765432,
      exitCode: null,
    });
    processBoundary.terminate.mockImplementation(async () => {
      child.emit("close", null);
    });
    void (async () => {
      const stage = args[2]!;
      const renderPath = path.join(stage, "page.png"),
        containerPath = path.join(stage, "raster.pdf");
      await writeFile(renderPath, "SYNTHETIC PIXELS");
      await writeFile(containerPath, "SYNTHETIC RASTER CONTAINER");
      const runtime = {
        pythonVersion: "3.12",
        pymupdfVersion: "1.26",
        mupdfVersion: "1.26",
        tesseractVersion: "5.4.0",
        pillowVersion: "11.0",
        pytesseractVersion: "0.3",
        rendererScriptSha256: hash(await readFile(args[0]!)),
        extractorScriptSha256: hash(await readFile(path.resolve("worker/python/extract_pdf_assets.py"))),
      };
      const geometry = {
        pageRect: [0, 0, 100, 100],
        cropBox: [0, 0, 100, 100],
        mediaBox: [0, 0, 100, 100],
        rotation: 0,
      };
      const text = "Alpha Beta Next";
      const sourceHash = hash(originalBytes),
        renderHash = hash("SYNTHETIC PIXELS"),
        containerHash = hash("SYNTHETIC RASTER CONTAINER");
      const holds = ["table_relationships_unverified", "diagram_relationships_unverified"];
      const result = {
        version: "rendered-pdf-source-v1",
        status: "held_for_review",
        sourceSha256: sourceHash,
        sourceByteLength: originalBytes.length,
        pageCount: 1,
        nativeLayerDisposition: "excluded_from_admitted_evidence",
        activeContent: "absent",
        encryption: "absent",
        runtime,
        rasterContainer: { path: containerPath, sha256: containerHash, byteLength: 26 },
        renderPages: [
          {
            pageNumber: 1,
            originalGeometry: geometry,
            nativeFeatureDiagnostics: {
              textPaintOperations: 1,
              vectorPaintOperations: 1,
              rasterImages: 0,
              nativeTables: "not_inspected_strings_excluded",
              semanticRelationships: "not_established",
            },
            artifact: { path: renderPath, sha256: renderHash, byteLength: 16, width: 100, height: 100 },
            unresolvedFeatureHolds: holds,
          },
        ],
        extraction: {
          pages: [
            {
              pageNumber: 1,
              text,
              ocrUsed: true,
              needsOcr: false,
              metadata: {
                image_coverage_ratio: 1,
                source_provenance: {
                  version: "extracted-page-source-v1",
                  format: "pdf",
                  coordinateSpace: "raster_container_page_points",
                  physicalPageNumber: 1,
                  sourceContentSha256: sourceHash,
                  rasterContainerSha256: containerHash,
                  renderSha256: renderHash,
                  nativeLayerDisposition: "excluded_from_admitted_evidence",
                  producer: {
                    contractVersion: "pdf-rendered-page-source-v1",
                    route: "python_pdf_rendered",
                    scriptSha256: runtime.extractorScriptSha256,
                    rendererScriptSha256: runtime.rendererScriptSha256,
                    pythonVersion: runtime.pythonVersion,
                    pymupdfVersion: runtime.pymupdfVersion,
                    mupdfVersion: runtime.mupdfVersion,
                    tesseractVersion: runtime.tesseractVersion,
                  },
                  pageGeometry: geometry,
                  structuralDisposition: "unverified",
                  reasonCodes: ["pdf_ocr_unverified", ...holds],
                  ocr: {
                    status: "unverified",
                    confidence: null,
                    confidenceStatus: "unavailable",
                    textToPageMapping: "not_established",
                    comparison: "not_compared",
                  },
                  textMapping: { status: "not_established", offsets: null },
                  textIdentity: {
                    originalExtractedTextSha256: hash(text),
                    persistedTextSha256: hash(text),
                    normalizationApplied: false,
                    metadataNormalizationApplied: false,
                    qualification: "UTF-8 extracted/persisted text bytes; not original PDF spans",
                  },
                },
              },
            },
          ],
          images: [],
          budgetUsage: { pages: 1, artifacts: 0, artifactBytes: 0, textBytes: Buffer.byteLength(text) },
        },
        budgetUsage: { pages: 1, artifacts: 2, artifactBytes: 42, textBytes: Buffer.byteLength(text) },
        limitations: ["ocr_text_unverified", ...holds, "whole_source_semantic_fidelity_not_established"],
      };
      child.stdout.emit("data", Buffer.from(JSON.stringify(result)));
      child.emit("close", 0);
    })();
    return child;
  });
  const inspection = await inspectRenderedPdfOriginal(sourcePath, path.join(folder, "artifacts"), hash(originalBytes));
  const render = inspection.renderPages[0]!;
  const span = (start: number, end: number): RenderedPdfReview["pages"][number]["text"][number] => ({
    origin: "render_ocr",
    start,
    end,
    text: inspection.extraction.pages[0]!.text.slice(start, end),
    region: [1, 1, 90, 90],
  });
  const review: RenderedPdfReview = {
    version: "administrator-rendered-pdf-inspection-v1",
    verificationScope: "source_anchored_render_review_not_clinical_signoff",
    authority: "render_review_only_no_ingestion_provider_publication_or_clinical_approval",
    sourceSha256: inspection.sourceSha256,
    sourceByteLength: inspection.sourceByteLength,
    pageCount: 1,
    nativeLayerDisposition: "excluded_from_admitted_evidence",
    originalNativeConflict: "unresolved",
    runtime: inspection.runtime,
    rasterContainer: { sha256: inspection.rasterContainer.sha256, byteLength: inspection.rasterContainer.byteLength },
    reviewer: {
      reviewerId: "11111111-1111-4111-8111-111111111111",
      reviewedAt: "2026-01-01T00:00:00Z",
      referenceSha256: hash("SYNTHETIC REVIEW REFERENCE"),
    },
    pageCoverage: "reviewed_complete",
    pages: [
      {
        pageNumber: 1,
        fullPageReviewed: true,
        coordinateSpace: "render_pixels",
        originalGeometrySha256: generationEvidenceDigest(render.originalGeometry),
        render: { sha256: render.artifact.sha256, byteLength: render.artifact.byteLength, width: 100, height: 100 },
        ocrTextSha256: hash(inspection.extraction.pages[0]!.text),
        ocrTextByteLength: 15,
        textCoverage: "reviewed_complete",
        text: [span(0, 15)],
        tables: {
          status: "reviewed_complete",
          records: [
            {
              id: "t1",
              region: [0, 0, 100, 100],
              relationships: "reviewed_complete",
              rows: [
                {
                  rowIndex: 0,
                  cells: [
                    { columnIndex: 0, content: span(0, 5) },
                    { columnIndex: 1, content: span(6, 10) },
                  ],
                },
              ],
            },
          ],
        },
        diagrams: {
          status: "reviewed_complete",
          records: [
            {
              id: "d1",
              region: [0, 0, 100, 100],
              relationships: "reviewed_complete",
              nodes: [
                { id: "a", content: span(0, 5) },
                { id: "b", content: span(6, 10) },
              ],
              edges: [
                {
                  id: "e1",
                  fromNodeId: "a",
                  toNodeId: "b",
                  direction: "directed",
                  label: span(11, 15),
                  region: [0, 0, 100, 100],
                },
              ],
            },
          ],
        },
        unresolvedHolds: [],
      },
    ],
  };
  const input = {
    review,
    inspection,
    sourcePath,
    originalBytes,
    approvedReviewSha256: new Set([renderedPdfReviewDigest(review)]),
  };
  const approve = () => {
    input.approvedReviewSha256 = new Set([renderedPdfReviewDigest(review)]);
  };
  return { input, review, inspection, approve };
}

describe("source-anchored rendered PDF review", () => {
  it("accepts only an independently allowed complete synthetic review and derives no original native text", async () => {
    const f = await fixture();
    const result = await validateRenderedPdfReview(f.input);
    expect(result.reviewSha256).toBe(renderedPdfReviewDigest(f.review));
    expect(result.reviewedTables).toHaveLength(1);
    expect(result.reviewedDiagrams).toHaveLength(1);
    expect(result.fullPageRenders[0]!.sha256).toBe(f.inspection.renderPages[0]!.artifact.sha256);
    expect(result.extracted.pages[0]!.text).toContain("Alpha -> Beta: Next");
    expect(result.extracted.pages[0]!.text).not.toContain("ORIGINAL NATIVE");
    expect(result.review.originalNativeConflict).toBe("unresolved");
    expect(result.review).not.toHaveProperty("hiddenText");
    expect(f.inspection.status).toBe("held_for_review");
    expect(Object.isFrozen(result.review)).toBe(true);
  });
  it("accepts explicitly absent features and a reviewed manual rendering transcription", async () => {
    const f = await fixture();
    const page = f.review.pages[0]!;
    page.tables = { status: "absent" };
    page.diagrams = { status: "absent" };
    page.text = [
      { origin: "manual_render_transcription", region: [0, 0, 100, 100], text: "Manually reviewed synthetic pixels" },
    ];
    f.approve();
    const result = await validateRenderedPdfReview(f.input);
    expect(result.extracted.pages[0]!.text).toBe("Manually reviewed synthetic pixels");
  });
  it("rejects a missing review, missing coverage, unresolved holds and native-text origin even if the caller would allow its raw digest", async () => {
    for (const change of [
      (r: Record<string, unknown>) => {
        delete r.pages;
      },
      (r: Record<string, unknown>) => {
        delete (r.pages as Array<Record<string, unknown>>)[0]!.tables;
      },
      (r: Record<string, unknown>) => {
        (r.pages as Array<Record<string, unknown>>)[0]!.unresolvedHolds = ["table_relationships_unverified"];
      },
      (r: Record<string, unknown>) => {
        ((r.pages as Array<Record<string, unknown>>)[0]!.text as Array<Record<string, unknown>>)[0]!.origin =
          "original_native";
      },
    ]) {
      const f = await fixture();
      const bad = structuredClone(f.review) as unknown as Record<string, unknown>;
      change(bad);
      await expect(
        validateRenderedPdfReview({
          ...f.input,
          review: bad,
          approvedReviewSha256: new Set([generationEvidenceDigest(bad)]),
        }),
      ).rejects.toThrow("record_invalid");
    }
    const f = await fixture();
    await expect(validateRenderedPdfReview({ ...f.input, review: null })).rejects.toThrow("record_invalid");
  });
  it("rejects unapproved review digests and post-approval edits", async () => {
    const f = await fixture();
    await expect(validateRenderedPdfReview({ ...f.input, approvedReviewSha256: new Set() })).rejects.toThrow(
      "not_approved",
    );
    f.review.reviewer.referenceSha256 = hash("different reference");
    await expect(validateRenderedPdfReview(f.input)).rejects.toThrow("not_approved");
  });
  it("rejects wrong source bytes and a changed original file", async () => {
    const f = await fixture();
    await expect(validateRenderedPdfReview({ ...f.input, originalBytes: Buffer.from("%PDF-wrong") })).rejects.toThrow(
      "source_binding_mismatch",
    );
    await writeFile(f.input.sourcePath, Buffer.alloc(f.input.originalBytes.length, 65));
    await expect(validateRenderedPdfReview(f.input)).rejects.toThrow("artifact_changed");
  });
  it.each(["pixels", "container"])("rechecks %s artifact bytes rather than trusting a cloned wrapper", async (kind) => {
    const f = await fixture();
    const target = kind === "pixels" ? f.inspection.renderPages[0]!.artifact : f.inspection.rasterContainer;
    await writeFile(target.path, Buffer.alloc(target.byteLength, 65));
    await expect(validateRenderedPdfReview({ ...f.input, inspection: structuredClone(f.inspection) })).rejects.toThrow(
      "artifact_changed",
    );
  });
  it("rejects OCR text mutation and reviewed spans that do not map to exact OCR", async () => {
    const f = await fixture();
    f.inspection.extraction.pages[0]!.text = "OTHER OCR TEXT";
    await expect(validateRenderedPdfReview(f.input)).rejects.toThrow("page_binding_mismatch");
    const g = await fixture();
    g.review.pages[0]!.text[0]!.text = "fabricated text";
    g.approve();
    await expect(validateRenderedPdfReview(g.input)).rejects.toThrow("ocr_mapping_invalid");
  });
  it("rehashes runtime scripts even when a cloned wrapper and allowed review agree on a false script identity", async () => {
    const f = await fixture();
    f.review.runtime.rendererScriptSha256 = hash("SYNTHETIC WRONG SCRIPT");
    f.inspection.runtime.rendererScriptSha256 = f.review.runtime.rendererScriptSha256;
    f.approve();
    await expect(validateRenderedPdfReview(f.input)).rejects.toThrow("artifact_changed");
  });
  it("rejects missing pages, invalid row/column relationships, dangling diagram edges and off-page mappings", async () => {
    const mutations = [
      (r: RenderedPdfReview) => {
        r.pageCount = 2;
      },
      (r: RenderedPdfReview) => {
        if (r.pages[0]!.tables.status === "reviewed_complete")
          r.pages[0]!.tables.records[0]!.rows[0]!.cells[1]!.columnIndex = 9;
      },
      (r: RenderedPdfReview) => {
        if (r.pages[0]!.diagrams.status === "reviewed_complete")
          r.pages[0]!.diagrams.records[0]!.edges[0]!.toNodeId = "missing";
      },
      (r: RenderedPdfReview) => {
        r.pages[0]!.text[0]!.region = [0, 0, 101, 100];
      },
    ];
    for (const mutate of mutations) {
      const f = await fixture();
      mutate(f.review);
      f.approve();
      await expect(validateRenderedPdfReview(f.input)).rejects.toThrow(
        /page_coverage_invalid|table_relationships_invalid|diagram_relationships_invalid|region_mapping_invalid/,
      );
    }
  });
  it("rejects original native material mixed into the supplied wrapper and unresolved runtime holds", async () => {
    const f = await fixture();
    Object.assign(f.inspection.extraction.pages[0]!.metadata, { originalNativeText: "excluded synthetic native" });
    await expect(validateRenderedPdfReview(f.input)).rejects.toThrow("native_layer_mixed");
    const g = await fixture();
    g.inspection.extraction.pages[0]!.metadata.source_provenance.reasonCodes.push("pdf_runtime_identity_unknown");
    await expect(validateRenderedPdfReview(g.input)).rejects.toThrow("unresolved_runtime_hold");
  });
});
