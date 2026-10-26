import { isClinicalImageEvidence } from "@/lib/image-filtering";
import { clinicalResultEvidenceHaystack } from "@/lib/clinical-evidence-haystack";
import { expandClinicalVocabularyText } from "@/lib/clinical-vocabulary";
import {
  hasForeignMedicationClinicalValueBinding,
  medicationAliasesForEntity,
  medicationSafetyEntitiesInText,
} from "@/lib/medication-entities";
import { freshnessDecayPenalty, rankingConfig } from "@/lib/ranking-config";
import { clearlyOutsideCorpusMedicalPattern, normalizeGuardQuery } from "@/lib/rag/rag-query-guard";
import type {
  ClinicalQueryAnalysis,
  ClinicalQueryIntent,
  RagQueryClass,
  SearchResult,
  SearchScoreExplanation,
} from "@/lib/types";

type SearchIntent = ClinicalQueryIntent;

type IntentSignals = {
  intent: SearchIntent;
  imageEvidenceFocus: boolean;
  sectionedLookup: boolean;
  hasDosingSignals: boolean;
};

export type RagQueryClassification = {
  queryClass: RagQueryClass;
  reasons: string[];
  needsVisualEvidence: boolean;
  needsSynthesis: boolean;
};

// Shared signals for coloured-zone "next step" retrieval guards (ranking source
// evidence here; text fast-path and coverage gates in rag.ts). The zone context
// deliberately requires an explicit coloured-zone reference or "zone criteria" —
// a bare "zone" (clean zone, time zone, zone 3) plus a common word like "review"
// must not qualify as escalation evidence. The action group likewise requires a
// real clinical instruction: bare "review\w*" would let document boilerplate
// ("Review date: ...", "reviewed by ...") satisfy the guard, so "review" only
// counts when attached to a clinical role or urgency (senior clinician review,
// urgent medical officer review) or an escalation/MET phrase.
export const zoneColourAlternatives = "red|amber|yellow|orange|purple|green|blue";
export const riskZoneContextPattern = new RegExp(
  `\\b(?:(?:${zoneColourAlternatives})[\\s-]*zones?|colou?red zones?|zone criteria)\\b`,
  "i",
);
export const riskZoneActionPattern =
  /\b(?:escalat\w+|urgent\w*|respond\w*|actions?\s+required|call(?:ing)?\s+(?:a\s+)?met\b|met\s+call|(?:senior|immediate|medical|clinical|clinician|nursing|officer)\s+(?:clinician\s+|specialist\s+|nurse\s+|officer\s+)?review\w*)\b/i;

// The zone colour a query names, if any ("red-zone risk" -> "red").
/** Queried zone colour. */
export function queriedZoneColour(query: string) {
  return query.match(new RegExp(`\\b(${zoneColourAlternatives})[\\s-]*zones?\\b`, "i"))?.[1]?.toLowerCase() ?? null;
}

// Zone-context patterns scoped to the colour the query names (falling back to
// any colour). `zonePhrasePattern` matches explicit zone phrases; `bareColourPattern`
// is for risk-matrix / flowchart visual units, which store the cell colour as a
// bare token ("... | Red | escalate ..."). Shared by the fast-path guard and
// coverage gate in rag.ts and the ranking source check here so a red-zone
// question is never satisfied (or boosted) by another colour's action evidence.
/** Zone context patterns for query. */
export function zoneContextPatternsForQuery(query: string) {
  const colour = queriedZoneColour(query);
  const colourGroup = colour ?? `(?:${zoneColourAlternatives})`;
  return {
    zonePhrasePattern: new RegExp(`\\b${colourGroup}[\\s-]*zones?\\b|\\bcolou?red zones?\\b|\\bzone criteria\\b`, "i"),
    bareColourPattern: new RegExp(`\\b${colourGroup}\\b`, "i"),
  };
}

export const intentSignalWords = {
  dosing: [
    "dose",
    "dosage",
    "dosing",
    "titrate",
    "titration",
    "mg",
    "mcg",
    "frequency",
    "route",
    "oral",
    "intramuscular",
    "im",
    "po",
    "prn",
    "administer",
    "administration",
    "tablet",
    "start",
    "increase",
    "cease",
  ],
  protocol: ["protocol", "procedure", "process", "workflow", "pathway", "step", "algorithm", "document", "guideline"],
  escalation: ["escalat", "red flag", "urgent", "risk", "senior", "specialist", "review", "crisis", "rapid"],
  visuals: ["table", "chart", "figure", "graph", "diagram", "flow", "matrix", "image"],
  definitions: ["what is", "define", "definition", "describe", "meaning", "term", "short summary"],
  lookup: ["document", "lookup", "find", "where", "chapter", "section", "title", "page"],
} as const;

const textSearchStopWords = new Set([
  "what",
  "when",
  "where",
  "which",
  "how",
  "please",
  "can",
  "you",
  "me",
  "compare",
  "compared",
  "comparison",
  "about",
  "find",
  "search",
  "look",
  "lookup",
  "now",
  "today",
  "exactly",
  "the",
  "and",
  "with",
  "from",
  "into",
  "for",
  "that",
  "this",
  "are",
  "was",
  "were",
  "been",
  "being",
  "cover",
  "covers",
  "covered",
  "managed",
  "management",
  "process",
  "procedure",
  "should",
  "does",
  "include",
  "includes",
  "identified",
  "identify",
  "identifies",
  "required",
  "require",
  "requires",
  "requirement",
  "requirements",
  "need",
  "needed",
  "guidance",
  "apply",
  "applies",
  "while",
  "taking",
  "guideline",
  "document",
  "documents",
  "information",
  "patient",
  "patients",
  "pts",
  "clinical",
  "psychiatric",
  "mental",
  "health",
]);

const synonymGroups = [
  [
    "monitor",
    "monitoring",
    "monitoring plan",
    "monitoring schedule",
    "baseline",
    "review",
    "follow-up",
    "blood test",
    "level",
  ],
  ["contraindication", "avoid", "do not use", "caution", "exclusion"],
  ["escalation", "urgent", "senior review", "specialist review", "red flag"],
  ["adverse effect", "side effect", "toxicity", "safety-net", "warning"],
  [
    "dose",
    "dosage",
    "dosing",
    "dose limit",
    "maximum dose",
    "frequency",
    "route",
    "oral",
    "intramuscular",
    "IM",
    "PRN",
  ],
  ["threshold", "cutoff", "cut off", "level", "range", "criteria", "withhold", "cease", "stop"],
  ["documentation", "document", "record", "form", "checklist", "required", "requirement"],
];

/**
 * The facet words above (dose, route, monitoring, threshold...) describe what is being asked
 * about, not the subject. Catalogue search uses this to keep them out of its expansion lane,
 * where they matched unrelated records ("sertraline dose" listing "Ziprasidone IM").
 */
export const clinicalFacetSynonymTerms: ReadonlySet<string> = new Set(
  synonymGroups.flat().map((term) => term.toLowerCase()),
);

const deterministicRewriteRules: Array<{ from: string[]; to: string[] }> = [
  { from: ["dose", "dosage", "dosing"], to: ["dose", "dosage", "dosing"] },
  { from: ["monitor", "monitoring"], to: ["monitor", "monitoring", "monitoring plan"] },
  { from: ["monitoring"], to: ["monitor", "monitoring", "monitor plan"] },
  { from: ["lab", "laboratory"], to: ["laboratory test", "lab result", "blood test"] },
  { from: ["threshold", "cutoff", "cut off"], to: ["threshold", "cutoff", "criteria", "level"] },
  { from: ["risk", "urgent"], to: ["risk", "red flag", "escalation", "urgent"] },
];

const typoCorrections = new Map<string, string>([
  ["clozapin", "clozapine"],
  ["clozapinw", "clozapine"],
  ["clozapene", "clozapine"],
  ["agitaton", "agitation"],
  ["agitationn", "agitation"],
  ["arousl", "arousal"],
  ["arrousal", "arousal"],
  ["neutrophyl", "neutrophil"],
  ["neutropena", "neutropenia"],
  ["myocardits", "myocarditis"],
  ["metbolic", "metabolic"],
  ["dischage", "discharge"],
  ["admisson", "admission"],
  ["prescribng", "prescribing"],
  ["monitring", "monitoring"],
]);

const domainAliasGroups = [
  [
    "fbc",
    "full blood count",
    "blood count",
    "blood monitoring",
    "blood test monitoring",
    "bloods",
    "white cell",
    "wbc",
  ],
  ["anc", "absolute neutrophil count", "neutrophil", "neutrophils"],
  ["nocc", "national outcomes and casemix collection", "outcome measures"],
  ["pt", "patient", "patients", "pts"],
  ["ed", "emergency department"],
  ["ect", "electroconvulsive therapy"],
  ["lai", "long acting injectable", "depot", "long-acting injectable"],
  ["im", "intramuscular"],
  ["po", "oral"],
  ["sc", "subcutaneous", "subcut", "subcutaneously"],
  ["sl", "sublingual", "sublingually"],
  ["prn", "as required"],
  ["mhsp", "mental health service procedure"],
  ["fda", "food and drug administration"],
];

const medicationAliasGroups = [
  ["clozapine", "clozaril"],
  ["lithium", "lithium carbonate", "lithium level"],
  ["olanzapine", "zyprexa"],
  ["lorazepam", "ativan"],
  ["haloperidol", "haldol"],
  ["droperidol"],
  ["promethazine", "phenergan"],
  ["diazepam", "valium"],
  ["risperidone", "risperdal"],
  ["quetiapine", "seroquel"],
  ["midazolam"],
  ["clonazepam"],
  ["chlorpromazine"],
];

const documentTitleAliasGroups = [
  ["nocc", "national outcomes and casemix collection"],
  ["patient safety plan", "safety plan", "pt safety plan"],
  ["patient property", "restricted items", "patient belongings"],
  ["active community patient ed", "active community pt ed", "community patients in ed"],
  ["admission community pts", "community admission", "admission of community patients"],
  ["agitation arousal pharmacological management", "agitation and arousal", "agitation dosing"],
  ["clozapine prescribing administration monitoring", "clozapine monitoring", "clozapine"],
  ["neuroleptic side effects", "neuroleptic side effect", "neuroleptic effects"],
  ["long acting injectable", "long-acting injectable", "lai"],
  ["metabolic screening", "metabolic monitoring"],
  ["treatment team process", "mental health treatment team"],
  ["assessment documentation", "assessment document"],
  [
    "mental health discharge",
    "admission to discharge mental health",
    "admission to discharge for mental health inpatients",
    "admission to discharge for community mental health",
    "referral admission discharge mental health hospital in the home",
    "mental health hospital in the home",
    "discharge planning",
    "discharge documentation",
    "mental health medically cleared for discharge",
    "mental health inpatient triage to discharge",
    "acmhs oacmhs triage discharge",
  ],
  ["duress", "duress procedure"],
  ["illegal substances", "illegal substance"],
];

const thresholdSignalPattern =
  /\b(?:threshold|cut[\s-]?off|cutoff|level|range|score|scale|criteria|criterion|withhold|cease|stop|maximum|minimum|baseline|anc|fbc|neutrophil|white cell)\b/i;
const freshnessSignalPattern =
  /\b(?:current|latest|newest|recent|review date|reviewed|published|publication|version|outdated|expired|superseded)\b/i;

const intentPatterns: Array<{
  intent: SearchIntent;
  pattern: RegExp;
  imageEvidenceFocus: boolean;
  sectionedLookup: boolean;
}> = [
  {
    intent: "definition",
    pattern: /what\s+is|define|definition|meaning|term|describe|terminology/i,
    imageEvidenceFocus: false,
    sectionedLookup: false,
  },
  {
    intent: "protocol",
    pattern: /protocol|procedure|process|pathway|workflow|algorithm|guideline/i,
    imageEvidenceFocus: false,
    sectionedLookup: true,
  },
  {
    intent: "drug_dosing",
    pattern:
      /dose|dosage|dosing|titrate|mg|mcg|frequency|route|oral|intramuscular|subcutaneous|subcut|sublingual|\bim\b|\bpo\b|\bsc\b|\bsl\b|\bprn\b|administer|table|chart/i,
    imageEvidenceFocus: true,
    sectionedLookup: false,
  },
  {
    intent: "escalation_risk",
    pattern: /escalat|urgent|red\s*flag|risk|senior|rapid|immediate|crisis/i,
    imageEvidenceFocus: false,
    sectionedLookup: true,
  },
  {
    intent: "document_lookup",
    pattern: /search|lookup|find|where|section|page|document title|document id/i,
    imageEvidenceFocus: false,
    sectionedLookup: true,
  },
];

