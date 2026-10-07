import { checkReminderText, type ReminderTextProblem } from "@/lib/alerts/remind-me";
import { looksLikePatientDetails } from "@/lib/work-search/signals";
import { currentWorkYear } from "@/lib/work-time/current-zone";

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

/**
 * Characters that can sit inside a word without changing how it reads: format and invisible characters
 * (zero-width space and joiners, soft hyphen, BOM, direction marks, filler letters), combining marks and
 * variation selectors, and emoji with their skin-tone modifiers.
 */
const INVISIBLE = /[\p{Cf}\p{M}\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u115F\u1160\u2800\u3164\uFFA0]/gu;

/** Cyrillic and Greek letters that look like Latin ones, read as the Latin letter ("\u041Cr" is "Mr"). */
const LOOK_ALIKES: Readonly<Record<string, string>> = {
  "\u0410": "A",
  "\u0412": "B",
  "\u0415": "E",
  "\u041A": "K",
  "\u041C": "M",
  "\u041D": "H",
  "\u041E": "O",
  "\u0420": "P",
  "\u0421": "C",
  "\u0422": "T",
  "\u0425": "X",
  "\u0423": "Y",
  "\u0405": "S",
  "\u0406": "I",
  "\u0408": "J",
  "\u0430": "a",
  "\u0435": "e",
  "\u043E": "o",
  "\u0440": "p",
  "\u0441": "c",
  "\u0443": "y",
  "\u0445": "x",
  "\u0455": "s",
  "\u0456": "i",
  "\u0458": "j",
  "\u04BB": "h",
  "\u0501": "d",
  "\u0391": "A",
  "\u0392": "B",
  "\u0395": "E",
  "\u0396": "Z",
  "\u0397": "H",
  "\u0399": "I",
  "\u039A": "K",
  "\u039C": "M",
  "\u039D": "N",
  "\u039F": "O",
  "\u03A1": "P",
  "\u03A4": "T",
  "\u03A5": "Y",
  "\u03A7": "X",
  "\u03BF": "o",
  "\u03BD": "v",
  "\u03B9": "i",
  "\u03BA": "k",
  "\u03C1": "p",
  "\u03C4": "t",
  "\u03C5": "u",
  "\u03C7": "x",
  "\u03B1": "a",
};
const LOOK_ALIKE = new RegExp(`[${Object.keys(LOOK_ALIKES).join("")}]`, "gu");

/**
 * Two- and three-letter capitals that are WA workplaces and everyday work words, not initials, on top of
 * the Remind me check's own list. Read past in every field. Pairs that are as often a person's initials
 * ("AL", "SL", "AH", "SA") are left out: a field that names leave or a service in capitals reads every bare
 * capital past with allowCapitals instead.
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
  // Training and team roles a junior names in a question ("Can my DCT make me work nights?").
  "DCT",
  "RMO",
  "JMO",
  "HOD",
  "MDT",
  "ICU",
  "AMA",
  "CPD",
  "EPA",
  "CV",
  "FTE",
  "TBA",
  "RSO",
  "DPE",
  "RDO",
  "PDL",
  "IVF",
  "AI",
  "OT",
  "PT",
  "QI",
  "QA",
  "GP",
  "ED",
  "CL",
  "MH",
  "IM",
  "IV",
  "ID",
  "OP",
  "IP",
  "SW",
  "HR",
  "IT",
  "PD",
  "WA",
  "NT",
  "NZ",
  "UK",
  "US",
  "EU",
];

const WORKPLACE_WORDS = new Set(WORKPLACE_ABBREVIATIONS);
const ABBREVIATION = new RegExp(`\\b(?:${WORKPLACE_ABBREVIATIONS.join("|")})\\b`, "g");

const NUMBER_WORD =
  "(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)";

const AGE_SEX: readonly RegExp[] = [
  // "34yo", "34 y.o.", "34 y/o".
  /\b\d{1,3}\s?-?\s?(?:yo|y\/o|y\.o\.?)(?=[\s,.;:)]|$)/i,
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

/**
 * Initials run into an age and sex ("JS45M", "JS 45 M"), or lower-case letters then an age and sex
 * ("js 45m"). Lower-case letters count only when they are not an ordinary short word, so "in 45m" and
 * "mtg 30m" (minutes) pass.
 */
