import { afterEach, describe, expect, it, vi } from "vitest";

import { EMPTY_APPLICATIONS } from "@/lib/cme/applications";
import { EMPTY_EXAM_PREP, EMPTY_TERM_TRACKER } from "@/lib/teaching/term-tracker";
import { emptyPaperwork } from "@/lib/work-screens/admin/paperwork-model";
import { isEmptyWorkSyncValue, mergeWorkSyncValues } from "@/lib/work-sync/merge";
import { WORK_SYNC_QUICK_NOTE_LIMIT } from "@/lib/work-sync/sections";

vi.mock("server-only", () => ({}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

const INITIAL_UPDATED_AT = "2026-10-07T00:00:00.000Z";

function mockDatabase(existing: Record<string, unknown> | null, { failWrite }: { failWrite?: string } = {}) {
  let row = existing ? { preferences: structuredClone(existing), updated_at: INITIAL_UPDATED_AT } : null;
  const maybeSingle = vi.fn(async () => ({ data: row ? structuredClone(row) : null, error: null }));
  const select = vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) }));
  const insert = vi.fn(async (value: { preferences: Record<string, unknown>; updated_at: string }) => {
    if (failWrite) return { error: { code: failWrite, message: "refused" } };
    if (row) return { error: { code: "23505", message: "duplicate key" } };
    row = { preferences: structuredClone(value.preferences), updated_at: value.updated_at };
    return { error: null };
  });
  const update = vi.fn((value: { preferences: Record<string, unknown>; updated_at: string }) => {
    const filters = new Map<string, unknown>();
    const builder = {
      eq(field: string, expected: unknown) {
        filters.set(field, expected);
        return builder;
      },
      select() {
        return {
          maybeSingle: async () => {
            if (failWrite) return { data: null, error: { code: failWrite, message: "refused" } };
            if (!row || filters.get("updated_at") !== row.updated_at) return { data: null, error: null };
            row = { preferences: structuredClone(value.preferences), updated_at: value.updated_at };
            return { data: { updated_at: row.updated_at }, error: null };
          },
        };
      },
    };
    return builder;
  });
  // The record tables: one row per owner (and section), replaced whole by an upsert.
  const tables = {
    work_admin_paperwork: new Map<string, { section?: string; record: unknown; updated_at: string }>(),
    work_backups: new Map<string, { section?: string; record: unknown; updated_at: string }>(),
  };
  const upsert = vi.fn(async (table: keyof typeof tables, value: Record<string, unknown>) => {
    if (failWrite) return { error: { code: failWrite, message: "refused" } };
    const section = typeof value.section === "string" ? value.section : undefined;
    tables[table].set(section ?? "row", {
      section,
      record: structuredClone(value.record),
      updated_at: String(value.updated_at),
    });
    return { error: null };
  });
  const tableBuilder = (table: keyof typeof tables) => ({
    upsert: (value: Record<string, unknown>) => upsert(table, value),
    select: () => ({
      eq: () => {
        const rows = [...tables[table].values()].map((row) => structuredClone(row));
        return Object.assign(Promise.resolve({ data: rows, error: null }), {
          maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        });
      },
    }),
  });
  const from = vi.fn((table: string) =>
    table === "work_admin_paperwork" || table === "work_backups" ? tableBuilder(table) : { insert, select, update },
  );
  vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from }) }));
  vi.doMock("@/lib/supabase/auth", () => ({
    AuthenticationError: class AuthenticationError extends Error {},
    requireAuthenticatedUser: vi.fn(async () => ({ id: "user-work-sync-1" })),
    unauthorizedResponse: () => new Response("unauthorized", { status: 401 }),
  }));
  vi.doMock("@/lib/api-rate-limit", () => ({
    allowRateLimitInMemoryFallbackOnUnavailable: () => true,
    consumeSubjectApiRateLimit: vi.fn(async () => ({ limited: false })),
    rateLimitJsonResponse: () => new Response("limited", { status: 429 }),
  }));
  vi.doMock("@/lib/env", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/env")>()),
    isDemoMode: () => false,
  }));
  return { current: () => row?.preferences, update, insert, upsert, tables };
}

