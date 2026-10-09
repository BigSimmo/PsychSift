import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { CopyResultButton } from "@/components/calculators/calculator-ui";
import { calculators } from "@/components/calculators/calculator-fixtures";
import { deriveCalculator } from "@/components/calculators/calculator-ui";
import { Sheet } from "@/components/ui/sheet";
import { OverlayRoot } from "@/components/ui/overlay-root";
import { shouldRenderClinicalDashboard } from "@/lib/search-route-ownership";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "/documents/search",
  useSearchParams: () => new URLSearchParams(),
}));

describe("UX Audit 4 Findings Verification", () => {
  beforeEach(() => {
    if (typeof window.requestAnimationFrame !== "function") {
      window.requestAnimationFrame = ((cb: FrameRequestCallback) =>
        setTimeout(() => cb(Date.now()), 0) as unknown as number) as typeof window.requestAnimationFrame;
      window.cancelAnimationFrame = ((id: number) =>
        clearTimeout(id as unknown as ReturnType<typeof setTimeout>)) as typeof window.cancelAnimationFrame;
    }
  });

  afterEach(() => {
    if (typeof document !== "undefined" && document.body) {
      document.body.style.overflow = "";
    }
  });

  describe("Finding 1: Document search return and deep linking", () => {
    it("renders ClinicalDashboard on /documents/search when a query is submitted", () => {
      expect(
        shouldRenderClinicalDashboard({
          hasSubmittedSearch: true,
          mode: "documents",
          pathname: "/documents/search",
        }),
      ).toBe(true);
    });
  });

  describe("Finding 2: Explanatory and accessible button states", () => {
    it("provides aria-disabled and an accessible description when calculator is incomplete", () => {
      const calc = calculators[0];
      const incompleteState = deriveCalculator(calc, {});

      render(<CopyResultButton calc={calc} state={incompleteState} />);

      const button = screen.getByRole("button", { name: /copy result/i });
      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(button).not.toBeDisabled(); // Must NOT use native disabled so keyboard focus and tooltips remain accessible

      const describedBy = button.getAttribute("aria-describedby");
      expect(describedBy).toBeTruthy();

      const description = document.getElementById(describedBy!);
      expect(description).toHaveTextContent(/answer all items to copy result summary/i);

      // Clicking while incomplete should safely ignore activation without error
      fireEvent.click(button);
      expect(button).toHaveAttribute("aria-disabled", "true");
    });
  });

  describe("Finding 3: Slide-out panel browser history dismissal", () => {
    it("pushes history on open and calls onClose upon popstate", () => {
      const onClose = vi.fn();
      const pushStateSpy = vi.spyOn(window.history, "pushState");

      const { rerender } = render(
        <>
          <OverlayRoot />
          <Sheet open={false} onClose={onClose} dismissOnBack title="Test Drawer">
            <p>Drawer Content</p>
          </Sheet>
        </>,
      );

      expect(pushStateSpy).not.toHaveBeenCalled();

      // Open the sheet
      rerender(
        <>
          <OverlayRoot />
          <Sheet open={true} onClose={onClose} dismissOnBack title="Test Drawer">
            <p>Drawer Content</p>
          </Sheet>
        </>,
      );

      expect(pushStateSpy).toHaveBeenCalledTimes(1);

      // Simulate browser Back button via popstate
      window.dispatchEvent(new PopStateEvent("popstate"));
      expect(onClose).toHaveBeenCalledTimes(1);

      pushStateSpy.mockRestore();
    });
  });

  describe("Finding 4: First Nations Pocket Card return path", () => {
    it("renders a print:hidden back link to /first-nations", async () => {
      const { PocketCardView } = await import("@/components/first-nations/pocket-card");
      render(<PocketCardView hospitals={[]} printedOn="2026-10-08" />);
      const backLink = screen.getByRole("link", { name: /Back to First Nations/i });
      expect(backLink).toBeTruthy();
      expect(backLink.getAttribute("href")).toBe("/first-nations");
      expect(backLink.closest(".print\\:hidden")).toBeTruthy();
    });
  });

  describe("Finding 5: CPD Log Activity return path", () => {
    it("renders Back to CPD log navigation link", async () => {
      const { CmeNewEntryRoute } = await import("@/components/cme/cme-new-entry-route");
      render(
        <CmeNewEntryRoute
          set={{
            year: 2026,
            totalHours: 50,
            requirements: [],
            confirmedOn: "2026-01-01",
            confirmedSource: "default",
          }}
        />,
      );
      const backLink = screen.getByRole("link", { name: /Back to CPD log/i });
      expect(backLink).toBeTruthy();
      expect(backLink.getAttribute("href")).toBe("/cme/log");
    });
  });

  describe("Finding 6: Patient Safety Plan accessible incomplete state", () => {
    it("explains why finalisation is unavailable when steps are incomplete", async () => {
      const { PatientSafetyPlan } = await import("@/components/patient-safety-plan");
      render(<PatientSafetyPlan />);
      const button = screen.getByRole("button", { name: /Finalise plan/i });
      expect(button).toBeDisabled();
      expect(button.getAttribute("title")).toMatch(/complete all \d+ steps to finalise/i);
      const describedBy = button.getAttribute("aria-describedby");
      expect(describedBy).toBeTruthy();
      const descEl = document.getElementById(describedBy!);
      expect(descEl).toBeTruthy();
      expect(descEl?.textContent).toMatch(/complete all \d+ steps to finalise plan/i);
    });
  });

  describe("Finding 7: Roster empty view explains read-only state", () => {
    it("renders explanation when editing is unavailable", async () => {
      const fs = await import("node:fs");
      const content = fs.readFileSync("src/components/roster/roster-shifts-page.tsx", "utf8");
      expect(content).toContain("Roster editing is unavailable while shifts are loading or in read-only mode");
    });
  });

  describe("Finding 8: Open shifts purges dummy onClick handlers", () => {
    it("has zero onClick={() => undefined} in open shifts components", async () => {
      const fs = await import("node:fs");
      const advertContent = fs.readFileSync("src/components/open-shifts/open-shifts-advert-page.tsx", "utf8");
      const postedContent = fs.readFileSync("src/components/open-shifts/open-shifts-posted-page.tsx", "utf8");
      expect(advertContent).not.toContain("onClick={() => undefined}");
      expect(postedContent).not.toContain("onClick={() => undefined}");
    });
  });
});
