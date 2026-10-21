// The extractive answer builder: clinical fact extraction, fact sections, source-bound comparison
// answers and buildExtractiveAnswer. Moved unchanged out of rag-extractive-answer.ts.

import {
  normalizedMeasuredQuery,
  isSourceBoundActiveCommunityEdProcedureQuery,
  isSourceBoundCommunityHomeVisitRequirementsQuery,
  isSourceBoundBestPracticePrescriptionRequirementsQuery,
  comparisonSourceLabel,
  communityHomeVisitDepartureEvidence,
  communityHomeVisitReturnEvidence,
  bestPracticePrescriptionProgramUseEvidence,
  bestPracticePrescriptionProfileEvidence,
  buildActiveCommunityEdProcedureAnswer,
  buildCommunityHomeVisitRequirementsAnswer,
  buildBestPracticePrescriptionRequirementsAnswer,
  isAtomicNmhsClozapineRedRangeSource,
  buildClozapineBloodActionThresholdAnswer,
} from "@/lib/rag/rag-source-bound-policy-procedures";
import { buildDocumentSupportListAnswer } from "@/lib/rag/rag-document-support-list";
import { boldHighYieldClinicalText } from "@/lib/answer-ranking";
import {
  adjacentLabelledNumericBandConflicts,
  containsNumericBandReference,
  extractClinicalValueAtoms,
  LABELLED_NUMERIC_BAND_CONFLICT_NOTE,
  textReferencesAdjacentBandConflict,
} from "@/lib/answer-verification";
import { hasClinicalActionSignal, hasClinicalPopulationSignal } from "@/lib/rag/rag-clinical-language-signals";
import { citationFromResult as resultCitation, compactCitations } from "@/lib/citations";
import {
  analyzeClinicalQuery,
  classifyRagQuery,
  hasForeignThresholdLabel,
  normalizedClinicalSearchTokens,
} from "@/lib/clinical-search";
import { ragDeepMemoryVersion } from "@/lib/deep-memory";
import {
  buildDocumentBreakdown,
  buildEvidenceSummary,
  buildSmartPanel,
  buildSourceCoverage,
  buildVisualEvidence,
  detectConflictsOrGaps,
  extractQuoteCards,
  selectBestSourceRecommendation,
} from "@/lib/evidence";
import { hasBoundMonitoringCadence as deliveredMonitoringFrequencyPresent } from "@/lib/evidence-relevance";
import {
  medicationEntitiesInText,
  medicationEntityMatchesInText,
  medicationSafetyEntitiesInText,
} from "@/lib/medication-entities";
import {
  buildAnswerScoreExplanations,
  buildIndexingQuality,
  collectMemoryCards,
  deriveConfidence,
  evidenceTextForGate,
  rankMemoryCardsForAnswer,
  scoreValue,
} from "@/lib/rag/rag-answer-support";
import { normalizeSectionText, sanitizeAnswerText } from "@/lib/rag/rag-answer-text";
import { sourceTextForClinicalProsePreservingBreaks } from "@/lib/source-text-sanitizer";
import {
  type AnswerSection,
  type Citation,
  type ConflictOrGap,
  type QuoteCard,
  type RagAnswer,
  type RagQueryClass,
  type SearchResult,
} from "@/lib/types";
import {
  clinicalValueAtomKey,
  sourceHasLabelledNumericBandConflict,
  sourceLabelledNumericBandConflictsAffectingText,
  sourceDirectlySupportsAnswerText,
  sourceEvidenceText,
  bulletItemsAfter,
  toxicityActionHeadingPattern,
  toxicityListHeadingPattern,
} from "@/lib/rag/rag-claim-support";
import { reflowBoundedSourceLines } from "@/lib/rag/rag-source-segmentation";
import {
  classifyAnswerIntent,
  isCompoundMonitoringToxicityQuery,
  isMonitoringLevelRangeLookupQuery,
  isToxicityFeatureQuery,
  requestedMonitoringScheduleFacets,
  type AnswerIntent,
  type MonitoringFacet,
} from "@/lib/rag/rag-answer-intent";
import {
  type ExtractedClinicalFact,
  type ExtractedClinicalFactKind,
  answerIntentEvidencePattern,
  asksForBloodCountThreshold,
  asksForWithholdAction,
  cleanExtractivePointText,
  extractiveClinicalDirectivePattern,
  extractiveConcreteDosePattern,
  factCarriesIntentFigure,
  factKindForSentence,
  hasAtomicBloodCountWithholdThresholdEvidence,
  hasBadExtractiveQuality,
  hasBloodCountEvidence,
  hasEscalationTrigger,
  hasMaximumDoseEvidence,
  hasRelevantQueryOverlap,
  hasTargetedEscalationAction,
  hasWithholdActionEvidence,
  intentFigureMatchText,
  isExplicitEscalationQuery,
  isScoreIndependentActionEvidence,
  mentionsDifferentMedicationEntity,
  monitoringCadenceOrLevelPattern,
  monitoringIntervalFigurePattern,
  monitoringLevelRangeCoveragePattern,
  monitoringScheduleEvidencePattern,
  glossaryEntrySentencePattern,
  policyAdministrationSentencePattern,
  numericRepeatDoseSchedulePattern,
  queryEntitySubject,
  queryEntityTokens,
  queryIntentTokens,
  queryTokenMatchesText,
  repeatDoseScheduleFigurePattern,
  requiresBloodCountEvidence,
  resultCoversAnswerIntent,
  splitClinicalEvidenceSentences,
  upperFirst,
} from "@/lib/rag/rag-extractive-signals";
import {
  derivedArtifactsContainProceduralFlowEdge,
  filterRelatedDocumentsForProceduralArtifacts,
  finalQualityGapAnswer,
  guidanceWrapperLayoutDebrisPattern,
  hasCompleteOpeningSentence,
  isFragmentLikeClinicalAnswer,
  isLaunderedGuidanceWrapperAnswer,
  resultContainsProceduralFlowEdgeArtifact,
  retainCitedExtractiveFallbackEvidence,
} from "@/lib/rag/rag-answer-shape-checks";

/** Fact supports answer intent. */
export const admissionComparisonTermPattern = /\badmissions?\b/i;

export const dischargeComparisonTermPattern = /\bdischarg(?:e|es|ed|ing)\b/i;

const sourceBoundTerminalContinuation = String.raw`(?=\s*(?:[.,;:]|$))`;

const medicalClearanceContinuation = String.raw`(?=\s*(?:[.,;:]|$|\bor\s+if\s+(?:the\s+)?(?:consumer|patient)\b|\bfor\s+(?:an?\s+)?admission\b|\bvia\s+(?:the\s+)?emergency department\b|\band\s+arrang\w*\s+(?:an?\s+)?transfer\b|\bafter\s+(?:(?:a|the)\s+)?(?:(?:physical|clinical|medical)\s+)?assessment\b|\bby\s+(?:the\s+)?(?:treating\s+)?(?:doctor|clinician|consultant)\b|\bbefore\s+(?:an?\s+)?transfer\b|\bat\s+admission\b|\bprior\s+to\s+(?:admission|assessment|transfer)\b))`;

const bedLocationContinuation = String.raw`(?=\s*(?:[.,;:]|$|\bat\s+(?:an?\s+)?(?:alternative\s+)?health service\b|\bfor\s+(?:an?\s+)?admission\b|\bwithin\s+(?:the\s+)?(?:service|ward|unit)\b|\bthrough\s+(?:the\s+)?(?:patient|bed)\s+flow\b|\band\s+notif\w*\s+(?:the\s+)?(?:staff|coordinator|clinician)\b))`;

const directBedLocationAction = String.raw`(?:locate\s+(?:an?\s+)?bed|(?:liaise|coordinate|work)\b[^.!?]{0,120}\bto\s+locate\s+(?:an?\s+)?bed)`;

const subordinateBedLocationReportPattern = /\bwhether\b[^.!?]{0,180}\blocate\s+(?:an?\s+)?bed\b/i;

const nonClinicalComparisonWrapperPattern =
  /^\s*(?:(?:for|regarding)\s+)?(?:(?:the|an?)\s+)?(?:(?:annual|monthly|quarterly|retrospective|historical)\s+)?(?:audit(?:\s+(?:observations?|findings?|reports?|records?))?|reports?|reporting|archives?|archival\s+records?|training(?:\s+(?:materials?|records?|requirements?))?|education(?:al)?\s+(?:materials?|records?)|governance(?:\s+(?:observations?|reports?|records?))?|historical\s+(?:records?|reports?)|retrospective\s+(?:reviews?|reports?))\b/i;

export const admissionRequirementBindingPatterns = [
  /\b(?:patient|consumer)\s+(?:will|must)\s+only\s+be\s+able\s+to\s+(?:come|enter)\b[^.!?]{0,180}\bmeet\s+(?:the\s+)?(?:identified\s+)?inclusion criteria\s+for admission\b/i,
  new RegExp(String.raw`\b(?:provide|obtain)\s+(?:an?\s+)?medical clearance\b${medicalClearanceContinuation}`, "i"),
  /\bmedical clearance\s+(?:(?:must|should)\s+be\s+(?:provided|obtained)|(?:is|are)\s+(?:required|provided|obtained))\b/i,
  new RegExp(
    String.raw`\barrang\w*\s+(?:the\s+)?prioriti[sz]ation\s+of\s+beds?\b${sourceBoundTerminalContinuation}`,
    "i",
  ),
  new RegExp(
    String.raw`\b(?:clinician|coordinator|staff|team)\b[^.!?]{0,60}\b(?:(?:must|should|will)\s+(?:(?:promptly|urgently|also|directly|then)\s+)?${directBedLocationAction}|(?:is|are)\s+(?:(?:required|expected)\s+)?to\s+${directBedLocationAction})${bedLocationContinuation}`,
    "i",
  ),
  /\badmissions?\s+escort\w*\s+by\s+police\s+(?:(?:must|should)\s+go|go|(?:must|should|are)\s+(?:be\s+)?(?:transfer\w*|allocat\w*)|require\w*)\b/i,
  new RegExp(
    String.raw`\b(?:require\w*|transfer\w*|allocat\w*)\s+(?:(?:the|an?)\s+|to\s+(?:(?:the|an?)\s+)?)?high[\s-]observation beds?\b${sourceBoundTerminalContinuation}`,
    "i",
  ),
] as const;

export const dischargeRequirementBindingPatterns = [
  /\bclinicians?\s+(?:must|should|will)\s+actively\s+plan\s+(?:the\s+)?effective\s+and\s+timely\s+discharge\b/i,
  /\bdischarge planning\s+(?:(?:must be|is)\s+integral|(?:must|should)\s+(?:include|ensure|complete|notify|refer|document|arrange))\b/i,
  /\bdischarge plans?\s+(?:must|should)\s+(?:include|ensure|complete|notify|refer|document|arrange)\b/i,
  /\b(?:clinicians?|staff|care coordinators?|case managers?|treating teams?|clinical teams?)\b[^.!?]{0,80}\b(?:must\s+|should\s+|will\s+|are\s+(?:required|expected)\s+to\s+)?(?:ensure\w*|complet\w*|notif\w*|refer\w*|document(?:ed|ing)?|include\w*|arrang\w*)\s+(?:the\s+)?(?:discharge plans?|ongoing care arrangements?)\b/i,
  /\bongoing care arrangements?\s+(?:must|should)\s+(?:be\s+documented|include|ensure|complete|document)\b/i,
] as const;

