// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentSearchResultsPanel } from "@/components/clinical-dashboard/document-search-results";
import { DifferentialStreamWorkspace } from "@/components/differentials/differential-stream-workspace";
import { computeVirtualWindowRange, VirtualizedResultList } from "@/components/ui/virtualized-result-list";
import type { ClientDocumentMatch } from "@/lib/answer-client-payload";
import type { DifferentialStreamItem, DifferentialStreamModel } from "@/lib/differential-stream-model";

const navigationState = vi.hoisted(() => ({
  search: "",
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigationState.push }),
  usePathname: () => "/documents",
  useSearchParams: () => new URLSearchParams(navigationState.search),
}));

vi.mock("@/components/clinical-dashboard/use-signed-image-url", () => ({
  useSignedImageUrl: () => ({ url: null, failed: false, markFailed: vi.fn() }),
}));

vi.mock("@/components/clinical-dashboard/use-batch-signed-urls", () => ({
  useBatchSignedImageUrls: () => {},
}));

function makeDocumentMatch(index: number): ClientDocumentMatch {
  const num = index + 1;
  return {
    document_id: `doc-${num}`,
    title: `Clinical Guideline Document ${num}`,
    file_name: `clinical-guideline-${num}.pdf`,
    labels: [],
    summarySnippet: `Summary preview for guideline ${num}`,
    bestPages: [1],
    bestChunkIds: [`chunk-${num}`],
    imageCount: 0,
    tableCount: 0,
    matchReason: "Matched indexed passage",
    score: 0.9,
  };
}

function makeDifferentialItem(index: number): DifferentialStreamItem {
  const num = index + 1;
  return {
    id: `diagnosis:${num}`,
    slug: `diagnosis-${num}`,
    title: `Differential Diagnosis ${num}`,
    description: `Diagnostic summary ${num}`,
    examples: [`Example ${num}`],
    href: `/differentials/diagnosis-${num}`,
    status: index % 3 === 0 ? "emergent" : index % 3 === 1 ? "urgent" : "routine",
    matchReasons: ["title"],
    isMatch: true,
    score: 100 - (index % 50),
    related: [],
    relatedPathways: [],
    candidateCount: 2,
    exclusionPreview: `Key distinguishing clinical features for diagnosis ${num}.`,
    chapterId: "all-diagnoses",
    chapterTitle: "All diagnoses",
  };
}

