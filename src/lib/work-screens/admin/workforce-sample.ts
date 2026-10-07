/**
 * Admin · Workforce, the health service's side (mockup `admin_hs*`): what
 * Medical Workforce staff would see once doctors share with them. There is no
 * store for another person's records, no workforce role and no sharing link
 * yet, so every row is example data from the shared registry
 * (`src/lib/example-data/datasets/admin-workforce.ts`, "example:" ids), read
 * from nowhere and kept nowhere, behind the example-only gate.
 *
 * Going live needs Josh's approval for: a health-service account role, tables
 * for doctors' shares and requests (a migration), and the sharing switch on
 * the doctor's side.
 */

export const WORKFORCE_SAMPLE_LABEL = "Sample, not your hospital's data";

export type WorkforceStatus = "date-passed" | "start-renewing" | "requested" | "extension" | "not-shared" | "recorded";

export interface WorkforceDoctorItem {
  readonly title: string;
  readonly status: WorkforceStatus;
  readonly date: string | null;
  readonly source: "Shared by the doctor" | "From MyLearning" | "Not shared";
}

export interface WorkforceDoctor {
  readonly id: string;
  readonly name: string;
  readonly role: "Consultant" | "Registrar" | "Resident";
  readonly team: string;
  readonly cleared: boolean;
  readonly items: readonly WorkforceDoctorItem[];
  readonly total: number;
}

export interface WorkforceExtension {
  readonly id: string;
  readonly doctorId: string;
  readonly item: string;
  readonly dueOn: string;
  readonly askedFor: string;
  readonly reason: string;
  readonly decision: "waiting" | "granted" | "nearer" | "declined";
  readonly decidedTo?: string;
}

export const WORKFORCE_STATUS_WORDS: Record<WorkforceStatus, string> = {
  "date-passed": "Date passed",
  "start-renewing": "Start renewing",
  requested: "Requested",
  extension: "Extension asked",
  "not-shared": "Not shared",
  recorded: "Recorded",
};

export type WorkforceFilter = "all" | "date-passed" | "start-renewing" | "extension";

export function doctorNeedsAction(doctor: WorkforceDoctor): number {
  return doctor.items.filter((entry) => entry.status !== "recorded").length;
}

export function recordedCount(doctor: WorkforceDoctor): number {
  return (
    doctor.total - doctor.items.filter((entry) => entry.status === "not-shared" || entry.status === "requested").length
  );
}

/** Needs action first (most first), then by name. */
export function sortDoctors(doctors: readonly WorkforceDoctor[]): WorkforceDoctor[] {
  return [...doctors].sort((a, b) => doctorNeedsAction(b) - doctorNeedsAction(a) || a.name.localeCompare(b.name));
}

export function filterDoctors(
  doctors: readonly WorkforceDoctor[],
  filter: WorkforceFilter,
  query: string,
): WorkforceDoctor[] {
  const needle = query.trim().toLowerCase();
  return sortDoctors(doctors).filter((doctor) => {
    if (needle && ![doctor.name, doctor.team, doctor.role].some((text) => text.toLowerCase().includes(needle)))
      return false;
    if (filter === "all") return true;
    return doctor.items.some((entry) => entry.status === filter);
  });
}

export function filterCount(doctors: readonly WorkforceDoctor[], filter: WorkforceFilter): number {
  return filter === "all"
    ? doctors.length
    : doctors.filter((doctor) => doctor.items.some((entry) => entry.status === filter)).length;
}

export interface WorkforceCohort {
  readonly doctors: number;
  readonly datePassed: number;
  readonly startRenewing: number;
  readonly requested: number;
  readonly notShared: number;
  readonly extensionsWaiting: number;
}

export function workforceCohort(
  doctors: readonly WorkforceDoctor[],
  extensions: readonly WorkforceExtension[],
): WorkforceCohort {
  const all = doctors.flatMap((doctor) => doctor.items);
  return {
    doctors: doctors.length,
    datePassed: all.filter((entry) => entry.status === "date-passed").length,
    startRenewing: all.filter((entry) => entry.status === "start-renewing").length,
    requested: all.filter((entry) => entry.status === "requested").length,
    notShared: all.filter((entry) => entry.status === "not-shared").length,
    extensionsWaiting: extensions.filter((extension) => extension.decision === "waiting").length,
  };
}

export function decideExtension(
  extensions: readonly WorkforceExtension[],
  id: string,
  decision: WorkforceExtension["decision"],
  decidedTo?: string,
): WorkforceExtension[] {
  return extensions.map((extension) =>
    extension.id === id ? { ...extension, decision, ...(decidedTo ? { decidedTo } : {}) } : extension,
  );
}
