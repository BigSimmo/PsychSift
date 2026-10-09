import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The private calendar link with Teaching sessions in it. Invented data only.

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  rate: vi.fn(),
  cmeYear: vi.fn(),
  cmeRoutines: vi.fn(),
  onCall: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc, from: mocks.from }) }));
vi.mock("@/lib/env", () => ({ isDemoMode: () => false }));
vi.mock("@/lib/logger", () => ({ logger: { error: mocks.error, warn: mocks.warn, info: vi.fn() } }));
vi.mock("@/lib/api-rate-limit", () => ({
  consumeSubjectApiRateLimit: mocks.rate,
  allowRateLimitInMemoryFallbackOnUnavailable: () => false,
}));
vi.mock("@/lib/cme/repository", () => ({
  fetchOwnerCmeYear: mocks.cmeYear,
  fetchOwnerCmeRoutines: mocks.cmeRoutines,
}));
vi.mock("@/lib/on-call/repository", () => ({ fetchVisibleOnCallEntries: mocks.onCall }));
// Published rotations have their own source and tests (tests/roster-rotations-feed.test.ts).
vi.mock("@/lib/calendar/rotation-feed-source", () => ({ fetchRotationFeedEvents: async () => [] }));

import { GET as feed } from "@/app/api/calendar/feed/[token]/route";

const ownerId = "11111111-1111-4111-8111-111111111111";
const serviceId = "22222222-2222-4222-8222-222222222222";
const journalClub = "33333333-3333-4333-8333-333333333333";
const caseConference = "44444444-4444-4444-8444-444444444444";
const token = "C".repeat(43);

function feedSession(occurrenceId: string, title: string, startsAt: string, status: string) {
  return {
    occurrenceId,
    serviceId,
    title,
    startsAt,
    endsAt: new Date(Date.parse(startsAt) + 3_600_000).toISOString(),
    venue: "Invented room",
    hasJoinLink: true,
    status,
    isPresenter: false,
    source: "teaching",
    // Fields a feed must never carry, whatever the database returns.
    joinUrl: "https://example.org/secret-join",
    presenterName: "Dr Invented Presenter",
  };
}

const sessions = [
  feedSession(journalClub, "Invented journal club", "2026-10-01T04:30:00.000Z", "scheduled"),
  feedSession(caseConference, "Invented case conference", "2026-10-02T04:30:00.000Z", "cancelled"),
];

function database(teachingFeed: { data: unknown; error: unknown }) {
  mocks.rpc.mockImplementation(async (name: string) => {
    if (name === "calendar_feed_owner") return { data: ownerId, error: null };
    if (name === "teaching_feed_events") return teachingFeed;
    return { data: null, error: { message: `unexpected ${name}` } };
  });
}

/** Teaching reminders on, one day before, as a doctor would set them in Settings. */
function teachingRemindersOn() {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: { preferences: { reminders: { types: { teaching: { calendarAlert: "1d" } } } } },
    error: null,
  });
  mocks.from.mockReturnValue({ select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) })) });
}

async function readFeed() {
  const response = await feed(new Request(`https://psychiatry.tools/api/calendar/feed/${token}.ics`), {
    params: Promise.resolve({ token: `${token}.ics` }),
  });
  return { status: response.status, body: await response.text() };
}

function eventBlock(body: string, summary: string): string {
  const block = body.split("BEGIN:VEVENT").find((part) => part.includes(`SUMMARY:${summary}\r\n`));
  if (!block) throw new Error(`no event with SUMMARY:${summary}`);
  return block.slice(0, block.indexOf("END:VEVENT"));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-26T00:00:00Z"));
  mocks.rate.mockResolvedValue({ limited: false });
  mocks.cmeYear.mockResolvedValue(null);
  mocks.cmeRoutines.mockResolvedValue([]);
  mocks.onCall.mockResolvedValue([]);
  teachingRemindersOn();
  database({ data: { sessions }, error: null });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Teaching in the private calendar link", () => {
  it("reads the owner's opted-in sessions from a week back to 90 days ahead, in Perth dates", async () => {
    await readFeed();
    expect(mocks.rpc).toHaveBeenCalledWith("teaching_feed_events", {
      p_owner_id: ownerId,
      p_from: "2026-09-19",
      p_to: "2026-12-25",
    });
  });

  // Review focus 2: a cancelled session must never ring, even with teaching reminders switched on.
  it("marks a cancelled session cancelled, in words, with no alarm, while a scheduled one still rings", async () => {
    const { status, body } = await readFeed();
    expect(status).toBe(200);

    const cancelled = eventBlock(body, "Cancelled: Invented case conference");
    expect(cancelled).toContain(`UID:teaching-${caseConference}@psychiatry.tools`);
    expect(cancelled).toContain("STATUS:CANCELLED");
    expect(cancelled).not.toContain("VALARM");

    const scheduled = eventBlock(body, "Invented journal club");
    expect(scheduled).toContain("DTSTART:20261001T043000Z");
    expect(scheduled).toContain("BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER;VALUE=DATE-TIME:20260930T043000Z\r\n");
    expect(scheduled).not.toContain("STATUS:");
  });

  it("never carries a join link or a presenter, whatever the database returns", async () => {
    const { body } = await readFeed();
    expect(body).not.toContain("secret-join");
    expect(body).not.toContain("Invented Presenter");
  });

  it("still serves the rest of the feed while Teaching's database change is not live", async () => {
    database({ data: null, error: { message: "Could not find the function", code: "PGRST202" } });
    mocks.onCall.mockResolvedValue([
      {
        id: "55555555-5555-4555-8555-555555555555",
        section: "education",
        slug: "invented-teaching",
        title: "Invented On Call teaching",
        subtitle: null,
        body: null,
        details: { nextOccurrenceDate: "2026-10-01", nextOccurrence: "12:30" },
        linkedDocumentIds: [],
        tags: [],
        isPersonal: false,
        includeOnCard: false,
        sortOrder: 0,
        lastVerifiedAt: null,
      },
    ]);
    const { status, body } = await readFeed();
    expect(status).toBe(200);
    expect(body).toContain("SUMMARY:Invented On Call teaching");
    expect(body).not.toContain("Invented journal club");
    expect(mocks.warn).toHaveBeenCalled();
  });

  it("fails closed, so calendars keep their last copy, when Teaching's read fails for any other reason", async () => {
    database({ data: null, error: { message: "connection refused" } });
    const { status, body } = await readFeed();
    expect(status).toBe(503);
    expect(body).not.toContain("connection refused");
  });

  it("fails closed when the database returns a shape it should not", async () => {
    database({ data: { sessions: [{ occurrenceId: journalClub }] }, error: null });
    expect((await readFeed()).status).toBe(503);
  });
});
