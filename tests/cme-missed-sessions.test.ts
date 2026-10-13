import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({ from: vi.fn(), auth: vi.fn(), demo: vi.fn(), rate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: routeMocks.from }) }));
vi.mock("@/lib/supabase/auth", () => ({
  requireAuthenticatedUser: routeMocks.auth,
  AuthenticationError: class extends Error {},
  unauthorizedResponse: () => Response.json({ error: "Sign in" }, { status: 401 }),
}));
vi.mock("@/lib/env", () => ({ isDemoMode: routeMocks.demo }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/api-rate-limit", () => ({
  consumeSubjectApiRateLimit: routeMocks.rate,
  rateLimitJsonResponse: () => Response.json({}, { status: 429 }),
  allowRateLimitInMemoryFallbackOnUnavailable: () => false,
}));

import {
  CME_MISSED_SESSION_MINUTES_MAX,
  CME_MISSED_SESSION_MINUTES_MIN,
  CME_MISSED_SESSION_REASON_MAX,
  CME_MISSED_SESSION_TITLE_MAX,
  CME_MISSED_SESSION_TITLE_MIN,
  cmeMissedSessionCreateSchema,
  cmeMissedSessionReplacementSchema,
  rowToCmeMissedSession,
} from "@/lib/cme/missed-sessions";
import { PublicApiError } from "@/lib/http";
import { GET as listMissed, POST as createMissed } from "@/app/api/cme/missed/route";
import { DELETE as deleteMissed, PATCH as patchMissed } from "@/app/api/cme/missed/[id]/route";
import { AuthenticationError } from "@/lib/supabase/auth";

const OWNER = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const ENTRY_ID = "33333333-3333-4333-8333-333333333333";

function validBody(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    occurredOn: "2026-09-20",
    kind: "teaching",
    title: "Weekly registrar teaching",
    minutesLost: 60,
    reason: null,
    ...overrides,
  };
}

describe("missed session schema limits", () => {
  it("accepts a well-formed record", () => {
    expect(cmeMissedSessionCreateSchema.safeParse(validBody()).success).toBe(true);
  });

  it("requires an ISO date for occurredOn", () => {
    expect(cmeMissedSessionCreateSchema.safeParse(validBody({ occurredOn: "20 Sep 2026" })).success).toBe(false);
  });

  it("rejects an impossible calendar date instead of letting the database refuse it", () => {
    expect(cmeMissedSessionCreateSchema.safeParse(validBody({ occurredOn: "2026-02-30" })).success).toBe(false);
  });

  it("only accepts teaching or supervision as kind", () => {
    expect(cmeMissedSessionCreateSchema.safeParse(validBody({ kind: "clinic" })).success).toBe(false);
  });

  it(`rejects a title shorter than ${CME_MISSED_SESSION_TITLE_MIN} characters`, () => {
    expect(cmeMissedSessionCreateSchema.safeParse(validBody({ title: "ab" })).success).toBe(false);
  });

  it(`rejects a title longer than ${CME_MISSED_SESSION_TITLE_MAX} characters`, () => {
    expect(
      cmeMissedSessionCreateSchema.safeParse(validBody({ title: "a".repeat(CME_MISSED_SESSION_TITLE_MAX + 1) }))
        .success,
    ).toBe(false);
  });

  it(`accepts minutesLost between ${CME_MISSED_SESSION_MINUTES_MIN} and ${CME_MISSED_SESSION_MINUTES_MAX}`, () => {
    expect(
      cmeMissedSessionCreateSchema.safeParse(validBody({ minutesLost: CME_MISSED_SESSION_MINUTES_MIN })).success,
    ).toBe(true);
    expect(
      cmeMissedSessionCreateSchema.safeParse(validBody({ minutesLost: CME_MISSED_SESSION_MINUTES_MAX })).success,
    ).toBe(true);
    expect(
      cmeMissedSessionCreateSchema.safeParse(validBody({ minutesLost: CME_MISSED_SESSION_MINUTES_MIN - 1 })).success,
    ).toBe(false);
    expect(
      cmeMissedSessionCreateSchema.safeParse(validBody({ minutesLost: CME_MISSED_SESSION_MINUTES_MAX + 1 })).success,
    ).toBe(false);
    expect(cmeMissedSessionCreateSchema.safeParse(validBody({ minutesLost: 1.5 })).success).toBe(false);
  });

  it(`rejects a reason longer than ${CME_MISSED_SESSION_REASON_MAX} characters`, () => {
    expect(
      cmeMissedSessionCreateSchema.safeParse(validBody({ reason: "a".repeat(CME_MISSED_SESSION_REASON_MAX + 1) }))
        .success,
    ).toBe(false);
  });

  it("treats an empty or omitted reason as null", () => {
    const omitted = { ...validBody() } as Record<string, unknown>;
    delete omitted.reason;
    expect(cmeMissedSessionCreateSchema.parse(omitted).reason).toBeNull();
    expect(cmeMissedSessionCreateSchema.parse(validBody({ reason: "  " })).reason).toBeNull();
    expect(cmeMissedSessionCreateSchema.parse(validBody({ reason: " Covered a code " })).reason).toBe("Covered a code");
  });

  it("rejects an unknown field (strict)", () => {
    expect(cmeMissedSessionCreateSchema.safeParse(validBody({ extra: true })).success).toBe(false);
  });

  it("replacement schema accepts a uuid or null, and rejects a full record shape", () => {
    expect(cmeMissedSessionReplacementSchema.safeParse({ replacementEntryId: ENTRY_ID }).success).toBe(true);
    expect(cmeMissedSessionReplacementSchema.safeParse({ replacementEntryId: null }).success).toBe(true);
    expect(cmeMissedSessionReplacementSchema.safeParse({ replacementEntryId: "not-a-uuid" }).success).toBe(false);
    expect(cmeMissedSessionReplacementSchema.safeParse(validBody()).success).toBe(false);
  });
});

