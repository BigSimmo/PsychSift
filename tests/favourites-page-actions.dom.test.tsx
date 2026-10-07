/** @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FileText } from "lucide-react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FavouritesCommandLibraryPage } from "@/components/clinical-dashboard/favourites-command-library-page";
import { ToastProvider } from "@/components/ui/toast";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }) }));
vi.mock("@/lib/supabase/client", () => ({
  useAuthSession: () => ({
    status: "authenticated",
    session: { user: { email: "clinician@example.test" } },
    isConfigured: true,
    error: null,
  }),
}));
vi.mock("@/components/clinical-dashboard/search-command-context", () => ({ useSearchCommand: () => null }));
vi.mock("@/components/clinical-dashboard/universal-search-also-matches", () => ({
  UniversalSearchAlsoMatches: () => null,
}));

const slugs = ["crisis-team", "eating-disorders", "perinatal", "older-adult", "youth-early-psychosis"];

vi.mock("@/components/clinical-dashboard/use-saved-registry-favourites", () => ({
  useSavedRegistryFavourites: () => ({
    items: slugs.map((slug) => ({
      id: `services:${slug}`,
      title: `Service ${slug}`,
      type: "services",
      set: "Saved services",
      meta: "Saved service",
      sourceMeta: "Service",
      primaryAction: "Open",
      href: `/services/${slug}`,
      icon: FileText,
      keywords: slug,
    })),
    status: "ready",
    registryStatus: "ready",
    refetch: vi.fn(),
  }),
}));

const wardRound = {
  id: "4f8a3d2e-c1b0-4a9e-8d7c-6b5a4f3e2d1c",
  name: "Ward round",
  sortOrder: 0,
  createdAt: "2026-08-23T00:00:00.000Z",
  updatedAt: "2026-08-23T00:00:00.000Z",
};

const account = vi.hoisted(() => ({
  pinnedSlugs: [] as string[],
  openedSlug: null as string | null,
  wardRoundSlugs: [] as string[],
  setFavourite: vi.fn(async () => true),
  moveFavourite: vi.fn(async () => true),
  reorderFavourite: vi.fn(async () => true),
  setFavouritePinned: vi.fn(async () => true),
  recordFavouriteOpen: vi.fn(async () => true),
  createFavouriteSet: vi.fn(async () => null),
  renameFavouriteSet: vi.fn(async () => null),
  deleteFavouriteSet: vi.fn(async () => true),
  setFavouriteOrder: vi.fn(async () => true),
}));

vi.mock("@/components/account-data-provider", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/components/account-data-provider")>();
  return {
    ...original,
    useOptionalAccountData: () => ({
      favourites: { service: slugs, form: [], differential: [], therapy: [] },
      favouriteItems: slugs.map((slug, index) => ({
        contentType: "service",
        contentKey: slug,
        createdAt: "2026-08-23T00:00:00.000Z",
        setId: account.wardRoundSlugs.includes(slug) ? wardRound.id : null,
        sortOrder: (index + 1) * 10,
        pinnedAt: account.pinnedSlugs.includes(slug) ? `2026-09-0${index + 1}T00:00:00.000Z` : null,
        lastOpenedAt: account.openedSlug === slug ? new Date().toISOString() : null,
      })),
      favouriteSets: [wardRound],
      ready: true,
      loadError: null,
      error: null,
      isAuthenticated: true,
      isSaved: () => true,
      reload: vi.fn(),
      clearFavourites: vi.fn(async () => true),
      setFavourite: account.setFavourite,
      moveFavourite: account.moveFavourite,
      reorderFavourite: account.reorderFavourite,
      setFavouritePinned: account.setFavouritePinned,
      recordFavouriteOpen: account.recordFavouriteOpen,
      createFavouriteSet: account.createFavouriteSet,
      renameFavouriteSet: account.renameFavouriteSet,
      deleteFavouriteSet: account.deleteFavouriteSet,
      setFavouriteOrder: account.setFavouriteOrder,
    }),
  };
});

function renderPage() {
  return render(
    <ToastProvider>
      <FavouritesCommandLibraryPage query="" demoMode={false} />
    </ToastProvider>,
  );
}

function rowFor(slug: string) {
  return screen.getByTestId(`favourite-row-services:${slug}`);
}

beforeEach(() => {
  account.pinnedSlugs = [];
  account.openedSlug = null;
  account.wardRoundSlugs = [];
  for (const mock of [
    account.setFavourite,
    account.moveFavourite,
    account.reorderFavourite,
    account.setFavouritePinned,
    account.recordFavouriteOpen,
    account.deleteFavouriteSet,
    account.setFavouriteOrder,
  ]) {
    mock.mockClear();
  }
  localStorage.clear();
});

describe("favourites page actions", () => {
  it("offers every swipe action in the actions sheet, so no action is swipe-only", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(within(rowFor("perinatal")).getByRole("button", { name: "More actions for Service perinatal" }));
    const sheet = screen.getByRole("dialog", { name: "Actions for Service perinatal" });
    expect(within(sheet).getByRole("button", { name: "Pin to My Day" })).toBeVisible();
    expect(within(sheet).getByRole("button", { name: /Move to a set/ })).toBeVisible();
    expect(within(sheet).getByRole("button", { name: "Remove from Favourites" })).toBeVisible();
  });

  it("holds a removal back until Undo has had its chance", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(within(rowFor("perinatal")).getByRole("button", { name: /More actions/ }));
    await user.click(screen.getByRole("button", { name: "Remove from Favourites" }));
    expect(screen.queryByTestId("favourite-row-services:perinatal")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(rowFor("perinatal")).toBeInTheDocument();
    expect(account.setFavourite).not.toHaveBeenCalled();

    await user.click(within(rowFor("perinatal")).getByRole("button", { name: /More actions/ }));
    await user.click(screen.getByRole("button", { name: "Remove from Favourites" }));
    await user.click(screen.getByRole("button", { name: "Dismiss: Removed Service perinatal" }));
    await waitFor(() => expect(account.setFavourite).toHaveBeenCalledWith("service", "perinatal", false));
  });

  it("keeps My Day to four pins and says so instead of pinning a fifth", async () => {
    account.pinnedSlugs = slugs.slice(0, 4);
    const user = userEvent.setup();
    renderPage();

    expect(screen.getByText("5 saved · 4 pinned")).toBeInTheDocument();
    await user.click(within(rowFor("youth-early-psychosis")).getByRole("button", { name: /More actions/ }));
    await user.click(screen.getByRole("button", { name: "Pin to My Day" }));
    expect(await screen.findByText("My Day holds four pins. Unpin one first.")).toBeInTheDocument();
    expect(account.setFavouritePinned).not.toHaveBeenCalled();
  });

  it("moves several favourites at once from Select mode, with Undo", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "Select" }));
    await user.click(screen.getByRole("button", { name: "Select Service crisis-team" }));
    await user.click(screen.getByRole("button", { name: "Select Service perinatal" }));
    const bar = screen.getByRole("group", { name: "Selected favourites" });
    expect(within(bar).getByText("2 selected")).toBeInTheDocument();
    await user.click(within(bar).getByRole("button", { name: "Move" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Move 2 favourites" })).getByRole("button", { name: "Ward round" }),
    );

    await waitFor(() => expect(account.moveFavourite).toHaveBeenCalledTimes(2));
    expect(account.moveFavourite).toHaveBeenCalledWith("service", "crisis-team", wardRound.id);
    expect(await screen.findByText("Moved 2 to Ward round")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(account.moveFavourite).toHaveBeenCalledWith("service", "crisis-team", null));
  });

  it("shows Continue for the last favourite opened", () => {
    account.openedSlug = "older-adult";
    renderPage();
    const continueCard = screen.getByRole("link", { name: "Continue Service older-adult" });
    expect(continueCard).toHaveAttribute("href", "/services/older-adult");
    expect(within(continueCard).getByText(/Service · opened \d{2}:\d{2}/)).toBeInTheDocument();
  });

  it("reorders inside a set with up and down buttons, never by drag alone", async () => {
    account.wardRoundSlugs = ["crisis-team", "perinatal"];
    const user = userEvent.setup();
    renderPage();

    await user.click(
      within(screen.getByTestId("favourites-set-chips")).getByRole("button", { name: "Ward round, 2 favourites" }),
    );
    expect(screen.getByTestId("favourites-set-bar")).toHaveTextContent("Ward round");
    await user.click(screen.getByRole("button", { name: "Reorder" }));
    expect(screen.getByRole("button", { name: "Move Service crisis-team up" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await act(async () => {
      await user.click(screen.getByRole("button", { name: "Move Service crisis-team down" }));
    });
    expect(account.reorderFavourite).toHaveBeenCalledWith("service", "crisis-team", "down");
  });

  it("drags a row by its grip to save an exact order for the whole set", async () => {
    account.wardRoundSlugs = ["crisis-team", "perinatal"];
    const user = userEvent.setup();
    renderPage();
    await user.click(
      within(screen.getByTestId("favourites-set-chips")).getByRole("button", { name: "Ward round, 2 favourites" }),
    );
    await user.click(screen.getByRole("button", { name: "Reorder" }));
    const grip = rowFor("crisis-team").querySelector<HTMLElement>("[data-drag-handle]");
    expect(grip).not.toBeNull();
    await act(async () => {
      fireEvent.pointerDown(grip!, { pointerId: 1, clientY: 0, button: 0 });
      fireEvent.pointerMove(grip!, { pointerId: 1, clientY: 120 });
      fireEvent.pointerUp(grip!, { pointerId: 1, clientY: 120 });
    });
    await waitFor(() =>
      expect(account.setFavouriteOrder).toHaveBeenCalledWith(wardRound.id, [
        { contentType: "service", contentKey: "perinatal" },
        { contentType: "service", contentKey: "crisis-team" },
      ]),
    );
  });

  it("deletes a set only after confirming, keeping its favourites", async () => {
    account.wardRoundSlugs = ["crisis-team"];
    const user = userEvent.setup();
    renderPage();
    await user.click(
      within(screen.getByTestId("favourites-set-chips")).getByRole("button", { name: "Ward round, 1 favourite" }),
    );
    await user.click(screen.getByRole("button", { name: "Delete Ward round set" }));
    const dialog = screen.getByRole("dialog", { name: "Delete Ward round?" });
    expect(dialog).toHaveTextContent("Its favourites stay saved and move to Unsorted.");
    expect(account.deleteFavouriteSet).not.toHaveBeenCalled();
    await act(async () => {
      await user.click(within(dialog).getByRole("button", { name: "Delete set" }));
    });
    expect(account.deleteFavouriteSet).toHaveBeenCalledWith(wardRound.id);
  });
});
