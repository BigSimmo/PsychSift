import type { CmeRoutine } from "@/lib/cme/routines";
import type { ExampleWorkforce } from "@/lib/example-data/datasets/admin-workforce";
import type { ExampleSupervisionByDoctor } from "@/lib/example-data/datasets/assessments-supervision";
import type { CmeEntry, CmeRequirementSet } from "@/lib/cme/types";
import type { OnCallEntry } from "@/lib/on-call/entry-model";
import type { OpenShiftListing } from "@/lib/open-shifts/model";
import type { RosterTeam } from "@/lib/roster/team/model";
import type { OnCallShift } from "@/lib/roster/shifts/model";
import type { EpaRecord } from "@/lib/teaching/assessments/sample";
import type { SessionSummary } from "@/lib/teaching/model";
import type { TermTrackerState } from "@/lib/teaching/term-tracker";
import type { WorkAreaId } from "@/lib/work-frame/areas";
import type { ExampleHospitalHub } from "@/lib/work-roles/hospital-hub";
import type { ExampleWorkPeople } from "@/lib/work-roles/people-model";
import type { AdminPaperwork } from "@/lib/work-screens/admin/paperwork-model";
import type { EarlierAlert } from "@/lib/work-screens/my-day/earlier-alerts";
import { DEFAULT_WORK_TIME_ZONE } from "@/lib/work-time/zones";
import { zonedDateOf } from "@/lib/work-time/format";

/**
 * The one registry of example datasets. Every work screen that shows example
 * data reads it through here (or through the area's own sample module listed
 * here), so there is a single list of what "example data" means and nothing
 * ships to people who never turn it on: each loader is a dynamic import.
 *
 * ADDING A DATASET. Put the builder in the area's sample module (or a new file
 * in `src/lib/example-data/datasets/`), take names from `people.ts`, start
 * every record id with `example:` (or keep the area's existing `sample-`,
 * `sample:` or `demo-` prefix, which the guards also recognise), then add a key
 * to `ExampleDatasets` and a loader to `LOADERS`. `tests/example-data-registry.test.ts`
 * runs every dataset through the shared patient-detail check.
 *
 * Builders take `now` so dates sit around today in the work time zone.
 */

export type ExampleDatasets = {
  "roster.myShifts": OnCallShift[];
  "roster.teams": RosterTeam[];
  "openShifts.listings": OpenShiftListing[];
  "onCall.entries": readonly OnCallEntry[];
  "teaching.sessions": SessionSummary[];
  "teaching.termTracker": TermTrackerState;
  "assessments.epaRecords": readonly EpaRecord[];
  "assessments.supervision": ExampleSupervisionByDoctor;
  "cpd.entries": readonly CmeEntry[];
  "cpd.year": CmeRequirementSet;
  "cpd.routines": readonly CmeRoutine[];
  "myDay.earlierAlerts": EarlierAlert[];
  "admin.requests": AdminPaperwork;
  "admin.sharing": AdminPaperwork;
  "admin.documents": AdminPaperwork;
  "admin.pay": AdminPaperwork;
  "admin.tax": AdminPaperwork;
  "admin.workforce": ExampleWorkforce;
  "admin.people": ExampleWorkPeople;
  "admin.hospital": ExampleHospitalHub;
};

export type ExampleDatasetKey = keyof ExampleDatasets;

type Loader<K extends ExampleDatasetKey> = (now: Date, zone: string) => Promise<ExampleDatasets[K]>;

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const LOADERS: { [K in ExampleDatasetKey]: Loader<K> } = {
  "roster.myShifts": async (now) => (await import("@/lib/roster/team/demo-team-core")).demoMyShifts(now),
  "roster.teams": async () => (await import("@/lib/roster/team/demo-team-core")).demoRosterTeams(),
  "openShifts.listings": async (now) => (await import("@/lib/open-shifts/sample")).sampleListings(now),
  "onCall.entries": async () => (await import("@/lib/on-call/demo-entries")).DEMO_ON_CALL_ENTRIES,
  "teaching.sessions": async (now, zone) => {
    const today = zonedDateOf(now, zone);
    return (await import("@/lib/teaching/demo-programme")).demoTeachingSessions(
      { from: addDays(today, -7), to: addDays(today, 28) },
      now,
    );
  },
  "teaching.termTracker": async (now, zone) =>
    (await import("@/lib/teaching/term-tracker")).sampleTermTracker(zonedDateOf(now, zone)),
  "assessments.epaRecords": async () => (await import("@/lib/teaching/assessments/sample")).SAMPLE_EPA_RECORDS,
  "assessments.supervision": async () =>
    (await import("@/lib/example-data/datasets/assessments-supervision")).EXAMPLE_ASSESSMENTS_SUPERVISION,
  "cpd.entries": async () => (await import("@/lib/cme/demo-year")).DEMO_CME_ENTRIES,
  "cpd.year": async () => (await import("@/lib/cme/demo-year")).DEMO_CME_YEAR,
  "cpd.routines": async () => (await import("@/lib/cme/demo-year")).DEMO_CME_ROUTINES,
  "myDay.earlierAlerts": async (now, zone) =>
    (await import("@/lib/example-data/datasets/my-day-earlier-alerts")).exampleEarlierAlerts(now.getTime(), zone),
  "admin.requests": async () => (await import("@/lib/example-data/datasets/admin-paperwork")).exampleRequests(),
  "admin.sharing": async () => (await import("@/lib/example-data/datasets/admin-paperwork")).exampleSharing(),
  "admin.documents": async () => (await import("@/lib/example-data/datasets/admin-paperwork")).exampleDocuments(),
  "admin.pay": async () => (await import("@/lib/example-data/datasets/admin-paperwork")).examplePayslips(),
  "admin.tax": async () => (await import("@/lib/example-data/datasets/admin-paperwork")).exampleTax(),
  "admin.workforce": async () => (await import("@/lib/example-data/datasets/admin-workforce")).exampleWorkforce(),
  "admin.people": async () => (await import("@/lib/example-data/datasets/admin-people")).exampleWorkPeople(),
  "admin.hospital": async (now, zone) =>
    (await import("@/lib/example-data/datasets/admin-hospital")).exampleHospitalHub(now, zone),
};

/** Which area each dataset belongs to, so a screen only shows it while that area's example data is on. */
export const EXAMPLE_DATASET_AREA: { readonly [K in ExampleDatasetKey]: WorkAreaId } = {
  "roster.myShifts": "rost",
  "roster.teams": "rost",
  "openShifts.listings": "rost",
  "onCall.entries": "call",
  "teaching.sessions": "teach",
  "teaching.termTracker": "teach",
  "assessments.epaRecords": "assess",
  "assessments.supervision": "assess",
  "cpd.entries": "cpd",
  "cpd.year": "cpd",
  "cpd.routines": "cpd",
  "myDay.earlierAlerts": "day",
  "admin.requests": "admin",
  "admin.sharing": "admin",
  "admin.documents": "admin",
  "admin.pay": "admin",
  "admin.tax": "admin",
  "admin.workforce": "admin",
  "admin.people": "admin",
  "admin.hospital": "admin",
};

export const EXAMPLE_DATASET_KEYS = Object.keys(LOADERS) as ExampleDatasetKey[];

/** Load one example dataset. Never fetches: every builder is local, invented data. */
export function loadExampleDataset<K extends ExampleDatasetKey>(
  key: K,
  now: Date = new Date(),
  zone: string = DEFAULT_WORK_TIME_ZONE,
): Promise<ExampleDatasets[K]> {
  return LOADERS[key](now, zone);
}
