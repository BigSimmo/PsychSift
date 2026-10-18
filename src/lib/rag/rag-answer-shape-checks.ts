// Answer-shape checks shared by the extractive builder and the final quality gate: fragment and
// opening-sentence checks, guidance-wrapper detection, procedural flow-edge artefacts and cited
// fallback evidence retention. Moved unchanged out of rag-extractive-answer.ts.

import {
  buildDocumentBreakdown,
  buildEvidenceSummary,
  buildSmartPanel,
  buildSourceCoverage,
  buildVisualEvidence,
  detectConflictsOrGaps,
  selectBestSourceRecommendation,
} from "@/lib/evidence";
import { buildEvidenceRelevance } from "@/lib/evidence-relevance";
import { buildAnswerScoreExplanations, buildIndexingQuality, collectMemoryCards } from "@/lib/rag/rag-answer-support";
import { normalizeSectionText } from "@/lib/rag/rag-answer-text";
import { retainRelatedDocumentsForResults } from "@/lib/retrieval-selection";
import { buildSmartRagApiPlan } from "@/lib/smart-rag-api";
import { type RagAnswer, type RagQueryClass, type SearchResult } from "@/lib/types";
import { assessClaimSupport } from "@/lib/rag/rag-claim-support";
import { containsDanglingProceduralComparatorStepArtifact } from "@/lib/rag/rag-extractive-artifacts";
import { classifyAnswerIntent, clinicalQuerySignalPattern, type AnswerIntent } from "@/lib/rag/rag-answer-intent";
import { extractiveMalformedFactFragmentPattern } from "@/lib/rag/rag-extractive-signals";

/** Whether result metadata/body contains a flow edge rejected as procedural evidence. */
export function resultContainsProceduralFlowEdgeArtifact(result: SearchResult) {
  return [
    result.retrieval_synopsis,
    result.section_heading,
    result.content,
    result.adjacent_context,
    result.index_unit?.title,
    result.index_unit?.content,
    ...(result.memory_cards ?? []).map((card) => card.content),
    ...(result.table_facts ?? []).flatMap((fact) => [
      fact.table_title,
      fact.row_label,
      fact.clinical_parameter,
      fact.threshold_value,
      fact.action,
      [fact.table_title, fact.row_label, fact.clinical_parameter, fact.threshold_value, fact.action]
        .filter(Boolean)
        .join(": "),
    ]),
  ].some(containsDanglingProceduralComparatorStepArtifact);
}

export function filterRelatedDocumentsForProceduralArtifacts(
  relatedDocuments: RagAnswer["relatedDocuments"],
  retainedResults: SearchResult[],
) {
  const cleanDocuments = (relatedDocuments ?? []).filter(
    (document) =>
      !containsDanglingProceduralComparatorStepArtifact(
        [document.title, document.file_name, document.summary, document.match_reason].filter(Boolean).join(" "),
      ),
  );
  return retainRelatedDocumentsForResults(cleanDocuments, retainedResults);
}

export function derivedArtifactsContainProceduralFlowEdge(value: unknown) {
  try {
    return containsDanglingProceduralComparatorStepArtifact(JSON.stringify(value));
  } catch {
    return false;
  }
}

export const templateLikeGeneratedPrefixPattern =
  /^(?:answer|summary|bottom line|required actions|direct answer)\s*[:.-]\s+/i;

/** Is clearly non clinical unsupported query. */
function isClearlyNonClinicalUnsupportedQuery(query: string) {
  return (
    /\b(?:coffee|machine|parking|payroll|roster|leave|wifi|printer|canteen|expense|timesheet|room\s+booking|building|staff\s+room)\b/i.test(
      query,
    ) && !clinicalQuerySignalPattern.test(query)
  );
}

/** Final quality gap answer. */
export function finalQualityGapAnswer(
  query: string,
  queryClass: RagQueryClass,
  intent: AnswerIntent = classifyAnswerIntent(query, queryClass),
) {
  if (
    isClearlyNonClinicalUnsupportedQuery(query) ||
    (queryClass === "unsupported_or_general" && !clinicalQuerySignalPattern.test(query))
  ) {
    return "No relevant clinical source was found for this query.";
  }
  if (intent === "document_lookup") return "No current indexed document directly supporting this request was found.";
  if (intent === "pathway_referral" && /\bect\b/i.test(query)) {
    return "No current source with ECT referral criteria was found.";
  }
  if (intent === "pathway_referral") return "No current source with referral or pathway criteria was found.";
  if (intent === "contraindication") return "No current source with contraindication or avoid-use guidance was found.";
  if (intent === "monitoring_schedule")
    return "No current source with monitoring timing or schedule guidance was found.";
  if (intent === "red_result_action") {
    if (/\bqtc\b/i.test(query)) return "No current source with QTc threshold or ECG action guidance was found.";
    if (/\btoxicity\b/i.test(query)) return "No current source with toxicity action guidance was found.";
    if (/\brash\b/i.test(query)) return "No current source with rash action guidance was found.";
    return "No current source with threshold-specific action guidance was found.";
  }
  if (intent === "dose") {
    if (/\brenal\b/i.test(query)) return "No current source with renal dosing limits for this query was found.";
    return "No current source with dose guidance for this query was found.";
  }
  return "No current source with directly relevant clinical guidance was found.";
}

