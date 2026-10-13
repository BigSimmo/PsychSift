import { describe, expect, it } from "vitest";

import {
  ANSWER_SUPPORT_WORDING,
  SUPPORT_SCORE_THRESHOLDS,
  chunkHasReviewedAuthority,
  claimsHaveReviewedDirectSupport,
  recalculateAnswerSupportLabel,
  recalculateThreadSupportLabels,
} from "../scripts/recalculate-answer-support-labels";
import type { RagAnswer, SearchResult, SupportedClaim } from "../src/lib/types";
import type { PersistedAnswerThread } from "../src/lib/answer-thread-storage";

function createMockSource(id: string, validationStatus = "approved"): SearchResult {
  return {
    id,
    document_id: `doc-${id}`,
    title: `Guideline ${id}`,
    file_name: `${id}.pdf`,
    page_number: 1,
    chunk_index: 0,
    section_heading: null,
    content: "Clinical dosage guidance content.",
    image_ids: [],
    images: [],
    similarity: 0.88,
    source_metadata: {
      source_title: `Guideline ${id}`,
      publisher: "WA Health",
      jurisdiction: "WA",
      version: "1.0",
      publication_date: "2026-01-01",
      review_date: "2027-01-01",
      uploaded_at: "2026-01-01",
      indexed_at: "2026-01-01",
      uploaded_by: null,
      document_status: "current",
      clinical_validation_status: validationStatus as "approved" | "unverified" | "locally_reviewed",
      extraction_quality: "good",
    },
  };
}

