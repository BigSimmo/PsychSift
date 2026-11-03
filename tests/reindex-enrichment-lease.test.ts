import { afterEach, describe, expect, it, vi } from "vitest";

const documentId = "11111111-1111-4111-8111-111111111111";
const otherDocumentId = "33333333-3333-4333-8333-333333333333";
const userId = "22222222-2222-4222-8222-222222222222";

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

function readySafety() {
  return {
    ok: true as const,
    checkedAt: "2026-07-24T00:00:00.000Z",
    reason: "ready" as const,
    message: "safe",
    activeJobs: [] as [],
    staleProcessingJobs: [] as [],
  };
}

function documentRow(id = documentId) {
  return {
    id,
    owner_id: userId,
    title: "Lease Guard Protocol",
    file_name: "lease-guard.pdf",
    source_path: null,
    import_batch_id: null,
    status: "indexed",
    error_message: null,
    page_count: 2,
    chunk_count: 4,
    image_count: 0,
    metadata: {},
  };
}

function mockAuthenticatedAdmin() {
  vi.doMock("@/lib/supabase/auth", () => ({
    AuthenticationError: class AuthenticationError extends Error {},
    requireAuthenticatedUser: vi.fn(async () => ({ id: userId })),
    unauthorizedResponse: vi.fn(),
  }));
}

