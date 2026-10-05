/**
 * Two cautious readings of what was typed, used only to change what the search
 * screen does on the device. Neither sends or stores anything.
 *
 * - `looksLikePatientDetails`: a labelled hospital number, bare seven-digit
 *   number, bed number, date of birth, Medicare-shaped number or a title and
 *   name. Phone and pager numbers are deliberately not flagged: the search finds
 *   On Call numbers. When true, the query is not looked up at all, not kept in
 *   Recent, and the screen reminds the reader not to type patient details.
 * - `looksClinical`: a medicine or a clinical word, so the screen offers the
 *   clinical search (which answers from guidelines) above any staff-record
 *   matches, and gives no built-in work answer.
 *
 * Both lean towards true: a false alarm costs one extra card, a miss costs nothing
 * the reader did not already have.
 */

const PATIENT_PATTERNS: readonly RegExp[] = [
  // A labelled hospital or Medicare number, however it is spaced.
  /\b(?:u\.?r\.?n?|umrn|mrn|nhi|medicare|hospital\s+(?:no|number))\b\.?\s*[:#-]?\s*[a-z]?\d{3,}/i,
  /\b(?:urn|umrn|mrn)\d{3,}/i,
  /\bbed\s*\d{1,3}[a-z]?\b/i,
  /\b(?:dob|d\.o\.b\.?|date of birth|born)\b/i,
  // A Medicare-shaped number: starts 2 to 6, ten digits, often typed 4-5-1.
  /\b[2-6]\d{3}\s?\d{5}\s?\d(?:\s?[/-]?\s?\d)?\b/,
  // A bare seven-digit hospital number. Phone numbers are eight or ten digits, or start 0, 13 or 18.
  /(?:^|[^\d\s-])\s*\b(?!0|1[38])\d{7}\b(?![\d\s-]*\d)/,
  // A title and a name.
  /\b(?:mr|mrs|miss|mx|master)\.?\s+[a-z][a-z'-]{1,}/i,
];

/** A date whose year is long enough ago to be a date of birth rather than a roster date. */
function hasBirthDate(text: string, thisYear: number): boolean {
  const years: number[] = [];
  for (const match of text.matchAll(/\b\d{1,2}[/.-]\d{1,2}[/.-](\d{2}|\d{4})\b/g)) {
    const raw = Number(match[1]);
    years.push(match[1]!.length === 2 ? (raw > thisYear % 100 ? 1900 + raw : 2000 + raw) : raw);
  }
  for (const match of text.matchAll(/\b((?:19|20)\d{2})[/.-]\d{1,2}[/.-]\d{1,2}\b/g)) years.push(Number(match[1]));
  for (const match of text.matchAll(
    /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+((?:19|20)\d{2})\b/gi,
  )) {
    years.push(Number(match[1]));
  }
  // Roster, renewal and CPD dates sit within a few years of now; birth dates do not.
  return years.some((year) => year <= thisYear - 5);
}

export function looksLikePatientDetails(query: string, thisYear = new Date().getFullYear()): boolean {
  const text = query.trim();
  if (text.length < 3) return false;
  if (/\bms\s+teams\b/i.test(text)) return PATIENT_PATTERNS.slice(0, -1).some((pattern) => pattern.test(text));
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
