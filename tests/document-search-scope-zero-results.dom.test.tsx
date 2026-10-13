import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DocumentSearchResultsPanel } from "@/components/clinical-dashboard/document-search-results";
import { removeScopeFilterValue, scopeFilterChips } from "@/lib/search-scope-filter-chips";
import type { DocumentMatch, SearchScopeSummary } from "@/lib/types";

let mockSearchParams = new URLSearchParams();
afterEach(() => {
  mockSearchParams = new URLSearchParams();
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => mockSearchParams,
  usePathname: () => "/",
}));

vi.mock("@/lib/supabase/client", () => ({
  useAuthSession: () => ({
    status: "signed_out",
    session: null,
    isConfigured: true,
    authorizationHeader: () => null,
    registerAuthRequest: vi.fn(),
    isAuthEpochCurrent: () => true,
    markSessionExpired: vi.fn(),
  }),
}));

const baseProps = {
  matches: [],
  query: "Agitation",
  loading: false,
  documentCount: 2561,
  realDataReady: true,
  authUnavailable: false,
  apiUnavailable: false,
  setupWarning: null,
  onScopeDocument: vi.fn(),
  onAnswerFromDocument: vi.fn(),
  onOpenRecentDocuments: vi.fn(),
  onOpenLibrary: vi.fn(),
  onOpenSourcePdf: vi.fn(),
  onTagSearch: vi.fn(),
};

/**
 * The shape `/api/search` returns when `resolveSearchScope` finds no document
 * for the requested filters: it short-circuits before retrieval, so the result
 * set is empty and `scope` carries the only explanation.
 */
const agitationMatch: DocumentMatch = {
  document_id: "22222222-2222-4222-8222-222222222222",
  title: "Pharmacological Management Of Agitation And Arousal",
  file_name: "agitation-arousal.pdf",
  labels: [],
  summarySnippet: "Acute agitation management.",
  bestPages: [4],
  bestChunkIds: ["33333333-3333-4333-8333-333333333333"],
  imageCount: 0,
  tableCount: 0,
  matchReason: "Matched 1 indexed passage",
  score: 0.82,
};

const scopedToZero: SearchScopeSummary = {
  summary: "No matching documents",
  activeFilterCount: 1,
  matchedDocumentCount: 0,
  warnings: ["No indexed documents matched the selected label filters."],
  queryMode: "auto",
};

describe("documents zero-result state with an active scope filter", () => {
  it("names the filter instead of blaming the query", () => {
    render(
      <DocumentSearchResultsPanel
        {...baseProps}
        searchScope={scopedToZero}
        scopeFilters={{ topics: ["agitation"] }}
        onScopeFiltersChange={vi.fn()}
      />,
    );

    // The regression: a scoped-to-zero search told the reader to re-spell a
    // query that was never the problem, while the filter that emptied it was
    // neither named nor reachable (the Filter trigger is gated on matches > 0).
    expect(screen.queryByText(/check the spelling/i)).not.toBeInTheDocument();
    expect(screen.getByText(/no documents match the selected filter/i)).toBeInTheDocument();
    expect(screen.getByText(/the filters above excluded everything/i)).toBeInTheDocument();
    // Named in the one-tap undo, which is the whole point: the reader can see
    // what is constraining the search and relax it without leaving the state.
    expect(screen.getByRole("button", { name: /remove .*topic: agitation/i })).toBeInTheDocument();
  });

  it("relaxes the single filter that emptied the search", async () => {
    const onScopeFiltersChange = vi.fn();
    render(
      <DocumentSearchResultsPanel
        {...baseProps}
        searchScope={{ ...scopedToZero, activeFilterCount: 2 }}
        scopeFilters={{ topics: ["agitation"], documentTypes: ["guideline"] }}
        onScopeFiltersChange={onScopeFiltersChange}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /remove .*type: guideline/i }));
    expect(onScopeFiltersChange).toHaveBeenCalledWith({ topics: ["agitation"] });
  });

  it("clears every scope filter at once", async () => {
    const onScopeFiltersChange = vi.fn();
    render(
      <DocumentSearchResultsPanel
        {...baseProps}
        searchScope={{ ...scopedToZero, activeFilterCount: 2 }}
        scopeFilters={{ topics: ["agitation"], sites: ["FSH"] }}
        onScopeFiltersChange={onScopeFiltersChange}
      />,
    );

    // Only offered beyond a single filter — with one, "Remove …" already is the
    // clear-all, and two buttons doing the same thing is the defect this shared
    // state was built to avoid.
    await userEvent.click(screen.getByRole("button", { name: /clear all filters/i }));
    expect(onScopeFiltersChange).toHaveBeenCalledWith({});
  });

  it("keeps the query-based copy when nothing was scoped", () => {
    render(
      <DocumentSearchResultsPanel
        {...baseProps}
        searchScope={{
          summary: "All public documents",
          activeFilterCount: 0,
          matchedDocumentCount: null,
          warnings: [],
        }}
        scopeFilters={{}}
        onScopeFiltersChange={vi.fn()}
      />,
    );

    // An unscoped search really did fail to match, so the spelling hint is right
    // here — the fix must not relabel every empty result as filtered.
    expect(screen.getByText(/no matches for/i)).toBeInTheDocument();
    expect(screen.getByText(/check the spelling/i)).toBeInTheDocument();
  });
});

