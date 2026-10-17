import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AnswerSummaryUnavailableNotice } from "@/components/clinical-dashboard/answer-provider-notice";
import { StagedAnswerResultSurface } from "@/components/clinical-dashboard/answer-result-surface";
import { buildAnswerRenderModel } from "@/lib/answer-render-policy";
import { toClientAnswerPayload } from "@/lib/answer-client-payload";
import { PriorAnswerTurnSurface, type AnswerTurn } from "@/components/clinical-dashboard/answer-thread-turn";
import { retrievalDeadlineExceededAnswer } from "@/lib/rag/rag-route-budget";
import type { RagAnswer, SearchResult } from "@/lib/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

/**
 * PR 13 answer adoption, product side of `#208`.
 *
 * `tests/answer-clipboard-composition.test.ts` pins the composer in isolation.
 * This file pins that the **product** copy button actually goes through it — the
 * regression it catches is a future edit quietly reverting `onCopy` to
 * `renderModel.copyText`, which would strip the attribution and the caveat from
 * everything a clinician pastes into a record while every other test stayed green.
 */

const source: SearchResult = {
  id: "chunk-1",
  document_id: "doc-1",
  title: "WA Clozapine Protocol",
  file_name: "clozapine.pdf",
  page_number: 12,
  chunk_index: 0,
  section_heading: "Titration",
  content: "Start at 12.5 mg at night and titrate slowly.",
  image_ids: [],
  similarity: 0.9,
  images: [],
};

function serverAnswer(answer: Partial<RagAnswer> = {}): RagAnswer {
  return {
    answer: "Start at 12.5 mg at night.",
    grounded: true,
    confidence: "high",
    citations: [],
    sources: [source],
    ...answer,
  };
}

function turnFor(answer: Partial<RagAnswer>): AnswerTurn {
  return {
    id: "turn-1",
    query: "clozapine starting dose",
    answer: serverAnswer(answer),
    sources: [source],
  };
}

async function copiedTextFor(answer: Partial<RagAnswer>) {
  const onCopy = vi.fn();
  render(
    <PriorAnswerTurnSurface
      turn={turnFor(answer)}
      copied={false}
      collapsed={false}
      onToggleCollapsed={() => {}}
      onCopy={onCopy}
    />,
  );

  await userEvent.click(screen.getByRole("button", { name: "Copy answer with source status" }));
  expect(onCopy).toHaveBeenCalledOnce();
  return onCopy.mock.calls[0]?.[0] as string;
}