describe("recalculate-answer-support-labels", () => {
  it("defines the standard support scoring thresholds", () => {
    expect(SUPPORT_SCORE_THRESHOLDS.HIGH).toBe(0.82);
    expect(SUPPORT_SCORE_THRESHOLDS.MEDIUM).toBe(0.64);
  });

  it("checks reviewed authority for approved and locally_reviewed chunks", () => {
    const approvedAnswer: Partial<RagAnswer> = {
      sources: [createMockSource("chunk-1", "approved")],
    };
    expect(chunkHasReviewedAuthority("chunk-1", approvedAnswer)).toBe(true);

    const unreviewedAnswer: Partial<RagAnswer> = {
      sources: [createMockSource("chunk-2", "unverified")],
    };
    expect(chunkHasReviewedAuthority("chunk-2", unreviewedAnswer)).toBe(false);

    const assessmentAnswer: Partial<RagAnswer> = {
      evidenceAssessments: {
        "chunk-3": {
          authority: "locally_reviewed",
          currency: "current",
          relevance: "direct",
          claimSupport: "direct",
          extractionQuality: "good",
        },
      },
    };
    expect(chunkHasReviewedAuthority("chunk-3", assessmentAnswer)).toBe(true);
  });

  it("verifies direct reviewed support across all claims", () => {
    const answer: Partial<RagAnswer> = {
      sources: [createMockSource("c1", "approved"), createMockSource("c2", "approved")],
    };

    const directClaims: SupportedClaim[] = [
      {
        claimId: "cl-1",
        text: "Dose is 10mg daily",
        supportStatus: "direct",
        supportingChunkIds: ["c1"],
        riskClass: "routine",
      },
      {
        claimId: "cl-2",
        text: "Monitor weekly",
        supportStatus: "direct",
        supportingChunkIds: ["c2"],
        riskClass: "high_risk",
      },
    ];

    expect(claimsHaveReviewedDirectSupport(directClaims, answer)).toBe(true);

    const partialClaims: SupportedClaim[] = [
      {
        claimId: "cl-1",
        text: "Dose is 10mg daily",
        supportStatus: "partial",
        supportingChunkIds: ["c1"],
        riskClass: "routine",
      },
    ];
    expect(claimsHaveReviewedDirectSupport(partialClaims, answer)).toBe(false);

    expect(claimsHaveReviewedDirectSupport([], answer)).toBe(false);
  });

  it("awards Strong support when high confidence and all claims have reviewed direct support", () => {
    const answer: Partial<RagAnswer> = {
      answer: "Start dose at 25mg daily.",
      confidence: "high",
      grounded: true,
      sources: [createMockSource("c1", "approved")],
      supportedClaims: [
        {
          claimId: "cl-1",
          text: "Start dose at 25mg daily.",
          supportStatus: "direct",
          supportingChunkIds: ["c1"],
          riskClass: "routine",
        },
      ],
    };

    const result = recalculateAnswerSupportLabel(answer);
    expect(result.strongSupportLabelCapped).toBe(false);
    expect(result.supportStrength).toBe("strong");
    expect(result.supportLabel).toBe(ANSWER_SUPPORT_WORDING.strong);
    expect(result.supportLabelTrust).toBe("high");
  });

  it("retroactively caps Strong support to Supported when evidence authority is unreviewed", () => {
    const answer: Partial<RagAnswer> = {
      answer: "Start dose at 25mg daily.",
      confidence: "high",
      grounded: true,
      sources: [createMockSource("c1", "unverified")],
      supportedClaims: [
        {
          claimId: "cl-1",
          text: "Start dose at 25mg daily.",
          supportStatus: "direct",
          supportingChunkIds: ["c1"],
          riskClass: "high_risk",
        },
      ],
    };

    const result = recalculateAnswerSupportLabel(answer);
    expect(result.strongSupportLabelCapped).toBe(true);
    expect(result.supportStrength).toBe("supported");
    expect(result.supportLabel).toBe(ANSWER_SUPPORT_WORDING.supported);
    expect(result.supportLabelTrust).toBe("medium");
  });

  it("retroactively caps legacy answers stored without strongSupportLabelCapped or claims", () => {
    const legacyStoredAnswer = {
      answer: "Old cached answer text.",
      confidence: "high" as const,
      grounded: true,
    };

    const result = recalculateAnswerSupportLabel(legacyStoredAnswer);
    expect(result.strongSupportLabelCapped).toBe(true);
    expect(result.supportStrength).toBe("supported");
    expect(result.supportLabel).toBe("Supported");
  });

  it("maps medium, low, and unsupported confidence correctly", () => {
    const mediumAnswer = {
      answer: "Medium confidence recommendation.",
      confidence: "medium" as const,
      grounded: true,
    };
    expect(recalculateAnswerSupportLabel(mediumAnswer).supportLabel).toBe("Supported");

    const lowAnswer = {
      answer: "Low confidence recommendation.",
      confidence: "low" as const,
      grounded: true,
    };
    expect(recalculateAnswerSupportLabel(lowAnswer).supportLabel).toBe("Limited support");

    const unsupportedAnswer = {
      answer: "Unsupported answer.",
      confidence: "unsupported" as const,
      grounded: false,
    };
    expect(recalculateAnswerSupportLabel(unsupportedAnswer).supportLabel).toBe("Review support");
  });

  it("recalculates all turns in a persisted answer thread", () => {
    const mockThread: PersistedAnswerThread = {
      version: 2,
      priorTurns: [
        {
          id: "turn-1",
          query: "lithium levels",
          answer: {
            answer: "Check 12-hour trough.",
            confidence: "high",
            grounded: true,
            citations: [],
            sources: [],
          },
          sources: [],
        },
      ],
      latestTurn: {
        query: "repeat testing",
        answer: {
          answer: "Repeat after 5-7 days.",
          confidence: "high",
          grounded: true,
          citations: [],
          sources: [],
        },
        sources: [],
      },
      collapsedTurnIds: [],
      showEarlierTurns: false,
      latestSubmissionSignature: "sig",
      expiresAt: Date.now() + 10000,
    };

    const updatedThread = recalculateThreadSupportLabels(mockThread);
    expect(updatedThread.priorTurns[0].answer.strongSupportLabelCapped).toBe(true);
    expect(updatedThread.latestTurn?.answer.strongSupportLabelCapped).toBe(true);
  });
});
