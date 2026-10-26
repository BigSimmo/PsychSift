import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * A doctor's calendar links: list, add, remove, and refresh. Every query is
 * scoped to the signed-in owner, the full address never reaches a response,
 * a private or plain-http link is refused before it is ever stored, and a
 * failed refresh is recorded with the table's own reason code.
 */

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  linkUrls: vi.fn(),
  auth: vi.fn(),
  demo: vi.fn(),
  rate: vi.fn(),
  fetchLink: vi.fn(),
}));
vi.mock("server-only", () => ({}));
// The database decrypts a link's address (roster_calendar_link_urls); every other rpc is a save.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: mocks.from,
    rpc: (name: string, args: Record<string, unknown>) =>
      name === "roster_calendar_link_urls" ? mocks.linkUrls(args) : mocks.rpc(name, args),
  }),
}));
vi.mock("@/lib/supabase/auth", () => ({
  requireAuthenticatedUser: mocks.auth,
  AuthenticationError: class extends Error {},
  unauthorizedResponse: () => Response.json({ error: "Sign in" }, { status: 401 }),
}));
vi.mock("@/lib/env", () => ({ isDemoMode: mocks.demo }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/api-rate-limit", () => ({
  consumeSubjectApiRateLimit: mocks.rate,
  rateLimitJsonResponse: () => Response.json({}, { status: 429 }),
  allowRateLimitInMemoryFallbackOnUnavailable: () => false,
}));
// Only the network call is mocked: `normaliseCalendarLink` and `CalendarLinkError` stay real,
// so add-time validation is proven against the same logic tests/roster-calendar-link.test.ts covers.
vi.mock("@/lib/roster/calendar-link-fetch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/roster/calendar-link-fetch")>();
  return { ...actual, fetchCalendarLink: mocks.fetchLink };
});

import { DELETE, GET, POST } from "@/app/api/roster/links/route";
import { POST as refreshLinks } from "@/app/api/roster/links/refresh/route";
import { DELETE as removeWorkplace } from "@/app/api/roster/workplaces/route";
import { AuthenticationError } from "@/lib/supabase/auth";

const ownerId = "11111111-1111-4111-8111-111111111111";
const otherOwnerId = "22222222-2222-4222-8222-222222222222";
const linkId = "33333333-3333-4333-8333-333333333333";
const otherLinkId = "44444444-4444-4444-8444-444444444444";

type Recorded = {
  table: string;
  op: string;
  eq: Array<[string, unknown]>;
  insertedRow?: Record<string, unknown>;
  updatedFields?: Record<string, unknown>;
};

function fakeSupabase(
  rows: Record<string, unknown[]>,
  options: { insertError?: (table: string) => { message?: string; code?: string } | null } = {},
) {
  const calls: Recorded[] = [];
  // Like the database function: only the named owner's links, read from the live rows.
  mocks.linkUrls.mockImplementation(async ({ p_owner_id, p_ids }: { p_owner_id: string; p_ids: string[] }) => ({
    data: (rows.roster_calendar_links ?? [])
      .map((row) => row as { id: string; owner_id: string; url: string })
      .filter((row) => row.owner_id === p_owner_id && p_ids.includes(row.id))
      .map(({ id, url }) => ({ id, url })),
    error: null,
  }));
  mocks.from.mockImplementation((table: string) => {
    const call: Recorded = { table, op: "select", eq: [] };
    calls.push(call);
    const applyFilters = () =>
      (rows[table] ?? []).filter((row) =>
        call.eq.every(([column, value]) => (row as Record<string, unknown>)[column] === value),
      );
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "gt", "gte", "lt", "order", "limit", "or"]) builder[method] = () => builder;
    builder.eq = (column: string, value: unknown) => (call.eq.push([column, value]), builder);
    builder.is = (column: string, value: unknown) => (call.eq.push([column, value]), builder);
    builder.insert = (payload: Record<string, unknown>) => (
      (call.op = "insert"),
      (call.insertedRow = payload),
      builder
    );
    builder.update = (payload: Record<string, unknown>) => (
      (call.op = "update"),
      (call.updatedFields = payload),
      builder
    );
    builder.delete = () => ((call.op = "delete"), builder);
    builder.single = async () => {
      if (call.op === "insert") {
        const failure = options.insertError?.(table);
        if (failure) return { data: null, error: failure };
        return {
          data: {
            id: linkId,
            created_at: "2026-09-26T00:00:00.000Z",
            last_fetched_at: null,
            last_error: null,
            ...call.insertedRow,
            // The database derives the host from the address on insert.
            ...(typeof call.insertedRow?.url === "string" ? { url_host: new URL(call.insertedRow.url).hostname } : {}),
          },
          error: null,
        };
      }
      return { data: applyFilters()[0] ?? null, error: null };
    };
    builder.maybeSingle = async () => ({ data: applyFilters()[0] ?? null, error: null });
    builder.then = (resolve: (value: unknown) => unknown) => resolve({ data: applyFilters(), error: null });
    return builder;
  });
  return calls;
}

