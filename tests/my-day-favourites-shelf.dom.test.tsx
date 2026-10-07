import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Layers, Shield } from "lucide-react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FavouriteItem } from "@/components/favourites/favourites-view-model";
import type { FavouritesShelfState } from "@/components/favourites/use-favourites-shelf";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/my-day",
  useSearchParams: () => new URLSearchParams(),
}));

const shelfState: { current: FavouritesShelfState } = { current: undefined as unknown as FavouritesShelfState };
vi.mock("@/components/favourites/use-favourites-shelf", () => ({
  useFavouritesShelf: () => shelfState.current,
}));

import { MyDayFavouritesShelf } from "@/components/favourites/my-day-favourites-shelf";

function clinical(id: string, title: string, extra: Partial<FavouriteItem> = {}): FavouriteItem {
  return {
    id,
    title,
    description: "",
    type: "Differential",
    tabId: "differentials",
    set: "Unsorted",
    evidence: "",
    lastUsed: "Saved",
    openedAt: null,
    action: "Open",
    href: `/differentials/${id}`,
    icon: Layers,
    ...extra,
  };
}

function workPage(id: string, title: string, extra: Partial<FavouriteItem> = {}): FavouriteItem {
  return {
    ...clinical(id, title),
    id: `work:admin:${id}`,
    type: "Work page",
    tabId: "work",
    set: "Admin",
    href: `/admin/${id}`,
    icon: Shield,
    workKey: `admin:${id}`,
    areaName: "Admin",
    identity: "my-work",
    savedAt: 10,
    ...extra,
  };
}

function state(overrides: Partial<FavouritesShelfState>): FavouritesShelfState {
  const items = overrides.items ?? [];
  return {
    items,
    shelf: items.slice(0, 8),
    status: "ready",
    signedIn: true,
    retry: vi.fn(),
    recordOpen: vi.fn(),
    ...overrides,
  };
}

describe("My Day Favourites shelf", () => {
  beforeEach(() => {
    shelfState.current = state({});
  });

  it("shows the saved items with an All N link to the My Day Favourites page", async () => {
    const recordOpen = vi.fn();
    const items = [
      clinical("delirium", "Delirium", { pinned: true, pinnedAt: 1 }),
      clinical("lithium", "Lithium toxicity"),
      workPage("renewals", "Renewals"),
    ];
    shelfState.current = state({ items, recordOpen });
    render(<MyDayFavouritesShelf />);

    const all = screen.getByTestId("my-day-favourites-all");
    expect(all).toHaveTextContent("All 3");
    expect(all).toHaveAttribute("href", "/my-day/favourites");
    const shelf = screen.getByTestId("my-day-favourites-shelf");
    expect(within(shelf).getAllByTestId("favourites-shelf-tile")).toHaveLength(3);
    expect(within(shelf).getByTestId("favourites-shelf-add")).toBeInTheDocument();

    const user = userEvent.setup();
    const tile = within(shelf).getByRole("link", { name: /Delirium/ });
    tile.addEventListener("click", (event) => event.preventDefault());
    await user.click(tile);
    expect(recordOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "delirium" }));
  });

  it("shows an Add row, and no All link, when nothing is saved", async () => {
    render(<MyDayFavouritesShelf />);
    expect(screen.queryByTestId("my-day-favourites-all")).toBeNull();
    const empty = screen.getByTestId("my-day-favourites-empty");
    expect(empty).toHaveTextContent("Save a service, form or work page to keep it here.");

    const user = userEvent.setup();
    await user.click(within(empty).getByRole("button", { name: "Add" }));
    expect(await screen.findByTestId("add-work-page-sheet")).toBeInTheDocument();
  });

  it("holds the shelf's place with a busy skeleton while the account loads", () => {
    shelfState.current = state({ status: "loading" });
    render(<MyDayFavouritesShelf />);
    expect(screen.getByTestId("my-day-favourites")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByTestId("my-day-favourites-loading").children).toHaveLength(8);
    expect(screen.getByRole("status")).toHaveTextContent("Loading favourites");
    expect(screen.queryByTestId("my-day-favourites-empty")).toBeNull();
  });

  it("keeps work pages and offers Retry when clinical items failed", async () => {
    const retry = vi.fn();
    shelfState.current = state({ status: "partial", items: [workPage("renewals", "Renewals")], retry });
    render(<MyDayFavouritesShelf />);

    expect(within(screen.getByTestId("my-day-favourites-shelf")).getAllByTestId("favourites-shelf-tile")).toHaveLength(
      1,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Some favourites did not load");
    const user = userEvent.setup();
    await user.click(screen.getByTestId("my-day-favourites-retry"));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("does not claim nothing is saved when the clinical read failed and there are no work pages", () => {
    shelfState.current = state({ status: "error" });
    render(<MyDayFavouritesShelf />);
    expect(screen.getByTestId("my-day-favourites-failed")).toBeInTheDocument();
    expect(screen.queryByTestId("my-day-favourites-empty")).toBeNull();
  });

  it("signed out, shows only this phone's work pages", () => {
    shelfState.current = state({
      signedIn: false,
      items: [clinical("delirium", "Delirium"), workPage("renewals", "Renewals")],
    });
    render(<MyDayFavouritesShelf />);
    const tiles = within(screen.getByTestId("my-day-favourites-shelf")).getAllByTestId("favourites-shelf-tile");
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toHaveAccessibleName(/Renewals/);
    expect(screen.getByTestId("my-day-favourites-all")).toHaveTextContent("All 1");
  });

  it("signed out with no work pages, draws nothing", () => {
    shelfState.current = state({ signedIn: false, items: [clinical("delirium", "Delirium")] });
    const { container } = render(<MyDayFavouritesShelf />);
    expect(container).toBeEmptyDOMElement();
  });
});