describe("reindex enrichment-lease gate (#052)", () => {
  it("blocks full single-document reindex while a fresh agent enrichment lease is live", async () => {
    const rpc = vi.fn();
    const from = vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(async () => ({ data: documentRow(), error: null })),
      update: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
    }));
    const checkIngestionMutationSafety = vi.fn(async () => readySafety());
    const hasActiveAgentEnrichmentJob = vi.fn(async () => true);

    vi.doMock("@/lib/env", () => ({
      env: { WORKER_STALE_AFTER_MINUTES: 15, WORKER_MAX_ATTEMPTS: 3 },
      isDemoMode: () => false,
    }));
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from, rpc }) }));
    mockAuthenticatedAdmin();
    vi.doMock("@/lib/api-rate-limit", () => ({
      consumeApiRateLimit: vi.fn(async () => ({ limited: false })),
      rateLimitJsonResponse: vi.fn(),
    }));
    vi.doMock("@/lib/ingestion-mutation-safety", () => ({
      checkIngestionMutationSafety,
      hasActiveAgentEnrichmentJob,
      ingestionMutationSafetyPayload: vi.fn((safety) => ({ error: safety.message, safety })),
      activeIngestionJobColumns: "id",
      buildActiveJobsSafetyResult: vi.fn(),
      ingestionRollbackFenceStamp: vi.fn(() => "2026-07-24T00:00:00.000000Z"),
    }));

    const { POST } = await import("../src/app/api/documents/[id]/reindex/route");
    const response = await POST(
      new Request(`http://localhost/api/documents/${documentId}/reindex`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "full" }),
      }),
      { params: Promise.resolve({ id: documentId }) },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "Reindex is paused while enrichment is active." });
    expect(hasActiveAgentEnrichmentJob).toHaveBeenCalledWith(expect.objectContaining({ documentId }));
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does not consult the enrichment lease gate for enrichment-mode reindex", async () => {
    const rpc = vi.fn(async () => ({ data: { job_id: "enrichment-job" }, error: null }));
    const from = vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(async () => ({ data: documentRow(), error: null })),
    }));
    const checkIngestionMutationSafety = vi.fn(async () => readySafety());
    const hasActiveAgentEnrichmentJob = vi.fn(async () => true);

    vi.doMock("@/lib/env", () => ({
      env: { WORKER_STALE_AFTER_MINUTES: 15, WORKER_MAX_ATTEMPTS: 3 },
      isDemoMode: () => false,
    }));
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from, rpc }) }));
    mockAuthenticatedAdmin();
    vi.doMock("@/lib/api-rate-limit", () => ({
      consumeApiRateLimit: vi.fn(async () => ({ limited: false })),
      rateLimitJsonResponse: vi.fn(),
    }));
    vi.doMock("@/lib/ingestion-mutation-safety", () => ({
      checkIngestionMutationSafety,
      hasActiveAgentEnrichmentJob,
      ingestionMutationSafetyPayload: vi.fn((safety) => ({ error: safety.message, safety })),
      activeIngestionJobColumns: "id",
      buildActiveJobsSafetyResult: vi.fn(),
      ingestionRollbackFenceStamp: vi.fn(() => "2026-07-24T00:00:00.000000Z"),
    }));

    const { POST } = await import("../src/app/api/documents/[id]/reindex/route");
    const response = await POST(
      new Request(`http://localhost/api/documents/${documentId}/reindex`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "enrichment" }),
      }),
      { params: Promise.resolve({ id: documentId }) },
    );

    expect(response.status).toBe(202);
    expect(hasActiveAgentEnrichmentJob).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "request_indexing_v3_enrichment",
      expect.objectContaining({ p_document_id: documentId, p_owner_id: userId }),
    );
  });

  it("returns per-document results when one selected document has a fresh enrichment lease", async () => {
    const rpc = vi.fn(async (_name: string, args: { p_document_id: string }) => ({
      data: { outcome: "queued", job: { id: `job-${args.p_document_id}` } },
      error: null,
    }));
    const documentsQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      in: vi.fn(async () => ({
        data: [documentRow(documentId), documentRow(otherDocumentId)],
        error: null,
      })),
    };
    documentsQuery.select.mockReturnValue(documentsQuery);
    documentsQuery.eq.mockReturnValue(documentsQuery);
    const from = vi.fn(() => documentsQuery);

    const checkIngestionMutationSafety = vi.fn(async () => readySafety());
    const listDocumentsWithActiveAgentEnrichment = vi.fn(async () => [documentId]);

    vi.doMock("@/lib/env", () => ({
      env: { WORKER_STALE_AFTER_MINUTES: 15, WORKER_MAX_ATTEMPTS: 3 },
      isDemoMode: () => false,
    }));
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from, rpc }) }));
    mockAuthenticatedAdmin();
    vi.doMock("@/lib/api-rate-limit", () => ({
      consumeApiRateLimit: vi.fn(async () => ({ limited: false })),
      rateLimitJsonResponse: vi.fn(),
    }));
    vi.doMock("@/lib/ingestion-mutation-safety", () => ({
      checkIngestionMutationSafety,
      listDocumentsWithActiveAgentEnrichment,
      ingestionMutationSafetyPayload: vi.fn((safety) => ({ error: safety.message, safety })),
      activeIngestionJobColumns: "id",
      buildActiveJobsSafetyResult: vi.fn(),
      ingestionRollbackFenceStamp: vi.fn(() => "2026-07-24T00:00:00.000000Z"),
    }));
    vi.doMock("@/lib/rag/rag", () => ({ invalidateRagCachesForOwner: vi.fn() }));

    const { POST } = await import("../src/app/api/documents/bulk/reindex/route");
    const response = await POST(
      new Request("http://localhost/api/documents/bulk/reindex", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documentIds: [documentId, otherDocumentId], mode: "full" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: false,
      results: [
        {
          documentId,
          mode: "full",
          ok: false,
          error: "Reindex paused while enrichment is active.",
        },
        {
          documentId: otherDocumentId,
          mode: "full",
          ok: true,
          jobId: `job-${otherDocumentId}`,
        },
      ],
      missingDocumentIds: [],
    });
    expect(checkIngestionMutationSafety).toHaveBeenCalledWith(
      expect.objectContaining({ checkActiveAgentEnrichmentJobs: false }),
    );
    expect(listDocumentsWithActiveAgentEnrichment).toHaveBeenCalledWith(
      expect.objectContaining({ documentIds: expect.arrayContaining([documentId, otherDocumentId]) }),
    );
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "request_ingestion_reindex_if_agent_idle",
      expect.objectContaining({ p_document_id: otherDocumentId }),
    );
  });

  it("keeps bulk enrichment mode free of the full-reindex lease preflight", async () => {
    const rpc = vi.fn(async () => ({ data: { job_id: "enrichment-job" }, error: null }));
    const documentsQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      in: vi.fn(async () => ({ data: [documentRow()], error: null })),
    };
    documentsQuery.select.mockReturnValue(documentsQuery);
    documentsQuery.eq.mockReturnValue(documentsQuery);
    const from = vi.fn(() => documentsQuery);
    const checkIngestionMutationSafety = vi.fn(async () => readySafety());
    const listDocumentsWithActiveAgentEnrichment = vi.fn(async () => [documentId]);

    vi.doMock("@/lib/env", () => ({
      env: { WORKER_STALE_AFTER_MINUTES: 15, WORKER_MAX_ATTEMPTS: 3 },
      isDemoMode: () => false,
    }));
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from, rpc }) }));
    mockAuthenticatedAdmin();
    vi.doMock("@/lib/api-rate-limit", () => ({
      consumeApiRateLimit: vi.fn(async () => ({ limited: false })),
      rateLimitJsonResponse: vi.fn(),
    }));
    vi.doMock("@/lib/ingestion-mutation-safety", () => ({
      checkIngestionMutationSafety,
      listDocumentsWithActiveAgentEnrichment,
      ingestionMutationSafetyPayload: vi.fn((safety) => ({ error: safety.message, safety })),
      activeIngestionJobColumns: "id",
      buildActiveJobsSafetyResult: vi.fn(),
      ingestionRollbackFenceStamp: vi.fn(() => "2026-07-24T00:00:00.000000Z"),
    }));
    vi.doMock("@/lib/rag/rag", () => ({ invalidateRagCachesForOwner: vi.fn() }));

    const { POST } = await import("../src/app/api/documents/bulk/reindex/route");
    const response = await POST(
      new Request("http://localhost/api/documents/bulk/reindex", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documentIds: [documentId], mode: "enrichment" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(listDocumentsWithActiveAgentEnrichment).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "request_indexing_v3_enrichment",
      expect.objectContaining({ p_document_id: documentId }),
    );
  });

  it("scopes retry_failed enrichment lease checks to failed documents only", async () => {
    const failedId = documentId;
    const indexedLeasedId = otherDocumentId;
    const rpc = vi.fn();
    const documentsQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      in: vi.fn(async () => ({
        data: [
          { ...documentRow(failedId), status: "failed" },
          { ...documentRow(indexedLeasedId), status: "indexed" },
        ],
        error: null,
      })),
    };
    documentsQuery.select.mockReturnValue(documentsQuery);
    documentsQuery.eq.mockReturnValue(documentsQuery);

    const from = vi.fn((table: string) => {
      if (table === "documents") {
        return {
          ...documentsQuery,
          update: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn(async () => ({ data: { id: failedId }, error: null })),
          })),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn(async () => ({ data: [], error: null })),
        insert: vi.fn(async () => ({ data: [{ id: "job-1" }], error: null })),
      };
    });

    const checkIngestionMutationSafety = vi.fn(async () => readySafety());
    const listDocumentsWithActiveAgentEnrichment = vi.fn(async () => []);

    vi.doMock("@/lib/env", () => ({
      env: { WORKER_STALE_AFTER_MINUTES: 15, WORKER_MAX_ATTEMPTS: 3 },
      isDemoMode: () => false,
    }));
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from, rpc }) }));
    mockAuthenticatedAdmin();
    vi.doMock("@/lib/api-rate-limit", () => ({
      consumeApiRateLimit: vi.fn(async () => ({ limited: false })),
      rateLimitJsonResponse: vi.fn(),
    }));
    vi.doMock("@/lib/ingestion-mutation-safety", () => ({
      checkIngestionMutationSafety,
      listDocumentsWithActiveAgentEnrichment,
      ingestionMutationSafetyPayload: vi.fn((safety) => ({ error: safety.message, safety })),
      activeIngestionJobColumns: "id",
      buildActiveJobsSafetyResult: vi.fn(),
      ingestionRollbackFenceStamp: vi.fn(() => "2026-07-24T00:00:00.000000Z"),
    }));
    vi.doMock("@/lib/rag/rag", () => ({ invalidateRagCachesForOwner: vi.fn() }));
    vi.doMock("@/lib/reindex-pipeline", () => ({ isAtomicReindexCandidate: () => true }));

    const { POST } = await import("../src/app/api/documents/bulk/reindex/route");
    const response = await POST(
      new Request("http://localhost/api/documents/bulk/reindex", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documentIds: [failedId, indexedLeasedId], mode: "retry_failed" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(listDocumentsWithActiveAgentEnrichment).toHaveBeenCalledWith(
      expect.objectContaining({ documentIds: [failedId] }),
    );
    const body = await response.json();
    expect(body.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ documentId: indexedLeasedId, ok: false, error: "Document is not failed." }),
      ]),
    );
  });
});
