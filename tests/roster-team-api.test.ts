import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Roster for a health service: the team API. The session is the only actor,
 * every body is strict, the SQL's errors become plain messages, and the
 * database's own text is never echoed. Every team and person here is invented.
 */

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  auth: vi.fn(),
  demo: vi.fn(),
  consumeSubjectApiRateLimit: vi.fn(),
  dispatch: vi.fn(),
  user: { id: "" },
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc, from: mocks.from }) }));
vi.mock("@/lib/supabase/auth", () => ({
  requireAuthenticatedUser: mocks.auth,
  AuthenticationError: class extends Error {},
  unauthorizedResponse: () => Response.json({ error: "Sign in" }, { status: 401 }),
}));
vi.mock("@/lib/env", () => ({ isDemoMode: mocks.demo }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/api-rate-limit", () => ({
  consumeSubjectApiRateLimit: mocks.consumeSubjectApiRateLimit,
  rateLimitJsonResponse: () => Response.json({}, { status: 429 }),
  allowRateLimitInMemoryFallbackOnUnavailable: () => false,
}));
vi.mock("@/lib/roster/alerts/dispatch", () => ({ dispatchRosterAlerts: mocks.dispatch }));

import { GET as GET_TEAMS } from "@/app/api/roster/team/route";
import { GET, POST } from "@/app/api/roster/team/[serviceId]/route";

const SERVICE = "5e000000-0000-4000-8000-000000000001";
const SWAP = "5e000000-0000-4000-8000-000000000002";
const OPEN = "5e000000-0000-4000-8000-000000000003";
const USER = "5e000000-0000-4000-8000-000000000004";
const ALEX = "5e000000-0000-4000-8000-0000000000a1";

const overviewFixture = {
  service: { id: SERVICE, name: "General Medicine" },
  me: { role: "member", grade: "registrar", rotationEndsOn: null },
  latestPublication: null,
  seenLatest: false,
  settings: { swapApproval: "auto_same_grade", rules: {}, rulesSource: null, payFortnightAnchor: null },
  sites: [],
};

function ctx(serviceId = SERVICE) {
  return { params: Promise.resolve({ serviceId }) };
}

function jsonRequest(body: unknown) {
  return new Request(`http://x/api/roster/team/${SERVICE}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function readRequest(query: string) {
  return new Request(`http://x/api/roster/team/${SERVICE}?${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { id: ALEX };
  mocks.demo.mockReturnValue(false);
  mocks.auth.mockImplementation(async () => mocks.user);
  mocks.consumeSubjectApiRateLimit.mockResolvedValue({ limited: false });
  mocks.rpc.mockResolvedValue({ data: overviewFixture, error: null });
  mocks.dispatch.mockResolvedValue(undefined);
});

afterEach(() => vi.unstubAllEnvs());

it("holds real staff team access in production until explicitly enabled", async () => {
  vi.stubEnv("NODE_ENV", "production");
  // Held: a signed-in reader sees the invented sample team, marked as a sample.
  const held = await GET_TEAMS(new Request("http://x/api/roster/team"));
  expect(held.status).toBe(200);
  const heldBody = await held.json();
  expect(heldBody).toMatchObject({ sample: true, actorId: "d0000000-0000-4000-8000-0000000000a1" });
  expect(heldBody.teams[0].name).toMatch(/^Example /);
  expect(mocks.auth).toHaveBeenCalledTimes(1);
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(held.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");

  // Held: a sample team read never touches the database.
  const heldRead = await GET(readRequest("what=overview"), ctx());
  expect(heldRead.status).toBe(200);
  expect(mocks.rpc).not.toHaveBeenCalled();

  // Held: a team action gets an example receipt; nothing reaches the database and no alert is sent.
  const heldWrite = await POST(jsonRequest({ action: "swap.approve", swapId: SWAP }), ctx());
  expect(heldWrite.status).toBe(200);
  expect(await heldWrite.json()).toEqual({ result: { ok: true, swapId: SWAP, status: "approved" } });
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.dispatch).not.toHaveBeenCalled();

  // Held: a malformed action is still refused before any answer.
  const badWrite = await POST(jsonRequest({ action: "leave.request", from: "2026-10-01" }), ctx());
  expect(badWrite.status).toBe(400);

  // Held: a signed-out reader is asked to sign in, not shown the sample.
  mocks.auth.mockRejectedValueOnce(new (await import("@/lib/supabase/auth")).AuthenticationError());
  expect((await GET_TEAMS(new Request("http://x/api/roster/team"))).status).toBe(401);

  vi.stubEnv("ROSTER_TEAM_RELEASE_ENABLED", "true");
  mocks.rpc.mockResolvedValue({ data: { teams: [] }, error: null });
  expect((await GET_TEAMS(new Request("http://x/api/roster/team"))).status).toBe(200);
});

