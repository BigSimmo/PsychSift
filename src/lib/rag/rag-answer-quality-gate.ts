// The final answer quality gate: generated-answer quality checks, verified-part retention and
// finalizeRagAnswerQuality. Moved unchanged out of rag-extractive-answer.ts.

import {
  type OriginalSectionFinalizationContext,
  carryOriginalSectionCandidateProof,
  carryFinalizedOriginalSectionProof,
  restoreCheckedOriginalSectionBulletPresentation,
  recoverCheckedOriginalSectionRecommendation,
  enforceOriginalSectionDeliveredCompleteness,
} from "@/lib/rag/rag-original-section-delivery";
import { adaptiveAnswerLimits, answerWithinLimits } from "@/lib/rag/rag-answer-contract-limits";
import { type CheckedOriginalSectionAuthority as CheckedOriginalSectionLayout } from "@/lib/rag/rag-source-block";
import { buildSourceConflictSection } from "@/lib/rag/source-conflict-section";
import { renderSourceBoundAlcoholSummary } from "@/lib/rag/rag-source-bound-alcohol-summary";
import { classifyRagFallbackReason, publicFallbackReason } from "@/lib/rag/rag-fallback-reason";
import { type SearchChunksArgs } from "@/lib/rag/rag-contracts";
import {
  type AnswerCoveragePlan,
  type RagInsufficiencyReason,
  type RagQueryPlan,
  type RagAskedPart,
  type RagRequestedFacetDetail,
} from "@/lib/types";
import {
  legacyAnswerGenerationContract,
  ragAdaptiveAnswerPromptVersion,
  type RagAnswerGenerationContract,
} from "@/lib/rag/rag-versioning";
import { boldHighYieldClinicalText } from "@/lib/answer-ranking";
import { applyNumericVerification } from "@/lib/answer-verification";
import { hasClinicalActionSignal, hasClinicalPopulationSignal } from "@/lib/rag/rag-clinical-language-signals";
import {
  classifyRagQuery,
  medicationDoseEvidenceQueryIntent,
  normalizedClinicalSearchTokens,
} from "@/lib/clinical-search";
import {
  deliveredProseRelevance,
  hasBoundMonitoringCadence as deliveredMonitoringFrequencyPresent,
} from "@/lib/evidence-relevance";
import {
  hasForeignMedicationClinicalValueBinding,
  isAntipsychoticMedicationEntity,
  medicationEntitiesInText,
  medicationSafetyEntitiesInText,
} from "@/lib/medication-entities";
import { type OpenAIReasoningEffort } from "@/lib/openai";
import {
  fallbackReasonFromRouting,
  normalizeRagFallbackReasonCode,
  strongerGovernanceFallbackReasonFromRouting,
  machineReadableFallbackAnswer,
} from "@/lib/rag/rag-answer-support";
import {
  hasClinicalAnswerQualityIssue,
  looksLikeJsonArtifact,
  normalizeSectionText,
  sanitizeAnswerText,
} from "@/lib/rag/rag-answer-text";
import { cloneAnswer } from "@/lib/rag/rag-cache";
import { ragProviderMode } from "@/lib/rag/rag-provider";
import { buildSmartRagApiPlan } from "@/lib/smart-rag-api";
import { isLowYieldClinicalText } from "@/lib/source-text-sanitizer";
import {
  type AnswerSection,
  type AnswerSectionKind,
  type RagAnswer,
  type RagQueryClass,
  type SearchResult,
} from "@/lib/types";
import {
  assessAndEnforceClaimSupport,
  enforceLabelledNumericBandCoherence,
  sourceDirectlySupportsAnswerText,
} from "@/lib/rag/rag-claim-support";
import {
  classifyAnswerIntent,
  isCompoundMonitoringToxicityQuery,
  requestedMonitoringScheduleFacets,
  type MonitoringFacet,
} from "@/lib/rag/rag-answer-intent";
import {
  asksForEscalationTrigger,
  escapeQueryToken,
  factKindForSentence,
  hasBadFinalAnswerQuality,
  hasEscalationTrigger,
  hasMaximumDoseEvidence,
  hasRelevantQueryOverlap,
  hasTargetedEscalationAction,
  isExplicitEscalationQuery,
  monitoringIntervalFigurePattern,
  repeatDoseScheduleFigurePattern,
  reportedEscalationWrapperPattern,
  requiresClinicalEscalationFallbackSafety,
  splitClinicalEvidenceSentences,
  staleEscalationProvenancePattern,
  strongHistoricalEscalationCuePattern,
} from "@/lib/rag/rag-extractive-signals";
import {
  finalQualityGapAnswer,
  firstSentence,
  hasCompleteOpeningSentence,
  isFragmentLikeClinicalAnswer,
  isLaunderedGuidanceWrapperAnswer,
  retainCitedExtractiveFallbackEvidence,
  templateLikeGeneratedPrefixPattern,
} from "@/lib/rag/rag-answer-shape-checks";
import {
  buildExtractiveAnswer,
  documentSupportListIntent,
  factSupportsAnswerIntent,
  hasBoundedMedicationSubjectForNumericRepeatDoseSchedule,
  hasCompoundToxicityActionEvidence,
  monitoringFacetForFact,
  monitoringFacetGapLabels,
} from "@/lib/rag/rag-extractive-builder";

/**
 * Prose for the source-backed review fallback.
 *
 * Ledger #ZK460W. This used to read "The uploaded documents contain relevant guidance on
 * {subject}, but a full written answer could not be completed just now", where {subject} was
 * rewritten from the clinician's own query. Two faults in one sentence. The clause asserted
 * something the pipeline had, on this route, just failed to establish, so a query that retrieved
 * nothing better than loosely similar text came back as a statement that the guidelines covered
 * it. And echoing the query put whatever the clinician typed into the delivered answer: the
 * offline adversarial harness case `scope-other-owner-document` puts a patient name in the query,
 * and it arrived in the answer body through this sentence.
 *
 * The wording is now fixed text. It carries no claim about what the documents contain and no
 * material from the query, which is also why it is safe for `finalizeRagAnswerQualityCore` to
 * pass it through instead of replacing it.
 */
export function sourceBackedGenerationTimeoutAnswer() {
  return "A written answer could not be produced for this question. The document passages cited below were retrieved as possibly relevant source material and have not been confirmed as answering it. Please review them directly.";
}

const reasoningEffortRank: Record<OpenAIReasoningEffort, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  xhigh: 4,
};

// Strong-route reasoning effort by query class (P6). Safety-critical numeric/threshold classes keep
// the full configured effort; routine retrieval classes are capped at "medium" so high-effort
// reasoning over verbose context does not overrun the answer timeout and fail-closed on queries that
// actually have good sources. Never raises effort above the configured value.
/** Strong reasoning effort for query class. */
export function strongReasoningEffortForQueryClass(
  queryClass: RagQueryClass,
  configured: OpenAIReasoningEffort,
): OpenAIReasoningEffort {
  const safetyCritical = queryClass === "medication_dose_risk" || queryClass === "table_threshold";
  if (safetyCritical) return configured;
  return reasoningEffortRank[configured] > reasoningEffortRank.medium ? "medium" : configured;
}

/** Is unusable generated answer. */
export function isUnusableGeneratedAnswer(answer: Pick<RagAnswer, "answer" | "citations" | "routingReason">) {
  const normalized = normalizeSectionText(answer.answer ?? "");
  if (!normalized) return true;
  if (normalized === machineReadableFallbackAnswer) return true;
  if (answer.routingReason === "structured_parse_fallback") return true;
  return looksLikeJsonArtifact(normalized);
}

const providerSourceGapLeadPattern =
  /^(?:no\s+(?:current|relevant|specific|sufficient|directly relevant)\s+(?:indexed\s+)?(?:clinical\s+)?(?:source|sources|document|documents|evidence|guidance)\b|(?:the\s+)?(?:available|retrieved|provided|cited|indexed)\s+(?:source|sources|documents|excerpts|passages)\s+(?:do|does)\s+not\b|i\s+(?:could\s+not|couldn't|cannot|can't|was\s+unable\s+to)\s+(?:find|identify|confirm|provide)\b)/i;

/**
 * Whether the provider's lead answer is itself a source-gap/refusal rather than
 * a substantive answer. Only the lead may trigger this classification, so a
 * useful answer that ends with a bounded limitation remains intact.
 */
export function isProviderSourceGapGeneratedAnswer(
  answer: Pick<RagAnswer, "answer" | "grounded" | "confidence" | "answerSections">,
) {
  const cleanedAnswer = sanitizeAnswerText(answer.answer ?? "");
  const lead = firstSentence(cleanedAnswer).replace(/\*\*/g, "").trim();
  if (!lead || !providerSourceGapLeadPattern.test(lead)) return false;
  return (
    !answer.grounded ||
    answer.confidence === "unsupported" ||
    (answer.answerSections ?? []).some(
      (section) => section.kind === "source_gap" || section.supportLevel === "unsupported",
    )
  );
}

/** Whether a provider source-gap also carries misleading claim citations. */
export function hasCitedProviderSourceGap(
  answer: Pick<RagAnswer, "answer" | "grounded" | "confidence" | "answerSections" | "citations">,
) {
  return answer.citations.length > 0 && isProviderSourceGapGeneratedAnswer(answer);
}

const templateLikeGeneratedTextPattern =
  /\b(?:the\s+(?:strongest\s+)?retrieved\s+(?:source|sources|passages|excerpts)\s+(?:support|supports|show|shows|indicate|indicates)|retrieved\s+(?:source|sources|passages|excerpts)|source-backed|based\s+on\s+(?:the\s+)?(?:provided\s+)?(?:sources|excerpts|passages|retrieved\s+sources)|the\s+(?:cited\s+)?source\s+(?:states|supports|says|indicates)|provided\s+excerpts)\b/i;

const templateLikeGeneratedSectionHeadingPattern =
  /^(?:direct answer|bottom line|high-yield summary|source-backed answer|direct source-backed answer)$/i;

