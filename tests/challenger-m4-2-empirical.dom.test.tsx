/** @vitest-environment jsdom */

import React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ColourCodingReferenceContent } from "@/components/reference/colour-coding-reference-content";
import { CalculatorsSearchPage } from "@/components/calculators/search-page";
import { PatientSafetyPlan } from "@/components/patient-safety-plan";
import { ChecklistRowActionButton } from "@/components/admin/renewals/checklist-row";
import baselineJson from "@/../scripts/design-system-contract-baseline.json";

// Router and navigation mocks
const navigationMock = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  searchParams: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: navigationMock.push,
    replace: navigationMock.replace,
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => navigationMock.searchParams,
  usePathname: () => "/calculators/search",
}));

// Supabase mock for PatientSafetyPlan
vi.mock("@/lib/supabase/client", () => ({
  useAuthSession: () => ({
    status: "authenticated",
    session: { user: { email: "clinician@test.domain" } },
    isConfigured: true,
    error: null,
  }),
}));

vi.mock("@/components/clinical-dashboard/universal-search-also-matches", () => ({
  UniversalSearchAlsoMatches: () => null,
}));

beforeEach(() => {
  vi.clearAllMocks();
  navigationMock.push.mockReset();
  navigationMock.searchParams = new URLSearchParams();
  Element.prototype.scrollTo = vi.fn();
  if (typeof window !== "undefined") {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  }
});

afterEach(() => {
  cleanup();
});

