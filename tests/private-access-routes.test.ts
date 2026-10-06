import { createHash, createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherUserId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const documentId = "11111111-1111-4111-8111-111111111111";
const otherDocumentId = "22222222-2222-4222-8222-222222222222";
const imageId = "33333333-3333-4333-8333-333333333333";
const token = "valid-token";

function documentDetailRow(overrides: Record<string, unknown> = {}) {
  return {
    id: documentId,
    owner_id: userId,
    title: "Clinical guideline",
    description: null,
    file_name: "guideline.pdf",
    file_type: "application/pdf",
    file_size: 1024,
    storage_path: `${userId}/documents/guideline.pdf`,
    content_hash: null,
    source_path: null,
    import_batch_id: null,
    status: "indexed",
    page_count: 2,
    chunk_count: 1,
    image_count: 0,
    error_message: null,
    metadata: {},
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function expectFeedbackTokenBoundToAnswer(payload: Record<string, unknown>) {
  expect(payload.interactionId).toEqual(expect.any(String));
  expect(payload.feedbackToken).toEqual(expect.any(String));
  const [encodedClaims] = String(payload.feedbackToken).split(".");
  const claims = JSON.parse(Buffer.from(encodedClaims!, "base64url").toString("utf8")) as { answerHash?: string };
  expect(claims.answerHash).toBe(createHash("sha256").update(String(payload.answer), "utf8").digest("hex"));
}

type QueryError = { message: string; code?: string };
type QueryResult = { data: unknown; error: QueryError | null };
type QueryFilter = { column: string; value: unknown };
type QueryInFilter = { column: string; values: unknown[] };
type QueryCall = {
  table: string;
  operation: "select" | "insert" | "update" | "delete";
  selected?: string;
  range?: { from: number; to: number };
  orFilters: string[];
  filters: QueryFilter[];
  inFilters: QueryInFilter[];
  overlapsFilters: QueryInFilter[];
  insertPayload?: unknown;
  updatePayload?: unknown;
  limitCount?: number;
  maybeSingle: boolean;
  single: boolean;
};
type QueryResolver = (call: QueryCall) => QueryResult;

function ok(data: unknown): QueryResult {
  return { data, error: null };
}

function fail(message: string, code?: string): QueryResult {
  return { data: null, error: { message, ...(code ? { code } : {}) } };
}

function rateLimitRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    limited: false,
    limit_value: 100,
    remaining: 99,
    retry_after_seconds: 60,
    reset_at: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  };
}

class QueryBuilder implements PromiseLike<QueryResult> {
  constructor(
    private readonly call: QueryCall,
    private readonly resolver: QueryResolver,
  ) {}

  select(selected?: string) {
    this.call.selected = selected;
    return this;
  }

  insert(payload: unknown) {
    this.call.operation = "insert";
    this.call.insertPayload = payload;
    return this;
  }

  update(payload: unknown) {
    this.call.operation = "update";
    this.call.updatePayload = payload;
    return this;
  }

  delete() {
    this.call.operation = "delete";
    return this;
  }

  eq(column: string, value: unknown) {
    this.call.filters.push({ column, value });
    return this;
  }

  neq(column: string, value: unknown) {
    this.call.filters.push({ column, value });
    return this;
  }

  gte(column: string, value: unknown) {
    this.call.filters.push({ column, value });
    return this;
  }

  lte(column: string, value: unknown) {
    this.call.filters.push({ column, value });
    return this;
  }

  is(column: string, value: unknown) {
    this.call.filters.push({ column, value });
    return this;
  }

  not(column: string, _operator: string, value: unknown) {
    this.call.filters.push({ column, value });
    return this;
  }

  in(column: string, values: unknown[]) {
    this.call.inFilters.push({ column, values });
    return this;
  }

  overlaps(column: string, values: unknown[]) {
    this.call.overlapsFilters.push({ column, values });
    return this;
  }

  order() {
    return this;
  }

  range(from: number, to: number) {
    this.call.range = { from, to };
    return this;
  }

  or(filter: string) {
    this.call.orFilters.push(filter);
    return this;
  }

  limit(count: number) {
    this.call.limitCount = count;
    return this;
  }

  abortSignal(signal: AbortSignal) {
    void signal;
    return this;
  }

  single() {
    this.call.single = true;
    return this.resolve();
  }

  maybeSingle() {
    this.call.maybeSingle = true;
    return this.resolve();
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.resolve().then(onfulfilled, onrejected);
  }

  private resolve() {
    return Promise.resolve(this.resolver(this.call));
  }
}

const defaultQueryResolver: QueryResolver = (call) => {
  if (call.table === "documents" && call.selected === "id,metadata,import_batch_id") {
    const explicitIds = call.inFilters.find((filter) => filter.column === "id")?.values as string[] | undefined;
    const ownerFilter = call.filters.find((filter) => filter.column === "owner_id");
    const ownerPlusPublicFilter = call.orFilters.some(
      (filter) => filter.includes(`owner_id.eq.${userId}`) && filter.includes("owner_id.is.null"),
    );
    const ids = explicitIds?.length ? explicitIds : [documentId];
    if (!ownerFilter && !ownerPlusPublicFilter) return ok([]);
    if (ownerFilter?.value === null) {
      return ok(ids.filter((id) => id === documentId).map((id) => ({ id, metadata: {}, import_batch_id: null })));
    }
    if (ownerFilter?.value === userId || ownerPlusPublicFilter) {
      return ok(ids.map((id) => ({ id, metadata: {}, import_batch_id: null })));
    }
    return ok([]);
  }
  return ok([]);
};

function createSupabaseMock(resolve: QueryResolver = defaultQueryResolver) {
  const calls: QueryCall[] = [];
  const resolveWithDefaultScope: QueryResolver = (call) => {
    const customResult = resolve(call);
    if (
      call.table === "documents" &&
      call.selected === "id,metadata,import_batch_id" &&
      Array.isArray(customResult.data) &&
      customResult.data.length === 0
    ) {
      return defaultQueryResolver(call);
    }
    return customResult;
  };
  const listUsers = vi.fn(
    async (): Promise<{
      data: { users: Array<{ id: string; email?: string | null }>; nextPage: number };
      error: QueryError | null;
    }> => ({ data: { users: [], nextPage: 0 }, error: null }),
  );
  const upload = vi.fn(async (...args: [string, unknown, Record<string, unknown>]) => {
    void args;
    return {
      data: { path: "uploaded" },
      error: null,
    };
  });
  const createSignedUrl = vi.fn(async (path: string) => ({
    data: { signedUrl: `https://signed.local/${path}` },
    error: null,
  }));
  // Batch sibling of `createSignedUrl`, used by /api/images/signed-urls. Supabase
  // returns one entry per requested path, so the route matches results back to
  // images by path rather than by index.
  const createSignedUrls = vi.fn(async (paths: string[]) => ({
    data: paths.map((path) => ({ path, signedUrl: `https://signed.local/${path}`, error: null })),
    error: null,
  }));
  const remove = vi.fn(
    async (
      ...args: [string[]]
    ): Promise<{
      data: string[] | null;
      error: QueryError | null;
    }> => {
      void args;
      return { data: [], error: null };
    },
  );
  const storageFrom = vi.fn(() => ({ upload, createSignedUrl, createSignedUrls, remove }));
  const getUser = vi.fn(async (receivedToken?: string) =>
    receivedToken === token
      ? { data: { user: { id: userId, app_metadata: { site_role: "administrator" } } }, error: null }
      : { data: { user: null }, error: { message: "Invalid token" } },
  );
  const subjectRateLimitCounts = new Map<string, number>();
  const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    if (name === "consume_api_rate_limit") {
      return {
        data: [rateLimitRow()],
        error: null,
      };
    }
    if (name === "consume_summary_rate_limits_atomic") {
      return {
        data: [rateLimitRow({ bucket: null, limit_value: 12 })],
        error: null,
      };
    }
    if (name === "consume_api_subject_rate_limit") {
      const bucket = String(args?.p_bucket ?? "");
      const limit = Number(args?.p_limit ?? 100);
      const key = `${String(args?.p_subject_key ?? "unknown")}:${bucket}`;
      const count = (subjectRateLimitCounts.get(key) ?? 0) + 1;
      subjectRateLimitCounts.set(key, count);
      return {
        data: [
          rateLimitRow({
            limited: count > limit,
            limit_value: limit,
            remaining: Math.max(limit - count, 0),
          }),
        ],
        error: null,
      };
    }
    if (name === "create_uploaded_document_with_ingestion_job") {
      const document = (args?.p_document ?? {}) as Record<string, unknown>;
      const documentCall: QueryCall = {
        table: "documents",
        operation: "insert",
        orFilters: [],
        filters: [],
        inFilters: [],
        overlapsFilters: [],
        insertPayload: document,
        maybeSingle: false,
        single: true,
      };
      calls.push(documentCall);
      const documentResult = resolveWithDefaultScope(documentCall);
      if (documentResult.error) return documentResult;

      const insertedDocument = {
        ...document,
        ...(typeof documentResult.data === "object" && documentResult.data ? documentResult.data : {}),
        status: "queued",
        page_count: 0,
        chunk_count: 0,
        image_count: 0,
        created_at: "2026-07-24T00:00:00.000Z",
      };
      const jobPayload = {
        document_id: document.id,
        batch_id: null,
        status: "pending",
        stage: "queued",
        progress: 0,
        max_attempts: args?.p_max_attempts,
      };
      const jobCall: QueryCall = {
        table: "ingestion_jobs",
        operation: "insert",
        orFilters: [],
        filters: [],
        inFilters: [],
        overlapsFilters: [],
        insertPayload: jobPayload,
        maybeSingle: false,
        single: true,
      };
      calls.push(jobCall);
      const jobResult = resolveWithDefaultScope(jobCall);
      if (jobResult.error) return jobResult;

      return ok({
        document: insertedDocument,
        job: {
          id: "job-1",
          ...jobPayload,
          ...(typeof jobResult.data === "object" && jobResult.data ? jobResult.data : {}),
        },
      });
    }
    if (name === "request_ingestion_reindex_if_agent_idle") {
      return ok({ outcome: "queued", job: { id: "reindex-job" } });
    }
    return ok([]);
  });
  const client = {
    auth: { getUser, admin: { listUsers } },
    calls,
    from: vi.fn((table: string) => {
      const call: QueryCall = {
        table,
        operation: "select",
        orFilters: [],
        filters: [],
        inFilters: [],
        overlapsFilters: [],
        maybeSingle: false,
        single: false,
      };
      calls.push(call);
      return new QueryBuilder(call, resolveWithDefaultScope);
    }),
    rpc,
    storage: { from: storageFrom },
    storageMocks: { upload, createSignedUrl, createSignedUrls, remove, storageFrom },
  };

  return client;
}

function mockAtomicReindexRpc(
  client: ReturnType<typeof createSupabaseMock>,
  resolve: (args: Record<string, unknown>) => QueryResult | Promise<QueryResult>,
) {
  client.rpc.mockImplementation(async (name: string, args?: Record<string, unknown>) => {
    if (name === "consume_api_rate_limit") return ok([rateLimitRow()]);
    if (name === "request_ingestion_reindex_if_agent_idle") return resolve(args ?? {});
    return ok([]);
  });
}

function mockRuntime(
  client: ReturnType<typeof createSupabaseMock>,
  ragMock?: Record<string, unknown>,
  options: {
    localNoAuth?: boolean;
    localOwnerEmail?: string;
    providerMode?: string;
    openAiKey?: string;
    maxConcurrentUploads?: number;
    maxInFlightUploadMb?: number;
    demoMode?: boolean;
  } = {},
) {
  vi.resetModules();
  vi.doUnmock("@/lib/rag/rag");
  vi.doUnmock("@/lib/openai");
  vi.doUnmock("@/lib/document-enrichment");
  vi.doUnmock("@/lib/deep-memory");
  vi.doUnmock("@/lib/demo-data");
  vi.doUnmock("@/lib/answer-telemetry");
  vi.doMock("@/lib/env", () => ({
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "https://sjrfecxgysukkwxsowpy.supabase.co",
      MAX_UPLOAD_MB: 150,
      MAX_CONCURRENT_UPLOADS: options.maxConcurrentUploads ?? 1,
      MAX_IN_FLIGHT_UPLOAD_MB: options.maxInFlightUploadMb ?? 151,
      SUPABASE_DOCUMENT_BUCKET: "clinical-documents",
      SUPABASE_IMAGE_BUCKET: "clinical-images",
      DOCUMENT_SIGNED_URL_TTL_SECONDS: 600,
      RAG_SEARCH_CACHE_TTL_MS: 0,
      RAG_SEARCH_CACHE_SIZE: 0,
      RAG_ANSWER_CACHE_TTL_MS: 0,
      RAG_ANSWER_CACHE_SIZE: 0,
      RAG_AWAIT_QUERY_LOGS: false,
      RAG_QUERY_HASH_SECRET: "test-query-hash-secret-at-least-16-chars",
      // A key is present and provider mode is "auto" by default, so retrieval uses the online
      // embedding/hybrid path; tests can override to exercise the source-only path.
      OPENAI_API_KEY: options.openAiKey ?? "sk-test",
      RAG_PROVIDER_MODE: options.providerMode ?? "auto",
      LOCAL_NO_AUTH_OWNER_EMAIL: options.localOwnerEmail,
      WORKER_STALE_AFTER_MINUTES: 10,
      WORKER_MAX_ATTEMPTS: 3,
    },
    isDemoMode: () => Boolean(options.demoMode),
    isLocalNoAuthMode: () => Boolean(options.localNoAuth),
    requireOpenAIEnv: () => undefined,
    requireServerEnv: () => undefined,
  }));
  vi.doMock("@/lib/supabase/admin", () => ({
    createAdminClient: () => client,
  }));
  if (ragMock) {
    vi.doMock("@/lib/rag/rag", () => ragMock);
  }
}

function request(path: string, init?: RequestInit) {
  return new Request(`http://localhost${path}`, init);
}

function localPortRequest(port: number, path: string, init?: RequestInit) {
  return new Request(`http://localhost:${port}${path}`, init);
}

function matchesOwnerReadScope(call: QueryCall, ownerId?: string | null) {
  if (ownerId === undefined || ownerId === null) {
    return call.filters.some((filter) => filter.column === "owner_id" && filter.value === null);
  }
  return call.orFilters.some(
    (filter) => filter.includes(`owner_id.eq.${ownerId}`) && filter.includes("owner_id.is.null"),
  );
}

function authenticatedRequest(path: string, init?: RequestInit) {
  return request(path, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });
}

function authenticatedCookieRequest(path: string, init?: RequestInit) {
  return request(path, {
    ...init,
    headers: {
      cookie: `sb-access-token=${token}`,
      ...init?.headers,
    },
  });
}

function authenticatedAuthTokenCookieRequest(path: string, init?: RequestInit) {
  return request(path, {
    ...init,
    headers: {
      cookie: `sb-sjrfecxgysukkwxsowpy-auth-token=${encodeURIComponent(
        JSON.stringify({
          access_token: token,
          refresh_token: "refresh-token",
          type: "bearer",
        }),
      )}`,
      ...init?.headers,
    },
  });
}

