import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DsmSearchPage } from "@/components/dsm/dsm-search-page";
import type { DsmCategory, DsmDiagnosisSummary } from "@/lib/dsm";

// Cross-mode "also matches" panel is an AuthProvider-backed component of its own;
// it is exercised by tests/ui-universal-search.spec.ts, not by this page's unit test.
vi.mock("@/components/clinical-dashboard/universal-search-also-matches", () => ({
  UniversalSearchAlsoMatches: () => null,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

// `/dsm/search` rendered "No diagnosis matches" as an `<h2>` until it adopted
// `EmptyState`, whose title was a `<p>` — so heading navigation silently
// skipped the state and no test noticed (ledger #224). The heading is the
// contract now, not the markup that happens to produce it.
const categories: DsmCategory[] = [{ key: "mood", label: "Mood disorders", diagnosis_count: 12 }];

describe("DsmSearchPage empty state", () => {
  it("keeps a heading on the no-matches state so heading navigation reaches it", () => {
    render(<DsmSearchPage query="zzzznotadiagnosis" categories={categories} results={[]} totalCount={0} />);

    expect(screen.getByRole("heading", { level: 2, name: "No diagnosis matches" })).toBeVisible();
  });

  it("drops the catalogue page header and offers the shared phone filter control", async () => {
    const user = userEvent.setup();
    render(<DsmSearchPage query="Delirium" categories={categories} results={[]} totalCount={12} />);

    expect(screen.queryByRole("link", { name: /DSM-5 Diagnosis home/i })).toBeNull();
    expect(screen.queryByText(/Diagnosis catalogue/i)).toBeNull();
    expect(screen.queryByRole("heading", { name: "Diagnosis search" })).toBeNull();
    expect(screen.queryByText(/Find diagnostic records by name/i)).toBeNull();

    expect(screen.getByTestId("search-query-ribbon")).toBeVisible();
    expect(screen.getByRole("heading", { level: 1, name: "Delirium" })).toBeVisible();
    expect(screen.getByTestId("dsm-category-filter-desktop")).toBeVisible();

    const phoneFilter = screen.getByTestId("dsm-category-filter-phone");
    expect(phoneFilter).toHaveAccessibleName(/Filter\s*No filters active/);
    await user.click(phoneFilter);
    expect(screen.getByRole("dialog", { name: "Filter DSM diagnoses" })).toBeVisible();
    expect(screen.getByRole("group", { name: "Category" })).toBeVisible();
    expect(screen.getByRole("button", { name: /Mood disorders \(0\)/ })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("group", { name: "Specifier support" })).toBeVisible();
    expect(screen.getByRole("group", { name: "Differential guidance" })).toBeVisible();
  });

  it("accepts comma-separated categories and preserves comparison ids while refining", async () => {
    const user = userEvent.setup();
    const anxiety = {
      key: "anxiety",
      label: "Anxiety disorders",
      diagnosis_count: 8,
    };
    const results: DsmDiagnosisSummary[] = [
      {
        slug: "mood-1",
        title: "Mood one",
        icd_code: "F30",
        category: { key: "mood", label: "Mood disorders" },
        summary: "Mood summary",
        criteriaCount: 2,
        criteriaProvenance: "dsm_criteria" as const,
        differentialCount: 1,
        specifierCount: 1,
      },
      {
        slug: "anxiety-1",
        title: "Anxiety one",
        icd_code: "F40",
        category: { key: "anxiety", label: "Anxiety disorders" },
        summary: "Anxiety summary",
        criteriaCount: 2,
        criteriaProvenance: "dsm_criteria" as const,
        differentialCount: 1,
        specifierCount: 0,
      },
    ];
    window.history.replaceState(null, "", "/dsm/search?q=review&ids=mood-1,anxiety-1&category=mood");

    render(
      <DsmSearchPage
        query="review"
        categories={[...categories, anxiety]}
        results={results}
        initialIds={["mood-1", "anxiety-1"]}
      />,
    );
    await user.click(screen.getByTestId("dsm-category-filter-phone"));
    await user.click(screen.getByRole("button", { name: /Anxiety disorders \(2\)/ }));

    const params = new URLSearchParams(window.location.search);
    expect(params.get("category")).toBe("anxiety,mood");
    expect(params.get("ids")).toBe("mood-1,anxiety-1");
    expect(params.get("q")).toBe("review");
  });

  it("keeps at least the 1rem side padding on the phone compare tray, growing only for safe-area insets", async () => {
    const { readFileSync } = await import("node:fs");
    // DSM's phone strip is now the shared Compare tray's footer layer.
    const source = readFileSync("src/components/compare/shared-compare-tray.tsx", "utf8");
    const strip = source.split("\n").find((line) => line.includes("shared-compare-tray-layer")) ?? "";
    expect(strip).toContain("pl-[max(1rem,env(safe-area-inset-left))]");
    expect(strip).toContain("pr-[max(1rem,env(safe-area-inset-right))]");
    expect(strip).not.toMatch(/\b(?:pl|pr)-safe\b/);
  });
});
