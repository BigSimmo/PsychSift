/** @vitest-environment jsdom */

import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import { useSyncExternalStore } from "react";

import { DsmSearchPage } from "@/components/dsm/dsm-search-page";
import { PhoneFooterLayerFrame } from "@/components/clinical-dashboard/phone-footer-layer-portal";
import type { DsmCategory, DsmDiagnosisSummary } from "@/lib/dsm";

vi.mock("@/components/clinical-dashboard/universal-search-also-matches", () => ({
  UniversalSearchAlsoMatches: () => <div data-testid="universal-search-also-matches">Also matches</div>,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

function setupMatchMedia(isPhone: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes("max-width: 639px") ? isPhone : !isPhone,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

const mockCategories: DsmCategory[] = [
  { key: "mood", label: "Mood disorders", diagnosis_count: 5 },
  { key: "anxiety", label: "Anxiety disorders", diagnosis_count: 5 },
];

const mockResults: DsmDiagnosisSummary[] = [
  {
    slug: "mdd",
    title: "Major Depressive Disorder",
    icd_code: "F32.9",
    category: { key: "mood", label: "Mood disorders" },
    summary: "Depression summary",
    criteriaCount: 9,
    criteriaProvenance: "dsm_criteria",
    differentialCount: 4,
    specifierCount: 2,
  },
  {
    slug: "bipolar-1",
    title: "Bipolar I Disorder",
    icd_code: "F31.9",
    category: { key: "mood", label: "Mood disorders" },
    summary: "Bipolar summary",
    criteriaCount: 7,
    criteriaProvenance: "dsm_criteria",
    differentialCount: 5,
    specifierCount: 3,
  },
  {
    slug: "gad",
    title: "Generalized Anxiety Disorder",
    icd_code: "F41.1",
    category: { key: "anxiety", label: "Anxiety disorders" },
    summary: "Anxiety summary",
    criteriaCount: 6,
    criteriaProvenance: "dsm_criteria",
    differentialCount: 3,
    specifierCount: 1,
  },
  {
    slug: "ptsd",
    title: "Posttraumatic Stress Disorder",
    icd_code: "F43.10",
    category: { key: "anxiety", label: "Anxiety disorders" },
    summary: "PTSD summary",
    criteriaCount: 8,
    criteriaProvenance: "dsm_criteria",
    differentialCount: 4,
    specifierCount: 2,
  },
];

describe("Milestone M5-It2 Challenger: useSyncExternalStore Mount Guard & Hydration Semantics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMatchMedia(true);
  });

  afterEach(() => {
    cleanup();
  });

  describe("1. useSyncExternalStore Hook Behavior in Isolation", () => {
    function MountGuardComponent() {
      const mounted = useSyncExternalStore(
        () => () => {},
        () => true,
        () => false,
      );
      return <div data-testid="mount-status">{mounted ? "CLIENT_MOUNTED" : "SSR_PRERENDER"}</div>;
    }

    it("evaluates getServerSnapshot on server (SSR) and returns false", () => {
      const ssrHtml = renderToString(<MountGuardComponent />);
      expect(ssrHtml).toContain("SSR_PRERENDER");
      expect(ssrHtml).not.toContain("CLIENT_MOUNTED");
    });

    it("evaluates getSnapshot on client DOM and returns true", () => {
      render(<MountGuardComponent />);
      const statusEl = screen.getByTestId("mount-status");
      expect(statusEl.textContent).toBe("CLIENT_MOUNTED");
    });
  });

  describe("2. DsmSearchPage SSR vs Client Compare Strip Parity", () => {
    it("safely omits the compare strip during SSR even if items are initially selected", () => {
      // In SSR renderToString, DsmSearchPage rendered with initial selection
      const ssrOutput = renderToString(
        <PhoneFooterLayerFrame className="relative">
          <DsmSearchPage
            query="test"
            categories={mockCategories}
            results={mockResults}
            initialIds={["mdd", "bipolar-1"]}
          />
        </PhoneFooterLayerFrame>,
      );

      // Verify the mobile compare strip is completely absent from server HTML
      expect(ssrOutput).not.toContain("shared-compare-tray-layer");
      expect(ssrOutput).not.toContain("dsm-compare-tray");
    });

    it("mounts the compare strip cleanly in the client DOM with zero hydration errors", () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      render(
        <PhoneFooterLayerFrame className="relative">
          <DsmSearchPage
            query="test"
            categories={mockCategories}
            results={mockResults}
            initialIds={["mdd", "bipolar-1"]}
          />
        </PhoneFooterLayerFrame>,
      );

      const compareLink = screen.getByTestId("dsm-compare-tray-compare");
      expect(compareLink).toBeInTheDocument();
      expect(compareLink.getAttribute("href")).toBe("/dsm/compare?ids=mdd%2Cbipolar-1");
      expect(screen.getByTestId("dsm-compare-tray-count").textContent).toContain("2");

      // Verify no React hydration errors or cascading render warnings occurred
      const hydrationErrors = consoleErrorSpy.mock.calls.filter((call) =>
        call.some((arg) => typeof arg === "string" && (arg.includes("Hydration") || arg.includes("did not match"))),
      );
      expect(hydrationErrors).toHaveLength(0);

      consoleErrorSpy.mockRestore();
    });
  });

  describe("3. Stress-Testing Compare Strip Lifecycle & Invariants", () => {
    it("handles full lifecycle: 0 items -> 1 item -> 2 items -> 3 items -> FIFO 4th item -> 0 items", async () => {
      const user = userEvent.setup();
      render(
        <PhoneFooterLayerFrame className="relative">
          <DsmSearchPage query="test" categories={mockCategories} results={mockResults} initialIds={[]} />
        </PhoneFooterLayerFrame>,
      );

      // Initially 0 items: the tray should not exist
      expect(screen.queryByTestId("dsm-compare-tray")).not.toBeInTheDocument();

      const compareButtons = screen.getAllByRole("button", { name: /Add .* to comparison/i });
      expect(compareButtons).toHaveLength(4);

      // Select 1st item: the tray appears, Compare waits for a second (with its reason)
      await user.click(compareButtons[0]);
      expect(screen.getByTestId("dsm-compare-tray")).toBeInTheDocument();
      expect(screen.getByTestId("dsm-compare-tray-count").textContent).toContain("1");
      expect(screen.getByTestId("dsm-compare-tray-compare")).toHaveAttribute("aria-disabled", "true");
      expect(screen.getByTestId("dsm-compare-tray-compare").getAttribute("href")).toBeNull();

      // Select 2nd item
      await user.click(compareButtons[1]);
      expect(screen.getByTestId("dsm-compare-tray-count").textContent).toContain("2");
      expect(screen.getByTestId("dsm-compare-tray-compare").getAttribute("href")).toBe(
        "/dsm/compare?ids=mdd%2Cbipolar-1",
      );

      // Select 3rd item
      await user.click(compareButtons[2]);
      expect(screen.getByTestId("dsm-compare-tray-count").textContent).toContain("3");
      expect(screen.getByTestId("dsm-compare-tray-compare").getAttribute("href")).toBe(
        "/dsm/compare?ids=mdd%2Cbipolar-1%2Cgad",
      );

      // Select 4th item -> FIFO rotation removes 1st item (mdd)
      await user.click(compareButtons[3]);
      expect(screen.getByTestId("dsm-compare-tray-count").textContent).toContain("3");
      expect(screen.getByTestId("dsm-compare-tray-compare").getAttribute("href")).toBe(
        "/dsm/compare?ids=bipolar-1%2Cgad%2Cptsd",
      );

      // Deselect remaining items using Remove buttons
      const removeButtons = screen.getAllByRole("button", { name: /Remove .* from comparison/i });
      for (const btn of removeButtons) {
        await user.click(btn);
      }

      // Returns to null when selection empties
      expect(screen.queryByTestId("dsm-compare-tray")).not.toBeInTheDocument();
    });

    it("respects PhoneFooterLayerFrame scroll-hide contract", () => {
      render(
        <PhoneFooterLayerFrame className="relative" scrollHidden={true}>
          <DsmSearchPage
            query="test"
            categories={mockCategories}
            results={mockResults}
            initialIds={["mdd", "bipolar-1"]}
          />
        </PhoneFooterLayerFrame>,
      );

      const compareStrip = document.querySelector(".shared-compare-tray-layer");
      expect(compareStrip).not.toBeNull();
      expect(compareStrip?.getAttribute("data-scroll-hidden")).toBe("true");
    });
  });

  describe("4. Static Code Verification", () => {
    // The DSM strip became the shared Compare tray, which keeps the same mount guard.
    const sourceCode = readFileSync("src/components/compare/shared-compare-tray.tsx", "utf8");

    it("confirms useSyncExternalStore is imported from react", () => {
      expect(sourceCode).toMatch(/import\s*\{[^}]*useSyncExternalStore[^}]*\}\s*from\s*"react"/);
    });

    it("confirms NO useState/useEffect mount pattern in the shared Compare tray", () => {
      const stripSlice = sourceCode.slice(
        sourceCode.indexOf("export function SharedCompareTray"),
        sourceCode.indexOf("function useDockSlot"),
      );

      expect(stripSlice).not.toMatch(/useEffect\s*\(\s*\(\)\s*=>\s*\{\s*setMounted/);
      expect(stripSlice).not.toMatch(/const\s*\[\s*mounted\s*,\s*setMounted\s*\]\s*=\s*useState/);
      expect(stripSlice).toContain("const mounted = useSyncExternalStore(");
    });
  });
});
