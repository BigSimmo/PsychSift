import { describe, expect, it } from "vitest";

import {
  readHospitalStarters,
  STARTERS_ID_BATCH,
  STARTERS_PAGE_SIZE,
  summariseStarterRows,
} from "@/lib/work-roles/hospital-starters";
import { readStarterSharingChoice } from "@/lib/work-roles/hospital-starters-model";
import type { WorkRoleGrant } from "@/lib/work-roles/model";
import type { WorkRoleContext } from "@/lib/work-roles/server";

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

/**
 * A stand-in for the admin client that applies the filters this reader uses (eq, in, is null),
 * honours `.range()` like the real API's 1,000-row pages, and records what was asked for.
 */
function fakeClient(tables: Tables) {
  const log: { table: string; select: string; range: [number, number] | null; inIds: Record<string, unknown[]> }[] = [];
  const from = (table: string) => {
    const filters: ((row: Row) => boolean)[] = [];
    const entry = { table, select: "", range: null as [number, number] | null, inIds: {} as Record<string, unknown[]> };
    log.push(entry);
    const query = {
      select: (columns: string) => {
        entry.select = columns;
        return query;
      },
      eq: (column: string, value: unknown) => {
        filters.push((row) => row[column] === value);
        return query;
      },
      in: (column: string, values: unknown[]) => {
        entry.inIds[column] = values;
        filters.push((row) => values.includes(row[column]));
        return query;
      },
      is: (column: string, value: null) => {
        filters.push((row) => (row[column] ?? null) === value);
        return query;
      },
      order: () => query,
      range: (start: number, end: number) => {
        entry.range = [start, end];
        return query;
      },
      then: (resolve: (value: { data: Row[]; error: null }) => unknown) => {
        let rows = (tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
        if (table === "user_preferences") {
          // `preferences->starterSharing->>workforce`: the one value as text, or null.
          rows = rows.map((row) => {
            const sharing = (row.preferences as Row | undefined)?.starterSharing as Row | undefined;
            const value = sharing?.workforce;
            return { user_id: row.user_id, workforce: value === undefined || value === null ? null : String(value) };
          });
        }
        if (entry.range) rows = rows.slice(entry.range[0], entry.range[1] + 1);
        return Promise.resolve({ data: rows, error: null }).then(resolve);
      },
    };
    return query;
  };
  return { client: { from } as unknown as Parameters<typeof readHospitalStarters>[0], log };
}

const H1 = "11111111-1111-4111-8111-111111111111";
let uuidCounter = 0;
const uuid = () => `00000000-0000-4000-9000-${String((uuidCounter += 1)).padStart(12, "0")}`;

const sharingOn = { starterSharing: { workforce: true, updatedAt: "2026-10-10T00:00:00Z" } };

function step(owner: string, title: string, details: Row, extra: Row = {}): Row {
  return {
    id: uuid(),
    owner_id: owner,
    section: "logistics",
    slug: `step-${uuidCounter}`,
    title,
    details: { category: "Logins", ...details },
    is_personal: false,
    sort_order: uuidCounter,
    last_verified_at: null,
    ...extra,
  };
}

function context(grants: WorkRoleGrant[]): WorkRoleContext {
  return { userId: "viewer", ready: true, grants };
}

const workforce = context([{ role: "workforce", hospitalId: H1, serviceIds: ["t1", "t2"] }]);

function baseTables(): Tables {
  return {
    work_hospitals: [{ id: H1, name: "Example Hospital" }],
    work_hospital_teams: [
      { hospital_id: H1, service_id: "t1" },
      { hospital_id: H1, service_id: "t2" },
    ],
    on_call_services: [
      { id: "t1", name: "Ward A" },
      { id: "t2", name: "Ward B" },
      { id: "t9", name: "Other hospital team" },
    ],
    on_call_service_members: [
      { service_id: "t1", user_id: "sharer", display_name: "Dr Sharer Example", revoked_at: null },
      { service_id: "t2", user_id: "sharer", display_name: "Dr Sharer Example", revoked_at: null },
      { service_id: "t1", user_id: "quiet", display_name: "Dr Quiet Example", revoked_at: null },
      { service_id: "t1", user_id: "turned-off", display_name: "Dr Off Example", revoked_at: null },
      { service_id: "t1", user_id: "left", display_name: "Dr Left Example", revoked_at: "2026-09-01T00:00:00Z" },
      { service_id: "t9", user_id: "elsewhere", display_name: "Dr Elsewhere Example", revoked_at: null },
    ],
    user_preferences: [
      { user_id: "sharer", preferences: sharingOn },
      { user_id: "quiet", preferences: { density: "compact" } },
      { user_id: "turned-off", preferences: { starterSharing: { workforce: false, updatedAt: null } } },
      { user_id: "left", preferences: sharingOn },
      { user_id: "elsewhere", preferences: sharingOn },
    ],
    on_call_entries: [
      step("sharer", "Hospital email login", { done: true, jobStartsOn: "2026-11-02" }),
      step("sharer", "Pager collected", {}),
      // A personal item: never counted, never named.
      step("sharer", "My private banking login", {}, { is_personal: true }),
      // A compliance record: never a New job step to Workforce.
      step("sharer", "Registration", { kind: "compliance", expiresOn: "2027-01-01" }),
      // Not a New job row at all (a guide).
      step("sharer", "Parking guide", { category: "Parking" }),
      step("quiet", "Quiet doctor's login", {}),
      step("turned-off", "Turned off doctor's login", {}),
      step("left", "Left doctor's login", {}),
      step("elsewhere", "Elsewhere doctor's login", {}),
    ],
  };
}

describe("readStarterSharingChoice", () => {
  it("is off by default, and on only for an explicit true", () => {
    expect(readStarterSharingChoice(null).workforce).toBe(false);
    expect(readStarterSharingChoice({}).workforce).toBe(false);
    expect(readStarterSharingChoice({ starterSharing: { workforce: "true" } }).workforce).toBe(false);
    expect(readStarterSharingChoice({ starterSharing: { workforce: false } }).workforce).toBe(false);
    expect(readStarterSharingChoice({ starterSharing: { workforce: true } }).workforce).toBe(true);
  });
});

describe("readHospitalStarters", () => {
  it("lists only active members of linked teams who opted in, with shared items only", async () => {
    const { client, log } = fakeClient(baseTables());
    const view = await readHospitalStarters(client, workforce, H1);
    expect(view.teams.map((team) => team.name)).toEqual(["Ward A", "Ward B"]);
    expect(view.starters).toEqual([
      {
        id: "sharer",
        name: "Dr Sharer Example",
        teams: ["Ward A", "Ward B"],
        startsOn: "2026-11-02",
        done: 1,
        total: 2,
        toDo: ["Pager collected"],
      },
    ]);
    const json = JSON.stringify(view);
    expect(json).not.toContain("private banking");
    expect(json).not.toContain("Registration");
    expect(json).not.toContain("Quiet doctor");
    expect(json).not.toContain("Turned off");
    expect(json).not.toContain("Left doctor");
    expect(json).not.toContain("Elsewhere");
    // Only the sharer's New job rows are read, and only the one sharing value from preferences.
    const entryReads = log.filter((entry) => entry.table === "on_call_entries");
    expect(entryReads.flatMap((entry) => entry.inIds.owner_id ?? [])).toEqual(["sharer"]);
    expect(entryReads.every((entry) => !entry.select.includes("body") && !entry.select.includes("subtitle"))).toBe(
      true,
    );
    const preferenceReads = log.filter((entry) => entry.table === "user_preferences");
    expect(
      preferenceReads.every((entry) => entry.select === "user_id,workforce:preferences->starterSharing->>workforce"),
    ).toBe(true);
    expect(preferenceReads.flatMap((entry) => entry.inIds.user_id ?? [])).not.toContain("elsewhere");
  });

  it("stops listing a doctor the moment they turn sharing off", async () => {
    const tables = baseTables();
    tables.user_preferences![0] = { user_id: "sharer", preferences: { starterSharing: { workforce: false } } };
    const { client, log } = fakeClient(tables);
    const view = await readHospitalStarters(client, workforce, H1);
    expect(view.starters).toEqual([]);
    expect(log.some((entry) => entry.table === "on_call_entries")).toBe(false);
  });

  it("says when no teams are linked, without reading anyone", async () => {
    const tables = baseTables();
    tables.work_hospital_teams = [];
    const { client, log } = fakeClient(tables);
    const view = await readHospitalStarters(client, workforce, H1);
    expect(view).toEqual({ hospital: { id: H1, name: "Example Hospital" }, teams: [], starters: [] });
    expect(log.some((entry) => entry.table === "on_call_service_members")).toBe(false);
  });

  it.each([
    ["Medical Workforce at this hospital", [{ role: "workforce", hospitalId: H1, serviceIds: ["t1"] }]],
    ["the site administrator", [{ role: "administrator" }]],
  ] as [string, WorkRoleGrant[]][])("lets %s read it", async (_label, grants) => {
    const { client } = fakeClient(baseTables());
    await expect(readHospitalStarters(client, context(grants), H1)).resolves.toMatchObject({ hospital: { id: H1 } });
  });

  it.each([
    ["the DCT", [{ role: "dct", hospitalId: H1, serviceIds: ["t1"] }]],
    ["a supervisor", [{ role: "supervisor", hospitalId: H1, serviceId: "t1" }]],
    ["a roster manager", [{ role: "manager", serviceId: "t1" }]],
    ["Medical Workforce at another hospital", [{ role: "workforce", hospitalId: "other", serviceIds: ["t9"] }]],
    ["a doctor with no hospital role", []],
  ] as [string, WorkRoleGrant[]][])("refuses %s", async (_label, grants) => {
    const { client, log } = fakeClient(baseTables());
    await expect(readHospitalStarters(client, context(grants), H1)).rejects.toMatchObject({ status: 403 });
    expect(log).toEqual([]);
  });

  it("reads every page and every batch, so a big hospital is never cut off at 1,000 rows", async () => {
    const tables = baseTables();
    const crowd = Array.from({ length: 1_450 }, (_, index) => `member-${String(index).padStart(5, "0")}`);
    tables.on_call_service_members!.push(
      ...crowd.map((user_id) => ({ service_id: "t1", user_id, display_name: user_id, revoked_at: null })),
    );
    // The very last member shares, with more New job rows than one page holds.
    const last = crowd[crowd.length - 1]!;
    tables.user_preferences!.push({ user_id: last, preferences: sharingOn });
    tables.on_call_entries!.push(
      ...Array.from({ length: 1_203 }, (_, index) => step(last, `Step ${index}`, index < 3 ? { done: true } : {})),
    );
    const { client, log } = fakeClient(tables);
    const view = await readHospitalStarters(client, workforce, H1);
    const lastStarter = view.starters.find((starter) => starter.id === last);
    expect(lastStarter).toMatchObject({ done: 3, total: 1_203 });
    expect(lastStarter!.toDo).toHaveLength(1_200);
    const memberPages = log.filter((entry) => entry.table === "on_call_service_members");
    expect(memberPages.length).toBeGreaterThan(1);
    expect(memberPages.map((entry) => entry.range?.[0])).toContain(STARTERS_PAGE_SIZE);
    const preferenceBatches = log.filter((entry) => entry.table === "user_preferences");
    expect(preferenceBatches.every((entry) => (entry.inIds.user_id ?? []).length <= STARTERS_ID_BATCH)).toBe(true);
    expect(preferenceBatches.length).toBeGreaterThan(1);
    expect(log.filter((entry) => entry.table === "on_call_entries").length).toBeGreaterThan(1);
  });

  it("reads every page of linked teams, so a sharer in a team past the first 1,000 still shows", async () => {
    const tables = baseTables();
    const extra = Array.from({ length: 1_200 }, (_, index) => `team-${String(index).padStart(5, "0")}`);
    tables.work_hospital_teams!.push(...extra.map((service_id) => ({ hospital_id: H1, service_id })));
    const lastTeam = extra[extra.length - 1]!;
    tables.on_call_services!.push({ id: lastTeam, name: "Last ward" });
    tables.on_call_service_members!.push({
      service_id: lastTeam,
      user_id: "late",
      display_name: "Dr Late Example",
      revoked_at: null,
    });
    tables.user_preferences!.push({ user_id: "late", preferences: sharingOn });
    tables.on_call_entries!.push(step("late", "Late doctor's login", {}));
    const { client, log } = fakeClient(tables);
    const view = await readHospitalStarters(client, workforce, H1);
    expect(view.starters.map((starter) => starter.id)).toContain("late");
    expect(log.filter((entry) => entry.table === "work_hospital_teams").length).toBeGreaterThan(1);
  });
});

describe("summariseStarterRows", () => {
  it("uses the start date the doctor's own page shows, but never counts or names a personal item", () => {
    const rows = [
      step("d", "Private step", { jobStartsOn: "2026-12-01", done: true }, { is_personal: true }),
      step("d", "Shared step", {}),
    ];
    expect(summariseStarterRows(rows)).toEqual({
      startsOn: "2026-12-01",
      done: 0,
      total: 1,
      toDo: ["Shared step"],
    });
  });
});
