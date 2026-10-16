import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/work-search/lazy-work-search-sheet", () => ({
  LazyWorkSearchSheet: () => null,
  LazyWorkSearchKeys: () => null,
  prefetchWorkSearchSheet: () => {},
}));

import { WorkSearchButton } from "@/components/work-search/work-search-button";

const KEY = "psychsift:work-search-coach-seen";

/** The note shows from 1024px; below that only the ring does. */
function setViewport(desktop: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: desktop,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

describe("AI Search's one-time New note", () => {
  const originalMatchMedia = window.matchMedia;
  beforeEach(() => {
    window.localStorage.removeItem(KEY);
    setViewport(true);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.removeItem(KEY);
    window.matchMedia = originalMatchMedia;
  });

  it("goes by itself after a few seconds, and is counted as read when it goes", () => {
    render(<WorkSearchButton modeId="cme" />);
    expect(screen.getByRole("note")).toHaveTextContent("New");
    expect(window.localStorage.getItem(KEY)).toBeNull();
    act(() => {
      vi.advanceTimersByTime(7999);
    });
    expect(screen.queryByRole("note")).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByRole("note")).toBeNull();
    expect(window.localStorage.getItem(KEY)).toBe("1");
  });

  it("stays through a re-render while it is showing", () => {
    const { rerender } = render(<WorkSearchButton modeId="cme" />);
    rerender(<WorkSearchButton modeId="cme" className="x" />);
    expect(screen.getByRole("note")).toHaveTextContent("New");
  });

  it("is not used up on a phone, where only the ring shows", () => {
    setViewport(false);
    render(<WorkSearchButton modeId="cme" />);
    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("goes at the reader's first scroll", () => {
    render(<WorkSearchButton modeId="cme" />);
    act(() => {
      fireEvent.scroll(window);
    });
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("goes at the reader's first tap elsewhere on the page", () => {
    render(<WorkSearchButton modeId="cme" />);
    act(() => {
      fireEvent.pointerDown(document.body);
    });
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("never shows again once read", () => {
    window.localStorage.setItem(KEY, "1");
    render(<WorkSearchButton modeId="cme" />);
    expect(screen.queryByRole("note")).toBeNull();
  });
});
