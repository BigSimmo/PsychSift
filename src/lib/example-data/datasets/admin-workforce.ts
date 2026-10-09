import { EXAMPLE_PEOPLE, EXAMPLE_WARDS } from "@/lib/example-data/people";
import type {
  WorkforceDoctor,
  WorkforceDoctorItem,
  WorkforceExtension,
  WorkforceStatus,
} from "@/lib/work-screens/admin/workforce-sample";

/*
 * Example data for Admin Workforce (`/admin/workforce`), the health service's side. There is no store
 * for another person's records, so this page only ever shows example data, behind the example-only
 * gate. Names and teams come from the standard example people and places (`people.ts`). Every id
 * starts "example:". Read through the registry, `loadExampleDataset("admin.workforce")`.
 */

export interface WorkforceStarter {
  readonly id: string;
  readonly name: string;
  readonly role: WorkforceDoctor["role"];
  readonly team: string;
  readonly startsOn: string;
  readonly ready: number;
  readonly total: number;
}

export interface WorkforceContractEnd {
  readonly id: string;
  readonly name: string;
  readonly team: string;
  readonly endsOn: string;
}

export interface ExampleWorkforce {
  readonly doctors: readonly WorkforceDoctor[];
  readonly extensions: readonly WorkforceExtension[];
  readonly starters: readonly WorkforceStarter[];
  readonly contractEnds: readonly WorkforceContractEnd[];
}

const [WARD_A, WARD_B, WARD_C] = EXAMPLE_WARDS;
const [JARRAH, KARRI, BANKSIA, WATTLE, MARRI, TUART, BORONIA, GREVILLEA] = EXAMPLE_PEOPLE;

function item(
  title: string,
  status: WorkforceStatus,
  date: string | null,
  source: WorkforceDoctorItem["source"] = "Shared by the doctor",
): WorkforceDoctorItem {
  return { title, status, date, source };
}

function doctor(
  id: string,
  name: string,
  role: WorkforceDoctor["role"],
  team: string,
  cleared: boolean,
  items: readonly WorkforceDoctorItem[],
): WorkforceDoctor {
  return { id: `example:doctor-${id}`, name, role, team, cleared, total: 16, items };
}

const DOCTORS: readonly WorkforceDoctor[] = [
  doctor("jarrah", JARRAH, "Consultant", WARD_C, true, [
    item("Manual handling", "date-passed", "2026-09-30", "From MyLearning"),
    item("Basic life support", "date-passed", "2026-09-28"),
    item("Medical registration", "recorded", "2027-09-30"),
  ]),
  doctor("karri", KARRI, "Consultant", WARD_A, true, [
    item("Basic life support", "extension", "2026-09-23"),
    item("Respirator fit test", "start-renewing", "2026-10-14"),
    item("Manual handling", "start-renewing", "2026-10-18", "From MyLearning"),
    item("Family and domestic violence", "requested", "2026-10-31"),
    item("Working with Children Check", "start-renewing", "2026-11-14"),
  ]),
  doctor("banksia", BANKSIA, "Registrar", WARD_A, false, [
    item("Respirator fit test", "extension", "2026-10-09"),
    item("Working with Children Check", "not-shared", null, "Not shared"),
  ]),
  doctor("wattle", WATTLE, "Registrar", WARD_A, true, [
    item("Fire and evacuation", "date-passed", "2026-10-01", "From MyLearning"),
  ]),
  doctor("marri", MARRI, "Registrar", WARD_B, true, [
    item("Hand hygiene", "start-renewing", "2026-11-25", "From MyLearning"),
  ]),
  doctor("tuart", TUART, "Consultant", WARD_C, true, []),
];

/** The example Workforce view. Fixed dates, as the other Admin examples. */
export function exampleWorkforce(): ExampleWorkforce {
  return {
    doctors: DOCTORS,
    extensions: [
      {
        id: "example:ext-karri",
        doctorId: "example:doctor-karri",
        item: "Basic life support",
        dueOn: "2026-09-23",
        askedFor: "2026-10-30",
        reason: "Next course date",
        decision: "waiting",
      },
      {
        id: "example:ext-jarrah",
        doctorId: "example:doctor-jarrah",
        item: "Manual handling",
        dueOn: "2026-09-30",
        askedFor: "2026-10-23",
        reason: "Course full",
        decision: "waiting",
      },
      {
        id: "example:ext-banksia",
        doctorId: "example:doctor-banksia",
        item: "Respirator fit test",
        dueOn: "2026-10-09",
        askedFor: "2026-10-23",
        reason: "On nights until 18 Oct",
        decision: "waiting",
      },
    ],
    starters: [
      {
        id: "example:starter-boronia",
        name: BORONIA,
        role: "Registrar",
        team: WARD_A,
        startsOn: "2026-11-02",
        ready: 11,
        total: 16,
      },
      {
        id: "example:starter-grevillea",
        name: GREVILLEA,
        role: "Resident",
        team: WARD_B,
        startsOn: "2026-11-02",
        ready: 6,
        total: 16,
      },
    ],
    contractEnds: [
      { id: "example:end-banksia", name: BANKSIA, team: WARD_A, endsOn: "2027-02-01" },
      { id: "example:end-marri", name: MARRI, team: WARD_B, endsOn: "2027-02-01" },
    ],
  };
}
