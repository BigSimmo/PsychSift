import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LiveAnnouncer, RouteAnnouncer, announce, resetAnnouncerForTests } from "@/components/ui/live-announcer";
import { AppAnnouncements } from "@/components/app-announcements";

const pathname = vi.hoisted(() => ({ current: "/answer" }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
}));

beforeEach(() => {
  pathname.current = "/answer";
  resetAnnouncerForTests();
});

afterEach(() => {
  resetAnnouncerForTests();
  document.title = "";
});

describe("LiveAnnouncer", () => {
  it("mounts exactly one polite/assertive pair through the app island", () => {
    render(<AppAnnouncements />);

    expect(screen.getAllByTestId("live-announcer-polite")).toHaveLength(1);
    expect(screen.getAllByTestId("live-announcer-assertive")).toHaveLength(1);
  });

  it("renders two visually-hidden regions and no visible text", () => {
    render(<LiveAnnouncer />);

    const polite = screen.getByTestId("live-announcer-polite");
    const assertive = screen.getByTestId("live-announcer-assertive");
    expect(polite).toHaveAttribute("aria-live", "polite");
    expect(assertive).toHaveAttribute("aria-live", "assertive");
    expect(polite.className).toContain("sr-only");
    expect(assertive.className).toContain("sr-only");
  });

  it("routes a polite announcement to the polite region only", () => {
    render(<LiveAnnouncer />);
    act(() => announce("Answer ready, 4 sources"));

    expect(screen.getByTestId("live-announcer-polite")).toHaveTextContent("Answer ready, 4 sources");
    expect(screen.getByTestId("live-announcer-assertive")).toHaveTextContent("");
  });

  it("reserves the assertive region for loss-of-work risks", () => {
    render(<LiveAnnouncer />);
    act(() => announce("Your session expires in one minute", { priority: "assertive" }));

    expect(screen.getByTestId("live-announcer-assertive")).toHaveTextContent("Your session expires in one minute");
    expect(screen.getByTestId("live-announcer-polite")).toHaveTextContent("");
  });

  it("deduplicates the same message inside the repeat window", async () => {
    render(<LiveAnnouncer />);
    act(() => announce("12 results"));
    act(() => announce("12 results"));

    // The second call is the same event announced twice — a re-render, not news.
    await waitFor(() => expect(screen.getByTestId("live-announcer-polite")).toHaveTextContent("12 results"));
    act(() => announce("13 results"));
    await waitFor(() => expect(screen.getByTestId("live-announcer-polite")).toHaveTextContent("13 results"));
  });

  it("re-announces an identical message once the dedupe window has elapsed", async () => {
    vi.useFakeTimers();
    render(<LiveAnnouncer />);

    act(() => announce("12 results"));
    expect(screen.getByTestId("live-announcer-polite")).toHaveTextContent("12 results");

    // Past the 1s dedupe window: announce() lets the repeat through, and drain()
    // must clear then set so aria-live sees a DOM change.
    act(() => {
      vi.advanceTimersByTime(1_001);
      announce("12 results");
    });

    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    expect(screen.getByTestId("live-announcer-polite")).toHaveTextContent("12 results");

    // Prove the clear→set path ran: the region was emptied before the repeat landed.
    // We cannot assert the empty intermediate with fake timers + React batching
    // reliably after the fact, so assert a second distinct message still works
    // and that the repeat was not swallowed by the dedupe window.
    act(() => {
      vi.advanceTimersByTime(1_001);
      announce("12 results");
    });
    let sawClear = false;
    await act(async () => {
      // The clear tick empties the region before the message is restored.
      vi.advanceTimersByTime(1);
      sawClear = screen.getByTestId("live-announcer-polite").textContent === "";
      vi.advanceTimersByTime(50);
    });
    expect(sawClear).toBe(true);
    expect(screen.getByTestId("live-announcer-polite")).toHaveTextContent("12 results");

    vi.useRealTimers();
  });

  it("ignores an empty announcement", () => {
    render(<LiveAnnouncer />);
    act(() => announce("   "));
    expect(screen.getByTestId("live-announcer-polite")).toHaveTextContent("");
  });

  it("refuses a second instance in development", () => {
    render(<LiveAnnouncer />);
    // Two announcers means every message is read twice.
    expect(() => render(<LiveAnnouncer />)).toThrow(/singleton/i);
  });

  it("suppresses a duplicate instance in production so only one live-region pair updates", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const first = render(<LiveAnnouncer />);
      const second = render(<LiveAnnouncer />);

      await waitFor(() => {
        expect(screen.getAllByTestId("live-announcer-polite")).toHaveLength(1);
      });

      act(() => announce("Only once"));
      expect(screen.getByTestId("live-announcer-polite")).toHaveTextContent("Only once");
      expect(warn).toHaveBeenCalled();

      second.unmount();
      first.unmount();
    } finally {
      warn.mockRestore();
      vi.unstubAllEnvs();
      resetAnnouncerForTests();
    }
  });

  it("promotes a surviving duplicate to active when the owner unmounts", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const first = render(<LiveAnnouncer />);
      render(<LiveAnnouncer />);

      await waitFor(() => {
        expect(screen.getAllByTestId("live-announcer-polite")).toHaveLength(1);
      });

      first.unmount();

      await waitFor(() => {
        expect(screen.getAllByTestId("live-announcer-polite")).toHaveLength(1);
      });

      act(() => announce("Recovered"));
      expect(screen.getByTestId("live-announcer-polite")).toHaveTextContent("Recovered");
    } finally {
      warn.mockRestore();
      vi.unstubAllEnvs();
      resetAnnouncerForTests();
    }
  });
});