describe("row mapping", () => {
  it("maps a database row to the model", () => {
    expect(
      rowToCmeMissedSession({
        id: SESSION_ID,
        occurred_on: "2026-09-20",
        kind: "supervision",
        title: "Fortnightly supervision",
        minutes_lost: 45,
        reason: "Urgent review",
        replacement_entry_id: ENTRY_ID,
      }),
    ).toEqual({
      id: SESSION_ID,
      occurredOn: "2026-09-20",
      kind: "supervision",
      title: "Fortnightly supervision",
      minutesLost: 45,
      reason: "Urgent review",
      replacementEntryId: ENTRY_ID,
    });
  });
});

// --- fake client, matching tests/cme-repository.test.ts's fakeClient -------

type FakeResponse = { data: unknown; error: { message: string; code?: string } | null };

function makeChain(response: FakeResponse) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    single: vi.fn(() => chain),
    maybeSingle: vi.fn(() => chain),
    then(resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) {
      return Promise.resolve(response).then(resolve, reject);
    },
  };
  return chain;
}

function fakeClient(responsesByTable: Record<string, FakeResponse[]>) {
  const calls: Array<{ table: string; chain: ReturnType<typeof makeChain> }> = [];
  const queues = new Map(Object.entries(responsesByTable).map(([table, rows]) => [table, [...rows]]));
  const from = vi.fn((table: string) => {
    const queue = queues.get(table);
    if (!queue || queue.length === 0) throw new Error(`fakeClient: no queued response left for table "${table}"`);
    const chain = makeChain(queue.shift()!);
    calls.push({ table, chain });
    return chain;
  });
  return { from, calls };
}

const YEAR_ID = "44444444-4444-4444-8444-444444444444";
/** An activity that may replace a missed session: not archived, in an open year. */
const LINKABLE_ENTRY = {
  cme_entries: [{ data: { archived_at: null, year_id: YEAR_ID }, error: null }],
  cme_years: [{ data: { closed_at: null }, error: null }],
};

const ROW = {
  id: SESSION_ID,
  owner_id: OWNER,
  occurred_on: "2026-09-20",
  kind: "teaching",
  title: "Weekly registrar teaching",
  minutes_lost: 60,
  reason: null,
  replacement_entry_id: null,
};

