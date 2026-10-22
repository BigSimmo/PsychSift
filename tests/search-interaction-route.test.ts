import { afterEach, describe, expect, it, vi } from "vitest";

// These routes always apply the per-owner rate limiter; the route tests stub it
// open so they exercise the route logic, not the limiter.
vi.mock("@/lib/api-rate-limit", () => ({
  consumeSubjectApiRateLimit: vi.fn(async () => ({ limited: false })),
  rateLimitJsonResponse: () => Response.json({ error: "rate limited" }, { status: 429 }),
  allowRateLimitInMemoryFallbackOnUnavailable: () => false,
}));

const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const documentId = "11111111-1111-4111-8111-111111111111";
const chunkId = "22222222-2222-4222-8222-222222222222";
const clozapineTitle = ` Clozapine${String.fromCharCode(7)} Monitoring `;
const otherUserTitle = `Other user${String.fromCharCode(39)}s source`;

function request(body: unknown) {
  return new Request("http://localhost/api/search/interaction", {
    method: "POST",
    headers: { "Content-Type": "application/json", authorization: "Bearer valid-token" },
    body: JSON.stringify(body),
  });
}

function createSelectMock<T>(resolver: (filters: Record<string, unknown>) => T | null) {
  const filters: Record<string, unknown> = {};
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn((column: string, value: unknown) => {
      filters[column] = value;
      return builder;
    }),
    maybeSingle: vi.fn(async () => ({ data: resolver(filters), error: null })),
  };
  return builder;
}

