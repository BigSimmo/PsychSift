/** @vitest-environment jsdom */

// #8FXXVE: Tools must not truncate its own copy. Tool descriptions were clamped to
// two lines on the all-tools directory, and the quick-shortcut row jumped to six
// columns at `xl`, which packed six tiles into a ~780px column and cut titles
// mid-word ("Ask evi...", "prescribin/g"). Both surfaces carry the shortcut row, so
// both are pinned here; the browser journeys live in ui-tools(-show-all).spec.ts.

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApplicationsLauncherWorkspace } from "@/components/applications-launcher-page";
import { ToolsSearchResultsPage } from "@/components/tools/tools-search-results-page";

const authSession = vi.hoisted(() => ({
  status: "signed_out" as string,
  session: null,
  isConfigured: true,
  error: null,
  notice: null,
  signInWithEmail: vi.fn(),
  signInWithPassword: vi.fn(),
  signUpWithPassword: vi.fn(),
  signInWithOAuth: vi.fn(),
  signOut: vi.fn(),
}));
const pinState = vi.hoisted(() => ({ ids: ["forms", "services", "calculators"] }));

vi.mock("@/components/tools/use-tool-pins", () => ({
  useToolPins: () => ({ pinnedToolIds: pinState.ids, togglePinnedTool: vi.fn() }),
}));

vi.mock("@/lib/supabase/client", () => ({
  useAuthSession: () => authSession,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/tools",
}));

vi.mock("@/components/clinical-dashboard/use-saved-registry-favourites", () => ({
  useSavedRegistryFavourites: () => ({ items: [], status: "ready", registryStatus: "ready", refetch: () => undefined }),
}));

vi.mock("@/components/clinical-dashboard/search-command-context", () => ({
  useSearchCommand: () => null,
}));

afterEach(cleanup);
beforeEach(() => {
  pinState.ids = ["forms", "services", "calculators"];
});

function hasClass(element: Element, name: string) {
  return element.className.split(/\s+/).includes(name);
}

describe("Tools copy is never truncated (#8FXXVE)", () => {
  it("shows each tool description in full on the all-tools directory", () => {
    render(<ToolsSearchResultsPage canAccessFavourites={false} />);

    const heading = screen.getAllByRole("heading", { level: 3, name: "PsychSift Search" })[0];
    const card = heading.parentElement;
    expect(card).not.toBeNull();
    const description = heading.nextElementSibling;
    expect(description?.tagName).toBe("P");
    expect(hasClass(description as Element, "line-clamp-2")).toBe(false);
    expect(card?.querySelector("[class*='line-clamp']")).toBeNull();
  });

  it("never packs the directory's pinned row into six columns or clips its labels", () => {
    render(<ToolsSearchResultsPage canAccessFavourites={false} />);

    const pinned = screen.getByTestId("tools-pinned");
    const row = within(pinned).getByRole("list");
    expect(hasClass(row, "grid-cols-1")).toBe(true);
    expect(hasClass(row, "sm:grid-cols-2")).toBe(true);
    expect(hasClass(row, "lg:grid-cols-3")).toBe(true);
    expect(row.className).not.toMatch(/grid-cols-6/);
    expect(pinned.querySelector("[class*='truncate'], [class*='line-clamp']")).toBeNull();
  });

  it.each([
    { ids: [] },
    { ids: ["forms"] },
    { ids: ["forms", "services", "calculators"] },
    { ids: ["forms", "services", "calculators", "documents"] },
  ])("keeps pinned entries in reading order without filler for $ids", ({ ids }) => {
    pinState.ids = ids;
    render(<ToolsSearchResultsPage canAccessFavourites={false} />);
    const pinned = screen.getByTestId("tools-pinned");
    const links = within(pinned).queryAllByRole("link");
    expect(links.map((link) => link.getAttribute("data-testid"))).toEqual(ids.map((id) => `tool-pin-${id}`));
    expect(within(pinned).queryAllByRole("listitem")).toHaveLength(ids.length);
    if (ids.length === 0) expect(pinned).toHaveTextContent("Nothing pinned.");
  });

  it("never packs the launcher's shortcut row into six columns", () => {
    render(<ApplicationsLauncherWorkspace canAccessFavourites={false} />);

    const rows = screen.getAllByRole("region", { name: "Quick tool shortcuts" });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(hasClass(row, "xl:grid-cols-6")).toBe(false);
    }
  });
});
