import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Therapy } from "@/components/therapy-compass/data/types";

/**
 * Audit item 6 (Therapy): with nothing typed the list is browsing, not a
 * search, so it is titled "Therapies", runs A to Z, and no card says "Why
 * matched" or "Best match". A typed query keeps the ranked cards unchanged.
 */

function therapy(overrides: Partial<Therapy> = {}): Therapy {
  return {
    slug: "act",
    name: "Acceptance and Commitment Therapy (ACT)",
    tags: ["Mood"],
    reviewStatus: "needs_review",
    briefInterventionAvailable: true,
    patientSheetAvailable: true,
    bestUsedFor: "Example indication text",
    ...overrides,
  } as Therapy;
}

const bindingsState = vi.hoisted(() => ({
  query: "",
  searchResults: [] as Therapy[],
}));

vi.mock("@/components/therapy-compass/bindings", () => ({
  useTcBindings: () => ({
    error: null,
    loading: false,
    retryData: vi.fn(),
    search: { query: bindingsState.query, tags: [], reviewedOnly: false, briefOnly: false, sheetOnly: false },
    searchResults: bindingsState.searchResults,
    queryMatches: bindingsState.searchResults,
    toggleTag: vi.fn(),
    toggleReviewedOnly: vi.fn(),
    toggleBriefOnly: vi.fn(),
    clearSearch: vi.fn(),
    clearSearchFilters: vi.fn(),
    isInCompare: () => false,
    open: vi.fn(),
    workspaceHref: (href: string) => href,
    openSheet: vi.fn(),
    compareSlugs: [],
    addCompare: vi.fn(),
    removeCompare: vi.fn(),
  }),
}));

vi.mock("@/components/account-data-provider", () => ({
  useAccountData: () => ({ isAuthenticated: false, isSaved: () => false, setFavourite: vi.fn() }),
}));

vi.mock("@/components/clinical-dashboard/universal-search-also-matches", () => ({
  UniversalSearchAlsoMatches: () => null,
}));

import { SearchScreen } from "@/components/therapy-compass/screens/search-screen";

const unsorted = [
  therapy({ slug: "ipt", name: "Interpersonal therapy" }),
  therapy({ slug: "act", name: "Acceptance and Commitment Therapy (ACT)" }),
  therapy({ slug: "dbt", name: "Dialectical behaviour therapy" }),
];

afterEach(() => {
  bindingsState.query = "";
  bindingsState.searchResults = [];
});

function cardNames() {
  return Array.from(document.querySelectorAll("[data-therapy-result-card]")).map(
    (card) => within(card as HTMLElement).getByRole("heading", { level: 3 }).textContent,
  );
}

describe("therapy search with nothing typed", () => {
  it("titles the list Therapies, sorts A to Z, and drops match language", () => {
    bindingsState.searchResults = unsorted;
    render(<SearchScreen />);

    expect(screen.getByRole("heading", { level: 1, name: "Therapies" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "All" })).toBeNull();
    expect(cardNames()).toEqual([
      "Acceptance and Commitment Therapy (ACT)",
      "Dialectical behaviour therapy",
      "Interpersonal therapy",
    ]);
    expect(screen.queryByText("Why matched")).toBeNull();
    expect(screen.queryByText("Best match")).toBeNull();
    expect(screen.getAllByText("Best used for")).toHaveLength(3);
  });

  it("treats punctuation alone as nothing typed, as the scorer does", () => {
    bindingsState.query = " ?!- ";
    bindingsState.searchResults = unsorted;
    render(<SearchScreen />);

    expect(cardNames()).toEqual([
      "Acceptance and Commitment Therapy (ACT)",
      "Dialectical behaviour therapy",
      "Interpersonal therapy",
    ]);
    expect(screen.queryByText("Why matched")).toBeNull();
    expect(screen.queryByText("Best match")).toBeNull();
  });

  it("keeps ranked order and match language once a query is typed", () => {
    bindingsState.query = "interpersonal";
    bindingsState.searchResults = unsorted;
    render(<SearchScreen />);

    expect(screen.getByRole("heading", { level: 1, name: "interpersonal" })).toBeVisible();
    expect(cardNames()).toEqual(unsorted.map((item) => item.name));
    expect(screen.getAllByText("Why matched")).toHaveLength(3);
    expect(screen.getByText("Best match")).toBeInTheDocument();
  });
});
