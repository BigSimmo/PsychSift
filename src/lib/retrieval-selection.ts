import { citationFromResult, documentCitationHref } from "@/lib/citations";
import {
  hasMedicationMonitoringSubjectEvidence,
  medicationDoseEvidenceQueryIntent,
  medicationDoseQueryContext,
  medicationDoseQuerySubjectTokens,
  medicationMonitoringQuerySubjectTokens,
} from "@/lib/clinical-search";
import { buildCrossDocumentSynthesisPlan } from "@/lib/cross-document-synthesis";
import {
  buildDocumentBreakdown,
  buildEvidenceSummary,
  buildSmartPanel,
  buildSourceCoverage,
  buildVisualEvidence,
  detectConflictsOrGaps,
  extractQuoteCards,
  reconcileQuoteCards,
  selectBestSourceRecommendation,
} from "@/lib/evidence";
import { buildEvidenceRelevance } from "@/lib/evidence-relevance";
import { isClinicalImageEvidence } from "@/lib/image-filtering";
import { buildAnswerScoreExplanations, buildIndexingQuality, collectMemoryCards } from "@/lib/rag/rag-answer-support";
import { selectModelContextEvidence } from "@/lib/rag/rag-context-selection";
import type {
  RagAnswer,
  RagQueryPlan,
  RagQueryClass,
  RelatedDocument,
  RetrievalCandidate,
  RetrievalChunkType,
  RetrievalIntent,
  RetrievalSelectionSummary,
  SearchResult,
  SiteContentPartitionState,
  SourcePolicyConflict,
} from "@/lib/types";

export function selectAnswerRouteEvidence(args: {
  query: string;
  queryClass: RagQueryClass;
  results: SearchResult[];
  queryPlan?: RagQueryPlan;
  siteContentState?: SiteContentPartitionState;
  sourcePolicyConflicts?: readonly SourcePolicyConflict[];
}) {
  const selectionArgs = { ...args, routeMode: "strong" as const, crossDocument: false };
  const eligible = selectModelContextEvidence(selectionArgs);
  const crossDocumentPlan = buildCrossDocumentSynthesisPlan(args.query, eligible.results, args.queryClass);
  const rawResults = crossDocumentPlan.enabled ? crossDocumentPlan.results : eligible.results;
  // An empty governed selection still carries the reason candidates were
  // excluded. Reselecting an empty list would erase that coverage verdict.
  const routeSelection = rawResults.length
    ? selectModelContextEvidence({
        ...selectionArgs,
        results: rawResults,
        crossDocument: crossDocumentPlan.enabled,
      })
    : eligible;
  return { crossDocumentPlan, eligibleResults: eligible.results, rawResults, routeSelection };
}

export function buildSelectedEvidenceArtifacts(query: string, results: SearchResult[]) {
  const quoteCards = extractQuoteCards(results, query);
  const memoryCardsUsed = collectMemoryCards(results);
  return {
    relevance: buildEvidenceRelevance(query, results),
    quoteCards,
    documentBreakdown: buildDocumentBreakdown(results, quoteCards),
    smartPanel: buildSmartPanel(query, results),
    evidenceSummary: buildEvidenceSummary(results, quoteCards),
    sourceCoverage: buildSourceCoverage(results),
    conflictsOrGaps: detectConflictsOrGaps(results),
    visualEvidence: buildVisualEvidence(results),
    bestSource: selectBestSourceRecommendation(results, quoteCards),
    memoryCardsUsed,
    indexingQuality: buildIndexingQuality(results, memoryCardsUsed),
    scoreExplanations: buildAnswerScoreExplanations(results),
  };
}

export function retainRelatedDocumentsForResults(documents: RelatedDocument[], results: SearchResult[]) {
  const documentsById = new Map(documents.map((document) => [document.document_id, document]));
  const retainedByDocument = new Map<string, SearchResult[]>();
  for (const result of results) {
    const document = documentsById.get(result.document_id);
    if (!document) continue;
    retainedByDocument.set(result.document_id, [...(retainedByDocument.get(result.document_id) ?? []), result]);
  }
  return documents
    .flatMap((document) => {
      const retained = retainedByDocument.get(document.document_id) ?? [];
      if (!retained.length) return [];
      const bestPages = Array.from(
        new Set(retained.flatMap((result) => (result.page_number ? [result.page_number] : []))),
      ).slice(0, 5);
      const bestChunkIds = Array.from(new Set(retained.map((result) => result.id))).slice(0, 5);
      const score = Math.max(...retained.map((result) => result.hybrid_score ?? result.similarity));
      const matchReason = /^Matched \d+ indexed passages?$/.test(document.match_reason)
        ? `Matched ${bestChunkIds.length} indexed passage${bestChunkIds.length === 1 ? "" : "s"}`
        : document.match_reason;
      return [
        {
          ...document,
          title: retained[0]!.title,
          file_name: retained[0]!.file_name,
          best_pages: bestPages,
          best_chunk_ids: bestChunkIds,
          image_count: retained.reduce(
            (count, result) => count + (result.images?.filter(isClinicalImageEvidence).length ?? 0),
            0,
          ),
          match_reason: matchReason,
          score,
        },
      ];
    })
    .sort((a, b) => b.score - a.score);
}

