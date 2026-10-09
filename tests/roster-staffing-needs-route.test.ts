import { beforeEach, expect, it, vi } from "vitest";

/**
 * The member-safe staffing-needs read: the team's safe number for its doctors.
 * The admin client is faked per table, so these tests pin who may read it, in
 * which order the checks run, and that only counts (never ids or names) leave.
 */

const SERVICE = "5e000000-0000-4000-8000-000000000001";
const ACTOR = "5e000000-0000-4000-8000-000000000002";
const OTHER = "5e000000-0000-4000-8000-000000000009";

type Result = { data: unknown; error: unknown };

const mocks = vi.hoisted(() => {
  class AuthenticationError extends Error {}
  return {
    AuthenticationError,
    auth: vi.fn(),
    rpc: vi.fn(),
    rate: vi.fn(),
    demo: false,
    calls: [] as { table: string; method: string; args: unknown[] }[],
    tables: {} as Record<string, { data: unknown; error: unknown }>,
  };
});

function chain(table: string, result: Result) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "order", "limit"])
    builder[method] = (...args: unknown[]) => {
      mocks.calls.push({ table, method, args });
      return builder;
    };
  builder.maybeSingle = async () => result;
  builder.then = (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      mocks.calls.push({ table, method: "from", args: [] });
      return chain(table, mocks.tables[table] ?? { data: null, error: { message: "unexpected table" } });
    },
    rpc: (...args: unknown[]) => {
      mocks.calls.push({ table: "rpc", method: String(args[0]), args });
      return mocks.rpc(...args);
    },
  }),
}));
vi.mock("@/lib/supabase/auth", () => ({
  requireAuthenticatedUser: mocks.auth,
  AuthenticationError: mocks.AuthenticationError,
  unauthorizedResponse: () => Response.json({}, { status: 401 }),
}));
vi.mock("@/lib/env", () => ({ isDemoMode: () => mocks.demo }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/api-rate-limit", () => ({
  consumeSubjectApiRateLimit: mocks.rate,
  rateLimitJsonResponse: () => Response.json({}, { status: 429 }),
  allowRateLimitInMemoryFallbackOnUnavailable: () => false,
}));

import { GET } from "@/app/api/roster/team/[serviceId]/staffing-needs/route";

const context = (serviceId = SERVICE) => ({ params: Promise.resolve({ serviceId }) });
const request = (query = "") =>
  new Request(`https://example.org/api/roster/team/${SERVICE}/staffing-needs${query ? `?${query}` : ""}`);
const queried = (table: string) => mocks.calls.some((call) => call.table === table);

const overview = {
  service: { id: SERVICE, name: "Example team" },
  me: { role: "member", grade: "registrar", rotationEndsOn: null },
  latestPublication: null,
  seenLatest: true,
  settings: { swapApproval: "manager", rules: {}, rulesSource: null, payFortnightAnchor: null },
  sites: [],
};

const needRow = {
  weekday: 5,
  on_date: null,
  kind: "day",
  grade: null,
  site_id: null,
  needed: 4,
};

beforeEach(() => {
  mocks.calls.length = 0;
  mocks.demo = false;
  mocks.auth.mockReset().mockResolvedValue({ id: ACTOR });
  mocks.rate.mockReset().mockResolvedValue({ limited: false });
  mocks.rpc.mockReset().mockResolvedValue({ data: overview, error: null });
  mocks.tables = {
    roster_staffing_needs: {
      data: [needRow, { ...needRow, weekday: null, on_date: "2026-12-25", kind: "evening", grade: "registrar" }],
      error: null,
    },
  };
});

it("gives an active member of a confirmed team the needs only: no ids, no names, private and uncached", async () => {
  const response = await GET(request(), context());
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toContain("private, no-store");
  expect(await response.json()).toEqual({
    needs: [
      { weekday: 5, date: null, kind: "day", grade: null, siteId: null, needed: 4 },
      { weekday: null, date: "2026-12-25", kind: "evening", grade: "registrar", siteId: null, needed: 4 },
    ],
  });
  // Membership is the roster_read check, for the session actor and this team.
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  expect(mocks.rpc).toHaveBeenCalledWith("roster_read", {
    p_actor_id: ACTOR,
    p_service_id: SERVICE,
    p_what: "overview",
    p_payload: {},
  });
  // The needs are read for this team only, after the membership check, and never select ids.
  const order = mocks.calls
    .filter((call) => call.method === "from" || call.table === "rpc")
    .map((call) => (call.table === "rpc" ? call.method : call.table));
  expect(order).toEqual(["roster_read", "roster_staffing_needs"]);
  expect(mocks.calls).toContainEqual({ table: "roster_staffing_needs", method: "eq", args: ["service_id", SERVICE] });
  const select = mocks.calls.find((call) => call.table === "roster_staffing_needs" && call.method === "select")!;
  expect(String(select.args[0])).not.toMatch(/\bid\b|user|name/);
  expect(mocks.rate).toHaveBeenCalledWith(expect.objectContaining({ bucket: "roster" }));
});

it("refuses someone who is not an active member before any need is read", async () => {
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "roster_access_denied" } });
  const response = await GET(request(), context());
  expect(response.status).toBe(403);
  expect((await response.json()).code).toBe("roster_access_denied");
  expect(queried("roster_staffing_needs")).toBe(false);
});

it("refuses a team that hasn't been confirmed yet", async () => {
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "roster_team_not_verified" } });
  const response = await GET(request(), context());
  expect(response.status).toBe(403);
  expect((await response.json()).code).toBe("roster_team_not_verified");
  expect(queried("roster_staffing_needs")).toBe(false);
});

it("refuses any query string, so no parameter can name another actor or team", async () => {
  for (const query of [`actorId=${OTHER}`, `serviceId=${OTHER}`, "what=maker"]) {
    expect((await GET(request(query), context())).status).toBe(400);
  }
  expect((await GET(request(), context("not-a-team"))).status).toBe(400);
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.calls).toHaveLength(0);
});

it("signed out gets 401 and a rate-limited reader gets 429, both before any table is read", async () => {
  mocks.auth.mockRejectedValueOnce(new mocks.AuthenticationError());
  expect((await GET(request(), context())).status).toBe(401);
  mocks.rate.mockResolvedValueOnce({ limited: true });
  expect((await GET(request(), context())).status).toBe(429);
  expect(mocks.calls).toHaveLength(0);
});

it("a failed read fails closed with 503 and no needs", async () => {
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
  const first = await GET(request(), context());
  expect(first.status).toBe(503);
  expect(queried("roster_staffing_needs")).toBe(false);
  mocks.tables.roster_staffing_needs = { data: null, error: { message: "boom" } };
  const second = await GET(request(), context());
  expect(second.status).toBe(503);
  expect(JSON.stringify(await second.json())).not.toContain("boom");
});

it("in demo mode answers the invented team's weekday needs without reading a table", async () => {
  mocks.demo = true;
  const response = await GET(request(), context());
  expect(response.status).toBe(200);
  const body = (await response.json()) as { needs: Record<string, unknown>[] };
  expect(body.needs.length).toBeGreaterThan(0);
  for (const need of body.needs) {
    expect(Object.keys(need).sort()).toEqual(["date", "grade", "kind", "needed", "siteId", "weekday"]);
    expect(need.weekday).toBeGreaterThanOrEqual(1);
    expect(need.weekday).toBeLessThanOrEqual(5);
  }
  expect(body.needs.filter((need) => need.kind === "day").every((need) => need.needed === 2)).toBe(true);
  expect(mocks.calls).toHaveLength(0);
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.auth).not.toHaveBeenCalled();
});
