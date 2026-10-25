import { afterEach, describe, expect, it, vi } from "vitest";

const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const documentId = "22222222-2222-4222-8222-222222222222";
const validChunkId = "11111111-1111-4111-8111-111111111111";
const unownedChunkId = "33333333-3333-4333-8333-333333333333";
const unownedDocumentId = "44444444-4444-4444-8444-444444444444";
const ownedFileName = "CG.MHSP.ClozapinePresAdminMonitor.pdf";

function request(body: unknown) {
  return new Request("http://localhost/api/eval-cases", {
    method: "POST",
    headers: { "Content-Type": "application/json", authorization: "Bearer valid-token" },
    body: JSON.stringify(body),
  });
}

type SelectFilters = Record<string, unknown>;

/**
 * Minimal PostgREST builder double. `maybeSingle()` answers the single-row lookups; awaiting the
 * builder itself answers the batched `.in()` lookups the ownership filter uses.
 */
function createSelectMock<T>(
  resolver: (filters: SelectFilters) => T | null,
  listResolver?: (filters: SelectFilters) => unknown[],
) {
  const filters: SelectFilters = {};
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn((column: string, value: unknown) => {
      filters[column] = value;
      return builder;
    }),
    in: vi.fn((column: string, values: unknown[]) => {
      filters[`in:${column}`] = values;
      return builder;
    }),
    is: vi.fn((column: string, value: null) => {
      filters[`is:${column}`] = value;
      return builder;
    }),
    or: vi.fn((expression: string) => {
      filters.or = expression;
      return builder;
    }),
    maybeSingle: vi.fn(async () => ({ data: resolver(filters), error: null })),
    then: (onFulfilled: (value: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({ data: listResolver ? listResolver(filters) : [], error: null }).then(onFulfilled),
  };
  return builder;
}

function createInsertMock(
  options: {
    ownedDocumentIds?: string[];
    publicDocumentIds?: string[];
    ownedChunks?: Record<string, string>;
    documentFileNames?: Record<string, string>;
  } = {},
) {
  // Mirrors withOwnerReadScope: a row is readable when the filter admits the caller's owned rows
  // or the published public corpus (owner_id null).
  const ownerScopeAdmits = (filters: SelectFilters) =>
    filters.owner_id === userId || String(filters.or ?? "").includes(`owner_id.eq.${userId}`);
  const publicScopeAdmits = (filters: SelectFilters) => String(filters.or ?? "").includes("owner_id.is.null");
  const insert = vi.fn((payload: unknown) => ({
    select: vi.fn(() => ({
      single: vi.fn(async () => ({ data: { id: "capture-1" }, error: null })),
    })),
    payload,
  }));
  return {
    insert,
    client: {
      from: vi.fn((table: string) => {
        const ownedDocumentIds = options.ownedDocumentIds ?? [documentId];
        const publicDocumentIds = options.publicDocumentIds ?? [];
        const documentFileNames = options.documentFileNames ?? { [documentId]: ownedFileName };
        const chunkDocument = (id: string) => options.ownedChunks?.[id] ?? (id === validChunkId ? documentId : null);
        const readableDocumentIds = (filters: SelectFilters) => [
          ...(ownerScopeAdmits(filters) ? ownedDocumentIds : []),
          ...(publicScopeAdmits(filters) ? publicDocumentIds : []),
        ];
        if (table === "documents") {
          return createSelectMock(
            (filters) => {
              const id = String(filters.id ?? "");
              return readableDocumentIds(filters).includes(id) ? { id } : null;
            },
            (filters) => {
              const requestedIds = (filters["in:id"] as string[] | undefined) ?? null;
              const requestedFileNames = (filters["in:file_name"] as string[] | undefined) ?? null;
              return readableDocumentIds(filters)
                .filter((id) => (requestedIds ? requestedIds.includes(id) : true))
                .map((id) => ({ id, file_name: documentFileNames[id] ?? null }))
                .filter((row) =>
                  requestedFileNames ? row.file_name !== null && requestedFileNames.includes(row.file_name) : true,
                );
            },
          );
        }
        if (table === "document_chunks") {
          return createSelectMock(
            (filters) => {
              const id = String(filters.id ?? "");
              const chunkDocumentId = chunkDocument(id);
              return chunkDocumentId ? { id, document_id: chunkDocumentId } : null;
            },
            (filters) => {
              const requestedIds = (filters["in:id"] as string[] | undefined) ?? [];
              return requestedIds
                .map((id) => ({ id, document_id: chunkDocument(id) }))
                .filter((row) => row.document_id !== null);
            },
          );
        }
        expect(table).toBe("rag_query_misses");
        return { insert };
      }),
      // The route consults the ingestion_admin rate limiter before touching tables.
      rpc: vi.fn(async (name: string) =>
        name === "consume_api_rate_limit" || name === "consume_api_subject_rate_limit"
          ? {
              data: [
                {
                  limited: false,
                  limit_value: 60,
                  remaining: 59,
                  retry_after_seconds: 60,
                  reset_at: new Date(Date.now() + 60_000).toISOString(),
                },
              ],
              error: null,
            }
          : { data: [], error: null },
      ),
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

function mockEnv(overrides: Record<string, unknown> = {}) {
  return {
    isDemoMode: () => false,
    env: { RAG_PERSIST_RAW_QUERY_TEXT: false, RAG_PERSIST_ANSWER_TEXT: false, ...overrides },
  };
}

describe("/api/eval-cases", () => {
  it("does not accept a feedback triage nomination as a captured reproducible question", async () => {
    const { client, insert } = createInsertMock();
    vi.doMock("@/lib/env", () => mockEnv());
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => client }));
    const { POST } = await import("../src/app/api/eval-cases/route");
    const response = await POST(
      request({
        interactionId: validChunkId,
        category: "numeric_error",
        requiresDeidentificationReview: true,
        mayAutoPromote: false,
      }),
    );
    expect(response.status).toBe(400);
    expect(insert).not.toHaveBeenCalled();
  });

  it("requires administrator authentication for the separate human capture path", async () => {
    const { client, insert } = createInsertMock();
    class AuthenticationError extends Error {}
    const requireAuthenticatedUser = vi.fn(async () => {
      throw new AuthenticationError();
    });
    vi.doMock("@/lib/env", () => mockEnv());
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => client }));
    vi.doMock("@/lib/supabase/auth", () => ({
      AuthenticationError,
      requireAuthenticatedUser,
      unauthorizedResponse: () => Response.json({ error: "Authentication required." }, { status: 401 }),
    }));
    const { POST } = await import("../src/app/api/eval-cases/route");
    const response = await POST(
      request({ query: "A reviewed, de-identified reproduction", feedbackType: "numeric_error" }),
    );
    expect(response.status).toBe(401);
    expect(requireAuthenticatedUser).toHaveBeenCalledWith(expect.any(Request), client, { administrator: true });
    expect(insert).not.toHaveBeenCalled();
  });

  it("captures a good answer as a promoted eval case and filters malformed chunk ids", async () => {
    const { client, insert } = createInsertMock();
    vi.doMock("@/lib/env", () => mockEnv());
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => client }));
    vi.doMock("@/lib/supabase/auth", () => ({
      AuthenticationError: class AuthenticationError extends Error {},
      requireAuthenticatedUser: vi.fn(async () => ({ id: userId })),
      unauthorizedResponse: () => Response.json({ error: "Authentication required." }, { status: 401 }),
    }));
    const { POST } = await import("../src/app/api/eval-cases/route");

    const response = await POST(
      request({
        query: "What monitoring is needed for clozapine?",
        rating: "good",
        answer: "Monitor FBC.",
        queryMode: "auto",
        queryClass: "table_threshold",
        sourceChunkIds: [validChunkId, "search-cache-row"],
        citedChunkIds: ["not-a-uuid", validChunkId],
        sourceFiles: ["CG.MHSP.ClozapinePresAdminMonitor.pdf", "CG.MHSP.ClozapinePresAdminMonitor.pdf"],
        expectedDocumentId: documentId,
      }),
    );
    const payload = insert.mock.calls[0]?.[0] as Record<string, unknown>;

    expect(response.status).toBe(201);
    expect(payload).toMatchObject({
      owner_id: userId,
      query_class: "table_threshold",
      miss_reason: "answer_good_eval",
      top_files: ["CG.MHSP.ClozapinePresAdminMonitor.pdf"],
      top_chunk_ids: [validChunkId],
      cited_chunk_ids: [validChunkId],
      expected_document_id: documentId,
      expected_chunk_id: validChunkId,
      candidate_aliases: [],
      promoted_eval_case: true,
    });
    expect(payload.query).toMatch(/^redacted-query:[a-f0-9]{64}$/);
    expect(payload.normalized_query).toBe(payload.query);
    expect(String(payload.query)).not.toContain("clozapine");
    expect(payload.metadata).toMatchObject({
      interaction: "answer_eval_capture",
      rating: "good",
      query_class: "table_threshold",
      source_chunk_ids_rejected: 1,
      cited_chunk_ids_rejected: 1,
      answer: null,
      raw_query_retained: false,
    });
    expect(typeof (payload.metadata as Record<string, unknown>).query_hash).toBe("string");
  });

  it("does not persist PHI-capable query text when capturing an eval case", async () => {
    const { client, insert } = createInsertMock();
    vi.doMock("@/lib/env", () => mockEnv());
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => client }));
    vi.doMock("@/lib/supabase/auth", () => ({
      AuthenticationError: class AuthenticationError extends Error {},
      requireAuthenticatedUser: vi.fn(async () => ({ id: userId })),
      unauthorizedResponse: () => Response.json({ error: "Authentication required." }, { status: 401 }),
    }));
    const { POST } = await import("../src/app/api/eval-cases/route");
    const phiQuery = "Patient Jane Citizen MRN 123456 born 01/02/1970 missed clozapine dose";

    const response = await POST(
      request({
        query: phiQuery,
        rating: "needs_fixing",
        answer: "Check local protocol.",
        queryMode: "auto",
        sourceChunkIds: [validChunkId],
        citedChunkIds: [],
      }),
    );
    const payload = insert.mock.calls[0]?.[0] as Record<string, unknown>;
    const serialized = JSON.stringify(payload);

    expect(response.status).toBe(201);
    expect(payload.query).toMatch(/^redacted-query:[a-f0-9]{64}$/);
    expect(payload.normalized_query).toBe(payload.query);
    expect(payload.candidate_aliases).toEqual([]);
    expect(serialized).not.toContain("Jane");
    expect(serialized).not.toContain("123456");
    expect(serialized).not.toContain("01/02/1970");
    expect(serialized).not.toContain("clozapine");
  });

  it("retains raw query and answer when both retention flags are enabled", async () => {
    const { client, insert } = createInsertMock();
    vi.doMock("@/lib/env", () => mockEnv({ RAG_PERSIST_RAW_QUERY_TEXT: true, RAG_PERSIST_ANSWER_TEXT: true }));
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => client }));
    vi.doMock("@/lib/supabase/auth", () => ({
      AuthenticationError: class AuthenticationError extends Error {},
      requireAuthenticatedUser: vi.fn(async () => ({ id: userId })),
      unauthorizedResponse: () => Response.json({ error: "Authentication required." }, { status: 401 }),
    }));
    const { POST } = await import("../src/app/api/eval-cases/route");

    const response = await POST(
      request({
        query: "What monitoring is needed for clozapine?",
        rating: "good",
        answer: "Monitor FBC.",
        queryMode: "auto",
        queryClass: "table_threshold",
        sourceChunkIds: [],
        citedChunkIds: [],
      }),
    );
    const payload = insert.mock.calls[0]?.[0] as Record<string, unknown>;

    expect(response.status).toBe(201);
    expect(payload).toMatchObject({ query: "What monitoring is needed for clozapine?" });
    expect(payload.metadata).toMatchObject({
      answer: "Monitor FBC.",
      raw_query_retained: true,
      answer_retained: true,
    });
  });

  it("gates answer retention on RAG_PERSIST_ANSWER_TEXT independently of the raw-query flag (PIA-3)", async () => {
    const { client, insert } = createInsertMock();
    // Raw query retention on, answer retention off: the query text is kept but the
    // generated answer is still dropped — the two are decoupled.
    vi.doMock("@/lib/env", () => mockEnv({ RAG_PERSIST_RAW_QUERY_TEXT: true }));
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => client }));
    vi.doMock("@/lib/supabase/auth", () => ({
      AuthenticationError: class AuthenticationError extends Error {},
      requireAuthenticatedUser: vi.fn(async () => ({ id: userId })),
      unauthorizedResponse: () => Response.json({ error: "Authentication required." }, { status: 401 }),
    }));
    const { POST } = await import("../src/app/api/eval-cases/route");

    const response = await POST(
      request({
        query: "What monitoring is needed for clozapine?",
        rating: "good",
        answer: "Monitor FBC.",
        queryMode: "auto",
        queryClass: "table_threshold",
        sourceChunkIds: [],
        citedChunkIds: [],
      }),
    );
    const payload = insert.mock.calls[0]?.[0] as Record<string, unknown>;

    expect(response.status).toBe(201);
    expect(payload).toMatchObject({ query: "What monitoring is needed for clozapine?" });
    expect(payload.metadata).toMatchObject({
      answer: null,
      raw_query_retained: true,
      answer_retained: false,
    });
    expect(JSON.stringify(payload.metadata)).not.toContain("Monitor FBC.");
  });

  it("captures a needs-fixing answer without requiring expected UUID fields", async () => {
    const { client, insert } = createInsertMock();
    vi.doMock("@/lib/env", () => mockEnv());
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => client }));
    vi.doMock("@/lib/supabase/auth", () => ({
      AuthenticationError: class AuthenticationError extends Error {},
      requireAuthenticatedUser: vi.fn(async () => ({ id: userId })),
      unauthorizedResponse: () => Response.json({ error: "Authentication required." }, { status: 401 }),
    }));
    const { POST } = await import("../src/app/api/eval-cases/route");

    const response = await POST(
      request({
        query: "Which table covers a missing protocol?",
        rating: "needs_fixing",
        sourceChunkIds: ["generated-row"],
        citedChunkIds: [],
      }),
    );
    const payload = insert.mock.calls[0]?.[0] as Record<string, unknown>;

    expect(response.status).toBe(201);
    expect(payload).toMatchObject({
      miss_reason: "answer_needs_fixing",
      top_chunk_ids: [],
      cited_chunk_ids: [],
      expected_chunk_id: null,
      promoted_eval_case: true,
    });
    expect(payload.metadata).toMatchObject({ rating: "needs_fixing", source_chunk_ids_rejected: 1 });
  });

  it("captures category-specific missed-answer feedback for eval promotion", async () => {
    const { client, insert } = createInsertMock();
    vi.doMock("@/lib/env", () => mockEnv());
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => client }));
    vi.doMock("@/lib/supabase/auth", () => ({
      AuthenticationError: class AuthenticationError extends Error {},
      requireAuthenticatedUser: vi.fn(async () => ({ id: userId })),
      unauthorizedResponse: () => Response.json({ error: "Authentication required." }, { status: 401 }),
    }));
    const { POST } = await import("../src/app/api/eval-cases/route");

    const response = await POST(
      request({
        query: "What ANC threshold should withhold clozapine?",
        feedbackType: "numeric_error",
        answer: "Withhold below 15.",
        queryMode: "dose_threshold_lookup",
        queryClass: "table_threshold",
        sourceChunkIds: [validChunkId],
        citedChunkIds: [validChunkId],
        sourceFiles: ["clozapine.pdf"],
        sourceGovernanceWarnings: ["Source is review due."],
        unverifiedNumericTokens: ["15"],
      }),
    );
    const payload = insert.mock.calls[0]?.[0] as Record<string, unknown>;

    expect(response.status).toBe(201);
    expect(payload).toMatchObject({
      miss_reason: "numeric_error",
      promoted_eval_case: true,
    });
    expect(payload.metadata).toMatchObject({
      rating: "needs_fixing",
      feedback_type: "numeric_error",
      answer: null,
      source_governance_warnings: ["Source is review due."],
      unverified_numeric_tokens: ["15"],
      raw_query_retained: false,
    });
  });

  it("drops chunk ids whose document the caller does not own, and counts them as rejected", async () => {
    const { client, insert } = createInsertMock({
      ownedChunks: { [validChunkId]: documentId, [unownedChunkId]: unownedDocumentId },
    });
    vi.doMock("@/lib/env", () => mockEnv());
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => client }));
    vi.doMock("@/lib/supabase/auth", () => ({
      AuthenticationError: class AuthenticationError extends Error {},
      requireAuthenticatedUser: vi.fn(async () => ({ id: userId })),
      unauthorizedResponse: () => Response.json({ error: "Authentication required." }, { status: 401 }),
    }));
    const { POST } = await import("../src/app/api/eval-cases/route");

    const response = await POST(
      request({
        query: "Which chunks were cited?",
        rating: "good",
        sourceChunkIds: [validChunkId, unownedChunkId],
        citedChunkIds: [unownedChunkId],
      }),
    );
    const payload = insert.mock.calls[0]?.[0] as Record<string, unknown>;

    expect(response.status).toBe(201);
    expect(payload.top_chunk_ids).toEqual([validChunkId]);
    expect(payload.cited_chunk_ids).toEqual([]);
    expect(payload.metadata).toMatchObject({ source_chunk_ids_rejected: 1, cited_chunk_ids_rejected: 1 });
  });

  it("drops file names that belong to no document the caller owns", async () => {
    const { client, insert } = createInsertMock();
    vi.doMock("@/lib/env", () => mockEnv());
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => client }));
    vi.doMock("@/lib/supabase/auth", () => ({
      AuthenticationError: class AuthenticationError extends Error {},
      requireAuthenticatedUser: vi.fn(async () => ({ id: userId })),
      unauthorizedResponse: () => Response.json({ error: "Authentication required." }, { status: 401 }),
    }));
    const { POST } = await import("../src/app/api/eval-cases/route");

    const response = await POST(
      request({
        query: "Which files were on top?",
        rating: "good",
        sourceFiles: [ownedFileName, "someone-elses-private-guideline.pdf"],
      }),
    );
    const payload = insert.mock.calls[0]?.[0] as Record<string, unknown>;

    expect(response.status).toBe(201);
    expect(payload.top_files).toEqual([ownedFileName]);
    expect(payload.metadata).toMatchObject({ top_files_rejected: 1 });
  });

  it("keeps chunk, file and expected references from the published public corpus", async () => {
    const publicDocumentId = "55555555-5555-4555-8555-555555555555";
    const publicChunkId = "66666666-6666-4666-8666-666666666666";
    const publicFileName = "public-lithium-guideline.pdf";
    const { client, insert } = createInsertMock({
      ownedDocumentIds: [],
      publicDocumentIds: [publicDocumentId],
      ownedChunks: { [publicChunkId]: publicDocumentId, [unownedChunkId]: unownedDocumentId },
      documentFileNames: { [publicDocumentId]: publicFileName },
    });
    vi.doMock("@/lib/env", () => mockEnv());
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => client }));
    vi.doMock("@/lib/supabase/auth", () => ({
      AuthenticationError: class AuthenticationError extends Error {},
      requireAuthenticatedUser: vi.fn(async () => ({ id: userId })),
      unauthorizedResponse: () => Response.json({ error: "Authentication required." }, { status: 401 }),
    }));
    const { POST } = await import("../src/app/api/eval-cases/route");

    const response = await POST(
      request({
        query: "Which public source was cited?",
        rating: "needs_fixing",
        sourceChunkIds: [publicChunkId, unownedChunkId],
        citedChunkIds: [publicChunkId],
        sourceFiles: [publicFileName, "someone-elses-private-guideline.pdf"],
        expectedDocumentId: publicDocumentId,
      }),
    );
    const payload = insert.mock.calls[0]?.[0] as Record<string, unknown>;

    expect(response.status).toBe(201);
    expect(payload).toMatchObject({
      top_chunk_ids: [publicChunkId],
      cited_chunk_ids: [publicChunkId],
      top_files: [publicFileName],
      expected_document_id: publicDocumentId,
      expected_chunk_id: publicChunkId,
    });
    expect(payload.metadata).toMatchObject({
      source_chunk_ids_rejected: 1,
      cited_chunk_ids_rejected: 0,
      top_files_rejected: 1,
    });
  });

  it("nulls unowned expected document and chunk references", async () => {
    const { client, insert } = createInsertMock({
      ownedDocumentIds: [],
      ownedChunks: { [unownedChunkId]: documentId },
    });
    vi.doMock("@/lib/env", () => mockEnv());
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => client }));
    vi.doMock("@/lib/supabase/auth", () => ({
      AuthenticationError: class AuthenticationError extends Error {},
      requireAuthenticatedUser: vi.fn(async () => ({ id: userId })),
      unauthorizedResponse: () => Response.json({ error: "Authentication required." }, { status: 401 }),
    }));
    const { POST } = await import("../src/app/api/eval-cases/route");

    const response = await POST(
      request({
        query: "What source was expected?",
        rating: "needs_fixing",
        expectedDocumentId: documentId,
        expectedChunkId: unownedChunkId,
      }),
    );
    const payload = insert.mock.calls[0]?.[0] as Record<string, unknown>;

    expect(response.status).toBe(201);
    expect(payload.expected_document_id).toBeNull();
    expect(payload.expected_chunk_id).toBeNull();
  });
});
