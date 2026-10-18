/** @vitest-environment jsdom */

import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push }),
  useSearchParams: () => new URLSearchParams(window.location.search),
  redirect: navigation.redirect,
}));

import CalculatorsRoute from "@/app/(search-app)/calculators/page";
import CalculatorsSearchRoute from "@/app/(search-app)/calculators/search/page";
import {
  calculatorDomainCandidateCount,
  calculatorMatchesQuery,
  calculatorProgressCandidateCount,
  calculatorTimeCandidateCount,
  filterCalculatorRecords,
  type CalculatorFilterRecord,
  type CalculatorFilterState,
} from "@/components/calculators/calculator-filters";
import { calculators, type CalculatorFixture } from "@/components/calculators/calculator-fixtures";
import { calculatorRecordHref } from "@/components/calculators/calculator-routes";
import { CalculatorsSearchPage } from "@/components/calculators/search-page";
import { deriveCalculator, type AnswerMap } from "@/components/calculators/calculator-ui";
import { SharedHomeEmptyState } from "@/components/clinical-dashboard/answer-status";
import { SearchCommandProvider } from "@/components/clinical-dashboard/search-command-context";
import { smartSearchExpansions } from "@/lib/smart-search-intent";

// Cross-mode "also matches" panel is an AuthProvider-backed component of its own;
// it is exercised by tests/ui-universal-search.spec.ts, not by this page's unit test.
vi.mock("@/components/clinical-dashboard/universal-search-also-matches", () => ({
  UniversalSearchAlsoMatches: () => null,
}));
function completeAnswers(calc: CalculatorFixture): AnswerMap {
  return Object.fromEntries(calc.items.map((item) => [item.id, 0]));
}

function recordsWithProgress(): CalculatorFilterRecord[] {
  return calculators.map((calc) => {
    const answers = calc.id === "gad7" ? completeAnswers(calc) : calc.id === "phq9" ? { p1: 1 } : {};
    return { calc, derived: deriveCalculator(calc, answers) };
  });
}

const emptyFilters = (): CalculatorFilterState => ({
  domains: new Set(),
  progress: "all",
  time: "all",
});

