import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The rotation rounds API, offline: an in-memory stand-in for the service-role
 * client answers the few table reads and writes the repository makes, so every
 * access rule is exercised without a database.
 */

const SERVICE = "7a000000-0000-4000-8000-000000000001";
const MANAGER = "7a000000-0000-4000-8000-000000000002";
const DOCTOR = "7a000000-0000-4000-8000-000000000003";
const OUTSIDER = "7a000000-0000-4000-8000-000000000004";
const SITE_ADMIN = "7a000000-0000-4000-8000-000000000005";
const ROUND = "7a000000-0000-4000-8000-0000000000aa";

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  demo: vi.fn(),
  release: vi.fn(),
  rate: vi.fn(),
  state: {
    tables: {} as Record<string, Record<string, unknown>[]>,
    missing: false,
    clock: 0,
    beforeUpdate: null as null | (() => void),
    /** Runs right after a preference upsert lands, to stand in for an administrator acting mid-request. */
    afterUpsert: null as null | (() => void),
    /** How many preference updates or deletes fail before they start working again. */
    failPreferenceWrites: 0,
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (work: () => unknown) => void work() };
});
vi.mock("@/lib/env", () => ({ isDemoMode: mocks.demo }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/roster/team/release", () => ({ rosterTeamReleaseEnabled: mocks.release }));
vi.mock("@/lib/api-rate-limit", () => ({
  consumeSubjectApiRateLimit: mocks.rate,
  rateLimitJsonResponse: () => Response.json({}, { status: 429 }),
  allowRateLimitInMemoryFallbackOnUnavailable: () => false,
}));
vi.mock("@/lib/supabase/auth", () => {
  class AuthenticationError extends Error {}
  return {
    requireAuthenticatedUser: mocks.auth,
    AuthenticationError,
    unauthorizedResponse: () => Response.json({ error: "Sign in" }, { status: 401 }),
  };
});
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fakeClient() }));

// ---------------------------------------------------------------- in-memory client

function tick(): string {
  mocks.state.clock += 1;
  return new Date(Date.UTC(2026, 9, 9, 0, 0, mocks.state.clock)).toISOString();
}

function fakeClient() {
  const tables = mocks.state.tables as Tables;
  const missing = () => ({ data: null, error: { code: "PGRST205", message: "not in schema cache" } });
  const rotationTable = (table: string) => table.startsWith("roster_rotation_");
  return {
    auth: {
      admin: {
        getUserById: async (id: string) => ({
          data: { user: { id, app_metadata: id === SITE_ADMIN ? { site_role: "administrator" } : {} } },
          error: null,
        }),
      },
    },
    async rpc(name: string, args: { p_service_id: string; p_user_id: string }) {
      const active = (tables.on_call_service_members ?? []).some(
        (m) => m.service_id === args.p_service_id && m.user_id === args.p_user_id && m.revoked_at === null,
      );
      if (name === "service_member_active") return { data: active, error: null };
      if (name === "roster_rotation_can_manage") {
        if (mocks.state.missing) return { data: null, error: { code: "PGRST202", message: "no function" } };
        const manager = (tables.roster_member_roles ?? []).some(
          (r) =>
            r.service_id === args.p_service_id && r.user_id === args.p_user_id && r.role === "manager" && !r.revoked_at,
        );
        return { data: active && manager, error: null };
      }
      throw new Error(`Unexpected rpc ${name}`);
    },
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      let op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
      let payload: Row = {};
      let single = false;
      let returning = false;
      const builder = {
        select() {
          if (op !== "select") returning = true;
          return builder;
        },
        insert(row: Row) {
          op = "insert";
          payload = row;
          return builder;
        },
        update(patch: Row) {
          op = "update";
          payload = patch;
          return builder;
        },
        upsert(row: Row) {
          op = "upsert";
          payload = row;
          return builder;
        },
        delete() {
          op = "delete";
          return builder;
        },
        eq(column: string, value: unknown) {
          filters.push((row) => row[column] === value);
          return builder;
        },
        is(column: string, value: unknown) {
          filters.push((row) => (row[column] ?? null) === value);
          return builder;
        },
        in(column: string, values: unknown[]) {
          filters.push((row) => values.includes(row[column]));
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        maybeSingle() {
          single = true;
          return builder;
        },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          return Promise.resolve(run()).then(resolve, reject);
        },
      };
      const run = () => {
        if (rotationTable(table) && mocks.state.missing) return missing();
        const rows = (tables[table] ??= []);
        const match = (row: Row) => filters.every((filter) => filter(row));
        if (op === "insert") {
          rows.push({ updated_at: tick(), ...payload });
          return { data: null, error: null };
        }
        if (op === "upsert") {
          const existing = rows.find((row) => row.round_id === payload.round_id && row.user_id === payload.user_id);
          if (existing) Object.assign(existing, payload);
          else rows.push({ ...payload });
          mocks.state.afterUpsert?.();
          return { data: null, error: null };
        }
        if (
          (op === "update" || op === "delete") &&
          table === "roster_rotation_preferences" &&
          mocks.state.failPreferenceWrites > 0
        ) {
          mocks.state.failPreferenceWrites -= 1;
          return { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };
        }
        if (op === "update") {
          mocks.state.beforeUpdate?.();
          const hit = rows.filter(match);
          for (const row of hit)
            Object.assign(row, payload, table === "roster_rotation_rounds" ? { updated_at: tick() } : {});
          return { data: returning ? hit.map((row) => ({ id: row.id })) : null, error: null };
        }
        if (op === "delete") {
          const hit = rows.filter(match);
          tables[table] = rows.filter((row) => !match(row));
          return { data: returning ? hit.map((row) => ({ id: row.id })) : null, error: null };
        }
        const hit = rows.filter(match).map((row) => ({ ...row }));
        return { data: single ? (hit[0] ?? null) : hit, error: null };
      };
      return builder;
    },
  };
}

