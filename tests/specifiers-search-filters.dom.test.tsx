/** @vitest-environment jsdom */

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SpecifiersHomePage } from "@/components/specifiers/specifiers-home-page";
import { searchSpecifierCatalog } from "@/lib/specifiers-search-index";

// Cross-mode "also matches" panel is an AuthProvider-backed component of its own;
// it is exercised by tests/ui-universal-search.spec.ts, not by this page's unit test.
vi.mock("@/components/clinical-dashboard/universal-search-also-matches", () => ({
  UniversalSearchAlsoMatches: () => null,
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("SpecifiersHomePage filters", () => {
  it("clears a failed search to the browsable catalogue route", () => {
    render(<SpecifiersHomePage query="qzxvjkplm" autoRunSearch />);

    expect(screen.getByRole("link", { name: "Clear search" })).toHaveAttribute("href", "/specifiers/search");
  });

  it("defaults natural-language searches to their interpreted catalogue results", () => {
    render(<SpecifiersHomePage query="Which specifier describes anxiety symptoms?" autoRunSearch />);

    const catalogue = screen.getByRole("region", { name: "Full specifier catalogue matches" });
    // Several disorder-specific catalogue rows share the same specifier label; assert the
    // intended Smart match is present in the default catalogue lane rather than unique.
    const matches = within(catalogue).getAllByRole("link", { name: /with anxious distress/i });
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]).toBeVisible();
  });

  it("filters the catalogue before applying the 24-item display limit", () => {
    const matches = searchSpecifierCatalog("disorder").filter(({ item }) => item.categoryId === "per");
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.length).toBeLessThan(24);
    window.history.replaceState(null, "", "/specifiers?q=disorder&scope=catalogue&category=per");

    render(<SpecifiersHomePage query="disorder" autoRunSearch />);

    const catalogue = screen.getByRole("region", { name: "Full specifier catalogue matches" });
    expect(within(catalogue).getAllByRole("listitem")).toHaveLength(matches.length);
    expect(screen.getByRole("status")).toHaveTextContent(`${matches.length} specifiers`);
    expect(screen.queryByRole("button", { name: /show more/i })).toBeNull();
  });

  it("reports the full total and progressively reveals catalogue matches", async () => {
    const user = userEvent.setup();
    const matches = searchSpecifierCatalog("disorder");
    expect(matches.length).toBeGreaterThan(48);
    window.history.replaceState(null, "", "/specifiers?q=disorder&scope=catalogue");

    render(<SpecifiersHomePage query="disorder" autoRunSearch />);

    const catalogue = screen.getByRole("region", { name: "Full specifier catalogue matches" });
    expect(within(catalogue).getAllByRole("listitem")).toHaveLength(24);
    expect(screen.getByRole("status")).toHaveTextContent(`${matches.length} specifiers`);

    await user.click(screen.getByRole("button", { name: /show more/i }));
    expect(within(catalogue).getAllByRole("listitem")).toHaveLength(48);
  });

  it("names the filters, not an empty search, when filters alone give zero results", async () => {
    const user = userEvent.setup();
    // No source-verified entries in the anxiety category, so browsing with these filters is empty.
    window.history.replaceState(null, "", "/specifiers?scope=catalogue&category=anx&reviewed=1");

    render(<SpecifiersHomePage />);

    const heading = screen.getByRole("heading", { name: "No specifiers match these filters" });
    expect(screen.queryByText(/No strong match for/)).toBeNull();
    const emptyState = heading.closest("div")!.parentElement!;
    await user.click(within(emptyState).getByRole("button", { name: "Clear filters" }));
    expect(window.location.search).toBe("");
  });

  it("respects an explicit guide scope even when that scope is empty", () => {
    expect(searchSpecifierCatalog("type").length).toBeGreaterThan(0);
    window.history.replaceState(null, "", "/specifiers?q=type&scope=guides");

    render(<SpecifiersHomePage query="type" autoRunSearch />);

    expect(screen.getByRole("status")).toHaveTextContent("0 specifiers");
    expect(screen.getByRole("button", { name: "Remove Search in: Clinical guides filter" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "Full specifier catalogue matches" })).toBeNull();
  });

  it("writes a stable category URL and hydrates its contextual applied chip", async () => {
    const user = userEvent.setup();
    const category = searchSpecifierCatalog("disorder").find(({ item }) => item.categoryId === "per")?.item.category;
    expect(category).toBeTruthy();
    window.history.replaceState(null, "", "/specifiers?q=disorder&focus=1&scope=catalogue");

    const view = render(<SpecifiersHomePage query="disorder" autoRunSearch />);
    await user.click(screen.getByTestId("specifier-filter-trigger-phone"));
    const panel = screen.getByTestId("specifier-filter-panel");
    await user.click(within(panel).getByRole("button", { name: "Category" }));
    await user.click(within(panel).getByRole("button", { name: new RegExp(`^${category} \\(`) }));

    const params = new URLSearchParams(window.location.search);
    expect(params.get("category")).toBe("per");
    expect(params.get("q")).toBe("disorder");
    expect(params.get("focus")).toBe("1");
    view.rerender(<SpecifiersHomePage query="disorder" autoRunSearch />);
    expect(screen.getByRole("button", { name: `Remove Category: ${category} filter` })).toBeVisible();
  });
});
