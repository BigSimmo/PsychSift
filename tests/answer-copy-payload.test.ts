import { describe, expect, it } from "vitest";

import {
  answerIsNotInSources,
  answerIsRefusal,
  answerTextForClipboard,
  answerStateForAnswer,
  buildAnswerClipboardText,
  resolveAnswerSources,
  singleDocumentClipboardMetadata,
} from "@/components/clinical-dashboard/answer-copy-payload";
import type { ClinicalSourceMetadata, RagAnswer, SearchResult } from "@/lib/types";

// ClinicalSourceMetadata's governance fields are required-and-nullable rather
// than optional, so a fixture cannot quietly omit the provenance a real source
// always carries. Annotated once here and varied by spread below: spreading
// `overdueSource.source_metadata` instead would widen every field back to
// optional, because `source_metadata` is optional on `SearchResult`.
const overdueMetadata: ClinicalSourceMetadata = {
  source_title: "Superseded WA protocol",
  publisher: null,
  jurisdiction: null,
  version: null,
  publication_date: null,
  review_date: "2020-01-01",
  uploaded_at: null,
  indexed_at: null,
  uploaded_by: null,
  document_status: "outdated",
  clinical_validation_status: "unknown",
  extraction_quality: "unknown",
};

const overdueSource: SearchResult = {
  id: "chunk-1",
  document_id: "doc-1",
  title: "Superseded WA protocol",
  file_name: "protocol.pdf",
  page_number: 3,
  chunk_index: 0,
  section_heading: "Dosing",
  content: "Legacy dose text.",
  image_ids: [],
  similarity: 0.9,
  images: [],
  source_metadata: overdueMetadata,
};

const currentSource: SearchResult = {
  ...overdueSource,
  id: "chunk-2",
  source_metadata: { ...overdueMetadata, document_status: "current", review_date: "2026-01-01" },
};

function answerWith(sources: SearchResult[]): RagAnswer {
  return {
    answer: "Start at 12.5 mg at night.",
    grounded: true,
    confidence: "high",
    citations: [],
    sources,
  };
}

describe("resolveAnswerSources", () => {
  it("keeps a populated answer.sources set", () => {
    expect(resolveAnswerSources([overdueSource], [])).toEqual([overdueSource]);
  });

  it("falls back when answer.sources is an empty array", () => {
    // RagAnswer.sources is a required array, so "not populated" arrives as [] —
    // nullish coalescing alone would keep [] and drop the fallback.
    expect(resolveAnswerSources([], [overdueSource])).toEqual([overdueSource]);
  });

  it("falls back when answer.sources is nullish", () => {
    expect(resolveAnswerSources(undefined, [overdueSource])).toEqual([overdueSource]);
    expect(resolveAnswerSources(null, [overdueSource])).toEqual([overdueSource]);
  });
});

describe("answerStateForAnswer · empty sources fallback", () => {
  it("projects stale_evidence from the fallback when answer.sources is []", () => {
    const state = answerStateForAnswer({
      answer: answerWith([]),
      sources: [overdueSource],
    });

    expect(state.kind).toBe("stale_evidence");
    if (state.kind !== "stale_evidence") return;
    expect(state.sourceCount).toBe(1);
    expect(state.overdue[0]?.sourceId).toBe("doc-1");
  });

  it("does not invent stale_evidence when both sets are empty", () => {
    const state = answerStateForAnswer({
      answer: answerWith([]),
      sources: [],
    });

    expect(state).toEqual({ kind: "ready", sourceCount: 0 });
  });

  it("carries typed fallback precedence into every clipboard state projection", () => {
    const state = answerStateForAnswer({
      answer: {
        ...answerWith([]),
        answerQualityTier: "source_only",
        fallbackReasonCode: "coverage_gap",
        degradedMode: {
          active: true,
          reason: "Answer generation timed out; the verified source-backed portion is shown.",
        },
      },
    });

    expect(state).toEqual({ kind: "source_only", reason: "quality_gate" });
  });

  it("describes offline generation as unavailable rather than a quality-gate failure", () => {
    const offlineAnswer: RagAnswer = {
      ...answerWith([]),
      answerQualityTier: "source_only",
      fallbackReasonCode: "provider_offline",
    };

    expect(answerStateForAnswer({ answer: offlineAnswer })).toEqual({
      kind: "source_only",
      reason: "generation_failed",
    });
    expect(
      buildAnswerClipboardText({
        answer: offlineAnswer,
        renderCopyText: "Clinical answer draft\n\nAnswer\nStart at 12.5 mg at night.",
      }),
    ).toMatch(/answer generation was unavailable/i);
  });

  it.each([
    ["coverage_gap", /active sources support only part/i],
    ["provider_offline", /Answer generation is temporarily unavailable; the verified source-backed portion is shown\./],
    ["provider_missing_key", /Answer generation is not configured; the verified source-backed portion is shown\./],
  ] as const)("copies tierless %s degradation with the governed caveat", (fallbackReasonCode, caveat) => {
    const degradedAnswer: RagAnswer = {
      ...answerWith([]),
      fallbackReasonCode,
      degradedMode: { active: true, reason: "A fixed public explanation." },
    };

    expect(answerStateForAnswer({ answer: degradedAnswer })).toMatchObject({ kind: "ready" });
    const copied = buildAnswerClipboardText({
      answer: degradedAnswer,
      renderCopyText: "Clinical answer draft\n\nAnswer\nStart at 12.5 mg at night.",
    });
    expect(copied).toMatch(caveat);
    expect(copied).toMatch(/^AI-generated from the cited sources\./);
    expect(copied).not.toMatch(/without (?:AI|model) synthesis/i);
  });
});