// ---------------------------------------------------------------- fixtures

import { GET, POST as CREATE } from "@/app/api/roster/rotations/route";
import { POST } from "@/app/api/roster/rotations/[roundId]/route";
import type { RoundSetup } from "@/lib/roster/rotations/model";

function setup(overrides: Partial<RoundSetup> = {}): RoundSetup {
  return {
    name: "2027 registrar rotations",
    closesAt: "2026-12-01T08:00:00+08:00",
    minRanked: 2,
    terms: [
      { id: "t1", label: "Term 1", start: "2027-02-01", end: "2027-04-30" },
      { id: "t2", label: "Term 2", start: "2027-05-01", end: "2027-07-31" },
    ],
    rotations: [
      { id: "cl", name: "Consultation liaison", site: "Example Hospital", places: 1 },
      { id: "ad", name: "Adult inpatient", site: "Example Health Campus", places: 1 },
    ],
    people: [
      { id: MANAGER, name: "Dr Alex Jarrah", grade: "Registrar" },
      { id: DOCTOR, name: "Dr Sam Karri", grade: "Registrar" },
    ],
    ...overrides,
  };
}

function roundRow(status: string, extra: Row = {}): Row {
  return {
    id: ROUND,
    service_id: SERVICE,
    status,
    setup: setup(),
    locks: [],
    allocation: null,
    admin_name: "Dr Alex Jarrah",
    version: 1,
    created_by: MANAGER,
    created_at: "2026-10-01T00:00:00.000Z",
    opened_at: status === "draft" ? null : "2026-10-02T00:00:00.000Z",
    published_at: null,
    updated_at: "2026-10-02T00:00:00.000Z",
    ...extra,
  };
}

function seed(rounds: Row[] = [roundRow("open")]) {
  mocks.state.tables = {
    on_call_services: [
      { id: SERVICE, name: "Psychiatry registrars", verified_at: "2026-09-30T00:00:00Z", is_demo: false },
    ],
    on_call_service_members: [
      { service_id: SERVICE, user_id: MANAGER, display_name: "Alex", revoked_at: null },
      { service_id: SERVICE, user_id: DOCTOR, display_name: "Sam", revoked_at: null },
    ],
    roster_member_roles: [
      {
        service_id: SERVICE,
        user_id: MANAGER,
        role: "manager",
        roster_name: "Dr Alex Jarrah",
        grade: "registrar",
        revoked_at: null,
      },
      {
        service_id: SERVICE,
        user_id: DOCTOR,
        role: "member",
        roster_name: "Dr Sam Karri",
        grade: "registrar",
        revoked_at: null,
      },
    ],
    roster_rotation_rounds: rounds,
    roster_rotation_preferences: [],
  };
}

const context = (roundId = ROUND) => ({ params: Promise.resolve({ roundId }) });
const as = (id: string) => mocks.auth.mockResolvedValue({ id, appMetadata: {} });

