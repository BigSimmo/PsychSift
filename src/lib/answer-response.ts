import { toClientAnswerPayload } from "@/lib/answer-client-payload";
import { extractSafetyFindings } from "@/lib/clinical-safety";
import {
  hasDangerSourceGovernanceWarning,
  sourceGovernanceRefusalAnswer,
  sourceGovernanceWarnings,
} from "@/lib/source-governance";
import { withFinalRagProgrammeOutcome } from "@/lib/rag/rag-programme-telemetry";
import type { RagAnswer, SafetyWarning } from "@/lib/types";

function clientSafetyWarning(warning: SafetyWarning): SafetyWarning {
  const citation = warning.citation;
  return {
    ...warning,
    citation: {
      chunk_id: citation.chunk_id,
      document_id: citation.document_id,
      title: citation.title,
      file_name: citation.file_name,
      page_number: citation.page_number,
      chunk_index: citation.chunk_index,
      ...(citation.similarity === undefined ? {} : { similarity: citation.similarity }),
      ...(citation.provenance === undefined ? {} : { provenance: citation.provenance }),
      // Issue 9: keep governance provenance on safety-finding citations. Regular
      // source citations already retain it (answer-client-payload `source_metadata:
      // "client"`); dropping it here left the safety panel unable to badge outdated /
      // review-due / unverified provenance for its citations.
      ...(citation.source_metadata === undefined ? {} : { source_metadata: citation.source_metadata }),
    },
  };
}

export function answerDegradedModeSignal(
  answer?: Pick<RagAnswer, "degradedMode" | "answerQualityTier" | "fallbackReason">,
) {
  if (answer?.degradedMode) return answer.degradedMode;
  const active = answer?.answerQualityTier === "source_only";
  return {
    active,
    reason: active ? (answer?.fallbackReason ?? "source_only") : null,
  };
}

/** Apply the shared browser-boundary source-governance contract. */
export function buildGovernedAnswerClientResponse(answer: RagAnswer) {
  const safetyWarnings = extractSafetyFindings(answer).map(clientSafetyWarning);
  const warnings = sourceGovernanceWarnings({
    results: answer.sources ?? [],
    relevance: answer.relevance ?? answer.smartPanel?.relevance ?? null,
  });
  const shouldRefuse =
    answer.grounded !== false &&
    answer.confidence !== "unsupported" &&
    answer.responseMode !== "evidence_gap" &&
    hasDangerSourceGovernanceWarning(warnings);

  if (shouldRefuse) {
    const routingReason = [answer.routingReason, "source_governance_refusal"].filter(Boolean).join("; ");
    const telemetryAnswer = withFinalRagProgrammeOutcome({
      ...answer,
      answer: sourceGovernanceRefusalAnswer,
      grounded: false,
      confidence: "unsupported",
      citations: [],
      sources: [],
      responseMode: "evidence_gap",
      fallbackReason: "source_governance_refusal",
      routingReason,
    } satisfies RagAnswer);

    return {
      refused: true as const,
      warnings,
      telemetryAnswer,
      payload: {
        answer: sourceGovernanceRefusalAnswer,
        grounded: false as const,
        confidence: "unsupported" as const,
        citations: [],
        sources: [],
        degradedMode: answerDegradedModeSignal(answer),
        sourceGovernanceWarnings: warnings,
        safetyWarnings: [],
      },
    };
  }

  return {
    refused: false as const,
    warnings,
    telemetryAnswer: answer,
    payload: {
      ...toClientAnswerPayload(answer),
      degradedMode: answerDegradedModeSignal(answer),
      sourceGovernanceWarnings: warnings,
      safetyWarnings,
    },
  };
}

export function governedAnswerForTelemetry(answer: RagAnswer) {
  return buildGovernedAnswerClientResponse(answer).telemetryAnswer;
}

/** Apply the governed browser contract while preserving explicit demo/degraded state. */
export function buildGovernedDemoAnswerClientResponse(answer: RagAnswer, fallbackReason?: string) {
  const governedResponse = buildGovernedAnswerClientResponse(answer);
  return {
    ...governedResponse.payload,
    demoMode: true as const,
    degradedMode: fallbackReason ? { active: true, reason: fallbackReason } : answerDegradedModeSignal(answer),
    ...(fallbackReason ? { fallbackMode: "non_production_demo" as const, fallbackReason } : {}),
  };
}
