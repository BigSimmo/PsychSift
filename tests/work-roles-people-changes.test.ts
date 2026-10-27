import { describe, expect, it } from "vitest";

import { PublicApiError } from "@/lib/http";
import { applyPeopleChange, peopleChangeSchema } from "@/lib/work-roles/people";
import { loadWorkRoleContext, type WorkRoleContext } from "@/lib/work-roles/server";

import { fakeWorkRolesDb, type Tables } from "./helpers/work-roles-fake-db";

/*
 * The administrator's mix-up fixes in People and roles: move a team to another
 * hospital, rename a hospital, archive a hospital. Run against the in-memory
 * stand-in for the service-role client in `helpers/work-roles-fake-db.ts`.
 */

const H1 = "11111111-1111-4111-8111-111111111111";
const H2 = "22222222-2222-4222-8222-222222222222";
const H3 = "33333333-3333-4333-8333-333333333333";
const TEAM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_TEAM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ADMIN = "99999999-9999-4999-8999-999999999999";
const WORKFORCE = "88888888-8888-4888-8888-888888888888";

function fakeDb(tables: Tables) {
  return fakeWorkRolesDb(tables, [ADMIN]);
}

function seed(): Tables {
  return {
    work_hospitals: [
      { id: H1, name: "Example Hospital", archived_at: null },
      { id: H2, name: "Example Health Campus", archived_at: null },
      { id: H3, name: "Example Old Hospital", archived_at: "2026-01-01T00:00:00.000Z" },
    ],
    work_hospital_teams: [
      { service_id: TEAM, hospital_id: H1, linked_by: ADMIN, linked_at: "2026-10-01T00:00:00.000Z" },
      { service_id: OTHER_TEAM, hospital_id: H1, linked_by: ADMIN, linked_at: "2026-10-01T00:00:00.000Z" },
    ],
    on_call_services: [
      { id: TEAM, name: "Ward A team" },
      { id: OTHER_TEAM, name: "Ward B team" },
    ],
    on_call_service_members: [],
    roster_member_roles: [],
    work_role_grants: [
      {
        id: "g-workforce",
        user_id: WORKFORCE,
        role: "workforce",
        hospital_id: H1,
        service_id: null,
        subject_user_id: null,
        granted_at: "2026-10-01T00:00:00.000Z",
        granted_by: ADMIN,
        revoked_at: null,
      },
      {
        id: "g-team-supervisor",
        user_id: "77777777-7777-4777-8777-777777777777",
        role: "supervisor",
        hospital_id: H1,
        service_id: TEAM,
        subject_user_id: null,
        granted_at: "2026-10-01T00:00:00.000Z",
        granted_by: ADMIN,
        revoked_at: null,
      },
    ],
  };
}

const admin: WorkRoleContext = { userId: ADMIN, ready: true, grants: [{ role: "administrator" }] };
const workforce: WorkRoleContext = {
  userId: WORKFORCE,
  ready: true,
  grants: [{ role: "workforce", hospitalId: H1, serviceIds: [TEAM, OTHER_TEAM] }],
};

async function refusal(promise: Promise<unknown>): Promise<{ status: number; code?: string; message: string }> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof PublicApiError)
      return { status: error.status, code: error.details?.code, message: error.message };
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("the change schema", () => {
  it("accepts the three fixes and refuses extra or empty fields", () => {
    expect(peopleChangeSchema.safeParse({ action: "move-team", serviceId: TEAM, toHospitalId: H2 }).success).toBe(true);
    expect(peopleChangeSchema.safeParse({ action: "rename-hospital", hospitalId: H1, name: " New " }).data).toEqual({
      action: "rename-hospital",
      hospitalId: H1,
      name: "New",
    });
    expect(peopleChangeSchema.safeParse({ action: "archive-hospital", hospitalId: H1 }).success).toBe(true);
    expect(peopleChangeSchema.safeParse({ action: "rename-hospital", hospitalId: H1, name: "   " }).success).toBe(
      false,
    );
    expect(
      peopleChangeSchema.safeParse({ action: "rename-hospital", hospitalId: H1, name: "x".repeat(161) }).success,
    ).toBe(false);
    expect(peopleChangeSchema.safeParse({ action: "move-team", serviceId: TEAM }).success).toBe(false);
    expect(peopleChangeSchema.safeParse({ action: "archive-hospital", hospitalId: H1, force: true }).success).toBe(
      false,
    );
  });
});

