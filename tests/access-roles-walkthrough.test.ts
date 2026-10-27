import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { TERMS_VERSION } from "@/lib/front-door-content";
import { PublicApiError } from "@/lib/http";
import { isBannedNow } from "@/lib/supabase/auth";
import { TERMS_METADATA_KEY } from "@/lib/terms-acceptance";
import { hospitalSections, type HospitalSection } from "@/lib/work-roles/hospital-hub";
import { decideWorkCapability, WORK_CAPABILITIES, type WorkCapability, type WorkScope } from "@/lib/work-roles/model";
import { applyPeopleChange, peopleChangeSchema } from "@/lib/work-roles/people";
import { loadWorkRoleContext, type WorkRoleContext } from "@/lib/work-roles/server";

import { fakeWorkRolesDb, type Tables } from "./helpers/work-roles-fake-db";

/*
 * One walk-through per access role, written the way the plan in docs/access-roles.md lists them:
 * what each role can open, what it is refused, and how one role hands on to the next. The site
 * roles go through the same server checks the routes call. The Work mode roles go through the
 * real grant code and role reader against the in-memory database stand-in, then through the
 * Hospital screen's section builder, so a grant is followed all the way to what the person sees.
 * Synthetic ids and accounts only.
 */

const H1 = "11111111-1111-4111-8111-111111111111";
const H2 = "22222222-2222-4222-8222-222222222222";
const TEAM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEAM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TEAM_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const ADMIN = "99999999-9999-4999-8999-999999999999";
const WORKFORCE = "88888888-8888-4888-8888-888888888888";
const DCT = "77777777-7777-4777-8777-777777777777";
const SUPERVISOR = "66666666-6666-4666-8666-666666666666";
const MANAGER = "55555555-5555-4555-8555-555555555555";
const TRAINEE = "44444444-4444-4444-8444-444444444444";
const OTHER_TRAINEE = "33333333-3333-4333-8333-333333333333";
const OTHER_MANAGER = "22222222-2222-4222-8222-000000000022";

const member = (service_id: string, user_id: string, display_name: string) => ({
  service_id,
  user_id,
  display_name,
  revoked_at: null,
});

function seed(): Tables {
  return {
    work_hospitals: [
      { id: H1, name: "Example Hospital", archived_at: null },
      { id: H2, name: "Example Health Campus", archived_at: null },
    ],
    work_hospital_teams: [
      { service_id: TEAM_A, hospital_id: H1 },
      { service_id: TEAM_B, hospital_id: H1 },
      { service_id: TEAM_C, hospital_id: H2 },
    ],
    on_call_services: [
      { id: TEAM_A, name: "Ward A team" },
      { id: TEAM_B, name: "Ward B team" },
      { id: TEAM_C, name: "Ward C team" },
    ],
    on_call_service_members: [
      member(TEAM_B, WORKFORCE, "Wren Example"),
      member(TEAM_A, DCT, "Dana Example"),
      member(TEAM_A, SUPERVISOR, "Sam Example"),
      member(TEAM_A, MANAGER, "Mel Example"),
      member(TEAM_A, TRAINEE, "Toni Example"),
      member(TEAM_A, OTHER_TRAINEE, "Olly Example"),
      member(TEAM_C, OTHER_MANAGER, "Max Example"),
    ],
    roster_member_roles: [
      { service_id: TEAM_A, user_id: MANAGER, role: "manager", revoked_at: null },
      { service_id: TEAM_A, user_id: TRAINEE, role: "member", revoked_at: null },
      { service_id: TEAM_C, user_id: OTHER_MANAGER, role: "manager", revoked_at: null },
    ],
    work_role_grants: [],
  };
}

const userOf = (id: string) => ({ id, appMetadata: id === ADMIN ? { site_role: "administrator" } : {} });

async function rolesOf(db: ReturnType<typeof fakeWorkRolesDb>, id: string): Promise<WorkRoleContext> {
  return loadWorkRoleContext(db.client, userOf(id));
}