function post(body: unknown, url = `https://example.org/api/roster/rotations/${ROUND}`) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const get = () => new Request("https://example.org/api/roster/rotations");
const rounds = () => mocks.state.tables.roster_rotation_rounds;
const preferences = () => mocks.state.tables.roster_rotation_preferences;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-09T02:00:00Z"));
  mocks.demo.mockReturnValue(false);
  mocks.release.mockReturnValue(true);
  mocks.rate.mockResolvedValue({ limited: false });
  mocks.state.missing = false;
  mocks.state.clock = 0;
  mocks.state.beforeUpdate = null;
  mocks.state.afterUpsert = null;
  mocks.state.failPreferenceWrites = 0;
  as(DOCTOR);
  seed();
});

// ---------------------------------------------------------------- tests

describe("rotation rounds API: access", () => {
  it("needs a signed-in session, and never caches the answer", async () => {
    const { AuthenticationError } = await import("@/lib/supabase/auth");
    mocks.auth.mockRejectedValue(new AuthenticationError("no session"));
    const read = await GET(get());
    expect(read.status).toBe(401);
    expect(read.headers.get("Cache-Control")).toContain("no-store");
    expect((await POST(post({ action: "open" }), context())).status).toBe(401);
    expect(rounds()[0].status).toBe("open");
  });

  it("shows a doctor their own round and nothing they run", async () => {
    const response = await GET(get());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.canManage).toBe(false);
    expect(body.managed).toEqual([]);
    expect(body.team).toBeNull();
    expect(body.mine).toHaveLength(1);
    expect(body.mine[0].personId).toBe(DOCTOR);
    expect(body.mine[0].round.teamName).toBe("Psychiatry registrars");
  });

  it("keeps draft rounds and other teams' rounds away from a doctor", async () => {
    seed([roundRow("draft")]);
    expect((await (await GET(get())).json()).mine).toEqual([]);
    as(OUTSIDER);
    seed();
    const body = await (await GET(get())).json();
    expect(body).toMatchObject({ mine: [], managed: [], canManage: false, team: null });
    expect(
      (await POST(post({ action: "save-preference", ranking: ["cl", "ad"], submit: true }), context())).status,
    ).toBe(404);
  });

  it("gives the manager every round in their team, its preferences and the team's people", async () => {
    preferences().push({
      round_id: ROUND,
      user_id: DOCTOR,
      ranking: ["ad", "cl"],
      submitted_at: "2026-10-05T00:00:00Z",
      updated_at: "2026-10-05T00:00:00Z",
    });
    as(MANAGER);
    const body = await (await GET(get())).json();
    expect(body.canManage).toBe(true);
    expect(body.managed).toHaveLength(1);
    expect(body.managed[0].preferences).toEqual([
      {
        personId: DOCTOR,
        ranking: ["ad", "cl"],
        submittedAt: "2026-10-05T00:00:00Z",
        updatedAt: "2026-10-05T00:00:00Z",
      },
    ]);
    expect(body.team).toMatchObject({ serviceId: SERVICE, name: "Psychiatry registrars" });
    expect(body.team.people).toEqual([
      { id: MANAGER, name: "Dr Alex Jarrah", grade: "Registrar" },
      { id: DOCTOR, name: "Dr Sam Karri", grade: "Registrar" },
    ]);
  });

  it("refuses every administrator action to a doctor who does not run the round", async () => {
    for (const body of [
      { action: "close" },
      { action: "allocate" },
      { action: "publish" },
      { action: "delete" },
      { action: "edit", setup: setup() },
      { action: "lock", personId: DOCTOR, termId: "t1", lock: true },
    ]) {
      const response = await POST(post(body), context());
      expect(response.status, body.action).toBe(403);
      expect((await response.json()).error).toBe("Only the team's rotation administrator can do that.");
    }
    expect(rounds()[0]).toMatchObject({ status: "open", allocation: null });
  });

  it("lets the site administrator run any team's round", async () => {
    as(SITE_ADMIN);
    const body = await (await GET(get())).json();
    expect(body.canManage).toBe(true);
    expect(body.managed).toHaveLength(1);
    expect((await POST(post({ action: "close" }), context())).status).toBe(200);
    expect(rounds()[0].status).toBe("closed");
  });
});

