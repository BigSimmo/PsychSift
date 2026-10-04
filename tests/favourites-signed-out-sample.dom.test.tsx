/** @vitest-environment jsdom */

// A signed-out visitor sees the real Favourites screen filled with a few real
// catalogue entries, in memory only: no fetch, no browser storage writes, no
// account calls. Signed-in readers see none of it.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FavouritesCommandLibraryPage } from "@/components/clinical-dashboard/favourites-command-library-page";
import {
  buildFavouritesSample,
  FAVOURITES_SAMPLE_SET,
  SAMPLE_DIFFERENTIAL_SLUGS,
  SAMPLE_THERAPY_SLUGS,
} from "@/components/clinical-dashboard/favourites-sample-data";

const auth = vi.hoisted(() => ({
  status: "signed_out" as string,
  session: null as { user: { id: string } } | null,
  isConfigured: true,
}));

vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => auth }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/favourites",
}));
vi.mock("@/components/clinical-dashboard/use-saved-registry-favourites", () => ({
  useSavedRegistryFavourites: () => ({ items: [], status: "ready", registryStatus: "ready", refetch: () => undefined }),
}));
vi.mock("@/components/clinical-dashboard/search-command-context", () => ({ useSearchCommand: () => null }));
vi.mock("@/components/clinical-dashboard/universal-search-also-matches", () => ({
  UniversalSearchAlsoMatches: () => null,
}));
vi.mock("@/components/clinical-dashboard/account-setup-dialog", () => ({
  AccountSetupDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="account-dialog" /> : null),
}));

beforeEach(() => {
  auth.status = "signed_out";
  auth.session = null;
});
afterEach(() => cleanup());

describe("favourites sample data", () => {
  it("is made only of real catalogue entries with working page addresses", () => {
    const sample = buildFavouritesSample();
    expect(sample.items).toHaveLength(SAMPLE_DIFFERENTIAL_SLUGS.length + SAMPLE_THERAPY_SLUGS.length);
    for (const slug of SAMPLE_DIFFERENTIAL_SLUGS) {
      expect(sample.items.some((item) => item.href === `/differentials/diagnoses/${slug}`)).toBe(true);
    }
    for (const slug of SAMPLE_THERAPY_SLUGS) {
      expect(sample.items.some((item) => item.href === `/therapy-compass/${slug}`)).toBe(true);
    }
    expect(sample.items.some((item) => item.set === FAVOURITES_SAMPLE_SET)).toBe(true);
    for (const id of sample.pinnedIds) expect(sample.items.some((item) => item.id === id)).toBe(true);
  });
});

describe("Favourites signed out", () => {
  it("shows the Sample notice and the real screen, and reads and keeps nothing", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");
    render(<FavouritesCommandLibraryPage query="" demoMode={false} />);

    expect(screen.getByTestId("favourites-signed-out-sample")).toBeVisible();
    expect(screen.getByText("Sign in to see your favourites")).toBeVisible();
    expect(await screen.findAllByText("Major depressive disorder", {}, { timeout: 15000 })).not.toHaveLength(0);
    expect(screen.getAllByText(/Acceptance and Commitment Therapy/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(FAVOURITES_SAMPLE_SET).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByTestId("account-dialog")).toBeInTheDocument();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    setItem.mockRestore();
    removeItem.mockRestore();
  });

  it("shows the sample for an expired sign-in too", async () => {
    auth.status = "expired";
    render(<FavouritesCommandLibraryPage query="" demoMode={false} />);
    await waitFor(() => expect(screen.getAllByText("Major depressive disorder").length).toBeGreaterThan(0), {
      timeout: 15000,
    });
  });

  it("shows no sample while checking, or to a signed-in reader", () => {
    auth.status = "loading";
    const { unmount } = render(<FavouritesCommandLibraryPage query="" demoMode={false} />);
    expect(screen.queryByTestId("favourites-signed-out-sample")).toBeNull();
    unmount();
    auth.status = "authenticated";
    auth.session = { user: { id: "u1" } };
    render(<FavouritesCommandLibraryPage query="" demoMode={false} />);
    expect(screen.queryByTestId("favourites-signed-out-sample")).toBeNull();
    expect(screen.queryByText("Major depressive disorder")).toBeNull();
  });
});
