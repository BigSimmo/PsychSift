import { identifierShapeWarning } from "@/lib/clinical-ask/context";
import { bareNameOrAddressProblem } from "@/lib/clinical-question-bare-name";
import { checkPatientDetail, normaliseWorkText, type PatientDetailProblem } from "@/lib/work-text/patient-detail-check";

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
 * It also holds back a bare first and last name ("Sarah Jones lithium level") and a street
 * address ("8 Smith St"), which Work's check reads past (owner decision, 25 Oct 2026; see
 * `bareNameOrAddressProblem` for how eponyms, medicines and capitalised clinical terms are kept
 * out of it).
 *
 * Like Work's check it catches some details, not all, and the wording says so.
 */

/** Ages in the shapes a question takes, with a sex word after them when there is one. */
const AGE_PHRASES: readonly RegExp[] = [
  /\b\d{1,3}\s*[-‐‑]?\s*(?:years?|yrs?|y)\s*[-‐‑]?\s*old\b(?:\s+(?:male|female|man|woman|boy|girl)\b)?/gi,
  /\b\d{1,3}\s?-?\s?(?:yo|y\/o|y\.o\.?)(?=[\s,.;:)]|$)(?:\s+(?:male|female|man|woman|boy|girl)\b)?/gi,
  /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)(?:[\s-]+(?:one|two|three|four|five|six|seven|eight|nine))?[\s-]*(?:years?|yrs?)[\s-]*old\b/gi,
  /\b(?:aged?|age:)\s*\d{1,3}\b/gi,
  // Only when no place word (as Work's check knows them, marked or not) labels the number, so "bed 12 male" and
  // "Bed: 12 male" keep their bed number and are refused.
  /(?<!\b(?:bed|bay|room|rm|cubicle|cube|cot|chair|trolley|recliner|ward|unit)\s*[:#.-]?\s*)\b\d{1,3}\s?(?:years?|yrs?)?\s?(?:male|female|man|woman|boy|girl)\b/gi,
];

/**
 * Millisecond readings ("QTc 480 ms", "QRS over 100 msec"), set aside like ages. Lowercase only,
 * whatever follows (owner decision 13 Oct 2026: "QTc 480 ms ECG monitoring" is a clinical question),
 * so the capitalised title in "Ward 4 Ms Smith" is never matched and is still refused.
 */
const UNIT_PHRASES: readonly RegExp[] = [
  // Not after a place word ("bed 4 ms smith", "Ward: 12 ms ..."): there the number is a patient location,
  // and removing it would let a location-plus-name question through the second pass. Every place word is
  // listed lowercase, capitalised and in capitals ("RM 4 ms smith", "CHAIR 3 ms jones" stay refused).
  /(?<!\b(?:[Bb]ed|[Bb]ay|[Rr]oom|[Rr]m|[Cc]ubicle|[Cc]ube|[Cc]ot|[Cc]hair|[Tt]rolley|[Rr]ecliner|[Ww]ard|[Uu]nit|BED|BAY|ROOM|RM|CUBICLE|CUBE|COT|CHAIR|TROLLEY|RECLINER|WARD|UNIT)\s*[:#.-]?\s*)\b\d+(?:\.\d+)?\s*(?:ms|msec|milliseconds?)\b/gu,
];

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

/**
 * Public service numbers ("Lifeline 13 11 14", "MHERL 1300 555 788", "Kids Helpline 1800 55 1800").
 * A 1300 or 1800 number belongs to a service, never to a person, so it is set aside before the
 * phone check (privacy audit PD-02, 2026-10-26). A mobile or landline is still refused. It is
 * replaced by a word rather than removed, so the same digits typed as a labelled record number
 * ("MRN: 1300555788") or inside an email address are still caught by those checks.
 */
const PUBLIC_SERVICE_NUMBER = /(?<![\d+])1[38]00(?:[\s-]?\d){6}(?!\d)/g;

/**
 * A date that a guideline, policy or protocol carries ("protocol updated 01/03/2024", "guideline
 * 15/06/2023", "version 2.1 dated 03/04/2025"), set aside like an age (privacy audit PD-02). It
 * needs a document word: "updated", "reviewed" or "dated" alone can describe a patient's visit, so
 * "patient reviewed 01/02/1990" is still refused. Up to two words may come between, but never a
 * word that makes the date a person's ("born", "DOB", "admitted", "patient"), so "protocol DOB
 * 01/02/1990" and "guideline reviewed patient 01/02/1990" are still refused.
 */
const DOCUMENT_DATE = new RegExp(
  "\\b(?:guidelines?|guidance|protocols?|polic(?:y|ies)|procedures?|code\\s+of\\s+practice|versions?|circular|bulletin)\\b" +
    "((?:\\s+(?!(?:dob|d\\.o\\.b\\.?|born|birth|birthday|admitted|admission|discharged|seen|died|deceased|patients?|pt|client|consumer|person|he|she|they|him|her|them|mrs?|ms|mx|miss)\\b)[\\p{L}\\d.]+){0,2}?)" +
    "\\s+(?:\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{2,4}|\\d{4}-\\d{1,2}-\\d{1,2})\\b",
  "giu",
);

function withoutPublicNumbersAndDocumentDates(text: string): string {
  return text
    .replace(PUBLIC_SERVICE_NUMBER, "servicenumber")
    .replace(DOCUMENT_DATE, (_whole, between: string) => `document${between}`);
}

const OPTIONS = { allowCapitals: true } as const;

/** What in a Clinical question looks like a patient detail; null when it reads as safe to send. */
export function clinicalQuestionPatientDetail(typed: string): PatientDetailProblem | null {
  if (!typed.trim()) return null;
  const text = withoutPublicNumbersAndDocumentDates(typed);
  if (identifierShapeWarning(text)) {
    return {
      title: "This looks like an identifier",
      body: "It looks like a record number, a date of birth, a phone number or an email address.",
      suggestion: null,
    };
  }
  const bareNameOrAddress = bareNameOrAddressProblem(normaliseWorkText(text));
  if (bareNameOrAddress) return bareNameOrAddress;
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

/** The held-back sentence for a search that stays on our own servers (Medication, DSM, Forms and the like). */
export function searchPatientDetailMessage(problem: PatientDetailProblem): string {
  const finding = problem.title.replace(/^This looks like /, "").replace(/^This may be /, "");
  return `This search looks like it holds a patient detail (${finding}). Remove it and search again. This check catches some details, not all.`;
}

/** The search box's warning line: the held-back sentence for a clinical question, else the advisory one. */
export function composerPatientDetailWarning(problem: PatientDetailProblem | null): string {
  return problem
    ? clinicalQuestionPatientDetailMessage(problem)
    : "Remove identifiable patient details before searching.";
}