describe("rotation rounds API: a doctor's own preference", () => {
  it("saves the session user's ranking, and only theirs", async () => {
    const response = await POST(post({ action: "save-preference", ranking: ["ad", "cl"], submit: true }), context());
    expect(response.status).toBe(200);
    expect(preferences()).toEqual([
      expect.objectContaining({
        round_id: ROUND,
        user_id: DOCTOR,
        ranking: ["ad", "cl"],
        submitted_at: expect.any(String),
      }),
    ]);
  });

  it("refuses a body that names another person", async () => {
    for (const extra of [{ personId: MANAGER }, { actorId: MANAGER }, { user_id: MANAGER }]) {
      const response = await POST(
        post({ action: "save-preference", ranking: ["cl"], submit: false, ...extra }),
        context(),
      );
      expect(response.status).toBe(400);
    }
    expect(preferences()).toEqual([]);
  });

  it("withdraws a sent preference back to a draft", async () => {
    preferences().push({
      round_id: ROUND,
      user_id: DOCTOR,
      ranking: ["ad", "cl"],
      submitted_at: "2026-10-05T00:00:00Z",
      updated_at: "2026-10-05T00:00:00Z",
    });
    expect((await POST(post({ action: "withdraw-preference" }), context())).status).toBe(200);
    expect(preferences()[0]).toMatchObject({ ranking: ["ad", "cl"], submitted_at: null });
  });

  it("explains a broken rule in plain words: too few ranked is 400, a closed round is 409", async () => {
    const few = await POST(post({ action: "save-preference", ranking: ["cl"], submit: true }), context());
    expect(few.status).toBe(400);
    expect((await few.json()).error).toBe("Rank at least 2 rotations before sending.");
    seed([roundRow("closed")]);
    const closed = await POST(post({ action: "save-preference", ranking: ["cl", "ad"], submit: true }), context());
    expect(closed.status).toBe(409);
    expect((await closed.json()).error).toBe("This round is closed to changes.");
  });
});

describe("rotation rounds API: the administrator", () => {
  beforeEach(() => as(MANAGER));

  it("creates a draft round for their team", async () => {
    seed([]);
    const response = await CREATE(
      post({ action: "create", setup: setup() }, "https://example.org/api/roster/rotations"),
    );
    expect(response.status).toBe(200);
    const { roundId } = await response.json();
    expect(rounds()).toEqual([
      expect.objectContaining({
        id: roundId,
        service_id: SERVICE,
        status: "draft",
        admin_name: "Dr Alex Jarrah",
        created_by: MANAGER,
      }),
    ]);
  });

  it("refuses a new round naming someone outside the team", async () => {
    seed([]);
    const people = [...setup().people, { id: OUTSIDER, name: "Dr Jo Banksia" }];
    const response = await CREATE(
      post({ action: "create", setup: setup({ people }) }, "https://example.org/api/roster/rotations"),
    );
    expect(response.status).toBe(400);
    expect(rounds()).toEqual([]);
  });

  it("refuses a round to someone who runs no team", async () => {
    as(DOCTOR);
    seed([]);
    const response = await CREATE(
      post({ action: "create", setup: setup() }, "https://example.org/api/roster/rotations"),
    );
    expect(response.status).toBe(403);
  });

  it("allocates, then publishes, and the doctor sees their placements", async () => {
    preferences().push(
      {
        round_id: ROUND,
        user_id: DOCTOR,
        ranking: ["cl", "ad"],
        submitted_at: "2026-10-05T00:00:00Z",
        updated_at: "2026-10-05T00:00:00Z",
      },
      {
        round_id: ROUND,
        user_id: MANAGER,
        ranking: ["cl", "ad"],
        submitted_at: "2026-10-05T00:00:00Z",
        updated_at: "2026-10-05T00:00:00Z",
      },
    );
    expect((await POST(post({ action: "allocate" }), context())).status).toBe(200);
    expect(rounds()[0].status).toBe("closed");
    expect((rounds()[0].allocation as { placements: unknown[] }).placements).toHaveLength(4);
    expect((await POST(post({ action: "publish" }), context())).status).toBe(200);
    expect(rounds()[0]).toMatchObject({ status: "published", version: 2 });

    as(DOCTOR);
    const mine = (await (await GET(get())).json()).mine[0];
    expect(mine.placements).toHaveLength(2);
    expect(mine.placements.every((p: { personId: string }) => p.personId === DOCTOR)).toBe(true);
  });

  it("answers 409 when someone else changed the round first", async () => {
    mocks.state.beforeUpdate = () => {
      rounds()[0].updated_at = "2026-10-08T23:59:59.000Z";
    };
    const response = await POST(post({ action: "close" }), context());
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("Someone else changed this round. Reload and try again.");
  });

  it("deletes only a draft round", async () => {
    const open = await POST(post({ action: "delete" }), context());
    expect(open.status).toBe(409);
    seed([roundRow("draft")]);
    expect((await POST(post({ action: "delete" }), context())).status).toBe(200);
    expect(rounds()).toEqual([]);
  });

  it("removes a person's preference when the edit takes them out of the round", async () => {
    preferences().push({
      round_id: ROUND,
      user_id: DOCTOR,
      ranking: ["cl"],
      submitted_at: null,
      updated_at: "2026-10-05T00:00:00Z",
    });
    const people = [setup().people[0]];
    expect((await POST(post({ action: "edit", setup: setup({ people }) }), context())).status).toBe(200);
    expect(preferences()).toEqual([]);
    expect((rounds()[0].setup as RoundSetup).people).toEqual(people);
  });
});

