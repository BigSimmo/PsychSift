export type ClinicalVocabularyType =
  "medication" | "lab" | "service" | "form" | "risk" | "workflow" | "document_title" | "clinical_term" | "typo";

export type ClinicalVocabularyEntry = {
  canonical: string;
  aliases: string[];
  /**
   * One-way expansion terms (audit 26 Oct 2026, finding #5): features or members of the
   * canonical (e.g. "fever" for serotonin syndrome). A query naming the canonical or an alias
   * expands to these, but a query that only names one of these does NOT match the entry, so
   * "clozapine fever" no longer drags in serotonin syndrome.
   */
  relatedTerms?: string[];
  type: ClinicalVocabularyType;
  weight?: number;
};

const entries: ClinicalVocabularyEntry[] = [
  {
    canonical: "long acting injectable",
    aliases: ["lai", "depot", "depot injection", "long-acting injectable", "long acting injection"],
    type: "medication",
    weight: 1.25,
  },
  {
    canonical: "absolute neutrophil count",
    aliases: ["anc", "neutrophil count", "neutrophils"],
    type: "lab",
    weight: 1.25,
  },
  {
    canonical: "full blood count",
    // CI-14: FBC (AU/UK) and CBC (US) are the same test. Documents in this corpus use
    // "FBC"; without the CBC alternates a clinician who searches "CBC" retrieves nothing.
    // "cbc" is kept in the first 6 aliases so it survives the expansion slice bidirectionally.
    aliases: ["fbc", "cbc", "complete blood count", "blood count", "white cell count", "wcc", "wbc"],
    type: "lab",
    weight: 1.2,
  },
  { canonical: "liver function tests", aliases: ["lft", "lfts"], type: "lab", weight: 1.05 },
  { canonical: "electrocardiogram", aliases: ["ecg", "ekg"], type: "lab", weight: 1.05 },
  { canonical: "corrected qt interval", aliases: ["qtc", "qt interval"], type: "lab", weight: 1.1 },
  {
    canonical: "national outcomes and casemix collection",
    aliases: ["nocc", "outcome measures"],
    type: "clinical_term",
    weight: 1.1,
  },
  { canonical: "health of the nation outcome scales", aliases: ["honos"], type: "clinical_term", weight: 1.05 },
  {
    canonical: "health of the nation outcome scales for children and adolescents",
    aliases: ["honosca"],
    type: "clinical_term",
    weight: 1.05,
  },
  { canonical: "community treatment team", aliases: ["ctt"], type: "service", weight: 1.05 },
  { canonical: "mental health assessment team", aliases: ["mhat"], type: "service", weight: 1.05 },
  { canonical: "adult community mental health service", aliases: ["acmhs"], type: "service", weight: 1.05 },
  { canonical: "armadale kelmscott group", aliases: ["akg"], type: "service", weight: 1.05 },
  { canonical: "mental health service procedure", aliases: ["mhsp"], type: "document_title", weight: 1 },
  { canonical: "electroconvulsive therapy", aliases: ["ect"], type: "workflow", weight: 1.05 },
  { canonical: "emergency department", aliases: ["ed"], type: "service", weight: 1.05 },
  { canonical: "intramuscular", aliases: ["im"], type: "workflow", weight: 1.05 },
  { canonical: "oral", aliases: ["po"], type: "workflow", weight: 1.05 },
  // CI-14: complete the administration-route family alongside IM/PO so route-abbreviation
  // queries ("subcut", "SC", "sublingual", "SL") retrieve the same chart rows.
  { canonical: "subcutaneous", aliases: ["sc", "subcut", "subcutaneously"], type: "workflow", weight: 1.05 },
  { canonical: "sublingual", aliases: ["sl", "sublingually"], type: "workflow", weight: 1.05 },
  { canonical: "as required", aliases: ["prn"], type: "workflow", weight: 1.05 },
  {
    canonical: "clozapine",
    aliases: ["clozaril", "clozapin", "clozapinw", "clozapene"],
    type: "medication",
    weight: 1.3,
  },
  { canonical: "lithium", aliases: ["lithum", "lithium carbonate", "lithium level"], type: "medication", weight: 1.25 },
  { canonical: "olanzapine", aliases: ["zyprexa"], type: "medication", weight: 1.05 },
  { canonical: "lorazepam", aliases: ["ativan"], type: "medication", weight: 1.05 },
  { canonical: "haloperidol", aliases: ["haldol"], type: "medication", weight: 1.05 },
  { canonical: "promethazine", aliases: ["phenergan"], type: "medication", weight: 1.05 },
  { canonical: "diazepam", aliases: ["valium"], type: "medication", weight: 1.05 },
  { canonical: "risperidone", aliases: ["risperdal"], type: "medication", weight: 1.05 },
  { canonical: "quetiapine", aliases: ["seroquel"], type: "medication", weight: 1.05 },
  {
    canonical: "clozapine monitoring",
    aliases: ["clozapine monitering", "clozapin monitoring"],
    type: "workflow",
    weight: 1.2,
  },
  { canonical: "discharge planning", aliases: ["dischage planning", "discharge documentation"], type: "workflow" },
  { canonical: "admission", aliases: ["admisson"], type: "workflow" },
  { canonical: "prescribing", aliases: ["prescribng"], type: "workflow" },
  { canonical: "monitoring", aliases: ["monitring", "monitor"], type: "workflow" },
  { canonical: "agitation", aliases: ["agitaton", "agitationn"], type: "risk" },
  { canonical: "arousal", aliases: ["arousl", "arrousal"], type: "risk" },
  { canonical: "neutropenia", aliases: ["neutropena"], type: "risk" },
  { canonical: "myocarditis", aliases: ["myocardits"], type: "risk" },
  { canonical: "metabolic monitoring", aliases: ["metbolic monitoring", "metabolic screening"], type: "workflow" },
  { canonical: "patient safety plan", aliases: ["safety plan", "pt safety plan"], type: "form", weight: 1.1 },
  // Systematic Medical Term Expansion (RAG-E1)
  {
    canonical: "extrapyramidal side effects",
    aliases: ["epse", "eps"],
    relatedTerms: ["dystonia", "akathisia", "parkinsonism", "tardive dyskinesia"],
    type: "risk",
    weight: 1.1,
  },
  {
    canonical: "neuroleptic malignant syndrome",
    aliases: ["nms"],
    relatedTerms: ["hyperthermia", "muscle rigidity", "autonomic instability"],
    type: "risk",
    weight: 1.2,
  },
  {
    canonical: "serotonin syndrome",
    aliases: ["serotonin toxicity"],
    relatedTerms: ["shivering", "diarrhoea", "diarrhea", "muscle rigidity", "fever", "seizures"],
    type: "risk",
    weight: 1.2,
  },
  {
    canonical: "anticholinergic side effects",
    aliases: ["anticholinergic toxicity"],
    relatedTerms: ["dry mouth", "blurred vision", "constipation", "urinary retention", "tachycardia"],
    type: "risk",
    weight: 1.1,
  },
  {
    canonical: "metabolic syndrome",
    aliases: [],
    relatedTerms: [
      "weight gain",
      "dyslipidaemia",
      "hyperglycaemia",
      "dyslipidemia",
      "hyperglycemia",
      "hypertension",
      "waist circumference",
    ],
    type: "risk",
    weight: 1.1,
  },
  {
    canonical: "renal function",
    aliases: ["egfr", "creatinine", "kidney function", "urea", "electrolytes", "u&e"],
    type: "lab",
    weight: 1.1,
  },
  { canonical: "thyroid function", aliases: ["tft", "tsh", "free t4", "t3"], type: "lab", weight: 1.1 },
  {
    canonical: "prolactin level",
    aliases: ["hyperprolactinaemia", "hyperprolactinemia", "prolactin"],
    type: "lab",
    weight: 1.1,
  },
  { canonical: "body mass index", aliases: ["bmi"], relatedTerms: ["weight", "height"], type: "lab", weight: 1.05 },
  {
    canonical: "blood pressure",
    aliases: ["bp"],
    relatedTerms: ["hypertension", "hypotension", "orthostatic hypotension"],
    type: "lab",
    weight: 1.1,
  },
  // Psychiatry vocabulary seed (OpenMRS/CIEL-informed synonym sets, AU spellings).
  // Ordering rule: only the first 6 aliases survive expandClinicalVocabularyText
  // (CI-14), so anything a clinician would actually type must sit within them.
  // Screening and outcome instruments.
  { canonical: "patient health questionnaire", aliases: ["phq 9", "phq9", "phq"], type: "clinical_term", weight: 1.1 },
  {
    canonical: "generalised anxiety disorder scale",
    aliases: ["gad 7", "gad7", "generalized anxiety disorder scale"],
    type: "clinical_term",
    weight: 1.1,
  },
  {
    canonical: "kessler psychological distress scale",
    aliases: ["k10", "k 10", "kessler 10"],
    type: "clinical_term",
    weight: 1.1,
  },
  { canonical: "edinburgh postnatal depression scale", aliases: ["epds"], type: "clinical_term", weight: 1.1 },
  { canonical: "mini mental state examination", aliases: ["mmse", "mini mental"], type: "clinical_term", weight: 1.1 },
  { canonical: "montreal cognitive assessment", aliases: ["moca"], type: "clinical_term", weight: 1.1 },
  {
    canonical: "mental state examination",
    aliases: ["mse", "mental state exam", "mental status examination"],
    type: "clinical_term",
    weight: 1.15,
  },
  // Psychotropic medication classes.
  {
    canonical: "antipsychotic",
    aliases: ["antipsychotics", "neuroleptic", "neuroleptics"],
    type: "medication",
    weight: 1.1,
  },
  { canonical: "antidepressant", aliases: ["antidepressants"], type: "medication", weight: 1.05 },
  {
    canonical: "selective serotonin reuptake inhibitor",
    aliases: ["ssri", "ssris"],
    type: "medication",
    weight: 1.15,
  },
  {
    canonical: "serotonin noradrenaline reuptake inhibitor",
    aliases: ["snri", "snris", "serotonin norepinephrine reuptake inhibitor"],
    type: "medication",
    weight: 1.1,
  },
  { canonical: "monoamine oxidase inhibitor", aliases: ["maoi", "maois"], type: "medication", weight: 1.15 },
  { canonical: "benzodiazepine", aliases: ["benzodiazepines", "benzo", "bzd"], type: "medication", weight: 1.1 },
  {
    canonical: "mood stabiliser",
    aliases: ["mood stabilizer", "mood stabilisers", "mood stabilizers"],
    type: "medication",
    weight: 1.1,
  },
  // Common psychotropics missing from the brand-name seed above.
  { canonical: "sodium valproate", aliases: ["valproate", "epilim", "valproic acid"], type: "medication", weight: 1.1 },
  { canonical: "carbamazepine", aliases: ["tegretol"], type: "medication", weight: 1.05 },
  { canonical: "aripiprazole", aliases: ["abilify"], type: "medication", weight: 1.05 },
  { canonical: "paliperidone", aliases: ["invega"], type: "medication", weight: 1.05 },
  { canonical: "mirtazapine", aliases: ["avanza", "remeron"], type: "medication", weight: 1.05 },
  { canonical: "sertraline", aliases: ["zoloft"], type: "medication", weight: 1.05 },
  // Mental health legislation and containment workflows (AU).
  { canonical: "community treatment order", aliases: ["cto"], type: "workflow", weight: 1.15 },
  { canonical: "mental health act", aliases: ["mha"], type: "document_title", weight: 1.1 },
  {
    canonical: "involuntary patient",
    aliases: ["involuntary admission", "involuntary treatment", "detained patient"],
    type: "workflow",
    weight: 1.1,
  },
  {
    canonical: "seclusion and restraint",
    aliases: ["seclusion", "restraint", "restrictive practice", "restrictive practices"],
    type: "risk",
    weight: 1.2,
  },
  {
    canonical: "rapid tranquillisation",
    aliases: ["rapid tranquilisation", "rapid tranquilization", "acute sedation", "parenteral sedation"],
    type: "workflow",
    weight: 1.2,
  },
  {
    canonical: "acute behavioural disturbance",
    aliases: ["code black", "behavioural emergency", "behavioral emergency"],
    type: "risk",
    weight: 1.2,
  },
  // Risk terminology.
  {
    canonical: "suicidal ideation",
    aliases: ["suicide risk", "suicidality", "suicidal thoughts"],
    type: "risk",
    weight: 1.25,
  },
  {
    canonical: "deliberate self harm",
    aliases: ["self harm", "dsh", "self injury", "non suicidal self injury", "nssi"],
    type: "risk",
    weight: 1.2,
  },
  // Psychological therapies.
  {
    canonical: "cognitive behavioural therapy",
    aliases: ["cbt", "cognitive behavior therapy", "cognitive behaviour therapy"],
    type: "clinical_term",
    weight: 1.05,
  },
  {
    canonical: "dialectical behaviour therapy",
    aliases: ["dbt", "dialectical behavior therapy"],
    type: "clinical_term",
    weight: 1.05,
  },
  // Monitoring.
  {
    canonical: "therapeutic drug monitoring",
    aliases: ["tdm", "drug level", "serum level", "trough level"],
    type: "lab",
    weight: 1.15,
  },
];

