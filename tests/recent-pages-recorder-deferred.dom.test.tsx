/** @vitest-environment jsdom */

// The eager wrapper around the lazily loaded Recent pages recorder: if the
// reader moves to another page before the recorder arrives, the recorder must
// not save the title still on screen from the earlier page under the new path.

import { act, cleanup, render } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearRecentPages, readRecentPages } from "@/lib/recent-pages";

const navigation = vi.hoisted(() => ({ pathname: "/roster" }));
const loader = vi.hoisted(() => ({
  ready: false,
  Recorder: null as ComponentType<{ navigatedBeforeLoad?: boolean }> | null,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/clinical-dashboard/use-app-preferences", () => ({
  useAppPreferences: () => ({ canRecordRecentSearches: true }),
  mayRecordRecentSearches: () => true,
}));

// Stands in for next/dynamic: renders nothing until the test says the chunk has arrived.
vi.mock("next/dynamic", () => ({
  default: () =>
    function LazyRecorder(props: { navigatedBeforeLoad?: boolean }) {
      const Recorder = loader.Recorder;
      return loader.ready && Recorder ? <Recorder {...props} /> : null;
    },
}));

import { RecentPagesRecorderDeferred } from "@/components/recent-pages/recent-pages-recorder-deferred";

function goTo(path: string) {
  navigation.pathname = path;
  window.history.replaceState(null, "", path);
}

beforeEach(async () => {
  vi.useFakeTimers();
  loader.ready = false;
  loader.Recorder = (await import("@/components/recent-pages/recent-pages-recorder")).RecentPagesRecorder;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  clearRecentPages();
  window.localStorage.clear();
  document.title = "";
});

describe("Recent pages recorder wrapper", () => {
  it("tells a late-loading recorder that the reader moved on, so the old title is not saved", async () => {
    goTo("/roster");
    document.title = "Roster | PsychSift";
    const view = render(<RecentPagesRecorderDeferred />);

    // The reader opens a diagnosis before the recorder arrives; the tab still shows Roster.
    goTo("/dsm/diagnoses/panic-disorder");
    view.rerender(<RecentPagesRecorderDeferred />);
    loader.ready = true;
    view.rerender(<RecentPagesRecorderDeferred />);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(readRecentPages()).toEqual([]);

    await act(async () => {
      document.title = "Panic disorder | DSM-5 Diagnosis | PsychSift";
      await Promise.resolve();
    });
    expect(readRecentPages().map((page) => [page.path, page.title])).toEqual([
      ["/dsm/diagnoses/panic-disorder", "Panic disorder"],
    ]);
  });
});