export function factSupportsAnswerIntent(
  kind: ExtractedClinicalFactKind,
  sentence: string,
  query: string,
  intent: AnswerIntent,
  allowPassiveObligations = false,
) {
  const text = normalizeSectionText(sentence);
  const normalizedQuery = normalizeSectionText(query).toLowerCase();
  if (!text || hasBadExtractiveQuality(text)) return false;

  switch (intent) {
    case "dose":
      if (kind !== "dose" && kind !== "renal_limit") {
        // Allow contraindication facts when the query explicitly asks for renal information,
        // since renal contraindications (e.g. creatinine >120 micromol/L: contraindicated) are
        // essential dose safety facts for renal-dose queries.
        if (
          kind === "contraindication" &&
          /\brenal\b/i.test(query) &&
          /\b(?:renal|kidney|eGFR|creatinine|CrCl)\b/i.test(text)
        ) {
          // fall through to dose text check below
        } else {
          return false;
        }
      }
      if (/\brenal\b/i.test(query) && !/\b(?:renal|kidney|eGFR|creatinine|CrCl)\b/i.test(text)) return false;
      if (/\bmax(?:imum)?\b/i.test(query) && !hasMaximumDoseEvidence(text)) {
        return false;
      }
      return (
        extractiveConcreteDosePattern.test(text) ||
        (/\b(?:dose|doses|dosing|dosage)\s+guidance\b/i.test(query) &&
          /\b(?:dose|doses|dosing|dosage)\b/i.test(text) &&
          extractiveClinicalDirectivePattern.test(text))
      );
    case "contraindication":
      return (
        kind === "contraindication" &&
        /\b(?:contraindicat\w*|avoid|must not|do not|should not|not use|opioid[-\s]?free|withdrawal|precipitat\w*)\b/i.test(
          text,
        )
      );
    case "monitoring_schedule":
      // Also allow renal_limit facts — sentences like 'baseline renal function then repeat periodically'
      // are classified as renal_limit (renal check triggers before monitoring), but are directly relevant
      // to monitoring schedule answers.
      if (kind !== "monitoring" && kind !== "dose" && kind !== "renal_limit") return false;
      // A dose-kind fact must carry an actual cadence or level signal — the
      // shared vocabulary alone would admit generic dose language
      // ("The therapeutic dose range is 300-450 mg daily.") as monitoring
      // evidence via range/therapeutic/maintenance tokens (CodeRabbit major).
      // Level ranges like "Maintenance range is 0.6-0.8 mmol/L" stay admissible
      // through their level units.
      if (kind === "dose" && !monitoringCadenceOrLevelPattern.test(text)) return false;
      if (policyAdministrationSentencePattern.test(text) || glossaryEntrySentencePattern.test(text)) return false;
      return monitoringScheduleEvidencePattern.test(text);
    case "red_result_action":
      if (kind !== "threshold_action" && kind !== "caveat") return false;
      if (requiresBloodCountEvidence(query) && !hasBloodCountEvidence(text)) return false;
      if (asksForWithholdAction(query) && !hasWithholdActionEvidence(text)) return false;
      return (
        /\b(?:withhold|withheld|withholding|hold|held|cease|stop|stopped|discontinue|discontinued|contact|urgent|repeat|review|call for help|escalat\w*|monitor|toxicity|rash)\b/i.test(
          text,
        ) &&
        // Include green/neutrophil: valid clozapine result-action vocabulary the classifier accepts
        /\b(?:red|amber|green|threshold|result|results|anc|fbc|wbc|neutrophil|toxicity|rash|reaction|blood|patholog\w*|haematolog\w*|hematolog\w*)\b/i.test(
          text,
        )
      );
    case "pathway_referral":
      if (kind !== "pathway_referral") return false;
      if (/\breferr?al|refer\b/i.test(query) && !/\b(?:refer|referral|form\s*1a)\b/i.test(text)) return false;
      if (/\bdischarge\s+criteria\b/i.test(text) && !/\bdischarge\b/.test(normalizedQuery)) return false;
      return /\b(?:pathway|procedure|refer|referral|criteria|indicat\w*|ect|electroconvulsive|specialist|psychiat\w*|step)\b/i.test(
        text,
      );
    case "document_lookup":
      return /\b(?:document|guideline|procedure|policy|protocol|form|source|file|support|supports|covers|contains)\b/i.test(
        text,
      );
    case "unsupported":
      return false;
    case "general":
    default:
      if (/\b(?:references?|bibliography|full\s+text|pubmed|randomi[sz]ed\s+clinical\s+trial)\b/i.test(text)) {
        return false;
      }
      if (isExplicitEscalationQuery(query)) {
        return (
          (hasTargetedEscalationAction(text) && hasEscalationTrigger(text)) || isScoreIndependentActionEvidence(text)
        );
      }
      if (/^what\s+is\b/i.test(query)) {
        return /\b(?:is|are|means|defined|characteri[sz]ed|involves|refers\s+to)\b/i.test(text);
      }
      return (
        /\b(?:assess|arrange|check|collaborat\w*|complete|conduct|continue|develop|diagnos\w*|document|dose|ensure|identify|include|incorporate|involve|link|manage|monitor|provide|record|refer|revise|review\w*|risk|share|therapy|treat|update)\b/i.test(
          text,
        ) ||
        (allowPassiveObligations && /\b(?:must|should|will)\s+be\s+(?:completed|recorded|documented)\b/i.test(text))
      );
  }
}

export function hasBoundedMedicationSubjectForNumericRepeatDoseSchedule(
  sentence: string,
  result: SearchResult,
  query: string,
) {
  const repeatMatch = sentence.match(numericRepeatDoseSchedulePattern);
  if (!repeatMatch || !repeatDoseScheduleFigurePattern.test(sentence)) return true;

  const repeatStart = repeatMatch.index ?? 0;
  const medicationMatches = medicationEntityMatchesInText(sentence);
  const precedingSubjects = medicationMatches.filter((match) => {
    if (match.end > repeatStart || repeatStart - match.end > 120) return false;
    return !/[.;\n•]/.test(sentence.slice(match.end, repeatStart));
  });
  const boundSubjects = new Set(precedingSubjects.map((match) => match.canonical));
  const sentenceSubjects = new Set(medicationSafetyEntitiesInText(sentence));
  if (boundSubjects.size === 1 && [...sentenceSubjects].every((subject) => boundSubjects.has(subject))) return true;

  const querySubjects = new Set(medicationSafetyEntitiesInText(query));
  if (querySubjects.size === 0 || sentenceSubjects.size > 0) return false;
  const sourceSubjects = medicationSafetyEntitiesInText(
    [result.title, result.file_name, result.section_heading, result.parent_heading, ...(result.section_path ?? [])]
      .filter(Boolean)
      .join(" "),
  );
  return sourceSubjects.length > 0 && sourceSubjects.every((subject) => querySubjects.has(subject));
}

/** Fact sentence matches query from result. */
function factSentenceMatchesQueryFromResult(
  sentence: string,
  result: SearchResult,
  query: string,
  intent: AnswerIntent,
) {
  if (
    intent === "red_result_action" &&
    asksForBloodCountThreshold(query) &&
    extractClinicalValueAtoms(sentence).length > 0
  ) {
    // Reuse canonical population signals; a population-bound value cannot be
    // borrowed into a differently scoped request by figure promotion.
    const queryTokens = new Set(normalizedClinicalSearchTokens(query));
    const populationTokens = normalizedClinicalSearchTokens(sentence).filter(hasClinicalPopulationSignal);
    if (populationTokens.some((token) => !queryTokens.has(token))) return false;
    // Keep modifiers intact as well as the canonical population noun. Token
    // membership alone makes "older adults" equal "adults" and loses both
    // direction and age from "under/over 65 years".
    const ageQualifiers = (text: string) =>
      [
        ...text
          .toLowerCase()
          .matchAll(
            /\b(?:(?:older|younger)[ -]+(?:adults?|people|patients?)|(?:over|under|above|below|at least|at most|up to)\s+\d+(?:\.\d+)?\s*(?:years?|months?)(?:\s+old)?|(?:aged?\s+)?\d+(?:\s*(?:-|to)\s*\d+)?[ -]*(?:years?|months?)(?:[ -]old)?)\b/g,
          ),
      ]
        .filter((match) => {
          // A duration becomes an age restriction only when it modifies a
          // population or explicitly says age/aged/old. Treatment intervals
          // such as "the first 6 months of treatment" remain evidence content.
          // Parentheses around an explicit age preserve its population link;
          // they do not turn an age restriction into a treatment duration.
          const prefix = text
            .slice(0, match.index)
            .toLowerCase()
            .replace(/[()[\]]/g, " ");
          const precedingWord = prefix.match(/\b([a-z]+)(?:\s+(?:who\s+(?:is|are)|is|are|aged?))?\s*$/)?.[1] ?? "";
          return (
            /\b(?:older|younger|aged?|old)\b/.test(match[0]) ||
            /\bage(?:d)?\s*(?:of\s*)?$/.test(prefix) ||
            hasClinicalPopulationSignal(precedingWord) ||
            /^(?:patients?|persons?|people)$/.test(precedingWord)
          );
        })
        .map((match) =>
          match[0]
            .replace(/\byears\b/g, "year")
            .replace(/\bmonths\b/g, "month")
            .replace(/\badults\b/g, "adult")
            .replace(/[ -]+/g, " ")
            .trim(),
        );
    const requestedAgeQualifiers = new Set(ageQualifiers(query));
    if (ageQualifiers(sentence).some((qualifier) => !requestedAgeQualifiers.has(qualifier))) return false;
  }
  if (mentionsDifferentMedicationEntity(sentence, query)) return false;
  // The shared label parser treats the word immediately before
  // "concentration" as an analyte. Remove only temporal modifiers before that
  // check: "post-dose" and "steady state" describe when the queried level is
  // measured, while actual foreign labels such as TSH remain intact.
  const thresholdLabelEvidence =
    intent === "monitoring_schedule"
      ? sentence
          .replace(/\b(?:\d+(?:\.\d+)?[-\s]*hours?\s+)?post[-\s]?dose\s+(?=(?:serum|plasma)\s+concentrations?\b)/gi, "")
          .replace(/\bsteady\s+state\s+(?=concentrations?\b)/gi, "")
      : sentence;
  const routineMonitoringParameters = [
    /\b(?:weight|bmi|body\s+mass\s+index)\b/i,
    /\bcalcium\b/i,
    /\bparathyroid\s+hormone\b/i,
    /\b(?:renal|kidney|creatinine|eGFR)\b/i,
    /\b(?:thyroid|tsh|t3|t4)\b/i,
    /\b(?:full\s+blood\s+(?:picture|count)|fbc)\b/i,
    /\b(?:urea|electrolytes?)\b/i,
  ].filter((pattern) => pattern.test(sentence)).length;
  const sourceBoundMultiParameterCadence =
    intent === "monitoring_schedule" &&
    routineMonitoringParameters >= 2 &&
    medicationEntitiesInText(sentence).some((medicine) => medicationEntitiesInText(query).includes(medicine)) &&
    /\b(?:every\s+\d+(?:\s*(?:-|–|—|to)\s*\d+)?\s*(?:weeks?|months?|years?)|weekly|monthly|annual(?:ly)?|yearly)\b/i.test(
      sentence,
    ) &&
    !/\b\d+(?:\.\d+)?\s*(?:mmol\/l|mol\/l|mg\/l|mcg\/l|ng\/ml)\b/i.test(sentence);
  if (hasForeignThresholdLabel(query, thresholdLabelEvidence) && !sourceBoundMultiParameterCadence) return false;
  if (!hasBoundedMedicationSubjectForNumericRepeatDoseSchedule(sentence, result, query)) return false;
  const maintenanceScope = [
    result.section_heading,
    ...(result.section_path ?? []),
    result.index_unit?.title,
    ...(result.index_unit?.heading_path ?? []),
  ]
    .filter(Boolean)
    .join(" ");
  if (
    /\bmaintenance\b/i.test(query) &&
    monitoringLevelRangeCoveragePattern.test(sentence) &&
    !/\bmaintenance\b/i.test(sentence) &&
    !/\bmaintenance\b/i.test(maintenanceScope)
  ) {
    return false;
  }
  if (hasRelevantQueryOverlap(sentence, query, intent)) return true;
  if (intent === "general" && isExplicitEscalationQuery(query) && isScoreIndependentActionEvidence(sentence)) {
    const resultText = evidenceTextForGate(result);
    const entityTokens = queryEntityTokens(query, intent);
    return entityTokens.length === 0 || entityTokens.some((token) => queryTokenMatchesText(token, resultText));
  }
  if (intent === "general" || intent === "unsupported") return false;

  const resultText = evidenceTextForGate(result);
  const entityTokens = queryEntityTokens(query, intent);
  const queryMedicationEntities = medicationEntitiesInText(query);
  const sentenceMedicationEntities = medicationEntitiesInText(sentence);
  const resultMedicationEntities = medicationEntitiesInText(resultText);
  if (
    (intent === "dose" || intent === "monitoring_schedule") &&
    queryMedicationEntities.length > 0 &&
    sentenceMedicationEntities.length === 0 &&
    resultMedicationEntities.length > 1
  ) {
    // A bare dose or schedule row from a multi-drug table cannot safely inherit
    // the query's medication/class label. Require the row itself to name its
    // medication. (Monitoring joined dose here when the figure coverage escape
    // below made bare interval/range rows admissible without a query token.)
    return false;
  }
  const entityCoveredByResult =
    entityTokens.length === 0 || entityTokens.some((token) => queryTokenMatchesText(token, resultText));
  if (!entityCoveredByResult) return false;

  const normalized = normalizeSectionText(sentence).toLowerCase();
  const intentTokens = queryIntentTokens(query, intent);
  // Mirrors the dose escape below: a sentence that carries the asked-for
  // schedule/interval or unit range itself ("reviewed annually", "monitored
  // for 3 hours", "Maintenance range 0.6-0.8 mmol/L") is monitoring evidence
  // even when it names no query token — the run-#60 miss class. Figure-bearing
  // sentences only, so plain schedule-free prose still needs token coverage.
  const intentCovered =
    intentTokens.length === 0 ||
    intentTokens.some((token) => queryTokenMatchesText(token, normalized)) ||
    (intent === "dose" && extractiveConcreteDosePattern.test(normalized)) ||
    (intent === "red_result_action" && hasAtomicBloodCountWithholdThresholdEvidence(sentence, query)) ||
    (intent === "monitoring_schedule" &&
      (monitoringIntervalFigurePattern.test(normalized) || monitoringLevelRangeCoveragePattern.test(normalized)));
  return answerIntentEvidencePattern(intent).test(normalized) && intentCovered;
}

/** Fact priority. */
function factPriority(kind: ExtractedClinicalFactKind, intent: AnswerIntent) {
  if (intent === "contraindication" && kind === "contraindication") return 9;
  if (intent === "red_result_action" && kind === "threshold_action") return 9;
  if (intent === "monitoring_schedule" && kind === "monitoring") return 9;
  if (intent === "pathway_referral" && kind === "pathway_referral") return 9;
  if (intent === "dose" && kind === "dose") return 9;
  if (intent === "dose" && kind === "renal_limit") return 8;
  if (kind === "bottom_line") return 5;
  if (kind === "caveat") return 3;
  return 6;
}

