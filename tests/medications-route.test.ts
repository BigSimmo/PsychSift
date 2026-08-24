import { afterEach, describe, expect, it, vi } from "vitest";

const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const token = "valid-token";
const publicFixtureCacheControl = "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";

function expectPublicFixtureCache(response: Response) {
  expect(response.headers.get("cache-control")).toBe(publicFixtureCacheControl);
  expect(response.headers.get("vary")).toBe("Cookie, Authorization");
}

function expectPrivateCache(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store");
}
const recordId = "11111111-1111-4111-8111-111111111111";

type QueryError = { message: string };
type QueryResult = { data: unknown; error: QueryError | null; count?: number | null };
type QueryFilter = { column: string; value: unknown };
type QueryCall = {
  table: string;
  filters: QueryFilter[];
  inFilters: Array<{ column: string; values: unknown[] }>;
  maybeSingle: boolean;
  head?: boolean;
  count?: string;
  upsert?: boolean;
  upsertRows?: unknown[];
};
type QueryResolver = (call: QueryCall) => QueryResult;

function ok(data: unknown): QueryResult {
  return { data, error: null };
}

function medicationRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: recordId,
    owner_id: userId,
    slug: "acamprosate",
    name: "Acamprosate",
    class: "Addiction medicine",
    subclass: "",
    category: "",
    accent: "#0f766e",
    tag: "",
    schedule: "",
    stats: [],
    sections: [],
    quick: [],
    source_status: "current",
    validation_status: "locally_reviewed",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

class QueryBuilder implements PromiseLike<QueryResult> {
  constructor(
    private readonly call: QueryCall,
    private readonly resolver: QueryResolver,
  ) {}

  select(_columns?: string, options?: { count?: string; head?: boolean }) {
    if (options?.head) this.call.head = true;
    if (options?.count) this.call.count = options.count;
    return this;
  }

  eq(column: string, value: unknown) {
    this.call.filters.push({ column, value });
    return this;
  }

  in(column: string, values: unknown[]) {
    this.call.inFilters.push({ column, values });
    return this;
  }

  order() {
    return this;
  }

  limit() {
    return this;
  }

  upsert(rows: unknown) {
    this.call.upsert = true;
    this.call.upsertRows = Array.isArray(rows) ? rows : [rows];
    return this;
  }

  maybeSingle() {
    this.call.maybeSingle = true;
    return Promise.resolve(this.resolver(this.call));
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.resolver(this.call)).then(onfulfilled, onrejected);
  }
}

function createSupabaseMock(resolve: QueryResolver = () => ok([]), options: { limited?: boolean } = {}) {
  const calls: QueryCall[] = [];
  const getUser = vi.fn(async (receivedToken?: string) =>
    receivedToken === token
      ? { data: { user: { id: userId } }, error: null }
      : { data: { user: null }, error: { message: "Invalid token" } },
  );
  const rpc = vi.fn(async (name: string) =>
    name === "consume_api_rate_limit" || name === "consume_api_subject_rate_limit"
      ? {
          data: [
            {
              limited: Boolean(options.limited),
              limit_value: 120,
              remaining: options.limited ? 0 : 119,
              retry_after_seconds: 60,
              reset_at: new Date(Date.now() + 60_000).toISOString(),
            },
          ],
          error: null,
        }
      : ok([]),
  );
  return {
    calls,
    auth: { getUser },
    rpc,
    from: vi.fn((table: string) => {
      const call: QueryCall = { table, filters: [], inFilters: [], maybeSingle: false };
      calls.push(call);
      return new QueryBuilder(call, resolve);
    }),
  };
}

function mockRuntime(
  client: ReturnType<typeof createSupabaseMock>,
  options: { demoMode?: boolean; registryEmbeddingError?: Error } = {},
) {
  vi.resetModules();
  vi.doUnmock("@/lib/supabase/auth");
  vi.doUnmock("@/lib/supabase/admin");
  vi.doMock("@/lib/env", () => ({
    env: {},
    isDemoMode: () => Boolean(options.demoMode),
    isLocalNoAuthMode: () => false,
    requireOpenAIEnv: () => undefined,
    requireServerEnv: () => undefined,
  }));
  vi.doMock("@/lib/registry-corpus", () => ({
    registryCorpusEmbeddingEnabled: () => Boolean(options.registryEmbeddingError),
    bestEffortSyncMedicationRows: vi.fn(async () => {
      if (options.registryEmbeddingError) {
        console.error("[medications] registry corpus sync failed", {
          name: options.registryEmbeddingError.name,
          message: options.registryEmbeddingError.message,
        });
        return { documentCount: 0, chunkCount: 0, skipped: true, reason: "failed" };
      }
      return { documentCount: 0, chunkCount: 0 };
    }),
  }));
  vi.doMock("@/lib/supabase/admin", () => ({
    createAdminClient: () => client,
  }));
}

function request(path: string, init?: RequestInit) {
  return new Request(`http://localhost${path}`, init);
}

