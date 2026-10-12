/** @vitest-environment jsdom */

// The Recent pages recorder: a document page is recorded under the title it
// hands over (its tab title is only "PsychSift"), and a client navigation never
// saves the previous page's title under the new path while the route loads.

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RecentPageTitle } from "@/components/recent-pages/recent-page-title";
import { RecentPagesRecorder } from "@/components/recent-pages/recent-pages-recorder";
import { clearRecentPages, readRecentPages } from "@/lib/recent-pages";

const navigation = vi.hoisted(() => ({ pathname: "/roster" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/clinical-dashboard/use-app-preferences", () => ({
  useAppPreferences: () => ({ canRecordRecentSearches: true }),
  mayRecordRecentSearches: () => true,
}));

function goTo(path: string) {
  navigation.pathname = path;
  window.history.replaceState(null, "", path);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  clearRecentPages();
  window.localStorage.clear();
  document.title = "";
});

describe("Recent pages recorder", () => {
  it("records a document page under the title the page hands over", () => {
    goTo("/documents/doc-123");
    document.title = "PsychSift";
    render(
      <>
        <RecentPagesRecorder />
        <RecentPageTitle path="/documents/doc-123" title="Clozapine monitoring guideline" />
      </>,
    );
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(readRecentPages().map((page) => [page.path, page.title, page.section])).toEqual([
      ["/documents/doc-123", "Clozapine monitoring guideline", "documents"],
    ]);
  });

  it("never saves the previous page's title under the new path while the route is loading", async () => {
    goTo("/roster");
    document.title = "Roster | PsychSift";
    const view = render(<RecentPagesRecorder />);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(readRecentPages().map((page) => page.title)).toEqual(["Roster"]);

    // Client navigation: the path changes first; the tab still shows Roster.
    goTo("/dsm/diagnoses/panic-disorder");
    view.rerender(<RecentPagesRecorder />);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(readRecentPages().find((page) => page.path === "/dsm/diagnoses/panic-disorder")).toBeUndefined();

    // The new page's title arrives.
    await act(async () => {
      document.title = "Panic disorder | DSM-5 Diagnosis | PsychSift";
      await Promise.resolve();
    });
    expect(readRecentPages().find((page) => page.path === "/dsm/diagnoses/panic-disorder")?.title).toBe(
      "Panic disorder",
    );
  });
});
