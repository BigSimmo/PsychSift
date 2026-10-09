import { EXAMPLE_HOSPITALS, EXAMPLE_PEOPLE, EXAMPLE_SELF } from "@/lib/example-data/people";
import type { ExampleWorkPeople, PeopleGrant, PeopleHospital, PeoplePerson } from "@/lib/work-roles/people-model";

/*
 * Example data for Admin People and roles (`/admin/people`). Two invented
 * hospitals from the standard example places, people from the standard
 * example names, and every id starting "example:". The reader is the example
 * persona, who holds no role in the lists, so the "nobody picks themselves"
 * rule shows. Read through the registry, `loadExampleDataset("admin.people")`.
 * Every change the page makes to these stays in page memory.
 */

const [HOSPITAL, CAMPUS] = EXAMPLE_HOSPITALS;
const [JARRAH, KARRI, BANKSIA, WATTLE, MARRI, TUART, BORONIA, GREVILLEA, WANDOO, KWONGAN, YATE, MALLEE] =
  EXAMPLE_PEOPLE;

const SELF_ID = "example:user-self";
const id = (slug: string) => `example:user-${slug.toLowerCase().replace(/[^a-z]+/g, "-")}`;
const surname = (name: string) => name.split(" ").at(-1) ?? name;

const TEAMS = {
  wardA: { serviceId: "example:team-ward-a", name: "Ward A team" },
  wardB: { serviceId: "example:team-ward-b", name: "Ward B team" },
  liaison: { serviceId: "example:team-liaison", name: "Consultation liaison" },
  emergency: { serviceId: "example:team-emergency", name: "Emergency psychiatry" },
  community: { serviceId: "example:team-community", name: "Community team" },
  older: { serviceId: "example:team-older-adult", name: "Older adult team" },
  youth: { serviceId: "example:team-youth", name: "Youth team" },
} as const;

function person(name: string, ...serviceIds: string[]): PeoplePerson {
  return { userId: id(surname(name)), name, serviceIds };
}

function grant(
  slug: string,
  who: PeoplePerson,
  role: PeopleGrant["role"],
  grantedAt: string,
  grantedByName: string | null,
  cover: { team?: { serviceId: string; name: string }; trainee?: PeoplePerson } = {},
): PeopleGrant {
  return {
    id: `example:grant-${slug}`,
    userId: who.userId,
    name: who.name,
    role,
    serviceId: cover.team?.serviceId ?? null,
    serviceName: cover.team?.name ?? null,
    subjectUserId: cover.trainee?.userId ?? null,
    subjectName: cover.trainee?.name ?? null,
    grantedAt,
    grantedByName,
  };
}

/** The example records, built fresh each time so page memory never changes the registry's copy. */
export function exampleWorkPeople(): ExampleWorkPeople {
  const self: PeoplePerson = { userId: SELF_ID, name: EXAMPLE_SELF, serviceIds: [TEAMS.wardA.serviceId] };
  const jarrah = person(JARRAH, TEAMS.wardA.serviceId);
  const karri = person(KARRI, TEAMS.wardA.serviceId);
  const banksia = person(BANKSIA, TEAMS.wardA.serviceId);
  const wattle = person(WATTLE, TEAMS.wardB.serviceId);
  const marri = person(MARRI, TEAMS.wardB.serviceId);
  const tuart = person(TUART, TEAMS.liaison.serviceId);
  const boronia = person(BORONIA, TEAMS.liaison.serviceId);
  const grevillea = person(GREVILLEA, TEAMS.emergency.serviceId);
  const wandoo = person(WANDOO, TEAMS.community.serviceId);
  const kwongan = person(KWONGAN, TEAMS.community.serviceId);
  const yate = person(YATE, TEAMS.community.serviceId);
  const mallee = person(MALLEE, TEAMS.older.serviceId);

  const hospital: PeopleHospital = {
    id: "example:hospital-main",
    name: HOSPITAL,
    teams: [
      { ...TEAMS.wardA, managers: [{ userId: jarrah.userId, name: jarrah.name }] },
      { ...TEAMS.wardB, managers: [{ userId: wattle.userId, name: wattle.name }] },
      { ...TEAMS.liaison, managers: [] },
      { ...TEAMS.emergency, managers: [{ userId: grevillea.userId, name: grevillea.name }] },
    ],
    people: [self, jarrah, karri, banksia, wattle, marri, tuart, boronia, grevillea],
    grants: [
      grant("workforce-karri", karri, "workforce", "2026-07-01T01:00:00.000Z", "Site administrator"),
      grant("dct-tuart", tuart, "dct", "2026-07-02T01:30:00.000Z", karri.name),
      grant("sup-jarrah-banksia", jarrah, "supervisor", "2026-08-04T02:00:00.000Z", tuart.name, {
        trainee: banksia,
      }),
      grant("sup-jarrah-marri", jarrah, "supervisor", "2026-08-04T02:00:00.000Z", tuart.name, { trainee: marri }),
      grant("sup-wattle-ward-b", wattle, "supervisor", "2026-08-11T03:00:00.000Z", karri.name, {
        team: TEAMS.wardB,
      }),
      grant("sup-grevillea-hospital", grevillea, "supervisor", "2026-09-01T00:30:00.000Z", tuart.name),
    ],
  };

  const campus: PeopleHospital = {
    id: "example:hospital-campus",
    name: CAMPUS,
    teams: [{ ...TEAMS.community, managers: [{ userId: wandoo.userId, name: wandoo.name }] }],
    people: [self, wandoo, kwongan, yate, mallee],
    grants: [
      grant("workforce-wandoo", wandoo, "workforce", "2026-06-15T01:00:00.000Z", "Site administrator"),
      grant("sup-kwongan-community", kwongan, "supervisor", "2026-08-20T02:00:00.000Z", wandoo.name, {
        team: TEAMS.community,
      }),
    ],
  };

  return {
    viewer: { userId: SELF_ID, name: EXAMPLE_SELF, administrator: true },
    hospitals: [hospital, campus],
    unlinkedTeams: [TEAMS.older, TEAMS.youth],
  };
}