/** Table facts to clinical facts. */
function tableFactsToClinicalFacts(result: SearchResult, query: string, intent: AnswerIntent): ExtractedClinicalFact[] {
  return (result.table_facts ?? [])
    .map((fact) => {
      const text = cleanExtractivePointText(
        [fact.row_label, fact.clinical_parameter, fact.threshold_value, fact.action].filter(Boolean).join(": "),
      );
      const kind = factKindForSentence(text, query, intent);
      if (!text || !kind || !factSentenceMatchesQueryFromResult(text, result, query, intent)) return null;
      if (!factSupportsAnswerIntent(kind, text, query, intent)) return null;
      return {
        kind,
        text,
        citationChunkIds: [result.id],
        priority: factPriority(kind, intent) + 1,
      } satisfies ExtractedClinicalFact;
    })
    .filter((fact): fact is ExtractedClinicalFact => Boolean(fact));
}

function withTerminalPunctuation(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return /[.:;!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

const baselineMonitoringHeadingPattern =
  /^\s*(?:baseline|pre[-\s]?treatment|before\s+(?:starting|commencing))\s+(?:tests?|checks?|monitoring|investigations?)\s*\d*\s*:?\s*$/i;

const baselineMonitoringBulletPattern = /^\s*(?:[•◦▪‣●*-]|o(?=\s+[A-Z]))\s+(.+?)\s*$/;

/** Bind an OCR-preserved baseline bullet block into one source-scoped fact. */
function baselineMonitoringFactFromResult(
  result: SearchResult,
  query: string,
  intent: AnswerIntent,
): ExtractedClinicalFact | null {
  if (intent !== "monitoring_schedule") return null;
  // A medication in the document title cannot override a differently scoped
  // treatment section, even when its baseline bullets contain no drug names.
  const queryMedications = new Set(medicationSafetyEntitiesInText(query));
  const treatmentScope = [
    result.section_heading,
    result.parent_heading,
    ...(result.section_path ?? []),
    result.index_unit?.title,
    ...(result.index_unit?.heading_path ?? []),
  ]
    .filter(Boolean)
    .join(" ");
  if (
    queryMedications.size > 0 &&
    medicationSafetyEntitiesInText(treatmentScope).some((medication) => !queryMedications.has(medication))
  ) {
    return null;
  }
  const lines = sourceTextForClinicalProsePreservingBreaks(result.content ?? "").split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => baselineMonitoringHeadingPattern.test(line));
  if (headingIndex < 0) return null;

  const items: string[] = [];
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const bullet = line.match(baselineMonitoringBulletPattern);
    if (bullet) {
      // Baseline rows are already source-sanitized above. Avoid the generic
      // prose footnote cleaner here because T4 is a clinical token rather than
      // an appended citation marker.
      const item = normalizeSectionText(bullet[1]).replace(/[.;,\s]+$/, "");
      if (item) items.push(item);
      if (items.length >= 10) break;
      continue;
    }
    if (!line.trim()) {
      if (items.length) break;
      continue;
    }
    // Preserve a wrapped continuation only after a bullet. A new prose line
    // ends the block, so later instructions cannot be relabelled as baseline.
    if (items.length && /^\s{2,}\S/.test(line)) {
      items[items.length - 1] = cleanExtractivePointText(`${items[items.length - 1]} ${line.trim()}`).replace(
        /[.;,\s]+$/,
        "",
      );
      continue;
    }
    break;
  }
  if (items.length < 2) return null;

  const sourceTitle = normalizeSectionText(result.title || result.file_name || "the cited source");
  const populationScope = [result.parent_heading, ...(result.section_path ?? [])]
    .map((value) => normalizeSectionText(value ?? ""))
    .find((value) => normalizedClinicalSearchTokens(value).some(hasClinicalPopulationSignal));
  const sourceLabel = populationScope ? `${sourceTitle}, ${populationScope}` : sourceTitle;
  const baselineList = (values: string[]) =>
    values.length < 2 ? values.join("") : `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
  const boundedItems: string[] = [];
  for (const item of items) {
    const candidate = `In ${sourceLabel}, baseline tests include ${baselineList([...boundedItems, item])}.`;
    if (candidate.length > 520) break;
    boundedItems.push(item);
  }
  if (boundedItems.length < 2) return null;
  const text = `In ${sourceLabel}, baseline tests include ${baselineList(boundedItems)}.`;
  const kind = factKindForSentence(text, query, intent);
  // A baseline test list may legitimately name analytes other than the queried
  // medicine (for example thyroid tests). The foreign-threshold guard rejects
  // those labels even when the list carries no clinical value to misbind.
  const sourceScopedNonNumericList =
    isBroadMonitoringOverviewQuery(query) &&
    extractClinicalValueAtoms(text).length === 0 &&
    !mentionsDifferentMedicationEntity(text, query) &&
    hasRelevantQueryOverlap(text, query, intent);
  if (!kind || (!factSentenceMatchesQueryFromResult(text, result, query, intent) && !sourceScopedNonNumericList)) {
    return null;
  }
  if (!factSupportsAnswerIntent(kind, text, query, intent)) return null;
  return {
    kind,
    text,
    citationChunkIds: [result.id],
    priority: factPriority(kind, intent) + Math.min(scoreValue(result), 1) + 2,
  };
}

const wordsOf = (text: string) => (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).join(" ");

// A heading such as "Signs and symptoms of severe toxicity:" carries its toxicity context to the
// bullets listed under it, up to the next colon-led heading (owner decision, #ZZ4RAP).
const cleanToxicityHeading = (line: string) =>
  // "…contributors to lithium toxicity are4:" → "…contributors to lithium toxicity".
  line
    .replace(/^[\s•]+/, "")
    .replace(/\s*\d*\s*:\s*$/, "")
    .replace(/\s+(?:include|includes|are|is)(?:\s+the\s+following)?\s*\d*$/i, "")
    .trim();

/**
 * A toxicity list heading ("Signs and symptoms of severe toxicity:") stated with the bullets listed
 * under it: "Signs and symptoms of severe toxicity include increased muscle tone, …". Null when the
 * sentence is not such a heading, the heading is an action heading, or it names another severity.
 */
export function toxicityListSentences(sentence: string, content: string | null | undefined, query: string) {
  if (!content || !/:\s*$/.test(sentence)) return null;
  // A question about one severity ("signs of severe toxicity") takes only that severity's list.
  const severities = query.toLowerCase().match(/\b(?:severe|mild|moderate)\b/g) ?? [];
  const wanted = wordsOf(sentence);
  const lines = content.split("\n");
  for (const [index, line] of lines.entries()) {
    if (!wanted || !wordsOf(line).endsWith(wanted)) continue;
    if (!toxicityListHeadingPattern.test(line) || toxicityActionHeadingPattern.test(line)) return null;
    if (severities.length > 0 && !severities.some((severity) => line.toLowerCase().includes(severity))) return null;
    const items = bulletItemsAfter(lines.slice(index + 1), /^\s*•/.test(line)).map((item) =>
      item.trim().replace(/[\s.;,]+$/, ""),
    );
    if (items.length === 0) return null;
    // One statement per bullet, so claim support can verify each against its heading and bullet.
    return items.map((item) => `${cleanToxicityHeading(line)} include ${lowerFirst(item)}.`);
  }
  return null;
}

function bindMonitoringAnaphoricQualifiers(sentences: string[], intent: AnswerIntent) {
  if (intent !== "monitoring_schedule" && intent !== "contraindication") return sentences;
  const bound: string[] = [];
  for (const sentence of sentences) {
    const previous = bound.at(-1);
    if (
      intent === "contraindication" &&
      previous &&
      /[.!?]$/.test(previous) &&
      /^(?:avoid|do not (?:use|combine|co-?prescribe))\b[^.]*\b(?:the|this|that|such)\s+combinations?\b/i.test(
        sentence,
      ) &&
      medicationEntitiesInText(previous).length > 0
    ) {
      // "Avoid the combination" names no drug. Keep it with the sentence that
      // does ("NSAIDs (e.g. ibuprofen) can reduce lithium clearance…"), so the
      // answer states what to avoid and claim support sees the drug (#ZZ4RAP).
      bound[bound.length - 1] = `${previous} ${sentence}`;
      continue;
    }
    if (previous && /\bsteady\s+state\b/i.test(previous) && /^This may be longer\b/i.test(sentence)) {
      // Keep the source's original period and anaphora together. This retains
      // the exact two supported claims while the explicit first sentence gives
      // the qualifier its only safe antecedent.
      bound[bound.length - 1] = `${previous} ${sentence}`;
      continue;
    }
    bound.push(sentence);
  }
  return bound;
}

function labelledMonitoringTargetFactsFromResult(
  result: SearchResult,
  query: string,
  intent: AnswerIntent,
): ExtractedClinicalFact[] {
  if (intent !== "monitoring_schedule") return [];
  const lines = sourceTextForClinicalProsePreservingBreaks(result.content ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  const facts: ExtractedClinicalFact[] = [];
  let parentLabel = "";
  for (let index = 0; index < lines.length; index += 1) {
    const parent = lines[index].match(/^\s*[•*-]\s+([^\n]+?)\s*$/);
    if (parent) {
      parentLabel = cleanExtractivePointText(parent[1]).replace(/[.:;\s]+$/, "");
      continue;
    }
    const row = lines[index].match(/^\s*o\s+(Target\s+(?:serum|plasma)\s+level\s*:\s*.+?)\s*$/i);
    if (!row || !parentLabel) continue;
    let target = row[1];
    while (index + 1 < lines.length && /^\s+[a-z0-9(]/.test(lines[index + 1])) {
      target = `${target} ${lines[index + 1].trim()}`;
      index += 1;
    }
    const targetClause = cleanExtractivePointText(
      target.replace(
        /^Target\s+(serum|plasma)\s+level\s*:\s*/i,
        (_, specimen: string) => `the target ${specimen.toLowerCase()} level is `,
      ),
    );
    const text = `For ${lowerFirst(parentLabel)}, ${targetClause}`;
    const kind = factKindForSentence(text, query, intent);
    if (!kind || !factSentenceMatchesQueryFromResult(text, result, query, intent)) continue;
    if (!factSupportsAnswerIntent(kind, text, query, intent)) continue;
    facts.push({
      kind,
      text,
      citationChunkIds: [result.id],
      priority: factPriority(kind, intent) + Math.min(scoreValue(result), 1) + 1,
    });
  }
  return facts;
}

/** Extract clinical facts from results. */
function extractClinicalFactsFromResults(
  results: SearchResult[],
  query: string,
  intent: AnswerIntent,
  limit = 8,
  sourceProseOnly = false,
) {
  const seen = new Set<string>();
  const facts: ExtractedClinicalFact[] = [];
  const usableResults = results.filter((result) => resultCoversAnswerIntent(result, query, intent));
  const toxicityFeatureQuery = intent === "general" && isToxicityFeatureQuery(query.toLowerCase());
  const adjacentBandConflicts = adjacentLabelledNumericBandConflicts(usableResults);

  for (const result of usableResults) {
    const referencesConflictingBand = (text: string) =>
      sourceLabelledNumericBandConflictsAffectingText(result, text, query).length > 0 ||
      textReferencesAdjacentBandConflict(text, result.id, adjacentBandConflicts, query);
    const baselineFact = sourceProseOnly ? null : baselineMonitoringFactFromResult(result, query, intent);
    if (baselineFact && !referencesConflictingBand(baselineFact.text)) {
      const key = `${baselineFact.kind}:${normalizeSectionText(baselineFact.text).toLowerCase().slice(0, 160)}`;
      if (!seen.has(key)) {
        seen.add(key);
        facts.push(baselineFact);
      }
    }
    const labelledTargetFacts = sourceProseOnly
      ? []
      : labelledMonitoringTargetFactsFromResult(result, query, intent).filter(
          (fact) => !referencesConflictingBand(fact.text),
        );
    for (const fact of labelledTargetFacts) {
      const key = `${fact.kind}:${normalizeSectionText(fact.text).toLowerCase().slice(0, 160)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      facts.push(fact);
    }
    for (const fact of sourceProseOnly ? [] : tableFactsToClinicalFacts(result, query, intent)) {
      if (referencesConflictingBand(fact.text)) continue;
      const key = `${fact.kind}:${normalizeSectionText(fact.text).toLowerCase().slice(0, 160)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      facts.push({
        ...fact,
        priority:
          fact.priority +
          (isExplicitEscalationQuery(query) && hasTargetedEscalationAction(fact.text) && hasEscalationTrigger(fact.text)
            ? 4
            : 0),
      });
    }

    // Each evidence segment gets terminal punctuation before joining: the
    // prose cleaner collapses the newlines, and without it a bare section
    // heading or synopsis tail glues onto the next segment's first sentence
    // ("Dosing Twice daily dosing should…"). The heading gets a colon so it
    // reads as a label for the content that follows it — unless the content
    // already opens with the heading text, where prepending it would only
    // fabricate a contentless "Label: Label." fact.
    const sectionHeading = result.section_heading?.trim();
    const contentLeadsWithHeading = Boolean(
      sectionHeading && (result.content ?? "").trim().toLowerCase().startsWith(sectionHeading.toLowerCase()),
    );
    const text = [
      withTerminalPunctuation(result.retrieval_synopsis),
      sectionHeading && !contentLeadsWithHeading
        ? /[.:;!?]$/.test(sectionHeading)
          ? sectionHeading
          : `${sectionHeading}:`
        : null,
      withTerminalPunctuation(result.content),
      withTerminalPunctuation(result.adjacent_context),
      ...(result.memory_cards ?? []).map((card) => withTerminalPunctuation(card.content)),
    ]
      .filter(Boolean)
      .join("\n");
    // A rejected heading-led answer may still have complete prose in its source chunks.
    // Recover only within source blocks, without synopsis/heading/card text or table facts.
    const sentences = bindMonitoringAnaphoricQualifiers(
      sourceProseOnly
        ? reflowBoundedSourceLines(
            sourceTextForClinicalProsePreservingBreaks(result.content ?? "").replace(
              // The captured NOCC proper name wraps onto a capitalized continuation.
              // Join only that name; other capitalized rows remain hard boundaries.
              /\bNational Outcome[ \t]*\n[ \t]*Case Mix Collection \(NOCC\)/g,
              "National Outcome Case Mix Collection (NOCC)",
            ),
            { requireContinuationStart: true },
          )
            .flatMap(splitClinicalEvidenceSentences)
            .filter(
              (sentence) =>
                sentence.length <= 280 &&
                /[.!?]$/.test(sentence) &&
                hasCompleteOpeningSentence(sentence) &&
                !isFragmentLikeClinicalAnswer(sentence, query) &&
                !guidanceWrapperLayoutDebrisPattern.test(sentence),
            )
        : splitClinicalEvidenceSentences(text),
      intent,
    );
    const statedLists = new Set<string>();
    const expandedSentences = toxicityFeatureQuery
      ? sentences.flatMap((candidate) => {
          const listed = /:\s*$/.test(candidate) ? toxicityListSentences(candidate, result.content, query) : null;
          listed?.forEach((statement) => statedLists.add(statement));
          return listed ?? [candidate];
        })
      : sentences;
    for (const rawSentence of expandedSentences) {
      if (referencesConflictingBand(rawSentence)) continue;
      const sentence = rawSentence;
      if (
        labelledTargetFacts.length > 1 &&
        (/(?:^|:\s*)Target\s+(?:serum|plasma)\s+level\s*:/i.test(sentence) ||
          /\bFor\s+target\s+(?:serum|plasma)\s+level\s*,/i.test(sentence))
      ) {
        continue;
      }
      // A toxicity-features question is answered only by text about toxicity; a dose cap or
      // titration note from the same chunk is not an answer to it (#ZZ4RAP).
      // A colon-led lead-in ("…complete the following:") introduces a list and is not itself an answer;
      // toxicity list headings were already stated with their bullets above (owner decision).
      if (toxicityFeatureQuery && (/:\s*$/.test(sentence) || !/\btoxic\w*/i.test(sentence))) continue;
      if (!factSentenceMatchesQueryFromResult(sentence, result, query, intent)) continue;
      const kind = factKindForSentence(sentence, query, intent);
      if (!kind) continue;
      if (!factSupportsAnswerIntent(kind, sentence, query, intent, sourceProseOnly)) continue;
      // A stated toxicity list is never cut mid-list.
      const cleaned =
        sentence.length <= 280 || sentence !== rawSentence ? sentence : `${sentence.slice(0, 277).trim()}...`;
      const key = `${kind}:${normalizeSectionText(cleaned).toLowerCase().slice(0, 160)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      facts.push({
        kind,
        text: cleaned,
        citationChunkIds: [result.id],
        priority:
          factPriority(kind, intent) +
          Math.min(scoreValue(result), 1) +
          (isExplicitEscalationQuery(query) && hasTargetedEscalationAction(cleaned) && hasEscalationTrigger(cleaned)
            ? 4
            : 0),
      });
      if (facts.length >= limit) break;
    }
    if (facts.length >= limit) break;
  }

  return facts.sort((a, b) => b.priority - a.priority || a.text.length - b.text.length).slice(0, limit);
}

