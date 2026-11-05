import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, it, expect, vi } from "vitest";
import { bytesDigest, generationEvidenceDigest } from "../src/lib/ingestion-generation-evidence";
import { createInternalRichPdfBuildSuppliers } from "../worker/internal-rich-pdf-suppliers";
import { workerProviderSourceBinding } from "../worker/provider-egress";
import type { RichPdfInspectionResult } from "../worker/rich-pdf-inspection";
import type { JobRow } from "../worker/types";
const id = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function fixture() {
  const bytes = Buffer.from("%PDF-synthetic original source"),
    sha = bytesDigest(bytes);
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
    file_name_sha256: bytesDigest(Buffer.from(document.file_name)),
    storage_path_sha256: bytesDigest(Buffer.from(document.storage_path)),
    mime_type: "application/pdf",
    byte_count: bytes.length,
    admission_digest: sha,
    authority,
  };
  const user = { id: id(5), app_metadata: { site_role: "administrator" }, banned_until: null as string | null };
  const download = vi.fn(async () => ({ data: new Blob([bytes]), error: null }));
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
    const text = "SYNTHETIC REFERENCE ONLY",
      textSha = bytesDigest(Buffer.from(text)),
      features = { nativeText: true, rasterImages: 0, vectorDrawings: 0, nativeTables: 0 };
    return {
      extracted: { pages: [{ pageNumber: 1, text }], images: [] },
      capturedImages: [],
      review: {
        version: "administrator-rich-pdf-inspection-v2",
        binding: workerProviderSourceBinding(job, job.documents),
        sourceSha256: sha,
        sourceByteLength: bytes.length,
        pageCount: 1,
        pageInventory: "complete",
        pages: [
          {
            pageNumber: 1,
            text,
            textSha256: textSha,
            nativeTextSha256: textSha,
            ocrUsed: false,
            sourceProvenanceSha256: generationEvidenceDigest({}),
            originalFeatures: features,
            imageOrdinals: [],
            tableOrdinals: [],
          },
        ],
        images: [],
        tables: [],
        sourceInventory: [
          {
            pageNumber: 1,
            nativeTextSha256: textSha,
            ...features,
            rasterBboxes: [],
            vectorBboxes: [],
            tableBboxes: [],
          },
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
    };
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
describe("finite internal rich PDF source supplier", () => {
  it("enables summary grants only through explicit server policy", async () => {
    for (const enabled of [false, true]) {
      const f = fixture();
      const suppliers = createInternalRichPdfBuildSuppliers(f.client, {
        ...f.options,
        enableSourceAnchoredSummary: enabled,
      });
      const source = await suppliers.loadApprovedSource(f.job, "embedding");
      expect(source?.summaryEnabled).toBe(enabled);
      const payload = "synthetic";
      const contentSha256 = bytesDigest(Buffer.from(payload)) as `sha256:${string}`;
      const configuration = await suppliers.loadRichScannerConfiguration!({
        job: f.job,
        binding: workerProviderSourceBinding(f.job, f.job.documents),
        request: { purpose: "summary", payload, payloadSha256: contentSha256 },
        phase: "payload",
        contentSha256,
      });
      expect(configuration.evidence.grant.allowedPurposes).toEqual(enabled ? ["embedding", "summary"] : ["embedding"]);
    }
  });
  it("preserves shared null ownership and reloads permissions while caching structural work", async () => {
    const f = fixture(),
      s = createInternalRichPdfBuildSuppliers(f.client, f.options);
    expect(f.from).not.toHaveBeenCalled();
    const a = await s.loadApprovedSource(f.job, "embedding");
    await s.loadApprovedSource(f.job, "embedding");
    expect(a).toMatchObject({
      ownerId: null,
      stewardId: id(5),
      sourceFamily: "rich_pdf",
      policyObservations: { rights: "review_deferred" },
    });
    expect(f.inspectRichPdf).toHaveBeenCalledTimes(1);
    expect(f.getUserById).toHaveBeenCalledTimes(2);
    expect(f.download).toHaveBeenCalledTimes(2);
  });
  it("detects administrator revocation even after cached inspection", async () => {
    const f = fixture(),
      s = createInternalRichPdfBuildSuppliers(f.client, f.options);
    await s.loadApprovedSource(f.job, "embedding");
    f.user.app_metadata.site_role = "member";
    await expect(s.loadApprovedSource(f.job, "embedding")).rejects.toThrow("administrator_unavailable");
  });
  it("refuses changed original bytes", async () => {
    const f = fixture();
    f.download.mockResolvedValue({ data: new Blob(["changed"]), error: null });
    await expect(
      createInternalRichPdfBuildSuppliers(f.client, f.options).loadApprovedSource(f.job, "embedding"),
    ).rejects.toThrow();
  });
  it("refuses other-user private sources and missing shared publication state", async () => {
    for (const owner of [id(9), null]) {
      const f = fixture();
      f.document.owner_id = owner;
      f.document.metadata.public_corpus = false;
      f.job.documents = structuredClone(f.document);
      await expect(
        createInternalRichPdfBuildSuppliers(f.client, f.options).loadApprovedSource(f.job, "embedding"),
      ).rejects.toThrow();
    }
  });
  it("refuses missing admission, prohibited source and public originals bucket", async () => {
    for (const change of ["admission", "rights", "bucket"]) {
      const f = fixture();
      if (change === "admission") f.event.administrator_id = id(9);
      if (change === "rights") {
        f.document.metadata.rights = "denied";
        f.job.documents = structuredClone(f.document);
      }
      if (change === "bucket") f.getBucket.mockResolvedValue({ data: { public: true }, error: null });
      await expect(
        createInternalRichPdfBuildSuppliers(f.client, f.options).loadApprovedSource(f.job, "embedding"),
      ).rejects.toThrow();
    }
  });
  it("refuses expired policy before reads", () => {
    const f = fixture();
    expect(() =>
      createInternalRichPdfBuildSuppliers(f.client, {
        ...f.options,
        expiresAt: new Date(Date.now() - 1).toISOString(),
      }),
    ).toThrow("policy_not_current");
    expect(f.from).not.toHaveBeenCalled();
  });
});