describe("move a team to another hospital", () => {
  it("refuses before moving when the required transaction RPC is absent", async () => {
    const db = fakeDb(seed());
    db.state.rpcUnavailable = true;
    const before = structuredClone(db.tables);
    expect(
      (await refusal(applyPeopleChange(db.client, admin, { action: "move-team", serviceId: TEAM, toHospitalId: H2 })))
        .status,
    ).toBe(503);
    expect(db.tables).toEqual(before);
    expect(db.writes).toEqual([]);
  });

  it("moves the link, removes only whole-team supervisors, and answers with the hospital it left", async () => {
    const db = fakeDb(seed());
    // A supervisor of a named trainee in this team stays: scoped to the old hospital, it just stops matching.
    db.tables.work_role_grants!.push({
      id: "g-trainee-supervisor",
      user_id: "88888888-8888-4888-8888-888888888888",
      role: "supervisor",
      hospital_id: H1,
      service_id: TEAM,
      subject_user_id: WORKFORCE,
      granted_at: "2026-10-01T00:00:00.000Z",
      granted_by: ADMIN,
      revoked_at: null,
    });
    const before = structuredClone(db.tables.work_role_grants);
    const view = await applyPeopleChange(db.client, admin, { action: "move-team", serviceId: TEAM, toHospitalId: H2 });

    expect(db.tables.work_hospital_teams!.find((row) => row.service_id === TEAM)).toMatchObject({
      hospital_id: H2,
      linked_by: ADMIN,
    });
    expect(view.hospital?.id).toBe(H1);
    expect(view.hospital?.teams.map((team) => team.name)).toEqual(["Ward B team"]);
    // Left in place it would keep working at the new hospital, unseen there, so it is removed.
    expect(db.tables.work_role_grants!.find((row) => row.id === "g-team-supervisor")).toMatchObject({
      revoked_by: ADMIN,
    });
    expect(db.tables.work_role_grants!.find((row) => row.id === "g-team-supervisor")?.revoked_at).not.toBeNull();
    expect(db.tables.work_role_grants!.filter((row) => row.id !== "g-team-supervisor")).toEqual(
      before!.filter((row) => row.id !== "g-team-supervisor"),
    );
    expect(view.hospital?.grants.some((grant) => grant.id === "g-team-supervisor")).toBe(false);
  });

  it("carries hospital roles with the link when roles are read, with no grant written", async () => {
    const db = fakeDb(seed());
    db.tables.work_role_grants!.push({
      id: "g-workforce-2",
      user_id: WORKFORCE,
      role: "workforce",
      hospital_id: H2,
      service_id: null,
      subject_user_id: null,
      granted_at: "2026-10-01T00:00:00.000Z",
      granted_by: ADMIN,
      revoked_at: null,
    });
    const user = { id: WORKFORCE, appMetadata: {} };
    const serviceIdsOf = async (hospitalId: string) => {
      const context = await loadWorkRoleContext(db.client, user);
      const grant = context.grants.find((g) => g.role === "workforce" && g.hospitalId === hospitalId);
      return grant && "serviceIds" in grant ? [...grant.serviceIds].sort() : null;
    };
    expect(await serviceIdsOf(H1)).toEqual([TEAM, OTHER_TEAM].sort());
    expect(await serviceIdsOf(H2)).toEqual([]);
    await applyPeopleChange(db.client, admin, { action: "move-team", serviceId: TEAM, toHospitalId: H2 });
    expect(await serviceIdsOf(H1)).toEqual([OTHER_TEAM]);
    expect(await serviceIdsOf(H2)).toEqual([TEAM]);
  });

  it("refuses anyone but the administrator", async () => {
    const db = fakeDb(seed());
    const answer = await refusal(
      applyPeopleChange(db.client, workforce, { action: "move-team", serviceId: TEAM, toHospitalId: H2 }),
    );
    expect(answer).toMatchObject({ status: 403, code: "work_role_required" });
    expect(db.writes).toEqual([]);
  });

  it("refuses an archived or unknown hospital, the same hospital, and a team linked nowhere", async () => {
    const db = fakeDb(seed());
    expect(
      await refusal(applyPeopleChange(db.client, admin, { action: "move-team", serviceId: TEAM, toHospitalId: H3 })),
    ).toMatchObject({ status: 404, code: "work_people_not_found" });
    expect(
      await refusal(applyPeopleChange(db.client, admin, { action: "move-team", serviceId: TEAM, toHospitalId: H1 })),
    ).toMatchObject({ status: 409, message: "That team is already in this hospital." });
    db.tables.work_hospital_teams = db.tables.work_hospital_teams!.filter((row) => row.service_id !== TEAM);
    expect(
      await refusal(applyPeopleChange(db.client, admin, { action: "move-team", serviceId: TEAM, toHospitalId: H2 })),
    ).toMatchObject({ status: 404, code: "work_team_not_linked" });
    expect(db.writes).toEqual([]);
  });
});