async function refusal(promise: Promise<unknown>): Promise<{ status: number; code?: string }> {
  try {
    await promise;
  } catch (error) {
    // The site checks are loaded fresh per test, so their error class is not this file's copy.
    if (
      error instanceof PublicApiError ||
      (error instanceof Error && typeof Reflect.get(error, "status") === "number")
    ) {
      const { status, details } = error as PublicApiError;
      return { status, code: details?.code };
    }
    throw error;
  }
  throw new Error("expected a refusal");
}

const grant = (fields: Record<string, unknown>) => peopleChangeSchema.parse({ action: "grant", ...fields });

/** What the Hospital screen shows: each section's title and the labels of its rows. */
function screen(sections: readonly HospitalSection[]) {
  return sections.map((section) => ({ id: section.id, rows: section.links.map((link) => link.label) }));
}

const allPreviews = { previews: { rotationRounds: true, courses: true } } as const;

/* ------------------------------------------------------------------------------- site roles */

describe("site roles", () => {
  const callerId = "00000000-0000-4000-8000-0000000000a1";
  const declared = { [TERMS_METADATA_KEY]: { version: TERMS_VERSION, acceptedAt: "2026-10-26T00:00:00.000Z" } };

  afterEach(() => {
    vi.doUnmock("@/lib/env");
    vi.resetModules();
  });

  async function loadChecks() {
    vi.resetModules();
    vi.doMock("@/lib/env", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/env")>();
      return {
        ...actual,
        env: { ...actual.env, THIRD_PARTY_ORIGINALS_ADMIN_ONLY: true },
        isLocalNoAuthMode: () => false,
      };
    });
    const clinical = await import("../src/lib/clinical-access");
    clinical.resetHealthProfessionalDeclarationCache();
    const originals = await import("../src/lib/original-document-access");
    return { ...clinical, ...originals };
  }

  function account(fields: { user_metadata?: Record<string, unknown>; app_metadata?: Record<string, unknown> }) {
    const getUserById = vi.fn(async (id: string) => ({
      data: { user: { id, user_metadata: {}, app_metadata: {}, ...fields } },
      error: null,
    }));
    return { auth: { admin: { getUserById } } } as never;
  }

  const sharedDocument = { owner_id: "00000000-0000-4000-8000-0000000000b2" };
  const signedIn = { authenticated: true, ownerId: callerId };

  it("visitor: every clinical tool and every original asks them to sign in", async () => {
    const checks = await loadChecks();
    expect(() => checks.requireSignedInClinicalAccess({ authenticated: false })).toThrow("Sign in to use this.");
    expect(
      (await refusal(checks.requireHealthProfessionalDeclaration({ authenticated: false }, account({})))).status,
    ).toBe(401);
    expect(
      (await refusal(checks.requireOriginalDocumentAccess({ authenticated: false }, sharedDocument, account({}))))
        .status,
    ).toBe(401);
  });

  it("signed in without the declaration: signed in, but refused until the Terms are accepted", async () => {
    const checks = await loadChecks();
    expect(() => checks.requireSignedInClinicalAccess(signedIn)).not.toThrow();
    expect(await refusal(checks.requireHealthProfessionalDeclaration(signedIn, account({})))).toEqual({
      status: 403,
      code: "terms_acceptance_required",
    });
  });

  it("clinician: Answer opens, their own uploads open, other publishers' originals stay with administrators", async () => {
    const checks = await loadChecks();
    const supabase = account({ user_metadata: declared });
    await expect(checks.requireHealthProfessionalDeclaration(signedIn, supabase)).resolves.toBeUndefined();
    await expect(
      checks.requireOriginalDocumentAccess(signedIn, { owner_id: callerId }, supabase),
    ).resolves.toBeUndefined();
    expect(await refusal(checks.requireOriginalDocumentAccess(signedIn, sharedDocument, supabase))).toEqual({
      status: 403,
      code: "original_document_admin_only",
    });
  });

  it("administrator: other publishers' originals open too", async () => {
    const checks = await loadChecks();
    const supabase = account({ user_metadata: declared, app_metadata: { site_role: "administrator" } });
    await expect(checks.requireOriginalDocumentAccess(signedIn, sharedDocument, supabase)).resolves.toBeUndefined();
  });

  it("blocked account: a ban in force, or one with an unreadable date, counts as blocked", () => {
    const now = Date.parse("2026-10-27T00:00:00.000Z");
    expect(isBannedNow({ banned_until: "2099-01-01T00:00:00.000Z" }, now)).toBe(true);
    expect(isBannedNow({ banned_until: "not a date" }, now)).toBe(true);
    expect(isBannedNow({ banned_until: "2026-01-01T00:00:00.000Z" }, now)).toBe(false);
    expect(isBannedNow({ banned_until: null }, now)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- work mode roles */

describe("work mode roles, one at a time", () => {
  const own: Record<string, WorkScope> = {
    hospital: { kind: "hospital", hospitalId: H1 },
    team: { kind: "team", serviceId: TEAM_A },
    trainee: { kind: "trainee", userId: TRAINEE, serviceId: TEAM_A },
  };
  const elsewhere: Record<string, WorkScope> = {
    hospital: { kind: "hospital", hospitalId: H2 },
    team: { kind: "team", serviceId: TEAM_C },
    trainee: { kind: "trainee", userId: OTHER_TRAINEE, serviceId: TEAM_C },
  };

  function capabilities(context: WorkRoleContext, scopes: Record<string, WorkScope>): WorkCapability[] {
    return WORK_CAPABILITIES.filter((capability) =>
      Object.values(scopes).some((scope) => decideWorkCapability(context.grants, capability, scope)),
    );
  }

  it("team member: no hospital screen and no management powers anywhere", async () => {
    const db = fakeWorkRolesDb(seed(), [ADMIN]);
    const roles = await rolesOf(db, TRAINEE);
    expect(roles.grants).toEqual([]);
    expect(hospitalSections(roles.grants, null, allPreviews)).toEqual([]);
    expect(capabilities(roles, own)).toEqual([]);
  });

  it("roster manager: runs their own team, and nothing at another team", async () => {
    const db = fakeWorkRolesDb(seed(), [ADMIN]);
    const roles = await rolesOf(db, MANAGER);
    expect(roles.grants).toEqual([{ role: "manager", serviceId: TEAM_A }]);
    expect(capabilities(roles, { team: own.team })).toEqual([
      "courses.manage",
      "rotations.manage",
      "sick.inbox",
      "staffing.manage",
    ]);
    expect(capabilities(roles, elsewhere)).toEqual([]);
    expect(screen(hospitalSections(roles.grants, H1, allPreviews))).toEqual([
      {
        id: "manager",
        rows: ["Manage team", "Cover and safe number", "Rotation rounds", "Courses", "Post a course"],
      },
    ]);
  });

  it("roster manager who leaves the team loses the role at once", async () => {
    const tables = seed();
    const db = fakeWorkRolesDb(tables, [ADMIN]);
    const row = tables.on_call_service_members!.find((entry) => entry.user_id === MANAGER)!;
    row.revoked_at = "2026-10-27T00:00:00.000Z";
    expect((await rolesOf(db, MANAGER)).grants).toEqual([]);
  });

  it("administrator: everything in Work mode except signing assessments, which stays clinical", async () => {
    const db = fakeWorkRolesDb(seed(), [ADMIN]);
    const roles = await rolesOf(db, ADMIN);
    expect(capabilities(roles, elsewhere)).toEqual(WORK_CAPABILITIES.filter((c) => c !== "assessments.review"));
    expect(screen(hospitalSections(roles.grants, H1)).map((section) => section.id)).toEqual(["workforce"]);
  });
});

/* ------------------------------------------------------------------------------- hand-offs */

describe("how the roles hand on to each other", () => {
  it("administrator to Workforce to DCT to supervisor, each seeing exactly their own screens", async () => {
    const db = fakeWorkRolesDb(seed(), [ADMIN]);

    // 1. The administrator gives Medical Workforce for Example Hospital.
    await applyPeopleChange(
      db.client,
      await rolesOf(db, ADMIN),
      grant({ userId: WORKFORCE, role: "workforce", hospitalId: H1 }),
    );
    const workforce = await rolesOf(db, WORKFORCE);
    expect(workforce.grants).toMatchObject([{ role: "workforce", hospitalId: H1, serviceIds: [TEAM_A, TEAM_B] }]);
    expect(screen(hospitalSections(workforce.grants, H1))).toEqual([
      { id: "workforce", rows: ["Sick calls", "Short-staffed days", "New starters", "People and roles"] },
    ]);
    expect(decideWorkCapability(workforce.grants, "sick.inbox", { kind: "team", serviceId: TEAM_A })).toBe(true);
    expect(decideWorkCapability(workforce.grants, "sick.inbox", { kind: "team", serviceId: TEAM_C })).toBe(false);

    // 2. Workforce cannot make more Workforce, or reach another hospital.
    expect(
      await refusal(applyPeopleChange(db.client, workforce, grant({ userId: DCT, role: "workforce", hospitalId: H1 }))),
    ).toMatchObject({ status: 403 });
    expect(
      await refusal(
        applyPeopleChange(db.client, workforce, grant({ userId: OTHER_MANAGER, role: "dct", hospitalId: H2 })),
      ),
    ).toMatchObject({ status: 403 });

    // 3. Workforce gives the DCT role to a doctor in one of the hospital's teams.
    await applyPeopleChange(db.client, workforce, grant({ userId: DCT, role: "dct", hospitalId: H1 }));
    const dct = await rolesOf(db, DCT);
    expect(screen(hospitalSections(dct.grants, H1))).toEqual([
      { id: "dct", rows: ["Term overview", "Assign supervisors"] },
    ]);

    // 4. The DCT cannot make another DCT, but assigns a supervisor for one trainee.
    expect(
      await refusal(applyPeopleChange(db.client, dct, grant({ userId: SUPERVISOR, role: "dct", hospitalId: H1 }))),
    ).toMatchObject({ status: 403 });
    await applyPeopleChange(
      db.client,
      dct,
      grant({ userId: SUPERVISOR, role: "supervisor", hospitalId: H1, subjectUserIds: [TRAINEE] }),
    );
    const supervisor = await rolesOf(db, SUPERVISOR);
    const sections = hospitalSections(supervisor.grants, null);
    expect(screen(sections)).toEqual([
      { id: "supervisor", rows: ["Registrar supervision", "Assessments inbox", "Your free times"] },
    ]);
    expect(sections[0]!.note).toBe("1 trainee");
    expect(
      decideWorkCapability(supervisor.grants, "assessments.review", {
        kind: "trainee",
        userId: TRAINEE,
        serviceId: TEAM_A,
      }),
    ).toBe(true);
    expect(
      decideWorkCapability(supervisor.grants, "assessments.review", {
        kind: "trainee",
        userId: OTHER_TRAINEE,
        serviceId: TEAM_A,
      }),
    ).toBe(false);

    // 5. Nobody chooses their own supervisor.
    expect(
      await refusal(
        applyPeopleChange(
          db.client,
          await rolesOf(db, DCT),
          grant({ userId: SUPERVISOR, role: "supervisor", hospitalId: H1, subjectUserIds: [DCT] }),
        ),
      ),
    ).toMatchObject({ status: 400 });

    // 6. The DCT removes the supervisor, whose Hospital screen empties.
    const grantId = db.tables.work_role_grants!.find((row) => row.user_id === SUPERVISOR)!.id as string;
    await applyPeopleChange(db.client, dct, { action: "revoke", grantId });
    expect(hospitalSections((await rolesOf(db, SUPERVISOR)).grants, null)).toEqual([]);
  });

  it("a role can only be given to someone already in one of the hospital's teams, except by the administrator", async () => {
    const db = fakeWorkRolesDb(seed(), [ADMIN]);
    await applyPeopleChange(
      db.client,
      await rolesOf(db, ADMIN),
      grant({ userId: WORKFORCE, role: "workforce", hospitalId: H1 }),
    );
    const workforce = await rolesOf(db, WORKFORCE);
    expect(
      await refusal(
        applyPeopleChange(db.client, workforce, grant({ userId: OTHER_MANAGER, role: "dct", hospitalId: H1 })),
      ),
    ).toMatchObject({ status: 403 });
  });

  it("Medical Workforce names and removes a roster manager in their own hospital, who then runs that team", async () => {
    const db = fakeWorkRolesDb(seed(), [ADMIN]);
    await applyPeopleChange(
      db.client,
      await rolesOf(db, ADMIN),
      grant({ userId: WORKFORCE, role: "workforce", hospitalId: H1 }),
    );
    const workforce = await rolesOf(db, WORKFORCE);
    const setManager = (userId: string, serviceId: string, manager: boolean, hospitalId = H1) =>
      peopleChangeSchema.parse({ action: "set-manager", hospitalId, serviceId, userId, manager });

    // The People screen tells Workforce they may name managers here.
    const view = await applyPeopleChange(db.client, workforce, setManager(TRAINEE, TEAM_A, true));
    expect(view.viewer.canNameManagers).toBe(true);
    expect(view.hospital?.teams.find((team) => team.serviceId === TEAM_A)?.managers.map((m) => m.userId)).toEqual([
      MANAGER,
      TRAINEE,
    ]);
    const named = await rolesOf(db, TRAINEE);
    expect(named.grants).toEqual([{ role: "manager", serviceId: TEAM_A }]);
    expect(screen(hospitalSections(named.grants, H1)).map((section) => section.id)).toEqual(["manager"]);

    // Removing it takes the team away again.
    await applyPeopleChange(db.client, workforce, setManager(TRAINEE, TEAM_A, false));
    expect((await rolesOf(db, TRAINEE)).grants).toEqual([]);

    // Not another hospital's team, not themselves, not someone outside the team.
    expect(
      await refusal(applyPeopleChange(db.client, workforce, setManager(OTHER_MANAGER, TEAM_C, true, H2))),
    ).toMatchObject({
      status: 403,
    });
    expect(await refusal(applyPeopleChange(db.client, workforce, setManager(WORKFORCE, TEAM_B, true)))).toMatchObject({
      status: 403,
    });
    expect(await refusal(applyPeopleChange(db.client, workforce, setManager(TRAINEE, TEAM_B, true)))).toMatchObject({
      status: 404,
    });

    // The DCT and a roster manager cannot name managers.
    await applyPeopleChange(db.client, workforce, grant({ userId: DCT, role: "dct", hospitalId: H1 }));
    expect(
      await refusal(applyPeopleChange(db.client, await rolesOf(db, DCT), setManager(TRAINEE, TEAM_A, true))),
    ).toMatchObject({ status: 403 });
    expect(
      await refusal(applyPeopleChange(db.client, await rolesOf(db, MANAGER), setManager(TRAINEE, TEAM_A, true))),
    ).toMatchObject({ status: 403 });
  });

  it("an archived hospital's roles lapse for everyone who held them", async () => {
    const tables = seed();
    const db = fakeWorkRolesDb(tables, [ADMIN]);
    await applyPeopleChange(
      db.client,
      await rolesOf(db, ADMIN),
      grant({ userId: WORKFORCE, role: "workforce", hospitalId: H1 }),
    );
    tables.work_hospitals!.find((row) => row.id === H1)!.archived_at = "2026-10-27T00:00:00.000Z";
    expect((await rolesOf(db, WORKFORCE)).grants).toEqual([]);
  });
});

/* ------------------------------------------------------------------- every row has a screen */

function pageRoutes(): Set<string> {
  const root = join(process.cwd(), "src", "app");
  const routes = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name === "page.tsx") {
        const segments = relative(root, dir)
          .split(sep)
          .filter((segment) => segment && !/^\(.*\)$/.test(segment));
        routes.add(`/${segments.join("/")}`);
      }
    }
  };
  walk(root);
  return routes;
}

describe("every row on every role's Hospital screen", () => {
  it("opens a page that exists", () => {
    const grants = [
      { role: "administrator" as const },
      { role: "workforce" as const, hospitalId: H1, serviceIds: [TEAM_A] },
      { role: "dct" as const, hospitalId: H1, serviceIds: [TEAM_A] },
      { role: "supervisor" as const, hospitalId: H1, subjectUserId: TRAINEE, hospitalServiceIds: [TEAM_A] },
      { role: "manager" as const, serviceId: TEAM_A },
    ];
    const routes = pageRoutes();
    const hrefs = hospitalSections(grants, H1, allPreviews).flatMap((section) =>
      section.links.map((link) => link.href),
    );
    expect(hrefs.length).toBeGreaterThan(10);
    const missing = hrefs.filter((href) => !routes.has(new URL(href, "https://psychsift.invalid").pathname));
    expect(missing).toEqual([]);
  });
});
