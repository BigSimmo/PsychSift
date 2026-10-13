import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OnCallEntry } from "@/lib/on-call/entry-model";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  auth: vi.fn(),
  demo: vi.fn(),
  rate: vi.fn(),
  cmeYear: vi.fn(),
  cmeRoutines: vi.fn(),
  onCall: vi.fn(),
  teachingFeed: vi.fn(),
  bookings: vi.fn(),
  logError: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc, from: mocks.from }) }));
vi.mock("@/lib/supabase/auth", () => ({
  requireAuthenticatedUser: mocks.auth,
  AuthenticationError: class extends Error {},
  unauthorizedResponse: () => Response.json({ error: "Sign in" }, { status: 401 }),
}));
vi.mock("@/lib/env", () => ({ isDemoMode: mocks.demo }));
vi.mock("@/lib/logger", () => ({ logger: { error: mocks.logError, warn: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/api-rate-limit", () => ({
  consumeSubjectApiRateLimit: mocks.rate,
  rateLimitJsonResponse: () => Response.json({}, { status: 429 }),
  allowRateLimitInMemoryFallbackOnUnavailable: () => false,
}));
vi.mock("@/lib/cme/repository", () => ({
  fetchOwnerCmeYear: mocks.cmeYear,
  fetchOwnerCmeRoutines: mocks.cmeRoutines,
}));
vi.mock("@/lib/on-call/repository", () => ({ fetchVisibleOnCallEntries: mocks.onCall }));
vi.mock("@/lib/teaching/feed-repository", () => ({ fetchTeachingFeedSessions: mocks.teachingFeed }));
// Published rotations have their own source and tests (tests/roster-rotations-feed.test.ts).
vi.mock("@/lib/calendar/rotation-feed-source", () => ({ fetchRotationFeedEvents: async () => [] }));
vi.mock("@/lib/work-screens/admin/bookings-repository", () => ({ readSavedBookings: mocks.bookings }));

import { DELETE as revoke, GET as status, POST as rotate } from "@/app/api/calendar/feed/route";
import { GET as feed } from "@/app/api/calendar/feed/[token]/route";
import {
  calendarFeedPath,
  generateCalendarFeedToken,
  hashCalendarFeedToken,
  parseCalendarFeedToken,
} from "@/lib/calendar/feed-token";
import { toIcs } from "@/lib/calendar/ics";
import { AuthenticationError } from "@/lib/supabase/auth";

const ownerId = "11111111-1111-4111-8111-111111111111";
const token = "A".repeat(43);

function teaching(overrides: Partial<OnCallEntry> & { id: string; title: string }): OnCallEntry {
  return {
    section: "education",
    slug: overrides.title.toLowerCase().replace(/\s+/g, "-"),
    subtitle: null,
    body: null,
    details: { nextOccurrenceDate: "2026-10-01", nextOccurrence: "12:30", recurrenceRule: { frequency: "weekly" } },
    linkedDocumentIds: [],
    tags: [],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 0,
    lastVerifiedAt: null,
    ...overrides,
  };
}

function feedRequest(segment: string) {
  return feed(new Request(`https://psychiatry.tools/api/calendar/feed/${segment}`), {
    params: Promise.resolve({ token: segment }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.demo.mockReturnValue(false);
  mocks.rate.mockResolvedValue({ limited: false });
  mocks.auth.mockResolvedValue({ id: ownerId });
  mocks.cmeYear.mockResolvedValue(null);
  mocks.cmeRoutines.mockResolvedValue([]);
  mocks.onCall.mockResolvedValue([]);
  mocks.teachingFeed.mockResolvedValue([]);
  mocks.bookings.mockResolvedValue({ status: "not-set-up" });
});

describe("calendar feed tokens", () => {
  it("are 43 base64url characters and differ every time", () => {
    const first = generateCalendarFeedToken();
    const second = generateCalendarFeedToken();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first).not.toBe(second);
  });

  it("store only a sha256 hex digest", () => {
    expect(hashCalendarFeedToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashCalendarFeedToken(token)).not.toContain(token);
  });

  it("parse with or without the .ics suffix, and reject anything else", () => {
    expect(parseCalendarFeedToken(`${token}.ics`)).toBe(token);
    expect(parseCalendarFeedToken(token)).toBe(token);
    expect(parseCalendarFeedToken("short.ics")).toBeNull();
    expect(parseCalendarFeedToken(`${"A".repeat(42)}!.ics`)).toBeNull();
    expect(parseCalendarFeedToken(`${token}.ics.ics`)).toBeNull();
    expect(calendarFeedPath(token)).toBe(`/api/calendar/feed/${token}.ics`);
  });
});

describe("toIcs refresh hint", () => {
  it("asks subscribers to re-read on the given interval", () => {
    const text = toIcs([], { name: "PsychSift", refreshHours: 4, now: new Date("2026-09-25T00:00:00Z") });
    expect(text).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT4H\r\n");
    expect(text).toContain("X-PUBLISHED-TTL:PT4H\r\n");
  });

  it("adds no hint to a one-off export", () => {
    expect(toIcs([])).not.toContain("REFRESH-INTERVAL");
  });
});

describe("GET /api/calendar/feed/<token>.ics (no session)", () => {
  it("answers a malformed link with a plain 404 and never touches the database", async () => {
    const response = await feedRequest("not-a-token.ics");
    expect(response.status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.rate).not.toHaveBeenCalled();
  });

  it("answers an unknown or turned-off link with the same 404", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    const response = await feedRequest(`${token}.ics`);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not found");
    expect(mocks.rpc).toHaveBeenCalledWith("calendar_feed_owner", { p_token_hash: hashCalendarFeedToken(token) });
    expect(mocks.cmeYear).not.toHaveBeenCalled();
  });

  it("serves nothing in demo mode", async () => {
    mocks.demo.mockReturnValue(true);
    expect((await feedRequest(`${token}.ics`)).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rate-limits by caller before looking the link up", async () => {
    mocks.rate.mockResolvedValue({ limited: true, retryAfterSeconds: 30 });
    const response = await feedRequest(`${token}.ics`);
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("30");
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.rate.mock.calls[0]![0]).toMatchObject({ subject: { kind: "anonymous" }, bucket: "cme" });
  });

  it("serves the owner's teaching sessions as a private, unindexed calendar, leaving personal entries out", async () => {
    mocks.rpc.mockResolvedValue({ data: ownerId, error: null });
    mocks.onCall.mockResolvedValue([
      teaching({ id: "22222222-2222-4222-8222-222222222222", title: "Registrar teaching" }),
      teaching({ id: "33333333-3333-4333-8333-333333333333", title: "My private tutorial", isPersonal: true }),
    ]);
    const response = await feedRequest(`${token}.ics`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/calendar; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=900");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    const body = await response.text();
    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).toContain("X-WR-CALNAME:PsychSift");
    expect(body).toContain("SUMMARY:Registrar teaching");
    expect(body).not.toContain("My private tutorial");
    expect(mocks.onCall).toHaveBeenCalledWith(expect.anything(), ownerId, { section: "education" });
  });

  it("adds the owner's booked courses without the organiser, and still serves when bookings can't be read", async () => {
    mocks.rpc.mockResolvedValue({ data: ownerId, error: null });
    const course = {
      id: "c1",
      kind: "course",
      title: "ALS refresher",
      about: "",
      date: "2099-03-04",
      startTime: "09:00",
      endTime: "12:00",
      location: "Room 2",
      capacity: 10,
      closesOn: null,
      organiser: "Dr Organiser",
      renewal: null,
      waitlist: false,
      status: "open",
      updatedAt: "2099-01-01T00:00:00Z",
      change: null,
    };
    const booking = {
      id: "b1",
      courseId: "c1",
      person: "You",
      self: true,
      status: "booked",
      at: "2099-01-02T00:00:00Z",
    };
    mocks.bookings.mockResolvedValueOnce({ status: "ready", state: { courses: [course], bookings: [booking] } });
    const body = await (await feedRequest(`${token}.ics`)).text();
    expect(body).toContain("SUMMARY:ALS refresher");
    expect(body).toContain("LOCATION:Room 2");
    expect(body).not.toContain("Dr Organiser");
    expect(mocks.bookings).toHaveBeenCalledWith(expect.anything(), ownerId);

    mocks.bookings.mockRejectedValueOnce(new Error("bookings down"));
    const fallback = await feedRequest(`${token}.ics`);
    expect(fallback.status).toBe(200);
    expect(await fallback.text()).not.toContain("ALS refresher");
  });

  it("fails closed with a 503 and no detail when the database errors", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "connection refused" } });
    const response = await feedRequest(`${token}.ics`);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("connection refused");
    expect(mocks.logError).toHaveBeenCalled();
  });
});

