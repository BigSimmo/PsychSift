import { isBoundMonitoringFrequencyQuestion, requestedMonitoringCadence } from "@/lib/evidence-relevance";
import type { RagQueryClass, SearchResult } from "@/lib/types";
import {
  classifyRagQuery,
  correctedTokens,
  hasDoseEvidenceSupport,
  hasStructuredThresholdEvidence,
  medicationDoseEvidenceQueryIntent,
  medicationDoseQueryContext,
} from "@/lib/clinical-search";
import type { SearchTelemetry } from "@/lib/rag/rag-contracts";
import {
  directTitleOrAliasSupport,
  hasAdmissionCommunityLookupIntent,
  hasAdmissionCommunityTitleSupport,
  hasAnyTerm,
  hasDirectSourceImageEvidence,
  hasDoseAmountEvidenceForGate,
  hasFrequencyEvidenceForGate,
  hasRiskFlowchartActionEvidence,
  hasRouteEvidenceForGate,
  isRiskFlowchartNextStepQuery,
  sourceImageRequiredForQuery,
  topEvidenceText,
  visualEvidenceUnitTypes,
} from "@/lib/rag/rag-evidence-gates";

// Extracted from rag.ts (maturity X3): the evidence coverage gate that decides
// whether retrieved candidates are sufficient to release a fast-path answer,
// plus the telemetry it owns. Behaviour-preserving — the function bodies are
// byte-identical to their previous rag.ts definitions.

