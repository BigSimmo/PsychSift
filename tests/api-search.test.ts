import { afterEach, describe, expect, it, vi } from "vitest";

const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const documentId = "11111111-1111-4111-8111-111111111111";
const chunkId = "22222222-2222-4222-8222-222222222222";

function createSupabaseMock() {
  const inserts: Array<{ table: string; payload: unknown }> = [];
  const from = vi.fn((table: string) => {
    const filters: Array<{ column: string; value: unknown }> = [];
    const inFilters: Array<{ column: string; values: unknown[] }> = [];
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn((column: string, value: unknown) => {
        filters.push({ column, value });
        return builder;
      }),
      is: vi.fn((column: string, value: unknown) => {
        filters.push({ column, value });
        return builder;
      }),
      in: vi.fn((column: string, values: unknown[]) => {
        inFilters.push({ column, values });
        return builder;
      }),
      order: vi.fn(() => builder),
      range: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      abortSignal: vi.fn(() => builder),
      insert: vi.fn(async (payload: unknown) => {
        inserts.push({ table, payload });
        return { data: null, error: null };
      }),
      then: (onfulfilled?: (value: { data: unknown; error: null }) => unknown) => {
        const explicitIds = inFilters.find((filter) => filter.column === "id")?.values as string[] | undefined;
        const ownerFilter = filters.find((filter) => filter.column === "owner_id");
        const data =
          table === "documents" && ownerFilter
            ? (explicitIds?.length ? explicitIds : [documentId])
                .filter((id) => ownerFilter.value !== null || id === documentId)
                .map((id) => ({
                  id,
                  metadata: {},
                  import_batch_id: null,
                }))
            : [];
        return Promise.resolve({ data, error: null }).then(onfulfilled);
      },
    };
    return builder;
  });

  return { from, inserts };
}

function sampleSearchResult() {
  return {
    id: chunkId,
    document_id: documentId,
    title: "Clozapine monitoring guideline",
    file_name: "clozapine.pdf",
    page_number: 1,
    chunk_index: 0,
    section_heading: "Monitoring",
    section_path: ["Monitoring"],
    heading_level: 1,
    parent_heading: null,
    anchor_id: null,
    content: "Clozapine monitoring source text.",
    image_ids: [],
    similarity: 0.92,
    text_rank: 0.8,
    hybrid_score: 0.93,
    rrf_score: 0.03,
    source_strength: "strong",
    source_metadata: {
      document_status: "current",
      clinical_validation_status: "unverified",
      extraction_quality: "good",
    },
    document_labels: [],
    images: [],
  };
}