const INITIALS_AGE = /\b\p{Lu}{1,3}[\s-]?\d{1,3}\s?[MF]\b/u;
const LOWER_INITIALS_AGE = /\b([a-z]{2,3})[\s-]?\d{1,3}\s?[mf]\b/g;
const NOT_LOWER_INITIALS = new Set(["mtg", "min", "max", "hr", "hrs", "ish", "abt", "est", "approx", "lec", "tut"]);

function hasLowerInitialsAndAge(text: string): boolean {
  for (const match of text.matchAll(LOWER_INITIALS_AGE)) {
    const letters = match[1]!;
    if (!SHORT_WORDS.has(letters) && !NOT_LOWER_INITIALS.has(letters)) return true;
  }
  return false;
}

/** Words written before ", 45," that are not a first name ("Ward, 4,", "Monday, 12,"). */
const NOT_A_FIRST_NAME = new Set(
  (
    "Ward Unit Level Floor Room Bed Bay Clinic Pod Team Term Week Day Session Part Module Group Year Grade Block " +
    "Wing Page Chapter Step Item Question Total Score Version Lecture Slide Table Figure Section Box Line Station " +
    "Monday Tuesday Wednesday Thursday Friday Saturday Sunday Mon Tue Tues Wed Thu Thur Thurs Fri Sat Sun " +
    "January February March April May June July August September October November December " +
    "Jan Feb Mar Apr Jun Jul Aug Sep Sept Oct Nov Dec"
  ).split(" "),
);
/** A first name with an age set off by commas ("Jane, 45, ward 3", "Saw Jane, 45"). */
const NAME_COMMA_AGE = /\b(\p{Lu}\p{Ll}+),\s*\d{1,3}\s*(?=$|[,;)])/gu;

function hasNameAndAge(text: string): boolean {
  for (const match of text.matchAll(NAME_COMMA_AGE)) if (!NOT_A_FIRST_NAME.has(match[1]!)) return true;
  return false;
}

