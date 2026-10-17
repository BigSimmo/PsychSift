import { formatRecordedDate } from "@/lib/admin/renewal-dates";
import type { AdminPaperwork } from "@/lib/work-screens/admin/paperwork-model";
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

function stripRequestDates(req: AdminPaperwork["requests"][number]): string {
  let message = req.message;
  const formattedDue = req.dueOn ? formatRecordedDate(req.dueOn) : "";
  const formattedAsked = req.askedFor ? formatRecordedDate(req.askedFor) : "";
  if (formattedDue && formattedAsked) {
    message = message.replace(`, ${formattedDue} to ${formattedAsked}?`, "?");
  } else if (formattedAsked) {
    message = message.replace(`, until ${formattedAsked}?`, "?");
  }
  if (formattedDue) {
    message = message.replace(`, due ${formattedDue}.`, ".");
    message = message.replace(`I need to know by ${formattedDue}.`, "");
  }
  return message;
}

export function firstPaperworkPatientProblem(record: AdminPaperwork, thisYear?: number): string | null {
  const freeTextProblem = firstAdminPatientProblem(
    [
      ...record.documents.flatMap((doc) => [doc.title, doc.keptAt, doc.note, doc.url]),
      ...record.payslips.map((slip) => slip.note),
      ...Object.values(record.tax).flatMap((sheet) => sheet.expenses.map((exp) => exp.title)),
      ...record.requests.flatMap((req) => [req.title, req.note, req.outcomeNote, req.toEmail, stripRequestDates(req)]),
    ],
    { allowCapitals: true, thisYear },
  );
  if (freeTextProblem) return freeTextProblem.title;

  const recipientProblem = firstAdminPatientProblem(
    [...record.requests.map((req) => req.to), record.sharing.recipient, ...record.sharing.log.map((entry) => entry.to)],
    { allowName: true, allowCapitals: true, thisYear },
  );
  return recipientProblem ? recipientProblem.title : null;
}
