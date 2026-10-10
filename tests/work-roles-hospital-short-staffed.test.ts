import { describe, expect, it } from "vitest";

import { exampleHospitalHub } from "@/lib/example-data/datasets/admin-hospital";
import { isExampleRecord } from "@/lib/example-data/guards";
import { hospitalShortStaffedOutcome } from "@/lib/work-roles/hospital-client";
import { hospitalSections } from "@/lib/work-roles/hospital-hub";
import { readHospitalShortStaffed } from "@/lib/work-roles/hospital-short-staffed";
import {
  groupShortStaffedDays,
  noSafeNumberLine,
  notRosteredLine,
  parseHospitalShortStaffedView,
  shortStaffedKindWords,
  shortStaffedTeamHref,
  shortStaffedWindow,
  shortStaffedWords,
  type ShortStaffedDay,
} from "@/lib/work-roles/hospital-short-staffed-view";
import type { WorkRoleGrant } from "@/lib/work-roles/model";
import type { WorkRoleContext } from "@/lib/work-roles/server";

type Rows = Record<string, unknown[]>;
type Log = { table: string; filters: string[]; range: [number, number] | null }[];

/**
 * A stand-in for the admin client. Every query on a table answers with that
 * table's rows, filtered by `in`, `eq` and `is` where the test needs it, and
 * cut by `range` the way the API cuts at 1,000 rows.
 */
function fakeClient(rows: Rows, log: Log = [], cap = 1000) {
  const builder = (table: string) => {
    const entry = { table, filters: [] as string[], range: null as [number, number] | null };
    log.push(entry);
    let data = [...(rows[table] ?? [])] as Record<string, unknown>[];
    const query = {
      select: () => query,
      eq: (column: string, value: unknown) => {
        entry.filters.push(`eq(${column})`);
        data = data.filter((row) => !(column in row) || row[column] === value);
        return query;
      },
      is: (column: string, value: unknown) => {
        entry.filters.push(`is(${column})`);
        data = data.filter((row) => !(column in row) || (row[column] ?? null) === value);
        return query;
      },
      in: (column: string, values: unknown[]) => {
        entry.filters.push(`in(${column})`);
        data = data.filter((row) => !(column in row) || values.includes(row[column]));
        return query;
      },
      gte: (column: string, value: string) => {
        entry.filters.push(`gte(${column})`);
        data = data.filter((row) => !(column in row) || String(row[column]) >= value);
        return query;
      },
      lt: (column: string, value: string) => {
        entry.filters.push(`lt(${column})`);
        data = data.filter((row) => !(column in row) || String(row[column]) < value);
        return query;
      },
      order: () => query,
      range: (from: number, to: number) => {
        entry.range = [from, to];
        data = data.slice(from, Math.min(to + 1, from + cap));
        return query;
      },
      then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
        Promise.resolve({ data, error: null }).then(resolve),
    };
    return query;
  };
  return { from: builder } as unknown as Parameters<typeof readHospitalShortStaffed>[0];
}

// Fri 9 Oct 2026, 10:00 in Perth. The window is Fri 9 Oct to Thu 5 Nov.
const NOW = new Date("2026-10-09T02:00:00Z");
const TODAY = "2026-10-09";
/** A Perth wall time as an instant (Perth is UTC+8 all year). */
const perth = (date: string, time: string) => new Date(Date.parse(`${date}T${time}:00Z`) - 8 * 3_600_000).toISOString();
const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const context = (grants: WorkRoleGrant[]): WorkRoleContext => ({ userId: "me", ready: true, grants });
const WORKFORCE = context([{ role: "workforce", hospitalId: "h1", serviceIds: ["t1", "t2", "t3"] }]);

/** A whole-team Day need of `needed` on every weekday. */
const dayNeeds = (serviceId: string, needed: number) =>
  [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
    service_id: serviceId,
    weekday,
    on_date: null,
    kind: "day",
    grade: null,
    site_id: null,
    needed,
  }));

/** `people` Day shifts on `date` for a team. */
const dayShifts = (serviceId: string, date: string, people: number) =>
  Array.from({ length: people }, (_, index) => ({
    id: `${serviceId}-${date}-${index}`,
    service_id: serviceId,
    user_id: `${serviceId}-person-${index}`,
    roster_name: null,
    starts_at: perth(date, "08:00"),
    kind: "day",
  }));