/** Is fragment like clinical answer. */
export function isFragmentLikeClinicalAnswer(text: string, query: string) {
  const normalized = normalizeSectionText(text);
  const lower = normalized.toLowerCase();
  if (extractiveMalformedFactFragmentPattern.test(normalized)) {
    return true;
  }
  if (/^for\s+(?:after|before|prior|post),/i.test(normalized)) return true;
  if (/\bis\s+to:\.?$/i.test(normalized)) return true;
  if (
    /^what\s+is\b/i.test(query) &&
    // Only apply this fragment gate for general/definition questions, not for clinical intent
    // queries like "What is the maximum dose?" or "What is the QTc threshold?" which produce
    // valid concise fact answers that don't contain definition-style phrasing.
    !/\b(?:required|requirements?|dose|dosage|dosing|max(?:imum)?|mg|mcg|threshold|monitor(?:ing)?|renal|contraindicat(?:e|es|ed|ion|ions)|referral|pathway|procedure|process|protocol|workflow|steps?|ect|electroconvulsive|qtc|fbc|anc|wbc|level|levels)\b/i.test(
      query,
    ) &&
    // "What is required/needed/involved/included…" and "what is the process/procedure/protocol…"
    // are procedural questions, not definitions — their answers (and the source-pointer fallback)
    // legitimately lack "X is a/an…" definition phrasing, so the definition-fragment gate must not
    // fire for them (it otherwise fails good answers closed on a false positive — see P6).
    !/^what\s+is\s+(?:required|needed|involved|included|expected|recommended|considered|the\s+(?:process|procedure|protocol|criteria|requirement|approach|guidance|recommendation|role|purpose|aim))\b/i.test(
      query,
    ) &&
    !/\b(?:is|are)\s+(?:a|an|the)\b|\b(?:defined\s+as|characteri[sz]ed\s+by|involves|refers\s+to|is\s+an?\s+eating\s+disorder)\b/i.test(
      normalized,
    )
  ) {
    return true;
  }
  if (/\bbaby\s+whilst\b.*\bpost\s+anaesthetic\b/i.test(normalized)) return true;
  if (/^(\*{0,2}[a-z][a-z0-9 -]{2,}\*{0,2})\s*:\s*\1\b/i.test(normalized)) return true;
  if (/\?\s+(?:monitoring|adverse effects|when prescribed|prescribed for)\b/i.test(normalized)) return true;
  if (/\bmonitoring adverse effects when prescribed\b/i.test(normalized)) return true;
  if (/\b(?:after starting|ongoing)\s+\*{0,2}[a-z]+\*{0,2}\.?$/i.test(normalized) && normalized.length < 90) {
    return true;
  }
  if (/\bect\b/i.test(query) && !/\b(?:ect|electroconvulsive|refer|referral)\b/i.test(lower)) return true;
  return false;
}

