import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEMO_CME_YEAR } from "@/lib/cme/demo-year";
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
import { calendarFeedEvents } from "@/lib/calendar/feed-repository";
import { toIcs } from "@/lib/calendar/ics";
import { calendarFeedEvents } from "@/lib/calendar/feed-repository";
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

describe("prior-year CPD reporting in the subscription", () => {
  it.each(["2027-01-15T00:00:00Z", "2027-02-28T16:00:00Z", "2027-03-01T15:59:59Z"])(
    "keeps a confirmed RANZCP deadline through its Perth calendar date at %s",
    async (date) => {
      mocks.cmeYear.mockImplementation(async (_client, _owner, year) =>
        year === 2026
          ? { ...DEMO_CME_YEAR, year, confirmedSource: "au-ranzcp-2026-v1; synthetic confirmed source" }
          : null,
      );
      const events = await calendarFeedEvents({ from: mocks.from } as never, ownerId, new Date(date));
      expect(mocks.cmeYear).toHaveBeenCalledWith(expect.anything(), ownerId, 2026);
      expect(events).toContainEqual(expect.objectContaining({ id: "cme-2026-mycpd-close", date: "2027-03-01" }));
      expect(events).not.toContainEqual(expect.objectContaining({ id: "cme-2026-year-end" }));
    },
  );

  it("stops reading the prior year after reporting closes and retains current and next year events", async () => {
    mocks.cmeYear.mockImplementation(async (_client, _owner, year) => ({ ...DEMO_CME_YEAR, year }));
    const events = await calendarFeedEvents({ from: mocks.from } as never, ownerId, new Date("2027-03-01T16:00:00Z"));
    expect(mocks.cmeYear).not.toHaveBeenCalledWith(expect.anything(), ownerId, 2026);
    expect(events).toContainEqual(expect.objectContaining({ id: "cme-2027-year-end" }));
    expect(events).toContainEqual(expect.objectContaining({ id: "cme-2028-year-end" }));
  });

  it.each([null, { ...DEMO_CME_YEAR, year: 2026, confirmedSource: "Another CPD home" }])(
    "adds no reporting deadline for an unconfirmed or non-RANZCP prior year",
    async (previous) => {
      mocks.cmeYear.mockImplementation(async (_client, _owner, year) => (year === 2026 ? previous : null));
      const events = await calendarFeedEvents({ from: mocks.from } as never, ownerId, new Date("2027-01-15T00:00:00Z"));
      expect(events).not.toContainEqual(expect.objectContaining({ id: "cme-2026-mycpd-close" }));
    },
  );
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
    // A successful read with no preferences row intentionally uses Perth; an unavailable query is a different case.
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle }) }) });
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
    expect(body).toContain("DTSTART:20990304T010000Z");
    expect(body).toContain("LOCATION:Room 2");
    expect(body).not.toContain("Dr Organiser");
    expect(mocks.bookings).toHaveBeenCalledWith(expect.anything(), ownerId);

    mocks.bookings.mockRejectedValueOnce(new Error("bookings down"));
    const fallback = await feedRequest(`${token}.ics`);
    expect(fallback.status).toBe(200);
    expect(await fallback.text()).not.toContain("ALS refresher");
  });

  it.each([
    { name: "Sydney", zone: "Australia/Sydney", expected: "20990114T220000Z" },
    { name: "missing zone", zone: undefined, expected: "20990115T010000Z" },
    { name: "invalid zone", zone: "synthetic/invalid", expected: "20990115T010000Z" },
  ])("places booked courses on the feed using the owner's $name preference", async ({ zone, expected }) => {
    mocks.rpc.mockResolvedValue({ data: ownerId, error: null });
    const maybeSingle = vi.fn().mockResolvedValue({ data: { preferences: { timeZone: zone } }, error: null });
    const eq = vi.fn<(column: string, value: string) => { maybeSingle: typeof maybeSingle }>(() => ({ maybeSingle }));
    mocks.from.mockReturnValue({ select: vi.fn(() => ({ eq })) });
    mocks.bookings.mockResolvedValue({
      status: "ready",
      state: {
        courses: [
          {
            id: "synthetic-booked",
            kind: "course",
            title: "Synthetic course",
            date: "2099-01-15",
            startTime: "09:00",
            endTime: "10:00",
            location: "Synthetic room",
            organiser: "Synthetic organiser",
            status: "posted",
          },
        ],
        bookings: [{ id: "synthetic-booking", courseId: "synthetic-booked", self: true, status: "booked" }],
      },
    });
    const response = await feedRequest(`${token}.ics`);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain(`DTSTART:${expected}`);
    expect(body).toContain("SUMMARY:Synthetic course");
    expect(body).not.toContain("Synthetic organiser");
    expect(eq.mock.calls.every(([column, value]) => column === "user_id" && value === ownerId)).toBe(true);
  });

  it("returns unavailable rather than publishing a silently shifted booking during a clock gap", async () => {
    mocks.rpc.mockResolvedValue({ data: ownerId, error: null });
    const maybeSingle = vi
      .fn()
      .mockResolvedValue({ data: { preferences: { timeZone: "Australia/Sydney" } }, error: null });
    mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle }) }) });
    mocks.bookings.mockResolvedValue({
      status: "ready",
      state: {
        courses: [
          {
            id: "clock-gap",
            title: "Synthetic course",
            kind: "course",
            status: "posted",
            date: "2027-10-03",
            startTime: "02:30",
            endTime: "03:30",
          },
        ],
        bookings: [{ id: "synthetic-booking", courseId: "clock-gap", self: true, status: "booked" }],
      },
    });
    const response = await feedRequest(`${token}.ics`);
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("Calendar unavailable");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns unavailable when booked courses need a work zone but the owner's preferences cannot be read", async () => {
    mocks.rpc.mockResolvedValue({ data: ownerId, error: null });
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: { message: "Synthetic preferences outage" } });
    mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle }) }) });
    mocks.bookings.mockResolvedValue({
      status: "ready",
      state: {
        courses: [
          {
            id: "synthetic-booked",
            title: "Synthetic course",
            kind: "course",
            status: "posted",
            date: "2099-01-15",
            startTime: "09:00",
            endTime: "10:00",
          },
        ],
        bookings: [{ id: "synthetic-booking", courseId: "synthetic-booked", self: true, status: "booked" }],
      },
    });
    const response = await feedRequest(`${token}.ics`);
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("Calendar unavailable");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("ignores an old retained clock-gap course and keeps the Perth-day feed cutoff after work-zone conversion", async () => {
    const now = new Date("2027-01-02T00:00:00Z");
    const maybeSingle = vi
      .fn()
      .mockResolvedValue({ data: { preferences: { timeZone: "Australia/Sydney" } }, error: null });
    mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle }) }) });
    const courses = [
      // Ninety days old: still readable under the 365-day booking retention contract.
      { id: "old-gap", title: "Synthetic old gap", date: "2026-10-04", startTime: "02:30", endTime: "03:30" },
      { id: "future", title: "Synthetic future course", date: "2027-01-15", startTime: "13:00", endTime: "14:30" },
      { id: "cutoff", title: "Synthetic cutoff course", date: "2026-12-04", startTime: "01:30", endTime: "03:30" },
      { id: "excluded", title: "Synthetic excluded course", date: "2026-12-03", startTime: "01:30", endTime: "03:30" },
    ].map((course) => ({ ...course, kind: "course", status: "posted" }));
    mocks.bookings.mockResolvedValue({
      status: "ready",
      state: {
        courses,
        bookings: courses.map((course) => ({
          id: `booking-${course.id}`,
          courseId: course.id,
          self: true,
          status: "booked",
        })),
      },
    });
    const client = { rpc: mocks.rpc, from: mocks.from } as unknown as Parameters<typeof calendarFeedEvents>[0];
    const body = toIcs(await calendarFeedEvents(client, ownerId, now), { now });
    expect(body).toContain("SUMMARY:Synthetic future course");
    expect(body).toContain("DTSTART:20270115T020000Z");
    // Sydney's 4 Dec 01:30 is still 3 Dec in Perth, exactly the inclusive cutoff.
    expect(body).toContain("SUMMARY:Synthetic cutoff course");
    expect(body).toContain("DTSTART:20261203T143000Z");
    expect(body).not.toContain("Synthetic old gap");
    expect(body).not.toContain("Synthetic excluded course");
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