describe("rotation rounds API: what the server trusts", () => {
  beforeEach(() => as(MANAGER));

  it("takes people's names and grades from the team, never from the request", async () => {
    seed([]);
    const people = [
      { id: MANAGER, name: "Dr Alex Jarrah", grade: "Registrar" },
      { id: DOCTOR, name: "Someone else entirely", grade: "Professor" },
    ];
    const response = await CREATE(
      post({ action: "create", setup: setup({ people }) }, "https://example.org/api/roster/rotations"),
    );
    expect(response.status).toBe(200);
    expect((rounds()[0].setup as RoundSetup).people).toEqual([
      { id: MANAGER, name: "Dr Alex Jarrah", grade: "Registrar" },
      { id: DOCTOR, name: "Dr Sam Karri", grade: "Registrar" },
    ]);
  });

  it("keeps the round's name for someone already in it who has since left the team", async () => {
    mocks.state.tables.on_call_service_members = mocks.state.tables.on_call_service_members.map((member) =>
      member.user_id === DOCTOR ? { ...member, revoked_at: "2026-10-08T00:00:00Z" } : member,
    );
    const people = [setup().people[0], { id: DOCTOR, name: "Renamed by the request" }];
    expect((await POST(post({ action: "edit", setup: setup({ people }) }), context())).status).toBe(200);
    expect((rounds()[0].setup as RoundSetup).people[1]).toEqual({
      id: DOCTOR,
      name: "Dr Sam Karri",
      grade: "Registrar",
    });
  });

  it("refuses ids with line breaks or spaces, which would reach the calendar file", async () => {
    seed([]);
    const terms = [{ id: "t1\r\nBEGIN:VALARM", label: "Term 1", start: "2027-02-01", end: "2027-04-30" }];
    const response = await CREATE(
      post({ action: "create", setup: setup({ terms }) }, "https://example.org/api/roster/rotations"),
    );
    expect(response.status).toBe(400);
    expect(rounds()).toEqual([]);
    as(DOCTOR);
    seed();
    expect((await POST(post({ action: "save-preference", ranking: ["cl x"], submit: false }), context())).status).toBe(
      400,
    );
  });

  it("will not publish a round that is open again, since its allocation may no longer fit", async () => {
    seed([
      roundRow("open", {
        allocation: { runAt: "2026-10-08T00:00:00Z", placements: [], unfilled: [], summary: {}, problems: [] },
      }),
    ]);
    const response = await POST(post({ action: "publish" }), context());
    expect(response.status).toBe(409);
    expect(rounds()[0].status).toBe("open");
  });
});

