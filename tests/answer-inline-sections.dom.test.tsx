import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AnswerInlineSections } from "@/components/clinical-dashboard/answer-inline-sections";
import {
  answerUsesAdaptiveMainSurface,
  projectAnswerForMainSurface,
} from "@/components/clinical-dashboard/answer-section-projector";
import { StagedAnswerResultSurface } from "@/components/clinical-dashboard/answer-result-surface";
import { buildAnswerRenderModel } from "@/lib/answer-render-policy";
import type { ClientRagAnswerPayload, ClientSearchResult } from "@/lib/answer-client-payload";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

function source(id: string, documentId: string, title: string, page: number): ClientSearchResult {
  return {
    id,
    document_id: documentId,
    title,
    file_name: `${documentId}.pdf`,
    page_number: page,
    chunk_index: page,
    section_heading: "Clinical guidance",
    content: `${title} synthetic passage`,
    image_ids: [],
    similarity: 0.95,
    source_metadata: { document_status: "current" },
  };
}

const local = source("chunk-local", "doc-local", "Uploaded local protocol", 4);
const wa = source("chunk-wa", "doc-wa", "WA clinical guideline", 9);
const uncited = source("chunk-unused", "doc-unused", "Uncited retrieval", 2);
const orderedLeadSources = ["A", "B", "C", "D", "E"].map((label, index) =>
  source(`chunk-lead-${label.toLowerCase()}`, `doc-lead-${label.toLowerCase()}`, `Lead source ${label}`, index + 1),
);

function citation(sourceResult: ClientSearchResult) {
  return {
    chunk_id: sourceResult.id,
    document_id: sourceResult.document_id,
    title: sourceResult.title,
    file_name: sourceResult.file_name,
    page_number: sourceResult.page_number,
    chunk_index: sourceResult.chunk_index,
  };
}

function recommendedSource(sourceResult: ClientSearchResult) {
  return {
    ...citation(sourceResult),
    source_strength: "strong" as const,
    score: 0.99,
    snippet: sourceResult.content,
    section_heading: sourceResult.section_heading,
    image_count: 0,
    viewer_href: `/documents/${sourceResult.document_id}?page=${sourceResult.page_number}&chunk=${sourceResult.id}`,
  };
}

function adaptiveAnswer(overrides: Partial<ClientRagAnswerPayload> = {}): ClientRagAnswerPayload {
  return {
    answer: "Source excerpt: **Review** the current plan before treatment.",
    grounded: true,
    confidence: "high",
    citations: [
      {
        chunk_id: local.id,
        document_id: local.document_id,
        title: local.title,
        file_name: local.file_name,
        page_number: local.page_number,
        chunk_index: local.chunk_index,
      },
    ],
    sources: [local, wa, uncited],
    bestSource: {
      chunk_id: wa.id,
      document_id: wa.document_id,
      title: wa.title,
      file_name: wa.file_name,
      page_number: wa.page_number,
      chunk_index: wa.chunk_index,
      source_strength: "strong",
      score: 0.99,
      snippet: wa.content,
      section_heading: wa.section_heading,
      image_count: 0,
      viewer_href: "/documents/doc-wa?page=9&chunk=chunk-wa",
    },
    answerContractVersion: "clinical-rag-answer-v20",
    renderAdaptiveAnswer: true,
    answerSections: [
      {
        heading: "Required action",
        body: "Confirm the **documented dose** before administration.",
        kind: "required_actions",
        supportLevel: "direct",
        citation_chunk_ids: [local.id, local.id],
      },
      {
        heading: "Source difference",
        body: "Uploaded local protocol (primary for this patient) differs from WA clinical guideline (Australia/WA, published 1 January 2026, effective 1 February 2026): review both dose instructions before use.",
        kind: "source_conflict",
        supportLevel: "direct",
        citation_chunk_ids: [local.id, wa.id],
      },
      {
        heading: "Source gap",
        body: "Monitoring frequency: not covered by the active sources.",
        kind: "source_gap",
        supportLevel: "unsupported",
        citation_chunk_ids: [],
      },
    ],
    ...overrides,
  };
}