describe("product answer copy · goes through the #208 composer", () => {
  it("attributes the answer and keeps the whole render-policy block", async () => {
    const copied = await copiedTextFor({});

    expect(copied.startsWith("AI-generated from the cited sources.")).toBe(true);
    // The render-policy payload is still the body of the paste, not a summary of it.
    expect(copied).toContain("Clinical answer draft");
    expect(copied).toContain("Sources for review");
    expect(copied).toContain("Warnings");
    // A single thin source does not reach high render trust, so this fixture is
    // legitimately weak-evidence and carries that caveat. Recorded rather than
    // asserted away: the state comes from the render policy, not from the flags
    // on the fixture.
    expect(copied).toContain("Caveat: the evidence supporting this answer is weak.");
  });

  it("never claims a model wrote an extractive answer, even when it is also weak", async () => {
    // The defect this pins: `ungrounded` outranks `source_only` in the
    // projection, so keying attribution on the state kind pasted "AI-generated"
    // over passages no model wrote. The tier is passed explicitly for this reason.
    const copied = await copiedTextFor({ answerQualityTier: "source_only", grounded: false });

    expect(copied.startsWith("Assembled directly from the cited sources without model synthesis.")).toBe(true);
    expect(copied).not.toContain("AI-generated");
    expect(copied).toContain("Caveat: this answer could not be matched to the sources it cites.");
  });

  it("carries the ungrounded caveat into the paste, above the render block", async () => {
    const copied = await copiedTextFor({ grounded: false });

    const caveatIndex = copied.indexOf("Caveat: this answer could not be matched");
    expect(caveatIndex).toBeGreaterThanOrEqual(0);
    expect(caveatIndex).toBeLessThan(copied.indexOf("Clinical answer draft"));
  });

  it("names an unsupported-confidence answer rather than pasting it clean", async () => {
    const copied = await copiedTextFor({ confidence: "unsupported" });
    expect(copied).toContain("Caveat: this answer is reported as unsupported by the sources it cites.");
  });

  it("warns on unverified clinical values", async () => {
    const copied = await copiedTextFor({ unverifiedNumericTokens: ["12.5 mg"] });
    expect(copied).toContain("Caveat: some clinical values in this answer were not found in the cited sources.");
  });

  it("names a source-only answer as unsynthesised", async () => {
    const copied = await copiedTextFor({ answerQualityTier: "source_only" });
    expect(copied.startsWith("Assembled directly from the cited sources without model synthesis.")).toBe(true);
  });

  it.each([
    ["provider_offline", /answer generation is .*unavailable/i],
    ["provider_missing_key", /answer generation is not configured/i],
  ] as const)(
    "surfaces tierless %s degradation without inventing extractive provenance",
    async (fallbackReasonCode, expectedReason) => {
      const copied = await copiedTextFor({
        fallbackReasonCode,
        degradedMode: { active: true, reason: "Answer generation was unavailable; verified sources are shown." },
      });

      expect(screen.getByTestId("prior-answer-source-review")).toBeInTheDocument();
      expect(copied.startsWith("AI-generated from the cited sources.")).toBe(true);
      expect(copied).not.toMatch(/without (?:AI|model) synthesis/i);
      expect(copied).toMatch(expectedReason);
    },
  );

  it("shows a model-synthesized coverage gap without claiming source-only provenance", async () => {
    const copied = await copiedTextFor({
      answerQualityTier: "model_synthesis",
      routingMode: "strong",
      fallbackReasonCode: "coverage_gap",
      degradedMode: { active: true, reason: "The active sources support only part of this question." },
    });

    expect(screen.getByTestId("prior-answer-source-review")).toHaveTextContent(
      "The active sources support only part of this question.",
    );
    expect(copied.startsWith("AI-generated from the cited sources.")).toBe(true);
    expect(copied).toContain("Caveat:");
    expect(copied).not.toMatch(/extractive|without (?:AI|model) synthesis/i);
  });
});

it("R3 displays canonical degradation on the current staged synthesized answer", () => {
  const answer = toClientAnswerPayload({
    ...serverAnswer(),
    answerQualityTier: "model_synthesis",
    routingMode: "strong",
    fallbackReasonCode: "coverage_gap",
  });
  const model = buildAnswerRenderModel(answer);
  render(
    <StagedAnswerResultSurface
      answer={answer}
      query="clozapine starting dose"
      bestSource={null}
      renderModel={model}
      weakEvidence={false}
      answerViewMode="standard"
      answerEvidenceMapRows={[]}
      onScopeDocument={() => {}}
      answerGrounded
      sources={answer.sources}
      demoMode={false}
      safeAnswerSections={[]}
      safetyFindings={[]}
      copiedAnswer={false}
      pendingFeedback={null}
      onCopyAnswer={() => {}}
      onSubmitFeedback={() => {}}
    />,
  );
  expect(screen.getAllByText("The active sources support only part of this question.")).toHaveLength(1);
  expect(screen.queryByText(/without (?:AI|model) synthesis/i)).not.toBeInTheDocument();
});

it("R3 retains restored demo disclosure in prior answer and copy", async () => {
  const copied = await copiedTextFor({
    answer: "Synthetic example.",
    ...{ demoMode: true, fallbackMode: "non_production_demo" as const },
  });
  expect(screen.getByText("Synthetic demo only: this is not clinical guidance.")).toBeInTheDocument();
  expect(copied).toContain("Synthetic demo only: this is not clinical guidance.");
});

it("R3 retains restored demo disclosure on the current answer", () => {
  const answer = {
    ...toClientAnswerPayload(serverAnswer()),
    demoMode: true,
    fallbackMode: "non_production_demo" as const,
  };
  render(
    <StagedAnswerResultSurface
      answer={answer}
      query="Example"
      bestSource={null}
      renderModel={buildAnswerRenderModel(answer)}
      weakEvidence={false}
      answerViewMode="standard"
      answerEvidenceMapRows={[]}
      onScopeDocument={() => {}}
      answerGrounded
      sources={answer.sources}
      demoMode={false}
      safeAnswerSections={[]}
      safetyFindings={[]}
      copiedAnswer={false}
      pendingFeedback={null}
      onCopyAnswer={() => {}}
      onSubmitFeedback={() => {}}
    />,
  );
  expect(screen.getByText("Synthetic demo only: this is not clinical guidance.")).toBeInTheDocument();
});

