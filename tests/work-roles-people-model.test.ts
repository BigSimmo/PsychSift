import { describe, expect, it } from "vitest";

import { exampleWorkPeople } from "@/lib/example-data/datasets/admin-people";
import { isExampleRecord } from "@/lib/example-data/guards";
import { workPeopleOutcome } from "@/lib/work-roles/people-client";
import {
  applyExampleAction,
  EMPTY_GRANT_DRAFT,
  exampleResponse,
  exampleViewerGrants,
  grantCoverLabel,
  grantDraftProblem,
  grantedLine,
  grantEmailProblem,
  grantRequest,
  hospitalNameProblem,
  joinNames,
  mayRemoveGrant,
  parseWorkPeopleResponse,
  peopleScreenAllowed,
  peopleSections,
  pickablePeople,
  removeBlockedReason,
  roleSentence,
  rolesViewerMayGive,
  supervisorCover,
  viewerGrants,
  type PeopleGrant,
} from "@/lib/work-roles/people-model";
import type { WorkRoleGrant } from "@/lib/work-roles/model";

const H = "11111111-1111-4111-8111-111111111111";

function grant(partial: Partial<PeopleGrant> & Pick<PeopleGrant, "id" | "userId" | "name" | "role">): PeopleGrant {
  return {
    serviceId: null,
    serviceName: null,
    subjectUserId: null,
    subjectName: null,
    grantedAt: "2026-10-01T02:00:00.000Z",
    grantedByName: null,
    ...partial,
  };
}

const counter = () => {
  let n = 0;
  return (kind: string) => `example:${kind}-${++n}`;
};

describe("parseWorkPeopleResponse", () => {
  const valid = {
    hospitals: [{ id: H, name: "Example Hospital" }],
    hospital: {
      id: H,
      name: "Example Hospital",
      teams: [{ serviceId: "s1", name: "Ward A team", managers: [{ userId: "u1", name: "Dr A" }] }],
      people: [{ userId: "u1", name: "Dr A", serviceIds: ["s1"] }],
      grants: [
        {
          id: "g1",
          userId: "u1",
          name: "Dr A",
          role: "dct",
          serviceId: null,
          serviceName: null,
          subjectUserId: null,
          subjectName: null,
          grantedAt: "2026-10-01T02:00:00.000Z",
          grantedByName: "Dr B",
        },
      ],
    },
    viewer: { userId: "me", administrator: true, canGrant: ["dct", "bogus", "supervisor"] },
    unlinkedTeams: [{ serviceId: "s9", name: "Youth team" }],
  };

  it("reads a full answer, keeping only known roles in canGrant", () => {
    const parsed = parseWorkPeopleResponse(valid);
    expect(parsed?.hospital?.grants[0]?.role).toBe("dct");
    expect(parsed?.viewer).toEqual({ userId: "me", administrator: true, canGrant: ["dct", "supervisor"] });
    expect(parsed?.unlinkedTeams).toEqual([{ serviceId: "s9", name: "Youth team" }]);
  });

  it("accepts no hospital and no unlinked teams", () => {
    expect(parseWorkPeopleResponse({ hospitals: [], hospital: null, viewer: { userId: "me" } })).toEqual({
      hospitals: [],
      hospital: null,
      unlinkedTeams: [],
      viewer: { userId: "me", administrator: false },
    });
  });

  it("rejects an unknown role or a missing viewer", () => {
    const badRole = structuredClone(valid);
    (badRole.hospital.grants[0] as { role: string }).role = "manager";
    expect(parseWorkPeopleResponse(badRole)).toBeNull();
    expect(parseWorkPeopleResponse({ ...valid, viewer: null })).toBeNull();
    expect(parseWorkPeopleResponse("nope")).toBeNull();
  });
});

describe("workPeopleOutcome", () => {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("maps each documented answer", async () => {
    expect((await workPeopleOutcome(json(401, {}))).status).toBe("signed-out");
    expect((await workPeopleOutcome(json(403, { code: "work_role_required" }))).status).toBe("forbidden");
    expect((await workPeopleOutcome(json(503, { code: "work_roles_not_ready" }))).status).toBe("not-ready");
    expect((await workPeopleOutcome(json(404, { code: "work_person_not_found" }))).status).toBe("person-not-found");
    expect(await workPeopleOutcome(json(500, { error: "Broke." }))).toEqual({ status: "error", message: "Broke." });
    expect((await workPeopleOutcome(json(503, { code: "other" }))).status).toBe("error");
    expect((await workPeopleOutcome(json(200, { junk: true }))).status).toBe("error");
  });
});

