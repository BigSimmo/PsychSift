import { checkReminderText, type ReminderTextProblem } from "@/lib/alerts/remind-me";
import { looksLikePatientDetails } from "@/lib/work-search/signals";

/**
 * The one patient-detail catch for free text typed into a work page (a note, a
 * message, a name for a date, a report to a roster manager). Nothing it reads
 * is sent anywhere; it only decides whether Save or Copy can go ahead.
 *
 * Pasted text often carries characters a reader cannot see (zero-width spaces,
 * joiners, soft hyphens, a byte-order mark) or look-alike forms (full-width
 * "Ｍｒｓ", "１２３"). Each one can hide a name or a number from a pattern check
 * while the doctor still reads it plainly. So the text is folded with NFKC and
 * read twice: once with the invisible characters removed ("Sm​ith" is
 * "Smith") and once with each one as a space ("Mrs​Smith" is "Mrs Smith").
 *
 * Each reading runs:
 * - the Remind me check (`checkReminderText`): initials, dotted initials, an
 *   initial and surname, a title and surname, ages, full dates, phone, bed and
 *   record numbers;
 * - the work search's (`looksLikePatientDetails`): labelled record numbers,
 *   beds, dates of birth, Medicare-shaped numbers, a title and name;
 * - ages and sex in the shapes a clinical note takes ("45 year old male",
 *   "forty five year old", "34 y.o. woman", "aged 45");
 * - "Patient John", "Pt: Smith", "client Jones", and initials after a patient word in any case
 *   ("pt js", "pt J S");
 * - a WA UMRN typed bare, one capital then seven digits ("D4678677");
 * - a bed or room written in words ("bed twelve").
 *
 * It leans towards a false alarm on purpose. A flagged word costs one edit; a
 * missed one puts a patient detail where it should not be. It catches some
 * details, not all, and the pages say so.
 */

export type PatientDetailCheckOptions = {
  /** A referee's or colleague's name is wanted here, so the reminder check's "a name" finding is allowed. */
  readonly allowName?: boolean;
  /**
   * The field names a hospital or service in capitals ("RPH", "FSH"), which the reminder check reads as
   * initials. Bare two- and three-letter capitals are read past; dotted initials ("J.S.") and every other
   * finding still count.
   */
  readonly allowCapitals?: boolean;
  /** The year a date of birth is measured against. Defaults to this year. */
  readonly thisYear?: number;
};

export type PatientDetailProblem = ReminderTextProblem;

const DEFAULT_BODY = "This can't hold patient details. This check catches some details, not all.";

/** Format and invisible characters: zero-width space and joiners, soft hyphen, BOM, direction marks, filler letters. */
const INVISIBLE = /[\p{Cf}ᅟᅠ⠀ㅤﾠ]/gu;

/**
 * Two- and three-letter capitals that are WA workplaces and everyday admin words, not initials, on top of
 * the Remind me check's own list. Read past in every field.
 */
export const WORKPLACE_ABBREVIATIONS: readonly string[] = [
  "RPH",
  "FSH",
  "PCH",
  "JHC",
  "SJG",
  "MET",
  "USB",
  "PDF",
  "WWC",
  "SHO",
  "PGY",
  "CV",
  "FTE",
  "TBA",
  "RSO",
  "DPE",
  "RDO",
  "IVF",
];

const ABBREVIATION = new RegExp(`\\b(?:${WORKPLACE_ABBREVIATIONS.join("|")})\\b`, "g");

const NUMBER_WORD =
  "(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)";

const AGE_SEX: readonly RegExp[] = [
  // "34yo", "34 y.o.", "34 y/o".
  /\b\d{1,3}\s?(?:yo|y\/o|y\.o\.?)(?=[\s,.;:)]|$)/i,
  // "34 year old", "5-year-old", "34 yrs old".
  /\b\d{1,3}\s*[-‐‑]?\s*(?:years?|yrs?|y)\s*[-‐‑]?\s*old\b/i,
  // "forty five year old", "twenty-two years old".
  new RegExp(`\\b${NUMBER_WORD}(?:[\\s-]+${NUMBER_WORD})?[\\s-]*(?:years?|yrs?)[\\s-]*old\\b`, "i"),
  // "aged 45", "age: 45".
  /\b(?:aged?|age:)\s*\d{1,3}\b/i,
  // "34 male", "34 yrs female", "12 boy".
  /\b\d{1,3}\s?(?:(?:years?|yrs?)\s?)?(?:male|female|man|woman|boy|girl)\b/i,
  // "34 yrs F", "34M". Capital M or F only, so "30m webinar" (minutes) passes.
  /\b\d{1,3}\s?yrs?\s?[MFmf]\b/,
  /\b\d{1,3}[MF]\b/,
  // "45 M", "45 F": a spaced sex letter, capital only.
  /\b\d{1,3}\s[MF]\b/,
];

/** A bed, bay or room written in words: "bed twelve", "room four". */
const PLACE_IN_WORDS = new RegExp(`\\b(?:bed|bay|room|rm|cubicle)\\s+${NUMBER_WORD}\\b`, "i");

