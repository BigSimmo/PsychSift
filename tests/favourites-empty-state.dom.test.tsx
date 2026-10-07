import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { FavouritesCommandLibraryPage } from "@/components/clinical-dashboard/favourites-command-library-page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("@/lib/supabase/client", () => ({
  useAuthSession: () => ({
    status: "authenticated",
    session: { user: { email: "clinician@example.test" } },
    isConfigured: true,
    error: null,
  }),
}));

vi.mock("@/components/clinical-dashboard/use-saved-registry-favourites", () => ({
  useSavedRegistryFavourites: () => ({
    items: [],
    status: "ready",
    registryStatus: "ready",
    refetch: vi.fn(),
  }),
}));

vi.mock("@/components/clinical-dashboard/search-command-context", () => ({
  useSearchCommand: () => null,
}));

vi.mock("@/components/clinical-dashboard/universal-search-also-matches", () => ({
  UniversalSearchAlsoMatches: () => null,
}));

describe("favourites empty rendering", () => {
  it("renders one empty-library state, not a no-match state, when nothing is saved", () => {
    render(<FavouritesCommandLibraryPage query="" demoMode={false} />);

    // An empty library is not a search that missed: it says how to save the first item.
    expect(screen.getAllByTestId("favourites-empty-library")).toHaveLength(1);
    expect(screen.getAllByText("Save what you open most")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Add a work page" })).toBeVisible();
    expect(screen.queryByTestId("favourites-empty-matches")).toBeNull();
    expect(screen.queryByText("No favourites match")).toBeNull();
  });

  it("uses Set and Type facets while keeping the Recent view outside the filter count", async () => {
    const user = userEvent.setup();
    render(<FavouritesCommandLibraryPage query="" demoMode />);

    expect(screen.queryByTestId("favourites-filter-rail")).toBeNull();
    const trigger = screen.getByTestId("favourites-filter-trigger");
    expect(trigger).toHaveAccessibleName(/No filters active/);

    await user.click(trigger);
    const panel = screen.getByTestId("favourites-filter-panel");
    expect(within(panel).getByRole("button", { name: "Set" })).toHaveAttribute("aria-expanded", "false");
    expect(within(panel).getByRole("button", { name: "Type" })).toHaveAttribute("aria-expanded", "false");
    expect(within(panel).getByRole("button", { name: "Pinned" })).toHaveAttribute("aria-expanded", "false");
    expect(within(panel).getByRole("button", { name: "Source support" })).toHaveAttribute("aria-expanded", "false");

    await user.click(within(panel).getByRole("button", { name: "Pinned" }));
    await user.click(within(panel).getByRole("button", { name: /^Pinned only \(/ }));
    expect(trigger).toHaveAccessibleName(/1 filter active/);
    await user.click(within(panel).getByTestId("favourites-filter-panel-done"));
    expect(screen.getByRole("button", { name: "Remove Status: Pinned filter" })).toBeVisible();

    const organise = screen.getByRole("radiogroup", { name: "Organise favourites" });
    const recent = within(organise).getByRole("radio", { name: "Recent" });
    await user.click(within(organise).getByRole("radio", { name: "A to Z" }));
    await user.click(recent);
    expect(recent).toHaveAttribute("aria-checked", "true");
    expect(trigger).toHaveAccessibleName(/1 filter active/);
  });
});
