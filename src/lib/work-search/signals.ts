import { looksLikePatientDetail } from "@/lib/work-text/patient-detail-check";
import { matchesPatientPatterns } from "@/lib/work-search/patient-patterns";
import { currentWorkYear } from "@/lib/work-time/current-zone";

/**
 * Two cautious readings of what was typed, used only to change what the search
 * screen does on the device. Neither sends or stores anything.
 *
 * - `looksLikePatientDetails`: the search's patient gate. It reads the
 *   search's own patterns (`matchesPatientPatterns`: a labelled hospital number,
 *   a bare seven-digit number, a WA UMRN, a bed number, a date of birth, an age,
 *   a Medicare-shaped number, an IHI, "pt" with a number or name, "SURNAME,
 *   Given", a title and name) and hands the text to the one shared check every
 *   work page uses (`looksLikePatientDetail`), so look-alike letters, hidden
 *   characters, "Patient John", "pt js", "bed twelve" and the rest are caught here
 *   exactly as they are on a note or a reminder. Three things a search looks up
 *   are read past: a phone number (On Call contacts), a date within a few years
 *   (a roster date; birth dates still count) and bare capitals ("AL", "BLS").
 *   When true, the query is not looked up at all, not kept in Recent, cleared
 *   from the box if left there, and the screen reminds the reader not to type
 *   patient details.
 * - `looksClinical`: a medicine or a clinical word, so the screen offers the
 *   clinical search (which answers from guidelines) above any staff-record
 *   matches, and gives no built-in work answer.
 *
 * Both lean towards true: a false alarm costs one extra card, a miss costs nothing
 * the reader did not already have.
 */

/** Phone shapes a search looks up: mobile, landline, 13 and 1800 numbers, and a WA landline without its area code. */
const SEARCH_PHONE =
  /(?:\+|\b00)\s?61[\s-]?(?:\(0\)[\s-]?)?\d(?:[\s-]?\d){8}\b|(?:\(0\d\)\s?|\b0\d)(?:[\s-]?\d){8}\b|\b1[38]00(?:[\s-]?\d){6}\b|\b13(?:[\s-]?\d){4}\b|(?<![\d+])\b[69]\d{3}[\s-]?\d{4}\b/g;
/** A pager or extension with its label ("pager 44101", "ext 61234"), which an On Call search looks up. */
const SEARCH_EXTENSION = /\b(?:pager|page|ext|extn|extension)\.?\s*[:#-]?\s*\d{3,6}\b/gi;
/** A full date in figures or words: "12/10/2026", "12 Oct 2026". Its year decides whether it is read past. */
const SEARCH_DATE =
  /\b\d{1,2}[/.-]\d{1,2}[/.-](\d{4}|\d{2})\b|\b\d{1,2}\s(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s(\d{4})\b/gi;

/**
 * The text with what a search looks up blanked out, for the shared check only: phone, pager and extension numbers, and dates
 * within four years either way (a birth date is older, and `matchesPatientPatterns` still reads it).
 */
function withoutLookups(text: string, thisYear: number): string {
  return text
    .replace(SEARCH_EXTENSION, " ")
    .replace(SEARCH_PHONE, " ")
    .replace(SEARCH_DATE, (date, figures?: string, words?: string) => {
      const raw = figures ?? words ?? "";
      const year = raw.length === 2 ? 2000 + Number(raw) : Number(raw);
      return Math.abs(year - thisYear) <= 4 ? " " : date;
    });
}

/**
 * The search's patient gate: its own patterns, then the shared patient-detail check (with bare capitals,
 * phone numbers and roster dates read past). Everything that keeps or skips typed text calls this one.
 */
export function looksLikePatientDetails(query: string, thisYear = currentWorkYear()): boolean {
  const text = query.trim();
  if (!text) return false;
  if (matchesPatientPatterns(text, thisYear)) return true;
  const rest = withoutLookups(text, thisYear);
  return rest.trim().length > 0 && looksLikePatientDetail(rest, { allowCapitals: true, thisYear });
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