describe("canonical adaptive answer projection", () => {
  it("keeps the complete lead and every ordered section with only exact final citation ids", () => {
    const answer = adaptiveAnswer();
    const projection = projectAnswerForMainSurface({ answer, sources: answer.sources, preformatted: false });

    expect(projection.leadText).toBe("**Review** the current plan before treatment.");
    expect(projection.leadCitationSources.map((item) => item.id)).toEqual([local.id]);
    expect(projection.sections.map((section) => section.heading)).toEqual([
      "Required action",
      "Source difference",
      "Source gap",
    ]);
    expect(projection.sections.map((section) => section.citationSources.map((item) => item.id))).toEqual([
      [local.id],
      [local.id, wa.id],
      [],
    ]);
    expect(projection.sections[1]?.body).toContain("primary for this patient");
    expect(projection.sections[2]).toMatchObject({ kind: "source_gap", supportLevel: "unsupported" });
  });

  it("requires literal v20 and authoritative final permission without erasing canonical sections", () => {
    const falsePermission = adaptiveAnswer({ renderAdaptiveAnswer: false });
    expect(answerUsesAdaptiveMainSurface(falsePermission)).toBe(false);
    expect(
      projectAnswerForMainSurface({ answer: falsePermission, sources: falsePermission.sources, preformatted: false })
        .sections,
    ).toHaveLength(3);
    expect(answerUsesAdaptiveMainSurface({ ...adaptiveAnswer(), answerContractVersion: undefined })).toBe(false);
    expect(answerUsesAdaptiveMainSurface(adaptiveAnswer())).toBe(true);
  });
});