describe("documents zero-result state when retrieval degraded", () => {
  const degradedScope: SearchScopeSummary = {
    summary: "All public documents",
    activeFilterCount: 0,
    matchedDocumentCount: null,
    warnings: [],
    retrieval: { degraded: true, reason: "retrieval_rpc_error:match_document_chunks_text" },
  };

  it("refuses to present a failed search as an absence of guidance", () => {
    render(<DocumentSearchResultsPanel {...baseProps} searchScope={degradedScope} scopeFilters={{}} />);

    // The clinical point: `searchTextChunkCandidates` returns [] when an RPC
    // errors, so a broken index rendered as a confident "nothing found" — and a
    // clinician reads that as "no guideline covers this".
    expect(screen.getByText(/search could not complete/i)).toBeInTheDocument();
    expect(screen.getByText(/not a reliable .nothing found./i)).toBeInTheDocument();
    expect(screen.queryByText(/check the spelling/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no matches for/i)).not.toBeInTheDocument();
  });

  it("treats a failed search request the same way, instead of saying no matches", () => {
    // The whole /api/search request failed (for example a 503), so there is no scope summary at
    // all; the empty list used to read as "No matches ... check the spelling".
    render(<DocumentSearchResultsPanel {...baseProps} searchFailed scopeFilters={{}} />);

    expect(screen.getByText(/search could not complete/i)).toBeInTheDocument();
    expect(screen.queryByText(/check the spelling/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no matches for/i)).not.toBeInTheDocument();
  });

  it("offers Retry and keeps the failure reason inside the one degraded message", () => {
    const onRetrySearch = vi.fn();
    render(
      <DocumentSearchResultsPanel
        {...baseProps}
        searchFailed
        searchFailureReason="Search setup not ready."
        onRetrySearch={onRetrySearch}
        scopeFilters={{}}
      />,
    );

    expect(screen.getByText("Reason: Search setup not ready.")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("search-results-empty-retry"));
    expect(onRetrySearch).toHaveBeenCalledTimes(1);
  });

  it("outranks the filtered-to-zero copy, which also asserts a real zero", () => {
    render(
      <DocumentSearchResultsPanel
        {...baseProps}
        searchScope={{ ...degradedScope, activeFilterCount: 1 }}
        scopeFilters={{ topics: ["agitation"] }}
        onScopeFiltersChange={vi.fn()}
      />,
    );

    expect(screen.getByText(/search could not complete/i)).toBeInTheDocument();
    expect(screen.queryByText(/the filters above excluded everything/i)).not.toBeInTheDocument();
    // The relax control still stands: the filter may well be wrong too, and the
    // reader should not have to clear a degraded search to reach it.
    expect(screen.getByRole("button", { name: /remove .*topic: agitation/i })).toBeInTheDocument();
  });

  it("stops the headline asserting a trustworthy count above the failure notice", () => {
    render(<DocumentSearchResultsPanel {...baseProps} searchScope={degradedScope} scopeFilters={{}} />);

    // The band renders `matchCount` inside the only role="status" region here,
    // and the empty state suppresses its own live region once filters apply —
    // so a bare "0 documents" was the single thing announced, directly above
    // text saying the search could not complete.
    expect(screen.getByRole("status")).toHaveTextContent(/some sources unavailable/i);
  });

  it("marks a degraded search that DID return documents, which showed nothing before", () => {
    // The more dangerous half: with results on screen the zero-result state
    // never renders, so a partial list read as the complete answer.
    render(
      <DocumentSearchResultsPanel
        {...baseProps}
        matches={[agitationMatch]}
        searchScope={degradedScope}
        scopeFilters={{}}
      />,
    );

    // Result cards carry their own sr-only copy-status region, so scope the
    // assertion to the band rather than assuming a single status role.
    const announced = screen.getAllByRole("status").map((node) => node.textContent ?? "");
    expect(announced.some((text) => /some sources unavailable/i.test(text))).toBe(true);
    expect(screen.queryByText(/search could not complete/i)).not.toBeInTheDocument();
  });

  it("says nothing about degradation when retrieval was healthy", () => {
    render(
      <DocumentSearchResultsPanel
        {...baseProps}
        searchScope={{ ...degradedScope, retrieval: null }}
        scopeFilters={{}}
      />,
    );

    expect(screen.queryByText(/search could not complete/i)).not.toBeInTheDocument();
    expect(screen.getByText(/no matches for/i)).toBeInTheDocument();
  });
});