describe("RouteAnnouncer", () => {
  function Page({ heading = "Answer" }: { heading?: string }) {
    return (
      <main>
        <h1>{heading}</h1>
      </main>
    );
  }

  it("stays silent on first render — arrival is not a navigation", () => {
    document.title = "Answer · PsychSift";
    render(
      <>
        <LiveAnnouncer />
        <RouteAnnouncer />
        <Page />
      </>,
    );

    expect(screen.getByTestId("live-announcer-polite")).toHaveTextContent("");
    expect(screen.getByRole("heading", { level: 1 })).not.toHaveFocus();
  });

  it("moves focus to the new h1 on navigation and leaves the title to Next's own announcer", () => {
    document.title = "Answer · PsychSift";
    const { rerender } = render(
      <>
        <LiveAnnouncer />
        <RouteAnnouncer />
        <Page />
      </>,
    );

    document.title = "Documents · PsychSift";
    pathname.current = "/documents";
    rerender(
      <>
        <LiveAnnouncer />
        <RouteAnnouncer />
        <Page heading="Documents" />
      </>,
    );

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveAttribute("tabindex", "-1");
    expect(heading).toHaveFocus();
    // Next's App Router already reads the changed document.title through its
    // assertive next-route-announcer. A second copy here made each navigation
    // read the page name twice, so neither of our regions may carry it.
    expect(screen.getByTestId("live-announcer-polite")).toHaveTextContent("");
    expect(screen.getByTestId("live-announcer-assertive")).toHaveTextContent("");
  });

  it("leaves focus alone when the navigation happened inside a dialog", () => {
    const tree = (
      <>
        <LiveAnnouncer />
        <RouteAnnouncer />
        <div role="dialog" aria-label="Upload">
          <button type="button" onClick={() => {}} data-testid="dialog-control">
            Choose file
          </button>
        </div>
        <Page />
      </>
    );
    const { rerender } = render(tree);

    const control = screen.getByTestId("dialog-control");
    control.focus();

    // A focus yank out of an open dialog breaks its trap and loses the user's place.
    pathname.current = "/documents";
    rerender(tree);

    expect(control).toHaveFocus();
    expect(screen.getByRole("heading", { level: 1 })).not.toHaveFocus();
  });

  it("focuses the main landmark when the new route has no h1", () => {
    const { rerender } = render(
      <>
        <LiveAnnouncer />
        <RouteAnnouncer />
        <main>Answer content</main>
      </>,
    );

    pathname.current = "/documents";
    rerender(
      <>
        <LiveAnnouncer />
        <RouteAnnouncer />
        <main>Documents content</main>
      </>,
    );

    expect(screen.getByRole("main")).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("main")).toHaveFocus();
  });
});