describe("adaptive answer inline sections", () => {
  it("renders every section once without clipping and activates only its cited sources", async () => {
    const answer = adaptiveAnswer();
    const projection = projectAnswerForMainSurface({ answer, sources: answer.sources, preformatted: false });
    const { container } = render(<AnswerInlineSections sections={projection.sections} />);

    expect(screen.getAllByTestId("adaptive-answer-section")).toHaveLength(3);
    for (const heading of projection.sections.map((section) => section.heading)) {
      expect(screen.getAllByRole("heading", { name: heading })).toHaveLength(1);
    }
    for (const section of container.querySelectorAll('[data-testid="adaptive-answer-section"]')) {
      for (const prose of section.querySelectorAll(":scope > h3, :scope > p")) {
        expect(prose.className).not.toMatch(/line-clamp|truncate|overflow-hidden/);
      }
    }

    const conflict = screen.getAllByTestId("adaptive-answer-section")[1]!;
    expect(within(conflict).getAllByTestId("citation")).toHaveLength(2);
    await userEvent.click(within(conflict).getByRole("button", { name: /Source \d+, WA clinical guideline, p\. 9/i }));
    expect(push).toHaveBeenCalledWith("/documents/doc-wa?page=9&chunk=chunk-wa");
    expect(within(screen.getAllByTestId("adaptive-answer-section")[0]!).getAllByTestId("citation")).toHaveLength(1);
    expect(
      within(screen.getAllByTestId("adaptive-answer-section")[2]!).getByText(answer.answerSections![2]!.body),
    ).toBeVisible();
    expect(screen.queryByText("No source covers this gap.")).not.toBeInTheDocument();
    expect(screen.queryByText("No source supports this statement.")).not.toBeInTheDocument();
  });

  it.each([null, "coverage_gap"] as const)(
    "renders once inside the current %s answer-card path",
    async (fallbackReasonCode) => {
      const answer = adaptiveAnswer(
        fallbackReasonCode
          ? { fallbackReasonCode, degradedMode: { active: true, reason: "The active sources support only part." } }
          : {},
      );
      const renderModel = buildAnswerRenderModel(answer);
      const projection = projectAnswerForMainSurface({ answer, sources: answer.sources, preformatted: false });
      render(
        <StagedAnswerResultSurface
          answer={answer}
          query="What does the plan require?"
          bestSource={answer.bestSource ?? null}
          renderModel={renderModel}
          weakEvidence={false}
          answerViewMode="standard"
          answerEvidenceMapRows={[]}
          onScopeDocument={() => {}}
          answerGrounded
          sources={answer.sources}
          demoMode={false}
          safetyFindings={[]}
          copiedAnswer={false}
          pendingFeedback={null}
          onCopyAnswer={() => {}}
          onSubmitFeedback={() => {}}
        />,
      );

      expect(
        screen.getAllByText((_, element) =>
          Boolean(
            element?.matches("p") && element.textContent === "Confirm the documented dose before administration.",
          ),
        ),
      ).toHaveLength(1);
      expect(screen.getAllByText(/Uploaded local protocol \(primary for this patient\)/)).toHaveLength(1);
      expect(screen.getAllByText("Monitoring frequency: not covered by the active sources.")).toHaveLength(1);
      expect(projection.leadCitationSources.map((source) => source.id)).toEqual([local.id]);
      const answerSurface = screen.getByTestId("plain-answer-response");
      const sourceRows = within(within(answerSurface).getByTestId("answer-source-rail")).getAllByTestId(
        "answer-source-rail-row",
      );
      expect(sourceRows).toHaveLength(3);
      if (fallbackReasonCode) {
        // coverage_gap is a refusal under the conservative definition (#Z9NS6H, owner
        // approval 2026-09-28): every row is framed as searched, none as support.
        expect(within(answerSurface).getByTestId("answer-source-rail-heading")).toHaveTextContent("Documents searched");
        for (const row of sourceRows) expect(row).toHaveAttribute("data-cited", "false");
        expect(sourceRows[0]).toHaveAccessibleName(/Also found: WA clinical guideline/i);
        expect(sourceRows[1]).toHaveAccessibleName(/Also found: Uploaded local protocol/i);
      } else {
        expect(sourceRows[0]).toHaveAttribute("data-cited", "true");
        expect(sourceRows[0]).toHaveAccessibleName(/Source 1: WA clinical guideline/i);
        expect(sourceRows[1]).toHaveAttribute("data-cited", "true");
        expect(sourceRows[1]).toHaveAccessibleName(/Source 2: Uploaded local protocol/i);
        expect(sourceRows[2]).toHaveAttribute("data-cited", "false");
      }
      expect(sourceRows[2]).toHaveAccessibleName(/Also found: Uncited retrieval/i);
      await userEvent.click(sourceRows[1]!);
      expect(
        within(screen.getByTestId("answer-source-drawer")).getByRole("link", { name: "View original PDF" }),
      ).toHaveAttribute("href", "/documents/doc-local?page=4&chunk=chunk-local");
      expect(within(screen.getAllByTestId("adaptive-answer-section")[1]!).getAllByTestId("citation")).toHaveLength(2);
      expect(screen.queryByText("No source covers this gap.")).not.toBeInTheDocument();
      expect(screen.queryByText("No source supports this statement.")).not.toBeInTheDocument();
      if (fallbackReasonCode) {
        expect(screen.getAllByText("The active sources support only part of this question.")).toHaveLength(1);
      }
    },
  );

  it("does not borrow section or recommended sources when the v20 lead has no citations", () => {
    const answer = adaptiveAnswer({ citations: [] });
    const renderModel = buildAnswerRenderModel(answer);
    const projection = projectAnswerForMainSurface({ answer, sources: answer.sources, preformatted: false });
    render(
      <StagedAnswerResultSurface
        answer={answer}
        query="What does the plan require?"
        bestSource={answer.bestSource ?? null}
        renderModel={renderModel}
        weakEvidence
        answerViewMode="standard"
        answerEvidenceMapRows={[]}
        onScopeDocument={() => {}}
        answerGrounded={false}
        sources={answer.sources}
        demoMode={false}
        safetyFindings={[]}
        copiedAnswer={false}
        pendingFeedback={null}
        onCopyAnswer={() => {}}
        onSubmitFeedback={() => {}}
      />,
    );

    const answerSurface = screen.getByTestId("plain-answer-response");
    expect(projection.leadCitationSources).toEqual([]);
    const sourceRows = within(within(answerSurface).getByTestId("answer-source-rail")).getAllByTestId(
      "answer-source-rail-row",
    );
    expect(sourceRows).toHaveLength(3);
    // Weak evidence is an `ungrounded` answer state, a refusal under the conservative
    // definition (#Z9NS6H): rows keep their order but none is framed as support.
    for (const row of sourceRows) expect(row).toHaveAttribute("data-cited", "false");
    expect(sourceRows[0]).toHaveAccessibleName(/Also found: WA clinical guideline/i);
    expect(sourceRows[1]).toHaveAccessibleName(/Also found: Uploaded local protocol/i);
    expect(sourceRows[2]).toHaveAccessibleName(/Also found: Uncited retrieval/i);
    expect(within(screen.getAllByTestId("adaptive-answer-section")[1]!).getAllByTestId("citation")).toHaveLength(2);
  });

  it("keeps low-trust lead citation order and provenance within the six-row rail cap", async () => {
    const answer = adaptiveAnswer({
      confidence: "low",
      citations: orderedLeadSources.map(citation),
      sources: [...orderedLeadSources, wa],
      bestSource: recommendedSource(orderedLeadSources[4]!),
      answerSections: [
        {
          heading: "Ordered lead support",
          body: "All five lead citations support this synthetic statement.",
          kind: "required_actions",
          supportLevel: "direct",
          citation_chunk_ids: orderedLeadSources.map((item) => item.id),
        },
        {
          heading: "Section-only difference",
          body: "The section-only WA source remains independently available.",
          kind: "source_conflict",
          supportLevel: "direct",
          citation_chunk_ids: [orderedLeadSources[0]!.id, wa.id],
        },
      ],
    });
    const renderModel = buildAnswerRenderModel(answer);
    const projection = projectAnswerForMainSurface({ answer, sources: answer.sources, preformatted: false });
    render(
      <StagedAnswerResultSurface
        answer={answer}
        query="Which sources support the lead?"
        bestSource={answer.bestSource ?? null}
        renderModel={renderModel}
        weakEvidence
        answerViewMode="standard"
        answerEvidenceMapRows={[]}
        onScopeDocument={() => {}}
        answerGrounded
        sources={answer.sources}
        demoMode={false}
        safetyFindings={[]}
        copiedAnswer={false}
        pendingFeedback={null}
        onCopyAnswer={() => {}}
        onSubmitFeedback={() => {}}
      />,
    );

    const sourceRows = within(
      within(screen.getByTestId("plain-answer-response")).getByTestId("answer-source-rail"),
    ).getAllByTestId("answer-source-rail-row");
    expect(sourceRows).toHaveLength(6);
    expect(projection.leadCitationSources.map((source) => source.id)).toEqual(
      orderedLeadSources.map((source) => source.id),
    );
    const wholeAnswerOrder = [orderedLeadSources[4]!, ...orderedLeadSources.slice(0, 4), wa];
    wholeAnswerOrder.forEach((item, index) => {
      // Low trust is a refusal under the conservative definition (#Z9NS6H): order is
      // kept, but no row is numbered as support.
      expect(sourceRows[index]).toHaveAttribute("data-cited", "false");
      expect(sourceRows[index]).toHaveAccessibleName(new RegExp(`Also found: ${item.title}`));
    });
    await userEvent.click(sourceRows[0]!);
    expect(
      within(screen.getByTestId("answer-source-drawer")).getByRole("link", { name: "View original PDF" }),
    ).toHaveAttribute("href", "/documents/doc-lead-e?page=5&chunk=chunk-lead-e");
    expect(
      screen.getByText("Section-only difference").closest('[data-testid="adaptive-answer-section"]'),
    ).toContainElement(screen.getByRole("button", { name: /Source \d+, WA clinical guideline, p\. 9/i }));
  });
});

