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
