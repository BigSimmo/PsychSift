/**
 * #6GR6B8 (c) — a Forms search for "transport" came back blank.
 *
 * It was never a missing index: "transport" is indexed six ways over the form
 * register and is an explicit broad term in the ranker, and the ranked list
 * below proves it returns dozens of records. Two other mechanisms empty the
 * list, and until this change the page told the reader apart from neither:
 *
 *  1. the registry records are not ready. Loading, an expired session and a
 *     failed request all rendered the same body — nothing at all — so a search
 *     that had not run looked exactly like a search that found nothing. In a
 *     clinical corpus that silent zero is read as "no such form exists".
 *  2. a `category=` / `risk=` filter carried in the URL from an earlier search.
 *     The query runs fine and the filter excludes every hit.
 */
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FormsSearchResultsPage } from "@/components/forms/forms-search-results-page";
import { formRecords } from "@/lib/forms";
import { rankFormRecords } from "@/lib/form-ranker";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
const registry = vi.hoisted(() => ({ status: "ready" as string }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push }),
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
    status: registry.status,
    // A not-ready registry carries no records, which is the whole mechanism:
    // the ranker is handed an empty catalogue and cannot match anything.
    records: registry.status === "ready" || registry.status === "refetching" ? formRecords : [],
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
  registry.status = "ready";
  window.history.replaceState(null, "", "/");
  navigation.push.mockReset();
});

describe("Forms search registry states", () => {
  it("has plenty to find for the query that came back blank", () => {
    // The premise of the whole defect. If this ever drops to zero the page is
    // not the thing to fix, and the assertions below would be measuring a real
    // absence rather than a reporting failure.
    expect(rankFormRecords(formRecords, "transport", formRecords.length, [], true).length).toBeGreaterThan(10);
  });

  it("renders the matches once the registry is ready", () => {
    window.history.replaceState(null, "", "/forms/search?q=transport");
    render(<FormsSearchResultsPage query="transport" />);
    expect(screen.queryByText("Search could not complete")).toBeNull();
    expect(screen.queryByText(/^No matches for/)).toBeNull();
  });

  it("shows a loading body instead of an empty page while the registry loads", () => {
    registry.status = "loading";
    window.history.replaceState(null, "", "/forms/search?q=transport");
    render(<FormsSearchResultsPage query="transport" />);
    expect(screen.getByRole("status", { name: "Loading results" })).toBeTruthy();
    // The one thing a still-running search must never say.
    expect(screen.queryByText(/^No matches for/)).toBeNull();
  });

  it.each(["error", "unauthorized"])("says a %s search did not run rather than showing nothing", (status) => {
    registry.status = status;
    window.history.replaceState(null, "", "/forms/search?q=transport");
    render(<FormsSearchResultsPage query="transport" />);
    expect(screen.getByText("Search could not complete")).toBeTruthy();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("off");
    expect(document.querySelectorAll('[aria-live="polite"]')).toHaveLength(0);
    expect(screen.queryByText(/^No matches for/)).toBeNull();
    expect(screen.queryByRole("status", { name: "Loading results" })).toBeNull();
  });

  it("names the filter that emptied the list and offers to remove it", async () => {
    // `risk=low` matches none of the transport forms, so the query runs fine and
    // the filter hides every hit — the shape a filter carried over from an
    // earlier search produces.
    window.history.replaceState(null, "", "/forms/search?q=transport&risk=low");
    render(<FormsSearchResultsPage query="transport" />);
    expect(screen.getByText("No forms match the selected filter")).toBeTruthy();
    const remove = screen.getByTestId("search-results-empty-remove-filter");
    expect(remove.textContent).toContain("Low");
  });
});
