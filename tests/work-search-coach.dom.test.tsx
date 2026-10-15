import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/work-search/lazy-work-search-sheet", () => ({
  LazyWorkSearchSheet: () => null,
  LazyWorkSearchKeys: () => null,
  prefetchWorkSearchSheet: () => {},
}));

import { WorkSearchButton } from "@/components/work-search/work-search-button";

const KEY = "psychsift:work-search-coach-seen";

describe("AI Search's one-time New note", () => {
  beforeEach(() => {
    window.localStorage.removeItem(KEY);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.removeItem(KEY);
  });

  it("is counted as read as soon as it shows, then goes by itself after a few seconds", () => {
    render(<WorkSearchButton modeId="cme" />);
    expect(screen.getByRole("note")).toHaveTextContent("New");
    expect(window.localStorage.getItem(KEY)).toBe("1");
    act(() => {
      vi.advanceTimersByTime(7999);
    });
    expect(screen.queryByRole("note")).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByRole("note")).toBeNull();
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