export function applySelectedEvidenceArtifacts(args: {
  answer: RagAnswer;
  query: string;
  results: SearchResult[];
  relatedDocuments: RelatedDocument[];
  artifacts: ReturnType<typeof buildSelectedEvidenceArtifacts>;
  preserveBestSource?: boolean;
}) {
  const { answer, query, results, relatedDocuments, artifacts, preserveBestSource = false } = args;
  answer.sources = results;
  answer.quoteCards = reconcileQuoteCards(answer.quoteCards, results, query);
  answer.documentBreakdown = artifacts.documentBreakdown;
  answer.evidenceSummary = artifacts.evidenceSummary;
  answer.sourceCoverage = artifacts.sourceCoverage;
  answer.conflictsOrGaps = answer.conflictsOrGaps?.length ? answer.conflictsOrGaps : artifacts.conflictsOrGaps;
  answer.visualEvidence = artifacts.visualEvidence;
  answer.bestSource = preserveBestSource
    ? answer.bestSource
    : (selectBestSourceRecommendation(results, answer.quoteCards) ?? artifacts.bestSource);
  answer.relatedDocuments = relatedDocuments;
  answer.smartPanel = {
    ...artifacts.smartPanel,
    relevance: artifacts.relevance,
    bestSource: answer.bestSource,
    relatedDocuments,
  };
}

const emptyChunkTypeCounts = (): Record<RetrievalChunkType, number> => ({
  text: 0,
  table: 0,
  flowchart: 0,
  medication_chart: 0,
  patient_education: 0,
});