describe("buildAnswerClipboardText · single-document provenance", () => {
  it("includes the provenance audit line for a one-document answer", () => {
    const copied = buildAnswerClipboardText({
      answer: answerWith([currentSource]),
      renderCopyText: "Clinical answer draft\n\nStart at 12.5 mg at night.",
    });

    expect(copied).toContain("Designation:");
    expect(copied).toContain("Review status:");
  });

  it("keeps the provenance line when the extra document is an uncited candidate", () => {
    // RagAnswer.sources retains every retrieval candidate while citations name
    // the supporting set. Deriving metadata from the raw candidate list made a
    // genuinely one-document answer look like two and dropped the audit line
    // from the paste — on the normal payload shape, not an edge case.
    const uncitedOtherDoc: SearchResult = {
      ...currentSource,
      id: "chunk-99",
      document_id: "doc-2",
      title: "Unrelated candidate",
    };
    const answer: RagAnswer = {
      ...answerWith([currentSource, uncitedOtherDoc]),
      citations: [
        {
          chunk_id: currentSource.id,
          document_id: currentSource.document_id,
          title: currentSource.title,
          file_name: currentSource.file_name,
          page_number: currentSource.page_number,
          chunk_index: currentSource.chunk_index,
        },
      ],
    };

    const copied = buildAnswerClipboardText({ answer, renderCopyText: "Clinical answer draft" });
    expect(copied).toContain("Designation:");
    expect(copied).toContain("Review status:");
  });

  it("suppresses the provenance line when more than one document is cited", () => {
    const secondDoc: SearchResult = {
      ...currentSource,
      id: "chunk-3",
      document_id: "doc-2",
      title: "Second guideline",
    };
    const copied = buildAnswerClipboardText({
      answer: answerWith([currentSource, secondDoc]),
      renderCopyText: "Clinical answer draft",
    });

    expect(copied).not.toContain("Designation:");
    expect(singleDocumentClipboardMetadata([currentSource, secondDoc])).toBeUndefined();
  });
});