function baseRows(extra: Partial<Rows> = {}): Rows {
  return {
    work_hospitals: [{ id: "h1", name: "Example Hospital" }],
    work_hospital_teams: [{ service_id: "t1" }],
    on_call_services: [{ id: "t1", name: "Ward A" }],
    roster_staffing_needs: dayNeeds("t1", 2),
    roster_publications: [{ id: "p1", service_id: "t1", version: 1, period_end: addDays(TODAY, 27) }],
    roster_assignments: [],
    ...extra,
  };
}

describe("readHospitalShortStaffed: who may read it", () => {
  const cases: [string, WorkRoleGrant[], boolean][] = [
    ["Medical Workforce at this hospital", [{ role: "workforce", hospitalId: "h1", serviceIds: ["t1"] }], true],
    ["the site administrator", [{ role: "administrator" }], true],
    ["Medical Workforce at another hospital", [{ role: "workforce", hospitalId: "h2", serviceIds: [] }], false],
    ["the DCT", [{ role: "dct", hospitalId: "h1", serviceIds: ["t1"] }], false],
    ["a supervisor", [{ role: "supervisor", hospitalId: "h1", serviceId: "t1" }], false],
    ["a team's roster manager", [{ role: "manager", serviceId: "t1" }], false],
    ["a doctor with no role", [], false],
  ];

  it.each(cases)("%s", async (_who, grants, allowed) => {
    const read = readHospitalShortStaffed(fakeClient(baseRows()), context(grants), "h1", NOW);
    if (allowed) await expect(read).resolves.toMatchObject({ hospital: { id: "h1" } });
    else await expect(read).rejects.toMatchObject({ status: 403 });
  });

  it("says not ready when the role tables are missing", async () => {
    await expect(
      readHospitalShortStaffed(fakeClient(baseRows()), { ...WORKFORCE, ready: false }, "h1", NOW),
    ).rejects.toMatchObject({ status: 503 });
  });
});