function authedRequest(path: string) {
  return request(path, { headers: { Authorization: `Bearer ${token}` } });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("medications API", () => {
  it("serves mock records in demo mode without touching Supabase", async () => {
    const client = createSupabaseMock();
    mockRuntime(client, { demoMode: true });
    const { GET } = await import("../src/app/api/medications/route");

    const response = await GET(request("/api/medications"));
    const payload = (await response.json()) as { records: Array<{ slug: string }>; demoMode?: boolean };

    expect(response.status).toBe(200);
    expectPublicFixtureCache(response);
    expect(payload.demoMode).toBe(true);
    expect(payload.records.some((record) => record.slug === "acamprosate")).toBe(true);
    expect(client.from).not.toHaveBeenCalled();
    expect(client.auth.getUser).not.toHaveBeenCalled();
  });

  it("serves an identity-only slim catalog for fields=index", async () => {
    const client = createSupabaseMock();
    mockRuntime(client, { demoMode: true });
    const { GET } = await import("../src/app/api/medications/route");

    const response = await GET(request("/api/medications?fields=index"));
    const payload = (await response.json()) as {
      records: Array<{
        slug: string;
        name: string;
        stats: unknown[];
        sections: Array<{ type: string; rows: Array<{ key: string }> }>;
        quick: unknown[];
      }>;
    };

    expect(response.status).toBe(200);
    const acamprosate = payload.records.find((record) => record.slug === "acamprosate");
    expect(acamprosate?.name).toBe("Acamprosate");
    expect(
      payload.records.every(
        (record) =>
          record.stats.length === 0 &&
          record.quick.length === 0 &&
          record.sections.every(
            (section) => section.type === "form" && section.rows.every((row) => /brand\s*names?/i.test(row.key)),
          ),
      ),
    ).toBe(true);
    expect(acamprosate?.sections[0]?.rows[0]?.key).toMatch(/brand\s*names?/i);
  });

  it("ranks brand names and typo corrections on the list endpoint", async () => {
    const client = createSupabaseMock();
    mockRuntime(client, { demoMode: true });
    const { GET } = await import("../src/app/api/medications/route");

    const brandResponse = await GET(request("/api/medications?q=campral&limit=5"));
    const brandPayload = (await brandResponse.json()) as {
      matches?: Array<{ medication: { slug: string }; reasons: string[] }>;
    };
    expect(brandResponse.status).toBe(200);
    expect(brandPayload.matches?.[0]?.medication.slug).toBe("acamprosate");
    expect(brandPayload.matches?.[0]?.reasons).toContain("brand");

    const typoResponse = await GET(request("/api/medications?q=sertaline&limit=5"));
    const typoPayload = (await typoResponse.json()) as {
      matches?: Array<{ medication: { slug: string } }>;
      interpretation?: { correctedQuery?: string; corrections?: Array<{ from: string; to: string }> };
    };
    expect(typoResponse.status).toBe(200);
    expect(typoPayload.matches?.[0]?.medication.slug).toBe("sertraline");
    expect(typoPayload.interpretation?.correctedQuery).toBe("sertraline");
    expect(typoPayload.interpretation?.corrections).toContainEqual({ from: "sertaline", to: "sertraline" });
  });

  it("projects matched medications to the index shape when fields=index&q is set", async () => {
    const client = createSupabaseMock();
    mockRuntime(client, { demoMode: true });
    const { GET } = await import("../src/app/api/medications/route");

    const response = await GET(request("/api/medications?fields=index&q=campral&limit=5"));
    const payload = (await response.json()) as {
      matches?: Array<{
        medication: {
          slug: string;
          stats: unknown[];
          quick: unknown[];
          sections: Array<{ type: string; rows: Array<{ key: string }> }>;
        };
      }>;
    };

    expect(response.status).toBe(200);
    expect(payload.matches?.length).toBeGreaterThan(0);
    expect(
      payload.matches?.every(
        (match) =>
          match.medication.stats.length === 0 &&
          match.medication.quick.length === 0 &&
          match.medication.sections.every(
            (section) => section.type === "form" && section.rows.every((row) => /brand\s*names?/i.test(row.key)),
          ),
      ),
    ).toBe(true);
    expect(payload.matches?.[0]?.medication.slug).toBe("acamprosate");
  });

  it("serves curated public records for unauthenticated list requests outside demo mode", async () => {
    const client = createSupabaseMock();
    mockRuntime(client);
    const { GET } = await import("../src/app/api/medications/route");

    const response = await GET(request("/api/medications?q=acamprosate"));
    const payload = (await response.json()) as {
      records: Array<{ slug: string }>;
      matches?: Array<{ medication: { slug: string } }>;
      publicAccess?: boolean;
    };

    expect(response.status).toBe(200);
    expectPublicFixtureCache(response);
    expect(payload.publicAccess).toBe(true);
    expect(payload.records.some((record) => record.slug === "acamprosate")).toBe(true);
    expect(payload.matches?.[0]?.medication.slug).toBe("acamprosate");
    // The catalog is served from seed data (no table read) and no auth round-trip is needed,
    // but anonymous list requests must still pass the registry limiter (M4/C1).
    expect(client.from).not.toHaveBeenCalled();
    expect(client.rpc).toHaveBeenCalled();
    expect(client.auth.getUser).not.toHaveBeenCalled();
  });

  it("rate-limits anonymous list requests (429) without falling back to unlimited access", async () => {
    const client = createSupabaseMock(() => ok([]), { limited: true });
    mockRuntime(client);
    const { GET } = await import("../src/app/api/medications/route");

    const response = await GET(request("/api/medications"));

    expect(response.status).toBe(429);
    expect(client.from).not.toHaveBeenCalled();
    expect(client.auth.getUser).not.toHaveBeenCalled();
  });

  it("excludes authenticated owner rows from the canonical public medication result", async () => {
    const client = createSupabaseMock((call) => (call.table === "medication_records" ? ok([medicationRow()]) : ok([])));
    mockRuntime(client);
    const { GET } = await import("../src/app/api/medications/route");

    const response = await GET(authedRequest("/api/medications?q=acamprosate"));
    const payload = (await response.json()) as {
      records: Array<{ slug: string }>;
      matches?: Array<{ medication: { slug: string } }>;
    };

    expect(response.status).toBe(200);
    expectPrivateCache(response);
    expect(payload.records[0]?.slug).toBe("acamprosate");
    expect(payload.matches?.[0]?.medication.slug).toBe("acamprosate");
    expect(client.calls.some((call) => call.table === "medication_records")).toBe(false);
  });

  it("serves curated public detail for unauthenticated slug requests", async () => {
    const client = createSupabaseMock();
    mockRuntime(client);
    const { GET } = await import("../src/app/api/medications/[slug]/route");

    const response = await GET(request("/api/medications/acamprosate"), {
      params: Promise.resolve({ slug: "acamprosate" }),
    });
    const payload = (await response.json()) as {
      record: { slug: string; name: string };
      publicAccess?: boolean;
    };

    expect(response.status).toBe(200);
    expectPublicFixtureCache(response);
    expect(payload.publicAccess).toBe(true);
    expect(payload.record.slug).toBe("acamprosate");
    expect(payload.record.name).toBe("Acamprosate");
    // The seed detail is served without a table read, but anonymous detail requests must still
    // pass the registry limiter (finding C — no anonymous bypass).
    expect(client.from).not.toHaveBeenCalled();
    expect(client.rpc).toHaveBeenCalled();
  });

  it("rate-limits anonymous detail requests (429) instead of skipping the limiter", async () => {
    const client = createSupabaseMock(() => ok([]), { limited: true });
    mockRuntime(client);
    const { GET } = await import("../src/app/api/medications/[slug]/route");

    const response = await GET(request("/api/medications/acamprosate"), {
      params: Promise.resolve({ slug: "acamprosate" }),
    });

    expect(response.status).toBe(429);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("serves canonical medication detail without invoking the legacy embedding hook", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let stored: Array<Record<string, unknown>> = [];
    const client = createSupabaseMock((call) => {
      if (call.table !== "medication_records") return ok([]);
      if (call.head) return { data: null, error: null, count: stored.length };
      if (call.upsert) {
        stored = (call.upsertRows ?? []) as Array<Record<string, unknown>>;
        return ok(stored);
      }
      if (call.maybeSingle) {
        return ok(stored.find((row) => row.slug === "acamprosate") ?? null);
      }
      return ok(stored);
    });
    mockRuntime(client, { registryEmbeddingError: new Error("embedding unavailable") });
    const { GET } = await import("../src/app/api/medications/[slug]/route");

    const response = await GET(authedRequest("/api/medications/acamprosate"), {
      params: Promise.resolve({ slug: "acamprosate" }),
    });
    const payload = (await response.json()) as { record: { slug: string; name: string } };

    expect(response.status).toBe(200);
    expect(payload.record.slug).toBe("acamprosate");
    expect(payload.record.name).toBe("Acamprosate");
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown medication slug without invoking the legacy embedding hook", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let stored: Array<Record<string, unknown>> = [];
    const client = createSupabaseMock((call) => {
      if (call.table !== "medication_records") return ok([]);
      if (call.head) return { data: null, error: null, count: stored.length };
      if (call.upsert) {
        stored = (call.upsertRows ?? []) as Array<Record<string, unknown>>;
        return ok(stored);
      }
      if (call.maybeSingle) return ok(stored.find((row) => row.slug === "unknown-medication") ?? null);
      return ok(stored);
    });
    mockRuntime(client, { registryEmbeddingError: new Error("embedding unavailable") });
    const { GET } = await import("../src/app/api/medications/[slug]/route");

    const response = await GET(authedRequest("/api/medications/unknown-medication"), {
      params: Promise.resolve({ slug: "unknown-medication" }),
    });

    expect(response.status).toBe(404);
    expect(consoleError).not.toHaveBeenCalled();
  });
});