describe("scope filter chips", () => {
  it("names the group so a bare value is not ambiguous", () => {
    expect(scopeFilterChips({ topics: ["agitation"], sites: ["FSH"], locality: "local" })).toEqual([
      { id: "scope:topics:agitation", groupLabel: "Topic", valueLabel: "agitation" },
      { id: "scope:sites:FSH", groupLabel: "Site", valueLabel: "FSH" },
      { id: "scope:locality:local", groupLabel: "Locality", valueLabel: "Local" },
    ]);
  });

  it("drops a key that empties out so the search stops reporting itself as scoped", () => {
    expect(removeScopeFilterValue({ topics: ["agitation"] }, "scope:topics:agitation")).toEqual({});
  });

  it("keeps sibling values in the same group", () => {
    expect(removeScopeFilterValue({ topics: ["agitation", "delirium"] }, "scope:topics:agitation")).toEqual({
      topics: ["delirium"],
    });
  });

  it("removes the locality enum", () => {
    expect(removeScopeFilterValue({ locality: "local" }, "scope:locality:local")).toEqual({});
  });

  it("ignores an unknown chip rather than mutating the scope", () => {
    expect(removeScopeFilterValue({ topics: ["agitation"] }, "scope:topics:nope")).toEqual({
      topics: ["agitation"],
    });
  });
});

describe("documents hoisted filtered-to-zero empty state", () => {
  it("hoists the empty state full width directly beneath the header band when facet-filtered to zero", () => {
    const docA: DocumentMatch = {
      ...agitationMatch,
      document_id: "22222222-2222-4222-8222-222222222222",
      title: "Adult Acute Agitation Clinical Guideline",
      labels: [
        {
          id: "l1",
          document_id: "22222222-2222-4222-8222-222222222222",
          label_type: "population",
          label: "Adult",
          confidence: 0.95,
          source: "generated",
          metadata: { review_status: "approved" },
        },
        {
          id: "l2",
          document_id: "22222222-2222-4222-8222-222222222222",
          label_type: "setting",
          label: "Inpatient",
          confidence: 0.95,
          source: "generated",
          metadata: { review_status: "approved" },
        },
      ],
    };
    const docB: DocumentMatch = {
      ...agitationMatch,
      document_id: "33333333-3333-4333-8333-333333333333",
      title: "Paediatric Acute Agitation Clinical Guideline",
      labels: [
        {
          id: "l3",
          document_id: "33333333-3333-4333-8333-333333333333",
          label_type: "population",
          label: "Paediatric",
          confidence: 0.95,
          source: "generated",
          metadata: { review_status: "approved" },
        },
        {
          id: "l4",
          document_id: "33333333-3333-4333-8333-333333333333",
          label_type: "setting",
          label: "Outpatient",
          confidence: 0.95,
          source: "generated",
          metadata: { review_status: "approved" },
        },
      ],
    };

    // Stacking constraints across different facet groups (AND across groups) filters the combined set to zero
    mockSearchParams = new URLSearchParams("facet=population:adult,setting:outpatient");
    render(<DocumentSearchResultsPanel {...baseProps} matches={[docA, docB]} />);

    const emptyStateContainer = screen.getByTestId("document-filter-empty-results");
    expect(emptyStateContainer).toBeInTheDocument();
    expect(emptyStateContainer).toHaveClass("w-full");
    expect(screen.queryByTestId("document-result-card")).not.toBeInTheDocument();
  });
});
