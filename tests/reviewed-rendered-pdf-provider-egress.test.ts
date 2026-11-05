import { EventEmitter } from "node:events";
import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bytesDigest as sha, generationEvidenceDigest } from "../src/lib/ingestion-generation-evidence";

const processBoundary = vi.hoisted(() => ({
  spawn: vi.fn(),
  terminate: vi.fn(),
  extract: vi.fn(() => {
    throw new Error("legacy_extractor_must_not_run");
  }),
}));
vi.mock("node:child_process", () => ({ spawn: processBoundary.spawn }));
vi.mock("../src/lib/extractors/document", () => ({
  terminateProcessTree: processBoundary.terminate,
  extractDocument: processBoundary.extract,
}));
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

async function reviewedFixture() {
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

import {
  createReviewedRenderedPdfInspectionLoader,
  type ReviewedRenderedPdfInspectionCurrent,
} from "../worker/reviewed-rendered-pdf-provider-egress";
import { IngestionAttempt } from "../supabase/functions/_shared/ingestion-attempt";
import {
  INTERNAL_BUILD_LEGAL_REVIEW_DEFERRAL,
  type ContentSha256,
  type ProviderEgressBinding,
} from "../src/lib/document-ingress-safety";
import type { RichAdminUnscannedEvidence } from "../supabase/functions/_shared/rich-admin-unscanned-exception";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
async function egressFixture(family: "chunks" | "memory_cards" | "images" = "chunks", key = uuid(8)) {
  const f = await reviewedFixture();
  const digest = hash(f.input.originalBytes) as ContentSha256;
  const binding: ProviderEgressBinding = {
    admissionEventId: uuid(1),
    documentId: uuid(2),
    generationId: uuid(3),
    jobId: uuid(4),
    leaseId: uuid(5),
    attemptId: `${uuid(4)}:1:${uuid(5)}`,
    contentSha256: digest,
    authorityDigest: digest,
  };
  const attempt = new IngestionAttempt({
    job_kind: "node",
    job_id: binding.jobId,
    document_id: binding.documentId,
    worker_id: "synthetic",
    lease_token: binding.leaseId,
    expected_generation_id: null,
    authority_digest: digest,
  });
  const acceptedReview = await validateRenderedPdfReview(f.input);
  const source: ReviewedRenderedPdfInspectionCurrent = {
    binding,
    sourceBytes: f.input.originalBytes,
    sourceMetadata: { public_corpus: true },
    capturedImages: [],
    acceptedReview,
    identifierTexts: ["Synthetic title", "source.pdf"],
    facts: {
      version: "administrator-reindex-authority-facts-v1",
      scope: "existing_shared_library_stewardship",
      documentId: binding.documentId,
      documentOwnerId: null,
      stewardId: uuid(6),
      jobId: binding.jobId,
      generationId: binding.generationId,
      authorityDigest: digest,
      sourceSha256: digest,
      sourceByteLength: f.input.originalBytes.length,
      mimeType: "application/pdf",
      fileNameSha256: digest,
      storagePathSha256: digest,
      admissionEventId: binding.admissionEventId,
      admissionDigest: digest,
      admissionPolicyVersion: "trusted-document-admission-v1",
      currentRightsEvidence: "unavailable",
      historicalUploadOrigin: "not_established",
      declaredAuthority: {
        version: 1,
        sourceRole: "service_policy",
        authorityBasis: "administrator_template",
        licencePolicy: "review_required",
        rightsEvidenceRef: "synthetic internal deferral",
        publisher: "WA Health",
        jurisdiction: "Australia/WA",
        publicationDate: null,
        effectiveDate: null,
        reviewDate: null,
        expiryDate: null,
        currentness: "unknown",
        supersedesDocumentId: null,
        purpose: "clinical_retrieval",
        supportedFeatures: ["text"],
        providerProcessing: "permitted",
      },
    },
    policyObservations: {
      policyVersion: "synthetic-render-review-v1",
      rights: "review_deferred",
      indexLicence: "review_deferred",
      legalReviewDeferral: INTERNAL_BUILD_LEGAL_REVIEW_DEFERRAL,
      purposeClearance: "permitted",
    },
  };
  const evidence: RichAdminUnscannedEvidence = {
    version: "administrator-rich-source-unscanned-v2",
    grant: {
      exceptionId: uuid(7),
      approvalReferenceSha256: digest,
      status: "active",
      issuedAt: new Date(Date.now() - 1000).toISOString(),
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      allowedPurposes: ["embedding", "summary"],
    },
    provenance: {
      documentOwnerId: null,
      stewardId: uuid(6),
      administratorId: uuid(6),
      administratorActive: true,
      scope: "existing_shared_library_stewardship",
      existingSharedPublic: true,
      admissionDigest: digest,
      binding,
    },
  };
  const text = acceptedReview.extracted.pages[0]!.text;
  const request = {
    purpose: "embedding" as const,
    payload: JSON.stringify({ model: "text-embedding-3-small", dimensions: 1536, input: [text] }),
    payloadSha256: "" as ContentSha256,
  };
  request.payloadSha256 = hash(request.payload) as ContentSha256;
  const loadCurrent = vi.fn(async () => {
    source.acceptedReview = await validateRenderedPdfReview(f.input);
    return source;
  });
  const loadScannerConfiguration = vi.fn(async () => ({
    backend: "administrator_rich_unscanned_exception" as const,
    evidence,
  }));
  const options = {
    attempt,
    binding,
    nativePdfBatch: {
      planDigest: digest,
      inputs: [{ providerInputText: text, sourceUnitIds: [{ family, key }] }],
    },
    loadCurrent,
    loadScannerConfiguration,
  };
  const loader = createReviewedRenderedPdfInspectionLoader(options);
  return { ...f, source, evidence, binding, attempt, request, loadCurrent, loadScannerConfiguration, loader, options };
}
describe("reviewed render representation provider boundary", () => {
  it("admits bound memory-card embeddings without admitting changed source text", async () => {
    const f = await egressFixture("memory_cards");
    await expect(f.loader(f.request, f.binding)).resolves.toHaveProperty("observations");
    const payload = JSON.stringify({ model: "text-embedding-3-small", dimensions: 1536, input: ["Unbound narrative"] });
    await expect(
      f.loader({ ...f.request, payload, payloadSha256: hash(payload) as ContentSha256 }, f.binding),
    ).rejects.toThrow("embedding_source_plan");
  });
  it.each([
    ["images", uuid(8)],
    ["memory_cards", "invalid-key"],
  ] as const)("refuses unsupported embedding family or malformed source key (%s)", async (family, key) => {
    const f = await egressFixture(family, key);
    await expect(f.loader(f.request, f.binding)).rejects.toThrow("embedding_source_plan");
    expect(f.loadScannerConfiguration).not.toHaveBeenCalled();
  });
  it("admits reviewed representation only while preserving original native conflict", async () => {
    const f = await egressFixture();
    const observed = await f.loader(f.request, f.binding);
    expect(observed.sourceObservations.hiddenText).toBe("not_applicable");
    expect(f.source.acceptedReview.review.originalNativeConflict).toBe("unresolved");
    expect(f.source.acceptedReview.review.nativeLayerDisposition).toBe("excluded_from_admitted_evidence");
    expect(f.loadCurrent).toHaveBeenCalledTimes(2);
  });
  it("refuses a JSON copy instead of an actual validated review", async () => {
    const f = await egressFixture();
    f.loadCurrent.mockImplementation(async () => ({
      ...f.source,
      acceptedReview: structuredClone(f.source.acceptedReview),
    }));
    await expect(f.loader(f.request, f.binding)).rejects.toThrow("validated_result_required");
  });
  it("rechecks mounted review approval, artifact and original identity at dispatch", async () => {
    for (const changed of ["approval", "artifact", "original"] as const) {
      const f = await egressFixture();
      if (changed === "approval") f.input.approvedReviewSha256.clear();
      if (changed === "artifact") await writeFile(f.inspection.renderPages[0]!.artifact.path, "MUTATED PIXELS!!");
      if (changed === "original") f.input.originalBytes[10] ^= 1;
      await expect(f.loader(f.request, f.binding)).rejects.toThrow(/rendered_pdf_review_/);
      expect(f.loadScannerConfiguration).not.toHaveBeenCalled();
    }
  });
  it("refuses stale authority and identifiers in full source fields", async () => {
    const f = await egressFixture();
    f.source.facts.declaredAuthority.expiryDate = "2020-01-01";
    await expect(f.loader(f.request, f.binding)).rejects.toThrow("authority_not_current");
    f.source.facts.declaredAuthority.expiryDate = null;
    f.source.identifierTexts = ["Contact individual@example.org"];
    await expect(f.loader(f.request, f.binding)).rejects.toThrow();
  });
  it("refuses wrong purpose, wrong body, and lost lease", async () => {
    const f = await egressFixture();
    await expect(f.loader({ ...f.request, purpose: "caption" }, f.binding)).rejects.toThrow("purpose");
    const payload = JSON.stringify({
      model: "text-embedding-3-small",
      dimensions: 1536,
      input: ["Injected original native text"],
    });
    await expect(
      f.loader({ ...f.request, payload, payloadSha256: hash(payload) as ContentSha256 }, f.binding),
    ).rejects.toThrow("embedding_source_plan");
    f.attempt.cancel();
    await expect(f.loader(f.request, f.binding)).rejects.toThrow();
  });
  it("requires the exact independently derived summary and scans its source fields", async () => {
    const f = await egressFixture(),
      payload = "synthetic trusted summary body";
    const loader = createReviewedRenderedPdfInspectionLoader({
      ...f.options,
      expectedPayloadForPurpose: async () => ({
        payload,
        identifierTexts: ["Synthetic title", f.source.acceptedReview.extracted.pages[0]!.text],
      }),
    });
    const request = { purpose: "summary" as const, payload, payloadSha256: hash(payload) as ContentSha256 };
    await expect(loader(request, f.binding)).resolves.toHaveProperty("observations.purpose", "summary");
    const tampered = payload + " injected";
    await expect(
      loader({ ...request, payload: tampered, payloadSha256: hash(tampered) as ContentSha256 }, f.binding),
    ).rejects.toThrow("purpose_source_body_unavailable");
  });
});

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSourceRuntimeOptions } from "../worker/admin-source-runtime";
import { createInternalRichPdfBuildSuppliers } from "../worker/internal-rich-pdf-suppliers";
import { workerProviderSourceBinding } from "../worker/provider-egress";
import type { RichPdfInspectionResult } from "../worker/rich-pdf-inspection";
import type { JobRow } from "../worker/types";
import * as renderedProducer from "../worker/rendered-pdf-inspection-producer";
const id = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function supplierFixture(bytes: Buffer) {
  const sha = hash(bytes);
  const authority = {
    version: 1 as const,
    sourceRole: "clinical_reference" as const,
    authorityBasis: "administrator_template" as const,
    licencePolicy: "review_required" as const,
    rightsEvidenceRef: "synthetic-deferred-review",
    publisher: "Synthetic publisher",
    jurisdiction: "Australia/WA" as const,
    publicationDate: null,
    effectiveDate: null,
    reviewDate: null,
    expiryDate: null,
    currentness: "unknown" as const,
    supersedesDocumentId: null,
    purpose: "clinical_retrieval" as const,
    supportedFeatures: ["text" as const],
    providerProcessing: "permitted" as const,
  };
  const document = {
    id: id(1),
    owner_id: null as string | null,
    title: "Synthetic",
    file_name: "source.pdf",
    file_type: "application/pdf",
    storage_path: "legacy/source.pdf",
    content_hash: sha.slice(7),
    file_size: bytes.length,
    metadata: {
      public_corpus: true,
      authority,
      admission_event_id: id(6),
      admission_policy_version: "trusted-document-admission-v1",
      reindex_readmission: {
        version: "administrator-current-reindex-readmission-v1",
        scope: "existing_shared_library_stewardship",
        administratorId: id(5),
        documentOwnerId: null,
        sourceSha256: sha,
        origin: "historical_upload_origin_not_established",
      },
    } as Record<string, unknown>,
  };
  const job: JobRow = {
    id: id(2),
    document_id: id(1),
    locked_by: "synthetic-worker",
    lease_token: id(3),
    lease_expected_generation_id: null,
    lease_write_generation_id: id(4),
    lease_authority_digest: sha,
    lease_expires_at: new Date(Date.now() + 60000).toISOString(),
    lease_duration_seconds: 60,
    batch_id: null,
    attempt_count: 1,
    max_attempts: 1,
    documents: structuredClone(document),
  };
  const event = {
    id: id(6),
    document_id: id(1),
    ingestion_job_id: id(2),
    staging_owner_id: id(5),
    source_channel: "admin_api",
    actor_kind: "administrator",
    administrator_id: id(5),
    backend_principal: null,
    admission_policy_version: "trusted-document-admission-v1",
    content_sha256: sha,
    file_name_sha256: hash(Buffer.from(document.file_name)),
    storage_path_sha256: hash(Buffer.from(document.storage_path)),
    mime_type: "application/pdf",
    byte_count: bytes.length,
    admission_digest: sha,
    authority,
  };
  const user = { id: id(5), app_metadata: { site_role: "administrator" }, banned_until: null as string | null };
  const download = vi.fn(async () => ({ data: new Blob([new Uint8Array(bytes)]), error: null }));
  const getBucket = vi.fn(async () => ({ data: { public: false }, error: null }));
  const getUserById = vi.fn(async () => ({ data: { user: structuredClone(user) }, error: null }));
  const from = vi.fn((table: string) => {
    const q = {
      select: () => q,
      eq: () => q,
      single: async () => ({ data: structuredClone(table === "documents" ? document : event), error: null }),
    };
    return q;
  });
  const client = {
    from,
    auth: { admin: { getUserById } },
    storage: { from: () => ({ download }), getBucket },
  } as unknown as SupabaseClient;
  const inspectRichPdf = vi.fn(async (): Promise<RichPdfInspectionResult> => {
    throw new Error("native_inspection_must_not_run");
  });
  const options = {
    bucket: "private-originals",
    allowedDocumentIds: [id(1)],
    approvalReferenceSha256: sha,
    issuedAt: new Date(Date.now() - 1000).toISOString(),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    inspectRichPdf,
  };
  return { client, options, job, document, event, user, inspectRichPdf, from, download, getBucket, getUserById };
}

