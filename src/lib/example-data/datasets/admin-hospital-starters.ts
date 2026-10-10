import { EXAMPLE_HOSPITALS, EXAMPLE_PEOPLE, EXAMPLE_WARDS } from "@/lib/example-data/people";
import type {
  ExampleHospitalStarters,
  HospitalStarter,
  HospitalStartersView,
} from "@/lib/work-roles/hospital-starters-model";
import { zonedDateOf } from "@/lib/work-time/format";

/*
 * Example data for New starters (`/admin/hospital/starters`). The same two
 * example hospitals and teams as the Hospital example, with doctors from the
 * standard example list who chose to share their New job progress. Every id
 * starts "example:" and start dates sit around today in the work time zone.
 * Item titles are ordinary New job steps, never anything about a patient.
 * Read through the registry, `loadExampleDataset("admin.hospitalStarters")`.
 */

const [HOSPITAL, CAMPUS] = EXAMPLE_HOSPITALS;
const [WARD_A, WARD_B, WARD_C] = EXAMPLE_WARDS;
const [, , , , , , , , WANDOO, KWONGAN, , , TINGLE, ZAMIA, HAKEA, BALGA, MULGA] = EXAMPLE_PEOPLE;

const TEAMS = {
  wardA: { serviceId: "example:team-ward-a", name: `${WARD_A} psychiatry` },
  wardB: { serviceId: "example:team-ward-b", name: `${WARD_B} psychiatry` },
  liaison: { serviceId: "example:team-liaison", name: "Consultation liaison" },
  emergency: { serviceId: "example:team-emergency", name: "Emergency psychiatry" },
  wardC: { serviceId: "example:team-ward-c", name: `${WARD_C} psychiatry` },
  community: { serviceId: "example:team-community", name: "Community team" },
} as const;

const STEPS = [
  "Hospital email and network login",
  "Pager collected",
  "Results system access",
  "Prescribing system login",
  "Remote access set up",
  "Swipe card for after-hours entry",
] as const;

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

function starter(
  slug: string,
  name: string,
  teams: readonly { readonly name: string }[],
  startOffset: number | null,
  done: number,
  today: string,
): HospitalStarter {
  return {
    id: `example:starter-${slug}`,
    name,
    teams: teams.map((team) => team.name),
    startsOn: startOffset === null ? null : addDays(today, startOffset),
    done,
    total: STEPS.length,
    toDo: STEPS.slice(done),
  };
}

/** The example records, built fresh each time so page memory never changes the registry's copy. */
export function exampleHospitalStarters(now: Date, zone: string): ExampleHospitalStarters {
  const today = zonedDateOf(now, zone);
  const mainTeams = [TEAMS.wardA, TEAMS.wardB, TEAMS.liaison, TEAMS.emergency];
  const campusTeams = [TEAMS.wardC, TEAMS.community];

  const main: HospitalStartersView = {
    hospital: { id: "example:hospital-main", name: HOSPITAL },
    teams: [...mainTeams].sort((a, b) => a.name.localeCompare(b.name)),
    starters: [
      starter("wandoo", WANDOO, [TEAMS.wardA], 3, 2, today),
      starter("kwongan", KWONGAN, [TEAMS.liaison], 10, 5, today),
      starter("tingle", TINGLE, [TEAMS.emergency], -6, 6, today),
      starter("zamia", ZAMIA, [TEAMS.wardB], null, 1, today),
      starter("hakea", HAKEA, [TEAMS.wardA, TEAMS.liaison], -45, 6, today),
    ],
  };

  const campus: HospitalStartersView = {
    hospital: { id: "example:hospital-campus", name: CAMPUS },
    teams: [...campusTeams].sort((a, b) => a.name.localeCompare(b.name)),
    starters: [
      starter("balga", BALGA, [TEAMS.community], 1, 0, today),
      starter("mulga", MULGA, [TEAMS.wardC], 21, 3, today),
    ],
  };

  return { hospitals: [main, campus] };
}