describe("rename a hospital", () => {
  it("renames an open hospital and answers with it", async () => {
    const db = fakeDb(seed());
    const view = await applyPeopleChange(db.client, admin, {
      action: "rename-hospital",
      hospitalId: H1,
      name: "Example General Hospital",
    });
    expect(view.hospital?.name).toBe("Example General Hospital");
    expect(view.hospitals.map((hospital) => hospital.name)).toContain("Example General Hospital");
  });

  it("allows a change of case to its own name", async () => {
    const db = fakeDb(seed());
    const view = await applyPeopleChange(db.client, admin, {
      action: "rename-hospital",
      hospitalId: H1,
      name: "EXAMPLE HOSPITAL",
    });
    expect(view.hospital?.name).toBe("EXAMPLE HOSPITAL");
  });

  it("refuses a name another open hospital uses, as adding one does, but not an archived one's", async () => {
    const db = fakeDb(seed());
    expect(
      await refusal(
        applyPeopleChange(db.client, admin, {
          action: "rename-hospital",
          hospitalId: H1,
          name: "example health campus",
        }),
      ),
    ).toMatchObject({
      status: 409,
      code: "work_hospital_exists",
      message: "A hospital with that name already exists.",
    });
    const view = await applyPeopleChange(db.client, admin, {
      action: "rename-hospital",
      hospitalId: H1,
      name: "Example Old Hospital",
    });
    expect(view.hospital?.name).toBe("Example Old Hospital");
  });

  it("refuses a patient detail, an archived hospital and anyone but the administrator", async () => {
    const db = fakeDb(seed());
    expect(
      await refusal(
        applyPeopleChange(db.client, admin, {
          action: "rename-hospital",
          hospitalId: H1,
          name: "Bed 12 UMRN A1234567",
        }),
      ),
    ).toMatchObject({ status: 400, message: "Use the hospital's name only." });
    expect(
      await refusal(
        applyPeopleChange(db.client, admin, { action: "rename-hospital", hospitalId: H3, name: "Reopened" }),
      ),
    ).toMatchObject({ status: 404, code: "work_people_not_found" });
    expect(
      await refusal(
        applyPeopleChange(db.client, workforce, { action: "rename-hospital", hospitalId: H1, name: "Mine now" }),
      ),
    ).toMatchObject({ status: 403 });
    expect(db.tables.work_hospitals!.find((row) => row.id === H1)?.name).toBe("Example Hospital");
  });
});

describe("archive a hospital", () => {
  it("refuses while teams are linked, and says to move them first", async () => {
    const db = fakeDb(seed());
    const answer = await refusal(applyPeopleChange(db.client, admin, { action: "archive-hospital", hospitalId: H1 }));
    expect(answer).toMatchObject({ status: 409, code: "work_hospital_has_teams" });
    expect(answer.message).toMatch(/^Move its teams first/);
    expect(db.writes).toEqual([]);
  });

  it("archives a hospital with no teams, which then drops out of the list", async () => {
    const db = fakeDb(seed());
    const view = await applyPeopleChange(db.client, admin, { action: "archive-hospital", hospitalId: H2 });
    expect(db.tables.work_hospitals!.find((row) => row.id === H2)?.archived_at).toEqual(expect.any(String));
    expect(view.hospitals.map((hospital) => hospital.id)).toEqual([H1]);
    expect(view.hospital?.id).toBe(H1);
  });

  it("lapses the hospital's roles once archived", async () => {
    const db = fakeDb(seed());
    db.tables.work_hospital_teams = [];
    await applyPeopleChange(db.client, admin, { action: "archive-hospital", hospitalId: H1 });
    const context = await loadWorkRoleContext(db.client, { id: WORKFORCE, appMetadata: {} });
    expect(context.grants).toEqual([]);
  });

  it("refuses an already archived hospital and anyone but the administrator", async () => {
    const db = fakeDb(seed());
    expect(
      await refusal(applyPeopleChange(db.client, admin, { action: "archive-hospital", hospitalId: H3 })),
    ).toMatchObject({ status: 404 });
    expect(
      await refusal(applyPeopleChange(db.client, workforce, { action: "archive-hospital", hospitalId: H2 })),
    ).toMatchObject({ status: 403 });
    expect(db.tables.work_hospitals!.find((row) => row.id === H2)?.archived_at).toBeNull();
  });
});