describe("/api/calendar/feed (signed in)", () => {
  const request = (method: string) => new Request("https://psychiatry.tools/api/calendar/feed", { method });

  it("needs a session for every method", async () => {
    mocks.auth.mockRejectedValue(new AuthenticationError("no session"));
    for (const handler of [status, rotate, revoke]) {
      expect((await handler(request("GET"))).status).toBe(401);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("reports whether a link exists, without revealing it", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { owner_id: ownerId }, error: null });
    const eq = vi.fn(() => ({ maybeSingle }));
    mocks.from.mockReturnValue({ select: () => ({ eq }) });
    const response = await status(request("GET"));
    expect(await response.json()).toEqual({ subscribed: true, available: true });
    expect(mocks.from).toHaveBeenCalledWith("calendar_feed_tokens");
    expect(eq).toHaveBeenCalledWith("owner_id", ownerId);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("makes a new link for the session's owner, storing only its hash", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    const response = await rotate(request("POST"));
    const { path } = (await response.json()) as { path: string };
    const presented = parseCalendarFeedToken(path.split("/").pop()!);
    expect(presented).not.toBeNull();
    expect(mocks.rpc).toHaveBeenCalledWith("calendar_feed_rotate", {
      p_owner_id: ownerId,
      p_token_hash: hashCalendarFeedToken(presented!),
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("turns the link off", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    expect((await revoke(request("DELETE"))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("calendar_feed_revoke", { p_owner_id: ownerId });
  });

  it("refuses to make a link in demo mode, and reports it unavailable", async () => {
    mocks.demo.mockReturnValue(true);
    expect((await rotate(request("POST"))).status).toBe(400);
    expect(await (await status(request("GET"))).json()).toEqual({ subscribed: false, available: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("calendar_feed_tokens migration", () => {
  const sql = readFileSync("supabase/migrations/20260925160000_calendar_feed_tokens.sql", "utf8");

  it("stores a hash, never a token", () => {
    expect(sql).toMatch(/token_hash text not null check \(token_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
    expect(sql).not.toMatch(/\btoken text\b/);
  });

  it("keeps the table and every function away from anon and authenticated", () => {
    expect(sql).toMatch(/enable row level security/);
    expect(sql).toMatch(/revoke all on table public\.calendar_feed_tokens from public, anon, authenticated/);
    for (const fn of ["calendar_feed_rotate(uuid, text)", "calendar_feed_revoke(uuid)", "calendar_feed_owner(text)"]) {
      expect(sql).toContain(`revoke all on function public.${fn} from public, anon, authenticated;`);
      expect(sql).toContain(`grant execute on function public.${fn} to service_role;`);
    }
    expect(sql).not.toMatch(/security definer/i);
  });
});