/** A record number with its label run straight on ("UR1234567", "MRN:12345"), which the word-boundary checks miss. */
const GLUED_RECORD = /\b(?:u\.?r\.?n?|umrn|mrn)\s*[:#-]?\s*\d{3,}/i;

/** A WA UMRN typed bare: one capital letter then seven digits ("D4678677", "U1234567"). */
const BARE_UMRN = /\b[A-Z]\d{7}\b/;

/**
 * Initials straight after a patient word, in any case or spaced: "pt js 45m", "pt J S 45 M", "patient ab".
 * Lower case counts only here; ordinary short words after it ("patient was seen") are left alone.
 */
const PATIENT_INITIALS = /\b(?:patient|pt|client|consumer)\b\s*[:.-]?\s+([a-z]{2,3}|[a-z]\.?\s[a-z])\b\.?/giu;
const SHORT_WORDS = new Set(
  (
    "a an as at be by do go he if in is it me my no of on or so to up us we am are was has had his her its " +
    "for and but not can may who why how all any one two few new old our out off own saw see say get got let " +
    "put ran run sat set too use via yet now day bed ed icu gp ok re per did the"
  ).split(" "),
);

function hasPatientInitials(text: string): boolean {
  for (const match of text.matchAll(PATIENT_INITIALS)) {
    const found = match[1]!.toLowerCase();
    if (/\s/.test(found)) return true;
    if (!SHORT_WORDS.has(found)) return true;
  }
  return false;
}

/** Words after "Patient" that are not a name ("Patient Safety week"). */
const NOT_A_NAME = new Set(["Safety", "Care", "Centred", "Centered", "Experience", "Feedback", "Journey", "Flow"]);
/** "Patient John Smith", "Pt: Smith", "client Jones": a capitalised word straight after the patient. */
const PATIENT_NAME = /\b(?:[Pp]atient|PATIENT|[Pp]t|PT|[Cc]lient|[Cc]onsumer)\b\s*[:.-]?\s+(\p{Lu}[\p{L}'-]+)/gu;

/** The text as it is checked: folded to plain characters, invisible ones removed. */
export function normaliseWorkText(text: string): string {
  return text.normalize("NFKC").replace(INVISIBLE, "");
}

/** True when the words hold an age, or an age and sex, in a clinical note's shape. */
export function looksLikeAgeAndSex(text: string): boolean {
  return AGE_SEX.some((pattern) => pattern.test(text));
}

function hasPatientName(text: string): boolean {
  for (const match of text.matchAll(PATIENT_NAME)) if (!NOT_A_NAME.has(match[1]!)) return true;
  return false;
}

function joinFindings(found: readonly string[]): string {
  return found.length === 1 ? found[0]! : `${found.slice(0, -1).join(", ")} and ${found[found.length - 1]}`;
}

/** The workplace words are written so the initials rule does not read them ("RPH" as "Rph"), then put back. */
function maskAbbreviations(text: string): string {
  return text.replace(ABBREVIATION, (word) => word.charAt(0) + word.slice(1).toLowerCase());
}

function unmaskAbbreviations(text: string): string {
  let out = text;
  for (const word of WORKPLACE_ABBREVIATIONS) {
    const masked = word.charAt(0) + word.slice(1).toLowerCase();
    out = out.replace(new RegExp(`\\b${masked}\\b`, "g"), word);
  }
  return out;
}

function reminderProblem(text: string, options: PatientDetailCheckOptions): PatientDetailProblem | null {
  const masked = maskAbbreviations(text);
  const read = options.allowCapitals ? masked.replace(/\b[A-Z]{2,3}\b(?!\.)/g, (word) => word.toLowerCase()) : masked;
  const problem = checkReminderText(read);
  if (!problem) return null;
  const findings = problem.title
    .replace(/^This looks like /, "")
    .split(/, | and /)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((finding) => !(options.allowName && finding === "a name"));
  if (!findings.length) return null;
  return {
    title: `This looks like ${joinFindings(findings)}`,
    body: DEFAULT_BODY,
    suggestion: problem.suggestion ? unmaskAbbreviations(problem.suggestion) : null,
  };
}

function problemIn(text: string, options: PatientDetailCheckOptions): PatientDetailProblem | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const fromReminder = reminderProblem(trimmed, options);
  if (fromReminder) return fromReminder;
  if (looksLikeAgeAndSex(trimmed)) return { title: "This looks like an age", body: DEFAULT_BODY, suggestion: null };
  if (hasPatientName(trimmed)) return { title: "This looks like a name", body: DEFAULT_BODY, suggestion: null };
  if (hasPatientInitials(trimmed)) return { title: "This looks like initials", body: DEFAULT_BODY, suggestion: null };
  if (BARE_UMRN.test(trimmed))
    return { title: "This looks like a record number", body: DEFAULT_BODY, suggestion: null };
  if (GLUED_RECORD.test(trimmed))
    return { title: "This looks like a record number", body: DEFAULT_BODY, suggestion: null };
  if (PLACE_IN_WORDS.test(trimmed))
    return { title: "This looks like a bed number", body: DEFAULT_BODY, suggestion: null };
  if (looksLikePatientDetails(trimmed, options.thisYear ?? new Date().getFullYear()))
    return {
      title: "This may be patient details",
      body: "It looks like a record number, a date of birth, a title and name, or a bed number. Remove it to go on.",
      suggestion: null,
    };
  return null;
}

/**
 * What looks like a patient detail, in words, with a safer wording when one exists; null when the text reads
 * as safe. Empty text is never flagged.
 */
export function checkPatientDetail(text: string, options: PatientDetailCheckOptions = {}): PatientDetailProblem | null {
  if (!text.trim()) return null;
  const folded = text.normalize("NFKC");
  const joined = folded.replace(INVISIBLE, "");
  const spaced = folded.replace(INVISIBLE, " ");
  return problemIn(joined, options) ?? (spaced === joined ? null : problemIn(spaced, options));
}

/** True when the words read as holding a patient detail. */
export function looksLikePatientDetail(text: string, options: PatientDetailCheckOptions = {}): boolean {
  return checkPatientDetail(text, options) !== null;
}
