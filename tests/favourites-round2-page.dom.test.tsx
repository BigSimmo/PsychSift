/** @vitest-environment jsdom */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FileText, Layers, Phone } from "lucide-react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FavouritesCommandLibraryPage } from "@/components/clinical-dashboard/favourites-command-library-page";
import type { FavouriteItem } from "@/components/favourites/favourites-view-model";
import type { FavouritesShelfState } from "@/components/favourites/use-favourites-shelf";
import { ToastProvider } from "@/components/ui/toast";
import {
  addSavedNumber,
  loadFavouritesLocal,
  resetFavouritesLocalForTesting,
  setFavouriteOverride,
  setFavouritesLayout,
} from "@/lib/favourites/favourites-local";
import {
  resetWorkPageStarsForTesting,
  starrableWorkPages,
  toggleWorkPageStar,
  workPageStarKey,
} from "@/lib/favourites/work-page-stars";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/favourites",
  useSearchParams: () => new URLSearchParams(),
}));
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

const registry = vi.hoisted(() => ({ slugs: ["crisis-team", "perinatal"] as string[] }));

vi.mock("@/components/clinical-dashboard/use-saved-registry-favourites", () => ({
  useSavedRegistryFavourites: () => ({
    items: registry.slugs.map((slug) => ({
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

vi.mock("@/components/account-data-provider", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/components/account-data-provider")>();
  return {
    ...original,
    useOptionalAccountData: () => ({
      favourites: { service: registry.slugs, form: [], differential: [], therapy: [] },
      favouriteItems: registry.slugs.map((slug, index) => ({
        contentType: "service",
        contentKey: slug,
        createdAt: "2026-08-23T00:00:00.000Z",
        setId: slug === "crisis-team" ? wardRound.id : null,
        sortOrder: (index + 1) * 10,
        pinnedAt: null,
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
      setFavourite: vi.fn(async () => true),
      moveFavourite: vi.fn(async () => true),
      reorderFavourite: vi.fn(async () => true),
      setFavouritePinned: vi.fn(async () => true),
      recordFavouriteOpen: vi.fn(async () => true),
      createFavouriteSet: vi.fn(async () => null),
      renameFavouriteSet: vi.fn(async () => null),
      deleteFavouriteSet: vi.fn(async () => true),
      setFavouriteOrder: vi.fn(async () => true),
    }),
  };
});

// The My Day shelf reads the shared hook; this file drives it directly.
const shelfState: { current: FavouritesShelfState } = { current: undefined as unknown as FavouritesShelfState };
vi.mock("@/components/favourites/use-favourites-shelf", () => ({
  useFavouritesShelf: () => shelfState.current,
}));

import { MyDayFavouritesShelf } from "@/components/favourites/my-day-favourites-shelf";

const page = starrableWorkPages().flatMap(({ area, items }) => items.map((item) => ({ area, item })))[0]!;
const workRowId = `favourite-row-work:${workPageStarKey(page.area.id, page.item.id)}`;

function seedWorkPage() {
  toggleWorkPageStar(page.area.id, page.item.id);
}

function seedNumber(label = "Psych liaison pager", number = "6457 2210") {
  const result = addSavedNumber({ label, number });
  if (!result.ok) throw new Error("number not saved");
  return result.id;
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
  resetFavouritesLocalForTesting();
  registry.slugs = ["crisis-team", "perinatal"];
});

describe("Favourites page, round 2", () => {
  it("splits All into Clinical, Numbers and Work, and the switch narrows to one side", async () => {
    seedWorkPage();
    const id = seedNumber();
    const user = userEvent.setup();
    renderPage();

    const scope = screen.getByRole("radiogroup", { name: "Show favourites" });
    expect(within(scope).getByRole("radio", { name: /^All/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("heading", { name: "Clinical" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Work" })).toBeInTheDocument();
    const numbers = screen.getByTestId("favourites-numbers");
    const numberRow = within(numbers).getByTestId(`favourite-number-${id}`);
    expect(numberRow).toHaveTextContent("Psych liaison pager");
    expect(within(numberRow).getByText("6457 2210")).toHaveClass("font-mono");
    expect(within(numberRow).getByRole("link", { name: "Call Psych liaison pager" })).toHaveAttribute(
      "href",
      "tel:64572210",
    );
    expect(screen.getByTestId(workRowId)).toBeInTheDocument();
    expect(screen.getByText(/Work pages, numbers, names, notes and layout stay on this phone/)).toBeInTheDocument();

    await user.click(within(scope).getByRole("radio", { name: /^Clinical/ }));
    expect(screen.queryByTestId(workRowId)).toBeNull();
    expect(screen.queryByTestId("favourites-numbers")).toBeNull();
    expect(screen.getByTestId("favourite-row-services:crisis-team")).toBeInTheDocument();
    expect(screen.getByTestId("favourites-set-chips")).toBeInTheDocument();

    await user.click(within(scope).getByRole("radio", { name: /^Work/ }));
    expect(screen.queryByTestId("favourite-row-services:crisis-team")).toBeNull();
    expect(screen.queryByTestId("favourites-set-chips")).toBeNull();
    expect(screen.getByTestId("favourites-numbers")).toBeInTheDocument();
    expect(screen.getByTestId(workRowId)).toBeInTheDocument();
  });

  it("opens on the scope saved in the layout", () => {
    seedWorkPage();
    setFavouritesLayout({ scope: "work" });
    renderPage();
    expect(screen.getByRole("radio", { name: /^Work/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByTestId("favourite-row-services:crisis-team")).toBeNull();
  });

  it("leaves out a hidden section, and a hidden Numbers section's numbers join the Work list", () => {
    const id = seedNumber();
    setFavouritesLayout({ hidden: ["numbers"] });
    renderPage();
    expect(screen.queryByTestId("favourites-numbers")).toBeNull();
    expect(screen.getByTestId(`favourite-row-number:${id}`)).toBeInTheDocument();
  });

  it("shows the person's own name and note, and the original title in the actions sheet", async () => {
    setFavouriteOverride("services:crisis-team", { name: "Crisis line", note: "Ask for the duty worker" });
    const user = userEvent.setup();
    renderPage();

    const row = screen.getByTestId("favourite-row-services:crisis-team");
    expect(within(row).getAllByText("Crisis line").length).toBeGreaterThan(0);
    expect(within(row).getAllByText("Ask for the duty worker").length).toBeGreaterThan(0);
    expect(screen.queryByText("Renamed")).toBeNull();

    await user.click(within(row).getByRole("button", { name: /More actions/ }));
    const sheet = screen.getByRole("dialog", { name: /Actions for Crisis line/ });
    expect(within(sheet).getByTestId("favourite-original-title")).toHaveTextContent("Original: Service crisis-team");
    await user.click(within(sheet).getByRole("button", { name: /Edit name and note/ }));
    expect(await screen.findByTestId("edit-favourite-sheet")).toBeInTheDocument();
  });

  it("opens a number's actions from its row, and removing it offers Undo", async () => {
    const id = seedNumber();
    const user = userEvent.setup();
    renderPage();

    await user.click(within(screen.getByTestId(`favourite-number-${id}`)).getByRole("button", { name: /Actions$/ }));
    const sheet = await screen.findByTestId("number-actions-sheet");
    await user.click(within(sheet).getByRole("button", { name: "Remove" }));
    expect(loadFavouritesLocal().numbers).toHaveLength(0);
    await user.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(loadFavouritesLocal().numbers).toHaveLength(1));
  });

  it("pins a number to My Day on this phone", async () => {
    const id = seedNumber();
    const user = userEvent.setup();
    renderPage();

    await user.click(within(screen.getByTestId(`favourite-number-${id}`)).getByRole("button", { name: /Actions$/ }));
    await user.click(
      within(await screen.findByTestId("number-actions-sheet")).getByRole("button", { name: "Pin to My Day" }),
    );
    expect(await screen.findByText("Pinned to My Day")).toBeInTheDocument();
    expect(loadFavouritesLocal().numbers[0]?.pinnedAt).not.toBeNull();
  });

  it("under Work with nothing saved, offers Add a work page and Add a number", async () => {
    setFavouritesLayout({ scope: "work" });
    const user = userEvent.setup();
    renderPage();

    const empty = screen.getByTestId("favourites-work-empty");
    expect(within(empty).getByRole("button", { name: /Add a work page/ })).toBeInTheDocument();
    await user.click(within(empty).getByRole("button", { name: /Add a number/ }));
    expect(await screen.findByTestId("number-form-sheet")).toBeInTheDocument();
  });

  it("opens Customise Favourites from the header", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "Customise Favourites" }));
    expect(await screen.findByTestId("customise-favourites-sheet")).toBeInTheDocument();
  });
});

function item(id: string, title: string, extra: Partial<FavouriteItem> = {}): FavouriteItem {
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

function numberItem(id: string, title: string, phone: string, extra: Partial<FavouriteItem> = {}): FavouriteItem {
  return item(`number:${id}`, title, {
    type: "Number",
    tabId: "work",
    set: "Numbers",
    action: "Call",
    href: `tel:${phone.replace(/\D/g, "")}`,
    icon: Phone,
    numberId: id,
    phone,
    identity: "on-call",
    ...extra,
  });
}

function shelfStateFor(items: FavouriteItem[], extra: Partial<FavouritesShelfState> = {}): FavouritesShelfState {
  return {
    items,
    shelf: items,
    status: "ready",
    signedIn: true,
    retry: vi.fn(),
    recordOpen: vi.fn(),
    ...extra,
  };
}

describe("My Day shelf, round 2", () => {
  it("draws a number tile that opens Call and Copy instead of dialling", async () => {
    const recordOpen = vi.fn();
    shelfState.current = shelfStateFor([numberItem("n1", "Liaison", "6457 2210")], { recordOpen });
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <MyDayFavouritesShelf />
      </ToastProvider>,
    );

    const tile = screen.getByRole("button", { name: /Liaison, number 6457 2210/ });
    expect(within(tile).getByText("6457 2210")).toHaveClass("font-mono");
    await user.click(tile);
    const sheet = await screen.findByTestId("number-actions-sheet");
    expect(within(sheet).getByRole("link", { name: /Call 6457 2210/ })).toHaveAttribute("href", "tel:64572210");
    expect(within(sheet).getByRole("button", { name: /Copy number/ })).toBeInTheDocument();
    expect(recordOpen).not.toHaveBeenCalled();
  });

  it("signed out, keeps this phone's numbers", () => {
    shelfState.current = shelfStateFor([item("delirium", "Delirium"), numberItem("n1", "Liaison", "6457 2210")], {
      signedIn: false,
    });
    render(<MyDayFavouritesShelf />);
    const tiles = screen.getAllByTestId("favourites-shelf-tile");
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toHaveAccessibleName(/Liaison/);
  });

  it("holds four tiles when the layout says four, pins in the arranged order", () => {
    setFavouritesLayout({ shelfSize: 4, pinOrder: ["b", "a"] });
    const items = ["a", "b", "c", "d", "e", "f"].map((id, index) =>
      item(id, `Item ${id}`, index < 2 ? { pinned: true, pinnedAt: index + 1 } : {}),
    );
    shelfState.current = shelfStateFor(items);
    render(<MyDayFavouritesShelf />);
    const tiles = screen.getAllByTestId("favourites-shelf-tile");
    expect(tiles).toHaveLength(4);
    expect(tiles[0]).toHaveAccessibleName(/Item b/);
    expect(tiles[1]).toHaveAccessibleName(/Item a/);
  });
});