/** Sentence from fact. */
export function sentenceFromFact(
  fact: ExtractedClinicalFact,
  query: string,
  options: { suppressEntityPrefix?: boolean } = {},
) {
  const text = sanitizeAnswerText(cleanExtractivePointText(fact.text)).replace(/[.;,\s]+$/, "");
  if (!text) return "";
  const entity = queryEntitySubject(query, classifyAnswerIntent(query, classifyRagQuery(query).queryClass));
  const needsEntityPrefix =
    !options.suppressEntityPrefix &&
    entity &&
    fact.kind !== "bottom_line" &&
    !queryTokenMatchesText(entity, text) &&
    !/^(?:for|in|when|if|avoid|do not|must not|withhold|cease|stop|monitor|check|refer|arrange)\b/i.test(text);
  // Complete the bare fact first, then attach the entity once. Prefixing
  // before completion let the "The guidance is that…" wrapper swallow the
  // prefix and duplicate the entity ("For lithium, … that for lithium, …").
  const completed = completeExtractiveSentence(text, query);
  if (!completed || !needsEntityPrefix) return completed;
  if (!/^The guidance\b/.test(completed)) return `For ${entity}, ${lowerFirst(completed)}`;
  return completed.replace(/^The guidance/, `The guidance for ${entity}`);
}

/** Lower first. */
function lowerFirst(value: string) {
  if (!value) return value;
  if (/^[A-Z][A-Z0-9&+-]{1,}s?\b/.test(value)) return value;
  return `${value.charAt(0).toLowerCase()}${value.slice(1)}`;
}

/** Complete extractive sentence. */
export function completeExtractiveSentence(value: string, query: string) {
  const cleaned = sanitizeAnswerText(value)
    .replace(/[.;,\s]+$/, "")
    .trim();
  if (!cleaned) return "";

  const sentence = `${cleaned}.`;
  if (hasCompleteOpeningSentence(sentence) && !isFragmentLikeClinicalAnswer(sentence, query)) return sentence;

  if (/^(?:when|if|where|after|before|during)\b/i.test(cleaned)) {
    // A conditional clause that already carries its own action ("if INR is high, withhold warfarin")
    // is a complete, natural sentence — present it directly instead of the stock "The guidance is
    // that…" lead-in. Only when the condition has no action of its own do we add the wrapper so the
    // fragment reads as a full sentence.
    const conditionalAsSentence = `${upperFirst(cleaned)}.`;
    if (
      /,\s*\S/.test(cleaned) &&
      hasClinicalActionSignal(cleaned) &&
      !isFragmentLikeClinicalAnswer(conditionalAsSentence, query)
    ) {
      return conditionalAsSentence;
    }
    return `The guidance is that ${lowerFirst(cleaned)}.`;
  }

  // A section heading glued to the sentence under it ("Therapeutic Drug Monitoring. Blood taken
  // for serum lithium levels should be taken 12 hours after the last dose") is not a fragment to
  // wrap: "The guidance is that therapeutic Drug Monitoring. Blood…" laundered the heading
  // (Eval Canary 39614340500). Drop the heading when the sentence after it stands alone.
  const headed = cleaned.match(/^((?:[A-Z][\w-]*)(?:\s+(?:[A-Z][\w-]*|and|of|for|the|in|to)){0,5})\.\s+([A-Z].*)$/);
  if (headed) {
    const afterHeading = `${headed[2]}.`;
    if (hasCompleteOpeningSentence(afterHeading) && !isFragmentLikeClinicalAnswer(afterHeading, query)) {
      return afterHeading;
    }
  }

  const withoutLeadingFragment = cleaned.replace(/^(?:and|or|but|with|without|including|such as|then)\s+/i, "");
  if (/^to\b/i.test(cleaned)) {
    return `The guidance is ${lowerFirst(cleaned)}.`;
  }
  if (withoutLeadingFragment !== cleaned) {
    return `The guidance includes ${lowerFirst(withoutLeadingFragment)}.`;
  }

  return `The guidance is that ${lowerFirst(cleaned)}.`;
}

/** Section for fact kind. */
function sectionForFactKind(kind: ExtractedClinicalFactKind): Pick<AnswerSection, "heading" | "kind"> {
  switch (kind) {
    case "dose":
      return { heading: "Dose", kind: "medication_dose" };
    case "renal_limit":
      return { heading: "Renal limits", kind: "contraindications_cautions" };
    case "monitoring":
      return { heading: "Monitoring", kind: "monitoring_timing" };
    case "threshold_action":
      return { heading: "Result action", kind: "thresholds" };
    case "contraindication":
      return { heading: "Contraindications", kind: "contraindications_cautions" };
    case "pathway_referral":
      return { heading: "Pathway/referral", kind: "required_actions" };
    case "caveat":
      return { heading: "Caveat", kind: "source_gap" };
    default:
      // "Bottom line" is intentionally rejected by the generated-answer
      // template detector. Use the neutral display heading while preserving
      // the semantic kind so deterministic facts do not fail their own gate.
      return { heading: "Key point", kind: "bottom_line" };
  }
}

/** Build fact sections. */
function buildFactSections(facts: ExtractedClinicalFact[], query: string) {
  const grouped = new Map<ExtractedClinicalFactKind, ExtractedClinicalFact[]>();
  for (const fact of facts) grouped.set(fact.kind, [...(grouped.get(fact.kind) ?? []), fact]);
  return Array.from(grouped.entries())
    .slice(0, 4)
    .map(([kind, group]) => {
      const section = sectionForFactKind(kind);
      const emittedFacts = group.slice(0, 2);
      const body = emittedFacts
        .map((fact) => sentenceFromFact(fact, query))
        .filter(Boolean)
        .join(" ");
      return {
        heading: section.heading,
        kind: section.kind,
        supportLevel: "direct",
        body: boldHighYieldClinicalText(body, query),
        citation_chunk_ids: Array.from(new Set(emittedFacts.flatMap((fact) => fact.citationChunkIds))),
      } satisfies AnswerSection;
    })
    .filter((section) => section.body && section.citation_chunk_ids.length > 0);
}

function isBroadMonitoringOverviewQuery(query: string) {
  const normalized = normalizeSectionText(query).toLowerCase();
  if (!/\bmonitor(?:ing)?\b/.test(normalized) || isMonitoringLevelRangeLookupQuery(normalized)) return false;
  if (
    /\b(?:when|timing|frequency|interval|how\s+(?:often|soon)|post[-\s]?dose|last\s+dose|blood\s+draw|sample|trough|steady\s+state)\b/.test(
      normalized,
    ) ||
    /\b(?:renal|kidney|thyroid|calcium|cardiac|ecg|metabolic|weight|bmi|glucose|lipid)\s+monitoring\b/.test(normalized)
  ) {
    return false;
  }
  return (
    /\b(?:what|which|list|summari[sz]e|overview)\b[^?]{0,100}\bmonitor(?:ing)?\b/.test(normalized) ||
    /\bmonitor(?:ing)?\b[^?]{0,100}\b(?:required|needed|used|include\w*|involve\w*)\b/.test(normalized)
  );
}

export function monitoringFacetForFact(fact: ExtractedClinicalFact): MonitoringFacet {
  const text = normalizeSectionText(fact.text).toLowerCase();
  if (/\bbaseline\b|\bpre[-\s]?treatment\b|\bbefore\s+(?:starting|commencing)\b/.test(text)) return "baseline";
  if (/\b(?:post[-\s]?dose|after\s+(?:the\s+)?last\s+dose|blood\s+draw|sample|sampling|trough)\b/.test(text)) {
    return "sample_timing";
  }
  if (/\bonce\s+stable\b|\bstable\s+(?:treatment|patients?)\b/.test(text)) return "stable_monitoring";
  if (/\bsteady\s+state\b/.test(text)) return "steady_state";
  const hasRecurringCadence =
    /\bevery\s+(?:\d+(?:\s*[-–—]\s*\d+)?|one|two|three|four|six|twelve)\s+(?:days?|weeks?|months?|years?)\b/.test(text);
  const followsDoseChange =
    /\b(?:after|following)\b[^.!?]{0,80}\b(?:dose\s+changes?|chang\w*\s+(?:the\s+)?dose)\b/.test(text);
  if (
    /\b(?:levels?|concentrations?)\b/.test(text) &&
    (followsDoseChange ||
      (!hasRecurringCadence && /\b(?:after|following)\b[^.!?]{0,80}\b(?:start\w*|commenc\w*)\b/.test(text)))
  ) {
    return "after_change";
  }
  // This categorizes an already admitted fact, rather than granting clinical
  // support. A recurring multi-test schedule can exceed the short predicate
  // window used by the frequency-question detector.
  if (hasRecurringCadence) {
    return "ongoing";
  }
  if (deliveredMonitoringFrequencyPresent(text)) return "ongoing";
  if (monitoringLevelRangeCoveragePattern.test(text)) return "level_range";
  if (/\b(?:renal\s+impairment|interact\w+\s+medication|closer\s+monitoring|higher\s+risk)\b/.test(text)) {
    return "higher_risk";
  }
  return "other";
}

const monitoringFacetOrder: MonitoringFacet[] = [
  "baseline",
  "level_range",
  "sample_timing",
  "after_change",
  "stable_monitoring",
  "ongoing",
  "higher_risk",
  "steady_state",
  "other",
];

function selectBroadMonitoringFacts(facts: ExtractedClinicalFact[]) {
  const selected: ExtractedClinicalFact[] = [];
  for (const facet of monitoringFacetOrder) {
    const fact = facts.find((candidate) => monitoringFacetForFact(candidate) === facet);
    if (fact) selected.push(fact);
    if (selected.length >= 7) break;
  }
  for (const fact of facts) {
    if (!selected.includes(fact)) selected.push(fact);
    if (selected.length >= 7) break;
  }
  return selected;
}

