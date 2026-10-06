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
  head?: boolean;
};
type QueryResolver = (call: QueryCall) => QueryResult;

function ok(data: unknown): QueryResult {
  return { data, error: null };
}

class QueryBuilder implements PromiseLike<QueryResult> {
  constructor(
    private readonly call: QueryCall,
    private readonly resolver: QueryResolver,
  ) {}

  select(_columns?: string, options?: { count?: string; head?: boolean }) {
    if (options?.head) this.call.head = true;
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
  options: { canonicalRows?: unknown[]; limited?: boolean } = {},
) {
  const calls: QueryCall[] = [];
  const from = vi.fn((table: string) => {
    const call: QueryCall = { table, filters: [], inFilters: [], maybeSingle: false };
    calls.push(call);
    return new QueryBuilder(call, resolve);
  });
  return {
    calls,
    from,
    auth: {
      getUser: vi.fn(async (receivedToken?: string) =>
        receivedToken === token
          ? { data: { user: { id: userId } }, error: null }
          : { data: { user: null }, error: { message: "Invalid token" } },
      ),
    },
    rpc: vi.fn(async (name: string) =>
      name === "consume_api_rate_limit" || name === "consume_api_subject_rate_limit"
        ? ok([
            {
              limited: Boolean(options.limited),
              limit_value: 120,
              remaining: options.limited ? 0 : 119,
              retry_after_seconds: 60,
              reset_at: new Date(Date.now() + 60_000).toISOString(),
            },
          ])
        : ok(options.canonicalRows ?? [{ initialized: false, record: null, render_payload: null, snapshot: null }]),
    ),
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
    isLocalNoAuthMode: () => Boolean(options.demoMode),
  }));
  vi.doMock("@/lib/registry-corpus", () => ({
    registryCorpusEmbeddingEnabled: () => Boolean(options.registryEmbeddingError),
    bestEffortSyncDifferentialRows: vi.fn(async () => {
      if (options.registryEmbeddingError) {
        console.error("[differentials] registry corpus sync failed", {
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

function request(path: string) {
  return new Request(`http://localhost${path}`);
}

function authenticatedRequest(path: string) {
  return new Request(`http://localhost${path}`, { headers: { Authorization: `Bearer ${token}` } });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("differentials API routes", () => {
  it("serves initialized diagnosis and presentation payloads without expecting a raw payload wrapper", async () => {
    const cases = [
      {
        kind: "diagnosis",
        key: "records",
        renderPayload: {
          slug: "released-diagnosis",
          title: "Released diagnosis",
          status: "must-not-miss",
          subtitle: "Canonical subtitle",
          clinicalHinge: "Exact hinge",
          safetySnapshot: { summary: "Exact safety", tags: ["urgent"] },
          sections: [{ title: "Features", tone: "overlap", items: ["Exact item"] }],
          related: [],
        },
        // Canonical payloads were published before presentation scope existed, so
        // the route relabels them on the way out (`scopeDifferentialRecord`).
        // Asserting the scoped shape keeps this test proving two things at once:
        // the route adds the labels, and it alters nothing else. "Exact hinge" is
        // not one of the corpus's group hinges, so it stays diagnosis-scoped; the
        // section is not one of the two diagnosis-scoped criteria, so it is
        // labelled group context, which is the conservative default.
        expectedPayload: {
          slug: "released-diagnosis",
          title: "Released diagnosis",
          status: "must-not-miss",
          subtitle: "Canonical subtitle",
          clinicalHinge: "Exact hinge",
          clinicalHingeScope: "diagnosis",
          safetySnapshot: { summary: "Exact safety", tags: ["urgent"] },
          sections: [{ title: "Features", tone: "overlap", items: ["Exact item"], scope: "presentation" }],
          related: [],
        },
      },
      {
        kind: "presentation",
        key: "presentations",
        renderPayload: {
          id: "released-presentation",
          title: "Released presentation",
          sourceTitle: "Canonical source",
          scopeLabel: "Exact scope",
          titleAliases: ["Alias"],
          status: "current",
          subtitle: "Canonical subtitle",
          selectedCount: 1,
          totalCount: 1,
          safetySnapshot: { summary: "Exact safety", tags: ["urgent"] },
          criteria: [],
          candidates: [],
          reviewChecklist: [],
          highestUrgencyNote: "Exact urgency",
          sourceStatus: "current",
        },
        // No criteria on this fixture, so scoping is a no-op here.
        expectedPayload: {
          id: "released-presentation",
          title: "Released presentation",
          sourceTitle: "Canonical source",
          scopeLabel: "Exact scope",
          titleAliases: ["Alias"],
          status: "current",
          subtitle: "Canonical subtitle",
          selectedCount: 1,
          totalCount: 1,
          safetySnapshot: { summary: "Exact safety", tags: ["urgent"] },
          criteria: [],
          candidates: [],
          reviewChecklist: [],
          highestUrgencyNote: "Exact urgency",
          sourceStatus: "current",
        },
      },
    ] as const;
    for (const item of cases) {
      const client = createSupabaseMock(undefined, {
        canonicalRows: [
          {
            initialized: true,
            record: { sourceStatus: "current", validationStatus: "approved" },
            render_payload: item.renderPayload,
            snapshot: { state: "current" },
          },
        ],
      });
      mockRuntime(client);
      const { GET } = await import("../src/app/api/differentials/route");
      const response = await GET(request(`/api/differentials?kind=${item.kind}`));
      const payload = (await response.json()) as Record<string, unknown>;
      expect({ status: response.status, payload }).toMatchObject({ status: 200, payload: { publicAccess: true } });
      expect(payload[item.key]).toEqual([item.expectedPayload]);
    }
  });

  it("does not expose an authenticated owner's unpublished diagnosis row", async () => {
    const diagnosis = {
      slug: "owner-diagnosis",
      title: "Owner diagnosis",
      related: [{ id: "owner-related" }],
      sections: [{ tone: "overlap", items: ["Owner related"] }],
    };
    const related = {
      slug: "owner-related",
      title: "Owner related",
      related: [],
      sections: [],
    };
    const presentation = {
      id: "owner-presentation",
      title: "Owner presentation",
      candidates: [{ slug: "owner-diagnosis" }],
    };
    const row = (kind: "diagnosis" | "presentation", slug: string, payload: unknown) => ({
      owner_id: userId,
      kind,
      slug,
      payload,
      source_status: "current",
      validation_status: "locally_reviewed",
      last_reviewed_at: null,
      review_due_at: null,
    });
    const diagnosisRow = row("diagnosis", diagnosis.slug, diagnosis);
    const ownerRows = [
      diagnosisRow,
      row("diagnosis", related.slug, related),
      row("presentation", presentation.id, presentation),
    ];
    const client = createSupabaseMock((call) => {
      if (call.table === "differential_records" && call.maybeSingle) return ok(diagnosisRow);
      if (call.table === "differential_records") return ok(ownerRows);
      return ok([]);
    });
    mockRuntime(client);
    const { GET } = await import("../src/app/api/differentials/[slug]/route");

    const response = await GET(authenticatedRequest("/api/differentials/owner-diagnosis?kind=diagnosis"), {
      params: Promise.resolve({ slug: "owner-diagnosis" }),
    });
    const payload = (await response.json()) as {
      detailContext?: {
        knownRelatedSlugs?: string[];
        relatedMapDetails?: Record<string, unknown>;
        termLinks?: Record<string, string>;
        overlapLinks?: Record<string, string>;
        comparePresentation?: { slug: string } | null;
      };
    };

    expect(response.status).toBe(404);
    expectPrivateCache(response);
    expect(payload.detailContext).toBeUndefined();
    expect(client.from).not.toHaveBeenCalled();
  });

  it("serves delirium from snapshot in demo mode", async () => {
    const client = createSupabaseMock();
    mockRuntime(client, { demoMode: true });
    const { GET } = await import("../src/app/api/differentials/[slug]/route");

    const response = await GET(request("/api/differentials/delirium?kind=diagnosis"), {
      params: Promise.resolve({ slug: "delirium" }),
    });
    const payload = (await response.json()) as {
      record?: { slug: string };
      detailContext?: { comparePresentation?: { slug: string } | null; knownRelatedSlugs?: string[] };
      demoMode?: boolean;
    };

    expect(response.status).toBe(200);
    expectPublicFixtureCache(response);
    expect(payload.demoMode).toBe(true);
    expect(payload.record?.slug).toBe("delirium");
    expect(payload.detailContext?.comparePresentation?.slug).toBe("acute-confusion-encephalopathy");
    expect(payload.detailContext?.knownRelatedSlugs).toContain("akathisia");
    expect(client.from).not.toHaveBeenCalled();
  });

  it("serves acute confusion presentation workflow in demo mode", async () => {
    const client = createSupabaseMock();
    mockRuntime(client, { demoMode: true });
    const { GET } = await import("../src/app/api/differentials/presentations/[slug]/route");

    const response = await GET(request("/api/differentials/presentations/acute-confusion-encephalopathy"), {
      params: Promise.resolve({ slug: "acute-confusion-encephalopathy" }),
    });
    const payload = (await response.json()) as {
      workflow?: { id: string };
      candidates?: Array<{ slug: string; record: { slug: string } }>;
      demoMode?: boolean;
    };

    expect(response.status).toBe(200);
    expectPublicFixtureCache(response);
    expect(payload.demoMode).toBe(true);
    expect(payload.workflow?.id).toBe("acute-confusion-encephalopathy");
    expect(payload.candidates?.length).toBeGreaterThan(0);
    expect(payload.candidates?.every((candidate) => candidate.record.slug === candidate.slug)).toBe(true);
  });

  it("lists diagnosis records in demo mode", async () => {
    const client = createSupabaseMock();
    mockRuntime(client, { demoMode: true });
    const { GET } = await import("../src/app/api/differentials/route");

    const response = await GET(request("/api/differentials?kind=diagnosis&limit=10"));
    const payload = (await response.json()) as {
      records?: Array<{ slug: string }>;
      matches?: unknown;
      total?: number;
      demoMode?: boolean;
    };

    expect(response.status).toBe(200);
    expectPublicFixtureCache(response);
    expect(payload.demoMode).toBe(true);
    expect((payload.total ?? 0) > 100).toBe(true);
    expect(payload.records?.length).toBeGreaterThan(0);
    expect(payload.matches).toBeUndefined();
  });

  it("returns scored diagnosis matches for a query", async () => {
    const client = createSupabaseMock();
    mockRuntime(client, { demoMode: true });
    const { GET } = await import("../src/app/api/differentials/route");

    const response = await GET(request("/api/differentials?kind=diagnosis&q=delirium&limit=10"));
    const payload = (await response.json()) as {
      records?: Array<{ slug: string }>;
      matches?: Array<{ record: { slug: string }; score: number; reasons: string[] }>;
    };

    expect(response.status).toBe(200);
    expect(payload.matches?.[0]?.record.slug).toBe("delirium");
    expect(payload.matches?.[0]?.score ?? 0).toBeGreaterThan(0);
    expect(payload.matches?.[0]?.reasons).toContain("title");
    // Ranked records stay in ranked order and mirror the matches list.
    expect(payload.records?.[0]?.slug).toBe("delirium");
    expect(payload.records?.length).toBe(payload.matches?.length);
  });

  it("searches a pasted vignette longer than 200 characters instead of rejecting it", async () => {
    const client = createSupabaseMock();
    mockRuntime(client, { demoMode: true });
    const { GET } = await import("../src/app/api/differentials/route");
    const vignette =
      "patient on lithium 900 mg nocte for bipolar affective disorder, recently started sertraline 50 mg for depression and taking regular ibuprofen for back pain, now tremulous and confused with vomiting since yesterday";

    const response = await GET(request(`/api/differentials?kind=diagnosis&q=${encodeURIComponent(vignette)}&limit=10`));

    expect(vignette.length).toBeGreaterThan(200);
    expect(response.status).toBe(200);
  });

  it("reports the catalogue size in `total`, not the size of the query's own result set", async () => {
    const client = createSupabaseMock();
    mockRuntime(client, { demoMode: true });
    const { GET } = await import("../src/app/api/differentials/route");

    const unfiltered = await GET(request("/api/differentials?kind=diagnosis&limit=10"));
    const filtered = await GET(request("/api/differentials?kind=diagnosis&q=delirium&limit=10"));
    const unfilteredPayload = (await unfiltered.json()) as { total?: number };
    const filteredPayload = (await filtered.json()) as { records?: unknown[]; total?: number };

    // `total` answers "how many differentials are there", so a query must not
    // move it. It used to measure the returned records, which under a query are
    // the ranked matches — so a caller asking for the catalogue figure got its
    // own result count back and could not state the real one.
    expect(filteredPayload.total).toBe(unfilteredPayload.total);
    expect(filteredPayload.total ?? 0).toBeGreaterThan(filteredPayload.records?.length ?? 0);
  });

  it("returns scored presentation matches for a query", async () => {
    const client = createSupabaseMock();
    mockRuntime(client, { demoMode: true });
    const { GET } = await import("../src/app/api/differentials/route");

    const response = await GET(request("/api/differentials?kind=presentation&q=acute%20confusion&limit=5"));
    const payload = (await response.json()) as {
      presentations?: Array<{ id: string }>;
      matches?: Array<{ workflow: { id: string }; score: number; reasons: string[] }>;
    };

    expect(response.status).toBe(200);
    expect(payload.matches?.[0]?.workflow.id).toBe("acute-confusion-encephalopathy");
    expect(payload.matches?.[0]?.score ?? 0).toBeGreaterThan(0);
    expect(payload.presentations?.[0]?.id).toBe("acute-confusion-encephalopathy");
    expect(payload.presentations?.length).toBeLessThanOrEqual(5);
  });

  it("serves seeded differential records when registry corpus embedding fails after the row upsert", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let stored: Array<Record<string, unknown>> = [];
    const client = createSupabaseMock((call) => {
      if (call.table !== "differential_records") return ok([]);
      if (call.upsert) {
        stored = (call.upsertRows ?? []) as Array<Record<string, unknown>>;
        return ok(stored);
      }
      return ok(stored.filter((row) => row.kind === "diagnosis"));
    });
    mockRuntime(client, { registryEmbeddingError: new Error("embedding unavailable") });
    const { GET } = await import("../src/app/api/differentials/route");

    const response = await GET(authenticatedRequest("/api/differentials?kind=diagnosis&limit=10"));
    const payload = (await response.json()) as { records?: Array<{ slug: string }>; total?: number };

    expect(response.status).toBe(200);
    expect(payload.total ?? 0).toBeGreaterThan(0);
    expect(payload.records?.length).toBeGreaterThan(0);
    expect(consoleError).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it.each([
    ["diagnosis", "/api/differentials/unknown-diagnosis?kind=diagnosis", "../src/app/api/differentials/[slug]/route"],
    [
      "presentation",
      "/api/differentials/presentations/unknown-presentation",
      "../src/app/api/differentials/presentations/[slug]/route",
    ],
  ])("returns 404 for an unknown %s slug during a corpus embedding outage", async (kind, path, modulePath) => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let stored: Array<Record<string, unknown>> = [];
    const slug = kind === "diagnosis" ? "unknown-diagnosis" : "unknown-presentation";
    const client = createSupabaseMock((call) => {
      if (call.table !== "differential_records") return ok([]);
      if (call.head) return { data: null, error: null, count: stored.length };
      if (call.upsert) {
        stored = (call.upsertRows ?? []) as Array<Record<string, unknown>>;
        return ok(stored);
      }
      if (call.maybeSingle) return ok(stored.find((row) => row.kind === kind && row.slug === slug) ?? null);
      return ok(stored.filter((row) => row.kind === kind));
    });
    mockRuntime(client, { registryEmbeddingError: new Error("embedding unavailable") });
    const { GET } = await import(modulePath);

    const response = await GET(authenticatedRequest(path), { params: Promise.resolve({ slug }) });

    expect(response.status).toBe(404);
    expect(consoleError).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it("rate-limits requests (429) and returns Retry-After header when consume_api_rate_limit returns limited: true", async () => {
    const client = createSupabaseMock(() => ok([]), { limited: true });
    mockRuntime(client);
    const { GET } = await import("../src/app/api/differentials/route");

    const response = await GET(request("/api/differentials"));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(client.from).not.toHaveBeenCalled();
  });
});
