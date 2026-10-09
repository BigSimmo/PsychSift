import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  auth: vi.fn(),
  demo: vi.fn(),
  rate: vi.fn(),
  overview: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.from }) }));
vi.mock("@/lib/supabase/auth", () => ({
  requireAuthenticatedUser: mocks.auth,
  AuthenticationError: class extends Error {},
  unauthorizedResponse: () => Response.json({ error: "Sign in" }, { status: 401 }),
}));
vi.mock("@/lib/env", () => ({ isDemoMode: mocks.demo }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock("@/lib/api-rate-limit", () => ({
  consumeSubjectApiRateLimit: mocks.rate,
  rateLimitJsonResponse: () => Response.json({}, { status: 429 }),
  allowRateLimitInMemoryFallbackOnUnavailable: () => false,
}));
vi.mock("@/lib/roster/team/repository", () => ({ rosterRead: mocks.overview }));

import { DELETE, GET, PATCH, POST } from "@/app/api/roster/leave/route";
import { PublicApiError } from "@/lib/http";

afterEach(() => vi.unstubAllEnvs());

it("serves example leave while the release is held, and never touches real leave", async () => {
  vi.stubEnv("NODE_ENV", "production");
  const response = await GET(new Request("http://x/api/roster/leave"));
  expect(response.status).toBe(200);
  const listed = await response.json();
  expect(listed.leave).toHaveLength(1);
  expect(listed.leave[0]).toMatchObject({ kind: "annual", status: "approved" });
  expect(response.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");

  const created = await POST(
    new Request("http://x/api/roster/leave", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "annual",
        startsOn: "2026-12-22",
        endsOn: "2027-01-02",
        status: "planned",
        serviceId: null,
      }),
    }),
  );
  expect(created.status).toBe(201);
  expect((await created.json()).leave).toMatchObject({ startsOn: "2026-12-22", status: "planned" });
  expect(mocks.from).not.toHaveBeenCalled();

  mocks.auth.mockRejectedValueOnce(new (await import("@/lib/supabase/auth")).AuthenticationError());
  expect((await GET(new Request("http://x/api/roster/leave"))).status).toBe(401);
});

const ME = "5e000000-0000-4000-8000-000000000001";
const OTHER = "5e000000-0000-4000-8000-000000000002";
const SERVICE = "5e000000-0000-4000-8000-000000000003";
const LEAVE = "5e000000-0000-4000-8000-000000000004";
const row = {
  id: LEAVE,
  owner_id: ME,
  service_id: SERVICE,
  kind: "annual",
  starts_on: "2026-12-22",
  ends_on: "2027-01-02",
  status: "planned",
};
const body = { kind: "annual", startsOn: "2026-12-22", endsOn: "2027-01-02", status: "planned", serviceId: SERVICE };

type Query = {
  op: string;
  filters: [string, unknown][];
  inserted?: unknown;
  updated?: unknown;
  select: (columns: string) => Query;
  eq: (name: string, value: unknown) => Query;
  gte: (name: string, value: unknown) => Query;
  order: () => Query;
  limit: () => Promise<{ data: unknown[]; error: null }>;
  insert: (value: unknown) => Query;
  update: (value: unknown) => Query;
  delete: () => Query;
  single: () => Promise<{ data: typeof row; error: null }>;
  maybeSingle: () => Promise<{ data: typeof row | null; error: null }>;
};
const queries: Query[] = [];
let countRows: unknown[] = [];
let readRow: typeof row | null = row;

function query(): Query {
  const q = {
    op: "read",
    filters: [] as [string, unknown][],
    select: () => q,
    eq: (name: string, value: unknown) => {
      q.filters.push([name, value]);
      return q;
    },
    gte: (name: string, value: unknown) => {
      q.filters.push([name, value]);
      return q;
    },
    order: () => q,
    limit: async () => ({ data: countRows, error: null }),
    insert: (value: unknown) => {
      q.op = "insert";
      q.inserted = value;
      return q;
    },
    update: (value: unknown) => {
      q.op = "update";
      q.updated = value;
      return q;
    },
    delete: () => {
      q.op = "delete";
      return q;
    },
    single: async () => ({ data: row, error: null }),
    maybeSingle: async () => ({ data: readRow, error: null }),
  } as Query;
  queries.push(q);
  return q;
}

function request(method: string, value?: unknown) {
  return new Request("http://x/api/roster/leave", {
    method,
    headers: { "content-type": "application/json" },
    ...(value ? { body: JSON.stringify(value) } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  queries.length = 0;
  countRows = [];
  readRow = row;
  mocks.from.mockImplementation(query);
  mocks.auth.mockResolvedValue({ id: ME });
  mocks.demo.mockReturnValue(false);
  mocks.rate.mockResolvedValue({ limited: false });
  mocks.overview.mockResolvedValue({ service: { id: SERVICE } });
});

describe("my planned leave", () => {
  it("lists only the session owner's recent leave, with a private response", async () => {
    countRows = [row];
    const response = await GET(request("GET"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(queries[0]?.filters).toContainEqual(["owner_id", ME]);
    expect((await response.json()).leave[0]).toMatchObject({ id: LEAVE, startsOn: "2026-12-22" });
  });

  it("refuses a leave kind Roster does not hold before writing", async () => {
    const response = await POST(request("POST", { ...body, kind: "sick" }));
    expect(response.status).toBe(400);
    expect(queries).toHaveLength(0);
  });

  it("refuses an owner supplied by the caller before writing", async () => {
    const response = await POST(request("POST", { ...body, ownerId: OTHER }));
    expect(response.status).toBe(400);
    expect(queries).toHaveLength(0);
  });

  it("asks the SQL whether the session user can see the chosen team", async () => {
    mocks.overview.mockRejectedValueOnce(
      new PublicApiError("You're not in this team.", 403, { code: "roster_access_denied" }),
    );
    const response = await POST(request("POST", body));
    expect(response.status).toBe(403);
    expect(mocks.overview).toHaveBeenCalledWith(expect.anything(), ME, SERVICE, "overview");
    expect(queries).toHaveLength(0);
  });

  it("caps the owner at 50 rows and checks the complete date span", async () => {
    countRows = Array.from({ length: 50 }, (_, index) => ({ id: index }));
    expect((await POST(request("POST", body))).status).toBe(409);
    expect(queries.every((q) => q.op !== "insert")).toBe(true);
    queries.length = 0;
    expect((await POST(request("POST", { ...body, endsOn: "2026-12-21" }))).status).toBe(400);
    expect(queries).toHaveLength(0);
  });

  it("writes only the session owner and filters updates and deletion by that owner", async () => {
    expect((await POST(request("POST", body))).status).toBe(201);
    expect(queries.find((q) => q.op === "insert")?.inserted).toMatchObject({ owner_id: ME, service_id: SERVICE });
    queries.length = 0;
    expect((await PATCH(request("PATCH", { id: LEAVE, status: "approved" }))).status).toBe(200);
    expect(queries).toHaveLength(2);
    expect(queries.every((q) => q.filters.some(([key, value]) => key === "owner_id" && value === ME))).toBe(true);
    queries.length = 0;
    expect((await DELETE(request("DELETE", { id: LEAVE }))).status).toBe(200);
    expect(queries[0]?.filters).toContainEqual(["owner_id", ME]);
  });
});
