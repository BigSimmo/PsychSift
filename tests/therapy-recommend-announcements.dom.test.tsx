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

  it("announces the zero-result outcome once through the shared announcer", () => {
    state.count = 0;
    render(<RecommendScreen />);
    act(() => vi.advanceTimersByTime(300));
    expect(state.announce).toHaveBeenCalledExactlyOnceWith("0 ranked matches", { eventId: "therapy-recommend-count" });
    expect(screen.getByText("No ranked matches").closest('[role="status"], [aria-live]')).toBeNull();
  });

  it("does not repeat a delivered count after an unchanged loading cycle", () => {
    const { rerender } = render(<RecommendScreen />);
    state.count = 3;
    rerender(<RecommendScreen />);
    act(() => vi.advanceTimersByTime(300));
    state.announce.mockClear();

    state.loading = true;
    rerender(<RecommendScreen />);
    state.loading = false;
    rerender(<RecommendScreen />);
    act(() => vi.advanceTimersByTime(300));
    expect(state.announce).not.toHaveBeenCalled();
  });

  it("delivers a pending count after loading interrupts its announcement", () => {
    const { rerender } = render(<RecommendScreen />);
    state.count = 3;
    rerender(<RecommendScreen />);
    act(() => vi.advanceTimersByTime(300));
    state.announce.mockClear();

    state.count = 4;
    rerender(<RecommendScreen />);
    act(() => vi.advanceTimersByTime(200));
    state.loading = true;
    rerender(<RecommendScreen />);
    act(() => vi.advanceTimersByTime(400));
    expect(state.announce).not.toHaveBeenCalled();
    state.loading = false;
    rerender(<RecommendScreen />);
    act(() => vi.advanceTimersByTime(299));
    expect(state.announce).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(state.announce).toHaveBeenCalledExactlyOnceWith("4 ranked matches", { eventId: "therapy-recommend-count" });
  });

  it("announces zero matches while the scenario editor keeps the result page inert", () => {
    const page = () => (
      <div data-testid="recommend-background">
        <RecommendScreen />
      </div>
    );
    const { rerender } = render(page());
    act(() => vi.advanceTimersByTime(300));
    state.announce.mockClear();

    fireEvent.click(screen.getByTestId("therapy-recommend-scenario-trigger"));
    const editor = screen.getByRole("dialog", { name: "Clinical scenario" });
    expect(screen.getByTestId("recommend-background").closest("[inert]")).not.toBeNull();

    state.count = 0;
    rerender(page());
    act(() => vi.advanceTimersByTime(300));

    expect(editor).toBeInTheDocument();
    expect(screen.getByText("No ranked matches").closest("[inert]")).not.toBeNull();
    expect(state.announce).toHaveBeenCalledExactlyOnceWith("0 ranked matches", { eventId: "therapy-recommend-count" });
    expect(screen.getByText("No ranked matches").closest('[role="status"], [aria-live]')).toBeNull();
    expect(editor.querySelector('[role="status"], [aria-live]')).toBeNull();
  });
});
