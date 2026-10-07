/** @vitest-environment jsdom */

import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MasterSearchHeader } from "@/components/clinical-dashboard/master-search-header";
import { setWorkFramePill } from "@/components/work-frame/work-frame-store";
import { LAST_APP_MODE_STORAGE_KEY } from "@/components/clinical-dashboard/use-last-app-mode";
import { appModeSelectionHref, visibleAppModeDefinitionsForSession, type AppModeId } from "@/lib/app-modes";
import { modeMenuSideForMode, orderModesForSide } from "@/lib/phone-mode-groups";
import { standaloneModeHomeHref } from "@/lib/search-route-ownership";

/**
 * The destination URL the mode picker itself will open for `modeId`.
 */
function modeSelectionHref(modeId: AppModeId) {
  return standaloneModeHomeHref(modeId) ?? appModeSelectionHref(modeId);
}

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  // The header reads the pathname to mark the current page in the mode sheet's
  // in-mode section level. `/` is the shared home, which owns no section list —
  // the level these tests exercise is the mode list.
  usePathname: () => "/",
}));

vi.mock("@/lib/supabase/client", () => ({
  useAuthSession: () => ({
    status: "signed_out",
    session: null,
    isConfigured: true,
    error: null,
    signInWithEmail: vi.fn(),
    signOut: vi.fn(),
  }),
}));

vi.mock("@/components/clinical-dashboard/use-saved-registry-favourites", () => ({
  useSavedRegistryFavourites: () => ({
    items: [],
    status: "ready",
    registryStatus: "ready",
    refetch: () => undefined,
  }),
}));

vi.mock("@/components/clinical-dashboard/search-command-context", () => ({
  useSearchCommand: () => null,
}));

vi.mock("@/components/clinical-dashboard/universal-search-also-matches", () => ({
  UniversalSearchAlsoMatches: () => null,
}));

function headerProps() {
  return {
    demoMode: false,
    documents: [],
    query: "",
    searchMode: "answer" as const,
    loading: false,
    selectedDocumentIds: [] as string[],
    queryMode: "auto" as const,
    scopeFilters: {},
    realDataReady: true,
    canAccessFavourites: false,
    onQueryChange: () => undefined,
    onSearchModeChange: vi.fn(),
    onAsk: () => undefined,
    onClearQuery: () => undefined,
    onClearScope: () => undefined,
    onQueryModeChange: () => undefined,
    onScopeFiltersChange: () => undefined,
    onToggleScope: () => undefined,
    queryModeOptions: [{ value: "auto" as const, label: "Auto" }],
  };
}

function guestModeHomes() {
  return visibleAppModeDefinitionsForSession({ authenticated: false, demoMode: false });
}

