import {
  checkPatientDetail,
  looksLikePatientDetail,
  type PatientDetailCheckOptions,
  type PatientDetailProblem,
} from "@/lib/work-text/patient-detail-check";

export { checkPatientDetail, looksLikePatientDetail };

/**
 * The one door from Admin's own-paperwork screens to the shared patient-detail
 * check (`@/lib/work-text/patient-detail-check`, wiring brief 03:32 UTC). No
 * detection lives here. Free text is checked before it is saved, copied,
 * downloaded or put in an email draft, and what the doctor typed is what is kept.
 */
export type AdminPatientProblem = PatientDetailProblem;

export function adminPatientProblem(text: string, options?: PatientDetailCheckOptions): AdminPatientProblem | null {
  const trimmed = text.trim();
  return trimmed ? checkPatientDetail(trimmed, options) : null;
}

/**
 * The first problem in any of the doctor's own typed texts, checked one by one
 * just before something is copied, emailed or saved to a file. Generated lines
 * (dates, status words) are not passed in: the shared check reads a printed date
 * as a possible date of birth.
 */
export function firstAdminPatientProblem(
  texts: readonly (string | null | undefined)[],
  options?: PatientDetailCheckOptions,
): AdminPatientProblem | null {
  for (const text of texts) {
    const problem = text ? adminPatientProblem(text, options) : null;
    if (problem) return problem;
  }
  return null;
}
