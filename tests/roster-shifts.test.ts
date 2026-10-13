import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { diffRoster, rosterWindow } from "@/lib/roster/shifts/diff";
import type { OnCallShift, OnCallShiftInput } from "@/lib/roster/shifts/model";
import { ON_CALL_SHIFT_IMPORT_MAX, onCallShiftImportRequestSchema } from "@/lib/roster/shifts/model";
import { describeNextShift, shiftHours } from "@/lib/roster/shifts/next-shift";
import { parseRosterCsv } from "@/lib/roster/shifts/parse-csv";
import { parseRosterIcs } from "@/lib/roster/shifts/parse-ics";
import { formatPerthDay, perthWallToIso } from "@/lib/roster/shifts/perth-time";

/*
 * My shifts: reading a roster on the device, working out what changed, the
 * next-shift wording, and the API's promise that a roster is its owner's alone.
 * Every roster here is invented.
 */

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  auth: vi.fn(),
  demo: vi.fn(),
  rate: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.from, rpc: mocks.rpc }) }));
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

import { DELETE, GET, POST } from "@/app/api/roster/shifts/route";
import { DELETE as legacyDelete, GET as legacyGet, POST as legacyPost } from "@/app/api/on-call/shifts/route";
import { PATCH } from "@/app/api/roster/shifts/imports/[id]/route";
import { DELETE as deleteManualShiftSeries } from "@/app/api/roster/shifts/manual/[seriesId]/route";
import { POST as postManualShift } from "@/app/api/roster/shifts/manual/route";
import { AuthenticationError } from "@/lib/supabase/auth";

const ownerId = "11111111-1111-4111-8111-111111111111";
const otherOwnerId = "22222222-2222-4222-8222-222222222222";
const importId = "33333333-3333-4333-8333-333333333333";
const seriesId = "44444444-4444-4444-8444-444444444444";

function shift(
  date: string,
  start: string,
  end: string,
  title = "Registrar on call",
  extra: Partial<OnCallShiftInput> = {},
) {
  const startsAt = perthWallToIso(date, start)!;
  let endsAt = perthWallToIso(date, end)!;
  if (Date.parse(endsAt) <= Date.parse(startsAt)) endsAt = new Date(Date.parse(endsAt) + 86_400_000).toISOString();
  return { startsAt, endsAt, title, location: null, sourceUid: null, ...extra } satisfies OnCallShiftInput;
}

