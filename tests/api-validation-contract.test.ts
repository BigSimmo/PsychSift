import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";

const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const documentId = "11111111-1111-4111-8111-111111111111";

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
    page_count: 5,
    chunk_count: 20,
    image_count: 0,
    error_message: null,
    metadata: {},
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function apiRouteFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return apiRouteFiles(path);
    return entry.name === "route.ts" ? [path] : [];
  });
}

type QueryError = {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
};
type QueryResult = { data: unknown; error: QueryError | null; count?: number | null };
type QueryFilter = { column: string; value: unknown };
type QueryInFilter = { column: string; values: unknown[] };
type QueryCall = {
  table: string;
  operation: "select" | "insert" | "update" | "delete";
  selected?: string;
  range?: { from: number; to: number };
  filters: QueryFilter[];
  inFilters: QueryInFilter[];
  orFilters: string[];
  limitCount?: number;
  maybeSingle: boolean;
  single: boolean;
  insertPayload?: unknown;
  updatePayload?: unknown;
};
type QueryResolver = (call: QueryCall) => QueryResult;

function ok(data: unknown, count?: number | null): QueryResult {
  return { data, error: null, count };
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

  in(column: string, values: unknown[]) {
    this.call.inFilters.push({ column, values });
    return this;
  }

  or(filter: string) {
    this.call.orFilters.push(filter);
    return this;
  }

  order() {
    return this;
  }

  range(from: number, to: number) {
    this.call.range = { from, to };
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

  maybeSingle() {
    this.call.maybeSingle = true;
    return this.resolve();
  }

  single() {
    this.call.single = true;
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

function createSupabaseMock(resolve: QueryResolver = () => ok([])) {
  const calls: QueryCall[] = [];
  const upload = vi.fn(async () => ({ data: { path: "uploaded" }, error: null }));
  const remove = vi.fn(async () => ({ data: [], error: null }));
  const createSignedUrl = vi.fn(async (path: string) => ({
    data: { signedUrl: `https://signed.local/${path}` },
    error: null,
  }));
  const storageFrom = vi.fn(() => ({ upload, remove, createSignedUrl }));
  const client = {
    calls,
    from: vi.fn((table: string) => {
      const call: QueryCall = {
        table,
        operation: "select",
        filters: [],
        inFilters: [],
        orFilters: [],
        maybeSingle: false,
        single: false,
      };
      calls.push(call);
      return new QueryBuilder(call, resolve);
    }),
    rpc: vi.fn(async (name: string) => {
      if (name === "consume_api_subject_rate_limit" || name === "consume_api_rate_limit") {
        return {
          data: [
            {
              limited: false,
              limit_value: 100,
              remaining: 99,
              retry_after_seconds: 60,
              reset_at: new Date(Date.now() + 60_000).toISOString(),
            },
          ],
          error: null,
        };
      }
      return ok([]);
    }),
    storage: { from: storageFrom },
    storageMocks: { upload, remove, createSignedUrl, storageFrom },
  };
  return client;
}

function mockRuntime(client: ReturnType<typeof createSupabaseMock>) {
  vi.resetModules();
  const requireAuthenticatedUser = vi.fn(async () => ({ id: userId }));
  const createAdminClient = vi.fn(() => client);
  vi.doMock("@/lib/env", () => ({
    env: {
      MAX_UPLOAD_MB: 150,
      SUPABASE_DOCUMENT_BUCKET: "clinical-documents",
      SUPABASE_IMAGE_BUCKET: "clinical-images",
      RAG_SEARCH_CACHE_TTL_MS: 0,
      RAG_SEARCH_CACHE_SIZE: 0,
      RAG_ANSWER_CACHE_TTL_MS: 0,
      RAG_ANSWER_CACHE_SIZE: 0,
      RAG_AWAIT_QUERY_LOGS: false,
      WORKER_STALE_AFTER_MINUTES: 10,
      WORKER_MAX_ATTEMPTS: 3,
    },
    isDemoMode: () => false,
    isLocalNoAuthMode: () => false,
    requireOpenAIEnv: () => undefined,
    requireServerEnv: () => undefined,
  }));
  vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient }));
  vi.doMock("@/lib/supabase/auth", () => ({
    AuthenticationError: class AuthenticationError extends Error {},
    requireAuthenticatedUser,
    getOptionalAuthenticatedUser: vi.fn(async (request: Request) => {
      const authorization = request.headers.get("authorization") ?? "";
      if (/^Bearer\s+\S+/i.test(authorization)) return { id: userId };
      const cookieHeader = request.headers.get("cookie") ?? "";
      if (cookieHeader.includes("sb-")) return { id: userId };
      return null;
    }),
    unauthorizedResponse: () =>
      new Response(JSON.stringify({ error: "Authentication required." }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
  }));
  vi.doMock("@/lib/rag/rag", () => ({
    invalidateRagCachesForDocumentMutation: vi.fn(),
    invalidateRagCachesForOwner: vi.fn(),
  }));
  vi.doMock("@/lib/audit", () => ({ writeAuditLog: vi.fn() }));
  return { createAdminClient, requireAuthenticatedUser };
}

function authenticatedRequest(path: string, init?: RequestInit) {
  return new Request(`http://localhost${path}`, {
    ...init,
    headers: {
      authorization: "Bearer valid-token",
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

describe("API validation contracts", () => {
  it("prevents direct public error envelopes so routes use the schema-validated helper", () => {
    const violations = apiRouteFiles(join(process.cwd(), "src/app/api")).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      const routePath = relative(process.cwd(), file).replaceAll("\\", "/");
      const fileViolations: string[] = [];
      const visit = (node: ts.Node) => {
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "json" &&
          ts.isIdentifier(node.expression.expression) &&
          ["NextResponse", "Response"].includes(node.expression.expression.text) &&
          node.arguments[0] &&
          ts.isObjectLiteralExpression(node.arguments[0])
        ) {
          const publicErrorKeys = node.arguments[0].properties.flatMap((property) => {
            if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) return [];
            const name = property.name;
            if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return [name.text];
            if (ts.isComputedPropertyName(name) && ts.isStringLiteral(name.expression)) return [name.expression.text];
            return [];
          });
          if (publicErrorKeys.includes("error")) {
            const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
            fileViolations.push(`${routePath}:${line}`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sourceFile);
      for (const pattern of [
        /\b[A-Za-z_$][\w$]*Response\s*\(\s*\{\s*(?:error|["']error["'])\s*:/g,
        /\bsend\s*\(\s*["']error["']\s*,\s*\{/g,
      ]) {
        for (const match of source.matchAll(pattern)) {
          const line = source.slice(0, match.index).split(/\r?\n/).length;
          fileViolations.push(`${routePath}:${line}`);
        }
      }
      return fileViolations;
    });

    expect(violations).toEqual([]);
  });

  it("keeps migrated model-index output on the schema-parsed boundary", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/model-index-extraction.ts"), "utf8");

    expect(source).toContain("generateParsedTextResult");
    expect(source).not.toContain("generateStructuredTextResult");
    expect(source).not.toMatch(/JSON\.parse\s*\(/);
  });

  it("keeps route-local request parsing out of the Phase 1 target files", () => {
    const targetRouteFiles = [
      "src/app/api/documents/route.ts",
      "src/app/api/documents/[id]/route.ts",
      "src/app/api/documents/[id]/search/route.ts",
      "src/app/api/documents/[id]/reindex/route.ts",
      "src/app/api/ingestion/quality/route.ts",
      "src/app/api/upload/route.ts",
      "src/app/api/jobs/route.ts",
      "src/app/api/ingestion/jobs/route.ts",
    ];
    const forbiddenPatterns = [
      /Number\.parseInt/,
      /\bparseInt\s*\(/,
      /new URL\(request\.url\)\.searchParams/,
      /searchParams\.get\s*\(/,
      /formData\.get\(["'](?:title|description)["']\)/,
    ];
    const violations = targetRouteFiles.flatMap((file) => {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      return forbiddenPatterns.filter((pattern) => pattern.test(source)).map((pattern) => `${file}: ${pattern.source}`);
    });

    expect(violations).toEqual([]);
  });

  it("clamps and defaults document list pagination through the route query schema", async () => {
    const client = createSupabaseMock(() => ok([], 0));
    mockRuntime(client);
    const { GET } = await import("../src/app/api/documents/route");

    const clampedResponse = await GET(authenticatedRequest("/api/documents?limit=999&offset=-20&includeMeta=false"));
    const clampedBody = await payload(clampedResponse);
    const defaultedResponse = await GET(
      authenticatedRequest("/api/documents?limit=not-a-number&offset=bad&includeMeta=false"),
    );
    const defaultedBody = await payload(defaultedResponse);

    expect(clampedResponse.status).toBe(200);
    expect(clampedBody.pagination).toMatchObject({ limit: 200, offset: 0 });
    expect(client.calls[0].range).toEqual({ from: 0, to: 199 });
    expect(defaultedResponse.status).toBe(200);
    expect(defaultedBody.pagination).toMatchObject({ limit: 100, offset: 0 });
    expect(client.calls[1].range).toEqual({ from: 0, to: 99 });
  });

  it("caps the document list offset at 10k so a deep-offset request cannot force a full scan", async () => {
    const client = createSupabaseMock(() => ok([], 0));
    mockRuntime(client);
    const { GET } = await import("../src/app/api/documents/route");

    const response = await GET(authenticatedRequest("/api/documents?limit=200&offset=5000000&includeMeta=false"));
    const body = await payload(response);

    expect(response.status).toBe(200);
    expect(body.pagination).toMatchObject({ limit: 200, offset: 10_000 });
    expect(client.calls[0].range).toEqual({ from: 10_000, to: 10_199 });
  });

  it("passes through a document list offset at or under the 10k cap unchanged", async () => {
    const client = createSupabaseMock(() => ok([], 0));
    mockRuntime(client);
    const { GET } = await import("../src/app/api/documents/route");

    const underCapResponse = await GET(authenticatedRequest("/api/documents?limit=50&offset=9999&includeMeta=false"));
    const underCapBody = await payload(underCapResponse);
    const atCapResponse = await GET(authenticatedRequest("/api/documents?limit=50&offset=10000&includeMeta=false"));
    const atCapBody = await payload(atCapResponse);

    expect(underCapResponse.status).toBe(200);
    expect(underCapBody.pagination).toMatchObject({ limit: 50, offset: 9999 });
    expect(client.calls[0].range).toEqual({ from: 9999, to: 10_048 });
    expect(atCapResponse.status).toBe(200);
    expect(atCapBody.pagination).toMatchObject({ limit: 50, offset: 10_000 });
    expect(client.calls[1].range).toEqual({ from: 10_000, to: 10_049 });
  });

  it("clamps a document list offset that is just past the 10k cap down to exactly 10k", async () => {
    const client = createSupabaseMock(() => ok([], 0));
    mockRuntime(client);
    const { GET } = await import("../src/app/api/documents/route");

    const response = await GET(authenticatedRequest("/api/documents?limit=50&offset=10001&includeMeta=false"));
    const body = await payload(response);

    expect(response.status).toBe(200);
    expect(body.pagination).toMatchObject({ limit: 50, offset: 10_000 });
    expect(client.calls[0].range).toEqual({ from: 10_000, to: 10_049 });
  });

  it.each([
    {
      table: "documents",
      malformedRow: { id: { sensitive: "patient-secret" }, owner_id: userId, status: "indexed" },
    },
    {
      table: "document_labels",
      malformedRow: { document_id: { sensitive: "patient-secret" }, label: "Clinical" },
    },
    {
      table: "document_summaries",
      malformedRow: { document_id: { sensitive: "patient-secret" }, summary: "Private summary" },
    },
  ])("rejects and redacts malformed $table rows from the document list", async ({ table, malformedRow }) => {
    const client = createSupabaseMock((call) => {
      if (call.table === table) return ok([malformedRow]);
      if (call.table === "documents") {
        return ok([{ id: documentId, owner_id: userId, status: "indexed", title: "Guideline" }], 1);
      }
      return ok([]);
    });
    mockRuntime(client);
    const { GET } = await import("../src/app/api/documents/route");

    const response = await GET(authenticatedRequest("/api/documents"));
    const body = await payload(response);

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: "Request failed.",
      message: "Request failed.",
      code: "internal_error",
    });
    expect(JSON.stringify(body)).not.toContain("patient-secret");
  });

  it("treats empty document-detail chunk as absent and clamps page/chunk windows", async () => {
    const client = createSupabaseMock((call) => {
      if (call.table === "documents" && call.maybeSingle) {
        return ok(documentDetailRow());
      }
      if (call.table === "document_summaries" && call.maybeSingle) return ok(null);
      return ok([]);
    });
    mockRuntime(client);
    const { GET } = await import("../src/app/api/documents/[id]/route");

    const response = await GET(
      authenticatedRequest(`/api/documents/${documentId}?chunk=&page=999&pageLimit=999&chunkLimit=999&chunkOffset=-20`),
      { params: Promise.resolve({ id: documentId }) },
    );
    const body = await payload(response);
    const chunkCalls = client.calls.filter((call) => call.table === "document_chunks");

    expect(response.status).toBe(200);
    expect(body.pageWindow).toMatchObject({ from: 1, to: 5, limit: 40 });
    expect(body.chunkWindow).toMatchObject({ offset: 0, limit: 80, selectedChunkId: null });
    expect(chunkCalls).toHaveLength(1);
    expect(chunkCalls[0].range).toEqual({ from: 0, to: 79 });
    expect(chunkCalls[0].filters).not.toContainEqual({ column: "id", value: "" });
  });

  it("rejects malformed document-detail chunk ids before querying the database", async () => {
    const client = createSupabaseMock();
    mockRuntime(client);
    const { GET } = await import("../src/app/api/documents/[id]/route");

    const response = await GET(authenticatedRequest(`/api/documents/${documentId}?chunk=not-a-chunk-uuid`), {
      params: Promise.resolve({ id: documentId }),
    });

    expect(response.status).toBe(400);
    expect(await payload(response)).toMatchObject({ error: "Invalid document detail query." });
    expect(client.from).not.toHaveBeenCalled();
  });

  it("returns an empty direct document search response for empty query values before auth or Supabase access", async () => {
    const client = createSupabaseMock();
    const runtime = mockRuntime(client);
    const { GET } = await import("../src/app/api/documents/[id]/search/route");

    const response = await GET(authenticatedRequest(`/api/documents/${documentId}/search?q=&limit=`), {
      params: Promise.resolve({ id: documentId }),
    });
    const body = await payload(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ query: "", results: [], pageHits: [], hitCount: 0 });
    expect(runtime.createAdminClient).not.toHaveBeenCalled();
    expect(runtime.requireAuthenticatedUser).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it("clamps ingestion quality limit through the route query schema", async () => {
    const client = createSupabaseMock((call) => (call.table === "documents" ? ok([]) : ok([])));
    mockRuntime(client);
    const { GET } = await import("../src/app/api/ingestion/quality/route");

    const response = await GET(authenticatedRequest("/api/ingestion/quality?limit=999"));
    const body = await payload(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({ items: [] });
    expect(client.calls[0]).toMatchObject({ table: "documents", limitCount: 200 });
  });

  it.each([
    {
      table: "documents",
      malformedRow: {
        id: { sensitive: "patient-secret" },
        title: "Guideline",
        file_name: "guideline.pdf",
        status: "indexed",
        page_count: 1,
        chunk_count: 1,
        image_count: 0,
        error_message: null,
        metadata: {},
        updated_at: null,
      },
    },
    {
      table: "document_index_quality",
      malformedRow: {
        document_id: { sensitive: "patient-secret" },
        quality_score: 0.8,
        extraction_quality: "good",
        metrics: {},
        issues: [],
        updated_at: null,
      },
    },
    {
      table: "ingestion_jobs",
      malformedRow: {
        id: "job-1",
        document_id: { sensitive: "patient-secret" },
        status: "completed",
        stage: null,
        error_message: null,
        updated_at: null,
      },
    },
    {
      table: "ingestion_job_stages",
      malformedRow: {
        id: "stage-1",
        document_id: { sensitive: "patient-secret" },
        job_id: null,
        stage_name: null,
        stage_status: null,
        error_message: null,
        metadata: {},
        artifact_counts: {},
        finished_at: null,
        started_at: null,
      },
    },
    {
      table: "document_pages",
      malformedRow: {
        document_id: { sensitive: "patient-secret" },
        page_number: 1,
        text: null,
        ocr_used: false,
        metadata: {},
      },
    },
    {
      table: "document_images",
      malformedRow: {
        document_id: { sensitive: "patient-secret" },
        page_number: 1,
        source_kind: null,
        searchable: false,
        metadata: {},
      },
    },
  ])("rejects and redacts malformed $table rows from ingestion quality", async ({ table, malformedRow }) => {
    const client = createSupabaseMock((call) => {
      if (call.table === table) return ok([malformedRow]);
      if (call.table === "documents") {
        return ok([
          {
            id: documentId,
            title: "Guideline",
            file_name: "guideline.pdf",
            status: "indexed",
            page_count: 1,
            chunk_count: 1,
            image_count: 0,
            error_message: null,
            metadata: {},
            updated_at: null,
          },
        ]);
      }
      return ok([]);
    });
    mockRuntime(client);
    const { GET } = await import("../src/app/api/ingestion/quality/route");

    const response = await GET(authenticatedRequest("/api/ingestion/quality"));
    const body = await payload(response);

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: "Request failed.",
      message: "Request failed.",
      code: "internal_error",
    });
    expect(JSON.stringify(body)).not.toContain("patient-secret");
  });

  it("rejects invalid ingestion jobs batchId without querying jobs", async () => {
    const client = createSupabaseMock();
    mockRuntime(client);
    const { GET } = await import("../src/app/api/ingestion/jobs/route");

    const response = await GET(authenticatedRequest("/api/ingestion/jobs?batchId=not-a-uuid"));
    const body = await payload(response);

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: "Invalid ingestion jobs query." });
    expect(client.from).not.toHaveBeenCalled();
  });

  it("accepts valid ingestion jobs batchId values and applies the batch filter", async () => {
    const batchId = "44444444-4444-4444-8444-444444444444";
    const client = createSupabaseMock(() => ok([], 0));
    mockRuntime(client);
    const { GET } = await import("../src/app/api/ingestion/jobs/route");

    const response = await GET(authenticatedRequest(`/api/ingestion/jobs?batchId=${batchId}`));

    expect(response.status).toBe(200);
    expect(client.calls[0].filters).toContainEqual({ column: "batch_id", value: batchId });
    expect(client.calls[1].filters).toContainEqual({ column: "batch_id", value: batchId });
  });

  it("treats empty ingestion jobs batchId as absent", async () => {
    const client = createSupabaseMock(() => ok([], 0));
    mockRuntime(client);
    const { GET } = await import("../src/app/api/ingestion/jobs/route");

    const response = await GET(authenticatedRequest("/api/ingestion/jobs?batchId="));

    expect(response.status).toBe(200);
    expect(client.calls[0].filters).not.toContainEqual({ column: "batch_id", value: "" });
    expect(client.calls[1].filters).not.toContainEqual({ column: "batch_id", value: "" });
  });

  it("returns pagination metadata for jobs feeds", async () => {
    const client = createSupabaseMock((call) => {
      if (call.table === "ingestion_jobs") return ok([{ id: "job-2", status: "pending" }], 5);
      return ok([]);
    });
    mockRuntime(client);
    const jobsRoute = await import("../src/app/api/jobs/route");
    const ingestionJobsRoute = await import("../src/app/api/ingestion/jobs/route");
    const batchesRoute = await import("../src/app/api/ingestion/batches/route");

    const jobsResponse = await jobsRoute.GET(authenticatedRequest("/api/jobs?limit=2&offset=1"));
    const ingestionJobsResponse = await ingestionJobsRoute.GET(
      authenticatedRequest("/api/ingestion/jobs?limit=2&offset=1"),
    );
    const batchesResponse = await batchesRoute.GET(authenticatedRequest("/api/ingestion/batches?limit=2&offset=1"));

    expect(jobsResponse.status).toBe(200);
    expect(await payload(jobsResponse)).toMatchObject({
      pagination: { limit: 2, offset: 1, total: 5, nextOffset: 2, hasMore: true },
    });
    expect(client.calls[0]).toMatchObject({ table: "ingestion_jobs", range: { from: 1, to: 2 } });

    expect(ingestionJobsResponse.status).toBe(200);
    expect(await payload(ingestionJobsResponse)).toMatchObject({
      pagination: { limit: 2, offset: 1, total: 5, nextOffset: 2, hasMore: true },
    });
    expect(client.calls[1]).toMatchObject({ table: "ingestion_jobs", range: { from: 1, to: 2 } });
    expect(client.calls[2]).toMatchObject({
      table: "ingestion_jobs",
      inFilters: [{ column: "status", values: ["pending", "processing"] }],
    });
    expect(client.calls[2].range).toBeUndefined();
    // #L15: the route now also runs a failed-jobs head count, same shape as
    // the active-jobs count above, so it lands one call later at index 3.
    expect(client.calls[3]).toMatchObject({
      table: "ingestion_jobs",
      filters: expect.arrayContaining([{ column: "status", value: "failed" }]),
    });
    expect(client.calls[3].range).toBeUndefined();

    expect(batchesResponse.status).toBe(200);
    expect(await payload(batchesResponse)).toMatchObject({
      pagination: { limit: 2, offset: 1, total: 0, nextOffset: 1, hasMore: false },
    });
    expect(client.calls[4]).toMatchObject({ table: "import_batches", range: { from: 1, to: 2 } });
  });

  it("keeps ingestion polling active when an active job is beyond the requested page", async () => {
    const client = createSupabaseMock((call) => {
      if (call.inFilters.some((filter) => filter.column === "status")) return ok(null, 1);
      return ok([{ id: "newer-completed-job", status: "completed" }], 101);
    });
    mockRuntime(client);
    const { GET } = await import("../src/app/api/ingestion/jobs/route");

    const response = await GET(authenticatedRequest("/api/ingestion/jobs?limit=1&offset=0"));
    const body = await payload(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      jobs: [{ id: "newer-completed-job", status: "completed" }],
      activeJobCount: 1,
      hasActiveJobs: true,
      pollAfterMs: 5_000,
      pagination: { limit: 1, offset: 0, total: 101, nextOffset: 1, hasMore: true },
    });
    expect(response.headers.get("x-indexing-active")).toBe("true");

    const activeCountCall = client.calls.find((call) => call.inFilters.some((filter) => filter.column === "status"));
    expect(activeCountCall).toMatchObject({
      table: "ingestion_jobs",
      filters: [{ column: "documents.owner_id", value: userId }],
      inFilters: [{ column: "status", values: ["pending", "processing"] }],
    });
    expect(activeCountCall?.range).toBeUndefined();
  });

  it.each([
    {
      path: "/api/jobs",
      loadRoute: () => import("../src/app/api/jobs/route"),
    },
    {
      path: "/api/ingestion/jobs",
      loadRoute: () => import("../src/app/api/ingestion/jobs/route"),
    },
    {
      path: "/api/ingestion/batches",
      loadRoute: () => import("../src/app/api/ingestion/batches/route"),
    },
  ])("rejects and redacts malformed status rows from $path", async ({ path, loadRoute }) => {
    const client = createSupabaseMock(() => ok([{ status: { sensitive: "patient-secret" } }]));
    mockRuntime(client);
    const { GET } = await loadRoute();

    const response = await GET(authenticatedRequest(path));
    const body = await payload(response);

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: "Request failed.",
      message: "Request failed.",
      code: "internal_error",
    });
    expect(JSON.stringify(body)).not.toContain("patient-secret");
  });

  it("validates UUID route params for retry, summarize, and labels endpoints", async () => {
    const client = createSupabaseMock();
    mockRuntime(client);
    const retryRoute = await import("../src/app/api/ingestion/jobs/[id]/retry/route");
    const summarizeRoute = await import("../src/app/api/documents/[id]/summarize/route");
    const labelsRoute = await import("../src/app/api/documents/[id]/labels/route");

    const retryResponse = await retryRoute.POST(
      authenticatedRequest("/api/ingestion/jobs/not-a-uuid/retry", { method: "POST" }),
      {
        params: Promise.resolve({ id: "not-a-uuid" }),
      },
    );
    const summarizeResponse = await summarizeRoute.POST(
      authenticatedRequest("/api/documents/not-a-uuid/summarize", { method: "POST" }),
      { params: Promise.resolve({ id: "not-a-uuid" }) },
    );
    const labelsResponse = await labelsRoute.POST(
      authenticatedRequest("/api/documents/not-a-uuid/labels", {
        method: "POST",
        body: JSON.stringify({ label: "Lithium", label_type: "medication" }),
      }),
      { params: Promise.resolve({ id: "not-a-uuid" }) },
    );

    expect(retryResponse.status).toBe(400);
    expect(await payload(retryResponse)).toMatchObject({ error: "Invalid ingestion job id." });
    expect(summarizeResponse.status).toBe(400);
    expect(await payload(summarizeResponse)).toMatchObject({ error: "Invalid document id." });
    expect(labelsResponse.status).toBe(400);
    expect(await payload(labelsResponse)).toMatchObject({ error: "Invalid document id." });
    expect(client.from).not.toHaveBeenCalled();
  });

  it("returns 5xx envelopes for internal failures in upload, retry, reindex, and summarize routes", async () => {
    const availableRateLimit = {
      data: [
        {
          limited: false,
          limit_value: 100,
          remaining: 99,
          retry_after_seconds: 60,
          reset_at: new Date(Date.now() + 60_000).toISOString(),
        },
      ],
      error: null,
    };
    const uploadClient = createSupabaseMock((call) => {
      if (call.table === "documents" && call.operation === "select" && call.maybeSingle) return ok(null);
      if (call.table === "documents" && call.operation === "insert" && call.single) {
        return { data: null, error: { message: "insert failed" } };
      }
      return ok([]);
    });
    mockRuntime(uploadClient);
    const uploadRoute = await import("../src/app/api/upload/route");
    const formData = new FormData();
    formData.set("file", new File(["%PDF-1.7\n%%EOF"], "guideline.pdf", { type: "application/pdf" }));
    const uploadResponse = await uploadRoute.POST(
      authenticatedRequest("/api/upload", { method: "POST", body: formData }),
    );
    expect(uploadResponse.status).toBe(500);
    expect(await payload(uploadResponse)).toMatchObject({ error: "Request failed." });

    const retryClient = createSupabaseMock((call) => {
      if (call.table === "ingestion_jobs" && call.operation === "select" && call.maybeSingle) {
        return { data: null, error: { message: "query failed" } };
      }
      return ok([]);
    });
    mockRuntime(retryClient);
    const retryRoute = await import("../src/app/api/ingestion/jobs/[id]/retry/route");
    const retryResponse = await retryRoute.POST(
      authenticatedRequest(`/api/ingestion/jobs/${documentId}/retry`, { method: "POST" }),
      {
        params: Promise.resolve({ id: documentId }),
      },
    );
    expect(retryResponse.status).toBe(500);
    expect(await payload(retryResponse)).toMatchObject({ error: "Request failed." });

    const reindexClient = createSupabaseMock((call) => {
      if (call.table === "documents" && call.operation === "select" && call.maybeSingle) {
        return { data: null, error: { message: "query failed" } };
      }
      return ok([]);
    });
    reindexClient.rpc.mockImplementation(async () => availableRateLimit);
    mockRuntime(reindexClient);
    const reindexRoute = await import("../src/app/api/documents/[id]/reindex/route");
    const reindexResponse = await reindexRoute.POST(
      authenticatedRequest(`/api/documents/${documentId}/reindex`, {
        method: "POST",
        body: JSON.stringify({ mode: "full" }),
      }),
      { params: Promise.resolve({ id: documentId }) },
    );
    expect(reindexResponse.status).toBe(500);
    expect(await payload(reindexResponse)).toMatchObject({ error: "Request failed." });

    const summarizeClient = createSupabaseMock();
    summarizeClient.rpc.mockImplementation(async () => availableRateLimit);
    const summarizeDocument = vi.fn(async () => {
      throw new Error("Upstream unavailable");
    });
    mockRuntime(summarizeClient);
    vi.doMock("@/lib/rag/rag", () => ({ summarizeDocument }));
    const summarizeRoute = await import("../src/app/api/documents/[id]/summarize/route");
    const summarizeResponse = await summarizeRoute.POST(
      authenticatedRequest(`/api/documents/${documentId}/summarize`, { method: "POST" }),
      { params: Promise.resolve({ id: documentId }) },
    );
    expect(summarizeResponse.status).toBe(500);
    expect(await payload(summarizeResponse)).toMatchObject({ error: "Request failed." });
  });

  it("rejects invalid upload metadata before storage upload or database writes", async () => {
    const client = createSupabaseMock();
    mockRuntime(client);
    const { POST } = await import("../src/app/api/upload/route");
    const formData = new FormData();
    formData.set("file", new File(["%PDF-1.7\n%%EOF"], "guideline.pdf", { type: "application/pdf" }));
    formData.set("title", "x".repeat(181));

    const response = await POST(authenticatedRequest("/api/upload", { method: "POST", body: formData }));
    const body = await payload(response);

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: "Upload metadata is invalid." });
    expect(client.storageMocks.upload).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it("rejects non-string multipart metadata fields before storage upload or database writes", async () => {
    const client = createSupabaseMock();
    mockRuntime(client);
    const { POST } = await import("../src/app/api/upload/route");
    const formData = new FormData();
    formData.set("file", new File(["%PDF-1.7\n%%EOF"], "guideline.pdf", { type: "application/pdf" }));
    formData.set("title", new File(["Guideline"], "title.txt", { type: "text/plain" }));

    const response = await POST(authenticatedRequest("/api/upload", { method: "POST", body: formData }));
    const body = await payload(response);

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: "Upload metadata is invalid." });
    expect(client.storageMocks.upload).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it("rejects non-form upload content before storage upload or database writes", async () => {
    const client = createSupabaseMock();
    mockRuntime(client);
    const { POST } = await import("../src/app/api/upload/route");

    const response = await POST(
      authenticatedRequest("/api/upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ file: "nope" }),
      }),
    );
    const body = await payload(response);

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: "Invalid upload form data." });
    expect(client.storageMocks.upload).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it("rejects malformed multipart upload bodies before storage upload or database writes", async () => {
    const client = createSupabaseMock();
    mockRuntime(client);
    const { POST } = await import("../src/app/api/upload/route");

    const response = await POST(
      authenticatedRequest("/api/upload", {
        method: "POST",
        headers: { "content-type": "multipart/form-data; boundary=broken" },
        body: '--broken\r\nContent-Disposition: form-data; name="file"; filename="guideline.pdf"\r\n\r\n%PDF-1.7',
      }),
    );
    const body = await payload(response);

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: "Invalid upload form data." });
    expect(client.storageMocks.upload).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it("accepts valid document rename JSON through the shared body parser", async () => {
    const client = createSupabaseMock((call) => {
      if (call.table === "documents" && call.operation === "select" && call.maybeSingle) {
        return ok({
          id: documentId,
          owner_id: userId,
          title: "Old title",
          file_name: "old.pdf",
          storage_path: `${userId}/documents/${documentId}/old.pdf`,
          content_hash: "hash",
          metadata: {},
        });
      }
      if (call.table === "documents" && call.operation === "update") {
        return ok({ id: documentId, title: (call.updatePayload as { title: string }).title });
      }
      return ok([]);
    });
    mockRuntime(client);
    const { PATCH } = await import("../src/app/api/documents/[id]/route");

    const response = await PATCH(
      authenticatedRequest(`/api/documents/${documentId}`, {
        method: "PATCH",
        body: JSON.stringify({ title: "New title" }),
      }),
      { params: Promise.resolve({ id: documentId }) },
    );
    const body = await payload(response);
    const updateCall = client.calls.find((call) => call.table === "documents" && call.operation === "update");

    expect(response.status).toBe(200);
    expect(body.document).toMatchObject({ id: documentId, title: "New title" });
    expect(updateCall?.updatePayload).toMatchObject({ title: "New title" });
  });

  it("rejects malformed document rename JSON before database access", async () => {
    const client = createSupabaseMock();
    mockRuntime(client);
    const { PATCH } = await import("../src/app/api/documents/[id]/route");

    const response = await PATCH(
      authenticatedRequest(`/api/documents/${documentId}`, {
        method: "PATCH",
        body: "{",
      }),
      { params: Promise.resolve({ id: documentId }) },
    );
    const body = await payload(response);

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: "Enter a document title between 1 and 180 characters." });
    expect(client.from).not.toHaveBeenCalled();
  });

  it("rejects missing and unknown document rename fields before database access", async () => {
    const client = createSupabaseMock();
    mockRuntime(client);
    const { PATCH } = await import("../src/app/api/documents/[id]/route");

    const missingResponse = await PATCH(
      authenticatedRequest(`/api/documents/${documentId}`, {
        method: "PATCH",
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: documentId }) },
    );
    const unknownResponse = await PATCH(
      authenticatedRequest(`/api/documents/${documentId}`, {
        method: "PATCH",
        body: JSON.stringify({ title: "New title", unexpected: true }),
      }),
      { params: Promise.resolve({ id: documentId }) },
    );

    expect(missingResponse.status).toBe(400);
    expect(await payload(missingResponse)).toMatchObject({
      error: "Enter a document title between 1 and 180 characters.",
    });
    expect(unknownResponse.status).toBe(400);
    expect(await payload(unknownResponse)).toMatchObject({
      error: "Enter a document title between 1 and 180 characters.",
    });
    expect(client.from).not.toHaveBeenCalled();
  });

  it("rejects invalid direct document search route params before Supabase access", async () => {
    const client = createSupabaseMock();
    mockRuntime(client);
    const { GET } = await import("../src/app/api/documents/[id]/search/route");

    const response = await GET(authenticatedRequest("/api/documents/not-a-uuid/search?q=lithium"), {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });
    const body = await payload(response);

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: "Invalid document id." });
    expect(client.from).not.toHaveBeenCalled();
  });
});
