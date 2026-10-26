import type * as PatientCheck from "@/lib/clinical-question-patient-check";

// Matches the Answer path's wording when the check cannot load.
import { patientCheckUnavailableMessage } from "@/lib/patient-check-unavailable-copy";

/**
 * Whether a question set aside by Not now may run as a Documents search. The
 * Terms step can hold a question before the Answer path's patient check runs
 * (a ?run=1 link, a recent question), so the fallback checks it here: a question
 * that looks like it holds a patient detail, or one that cannot be checked, is
 * not sent to the documents search or written into the address bar (audit S2).
 */
export async function notNowDocumentsSearch(
  query: string,
  loadCheck: () => Promise<typeof PatientCheck> = () => import("@/lib/clinical-question-patient-check"),
): Promise<{ query: string } | { notice: string }> {
  const check = await loadCheck().catch(() => null);
  if (!check) return { notice: patientCheckUnavailableMessage() };
  const detail = check.clinicalQuestionPatientDetail(query);
  if (detail) return { notice: check.clinicalQuestionPatientDetailMessage(detail) };
  return { query };
}
