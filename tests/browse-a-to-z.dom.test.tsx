/** @vitest-environment jsdom */

import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SearchResultsHeaderBand } from "@/components/clinical-dashboard/search-results-header-band";
import { compareDsmBrowseTitles, DsmSearchPage, groupDsmBrowseByChapter } from "@/components/dsm/dsm-search-page";
import { FormulationHomePage } from "@/components/formulation/formulation-home-page";
import { SpecifiersHomePage } from "@/components/specifiers/specifiers-home-page";
import { dsmCategories, listDsmDiagnosisSummaries, type DsmCategory, type DsmDiagnosisSummary } from "@/lib/dsm";

/**
 * Audit item 6: with nothing typed, DSM, Specifiers, Formulation, Therapy and
 * Forms titled their list "All" and badged a card "Top match", which reads as if
 * the app had picked something for this patient. Browsing now shows the section
 * name and a plain A to Z list; a typed query keeps the ranked behaviour.
 */

vi.mock("@/components/clinical-dashboard/universal-search-also-matches", () => ({
  UniversalSearchAlsoMatches: () => null,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
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

const collator = (left: string, right: string) => left.localeCompare(right, "en", { sensitivity: "base" });

describe("search results band when browsing", () => {
  it("titles an empty query by the section name instead of All", () => {
    render(<SearchResultsHeaderBand modeId="dsm" query="" matchCount={145} emptyQuerySubject="DSM diagnoses" />);

    expect(screen.getByRole("heading", { name: "DSM diagnoses" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "All" })).toBeNull();
    expect(screen.getByRole("region", { name: "Browse DSM diagnoses" })).toBeVisible();
  });

  it("keeps the typed query as the heading once a search runs", () => {
    render(<SearchResultsHeaderBand modeId="dsm" query="panic" matchCount={3} emptyQuerySubject="DSM diagnoses" />);

    expect(screen.getByRole("heading", { name: "panic" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Search results for panic" })).toBeVisible();
  });
});

describe("DSM browse grouped by chapter", () => {
  const categories: DsmCategory[] = [
    { key: "sub", label: "Substance-Related", diagnosis_count: 3 },
    { key: "mood", label: "Mood Disorders", diagnosis_count: 2 },
  ];
  function summary(slug: string, title: string, category: DsmCategory): DsmDiagnosisSummary {
    return {
      slug,
      title,
      icd_code: slug.toUpperCase(),
      category: { key: category.key, label: category.label },
      summary: `${title} summary`,
      criteriaCount: 0,
      criteriaProvenance: "dsm_criteria",
      differentialCount: 0,
      specifierCount: 0,
    } as DsmDiagnosisSummary;
  }
  const [substance, mood] = categories;
  const results = [
    summary("tmpl", "[Substance] intoxication / withdrawal - generic template", substance),
    summary("mdd", "Major depressive disorder", mood),
    summary("aud", "Alcohol use disorder", substance),
    summary("cud", "Cannabis use disorder", substance),
    summary("bp1", "Bipolar I disorder", mood),
  ];

  it("sorts A to Z with generic template entries last", () => {
    const titles = [...results].sort(compareDsmBrowseTitles).map((item) => item.title);
    expect(titles[titles.length - 1]).toMatch(/^\[Substance\]/);
    expect(titles.slice(0, -1)).toEqual([...titles.slice(0, -1)].sort(collator));
  });

  it("groups in the catalogue's chapter order, rows A to Z inside each chapter", () => {
    const groups = groupDsmBrowseByChapter(categories, results);
    expect(groups.map((group) => group.label)).toEqual(["Substance-Related", "Mood Disorders"]);
    expect(groups[0]?.items.map((item) => item.title)).toEqual([
      "Alcohol use disorder",
      "Cannabis use disorder",
      "[Substance] intoxication / withdrawal - generic template",
    ]);
    expect(groups[1]?.items.map((item) => item.title)).toEqual(["Bipolar I disorder", "Major depressive disorder"]);
  });

  it("renders collapsible chapter headings with counts and keeps codes and the reference note", () => {
    render(<DsmSearchPage query="" categories={categories} results={results} />);

    expect(screen.getByRole("heading", { level: 1, name: "DSM diagnoses" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "All" })).toBeNull();
    const chapters = screen.getAllByTestId("dsm-browse-chapter");
    expect(chapters).toHaveLength(2);
    for (const chapter of chapters) expect(chapter.tagName).toBe("DETAILS");
    const first = within(chapters[0] as HTMLElement);
    expect(first.getByRole("heading", { level: 2, name: "Substance-Related" })).toBeInTheDocument();
    expect(chapters[0]?.querySelector("summary")).toHaveTextContent("3 diagnoses");
    const rowTitles = first.getAllByRole("heading", { level: 3 }).map((node) => node.textContent);
    expect(rowTitles).toEqual([
      "Alcohol use disorder",
      "Cannabis use disorder",
      "[Substance] intoxication / withdrawal - generic template",
    ]);
    expect(first.getByText("AUD")).toBeInTheDocument();
    expect(first.getAllByText("Substance-Related").length).toBeGreaterThan(1);
    expect(screen.getAllByText(/Reference content only/).length).toBeGreaterThan(0);
  });

  it("keeps the flat ranked list once a query is typed", () => {
    render(<DsmSearchPage query="disorder" categories={categories} results={results} />);

    expect(screen.queryAllByTestId("dsm-browse-chapter")).toHaveLength(0);
    const rows = screen.getAllByTestId("dsm-search-result").map((row) => within(row).getByRole("heading").textContent);
    // Query order is the ranker's, untouched by the browse sort.
    expect(rows).toEqual(results.map((item) => item.title));
  });

  it("puts the real catalogue's generic template at the end of its chapter", () => {
    const groups = groupDsmBrowseByChapter(dsmCategories, listDsmDiagnosisSummaries());
    const substanceGroup = groups.find((group) => group.items.some((item) => item.title.startsWith("[")));
    expect(substanceGroup).toBeTruthy();
    expect(substanceGroup?.items.at(-1)?.title.startsWith("[")).toBe(true);
    expect(groups.map((group) => group.key)).toEqual(
      dsmCategories.filter((category) => groups.some((group) => group.key === category.key)).map((c) => c.key),
    );
  });
});

describe("Formulation browse", () => {
  it("shows the section name, A to Z, and no Top match with nothing typed", () => {
    render(<FormulationHomePage query="" />);

    expect(screen.getByRole("heading", { level: 1, name: "Formulation mechanisms" })).toBeVisible();
    expect(screen.queryByText("Top match")).toBeNull();
    expect(screen.queryByTestId("formulation-top-match")).toBeNull();
    const list = screen.getByRole("region", { name: "Formulation mechanisms, A to Z" });
    const names = within(list)
      .getAllByRole("heading", { level: 2 })
      .map((node) => node.textContent ?? "");
    expect(names.length).toBeGreaterThan(2);
    expect(names).toEqual([...names].sort(collator));
  });
});

describe("Specifiers browse", () => {
  it("shows the section name and no Top match with nothing typed", () => {
    render(<SpecifiersHomePage query="" />);

    expect(screen.getByRole("heading", { level: 1, name: "Specifiers" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "All" })).toBeNull();
    expect(screen.queryByText("Top match")).toBeNull();
    expect(screen.queryByTestId("specifier-top-match")).toBeNull();
  });

  it("lists the browse catalogue A to Z", () => {
    window.history.replaceState(null, "", "/specifiers/search?scope=catalogue");
    render(<SpecifiersHomePage query="" />);

    const catalogue = screen.getByRole("region", { name: "Full specifier catalogue matches" });
    const labels = within(catalogue)
      .getAllByRole("link")
      .map((link) => link.querySelector("span")?.textContent ?? "");
    expect(labels.length).toBeGreaterThan(2);
    expect(labels).toEqual([...labels].sort(collator));
  });
});