describe("rotation rounds API: changes that cross mid-request", () => {
  const closeTheRound = () => {
    rounds()[0].status = "closed";
    rounds()[0].updated_at = "2026-10-09T01:59:59.000Z";
  };

  it("puts a doctor's ranking back when the administrator closed the round while it was saving", async () => {
    preferences().push({
      round_id: ROUND,
      user_id: DOCTOR,
      ranking: ["ad"],
      submitted_at: null,
      updated_at: "2026-10-05T00:00:00.000Z",
    });
    mocks.state.afterUpsert = closeTheRound;
    const response = await POST(post({ action: "save-preference", ranking: ["cl", "ad"], submit: true }), context());
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("rotations_conflict");
    expect(preferences()).toEqual([
      { round_id: ROUND, user_id: DOCTOR, ranking: ["ad"], submitted_at: null, updated_at: "2026-10-05T00:00:00.000Z" },
    ]);
  });

  it("removes a first ranking that landed after the round was allocated", async () => {
    mocks.state.afterUpsert = closeTheRound;
    const response = await POST(post({ action: "save-preference", ranking: ["cl", "ad"], submit: true }), context());
    expect(response.status).toBe(409);
    expect(preferences()).toEqual([]);
  });

  it("keeps the ranking when nothing changed the round in between", async () => {
    const response = await POST(post({ action: "save-preference", ranking: ["cl", "ad"], submit: true }), context());
    expect(response.status).toBe(200);
    expect(preferences()).toEqual([expect.objectContaining({ user_id: DOCTOR, ranking: ["cl", "ad"] })]);
  });

  it("says when an edit saved but its tidy-up did not, reads correctly meanwhile, and finishes on a second save", async () => {
    as(MANAGER);
    preferences().push({
      round_id: ROUND,
      user_id: DOCTOR,
      ranking: ["cl", "ad"],
      submitted_at: "2026-10-05T00:00:00.000Z",
      updated_at: "2026-10-05T00:00:00.000Z",
    });
    const edit = { action: "edit", setup: setup({ people: [setup().people[0]] }) };
    mocks.state.failPreferenceWrites = 1;
    const first = await POST(post(edit), context());
    expect(first.status).toBe(503);
    expect((await first.json()).code).toBe("rotations_edit_incomplete");
    expect((rounds()[0].setup as RoundSetup).people).toHaveLength(1);
    expect(preferences()).toHaveLength(1);
    // Meanwhile the round reads as the edit meant: the removed doctor's ranking is not counted.
    const managed = (await (await GET(get())).json()).managed[0];
    expect(managed.preferences).toEqual([]);

    const again = await POST(post(edit), context());
    expect(again.status).toBe(200);
    expect(preferences()).toEqual([]);
    const third = await POST(post(edit), context());
    expect(third.status).toBe(200);
    expect((rounds()[0].setup as RoundSetup).people).toHaveLength(1);
  });
});

describe("rotation rounds API: validation and availability", () => {
  it("refuses an unknown action, a bad setup and a malformed round id", async () => {
    as(MANAGER);
    expect((await POST(post({ action: "explode" }), context())).status).toBe(400);
    expect((await POST(post({ action: "edit", setup: { ...setup(), terms: [] } }), context())).status).toBe(400);
    expect((await POST(post({ action: "open" }), context("not-a-uuid"))).status).toBe(404);
    expect((await POST(post({ action: "open" }), context("7a000000-0000-4000-8000-0000000000ff"))).status).toBe(404);
  });

  it("refuses a patient detail in the round's free text", async () => {
    as(MANAGER);
    seed([]);
    const response = await CREATE(
      post(
        { action: "create", setup: setup({ note: "Patient John Smith MRN 1234567 needs cover" }) },
        "https://example.org/api/roster/rotations",
      ),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/patient detail/);
    expect(rounds()).toEqual([]);
  });

  it("answers 503 'not live yet' while the tables do not exist", async () => {
    mocks.state.missing = true;
    const read = await GET(get());
    expect(read.status).toBe(503);
    expect((await read.json()).error).toBe("Rotations are not live for real teams yet.");
    const write = await POST(post({ action: "save-preference", ranking: ["cl"], submit: false }), context());
    expect(write.status).toBe(503);
    expect((await write.json()).error).toBe("Rotations are not live for real teams yet.");
  });

  it("answers 503 in demo mode and, after sign-in, while the release is held", async () => {
    mocks.demo.mockReturnValue(true);
    expect((await GET(get())).status).toBe(503);
    expect(mocks.auth).not.toHaveBeenCalled();
    mocks.demo.mockReturnValue(false);
    mocks.release.mockReturnValue(false);
    const held = await POST(post({ action: "open" }), context());
    expect(held.status).toBe(503);
    expect(held.headers.get("Cache-Control")).toContain("no-store");
    expect(mocks.auth).toHaveBeenCalledTimes(1);
    expect(rounds()[0].status).toBe("open");
  });
});
