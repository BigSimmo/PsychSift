/** @vitest-environment jsdom */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FileText } from "lucide-react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FavouritesCommandLibraryPage } from "@/components/clinical-dashboard/favourites-command-library-page";
import { ToastProvider } from "@/components/ui/toast";
import { WORK_PAGE_FAVOURITES_STORAGE_KEY } from "@/lib/account-scoped-browser-state";
import {
  loadWorkPageStars,
  resetWorkPageStarsForTesting,
  starrableWorkPages,
  workPageStarKey,
} from "@/lib/favourites/work-page-stars";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }) }));
vi.mock("@/lib/supabase/client", () => ({
  useAuthSession: () => ({
    status: "authenticated",
    session: { user: { id: "user-1", email: "clinician@example.test" } },
    isConfigured: true,
    error: null,
  }),
}));
vi.mock("@/components/clinical-dashboard/search-command-context", () => ({ useSearchCommand: () => null }));
vi.mock("@/components/clinical-dashboard/universal-search-also-matches", () => ({
  UniversalSearchAlsoMatches: () => null,
}));

const slugs = ["crisis-team", "perinatal", "older-adult"];

const registry = vi.hoisted(() => ({ status: "ready" as "ready" | "error" }));

vi.mock("@/components/clinical-dashboard/use-saved-registry-favourites", () => ({
  useSavedRegistryFavourites: () => ({
    items:
      registry.status === "error"
        ? []
        : slugs.map((slug) => ({
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
    status: registry.status,
    registryStatus: registry.status,
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
  setFavourite: vi.fn(async () => true),
  setFavouritePinned: vi.fn(async () => true),
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
        setId: slug === "crisis-team" ? wardRound.id : null,
        sortOrder: (index + 1) * 10,
        pinnedAt: account.pinnedSlugs.includes(slug) ? `2026-09-0${index + 1}T00:00:00.000Z` : null,
        lastOpenedAt: null,
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
      moveFavourite: vi.fn(async () => true),
      reorderFavourite: vi.fn(async () => true),
      setFavouritePinned: account.setFavouritePinned,
      recordFavouriteOpen: vi.fn(async () => true),
      createFavouriteSet: vi.fn(async () => null),
      renameFavouriteSet: vi.fn(async () => null),
      deleteFavouriteSet: vi.fn(async () => true),
      setFavouriteOrder: vi.fn(async () => true),
    }),
  };
});

// Two real work pages, taken from the work frame's own navigation.
const pages = starrableWorkPages()
  .flatMap(({ area, items }) => items.map((item) => ({ area, item })))
  .slice(0, 2);
const [first, second] = pages;

function seedWorkPages(pinned: boolean[] = []) {
  localStorage.setItem(
    WORK_PAGE_FAVOURITES_STORAGE_KEY,
    JSON.stringify(
      pages.map(({ area, item }, index) => ({
        areaId: area.id,
        itemId: item.id,
        starredAt: 1_700_000_000_000 - index,
        pinnedAt: pinned[index] ? 1_700_000_000_000 + index : null,
        openedAt: null,
      })),
    ),
  );
  resetWorkPageStarsForTesting();
}

function workRow(index: 0 | 1) {
  const page = pages[index]!;
  return screen.getByTestId(`favourite-row-work:${workPageStarKey(page.area.id, page.item.id)}`);
}

function renderPage() {
  return render(
    <ToastProvider>
      <FavouritesCommandLibraryPage query="" demoMode={false} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  resetWorkPageStarsForTesting();
  registry.status = "ready";
  account.pinnedSlugs = [];
  account.setFavourite.mockClear();
  account.setFavouritePinned.mockClear();
});

describe("work pages on the Favourites page", () => {
  it("has two real work pages to test with", () => {
    expect(first).toBeDefined();
    expect(second).toBeDefined();
  });

  it("lists saved work pages beside clinical items, in the list and on the My Day shelf", () => {
    seedWorkPages();
    renderPage();

    expect(screen.getByText("5 saved")).toBeInTheDocument();
    const row = workRow(0);
    // The row draws its body twice, once for the xl workspace button and once for the phone link.
    expect(within(row).getAllByText("This phone").length).toBeGreaterThan(0);
    expect(within(row).getByRole("link", { name: `Open ${first!.item.title ?? first!.item.label}` })).toHaveAttribute(
      "href",
      first!.item.href,
    );
    const shelf = screen.getByTestId("favourites-shelf");
    expect(
      within(shelf)
        .getAllByTestId("favourites-shelf-tile")
        .some((tile) => tile.getAttribute("href") === first!.item.href),
    ).toBe(true);
    expect(screen.getByText(/Work pages, numbers, names, notes and layout stay on this phone/)).toBeInTheDocument();
  });

  it("keeps work pages out of the set chips, and offers no Move or Copy for them", async () => {
    seedWorkPages();
    const user = userEvent.setup();
    renderPage();

    const chips = within(screen.getByTestId("favourites-set-chips"));
    expect(chips.getByRole("button", { name: "All favourites, 5" })).toBeInTheDocument();
    expect(chips.getByRole("button", { name: "Ward round, 1 favourite" })).toBeInTheDocument();
    expect(chips.getByRole("button", { name: "Unsorted, 2 favourites" })).toBeInTheDocument();
    expect(chips.queryByRole("button", { name: new RegExp(`^${first!.area.name},`) })).toBeNull();

    await user.click(within(workRow(0)).getByRole("button", { name: /More actions/ }));
    const sheet = screen.getByRole("dialog", { name: /Actions for/ });
    expect(within(sheet).getByRole("button", { name: "Pin to My Day" })).toBeVisible();
    expect(within(sheet).getByRole("button", { name: "Remove from Favourites" })).toBeVisible();
    expect(within(sheet).queryByRole("button", { name: /Move to a set/ })).toBeNull();
    expect(within(sheet).queryByRole("button", { name: /Copy link/ })).toBeNull();
  });

  it("removes a work page at once and puts it back on Undo", async () => {
    seedWorkPages();
    const user = userEvent.setup();
    renderPage();

    await user.click(within(workRow(0)).getByRole("button", { name: /More actions/ }));
    await user.click(screen.getByRole("button", { name: "Remove from Favourites" }));
    expect(loadWorkPageStars()).toHaveLength(1);
    expect(screen.queryByTestId(workRow(1).dataset.testid!)).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(loadWorkPageStars()).toHaveLength(2));
    expect(workRow(0)).toBeInTheDocument();
    expect(account.setFavourite).not.toHaveBeenCalled();
  });

  it("counts pinned work pages against the four My Day pins", async () => {
    seedWorkPages([true, true]);
    account.pinnedSlugs = ["crisis-team", "perinatal"];
    const user = userEvent.setup();
    renderPage();

    expect(screen.getByText("5 saved · 4 pinned")).toBeInTheDocument();
    await user.click(
      within(screen.getByTestId("favourite-row-services:older-adult")).getByRole("button", { name: /More actions/ }),
    );
    await user.click(screen.getByRole("button", { name: "Pin to My Day" }));
    expect(await screen.findByText("My Day holds four pins. Unpin one first.")).toBeInTheDocument();
    expect(account.setFavouritePinned).not.toHaveBeenCalled();
  });

  it("pins a work page on this phone", async () => {
    seedWorkPages();
    const user = userEvent.setup();
    renderPage();

    await user.click(within(workRow(1)).getByRole("button", { name: /More actions/ }));
    await user.click(screen.getByRole("button", { name: "Pin to My Day" }));
    expect(await screen.findByText("Pinned to My Day")).toBeInTheDocument();
    expect(loadWorkPageStars().find((star) => star.itemId === second!.item.id)?.pinnedAt).not.toBeNull();
    expect(account.setFavouritePinned).not.toHaveBeenCalled();
  });

  it("keeps work pages listed under an amber band when clinical items fail", () => {
    registry.status = "error";
    seedWorkPages();
    renderPage();

    expect(screen.getByTestId("favourites-load-failed")).toHaveTextContent(
      "Your saved clinical items did not load. Work pages on this phone are below.",
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
    expect(workRow(0)).toBeInTheDocument();
    expect(workRow(1)).toBeInTheDocument();
  });
});
