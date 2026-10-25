import { afterEach, describe, expect, it, vi } from "vitest";

const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const batchJobId = "22222222-2222-4222-8222-222222222222";
const ingestionJobId = "33333333-3333-4333-8333-333333333333";
const documentId = "44444444-4444-4444-8444-444444444444";

type RouteJobRow = {
  id: string;
  status: string;
  documents: {
    id?: string;
    title: string;
    file_name: string;
    owner_id: string;
  };
};

type BatchRow = {
  id: string;
  status: string;
};

function createQueryMock<T>(result: { data: T; error: { message: string } | null; count?: number | null }) {
  const chain = {
    select: null as unknown as ReturnType<typeof vi.fn>,
    eq: null as unknown as ReturnType<typeof vi.fn>,
    or: null as unknown as ReturnType<typeof vi.fn>,
    in: null as unknown as ReturnType<typeof vi.fn>,
    order: null as unknown as ReturnType<typeof vi.fn>,
    limit: null as unknown as ReturnType<typeof vi.fn>,
    range: null as unknown as ReturnType<typeof vi.fn>,
    then: (
      resolve: (value: { data: T; error: { message: string } | null; count?: number | null }) => void,
      reject?: (reason?: unknown) => void,
    ) => Promise.resolve(result).then(resolve, reject),
  } as {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    or: ReturnType<typeof vi.fn>;
    in: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
    range: ReturnType<typeof vi.fn>;
    then: (
      resolve: (value: { data: T; error: { message: string } | null; count?: number | null }) => void,
      reject?: (reason?: unknown) => void,
    ) => Promise<unknown>;
  };

  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.or = vi.fn(() => chain);
  chain.in = vi.fn(() => chain);
  chain.order = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.range = vi.fn(() => chain);
  return chain;
}

const authenticationErrorMockClass = class AuthenticationError extends Error {};

// The administrator ingestion routes (/api/jobs, /api/ingestion/jobs,
// /api/ingestion/batches) consult the shared `ingestion_admin` rate-limit
// bucket via `supabase.rpc("consume_api_rate_limit", ...)` before they touch
// `from()` (#L32, #L43). A bare `{ from }` admin-client double has no `rpc`
// method, so calling it throws instead of resolving — this stub reports the
// bucket not exhausted so the routes proceed to the query assertions each
// test actually cares about.
function nonLimitedRateLimitRpc() {
  return vi.fn(async () => ({
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
  }));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("/api/local-project-id", () => {
  it("returns a stable local identity payload", async () => {
    const { GET } = await import("../src/app/api/local-project-id/route");

    const response = await GET(new Request("http://localhost:3100/api/local-project-id"));
    const payload = await response.json();

    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(payload.identityPath).toBe("/api/local-project-id");
    expect(payload.projectId).toMatch(/^clinical-kb:[0-9a-f]{12}$/i);
    expect(payload.localServer.currentPort).toBe(3100);
  });
});

describe("/api/jobs", () => {
  it("returns demo jobs without calling Supabase when demo mode is enabled", async () => {
    const createAdminClient = vi.fn();
    vi.doMock("@/lib/env", () => ({ isDemoMode: () => true }));
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient }));
    const { GET } = await import("../src/app/api/jobs/route");

    const response = await GET(new Request("http://localhost/api/jobs"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.demoMode).toBe(true);
    expect(Array.isArray(payload.jobs)).toBe(true);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("returns jobs with indexing-active metadata for authenticated users", async () => {
    const chain = createQueryMock({
      data: [
        {
          id: batchJobId,
          status: "pending",
          documents: {
            id: documentId,
            title: "Case guidance",
            file_name: "case.pdf",
            owner_id: ownerId,
          },
        } satisfies RouteJobRow,
      ],
      error: null,
    });
    vi.doMock("@/lib/env", () => ({ isDemoMode: () => false }));
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({ from: vi.fn(() => chain), rpc: nonLimitedRateLimitRpc() }),
    }));
    vi.doMock("@/lib/supabase/auth", () => ({
      AuthenticationError: authenticationErrorMockClass,
      requireAuthenticatedUser: vi.fn(async () => ({ id: ownerId })),
      unauthorizedResponse: () => Response.json({ error: "Authentication required." }, { status: 401 }),
    }));

    const { GET } = await import("../src/app/api/jobs/route");
    const response = await GET(new Request("http://localhost/api/jobs"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.activeJobCount).toBe(1);
    expect(payload.hasActiveJobs).toBe(true);
    expect(payload.pollAfterMs).toBe(5_000);
    expect(response.headers.get("x-indexing-active")).toBe("true");
    expect(Array.isArray(payload.jobs)).toBe(true);
  });
});