// #WGMB4Z decision 17 (owner, 2026-09-25): the all-claims rule changes the support WORD only.
// A high-trust answer whose claims are not all direct on approved or locally reviewed sources
// reads "Supported", not "Strong support", with the same tone, sources and sections as before.
describe("answer support label (#WGMB4Z)", () => {
  function renderSurface(answer: ClientRagAnswerPayload) {
    const renderModel = buildAnswerRenderModel(answer);
    render(
      <StagedAnswerResultSurface
        answer={answer}
        query="What does the plan require?"
        bestSource={answer.bestSource ?? null}
        renderModel={renderModel}
        weakEvidence={false}
        answerViewMode="standard"
        answerEvidenceMapRows={[]}
        onScopeDocument={() => {}}
        answerGrounded
        sources={answer.sources}
        demoMode={false}
        safetyFindings={[]}
        copiedAnswer={false}
        pendingFeedback={null}
        onCopyAnswer={() => {}}
        onSubmitFeedback={() => {}}
      />,
    );
    return renderModel;
  }

  it.each([
    [true, "Supported", "supported"],
    [false, "Strong support", "strong"],
    [undefined, "Strong support", "strong"],
  ] as const)("strongSupportLabelCapped=%s reads %j on a high-trust answer", (capped, word, dataSupport) => {
    const renderModel = renderSurface(
      adaptiveAnswer({
        strongSupportLabelCapped: capped,
        relevance: {
          verdict: "direct",
          label: "Direct",
          matchedTerms: [],
          missingTerms: [],
          directSourceCount: 1,
          weakSourceCount: 0,
          score: 1,
          supportReason: "Direct support",
          isSourceBacked: true,
        },
      }),
    );
    expect(renderModel.trust).toBe("high");
    const chip = screen.getByTestId("answer-card-support");
    expect(chip).toHaveTextContent(`Evidence support: ${word}`);
    expect(chip).toHaveAttribute("data-support", dataSupport);
    if (capped) expect(chip).not.toHaveTextContent("Strong support");
    // Strong and supported share one tone: the label is the only thing that moves.
    expect(chip.className).toContain("text-[color:var(--clinical-accent)]");
    expect(within(screen.getByTestId("plain-answer-response")).getAllByTestId("answer-source-rail-row")).toHaveLength(
      3,
    );
  });
});