function normalize(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function termPattern(value: string) {
  return new RegExp(`(?:^|\\s)${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}(?:\\s|$)`);
}

export function clinicalVocabularyEntries() {
  return entries;
}

export function clinicalVocabularyMatches(text: string, limit = 24) {
  const normalizedText = normalize(text);
  const matches: ClinicalVocabularyEntry[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const terms = [entry.canonical, ...entry.aliases].map(normalize).filter(Boolean);
    if (!terms.some((term) => termPattern(term).test(normalizedText))) continue;
    const key = `${entry.type}:${entry.canonical}`;
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push(entry);
    if (matches.length >= limit) break;
  }
  return matches;
}

export function expandClinicalVocabularyText(text: string, limit = 48) {
  const additions = new Set<string>();
  for (const entry of clinicalVocabularyMatches(text, limit)) {
    additions.add(entry.canonical);
    for (const alias of entry.aliases.slice(0, 6)) additions.add(alias);
    // Related terms get their own budget so AU/US spelling pairs never push out a feature.
    for (const term of (entry.relatedTerms ?? []).slice(0, 8)) additions.add(term);
  }
  return Array.from(additions).slice(0, limit);
}

export function clinicalVocabularySearchText(text: string, limit = 48) {
  const additions = expandClinicalVocabularyText(text, limit);
  return additions.length ? `${text} ${additions.join(" ")}` : text;
}

export function clinicalVocabularyTerms(text: string, limit = 32) {
  return Array.from(
    new Set(
      clinicalVocabularyMatches(text, limit).flatMap((entry) => [
        entry.canonical,
        entry.type,
        ...entry.aliases.slice(0, 4),
      ]),
    ),
  ).slice(0, limit);
}
