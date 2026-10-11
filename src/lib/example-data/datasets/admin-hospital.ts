import { EXAMPLE_HOSPITALS, EXAMPLE_PEOPLE, EXAMPLE_WARDS } from "@/lib/example-data/people";
import type {
  ExampleHospitalHub,
  HospitalSickCall,
  HospitalSickKind,
  HospitalSickStatus,
  HospitalSickView,
} from "@/lib/work-roles/hospital-hub";
import {
  shortStaffedWindow,
  type HospitalShortStaffedView,
  type ShortStaffedDay,
} from "@/lib/work-roles/hospital-short-staffed-view";
import type { WorkRoleGrant } from "@/lib/work-roles/model";
import { zonedDateOf, zonedWallToIso } from "@/lib/work-time/format";

/*
 * Example data for Hospital (`/admin/hospital`), its sick calls
 * (`/admin/hospital/sick`) and its short-staffed days
 * (`/admin/hospital/short-staffed`). The reader holds every hospital role at once, so
 * every section shows. Hospitals, wards and people come from the standard
 * example lists, every id starts "example:", and the sick calls sit around
 * today in the work time zone. A sick call carries no reason or health detail,
 * because none is ever asked for. A short-staffed day carries counts and a
 * team name only. Read through the registry,
 * `loadExampleDataset("admin.hospital")`.
 */

const [HOSPITAL, CAMPUS] = EXAMPLE_HOSPITALS;
const [WARD_A, WARD_B, WARD_C] = EXAMPLE_WARDS;
const [JARRAH, KARRI, BANKSIA, WATTLE, MARRI, TUART, BORONIA, GREVILLEA, , , YATE, MALLEE] = EXAMPLE_PEOPLE;

const MAIN_ID = "example:hospital-main";
const CAMPUS_ID = "example:hospital-campus";

const TEAMS = {
  wardA: { serviceId: "example:team-ward-a", name: `${WARD_A} psychiatry` },
  wardB: { serviceId: "example:team-ward-b", name: `${WARD_B} psychiatry` },
  liaison: { serviceId: "example:team-liaison", name: "Consultation liaison" },
  emergency: { serviceId: "example:team-emergency", name: "Emergency psychiatry" },
  wardC: { serviceId: "example:team-ward-c", name: `${WARD_C} psychiatry` },
  community: { serviceId: "example:team-community", name: "Community team" },
} as const;

type Team = (typeof TEAMS)[keyof typeof TEAMS];

// The shared patient-detail check reads the on-call code "OC" as initials, so the example calls use no on-call shift.
const SHIFTS: Readonly<Record<HospitalSickKind, { code: string; from: string; to: string; overnight?: boolean }>> = {
  day: { code: "D", from: "08:00", to: "16:30" },
  evening: { code: "L", from: "13:00", to: "22:30" },
  night: { code: "N", from: "22:00", to: "08:30", overnight: true },
  on_call: { code: "OC", from: "17:00", to: "08:00", overnight: true },
  other: { code: "T", from: "09:00", to: "12:00" },
};

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** A wall time in the zone to an instant. Example times are never skipped by a daylight-saving jump. */
function at(date: string, time: string, zone: string): string {
  return zonedWallToIso(date, time, zone) ?? `${date}T${time}:00.000Z`;
}

function call(
  slug: string,
  team: Team,
  name: string,
  kind: HospitalSickKind,
  dayOffset: number,
  status: HospitalSickStatus,
  today: string,
  zone: string,
): HospitalSickCall {
  const shift = SHIFTS[kind];
  const date = addDays(today, dayOffset);
  const startsAt = at(date, shift.from, zone);
  // Reported the evening before, or early that morning for an evening or night shift.
  const reportedAt = kind === "day" ? at(addDays(date, -1), "19:40", zone) : at(date, "07:15", zone);
  return {
    id: `example:sick-${slug}`,
    serviceId: team.serviceId,
    teamName: team.name,
    name,
    kind,
    shiftCode: shift.code,
    startsAt,
    endsAt: at(shift.overnight ? addDays(date, 1) : date, shift.to, zone),
    reportedAt,
    status,
  };
}

function short(
  team: Team,
  dayOffset: number,
  on: number,
  needed: number,
  shortKinds: ShortStaffedDay["short"],
  today: string,
): ShortStaffedDay {
  return {
    date: addDays(today, dayOffset),
    serviceId: team.serviceId,
    teamName: team.name,
    on,
    needed,
    short: shortKinds,
    kinds: ["day", "evening"],
  };
}