describe("sections", () => {
  it("covers a whole hospital, a team and named trainees", () => {
    expect(supervisorCover([grant({ id: "a", userId: "u", name: "Dr U", role: "supervisor" })])).toBe("Whole hospital");
    expect(
      supervisorCover([
        grant({ id: "a", userId: "u", name: "Dr U", role: "supervisor", serviceId: "s", serviceName: "Ward B team" }),
        grant({ id: "b", userId: "u", name: "Dr U", role: "supervisor", subjectUserId: "t1", subjectName: "Dr T" }),
        grant({ id: "c", userId: "u", name: "Dr U", role: "supervisor", subjectUserId: "t2", subjectName: "Dr S" }),
      ]),
    ).toBe("All of Ward B team, Dr T, Dr S");
  });

  it("groups supervisors by person and flags teams with no roster manager", () => {
    const data = exampleWorkPeople();
    const sections = peopleSections(data.hospitals[0]!);
    expect(sections.workforce.map((g) => g.name)).toEqual(["Dr Sam Karri"]);
    expect(sections.dct.map((g) => g.name)).toEqual(["Dr Jordan Tuart"]);
    const jarrah = sections.supervisors.find((row) => row.name === "Dr Alex Jarrah");
    expect(jarrah?.cover).toBe("Dr Jo Banksia, Dr Casey Marri");
    expect(sections.supervisors.find((row) => row.name === "Dr Morgan Grevillea")?.cover).toBe("Whole hospital");
    expect(sections.teams.find((team) => team.name === "Consultation liaison")?.needsManager).toBe(true);
  });

  it("names a grant's cover and when it was given", () => {
    const dct = grant({ id: "a", userId: "u", name: "Dr U", role: "dct", grantedByName: "Dr B" });
    expect(grantCoverLabel(dct, "Example Hospital")).toBe("Every team at Example Hospital");
    // 2 am UTC on 1 Oct is 10 am in Perth, the same day.
    expect(grantedLine(dct, "Australia/Perth")).toBe("By Dr B on 1 Oct 2026");
    expect(grantedLine({ ...dct, grantedByName: null, grantedAt: "garbage" }, "Australia/Perth")).toBe("Not recorded");
    expect(joinNames(["A", "B", "C"])).toBe("A, B and C");
  });
});

describe("who may do what", () => {
  const workforce: WorkRoleGrant[] = [{ role: "workforce", hospitalId: H, serviceIds: ["s1"] }];
  const dct: WorkRoleGrant[] = [{ role: "dct", hospitalId: H, serviceIds: ["s1"] }];

  it("limits the roles each viewer may give", () => {
    expect(rolesViewerMayGive(viewerGrants({ userId: "me", administrator: true }, []), "me", H)).toEqual([
      "workforce",
      "dct",
      "supervisor",
    ]);
    expect(rolesViewerMayGive(workforce, "me", H)).toEqual(["dct", "supervisor"]);
    expect(rolesViewerMayGive(dct, "me", H)).toEqual(["supervisor"]);
    expect(rolesViewerMayGive(dct, "me", "another-hospital")).toEqual([]);
    expect(rolesViewerMayGive(workforce, "me", H, ["supervisor"])).toEqual(["supervisor"]);
  });

  it("never lets anyone remove their own role", () => {
    const own = grant({ id: "a", userId: "me", name: "Me", role: "supervisor" });
    expect(mayRemoveGrant([{ role: "administrator" }], "me", H, own)).toBe(false);
    expect(removeBlockedReason(own, "me")).toBe("You can't remove your own role.");
    const theirs = grant({ id: "b", userId: "x", name: "X", role: "workforce" });
    expect(mayRemoveGrant(workforce, "me", H, theirs)).toBe(false);
    expect(mayRemoveGrant([{ role: "administrator" }], "me", H, theirs)).toBe(true);
  });

  it("shows the screen to administrators, Medical Workforce and the DCT only", () => {
    expect(peopleScreenAllowed([{ role: "administrator" }])).toBe(true);
    expect(peopleScreenAllowed(dct)).toBe(true);
    expect(peopleScreenAllowed([{ role: "manager", serviceId: "s1" }])).toBe(false);
    expect(peopleScreenAllowed([])).toBe(false);
  });
});

