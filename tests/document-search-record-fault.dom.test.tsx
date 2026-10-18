import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentSearchResultsPanel } from "@/components/clinical-dashboard/document-search-results";
import type { DocumentMatch } from "@/lib/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/services",
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
  recordMatches: [],
  recordMode: "services" as const,
  showRecordMatches: true,
  query: "crisis",
  loading: false,
  documentCount: 0,
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

const lithiumMatch: DocumentMatch = {
  document_id: "11111111-1111-4111-8111-111111111111",
  title: "Lithium Clinical Guideline",
  file_name: "lithium-guideline.pdf",
  labels: [],
  summarySnippet: "Lithium monitoring guidance.",
  bestPages: [3],
  bestChunkIds: ["44444444-4444-4444-8444-444444444444"],
  imageCount: 2,
  tableCount: 0,
  matchReason: "Matched indexed passage",
  score: 0.96,
};

describe("document search record path fault reporting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports a failed registry once, not twice", () => {
    render(<DocumentSearchResultsPanel {...baseProps} recordStatus="error" />);

    // The band owns the failure. The legacy notice repeating "Couldn't load the
    // services registry" underneath it is the double-report this guards.
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.queryByText(/Couldn't load the services registry/i)).toBeNull();
  });

  it("still reports an expired session once", () => {
    render(<DocumentSearchResultsPanel {...baseProps} recordStatus="unauthorized" />);

    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.queryByText(/search your private services registry/i)).toBeNull();
  });

  it("keeps the loading notice, which the band does not duplicate", () => {
    // The band only says "Searching…" while loading, so this notice is the only
    // thing naming the registry — suppressing it here would lose information.
    render(<DocumentSearchResultsPanel {...baseProps} recordStatus="loading" />);

    expect(screen.getByText(/Loading your services registry/i)).toBeInTheDocument();
  });

  it("keeps document results free of the selected-evidence panel and scope/governance banner", () => {
    render(
      <DocumentSearchResultsPanel
        {...baseProps}
        matches={[lithiumMatch]}
        recordMatches={[]}
        showRecordMatches={false}
        query="lithium"
      />,
    );

    expect(screen.getAllByText(lithiumMatch.title).length).toBeGreaterThan(0);
    expect(screen.queryByRole("complementary", { name: "Selected document evidence" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Preview evidence/i })).toBeNull();
    expect(screen.queryByText("1 source marked outdated.")).toBeNull();
    expect(screen.queryByText("1 source due for review.")).toBeNull();
    expect(screen.queryByText(/^Scope:/)).toBeNull();
    const resultCard = screen.getByTestId("document-result-card");
    expect(within(resultCard).getByTestId("document-result-rank")).toHaveTextContent("1");
    expect(within(resultCard).queryByText("PDF", { exact: true })).toBeNull();
    expect(
      within(resultCard).getByRole("link", { name: `Preview page 3 of ${lithiumMatch.title}` }),
    ).toBeInTheDocument();
    expect(within(resultCard).getByRole("link", { name: `Open ${lithiumMatch.title}` })).toHaveTextContent("Open");

    const askButton = within(resultCard).getByRole("button", { name: `Ask about ${lithiumMatch.title}` });
    fireEvent.click(askButton);
    expect(baseProps.onAnswerFromDocument).toHaveBeenCalledWith(lithiumMatch.document_id);

    expect(within(resultCard).queryByRole("button", { name: /Scope search to/i })).toBeNull();
    const moreButton = within(resultCard).getByRole("button", { name: `More actions for ${lithiumMatch.title}` });
    fireEvent.click(moreButton);
    expect(within(resultCard).queryByRole("menu")).toBeNull();
    const menu = screen.getByTestId("document-result-more-menu");
    expect(within(menu).getByRole("menuitem", { name: "Copy citation" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Copy link" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "View images (2)" })).toBeInTheDocument();

    fireEvent.click(within(menu).getByRole("menuitem", { name: "Search only this source" }));
    expect(baseProps.onScopeDocument).toHaveBeenCalledWith(lithiumMatch.document_id);
  });

  it("coalesces more-menu viewport events into one animation-frame measurement", () => {
    const pendingFrames: Array<(time: number) => void> = [];
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      pendingFrames.push(callback as (time: number) => void);
      return pendingFrames.length;
    });
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 20,
      y: 20,
      left: 20,
      top: 20,
      right: 120,
      bottom: 60,
      width: 100,
      height: 40,
      toJSON: () => ({}),
    } as DOMRect);

    try {
      render(
        <DocumentSearchResultsPanel
          {...baseProps}
          matches={[lithiumMatch]}
          recordMatches={[]}
          showRecordMatches={false}
          query="lithium"
        />,
      );

      const resultCard = screen.getByTestId("document-result-card");
      fireEvent.click(within(resultCard).getByRole("button", { name: `More actions for ${lithiumMatch.title}` }));
      expect(screen.getByTestId("document-result-more-menu")).toBeInTheDocument();
      expect(pendingFrames).toHaveLength(1);
      act(() => pendingFrames.shift()?.(0));
      const measuredCalls = rect.mock.calls.length;

      act(() => {
        window.dispatchEvent(new Event("scroll"));
        window.dispatchEvent(new Event("scroll"));
        window.dispatchEvent(new Event("resize"));
      });

      expect(pendingFrames).toHaveLength(1);
      expect(rect).toHaveBeenCalledTimes(measuredCalls);
      act(() => pendingFrames.shift()?.(16));
      expect(rect).toHaveBeenCalledTimes(measuredCalls + 2);
    } finally {
      raf.mockRestore();
      rect.mockRestore();
    }
  });
});

