/** @vitest-environment jsdom */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  loading: false,
  count: 2,
  announce: vi.fn(),
}));

vi.mock("@/components/ui/live-announcer", () => ({ announce: state.announce }));
vi.mock("@/components/therapy-compass/bindings", () => ({
  useTcBindings: () => ({
    loading: state.loading,
    recommendations: Array.from({ length: state.count }, (_, index) => ({
      therapy: { slug: `synthetic-${index}`, name: `Synthetic therapy ${index}` },
      reasons: [],
    })),
    recQuery: "Synthetic scenario",
    setRecQuery: vi.fn(),
    isConstraintActive: () => false,
    isConstraintInferred: () => false,
    toggleConstraint: vi.fn(),
    goSearch: vi.fn(),
  }),
}));
vi.mock("@/components/therapy-compass/recommend-scenario-fields", () => ({
  RecommendScenarioFields: () => null,
}));
vi.mock("@/components/therapy-compass/therapy-card", () => ({
  CompactResultRow: () => <li>Synthetic ranked result</li>,
}));
vi.mock("@/components/therapy-compass/use-clipboard", () => ({
  useClipboard: () => ({ copied: null, copy: vi.fn() }),
}));

import { RecommendScreen } from "@/components/therapy-compass/screens/recommend-screen";

beforeEach(() => {
  vi.useFakeTimers();
  state.loading = false;
  state.count = 2;
  state.announce.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Therapy recommendation announcements", () => {
  it("announces one count while both the results and scenario sheet show it", () => {
    const { rerender } = render(<RecommendScreen />);
    act(() => vi.advanceTimersByTime(300));
    expect(state.announce).toHaveBeenCalledExactlyOnceWith("2 ranked matches", { eventId: "therapy-recommend-count" });

    fireEvent.click(screen.getByTestId("therapy-recommend-scenario-trigger"));
    state.count = 3;
    rerender(<RecommendScreen />);
    act(() => vi.advanceTimersByTime(299));
    expect(state.announce).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(1));
    expect(state.announce).toHaveBeenCalledTimes(2);
    expect(state.announce).toHaveBeenLastCalledWith("3 ranked matches", { eventId: "therapy-recommend-count" });
    expect(screen.getAllByText("3 ranked matches")).toHaveLength(2);
    expect(document.querySelectorAll('[aria-live="polite"]')).toHaveLength(0);
  });

  it("coalesces rapid ranking updates and cancels an announcement when leaving", () => {
    const { rerender, unmount } = render(<RecommendScreen />);
    state.count = 3;
    rerender(<RecommendScreen />);
    act(() => vi.advanceTimersByTime(200));
    state.count = 4;
    rerender(<RecommendScreen />);
    act(() => vi.advanceTimersByTime(300));
    expect(state.announce).toHaveBeenCalledExactlyOnceWith("4 ranked matches", { eventId: "therapy-recommend-count" });
    state.count = 5;
    rerender(<RecommendScreen />);
    unmount();
    act(() => vi.advanceTimersByTime(300));
    expect(state.announce).toHaveBeenCalledTimes(1);
  });

  it("leaves the zero-result outcome to its empty-state announcement", () => {
    state.count = 0;
    render(<RecommendScreen />);
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByRole("status")).toHaveTextContent("No ranked matches");
    expect(state.announce).not.toHaveBeenCalled();
  });
});