describe("give a role", () => {
  it("leaves the viewer out of the people to pick", () => {
    const picked = pickablePeople(
      [
        { userId: "me", name: "Dr Me", serviceIds: [] },
        { userId: "b", name: "Dr Bee", serviceIds: [] },
        { userId: "a", name: "Dr Ay", serviceIds: [] },
      ],
      "me",
    );
    expect(picked.map((p) => p.userId)).toEqual(["a", "b"]);
  });

  it("explains what is missing, in order", () => {
    expect(grantDraftProblem(EMPTY_GRANT_DRAFT, "me")).toBe("Pick a person.");
    expect(grantDraftProblem({ ...EMPTY_GRANT_DRAFT, userId: "me", role: "dct" }, "me")).toBe(
      "You can't give yourself a role.",
    );
    expect(grantDraftProblem({ ...EMPTY_GRANT_DRAFT, userId: "a" }, "me")).toBe("Pick a role.");
    expect(grantDraftProblem({ ...EMPTY_GRANT_DRAFT, userId: "a", role: "supervisor" }, "me")).toBe(
      "Pick at least one trainee.",
    );
    expect(grantDraftProblem({ ...EMPTY_GRANT_DRAFT, userId: "a", role: "supervisor", cover: "team" }, "me")).toBe(
      "Pick a team.",
    );
    expect(
      grantDraftProblem({ ...EMPTY_GRANT_DRAFT, userId: "a", role: "supervisor", subjectUserIds: ["a"] }, "me"),
    ).toBe("Nobody can supervise themselves.");
    expect(grantDraftProblem({ ...EMPTY_GRANT_DRAFT, userId: "a", role: "dct" }, "me")).toBeNull();
  });

  it("checks an email, including the viewer's own", () => {
    expect(grantEmailProblem("not an email")).toBe("That doesn't look like an email address.");
    expect(grantEmailProblem("someone@example.org")).toBeNull();
    expect(
      grantDraftProblem({ ...EMPTY_GRANT_DRAFT, email: "Me@Example.org", role: "workforce" }, "me", {
        viewerEmail: "me@example.org",
      }),
    ).toBe("You can't give yourself a role.");
  });

  it("builds the request for each cover", () => {
    expect(grantRequest({ ...EMPTY_GRANT_DRAFT, userId: "a", role: "dct" }, H)).toEqual({
      action: "grant",
      hospitalId: H,
      userId: "a",
      role: "dct",
    });
    expect(
      grantRequest({ ...EMPTY_GRANT_DRAFT, userId: "a", role: "supervisor", cover: "team", serviceId: "s1" }, H),
    ).toEqual({ action: "grant", hospitalId: H, userId: "a", role: "supervisor", serviceId: "s1" });
    expect(grantRequest({ ...EMPTY_GRANT_DRAFT, userId: "a", role: "supervisor", subjectUserIds: ["t"] }, H)).toEqual({
      action: "grant",
      hospitalId: H,
      userId: "a",
      role: "supervisor",
      serviceId: null,
      subjectUserIds: ["t"],
    });
    expect(grantRequest({ ...EMPTY_GRANT_DRAFT, email: " x@example.org ", role: "workforce" }, H)).toEqual({
      action: "grant",
      hospitalId: H,
      email: "x@example.org",
      role: "workforce",
    });
  });

  it("says what each role lets them see, without semicolons or arrows", () => {
    const lines = [
      roleSentence("workforce", { hospitalName: "Example Hospital" }),
      roleSentence("dct", { hospitalName: "Example Hospital" }),
      roleSentence("supervisor", { hospitalName: "Example Hospital", teamName: "Ward A team" }),
      roleSentence("supervisor", { hospitalName: "Example Hospital", traineeNames: ["Dr A", "Dr B"] }),
    ];
    expect(lines[3]).toBe("They can review and sign assessments for Dr A and Dr B, and nobody else.");
    for (const line of lines) expect(line).not.toMatch(/[;→]|->/);
  });
});

describe("hospital names", () => {
  const existing = [{ id: H, name: "Example Hospital" }];
  it("needs a new, plain name", () => {
    expect(hospitalNameProblem("  ", existing)).toBe("Type the hospital's name.");
    expect(hospitalNameProblem("example hospital", existing)).toBe("That hospital is already listed.");
    expect(hospitalNameProblem("x".repeat(81), existing)).toMatch(/80 characters/);
    expect(hospitalNameProblem("Example Health Campus", existing)).toBeNull();
  });

  it("refuses text that looks like a patient detail", () => {
    expect(hospitalNameProblem("Bed 12 UMRN A1234567", existing)).not.toBeNull();
  });
});

