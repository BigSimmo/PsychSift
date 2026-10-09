import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OnCallEntry } from "@/lib/on-call/entry-model";

// The private calendar link, with the owner's reminder settings applied. Invented data only.

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  rate: vi.fn(),
  cmeYear: vi.fn(),
  cmeRoutines: vi.fn(),
  onCall: vi.fn(),
  teachingFeed: vi.fn(),
  warn: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc, from: mocks.from }) }));
vi.mock("@/lib/env", () => ({ isDemoMode: () => false }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: mocks.warn, info: vi.fn() } }));
vi.mock("@/lib/api-rate-limit", () => ({
  consumeSubjectApiRateLimit: mocks.rate,
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

import { GET as feed } from "@/app/api/calendar/feed/[token]/route";

const ownerId = "11111111-1111-4111-8111-111111111111";
const token = "B".repeat(43);

const session: OnCallEntry = {
  id: "22222222-2222-4222-8222-222222222222",
  section: "education",
  slug: "invented-teaching",
  title: "Invented teaching",
  subtitle: null,
  body: null,
  details: { nextOccurrenceDate: "2026-10-01", nextOccurrence: "12:30" },
  linkedDocumentIds: [],
  tags: [],
  isPersonal: false,
  includeOnCard: false,
  sortOrder: 0,
  lastVerifiedAt: null,
} as OnCallEntry;

function preferencesRead(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  mocks.from.mockReturnValue({ select });
  return { select, eq };
}

async function readFeed() {
  const response = await feed(new Request(`https://psychiatry.tools/api/calendar/feed/${token}.ics`), {
    params: Promise.resolve({ token: `${token}.ics` }),
  });
  return { status: response.status, body: await response.text() };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Only the clock is faked, so the alarm is never in the past whenever this runs.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-26T00:00:00Z"));
  mocks.rate.mockResolvedValue({ limited: false });
  mocks.rpc.mockResolvedValue({ data: ownerId, error: null });
  mocks.cmeYear.mockResolvedValue(null);
  mocks.cmeRoutines.mockResolvedValue([]);
  mocks.onCall.mockResolvedValue([session]);
  mocks.teachingFeed.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("calendar link alarms", () => {
  it("reads only the feed owner's preferences and adds the alarm they chose", async () => {
    const read = preferencesRead({
      data: { preferences: { reminders: { types: { teaching: { calendarAlert: "1d" } } } } },
      error: null,
    });
    const { status, body } = await readFeed();
    expect(status).toBe(200);
    expect(mocks.from).toHaveBeenCalledWith("user_preferences");
    expect(read.select).toHaveBeenCalledWith("preferences");
    expect(read.eq).toHaveBeenCalledWith("user_id", ownerId);
    // 12:30 Perth on 1 Oct 2026 is 04:30Z; one day before.
    expect(body).toContain("BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER;VALUE=DATE-TIME:20260930T043000Z\r\n");
  });

  it("carries no alarms with the default settings", async () => {
    preferencesRead({ data: null, error: null });
    const { status, body } = await readFeed();
    expect(status).toBe(200);
    expect(body).toContain("SUMMARY:Invented teaching");
    expect(body).not.toContain("VALARM");
  });

  it("still serves the feed, without alarms, when the settings cannot be read", async () => {
    preferencesRead({ data: null, error: { message: "connection refused" } });
    const { status, body } = await readFeed();
    expect(status).toBe(200);
    expect(body).toContain("SUMMARY:Invented teaching");
    expect(body).not.toContain("VALARM");
    expect(mocks.warn).toHaveBeenCalled();
  });
});
