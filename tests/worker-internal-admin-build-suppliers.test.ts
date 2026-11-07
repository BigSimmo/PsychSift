import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bytesDigest, parseOriginalApplicabilityWitness } from "../src/lib/ingestion-generation-evidence";
import { snapshotAdminUnscannedExceptionEvidence } from "../supabase/functions/_shared/admin-unscanned-exception";
import { GENERAL_PDF_INSPECTION_VERSION, type GeneralPdfInspectionReview } from "../worker/general-pdf-inspection";
import { createInternalAdminBuildSuppliers } from "../worker/internal-admin-build-suppliers";
import { workerProviderSourceBinding } from "../worker/provider-egress";
import type { JobRow } from "../worker/types";
import { PENDING_REINDEX_AUTHORITY_KEYS } from "../worker/pending-reindex-authority";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sourceHash = (bytes: Uint8Array): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
afterEach(() => vi.useRealTimers());

function fixture() {
  const bytes = Buffer.from("%PDF-1.7\nSynthetic source only\n%%EOF");
  const hash = sourceHash(bytes);
  const authority = {
    version: 1,
    sourceRole: "service_policy",
    authorityBasis: "administrator_template",
    licencePolicy: "review_required",
    rightsEvidenceRef: "synthetic pending review",
    publisher: "WA Health",
    jurisdiction: "Australia/WA",
    publicationDate: null,
    effectiveDate: null,
    reviewDate: null,
    expiryDate: null,
    currentness: "current",
    supersedesDocumentId: null,
    purpose: "clinical_retrieval",
    supportedFeatures: ["text"],
    providerProcessing: "permitted",
  };
  const job: JobRow = {
    id: uuid(3),
    document_id: uuid(1),
    locked_by: "synthetic-worker",
    lease_token: uuid(4),
    lease_expected_generation_id: null,
    lease_write_generation_id: uuid(2),
    lease_authority_digest: bytesDigest(Buffer.from("authority")),
    lease_expires_at: new Date(Date.now() + 60000).toISOString(),
    lease_duration_seconds: 60,
    batch_id: null,
    attempt_count: 1,
    max_attempts: 3,
    documents: {
      id: uuid(1),
      owner_id: uuid(5),
      title: "Synthetic",
      file_name: "synthetic.pdf",
      file_type: "application/pdf",
      storage_path: `${uuid(5)}/documents/${uuid(1)}/source.pdf`,
      content_hash: hash.slice(7),
      file_size: bytes.length,
      metadata: {
        authority,
        source_kind: "document",
        authority_basis: authority.authorityBasis,
        rights_evidence_ref: authority.rightsEvidenceRef,
        publisher: authority.publisher,
        jurisdiction: authority.jurisdiction,
        source_role: authority.sourceRole,
        corpus_scope: "uploaded_local",
        publisher_code: null,
        content_mode: "indexed_content",
        licence_policy: authority.licencePolicy,
        document_status: authority.currentness,
        admission_event_id: uuid(6),
        admission_policy_version: "trusted-document-admission-v1",
        content_hash: hash.slice(7),
      },
    },
  };
  const document = structuredClone(job.documents);
  const event = {
    id: uuid(6),
    document_id: uuid(1),
    staging_owner_id: uuid(5),
    source_channel: "admin_api",
    actor_kind: "administrator",
    administrator_id: uuid(5),
    backend_principal: null,
    correlation_id: uuid(7),
    admission_policy_version: "trusted-document-admission-v1",
    content_sha256: hash,
    file_name_sha256: bytesDigest(Buffer.from(document.file_name)),
    storage_path_sha256: bytesDigest(Buffer.from(document.storage_path)),
    mime_type: "application/pdf",
    byte_count: bytes.length,
    authority: structuredClone(authority),
    admission_digest: bytesDigest(Buffer.from("admission")),
  };
  const user = { id: uuid(5), app_metadata: { site_role: "administrator" }, banned_until: null as string | null };
  const select = vi.fn();
  const from = vi.fn((table: string) => {
    const query = {
      select: (columns: string) => {
        select(table, columns);
        return query;
      },
      eq: vi.fn(() => query),
      single: vi.fn(async () => ({ data: structuredClone(table === "documents" ? document : event), error: null })),
    };
    return query;
  });
  const download = vi.fn(async () => ({ data: new Blob([bytes]), error: null }));
  const getBucket = vi.fn(async () => ({ data: { id: "private-originals", public: false }, error: null }));
  const getUserById = vi.fn(async () => ({ data: { user: structuredClone(user) }, error: null }));
  const client = {
    from,
    storage: { from: vi.fn(() => ({ download })), getBucket },
    auth: { admin: { getUserById } },
  } as unknown as SupabaseClient;
  const inspectNativePdf = vi.fn(
    async (
      _bytes: Uint8Array,
      binding: ReturnType<typeof workerProviderSourceBinding>,
    ): Promise<GeneralPdfInspectionReview> => {
      const texts = ["First independent original page.\n", "Second original page.\n"];
      return {
        version: GENERAL_PDF_INSPECTION_VERSION,
        binding: { ...binding },
        sourceSha256: hash,
        sourceByteLength: bytes.length,
        pageCount: texts.length,
        pages: texts.map((text, i) => ({ pageNumber: i + 1, text, textSha256: sourceHash(Buffer.from(text)) })),
        pageInventory: "complete",
        activeContent: "absent",
        encryption: "not_encrypted",
        hiddenText: "consistent",
        inspectedAt: new Date(Date.now() - 1000).toISOString(),
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      };
    },
  );
  const options = {
    bucket: "private-originals",
    allowedDocumentIds: [job.document_id],
    approvalReferenceSha256: bytesDigest(Buffer.from("explicit synthetic approval")),
    issuedAt: new Date(Date.now() - 1000).toISOString(),
    expiresAt: new Date(Date.now() + 120000).toISOString(),
    inspectNativePdf,
  };
  return {
    bytes,
    hash,
    job,
    document,
    event,
    user,
    client,
    from,
    select,
    download,
    getBucket,
    getUserById,
    inspectNativePdf,
    options,
  };
}