describe("calculator mode routing", () => {
  /*
   * Calculators has no home page of its own any more: `/calculators` redirects to
   * the shared lightweight home and results moved to `/calculators/search`. These
   * cases pin that split, because routing a submitted query back at the bare path
   * would bounce through the redirect and loop.
   */
  it("forwards the bare path to the shared home, carrying a submitted query on", async () => {
    navigation.redirect.mockClear();
    await expect(CalculatorsRoute({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_REDIRECT");
    expect(navigation.redirect).toHaveBeenLastCalledWith("/?mode=calculators");

    // The page-level backstop resolves through the same helper as the proxy, so a
    // request that reaches it keeps its query instead of arriving at the home
    // having silently dropped the search the user actually submitted.
    await expect(CalculatorsRoute({ searchParams: Promise.resolve({ q: "PHQ-9", run: "1" }) })).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(navigation.redirect).toHaveBeenLastCalledWith("/calculators/search?q=PHQ-9&run=1&mode=calculators");
  });

  it("renders the catalogue on an empty query and results when a search is submitted", async () => {
    navigation.redirect.mockClear();
    const browse = await CalculatorsSearchRoute({ searchParams: Promise.resolve({}) });
    expect(browse.type).toBe(CalculatorsSearchPage);
    expect(browse.props.initialQuery).toBe("");

    const whitespace = await CalculatorsSearchRoute({ searchParams: Promise.resolve({ run: "1", q: "  " }) });
    expect(whitespace.type).toBe(CalculatorsSearchPage);
    expect(whitespace.props.initialQuery).toBe("");

    const results = await CalculatorsSearchRoute({
      searchParams: Promise.resolve({ run: "1", q: " depression " }),
    });
    expect(results.type).toBe(CalculatorsSearchPage);
    expect(results.props.initialQuery).toBe("depression");
  });

  it("opens an exact calculator from its canonical URL and rejects unknown selections", async () => {
    navigation.redirect.mockClear();
    Element.prototype.scrollTo = vi.fn();
    expect(calculatorRecordHref("phq9")).toBe("/calculators/search?calculator=phq9");

    const exact = await CalculatorsSearchRoute({ searchParams: Promise.resolve({ calculator: "phq9" }) });
    expect(exact.type).toBe(CalculatorsSearchPage);
    expect(exact.props).toMatchObject({ initialQuery: "PHQ-9", initialCalculatorId: "phq9" });

    const fromSearch = await CalculatorsSearchRoute({
      searchParams: Promise.resolve({ q: "depression", filter: "all", calculator: "phq9" }),
    });
    expect(fromSearch.props).toMatchObject({ initialQuery: "depression", initialCalculatorId: "phq9" });

    await expect(
      CalculatorsSearchRoute({
        searchParams: Promise.resolve({ query: "depression", filter: "all", calculator: "phq9" }),
      }),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(navigation.redirect).toHaveBeenLastCalledWith("/calculators/search?filter=all&calculator=phq9&q=depression");

    const exactRender = render(exact);
    expect(screen.getAllByRole("dialog", { name: "PHQ-9 calculator" })).toHaveLength(1);
    expect(screen.queryByRole("dialog", { name: "GAD-7 calculator" })).toBeNull();

    await expect(
      CalculatorsSearchRoute({ searchParams: Promise.resolve({ calculator: "unknown", q: "depression" }) }),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(navigation.redirect).toHaveBeenLastCalledWith("/calculators/search?q=depression");

    await expect(CalculatorsSearchRoute({ searchParams: Promise.resolve({ calculator: "../phq9" }) })).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(navigation.redirect).toHaveBeenLastCalledWith("/?mode=calculators");

    exactRender.unmount();
    render(<CalculatorsSearchPage initialQuery="PHQ-9" initialCalculatorId="unknown" />);
    expect(screen.queryByRole("dialog", { name: "PHQ-9 calculator" })).toBeNull();
  });

  it("follows changed calculator route selections while retaining scoring sessions", async () => {
    const user = userEvent.setup();
    Element.prototype.scrollTo = vi.fn();
    const { rerender } = render(<CalculatorsSearchPage initialCalculatorId="phq9" />);
    const firstItem = within(screen.getByRole("dialog", { name: "PHQ-9 calculator" })).getByRole("group", {
      name: "Little interest or pleasure in doing things",
    });
    await user.click(within(firstItem).getByRole("button", { name: "Several days (1 point)" }));

    rerender(<CalculatorsSearchPage initialCalculatorId="gad7" />);
    expect(screen.getByRole("dialog", { name: "GAD-7 calculator" })).toBeVisible();
    expect(screen.queryByRole("dialog", { name: "PHQ-9 calculator" })).toBeNull();

    rerender(<CalculatorsSearchPage initialCalculatorId="phq9" />);
    const restored = screen.getByRole("dialog", { name: "PHQ-9 calculator" });
    expect(within(restored).getAllByText("1 of 9 answered")[0]).toBeVisible();

    rerender(<CalculatorsSearchPage />);
    expect(screen.queryByRole("dialog", { name: /calculator$/ })).toBeNull();

    rerender(<CalculatorsSearchPage initialCalculatorId="gad7" />);
    expect(screen.getByRole("dialog", { name: "GAD-7 calculator" })).toBeVisible();
    rerender(<CalculatorsSearchPage initialCalculatorId="unknown" />);
    expect(screen.queryByRole("dialog", { name: /calculator$/ })).toBeNull();
  });

  it("preserves user open and close actions until the calculator route selection changes", async () => {
    const user = userEvent.setup();
    Element.prototype.scrollTo = vi.fn();
    const { rerender } = render(<CalculatorsSearchPage initialCalculatorId="phq9" />);

    await user.click(
      within(screen.getByRole("dialog", { name: "PHQ-9 calculator" })).getByRole("button", { name: /^Close$/ }),
    );
    rerender(<CalculatorsSearchPage initialCalculatorId="phq9" initialQuery="PHQ-9" />);
    expect(screen.queryByRole("dialog", { name: /calculator$/ })).toBeNull();

    await user.click(screen.getByRole("button", { name: /^Open PHQ-9/ }));
    rerender(<CalculatorsSearchPage initialCalculatorId="phq9" initialQuery="depression" />);
    expect(screen.getByRole("dialog", { name: "PHQ-9 calculator" })).toBeVisible();

    rerender(<CalculatorsSearchPage initialCalculatorId="unknown" />);
    await user.click(screen.getByRole("button", { name: /^Open PHQ-9/ }));
    expect(screen.getByRole("dialog", { name: "PHQ-9 calculator" })).toBeVisible();
    rerender(<CalculatorsSearchPage />);
    expect(screen.queryByRole("dialog", { name: /calculator$/ })).toBeNull();
  });

  it("normalizes the legacy query parameter to the canonical q URL", async () => {
    navigation.redirect.mockClear();
    await expect(
      CalculatorsSearchRoute({
        searchParams: Promise.resolve({ run: "1", query: "PHQ-9", focus: "1" }),
      }),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(navigation.redirect).toHaveBeenCalledWith("/calculators/search?run=1&focus=1&q=PHQ-9");
  });

  it("removes empty and redundant legacy query parameters", async () => {
    navigation.redirect.mockClear();
    await expect(CalculatorsSearchRoute({ searchParams: Promise.resolve({ query: "   " }) })).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(navigation.redirect).toHaveBeenLastCalledWith("/calculators/search");

    await expect(CalculatorsSearchRoute({ searchParams: Promise.resolve({ q: "GAD-7", query: "" }) })).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(navigation.redirect).toHaveBeenLastCalledWith("/calculators/search?q=GAD-7");
  });

  it("keeps calculator home copy on the shared lightweight home", () => {
    render(<SharedHomeEmptyState modeId="calculators" />);

    expect(screen.getByTestId("shared-home-empty-state")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Clinical Calculators" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Psychiatry assessment and monitoring tools with scoring guidance, limitations, safety prompts, and source-linked clinical considerations.",
      ),
    ).toBeInTheDocument();

    const showAll = screen.getByTestId("calculators-show-all");
    expect(showAll).toHaveAttribute("href", "/calculators/search");
    expect(showAll).toHaveAttribute("aria-label", "Show all calculators");
    expect(showAll).toHaveClass("min-h-tap");
    expect(showAll).toHaveTextContent("Show all");
    expect(screen.getByTestId("calculators-show-all-well")).toBeInTheDocument();
  });
});

describe("calculator filter predicates", () => {
  it("matches Smart screening intent and normalized exact calculator codes", () => {
    expect(
      calculatorMatchesQuery(
        calculators.find((calculator) => calculator.id === "phq9")!,
        "screen depression severity",
        smartSearchExpansions("calculators", "screen depression severity"),
      ),
    ).toBe(true);
    expect(
      calculatorMatchesQuery(
        calculators.find((calculator) => calculator.id === "gad7")!,
        "measure anxiety symptoms",
        smartSearchExpansions("calculators", "measure anxiety symptoms"),
      ),
    ).toBe(true);
    expect(
      calculatorMatchesQuery(
        calculators.find((calculator) => calculator.id === "phq9")!,
        "PHQ-9?",
      ),
    ).toBe(true);
  });

  it("applies OR within domains and AND across domain, progress, time, and query", () => {
    const records = recordsWithProgress();
    const filters: CalculatorFilterState = {
      domains: new Set(["mood", "anxiety"]),
      progress: "completed",
      time: "quick",
    };

    expect(filterCalculatorRecords(records, "anxiety", filters).map(({ calc }) => calc.id)).toEqual(["gad7"]);
    expect(filterCalculatorRecords(records, "depression", filters)).toEqual([]);
  });

  it("keeps not-started, in-progress, and completed boundaries exclusive", () => {
    const records = recordsWithProgress();
    const states = ["not-started", "in-progress", "completed"] as const;
    const ids = Object.fromEntries(
      states.map((progress) => [
        progress,
        filterCalculatorRecords(records, "", { ...emptyFilters(), progress }).map(({ calc }) => calc.id),
      ]),
    );

    expect(ids["in-progress"]).toEqual(["phq9"]);
    expect(ids.completed).toEqual(["gad7"]);
    expect(ids["not-started"]).not.toContain("phq9");
    expect(ids["not-started"]).not.toContain("gad7");
    expect(new Set(Object.values(ids).flat()).size).toBe(calculators.length);
  });

  it("buckets completion time by the fixture's numeric maximum", () => {
    const records = recordsWithProgress();
    const idsFor = (time: "quick" | "standard" | "extended") =>
      filterCalculatorRecords(records, "", { ...emptyFilters(), time }).map(({ calc }) => calc.id);

    expect(idsFor("quick")).toEqual(["gad7", "cage", "auditc"]);
    expect(idsFor("standard")).toEqual(["phq9", "k10"]);
    expect(idsFor("extended")).toEqual([]);
  });

  it("derives candidate counts from the same predicates", () => {
    const records = recordsWithProgress();
    const filters: CalculatorFilterState = {
      domains: new Set(["mood"]),
      progress: "all",
      time: "all",
    };

    expect(calculatorDomainCandidateCount(records, "", filters, "anxiety")).toBe(2);
    expect(calculatorProgressCandidateCount(records, "", filters, "in-progress")).toBe(1);
    expect(calculatorTimeCandidateCount(records, "", filters, "quick")).toBe(0);
  });

  it("uses the expanded query predicate for candidate counts and visible records", () => {
    const records = recordsWithProgress();
    const query = "screen depression severity";
    const expansions = smartSearchExpansions("calculators", query);
    const filters = emptyFilters();

    const visibleIds = filterCalculatorRecords(records, query, filters, expansions).map(({ calc }) => calc.id);
    expect(visibleIds[0]).toBe("phq9");
    expect(calculatorProgressCandidateCount(records, query, filters, "all", expansions)).toBe(visibleIds.length);
  });

  it("prioritizes an explicit calculator identity ahead of expansion-only matches", () => {
    const records = recordsWithProgress();
    const query = "AUDIT-C screen hazardous drinking";
    const ids = filterCalculatorRecords(
      records,
      query,
      emptyFilters(),
      smartSearchExpansions("calculators", query),
    ).map(({ calc }) => calc.id);

    expect(ids.indexOf("auditc")).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf("cage")).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf("auditc")).toBeLessThan(ids.indexOf("cage"));
  });

  it("finds a calculator identity embedded in a natural query without expansion terms", () => {
    const records = recordsWithProgress();
    const query = "What does PHQ-9 mean?";

    expect(smartSearchExpansions("calculators", query)).toEqual([]);
    expect(filterCalculatorRecords(records, query, emptyFilters()).map(({ calc }) => calc.id)).toEqual(["phq9"]);
  });

  it("finds the subject of a natural calculator question without a curated phrase rule", () => {
    const records = recordsWithProgress();
    const query = "What tool measures depression symptoms?";

    expect(smartSearchExpansions("calculators", query)).toEqual([]);
    expect(filterCalculatorRecords(records, query, emptyFilters()).map(({ calc }) => calc.id)[0]).toBe("phq9");
  });

  it("does not invent calculator matches from question boilerplate alone", () => {
    const records = recordsWithProgress();

    expect(filterCalculatorRecords(records, "Which calculator should I use?", emptyFilters())).toEqual([]);
    expect(filterCalculatorRecords(records, "Can you help me choose a score?", emptyFilters())).toEqual([]);
  });

  it("matches calculator identities with spaced or unicode-dash separators", () => {
    const phq9 = calculators.find((calculator) => calculator.id === "phq9")!;

    expect(calculatorMatchesQuery(phq9, "What does PHQ 9 mean?")).toBe(true);
    expect(calculatorMatchesQuery(phq9, "What does PHQ–9 mean?")).toBe(true);
    expect(calculatorMatchesQuery(phq9, "What does Patient Health Questionnaire 9 mean?")).toBe(true);
  });
});

describe("calculator results surface", () => {
  it("names the page and omits Show all when the unfiltered catalogue is already shown", () => {
    render(<CalculatorsSearchPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Calculators" })).toBeVisible();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent(`${calculators.length} calculators`);
    expect(screen.queryByTestId("calculators-show-all")).toBeNull();
  });

  it("uses the shared results band and filter sheet without a page-owned composer", async () => {
    const user = userEvent.setup();
    const { container } = render(<CalculatorsSearchPage initialQuery="depression" />);

    expect(screen.getByRole("heading", { level: 2, name: "depression" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("1 calculator");
    expect(container.querySelector('[data-testid="calculators-phone-dock"]')).toBeNull();
    const showAll = screen.getByTestId("calculators-show-all");
    expect(showAll).toHaveAttribute("href", "/calculators/search");
    expect(showAll).toHaveClass("min-h-tap");

    await user.click(screen.getByTestId("calculators-filter-trigger-phone"));
    const sheet = screen.getByTestId("calculators-filter-sheet");
    expect(within(sheet).getByRole("group", { name: "Clinical domain" })).toBeVisible();
    expect(within(sheet).getByRole("radiogroup", { name: "Session progress" })).toBeVisible();
    expect(within(sheet).getByRole("radiogroup", { name: "Completion time" })).toBeVisible();
  });

  it("labels applied filters, removes one chip, and clears filters without clearing the query", async () => {
    const user = userEvent.setup();
    render(<CalculatorsSearchPage initialQuery="depression" />);

    await user.click(screen.getByTestId("calculators-filter-trigger-phone"));
    const sheet = screen.getByTestId("calculators-filter-sheet");
    await user.click(within(sheet).getByRole("button", { name: /Mood/ }));
    expect(screen.getByRole("button", { name: "Remove Clinical domain: Mood filter" })).toBeVisible();
    expect(screen.getByRole("heading", { level: 2, name: "depression" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Remove Clinical domain: Mood filter" }));
    expect(screen.queryByRole("button", { name: "Remove Clinical domain: Mood filter" })).toBeNull();

    await user.click(within(sheet).getByRole("button", { name: /Mood/ }));
    await user.click(screen.getByTestId("calculators-filter-sheet-clear"));
    expect(screen.queryByRole("button", { name: "Remove Clinical domain: Mood filter" })).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "depression" })).toBeVisible();
  });

  it("uses Show all to clear local filters without resetting them on a modified link activation", async () => {
    const user = userEvent.setup();
    render(<CalculatorsSearchPage />);

    await user.click(screen.getByTestId("calculators-filter-trigger-phone"));
    const sheet = screen.getByTestId("calculators-filter-sheet");
    await user.click(within(sheet).getByRole("button", { name: /Mood/ }));
    expect(within(screen.getByTestId("calculator-result-list")).getAllByRole("listitem")).toHaveLength(1);
    const showAll = screen.getByTestId("calculators-show-all");
    expect(showAll).toHaveAttribute("href", "/calculators/search");
    fireEvent.click(showAll, { ctrlKey: true });
    expect(screen.getByRole("button", { name: "Remove Clinical domain: Mood filter" })).toBeVisible();
    fireEvent.click(showAll);
    expect(screen.queryByRole("button", { name: "Remove Clinical domain: Mood filter" })).toBeNull();
    expect(screen.queryByTestId("calculators-show-all")).toBeNull();
    expect(within(screen.getByTestId("calculator-result-list")).getAllByRole("listitem")).toHaveLength(
      calculators.length,
    );
  });

  it("clears a typed shared query when Show all targets the current URL, preserving modified clicks", async () => {
    const user = userEvent.setup();
    const previousUrl = window.location.href;
    window.history.replaceState(null, "", "/calculators/search");

    // Keep the provider state live: a callback spy alone would not prove that
    // clearing the shared composer also restores the visible catalogue.
    function SharedQueryCalculator() {
      const [query, setQuery] = useState("");
      return (
        <SearchCommandProvider value={{ query, modeId: "calculators", clearQuery: () => setQuery("") }}>
          <input
            aria-label="Shared calculator query"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <CalculatorsSearchPage />
        </SearchCommandProvider>
      );
    }

    try {
      render(<SharedQueryCalculator />);
      const input = screen.getByRole("textbox", { name: "Shared calculator query" });
      await user.type(input, "PHQ-9");
      const results = screen.getByTestId("calculator-result-list");
      expect(within(results).getAllByRole("listitem")).toHaveLength(1);
      expect(within(results).getByRole("button", { name: /^Open PHQ-9/ })).toBeVisible();
      const showAll = screen.getByRole("link", { name: "Show all calculators" });
      expect(showAll).toHaveAttribute("href", window.location.pathname);

      for (const modifier of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }]) {
        fireEvent.click(showAll, modifier);
        expect(input).toHaveValue("PHQ-9");
        expect(within(results).getAllByRole("listitem")).toHaveLength(1);
      }

      await user.click(showAll);
      expect(input).toHaveValue("");
      expect(within(results).getAllByRole("listitem")).toHaveLength(calculators.length);
      expect(screen.queryByTestId("calculators-show-all")).toBeNull();
      expect(window.location.pathname + window.location.search).toBe("/calculators/search");
    } finally {
      window.history.replaceState(null, "", previousUrl);
    }
  });

  it("distinguishes filtered and query-only empty recovery", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <SearchCommandProvider value={{ query: "", modeId: "calculators" }}>
        <CalculatorsSearchPage />
      </SearchCommandProvider>,
    );

    await user.click(screen.getByTestId("calculators-filter-trigger-phone"));
    await user.click(within(screen.getByTestId("calculators-filter-sheet")).getByRole("button", { name: /Mood/ }));
    rerender(
      <SearchCommandProvider value={{ query: "anxiety", modeId: "calculators" }}>
        <CalculatorsSearchPage />
      </SearchCommandProvider>,
    );
    expect(screen.getByText("No calculators match the selected filter")).toBeVisible();
    expect(screen.getByTestId("search-results-empty-remove-filter")).toBeVisible();

    await user.click(screen.getByTestId("calculators-filter-sheet-clear"));
    rerender(
      <SearchCommandProvider value={{ query: "no-such-calculator", modeId: "calculators" }}>
        <CalculatorsSearchPage />
      </SearchCommandProvider>,
    );
    expect(screen.getByText("No matches for “no-such-calculator”")).toBeVisible();
    await user.click(screen.getByTestId("search-results-empty-clear-search"));
    expect(navigation.push).toHaveBeenCalledWith("/?mode=calculators&focus=1");
  });

  it("opens, updates, completes, closes, and resumes a scoring session", async () => {
    const user = userEvent.setup();
    Element.prototype.scrollTo = vi.fn();
    render(<CalculatorsSearchPage initialQuery="PHQ-9" />);

    await user.click(screen.getByRole("button", { name: /^Open PHQ-9/ }));
    let dialog = screen.getByRole("dialog", { name: "PHQ-9 calculator" });
    const firstItem = within(dialog).getByRole("group", { name: "Little interest or pleasure in doing things" });
    await user.click(within(firstItem).getByRole("button", { name: "Several days (1 point)" }));
    expect(within(dialog).getAllByText("1 of 9 answered")[0]).toBeVisible();

    for (const option of within(dialog).getAllByRole("button", { name: "Not at all (0 points)" })) {
      await user.click(option);
    }
    expect(within(dialog).getAllByText("9 of 9 answered")[0]).toBeVisible();

    await user.click(within(dialog).getByRole("button", { name: /^Close$/ }));
    await user.click(screen.getAllByRole("button", { name: /^Open PHQ-9/ })[0]);
    dialog = screen.getByRole("dialog", { name: "PHQ-9 calculator" });
    expect(within(dialog).getAllByText("9 of 9 answered")[0]).toBeVisible();
  });
});