describe("mode menu destination prefetch", () => {
  beforeEach(() => {
    router.push.mockReset();
    router.replace.mockReset();
    router.prefetch.mockReset();
    window.localStorage.clear();
  });

  it("exposes the shared composer as a semantic search input", () => {
    render(<MasterSearchHeader {...headerProps()} />);
    expect(screen.getByTestId("global-search-input")).toHaveAttribute("type", "search");
  });

  it("keeps calculator submission enabled when document data is unavailable", async () => {
    const user = userEvent.setup();
    const onAsk = vi.fn();

    render(
      <MasterSearchHeader
        {...headerProps()}
        searchMode="calculators"
        query="PHQ-9"
        realDataReady={false}
        onAsk={onAsk}
      />,
    );

    const submit = screen.getByRole("button", { name: "Search clinical calculators" });
    expect(submit).toBeEnabled();
    await user.click(submit);
    expect(onAsk).toHaveBeenCalledTimes(1);
  });

  it("submits the selected calculator suggestion rather than the previous query state", async () => {
    const user = userEvent.setup();
    const onAsk = vi.fn();
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );

    try {
      function CalculatorHeader() {
        const [query, setQuery] = useState("depression");
        return (
          <MasterSearchHeader
            {...headerProps()}
            searchMode="calculators"
            query={query}
            onQueryChange={setQuery}
            onAsk={onAsk}
          />
        );
      }

      render(<CalculatorHeader />);
      const input = screen.getByTestId("global-search-input");
      await user.clear(input);
      await user.type(input, "depression");
      await user.click(await screen.findByRole("option", { name: /depression severity.*PHQ-9/i }));

      expect(onAsk).toHaveBeenCalledWith("depression severity");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("shows calculator-specific actions instead of Answer actions", async () => {
    const user = userEvent.setup();

    render(<MasterSearchHeader {...headerProps()} searchMode="calculators" />);
    await user.click(screen.getByRole("button", { name: "Open calculators options" }));

    const actions = await screen.findByRole("group", { name: "Useful actions" });
    expect(within(actions).getByRole("button", { name: "Browse calculators" })).toBeVisible();
    expect(within(actions).queryByRole("button", { name: "New question" })).toBeNull();
    expect(within(actions).queryByRole("button", { name: "Add document" })).toBeNull();
  });

  it("prefetches the shared-home selection URL when the user points at a mode", async () => {
    const user = userEvent.setup();
    const documents = guestModeHomes().find((mode) => mode.id === "documents");
    expect(documents).toBeTruthy();
    const documentsHref = modeSelectionHref("documents");

    render(<MasterSearchHeader {...headerProps()} />);
    await user.click(screen.getByRole("button", { name: /Mode Answer/i }));
    const menu = await screen.findByRole("menu", { name: "Choose app mode" });

    // Opening on the current mode is a no-op; scanning another option warms it.
    expect(router.prefetch.mock.calls.some(([href]) => href === documentsHref)).toBe(false);
    await user.hover(within(menu).getByRole("menuitemradio", { name: /Documents/i }));
    expect(router.prefetch.mock.calls.some(([href]) => href === documentsHref)).toBe(true);
    const prefetched = new Set(router.prefetch.mock.calls.map(([href]) => href as string));
    expect(prefetched.has(documentsHref)).toBe(true);
    expect(prefetched.size).toBeLessThan(guestModeHomes().length);
  });

  it("prefetches and opens the canonical all-tools directory from the mode menu", async () => {
    const user = userEvent.setup();
    const onSearchModeChange = vi.fn();

    render(<MasterSearchHeader {...headerProps()} onSearchModeChange={onSearchModeChange} />);
    await user.click(screen.getByRole("button", { name: /Mode Answer/i }));
    const toolsOption = within(await screen.findByRole("menu", { name: "Choose app mode" })).getByRole(
      "menuitemradio",
      { name: /^Tools\b/i },
    );

    await user.hover(toolsOption);
    expect(router.prefetch.mock.calls.some(([href]) => href === "/tools")).toBe(true);

    await user.click(toolsOption);
    expect(router.push).toHaveBeenCalledWith("/tools");
    expect(onSearchModeChange).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(LAST_APP_MODE_STORAGE_KEY)).toBe("tools");
  });

  it("warms a mode again after Next invalidates its cached payload", async () => {
    const user = userEvent.setup();
    const documentsHref = modeSelectionHref("documents");

    render(<MasterSearchHeader {...headerProps()} />);
    await user.click(screen.getByRole("button", { name: /Mode Answer/i }));
    const documentsOption = within(await screen.findByRole("menu", { name: "Choose app mode" })).getByRole(
      "menuitemradio",
      { name: /Documents/i },
    );
    await user.hover(documentsOption);

    const [, options] = router.prefetch.mock.calls.find(([href]) => href === documentsHref) ?? [];
    expect(options?.onInvalidate).toBeTypeOf("function");
    options.onInvalidate();
    await user.unhover(documentsOption);
    await user.hover(documentsOption);

    expect(router.prefetch.mock.calls.filter(([href]) => href === documentsHref)).toHaveLength(2);
  });

  it("prefetches the highlighted mode when openModeMenuWithFocus targets another mode", async () => {
    const user = userEvent.setup();
    // Arrow keys walk the open side, which for Answer is Clinical, and wrap inside it.
    const modes = orderModesForSide(guestModeHomes(), modeMenuSideForMode("answer"));
    const answerIndex = modes.findIndex((mode) => mode.id === "answer");
    expect(answerIndex).toBeGreaterThanOrEqual(0);
    const previous = modes[(answerIndex - 1 + modes.length) % modes.length];
    expect(previous.id).not.toBe("answer");
    const previousHref = modeSelectionHref(previous.id);

    render(<MasterSearchHeader {...headerProps()} />);
    const trigger = screen.getByRole("button", { name: /Mode Answer/i });
    trigger.focus();
    await user.keyboard("{ArrowUp}");
    await screen.findByRole("menu", { name: "Choose app mode" });

    expect(router.prefetch.mock.calls.some(([href]) => href === previousHref)).toBe(true);
    expect(new Set(router.prefetch.mock.calls.map(([href]) => href)).size).toBe(1);
  });

  it("restores mode-trigger focus when re-selecting the already active mode", async () => {
    const user = userEvent.setup();
    const onSearchModeChange = vi.fn();
    render(<MasterSearchHeader {...headerProps()} onSearchModeChange={onSearchModeChange} />);

    const trigger = screen.getByRole("button", { name: /Mode Answer/i });
    await user.click(trigger);
    const answerOption = within(await screen.findByRole("menu", { name: "Choose app mode" })).getByRole(
      "menuitemradio",
      { name: /Answer/i },
    );
    await user.click(answerOption);

    expect(onSearchModeChange).toHaveBeenCalledWith("answer");
    await vi.waitFor(() => {
      expect(trigger).toHaveFocus();
    });
  });

  it("restores mode-trigger focus when re-opening the active Tools directory", async () => {
    const user = userEvent.setup();
    const onSearchModeChange = vi.fn();
    render(<MasterSearchHeader {...headerProps()} searchMode="tools" onSearchModeChange={onSearchModeChange} />);

    const trigger = screen.getByRole("button", { name: /Mode Tools/i });
    await user.click(trigger);
    const toolsOption = within(await screen.findByRole("menu", { name: "Choose app mode" })).getByRole(
      "menuitemradio",
      { name: /^Tools\b/i },
    );
    await user.click(toolsOption);

    expect(router.push).toHaveBeenCalledWith("/tools");
    expect(onSearchModeChange).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(trigger).toHaveFocus();
    });
  });

  it("does not steal focus when the user moves elsewhere during same-mode restore", async () => {
    const user = userEvent.setup();
    render(
      <>
        <MasterSearchHeader {...headerProps()} />
        <button type="button">Outside control</button>
      </>,
    );

    const trigger = screen.getByRole("button", { name: /Mode Answer/i });
    await user.click(trigger);
    const answerOption = within(await screen.findByRole("menu", { name: "Choose app mode" })).getByRole(
      "menuitemradio",
      { name: /Answer/i },
    );
    await user.click(answerOption);

    const outside = screen.getByRole("button", { name: "Outside control" });
    outside.focus();
    await vi.waitFor(() => {
      expect(outside).toHaveFocus();
    });
    // Deferred same-mode restore must honor restoreFocusUnlessMoved and leave
    // deliberately moved focus alone.
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(outside).toHaveFocus();
    expect(trigger).not.toHaveFocus();
  });

  it("opens on the current side and switches the list without a search field", async () => {
    const user = userEvent.setup();
    render(<MasterSearchHeader {...headerProps()} />);

    await user.click(screen.getByRole("button", { name: /Mode Answer/i }));
    const dialog = await screen.findByRole("dialog", { name: "Choose app mode" });
    expect(within(dialog).getByRole("radio", { name: "Clinical" })).toHaveAttribute("aria-checked", "true");
    expect(within(dialog).getByText("Care, diagnosis and reference")).toBeTruthy();
    expect(within(dialog).queryByRole("textbox", { name: "Find a mode" })).toBeNull();
    expect(within(dialog).queryByRole("menuitemradio", { name: /^On Call\b/i })).toBeNull();
    expect(within(dialog).getByRole("menuitemradio", { name: /^Answer\b/i })).toBeTruthy();
    expect(within(dialog).getByRole("status")).toHaveTextContent("18 in Clinical");

    await user.click(within(dialog).getByRole("radio", { name: "Work" }));
    expect(within(dialog).getByRole("menuitemradio", { name: /^On Call\b/i })).toBeTruthy();
    expect(within(dialog).queryByRole("menuitemradio", { name: /^Answer\b/i })).toBeNull();
    expect(within(dialog).getByText("Your working day")).toBeTruthy();
    expect(within(dialog).getByText(/One list of what needs you today/i)).toBeTruthy();
    expect(within(dialog).getByRole("status")).toHaveTextContent("7 in Work");
  });

  it("opens On Call's pill straight on the Work list", async () => {
    // On Call is a work area, so its pill opens on the area list rather than
    // its own pages (Josh, 7 Oct 2026, "Area list first").
    const user = userEvent.setup();
    render(<MasterSearchHeader {...headerProps()} searchMode="on-call" />);

    await user.click(screen.getByRole("button", { name: /Mode On Call/i }));
    expect(screen.queryByTestId("app-mode-section-all-modes")).toBeNull();

    const dialog = await screen.findByRole("dialog", { name: "Choose app mode" });
    expect(within(dialog).getByRole("radio", { name: "Work" })).toHaveAttribute("aria-checked", "true");
    expect(within(dialog).getByRole("menuitemradio", { name: /^On Call\b/i })).toHaveAttribute("aria-checked", "true");
    expect(within(dialog).queryByRole("menuitemradio", { name: /^Answer\b/i })).toBeNull();
  });
});

