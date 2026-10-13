import { identifierShapeWarning } from "@/lib/clinical-ask/context";
import { checkPatientDetail, type PatientDetailProblem } from "@/lib/work-text/patient-detail-check";

/**
 * The patient-detail check for a Clinical question, run before the question is sent to the
 * answer service (an overseas AI service writes the answer). The browser runs it before
 * sending, and the answer API runs it again on what arrives, so a question that slips past
 * the page is still refused.
 *
 * It is Work's own check (`checkPatientDetail`), read the way a clinical question needs:
 *
 * - **Capitals are read past** (`allowCapitals`). A clinical question is full of two- and
 *   three-letter capitals that are not initials: ECT, NMS, TCA, ANC, FBC, CKD, QT. Read as
 *   initials, 11 of 71 ordinary test questions were refused.
 * - **An age on its own is clinical content**, not an identifier: "lithium dose for a 70 year
 *   old" asks about older adults. The age phrase is set aside and the rest of the question is
 *   checked again, so an age beside a name, a record number or a bed is still refused.
 *
 * - **Clinical shorthand is not a title or a patient marker.** A millisecond reading ("QTc 480 ms")
 *   is not the title Ms, "MS on interferon" is multiple sclerosis, and "pt with renal impairment"
 *   is "patient with". These are rewritten before the second reading, like ages; "Ms Jones" and
 *   "pt John" are untouched and still refused.
 *
 * On top of that it keeps the narrower shapes the composer already warned about (email,
 * Medicare-shaped and labelled record numbers, a labelled date of birth, a phone number).
 *
 * Like Work's check it catches some details, not all, and the wording says so.
 */

/** Ages in the shapes a question takes, with a sex word after them when there is one. */
const AGE_PHRASES: readonly RegExp[] = [
  /\b\d{1,3}\s*[-‐‑]?\s*(?:years?|yrs?|y)\s*[-‐‑]?\s*old\b(?:\s+(?:male|female|man|woman|boy|girl)\b)?/gi,
  /\b\d{1,3}\s?-?\s?(?:yo|y\/o|y\.o\.?)(?=[\s,.;:)]|$)(?:\s+(?:male|female|man|woman|boy|girl)\b)?/gi,
  /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)(?:[\s-]+(?:one|two|three|four|five|six|seven|eight|nine))?[\s-]*(?:years?|yrs?)[\s-]*old\b/gi,
  /\b(?:aged?|age:)\s*\d{1,3}\b/gi,
  /\b\d{1,3}\s?(?:years?|yrs?)?\s?(?:male|female|man|woman|boy|girl)\b/gi,
];

/** Millisecond readings ("QTc 480 ms", "QRS over 100 msec"), set aside like ages. */
const UNIT_PHRASES: readonly RegExp[] = [/\b\d+(?:\.\d+)?\s*(?:ms|msec|milliseconds?)\b/gi];

/** Words that follow "pt" or the diagnosis "MS" in a question, and never start a name. */
const FUNCTION_WORD = "(?:with|on|in|who|taking|having|has|had|and|or|of|for|after|receiving|presenting|is|was)";
const PT_BEFORE_FUNCTION_WORD = new RegExp(`\\b[Pp]t\\.?(?=\\s+${FUNCTION_WORD}\\b)`, "g");
const MS_DIAGNOSIS = new RegExp(`\\bMS\\b(?=\\s+${FUNCTION_WORD}\\b)`, "g");

function withoutClinicalShorthand(text: string): string {
  return [...AGE_PHRASES, ...UNIT_PHRASES]
    .reduce((current, pattern) => current.replace(pattern, " "), text)
    .replace(PT_BEFORE_FUNCTION_WORD, "patient")
    .replace(MS_DIAGNOSIS, "multiple sclerosis");
}

const OPTIONS = { allowCapitals: true } as const;

/** What in a Clinical question looks like a patient detail; null when it reads as safe to send. */
export function clinicalQuestionPatientDetail(text: string): PatientDetailProblem | null {
  if (!text.trim()) return null;
  if (identifierShapeWarning(text)) {
    return {
      title: "This looks like an identifier",
      body: "It looks like a record number, a date of birth, a phone number or an email address.",
      suggestion: null,
    };
  }
  if (!checkPatientDetail(text, OPTIONS)) return null;
  return checkPatientDetail(withoutClinicalShorthand(text), OPTIONS);
}

/**
 * The one sentence shown when a question is held back, on the page and from the API. It names
 * the kind of detail only, never the text that matched.
 */
export function clinicalQuestionPatientDetailMessage(problem: PatientDetailProblem): string {
  const finding = problem.title.replace(/^This looks like /, "").replace(/^This may be /, "");
  return `This question looks like it holds a patient detail (${finding}). Remove it and ask again: questions are sent to an overseas AI service. This check catches some details, not all.`;
}

/** The search box's warning line: the held-back sentence for a clinical question, else the advisory one. */
export function composerPatientDetailWarning(problem: PatientDetailProblem | null): string {
  return problem
    ? clinicalQuestionPatientDetailMessage(problem)
    : "Remove identifiable patient details before searching.";
}
