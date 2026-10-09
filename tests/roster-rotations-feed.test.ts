import { beforeEach, describe, expect, it, vi } from "vitest";

/** Published rotations on the doctor's private calendar link. */

const SERVICE = "7b000000-0000-4000-8000-000000000001";
const OWNER = "7b000000-0000-4000-8000-000000000002";
const OTHER = "7b000000-0000-4000-8000-000000000003";

const mocks = vi.hoisted(() => ({
  release: vi.fn(),
  rows: {} as Record<string, Record<string, unknown>[]>,
  error: null as null | { code: string; message: string },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/roster/team/release", () => ({ rosterTeamReleaseEnabled: mocks.release }));

function client() {
  return {
    from(table: string) {
      const filters: Array<(row: Record<string, unknown>) => boolean> = [];
      const builder = {
        select: () => builder,
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
        then(resolve: (value: unknown) => unknown) {
          if (table === "roster_rotation_rounds" && mocks.error)
            return Promise.resolve(resolve({ data: null, error: mocks.error }));
          const data = (mocks.rows[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
          return Promise.resolve(resolve({ data, error: null }));
        },
      };
      return builder;
    },
  } as never;
}

import { fetchRotationFeedEvents } from "@/lib/calendar/rotation-feed-source";

function round(status: string) {
  return {
    id: "7b000000-0000-4000-8000-0000000000aa",
    service_id: SERVICE,
    status,
    setup: {
      name: "2027 registrar rotations",
      closesAt: "2026-12-01T08:00:00+08:00",
      minRanked: 1,
      terms: [
        { id: "t0", label: "Term 0", start: "2026-08-01", end: "2026-09-01" },
        { id: "t1", label: "Term 1", start: "2027-02-01", end: "2027-04-30" },
      ],
      rotations: [{ id: "cl", name: "Consultation liaison", site: "Example Hospital", places: 2 }],
      people: [
        { id: OWNER, name: "Dr Sam Karri" },
        { id: OTHER, name: "Dr Jo Banksia" },
      ],
    },
    locks: [],
    allocation: {
      runAt: "2026-12-02T00:00:00Z",
      placements: [
        { personId: OWNER, termId: "t0", rotationId: "cl", rank: 1, locked: false, reason: "" },
        { personId: OWNER, termId: "t1", rotationId: "cl", rank: 1, locked: false, reason: "" },
        { personId: OTHER, termId: "t1", rotationId: "cl", rank: 1, locked: false, reason: "" },
      ],
      unfilled: [],
      summary: { people: 2, placements: 3, byRank: [3], unranked: 0, unfilled: 0, peopleWithFirstChoice: 2 },
      problems: [],
    },
    admin_name: "Dr Alex Jarrah",
    version: 2,
    created_at: "2026-10-01T00:00:00Z",
    opened_at: "2026-10-02T00:00:00Z",
    published_at: "2026-12-02T00:00:00Z",
    updated_at: "2026-12-02T00:00:00Z",
  };
}

const NOW = new Date("2026-10-09T02:00:00Z");

beforeEach(() => {
  mocks.release.mockReturnValue(true);
  mocks.error = null;
  mocks.rows = {
    on_call_service_members: [{ service_id: SERVICE, user_id: OWNER, revoked_at: null }],
    on_call_services: [
      { id: SERVICE, name: "Psychiatry registrars", verified_at: "2026-09-30T00:00:00Z", is_demo: false },
    ],
    roster_rotation_rounds: [round("published")],
  };
});

describe("rotation calendar feed source", () => {
  it("adds the owner's own published rotation as start and end days, and nothing about anyone else", async () => {
    const events = await fetchRotationFeedEvents(client(), OWNER, NOW);
    expect(events).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/-t1-start$/),
        title: "Rotation starts: Consultation liaison",
        date: "2027-02-01",
      }),
      expect.objectContaining({
        id: expect.stringMatching(/-t1-end$/),
        title: "Rotation ends: Consultation liaison",
        date: "2027-04-30",
      }),
    ]);
    // The finished term (ended more than two weeks ago) has left the feed; no site, no other names.
    const text = JSON.stringify(events);
    expect(text).not.toContain("Example Hospital");
    expect(text).not.toContain("Banksia");
    expect(events.every((event) => event.startTime === undefined && event.alarmAt === undefined)).toBe(true);
  });

  it("adds nothing before the round is published, or for someone who left the team", async () => {
    mocks.rows.roster_rotation_rounds = [round("closed")];
    expect(await fetchRotationFeedEvents(client(), OWNER, NOW)).toEqual([]);
    mocks.rows.roster_rotation_rounds = [round("published")];
    mocks.rows.on_call_service_members = [{ service_id: SERVICE, user_id: OWNER, revoked_at: "2026-10-01T00:00:00Z" }];
    expect(await fetchRotationFeedEvents(client(), OWNER, NOW)).toEqual([]);
  });

  it("adds nothing while the release is held or before the tables exist", async () => {
    mocks.release.mockReturnValue(false);
    expect(await fetchRotationFeedEvents(client(), OWNER, NOW)).toEqual([]);
    mocks.release.mockReturnValue(true);
    mocks.error = { code: "42P01", message: "relation does not exist" };
    expect(await fetchRotationFeedEvents(client(), OWNER, NOW)).toEqual([]);
  });

  it("fails the feed on any other database error, so calendars keep their last copy", async () => {
    mocks.error = { code: "57014", message: "statement timeout" };
    await expect(fetchRotationFeedEvents(client(), OWNER, NOW)).rejects.toThrow();
  });
});