function mockRuntime(options: { demoMode?: boolean } = {}) {
  vi.resetModules();

  class MockAuthenticationError extends Error {
    constructor() {
      super("Authentication required.");
      this.name = "AuthenticationError";
    }
  }

  const supabase = createSupabaseMock();
  const createAdminClient = vi.fn(() => supabase);
  const requireAuthenticatedUser = vi.fn(async (request: Request) => {
    const id = request.headers.get("x-test-user");
    if (!id) throw new MockAuthenticationError();
    return { id };
  });
  const getOptionalAuthenticatedUser = vi.fn(async (request: Request) => {
    const id = request.headers.get("x-test-user");
    return id ? { id } : null;
  });
  const unauthorizedResponse = vi.fn(() => Response.json({ error: "Authentication required." }, { status: 401 }));
  const searchChunksWithTelemetry = vi.fn(async () => ({
    results: [sampleSearchResult()],
    telemetry: {
      query_class: "document_lookup",
      retrieval_strategy: "hybrid",
      retrieval_plan: "document_lookup:title_label_section_then_chunks",
      retrieval_query_variant_count: 2,
      search_cache_hit: false,
      embedding_skipped: false,
      embedding_skip_reason: null,
      embedding_cache_hit: false,
      embedding_prefetched: true,
      text_fast_path_latency_ms: 0,
      text_candidate_budget: 24,
      text_candidate_count: 3,
      text_fast_path_reason: null,
      embedding_latency_ms: 0,
      vector_candidate_count: 5,
      embedding_field_count: 1,
      supabase_rpc_latency_ms: 0,
      rerank_latency_ms: 0,
      retrieval_provenance_counts: { chunk: 1, title: 1 },
      second_stage_rerank_used: true,
      second_stage_rerank_latency_ms: 2,
      visual_direct_image_count: 0,
      memory_card_count: 0,
      memory_top_score: 0,
      weighted_top_score: 0.93,
      rrf_top_score: 0.03,
    },
  }));
  const fetchRelatedDocuments = vi.fn(async () => []);

  vi.doMock("@/lib/env", () => ({
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "https://mock.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "mock-key",
      MAX_UPLOAD_MB: 150,
      RAG_SEARCH_CACHE_TTL_MS: 0,
      RAG_SEARCH_CACHE_SIZE: 0,
      RAG_ANSWER_CACHE_TTL_MS: 0,
      RAG_ANSWER_CACHE_SIZE: 0,
      RAG_AWAIT_QUERY_LOGS: false,
    },
    isDemoMode: () => Boolean(options.demoMode),
    isLocalNoAuthMode: () => false,
    requireOpenAIEnv: () => undefined,
    requireServerEnv: () => undefined,
  }));
  vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient }));
  vi.doMock("@/lib/supabase/auth", () => ({
    AuthenticationError: MockAuthenticationError,
    requireAuthenticatedUser,
    getOptionalAuthenticatedUser,
    unauthorizedResponse,
  }));
  vi.doMock("@/lib/api-rate-limit", () => ({
    consumeSubjectApiRateLimit: vi.fn(async () => ({
      limited: false,
      limit: 100,
      remaining: 99,
      retryAfterSeconds: 0,
      resetAt: new Date(Date.now() + 60_000).toISOString(),
    })),
    allowRateLimitInMemoryFallbackOnUnavailable: () => true,
    rateLimitJsonResponse: vi.fn(),
  }));
  vi.doMock("@/lib/demo-data", () => ({
    demoSearch: vi.fn(() => [sampleSearchResult()]),
    demoAnswer: vi.fn(),
  }));
  vi.doMock("@/lib/rag/rag", () => ({
    searchChunksWithTelemetry,
  }));

  vi.doMock("@/lib/document-enrichment", () => ({
    fetchRelatedDocuments,
    toDocumentMatch: vi.fn((document: unknown) => document),
  }));
  vi.doMock("@/lib/evidence", () => ({
    buildSmartPanel: vi.fn(() => ({})),
    buildVisualEvidence: vi.fn(() => []),
    diversifySearchResults: vi.fn((results: unknown[]) => results),
  }));
  vi.doMock("@/lib/evidence-relevance", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/lib/evidence-relevance")>()),
    annotateDocumentMatches: vi.fn((_query: string, documents: unknown[]) => documents),
    annotateSearchResults: vi.fn((_query: string, results: unknown[]) => results),
  }));
  vi.doMock("@/lib/universal-search", () => ({
    universalSearchDomains: ["documents", "medications", "forms", "services", "differentials", "calculators"],
    runUniversalSearch: vi.fn(async (args: { query: string; demo?: boolean }) => ({
      query: args.query,
      groups: [
        {
          kind: "medications",
          title: "Medications",
          items: [{ id: "lithium", title: "Lithium", href: "/medications/lithium" }],
          total: 1,
          latencyMs: 5,
        },
      ],
      tookMs: 6,
      domainOrder: ["medications"],
    })),
  }));

  return {
    createAdminClient,
    fetchRelatedDocuments,
    getOptionalAuthenticatedUser,
    requireAuthenticatedUser,
    searchChunksWithTelemetry,
    supabase,
  };
}

function jsonRequest(path: string, body: Record<string, unknown>, authenticated = false) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (authenticated) headers.set("x-test-user", ownerId);

  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function request(path: string, init?: RequestInit) {
  return new Request(`http://localhost${path}`, {
    ...init,
    headers: {
      ...init?.headers,
    },
  });
}

