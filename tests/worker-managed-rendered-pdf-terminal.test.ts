import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bytesDigest as sha,
  generationEvidenceBytes,
  generationEvidenceDigest,
} from "../src/lib/ingestion-generation-evidence";

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
  if (review.pages[0]!.tables.status === "reviewed_complete") {
    review.pages[0]!.tables.records[0]!.rows.push({
      rowIndex: 1,
      cells: [
        { columnIndex: 0, content: span(0, 5) },
        { columnIndex: 1, content: span(11, 15) },
      ],
    });
  }
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

import { buildGenerationRetentionPacket } from "../worker/generation-evidence";
import {
  buildInternalRenderedPdfExpectation,
  captureManagedRenderedPdfArtifacts,
  prepareManagedRenderedPdfGeneration,
} from "../worker/managed-rendered-pdf-terminal";
import type { JobRow } from "../worker/types";
import type { ContentSha256, ProviderEgressBinding } from "../src/lib/document-ingress-safety";
const ids = Array.from({ length: 6 }, (_, i) => `72000000-0000-4000-8000-00000000000${i + 1}`);
async function planFixture(reviewedAt?: string) {
  const f = await fixture();
  if (reviewedAt) {
    f.review.reviewer.reviewedAt = reviewedAt;
    f.approve();
  }
  const acceptedReview = await validateRenderedPdfReview(f.input);
  const evidence = await captureManagedRenderedPdfArtifacts(acceptedReview);
  const issued = {
    documentId: ids[0]!,
    generationId: ids[1]!,
    jobId: ids[2]!,
    workerId: "rendered-test",
    firstLeaseToken: ids[3]!,
    attemptNumber: 1,
    batchId: null,
    authorityDigest: f.inspection.sourceSha256,
    predecessorGenerationId: null,
  };
  const binding: ProviderEgressBinding = {
    documentId: issued.documentId,
    generationId: issued.generationId,
    jobId: issued.jobId,
    leaseId: issued.firstLeaseToken,
    admissionEventId: ids[4]!,
    attemptId: `${issued.jobId}:1:${issued.firstLeaseToken}`,
    contentSha256: f.inspection.sourceSha256 as ContentSha256,
    authorityDigest: issued.authorityDigest as ContentSha256,
  };
  const job = {
    id: issued.jobId,
    document_id: issued.documentId,
    batch_id: null,
    locked_by: issued.workerId,
    lease_token: issued.firstLeaseToken,
    lease_expected_generation_id: null,
    lease_write_generation_id: issued.generationId,
    lease_authority_digest: issued.authorityDigest,
    lease_expires_at: new Date(Date.now() + 60000).toISOString(),
    lease_duration_seconds: 60,
    attempt_count: 1,
    max_attempts: 1,
    documents: {
      id: issued.documentId,
      owner_id: null,
      title: "Synthetic reviewed reference",
      file_name: "synthetic.pdf",
      file_type: "application/pdf",
      storage_path: "legacy/synthetic.pdf",
      file_size: f.input.originalBytes.length,
      content_hash: f.inspection.sourceSha256.slice(7),
      metadata: { public_corpus: true, admission_event_id: ids[4] },
    },
  } as JobRow;
  const expectation = buildInternalRenderedPdfExpectation(acceptedReview);
  const retentionPacket = buildGenerationRetentionPacket({
    documentId: issued.documentId,
    generationId: issued.generationId,
    originalBytes: f.input.originalBytes,
    ...expectation,
    ...evidence,
    renderedReview: acceptedReview,
    renderedRasterBytes: await readFile(f.inspection.rasterContainer.path),
    persistedPages: evidence.extracted.pages.map((p) => ({
      document_id: issued.documentId,
      page_number: p.pageNumber,
      text: p.text,
      ocr_used: true,
      metadata: p.metadata ?? {},
    })),
    deferOptionalProducerDeclarations: true,
  });
  const input = {
    job,
    issued,
    binding,
    originalBytes: f.input.originalBytes,
    acceptedReview,
    capturedImages: evidence.capturedImages,
    retentionPacket,
    stewardId: ids[5]!,
  };
  return { ...f, ...evidence, expectation, input, plan: await prepareManagedRenderedPdfGeneration(input) };
}
describe("managed reviewed rendered PDF", () => {
  it.each([1500, 400])(
    "uses a conservative observation timestamp without preceding review (%s ms old)",
    async (reviewAgeMs) => {
      const now = Date.now();
      const clock = vi.spyOn(Date, "now").mockReturnValue(now);
      try {
        const reviewedAt = now - reviewAgeMs;
        const f = await planFixture(new Date(reviewedAt).toISOString());
        const inspectedAt = Date.parse(f.plan.packet.inspection.inspectedAt);
        const expiresAt = Date.parse(f.plan.packet.inspection.expiresAt);
        expect(inspectedAt).toBe(Math.max(now - 1000, reviewedAt));
        expect(inspectedAt).toBeGreaterThanOrEqual(reviewedAt);
        expect(inspectedAt).toBeLessThanOrEqual(now);
        expect(expiresAt - inspectedAt).toBe(24 * 60 * 60 * 1000);
        expect(expiresAt).toBeLessThanOrEqual(now + 24 * 60 * 60 * 1000);
      } finally {
        clock.mockRestore();
      }
    },
  );
  it("retains full page pixels, typed table rows, diagram relationships and every existing derivative family", async () => {
    const f = await planFixture();
    expect(f.plan.packet.version).toBe("managed-rendered-pdf-packet-v1");
    expect(f.plan.packet.profileId).toBe("administrator-reviewed-rendered-full-pdf-v1");
    expect(f.plan.packet.inspection.originalNativeConflict).toBe("unresolved");
    expect(f.plan.packet.inspection).not.toHaveProperty("hiddenText");
    expect(f.plan.packet.inspection.pages[0]!.text).toBe(f.extracted.pages[0]!.text);
    expect(f.plan.packet.inspection.pages[0]!.text).toContain("Alpha -> Beta: Next");
    expect(f.plan.packet.inspection.pages[0]!.text).not.toContain("ORIGINAL NATIVE");
    expect(f.plan.packet.rows.images).toHaveLength(2);
    expect(f.plan.packet.rows.images[1]!.image_hash).toBe(f.plan.packet.rows.images[0]!.image_hash);
    expect(f.plan.packet.inspection.tables[0]!.rows).toEqual([
      ["Alpha", "Beta"],
      ["Alpha", "Next"],
    ]);
    expect(f.plan.packet.rows.table_facts.length).toBeGreaterThan(0);
    expect(f.plan.packet.rows.index_units.length).toBeGreaterThan(0);
    expect(f.plan.packet.rows.embedding_fields.length).toBeGreaterThan(0);
    expect(f.plan.packet.rows.sections.length).toBeGreaterThan(0);
    expect(f.plan.packet.rows.memory_cards.length).toBeGreaterThan(0);
    expect(f.plan.packet.rows.chunks[0]!.metadata).toMatchObject({
      rendered_pdf_review: { originalNativeConflict: "unresolved" },
    });
    expect(f.plan.packet.inspection.reviewSha256).toBe(renderedPdfReviewDigest(f.review));
    expect(f.plan.planDigest).toBe(generationEvidenceDigest(f.plan.packet));
    expect(Object.isFrozen(f.plan.packet)).toBe(true);
  });
  it("binds source units to actual render, OCR, exact approved review and typed relationships", async () => {
    const f = await planFixture();
    const units = f.expectation.sourceExpectation.units!;
    expect(units).toHaveLength(3);
    expect(units[0]!.locator).toContain(
      `:render:${f.review.pages[0]!.render.sha256}:ocr:${f.review.pages[0]!.ocrTextSha256}:review:${renderedPdfReviewDigest(f.review)}`,
    );
    expect(units[1]!.dependencies).toEqual(["source-page-1"]);
    expect(units[2]!.locator).toContain(":diagram:d1:");
    expect(JSON.stringify(units)).not.toContain("original-native");
    expect(f.plan.packet.inspection.pages[0]!.sourceProvenanceSha256).toBe(
      generationEvidenceDigest(f.extracted.pages[0]!.metadata),
    );
  });
  it("refuses cloned review capabilities, cross-attempt identities, source drift and capture drift", async () => {
    const f = await planFixture();
    await expect(
      prepareManagedRenderedPdfGeneration({ ...f.input, acceptedReview: structuredClone(f.input.acceptedReview) }),
    ).rejects.toThrow("rendered_pdf_review_validated_result_required");
    await expect(
      prepareManagedRenderedPdfGeneration({ ...f.input, binding: { ...f.input.binding, attemptId: "wrong" } }),
    ).rejects.toThrow("identity_or_inventory_mismatch");
    await expect(
      prepareManagedRenderedPdfGeneration({ ...f.input, originalBytes: Buffer.from("%PDF-changed") }),
    ).rejects.toThrow("identity_or_inventory_mismatch");
    const captures = f.input.capturedImages.map((capture) => ({ ...capture }));
    captures[0] = { ...captures[0]!, bytesHex: "00" };
    await expect(prepareManagedRenderedPdfGeneration({ ...f.input, capturedImages: captures })).rejects.toThrow(
      "captured_image_fidelity_mismatch",
    );
  });
  it("rechecks retained pixel files after review before constructing rows", async () => {
    const f = await planFixture();
    await writeFile(f.inspection.renderPages[0]!.artifact.path, "CHANGED PIXELS!!!");
    await expect(prepareManagedRenderedPdfGeneration(f.input)).rejects.toThrow();
  });
});

