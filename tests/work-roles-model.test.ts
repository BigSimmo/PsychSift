import { describe, expect, it } from "vitest";

import {
  decideGrantWorkRole,
  decideWorkCapability,
  heldWorkRoles,
  WORK_CAPABILITIES,
  type WorkRoleGrant,
} from "@/lib/work-roles/model";

const admin: WorkRoleGrant = { role: "administrator" };
const managerA: WorkRoleGrant = { role: "manager", serviceId: "team-a" };
const workforceH: WorkRoleGrant = { role: "workforce", hospitalId: "hosp-1", serviceIds: ["team-a", "team-b"] };
const dctH: WorkRoleGrant = { role: "dct", hospitalId: "hosp-1", serviceIds: ["team-a", "team-b"] };
const supervisorOfSam: WorkRoleGrant = {
  role: "supervisor",
  hospitalId: "hosp-1",
  subjectUserId: "sam",
  hospitalServiceIds: ["team-a", "team-b"],
};
const supervisorTeamB: WorkRoleGrant = { role: "supervisor", serviceId: "team-b" };

describe("work roles model", () => {
  it("fails closed with no roles", () => {
    for (const capability of WORK_CAPABILITIES) {
      expect(decideWorkCapability([], capability, { kind: "everyone" })).toBe(false);
      expect(decideWorkCapability([], capability, { kind: "team", serviceId: "team-a" })).toBe(false);
    }
  });

  it("lets a manager run their own team only", () => {
    expect(decideWorkCapability([managerA], "rotations.manage", { kind: "team", serviceId: "team-a" })).toBe(true);
    expect(decideWorkCapability([managerA], "rotations.manage", { kind: "team", serviceId: "team-b" })).toBe(false);
    expect(decideWorkCapability([managerA], "courses.manage", { kind: "everyone" })).toBe(false);
    expect(decideWorkCapability([managerA], "starters.view", { kind: "hospital", hospitalId: "hosp-1" })).toBe(false);
  });

  it("lets a hospital role cover every team linked to its hospital and nothing else", () => {
    expect(decideWorkCapability([workforceH], "sick.inbox", { kind: "team", serviceId: "team-b" })).toBe(true);
    expect(decideWorkCapability([workforceH], "sick.inbox", { kind: "team", serviceId: "team-z" })).toBe(false);
    expect(decideWorkCapability([workforceH], "starters.view", { kind: "hospital", hospitalId: "hosp-2" })).toBe(false);
    expect(decideWorkCapability([workforceH], "courses.manage", { kind: "everyone" })).toBe(false);
  });

  it("keeps signing assessments with supervisors and the DCT, never the site administrator", () => {
    const sam = { kind: "trainee", userId: "sam", serviceId: "team-a" } as const;
    expect(decideWorkCapability([supervisorOfSam], "assessments.review", sam)).toBe(true);
    expect(decideWorkCapability([supervisorOfSam], "assessments.review", { kind: "trainee", userId: "alex" })).toBe(
      false,
    );
    expect(decideWorkCapability([supervisorTeamB], "assessments.review", sam)).toBe(false);
    // A one-trainee role stays in the hospital that gave it, and a named team must belong to it.
    expect(
      decideWorkCapability([supervisorOfSam], "assessments.review", {
        kind: "trainee",
        userId: "sam",
        serviceId: "team-z",
      }),
    ).toBe(false);
    expect(decideWorkCapability([supervisorOfSam], "assessments.review", { kind: "trainee", userId: "sam" })).toBe(
      true,
    );
    expect(decideWorkCapability([dctH], "assessments.review", sam)).toBe(true);
    expect(decideWorkCapability([admin], "assessments.review", sam)).toBe(false);
    expect(decideWorkCapability([workforceH], "assessments.review", sam)).toBe(false);
    expect(decideWorkCapability([admin], "assessments.overview", { kind: "hospital", hospitalId: "x" })).toBe(true);
  });

  it("controls who may give a role", () => {
    const scope = { kind: "hospital", hospitalId: "hosp-1" } as const;
    expect(decideGrantWorkRole([admin], "me", { userId: "a", role: "workforce", scope })).toBe(true);
    expect(decideGrantWorkRole([workforceH], "me", { userId: "a", role: "workforce", scope })).toBe(false);
    expect(decideGrantWorkRole([workforceH], "me", { userId: "a", role: "dct", scope })).toBe(true);
    expect(decideGrantWorkRole([dctH], "me", { userId: "a", role: "dct", scope })).toBe(false);
    expect(decideGrantWorkRole([dctH], "me", { userId: "a", role: "supervisor", scope })).toBe(true);
    expect(
      decideGrantWorkRole([dctH], "me", {
        userId: "a",
        role: "supervisor",
        scope: { kind: "hospital", hospitalId: "hosp-2" },
      }),
    ).toBe(false);
    expect(decideGrantWorkRole([admin], "me", { userId: "me", role: "dct", scope })).toBe(false);
  });

  it("lists held roles once, in a fixed order", () => {
    expect(heldWorkRoles([managerA, admin, { role: "manager", serviceId: "team-b" }])).toEqual([
      "administrator",
      "manager",
    ]);
  });
});
