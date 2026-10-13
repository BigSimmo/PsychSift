/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DictionarySourcesRedirect from "@/app/(search-app)/dictionary/sources/page";
import { SourcesCatalogueContent } from "@/components/sources/sources-catalogue-content";
import {
  SourceDetailPage,
  SourcesMethodPage,
  SourcesPublishersPage,
  SourcesTopicsPage,
} from "@/components/sources/sources-pages";
import { SOURCE_RATING_WEIGHTS, type ClinicalSourceCatalogueEntry } from "@/lib/sources/catalogue-types";
import { projectSourceCatalogueForClient } from "@/lib/sources/catalogue-view";
import { withTopBarLeadingSlot } from "./helpers/top-bar-slot";

// Cross-mode "also matches" panel is an AuthProvider-backed component of its own;
// it is exercised by tests/ui-universal-search.spec.ts, not by this page's unit test.
vi.mock("@/components/clinical-dashboard/universal-search-also-matches", () => ({
  UniversalSearchAlsoMatches: () => null,
}));
const loadCatalogueMock = vi.hoisted(() => vi.fn());
const routerReplace = vi.hoisted(() => vi.fn());
const routerPush = vi.hoisted(() => vi.fn());
const redirectMock = vi.hoisted(() => vi.fn());
let currentSearchParams = new URLSearchParams();
let currentPathname = "/sources/search";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/sources/load-source-catalogue", () => ({ loadSourceCatalogue: loadCatalogueMock }));
vi.mock("next/navigation", () => ({
  usePathname: () => currentPathname,
  useRouter: () => ({ replace: routerReplace, push: routerPush }),
  useSearchParams: () => currentSearchParams,
  redirect: redirectMock,
  notFound: vi.fn(),
}));

function sourceEntry(
  overrides: Partial<ClinicalSourceCatalogueEntry> & Pick<ClinicalSourceCatalogueEntry, "id" | "title">,
): ClinicalSourceCatalogueEntry {
  const { id, title, ...rest } = overrides;
  return {
    id,
    sourceId: id,
    title,
    aliases: [],
    version: "1",
    publisher: "RANZCP",
    publisherCode: "RANZCP",
    sourceType: "guideline",
    canonicalLocation: { kind: "url", href: "https://www.ranzcp.org/example" },
    geography: { scope: "australian_national", label: "Australia" },
    topics: ["governance"],
    publicationDate: "2025-01-01",
    reviewDate: "2026-01-01",
    expiryDate: null,
    documentStatus: "current",
    validationStatus: "approved",
    contentMode: "link_only",
    lifecycleStatus: "active",
    supersedes: [],
    supersededBy: [],
    usedBy: [
      {
        modeId: "dictionary",
        recordId: "mental-state-examination",
        recordLabel: "Mental state examination",
        field: "definition",
      },
    ],
    rating: {
      score: 90,
      band: "A",
      weights: SOURCE_RATING_WEIGHTS,
      dimensions: {
        accuracyAssurance: 25,
        reliability: 20,
        evidenceQuality: 20,
        currency: 15,
        australianApplicability: 10,
        traceability: 0,
      },
      reasons: ["Accuracy assurance: 25/25"],
    },
    warnings: [],
    ...rest,
  };
}

const fixtureEntries: ClinicalSourceCatalogueEntry[] = [
  sourceEntry({ id: "src_a", title: "Zulu Australian guideline" }),
  sourceEntry({
    id: "src_d",
    title: "Alpha review source",
    publisher: "Legacy Publisher",
    publisherCode: null,
    sourceType: "professional_reference",
    canonicalLocation: { kind: "dataset", label: "Structured clinical catalogue" },
    geography: { scope: "international", label: "International" },
    topics: ["assessment"],
    documentStatus: "review_due",
    validationStatus: "unverified",
    usedBy: [{ modeId: "factsheets", recordId: "depression", recordLabel: "Depression", field: "sources" }],
    rating: {
      score: 45,
      band: "D",
      weights: SOURCE_RATING_WEIGHTS,
      dimensions: {
        accuracyAssurance: 5,
        reliability: 8,
        evidenceQuality: 12,
        currency: 8,
        australianApplicability: 6,
        traceability: 5,
      },
      reasons: ["Material identity or verification uncertainty requires review"],
    },
    warnings: ["verification_unknown"],
  }),
];