describe("forms record subtitle compaction", () => {
  const longPurpose =
    "Use the current approved Form 12C attachment to record record of confirmation, amendment or revocation of restriction of freedom of communication when the statutory and local requirements are met.";

  it("preserves full form purpose text without services-mode compaction", () => {
    render(
      <DocumentSearchResultsPanel
        {...baseProps}
        recordMode="forms"
        recordMatches={[
          {
            service: {
              slug: "form-12c-attachment",
              title: "Form 12C attachment",
              subtitle: longPurpose,
            },
            score: 0.9,
            reasons: ["Matched purpose"],
          },
        ]}
      />,
    );

    const card = screen.getByTestId("form-search-result-form-12c-attachment");
    expect(within(card).getByText(longPurpose)).toBeInTheDocument();
    expect(longPurpose.length).toBeGreaterThan(120);
    expect(within(card).getByText(/statutory and local requirements are met\./)).toBeInTheDocument();
  });
});

describe("library reachability on the record-match path", () => {
  // A services search that matched records but no documents. This render used to
  // return `null` outright, so once Library moved off the utility rail its three
  // homes — the sheet footer, the zero-result empty state, the inline fallback —
  // all missed this path: the footer needs `matches.length > 0` and the empty
  // state needs `recordMatchCount === 0`. The reader was left with no route to
  // the corpus that did not first destroy the search they were reading, which is
  // the exact thing `docs/search-results-bar-decisions.md` requires be kept.
  const recordOnlyProps = {
    ...baseProps,
    matches: [],
    documentCount: 2014,
    recordMatches: [
      {
        service: { slug: "crisis-line", title: "Crisis line" },
        score: 0.9,
        reasons: ["Matched service name"],
      },
    ],
  };

  it("offers Browse all sources when records matched but no documents did", async () => {
    const user = userEvent.setup();
    const onOpenLibrary = vi.fn();
    render(<DocumentSearchResultsPanel {...recordOnlyProps} onOpenLibrary={onOpenLibrary} />);

    const browse = screen.getByTestId("document-results-browse-library");
    expect(browse).toBeVisible();
    expect(browse).toHaveTextContent("2,014");

    await user.click(browse);
    expect(onOpenLibrary).toHaveBeenCalledTimes(1);
  });
});

describe("document search state matrix", () => {
  const documentProps = {
    ...baseProps,
    showRecordMatches: false,
    recordMatches: [],
  };

  it("announces loading and replaces it with the empty result after the request settles", () => {
    const { rerender } = render(<DocumentSearchResultsPanel {...documentProps} query="lithium" loading />);

    const loadingLabel = screen.getByText("Finding matching documents");
    expect(loadingLabel.closest('[role="status"]')).toBeInTheDocument();
    // The zero-match branch adopted `SearchResultsEmptyState` so Library stays
    // reachable from a search that returned nothing, which changed the heading
    // from "No matching documents" to the shared "No matches for <query>".
    expect(screen.queryByText("No matches for “lithium”")).not.toBeInTheDocument();

    rerender(<DocumentSearchResultsPanel {...documentProps} query="lithium" loading={false} />);
    expect(screen.queryByText("Finding matching documents")).not.toBeInTheDocument();
    // A heading, not a paragraph. This state owns its region, so #1612 gave it
    // `h3`; adopting the shared empty state initially demoted it back to `<p>`
    // and the only thing that caught it was a Chromium journey. Pin the level
    // here so the fast gate carries it.
    expect(screen.getByRole("heading", { level: 3, name: "No matches for “lithium”" })).toBeInTheDocument();
  });

  it("renders the document home for an empty query and wires every escape action", async () => {
    const user = userEvent.setup();
    const onOpenRecentDocuments = vi.fn();
    const onOpenLibrary = vi.fn();
    const onOpenSourcePdf = vi.fn();
    render(
      <DocumentSearchResultsPanel
        {...documentProps}
        query=""
        onOpenRecentDocuments={onOpenRecentDocuments}
        onOpenLibrary={onOpenLibrary}
        onOpenSourcePdf={onOpenSourcePdf}
      />,
    );

    expect(screen.getByTestId("document-search-empty-state")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Recent documents/i }));
    await user.click(screen.getByRole("button", { name: /Browse library/i }));
    await user.click(screen.getByRole("button", { name: /Open a source PDF/i }));
    expect(onOpenRecentDocuments).toHaveBeenCalledTimes(1);
    expect(onOpenLibrary).toHaveBeenCalledTimes(1);
    expect(onOpenSourcePdf).toHaveBeenCalledTimes(1);
  });

  it("reports an unavailable document search once with its reason and recovery", async () => {
    render(<DocumentSearchResultsPanel {...documentProps} query="lithium" realDataReady={false} apiUnavailable />);

    expect(screen.getByRole("heading", { level: 3, name: "Search could not complete" })).toBeInTheDocument();
    const reason = screen.getByText(/^Reason:/);
    expect(reason).toHaveTextContent(/PsychSift could not be reached|The local API is unavailable/);
    expect(screen.getByRole("button", { name: "Browse all sources" })).toBeInTheDocument();
    expect(screen.queryByText(/No matches for|0 documents/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(within(screen.getByTestId("search-query-ribbon")).queryByRole("status")).toBeNull();

    const liveRegions = screen.getByTestId("document-search-workspace").querySelectorAll('[aria-live="polite"]');
    expect(liveRegions).toHaveLength(1);
    await waitFor(() => {
      expect(liveRegions[0]).toHaveTextContent("Search could not complete");
      expect(liveRegions[0]).toHaveTextContent(reason.textContent!);
    });
  });
});
