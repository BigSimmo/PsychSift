/** @vitest-environment jsdom */

import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
let pathname = "/";
let roster: {
  status: "loading" | "ready" | "signed-out" | "error";
  shifts: { id: string; startsAt: string; endsAt: string; title: string; kind?: string }[];
  teamLoading: boolean;
  sample: boolean;
  demoMode: boolean;
};

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ replace, push: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("@/components/roster/use-roster-shifts", () => ({
  useRosterShifts: () => roster,
}));

import { LastPlace, resetLastPlaceForTests } from "@/components/last-place/last-place";
import { LAST_PLACE_STORAGE_KEY } from "@/lib/last-place";

function setEntry(url: string, type = "navigate") {
  vi.spyOn(performance, "getEntriesByType").mockReturnValue([
    { name: `http://localhost${url}`, type } as unknown as PerformanceEntry,
  ]);
}

describe("LastPlace", () => {
  beforeEach(() => {
    resetLastPlaceForTests();
    replace.mockReset();
    pathname = "/";
    window.localStorage.clear();
    roster = { status: "signed-out", shifts: [], teamLoading: false, sample: false, demoMode: false };
    Object.defineProperty(document, "referrer", { value: "", configurable: true });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("opens the last page on a cold open of a bare /", async () => {
    window.localStorage.setItem(LAST_PLACE_STORAGE_KEY, "/teaching");
    setEntry("/");
    render(<LastPlace />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/teaching", { scroll: false }));
    // The page now shown is remembered only after the old one was read.
    expect(window.localStorage.getItem(LAST_PLACE_STORAGE_KEY)).toBe("/");
  });

  it("opens My Day while a real shift is running", async () => {
    window.localStorage.setItem(LAST_PLACE_STORAGE_KEY, "/teaching");
    const now = Date.now();
    roster = {
      status: "ready",
      shifts: [
        {
          id: "s1",
          title: "On call",
          kind: "on_call",
          startsAt: new Date(now - 3_600_000).toISOString(),
          endsAt: new Date(now + 3_600_000).toISOString(),
        },
      ],
      teamLoading: false,
      sample: false,
      demoMode: false,
    };
    setEntry("/");
    render(<LastPlace />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/my-day", { scroll: false }));
  });

  it("ignores the example roster", async () => {
    const now = Date.now();
    roster = {
      status: "ready",
      shifts: [
        {
          id: "s1",
          title: "Day",
          startsAt: new Date(now - 3_600_000).toISOString(),
          endsAt: new Date(now + 3_600_000).toISOString(),
        },
      ],
      teamLoading: false,
      sample: true,
      demoMode: false,
    };
    setEntry("/");
    render(<LastPlace />);
    await act(async () => {});
    expect(replace).not.toHaveBeenCalled();
  });

  it("never moves a / with a query, a reload, or an arrival from inside the app", async () => {
    window.localStorage.setItem(LAST_PLACE_STORAGE_KEY, "/teaching");
    setEntry("/?mode=dsm");
    render(<LastPlace />);
    await act(async () => {});
    expect(replace).not.toHaveBeenCalled();

    resetLastPlaceForTests();
    window.localStorage.setItem(LAST_PLACE_STORAGE_KEY, "/teaching");
    setEntry("/", "reload");
    render(<LastPlace />);
    await act(async () => {});
    expect(replace).not.toHaveBeenCalled();

    resetLastPlaceForTests();
    window.localStorage.setItem(LAST_PLACE_STORAGE_KEY, "/teaching");
    Object.defineProperty(document, "referrer", { value: `${window.location.origin}/on-call`, configurable: true });
    setEntry("/");
    render(<LastPlace />);
    await act(async () => {});
    expect(replace).not.toHaveBeenCalled();
  });

  it("leaves the doctor where they are once they start using the page", async () => {
    window.localStorage.setItem(LAST_PLACE_STORAGE_KEY, "/teaching");
    roster = { ...roster, status: "loading" };
    setEntry("/");
    const view = render(<LastPlace />);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    });
    roster = { ...roster, status: "signed-out" };
    view.rerender(<LastPlace />);
    await act(async () => {});
    expect(replace).not.toHaveBeenCalled();
  });

  it("remembers each page without its query string", async () => {
    pathname = "/on-call/whos-on";
    setEntry("/on-call/whos-on?x=1");
    render(<LastPlace />);
    await act(async () => {});
    expect(window.localStorage.getItem(LAST_PLACE_STORAGE_KEY)).toBe("/on-call/whos-on");
    expect(replace).not.toHaveBeenCalled();
  });
});
