// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/differentials/diagnoses",
}));

import { DifferentialStreamWorkspace } from "@/components/differentials/differential-stream-workspace";
import type { DifferentialStreamItem, DifferentialStreamModel } from "@/lib/differential-stream-model";
import { useVirtualWindow } from "@/lib/ui/use-virtual-window";

function makeStreamItem(index: number): DifferentialStreamItem {
  const num = index + 1;
  return {
    id: `diag-${num}`,
    slug: `diagnosis-${num}`,
    title: `Diagnosis ${num}`,
    description: `Clinical summary for diagnosis ${num}.`,
    href: `/differentials/diagnoses/diagnosis-${num}`,
    status: num % 3 === 0 ? "emergent" : num % 2 === 0 ? "urgent" : "routine",
    score: 0,
    chapterId: "all-chapter",
    chapterTitle: "All Diagnoses",
    isMatch: true,
    matchReasons: [],
    exclusionPreview: null,
    examples: [],
    candidateCount: null,
    related: [],
    relatedPathways: [],
  };
}

function makeLargeModel(count: number): DifferentialStreamModel {
  const items = Array.from({ length: count }, (_, index) => makeStreamItem(index));
  return {
    stream: "diagnoses",
    matchCount: items.length,
    items,
    chapters: [
      {
        id: "all-chapter",
        title: "All Diagnoses",
        description: "Full diagnostic list",
        itemIds: items.map((item) => item.id),
      },
    ],
    presentationChapters: [],
    presets: [],
    safetyShelfIds: [items[120]?.id ?? "diag-121"],
    compareSeedIds: [],
  };
}

function HookHarness({ totalCount, resetKey }: { readonly totalCount: number; readonly resetKey: string }) {
  const { visibleCount, hasMore, showMore, ensureIndexVisible, sentinelRef } = useVirtualWindow({
    totalCount,
    initialCount: 40,
    stepCount: 40,
    resetKey,
  });
  return (
    <div>
      <span data-testid="visible-count">{visibleCount}</span>
      <span data-testid="has-more">{String(hasMore)}</span>
      <button type="button" data-testid="show-more" onClick={showMore}>
        More
      </button>
      <button type="button" data-testid="ensure-95" onClick={() => ensureIndexVisible(95)}>
        Ensure 95
      </button>
      {hasMore ? <div ref={sentinelRef} data-testid="sentinel" /> : null}
    </div>
  );
}

describe("Progressive DOM windowing (#CFHRJY)", () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  it("caps initial count, expands on showMore/ensureIndexVisible, and resets when resetKey changes", () => {
    const { rerender } = render(<HookHarness totalCount={150} resetKey="q1" />);
    expect(screen.getByTestId("visible-count").textContent).toBe("40");
    expect(screen.getByTestId("has-more").textContent).toBe("true");

    fireEvent.click(screen.getByTestId("show-more"));
    expect(screen.getByTestId("visible-count").textContent).toBe("80");

    fireEvent.click(screen.getByTestId("ensure-95"));
    expect(Number(screen.getByTestId("visible-count").textContent)).toBeGreaterThanOrEqual(96);

    rerender(<HookHarness totalCount={150} resetKey="q2" />);
    expect(screen.getByTestId("visible-count").textContent).toBe("40");
  });

  it("limits initial DOM nodes on DifferentialStreamWorkspace for 150 items and reveals more on demand", () => {
    const model = makeLargeModel(150);
    const { container } = render(<DifferentialStreamWorkspace model={model} query="psychosis" />);

    const initialCards = container.querySelectorAll('[data-testid^="differential-stream-card-"]');
    expect(initialCards).toHaveLength(60);
    expect(initialCards[0]?.className).toContain("content-auto");

    const showMoreBtn = screen.getByTestId("differentials-stream-show-more");
    expect(showMoreBtn.textContent).toContain("90 remaining");

    act(() => {
      fireEvent.click(showMoreBtn);
    });

    const afterOneStepCards = container.querySelectorAll('[data-testid^="differential-stream-card-"]');
    expect(afterOneStepCards).toHaveLength(120);
  });

  it("expands the window automatically when initialFocus targets an item beyond the initial 60 cards", () => {
    const model = makeLargeModel(150);
    const { container } = render(
      <DifferentialStreamWorkspace model={model} query="psychosis" initialFocus="diagnosis-110" />,
    );

    const cards = container.querySelectorAll('[data-testid^="differential-stream-card-"]');
    expect(cards.length).toBeGreaterThanOrEqual(110);
    expect(screen.getByTestId("differential-stream-card-diagnosis-110")).toBeTruthy();
  });
});
