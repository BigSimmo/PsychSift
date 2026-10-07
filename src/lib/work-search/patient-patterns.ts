import { currentWorkYear } from "@/lib/work-time/current-zone";

/**
 * The record-number, bed, date-of-birth, age and name patterns a work search reads as patient
 * details. On their own they are only the raw patterns: the search's gate
 * (`looksLikePatientDetails` in signals.ts) reads them together with the shared
 * patient-detail check in src/lib/work-text/patient-detail-check.ts, which reads them too, so
 * the two can never disagree about what these patterns find. Kept in their own file so the
 * shared check and the search gate can both use them without importing each other.
 */

const PATIENT_PATTERNS: readonly RegExp[] = [
  // A labelled hospital or Medicare number, however it is spaced.
  /\b(?:u\.?r\.?n?|u\/r|umrn|mrn|nhi|medicare|hospital\s+(?:no|number)|h\/?n)\b\.?\s*(?:no\.?\s*)?[:#-]?\s*[a-z]?\d{3,}/i,
  // The same label typed straight onto the number: "UR4471823", "umrn12345".
  /\b(?:ur|urn|umrn|mrn)\d{3,}/i,
  // A WA UMRN: one letter then six to eight digits ("A1234567").
  /\b[a-z]\d{6,8}\b/i,
  /\bbed\s*\d{1,3}[a-z]?\b/i,
  /\b(?:dob|d\.o\.b\.?|d\/o\/b|date of birth|born)\b/i,
  // An age, the way notes write one: "45M", "72 F", "80 yo", "aged 64", "3 year old".
  // The letter is a capital: "45m" and "mtg 30m" are minutes.
  /\b(?:1[2-9]|[2-9]\d|1[01]\d)\s?[MF]\b/,
  /\b\d{1,3}\s?(?:yo|y\.o\.?|y\/o|yrs?\s+old|years?[\s-]+old|year-old)(?![a-z])/i,
  /\bage[ds]?\s+\d{1,3}\b/i,
  // A Medicare-shaped number: starts 2 to 6, ten digits, often typed 4-5-1.
  /\b[2-6]\d{3}\s?\d{5}\s?\d(?:\s?[/-]?\s?\d)?\b/,
  // An Individual Healthcare Identifier: sixteen digits starting 800360.
  /\b8003\s?6\d{3}\s?\d{4}\s?\d{4}\b/,
  // A bare seven-digit hospital number. Phone numbers are eight or ten digits, or start 0, 13 or 18.
  /(?:^|[^\d\s-])\s*\b(?!0|1[38])\d{7}\b(?![\d\s-]*\d)/,
  // "pt" or "patient" with a number, and "pt" with a name.
  /\b(?:patient|pt)\.?\s*(?:no\.?|number|id)?\s*[:#-]?\s*\d{3,}/i,
  // "PT" in capitals is physiotherapy ("OT and PT workshop"), so only "pt" or "Pt" counts here.
  /\b[Pp]t\.?\s+(?!(?:[Tt]ime|[Hh]ours?|[Rr]oster|[Ss]hifts?|[Ll]eave|[Dd]ays?|FTE|[Ff]te|[Cc]ontract|[Pp]osition|[Rr]ole|[Ww]ork)\b)[A-Za-z][A-Za-z'-]{2,}/,
  // A name written the way a patient list writes it: "Smith, John" or "SMITH, John".
  // Not a greeting or an ask after the comma ("URGENT, Please call"), and not a
  // job title before a place ("Consultant, Royal Perth", "Registrar, Ward 4").
  /\b(?!(?:Consultant|Registrar|Resident|Intern|Fellow|Director|Professor|Lecturer|Head|Lead|Manager|Supervisor|Psychiatrist|Physician|Surgeon|Psychologist|Nurse|Coordinator|Clinician)\b)[A-Z][A-Za-z'-]+,\s*(?!(?:Please|Thanks|Thank|Call|Can|Could|See|Note|Hi|Hello|Dear|Ward|Clinic|Unit|Team|Department|Dept|Hospital|Service|Level|Building|Room|Floor)\b)[A-Z][a-z'-]+\b/,
  // A title and a name. Kept last: "Ms Teams" and the like skip it.
  /\b(?:mr|mrs|miss|ms|mx|master|mstr)\.?\s+[a-z][a-z'-]{1,}/i,
];

/** "Ms Teams", "MS Word": software, not a person, so the title rule stands down for them. */
const MS_SOFTWARE = /\bms\s+(?:teams|word|excel|forms|outlook|office|365|access|powerpoint|onenote|edge)\b/i;

const MONTH_WORDS = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";

/** A two-digit year read the way a form would: "81" is 1981, "24" is 2024. */
function fullYear(raw: string, thisYear: number): number {
  const value = Number(raw);
  if (raw.length !== 2) return value;
  return value > thisYear % 100 ? 1900 + value : 2000 + value;
}

/** A date whose year is long enough ago to be a date of birth rather than a roster date. */
function hasBirthDate(text: string, thisYear: number): boolean {
  const years: number[] = [];
  for (const match of text.matchAll(/\b\d{1,2}[/.-]\d{1,2}[/.-](\d{2}|\d{4})\b/g)) {
    years.push(fullYear(match[1]!, thisYear));
  }
  for (const match of text.matchAll(/\b((?:19|20)\d{2})[/.-]\d{1,2}[/.-]\d{1,2}\b/g)) years.push(Number(match[1]));
  // "12 March 1980", "3 Apr 81", "3rd of April, 1981".
  for (const match of text.matchAll(
    new RegExp(
      `\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${MONTH_WORDS})[a-z]*,?\\s+'?((?:19|20)\\d{2}|\\d{2})\\b(?![:.]\\d)`,
      "gi",
    ),
  )) {
    years.push(fullYear(match[1]!, thisYear));
  }
  // "March 12, 1980", "Apr 3 1981".
  for (const match of text.matchAll(
    new RegExp(`\\b(?:${MONTH_WORDS})[a-z]*\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+((?:19|20)\\d{2})\\b`, "gi"),
  )) {
    years.push(Number(match[1]));
  }
  // Roster, renewal and CPD dates sit within a few years of now; birth dates do not.
  return years.some((year) => year <= thisYear - 5);
}

/**
 * True when one of the raw patterns matches. Not a gate on its own: the shared check
 * (`checkPatientDetail`) reads these after folding look-alike and hidden characters, and the work
 * search's gate (`looksLikePatientDetails` in signals.ts) goes through that shared check.
 */
export function matchesPatientPatterns(query: string, thisYear = currentWorkYear()): boolean {
  const text = query.trim();
  if (text.length < 3) return false;
  if (MS_SOFTWARE.test(text)) return PATIENT_PATTERNS.slice(0, -1).some((pattern) => pattern.test(text));
  return PATIENT_PATTERNS.some((pattern) => pattern.test(text)) || hasBirthDate(text, thisYear);
}
