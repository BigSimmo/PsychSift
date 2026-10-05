/**
 * Two cautious readings of what was typed, used only to change what the search
 * screen offers. Neither sends, stores or blocks anything.
 *
 * - `looksLikePatientDetails`: a hospital number, bed number, date of birth or
 *   Medicare-length digit run. When true, the query is not kept in Recent and the
 *   screen reminds the reader not to type patient details.
 * - `looksClinical`: a medicine or a clinical word, so the screen can offer the
 *   clinical search (which answers from guidelines) beside the staff-record matches.
 *
 * Both lean towards true: a false alarm costs one extra card, a miss costs nothing
 * the reader did not already have.
 */

const PATIENT_PATTERNS: readonly RegExp[] = [
  /\b(?:u\.?r\.?n?|umrn|mrn|nhi|hospital\s+(?:no|number))\b\.?\s*[:#-]?\s*\d{3,}/i,
  /\bbed\s*\d{1,3}[a-z]?\b/i,
  /\b(?:dob|d\.o\.b\.?|date of birth)\b/i,
  /\b\d{1,2}[/.-]\d{1,2}[/.-](?:19|20)\d{2}\b/,
  /\d{6,}/,
];

export function looksLikePatientDetails(query: string): boolean {
  const text = query.trim();
  if (text.length < 3) return false;
  return PATIENT_PATTERNS.some((pattern) => pattern.test(text));
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
