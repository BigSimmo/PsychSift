/*
 * The one door from the CPD work screens to the shared patient-detail check
 * (`@/lib/work-text/patient-detail-check`, wiring brief 03:32 UTC). No detection lives here: if the
 * shared module moves, only the path below changes. The year's CSV carries two free-text fields, an
 * activity's title and its reflection, so both are read before the file is made.
 */
import { activeCmeYearEntries } from "@/lib/cme/export";
import type { CmeEntry } from "@/lib/cme/types";
import { withoutExampleRecords } from "@/lib/work-screens/cpd/sample";
import { checkPatientDetail, type PatientDetailProblem } from "@/lib/work-text/patient-detail-check";

export { checkPatientDetail, looksLikePatientDetail } from "@/lib/work-text/patient-detail-check";
export type { PatientDetailProblem } from "@/lib/work-text/patient-detail-check";

export type CpdPatientFlag = {
  readonly id: string;
  readonly date: string;
  readonly title: string;
  /** Which exported field the check flagged. The title is read first. */
  readonly field: "title" | "reflection";
  readonly problem: PatientDetailProblem;
};

/**
 * The activities whose exported free text may hold a patient detail, in the CSV's own order. Titles
 * name courses and services in capitals ("RANZCP", "ECT"), so bare capitals are read past there.
 */
export function cpdExportPatientFlags(entries: readonly CmeEntry[], year: number): CpdPatientFlag[] {
  const flags: CpdPatientFlag[] = [];
  for (const entry of activeCmeYearEntries(withoutExampleRecords(entries), year)) {
    const title = entry.title.trim() ? checkPatientDetail(entry.title, { allowCapitals: true }) : null;
    const reflection = entry.reflection.trim() ? checkPatientDetail(entry.reflection) : null;
    const problem = title ?? reflection;
    if (problem) {
      flags.push({
        id: entry.id,
        date: entry.date,
        title: entry.title,
        field: title ? "title" : "reflection",
        problem,
      });
    }
  }
  return flags;
}