describe("example records", () => {
  it("are all example ids and answer like the API", () => {
    const state = exampleWorkPeople();
    const ids = state.hospitals.flatMap((h) => [h.id, ...h.grants.map((g) => g.id), ...h.people.map((p) => p.userId)]);
    expect(ids.every((id) => isExampleRecord(id))).toBe(true);
    const response = exampleResponse(state, null);
    expect(response.hospital?.id).toBe(state.hospitals[0]!.id);
    expect(response.hospitals).toHaveLength(2);
    expect(response.unlinkedTeams.length).toBeGreaterThan(0);
    expect(parseWorkPeopleResponse(JSON.parse(JSON.stringify(response)))).toEqual(response);
  });

  it("hide unlinked teams from a viewer who is not the administrator", () => {
    const state = exampleWorkPeople();
    const response = exampleResponse({ ...state, viewer: { ...state.viewer, administrator: false } }, null);
    expect(response.unlinkedTeams).toEqual([]);
  });

  it("give the example reader the real reader's kind of role", () => {
    const state = exampleWorkPeople();
    expect(exampleViewerGrants(state, null).administrator).toBe(true);
    const asWorkforce = exampleViewerGrants(state, [{ role: "workforce", hospitalId: "real", serviceIds: [] }]);
    expect(asWorkforce.administrator).toBe(false);
    expect(asWorkforce.grants.map((g) => g.role)).toEqual(["workforce", "workforce"]);
  });

  it("apply grants, removals, links and new hospitals in memory", () => {
    const newId = counter();
    const now = "2026-10-09T01:00:00.000Z";
    let state = exampleWorkPeople();
    const hospital = state.hospitals[0]!;
    const trainee = hospital.people.find((p) => p.name === "Dr Robin Wattle")!;
    const supervisor = hospital.people.find((p) => p.name === "Dr Riley Boronia")!;

    const given = applyExampleAction(
      state,
      {
        action: "grant",
        hospitalId: hospital.id,
        userId: supervisor.userId,
        role: "supervisor",
        serviceId: null,
        subjectUserIds: [trainee.userId, supervisor.userId],
      },
      { now, newId },
    );
    expect(given.ok).toBe(true);
    if (!given.ok) return;
    state = given.state;
    const added = state.hospitals[0]!.grants.filter((g) => g.userId === supervisor.userId);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ subjectName: "Dr Robin Wattle", grantedByName: "Dr Avery Example" });

    const again = applyExampleAction(
      state,
      {
        action: "grant",
        hospitalId: hospital.id,
        userId: supervisor.userId,
        role: "supervisor",
        subjectUserIds: [trainee.userId],
      },
      { now, newId },
    );
    expect(again).toEqual({ ok: false, problem: "Dr Riley Boronia already has that role." });

    const self = applyExampleAction(
      state,
      { action: "grant", hospitalId: hospital.id, userId: state.viewer.userId, role: "dct" },
      { now, newId },
    );
    expect(self).toEqual({ ok: false, problem: "You can't give yourself a role." });

    const removed = applyExampleAction(state, { action: "revoke", grantId: added[0]!.id }, { now, newId });
    expect(removed.ok && removed.state.hospitals[0]!.grants.some((g) => g.id === added[0]!.id)).toBe(false);

    const team = state.unlinkedTeams[0]!;
    const linked = applyExampleAction(
      state,
      { action: "link-team", hospitalId: hospital.id, serviceId: team.serviceId },
      { now, newId },
    );
    expect(linked.ok).toBe(true);
    if (linked.ok) {
      expect(linked.state.hospitals[0]!.teams.some((t) => t.serviceId === team.serviceId)).toBe(true);
      expect(linked.state.unlinkedTeams.some((t) => t.serviceId === team.serviceId)).toBe(false);
    }

    const created = applyExampleAction(
      state,
      { action: "create-hospital", name: "Example Rural Hospital" },
      {
        now,
        newId,
      },
    );
    expect(created.ok && created.state.hospitals.at(-1)?.name).toBe("Example Rural Hospital");
    expect(created.ok && isExampleRecord(created.hospitalId)).toBe(true);
    expect(applyExampleAction(state, { action: "create-hospital", name: "Example Hospital" }, { now, newId }).ok).toBe(
      false,
    );

    const byEmail = applyExampleAction(
      state,
      { action: "grant", hospitalId: hospital.id, email: "new.person@example.org", role: "workforce" },
      { now, newId },
    );
    expect(byEmail.ok && byEmail.state.hospitals[0]!.grants.at(-1)?.name).toBe("new.person");
  });
});