/** Evaluate evidence coverage gate. */
export function evaluateEvidenceCoverageGate(
  query: string,
  results: SearchResult[],
  queryClass: RagQueryClass = classifyRagQuery(query).queryClass,
): {
  accepted: boolean;
  reason: string;
  strategy: "text_fast_path" | "document_lookup_fast_path";
  sourceImageRequired: boolean;
  sourceImageSatisfied: boolean;
} {
  if (!results.length) {
    return {
      accepted: false,
      reason: "no_candidates",
      strategy: "text_fast_path",
      sourceImageRequired: false,
      sourceImageSatisfied: false,
    };
  }

  const top = results.slice(0, 5);
  const evidenceText = topEvidenceText(results);
  const strongestScore = Math.max(0, ...top.map((result) => result.hybrid_score ?? result.similarity ?? 0));
  const sourceImageRequired = sourceImageRequiredForQuery(query);
  const sourceImageSatisfied = top.some(hasDirectSourceImageEvidence);
  if (sourceImageRequired && !sourceImageSatisfied) {
    return {
      accepted: false,
      reason: "source_image_required_missing",
      strategy: "text_fast_path",
      sourceImageRequired,
      sourceImageSatisfied,
    };
  }

  const hasStructuredThreshold = top.some(hasStructuredThresholdEvidence);
  const hasDoseAmount = top.some(hasDoseAmountEvidenceForGate);
  const hasVisualUnit = top.some((result) => visualEvidenceUnitTypes.has(result.index_unit?.unit_type ?? ""));
  const hasDirectTitle = directTitleOrAliasSupport(query, top);

  if (queryClass === "table_threshold") {
    const normalizedQuery = `${query} ${correctedTokens(query).join(" ")}`;
    if (
      /\bclozapine\b/i.test(normalizedQuery) &&
      /\b(?:anc|fbc|wbc|wcc|neutrophil|neutrophils|full blood|white cell)\b/i.test(normalizedQuery) &&
      /\b(?:withhold|withheld|withholding|cease|ceased|ceasing|stop|stopped|stopping|discontinue|discontinued|discontinuing|discontinuation)\b/i.test(
        normalizedQuery,
      )
    ) {
      const hasBlood = hasAnyTerm(
        evidenceText,
        /\b(?:anc|fbc|wbc|wcc|neutrophil|neutrophils|full blood|white cell)\b/i,
      );
      const hasAction = hasAnyTerm(
        evidenceText,
        /\b(?:withhold|withheld|withholding|cease|ceased|ceasing|stop|stopped|stopping|discontinue|discontinued|discontinuing|discontinuation|red)\b/i,
      );
      return {
        accepted: hasStructuredThreshold && hasBlood && hasAction,
        reason:
          hasStructuredThreshold && hasBlood && hasAction
            ? "clozapine_blood_action_structured_threshold"
            : "missing_clozapine_blood_action_structured_threshold",
        strategy: "text_fast_path",
        sourceImageRequired,
        sourceImageSatisfied,
      };
    }
    if (/\bpatient property\b/i.test(query)) {
      const hasPropertyTerms =
        hasAnyTerm(evidenceText, /\bpatient\b/i) &&
        hasAnyTerm(evidenceText, /\bproperty\b/i) &&
        hasAnyTerm(evidenceText, /\b(?:restricted|prohibited|contraband|items?)\b/i);
      return {
        accepted:
          hasPropertyTerms &&
          (hasStructuredThreshold || sourceImageSatisfied || hasVisualUnit || strongestScore >= 0.62),
        reason: hasPropertyTerms ? "patient_property_restricted_items_gate" : "missing_patient_property_terms",
        strategy: "text_fast_path",
        sourceImageRequired,
        sourceImageSatisfied,
      };
    }
    return {
      accepted: hasStructuredThreshold && strongestScore >= 0.58,
      reason: hasStructuredThreshold ? "structured_threshold_evidence_gate" : "missing_structured_threshold_evidence",
      strategy: "text_fast_path",
      sourceImageRequired,
      sourceImageSatisfied,
    };
  }

  if (queryClass === "medication_dose_risk" && isBoundMonitoringFrequencyQuestion(query)) {
    const accepted = top.some((result) => requestedMonitoringCadence(query, result.content));
    return {
      accepted,
      reason: accepted ? "bound_monitoring_frequency_evidence" : "missing_bound_monitoring_frequency_evidence",
      strategy: "text_fast_path",
      sourceImageRequired,
      sourceImageSatisfied,
    };
  }

  if (queryClass === "medication_dose_risk") {
    const { asksAmount, asksRoute, asksFrequency } = medicationDoseEvidenceQueryIntent(query);
    const agitationOk = !/\bagitation|arousal\b/i.test(query) || /\bagitation|arousal\b/i.test(evidenceText);
    const hasContextualDoseEvidence = top.some(
      (result) => hasDoseEvidenceSupport(result) && medicationDoseQueryContext(query, result).matched,
    );
    const hasContextualDoseAmount = top.some(
      (result) =>
        hasDoseEvidenceSupport(result) &&
        hasDoseAmountEvidenceForGate(result) &&
        medicationDoseQueryContext(query, result).matched,
    );
    const hasContextualRoute = top.some(
      (result) =>
        hasDoseEvidenceSupport(result) &&
        hasRouteEvidenceForGate(result) &&
        medicationDoseQueryContext(query, result).matched,
    );
    const hasContextualFrequency = top.some(
      (result) =>
        hasDoseEvidenceSupport(result) &&
        hasFrequencyEvidenceForGate(result) &&
        medicationDoseQueryContext(query, result).matched,
    );
    const hasCoLocatedRequestedEvidence = top.some(
      (result) =>
        hasDoseEvidenceSupport(result) &&
        medicationDoseQueryContext(query, result).matched &&
        (!asksAmount || hasDoseAmountEvidenceForGate(result)) &&
        (!asksRoute || hasRouteEvidenceForGate(result)) &&
        (!asksFrequency || hasFrequencyEvidenceForGate(result)),
    );
    const requestedAttributeCount = Number(asksAmount) + Number(asksRoute) + Number(asksFrequency);
    const accepted = hasCoLocatedRequestedEvidence && agitationOk;
    return {
      accepted,
      reason: accepted
        ? "dose_route_amount_evidence_gate"
        : asksAmount && !hasDoseAmount
          ? "missing_dose_amount_evidence"
          : !hasContextualDoseEvidence || (asksAmount && !hasContextualDoseAmount)
            ? "missing_dose_query_context"
            : !hasContextualRoute && asksRoute
              ? "missing_route_evidence"
              : !hasContextualFrequency && asksFrequency
                ? "missing_frequency_evidence"
                : requestedAttributeCount > 1 && !hasCoLocatedRequestedEvidence
                  ? "missing_co_located_medication_evidence"
                  : !agitationOk
                    ? "missing_agitation_context"
                    : "missing_dose_evidence",
      strategy: "text_fast_path",
      sourceImageRequired,
      sourceImageSatisfied,
    };
  }

  if (queryClass === "document_lookup") {
    if (hasAdmissionCommunityLookupIntent(query) && !hasAdmissionCommunityTitleSupport(top)) {
      return {
        accepted: false,
        reason: "missing_admission_community_title_support",
        strategy: "document_lookup_fast_path",
        sourceImageRequired,
        sourceImageSatisfied,
      };
    }
    if (/\bactive community patients?\b/i.test(query) && /\bed\b/i.test(query)) {
      const accepted =
        hasDirectTitle &&
        hasAnyTerm(evidenceText, /\bactive\b/i) &&
        hasAnyTerm(evidenceText, /\bcommunity\b/i) &&
        hasAnyTerm(evidenceText, /\b(?:ed|emergency department)\b/i);
      return {
        accepted,
        reason: accepted ? "active_community_ed_title_gate" : "missing_active_community_ed_title_support",
        strategy: "document_lookup_fast_path",
        sourceImageRequired,
        sourceImageSatisfied,
      };
    }
    // Only zone/next-step flowchart questions need the zone-action evidence
    // gate; a plain flowchart document lookup ("which procedure flowchart
    // covers X?") falls through to the ordinary title gate below so a direct
    // title hit is not rejected for lacking zone evidence.
    if (isRiskFlowchartNextStepQuery(query)) {
      const accepted = hasRiskFlowchartActionEvidence(query, results);
      return {
        accepted,
        reason: accepted ? "visual_flowchart_risk_gate" : "missing_visual_flowchart_risk_evidence",
        strategy: "document_lookup_fast_path",
        sourceImageRequired,
        sourceImageSatisfied,
      };
    }
    return {
      accepted: hasDirectTitle && strongestScore >= 0.48,
      reason: hasDirectTitle ? "document_title_evidence_gate" : "missing_document_title_support",
      strategy: "document_lookup_fast_path",
      sourceImageRequired,
      sourceImageSatisfied,
    };
  }

  if (queryClass === "comparison") {
    const distinctDocuments = new Set(top.map((result) => result.document_id)).size;
    return {
      accepted: distinctDocuments >= 2 && strongestScore >= 0.6,
      reason: distinctDocuments >= 2 ? "comparison_multi_document_gate" : "missing_comparison_document_diversity",
      strategy: "text_fast_path",
      sourceImageRequired,
      sourceImageSatisfied,
    };
  }

  return {
    accepted: false,
    reason: "coverage_gate_not_applicable",
    strategy: "text_fast_path",
    sourceImageRequired,
    sourceImageSatisfied,
  };
}

/** Apply coverage gate telemetry. */
export function applyCoverageGateTelemetry(
  telemetry: SearchTelemetry,
  gate: ReturnType<typeof evaluateEvidenceCoverageGate>,
  accepted: boolean,
) {
  telemetry.coverage_gate_decision = accepted ? "accepted" : "rejected";
  telemetry.coverage_gate_reason = gate.reason;
  telemetry.source_image_required = gate.sourceImageRequired;
  telemetry.source_image_satisfied = gate.sourceImageSatisfied;
  if (accepted) {
    telemetry.vector_skipped_reason = `evidence_coverage_gate:${gate.reason}`;
    telemetry.embedding_skipped = true;
    telemetry.embedding_skip_reason = `evidence_coverage_gate:${gate.reason}`;
  }
}
