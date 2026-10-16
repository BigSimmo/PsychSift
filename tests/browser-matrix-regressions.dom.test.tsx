/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SpecifiersHomePage } from "@/components/specifiers/specifiers-home-page";
import { IndexedTextPanel } from "@/components/document-viewer/source-panels";
import { ToolsSearchResultsPage } from "@/components/tools/tools-search-results-page";

const authSession = vi.hoisted(() => ({
  status: "signed_out" as string,
  session: null,
  isConfigured: true,
  error: null,
  notice: null,
  signInWithEmail: vi.fn(),
  signInWithPassword: vi.fn(),
  signUpWithPassword: vi.fn(),
  signInWithOAuth: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  useAuthSession: () => authSession,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/specifiers",
  useSearchParams: () => new URLSearchParams(typeof window !== "undefined" ? window.location.search : ""),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/clinical-dashboard/use-saved-registry-favourites", () => ({
  useSavedRegistryFavourites: () => ({
    items: [],
    status: "ready",
    registryStatus: "ready",
    refetch: () => undefined,
  }),
}));

vi.mock("@/components/clinical-dashboard/search-command-context", () => ({
  useSearchCommand: () => null,
}));

vi.mock("@/components/clinical-dashboard/universal-search-also-matches", () => ({
  UniversalSearchAlsoMatches: () => null,
}));

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("Browser matrix settlement regressions", () => {
  describe("Specifiers Top match settlement (#HN9RD0)", () => {
    it("renders exactly 1 'Top match' badge when searching with matching guides", () => {
      window.history.replaceState(null, "", "/specifiers?q=bipolar&scope=guides");
      render(<SpecifiersHomePage query="bipolar" autoRunSearch />);

      const topMatches = screen.getAllByText("Top match");
      expect(topMatches).toHaveLength(1);
      expect(topMatches[0]).toBeVisible();
    });

    it("renders 0 'Top match' badges when in browsing mode", () => {
      window.history.replaceState(null, "", "/specifiers");
      render(<SpecifiersHomePage query="" autoRunSearch />);

      expect(screen.queryByText("Top match")).toBeNull();
    });
  });

  describe("Document viewer source-panels hit navigation and Gecko disclosure settlement (#33346A / #9Z197J)", () => {
    const basePage = {
      id: "page-1",
      page_number: 1,
      text: "Page body with vomiting and monitoring details",
      ocr_used: false,
      image_url: null,
      aspect_ratio: 1.414,
      width_px: 1000,
      height_px: 1414,
    };
    const baseChunk = {
      id: "chunk-1",
      document_id: "doc-1",
      page_number: 1,
      chunk_index: 0,
      section_heading: "Monitoring",
      content: "Escalate review when there is vomiting",
      token_count: 50,
      image_ids: [],
    };

    it("advances hit from 1 to 2 cleanly and resists Gecko toggle storm resets", () => {
      const props = {
        loading: false,
        selectedPage: basePage,
        chunks: [
          baseChunk,
          {
            ...baseChunk,
            id: "chunk-2",
            chunk_index: 1,
            content: "Lithium levels are checked 5 to 7 days after initiation",
          },
        ],
        search: "vom",
        documentSearchResults: [
          {
            id: "chunk-1",
            page_number: 1,
            chunk_index: 0,
            section_heading: "Monitoring",
            snippet: "Escalate review when there is vomiting",
            matched_terms: ["vom"],
            image_ids: [],
            score: 1,
          },
          {
            id: "chunk-2",
            page_number: 1,
            chunk_index: 1,
            section_heading: "Monitoring",
            snippet: "Lithium levels are checked 5 to 7 days after initiation",
            matched_terms: ["vom"],
            image_ids: [],
            score: 1,
          },
        ],
        searchingDocument: false,
        documentSearchError: null,
        idPrefix: "source-chunk",
        sectionId: "source-text" as const,
        onSearchChange: vi.fn(),
        compact: true,
      };

      render(<IndexedTextPanel {...props} />);

      const panel = screen.getByTestId("source-chunk-indexed-text-panel") as HTMLDetailsElement;
      expect(panel.open).toBe(true);
      expect(screen.getByText("Hit 1 of 2")).toBeVisible();

      // Click next hit
      const nextButton = screen.getByRole("button", { name: "Next document search hit" });
      fireEvent.click(nextButton);
      expect(screen.getByText("Hit 2 of 2")).toBeVisible();

      // Simulate Gecko asynchronous dispatch of toggle event on details
      panel.dispatchEvent(new Event("toggle", { bubbles: true }));

      // Ensure hit remains Hit 2 of 2 and does not loop or reset back to Hit 1
      expect(screen.getByText("Hit 2 of 2")).toBeVisible();
    });
  });

  describe("Tools complementary panel and accessible names (#33346A / #9Z197J)", () => {
    it("renders complementary aside with deterministic collision-safe accessible name for selected tool", () => {
      render(<ToolsSearchResultsPage canAccessFavourites={false} />);

      // Find the About Forms button and click it
      const aboutFormsButton = screen.getByRole("button", { name: "About Forms" });
      fireEvent.click(aboutFormsButton);

      // Verify complementary aside exists with accessible name "Forms"
      const complementary = screen.getByRole("complementary", { name: "Forms" });
      expect(complementary).toBeInTheDocument();
      expect(complementary).toHaveAttribute("data-testid", "tools-detail-panel");

      // Verify the sheet panel inside
      const sheet = screen.getByTestId("tools-search-detail-sheet");
      expect(sheet).toBeInTheDocument();

      // Verify all section and heading IDs in DOM are unique to prevent collisions
      const elementsWithId = document.querySelectorAll("[id]");
      const ids = Array.from(elementsWithId).map((el) => el.id);
      const uniqueIds = new Set(ids);
      expect(ids.length).toBe(uniqueIds.size);

      // Verify that when the sheet closes, the aside's aria-labelledby target is not unmounted
      const closeButton = screen.getByRole("button", { name: "Close Forms" });
      fireEvent.click(closeButton);
      const closedComplementary = screen.getByTestId("tools-detail-panel");
      const labelledById = closedComplementary.getAttribute("aria-labelledby");
      expect(labelledById).toBeTruthy();
      const labelHeading = document.getElementById(labelledById!);
      expect(labelHeading).not.toBeNull();
      expect(labelHeading?.textContent).toBe("Forms");
    });
  });
});
