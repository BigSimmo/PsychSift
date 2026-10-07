/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NeedsYouButton } from "@/components/needs-you/needs-you-button";

const nav = vi.hoisted(() => ({ pathname: "/my-day" }));
const auth = vi.hoisted(() => ({ status: "authenticated" }));
const centre = vi.hoisted(() => ({
  summary: null as { count: number; overdue: number } | null,
  opened: [] as boolean[],
}));
const launch = vi.hoisted(() => ({ newWorkMode: false }));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
}));

vi.mock("@/lib/supabase/client", () => ({
  useAuthSession: () => auth,
}));

vi.mock("@/components/work-mode-launch/work-mode-launch-provider", () => ({
  useNewWorkMode: () => launch.newWorkMode,
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
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
  centre.opened.push(open);
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
  centre.opened = [];
  launch.newWorkMode = false;
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

  // Josh, 7 Oct 2026: the bell shows on every staff work page, not only the homes.
  it("shows on inner work pages too, such as On Call contacts and Roster team", () => {
    nav.pathname = "/on-call/contacts";
    const { unmount } = render(<NeedsYouButton modeId="on-call" />);
    expect(screen.getByTestId("needs-you-bell")).toBeTruthy();
    unmount();
    nav.pathname = "/roster/team";
    render(<NeedsYouButton modeId="roster" />);
    expect(screen.getByTestId("needs-you-bell")).toBeTruthy();
  });

  it("hides in the setup walkthrough, the help centre, and clinical modes", () => {
    nav.pathname = "/my-day/setup";
    const first = render(<NeedsYouButton modeId="my-day" />);
    expect(screen.queryByTestId("needs-you-bell")).toBeNull();
    first.unmount();
    nav.pathname = "/my-day/help";
    const second = render(<NeedsYouButton modeId="my-day" />);
    expect(screen.queryByTestId("needs-you-bell")).toBeNull();
    second.unmount();
    nav.pathname = "/psychiatry";
    render(<NeedsYouButton modeId="psychiatry" />);
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
    nav.pathname = "/roster";
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
    nav.pathname = "/cme";
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

  describe("in the new work mode", () => {
    it("goes to the Notifications page instead of opening the sheet, with the same name and badge", () => {
      launch.newWorkMode = true;
      centre.summary = { count: 4, overdue: 0 };
      nav.pathname = "/roster/team";
      render(<NeedsYouButton modeId="roster" />);
      const bell = screen.getByTestId("needs-you-bell");
      expect(bell.tagName).toBe("A");
      expect(bell.getAttribute("href")).toBe("/my-day/notifications");
      expect(bell.className).toMatch(/min-h-12/);
      expect(bell.getAttribute("aria-haspopup")).toBeNull();
      act(() => {
        fireEvent.pointerEnter(bell);
      });
      expect(screen.getByTestId("needs-you-badge").textContent).toBe("4");
      expect(bell.getAttribute("aria-label")).toBe("Notifications, 4 need you");
      // jsdom cannot follow a link, so the test stops the browser's own navigation.
      bell.addEventListener("click", (event) => event.preventDefault());
      fireEvent.click(bell);
      expect(screen.queryByTestId("needs-you-sheet-stub")).toBeNull();
      // The centre is mounted only to read the count: it is never drawn open.
      expect(centre.opened.length).toBeGreaterThan(0);
      expect(centre.opened.every((open) => !open)).toBe(true);
    });

    it("still reads the count once the header is idle, so the badge matches the page", () => {
      vi.useFakeTimers();
      try {
        launch.newWorkMode = true;
        centre.summary = { count: 12, overdue: 2 };
        render(<NeedsYouButton modeId="my-day" />);
        act(() => {
          vi.advanceTimersByTime(5000);
        });
        const badge = screen.getByTestId("needs-you-badge");
        expect(badge.textContent).toBe("9+");
        expect(badge.getAttribute("data-tone")).toBe("red");
      } finally {
        vi.useRealTimers();
      }
    });

    it("on the Notifications page shows as the current page, tinted, with no count and no link to itself", () => {
      vi.useFakeTimers();
      try {
        launch.newWorkMode = true;
        centre.summary = { count: 3, overdue: 1 };
        for (const path of ["/my-day/notifications", "/my-day/notifications/earlier"]) {
          nav.pathname = path;
          const { unmount } = render(<NeedsYouButton modeId="my-day" />);
          act(() => {
            vi.advanceTimersByTime(5000);
          });
          const bell = screen.getByTestId("needs-you-bell");
          expect(bell.tagName).toBe("SPAN");
          expect(bell.getAttribute("aria-current")).toBe("page");
          expect(bell.getAttribute("href")).toBeNull();
          expect(bell.textContent).toBe("Notifications");
          expect(bell.className).toMatch(/min-h-12/);
          expect(screen.queryByTestId("needs-you-badge")).toBeNull();
          expect(screen.queryByRole("link")).toBeNull();
          expect(screen.queryByRole("button")).toBeNull();
          unmount();
        }
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("in the classic work mode, the Notifications path is not treated as the current page", () => {
    nav.pathname = "/my-day/notifications";
    render(<NeedsYouButton modeId="my-day" />);
    expect(screen.getByTestId("needs-you-bell").tagName).toBe("BUTTON");
  });
});
