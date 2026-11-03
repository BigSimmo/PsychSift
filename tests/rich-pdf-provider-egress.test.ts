import { describe, expect, it, vi } from "vitest";
import { bytesDigest } from "../src/lib/ingestion-generation-evidence";
import {
  evaluateDocumentIngressSafety,
  INTERNAL_BUILD_LEGAL_REVIEW_DEFERRAL,
  type ContentSha256,
  type ProviderEgressBinding,
} from "../src/lib/document-ingress-safety";
import { IngestionAttempt } from "../supabase/functions/_shared/ingestion-attempt";
import {
  RICH_ADMIN_UNSCANNED_POLICY,
  type RichAdminUnscannedEvidence,
} from "../supabase/functions/_shared/rich-admin-unscanned-exception";
import { createRichPdfInspectionLoader, type RichPdfInspectionCurrent } from "../worker/rich-pdf-provider-egress";
import { RICH_PDF_INSPECTION_VERSION } from "../worker/rich-pdf-inspection";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function fixture() {
  const bytes = Buffer.from("%PDF-1.7\nSynthetic source\n%%EOF"),
    hash = bytesDigest(bytes) as ContentSha256,
    text = "Synthetic source threshold < 3.5.";
  const binding: ProviderEgressBinding = {
    admissionEventId: uuid(1),
    documentId: uuid(2),
    generationId: uuid(3),
    jobId: uuid(4),
    leaseId: uuid(5),
    attemptId: `${uuid(4)}:1:${uuid(5)}`,
    contentSha256: hash,
    authorityDigest: hash,
  };
  const attempt = new IngestionAttempt({
    job_kind: "node",
    job_id: binding.jobId,
    document_id: binding.documentId,
    worker_id: "synthetic",
    lease_token: binding.leaseId,
    expected_generation_id: null,
    authority_digest: hash,
  });
  const features = { nativeText: true, rasterImages: 0, vectorDrawings: 0, nativeTables: 0 };
  const source: RichPdfInspectionCurrent = {
    binding,
    sourceBytes: bytes,
    sourceMetadata: { public_corpus: true },
    capturedImages: [],
    facts: {
      version: "administrator-reindex-authority-facts-v1",
      scope: "existing_shared_library_stewardship",
      documentId: binding.documentId,
      documentOwnerId: null,
      stewardId: uuid(6),
      jobId: binding.jobId,
      generationId: binding.generationId,
      authorityDigest: hash,
      sourceSha256: hash,
      sourceByteLength: bytes.length,
      mimeType: "application/pdf",
      fileNameSha256: hash,
      storagePathSha256: hash,
      admissionEventId: binding.admissionEventId,
      admissionDigest: hash,
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
    review: {
      version: RICH_PDF_INSPECTION_VERSION,
      binding,
      sourceSha256: hash,
      sourceByteLength: bytes.length,
      pageCount: 1,
      pageInventory: "complete",
      pages: [
        {
          pageNumber: 1,
          text,
          textSha256: bytesDigest(Buffer.from(text)),
          nativeTextSha256: hash,
          ocrUsed: false,
          sourceProvenanceSha256: hash,
          originalFeatures: features,
          imageOrdinals: [],
          tableOrdinals: [],
        },
      ],
      images: [],
      tables: [],
      sourceInventory: [
        { pageNumber: 1, nativeTextSha256: hash, ...features, rasterBboxes: [], vectorBboxes: [], tableBboxes: [] },
      ],
      featureCoverage: {
        nativeText: "complete",
        nativeTables: "not_present",
        raster: "not_present",
        ocr: "not_present",
        figures: "not_present",
      },
      activeContent: "absent",
      encryption: "not_encrypted",
      hiddenText: "consistent",
      inspectedAt: new Date(Date.now() - 1000).toISOString(),
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      verificationScope: "structural_and_extracted_bytes_not_clinical_semantic_approval",
    },
    policyObservations: {
      policyVersion: "synthetic-current-policy-v1",
      rights: "review_deferred",
      indexLicence: "review_deferred",
      legalReviewDeferral: INTERNAL_BUILD_LEGAL_REVIEW_DEFERRAL,
      purposeClearance: "permitted",
    },
  };
  const evidence: RichAdminUnscannedEvidence = {
    version: RICH_ADMIN_UNSCANNED_POLICY,
    grant: {
      exceptionId: uuid(7),
      approvalReferenceSha256: hash,
      status: "active",
      issuedAt: new Date(Date.now() - 1000).toISOString(),
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      allowedPurposes: ["embedding"],
    },
    provenance: {
      documentOwnerId: null,
      stewardId: uuid(6),
      administratorId: uuid(6),
      administratorActive: true,
      scope: "existing_shared_library_stewardship",
      existingSharedPublic: true,
      admissionDigest: hash,
      binding,
    },
  };
  const payload = JSON.stringify({ model: "text-embedding-3-small", dimensions: 1536, input: [text] });
  const request = {
    purpose: "embedding" as const,
    payload,
    payloadSha256: bytesDigest(Buffer.from(payload)) as ContentSha256,
  };
  const loadCurrent = vi.fn(async () => source),
    loadScannerConfiguration = vi.fn(async () => ({
      backend: "administrator_rich_unscanned_exception" as const,
      evidence,
    }));
  const loader = createRichPdfInspectionLoader({
    attempt,
    binding,
    nativePdfBatch: {
      planDigest: hash,
      inputs: [{ providerInputText: text, sourceUnitIds: [{ family: "chunks", key: uuid(8) }] }],
    },
    loadCurrent,
    loadScannerConfiguration,
  });
  return { source, evidence, binding, request, loader, loadCurrent, loadScannerConfiguration };
}
describe("rich source egress with accountable stewardship", () => {
  it("authorizes the exact embedding while retaining null document ownership", async () => {
    const f = fixture(),
      result = await f.loader(f.request, f.binding);
    expect(evaluateDocumentIngressSafety(result.sourceObservations).verdict).toBe("pass");
    expect(evaluateDocumentIngressSafety(result.observations).verdict).toBe("pass");
    expect(result.sourceObservations.processingScope).toBe("existing_shared_library_reindex");
    expect(f.evidence.provenance.documentOwnerId).toBeNull();
    expect(f.loadCurrent).toHaveBeenCalledTimes(2);
  });
  it.each(["publicString", "ownerAlias", "expired", "wrongSteward", "changedSource", "embeddingInput"])(
    "refuses %s without a provider transport",
    async (kind) => {
      const f = fixture();
      if (kind === "publicString") f.source.sourceMetadata.public_corpus = "true";
      if (kind === "ownerAlias") f.evidence.provenance.documentOwnerId = uuid(6);
      if (kind === "expired") f.evidence.grant.expiresAt = new Date(Date.now() - 1).toISOString();
      if (kind === "wrongSteward") f.evidence.provenance.stewardId = uuid(99);
      if (kind === "changedSource") f.source.sourceBytes = Buffer.from("changed");
      if (kind === "embeddingInput") {
        const payload = JSON.stringify({ model: "text-embedding-3-small", dimensions: 1536, input: ["unbound"] });
        f.request = { ...f.request, payload, payloadSha256: bytesDigest(Buffer.from(payload)) as ContentSha256 };
      }
      await expect(f.loader(f.request, f.binding)).rejects.toThrow();
    },
  );
  it("does not accept serialized/forged receipts or an owner-private label on a shared receipt", async () => {
    const f = fixture(),
      result = await f.loader(f.request, f.binding);
    expect(
      evaluateDocumentIngressSafety({
        ...result.sourceObservations,
        scanner: { ...result.sourceObservations.scanner, exceptionReceipt: {} },
      }).verdict,
    ).toBe("quarantine");
    expect(
      evaluateDocumentIngressSafety({ ...result.sourceObservations, processingScope: "owner_internal_build" }).verdict,
    ).toBe("quarantine");
  });
  it("holds caption,summary and deep-memory until a trusted source-bound body is supplied", async () => {
    for (const purpose of ["caption", "summary", "deep_memory"] as const) {
      const f = fixture();
      await expect(f.loader({ ...f.request, purpose }, f.binding)).rejects.toThrow("purpose_source_body_unavailable");
      expect(f.loadScannerConfiguration).not.toHaveBeenCalled();
    }
  });
});