describe("VirtualizedResultList and search result virtualization (#CFHRJY)", () => {
  beforeEach(() => {
    navigationState.search = "";
    navigationState.push.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders lists of <= 30 items directly without windowing overhead", () => {
    const items = Array.from({ length: 30 }, (_, index) => ({
      id: `item-${index + 1}`,
      label: `Result row ${index + 1}`,
    }));

    render(
      <VirtualizedResultList
        items={items}
        getItemKey={(item) => item.id}
        testId="small-result-list"
        className="grid gap-2"
        renderItem={(item) => (
          <article data-testid="small-result-row">
            <a href={`#${item.id}`}>{item.label}</a>
          </article>
        )}
      />,
    );

    const container = screen.getByTestId("small-result-list");
    expect(container.getAttribute("data-virtualized")).toBe("false");
    expect(screen.getAllByTestId("small-result-row")).toHaveLength(30);
    expect(screen.queryByTestId("virtualized-list-top-spacer")).toBeNull();
    expect(screen.queryByTestId("virtualized-list-bottom-spacer")).toBeNull();
    expect(screen.queryByTestId("virtualized-result-item")).toBeNull();
  });

  it("virtualizes lists of 120 items by mounting only the active window + overscan with aria-setsize and aria-posinset", () => {
    const items = Array.from({ length: 120 }, (_, index) => ({
      id: `item-${index + 1}`,
      label: `Result row ${index + 1}`,
    }));

    render(
      <VirtualizedResultList
        items={items}
        getItemKey={(item) => item.id}
        testId="large-result-list"
        ariaLabel="Search results"
        estimatedItemHeight={180}
        viewportHeight={720}
        overscan={4}
        renderItem={(item) => (
          <article data-testid={`result-card-${item.id}`}>
            <a href={`#${item.id}`}>{item.label}</a>
          </article>
        )}
      />,
    );

    const container = screen.getByTestId("large-result-list");
    expect(container.getAttribute("data-virtualized")).toBe("true");
    expect(container.getAttribute("data-total-count")).toBe("120");

    const renderedItems = screen.getAllByTestId("virtualized-result-item");
    expect(renderedItems.length).toBeGreaterThan(0);
    expect(renderedItems.length).toBeLessThan(30);

    const firstItem = renderedItems[0]!;
    expect(firstItem.getAttribute("role")).toBe("listitem");
    expect(firstItem.getAttribute("aria-setsize")).toBe("120");
    expect(firstItem.getAttribute("aria-posinset")).toBe("1");

    const lastRendered = renderedItems[renderedItems.length - 1]!;
    expect(lastRendered.getAttribute("aria-setsize")).toBe("120");
    expect(lastRendered.getAttribute("aria-posinset")).toBe(String(renderedItems.length));

    expect(screen.queryByTestId("result-card-item-1")).not.toBeNull();
    expect(screen.queryByTestId("result-card-item-120")).toBeNull();
    expect(screen.queryByTestId("virtualized-list-bottom-spacer")).not.toBeNull();
  });

  it("updates the rendered window when scrolling and when advancing keyboard focus", () => {
    const items = Array.from({ length: 120 }, (_, index) => ({
      id: `item-${index + 1}`,
      label: `Result row ${index + 1}`,
    }));

    render(
      <VirtualizedResultList
        items={items}
        getItemKey={(item) => item.id}
        testId="interactive-result-list"
        ariaLabel="Search results"
        estimatedItemHeight={180}
        viewportHeight={720}
        overscan={4}
        renderItem={(item) => (
          <article data-testid={`result-card-${item.id}`}>
            <a href={`#${item.id}`}>{item.label}</a>
          </article>
        )}
      />,
    );

    const container = screen.getByTestId("interactive-result-list");

    // 1. Scroll down to the middle of the 120-item list (row ~50 -> 50 * 180 = 9000px)
    Object.defineProperty(container, "scrollTop", {
      value: 9000,
      writable: true,
      configurable: true,
    });
    fireEvent.scroll(container, { target: { scrollTop: 9000 } });

    expect(screen.queryByTestId("result-card-item-1")).toBeNull();
    const midCard = screen.getByTestId("result-card-item-51");
    const midWrapper = midCard.closest("[data-virtual-index]")!;
    expect(midWrapper.getAttribute("aria-setsize")).toBe("120");
    expect(midWrapper.getAttribute("aria-posinset")).toBe("51");
    expect(screen.getByTestId("virtualized-list-top-spacer")).not.toBeNull();
    expect(screen.getByTestId("virtualized-list-bottom-spacer")).not.toBeNull();

    // 2. Advance keyboard focus to the end via End key, then step with ArrowUp
    const midLink = within(midCard).getByRole("link");
    midLink.focus();
    fireEvent.keyDown(midLink, { key: "End" });

    const lastCard = screen.getByTestId("result-card-item-120");
    const lastWrapper = lastCard.closest("[data-virtual-index]")!;
    expect(lastWrapper.getAttribute("aria-setsize")).toBe("120");
    expect(lastWrapper.getAttribute("aria-posinset")).toBe("120");
    expect(document.activeElement).toBe(within(lastCard).getByRole("link"));

    fireEvent.keyDown(within(lastCard).getByRole("link"), { key: "ArrowUp" });
    const prevCard = screen.getByTestId("result-card-item-119");
    expect(document.activeElement).toBe(within(prevCard).getByRole("link"));
  });

  it("guards computeVirtualWindowRange against NaN inputs", () => {
    const range = computeVirtualWindowRange({
      totalItems: 120,
      scrollTop: Number.NaN,
      viewportHeight: Number.NaN,
      estimatedItemHeight: Number.NaN,
      overscanRows: Number.NaN,
      columns: Number.NaN,
    });

    expect(Number.isFinite(range.startIndex)).toBe(true);
    expect(Number.isFinite(range.endIndex)).toBe(true);
    expect(Number.isFinite(range.topSpacerHeight)).toBe(true);
    expect(Number.isFinite(range.bottomSpacerHeight)).toBe(true);
    expect(range.startIndex).toBe(0);
    expect(range.endIndex).toBeGreaterThan(0);
    expect(range.endIndex).toBeLessThan(30);
  });

  it("virtualizes DocumentSearchResultsPanel when > 30 documents match", () => {
    const matches = Array.from({ length: 120 }, (_, index) => makeDocumentMatch(index));

    render(
      <DocumentSearchResultsPanel
        matches={matches}
        query="guideline"
        loading={false}
        documentCount={120}
        realDataReady
        authUnavailable={false}
        apiUnavailable={false}
        setupWarning={null}
        onScopeDocument={vi.fn()}
        onAnswerFromDocument={vi.fn()}
        onOpenRecentDocuments={vi.fn()}
        onOpenLibrary={vi.fn()}
        onOpenSourcePdf={vi.fn()}
        onTagSearch={vi.fn()}
      />,
    );

    const virtualList = screen.getByTestId("document-results-virtualized-list");
    expect(virtualList.getAttribute("data-virtualized")).toBe("true");

    const renderedCards = screen.getAllByTestId("document-result-card");
    expect(renderedCards.length).toBeGreaterThan(0);
    expect(renderedCards.length).toBeLessThan(30);

    const listItems = screen.getAllByTestId("virtualized-result-item");
    expect(listItems[0]?.getAttribute("aria-setsize")).toBe("120");
    expect(listItems[0]?.getAttribute("aria-posinset")).toBe("1");
  });

  it("virtualizes DifferentialStreamWorkspace when > 30 stream items are rendered in a flat query view", () => {
    navigationState.search = "q=diagnosis";
    const items = Array.from({ length: 120 }, (_, index) => makeDifferentialItem(index));
    const model: DifferentialStreamModel = {
      stream: "diagnoses",
      items,
      matchCount: items.length,
      presets: [],
      chapters: [
        {
          id: "all-diagnoses",
          title: "All diagnoses",
          description: "Complete diagnoses catalogue",
          itemIds: items.map((item) => item.id),
        },
      ],
      presentationChapters: [],
      safetyShelfIds: [],
      compareSeedIds: [],
    };

    render(<DifferentialStreamWorkspace model={model} query="diagnosis" />);

    const renderedCards = screen.getAllByTestId(/^differential-stream-card-/);
    expect(renderedCards.length).toBeGreaterThan(0);
    expect(renderedCards.length).toBeLessThan(40);

    const listItems = screen.getAllByTestId("virtualized-result-item");
    expect(listItems[0]?.getAttribute("aria-setsize")).toBe("120");
    expect(listItems[0]?.getAttribute("aria-posinset")).toBe("1");
  });
});
