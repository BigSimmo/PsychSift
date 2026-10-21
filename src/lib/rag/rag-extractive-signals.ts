// Query and evidence signals for the extractive answer: escalation, answer-intent figures, dose and
// monitoring evidence, extractive text quality and clinical sentence splitting. Moved unchanged out
// of rag-extractive-answer.ts to keep that module within its maintainability budget.

import { extractClinicalValueAtoms } from "@/lib/answer-verification";
import { classifyRagQuery, normalizedClinicalSearchTokens } from "@/lib/clinical-search";
import { hasBoundMonitoringCadence as deliveredMonitoringFrequencyPresent } from "@/lib/evidence-relevance";
import { hasForeignMedicationClinicalValueBinding, medicationEntitiesInText } from "@/lib/medication-entities";
import { evidenceTextForGate } from "@/lib/rag/rag-answer-support";
import { hasClinicalAnswerQualityIssue, looksLikeJsonArtifact, normalizeSectionText } from "@/lib/rag/rag-answer-text";
import {
  normalizeInlineBulletGlyphs,
  sourceTextForClinicalProse,
  sourceTextForClinicalProsePreservingBreaks,
} from "@/lib/source-text-sanitizer";
import { type RagQueryClass, type SearchResult } from "@/lib/types";
import {
  reflowBoundedSourceLines,
  reflowWrappedAgitationDoseLines,
  reflowWrappedEctBookingSystemLines,
  reflowWrappedEscalationRecipientLines,
} from "@/lib/rag/rag-source-segmentation";
import { containsDanglingProceduralComparatorStepArtifact } from "@/lib/rag/rag-extractive-artifacts";
import {
  classifyAnswerIntent,
  isMonitoringLevelRangeLookupQuery,
  type AnswerIntent,
} from "@/lib/rag/rag-answer-intent";

export type ExtractedClinicalFactKind =
  | "bottom_line"
  | "dose"
  | "renal_limit"
  | "monitoring"
  | "threshold_action"
  | "contraindication"
  | "pathway_referral"
  | "caveat";

export type ExtractedClinicalFact = {
  kind: ExtractedClinicalFactKind;
  text: string;
  citationChunkIds: string[];
  priority: number;
};

const extractiveLabelPattern =
  /\b(?:Medication point|Table evidence|Threshold\/action|Risk\/escalation|Workflow step|Section summary|Source point|Dose detail|Monitoring)\s*:\s*/gi;

// Structural labels that are pure boilerplate — never merged into a
// following fragment and never rewritten into "For <label>, …". Clinical
// headings that happen to share a word are exempt: "Source control"
// (infection-source management) and "Reference range/interval" (lab values)
// are evidence, not provenance or bibliography labels.
// "section" is anchored to the label start so structural "Section 2:" is
// excluded while clinical phrases like "Caesarean section:" merge normally.
const structuralHeadingStoplistPattern =
  /\b(?:source(?!\s+control\b)|table|figure|page|summary|example|appendix|reference(?!\s+(?:range|interval)s?\b)|contents)\b|^\s*section\b/i;

// Advisory labels ("Caution:", "Warning:") classify the fact that follows as
// a caveat — they merge with their bullet items like directive headings do,
// but keep their colon form instead of becoming "For caution, …".
const advisoryHeadingPattern = /\b(?:note|warning|caution|important|nb)\b/i;

// Headings that carry the clinical action themselves ("Do not use:",
// "Avoid:"). These must merge with their bullet items — the item alone often
// lacks the verb ("Pregnancy") — but must keep their colon form instead of
// being rewritten into noun context ("For avoid, pregnancy").
const directiveHeadingPattern =
  /\b(?:avoid|do|does|not|use|stop|cease|withhold|hold|discontinue|monitor|check|give|administer|contraindicat\w*|must|should|review|refer|contact|seek|consider|is|are|was|were)\b/i;

// A leading section heading carried into a fact ("Acute Mania: 750mg…")
// becomes readable context ("For acute mania, 750mg…") instead of a colon
// fragment glued mid-sentence. All-caps tokens (acronyms like "IR") keep
// their casing, so labels containing one are left for the dose rewrite below.
const leadingHeadingContextPattern = /^([A-Z][A-Za-z]+(?:[ /-][A-Za-z()]+){0,3}):\s+(?=\S)/;

// "Label: <dose>" reads as "Label is <dose>" only when the colon is directly
// followed by a numeric dose ("IR product: 750 to 1000mg" → "IR product is
// 750 to 1000mg"); prose labels without a dose keep their colon. A label
// ending in a preposition/verb particle is not a heading — "reduce dose to:
// 500mg" must not become "reduce dose to is 500mg".
const doseLabelColonPattern =
  /([A-Za-z][\w-]*(?:\s+[\w-]+){0,3})(?<!\b(?:to|by|at|of|in|on|with|into|onto|towards|per|over|under|from)):\s+(?=\d[^:]{0,24}?(?:mg|mcg|microg|m[lL]|units?|mmol|g)\b)/g;

function rewriteLeadingHeadingContext(value: string) {
  return value.replace(leadingHeadingContextPattern, (match, label: string) => {
    if (structuralHeadingStoplistPattern.test(label)) return match;
    if (advisoryHeadingPattern.test(label)) return match;
    if (directiveHeadingPattern.test(label)) return match;
    if (/\b[A-Z]{2,}s?\b/.test(label)) return match;
    return `For ${label.toLowerCase()}, `;
  });
}

/** Clean extractive point text. */
export function cleanExtractivePointText(value: string) {
  const rewritten = normalizeInlineBulletGlyphs(sourceTextForClinicalProse(value))
    // Preserve standalone clinical analytes whose digits are part of the name,
    // not a PDF footnote suffix. The attached-reference cleaner below still
    // removes prose/unit markers such as "Tests1" and "mmol/L1,5".
    .replace(/\bT3\b/g, "THREECLINICALTHYROIDTOKEN")
    .replace(/\bT4\b/g, "FOURCLINICALTHYROIDTOKEN")
    .replace(/\bB12\b/g, "TWELVECLINICALVITAMINTOKEN")
    .replace(/\b(?:clinical_table|table_crop|diagram_crop)\b/gi, " ")
    .replace(
      /^(?:clinical\s+)?table\s+(?:showing|detailing|listing|outlining|describing)\b.*?:\s*(?=\b(?:if|when|for|cease|stop|withhold|contact|repeat|monitor|clozapine)\b)/i,
      "",
    )
    .replace(
      /^[A-Z][A-Za-z /-]{3,80}:\s*(?=\b(?:if|when|for|cease|stop|withhold|contact|repeat|monitor|clozapine)\b)/,
      "",
    )
    .replace(extractiveLabelPattern, " ")
    .replace(/^[\s\-•:]+/, "")
    .replace(/^(?:monitoring|dose|dosing|source|section|table|guideline)\s*[.;:,-]\s*/i, "")
    .replace(/([A-Za-z)])\d{1,2}(?:,\s*\d{1,2})*(?=(?:[.;]|\s|$))/g, "$1")
    .replace(/\s+[•]\s+/g, ". ")
    .replace(
      /\s+-\s+(?=[A-Z][a-z])|(?:\s+-\s*)?(?:Medication point|Table evidence|Threshold\/action|Risk\/escalation|Workflow step|Section summary|Source point)\s*:\s*/gi,
      ". ",
    )
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/(?:\.\s*){2,}/g, ". ")
    .trim()
    .replace(/THREECLINICALTHYROIDTOKEN/g, "T3")
    .replace(/FOURCLINICALTHYROIDTOKEN/g, "T4")
    .replace(/TWELVECLINICALVITAMINTOKEN/g, "B12");
  // Directive/advisory labels keep their colon — "Avoid: 12.5 mg…" must not
  // become the noun-label sentence "Avoid is 12.5 mg…".
  return rewriteLeadingHeadingContext(rewritten).replace(doseLabelColonPattern, (match, label: string) =>
    directiveHeadingPattern.test(label) || advisoryHeadingPattern.test(label) ? match : `${label} is `,
  );
}

