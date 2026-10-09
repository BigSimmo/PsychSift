import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CalendarEvent } from "@/lib/calendar/calendar-event";
import type { OnCallShift } from "@/lib/roster/shifts/model";
import type { ShiftKind } from "@/lib/roster/shift-kind";

/*
 * Roster's numbers meet the rest of the app here: shifts on the private
 * calendar feed only once the doctor turns that on, the "evening before"
 * shift alarm, and Roster's own settings staying out of the account
 * preferences the phone caches. Every roster and doctor here is invented.
 */

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  auth: vi.fn(),
  demo: vi.fn(),
  rate: vi.fn(),
  logError: vi.fn(),
  cmeYear: vi.fn(),
  cmeRoutines: vi.fn(),
  onCall: vi.fn(),
  ownerShifts: vi.fn(),
  teams: vi.fn().mockResolvedValue([]),
  teachingFeed: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ isDemoMode: mocks.demo }));
vi.mock("@/lib/logger", () => ({ logger: { error: mocks.logError, warn: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.from }) }));
vi.mock("@/lib/supabase/auth", () => ({
  requireAuthenticatedUser: mocks.auth,
  AuthenticationError: class extends Error {},
  unauthorizedResponse: () => Response.json({ error: "Sign in" }, { status: 401 }),
}));
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
vi.mock("@/lib/roster/shifts/repository", () => ({ fetchOwnerShifts: mocks.ownerShifts }));
vi.mock("@/lib/roster/team/repository", () => ({ rosterReadTeams: mocks.teams, rosterRead: vi.fn() }));

import { calendarFeedEvents } from "@/lib/calendar/feed-repository";
import { applyReminderAlarms, DEFAULT_REMINDER_SETTINGS, updateReminderType } from "@/lib/reminders/settings";
import { clearRosterSettings } from "@/lib/roster/settings";
import { perthWallToIso } from "@/lib/roster/shifts/perth-time";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError } from "@/lib/supabase/auth";
import { calendarRosterShifts } from "@/lib/roster/team/calendar-shifts";

afterEach(() => vi.unstubAllEnvs());

it("keeps private team shifts out of the production feed while the release is held", async () => {
  vi.stubEnv("NODE_ENV", "production");
  const own = [night("2026-10-15")];
  const shifts = await calendarRosterShifts(createAdminClient(), ownerId, own, NOW);
  expect(shifts).toHaveLength(1);
  expect(mocks.teams).not.toHaveBeenCalled();
});

import { GET as getRosterSettings, PUT as putRosterSettings } from "@/app/api/roster/settings/route";
import { GET as getAccountPreferences, PUT as putAccountPreferences } from "@/app/api/account/preferences/route";

const ownerId = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-09-26T00:00:00Z");

function shift(date: string, start: string, end: string, kind: ShiftKind, id = `${date}-${kind}`): OnCallShift {
  const startsAt = perthWallToIso(date, start)!;
  let endsAt = perthWallToIso(date, end)!;
  if (Date.parse(endsAt) <= Date.parse(startsAt)) endsAt = new Date(Date.parse(endsAt) + 86_400_000).toISOString();
  return {
    id,
    startsAt,
    endsAt,
    title: "Registrar on call",
    location: null,
    sourceUid: null,
    kind,
    source: "import",
    seriesId: null,
    workplace: "Example Hospital",
  };
}

function night(date: string) {
  return shift(date, "21:30", "08:00", "night");
}

/** A minimal `user_preferences` row for one owner, read-only (enough for the feed and GET reads). */
function mockStoredPreferences(preferences: Record<string, unknown>) {
  mocks.from.mockImplementation((table: string) => {
    if (table !== "user_preferences") throw new Error(`Unexpected table in this test: ${table}`);
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { preferences, updated_at: "2026-08-25T00:00:00.000Z" }, error: null }),
        }),
      }),
    };
  });
}

/** A read-write `user_preferences` table, one row per owner, with the same optimistic-write shape the two routes use. */
function fakePreferencesTable(initial: Record<string, { preferences: unknown; updated_at: string }> = {}) {
  const rows = new Map(Object.entries(initial).map(([id, row]) => [id, structuredClone(row)]));
  const from = (table: string) => {
    if (table !== "user_preferences") throw new Error(`Unexpected table in this test: ${table}`);
    return {
      select: () => ({
        eq: (_column: string, userId: string) => ({
          maybeSingle: async () => {
            const row = rows.get(userId);
            return { data: row ? structuredClone(row) : null, error: null };
          },
        }),
      }),
      insert: async (value: { user_id: string; preferences: unknown; updated_at: string }) => {
        if (rows.has(value.user_id)) return { error: { code: "23505", message: "duplicate key" } };
        rows.set(value.user_id, { preferences: structuredClone(value.preferences), updated_at: value.updated_at });
        return { error: null };
      },
      update: (value: { preferences: unknown; updated_at: string }) => {
        const filters = new Map<string, unknown>();
        const builder = {
          eq(column: string, expected: unknown) {
            filters.set(column, expected);
            return builder;
          },
          select: () => ({
            maybeSingle: async () => {
              const row = rows.get(filters.get("user_id") as string);
              if (!row || filters.get("updated_at") !== row.updated_at) return { data: null, error: null };
              rows.set(filters.get("user_id") as string, {
                preferences: structuredClone(value.preferences),
                updated_at: value.updated_at,
              });
              return { data: { updated_at: value.updated_at }, error: null };
            },
          }),
        };
        return builder;
      },
    };
  };
  return { from, rows };
}