describe("/api/ingestion/jobs", () => {
  it("returns demo mode payload without querying Supabase", async () => {
    const createAdminClient = vi.fn();
    vi.doMock("@/lib/env", () => ({ isDemoMode: () => true }));
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient }));
    const { GET } = await import("../src/app/api/ingestion/jobs/route");

    const response = await GET(new Request("http://localhost/api/ingestion/jobs"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      jobs: [],
      activeJobCount: 0,
      failedJobCount: 0,
      hasActiveJobs: false,
      pollAfterMs: null,
      demoMode: true,
      pagination: {
        limit: 100,
        offset: 0,
        total: 0,
        nextOffset: 0,
        hasMore: false,
      },
    });
    expect(response.headers.get("x-indexing-active")).toBe("false");
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("returns ingestion jobs for an authenticated user and marks active state", async () => {
    const jobsChain = createQueryMock({
      data: [
        {
          id: ingestionJobId,
          status: "processing",
          documents: { title: "Case guidance", file_name: "case.pdf", owner_id: ownerId },
        },
      ] satisfies [RouteJobRow],
      error: null,
      count: 1,
    });
    const activeCountChain = createQueryMock({ data: null, error: null, count: 1 });
    // #L15: the route now also runs a failed-jobs head count, same shape as
    // activeCountChain, so the mock must answer a third `from()` call.
    const failedCountChain = createQueryMock({ data: null, error: null, count: 3 });
    const from = vi
      .fn()
      .mockReturnValueOnce(jobsChain)
      .mockReturnValueOnce(activeCountChain)
      .mockReturnValueOnce(failedCountChain);
    vi.doMock("@/lib/env", () => ({ isDemoMode: () => false }));
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({ from, rpc: nonLimitedRateLimitRpc() }),
    }));
    vi.doMock("@/lib/supabase/auth", () => ({
      AuthenticationError: authenticationErrorMockClass,
      requireAuthenticatedUser: vi.fn(async () => ({ id: ownerId })),
      unauthorizedResponse: () => Response.json({ error: "Authentication required." }, { status: 401 }),
    }));
    const { GET } = await import("../src/app/api/ingestion/jobs/route");
    const request = new Request("http://localhost/api/ingestion/jobs?batchId=11111111-1111-4111-8111-111111111111");
    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.activeJobCount).toBe(1);
    expect(payload.hasActiveJobs).toBe(true);
    expect(payload.pollAfterMs).toBe(5_000);
    expect(payload.failedJobCount).toBe(3);
    expect(payload.jobs).toHaveLength(1);
    expect(from).toHaveBeenCalledTimes(3);
    expect(activeCountChain.in).toHaveBeenCalledWith("status", ["pending", "processing"]);
    // ING-S-N7: the administrator's own jobs and the shared library's owner-less jobs.
    const ownerFilter = [`owner_id.eq.${ownerId},owner_id.is.null`, { referencedTable: "documents" }];
    expect(jobsChain.or).toHaveBeenCalledWith(...ownerFilter);
    expect(activeCountChain.or).toHaveBeenCalledWith(...ownerFilter);
    expect(activeCountChain.eq).toHaveBeenCalledWith("batch_id", "11111111-1111-4111-8111-111111111111");
    expect(failedCountChain.eq).toHaveBeenCalledWith("status", "failed");
    expect(failedCountChain.or).toHaveBeenCalledWith(...ownerFilter);
    expect(failedCountChain.eq).toHaveBeenCalledWith("batch_id", "11111111-1111-4111-8111-111111111111");
  });
});

describe("/api/ingestion/batches", () => {
  it("returns ingestion batch state with active polling headers", async () => {
    const chain = createQueryMock({
      data: [
        { id: "b1", status: "queued" },
        { id: "b2", status: "completed" },
      ] satisfies BatchRow[],
      error: null,
    });
    vi.doMock("@/lib/env", () => ({ isDemoMode: () => false }));
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({ from: vi.fn(() => chain), rpc: nonLimitedRateLimitRpc() }),
    }));
    vi.doMock("@/lib/supabase/auth", () => ({
      AuthenticationError: authenticationErrorMockClass,
      requireAuthenticatedUser: vi.fn(async () => ({ id: ownerId })),
      unauthorizedResponse: () => Response.json({ error: "Authentication required." }, { status: 401 }),
    }));
    const { GET } = await import("../src/app/api/ingestion/batches/route");
    const response = await GET(new Request("http://localhost/api/ingestion/batches"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.activeBatchCount).toBe(1);
    expect(payload.hasActiveBatches).toBe(true);
    expect(payload.pollAfterMs).toBe(5_000);
    expect(payload.batches).toHaveLength(2);
    expect(response.headers.get("x-indexing-active")).toBe("true");
  });
});

describe("/api/documents/bulk", () => {
  it("blocks bulk edits in demo mode", async () => {
    const createAdminClient = vi.fn();
    vi.doMock("@/lib/env", () => ({ isDemoMode: () => true }));
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient }));
    const { POST } = await import("../src/app/api/documents/bulk/route");

    const response = await POST(
      new Request("http://localhost/api/documents/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documentIds: [documentId] }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe("Bulk edits are unavailable in demo mode.");
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("returns unauthorized when user resolution fails", async () => {
    vi.doMock("@/lib/env", () => ({ isDemoMode: () => false }));
    vi.doMock("@/lib/validation/body", () => ({
      parseJsonBody: vi.fn(async () => ({
        documentIds: [documentId],
        metadata: {},
        titleEdit: {},
        labels: { add: [], remove: [] },
      })),
    }));
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: vi.fn() }) }));
    vi.doMock("@/lib/supabase/auth", () => ({
      AuthenticationError: authenticationErrorMockClass,
      requireAuthenticatedUser: vi.fn(async () => {
        throw new authenticationErrorMockClass();
      }),
      unauthorizedResponse: () => Response.json({ error: "Authentication required." }, { status: 401 }),
    }));
    const { POST } = await import("../src/app/api/documents/bulk/route");

    const response = await POST(
      new Request("http://localhost/api/documents/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documentIds: [documentId] }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe("Authentication required.");
  });
});
