import { afterEach, describe, expect, it, vi } from "vitest";

const documentId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const otherUserId = "33333333-3333-4333-8333-333333333333";
const policyVersion = "bmj-third-party-reference-attestation-v1";

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

function request(body: unknown) {
  return new Request(`http://localhost/api/documents/${documentId}/reviews`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function documentQuery(status = "indexed", ownerId: string | null = userId, metadata: Record<string, unknown> = {}) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    or: vi.fn(),
    maybeSingle: vi.fn(async () => ({ data: { id: documentId, status, owner_id: ownerId, metadata }, error: null })),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.or.mockReturnValue(query);
  return query;
}

function mockAuthenticatedUser(
  requireRecentAdministratorAssurance: (...args: unknown[]) => Promise<void> = vi.fn(async () => undefined),
) {
  const requireAuthenticatedUser = vi.fn(async () => ({ id: userId }));
  vi.doMock("@/lib/supabase/auth", () => ({
    AuthenticationError: class AuthenticationError extends Error {},
    requireAuthenticatedUser,
    unauthorizedResponse: vi.fn(),
  }));
  vi.doMock("@/lib/supabase/admin-assurance", () => ({ requireRecentAdministratorAssurance }));
  return requireAuthenticatedUser;
}

const bmjMetadata = {
  publisher_code: "BMJ",
  publisher: "BMJ Best Practice",
  jurisdiction: "International",
  document_status: "current",
  clinical_validation_status: "unverified",
  review_date: "2025-12-31",
};

describe("source review route", () => {
  it("requires recent administrator MFA before reading the document or recording a review", async () => {
    const rpc = vi.fn();
    const from = vi.fn(() => documentQuery("indexed", null));
    const consumeApiRateLimit = vi.fn(async () => ({ limited: false }));
    const { PublicApiError } = await import("../src/lib/http");
    const requireRecentAdministratorAssurance = vi.fn(async () => {
      throw new PublicApiError("Recent multi-factor administrator authentication is required.", 403, {
        code: "administrator_assurance_required",
      });
    });
    vi.doMock("@/lib/env", () => ({ env: { WORKER_STALE_AFTER_MINUTES: 15 }, isDemoMode: () => false }));
    const client = { from, rpc };
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => client }));
    mockAuthenticatedUser(requireRecentAdministratorAssurance);
    vi.doMock("@/lib/api-rate-limit", () => ({ consumeApiRateLimit, rateLimitJsonResponse: vi.fn() }));

    const { POST } = await import("../src/app/api/documents/[id]/reviews/route");
    const response = await POST(request({ decision: "decommissioned", reason: "Withdrawn by the publisher" }), {
      params: Promise.resolve({ id: documentId }),
    });

    expect(response.status).toBe(403);
    expect(requireRecentAdministratorAssurance).toHaveBeenCalledWith(expect.any(Request), client, userId);
    expect(consumeApiRateLimit).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects approval without evidence", async () => {
    vi.doMock("@/lib/env", () => ({ env: { WORKER_STALE_AFTER_MINUTES: 15 }, isDemoMode: () => false }));
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
    mockAuthenticatedUser();
    const { POST } = await import("../src/app/api/documents/[id]/reviews/route");
    const response = await POST(request({ decision: "approved", reason: "Reviewed source" }), {
      params: Promise.resolve({ id: documentId }),
    });
    expect(response.status).toBe(400);
  });

  it("rejects future and invalid calendar review dates", async () => {
    vi.doMock("@/lib/env", () => ({ env: { WORKER_STALE_AFTER_MINUTES: 15 }, isDemoMode: () => false }));
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
    mockAuthenticatedUser();

    const { POST } = await import("../src/app/api/documents/[id]/reviews/route");
    for (const reviewDate of ["2999-01-01", "2026-02-30"]) {
      const response = await POST(
        request({
          decision: "approved",
          reason: "Reviewed against the signed local policy",
          evidenceReferences: ["policy-signoff-2026-07"],
          reviewDate,
        }),
        { params: Promise.resolve({ id: documentId }) },
      );
      expect(response.status).toBe(400);
    }
  });

  it("rejects source promotion before indexing completes", async () => {
    const rpc = vi.fn();
    const query = documentQuery("processing");
    vi.doMock("@/lib/env", () => ({ env: { WORKER_STALE_AFTER_MINUTES: 15 }, isDemoMode: () => false }));
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({ from: vi.fn(() => query), rpc }),
    }));
    mockAuthenticatedUser();
    vi.doMock("@/lib/api-rate-limit", () => ({
      consumeApiRateLimit: vi.fn(async () => ({ limited: false })),
      rateLimitJsonResponse: vi.fn(),
    }));

    const { POST } = await import("../src/app/api/documents/[id]/reviews/route");
    const response = await POST(
      request({
        decision: "approved",
        reason: "Reviewed against the signed local policy",
        evidenceReferences: ["policy-signoff-2026-07"],
      }),
      { params: Promise.resolve({ id: documentId }) },
    );

    expect(response.status).toBe(409);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("records an evidence-bearing review transaction and then invalidates caches", async () => {
    const rpc = vi.fn(async () => ({ data: { id: "review-1" }, error: null }));
    const invalidateRagCachesForOwner = vi.fn();
    const checkIngestionMutationSafety = vi.fn(async () => ({
      ok: true as const,
      checkedAt: "2026-07-13T00:00:00.000Z",
      reason: "ready" as const,
      message: "safe",
      activeJobs: [] as [],
      staleProcessingJobs: [] as [],
    }));
    const hasActiveAgentEnrichmentJob = vi.fn(async () => false);
    const query = documentQuery();
    vi.doMock("@/lib/env", () => ({ env: { WORKER_STALE_AFTER_MINUTES: 15 }, isDemoMode: () => false }));
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({ from: vi.fn(() => query), rpc }),
    }));
    mockAuthenticatedUser();
    vi.doMock("@/lib/api-rate-limit", () => ({
      consumeApiRateLimit: vi.fn(async () => ({ limited: false })),
      rateLimitJsonResponse: vi.fn(),
    }));
    vi.doMock("@/lib/ingestion-mutation-safety", () => ({
      checkIngestionMutationSafety,
      hasActiveAgentEnrichmentJob,
      ingestionMutationSafetyPayload: vi.fn(),
    }));
    vi.doMock("@/lib/rag/rag", () => ({ invalidateRagCachesForOwner }));

    const { POST } = await import("../src/app/api/documents/[id]/reviews/route");
    const response = await POST(
      request({
        decision: "approved",
        reason: "Reviewed against the signed local policy",
        evidenceReferences: ["policy-signoff-2026-07"],
        reviewDate: "2026-07-11",
      }),
      { params: Promise.resolve({ id: documentId }) },
    );

    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith("record_source_review", expect.objectContaining({ p_reviewer_id: userId }));
    expect(checkIngestionMutationSafety).toHaveBeenCalledWith(expect.objectContaining({ documentIds: [documentId] }));
    expect(hasActiveAgentEnrichmentJob).toHaveBeenCalledWith(expect.objectContaining({ documentId }));
    expect(invalidateRagCachesForOwner).toHaveBeenCalledWith(userId);
  });

  it("allows an administrator to attest an ownerless public BMJ source and invalidates every RAG cache scope", async () => {
    const rpc = vi.fn(async () => ({ data: { id: "review-public" }, error: null }));
    const query = documentQuery("indexed", null, bmjMetadata);
    const invalidateRagCachesForOwner = vi.fn();
    const requireAuthenticatedUser = mockAuthenticatedUser();
    vi.doMock("@/lib/env", () => ({ env: { WORKER_STALE_AFTER_MINUTES: 15 }, isDemoMode: () => false }));
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({ from: vi.fn(() => query), rpc }),
    }));
    vi.doMock("@/lib/api-rate-limit", () => ({
      consumeApiRateLimit: vi.fn(async () => ({ limited: false })),
      rateLimitJsonResponse: vi.fn(),
    }));
    vi.doMock("@/lib/ingestion-mutation-safety", () => ({
      checkIngestionMutationSafety: vi.fn(async () => ({ ok: true })),
      hasActiveAgentEnrichmentJob: vi.fn(async () => false),
      ingestionMutationSafetyPayload: vi.fn(),
    }));
    vi.doMock("@/lib/rag/rag", () => ({ invalidateRagCachesForOwner }));

    const { POST } = await import("../src/app/api/documents/[id]/reviews/route");
    const response = await POST(
      request({
        decision: "third_party_reference_attested",
        reason: "Verified third-party provenance under the current BMJ policy",
        evidenceReferences: ["BMJ subscription and provenance record 2026-07-26"],
        reviewDate: "2026-07-26",
        policyVersion,
        reviewerQualification: "Consultant psychiatrist, FRANZCP",
      }),
      { params: Promise.resolve({ id: documentId }) },
    );

    expect(response.status).toBe(201);
    expect(requireAuthenticatedUser).toHaveBeenCalledWith(expect.any(Request), expect.anything(), {
      administrator: true,
    });
    expect(rpc).toHaveBeenCalledWith("record_source_review_v2", {
      p_document_id: documentId,
      p_reviewer_id: userId,
      p_decision: "third_party_reference_attested",
      p_reason: "Verified third-party provenance under the current BMJ policy",
      p_evidence_references: ["BMJ subscription and provenance record 2026-07-26"],
      p_review_date: "2026-07-26",
      p_replacement_document_id: null,
      p_policy_version: policyVersion,
      p_reviewer_qualification: "Consultant psychiatrist, FRANZCP",
    });
    expect(invalidateRagCachesForOwner).toHaveBeenCalledWith();
  });

  it("fails explicitly when a public review requires the pending v2 migration", async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: {
        code: "PGRST202",
        message: "Could not find the function public.record_source_review_v2 in the schema cache",
      },
    }));
    const query = documentQuery("indexed", null, bmjMetadata);
    const invalidateRagCachesForOwner = vi.fn();
    vi.doMock("@/lib/env", () => ({ env: { WORKER_STALE_AFTER_MINUTES: 15 }, isDemoMode: () => false }));
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({ from: vi.fn(() => query), rpc }),
    }));
    mockAuthenticatedUser();
    vi.doMock("@/lib/api-rate-limit", () => ({
      consumeApiRateLimit: vi.fn(async () => ({ limited: false })),
      rateLimitJsonResponse: vi.fn(),
    }));
    vi.doMock("@/lib/ingestion-mutation-safety", () => ({
      checkIngestionMutationSafety: vi.fn(async () => ({ ok: true })),
      hasActiveAgentEnrichmentJob: vi.fn(async () => false),
      ingestionMutationSafetyPayload: vi.fn(),
    }));
    vi.doMock("@/lib/rag/rag", () => ({ invalidateRagCachesForOwner }));

    const { POST } = await import("../src/app/api/documents/[id]/reviews/route");
    const response = await POST(
      request({
        decision: "third_party_reference_attested",
        reason: "Verified third-party provenance under the current BMJ policy",
        evidenceReferences: ["BMJ subscription and provenance record 2026-07-26"],
        reviewDate: "2026-07-26",
        policyVersion,
        reviewerQualification: "Consultant psychiatrist, FRANZCP",
      }),
      { params: Promise.resolve({ id: documentId }) },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: "source_review_v2_unavailable" });
    expect(rpc).toHaveBeenCalledWith("record_source_review_v2", expect.any(Object));
    expect(invalidateRagCachesForOwner).not.toHaveBeenCalled();
  });

  it("does not invalidate caches when SQL rejects a non-public supersession replacement", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "replacement document not found" } }));
    const query = documentQuery("indexed", null, bmjMetadata);
    const invalidateRagCachesForOwner = vi.fn();
    vi.doMock("@/lib/env", () => ({ env: { WORKER_STALE_AFTER_MINUTES: 15 }, isDemoMode: () => false }));
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({ from: vi.fn(() => query), rpc }),
    }));
    mockAuthenticatedUser();
    vi.doMock("@/lib/api-rate-limit", () => ({
      consumeApiRateLimit: vi.fn(async () => ({ limited: false })),
      rateLimitJsonResponse: vi.fn(),
    }));
    vi.doMock("@/lib/rag/rag", () => ({ invalidateRagCachesForOwner }));

    const { POST } = await import("../src/app/api/documents/[id]/reviews/route");
    const response = await POST(
      request({
        decision: "superseded",
        reason: "Replaced by a newer public source",
        replacementDocumentId: otherUserId,
      }),
      { params: Promise.resolve({ id: documentId }) },
    );

    expect(response.status).toBe(400);
    expect(rpc).toHaveBeenCalledWith(
      "record_source_review_v2",
      expect.objectContaining({ p_document_id: documentId, p_replacement_document_id: otherUserId }),
    );
    expect(invalidateRagCachesForOwner).not.toHaveBeenCalled();
  });

  it.each([
    ["review date", { reviewDate: null, reviewerQualification: "Consultant psychiatrist, FRANZCP" }],
    ["reviewer qualification", { reviewDate: "2026-07-26", reviewerQualification: "" }],
  ])("rejects ownerless public local promotion without %s", async (label, reviewEvidence) => {
    const rpc = vi.fn();
    const query = documentQuery("indexed", null, {
      publisher_code: "NMHS",
      publisher: "North Metropolitan Health Service",
      jurisdiction: "Australia/WA",
      document_status: "review_due",
      clinical_validation_status: "locally_reviewed",
    });
    vi.doMock("@/lib/env", () => ({ env: { WORKER_STALE_AFTER_MINUTES: 15 }, isDemoMode: () => false }));
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: vi.fn(() => query), rpc }) }));
    mockAuthenticatedUser();
    vi.doMock("@/lib/api-rate-limit", () => ({
      consumeApiRateLimit: vi.fn(async () => ({ limited: false })),
      rateLimitJsonResponse: vi.fn(),
    }));

    const { POST } = await import("../src/app/api/documents/[id]/reviews/route");
    const response = await POST(
      request({
        decision: "locally_reviewed",
        reason: "Qualified review of current public guidance",
        evidenceReferences: ["signed-review-record-2026-07-26"],
        ...reviewEvidence,
      }),
      { params: Promise.resolve({ id: documentId }) },
    );

    expect(response.status, label).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "public_source_review_incomplete" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns not found for another user's private document before calling the v2 RPC", async () => {
    const rpc = vi.fn();
    const query = documentQuery("indexed", otherUserId, bmjMetadata);
    vi.doMock("@/lib/env", () => ({ env: { WORKER_STALE_AFTER_MINUTES: 15 }, isDemoMode: () => false }));
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: vi.fn(() => query), rpc }) }));
    mockAuthenticatedUser();
    vi.doMock("@/lib/api-rate-limit", () => ({
      consumeApiRateLimit: vi.fn(async () => ({ limited: false })),
      rateLimitJsonResponse: vi.fn(),
    }));

    const { POST } = await import("../src/app/api/documents/[id]/reviews/route");
    const response = await POST(request({ decision: "rejected", reason: "Source is not suitable for this corpus" }), {
      params: Promise.resolve({ id: documentId }),
    });

    expect(response.status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects non-BMJ or conflicting authority metadata before recording an attestation", async () => {
    const rpc = vi.fn();
    const query = documentQuery("indexed", null, {
      ...bmjMetadata,
      publisher: "Example Publisher",
    });
    vi.doMock("@/lib/env", () => ({ env: { WORKER_STALE_AFTER_MINUTES: 15 }, isDemoMode: () => false }));
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: vi.fn(() => query), rpc }) }));
    mockAuthenticatedUser();
    vi.doMock("@/lib/api-rate-limit", () => ({
      consumeApiRateLimit: vi.fn(async () => ({ limited: false })),
      rateLimitJsonResponse: vi.fn(),
    }));

    const { POST } = await import("../src/app/api/documents/[id]/reviews/route");
    const response = await POST(
      request({
        decision: "third_party_reference_attested",
        reason: "Attempted third-party source attestation",
        evidenceReferences: ["evidence"],
        reviewDate: "2026-07-26",
        policyVersion,
        reviewerQualification: "FRANZCP",
      }),
      { params: Promise.resolve({ id: documentId }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "bmj_attestation_ineligible" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["evidence", { evidenceReferences: [] }],
    ["date", { reviewDate: null }],
    ["policy", { policyVersion: "legacy-policy" }],
    ["qualification", { reviewerQualification: "" }],
  ])("rejects an incomplete BMJ attestation missing current %s", async (label, override) => {
    vi.doMock("@/lib/env", () => ({ env: { WORKER_STALE_AFTER_MINUTES: 15 }, isDemoMode: () => false }));
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
    mockAuthenticatedUser();
    const { POST } = await import("../src/app/api/documents/[id]/reviews/route");
    const response = await POST(
      request({
        decision: "third_party_reference_attested",
        reason: "Third-party provenance review",
        evidenceReferences: ["evidence"],
        reviewDate: "2026-07-26",
        policyVersion,
        reviewerQualification: "FRANZCP",
        ...override,
      }),
      { params: Promise.resolve({ id: documentId }) },
    );
    expect(response.status, label).toBe(400);
  });
});
