import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { loadServicesSnapshot } from "@/lib/service-catalog";
import { mapCatalogToServiceRecords } from "@/lib/service-catalog-mapper";
import { rankServiceRecords } from "@/lib/service-ranker";

const registryRecords = mapCatalogToServiceRecords(loadServicesSnapshot().services);

// A string no service title, subtitle, tag, or catchment contains — asserted
// below rather than assumed, so this test fails loudly instead of silently
// passing if the fixture ever grows a real match for it.
const noMatchQuery = "zzzznonexistentservicequeryxyz123";

const paramsState = vi.hoisted(() => ({ search: "" }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(paramsState.search),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/use-registry-records", () => ({
  useRegistryRecords: () => ({
    status: "ready",
    records: registryRecords,
    total: registryRecords.length,
    demoMode: true,
    governance: {},
    refetch: vi.fn(),
  }),
}));

vi.mock("@/components/use-result-sort", () => ({
  useResultSort: () => ["relevance", vi.fn()] as const,
}));

vi.mock("@/components/clinical-dashboard/universal-search-also-matches", () => ({
  UniversalSearchAlsoMatches: () => null,
}));

// The result row's bookmark reads account favourites. Stubbed rather than
// wrapped in the real provider so this file keeps testing scope/facet
// behaviour without also exercising the account fetch.
vi.mock("@/components/account-data-provider", () => ({
  useAccountData: () => ({
    favourites: { service: [], form: [], differential: [] },
    ready: true,
    loadError: null,
    error: null,
    isAuthenticated: false,
    isSaved: () => false,
    setFavourite: vi.fn(async () => true),
    clearFavourites: vi.fn(async () => true),
    reload: vi.fn(),
  }),
}));

import { ServicesNavigatorPage } from "@/components/services/services-navigator-page";

describe("services scope segment vs the query-empty state", () => {
  it("confirms the fixture query has zero whole-catalogue matches (test premise)", () => {
    expect(rankServiceRecords(registryRecords, noMatchQuery)).toHaveLength(0);
  });

  it("shows the query-empty state in the default (results-scoped) view", () => {
    paramsState.search = `q=${encodeURIComponent(noMatchQuery)}`;
    render(<ServicesNavigatorPage />);

    expect(screen.getByText(/no matches for/i)).toBeInTheDocument();
    expect(screen.queryByTestId("service-search-results")).not.toBeInTheDocument();
  });

  it("falls through to the facet-driven results once scope is widened to All items", () => {
    // `rankedMatches` (query-only, ignores scope) is empty for this query, but
    // `resultScope=all` tells the page to bypass the query for faceting and show
    // the whole catalogue instead — the scope segment's whole purpose (see
    // docs/filter-contract.md section 4). Before the fix, the query-empty branch
    // fired unconditionally and this state was unreachable.
    paramsState.search = `q=${encodeURIComponent(noMatchQuery)}&scope=all`;
    render(<ServicesNavigatorPage />);

    expect(screen.queryByText(/no matches for/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no services match/i)).not.toBeInTheDocument();
    const results = screen.getByTestId("service-search-results");
    expect(results).toBeInTheDocument();
    expect(results.children.length).toBe(registryRecords.length);

    fireEvent.click(screen.getByTestId("service-filter-trigger-desktop"));
    const scope = screen.getByRole("group", { name: "Search in" });
    expect(within(scope).getByRole("radio", { name: /^Current results/ })).not.toBeChecked();
    expect(within(scope).getByRole("radio", { name: /^All services/ })).toBeChecked();
    expect(screen.getByRole("button", { name: "Remove Search in: All services filter" })).toBeVisible();
  });

  it("makes the zero-results 'Show all services' escape clear the filters that caused the zero", () => {
    // Home-based + AOD lens matches nothing in the committed catalogue (see the
    // next test). The escape used to clear only `group`, so it reloaded the
    // same empty list.
    paramsState.search = `q=${encodeURIComponent("mental health")}&housing_flags=home_based&substance=aod`;
    render(<ServicesNavigatorPage />);

    expect(screen.getByText(/no services match/i)).toBeInTheDocument();
    const href = screen.getByRole("link", { name: "Show all services" }).getAttribute("href")!;
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.get("housing_flags")).toBeNull();
    expect(params.get("substance")).toBeNull();
    expect(params.get("group")).toBeNull();
    expect(params.get("scope")).toBe("all");
    expect(params.get("q")).toBe("mental health");
  });

  it("marks a zero-count care lens as unavailable from the active facet set", () => {
    // The committed catalogue has home-based services but none of them are
    // AOD-specific. The AOD lens would therefore be a dead end.
    paramsState.search = "housing_flags=home_based";
    render(<ServicesNavigatorPage />);

    fireEvent.click(screen.getByTestId("service-filter-trigger-desktop"));
    expect(screen.getByRole("radio", { name: "Alcohol & other drugs (0)" })).toHaveAttribute("aria-disabled", "true");
  });
});