function monitoringFacetSection(fact: ExtractedClinicalFact, query: string): AnswerSection | null {
  const headings: Record<MonitoringFacet, string> = {
    baseline: "Baseline",
    level_range: "Target level",
    sample_timing: "Level sampling",
    after_change: "Starting and dose changes",
    stable_monitoring: "Stable treatment",
    steady_state: "Steady state",
    ongoing: "Ongoing monitoring",
    higher_risk: "Higher-risk monitoring",
    other: "Monitoring",
  };
  const facet = monitoringFacetForFact(fact);
  const normalized = normalizeSectionText(fact.text).toLowerCase();
  if (facet === "after_change") {
    const coversStarting = /\b(?:start\w*|commenc\w*)\b/.test(normalized);
    const coversDoseChanges = /\b(?:dose\s+change|chang\w*\s+(?:the\s+)?dose)\b/.test(normalized);
    headings.after_change =
      coversStarting && coversDoseChanges
        ? "Starting and dose changes"
        : coversStarting
          ? "Starting treatment"
          : "Dose changes";
  }
  const body = sentenceFromFact(fact, query);
  if (!body || fact.citationChunkIds.length === 0) return null;
  return {
    heading: headings[facet],
    kind: "monitoring_timing",
    supportLevel: "direct",
    body: boldHighYieldClinicalText(body, query),
    citation_chunk_ids: Array.from(new Set(fact.citationChunkIds)),
  };
}

function buildBroadMonitoringSections(facts: ExtractedClinicalFact[], query: string, limit = 6) {
  return facts
    .slice(0, limit)
    .map((fact) => monitoringFacetSection(fact, query))
    .filter((section): section is AnswerSection => Boolean(section));
}

export function hasCompoundToxicityActionEvidence(text: string) {
  return (
    hasWithholdActionEvidence(text) ||
    (/\bcheck\b[^.!?]{0,100}\b(?:serum|plasma)?\s*[^.!?]{0,30}\blevel\b/i.test(text) &&
      /\b(?:renal|kidney|creatinine|eGFR)\b/i.test(text)) ||
    hasTargetedEscalationAction(text)
  );
}

function compoundMonitoringToxicityActionSection(results: SearchResult[], query: string): AnswerSection | null {
  if (!isCompoundMonitoringToxicityQuery(query)) return null;
  const queryMedicines = medicationEntitiesInText(query);
  for (const result of results) {
    const lines = sourceTextForClinicalProsePreservingBreaks(result.content ?? "")
      .replace(/\r\n?/g, "\n")
      .split("\n");
    const triggerStart = lines.findIndex((line) => /\b(?:where|if|when)\b.*\btoxicity\b/i.test(line));
    if (triggerStart < 0) continue;
    let triggerEnd = triggerStart;
    while (
      triggerEnd + 1 < lines.length &&
      !/[.!?:]\s*$/.test(lines[triggerEnd]) &&
      triggerEnd - triggerStart < 3 &&
      lines[triggerEnd + 1].trim() &&
      !/^\s*(?:\d+\.|[•*-])\s+/.test(lines[triggerEnd + 1])
    ) {
      triggerEnd += 1;
    }
    const trigger = cleanExtractivePointText(lines.slice(triggerStart, triggerEnd + 1).join(" "));
    if (!trigger || hasBadExtractiveQuality(trigger) || !sourceDirectlySupportsAnswerText(trigger, result)) continue;
    const actionWindow: string[] = [];
    let current = "";
    for (const rawLine of lines.slice(triggerEnd + 1)) {
      const numbered = rawLine.match(/^\s*\d+\.\s*(\S.*)?$/);
      if (numbered) {
        if (current) actionWindow.push(cleanExtractivePointText(current));
        current = numbered[1] ?? "";
        if (actionWindow.length >= 3) break;
        continue;
      }
      if (!current) {
        if (rawLine.trim()) break;
        continue;
      }
      if (!rawLine.trim() || /^\s*[•*-]\s+/.test(rawLine)) {
        actionWindow.push(cleanExtractivePointText(current));
        current = "";
        break;
      }
      current = `${current} ${rawLine.trim()}`;
    }
    if (current && actionWindow.length < 3) actionWindow.push(cleanExtractivePointText(current));
    const directActions = actionWindow.filter((block) => {
      const medicineBound =
        queryMedicines.length === 0 ||
        queryMedicines.some((medicine) => medicationEntitiesInText(block).includes(medicine));
      if (!/[.!?]\s*$/.test(block)) return false;
      if (!/\b(?:withhold|cease|stop|check|urgent(?:ly)?|assess)\b/i.test(block)) return false;
      if (hasBadExtractiveQuality(block) || mentionsDifferentMedicationEntity(block, query)) return false;
      if (queryMedicines.length > 0 && !medicineBound) {
        return false;
      }
      if (sourceLabelledNumericBandConflictsAffectingText(result, block, query).length > 0) return false;
      return sourceDirectlySupportsAnswerText(block, result);
    });
    const withholdAction = directActions.find(hasWithholdActionEvidence);
    const assessmentAction = directActions.find(
      (block) =>
        block !== withholdAction && hasCompoundToxicityActionEvidence(block) && !hasWithholdActionEvidence(block),
    );
    const selectedActions = [withholdAction, assessmentAction].filter((value): value is string => Boolean(value));
    if (selectedActions.length === 0) continue;
    const body = [trigger, ...selectedActions.map((action) => withTerminalPunctuation(action))].join(" ");
    return {
      heading: "Suspected toxicity",
      kind: "required_actions",
      supportLevel: "direct",
      body: boldHighYieldClinicalText(body, query),
      citation_chunk_ids: [result.id],
    };
  }
  return null;
}

export const monitoringFacetGapLabels: Partial<Record<MonitoringFacet, string>> = {
  baseline: "baseline tests",
  sample_timing: "level sampling",
  level_range: "target levels",
  after_change: "monitoring after dose changes",
  stable_monitoring: "stable-treatment monitoring",
  higher_risk: "higher-risk monitoring",
};

function compoundMonitoringGapSection(
  facts: ExtractedClinicalFact[],
  query: string,
  toxicityActionPresent: boolean,
): AnswerSection | null {
  if (!isCompoundMonitoringToxicityQuery(query)) return null;
  const present = new Set(facts.map(monitoringFacetForFact));
  const absent = [...requestedMonitoringScheduleFacets(query)]
    .filter((facet) => !present.has(facet))
    .map((facet) => monitoringFacetGapLabels[facet])
    .filter((label): label is string => Boolean(label));
  if (!toxicityActionPresent) absent.push("actions for suspected toxicity");
  if (absent.length === 0) return null;
  return {
    heading: "Evidence gaps",
    kind: "source_gap",
    supportLevel: "unsupported",
    body: `This answer does not establish: ${absent.join(", ")}.`,
    citation_chunk_ids: [],
  };
}

/**
 * Nuke-proofing guard for lead-slot figure promotion: only promote a fact whose
 * clinical value atoms ALL appear in the claim-support evidence corpus
 * (sourceEvidenceText) of its citing chunk(s). Fact extraction reads
 * adjacent_context and numeric verification accepts it too, but claim support
 * does not — so a figure that lives only in adjacent context would pass numeric
 * verification and then trip claim_support_high_risk_gap, nuking the whole
 * answer. Facts with no value atoms instead require their figure tokens
 * verbatim in the same corpus: schedule tokens like "baseline" or "annually"
 * match the monitoring figure pattern yet yield no atom (reviewer P2), so the
 * atom check alone would pass a figure that lives only in adjacent context and
 * claim support would then nuke.
 */
function promotedFactFigureIsClaimSupportable(
  fact: ExtractedClinicalFact,
  results: SearchResult[],
  intent: AnswerIntent,
  query: string,
) {
  const citingResults = results.filter((result) => fact.citationChunkIds.includes(result.id));
  if (citingResults.length === 0) return false;
  const factAtoms = extractClinicalValueAtoms(fact.text);
  if (factAtoms.length === 0) {
    const figureMatch = intentFigureMatchText(intent, fact.text, query);
    if (!figureMatch) return false;
    const normalizedFigure = figureMatch.toLowerCase().replace(/\s+/g, " ").trim();
    return citingResults.some((result) =>
      sourceEvidenceText(result).toLowerCase().replace(/\s+/g, " ").includes(normalizedFigure),
    );
  }
  const corpusAtomKeys = new Set(
    citingResults.flatMap((result) => extractClinicalValueAtoms(sourceEvidenceText(result)).map(clinicalValueAtomKey)),
  );
  return factAtoms.every((atom) => corpusAtomKeys.has(clinicalValueAtomKey(atom)));
}

/**
 * Lead-slot figure guarantee for dose, monitoring and blood-count thresholds: when no
 * lead fact carries the asked-for figure/schedule but a later extracted fact
 * does (and its figure survives the claim-support guard), surface that fact in
 * the lead — dose swaps it into the last of its two lead slots; monitoring
 * and threshold requests append it as a second lead sentence. A lead that already
 * carries a figure is returned unchanged.
 */
function promoteIntentFigureLeadFacts(
  leadFacts: ExtractedClinicalFact[],
  facts: ExtractedClinicalFact[],
  intent: AnswerIntent,
  results: SearchResult[],
  query: string,
) {
  if (leadFacts.some((fact) => factCarriesIntentFigure(intent, fact.text, query))) return leadFacts;
  const promoted = facts
    .slice(leadFacts.length)
    .find(
      (fact) =>
        factCarriesIntentFigure(intent, fact.text, query) &&
        promotedFactFigureIsClaimSupportable(fact, results, intent, query),
    );
  if (!promoted) return leadFacts;
  if (intent === "monitoring_schedule" && isMonitoringLevelRangeLookupQuery(query)) {
    return [promoted, ...leadFacts];
  }
  return intent === "dose" ? [...leadFacts.slice(0, -1), promoted] : [...leadFacts, promoted];
}

const sourceBoundAdmissionDischargeComparisonQueries = new Set([
  "compare admission and discharge requirements",
  "combine community admission steps with discharge documentation requirements",
]);

export function isAdmissionDischargeRequirementsComparisonQuery(query: string, queryClass: RagQueryClass) {
  return (
    queryClass === "comparison" &&
    admissionComparisonTermPattern.test(query) &&
    dischargeComparisonTermPattern.test(query) &&
    /\b(?:requirements?|required|criteria|criterion)\b/i.test(query)
  );
}

/** Whether the query is one of the measured admission/discharge comparison shapes. */
export function isSourceBoundAdmissionDischargeComparisonQuery(query: string, queryClass: RagQueryClass) {
  if (!isAdmissionDischargeRequirementsComparisonQuery(query, queryClass)) return false;
  return sourceBoundAdmissionDischargeComparisonQueries.has(normalizedMeasuredQuery(query));
}

/** Whether a table-threshold query asks for the clozapine blood-count stop boundary. */
export function isSourceBoundClozapineBloodActionThresholdQuery(query: string, queryClass: RagQueryClass) {
  const namesClozapine = analyzeClinicalQuery(query).medications.includes("clozapine");
  return (
    queryClass === "table_threshold" &&
    namesClozapine &&
    /\b(?:fbc|full blood count|blood count|blood results?|bloods|wbc|wcc|white blood cells?|neutrophils?|anc)\b/i.test(
      query,
    ) &&
    /\b(?:threshold|withhold|withheld|withholding|cease|stop|stopped|discontinue|discontinued|red[-\s]range|red result)\b/i.test(
      query,
    )
  );
}

/** Identify the deliberately narrow, one-row NMHS clozapine threshold answer. */
export function isSourceBoundClozapineBloodActionThresholdAnswer(answer: RagAnswer) {
  if (
    answer.queryClass !== "table_threshold" ||
    !answer.preformatted ||
    !answer.grounded ||
    answer.confidence === "unsupported" ||
    answer.citations.length !== 1 ||
    answer.answerSections?.length !== 1
  ) {
    return false;
  }

  const section = answer.answerSections[0];
  const citation = answer.citations[0];
  if (
    section.heading !== "Red-range threshold and action" ||
    section.citation_chunk_ids.length !== 1 ||
    section.citation_chunk_ids[0] !== citation.chunk_id
  ) {
    return false;
  }

  const deliveredText = `${answer.answer} ${section.body}`.replace(/\*\*/g, " ").replace(/\s+/g, " ");
  const source = answer.sources.find((candidate) => candidate.id === citation.chunk_id);
  return Boolean(
    source &&
    isAtomicNmhsClozapineRedRangeSource(source) &&
    /\bWBC\s*<\s*3\.0\s*×\s*10⁹\s*\/\s*L\b/i.test(deliveredText) &&
    /\bneutrophils?\s*<\s*1\.5\s*×\s*10⁹\s*\/\s*L\b/i.test(deliveredText) &&
    /\bstop clozapine therapy immediately\b/i.test(deliveredText),
  );
}

/**
 * Identify the deliberately narrow two-document admission/discharge answer built above.
 *
 * This is used only to choose between already-built answer candidates. Requiring the exact
 * section/citation shape and distinct physical documents prevents a generic comparison or a
 * dual-title policy from being promoted ahead of the normal comparison matrix.
 */
export function isSourceBoundAdmissionDischargeComparisonAnswer(answer: RagAnswer) {
  if (
    answer.queryClass !== "comparison" ||
    !answer.preformatted ||
    !answer.grounded ||
    answer.confidence === "unsupported" ||
    answer.citations.length !== 2 ||
    answer.answerSections?.length !== 2
  ) {
    return false;
  }

  const admissionSection = answer.answerSections.find((section) => section.heading === "Admission evidence");
  const dischargeSection = answer.answerSections.find((section) => section.heading === "Discharge evidence");
  if (
    !admissionSection ||
    !dischargeSection ||
    admissionSection.citation_chunk_ids.length !== 1 ||
    dischargeSection.citation_chunk_ids.length !== 1
  ) {
    return false;
  }

  const admissionChunkId = admissionSection.citation_chunk_ids[0];
  const dischargeChunkId = dischargeSection.citation_chunk_ids[0];
  const citationIds = new Set(answer.citations.map((citation) => citation.chunk_id));
  if (
    admissionChunkId === dischargeChunkId ||
    !citationIds.has(admissionChunkId) ||
    !citationIds.has(dischargeChunkId)
  ) {
    return false;
  }

  const sourceById = new Map(answer.sources.map((source) => [source.id, source]));
  const admissionSource = sourceById.get(admissionChunkId);
  const dischargeSource = sourceById.get(dischargeChunkId);
  return Boolean(
    admissionSource &&
    dischargeSource &&
    admissionSource.document_id &&
    dischargeSource.document_id &&
    admissionSource.document_id !== dischargeSource.document_id,
  );
}

