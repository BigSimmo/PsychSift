/** @vitest-environment jsdom */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

import { FactsheetsSearchPage } from "@/components/factsheets/factsheets-search-page";
import { FACTSHEET_DEMO_NOTICE, filterFactsheets } from "@/components/factsheets/factsheets-data";

// Cross-mode "also matches" panel is an AuthProvider-backed component of its own;
// it is exercised by tests/ui-universal-search.spec.ts, not by this page's unit test.
vi.mock("@/components/clinical-dashboard/universal-search-also-matches", () => ({
  UniversalSearchAlsoMatches: () => null,
}));
// "sertraline" matches exactly one factsheet (Medications) — a small, stable
// fixture that still exercises real counting rather than an empty result set.
const query = "sertraline";
const results = filterFactsheets(query);
const unrelatedZeroLabels = ["Conditions (0)", "Therapies (0)", "Tests & procedures (0)"] as const;
const selectedZeroMessage = "No results in Conditions for this search. Choose All or another available category.";
const naturalLanguageQuery = "I worry all the time";
const naturalLanguageExpansions = ["generalised anxiety disorder", "worry", "anxiety"];

describe("FactsheetsSearchPage category filter", () => {
  it("carries the demonstration notice on the list, not only on opened sheets", () => {
    render(<FactsheetsSearchPage query={query} results={results} />);
    expect(screen.getByRole("note")).toHaveTextContent(FACTSHEET_DEMO_NOTICE);
  });

  it("derives the shared desktop and phone options from categories available at the current query", async () => {
    const user = userEvent.setup();
    render(<FactsheetsSearchPage query={query} results={results} />);

    // Desktop: a real SegmentedControl (radiogroup), not `<Link>` chips —
    // the drift this PR closes (docs/filter-contract.md section 2).
    const desktopGroup = screen.getByRole("radiogroup", { name: "Category" });
    expect(within(desktopGroup).getByRole("radio", { name: "All (1)" })).toBeChecked();
    expect(within(desktopGroup).getByRole("radio", { name: "Medications (1)" })).toBeInTheDocument();
    for (const label of unrelatedZeroLabels) {
      expect(within(desktopGroup).queryByRole("radio", { name: label })).not.toBeInTheDocument();
    }

    await user.click(screen.getByTestId("factsheet-filter-trigger-phone"));
    const sheet = screen.getByTestId("factsheet-filter-panel");
    const sheetGroup = within(sheet).getByRole("radiogroup", { name: "Category" });
    expect(within(sheetGroup).getByRole("radio", { name: "All (1)" })).toBeChecked();
    expect(within(sheetGroup).getByRole("radio", { name: "Medications (1)" })).toBeInTheDocument();
    for (const label of unrelatedZeroLabels) {
      expect(within(sheetGroup).queryByRole("radio", { name: label })).not.toBeInTheDocument();
    }
  });

  it("selecting a category narrows within the query rather than replacing it", async () => {
    const user = userEvent.setup();
    replace.mockClear();
    render(<FactsheetsSearchPage query={query} results={results} />);

    const desktopGroup = screen.getByRole("radiogroup", { name: "Category" });
    await user.click(within(desktopGroup).getByRole("radio", { name: "Medications (1)" }));

    expect(replace).toHaveBeenCalledTimes(1);
    const href = replace.mock.calls[0][0] as string;
    // Both params survive — category narrows, it does not replace the search.
    expect(href).toContain(`q=${encodeURIComponent(query)}`);
    expect(href).toContain("category=Medications");
  });

  it("clearing the category preserves the query", async () => {
    const user = userEvent.setup();
    replace.mockClear();
    render(<FactsheetsSearchPage query={query} category="Medications" results={results} />);

    await user.click(screen.getByTestId("factsheet-filter-trigger-phone"));
    await user.click(screen.getByTestId("factsheet-filter-panel-clear"));

    expect(replace).toHaveBeenCalledTimes(1);
    const href = replace.mock.calls[0][0] as string;
    expect(href).toContain(`q=${encodeURIComponent(query)}`);
    expect(href).not.toContain("category=");
  });

  it("keeps a selected zero-count category as an explained, inert dead end", async () => {
    const user = userEvent.setup();
    replace.mockClear();
    render(
      <FactsheetsSearchPage query={query} category="Conditions" results={filterFactsheets(query, "Conditions")} />,
    );

    const desktopGroup = screen.getByRole("radiogroup", { name: "Category" });
    expect(within(desktopGroup).getByRole("radio", { name: "All (1)" })).toBeEnabled();
    expect(within(desktopGroup).getByRole("radio", { name: "Medications (1)" })).toBeEnabled();
    const selectedZero = within(desktopGroup).getByRole("radio", { name: "Conditions (0)" });
    expect(selectedZero).toBeChecked();
    expect(selectedZero).toBeDisabled();
    expect(screen.getByTestId("factsheet-category-dead-end")).toHaveTextContent(selectedZeroMessage);
    expect(within(desktopGroup).queryByRole("radio", { name: "Therapies (0)" })).not.toBeInTheDocument();
    expect(within(desktopGroup).queryByRole("radio", { name: "Tests & procedures (0)" })).not.toBeInTheDocument();

    await user.click(selectedZero);
    expect(replace).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("factsheet-filter-trigger-phone"));
    const sheet = screen.getByTestId("factsheet-filter-panel");
    const sheetGroup = within(sheet).getByRole("radiogroup", { name: "Category" });
    const sheetSelectedZero = within(sheetGroup).getByRole("radio", { name: "Conditions (0)" });
    expect(sheetSelectedZero).toBeChecked();
    expect(within(sheet).getByText(selectedZeroMessage)).toBeInTheDocument();

    await user.click(sheetSelectedZero);
    expect(replace).not.toHaveBeenCalled();
    await user.click(within(sheetGroup).getByRole("radio", { name: "Medications (1)" }));

    expect(replace).toHaveBeenCalledTimes(1);
    const href = replace.mock.calls[0][0] as string;
    expect(href).toContain(`q=${encodeURIComponent(query)}`);
    expect(href).toContain("category=Medications");
  });

  it("shows only the All escape when the current query has no category matches", () => {
    render(<FactsheetsSearchPage query="zzz-no-such-factsheet" results={[]} />);
    const desktopGroup = screen.getByRole("radiogroup", { name: "Category" });
    expect(within(desktopGroup).getByRole("radio", { name: "All (0)" })).toBeEnabled();
    for (const category of ["Medications", "Conditions", "Therapies", "Tests & procedures"]) {
      expect(within(desktopGroup).queryByRole("radio", { name: `${category} (0)` })).not.toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: "Browse sheets" })).toHaveAttribute("href", "/factsheets/search");
  });

  it("counts category options from the supplied expansion list used for results", () => {
    render(
      <FactsheetsSearchPage
        query={naturalLanguageQuery}
        expansions={naturalLanguageExpansions}
        results={filterFactsheets(naturalLanguageQuery, undefined, naturalLanguageExpansions)}
      />,
    );

    const desktopGroup = screen.getByRole("radiogroup", { name: "Category" });
    expect(within(desktopGroup).getByRole("radio", { name: "All (2)" })).toBeInTheDocument();
    expect(within(desktopGroup).getByRole("radio", { name: "Medications (1)" })).toBeInTheDocument();
    expect(within(desktopGroup).getByRole("radio", { name: "Conditions (1)" })).toBeInTheDocument();
  });
});