function put(body: unknown) {
  return new Request("http://local.test/api/work/sync", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const applications = {
  ...EMPTY_APPLICATIONS,
  referees: [{ id: "ref-1", name: "Dr Lee", role: "Consultant", status: "asked", history: [] }],
  statement: "I want to train in psychiatry.",
};

const star = { areaId: "day", itemId: "hours", starredAt: 1_759_000_000_000, pinnedAt: null, openedAt: null };

describe("/api/work/sync", () => {
  it("saves one section and carries every other key on the row through", async () => {
    const roster = { calendarShifts: true };
    const database = mockDatabase({ density: "compact", roster });
    const { PUT, GET } = await import("@/app/api/work/sync/route");
    const response = await PUT(put({ section: "favouriteWorkPages", value: [star] }));
    expect(response.status).toBe(200);
    expect(database.current()).toMatchObject({
      density: "compact",
      roster,
      work: { favouriteWorkPages: { value: [star] } },
    });

    const read = await (await GET(new Request("http://local.test/api/work/sync"))).json();
    expect(read.sections.favouriteWorkPages.value).toEqual([star]);
    expect(read.sections).not.toHaveProperty("myDayQuickNote");
  });

  it("creates the row for an account that has none", async () => {
    const database = mockDatabase(null);
    const { PUT } = await import("@/app/api/work/sync/route");
    expect((await PUT(put({ section: "myDayHiddenCards", value: ["cpd", "hours"] }))).status).toBe(200);
    expect(database.insert).toHaveBeenCalledOnce();
    expect(database.current()).toMatchObject({ work: { myDayHiddenCards: { value: ["cpd", "hours"] } } });
  });

  it("keeps a cleared section as null so other devices clear it too", async () => {
    const database = mockDatabase({
      work: { myDaySnoozes: { value: { "roster:x:1": "2026-10-09" }, updatedAt: INITIAL_UPDATED_AT } },
    });
    const { PUT } = await import("@/app/api/work/sync/route");
    expect((await PUT(put({ section: "myDaySnoozes", value: null }))).status).toBe(200);
    expect(database.current()).toMatchObject({ work: { myDaySnoozes: { value: null } } });
  });

  it.each([
    ["an unknown section", { section: "remindMe", value: [] }],
    ["paperwork that is not a record", { section: "adminPaperwork", value: [] }],
    ["a term tracker from another version", { section: "teachingTermTracker", value: { version: 2 } }],
    ["an unknown work area", { section: "favouriteWorkPages", value: [{ ...star, areaId: "nowhere" }] }],
    ["an unknown card", { section: "myDayHiddenCards", value: ["not-a-card"] }],
    ["a snooze that is not a date", { section: "myDaySnoozes", value: { a: "tomorrow" } }],
    ["a note over the limit", { section: "myDayQuickNote", value: "x".repeat(WORK_SYNC_QUICK_NOTE_LIMIT + 1) }],
    ["an extra field", { section: "myDayQuickNote", value: "Call pharmacy", extra: true }],
  ])("refuses %s", async (_label, body) => {
    const database = mockDatabase({});
    const { PUT } = await import("@/app/api/work/sync/route");
    expect((await PUT(put(body))).status).toBe(400);
    expect(database.update).not.toHaveBeenCalled();
    expect(database.upsert).not.toHaveBeenCalled();
  });

  it("keeps Admin paperwork in its own table and the Teaching and CPD records in the backups table", async () => {
    const database = mockDatabase({ density: "compact" });
    const { PUT, GET } = await import("@/app/api/work/sync/route");
    const paperwork = { ...emptyPaperwork(), payslips: [] };
    expect((await PUT(put({ section: "adminPaperwork", value: paperwork }))).status).toBe(200);
    expect((await PUT(put({ section: "teachingExamPrep", value: EMPTY_EXAM_PREP }))).status).toBe(200);
    expect((await PUT(put({ section: "cpdApplications", value: applications }))).status).toBe(200);

    expect(database.tables.work_admin_paperwork.get("row")?.record).toEqual(paperwork);
    expect(database.tables.work_backups.get("exam_prep")?.record).toEqual(EMPTY_EXAM_PREP);
    expect(database.tables.work_backups.get("job_applications")?.record).toEqual(applications);
    // The preferences row is untouched: the records never count against its size check.
    expect(database.update).not.toHaveBeenCalled();
    expect(database.current()).toEqual({ density: "compact" });

    const read = await (await GET(new Request("http://local.test/api/work/sync"))).json();
    expect(read.sections.adminPaperwork.value).toEqual(paperwork);
    expect(read.sections.teachingExamPrep.value).toEqual(EMPTY_EXAM_PREP);
    expect(read.sections.cpdApplications.value).toEqual(applications);
    expect(read.sections).not.toHaveProperty("teachingTermTracker");
  });

  it("keeps a cleared record as null so other devices clear it too", async () => {
    const database = mockDatabase({});
    const { PUT } = await import("@/app/api/work/sync/route");
    expect((await PUT(put({ section: "teachingTermTracker", value: EMPTY_TERM_TRACKER }))).status).toBe(200);
    expect((await PUT(put({ section: "teachingTermTracker", value: null }))).status).toBe(200);
    expect(database.tables.work_backups.get("term_tracker")?.record).toBeNull();
  });

  it("refuses job applications holding text their own checks would drop", async () => {
    const database = mockDatabase({});
    const { PUT } = await import("@/app/api/work/sync/route");
    const response = await PUT(
      put({ section: "cpdApplications", value: { ...applications, statement: "I looked after Mr Smith in bed 12" } }),
    );
    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe("patient_detail");
    expect(database.upsert).not.toHaveBeenCalled();
  });

  it("says plainly when a record is too big for the account", async () => {
    mockDatabase({}, { failWrite: "23514" });
    const { PUT } = await import("@/app/api/work/sync/route");
    const response = await PUT(put({ section: "adminPaperwork", value: emptyPaperwork() }));
    expect(response.status).toBe(413);
  });

  it("refuses a quick note that reads as a patient detail, and saves a safe one", async () => {
    const database = mockDatabase({});
    const { PUT } = await import("@/app/api/work/sync/route");
    const refused = await PUT(put({ section: "myDayQuickNote", value: "Check bloods for Mr Smith bed 12" }));
    expect(refused.status).toBe(422);
    expect((await refused.json()).code).toBe("patient_detail");
    expect(database.update).not.toHaveBeenCalled();

    expect((await PUT(put({ section: "myDayQuickNote", value: "Ring pharmacy on Monday" }))).status).toBe(200);
    expect(database.current()).toMatchObject({ work: { myDayQuickNote: { value: "Ring pharmacy on Monday" } } });
  });

  it("says plainly when the account row is full", async () => {
    mockDatabase({}, { failWrite: "23514" });
    const { PUT } = await import("@/app/api/work/sync/route");
    const response = await PUT(put({ section: "myDayHiddenCards", value: ["cpd"] }));
    expect(response.status).toBe(413);
    expect((await response.json()).code).toBe("work_sync_full");
  });

  it("drops stored sections that no longer validate", async () => {
    mockDatabase({
      work: {
        myDayHiddenCards: { value: ["not-a-card"], updatedAt: INITIAL_UPDATED_AT },
        myDayQuickNote: { value: "Ring pharmacy", updatedAt: "garbage" },
        favouriteWorkPages: { value: [star], updatedAt: INITIAL_UPDATED_AT },
      },
    });
    const { GET } = await import("@/app/api/work/sync/route");
    const read = await (await GET(new Request("http://local.test/api/work/sync"))).json();
    expect(Object.keys(read.sections)).toEqual(["favouriteWorkPages"]);
  });
});

describe("mergeWorkSyncValues", () => {
  it("keeps the account's saved pages first, then this device's extras, once each", () => {
    const other = { ...star, itemId: "leave" };
    expect(mergeWorkSyncValues("favouriteWorkPages", [other, star], [star])).toEqual([star, other]);
  });

  it("joins hidden cards and keeps the later return date for a moved item", () => {
    expect(mergeWorkSyncValues("myDayHiddenCards", ["cpd"], ["hours", "cpd"])).toEqual(["hours", "cpd"]);
    expect(
      mergeWorkSyncValues("myDaySnoozes", { a: "2026-10-10", b: "2026-10-08" }, { a: "2026-10-09", c: "2026-10-11" }),
    ).toEqual({ a: "2026-10-10", b: "2026-10-08", c: "2026-10-11" });
  });

  it("keeps both quick notes when they differ and fit, otherwise the account's", () => {
    expect(mergeWorkSyncValues("myDayQuickNote", "Book leave", "Ring pharmacy")).toBe("Ring pharmacy\nBook leave");
    expect(mergeWorkSyncValues("myDayQuickNote", "Same", "Same")).toBe("Same");
    expect(mergeWorkSyncValues("myDayQuickNote", "x".repeat(400), "y".repeat(200))).toBe("y".repeat(200));
  });

  it("joins two copies of a record, keeping every entry with an id once and the account's version", () => {
    const local = {
      ...applications,
      referees: [
        { id: "ref-1", name: "Dr Lee", role: "Registrar", status: "asked", history: [] },
        { id: "ref-2", name: "Dr Tan", role: "Consultant", status: "asked", history: [] },
      ],
      statement: "Device draft",
    };
    const merged = mergeWorkSyncValues("cpdApplications", local, applications) as typeof applications;
    expect(merged.referees.map((referee) => [referee.id, referee.role])).toEqual([
      ["ref-1", "Consultant"],
      ["ref-2", "Consultant"],
    ]);
    expect(merged.statement).toBe(applications.statement);
  });

  it("keeps the account's record when the joined one would not read back", () => {
    const referee = (index: number) => ({ id: `r${index}`, name: "Dr Lee", role: "", status: "asked", history: [] });
    const account = { ...applications, referees: Array.from({ length: 5 }, (_, index) => referee(index)) };
    const local = { ...applications, referees: Array.from({ length: 5 }, (_, index) => referee(index + 5)) };
    expect(mergeWorkSyncValues("cpdApplications", local, account)).toEqual(account);
  });

  it("treats empty arrays, maps and blank text as nothing", () => {
    expect([[], {}, " ", null].every(isEmptyWorkSyncValue)).toBe(true);
    expect(isEmptyWorkSyncValue(["cpd"])).toBe(false);
  });
});