const comparisonPattern =
  /\b(compare|compared|versus|vs|between|difference\w*|conflict\w*)\b|\bcombine\b.{0,100}\bwith\b/i;
const tableThresholdPattern =
  /\b(table|chart|matrix|threshold|cut[\s-]?off|cutoff|level|range|score|scale|criteria|criterion|anc|fbc|neutrophil|white cell|when to withhold|withhold|cease|stop|maximum|minimum|baseline)\b|\b(?:therapeutic|target|trough)\s+(?:level|range|concentration)\b/i;
// Note (8a): bare generic risk/workflow words (`risk`, `urgent`, `escalat*`) were removed from this
// pattern. On their own — with no medication/dose/pharmacology signal — they mis-classified topical
// queries like "suicide risk mitigation" or "urgent clinical escalation" as medication-dosing
// queries, whose retrieval plan then buried the actual guideline under dose/threshold evidence. A
// genuine medication_dose_risk query still matches via a drug name, dose/route term, or the
// medication/pharmacology/agitation vocabulary retained below.
const medicationDoseRiskPattern =
  /\b(medication|medicine|pharmacolog\w*|prescrib\w*|dose|dosage|dosing|mg|mcg|titrate|route|oral|intramuscular|subcutaneous|subcut|sublingual|administer\w*|\bim\b|\bpo\b|\bsc\b|\bsl\b|\bprn\b|clozapine|lithium|neuroleptic|antipsychotic|benzodiazepine|injectables?|agitation|arousal|side effect\w*|adverse|toxicity|contraindicat\w*)\b/i;
const documentIncludePattern =
  /\b(?:what should|what must|what does|what do|which items?|requirements?|checklist|forms?)\b.{0,80}\b(?:include|contain|cover|require|required|needed|need)\b|\b(?:include|contain|cover|require|required|needed|need)\b.{0,80}\b(?:plan|form|checklist|protocol|procedure|guideline|document|file|pdf)\b/i;
const explicitDocumentLookupPattern =
  /\b(?:find|search|lookup|open|show|where)\b.{0,80}\b(?:document|file|pdf|protocol|guideline|procedure|page|section|form|table)\b|\bwhich\s+document\b/i;
const broadSummaryPattern =
  /\b(summary|summarise|summarize|overview|explain|outline|tell me about|what should be considered)\b|\b(?:management|manage|managed|treatment|treat|therapy|care|approach|pathway)\s+(?:of|for|in)\b|\bhow\s+(?:is|are|should)\b.{0,80}\b(?:managed|treated)\b/i;
const explicitDocumentTitleNoisePattern =
  /\b(?:newly uploaded|future|not uploaded|2027|airport|travel policy|gardening|equipment|checklist)\b/i;
// One source of truth with the retrieval short circuit. These two copies had already
// diverged — this one carried `ketamine sedation`, the other did not — so a query could be
// classified `unsupported_or_general` here and still reach retrieval there. Both now share
// `clearlyOutsideCorpusMedicalPattern`, which is matched here against the normalized query
// (hyphens folded to spaces) and there against the raw one; the pattern tolerates both.
const shortClinicalSearchTerms = new Set(["ed", "im", "po", "pt"]);
const simpleRequirementsQuestionPattern = /^\s*(?:what|which)\s+(?:are|is)\s+.+\brequirements?\s*\??\s*$/i;

/** Tokens. */
function tokens(text: string) {
  return text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/\W+/)
    .filter((token) => token.length > 2 || shortClinicalSearchTerms.has(token));
}

/** Normalize analysis text. */
// One definition, shared with the guard that consumes its output. This used to be a private
// copy here while `rag-query-guard.ts` matched the raw query, so the constant the two modules
// share was applied to two different strings. Moved rather than duplicated; the body is
// unchanged, so every other caller in this file behaves exactly as before. See
// `normalizeGuardQuery`'s own note for why this mattered (PR #2546).
const normalizeAnalysisText = normalizeGuardQuery;

/** Corrected tokens. */
export function correctedTokens(query: string) {
  return tokens(query).map((token) => typoCorrections.get(token) ?? token);
}

/** Unique. */
function unique(values: string[], limit = 30) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = value.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
    if (output.length >= limit) break;
  }
  return output;
}

