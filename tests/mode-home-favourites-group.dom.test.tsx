/** @vitest-environment jsdom */

// A mode home's Favourites read only that mode's saved slugs: no service or
// form registry request, and the therapy catalogue loads on the Therapy home only.

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModeHomeFavouritesGroup } from "@/components/mode-home-favourites-group";

const saved = vi.hoisted(() => ({
  ready: true,
  favourites: { service: ["crisis-line"], form: ["form-1a"], differential: ["akathisia"], therapy: ["cbt"] },
}));
const therapyLookups = vi.hoisted(() => ({ count: 0 }));

vi.mock("@/components/account-data-provider", () => ({
  useAccountData: () => saved,
  useOptionalAccountData: () => saved,
}));

vi.mock("@/lib/therapies", () => ({
  findTherapyRecord: (slug: string) => {
    therapyLookups.count += 1;
    return slug === "cbt" ? { slug: "cbt", name: "Cognitive behavioural therapy" } : undefined;
  },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => {
  cleanup();
  therapyLookups.count = 0;
  vi.restoreAllMocks();
});

describe("mode home favourites", () => {
  it("lists differential favourites without fetching anything or loading therapies", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<ModeHomeFavouritesGroup modeId="differentials" favouriteType="differentials" />);
    const link = within(screen.getByTestId("mode-home-favourites")).getByRole("link", { name: "Akathisia" });
    expect(link.getAttribute("href")).toBe("/differentials/diagnoses/akathisia");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(therapyLookups.count).toBe(0);
  });

  it("names therapy favourites from the therapy catalogue on the Therapy home", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<ModeHomeFavouritesGroup modeId="therapy-compass" favouriteType="therapies" />);
    await waitFor(() => expect(screen.getByRole("link", { name: "Cognitive behavioural therapy" })).toBeTruthy());
    expect(screen.getByRole("link", { name: "Cognitive behavioural therapy" }).getAttribute("href")).toBe(
      "/therapy-compass/cbt",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("shows nothing while the account's favourites are loading, as after a change of account", () => {
    saved.ready = false;
    try {
      render(<ModeHomeFavouritesGroup modeId="differentials" favouriteType="differentials" />);
      expect(screen.queryByTestId("mode-home-favourites")).toBeNull();
    } finally {
      saved.ready = true;
    }
  });
});