function request(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
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
  mocks.ownerShifts.mockResolvedValue([]);
  mocks.teachingFeed.mockResolvedValue([]);
});

describe("the private calendar feed", () => {
  it("puts shifts in the calendar feed only when the doctor turned it on", async () => {
    mocks.ownerShifts.mockResolvedValue([night("2026-10-15")]);
    mockStoredPreferences({ roster: { calendarShifts: false } });
    const admin = createAdminClient();

    const off = (await calendarFeedEvents(admin, ownerId, NOW)).filter((event) => event.title.startsWith("Roster"));
    expect(off).toEqual([]);

    mockStoredPreferences({ roster: { calendarShifts: true } });
    const events = (await calendarFeedEvents(admin, ownerId, NOW)).filter((event) => event.title.startsWith("Roster"));
    expect(events.map((event) => event.title)).toEqual(["Roster: Night"]);
    expect(JSON.stringify(events)).not.toMatch(/workplace|Example Hospital|location/i);
  });

  it("gives a shift stored without a kind one from its times, instead of dropping it", async () => {
    mocks.ownerShifts.mockResolvedValue([{ ...night("2026-10-15"), title: "Ward shift", kind: null }]);
    mockStoredPreferences({ roster: { calendarShifts: true } });
    const events = (await calendarFeedEvents(createAdminClient(), ownerId, NOW)).filter((event) =>
      event.title.startsWith("Roster"),
    );
    expect(events.map((event) => event.title)).toEqual(["Roster: Night"]);
  });

  it("reaches only 60 days ahead, and never touches shifts when it never fetches them", async () => {
    mocks.ownerShifts.mockResolvedValue([night("2026-10-15"), night("2026-12-31")]);
    mockStoredPreferences({ roster: { calendarShifts: true } });
    const admin = createAdminClient();
    const events = (await calendarFeedEvents(admin, ownerId, NOW)).filter((event) => event.title.startsWith("Roster"));
    expect(events).toHaveLength(1);
  });
});

describe("the 'evening before' shift alarm", () => {
  it("sets the shift alarm at 20:00 Perth the evening before, not a lead time off the shift's own start", () => {
    const shiftEvent: CalendarEvent = {
      id: "roster-shift-1",
      title: "Roster: Night",
      date: "2026-10-15",
      startTime: "21:30",
      kind: "other",
      reminderType: "shifts",
    };
    const settings = updateReminderType(DEFAULT_REMINDER_SETTINGS, "shifts", { calendarAlert: "evening-before" });
    const [event] = applyReminderAlarms([shiftEvent], settings, NOW);
    expect(event.alarmAt).toBe(perthWallToIso("2026-10-14", "20:00"));
  });

  it("refuses evening-before for any other reminder type", async () => {
    const response = await putAccountPreferences(
      request("https://x.test/api/account/preferences", "PUT", {
        reminders: { types: { teaching: { calendarAlert: "evening-before" } } },
      }),
    );
    expect(response.status).toBe(400);
  });
});

describe("Roster settings stay out of account preferences", () => {
  it("keeps Roster settings out of account preferences, which the phone caches", async () => {
    const table = fakePreferencesTable({
      [ownerId]: {
        preferences: { density: "compact", roster: { rowName: "Dr Alex Example" } },
        updated_at: "2026-08-25T00:00:00.000Z",
      },
    });
    mocks.from.mockImplementation(table.from);

    const getResponse = await getAccountPreferences(request("https://x.test/api/account/preferences", "GET"));
    expect(JSON.stringify(await getResponse.json())).not.toContain("Alex");

    const putResponse = await putAccountPreferences(
      request("https://x.test/api/account/preferences", "PUT", { density: "spacious" }),
    );
    expect(putResponse.status).toBe(200);
    expect(JSON.stringify(await putResponse.json())).not.toContain("Alex");
    expect((table.rows.get(ownerId)?.preferences as { roster: unknown }).roster).toEqual({
      rowName: "Dr Alex Example",
    });
  });
});