/** Capitals that open a line before a comma and are not a surname ("URGENT, Please call"). */
const NOT_A_SURNAME = new Set(
  "URGENT NOTE NOTES UPDATE REMINDER IMPORTANT TODAY TOMORROW TONIGHT PLEASE ATTN TODO DONE CANCELLED POSTPONED CHANGE ALERT WARNING ASAP FYI NEW YES COVID ADHD PTSD OSCE AHPRA RANZCP KEMH SCGH FSFHG".split(
    " ",
  ),
);
/** A surname in capitals, a comma, then a first name: how a record writes a patient ("SMITH, John"). */
const RECORD_STYLE_NAME = /\b(\p{Lu}{2,}(?:['-]\p{Lu}+)?),\s*(\p{Lu}\p{Ll}+)\b/gu;

function hasRecordStyleName(text: string): boolean {
  for (const match of text.matchAll(RECORD_STYLE_NAME)) {
    if (NOT_A_SURNAME.has(match[1]!) || WORKPLACE_WORDS.has(match[1]!)) continue;
    if (NOT_A_FIRST_NAME.has(match[2]!) || NOT_A_NAME.has(match[2]!) || match[2] === "Please") continue;
    return true;
  }
  return false;
}

/** A word spelled out one letter at a time, as an emoji or a space between each letter leaves it ("J o h n"). */
const SPELLED_OUT = /(?<![\p{L}\p{N}])\p{L}(?:\s+\p{L}){2,}(?![\p{L}\p{N}])/gu;

function hasSpelledOutWord(text: string): boolean {
  for (const match of text.matchAll(SPELLED_OUT)) if (/\p{Ll}/u.test(match[0])) return true;
  return false;
}

/** Seven or more single digits apart ("1 2 3 4 5 6 7"), how a record number is typed to slip past a check. */
const SPACED_DIGITS = /(?<![\d])\d(?:[\s-]\d(?![\d])){6,}/;

/** A WA landline typed without its area code ("9123 4567", "6457-1234"). */
const LOCAL_LANDLINE = /(?<![\d+])\b[69]\d{3}[\s-]\d{4}\b(?![\s-]?\d)/;

/** A bed, bay or room written in words: "bed twelve", "room four". */
const PLACE_IN_WORDS = new RegExp(
  `\\b(?:bed|bay|room|rm|cubicle|cot|chair|trolley|recliner)\\s+${NUMBER_WORD}\\b`,
  "i",
);

/** A cot, chair, trolley or recliner with its number ("Cot 3", "Chair 4"), which the bed check does not name. */
const NUMBERED_SEAT =
  /\b(?:cot|chair|trolley|recliner)\s*#?\s*\d{1,3}[a-z]?\b(?!\s*(?:sessions?|meetings?|times?|hours?|hrs?|mins?|minutes?|days?|weeks?|%))/i;

/** A record number with its label run straight on ("UR1234567", "MRN:12345"), which the word-boundary checks miss. */
const GLUED_RECORD = /\b(?:u\.?r\.?n?|umrn|mrn)\s*[:#-]?\s*\d{3,}/i;

/** A WA UMRN typed bare: one capital letter then seven digits ("D4678677", "U1234567"). */
const BARE_UMRN = /\b[A-Z][\s-]?\d(?:[\s-]?\d){6}\b/;

/** A labelled record number broken by spaces ("UMRN 123 4567", "MRN 12 345", "record 12 34 567"). */
const SPACED_RECORD =
  /\b(?:u\.?r\.?n?|umrn|mrn|record|rec|file|chart|hospital\s+(?:no|number)|patient\s+(?:no|number|id))\b\.?\s*(?:no\.?|number|#)?\s*[:#-]?\s*\d(?:[\s-]?\d){4,}/i;

/**
 * A title run straight into a name: with a full stop ("Mr.Smith"), a hyphen or slash ("Mr-Smith",
 * "Mr/Smith"), or nothing at all ("MrSmith"). Run straight on, only Mr, Mrs, Ms and Mx count, and only
 * before a capital and two lower-case letters, so "MRIs", "MSc" and "MasterClass" pass.
 */
const TITLE_GLUED =
  /\b(?:[Mm][Rr][Ss]?|[Mm][SsXx]|[Mm]iss|[Mm]aster)\.\p{L}{2,}|\b(?:[Mm][Rr][Ss]?|[Mm][SsXx]|[Mm]iss|[Mm]aster)[-/]\p{Lu}\p{Ll}+|\b(?:[Mm]rs?|[Mm]s|[Mm]x)(?=\p{Lu}\p{Ll}{2,})/u;
const TITLE_INITIAL = /\b(?:[Mm][Rr][Ss]?|[Mm][SsXx]|[Mm]iss|[Mm]aster)\b\.?\s*\p{Lu}\.?(?=$|[\s,.;:)])/u;

/** A bed, bay or room with a colon or other mark before its number ("Bed: 12", "Room #4"). */
const MARKED_PLACE = /\b(?:bed|bay|room|rm|cubicle|cube|cot|chair|trolley|recliner)\s*[:#.-]\s*\d+/i;

/** An Australian mobile or landline in international form ("+61 412 345 678", "0061 8 9224 1234"). */
const INTERNATIONAL_PHONE = /(?:\+|\b00)\s?61[\s-]?(?:\(0\)[\s-]?)?\d(?:[\s-]?\d){8}\b/;

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
    if (!SHORT_WORDS.has(found) && !WORKPLACE_WORDS.has(found.toUpperCase())) return true;
  }
  return false;
}

/** Words after "Patient" that are not a name ("Patient Safety week"). */
const NOT_A_NAME = new Set([
  "Safety",
  "Care",
  "Centred",
  "Centered",
  "Experience",
  "Feedback",
  "Journey",
  "Flow",
  "Dr",
  "Doctor",
  "Prof",
  "The",
  "This",
  "That",
  "Then",
  "He",
  "She",
  "They",
  "We",
  "Thanks",
  "Ward",
  "Unit",
]);
/** "Patient John Smith", "Pt: Smith", "the patient, John": a capitalised word straight after the patient. */
const PATIENT_NAME = /\b(?:[Pp]atient|PATIENT|[Pp]t|PT|[Cc]lient|[Cc]onsumer)\b\s*[:.,-]?\s+(\p{Lu}[\p{L}'-]+)/gu;

/** The text as the check reads it: folded, look-alike letters as Latin, invisible characters removed. Never saved. */
export function normaliseWorkText(text: string): string {
  return readings(text).joined;
}

/**
 * The two readings the check takes. Folded first (NFKC, then decomposed so accents come apart from their
 * letters), look-alike letters read as Latin, then the invisible characters either removed or read as a space.
 * For checking only: never store or show these in place of what was typed.
 */
function readings(text: string): { joined: string; spaced: string } {
  const folded = text
    .normalize("NFKC")
    .normalize("NFKD")
    .replace(LOOK_ALIKE, (letter) => LOOK_ALIKES[letter] ?? letter);
  return { joined: folded.replace(INVISIBLE, ""), spaced: folded.replace(INVISIBLE, " ") };
}

/** True when the words hold an age, or an age and sex, in a clinical note's shape. */
export function looksLikeAgeAndSex(text: string): boolean {
  return AGE_SEX.some((pattern) => pattern.test(text));
}

function hasPatientName(text: string): boolean {
  for (const match of text.matchAll(PATIENT_NAME))
    if (!NOT_A_NAME.has(match[1]!) && !WORKPLACE_WORDS.has(match[1]!)) return true;
  return false;
}

function joinFindings(found: readonly string[]): string {
  return found.length === 1 ? found[0]! : `${found.slice(0, -1).join(", ")} and ${found[found.length - 1]}`;
}

/**
 * The workplace words are swapped for a lower-case stand-in the initials rule cannot read ("RPH" as
 * "qzxaxzq"), then put back in the safer wording. A stand-in, not "Rph", so a word typed as "It" or "Ed"
 * is never turned into "IT" or "ED".
 */
function standIn(index: number): string {
  let letters = "";
  let rest = index;
  do {
    letters = String.fromCharCode(97 + (rest % 26)) + letters;
    rest = Math.floor(rest / 26) - 1;
  } while (rest >= 0);
  return `qzx${letters}xzq`;
}

/**
 * A teaching or meeting venue with its number ("Seminar room 1", "Board room 1", "Lecture theatre 2"). A room
 * named for teaching or a meeting is not where a patient lies, so it is read past. A bare "Room 4" or "Bed 12"
 * is still a bed number.
 */
const VENUE = new RegExp(
  `\\b(?:(?:seminar|meeting|conference|tutorial|training|teaching|board)\\s*rooms?|lecture\\s+(?:theatre|theater|hall|room)s?)\\s*[:#.-]?\\s*(?:\\d{1,3}[a-z]?|${NUMBER_WORD})\\b`,
  "gi",
);

/** The text with each teaching or meeting venue read as a plain word, for the bed and room checks. */
function withoutVenues(text: string): string {
  return text.replace(VENUE, "venue");
}

function maskAbbreviations(text: string, masked: string[]): string {
  const keep = (word: string): string => {
    masked.push(word);
    return standIn(masked.length - 1);
  };
  return text.replace(VENUE, keep).replace(ABBREVIATION, keep);
}

function unmaskAbbreviations(text: string, masked: readonly string[]): string {
  return text.replace(/qzx([a-z]+)xzq/gi, (whole, letters: string) => {
    let index = 0;
    for (const letter of letters.toLowerCase()) index = index * 26 + (letter.charCodeAt(0) - 96);
    return masked[index - 1] ?? whole;
  });
}

/** Capitals read past with allowCapitals go back as typed in the safer wording ("kgh" is "KGH" again). */
function restoreCapitals(text: string, words: readonly string[]): string {
  let out = text;
  for (const word of new Set(words)) out = out.replace(new RegExp(`\\b${word.toLowerCase()}\\b`, "g"), word);
  return out;
}

function reminderProblem(text: string, options: PatientDetailCheckOptions): PatientDetailProblem | null {
  const abbreviations: string[] = [];
  const masked = maskAbbreviations(text, abbreviations);
  const lowered: string[] = [];
  const read = options.allowCapitals
    ? masked.replace(/\b[A-Z]{2,3}\b(?!\.)/g, (word) => {
        lowered.push(word);
        return word.toLowerCase();
      })
    : masked;
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
    suggestion: problem.suggestion
      ? restoreCapitals(unmaskAbbreviations(problem.suggestion, abbreviations), lowered)
      : null,
  };
}

function problemIn(text: string, options: PatientDetailCheckOptions): PatientDetailProblem | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const fromReminder = reminderProblem(trimmed, options);
  if (fromReminder) return fromReminder;
  if (looksLikeAgeAndSex(trimmed)) return { title: "This looks like an age", body: DEFAULT_BODY, suggestion: null };
  if (INITIALS_AGE.test(trimmed) || hasLowerInitialsAndAge(trimmed) || hasNameAndAge(trimmed))
    return { title: "This looks like an age", body: DEFAULT_BODY, suggestion: null };
  if (hasPatientName(trimmed)) return { title: "This looks like a name", body: DEFAULT_BODY, suggestion: null };
  if (hasPatientInitials(trimmed)) return { title: "This looks like initials", body: DEFAULT_BODY, suggestion: null };
  if (TITLE_GLUED.test(trimmed) || TITLE_INITIAL.test(trimmed) || hasSpelledOutWord(trimmed))
    return { title: "This looks like a name", body: DEFAULT_BODY, suggestion: null };
  if (!options.allowCapitals && hasRecordStyleName(trimmed))
    return { title: "This looks like a name", body: DEFAULT_BODY, suggestion: null };
  if (INTERNATIONAL_PHONE.test(trimmed) || LOCAL_LANDLINE.test(trimmed))
    return { title: "This looks like a phone number", body: DEFAULT_BODY, suggestion: null };
  const places = withoutVenues(trimmed);
  if (MARKED_PLACE.test(places) || NUMBERED_SEAT.test(places))
    return { title: "This looks like a bed number", body: DEFAULT_BODY, suggestion: null };
  if (BARE_UMRN.test(trimmed) || SPACED_RECORD.test(trimmed) || SPACED_DIGITS.test(trimmed))
    return { title: "This looks like a record number", body: DEFAULT_BODY, suggestion: null };
  if (GLUED_RECORD.test(trimmed))
    return { title: "This looks like a record number", body: DEFAULT_BODY, suggestion: null };
  if (PLACE_IN_WORDS.test(places))
    return { title: "This looks like a bed number", body: DEFAULT_BODY, suggestion: null };
  if (looksLikePatientDetails(places, options.thisYear ?? currentWorkYear()))
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
  const { joined, spaced } = readings(text);
  const problem = problemIn(joined, options) ?? (spaced === joined ? null : problemIn(spaced, options));
  // The check reads a folded copy only. The text the doctor typed is never changed, so a safer wording built
  // from the folded copy ("\u00BD" read as "1\u20442") is offered only when folding changed nothing.
  if (problem && problem.suggestion && joined !== text) return { ...problem, suggestion: null };
  return problem;
}

/** True when the words read as holding a patient detail. */
export function looksLikePatientDetail(text: string, options: PatientDetailCheckOptions = {}): boolean {
  return checkPatientDetail(text, options) !== null;
}
