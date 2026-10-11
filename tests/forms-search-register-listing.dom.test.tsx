import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FormsSearchResultsPage, listFormRegister } from "@/components/forms/forms-search-results-page";
import { formCatalogDetails } from "@/lib/form-ranker";
import { formRecords } from "@/lib/forms";

/**
 * #SZA102: a bare /forms/search rendered "0 forms", a header row with no rows,
 * and "View all forms (0)" over a register holding every WA MHA form. An empty
 * query now lists the register itself.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
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
    records: formRecords,
    total: formRecords.length,
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

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("forms search with no query", () => {
  it("lists every form in the register, in form-code order", () => {
    expect(formRecords.length).toBeGreaterThan(10);
    const listed = listFormRegister(formRecords);
    expect(listed).toHaveLength(formRecords.length);
    expect(new Set(listed.map((match) => match.service.slug)).size).toBe(formRecords.length);

    const codes = listed.map((match) => formCatalogDetails(match.service)?.form ?? "").filter(Boolean);
    const collator = new Intl.Collator("en-AU", { numeric: true, sensitivity: "base" });
    expect([...codes].sort(collator.compare)).toEqual(codes);
    // Numeric, not lexical: "2A" must precede "10A" when both exist.
    const two = codes.findIndex((code) => /^2[a-z]?$/i.test(code));
    const ten = codes.findIndex((code) => /^10[a-z]?$/i.test(code));
    if (two >= 0 && ten >= 0) expect(two).toBeLessThan(ten);
  });

  it("renders the register with its real count instead of 0 forms", () => {
    render(<FormsSearchResultsPage query="" />);

    const table = screen.getByTestId("form-search-results");
    expect(within(table).getByRole("heading", { name: "All forms" })).toBeInTheDocument();
    // The count is stated once, in the band's status line; the table heading
    // only says how the list is ordered.
    expect(within(table).getByText("By form code")).toBeInTheDocument();
    expect(
      screen.getAllByRole("status").some((node) => node.textContent?.includes(`${formRecords.length} forms`)),
    ).toBe(true);
    expect(within(table).getAllByRole("article")).toHaveLength(formRecords.length);
    expect(within(table).queryByText(/content match/i)).not.toBeInTheDocument();
    // Already the whole register: no "View all forms" link pointing back at itself.
    expect(screen.queryByTestId("form-search-view-all")).not.toBeInTheDocument();
    expect(screen.queryByTestId("form-search-mobile-view-all")).not.toBeInTheDocument();

    const mobile = screen.getByTestId("form-search-mobile-results");
    expect(within(mobile).getByRole("heading", { name: "All forms" })).toBeInTheDocument();
    expect(within(mobile).queryByText(`${formRecords.length} forms`)).not.toBeInTheDocument();
    expect(screen.queryByText(/No matches for/)).not.toBeInTheDocument();
  });

  it("links a searched view to the full register with the register's size", () => {
    render(<FormsSearchResultsPage query="transport" />);

    const viewAll = screen.getByTestId("form-search-view-all");
    expect(viewAll).toHaveAttribute("href", "/forms/search");
    expect(viewAll).toHaveTextContent(`View all forms (${formRecords.length})`);
    expect(screen.getByTestId("form-search-mobile-view-all")).toHaveTextContent(
      `View all forms (${formRecords.length})`,
    );
    expect(
      within(screen.getByTestId("form-search-results")).getByRole("heading", { name: "Best matches" }),
    ).toBeInTheDocument();
  });
});
