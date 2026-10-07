/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NeedsYouButton } from "@/components/needs-you/needs-you-button";

const nav = vi.hoisted(() => ({ pathname: "/my-day" }));
const auth = vi.hoisted(() => ({ status: "authenticated" }));
const centre = vi.hoisted(() => ({ summary: null as { count: number; overdue: number } | null }));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
}));

vi.mock("@/lib/supabase/client", () => ({
  useAuthSession: () => auth,
}));

// Work-mode redesign, owner request 6 Oct 2026: the bell mounts the Notification
// centre (which reads the feed and reports the badge count) instead of a bare sheet.
function CentreStub({
  open,
  onSummary,
}: {
  open: boolean;
  onSummary: (summary: { count: number; overdue: number } | null) => void;
}) {
  useEffect(() => onSummary(centre.summary), [onSummary]);
  return open ? <div data-testid="needs-you-sheet-stub">Notifications</div> : null;
}

vi.mock("@/components/needs-you/lazy-needs-you-sheet", () => ({
  prefetchNeedsYouSheet: () => undefined,
  LazyNotificationCentre: CentreStub,
}));

afterEach(() => {
  cleanup();
  nav.pathname = "/my-day";
  auth.status = "authenticated";
  centre.summary = null;
});

describe("Needs you header bell", () => {
  // Work-mode redesign, owner request 6 Oct 2026: the bell opens the Notification
  // centre, so its name is "Notifications" (with the count once known).
  it("opens the sheet from a 48px control labelled Notifications", () => {
    render(<NeedsYouButton modeId="my-day" />);
    const bell = screen.getByTestId("needs-you-bell");
    expect(bell.getAttribute("aria-label")).toBe("Notifications");
    expect(bell.className).toMatch(/min-h-12/);
    fireEvent.click(bell);
    expect(screen.getByTestId("needs-you-sheet-stub")).toBeTruthy();
  });

  it("hides when signed out", () => {
    auth.status = "signed_out";
    render(<NeedsYouButton modeId="my-day" />);
    expect(screen.queryByTestId("needs-you-bell")).toBeNull();
  });

  it("hides on an inner On Call page so the row is not three round buttons", () => {
    nav.pathname = "/on-call/contacts";
    render(<NeedsYouButton modeId="on-call" />);
    expect(screen.queryByTestId("needs-you-bell")).toBeNull();
  });

  it("shows on On Call home and Who's on", () => {
    nav.pathname = "/on-call";
    const { unmount } = render(<NeedsYouButton modeId="on-call" />);
    expect(screen.getByTestId("needs-you-bell")).toBeTruthy();
    unmount();
    nav.pathname = "/on-call/whos-on";
    render(<NeedsYouButton modeId="on-call" />);
    expect(screen.getByTestId("needs-you-bell")).toBeTruthy();
  });

  it("shows the centre's count as a badge, red when something is overdue, and says it in words", () => {
    centre.summary = { count: 3, overdue: 1 };
    render(<NeedsYouButton modeId="roster" />);
    expect(screen.queryByTestId("needs-you-badge")).toBeNull();
    const bell = screen.getByTestId("needs-you-bell");
    act(() => {
      fireEvent.pointerEnter(bell);
    });
    const badge = screen.getByTestId("needs-you-badge");
    expect(badge.textContent).toBe("3");
    expect(badge.getAttribute("data-tone")).toBe("red");
    expect(badge.getAttribute("aria-hidden")).toBe("true");
    expect(bell.getAttribute("aria-label")).toBe("Notifications, 3 need you, 1 overdue");
  });

  it("caps the badge at 9+ and hides it at zero", () => {
    centre.summary = { count: 14, overdue: 0 };
    const { unmount } = render(<NeedsYouButton modeId="cme" />);
    act(() => {
      fireEvent.focus(screen.getByTestId("needs-you-bell"));
    });
    expect(screen.getByTestId("needs-you-badge").textContent).toBe("9+");
    expect(screen.getByTestId("needs-you-badge").getAttribute("data-tone")).toBeNull();
    unmount();
    centre.summary = { count: 0, overdue: 0 };
    render(<NeedsYouButton modeId="cme" />);
    act(() => {
      fireEvent.focus(screen.getByTestId("needs-you-bell"));
    });
    expect(screen.queryByTestId("needs-you-badge")).toBeNull();
    expect(screen.getByTestId("needs-you-bell").getAttribute("aria-label")).toBe("Notifications");
  });

  it("arms the centre on its own once the header is idle, so the badge appears without a tap", () => {
    vi.useFakeTimers();
    try {
      centre.summary = { count: 2, overdue: 0 };
      render(<NeedsYouButton modeId="my-day" />);
      expect(screen.queryByTestId("needs-you-badge")).toBeNull();
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(screen.getByTestId("needs-you-badge").textContent).toBe("2");
    } finally {
      vi.useRealTimers();
    }
  });
});