import { IngestionAttempt } from "../supabase/functions/_shared/ingestion-attempt";
import { runManagedFullPdfGeneration } from "../worker/managed-full-pdf-terminal";
describe("rendered packet shared executor", () => {
  it.each([false, true])(
    "requires rendered-specific terminal seal (native substitute %s)",
    async (nativeSubstitute) => {
      const f = await planFixture();
      const attempt = new IngestionAttempt({
        job_kind: "node",
        job_id: f.input.issued.jobId,
        document_id: f.input.issued.documentId,
        worker_id: f.input.issued.workerId,
        lease_token: f.input.issued.firstLeaseToken,
        expected_generation_id: null,
        authority_digest: f.input.issued.authorityDigest,
      });
      let packetDigest = "";
      const mutation = vi.fn(async (_name: string, payload: Record<string, unknown>) => {
        const bytes = generationEvidenceBytes(payload.p_packet);
        packetDigest = sha(bytes);
        return {
          ok: true,
          packetDigest,
          packet: { bytesHex: bytes.toString("hex"), sha256: packetDigest, byteLength: bytes.length },
        };
      });
      const embed = vi.fn(async (texts: string[]) =>
        texts.map(() => Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0))),
      );
      const rpc = vi.fn(async (_name: string, payload: Record<string, unknown>) => {
        const bytes = generationEvidenceBytes({
          version: nativeSubstitute ? "managed-full-pdf-seal-v1" : "managed-rendered-pdf-seal-v1",
          packetDigest,
          identity: f.plan.packet.identity,
          profileId: f.plan.packet.profileId,
          inspectionScope: f.plan.packet.inspection.verificationScope,
          reviewSha256: f.plan.packet.inspection.reviewSha256,
          reviewer: f.plan.packet.inspection.reviewRecord.reviewer,
          sourceSha256: f.plan.packet.identity.sourceSha256,
          sourceByteLength: f.plan.packet.identity.sourceByteLength,
          nativeLayerDisposition: "excluded_from_admitted_evidence",
          originalNativeConflict: "unresolved",
          publicationApproval: "not_granted",
          clinicalApproval: "not_granted",
        });
        return {
          data: {
            ok: true,
            managedFullPdfTerminal: {
              activated: true,
              replay: payload.p_read_only ? "already_completed" : "completed",
              seal: { bytesHex: bytes.toString("hex"), sha256: sha(bytes), byteLength: bytes.length },
            },
          },
          error: null,
        };
      });
      const result = runManagedFullPdfGeneration({
        plan: f.plan,
        attempt,
        embed,
        mutation,
        rpc,
        stopHeartbeat: vi.fn(),
      });
      if (nativeSubstitute) await expect(result).rejects.toThrow("terminal_readback_mismatch");
      else {
        await result;
        expect(rpc.mock.calls.map((c) => c[1].p_read_only)).toEqual([false, true]);
      }
      expect(embed.mock.calls.flatMap((call) => call[0])).toEqual(f.plan.embeddingUnits.map((u) => u.text));
    },
  );
});