const simpleDirectQuestionPattern =
  /^(?:what\s+(?:is|are)|what's|define|who\s+(?:is|are)|when\s+(?:is|are)|where\s+(?:is|are)|is\s+|are\s+|does\s+|do\s+)/i;

const simpleQuestionExpansionPattern =
  /\b(?:management|manage|managed|treatment|treat|therapy|care|approach|pathway|dose|dosing|threshold|compare|versus|vs|monitoring|required|requirements|risk|side effect|contraindicat\w*|urgent|escalat\w*)\b/i;

/** Is template like generated answer. */
export function isTemplateLikeGeneratedAnswer(answer: Pick<RagAnswer, "answer" | "answerSections">) {
  const answerText = normalizeSectionText(answer.answer ?? "");
  if (
    answerText &&
    (templateLikeGeneratedTextPattern.test(answerText) || templateLikeGeneratedPrefixPattern.test(answerText))
  ) {
    return true;
  }

  return (answer.answerSections ?? []).some((section) => {
    const heading = normalizeSectionText(section.heading ?? "");
    const body = normalizeSectionText(section.body ?? "");
    return (
      (heading && templateLikeGeneratedSectionHeadingPattern.test(heading)) ||
      (body && (templateLikeGeneratedTextPattern.test(body) || templateLikeGeneratedPrefixPattern.test(body)))
    );
  });
}

/** Is simple direct question. */
export function isSimpleDirectQuestion(query: string, queryClass: RagQueryClass) {
  const normalized = normalizeSectionText(query);
  if (!normalized || normalized.length > 100) return false;
  if (queryClass === "comparison" || queryClass === "table_threshold" || queryClass === "medication_dose_risk") {
    return false;
  }
  if (queryClass === "broad_summary" || queryClass === "document_lookup") return false;
  return simpleDirectQuestionPattern.test(normalized) && !simpleQuestionExpansionPattern.test(normalized);
}

// Bare definitional questions ("what is X", "define X", "who is X") legitimately get short answers
// that refer back to the subject with anaphora ("It is …") without repeating the entity term, so
// the lexical entity-overlap responsiveness check would false-fire on them. Detect and exempt them
// when extending the overlap gate to synthesized model answers.
/** Is bare definition question. */
export function isBareDefinitionQuestion(query: string) {
  return /^(?:what(?:'s| is| are)|define|who\s+(?:is|are))\b/i.test(normalizeSectionText(query));
}

/** Word count. */
function wordCount(value: string) {
  return normalizeSectionText(value).split(/\s+/).filter(Boolean).length;
}

/** Is over expanded simple generated answer. */
export function isOverExpandedSimpleGeneratedAnswer(
  query: string,
  queryClass: RagQueryClass,
  answer: Pick<RagAnswer, "answer" | "answerSections">,
) {
  if (!isSimpleDirectQuestion(query, queryClass)) return false;
  const sections = answer.answerSections ?? [];
  const nonEssentialSectionCount = sections.filter((section) => !isEssentialSimpleQuestionSection(section)).length;
  return nonEssentialSectionCount > 0 || sections.length > 1 || wordCount(answer.answer ?? "") > 95;
}

/** Is essential simple question section. */
function isEssentialSimpleQuestionSection(section: Pick<AnswerSection, "heading" | "body">) {
  return /\b(?:gap|not enough|insufficient|unsupported|urgent|escalat\w*|risk|safety)\b/i.test(
    `${section.heading} ${section.body}`,
  );
}

/** Is missing critical query intent. */
function isMissingCriticalQueryIntent(query: string, text: string) {
  const normalizedQuery = normalizeSectionText(query).toLowerCase();
  const normalizedText = normalizeSectionText(text).toLowerCase();
  if (isExplicitEscalationQuery(normalizedQuery)) {
    const lead = firstSentence(normalizedText);
    if (!hasTargetedEscalationAction(lead)) return true;
    if (asksForEscalationTrigger(normalizedQuery) && !hasEscalationTrigger(lead)) return true;
    return false;
  }
  if (/\bcontraindicat\w*\b/.test(normalizedQuery)) {
    return !/\b(?:contraindicat\w*|avoid|must not|do not|should not|not use|opioid[-\s]?free|withdrawal|precipitat\w*)\b/.test(
      normalizedText,
    );
  }
  if (/\b(?:what to do|red|amber|anc|result|results)\b/.test(normalizedQuery)) {
    return !/\b(?:withhold|cease|stop|discontinue|discontinued|contact|urgent|repeat|review|monitor|range|threshold|blood|patholog\w*|haematolog\w*|hematolog\w*|anc)\b/.test(
      normalizedText,
    );
  }
  if (/\b(?:referral|refer|pathway)\b/.test(normalizedQuery) && /\bect\b/.test(normalizedQuery)) {
    return !/\b(?:ect|electroconvulsive|refer|referral|criteria|indicat\w*|psychiat\w*)\b/.test(normalizedText);
  }
  if (/\b(?:monitor|monitoring|schedule|baseline|follow[-\s]?up)\b/.test(normalizedQuery)) {
    if (/\bfbc\b/.test(normalizedQuery) && !/\bfbc\b/.test(normalizedText)) return true;
    if (/\banc\b/.test(normalizedQuery) && !/\banc\b/.test(normalizedText)) return true;
    if (
      /\bschedule\b/.test(normalizedQuery) &&
      !/\b(?:schedule|baseline|weekly|monthly|annual|every|first\s+\d+\s+weeks|then|ongoing)\b/.test(normalizedText)
    ) {
      return true;
    }
    return !/\b(?:monitor|monitoring|follow[-\s]?up|baseline|weekly|monthly|annual|every|level|levels|blood test|fbc|anc|wbc|ecg|lft|renal|thyroid|metabolic|glucose|bsl|lipids|cholesterol|triglycerides|blood pressure|bp|pulse|weight|bmi)\b/.test(
      normalizedText,
    );
  }
  return false;
}

function compoundMonitoringCoverageSatisfiesIntent(answer: RagAnswer, query: string) {
  if (answer.routingMode !== "extractive" || !isCompoundMonitoringToxicityQuery(query)) return false;
  const directSections = (answer.answerSections ?? []).filter(
    (section) => section.supportLevel === "direct" && section.citation_chunk_ids.length > 0,
  );
  const directMonitoringFacets = new Set(
    [
      ...(answer.citations.length > 0 ? [answer.answer] : []),
      ...directSections.filter((section) => section.kind === "monitoring_timing").map((section) => section.body),
    ].map((text) =>
      monitoringFacetForFact({
        kind: "monitoring",
        text,
        citationChunkIds: [],
        priority: 0,
      }),
    ),
  );
  const hasDirectSchedule = [
    "baseline",
    "sample_timing",
    "after_change",
    "stable_monitoring",
    "ongoing",
    "steady_state",
  ].some((facet) => directMonitoringFacets.has(facet as MonitoringFacet));
  if (!hasDirectSchedule) return false;

  const gapText = normalizeSectionText(
    (answer.answerSections ?? [])
      .filter((section) => section.kind === "source_gap" && section.supportLevel === "unsupported")
      .map((section) => section.body)
      .join(" "),
  ).toLowerCase();
  const requestedFacetsCovered = [...requestedMonitoringScheduleFacets(query)].every((facet) => {
    if (directMonitoringFacets.has(facet)) return true;
    const label = monitoringFacetGapLabels[facet];
    return Boolean(label && gapText.includes(label));
  });
  const toxicityCovered =
    directSections.some(
      (section) =>
        section.kind === "required_actions" &&
        /\btoxicity\b/i.test(`${section.heading} ${section.body}`) &&
        hasCompoundToxicityActionEvidence(section.body),
    ) || gapText.includes("actions for suspected toxicity");
  return requestedFacetsCovered && toxicityCovered;
}

/** Has invalid model evidence ids. */
export function hasInvalidModelEvidenceIds(answer: Pick<RagAnswer, "routingReason">) {
  return /\binvalid_model_citation_ids\b/.test(answer.routingReason ?? "");
}

/** Generated answer quality failure reason. */
export function generatedAnswerQualityFailureReason(answer: RagAnswer, query: string, queryClass: RagQueryClass) {
  if (isBareDocumentSupportListAnswer(answer.answer ?? "")) {
    return documentSupportListIntent(query, queryClass) ? null : "bare_document_title_list";
  }
  const cleanedAnswer = sanitizeAnswerText(answer.answer);
  if (!cleanedAnswer) return "empty_after_sanitize";
  // A citation-free source gap is a valid fail-closed terminal response. The
  // lifecycle defect is specifically a refusal whose nearby-source citations
  // make it look grounded and suppress recovery.
  if (hasCitedProviderSourceGap(answer)) return "provider_source_gap";
  if (isBareDocumentSupportListAnswer(cleanedAnswer)) {
    return documentSupportListIntent(query, queryClass) ? null : "bare_document_title_list";
  }
  if (!hasCompleteOpeningSentence(cleanedAnswer)) return "incomplete_opening_sentence";
  if (hasBadFinalAnswerQuality(cleanedAnswer)) return "bad_final_answer_quality";
  if (hasClinicalAnswerQualityIssue(cleanedAnswer)) return "clinical_answer_quality_issue";
  if (isLowYieldClinicalText(cleanedAnswer)) return "low_yield_answer";
  if (isFragmentLikeClinicalAnswer(cleanedAnswer, query)) return "fragment_like_answer";
  if (isLaunderedGuidanceWrapperAnswer(cleanedAnswer)) return "guidance_wrapper_fragment";
  if (isMissingCriticalQueryIntent(query, cleanedAnswer) && !compoundMonitoringCoverageSatisfiesIntent(answer, query)) {
    return "missing_query_intent";
  }
  // Core-term (entity/intent) overlap responsiveness check. For extractive/low-confidence answers
  // it always applies. For synthesized model answers it is only safe on narrow simple direct
  // questions that are not bare definitions (yes/no, when/where, "does X…") — there a well-targeted
  // answer genuinely should carry the query entity terms, and anaphora is rare. Broad/comparison/
  // summary answers legitimately paraphrase, so enforcing overlap there would reject good answers.
  // A model-answer failure here only escalates fast→strong and is recovered for strongly
  // source-backed answers, so the downside of enforcing it is a retry, not a wrongful gap.
  const enforceModelAnswerOverlap = isSimpleDirectQuestion(query, queryClass) && !isBareDefinitionQuestion(query);
  if (
    (answer.routingMode === "extractive" || answer.confidence === "low" || enforceModelAnswerOverlap) &&
    !hasRelevantQueryOverlap(cleanedAnswer, query)
  ) {
    return "missing_query_overlap";
  }
  if (hasInvalidModelEvidenceIds(answer)) return "invalid_model_evidence_ids";
  const broadDocumentCoverageRequested =
    queryClass === "document_lookup" &&
    /(?:\b(?:what|which)\b.{0,100}\b(?:include|included|require|required|requirements?)\b|\b(?:process|procedure)\b|\bhow\b.{0,80}\b(?:handled|managed|performed|completed)\b)/i.test(
      query,
    );
  const distinctAvailableSources = new Set((answer.sources ?? []).map((source) => source.id)).size;
  if (broadDocumentCoverageRequested && distinctAvailableSources >= 2 && answer.citations.length < 2) {
    return "insufficient_broad_citation_coverage";
  }
  if (isUnusableGeneratedAnswer(answer)) return "unusable_generated_answer";
  if (isTemplateLikeGeneratedAnswer(answer)) return "template_like_answer";
  if (isOverExpandedSimpleGeneratedAnswer(query, queryClass, answer)) return "overexpanded_simple_answer";
  return null;
}

/**
 * Detects whether an answer is a bare list of document titles rather than a substantive prose response.
 */
export function isBareDocumentSupportListAnswer(text: string): boolean {
  return /^I found (?:\d+|one) indexed documents? that supports? this query:/i.test(text.trim());
}

/**
 * Whether an extractive fallback candidate is safe to ship in place of a failed
 * generation: grounded and supported, clean of every final answer-quality gate,
 * and numerically verified with zero unverified tokens. Pure — extracted from
 * the rag.ts generation-fallback path so candidate selection stays testable in
 * isolation.
 */
export function isSafeExtractiveFallbackCandidate(candidate: RagAnswer, query: string, queryClass: RagQueryClass) {
  if (!candidate.grounded || candidate.confidence === "unsupported") return false;
  if (generatedAnswerQualityFailureReason(candidate, query, queryClass)) return false;
  const verified = finalizeRagAnswerQuality(cloneAnswer(candidate), query, queryClass, candidate.sources);
  // This predicate admits the supplied candidate, not an independently salvaged
  // replacement produced by finalization. The caller still holds the original.
  if (/claim_support_unsupported_(?:claims|sections)_withheld/.test(verified.routingReason ?? "")) {
    const prose = (value: RagAnswer) =>
      [value.answer, ...(value.answerSections ?? []).map((section) => section.body)]
        .map((text) => normalizeSectionText(text.replace(/\*\*/g, "")))
        .join("\n");
    if (prose(candidate) !== prose(verified)) return false;
  }
  return (
    verified.grounded &&
    verified.confidence !== "unsupported" &&
    verified.citations.length > 0 &&
    (verified.unverifiedNumericTokens?.length ?? 0) === 0
  );
}

/**
 * Replaces an answer that fails final quality checks with an evidence-gap response.
 *
 * @param answer - The answer to replace.
 * @param query - The original user query.
 * @param queryClass - The classified query type.
 * @param reason - The quality gate failure reason.
 * @returns The answer marked as unsupported and requiring an evidence gap response.
 */
function finalQualityFailure(answer: RagAnswer, query: string, queryClass: RagQueryClass, reason: string): RagAnswer {
  return {
    ...answer,
    answer: finalQualityGapAnswer(query, queryClass),
    rejectedCandidateText: answer.answer,
    grounded: false,
    confidence: "unsupported",
    answerSections: [],
    responseMode: "evidence_gap",
    routingReason: [answer.routingReason, `final_quality_gate:${reason}`].filter(Boolean).join("; "),
  };
}

/**
 * After claim support has removed unsafe or duplicate sections, keep only the
 * citations that still support delivered fallback content. Quote cards count
 * as delivered evidence; ranked retrieval padding and removed-section support
 * do not. This is intentionally scoped to source-backed generation fallback so
 * ordinary deterministic and model-selected citation semantics remain unchanged.
 */
function retainDeliveredExtractiveFallbackEvidence(answer: RagAnswer, query: string, queryClass: RagQueryClass) {
  if (
    answer.routingMode !== "extractive" ||
    answer.preformatted ||
    !/(?:source_backed_extractive_fallback|validated_agitation_arousal_typo_dosing_extractive_first)/.test(
      answer.routingReason ?? "",
    )
  ) {
    return answer;
  }

  const answerIntent = classifyAnswerIntent(query, queryClass);
  const explicitEscalation = requiresClinicalEscalationFallbackSafety(query);
  const escalationEvidenceMatchesQuery = (text: string, source?: SearchResult, boundedContext = text) => {
    const sourceSubjectContext = [
      source?.title,
      source?.file_name,
      source?.section_heading,
      source?.parent_heading,
      ...(source?.section_path ?? []),
      ...(source?.index_unit?.heading_path ?? []),
    ]
      .filter(Boolean)
      .join(" ")
      .replace(/[_-]+/g, " ");
    const relevanceContext = [sourceSubjectContext, text].filter(Boolean).join(" ");
    if (!hasRelevantQueryOverlap(relevanceContext, query, answerIntent)) return false;
    // In this source, "side effects are noted as causing distress" states the
    // live clinical trigger; it is not a report/audit wrapper. Remove only that
    // present-tense construction before applying the provenance-history guard.
    const provenanceContext = boundedContext.replace(
      /\b((?:side effects?|symptoms?|reactions?))\s+are\s+noted\s+as\s+causing\b/gi,
      "$1 causing",
    );
    if (
      staleEscalationProvenancePattern.test(sourceSubjectContext) ||
      strongHistoricalEscalationCuePattern.test(sourceSubjectContext) ||
      strongHistoricalEscalationCuePattern.test(provenanceContext) ||
      reportedEscalationWrapperPattern.test(provenanceContext)
    ) {
      return false;
    }
    if (hasForeignMedicationClinicalValueBinding(query, text)) return false;
    const queryMedications = new Set(medicationSafetyEntitiesInText(query));
    const evidenceMedications = medicationSafetyEntitiesInText(text);
    const contextMedications = medicationSafetyEntitiesInText(sourceSubjectContext);
    if (queryMedications.size > 0) {
      const boundedMedications = evidenceMedications.length > 0 ? evidenceMedications : contextMedications;
      return (
        boundedMedications.some((medication) => queryMedications.has(medication)) &&
        boundedMedications.every((medication) => queryMedications.has(medication))
      );
    }
    if (/\b(?:neuroleptics?|antipsychotics?)\b/i.test(query)) {
      const boundedMedications = evidenceMedications.length > 0 ? evidenceMedications : contextMedications;
      return boundedMedications.every(isAntipsychoticMedicationEntity);
    }
    return true;
  };
  const sourceById = new Map(answer.sources.map((source) => [source.id, source]));
  const directEscalationSupportSegments = (claimText: string, source: SearchResult) => {
    // High-risk escalation support must come from primary chunk text or a
    // structured table row. Derived synopses/index units can omit historical
    // qualifiers and therefore cannot independently establish a current rule.
    const evidenceValues = [
      source.content,
      ...(source.table_facts ?? []).map((fact) =>
        [fact.table_title, fact.row_label, fact.clinical_parameter, fact.threshold_value, fact.action]
          .filter(Boolean)
          .join(": "),
      ),
    ];
    return evidenceValues.flatMap((value) => {
      const paragraphs = (value ?? "").split(/\n\s*\n/).filter((paragraph) => paragraph.trim().length > 0);
      return paragraphs.flatMap((paragraph, paragraphIndex) => {
        const sentences = splitClinicalEvidenceSentences(paragraph);
        const boundedHistoricalSourceLabel =
          paragraph.match(
            /(?:^|[.!?]\s+)\s*(?:source|origin|provenance)\s*:\s*[^.!?\n]{0,120}\b(?:audit|retrospective|case\s+review|incident\s+report|historical|study|survey|previous|prior|earlier|former|superseded|obsolete|archived|withdrawn|legacy|retired|repealed|discontinued|outdated)\b[^.!?\n]*/i,
          )?.[0] ?? "";
        const precedingParagraph = paragraphs[paragraphIndex - 1] ?? "";
        const boundedPrecedingHistoricalParagraph =
          precedingParagraph.length <= 240 &&
          (strongHistoricalEscalationCuePattern.test(precedingParagraph) ||
            reportedEscalationWrapperPattern.test(precedingParagraph))
            ? precedingParagraph
            : "";
        return sentences.flatMap((segment, index) => {
          const directlySupports = sourceDirectlySupportsAnswerText(claimText, {
            ...source,
            section_heading: null,
            section_path: [],
            parent_heading: null,
            content: segment,
            retrieval_synopsis: null,
            table_facts: [],
            index_unit: null,
          });
          if (!directlySupports) return [];
          const followingSentence = sentences[index + 1] ?? "";
          const followingReferencesPrior =
            /^\s*(?:(?:this|that|these|those)\s+|the\s+(?:above|preceding|previous)\s+)(?:requirement|recommendation|guidance|statement|rule|action)\b/i.test(
              followingSentence,
            ) ||
            /^\s*(?:this|that|it|these|those)\s+(?:(?:was|were|is|are|has\s+been|have\s+been|had\s+been)\s+(?:(?:the\s+)?(?:requirement|recommendation|guidance|statement|rule|action)\s+)?(?:recorded|reported|documented|noted|found|observed|described|stated|indicated|based\s+on|from)\b|(?:came|comes)\s+from\b)/i.test(
              followingSentence,
            ) ||
            /^\s*the\s+(?:requirement|recommendation|guidance|statement|rule|action)\s+(?:(?:was|is|has\s+been|had\s+been)\s+(?:recorded|reported|documented|noted|found|observed|described|stated|indicated|based\s+on|from)\b|(?:came|comes)\s+from\b)/i.test(
              followingSentence,
            ) ||
            /^\s*its\s+(?:origin|provenance|source)\s+(?:was|is|has\s+been|had\s+been)\b/i.test(followingSentence) ||
            /^\s*the\s+source\s+for\s+(?:(?:this|that|the)\s+)?(?:requirement|recommendation|guidance|statement|rule|action)\s+(?:was|is|has\s+been|had\s+been)\b/i.test(
              followingSentence,
            ) ||
            /^\s*(?:(?:the|this|that)\s+)?(?:requirement|recommendation|guidance|statement|rule|action)\s+(?:originated|derives?|derived|came|comes)\s+(?:in|from)\b/i.test(
              followingSentence,
            ) ||
            /^\s*source\s*:/i.test(followingSentence);
          const followingQualifiesPrior =
            followingReferencesPrior &&
            (strongHistoricalEscalationCuePattern.test(followingSentence) ||
              reportedEscalationWrapperPattern.test(followingSentence));
          return [
            {
              segment,
              boundedContext: [
                boundedPrecedingHistoricalParagraph,
                sentences.slice(0, index + 1).join(" "),
                followingQualifiesPrior ? followingSentence : "",
                boundedHistoricalSourceLabel,
              ]
                .filter(Boolean)
                .join(" "),
            },
          ];
        });
      });
    });
  };
  const directClaimChunkIds = (answer.supportedClaims ?? [])
    .filter((claim) => claim.supportStatus === "direct")
    .flatMap((claim) =>
      claim.supportingChunkIds.filter((chunkId) => {
        if (!explicitEscalation) return true;
        const source = sourceById.get(chunkId);
        if (!source) return false;
        return directEscalationSupportSegments(claim.text, source).some(
          ({ segment, boundedContext }) =>
            escalationEvidenceMatchesQuery(segment, source, boundedContext) &&
            hasTargetedEscalationAction(segment) &&
            (!asksForEscalationTrigger(query) || hasEscalationTrigger(segment)),
        );
      }),
    );
  const quoteCards = (answer.quoteCards ?? []).filter((quote) => {
    const source = sourceById.get(quote.chunk_id);
    if (!source) return false;
    if (!hasBoundedMedicationSubjectForNumericRepeatDoseSchedule(quote.quote, source, query)) return false;
    if (!explicitEscalation) return hasRelevantQueryOverlap(quote.quote, query, answerIntent);
    return directEscalationSupportSegments(quote.quote, source).some(
      ({ segment, boundedContext }) =>
        escalationEvidenceMatchesQuery(segment, source, boundedContext) &&
        hasTargetedEscalationAction(segment) &&
        (!asksForEscalationTrigger(query) || hasEscalationTrigger(segment)),
    );
  });
  const deliveredChunkIds = new Set([...directClaimChunkIds, ...quoteCards.map((quote) => quote.chunk_id)]);
  const citations = answer.citations.filter((citation) => deliveredChunkIds.has(citation.chunk_id));
  const retained = retainCitedExtractiveFallbackEvidence({ ...answer, citations, quoteCards });
  if (!answer.grounded || answer.confidence === "unsupported" || retained.citations.length > 0) return retained;

  return retainCitedExtractiveFallbackEvidence({
    ...finalQualityFailure(retained, query, queryClass, "extractive_fallback_no_delivered_support"),
    citations: [],
    quoteCards: [],
    bestSource: null,
    supportedClaims: undefined,
    evidenceAssessments: undefined,
  });
}

function appendCompoundMonitoringOutputGap(answer: RagAnswer, query: string) {
  if (!answer.grounded || answer.routingMode !== "extractive" || !isCompoundMonitoringToxicityQuery(query)) {
    return answer;
  }
  const withoutOldGap = {
    ...answer,
    answerSections: (answer.answerSections ?? []).filter((section) => section.kind !== "source_gap"),
  };
  const directSections = withoutOldGap.answerSections.filter(
    (section) => section.supportLevel === "direct" && section.citation_chunk_ids.length > 0,
  );
  const deliveredMonitoringTexts = [
    ...(withoutOldGap.citations.length > 0 ? [withoutOldGap.answer] : []),
    ...directSections.filter((section) => section.kind === "monitoring_timing").map((section) => section.body),
  ];
  const deliveredFacets = new Set(
    deliveredMonitoringTexts.map((text) =>
      monitoringFacetForFact({ kind: "monitoring", text, citationChunkIds: [], priority: 0 }),
    ),
  );
  const absent = [...requestedMonitoringScheduleFacets(query)]
    .filter((facet) => !deliveredFacets.has(facet))
    .map((facet) => monitoringFacetGapLabels[facet])
    .filter((label): label is string => Boolean(label));
  const actionPresent = directSections.some(
    (section) =>
      section.kind === "required_actions" &&
      /\btoxicity\b/i.test(`${section.heading} ${section.body}`) &&
      hasCompoundToxicityActionEvidence(section.body),
  );
  if (!actionPresent) absent.push("actions for suspected toxicity");
  if (absent.length === 0) return withoutOldGap;
  const gapSection: AnswerSection = {
    heading: "Evidence gaps",
    kind: "source_gap",
    supportLevel: "unsupported",
    body: `This answer does not establish: ${absent.join(", ")}.`,
    citation_chunk_ids: [],
  };
  return {
    ...withoutOldGap,
    answerSections: reserveMetadataSlots(withoutOldGap, [gapSection], adaptiveAnswerLimits.sections),
  };
}

// A "bare cross-reference" answer redirects the reader to another named document for the real
// content — e.g. "Refer to the RKPG Guidelines to Writing for Clinical Policy for further
// information about Scope of Practice." It answers nothing itself, so it must never be rescued by
// the source-backed recovery gate on the strength of structured-chunk signals in the *cited*
// sources. The guard is deliberately narrow — it fires only when the lead sentence is a pointer
// (directive) AND a "for further information"-style redirect AND names a document-style object — so
// it leaves untouched both the terse paraphrases the recovery gate legitimately exists for (e.g.
// "Depot antipsychotic follow-up is covered by the cited local pathway.", no redirect clause) and
// passive clinical referral facts (e.g. "Patients are referred to the community team for further
// information and support.", which point at a service, not a document).
const crossReferenceDirectivePattern =
  /\b(?:refer(?:red|s|ring)?\s+to|(?:please\s+)?see|consult|as\s+(?:per|outlined|described|detailed|set\s+out))\b/i;

const crossReferenceRedirectPattern =
  /\bfor\s+(?:further|more|additional|detailed|complete|full)\s+(?:information|detail|details|guidance|advice|reading|instruction|instructions)\b/i;

const crossReferenceDocumentObjectPattern =
  /\b(?:guidance|guidelines?|policy|policies|procedures?|protocols?|appendix|appendices|manuals?|documents?|documentation|frameworks?|standards?|sops?|handbooks?|factsheets?|leaflets?|booklets?|templates?|checklists?|forms?|sections?|chapters?)\b/i;

/**
 * Determines whether text consists of a bare redirect to another source for additional information.
 *
 * @param text - The answer text to evaluate
 * @returns `true` if the lead sentence directs the reader to another document or source for further information, `false` otherwise.
 */
export function isBareCrossReferenceAnswer(text: string) {
  const lead = firstSentence(text).replace(/\*\*/g, "");
  if (!lead) return false;
  return (
    crossReferenceDirectivePattern.test(lead) &&
    crossReferenceRedirectPattern.test(lead) &&
    crossReferenceDocumentObjectPattern.test(lead)
  );
}

/**
 * Determines whether a source-backed generated answer may bypass a quality-gate failure.
 *
 * @param answer - The generated answer and its source-selection metadata
 * @param reason - The quality-gate failure reason
 * @param cleanedAnswer - The sanitized answer text used for cross-reference detection
 * @returns `true` if the answer is grounded and supported by relevant source-selection signals, `false` otherwise
 */
function shouldPreserveSourceBackedGeneratedAnswer(answer: RagAnswer, reason: string, cleanedAnswer: string) {
  if (reason !== "missing_query_intent" && reason !== "missing_query_overlap") return false;
  // Never rescue a bare cross-reference / "refer elsewhere for more information" pointer: it carries
  // no responsive content, and (being here) already shares no query terms, so preserving it would
  // ship an off-topic redirect as a grounded clinical answer. Evaluate the same sanitized text the
  // quality gate judged, so a stripped leading noise fragment can't hide the redirect lead.
  if (isBareCrossReferenceAnswer(cleanedAnswer)) return false;
  if (!answer.grounded || answer.confidence === "unsupported" || answer.citations.length === 0) return false;
  if (hasInvalidModelEvidenceIds(answer)) return false;

  const sourceSelection = answer.smartApiPlan?.answerPlan.sourceSelection;
  if (!sourceSelection?.selectedCount || !sourceSelection.requiredSignalsSatisfied) return false;
  if (sourceSelection.missingRequiredSignals.length > 0) return false;

  const matchedSignals = sourceSelection.matchedSignals;
  const hasSpecificSourceSignal = matchedSignals.some(
    (signal) =>
      signal.startsWith("index_unit:") ||
      [
        "document_title",
        "document_title_phrase",
        "document_label",
        "table_fact",
        "source_image",
        "visual_table",
        "direct_relevance",
        "active_community",
        "ed",
        "agitation",
        "dose_amount",
        "route",
        "flowchart_or_pathway",
      ].includes(signal),
  );
  const hasStructuredChunk =
    sourceSelection.topChunkTypes.table > 0 ||
    sourceSelection.topChunkTypes.flowchart > 0 ||
    sourceSelection.topChunkTypes.medication_chart > 0 ||
    sourceSelection.topChunkTypes.patient_education > 0;

  return hasSpecificSourceSignal || hasStructuredChunk;
}

/** Section heading kind. */
function sectionHeadingKind(heading: string): AnswerSectionKind {
  if (/\b(?:dose|dosing|medication)\b/i.test(heading)) return "medication_dose";
  if (/\b(?:monitor|timing|baseline|follow)\b/i.test(heading)) return "monitoring_timing";
  if (/\b(?:threshold|red|amber|withhold|stop|cease)\b/i.test(heading)) return "thresholds";
  if (/\b(?:gap|unsupported|source)\b/i.test(heading)) return "source_gap";
  if (/\b(?:contraindicat(?:e|es|ed|ion|ions)|caution|avoid|risk)\b/i.test(heading))
    return "contraindications_cautions";
  return "required_actions";
}

/** Clean answer section heading. */
export function cleanAnswerSectionHeading(heading: string, body: string) {
  const normalized = normalizeSectionText(heading);
  if (
    !normalized ||
    /^(?:direct answer|bottom line|high-yield summary|source-backed answer|direct source-backed answer)$/i.test(
      normalized,
    )
  ) {
    if (/\b(?:dose|mg|daily|tds|bd)\b/i.test(body)) return "Dose";
    if (/\b(?:monitor|baseline|fbc|anc|ecg|level)\b/i.test(body)) return "Monitoring";
    if (/\b(?:withhold|stop|cease|threshold|red|amber)\b/i.test(body)) return "Thresholds";
    if (/\b(?:gap|not enough|unsupported|insufficient)\b/i.test(body)) return "Source gap";
    return "Key point";
  }
  return normalized;
}

/** Apply provider labels. */
function applyProviderLabels(answer: RagAnswer): RagAnswer {
  const inferredSourceOnlyFallback =
    answer.routingMode === "extractive" || /(?:^|;\s*)generation_fallback(?::|$)/i.test(answer.routingReason ?? "");
  const answerQualityTier: RagAnswer["answerQualityTier"] =
    answer.answerQualityTier ??
    (answer.modelUsed ? "model_synthesis" : inferredSourceOnlyFallback ? "source_only" : undefined);
  const legacyFallbackReason = answer.routingReason
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => /source_only_[a-z_]+|fallback|unsupported|no_|gap|conflict|failed|low_signal/i.test(part));
  const fallbackReason =
    answer.fallbackReason ?? (answerQualityTier === "source_only" ? (legacyFallbackReason ?? "source_only") : null);
  const inferredFallbackReasonCode = fallbackReasonFromRouting(answer.routingReason);
  const strongerGovernanceCode = strongerGovernanceFallbackReasonFromRouting(answer.routingReason);
  const explicitFallbackReasonCode = normalizeRagFallbackReasonCode(answer.fallbackReasonCode);
  const fallbackReasonCode =
    strongerGovernanceCode ??
    (answer.fallbackReasonCode != null
      ? explicitFallbackReasonCode
      : inferredFallbackReasonCode === "unknown"
        ? null
        : inferredFallbackReasonCode);
  const degradedActive = answerQualityTier === "source_only";
  return {
    ...answer,
    providerMode: answer.providerMode ?? ragProviderMode(),
    answerQualityTier,
    fallbackReasonCode,
    fallbackReason,
    degradedMode: answer.degradedMode ?? {
      active: degradedActive,
      reason: degradedActive ? fallbackReason : null,
    },
  };
}

/**
 * Fast-route final-gate gap recovery: when a grounded, cited, low-confidence fast
 * model answer over strong routine retrieval is only gap-like phrasing, rebuild a
 * deterministic source-backed answer from the evidence it already cites instead of
 * shipping a citation-free evidence gap. Mirrors the rag.ts generation-fallback
 * recovery, which handles the thrown variants of the same failure — today, model
 * phrasing alone decides which of the two branches a gap-shaped fast answer takes.
 * Returns null to keep the gap terminal: genuinely empty retrieval, strong-route
 * gaps, and comparison/dose/threshold classes (whose fallbacks need dedicated
 * single-chunk handling) never recover here. The rebuilt candidate is routingMode
 * "extractive", so the re-entrant validation finalize cannot re-trigger this
 * fast-gated recovery.
 */
function recoverFinalGateGapExtractively(
  answer: RagAnswer,
  query: string,
  queryClass: RagQueryClass,
  gapReason: string,
): RagAnswer | null {
  if (answer.routingMode !== "fast") return null;
  if (!answer.routingReason?.includes("strong_routine_retrieval")) return null;
  if ((answer.sources?.length ?? 0) === 0) return null;
  if (queryClass === "comparison" || queryClass === "medication_dose_risk" || queryClass === "table_threshold") {
    return null;
  }
  // Band-coherence source conflicts already have a throw-based recovery in rag.ts.
  if (answer.routingReason.includes("numeric_band_coherence_gate_source_conflict")) return null;
  const recoveryRouteReason = [
    answer.routingReason,
    `generation_fallback:${gapReason}`,
    "source_backed_extractive_fallback",
    `final_quality_gate_source_backed_recovery:${gapReason}`,
  ].join("; ");
  const candidate = buildExtractiveAnswer({
    query,
    queryClass,
    results: answer.sources,
    quoteCards: answer.quoteCards ?? [],
    documentBreakdown: answer.documentBreakdown ?? [],
    evidenceSummary: answer.evidenceSummary,
    sourceCoverage: answer.sourceCoverage,
    conflictsOrGaps: answer.conflictsOrGaps ?? [],
    visualEvidence: answer.visualEvidence ?? [],
    bestSource: answer.bestSource ?? null,
    smartPanel: answer.smartPanel,
    relatedDocuments: answer.relatedDocuments ?? [],
    routeReason: recoveryRouteReason,
    timings: answer.latencyTimings,
    allowSourceProseRecovery: true,
  });
  if (!candidate.grounded || candidate.confidence === "unsupported" || candidate.citations.length === 0) return null;
  if (isBareCrossReferenceAnswer(candidate.answer ?? "")) return null;
  const smartApiPlan = buildSmartRagApiPlan({
    query,
    queryClass,
    results: candidate.sources,
    routeMode: "extractive",
    routeReason: candidate.routingReason,
    conflictsOrGaps: candidate.conflictsOrGaps ?? [],
  });
  const merged: RagAnswer = {
    ...answer,
    ...candidate,
    modelUsed: null,
    supportedClaims: undefined,
    evidenceAssessments: undefined,
    smartApiPlan,
    responseMode: smartApiPlan.displayMode,
  };
  if (!isSafeExtractiveFallbackCandidate(merged, query, queryClass)) return null;
  return merged;
}

/** Reserve metadata slots without combining different evidence or silently dropping prose. */
function reserveMetadataSlots(answer: RagAnswer, metadata: AnswerSection[], sectionCap: number): AnswerSection[] {
  const prose = [...(answer.answerSections ?? [])];
  if (!metadata.length || prose.length > sectionCap) return [...prose, ...metadata];
  while (prose.length + metadata.length > sectionCap) {
    const index = prose.findIndex((left, index) => {
      const right = prose[index + 1];
      if (!right || left.kind !== right.kind || left.supportLevel !== right.supportLevel) return false;
      const ids = (section: AnswerSection) => [...new Set(section.citation_chunk_ids)].sort().join("\u0000");
      return (
        ids(left) === ids(right) &&
        left.heading.length + left.body.length + right.heading.length + right.body.length + 5 <=
          adaptiveAnswerLimits.body
      );
    });
    if (index < 0) break;
    const left = prose[index],
      right = prose[index + 1];
    prose.splice(index, 2, {
      ...left,
      body: left.heading + ": " + left.body + " " + right.heading + ": " + right.body,
    });
  }
  const combined = [...prose, ...metadata];
  // A failed consolidation must remain a visible contract rejection at the caller.
  return answerWithinLimits({ ...answer, answerSections: combined }, adaptiveAnswerLimits, sectionCap)
    ? combined
    : [...(answer.answerSections ?? []), ...metadata];
}

/** Content-only facet recognition after claim verification; never grants clinical support. */
function deliveredFacetPresent(facet: RagAskedPart, text: string) {
  switch (facet) {
    case "monitoring": {
      const kind = factKindForSentence(text, "monitoring", "monitoring_schedule");
      return !!kind && factSupportsAnswerIntent(kind, text, "monitoring", "monitoring_schedule");
    }
    case "dosing": {
      const kind = factKindForSentence(text, "dose", "dose");
      return !!kind && factSupportsAnswerIntent(kind, text, "dose", "dose");
    }
    case "risk":
      return /\b(?:risks?|caution|adverse|side effects?|contraindicat\w*|toxicity|escalat\w*|avoid|must not|do not)\b/i.test(
        text,
      );
    case "assessment":
      return /\b(?:assess\w*|investigat\w*|examin\w*)\b/i.test(text);
    case "differential":
      return /\b(?:differential|diagnos\w*|consider\w*|exclude\w*)\b/i.test(text);
    case "rationale":
      return /\b(?:because|rationale|mechanism|therefore|due to|by inhibiting|by blocking)\b/i.test(text);
    case "management":
      return (
        hasClinicalActionSignal(text) &&
        /\b(?:manag\w*|treat\w*|therapy|provide|commence(?:s|d|ment)?|start|administer|give|use|care)\b/i.test(text)
      );
    case "comparison":
      return /\b(?:whereas|compared|unlike|versus|both|difference|similar)\b/i.test(text);
    case "service_workflow":
      return /\b(?:service|form|tool|refer\w*|pathway)\b/i.test(text);
  }
}

function deliveredFrequencyPresent(text: string) {
  // Normalize equivalent spelled-out intervals into the existing delivered schedule signal.
  const interval = text
    .replace(/\byearly\b/gi, "annually")
    .replace(
      /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(days?|weeks?|months?|years?|hours?)\b/gi,
      (_, count: string, unit: string) =>
        `${["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"].indexOf(count.toLowerCase()) + 1} ${unit}`,
    );
  return (
    monitoringIntervalFigurePattern.test(interval.replace(/\bbaseline\b/gi, "")) ||
    repeatDoseScheduleFigurePattern.test(text)
  );
}

function deliveredFacetDetailPresent(facet: RagAskedPart, detail: RagRequestedFacetDetail, text: string) {
  if (!deliveredFacetPresent(facet, text)) return false;
  if (detail === "maximum") return hasMaximumDoseEvidence(text);
  if (detail === "route") return medicationDoseEvidenceQueryIntent(text).asksRoute;
  if (facet === "monitoring") return deliveredMonitoringFrequencyPresent(text);
  return deliveredFrequencyPresent(text);
}

/** Conservative applicability check for already verified prose, never source admission. */
function deliveredScopeMatches(question: string, prose: string) {
  const population = (text: string) =>
    new Set(
      normalizedClinicalSearchTokens(
        // A measurement target is not a population restriction.
        text.replace(/\b(?:renal|hepatic) function\b(?!\s+impairment)/gi, "function"),
      )
        .filter(hasClinicalPopulationSignal)
        .map((term) =>
          term
            .replace(/^children$/, "child")
            .replace(/^paediatric$/, "pediatric")
            .replace(/s$/, ""),
        ),
    );
  // Keep compound qualifiers before tokenization can collapse them to "adult".
  // Exact scope matching is deliberately conservative; unfamiliar equivalents
  // retain an answer limitation rather than acquiring population authority.
  const qualifiers = (text: string) =>
    new Set(
      (
        text.match(
          /\b(?:older adults?|young people|(?:over|under|above|below|aged?)\s+\d+(?:\s*[-–]\s*\d+)?(?:\s+years?(?:\s+old)?)?)\b/gi,
        ) ?? []
      ).map((term) =>
        term
          .toLowerCase()
          .replace(/\s+/g, " ")
          .replace(/older adults$/, "older adult"),
      ),
    );
  const requestedQualifiers = qualifiers(question);
  const deliveredQualifiers = qualifiers(prose);
  if (
    [...requestedQualifiers].some((term) => !deliveredQualifiers.has(term)) ||
    [...deliveredQualifiers].some((term) => !requestedQualifiers.has(term))
  )
    return false;
  const requestedPopulation = population(question);
  const deliveredPopulation = population(prose);
  if (
    [...requestedPopulation].some((term) => !deliveredPopulation.has(term)) ||
    [...deliveredPopulation].some((term) => !requestedPopulation.has(term))
  )
    return false;
  const requestedConditions =
    question.match(/\b(?:renal impairment|hepatic impairment|pregnan\w*|overdose|toxicity)\b/gi) ?? [];
  return requestedConditions.every((condition) => {
    const escaped = escapeQueryToken(condition);
    if (!new RegExp(`\\b${escaped}\\b`, "i").test(prose)) return false;
    const negated = new RegExp(
      `\\b(?:without|no(?: evidence of)?|absence of|free of|not(?: have|having|experiencing)?)(?:\\s+\\w+){0,3}\\s+${escaped}\\b|\\b${escaped}\\s+(?:is |was )?(?:absent|excluded)\\b`,
      "i",
    );
    const prefixedNegation = new RegExp(`\\bnon[- ]${escaped}\\b`, "i");
    const negative = (text: string) => negated.test(text) || prefixedNegation.test(text);
    return negative(question) === negative(prose);
  });
}

/** Account for delivered prose only. This does not assess source or corpus coverage. */
function unassessedDeliveryGap(answer: RagAnswer, queryPlan?: RagQueryPlan): AnswerSection | null {
  const visible = normalizeSectionText(
    [answer.answer, ...(answer.answerSections ?? []).map((section) => section.body)].join(" "),
  ).replaceAll("**", "");
  const citedIds = new Set(answer.citations.map((citation) => citation.chunk_id));
  const directClaims = (answer.supportedClaims ?? []).filter(
    (claim) =>
      claim.supportStatus === "direct" &&
      claim.supportingChunkIds.some((id) => citedIds.has(id)) &&
      visible.includes(normalizeSectionText(claim.text).replaceAll("**", "")),
  );
  const missing = new Set<string>();
  for (const part of queryPlan?.subquestions ?? []) {
    if (!part.required) continue;
    const intent = classifyAnswerIntent(part.question, classifyRagQuery(part.question).queryClass);
    const medicines = medicationEntitiesInText(part.question);
    // Match the subject here, then account for facets/details below. Requiring
    // the full retrieval intent would hide verified monitoring without a cadence
    // and safety cautions which are not absolute contraindications.
    const claims = directClaims.filter(
      (claim) =>
        deliveredScopeMatches(part.question, claim.text) &&
        (medicines.length
          ? medicines.some((medicine) => medicationEntitiesInText(claim.text).includes(medicine))
          : hasRelevantQueryOverlap(claim.text, part.question, "general")),
    );
    const safetyDependency = queryPlan?.materialSafetyDependencies?.includes(part.purpose);
    if (safetyDependency) {
      const constraints =
        part.question.match(/\b(?:renal impairment|hepatic impairment|pregnan\w*|overdose|toxicity)\b/gi) ?? [];
      // Check independently of facet bindings: the planner can attach a safety
      // dependency to an existing grouped part when its subquestion budget is full.
      const safetyPresent = claims.some(
        (claim) =>
          deliveredFacetPresent("risk", claim.text) &&
          constraints.length > 0 &&
          constraints.every((constraint) => deliveredProseRelevance(constraint, claim.text).missingTerms.length === 0),
      );
      if (!safetyPresent)
        missing.add(
          `safety implications of ${[...new Set(constraints)].join("; ") || "the stated clinical constraint"}`,
        );
      if (!part.requestedFacets?.length) continue;
    }
    if (!part.requestedFacets?.length) {
      const question = part.question.replace(/: directly relevant evidence for this comparison\.$/, "");
      const prose = claims.map((claim) => claim.text).join(" ");
      const relevance = deliveredProseRelevance(question, prose);
      const explicit = medicationDoseEvidenceQueryIntent(question);
      const attributesPresent =
        (!explicit.asksRoute || medicationDoseEvidenceQueryIntent(prose).asksRoute) &&
        (!explicit.asksFrequency || deliveredFrequencyPresent(prose));
      const clinicalIntent = intent !== "general" && intent !== "unsupported" && intent !== "document_lookup";
      const intentPresent =
        clinicalIntent &&
        claims.some((claim) => {
          const kind = factKindForSentence(claim.text, question, intent);
          return kind && factSupportsAnswerIntent(kind, claim.text, question, intent);
        });
      const partPresent =
        attributesPresent &&
        ((part.purpose !== "comparison_side" && intentPresent) ||
          (relevance.coreTerms.length > 0 && relevance.missingTerms.length === 0));
      if (!claims.length || !partPresent) {
        const name = question
          .replace(/[\u0000-\u001f\u007f<>\[\]\x60*_#\\]/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 160);
        missing.add(name);
      }
      continue;
    }
    for (const facet of part.requestedFacets ?? []) {
      const name = facet.replaceAll("_", " ");
      if (!claims.some((claim) => deliveredFacetPresent(facet, claim.text))) {
        missing.add(name);
        continue;
      }
      for (const detail of part.requestedFacetDetails?.[facet] ?? []) {
        if (!claims.some((claim) => deliveredFacetDetailPresent(facet, detail, claim.text)))
          missing.add(`${name} ${detail}`);
      }
    }
  }
  return missing.size
    ? {
        heading: "Answer limitation",
        kind: "source_gap",
        supportLevel: "unsupported",
        citation_chunk_ids: [],
        body: `This answer does not establish: ${[...missing].join("; ")}. Source coverage has not been assessed.`,
      }
    : null;
}

/** Downgrade source coverage when its requested part has no surviving verified prose. */
function reconcileDeliveredParts(answer: RagAnswer, coverage: AnswerCoveragePlan, queryPlan?: RagQueryPlan) {
  const required = coverage.subquestions.filter((part) => part.required);
  const missingFacets = new Map<string, RagAskedPart[]>();
  const missingDetails = new Map<string, Partial<Record<RagAskedPart, RagRequestedFacetDetail[]>>>();
  const deliveredText = normalizeSectionText(
    [answer.answer, ...(answer.answerSections ?? []).map((section) => section.body)].join(" "),
  ).replaceAll("**", "");
  const directClaims = (answer.supportedClaims ?? []).filter(
    (claim) =>
      claim.supportStatus === "direct" && deliveredText.includes(normalizeSectionText(claim.text).replaceAll("**", "")),
  );
  let changed = false;
  const entries = coverage.coverage.map((entry) => {
    const part = required.find((part) => part.id === entry.subquestionId);
    if (!part) return entry;
    const binding = queryPlan?.subquestions.find((binding) => binding.id === part.id);
    const facets = binding?.requestedFacets;
    if (entry.status === "absent" || entry.status === "conflicting") {
      if (entry.status === "absent" && facets?.length) missingFacets.set(part.id, facets);
      return entry;
    }
    const claims = directClaims.filter((claim) => claim.supportingChunkIds.some((id) => entry.chunkIds.includes(id)));
    const prose = claims.map((claim) => claim.text).join(" ");
    const relevance = deliveredProseRelevance(part.question, prose);
    const intent = classifyAnswerIntent(part.question, classifyRagQuery(part.question).queryClass);
    const explicit = medicationDoseEvidenceQueryIntent(part.question);
    const attributesPresent =
      (!explicit.asksRoute || medicationDoseEvidenceQueryIntent(prose).asksRoute) &&
      (!explicit.asksFrequency || deliveredFrequencyPresent(prose));
    const clinicalIntent = intent !== "general" && intent !== "unsupported" && intent !== "document_lookup";
    const intentPresent =
      clinicalIntent &&
      claims.some((claim) => {
        const kind = factKindForSentence(claim.text, part.question, intent);
        return (
          kind &&
          factSupportsAnswerIntent(kind, claim.text, part.question, intent) &&
          hasRelevantQueryOverlap(claim.text, part.question, intent)
        );
      });
    const absentDetails: Partial<Record<RagAskedPart, RagRequestedFacetDetail[]>> = {};
    const unmet = facets?.filter((facet) => {
      if (!claims.some((claim) => deliveredFacetPresent(facet, claim.text))) return true;
      const missing =
        binding?.requestedFacetDetails?.[facet]?.filter(
          (detail) => !claims.some((claim) => deliveredFacetDetailPresent(facet, detail, claim.text)),
        ) ?? [];
      if (missing.length) absentDetails[facet] = missing;
      return missing.length > 0;
    });
    missingDetails.set(part.id, absentDetails);
    if (unmet?.length) missingFacets.set(part.id, unmet);
    // Canonical facet bindings supersede the repeated whole-query scaffold. Unbound
    // consumer parts require their own complete content terms or content-only clinical intent.
    const partPresent = facets?.length
      ? !unmet?.length
      : attributesPresent && (intentPresent || (relevance.coreTerms.length > 0 && relevance.missingTerms.length === 0));
    if (claims.length && partPresent) return entry;
    changed = true;
    return {
      ...entry,
      status: "absent" as const,
      chunkIds: [],
      reasonCodes: ["insufficient_claim_support", ...entry.reasonCodes.filter((reason) => reason !== "not_in_corpus")],
    };
  });
  const deliveredFacets = new Set<RagAskedPart>();
  for (const entry of entries) {
    if (entry.status !== "direct") continue;
    const binding = queryPlan?.subquestions.find((part) => part.id === entry.subquestionId);
    for (const facet of binding?.requestedFacets ?? []) {
      if (
        directClaims.some(
          (claim) =>
            claim.supportingChunkIds.some((id) => entry.chunkIds.includes(id)) &&
            deliveredFacetPresent(facet, claim.text),
        )
      )
        deliveredFacets.add(facet);
    }
  }
  return {
    missingFacets,
    missingDetails,
    deliveredFacets,
    coverage: changed
      ? {
          ...coverage,
          coverage: entries,
          overall: coverage.conflicts.length ? ("conflicting" as const) : ("partial" as const),
          insufficiencyReason: coverage.conflicts.length
            ? ("source_conflict" as const)
            : ("insufficient_claim_support" as const),
        }
      : coverage,
  };
}

/** Verify generated prose once, then reconcile citations before rebuilding deterministic metadata. */
export function retainVerifiedAnswerParts(
  answer: RagAnswer,
  context: {
    query: string;
    queryPlan?: RagQueryPlan;
    queryClass: RagQueryClass;
    contract: RagAnswerGenerationContract;
    admittedPassageDelivery?: boolean;
    verificationSources?: SearchResult[];
    resolveCoverage: (verified: RagAnswer) => AnswerCoveragePlan | null;
    reconcileCoverage?: (verified: RagAnswer, coverage: AnswerCoveragePlan | null) => void;
    reviewRequest?: SearchChunksArgs;
    sectionCap?: (coverage: AnswerCoveragePlan | null) => number;
    checkedOriginalSectionLayout?: CheckedOriginalSectionLayout;
    originalSectionDeliveryPending?: boolean;
  },
) {
  const proseSections = (answer.answerSections ?? []).filter(
    (section) => section.kind !== "source_gap" && section.kind !== "source_conflict",
  );
  const verified = finalizeRagAnswerQuality(
    carryOriginalSectionCandidateProof(answer, { ...answer, answerSections: proseSections }),
    context.query,
    context.queryClass,
    context.verificationSources,
    context.contract,
    context,
  );
  const beforeDeliveryTransforms = carryOriginalSectionCandidateProof(verified, {
    ...verified,
    citations: verified.citations.map((citation) => ({ ...citation })),
    answerSections: verified.answerSections?.map((section) => ({
      ...section,
      citation_chunk_ids: [...section.citation_chunk_ids],
    })),
  });
  const finalSourceIds = new Set(verified.sources.map((row) => row.id));
  verified.citations = verified.citations.filter((citation) => finalSourceIds.has(citation.chunk_id));
  const resolvedCoverage = context.resolveCoverage(verified);
  const delivered = resolvedCoverage ? reconcileDeliveredParts(verified, resolvedCoverage, context.queryPlan) : null;
  let coverage = delivered?.coverage ?? null;
  const citedIds = new Set(verified.citations.map((citation) => citation.chunk_id));
  const finalRows = verified.sources.filter((row) => citedIds.has(row.id));
  const canonicalSections = (coverage?.conflicts ?? []).flatMap((conflict) => {
    const section = buildSourceConflictSection(conflict, finalRows, context.reviewRequest);
    return section ? [{ conflict, section }] : [];
  });
  if (coverage && canonicalSections.length !== coverage.conflicts.length) {
    const valid = new Set(canonicalSections.map(({ conflict }) => conflict.id));
    const rejectedIds = new Set(
      coverage.conflicts
        .filter((conflict) => !valid.has(conflict.id))
        .flatMap((conflict) => [...conflict.local.supportingChunkIds, ...conflict.australian.supportingChunkIds]),
    );
    coverage = {
      ...coverage,
      conflicts: canonicalSections.map(({ conflict }) => conflict),
      overall: "partial",
      insufficiencyReason: "insufficient_claim_support",
      coverage: coverage.coverage.map((entry) =>
        entry.chunkIds.some((id) => rejectedIds.has(id))
          ? {
              ...entry,
              status: "partial",
              reasonCodes: [...new Set([...entry.reasonCodes, "source_policy_not_evaluated"])],
            }
          : entry,
      ),
    };
    verified.conflictsOrGaps = (verified.conflictsOrGaps ?? []).filter(
      (flag) =>
        flag.type !== "conflict" ||
        !(flag.source_chunk_ids?.length && flag.source_chunk_ids.every((id) => rejectedIds.has(id))),
    );
    if (verified.fallbackReasonCode === "source_conflict") verified.fallbackReasonCode = "coverage_gap";
  }
  context.reconcileCoverage?.(verified, coverage);
  const retainedSectionCount = verified.answerSections?.length ?? 0;
  let gapAdded = false;
  let conflictAdded = false;
  if (
    !coverage &&
    context.admittedPassageDelivery &&
    verified.grounded &&
    verified.confidence !== "unsupported" &&
    verified.citations.length
  ) {
    const gap = unassessedDeliveryGap(verified, context.queryPlan);
    if (gap) {
      verified.answerSections = reserveMetadataSlots(
        verified,
        [gap],
        context.sectionCap?.(null) ?? adaptiveAnswerLimits.sections,
      );
      gapAdded = true;
    }
  }
  if (coverage && verified.grounded && verified.confidence !== "unsupported" && verified.citations.length) {
    const conflicts = canonicalSections.map(({ section }) => section);
    const missing = coverage.subquestions.filter(
      (part) =>
        part.required &&
        !coverage.coverage.some(
          (entry) =>
            entry.subquestionId === part.id &&
            (entry.status === "direct" || entry.status === "conflicting") &&
            entry.chunkIds.some((id) => citedIds.has(id)),
        ),
    );
    const sections = [...conflicts];
    conflictAdded = conflicts.length > 0;
    if (missing.length) {
      const gapsByReason = new Map<string, string[]>();
      const partReasons: readonly RagInsufficiencyReason[] = [
        "insufficient_claim_support",
        "not_in_corpus",
        "retrieval_miss",
        "source_role_mismatch",
        "governance_block",
        "site_content_updating",
        "site_content_stale",
        "site_content_unavailable",
        "timeout",
        "provider_failure",
      ];
      const namedMissing = new Map<
        string,
        { part: (typeof missing)[number]; width: number; names: string[]; detailed: boolean }
      >();
      for (const part of missing) {
        const binding = context.queryPlan?.subquestions.find((binding) => binding.id === part.id);
        const facets = (delivered?.missingFacets.get(part.id) ?? binding?.requestedFacets)?.filter(
          (facet) => !delivered?.deliveredFacets.has(facet),
        );
        const width = binding?.requestedFacets?.length ?? 1;
        for (const name of facets ?? [part.question]) {
          const details = facets ? delivered?.missingDetails.get(part.id)?.[name as RagAskedPart] : undefined;
          const label = facets ? name.replaceAll("_", " ") : name;
          const names = details?.length ? details.map((detail) => `${label} ${detail}`) : [label];
          const detailed = !!details?.length;
          const previous = namedMissing.get(name);
          if (!previous || width < previous.width || (width === previous.width && detailed && !previous.detailed))
            namedMissing.set(name, { part, width, names, detailed });
        }
      }
      for (const { part, names } of namedMissing.values()) {
        const missingName = names.join("; ");
        const entry = coverage.coverage.find((entry) => entry.subquestionId === part.id);
        // A whole-answer reviewed conflict says nothing about an unrelated missing part.
        const explicitReason = partReasons.find((reason) => entry?.reasonCodes.includes(reason));
        const reason =
          explicitReason ??
          (coverage.insufficiencyReason === "source_conflict"
            ? "insufficient_claim_support"
            : (coverage.insufficiencyReason ?? "insufficient_claim_support"));
        const message =
          reason === "not_in_corpus"
            ? "not covered by the active sources."
            : publicFallbackReason(classifyRagFallbackReason({ insufficiencyReason: reason }));
        const name = missingName
          .normalize("NFKC")
          .replace(/[\u0000-\u001f\u007f<>\[\]\x60*_#\\]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        gapsByReason.set(message, [...(gapsByReason.get(message) ?? []), name]);
      }
      if (gapsByReason.size)
        sections.push({
          heading: "Source gap",
          kind: "source_gap",
          supportLevel: "unsupported",
          citation_chunk_ids: [],
          body: [...gapsByReason].map(([message, names]) => names.join("; ") + ": " + message).join(" "),
        });
      gapAdded = gapsByReason.size > 0;
    }
    verified.answerSections = reserveMetadataSlots(
      verified,
      sections,
      context.sectionCap?.(coverage) ?? adaptiveAnswerLimits.sections,
    );
  }
  return {
    answer: enforceOriginalSectionDeliveredCompleteness(
      carryFinalizedOriginalSectionProof(beforeDeliveryTransforms, verified),
      context.query,
      context,
    ),
    retainedSectionCount,
    droppedSectionCount: Math.max(0, proseSections.length - retainedSectionCount),
    gapAdded,
    conflictAdded,
  };
}

// Public wrapper: runs quality finalization, then stamps provider/quality labels so the UI can
// disclose source-only (lower-quality) answers and verify-against-sources guidance.
/** Finalize rag answer quality. */
export function finalizeRagAnswerQuality(
  answer: RagAnswer,
  query: string,
  queryClass: RagQueryClass,
  verificationSources?: SearchResult[],
  contract: RagAnswerGenerationContract = legacyAnswerGenerationContract,
  context: OriginalSectionFinalizationContext = {},
): RagAnswer {
  context = { ...context, contract };
  const sourceRendering =
    contract.promptVersion === legacyAnswerGenerationContract.promptVersion &&
    contract.schemaVersion === legacyAnswerGenerationContract.schemaVersion
      ? renderSourceBoundAlcoholSummary(answer, verificationSources ?? answer.sources, query, queryClass)
      : null;
  const recoveredOriginal = recoverCheckedOriginalSectionRecommendation(
    sourceRendering?.answer ?? answer,
    query,
    context,
  );
  const coherenceChecked = enforceLabelledNumericBandCoherence(recoveredOriginal, { query, verificationSources });
  const qualityChecked = restoreCheckedOriginalSectionBulletPresentation(
    finalizeRagAnswerQualityCore(coherenceChecked, query, queryClass, contract),
    recoveredOriginal,
    context,
  );
  const verified = applyNumericVerification(
    assessAndEnforceClaimSupport(qualityChecked, verificationSources),
    verificationSources,
  );
  const retained = retainDeliveredExtractiveFallbackEvidence(verified, query, queryClass);
  const finalized = enforceOriginalSectionDeliveredCompleteness(
    carryFinalizedOriginalSectionProof(
      recoveredOriginal,
      applyProviderLabels(appendCompoundMonitoringOutputGap(retained, query)),
    ),
    query,
    context,
  );
  if (sourceRendering && !sourceRendering.complete(finalized)) {
    return finalizeRagAnswerQuality(
      {
        ...finalized,
        answer: machineReadableFallbackAnswer,
        grounded: false,
        confidence: "unsupported",
        citations: [],
        answerSections: [],
        quoteCards: [],
      },
      query,
      queryClass,
      verificationSources,
      contract,
      context,
    );
  }
  return finalized;
}

/**
 * Finalizes answer prose by applying textual quality gates and sanitizing content.
 *
 * @param answer - The answer to validate and finalize
 * @param query - The user query used to assess relevance and highlight clinical terms
 * @param queryClass - The classification of the user query
 * @returns The finalized RAG answer with validated content, sections, and confidence metadata
 */
function finalizeRagAnswerQualityCore(
  answer: RagAnswer,
  query: string,
  queryClass: RagQueryClass,
  contract: RagAnswerGenerationContract,
): RagAnswer {
  // Deterministic, template-built answers (document-support lists, table/visual source
  // references) are well-formed by construction and carry no free-text clinical claims.
  // The clinical-prose sanitizer/quality gate below is designed for model prose and would
  // strip their document names (facility codes like "(NOCC)(AKG)" read as non-prose),
  // turning a valid answer into garble that then fails the gate. Return them untouched.
  if (answer.preformatted && answer.grounded) {
    return answer;
  }
  // Ledger #ZK460W. The source-backed review fallback is not a model answer being judged: it is a
  // deterministic pointer built in this module ("a full written answer could not be completed,
  // here are the passages that were retrieved"), delivered ungrounded and unsupported with
  // review-only citations. Emission sites set `sourceBackedReviewFallback` so this short-circuit
  // does not depend on routingReason string matching or empty-sections side-conditions.
  // Every gate below is written for model prose and returns the wrong verdict on it:
  // the ungrounded/unsupported gate and the query-overlap gate both replace it with
  // "No current source ... was found", printed above the sources that were in fact found. That
  // contradiction is what previously forced the route to relabel itself grounded to stay clear of
  // these gates, which is the defect this row exists for. Nothing model-authored passes here.
  if (answer.sourceBackedReviewFallback && !answer.grounded && answer.confidence === "unsupported") {
    // The display mode is forced conservative here rather than left to the route's smart plan: a
    // plan built for the rejected candidate can still ask for a threshold-table or comparison
    // shape, and this answer has no rows to put in one. An evidence gap with citations attached is
    // what it actually is.
    return { ...answer, responseMode: "evidence_gap" };
  }
  const cleanedAnswer = sanitizeAnswerText(answer.answer);
  const gapLikeAnswer =
    /could not find enough clean|no relevant clinical source|no current source|cannot provide a clinical answer|cannot provide a source-backed clinical answer|nearby indexed passages|not strong enough to support a reliable answer|no specific\b.*\bcan be confirmed|do not contain indexed guidance|do not contain (?:specific\s+)?information|do not provide specific|no\b.*\bguidance\b.*\bincluded|defer to other sources/i.test(
      cleanedAnswer,
    );
  const existingGapAnswer =
    gapLikeAnswer && (!answer.grounded || answer.routingMode === "strong" || answer.confidence === "low");
  if (existingGapAnswer) {
    const gapReason = answer.modelUsed ? "provider_source_gap" : "source_gap";
    const recovered = recoverFinalGateGapExtractively(answer, query, queryClass, gapReason);
    // Terminates: the recovered answer is routingMode "extractive", so the fast-gated
    // recovery cannot re-fire on this re-run.
    if (recovered) return finalizeRagAnswerQualityCore(recovered, query, queryClass, contract);
    const gapAnswer = finalQualityGapAnswer(query, queryClass);
    return {
      ...answer,
      answer: gapAnswer,
      rejectedCandidateText: answer.answer,
      grounded: false,
      confidence: "unsupported",
      citations: [],
      answerSections: [],
      quoteCards: [],
      bestSource: null,
      supportedClaims: undefined,
      evidenceAssessments: undefined,
      routingReason: [answer.routingReason, `final_quality_gate:${gapReason}`].filter(Boolean).join("; "),
      responseMode: "evidence_gap",
    };
  }

  if (!answer.grounded && answer.confidence === "unsupported") {
    return finalQualityFailure(answer, query, queryClass, "ungrounded_unsupported_answer");
  }

  let qualityFailureReason = !cleanedAnswer
    ? "empty_after_sanitize"
    : cleanedAnswer.length < 18
      ? "answer_too_short"
      : generatedAnswerQualityFailureReason(answer, query, queryClass);

  if (qualityFailureReason) {
    if (shouldPreserveSourceBackedGeneratedAnswer(answer, qualityFailureReason, cleanedAnswer)) {
      answer = {
        ...answer,
        confidence: answer.confidence === "low" ? "medium" : answer.confidence,
        routingReason: [answer.routingReason, `final_quality_gate_source_backed_recovery:${qualityFailureReason}`]
          .filter(Boolean)
          .join("; "),
      };
      qualityFailureReason = null;
    } else {
      return finalQualityFailure(answer, query, queryClass, qualityFailureReason);
    }
  }

  const answerKey = normalizeSectionText(cleanedAnswer).toLowerCase();
  const answerSections = (answer.answerSections ?? [])
    .map((section) => {
      const body = sanitizeAnswerText(section.body);
      if (!body || hasClinicalAnswerQualityIssue(body) || isLowYieldClinicalText(body)) return null;
      const bodyKey = normalizeSectionText(body).toLowerCase();
      const isDocumentListSection = section.kind === "documentation" || /\bdocument matches\b/i.test(section.heading);
      if (
        !isDocumentListSection &&
        (bodyKey === answerKey ||
          answerKey.includes(bodyKey) ||
          (bodyKey.includes(answerKey) &&
            (contract.promptVersion !== ragAdaptiveAnswerPromptVersion || !bodyKey.replaceAll(answerKey, "").trim())))
      ) {
        return null;
      }
      const heading = cleanAnswerSectionHeading(section.heading, body);
      return {
        ...section,
        heading,
        body: boldHighYieldClinicalText(body, query),
        kind: section.kind ?? sectionHeadingKind(heading),
        supportLevel: section.supportLevel ?? "direct",
      } satisfies AnswerSection;
    })
    .filter((section): section is Exclude<typeof section, null> => Boolean(section));

  return {
    ...answer,
    answer: boldHighYieldClinicalText(cleanedAnswer, query),
    answerSections,
  };
}

/** A rejected generated format is terminal, not evidence that the retained sources lack an answer. */
export function rejectAdaptiveAnswerContract(answer: RagAnswer, query: string, queryClass: RagQueryClass): RagAnswer {
  const rejected = finalQualityFailure(answer, query, queryClass, "adaptive_answer_contract_rejected");
  return applyProviderLabels({
    ...rejected,
    answer:
      "The requested answer could not be safely completed within the supported response format. Review the retained sources for the requested detail.",
    answerContractVersion: undefined,
    renderAdaptiveAnswer: undefined,
    citations: [],
    quoteCards: [],
    supportedClaims: [],
    evidenceAssessments: {},
    unverifiedNumericTokens: [],
    bestSource: null,
    modelUsed: null,
    answerQualityTier: "source_only",
    routingReason: `${rejected.routingReason}; generation_fallback:adaptive_answer_contract_rejected`,
    fallbackReasonCode: "citation_or_claim_gate",
    fallbackReason: undefined,
    degradedMode: undefined,
  });
}