async function payload(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("/api/search route defensive hardening (Task #342)", () => {
  it("accepts a valid search request and returns 200 in demo mode", async () => {
    mockRuntime({ demoMode: true });
    const { POST } = await import("../src/app/api/search/route");

    const response = await POST(jsonRequest("/api/search", { query: "lithium" }));
    const body = await payload(response);

    expect(response.status).toBe(200);
    expect(body.demoMode).toBe(true);
    expect(Array.isArray(body.results)).toBe(true);
  });

  it("accepts a valid search request and returns 200 in live mode", async () => {
    mockRuntime({ demoMode: false });
    const { POST } = await import("../src/app/api/search/route");

    const response = await POST(jsonRequest("/api/search", { query: "lithium dosage", topK: 5 }, true));
    const body = await payload(response);

    expect(response.status).toBe(200);
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results).toHaveLength(1);
  });

  it("rejects malformed JSON bodies with structured 400 JSON", async () => {
    mockRuntime();
    const { POST } = await import("../src/app/api/search/route");

    const response = await POST(
      request("/api/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{ malformed json",
      }),
    );
    const body = await payload(response);

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      error: "Invalid search request.",
      code: "invalid_body",
    });
  });

  it("rejects empty or missing query parameter with 400", async () => {
    mockRuntime();
    const { POST } = await import("../src/app/api/search/route");

    const responseEmpty = await POST(jsonRequest("/api/search", { query: "   " }));
    const bodyEmpty = await payload(responseEmpty);

    expect(responseEmpty.status).toBe(400);
    expect(bodyEmpty).toMatchObject({
      error: "Invalid search request.",
      code: "invalid_body",
    });

    const responseMissing = await POST(jsonRequest("/api/search", {}));
    const bodyMissing = await payload(responseMissing);

    expect(responseMissing.status).toBe(400);
    expect(bodyMissing).toMatchObject({
      error: "Invalid search request.",
      code: "invalid_body",
    });
  });

  it("rejects queries exceeding the 2000 character length limit with 400", async () => {
    mockRuntime();
    const { POST } = await import("../src/app/api/search/route");

    const response = await POST(jsonRequest("/api/search", { query: "a".repeat(2001) }));
    const body = await payload(response);

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: "Invalid search request.", code: "invalid_body" });
  });

  it("rejects invalid topK or documentLimit with 400", async () => {
    mockRuntime();
    const { POST } = await import("../src/app/api/search/route");

    const responseTopK = await POST(jsonRequest("/api/search", { query: "lithium", topK: 50 }));
    expect(responseTopK.status).toBe(400);

    const responseDocLimit = await POST(jsonRequest("/api/search", { query: "lithium", documentLimit: 100 }));
    expect(responseDocLimit.status).toBe(400);
  });

  it("rejects non-UUID documentId with 400", async () => {
    mockRuntime();
    const { POST } = await import("../src/app/api/search/route");

    const response = await POST(jsonRequest("/api/search", { query: "lithium", documentId: "not-a-uuid" }));
    expect(response.status).toBe(400);
    expect(await payload(response)).toMatchObject({ error: "Invalid search request.", code: "invalid_body" });
  });

  it("rejects payloads exceeding the byte limit with 413 payload_too_large", async () => {
    mockRuntime();
    const { POST } = await import("../src/app/api/search/route");

    const response = await POST(
      request("/api/search", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": "300000",
        },
        body: JSON.stringify({ query: "lithium" }),
      }),
    );
    expect(response.status).toBe(413);
    expect(await payload(response)).toMatchObject({ code: "payload_too_large" });
  });

  it("rejects GET requests with structured 405 Method Not Allowed", async () => {
    const { GET } = await import("../src/app/api/search/route");

    const response = await GET();
    const body = await payload(response);

    expect(response.status).toBe(405);
    expect(body).toMatchObject({
      code: "method_not_allowed",
    });
  });

  it("sanitizes DB 500 errors to prevent schema leaks", async () => {
    mockRuntime({ demoMode: false });
    const { POST } = await import("../src/app/api/search/route");
    const { searchChunksWithTelemetry } = await import("@/lib/rag/rag");
    const error = Object.assign(new Error("Database connection failed"), {
      name: "PostgresError",
      sqlState: "08006",
    });
    vi.mocked(searchChunksWithTelemetry).mockRejectedValueOnce(error);

    const response = await POST(jsonRequest("/api/search", { query: "lithium" }, true));
    const body = await payload(response);

    expect(response.status).toBe(500);
    expect(body).toMatchObject({
      error: "Search failed. Retry with a narrower question.",
      code: "internal_error",
    });
    expect(body).not.toHaveProperty("sqlState");
    expect(body).not.toHaveProperty("causeMessage");
    expect(body).not.toHaveProperty("causeName");
  });

  it("handles empty results with 200 OK", async () => {
    mockRuntime({ demoMode: false });
    const { POST } = await import("../src/app/api/search/route");
    const { searchChunksWithTelemetry } = await import("@/lib/rag/rag");
    vi.mocked(searchChunksWithTelemetry).mockResolvedValueOnce({
      results: [],
      telemetry: {} as unknown as Awaited<ReturnType<typeof searchChunksWithTelemetry>>["telemetry"],
    });

    const response = await POST(jsonRequest("/api/search", { query: "lithium" }, true));
    const body = await payload(response);

    expect(response.status).toBe(200);
    expect(body.results).toEqual([]);
  });

  it("rejects rate limited requests with 429", async () => {
    mockRuntime({ demoMode: false });
    const { POST } = await import("../src/app/api/search/route");
    const { consumeSubjectApiRateLimit, rateLimitJsonResponse } = await import("@/lib/api-rate-limit");

    vi.mocked(consumeSubjectApiRateLimit).mockResolvedValueOnce({
      limited: true,
      limit: 100,
      remaining: 0,
      retryAfterSeconds: 60,
      resetAt: new Date(Date.now() + 60_000).toISOString(),
    } as unknown as Awaited<ReturnType<typeof consumeSubjectApiRateLimit>>);
    vi.mocked(rateLimitJsonResponse).mockImplementationOnce(
      () =>
        Response.json({ error: "Rate limit exceeded" }, { status: 429 }) as unknown as ReturnType<
          typeof rateLimitJsonResponse
        >,
    );

    const response = await POST(jsonRequest("/api/search", { query: "lithium" }, true));

    expect(response.status).toBe(429);
  });
});