describe("readHospitalShortStaffed: the days", () => {
  it("judges each published day against the safe number, with counts and team names only", async () => {
    const log: Log = [];
    const view = await readHospitalShortStaffed(
      fakeClient(
        baseRows({
          roster_assignments: [
            ...dayShifts("t1", TODAY, 2),
            ...dayShifts("t1", addDays(TODAY, 1), 1),
            // Leave is not counted as on, and never named.
            {
              id: "leave",
              service_id: "t1",
              user_id: "away",
              roster_name: null,
              starts_at: perth(addDays(TODAY, 1), "08:00"),
              kind: "leave",
            },
          ],
        }),
        log,
      ),
      WORKFORCE,
      "h1",
      NOW,
    );
    expect(view.window).toEqual({ from: TODAY, to: addDays(TODAY, 27) });
    // Today has 2 on, so is fine. Tomorrow has 1. Every later published day has 0.
    expect(view.days[0]).toEqual({
      date: addDays(TODAY, 1),
      serviceId: "t1",
      teamName: "Ward A",
      on: 1,
      needed: 2,
      short: [{ kind: "day", on: 1, needed: 2 }],
      kinds: ["day"],
    });
    expect(view.days.map((day) => day.date)).not.toContain(TODAY);
    expect(view.days).toHaveLength(27);
    expect(JSON.stringify(view)).not.toMatch(/away|person|leave/);
    // Live shifts only, in the window.
    const shifts = log.find((entry) => entry.table === "roster_assignments")!;
    expect(shifts.filters).toEqual(
      expect.arrayContaining(["in(service_id)", "is(superseded_at)", "gte(starts_at)", "lt(starts_at)"]),
    );
  });

  it("stops at the published roster: later days are not rostered yet, never short", async () => {
    const reach = addDays(TODAY, 6);
    const view = await readHospitalShortStaffed(
      fakeClient(
        baseRows({
          roster_publications: [
            { id: "p1", service_id: "t1", version: 1, period_end: addDays(TODAY, 27) },
            // The latest publication decides the reach, as the team's own overview does.
            { id: "p2", service_id: "t1", version: 2, period_end: reach },
          ],
        }),
      ),
      WORKFORCE,
      "h1",
      NOW,
    );
    expect(view.days.map((day) => day.date)).toEqual(Array.from({ length: 7 }, (_, index) => addDays(TODAY, index)));
    expect(view.teams).toEqual([{ serviceId: "t1", name: "Ward A", safeNumber: true, checkedThrough: reach }]);
    expect(notRosteredLine(view)).toBe("Not rostered yet, so not checked: Ward A from Fri 16 Oct.");
  });

  it("checks nothing for a team with no published roster", async () => {
    const view = await readHospitalShortStaffed(
      fakeClient(baseRows({ roster_publications: [] })),
      WORKFORCE,
      "h1",
      NOW,
    );
    expect(view.days).toEqual([]);
    expect(view.teams[0]!.checkedThrough).toBeNull();
    expect(notRosteredLine(view)).toBe("Not rostered yet, so not checked: Ward A for all 4 weeks.");
  });

  it("names the teams with no safe number set, so silence is not read as fine", async () => {
    const view = await readHospitalShortStaffed(
      fakeClient(
        baseRows({
          work_hospital_teams: [{ service_id: "t1" }, { service_id: "t2" }, { service_id: "t3" }],
          on_call_services: [
            { id: "t1", name: "Ward A" },
            { id: "t2", name: "Ward B" },
            { id: "t3", name: "Liaison" },
          ],
          roster_publications: ["t1", "t2", "t3"].map((service_id) => ({
            id: `p-${service_id}`,
            service_id,
            version: 1,
            period_end: addDays(TODAY, 27),
          })),
          // Ward B's only need is for one grade, which this check does not judge.
          roster_staffing_needs: [
            ...dayNeeds("t1", 2),
            { service_id: "t2", weekday: 1, on_date: null, kind: "day", grade: "registrar", site_id: null, needed: 1 },
          ],
        }),
      ),
      WORKFORCE,
      "h1",
      NOW,
    );
    expect(view.teams.map((team) => [team.name, team.safeNumber])).toEqual([
      ["Liaison", false],
      ["Ward A", true],
      ["Ward B", false],
    ]);
    expect(new Set(view.days.map((day) => day.serviceId))).toEqual(new Set(["t1"]));
    expect(noSafeNumberLine(view)).toBe("2 teams have no safe number set: Liaison and Ward B.");
  });

  it("reads every page, past 1,000 rows, so a big hospital is never cut off", async () => {
    const teams = Array.from({ length: 12 }, (_, index) => `t${index}`);
    const log: Log = [];
    const view = await readHospitalShortStaffed(
      fakeClient(
        {
          work_hospitals: [{ id: "h1", name: "Example Hospital" }],
          work_hospital_teams: teams.map((service_id) => ({ service_id })),
          on_call_services: teams.map((id) => ({ id, name: `Team ${id}` })),
          // 12 teams of 100 dated needs is 1,200 rows. The last team's needs come after row 1,000.
          roster_staffing_needs: teams.flatMap((serviceId) => [
            ...dayNeeds(serviceId, 3),
            ...Array.from({ length: 93 }, (_, index) => ({
              service_id: serviceId,
              weekday: null,
              on_date: addDays(TODAY, 40 + index),
              kind: "evening",
              grade: null,
              site_id: null,
              needed: 1,
            })),
          ]),
          roster_publications: teams.map((service_id) => ({
            id: `p-${service_id}`,
            service_id,
            version: 1,
            period_end: addDays(TODAY, 27),
          })),
          // 12 teams of 3 people over 28 days is 1,008 shifts, so the last team's last day is on page two.
          roster_assignments: teams.flatMap((serviceId) =>
            Array.from({ length: 28 }, (_, day) => dayShifts(serviceId, addDays(TODAY, day), 3)).flat(),
          ),
        },
        log,
      ),
      WORKFORCE,
      "h1",
      NOW,
    );
    expect(view.teams.every((team) => team.safeNumber)).toBe(true);
    // Every team is fully staffed on every day. Had the second page been dropped, the last team would
    // have no needs (no safe number) and its last day would read short.
    expect(view.days).toEqual([]);
    const ranges = (table: string) =>
      log.filter((entry) => entry.table === table).map((entry) => entry.range?.[0] ?? null);
    expect(ranges("roster_staffing_needs")).toEqual([0, 1000]);
    expect(ranges("roster_assignments")).toEqual([0, 1000]);
  });

  it("answers with no teams when none is linked", async () => {
    const view = await readHospitalShortStaffed(
      fakeClient(baseRows({ work_hospital_teams: [] })),
      WORKFORCE,
      "h1",
      NOW,
    );
    expect(view).toEqual({
      hospital: { id: "h1", name: "Example Hospital" },
      window: { from: TODAY, to: addDays(TODAY, 27) },
      teams: [],
      days: [],
    });
  });

  it("refuses a hospital that is unavailable", async () => {
    await expect(
      readHospitalShortStaffed(fakeClient(baseRows({ work_hospitals: [] })), WORKFORCE, "h1", NOW),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("short-staffed view", () => {
  const day = (overrides: Partial<ShortStaffedDay>): ShortStaffedDay => ({
    date: TODAY,
    serviceId: "t1",
    teamName: "Ward A",
    on: 3,
    needed: 4,
    short: [],
    kinds: ["day", "evening"],
    ...overrides,
  });

  it("starts the window today in Perth and runs four weeks", () => {
    // 07:00 on Sat 10 Oct in Perth is still Fri 9 Oct in UTC.
    expect(shortStaffedWindow(new Date("2026-10-09T23:00:00Z"))).toEqual({ from: "2026-10-10", to: "2026-11-06" });
  });

  it("says it in the leave check's words, with the short kind", () => {
    expect(shortStaffedWords(day({ short: [{ kind: "day", on: 3, needed: 4 }], kinds: ["day"] }))).toBe(
      "3 on, needs 4",
    );
    expect(shortStaffedKindWords(day({ short: [{ kind: "day", on: 3, needed: 4 }] }))).toBe("Day");
    const both = day({
      on: 1,
      needed: 3,
      short: [
        { kind: "day", on: 1, needed: 2 },
        { kind: "evening", on: 0, needed: 1 },
      ],
    });
    expect(shortStaffedWords(both)).toBe("1 on Day shifts, needs 2 and 0 on Evening shifts, needs 1");
    expect(shortStaffedKindWords(both)).toBe("Day and Evening");
    expect(shortStaffedKindWords(day({ kinds: ["evening"] }))).toBe("Evening");
  });

  it("groups by date, soonest first, the worst team first", () => {
    const groups = groupShortStaffedDays(
      [
        day({ date: addDays(TODAY, 2), serviceId: "t1", teamName: "Ward A" }),
        day({ date: TODAY, serviceId: "t2", teamName: "Ward B", on: 3, needed: 4 }),
        day({ date: TODAY, serviceId: "t3", teamName: "Emergency", on: 1, needed: 4 }),
        day({ date: TODAY, serviceId: "t1", teamName: "Ward A", on: 3, needed: 4 }),
      ],
      TODAY,
    );
    expect(groups.map((group) => [group.label, group.rows.map((row) => row.teamName)])).toEqual([
      ["Today", ["Emergency", "Ward A", "Ward B"]],
      ["Sun 11 Oct", ["Ward A"]],
    ]);
  });

  it("links a team to its Cover view only for that team's roster manager", () => {
    expect(shortStaffedTeamHref("t1", [{ role: "manager", serviceId: "t1" }])).toBe(
      "/roster/manage?view=cover&team=t1",
    );
    expect(shortStaffedTeamHref("t2", [{ role: "manager", serviceId: "t1" }])).toBeNull();
    expect(shortStaffedTeamHref("t1", [{ role: "administrator" }])).toBeNull();
    expect(shortStaffedTeamHref("t1", [{ role: "workforce", hospitalId: "h1", serviceIds: ["t1"] }])).toBeNull();
  });

  it("parses the API answer and drops rows it cannot read", async () => {
    const body: Record<string, unknown> = {
      hospital: { id: "h1", name: "Example Hospital" },
      window: { from: TODAY, to: addDays(TODAY, 27) },
      teams: [{ serviceId: "t1", name: "Ward A", safeNumber: true, checkedThrough: addDays(TODAY, 27) }],
      days: [
        day({}),
        { date: "soon", serviceId: "t1", on: 1, needed: 2 },
        day({ short: [{ kind: "night" }] as never }),
      ],
    };
    expect(parseHospitalShortStaffedView(body)?.days).toEqual([day({})]);
    const outcome = await hospitalShortStaffedOutcome(new Response(JSON.stringify(body), { status: 200 }));
    expect(outcome.status).toBe("ok");
    expect(await hospitalShortStaffedOutcome(new Response("{}", { status: 403 }))).toEqual({ status: "forbidden" });
    expect(
      await hospitalShortStaffedOutcome(
        new Response(JSON.stringify({ code: "work_roles_not_ready" }), { status: 503 }),
      ),
    ).toEqual({ status: "not-ready" });
  });
});

describe("the Short-staffed days row on Hospital", () => {
  const rowIds = (grants: WorkRoleGrant[]) =>
    hospitalSections(grants, "h1").flatMap((section) => section.links.map((link) => link.id));

  it("shows to Medical Workforce and the site administrator", () => {
    const [workforce] = hospitalSections([{ role: "workforce", hospitalId: "h1", serviceIds: [] }], "h1");
    expect(workforce!.links.find((link) => link.id === "short-staffed")).toEqual({
      id: "short-staffed",
      label: "Short-staffed days",
      sub: "Teams below their safe number",
      href: "/admin/hospital/short-staffed?hospitalId=h1",
      icon: "short",
    });
    expect(rowIds([{ role: "administrator" }])).toContain("short-staffed");
  });

  it("does not show to the DCT, a supervisor or a roster manager", () => {
    expect(rowIds([{ role: "dct", hospitalId: "h1", serviceIds: ["t1"] }])).not.toContain("short-staffed");
    expect(rowIds([{ role: "supervisor", serviceId: "t1" }])).not.toContain("short-staffed");
    expect(rowIds([{ role: "manager", serviceId: "t1" }])).not.toContain("short-staffed");
    expect(rowIds([])).toEqual([]);
  });
});

describe("admin.hospital example short-staffed days", () => {
  const example = exampleHospitalHub(NOW, "Australia/Perth");

  it("has one view per example hospital, with example ids and every line the screen can show", () => {
    expect(example.shortStaffed.map((view) => view.hospital.id)).toEqual(
      example.hospitals.map((view) => view.hospital.id),
    );
    for (const view of example.shortStaffed) {
      for (const team of view.teams) expect(isExampleRecord(team.serviceId)).toBe(true);
      for (const row of view.days) expect(isExampleRecord(row.serviceId)).toBe(true);
    }
    const [main, campus] = example.shortStaffed;
    expect(main!.days.length).toBeGreaterThan(0);
    expect(noSafeNumberLine(main!)).toBe("1 team has no safe number set: Consultation liaison.");
    expect(notRosteredLine(main!)).toMatch(/^Not rostered yet, so not checked: .+ from /);
    expect(campus!.days).toEqual([]);
    expect(notRosteredLine(campus!)).toMatch(/for all 4 weeks\.$/);
  });
});

describe("readHospitalShortStaffed: size limits", () => {
  const links = (count: number) =>
    Array.from({ length: count }, (_, index) => ({ service_id: `t${String(index).padStart(5, "0")}` }));

  it("loads a hospital with exactly 5,000 linked teams", async () => {
    const read = readHospitalShortStaffed(
      fakeClient(baseRows({ work_hospital_teams: links(5_000) })),
      context([{ role: "administrator" }]),
      "h1",
      NOW,
    );
    await expect(read).resolves.toMatchObject({ hospital: { id: "h1" } });
  });

  it("refuses one team past the limit rather than leaving some out", async () => {
    const read = readHospitalShortStaffed(
      fakeClient(baseRows({ work_hospital_teams: links(5_001) })),
      context([{ role: "administrator" }]),
      "h1",
      NOW,
    );
    await expect(read).rejects.toMatchObject({
      status: 503,
      message: "This hospital has too many shifts to check at once.",
    });
  });
});
