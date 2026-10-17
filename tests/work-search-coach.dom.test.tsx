import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/work-search/lazy-work-search-sheet", () => ({
  LazyWorkSearchSheet: ({ open, onClose }: { open: boolean; onClose: (navigated?: boolean) => void }) =>
    open ? <button onClick={() => onClose(false)}>Close search</button> : null,
  LazyWorkSearchKeys: ({ open }: { open: boolean }) => (open ? <p>Keyboard shortcuts</p> : null),
  prefetchWorkSearchSheet: () => {},
}));

import { WorkSearchButton } from "@/components/work-search/work-search-button";

const KEY = "psychsift:work-search-coach-seen";

describe("AI Search discovery without automatic coaching", () => {
  beforeEach(() => {
    window.localStorage.removeItem(KEY);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.removeItem(KEY);
  });

  it("never introduces a timed note or promotional halo on a first visit", () => {
    render(<WorkSearchButton modeId="cme" />);
    const button = screen.getByRole("button", { name: "AI Search" });
    expect(screen.queryByRole("note")).toBeNull();
    expect(button.parentElement).not.toHaveClass("ring-4");
    act(() => vi.advanceTimersByTime(8000));
    expect(screen.queryByRole("note")).toBeNull();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("keeps the labelled control and real focus outline through a re-render", () => {
    const { rerender } = render(<WorkSearchButton modeId="cme" />);
    rerender(<WorkSearchButton modeId="cme" className="x" />);
    const button = screen.getByRole("button", { name: "AI Search" });
    expect(button).toHaveClass("focus-visible:outline-2");
    expect(button).toHaveAttribute("aria-keyshortcuts", "/ Control+k Meta+k");
    expect(button).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("opens by click and returns focus when the search closes", () => {
    render(<WorkSearchButton modeId="cme" />);
    const button = screen.getByRole("button", { name: "AI Search" });
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "Close search" }));
    act(() => vi.advanceTimersByTime(20));
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveFocus();
  });

  it.each([{ key: "/" }, { key: "k", ctrlKey: true }, { key: "k", metaKey: true }])(
    "preserves the search shortcut $key",
    (shortcut) => {
      render(<WorkSearchButton modeId="cme" />);
      fireEvent.keyDown(window, shortcut);
      expect(screen.getByRole("button", { name: "AI Search" })).toHaveAttribute("aria-expanded", "true");
    },
  );

  it("keeps keyboard help available on request", () => {
    render(<WorkSearchButton modeId="cme" />);
    fireEvent.keyDown(window, { key: "?" });
    expect(screen.getByText("Keyboard shortcuts")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "AI Search" })).toHaveAttribute("aria-expanded", "false");
  });

  it("leaves shortcuts with a text field or another dialog", () => {
    render(
      <>
        <WorkSearchButton modeId="cme" />
        <input aria-label="Page field" />
      </>,
    );
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "/" });
    expect(screen.getByRole("button", { name: "AI Search" })).toHaveAttribute("aria-expanded", "false");
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    document.body.append(dialog);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByRole("button", { name: "AI Search" })).toHaveAttribute("aria-expanded", "false");
    dialog.remove();
  });

  it("does not revive old coaching state when the legacy flag exists", () => {
    window.localStorage.setItem(KEY, "1");
    render(<WorkSearchButton modeId="cme" />);
    expect(screen.queryByRole("note")).toBeNull();
    expect(screen.getByRole("button", { name: "AI Search" })).toHaveAccessibleName("AI Search");
  });
});
