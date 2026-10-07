/**
 * Two cautious readings of what was typed, used only to change what the search
 * screen does on the device. Neither sends or stores anything.
 *
 * - `looksLikePatientDetails`: a labelled hospital number (UR, URN, UMRN, MRN,
 *   however it is spaced or glued on), a bare seven-digit number, a letter and
 *   six to eight digits (a WA UMRN), a bed number, a date of birth (labelled, or
 *   a date years in the past, in figures or words), an age ("45M", "72 yo",
 *   "aged 80"), a Medicare-shaped number, an IHI, "pt" or "patient" with a
 *   number or name, a "SURNAME, Given" name, or a title and name. Phone and
 *   pager numbers are deliberately not flagged: the search finds On Call
 *   numbers. When true, the query is not looked up at all, not kept in Recent,
 *   cleared from the box if left there, and the screen reminds the reader not
 *   to type patient details.
 * - `looksClinical`: a medicine or a clinical word, so the screen offers the
 *   clinical search (which answers from guidelines) above any staff-record
 *   matches, and gives no built-in work answer.
 *
 * Both lean towards true: a false alarm costs one extra card, a miss costs nothing
 * the reader did not already have.
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
  // Not a greeting or an ask after the comma ("URGENT, Please call").
  /\b[A-Z][A-Za-z'-]+,\s*(?!(?:Please|Thanks|Thank|Call|Can|Could|See|Note|Hi|Hello|Dear)\b)[A-Z][a-z'-]+\b/,
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

export function looksLikePatientDetails(query: string, thisYear = new Date().getFullYear()): boolean {
  const text = query.trim();
  if (text.length < 3) return false;
  if (MS_SOFTWARE.test(text)) return PATIENT_PATTERNS.slice(0, -1).some((pattern) => pattern.test(text));
  return PATIENT_PATTERNS.some((pattern) => pattern.test(text)) || hasBirthDate(text, thisYear);
}

const CLINICAL_WORDS = [
  // Medicines most often asked about in psychiatry.
  "agomelatine",
  "amisulpride",
  "amitriptyline",
  "aripiprazole",
  "asenapine",
  "atomoxetine",
  "benzodiazepines?",
  "brexpiprazole",
  "bupropion",
  "buprenorphine",
  "carbamazepine",
  "cariprazine",
  "chlorpromazine",
  "citalopram",
  "clomipramine",
  "clonazepam",
  "clonidine",
  "clozapine",
  "desvenlafaxine",
  "dexamfetamine",
  "diazepam",
  "duloxetine",
  "escitalopram",
  "esketamine",
  "fluoxetine",
  "fluvoxamine",
  "guanfacine",
  "haloperidol",
  "ketamine",
  "lamotrigine",
  "lisdexamfetamine",
  "lithium",
  "lorazepam",
  "lurasidone",
  "melatonin",
  "methadone",
  "methylphenidate",
  "mirtazapine",
  "moclobemide",
  "naltrexone",
  "olanzapine",
  "paliperidone",
  "paroxetine",
  "quetiapine",
  "risperidone",
  "sertraline",
  "sodium valproate",
  "temazepam",
  "valproate",
  "venlafaxine",
  "vortioxetine",
  "zuclopenthixol",
  "antidepressants?",
  "antipsychotics?",
  "ssris?",
  "snris?",
  "lai",
  "depot",
  // Clinical question words.
  "dos(?:e|es|ing)",
  "titrat(?:e|ion)",
  "side[- ]effects?",
  "adverse effects?",
  "interactions?",
  "contraindicat(?:ed|ions?)",
  "overdose",
  "toxicity",
  "withdrawal",
  "serotonin syndrome",
  "nms",
  "qtc?",
  "ecg",
  "eeg",
  "ect",
  "fbc",
  "anc",
  "neutropenia",
  "myocarditis",
  "metabolic monitoring",
  "pregnancy",
  "breastfeeding",
  "diagnos(?:is|e|tic)",
  "differentials?",
  "symptoms?",
  "treatment",
  "psychosis",
  "schizophrenia",
  "bipolar",
  "depression",
  "delirium",
  "dementia",
  "adhd",
  "ptsd",
  "ocd",
  "anorexia",
  "suicid(?:e|al|ality)",
  "self[- ]harm",
  "agitation",
  "sedation",
  "catatonia",
] as const;

const CLINICAL_PATTERN = new RegExp(`\\b(?:${CLINICAL_WORDS.join("|")})\\b`, "i");

export function looksClinical(query: string): boolean {
  const text = query.trim();
  if (text.length < 3) return false;
  return CLINICAL_PATTERN.test(text);
}

/** Where "Ask clinical search" goes: the clinical answer search with the question filled in, not sent. */
export function clinicalSearchHref(query: string): string {
  const params = new URLSearchParams({ mode: "answer", q: query.trim(), focus: "1" });
  return `/?${params.toString()}`;
}

/**
 * Patient details that also ask a clinical question ("clozapine UR 4471823"): the
 * screen offers clinical search as well as Clear, but empty. The typed text never
 * goes into the link, so it never reaches the address, history or a provider.
 */
export function patientClinicalHandOff(query: string): string | null {
  const trimmed = query.trim();
  if (!looksLikePatientDetails(trimmed) || !looksClinical(trimmed)) return null;
  return "/?mode=answer&focus=1";
}

/**
 * What the search screen may do with what was typed. Patient details are never
 * looked up or answered. A clinical question is still looked up in the reader's
 * own records (an "ECT list" can be on their roster) but gets no work answer.
 */
export function workSearchGate(query: string): {
  readonly patient: boolean;
  readonly clinical: boolean;
  readonly search: boolean;
  readonly answer: boolean;
} {
  const trimmed = query.trim();
  const patient = trimmed.length > 0 && looksLikePatientDetails(trimmed);
  const clinical = trimmed.length > 0 && !patient && looksClinical(trimmed);
  return {
    patient,
    clinical,
    search: trimmed.length > 0 && !patient,
    answer: trimmed.length > 0 && !patient && !clinical,
  };
}
