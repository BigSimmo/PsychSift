/** @vitest-environment jsdom */

// The highlighted command-palette row used to be held by position, so typing
// more (or streamed groups arriving) moved the highlight onto whatever row now
// sat at that index, and Enter opened it. A new query now clears the highlight.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UniversalSearchCommandSurface } from "@/components/clinical-dashboard/universal-search-command-surface";

vi.mock("@/components/clinical-dashboard/use-universal-search", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/clinical-dashboard/use-universal-search")>();
  return { ...actual, useUniversalSearch: () => ({ groups: [], loading: false, query: "" }) };
});

vi.mock("@/lib/supabase/client", () => ({
  useAuthSession: () => ({ status: "signed_out", session: null, isConfigured: true, authorizationHeader: {} }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/",
}));

vi.mock("@/components/clinical-dashboard/use-saved-registry-favourites", () => ({
  useSavedRegistryFavourites: () => ({ items: [], status: "ready", registryStatus: "ready", refetch: () => undefined }),
}));

vi.mock("@/components/clinical-dashboard/search-command-context", () => ({
  useSearchCommand: () => null,
}));

function Surface({
  query,
  onActiveItemIdChange,
}: {
  query: string;
  onActiveItemIdChange: (id: string | null) => void;
}) {
  return (
    <UniversalSearchCommandSurface
      demoMode={false}
      canAccessFavourites={false}
      modeId="prescribing"
      query={query}
      recentQueries={[]}
      dropdownOpen
      onDropdownOpenChange={() => undefined}
      onQueryChange={() => undefined}
      onSearch={() => undefined}
      onPickRecent={() => undefined}
      onCrossMode={() => undefined}
      onActiveItemIdChange={onActiveItemIdChange}
    >
      <input data-testid="global-search-input" />
    </UniversalSearchCommandSurface>
  );
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("command surface highlighted row", () => {
  it("clears the highlight when the query changes, so Enter cannot open a row the reader did not pick", async () => {
    const onActiveItemIdChange = vi.fn();
    const { rerender } = render(<Surface query="sertraline" onActiveItemIdChange={onActiveItemIdChange} />);
    await screen.findByRole("listbox");

    fireEvent.keyDown(screen.getByTestId("global-search-input"), { key: "ArrowDown" });
    await waitFor(() => expect(onActiveItemIdChange).toHaveBeenLastCalledWith(expect.any(String)));

    rerender(<Surface query="sertraline dose" onActiveItemIdChange={onActiveItemIdChange} />);
    await waitFor(() => expect(onActiveItemIdChange).toHaveBeenLastCalledWith(null));
  });
});