describe("reading a team", () => {
  it("reads a team as the signed-in user, never as anyone named in the request", async () => {
    const response = await GET(readRequest(`what=overview&actorId=${USER}&p_actor_id=${USER}`), ctx());
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("roster_read", {
      p_actor_id: ALEX,
      p_service_id: SERVICE,
      p_what: "overview",
      p_payload: {},
    });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("Vary")).toBe("Cookie, Authorization");
  });

  it("reads the team's current members through their own function, as the signed-in user", async () => {
    mocks.rpc.mockResolvedValue({
      data: { members: [{ userId: USER, name: "Dr Sam Example", grade: "registrar" }] },
      error: null,
    });
    const response = await GET(readRequest(`what=members&actorId=${USER}`), ctx());
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("roster_team_members", { p_actor_id: ALEX, p_service_id: SERVICE });
    expect(await response.json()).toEqual({ members: [{ userId: USER, name: "Dr Sam Example", grade: "registrar" }] });
  });

  it("lists my teams with no team named", async () => {
    mocks.rpc.mockResolvedValue({ data: { teams: [] }, error: null });
    const response = await GET_TEAMS(new Request("http://x/api/roster/team"));
    expect(await response.json()).toEqual({ teams: [], actorId: ALEX });
    expect(mocks.rpc).toHaveBeenCalledWith("roster_read", {
      p_actor_id: ALEX,
      p_service_id: null,
      p_what: "teams",
      p_payload: {},
    });
  });

  it("refuses an assignments window longer than 62 days before calling the database", async () => {
    expect((await GET(readRequest("what=assignments&from=2026-10-01&to=2026-12-15"), ctx())).status).toBe(400);
    expect((await GET(readRequest("what=assignments"), ctx())).status).toBe(400);
    expect((await GET(readRequest("what=draft"), ctx())).status).toBe(400);
    expect((await GET(readRequest("what=teams"), ctx())).status).toBe(400);
    expect((await GET(readRequest("what=overview"), ctx("not-a-team"))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("passes a 62-day window through", async () => {
    mocks.rpc.mockResolvedValue({ data: { assignments: [] }, error: null });
    await GET(readRequest("what=assignments&from=2026-10-01&to=2026-12-02"), ctx());
    expect(mocks.rpc).toHaveBeenCalledWith(
      "roster_read",
      expect.objectContaining({
        p_payload: { from: "2026-10-01", to: "2026-12-02" },
      }),
    );
  });

  it("fails closed when the answer has a shape the app doesn't know", async () => {
    mocks.rpc.mockResolvedValue({ data: { service: { id: SERVICE } }, error: null });
    const response = await GET(readRequest("what=overview"), ctx());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "roster_unavailable" });
  });

  it("uses the roster rate-limit bucket", async () => {
    await GET(readRequest("what=overview"), ctx());
    expect(mocks.consumeSubjectApiRateLimit).toHaveBeenCalledWith(expect.objectContaining({ bucket: "roster" }));
  });

  it("answers reads from the invented team in demo mode and refuses writes", async () => {
    mocks.demo.mockReturnValue(true);
    const read = await GET(readRequest("what=overview"), ctx());
    expect(read.status).toBe(200);
    expect(JSON.stringify(await read.json())).toContain("General Medicine");
    // The demo team list is marked as a sample, so every team screen labels it as made up.
    const teams = await GET_TEAMS(new Request("http://x/api/roster/team"));
    expect(teams.status).toBe(200);
    expect(await teams.json()).toMatchObject({ sample: true });
    const write = await POST(jsonRequest({ action: "swap.cancel", swapId: SWAP }), ctx());
    expect(write.status).toBe(400);
    expect(await write.json()).toMatchObject({ code: "demo_mode_unavailable" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("writing to a team", () => {
  it("sends the action as the session user, without the action name in the payload", async () => {
    mocks.rpc.mockResolvedValue({ data: { swapId: SWAP, status: "cancelled" }, error: null });
    const response = await POST(jsonRequest({ action: "swap.cancel", swapId: SWAP }), ctx());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: { swapId: SWAP, status: "cancelled" } });
    expect(mocks.rpc).toHaveBeenCalledWith("roster_command", {
      p_actor_id: ALEX,
      p_service_id: SERVICE,
      p_action: "swap.cancel",
      p_payload: { swapId: SWAP },
    });
    await vi.waitFor(() => expect(mocks.dispatch).toHaveBeenCalledTimes(1));
    expect(mocks.dispatch.mock.calls[0][1]).toMatchObject({ serviceId: SERVICE, actorId: ALEX });
  });

  it("refuses a body that tries to name the actor", async () => {
    for (const extra of [{ actorId: USER }, { ownerId: USER }, { p_actor_id: USER }]) {
      const response = await POST(jsonRequest({ action: "swap.cancel", swapId: SWAP, ...extra }), ctx());
      expect(response.status).toBe(400);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses publish and Release 3 actions through the general route", async () => {
    for (const action of ["publish", "codes.set", "draft.open", "draft.change", "agreement.record"]) {
      expect((await POST(jsonRequest({ action }), ctx())).status).toBe(400);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("sends the team's safe number (needs.set) through the stale check, with exactly the keys the SQL reads", async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: true }, error: null });
    const needs = [
      { weekday: 1, date: null, kind: "day", grade: null, siteId: null, needed: 3 },
      { weekday: null, date: "2026-12-25", kind: "night", grade: "registrar", siteId: SWAP, needed: 1 },
    ];
    const response = await POST(jsonRequest({ action: "needs.set", expectedIds: [SWAP], needs }), ctx());
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("roster_needs_replace", {
      p_actor_id: ALEX,
      p_service_id: SERVICE,
      p_expected_ids: [SWAP],
      p_needs: needs,
    });
  });

  it("answers a safe number saved over a stale read with 409 roster_conflict", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "roster_conflict" } });
    const response = await POST(jsonRequest({ action: "needs.set", expectedIds: [], needs: [] }), ctx());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "roster_conflict" });
  });

  it("refuses a safe number the table would refuse, before the database is asked", async () => {
    const need = { weekday: 1, date: null, kind: "day", grade: null, siteId: null, needed: 2 };
    for (const bad of [
      {},
      // Every save names the needs it was built on, so a write can't skip the stale check.
      { needs: [need] },
      { expectedIds: ["not-an-id"], needs: [need] },
      { expectedIds: Array.from({ length: 2001 }, () => SWAP), needs: [need] },
      ...[
        { needs: [{ ...need, id: SWAP }] },
        { needs: [{ ...need, actorId: USER }] },
        { needs: [need], actorId: USER },
        { needs: [{ ...need, weekday: 0 }] },
        { needs: [{ ...need, weekday: 8 }] },
        { needs: [{ ...need, weekday: 1.5 }] },
        { needs: [{ ...need, date: "2026-10-12" }] },
        { needs: [{ ...need, weekday: null }] },
        { needs: [{ ...need, weekday: null, date: "2026-02-31" }] },
        { needs: [{ ...need, kind: "leave" }] },
        { needs: [{ ...need, grade: "other" }] },
        { needs: [{ ...need, siteId: "site" }] },
        { needs: [{ ...need, needed: -1 }] },
        { needs: [{ ...need, needed: 201 }] },
        { needs: [{ ...need, needed: 1.5 }] },
        { needs: Array.from({ length: 2001 }, () => need) },
      ].map((body) => ({ expectedIds: [], ...body })),
    ]) {
      expect((await POST(jsonRequest({ action: "needs.set", ...bad }), ctx())).status).toBe(400);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("answers the held example team's safe number with an example receipt, never the database", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = await POST(jsonRequest({ action: "needs.set", expectedIds: [], needs: [] }), ctx());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: { ok: true } });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("takes a gap or a shift for open.post, never both, and never a leave gap", async () => {
    const gap = {
      action: "open.post",
      startsAt: "2026-10-18T06:00:00.000Z",
      endsAt: "2026-10-18T14:30:00.000Z",
      shiftCode: "E",
      kind: "evening",
    };
    mocks.rpc.mockResolvedValue({ data: { openShiftId: OPEN, status: "open" }, error: null });
    expect((await POST(jsonRequest(gap), ctx())).status).toBe(200);
    expect((await POST(jsonRequest({ ...gap, assignmentId: OPEN }), ctx())).status).toBe(400);
    expect((await POST(jsonRequest({ ...gap, kind: "leave" }), ctx())).status).toBe(400);
    expect((await POST(jsonRequest({ ...gap, minGrade: "other" }), ctx())).status).toBe(400);
    expect((await POST(jsonRequest({ action: "open.post" }), ctx())).status).toBe(400);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("needs all four team settings, because the SQL overwrites all four", async () => {
    const response = await POST(jsonRequest({ action: "settings.set", swapApproval: "manager" }), ctx());
    expect(response.status).toBe(400);
    const unknownRule = await POST(
      jsonRequest({
        action: "settings.set",
        swapApproval: "manager",
        rules: { minBreakHours: 10, maxPatients: 3 },
        rulesSource: null,
        payFortnightAnchor: null,
      }),
      ctx(),
    );
    expect(unknownRule.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("maps every SQL error code to a plain message and never echoes the database text", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "roster_open_shift_taken", code: "P0001" } });
    const taken = await POST(jsonRequest({ action: "open.claim", openShiftId: OPEN }), ctx());
    expect(taken.status).toBe(409);
    expect(await taken.json()).toMatchObject({
      code: "roster_open_shift_taken",
      message: "Someone else took this shift first.",
    });

    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        message: 'duplicate key value violates unique constraint "roster_member_roles_roster_name_idx"',
        code: "23505",
      },
    });
    const duplicate = await POST(jsonRequest({ action: "role.set", userId: USER, rosterName: "A Example" }), ctx());
    expect(duplicate.status).toBe(409);
    const body = JSON.stringify(await duplicate.json());
    expect(body).toContain("roster_duplicate");
    expect(body).not.toContain("roster_member_roles");

    const cases: [string, string | null, number, string][] = [
      ["roster_access_denied", "P0001", 403, "roster_access_denied"],
      ["roster_team_not_verified", "P0001", 403, "roster_team_not_verified"],
      ["roster_role_denied", "P0001", 403, "roster_role_denied"],
      ["roster_not_found", "P0001", 404, "roster_not_found"],
      ["roster_limit", "P0001", 409, "roster_limit"],
      ["roster_conflict", "P0001", 409, "roster_conflict"],
      ["roster_request_exists", "P0001", 409, "roster_request_exists"],
      ["roster_swap_not_eligible", "P0001", 409, "roster_swap_not_eligible"],
      ["invalid input syntax for type uuid", "22P02", 400, "roster_invalid_request"],
      ["new row violates check constraint", "23514", 400, "roster_invalid_request"],
      ["could not connect to server", null, 503, "roster_unavailable"],
    ];
    for (const [message, code, status, publicCode] of cases) {
      mocks.rpc.mockResolvedValue({ data: null, error: { message, code } });
      const response = await POST(jsonRequest({ action: "swap.cancel", swapId: SWAP }), ctx());
      expect(response.status).toBe(status);
      const payload = await response.json();
      expect(payload.code).toBe(publicCode);
      expect(JSON.stringify(payload)).not.toMatch(/constraint|syntax|connect/);
    }
  });

  it("reads the claimer before an open-shift decline, and still declines if that read fails", async () => {
    mocks.rpc.mockImplementation(async (name: string) =>
      name === "roster_read"
        ? {
            data: {
              swaps: [],
              openShifts: [
                {
                  id: OPEN,
                  status: "claimed",
                  urgent: false,
                  startsAt: "2026-10-20T13:30:00+00:00",
                  endsAt: "2026-10-21T00:00:00+00:00",
                  shiftCode: "N",
                  kind: "night",
                  minGrade: "resident",
                  siteId: null,
                  postedBy: ALEX,
                  claimedBy: USER,
                  claimedAt: "2026-10-01T00:00:00+00:00",
                },
              ],
              seen: null,
            },
            error: null,
          }
        : { data: { openShiftId: OPEN, status: "open" }, error: null },
    );
    await POST(jsonRequest({ action: "open.decline", openShiftId: OPEN }), ctx());
    await vi.waitFor(() => expect(mocks.dispatch).toHaveBeenCalled());
    expect(mocks.dispatch.mock.calls[0][1].before).toEqual({ claimedBy: USER });

    mocks.dispatch.mockClear();
    mocks.rpc.mockImplementation(async (name: string) =>
      name === "roster_read"
        ? { data: null, error: { message: "roster_role_denied", code: "P0001" } }
        : { data: { openShiftId: OPEN, status: "open" }, error: null },
    );
    expect((await POST(jsonRequest({ action: "open.decline", openShiftId: OPEN }), ctx())).status).toBe(200);
    await vi.waitFor(() => expect(mocks.dispatch).toHaveBeenCalled());
    expect(mocks.dispatch.mock.calls[0][1].before).toBeUndefined();
  });

  it("keeps the saved change when an alert fails", async () => {
    mocks.rpc.mockResolvedValue({ data: { swapId: SWAP, status: "requested" }, error: null });
    mocks.dispatch.mockRejectedValue(new Error("push service down"));
    const response = await POST(
      jsonRequest({ action: "swap.create", giveAssignmentId: SWAP, counterpartyId: USER }),
      ctx(),
    );
    expect(response.status).toBe(200);
  });
});