describe("work area mode pill", () => {
  afterEach(() => {
    act(() => setWorkFramePill(null));
  });

  it("shows only the area name, in its colour, when the band names no page (pill 4b)", () => {
    act(() => setWorkFramePill({ modeId: "my-day", area: "My Day", page: null }));
    render(<MasterSearchHeader {...headerProps()} searchMode="my-day" />);
    const trigger = screen.getByRole("button", { name: "Mode My Day" });
    const areaOnly = within(trigger).getByTestId("universal-header-mode-area-only");
    expect(areaOnly).toHaveTextContent("My Day");
    expect(areaOnly.className).toContain("text-[color:var(--clinical-accent)]");
    expect(within(trigger).queryByText("Mode")).toBeNull();
    // No badge on phones (Josh, 7 Oct 2026): hidden below 640px, kept above.
    expect(trigger).toHaveAttribute("data-area-only");
    expect(trigger.querySelector(".universal-header-mode-badge")?.className).toContain("max-sm:hidden");
  });

  it("keeps the page over the area while the band still names a page", () => {
    act(() => setWorkFramePill({ modeId: "my-day", area: "My Day", page: "Week" }));
    render(<MasterSearchHeader {...headerProps()} searchMode="my-day" />);
    const trigger = screen.getByRole("button", { name: "Mode My Day, page Week" });
    expect(within(trigger).queryByTestId("universal-header-mode-area-only")).toBeNull();
    expect(trigger).not.toHaveAttribute("data-area-only");
    expect(trigger.querySelector(".universal-header-mode-badge")?.className).not.toContain("max-sm:hidden");
  });
});
