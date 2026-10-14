import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  assertTrustedAdministratorAssurance,
  createTrustedDocumentAdmission,
  dispatchTrustedDocumentAdmission,
  toTrustedDocumentAdmissionRpcPayload,
  TrustedDocumentAdmissionDispatchError,
  TrustedDocumentStorageUploadError,
  trustedAdmissionDocumentId,
  uploadTrustedDocumentBytes,
  type TrustedAdmissionAuthority,
  type TrustedAdmissionDocumentInput,
  type TrustedAdmissionInput,
  type TrustedAdmissionRpcClient,
} from "@/lib/trusted-document-admission";

const administratorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const documentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const correlationId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const eventId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const jobId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const contentHex = "a".repeat(64);
const fileName = "clinical-guideline.pdf";
const storagePath = `${administratorId}/documents/${documentId}/${fileName}`;

const authority: TrustedAdmissionAuthority = {
  version: 1,
  sourceRole: "clinical_guideline",
  authorityBasis: "administrator_template",
  licencePolicy: "review_required",
  rightsEvidenceRef: "registry:wa-health:clinical-guideline",
  publisher: "WA Health",
  jurisdiction: "Australia",
  publicationDate: "2026-01-02",
  effectiveDate: "2026-02-03",
  reviewDate: null,
  expiryDate: null,
  currentness: "unknown",
  supersedesDocumentId: null,
  purpose: "clinical_retrieval",
  supportedFeatures: ["images", "tables", "text"],
  providerProcessing: "forbidden",
};

function admissionInput(overrides: Partial<TrustedAdmissionInput> = {}): TrustedAdmissionInput {
  return {
    actor: { kind: "administrator", administratorId },
    sourceChannel: "admin_api",
    documentId,
    stagingOwnerId: administratorId,
    contentSha256: `sha256:${contentHex}`,
    storagePath,
    originalFileName: fileName,
    mimeType: "application/pdf",
    byteCount: 1_024,
    correlationId,
    admissionPolicyVersion: "trusted-document-admission-v1",
    authority,
    ...overrides,
  };
}

function documentInput(overrides: Partial<TrustedAdmissionDocumentInput> = {}): TrustedAdmissionDocumentInput {
  return {
    id: documentId,
    owner_id: administratorId,
    title: "Clinical guideline",
    description: null,
    file_name: fileName,
    file_type: "application/pdf",
    file_size: 1_024,
    storage_path: storagePath,
    content_hash: contentHex,
    metadata: { corpus_scope: "uploaded_local", content_mode: "indexed_content", authority },
    max_attempts: 3,
    ...overrides,
  };
}

function positiveRpcResult(outcome: "created" | "replayed" = "created", status = "pending") {
  return {
    data: {
      outcome,
      admission_event_id: eventId,
      document: { id: documentId, owner_id: administratorId, content_hash: contentHex, title: "Clinical guideline" },
      job: { id: jobId, document_id: documentId, status },
    },
    error: null,
  };
}

