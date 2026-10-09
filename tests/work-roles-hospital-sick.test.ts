import { describe, expect, it } from "vitest";

import { readHospitalSickCalls } from "@/lib/work-roles/hospital-sick";
import type { WorkRoleContext } from "@/lib/work-roles/server";

type Rows = Record<string, unknown[]>;

/** A stand-in for the admin client: every query on a table answers with that table's rows. */
function fakeClient(rows: Rows, calls: string[]) {
  const builder = (table: string) => {
    const query = {
      select: () => query,
      eq: () => query,
      is: () => query,
      in: () => query,
      gte: () => query,
      lte: () => query,
      order: () => query,
      limit: () => query,
      not: (column: string, op: string, value: unknown) => {
        calls.push(`${table}.not(${column},${op},${String(value)})`);
        return query;
      },
      then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
        Promise.resolve({ data: rows[table] ?? [], error: null }).then(resolve),
    };
    return query;
  };
  return { from: builder } as unknown as Parameters<typeof readHospitalSickCalls>[0];
}

const workforce: WorkRoleContext = {
  userId: "wf",
  ready: true,
  grants: [{ role: "workforce", hospitalId: "h1", serviceIds: ["t1"] }],
};

const shift = {
  service_id: "t1",
  starts_at: "2026-10-10T00:00:00Z",
  ends_at: "2026-10-10T08:00:00Z",
  shift_code: "D",
  kind: "day",
};

describe("hospital sick calls", () => {
  it("lists only reported shifts and names the doctor rostered when it was reported, not the poster or the cover", async () => {
    const calls: string[] = [];
    const client = fakeClient(
      {
        work_hospitals: [{ id: "h1", name: "Example Hospital" }],
        work_hospital_teams: [{ service_id: "t1" }],
        on_call_services: [{ id: "t1", name: "Ward A" }],
        roster_open_shifts: [
          {
            ...shift,
            id: "sick",
            assignment_id: "a1",
            status: "open",
            reported_at: "2026-10-09T01:00:00Z",
            reported_user_id: "doctor",
          },
          // Covered: the assignment now belongs to the doctor who took it, the sick doctor is still named.
          {
            ...shift,
            id: "covered",
            assignment_id: "a3",
            status: "approved",
            reported_at: "2026-10-09T02:00:00Z",
            reported_user_id: "doctor",
          },
          { ...shift, id: "giveaway", assignment_id: "a2", status: "open", reported_at: null, reported_user_id: null },
        ],
        roster_assignments: [
          { id: "a1", user_id: "doctor" },
          { id: "a2", user_id: "other" },
          { id: "a3", user_id: "cover" },
        ],
        on_call_service_members: [
          { service_id: "t1", user_id: "doctor", display_name: "Dr Example" },
          { service_id: "t1", user_id: "cover", display_name: "Dr Cover Example" },
          { service_id: "t1", user_id: "manager", display_name: "Manager Example" },
        ],
      },
      calls,
    );
    const view = await readHospitalSickCalls(client, workforce, "h1", new Date("2026-10-09T00:00:00Z"));
    expect(calls).toContain("roster_open_shifts.not(reported_at,is,null)");
    expect(view.calls.map((call) => [call.id, call.name, call.status, call.reportedAt])).toEqual([
      ["sick", "Dr Example", "offered", "2026-10-09T01:00:00Z"],
      ["covered", "Dr Example", "covered", "2026-10-09T02:00:00Z"],
    ]);
  });
});
