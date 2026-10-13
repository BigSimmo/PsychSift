import type { RagAnswer, SearchResult, SupportedClaim } from "../src/lib/types";
import type { ClientRagAnswerPayload } from "../src/lib/answer-client-payload";
import { type AnswerSupportStrength } from "../src/components/ui/answer-card";
import { type AnswerRenderTrust } from "../src/lib/answer-render-policy";
import { type PersistedAnswerThread, type StoredAnswerTurn } from "../src/lib/answer-thread-storage";

export const SUPPORT_SCORE_THRESHOLDS = {
  HIGH: 0.82,
  MEDIUM: 0.64,
} as const;

export const ANSWER_SUPPORT_WORDING: Record<AnswerSupportStrength, string> = {
  strong: "Strong support",
  supported: "Supported",
  limited: "Limited support",
  unassessed: "Review support",
};

/**
 * Checks whether chunk has reviewed authority (approved or locally reviewed).
 */
export function chunkHasReviewedAuthority(chunkId: string, answer: Partial<RagAnswer>): boolean {
  const authority = answer.evidenceAssessments?.[chunkId]?.authority;
  if (authority === "approved" || authority === "locally_reviewed") return true;

  const source = answer.sources?.find((candidate) => candidate.id === chunkId);
  const status = source?.source_metadata?.clinical_validation_status;
  return status === "approved" || status === "locally_reviewed";
}

/**
 * Validates whether every claim in the answer is directly supported by reviewed evidence.
 */
export function claimsHaveReviewedDirectSupport(claims: SupportedClaim[], answer: Partial<RagAnswer>): boolean {
  if (claims.length === 0) return false;
  return claims.every(
    (claim) =>
      claim.supportStatus === "direct" &&
      claim.supportingChunkIds &&
      claim.supportingChunkIds.length > 0 &&
      claim.supportingChunkIds.every((chunkId) => chunkHasReviewedAuthority(chunkId, answer)),
  );
}

/**
 * Determines whether the "Strong support" label must be capped to "Supported".
 */
export function isStrongSupportCapped(answer: Partial<RagAnswer | ClientRagAnswerPayload>): boolean {
  if (answer.strongSupportLabelCapped !== undefined) {
    return answer.strongSupportLabelCapped;
  }

  const claims = (answer as RagAnswer).supportedClaims;
  if (claims) {
    return !claimsHaveReviewedDirectSupport(claims, answer as RagAnswer);
  }

  // Stored client payload without claim details: conservative fallback caps to Supported
  return true;
}

/**
 * Derives the underlying answer trust level.
 */
export function deriveAnswerTrust(answer: Partial<RagAnswer | ClientRagAnswerPayload>): AnswerRenderTrust {
  if (answer.routingMode === "unsupported" || answer.confidence === "unsupported" || answer.grounded === false) {
    return "unsupported";
  }

  if (answer.retrievalGateBlocked === true || answer.confidence === "low") {
    return "low";
  }

  if (answer.authorityTrustCapRequired === true) {
    return "medium";
  }

  if (answer.confidence === "high") {
    return "high";
  }

  return "medium";
}

export type RecalculatedSupportResult<T extends Partial<RagAnswer | ClientRagAnswerPayload>> = {
  answer: T & { strongSupportLabelCapped: boolean };
  trust: AnswerRenderTrust;
  supportLabelTrust: AnswerRenderTrust;
  supportStrength: AnswerSupportStrength;
  supportLabel: string;
  strongSupportLabelCapped: boolean;
};

/**
 * Recalculates the support label and capping for an individual answer payload.
 */
export function recalculateAnswerSupportLabel<T extends Partial<RagAnswer | ClientRagAnswerPayload>>(
  answer: T,
): RecalculatedSupportResult<T> {
  const capped = isStrongSupportCapped(answer);
  const trust = deriveAnswerTrust(answer);
  const supportLabelTrust: AnswerRenderTrust = trust === "high" && capped ? "medium" : trust;

  const supportStrength: AnswerSupportStrength =
    supportLabelTrust === "high"
      ? "strong"
      : supportLabelTrust === "medium"
        ? "supported"
        : supportLabelTrust === "low"
          ? "limited"
          : "unassessed";

  const supportLabel = ANSWER_SUPPORT_WORDING[supportStrength];

  const updatedAnswer: T & { strongSupportLabelCapped: boolean } = {
    ...answer,
    strongSupportLabelCapped: capped,
  };

  return {
    answer: updatedAnswer,
    trust,
    supportLabelTrust,
    supportStrength,
    supportLabel,
    strongSupportLabelCapped: capped,
  };
}

/**
 * Recalculates support labels for all turns in a persisted answer thread.
 */
export function recalculateThreadSupportLabels(thread: PersistedAnswerThread): PersistedAnswerThread {
  const priorTurns: StoredAnswerTurn[] = thread.priorTurns.map((turn) => {
    const recalculated = recalculateAnswerSupportLabel(turn.answer);
    return {
      ...turn,
      answer: recalculated.answer as ClientRagAnswerPayload,
    };
  });

  const latestTurn = thread.latestTurn
    ? {
        ...thread.latestTurn,
        answer: recalculateAnswerSupportLabel(thread.latestTurn.answer).answer as ClientRagAnswerPayload,
      }
    : null;

  return {
    ...thread,
    priorTurns,
    latestTurn,
  };
}

function main() {
  console.log("Answer support label recalculation utility loaded.");
  console.log(
    `Support scoring thresholds: HIGH >= ${SUPPORT_SCORE_THRESHOLDS.HIGH}, MEDIUM >= ${SUPPORT_SCORE_THRESHOLDS.MEDIUM}`,
  );
}

if (process.argv[1]?.endsWith("recalculate-answer-support-labels.ts")) {
  main();
}
