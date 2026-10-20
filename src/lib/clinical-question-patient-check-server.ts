import {
  clinicalQuestionPatientDetail,
  clinicalQuestionPatientDetailMessage,
} from "@/lib/clinical-question-patient-check";
import type { ClinicalAskRequest } from "@/lib/clinical-ask/contracts";
import { PublicApiError } from "@/lib/http";
import type { PatientDetailProblem } from "@/lib/work-text/patient-detail-check";

export const PATIENT_DETAIL_QUESTION_CODE = "patient_detail_in_question";

/**
 * Throws a 400 when a Clinical question looks like it holds a patient detail, so the answer
 * routes refuse it before retrieval or generation runs. Summary requests still validate their
 * supplied query, so a caller cannot use summary mode to bypass the check or retain raw details.
 * The error names the kind of detail only, never the matched text.
 */
export function rejectPatientDetailQuestion(body: { query: string; summaryMode?: boolean | null }): void {
  const problem = clinicalQuestionPatientDetail(body.query);
  if (!problem) return;
  throw new PublicApiError(clinicalQuestionPatientDetailMessage(problem), 400, {
    code: PATIENT_DETAIL_QUESTION_CODE,
  });
}

/**
 * The same check, run on every text a Clinical Ask request can send on to the AI services: the
 * question, each confirmed-context value and each clarification answer (audit ARCH-06, 2026-10-20).
 * Clinical Ask used to run only the narrower identifier-shape test, so a name with a title, a bed
 * beside a name or a bare UMRN that Answer refuses could still leave for OpenAI. Returns the first
 * problem found, or null when every text reads as safe to send.
 */
export function clinicalAskRequestPatientDetail(
  request: Pick<ClinicalAskRequest, "question" | "confirmedContext" | "clarificationAnswers">,
): PatientDetailProblem | null {
  const contextValues = Object.values(request.confirmedContext).flatMap((value) =>
    Array.isArray(value) ? value : value ? [value] : [],
  );
  for (const text of [request.question, ...contextValues, ...Object.values(request.clarificationAnswers)]) {
    if (typeof text !== "string") continue;
    const problem = clinicalQuestionPatientDetail(text);
    if (problem) return problem;
  }
  return null;
}

export const PATIENT_DETAIL_FEEDBACK_NOTE_CODE = "patient_detail_in_feedback_note";

/**
 * Throws a 400 when a feedback note looks like it holds a patient detail, before anything is
 * saved. Like the question check, the message names the kind of detail only, never the text.
 */
export function rejectPatientDetailFeedbackNote(note: string | null | undefined): void {
  if (!note) return;
  const problem = clinicalQuestionPatientDetail(note);
  if (!problem) return;
  const finding = problem.title.replace(/^This looks like /, "").replace(/^This may be /, "");
  throw new PublicApiError(
    `This note looks like it holds a patient detail (${finding}). Remove it and send the report again. This check catches some details, not all.`,
    400,
    { code: PATIENT_DETAIL_FEEDBACK_NOTE_CODE },
  );
}