describe("/api/search/universal route defensive hardening (Task #342)", () => {
  it("accepts a valid universal search query and returns 200", async () => {
    mockRuntime({ demoMode: true });
    const { GET } = await import("../src/app/api/search/universal/route");

    const response = await GET(request("/api/search/universal?q=lithium"));
    const body = await payload(response);

    expect(response.status).toBe(200);
    expect(body.query).toBe("lithium");
    expect(Array.isArray(body.groups)).toBe(true);
  });

  it("rejects missing or too short q parameter with structured 400 JSON", async () => {
    mockRuntime();
    const { GET } = await import("../src/app/api/search/universal/route");

    const responseMissing = await GET(request("/api/search/universal"));
    expect(responseMissing.status).toBe(400);
    expect(await payload(responseMissing)).toMatchObject({ code: "invalid_query" });

    const responseShort = await GET(request("/api/search/universal?q=a"));
    expect(responseShort.status).toBe(400);
    expect(await payload(responseShort)).toMatchObject({ code: "invalid_query" });
  });

  it("rejects queries exceeding 200 chars with structured 400 JSON", async () => {
    mockRuntime();
    const { GET } = await import("../src/app/api/search/universal/route");

    const response = await GET(request(`/api/search/universal?q=${"a".repeat(201)}`));
    expect(response.status).toBe(400);
    expect(await payload(response)).toMatchObject({ code: "invalid_query" });
  });

  it("rejects oversized domains parameter with structured 400 JSON", async () => {
    mockRuntime();
    const { GET } = await import("../src/app/api/search/universal/route");

    const response = await GET(request(`/api/search/universal?q=lithium&domains=${"a".repeat(501)}`));
    expect(response.status).toBe(400);
    expect(await payload(response)).toMatchObject({ code: "invalid_query" });
  });

  it("rejects malformed URLs gracefully with structured 400 instead of unhandled 500", async () => {
    mockRuntime();
    const { GET } = await import("../src/app/api/search/universal/route");

    const badRequest = {
      url: "://malformed-url",
      headers: new Headers(),
      signal: new AbortController().signal,
    } as unknown as Request;

    const response = await GET(badRequest);
    expect(response.status).toBe(400);
    expect(await payload(response)).toMatchObject({ code: "invalid_query" });
  });

  it("rejects POST requests on universal search with structured 405 Method Not Allowed", async () => {
    const { POST } = await import("../src/app/api/search/universal/route");

    const response = await POST();
    const body = await payload(response);

    expect(response.status).toBe(405);
    expect(body).toMatchObject({
      code: "method_not_allowed",
    });
  });
});