it("R3 moves a provider failure to the amber line under the overseas notice, full reason kept for screen readers", () => {
  const answer = toClientAnswerPayload({
    ...serverAnswer(),
    answerQualityTier: "source_only",
    routingMode: "extractive",
    fallbackReasonCode: "provider_timeout",
  });
  const phrase = "Answer generation timed out; the verified source-backed portion is shown.";
  render(
    <>
      <StagedAnswerResultSurface
        answer={answer}
        query="clozapine starting dose"
        bestSource={null}
        renderModel={buildAnswerRenderModel(answer)}
        weakEvidence={false}
        answerViewMode="standard"
        answerEvidenceMapRows={[]}
        onScopeDocument={() => {}}
        answerGrounded
        sources={answer.sources}
        demoMode={false}
        safeAnswerSections={[]}
        safetyFindings={[]}
        copiedAnswer={false}
        pendingFeedback={null}
        onCopyAnswer={() => {}}
        onSubmitFeedback={() => {}}
      />
      <AnswerSummaryUnavailableNotice answer={answer} />
    </>,
  );
  const notes = screen.getAllByTestId("current-answer-degradation");
  expect(notes).toHaveLength(1);
  expect(notes[0]).toHaveTextContent("AI summary unavailable");
  expect(notes[0]).toHaveTextContent(phrase);
});

it("R3 keeps a retrieval deadline warning above the answer, with no amber summary line", () => {
  // The deadline answer reports provider_timeout but confirmed no evidence, so it must not
  // claim a verified source-backed portion below the answer.
  const answer = toClientAnswerPayload(
    retrievalDeadlineExceededAnswer({ searchStartedAt: Date.now(), startedAt: Date.now(), budgetMs: 1000 }),
  );
  render(
    <>
      <StagedAnswerResultSurface
        answer={answer}
        query="clozapine starting dose"
        bestSource={null}
        renderModel={buildAnswerRenderModel(answer)}
        weakEvidence={false}
        answerViewMode="standard"
        answerEvidenceMapRows={[]}
        onScopeDocument={() => {}}
        answerGrounded={false}
        sources={answer.sources}
        demoMode={false}
        safeAnswerSections={[]}
        safetyFindings={[]}
        copiedAnswer={false}
        pendingFeedback={null}
        onCopyAnswer={() => {}}
        onSubmitFeedback={() => {}}
      />
      <AnswerSummaryUnavailableNotice answer={answer} />
    </>,
  );
  expect(screen.queryByText("AI summary unavailable")).not.toBeInTheDocument();
  const notes = screen.getAllByTestId("current-answer-degradation");
  expect(notes).toHaveLength(1);
  expect(notes[0]).not.toHaveTextContent("AI summary unavailable");
});

it.each([
  // An evidence reason keeps its full sentence above the answer, even on a source-only answer.
  ["retrieval_degraded", "source_only", "Search used a reduced retrieval path; review the cited sources carefully."],
  ["source_conflict", "model_synthesis", "Current sources contain a material difference that requires review."],
] as const)("R3 displays the current precise %s disclosure", (fallbackReasonCode, answerQualityTier, phrase) => {
  const answer = toClientAnswerPayload({
    ...serverAnswer(),
    answerQualityTier,
    routingMode: answerQualityTier === "source_only" ? "extractive" : "strong",
    fallbackReasonCode,
  });
  render(
    <StagedAnswerResultSurface
      answer={answer}
      query="clozapine starting dose"
      bestSource={null}
      renderModel={buildAnswerRenderModel(answer)}
      weakEvidence={false}
      answerViewMode="standard"
      answerEvidenceMapRows={[]}
      onScopeDocument={() => {}}
      answerGrounded
      sources={answer.sources}
      demoMode={false}
      safeAnswerSections={[]}
      safetyFindings={[]}
      copiedAnswer={false}
      pendingFeedback={null}
      onCopyAnswer={() => {}}
      onSubmitFeedback={() => {}}
    />,
  );
  expect(screen.getAllByText(phrase)).toHaveLength(1);
  if (answerQualityTier === "model_synthesis")
    expect(screen.queryByText(/without (?:AI|model) synthesis/i)).not.toBeInTheDocument();
});