export const extractiveClinicalDirectivePattern =
  /\b(?:arrange|assess|cease|check|complete|contact|continue|discontinue|discontinued|escalate|notify|prescribe|record|refer|report|review|stop|withhold|must|required|requires?|should)\b/i;

const extractiveQueryStopwords = new Set([
  "a",
  "an",
  "and",
  "after",
  "are",
  "about",
  "be",
  "before",
  "by",
  "can",
  "do",
  "does",
  "for",
  "from",
  "how",
  "in",
  "is",
  "it",
  "of",
  "often",
  "on",
  "or",
  "post",
  "prior",
  "the",
  "to",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "should",
  "dose",
  "dosing",
  "dosage",
  "medication",
  "medicine",
  "monitoring",
  "monitor",
  "baseline",
  "tests",
  "result",
  "results",
  "pathway",
  "referral",
  "patient",
  "patients",
  "required",
  "requires",
  "clinical",
  "advice",
  "contraindication",
  "contraindications",
  "documents",
  "document",
  "support",
  "supports",
  "supported",
  "sources",
  "source",
  "guidance",
  "guideline",
  "guidelines",
  "please",
]);

const answerIntentTerms = new Set([
  "action",
  "actions",
  "avoid",
  "contraindicated",
  "contraindication",
  "contraindications",
  "criteria",
  "dose",
  "doses",
  "dosing",
  "dosage",
  "escalate",
  "escalated",
  "escalates",
  "escalating",
  "escalation",
  "escalations",
  "maximum",
  "max",
  "monitor",
  "monitors",
  "monitoring",
  "pathway",
  "refer",
  "referral",
  "renal",
  "result",
  "results",
  "required",
  "requires",
  "schedule",
  "threshold",
  "thresholds",
  "what",
]);

const explicitEscalationQueryPattern = /\bescalat\w*\b/i;

const escalationClinicalTargetSource = String.raw`(?:the\s+)?(?:(?:treating|responsible|senior|on[-\s]?call)\s+(?:doctor|clinician|medical\s+officer|prescriber)|(?:treating|responsible|senior|on[-\s]?call|medical|clinical)\s+team|prescriber)`;

const escalationNormativeSource = String.raw`(?:must|should|needs?\s+to|is\s+to|are\s+to|required\s+to)`;

const escalationActionAdverbSource = String.raw`(?:(?:promptly|urgently|immediately|directly|also|then)\s+){0,2}`;

const escalationContactPassiveVerbSource = String.raw`(?:contacted|notified|informed|consulted)`;

const escalationContactActionSource = String.raw`(?:(?:contact|notify|inform|consult)\s+${escalationClinicalTargetSource}|report(?:\s+(?:the\s+)?(?:findings?|results?|concerns?|side effects?))?\s+to\s+${escalationClinicalTargetSource})`;

const normativeEscalationActionPattern = new RegExp(
  String.raw`(?:^\s*(?:\*{1,2})?escalate\b|(?:^|[,;:]\s*)(?:please\s+)?escalate\b|\b${escalationNormativeSource}\s+${escalationActionAdverbSource}(?:be\s+)?escalat(?:e|ed)\b|\brequires?\s+(?:prompt|urgent|immediate)?\s*escalation\b|\bescalation\b[^.;!?\n]{0,20}\b(?:is|remains)\s+(?:required|needed|indicated)\b)`,
  "i",
);

const normativeEscalationContactPattern = new RegExp(
  String.raw`(?:(?:^|[,;:]\s*)(?:please\s+)?${escalationContactActionSource}\b|\b${escalationNormativeSource}\s+${escalationActionAdverbSource}${escalationContactActionSource}\b|\b${escalationClinicalTargetSource}\b\s+${escalationNormativeSource}\s+${escalationActionAdverbSource}(?:be\s+)?${escalationContactPassiveVerbSource}\b)`,
  "i",
);

const normativeEscalationReviewPattern = new RegExp(
  String.raw`(?:\b${escalationNormativeSource}\s+${escalationActionAdverbSource}(?:be\s+)?reviewed\s+by\s+${escalationClinicalTargetSource}\b|\b${escalationClinicalTargetSource}\b\s+${escalationNormativeSource}\s+${escalationActionAdverbSource}review\b|\brequires?\s+(?:an?\s+)?(?:urgent|prompt)\s+(?:medical|clinical)\s+review\b|\b(?:urgent|prompt)\s+(?:medical|clinical)\s+review\b[^.;!?\n]{0,20}\b(?:(?:is|remains)\s+(?:required|needed|indicated)|required|needed)\b)`,
  "i",
);