function createClient(options: { ownsDocument: boolean; ownsChunk: boolean }) {
  const insert = vi.fn(async (payload: unknown) => {
    void payload;
    return { data: null, error: null };
  });
  const client = {
    from: vi.fn((table: string) => {
      if (table === "documents") {
        return createSelectMock((filters) =>
          options.ownsDocument && filters.id === documentId && filters.owner_id === userId ? { id: documentId } : null,
        );
      }
      if (table === "document_chunks") {
        return createSelectMock((filters) =>
          options.ownsChunk && filters.id === chunkId && filters.document_id === documentId ? { id: chunkId } : null,
        );
      }
      expect(table).toBe("rag_query_misses");
      return { insert };
    }),
  };
  return { client, insert };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("/api/search/interaction", () => {
  it("T8-R6 redacts resolved context tokens in actual interaction persistence with raw retention enabled", async () => {
    const { client, insert } = createClient({ ownsDocument: true, ownsChunk: true });
    vi.doMock("@/lib/env", () => ({ env: { RAG_PERSIST_RAW_QUERY_TEXT: true }, isDemoMode: () => false }));
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => client }));
    vi.doMock("@/lib/supabase/auth", () => ({
      AuthenticationError: class AuthenticationError extends Error {},
      requireAuthenticatedUser: vi.fn(async () => ({ id: userId })),
      unauthorizedResponse: () => Response.json({}, { status: 401 }),
    }));
    const { POST } = await import("../src/app/api/search/interaction/route");
    const response = await POST(
      request({ query: 'Follow-up to "CONTEXTCANARY lithium": what about monitoring?', documentId, chunkId }),
    );
    expect(response.status).toBe(200);
    expect(insert.mock.calls[0]?.[0]).toMatchObject({ candidate_aliases: [] });
    expect(JSON.stringify(insert.mock.calls).toLowerCase()).not.toContain("contextcanary");
    const ordinary = await POST(request({ query: "ordinary lithium monitoring", documentId, chunkId }));
    expect(ordinary.status).toBe(200);
    expect(insert.mock.calls[1]?.[0]).toMatchObject({
      query: "ordinary lithium monitoring",
      candidate_aliases: expect.arrayContaining(["lithium"]),
    });
  });
  it("returns a client error for invalid interaction payloads", async () => {
    const { POST } = await import("../src/app/api/search/interaction/route");

    const response = await POST(request({ query: "", documentId: "not-a-document-id" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "Invalid interaction request." });
  });

  it("returns the shared server-error envelope when persistence fails", async () => {
    const documentLookup = {
      select: vi.fn(() => documentLookup),
      eq: vi.fn(() => documentLookup),
      maybeSingle: vi.fn(async () => ({ data: null, error: { message: "db unavailable" } })),
    };
    const client = {
      from: vi.fn(() => documentLookup),
    };
    vi.doMock("@/lib/env", () => ({ env: { RAG_PERSIST_RAW_QUERY_TEXT: false }, isDemoMode: () => false }));
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => client }));
    vi.doMock("@/lib/supabase/auth", () => ({
      AuthenticationError: class AuthenticationError extends Error {},
      requireAuthenticatedUser: vi.fn(async () => ({ id: userId })),
      unauthorizedResponse: () => Response.json({ error: "Authentication required." }, { status: 401 }),
    }));
    const { POST } = await import("../src/app/api/search/interaction/route");

    const response = await POST(
      request({
        query: "clozapine monitoring",
        documentId,
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: "Request failed." });
  });

  it("stores owned clicked document and chunk ids with sanitized labels", async () => {
    const { client, insert } = createClient({ ownsDocument: true, ownsChunk: true });
    vi.doMock("@/lib/env", () => ({ env: { RAG_PERSIST_RAW_QUERY_TEXT: false }, isDemoMode: () => false }));
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => client }));
    vi.doMock("@/lib/supabase/auth", () => ({
      AuthenticationError: class AuthenticationError extends Error {},
      requireAuthenticatedUser: vi.fn(async () => ({ id: userId })),
      unauthorizedResponse: () => Response.json({ error: "Authentication required." }, { status: 401 }),
    }));
    const { POST } = await import("../src/app/api/search/interaction/route");

    const response = await POST(
      request({
        query: "clozapine monitoring",
        documentId,
        chunkId,
        fileName: " Clozapine\u0000 guideline.pdf ",
        title: clozapineTitle,
      }),
    );
    const payload = insert.mock.calls[0]?.[0] as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      owner_id: userId,
      clicked_document_id: documentId,
      clicked_chunk_id: chunkId,
      top_files: ["Clozapine guideline.pdf"],
      top_chunk_ids: [chunkId],
      candidate_aliases: [],
    });
    expect(payload.query).toMatch(/^redacted-query:[a-f0-9]{64}$/);
    expect(payload.normalized_query).toBe(payload.query);
    expect(payload.candidate_labels).toEqual([
      {
        label: "Clozapine Monitoring",
        label_type: "document_type",
        document_id: documentId,
        confidence: 0.6,
      },
    ]);
  });

  it("stores cross-mode link clicks without a document id", async () => {
    const { client, insert } = createClient({ ownsDocument: false, ownsChunk: false });
    vi.doMock("@/lib/env", () => ({ env: { RAG_PERSIST_RAW_QUERY_TEXT: false }, isDemoMode: () => false }));
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => client }));
    vi.doMock("@/lib/supabase/auth", () => ({
      AuthenticationError: class AuthenticationError extends Error {},
      requireAuthenticatedUser: vi.fn(async () => ({ id: userId })),
      unauthorizedResponse: () => Response.json({ error: "Authentication required." }, { status: 401 }),
    }));
    const { POST } = await import("../src/app/api/search/interaction/route");

    const response = await POST(
      request({
        query: "clozapine maximum dose",
        crossMode: { mode: "prescribing", slug: "clozapine", title: clozapineTitle },
      }),
    );
    const payload = insert.mock.calls[0]?.[0] as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      owner_id: userId,
      clicked_document_id: null,
      clicked_chunk_id: null,
      top_files: [],
      top_chunk_ids: [],
      miss_reason: "clicked_result",
    });
    expect(payload.query).toMatch(/^redacted-query:[a-f0-9]{64}$/);
    expect(payload.candidate_labels).toEqual([
      {
        label: "Clozapine Monitoring",
        label_type: "cross_mode_target",
        document_id: null,
        confidence: 1,
      },
    ]);
    expect(payload.metadata).toMatchObject({
      interaction: "cross_mode_link_open",
      cross_mode_target: "prescribing",
      cross_mode_slug: "clozapine",
    });
    // Cross-mode targets are not documents; no ownership lookups should run.
    expect(client.from).toHaveBeenCalledWith("rag_query_misses");
    expect(client.from).not.toHaveBeenCalledWith("documents");
  });

  it("rejects interactions with neither a document id nor a cross-mode target", async () => {
    const { POST } = await import("../src/app/api/search/interaction/route");

    const response = await POST(request({ query: "clozapine monitoring" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "Invalid interaction request." });
  });

  it("does not persist PHI-capable query text in source-open miss telemetry", async () => {
    const { client, insert } = createClient({ ownsDocument: true, ownsChunk: true });
    vi.doMock("@/lib/env", () => ({ env: { RAG_PERSIST_RAW_QUERY_TEXT: false }, isDemoMode: () => false }));
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => client }));
    vi.doMock("@/lib/supabase/auth", () => ({
      AuthenticationError: class AuthenticationError extends Error {},
      requireAuthenticatedUser: vi.fn(async () => ({ id: userId })),
      unauthorizedResponse: () => Response.json({ error: "Authentication required." }, { status: 401 }),
    }));
    const { POST } = await import("../src/app/api/search/interaction/route");
    const phiQuery = "Patient Jane Citizen MRN 123456 born 01/02/1970 missed clozapine dose";

    const response = await POST(
      request({
        query: phiQuery,
        documentId,
        chunkId,
        fileName: "Clozapine guideline.pdf",
        title: "Clozapine Monitoring",
      }),
    );
    const payload = insert.mock.calls[0]?.[0] as Record<string, unknown>;
    const serialized = JSON.stringify(payload);

    expect(response.status).toBe(200);
    expect(payload.query).toMatch(/^redacted-query:[a-f0-9]{64}$/);
    expect(payload.normalized_query).toBe(payload.query);
    expect(payload.candidate_aliases).toEqual([]);
    expect(serialized).not.toContain("Jane");
    expect(serialized).not.toContain("123456");
    expect(serialized).not.toContain("01/02/1970");
  });

  it("nulls unowned clicked ids and drops caller labels from telemetry", async () => {
    const { client, insert } = createClient({ ownsDocument: false, ownsChunk: false });
    vi.doMock("@/lib/env", () => ({ env: { RAG_PERSIST_RAW_QUERY_TEXT: false }, isDemoMode: () => false }));
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => client }));
    vi.doMock("@/lib/supabase/auth", () => ({
      AuthenticationError: class AuthenticationError extends Error {},
      requireAuthenticatedUser: vi.fn(async () => ({ id: userId })),
      unauthorizedResponse: () => Response.json({ error: "Authentication required." }, { status: 401 }),
    }));
    const { POST } = await import("../src/app/api/search/interaction/route");

    const response = await POST(
      request({
        query: "clozapine monitoring",
        documentId,
        chunkId,
        fileName: "other-user.pdf",
        title: otherUserTitle,
      }),
    );
    const payload = insert.mock.calls[0]?.[0] as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload.clicked_document_id).toBeNull();
    expect(payload.clicked_chunk_id).toBeNull();
    expect(payload.top_files).toEqual([]);
    expect(payload.top_chunk_ids).toEqual([]);
    expect(payload.candidate_labels).toEqual([]);
  });
});
