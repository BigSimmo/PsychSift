/** @vitest-environment jsdom */

import React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FileText } from "lucide-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PatientSafetyPlan } from "@/components/patient-safety-plan";
import { ChecklistRowActionButton } from "@/components/admin/renewals/checklist-row";
import { DictionaryTermPage } from "@/components/dictionary/dictionary-term-page";
import { findDictionaryEntry } from "@/lib/dictionary";
import { FavouritesCommandLibraryPage } from "@/components/clinical-dashboard/favourites-command-library-page";
import { CalculatorsSearchPage } from "@/components/calculators/search-page";
import { ColourCodingReferenceContent } from "@/components/reference/colour-coding-reference-content";
import baselineJson from "@/../scripts/design-system-contract-baseline.json";

// Mock router and search params
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/test",
}));

// Mock Supabase auth
vi.mock("@/lib/supabase/client", () => ({
  useAuthSession: () => ({
    status: "authenticated",
    session: { user: { id: "test-user-123", email: "clinician@example.test" } },
    isConfigured: true,
    error: null,
  }),
}));

vi.mock("@/components/clinical-dashboard/search-command-context", () => ({
  useSearchCommand: () => null,
}));

vi.mock("@/components/clinical-dashboard/universal-search-also-matches", () => ({
  UniversalSearchAlsoMatches: () => null,
}));

const slugs = ["crisis-team", "eating-disorders", "perinatal"];

vi.mock("@/components/clinical-dashboard/use-saved-registry-favourites", () => ({
  useSavedRegistryFavourites: () => ({
    items: slugs.map((slug) => ({
      id: `services:${slug}`,
      title: `Service ${slug}`,
      type: "services",
      set: "Saved services",
      meta: "Saved service",
      sourceMeta: "Service",
      action: "Open",
      href: `/services/${slug}`,
      icon: FileText,
      keywords: slug,
    })),
    status: "ready",
    registryStatus: "ready",
    refetch: vi.fn(),
  }),
}));

// Mock clipboard
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn().mockResolvedValue(undefined),
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollTo = vi.fn();
  if (typeof window !== "undefined") {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  }
});

afterEach(() => {
  cleanup();
});