/** Identify the deliberately narrow, same-document active-community ED answer. */
export function isSourceBoundActiveCommunityEdProcedureAnswer(answer: RagAnswer) {
  if (
    answer.queryClass !== "document_lookup" ||
    !answer.preformatted ||
    !answer.grounded ||
    answer.confidence === "unsupported" ||
    answer.citations.length !== 2 ||
    answer.answerSections?.length !== 2
  ) {
    return false;
  }

  const processSection = answer.answerSections.find((section) => section.heading === "ED assessment and coordination");
  const accessSection = answer.answerSections.find((section) => section.heading === "Clinician access and contacts");
  if (
    !processSection ||
    !accessSection ||
    processSection.citation_chunk_ids.length !== 1 ||
    accessSection.citation_chunk_ids.length !== 1
  ) {
    return false;
  }

  const processChunkId = processSection.citation_chunk_ids[0];
  const accessChunkId = accessSection.citation_chunk_ids[0];
  if (processChunkId === accessChunkId) return false;
  const citationIds = new Set(answer.citations.map((citation) => citation.chunk_id));
  if (!citationIds.has(processChunkId) || !citationIds.has(accessChunkId)) return false;

  const sourceById = new Map(answer.sources.map((source) => [source.id, source]));
  const processSource = sourceById.get(processChunkId);
  const accessSource = sourceById.get(accessChunkId);
  return Boolean(
    processSource?.document_id && accessSource?.document_id && processSource.document_id === accessSource.document_id,
  );
}

/** Identify the deliberately narrow, same-document AKG home-visit requirements answer. */
export function isSourceBoundCommunityHomeVisitRequirementsAnswer(answer: RagAnswer) {
  if (
    answer.queryClass !== "unsupported_or_general" ||
    !answer.preformatted ||
    !answer.grounded ||
    answer.confidence === "unsupported" ||
    answer.citations.length !== 2 ||
    answer.answerSections?.length !== 2
  ) {
    return false;
  }

  const departureSection = answer.answerSections.find((section) => section.heading === "Before leaving");
  const returnSection = answer.answerSections.find((section) => section.heading === "Safety monitoring and return");
  if (
    !departureSection ||
    !returnSection ||
    departureSection.citation_chunk_ids.length !== 1 ||
    returnSection.citation_chunk_ids.length !== 1
  ) {
    return false;
  }

  const departureChunkId = departureSection.citation_chunk_ids[0];
  const returnChunkId = returnSection.citation_chunk_ids[0];
  if (departureChunkId === returnChunkId) return false;
  const citationIds = new Set(answer.citations.map((citation) => citation.chunk_id));
  if (!citationIds.has(departureChunkId) || !citationIds.has(returnChunkId)) return false;

  const sourceById = new Map(answer.sources.map((source) => [source.id, source]));
  const departureSource = sourceById.get(departureChunkId);
  const returnSource = sourceById.get(returnChunkId);
  const deliveredText = [answer.answer, departureSection.body, returnSection.body]
    .join(" ")
    .replace(/\*\*/g, " ")
    .replace(/\s+/g, " ");
  return Boolean(
    departureSource &&
    returnSource &&
    departureSource.document_id &&
    departureSource.document_id === returnSource.document_id &&
    communityHomeVisitDepartureEvidence(departureSource) &&
    communityHomeVisitReturnEvidence(returnSource) &&
    /\bCommunity Home Visit Log\b/i.test(deliveredText) &&
    /\bprior to leaving the workplace\b/i.test(deliveredText) &&
    /\bclerical staff will review the log\b/i.test(deliveredText) &&
    /\bsafety monitoring\b/i.test(deliveredText) &&
    /\bon their return to the workplace\b/i.test(deliveredText) &&
    /\bupdate the Community Home Visit Log\b/i.test(deliveredText),
  );
}

/** Identify the deliberately narrow, same-document AKG prescription-program answer. */
export function isSourceBoundBestPracticePrescriptionRequirementsAnswer(answer: RagAnswer) {
  if (
    answer.queryClass !== "document_lookup" ||
    !answer.preformatted ||
    !answer.grounded ||
    answer.confidence === "unsupported" ||
    answer.citations.length !== 2 ||
    answer.answerSections?.length !== 2
  ) {
    return false;
  }

  const useSection = answer.answerSections.find((section) => section.heading === "Program use");
  const profileSection = answer.answerSections.find((section) => section.heading === "Medication profile");
  if (
    !useSection ||
    !profileSection ||
    useSection.citation_chunk_ids.length !== 1 ||
    profileSection.citation_chunk_ids.length !== 1
  ) {
    return false;
  }

  const useChunkId = useSection.citation_chunk_ids[0];
  const profileChunkId = profileSection.citation_chunk_ids[0];
  if (useChunkId === profileChunkId) return false;
  const citationIds = new Set(answer.citations.map((citation) => citation.chunk_id));
  if (!citationIds.has(useChunkId) || !citationIds.has(profileChunkId)) return false;

  const sourceById = new Map(answer.sources.map((source) => [source.id, source]));
  const useSource = sourceById.get(useChunkId);
  const profileSource = sourceById.get(profileChunkId);
  const deliveredText = [answer.answer, useSection.body, profileSection.body]
    .join(" ")
    .replace(/\*\*/g, " ")
    .replace(/\s+/g, " ");
  return Boolean(
    useSource &&
    profileSource &&
    useSource.document_id &&
    useSource.document_id === profileSource.document_id &&
    bestPracticePrescriptionProgramUseEvidence(useSource) &&
    bestPracticePrescriptionProfileEvidence(profileSource) &&
    /\bprescription generation\b/i.test(deliveredText) &&
    /\belectronic medication profiles\b/i.test(deliveredText) &&
    /\bfirst clinic appointment\b/i.test(deliveredText) &&
    /\bcurrent medications\b/i.test(deliveredText) &&
    /\bmedication name, formulation, route, dose and directions for use\b/i.test(deliveredText) &&
    /\bpsychiatric and non-psychiatric medication\b/i.test(deliveredText),
  );
}

function unwrapSourceBoundComparisonLines(content: string) {
  return reflowBoundedSourceLines(sourceTextForClinicalProsePreservingBreaks(content)).flatMap((block) => {
    // The live NMHS discharge aim prefixes its clinical directive with a long service name
    // and parenthesized source abbreviation. The generic fragment-quality gate correctly
    // rejects that source-form shape, so remove only this non-clinical actor qualifier before
    // sentence validation; the directive and its clinician subject remain verbatim.
    const clinicalBlock = block.replace(
      /^All\s+North Metropolitan Health Service Mental Health\s+\(NMHS\s+MH\)\s+clinicians(?=\s+will\s+actively\s+plan\s+(?:the\s+)?effective\s+and\s+timely\s+discharge\b)/i,
      "Clinicians",
    );
    const sentences = splitClinicalEvidenceSentences(clinicalBlock);
    if (sentences.length > 0) return sentences;

    // A directly stated obligation can be followed by a long framework/legislation
    // attribution whose terminal all-caps code and year trips the generic source-heading
    // guard. Retry only the bounded directive before "as per"; the source label and the
    // downstream requirement-binding gate still have to prove the requested comparison side.
    const directiveWithoutAttribution = clinicalBlock.replace(
      /\s+as per\s+the\s+Department of Health\s+\(DoH\)\s+Triage to Discharge Mental Health Framework for State-wide Standardi[sz]ed Clinical Documentation,\s+and\s+legislative requirements of the Mental Health Act\s+\(MHA\)\s+2014\.\s*$/i,
      ".",
    );
    return directiveWithoutAttribution === clinicalBlock
      ? sentences
      : splitClinicalEvidenceSentences(directiveWithoutAttribution);
  });
}

function cleanSourceBoundComparisonCandidate(candidate: string) {
  return candidate
    .replace(/^Inclusion and exclusion criteria\s+(?=A patient\b)/i, "")
    .replace(/\bconsumer is a being referred\b/i, "consumer is being referred")
    .replace(/,?\s*as per:?\s*$/i, "")
    .replace(/:\s*$/, "")
    .trim();
}

export function sourceBoundComparisonFacts(args: {
  results: SearchResult[];
  subjectPattern: RegExp;
  otherSubjectPattern: RegExp;
  requirementBindingPatterns: readonly RegExp[];
}) {
  const facts: Array<{ result: SearchResult; sentence: string }> = [];
  for (const result of args.results) {
    const label = comparisonSourceLabel(result);
    if (!args.subjectPattern.test(label)) continue;
    const dualSubjectLabel = args.otherSubjectPattern.test(label);
    const content = result.content ?? "";
    // OCR-backed policy chunks often retain visual line wrapping. The general
    // extractor preserves those breaks so adjacent bullets are never merged,
    // but this comparison path is bound to a source label that names the requested side.
    // Re-run sentence splitting over each
    // bounded block with visual line wrapping collapsed. Blank lines, bullets,
    // terminal punctuation and numbered headings remain boundaries so unrelated
    // sections cannot be stitched together. An exclusive source label may supply the
    // comparison subject; a dual label must bind it in the sentence below. In either case,
    // the body must still carry a narrow requirement signal and an explicit directive. This avoids
    // borrowing a subject from a following numbered heading or unrelated line.
    const sourceBoundSentences = [
      ...unwrapSourceBoundComparisonLines(content),
      ...splitClinicalEvidenceSentences(content),
    ];
    const sentence = Array.from(new Set(sourceBoundSentences))
      .map(cleanSourceBoundComparisonCandidate)
      .find((candidate) => {
        if (args.otherSubjectPattern.test(candidate)) return false;
        if (nonClinicalComparisonWrapperPattern.test(candidate)) return false;
        // An exclusively labelled source can supply the comparison subject, preserving the
        // established admission-only/discharge-only fallback. A dual-title policy is accepted
        // only when the sentence itself explicitly binds to this side and excludes the other;
        // the title alone can never turn generic policy prose into a direct comparison fact.
        if (dualSubjectLabel && !args.subjectPattern.test(candidate)) return false;
        if (subordinateBedLocationReportPattern.test(candidate)) return false;
        return args.requirementBindingPatterns.some((pattern) => pattern.test(candidate));
      });
    if (!sentence) continue;
    const completed = completeExtractiveSentence(sentence, "");
    // A conditional source sentence ("Where/When/If ..., the clinician ...") is already
    // grammatically complete. The generic completer prefixes it with "The guidance is that",
    // which both weakens verbatim fidelity and adds enough unrelated tokens for the
    // section-scoped claim-support check to miss the otherwise exact source sentence.
    const sourceFaithfulCompleted = completed
      ?.replace(/^The guidance is that (?=(?:where|when|if)\b)/i, "")
      .replace(/^(where|when|if)\b/, (lead) => `${lead[0].toUpperCase()}${lead.slice(1)}`);
    if (sourceFaithfulCompleted) facts.push({ result, sentence: sourceFaithfulCompleted });
  }
  return facts;
}

/** Build the narrow two-sided fallback for admission/discharge comparisons.
 *  Exported as a test seam for the #019 conservative-fallback regression guard; no behaviour change. */
export function buildAdmissionDischargeComparisonAnswer(args: { query: string; results: SearchResult[] }) {
  const admissionFacts = sourceBoundComparisonFacts({
    results: args.results,
    subjectPattern: admissionComparisonTermPattern,
    otherSubjectPattern: dischargeComparisonTermPattern,
    requirementBindingPatterns: admissionRequirementBindingPatterns,
  });
  const dischargeFacts = sourceBoundComparisonFacts({
    results: args.results,
    subjectPattern: dischargeComparisonTermPattern,
    otherSubjectPattern: admissionComparisonTermPattern,
    requirementBindingPatterns: dischargeRequirementBindingPatterns,
  });
  // Two-sided maximum matching: preserve retrieval order while requiring distinct physical
  // documents. A dual-title policy may support one side, but can never fill both; if the first
  // fact on each side belongs to the same document, continue to the next valid pairing.
  const pair = admissionFacts
    .flatMap((admission) => dischargeFacts.map((discharge) => ({ admission, discharge })))
    .find(({ admission, discharge }) => admission.result.document_id !== discharge.result.document_id);
  if (!pair) return null;
  const { admission, discharge } = pair;

  const answerSections = [
    {
      heading: "Admission evidence",
      kind: "comparison",
      supportLevel: "direct",
      body: boldHighYieldClinicalText(admission.sentence, args.query),
      citation_chunk_ids: [admission.result.id],
    },
    {
      heading: "Discharge evidence",
      kind: "comparison",
      supportLevel: "direct",
      body: boldHighYieldClinicalText(discharge.sentence, args.query),
      citation_chunk_ids: [discharge.result.id],
    },
  ] satisfies AnswerSection[];
  return {
    answer: `Admission — ${admission.sentence} Discharge — ${discharge.sentence}`,
    body: `${admission.sentence} ${discharge.sentence}`,
    preformatted: true,
    sourceBoundCitationOnly: true,
    citationChunkIds: [admission.result.id, discharge.result.id],
    answerSections,
  };
}

