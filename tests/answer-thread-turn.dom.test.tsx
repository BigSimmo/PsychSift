import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PriorAnswerTurnSurface, type AnswerTurn } from "@/components/clinical-dashboard/answer-thread-turn";
import { projectAnswerForMainSurface } from "@/components/clinical-dashboard/answer-section-projector";
import type { ClientRagAnswerPayload, ClientSearchResult } from "@/lib/answer-client-payload";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

const source: ClientSearchResult = {
  id: "chunk-prior",
  document_id: "doc-prior",
  title: "Prior source",
  file_name: "prior.pdf",
  page_number: 7,
  chunk_index: 0,
  section_heading: "Monitoring",
  content: "Review observations every three months.",
  image_ids: [],
  similarity: 1,
};

const sectionSource: ClientSearchResult = {
  ...source,
  id: "chunk-section-only",
  document_id: "doc-section-only",
  title: "Section-only source",
  file_name: "section-only.pdf",
  page_number: 9,
  content: "This source supports only the source-difference section.",
};

const orderedLeadSources = ["A", "B", "C", "D", "E"].map((label, index) => ({
  ...source,
  id: `chunk-prior-${label.toLowerCase()}`,
  document_id: `doc-prior-${label.toLowerCase()}`,
  title: `Prior lead source ${label}`,
  file_name: `prior-${label.toLowerCase()}.pdf`,
  page_number: index + 1,
  content: `Prior lead source ${label} synthetic content.`,
}));

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

function answer(renderAdaptiveAnswer: boolean): ClientRagAnswerPayload {
  return {
    answer: "Review the prior plan.",
    grounded: true,
    confidence: "high",
    citations: [
      {
        chunk_id: source.id,
        document_id: source.document_id,
        title: source.title,
        file_name: source.file_name,
        page_number: source.page_number,
        chunk_index: source.chunk_index,
      },
    ],
    sources: [source, sectionSource],
    bestSource: {
      chunk_id: sectionSource.id,
      document_id: sectionSource.document_id,
      title: sectionSource.title,
      file_name: sectionSource.file_name,
      page_number: sectionSource.page_number,
      chunk_index: sectionSource.chunk_index,
      source_strength: "strong",
      score: 1,
      snippet: sectionSource.content,
      section_heading: sectionSource.section_heading,
      image_count: 0,
      viewer_href: "/documents/doc-section-only?page=9&chunk=chunk-section-only",
    },
    answerContractVersion: "clinical-rag-answer-v20",
    renderAdaptiveAnswer,
    answerSections: [
      {
        heading: "Prior monitoring",
        body: "Review observations every three months.",
        kind: "monitoring_timing",
        supportLevel: "direct",
        citation_chunk_ids: [source.id],
      },
      {
        heading: "Prior source difference",
        body: "The primary and section-only synthetic sources differ.",
        kind: "source_conflict",
        supportLevel: "direct",
        citation_chunk_ids: [source.id, sectionSource.id],
      },
      {
        heading: "Prior gap",
        body: "Route: the active sources support only part of this question.",
        kind: "source_gap",
        supportLevel: "unsupported",
        citation_chunk_ids: [],
      },
    ],
  };
}

function turn(renderAdaptiveAnswer: boolean): AnswerTurn {
  return {
    id: "turn-prior",
    query: "What was required?",
    answer: answer(renderAdaptiveAnswer),
    sources: [source, sectionSource],
  };
}