describe("GET/PUT /api/roster/settings", () => {
  it("rejects unknown Roster setting keys and oversized code maps", async () => {
    const table = fakePreferencesTable({});
    mocks.from.mockImplementation(table.from);
    const manyCodes: Record<string, { kind: "off" }> = {};
    for (let index = 0; index < 61; index += 1) manyCodes[`C${index}`] = { kind: "off" };

    expect(
      (await putRosterSettings(request("https://x.test/api/roster/settings", "PUT", { colour: "red" }))).status,
    ).toBe(400);
    expect(
      (await putRosterSettings(request("https://x.test/api/roster/settings", "PUT", { codes: { "": manyCodes } })))
        .status,
    ).toBe(400);
  });

  it("saves and reads back a valid patch, leaving the rest of the row untouched", async () => {
    const table = fakePreferencesTable({
      [ownerId]: { preferences: { density: "spacious" }, updated_at: "2026-08-25T00:00:00.000Z" },
    });
    mocks.from.mockImplementation(table.from);

    const response = await putRosterSettings(
      request("https://x.test/api/roster/settings", "PUT", {
        calendarShifts: true,
        rowName: "Dr Alex Example",
        codes: { "Example Hospital": { ADO: { kind: "off" } } },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      calendarShifts: true,
      alerts: { changes: true, requests: true },
      rowName: "Dr Alex Example",
      codes: { "Example Hospital": { ADO: { kind: "off" } } },
    });
    const stored = table.rows.get(ownerId)?.preferences as { density: string; roster: unknown };
    expect(stored.density).toBe("spacious");

    const getResponse = await getRosterSettings(request("https://x.test/api/roster/settings", "GET"));
    expect(await getResponse.json()).toMatchObject({ calendarShifts: true, rowName: "Dr Alex Example" });
  });

  it("merges codes per workplace: a patch replaces only the workplaces it names, and null removes one", async () => {
    const table = fakePreferencesTable({
      [ownerId]: {
        preferences: {
          roster: {
            codes: {
              "Example Hospital": { ADO: { kind: "off" } },
              "Example Clinic": { N: { kind: "night", start: "21:30", end: "08:00" } },
            },
          },
        },
        updated_at: "2026-08-25T00:00:00.000Z",
      },
    });
    mocks.from.mockImplementation(table.from);
    const put = (body: unknown) => putRosterSettings(request("https://x.test/api/roster/settings", "PUT", body));

    const merged = await put({ codes: { "Example Hospital": { ADO: { kind: "off" }, AL: { kind: "off" } } } });
    expect(merged.status).toBe(200);
    expect(((await merged.json()) as { codes: object }).codes).toEqual({
      "Example Hospital": { ADO: { kind: "off" }, AL: { kind: "off" } },
      "Example Clinic": { N: { kind: "night", start: "21:30", end: "08:00" } },
    });

    // An empty patch (as sent by a screen whose settings never loaded) wipes nothing.
    expect(((await (await put({ codes: {} })).json()) as { codes: object }).codes).toHaveProperty("Example Clinic");

    const removed = await put({ codes: { "Example Clinic": null } });
    expect(((await removed.json()) as { codes: object }).codes).toEqual({
      "Example Hospital": { ADO: { kind: "off" }, AL: { kind: "off" } },
    });
  });

  it("clears Roster settings for Delete my data, carrying every other key through, and is safe to repeat", async () => {
    const table = fakePreferencesTable({
      [ownerId]: {
        preferences: { density: "compact", reminders: { enabled: true }, roster: { rowName: "Dr Alex Example" } },
        updated_at: "2026-08-25T00:00:00.000Z",
      },
    });
    const admin = { from: table.from } as unknown as ReturnType<typeof createAdminClient>;
    await clearRosterSettings(admin, ownerId);
    expect(table.rows.get(ownerId)?.preferences).toEqual({ density: "compact", reminders: { enabled: true } });
    const afterFirst = table.rows.get(ownerId)?.updated_at;
    await clearRosterSettings(admin, ownerId);
    expect(table.rows.get(ownerId)?.updated_at).toBe(afterFirst);
    await clearRosterSettings(admin, "22222222-2222-4222-8222-222222222222");
    expect(table.rows.has("22222222-2222-4222-8222-222222222222")).toBe(false);
  });

  it("refuses a signed-out request, and refuses writes in demo mode", async () => {
    mocks.auth.mockRejectedValue(new AuthenticationError("no session"));
    expect((await getRosterSettings(request("https://x.test/api/roster/settings", "GET"))).status).toBe(401);
    mocks.auth.mockResolvedValue({ id: ownerId });
    mocks.demo.mockReturnValue(true);
    expect(
      (await putRosterSettings(request("https://x.test/api/roster/settings", "PUT", { calendarShifts: true }))).status,
    ).toBe(400);
  });
});
