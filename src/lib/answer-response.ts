import { projectClientSafetyWarning, toClientAnswerPayload } from "@/lib/answer-client-payload";
import { extractSafetyFindings } from "@/lib/clinical-safety";
import {
  hasDangerSourceGovernanceWarning,
  sourceGovernanceRefusalAnswer,
  sourceGovernanceWarnings,
} from "@/lib/source-governance";
import type { RagAnswer } from "@/lib/types";
import { carryRagProgrammeTelemetry } from "@/lib/rag/rag-programme-telemetry";
import {
  classifyRagFallbackReason,
  isStrongerGovernanceFallbackReasonCode,
  normalizeRagFallbackReasonCode,
  publicFallbackReason,
} from "@/lib/rag/rag-fallback-reason";

function answerFallbackReasonCode(
  answer?: Pick<
    RagAnswer,
    "fallbackReasonCode" | "fallbackReason" | "routingReason" | "degradedMode" | "answerQualityTier"
  >,
) {
  if (!answer) return null;
  if (answer.fallbackReasonCode != null) return normalizeRagFallbackReasonCode(answer.fallbackReasonCode) ?? "unknown";
  const active = answer.degradedMode?.active === true || answer.answerQualityTier === "source_only";
  if (!active && !answer.fallbackReason && !answer.routingReason) return null;
  const code = classifyRagFallbackReason({
    routingReason: [answer.fallbackReason, answer.degradedMode?.reason, answer.routingReason]
      .filter(Boolean)
      .join("; "),
  });
  return code === "unknown" && !active && !answer.fallbackReason ? null : code;
}

export function answerDegradedModeSignal(
  answer?: Pick<
    RagAnswer,
    "fallbackReasonCode" | "degradedMode" | "answerQualityTier" | "fallbackReason" | "routingReason"
  >,
) {
  const fallbackReasonCode = answerFallbackReasonCode(answer);
  const active =
    answer?.degradedMode?.active === true ||
    answer?.answerQualityTier === "source_only" ||
    answer?.fallbackReasonCode != null;
  return {
    active,
    reason: active ? publicFallbackReason(fallbackReasonCode ?? "unknown") : null,
  };
}

/** Apply the shared browser-boundary source-governance contract. */
export function buildGovernedAnswerClientResponse(answer: RagAnswer) {
  const safetyWarnings = extractSafetyFindings(answer)
    .map(projectClientSafetyWarning)
    .filter((warning): warning is NonNullable<typeof warning> => Boolean(warning));
  const warnings = sourceGovernanceWarnings({
    results: answer.sources ?? [],
    relevance: answer.relevance ?? answer.smartPanel?.relevance ?? null,
  });
  // Audit RAG-B-01: the self-reported `grounded` flag does not exempt an answer from the danger
  // refusal. An ungrounded answer that still carries a confidence above "unsupported" is
  // presenting content with a support level, so it is refused like any other. Answers already
  // marked unsupported or evidence-gap pass through unchanged, as before.
  const shouldRefuse =
    answer.confidence !== "unsupported" &&
    answer.responseMode !== "evidence_gap" &&
    hasDangerSourceGovernanceWarning(warnings);

  if (shouldRefuse) {
    const routingReason = [answer.routingReason, "source_governance_refusal"].filter(Boolean).join("; ");
    const telemetryAnswer = carryRagProgrammeTelemetry(answer, {
      ...answer,
      answer: sourceGovernanceRefusalAnswer,
      grounded: false,
      confidence: "unsupported",
      citations: [],
      sources: [],
      responseMode: "evidence_gap",
      fallbackReasonCode: "source_governance_block",
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
        fallbackReasonCode: "source_governance_block" as const,
        degradedMode: answerDegradedModeSignal({
          fallbackReasonCode: "source_governance_block",
          answerQualityTier: "source_only",
        }),
        retrievalGateBlocked:
          answer.retrievalGateBlocked === true || answer.retrievalDiagnostics?.gateStatus === "blocked",
        authorityTrustCapRequired: true,
        sourceGovernanceWarnings: warnings,
        safetyWarnings: [],
      },
    };
  }

  const fallbackReasonCode = answerFallbackReasonCode(answer);
  return {
    refused: false as const,
    warnings,
    telemetryAnswer: answer,
    payload: {
      ...toClientAnswerPayload({ ...answer, fallbackReasonCode }),
      fallbackReasonCode,
      degradedMode: answerDegradedModeSignal({ ...answer, fallbackReasonCode }),
      sourceGovernanceWarnings: warnings,
      safetyWarnings,
    },
  };
}

/** Apply the governed browser contract while preserving explicit demo/degraded state. */
export function buildGovernedDemoAnswerClientResponse(answer: RagAnswer, fallbackReason?: string) {
  const demoFallbackCode = fallbackReason
    ? classifyRagFallbackReason({ routingReason: fallbackReason })
    : answerFallbackReasonCode(answer);
  const governedResponse = buildGovernedAnswerClientResponse(answer);
  const governedCode = answerFallbackReasonCode(answer);
  const preserveGovernanceCode = governedResponse.refused || isStrongerGovernanceFallbackReasonCode(governedCode);
  const fallbackReasonCode = preserveGovernanceCode ? governedResponse.payload.fallbackReasonCode : demoFallbackCode;
  return {
    ...governedResponse.payload,
    demoMode: true as const,
    ...(fallbackReason
      ? {
          fallbackReasonCode,
          degradedMode: {
            active: true,
            reason: publicFallbackReason(fallbackReasonCode ?? "unknown"),
          },
        }
      : {}),
    ...(fallbackReason ? { fallbackMode: "non_production_demo" as const } : {}),
  };
}

/** Shared direct empty-scope owner used by both JSON and SSE answer routes. */
export function buildGovernedEmptyScopeAnswerClientResponse(answer: string) {
  return buildGovernedAnswerClientResponse({
    answer,
    grounded: false,
    confidence: "unsupported",
    citations: [],
    sources: [],
    routingMode: "unsupported",
    routingReason: "retrieval_miss; no_candidates",
    fallbackReasonCode: "no_candidates",
    fallbackReason: "retrieval_miss",
    answerQualityTier: "source_only",
    responseMode: "evidence_gap",
  });
}