async function payload(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

function ssePayload(body: string, eventName: string) {
  const block = body.split("\n\n").find((chunk) => chunk.includes(`event: ${eventName}\n`));
  expect(block).toBeTruthy();
  const dataLine = block?.split("\n").find((line) => line.startsWith("data: "));
  expect(dataLine).toBeTruthy();
  return JSON.parse(dataLine!.slice("data: ".length)) as Record<string, unknown>;
}

function expectSingleCompletionBeforeFinal(body: string) {
  const blocks = body.split("\n\n").filter(Boolean);
  const completions = blocks.filter(
    (block) => block.includes("event: progress\n") && block.includes('"stage":"complete"'),
  );
  expect(completions).toHaveLength(1);
  expect(body.indexOf(completions[0]!)).toBeLessThan(body.indexOf("event: final\n"));
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("private document API access", () => {
  it("lists public documents without auth in local no-auth mode", async () => {
    const documents = [{ id: documentId, owner_id: null, title: "Public guideline" }];
    const client = createSupabaseMock((call) => (call.table === "documents" ? ok(documents) : ok([])));
    mockRuntime(client, undefined, { localNoAuth: true });
    const { GET } = await import("../src/app/api/documents/route");

    const response = await GET(localPortRequest(4298, "/api/documents"));
    const body = await payload(response);

    expect(response.status).toBe(200);
    expect(body.documents).toEqual([{ id: documentId, title: "Public guideline" }]);
    expect(client.calls[0].filters).toContainEqual({ column: "owner_id", value: null });
    expect(client.auth.getUser).not.toHaveBeenCalled();
  });

  it("accepts authenticated bearer tokens in local no-auth mode", async () => {
    const documents = [{ id: documentId, owner_id: userId, title: "Owned document" }];
    const client = createSupabaseMock((call) => (call.table === "documents" ? ok(documents) : ok([])));
    mockRuntime(client, undefined, { localNoAuth: true });
    const { GET } = await import("../src/app/api/documents/route");

    const response = await GET(authenticatedRequest("/api/documents"));

    expect(response.status).toBe(200);
    expect(client.auth.getUser).toHaveBeenCalledTimes(1);
  });
  it("does not let local no-auth bypass administrator upload authentication", async () => {
    const client = createSupabaseMock();
    mockRuntime(client, undefined, { localNoAuth: true });
    const { POST } = await import("../src/app/api/upload/route");
    const formData = new FormData();
    formData.set("file", new File(["hello"], "guideline.txt", { type: "text/plain" }));

    const response = await POST(
      localPortRequest(3000, "/api/upload", {
        method: "POST",
        body: formData,
      }),
    );

    expect(response.status).toBe(401);
    expect(await payload(response)).toMatchObject({ code: "authentication_required" });
    expect(client.auth.getUser).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it("does not let a localhost referer bypass administrator upload authentication", async () => {
    const client = createSupabaseMock();
    mockRuntime(client, undefined, { localNoAuth: true });
    const { POST } = await import("../src/app/api/upload/route");
    const formData = new FormData();
    formData.set("file", new File(["hello"], "guideline.txt", { type: "text/plain" }));

    const response = await POST(
      localPortRequest(4298, "/api/upload", {
        method: "POST",
        headers: {
          referer: "http://localhost:3000/",
        },
        body: formData,
      }),
    );

    expect(response.status).toBe(401);
    expect(await payload(response)).toMatchObject({ code: "authentication_required" });
    expect(client.auth.getUser).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it("lists public documents for unauthenticated callers", async () => {
    const documents = [{ id: documentId, owner_id: null, title: "Public guideline", status: "indexed" }];
    const client = createSupabaseMock((call) => (call.table === "documents" ? ok(documents) : ok([])));
    mockRuntime(client);
    const { GET } = await import("../src/app/api/documents/route");

    const response = await GET(request("/api/documents?includeMeta=false"));
    const body = await payload(response);

    expect(response.status).toBe(200);
    expect(body.documents).toEqual([{ id: documentId, title: "Public guideline", status: "indexed" }]);
    expect(client.auth.getUser).not.toHaveBeenCalled();
    expect(client.calls[0].filters).toContainEqual({ column: "owner_id", value: null });
    expect(client.calls[0].filters).not.toContainEqual({ column: "owner_id", value: userId });
  });

  it("filters authenticated document listing by owner and public rows", async () => {
    const documents = [{ id: documentId, owner_id: userId, title: "Owned document" }];
    const client = createSupabaseMock((call) => (call.table === "documents" ? ok(documents) : ok([])));
    mockRuntime(client);
    const { GET } = await import("../src/app/api/documents/route");

    const response = await GET(authenticatedRequest("/api/documents"));
    const body = await payload(response);

    expect(response.status).toBe(200);
    expect(body.documents).toEqual(documents.map((document) => ({ ...document, labels: [], summary: null })));
    expect(body.pagination).toMatchObject({ limit: 100, offset: 0, nextOffset: 1, hasMore: false });
    expect(client.calls[0].orFilters).toContain(
      `owner_id.eq.${userId},and(owner_id.is.null,metadata->>public_corpus.eq.true)`,
    );
    expect(client.calls[0].selected).toContain("storage_path");
    expect(client.calls[0].range).toEqual({ from: 0, to: 99 });
  });

  it("redacts owner-internal storage fields on public rows in an authenticated document list", async () => {
    const owned = {
      id: documentId,
      owner_id: userId,
      title: "Owned document",
      status: "indexed",
      storage_path: `${userId}/documents/owned.pdf`,
      content_hash: "sha256:owned",
      metadata: { extraction_quality: "good" },
    };
    const shared = {
      id: otherDocumentId,
      owner_id: null,
      title: "Public guideline",
      status: "indexed",
      storage_path: "someone-else/documents/shared.pdf",
      content_hash: "sha256:shared",
      source_path: "/import/shared.pdf",
      import_batch_id: "batch-1",
      error_message: "internal stage error",
      metadata: { extraction_quality: "partial" },
    };
    const client = createSupabaseMock((call) => (call.table === "documents" ? ok([owned, shared]) : ok([])));
    mockRuntime(client);
    const { GET } = await import("../src/app/api/documents/route");

    const response = await GET(authenticatedRequest("/api/documents?includeMeta=false"));
    const body = await payload(response);
    const [ownedRow, sharedRow] = body.documents as Array<Record<string, unknown>>;

    expect(response.status).toBe(200);
    // The caller's own row keeps its storage internals.
    expect(ownedRow).toMatchObject({
      id: documentId,
      storage_path: `${userId}/documents/owned.pdf`,
      content_hash: "sha256:owned",
    });
    // The shared public row keeps its public fields but not the owner's storage internals or
    // free-form metadata (which can carry owner-internal provenance).
    expect(sharedRow).toMatchObject({ id: otherDocumentId, title: "Public guideline" });
    expect(sharedRow).not.toHaveProperty("metadata");
    expect(sharedRow).not.toHaveProperty("storage_path");
    expect(sharedRow).not.toHaveProperty("content_hash");
    expect(sharedRow).not.toHaveProperty("source_path");
    expect(sharedRow).not.toHaveProperty("import_batch_id");
    expect(sharedRow).not.toHaveProperty("error_message");
  });

  it("redacts nested metadata for non-owned public documents in an authenticated list", async () => {
    const owned = { id: documentId, owner_id: userId, title: "Owned document", status: "indexed" };
    const shared = { id: otherDocumentId, owner_id: null, title: "Public guideline", status: "indexed" };
    const client = createSupabaseMock((call) => {
      if (call.table === "documents") return ok([owned, shared]);
      const requestedIds = call.inFilters.find((filter) => filter.column === "document_id")?.values ?? [];
      if (call.table === "document_labels") {
        const rows = [
          { id: "owned-label", document_id: documentId, label: "Owned", metadata: { private: true } },
          { id: "shared-label", document_id: otherDocumentId, label: "Shared", metadata: { private: true } },
        ];
        return ok(rows.filter((row) => requestedIds.includes(row.document_id)));
      }
      if (call.table === "document_summaries") {
        const rows = [
          {
            id: "owned-summary",
            document_id: documentId,
            summary: "Owned summary",
            source_chunk_ids: ["owned-chunk"],
            metadata: { private: true },
          },
          {
            id: "shared-summary",
            document_id: otherDocumentId,
            summary: "Shared summary",
            source_chunk_ids: ["shared-chunk"],
            metadata: { private: true },
          },
        ];
        return ok(rows.filter((row) => requestedIds.includes(row.document_id)));
      }
      return ok([]);
    });
    mockRuntime(client);
    const { GET } = await import("../src/app/api/documents/route");

    const response = await GET(authenticatedRequest("/api/documents?includeMeta=true"));
    const body = await payload(response);
    const [ownedRow, sharedRow] = body.documents as Array<Record<string, unknown>>;

    expect(response.status).toBe(200);
    const labelCalls = client.calls.filter((call) => call.table === "document_labels");
    const summaryCalls = client.calls.filter((call) => call.table === "document_summaries");
    expect(labelCalls).toHaveLength(2);
    expect(summaryCalls).toHaveLength(2);
    expect(labelCalls.map((call) => call.selected)).toEqual(
      expect.arrayContaining([expect.stringContaining("metadata"), expect.not.stringContaining("metadata")]),
    );
    expect(summaryCalls.map((call) => call.selected)).toEqual(
      expect.arrayContaining([expect.stringContaining("source_chunk_ids"), expect.not.stringContaining("metadata")]),
    );
    expect((ownedRow.labels as Array<Record<string, unknown>>)[0]).toHaveProperty("metadata");
    expect(ownedRow.summary).toHaveProperty("source_chunk_ids");
    expect((sharedRow.labels as Array<Record<string, unknown>>)[0]).toEqual({
      id: "shared-label",
      document_id: otherDocumentId,
      label: "Shared",
    });
    expect(sharedRow.summary).toEqual({
      id: "shared-summary",
      document_id: otherDocumentId,
      summary: "Shared summary",
    });
  });

  it("accepts legacy Supabase auth cookies for private document access", async () => {
    const documents = [{ id: documentId, owner_id: userId, title: "Owned document" }];
    const client = createSupabaseMock((call) => (call.table === "documents" ? ok(documents) : ok([])));
    mockRuntime(client);
    const { GET } = await import("../src/app/api/documents/route");

    const response = await GET(authenticatedCookieRequest("/api/documents"));
    const body = await payload(response);

    expect(response.status).toBe(200);
    expect(client.auth.getUser).toHaveBeenCalledWith(token);
    expect(body.documents).toEqual(documents.map((document) => ({ ...document, labels: [], summary: null })));
    expect(client.calls[0].orFilters).toContain(
      `owner_id.eq.${userId},and(owner_id.is.null,metadata->>public_corpus.eq.true)`,
    );
  });

  it("accepts Supabase auth token cookies for private document access", async () => {
    const documents = [{ id: documentId, owner_id: userId, title: "Owned document" }];
    const client = createSupabaseMock((call) => (call.table === "documents" ? ok(documents) : ok([])));
    mockRuntime(client);
    const { GET } = await import("../src/app/api/documents/route");

    const response = await GET(authenticatedAuthTokenCookieRequest("/api/documents"));
    const body = await payload(response);

    expect(response.status).toBe(200);
    expect(client.auth.getUser).toHaveBeenCalledWith(token);
    expect(body.documents).toEqual(documents.map((document) => ({ ...document, labels: [], summary: null })));
    expect(client.calls[0].orFilters).toContain(
      `owner_id.eq.${userId},and(owner_id.is.null,metadata->>public_corpus.eq.true)`,
    );
  });

  it("redacts owner-internal fields when an authenticated user reads a public document they do not own", async () => {
    const client = createSupabaseMock((call) => {
      if (call.table === "documents" && matchesOwnerReadScope(call, userId)) {
        return ok(
          documentDetailRow({
            owner_id: null,
            title: "Public guideline",
            storage_path: "someone-else/documents/guideline.pdf",
            content_hash: "sha256:leaky-hash",
            source_path: "/import/guideline.pdf",
            import_batch_id: "batch-99",
            error_message: "internal stage error",
            metadata: {
              public_corpus: true,
              review_date: "2025-06-30",
              index_generation_id: "generation-a",
              extraction_quality: "good",
            },
          }),
        );
      }
      if (call.table === "document_summaries") {
        return ok({
          id: "summary-1",
          document_id: documentId,
          owner_id: null,
          summary: "Public summary text.",
          clinical_specifics: {},
          source_chunk_ids: ["chunk-a", "chunk-b"],
          source_image_ids: ["image-a"],
          model: "gpt-internal",
          metadata: { internal_note: "owner only" },
          generated_at: "2026-01-01T00:00:00.000Z",
        });
      }
      if (call.table === "document_pages") return ok([]);
      if (call.table === "document_images") return ok([]);
      if (call.table === "document_chunks") return ok([]);
      if (call.table === "document_table_facts") return ok([]);
      return ok([]);
    });
    mockRuntime(client);
    const { GET } = await import("../src/app/api/documents/[id]/route");

    const response = await GET(authenticatedRequest(`/api/documents/${documentId}`), {
      params: Promise.resolve({ id: documentId }),
    });
    const body = await payload(response);
    const document = body.document as Record<string, unknown>;

    expect(response.status).toBe(200);
    // The caller can still read the shared public document...
    expect(document).toMatchObject({ id: documentId, title: "Public guideline" });
    expect(body.publicReviewDate).toBe("2025-06-30");
    expect(client.calls[0].orFilters).toContain(
      `owner_id.eq.${userId},and(owner_id.is.null,metadata->>public_corpus.eq.true)`,
    );
    // ...but not the owner's storage location, dedup hash, import provenance, raw error, metadata,
    // or index-health diagnostics — an authed non-owner gets the same redacted view as anonymous.
    expect(document).not.toHaveProperty("storage_path");
    expect(document).not.toHaveProperty("content_hash");
    expect(document).not.toHaveProperty("source_path");
    expect(document).not.toHaveProperty("import_batch_id");
    expect(document).not.toHaveProperty("error_message");
    expect(document).not.toHaveProperty("owner_id");
    expect(document).not.toHaveProperty("metadata");
    expect(body).not.toHaveProperty("indexHealth");
    // The public document's generated summary is readable, but its owner-internal provenance
    // (chunk/image source IDs, generation model, owner_id, metadata) must be redacted.
    const summary = document.summary as Record<string, unknown> | null;
    expect(summary).toMatchObject({ summary: "Public summary text." });
    expect(summary).not.toHaveProperty("source_chunk_ids");
    expect(summary).not.toHaveProperty("source_image_ids");
    expect(summary).not.toHaveProperty("model");
    expect(summary).not.toHaveProperty("owner_id");
    expect(summary).not.toHaveProperty("metadata");
  });

  it("returns full owner-internal fields when the authenticated caller owns the document", async () => {
    const client = createSupabaseMock((call) => {
      if (call.table === "documents" && matchesOwnerReadScope(call, userId)) {
        return ok(
          documentDetailRow({
            title: "Owned guideline",
            content_hash: "sha256:owned-hash",
            metadata: { index_generation_id: "generation-a", extraction_quality: "good" },
          }),
        );
      }
      if (call.table === "document_summaries" && call.maybeSingle) return ok(null);
      if (["document_pages", "document_images", "document_chunks", "document_table_facts"].includes(call.table)) {
        return ok([]);
      }
      return ok([]);
    });
    mockRuntime(client);
    const { GET } = await import("../src/app/api/documents/[id]/route");

    const response = await GET(authenticatedRequest(`/api/documents/${documentId}`), {
      params: Promise.resolve({ id: documentId }),
    });
    const body = await payload(response);
    const document = body.document as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(document).toMatchObject({
      id: documentId,
      owner_id: userId,
      storage_path: `${userId}/documents/guideline.pdf`,
      content_hash: "sha256:owned-hash",
    });
    expect(body).toHaveProperty("indexHealth");
  });

  it("allows anonymous users to read public document detail", async () => {
    const client = createSupabaseMock((call) => {
      if (call.table === "documents" && matchesOwnerReadScope(call)) {
        return ok(
          documentDetailRow({
            owner_id: null,
            title: "Public guideline",
            metadata: { index_generation_id: "generation-a" },
          }),
        );
      }
      if (call.table === "document_summaries" && call.maybeSingle) return ok(null);
      if (["document_pages", "document_images", "document_chunks", "document_table_facts"].includes(call.table)) {
        return ok([]);
      }
      return ok([]);
    });
    mockRuntime(client);
    const { GET } = await import("../src/app/api/documents/[id]/route");

    const response = await GET(request(`/api/documents/${documentId}`), {
      params: Promise.resolve({ id: documentId }),
    });
    const body = await payload(response);

    expect(response.status).toBe(200);
    expect(body.document).toMatchObject({ id: documentId, title: "Public guideline" });
    expect(body.document).not.toHaveProperty("owner_id");
    expect(client.auth.getUser).not.toHaveBeenCalled();
    expect(client.calls[0].filters).toContainEqual({ column: "owner_id", value: null });
  });

  it("allows authenticated users to open public document signed URLs", async () => {
    const client = createSupabaseMock((call) => {
      if (call.table === "documents" && matchesOwnerReadScope(call, userId)) {
        return ok({ storage_path: "public/documents/guideline.pdf", file_type: "application/pdf" });
      }
      return ok(null);
    });
    mockRuntime(client);
    const { GET } = await import("../src/app/api/documents/[id]/signed-url/route");

    const response = await GET(authenticatedRequest(`/api/documents/${documentId}/signed-url`), {
      params: Promise.resolve({ id: documentId }),
    });

    expect(response.status).toBe(200);
    expect((await payload(response)).url).toContain("public/documents/guideline.pdf");
  });

  it("rejects an invalid bearer header even when a valid cookie is also present", async () => {
    const documents = [{ id: documentId, owner_id: userId, title: "Owned document" }];
    const client = createSupabaseMock((call) => (call.table === "documents" ? ok(documents) : ok([])));
    mockRuntime(client);
    const { GET } = await import("../src/app/api/documents/route");

    const response = await GET(
      request("/api/documents", {
        headers: {
          authorization: "Bearer expired-token",
          cookie: `sb-access-token=${token}`,
        },
      }),
    );
    const body = await payload(response);

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ code: "authentication_required" });
    expect(client.auth.getUser).toHaveBeenCalledTimes(1);
    expect(client.auth.getUser).toHaveBeenCalledWith("expired-token");
  });

  it("omits internal document list fields for anonymous callers", async () => {
    const documents = [{ id: documentId, title: "Public guideline", status: "indexed" }];
    const client = createSupabaseMock((call) => (call.table === "documents" ? ok(documents) : ok([])));
    mockRuntime(client);
    const { GET } = await import("../src/app/api/documents/route");

    const response = await GET(request("/api/documents?includeMeta=true"));
    const body = await payload(response);

    expect(response.status).toBe(200);
    expect(client.calls[0].selected).not.toContain("storage_path");
    expect(client.calls[0].selected).not.toContain("content_hash");
    expect(body.documents).toEqual(documents);
  });

  it("rate limits anonymous document read bursts", async () => {
    const client = createSupabaseMock((call) => (call.table === "documents" ? ok([]) : ok([])));
    mockRuntime(client);
    client.rpc.mockImplementation(async (name: string, args?: Record<string, unknown>) => {
      if (name === "consume_api_subject_rate_limit" && args?.p_bucket === "document_read") {
        return {
          data: [rateLimitRow({ limited: true, remaining: 0, retry_after_seconds: 30 })],
          error: null,
        };
      }
      if (name === "consume_api_rate_limit") {
        return { data: [rateLimitRow()], error: null };
      }
      return ok([]);
    });
    const { GET } = await import("../src/app/api/documents/route");

    const response = await GET(request("/api/documents"));

    expect(response.status).toBe(429);
    expect(await payload(response)).toMatchObject({
      error: "Document requests are rate limited. Try again shortly.",
      details: { kind: "rate_limit", retryAfterSeconds: 30 },
    });
    expect(client.rpc).toHaveBeenCalledWith(
      "consume_api_subject_rate_limit",
      expect.objectContaining({ p_bucket: "document_read" }),
    );
  });

  it("does not return raw internal database errors", async () => {
    const client = createSupabaseMock(() => fail("secret storage path and connection details"));
    mockRuntime(client);
    const { GET } = await import("../src/app/api/documents/route");

    const response = await GET(authenticatedRequest("/api/documents"));

    expect(response.status).toBe(500);
    expect(await payload(response)).toMatchObject({ error: "Request failed." });
  });

  it("does not leak demo documents from real-mode listing failures", async () => {
    const client = createSupabaseMock(() => {
      throw new Error("Missing server environment variables: SUPABASE_SERVICE_ROLE_KEY. See .env.example.");
    });
    mockRuntime(client);
    const { GET } = await import("../src/app/api/documents/route");

    const response = await GET(authenticatedRequest("/api/documents"));
    const body = await payload(response);

    expect(response.status).toBe(500);
    expect(body).toMatchObject({ error: "Request failed." });
    expect(body.documents).toBeUndefined();
    expect(body.demoMode).toBeUndefined();
  });

  it("allows document signed URLs only for owned documents", async () => {
    const client = createSupabaseMock((call) => {
      if (call.table === "documents" && matchesOwnerReadScope(call, userId)) {
        return ok({ storage_path: `${userId}/documents/${documentId}/source.pdf`, file_type: "application/pdf" });
      }
      return ok(null);
    });
    mockRuntime(client);
    const { GET } = await import("../src/app/api/documents/[id]/signed-url/route");

    const response = await GET(authenticatedRequest(`/api/documents/${documentId}/signed-url`), {
      params: Promise.resolve({ id: documentId }),
    });
    const body = await payload(response);

    expect(response.status).toBe(200);
    expect(body.url).toContain(`${userId}/documents/${documentId}/source.pdf`);
    expect(client.storageMocks.createSignedUrl).toHaveBeenCalledWith(
      `${userId}/documents/${documentId}/source.pdf`,
      600,
    );
  });

  it("rejects document signed URLs for another user's document", async () => {
    const client = createSupabaseMock(() => ok(null));
    mockRuntime(client);
    const { GET } = await import("../src/app/api/documents/[id]/signed-url/route");

    const response = await GET(authenticatedRequest(`/api/documents/${otherDocumentId}/signed-url`), {
      params: Promise.resolve({ id: otherDocumentId }),
    });

    expect(response.status).toBe(404);
    expect(await payload(response)).toMatchObject({ error: "Document not found." });
    expect(client.storageMocks.createSignedUrl).not.toHaveBeenCalled();
  });

  it("allows anonymous signed URLs for public documents", async () => {
    const client = createSupabaseMock((call) => {
      if (
        call.table === "documents" &&
        call.filters.some((filter) => filter.column === "owner_id" && filter.value === null)
      ) {
        return ok({ storage_path: "public/documents/guideline.pdf", file_type: "application/pdf" });
      }
      return ok(null);
    });
    mockRuntime(client);
    const { GET } = await import("../src/app/api/documents/[id]/signed-url/route");

    const response = await GET(request(`/api/documents/${documentId}/signed-url`), {
      params: Promise.resolve({ id: documentId }),
    });
    const body = await payload(response);

    expect(response.status).toBe(200);
    expect(body.url).toContain("public/documents/guideline.pdf");
    expect(client.auth.getUser).not.toHaveBeenCalled();
  });

  it("rejects anonymous signed URLs for private documents", async () => {
    const client = createSupabaseMock((call) => {
      if (call.table === "documents" && call.filters.some((filter) => filter.column === "owner_id")) {
        return ok(null);
      }
      return ok(null);
    });
    mockRuntime(client);
    const { GET } = await import("../src/app/api/documents/[id]/signed-url/route");

    const response = await GET(request(`/api/documents/${otherDocumentId}/signed-url`), {
      params: Promise.resolve({ id: otherDocumentId }),
    });

    expect(response.status).toBe(404);
    expect(await payload(response)).toMatchObject({ error: "Document not found." });
    expect(client.storageMocks.createSignedUrl).not.toHaveBeenCalled();
  });

  it("allows image signed URLs only when the parent document is owned", async () => {
    const client = createSupabaseMock((call) => {
      if (call.table === "document_images") {
        return ok({
          document_id: documentId,
          storage_path: `${userId}/images/${imageId}.png`,
          mime_type: "image/png",
          caption: "Owned image",
          metadata: { index_generation_id: "generation-a" },
        });
      }
      if (call.table === "documents" && matchesOwnerReadScope(call, userId)) {
        return ok({ id: documentId, metadata: { index_generation_id: "generation-a" } });
      }
      return ok(null);
    });
    mockRuntime(client);
    const { GET } = await import("../src/app/api/images/[id]/signed-url/route");

    const response = await GET(authenticatedRequest(`/api/images/${imageId}/signed-url`), {
      params: Promise.resolve({ id: imageId }),
    });
    const body = await payload(response);

    expect(response.status).toBe(200);
    expect(body.mimeType).toBe("image/png");
    expect(client.storageMocks.createSignedUrl).toHaveBeenCalledWith(`${userId}/images/${imageId}.png`, 600);
  });

  it("allows anonymous image signed URLs when the parent document is public", async () => {
    const client = createSupabaseMock((call) => {
      if (call.table === "document_images") {
        return ok({
          document_id: documentId,
          storage_path: `public/images/${imageId}.png`,
          mime_type: "image/png",
          caption: "Public image",
          metadata: { index_generation_id: "generation-a" },
        });
      }
      if (call.table === "documents" && matchesOwnerReadScope(call)) {
        return ok({ id: documentId, metadata: { index_generation_id: "generation-a" } });
      }
      return ok(null);
    });
    mockRuntime(client);
    const { GET } = await import("../src/app/api/images/[id]/signed-url/route");

    const response = await GET(request(`/api/images/${imageId}/signed-url`), {
      params: Promise.resolve({ id: imageId }),
    });
    const body = await payload(response);

    expect(response.status).toBe(200);
    expect(body.mimeType).toBe("image/png");
    expect(client.auth.getUser).not.toHaveBeenCalled();
    expect(client.storageMocks.createSignedUrl).toHaveBeenCalledWith(`public/images/${imageId}.png`, 600);
  });

  /*
   * Audit L11 boundary case, pinned separately from the sibling below.
   *
   * A TRULY legacy image — one written before the worker began stamping
   * `document_images.metadata.index_generation_id` (worker/main.ts gained that
   * stamp in the same commit that introduced `commit_document_index_generation`,
   * which stamps the parent document in the same transaction) — carries NO
   * generation of its own. That is the SQL predicate's unconditional
   * `row_generation is null` arm, so such an image stays accessible whatever the
   * parent document carries. This case exists so the L11 fail-closed change can
   * never be widened into "a legacy document loses its images".
   */
  it("allows signed URLs for an unstamped legacy image on an unstamped document", async () => {
    const client = createSupabaseMock((call) => {
      if (call.table === "document_images") {
        return ok({
          document_id: documentId,
          storage_path: `${userId}/images/${imageId}.png`,
          mime_type: "image/png",
          caption: "Legacy indexed image",
          metadata: {},
        });
      }
      if (call.table === "documents" && matchesOwnerReadScope(call, userId)) {
        return ok({ id: documentId, metadata: {} });
      }
      return ok(null);
    });
    mockRuntime(client);
    const { GET } = await import("../src/app/api/images/[id]/signed-url/route");

    const response = await GET(authenticatedRequest(`/api/images/${imageId}/signed-url`), {
      params: Promise.resolve({ id: imageId }),
    });
    const body = await payload(response);

    expect(response.status).toBe(200);
    expect(body.mimeType).toBe("image/png");
    expect(client.storageMocks.createSignedUrl).toHaveBeenCalledWith(`${userId}/images/${imageId}.png`, 600);
  });

  it("fails with 500 when storage createSignedUrl returns a missing signedUrl", async () => {
    const client = createSupabaseMock((call) => {
      if (call.table === "document_images") {
        return ok({
          document_id: documentId,
          storage_path: `${userId}/images/${imageId}.png`,
          mime_type: "image/png",
          caption: "Legacy indexed image",
          metadata: {},
        });
      }
      if (call.table === "documents" && matchesOwnerReadScope(call, userId)) {
        return ok({ id: documentId, metadata: {} });
      }
      return ok(null);
    });
    client.storageMocks.createSignedUrl.mockResolvedValueOnce({
      data: { signedUrl: "" },
      error: null,
    });
    mockRuntime(client);
    const { GET } = await import("../src/app/api/images/[id]/signed-url/route");

    const response = await GET(authenticatedRequest(`/api/images/${imageId}/signed-url`), {
      params: Promise.resolve({ id: imageId }),
    });

    expect(response.status).toBe(500);
    expect(await payload(response)).toMatchObject({
      error: "Failed to generate signed URL for image.",
    });
  });

  /*
   * Audit L11. This case previously asserted 200 and named itself "legacy", but its
   * fixture is not a legacy image: the image CARRIES a generation while its parent
   * document carries none. The SQL predicate excludes exactly that shape —
   * `is_committed_artifact_generation` (supabase/schema.sql) is
   * `row_generation is null or row_generation = document_generation`, and
   * `'generation-a' = NULL` is NULL, not true. So the old expectation pinned the
   * TypeScript predicate being MORE permissive than the database, which is the
   * defect L11 exists to remove.
   *
   * The genuinely legacy shape (image with no generation) is pinned by the sibling
   * case above and still returns 200, so no legacy document loses its images.
   * This case now pins the staged/abandoned shape the SQL refuses.
   */
  it("refuses a stamped image whose parent document has no committed generation", async () => {
    const client = createSupabaseMock((call) => {
      if (call.table === "document_images") {
        return ok({
          document_id: documentId,
          storage_path: `${userId}/images/${imageId}.png`,
          mime_type: "image/png",
          caption: "Staged image from an uncommitted generation",
          metadata: { index_generation_id: "generation-a" },
        });
      }
      if (call.table === "documents" && matchesOwnerReadScope(call, userId)) {
        return ok({ id: documentId, metadata: {} });
      }
      return ok(null);
    });
    mockRuntime(client);
    const { GET } = await import("../src/app/api/images/[id]/signed-url/route");

    const response = await GET(authenticatedRequest(`/api/images/${imageId}/signed-url`), {
      params: Promise.resolve({ id: imageId }),
    });

    expect(response.status).toBe(404);
    expect(client.storageMocks.createSignedUrl).not.toHaveBeenCalled();
  });

  it("rejects image signed URLs for uncommitted replacement generations", async () => {
    const client = createSupabaseMock((call) => {
      if (call.table === "document_images") {
        return ok({
          document_id: documentId,
          storage_path: `${userId}/images/${imageId}.png`,
          mime_type: "image/png",
          caption: "Replacement image",
          metadata: { index_generation_id: "generation-new" },
        });
      }
      if (call.table === "documents" && matchesOwnerReadScope(call, userId)) {
        return ok({ id: documentId, metadata: { index_generation_id: "generation-old" } });
      }
      return ok(null);
    });
    mockRuntime(client);
    const { GET } = await import("../src/app/api/images/[id]/signed-url/route");

    const response = await GET(authenticatedRequest(`/api/images/${imageId}/signed-url`), {
      params: Promise.resolve({ id: imageId }),
    });

    expect(response.status).toBe(404);
    expect(client.storageMocks.createSignedUrl).not.toHaveBeenCalled();
  });

  it("rejects image signed URLs when the parent document belongs to another user", async () => {
    const client = createSupabaseMock((call) => {
      if (call.table === "document_images") {
        return ok({
          document_id: otherDocumentId,
          storage_path: `${otherUserId}/images/${imageId}.png`,
          mime_type: "image/png",
          caption: "Other image",
        });
      }
      return ok(null);
    });
    mockRuntime(client);
    const { GET } = await import("../src/app/api/images/[id]/signed-url/route");

    const response = await GET(authenticatedRequest(`/api/images/${imageId}/signed-url`), {
      params: Promise.resolve({ id: imageId }),
    });

    expect(response.status).toBe(404);
    expect(await payload(response)).toMatchObject({ error: "Image not found." });
    expect(client.storageMocks.createSignedUrl).not.toHaveBeenCalled();
  });

  /*
   * Batch sibling of the five `/api/images/[id]/signed-url` cases above.
   * `/api/images/signed-urls` mints up to 100 signed URLs per call and carries its
   * OWN owner-scope and committed-generation implementation. `check:owner-scope-api`
   * cannot cover the real protection here: `document_images` has no `owner_id`
   * column, so the only thing keeping another owner's image out of the response is
   * the `documentMap` join filter in the handler. These cases pin that filter.
   */
  const otherImageId = "44444444-4444-4444-8444-444444444444";

  function signedUrlsRequest(imageIds: string[], authenticated = true) {
    const init: RequestInit = {
      method: "POST",
      body: JSON.stringify({ imageIds }),
      headers: { "content-type": "application/json" },
    };
    return authenticated
      ? authenticatedRequest("/api/images/signed-urls", init)
      : request("/api/images/signed-urls", init);
  }

  /** Two images on two documents with different owners, plus owner-scoped document reads. */
  function createBatchImageMock(options: { imageGeneration?: string; documentGeneration?: string } = {}) {
    const imageGeneration = options.imageGeneration ?? "generation-a";
    const documentGeneration = options.documentGeneration ?? "generation-a";
    return createSupabaseMock((call) => {
      if (call.table === "document_images") {
        const requested = call.inFilters.find((filter) => filter.column === "id")?.values ?? [];
        return ok(
          [
            {
              id: imageId,
              document_id: documentId,
              storage_path: `${userId}/images/${imageId}.png`,
              mime_type: "image/png",
              caption: "Owned image",
              metadata: { index_generation_id: imageGeneration },
            },
            {
              id: otherImageId,
              document_id: otherDocumentId,
              storage_path: `${otherUserId}/images/${otherImageId}.png`,
              mime_type: "image/png",
              caption: "Other owner's image",
              metadata: { index_generation_id: imageGeneration },
            },
          ].filter((image) => requested.includes(image.id)),
        );
      }
      if (call.table === "documents" && matchesOwnerReadScope(call, userId)) {
        // Only the caller's own document comes back from an owner-scoped read.
        return ok([{ id: documentId, metadata: { index_generation_id: documentGeneration } }]);
      }
      return ok([]);
    });
  }

  it("signs a batch of images whose parent documents are owned", async () => {
    const client = createBatchImageMock();
    mockRuntime(client);
    const { POST } = await import("../src/app/api/images/signed-urls/route");

    const response = await POST(signedUrlsRequest([imageId]));
    const body = await payload(response);

    expect(response.status).toBe(200);
    expect(body.urls).toMatchObject({
      [imageId]: { url: `https://signed.local/${userId}/images/${imageId}.png`, mimeType: "image/png" },
    });
    expect(client.storageMocks.createSignedUrls).toHaveBeenCalledWith([`${userId}/images/${imageId}.png`], 600);
  });

  it("fails with 500 when storage createSignedUrls returns a per-item error", async () => {
    const client = createBatchImageMock();
    client.storageMocks.createSignedUrls.mockResolvedValueOnce({
      data: [{ path: `${userId}/images/${imageId}.png`, signedUrl: "", error: "Object not found" as never }],
      error: null,
    } as never);
    mockRuntime(client);
    const { POST } = await import("../src/app/api/images/signed-urls/route");

    const response = await POST(signedUrlsRequest([imageId]));
    const body = await payload(response);

    expect(response.status).toBe(500);
    expect(body.error).toBe("Failed to generate signed URL for image: Object not found");
  });

  it("omits images whose parent document belongs to another user", async () => {
    const client = createBatchImageMock();
    mockRuntime(client);
    const { POST } = await import("../src/app/api/images/signed-urls/route");

    const response = await POST(signedUrlsRequest([otherImageId]));
    const body = await payload(response);

    expect(response.status).toBe(200);
    expect(body.urls).toEqual({});
    expect(client.storageMocks.createSignedUrls).not.toHaveBeenCalled();
  });

  it("signs only the owned image when a batch mixes owners", async () => {
    // The batch-specific leak: one unowned id riding along with an owned one must
    // not inherit the owned document's access.
    const client = createBatchImageMock();
    mockRuntime(client);
    const { POST } = await import("../src/app/api/images/signed-urls/route");

    const response = await POST(signedUrlsRequest([imageId, otherImageId]));
    const body = await payload(response);

    expect(response.status).toBe(200);
    expect(Object.keys(body.urls as Record<string, unknown>)).toEqual([imageId]);
    expect(client.storageMocks.createSignedUrls).toHaveBeenCalledWith([`${userId}/images/${imageId}.png`], 600);
  });

  it("scopes the batch document read to the caller", async () => {
    const client = createBatchImageMock();
    mockRuntime(client);
    const { POST } = await import("../src/app/api/images/signed-urls/route");

    await POST(signedUrlsRequest([imageId]));

    const documentReads = client.calls.filter((call) => call.table === "documents");
    expect(documentReads.length).toBeGreaterThan(0);
    expect(documentReads.every((call) => matchesOwnerReadScope(call, userId))).toBe(true);
  });

  it("restricts an anonymous batch to public documents", async () => {
    const client = createSupabaseMock((call) => {
      if (call.table === "document_images") {
        return ok([
          {
            id: imageId,
            document_id: documentId,
            storage_path: `${userId}/images/${imageId}.png`,
            mime_type: "image/png",
            caption: "Owned image",
            metadata: { index_generation_id: "generation-a" },
          },
        ]);
      }
      // No public document matches, so an anonymous caller gets nothing.
      if (call.table === "documents" && matchesOwnerReadScope(call)) return ok([]);
      return ok([]);
    });
    mockRuntime(client);
    const { POST } = await import("../src/app/api/images/signed-urls/route");

    const response = await POST(signedUrlsRequest([imageId], false));

    expect(response.status).toBe(200);
    expect(await payload(response)).toEqual({ urls: {} });
    expect(client.storageMocks.createSignedUrls).not.toHaveBeenCalled();
  });

  it("omits batch images from an uncommitted replacement generation", async () => {
    const client = createBatchImageMock({ imageGeneration: "generation-new", documentGeneration: "generation-old" });
    mockRuntime(client);
    const { POST } = await import("../src/app/api/images/signed-urls/route");

    const response = await POST(signedUrlsRequest([imageId]));

    expect(response.status).toBe(200);
    expect(await payload(response)).toEqual({ urls: {} });
    expect(client.storageMocks.createSignedUrls).not.toHaveBeenCalled();
  });

  it("returns an empty map for an empty batch without touching storage", async () => {
    const client = createBatchImageMock();
    mockRuntime(client);
    const { POST } = await import("../src/app/api/images/signed-urls/route");

    const response = await POST(signedUrlsRequest([]));

    expect(response.status).toBe(200);
    expect(await payload(response)).toEqual({ urls: {} });
    expect(client.storageMocks.createSignedUrls).not.toHaveBeenCalled();
  });

  it("rejects a batch of non-uuid image ids before querying", async () => {
    const client = createBatchImageMock();
    mockRuntime(client);
    const { POST } = await import("../src/app/api/images/signed-urls/route");

    const response = await POST(signedUrlsRequest(["not-a-uuid"]));

    expect(response.status).toBe(400);
    expect(client.storageMocks.createSignedUrls).not.toHaveBeenCalled();
  });

  it("rejects a batch larger than the documented maximum", async () => {
    const client = createBatchImageMock();
    mockRuntime(client);
    const { POST } = await import("../src/app/api/images/signed-urls/route");

    const tooMany = Array.from(
      { length: 101 },
      (_, index) => `55555555-5555-4555-8555-${String(index).padStart(12, "0")}`,
    );
    const response = await POST(signedUrlsRequest(tooMany));

    expect(response.status).toBe(400);
    expect(client.storageMocks.createSignedUrls).not.toHaveBeenCalled();
  });

  it("rejects anonymous uploads without touching storage", async () => {
    const client = createSupabaseMock();
    mockRuntime(client);
    const { POST } = await import("../src/app/api/upload/route");
    const formData = new FormData();
    formData.set("file", new File(["%PDF-1.7\n%%EOF"], "guideline.pdf", { type: "application/pdf" }));

    const response = await POST(
      request("/api/upload", {
        method: "POST",
        body: formData,
      }),
    );

    expect(response.status).toBe(401);
    expect(await payload(response)).toMatchObject({ code: "authentication_required" });
    expect(client.auth.getUser).not.toHaveBeenCalled();
    expect(client.storageMocks.upload).not.toHaveBeenCalled();
  });

  it("rejects an authenticated non-administrator upload", async () => {
    const client = createSupabaseMock();
    client.auth.getUser.mockImplementation(async (receivedToken?: string) =>
      receivedToken === token
        ? { data: { user: { id: userId, app_metadata: { site_role: "user" } } }, error: null }
        : { data: { user: null }, error: { message: "Invalid token" } },
    );
    mockRuntime(client);
    const { POST } = await import("../src/app/api/upload/route");
    const formData = new FormData();
    formData.set("file", new File(["%PDF-1.7\n%%EOF"], "guideline.pdf", { type: "application/pdf" }));

    const response = await POST(
      authenticatedRequest("/api/upload", {
        method: "POST",
        body: formData,
      }),
    );

    expect(response.status).toBe(403);
    expect(await payload(response)).toMatchObject({ code: "administrator_required" });
    expect(client.storageMocks.upload).not.toHaveBeenCalled();
  });

  it("rejects administrator uploads when proxy claims cannot be revalidated live", async () => {
    const client = createSupabaseMock();
    client.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: "Auth lookup failed" },
    });
    mockRuntime(client);
    const { POST } = await import("../src/app/api/upload/route");
    const { signProxyAuthPayload } = await import("../src/lib/supabase/proxy-auth-crypto");
    const previousServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-for-proxy-auth";
    const proxyHeader = signProxyAuthPayload(
      Buffer.from(JSON.stringify({ id: userId, appMetadata: { site_role: "administrator" } })).toString("base64"),
    );
    const formData = new FormData();
    formData.set("file", new File(["%PDF-1.7\n%%EOF"], "guideline.pdf", { type: "application/pdf" }));

    try {
      const response = await POST(
        request("/api/upload", {
          method: "POST",
          body: formData,
          headers: proxyHeader ? { "x-proxy-auth-user": proxyHeader } : undefined,
        }),
      );

      expect(response.status).toBe(401);
      expect(await payload(response)).toMatchObject({ code: "authentication_required" });
      expect(client.storageMocks.upload).not.toHaveBeenCalled();
    } finally {
      if (previousServiceRoleKey === undefined) {
        delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      } else {
        process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRoleKey;
      }
    }
  });

  it("fails closed for administrator uploads when the durable limiter is unavailable", async () => {
    const client = createSupabaseMock();
    client.rpc.mockImplementation(async (name: string) =>
      name === "consume_api_subject_rate_limit" ? fail("anonymous limiter table unavailable") : ok([]),
    );
    mockRuntime(client);
    const { POST } = await import("../src/app/api/upload/route");
    const formData = new FormData();
    formData.set("file", new File(["%PDF-1.7\n%%EOF"], "guideline.pdf", { type: "application/pdf" }));

    const response = await POST(
      authenticatedRequest("/api/upload", {
        method: "POST",
        body: formData,
      }),
    );

    expect(response.status).toBe(503);
    expect(await payload(response)).toMatchObject({ error: "Rate limit check is temporarily unavailable." });
    expect(client.storageMocks.upload).not.toHaveBeenCalled();
  });

  it("rejects an excessive Content-Length before parsing multipart data", async () => {
    const client = createSupabaseMock();
    mockRuntime(client);
    const { POST } = await import("../src/app/api/upload/route");
    const uploadRequest = authenticatedRequest("/api/upload", {
      method: "POST",
      headers: { "content-length": String(152 * 1024 * 1024) },
      body: new FormData(),
    });
    const formData = vi.spyOn(uploadRequest, "formData");

    const response = await POST(uploadRequest);

    expect(response.status).toBe(413);
    expect(formData).not.toHaveBeenCalled();
    expect(client.storageMocks.upload).not.toHaveBeenCalled();
  });

  it("rejects malformed Content-Length before parsing multipart data", async () => {
    const client = createSupabaseMock();
    mockRuntime(client);
    const { POST } = await import("../src/app/api/upload/route");
    const uploadRequest = authenticatedRequest("/api/upload", {
      method: "POST",
      headers: { "content-length": "-5" },
      body: new FormData(),
    });
    const formData = vi.spyOn(uploadRequest, "formData");

    const response = await POST(uploadRequest);

    expect(response.status).toBe(400);
    expect(formData).not.toHaveBeenCalled();
    expect(client.storageMocks.upload).not.toHaveBeenCalled();
  });

  it("fails closed for authenticated uploads when the durable limiter is unavailable", async () => {
    const client = createSupabaseMock();
    client.rpc.mockImplementation(async (name: string) =>
      name === "consume_api_rate_limit" ? fail("limiter unavailable") : ok([]),
    );
    mockRuntime(client);
    const { POST } = await import("../src/app/api/upload/route");
    const uploadRequest = authenticatedRequest("/api/upload", { method: "POST", body: new FormData() });
    const formData = vi.spyOn(uploadRequest, "formData");

    const response = await POST(uploadRequest);

    expect(response.status).toBe(503);
    expect(formData).not.toHaveBeenCalled();
    expect(client.storageMocks.upload).not.toHaveBeenCalled();
  });

  it("stops an already-aborted upload before multipart parsing", async () => {
    const client = createSupabaseMock();
    mockRuntime(client);
    const { POST } = await import("../src/app/api/upload/route");
    const controller = new AbortController();
    controller.abort();
    const uploadRequest = authenticatedRequest("/api/upload", {
      method: "POST",
      body: new FormData(),
      signal: controller.signal,
    });
    const formData = vi.spyOn(uploadRequest, "formData");

    const response = await POST(uploadRequest);

    expect(response.status).toBe(499);
    expect(await payload(response)).toMatchObject({ error: "Upload cancelled by client." });
    expect(formData).not.toHaveBeenCalled();
    expect(client.storageMocks.upload).not.toHaveBeenCalled();
  });

  it("rejects upload byte-budget exhaustion before multipart parsing", async () => {
    const client = createSupabaseMock();
    mockRuntime(client, undefined, { maxInFlightUploadMb: 1 });
    const { POST } = await import("../src/app/api/upload/route");
    const uploadRequest = authenticatedRequest("/api/upload", {
      method: "POST",
      headers: { "content-length": String(2 * 1024 * 1024) },
      body: new FormData(),
    });
    const formData = vi.spyOn(uploadRequest, "formData");

    const response = await POST(uploadRequest);

    expect(response.status).toBe(503);
    expect(await payload(response)).toMatchObject({
      error: "Upload capacity is temporarily exhausted. Retry shortly.",
    });
    expect(formData).not.toHaveBeenCalled();
  });

  it("stops after multipart parsing when the client aborts before buffering", async () => {
    const client = createSupabaseMock();
    mockRuntime(client);
    const { POST } = await import("../src/app/api/upload/route");
    const controller = new AbortController();
    const uploadRequest = authenticatedRequest("/api/upload", {
      method: "POST",
      body: new FormData(),
      signal: controller.signal,
    });
    const form = new FormData();
    form.set("file", new File(["%PDF-1.7\n%%EOF"], "guideline.pdf", { type: "application/pdf" }));
    vi.spyOn(uploadRequest, "formData").mockImplementation(async () => {
      controller.abort();
      return form;
    });

    const response = await POST(uploadRequest);

    expect(response.status).toBe(499);
    expect(client.storageMocks.upload).not.toHaveBeenCalled();
    expect(client.calls.some((call) => call.operation === "insert")).toBe(false);
  });

  it("cleans up storage and skips database inserts when aborted before insertion", async () => {
    const controller = new AbortController();
    const client = createSupabaseMock((call) => {
      if (call.table === "documents" && call.operation === "select" && call.maybeSingle) return ok(null);
      return ok([]);
    });
    client.storageMocks.upload.mockImplementation(async () => {
      controller.abort();
      return { data: { path: "uploaded" }, error: null };
    });
    mockRuntime(client);
    const { POST } = await import("../src/app/api/upload/route");
    const form = new FormData();
    form.set("file", new File(["%PDF-1.7\n%%EOF"], "guideline.pdf", { type: "application/pdf" }));

    const response = await POST(
      authenticatedRequest("/api/upload", { method: "POST", body: form, signal: controller.signal }),
    );

    expect(response.status).toBe(499);
    expect(client.calls.some((call) => call.operation === "insert")).toBe(false);
    expect(client.storageMocks.remove).toHaveBeenCalledTimes(1);
  });

  it("rejects concurrent upload capacity and releases it after the first request", async () => {
    const client = createSupabaseMock((call) => {
      if (call.table === "documents" && call.operation === "select" && call.maybeSingle) return ok(null);
      if (call.table === "documents" && call.operation === "insert") return ok({ id: documentId });
      if (call.table === "ingestion_jobs" && call.operation === "insert") return ok({ id: "job-1" });
      return ok([]);
    });
    mockRuntime(client, undefined, { maxConcurrentUploads: 1 });
    const { POST } = await import("../src/app/api/upload/route");
    const firstRequest = authenticatedRequest("/api/upload", {
      method: "POST",
      headers: { "content-length": "1024" },
      body: new FormData(),
    });
    let resolveForm!: (form: FormData) => void;
    vi.spyOn(firstRequest, "formData").mockReturnValue(
      new Promise<FormData>((resolve) => {
        resolveForm = resolve;
      }),
    );

    const firstResponsePromise = POST(firstRequest);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const rejectedRequest = authenticatedRequest("/api/upload", {
      method: "POST",
      headers: { "content-length": "1024" },
      body: new FormData(),
    });
    const rejectedFormData = vi.spyOn(rejectedRequest, "formData");
    const rejectedResponse = await POST(rejectedRequest);
    expect(rejectedResponse.status).toBe(503);
    expect(rejectedFormData).not.toHaveBeenCalled();

    const form = new FormData();
    form.set("file", new File(["%PDF-1.7\n%%EOF"], "guideline.pdf", { type: "application/pdf" }));
    resolveForm(form);
    expect((await firstResponsePromise).status).toBe(201);

    const afterRelease = new FormData();
    afterRelease.set("file", new File(["%PDF-1.7 revised\n%%EOF"], "second.pdf", { type: "application/pdf" }));
    const afterResponse = await POST(authenticatedRequest("/api/upload", { method: "POST", body: afterRelease }));
    expect(afterResponse.status).toBe(201);
  });

  it("releases upload admission after multipart parsing fails", async () => {
    const client = createSupabaseMock((call) => {
      if (call.table === "documents" && call.operation === "select" && call.maybeSingle) return ok(null);
      if (call.table === "documents" && call.operation === "insert") return ok({ id: documentId });
      if (call.table === "ingestion_jobs" && call.operation === "insert") return ok({ id: "job-1" });
      return ok([]);
    });
    mockRuntime(client, undefined, { maxConcurrentUploads: 1, maxInFlightUploadMb: 1 });
    const { POST } = await import("../src/app/api/upload/route");
    const failedRequest = authenticatedRequest("/api/upload", {
      method: "POST",
      headers: { "content-length": "1024" },
      body: new FormData(),
    });
    vi.spyOn(failedRequest, "formData").mockRejectedValue(new Error("malformed multipart"));

    const failedResponse = await POST(failedRequest);
    expect(failedResponse.status).toBe(400);

    const form = new FormData();
    form.set("file", new File(["%PDF-1.7\n%%EOF"], "guideline.pdf", { type: "application/pdf" }));
    const admittedResponse = await POST(
      authenticatedRequest("/api/upload", {
        method: "POST",
        headers: { "content-length": "1024" },
        body: form,
      }),
    );

    expect(admittedResponse.status).toBe(201);
    expect(client.storageMocks.upload).toHaveBeenCalledTimes(1);
  });

  it("cleans up document and storage when aborted after the atomic upload enqueue", async () => {
    const controller = new AbortController();
    const client = createSupabaseMock((call) => {
      if (call.table === "documents" && call.operation === "select" && call.maybeSingle) return ok(null);
      if (call.table === "documents" && call.operation === "insert") {
        controller.abort();
        return ok({ id: documentId });
      }
      return ok([]);
    });
    mockRuntime(client);
    const { POST } = await import("../src/app/api/upload/route");
    const form = new FormData();
    form.set("file", new File(["%PDF-1.7\n%%EOF"], "guideline.pdf", { type: "application/pdf" }));

    const response = await POST(
      authenticatedRequest("/api/upload", { method: "POST", body: form, signal: controller.signal }),
    );

    expect(response.status).toBe(499);
    expect(client.calls.filter((call) => call.table === "documents" && call.operation === "insert")).toHaveLength(1);
    expect(client.calls.some((call) => call.table === "ingestion_jobs" && call.operation === "insert")).toBe(true);
    expect(client.calls.filter((call) => call.table === "documents" && call.operation === "delete")).toHaveLength(1);
    expect(client.storageMocks.remove).toHaveBeenCalledTimes(1);
  });

  it("stores uploaded documents with owner_id and a user-scoped storage path", async () => {
    const client = createSupabaseMock((call) => {
      if (call.table === "documents" && call.operation === "insert") {
        const inserted = call.insertPayload as { id: string; owner_id: string; storage_path: string };
        return ok({ id: inserted.id, owner_id: inserted.owner_id, storage_path: inserted.storage_path });
      }
      if (call.table === "ingestion_jobs" && call.operation === "insert") {
        return ok({ id: "job-1", document_id: documentId });
      }
      return ok([]);
    });
    mockRuntime(client);
    const { POST } = await import("../src/app/api/upload/route");
    const formData = new FormData();
    formData.set("file", new File(["%PDF-1.7\n%%EOF"], "guideline.pdf", { type: "application/pdf" }));
    formData.set("title", "Guideline");

    const response = await POST(
      authenticatedRequest("/api/upload", {
        method: "POST",
        body: formData,
      }),
    );
    const documentInsert = client.calls.find((call) => call.table === "documents" && call.operation === "insert");
    const inserted = documentInsert?.insertPayload as { owner_id: string; storage_path: string };
    const uploadPath = client.storageMocks.upload.mock.calls[0]?.[0] as string;

    expect(response.status).toBe(201);
    expect(inserted.owner_id).toBe(userId);
    expect(inserted.storage_path).toBe(uploadPath);
    expect(uploadPath).toMatch(new RegExp(`^${userId}/documents/[0-9a-f-]+/guideline\\.pdf$`));
    expect(client.storageMocks.remove).not.toHaveBeenCalled();
  });

  it("does not mint Official/Trusted publisher_code from a spoofable upload filename", async () => {
    const client = createSupabaseMock((call) => {
      if (call.table === "documents" && call.operation === "insert") {
        const inserted = call.insertPayload as {
          id: string;
          file_name: string;
          metadata: Record<string, unknown>;
        };
        return ok({ id: inserted.id, file_name: inserted.file_name, metadata: inserted.metadata });
      }
      if (call.table === "ingestion_jobs" && call.operation === "insert") {
        return ok({ id: "job-1", document_id: documentId });
      }
      return ok([]);
    });
    mockRuntime(client);
    const { POST } = await import("../src/app/api/upload/route");
    const formData = new FormData();
    formData.set("file", new File(["%PDF-1.7\n%%EOF"], "WACHS-anything.pdf", { type: "application/pdf" }));
    formData.set("title", "WACHS lithium spoof");

    const response = await POST(
      authenticatedRequest("/api/upload", {
        method: "POST",
        body: formData,
      }),
    );
    const documentInsert = client.calls.find((call) => call.table === "documents" && call.operation === "insert");
    const inserted = documentInsert?.insertPayload as {
      file_name: string;
      metadata: Record<string, unknown>;
    };

    expect(response.status).toBe(201);
    expect(inserted.file_name).toBe("WACHS-anything.pdf");
    expect(inserted.metadata.publisher_code).toBeNull();
    expect(inserted.metadata.publisher).toBeNull();
    // Jurisdiction is null for the same reason the two fields above are. It used
    // to be seeded to "Australia/WA", which meant a file named WACHS-anything.pdf
    // did mint a WA locality claim even while the publisher fields correctly
    // refused to. The owner sets jurisdiction through the documents bulk metadata
    // route, which resolves it against the authority register.
    expect(inserted.metadata.jurisdiction).toBeNull();
  });

  it("assigns a smart unique title when a different document has the same upload name", async () => {
    const client = createSupabaseMock((call) => {
      if (call.table === "documents" && call.operation === "select" && call.maybeSingle) {
        return ok(null);
      }
      if (call.table === "documents" && call.operation === "select") {
        return ok([{ id: "existing-doc", title: "Guideline", file_name: "guideline.pdf", content_hash: "other-hash" }]);
      }
      if (call.table === "documents" && call.operation === "insert") {
        const inserted = call.insertPayload as { id: string; title: string; metadata: Record<string, unknown> };
        return ok({ id: inserted.id, title: inserted.title, metadata: inserted.metadata });
      }
      if (call.table === "ingestion_jobs" && call.operation === "insert") {
        return ok({ id: "job-1", document_id: documentId });
      }
      return ok([]);
    });
    mockRuntime(client);
    const { POST } = await import("../src/app/api/upload/route");
    const formData = new FormData();
    formData.set("file", new File(["%PDF-1.7 revised\n%%EOF"], "guideline.pdf", { type: "application/pdf" }));

    const response = await POST(
      authenticatedRequest("/api/upload", {
        method: "POST",
        body: formData,
      }),
    );
    const documentInsert = client.calls.find((call) => call.table === "documents" && call.operation === "insert");
    const inserted = documentInsert?.insertPayload as { title: string; metadata: Record<string, unknown> };

    expect(response.status).toBe(201);
    expect(inserted.title).toBe("Guideline (Copy 2)");
    expect(inserted.metadata.smart_title_base).toBe("Guideline");
    expect(inserted.metadata.smart_title_duplicate_reason).toBe("same_title_or_filename");
    expect(inserted.metadata.smart_title_duplicate_index).toBe(2);
  });

  it("alerts on exact-copy uploads without storing or queueing a duplicate", async () => {
    const duplicate = {
      id: documentId,
      title: "Existing guideline",
      file_name: "guideline.pdf",
      status: "failed",
      page_count: 4,
      chunk_count: 8,
      image_count: 1,
      created_at: "2026-05-27T00:00:00.000Z",
    };
    const client = createSupabaseMock((call) => (call.table === "documents" ? ok(duplicate) : ok([])));
    mockRuntime(client);
    const { POST } = await import("../src/app/api/upload/route");
    const formData = new FormData();
    formData.set("file", new File(["%PDF-1.7\n%%EOF"], "guideline.pdf", { type: "application/pdf" }));

    const response = await POST(
      authenticatedRequest("/api/upload", {
        method: "POST",
        body: formData,
      }),
    );
    const body = await payload(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      duplicate: true,
      duplicateReason: "exact_content_hash",
      document: duplicate,
    });
    expect(String(body.message)).toContain("Exact copy already exists");
    expect(client.calls[0].filters).toContainEqual({ column: "owner_id", value: userId });
    expect(client.storageMocks.upload).not.toHaveBeenCalled();
    expect(client.calls.some((call) => call.table === "ingestion_jobs" && call.operation === "insert")).toBe(false);
  });

  it("returns first-class document matches for document-focused search", async () => {
    const client = createSupabaseMock((call) => {
      if (call.table === "document_labels") {
        return ok([
          {
            id: "label-1",
            document_id: documentId,
            label: "agitation",
            label_type: "topic",
            source: "generated",
            confidence: 0.9,
          },
        ]);
      }
      if (call.table === "document_summaries") {
        return ok([{ document_id: documentId, summary: "High-yield agitation management guidance." }]);
      }
      if (call.table === "document_images") {
        return ok([
          {
            document_id: documentId,
            source_kind: "table_crop",
            searchable: true,
            image_type: "clinical_table",
            clinical_relevance_score: 0.9,
            metadata: { clinical_use_class: "clinical_evidence" },
          },
          {
            document_id: documentId,
            source_kind: "embedded",
            searchable: true,
            image_type: "graph",
            clinical_relevance_score: 0.82,
            metadata: { clinical_use_class: "clinical_evidence" },
          },
        ]);
      }
      return ok([]);
    });
    client.rpc.mockImplementation(async (name: string) =>
      name === "consume_api_rate_limit"
        ? { data: [rateLimitRow()], error: null }
        : {
            data: [
              {
                document_id: documentId,
                labels: [
                  {
                    id: "label-1",
                    document_id: documentId,
                    label: "agitation",
                    label_type: "topic",
                    source: "generated",
                    confidence: 0.9,
                  },
                ],
                summary: "High-yield agitation management guidance.",
              },
            ],
            error: null,
          },
    );
    mockRuntime(client, {
      searchChunksWithTelemetry: vi.fn(async () => ({
        results: [
          {
            id: "chunk-1",
            document_id: documentId,
            title: "Agitation and arousal",
            file_name: "MHSP.AgitationArousalPharmaMgt.pdf",
            page_number: 3,
            chunk_index: 0,
            section_heading: "Management",
            content: "Agitation management table text.",
            image_ids: ["private-search-image"],
            similarity: 0.9,
            hybrid_score: 0.92,
            images: [
              {
                id: "private-search-image",
                page_number: 3,
                storage_path: `${otherUserId}/images/private-search-image.png`,
                source_kind: "table_crop",
                sourceKind: "table_crop",
                image_type: "clinical_table",
                clinicalUseClass: "clinical_evidence",
                searchable: true,
                clinical_relevance_score: 0.9,
                caption: "Agitation management table.",
              },
            ],
          },
        ],
        telemetry: {
          retrieval_strategy: "text",
          search_cache_hit: false,
          embedding_skipped: true,
          embedding_cache_hit: false,
          text_fast_path_latency_ms: 10,
          embedding_latency_ms: 0,
          supabase_rpc_latency_ms: 12,
          rerank_latency_ms: 1,
        },
      })),
    });
    const { POST } = await import("../src/app/api/search/route");

    const response = await POST(
      authenticatedRequest("/api/search", {
        method: "POST",
        body: JSON.stringify({ query: "agitation management tables", mode: "documents", documentLimit: 10 }),
      }),
    );
    const body = await payload(response);

    expect(response.status).toBe(200);
    expect(body.documentMatches).toEqual([
      expect.objectContaining({
        document_id: documentId,
        title: "Agitation and arousal",
        bestPages: [3],
        tableCount: 1,
        imageCount: 2,
        summarySnippet: "High-yield agitation management guidance.",
      }),
    ]);
    expect(body.relatedDocuments).toHaveLength(1);
    const resultRows = body.results as Array<{ images: Array<Record<string, unknown>> }>;
    expect(resultRows[0].images[0]).not.toHaveProperty("storage_path");
    expect(JSON.stringify(resultRows)).not.toContain(otherUserId);
  });

  it("accepts differentials as a standalone source-library search mode", async () => {
    const client = createSupabaseMock((call) => {
      if (call.table === "document_labels") {
        return ok([
          {
            id: "label-1",
            document_id: documentId,
            label: "acute confusion",
            label_type: "topic",
            source: "generated",
            confidence: 0.92,
          },
        ]);
      }
      if (call.table === "document_summaries") {
        return ok([{ document_id: documentId, summary: "Acute confusion differential guidance." }]);
      }
      if (call.table === "document_images") {
        return ok([]);
      }
      return ok([]);
    });
    client.rpc.mockImplementation(async (name: string) =>
      name === "consume_api_rate_limit"
        ? { data: [rateLimitRow()], error: null }
        : {
            data: [
              {
                document_id: documentId,
                labels: [
                  {
                    id: "label-1",
                    document_id: documentId,
                    label: "acute confusion",
                    label_type: "topic",
                    source: "generated",
                    confidence: 0.92,
                  },
                ],
                summary: "Acute confusion differential guidance.",
              },
            ],
            error: null,
          },
    );
    const searchChunksWithTelemetry = vi.fn(async () => ({
      results: [
        {
          id: "chunk-1",
          document_id: documentId,
          title: "Acute confusion differential guide",
          file_name: "acute-confusion-differentials.pdf",
          page_number: 4,
          chunk_index: 0,
          section_heading: "Differentials",
          content: "Acute confusion differentials include delirium, intoxication, seizure, withdrawal, and hypoxia.",
          image_ids: [],
          similarity: 0.9,
          hybrid_score: 0.93,
          images: [],
        },
      ],
      telemetry: {
        retrieval_strategy: "text",
        search_cache_hit: false,
        embedding_skipped: true,
        embedding_cache_hit: false,
        text_fast_path_latency_ms: 10,
        embedding_latency_ms: 0,
        supabase_rpc_latency_ms: 12,
        rerank_latency_ms: 1,
      },
    }));
    mockRuntime(client, { searchChunksWithTelemetry });
    const { POST } = await import("../src/app/api/search/route");

    const response = await POST(
      authenticatedRequest("/api/search", {
        method: "POST",
        body: JSON.stringify({
          query: "acute confusion after surgery",
          mode: "differentials",
          queryMode: "compare_guidance",
          documentLimit: 10,
        }),
      }),
    );
    const body = await payload(response);

    expect(response.status).toBe(200);
    expect(searchChunksWithTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: userId,
        query: "acute confusion after surgery",
        queryMode: "compare_guidance",
        topK: 12,
      }),
    );
    expect(body.documentMatches).toEqual([
      expect.objectContaining({
        document_id: documentId,
        title: "Acute confusion differential guide",
        bestPages: [4],
        summarySnippet: "Acute confusion differential guidance.",
      }),
    ]);
    expect(body.relatedDocuments).toHaveLength(1);
    expect(body.scope).toEqual(expect.objectContaining({ queryMode: "compare_guidance" }));
  });

  it("rejects unauthenticated reindex requests", async () => {
    const client = createSupabaseMock();
    mockRuntime(client);
    const { POST } = await import("../src/app/api/documents/[id]/reindex/route");

    const response = await POST(
      request(`/api/documents/${documentId}/reindex`, {
        method: "POST",
        body: JSON.stringify({ mode: "enrichment" }),
      }),
      { params: Promise.resolve({ id: documentId }) },
    );

    expect(response.status).toBe(401);
    expect(await payload(response)).toMatchObject({ error: "Authentication required." });
    expect(client.from).not.toHaveBeenCalled();
  });

  it("refuses to retry a job a live worker still holds (IDX-C3, B6)", async () => {
    const client = createSupabaseMock();
    // The route now consumes the ingestion_admin rate-limit bucket (its own
    // consume_api_rate_limit RPC call) before retry_ingestion_job_if_idle
    // (#L43), so a plain mockResolvedValueOnce would intercept that earlier
    // call instead. Target the retry RPC by name and fall through to the
    // mock's normal per-name behaviour (including the rate-limit check) for
    // everything else.
    const baseRpc = client.rpc.getMockImplementation()!;
    client.rpc.mockImplementation(async (name: string, args?: Record<string, unknown>) => {
      if (name === "retry_ingestion_job_if_idle") return ok({ outcome: "active_worker" });
      return baseRpc(name, args);
    });
    mockRuntime(client);
    const { POST } = await import("../src/app/api/ingestion/jobs/[id]/retry/route");

    const response = await POST(
      authenticatedRequest("/api/ingestion/jobs/99999999-9999-4999-8999-999999999999/retry", { method: "POST" }),
      {
        params: Promise.resolve({ id: "99999999-9999-4999-8999-999999999999" }),
      },
    );

    expect(response.status).toBe(409);
    expect(String((await payload(response)).error)).toContain("still being processed");
    expect(client.rpc).toHaveBeenCalledWith(
      "retry_ingestion_job_if_idle",
      expect.objectContaining({
        p_job_id: "99999999-9999-4999-8999-999999999999",
        p_owner_id: userId,
        p_stale_before: expect.any(String),
      }),
    );
    expect(client.calls).toHaveLength(0);
  });

  it("re-queues a stale/non-processing job without resetting the live index (IDX-C3, IDX-H1, B6)", async () => {
    const client = createSupabaseMock();
    // Same reason as the previous test: target the retry RPC by name so the
    // earlier rate-limit consume call keeps its own normal behaviour (#L43).
    const baseRpc = client.rpc.getMockImplementation()!;
    client.rpc.mockImplementation(async (name: string, args?: Record<string, unknown>) => {
      if (name === "retry_ingestion_job_if_idle") {
        return ok({
          outcome: "queued",
          job: { id: "99999999-9999-4999-8999-999999999999", document_id: documentId, status: "pending" },
        });
      }
      return baseRpc(name, args);
    });
    mockRuntime(client);
    const { POST } = await import("../src/app/api/ingestion/jobs/[id]/retry/route");

    const response = await POST(
      authenticatedRequest("/api/ingestion/jobs/99999999-9999-4999-8999-999999999999/retry", { method: "POST" }),
      {
        params: Promise.resolve({ id: "99999999-9999-4999-8999-999999999999" }),
      },
    );
    expect(response.status).toBe(200);
    expect(await payload(response)).toMatchObject({ job: { status: "pending", document_id: documentId } });
    expect(client.rpc).toHaveBeenCalledWith(
      "retry_ingestion_job_if_idle",
      expect.objectContaining({
        p_job_id: "99999999-9999-4999-8999-999999999999",
        p_owner_id: userId,
        p_max_attempts: expect.any(Number),
        p_next_run_at: expect.any(String),
        p_document_updated_at: expect.any(String),
      }),
    );
    expect(client.calls).toHaveLength(0);
  });

  it("returns failure when the transactional retry RPC rolls back", async () => {
    const retryJobId = "99999999-9999-4999-8999-999999999999";
    const client = createSupabaseMock();
    client.rpc.mockResolvedValueOnce(fail("transaction rolled back"));
    mockRuntime(client);
    const { POST } = await import("../src/app/api/ingestion/jobs/[id]/retry/route");

    const response = await POST(authenticatedRequest(`/api/ingestion/jobs/${retryJobId}/retry`, { method: "POST" }), {
      params: Promise.resolve({ id: retryJobId }),
    });

    expect(response.status).toBe(500);
    expect(String((await payload(response)).error)).toBe("Request failed.");
    expect(client.rpc).toHaveBeenCalledWith("retry_ingestion_job_if_idle", expect.any(Object));
    expect(client.calls).toHaveLength(0);
  });

  it("runs enrichment-only reindex for owned indexed documents using generic metadata", async () => {
    const document = {
      id: documentId,
      owner_id: userId,
      title: "Future Uploaded Protocol",
      file_name: "future-upload.pdf",
      source_path: "legacy/imports/rollback.pdf",
      import_batch_id: null,
      metadata: { existing: true },
    };
    const chunks = [
      {
        id: "chunk-1",
        page_number: 1,
        chunk_index: 0,
        section_heading: "Workflow",
        content: "Future uploaded protocol workflow content.",
      },
    ];
    const images = [
      {
        id: imageId,
        page_number: 1,
        caption: "Clinical workflow table.",
        image_type: "clinical_table",
        labels: ["workflow"],
      },
    ];
    const client = createSupabaseMock((call) => {
      if (call.table === "documents" && call.operation === "select") return ok(document);
      if (call.table === "indexing_v3_agent_jobs") {
        return ok([
          {
            document_id: documentId,
            status: "processing",
            locked_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ]);
      }
      if (call.table === "document_chunks") return ok(chunks);
      if (call.table === "document_images") return ok(images);
      return ok([]);
    });
    const upsertDocumentEnrichment = vi.fn(async () => ({
      summary: { id: "summary-1", document_id: documentId, summary: "Source-backed summary." },
      labels: [],
    }));
    const upsertDocumentDeepMemory = vi.fn(async () => ({
      sections: [],
      memoryCards: [],
      indexUnits: [],
    }));
    mockRuntime(client);
    vi.doMock("@/lib/document-enrichment", () => ({ upsertDocumentEnrichment }));
    vi.doMock("@/lib/deep-memory", () => ({
      assertLocalDeepMemoryOwnership: vi.fn(async () => undefined),
      upsertDocumentDeepMemory,
    }));
    const { POST } = await import("../src/app/api/documents/[id]/reindex/route");

    const response = await POST(
      authenticatedRequest(`/api/documents/${documentId}/reindex`, {
        method: "POST",
        body: JSON.stringify({ mode: "enrichment" }),
      }),
      { params: Promise.resolve({ id: documentId }) },
    );

    expect(response.status).toBe(202);
    expect(upsertDocumentEnrichment).not.toHaveBeenCalled();
    expect(client.calls[0].selected).toContain("metadata");
    expect(client.calls[0].filters).toContainEqual({ column: "owner_id", value: userId });
    expect(client.calls.some((call) => call.table === "indexing_v3_agent_jobs")).toBe(false);
    expect(upsertDocumentDeepMemory).not.toHaveBeenCalled();
  });

  it("filters enrichment-only reindex rows to the committed document generation", async () => {
    const document = {
      id: documentId,
      owner_id: userId,
      title: "Atomic Protocol",
      file_name: "atomic.pdf",
      source_path: null,
      import_batch_id: null,
      metadata: { index_generation_id: "11111111-1111-4111-8111-111111111111" },
    };
    const committedChunk = {
      id: "chunk-committed",
      document_id: documentId,
      page_number: 1,
      chunk_index: 0,
      section_heading: "Committed",
      content: "Committed generation content.",
      image_ids: [],
      metadata: { index_generation_id: "11111111-1111-4111-8111-111111111111" },
    };
    const uncommittedChunk = {
      id: "chunk-uncommitted",
      document_id: documentId,
      page_number: 1,
      chunk_index: 1,
      section_heading: "Uncommitted",
      content: "Replacement generation content.",
      image_ids: [],
      metadata: { index_generation_id: "22222222-2222-4222-8222-222222222222" },
    };
    const committedImage = {
      id: imageId,
      page_number: 1,
      caption: "Committed image.",
      image_type: "clinical_table",
      labels: [],
      clinical_relevance_score: 0.8,
      metadata: { index_generation_id: "11111111-1111-4111-8111-111111111111" },
    };
    const uncommittedImage = {
      id: "33333333-3333-4333-8333-333333333333",
      page_number: 1,
      caption: "Uncommitted image.",
      image_type: "clinical_table",
      labels: [],
      clinical_relevance_score: 0.9,
      metadata: { index_generation_id: "22222222-2222-4222-8222-222222222222" },
    };
    const client = createSupabaseMock((call) => {
      if (call.table === "documents" && call.operation === "select") return ok(document);
      if (call.table === "document_chunks") return ok([committedChunk, uncommittedChunk]);
      if (call.table === "document_images") return ok([uncommittedImage, committedImage]);
      return ok([]);
    });
    const upsertDocumentEnrichment = vi.fn(async () => ({
      summary: { id: "summary-1", document_id: documentId, summary: "Source-backed summary." },
      labels: [],
    }));
    const upsertDocumentDeepMemory = vi.fn(async () => ({
      sections: [],
      memoryCards: [],
      indexUnits: [],
    }));
    mockRuntime(client);
    vi.doMock("@/lib/document-enrichment", () => ({ upsertDocumentEnrichment }));
    vi.doMock("@/lib/deep-memory", () => ({
      assertLocalDeepMemoryOwnership: vi.fn(async () => undefined),
      upsertDocumentDeepMemory,
    }));
    const { POST } = await import("../src/app/api/documents/[id]/reindex/route");

    const response = await POST(
      authenticatedRequest(`/api/documents/${documentId}/reindex`, {
        method: "POST",
        body: JSON.stringify({ mode: "enrichment" }),
      }),
      { params: Promise.resolve({ id: documentId }) },
    );

    expect(response.status).toBe(202);
    expect(upsertDocumentEnrichment).not.toHaveBeenCalled();
    expect(upsertDocumentDeepMemory).not.toHaveBeenCalled();
  });

  it("paginates enrichment-only reindex chunks and images for deep memory rebuilds", async () => {
    const document = {
      id: documentId,
      owner_id: userId,
      title: "Large Protocol",
      file_name: "large.pdf",
      source_path: null,
      import_batch_id: null,
      metadata: {},
    };
    const firstChunkPage = Array.from({ length: 1000 }, (_, index) => ({
      id: `chunk-${index}`,
      document_id: documentId,
      page_number: 1,
      chunk_index: index,
      section_heading: "Large section",
      content: `Content ${index}`,
      image_ids: [],
      metadata: {},
    }));
    const finalChunk = {
      id: "chunk-final",
      document_id: documentId,
      page_number: 2,
      chunk_index: 1000,
      section_heading: "Final section",
      content: "Final content",
      image_ids: [],
      metadata: {},
    };
    const firstImagePage = Array.from({ length: 1000 }, (_, index) => ({
      id: `image-${index}`,
      page_number: 1,
      caption: `Image ${index}`,
      image_type: "clinical_table",
      labels: [],
      source_kind: "table_crop",
      clinical_relevance_score: 0.5,
      metadata: {},
    }));
    const finalImage = {
      id: "image-final",
      page_number: 2,
      caption: "Final image",
      image_type: "clinical_table",
      labels: [],
      source_kind: "table_crop",
      clinical_relevance_score: 0.95,
      metadata: {},
    };
    const client = createSupabaseMock((call) => {
      if (call.table === "documents" && call.operation === "select") return ok(document);
      if (call.table === "document_chunks") {
        return call.range?.from === 0 ? ok(firstChunkPage) : ok([finalChunk]);
      }
      if (call.table === "document_images") {
        return call.range?.from === 0 ? ok(firstImagePage) : ok([finalImage]);
      }
      return ok([]);
    });
    const upsertDocumentEnrichment = vi.fn(async () => ({
      summary: { id: "summary-1", document_id: documentId, summary: "Source-backed summary." },
      labels: [],
    }));
    const upsertDocumentDeepMemory = vi.fn(async () => ({
      sections: [],
      memoryCards: [],
      indexUnits: [],
    }));
    mockRuntime(client);
    vi.doMock("@/lib/document-enrichment", () => ({ upsertDocumentEnrichment }));
    vi.doMock("@/lib/deep-memory", () => ({
      assertLocalDeepMemoryOwnership: vi.fn(async () => undefined),
      upsertDocumentDeepMemory,
    }));
    const { POST } = await import("../src/app/api/documents/[id]/reindex/route");

    const response = await POST(
      authenticatedRequest(`/api/documents/${documentId}/reindex`, {
        method: "POST",
        body: JSON.stringify({ mode: "enrichment" }),
      }),
      { params: Promise.resolve({ id: documentId }) },
    );
    const chunkSelects = client.calls.filter((call) => call.table === "document_chunks");
    const imageSelects = client.calls.filter((call) => call.table === "document_images");

    expect(response.status).toBe(202);
    expect(chunkSelects).toEqual([]);
    expect(imageSelects).toEqual([]);
    expect(upsertDocumentDeepMemory).not.toHaveBeenCalled();
  });

  it("blocks full reindex while a fresh agent-enrichment lease is processing", async () => {
    const document = {
      id: documentId,
      owner_id: userId,
      title: "Agent-Enriched Protocol",
      file_name: "agent-enriched.pdf",
      source_path: null,
      import_batch_id: null,
      status: "indexed",
      error_message: null,
      page_count: 3,
      chunk_count: 8,
      image_count: 1,
      metadata: {},
    };
    const now = new Date().toISOString();
    const client = createSupabaseMock((call) => {
      if (call.table === "documents" && call.operation === "select") return ok(document);
      if (call.table === "import_batches") return ok([]);
      if (call.table === "ingestion_jobs" && call.operation === "select") return ok([]);
      if (call.table === "indexing_v3_agent_jobs") {
        return ok([{ document_id: documentId, status: "processing", locked_at: now, updated_at: now }]);
      }
      return ok([]);
    });
    mockRuntime(client);
    const { POST } = await import("../src/app/api/documents/[id]/reindex/route");

    const response = await POST(
      authenticatedRequest(`/api/documents/${documentId}/reindex`, {
        method: "POST",
        body: JSON.stringify({ mode: "full" }),
      }),
      { params: Promise.resolve({ id: documentId }) },
    );

    expect(response.status).toBe(409);
    expect(await payload(response)).toMatchObject({
      error: "Document has an active agent-enrichment pass. Wait for it to finish before reindexing.",
    });
    expect(client.calls.some((call) => call.table === "documents" && call.operation === "update")).toBe(false);
    expect(client.calls.some((call) => call.table === "ingestion_jobs" && call.operation === "insert")).toBe(false);
  });

  it("allows full reindex after an agent-enrichment lease becomes stale", async () => {
    const document = {
      id: documentId,
      owner_id: userId,
      title: "Stale Agent Protocol",
      file_name: "stale-agent.pdf",
      source_path: null,
      import_batch_id: null,
      status: "indexed",
      error_message: null,
      page_count: 3,
      chunk_count: 8,
      image_count: 1,
      metadata: {},
    };
    const stale = new Date(Date.now() - 11 * 60_000).toISOString();
    const client = createSupabaseMock((call) => {
      if (call.table === "documents" && call.operation === "select") return ok(document);
      if (call.table === "import_batches") return ok([]);
      if (call.table === "ingestion_jobs" && call.operation === "select") return ok([]);
      if (call.table === "indexing_v3_agent_jobs") {
        return ok([{ document_id: documentId, status: "processing", locked_at: stale, updated_at: stale }]);
      }
      return ok([]);
    });
    mockRuntime(client);
    const { POST } = await import("../src/app/api/documents/[id]/reindex/route");

    const response = await POST(
      authenticatedRequest(`/api/documents/${documentId}/reindex`, {
        method: "POST",
        body: JSON.stringify({ mode: "full" }),
      }),
      { params: Promise.resolve({ id: documentId }) },
    );

    expect(response.status).toBe(201);
    expect(client.rpc).toHaveBeenCalledWith(
      "request_ingestion_reindex_if_agent_idle",
      expect.objectContaining({
        p_document_id: documentId,
        p_owner_id: userId,
        p_stale_before: expect.any(String),
        p_max_attempts: 3,
      }),
    );
    expect(client.calls.some((call) => call.table === "documents" && call.operation === "update")).toBe(false);
    expect(client.calls.some((call) => call.table === "ingestion_jobs" && call.operation === "insert")).toBe(false);
  });

  it("blocks full reindex when the selected document already has active indexing work", async () => {
    const document = {
      id: documentId,
      owner_id: userId,
      title: "Active Protocol",
      file_name: "active.pdf",
      source_path: null,
      import_batch_id: null,
      metadata: {},
    };
    const client = createSupabaseMock((call) => {
      if (call.table === "documents" && call.operation === "select") return ok(document);
      if (call.table === "import_batches") return ok([]);
      if (call.table === "ingestion_jobs" && call.operation === "select") {
        return ok([
          {
            id: "active-job-1",
            document_id: documentId,
            status: "processing",
            stage: "chunking",
            locked_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            error_message: null,
            attempt_count: 1,
            max_attempts: 3,
          },
        ]);
      }
      return ok([]);
    });
    mockRuntime(client);
    const { POST } = await import("../src/app/api/documents/[id]/reindex/route");

    const response = await POST(
      authenticatedRequest(`/api/documents/${documentId}/reindex`, {
        method: "POST",
        body: JSON.stringify({ mode: "full" }),
      }),
      { params: Promise.resolve({ id: documentId }) },
    );
    const body = await payload(response);

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      error: "Document already has pending or processing indexing work.",
      details: {
        kind: "ingestion_mutation_safety",
        safeToRun: false,
        reason: "active_jobs",
        activeJobCount: 1,
        staleProcessingJobCount: 0,
      },
    });
    expect(client.rpc).not.toHaveBeenCalledWith("reset_document_index", expect.anything());
    expect(client.calls.some((call) => call.table === "documents" && call.operation === "update")).toBe(false);
  });

  it("blocks enrichment-only reindex when the selected document already has active indexing work", async () => {
    const document = {
      id: documentId,
      owner_id: userId,
      title: "Active Protocol",
      file_name: "active.pdf",
      source_path: null,
      import_batch_id: null,
      metadata: { index_generation_id: "11111111-1111-4111-8111-111111111111" },
    };
    const client = createSupabaseMock((call) => {
      if (call.table === "documents" && call.operation === "select") return ok(document);
      if (call.table === "import_batches") return ok([]);
      if (call.table === "ingestion_jobs" && call.operation === "select") {
        return ok([
          {
            id: "active-job-1",
            document_id: documentId,
            status: "pending",
            stage: "queued",
            locked_at: null,
            updated_at: new Date().toISOString(),
            error_message: null,
            attempt_count: 0,
            max_attempts: 3,
          },
        ]);
      }
      return ok([]);
    });
    const upsertDocumentEnrichment = vi.fn();
    mockRuntime(client);
    vi.doMock("@/lib/document-enrichment", () => ({ upsertDocumentEnrichment }));
    const { POST } = await import("../src/app/api/documents/[id]/reindex/route");

    const response = await POST(
      authenticatedRequest(`/api/documents/${documentId}/reindex`, {
        method: "POST",
        body: JSON.stringify({ mode: "enrichment" }),
      }),
      { params: Promise.resolve({ id: documentId }) },
    );
    const body = await payload(response);

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      details: {
        kind: "ingestion_mutation_safety",
        safeToRun: false,
        reason: "active_jobs",
        activeJobCount: 1,
      },
    });
    expect(upsertDocumentEnrichment).not.toHaveBeenCalled();
    expect(client.calls.some((call) => call.table === "document_chunks")).toBe(false);
  });

  it("pauses full reindex when Supabase health is unavailable before queue mutation", async () => {
    const document = {
      id: documentId,
      owner_id: userId,
      title: "Unavailable Protocol",
      file_name: "unavailable.pdf",
      source_path: null,
      import_batch_id: null,
      metadata: {},
    };
    const client = createSupabaseMock((call) => {
      if (call.table === "documents" && call.operation === "select") return ok(document);
      if (call.table === "import_batches") return fail("<!doctype html><title>522 Connection timed out</title>");
      return ok([]);
    });
    mockRuntime(client);
    const { POST } = await import("../src/app/api/documents/[id]/reindex/route");

    const response = await POST(
      authenticatedRequest(`/api/documents/${documentId}/reindex`, {
        method: "POST",
        body: JSON.stringify({ mode: "full" }),
      }),
      { params: Promise.resolve({ id: documentId }) },
    );
    const body = await payload(response);

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      details: {
        kind: "ingestion_mutation_safety",
        safeToRun: false,
        reason: "supabase_unavailable",
        activeJobCount: 0,
      },
    });
    expect(String(body.error)).toContain("Reindex is paused.");
    expect(client.rpc).not.toHaveBeenCalledWith("reset_document_index", expect.anything());
    expect(client.calls.some((call) => call.table === "documents" && call.operation === "update")).toBe(false);
  });

  it("leaves queue mutation to the atomic RPC when full reindex enqueue fails", async () => {
    const document = {
      id: documentId,
      owner_id: userId,
      title: "Rollback Protocol",
      file_name: "rollback.pdf",
      source_path: null,
      import_batch_id: null,
      status: "failed",
      error_message: "older failure",
      page_count: 12,
      chunk_count: 34,
      image_count: 2,
      metadata: {},
    };
    const client = createSupabaseMock((call) => {
      if (call.table === "documents" && call.operation === "select") return ok(document);
      if (call.table === "import_batches") return ok([]);
      if (call.table === "ingestion_jobs" && call.operation === "select") return ok([]);
      return ok([]);
    });
    mockAtomicReindexRpc(client, () => fail("transaction rolled back"));
    mockRuntime(client);
    const { POST } = await import("../src/app/api/documents/[id]/reindex/route");

    const response = await POST(
      authenticatedRequest(`/api/documents/${documentId}/reindex`, {
        method: "POST",
        body: JSON.stringify({ mode: "full" }),
      }),
      { params: Promise.resolve({ id: documentId }) },
    );
    const body = await payload(response);

    expect(response.status).toBe(500);
    expect(body).toMatchObject({ error: "Request failed." });
    expect(client.calls.some((call) => call.operation === "update" || call.operation === "insert")).toBe(false);
  });

  it("returns 409 without rollback when deletion wins the single-document reindex race", async () => {
    const document = {
      id: documentId,
      owner_id: userId,
      title: "Deleted During Reindex",
      file_name: "deleted.pdf",
      source_path: null,
      import_batch_id: null,
      status: "failed",
      error_message: "older failure",
      page_count: 2,
      chunk_count: 4,
      image_count: 0,
      metadata: {},
    };
    const client = createSupabaseMock((call) => {
      if (call.table === "documents" && call.operation === "select") return ok(document);
      if (call.table === "import_batches") return ok([]);
      if (call.table === "ingestion_jobs" && call.operation === "select") return ok([]);
      return ok([]);
    });
    mockAtomicReindexRpc(client, () => ok({ outcome: "not_found" }));
    mockRuntime(client);
    const { POST } = await import("../src/app/api/documents/[id]/reindex/route");

    const response = await POST(
      authenticatedRequest(`/api/documents/${documentId}/reindex`, {
        method: "POST",
        body: JSON.stringify({ mode: "full" }),
      }),
      { params: Promise.resolve({ id: documentId }) },
    );

    expect(response.status).toBe(409);
    expect(await payload(response)).toMatchObject({
      error: "Document was deleted while reindexing. Refresh the document list and retry.",
    });
    expect(client.calls.some((call) => call.operation === "update" || call.operation === "insert")).toBe(false);
  });

  it("returns the atomic RPC conflict when active ingestion appears after the safety check", async () => {
    const document = {
      id: documentId,
      owner_id: userId,
      title: "Rollback Guard Protocol",
      file_name: "rollback-guard.pdf",
      source_path: null,
      import_batch_id: null,
      status: "failed",
      error_message: "older failure",
      page_count: 12,
      chunk_count: 34,
      image_count: 2,
      metadata: {},
    };
    let ingestionReads = 0;
    const client = createSupabaseMock((call) => {
      if (call.table === "documents" && call.operation === "select") return ok(document);
      if (call.table === "import_batches") return ok([]);
      if (call.table === "ingestion_jobs" && call.operation === "select" && call.selected?.includes("locked_at")) {
        ingestionReads += 1;
        if (ingestionReads === 1) return ok([]);
        return ok([
          {
            id: "competing-job",
            document_id: documentId,
            status: "pending",
            stage: "queued",
            locked_at: null,
            updated_at: new Date().toISOString(),
            error_message: null,
            attempt_count: 0,
            max_attempts: 3,
          },
        ]);
      }
      if (call.table === "ingestion_jobs" && call.operation === "select") return ok([]);
      return ok([]);
    });
    mockAtomicReindexRpc(client, () => ok({ outcome: "ingestion_active" }));
    mockRuntime(client);
    const { POST } = await import("../src/app/api/documents/[id]/reindex/route");

    const response = await POST(
      authenticatedRequest(`/api/documents/${documentId}/reindex`, {
        method: "POST",
        body: JSON.stringify({ mode: "full" }),
      }),
      { params: Promise.resolve({ id: documentId }) },
    );
    const body = await payload(response);

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      error: "Document already has pending or processing indexing work.",
      details: { kind: "ingestion_mutation_safety", reason: "active_jobs", activeJobCount: 1 },
    });
    expect(client.calls.some((call) => call.operation === "update" || call.operation === "insert")).toBe(false);
  });

  it("reports an atomic RPC failure without direct bulk queue mutation", async () => {
    const document = {
      id: documentId,
      owner_id: userId,
      title: "Bulk Rollback Protocol",
      file_name: "bulk-rollback.pdf",
      source_path: "legacy/imports/bulk-rollback.pdf",
      import_batch_id: null,
      status: "failed",
      error_message: "older failure",
      page_count: 3,
      chunk_count: 8,
      image_count: 1,
      metadata: {},
    };
    const client = createSupabaseMock((call) => {
      if (call.table === "documents" && call.operation === "select") return ok([document]);
      if (call.table === "import_batches") return ok([]);
      if (call.table === "ingestion_jobs" && call.operation === "select") return ok([]);
      return ok([]);
    });
    mockAtomicReindexRpc(client, () => fail("transaction rolled back"));
    mockRuntime(client, { invalidateRagCachesForOwner: vi.fn() });
    const { POST } = await import("../src/app/api/documents/bulk/reindex/route");

    const response = await POST(
      authenticatedRequest("/api/documents/bulk/reindex", {
        method: "POST",
        body: JSON.stringify({ documentIds: [documentId], mode: "full" }),
      }),
    );
    const body = await payload(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: false,
      results: [
        {
          documentId,
          mode: "full",
          ok: false,
          error: "transaction rolled back",
        },
      ],
    });
    expect(client.calls.some((call) => call.operation === "update" || call.operation === "insert")).toBe(false);
  });

  it("returns a per-document failure while a selected document has fresh agent enrichment", async () => {
    const document = {
      id: documentId,
      owner_id: userId,
      title: "Bulk Agent-Enriched Protocol",
      file_name: "bulk-agent-enriched.pdf",
      source_path: null,
      import_batch_id: null,
      status: "failed",
      error_message: "earlier failure",
      page_count: 3,
      chunk_count: 8,
      image_count: 1,
      metadata: {},
    };
    const now = new Date().toISOString();
    const client = createSupabaseMock((call) => {
      if (call.table === "documents" && call.operation === "select") return ok([document]);
      if (call.table === "import_batches") return ok([]);
      if (call.table === "ingestion_jobs" && call.operation === "select") return ok([]);
      if (call.table === "indexing_v3_agent_jobs") {
        return ok([{ document_id: documentId, status: "processing", locked_at: now, updated_at: now }]);
      }
      return ok([]);
    });
    mockRuntime(client, { invalidateRagCachesForOwner: vi.fn() });
    const { POST } = await import("../src/app/api/documents/bulk/reindex/route");

    const response = await POST(
      authenticatedRequest("/api/documents/bulk/reindex", {
        method: "POST",
        body: JSON.stringify({ documentIds: [documentId], mode: "retry_failed" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await payload(response)).toEqual({
      ok: false,
      results: [
        {
          documentId,
          mode: "retry_failed",
          ok: false,
          error: "Reindex paused while enrichment is active.",
        },
      ],
      missingDocumentIds: [],
    });
    expect(client.calls.some((call) => call.table === "documents" && call.operation === "update")).toBe(false);
    expect(client.calls.some((call) => call.table === "ingestion_jobs" && call.operation === "insert")).toBe(false);
  });

  it("returns a successful partial-result response when deletion wins one bulk reindex race", async () => {
    const deletedDocument = {
      id: documentId,
      owner_id: userId,
      title: "Bulk Deleted During Reindex",
      file_name: "bulk-deleted.pdf",
      source_path: null,
      import_batch_id: null,
      status: "failed",
      error_message: "older failure",
      page_count: 2,
      chunk_count: 4,
      image_count: 0,
      metadata: {},
    };
    const queuedDocument = {
      ...deletedDocument,
      id: otherDocumentId,
      title: "Bulk Reindex Survivor",
      file_name: "bulk-survivor.pdf",
    };
    const client = createSupabaseMock((call) => {
      if (call.table === "documents" && call.operation === "select") return ok([deletedDocument, queuedDocument]);
      if (call.table === "import_batches") return ok([]);
      if (call.table === "ingestion_jobs" && call.operation === "select") return ok([]);
      return ok([]);
    });
    mockAtomicReindexRpc(client, (args) =>
      ok(
        args.p_document_id === documentId
          ? { outcome: "not_found" }
          : { outcome: "queued", job: { id: "surviving-job" } },
      ),
    );
    mockRuntime(client, { invalidateRagCachesForOwner: vi.fn() });
    const { POST } = await import("../src/app/api/documents/bulk/reindex/route");

    const response = await POST(
      authenticatedRequest("/api/documents/bulk/reindex", {
        method: "POST",
        body: JSON.stringify({ documentIds: [documentId, otherDocumentId], mode: "full" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await payload(response)).toMatchObject({
      ok: false,
      results: [
        {
          documentId,
          ok: false,
          error: "Document was deleted while reindexing. Refresh the document list and retry.",
        },
        {
          documentId: otherDocumentId,
          ok: true,
          jobId: "surviving-job",
        },
      ],
      missingDocumentIds: [],
    });
    expect(client.calls.some((call) => call.operation === "update" || call.operation === "insert")).toBe(false);
  });

  it("returns missing document ids as a completed partial batch", async () => {
    const document = {
      id: documentId,
      owner_id: userId,
      title: "Bulk Reindex Available Document",
      file_name: "bulk-available.pdf",
      source_path: null,
      import_batch_id: null,
      status: "failed",
      error_message: "older failure",
      page_count: 2,
      chunk_count: 4,
      image_count: 0,
      metadata: {},
    };
    const client = createSupabaseMock((call) => {
      if (call.table === "documents" && call.operation === "select") return ok([document]);
      if (call.table === "import_batches") return ok([]);
      if (call.table === "ingestion_jobs" && call.operation === "select") return ok([]);
      return ok([]);
    });
    mockAtomicReindexRpc(client, () => ok({ outcome: "queued", job: { id: "available-job" } }));
    mockRuntime(client, { invalidateRagCachesForOwner: vi.fn() });
    const { POST } = await import("../src/app/api/documents/bulk/reindex/route");

    const response = await POST(
      authenticatedRequest("/api/documents/bulk/reindex", {
        method: "POST",
        body: JSON.stringify({ documentIds: [documentId, otherDocumentId], mode: "full" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await payload(response)).toMatchObject({
      ok: false,
      results: [{ documentId, ok: true, jobId: "available-job" }],
      missingDocumentIds: [otherDocumentId],
    });
  });

  it("reports an atomic bulk conflict when active ingestion appears after the safety check", async () => {
    const document = {
      id: documentId,
      owner_id: userId,
      title: "Bulk Rollback Guard Protocol",
      file_name: "bulk-rollback-guard.pdf",
      source_path: "legacy/imports/bulk-rollback-guard.pdf",
      import_batch_id: null,
      status: "failed",
      error_message: "older failure",
      page_count: 3,
      chunk_count: 8,
      image_count: 1,
      metadata: {},
    };
    const client = createSupabaseMock((call) => {
      if (call.table === "documents" && call.operation === "select") return ok([document]);
      if (call.table === "import_batches") return ok([]);
      if (call.table === "ingestion_jobs" && call.operation === "select") return ok([]);
      return ok([]);
    });
    mockAtomicReindexRpc(client, () => ok({ outcome: "ingestion_active" }));
    mockRuntime(client, { invalidateRagCachesForOwner: vi.fn() });
    const { POST } = await import("../src/app/api/documents/bulk/reindex/route");

    const response = await POST(
      authenticatedRequest("/api/documents/bulk/reindex", {
        method: "POST",
        body: JSON.stringify({ documentIds: [documentId], mode: "full" }),
      }),
    );
    const body = await payload(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: false,
      results: [
        {
          documentId,
          mode: "full",
          ok: false,
          error: "Document already has pending or processing indexing work.",
        },
      ],
    });
    expect(client.calls.some((call) => call.operation === "update" || call.operation === "insert")).toBe(false);
  });

  it("cleans up uploaded storage when document insert fails", async () => {
    const client = createSupabaseMock((call) =>
      call.table === "documents" && call.operation === "insert" ? fail("document insert failed") : ok([]),
    );
    mockRuntime(client);
    const { POST } = await import("../src/app/api/upload/route");
    const formData = new FormData();
    formData.set("file", new File(["%PDF-1.7\n%%EOF"], "guideline.pdf", { type: "application/pdf" }));

    const response = await POST(
      authenticatedRequest("/api/upload", {
        method: "POST",
        body: formData,
      }),
    );
    const uploadPath = client.storageMocks.upload.mock.calls[0]?.[0] as string;

    expect(response.status).toBe(500);
    expect(client.storageMocks.remove).toHaveBeenCalledWith([uploadPath]);
  });

  it("cleans up uploaded storage when job insert fails", async () => {
    const client = createSupabaseMock((call) => {
      if (call.table === "documents" && call.operation === "insert") {
        return fail("job insert failed");
      }
      return ok([]);
    });
    mockRuntime(client);
    client.rpc.mockImplementation(async (name: string, args?: Record<string, unknown>) => {
      if (name === "create_uploaded_document_with_ingestion_job") {
        return fail("job insert failed");
      }
      if (name === "consume_api_rate_limit" || name === "consume_api_subject_rate_limit") {
        return {
          data: [
            rateLimitRow({
              limited: false,
              limit_value: Number(args?.p_limit ?? 60),
              remaining: Number(args?.p_limit ?? 60) - 1,
            }),
          ],
          error: null,
        };
      }
      return ok([]);
    });
    const { POST } = await import("../src/app/api/upload/route");
    const formData = new FormData();
    formData.set("file", new File(["%PDF-1.7\n%%EOF"], "guideline.pdf", { type: "application/pdf" }));

    const response = await POST(
      authenticatedRequest("/api/upload", {
        method: "POST",
        body: formData,
      }),
    );
    const uploadPath = client.storageMocks.upload.mock.calls[0]?.[0] as string;

    expect(response.status).toBe(500);
    expect(client.storageMocks.remove).toHaveBeenCalledWith([uploadPath]);
    expect(client.calls.some((call) => call.table === "documents" && call.operation === "delete")).toBe(false);
  });

  it("still runs catch cleanup when post-enqueue cleanup calls return non-throwing errors", async () => {
    const controller = new AbortController();
    const client = createSupabaseMock((call) => {
      if (call.table === "documents" && call.operation === "insert") {
        controller.abort();
        return ok({ id: documentId });
      }
      if (call.table === "ingestion_jobs" && call.operation === "insert") {
        return ok({ id: "job-1", document_id: documentId });
      }
      if (call.table === "documents" && call.operation === "delete") {
        return fail("document cleanup returned error");
      }
      return ok([]);
    });
    client.storageMocks.remove.mockResolvedValue({
      data: [],
      error: { message: "storage cleanup returned error" },
    });
    mockRuntime(client);
    const { POST } = await import("../src/app/api/upload/route");
    const formData = new FormData();
    formData.set("file", new File(["%PDF-1.7\n%%EOF"], "guideline.pdf", { type: "application/pdf" }));

    const response = await POST(
      authenticatedRequest("/api/upload", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      }),
    );
    const uploadPath = client.storageMocks.upload.mock.calls[0]?.[0] as string;
    const documentDeletes = client.calls.filter((call) => call.table === "documents" && call.operation === "delete");

    expect(response.status).toBe(499);
    expect(documentDeletes).toHaveLength(1);
    expect(client.storageMocks.remove).toHaveBeenCalledWith([uploadPath]);
  });

  it("does not return document details for an unowned document", async () => {
    const client = createSupabaseMock(() => ok(null));
    mockRuntime(client);
    const { GET } = await import("../src/app/api/documents/[id]/route");

    const response = await GET(authenticatedRequest(`/api/documents/${otherDocumentId}`), {
      params: Promise.resolve({ id: otherDocumentId }),
    });

    expect(response.status).toBe(404);
    expect(await payload(response)).toMatchObject({ error: "Document not found." });
    expect(client.calls).toHaveLength(1);
  });

  it("filters document detail rows to the committed index generation", async () => {
    const committedGeneration = "11111111-1111-4111-8111-111111111111";
    const replacementGeneration = "22222222-2222-4222-8222-222222222222";
    const client = createSupabaseMock((call) => {
      if (call.table === "documents" && call.operation === "select") {
        return ok(
          documentDetailRow({
            page_count: 1,
            chunk_count: 1,
            image_count: 1,
            metadata: { index_generation_id: committedGeneration },
          }),
        );
      }
      if (call.table === "document_pages")
        return ok([{ id: "page-1", page_number: 1, text: "Page", ocr_used: false, metadata: {} }]);
      if (call.table === "document_images") {
        return ok([
          {
            id: "image-old",
            page_number: 1,
            caption: "Old",
            image_type: "clinical_table",
            metadata: { index_generation_id: committedGeneration },
          },
          {
            id: "image-new",
            page_number: 1,
            caption: "New",
            image_type: "clinical_table",
            metadata: { index_generation_id: replacementGeneration },
          },
        ]);
      }
      if (call.table === "document_chunks") {
        return ok([
          {
            id: "chunk-old",
            page_number: 1,
            chunk_index: 0,
            section_heading: null,
            content: "Old",
            image_ids: [],
            metadata: { index_generation_id: committedGeneration },
          },
          {
            id: "chunk-new",
            page_number: 1,
            chunk_index: 1,
            section_heading: null,
            content: "New",
            image_ids: [],
            metadata: { index_generation_id: replacementGeneration },
          },
        ]);
      }
      if (call.table === "document_table_facts") {
        return ok([
          {
            id: "fact-old",
            document_id: documentId,
            source_image_id: null,
            page_number: 1,
            table_title: null,
            row_label: null,
            clinical_parameter: null,
            threshold_value: null,
            action: null,
            metadata: { index_generation_id: committedGeneration },
          },
          {
            id: "fact-new",
            document_id: documentId,
            source_image_id: null,
            page_number: 1,
            table_title: null,
            row_label: null,
            clinical_parameter: null,
            threshold_value: null,
            action: null,
            metadata: { index_generation_id: replacementGeneration },
          },
        ]);
      }
      if (call.table === "document_summaries" && call.maybeSingle) return ok(null);
      return ok([]);
    });
    mockRuntime(client);
    const { GET } = await import("../src/app/api/documents/[id]/route");

    const response = await GET(authenticatedRequest(`/api/documents/${documentId}`), {
      params: Promise.resolve({ id: documentId }),
    });
    const body = (await payload(response)) as {
      images: Array<{ id: string }>;
      chunks: Array<{ id: string }>;
      tableFacts: Array<{ id: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.images.map((image: { id: string }) => image.id)).toEqual(["image-old"]);
    expect(body.chunks.map((chunk: { id: string }) => chunk.id)).toEqual(["chunk-old"]);
    expect(body.tableFacts.map((fact: { id: string }) => fact.id)).toEqual(["fact-old"]);
  });

  it("lets anonymous users search a public document and filters fallback rows to the committed generation", async () => {
    const committedGeneration = "11111111-1111-4111-8111-111111111111";
    const replacementGeneration = "22222222-2222-4222-8222-222222222222";
    const client = createSupabaseMock((call) => {
      if (call.table === "documents" && call.operation === "select" && matchesOwnerReadScope(call)) {
        return ok({
          id: documentId,
          status: "indexed",
          metadata: { index_generation_id: committedGeneration },
        });
      }
      if (call.table === "document_chunks") {
        return ok([
          {
            id: "chunk-old",
            page_number: 1,
            chunk_index: 0,
            section_heading: "Committed",
            content: "lithium monitoring committed row",
            image_ids: [],
            metadata: { index_generation_id: committedGeneration },
            index_generation_id: committedGeneration,
          },
          {
            id: "chunk-new",
            page_number: 1,
            chunk_index: 1,
            section_heading: "Replacement",
            content: "lithium monitoring replacement row",
            image_ids: [],
            metadata: { index_generation_id: replacementGeneration },
            index_generation_id: replacementGeneration,
          },
        ]);
      }
      return ok([]);
    });
    client.rpc.mockImplementation(async (name: string) => {
      if (name === "search_document_chunks") return fail("missing rpc");
      if (name === "consume_api_rate_limit" || name === "consume_api_subject_rate_limit") {
        return { data: [rateLimitRow()], error: null };
      }
      return ok([]);
    });
    mockRuntime(client);
    const { GET } = await import("../src/app/api/documents/[id]/search/route");

    const response = await GET(request(`/api/documents/${documentId}/search?q=lithium`), {
      params: Promise.resolve({ id: documentId }),
    });
    const body = (await payload(response)) as { strategy: string; results: Array<{ id: string }> };

    expect(response.status).toBe(200);
    expect(body.strategy).toBe("portable_ilike_fallback");
    expect(body.results.map((result: { id: string }) => result.id)).toEqual(["chunk-old"]);
    expect(client.auth.getUser).not.toHaveBeenCalled();
    expect(client.calls[0].filters).toContainEqual({ column: "owner_id", value: null });
  });

  it("does not treat a query term embedded inside another word as a document-search hit", async () => {
    const client = createSupabaseMock((call) => {
      if (call.table === "documents" && call.operation === "select" && matchesOwnerReadScope(call)) {
        return ok({ id: documentId, status: "indexed", metadata: {} });
      }
      return ok([]);
    });
    client.rpc.mockImplementation(async (name: string) => {
      if (name === "search_document_chunks") {
        return ok([
          {
            id: "embedded-term",
            page_number: 1,
            chunk_index: 0,
            section_heading: "Endocrine",
            content: "Adrenal monitoring only.",
            image_ids: [],
            text_rank: 0.8,
          },
          {
            id: "word-boundary-term",
            page_number: 2,
            chunk_index: 1,
            section_heading: "Renal monitoring",
            content: "Check renal function before treatment.",
            image_ids: [],
            text_rank: 0.7,
          },
        ]);
      }
      if (name === "consume_api_rate_limit" || name === "consume_api_subject_rate_limit") {
        return { data: [rateLimitRow()], error: null };
      }
      return ok([]);
    });
    mockRuntime(client);
    const { GET } = await import("../src/app/api/documents/[id]/search/route");

    const response = await GET(request(`/api/documents/${documentId}/search?q=renal`), {
      params: Promise.resolve({ id: documentId }),
    });
    const body = (await payload(response)) as { results: Array<{ id: string; matched_terms: string[] }> };

    expect(response.status).toBe(200);
    expect(body.results).toEqual([expect.objectContaining({ id: "word-boundary-term", matched_terms: ["renal"] })]);
  });

  it("returns no hits for non-indexed documents even when the search RPC is unavailable", async () => {
    const client = createSupabaseMock((call) => {
      if (call.table === "documents" && call.operation === "select" && matchesOwnerReadScope(call)) {
        return ok({ id: documentId, status: "processing", metadata: {} });
      }
      if (call.table === "document_chunks") {
        return ok([
          {
            id: "chunk-staged",
            page_number: 1,
            chunk_index: 0,
            section_heading: "Staging",
            content: "lithium monitoring staged row",
            image_ids: [],
            metadata: {},
          },
        ]);
      }
      return ok([]);
    });
    client.rpc.mockImplementation(async (name: string) => {
      if (name === "search_document_chunks") return fail("missing rpc");
      if (name === "consume_api_rate_limit" || name === "consume_api_subject_rate_limit") {
        return { data: [rateLimitRow()], error: null };
      }
      return ok([]);
    });
    mockRuntime(client);
    const { GET } = await import("../src/app/api/documents/[id]/search/route");

    const response = await GET(request(`/api/documents/${documentId}/search?q=lithium`), {
      params: Promise.resolve({ id: documentId }),
    });
    const body = (await payload(response)) as { strategy: string; results: unknown[]; hitCount: number };

    expect(response.status).toBe(200);
    expect(body.strategy).toBe("document_not_indexed");
    expect(body.results).toEqual([]);
    expect(body.hitCount).toBe(0);
    expect(client.from).not.toHaveBeenCalledWith("document_chunks");
  });

  it("filters table fact review rows to the committed index generation", async () => {
    const committedGeneration = "11111111-1111-4111-8111-111111111111";
    const replacementGeneration = "22222222-2222-4222-8222-222222222222";
    const client = createSupabaseMock((call) => {
      if (call.table === "documents" && call.operation === "select") {
        return ok({ id: documentId, metadata: { index_generation_id: committedGeneration } });
      }
      if (call.table === "document_table_facts") {
        return ok([
          { id: "fact-old", document_id: documentId, metadata: { index_generation_id: committedGeneration } },
          { id: "fact-new", document_id: documentId, metadata: { index_generation_id: replacementGeneration } },
        ]);
      }
      return ok([]);
    });
    mockRuntime(client);
    const { GET } = await import("../src/app/api/documents/[id]/table-facts/route");

    const response = await GET(authenticatedRequest(`/api/documents/${documentId}/table-facts`), {
      params: Promise.resolve({ id: documentId }),
    });
    const body = (await payload(response)) as { tableFacts: Array<{ id: string }> };

    expect(response.status).toBe(200);
    expect(body.tableFacts.map((fact: { id: string }) => fact.id)).toEqual(["fact-old"]);
  });

  it("rejects malformed document detail ids before Supabase uuid filters", async () => {
    const client = createSupabaseMock();
    mockRuntime(client);
    const { GET } = await import("../src/app/api/documents/[id]/route");

    const response = await GET(authenticatedRequest("/api/documents/=3&pageLimit=1"), {
      params: Promise.resolve({ id: "=3&pageLimit=1" }),
    });

    expect(response.status).toBe(400);
    expect(await payload(response)).toMatchObject({ error: "Invalid document id." });
    expect(client.auth.getUser).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it("allows owners to rename the document display title without changing file provenance", async () => {
    const original = {
      id: documentId,
      owner_id: userId,
      title: "Original title",
      file_name: "source.pdf",
      storage_path: `${userId}/documents/${documentId}/source.pdf`,
      content_hash: "hash-1",
      metadata: { source_path: "C:\\Guidelines\\source.pdf" },
    };
    const client = createSupabaseMock((call) => {
      if (call.table === "documents" && call.operation === "select") return ok(original);
      if (call.table === "documents" && call.operation === "update") {
        return ok({
          ...original,
          ...(call.updatePayload as Record<string, unknown>),
        });
      }
      return ok([]);
    });
    const invalidateRagCachesForDocumentMutation = vi.fn();
    mockRuntime(client, { invalidateRagCachesForDocumentMutation });
    const { PATCH } = await import("../src/app/api/documents/[id]/route");

    const response = await PATCH(
      authenticatedRequest(`/api/documents/${documentId}`, {
        method: "PATCH",
        body: JSON.stringify({ title: "Better clinical title" }),
      }),
      { params: Promise.resolve({ id: documentId }) },
    );
    const body = await payload(response);
    const updateCall = client.calls.find((call) => call.table === "documents" && call.operation === "update");
    const update = updateCall?.updatePayload as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect((body.document as Record<string, unknown>).title).toBe("Better clinical title");
    expect(update.title).toBe("Better clinical title");
    expect(update).not.toHaveProperty("file_name");
    expect(update).not.toHaveProperty("storage_path");
    expect(update).not.toHaveProperty("content_hash");
    expect(client.calls[0].filters).toContainEqual({ column: "owner_id", value: userId });
    expect(invalidateRagCachesForDocumentMutation).toHaveBeenCalledWith(userId, { affectsPublicCorpus: false });
  });

  it("rejects invalid document rename titles", async () => {
    const client = createSupabaseMock();
    mockRuntime(client);
    const { PATCH } = await import("../src/app/api/documents/[id]/route");

    const response = await PATCH(
      authenticatedRequest(`/api/documents/${documentId}`, {
        method: "PATCH",
        body: JSON.stringify({ title: "   " }),
      }),
      { params: Promise.resolve({ id: documentId }) },
    );

    expect(response.status).toBe(400);
    expect(await payload(response)).toMatchObject({ error: "Enter a document title between 1 and 180 characters." });
    expect(client.from).not.toHaveBeenCalled();
  });

  it("does not rename another user's document", async () => {
    const client = createSupabaseMock(() => ok(null));
    mockRuntime(client);
    const { PATCH } = await import("../src/app/api/documents/[id]/route");

    const response = await PATCH(
      authenticatedRequest(`/api/documents/${otherDocumentId}`, {
        method: "PATCH",
        body: JSON.stringify({ title: "Not mine" }),
      }),
      { params: Promise.resolve({ id: otherDocumentId }) },
    );

    expect(response.status).toBe(404);
    expect(await payload(response)).toMatchObject({ error: "Document not found." });
    expect(client.calls[0].filters).toContainEqual({ column: "owner_id", value: userId });
  });

  it("creates clean manual document labels for owned documents", async () => {
    const manualLabelId = "55555555-5555-4555-8555-555555555555";
    const client = createSupabaseMock((call) => {
      if (call.table === "documents") return ok({ id: documentId, owner_id: userId });
      if (call.table === "document_labels" && call.operation === "select" && call.maybeSingle) return ok(null);
      if (call.table === "document_labels" && call.operation === "insert") {
        return ok({ id: manualLabelId, ...(call.insertPayload as Record<string, unknown>) });
      }
      if (call.table === "document_labels" && call.operation === "select") {
        // selectLabels issues a select("*"), so a realistic row carries every column.
        // label_type, source and confidence are all `not null` with check constraints on
        // public.document_labels, and assertDocumentLabelRows now holds the route to that.
        return ok([
          {
            id: manualLabelId,
            document_id: documentId,
            label: "clozapine monitoring",
            label_type: "medication",
            source: "manual",
            confidence: 1,
          },
        ]);
      }
      return ok([]);
    });
    const invalidateRagCachesForDocumentMutation = vi.fn();
    mockRuntime(client, { invalidateRagCachesForDocumentMutation });
    const { POST } = await import("../src/app/api/documents/[id]/labels/route");

    const response = await POST(
      authenticatedRequest(`/api/documents/${documentId}/labels`, {
        method: "POST",
        body: JSON.stringify({ label: "Clozapine Monitoring!!", label_type: "medication" }),
      }),
      { params: Promise.resolve({ id: documentId }) },
    );
    const body = await payload(response);
    const insert = client.calls.find((call) => call.table === "document_labels" && call.operation === "insert");

    expect(response.status).toBe(201);
    expect(body.label).toMatchObject({ label: "clozapine monitoring", label_type: "medication", source: "manual" });
    expect(insert?.insertPayload).toMatchObject({
      document_id: documentId,
      owner_id: userId,
      label: "clozapine monitoring",
      label_type: "medication",
      source: "manual",
      confidence: 1,
    });
    expect(invalidateRagCachesForDocumentMutation).toHaveBeenCalledWith(userId, { affectsPublicCorpus: false });
  });

  it("creates manual site labels for owned documents", async () => {
    const manualLabelId = "55555555-5555-4555-8555-555555555556";
    const client = createSupabaseMock((call) => {
      if (call.table === "documents") return ok({ id: documentId, owner_id: userId });
      if (call.table === "document_labels" && call.operation === "select" && call.maybeSingle) return ok(null);
      if (call.table === "document_labels" && call.operation === "insert") {
        return ok({ id: manualLabelId, ...(call.insertPayload as Record<string, unknown>) });
      }
      if (call.table === "document_labels" && call.operation === "select") {
        return ok([
          {
            id: manualLabelId,
            document_id: documentId,
            label: "fiona stanley hospital",
            label_type: "site",
            source: "manual",
            confidence: 1,
          },
        ]);
      }
      return ok([]);
    });
    const invalidateRagCachesForDocumentMutation = vi.fn();
    mockRuntime(client, { invalidateRagCachesForDocumentMutation });
    const { POST } = await import("../src/app/api/documents/[id]/labels/route");

    const response = await POST(
      authenticatedRequest(`/api/documents/${documentId}/labels`, {
        method: "POST",
        body: JSON.stringify({ label: "FSH", label_type: "site" }),
      }),
      { params: Promise.resolve({ id: documentId }) },
    );
    const body = await payload(response);
    const insert = client.calls.find((call) => call.table === "document_labels" && call.operation === "insert");

    expect(response.status).toBe(201);
    expect(body.label).toMatchObject({ label: "fiona stanley hospital", label_type: "site", source: "manual" });
    expect(insert?.insertPayload).toMatchObject({
      document_id: documentId,
      owner_id: userId,
      label: "fiona stanley hospital",
      label_type: "site",
      source: "manual",
      confidence: 1,
    });
    expect(invalidateRagCachesForDocumentMutation).toHaveBeenCalledWith(userId, { affectsPublicCorpus: false });
  });

  it("rejects noisy manual document labels before insert", async () => {
    const client = createSupabaseMock();
    mockRuntime(client);
    const { POST } = await import("../src/app/api/documents/[id]/labels/route");

    const response = await POST(
      authenticatedRequest(`/api/documents/${documentId}/labels`, {
        method: "POST",
        body: JSON.stringify({ label: "Document control", label_type: "topic" }),
      }),
      { params: Promise.resolve({ id: documentId }) },
    );

    expect(response.status).toBe(400);
    expect(await payload(response)).toMatchObject({
      error: "Enter a short, specific clinical tag. Generic document-control tags are not allowed.",
    });
    expect(client.from).not.toHaveBeenCalled();
  });

  it("renames only manual document labels", async () => {
    const manualLabelId = "66666666-6666-4666-8666-666666666666";
    const client = createSupabaseMock((call) => {
      if (call.table === "documents") return ok({ id: documentId, owner_id: userId });
      if (call.table === "document_labels" && call.operation === "select" && call.maybeSingle) {
        return ok({ id: manualLabelId, metadata: { created_by: "test" } });
      }
      if (call.table === "document_labels" && call.operation === "update") {
        return ok({ id: manualLabelId, ...(call.updatePayload as Record<string, unknown>) });
      }
      if (call.table === "document_labels" && call.operation === "select") {
        return ok([
          {
            id: manualLabelId,
            document_id: documentId,
            label: "lithium toxicity",
            label_type: "risk",
            source: "manual",
            confidence: 1,
          },
        ]);
      }
      return ok([]);
    });
    const invalidateRagCachesForDocumentMutation = vi.fn();
    mockRuntime(client, { invalidateRagCachesForDocumentMutation });
    const { PATCH } = await import("../src/app/api/documents/[id]/labels/route");

    const response = await PATCH(
      authenticatedRequest(`/api/documents/${documentId}/labels`, {
        method: "PATCH",
        body: JSON.stringify({ labelId: manualLabelId, label: "Lithium toxicity", label_type: "risk" }),
      }),
      { params: Promise.resolve({ id: documentId }) },
    );
    const update = client.calls.find((call) => call.table === "document_labels" && call.operation === "update");

    expect(response.status).toBe(200);
    expect(update?.filters).toContainEqual({ column: "source", value: "manual" });
    expect(update?.updatePayload).toMatchObject({ label: "lithium toxicity", label_type: "risk", source: "manual" });
    expect(invalidateRagCachesForDocumentMutation).toHaveBeenCalledWith(userId, { affectsPublicCorpus: false });
  });

  it.each([
    ["approve", "approved", false],
    ["hide", "hidden", true],
    ["restore", "new", false],
  ] as const)("reviews owned document labels with %s", async (action, reviewStatus, hidden) => {
    const labelId = "99999999-9999-4999-8999-999999999999";
    const client = createSupabaseMock((call) => {
      if (call.table === "documents") return ok({ id: documentId, owner_id: userId });
      if (call.table === "document_labels" && call.operation === "select" && call.maybeSingle) {
        return ok({ id: labelId, metadata: { source_rule: "generated-labels", review_status: "new" } });
      }
      if (call.table === "document_labels" && call.operation === "update") {
        return ok({ id: labelId, ...(call.updatePayload as Record<string, unknown>) });
      }
      if (call.table === "document_labels" && call.operation === "select") {
        return ok([
          {
            id: labelId,
            document_id: documentId,
            label: "lithium",
            label_type: "medication",
            source: "generated",
            confidence: 0.72,
          },
        ]);
      }
      return ok([]);
    });
    const invalidateRagCachesForDocumentMutation = vi.fn();
    mockRuntime(client, { invalidateRagCachesForDocumentMutation });
    const { PATCH } = await import("../src/app/api/documents/[id]/labels/route");

    const response = await PATCH(
      authenticatedRequest(`/api/documents/${documentId}/labels`, {
        method: "PATCH",
        body: JSON.stringify({ labelId, action }),
      }),
      { params: Promise.resolve({ id: documentId }) },
    );
    const body = await payload(response);
    const selectExisting = client.calls.find(
      (call) => call.table === "document_labels" && call.operation === "select" && call.maybeSingle,
    );
    const update = client.calls.find((call) => call.table === "document_labels" && call.operation === "update");

    expect(response.status).toBe(200);
    expect(body.label).toMatchObject({
      metadata: expect.objectContaining({ review_status: reviewStatus, hidden, source_rule: "generated-labels" }),
    });
    expect(selectExisting?.filters).toEqual(
      expect.arrayContaining([
        { column: "id", value: labelId },
        { column: "document_id", value: documentId },
        { column: "owner_id", value: userId },
      ]),
    );
    expect(update?.filters).toEqual(
      expect.arrayContaining([
        { column: "id", value: labelId },
        { column: "document_id", value: documentId },
        { column: "owner_id", value: userId },
      ]),
    );
    expect(update?.updatePayload).toMatchObject({
      metadata: expect.objectContaining({ review_status: reviewStatus, hidden, reviewed_by: "label-review-admin" }),
    });
    expect(invalidateRagCachesForDocumentMutation).toHaveBeenCalledWith(userId, { affectsPublicCorpus: false });
  });

  it("does not review labels that are not owned by the authenticated user", async () => {
    const labelId = "99999999-9999-4999-8999-999999999998";
    const client = createSupabaseMock((call) => {
      if (call.table === "documents") return ok({ id: documentId, owner_id: userId });
      if (call.table === "document_labels" && call.operation === "select" && call.maybeSingle) return ok(null);
      return ok([]);
    });
    const invalidateRagCachesForDocumentMutation = vi.fn();
    mockRuntime(client, { invalidateRagCachesForDocumentMutation });
    const { PATCH } = await import("../src/app/api/documents/[id]/labels/route");

    const response = await PATCH(
      authenticatedRequest(`/api/documents/${documentId}/labels`, {
        method: "PATCH",
        body: JSON.stringify({ labelId, action: "hide" }),
      }),
      { params: Promise.resolve({ id: documentId }) },
    );
    const selectExisting = client.calls.find(
      (call) => call.table === "document_labels" && call.operation === "select" && call.maybeSingle,
    );

    expect(response.status).toBe(404);
    expect(await payload(response)).toMatchObject({ error: "Tag not found." });
    expect(selectExisting?.filters).toContainEqual({ column: "owner_id", value: userId });
    expect(client.calls.some((call) => call.table === "document_labels" && call.operation === "update")).toBe(false);
    expect(invalidateRagCachesForDocumentMutation).not.toHaveBeenCalled();
  });

  it("returns not found when a reviewed label does not belong to the selected document", async () => {
    const labelId = "99999999-9999-4999-8999-999999999997";
    const client = createSupabaseMock((call) => {
      if (call.table === "documents") return ok({ id: documentId, owner_id: userId });
      if (call.table === "document_labels" && call.operation === "select" && call.maybeSingle) return ok(null);
      return ok([]);
    });
    const invalidateRagCachesForDocumentMutation = vi.fn();
    mockRuntime(client, { invalidateRagCachesForDocumentMutation });
    const { PATCH } = await import("../src/app/api/documents/[id]/labels/route");

    const response = await PATCH(
      authenticatedRequest(`/api/documents/${documentId}/labels`, {
        method: "PATCH",
        body: JSON.stringify({ labelId, action: "approve" }),
      }),
      { params: Promise.resolve({ id: documentId }) },
    );
    const selectExisting = client.calls.find(
      (call) => call.table === "document_labels" && call.operation === "select" && call.maybeSingle,
    );

    expect(response.status).toBe(404);
    expect(await payload(response)).toMatchObject({ error: "Tag not found." });
    expect(selectExisting?.filters).toEqual(
      expect.arrayContaining([
        { column: "id", value: labelId },
        { column: "document_id", value: documentId },
        { column: "owner_id", value: userId },
      ]),
    );
    expect(client.calls.some((call) => call.table === "document_labels" && call.operation === "update")).toBe(false);
    expect(invalidateRagCachesForDocumentMutation).not.toHaveBeenCalled();
  });

  it("refuses to mutate generated document labels", async () => {
    const generatedLabelId = "77777777-7777-4777-8777-777777777777";
    const client = createSupabaseMock((call) => {
      if (call.table === "documents") return ok({ id: documentId, owner_id: userId });
      if (call.table === "document_labels" && call.operation === "select" && call.maybeSingle) return ok(null);
      return ok([]);
    });
    mockRuntime(client);
    const { PATCH } = await import("../src/app/api/documents/[id]/labels/route");

    const response = await PATCH(
      authenticatedRequest(`/api/documents/${documentId}/labels`, {
        method: "PATCH",
        body: JSON.stringify({ labelId: generatedLabelId, label: "Lithium toxicity", label_type: "risk" }),
      }),
      { params: Promise.resolve({ id: documentId }) },
    );

    expect(response.status).toBe(404);
    expect(await payload(response)).toMatchObject({ error: "Manual tag not found." });
    expect(client.calls.some((call) => call.table === "document_labels" && call.operation === "update")).toBe(false);
  });

  it("deletes only manual document labels", async () => {
    const manualLabelId = "88888888-8888-4888-8888-888888888888";
    const client = createSupabaseMock((call) => {
      if (call.table === "documents") return ok({ id: documentId, owner_id: userId });
      if (call.table === "document_labels" && call.operation === "select" && call.maybeSingle) {
        return ok({ id: manualLabelId });
      }
      if (call.table === "document_labels" && call.operation === "delete") return ok([]);
      if (call.table === "document_labels" && call.operation === "select") return ok([]);
      return ok([]);
    });
    const invalidateRagCachesForDocumentMutation = vi.fn();
    mockRuntime(client, { invalidateRagCachesForDocumentMutation });
    const { DELETE } = await import("../src/app/api/documents/[id]/labels/route");

    const response = await DELETE(
      authenticatedRequest(`/api/documents/${documentId}/labels`, {
        method: "DELETE",
        body: JSON.stringify({ labelId: manualLabelId }),
      }),
      { params: Promise.resolve({ id: documentId }) },
    );
    const deleteCall = client.calls.find((call) => call.table === "document_labels" && call.operation === "delete");

    expect(response.status).toBe(200);
    expect(await payload(response)).toMatchObject({ deleted: true, labelId: manualLabelId, labels: [] });
    expect(deleteCall?.filters).toContainEqual({ column: "source", value: "manual" });
    expect(invalidateRagCachesForDocumentMutation).toHaveBeenCalledWith(userId, { affectsPublicCorpus: false });
  });

  it("permanently deletes an owned document, indexing traces, and storage objects", async () => {
    const sourcePath = `${userId}/documents/${documentId}/source.pdf`;
    const imagePath = `${userId}/images/${imageId}.png`;
    const client = createSupabaseMock((call) => {
      if (call.table === "documents" && call.operation === "select") {
        return ok({ id: documentId, owner_id: userId, title: "Owned", storage_path: sourcePath });
      }
      if (call.table === "ingestion_jobs" && call.operation === "select") return ok([]);
      if (call.table === "document_images" && call.operation === "select") return ok([{ storage_path: imagePath }]);
      if (call.table === "document_chunks" && call.operation === "select") return ok([]);
      if (call.table === "storage_cleanup_jobs" && call.operation === "insert") return ok({ id: "cleanup-1" });
      if (call.table === "storage_cleanup_jobs" && call.operation === "update") return ok([]);
      if (call.table === "rag_queries" && call.operation === "delete") return ok([]);
      if (call.table === "rag_query_misses" && call.operation === "delete") return ok([]);
      if (call.table === "rag_response_cache" && call.operation === "delete") return ok([]);
      if (call.table === "documents" && call.operation === "delete") return ok([]);
      return ok([]);
    });
    client.rpc.mockImplementation(async (name: string) =>
      name === "delete_document_if_idle"
        ? ok({
            outcome: "deleted",
            cleanup_job_id: "55555555-5555-4555-8555-555555555555",
            document_title: "Owned",
            source_path: sourcePath,
            image_paths: [imagePath],
          })
        : ok([]),
    );
    mockRuntime(client);
    const { DELETE } = await import("../src/app/api/documents/[id]/route");

    const response = await DELETE(authenticatedRequest(`/api/documents/${documentId}`, { method: "DELETE" }), {
      params: Promise.resolve({ id: documentId }),
    });
    const body = await payload(response);
    const cleanupUpdate = client.calls.find(
      (call) => call.table === "storage_cleanup_jobs" && call.operation === "update",
    );

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ deleted: true, documentId, storageWarnings: [] });
    expect(client.rpc).toHaveBeenCalledWith("delete_document_if_idle", {
      p_document_id: documentId,
      p_owner_id: userId,
      p_document_bucket: "clinical-documents",
      p_image_bucket: "clinical-images",
    });
    expect(cleanupUpdate?.updatePayload).toMatchObject({ status: "completed", storage_removed: 0 });
    expect(client.storageMocks.storageFrom).toHaveBeenCalledWith("clinical-documents");
    expect(client.storageMocks.storageFrom).toHaveBeenCalledWith("clinical-images");
    expect(client.storageMocks.remove).toHaveBeenCalledWith([sourcePath]);
    expect(client.storageMocks.remove).toHaveBeenCalledWith([imagePath]);
  });

  it("removes transactionally snapshotted image paths in storage batches", async () => {
    const sourcePath = `${userId}/documents/${documentId}/source.pdf`;
    const firstImagePage = Array.from({ length: 1000 }, (_, index) => ({
      storage_path: `${userId}/images/${index}.png`,
    }));
    const finalImage = { storage_path: `${userId}/images/final.png` };
    const client = createSupabaseMock((call) => {
      if (call.table === "documents" && call.operation === "select") {
        return ok({ id: documentId, owner_id: userId, title: "Owned", storage_path: sourcePath });
      }
      if (call.table === "ingestion_jobs" && call.operation === "select") return ok([]);
      if (call.table === "document_images" && call.operation === "select") {
        return call.range?.from === 0 ? ok(firstImagePage) : ok([finalImage]);
      }
      if (call.table === "document_chunks" && call.operation === "select") return ok([]);
      if (call.table === "storage_cleanup_jobs" && call.operation === "insert") return ok({ id: "cleanup-1" });
      if (call.table === "storage_cleanup_jobs" && call.operation === "update") return ok([]);
      if (call.table === "rag_queries" && call.operation === "delete") return ok([]);
      if (call.table === "rag_query_misses" && call.operation === "delete") return ok([]);
      if (call.table === "rag_response_cache" && call.operation === "delete") return ok([]);
      if (call.table === "documents" && call.operation === "delete") return ok([]);
      return ok([]);
    });
    client.rpc.mockImplementation(async (name: string) =>
      name === "delete_document_if_idle"
        ? ok({
            outcome: "deleted",
            cleanup_job_id: "55555555-5555-4555-8555-555555555555",
            document_title: "Owned",
            source_path: sourcePath,
            image_paths: [...firstImagePage.map((image) => image.storage_path), finalImage.storage_path],
          })
        : ok([]),
    );
    mockRuntime(client);
    const { DELETE } = await import("../src/app/api/documents/[id]/route");

    const response = await DELETE(authenticatedRequest(`/api/documents/${documentId}`, { method: "DELETE" }), {
      params: Promise.resolve({ id: documentId }),
    });
    expect(response.status).toBe(200);
    expect(client.storageMocks.remove).toHaveBeenCalledWith(firstImagePage.map((image) => image.storage_path));
    expect(client.storageMocks.remove).toHaveBeenCalledWith([finalImage.storage_path]);
    expect(client.calls.some((call) => call.table === "document_images")).toBe(false);
    expect(client.calls.some((call) => call.table === "document_chunks")).toBe(false);
  });

  it("does not touch storage when transactional deletion fails", async () => {
    const client = createSupabaseMock((call) => {
      if (call.table === "documents" && call.operation === "select") {
        return ok({ id: documentId, owner_id: userId, title: "Owned", storage_path: "source.pdf" });
      }
      if (call.table === "ingestion_jobs" && call.operation === "select") return ok([]);
      if (call.table === "document_images" && call.operation === "select") return ok([]);
      if (call.table === "document_chunks" && call.operation === "select") return ok([]);
      if (call.table === "storage_cleanup_jobs" && call.operation === "insert") return ok({ id: "cleanup-1" });
      if (call.table === "storage_cleanup_jobs" && call.operation === "update") return ok([]);
      if (call.table === "rag_queries" && call.operation === "delete") return fail("query log delete failed");
      if (call.table === "rag_query_misses" && call.operation === "delete") return ok([]);
      if (call.table === "rag_response_cache" && call.operation === "delete") return ok([]);
      if (call.table === "documents" && call.operation === "delete") return ok([]);
      return ok([]);
    });
    client.rpc.mockImplementation(async (name: string) =>
      name === "delete_document_if_idle" ? fail("index trace cleanup failed") : ok([]),
    );
    mockRuntime(client);
    const { DELETE } = await import("../src/app/api/documents/[id]/route");

    const response = await DELETE(authenticatedRequest(`/api/documents/${documentId}`, { method: "DELETE" }), {
      params: Promise.resolve({ id: documentId }),
    });
    expect(response.status).toBe(500);
    expect(await payload(response)).toMatchObject({ error: "Request failed." });
    expect(client.storageMocks.remove).not.toHaveBeenCalled();
  });

  // M9 (audit 2026-07-01): the guard covers PENDING jobs too — a just-queued
  // reindex racing a delete used to orphan freshly-uploaded storage objects.
  it.each(["processing", "pending"] as const)(
    "blocks permanent delete while a document has %s indexing work",
    async (jobStatus) => {
      const client = createSupabaseMock((call) => {
        if (call.table === "documents" && call.operation === "select") {
          return ok({ id: documentId, owner_id: userId, title: "Owned", storage_path: "source.pdf" });
        }
        if (call.table === "ingestion_jobs" && call.operation === "select") {
          return ok([{ id: "job-1", status: jobStatus }]);
        }
        return ok([]);
      });
      client.rpc.mockImplementation(async (name: string) =>
        name === "delete_document_if_idle"
          ? ok({
              outcome: "active_job",
              job_id: "66666666-6666-4666-8666-666666666666",
              job_status: jobStatus,
            })
          : ok([]),
      );
      mockRuntime(client);
      const { DELETE } = await import("../src/app/api/documents/[id]/route");

      const response = await DELETE(authenticatedRequest(`/api/documents/${documentId}`, { method: "DELETE" }), {
        params: Promise.resolve({ id: documentId }),
      });

      expect(response.status).toBe(409);
      expect(await payload(response)).toMatchObject({
        error: "Document has pending or processing indexing work. Stop or wait for the worker before deleting.",
      });
      expect(client.calls.some((call) => call.table === "documents" && call.operation === "delete")).toBe(false);
      expect(client.storageMocks.remove).not.toHaveBeenCalled();
    },
  );

  it("allows anonymous search and answer requests with anonymous rate-limit subjects", async () => {
    const searchChunksWithTelemetry = vi.fn(async () => ({
      results: [],
      telemetry: {
        search_cache_hit: false,
        text_fast_path_latency_ms: 0,
        embedding_skipped: true,
        embedding_latency_ms: 0,
        embedding_cache_hit: false,
        supabase_rpc_latency_ms: 0,
        rerank_latency_ms: 0,
        retrieval_strategy: "text_fast_path",
      },
    }));
    const answerQuestionWithScope = vi.fn(async () => ({
      answer: "No owned evidence.",
      grounded: false,
      confidence: "unsupported",
      citations: [],
      sources: [],
    }));
    const client = createSupabaseMock();
    mockRuntime(client, { searchChunksWithTelemetry, answerQuestionWithScope });

    const searchRoute = await import("../src/app/api/search/route");
    const answerRoute = await import("../src/app/api/answer/route");

    const searchResponse = await searchRoute.POST(
      request("/api/search", {
        method: "POST",
        body: JSON.stringify({ query: "monitoring" }),
      }),
    );
    const answerResponse = await answerRoute.POST(
      request("/api/answer", {
        method: "POST",
        body: JSON.stringify({ query: "monitoring" }),
      }),
    );

    expect(searchResponse.status).toBe(200);
    expect(answerResponse.status).toBe(200);
    const answerPayload = await payload(answerResponse);
    expect(answerPayload).toMatchObject({
      interactionId: expect.any(String),
      feedbackToken: expect.any(String),
    });
    expect(searchChunksWithTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: undefined, allowGlobalSearch: true }),
    );
    expect(answerQuestionWithScope).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: undefined,
        allowGlobalSearch: true,
        observationContext: { interactionId: expect.any(String), rolloutMode: "legacy" },
      }),
    );
    const [answerCall] = answerQuestionWithScope.mock.calls as unknown as [
      [{ observationContext?: { interactionId: string } }],
    ];
    expect(answerCall?.[0].observationContext?.interactionId).toBe(answerPayload.interactionId);
    expect(client.auth.getUser).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalledWith(
      "consume_api_rate_limit",
      expect.objectContaining({ p_bucket: "search" }),
    );
  });

  it("does not complete the HTTP answer before configured joined persistence settles", async () => {
    let release!: () => void;
    const persistence = new Promise<void>((resolve) => {
      release = resolve;
    });
    const persistAnswerDiagnostics = vi.fn(() => persistence);
    const answerQuestionWithScope = vi.fn(async () => ({
      answer: "No owned evidence.",
      grounded: false,
      confidence: "unsupported",
      citations: [],
      sources: [],
    }));
    const client = createSupabaseMock();
    mockRuntime(client, { answerQuestionWithScope });
    vi.doMock("@/lib/answer-telemetry", () => ({ persistAnswerDiagnostics }));
    const answerRoute = await import("../src/app/api/answer/route");

    let responseSettled = false;
    const response = answerRoute
      .POST(
        request("/api/answer", {
          method: "POST",
          body: JSON.stringify({ query: "monitoring" }),
        }),
      )
      .then((value) => {
        responseSettled = true;
        return value;
      });
    await vi.waitFor(() => expect(persistAnswerDiagnostics).toHaveBeenCalledOnce());

    expect(responseSettled).toBe(false);
    release();
    expect((await response).status).toBe(200);
  });

  it("rejects invalid bearer tokens instead of using anonymous search scope", async () => {
    const searchChunksWithTelemetry = vi.fn(async () => ({
      results: [],
      telemetry: {
        search_cache_hit: false,
        text_fast_path_latency_ms: 0,
        embedding_skipped: true,
        embedding_latency_ms: 0,
        embedding_cache_hit: false,
        supabase_rpc_latency_ms: 0,
        rerank_latency_ms: 0,
        retrieval_strategy: "text_fast_path",
      },
    }));
    const client = createSupabaseMock();
    mockRuntime(client, { searchChunksWithTelemetry });
    const searchRoute = await import("../src/app/api/search/route");

    const response = await searchRoute.POST(
      request("/api/search", {
        method: "POST",
        headers: {
          authorization: "Bearer expired-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ query: "monitoring" }),
      }),
    );

    expect(response.status).toBe(401);
    expect(await payload(response)).toMatchObject({ code: "authentication_required" });
    expect(searchChunksWithTelemetry).not.toHaveBeenCalled();
  });

  it("rate limits anonymous answer bursts before generation", async () => {
    const answerQuestionWithScope = vi.fn(async () => ({
      answer: "Public evidence.",
      grounded: true,
      confidence: "medium",
      citations: [],
      sources: [],
    }));
    const client = createSupabaseMock();
    mockRuntime(client, { answerQuestionWithScope });
    const answerRoute = await import("../src/app/api/answer/route");
    const anonymousAnswerRequest = () =>
      request("/api/answer", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "anonymous-answer-limit-test",
          "x-real-ip": "198.51.100.77",
        },
        body: JSON.stringify({ query: "monitoring" }),
      });

    for (let index = 0; index < 6; index += 1) {
      const response = await answerRoute.POST(anonymousAnswerRequest());
      expect(response.status).toBe(200);
    }

    const limited = await answerRoute.POST(anonymousAnswerRequest());
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("60");
    expect(await payload(limited)).toMatchObject({
      error: "Too many answer requests. Retry shortly.",
      details: { kind: "rate_limit", retryAfterSeconds: 60 },
    });
    expect(answerQuestionWithScope).toHaveBeenCalledTimes(6);
    expect(client.rpc).not.toHaveBeenCalledWith(
      "consume_api_rate_limit",
      expect.objectContaining({ p_bucket: "answer" }),
    );
  });

  it("rate limits authenticated answer generation without limiting authenticated search", async () => {
    const searchChunksWithTelemetry = vi.fn(async () => ({
      results: [],
      telemetry: {
        search_cache_hit: false,
        text_fast_path_latency_ms: 0,
        embedding_skipped: true,
        embedding_latency_ms: 0,
        embedding_cache_hit: false,
        supabase_rpc_latency_ms: 0,
        rerank_latency_ms: 0,
        retrieval_strategy: "text_fast_path",
      },
    }));
    const answerQuestionWithScope = vi.fn(async () => ({
      answer: "Source-backed answer.",
      grounded: true,
      confidence: "medium",
      citations: [],
      sources: [],
    }));
    const client = createSupabaseMock();
    client.rpc.mockImplementation(async (name: string, args?: Record<string, unknown>) =>
      name === "consume_api_rate_limit" && args?.p_bucket === "answer"
        ? { data: [rateLimitRow({ limited: true, limit_value: 30, remaining: 0 })], error: null }
        : name === "consume_api_rate_limit"
          ? { data: [rateLimitRow()], error: null }
          : ok([]),
    );
    mockRuntime(client, { searchChunksWithTelemetry, answerQuestionWithScope });

    const answerRoute = await import("../src/app/api/answer/route");
    const searchRoute = await import("../src/app/api/search/route");
    const answerRequest = () =>
      authenticatedRequest("/api/answer", {
        method: "POST",
        headers: { "x-forwarded-for": "203.0.113.10" },
        body: JSON.stringify({ query: "monitoring" }),
      });

    const limited = await answerRoute.POST(answerRequest());
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("60");
    expect(await payload(limited)).toMatchObject({
      error: "Too many answer requests. Retry shortly.",
      details: { kind: "rate_limit", retryAfterSeconds: 60 },
    });
    expect(answerQuestionWithScope).not.toHaveBeenCalled();

    const searchResponse = await searchRoute.POST(
      authenticatedRequest("/api/search", {
        method: "POST",
        headers: { "x-forwarded-for": "203.0.113.10" },
        body: JSON.stringify({ query: "monitoring" }),
      }),
    );

    expect(searchResponse.status).toBe(200);
    expect(searchChunksWithTelemetry).toHaveBeenCalledWith(expect.objectContaining({ ownerId: userId }));
    expect(client.rpc).toHaveBeenCalledWith(
      "consume_api_rate_limit",
      expect.objectContaining({ p_owner_id: userId, p_bucket: "answer" }),
    );
    expect(client.rpc).toHaveBeenCalledWith(
      "consume_api_rate_limit",
      expect.objectContaining({ p_owner_id: userId, p_bucket: "search" }),
    );
  });

  it("rate limits abnormal authenticated search bursts with retry metadata", async () => {
    const searchChunksWithTelemetry = vi.fn(async () => ({
      results: [],
      telemetry: {
        search_cache_hit: false,
        text_fast_path_latency_ms: 0,
        embedding_skipped: true,
        embedding_latency_ms: 0,
        embedding_cache_hit: false,
        supabase_rpc_latency_ms: 0,
        rerank_latency_ms: 0,
        retrieval_strategy: "text_fast_path",
        weighted_top_score: 0,
        rrf_top_score: 0,
      },
    }));
    const client = createSupabaseMock();
    client.rpc.mockImplementation(async (name: string, args?: Record<string, unknown>) =>
      name === "consume_api_rate_limit" && args?.p_bucket === "search"
        ? { data: [rateLimitRow({ limited: true, limit_value: 2, remaining: 0 })], error: null }
        : name === "consume_api_rate_limit"
          ? { data: [rateLimitRow()], error: null }
          : ok([]),
    );
    mockRuntime(client, { searchChunksWithTelemetry });
    const searchRoute = await import("../src/app/api/search/route");
    const searchRequest = () =>
      authenticatedRequest("/api/search", {
        method: "POST",
        headers: { "x-forwarded-for": "203.0.113.20" },
        body: JSON.stringify({ query: "monitoring", includeRelatedDocuments: false }),
      });

    const limited = await searchRoute.POST(searchRequest());
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("60");
    expect(await payload(limited)).toMatchObject({
      error: "Search is temporarily rate limited because too many requests were received. Retry shortly.",
      details: { kind: "rate_limit", retryAfterSeconds: 60 },
    });
    expect(searchChunksWithTelemetry).not.toHaveBeenCalled();
  });

  it("fails closed when the durable rate limit check is unavailable", async () => {
    const searchChunksWithTelemetry = vi.fn(async () => ({
      results: [],
      telemetry: {
        search_cache_hit: false,
        text_fast_path_latency_ms: 0,
        embedding_skipped: true,
        embedding_latency_ms: 0,
        embedding_cache_hit: false,
        supabase_rpc_latency_ms: 0,
        rerank_latency_ms: 0,
        retrieval_strategy: "text_fast_path",
      },
    }));
    const client = createSupabaseMock();
    client.rpc.mockImplementation(async (name: string) =>
      name === "consume_api_rate_limit" || name === "consume_api_subject_rate_limit"
        ? fail("limiter table unavailable")
        : ok([]),
    );
    mockRuntime(client, { searchChunksWithTelemetry });
    const { POST } = await import("../src/app/api/search/route");

    const response = await POST(
      authenticatedRequest("/api/search", {
        method: "POST",
        body: JSON.stringify({ query: "monitoring", includeRelatedDocuments: false }),
      }),
    );

    expect(response.status).toBe(503);
    expect(await payload(response)).toMatchObject({ error: "Rate limit check is temporarily unavailable." });
    expect(searchChunksWithTelemetry).not.toHaveBeenCalled();
  });

  it("uses an anonymous in-memory limiter for public search when the durable anonymous limiter is unavailable", async () => {
    const searchChunksWithTelemetry = vi.fn(async () => ({
      results: [],
      telemetry: {
        search_cache_hit: false,
        text_fast_path_latency_ms: 0,
        embedding_skipped: true,
        embedding_latency_ms: 0,
        embedding_cache_hit: false,
        supabase_rpc_latency_ms: 0,
        rerank_latency_ms: 0,
        retrieval_strategy: "text_fast_path",
      },
    }));
    const client = createSupabaseMock();
    client.rpc.mockImplementation(async (name: string) =>
      name === "consume_api_subject_rate_limit" ? fail("anonymous limiter table unavailable") : ok([]),
    );
    mockRuntime(client, { searchChunksWithTelemetry });
    const { POST } = await import("../src/app/api/search/route");

    const response = await POST(
      request("/api/search", {
        method: "POST",
        headers: { "x-forwarded-for": "203.0.113.21" },
        body: JSON.stringify({ query: "monitoring", includeRelatedDocuments: false }),
      }),
    );

    expect(response.status).toBe(200);
    expect(searchChunksWithTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: undefined, allowGlobalSearch: true }),
    );
    expect(client.auth.getUser).not.toHaveBeenCalled();
  });

  it("falls back to visible demo search only outside production when Supabase rejects the API key", async () => {
    const searchChunksWithTelemetry = vi.fn(async () => ({
      results: [],
      telemetry: { retrieval_strategy: "text_fast_path" },
    }));
    const client = createSupabaseMock((call) =>
      call.table === "documents" && call.operation === "select" ? fail("Unregistered API key") : ok([]),
    );
    mockRuntime(client, { searchChunksWithTelemetry });
    const { POST } = await import("../src/app/api/search/route");

    const response = await POST(
      request("/api/search", {
        method: "POST",
        body: JSON.stringify({
          query: "clozapine monitoring",
          includeRelatedDocuments: false,
          filters: { sourceStatuses: ["current"] },
        }),
      }),
    );
    const body = await payload(response);

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Clinical-KB-Fallback")).toBe("supabase_api_key_configuration_unavailable");
    expect(body).toMatchObject({
      demoMode: true,
      fallbackMode: "non_production_demo",
      fallbackReason: "supabase_api_key_configuration_unavailable",
      degradedMode: { active: true, reason: "supabase_api_key_configuration_unavailable" },
    });
    expect(Array.isArray(body.results) ? body.results.length : 0).toBeGreaterThan(0);
    expect(searchChunksWithTelemetry).not.toHaveBeenCalled();
  });

  it("does not fall back to demo search in production when Supabase rejects the API key", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const searchChunksWithTelemetry = vi.fn(async () => ({
      results: [],
      telemetry: { retrieval_strategy: "text_fast_path" },
    }));
    const client = createSupabaseMock((call) =>
      call.table === "documents" && call.operation === "select" ? fail("Unregistered API key") : ok([]),
    );
    mockRuntime(client, { searchChunksWithTelemetry });
    const { POST } = await import("../src/app/api/search/route");

    const response = await POST(
      request("/api/search", {
        method: "POST",
        body: JSON.stringify({
          query: "clozapine monitoring",
          includeRelatedDocuments: false,
          filters: { sourceStatuses: ["current"] },
        }),
      }),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("X-Clinical-KB-Fallback")).toBeNull();
    expect(await payload(response)).toMatchObject({ error: "Search failed. Retry with a narrower question." });
    expect(searchChunksWithTelemetry).not.toHaveBeenCalled();
  });

  it("logs failed search telemetry against the parsed query instead of an unknown placeholder", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const searchChunksWithTelemetry = vi.fn(async () => ({
      results: [],
      telemetry: { retrieval_strategy: "text_fast_path" },
    }));
    const client = createSupabaseMock((call) =>
      call.table === "documents" && call.operation === "select" ? fail("Unregistered API key") : ok([]),
    );
    mockRuntime(client, { searchChunksWithTelemetry });
    const { POST } = await import("../src/app/api/search/route");

    const response = await POST(
      authenticatedRequest("/api/search", {
        method: "POST",
        body: JSON.stringify({
          query: "Clozapine monitoring",
          includeRelatedDocuments: false,
          filters: { sourceStatuses: ["current"] },
        }),
      }),
    );

    expect(response.status).toBe(500);
    await vi.waitFor(() => {
      const insert = client.calls.find((call) => call.table === "rag_queries" && call.operation === "insert");
      expect(insert).toBeTruthy();
      const payload = insert?.insertPayload as Record<string, unknown>;
      const expectedHash = createHmac("sha256", "test-query-hash-secret-at-least-16-chars")
        .update("clozapine monitoring")
        .digest("hex");
      const unknownHash = createHmac("sha256", "test-query-hash-secret-at-least-16-chars")
        .update("unknown")
        .digest("hex");
      expect(payload.query).toBe(`redacted-query:${expectedHash}`);
      expect(payload.query).not.toBe(`redacted-query:${unknownHash}`);
    });
  });

  it("falls back to visible demo answers only outside production when Supabase rejects the API key", async () => {
    const answerQuestionWithScope = vi.fn(async () => ({
      answer: "Live answer",
      grounded: true,
      confidence: "medium",
      citations: [],
      sources: [],
    }));
    const client = createSupabaseMock((call) =>
      call.table === "documents" && call.operation === "select" ? fail("Unregistered API key") : ok([]),
    );
    mockRuntime(client, { answerQuestionWithScope });
    const { POST } = await import("../src/app/api/answer/route");

    const response = await POST(
      request("/api/answer", {
        method: "POST",
        body: JSON.stringify({ query: "clozapine monitoring", filters: { sourceStatuses: ["current"] } }),
      }),
    );
    const body = await payload(response);

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Clinical-KB-Fallback")).toBe("supabase_api_key_configuration_unavailable");
    expect(body).toMatchObject({
      demoMode: true,
      fallbackMode: "non_production_demo",
      fallbackReasonCode: "unknown",
      degradedMode: { active: true, reason: "The answer could not be completed from the currently verified sources." },
    });
    expect(body).not.toHaveProperty("fallbackReason");
    expect(String(body.answer)).toContain("Synthetic");
    expect(answerQuestionWithScope).not.toHaveBeenCalled();
  });

  it("falls back to a final streamed demo answer outside production when Supabase rejects the API key", async () => {
    const answerQuestionWithScope = vi.fn(async () => ({
      answer: "Live answer",
      grounded: true,
      confidence: "medium",
      citations: [],
      sources: [],
    }));
    const client = createSupabaseMock((call) =>
      call.table === "documents" && call.operation === "select" ? fail("Unregistered API key") : ok([]),
    );
    mockRuntime(client, { answerQuestionWithScope });
    const { POST } = await import("../src/app/api/answer/stream/route");

    const response = await POST(
      request("/api/answer/stream", {
        method: "POST",
        body: JSON.stringify({ query: "clozapine monitoring", filters: { sourceStatuses: ["current"] } }),
      }),
    );
    const body = await response.text();
    const finalPayload = ssePayload(body, "final");

    expect(response.status).toBe(200);
    expect(body).not.toContain("event: error");
    expect(finalPayload).toMatchObject({
      demoMode: true,
      fallbackMode: "non_production_demo",
      fallbackReasonCode: "unknown",
      degradedMode: { active: true, reason: "The answer could not be completed from the currently verified sources." },
    });
    expect(finalPayload).not.toHaveProperty("fallbackReason");
    expect(String(finalPayload.answer)).toContain("Synthetic");
    expect(answerQuestionWithScope).not.toHaveBeenCalled();
  });

  it("does not stream demo fallback in production when Supabase rejects the API key", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const answerQuestionWithScope = vi.fn(async () => ({
      answer: "Live answer",
      grounded: true,
      confidence: "medium",
      citations: [],
      sources: [],
    }));
    const client = createSupabaseMock((call) =>
      call.table === "documents" && call.operation === "select" ? fail("Unregistered API key") : ok([]),
    );
    mockRuntime(client, { answerQuestionWithScope });
    const { POST } = await import("../src/app/api/answer/stream/route");

    const response = await POST(
      request("/api/answer/stream", {
        method: "POST",
        body: JSON.stringify({ query: "clozapine monitoring", filters: { sourceStatuses: ["current"] } }),
      }),
    );
    const body = await response.text();
    const errorPayload = ssePayload(body, "error");

    expect(response.status).toBe(200);
    expect(body).not.toContain("event: final");
    expect(errorPayload).toMatchObject({
      error: "Answer generation failed. Retry with a narrower question.",
      message: "Answer generation failed. Retry with a narrower question.",
      code: "supabase_api_key_configuration",
      status: 500,
      // Key-configuration failures carry a stable code so a production outage is
      // diagnosable from the client network tab (confirmed live 2026-07-06).
    });
    expect(JSON.stringify(errorPayload)).not.toMatch(
      /stack|causeName|causeMessage|sqlState|private\/path|[A-Za-z]:\\\\/i,
    );
    expect(answerQuestionWithScope).not.toHaveBeenCalled();
  });

  it("uses an anonymous in-memory limiter for managed local no-auth search", async () => {
    const searchChunksWithTelemetry = vi.fn(async () => ({
      results: [],
      telemetry: {
        search_cache_hit: false,
        text_fast_path_latency_ms: 0,
        embedding_skipped: true,
        embedding_latency_ms: 0,
        embedding_cache_hit: false,
        supabase_rpc_latency_ms: 0,
        rerank_latency_ms: 0,
        retrieval_strategy: "text_fast_path",
      },
    }));
    const client = createSupabaseMock();
    client.auth.admin.listUsers.mockResolvedValueOnce({
      data: { users: [{ id: userId, email: "clinician@example.test" }], nextPage: 0 },
      error: null,
    });
    client.rpc.mockImplementation(async (name: string) =>
      name === "consume_api_rate_limit" ? fail("limiter table unavailable") : ok([]),
    );
    mockRuntime(
      client,
      { searchChunksWithTelemetry },
      { localNoAuth: true, localOwnerEmail: "clinician@example.test" },
    );
    const { POST } = await import("../src/app/api/search/route");

    const response = await POST(
      localPortRequest(4298, "/api/search", {
        method: "POST",
        body: JSON.stringify({ query: "monitoring", includeRelatedDocuments: false }),
      }),
    );

    expect(response.status).toBe(200);
    expect(searchChunksWithTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: undefined, allowGlobalSearch: true }),
    );
    expect(client.rpc).not.toHaveBeenCalledWith(
      "consume_api_rate_limit",
      expect.objectContaining({ p_owner_id: userId, p_bucket: "search" }),
    );
  });

  it("coalesces identical in-flight authenticated search requests", async () => {
    let releaseSearch!: () => void;
    const searchGate = new Promise<void>((resolve) => {
      releaseSearch = resolve;
    });
    const searchChunksWithTelemetry = vi.fn(async () => {
      await searchGate;
      return {
        results: [],
        telemetry: {
          search_cache_hit: false,
          text_fast_path_latency_ms: 0,
          embedding_skipped: true,
          embedding_latency_ms: 0,
          embedding_cache_hit: false,
          supabase_rpc_latency_ms: 0,
          rerank_latency_ms: 0,
          retrieval_strategy: "text_fast_path",
          weighted_top_score: 0,
          rrf_top_score: 0,
        },
      };
    });
    const client = createSupabaseMock();
    mockRuntime(client, { searchChunksWithTelemetry });
    const searchRoute = await import("../src/app/api/search/route");
    const searchRequest = () =>
      authenticatedRequest("/api/search", {
        method: "POST",
        headers: { "x-real-ip": "203.0.113.21" },
        body: JSON.stringify({ query: "monitoring", includeRelatedDocuments: false }),
      });

    const first = searchRoute.POST(searchRequest());
    const second = searchRoute.POST(searchRequest());
    await vi.waitFor(() => expect(searchChunksWithTelemetry).toHaveBeenCalledTimes(1), {
      timeout: 2000,
      interval: 20,
    });
    expect(searchChunksWithTelemetry).toHaveBeenCalledTimes(1);

    releaseSearch();
    const [firstResponse, secondResponse] = await Promise.all([first, second]);
    const firstPayload = await payload(firstResponse);
    const secondPayload = await payload(secondResponse);

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(firstPayload.telemetry).toMatchObject({ coalesced: false });
    expect(secondPayload.telemetry).toMatchObject({ coalesced: true });
  });

  it("cancels shared search work only after every coalesced caller disconnects", async () => {
    let providerSignal: AbortSignal | undefined;
    const searchChunksWithTelemetry = vi.fn(async (args: { signal?: AbortSignal }) => {
      providerSignal = args.signal;
      return new Promise<never>((_resolve, reject) => {
        args.signal?.addEventListener(
          "abort",
          () => reject(args.signal?.reason ?? new DOMException("aborted", "AbortError")),
          { once: true },
        );
      });
    });
    const client = createSupabaseMock();
    mockRuntime(client, { searchChunksWithTelemetry });
    const searchRoute = await import("../src/app/api/search/route");
    const firstController = new AbortController();
    const secondController = new AbortController();
    const searchRequest = (signal: AbortSignal) =>
      authenticatedRequest("/api/search", {
        method: "POST",
        signal,
        body: JSON.stringify({ query: "cancel shared monitoring search", includeRelatedDocuments: false }),
      });

    const first = searchRoute.POST(searchRequest(firstController.signal));
    const second = searchRoute.POST(searchRequest(secondController.signal));
    await vi.waitFor(
      () => {
        expect(searchChunksWithTelemetry).toHaveBeenCalledTimes(1);
        expect(providerSignal).toBeDefined();
      },
      { timeout: 2000, interval: 20 },
    );
    expect(searchChunksWithTelemetry).toHaveBeenCalledTimes(1);

    firstController.abort(new DOMException("first caller left", "AbortError"));
    await first;
    expect(providerSignal?.aborted).toBe(false);

    secondController.abort(new DOMException("second caller left", "AbortError"));
    await second;
    expect(providerSignal?.aborted).toBe(true);
  });

  it("does not poison a new healthy search caller after the last coalesced waiter disconnects", async () => {
    let searchCalls = 0;
    const searchChunksWithTelemetry = vi.fn(async (args: { signal?: AbortSignal }) => {
      searchCalls += 1;
      const signal = args.signal;
      if (searchCalls === 1) {
        return new Promise<never>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason ?? new DOMException("aborted", "AbortError")), {
            once: true,
          });
          if (signal?.aborted) {
            reject(signal.reason ?? new DOMException("aborted", "AbortError"));
          }
        });
      }
      return {
        results: [],
        telemetry: {
          search_cache_hit: false,
          text_fast_path_latency_ms: 0,
          embedding_skipped: true,
          embedding_latency_ms: 0,
          embedding_cache_hit: false,
          supabase_rpc_latency_ms: 0,
          rerank_latency_ms: 0,
          retrieval_strategy: "text_fast_path",
          weighted_top_score: 0,
          rrf_top_score: 0,
        },
      };
    });
    const client = createSupabaseMock();
    mockRuntime(client, { searchChunksWithTelemetry });
    const searchRoute = await import("../src/app/api/search/route");
    const firstController = new AbortController();
    const searchRequest = (signal: AbortSignal) =>
      authenticatedRequest("/api/search", {
        method: "POST",
        signal,
        body: JSON.stringify({
          query: "poison race monitoring search",
          includeRelatedDocuments: false,
        }),
      });

    const first = searchRoute.POST(searchRequest(firstController.signal));
    await vi.waitFor(() => expect(searchCalls).toBe(1), { timeout: 2000, interval: 20 });
    expect(searchCalls).toBe(1);

    firstController.abort(new DOMException("sole search waiter left", "AbortError"));
    const firstResponse = await first;
    expect(firstResponse.status).toBeGreaterThanOrEqual(400);

    const healthyController = new AbortController();
    const healthyResponse = await searchRoute.POST(searchRequest(healthyController.signal));
    const healthyPayload = await payload(healthyResponse);
    expect(healthyResponse.status).toBe(200);
    expect(healthyController.signal.aborted).toBe(false);
    expect(searchCalls).toBe(2);
    expect(healthyPayload.telemetry).toMatchObject({ coalesced: false });
  });

  it("streams only public progress details and exactly one completion before the final answer", async () => {
    const answerQuestionWithScope = vi.fn(async (args: { onProgress?: (event: unknown) => void | Promise<void> }) => {
      await args.onProgress?.({
        stage: "routing",
        message: "private-message-marker",
        resultCount: 2,
        visibleSourceCount: 1,
        timingMs: 42,
        selectedContextCount: 4.9,
        australianSourceCount: 4,
        waSourceCount: 3,
        usedSupplementaryFallback: true,
        model: "private-model-marker",
        mode: "private-mode-marker",
        reason: "private-reason-marker",
        smartApiPlan: { marker: "private-plan-marker" },
        relevance: { marker: "private-relevance-marker" },
        privateMarker: "private-direct-marker",
      });
      await args.onProgress?.({ stage: "complete", message: "private-complete-marker" });
      await args.onProgress?.({ stage: "complete", message: "private-duplicate-complete-marker" });
      return {
        answer: "Owned evidence.",
        grounded: true,
        confidence: "medium",
        citations: [],
        sources: [],
      };
    });
    const client = createSupabaseMock();
    mockRuntime(client, { answerQuestionWithScope });
    const { POST } = await import("../src/app/api/answer/stream/route");

    const response = await POST(
      authenticatedRequest("/api/answer/stream", {
        method: "POST",
        body: JSON.stringify({ query: "monitoring", documentId: otherDocumentId }),
      }),
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    const eventBlocks = body.split("\n\n").filter(Boolean);
    const progressBlocks = eventBlocks.filter((block) => block.includes("event: progress\n"));
    const completionBlocks = progressBlocks.filter((block) => block.includes('"stage":"complete"'));
    const rankingBlock = progressBlocks.find((block) => block.includes('"stage":"ranking"'));
    const rankingPayload = JSON.parse(
      rankingBlock!
        .split("\n")
        .find((line) => line.startsWith("data: "))!
        .slice("data: ".length),
    );

    expect(body.indexOf("event: progress")).toBeGreaterThanOrEqual(0);
    expect(body.indexOf("event: final")).toBeGreaterThan(body.lastIndexOf('"stage":"complete"'));
    expect(completionBlocks).toHaveLength(1);
    expectSingleCompletionBeforeFinal(body);
    expect(rankingPayload).toEqual({
      stage: "ranking",
      message: "Selecting the most relevant source passages.",
      resultCount: 2,
      selectedContextCount: 4,
      australianSourceCount: 4,
      waSourceCount: 3,
    });
    expect(body).not.toContain("usedSupplementaryFallback");
    expect(body).not.toContain("event: token");
    expect(body).not.toContain("event: revising");
    for (const privateMarker of [
      "private-message-marker",
      "private-model-marker",
      "private-mode-marker",
      "private-reason-marker",
      "private-plan-marker",
      "private-relevance-marker",
      "private-direct-marker",
      "private-complete-marker",
      "private-duplicate-complete-marker",
    ]) {
      expect(body).not.toContain(privateMarker);
    }
    expect(answerQuestionWithScope).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: userId, documentId: otherDocumentId, onProgress: expect.any(Function) }),
    );
    expect(client.auth.getUser).toHaveBeenCalledWith(token);
  });

  it("completes demo answers before their successful final event", async () => {
    const answerQuestionWithScope = vi.fn();
    const client = createSupabaseMock();
    mockRuntime(client, { answerQuestionWithScope }, { demoMode: true });
    const { POST } = await import("../src/app/api/answer/stream/route");

    const response = await POST(
      request("/api/answer/stream", {
        method: "POST",
        body: JSON.stringify({ query: "Lithium dosing" }),
      }),
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expectSingleCompletionBeforeFinal(body);
    expect(ssePayload(body, "final")).toMatchObject({ demoMode: true });
    expect(ssePayload(body, "final")).not.toHaveProperty("feedbackToken");
    expect(answerQuestionWithScope).not.toHaveBeenCalled();
  });

  it("preserves danger-governance warnings when streaming a demo refusal", async () => {
    const answerQuestionWithScope = vi.fn();
    const client = createSupabaseMock();
    mockRuntime(client, { answerQuestionWithScope }, { demoMode: true });
    vi.doMock("@/lib/demo-data", () => ({
      demoSummary: vi.fn(),
      demoAnswer: vi.fn(() => ({
        answer: "Use the outdated protocol.",
        grounded: true,
        confidence: "high",
        citations: [{ chunk_id: "demo-danger", document_id: documentId, page_number: 1 }],
        sources: [
          {
            id: "demo-danger",
            document_id: documentId,
            title: "Outdated demo guideline",
            file_name: "outdated-demo.pdf",
            page_number: 1,
            chunk_index: 0,
            section_heading: null,
            content: "Use the outdated protocol.",
            image_ids: [],
            similarity: 0.95,
            source_metadata: {
              source_title: "Outdated demo guideline",
              publisher: "Local WA service",
              jurisdiction: "Australia/WA",
              version: null,
              publication_date: null,
              review_date: null,
              uploaded_at: null,
              indexed_at: null,
              uploaded_by: null,
              document_status: "outdated",
              clinical_validation_status: "approved",
              extraction_quality: "good",
            },
            images: [],
          },
        ],
      })),
    }));
    const { POST } = await import("../src/app/api/answer/stream/route");

    const response = await POST(
      request("/api/answer/stream", {
        method: "POST",
        body: JSON.stringify({ query: "monitoring" }),
      }),
    );
    const responseBody = await response.text();
    const finalPayload = ssePayload(responseBody, "final");

    expect(response.status).toBe(200);
    expect(finalPayload).toMatchObject({
      grounded: false,
      confidence: "unsupported",
      citations: [],
      sources: [],
      demoMode: true,
      sourceGovernanceWarnings: expect.arrayContaining([
        expect.objectContaining({ code: "outdated_source", severity: "danger" }),
      ]),
    });
    expect(String(finalPayload.answer)).toContain("cannot provide a clinical answer");
    expect(answerQuestionWithScope).not.toHaveBeenCalled();
  });

  it("streams blank-document summaries through the committed full-document summary path", async () => {
    const answerQuestionWithScope = vi.fn();
    const summarizeDocument = vi.fn(async () => ({
      answer: "Full committed document summary.",
      grounded: true,
      confidence: "high",
      citations: [],
      sources: [],
    }));
    const client = createSupabaseMock();
    mockRuntime(client, { answerQuestionWithScope, summarizeDocument });
    const { POST } = await import("../src/app/api/answer/stream/route");

    const response = await POST(
      authenticatedRequest("/api/answer/stream", {
        method: "POST",
        body: JSON.stringify({
          query: "Summarize this document for practical clinical use.",
          documentId,
          summaryMode: true,
        }),
      }),
    );
    const responseBody = await response.text();

    expect(response.status).toBe(200);
    expect(responseBody).toContain('"stage":"retrieving"');
    expect(responseBody).toContain('"stage":"generating"');
    expect(ssePayload(responseBody, "final")).toMatchObject({
      answer: "Full committed document summary.",
      interactionId: expect.any(String),
      feedbackToken: expect.any(String),
    });
    expect(summarizeDocument).toHaveBeenCalledWith(documentId, userId, {
      signal: expect.any(AbortSignal),
      observationContext: { interactionId: expect.any(String), rolloutMode: "legacy" },
    });
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith(
      "consume_summary_rate_limits_atomic",
      expect.objectContaining({
        p_owner_id: userId,
        p_subject_key: null,
        p_answer_limit: 30,
        p_summary_limit: 12,
      }),
    );
    expect(answerQuestionWithScope).not.toHaveBeenCalled();
  });

  it("rejects document summary mode on the non-streaming answer endpoint", async () => {
    const answerQuestionWithScope = vi.fn();
    const client = createSupabaseMock();
    mockRuntime(client, { answerQuestionWithScope });
    const { POST } = await import("../src/app/api/answer/route");

    const response = await POST(
      authenticatedRequest("/api/answer", {
        method: "POST",
        body: JSON.stringify({
          query: "Summarize this document for practical clinical use.",
          documentId,
          summaryMode: true,
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await payload(response)).toMatchObject({
      code: "summary_mode_stream_required",
      error: "Document summaries require the streaming answer endpoint.",
    });
    expect(answerQuestionWithScope).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("rejects document summary mode when documentIds selects a different document", async () => {
    const summarizeDocument = vi.fn();
    const answerQuestionWithScope = vi.fn();
    const client = createSupabaseMock();
    mockRuntime(client, { summarizeDocument, answerQuestionWithScope });
    const { POST } = await import("../src/app/api/answer/stream/route");

    const response = await POST(
      authenticatedRequest("/api/answer/stream", {
        method: "POST",
        body: JSON.stringify({
          query: "Summarize this document for practical clinical use.",
          documentId,
          documentIds: [otherDocumentId],
          summaryMode: true,
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await payload(response)).toMatchObject({ code: "invalid_body" });
    expect(summarizeDocument).not.toHaveBeenCalled();
    expect(answerQuestionWithScope).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("rate limits streamed document summaries before provider work", async () => {
    const summarizeDocument = vi.fn(async () => ({
      answer: "Expensive streamed summary.",
      grounded: true,
      confidence: "high",
      citations: [],
      sources: [],
    }));
    const client = createSupabaseMock();
    client.rpc.mockImplementation(async (name: string) =>
      name === "consume_summary_rate_limits_atomic"
        ? {
            data: [
              rateLimitRow({
                bucket: "document_summarize",
                limited: true,
                limit_value: 12,
                remaining: 0,
              }),
            ],
            error: null,
          }
        : ok([]),
    );
    mockRuntime(client, { summarizeDocument });
    const { POST } = await import("../src/app/api/answer/stream/route");

    const response = await POST(
      authenticatedRequest("/api/answer/stream", {
        method: "POST",
        body: JSON.stringify({
          query: "Summarize this document for practical clinical use.",
          documentId,
          summaryMode: true,
        }),
      }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(await payload(response)).toMatchObject({
      error: "Too many document summary requests. Retry shortly.",
      details: { retryAfterSeconds: 60 },
    });
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith(
      "consume_summary_rate_limits_atomic",
      expect.objectContaining({ p_owner_id: userId, p_subject_key: null }),
    );
    expect(summarizeDocument).not.toHaveBeenCalled();
  });

  it("preserves the general answer rejection for atomic streamed-summary limits", async () => {
    const summarizeDocument = vi.fn();
    const client = createSupabaseMock();
    client.rpc.mockImplementation(async (name: string) =>
      name === "consume_summary_rate_limits_atomic"
        ? {
            data: [rateLimitRow({ bucket: "answer", limited: true, limit_value: 30, remaining: 0 })],
            error: null,
          }
        : ok([]),
    );
    mockRuntime(client, { summarizeDocument });
    const { POST } = await import("../src/app/api/answer/stream/route");

    const response = await POST(
      authenticatedRequest("/api/answer/stream", {
        method: "POST",
        body: JSON.stringify({
          query: "Summarize this document for practical clinical use.",
          documentId,
          summaryMode: true,
        }),
      }),
    );

    expect(response.status).toBe(429);
    expect(await payload(response)).toMatchObject({
      error: "Too many answer requests. Retry shortly.",
      details: { retryAfterSeconds: 60 },
    });
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(summarizeDocument).not.toHaveBeenCalled();
  });

  it("completes cached answers after safe cached progress and before final", async () => {
    const answerQuestionWithScope = vi.fn(async (args: { onProgress?: (event: unknown) => void | Promise<void> }) => {
      await args.onProgress?.({
        stage: "cached",
        message: "private-cache-message-marker",
        model: "private-cache-model-marker",
        reason: "private-cache-reason-marker",
      });
      return {
        answer: "Cached owned evidence.",
        grounded: true,
        confidence: "medium",
        citations: [],
        sources: [],
      };
    });
    const client = createSupabaseMock();
    mockRuntime(client, { answerQuestionWithScope });
    const { POST } = await import("../src/app/api/answer/stream/route");

    const response = await POST(
      authenticatedRequest("/api/answer/stream", {
        method: "POST",
        body: JSON.stringify({ query: "monitoring", documentId: otherDocumentId }),
      }),
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body.indexOf('"stage":"cached"')).toBeLessThan(body.indexOf('"stage":"complete"'));
    expect(body).toContain('"message":"Loading a recent cited answer."');
    expect(body).not.toContain("private-cache");
    expectSingleCompletionBeforeFinal(body);
    expect(ssePayload(body, "final")).toMatchObject({
      interactionId: expect.any(String),
      feedbackToken: expect.any(String),
    });
  });

  it("emits a structured SSE error when authenticated streaming answers are rate limited", async () => {
    const answerQuestionWithScope = vi.fn(async () => ({
      answer: "Owned evidence.",
      grounded: true,
      confidence: "medium",
      citations: [],
      sources: [],
    }));
    const client = createSupabaseMock();
    client.rpc.mockImplementation(async (name: string, args?: Record<string, unknown>) =>
      name === "consume_api_rate_limit" && args?.p_bucket === "answer"
        ? { data: [rateLimitRow({ limited: true, limit_value: 30, remaining: 0 })], error: null }
        : name === "consume_api_rate_limit"
          ? { data: [rateLimitRow()], error: null }
          : ok([]),
    );
    mockRuntime(client, { answerQuestionWithScope });

    const streamRoute = await import("../src/app/api/answer/stream/route");

    const response = await streamRoute.POST(
      authenticatedRequest("/api/answer/stream", {
        method: "POST",
        headers: { "x-real-ip": "203.0.113.11" },
        body: JSON.stringify({ query: "monitoring", documentId: otherDocumentId }),
      }),
    );
    const body = await response.text();

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(JSON.parse(body)).toMatchObject({
      error: "Too many answer requests. Retry shortly.",
      details: { retryAfterSeconds: 60 },
    });
    expect(answerQuestionWithScope).not.toHaveBeenCalled();
  });

  it("aborts streamed answer generation when the response body is cancelled", async () => {
    const answerQuestionWithScope = vi.fn(
      async ({ signal, onProgress }: { signal?: AbortSignal; onProgress?: (event: unknown) => void }) => {
        onProgress?.({
          stage: "ranking",
          resultCount: 1,
          selectedContextCount: 0,
          australianSourceCount: 0,
          waSourceCount: 0,
        });
        await new Promise<void>((resolve) => {
          signal?.addEventListener(
            "abort",
            () => {
              resolve();
            },
            { once: true },
          );
        });
        return {
          answer: "Owned evidence.",
          grounded: true,
          confidence: "medium",
          citations: [],
          sources: [],
        };
      },
    );
    const client = createSupabaseMock();
    mockRuntime(client, { answerQuestionWithScope });
    const { POST } = await import("../src/app/api/answer/stream/route");

    const response = await POST(
      authenticatedRequest("/api/answer/stream", {
        method: "POST",
        body: JSON.stringify({ query: "monitoring", documentId: otherDocumentId }),
      }),
    );
    const reader = response.body?.getReader();
    await reader?.read();
    await reader?.cancel();

    expect(response.status).toBe(200);
    expect(answerQuestionWithScope).toHaveBeenCalledTimes(1);
    const signal = answerQuestionWithScope.mock.calls.at(0)?.[0]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(true);
  });

  it("uses an anonymous in-memory limiter for managed local no-auth streaming answers", async () => {
    const answerQuestionWithScope = vi.fn(async () => ({
      answer: "Owned evidence.",
      grounded: true,
      confidence: "medium",
      citations: [],
      sources: [],
    }));
    const client = createSupabaseMock();
    client.auth.admin.listUsers.mockResolvedValueOnce({
      data: { users: [{ id: userId, email: "clinician@example.test" }], nextPage: 0 },
      error: null,
    });
    client.rpc.mockImplementation(async (name: string) =>
      name === "consume_api_rate_limit" ? fail("limiter table unavailable") : ok([]),
    );
    mockRuntime(client, { answerQuestionWithScope }, { localNoAuth: true, localOwnerEmail: "clinician@example.test" });
    const { POST } = await import("../src/app/api/answer/stream/route");

    const response = await POST(
      localPortRequest(4298, "/api/answer/stream", {
        method: "POST",
        body: JSON.stringify({ query: "monitoring", documentId: documentId }),
      }),
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toBeTruthy();
    expect(answerQuestionWithScope).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: undefined, allowGlobalSearch: true }),
    );
    expect(client.rpc).not.toHaveBeenCalledWith(
      "consume_api_rate_limit",
      expect.objectContaining({ p_owner_id: userId, p_bucket: "answer" }),
    );
  });

  it("does not stream internal PublicApiError details to clients", async () => {
    const answerQuestionWithScope = vi.fn(async () => {
      const { PublicApiError } = await import("../src/lib/http");
      throw new PublicApiError("Stream failed safely.", 503, {
        code: "stream_failed",
        causeMessage: "secret table public.private_data does not exist",
        sqlState: "42P01",
      });
    });
    const client = createSupabaseMock();
    mockRuntime(client, { answerQuestionWithScope });
    const { POST } = await import("../src/app/api/answer/stream/route");

    const response = await POST(
      authenticatedRequest("/api/answer/stream", {
        method: "POST",
        body: JSON.stringify({ query: "monitoring", documentId: otherDocumentId }),
      }),
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("Stream failed safely.");
    expect(body).toContain("stream_failed");
    expect(body).not.toContain("private_data");
    expect(body).not.toContain("42P01");
  });

  it.each([
    ["JSON", false],
    ["SSE", true],
  ] as const)("recursively projects nested answer metadata at the %s route boundary", async (_label, streaming) => {
    const unsafeMetadata = {
      source_title: "Current guideline",
      publisher: "WA Health",
      jurisdiction: "Australia/WA",
      version: null,
      publication_date: null,
      review_date: "2026-08-01",
      uploaded_at: null,
      indexed_at: null,
      uploaded_by: "private-uploader-id",
      content_hash: "a".repeat(64),
      document_status: "current",
      clinical_validation_status: "approved",
      clinical_validation_evidence: { reviewer_id: "private-reviewer-id" },
      extraction_quality: "good",
    };
    const answerQuestionWithScope = vi.fn(async () => ({
      answer: "Monitor renal function.",
      grounded: true,
      confidence: "high",
      citations: [
        {
          chunk_id: "chunk-safe-boundary",
          document_id: documentId,
          title: "Current guideline",
          file_name: "current.pdf",
          page_number: 1,
          chunk_index: 0,
          source_metadata: unsafeMetadata,
        },
      ],
      sources: [
        {
          id: "chunk-safe-boundary",
          document_id: documentId,
          title: "Current guideline",
          file_name: "current.pdf",
          page_number: 1,
          chunk_index: 0,
          section_heading: "Monitoring",
          content: "Monitor renal function.",
          image_ids: [],
          similarity: 0.9,
          source_metadata: unsafeMetadata,
          document_labels: [
            {
              id: "private-label-id",
              document_id: documentId,
              owner_id: "private-owner-id",
              label: "renal monitoring",
              label_type: "topic",
              source: "manual",
              confidence: 1,
              metadata: { reviewer_id: "private-label-reviewer-id" },
            },
          ],
          score_explanation: { finalScore: 0.9, evidence: { owner_id: "private-score-owner" } },
          images: [],
        },
      ],
    }));
    const client = createSupabaseMock();
    mockRuntime(client, { answerQuestionWithScope });
    const { POST } = streaming
      ? await import("../src/app/api/answer/stream/route")
      : await import("../src/app/api/answer/route");

    const response = await POST(
      authenticatedRequest(streaming ? "/api/answer/stream" : "/api/answer", {
        method: "POST",
        body: JSON.stringify({ query: "renal monitoring", documentId }),
      }),
    );
    const rawBody = await response.text();
    const answerPayload = streaming ? ssePayload(rawBody, "final") : (JSON.parse(rawBody) as Record<string, unknown>);
    const sources = answerPayload.sources as Array<Record<string, unknown>>;
    const citations = answerPayload.citations as Array<Record<string, unknown>>;

    expect(response.status).toBe(200);
    expect(sources[0]?.source_metadata).toMatchObject({
      publisher: "WA Health",
      jurisdiction: "Australia/WA",
      document_status: "current",
      clinical_validation_status: "approved",
      extraction_quality: "good",
    });
    expect(sources[0]?.document_labels).toEqual([
      { label: "renal monitoring", label_type: "topic", source: "manual", confidence: 1 },
    ]);
    expect(citations[0]?.source_metadata).toEqual(sources[0]?.source_metadata);
    expect(sources[0]).not.toHaveProperty("score_explanation");
    expect(rawBody).not.toMatch(
      /private-uploader-id|content_hash|private-reviewer-id|private-label-id|private-owner-id|private-score-owner/,
    );
  });

  it("refuses streamed answer final events backed by danger-class source governance warnings", async () => {
    const answerQuestionWithScope = vi.fn(async () => ({
      answer: "Use the old protocol.",
      grounded: true,
      confidence: "high",
      degradedMode: { active: true, reason: "provider_fallback" },
      citations: [{ chunk_id: "chunk-1", page_number: 1, quote: "old protocol", document_id: documentId }],
      smartPanel: { query: "monitoring" },
      smartApiPlan: { displayMode: "direct" },
      sources: [
        {
          id: "chunk-1",
          document_id: documentId,
          title: "Outdated guideline",
          file_name: "old.pdf",
          page_number: 1,
          chunk_index: 0,
          section_heading: null,
          content: "old protocol",
          image_ids: [],
          similarity: 0.9,
          source_metadata: {
            source_title: "Outdated guideline",
            publisher: "Local WA service",
            jurisdiction: "WA",
            version: null,
            publication_date: null,
            review_date: null,
            uploaded_at: null,
            indexed_at: null,
            uploaded_by: null,
            document_status: "outdated",
            clinical_validation_status: "approved",
            extraction_quality: "good",
          },
          images: [],
        },
      ],
    }));
    const client = createSupabaseMock();
    mockRuntime(client, { answerQuestionWithScope });
    const { POST } = await import("../src/app/api/answer/stream/route");

    const response = await POST(
      authenticatedRequest("/api/answer/stream", {
        method: "POST",
        body: JSON.stringify({ query: "monitoring", documentId }),
      }),
    );
    const responseBody = await response.text();
    const finalPayload = ssePayload(responseBody, "final");

    expect(response.status).toBe(200);
    expectSingleCompletionBeforeFinal(responseBody);
    expect(finalPayload.grounded).toBe(false);
    expect(finalPayload.confidence).toBe("unsupported");
    expect(finalPayload.citations).toEqual([]);
    expect(finalPayload.sources).toEqual([]);
    expect(finalPayload.smartPanel).toBeUndefined();
    expect(finalPayload.smartApiPlan).toBeUndefined();
    expect(finalPayload.fallbackReasonCode).toBe("source_governance_block");
    expect(finalPayload.degradedMode).toEqual({
      active: true,
      reason: "Available material did not meet the source-governance requirements.",
    });
    expect(String(finalPayload.answer)).toContain("cannot provide a clinical answer");
    expect(finalPayload.sourceGovernanceWarnings).toEqual([
      expect.objectContaining({ code: "outdated_source", severity: "danger" }),
    ]);
    expectFeedbackTokenBoundToAnswer(finalPayload);
  });

  it("refuses answer responses backed by danger-class source governance warnings", async () => {
    const answerQuestionWithScope = vi.fn(async () => ({
      answer: "Use the old protocol.",
      grounded: true,
      confidence: "high",
      degradedMode: { active: true, reason: "provider_fallback" },
      citations: [{ chunk_id: "chunk-1", page_number: 1, quote: "old protocol", document_id: documentId }],
      sources: [
        {
          id: "chunk-1",
          document_id: documentId,
          title: "Outdated guideline",
          file_name: "old.pdf",
          page_number: 1,
          chunk_index: 0,
          section_heading: null,
          content: "old protocol",
          image_ids: [],
          similarity: 0.9,
          source_metadata: {
            source_title: "Outdated guideline",
            publisher: "Local WA service",
            jurisdiction: "WA",
            version: null,
            publication_date: null,
            review_date: null,
            uploaded_at: null,
            indexed_at: null,
            uploaded_by: null,
            document_status: "outdated",
            clinical_validation_status: "approved",
            extraction_quality: "good",
          },
          images: [],
        },
      ],
    }));
    const client = createSupabaseMock();
    mockRuntime(client, { answerQuestionWithScope });
    const { POST } = await import("../src/app/api/answer/route");

    const response = await POST(
      authenticatedRequest("/api/answer", {
        method: "POST",
        body: JSON.stringify({ query: "monitoring", documentId }),
      }),
    );
    const body = await payload(response);

    expect(response.status).toBe(200);
    expect(body.grounded).toBe(false);
    expect(body.confidence).toBe("unsupported");
    expect(body.citations).toEqual([]);
    // The refused answer's sources/smartPanel/smartApiPlan must not leak through.
    expect(body.sources).toEqual([]);
    expect(body.smartPanel).toBeUndefined();
    expect(body.smartApiPlan).toBeUndefined();
    expect(body.fallbackReasonCode).toBe("source_governance_block");
    expect(body.degradedMode).toEqual({
      active: true,
      reason: "Available material did not meet the source-governance requirements.",
    });
    expect(String(body.answer)).toContain("cannot provide a clinical answer");
    expect(body.sourceGovernanceWarnings).toEqual([
      expect.objectContaining({ code: "outdated_source", severity: "danger" }),
    ]);
    expectFeedbackTokenBoundToAnswer(body);
  });

  it("rejects non-stream document summaries before RAG/provider work", async () => {
    const answerQuestionWithScope = vi.fn();
    const summarizeDocument = vi.fn();
    const client = createSupabaseMock();
    mockRuntime(client, { answerQuestionWithScope, summarizeDocument });
    const { POST } = await import("../src/app/api/answer/route");

    const response = await POST(
      authenticatedRequest("/api/answer", {
        method: "POST",
        body: JSON.stringify({
          query: "Summarize this document for practical clinical use.",
          documentId,
          summaryMode: true,
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(payload(response)).resolves.toMatchObject({
      error: "Document summaries require the streaming answer endpoint.",
      code: "summary_mode_stream_required",
    });
    expect(client.rpc).not.toHaveBeenCalled();
    expect(summarizeDocument).not.toHaveBeenCalled();
    expect(answerQuestionWithScope).not.toHaveBeenCalled();
  });

  it("rate limits document summarization before OpenAI work", async () => {
    const summarizeDocument = vi.fn(async () => ({ summary: "Expensive summary" }));
    const client = createSupabaseMock();
    client.rpc.mockImplementation(async (name: string, args?: Record<string, unknown>) =>
      name === "consume_api_rate_limit" && args?.p_bucket === "document_summarize"
        ? { data: [rateLimitRow({ limited: true, limit_value: 12, remaining: 0 })], error: null }
        : name === "consume_api_rate_limit"
          ? { data: [rateLimitRow()], error: null }
          : ok([]),
    );
    mockRuntime(client, { summarizeDocument });
    const { POST } = await import("../src/app/api/documents/[id]/summarize/route");

    const response = await POST(authenticatedRequest(`/api/documents/${documentId}/summarize`, { method: "POST" }), {
      params: Promise.resolve({ id: documentId }),
    });

    expect(response.status).toBe(429);
    expect(await payload(response)).toMatchObject({
      error: "Too many document summary requests. Retry shortly.",
      details: { kind: "rate_limit", retryAfterSeconds: 60 },
    });
    expect(summarizeDocument).not.toHaveBeenCalled();
  });

  it("rate limits single and bulk reindex before enrichment or queue work", async () => {
    const client = createSupabaseMock();
    client.rpc.mockImplementation(async (name: string, args?: Record<string, unknown>) =>
      name === "consume_api_rate_limit" && (args?.p_bucket === "document_reindex" || args?.p_bucket === "bulk_reindex")
        ? { data: [rateLimitRow({ limited: true, limit_value: 1, remaining: 0 })], error: null }
        : name === "consume_api_rate_limit"
          ? { data: [rateLimitRow()], error: null }
          : ok([]),
    );
    const upsertDocumentEnrichment = vi.fn();
    const upsertDocumentDeepMemory = vi.fn();
    mockRuntime(client, { invalidateRagCachesForOwner: vi.fn() });
    vi.doMock("@/lib/document-enrichment", () => ({ upsertDocumentEnrichment }));
    vi.doMock("@/lib/deep-memory", () => ({ upsertDocumentDeepMemory }));
    const singleRoute = await import("../src/app/api/documents/[id]/reindex/route");
    const bulkRoute = await import("../src/app/api/documents/bulk/reindex/route");

    const singleResponse = await singleRoute.POST(
      authenticatedRequest(`/api/documents/${documentId}/reindex`, {
        method: "POST",
        body: JSON.stringify({ mode: "enrichment" }),
      }),
      { params: Promise.resolve({ id: documentId }) },
    );
    const bulkResponse = await bulkRoute.POST(
      authenticatedRequest("/api/documents/bulk/reindex", {
        method: "POST",
        body: JSON.stringify({ documentIds: [documentId], mode: "enrichment" }),
      }),
    );

    expect(singleResponse.status).toBe(429);
    expect(bulkResponse.status).toBe(429);
    expect(upsertDocumentEnrichment).not.toHaveBeenCalled();
    expect(upsertDocumentDeepMemory).not.toHaveBeenCalled();
    expect(client.calls.some((call) => call.table === "documents")).toBe(false);
  });

  it("returns a generic not found response when summarizing an unowned document", async () => {
    const summarizeDocument = vi.fn(async () => {
      throw new Error("Document not found.");
    });
    const client = createSupabaseMock();
    mockRuntime(client, { summarizeDocument });
    const { POST } = await import("../src/app/api/documents/[id]/summarize/route");

    const response = await POST(
      authenticatedRequest(`/api/documents/${otherDocumentId}/summarize`, { method: "POST" }),
      {
        params: Promise.resolve({ id: otherDocumentId }),
      },
    );

    expect(response.status).toBe(404);
    expect(await payload(response)).toMatchObject({ error: "Document not found." });
    expect(summarizeDocument).toHaveBeenCalledWith(otherDocumentId, userId, {
      signal: expect.any(AbortSignal),
      observationContext: { interactionId: expect.any(String), rolloutMode: "legacy" },
    });
  });

  it("applies the shared danger-governance refusal to the legacy document summary endpoint", async () => {
    const summarizeDocument = vi.fn(async () => ({
      answer: "Use the old pathway.",
      grounded: true,
      confidence: "high",
      citations: [{ chunk_id: "summary-chunk", document_id: documentId, page_number: 1 }],
      smartPanel: { query: "summary" },
      smartApiPlan: { displayMode: "direct" },
      sources: [
        {
          id: "summary-chunk",
          document_id: documentId,
          title: "Outdated summary source",
          file_name: "outdated-summary.pdf",
          page_number: 1,
          chunk_index: 0,
          section_heading: "Summary",
          content: "Use the old pathway.",
          image_ids: [],
          images: [],
          similarity: 0.9,
          source_metadata: {
            source_title: "Outdated summary source",
            publisher: "WA Health",
            publisher_code: "WA_HEALTH",
            jurisdiction: "Australia/WA",
            version: null,
            publication_date: null,
            review_date: null,
            uploaded_at: null,
            indexed_at: null,
            uploaded_by: null,
            document_status: "outdated",
            clinical_validation_status: "approved",
            extraction_quality: "good",
          },
        },
      ],
    }));
    const client = createSupabaseMock();
    mockRuntime(client, { summarizeDocument });
    const { POST } = await import("../src/app/api/documents/[id]/summarize/route");

    const response = await POST(authenticatedRequest(`/api/documents/${documentId}/summarize`, { method: "POST" }), {
      params: Promise.resolve({ id: documentId }),
    });
    const body = await payload(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ grounded: false, confidence: "unsupported", citations: [], sources: [] });
    expect(body.smartPanel).toBeUndefined();
    expect(body.smartApiPlan).toBeUndefined();
    expect(body.sourceGovernanceWarnings).toEqual([
      expect.objectContaining({ code: "outdated_source", severity: "danger" }),
    ]);
    expect(body.interactionId).toMatch(/^[0-9a-f-]{36}$/i);
    expectFeedbackTokenBoundToAnswer(body);
  });

  it("passes owner scope into retrieval RPCs", async () => {
    const client = createSupabaseMock();
    mockRuntime(client);
    const embedTextWithTelemetry = vi.fn(async () => ({ embedding: [0.1, 0.2, 0.3], cacheHit: false }));
    vi.doMock("@/lib/openai", () => ({
      embedTextWithTelemetry,
      generateTextResponse: vi.fn(),
      generateStructuredTextResponse: vi.fn(),
      generateStructuredTextResult: vi.fn(),
    }));
    const { searchChunks } = await import("../src/lib/rag/rag");

    const results = await searchChunks({
      query: "monitoring",
      documentId: otherDocumentId,
      ownerId: userId,
    });

    expect(results).toEqual([]);
    expect(embedTextWithTelemetry).toHaveBeenCalled();
    expect(client.rpc).toHaveBeenCalledWith(
      "match_document_chunks_hybrid_v2",
      expect.objectContaining({
        owner_filter: userId,
        include_public: true,
        document_filters: [otherDocumentId],
      }),
    );
  });

  it("source-only mode skips embeddings and never calls the vector hybrid RPC", async () => {
    const client = createSupabaseMock();
    mockRuntime(client, undefined, { providerMode: "offline" });
    const embedTextWithTelemetry = vi.fn(async () => ({ embedding: [0.1, 0.2, 0.3], cacheHit: false }));
    vi.doMock("@/lib/openai", () => ({
      embedTextWithTelemetry,
      generateTextResponse: vi.fn(),
      generateStructuredTextResponse: vi.fn(),
      generateStructuredTextResult: vi.fn(),
    }));
    const { searchChunks } = await import("../src/lib/rag/rag");

    await searchChunks({ query: "monitoring", documentId: otherDocumentId, ownerId: userId });

    expect(embedTextWithTelemetry).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalledWith("match_document_chunks_hybrid", expect.anything());
  });

  it("uses the DB-backed document lookup RPC with owner scope", async () => {
    const client = createSupabaseMock();
    mockRuntime(client);
    const embedTextWithTelemetry = vi.fn(async () => ({ embedding: [0.1, 0.2, 0.3], cacheHit: false }));
    vi.doMock("@/lib/openai", () => ({
      embedTextWithTelemetry,
      generateTextResponse: vi.fn(),
      generateStructuredTextResponse: vi.fn(),
      generateStructuredTextResult: vi.fn(),
    }));
    const { searchChunks } = await import("../src/lib/rag/rag");

    await searchChunks({
      query: "Find the NOCC document",
      ownerId: userId,
    });

    expect(client.rpc).toHaveBeenCalledWith(
      "match_documents_for_query_v2",
      expect.objectContaining({
        owner_filter: userId,
        include_public: true,
      }),
    );
  });
});
