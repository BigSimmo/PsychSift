import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const id = "11111111-1111-4111-8111-111111111111",
  administratorId = "22222222-2222-4222-8222-222222222222";
const correlationId = "33333333-3333-4333-8333-333333333333",
  jobId = "44444444-4444-4444-8444-444444444444";
const admissionEventId = "55555555-5555-4555-8555-555555555555";
afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});
function setup(scope: "private" | "shared" | "other" = "private") {
  const bytes = Buffer.from("%PDF-1.7\nSynthetic current original only\n%%EOF");
  const metadata: Record<string, unknown> = scope === "shared" ? { public_corpus: true } : {};
  const document = {
    id,
    owner_id: scope === "shared" ? null : scope === "other" ? correlationId : administratorId,
    title: "Synthetic reference",
    file_name: "synthetic.pdf",
    file_type: "application/pdf",
    file_size: bytes.length,
    storage_path: "legacy/original.pdf",
    content_hash: createHash("sha256").update(bytes).digest("hex"),
    metadata,
  };
  const filters: Array<[string, unknown]> = [];
  const query = {
    or: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn((key: string, value: unknown) => {
      filters.push([key, value]);
      return query;
    }),
    maybeSingle: vi.fn(async () => ({ data: document, error: null })),
    in: vi.fn(async () => ({ data: [document], error: null })),
  };
  const download = vi.fn(async () => ({ data: new Blob([Uint8Array.from(bytes)]), error: null }));
  const serviceRpc = vi.fn(async () => ({ data: { outcome: "queued", job: { id: jobId } }, error: null }));
  const publicationRpc = vi.fn(async (): Promise<{ data: unknown; error: { message: string } | null }> => ({
    data: {
      outcome: "created",
      jobId,
      admissionEventId,
      scope: scope === "shared" ? "existing_shared_library_stewardship" : "owner_private",
      documentOwnerId: document.owner_id,
      stewardId: administratorId,
      generationActivated: false,
    },
    error: null,
  }));
  const client = { from: vi.fn(() => query), rpc: serviceRpc, storage: { from: vi.fn(() => ({ download })) } };
  const user = { id: administratorId, appMetadata: { site_role: "administrator" } };
  class AuthenticationError extends Error {}
  const requireAuthenticatedUser = vi.fn(async () => user);
  const requireAuthenticatedUserContext = vi.fn(async () => ({ user, publicationClient: { rpc: publicationRpc } }));
  const safety = vi.fn(async () => ({ ok: true, status: 200, activeJobs: [], staleProcessingJobs: [] }));
  vi.doMock("@/lib/env", () => ({
    env: { WORKER_STALE_AFTER_MINUTES: 15, WORKER_MAX_ATTEMPTS: 3, SUPABASE_DOCUMENT_BUCKET: "clinical-documents" },
    isDemoMode: () => false,
  }));
  vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => client }));
  vi.doMock("@/lib/supabase/auth", () => ({
    AuthenticationError,
    requireAuthenticatedUser,
    requireAuthenticatedUserContext,
    unauthorizedResponse: () => new Response(JSON.stringify({ code: "authentication_required" }), { status: 401 }),
  }));
  vi.doMock("@/lib/api-rate-limit", () => ({
    consumeApiRateLimit: vi.fn(async () => ({ limited: false })),
    rateLimitJsonResponse: vi.fn(),
  }));
  vi.doMock("@/lib/ingestion-mutation-safety", () => ({
    checkIngestionMutationSafety: safety,
    hasActiveAgentEnrichmentJob: vi.fn(async () => false),
    ingestionMutationSafetyPayload: vi.fn(),
    activeIngestionJobColumns: "id",
    buildActiveJobsSafetyResult: vi.fn(),
    listDocumentsWithActiveAgentEnrichment: vi.fn(async () => []),
  }));
  vi.doMock("@/lib/rag/rag", () => ({ invalidateRagCachesForOwner: vi.fn() }));
  const authority = {
    version: 1,
    sourceRole: "service_policy",
    authorityBasis: "administrator_template",
    licencePolicy: "review_required",
    rightsEvidenceRef: "explicit current administrator declaration; legal review pending",
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
  const body = { mode: "full", readmission: { correlationId, authority } };
  const invoke = async (
    payload: unknown = body,
    headers: Record<string, string> = { authorization: "Bearer synthetic-token" },
  ) => {
    const { POST } = await import("../src/app/api/documents/[id]/reindex/route");
    const request = new Request(`http://localhost/api/documents/${id}/reindex`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(payload),
    });
    return POST(request, { params: Promise.resolve({ id }) });
  };
  const invokeBulk = async (mode = "full") => {
    const { POST } = await import("../src/app/api/documents/bulk/reindex/route");
    return POST(
      new Request("http://localhost/api/documents/bulk/reindex", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documentIds: [id], mode }),
      }),
    );
  };
  return {
    bytes,
    document,
    filters,
    query,
    download,
    serviceRpc,
    publicationRpc,
    client,
    requireAuthenticatedUserContext,
    AuthenticationError,
    body,
    invoke,
    invokeBulk,
    safety,
  };
}