/** Term matches query. */
function termMatchesQuery(normalizedQuery: string, term: string) {
  const normalizedTerm = normalizeAnalysisText(term);
  if (!normalizedTerm) return false;
  const escaped = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(?:^|\\s)${escaped}(?:$|\\s)`).test(normalizedQuery);
}

/** Aliases for query. */
function aliasesForQuery(normalizedQuery: string, groups: string[][]) {
  const matches: string[] = [];
  for (const group of groups) {
    if (group.some((term) => termMatchesQuery(normalizedQuery, term))) {
      matches.push(...group);
    }
  }
  return unique(matches, 40);
}

/** Medication terms. */
function medicationTerms(normalizedQuery: string) {
  return aliasesForQuery(normalizedQuery, medicationAliasGroups).filter((term) =>
    medicationAliasGroups.some((group) => group[0] === term),
  );
}

/** Acronym terms. */
function acronymTerms(query: string, normalizedQuery: string) {
  const direct = (query.match(/\b[A-Z]{2,6}\b/g) ?? []).map((term) => term.toLowerCase());
  const aliases = aliasesForQuery(normalizedQuery, domainAliasGroups).filter((term) => /^[a-z]{2,6}$/.test(term));
  return unique([...direct, ...aliases], 12);
}

/** Threshold terms for. */
function thresholdTermsFor(normalizedQuery: string) {
  if (!thresholdSignalPattern.test(normalizedQuery)) return [];
  return unique(
    correctedTokens(normalizedQuery).filter((token) =>
      /^(threshold|cutoff|level|range|score|scale|criteria|criterion|withhold|cease|stop|maximum|minimum|baseline|anc|fbc|neutrophil)$/.test(
        token,
      ),
    ),
    12,
  );
}

/** Build stable query rewrite. */
function buildStableQueryRewrite(args: {
  originalQuery: string;
  normalizedQuery: string;
  correctedQuery: string;
  aliasTerms: string[];
  titleTerms: string[];
  medications: string[];
  acronyms: string[];
  thresholdTerms: string[];
  vocabularyTerms: string[];
}) {
  const expansions = new Set<string>();
  const reasons = new Set<string>();
  const lookup = `${args.normalizedQuery} ${args.correctedQuery}`;

  for (const rule of deterministicRewriteRules) {
    if (rule.from.some((term) => termMatchesQuery(lookup, term))) {
      rule.to.forEach((term) => expansions.add(term));
      reasons.add("deterministic_synonym_rule");
    }
  }

  for (const group of synonymGroups) {
    if (group.some((term) => termMatchesQuery(lookup, term))) {
      group.forEach((term) => expansions.add(term));
      reasons.add("clinical_synonym_group");
    }
  }

  [
    ...args.aliasTerms,
    ...args.titleTerms,
    ...args.medications,
    ...args.acronyms,
    ...args.thresholdTerms,
    ...args.vocabularyTerms.slice(0, 14),
  ].forEach((term) => expansions.add(term));

  if (args.aliasTerms.length) reasons.add("domain_alias_terms");
  if (args.titleTerms.length) reasons.add("document_title_alias_terms");
  if (args.medications.length) reasons.add("medication_alias_terms");
  if (args.thresholdTerms.length) reasons.add("threshold_terms");
  if (args.vocabularyTerms.length) reasons.add("clinical_vocabulary_terms");

  const normalizedExpansions = unique(Array.from(expansions), 48);
  const searchQuery = unique([buildClinicalTextSearchQuery(args.originalQuery), ...normalizedExpansions], 54).join(" ");
  return {
    normalizedQuery: args.normalizedQuery,
    searchQuery,
    expansions: normalizedExpansions,
    reasons: Array.from(reasons),
  };
}

/** Document title terms for. */
function documentTitleTermsFor(normalizedQuery: string) {
  return aliasesForQuery(normalizedQuery, documentTitleAliasGroups);
}

/** Query class from signals. */
function queryClassFromSignals(args: {
  normalizedQuery: string;
  medications: string[];
  thresholdTerms: string[];
  documentTitleTerms: string[];
  comparisonIntent: boolean;
  explicitDocumentLookupIntent: boolean;
}): RagQueryClass {
  if (args.comparisonIntent) return "comparison";
  if (
    (args.documentTitleTerms.length > 0 || args.explicitDocumentLookupIntent) &&
    explicitDocumentTitleNoisePattern.test(args.normalizedQuery)
  )
    return "document_lookup";
  if (clearlyOutsideCorpusMedicalPattern.test(args.normalizedQuery) && args.documentTitleTerms.length === 0)
    return "unsupported_or_general";
  if (
    /\bflow\s*chart|flowchart\b/i.test(args.normalizedQuery) &&
    /\b(?:next step|step after|after)\b/i.test(args.normalizedQuery)
  )
    return "document_lookup";
  if (
    /\b(?:dose|dosage|dosing|route|mg|mcg|microgram|\bim\b|\bpo\b|\bsc\b|\bsl\b|\bprn\b)\b/i.test(
      args.normalizedQuery,
    ) &&
    (args.medications.length > 0 || medicationDoseRiskPattern.test(args.normalizedQuery))
  ) {
    return "medication_dose_risk";
  }
  if (args.thresholdTerms.length > 0 || tableThresholdPattern.test(args.normalizedQuery)) return "table_threshold";
  if (args.medications.length > 0 || medicationDoseRiskPattern.test(args.normalizedQuery))
    return "medication_dose_risk";
  if (
    args.documentTitleTerms.length > 0 &&
    (!broadSummaryPattern.test(args.normalizedQuery) ||
      /\b(?:active community patients?|community patients in ed|patient safety plan|nocc)\b/i.test(
        args.normalizedQuery,
      ))
  ) {
    return "document_lookup";
  }
  if (broadSummaryPattern.test(args.normalizedQuery) && !args.explicitDocumentLookupIntent) return "broad_summary";
  if (
    args.explicitDocumentLookupIntent ||
    /\b(?:document title|document id|documentation|file|pdf|page|section|guideline|procedure|protocol|forms?)\b/i.test(
      args.normalizedQuery,
    ) ||
    (documentIncludePattern.test(args.normalizedQuery) && !simpleRequirementsQuestionPattern.test(args.normalizedQuery))
  )
    return "document_lookup";
  return "unsupported_or_general";
}

/** Intent from signals. */
function intentFromSignals(queryClass: RagQueryClass, normalizedQuery: string): ClinicalQueryIntent {
  if (queryClass === "comparison") return "comparison";
  if (queryClass === "broad_summary") return "broad_summary";
  if (queryClass === "document_lookup") return "document_lookup";
  if (queryClass === "table_threshold" || queryClass === "medication_dose_risk") {
    if (
      /(dose|dosage|dosing|mg|mcg|route|oral|intramuscular|subcutaneous|subcut|sublingual|\bim\b|\bpo\b|\bsc\b|\bsl\b|\bprn\b|administer)/i.test(
        normalizedQuery,
      )
    ) {
      return "drug_dosing";
    }
    if (/(risk|urgent|red flag|escalat|contraindicat|avoid|toxicity|withhold|cease|stop)/i.test(normalizedQuery)) {
      return "escalation_risk";
    }
  }
  if (/(protocol|procedure|process|pathway|workflow|algorithm|guideline)/i.test(normalizedQuery)) return "protocol";
  if (/(what is|define|definition|meaning|term|describe)/i.test(normalizedQuery)) return "definition";
  return "general";
}

/** Analysis confidence. */
function analysisConfidence(args: {
  queryClass: RagQueryClass;
  reasons: string[];
  canonicalTerms: string[];
  documentTitleTerms: string[];
  typoCorrectionCount: number;
}) {
  let score = 0.36;
  if (args.queryClass !== "unsupported_or_general") score += 0.2;
  score += Math.min(0.22, args.reasons.length * 0.045);
  score += Math.min(0.16, args.canonicalTerms.length * 0.018);
  score += Math.min(0.12, args.documentTitleTerms.length * 0.025);
  score += Math.min(0.08, args.typoCorrectionCount * 0.03);
  return clamp(score);
}

/** Parse date as years ago. */
function parseDateAsYearsAgo(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const now = new Date();
  return Math.max(0, (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24 * 365));
}

/** Clamp. */
function clamp(value: number) {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

// Audit M2: intent signal words match at word boundaries, not as bare
// substrings — "time limit" used to trigger the "im" dosing signal and
// "notable" the "table" visual signal, corrupting ranking boosts. Short
// acronym-like tokens (im, po, mg, prn, mcg) must match as whole words, with
// a digit-adjacent allowance so unit-attached doses ("100mg") still count;
// longer entries keep deliberate prefix semantics ("escalat" → escalation,
// "table" → tables).
/** Contains any. */
function containsAny(value: string, values: readonly string[]) {
  return values.some((item) => {
    const escaped = item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = item.length <= 3 ? `(?:\\b|\\d)${escaped}\\b` : `\\b${escaped}`;
    return new RegExp(pattern, "i").test(value);
  });
}

/** Normalize query token for lookups. */
function normalizeQueryTokenForLookups(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\w]+/g, " ")
    .replace(/\b(\d+)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalized clinical query tokens. */
function normalizedClinicalQueryTokens(query: string) {
  return normalizedClinicalSearchTokens(query)
    .map((token) => token.toLowerCase())
    .filter((token) => token.length > 2);
}

/** Has image evidence need. */
function hasImageEvidenceNeed(query: string) {
  return /table|chart|diagram|flowchart|figure|image|visual|source image|dose card|medication chart/i.test(query);
}

/** Extraction quality score. */
function extractionQualityScore(result: SearchResult) {
  const quality = result.source_metadata?.extraction_quality;
  if (quality === "partial") return -0.005;
  if (quality === "poor") return -0.025;
  return 0;
}

/** Index quality rank signal. */
function indexQualityRankSignal(result: SearchResult) {
  const quality = result.indexing_quality;
  if (!quality) return 0;
  const score = Number(quality.quality_score);
  if (!Number.isFinite(score)) return 0;
  const issuePenalty = Math.min(0.06, (quality.issues?.length ?? 0) * 0.012);
  if (score >= 0.9) return 0.025 - issuePenalty;
  if (score >= 0.75) return 0.01 - issuePenalty;
  if (score >= 0.5) return -0.035 - issuePenalty;
  return -0.09 - issuePenalty;
}

/** Source quality rank signal. */
function sourceQualityRankSignal(result: SearchResult, queryClass: RagQueryClass) {
  let score = 0;
  const metadata = result.source_metadata;
  const unitType = result.index_unit?.unit_type ?? result.match_explanation?.indexUnitType ?? null;
  const visualTableUnit =
    unitType === "table_fact" ||
    unitType === "table_threshold" ||
    unitType === "medication_chart_row" ||
    unitType === "risk_matrix_cell" ||
    unitType === "chart_finding";

  if (result.relevance?.verdict === "direct") score += 0.09;
  if (result.relevance?.verdict === "partial") score += 0.045;
  if (result.relevance?.verdict === "nearby") score -= 0.065;
  if (result.relevance?.verdict === "none") score -= 0.13;

  if (result.source_strength === "strong") score += 0.04;
  if (result.source_strength === "moderate") score += 0.02;
  if (result.source_strength === "limited") score -= 0.015;

  // Governance metadata should not routinely outrank direct clinical evidence. Keep it
  // limited to small safety penalties for states that materially weaken source trust.
  if (metadata?.document_status === "outdated") score -= 0.04;
  if (metadata?.extraction_quality === "partial") score -= 0.01;
  if (metadata?.extraction_quality === "poor") score -= 0.04;

  const tableFocusedQuery = queryClass === "table_threshold" || queryClass === "medication_dose_risk";
  if (tableFocusedQuery && (result.table_facts?.length ?? 0) > 0) score += 0.055;
  if (tableFocusedQuery && visualTableUnit) score += 0.065;
  if (
    tableFocusedQuery &&
    (result.images ?? []).some(
      (image) =>
        Boolean(image.tableRows?.length) ||
        Boolean(image.tableColumns?.length) ||
        Boolean(image.accessibleTableMarkdown) ||
        /\b(?:table|threshold|dose|monitor|criteria)\b/i.test(
          `${image.tableTitle ?? ""} ${image.tableTextSnippet ?? ""}`,
        ),
    )
  ) {
    score += 0.035;
  }
  if (
    tableFocusedQuery &&
    (result.index_unit?.metadata?.source === "visual_intelligence" ||
      result.match_explanation?.reasons?.some((reason) => reason.startsWith("index_unit:visual")))
  ) {
    score += 0.025;
  }

  return score;
}

/** Evidence density boost. */
function evidenceDensityBoost(result: SearchResult, tokens: string[]) {
  if (!tokens.length) return 0;
  const haystack = normalizeQueryTokenForLookups(
    `${result.section_heading ?? ""} ${(result.section_path ?? []).join(" ")} ${result.content}`,
  ).split(" ");
  if (!haystack.length) return 0;
  const lookup = new Set(haystack);
  const hits = tokens.filter((token) => lookup.has(token)).length;
  return Math.min(0.1, hits * 0.028);
}

/** Has dose evidence support. */
export function hasDoseEvidenceSupport(result: SearchResult) {
  const haystack = clinicalResultEvidenceHaystack(result);
  return /\b(?:dose|dosage|dosing|mg|mcg|micrograms?|milligrams?|ug|route|oral|intramuscular|subcutaneous|subcut|sublingual|\bim\b|\bpo\b|\bsc\b|\bsl\b|\bprn\b|administer\w*|titration|titrate|frequency|maximum|tablet|injection|antipsychotic|benzodiazepine|olanzapine|lorazepam|haloperidol|droperidol|promethazine|diazepam)\b|[µμ]g/i.test(
    haystack,
  );
}

/** Has medication dose amount evidence. */
function hasMedicationDoseAmountEvidence(result: SearchResult) {
  const haystack = clinicalResultEvidenceHaystack(result);
  return /\b\d+(?:\.\d+)?\s?(?:mg|mcg|micrograms?|milligrams?|ug|[µμ]g)\b/i.test(haystack);
}

// A passage carrying a real dose/threshold figure (a numeric table row, or a
// number paired with a clinical unit) is the passage most likely to hold the
// answer to a dose/threshold query — and the least likely to repeat the drug
// name. Such passages must be exempt from the dose/core-concept keyword
// penalties so they are never demoted below boilerplate. See RET-H2.
/** Has numeric or table evidence. */
export function hasNumericOrTableEvidence(result: SearchResult) {
  if ((result.table_facts?.length ?? 0) > 0) return true;
  if (
    result.index_unit?.unit_type === "table_fact" ||
    result.index_unit?.unit_type === "table_threshold" ||
    result.index_unit?.unit_type === "medication_chart_row" ||
    result.index_unit?.unit_type === "risk_matrix_cell"
  ) {
    return true;
  }
  const haystack = clinicalResultEvidenceHaystack(result);
  // number + clinical unit, or an explicit threshold/range token.
  return /\b\d+(?:\.\d+)?\s?(?:mg|mcg|microgram|g|ml|mmol|mol|units?|%|x10\^?9|\/l|cells?)\b/i.test(haystack)
    ? true
    : /\b\d/.test(haystack) &&
        /\b(?:threshold|cut[\s-]?off|withhold|cease|range|level|anc|wbc|fbc|neutrophil|titrat|maximum|max\b)/i.test(
          haystack,
        );
}

/** Has structured threshold evidence. */
export function hasStructuredThresholdEvidence(result: SearchResult) {
  const fieldType = result.match_explanation?.fieldType ?? null;
  const unitType = result.index_unit?.unit_type ?? result.match_explanation?.indexUnitType ?? null;
  const tableFacts = result.table_facts ?? [];
  const images = result.images ?? [];
  const haystack = `${result.section_heading ?? ""} ${result.content} ${tableFacts
    .map(
      (fact) =>
        `${fact.table_title ?? ""} ${fact.row_label ?? ""} ${fact.clinical_parameter ?? ""} ${fact.threshold_value ?? ""} ${fact.action ?? ""}`,
    )
    .join(" ")} ${images
    .map((image) => `${image.tableTitle ?? ""} ${image.tableTextSnippet ?? ""} ${image.caption ?? ""}`)
    .join(" ")}`.toLowerCase();

  return (
    tableFacts.length > 0 ||
    fieldType === "threshold_fact" ||
    fieldType === "table_row" ||
    unitType === "table_fact" ||
    unitType === "table_threshold" ||
    unitType === "medication_chart_row" ||
    unitType === "risk_matrix_cell" ||
    unitType === "chart_finding" ||
    images.some((image) => image.source_kind === "table_crop" || image.sourceKind === "table_crop") ||
    /\b(?:threshold|cut[\s-]?off|withhold|cease|stop|maximum|minimum|range|criteria|anc|fbc|neutrophil|white cell|level)\b/i.test(
      haystack,
    )
  );
}

/** Section depth signal. */
function sectionDepthSignal(querySignal: IntentSignals, sectionHeading: string | null) {
  if (!sectionHeading || !querySignal.sectionedLookup) return 0;
  if (/(protocol|procedure|pathway|workflow|algorithm|escalat|risk|monitor)/i.test(sectionHeading)) return 0.035;
  return 0;
}

// Explicit dose vocabulary that must survive escalation-word cancellation
// (audit M3): "clozapine dose review schedule" is a genuine dosing query even
// though "review" is an escalation signal word.
const explicitDoseTerms = ["dose", "dosage", "dosing", "titrat", "mg", "mcg"] as const;

/** Classify query intent. */
export function classifyQueryIntent(query: string): IntentSignals {
  const lowered = query.toLowerCase();
  const hasMedicationContext =
    medicationTerms(normalizeAnalysisText(query)).length > 0 || medicationDoseRiskPattern.test(query);
  const medicationMonitoringIntent = hasMedicationContext && /\bmonitor\w*\b/i.test(query);
  const match = medicationMonitoringIntent
    ? intentPatterns.find((entry) => entry.intent === "drug_dosing")
    : intentPatterns.find((entry) => entry.pattern.test(query));
  const hasDosingSignals = containsAny(lowered, intentSignalWords.dosing);
  const hasEscalationSignals = containsAny(lowered, intentSignalWords.escalation);
  const hasImageSignals = containsAny(lowered, intentSignalWords.visuals);
  const hasExplicitDoseTerm = containsAny(lowered, explicitDoseTerms);

  return {
    intent: match?.intent ?? "general",
    imageEvidenceFocus: Boolean(match?.imageEvidenceFocus) || hasImageSignals,
    sectionedLookup: Boolean(match?.sectionedLookup),
    hasDosingSignals: hasDosingSignals && (hasExplicitDoseTerm || !hasEscalationSignals),
  };
}

const clinicalQueryAnalysisCache = new Map<string, ClinicalQueryAnalysis>();
const clinicalQueryAnalysisCacheLimit = 32;

/** Analyze clinical query. */
export function analyzeClinicalQuery(query: string): ClinicalQueryAnalysis {
  const originalQuery = query.trim();
  const cached = clinicalQueryAnalysisCache.get(originalQuery);
  if (cached) return structuredClone(cached);
  const normalizedQuery = normalizeAnalysisText(originalQuery);
  const corrected = correctedTokens(originalQuery);
  const corrections = tokens(originalQuery)
    .map((token, index) => ({ from: token, to: corrected[index] ?? token }))
    .filter((item) => item.from !== item.to);
  const correctedQuery = unique(corrected).join(" ");
  const aliasTerms = aliasesForQuery(`${normalizedQuery} ${correctedQuery}`, domainAliasGroups);
  const titleTerms = documentTitleTermsFor(`${normalizedQuery} ${correctedQuery}`);
  const medications = medicationTerms(`${normalizedQuery} ${correctedQuery}`);
  const acronyms = acronymTerms(originalQuery, normalizedQuery);
  const thresholdTerms = thresholdTermsFor(`${normalizedQuery} ${correctedQuery}`);
  const vocabularyTerms = expandClinicalVocabularyText(originalQuery, 32);
  const comparisonIntent = comparisonPattern.test(normalizedQuery);
  const explicitDocumentLookupIntent = explicitDocumentLookupPattern.test(normalizedQuery);
  const documentTitleIntent =
    titleTerms.length > 0 || documentIncludePattern.test(normalizedQuery) || explicitDocumentLookupIntent;
  const freshnessNeed = freshnessSignalPattern.test(normalizedQuery);
  const queryClass = queryClassFromSignals({
    normalizedQuery,
    medications,
    thresholdTerms,
    documentTitleTerms: titleTerms,
    comparisonIntent,
    explicitDocumentLookupIntent,
  });
  const intent = intentFromSignals(queryClass, normalizedQuery);
  const canonicalTerms = unique([...corrected, ...medications, ...acronyms], 32);
  const expandedTerms = unique(
    [
      ...canonicalTerms,
      ...vocabularyTerms,
      ...aliasTerms,
      ...titleTerms,
      ...aliasesForQuery(`${normalizedQuery} ${correctedQuery}`, medicationAliasGroups),
      // Whole-term match (audit finding #6): substring .includes let "im" hit "impairment",
      // "route" hit "routine" and "oral" hit "behavioral", pulling in the dose/route group.
      ...synonymGroups.filter((group) => group.some((term) => termMatchesQuery(normalizedQuery, term))).flat(),
    ],
    48,
  );
  const reasons = [
    comparisonIntent ? "comparison_terms" : "",
    thresholdTerms.length || tableThresholdPattern.test(normalizedQuery) ? "table_or_threshold_terms" : "",
    medications.length || medicationDoseRiskPattern.test(normalizedQuery) ? "medication_dose_or_risk_terms" : "",
    documentTitleIntent ? "document_lookup_terms" : "",
    documentIncludePattern.test(normalizedQuery) ? "document_include_terms" : "",
    broadSummaryPattern.test(normalizedQuery) ? "broad_summary_terms" : "",
    corrections.length ? "typo_corrections" : "",
    aliasTerms.length ? "domain_alias_terms" : "",
    freshnessNeed ? "freshness_terms" : "",
  ].filter(Boolean);
  const confidence = analysisConfidence({
    queryClass,
    reasons,
    canonicalTerms,
    documentTitleTerms: titleTerms,
    typoCorrectionCount: corrections.length,
  });
  const queryRewrite = buildStableQueryRewrite({
    originalQuery,
    normalizedQuery,
    correctedQuery,
    aliasTerms,
    titleTerms,
    medications,
    acronyms,
    thresholdTerms,
    vocabularyTerms,
  });

  const analysis: ClinicalQueryAnalysis = {
    originalQuery,
    normalizedQuery,
    queryClass,
    intent,
    confidence,
    reasons: reasons.length ? reasons : ["no_specific_rag_class_terms"],
    canonicalTerms,
    expandedTerms,
    typoCorrections: corrections,
    medications,
    acronyms,
    thresholdTerms,
    documentTitleTerms: titleTerms,
    queryRewrite,
    documentTitleIntent,
    comparisonIntent,
    freshnessNeed,
    needsVisualEvidence: hasImageEvidenceNeed(normalizedQuery) || queryClass === "table_threshold",
    needsSynthesis:
      queryClass === "comparison" ||
      queryClass === "broad_summary" ||
      /recommend|decide|should|manage|consider|contraindicat|interaction|risk/i.test(normalizedQuery),
    needsClassifierFallback: confidence < 0.58 && queryClass === "unsupported_or_general",
  };

  clinicalQueryAnalysisCache.set(originalQuery, analysis);
  if (clinicalQueryAnalysisCache.size > clinicalQueryAnalysisCacheLimit) {
    const oldestKey = clinicalQueryAnalysisCache.keys().next().value;
    if (oldestKey !== undefined) clinicalQueryAnalysisCache.delete(oldestKey);
  }
  return structuredClone(analysis);
}

/** Classify rag query. */
export function classifyRagQuery(query: string): RagQueryClassification {
  const analysis = analyzeClinicalQuery(query);
  return {
    queryClass: analysis.queryClass,
    reasons: analysis.reasons,
    needsVisualEvidence: analysis.needsVisualEvidence,
    needsSynthesis: analysis.needsSynthesis,
  };
}

/** Image evidence signal. */
function imageEvidenceSignal(query: string, result: SearchResult) {
  const queryTokens = normalizedClinicalSearchTokens(query).join(" ");
  const hasImageQuery = /table|chart|flowchart|diagram|graph|appendix|figure|matrix/.test(queryTokens);
  const images = result.images ?? [];
  const hasClinicalImageEvidence = images.some(
    (image) =>
      isClinicalImageEvidence(image) &&
      (image.image_type === "clinical_table" ||
        image.image_type === "flowchart_algorithm" ||
        image.image_type === "medication_chart" ||
        image.sourceKind === "table_crop" ||
        image.sourceKind === "diagram_crop"),
  );
  const hasPotentialImageEvidence = images.some(
    (image) =>
      isClinicalImageEvidence(image) &&
      (image.sourceKind === "page_region" || image.sourceKind === "cover_page" || image.sourceKind === "embedded"),
  );
  if (hasClinicalImageEvidence && hasImageQuery) return 0.24;
  if (hasClinicalImageEvidence) return 0.1;
  if (hasPotentialImageEvidence && hasImageQuery) return 0.16;
  return 0;
}

/** Section match boost. */
function sectionMatchBoost(query: string, result: SearchResult) {
  const loweredQuery = query.toLowerCase();
  const sectionText = [result.section_heading, ...(result.section_path ?? [])].filter(Boolean).join(" ");
  if (!sectionText) return 0;
  const sectionTokens = sectionText
    .toLowerCase()
    .split(/\W+/)
    .filter((token) => token.length > 2);
  const matches = sectionTokens.filter((token) => loweredQuery.includes(token));
  const exactSectionPhrase =
    sectionTokens.length >= 2 &&
    normalizedClinicalSearchTokens(query).join(" ").includes(sectionTokens.slice(0, 5).join(" "));
  return Math.min(0.15, matches.length * 0.03 + (exactSectionPhrase ? 0.045 : 0));
}

/** Document metadata boost. */
function documentMetadataBoost(query: string, result: SearchResult, normalizedTokens: string[]) {
  if (!normalizedTokens.length) return 0;
  const queryClass = classifyRagQuery(query).queryClass;
  const labels = result.document_labels ?? [];
  const summary = result.document_summary ?? "";
  const labelText = labels
    .map((label) => `${label.label} ${label.label_type}`)
    .join(" ")
    .toLowerCase();
  const summaryText = summary.toLowerCase();
  const titleText = `${result.title} ${result.file_name}`.toLowerCase();

  const tokenHits = normalizedTokens.filter((token) => {
    const singular = token.endsWith("s") && !token.endsWith("ss") ? token.slice(0, -1) : token;
    return labelText.includes(token) || labelText.includes(singular) || summaryText.includes(token);
  }).length;
  const highConfidenceLabelHits = labels.filter((label) => {
    const labelNormalized = normalizeQueryTokenForLookups(label.label);
    return label.confidence >= 0.6 && normalizedTokens.some((token) => labelNormalized.includes(token));
  }).length;
  const exactMetadataPhrase =
    normalizedTokens.length >= 2 &&
    (labelText.includes(normalizedTokens.join(" ")) ||
      summaryText.includes(normalizedTokens.join(" ")) ||
      titleText.includes(normalizedTokens.join(" ")));
  const classBoost =
    queryClass === "document_lookup" && (highConfidenceLabelHits > 0 || exactMetadataPhrase)
      ? 0.045
      : queryClass === "table_threshold" && /threshold|table|chart|monitor|level|anc|fbc/.test(summaryText)
        ? 0.04
        : queryClass === "medication_dose_risk" &&
            /medicat|dose|monitor|risk|toxicity|side effect|clozapine|lithium|neuroleptic/.test(summaryText)
          ? 0.035
          : 0;

  return (
    Math.min(0.18, tokenHits * 0.018 + highConfidenceLabelHits * 0.035 + (exactMetadataPhrase ? 0.05 : 0)) + classBoost
  );
}

/** Query class asset boost. */
function queryClassAssetBoost(args: { queryClass: RagQueryClass; normalizedQuery: string; result: SearchResult }) {
  const fieldType = args.result.match_explanation?.fieldType ?? null;
  const unitType = args.result.index_unit?.unit_type ?? args.result.match_explanation?.indexUnitType ?? null;
  const tableFactCount = args.result.table_facts?.length ?? 0;
  const hasClinicalImage = (args.result.images ?? []).some((image) => isClinicalImageEvidence(image));
  const summaryHit = Boolean(args.result.document_summary);
  const titleOrSummaryField = fieldType === "document_title" || fieldType === "document_summary";
  const monitoringIntent = /\b(?:monitor|monitoring|baseline|review|follow.?up|blood|level|fbc|anc)\b/i.test(
    args.normalizedQuery,
  );
  const cautionIntent =
    /\b(?:caution|avoid|contraindicat(?:e|es|ed|ion|ions)|toxicity|side effect|adverse|withhold|cease|stop)\b/i.test(
      args.normalizedQuery,
    );
  const escalationIntent =
    /\b(?:escalat(?:e|es|ed|ing|ion|ions)|urgent|senior|red flag|crisis|rapid|specialist)\b/i.test(
      args.normalizedQuery,
    );
  const documentationIntent = /\b(?:document|documentation|form|checklist|record|required|requirement)\b/i.test(
    args.normalizedQuery,
  );

  let score = 0;
  if (args.queryClass === "document_lookup" && fieldType === "document_title") score += 0.075;
  if ((args.queryClass === "document_lookup" || args.queryClass === "broad_summary") && titleOrSummaryField)
    score += 0.045;
  if (args.queryClass === "comparison" && (fieldType === "document_summary" || unitType === "section_summary"))
    score += 0.045;
  if ((args.queryClass === "table_threshold" || args.queryClass === "medication_dose_risk") && tableFactCount > 0)
    score += 0.075;
  if (args.queryClass === "table_threshold" && (fieldType === "threshold_fact" || unitType === "table_fact"))
    score += 0.085;
  if (args.queryClass === "medication_dose_risk" && fieldType === "clinical_action") score += 0.055;
  if (monitoringIntent && (fieldType === "threshold_fact" || fieldType === "table_row" || tableFactCount > 0))
    score += 0.045;
  if (cautionIntent && (fieldType === "clinical_action" || fieldType === "threshold_fact")) score += 0.05;
  if (escalationIntent && (fieldType === "clinical_action" || unitType === "clinical_fact")) score += 0.055;
  if (documentationIntent && (fieldType === "section_context" || unitType === "section_summary" || summaryHit))
    score += 0.035;
  if (hasClinicalImage && fieldType === "image_caption" && args.queryClass === "table_threshold") score += 0.04;
  return Math.min(0.16, score);
}

/** Normalized clinical search tokens. */
export function normalizedClinicalSearchTokens(query: string) {
  const baseTokens = correctedTokens(query);
  return baseTokens
    .filter((token) => (token.length > 2 || shortClinicalSearchTerms.has(token)) && !textSearchStopWords.has(token))
    .map((token) => (token.endsWith("s") && !token.endsWith("ss") ? token.slice(0, -1) : token))
    .filter((token) => (token.length > 2 || shortClinicalSearchTerms.has(token)) && !textSearchStopWords.has(token));
}

const genericMedicationDoseQueryTokens = new Set([
  "administer",
  "administered",
  "administering",
  "administration",
  "amount",
  "chart",
  "dose",
  "dosage",
  "dosing",
  "drug",
  "frequency",
  "frequent",
  "frequently",
  "given",
  "guidance",
  "listed",
  "management",
  "many",
  "max",
  "maximum",
  "medication",
  "medicine",
  "mcg",
  "mg",
  "microgram",
  "milligram",
  "min",
  "minimum",
  "much",
  "often",
  "oral",
  "orally",
  "intramuscular",
  "intramuscularly",
  "subcutaneous",
  "subcutaneously",
  "subcut",
  "sublingual",
  "sublingually",
  "route",
  "shown",
  "table",
  "used",
  "using",
  "usual",
  "ug",
  "once",
  "twice",
  "daily",
  "nightly",
  "weekly",
  "monthly",
  "hourly",
  "prn",
  "bd",
  "tds",
  "qds",
  "qid",
  "every",
  "hour",
  "day",
  "week",
  "time",
  "mouth",
  "im",
  "po",
  "patient",
  "recommend",
  "recommendation",
  "recommended",
  "sc",
  "sl",
]);

/** Require medication evidence to carry the medication question's clinical subject. */
export function medicationDoseQuerySubjectTokens(query: string) {
  return normalizedClinicalSearchTokens(query).filter((token) => !genericMedicationDoseQueryTokens.has(token));
}

/** Canonical medication subjects named by a monitoring query. */
export function medicationMonitoringQuerySubjects(query: string) {
  return unique([...medicationTerms(normalizeAnalysisText(query)), ...medicationSafetyEntitiesInText(query)], 12);
}

/** Alias phrases for the canonical medication subjects named by a monitoring query. */
export function medicationMonitoringSubjectAliases(query: string) {
  return unique(medicationMonitoringQuerySubjects(query).flatMap(medicationAliasesForEntity), 48);
}

const neutralThresholdLabelHeads = new Set([
  "acceptable",
  "action",
  "amber",
  "blood",
  "count",
  "desired",
  "green",
  "maintenance",
  "monitoring",
  "normal",
  "peak",
  "plasma",
  "recommended",
  "red",
  "reference",
  "range",
  "require",
  "requires",
  "result",
  "results",
  "serum",
  "target",
  "the",
  "threshold",
  "therapeutic",
  "trough",
  "usual",
  "value",
  "values",
]);
const thresholdLabelPattern =
  /\b([a-z][a-z0-9-]{2,})(?:\s+(?:maintenance|therapeutic|target|reference|trough|peak|serum|plasma|red|amber|green|desired|recommended|usual|normal|acceptable))*\s+(?:levels?|ranges?|concentrations?|thresholds?)\b/gi;
const thresholdAssignmentLabelPattern =
  /\b((?:(?:blood|serum|plasma|thyroid)\s+)?(?:tsh|thyroid|sodium|potassium|calcium|glucose|hba1c|anc|fbc|wbc|wcc|neutrophils?|qtc|lithium))\s+(?:levels?\s+)?(?:is|are|=)\s*(?=(?:between\s+)?(?:[<>≤≥]\s*)?\d)/gi;
const thresholdAnalyteAliasGroups = [
  ["lithium"],
  ["anc", "fbc", "wbc", "wcc", "white blood cell", "neutrophil", "neutrophils", "blood count"],
  ["blood glucose", "bgl", "glucose", "hba1c"],
  ["qtc", "corrected qt interval"],
  ["sodium"],
  ["potassium"],
  ["calcium"],
  ["creatinine", "egfr", "renal function"],
  ["blood pressure", "systolic", "diastolic"],
  ["temperature"],
  ["oxygen saturation", "spo2"],
  ["prolactin"],
  ["thyroid", "tsh", "thyroid stimulating hormone"],
] as const;

/** Whether a threshold phrase is labelled by a subject not named in the query. */
export function hasForeignThresholdLabel(query: string, evidenceText: string) {
  const expandedQueryTerms = expandClinicalVocabularyText(query);
  const queryTokens = new Set(
    normalizedClinicalSearchTokens(
      `${query} ${medicationMonitoringQuerySubjects(query).join(" ")} ${expandedQueryTerms.join(" ")}`,
    ),
  );
  const allowedAnalyteTokens = thresholdAnalyteAliasGroups
    .filter((group) =>
      group.some((alias) => normalizedClinicalSearchTokens(alias).every((token) => queryTokens.has(token))),
    )
    .flatMap((group) => group.flatMap((alias) => normalizedClinicalSearchTokens(alias)));
  const allowedLabels = new Set([
    ...normalizedClinicalSearchTokens(query),
    ...medicationMonitoringSubjectAliases(query).flatMap((alias) => normalizedClinicalSearchTokens(alias)),
    ...expandedQueryTerms.flatMap((term) => normalizedClinicalSearchTokens(term)),
    ...allowedAnalyteTokens,
  ]);
  const labels = [
    ...Array.from(evidenceText.matchAll(new RegExp(thresholdLabelPattern.source, "gi")), (match) => match[1]),
    ...Array.from(evidenceText.matchAll(new RegExp(thresholdAssignmentLabelPattern.source, "gi")), (match) => match[1]),
  ];
  return labels.some((label) =>
    normalizedClinicalSearchTokens(label).some(
      (token) => !allowedLabels.has(token) && !neutralThresholdLabelHeads.has(token),
    ),
  );
}

/** Normalized tokens for canonical medication subjects named by a monitoring query. */
export function medicationMonitoringQuerySubjectTokens(query: string) {
  return unique(
    medicationMonitoringQuerySubjects(query).flatMap((term) => normalizedClinicalSearchTokens(term)),
    12,
  );
}

/** Whether one evidence atom names the same canonical medication subject as the query. */
export function hasMedicationMonitoringSubjectText(query: string, evidenceText: string) {
  const querySubjects = medicationMonitoringQuerySubjects(query);
  if (querySubjects.length === 0) return true;

  const evidenceSubjects = new Set(medicationMonitoringQuerySubjects(evidenceText));
  return querySubjects.some((subject) => evidenceSubjects.has(subject));
}

function medicationMonitoringEvidenceSegments(value: string | null | undefined) {
  return (value ?? "")
    .split(/\r?\n+|(?<=[.!?;])\s+|\s+[•]\s+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

const medicationMonitoringAtomEvidencePattern =
  /\b(?:monitor\w*|baseline|follow[-\s]?up|checks?|tests?|levels?|ranges?|concentrations?|thresholds?|serum|plasma|renal|thyroid|calcium|glucose|lipids?|cholesterol|triglycerides|blood pressure|pulse|weight|bmi|fbcs?|ancs?|wbcs?|wccs?|ecgs?|lfts?|weekly|monthly|annual(?:ly)?|yearly|every)\b|\d+(?:\.\d+)?\s*(?:mmol|mol|mg|mcg|ng|[x×]\s*10)/i;
const medicationMonitoringContinuationPattern =
  /^(?:(?:the\s+)?patient\s+(?:should|must|needs?\s+to|is\s+to)\s+(?:have|undergo|receive|complete)\s+)?(?:monitor\w*|check\w*|review\w*|measure\w*|obtain\w*|repeat\w*|perform\w*|arrange\w*|test\w*|screen\w*|follow[-\s]?up|baseline|serum|plasma|renal|thyroid|calcium|blood|fbcs?|ancs?|wbcs?|wccs?|ecgs?|lfts?|glucose|lipids?|cholesterol|triglycerides|pressure|pulse|weight|bmi|levels?|ranges?|concentrations?|thresholds?|maintenance|therapeutic|target|trough|weekly|monthly|annual(?:ly)?|yearly|every)\b/i;
const bloodCountMonitoringParameterPattern =
  /\b(?:fbc|full blood count|blood count|anc|wbc|wcc|white (?:blood )?cells?|neutrophils?)\b/i;
const medicationWithholdActionPattern =
  /\b(?:withhold|withheld|withholding|hold|held|cease|stop|stopped|discontinue|discontinued)\b/i;

/** Whether one result carries the canonical medication subject named by a monitoring query. */
export function hasMedicationMonitoringSubjectEvidence(query: string, result: SearchResult) {
  const querySubjects = new Set(medicationMonitoringQuerySubjects(query));
  const evidenceSegments = [
    ...medicationMonitoringEvidenceSegments(result.retrieval_synopsis),
    ...medicationMonitoringEvidenceSegments(result.content),
    ...(result.table_facts ?? []).map((fact) =>
      [fact.table_title, fact.row_label, fact.clinical_parameter, fact.threshold_value, fact.action]
        .filter(Boolean)
        .join(" "),
    ),
    ...(result.index_unit
      ? [
          [
            result.index_unit.title,
            ...(result.index_unit.heading_path ?? []),
            result.index_unit.content,
            ...(result.index_unit.normalized_terms ?? []),
          ]
            .filter(Boolean)
            .join(" "),
        ]
      : []),
    ...(result.images ?? []).flatMap((image) => [
      ...medicationMonitoringEvidenceSegments(
        [image.caption, image.tableTitle, image.tableLabel, image.tableTextSnippet, image.accessibleTableMarkdown]
          .filter(Boolean)
          .join(" "),
      ),
      ...(image.tableRows ?? []).map((row) => [...(image.tableColumns ?? []), ...row].join(" ")),
    ]),
    ...(result.memory_cards ?? []).map((card) => `${card.title} ${card.content}`),
  ];

  const candidateSupportsSubject = (candidate: string) => {
    if (hasForeignMedicationClinicalValueBinding(query, candidate)) return false;
    if (hasForeignThresholdLabel(query, candidate)) return false;
    if (!medicationMonitoringAtomEvidencePattern.test(candidate)) return false;
    const evidenceSubjects = medicationMonitoringQuerySubjects(candidate);
    return evidenceSubjects.some((subject) => querySubjects.has(subject));
  };

  if (evidenceSegments.some(candidateSupportsSubject)) return true;

  return evidenceSegments.some((segment, index) => {
    const nextSegment = evidenceSegments[index + 1];
    if (!nextSegment) return false;
    const segmentSubjects = medicationMonitoringQuerySubjects(segment);
    const nextSubjects = medicationMonitoringQuerySubjects(nextSegment);
    const subjectThenMonitoring =
      segmentSubjects.some((subject) => querySubjects.has(subject)) &&
      segmentSubjects.every((subject) => querySubjects.has(subject)) &&
      nextSubjects.length === 0 &&
      medicationMonitoringContinuationPattern.test(nextSegment);
    const bloodCountThenMedicationAction =
      bloodCountMonitoringParameterPattern.test(query) &&
      bloodCountMonitoringParameterPattern.test(segment) &&
      medicationWithholdActionPattern.test(query) &&
      medicationWithholdActionPattern.test(nextSegment) &&
      nextSubjects.some((subject) => querySubjects.has(subject)) &&
      nextSubjects.every((subject) => querySubjects.has(subject));
    return (
      (subjectThenMonitoring || bloodCountThenMedicationAction) && candidateSupportsSubject(`${segment} ${nextSegment}`)
    );
  });
}

const medicationDoseAmountQueryPattern =
  /\b(?:dose|doses|dosage|dosages|dosing|amount|amounts|maximum|max|min|minimum|mg|mcg|micrograms?|milligrams?|ug)\b|[µμ]g|\bhow\s+much\b/i;
const medicationDoseRouteQueryPattern =
  /\b(?:route|routes|oral|orally|intramuscular|intramuscularly|subcutaneous|subcutaneously|subcut|sublingual|sublingually|im|po|sc|sl|by\s+mouth)\b/i;
const medicationDoseFrequencyQueryPattern =
  /\b(?:frequency|frequencies|frequent|frequently|how\s+often|how\s+frequently|once|twice|daily|nightly|weekly|monthly|hourly|prn|bd|tds|qds|qid|every\s+\d+(?:\.\d+)?\s*(?:hours?|days?|weeks?)|\d+\s+times?\s+(?:a|per)\s+(?:day|week|hour))\b/i;

/** Which explicit medication evidence attributes the query requests. */
export function medicationDoseEvidenceQueryIntent(query: string) {
  // A dose can anchor the timing of a monitoring test without requesting a
  // prescribed amount. Keep any separate dose/amount request in the query.
  const amountQuery = /\b(?:monitor\w*|levels?|sampling|blood\s+test|trough)\b/i.test(query)
    ? query.replace(
        /\b(?:after|following)\s+(?:(?:the|each|a)\s+)?(?:last\s+dose|dose\s+changes?|(?:(?:starting|commencing)\s+or\s+)?changing\s+(?:the\s+)?dose)\b/gi,
        " ",
      )
    : query;
  return {
    asksAmount: medicationDoseAmountQueryPattern.test(amountQuery),
    asksRoute: medicationDoseRouteQueryPattern.test(query),
    asksFrequency: medicationDoseFrequencyQueryPattern.test(query),
  };
}

/** Canonical text-search terms for the medication evidence attributes explicitly requested. */
export function medicationDoseEvidenceSearchTerms(query: string) {
  const terms: string[] = [];
  const intent = medicationDoseEvidenceQueryIntent(query);
  if (intent.asksAmount) terms.push("dose");

  for (const match of query.matchAll(
    /\b(\d+(?:\.\d+)?)\s*(mg|mcg|micrograms?|milligrams?|ug)\b|\b(\d+(?:\.\d+)?)\s*([µμ]g)/gi,
  )) {
    const amount = match[1] ?? match[3];
    const unit = match[2] ?? match[4];
    if (!amount || !unit) continue;
    terms.push(amount, /^(?:mcg|microgram|ug|[µμ]g)/i.test(unit) ? "mcg" : "mg");
  }

  if (/\broutes?\b/i.test(query)) terms.push("route");
  if (/\b(?:intramuscular|intramuscularly|im)\b/i.test(query)) terms.push("im");
  if (/\b(?:oral|orally|po|by\s+mouth)\b/i.test(query)) terms.push("po");
  if (/\b(?:subcutaneous|subcutaneously|subcut|sc)\b/i.test(query)) terms.push("sc");
  if (/\b(?:sublingual|sublingually|sl)\b/i.test(query)) terms.push("sl");
  if (/\bprn\b/i.test(query)) terms.push("prn");
  else if (intent.asksFrequency) terms.push("frequency");

  return [...new Set(terms.filter(Boolean))];
}

/** Whether the query explicitly asks for dose, route, or frequency evidence. */
export function isMedicationDoseEvidenceQuery(query: string) {
  const intent = medicationDoseEvidenceQueryIntent(query);
  return intent.asksAmount || intent.asksRoute || intent.asksFrequency;
}

/** Require dose evidence to carry the medication question's clinical subject. */
export function medicationDoseQueryContext(query: string, result: SearchResult) {
  const subjectTokens = medicationDoseQuerySubjectTokens(query);
  if (!subjectTokens.length) {
    return { hasClinicalSubject: false, matched: true, hitCount: 0, requiredHits: 0 };
  }
  const evidenceTokens = new Set(normalizedClinicalSearchTokens(clinicalResultEvidenceHaystack(result)));
  const hitCount = subjectTokens.filter((token) => evidenceTokens.has(token)).length;
  const requiredHits = Math.min(2, subjectTokens.length);
  return {
    hasClinicalSubject: true,
    matched: hitCount >= requiredHits,
    hitCount,
    requiredHits,
  };
}

/** Build clinical text search query. */
export function buildClinicalTextSearchQuery(query: string) {
  const normalizedTokens = normalizedClinicalSearchTokens(query);
  const correctedQueryText = correctedTokens(query).join(" ");
  const wantsSourceImageTable =
    /\b(?:source|show|open|view|display|see)\b.*\b(?:image|figure|visual|table|chart|matrix)\b/i.test(query) ||
    /\b(?:image|figure|visual)\b.*\b(?:source|table|chart|matrix)\b/i.test(query);
  const wantsRiskFlowchart =
    /\b(?:flow\s*chart|flowchart|algorithm|pathway)\b/i.test(query) &&
    /\b(?:risk|red\s*zone|red|urgent|escalat(?:e|es|ed|ing|ion|ions)|next step)\b/i.test(query);
  const wantsClozapineBloodMonitoring =
    /\bclozapine\b/i.test(correctedQueryText) &&
    /\b(?:blood|bloods|anc|fbc|wbc|wcc|neutrophil|neutrophils|full blood count|white cell|observation|observations|monitor|monitoring)\b/i.test(
      correctedQueryText,
    );
  const wantsClozapineBloodActionThreshold =
    wantsClozapineBloodMonitoring &&
    /\b(?:threshold|withhold|withheld|withholding|cease|ceased|ceasing|stop|stopped|stopping|discontinue|discontinued|discontinuing|discontinuation)\b/i.test(
      correctedQueryText,
    );
  const wantsClozapineMissedDose =
    /\bclozapine\b/i.test(correctedQueryText) &&
    /\bmissed\b/i.test(correctedQueryText) &&
    /\bdose\b/i.test(correctedQueryText);
  const hasAgitationArousalTypo = /\b(?:agitaton|arousl|arrousal)\b/i.test(query);
  const hasAgitationArousalContext =
    (hasAgitationArousalTypo && /\bagitation\b/i.test(correctedQueryText) && /\barousal\b/i.test(correctedQueryText)) ||
    /\bagitation\b/i.test(correctedQueryText);
  const agitationMedicationIntent = medicationDoseEvidenceQueryIntent(query);
  // Chart/dose/route/options expand into medication-chart terms. Bare "table" or
  // "management" alone must not — those appear in topic lookups like
  // "which table covers … pharmacological management" and broad management questions.
  const agitationChartSurfaceMatch = /\b(?:dose|dosing|route|oral|intramuscular|im|po|chart|options?|listed)\b/i.test(
    correctedQueryText,
  );
  const wantsAgitationMedicationChart =
    hasAgitationArousalContext &&
    (agitationMedicationIntent.asksAmount ||
      agitationMedicationIntent.asksRoute ||
      agitationMedicationIntent.asksFrequency ||
      agitationChartSurfaceMatch);
  const wantsAgitationArousal =
    hasAgitationArousalContext &&
    (wantsAgitationMedicationChart ||
      /\b(?:guidance|inpatient|psychiatric|chart|table|pharmacolog)/i.test(correctedQueryText));

  if (wantsClozapineMissedDose) {
    normalizedTokens.splice(0, normalizedTokens.length, "clozapine", "missed", "dose", "monitoring", "table");
  } else if (wantsSourceImageTable) {
    const visualTokens = ["source", "image", "visual", "table", "chart"];
    if (/\bclozapine\b/i.test(query)) visualTokens.unshift("clozapine", "monitoring");
    if (/\b(?:anc|neutrophil)\b/i.test(query)) visualTokens.unshift("anc", "neutrophil");
    if (/\b(?:fbc|full blood count)\b/i.test(query)) visualTokens.unshift("fbc", "blood");
    normalizedTokens.unshift(...visualTokens);
  } else if (wantsClozapineBloodActionThreshold) {
    // Preserve the blood-count/action subject for threshold questions. Collapsing
    // this measured shape to the generic `clozapine monitoring` primary query
    // produces a deep, high-ranked but irrelevant pool, which then legitimately
    // suppresses the more precise sibling variants. Ordinary monitoring questions
    // retain the established broad query below.
    normalizedTokens.splice(0, normalizedTokens.length, "clozapine", "wbc", "neutrophils", "red", "range", "stop");
  } else if (wantsClozapineBloodMonitoring) {
    normalizedTokens.splice(0, normalizedTokens.length, "clozapine", "monitoring");
  } else if (wantsAgitationMedicationChart) {
    const requestedDoseRouteTerms = medicationDoseEvidenceSearchTerms(query);
    const medicationChartTokens =
      requestedDoseRouteTerms.length > 0
        ? ["agitation", "arousal", ...requestedDoseRouteTerms]
        : ["agitation", "arousal", "pharmacological", "management", "medication", "chart", "dose", "route", "im", "po"];
    normalizedTokens.splice(0, normalizedTokens.length, ...medicationChartTokens);
  } else if (wantsAgitationArousal) {
    normalizedTokens.splice(0, normalizedTokens.length, "agitation", "arousal", "pharmacological", "management");
  } else if (/\badmission\b/i.test(query) && /\bcommunity patients?\b/i.test(query)) {
    normalizedTokens.unshift("admission", "community", "patients", "pts");
  } else if (/\bdischarge\b/i.test(query) && /\b(?:summari[sz]e|summary|guidance|documentation?)\b/i.test(query)) {
    normalizedTokens.splice(0, normalizedTokens.length, "mental", "health", "discharge");
  } else if (
    /\bactive community patients?\b/i.test(query) &&
    /\bed\b/i.test(query) &&
    normalizedTokens.includes("active")
  ) {
    const expandedTokens = normalizedTokens.filter(
      (token) => !["patient", "patients", "pt", "pts", "ed"].includes(token),
    );
    normalizedTokens.splice(0, normalizedTokens.length, ...expandedTokens, "pt", "ed");
  } else if (/\bpatient property\b/i.test(query)) {
    normalizedTokens.unshift("patient", "property");
  } else if (wantsRiskFlowchart) {
    normalizedTokens.unshift(
      "risk",
      "flow",
      "red",
      "zone",
      "flowchart",
      "next",
      "step",
      "review",
      "urgent",
      "escalation",
    );
  } else if (/\b(?:risk matrix|red zone)\b/i.test(query)) {
    normalizedTokens.push("high", "visual", "alert");
  } else if (/\badmission\b/i.test(query) && /\bdischarge\b/i.test(query)) {
    normalizedTokens.push("community", "patients", "pts");
  } else if (/\bcommunity patients?\b/i.test(query) && normalizedTokens.includes("community")) {
    normalizedTokens.push("pts");
  }

  const uniqueTokens = Array.from(new Set(normalizedTokens)).slice(0, 14);
  return uniqueTokens.length >= 1 ? uniqueTokens.join(" ") : query;
}

/** Expand clinical query. */
export function expandClinicalQuery(query: string) {
  const analysis = analyzeClinicalQuery(query);
  const lowered = analysis.normalizedQuery;
  const additions = new Set<string>();

  for (const group of synonymGroups) {
    if (group.some((term) => termMatchesQuery(lowered, term))) {
      group.forEach((term) => additions.add(term));
    }
  }

  analysis.expandedTerms.forEach((term) => additions.add(term));
  analysis.queryRewrite.expansions.forEach((term) => additions.add(term));
  expandClinicalVocabularyText(query).forEach((term) => additions.add(term));

  if (additions.size === 0) return query;
  return `${query} ${Array.from(additions).join(" ")}`;
}

/** Round score. */
function roundScore(value: number) {
  return Number(value.toFixed(4));
}

/** Clinical rank explanation. */
export function clinicalRankExplanation(query: string, result: SearchResult): SearchScoreExplanation {
  const analysis = analyzeClinicalQuery(query);
  const queryTokens = tokens(query);
  const correctedQueryText = correctedTokens(query).join(" ");
  const querySignal = classifyQueryIntent(query);
  const queryClass = analysis.queryClass;
  const normalizedTokens = normalizedClinicalQueryTokens(query);
  const tableFactText = (result.table_facts ?? [])
    .map((fact) =>
      [fact.table_title, fact.row_label, fact.clinical_parameter, fact.threshold_value, fact.action].join(" "),
    )
    .join(" ");
  const sectionPathText = result.section_path?.join(" ") ?? "";
  const haystack =
    `${result.title} ${result.file_name} ${result.section_heading ?? ""} ${sectionPathText} ${result.retrieval_synopsis ?? ""} ${result.content} ${tableFactText}`.toLowerCase();
  const base = result.hybrid_score ?? result.similarity;
  const title = `${result.title} ${result.file_name}`.toLowerCase();
  const titleTokenText = tokens(`${result.title} ${result.file_name}`).join(" ");
  const titleTokens = new Set(tokens(`${result.title} ${result.file_name}`));
  const normalizedQueryTokens = normalizedClinicalSearchTokens(query);
  const exactTitleBoost = queryTokens.some((token) => title.includes(token)) ? 0.08 : 0;
  const titleTokenMatches = normalizedQueryTokens.filter(
    (token) => titleTokens.has(token) || titleTokenText.includes(token),
  ).length;
  const titleCoverageBoost = Math.min(0.18, titleTokenMatches * 0.045);
  const titlePhraseBoost =
    /\btreatment\s+team\b/i.test(query) && /\btreatment\s+team\s+process\b/.test(titleTokenText) ? 0.18 : 0;
  const safetyQuery =
    /\b(urgent|red flag|contraindicat(?:e|es|ed|ion|ions)|avoid|escalat(?:e|es|ed|ing|ion|ions)|toxicity|dose|monitor)\b/i.test(
      query,
    );
  const safetyContentBoost =
    safetyQuery &&
    /\b(urgent|red flag|contraindicat(?:e|es|ed|ion|ions)|avoid|escalat(?:e|es|ed|ing|ion|ions)|toxicity|maximum|monitor)\b/.test(
      haystack,
    )
      ? 0.08
      : 0;
  const status = result.source_metadata?.document_status;
  const statusBoost = status === "outdated" ? -0.04 : 0;
  const publicationYearsAgo = parseDateAsYearsAgo(result.source_metadata?.publication_date);
  const reviewYearsAgo = parseDateAsYearsAgo(result.source_metadata?.review_date);
  const freshnessBoost = freshnessDecayPenalty(publicationYearsAgo, "publication", rankingConfig.freshness);
  const reviewBoost = freshnessDecayPenalty(reviewYearsAgo, "review", rankingConfig.freshness);
  const imageBoost = imageEvidenceSignal(query, result);
  const sectionBoost = sectionMatchBoost(query, result);
  const sectionedLookupBoost = querySignal.sectionedLookup ? 0.02 : 0;
  const extractionBoost = extractionQualityScore(result);
  const indexQualityBoost = indexQualityRankSignal(result);
  const sourceQualityBoost = sourceQualityRankSignal(result, queryClass);
  const dosingBoost = querySignal.hasDosingSignals && hasDoseEvidenceSupport(result) ? 0.09 : 0;
  const numericEvidenceExempt = hasNumericOrTableEvidence(result);
  const titleOnlyDosePenalty =
    queryClass === "medication_dose_risk" &&
    titleCoverageBoost >= 0.09 &&
    !hasDoseEvidenceSupport(result) &&
    !numericEvidenceExempt
      ? -0.42
      : 0;
  const administrativeDoseQueryPenalty =
    queryClass === "medication_dose_risk" &&
    !numericEvidenceExempt &&
    /\b(?:supporting information|relevant standards|references|document owner|review|authorisation|authorised by|published date|effective from|amendment)\b/i.test(
      result.content,
    ) &&
    !/\b(?:mg|mcg|oral|intramuscular|\bim\b|\bpo\b|\bprn\b|maximum dose|repeat(?:ing)? doses?|dose may be repeated|monitoring:)\b/i.test(
      result.content,
    )
      ? -0.3
      : 0;
  const medicationDoseContext = medicationDoseQueryContext(query, result);
  const medicationDoseContextBoost =
    queryClass === "medication_dose_risk" && medicationDoseContext.hasClinicalSubject && medicationDoseContext.matched
      ? 0.26
      : 0;
  const medicationDoseContextPenalty =
    queryClass === "medication_dose_risk" && medicationDoseContext.hasClinicalSubject && !medicationDoseContext.matched
      ? -0.24
      : 0;
  const protocolBoost =
    querySignal.intent === "protocol" && /(protocol|process|procedure|workflow|pathway|algorithm)/i.test(haystack)
      ? 0.06
      : 0;
  const escalationBoost =
    querySignal.intent === "escalation_risk" && /(urgent|escalat|risk|red flag|senior|specialist|admit)/i.test(haystack)
      ? 0.05
      : 0;
  const definitionBoost =
    querySignal.intent === "definition" && /(definition|meaning|term|describe|what is)/i.test(haystack) ? 0.05 : 0;
  const evidenceBoost = evidenceDensityBoost(result, normalizedTokens);
  const coreConceptTokens = normalizedTokens.filter(
    (token) =>
      ![
        "dose",
        "dosing",
        "dosage",
        "medication",
        "medicine",
        "route",
        "oral",
        "intramuscular",
        "monitor",
        "monitoring",
        "risk",
      ].includes(token),
  );
  const coreConceptPenalty =
    queryClass === "medication_dose_risk" &&
    coreConceptTokens.length > 0 &&
    !numericEvidenceExempt &&
    !coreConceptTokens.some((token) => haystack.includes(token))
      ? -0.36
      : 0;
  const sectionDepth = sectionDepthSignal(querySignal, result.section_heading);
  const metadataBoost = documentMetadataBoost(query, result, normalizedTokens);
  const assetBoost = queryClassAssetBoost({
    queryClass,
    normalizedQuery: analysis.normalizedQuery,
    result,
  });
  const tableThresholdBoost =
    queryClass === "table_threshold" &&
    /(threshold|cut[\s-]?off|withhold|cease|stop|anc|fbc|table|chart|criteria|level|range|monitor)/i.test(haystack)
      ? 0.06
      : 0;
  const clozapineSpecificQuery =
    /\bclozapine\b/i.test(query) &&
    /\b(?:anc|fbc|full blood count|blood|bloods|withhold|cease|stop|threshold|missed dose|monitor|monitoring|observations?)\b/i.test(
      query,
    );
  const clozapineSpecificBoost = clozapineSpecificQuery && /\bclozapine\b/.test(haystack) ? 0.22 : 0;
  const clozapineSpecificPenalty = clozapineSpecificQuery && !/\bclozapine\b/.test(haystack) ? -0.3 : 0;
  const clozapinePrescribingAdminBoost =
    clozapineSpecificQuery && /\bclozapine prescribing administration (?:and )?monitoring\b/.test(titleTokenText)
      ? 0.18
      : 0;
  const mentalHealthDischargeQuery =
    /\bdischarge\b/i.test(query) && /\b(?:summari[sz]e|summary|guidance|documentation?|requirements?)\b/i.test(query);
  const mentalHealthDischargeBoost =
    mentalHealthDischargeQuery &&
    /\b(?:admission to discharge.*mental health|mental health.*discharge|referral admission and discharge.*mental health|mental health hospital in the home|mental health inpatient triage to discharge|community mental health.*triage.*discharge|medically cleared.*discharge)\b/.test(
      titleTokenText,
    )
      ? 0.22
      : 0;
  const genericDischargePenalty =
    mentalHealthDischargeQuery &&
    !/\bmental health\b/.test(titleTokenText) &&
    /\b(?:criteria led discharge|against medical advice|opcl|summary discharge|discharge ready)\b/.test(titleTokenText)
      ? -0.18
      : 0;
  const agitationArousalQuery =
    queryClass === "medication_dose_risk" &&
    /\bagitation\b/i.test(correctedQueryText) &&
    /\b(?:arousal|route|oral|intramuscular|\bim\b|\bpo\b|dose|dosing|guidance|inpatient|psychiatric|chart|table|pharmacolog)/i.test(
      correctedQueryText,
    );
  const agitationArousalSource =
    /\bagitation\b/.test(haystack) &&
    (/\barousal\b/.test(haystack) ||
      /\bpharmacological management\b/.test(haystack) ||
      /\bpharma mgt\b/.test(titleTokenText));
  const agitationArousalCanonicalTitle =
    agitationArousalQuery &&
    /\bagitation\b/.test(titleTokenText) &&
    (/\barousal\b/.test(titleTokenText) || /\bpharma mgt\b/.test(titleTokenText));
  const agitationArousalCanonicalBoost = agitationArousalCanonicalTitle
    ? 0.34
    : agitationArousalQuery && agitationArousalSource
      ? 0.18
      : 0;
  const agitationArousalGenericPenalty = agitationArousalQuery && !agitationArousalSource ? -0.32 : 0;
  const activeCommunityEdQuery =
    queryClass === "document_lookup" &&
    /\bactive\b/i.test(query) &&
    /\bcommunity\b/i.test(query) &&
    /\b(?:ed|emergency department)\b/i.test(query);
  const activeCommunityEdSource =
    /\bactive\b/.test(haystack) && /\bcommunity\b/.test(haystack) && /\b(?:ed|emergency department)\b/.test(haystack);
  const activeCommunityCanonicalTitle =
    activeCommunityEdQuery &&
    /\bactive\b/.test(titleTokenText) &&
    /\bcommunity\b/.test(titleTokenText) &&
    /\b(?:ed|emergency department)\b/.test(titleTokenText);
  const activeCommunityCanonicalBoost = activeCommunityCanonicalTitle
    ? 0.38
    : activeCommunityEdQuery && activeCommunityEdSource
      ? 0.18
      : 0;
  const activeCommunityGenericPenalty = activeCommunityEdQuery && !activeCommunityEdSource ? -0.22 : 0;
  const riskFlowchartQuery =
    queryClass === "document_lookup" &&
    /\b(?:flow\s*chart|flowchart|algorithm|pathway)\b/i.test(query) &&
    (/\b(?:risk|next step|step after)\b/i.test(query) || riskZoneContextPattern.test(query));
  // Zone-action evidence ("red zone ... escalate / urgent review") answers a risk
  // flowchart question even when the source never uses the word "flowchart" —
  // escalation protocols express the flowchart's decision steps as text. Without
  // this, the generic penalty demoted the documents that actually contain the
  // red-zone next step while unrelated risk-assessment flowcharts kept the boost.
  // Both term groups must hit: a bare "zone" or a lone "review" is not evidence.
  // The patterns are scoped to the colour the query names, so a red-zone
  // question is not boosted by an amber-zone cell's action; risk-matrix /
  // flowchart visual units store the cell colour as a bare token
  // ("... | Red | escalate ..."), so for those units the colour token counts as
  // zone context.
  const indexUnitText = result.index_unit
    ? `${result.index_unit.title} ${result.index_unit.content}`.toLowerCase()
    : "";
  const riskFlowchartEvidenceText = `${haystack} ${indexUnitText}`;
  const zonePatterns = zoneContextPatternsForQuery(query);
  const zoneCellUnitEvidence =
    ["risk_matrix_cell", "flowchart_step", "diagram_decision"].includes(result.index_unit?.unit_type ?? "") &&
    zonePatterns.bareColourPattern.test(riskFlowchartEvidenceText);
  const riskFlowchartZoneActionSource =
    (zonePatterns.zonePhrasePattern.test(riskFlowchartEvidenceText) || zoneCellUnitEvidence) &&
    riskZoneActionPattern.test(riskFlowchartEvidenceText);
  const riskFlowchartLexicalSource =
    /\b(?:flowchart|flow chart|flow|algorithm|pathway|matrix)\b/.test(riskFlowchartEvidenceText) &&
    /\b(?:risk|red zone|red)\b/.test(riskFlowchartEvidenceText);
  // For next-step/action questions, a flowchart page that names the risk but
  // carries no action instruction is exactly the false positive the retrieval
  // gates defer past — it must not take the risk-flowchart boost (nor dodge the
  // generic penalty) on lexical grounds alone; the action evidence must be on
  // the same result.
  const nextStepActionQuery = /\b(?:next step|step after|action)\b/i.test(query);
  const riskFlowchartSource = nextStepActionQuery
    ? riskFlowchartZoneActionSource ||
      (riskFlowchartLexicalSource && riskZoneActionPattern.test(riskFlowchartEvidenceText))
    : riskFlowchartLexicalSource || riskFlowchartZoneActionSource;
  const riskFlowchartCanonicalTitle =
    riskFlowchartQuery &&
    /\b(?:flow|flowchart|flow chart|algorithm|pathway|matrix)\b/.test(titleTokenText) &&
    /\brisk\b/.test(titleTokenText);
  const riskFlowchartCanonicalBoost = riskFlowchartCanonicalTitle
    ? 0.32
    : riskFlowchartQuery && riskFlowchartSource
      ? 0.16
      : 0;
  const riskFlowchartGenericPenalty = riskFlowchartQuery && !riskFlowchartSource ? -0.18 : 0;
  const structuredTableBoost =
    (queryClass === "table_threshold" || queryClass === "medication_dose_risk") && (result.table_facts?.length ?? 0) > 0
      ? 0.12
      : 0;
  const indexUnitBoost = (() => {
    const unit = result.index_unit;
    if (!unit) return 0;
    let score = 0.025;
    if (unit.extraction_mode === "model_heavy") score += 0.025;
    if (unit.unit_type === "askable_question") score += 0.07;
    if (unit.unit_type === "clinical_fact") score += 0.055;
    if (
      unit.unit_type === "table_fact" &&
      (queryClass === "table_threshold" || queryClass === "medication_dose_risk")
    ) {
      score += 0.09;
    }
    if (unit.unit_type === "section_summary" && (queryClass === "document_lookup" || queryClass === "broad_summary")) {
      score += 0.05;
    }
    return Math.min(0.16, score + Math.max(0, Number(unit.quality_score ?? 0) - 0.7) * 0.08);
  })();
  const directAnswerCoverage =
    normalizedTokens.length > 0
      ? normalizedTokens.filter((token) => haystack.includes(token)).length / Math.max(normalizedTokens.length, 1)
      : 0;
  const directAnswerBoost =
    directAnswerCoverage >= 0.75
      ? 0.08
      : directAnswerCoverage >= 0.5
        ? 0.035
        : directAnswerCoverage <= 0.2 && normalizedTokens.length >= 3
          ? -0.08
          : 0;
  const comparisonCoverageBoost =
    queryClass === "comparison" && titleCoverageBoost > 0 && evidenceBoost > 0.02 ? 0.025 : 0;
  const routeSignal = (() => {
    if (result.source_metadata?.document_status === "outdated") return -0.04;
    if (result.source_metadata?.extraction_quality === "poor") return -0.035;
    return 0;
  })();
  const lowLexicalCoverage = normalizedTokens.length > 0 && evidenceBoost < 0.035 && titleCoverageBoost < 0.045;
  const shouldBlendRrf =
    typeof result.rrf_score === "number" &&
    result.rrf_score > 0 &&
    (queryClass === "comparison" ||
      queryClass === "document_lookup" ||
      analysis.typoCorrections.length > 0 ||
      lowLexicalCoverage);
  const rrfScore = typeof result.rrf_score === "number" ? result.rrf_score : 0;
  const rrfBoost = shouldBlendRrf ? Math.min(0.11, rrfScore * 0.32) : 0;

  const titleBoost = exactTitleBoost + titleCoverageBoost + titlePhraseBoost;
  const lexicalCoverageScore = roundScore(directAnswerCoverage);
  const metadataMatchScore = roundScore(metadataBoost);
  const sectionTitleMatchBoost = roundScore(titleBoost + sectionBoost + sectionDepth);
  const freshnessRecencyBoost = roundScore(statusBoost + freshnessBoost + reviewBoost);
  const metadataSignals =
    statusBoost +
    freshnessBoost +
    reviewBoost +
    extractionBoost +
    indexQualityBoost +
    sourceQualityBoost +
    metadataBoost +
    routeSignal;
  const clinicalSignalBoost =
    safetyContentBoost +
    imageBoost +
    sectionBoost +
    sectionedLookupBoost +
    dosingBoost +
    protocolBoost +
    escalationBoost +
    definitionBoost +
    evidenceBoost +
    tableThresholdBoost +
    structuredTableBoost +
    clozapineSpecificBoost +
    clozapinePrescribingAdminBoost +
    mentalHealthDischargeBoost +
    agitationArousalCanonicalBoost +
    activeCommunityCanonicalBoost +
    riskFlowchartCanonicalBoost +
    directAnswerBoost +
    comparisonCoverageBoost +
    medicationDoseContextBoost +
    sectionDepth +
    indexUnitBoost +
    assetBoost;
  const rawPenalty =
    titleOnlyDosePenalty +
    administrativeDoseQueryPenalty +
    medicationDoseContextPenalty +
    coreConceptPenalty +
    clozapineSpecificPenalty +
    genericDischargePenalty +
    agitationArousalGenericPenalty +
    activeCommunityGenericPenalty +
    riskFlowchartGenericPenalty;
  const penalty = Math.max(rawPenalty, -0.35);
  const titleSectionRelevance = titleBoost + sectionBoost + sectionDepth;
  const lexicalCoverage = evidenceBoost + directAnswerBoost + comparisonCoverageBoost;
  const metadataRelevance = metadataBoost;
  const clinicalEvidence =
    clinicalSignalBoost - sectionBoost - sectionDepth - evidenceBoost - directAnswerBoost - comparisonCoverageBoost;
  const fixedMetadataAdjustment = metadataSignals - metadataBoost;
  const weights = rankingConfig.featureFusion[queryClass];
  const rankScore =
    clamp(base) * weights.hybridRelevance +
    lexicalCoverage * weights.lexicalCoverage +
    rrfBoost * weights.reciprocalRankFusion +
    titleSectionRelevance * weights.titleSectionRelevance +
    metadataRelevance * weights.metadataRelevance +
    clinicalEvidence * weights.clinicalEvidence +
    fixedMetadataAdjustment +
    penalty;
  const finalScore = clamp(rankScore);

  return {
    vectorScore: roundScore(clamp(result.similarity)),
    textRank: roundScore(result.text_rank ?? 0),
    lexicalCoverageScore,
    metadataMatchScore,
    sectionTitleMatchBoost,
    freshnessRecencyBoost,
    weightedHybridScore: roundScore(clamp(base)),
    rrfScore: typeof result.rrf_score === "number" ? roundScore(result.rrf_score) : null,
    rrfBoost: roundScore(rrfBoost),
    memoryBoost: roundScore(result.memory_score ? Math.min(0.24, result.memory_score * 0.24) : 0),
    titleBoost: roundScore(titleBoost),
    metadataBoost: roundScore(metadataSignals),
    clinicalSignalBoost: roundScore(clinicalSignalBoost),
    penalty: roundScore(penalty),
    rawPenalty: roundScore(rawPenalty),
    rankScore: roundScore(rankScore),
    finalScore: roundScore(finalScore),
    fusionSignals: {
      hybridRelevance: roundScore(clamp(base)),
      lexicalCoverage: roundScore(lexicalCoverage),
      reciprocalRankFusion: roundScore(rrfBoost),
      titleSectionRelevance: roundScore(titleSectionRelevance),
      metadataRelevance: roundScore(metadataRelevance),
      clinicalEvidence: roundScore(clinicalEvidence),
      fixedAdjustment: roundScore(fixedMetadataAdjustment + penalty),
    },
    strategy: shouldBlendRrf ? "weighted_hybrid_rrf_blend" : "weighted_hybrid",
  };
}

/** Ranking tie break score. */
function rankingTieBreakScore(query: string, result: SearchResult, explanation: SearchScoreExplanation) {
  const analysis = analyzeClinicalQuery(query);
  const queryClass = analysis.queryClass;
  const correctedQueryText = correctedTokens(query).join(" ");
  const queryTokens = normalizedClinicalSearchTokens(query);
  const titleText = normalizeQueryTokenForLookups(`${result.title} ${result.file_name}`);
  const sectionText = normalizeQueryTokenForLookups(
    `${result.section_heading ?? ""} ${(result.section_path ?? []).join(" ")}`,
  );
  const contentText = normalizeQueryTokenForLookups(result.content ?? "");
  const tableText = normalizeQueryTokenForLookups(
    (result.table_facts ?? [])
      .map(
        (fact) =>
          `${fact.table_title ?? ""} ${fact.row_label ?? ""} ${fact.clinical_parameter ?? ""} ${fact.threshold_value ?? ""} ${fact.action ?? ""}`,
      )
      .join(" "),
  );
  const visualText = normalizeQueryTokenForLookups(
    (result.images ?? [])
      .map((image) => `${image.caption ?? ""} ${image.tableTitle ?? ""} ${image.tableTextSnippet ?? ""}`)
      .join(" "),
  );
  const haystack = `${titleText} ${sectionText} ${contentText} ${tableText} ${visualText}`;
  const titleHits = queryTokens.filter((token) => titleText.includes(token)).length;
  const sectionHits = queryTokens.filter((token) => sectionText.includes(token)).length;
  const contentHits = queryTokens.filter((token) => contentText.includes(token)).length;
  const tableHits = queryTokens.filter((token) => tableText.includes(token) || visualText.includes(token)).length;
  const hasStructuredTable = hasStructuredThresholdEvidence(result) || hasNumericOrTableEvidence(result);
  const hasDoseEvidence = hasDoseEvidenceSupport(result);
  const hasDoseAmountEvidence = hasMedicationDoseAmountEvidence(result);
  const wantsSourceImage =
    /\b(?:source|show|open|view|display|see)\b.*\b(?:image|figure|visual|table|chart|matrix)\b/i.test(query) ||
    /\b(?:image|figure|visual)\b.*\b(?:source|table|chart|matrix)\b/i.test(query);
  const hasSourceImageEvidence =
    (result.image_ids?.length ?? 0) > 0 ||
    (result.table_facts ?? []).some((fact) => Boolean(fact.source_image_id)) ||
    (result.images ?? []).some((image) => isClinicalImageEvidence(image));
  const titleAliasHit = analysis.documentTitleTerms.some((term) =>
    titleText.includes(normalizeQueryTokenForLookups(term)),
  );

  let score = 0;
  score += explanation.titleBoost * 0.32;
  score += explanation.clinicalSignalBoost * 0.18;
  score += Math.max(0, explanation.metadataBoost) * 0.08;
  score += Math.max(0, explanation.lexicalCoverageScore) * 0.04;
  score += Math.min(0.12, titleHits * 0.035);
  score += Math.min(0.08, sectionHits * 0.018);
  score += Math.min(0.06, contentHits * 0.01);
  score += Math.min(0.08, tableHits * 0.018);

  if (queryClass === "document_lookup" && titleHits > 0) score += 0.09;
  if (queryClass === "document_lookup" && titleAliasHit) score += 0.16;
  if (queryClass === "comparison" && titleHits > 0) score += 0.06;
  if (queryClass === "table_threshold" && hasStructuredTable) score += 0.09;
  if (queryClass === "medication_dose_risk" && hasDoseEvidence) score += 0.08;
  if (queryClass === "medication_dose_risk" && hasDoseAmountEvidence) score += 0.14;
  if ((queryClass === "table_threshold" || queryClass === "medication_dose_risk") && hasStructuredTable) score += 0.04;
  if (
    queryClass === "medication_dose_risk" &&
    /\bagitation\b/i.test(correctedQueryText) &&
    /\b(?:arousal|route|oral|intramuscular|\bim\b|\bpo\b|dose|dosing|guidance|inpatient|psychiatric|chart|table|pharmacolog)/i.test(
      correctedQueryText,
    )
  ) {
    const agitationSource =
      /\bagitation\b/.test(haystack) &&
      (/\barousal\b/.test(haystack) ||
        /\bpharmacological management\b/.test(haystack) ||
        /\bpharma mgt\b/.test(titleText));
    if (/\bagitation\b/.test(titleText) && (/\barousal\b/.test(titleText) || /\bpharma mgt\b/.test(titleText))) {
      score += 0.24;
    } else if (agitationSource) {
      score += 0.1;
    } else {
      score -= 0.08;
    }
  }
  if (hasImageEvidenceNeed(query) && (result.images ?? []).some((image) => isClinicalImageEvidence(image)))
    score += 0.05;
  if (wantsSourceImage && hasSourceImageEvidence) score += 0.14;
  if (wantsSourceImage && !hasSourceImageEvidence) score -= 0.08;
  if (
    wantsSourceImage &&
    /\bclozapine\b/i.test(query) &&
    /\b(?:anc|neutrophil)\b/i.test(query) &&
    hasSourceImageEvidence &&
    /\bclozapine\b/.test(haystack) &&
    /\b(?:anc|neutrophil)\b/.test(haystack)
  ) {
    score += 0.16;
  }
  if (
    /\bflow\s*chart|flowchart|matrix|red\s*zone\b/i.test(query) &&
    /\bflow\s*chart|flowchart|matrix|red\s*zone|risk\b/i.test(haystack)
  )
    score += 0.07;
  if (
    /\b(?:risk|red\s*zone|red|urgent|escalat(?:e|es|ed|ing|ion|ions))\b/i.test(query) &&
    /\bflow\s*chart|flowchart|algorithm|matrix\b/i.test(haystack)
  ) {
    if (/\b(?:risk|red\s*zone|red|urgent|escalat(?:e|es|ed|ing|ion|ions))\b/i.test(haystack)) score += 0.14;
    else score -= 0.05;
  }
  if (/\bpatient safety plan\b/i.test(query) && /\bpatient safety plan\b/.test(titleText)) score += 0.18;
  if (
    /\bclozapine\b/i.test(query) &&
    /\b(?:anc|fbc|withhold|cease|stop|threshold|monitoring?)\b/i.test(query) &&
    /\bclozapine prescribing administration (?:and )?monitoring\b/.test(titleText)
  ) {
    score += 0.45;
  }
  if (/\badmission\b/i.test(query) && /\bdischarge\b/i.test(query) && /\badmission\b/.test(titleText)) score += 0.08;
  if (
    /\badmission\b/i.test(query) &&
    /\bcommunity\b/i.test(query) &&
    /\bpatients?\b/i.test(query) &&
    /\badmission of community patient/.test(titleText)
  )
    score += 0.32;
  if (/\badmission\b/i.test(query) && /\bdischarge\b/i.test(query) && /\badmission\b/.test(titleText)) score += 0.08;
  if (
    /\badmission\b/i.test(query) &&
    /\bdischarge\b/i.test(query) &&
    /\badmission of community patient/.test(titleText)
  )
    score += 0.22;
  if (/\badmission\b/i.test(query) && /\bdischarge\b/i.test(query) && /\bdischarge\b/.test(titleText)) score += 0.04;
  if (
    /\bdischarge\b/i.test(query) &&
    /\b(?:summari[sz]e|summary|guidance|documentation?|include|required)\b/i.test(query) &&
    /\bdischarge\b/.test(titleText)
  )
    score += 0.28;

  return roundScore(score);
}

/** Rank clinical results. */
export function rankClinicalResults(query: string, results: SearchResult[]) {
  const intent = classifyQueryIntent(query);
  const wantsImageEvidence = hasImageEvidenceNeed(query) || intent.imageEvidenceFocus;
  const ranked = [...results]
    .map((result) => {
      const explanation = clinicalRankExplanation(query, result);
      const hasImageEvidence = (result.images ?? []).some((image) => isClinicalImageEvidence(image));
      const imageEvidencePenalty = wantsImageEvidence && !hasImageEvidence ? -0.04 : 0;
      const tieBreakScore = rankingTieBreakScore(query, result, explanation);
      // Fold the existing engineered relevance tiebreak into the unbounded ordering signal. The
      // confidence contract remains the pre-existing clamped evidence score; a ranking-only
      // discriminator must not overstate confidence.
      const rankScore = explanation.rankScore + imageEvidencePenalty + tieBreakScore;
      const finalScore = clamp(explanation.rankScore + imageEvidencePenalty);
      return {
        result,
        explanation: {
          ...explanation,
          penalty: roundScore(explanation.penalty + imageEvidencePenalty),
          rankScore: roundScore(rankScore),
          finalScore: roundScore(finalScore),
          preClampFinalScore: roundScore(rankScore),
          fusionSignals: explanation.fusionSignals
            ? {
                ...explanation.fusionSignals,
                fixedAdjustment: roundScore(explanation.fusionSignals.fixedAdjustment + imageEvidencePenalty),
              }
            : undefined,
        },
        rankScore,
        tieBreakScore,
      };
    })
    // Final `id` comparison is a stable, deterministic tiebreak so fully-tied results no longer order
    // by arbitrary retrieval order (a residual run-to-run nondeterminism); it fires only after every
    // meaningful signal has tied, so it never wastes the boost/relevance engineering above it.
    .sort(
      (a, b) =>
        b.rankScore - a.rankScore ||
        b.result.similarity - a.result.similarity ||
        a.result.id.localeCompare(b.result.id),
    )
    .map((entry, index) => ({
      ...entry.result,
      score_explanation: {
        ...entry.explanation,
        finalRank: index + 1,
        preClampFinalScore: roundScore(entry.rankScore),
      },
    }));

  return ranked;
}