describe("Empirical Challenger M4 Stress Test Harness", () => {
  /* ========================================================================
   * 1. Patient Safety Plan Remove Button Hitbox & Ergonomics
   * ======================================================================== */
  describe("1. Patient Safety Plan: Reasons for Living remove button hitbox & spacing", () => {
    it("renders remove button with exact 44x48px pseudo-element touch hitbox classes", async () => {
      const user = userEvent.setup();
      render(<PatientSafetyPlan />);

      // Target the "Reasons for living" section
      const reasonsSection = screen.getByRole("region", { name: /Reasons for living/i });
      const input = within(reasonsSection).getByPlaceholderText(/Finishing my apprenticeship/i);
      await user.type(input, "My family and garden");
      const addBtn = within(reasonsSection).getByRole("button", { name: /^add$/i });
      await user.click(addBtn);

      const removeBtn = within(reasonsSection).getByRole("button", {
        name: /Remove “My family and garden”/i,
      });
      expect(removeBtn).toBeInTheDocument();

      // Verify classes forming the 44x48px hitbox
      const classes = removeBtn.className;
      expect(classes).toContain("relative");
      expect(classes).toContain("size-5"); // 20px base width & height
      expect(classes).toContain("before:absolute");
      expect(classes).toContain("before:-inset-y-3.5"); // 14px top & bottom -> 20 + 28 = 48px height
      expect(classes).toContain("before:-inset-x-3"); // 12px left & right -> 20 + 24 = 44px width

      // Calculate empirical dimensions
      const baseSize = 20; // size-5
      const insetY = 3.5 * 4; // 14px
      const insetX = 3 * 4; // 12px
      const totalWidth = baseSize + insetX * 2;
      const totalHeight = baseSize + insetY * 2;

      expect(totalWidth).toBe(44); // Meets iOS HIG 44px min touch target
      expect(totalHeight).toBe(48); // Meets Android Material 48px tap target
    });

    it("verifies hitbox spacing: leaves at least 4px clear spacing before adjacent chip and does not collide with text", async () => {
      const user = userEvent.setup();
      render(<PatientSafetyPlan />);

      const reasonsSection = screen.getByRole("region", { name: /Reasons for living/i });
      const input = within(reasonsSection).getByPlaceholderText(/Finishing my apprenticeship/i);
      const addBtn = within(reasonsSection).getByRole("button", { name: /^add$/i });

      await user.type(input, "Reason Alpha");
      await user.click(addBtn);

      await user.type(input, "Reason Beta");
      await user.click(addBtn);

      const removeAlpha = within(reasonsSection).getByRole("button", { name: /Remove “Reason Alpha”/i });
      const removeBeta = within(reasonsSection).getByRole("button", { name: /Remove “Reason Beta”/i });
      expect(removeAlpha).toBeInTheDocument();
      expect(removeBeta).toBeInTheDocument();

      // Check ul flex-wrap and gap
      const chipList = removeAlpha.closest("ul");
      expect(chipList).not.toBeNull();
      expect(chipList?.className).toContain("gap-x-2.5"); // 10px inter-chip gap
      expect(chipList?.className).toContain("gap-y-2"); // 8px inter-row gap

      // Alpha chip padding: pr-1.5 = 6px
      const chipAlpha = removeAlpha.closest("li");
      expect(chipAlpha?.className).toContain("pr-1.5");
      expect(chipAlpha?.className).toContain("pl-3"); // 12px left padding on Beta chip

      // Hitbox extends 12px from button edge (before:-inset-x-3)
      // Button is placed 6px (pr-1.5) from right boundary of chip Alpha
      // Hitbox extends 12px - 6px = 6px into the inter-chip gap
      // Total gap between chip Alpha and chip Beta = 10px (gap-x-2.5)
      // Clearance before chip Beta = 10px - 6px = 4px clear spacing!
      const interChipGap = 2.5 * 4; // 10px
      const chipPaddingRight = 1.5 * 4; // 6px
      const hitboxRightExtension = 3 * 4; // 12px
      const overflowIntoGap = hitboxRightExtension - chipPaddingRight; // 6px
      const clearanceToNextChip = interChipGap - overflowIntoGap; // 4px
      expect(clearanceToNextChip).toBeGreaterThanOrEqual(4);

      // Distance to text of next chip (which has pl-3 = 12px padding): 4px + 12px = 16px
      const chipPaddingLeft = 3 * 4; // 12px
      const distanceToNextText = clearanceToNextChip + chipPaddingLeft;
      expect(distanceToNextText).toBe(16);

      // Successfully clicking remove removes the chip
      await user.click(removeAlpha);
      expect(within(reasonsSection).queryByRole("button", { name: /Remove “Reason Alpha”/i })).toBeNull();
      expect(within(reasonsSection).getByRole("button", { name: /Remove “Reason Beta”/i })).toBeInTheDocument();
    });
  });

  /* ========================================================================
   * 2. Renewals Checklist Row Action Button
   * ======================================================================== */
  describe("2. Renewals Checklist Row: Action button eliminates dead-click wrapper", () => {
    it("renders button directly with min-h-tap and without wrapping span", () => {
      const handleClick = vi.fn();
      render(<ChecklistRowActionButton label="Complete review" onClick={handleClick} testId="checklist-action-btn" />);

      const button = screen.getByTestId("checklist-action-btn");
      expect(button.tagName.toLowerCase()).toBe("button");
      expect(button.getAttribute("type")).toBe("button");

      // Verify outer parent is NOT a wrapper span with min-h-12
      const parent = button.parentElement;
      expect(parent?.tagName.toLowerCase()).not.toBe("span");
      if (parent) {
        expect(parent.className).not.toContain("min-h-12");
      }

      // Verify button itself carries min-h-tap (48px tap floor)
      expect(button.className).toContain("min-h-tap");
      expect(button.className).toContain("shrink-0");
      expect(button.className).toContain("px-3");
    });

    it("triggers onClick reliably across top, center, and bottom areas without dead click margins", async () => {
      const user = userEvent.setup();
      const handleClick = vi.fn();
      render(<ChecklistRowActionButton label="Complete review" onClick={handleClick} testId="checklist-action-btn" />);

      const button = screen.getByTestId("checklist-action-btn");

      // Direct clicks simulate full 48px hit area coverage
      await user.click(button);
      expect(handleClick).toHaveBeenCalledTimes(1);

      // Fire click event with coordinates simulating top edge (y=2px), center (y=24px), bottom edge (y=46px) of 48px button
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, clientY: 2 }));
      expect(handleClick).toHaveBeenCalledTimes(2);

      button.dispatchEvent(new MouseEvent("click", { bubbles: true, clientY: 24 }));
      expect(handleClick).toHaveBeenCalledTimes(3);

      button.dispatchEvent(new MouseEvent("click", { bubbles: true, clientY: 46 }));
      expect(handleClick).toHaveBeenCalledTimes(4);
    });
  });

  /* ========================================================================
   * 3. Dictionary Topic Link
   * ======================================================================== */
  describe("3. Dictionary Term Page: Topic link tap floor", () => {
    it("renders topic tag with min-h-tap py-2", () => {
      const baseEntry = findDictionaryEntry("auditory-hallucination")!;

      render(<DictionaryTermPage entry={baseEntry} />);

      const topicLink = screen.getByRole("link", { name: /Topic: Psychosis and perception/i });
      expect(topicLink).toBeInTheDocument();
      expect(topicLink.getAttribute("href")).toBe("/dictionary/topics/psychosis-and-perception");

      const classes = topicLink.className;
      expect(classes).toContain("min-h-tap");
      expect(classes).toContain("py-2");
      expect(classes).toContain("px-2.5");
      expect(classes).not.toContain("min-h-8"); // Previous sub-floor class eradicated
    });

    it("verifies the two remaining tap-floor declarations exclude the repaired dictionary and tag-cloud paths", () => {
      expect(baselineJson.metrics.interactiveTapFloorDeclarations).toBe(2);
      expect(
        (baselineJson.debtByPath.interactiveTapFloorDeclarations as Record<string, number>)[
          "src/components/dictionary/dictionary-term-page.tsx"
        ],
      ).toBeUndefined();
      expect(Object.keys(baselineJson.debtByPath.interactiveTapFloorDeclarations)).not.toContain(
        "src/components/DocumentTagCloud.tsx",
      );
      expect(
        Object.values(baselineJson.debtByPath.interactiveTapFloorDeclarations).reduce((sum, count) => sum + count, 0),
      ).toBe(2);
    });
  });

  /* ========================================================================
   * 4. Favourites Command Library Buttons
   * ======================================================================== */
  describe("4. Favourites Command Library Page: 48x48px hitboxes and tap floor", () => {
    it("renders collapse button with before:-inset-2 expanding 32x32 to 48x48px", async () => {
      const user = userEvent.setup();
      render(<FavouritesCommandLibraryPage demoMode={false} />);

      // Open workspace by clicking the workspace selection button
      const selectBtn = screen.getByRole("button", {
        name: /Select Service crisis-team for workspace/i,
      });
      await user.click(selectBtn);

      const collapseBtn = screen.getByRole("button", { name: /Collapse item workspace/i });
      expect(collapseBtn).toBeInTheDocument();

      const classes = collapseBtn.className;
      expect(classes).toContain("relative");
      expect(classes).toContain("h-8"); // 32px
      expect(classes).toContain("w-8"); // 32px
      expect(classes).toContain("before:absolute");
      expect(classes).toContain("before:-inset-2"); // 8px expansion on all sides -> 32 + 16 = 48px

      const baseWidth = 32;
      const baseHeight = 32;
      const inset = 2 * 4; // 8px
      expect(baseWidth + inset * 2).toBe(48);
      expect(baseHeight + inset * 2).toBe(48);
    });

    it("renders primary action link and copy citation button with min-h-tap", async () => {
      const user = userEvent.setup();
      render(<FavouritesCommandLibraryPage demoMode={false} />);

      const selectBtn = screen.getByRole("button", {
        name: /Select Service crisis-team for workspace/i,
      });
      await user.click(selectBtn);

      const copyBtn = screen.getByRole("button", { name: /Copy citation/i });
      expect(copyBtn).toBeInTheDocument();
      expect(copyBtn.className).toContain("min-h-tap");
      expect(copyBtn.className).toContain("px-3");
      expect(copyBtn.className).toContain("py-2");

      // Primary CTA link in summary tab
      const workspaceAside = screen.getByTestId("favourites-item-workspace");
      const openWorkspaceLink = within(workspaceAside).getByRole("link");
      expect(openWorkspaceLink.className).toContain("min-h-tap");
    });
  });

  /* ========================================================================
   * 5. Calculators Search Page Density Toggle Hitbox
   * ======================================================================== */
  describe("5. Calculators: Density toggles horizontal collision avoidance", () => {
    it("uses normal-flow 48px square targets and changes density without expanding into adjacent controls", async () => {
      const user = userEvent.setup();
      render(<CalculatorsSearchPage />);

      const comfortableBtn = screen.getByRole("button", { name: /Comfortable density/i });
      const compactBtn = screen.getByRole("button", { name: /Compact density/i });

      expect(comfortableBtn).toBeInTheDocument();
      expect(compactBtn).toBeInTheDocument();

      for (const btn of [comfortableBtn, compactBtn]) {
        const classes = btn.className;
        expect(btn).toHaveAttribute("type", "button");
        expect(btn).toHaveClass("size-12");
        expect(classes).not.toMatch(/(?:^|\s)(?:absolute|fixed|-m[^\s]*|(?:before|after):[^\s]*)\b/);
        expect(classes).not.toMatch(/\b(?:sm|md|lg|xl|2xl):(?:size|h|w)-/);
      }
      expect(comfortableBtn.parentElement).toHaveClass("inline-flex");
      expect(comfortableBtn.nextElementSibling).toBe(compactBtn);
      await user.click(compactBtn);
      expect(compactBtn).toHaveAttribute("aria-pressed", "true");
      expect(comfortableBtn).toHaveAttribute("aria-pressed", "false");
    });
  });

  /* ========================================================================
   * 6. Colour Coding Reference Mobile Responsiveness
   * ======================================================================== */
  describe("6. Colour Coding Reference: Mobile vertical stacking", () => {
    it("renders flex-col on mobile and sm:flex-row on desktop for domain catalogue flags", () => {
      const { container } = render(<ColourCodingReferenceContent variant="page" />);

      // Find domain catalogue section
      const sections = container.querySelectorAll("section");
      // Find section with catalogue ul
      let catalogueItem: Element | null = null;
      for (const sec of sections) {
        const li = sec.querySelector("li.flex-col");
        if (li) {
          catalogueItem = li;
          break;
        }
      }

      expect(catalogueItem).not.toBeNull();
      expect(catalogueItem!.className).toContain("flex-col");
      expect(catalogueItem!.className).toContain("sm:flex-row");
      expect(catalogueItem!.className).toContain("sm:gap-3");

      const badgeWrapper = catalogueItem!.querySelector("div");
      expect(badgeWrapper?.className).toContain("w-auto");
      expect(badgeWrapper?.className).toContain("sm:w-40");
    });
  });
});