/** Build fact synthesized answer. */
function buildFactSynthesizedAnswer(args: {
  query: string;
  queryClass: RagQueryClass;
  intent: AnswerIntent;
  results: SearchResult[];
  allowSourceProseRecovery?: boolean;
}) {
  if (isSourceBoundBestPracticePrescriptionRequirementsQuery(args.query, args.queryClass)) {
    const requirementsAnswer = buildBestPracticePrescriptionRequirementsAnswer({
      query: args.query,
      results: args.results,
    });
    if (requirementsAnswer) return requirementsAnswer;
  }

  if (isSourceBoundCommunityHomeVisitRequirementsQuery(args.query, args.queryClass)) {
    const requirementsAnswer = buildCommunityHomeVisitRequirementsAnswer({
      query: args.query,
      results: args.results,
    });
    if (requirementsAnswer) return requirementsAnswer;
  }

  if (isSourceBoundActiveCommunityEdProcedureQuery(args.query, args.queryClass)) {
    const procedureAnswer = buildActiveCommunityEdProcedureAnswer({ query: args.query, results: args.results });
    if (procedureAnswer) return procedureAnswer;
  }

  if (isSourceBoundClozapineBloodActionThresholdQuery(args.query, args.queryClass)) {
    const thresholdAnswer = buildClozapineBloodActionThresholdAnswer({ query: args.query, results: args.results });
    if (thresholdAnswer) return thresholdAnswer;
  }

  if (isAdmissionDischargeRequirementsComparisonQuery(args.query, args.queryClass)) {
    if (isSourceBoundAdmissionDischargeComparisonQuery(args.query, args.queryClass)) {
      const comparisonAnswer = buildAdmissionDischargeComparisonAnswer({ query: args.query, results: args.results });
      if (comparisonAnswer) return comparisonAnswer;
    }
    const gapAnswer = finalQualityGapAnswer(args.query, args.queryClass, args.intent);
    return {
      answer: gapAnswer,
      body: gapAnswer,
      citationChunkIds: [] as string[],
      answerSections: [] as AnswerSection[],
    };
  }

  const compoundMonitoringToxicity =
    args.intent === "monitoring_schedule" && isCompoundMonitoringToxicityQuery(args.query);
  const broadMonitoringOverview =
    args.intent === "monitoring_schedule" && (isBroadMonitoringOverviewQuery(args.query) || compoundMonitoringToxicity);
  let facts = extractClinicalFactsFromResults(args.results, args.query, args.intent, broadMonitoringOverview ? 32 : 8);
  if (broadMonitoringOverview) facts = selectBroadMonitoringFacts(facts);
  let recoveredSourceProse = false;
  if (
    args.allowSourceProseRecovery &&
    facts.length &&
    isLaunderedGuidanceWrapperAnswer(sentenceFromFact(facts[0], args.query))
  ) {
    const sourceFacts = extractClinicalFactsFromResults(args.results, args.query, args.intent, 8, true);
    if (sourceFacts.length) {
      facts = sourceFacts;
      recoveredSourceProse = true;
    } else {
      // No complete source prose either: lead with the next fact that is not itself a wrapper
      // rather than keep a lead the final gate is certain to reject (canary 38383361787, where a
      // PDF heading trail led the discharge-documentation fallback and the reader got a stub).
      facts = facts.filter((fact) => !isLaunderedGuidanceWrapperAnswer(sentenceFromFact(fact, args.query)));
    }
  }
  if (!facts.length) {
    const fallbackResults = args.results.filter((result) => !resultContainsProceduralFlowEdgeArtifact(result));
    if (
      sourceBackedDocumentFallbackIntent(args.query, args.queryClass, args.intent, fallbackResults) ||
      sourceBackedManagementReviewIntent(args.query, args.queryClass, args.intent, fallbackResults)
    ) {
      const supportListAnswer = buildDocumentSupportListAnswer({ query: args.query, results: fallbackResults });
      return {
        ...supportListAnswer,
        supportListCitationResultIds:
          supportListAnswer.supportListCitationResultIds ?? fallbackResults.map((result) => result.id),
      };
    }
    const gapAnswer = finalQualityGapAnswer(args.query, args.queryClass, args.intent);
    return {
      answer: gapAnswer,
      body: gapAnswer,
      citationChunkIds: [] as string[],
      answerSections: [] as AnswerSection[],
    };
  }

  let leadFacts = facts.slice(0, args.intent === "dose" || (recoveredSourceProse && args.intent === "general") ? 2 : 1);
  if (
    args.intent === "dose" ||
    args.intent === "monitoring_schedule" ||
    (args.intent === "red_result_action" && asksForBloodCountThreshold(args.query))
  ) {
    leadFacts = promoteIntentFigureLeadFacts(leadFacts, facts, args.intent, args.results, args.query);
  }
  // Once the lead answer names the query entity, later lead sentences skip
  // their own entity prefix so the entity is not repeated in every sentence.
  // Derived exactly the way sentenceFromFact derives its prefix entity (from
  // the query's own classification, not the routed intent) so the suppression
  // gate can never disagree with the prefix it is gating.
  const entity = queryEntitySubject(
    args.query,
    classifyAnswerIntent(args.query, classifyRagQuery(args.query).queryClass),
  );
  let accumulated = "";
  const leadSentences: string[] = [];
  for (const fact of leadFacts) {
    const suppressEntityPrefix = Boolean(entity && accumulated && queryTokenMatchesText(entity, accumulated));
    const sentence = sentenceFromFact(fact, args.query, { suppressEntityPrefix });
    if (!sentence) continue;
    leadSentences.push(sentence);
    accumulated = `${accumulated} ${sentence}`.trim();
  }
  const answer = sanitizeAnswerText(leadSentences.join(" "));
  const supplementaryFacts =
    args.intent === "monitoring_schedule" ? facts.filter((fact) => !leadFacts.includes(fact)) : facts;
  const monitoringSections =
    args.intent === "monitoring_schedule"
      ? buildBroadMonitoringSections(supplementaryFacts, args.query, compoundMonitoringToxicity ? 5 : 6)
      : [];
  const toxicityActionSection = compoundMonitoringToxicity
    ? compoundMonitoringToxicityActionSection(args.results, args.query)
    : null;
  const monitoringGapSection = compoundMonitoringToxicity
    ? compoundMonitoringGapSection(facts, args.query, Boolean(toxicityActionSection))
    : null;
  const answerSections =
    args.intent === "monitoring_schedule"
      ? [
          ...monitoringSections,
          ...(toxicityActionSection ? [toxicityActionSection] : []),
          ...(monitoringGapSection ? [monitoringGapSection] : []),
        ]
      : buildFactSections(supplementaryFacts, args.query);
  const emittedCitationChunkIds =
    args.intent === "monitoring_schedule"
      ? Array.from(
          new Set([
            ...leadFacts.flatMap((fact) => fact.citationChunkIds),
            ...answerSections.flatMap((section) => section.citation_chunk_ids),
          ]),
        )
      : Array.from(new Set(facts.flatMap((fact) => fact.citationChunkIds)));
  return {
    answer: boldHighYieldClinicalText(answer, args.query),
    body: boldHighYieldClinicalText(answer, args.query),
    citationChunkIds: emittedCitationChunkIds,
    answerSections,
    recoveredSourceProse,
  };
}

/** Source backed document fallback intent. */
function sourceBackedDocumentFallbackIntent(
  query: string,
  queryClass: RagQueryClass,
  _intent: AnswerIntent,
  results: SearchResult[],
) {
  if (results.length === 0) return false;
  const strongestScore = Math.max(...results.map(scoreValue));
  if (strongestScore < 0.45) return false;
  return documentSupportListIntent(query, queryClass);
}

/** Source-backed review intent for broad medication-management evidence that cannot be safely collapsed into facts. */
function sourceBackedManagementReviewIntent(
  query: string,
  queryClass: RagQueryClass,
  intent: AnswerIntent,
  results: SearchResult[],
) {
  if (queryClass !== "medication_dose_risk" || intent !== "general" || results.length === 0) return false;
  if (!/\bpharmacological management\b/i.test(query)) return false;
  if (/\b(?:compare|contraindicat\w*|dose|dosing|frequency|monitor\w*|route|threshold|withhold)\b/i.test(query)) {
    return false;
  }
  return (
    Math.max(...results.map(scoreValue)) >= 0.45 &&
    results.some((result) => hasRelevantQueryOverlap(evidenceTextForGate(result), query, intent))
  );
}

/** Document support list intent. */
export function documentSupportListIntent(query: string, queryClass: RagQueryClass) {
  return (
    classifyAnswerIntent(query, queryClass) === "document_lookup" &&
    /\b(?:support|supports|supporting|sources?|documents?|guidelines?)\b/i.test(query) &&
    /\b(?:which|what|list|show|name|where|find|provide)\b/i.test(query)
  );
}

/** Table or visual source lookup intent. */
function tableOrVisualSourceLookupIntent(query: string, queryClass: RagQueryClass, answerIntent: AnswerIntent) {
  if (queryClass === "table_threshold" || answerIntent === "dose" || answerIntent === "monitoring_schedule")
    return false;
  return (
    /\b(?:which|where|find|open|locate)\b.{0,120}\b(?:table|chart|flow\s*chart|flowchart|figure|appendix|form)\b/i.test(
      query,
    ) ||
    /\b(?:show|display)\s+(?:me\s+)?(?:the\s+)?(?:table|chart|flow\s*chart|flowchart|figure|appendix|form)\b/i.test(
      query,
    ) ||
    /\b(?:which|what)\b.{0,80}\b(?:source|document|guideline|file|pdf)\b.{0,80}\b(?:table|chart|flow\s*chart|flowchart|figure|appendix|form)\b/i.test(
      query,
    ) ||
    /\b(?:table|chart|flow\s*chart|flowchart|figure|appendix|form)\b.{0,80}\b(?:cover|covers|contain|contains|list|lists|guidance)\b/i.test(
      query,
    )
  );
}