const negatedEscalationActionPattern =
  /\b(?:do\s+not|don't|should\s+not|must\s+not|need\s+not|never|not\s+required\s+to)\b[^.;!?\n]{0,35}\b(?:escalat\w*|contact|notify|inform|consult|report|review)\b/i;

const escalationInterrogativePattern =
  /^\s*(?:when|what|which|who|why|how|under\s+what|at\s+what)\b[^.!?\n]{0,180}\b(?:escalat\w*|contact|notify|inform|consult|report|review)\b(?:[^.!?\n]*\?)?\s*$/i;

export const strongHistoricalEscalationCuePattern =
  /(?:\b(?:audit|retrospective|case\s+review|incident\s+report|minutes?|case\s+notes?|historical|study|survey)\b|\b(?:previous|prior|earlier|former|superseded|obsolete|archived|old|withdrawn|legacy|retired|repealed|discontinued|outdated)\s+(?:clinical\s+)?(?:policy|guideline|protocol|guidance|procedure|recommendations?|standards?|pathway|instructions?)\b|\b(?:19|20)\d{2}\b[^.;!?\n]{0,80}\b(?:policy|guideline|protocol|guidance|procedure|recommendations?|standards?|pathway|instructions?)\b[^.;!?\n]{0,40}\b(?:stated|recommended|required|directed|specified)\b)/i;

export const reportedEscalationWrapperPattern =
  /(?:\baccording\s+to\b[^.;!?\n]{0,80}\b(?:audit|record|report|review|study|survey|minutes?|case\s+notes?)\b|\b(?:was|were|is|are|has\s+been|had\s+been)\s+(?:recorded|reported|documented|noted|found|observed|described|stated|indicated)\b|\b(?:record|report|review|case\s+notes?)\b[^.;!?\n]{0,80}\b(?:recorded|reported|documented|noted|found|observed|described|stated|indicated|records|reports|states|notes|describes)\b)/i;

export const staleEscalationProvenancePattern =
  /\b(?:previous|prior|earlier|former|superseded|obsolete|archived|old|withdrawn|legacy|retired|repealed|discontinued|outdated)\b/i;

const escalationTriggerPattern =
  /(?:\b(?:when(?:ever)?|if|unless)\b[^,;.!?]{0,100}\b(?:side effects?|symptoms?|reaction|rash|toxicity|scores?|results?|distress|syndrome)\b|\b(?:side effects?|symptoms?|reaction|rash)\b[^.;!?]{0,60}\bcaus(?:e|es|ed|ing)\b[^.;!?]{0,30}\bdistress\b|\bcaus(?:e|es|ed|ing)\s+(?:the\s+patient\s+)?distress\b|\b(?:persistent|severe|worsening|suspected)\s+(?:(?:neuroleptic|antipsychotic|medication)\s+)?(?:side effects?|symptoms?|reaction|rash|toxicity|syndrome)\b|\b(?:side effects?|symptoms?|reaction|rash|toxicity|syndrome)\b[^.;!?]{0,40}\b(?:persist(?:s|ed|ent|ing)?|severe|worsen(?:s|ed|ing)?|suspected)\b|\b(?:any|new)\s+(?:neuroleptic\s+)?(?:side effect|reaction|rash)\b|\b(?:at|above|below|over|under|with)\s+(?:an?\s+)?(?:score|result|threshold)\b|\b(?:high|very\s+high|red|amber)\s+(?:score|result|range|threshold)\b|\b(?:on|upon)\s+(?:the\s+)?(?:emergence|development|appearance|onset)\s+of\s+(?:side effects?|symptoms?|a\s+reaction|a\s+rash|toxicity)\b)/i;

const scoreIndependentActionPattern =
  /(?:\bscor(?:e|es|ed|ing)\b[^.!?]{0,120}\bnot\s+essential\b[^.!?]{0,80}\bactions?\b|\bactions?\b[^.!?]{0,100}\b(?:do|does)\s+not\s+depend\b[^.!?]{0,80}\bscor(?:e|es|ed|ing)\b)/i;

/** Whether the query explicitly asks for escalation. */
export function isExplicitEscalationQuery(query: string) {
  return explicitEscalationQueryPattern.test(query.replace(/\bde[-\s]?escalat\w*/gi, ""));
}

const escalationEquivalentClinicalSubjectPattern =
  /\b(?:neuroleptics?|antipsychotics?|medications?|side effects?|symptoms?|reactions?|toxicity|scores?|results?)\b/i;

const escalationEquivalentClinicalActionPattern = new RegExp(
  String.raw`(?:\b(?:contact|notifi|inform|consult|report)\w*\b[^.!?\n]{0,120}\b${escalationClinicalTargetSource}\b|\b${escalationClinicalTargetSource}\b[^.!?\n]{0,80}\b(?:contact|notifi|inform|consult|report)\w*\b)`,
  "i",
);

export function requiresClinicalEscalationFallbackSafety(query: string) {
  const positiveQuery = query.replace(/\bde[-\s]?escalat\w*/gi, "");
  return (
    explicitEscalationQueryPattern.test(positiveQuery) ||
    (escalationEquivalentClinicalSubjectPattern.test(positiveQuery) &&
      escalationEquivalentClinicalActionPattern.test(positiveQuery))
  );
}

/** Whether prose contains a direct escalation action or a bounded clinical equivalent. */
export function hasTargetedEscalationAction(text: string) {
  const positiveEscalationText = text.replace(/\bde[-\s]?escalat\w*/gi, "");
  const historicalOrReported =
    strongHistoricalEscalationCuePattern.test(positiveEscalationText) ||
    reportedEscalationWrapperPattern.test(positiveEscalationText);
  if (
    negatedEscalationActionPattern.test(positiveEscalationText) ||
    escalationInterrogativePattern.test(positiveEscalationText) ||
    /\?\s*$/.test(positiveEscalationText) ||
    historicalOrReported
  ) {
    return false;
  }
  return (
    normativeEscalationActionPattern.test(positiveEscalationText) ||
    normativeEscalationContactPattern.test(positiveEscalationText) ||
    normativeEscalationReviewPattern.test(positiveEscalationText)
  );
}

/** Whether prose states the condition that triggers escalation. */
export function hasEscalationTrigger(text: string) {
  return escalationTriggerPattern.test(text);
}

/** Source context explaining that action does not depend on a score. */
export function isScoreIndependentActionEvidence(text: string) {
  return scoreIndependentActionPattern.test(text);
}

/** Whether an escalation query asks for the condition that should trigger the action. */
export function asksForEscalationTrigger(query: string) {
  const normalized = normalizeSectionText(query);
  return (
    /\bwhen\b/i.test(normalized) ||
    /\bwhich\b[^?]{0,100}\b(?:side effects?|symptoms?|reactions?|results?|scores?|conditions?|circumstances?)\b/i.test(
      normalized,
    ) ||
    /\bwhat\b[^?]{0,100}\b(?:triggers?|requires?|warrants?)\b[^?]{0,60}\bescalat\w*\b/i.test(normalized) ||
    /\b(?:escalation|escalat\w*)\s+criteria\b|\bcriteria\b[^?]{0,80}\bescalat\w*\b/i.test(normalized) ||
    /\b(?:conditions?|circumstances?|indications?)\b[^?]{0,80}\bescalat\w*\b/i.test(normalized)
  );
}

/** Query entity tokens. */
export function queryEntityTokens(query: string, intent: AnswerIntent) {
  const tokens = extractiveQueryTokens(query).filter((token) => !answerIntentTerms.has(token));
  if (intent === "document_lookup") return tokens.filter((token) => token.length > 3);
  return tokens;
}

const monitoredMedicineClassPattern =
  /\b(?:antipsychotics?|antidepressants?|mood\s+stabili[sz]ers?|psychostimulants?|stimulants?|benzodiazepines?|psychotropics?)\b/i;

export function queryEntitySubject(query: string, intent: AnswerIntent) {
  const tokens = queryEntityTokens(query, intent);
  if (tokens.includes("agitation") && tokens.includes("arousal")) return "agitation and arousal";
  // Monitoring facets and verbs ("risk", "used") are not the medication being
  // monitored. Prefer the one explicit medicine over the first residual token.
  const medicines = medicationEntitiesInText(query);
  if (intent === "monitoring_schedule" && medicines.length === 1) return medicines[0];
  // A medicine class is not a medicine entity, so "What metabolic monitoring is required for
  // antipsychotics?" used to print "For metabolic, …" (#J8SJQ9). The class is the subject.
  const medicineClass =
    intent === "monitoring_schedule" && !medicines.length && monitoredMedicineClassPattern.exec(query);
  if (medicineClass) return medicineClass[0].toLowerCase();
  // A leading verb ("prescribe", "make") is never the subject. When the query
  // names a medicine, use it rather than printing "For prescribe, …" (#ZZ4RAP).
  if (
    medicines.length > 0 &&
    tokens[0] &&
    !medicines.includes(tokens[0]) &&
    !medicationEntitiesInText(tokens[0]).length
  )
    return medicines[0];
  return tokens[0];
}

/** Unique answer tokens. */
function uniqueAnswerTokens(tokens: string[]) {
  return Array.from(new Set(tokens.filter(Boolean)));
}

/** Query intent tokens. */
export function queryIntentTokens(query: string, intent: AnswerIntent) {
  const tokens = extractiveQueryTokens(query).filter((token) => answerIntentTerms.has(token));
  if (intent === "dose" && /\b(?:renal|egfr|creatinine|kidney)\b/i.test(query))
    return uniqueAnswerTokens(["renal", ...tokens]);
  if (intent === "dose" && /\bmax(?:imum)?\b/i.test(query)) return uniqueAnswerTokens(["maximum", ...tokens]);
  if (intent === "monitoring_schedule") return uniqueAnswerTokens(["monitoring", ...tokens]);
  if (intent === "red_result_action")
    return uniqueAnswerTokens(["red", "range", "blood", "result", "results", "threshold", "action", ...tokens]);
  // An interaction question ("ibuprofen for someone on lithium") is answered by
  // avoid-the-combination prose that never says "contraindication" (#ZZ4RAP).
  if (intent === "contraindication" && medicationEntitiesInText(query).length >= 2)
    return uniqueAnswerTokens(["contraindication", "avoid", "combination", "together", ...tokens]);
  if (intent === "contraindication") return uniqueAnswerTokens(["contraindication", ...tokens]);
  if (intent === "pathway_referral") return uniqueAnswerTokens(["referral", "criteria", ...tokens]);
  return tokens;
}

// Shared monitoring-schedule evidence vocabulary. The answer-intent gate
// (answerIntentEvidencePattern) and the fact filter (factSupportsAnswerIntent)
// must accept the same schedule/parameter language: the run-#60 targeting
// misses came from range, metabolic-panel, and inflected-schedule sentences
// ("reviewed annually", "monitored for 3 hours", "Maintenance range
// 0.6-0.8 mmol/L") passing the filter but dying at the narrower gate.
// Inflections match by prefix (monitor\w*), acronyms accept plurals, and bare
// digit durations ("at 12 weeks") count as schedule evidence.
const monitoringScheduleEvidenceSource = String.raw`monitor\w*|follow[-\s]?up|baseline|weekly|monthly|annual(?:ly)?|yearly|every|several\s+times\s+a\s+year|screen(?:ing|ed)?|levels?|blood tests?|bloods|fbcs?|ancs?|wbcs?|ecgs?|lfts?|renal|thyroid|metabolic|glucose|bsl|lipids|cholesterol|triglycerides|blood pressure|bp|pulse|weight|bmi|mmol\/l|mcg\/l|ng\/ml|range|target|therapeutic|maintenance|review\w*|\d+\s*(?:week|month|day|hour|year)s?`;

export const monitoringScheduleEvidencePattern = new RegExp(
  String.raw`\b(?:${monitoringScheduleEvidenceSource})\b`,
  "i",
);

// The strict subset of the monitoring vocabulary that is an actual cadence or
// level signal: dose-kind facts must carry one of these before they count as
// monitoring evidence, so generic dose wording (range/therapeutic/maintenance
// around a mg figure) cannot masquerade as a schedule.
/**
 * A policy's own administration rather than the clinical monitoring it governs: its
 * "Compliance, monitoring and evaluation" section, audit-of-this-policy text, and glossary
 * rows ("Metabolic Screen An evidence-based process for…"). The monitoring vocabulary in them
 * passes the schedule check, so without this the governance heading led the metabolic
 * monitoring answer (#J8SJQ9, Eval Canary 39614340500).
 */
export const policyAdministrationSentencePattern =
  /\b(?:compliance,?\s+monitoring\s+and\s+evaluation|compliance\s+(?:against|with)\s+this\s+(?:policy|procedure|guideline|protocol)|the\s+following\s+definitions\s+are\s+relevant|term\s+definition)\b/i;

export const glossaryEntrySentencePattern =
  /^\s*(?:[A-Z][\w’'-]*\s+){1,4}An?\s+(?:evidence[-\s]based\s+)?(?:process|tool|method|framework|document)\s+(?:for|to|that|used)\b/;

export const monitoringCadenceOrLevelPattern = new RegExp(
  String.raw`\b(?:monitor\w*|follow[-\s]?up|baseline|weekly|monthly|annual(?:ly)?|yearly|every|several\s+times\s+a\s+year|screen(?:ing|ed)?|review\w*|levels?|serum|trough|plasma|mmol\/l|mcg\/l|ng\/ml|\d+\s*(?:week|month|day|hour|year)s?)\b`,
  "i",
);

// Level/concentration ranges only, for the monitoring intent COVERAGE escapes:
// dose-amount unit ranges ("300-450 mg") must not grant coverage — the wider
// monitoringUnitRangeFigurePattern (which also matches mg/mcg dose ranges)
// stays reserved for the corpus-guarded figure-promotion checks.
export const monitoringLevelRangeCoveragePattern =
  /(?:\bbetween\s+\d+(?:\.\d+)?\s+and\s+\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:[-–—]|\bto\b)\s*\d+(?:\.\d+)?)\s*(?:mmol\/L|nmol\/L|mcg\/L|ng\/mL)/i;

/** Answer intent evidence pattern. */
export function answerIntentEvidencePattern(intent: AnswerIntent) {
  switch (intent) {
    case "dose":
      return doseIntentEvidencePattern;
    case "contraindication":
      return /\b(?:contraindicat\w*|avoid|must not|do not|should not|not use|opioid[-\s]?free|withdrawal|precipitat\w*)\b/i;
    case "monitoring_schedule":
      return monitoringScheduleEvidencePattern;
    case "red_result_action":
      return /\b(?:red|amber|green|threshold|withhold|cease|stop|discontinue|discontinued|urgent|contact|repeat|review|anc|fbc|wbc|neutrophil|toxic\w*|action|patholog\w*|haematolog\w*|hematolog\w*)\b/i;
    case "pathway_referral":
      return /\b(?:pathway|refer|referral|criteria|indicat\w*|ect|electroconvulsive|specialist|psychiat\w*)\b/i;
    case "document_lookup":
      return /\b(?:document|guideline|procedure|policy|protocol|form|source|file|support|supports|covers|contains)\b/i;
    default:
      return /\b(?:assess|arrange|check|collaborat\w*|complete|conduct|continue|develop|diagnos\w*|document|dose|ensure|identify|include|incorporate|involve|link|manage|monitor|provide|record|refer|revise|review\w*|risk|share|therapy|treat|update)\b/i;
  }
}

const clinicalDoseUnitSource = String.raw`(?:mg|milligrams?|mcg|micrograms?|g|grams?|kg|kilograms?|ml|millilit(?:er|re)s?|l|lit(?:er|re)s?|international\s+units?|units?|iu|mmol(?:\/l)?|millimoles?(?:\s+per\s+lit(?:er|re))?|meq|milliequivalents?|tablets?|capsules?|puffs?|drops?|sprays?|patch(?:es)?)`;

const clinicalDoseValueSource = String.raw`\d+(?:\.\d+)?\s*${clinicalDoseUnitSource}`;

const clinicalDoseValuePattern = new RegExp(String.raw`\b${clinicalDoseValueSource}\b`, "i");

const maximumDoseEquivalentPattern = new RegExp(
  String.raw`\b(?:up\s+to|(?:do\s+)?not\s+exceed|not\s+to\s+exceed|(?:no|not)\s+more\s+than|at\s+most|limit(?:ed)?(?:\s+the\s+dose)?\s+to)\s+${clinicalDoseValueSource}\b`,
  "i",
);

const explicitMaximumDosePattern = new RegExp(
  String.raw`(?:\bmax(?:imum)?(?:\s+\w+){0,3}\s+doses?\b|\bdoses?(?:\s+\w+){0,3}\s+max(?:imum)?\b|\bmax(?:imum)?(?:\s+\w+){0,3}\s+${clinicalDoseValueSource}\b|\b${clinicalDoseValueSource}(?:\s+\w+){0,3}\s+max(?:imum)?\b)`,
  "i",
);

const doseIntentEvidencePattern = new RegExp(
  String.raw`\b(?:doses?|dosing|dosage|${clinicalDoseUnitSource}|eGFR|renal|creatinine|daily|bd|tds|mane|nocte)\b`,
  "i",
);

// Interval/schedule tokens that make a monitoring fact carry its asked-for
// schedule ("baseline", "annually", "every 3", "6 months"), plus unit-bearing
// level ranges ("0.6-0.8 mmol/L") for target-level monitoring answers.
// Alternation order is load-bearing: "every N unit" must precede bare
// "every N" so exec() returns the full schedule, not a truncated "every 6".
// Digit+unit intervals also yield value atoms, so atom identity catches
// unit mismatches today — the full match keeps the promotion guard's
// verbatim-corpus fallback equally honest if that coverage ever drifts.
export const monitoringIntervalFigurePattern =
  /\b(?:baseline|weekly|monthly|annual(?:ly)?|every\s+\d+\s*(?:week|month|day|hour|year)s?|every\s+\d+|\d+\s*(?:week|month|day|hour|year)s?)\b/i;

const monitoringUnitRangeFigurePattern =
  /(?:\bbetween\s+\d+(?:\.\d+)?\s+and\s+\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:[-–—]|\bto\b)\s*\d+(?:\.\d+)?)\s*(?:mmol\/L|mg|micrograms?|nmol\/L|mcg)/i;

/**
 * Whether extracted fact text carries the figure/schedule the intent asks for:
 * a concrete dose value (or equivalent maximum-dose wording) for dose intent,
 * an interval/schedule token or unit-bearing level range for monitoring intent,
 * or an atomic blood-count boundary/action for an explicit threshold request.
 */
export function factCarriesIntentFigure(intent: AnswerIntent, text: string, query?: string) {
  return intentFigureMatchText(intent, text, query) !== null;
}

/** The matched figure substring for the intent, or null — lets the promotion
 * guard verify a zero-atom figure (e.g. "every 6 weeks") verbatim in the
 * claim-support corpus rather than trusting it atom-free. */
export function intentFigureMatchText(intent: AnswerIntent, text: string, query?: string) {
  if (
    intent === "red_result_action" &&
    query &&
    asksForBloodCountThreshold(query) &&
    hasAtomicBloodCountWithholdThresholdEvidence(text, query)
  ) {
    return extractClinicalValueAtoms(text).find((atom) => atom.comparator)?.rawText ?? null;
  }
  if (intent === "dose") {
    return clinicalDoseValuePattern.exec(text)?.[0] ?? maximumDoseEquivalentPattern.exec(text)?.[0] ?? null;
  }
  if (intent === "monitoring_schedule") {
    if (query && isMonitoringLevelRangeLookupQuery(query)) {
      return monitoringUnitRangeFigurePattern.exec(text)?.[0] ?? null;
    }
    return monitoringIntervalFigurePattern.exec(text)?.[0] ?? monitoringUnitRangeFigurePattern.exec(text)?.[0] ?? null;
  }
  return null;
}

/**
 * Whether an extractive answer's text carries the asked-for figure for a
 * figure-seeking query (dose, monitoring schedule or blood-count threshold). Used by the
 * generation-fallback candidate preference in rag.ts so a safe single-chunk
 * candidate that states the requested figure wins over an equally safe
 * figure-less candidate. Non-figure intents return false, leaving the
 * existing first-safe-candidate behaviour untouched.
 */
export function extractiveAnswerCarriesIntentFigure(answerText: string, query: string, queryClass: RagQueryClass) {
  const intent = classifyAnswerIntent(query, queryClass);
  return factCarriesIntentFigure(intent, answerText.replace(/\*\*/g, ""), query);
}

export function asksForBloodCountThreshold(query: string) {
  return requiresBloodCountEvidence(query) && /\b(?:threshold|cut[- ]?off|what\s+(?:value|count|level))\b/i.test(query);
}

/** Requires blood count evidence. */
export function requiresBloodCountEvidence(query: string) {
  return /\b(?:anc|fbc|full blood count|blood count|wbc|wcc|white blood cells?|white cells?|neutrophils?)\b/i.test(
    query,
  );
}

/** Asks for withhold action. */
export function asksForWithholdAction(query: string) {
  return /\b(?:withhold|withheld|withholding|hold|held|cease|stop|stopped|discontinue|discontinued)\b/i.test(query);
}

/** Has blood count evidence. */
export function hasBloodCountEvidence(text: string) {
  return /\b(?:anc|fbc|full blood count|wbc|wcc|white blood cell|white cell|neutrophil|neutrophils|blood count)\b/i.test(
    text,
  );
}

/** Has withhold action evidence. */
export function hasWithholdActionEvidence(text: string) {
  return /\b(?:withhold|withheld|withholding|hold|held|cease|stop|stopped|discontinue|discontinued)\b/i.test(text);
}

/** Same-fact blood-count boundary plus an explicit treatment-stop action. */
export function hasAtomicBloodCountWithholdThresholdEvidence(text: string, query: string) {
  const hasThresholdBoundary =
    /(?:\b(?:below|under|less than|at or below)\s+\d|(?:<|≤)\s*\d|\b(?:red|amber)\s+range\b)/i.test(text);
  const namesQueriedMedication = !/\bclozapine\b/i.test(query) || /\bclozapine\b/i.test(text);
  return (
    hasBloodCountEvidence(text) && hasThresholdBoundary && hasWithholdActionEvidence(text) && namesQueriedMedication
  );
}

/** Has explicit or equivalent maximum-dose evidence. */
export function hasMaximumDoseEvidence(text: string) {
  return explicitMaximumDosePattern.test(text) || maximumDoseEquivalentPattern.test(text);
}

/** Result covers answer intent. */
export function resultCoversAnswerIntent(result: SearchResult, query: string, intent: AnswerIntent) {
  if (intent === "unsupported") return false;
  const text = evidenceTextForGate(result);
  const entityTokens = queryEntityTokens(query, intent);
  const intentTokens = queryIntentTokens(query, intent);
  const entityCoverage =
    entityTokens.length === 0 ||
    entityTokens.some((token) => queryTokenMatchesText(token, text)) ||
    (/\bect\b/i.test(query) && /\b(?:ect|electroconvulsive)\b/i.test(text));
  if (!entityCoverage) return false;
  if (intent === "general") return true;
  const asksForMaximumDose = intent === "dose" && /\bmax(?:imum)?\b/i.test(query);
  const maximumDoseCoverage = asksForMaximumDose && hasMaximumDoseEvidence(text);
  // Result-level twin of the sentence-level figure escape: a chunk that carries
  // the asked-for schedule/interval or unit range (a bare range table, "reviewed
  // annually" prose) is monitoring evidence even when it never says
  // monitor/level — the run-#60 miss class rejected such chunks wholesale here.
  const monitoringFigureCoverage =
    intent === "monitoring_schedule" &&
    (monitoringIntervalFigurePattern.test(text) || monitoringLevelRangeCoveragePattern.test(text));
  const intentCoverage =
    answerIntentEvidencePattern(intent).test(text) || maximumDoseCoverage || monitoringFigureCoverage;
  if (!intentCoverage) return false;
  if (
    intentTokens.length > 0 &&
    !intentTokens.some((token) => queryTokenMatchesText(token, text)) &&
    !maximumDoseCoverage &&
    !monitoringFigureCoverage
  ) {
    return false;
  }
  if (intent === "red_result_action" && requiresBloodCountEvidence(query) && !hasBloodCountEvidence(text)) return false;
  if (intent === "red_result_action" && asksForWithholdAction(query) && !hasWithholdActionEvidence(text)) return false;
  if (/\brenal\b/i.test(query) && !/\b(?:renal|kidney|eGFR|creatinine)\b/i.test(text)) return false;
  if (asksForMaximumDose && !maximumDoseCoverage) {
    return false;
  }
  return true;
}

const extractiveTruncationPattern =
  /\b(?:stabili[sz]e\s+the\s+do|the\s+do\b|liver\s+functi\b|respiratio\b|if\s+a\s+60%\s+decrease\s+in\s+b\b)\b/i;

const extractiveProductCataloguePattern =
  /\b(?:Lithicarb|Quilonum\s+SR|Campral|imprest\s+location|formulary\s+one)\b|[®™]/i;

const extractiveStructuralArtifactPattern =
  /\b(?:for\s+required,|monitoringup|prnselection|druguse|anddoses|reviewresponse|maximumrecommendeddoses|recommendeddoses|information:\s*review|links\s+to\s+relevant\s+documents\/resources|pharmacy\s+services\s+and\s+dispensing\s+protocol|role\s+responsibilities|document\s+control|straight\s+to\s+the\s+point\s+of\s+care|full\s+text|pubmed|randomi[sz]ed\s+clinical\s+trial|j\s+psychiatry|ann\s+emerg\s+med|site\s+map|gpo,\s+perth|tel:\s*\(|fax:\s*\()\b/i;

export const extractiveMalformedFactFragmentPattern =
  /(?:\bdosing\s+frequencies\s+outside[^.!?]{0,160}\bdose\s+maximum\s+and\s+im\s+daily\s+dose\s+hourly\b|^(?:the\s+guidance\s+is\s+that\s+)?table\s+summari[sz]ing\b|\b(?:prn\s+dose\s+daily\s+dose|includes\s+risk\s+monitoring\s+form|recommended\s+over\s+>\d+\s*kg|total\s+maximum\s+oral\s+respiratory\s+function)\b)/i;

const extractiveHeadingOnlyPattern =
  /^(?:dosage?|dosing|monitoring|baseline tests?|therapy|source|section|table|guideline|referral criteria|criteria)(?:\s*\([^)]{1,80}\))?\.?$/i;

const extractiveAllowedLowercaseStarterPattern =
  /^(?:if|when|for|in|avoid|do|must|withhold|cease|stop|monitor|check|reduce|increase|adjust|start|commence|begin|use|target|baseline|serum|therapy|dosing|titrate|arrange|refer|review|prescribe|record|complete|continue|discontinue|escalate)\b/i;

export const extractiveConcreteDosePattern = new RegExp(
  String.raw`\b(?:${clinicalDoseValueSource}|mmol\/l|daily|bd|tds|mane|nocte|target|range|serum|levels?|titration|titrate|titrated|adjust(?:ed|ment)?|dose\s+(?:adjust|reduc|increas)|reduce(?:d)?\s+doses?|doses?\s+(?:in|for|when|with|based|according)|max(?:imum)?|renal|eGFR|CrCl|creatinine|elderly|impairment|conventional tablets?)\b`,
  "i",
);

/** Extractive query tokens. */
function extractiveQueryTokens(query: string) {
  return normalizedClinicalSearchTokens(query).filter(
    (token) => token.length > 2 && !extractiveQueryStopwords.has(token),
  );
}

/** Escape query token. */
export function escapeQueryToken(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Query token variants. */
function queryTokenVariants(token: string) {
  const variants = new Set([token]);
  if (token.length > 5 && token.endsWith("ing")) variants.add(token.slice(0, -3));
  if (token.length > 4 && token.endsWith("ies")) variants.add(`${token.slice(0, -3)}y`);
  if (token.length > 4 && token.endsWith("es")) variants.add(token.slice(0, -2));
  if (token.length > 4 && token.endsWith("s")) variants.add(token.slice(0, -1));
  return [...variants].filter((variant) => variant.length > 2);
}

/** Query token matches text. */
export function queryTokenMatchesText(token: string, text: string) {
  if (token === "ect") return /\b(?:ect|electroconvulsive)\b/i.test(text);
  for (const variant of queryTokenVariants(token)) {
    const pattern =
      variant.length <= 3
        ? new RegExp(`\\b${escapeQueryToken(variant)}\\b`, "i")
        : new RegExp(`\\b${escapeQueryToken(variant)}\\w*\\b`, "i");
    if (pattern.test(text)) return true;
  }
  return false;
}

/** Mentions different medication entity. */
export function mentionsDifferentMedicationEntity(sentence: string, query: string) {
  return hasForeignMedicationClinicalValueBinding(query, sentence);
}

/** Has relevant query overlap. */
export function hasRelevantQueryOverlap(
  text: string,
  query: string,
  intent: AnswerIntent = classifyAnswerIntent(query, classifyRagQuery(query).queryClass),
) {
  const tokens = extractiveQueryTokens(query);
  if (!tokens.length) return true;
  const normalized = normalizeSectionText(text).toLowerCase();
  const entityTokens = queryEntityTokens(query, intent);
  const intentTokens = queryIntentTokens(query, intent);
  const entityCovered =
    entityTokens.length === 0 ||
    entityTokens.some((token) => queryTokenMatchesText(token, normalized)) ||
    (/\bect\b/i.test(query) && /\b(?:ect|electroconvulsive)\b/i.test(normalized));
  if (!entityCovered && intent !== "general") return false;
  if (intent === "general" || intent === "unsupported")
    return tokens.some((token) => queryTokenMatchesText(token, text));
  const monitoringFigureCovered =
    intent === "monitoring_schedule" &&
    (intentFigureMatchText(intent, normalized, query) !== null || deliveredMonitoringFrequencyPresent(text));
  return (
    answerIntentEvidencePattern(intent).test(normalized) &&
    (intentTokens.length === 0 ||
      intentTokens.some((token) => queryTokenMatchesText(token, normalized)) ||
      monitoringFigureCovered)
  );
}

/** Has bad extractive quality. */
export function hasBadExtractiveQuality(text: string) {
  const normalized = normalizeSectionText(text);
  if (!normalized) return true;
  if (/^appendix\s+(?:\d+|[ivxlcdm]+)\s*:\s*[^.!?]{0,80}\bform\b\.?$/i.test(normalized)) return true;
  if (containsDanglingProceduralComparatorStepArtifact(normalized)) return true;
  if (extractiveTruncationPattern.test(normalized)) return true;
  if (extractiveProductCataloguePattern.test(normalized)) return true;
  if (extractiveStructuralArtifactPattern.test(normalized)) return true;
  if (extractiveMalformedFactFragmentPattern.test(normalized)) return true;
  if (extractiveHeadingOnlyPattern.test(normalized.replace(/[.;]+$/, ""))) return true;
  if (/^([A-Za-z][A-Za-z /-]{3,60})\s+\1\.?$/i.test(normalized)) return true;
  const firstToken = normalized.split(/\s+/, 1)[0] ?? "";
  if (
    /^[a-z][a-z -]{2,}\b/.test(normalized) &&
    !extractiveAllowedLowercaseStarterPattern.test(normalized) &&
    !medicationEntitiesInText(firstToken).length
  ) {
    return true;
  }
  if (/\b[A-Za-z]{4,}[A-Z]{2,}[A-Za-z]{2,}\b/.test(normalized)) return true;
  // Narrow consecutive-arrow check: only flag '>>' that is NOT a clinical comparator like 'QTc >500 ms'.
  // Two adjacent > with only whitespace between them (not digits/letters) signals markup artifacts.
  if (/>[\s]*>/.test(normalized) && !/\w\s*>\s*\d/.test(normalized)) return true; // consecutive >> arrows
  if (/\w+\s*>\s*\w+\s*>\s*\w+/g.test(normalized) && !/\d\s*>\s*\d/.test(normalized)) return true; // breadcrumb trails like A > B > C (not numeric ranges)
  if (
    /^\s*(?:references?(?!\s+(?:range|interval|value|level|limit|coordinate|check|system|dosing|monitoring|guideline))|bibliography)\b/i.test(
      normalized,
    )
  )
    return true;
  if (hasClinicalAnswerQualityIssue(normalized)) return true;
  if (/\btable\s+\d+\b/i.test(normalized) && normalized.length > 180) return true;
  return false;
}

/**
 * Quality gate for *completed* answers at the final validation step.
 *
 * Unlike `hasBadExtractiveQuality`, this version skips `extractiveProductCataloguePattern`
 * because final answers to brand, PBS/access, or product-form questions legitimately contain
 * medication brand names (Campral, Lithicarb, Quilonum SR) and ®/™ symbols.
 * Applying the catalogue filter here would incorrectly replace valid answers with source-gap
 * responses for those question types.
 */
export function hasBadFinalAnswerQuality(text: string) {
  const normalized = normalizeSectionText(text);
  if (!normalized) return true;
  if (containsDanglingProceduralComparatorStepArtifact(normalized)) return true;
  if (extractiveTruncationPattern.test(normalized)) return true;
  // Note: extractiveProductCataloguePattern is intentionally excluded here — see JSDoc above.
  if (extractiveStructuralArtifactPattern.test(normalized)) return true;
  if (extractiveMalformedFactFragmentPattern.test(normalized)) return true;
  if (extractiveHeadingOnlyPattern.test(normalized.replace(/[.;]+$/, ""))) return true;
  if (/^([A-Za-z][A-Za-z /-]{3,60})\s+\1\.?$/i.test(normalized)) return true;
  const firstToken = normalized.split(/\s+/, 1)[0] ?? "";
  if (
    /^[a-z][a-z -]{2,}\b/.test(normalized) &&
    !extractiveAllowedLowercaseStarterPattern.test(normalized) &&
    !medicationEntitiesInText(firstToken).length
  ) {
    return true;
  }
  if (/\b[A-Za-z]{4,}[A-Z]{2,}[A-Za-z]{2,}\b/.test(normalized)) return true;
  if (/>[\s]*>/.test(normalized) && !/\w\s*>\s*\d/.test(normalized)) return true;
  if (/\w+\s*>\s*\w+\s*>\s*\w+/g.test(normalized) && !/\d\s*>\s*\d/.test(normalized)) return true;
  if (
    /^\s*(?:references?(?!\s+(?:range|interval|value|level|limit|coordinate|check|system|dosing|monitoring|guideline))|bibliography)\b/i.test(
      normalized,
    )
  )
    return true;
  if (hasClinicalAnswerQualityIssue(normalized)) return true;
  if (/\btable\s+\d+\b/i.test(normalized) && normalized.length > 180) return true;
  return false;
}

/** Is low value extractive caption. */
function isLowValueExtractiveCaption(clause: string) {
  const descriptor =
    /^(?:clinical\s+table|table|figure|image)\s+(?:showing|detailing|listing|outlining|describing|with|of)\b/i.test(
      clause,
    ) || /\btable\s+(?:showing|detailing|listing|outlining|describing)\b/i.test(clause);
  if (!descriptor) return false;
  return !extractiveClinicalDirectivePattern.test(clause);
}

// A short section heading ("Acute Mania:", "Day 1:", "do not use:",
// "eGFR <30:", "K+ >5.5 mmol/L:", "48-72 hours:") left standing alone by the
// bullet split. Merged into the fragment that follows it so the indication,
// schedule, or threshold context survives the minimum-length filter instead
// of being dropped — a dose or action without its day/step/threshold/time
// window is unsafe. Clinical threshold notation is too varied to enumerate
// character-by-character (comparators, electrolyte "+", degrees, micro
// signs), so any short colon-terminated fragment with alphanumeric content
// and no sentence punctuation qualifies (internal periods are decimals —
// the sentence split has already happened); structural labels ("Page 4:",
// "Table 2:") stay excluded by the stoplist and the word cap bounds it.
const shortHeadingFragmentPattern = /^[^!?;:]{2,40}:$/;

function isShortHeadingFragment(fragment: string) {
  return (
    shortHeadingFragmentPattern.test(fragment) &&
    /[A-Za-z0-9]/.test(fragment) &&
    fragment.split(/\s+/).length <= 4 &&
    !structuralHeadingStoplistPattern.test(fragment)
  );
}

function isGroupedClinicalThresholdHeading(fragment: string) {
  return (
    /^[^!?;:]{4,120}:$/.test(fragment) &&
    /\b(?:ranges?|thresholds?|cut[\s-]?offs?|levels?|concentrations?)\b/i.test(fragment) &&
    fragment.split(/\s+/).length <= 16 &&
    !structuralHeadingStoplistPattern.test(fragment)
  );
}

function isGroupedClinicalThresholdRow(fragment: string) {
  return (
    /\d/.test(fragment) &&
    // A range heading may qualify consecutive compact value rows, but it must
    // expire when ordinary monitoring prose starts. Timing/action sentences
    // also contain numbers and units, so treating every numeric sentence as a
    // row leaks the old range heading into later paragraphs.
    !/\b(?:after\s+dosing|post[-\s]?dose|used\s+for\s+monitoring|check|monitor\w*|once\s+stable|steady\s+state|until\s+stabili[sz]ed|starting\s+treatment|dose\s+change)\b/i.test(
      fragment,
    ) &&
    /(?:\b(?:between|below|above|less|greater)\b|[<>≤≥]|\b\d+(?:\.\d+)?\s*(?:-|–|—|to)\s*\d|\b(?:mmol|mol|mg|mcg|ng|msec|ms|units?)\b|[µμ]g|%)/i.test(
      fragment,
    )
  );
}

/** Split clinical evidence sentences. */
export function splitClinicalEvidenceSentences(value: string) {
  const sourceText = sourceTextForClinicalProsePreservingBreaks(value).replace(
    // Plain-text PDF extraction also represents nested bullets as "o Text".
    // Keep that visual boundary before soft-wrap reflow; otherwise the lowercase
    // bullet marker is mistaken for a continuation of the preceding heading.
    /\n(?=[ \t]*o[ \t]+[A-Z])/g,
    "\n\n",
  );
  const fragments = normalizeInlineBulletGlyphs(
    reflowWrappedEctBookingSystemLines(
      reflowWrappedEscalationRecipientLines(
        reflowWrappedAgitationDoseLines(
          reflowBoundedSourceLines(sourceText, {
            requireContinuationStart: true,
          }).join("\n"),
        ),
      ),
    ),
    { joiner: "\n" },
  )
    .split(/\r?\n+|(?<=[.!?])(?<!\b[Ee]\.[Gg]\.|\b[Ii]\.[Ee]\.)\s+|\s+[•]\s+|\s+\|\s+/)
    .map((fragment) => fragment.trim())
    .filter(Boolean);
  const merged: string[] = [];
  let pendingHeading = "";
  let groupedThresholdHeading = "";
  for (const fragment of fragments) {
    if (isGroupedClinicalThresholdHeading(fragment)) {
      groupedThresholdHeading = /^[a-z][a-z]/.test(fragment) ? upperFirst(fragment) : fragment;
      pendingHeading = "";
      continue;
    }
    if (isShortHeadingFragment(fragment)) {
      // Sentence-case an OCR-lowercased heading ("day 1:" → "Day 1:") so the
      // merged fact reads as a sentence start rather than being discarded as
      // a mid-sentence fragment by the lowercase-start quality gate. Mixed-
      // case clinical tokens ("eGFR <30:") keep their casing — they already
      // pass that gate, and "EGFR" would corrupt the abbreviation.
      const cased = /^[a-z][a-z]/.test(fragment) ? upperFirst(fragment) : fragment;
      pendingHeading = pendingHeading ? `${pendingHeading} ${cased}` : cased;
      continue;
    }
    const groupedThresholdRow = groupedThresholdHeading && isGroupedClinicalThresholdRow(fragment);
    const groupedRowText = groupedThresholdRow
      ? fragment.replace(/^([A-Z]{5,})(?=\s)/, (label) => upperFirst(label.toLowerCase()))
      : fragment;
    merged.push(
      groupedThresholdRow
        ? `${groupedThresholdHeading} ${groupedRowText}`
        : pendingHeading
          ? `${pendingHeading} ${fragment}`
          : fragment,
    );
    pendingHeading = "";
    if (groupedThresholdHeading && !groupedThresholdRow) groupedThresholdHeading = "";
  }
  return merged
    .map(cleanExtractivePointText)
    .filter(
      (sentence) =>
        sentence.length >= 18 &&
        !looksLikeJsonArtifact(sentence) &&
        !isLowValueExtractiveCaption(sentence) &&
        !hasBadExtractiveQuality(sentence),
    );
}

export const numericRepeatDoseSchedulePattern =
  /\b(?:additional\s+doses?|repeat(?:ing)?\s+doses?|doses?\s+(?:(?:may|can|should|must)\s+)?be\s+repeated|(?:may|can|should|must)\s+be\s+repeated|(?:second|third|fourth|\d+(?:st|nd|rd|th))\s+dose)\b/i;

export const repeatDoseScheduleFigurePattern =
  /\b(?:hourly|half[-\s]?hourly|daily|after|every|within)\b[^.!?;]{0,40}\b\d+(?:\.\d+)?\s*(?:mg|mcg|minutes?|hours?|days?)\b|\b(?:hourly|half[-\s]?hourly|daily)\b|\b\d+(?:\.\d+)?\s+doses?\b/i;

/** Fact kind for sentence. */
export function factKindForSentence(
  sentence: string,
  query: string,
  intent: AnswerIntent,
): ExtractedClinicalFactKind | null {
  const text = normalizeSectionText(sentence);
  if (!text) return null;
  if (
    /\b(?:contraindicat\w*|avoid|must not|do not|should not|not use|opioid[-\s]?free|withdrawal|precipitat\w*)\b/i.test(
      text,
    )
  ) {
    return "contraindication";
  }
  if (
    intent === "monitoring_schedule" &&
    /\bsteady\s+state\s+concentrations?\b[^.!?]{0,80}\b(?:after|within)\s+\d/i.test(text)
  ) {
    return "monitoring";
  }
  if (intent === "monitoring_schedule" && deliveredMonitoringFrequencyPresent(text)) return "monitoring";
  if (/\b(?:renal|kidney|eGFR|creatinine|CrCl)\b/i.test(text)) return "renal_limit";
  const numericRepeatDoseSchedule =
    intent === "dose" && numericRepeatDoseSchedulePattern.test(text) && repeatDoseScheduleFigurePattern.test(text);
  if (
    /\b(?:red|amber|green|threshold|withhold|cease|stop|discontinue|discontinued|urgent|contact|repeat|anc|fbc|wbc|neutrophil|toxic\w*|action)\b/i.test(
      text,
    ) &&
    !numericRepeatDoseSchedule
  ) {
    return "threshold_action";
  }
  if (/\b(?:pathway|refer|referral|criteria|indicat\w*|ect|electroconvulsive|specialist|psychiat\w*)\b/i.test(text)) {
    return "pathway_referral";
  }
  // Inflection-tolerant only (monitored/annually/LFTs): the wider panel/range
  // vocabulary must NOT move here — it would steal sentences like "Maintenance
  // range 0.6-0.8 mmol/L" from the dose arm below and change fact priorities
  // for non-monitoring intents. "review" stays exact for the same reason:
  // review\w* would reclassify dose-review sentences ("doses should be
  // reviewed daily") away from the dose arm. The legacy tokens classify
  // byte-identically; a sentence claimed ONLY via the new inflections that
  // also carries a concrete dose value ("Quetiapine is monitored at a dose of
  // 200 mg daily") falls through to the dose arm — otherwise a sole
  // dose-bearing fact would be dropped by dose-intent answers (reviewer P2).
  const legacyMonitoringKindPattern =
    /\b(?:monitor|monitoring|baseline|weekly|monthly|annual|every|level|levels|blood test|ecg|lft|review)\b/i;
  const inflectedMonitoringKindPattern = /\b(?:monitor\w*|annual(?:ly)?|levels?|blood tests?|ecgs?|lfts?)\b/i;
  const doseBoundReviewInstruction =
    intent === "dose" &&
    /\b(?:doses?|dosing|dosage)\b[^.!?]{0,120}\b(?:requires?|must|should|needs?\s+to|is\s+to|are\s+to)\b[^.!?]{0,50}\b(?:prescriber|clinical|medical)?\s*review\b/i.test(
      text,
    ) &&
    !/\b(?:monitor\w*|baseline|weekly|monthly|annual(?:ly)?|every|levels?|blood tests?|ecgs?|lfts?)\b/i.test(text);
  if (
    (!doseBoundReviewInstruction && legacyMonitoringKindPattern.test(text)) ||
    (inflectedMonitoringKindPattern.test(text) && !clinicalDoseValuePattern.test(text))
  ) {
    return "monitoring";
  }
  if (
    /\b(?:doses?|dosing|dosage|daily|bd|tds|mane|nocte|mmol\/l)\b/i.test(text) ||
    clinicalDoseValuePattern.test(text)
  ) {
    return "dose";
  }
  if (/\b(?:caution|risk|adverse|side effect|limited|not enough|insufficient)\b/i.test(text)) return "caveat";
  if (intent === "general" && hasRelevantQueryOverlap(text, query, intent)) return "bottom_line";
  return null;
}

/** Upper first. */
export function upperFirst(value: string) {
  if (!value) return value;
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
