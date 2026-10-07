/*
 * The one door to the shared patient-detail check for the Assessments work screens. Every free-text
 * field here that is sent, copied or exported (EPA feedback lines, correction requests) goes through it.
 * No detection logic lives here: if the shared module moves, only the path below changes.
 */
import { checkPatientDetail, type PatientDetailProblem } from "@/lib/work-text/patient-detail-check";

export { checkPatientDetail, looksLikePatientDetail } from "@/lib/work-text/patient-detail-check";
export type { PatientDetailProblem } from "@/lib/work-text/patient-detail-check";

/** What to show when the text may hold a patient detail (title, body, an optional cleaned suggestion), or null. */
export function patientDetailProblem(text: string): PatientDetailProblem | null {
  if (!text.trim()) return null;
  return checkPatientDetail(text);
}
