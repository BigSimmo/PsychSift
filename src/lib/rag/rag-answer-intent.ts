// Answer-intent classification for the extractive answer path: which kind of clinical question a
// query asks (dose, contraindication, monitoring schedule, result action, ...). Extracted from
// rag-extractive-answer.ts to keep that module within its maintainability budget.
import { medicationMonitoringQuerySubjects } from "@/lib/clinical-search";
import { medicationEntitiesInText } from "@/lib/medication-entities";
import { normalizeSectionText } from "@/lib/rag/rag-answer-text";
import type { RagQueryClass } from "@/lib/types";

export type AnswerIntent =
  | "dose"
  | "contraindication"
  | "monitoring_schedule"
  | "red_result_action"
  | "document_lookup"
  | "pathway_referral"
  | "unsupported"
  | "general";

export type MonitoringFacet =
  | "baseline"
  | "level_range"
  | "sample_timing"
  | "after_change"
  | "stable_monitoring"
  | "steady_state"
  | "ongoing"
  | "higher_risk"
  | "other";

export const clinicalQuerySignalPattern =
  /\b(?:lithium|clozapine|acamprosate|naltrexone|sertraline|valproate|antipsychotic|ect|bulimia|anorexia|eating disorder|dose|renal|pregnan(?:t|cy|cies)|monitor|fbc|anc|qtc|opioid|contraindicat(?:e|es|ed|ion|ions)|referral|pathway|patient|clinical|guideline|medication|medicine|prescrib(?:e|es|ed|er|ers|ing)|therapy|treatment)\b/i;

const narrativeMonitoringRangeContextPattern =
  /\b(?:adult\s+)?age\s+ranges?\b|\branges?\s+of\s+(?:baseline\s+)?(?:tests?|checks?|monitoring|ages?)\b/i;
const explicitMonitoringLevelValueLookupPattern =
  /\b(?:therapeutic|target|trough|serum|plasma|maintenance)\s+(?:levels?|ranges?|concentrations?)\b|\b(?:levels?|ranges?|concentrations?)\s+(?:is|are)\s+(?:used|recommended|targeted|maintained)\b|\blevels?\s+ranges?\b/i;

export function isMonitoringLevelRangeLookupQuery(query: string) {
  if (narrativeMonitoringRangeContextPattern.test(query)) return false;
  const hasExplicitDoseCue = /\b(?:dose|doses|dosing|dosage)\b/i.test(query);
  const hasExplicitMeasuredLevelCue = /\b(?:serum|plasma|trough|levels?|concentrations?)\b/i.test(query);
  if (hasExplicitDoseCue && !hasExplicitMeasuredLevelCue) return false;
  if (
    /\b(?:therapeutic\s+)?(?:dose|dosing|dosage)\s+ranges?\b|\branges?\s+(?:of|for)\s+(?:the\s+)?(?:dose|dosing|dosage)\b/i.test(
      query,
    )
  ) {
    return false;
  }
  if (explicitMonitoringLevelValueLookupPattern.test(query)) return true;
  return medicationMonitoringQuerySubjects(query).length > 0 && /\branges?\b/i.test(query);
}

/** Classify answer intent. */
// Signs, features or risk factors of toxicity are descriptive questions, not a request for the
// action on a result: routing them to red_result_action left only "No current source with
// toxicity action guidance was found" (#ZZ4RAP).
export function isToxicityFeatureQuery(normalized: string) {
  return (
    /\btoxicity\b/.test(normalized) &&
    /\b(?:signs?|symptoms?|features?|presentation|risk factors?|contributors?|causes?|more likely|predispos\w*)\b/.test(
      normalized,
    ) &&
    !/\b(?:what\s+(?:to\s+do|action|should)|action|steps?|manage\w*|treat\w*|withhold|cease|stop)\b/.test(normalized)
  );
}

export function classifyAnswerIntent(query: string, queryClass: RagQueryClass): AnswerIntent {
  const normalized = normalizeSectionText(query).toLowerCase();
  if (!normalized) return "unsupported";
  return (
    lookupOrContraindicationIntent(query, normalized) ??
    resultOrScheduleIntent(normalized) ??
    remainingAnswerIntent(query, normalized, queryClass)
  );
}

function lookupOrContraindicationIntent(query: string, normalized: string): AnswerIntent | null {
  if (
    /\b(?:what|which|list|show|find)\s+(?:documents?|sources?|guidelines?|files?)\b.*\b(?:support|cover|contain|for|about)\b/.test(
      normalized,
    ) ||
    /\b(?:documents?|sources?|guidelines?|files?)\s+(?:support|cover|contain|for|about)\b/.test(normalized)
  ) {
    return "document_lookup";
  }
  if (/\b(?:contraindicat\w*|avoid|do not use|must not|should not|not use|opioid[-\s]?free)\b/.test(normalized)) {
    return "contraindication";
  }
  // Asking whether one named medicine can be given with another ("Can I prescribe ibuprofen for
  // someone on lithium?") is an interaction question: the answer is the source's avoid/caution
  // statement, never a dose cap that happens to sit in the same chunk (#ZZ4RAP).
  if (
    medicationEntitiesInText(query).length >= 2 &&
    /\b(?:interact\w*|together|combin\w*|co-?prescrib\w*|(?:prescrib\w*|give|giving|use|using|start|starting|add|adding|take|taking)\b[^?]*\b(?:on|taking|with)\b)/.test(
      normalized,
    )
  ) {
    return "contraindication";
  }
  return null;
}

