import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Layers, Shield } from "lucide-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FavouriteItem } from "@/components/favourites/favourites-view-model";
import type { FavouritesShelfState } from "@/components/favourites/use-favourites-shelf";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/my-day/favourites",
  useSearchParams: () => new URLSearchParams(),
}));

const shelfState: { current: FavouritesShelfState } = { current: undefined as unknown as FavouritesShelfState };
vi.mock("@/components/favourites/use-favourites-shelf", () => ({
  useFavouritesShelf: () => shelfState.current,
}));

const accountSets: { current: { id: string; name: string; sortOrder: number }[] } = { current: [] };
vi.mock("@/components/account-data-provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/account-data-provider")>()),
  useOptionalAccountData: () => ({ favouriteSets: accountSets.current }),
}));

import { MyDayFavouritesPage } from "@/components/favourites/my-day-favourites-page";

const NOW = new Date(2026, 9, 7, 9, 0).getTime();

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

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => value });
}

describe("My Day Favourites page", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    setOnline(true);
    accountSets.current = [];
    shelfState.current = state({});
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("lists the whole saved list in groups, with Continue, and opening records the open", async () => {
    const recordOpen = vi.fn();
    accountSets.current = [
      { id: "set-ward", name: "Ward round", sortOrder: 0 },
      { id: "set-empty", name: "Clinic", sortOrder: 1 },
    ];
    shelfState.current = state({
      recordOpen,
      items: [
        clinical("delirium", "Delirium", { openedAt: NOW - 16 * 60_000, setId: "set-ward", set: "Ward round" }),
        clinical("lithium", "Lithium toxicity", { openedAt: NOW - 3 * 86_400_000 }),
        workPage("renewals", "Renewals", { openedAt: NOW - 86_400_000 }),
      ],
    });
    render(<MyDayFavouritesPage />);

    // Its own h1 (shown here because no band is drawn in this test).
    expect(screen.getByRole("heading", { level: 1, name: "Favourites" })).toBeInTheDocument();

    const continueCard = screen.getByTestId("my-day-favourites-continue");
    expect(continueCard).toHaveTextContent("Delirium");
    expect(continueCard).toHaveTextContent("Differential · opened today at 08:44");

    const groups = screen.getAllByTestId("my-day-favourites-group");
    expect(groups.map((group) => group.getAttribute("aria-label"))).toEqual([
      "Today",
      "Yesterday",
      "Earlier this week",
    ]);
    const renewals = within(groups[1]!).getByTestId("my-day-favourites-row");
    expect(renewals).toHaveTextContent("Admin");
    expect(renewals).toHaveTextContent("This phone");
    expect(within(groups[0]!).getByTestId("my-day-favourites-row")).toHaveTextContent(
      "08:44 · Differential · Ward round",
    );

    // Only sets that hold something get a chip.
    const chips = screen.getAllByTestId("my-day-favourites-set-chip");
    expect(chips).toHaveLength(1);
    expect(chips[0]).toHaveTextContent("Ward round");

    expect(screen.getByTestId("my-day-favourites-manage")).toHaveAttribute("href", "/favourites");
    expect(screen.getByText("Pin an item to keep it on Today. The first eight sit there.")).toBeInTheDocument();
    // Read and open only: no pin, move or remove controls here.
    expect(screen.queryByRole("button", { name: /Remove|Unpin|Pin |Move/ })).toBeNull();

    vi.useRealTimers();
    const user = userEvent.setup();
    const row = within(groups[2]!).getByRole("link", { name: /Lithium toxicity/ });
    row.addEventListener("click", (event) => event.preventDefault());
    await user.click(row);
    expect(recordOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "lithium" }));
  });

  it("filters by set and reorders A to Z or by type", async () => {
    vi.useRealTimers();
    accountSets.current = [{ id: "set-ward", name: "Ward round", sortOrder: 0 }];
    shelfState.current = state({
      items: [
        clinical("delirium", "Delirium", { setId: "set-ward", set: "Ward round" }),
        clinical("catatonia", "Catatonia"),
        workPage("renewals", "Renewals"),
      ],
    });
    render(<MyDayFavouritesPage />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("radio", { name: "A to Z" }));
    expect(screen.getAllByTestId("my-day-favourites-row").map((row) => row.textContent)).toEqual([
      expect.stringContaining("Catatonia"),
      expect.stringContaining("Delirium"),
      expect.stringContaining("Renewals"),
    ]);

    await user.click(screen.getByRole("radio", { name: "Type" }));
    expect(screen.getAllByTestId("my-day-favourites-group").map((group) => group.getAttribute("aria-label"))).toEqual([
      "Differentials",
      "Work pages",
    ]);

    await user.click(screen.getByTestId("my-day-favourites-set-chip"));
    expect(screen.getAllByTestId("my-day-favourites-row")).toHaveLength(1);
    await user.click(screen.getByTestId("my-day-favourites-set-all"));
    expect(screen.getAllByTestId("my-day-favourites-row")).toHaveLength(3);
  });

  it("switches between All, Clinical and Work, and a number row opens Call and Copy", async () => {
    vi.useRealTimers();
    accountSets.current = [{ id: "set-ward", name: "Ward round", sortOrder: 0 }];
    shelfState.current = state({
      items: [
        clinical("delirium", "Delirium", { setId: "set-ward", set: "Ward round", note: "Check the CAM first" }),
        workPage("renewals", "Renewals"),
        {
          ...clinical("number:n1", "Psych liaison pager"),
          type: "Number",
          tabId: "work",
          set: "Numbers",
          href: "tel:64572210",
          numberId: "n1",
          phone: "6457 2210",
        },
      ],
    });
    render(<MyDayFavouritesPage />);
    const user = userEvent.setup();

    const scope = screen.getByTestId("my-day-favourites-scope");
    expect(within(scope).getByRole("radio", { name: "All" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getAllByTestId("my-day-favourites-row")).toHaveLength(3);
    expect(screen.getByText("Check the CAM first")).toBeInTheDocument();

    await user.click(within(scope).getByRole("radio", { name: "Clinical" }));
    expect(screen.getAllByTestId("my-day-favourites-row")).toHaveLength(1);
    expect(screen.getByTestId("my-day-favourites-set-chip")).toBeInTheDocument();

    await user.click(within(scope).getByRole("radio", { name: "Work" }));
    const rows = screen.getAllByTestId("my-day-favourites-row");
    expect(rows).toHaveLength(2);
    expect(screen.queryByTestId("my-day-favourites-set-chip")).toBeNull();
    const numberRow = rows.find((row) => row.textContent?.includes("Psych liaison pager"))!;
    expect(within(numberRow).getByText("6457 2210")).toHaveClass("font-mono");
    await user.click(numberRow);
    expect(await screen.findByTestId("number-actions-sheet")).toBeInTheDocument();
  });

  it("when nothing is saved, offers Add a work page and Browse services", async () => {
    vi.useRealTimers();
    render(<MyDayFavouritesPage />);
    const empty = screen.getByTestId("my-day-favourites-empty");
    expect(within(empty).getByRole("link", { name: /Browse services/ })).toHaveAttribute("href", "/services");
    expect(screen.queryByText(/Pin an item/)).toBeNull();

    const user = userEvent.setup();
    await user.click(within(empty).getByRole("button", { name: "Add a work page" }));
    expect(await screen.findByTestId("add-work-page-sheet")).toBeInTheDocument();
  });

  it("shows a skeleton while the account loads", () => {
    shelfState.current = state({ status: "loading" });
    render(<MyDayFavouritesPage />);
    expect(screen.getByTestId("my-day-favourites-loading")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading favourites");
    expect(screen.queryByTestId("my-day-favourites-empty")).toBeNull();
  });

  it("keeps work pages under an error band with Retry when clinical items failed", async () => {
    vi.useRealTimers();
    const retry = vi.fn();
    shelfState.current = state({ status: "error", retry, items: [workPage("renewals", "Renewals")] });
    render(<MyDayFavouritesPage />);

    expect(screen.getByRole("alert")).toHaveTextContent("Your saved clinical items did not load.");
    expect(screen.getAllByTestId("my-day-favourites-row")).toHaveLength(1);
    const user = userEvent.setup();
    await user.click(screen.getByTestId("my-day-favourites-retry"));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("signed out, lists only this phone's work pages", () => {
    shelfState.current = state({
      signedIn: false,
      items: [clinical("delirium", "Delirium"), workPage("renewals", "Renewals")],
    });
    render(<MyDayFavouritesPage />);
    const rows = screen.getAllByTestId("my-day-favourites-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("Renewals");
  });

  it("says so when offline", () => {
    setOnline(false);
    shelfState.current = state({ items: [workPage("renewals", "Renewals")] });
    render(<MyDayFavouritesPage />);
    expect(screen.getByTestId("my-day-favourites-offline")).toHaveTextContent(
      "Offline. Showing what this phone last saw.",
    );
  });
});
