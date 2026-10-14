import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Therapy } from "@/components/therapy-compass/data/types";

function therapy(overrides: Partial<Therapy> = {}): Therapy {
  return {
    slug: "act",
    name: "Acceptance and Commitment Therapy (ACT)",
    tags: ["Mood", "Anxiety", "CBT"],
    reviewStatus: "needs_review",
    briefInterventionAvailable: true,
    patientSheetAvailable: true,
    ...overrides,
  } as Therapy;
}

const bindingsState = vi.hoisted(() => ({
  query: "",
  tags: [] as string[],
  reviewedOnly: false,
  briefOnly: false,
  queryMatches: [] as Therapy[],
  searchResults: [] as Therapy[],
}));

const toggleTag = vi.fn();
const toggleReviewedOnly = vi.fn();
const toggleBriefOnly = vi.fn();
const clearSearch = vi.fn();
const clearSearchFilters = vi.fn();

vi.mock("@/components/therapy-compass/bindings", () => ({
  useTcBindings: () => ({
    error: null,
    loading: false,
    retryData: vi.fn(),
    search: {
      query: bindingsState.query,
      tags: bindingsState.tags,
      reviewedOnly: bindingsState.reviewedOnly,
      briefOnly: bindingsState.briefOnly,
      sheetOnly: false,
    },
    searchResults: bindingsState.searchResults,
    queryMatches: bindingsState.queryMatches,
    toggleTag,
    toggleReviewedOnly,
    toggleBriefOnly,
    clearSearch,
    clearSearchFilters,
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
  useAccountData: () => ({
    isAuthenticated: false,
    isSaved: () => false,
    setFavourite: vi.fn(),
  }),
}));

// Cross-mode results have their own auth/network contracts. These tests own
// only Therapy's facet state and result filtering, so keep that sibling surface
// outside this focused harness.
vi.mock("@/components/clinical-dashboard/universal-search-also-matches", () => ({
  UniversalSearchAlsoMatches: () => null,
}));

import { SearchScreen } from "@/components/therapy-compass/screens/search-screen";

describe("therapy-compass search filter contract adoption", () => {
  // `bindingsState` and the handler spies are module-level, so they would
  // otherwise leak call counts and stale values between cases.
  afterEach(() => {
    bindingsState.query = "";
    bindingsState.tags = [];
    bindingsState.reviewedOnly = false;
    bindingsState.briefOnly = false;
    bindingsState.queryMatches = [];
    bindingsState.searchResults = [];
    vi.clearAllMocks();
  });

  // The facets live in the shared sheet at every breakpoint now, so each case
  // opens it first. Before, the desktop rail printed a second copy into the
  // same document and `getAllByRole(...)[0]` silently picked whichever came
  // first — the assertions below are the same, but they now describe the only
  // copy there is.
  it("renders Topics, Review status, and Handout as three separate facet groups", async () => {
    const user = userEvent.setup();
    bindingsState.query = "";
    bindingsState.tags = [];
    bindingsState.reviewedOnly = false;
    bindingsState.briefOnly = false;
    bindingsState.queryMatches = [therapy({ slug: "a", tags: ["CBT"] }), therapy({ slug: "b", tags: ["Anxiety"] })];
    bindingsState.searchResults = [];

    render(<SearchScreen />);
    await user.click(screen.getByTestId("therapy-filter-trigger-phone"));

    expect(screen.getByRole("group", { name: "Topics" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Review status" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Handout" })).toBeInTheDocument();
  });

  it("keeps both filter triggers and shows no facet group until one is used", () => {
    bindingsState.query = "";
    bindingsState.tags = [];
    bindingsState.reviewedOnly = false;
    bindingsState.briefOnly = false;
    bindingsState.queryMatches = [therapy({ slug: "a", tags: ["CBT"] })];
    bindingsState.searchResults = [];

    render(<SearchScreen />);

    // One trigger per band slot, the shared idiom. The wide slot used to hold
    // an always-open facet rail; nothing may render facets outside the sheet.
    expect(screen.getByTestId("therapy-filter-trigger-phone")).toBeInTheDocument();
    expect(screen.getByTestId("therapy-filter-trigger-wide")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Topics" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Review status" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Handout" })).not.toBeInTheDocument();
  });

  it("counts a Topics option against the query-only match set, not the already-filtered one", async () => {
    const user = userEvent.setup();
    bindingsState.query = "";
    bindingsState.tags = [];
    bindingsState.reviewedOnly = false;
    bindingsState.briefOnly = false;
    bindingsState.queryMatches = [
      therapy({ slug: "a", tags: ["CBT"] }),
      therapy({ slug: "b", tags: ["CBT"] }),
      therapy({ slug: "c", tags: ["Anxiety"] }),
    ];
    bindingsState.searchResults = [];

    render(<SearchScreen />);
    await user.click(screen.getByTestId("therapy-filter-trigger-phone"));

    expect(screen.getByRole("button", { name: /^CBT \(2\)$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Anxiety \(1\)$/ })).toBeInTheDocument();
  });

  it("clicking a Topics chip calls toggleTag with that tag", async () => {
    const user = userEvent.setup();
    bindingsState.query = "";
    bindingsState.tags = [];
    bindingsState.queryMatches = [therapy({ tags: ["CBT"] })];
    bindingsState.searchResults = [];
    toggleTag.mockClear();

    render(<SearchScreen />);
    await user.click(screen.getByTestId("therapy-filter-trigger-phone"));

    await user.click(screen.getByRole("button", { name: /^CBT/ }));
    expect(toggleTag).toHaveBeenCalledWith("CBT");
  });

  it("Reviewed only and Brief available toggle independently, never through one shared onToggle", async () => {
    const user = userEvent.setup();
    bindingsState.query = "";
    bindingsState.tags = [];
    bindingsState.queryMatches = [therapy({ reviewStatus: "reviewed" })];
    bindingsState.searchResults = [];
    toggleReviewedOnly.mockClear();
    toggleBriefOnly.mockClear();

    render(<SearchScreen />);
    await user.click(screen.getByTestId("therapy-filter-trigger-phone"));

    await user.click(screen.getByRole("button", { name: /^Reviewed only/ }));
    expect(toggleReviewedOnly).toHaveBeenCalledTimes(1);
    expect(toggleBriefOnly).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /^Brief available/ }));
    expect(toggleBriefOnly).toHaveBeenCalledTimes(1);
  });

  it("Clear all in the filter sheet clears filters only, never the query", async () => {
    const user = userEvent.setup();
    bindingsState.query = "anxiety";
    bindingsState.tags = ["CBT"];
    bindingsState.reviewedOnly = false;
    bindingsState.briefOnly = false;
    bindingsState.queryMatches = [therapy()];
    // Empty, not `[therapy()]`: `ResultCard` reads several more `useTcBindings`
    // fields (compare selection, favourites) this test's mock does not stub,
    // and this suite is scoped to the filter sheet's own wiring, not the
    // result list it sits above.
    bindingsState.searchResults = [];
    clearSearch.mockClear();
    clearSearchFilters.mockClear();

    render(<SearchScreen />);

    await user.click(screen.getByTestId("therapy-filter-trigger-phone"));
    await user.click(screen.getByTestId("therapy-filter-panel-clear"));

    expect(clearSearchFilters).toHaveBeenCalledTimes(1);
    expect(clearSearch).not.toHaveBeenCalled();
  });

  it("hides Clear all in the filter sheet for a query-only session — nothing for it to clear", async () => {
    const user = userEvent.setup();
    bindingsState.query = "anxiety";
    bindingsState.tags = [];
    bindingsState.reviewedOnly = false;
    bindingsState.briefOnly = false;
    bindingsState.queryMatches = [therapy()];
    // Empty, not `[therapy()]`: `ResultCard` reads several more `useTcBindings`
    // fields (compare selection, favourites) this test's mock does not stub,
    // and this suite is scoped to the filter sheet's own wiring, not the
    // result list it sits above.
    bindingsState.searchResults = [];

    render(<SearchScreen />);

    await user.click(screen.getByTestId("therapy-filter-trigger-phone"));
    expect(screen.queryByTestId("therapy-filter-panel-clear")).not.toBeInTheDocument();
  });

  it("visually identifies only the first ranked result as the best match", () => {
    bindingsState.query = "anxiety";
    bindingsState.queryMatches = [therapy()];
    bindingsState.searchResults = [
      therapy({ slug: "first", name: "First ranked therapy" }),
      therapy({ slug: "second", name: "Second ranked therapy" }),
    ];

    render(<SearchScreen />);

    const cards = document.querySelectorAll("[data-therapy-result-card]");
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveAttribute("data-therapy-result-featured");
    expect(cards[1]).not.toHaveAttribute("data-therapy-result-featured");
    expect(within(cards[0] as HTMLElement).getByText("Best match")).toBeInTheDocument();
    expect(within(cards[1] as HTMLElement).queryByText("Best match")).not.toBeInTheDocument();
  });

  it("keeps therapies outside the active filters listed under Not matching", async () => {
    const user = userEvent.setup();
    bindingsState.query = "anxiety";
    bindingsState.tags = ["Mood"];
    const mood = therapy({ slug: "mood", name: "Mood therapy" });
    const other = therapy({ slug: "other", name: "Other therapy", tags: ["Psychosis"] });
    bindingsState.queryMatches = [other, mood];
    bindingsState.searchResults = [mood];

    render(<SearchScreen />);

    // Filters highlight, never hide: the filtered-out therapy is still a row.
    const cards = [...document.querySelectorAll<HTMLElement>("[data-therapy-result-card]")];
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent("Mood therapy");
    expect(cards[0]).not.toHaveAttribute("data-outside-filter");
    expect(cards[1]).toHaveTextContent("Other therapy");
    expect(cards[1]).toHaveAttribute("data-outside-filter", "true");
    expect(within(cards[1]!).getByRole("link", { name: "Other therapy" })).toHaveAttribute("href");

    const note = screen.getByTestId("therapy-highlight-note");
    expect(note).toHaveTextContent("1 of 2 highlighted, all rows stay");
    expect(within(note).queryByRole("status")).toBeNull();
    expect(screen.getByTestId("therapy-outside-heading")).toHaveTextContent("Not matching · 1");
    await user.click(within(note).getByRole("button", { name: "Clear" }));
    expect(clearSearchFilters).toHaveBeenCalledTimes(1);
    expect(clearSearch).not.toHaveBeenCalled();
  });

  it("does not imply a best match when the unqueried catalogue is alphabetical", () => {
    bindingsState.searchResults = [therapy({ slug: "first" })];

    render(<SearchScreen />);

    expect(document.querySelector("[data-therapy-result-featured]")).toBeNull();
    expect(screen.queryByText("Best match")).not.toBeInTheDocument();
  });

  it("does not imply a best match for a punctuation-only query", () => {
    bindingsState.query = "!!!";
    bindingsState.queryMatches = [therapy({ slug: "first" }), therapy({ slug: "second" })];
    bindingsState.searchResults = [therapy({ slug: "first" }), therapy({ slug: "second" })];

    render(<SearchScreen />);

    expect(document.querySelector("[data-therapy-result-featured]")).toBeNull();
    expect(screen.queryByText("Best match")).not.toBeInTheDocument();
  });
});