function resultOrScheduleIntent(normalized: string): AnswerIntent | null {
  const hasResultActionSignal =
    /\b(?:red|amber|green|anc|fbc|wbc|result|results|threshold|withhold|cease|stop|stopped|toxicity)\b/.test(
      normalized,
    ) || /\b(?:what\s+action|action\s+is\s+required|required\s+action|suspected\s+\w+\s+toxicity)\b/.test(normalized);
  const hasScheduleSignal =
    /\b(?:monitor|monitoring|schedule|baseline|follow[-\s]?up|level|levels|test|tests)\b/.test(normalized) ||
    isMonitoringLevelRangeLookupQuery(normalized);
  if (hasScheduleSignal && isCompoundMonitoringToxicityQuery(normalized)) return "monitoring_schedule";
  if (isToxicityFeatureQuery(normalized)) return "general";
  // Toxicity and explicit action queries take priority over monitoring even if schedule/baseline/follow-up terms appear.
  const hasStrongResultSignal =
    /\b(?:toxicity|what\s+action|action\s+is\s+required|required\s+action|suspected\s+\w+\s+toxicity)\b/.test(
      normalized,
    );
  if (
    hasResultActionSignal &&
    (!/\b(?:schedule|baseline|follow[-\s]?up)\b/.test(normalized) || hasStrongResultSignal)
  ) {
    return "red_result_action";
  }
  if (hasScheduleSignal) {
    return "monitoring_schedule";
  }
  if (hasResultActionSignal) return "red_result_action";
  return null;
}

function remainingAnswerIntent(query: string, normalized: string, queryClass: RagQueryClass): AnswerIntent {
  if (/\b(?:doses?|dosing|dosage|max(?:imum)?|mg|mcg|renal|eGFR|creatinine)\b/i.test(query)) return "dose";
  if (/\b(?:pathway|refer|referral|criteria|ect|electroconvulsive)\b/.test(normalized)) return "pathway_referral";
  // Retrieval classification and answer intent are different concerns. A
  // document_lookup route can still ask for the document's clinical content
  // (for example, "What should a safety plan include?"). Treat it as a source
  // lookup only when the wording explicitly asks to find/open/select a source;
  // otherwise the extractive path must select responsive clinical facts rather
  // than reference-list lines that merely mention a guideline or procedure.
  if (
    /\b(?:find|show|open|which)\b.*\b(?:document|guideline|procedure|policy|protocol|form|source|file)\b/.test(
      normalized,
    )
  ) {
    return "document_lookup";
  }
  if (queryClass === "unsupported_or_general" && !clinicalQuerySignalPattern.test(query)) return "unsupported";
  return "general";
}

export function requestedMonitoringScheduleFacets(query: string) {
  const normalized = normalizeSectionText(query).toLowerCase();
  const facets = new Set<MonitoringFacet>();
  if (/\bbaseline\b|\bpre[-\s]?treatment\b|\bbefore\s+(?:starting|commencing)\b/.test(normalized)) {
    facets.add("baseline");
  }
  if (/\b(?:sample|sampling|post[-\s]?dose|last\s+dose|trough)\b/.test(normalized)) {
    facets.add("sample_timing");
  }
  if (/\b(?:target|targets|therapeutic\s+(?:level|levels|range|ranges))\b/.test(normalized)) {
    facets.add("level_range");
  }
  if (/\b(?:after|following)\b[^?]{0,60}\b(?:dose\s+changes?|chang\w*\s+(?:the\s+)?dose)\b/.test(normalized)) {
    facets.add("after_change");
  }
  if (/\b(?:stable\s+treatment|once\s+stable|maintenance\s+monitoring)\b/.test(normalized)) {
    facets.add("stable_monitoring");
  }
  if (/\b(?:higher[-\s]?risk|high[-\s]?risk|renal\s+impairment|closer\s+monitoring)\b/.test(normalized)) {
    facets.add("higher_risk");
  }
  return facets;
}

/** A schedule overview that also explicitly asks for toxicity actions. */
export function isCompoundMonitoringToxicityQuery(query: string) {
  const normalized = normalizeSectionText(query).toLowerCase();
  const asksForScheduleOverview =
    /\bmonitor(?:ing)?\s+schedule\b|\b(?:detailed|complete|comprehensive)\b[^?]{0,80}\bmonitor(?:ing)?\b/.test(
      normalized,
    );
  const asksForToxicityAction =
    /\bactions?\b[^?]{0,60}\b(?:suspected\s+)?toxicity\b|\b(?:suspected\s+)?toxicity\b[^?]{0,60}\bactions?\b/.test(
      normalized,
    );
  return asksForScheduleOverview && asksForToxicityAction && requestedMonitoringScheduleFacets(normalized).size >= 2;
}