describe("prior adaptive answer turn", () => {
  it("renders the complete ordered v20 answer and copies it through the canonical payload", async () => {
    const onCopy = vi.fn();
    const priorTurn = turn(true);
    const projection = projectAnswerForMainSurface({
      answer: priorTurn.answer,
      sources: priorTurn.sources,
      preformatted: false,
    });
    render(
      <PriorAnswerTurnSurface
        turn={priorTurn}
        copied={false}
        collapsed={false}
        onToggleCollapsed={() => {}}
        onCopy={onCopy}
      />,
    );

    expect(screen.getAllByText("Review the prior plan.")).toHaveLength(1);
    expect(screen.getAllByText("Review observations every three months.")).toHaveLength(1);
    expect(screen.getAllByText("Route: the active sources support only part of this question.")).toHaveLength(1);
    expect(projection.leadCitationSources.map((source) => source.id)).toEqual([source.id]);
    const leadSourceRows = screen.getAllByTestId("answer-source-rail-row");
    expect(leadSourceRows).toHaveLength(2);
    expect(leadSourceRows[0]?.tagName).toBe("A");
    expect(leadSourceRows[0]).toHaveAttribute("href", "/documents/doc-section-only?page=9&chunk=chunk-section-only");
    // This turn carries an unsupported section, so its render trust is weak and the
    // answer state is `ungrounded`: under the conservative refusal definition
    // (#Z9NS6H, owner approval 2026-09-28) the rail frames its rows as searched.
    expect(screen.getByTestId("answer-source-rail-heading")).toHaveTextContent("Documents searched");
    expect(leadSourceRows[0]).toHaveAccessibleName(/Also found: Section-only source/i);
    expect(leadSourceRows[0]).not.toHaveAccessibleName(/Direct|Partial/);
    expect(leadSourceRows[1]?.tagName).toBe("A");
    expect(leadSourceRows[1]).toHaveAttribute("href", "/documents/doc-prior?page=7&chunk=chunk-prior");
    expect(leadSourceRows[1]).toHaveAccessibleName(/Also found: Prior source/i);
    expect(
      screen.getByText("Prior source difference").closest('[data-testid="adaptive-answer-section"]'),
    ).toContainElement(screen.getByRole("button", { name: /Source \d+, Section-only source, p\. 9/i }));
    expect(screen.queryByText("No source covers this gap.")).not.toBeInTheDocument();
    expect(screen.queryByText("No source supports this statement.")).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: /^Cop(?:y|ied) with sources: answer and source status$/ }),
    );
    const copied = onCopy.mock.calls[0]?.[0] as string;
    expect(copied).toContain("Review the prior plan.\n\nPrior monitoring\n\nReview observations every three months.");
    expect(copied.indexOf("Prior monitoring")).toBeLessThan(copied.indexOf("Prior source difference"));
    expect(copied.indexOf("Prior source difference")).toBeLessThan(copied.indexOf("Prior gap"));
  });

  it("keeps v20 sections canonical for copy while final render permission is false", async () => {
    const onCopy = vi.fn();
    render(
      <PriorAnswerTurnSurface
        turn={turn(false)}
        copied={false}
        collapsed={false}
        onToggleCollapsed={() => {}}
        onCopy={onCopy}
      />,
    );
    expect(screen.queryByText("Review observations every three months.")).not.toBeInTheDocument();
    expect(screen.queryByText("No source covers this gap.")).not.toBeInTheDocument();
    expect(screen.queryByText("No source supports this statement.")).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: /^Cop(?:y|ied) with sources: answer and source status$/ }),
    );
    expect(onCopy.mock.calls[0]?.[0]).toContain("Review observations every three months.");
  });

  it("keeps low-trust prior citation order and provenance within the six-row rail cap", () => {
    const fifth = orderedLeadSources[4]!;
    const lowTrustAnswer: ClientRagAnswerPayload = {
      ...answer(true),
      confidence: "low",
      citations: orderedLeadSources.map(citation),
      sources: [...orderedLeadSources, sectionSource],
      bestSource: {
        ...citation(fifth),
        source_strength: "strong",
        score: 1,
        snippet: fifth.content,
        section_heading: fifth.section_heading,
        image_count: 0,
        viewer_href: `/documents/${fifth.document_id}?page=${fifth.page_number}&chunk=${fifth.id}`,
      },
      answerSections: [
        {
          heading: "Prior ordered lead support",
          body: "All five prior lead citations support this synthetic statement.",
          kind: "required_actions",
          supportLevel: "direct",
          citation_chunk_ids: orderedLeadSources.map((item) => item.id),
        },
        {
          heading: "Prior section-only difference",
          body: "The section-only source remains independently available.",
          kind: "source_conflict",
          supportLevel: "direct",
          citation_chunk_ids: [orderedLeadSources[0]!.id, sectionSource.id],
        },
      ],
    };
    const projection = projectAnswerForMainSurface({
      answer: lowTrustAnswer,
      sources: lowTrustAnswer.sources,
      preformatted: false,
    });
    render(
      <PriorAnswerTurnSurface
        turn={{
          id: "turn-low-trust",
          query: "Which prior sources support the lead?",
          answer: lowTrustAnswer,
          sources: lowTrustAnswer.sources,
        }}
        copied={false}
        collapsed={false}
        onToggleCollapsed={() => {}}
        onCopy={() => {}}
      />,
    );

    const sourceRows = screen.getAllByTestId("answer-source-rail-row");
    expect(sourceRows).toHaveLength(6);
    expect(projection.leadCitationSources.map((source) => source.id)).toEqual(
      orderedLeadSources.map((source) => source.id),
    );
    const wholeAnswerOrder = [orderedLeadSources[4]!, ...orderedLeadSources.slice(0, 4), sectionSource];
    expect(sourceRows.map((row) => row.getAttribute("href"))).toEqual([
      ...wholeAnswerOrder.map((item) => `/documents/${item.document_id}?page=${item.page_number}&chunk=${item.id}`),
    ]);
    sourceRows.forEach((row, index) => {
      expect(row.tagName).toBe("A");
      // Low confidence is an `ungrounded` answer state, so the conservative refusal
      // definition (#Z9NS6H) frames every row as searched; order is unchanged.
      expect(row).toHaveAccessibleName(new RegExp(`Also found: ${wholeAnswerOrder[index]!.title}`));
    });
    expect(
      screen.getByText("Prior section-only difference").closest('[data-testid="adaptive-answer-section"]'),
    ).toContainElement(screen.getByRole("button", { name: /Source \d+, Section-only source, p\. 9/i }));
  });
});

describe("collapsed prior answer turn", () => {
  it("previews the lead without literal bold markers", () => {
    const priorTurn = turn(false);
    priorTurn.answer = { ...priorTurn.answer, answer: "**Lithium** levels should be checked after a dose change." };
    render(
      <PriorAnswerTurnSurface
        turn={priorTurn}
        copied={false}
        collapsed
        onToggleCollapsed={() => {}}
        onCopy={() => {}}
      />,
    );

    expect(screen.getByText("Lithium levels should be checked after a dose change.")).toBeInTheDocument();
    expect(screen.queryByText(/\*\*/)).toBeNull();
  });
});