describe("trusted document admission", () => {
  it("constructs an authentic administrator admission with pure audit hashes and no raw path or filename", () => {
    const admission = createTrustedDocumentAdmission(admissionInput());
    const payload = toTrustedDocumentAdmissionRpcPayload(admission);

    expect(admission).toMatchObject({
      actor: { kind: "administrator", administratorId },
      documentId,
      stagingOwnerId: administratorId,
      sourceChannel: "admin_api",
      contentSha256: `sha256:${contentHex}`,
      admissionPolicyVersion: "trusted-document-admission-v1",
      authority,
    });
    expect(admission.fileNameSha256).toBe(`sha256:${createHash("sha256").update(fileName, "utf8").digest("hex")}`);
    expect(admission.storagePathSha256).toBe(
      `sha256:${createHash("sha256").update(storagePath, "utf8").digest("hex")}`,
    );
    expect(JSON.stringify(payload)).not.toContain(fileName);
    expect(JSON.stringify(payload)).not.toContain(storagePath);
    expect(Object.keys(payload).toSorted()).toEqual(
      [
        "document_id",
        "staging_owner_id",
        "source_channel",
        "content_sha256",
        "file_name_sha256",
        "storage_path_sha256",
        "mime_type",
        "byte_count",
        "correlation_id",
        "admission_policy_version",
        "authority",
      ].toSorted(),
    );
  });

  it("refuses self-supersession before dispatch", () => {
    expect(() =>
      createTrustedDocumentAdmission(
        admissionInput({
          authority: { ...authority, supersedesDocumentId: documentId },
        }),
      ),
    ).toThrow("Trusted admission cannot supersede its own document.");
  });

  it("accepts the exact size and metadata bounds and refuses the first values beyond them", () => {
    expect(() =>
      createTrustedDocumentAdmission(
        admissionInput({
          byteCount: 150 * 1024 * 1024,
          authority: { ...authority, rightsEvidenceRef: "r".repeat(500), publisher: "p".repeat(300) },
        }),
      ),
    ).not.toThrow();
    expect(() => createTrustedDocumentAdmission(admissionInput({ byteCount: 150 * 1024 * 1024 + 1 }))).toThrow(
      /byteCount/,
    );
    expect(() =>
      createTrustedDocumentAdmission(
        admissionInput({ authority: { ...authority, rightsEvidenceRef: "r".repeat(501) } }),
      ),
    ).toThrow(/rightsEvidenceRef/);
    expect(() =>
      createTrustedDocumentAdmission(admissionInput({ authority: { ...authority, publisher: "p".repeat(301) } })),
    ).toThrow(/publisher/);
  });

  it.each([
    [{ ...authority, sourceRole: "reference_link" }, /sourceRole/],
    [{ ...authority, licencePolicy: "metadata_link_only" }, /indexable/],
    [{ ...authority, licencePolicy: "index_forbidden" }, /indexable/],
    [{ ...authority, currentness: "withdrawn" }, /withdrawn/],
    [{ ...authority, currentness: "superseded" }, /superseded/],
    [{ ...authority, supportedFeatures: ["text", "images"] }, /sorted/],
    [{ ...authority, supportedFeatures: ["images", "images"] }, /unique/],
    [{ ...authority, publicationDate: "2026-02-30" }, /real ISO/],
  ])("refuses an authority template that reaches a governed boundary", (candidate, error) => {
    expect(() =>
      createTrustedDocumentAdmission(admissionInput({ authority: candidate as TrustedAdmissionAuthority })),
    ).toThrow(error);
  });

  it("requires actor/channel compatibility and the administrator as staging owner", () => {
    expect(() =>
      createTrustedDocumentAdmission(
        admissionInput({ actor: { kind: "trusted_backend", principal: "backend-a" } as never }),
      ),
    ).toThrow(/administrator actor/i);
    expect(() =>
      createTrustedDocumentAdmission(admissionInput({ stagingOwnerId: "11111111-1111-4111-8111-111111111111" })),
    ).toThrow(/staging owner/);
    expect(() => createTrustedDocumentAdmission(admissionInput({ documentId: documentId.toUpperCase() }))).toThrow(
      /canonical lower-case UUID/,
    );
  });

  it("requires verified administrator identity, aal2, immutable role, and recent detailed AMR", () => {
    const nowMs = Date.UTC(2026, 8, 12, 12, 0, 0);
    const nowSeconds = nowMs / 1_000;
    const claims = {
      sub: administratorId,
      role: "authenticated",
      aal: "aal2",
      app_metadata: { site_role: "administrator" },
      amr: [{ method: "webauthn", timestamp: nowSeconds - 900 }],
    };
    expect(() => assertTrustedAdministratorAssurance(claims, administratorId, nowMs)).not.toThrow();
    expect(() =>
      assertTrustedAdministratorAssurance({ ...claims, app_metadata: { site_role: "user" } }, administratorId, nowMs),
    ).toThrow(/administrator_assurance_required/);
    expect(() =>
      assertTrustedAdministratorAssurance(
        { ...claims, iat: nowSeconds, amr: [{ method: "webauthn", timestamp: nowSeconds - 901 }] },
        administratorId,
        nowMs,
      ),
    ).toThrow(/recent_authentication/);
    expect(() => assertTrustedAdministratorAssurance({ ...claims, amr: ["webauthn"] }, administratorId, nowMs)).toThrow(
      /recent_authentication/,
    );
    expect(() =>
      assertTrustedAdministratorAssurance(
        { ...claims, amr: [{ method: "webauthn", timestamp: nowSeconds + 1 }] },
        administratorId,
        nowMs,
      ),
    ).toThrow(/recent_authentication/);
  });

  it("derives a stable canonical document UUID from namespaced actor and correlation identity", () => {
    const first = trustedAdmissionDocumentId(`administrator:${administratorId}`, correlationId);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(trustedAdmissionDocumentId(`administrator:${administratorId}`, correlationId)).toBe(first);
    expect(trustedAdmissionDocumentId(`trusted_backend:${administratorId}`, correlationId)).not.toBe(first);
  });

  it("dispatches only canonical private input and validates a created response", async () => {
    const admission = createTrustedDocumentAdmission(admissionInput());
    const rpc = vi.fn<TrustedAdmissionRpcClient["rpc"]>(async () => positiveRpcResult());
    const result = await dispatchTrustedDocumentAdmission(
      { admission, document: documentInput(), replayOnly: false },
      { rpc },
    );

    expect(result.outcome).toBe("created");
    expect(rpc).toHaveBeenCalledWith("admit_administrator_document", {
      p_admission: toTrustedDocumentAdmissionRpcPayload(admission),
      p_document: documentInput(),
      p_replay_only: false,
    });
  });

  it("passes backend credentials only to the backend wrapper and never into the audit payload", async () => {
    const backendAuthority = { ...authority, authorityBasis: "backend_manifest" as const };
    const admission = createTrustedDocumentAdmission(
      admissionInput({
        actor: { kind: "trusted_backend", principal: "configured-importer" },
        sourceChannel: "backend_import",
        authority: backendAuthority,
      }),
    );
    const backendDocument = documentInput({ metadata: { ...documentInput().metadata, authority: backendAuthority } });
    const capability = "b".repeat(64);
    const rpc = vi.fn<TrustedAdmissionRpcClient["rpc"]>(async () => positiveRpcResult());
    await dispatchTrustedDocumentAdmission(
      {
        admission,
        document: backendDocument,
        replayOnly: false,
        backend: { principal: "configured-importer", capability },
      },
      { rpc },
    );

    const [, args] = rpc.mock.calls[0]!;
    expect(args).toMatchObject({ p_principal: "configured-importer", p_capability: capability });
    expect(JSON.stringify(args.p_admission)).not.toContain(capability);
    await expect(
      dispatchTrustedDocumentAdmission(
        {
          admission,
          document: backendDocument,
          replayOnly: false,
          backend: { principal: "configured-importer", capability: "B".repeat(64) },
        },
        { rpc },
      ),
    ).rejects.toThrow(/64 lower-case/);
  });

  it("accepts progressed exact replay jobs but requires a newly created job to be pending", async () => {
    const admission = createTrustedDocumentAdmission(admissionInput());
    await expect(
      dispatchTrustedDocumentAdmission(
        { admission, document: documentInput(), replayOnly: true },
        { rpc: async () => positiveRpcResult("replayed", "completed") },
      ),
    ).resolves.toMatchObject({ outcome: "replayed", job: { id: jobId, status: "completed" } });
    await expect(
      dispatchTrustedDocumentAdmission(
        { admission, document: documentInput(), replayOnly: false },
        { rpc: async () => positiveRpcResult("created", "processing") },
      ),
    ).rejects.toMatchObject({ kind: "outcome_unknown" });
  });

  it("returns not_found only for replay lookup and rejects mismatched positive identities", async () => {
    const admission = createTrustedDocumentAdmission(admissionInput());
    await expect(
      dispatchTrustedDocumentAdmission(
        { admission, document: documentInput(), replayOnly: true },
        { rpc: async () => ({ data: { outcome: "not_found" }, error: null }) },
      ),
    ).resolves.toEqual({ outcome: "not_found" });
    await expect(
      dispatchTrustedDocumentAdmission(
        { admission, document: documentInput(), replayOnly: false },
        {
          rpc: async () => ({
            ...positiveRpcResult(),
            data: {
              ...positiveRpcResult().data,
              document: { ...positiveRpcResult().data.document, owner_id: correlationId },
            },
          }),
        },
      ),
    ).rejects.toMatchObject({ kind: "outcome_unknown" });
  });

  it("distinguishes explicit SQL refusal from ambiguous transport and gateway failures", async () => {
    const admission = createTrustedDocumentAdmission(admissionInput());
    const dispatch = (rpc: () => Promise<never> | Promise<{ data: unknown; error: { message: string } | null }>) =>
      dispatchTrustedDocumentAdmission({ admission, document: documentInput(), replayOnly: false }, { rpc });

    await expect(
      dispatch(async () => ({ data: null, error: { message: "admission_replay_conflict" } })),
    ).rejects.toMatchObject({ kind: "rejected" });
    await expect(dispatch(async () => ({ data: null, error: { message: "gateway timeout" } }))).rejects.toMatchObject({
      kind: "outcome_unknown",
    });
    await expect(
      dispatch(async () => {
        throw new Error("fetch failed");
      }),
    ).rejects.toMatchObject({ kind: "outcome_unknown" });
  });

  it("does not expose RPC details or mistake an embedded refusal phrase for a definitive refusal", async () => {
    const admission = createTrustedDocumentAdmission(admissionInput());
    const privateDetail = "synthetic-private-request-detail";
    for (const throws of [false, true]) {
      const rpc = async () => {
        const error = { message: `gateway invalid_payload duplicate_content ${privateDetail}`, details: privateDetail };
        if (throws) throw error;
        return { data: null, error };
      };
      const result = await dispatchTrustedDocumentAdmission(
        { admission, document: documentInput(), replayOnly: false },
        { rpc },
      ).catch((error: unknown) => error);
      expect(result).toBeInstanceOf(TrustedDocumentAdmissionDispatchError);
      expect(result).toMatchObject({ kind: "outcome_unknown" });
      expect((result as Error).cause).toBeUndefined();
      expect(String(result)).not.toContain(privateDetail);
    }
  });

  it.each([undefined, null, {}, { data: null }, { error: null }])(
    "retains an unknown outcome for malformed RPC envelopes: %j",
    async (envelope) => {
      const rpc = vi.fn<TrustedAdmissionRpcClient["rpc"]>(async () => envelope as never);
      await expect(
        dispatchTrustedDocumentAdmission(
          {
            admission: createTrustedDocumentAdmission(admissionInput()),
            document: documentInput(),
            replayOnly: false,
          },
          { rpc },
        ),
      ).rejects.toMatchObject({ kind: "outcome_unknown" });
      expect(rpc).toHaveBeenCalledOnce();
    },
  );

  it("refuses mismatched private bytes and max-attempt boundaries before RPC dispatch", async () => {
    const admission = createTrustedDocumentAdmission(admissionInput());
    const rpc = vi.fn<TrustedAdmissionRpcClient["rpc"]>(async () => positiveRpcResult());
    await expect(
      dispatchTrustedDocumentAdmission(
        { admission, document: documentInput({ file_name: "other.pdf" }), replayOnly: false },
        { rpc },
      ),
    ).rejects.toThrow(/audit digest/);
    await expect(
      dispatchTrustedDocumentAdmission(
        { admission, document: documentInput({ max_attempts: 101 }), replayOnly: false },
        { rpc },
      ),
    ).rejects.toThrow(/1 to 100/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("exposes a typed dispatch error without leaking backend capability material", () => {
    const error = new TrustedDocumentAdmissionDispatchError("outcome_unknown", "reconcile request");
    expect(error).toMatchObject({ name: "TrustedDocumentAdmissionDispatchError", kind: "outcome_unknown" });
  });
});

describe("trusted document Storage upload recovery", () => {
  const bytes = new TextEncoder().encode("current validated document bytes");
  const contentSha256 = createHash("sha256").update(bytes).digest("hex");
  const intendedStoragePath = `${administratorId}/documents/${documentId}/guideline.pdf`;
  const recoveryId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  it("moves a confirmed identical collision to a fresh attempt-owned sibling without overwriting", async () => {
    const upload = vi
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: {
          name: "StorageApiError",
          message: "The resource already exists",
          status: 409,
          statusCode: "409",
          code: "ResourceAlreadyExists",
        },
      })
      .mockResolvedValueOnce({ data: { path: "created" }, error: null });
    const download = vi.fn(async () => ({ data: new Blob([bytes]), error: null }));

    await expect(
      uploadTrustedDocumentBytes({
        storage: { upload, download },
        ownerId: administratorId,
        documentId,
        intendedStoragePath,
        bytes,
        byteCount: bytes.byteLength,
        contentSha256,
        contentType: "application/pdf",
        createRecoveryId: () => recoveryId,
      }),
    ).resolves.toEqual({
      storagePath: `${administratorId}/documents/${documentId}/recovery-${recoveryId}-guideline.pdf`,
      collisionRecovered: true,
    });
    expect(upload).toHaveBeenNthCalledWith(1, intendedStoragePath, bytes, {
      contentType: "application/pdf",
      upsert: false,
    });
    expect(upload).toHaveBeenNthCalledWith(
      2,
      `${administratorId}/documents/${documentId}/recovery-${recoveryId}-guideline.pdf`,
      bytes,
      { contentType: "application/pdf", upsert: false },
    );
    expect(download).toHaveBeenCalledWith(intendedStoragePath);
  });

  it("refuses a collided path whose complete bytes do not match", async () => {
    const upload = vi.fn(async () => ({
      data: null,
      error: { status: 409, statusCode: "409", code: "ResourceAlreadyExists" },
    }));
    const download = vi.fn(async () => ({ data: new Blob(["different bytes"]), error: null }));

    await expect(
      uploadTrustedDocumentBytes({
        storage: { upload, download },
        ownerId: administratorId,
        documentId,
        intendedStoragePath,
        bytes,
        byteCount: bytes.byteLength,
        contentSha256,
        contentType: "application/pdf",
        createRecoveryId: () => recoveryId,
      }),
    ).rejects.toMatchObject({ kind: "collision_mismatch", storagePath: null });
    expect(upload).toHaveBeenCalledOnce();
  });

  it("retains an ambiguously attempted path without speculative download or retry", async () => {
    const upload = vi.fn(async () => ({ data: null, error: { status: 503, statusCode: "503" } }));
    const download = vi.fn();
    const result = await uploadTrustedDocumentBytes({
      storage: { upload, download },
      ownerId: administratorId,
      documentId,
      intendedStoragePath,
      bytes,
      byteCount: bytes.byteLength,
      contentSha256,
      contentType: "application/pdf",
    }).catch((error: unknown) => error);

    expect(result).toBeInstanceOf(TrustedDocumentStorageUploadError);
    expect(result).toMatchObject({ kind: "outcome_unknown", storagePath: intendedStoragePath });
    expect(upload).toHaveBeenCalledOnce();
    expect(download).not.toHaveBeenCalled();
  });
});