describe("explicit owner-internal native PDF source supplier", () => {
  it("loads actual bound source, admission and admin, deferring legal review only for the internal draft", async () => {
    const f = fixture();
    const suppliers = createInternalAdminBuildSuppliers(f.client, f.options);
    expect(f.from).not.toHaveBeenCalled();
    const source = await suppliers.loadApprovedSource(f.job, "embedding");
    expect(source).toMatchObject({
      ownerId: uuid(5),
      documentId: uuid(1),
      sourceFamily: "native_pdf",
      sourceSha256: f.hash,
      catalogueKey: "wa-health",
      policyObservations: {
        rights: "review_deferred",
        indexLicence: "review_deferred",
        processingScope: "owner_internal_build",
        legalReviewDeferral: "owner-internal-build-2026-11-03",
      },
    });
    expect(source!.sourceBytes).toEqual(f.bytes);
    expect(f.getUserById).toHaveBeenCalledWith(uuid(5));
    expect(f.download).toHaveBeenCalledWith(f.document.storage_path);
    expect(f.inspectNativePdf).toHaveBeenCalledWith(f.bytes, workerProviderSourceBinding(f.job, f.document));
    expect(source!.sourceExpectation!.units).toHaveLength(2);
    expect(source!.sourceExpectation!.units?.[0]).toMatchObject({
      required: true,
      nativeMapping: "unavailable",
      locator: `pdf-page:1:native-text:${source!.generalPdf!.pages[0].textSha256}`,
    });
    const witness = parseOriginalApplicabilityWitness({
      sourceExpectation: source!.sourceExpectation,
      originalBytes: f.bytes,
      witnessBytes: source!.sourceExpectationWitnessBytes,
    });
    expect(witness.status).toBe("typed_original_requirements");
    const body = JSON.parse(source!.sourceExpectationWitnessBytes.toString("utf8"));
    expect(body.qualification).toBe("independently_declared_unverified");
    expect(body.groups.find((g: { family: string }) => g.family === "chunks").population.requirements).toHaveLength(2);
  });

  it("reloads current admission/admin/source before issuing stable source-and-attempt-bound unscanned evidence", async () => {
    const f = fixture();
    const suppliers = createInternalAdminBuildSuppliers(f.client, f.options);
    const binding = workerProviderSourceBinding(f.job, f.job.documents);
    const args = {
      job: f.job,
      binding,
      contentSha256: f.hash as typeof binding.contentSha256,
      phase: "source" as const,
      request: {
        purpose: "embedding" as const,
        payload: f.bytes,
        payloadSha256: f.hash as typeof binding.contentSha256,
      },
    };
    const first = await suppliers.loadScannerConfiguration(args);
    const second = await suppliers.loadScannerConfiguration(args);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ backend: "admin_unscanned_exception" });
    if (!("backend" in first) || first.backend !== "admin_unscanned_exception")
      throw new Error("missing explicit exception");
    expect(snapshotAdminUnscannedExceptionEvidence(first.evidence)).toMatchObject({
      grant: {
        binding,
        approvalReferenceSha256: f.options.approvalReferenceSha256,
        issuedAt: f.options.issuedAt,
        expiresAt: f.options.expiresAt,
        admissionDigest: f.event.admission_digest,
        administratorId: uuid(5),
      },
    });
    expect(f.getUserById).toHaveBeenCalledTimes(2);
    f.user.app_metadata.site_role = "member";
    await expect(suppliers.loadScannerConfiguration(args)).rejects.toThrow();
  });

  it("reuses only the bound structural inspection while reloading source and admin permission every time", async () => {
    const f = fixture();
    const suppliers = createInternalAdminBuildSuppliers(f.client, f.options);
    const first = await suppliers.loadApprovedSource(f.job, "embedding");
    first!.generalPdf!.pages[0]!.text = "Mutated consumer output";
    const second = await suppliers.loadApprovedSource(f.job, "embedding");
    expect(second!.generalPdf!.pages[0]!.text).toBe("First independent original page.\n");
    expect(f.inspectNativePdf).toHaveBeenCalledTimes(1);
    expect(f.getUserById).toHaveBeenCalledTimes(2);
    expect(f.download).toHaveBeenCalledTimes(2);
    f.user.app_metadata.site_role = "member";
    await expect(suppliers.loadApprovedSource(f.job, "embedding")).rejects.toThrow("administrator_unavailable");
    expect(f.inspectNativePdf).toHaveBeenCalledTimes(1);
  });

  it("refreshes expired structural review and never reuses a different attempt binding", async () => {
    const f = fixture();
    f.options.expiresAt = new Date(Date.now() + 300000).toISOString();
    f.job.lease_expires_at = f.options.expiresAt;
    const suppliers = createInternalAdminBuildSuppliers(f.client, f.options);
    await suppliers.loadApprovedSource(f.job, "embedding");
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 61000);
    await suppliers.loadApprovedSource(f.job, "embedding");
    expect(f.inspectNativePdf).toHaveBeenCalledTimes(2);
    f.job.lease_token = uuid(50);
    const source = await suppliers.loadApprovedSource(f.job, "embedding");
    expect(f.inspectNativePdf).toHaveBeenCalledTimes(3);
    expect(source!.generalPdf!.binding.leaseId).toBe(uuid(50));
    expect(f.getUserById).toHaveBeenCalledTimes(3);
  });

  it.each([
    { allowedDocumentIds: [] },
    { allowedDocumentIds: ["invalid"] },
    { approvalReferenceSha256: "unverified" },
    { issuedAt: "invalid" },
    { expiresAt: "2000-01-01T00:00:00.000Z" },
    { inspectNativePdf: undefined },
  ])("rejects missing or malformed explicit policy before any read: %j", (patch) => {
    const f = fixture();
    expect(() => createInternalAdminBuildSuppliers(f.client, { ...f.options, ...patch } as typeof f.options)).toThrow();
    expect(f.from).not.toHaveBeenCalled();
  });

  it("rejects future or greater-than-24-hour policy and rechecks fixed expiry after construction", async () => {
    const f = fixture();
    expect(() =>
      createInternalAdminBuildSuppliers(f.client, {
        ...f.options,
        issuedAt: new Date(Date.now() + 10000).toISOString(),
      }),
    ).toThrow("policy_not_current");
    expect(() =>
      createInternalAdminBuildSuppliers(f.client, {
        ...f.options,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      }),
    ).toThrow("policy_not_current");
    const suppliers = createInternalAdminBuildSuppliers(f.client, f.options);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 121000);
    await expect(suppliers.loadApprovedSource(f.job, "embedding")).rejects.toThrow("policy_not_current");
    expect(f.from).not.toHaveBeenCalled();
  });

  it.each([
    [
      "foreign admission",
      (f: ReturnType<typeof fixture>) => {
        f.event.document_id = uuid(50);
      },
    ],
    [
      "foreign owner",
      (f: ReturnType<typeof fixture>) => {
        f.event.staging_owner_id = uuid(50);
      },
    ],
    [
      "changed admission source",
      (f: ReturnType<typeof fixture>) => {
        f.event.content_sha256 = sourceHash(Buffer.from("foreign"));
      },
    ],
    [
      "changed storage identity",
      (f: ReturnType<typeof fixture>) => {
        f.event.storage_path_sha256 = bytesDigest(Buffer.from("foreign"));
      },
    ],
    [
      "missing actual admission digest",
      (f: ReturnType<typeof fixture>) => {
        f.event.admission_digest = "invalid";
      },
    ],
    [
      "nonadministrator actor",
      (f: ReturnType<typeof fixture>) => {
        f.event.actor_kind = "trusted_backend";
      },
    ],
    [
      "revoked administrator",
      (f: ReturnType<typeof fixture>) => {
        f.user.app_metadata.site_role = "member";
      },
    ],
    [
      "banned administrator",
      (f: ReturnType<typeof fixture>) => {
        f.user.banned_until = new Date(Date.now() + 100000).toISOString();
      },
    ],
    [
      "public bucket",
      (f: ReturnType<typeof fixture>) => {
        f.getBucket.mockResolvedValue({ data: { id: "private-originals", public: true }, error: null });
      },
    ],
    [
      "expired lease",
      (f: ReturnType<typeof fixture>) => {
        f.job.lease_expires_at = new Date(Date.now() - 1).toISOString();
      },
    ],
    [
      "changed original bytes",
      (f: ReturnType<typeof fixture>) => {
        f.download.mockResolvedValue({ data: new Blob([Buffer.alloc(f.bytes.length)]), error: null });
      },
    ],
  ] as const)("refuses %s before inspecting or producing permission", async (_name, change) => {
    const f = fixture();
    const suppliers = createInternalAdminBuildSuppliers(f.client, f.options);
    change(f);
    await expect(suppliers.loadApprovedSource(f.job, "embedding")).rejects.toThrow();
    expect(f.inspectNativePdf).not.toHaveBeenCalled();
  });

  it.each(["denied", "index_forbidden", "metadata_link_only", "link_only", "public_scope", "unsupported_publisher"])(
    "does not convert %s into internal permission",
    async (mode) => {
      const f = fixture();
      for (const document of [f.document, f.job.documents]) {
        const metadata = document.metadata!;
        if (mode === "denied") metadata.rights = "denied";
        else if (mode === "link_only") metadata.content_mode = "link_only";
        else if (mode === "public_scope") metadata.corpus_scope = "australian_public";
        else if (mode === "unsupported_publisher") {
          metadata.publisher = "Unsupported publisher";
          (metadata.authority as Record<string, unknown>).publisher = "Unsupported publisher";
        } else {
          metadata.licence_policy = mode;
          (metadata.authority as Record<string, unknown>).licencePolicy = mode;
        }
      }
      if (mode === "unsupported_publisher") f.event.authority.publisher = "Unsupported publisher";
      else if (mode === "index_forbidden" || mode === "metadata_link_only") f.event.authority.licencePolicy = mode;
      const suppliers = createInternalAdminBuildSuppliers(f.client, f.options);
      await expect(suppliers.loadApprovedSource(f.job, "embedding")).rejects.toThrow();
      expect(f.inspectNativePdf).not.toHaveBeenCalled();
    },
  );

  it("accepts a readmitted draft whose declared ranking fields are still pending, and refuses a foreign block", async () => {
    const f = fixture();
    const live = f.job.documents.metadata as Record<string, unknown>;
    const values = Object.fromEntries(PENDING_REINDEX_AUTHORITY_KEYS.map((key) => [key, live[key] ?? null]));
    const prior = {
      ...Object.fromEntries(PENDING_REINDEX_AUTHORITY_KEYS.map((key) => [key, null])),
      publisher: "Superseded publisher",
      source_role: "clinical_reference",
      licence_policy: "public_index_permitted",
      document_status: "outdated",
    };
    for (const key of PENDING_REINDEX_AUTHORITY_KEYS) delete live[key];
    Object.assign(live, prior, {
      pending_reindex_authority: {
        version: "pending-reindex-authority-v1",
        admissionEventId: live.admission_event_id,
        values,
        prior,
      },
    });
    f.document.metadata = structuredClone(live);
    const suppliers = createInternalAdminBuildSuppliers(f.client, f.options);
    await expect(suppliers.loadApprovedSource(f.job, "embedding")).resolves.toMatchObject({ documentId: uuid(1) });
    for (const metadata of [live, f.document.metadata as Record<string, unknown>])
      (metadata.pending_reindex_authority as Record<string, unknown>).admissionEventId = uuid(51);
    await expect(suppliers.loadApprovedSource(f.job, "embedding")).rejects.toThrow("admission_binding_mismatch");
  });

  it("rejects foreign jobs and mutated allowlists and mismatched inspector evidence", async () => {
    const f = fixture();
    const suppliers = createInternalAdminBuildSuppliers(f.client, f.options);
    f.options.allowedDocumentIds.push(uuid(50));
    await expect(suppliers.loadApprovedSource({ ...f.job, document_id: uuid(50) }, "embedding")).rejects.toThrow();
    const inspect = f.inspectNativePdf.getMockImplementation()!;
    f.inspectNativePdf.mockImplementation(async (bytes, binding) => ({
      ...(await inspect(bytes, binding)),
      binding: { ...binding, leaseId: uuid(50) },
    }));
    await expect(suppliers.loadApprovedSource(f.job, "embedding")).rejects.toThrow("source_binding_mismatch");
  });
});