describe("server-only reviewed profile selection", () => {
  it("selects only the separately enabled reviewed profile and rereads the mounted record", async () => {
    const f = await reviewedFixture(),
      supplier = supplierFixture(f.input.originalBytes);
    const reviewFilePath = path.join(path.dirname(f.input.sourcePath), "mounted-review.json");
    await writeFile(reviewFilePath, JSON.stringify(f.review));
    const rotated = {
      ...f.review,
      reviewer: { ...f.review.reviewer, referenceSha256: hash("SECOND APPROVED SYNTHETIC REVIEW") },
    };
    const spy = vi.spyOn(renderedProducer, "inspectRenderedPdfOriginal").mockResolvedValue(f.inspection);
    try {
      const runtime = createInternalRichPdfBuildSuppliers(supplier.client, {
        ...supplier.options,
        enableSourceAnchoredSummary: true,
        renderedReview: {
          enabled: true,
          reviewFilePath,
          approvedReviewSha256: [renderedPdfReviewDigest(f.review), renderedPdfReviewDigest(rotated)],
        },
      });
      const selected = await runtime.loadApprovedSource(supplier.job, "embedding");
      expect(selected?.sourceFamily).toBe("reviewed_rendered_pdf");
      expect(selected?.richPdf).toBeUndefined();
      expect(selected?.renderedPdf?.acceptedReview.review.originalNativeConflict).toBe("unresolved");
      expect(selected?.renderedPdf?.renderedRasterBytes.length).toBe(f.inspection.rasterContainer.byteLength);
      expect(supplier.inspectRichPdf).not.toHaveBeenCalled();
      const runtimeOptions = createAdminSourceRuntimeOptions(supplier.client, runtime, supplier.options.bucket);
      const binding = workerProviderSourceBinding(supplier.job, supplier.job.documents);
      const attempt = new IngestionAttempt({
        job_kind: "node",
        job_id: supplier.job.id,
        document_id: supplier.job.document_id,
        worker_id: supplier.job.locked_by,
        lease_token: supplier.job.lease_token,
        expected_generation_id: supplier.job.lease_expected_generation_id,
        authority_digest: supplier.job.lease_authority_digest,
      });
      const rendered = await runtimeOptions.loadManagedRenderedPdfInspection!(
        supplier.job,
        binding.contentSha256,
        attempt,
      );
      expect(rendered?.acceptedReview.reviewSha256).toBe(renderedPdfReviewDigest(f.review));
      expect(rendered?.summaryEnabled).toBe(true);
      await expect(
        runtimeOptions.loadManagedRichPdfInspection!(supplier.job, binding.contentSha256, attempt),
      ).resolves.toBeUndefined();
      await writeFile(reviewFilePath, JSON.stringify(rotated));
      await expect(runtime.loadApprovedSource(supplier.job, "embedding")).rejects.toThrow("rendered_review_changed");
      await writeFile(reviewFilePath, JSON.stringify({ ...f.review, pageCoverage: "unreviewed" }));
      await expect(runtime.loadApprovedSource(supplier.job, "embedding")).rejects.toThrow("record_invalid");
      expect(spy).toHaveBeenCalledTimes(1);
      supplier.user.app_metadata.site_role = "member";
      await expect(runtime.loadApprovedSource(supplier.job, "embedding")).rejects.toThrow("administrator_unavailable");
    } finally {
      spy.mockRestore();
    }
  });
  it("refuses held, unapproved and summary-disabled configuration without native fallback", async () => {
    const f = await reviewedFixture(),
      supplier = supplierFixture(f.input.originalBytes);
    const reviewFilePath = path.join(path.dirname(f.input.sourcePath), "mounted-review.json");
    await writeFile(reviewFilePath, JSON.stringify(f.review));
    const policy = { enabled: true as const, reviewFilePath, approvedReviewSha256: [hash("UNAPPROVED")] };
    expect(() =>
      createInternalRichPdfBuildSuppliers(supplier.client, { ...supplier.options, renderedReview: policy }),
    ).toThrow("rendered_summary_required");
    const spy = vi.spyOn(renderedProducer, "inspectRenderedPdfOriginal").mockResolvedValue(f.inspection);
    try {
      const runtime = createInternalRichPdfBuildSuppliers(supplier.client, {
        ...supplier.options,
        enableSourceAnchoredSummary: true,
        renderedReview: policy,
      });
      await expect(runtime.loadApprovedSource(supplier.job, "embedding")).rejects.toThrow("not_approved");
      expect(supplier.inspectRichPdf).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

import { initializeManagedAdminGeneration } from "../worker/job-attempt-setup";
import * as retentionEvidence from "../worker/generation-evidence";
import * as adminTextProducer from "../worker/managed-admin-text-terminal";
import type { IngestionStageContext } from "../worker/ingestion-stage-context";

describe("reviewed-rendered managed initialization", () => {
  it("adopts the prepared PDF, captures and reviewed retention without native/text extraction", async () => {
    const f = await reviewedFixture(),
      supplier = supplierFixture(f.input.originalBytes);
    const reviewFilePath = path.join(path.dirname(f.input.sourcePath), "initialization-review.json");
    await writeFile(reviewFilePath, JSON.stringify(f.review));
    const wrapper = vi.spyOn(renderedProducer, "inspectRenderedPdfOriginal").mockResolvedValue(f.inspection);
    const retainPlan = vi.spyOn(retentionEvidence, "buildGenerationRetentionPacket");
    const adminText = vi.spyOn(adminTextProducer, "buildManagedAdminTextChunks");
    try {
      const suppliers = createInternalRichPdfBuildSuppliers(supplier.client, {
        ...supplier.options,
        enableSourceAnchoredSummary: true,
        renderedReview: { enabled: true, reviewFilePath, approvedReviewSha256: [renderedPdfReviewDigest(f.review)] },
      });
      const hooks = createAdminSourceRuntimeOptions(supplier.client, suppliers, supplier.options.bucket);
      const job = supplier.job;
      const attempt = new IngestionAttempt({
        job_kind: "node",
        job_id: job.id,
        document_id: job.document_id,
        worker_id: job.locked_by,
        lease_token: job.lease_token,
        expected_generation_id: job.lease_expected_generation_id,
        authority_digest: job.lease_authority_digest,
      });
      let registration: Record<string, unknown> | undefined;
      let retained: Array<Record<string, unknown>> = [];
      const mutation = vi.fn(async (_attempt: IngestionAttempt, name: string, args?: Record<string, unknown>) => {
        if (name === "begin_ingestion_generation_evidence")
          registration = args!.p_registration as Record<string, unknown>;
        if (name === "retain_ingestion_generation_artifacts")
          retained = args!.p_artifacts as Array<Record<string, unknown>>;
        if (name !== "read_ingestion_generation_inventory") return { ok: true };
        if (!registration) return { ok: true, managed: false, inventory: null };
        const plan = retainPlan.mock.results.at(-1)!.value as ReturnType<
          typeof retentionEvidence.buildGenerationRetentionPacket
        >;
        const witness = retained.find((artifact) => artifact.representation === "source_expectation_witness");
        return {
          ok: true,
          managed: true,
          inventory: {
            version: 1,
            documentId: job.document_id,
            generationId: job.lease_write_generation_id,
            jobId: job.id,
            authorityDigest: job.lease_authority_digest,
            predecessorGenerationId: job.lease_expected_generation_id,
            firstLeaseToken: job.lease_token,
            sourceSha256: f.inspection.sourceSha256,
            sourceByteLength: f.input.originalBytes.length,
            sourceExpectation: retainPlan.mock.calls.at(-1)![0].sourceExpectation,
            sourceExpectationDigest: plan.registration.sourceExpectationSha256,
            registration,
            artifacts: retained.map((retainedArtifact) => ({
              ...Object.fromEntries(Object.entries(retainedArtifact).filter(([key]) => key !== "bytesHex")),
              sourceSha256: f.inspection.sourceSha256,
            })),
            retainedOriginalWitness: witness
              ? {
                  status: "retained",
                  documentId: job.document_id,
                  generationId: job.lease_write_generation_id,
                  sourceSha256: f.inspection.sourceSha256,
                  sourceByteLength: f.input.originalBytes.length,
                  sourceExpectationDigest: plan.registration.sourceExpectationSha256,
                  unitId: witness.unitId,
                  representation: "source_expectation_witness",
                  bytesHex: witness.bytesHex,
                  sha256: witness.sha256,
                  byteLength: witness.byteLength,
                }
              : { status: "unavailable", reason: "witness_not_retained" },
          },
        };
      });
      const adopt = vi.fn();
      const prepared = await initializeManagedAdminGeneration(
        { mutation } as unknown as IngestionStageContext,
        hooks,
        job,
        attempt,
        adopt,
      );
      expect(prepared.pdf?.sourceSha256).toBe(f.inspection.sourceSha256);
      expect(prepared.pdf?.capturedImages).toHaveLength(2);
      expect(prepared.pdf?.extracted.pages[0]?.text).toContain("Alpha -> Beta: Next");
      expect(prepared.pdf?.extracted.pages[0]?.text).not.toContain("ORIGINAL NATIVE");
      expect(adopt).toHaveBeenCalledWith(prepared.pdf!.extracted);
      expect(processBoundary.extract).not.toHaveBeenCalled();
      expect(supplier.inspectRichPdf).not.toHaveBeenCalled();
      expect(adminText).not.toHaveBeenCalled();
      expect(retainPlan).toHaveBeenCalledTimes(1);
      const retentionInput = retainPlan.mock.calls[0]![0];
      expect(retentionInput.renderedReview?.reviewSha256).toBe(renderedPdfReviewDigest(f.review));
      expect(hash(retentionInput.renderedRasterBytes!)).toBe(f.inspection.rasterContainer.sha256);
      const plan = retainPlan.mock.results[0]!.value as ReturnType<
        typeof retentionEvidence.buildGenerationRetentionPacket
      >;
      expect(plan.artifacts.some((artifact) => artifact.unitId.key === "rendered-review-record")).toBe(true);
      expect((await lstat(f.inspection.renderPages[0]!.artifact.path)).isFile()).toBe(true);
      expect(prepared.pdf?.extracted.temporaryPaths).toEqual(f.inspection.temporaryPaths);
    } finally {
      wrapper.mockRestore();
      retainPlan.mockRestore();
      adminText.mockRestore();
    }
  });
});
