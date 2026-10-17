import { afterEach, describe, expect, it, vi } from "vitest";
import { gunzipSync } from "node:zlib";

const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const token = "valid-token";
const publicFixtureCacheControl = "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";

function expectPublicFixtureCache(response: Response, options: { variesByEncoding?: boolean } = {}) {
  expect(response.headers.get("cache-control")).toBe(publicFixtureCacheControl);
  expect(response.headers.get("vary")).toBe(
    options.variesByEncoding ? "Accept-Encoding, Cookie, Authorization" : "Cookie, Authorization",
  );
}

function expectPrivateCache(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("vary")).toContain("Cookie");
  expect(response.headers.get("vary")).toContain("Authorization");
}
const recordId = "11111111-1111-4111-8111-111111111111";

type QueryError = { message: string };
type QueryResult = { data: unknown; error: QueryError | null };
type QueryFilter = { column: string; value: unknown };
type QueryCall = {
  table: string;
  filters: QueryFilter[];
  inFilters: Array<{ column: string; values: unknown[] }>;
  maybeSingle: boolean;
  upsert?: boolean;
  upsertRows?: unknown[];
};
type QueryResolver = (call: QueryCall) => QueryResult;

function ok(data: unknown): QueryResult {
  return { data, error: null };
}

function registryRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: recordId,
    owner_id: userId,
    kind: "service",
    slug: "13yarn",
    title: "13YARN",
    subtitle: "Crisis support line",
    route: null,
    eligibility: null,
    cost: null,
    referral: null,
    location: null,
    best_use: null,
    catalogue_label: null,
    navigator_query: null,
    tags: ["crisis"],
    catchments: [],
    status_chips: [],
    primary_contact: { label: "Phone", value: "13 92 76", kind: "phone" },
    contacts: [],
    summary_cards: [],
    referral_info: [],
    criteria: [],
    verification: { locallyVerified: true },
    source: { status: "Source checked" },
    source_status: "current",
    validation_status: "locally_reviewed",
    last_reviewed_at: null,
    review_due_at: null,
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

  select() {
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

function createSupabaseMock(
  resolve: QueryResolver = () => ok([]),
  options: { canonicalRows?: unknown[]; limited?: boolean; canonicalRead?: () => Promise<QueryResult> } = {},
) {
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
      : options.canonicalRead
        ? options.canonicalRead()
        : ok(options.canonicalRows ?? [{ initialized: false, record: null, render_payload: null, snapshot: null }]),
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
  vi.doMock("@/lib/env", () => ({
    env: {},
    isDemoMode: () => Boolean(options.demoMode),
    isLocalNoAuthMode: () => false,
    requireOpenAIEnv: () => undefined,
    requireServerEnv: () => undefined,
  }));
  vi.doMock("@/lib/registry-corpus", () => ({
    registryCorpusEmbeddingEnabled: () => Boolean(options.registryEmbeddingError),
    bestEffortSyncClinicalRegistryRows: vi.fn(async () => {
      if (options.registryEmbeddingError) {
        console.error("[registry] registry corpus sync failed", {
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

afterEach(async () => {
  vi.restoreAllMocks();
  // The record cache lives on globalThis, so resetting modules no longer empties it.
  const { clearSiteContentRecordCache } = await import("@/lib/site-content/site-content-record-cache");
  clearSiteContentRecordCache();
  vi.resetModules();
});

describe("registry records API", () => {
  it("serves initialized service and form final render bytes with canonical governance", async () => {
    for (const kind of ["service", "form"] as const) {
      const renderPayload = {
        slug: `released-${kind}`,
        title: `Released ${kind}`,
        subtitle: `Canonical ${kind}`,
        statusChips: [{ label: "Released", tone: "success" }],
        summaryCards: [{ id: "baseline-card", label: "Baseline", title: "Forced current baseline" }],
        catalogPayload: { actSections: [{ section: "1", title: "Current Act section" }] },
        tags: [kind],
        catchments: ["Western Australia"],
      };
      const client = createSupabaseMock(undefined, {
        canonicalRows: [
          {
            initialized: true,
            record: { sourceStatus: "review_due", validationStatus: "approved" },
            render_payload: renderPayload,
            snapshot: { state: "current" },
          },
        ],
      });
      mockRuntime(client);
      const { GET } = await import("../src/app/api/registry/records/route");
      const response = await GET(request(`/api/registry/records?kind=${kind}`));
      const payload = (await response.json()) as {
        records: unknown[];
        governance: Record<string, unknown>;
      };
      expect(payload.records).toEqual([renderPayload]);
      expect(payload.governance[`released-${kind}`]).toEqual({
        sourceStatus: "review_due",
        validationStatus: "approved",
      });
    }
  });

  it("serves a counts-only summary projection for mode homes", async () => {
    const client = createSupabaseMock();
    mockRuntime(client, { demoMode: true });
    const { GET } = await import("../src/app/api/registry/records/route");

    const response = await GET(request("/api/registry/records?kind=service&view=summary"));
    const payload = (await response.json()) as {
      total: number;
      verifiedCount: number;
      records?: unknown[];
      governance?: unknown;
    };

    expect(response.status).toBe(200);
    expect(payload.total).toBeGreaterThan(100);
    expect(payload.verifiedCount).toBeGreaterThanOrEqual(0);
    expect(payload.verifiedCount).toBeLessThanOrEqual(payload.total);
    expect(payload).not.toHaveProperty("records");
    expect(payload).not.toHaveProperty("governance");
  });

  it("serves a compact title-and-tag search projection", async () => {
    const client = createSupabaseMock();
    mockRuntime(client, { demoMode: true });
    const { GET } = await import("../src/app/api/registry/records/route");

    const [fullResponse, searchResponse] = await Promise.all([
      GET(request("/api/registry/records?kind=form")),
      GET(request("/api/registry/records?kind=form&view=search")),
    ]);
    const full = (await fullResponse.json()) as { records: Array<Record<string, unknown>> };
    const search = (await searchResponse.json()) as { records: Array<Record<string, unknown>> };

    expect(search.records).toHaveLength(full.records.length);
    expect(Object.keys(search.records[0] ?? {}).sort()).toEqual(
      ["catchments", "primaryContact", "route", "slug", "statusChips", "subtitle", "tags", "title"].sort(),
    );
    expect(search.records[0]).not.toHaveProperty("catalogPayload");
    expect(search.records[0]).not.toHaveProperty("summaryCards");
    expect(JSON.stringify(search).length).toBeLessThan(JSON.stringify(full).length / 2);

    const { rankFormRecords } = await import("../src/lib/forms");
    const fullTop = rankFormRecords(full.records as never, "transport crisis", 1)[0]?.service.slug;
    const searchTop = rankFormRecords(search.records as never, "transport crisis", 1)[0]?.service.slug;
    expect(searchTop).toBe(fullTop);
  });

  it("gzip-compresses catalogue responses when the caller accepts gzip", async () => {
    const client = createSupabaseMock();
    mockRuntime(client, { demoMode: true });
    const { GET } = await import("../src/app/api/registry/records/route");

    const response = await GET(
      request("/api/registry/records?kind=service", { headers: { "Accept-Encoding": "gzip" } }),
    );
    const compressed = Buffer.from(await response.arrayBuffer());
    const payload = JSON.parse(gunzipSync(compressed).toString("utf8")) as { records: unknown[] };

    expect(response.headers.get("content-encoding")).toBe("gzip");
    expect(response.headers.get("vary")).toContain("Accept-Encoding");
    expect(payload.records.length).toBeGreaterThan(100);
    expect(compressed.byteLength).toBeLessThan(gunzipSync(compressed).byteLength / 2);
  });

  it("varies a large uncompressed response by Accept-Encoding", async () => {
    const client = createSupabaseMock();
    mockRuntime(client, { demoMode: true });
    const { GET } = await import("../src/app/api/registry/records/route");

    const response = await GET(request("/api/registry/records?kind=service"));

    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("vary")).toContain("Accept-Encoding");
  });

  it("honors an explicit gzip exclusion before a wildcard acceptance", async () => {
    const client = createSupabaseMock();
    mockRuntime(client, { demoMode: true });
    const { GET } = await import("../src/app/api/registry/records/route");

    const response = await GET(
      request("/api/registry/records?kind=service", {
        headers: { "Accept-Encoding": "gzip;q=0, *;q=1" },
      }),
    );
    const payload = (await response.json()) as { records: unknown[] };

    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("vary")).toContain("Accept-Encoding");
    expect(payload.records.length).toBeGreaterThan(100);
  });

  it("serves mock records in demo mode without touching Supabase", async () => {
    const client = createSupabaseMock();
    mockRuntime(client, { demoMode: true });
    const { GET } = await import("../src/app/api/registry/records/route");

    const response = await GET(request("/api/registry/records?kind=service"));
    const payload = (await response.json()) as { records: Array<{ slug: string }>; demoMode?: boolean };

    expect(response.status).toBe(200);
    expectPublicFixtureCache(response, { variesByEncoding: true });
    expect(payload.demoMode).toBe(true);
    expect(payload.records.some((record) => record.slug === "13yarn")).toBe(true);
    expect(client.from).not.toHaveBeenCalled();
    expect(client.auth.getUser).not.toHaveBeenCalled();
  });

  it("serves curated public records for unauthenticated list requests outside demo mode", async () => {
    const client = createSupabaseMock();
    mockRuntime(client);
    const { GET } = await import("../src/app/api/registry/records/route");

    const response = await GET(request("/api/registry/records?kind=service&q=yarn"));
    const payload = (await response.json()) as {
      records: Array<{ slug: string }>;
      matches?: Array<{ record: { slug: string } }>;
      publicAccess?: boolean;
    };
    expect(response.status).toBe(200);
    expectPublicFixtureCache(response, { variesByEncoding: true });
    expect(payload.publicAccess).toBe(true);
    expect(payload.records.some((record) => record.slug === "13yarn")).toBe(true);
    expect(payload.matches?.[0]?.record.slug).toBe("legal-yarn");
    // The full catalog is served from seed data (no table read) and no auth round-trip is
    // needed, but anonymous list requests must still pass the registry limiter (M4/C1).
    expect(client.from).not.toHaveBeenCalled();
    expect(client.rpc).toHaveBeenCalled();
    expect(client.auth.getUser).not.toHaveBeenCalled();
  });

  it("rate-limits anonymous list requests (429) without falling back to unlimited access", async () => {
    const client = createSupabaseMock(() => ok([]), { limited: true });
    mockRuntime(client);
    const { GET } = await import("../src/app/api/registry/records/route");

    const response = await GET(request("/api/registry/records?kind=service"));

    expect(response.status).toBe(429);
    expect(client.from).not.toHaveBeenCalled();
    expect(client.auth.getUser).not.toHaveBeenCalled();
  });

  it("rejects an invalid kind with a validation error", async () => {
    const client = createSupabaseMock();
    mockRuntime(client);
    const { GET } = await import("../src/app/api/registry/records/route");

    const response = await GET(authedRequest("/api/registry/records?kind=differentials"));

    expect(response.status).toBe(400);
  });

  it("serves the same canonical population without reading authenticated owner drafts", async () => {
    const client = createSupabaseMock((call) =>
      call.table === "clinical_registry_records" ? ok([registryRow()]) : ok([]),
    );
    mockRuntime(client);
    const { GET } = await import("../src/app/api/registry/records/route");

    const response = await GET(authedRequest("/api/registry/records?kind=service&q=yarn"));
    const payload = (await response.json()) as {
      records: Array<{ slug: string }>;
      matches?: Array<{ record: { slug: string }; score: number; reasons: string[] }>;
      governance: Record<string, { validationStatus: string }>;
    };

    expect(response.status).toBe(200);
    expectPrivateCache(response);
    expect(payload.records[0]?.slug).toBe("13yarn");
    expect(payload.matches?.[0]?.record.slug).toBe("legal-yarn");
    expect(payload.governance["13yarn"]?.validationStatus).toBeTruthy();
    const { serviceRecords } = await import("../src/lib/services");
    expect(payload.records).toHaveLength(serviceRecords.length);
    expect(client.calls).toEqual([]);
  });

  it("returns the full record set for client-side ranking, not just the first `limit`", async () => {
    const many = Array.from({ length: 150 }, (_, i) => registryRow({ id: `id-${i}`, slug: `service-${i}` }));
    const client = createSupabaseMock((call) => (call.table === "clinical_registry_records" ? ok(many) : ok([])));
    mockRuntime(client);
    const { GET } = await import("../src/app/api/registry/records/route");
    const { serviceRecords } = await import("../src/lib/services");

    // No `q`: the client hook fetches the whole list and ranks locally, so a
    // small default `limit` must NOT truncate the returned records.
    const response = await GET(authedRequest("/api/registry/records?kind=service&limit=10"));
    const payload = (await response.json()) as { records: Array<{ slug: string }>; total: number };

    expect(response.status).toBe(200);
    expect(payload.records).toHaveLength(serviceRecords.length);
    expect(payload.total).toBe(serviceRecords.length);
    expect(payload.records.filter((record) => record.slug.startsWith("service-"))).toHaveLength(0);
    expect(client.calls).toEqual([]);
  });

  it("returns 429 when the registry rate limit is exhausted", async () => {
    const client = createSupabaseMock(() => ok([]), { limited: true });
    mockRuntime(client);
    const { GET } = await import("../src/app/api/registry/records/route");

    const response = await GET(authedRequest("/api/registry/records?kind=form"));

    expect(response.status).toBe(429);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("returns a canonical record with governance metadata without owner reads", async () => {
    const client = createSupabaseMock((call) => {
      if (call.table === "clinical_registry_records") return ok(registryRow());
      if (call.table === "clinical_registry_record_sources") return ok([]);
      return ok([]);
    });
    mockRuntime(client);
    const { GET } = await import("../src/app/api/registry/records/[slug]/route");

    const response = await GET(authedRequest("/api/registry/records/13YARN?kind=service"), {
      params: Promise.resolve({ slug: "13YARN" }),
    });
    const payload = (await response.json()) as {
      record: { slug: string };
      governance: { sourceStatus: string; validationStatus: string };
    };

    expect(response.status).toBe(200);
    expect(payload.record.slug).toBe("13yarn");
    expect(payload.governance.sourceStatus).toBeTruthy();
    expect(client.calls).toEqual([]);
  });

  it("serves curated public detail records for unauthenticated requests outside demo mode", async () => {
    const client = createSupabaseMock();
    mockRuntime(client);
    const { GET } = await import("../src/app/api/registry/records/[slug]/route");

    const response = await GET(request("/api/registry/records/13YARN?kind=service"), {
      params: Promise.resolve({ slug: "13YARN" }),
    });
    const payload = (await response.json()) as {
      record: { slug: string };
      linkedDocuments: unknown[];
      publicAccess?: boolean;
    };

    expect(response.status).toBe(200);
    expectPublicFixtureCache(response);
    expect(payload.publicAccess).toBe(true);
    expect(payload.record.slug).toBe("13yarn");
    expect(payload.linkedDocuments).toEqual([]);
    // The seed detail is served without a table read or auth round-trip, but anonymous detail
    // requests must still pass the registry limiter (finding C — no anonymous bypass).
    expect(client.from).not.toHaveBeenCalled();
    expect(client.rpc).toHaveBeenCalled();
    expect(client.auth.getUser).not.toHaveBeenCalled();
  });

  it("rate-limits anonymous detail requests (429) instead of skipping the limiter", async () => {
    const client = createSupabaseMock(() => ok([]), { limited: true });
    mockRuntime(client);
    const { GET } = await import("../src/app/api/registry/records/[slug]/route");

    const response = await GET(request("/api/registry/records/13YARN?kind=service"), {
      params: Promise.resolve({ slug: "13YARN" }),
    });

    expect(response.status).toBe(429);
    expect(client.from).not.toHaveBeenCalled();
    expect(client.auth.getUser).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown slug", async () => {
    const client = createSupabaseMock((call) => (call.table === "clinical_registry_records" ? ok(null) : ok([])));
    mockRuntime(client);
    const { GET } = await import("../src/app/api/registry/records/[slug]/route");

    const response = await GET(authedRequest("/api/registry/records/unknown-service?kind=service"), {
      params: Promise.resolve({ slug: "unknown-service" }),
    });

    expect(response.status).toBe(404);
  });

  it("serves the mock detail record in demo mode", async () => {
    const client = createSupabaseMock();
    mockRuntime(client, { demoMode: true });
    const { GET } = await import("../src/app/api/registry/records/[slug]/route");

    const response = await GET(request("/api/registry/records/transport-crisis-form?kind=form"), {
      params: Promise.resolve({ slug: "transport-crisis-form" }),
    });
    const payload = (await response.json()) as { record: { slug: string }; demoMode?: boolean };

    expect(response.status).toBe(200);
    expectPublicFixtureCache(response);
    expect(payload.demoMode).toBe(true);
    expect(payload.record.slug).toBe("transport-crisis-form");
    expect(client.from).not.toHaveBeenCalled();
  });

  it("serves the shared catalogue to an authenticated owner without materializing per-owner copies", async () => {
    const client = createSupabaseMock(() => ok([]));
    mockRuntime(client);
    const { GET } = await import("../src/app/api/registry/records/route");
    const { serviceRecords } = await import("../src/lib/services");

    const response = await GET(authedRequest("/api/registry/records?kind=service"));
    const payload = (await response.json()) as { records: Array<{ slug: string }>; total: number };

    expect(response.status).toBe(200);
    expect(payload.records).toHaveLength(serviceRecords.length);
    expect(payload.total).toBe(serviceRecords.length);
    expect(client.calls.some((call) => call.upsert)).toBe(false);
  });

  it("serves every shared form to an authenticated owner with no stored form rows", async () => {
    const client = createSupabaseMock(() => ok([]));
    mockRuntime(client);
    const { GET } = await import("../src/app/api/registry/records/route");
    const { formRecords } = await import("../src/lib/forms");

    const response = await GET(authedRequest("/api/registry/records?kind=form"));
    const payload = (await response.json()) as { records: Array<{ slug: string }>; total: number };

    expect(response.status).toBe(200);
    expect(payload.records).toHaveLength(54);
    expect(payload.records).toHaveLength(formRecords.length);
    expect(payload.total).toBe(formRecords.length);
    expect(client.calls.some((call) => call.upsert)).toBe(false);
  });

  it("keeps complete shared form metadata when an older owner override has no catalogue payload", async () => {
    const client = createSupabaseMock((call) =>
      call.table === "clinical_registry_records"
        ? ok([
            registryRow({
              kind: "form",
              slug: "transport-crisis-form",
              title: "Owner title override",
              status_chips: null,
              contacts: null,
              summary_cards: null,
              criteria: null,
              catalog_payload: {},
            }),
          ])
        : ok([]),
    );
    mockRuntime(client);
    const { GET } = await import("../src/app/api/registry/records/route");

    const response = await GET(authedRequest("/api/registry/records?kind=form"));
    const payload = (await response.json()) as {
      records: Array<{
        slug: string;
        title: string;
        statusChips?: unknown[];
        contacts?: unknown[];
        summaryCards?: unknown[];
        criteria?: unknown[];
        catalogPayload?: { availability?: string };
      }>;
    };
    const record = payload.records.find((candidate) => candidate.slug === "transport-crisis-form");

    expect(response.status).toBe(200);
    expect(record?.title).toBe("Transport order");
    expect(record?.statusChips?.length).toBeGreaterThan(0);
    expect(record?.contacts?.length).toBeGreaterThan(0);
    expect(record?.summaryCards?.length).toBeGreaterThan(0);
    expect(record?.criteria?.length).toBeGreaterThan(0);
    expect(record?.catalogPayload?.availability).toBe("downloadable");
    expect(client.calls.some((call) => call.upsert)).toBe(false);
  });

  it("serves a shared deep link to an authenticated owner without seeding", async () => {
    const client = createSupabaseMock((call) => (call.table === "clinical_registry_records" ? ok(null) : ok([])));
    mockRuntime(client);
    const { GET } = await import("../src/app/api/registry/records/[slug]/route");

    const response = await GET(authedRequest("/api/registry/records/transport-crisis-form?kind=form"), {
      params: Promise.resolve({ slug: "transport-crisis-form" }),
    });
    const payload = (await response.json()) as { record: { slug: string }; sharedCatalog?: boolean };

    expect(response.status).toBe(200);
    expect(payload.record.slug).toBe("transport-crisis-form");
    expect(payload.sharedCatalog).toBe(true);
    expect(client.calls.some((call) => call.upsert)).toBe(false);
  });

  it("merges shared form metadata into an older owner row on detail routes", async () => {
    const client = createSupabaseMock((call) => {
      if (call.table === "clinical_registry_records") {
        return ok(
          registryRow({
            kind: "form",
            slug: "transport-crisis-form",
            title: "Owner title override",
            catalog_payload: {},
          }),
        );
      }
      return ok([]);
    });
    mockRuntime(client);
    const { GET } = await import("../src/app/api/registry/records/[slug]/route");

    const response = await GET(authedRequest("/api/registry/records/transport-crisis-form?kind=form"), {
      params: Promise.resolve({ slug: "transport-crisis-form" }),
    });
    const payload = (await response.json()) as {
      record: { title: string; catalogPayload?: { availability?: string; localPdfPath?: string } };
      governance: { sourceStatus: string };
      linkedDocuments: unknown[];
    };

    expect(response.status).toBe(200);
    expect(payload.record.title).toBe("Transport order");
    expect(payload.record.catalogPayload?.availability).toBe("downloadable");
    expect(payload.record.catalogPayload?.localPdfPath).toBeTruthy();
    expect(payload.governance.sourceStatus).toBe("current");
    expect(payload.linkedDocuments).toEqual([]);
  });

  it("uses catalogue summary cards for forms even when owner row has non-null stored cards", async () => {
    const staleCards = [{ id: "old", label: "Old card", title: "Legacy value", detail: "stale" }];
    const client = createSupabaseMock((call) =>
      call.table === "clinical_registry_records"
        ? ok([
            registryRow({
              kind: "form",
              slug: "form-1a",
              title: "Form 1A",
              summary_cards: staleCards,
            }),
          ])
        : ok([]),
    );
    mockRuntime(client);
    const { GET } = await import("../src/app/api/registry/records/route");

    const response = await GET(authedRequest("/api/registry/records?kind=form"));
    const payload = (await response.json()) as {
      records: Array<{ slug: string; summaryCards?: Array<{ id: string; label: string }> }>;
    };
    const record = payload.records.find((r) => r.slug === "form-1a");

    expect(response.status).toBe(200);
    // Catalogue-derived cards must win over the stale owner row.
    expect(record?.summaryCards?.map((c) => c.id)).not.toContain("old");
    expect(record?.summaryCards?.length).toBeGreaterThan(0);
  });

  it("does not seed when the owner already has registry records", async () => {
    const client = createSupabaseMock((call) =>
      call.table === "clinical_registry_records" ? ok([registryRow()]) : ok([]),
    );
    mockRuntime(client);
    const { GET } = await import("../src/app/api/registry/records/route");

    const response = await GET(authedRequest("/api/registry/records?kind=service"));

    expect(response.status).toBe(200);
    expect(client.calls.some((call) => call.upsert)).toBe(false);
  });
});

/**
 * The symptom the operator actually reported on 2026-09-16: Forms search sat on "Searching…" and
 * never resolved. This route had no budget on its canonical read at all, so a catalogue read that
 * was never going to finish in time simply held the request open. Universal search timed out at
 * 2500 ms and returned an empty group; this route did not even do that.
 *
 * Both cases must answer from the in-bundle catalogue instead, and must NOT be marked publicly
 * cacheable — a degraded response pinned at a CDN would outlive the thirty-second cooldown that
 * lets the database recover on its own.
 */
describe("registry records survive an unusable catalogue", () => {
  afterEach(async () => {
    const { clearCatalogueSeedFallbackCooldown } = await import("@/lib/site-content/catalogue-seed-fallback");
    clearCatalogueSeedFallbackCooldown();
  });

  it.each([
    ["rejects", () => Promise.reject(new Error("canonical read failed"))],
    ["never settles", () => new Promise<QueryResult>(() => {})],
  ])(
    "serves the in-bundle catalogue when the canonical read %s",
    async (_label, canonicalRead) => {
      const { clearCatalogueSeedFallbackCooldown } = await import("@/lib/site-content/catalogue-seed-fallback");
      clearCatalogueSeedFallbackCooldown();
      const client = createSupabaseMock(undefined, { canonicalRead: canonicalRead as () => Promise<QueryResult> });
      mockRuntime(client);
      const { GET } = await import("../src/app/api/registry/records/route");

      const response = await GET(request("/api/registry/records?kind=form"));
      const payload = (await response.json()) as { records: unknown[]; degraded?: boolean };

      expect(response.status).toBe(200);
      expect(payload.records.length).toBeGreaterThan(0);
      // The records are real, but they came from the in-bundle list. Saying so is the whole
      // point: without this key the reader cannot tell this response from a current one.
      expect(payload.degraded).toBe(true);
      expectPrivateCache(response);
    },
    20_000,
  );

  it("does not claim degraded when the canonical read succeeds", async () => {
    const { clearCatalogueSeedFallbackCooldown } = await import("@/lib/site-content/catalogue-seed-fallback");
    clearCatalogueSeedFallbackCooldown();
    const client = createSupabaseMock();
    mockRuntime(client);
    const { GET } = await import("../src/app/api/registry/records/route");

    const response = await GET(request("/api/registry/records?kind=form"));
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    // Absent, not `false`: a healthy response is byte-for-byte what it always was.
    expect("degraded" in payload).toBe(false);
  });

  it("keeps a degraded list publicly uncacheable so a recovered database is not shadowed", async () => {
    const { clearCatalogueSeedFallbackCooldown } = await import("@/lib/site-content/catalogue-seed-fallback");
    clearCatalogueSeedFallbackCooldown();
    const client = createSupabaseMock(undefined, {
      canonicalRead: () => Promise.reject(new Error("canonical read failed")),
    });
    mockRuntime(client);
    const { GET } = await import("../src/app/api/registry/records/route");

    const response = await GET(request("/api/registry/records?kind=form"));

    expect(((await response.json()) as { degraded?: boolean }).degraded).toBe(true);
    // Emitting the flag must not have widened `fixture`: pinning the seed list in front of a
    // database that may recover in thirty seconds would be worse than the silence it replaced.
    expectPrivateCache(response);
  });

  it("serves the public catalogue when a presented bearer credential is invalid", async () => {
    // A stale PWA cookie used to hard-401 this route via publicAccessContext, which blanked
    // Services/Forms with "Could not load …" even though the corpus is public.
    const { clearCatalogueSeedFallbackCooldown } = await import("@/lib/site-content/catalogue-seed-fallback");
    clearCatalogueSeedFallbackCooldown();
    const client = createSupabaseMock();
    mockRuntime(client);
    const { GET } = await import("../src/app/api/registry/records/route");

    const response = await GET(
      request("/api/registry/records?kind=service", {
        headers: { Authorization: "Bearer expired-token", "x-real-ip": "198.51.100.10" },
      }),
    );
    const payload = (await response.json()) as { records: unknown[] };

    expect(response.status).toBe(200);
    expect(payload.records.length).toBeGreaterThan(0);
  });

  it("strips nested publication-only source fields before responding", async () => {
    const { clearCatalogueSeedFallbackCooldown } = await import("@/lib/site-content/catalogue-seed-fallback");
    clearCatalogueSeedFallbackCooldown();
    const renderPayload = {
      slug: "crisis-line",
      title: "Crisis line",
      source: {
        label: "WA Health",
        status: "current",
        summary: "publication-only field",
        lastUpdated: "2026-09-01",
        version: "2",
        title: "Source title",
      },
    };
    const client = createSupabaseMock(undefined, {
      canonicalRows: [
        {
          initialized: true,
          record: { sourceStatus: "current", validationStatus: "approved" },
          render_payload: renderPayload,
          snapshot: { state: "current" },
        },
      ],
    });
    mockRuntime(client);
    const { GET } = await import("../src/app/api/registry/records/route");
    const { parseRegistryListResponse } = await import("@/lib/registry-client-contract");

    const response = await GET(request("/api/registry/records?kind=service"));
    const payload = (await response.json()) as {
      records: Array<{ slug: string; source?: Record<string, unknown> }>;
      total: number;
      verifiedCount: number;
      governance: Record<string, unknown>;
      publicAccess?: boolean;
    };

    expect(response.status).toBe(200);
    expect(payload.records[0]?.source).toEqual({ label: "WA Health", status: "current" });
    expect(parseRegistryListResponse(payload, "full")).not.toBeNull();
  });
});