describe("reading an .ics roster", () => {
  it("keeps times, title, site and ID, and drops descriptions and attendees", () => {
    const text = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:shift-1@example.test",
      "DTSTART;TZID=Australia/Perth:20261005T080000",
      "DTEND;TZID=Australia/Perth:20261005T170000",
      "SUMMARY:Registrar on call",
      "LOCATION:Example Hospital",
      "DESCRIPTION:Handover from Dr Example",
      "ATTENDEE;CN=Dr Example:mailto:someone@example.test",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const result = parseRosterIcs(text);
    expect(result.shifts).toEqual([
      {
        startsAt: "2026-10-05T00:00:00.000Z",
        endsAt: "2026-10-05T09:00:00.000Z",
        title: "Registrar on call",
        location: "Example Hospital",
        sourceUid: "shift-1@example.test",
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("Dr Example");
    expect(JSON.stringify(result)).not.toContain("someone@example.test");
  });

  it("reads UTC times and folded lines, and skips all-day, cancelled and repeating events with a note", () => {
    const text = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "DTSTART:20261006T130000Z",
      "DTEND:20261007T000000Z",
      "SUMMARY:Night",
      "  shift",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:20261008",
      "SUMMARY:Leave",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "STATUS:CANCELLED",
      "DTSTART:20261009T000000Z",
      "DTEND:20261009T080000Z",
      "SUMMARY:Cancelled",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "DTSTART:20261010T000000Z",
      "DTEND:20261010T080000Z",
      "RRULE:FREQ=WEEKLY",
      "SUMMARY:Clinic",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");
    const result = parseRosterIcs(text);
    expect(result.shifts).toHaveLength(1);
    expect(result.shifts[0]).toMatchObject({ title: "Night shift", startsAt: "2026-10-06T13:00:00.000Z" });
    expect(result.notes.length).toBeGreaterThan(0);
  });

  it("reads a time with no zone as Perth time", () => {
    const text = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "DTSTART:20261005T080000",
      "DTEND:20261005T170000",
      "SUMMARY:Day",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");
    expect(parseRosterIcs(text).shifts[0]?.startsAt).toBe("2026-10-05T00:00:00.000Z");
  });
});

describe("reading a .csv roster", () => {
  it("reads named columns in either date style and rolls an overnight end to the next day", () => {
    const text = [
      "Date,Start,Finish,Role,Site",
      "2026-10-05,08:00,17:00,Registrar on call,Example Hospital",
      "06/10/2026,2100,0800,Night registrar,",
    ].join("\n");
    const result = parseRosterCsv(text);
    expect(result.shifts).toEqual([
      {
        startsAt: "2026-10-05T00:00:00.000Z",
        endsAt: "2026-10-05T09:00:00.000Z",
        title: "Registrar on call",
        location: "Example Hospital",
        sourceUid: null,
      },
      {
        startsAt: "2026-10-06T13:00:00.000Z",
        endsAt: "2026-10-07T00:00:00.000Z",
        title: "Night registrar",
        location: null,
        sourceUid: null,
      },
    ]);
  });

  it("reports rows it cannot read instead of guessing", () => {
    const result = parseRosterCsv(["date,start,end", "not a date,08:00,17:00", "2026-10-05,08:00,17:00"].join("\n"));
    expect(result.shifts).toHaveLength(1);
    expect(result.notes.join(" ")).toMatch(/1/);
  });
});

describe("what a new roster changes", () => {
  const window = { start: "2026-10-05", end: "2026-10-11" };

  it("counts added, moved and removed shifts, matching by calendar ID first", () => {
    const stored = [
      shift("2026-10-05", "08:00", "17:00", "Day", { sourceUid: "a" }),
      shift("2026-10-06", "08:00", "17:00", "Day"),
      shift("2026-10-07", "08:00", "17:00", "Day"),
    ];
    const incoming = [
      shift("2026-10-08", "08:00", "17:00", "Day", { sourceUid: "a" }),
      shift("2026-10-06", "08:00", "17:00", "Day"),
      shift("2026-10-09", "21:00", "08:00", "Night"),
    ];
    const diff = diffRoster(stored, incoming, window);
    expect(diff).toMatchObject({ added: 1, changed: 1, removed: 1 });
    expect(diff.changes.map((change) => change.kind)).toEqual(["removed", "moved", "added"]);
  });

  it("ignores stored shifts outside the new roster's dates", () => {
    const stored = [shift("2026-10-20", "08:00", "17:00")];
    expect(diffRoster(stored, [], window)).toMatchObject({ added: 0, changed: 0, removed: 0 });
  });

  it("gives the dates a roster covers", () => {
    expect(rosterWindow([shift("2026-10-07", "08:00", "17:00"), shift("2026-10-05", "21:00", "08:00")])).toEqual({
      start: "2026-10-05",
      end: "2026-10-07",
    });
    expect(rosterWindow([])).toBeNull();
  });
});

describe("the next shift", () => {
  const stored = (input: OnCallShiftInput, id: string): OnCallShift => ({
    ...input,
    id,
    source: "import",
    seriesId: null,
    workplace: null,
  });
  const now = new Date("2026-10-05T01:00:00.000Z"); // 09:00 Monday in Perth

  it("says a shift is on now, then counts down to one within twelve hours", () => {
    const onNow = describeNextShift([stored(shift("2026-10-05", "08:00", "17:00"), "1")], now);
    expect(onNow).toMatchObject({ onNow: true, when: "On now until 17:00" });
    const soon = describeNextShift([stored(shift("2026-10-05", "11:30", "17:00"), "1")], now);
    expect(soon?.when).toBe("Starts in 2 h 30 min");
  });

  it("names tomorrow and later days, and marks a shift that ends the next day", () => {
    const tomorrow = describeNextShift([stored(shift("2026-10-06", "21:00", "08:00"), "1")], now);
    expect(tomorrow?.when).toBe("Tomorrow at 21:00");
    expect(tomorrow?.hours).toBe("21:00 to 08:00 (next day)");
    const later = describeNextShift([stored(shift("2026-10-09", "08:00", "17:00"), "1")], now);
    expect(later?.when).toBe(`${formatPerthDay("2026-10-09")} at 08:00`);
    expect(shiftHours(shift("2026-10-09", "08:00", "17:00"))).toBe("08:00 to 17:00");
  });

  it("has nothing to say when every shift is over", () => {
    expect(describeNextShift([stored(shift("2026-10-04", "08:00", "17:00"), "1")], now)).toBeNull();
  });

  it("skips the past shifts the list now carries, and leads with the next future one", () => {
    const next = describeNextShift(
      [
        stored(shift("2026-09-20", "08:00", "17:00"), "past"),
        stored(shift("2026-10-04", "21:00", "08:00"), "last-night"),
        stored(shift("2026-10-07", "08:00", "17:00"), "future"),
      ],
      now,
    );
    expect(next?.shift.id).toBe("future");
    expect(next?.onNow).toBe(false);
  });
});

describe("the save request", () => {
  const base = {
    format: "ics" as const,
    workplace: null,
    fileName: null,
    windowStart: "2026-10-05",
    windowEnd: "2026-10-05",
  };

  it("refuses more shifts than one import may carry, and shifts that are too long", () => {
    const one = shift("2026-10-05", "08:00", "17:00");
    expect(onCallShiftImportRequestSchema.safeParse({ ...base, shifts: [one] }).success).toBe(true);
    const tooMany = Array.from({ length: ON_CALL_SHIFT_IMPORT_MAX + 1 }, () => one);
    expect(onCallShiftImportRequestSchema.safeParse({ ...base, shifts: tooMany }).success).toBe(false);
    const tooLong = { ...one, endsAt: new Date(Date.parse(one.startsAt) + 40 * 3_600_000).toISOString() };
    expect(onCallShiftImportRequestSchema.safeParse({ ...base, shifts: [tooLong] }).success).toBe(false);
  });

  it("keeps accepting a shift without a kind (old clients)", () => {
    const noKind = shift("2026-10-05", "08:00", "17:00");
    expect(onCallShiftImportRequestSchema.safeParse({ ...base, shifts: [{ ...noKind }] }).success).toBe(true);
  });

  it("accepts a shift with a kind", () => {
    const withKind = shift("2026-10-05", "08:00", "17:00", "Day", { kind: "day" });
    expect(onCallShiftImportRequestSchema.safeParse({ ...base, shifts: [withKind] }).success).toBe(true);
  });
});

/**
 * A stand-in for the Supabase query builder that records every owner filter,
 * so a test can prove each query was scoped to the signed-in doctor.
 */
type Recorded = {
  table: string;
  op: string;
  eq: Array<[string, unknown]>;
  /** Every `eq`/`is` filter, in call order, tagged with which one it was. */
  filters: Array<[string, string, unknown]>;
  /** Rows passed to `.insert(...)`, when this call was one. */
  insertedRows?: unknown[];
  /** The value passed to `.update(...)`, when this call was one. */
  updatedValue?: unknown;
};

function fakeSupabase(rows: Record<string, unknown[]>) {
  const calls: Recorded[] = [];
  mocks.from.mockImplementation((table: string) => {
    const call: Recorded = { table, op: "select", eq: [], filters: [] };
    calls.push(call);
    const result = () => {
      const owner = call.eq.find(([column]) => column === "owner_id" || column === "user_id")?.[1];
      const data = (rows[table] ?? []).filter((row) => (row as { owner_id: string }).owner_id === owner);
      return { data, error: null };
    };
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "gte", "order", "limit"]) builder[method] = () => builder;
    builder.gt = (column: string, value: unknown) => (call.filters.push(["gt", column, value]), builder);
    builder.lt = (column: string, value: unknown) => (call.filters.push(["lt", column, value]), builder);
    builder.update = (value: unknown) => ((call.op = "update"), (call.updatedValue = value), builder);
    builder.delete = () => ((call.op = "delete"), builder);
    builder.insert = (payload: unknown) => ((call.op = "insert"), (call.insertedRows = payload as unknown[]), builder);
    builder.eq = (column: string, value: unknown) => (
      call.eq.push([column, value]),
      call.filters.push(["eq", column, value]),
      builder
    );
    builder.is = (column: string, value: unknown) => (call.filters.push(["is", column, value]), builder);
    builder.maybeSingle = async () => ({ data: result().data[0] ?? null, error: null });
    builder.then = (resolve: (value: unknown) => unknown) => resolve(result());
    return builder;
  });
  return calls;
}

/** Every `eq`/`is` filter recorded on a `select` query, across every call so far. */
function selectFilters(calls: Recorded[]): Array<[string, string, unknown]> {
  return calls.filter((call) => call.op === "select").flatMap((call) => call.filters);
}

const future = "2099-01-01T00:00:00.000Z";
const futureEnd = "2099-01-01T08:00:00.000Z";
const storedRows = {
  on_call_shifts: [
    {
      id: "s1",
      owner_id: ownerId,
      starts_at: future,
      ends_at: futureEnd,
      title: "Mine",
      location: null,
      source_uid: null,
    },
    {
      id: "s2",
      owner_id: otherOwnerId,
      starts_at: future,
      ends_at: futureEnd,
      title: "Theirs",
      location: null,
      source_uid: null,
    },
  ],
  on_call_shift_imports: [],
};

function request(method: string, body?: unknown) {
  return new Request("https://psychiatry.tools/api/roster/shifts", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function jsonRequest(body: unknown) {
  return request("POST", body);
}

const validImportBody = {
  format: "csv" as const,
  workplace: null as string | null,
  fileName: null as string | null,
  windowStart: "2026-10-05",
  windowEnd: "2026-10-05",
  shifts: [shift("2026-10-05", "08:00", "17:00")],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.demo.mockReturnValue(false);
  mocks.rate.mockResolvedValue({ limited: false });
  mocks.auth.mockResolvedValue({ id: ownerId });
  mocks.rpc.mockImplementation(async (name: string) => ({
    data: name === "roster_read" ? { teams: [] } : importId,
    error: null,
  }));
});

describe("the My shifts API", () => {
  it("returns only the signed-in doctor's shifts, with every query filtered by owner", async () => {
    const calls = fakeSupabase(storedRows);
    const response = await GET(request("GET"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const payload = (await response.json()) as { shifts: Array<{ title: string }> };
    expect(payload.shifts.map((item) => item.title)).toEqual(["Mine"]);
    expect(JSON.stringify(payload)).not.toContain("Theirs");
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call.eq).toContainEqual(["owner_id", ownerId]);
  });

  it("lists the last three weeks as well as what is coming up, so hours and the week can show past shifts", async () => {
    const calls = fakeSupabase(storedRows);
    const before = Date.now();
    await GET(request("GET"));
    const [, , from] = calls
      .flatMap((call) => call.filters)
      .find(([op, column]) => op === "gt" && column === "ends_at")!;
    const days = (before - Date.parse(from as string)) / 86_400_000;
    expect(days).toBeGreaterThan(20.9);
    expect(days).toBeLessThan(21.1);
  });

  it("reads one span of dates for an older month, owner-scoped, without the import summary", async () => {
    const calls = fakeSupabase(storedRows);
    const response = await GET(new Request("https://psychiatry.tools/api/roster/shifts?from=2026-07-31&to=2026-09-01"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const payload = (await response.json()) as { shifts: Array<{ title: string }>; latestImport?: unknown };
    expect(payload.shifts.map((item) => item.title)).toEqual(["Mine"]);
    expect(payload).not.toHaveProperty("latestImport");
    expect(calls.map((call) => call.table)).toEqual(["on_call_shifts"]);
    expect(calls[0]!.eq).toContainEqual(["owner_id", ownerId]);
    expect(calls[0]!.filters).toContainEqual(["gt", "ends_at", "2026-07-31T00:00:00.000Z"]);
    expect(calls[0]!.filters).toContainEqual(["lt", "starts_at", "2026-09-02T00:00:00.000Z"]);
  });

  it.each([
    ["from=2026-07-31", "only one end"],
    ["from=2026-09-01&to=2026-07-31", "backwards"],
    ["from=2026-01-01&to=2026-06-01", "longer than 62 days"],
    ["from=2026-02-30&to=2026-03-10", "not a real date"],
    ["from=31/07/2026&to=01/09/2026", "the wrong format"],
  ])("refuses a span that is %s (%s), before reading anything", async (query) => {
    const calls = fakeSupabase(storedRows);
    const response = await GET(new Request(`https://psychiatry.tools/api/roster/shifts?${query}`));
    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
    expect(mocks.auth).not.toHaveBeenCalled();
  });

  it("refuses a signed-out request", async () => {
    fakeSupabase(storedRows);
    mocks.auth.mockRejectedValue(new AuthenticationError("no session"));
    expect((await GET(request("GET"))).status).toBe(401);
    expect((await POST(request("POST", {}))).status).toBe(401);
    expect((await DELETE(request("DELETE"))).status).toBe(401);
  });

  it("saves through one database call for the signed-in owner, with the change list worked out on the server", async () => {
    fakeSupabase(storedRows);
    const response = await POST(request("POST", validImportBody));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    const [name, args] = mocks.rpc.mock.calls[0]!;
    expect(name).toBe("roster_own_shifts_replace");
    expect(args).toMatchObject({
      p_owner_id: ownerId,
      p_workplace: null,
      p_file_name: null,
      p_added: 1,
      p_changed: 0,
      p_removed: 0,
    });
  });

  it("saves an import for one workplace through roster_own_shifts_replace", async () => {
    fakeSupabase(storedRows);
    const response = await POST(
      jsonRequest({
        format: "xlsx",
        workplace: "Example Hospital",
        fileName: "oct.xlsx",
        windowStart: "2026-10-01",
        windowEnd: "2026-10-31",
        shifts: [
          {
            startsAt: "2026-10-01T00:00:00.000Z",
            endsAt: "2026-10-01T08:30:00.000Z",
            title: "Day",
            location: null,
            sourceUid: null,
            kind: "day",
          },
        ],
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "roster_own_shifts_replace",
      expect.objectContaining({ p_format: "xlsx", p_workplace: "Example Hospital", p_file_name: "oct.xlsx" }),
    );
  });

  it("compares a new import only with imported shifts from the same workplace", async () => {
    const calls = fakeSupabase(storedRows);
    await POST(jsonRequest({ ...validImportBody, workplace: "Example Hospital" }));
    expect(selectFilters(calls)).toEqual(
      expect.arrayContaining([
        ["eq", "source", "import"],
        ["eq", "workplace", "Example Hospital"],
      ]),
    );
  });

  it("refuses a body that names an owner, or a shift outside the roster's dates", async () => {
    fakeSupabase(storedRows);
    const withOwner = { ...validImportBody, ownerId: otherOwnerId };
    expect((await POST(request("POST", withOwner))).status).toBe(400);
    const outside = { ...validImportBody, windowStart: "2026-10-06", windowEnd: "2026-10-07" };
    expect((await POST(request("POST", outside))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("deletes only the signed-in owner's links, settings, shifts and imports, links first", async () => {
    const calls = fakeSupabase({
      ...storedRows,
      user_preferences: [
        {
          owner_id: ownerId,
          user_id: ownerId,
          preferences: { density: "compact", roster: { rowName: "Dr Alex Example" } },
          updated_at: "2026-09-01T00:00:00.000Z",
        },
      ],
    });
    expect((await DELETE(request("DELETE"))).status).toBe(200);
    const writes = calls.filter((call) => call.op === "delete" || call.op === "update");
    expect(writes.map((call) => `${call.op} ${call.table}`)).toEqual([
      "delete roster_calendar_links",
      "delete web_push_subscriptions",
      "delete alert_reminder_times",
      "delete roster_leave",
      "update user_preferences",
      "delete on_call_shifts",
      "delete on_call_shift_imports",
    ]);
    for (const call of writes.filter((write) => write.op === "delete")) {
      expect(call.eq).toContainEqual(["owner_id", ownerId]);
    }
    const settingsWrite = writes.find((write) => write.table === "user_preferences")!;
    expect(settingsWrite.eq).toContainEqual(["user_id", ownerId]);
    expect(settingsWrite.updatedValue).toMatchObject({ preferences: { density: "compact" } });
    expect((settingsWrite.updatedValue as { preferences: object }).preferences).not.toHaveProperty("roster");
  });

  it("deletes again without error when there is nothing left", async () => {
    const calls = fakeSupabase({});
    expect((await DELETE(request("DELETE"))).status).toBe(200);
    expect(calls.some((call) => call.op === "update" || call.op === "insert")).toBe(false);
  });

  it("will not save or delete in demo mode", async () => {
    mocks.demo.mockReturnValue(true);
    expect((await POST(request("POST", {}))).status).toBe(400);
    expect((await DELETE(request("DELETE"))).status).toBe(400);
    const demo = (await (await GET(request("GET"))).json()) as { demoMode: boolean; shifts: unknown[] };
    expect(demo.demoMode).toBe(true);
    expect(demo.shifts.length).toBeGreaterThan(0);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("keeps a dated demo read to its dates", async () => {
    mocks.demo.mockReturnValue(true);
    const all = (await (await GET(request("GET"))).json()) as { shifts: Array<{ startsAt: string; endsAt: string }> };
    const first = all.shifts[0]!;
    const day = first.startsAt.slice(0, 10);
    const dated = (await (
      await GET(new Request(`https://psychiatry.tools/api/roster/shifts?from=${day}&to=${day}`))
    ).json()) as { shifts: Array<{ startsAt: string; endsAt: string }>; demoMode: boolean };
    expect(dated.demoMode).toBe(true);
    expect(dated.shifts.length).toBeGreaterThan(0);
    expect(dated.shifts.length).toBeLessThan(all.shifts.length);
    const end = Date.parse(`${day}T00:00:00Z`) + 86_400_000;
    for (const shift of dated.shifts) {
      expect(Date.parse(shift.endsAt)).toBeGreaterThan(Date.parse(`${day}T00:00:00Z`));
      expect(Date.parse(shift.startsAt)).toBeLessThan(end);
    }
  });

  it("dismisses only the owner's own import, and 404s anyone else's", async () => {
    const calls = fakeSupabase({
      on_call_shift_imports: [{ id: importId, owner_id: otherOwnerId }],
    });
    const patch = (id: string) =>
      PATCH(new Request(`https://psychiatry.tools/api/roster/shifts/imports/${id}`, { method: "PATCH" }), {
        params: Promise.resolve({ id }),
      });
    expect((await patch(importId)).status).toBe(404);
    expect(calls[0]?.eq).toContainEqual(["owner_id", ownerId]);
    expect((await patch("not-a-uuid")).status).toBe(404);
  });
});

describe("the old My shifts path, for a page opened before the move to Roster", () => {
  function legacyRequest(method: string, body?: unknown) {
    return new Request("https://psychiatry.tools/api/on-call/shifts", {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  const oldImportBody = {
    format: validImportBody.format,
    windowStart: validImportBody.windowStart,
    windowEnd: validImportBody.windowEnd,
    shifts: validImportBody.shifts,
  };

  it("saves the old request shape, with no workplace or file name", async () => {
    fakeSupabase(storedRows);
    const response = await legacyPost(legacyRequest("POST", oldImportBody));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "roster_own_shifts_replace",
      expect.objectContaining({ p_owner_id: ownerId, p_format: "csv", p_workplace: null, p_file_name: null }),
    );
  });

  it("still saves the new request shape, and still refuses a body that names an owner", async () => {
    fakeSupabase(storedRows);
    const withWorkplace = { ...validImportBody, workplace: "Example Hospital", fileName: "oct.csv" };
    expect((await legacyPost(legacyRequest("POST", withWorkplace))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "roster_own_shifts_replace",
      expect.objectContaining({ p_workplace: "Example Hospital", p_file_name: "oct.csv" }),
    );
    mocks.rpc.mockClear();
    expect((await legacyPost(legacyRequest("POST", { ...oldImportBody, ownerId: otherOwnerId }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("deletes only shifts and import records, never calendar links or Roster settings", async () => {
    const calls = fakeSupabase(storedRows);
    const response = await legacyDelete(legacyRequest("DELETE"));
    expect(response.status).toBe(200);
    const writes = calls.filter((call) => call.op !== "select");
    expect(writes.map((call) => `${call.op} ${call.table}`)).toEqual([
      "delete on_call_shifts",
      "delete on_call_shift_imports",
    ]);
    for (const call of writes) expect(call.eq).toContainEqual(["owner_id", ownerId]);
  });

  it("refuses a signed-out request and demo mode", async () => {
    fakeSupabase(storedRows);
    mocks.auth.mockRejectedValue(new AuthenticationError("no session"));
    expect((await legacyPost(legacyRequest("POST", oldImportBody))).status).toBe(401);
    expect((await legacyDelete(legacyRequest("DELETE"))).status).toBe(401);
    mocks.demo.mockReturnValue(true);
    expect((await legacyPost(legacyRequest("POST", oldImportBody))).status).toBe(400);
    expect((await legacyDelete(legacyRequest("DELETE"))).status).toBe(400);
  });
});

describe("hand-added shifts", () => {
  function manualRequest(body: unknown) {
    return new Request("https://psychiatry.tools/api/roster/shifts/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("adds a shift and repeats it weekly, sharing one series ID", async () => {
    const calls = fakeSupabase({ on_call_shifts: [] });
    const response = await postManualShift(
      manualRequest({ shift: shift("2026-10-05", "08:00", "17:00", "Clinic", { kind: "day" }), repeatWeeks: 2 }),
    );
    expect(response.status).toBe(200);
    const insert = calls.find((call) => call.op === "insert");
    const rows = insert?.insertedRows as Array<{ source: string; series_id: string | null; starts_at: string }>;
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.source === "manual")).toBe(true);
    expect(new Set(rows.map((row) => row.series_id)).size).toBe(1);
    expect(rows[0]?.series_id).not.toBeNull();
    expect(new Set(rows.map((row) => row.starts_at)).size).toBe(3);
  });

  it("gives a single, non-repeating shift its own series, so it can be removed", async () => {
    const calls = fakeSupabase({ on_call_shifts: [] });
    await postManualShift(manualRequest({ shift: shift("2026-10-05", "08:00", "17:00"), repeatWeeks: 0 }));
    const insert = calls.find((call) => call.op === "insert");
    const rows = insert?.insertedRows as Array<{ series_id: string | null }>;
    expect(rows).toHaveLength(1);
    const oneOff = rows[0]?.series_id;
    expect(oneOff).toMatch(/^[0-9a-f-]{36}$/);

    const response = await deleteManualShiftSeries(
      new Request(`https://psychiatry.tools/api/roster/shifts/manual/${oneOff}`, { method: "DELETE" }),
      { params: Promise.resolve({ seriesId: oneOff! }) },
    );
    expect(response.status).toBe(200);
    const removal = calls.find((call) => call.op === "delete");
    expect(removal?.eq).toEqual(
      expect.arrayContaining([
        ["owner_id", ownerId],
        ["series_id", oneOff],
      ]),
    );
  });

  it("refuses to add a hand-added shift in demo mode", async () => {
    mocks.demo.mockReturnValue(true);
    expect(
      (await postManualShift(manualRequest({ shift: shift("2026-10-05", "08:00", "17:00"), repeatWeeks: 0 }))).status,
    ).toBe(400);
  });

  it("deletes a hand-added shift's whole series, never an import", async () => {
    const calls = fakeSupabase({});
    const response = await deleteManualShiftSeries(
      new Request(`https://psychiatry.tools/api/roster/shifts/manual/${seriesId}`, { method: "DELETE" }),
      { params: Promise.resolve({ seriesId }) },
    );
    expect(response.status).toBe(200);
    const deletes = calls.filter((call) => call.op === "delete");
    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.eq).toContainEqual(["owner_id", ownerId]);
    expect(deletes[0]?.eq).toContainEqual(["series_id", seriesId]);
    expect(deletes[0]?.eq).toContainEqual(["source", "manual"]);
  });

  it("404s an unknown series ID instead of guessing", async () => {
    fakeSupabase({});
    const response = await deleteManualShiftSeries(
      new Request("https://psychiatry.tools/api/roster/shifts/manual/not-a-uuid", { method: "DELETE" }),
      { params: Promise.resolve({ seriesId: "not-a-uuid" }) },
    );
    expect(response.status).toBe(404);
  });
});

describe("no server-made example roster (the example data switch shows it in the browser)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("answers a doctor with no shifts of their own with their real, empty roster", async () => {
    vi.stubEnv("NODE_ENV", "production");
    fakeSupabase({ on_call_shifts: [], on_call_shift_imports: [] });
    const response = await GET(request("GET"));
    const payload = (await response.json()) as { sample?: boolean; shifts: unknown[] };
    expect(payload.sample).toBeUndefined();
    expect(payload.shifts).toEqual([]);
  });

  it("shows the doctor's own shifts, never the example, once they have any", async () => {
    vi.stubEnv("NODE_ENV", "production");
    fakeSupabase(storedRows);
    const payload = (await (await GET(request("GET"))).json()) as {
      sample?: boolean;
      shifts: Array<{ title: string }>;
    };
    expect(payload.sample).toBeUndefined();
    expect(payload.shifts.map((item) => item.title)).toEqual(["Mine"]);
  });

  it("never gives On Call the example roster as a real shift", async () => {
    vi.stubEnv("NODE_ENV", "production");
    fakeSupabase({ on_call_shifts: [], on_call_shift_imports: [] });
    const payload = await (await legacyGet(request("GET"))).json();
    expect(payload).toEqual({ shifts: [], latestImport: null });
  });

  it("has no example once team rosters are released", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ROSTER_TEAM_RELEASE_ENABLED", "true");
    fakeSupabase({ on_call_shifts: [], on_call_shift_imports: [] });
    const payload = (await (await GET(request("GET"))).json()) as { sample?: boolean; shifts: unknown[] };
    expect(payload.sample).toBeUndefined();
    expect(payload.shifts).toEqual([]);
  });
});
