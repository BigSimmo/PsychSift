import {
  clinicalQuestionPatientDetail,
  clinicalQuestionPatientDetailMessage,
} from "@/lib/clinical-question-patient-check";
import { PublicApiError } from "@/lib/http";

export const PATIENT_DETAIL_QUESTION_CODE = "patient_detail_in_question";

/**
 * Throws a 400 when a Clinical question looks like it holds a patient detail, so the answer
 * routes refuse it before retrieval or generation runs. A document summary request is left
 * alone: its text is built by the app from the user's own document, not typed as a question.
 * The error names the kind of detail only, never the matched text.
 */
export function rejectPatientDetailQuestion(body: { query: string; summaryMode?: boolean | null }): void {
  if (body.summaryMode) return;
  const problem = clinicalQuestionPatientDetail(body.query);
  if (!problem) return;
  throw new PublicApiError(clinicalQuestionPatientDetailMessage(problem), 400, {
    code: PATIENT_DETAIL_QUESTION_CODE,
  });
}