describe("answerTextForClipboard", () => {
  it("uses the complete sanitized finalized lead in the composed clipboard payload", () => {
    const answer: RagAnswer = {
      ...answerWith([]),
      answer:
        "Source excerpt: Review the current observations and documented risk factors. Confirm the planned intervention against the local protocol. Record the rationale and any variance in the clinical note. Arrange the scheduled follow-up and monitoring. Escalate through the established pathway if the condition worsens.",
    };
    const composed = buildAnswerClipboardText({
      answer,
      renderCopyText: `Clinical answer draft\n\nAnswer\n${answer.answer}\n\nSource status\nRender trust: high`,
    });
    const expectedLead =
      "Review the current observations and documented risk factors. Confirm the planned intervention against the local protocol. Record the rationale and any variance in the clinical note. Arrange the scheduled follow-up and monitoring. Escalate through the established pathway if the condition worsens.";

    expect(answerTextForClipboard(answer)).toBe(expectedLead);
    expect(composed).toContain(`Answer\n${expectedLead}\n\nSource status`);
    expect(composed).not.toContain("Source excerpt:");
  });

  it.each([true, false])("copies every ordered v20 section when render permission is %s", (renderAdaptiveAnswer) => {
    const answer: RagAnswer = {
      ...answerWith([currentSource]),
      answer: "Review the current plan.",
      answerContractVersion: "clinical-rag-answer-v20",
      renderAdaptiveAnswer,
      answerSections: [
        {
          heading: "Monitoring",
          body: "Review observations every three months.",
          kind: "monitoring_timing",
          supportLevel: "direct",
          citation_chunk_ids: [currentSource.id],
        },
        {
          heading: "Source gap",
          body: "Route: not covered by the active sources.",
          kind: "source_gap",
          supportLevel: "unsupported",
          citation_chunk_ids: [],
        },
      ],
    };

    expect(answerTextForClipboard(answer)).toBe(
      "Review the current plan.\n\nMonitoring\n\nReview observations every three months.\n\nSource gap\n\nRoute: not covered by the active sources.",
    );
  });

  it("keeps complete v20 content when the render-policy copy has no Answer marker", () => {
    const answer: RagAnswer = {
      ...answerWith([]),
      answer: "Review the current plan.",
      answerContractVersion: "clinical-rag-answer-v20",
      renderAdaptiveAnswer: false,
      answerSections: [
        {
          heading: "Monitoring",
          body: "Review observations every three months.",
          kind: "monitoring_timing",
          supportLevel: "direct",
          citation_chunk_ids: [],
        },
      ],
    };
    const copied = buildAnswerClipboardText({ answer, renderCopyText: "Clinical answer draft\n\nSource status\nHigh" });

    expect(copied).toContain("Review the current plan.\n\nMonitoring\n\nReview observations every three months.");
    expect(copied).toContain("Clinical answer draft");
  });

  it.each([true, false])(
    "does not duplicate an already-complete markerless v20 canonical block when render permission is %s",
    (renderAdaptiveAnswer) => {
      const answer: RagAnswer = {
        ...answerWith([currentSource]),
        answer: "Review the current plan.",
        answerContractVersion: "clinical-rag-answer-v20",
        renderAdaptiveAnswer,
        answerSections: [
          {
            heading: "Monitoring schedule",
            body: "Review observations every three months.",
            kind: "monitoring_timing",
            supportLevel: "direct",
            citation_chunk_ids: [currentSource.id],
          },
          {
            heading: "Route uncertainty",
            body: "The active sources support only part of the route question.",
            kind: "source_gap",
            supportLevel: "unsupported",
            citation_chunk_ids: [],
          },
        ],
      };
      const canonical = answerTextForClipboard(answer);
      const copied = buildAnswerClipboardText({
        answer,
        renderCopyText: `Clinical answer draft\n\n${canonical}\n\nSource status\nHigh`,
      });

      for (const part of [
        "Review the current plan.",
        "Monitoring schedule",
        "Review observations every three months.",
        "Route uncertainty",
        "The active sources support only part of the route question.",
      ]) {
        expect(copied.split(part)).toHaveLength(2);
      }
      expect(copied).toContain("Clinical answer draft");
      expect(copied).toContain("Source status\nHigh");
    },
  );
});

it("R3 preserves the precise source-only reason in clipboard text", () => {
  const answer: RagAnswer = {
    ...answerWith([currentSource]),
    answerQualityTier: "source_only",
    fallbackReasonCode: "provider_timeout",
    routingMode: "extractive",
  };
  const copied = buildAnswerClipboardText({ answer, weakEvidence: false, renderCopyText: "Clinical answer draft" });
  expect(copied).toContain("Answer generation timed out; the verified source-backed portion is shown.");
  expect(copied).toContain("without model synthesis");
});

describe("answerIsRefusal (#Z9NS6H, owner approval 2026-09-28)", () => {
  // The union of every candidate signal: under-claiming support is the patient-safe error.
  it.each([
    ["grounded === false", { grounded: false }, null],
    ["an ungrounded answer state", { grounded: true }, { kind: "ungrounded" as const }],
    ["a no_answer state", { grounded: true }, { kind: "no_answer" as const }],
    ["coverage_gap", { grounded: true, fallbackReasonCode: "coverage_gap" as const }, null],
    ["no_candidates", { grounded: true, fallbackReasonCode: "no_candidates" as const }, null],
    ["low_signal", { grounded: true, fallbackReasonCode: "low_signal" as const }, null],
  ])("treats %s as a refusal", (_label, answer, answerState) => {
    expect(answerIsRefusal({ answer, answerState })).toBe(true);
  });

  it("does not treat a grounded, ready answer as a refusal", () => {
    expect(
      answerIsRefusal({ answer: { grounded: true, fallbackReasonCode: null }, answerState: { kind: "ready" } }),
    ).toBe(false);
  });
});

describe("answerIsNotInSources (audit D03)", () => {
  it.each([
    [
      "no_candidates",
      { confidence: "unsupported" as const, fallbackReasonCode: "no_candidates" as const },
      false,
      true,
    ],
    ["unsupported", { confidence: "unsupported" as const, fallbackReasonCode: "unsupported" as const }, false, true],
    // A fail-closed answer (numeric check, timeout) keeps its sources and its caution.
    ["unsupported with no reason code", { confidence: "unsupported" as const, fallbackReasonCode: null }, false, false],
    ["the demo corpus refusal", { confidence: "unsupported" as const, fallbackReasonCode: null }, true, true],
    // Partial support is still an answer with sources.
    ["coverage_gap", { confidence: "unsupported" as const, fallbackReasonCode: "coverage_gap" as const }, false, false],
    ["a supported answer", { confidence: "high" as const, fallbackReasonCode: null }, false, false],
  ])("%s", (_label, answer, demo, expected) => {
    expect(answerIsNotInSources(answer, { demo })).toBe(expected);
  });
});