// "e.g." and "i.e." do not end a sentence: "contributors are interactions with drugs (e.g. NSAIDs)"
// was cut at "(e.g." and rejected as an incomplete opening (#ZZ4RAP).
const openingSentenceTerminatorPattern = /(?<!\b(?:e\.g|i\.e))[.!?]["')\]]*(?:\s|$)/i;

const incompleteOpeningSentencePattern =
  /^(?:and|or|but|because|although|while|when|where|after|before|during|with|without|including|such as|then|to|recommended\s+over|alternative\s+agent|chart\s+reference|table\s+summari[sz]ing)\b/i;

const sourceHeadingOpeningPattern =
  /^(?:appendix\s+\d+|dosage|dose|dosing|dosage and monitoring|dose table|monitoring|referral criteria|contraindications?|adverse effects?|required actions?|thresholds?|summary|overview|formulations?|available products?|product information|table|figure)\.?$/i;

const openingSentenceActionPattern =
  /\b(?:are|avoid|arrange|be|can|cannot|cease|check|contact|continue|could|discontinue|document|escalate|give|include|includes|included|increase|inform|involves|is|list|lists|may|might|monitor|must|need|needed|needs|notify|provide|provides|recommend(?:s|ed|ing|ation|ations)?|recommends|reduce|refer|repeat|report|required|requires|review|should|start|starts|stop|support|supports|use|uses|was|were|will|withhold|would)\b/i;

// Recognise a complete limit instruction without treating the noun "drink" in
// headings or lists as a verb. This is grammar only; evidence gates still bind
// the quantity, period, population and risk qualifications to cited sources.
const drinkLimitQuantityPeriodPattern = String.raw`\d+(?:\.\d+)?\s+standard\s+drinks?\s+(?:a\s+(?:week|day)|per\s+(?:week|day)|on\s+any\s+one\s+day)`;

const openingDrinkLimitImperativePattern = new RegExp(
  String.raw`^(?:for\s+[^,.;!?]{1,140},\s*)?drink\s+(?:no\s+more\s+than|at\s+most)\s+${drinkLimitQuantityPeriodPattern}(?:\s+and\s+(?:no\s+more\s+than|at\s+most)\s+${drinkLimitQuantityPeriodPattern})?(?:;\s+less\s+drinking\s+further\s+lowers\s+risk)?[.!?]["')\]]*$`,
  "i",
);

// The recorded adult instruction shares its upper-limit verb across both periods.
const openingSharedDrinkLimitImperativePattern =
  /^for healthy adults aged \d+ years and over, drink (?:no more than|at most) \d+ standard drinks a week and \d+ standard drinks on any one day;? drinking less further reduces risk\.$/i;

/** First sentence. */
export function firstSentence(value: string) {
  const normalized = normalizeSectionText(value);
  const terminatorMatch = normalized.match(openingSentenceTerminatorPattern);
  if (!terminatorMatch || terminatorMatch.index === undefined) return normalized;
  return normalized.slice(0, terminatorMatch.index + terminatorMatch[0].trimEnd().length).trim();
}

/** Has complete opening sentence. */
export function hasCompleteOpeningSentence(value: string) {
  const normalized = normalizeSectionText(value);
  if (!normalized || !openingSentenceTerminatorPattern.test(normalized)) return false;
  const opening = firstSentence(normalized).replace(/\*\*/g, "").trim();
  const openingWithoutTerminal = opening.replace(/[.!?]["')\]]*$/, "").trim();
  if (opening.length < 18 || openingWithoutTerminal.length < 12) return false;
  if (templateLikeGeneratedPrefixPattern.test(opening)) return false;
  if (incompleteOpeningSentencePattern.test(opening)) return false;
  if (sourceHeadingOpeningPattern.test(openingWithoutTerminal)) return false;
  return (
    openingSentenceActionPattern.test(opening) ||
    openingDrinkLimitImperativePattern.test(opening) ||
    openingSharedDrinkLimitImperativePattern.test(opening)
  );
}

// The extractive completer's last-resort branch (completeExtractiveSentence, above) wraps a
// fragment it could not complete as "The guidance is that <fragment>.", and sentenceFromFact may
// then splice the query entity in as "The guidance for <entity> is that …". The wrapper supplies
// both a terminator and the finite verb "is", so the wrapped result passes
// hasCompleteOpeningSentence even though the text inside it did not.
//
// That wrapper is NOT purely laundering — it legitimately rescues well-formed clauses whose only
// flaw is that openingSentenceActionPattern is a narrow list of clinical directives rather than a
// general finite-verb test ("… the ECT Coordinator places the patient onto BASE" is a real
// sentence built on "places", which is not and should not be on that list). So this gate does not
// ask "does the continuation carry a clinical action". It rejects only two shapes that no verb
// list could rescue, both observed live in the 2026-08-21 capture
// (docs/rag-improvement/231-diagnosis-2026-08-22.md §3.1):
//
//   1. Layout debris: a ">" breadcrumb pointing at a word rather than a number, which is a
//      flattened heading trail, not a clinical comparator ("QTc > 500" is untouched).
//   2. A bare coordinated noun list with no determiner, auxiliary or directive verb anywhere —
//      "compliance, monitoring and evaluation" — which states nothing that can be checked
//      against a source.
//
// Runs after the other prose gates so anything they already reject keeps its existing reason;
// this only catches what nothing else does. clippedClinicalFragmentPattern (rag-answer-text.ts)
// covers the same wrapper for four continuations enumerated one incident at a time, and is
// deliberately left in place rather than replaced.
const launderedGuidanceWrapperPattern = /^the\s+guidance(?:\s+for\s+[^.!?]{1,60}?)?\s+is\s+that\s+(.+?)\.?$/i;

// A ">" aimed at a word, not a figure: "aim > To effectively identify…" is a heading trail left
// by PDF flattening. Numeric comparators ("ANC > 2.0", "eGFR > 30 mL/min") never match.
export const guidanceWrapperLayoutDebrisPattern = />\s*[A-Za-z]/;

// A coordinated list of bare nouns: letters, spaces, commas, apostrophes and hyphens only (so a
// clause carrying parentheses, digits, slashes or other punctuation is never judged here), joined
// by a comma or "and"/"or".
const guidanceWrapperNounListShapePattern = /^[A-Za-z][A-Za-z\s,'-]*(?:,|\band\b|\bor\b)[A-Za-z\s,'-]*[A-Za-z]$/;

const guidanceWrapperDeterminerPattern =
  /\b(?:the|a|an|this|that|these|those|their|its|his|her|our|your|any|each|every|all|both|no)\b/i;

const guidanceWrapperAuxiliaryPattern =
  /\b(?:is|are|was|were|be|been|being|has|have|had|do|does|did|can|could|may|might|must|shall|should|will|would)\b/i;

/** Is laundered guidance wrapper answer. */
export function isLaunderedGuidanceWrapperAnswer(text: string) {
  const opening = firstSentence(normalizeSectionText(text)).replace(/\*\*/g, "").trim();
  const continuation = opening.match(launderedGuidanceWrapperPattern)?.[1]?.trim();
  if (!continuation) return false;
  if (guidanceWrapperLayoutDebrisPattern.test(continuation)) return true;
  return (
    guidanceWrapperNounListShapePattern.test(continuation) &&
    !guidanceWrapperDeterminerPattern.test(continuation) &&
    !guidanceWrapperAuxiliaryPattern.test(continuation) &&
    !openingSentenceActionPattern.test(continuation)
  );
}

/**
 * Narrows a fallback candidate's sources to the chunks its citations actually
 * reference, so downstream claim support and numeric verification judge the
 * candidate on exactly the evidence it cites. Pure — extracted from the rag.ts
 * generation-fallback path.
 */
export function retainCitedExtractiveFallbackEvidence<T extends RagAnswer>(candidate: T): T {
  const cleanSources = candidate.sources.filter((source) => !resultContainsProceduralFlowEdgeArtifact(source));
  const removedProceduralArtifact = cleanSources.length !== candidate.sources.length;
  const rebuildDerivedArtifacts =
    removedProceduralArtifact ||
    derivedArtifactsContainProceduralFlowEdge({
      quoteCards: candidate.quoteCards,
      documentBreakdown: candidate.documentBreakdown,
      evidenceSummary: candidate.evidenceSummary,
      conflictsOrGaps: candidate.conflictsOrGaps,
      bestSource: candidate.bestSource,
      smartPanel: candidate.smartPanel,
      relatedDocuments: candidate.relatedDocuments,
    });
  const cleanSourceIds = new Set(cleanSources.map((source) => source.id));
  const citations = candidate.citations.filter((citation) => cleanSourceIds.has(citation.chunk_id));
  const citedChunkIds = new Set(citations.map((citation) => citation.chunk_id));
  const sources = cleanSources.filter((source) => citedChunkIds.has(source.id));
  const sourcesNarrowed = sources.length !== candidate.sources.length;
  const retainedDocumentIds = new Set(sources.map((source) => source.document_id));
  const answerSections = (candidate.answerSections ?? [])
    .map((section) => ({
      ...section,
      citation_chunk_ids: section.citation_chunk_ids.filter((chunkId) => citedChunkIds.has(chunkId)),
    }))
    .filter((section) => section.citation_chunk_ids.length > 0);
  const quoteCards = (candidate.quoteCards ?? []).filter((quote) => citedChunkIds.has(quote.chunk_id));
  const refreshResultDerivedArtifacts = rebuildDerivedArtifacts || sourcesNarrowed;
  const visualEvidence = refreshResultDerivedArtifacts
    ? buildVisualEvidence(sources)
    : (candidate.visualEvidence ?? []).filter((card) => citedChunkIds.has(card.source_chunk_id));
  const bestSource = rebuildDerivedArtifacts
    ? selectBestSourceRecommendation(sources, quoteCards.length ? quoteCards : undefined)
    : candidate.bestSource && citedChunkIds.has(candidate.bestSource.chunk_id)
      ? candidate.bestSource
      : null;
  const rebuiltConflictsOrGaps = refreshResultDerivedArtifacts ? detectConflictsOrGaps(sources) : [];
  const retainedConflictsOrGaps = (candidate.conflictsOrGaps ?? [])
    .map((item) => {
      if (!item.source_chunk_ids) return item;
      return { ...item, source_chunk_ids: item.source_chunk_ids.filter((chunkId) => citedChunkIds.has(chunkId)) };
    })
    .filter(
      (item) =>
        (!item.source_chunk_ids || item.source_chunk_ids.length > 0) &&
        !containsDanglingProceduralComparatorStepArtifact(item.message),
    );
  const conflictsOrGaps = Array.from(
    new Map(
      [...rebuiltConflictsOrGaps, ...retainedConflictsOrGaps].map((item) => [
        `${item.type}:${item.message}:${(item.source_chunk_ids ?? []).join(",")}`,
        item,
      ]),
    ).values(),
  );
  const documentBreakdown = buildDocumentBreakdown(sources, quoteCards);
  const evidenceSummary = buildEvidenceSummary(sources, quoteCards);
  const sourceCoverage = buildSourceCoverage(sources);
  const memoryCardsUsed = refreshResultDerivedArtifacts
    ? collectMemoryCards(sources)
    : (candidate.memoryCardsUsed ?? [])
        .map((card) => ({
          ...card,
          source_chunk_ids: card.source_chunk_ids.filter((chunkId) => citedChunkIds.has(chunkId)),
        }))
        .filter((card) => card.source_chunk_ids.length > 0);
  const scoreExplanations = refreshResultDerivedArtifacts
    ? buildAnswerScoreExplanations(sources)
    : (candidate.scoreExplanations ?? []).filter((item) => citedChunkIds.has(item.chunk_id));
  const artifactQuery = candidate.smartApiPlan?.query ?? candidate.smartPanel?.query;
  const relevance =
    refreshResultDerivedArtifacts && artifactQuery
      ? buildEvidenceRelevance(artifactQuery, sources)
      : candidate.relevance;
  const indexingQuality = refreshResultDerivedArtifacts
    ? buildIndexingQuality(sources, memoryCardsUsed)
    : candidate.indexingQuality;
  const sourceGovernanceWarnings = (candidate.sourceGovernanceWarnings ?? []).filter(
    (warning) => !warning.document_id || retainedDocumentIds.has(warning.document_id),
  );
  const safetyWarnings = (candidate.safetyWarnings ?? []).filter((warning) =>
    citedChunkIds.has(warning.citation.chunk_id),
  );
  const relatedDocuments = filterRelatedDocumentsForProceduralArtifacts(candidate.relatedDocuments, sources);
  const smartPanelBase =
    refreshResultDerivedArtifacts && artifactQuery
      ? buildSmartPanel(artifactQuery, sources, { relevance, visualEvidence })
      : candidate.smartPanel;
  const smartPanel = candidate.smartPanel
    ? {
        ...smartPanelBase,
        total_sources: sources.length,
        documents: documentBreakdown,
        quotes: quoteCards,
        visualEvidence,
        bestSource,
        image_count: visualEvidence.length,
        evidenceSummary,
        sourceCoverage,
        conflictsOrGaps,
        relevance,
        relatedDocuments,
      }
    : candidate.smartPanel;
  const smartApiPlan =
    candidate.smartApiPlan && sourcesNarrowed
      ? buildSmartRagApiPlan({
          query: candidate.smartApiPlan.query,
          queryClass: candidate.smartApiPlan.queryClass,
          results: sources,
          routeMode: candidate.smartApiPlan.answerPlan.routeMode,
          routeReason: candidate.routingReason,
          conflictsOrGaps,
          retrievalStrategy: candidate.smartApiPlan.retrievalStrategy,
          preferredResponseMode: candidate.smartApiPlan.responseMode,
        })
      : candidate.smartApiPlan;
  const retained = {
    ...candidate,
    citations,
    sources,
    answerSections,
    quoteCards,
    visualEvidence,
    bestSource,
    conflictsOrGaps,
    documentBreakdown,
    evidenceSummary,
    sourceCoverage,
    relevance,
    memoryCardsUsed,
    indexingQuality,
    scoreExplanations,
    sourceGovernanceWarnings,
    safetyWarnings,
    smartPanel,
    relatedDocuments,
    smartApiPlan,
  } as T;
  if (candidate.supportedClaims === undefined && candidate.evidenceAssessments === undefined) return retained;
  const reassessed = assessClaimSupport(retained);
  return {
    ...retained,
    supportedClaims: reassessed.claims,
    evidenceAssessments: reassessed.evidenceAssessments,
  } as T;
}