/**
 * The catalogue route is sliced, filtered and counted on the server now, so the
 * page under test is `SourcesCatalogueContent` — the synchronous server half —
 * rather than the client component, which no longer receives the whole
 * catalogue or parses the URL itself. `currentSearchParams` still drives the
 * mocked `useSearchParams` because the client keeps building the links it
 * navigates to from it, so one assignment continues to configure both halves.
 */
function catalogue(hostedDocuments: "available" | "unavailable") {
  return (
    <SourcesCatalogueContent
      entries={projectSourceCatalogueForClient(fixtureEntries)}
      hostedDocuments={hostedDocuments}
      searchParams={currentSearchParams}
    />
  );
}

beforeEach(() => {
  currentSearchParams = new URLSearchParams();
  currentPathname = "/sources/search";
  routerReplace.mockReset();
  redirectMock.mockReset();
  loadCatalogueMock.mockReset();
  loadCatalogueMock.mockResolvedValue({ entries: fixtureEntries, hostedDocuments: "unavailable" });
});

afterEach(cleanup);

describe("Sources catalogue", () => {
  it("leads with the sources themselves, each carrying its band and where it is used", () => {
    render(catalogue("available"));

    // No page title block, no count tiles, no panel of selects before the results.
    expect(screen.getByRole("heading", { level: 1, name: "Source catalogue" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByText(/Visible sources|Inactive or excluded/)).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("2 sources");
    expect(screen.getAllByText("A · Preferred")[0]).toBeVisible();
    // The usage line now says how much of the app leans on the source, and the
    // meta line carries its kind and its currency.
    expect(screen.getByText(/Used in Dictionary · 1 record/)).toBeVisible();
    expect(screen.getByText(/Used in Factsheets · 1 record/)).toBeVisible();
    expect(screen.getByText(/RANZCP · Australia · Guideline/)).toBeVisible();
    expect(screen.getAllByText(/reviewed Jan 2026/)[0]).toBeVisible();
    expect(screen.queryByText(/storage_path|owner_id|patient/i)).not.toBeInTheDocument();
  });

  it("keeps governance codes off the card and shows only states that change a decision", () => {
    render(catalogue("available"));

    // `verification_unknown` is review bookkeeping; `review_due` is not.
    expect(screen.queryByText(/verification unknown/i)).not.toBeInTheDocument();
    expect(screen.getByText("Review due")).toBeVisible();
    expect(screen.queryByTestId("sources-partial-catalogue-note")).not.toBeInTheDocument();
  });

  it("says the list is incomplete when the hosted-document loader cannot be reached", () => {
    render(catalogue("unavailable"));

    // The count is wrong in this state, so the reader has to be told before
    // reading it as the whole registry.
    expect(screen.getByTestId("sources-partial-catalogue-note")).toHaveTextContent(
      "Uploaded document sources cannot be reached, so this list and its count are incomplete.",
    );
  });

  it("reads application usage from the URL and narrows the visible sources", () => {
    currentSearchParams = new URLSearchParams("usedBy=dictionary");
    const view = render(catalogue("available"));

    expect(screen.getByRole("status")).toHaveTextContent("1 source");
    expect(screen.getByText("Zulu Australian guideline")).toBeVisible();
    expect(screen.queryByText("Alpha review source")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Used in: Dictionary filter" })).toBeVisible();

    view.unmount();
    currentSearchParams = new URLSearchParams("band=D&publisher=Legacy+Publisher");
    render(catalogue("available"));
    expect(screen.getByRole("status")).toHaveTextContent("1 source");
    expect(screen.getByText("Alpha review source")).toBeVisible();
  });

  it("surfaces every applied filter as its own chip, including one only a deep link can set", () => {
    currentSearchParams = new URLSearchParams(
      "band=A&band=D&usedBy=dictionary&usedBy=factsheets&publisher=Legacy+Publisher",
    );
    render(catalogue("available"));

    for (const name of [
      "Remove Quality band: A · Preferred filter",
      "Remove Quality band: D · Review required filter",
      "Remove Used in: Dictionary filter",
      "Remove Used in: Factsheets filter",
      "Remove Publisher: Legacy Publisher filter",
    ]) {
      expect(screen.getByRole("button", { name })).toBeVisible();
    }

    fireEvent.click(screen.getByRole("button", { name: "Remove Quality band: D · Review required filter" }));
    expect(routerReplace).toHaveBeenLastCalledWith(
      "/sources/search?usedBy=dictionary&usedBy=factsheets&publisher=Legacy+Publisher&band=A",
      { scroll: false },
    );
  });

  it("removes a comma-delimited filter value while preserving its siblings", () => {
    currentSearchParams = new URLSearchParams("band=A%2CD&usedBy=dictionary");
    render(catalogue("available"));

    fireEvent.click(screen.getByRole("button", { name: "Remove Quality band: D · Review required filter" }));

    expect(routerReplace).toHaveBeenLastCalledWith("/sources/search?usedBy=dictionary&band=A", { scroll: false });
  });

  it("sorts by quality by default, honours an ordering deep link, and clears filters while keeping the query", () => {
    const quality = render(catalogue("available"));
    const qualityTitles = screen.getAllByRole("link", { name: /view source details/i });
    expect(qualityTitles[0]).toHaveAccessibleName(/Zulu Australian guideline/);

    quality.unmount();
    currentSearchParams = new URLSearchParams("sort=title");
    const title = render(catalogue("available"));
    expect(screen.getAllByRole("link", { name: /view source details/i })[0]).toHaveAccessibleName(
      /Alpha review source/,
    );

    title.unmount();
    currentSearchParams = new URLSearchParams("q=ranzcp&band=A&publisher=Legacy+Publisher");
    render(catalogue("available"));
    expect(screen.getByRole("status")).toHaveTextContent("0 sources");
    fireEvent.click(screen.getAllByRole("button", { name: /clear all filters|clear filters/i })[0]);
    expect(routerReplace).toHaveBeenLastCalledWith("/sources/search?q=ranzcp", { scroll: false });
  });
});

describe("Sources browse tabs", () => {
  it("puts the catalogue's own results band on Topics, counting topics rather than sources", async () => {
    currentPathname = "/sources/topics";
    render(await SourcesTopicsPage());

    // The page keeps its name for the outline, but paints no header or breadcrumb.
    expect(screen.getByRole("heading", { level: 1, name: "Topics" })).toHaveClass("sr-only");
    expect(screen.queryByRole("navigation", { name: /breadcrumb/i })).not.toBeInTheDocument();
    expect(screen.getByTestId("search-query-ribbon")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("2 topics");
    expect(screen.getByTestId("sources-topic-filter-trigger-desktop")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View Governance sources" })).toHaveAttribute(
      "href",
      "/sources/search?topic=governance",
    );
  });

  it("says what the sources under a topic are worth, not just how many there are", async () => {
    currentPathname = "/sources/topics";
    render(await SourcesTopicsPage());

    const governance = screen.getByRole("link", { name: "View Governance sources" });
    expect(within(governance).getByText(/1 preferred/)).toBeVisible();

    // Band colour is never the only channel: the review-due entry states its
    // attention in words beside the meter.
    const assessment = screen.getByRole("link", { name: "View Assessment sources" });
    expect(within(assessment).getByText(/1 needs review/)).toBeVisible();
    expect(within(assessment).getByText(/1 needs attention/)).toBeVisible();
  });

  it("narrows the browse list by the composer query instead of ignoring it", async () => {
    currentPathname = "/sources/topics";
    currentSearchParams = new URLSearchParams("q=governance");
    render(await SourcesTopicsPage());

    expect(screen.getByRole("status")).toHaveTextContent("1 topic");
    expect(screen.getByRole("link", { name: "View Governance sources" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "View Assessment sources" })).not.toBeInTheDocument();
  });

  it("offers a way out when a query or a filter empties the list", async () => {
    currentPathname = "/sources/topics";
    currentSearchParams = new URLSearchParams("q=electroconvulsive");
    render(await SourcesTopicsPage());

    expect(screen.getByRole("status")).toHaveTextContent("0 topics");
    expect(screen.getByText(/No matches for .electroconvulsive./)).toBeVisible();
    expect(screen.getByTestId("search-results-empty-clear-search")).toBeVisible();
  });

  it("shows an applied jurisdiction filter as a removable chip on its own route", async () => {
    currentPathname = "/sources/topics";
    currentSearchParams = new URLSearchParams("jurisdiction=international&band=D");
    render(await SourcesTopicsPage());

    expect(screen.getByRole("status")).toHaveTextContent("1 topic");
    expect(screen.getByRole("button", { name: "Remove Jurisdiction: International filter" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Remove Quality band: D · Review required filter" }));
    expect(routerReplace).toHaveBeenLastCalledWith("/sources/topics?jurisdiction=international", { scroll: false });
  });

  it("clears the query without silently discarding the filters beside it", async () => {
    currentPathname = "/sources/topics";
    currentSearchParams = new URLSearchParams("q=electroconvulsive&jurisdiction=international");
    render(await SourcesTopicsPage());

    // The empty state offers filter removal as its own control, so a
    // "Clear search" that also wiped the jurisdiction would make one of the two
    // controls a lie about what it does.
    fireEvent.click(screen.getByTestId("search-results-empty-clear-search"));
    expect(routerPush).toHaveBeenLastCalledWith("/sources/topics?jurisdiction=international");
  });

  it("tells both browse tabs that their counts are incomplete when documents cannot be reached", async () => {
    currentPathname = "/sources/topics";
    const topics = render(await SourcesTopicsPage());
    expect(screen.getByTestId("sources-partial-catalogue-note")).toHaveTextContent(
      "Uploaded document sources cannot be reached, so this list and its counts are incomplete.",
    );

    topics.unmount();
    currentPathname = "/sources/publishers";
    render(await SourcesPublishersPage());
    expect(screen.getByTestId("sources-partial-catalogue-note")).toBeVisible();
  });

  it("keeps jurisdiction sections on Publishers and links each row to its filtered catalogue", async () => {
    currentPathname = "/sources/publishers";
    render(await SourcesPublishersPage());

    expect(screen.getByRole("heading", { level: 1, name: "Publishers" })).toHaveClass("sr-only");
    expect(screen.getByRole("status")).toHaveTextContent("2 publishers");
    expect(screen.getByRole("heading", { level: 2, name: "Australian national" })).toBeVisible();
    expect(screen.getByRole("heading", { level: 2, name: "International" })).toBeVisible();
    expect(screen.getByRole("link", { name: "View RANZCP sources" })).toHaveAttribute(
      "href",
      "/sources/search?publisher=RANZCP&jurisdiction=australian_national",
    );
  });

  it("keeps publisher jurisdiction-group counts aligned with their catalogue links", async () => {
    currentPathname = "/sources/publishers";
    loadCatalogueMock.mockResolvedValueOnce({
      entries: [
        fixtureEntries[0],
        sourceEntry({
          id: "src_ranzcp_international",
          title: "RANZCP international source",
          geography: { scope: "international", label: "International" },
        }),
      ],
      hostedDocuments: "available",
    });

    render(await SourcesPublishersPage());

    const links = screen.getAllByRole("link", { name: "View RANZCP sources" });
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/sources/search?publisher=RANZCP&jurisdiction=australian_national",
      "/sources/search?publisher=RANZCP&jurisdiction=international",
    ]);
    expect(links).toHaveLength(2);
  });

  it("frames an unrecorded jurisdiction as a gap in the records rather than a place", async () => {
    currentPathname = "/sources/publishers";
    loadCatalogueMock.mockResolvedValueOnce({
      entries: [
        sourceEntry({
          id: "src_unplaced",
          title: "Unplaced reference",
          publisher: "Beyond Blue",
          geography: { scope: "unknown", label: "Unknown jurisdiction" },
        }),
      ],
      hostedDocuments: "available",
    });

    render(await SourcesPublishersPage());

    expect(screen.getByRole("heading", { level: 2, name: "Unknown jurisdiction" })).toBeVisible();
    expect(screen.getByText(/The catalogue does not infer one/)).toBeVisible();
  });
});

describe("Sources method and record", () => {
  withTopBarLeadingSlot();

  it("publishes every weight, threshold and limitation on Method", () => {
    render(<SourcesMethodPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Method" })).toHaveClass("sr-only");

    // Every dimension, with the points read from the scoring weights rather than
    // re-typed here — a re-weighting that missed the page would fail this.
    const dimensions = screen.getByRole("region", { name: "Rating dimensions" });
    for (const [label, points] of [
      ["Accuracy assurance", SOURCE_RATING_WEIGHTS.accuracyAssurance],
      ["Reliability", SOURCE_RATING_WEIGHTS.reliability],
      ["Evidence quality", SOURCE_RATING_WEIGHTS.evidenceQuality],
      ["Currency", SOURCE_RATING_WEIGHTS.currency],
      ["Australian applicability", SOURCE_RATING_WEIGHTS.australianApplicability],
      ["Traceability", SOURCE_RATING_WEIGHTS.traceability],
    ] as const) {
      expect(within(dimensions).getByText(label)).toBeVisible();
      expect(within(dimensions).getAllByText(`${points} points`).length).toBeGreaterThan(0);
    }

    // Every published threshold, and the two bands that are not reached by score.
    const bands = screen.getByRole("region", { name: "Quality bands" });
    expect(within(bands).getByText("85–100")).toBeVisible();
    expect(within(bands).getByText("70–84")).toBeVisible();
    expect(within(bands).getByText("50–69")).toBeVisible();
    expect(
      within(bands).getByText(/Below 50, incomplete metadata, or material identity or verification uncertainty/i),
    ).toBeVisible();
    expect(
      within(bands).getByText(/Applied before any score when lifecycle or governance rules reject/i),
    ).toBeVisible();

    // Every limitation, including the governance disclaimer.
    const limits = screen.getByRole("region", { name: "Boundaries and missing data" });
    expect(within(limits).getByText(/Australian applicability is bounded/i)).toBeVisible();
    expect(within(limits).getByText(/Missing fields remain unknown/i)).toBeVisible();
    expect(
      within(limits).getByText(
        /Missing publisher, version, dates, jurisdiction, evidence type or validation.*D · Review required/i,
      ),
    ).toBeVisible();
    expect(within(limits).getByText(/past expiry.*no current currency credit/i)).toBeVisible();
    expect(within(limits).getByText(/identified replacement.*excluded/i)).toBeVisible();
    expect(within(limits).getByText(/not RAG relevance or patient-specific guidance/i)).toBeVisible();

    const definitions = screen.getByRole("region", { name: "Catalogue status definitions" });
    for (const label of [
      "Current",
      "Review due",
      "Outdated",
      "Unknown currentness",
      "Approved",
      "Locally reviewed",
      "Unverified",
      "Unknown validation",
      "Active",
      "Inactive",
      "Excluded",
      "Indexed content",
      "Link only",
      "Metadata only",
    ]) {
      expect(within(definitions).getByText(label)).toBeVisible();
    }
    expect(
      within(definitions).getByText(/explicit upstream status says the source is due for structured review/i),
    ).toBeVisible();
    expect(within(definitions).getByText(/malformed expiry.*currentness remains unknown/i)).toBeVisible();
    expect(within(definitions).getByText(/content can be searched inside the application/i)).toBeVisible();
  });

  it("names every place the source is used, grouped by area and linked to the record", async () => {
    render(await SourceDetailPage({ sourceId: "src_a" }));

    expect(screen.getByRole("heading", { level: 1, name: "Zulu Australian guideline" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Back to sources" })).toHaveAttribute("href", "/sources/search");
    expect(screen.queryByRole("navigation", { name: /breadcrumb/i })).not.toBeInTheDocument();

    const usage = screen.getByRole("region", { name: "Where this source is used" });
    expect(within(usage).getByText("1 record across 1 area")).toBeVisible();
    expect(within(usage).getByRole("heading", { level: 3, name: /Dictionary/ })).toBeVisible();
    expect(within(usage).getByRole("link", { name: /Mental state examination/ })).toHaveAttribute(
      "href",
      "/dictionary/mental-state-examination",
    );
    expect(within(usage).getByText("Supports the definition")).toBeVisible();
  });

  it("keeps the record compact: band and score stay, scoring workings and empty fields go", async () => {
    render(await SourceDetailPage({ sourceId: "src_a" }));

    expect(screen.getByText("A · Preferred")).toBeVisible();
    expect(screen.getByText("Review score 90/100")).toBeVisible();
    expect(screen.getByRole("link", { name: /open canonical source/i })).toHaveAttribute(
      "href",
      "https://www.ranzcp.org/example",
    );
    // Scoring workings and never-populated traceability lines are gone.
    expect(screen.queryByText("Accuracy assurance: 25/25")).not.toBeInTheDocument();
    expect(screen.queryByText(/Aliases/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Supersedes/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Publisher code|Content mode|Validation/)).not.toBeInTheDocument();
    // A clean source says nothing about review.
    expect(screen.queryByRole("region", { name: /needs review/i })).not.toBeInTheDocument();
  });

  it("routes each quality band on Method to the sources carrying it", () => {
    render(<SourcesMethodPage />);

    for (const [band, label] of [
      ["A", "A · Preferred"],
      ["B", "B · Strong"],
      ["C", "C · Supplementary"],
      ["D", "D · Review required"],
      ["excluded", "Excluded"],
    ] as const) {
      expect(screen.getByRole("link", { name: `Browse ${label}` })).toHaveAttribute(
        "href",
        `/sources/search?band=${band}`,
      );
    }

    // The definitions themselves stay prose; a link is not wrapped around one.
    const reviewRequired = screen.getByText(
      /Below 50, incomplete metadata, or material identity or verification uncertainty/i,
    );
    expect(reviewRequired).toBeVisible();
    expect(reviewRequired.closest("a")).toBeNull();
  });

  it("turns the record's topics and publisher into routes back into the catalogue", async () => {
    render(await SourceDetailPage({ sourceId: "src_a" }));

    expect(screen.getByRole("link", { name: "Governance" })).toHaveAttribute(
      "href",
      "/sources/search?topic=governance",
    );
    expect(screen.getByRole("link", { name: "RANZCP" })).toHaveAttribute(
      "href",
      "/sources/search?publisher=RANZCP&jurisdiction=australian_national",
    );
  });

  it("says what is wrong with a questionable source rather than leaving the band to imply it", async () => {
    render(await SourceDetailPage({ sourceId: "src_d" }));

    const review = screen.getByRole("region", { name: "Needs review before you rely on this" });
    expect(within(review).getByText("Whether this source has been verified is unknown")).toBeVisible();
    expect(within(review).getByText("Marked as not yet clinically verified")).toBeVisible();
    // The stored codes stay out of reader-facing text.
    expect(review.textContent).not.toMatch(/verification_unknown|ambiguous_identity/);
  });
});

describe("Dictionary Sources compatibility redirect", () => {
  it("preserves incoming query values and forces dictionary application usage", async () => {
    await DictionarySourcesRedirect({
      searchParams: Promise.resolve({ q: "RANZCP", band: ["A", "D"], usedBy: "factsheets" }),
    });
    expect(redirectMock).toHaveBeenCalledWith("/sources/search?q=RANZCP&band=A&band=D&usedBy=dictionary");
  });
});