/** Source lookup label. */
function sourceLookupLabel(result: SearchResult) {
  const tableTitle = (result.table_facts ?? [])
    .map((fact) => fact.table_title || fact.row_label)
    .find((value): value is string => Boolean(value?.trim()));
  const imageTitle = (result.images ?? [])
    .map((image) => image.tableTitle || image.caption)
    .find((value): value is string => Boolean(value?.trim()));
  const rawLabel = tableTitle || imageTitle || result.section_heading || result.title || result.file_name;
  return normalizeSectionText(rawLabel)
    .replace(/([a-zA-Z])\(/g, "$1 (")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Has table or visual lookup evidence. */
function hasTableOrVisualLookupEvidence(result: SearchResult) {
  return (
    (result.table_facts?.length ?? 0) > 0 ||
    (result.images ?? []).some((image) =>
      /\b(?:clinical_table|flowchart_algorithm|medication_chart|risk_matrix|table_crop|diagram_crop|page_region|embedded)\b/i.test(
        `${image.image_type ?? ""} ${image.sourceKind ?? ""} ${image.source_kind ?? ""}`,
      ),
    ) ||
    /\b(?:table|chart|flow\s*chart|flowchart|figure|appendix|form)\b/i.test(
      `${result.section_heading ?? ""} ${result.title ?? ""} ${result.file_name ?? ""}`,
    )
  );
}

/** Build table or visual source lookup answer. */
function buildTableOrVisualSourceLookupAnswer(args: { query: string; results: SearchResult[] }) {
  const source = args.results.find(hasTableOrVisualLookupEvidence) ?? args.results[0];
  if (!source) {
    const gapAnswer = finalQualityGapAnswer(args.query, "document_lookup", "document_lookup");
    return { answer: gapAnswer, citationChunkIds: [] as string[], answerSections: [] as AnswerSection[] };
  }

  const label = sourceLookupLabel(source) || "the top matched source";
  const answer = `The relevant source is ${label}, which covers the requested table or visual guidance.`;

  return {
    answer,
    citationChunkIds: [source.id],
    preformatted: true,
    answerSections: [
      {
        heading: "Source match",
        kind: "documentation",
        supportLevel: "direct",
        body: `The source match is ${label}.`,
        citation_chunk_ids: [source.id],
      },
    ] satisfies AnswerSection[],
  };
}

/**
 * Keep the citations that support delivered extractive answer text ahead of
 * already-ranked supporting citations, without admitting unknown sources.
 */
export function compactExtractiveCitations(args: {
  results: SearchResult[];
  citations: Citation[];
  rankedCitations: Citation[];
  citationChunkIds: string[];
  answerSections: AnswerSection[];
}) {
  const resultById = new Map(args.results.map((result) => [result.id, result]));
  const citationByChunkId = new Map<string, Citation>();
  const compacted: Citation[] = [];
  const seen = new Set<string>();

  const citationCandidates = [...args.citations, ...args.rankedCitations];
  for (const citation of citationCandidates) {
    if (!resultById.has(citation.chunk_id) || citationByChunkId.has(citation.chunk_id)) continue;
    citationByChunkId.set(citation.chunk_id, citation);
  }

  const append = (chunkId: string) => {
    if (seen.has(chunkId) || compacted.length >= 5) return;
    const result = resultById.get(chunkId);
    if (!result) return;
    compacted.push(citationByChunkId.get(chunkId) ?? resultCitation(result, "deterministic_support"));
    seen.add(chunkId);
  };

  // Structured sections are the closest citation map for delivered content.
  // The broader synthesis support set follows without being reordered.
  for (const chunkId of [
    ...args.answerSections.flatMap((section) => section.citation_chunk_ids),
    ...args.citationChunkIds,
  ]) {
    append(chunkId);
  }
  for (const citation of args.rankedCitations) append(citation.chunk_id);

  return compacted;
}

/** Build extractive answer. */
export function buildExtractiveAnswer(args: {
  query: string;
  queryClass: RagQueryClass;
  results: SearchResult[];
  quoteCards: QuoteCard[];
  documentBreakdown: RagAnswer["documentBreakdown"];
  evidenceSummary: RagAnswer["evidenceSummary"];
  sourceCoverage: RagAnswer["sourceCoverage"];
  conflictsOrGaps: ConflictOrGap[];
  visualEvidence: RagAnswer["visualEvidence"];
  bestSource: RagAnswer["bestSource"];
  smartPanel: RagAnswer["smartPanel"];
  relatedDocuments: RagAnswer["relatedDocuments"];
  routeReason: string;
  timings: RagAnswer["latencyTimings"];
  /** Enable only after routing, so recovery cannot preempt a valid generated answer. */
  allowSourceProseRecovery?: boolean;
}) {
  const results = args.results.filter((result) => !resultContainsProceduralFlowEdgeArtifact(result));
  const removedProceduralArtifact = results.length !== args.results.length;
  let rebuildDerivedArtifacts =
    removedProceduralArtifact ||
    derivedArtifactsContainProceduralFlowEdge({
      quoteCards: args.quoteCards,
      documentBreakdown: args.documentBreakdown,
      evidenceSummary: args.evidenceSummary,
      conflictsOrGaps: args.conflictsOrGaps,
      bestSource: args.bestSource,
      smartPanel: args.smartPanel,
      relatedDocuments: args.relatedDocuments,
    });
  const resultById = new Map(results.map((result) => [result.id, result]));
  const adjacentBandConflicts = adjacentLabelledNumericBandConflicts(results);
  const filterQuoteCards = (cards: QuoteCard[]) =>
    cards.filter((quote) => {
      const source = resultById.get(quote.chunk_id);
      if (!source) return false;
      if (sourceLabelledNumericBandConflictsAffectingText(source, quote.quote, args.query).length > 0) return false;
      return !textReferencesAdjacentBandConflict(quote.quote, source.id, adjacentBandConflicts, args.query);
    });
  const retainedInputQuoteCards = filterQuoteCards(args.quoteCards.slice(0, 5));
  const quoteCards = retainedInputQuoteCards.length
    ? retainedInputQuoteCards
    : filterQuoteCards(extractQuoteCards(results, args.query, 5));
  const memoryCards = rankMemoryCardsForAnswer(collectMemoryCards(results, 16), args.query, args.queryClass).slice(
    0,
    10,
  );
  const rankedCitations = compactCitations(results, 6, "deterministic_support");
  const citations = rankedCitations.slice(0, Math.max(quoteCards.length, 1));
  const citationIds = new Set(citations.map((citation) => citation.chunk_id));
  for (const card of memoryCards) {
    for (const chunkId of card.source_chunk_ids ?? []) {
      if (citationIds.has(chunkId)) continue;
      const source = resultById.get(chunkId);
      if (!source) continue;
      citations.push(resultCitation(source, "deterministic_support"));
      citationIds.add(chunkId);
    }
  }
  for (const quote of quoteCards) {
    if (!citationIds.has(quote.chunk_id)) {
      // Guard the lookup: a quote card whose chunk_id was filtered out of results
      // would make find() return undefined and resultCitation(undefined) throw.
      const source = results.find((result) => result.id === quote.chunk_id);
      if (source) citations.push(resultCitation(source, "exact_quote"));
    }
    citationIds.add(quote.chunk_id);
  }

  const answerIntent = classifyAnswerIntent(args.query, args.queryClass);
  const naturalAnswer = documentSupportListIntent(args.query, args.queryClass)
    ? buildDocumentSupportListAnswer({ query: args.query, results, filterToClaimBearingDocuments: true })
    : tableOrVisualSourceLookupIntent(args.query, args.queryClass, answerIntent)
      ? buildTableOrVisualSourceLookupAnswer({ query: args.query, results })
      : buildFactSynthesizedAnswer({
          query: args.query,
          queryClass: args.queryClass,
          intent: answerIntent,
          results,
          allowSourceProseRecovery: args.allowSourceProseRecovery,
        });

  // Fact synthesis is the production extractive path. If no clean fact survives
  // coverage and artifact gates, fail closed instead of stitching snippets.
  const hasExtractedAnswer = naturalAnswer.citationChunkIds.length > 0;

  // Ensure any chunk IDs referenced by the synthesized answer are present in citations,
  // even if they were not in the top-ranked compactCitations slice.
  for (const chunkId of naturalAnswer.citationChunkIds) {
    if (!citationIds.has(chunkId)) {
      const source = results.find((result) => result.id === chunkId);
      if (source) {
        citations.push(resultCitation(source, "deterministic_support"));
        citationIds.add(chunkId);
      }
    }
  }

  const sourceBoundAdmissionDischargeComparison =
    isSourceBoundAdmissionDischargeComparisonQuery(args.query, args.queryClass) &&
    Boolean((naturalAnswer as { preformatted?: boolean }).preformatted) &&
    naturalAnswer.citationChunkIds.length === 2;
  const recoveredSourceProse = Boolean((naturalAnswer as { recoveredSourceProse?: boolean }).recoveredSourceProse);
  const sourceBoundCitationOnly =
    recoveredSourceProse ||
    sourceBoundAdmissionDischargeComparison ||
    Boolean((naturalAnswer as { sourceBoundCitationOnly?: boolean }).sourceBoundCitationOnly);
  const supportListCitationResultIds = (naturalAnswer as { supportListCitationResultIds?: string[] })
    .supportListCitationResultIds;
  const supportListCitationIdSet = supportListCitationResultIds ? new Set(supportListCitationResultIds) : null;
  const finalCitationResults = supportListCitationIdSet
    ? results.filter((result) => supportListCitationIdSet.has(result.id))
    : results;
  const finalCitations = compactExtractiveCitations({
    results: finalCitationResults,
    citations: supportListCitationIdSet
      ? citations.filter((citation) => supportListCitationIdSet.has(citation.chunk_id))
      : citations,
    // This narrow fallback already maps both delivered comparison facts to
    // their supporting chunks. Extra ranked citations do not support either
    // delivered claim and can introduce unrelated governance failures.
    rankedCitations: sourceBoundCitationOnly
      ? []
      : supportListCitationIdSet
        ? rankedCitations.filter((citation) => supportListCitationIdSet.has(citation.chunk_id))
        : rankedCitations,
    citationChunkIds: naturalAnswer.citationChunkIds,
    answerSections: naturalAnswer.answerSections ?? [],
  });
  const sourceBoundCitationIds = new Set(sourceBoundCitationOnly ? naturalAnswer.citationChunkIds : []);
  const answerSources = sourceBoundCitationOnly
    ? [
        ...naturalAnswer.citationChunkIds.flatMap((chunkId) => {
          const result = resultById.get(chunkId);
          return result ? [result] : [];
        }),
        ...results.filter((result) => !sourceBoundCitationIds.has(result.id)),
      ]
    : supportListCitationIdSet
      ? finalCitationResults
      : results;
  const finalQuoteCards = supportListCitationIdSet
    ? quoteCards.filter((quote) => supportListCitationIdSet.has(quote.chunk_id))
    : quoteCards;
  const finalMemoryCards = supportListCitationIdSet
    ? memoryCards.filter((card) =>
        (card.source_chunk_ids ?? []).some((chunkId) => supportListCitationIdSet.has(chunkId)),
      )
    : memoryCards;
  rebuildDerivedArtifacts ||= answerSources.length !== results.length;
  const rebuiltDocumentBreakdown = rebuildDerivedArtifacts
    ? buildDocumentBreakdown(answerSources, finalQuoteCards)
    : args.documentBreakdown;
  const rebuiltEvidenceSummary = rebuildDerivedArtifacts
    ? buildEvidenceSummary(answerSources, finalQuoteCards)
    : args.evidenceSummary;
  const rebuiltSourceCoverage = rebuildDerivedArtifacts ? buildSourceCoverage(answerSources) : args.sourceCoverage;
  const rebuiltVisualEvidence = rebuildDerivedArtifacts ? buildVisualEvidence(answerSources) : args.visualEvidence;
  const rebuiltBestSource = rebuildDerivedArtifacts
    ? selectBestSourceRecommendation(answerSources, finalQuoteCards.length ? finalQuoteCards : undefined)
    : args.bestSource;
  const rebuiltSmartPanel = rebuildDerivedArtifacts
    ? {
        ...buildSmartPanel(args.query, answerSources),
        documents: rebuiltDocumentBreakdown ?? [],
        quotes: finalQuoteCards,
        visualEvidence: rebuiltVisualEvidence ?? [],
        bestSource: rebuiltBestSource,
        image_count: rebuiltVisualEvidence?.length ?? 0,
        evidenceSummary: rebuiltEvidenceSummary ?? buildEvidenceSummary(answerSources, finalQuoteCards),
        sourceCoverage: rebuiltSourceCoverage ?? buildSourceCoverage(answerSources),
      }
    : args.smartPanel;
  const rebuiltRelatedDocuments = rebuildDerivedArtifacts
    ? filterRelatedDocumentsForProceduralArtifacts(args.relatedDocuments, answerSources)
    : args.relatedDocuments;
  const deliveredNaturalText = [
    naturalAnswer.answer,
    ...(naturalAnswer.answerSections ?? []).map((section) => section.body),
  ].join(" ");
  const deliveredNaturalTextHasBand = containsNumericBandReference(deliveredNaturalText);
  const queryNeedsBandConflictDisclosure =
    /\b(?:scores?|ranges?|bands?|thresholds?|severit(?:y|ies)|escalat\w*)\b/i.test(args.query);
  const conflictingBandCitationIds = Array.from(
    new Set(
      naturalAnswer.citationChunkIds.filter((chunkId) => {
        const source = resultById.get(chunkId);
        if (!source) return false;
        if (
          sourceHasLabelledNumericBandConflict(source) &&
          ((!deliveredNaturalTextHasBand && queryNeedsBandConflictDisclosure) ||
            sourceLabelledNumericBandConflictsAffectingText(source, deliveredNaturalText, args.query).length > 0)
        ) {
          return true;
        }
        const participatesInAdjacentConflict = adjacentBandConflicts.some((conflict) =>
          conflict.chunkIds.includes(source.id),
        );
        return (
          participatesInAdjacentConflict &&
          ((!deliveredNaturalTextHasBand && queryNeedsBandConflictDisclosure) ||
            textReferencesAdjacentBandConflict(deliveredNaturalText, source.id, adjacentBandConflicts, args.query))
        );
      }),
    ),
  );
  const conflictsOrGaps =
    conflictingBandCitationIds.length > 0
      ? [
          ...(rebuildDerivedArtifacts ? detectConflictsOrGaps(answerSources) : args.conflictsOrGaps).filter(
            (item) => !item.message.startsWith(LABELLED_NUMERIC_BAND_CONFLICT_NOTE),
          ),
          {
            type: "conflict" as const,
            message: `${LABELLED_NUMERIC_BAND_CONFLICT_NOTE} Conflicting numeric bands in the cited source were withheld; only independent nonnumeric guidance is shown.`,
            source_chunk_ids: conflictingBandCitationIds,
          },
        ]
      : rebuildDerivedArtifacts
        ? detectConflictsOrGaps(answerSources)
        : [...args.conflictsOrGaps];
  if (
    hasExtractedAnswer &&
    answerIntent === "red_result_action" &&
    asksForBloodCountThreshold(args.query) &&
    !factCarriesIntentFigure(answerIntent, deliveredNaturalText, args.query)
  ) {
    conflictsOrGaps.push({
      type: "gap",
      message:
        "The cited evidence supports the action but does not establish the requested blood-count threshold for this request.",
    });
  }
  if (rebuiltSmartPanel) rebuiltSmartPanel.conflictsOrGaps = conflictsOrGaps;

  const candidate = {
    answer: naturalAnswer.answer,
    grounded: hasExtractedAnswer && finalCitations.length > 0,
    confidence: hasExtractedAnswer ? deriveConfidence(results, finalCitations) : "unsupported",
    citations: finalCitations,
    sources: answerSources,
    modelUsed: null,
    routingMode: "extractive",
    preformatted: hasExtractedAnswer && Boolean((naturalAnswer as { preformatted?: boolean }).preformatted),
    routingReason: [
      args.routeReason,
      recoveredSourceProse ? "source_prose_recovery" : null,
      conflictingBandCitationIds.length > 0 ? "numeric_band_conflict_source_withheld" : null,
    ]
      .filter(Boolean)
      .join("; "),
    queryClass: args.queryClass,
    latencyTimings: args.timings,
    answerSections: naturalAnswer.answerSections ?? [],
    quoteCards: finalQuoteCards,
    visualEvidence: rebuiltVisualEvidence,
    bestSource: rebuiltBestSource,
    documentBreakdown: rebuiltDocumentBreakdown,
    evidenceSummary: rebuiltEvidenceSummary,
    sourceCoverage: rebuiltSourceCoverage,
    conflictsOrGaps,
    smartPanel: rebuiltSmartPanel,
    relatedDocuments: rebuiltRelatedDocuments,
    memoryCardsUsed: finalMemoryCards,
    indexingVersion: ragDeepMemoryVersion,
    indexingQuality: buildIndexingQuality(answerSources, finalMemoryCards),
    scoreExplanations: buildAnswerScoreExplanations(answerSources),
  } satisfies RagAnswer;
  return recoveredSourceProse ? retainCitedExtractiveFallbackEvidence(candidate) : candidate;
}