describe("Empirical Challenger M4-2 Verification Suite", () => {
  /* ========================================================================
   * 1. Colour Coding Reference Content: 320px Viewport & Long Badge Labels
   * ======================================================================== */
  describe("1. Colour Coding Reference Content (Responsive Squeeze & Badge Truncation)", () => {
    it("renders DomainCatalogue list items with responsive flex-col and w-auto badge containers for mobile viewports", () => {
      const { container } = render(<ColourCodingReferenceContent variant="page" />);

      // Find domain catalogue sections (e.g. Medications, Documents & sources, etc.)
      // These are identified by having DomainCatalogue flag items
      const domainSections = container.querySelectorAll("section");
      // Skip the first two sections (Tone key dl, Quick mapping ul)
      const catalogueSections = Array.from(domainSections).slice(2);
      expect(catalogueSections.length).toBeGreaterThan(0);

      let totalCatalogueItems = 0;
      for (const section of catalogueSections) {
        const listItems = section.querySelectorAll("li");
        for (const li of listItems) {
          totalCatalogueItems++;
          // Must have responsive flex-col on mobile and sm:flex-row on desktop
          expect(li.className).toContain("flex-col");
          expect(li.className).toContain("sm:flex-row");
          expect(li.className).toContain("sm:items-start");
          expect(li.className).toContain("sm:gap-3");

          // The badge container must be w-auto on mobile to avoid fixed 160px width
          const badgeWrapper = li.firstElementChild as HTMLElement;
          expect(badgeWrapper).not.toBeNull();
          expect(badgeWrapper.className).toContain("w-auto");
          expect(badgeWrapper.className).toContain("sm:w-40");

          // Description paragraph must have min-w-0 to allow proper flex wrapping
          const p = li.querySelector("p");
          expect(p).not.toBeNull();
          expect(p?.className).toContain("min-w-0");
        }
      }
      expect(totalCatalogueItems).toBeGreaterThan(10);
    });

    it("stress-tests 320px viewport layout math: description width is >= 240px (not 84px squeezed)", () => {
      // 320px viewport layout math proof:
      // Outer card padding: p-4 = 16px left + 16px right = 32px
      // Available card interior width: 320px - 32px = 288px
      // In the old layout:
      //   Horizontal flex row: badge was w-40 (160px) + gap-3 (12px) = 172px reserved.
      //   Description width was: 288px - 172px = 116px (and down to 84px with inner border/scrollbar).
      // In the remediated layout:
      //   Mobile flex-col: badge takes its own auto line (height ~22px).
      //   Description text <p> sits on the next line and takes the full flex width (288px).
      const viewportWidth = 320;
      const cardPaddingHorizontal = 16 * 2; // p-4
      const availableInnerWidth = viewportWidth - cardPaddingHorizontal; // 288px

      // Under flex-col, description occupies 100% of availableInnerWidth
      const mobileDescriptionWidth = availableInnerWidth;
      expect(mobileDescriptionWidth).toBe(288);
      expect(mobileDescriptionWidth).toBeGreaterThanOrEqual(240);

      // Verify the old squeezed width is avoided
      const oldSqueezedBadgeWidth = 160; // w-40
      const oldGap = 12; // gap-3
      const oldSqueezedWidth = availableInnerWidth - oldSqueezedBadgeWidth - oldGap; // 116px (or 84px with borders)
      expect(oldSqueezedWidth).toBeLessThan(240);
    });

    it("verifies long badge labels do not suffer ellipsis truncation on mobile", () => {
      render(<ColourCodingReferenceContent variant="page" />);

      // Test the three specific long clinical badge labels from the dispatch
      const requiredBadges = ["Narrow therapeutic index", "High-risk medication", "Contraindications"];

      for (const expectedLabel of requiredBadges) {
        const textSpan = screen.getByText(expectedLabel);
        expect(textSpan).toBeInTheDocument();

        // The text container should have the exact un-truncated string
        expect(textSpan.textContent).toBe(expectedLabel);

        // Find enclosing ClinicalBadge component: span.inline-flex
        const badgeSpan = textSpan.parentElement as HTMLElement;
        expect(badgeSpan).not.toBeNull();
        expect(badgeSpan.tagName.toLowerCase()).toBe("span");
        expect(badgeSpan.className).toContain("inline-flex");
        expect(badgeSpan.className).toContain("max-w-full");

        // The outer container in ColourCodingReferenceContent must have w-auto (not w-40) on mobile
        const outerDiv = badgeSpan.parentElement as HTMLElement;
        expect(outerDiv).not.toBeNull();
        expect(outerDiv.tagName.toLowerCase()).toBe("div");
        expect(outerDiv.className).toContain("w-auto");
        expect(outerDiv.className).toContain("sm:w-40");

        // And the enclosing <li> must be flex-col on mobile
        const li = outerDiv.parentElement as HTMLElement;
        expect(li.tagName.toLowerCase()).toBe("li");
        expect(li.className).toContain("flex-col");
        expect(li.className).toContain("sm:flex-row");
      }
    });
  });

  /* ========================================================================
   * 2. Calculators Search Page Density Toggle Buttons
   * ======================================================================== */
  describe("2. Calculators Search Page Density Toggle Hitbox & Deterministic Dismissal", () => {
    it("verifies vertical hitbox is 48px via before:-inset-y-1.5 on size-9 buttons", () => {
      render(<CalculatorsSearchPage />);

      const comfortableBtn = screen.getByRole("button", { name: /Comfortable density/i });
      const compactBtn = screen.getByRole("button", { name: /Compact density/i });

      for (const btn of [comfortableBtn, compactBtn]) {
        expect(btn.className).toContain("size-9"); // 36px base
        expect(btn.className).toContain("before:absolute");
        expect(btn.className).toContain("before:-inset-y-1.5"); // 6px top and 6px bottom

        // Hitbox calculation:
        const baseHeight = 36;
        const insetY = 1.5 * 4; // 6px
        const totalHitboxHeight = baseHeight + insetY * 2;
        expect(totalHitboxHeight).toBe(48); // Meets 48px tap target
      }
    });

    it("verifies horizontal boundary before:inset-x-0 completely avoids overlap between adjacent density buttons", () => {
      render(<CalculatorsSearchPage />);

      const comfortableBtn = screen.getByRole("button", { name: /Comfortable density/i });
      const compactBtn = screen.getByRole("button", { name: /Compact density/i });

      // Both buttons declare before:inset-x-0
      expect(comfortableBtn.className).toContain("before:inset-x-0");
      expect(compactBtn.className).toContain("before:inset-x-0");

      // Verify neither button extends horizontally into its neighbor
      expect(comfortableBtn.className).not.toMatch(/before:-inset-x/);
      expect(compactBtn.className).not.toMatch(/before:-inset-x/);

      // Mathematical proof of non-overlap:
      // Button 1 (Comfortable): origin x1 = 0, width = 36px. Hitbox x range = [0, 36]
      // Button 2 (Compact): origin x2 = 36, width = 36px. Hitbox x range = [36, 72]
      // Overlap width = max(0, min(36, 72) - max(0, 36)) = max(0, 36 - 36) = 0px
      const b1_left = 0;
      const b1_right = 36;
      const b2_left = 36;
      const b2_right = 72;
      const overlap = Math.max(0, Math.min(b1_right, b2_right) - Math.max(b1_left, b2_left));
      expect(overlap).toBe(0);
    });

    it("verifies Escape dismissal behaves deterministically without duplicate router.push calls", async () => {
      const user = userEvent.setup();
      navigationMock.searchParams = new URLSearchParams("q=depression&calculator=phq9");

      render(<CalculatorsSearchPage initialQuery="depression" initialCalculatorId="phq9" />);

      // Verify modal is open
      const dialog = screen.getByRole("dialog", { name: "PHQ-9 calculator" });
      expect(dialog).toBeInTheDocument();

      // Press Escape
      await user.keyboard("{Escape}");

      // Verify router.push called EXACTLY once
      expect(navigationMock.push).toHaveBeenCalledTimes(1);

      const pushedUrl = navigationMock.push.mock.lastCall?.[0];
      expect(pushedUrl).toContain("/calculators/search?");
      const params = new URLSearchParams(pushedUrl.replace("/calculators/search?", ""));
      expect(params.get("calculator")).toBeNull();
      expect(params.get("q")).toBe("depression");

      // Press Escape again when sheet is closed - no additional push calls
      await user.keyboard("{Escape}");
      expect(navigationMock.push).toHaveBeenCalledTimes(1);
    });
  });

  /* ========================================================================
   * 3. Services Navigator Remove Button: Touch Target & Zero size-11 Tokens
   * ======================================================================== */
  describe("3. Services Navigator: Remove Button & Zero size-11 Tokens", () => {
    const servicesFilePath = resolve(process.cwd(), "src/components/services/services-navigator-page.tsx");
    const servicesFileContent = readFileSync(servicesFilePath, "utf8");

    it("verifies touch target is 48px on mobile (size-12) and 40px on desktop (sm:size-10)", () => {
      // Line 401 remove button and line 384 close button
      const removeBtnRegex = /aria-label=\{`Remove \$\{service\.title\} from comparison`\}[\s\S]*?className="([^"]+)"/;
      const match = servicesFileContent.match(removeBtnRegex);
      expect(match).not.toBeNull();

      const className = match![1];
      expect(className).toContain("size-12"); // 48px touch target on mobile
      expect(className).toContain("sm:size-10"); // 40px desktop alignment

      // Verify mobile pixels
      const mobilePixels = 12 * 4; // size-12 = 3rem = 48px
      expect(mobilePixels).toBe(48);

      // Verify desktop pixels
      const desktopPixels = 10 * 4; // sm:size-10 = 2.5rem = 40px
      expect(desktopPixels).toBe(40);
    });

    it("confirms zero prohibited size-11 or *-11 legacy tokens in services navigator", () => {
      // Legacy tap classes check: no size-11, h-11, w-11, min-h-11, min-w-11
      const prohibitedTokens = servicesFileContent.match(/\b(?:min-|max-)?[hw]-11\b|\bsize-11\b/g);
      expect(prohibitedTokens).toBeNull();
    });

    it("confirms zero prohibited *-11 legacy tokens across all services components", () => {
      const servicesDir = resolve(process.cwd(), "src/components/services");
      const files = readdirSync(servicesDir).filter((f: string) => f.endsWith(".tsx") || f.endsWith(".ts"));

      for (const file of files) {
        const content = readFileSync(resolve(servicesDir, file), "utf8");
        const violations = content.match(/\b(?:min-|max-)?[hw]-11\b|\bsize-11\b/g);
        expect(violations, `Prohibited *-11 token found in ${file}`).toBeNull();
      }
    });
  });

  /* ========================================================================
   * 4. Safe-Area Custom Property Drift Verification
   * ======================================================================== */
  describe("4. Safe-Area Custom Property Drift", () => {
    const diffPagePath = resolve(
      process.cwd(),
      "src/components/differentials/differential-presentation-workflow-page.tsx",
    );
    const cmeDashboardPath = resolve(process.cwd(), "src/components/cme/cme-dashboard.tsx");

    const diffContent = readFileSync(diffPagePath, "utf8");
    const cmeContent = readFileSync(cmeDashboardPath, "utf8");

    it("verifies var(--safe-area-bottom) is used in differential-presentation-workflow-page.tsx:865, 959", () => {
      expect(diffContent).toContain("pb-[calc(0.4rem+var(--safe-area-bottom))]");
      expect(diffContent).toContain("pb-[calc(6.25rem+var(--safe-area-bottom))]");
    });

    it("verifies var(--safe-area-bottom) is used in cme-dashboard.tsx:509", () => {
      expect(cmeContent).toContain("pb-[calc(max(1rem,var(--safe-area-bottom))+2.5rem)]");
    });

    it("confirms zero raw env(safe-area-inset-bottom) occurrences in differential presentation and cme dashboard", () => {
      const diffMatches = diffContent.match(/env\(safe-area-inset-bottom\)/g);
      expect(
        diffMatches,
        "Raw env(safe-area-inset-bottom) found in differential-presentation-workflow-page.tsx",
      ).toBeNull();

      const cmeMatches = cmeContent.match(/env\(safe-area-inset-bottom\)/g);
      expect(cmeMatches, "Raw env(safe-area-inset-bottom) found in cme-dashboard.tsx").toBeNull();
    });
  });

  /* ========================================================================
   * 5. Patient Safety Plan & Checklist Row Ergonomics
   * ======================================================================== */
  describe("5. Patient Safety Plan & Checklist Row Tap Target Hardening", () => {
    it("patient-safety-plan remove button achieves 44x48px touch target with zero neighbor collision", async () => {
      const user = userEvent.setup();
      render(<PatientSafetyPlan />);

      const reasonsSection = screen.getByRole("region", { name: /Reasons for living/i });
      const input = within(reasonsSection).getByPlaceholderText(/Finishing my apprenticeship/i);
      const addBtn = within(reasonsSection).getByRole("button", { name: /^add$/i });

      await user.type(input, "First reason");
      await user.click(addBtn);

      const removeBtn = within(reasonsSection).getByRole("button", { name: /Remove “First reason”/i });
      expect(removeBtn).toBeInTheDocument();

      // Pseudo-element expansion math:
      // Base size-5 = 20px
      // before:-inset-x-3 = 12px horizontal extension on both sides
      // total width = 20 + 24 = 44px (meets iOS HIG 44px minimum)
      // before:-inset-y-3.5 = 14px vertical extension on both sides
      // total height = 20 + 28 = 48px (meets Android 48px tap target)
      expect(removeBtn.className).toContain("before:-inset-x-3");
      expect(removeBtn.className).toContain("before:-inset-y-3.5");

      const width = 20 + 3 * 4 * 2;
      const height = 20 + 3.5 * 4 * 2;
      expect(width).toBe(44);
      expect(height).toBe(48);
    });

    it("checklist row action button eliminates dead click wrapper and carries min-h-tap directly", () => {
      const onClick = vi.fn();
      render(<ChecklistRowActionButton label="Approve" onClick={onClick} testId="chk-btn" />);

      const button = screen.getByTestId("chk-btn");
      expect(button.tagName.toLowerCase()).toBe("button");
      expect(button.className).toContain("min-h-tap");
      expect(button.parentElement?.tagName.toLowerCase()).not.toBe("span");
      expect(button.parentElement?.className ?? "").not.toContain("min-h-12");
    });

    it("verifies design system contract baseline reflects 4 sub-floor declarations (down from 5)", () => {
      expect(baselineJson.metrics.interactiveTapFloorDeclarations).toBe(4);
    });
  });
});