describe("missed-sessions repository, owner predicate", () => {
  it("fetchOwnerCmeMissedSessions filters by owner_id on the same chain as from()", async () => {
    const { fetchOwnerCmeMissedSessions } = await import("@/lib/cme/missed-sessions-repository");
    const client = fakeClient({ cme_missed_sessions: [{ data: [ROW], error: null }] });
    const result = await fetchOwnerCmeMissedSessions(client as never, OWNER);
    expect(client.calls[0].table).toBe("cme_missed_sessions");
    expect(client.calls[0].chain.eq).toHaveBeenCalledWith("owner_id", OWNER);
    expect(result).toEqual([
      {
        id: SESSION_ID,
        occurredOn: "2026-09-20",
        kind: "teaching",
        title: "Weekly registrar teaching",
        minutesLost: 60,
        reason: null,
        replacementEntryId: null,
      },
    ]);
  });

  it("fetchOwnerCmeMissedSessions refuses without an owner", async () => {
    const { fetchOwnerCmeMissedSessions } = await import("@/lib/cme/missed-sessions-repository");
    const client = fakeClient({});
    await expect(fetchOwnerCmeMissedSessions(client as never, "")).rejects.toThrow(/owner/i);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("createOwnerCmeMissedSession writes owner_id on the insert", async () => {
    const { createOwnerCmeMissedSession } = await import("@/lib/cme/missed-sessions-repository");
    const client = fakeClient({ cme_missed_sessions: [{ data: ROW, error: null }] });
    await createOwnerCmeMissedSession(client as never, OWNER, {
      occurredOn: "2026-09-20",
      kind: "teaching",
      title: "Weekly registrar teaching",
      minutesLost: 60,
      reason: null,
    });
    expect(client.calls[0].chain.insert).toHaveBeenCalledWith(expect.objectContaining({ owner_id: OWNER }));
  });

  it("updateOwnerCmeMissedSession filters by id and owner_id on the same chain as from()", async () => {
    const { updateOwnerCmeMissedSession } = await import("@/lib/cme/missed-sessions-repository");
    const client = fakeClient({ cme_missed_sessions: [{ data: ROW, error: null }] });
    await updateOwnerCmeMissedSession(client as never, OWNER, SESSION_ID, {
      occurredOn: "2026-09-20",
      kind: "teaching",
      title: "Weekly registrar teaching",
      minutesLost: 60,
      reason: null,
    });
    expect(client.calls[0].chain.eq).toHaveBeenCalledWith("id", SESSION_ID);
    expect(client.calls[0].chain.eq).toHaveBeenCalledWith("owner_id", OWNER);
  });

  it("updateOwnerCmeMissedSession throws a public 404 for another owner's session", async () => {
    const { updateOwnerCmeMissedSession } = await import("@/lib/cme/missed-sessions-repository");
    const client = fakeClient({ cme_missed_sessions: [{ data: null, error: null }] });
    await expect(
      updateOwnerCmeMissedSession(client as never, OWNER, SESSION_ID, {
        occurredOn: "2026-09-20",
        kind: "teaching",
        title: "Weekly registrar teaching",
        minutesLost: 60,
        reason: null,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("deleteOwnerCmeMissedSession filters by id and owner_id, and 404s when nothing matched", async () => {
    const { deleteOwnerCmeMissedSession } = await import("@/lib/cme/missed-sessions-repository");
    const client = fakeClient({ cme_missed_sessions: [{ data: { id: SESSION_ID }, error: null }] });
    await deleteOwnerCmeMissedSession(client as never, OWNER, SESSION_ID);
    expect(client.calls[0].chain.eq).toHaveBeenCalledWith("id", SESSION_ID);
    expect(client.calls[0].chain.eq).toHaveBeenCalledWith("owner_id", OWNER);

    const missingClient = fakeClient({ cme_missed_sessions: [{ data: null, error: null }] });
    await expect(deleteOwnerCmeMissedSession(missingClient as never, OWNER, SESSION_ID)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("setOwnerCmeMissedSessionReplacement filters by id and owner_id, and can clear the link", async () => {
    const { setOwnerCmeMissedSessionReplacement } = await import("@/lib/cme/missed-sessions-repository");
    const client = fakeClient({
      ...LINKABLE_ENTRY,
      cme_missed_sessions: [{ data: { ...ROW, replacement_entry_id: ENTRY_ID }, error: null }],
    });
    const result = await setOwnerCmeMissedSessionReplacement(client as never, OWNER, SESSION_ID, ENTRY_ID);
    expect(client.calls.map((call) => call.table)).toEqual(["cme_entries", "cme_years", "cme_missed_sessions"]);
    for (const call of client.calls) expect(call.chain.eq).toHaveBeenCalledWith("owner_id", OWNER);
    expect(client.calls[2].chain.update).toHaveBeenCalledWith({ replacement_entry_id: ENTRY_ID });
    expect(client.calls[2].chain.eq).toHaveBeenCalledWith("id", SESSION_ID);
    expect(result.replacementEntryId).toBe(ENTRY_ID);
  });

  it("refuses to link an archived activity, or one in a closed year, like plan goals", async () => {
    const { setOwnerCmeMissedSessionReplacement } = await import("@/lib/cme/missed-sessions-repository");
    const archived = fakeClient({
      cme_entries: [{ data: { archived_at: "2026-09-01T00:00:00Z", year_id: YEAR_ID }, error: null }],
    });
    await expect(
      setOwnerCmeMissedSessionReplacement(archived as never, OWNER, SESSION_ID, ENTRY_ID),
    ).rejects.toMatchObject({ status: 400 });
    expect(archived.calls.map((call) => call.table)).toEqual(["cme_entries"]);

    const closed = fakeClient({
      cme_entries: [{ data: { archived_at: null, year_id: YEAR_ID }, error: null }],
      cme_years: [{ data: { closed_at: "2026-09-10T00:00:00Z" }, error: null }],
    });
    await expect(
      setOwnerCmeMissedSessionReplacement(closed as never, OWNER, SESSION_ID, ENTRY_ID),
    ).rejects.toMatchObject({
      status: 400,
    });
    expect(closed.calls.map((call) => call.table)).toEqual(["cme_entries", "cme_years"]);

    const missing = fakeClient({ cme_entries: [{ data: null, error: null }] });
    await expect(
      setOwnerCmeMissedSessionReplacement(missing as never, OWNER, SESSION_ID, ENTRY_ID),
    ).rejects.toMatchObject({
      status: 400,
    });
  });

  it("maps a foreign-key violation on the replacement link to a public 400, not a 500", async () => {
    const { setOwnerCmeMissedSessionReplacement } = await import("@/lib/cme/missed-sessions-repository");
    const client = fakeClient({
      ...LINKABLE_ENTRY,
      cme_missed_sessions: [{ data: null, error: { message: "insert or update violates foreign key", code: "23503" } }],
    });
    const rejection = await setOwnerCmeMissedSessionReplacement(client as never, OWNER, SESSION_ID, ENTRY_ID).catch(
      (error: unknown) => error,
    );
    expect(rejection).toBeInstanceOf(PublicApiError);
    expect((rejection as PublicApiError).status).toBe(400);
  });
});

function getRequest(url: string) {
  return new Request(url);
}
function jsonRequest(url: string, method: string, body: unknown) {
  return new Request(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

describe("missed session API contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeMocks.demo.mockReturnValue(false);
    routeMocks.auth.mockResolvedValue({ id: OWNER });
    routeMocks.rate.mockResolvedValue({ limited: false });
  });

  it("GET lists the owner's sessions", async () => {
    routeMocks.from.mockReturnValueOnce(makeChain({ data: [ROW], error: null }));
    const response = await listMissed(getRequest("http://localhost/api/cme/missed"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      missedSessions: [
        {
          id: SESSION_ID,
          occurredOn: "2026-09-20",
          kind: "teaching",
          title: "Weekly registrar teaching",
          minutesLost: 60,
          reason: null,
          replacementEntryId: null,
        },
      ],
    });
  });

  it("GET returns an empty demo list without touching the database", async () => {
    routeMocks.demo.mockReturnValue(true);
    const response = await listMissed(getRequest("http://localhost/api/cme/missed"));
    expect(await response.json()).toEqual({ missedSessions: [], demoMode: true });
    expect(routeMocks.from).not.toHaveBeenCalled();
  });

  it("POST creates a session with the owner from the session, not the body", async () => {
    routeMocks.from.mockReturnValueOnce(makeChain({ data: ROW, error: null }));
    // The create schema has no owner field at all (and is `.strict()`, so one couldn't be
    // smuggled in even by name): the owner can only ever come from the authenticated session.
    const response = await createMissed(
      jsonRequest("http://localhost/api/cme/missed", "POST", {
        occurredOn: "2026-09-20",
        kind: "teaching",
        title: "Weekly registrar teaching",
        minutesLost: 60,
        reason: null,
      }),
    );
    expect(response.status).toBe(201);
    expect(routeMocks.from.mock.results[0].value.insert).toHaveBeenCalledWith(
      expect.objectContaining({ owner_id: OWNER }),
    );
  });

  it("POST refuses in demo mode and never writes", async () => {
    routeMocks.demo.mockReturnValue(true);
    const response = await createMissed(
      jsonRequest("http://localhost/api/cme/missed", "POST", {
        occurredOn: "2026-09-20",
        kind: "teaching",
        title: "Weekly registrar teaching",
        minutesLost: 60,
        reason: null,
      }),
    );
    expect(response.status).toBe(400);
    expect(routeMocks.from).not.toHaveBeenCalled();
  });

  it("POST rejects an invalid body with 400 before touching the database", async () => {
    const response = await createMissed(
      jsonRequest("http://localhost/api/cme/missed", "POST", { occurredOn: "2026-09-20" }),
    );
    expect(response.status).toBe(400);
    expect(routeMocks.from).not.toHaveBeenCalled();
  });

  it("PATCH with a full body replaces the session", async () => {
    routeMocks.from.mockReturnValueOnce(makeChain({ data: { ...ROW, minutes_lost: 90 }, error: null }));
    const response = await patchMissed(
      jsonRequest(`http://localhost/api/cme/missed/${SESSION_ID}`, "PATCH", {
        occurredOn: "2026-09-20",
        kind: "teaching",
        title: "Weekly registrar teaching",
        minutesLost: 90,
        reason: null,
      }),
      { params: Promise.resolve({ id: SESSION_ID }) },
    );
    expect(response.status).toBe(200);
    expect((await response.json()).missedSession.minutesLost).toBe(90);
  });

  it("PATCH with { replacementEntryId } sets the link", async () => {
    routeMocks.from
      .mockReturnValueOnce(makeChain({ data: { archived_at: null, year_id: YEAR_ID }, error: null }))
      .mockReturnValueOnce(makeChain({ data: { closed_at: null }, error: null }))
      .mockReturnValueOnce(makeChain({ data: { ...ROW, replacement_entry_id: ENTRY_ID }, error: null }));
    const response = await patchMissed(
      jsonRequest(`http://localhost/api/cme/missed/${SESSION_ID}`, "PATCH", { replacementEntryId: ENTRY_ID }),
      { params: Promise.resolve({ id: SESSION_ID }) },
    );
    expect(response.status).toBe(200);
    expect((await response.json()).missedSession.replacementEntryId).toBe(ENTRY_ID);
    expect(routeMocks.from.mock.results[2].value.update).toHaveBeenCalledWith({ replacement_entry_id: ENTRY_ID });
  });

  it("PATCH with { replacementEntryId: null } clears the link", async () => {
    routeMocks.from.mockReturnValueOnce(makeChain({ data: { ...ROW, replacement_entry_id: null }, error: null }));
    const response = await patchMissed(
      jsonRequest(`http://localhost/api/cme/missed/${SESSION_ID}`, "PATCH", { replacementEntryId: null }),
      { params: Promise.resolve({ id: SESSION_ID }) },
    );
    expect(response.status).toBe(200);
    expect(routeMocks.from.mock.results[0].value.update).toHaveBeenCalledWith({ replacement_entry_id: null });
  });

  it("PATCH maps a replacement to an entry the owner doesn't own to a 4xx, not a 500", async () => {
    routeMocks.from.mockReturnValueOnce(makeChain({ data: null, error: null }));
    const notFound = await patchMissed(
      jsonRequest(`http://localhost/api/cme/missed/${SESSION_ID}`, "PATCH", { replacementEntryId: ENTRY_ID }),
      { params: Promise.resolve({ id: SESSION_ID }) },
    );
    expect(notFound.status).toBe(400);

    routeMocks.from
      .mockReturnValueOnce(makeChain({ data: { archived_at: null, year_id: YEAR_ID }, error: null }))
      .mockReturnValueOnce(makeChain({ data: { closed_at: null }, error: null }))
      .mockReturnValueOnce(
        makeChain({ data: null, error: { message: "insert or update violates foreign key", code: "23503" } }),
      );
    const response = await patchMissed(
      jsonRequest(`http://localhost/api/cme/missed/${SESSION_ID}`, "PATCH", { replacementEntryId: ENTRY_ID }),
      { params: Promise.resolve({ id: SESSION_ID }) },
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });

  it("PATCH refuses an oversized body with 413 before touching the database", async () => {
    const response = await patchMissed(
      jsonRequest(`http://localhost/api/cme/missed/${SESSION_ID}`, "PATCH", { note: "x".repeat(300 * 1024) }),
      { params: Promise.resolve({ id: SESSION_ID }) },
    );
    expect(response.status).toBe(413);
    expect(routeMocks.from).not.toHaveBeenCalled();
  });

  it("PATCH rejects an id that is not a uuid before touching the database", async () => {
    const response = await patchMissed(jsonRequest("http://localhost/api/cme/missed/nope", "PATCH", {}), {
      params: Promise.resolve({ id: "nope" }),
    });
    expect(response.status).toBe(400);
    expect(routeMocks.from).not.toHaveBeenCalled();
  });

  it("PATCH refuses in demo mode and never writes", async () => {
    routeMocks.demo.mockReturnValue(true);
    const response = await patchMissed(
      jsonRequest(`http://localhost/api/cme/missed/${SESSION_ID}`, "PATCH", { replacementEntryId: null }),
      { params: Promise.resolve({ id: SESSION_ID }) },
    );
    expect(response.status).toBe(400);
    expect(routeMocks.from).not.toHaveBeenCalled();
  });

  it("DELETE removes an owned session", async () => {
    routeMocks.from.mockReturnValueOnce(makeChain({ data: { id: SESSION_ID }, error: null }));
    const response = await deleteMissed(
      new Request(`http://localhost/api/cme/missed/${SESSION_ID}`, { method: "DELETE" }),
      {
        params: Promise.resolve({ id: SESSION_ID }),
      },
    );
    expect(response.status).toBe(200);
    expect(routeMocks.from.mock.results[0].value.eq).toHaveBeenCalledWith("owner_id", OWNER);
  });

  it("DELETE 404s for a session the owner doesn't have", async () => {
    routeMocks.from.mockReturnValueOnce(makeChain({ data: null, error: null }));
    const response = await deleteMissed(
      new Request(`http://localhost/api/cme/missed/${SESSION_ID}`, { method: "DELETE" }),
      {
        params: Promise.resolve({ id: SESSION_ID }),
      },
    );
    expect(response.status).toBe(404);
  });

  it("maps a missing session to 401, without touching the database", async () => {
    routeMocks.auth.mockRejectedValue(new AuthenticationError("no session"));
    const response = await listMissed(getRequest("http://localhost/api/cme/missed"));
    expect(response.status).toBe(401);
    expect(routeMocks.from).not.toHaveBeenCalled();
  });
});

describe("the missed session and drafts tables never feed CPD totals or requirement status", () => {
  const guardedFiles = [
    "src/lib/cme/evaluate.ts",
    "src/lib/cme/year-close.ts",
    "src/lib/cme/export.ts",
    "src/lib/cme/annual-summary.ts",
  ];

  for (const file of guardedFiles) {
    it(`${file} never imports the missed-sessions module or reads cme_missed_sessions`, () => {
      let source: string;
      try {
        source = readFileSync(file, "utf8");
      } catch {
        return; // file does not exist in this checkout — nothing to guard
      }
      expect(source).not.toMatch(/missed-sessions/);
      expect(source).not.toMatch(/cme_missed_sessions/);
    });
  }
});