function clamp(value: number) {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function unique(values: string[], limit = 40) {
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

function normalize(value: string) {
  return value
    .normalize("NFKC")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9%/.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function evidenceText(result: SearchResult) {
  const tableText = (result.table_facts ?? [])
    .map((fact) =>
      [fact.table_title, fact.row_label, fact.clinical_parameter, fact.threshold_value, fact.action].join(" "),
    )
    .join(" ");
  const imageText = (result.images ?? [])
    .map((image) =>
      [
        image.caption,
        image.tableLabel,
        image.tableTitle,
        image.tableRole,
        image.tableTextSnippet,
        image.clinicalUseReason,
      ]
        .filter(Boolean)
        .join(" "),
    )
    .join(" ");
  const memoryText = (result.memory_cards ?? []).map((card) => `${card.title} ${card.content}`).join(" ");
  const indexUnitText = result.index_unit
    ? [
        result.index_unit.unit_type,
        result.index_unit.title,
        result.index_unit.content,
        ...(result.index_unit.heading_path ?? []),
        ...(result.index_unit.normalized_terms ?? []),
      ].join(" ")
    : "";

  return normalize(
    [
      result.title,
      result.file_name,
      result.section_heading,
      result.section_path?.join(" "),
      result.retrieval_synopsis,
      result.content,
      tableText,
      imageText,
      memoryText,
      indexUnitText,
      result.document_summary,
      ...(result.document_labels ?? []).map((label) => label.label),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function baseScore(result: SearchResult) {
  return clamp(result.hybrid_score ?? result.similarity ?? 0);
}

function chunkTypeForResult(result: SearchResult): RetrievalChunkType {
  const text = evidenceText(result);
  const unitType = result.index_unit?.unit_type ?? result.match_explanation?.indexUnitType ?? "";
  const hasClinicalImage = (result.images ?? []).some((image) =>
    ["clinical_table", "flowchart_algorithm", "medication_chart", "risk_matrix"].includes(image.image_type ?? ""),
  );
  const hasTableImage = (result.images ?? []).some((image) =>
    /table|chart|row|dose|threshold|matrix/i.test(
      `${image.image_type ?? ""} ${image.sourceKind ?? ""} ${image.tableTitle ?? ""} ${image.tableTextSnippet ?? ""}`,
    ),
  );

  if (
    unitType === "medication_chart_row" ||
    (result.images ?? []).some((image) => image.image_type === "medication_chart") ||
    /\b(?:medication chart|dose chart|dosing chart|dose table|lorazepam|olanzapine|haloperidol|droperidol|promethazine)\b/.test(
      text,
    )
  ) {
    return "medication_chart";
  }

  if (
    unitType === "flowchart_step" ||
    unitType === "diagram_decision" ||
    (result.images ?? []).some((image) => image.image_type === "flowchart_algorithm") ||
    /\b(?:flowchart|flow chart|algorithm|next step|step after|red zone|risk matrix|pathway step)\b/.test(text)
  ) {
    return "flowchart";
  }

  if (
    unitType === "table_fact" ||
    unitType === "table_threshold" ||
    unitType === "risk_matrix_cell" ||
    (result.table_facts?.length ?? 0) > 0 ||
    hasClinicalImage ||
    hasTableImage ||
    /\b(?:table|threshold|matrix|chart row|row label|clinical parameter)\b/.test(text)
  ) {
    return "table";
  }

  if (
    /\b(?:active community|community patient|community pt|patient education|patient information|emergency department| ed )\b/.test(
      ` ${text} `,
    )
  ) {
    return "patient_education";
  }

  return "text";
}

function hasDoseAmount(text: string) {
  return /\b\d+(?:\.\d+)?\s?(?:mg|mcg|microgram|micrograms)\b/.test(text);
}

function hasRoute(text: string) {
  return /\b(?:oral|orally|intramuscular|intramuscularly|subcutaneous|subcutaneously|subcut|sublingual|sublingually|im|po|sc|sl)\b/.test(
    text,
  );
}

function hasSourceImageEvidence(result: SearchResult) {
  return (
    (result.image_ids?.length ?? 0) > 0 ||
    (result.table_facts ?? []).some((fact) => Boolean(fact.source_image_id)) ||
    (result.images ?? []).some(
      (image) =>
        Boolean(image.id || image.storage_path) &&
        /\b(?:clinical_table|flowchart_algorithm|medication_chart|risk_matrix|table_crop|diagram_crop|page_region|embedded)\b/i.test(
          `${image.image_type ?? ""} ${image.sourceKind ?? ""} ${image.source_kind ?? ""}`,
        ),
    )
  );
}

function hasExactVisualTableEvidence(result: SearchResult) {
  return (
    (result.table_facts ?? []).some((fact) => Boolean(fact.source_image_id)) ||
    (result.images ?? []).some(
      (image) =>
        /\b(?:clinical_table|medication_chart|risk_matrix)\b/i.test(image.image_type ?? "") ||
        /\btable_crop\b/i.test(`${image.sourceKind ?? ""} ${image.source_kind ?? ""}`) ||
        Boolean(image.accessibleTableMarkdown || image.tableRows?.length || image.tableColumns?.length),
    )
  );
}

function hasRiskSignal(text: string) {
  return /\b(?:risk|red zone|red|amber|high risk|matrix|urgent|escalat(?:e|es|ed|ing|ion|ions))\b/.test(text);
}

function signalMatchesText(signal: string, text: string) {
  switch (signal) {
    case "active_community":
      return /\bactive\b/.test(text) && /\bcommunity\b/.test(text);
    case "ed":
      return /\b(?:ed|emergency department)\b/.test(text);
    case "agitation":
      return /\b(?:agitation|arousal|disturbance)\b/.test(text);
    case "dose_amount":
      return hasDoseAmount(text);
    case "route":
      return hasRoute(text);
    case "flowchart_or_pathway":
      return /\b(?:flowchart|flow chart|algorithm|pathway|matrix)\b/.test(text);
    case "next_step_or_action":
      return /\b(?:next step|step after|action|urgent|escalat(?:e|es|ed|ing|ion|ions)|senior|review|red zone)\b/.test(
        text,
      );
    case "risk":
      return hasRiskSignal(text);
    case "red_zone":
      return /\b(?:red zone|red)\b/.test(text);
    case "medication_chart":
      return /\b(?:medication chart|dose chart|dosing chart|dose table|pharmacological management)\b/.test(text);
    case "table":
      return /\b(?:table|chart|matrix|row)\b/.test(text);
    case "visual_table":
      return /\b(?:source image|table image|visual table|table crop|clinical table|chart image|matrix image)\b/.test(
        text,
      );
    case "clozapine":
      return /\bclozapine\b/.test(text);
    case "anc":
      return /\b(?:anc|neutrophil|neutrophils)\b/.test(text);
    case "fbc":
      return (
        /\b(?:fbc|full blood count|blood count)\b/.test(text) ||
        (/\b(?:wbc|wcc|white blood cells?)\b/.test(text) && /\b(?:anc|neutrophils?)\b/.test(text))
      );
    default:
      return text.includes(signal);
  }
}

function medicationClinicalSubjectMatches(query: string, result: SearchResult) {
  const doseIntent = medicationDoseEvidenceQueryIntent(query);
  if (doseIntent.asksAmount || doseIntent.asksRoute || doseIntent.asksFrequency) {
    return medicationDoseQueryContext(query, result).matched;
  }
  return hasMedicationMonitoringSubjectEvidence(query, result);
}

function matchedSignalsForResult(args: {
  query: string;
  intent: RetrievalIntent;
  result: SearchResult;
  chunkType: RetrievalChunkType;
}) {
  const text = evidenceText(args.result);
  const signals: string[] = [];
  const titleText = normalize(`${args.result.title} ${args.result.file_name}`);

  if (
    args.result.match_explanation?.titleHit ||
    args.intent.preferredDocumentSignals.some((signal) => titleText.includes(signal))
  ) {
    signals.push("document_title");
  }
  if (args.result.match_explanation?.labelHit) signals.push("document_label");
  if (args.result.match_explanation?.tableHit || (args.result.table_facts?.length ?? 0) > 0) signals.push("table_fact");
  if (args.result.index_unit?.unit_type) signals.push(`index_unit:${args.result.index_unit.unit_type}`);
  if ((args.result.images ?? []).some((image) => image.image_type === "flowchart_algorithm"))
    signals.push("flowchart_image");
  if ((args.result.images ?? []).some((image) => image.image_type === "medication_chart"))
    signals.push("medication_chart_image");
  if ((args.result.images ?? []).some((image) => image.image_type === "risk_matrix")) signals.push("risk_matrix_image");
  if (hasSourceImageEvidence(args.result)) signals.push("source_image");
  if (hasExactVisualTableEvidence(args.result)) signals.push("visual_table");
  if (args.chunkType !== "text") signals.push(args.chunkType);
  if (args.intent.needsDoseRouteFrequency && hasDoseAmount(text)) signals.push("dose_amount");
  if (args.intent.needsDoseRouteFrequency && hasRoute(text)) signals.push("route");
  if (
    args.intent.requiredTermSignals.includes("clinical_subject") &&
    medicationClinicalSubjectMatches(args.query, args.result)
  ) {
    signals.push("clinical_subject");
  }
  if (args.intent.needsPatientEducation && signalMatchesText("active_community", text))
    signals.push("active_community");
  if (args.intent.needsPatientEducation && signalMatchesText("ed", text)) signals.push("ed");
  if (/\b(?:agitation|arousal)\b/.test(text)) signals.push("agitation");
  if (args.intent.needsFlowchartStep && signalMatchesText("flowchart_or_pathway", text))
    signals.push("flowchart_or_pathway");
  if (args.intent.needsFlowchartStep && signalMatchesText("next_step_or_action", text))
    signals.push("next_step_or_action");
  if (args.intent.needsRiskFlowchart && signalMatchesText("risk", text)) signals.push("risk");
  if (args.intent.needsRiskFlowchart && signalMatchesText("red_zone", text)) signals.push("red_zone");
  if (args.result.relevance?.verdict === "direct") signals.push("direct_relevance");

  for (const signal of args.intent.requiredTermSignals) {
    if (signalMatchesText(signal, text)) signals.push(signal);
  }

  return unique(signals, 32);
}

function lexicalScoreForSignals(requiredSignals: string[], matchedSignals: string[]) {
  if (requiredSignals.length === 0) return 0;
  const matched = requiredSignals.filter((signal) => matchedSignals.includes(signal)).length;
  return Number((matched / requiredSignals.length).toFixed(4));
}

function resultBoost(args: { intent: RetrievalIntent; candidate: RetrievalCandidate; result: SearchResult }) {
  const signals = new Set(args.candidate.matchedSignals);
  let boost = 0;

  if (args.intent.needsMedicationChart && args.candidate.chunkType === "medication_chart") boost += 0.18;
  if (args.intent.needsMedicationChart && args.intent.requiredTermSignals.includes("agitation")) {
    boost += signals.has("agitation") ? 0.22 : -0.22;
  }
  if (
    args.intent.needsTable &&
    (args.candidate.chunkType === "table" || args.candidate.chunkType === "medication_chart")
  ) {
    boost += 0.1;
  }
  if (args.intent.needsFlowchartStep && args.candidate.chunkType === "flowchart") boost += 0.18;
  if (args.intent.needsFlowchartStep) {
    boost += signals.has("flowchart_or_pathway") ? 0.1 : -0.1;
    boost += signals.has("next_step_or_action") ? 0.08 : -0.06;
  }
  if (args.intent.needsRiskFlowchart && args.candidate.chunkType === "flowchart") boost += 0.08;
  if (args.intent.needsRiskFlowchart && signals.has("risk")) boost += 0.1;
  if (args.intent.needsRiskFlowchart && signals.has("red_zone")) boost += 0.1;
  if (args.intent.needsRiskFlowchart && !signals.has("risk")) boost -= 0.12;
  if (args.intent.needsRiskFlowchart && !signals.has("red_zone")) boost -= 0.06;
  if (args.intent.needsRiskFlowchart && args.candidate.chunkType === "flowchart" && !signals.has("risk")) boost -= 0.06;
  if (args.intent.needsPatientEducation && args.candidate.chunkType === "patient_education") boost += 0.18;
  if (args.intent.needsPatientEducation) {
    boost += signals.has("active_community") ? 0.16 : -0.16;
    boost += signals.has("ed") ? 0.08 : -0.08;
  }
  if (args.intent.needsSourceImage && signals.has("source_image")) boost += 0.22;
  if (args.intent.needsSourceImage && !signals.has("source_image")) boost -= 0.14;
  if (args.intent.needsExactVisualTable && signals.has("visual_table")) boost += 0.16;
  if (args.intent.needsExactVisualTable && (signals.has("table") || signals.has("table_fact"))) boost += 0.08;
  if (args.intent.needsDoseRouteFrequency && signals.has("dose_amount")) boost += 0.08;
  if (args.intent.needsDoseRouteFrequency && signals.has("route")) boost += 0.08;
  if (args.intent.requiredTermSignals.includes("clinical_subject")) {
    boost += signals.has("clinical_subject") ? 0.24 : -0.24;
  }
  if (args.intent.needsComparison && args.result.document_summary) boost += 0.03;
  if (signals.has("document_title")) boost += 0.05;
  if (signals.has("direct_relevance")) boost += 0.06;
  if (args.intent.requiredTermSignals.length > 0 && args.candidate.lexicalScore === 1) boost += 0.1;
  if (args.intent.requiredTermSignals.length > 0 && (args.candidate.lexicalScore ?? 0) === 0) boost -= 0.08;

  // NOTE (measured, do not reintroduce without re-running the golden retrieval eval): source
  // governance metadata (document_status / clinical_validation_status / extraction_quality) must
  // NOT weight selection ordering here. The corpus is only partially enriched — unenriched docs
  // normalize to unknown/unverified — so metadata weighting swings ranking by up to ~0.35 for
  // reasons unrelated to relevance and buried correct documents (golden doc-recall@5 1.0 -> 0.76,
  // 7/23 failures). Governance is enforced in ranking penalties and the answer/source-governance
  // layer instead; RC8 (source-strength as a filter) remains tracked in
  // docs/rag-hybrid-findings-and-todo.md.
  return boost;
}

export function buildRetrievalIntent(query: string, queryClass: RagQueryClass): RetrievalIntent {
  const normalizedQuery = normalize(query);
  const medicationEvidenceIntent = medicationDoseEvidenceQueryIntent(normalizedQuery);
  const asksDoseRoute =
    medicationEvidenceIntent.asksAmount || medicationEvidenceIntent.asksRoute || medicationEvidenceIntent.asksFrequency;
  const asksDoseAmount = medicationEvidenceIntent.asksAmount;
  const asksMedicationMonitoring =
    (queryClass === "medication_dose_risk" || queryClass === "table_threshold") &&
    /\b(?:monitor\w*|baseline|blood|level|threshold|cut[\s-]?off|range|anc|fbc|neutrophils?|qtc|therapeutic|target|trough|concentration)\b/.test(
      normalizedQuery,
    );
  const clinicalSubjectTokens = asksMedicationMonitoring
    ? medicationMonitoringQuerySubjectTokens(query)
    : medicationDoseQuerySubjectTokens(query);
  const asksTable = /\b(?:table|chart|matrix|threshold|cutoff|cut off|range|criteria|row)\b/.test(normalizedQuery);
  const asksSourceImage =
    /\b(?:source|show|open|view|display|see)\b.*\b(?:image|figure|visual|table|chart|matrix)\b/.test(normalizedQuery) ||
    /\b(?:image|figure|visual)\b.*\b(?:source|table|chart|matrix)\b/.test(normalizedQuery);
  const asksExactVisualTable =
    asksSourceImage && /\b(?:table|chart|matrix|anc|fbc|monitoring|threshold|row)\b/.test(normalizedQuery);
  // A dose mentioned only as the monitoring clock must not request a dosing
  // chart. Keep established ranking for other monitoring and chart queries.
  const monitoringDoseTimingOnly = asksMedicationMonitoring && !asksDoseRoute && /\bdose\b/.test(normalizedQuery);
  const asksMedicationChart =
    (queryClass === "medication_dose_risk" && !monitoringDoseTimingOnly) ||
    /\b(?:medication chart|dose chart|dosing chart|pharmacological management|agitation|arousal)\b/.test(
      normalizedQuery,
    );
  const asksFlowchart = /\b(?:flowchart|flow chart|algorithm|next step|step after|pathway|red zone|risk matrix)\b/.test(
    normalizedQuery,
  );
  const asksRiskFlowchart =
    asksFlowchart &&
    /\b(?:risk|red zone|red|amber|high|urgent|escalat(?:e|es|ed|ing|ion|ions)|matrix)\b/.test(normalizedQuery);
  const asksPatientEducation =
    /\b(?:active community|community patients?|community pts?|patient education|patient information)\b/.test(
      normalizedQuery,
    ) && /\b(?:ed|emergency department|community)\b/.test(normalizedQuery);
  const needsComparison = queryClass === "comparison";

  const preferredDocumentSignals: string[] = [];
  const requiredTermSignals: string[] = [];

  if (asksPatientEducation) {
    preferredDocumentSignals.push("active community", "active community pt ed", "emergency department");
    requiredTermSignals.push("active_community", "ed");
  }
  if (/\b(?:agitation|arousal)\b/.test(normalizedQuery)) {
    preferredDocumentSignals.push("agitation arousal pharmacological management");
    requiredTermSignals.push("agitation");
  }
  if (/\badmission\b/.test(normalizedQuery) && /\bcommunity\b/.test(normalizedQuery)) {
    preferredDocumentSignals.push("admission of community patients", "admission community pts", "community admission");
  }
  if (/\bdischarge\b/.test(normalizedQuery)) {
    preferredDocumentSignals.push("discharge", "discharge documentation");
  }
  if (asksDoseRoute) {
    if (asksDoseAmount) requiredTermSignals.push("dose_amount");
    if (medicationEvidenceIntent.asksRoute) requiredTermSignals.push("route");
  }
  if (
    (queryClass === "medication_dose_risk" || queryClass === "table_threshold") &&
    (asksDoseRoute || asksMedicationMonitoring) &&
    clinicalSubjectTokens.length > 0
  ) {
    requiredTermSignals.push("clinical_subject");
  }
  if (asksFlowchart) {
    preferredDocumentSignals.push("flowchart", "pathway", "risk matrix");
    requiredTermSignals.push("flowchart_or_pathway");
    if (/\b(?:next step|step after|red zone|action)\b/.test(normalizedQuery)) {
      requiredTermSignals.push("next_step_or_action");
    }
    if (asksRiskFlowchart) {
      requiredTermSignals.push("risk", "red_zone");
    }
  }
  if (asksSourceImage) {
    preferredDocumentSignals.push("source image", "clinical table", "table crop", "visual evidence");
    requiredTermSignals.push("source_image");
  }
  if (asksExactVisualTable) {
    requiredTermSignals.push("visual_table", "table");
  }
  if (/\bclozapine\b/.test(normalizedQuery)) {
    preferredDocumentSignals.push("clozapine prescribing administration monitoring");
    requiredTermSignals.push("clozapine");
  }
  if (/\b(?:anc|neutrophil)\b/.test(normalizedQuery)) requiredTermSignals.push("anc");
  if (/\b(?:fbc|full blood count)\b/.test(normalizedQuery)) requiredTermSignals.push("fbc");
  if (asksMedicationChart)
    preferredDocumentSignals.push("medication chart", "dose table", "pharmacological management");
  if (asksTable) preferredDocumentSignals.push("table", "chart", "matrix");

  return {
    needsTable: asksTable || queryClass === "table_threshold",
    needsMedicationChart: asksMedicationChart,
    needsFlowchartStep: asksFlowchart,
    needsPatientEducation: asksPatientEducation,
    needsSourceImage: asksSourceImage,
    needsRiskFlowchart: asksRiskFlowchart,
    needsExactVisualTable: asksExactVisualTable,
    needsDoseRouteFrequency: asksDoseRoute,
    needsComparison,
    preferredDocumentSignals: unique(preferredDocumentSignals, 16),
    requiredTermSignals: unique(requiredTermSignals, 16),
  };
}

export function buildRetrievalCandidates(
  query: string,
  results: SearchResult[],
  queryClass: RagQueryClass,
): RetrievalCandidate[] {
  const intent = buildRetrievalIntent(query, queryClass);
  return results.map((result) => {
    const chunkType = chunkTypeForResult(result);
    const initial: RetrievalCandidate = {
      chunkId: result.id,
      documentId: result.document_id,
      title: result.title,
      section: result.section_heading ?? undefined,
      page: result.page_number,
      chunkType,
      score: baseScore(result),
      lexicalScore: 0,
      semanticScore: result.similarity,
      // Selection intentionally consumes the clamped confidence signal. The incoming clinical
      // rank already used rankScore; reusing the unbounded value here would compound boosts across
      // passes and reintroduce the measured recall regression guarded below.
      rerankScore: result.score_explanation?.finalScore ?? result.hybrid_score,
      // Carried ONLY as the last tie-break before chunk id: on the embedding-free fast path,
      // imputed primaries make clamped score/lexical/rerank ties routine, and a chunk-id tie-break
      // is arbitrary — the second stage's position-based adjustment then launders that arbitrary
      // winner into the released order. The key is the clinical rank's QUERY-TERM COVERAGE, not
      // the boost-laden rankScore: the 2026-07-20 live golden run (eval-canary #50) showed that
      // breaking saturated ties by rankScore lets generic clinicalSignalBoost stacking outvote the
      // chunk that actually contains the queried terms (alcohol-ciwa-threshold regressed to FAIL),
      // which is the same failure mode the clamped-score contract below exists to prevent.
      // Never added to score.
      contentCoverageScore: result.score_explanation?.lexicalCoverageScore,
      matchedSignals: [],
      sourceHref: documentCitationHref(citationFromResult(result)),
    };
    const matchedSignals = matchedSignalsForResult({ query, intent, result, chunkType });
    const lexicalScore = lexicalScoreForSignals(intent.requiredTermSignals, matchedSignals);
    const candidate = { ...initial, lexicalScore, matchedSignals };
    // The relevance score stays CLAMPED: live hybrid scores routinely saturate at 1.0, and letting
    // boosts raise the primary score uncapped made boost stacking override lexical relevance
    // entirely (golden doc-recall@5 regressed 1.0 -> 0.76). Within the saturated region, ordering
    // falls through to lexicalScore then rerankScore (the clinical relevance rank), which is the
    // behaviour the golden retrieval eval validates.
    return {
      ...candidate,
      score: clamp(candidate.score + resultBoost({ intent, candidate, result })),
    };
  });
}

function annotateResultWithSelection(
  result: SearchResult,
  candidate: RetrievalCandidate,
  originalScore: number,
  intent: RetrievalIntent,
): SearchResult {
  const score = Number(Math.max(originalScore, candidate.score).toFixed(4));
  const selectionReasons = candidate.matchedSignals.map((signal) => `retrieval_signal:${signal}`);
  if (intent.requiredTermSignals.includes("clinical_subject")) {
    selectionReasons.push("retrieval_required_signal:clinical_subject");
  }
  if (candidate.score > originalScore + 0.04) selectionReasons.push("retrieval_intent_rescue");

  return {
    ...result,
    hybrid_score: score,
    match_explanation: {
      ...result.match_explanation,
      indexUnitType: result.match_explanation?.indexUnitType ?? result.index_unit?.unit_type ?? undefined,
      reasons: unique([...(result.match_explanation?.reasons ?? []), ...selectionReasons], 48),
    },
  };
}

function summarizeSelection(args: {
  intent: RetrievalIntent;
  selectedCandidates: RetrievalCandidate[];
  candidateCount: number;
  rescueApplied: boolean;
}): RetrievalSelectionSummary {
  const matchedSignals = unique(
    args.selectedCandidates.flatMap((candidate) => candidate.matchedSignals),
    48,
  );
  const missingRequiredSignals = args.intent.requiredTermSignals.filter((signal) => !matchedSignals.includes(signal));
  const topChunkTypes = emptyChunkTypeCounts();
  for (const candidate of args.selectedCandidates) {
    topChunkTypes[candidate.chunkType] += 1;
  }

  return {
    candidateCount: args.candidateCount,
    selectedCount: args.selectedCandidates.length,
    requiredSignalsSatisfied: missingRequiredSignals.length === 0,
    matchedSignals,
    missingRequiredSignals,
    rescueApplied: args.rescueApplied,
    topChunkTypes,
  };
}

export function summarizeRetrievalSelection(args: {
  query: string;
  queryClass: RagQueryClass;
  results: SearchResult[];
}): { intent: RetrievalIntent; summary: RetrievalSelectionSummary; candidates: RetrievalCandidate[] } {
  const intent = buildRetrievalIntent(args.query, args.queryClass);
  const candidates = buildRetrievalCandidates(args.query, args.results, args.queryClass);
  const rescueApplied = candidates.some(
    (candidate) => candidate.score > (candidate.rerankScore ?? candidate.semanticScore ?? 0) + 0.04,
  );
  return {
    intent,
    candidates,
    summary: summarizeSelection({
      intent,
      selectedCandidates: candidates,
      candidateCount: candidates.length,
      rescueApplied,
    }),
  };
}

export function selectRetrievalEvidence(args: {
  query: string;
  queryClass: RagQueryClass;
  results: SearchResult[];
  topK: number;
  maxResultsPerDocument: number;
  /** Request-local, fully validated candidate IDs that must survive retrieval caps atomically. */
  prevalidatedAtomicGroups?: readonly (readonly string[])[];
}): {
  results: SearchResult[];
  intent: RetrievalIntent;
  summary: RetrievalSelectionSummary;
  candidates: RetrievalCandidate[];
} {
  const intent = buildRetrievalIntent(args.query, args.queryClass);
  const candidates = buildRetrievalCandidates(args.query, args.results, args.queryClass);
  const byId = new Map(args.results.map((result) => [result.id, result]));
  const originalScoreById = new Map(args.results.map((result) => [result.id, baseScore(result)]));
  const sortedCandidates = [...candidates].sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    if ((right.lexicalScore ?? 0) !== (left.lexicalScore ?? 0))
      return (right.lexicalScore ?? 0) - (left.lexicalScore ?? 0);
    if ((right.rerankScore ?? 0) !== (left.rerankScore ?? 0)) return (right.rerankScore ?? 0) - (left.rerankScore ?? 0);
    // Exact tie on every clamped key (routine on the embedding-free fast path, where imputed
    // primaries are byte-identical and confidences saturate at 1.0): prefer the candidate whose
    // content actually covers the query's terms over an arbitrary chunk-id ordering. This never
    // raises any score — it only orders otherwise-indistinguishable candidates, so the measured
    // clamped-score contract holds, and generic boost stacking cannot outvote query relevance.
    if ((right.contentCoverageScore ?? 0) !== (left.contentCoverageScore ?? 0))
      return (right.contentCoverageScore ?? 0) - (left.contentCoverageScore ?? 0);
    return left.chunkId.localeCompare(right.chunkId);
  });
  const candidateById = new Map(candidates.map((candidate) => [candidate.chunkId, candidate]));
  const atomicGroupByCandidateId = new Map<string, RetrievalCandidate[]>();
  for (const rawGroup of args.prevalidatedAtomicGroups ?? []) {
    const groupIds = [...new Set(rawGroup)];
    if (groupIds.length < 2 || groupIds.some((id) => !candidateById.has(id) || atomicGroupByCandidateId.has(id)))
      continue;
    const group = groupIds.map((id) => candidateById.get(id)!);
    group.forEach((candidate) => atomicGroupByCandidateId.set(candidate.chunkId, group));
  }

  type SelectionUnit = { candidates: RetrievalCandidate[]; atomic: boolean };
  let selectionUnits: SelectionUnit[] = [];
  const selectedCandidates = () => selectionUnits.flatMap((unit) => unit.candidates);
  const selectedIds = () => new Set(selectedCandidates().map((candidate) => candidate.chunkId));
  const documentCount = (documentId: string) =>
    selectedCandidates().filter((candidate) => candidate.documentId === documentId).length;
  const removeLastSingleton = (documentId?: string) => {
    const index = selectionUnits.findLastIndex(
      (unit) => !unit.atomic && (!documentId || unit.candidates[0]?.documentId === documentId),
    );
    if (index < 0) return false;
    selectionUnits = selectionUnits.filter((_, unitIndex) => unitIndex !== index);
    return true;
  };
  const addAtomicGroup = (group: RetrievalCandidate[]) => {
    const snapshot = selectionUnits.map((unit) => ({ ...unit, candidates: [...unit.candidates] }));
    const missing = group.filter((candidate) => !selectedIds().has(candidate.chunkId));
    const requiredByDocument = new Map<string, number>();
    for (const candidate of missing) {
      requiredByDocument.set(candidate.documentId, (requiredByDocument.get(candidate.documentId) ?? 0) + 1);
    }
    for (const [documentId, required] of requiredByDocument) {
      if (required > args.maxResultsPerDocument) return false;
      while (documentCount(documentId) + required > args.maxResultsPerDocument) {
        if (!removeLastSingleton(documentId)) {
          selectionUnits = snapshot;
          return false;
        }
      }
    }
    while (selectedCandidates().length + missing.length > args.topK) {
      if (!removeLastSingleton()) {
        selectionUnits = snapshot;
        return false;
      }
    }
    if (missing.length) selectionUnits.push({ candidates: missing, atomic: true });
    return true;
  };

  for (const candidate of sortedCandidates) {
    if (selectedIds().has(candidate.chunkId)) continue;
    const atomicGroup = atomicGroupByCandidateId.get(candidate.chunkId);
    if (atomicGroup) {
      addAtomicGroup(atomicGroup);
      continue;
    }
    if (selectedCandidates().length >= args.topK || documentCount(candidate.documentId) >= args.maxResultsPerDocument)
      continue;
    selectionUnits.push({ candidates: [candidate], atomic: false });
  }

  const retainedCandidates = selectedCandidates();

  const selectedResults = retainedCandidates
    .map((candidate) => {
      const result = byId.get(candidate.chunkId);
      if (!result) return null;
      return annotateResultWithSelection(result, candidate, originalScoreById.get(candidate.chunkId) ?? 0, intent);
    })
    .filter((result): result is SearchResult => Boolean(result));
  const rescueApplied = retainedCandidates.some(
    (candidate) => candidate.score > (originalScoreById.get(candidate.chunkId) ?? 0) + 0.04,
  );

  return {
    results: selectedResults,
    intent,
    candidates,
    summary: summarizeSelection({
      intent,
      selectedCandidates: retainedCandidates,
      candidateCount: candidates.length,
      rescueApplied,
    }),
  };
}