describe("administrator PDF reindex current readmission", () => {
  it("holds bulk full PDF queuing with an explicit per-document current-readmission result", async () => {
    const f = setup();
    const response = await f.invokeBulk();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      ok: false,
      results: [{ documentId: id, ok: false, status: 409, code: "readmission_required" }],
    });
    expect(f.serviceRpc).not.toHaveBeenCalled();
  });
  it.each(["bearer", "cookie"])(
    "uses the current %s publication client and verifies the private original before the one atomic queue RPC",
    async (auth) => {
      const f = setup();
      const headers: Record<string, string> =
        auth === "cookie" ? { cookie: "sb-project-auth-token=synthetic" } : { authorization: "Bearer synthetic-token" };
      const response = await f.invoke(f.body, headers);
      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({
        job: { id: jobId },
        readmission: { admissionEventId, outcome: "created" },
        generationActivated: false,
      });
      expect(f.publicationRpc).toHaveBeenCalledExactlyOnceWith(
        "readmit_administrator_document_for_reindex",
        expect.objectContaining({
          p_document_id: id,
          p_correlation_id: correlationId,
          p_expected_owner_id: administratorId,
          p_expected_public_corpus: false,
          p_source_sha256: `sha256:${f.document.content_hash}`,
          p_byte_count: f.bytes.length,
          p_authority: f.body.readmission.authority,
        }),
      );
      expect(f.download).toHaveBeenCalledWith(f.document.storage_path);
      expect(f.serviceRpc).not.toHaveBeenCalled();
      expect(f.requireAuthenticatedUserContext).toHaveBeenCalledWith(expect.any(Request), f.client, {
        administrator: true,
      });
    },
  );
  it("permits explicit stewardship only of the actual existing shared-library row and preserves null ownership", async () => {
    const f = setup("shared");
    const response = await f.invoke();
    expect(response.status).toBe(201);
    expect(f.publicationRpc).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ p_expected_owner_id: null, p_expected_public_corpus: true }),
    );
    expect(f.filters).not.toContainEqual(["owner_id", administratorId]);
    expect(f.query.or).toHaveBeenCalledWith(
      `owner_id.eq.${administratorId},and(owner_id.is.null,metadata->>public_corpus.eq.true)`,
    );
  });
  it("holds ordinary full PDF reindex before the legacy queue while preserving enrichment mode", async () => {
    const f = setup();
    const held = await f.invoke({ mode: "full" });
    expect(held.status).toBe(409);
    expect(await held.json()).toMatchObject({ code: "readmission_required" });
    expect(f.serviceRpc).not.toHaveBeenCalled();
    expect(f.publicationRpc).not.toHaveBeenCalled();
    expect(f.filters).toContainEqual(["owner_id", administratorId]);
    const enrichment = await f.invoke({ mode: "enrichment" });
    expect(enrichment.status).toBe(202);
    expect(f.serviceRpc).toHaveBeenCalledWith("request_indexing_v3_enrichment", {
      p_document_id: id,
      p_owner_id: administratorId,
    });
  });
  it.each([
    ["shared", "full"],
    ["shared", "enrichment"],
    ["other", "full"],
    ["other", "enrichment"],
  ] as const)("refuses ordinary %s document %s reindex before any mutation or child-job read", async (scope, mode) => {
    const f = setup(scope);
    const response = await f.invoke({ mode });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "document_not_found" });
    expect(f.filters).toContainEqual(["owner_id", administratorId]);
    expect(f.safety).not.toHaveBeenCalled();
    expect(f.client.from).not.toHaveBeenCalledWith("ingestion_jobs");
    expect(f.download).not.toHaveBeenCalled();
    expect(f.serviceRpc).not.toHaveBeenCalled();
    expect(f.publicationRpc).not.toHaveBeenCalled();
  });
  it.each(["other", "unmarked-ownerless"])(
    "refuses %s ownership without reading storage or creating an admission",
    async (scope) => {
      const f = setup(scope === "other" ? "other" : "shared");
      if (scope === "unmarked-ownerless") delete f.document.metadata.public_corpus;
      const response = await f.invoke();
      expect(response.status).toBe(404);
      expect(f.download).not.toHaveBeenCalled();
      expect(f.publicationRpc).not.toHaveBeenCalled();
      expect(f.serviceRpc).not.toHaveBeenCalled();
    },
  );
  it("refuses malformed explicit readmission instead of silently falling through to the old full queue", async () => {
    const f = setup();
    const response = await f.invoke({ mode: "full", readmission: { correlationId } });
    expect(response.status).toBe(400);
    expect(f.serviceRpc).not.toHaveBeenCalled();
    expect(f.publicationRpc).not.toHaveBeenCalled();
  });
  it("refuses original byte substitution before the authenticated mutation", async () => {
    const f = setup();
    f.download.mockResolvedValueOnce({ data: new Blob([Uint8Array.from(Buffer.alloc(f.bytes.length))]), error: null });
    const response = await f.invoke();
    expect(response.status).toBe(409);
    expect(f.publicationRpc).not.toHaveBeenCalled();
  });
  it("keeps readmission replay with the same correlation ID on the one authenticated atomic RPC", async () => {
    const f = setup();
    f.publicationRpc.mockResolvedValueOnce({
      data: {
        outcome: "replayed",
        jobId,
        admissionEventId,
        scope: "owner_private",
        documentOwnerId: administratorId,
        stewardId: administratorId,
      },
      error: null,
    });
    const response = await f.invoke();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ readmission: { outcome: "replayed" }, job: { id: jobId } });
    expect(f.publicationRpc).toHaveBeenCalledTimes(1);
    expect(f.serviceRpc).not.toHaveBeenCalled();
    expect(f.safety).not.toHaveBeenCalled();
  });
  it("surfaces the database's fresh MFA refusal without falling back to service-role queuing", async () => {
    const f = setup();
    f.publicationRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "administrator_recent_authentication_required" },
    });
    const response = await f.invoke();
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "readmission_assurance_required" });
    expect(f.serviceRpc).not.toHaveBeenCalled();
  });
  it("refuses missing current request authentication before storage or mutation", async () => {
    const f = setup();
    f.requireAuthenticatedUserContext.mockRejectedValueOnce(new f.AuthenticationError());
    const response = await f.invoke();
    expect(response.status).toBe(401);
    expect(f.download).not.toHaveBeenCalled();
    expect(f.publicationRpc).not.toHaveBeenCalled();
    expect(f.serviceRpc).not.toHaveBeenCalled();
  });
  it("does not accept a mutation response that changes document ownership", async () => {
    const f = setup();
    f.publicationRpc.mockResolvedValueOnce({
      data: {
        outcome: "created",
        jobId,
        admissionEventId,
        scope: "owner_private",
        documentOwnerId: correlationId,
        stewardId: administratorId,
        generationActivated: false,
      },
      error: null,
    });
    const response = await f.invoke();
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: "readmission_result_unverified" });
    expect(f.serviceRpc).not.toHaveBeenCalled();
  });
  it("refuses enrichment plus readmission intent instead of changing the requested operation", async () => {
    const f = setup();
    const response = await f.invoke({ ...f.body, mode: "enrichment" });
    expect(response.status).toBe(400);
    expect(f.download).not.toHaveBeenCalled();
    expect(f.publicationRpc).not.toHaveBeenCalled();
    expect(f.serviceRpc).not.toHaveBeenCalled();
  });
});