function request(method: string, body?: unknown) {
  return new Request("https://psychiatry.tools/api/roster/links", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function refreshRequest(body?: unknown) {
  return new Request("https://psychiatry.tools/api/roster/links/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

function icsDateTime(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

/** A feed of `pastCount` old events (well before any useful window) followed by three future shifts. */
function icsFeedWithHistory(pastCount: number): string {
  const events: string[] = [];
  for (let day = 0; day < pastCount; day += 1) {
    const start = new Date(Date.UTC(2015, 0, 1 + day, 8, 0, 0));
    const end = new Date(Date.UTC(2015, 0, 1 + day, 16, 0, 0));
    events.push(
      [
        "BEGIN:VEVENT",
        `UID:old-${day}`,
        `DTSTART:${icsDateTime(start)}`,
        `DTEND:${icsDateTime(end)}`,
        "SUMMARY:Old shift",
        "END:VEVENT",
      ].join("\n"),
    );
  }
  for (let index = 0; index < 3; index += 1) {
    const start = new Date(Date.UTC(2026, 9, 5 + index, 8, 0, 0));
    const end = new Date(Date.UTC(2026, 9, 5 + index, 16, 0, 0));
    events.push(
      [
        "BEGIN:VEVENT",
        `UID:future-${index}`,
        `DTSTART:${icsDateTime(start)}`,
        `DTEND:${icsDateTime(end)}`,
        "SUMMARY:Day",
        "END:VEVENT",
      ].join("\n"),
    );
  }
  return ["BEGIN:VCALENDAR", ...events, "END:VCALENDAR"].join("\n");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.demo.mockReturnValue(false);
  mocks.rate.mockResolvedValue({ limited: false });
  mocks.auth.mockResolvedValue({ id: ownerId });
  mocks.rpc.mockResolvedValue({ data: "import-id", error: null });
});

afterEach(() => {
  vi.useRealTimers();
});

const storedLinks = {
  roster_calendar_links: [
    {
      id: linkId,
      owner_id: ownerId,
      url: "https://roster.example.org/feed.ics?token=SECRET",
      url_host: "roster.example.org",
      workplace: "Example Hospital",
      last_fetched_at: null,
      last_error: null,
      created_at: "2026-09-20T00:00:00.000Z",
    },
    {
      id: otherLinkId,
      owner_id: otherOwnerId,
      url: "https://roster.example.org/other.ics?token=OTHERSECRET",
      url_host: "roster.example.org",
      workplace: null,
      last_fetched_at: null,
      last_error: null,
      created_at: "2026-09-20T00:00:00.000Z",
    },
  ],
};

describe("GET /api/roster/links", () => {
  it("lists only the signed-in doctor's links, without the full address", async () => {
    const calls = fakeSupabase(storedLinks);
    const response = await GET(request("GET"));
    expect(response.status).toBe(200);
    const text = JSON.stringify(await response.json());
    expect(text).toContain("roster.example.org/…");
    expect(text).not.toContain("SECRET");
    expect(text).not.toContain("feed.ics");
    for (const call of calls) expect(call.eq).toContainEqual(["owner_id", ownerId]);
  });

  it("refuses a signed-out request", async () => {
    fakeSupabase(storedLinks);
    mocks.auth.mockRejectedValue(new AuthenticationError("no session"));
    expect((await GET(request("GET"))).status).toBe(401);
    expect((await POST(request("POST", {}))).status).toBe(401);
    expect((await DELETE(request("DELETE", {}))).status).toBe(401);
    expect((await refreshLinks(refreshRequest())).status).toBe(401);
  });

  it("returns an empty list and refuses writes in demo mode", async () => {
    mocks.demo.mockReturnValue(true);
    const demo = (await (await GET(request("GET"))).json()) as { links: unknown[]; demoMode: boolean };
    expect(demo).toEqual({ links: [], demoMode: true });
    expect((await POST(request("POST", { url: "https://x.example/a.ics", workplace: null }))).status).toBe(400);
    expect((await DELETE(request("DELETE", { id: linkId }))).status).toBe(400);
    expect((await refreshLinks(refreshRequest({ id: linkId }))).status).toBe(400);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});

describe("POST /api/roster/links", () => {
  it("adds a link for the signed-in owner, scoped by owner_id", async () => {
    const calls = fakeSupabase({ roster_calendar_links: [] });
    const response = await POST(
      request("POST", { url: "https://roster.example.org/a.ics?t=abc", workplace: "Example Hospital" }),
    );
    expect(response.status).toBe(200);
    const insert = calls.find((call) => call.op === "insert");
    expect(insert?.insertedRow).toMatchObject({ owner_id: ownerId, workplace: "Example Hospital" });
    const text = JSON.stringify(await response.json());
    expect(text).not.toContain("t=abc");
  });

  it("refuses plain http and a private-address literal, with the reason as its code", async () => {
    fakeSupabase({ roster_calendar_links: [] });
    const http = await POST(request("POST", { url: "http://roster.example.org/a.ics", workplace: null }));
    expect(http.status).toBe(400);
    expect(((await http.json()) as { code: string }).code).toBe("not_https");

    const priv = await POST(request("POST", { url: "https://10.0.0.5/a.ics", workplace: null }));
    expect(priv.status).toBe(400);
    expect(((await priv.json()) as { code: string }).code).toBe("private_address");
  });

  it("refuses a private IPv6 literal, whose hostname keeps its brackets", async () => {
    const calls = fakeSupabase({ roster_calendar_links: [] });
    for (const url of ["https://[::1]/a.ics", "https://[fd00::5]/a.ics"]) {
      const response = await POST(request("POST", { url, workplace: null }));
      expect(response.status).toBe(400);
      expect(((await response.json()) as { code: string }).code).toBe("private_address");
    }
    expect(calls.some((call) => call.op === "insert")).toBe(false);
  });

  it("tells a duplicate workplace apart from the 3-link cap by its code", async () => {
    fakeSupabase(
      { roster_calendar_links: [] },
      { insertError: (table) => (table === "roster_calendar_links" ? { code: "23505", message: "duplicate" } : null) },
    );
    const response = await POST(
      request("POST", { url: "https://roster.example.org/a.ics", workplace: "Example Hospital" }),
    );
    expect(response.status).toBe(409);
    expect(((await response.json()) as { code: string }).code).toBe("duplicate_workplace");
  });

  it("refuses a link over 2000 characters before any insert", async () => {
    const calls = fakeSupabase({ roster_calendar_links: [] });
    const tooLong = `https://roster.example.org/a.ics?t=${"x".repeat(2000)}`;
    const response = await POST(request("POST", { url: tooLong, workplace: null }));
    expect(response.status).toBe(400);
    expect(calls.some((call) => call.op === "insert")).toBe(false);
  });

  it("returns 409 once the 3-link cap is reached", async () => {
    fakeSupabase(
      { roster_calendar_links: [] },
      { insertError: (table) => (table === "roster_calendar_links" ? { message: "roster_limit" } : null) },
    );
    const response = await POST(request("POST", { url: "https://roster.example.org/a.ics", workplace: null }));
    expect(response.status).toBe(409);
  });
});

describe("DELETE /api/roster/links", () => {
  it("removes only the caller's own link", async () => {
    const calls = fakeSupabase(storedLinks);
    const response = await DELETE(request("DELETE", { id: linkId }));
    expect(response.status).toBe(200);
    const del = calls.find((call) => call.op === "delete");
    expect(del?.eq).toContainEqual(["owner_id", ownerId]);
    expect(del?.eq).toContainEqual(["id", linkId]);
  });

  it("404s a link that isn't the caller's", async () => {
    fakeSupabase(storedLinks);
    const response = await DELETE(request("DELETE", { id: otherLinkId }));
    expect(response.status).toBe(404);
  });
});

describe("POST /api/roster/links/refresh", () => {
  it("keeps only the useful window and saves through replaceOwnerShifts as a link import", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T00:00:00.000Z"));
    fakeSupabase({ roster_calendar_links: storedLinks.roster_calendar_links, on_call_shifts: [] });
    mocks.fetchLink.mockResolvedValue(icsFeedWithHistory(500));
    const response = await refreshLinks(refreshRequest({ id: linkId }));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    const [name, args] = mocks.rpc.mock.calls[0]! as [string, Record<string, unknown>];
    expect(name).toBe("roster_own_shifts_replace");
    // The address is read back only through the database's owner-checked decrypt.
    expect(mocks.linkUrls).toHaveBeenCalledWith({ p_owner_id: ownerId, p_ids: [linkId] });
    expect(args.p_format).toBe("link");
    expect(args.p_workplace).toBe("Example Hospital");
    expect((args.p_shifts as unknown[]).length).toBe(3);
    // A feed carries no kind; each shift is given one so the calendar feed and hours can use it.
    expect((args.p_shifts as Array<{ kind?: string | null }>).map((shift) => shift.kind)).toEqual([
      "evening",
      "evening",
      "evening",
    ]);
  });

  it("maps a failed fetch to the table's own reason code and saves nothing", async () => {
    const calls = fakeSupabase({ roster_calendar_links: storedLinks.roster_calendar_links, on_call_shifts: [] });
    const { CalendarLinkError } = await import("@/lib/roster/calendar-link-fetch");
    mocks.fetchLink.mockRejectedValue(new CalendarLinkError("private_address"));
    const response = await refreshLinks(refreshRequest({ id: linkId }));
    expect(response.status).toBe(200);
    expect(mocks.rpc).not.toHaveBeenCalled();
    const update = calls.find((call) => call.op === "update");
    expect(update?.updatedFields).toMatchObject({ last_error: "blocked_address" });
    expect(update?.eq).toContainEqual(["owner_id", ownerId]);
  });

  it("never puts the link's address or query string in the response or an error", async () => {
    fakeSupabase({ roster_calendar_links: storedLinks.roster_calendar_links, on_call_shifts: [] });
    const { CalendarLinkError } = await import("@/lib/roster/calendar-link-fetch");
    mocks.fetchLink.mockRejectedValue(new CalendarLinkError("http_error"));
    const response = await refreshLinks(refreshRequest({ id: linkId }));
    const text = JSON.stringify(await response.json());
    expect(text).not.toContain("SECRET");
    expect(text).not.toContain("feed.ics");
  });

  it("saves nothing when the feed has more shifts in the window than one import may carry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T00:00:00.000Z"));
    const calls = fakeSupabase({ roster_calendar_links: storedLinks.roster_calendar_links, on_call_shifts: [] });
    const events = Array.from({ length: 405 }, (_, index) => {
      const start = new Date(Date.UTC(2026, 9, 2, 0, 0, 0) + index * 12 * 60 * 60 * 1000);
      const end = new Date(start.getTime() + 8 * 60 * 60 * 1000);
      return `BEGIN:VEVENT\nUID:s-${index}\nDTSTART:${icsDateTime(start)}\nDTEND:${icsDateTime(end)}\nSUMMARY:Day\nEND:VEVENT`;
    });
    mocks.fetchLink.mockResolvedValue(["BEGIN:VCALENDAR", ...events, "END:VCALENDAR"].join("\n"));
    const response = await refreshLinks(refreshRequest({ id: linkId }));
    expect(await response.json()).toEqual({ results: [{ id: linkId, ok: false, reason: "too_many_shifts" }] });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(calls.find((call) => call.op === "update")?.updatedFields).toMatchObject({ last_error: "too_many_shifts" });
  });

  it("saves nothing when the link is removed while its feed is still being fetched", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T00:00:00.000Z"));
    const links = [...storedLinks.roster_calendar_links];
    const calls = fakeSupabase({ roster_calendar_links: links, on_call_shifts: [] });
    mocks.fetchLink.mockImplementation(async () => {
      links.splice(0, links.length); // Delete my data (or Remove link) returns while the fetch is in flight.
      return icsFeedWithHistory(0);
    });
    const response = await refreshLinks(refreshRequest({ id: linkId }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ results: [{ id: linkId, ok: false, reason: "removed" }] });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(calls.some((call) => call.op !== "select")).toBe(false);
  });

  it("takes back what it saved when the link is removed while the save is running", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T00:00:00.000Z"));
    const links = [...storedLinks.roster_calendar_links];
    const calls = fakeSupabase({ roster_calendar_links: links, on_call_shifts: [] });
    mocks.fetchLink.mockResolvedValue(icsFeedWithHistory(0));
    mocks.rpc.mockImplementation(async () => {
      links.splice(0, links.length); // The delete lands after the pre-save check but before the save commits.
      return { data: "late-import-id", error: null };
    });
    const response = await refreshLinks(refreshRequest({ id: linkId }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ results: [{ id: linkId, ok: false, reason: "removed" }] });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    const deletes = calls.filter((call) => call.op === "delete");
    expect(deletes.map((call) => call.table)).toEqual(["on_call_shifts", "on_call_shift_imports"]);
    expect(deletes[0]?.eq).toEqual(
      expect.arrayContaining([
        ["owner_id", ownerId],
        ["source", "import"],
        ["workplace", "Example Hospital"],
      ]),
    );
    expect(deletes[1]?.eq).toEqual(
      expect.arrayContaining([
        ["owner_id", ownerId],
        ["id", "late-import-id"],
      ]),
    );
    expect(calls.some((call) => call.op === "update")).toBe(false);
  });

  it("404s a link id that isn't the caller's", async () => {
    fakeSupabase({ roster_calendar_links: storedLinks.roster_calendar_links, on_call_shifts: [] });
    const response = await refreshLinks(refreshRequest({ id: otherLinkId }));
    expect(response.status).toBe(404);
    expect(mocks.fetchLink).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/roster/workplaces", () => {
  function workplaceRequest(body: unknown) {
    return new Request("https://psychiatry.tools/api/roster/workplaces", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("removes the workplace's links, then its imported shifts, for the caller only, recording no import", async () => {
    const calls = fakeSupabase(storedLinks);
    const response = await removeWorkplace(workplaceRequest({ workplace: "Example Hospital" }));
    expect(response.status).toBe(200);
    expect(calls.map((call) => `${call.op} ${call.table}`)).toEqual([
      "delete roster_calendar_links",
      "delete on_call_shifts",
    ]);
    for (const call of calls) {
      expect(call.eq).toContainEqual(["owner_id", ownerId]);
      expect(call.eq).toContainEqual(["workplace", "Example Hospital"]);
    }
    expect(calls[1]?.eq).toContainEqual(["source", "import"]);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses a body without a workplace, a signed-out request, and demo mode", async () => {
    const calls = fakeSupabase(storedLinks);
    expect((await removeWorkplace(workplaceRequest({}))).status).toBe(400);
    expect(
      (await removeWorkplace(workplaceRequest({ workplace: "Example Hospital", ownerId: otherOwnerId }))).status,
    ).toBe(400);
    expect(calls.some((call) => call.op === "delete")).toBe(false);
    mocks.auth.mockRejectedValue(new AuthenticationError("no session"));
    expect((await removeWorkplace(workplaceRequest({ workplace: "Example Hospital" }))).status).toBe(401);
    mocks.demo.mockReturnValue(true);
    expect((await removeWorkplace(workplaceRequest({ workplace: "Example Hospital" }))).status).toBe(400);
  });
});