/** The example records, built fresh each time so page memory never changes the registry's copy. */
export function exampleHospitalHub(now: Date, zone: string): ExampleHospitalHub {
  const today = zonedDateOf(now, zone);
  const mainTeams = [TEAMS.wardA, TEAMS.wardB, TEAMS.liaison, TEAMS.emergency];
  const campusTeams = [TEAMS.wardC, TEAMS.community];

  const main: HospitalSickView = {
    hospital: { id: MAIN_ID, name: HOSPITAL },
    teams: [...mainTeams].sort((a, b) => a.name.localeCompare(b.name)),
    calls: [
      call("yesterday-covered", TEAMS.wardB, MARRI, "day", -1, "covered", today, zone),
      call("today-needs", TEAMS.wardA, KARRI, "evening", 0, "needs-cover", today, zone),
      call("today-covered", TEAMS.liaison, TUART, "day", 0, "covered", today, zone),
      call("tomorrow-offered", TEAMS.emergency, GREVILLEA, "night", 1, "offered", today, zone),
      call("tomorrow-needs", TEAMS.wardA, BANKSIA, "day", 1, "needs-cover", today, zone),
      call("in-two-asked", TEAMS.wardB, WATTLE, "evening", 2, "asked", today, zone),
      call("in-four-needs", TEAMS.liaison, BORONIA, "day", 4, "needs-cover", today, zone),
      call("in-six-offered", TEAMS.wardA, JARRAH, "day", 6, "offered", today, zone),
    ],
  };

  const campus: HospitalSickView = {
    hospital: { id: CAMPUS_ID, name: CAMPUS },
    teams: [...campusTeams].sort((a, b) => a.name.localeCompare(b.name)),
    calls: [
      call("campus-today-asked", TEAMS.community, YATE, "day", 0, "asked", today, zone),
      call("campus-in-three-needs", TEAMS.wardC, MALLEE, "night", 3, "needs-cover", today, zone),
    ],
  };

  const grants: WorkRoleGrant[] = [
    { role: "administrator" },
    {
      role: "workforce",
      hospitalId: MAIN_ID,
      hospitalName: HOSPITAL,
      serviceIds: mainTeams.map((team) => team.serviceId),
    },
    {
      role: "workforce",
      hospitalId: CAMPUS_ID,
      hospitalName: CAMPUS,
      serviceIds: campusTeams.map((team) => team.serviceId),
    },
    { role: "dct", hospitalId: MAIN_ID, hospitalName: HOSPITAL, serviceIds: mainTeams.map((team) => team.serviceId) },
    { role: "supervisor", hospitalId: MAIN_ID, serviceId: TEAMS.wardA.serviceId },
    { role: "supervisor", hospitalId: MAIN_ID, subjectUserId: "example:user-tuart" },
    { role: "supervisor", hospitalId: MAIN_ID, subjectUserId: "example:user-boronia" },
    { role: "manager", serviceId: TEAMS.wardA.serviceId },
  ];

  // Short-staffed days: one team with no safe number, one whose roster stops after two weeks, and a
  // second hospital with nothing short, so every line the screen can show has an example.
  const window = shortStaffedWindow(now, zone);
  const teamRow = (team: Team, safeNumber: boolean, checkedThrough: string | null) => ({
    serviceId: team.serviceId,
    name: team.name,
    safeNumber,
    checkedThrough,
  });
  const mainShort: HospitalShortStaffedView = {
    hospital: main.hospital,
    window,
    teams: [
      teamRow(TEAMS.liaison, false, window.to),
      teamRow(TEAMS.emergency, true, window.to),
      teamRow(TEAMS.wardA, true, window.to),
      teamRow(TEAMS.wardB, true, addDays(today, 13)),
    ],
    days: [
      short(TEAMS.wardA, 1, 5, 6, [{ kind: "day", on: 3, needed: 4 }], today),
      short(
        TEAMS.emergency,
        1,
        1,
        3,
        [
          { kind: "day", on: 1, needed: 2 },
          { kind: "evening", on: 0, needed: 1 },
        ],
        today,
      ),
      short(TEAMS.wardB, 3, 4, 5, [{ kind: "evening", on: 1, needed: 2 }], today),
      short(TEAMS.wardA, 9, 4, 6, [{ kind: "day", on: 2, needed: 4 }], today),
      short(TEAMS.emergency, 16, 2, 3, [], today),
    ],
  };
  const campusShort: HospitalShortStaffedView = {
    hospital: campus.hospital,
    window,
    teams: [teamRow(TEAMS.community, true, window.to), teamRow(TEAMS.wardC, true, null)],
    days: [],
  };

  return { grants, hospitals: [main, campus], shortStaffed: [mainShort, campusShort] };
}
