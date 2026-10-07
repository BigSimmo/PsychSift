/** @vitest-environment jsdom */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/on-call",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const { NowShiftShortcuts, ON_CALL_LOG_A_CALL_HASH } = await import("@/components/on-call/now/shift-shortcuts");

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/on-call");
});

// Log a call and Handover on On Call Now (work-mode redesign, owner request 6 Oct 2026).
describe("NowShiftShortcuts", () => {
  it("sits in one flat card with Log a call and Handover", () => {
    render(<NowShiftShortcuts />);
    const card = screen.getByTestId("on-call-now-shortcuts");
    expect(card.className).toMatch(/\bwork-card\b/);
    expect(screen.getByTestId("on-call-now-log-a-call")).toHaveTextContent("Log a call");
    expect(screen.getByTestId("on-call-home-handover")).toHaveAttribute("href", "/on-call/handover");
  });

  it("opens Log a call when the page arrives with #log-a-call", () => {
    window.history.replaceState(null, "", `/on-call${ON_CALL_LOG_A_CALL_HASH}`);
    render(<NowShiftShortcuts />);
    expect(screen.getByTestId("on-call-now-log-a-call-sheet")).toBeInTheDocument();
  });

  it("opens Log a call when #log-a-call arrives while Now is already open", () => {
    render(<NowShiftShortcuts />);
    expect(screen.queryByTestId("on-call-now-log-a-call-sheet")).toBeNull();
    act(() => {
      window.history.replaceState(null, "", `/on-call${ON_CALL_LOG_A_CALL_HASH}`);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(screen.getByTestId("on-call-now-log-a-call-sheet")).toBeInTheDocument();
  });
});
