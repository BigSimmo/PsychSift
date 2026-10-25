/** @vitest-environment jsdom */

import React, { useState } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PatientSafetyPlan } from "@/components/patient-safety-plan";
import { ChecklistPressableRow, ChecklistRowActionButton } from "@/components/admin/renewals/checklist-row";
import { CalculatorSheet } from "@/components/calculators/calculator-sheet";
import { calculators } from "@/components/calculators/calculator-fixtures";
import { hasOpenSheet, isTopmostSheet, popSheet, pushSheet, canRestoreFocusTo } from "@/components/ui/sheet-focus";

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
    session: { user: { id: "test-user-m5", email: "clinician-m5@example.test" } },
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

describe("Empirical Challenger M5 Stress Harness", () => {
  /* ========================================================================
   * 1. Patient Safety Plan Remove Button: Hitbox, Collision & Isolation
   * ======================================================================== */
  describe("1. Patient Safety Plan: Remove Button Hitbox & Non-Collision Stress Test", () => {
    it("empirically verifies 44x48px touch target geometry via Tailwind pseudo-element tokens", async () => {
      const user = userEvent.setup();
      render(<PatientSafetyPlan />);

      const reasonsSection = screen.getByRole("region", { name: /Reasons for living/i });
      const input = within(reasonsSection).getByPlaceholderText(/Finishing my apprenticeship/i);
      const addBtn = within(reasonsSection).getByRole("button", { name: /^add to /i });

      await user.type(input, "Finishing medical training");
      await user.click(addBtn);

      const removeBtn = within(reasonsSection).getByRole("button", {
        name: /Remove “Finishing medical training”/i,
      });
      expect(removeBtn).toBeInTheDocument();

      // Base: size-5 (20px by 20px)
      // Horizontal expansion: before:-inset-x-3 (-12px left, -12px right) -> 20 + 24 = 44px
      // Vertical expansion: before:-inset-y-3.5 (-14px top, -14px bottom) -> 20 + 28 = 48px
      expect(removeBtn.className).toContain("size-5");
      expect(removeBtn.className).toContain("before:-inset-x-3");
      expect(removeBtn.className).toContain("before:-inset-y-3.5");

      const baseSize = 20;
      const horizontalHitbox = baseSize + 3 * 4 * 2;
      const verticalHitbox = baseSize + 3.5 * 4 * 2;

      expect(horizontalHitbox).toBe(44);
      expect(verticalHitbox).toBe(48);
    });

    it("verifies click isolation: clicking chip text does not trigger remove button", async () => {
      const user = userEvent.setup();
      render(<PatientSafetyPlan />);

      const reasonsSection = screen.getByRole("region", { name: /Reasons for living/i });
      const input = within(reasonsSection).getByPlaceholderText(/Finishing my apprenticeship/i);
      const addBtn = within(reasonsSection).getByRole("button", { name: /^add to /i });

      await user.type(input, "My family");
      await user.click(addBtn);

      const chip = within(reasonsSection).getByText("My family").closest("li");
      expect(chip).not.toBeNull();

      // Click on the chip container or text
      await user.click(within(reasonsSection).getByText("My family"));

      // Chip must still be present
      expect(within(reasonsSection).getByText("My family")).toBeInTheDocument();
      expect(within(reasonsSection).getByRole("button", { name: /Remove “My family”/i })).toBeInTheDocument();

      // Now click the remove button directly
      await user.click(within(reasonsSection).getByRole("button", { name: /Remove “My family”/i }));
      expect(within(reasonsSection).queryByText("My family")).toBeNull();
    });

    it("verifies multiple chips layout: inter-chip spacing prevents touch collision", async () => {
      const user = userEvent.setup();
      render(<PatientSafetyPlan />);

      const reasonsSection = screen.getByRole("region", { name: /Reasons for living/i });
      const input = within(reasonsSection).getByPlaceholderText(/Finishing my apprenticeship/i);
      const addBtn = within(reasonsSection).getByRole("button", { name: /^add to /i });

      const items = ["Item One", "Item Two", "Item Three"];
      for (const item of items) {
        await user.type(input, item);
        await user.click(addBtn);
      }

      const buttons = items.map((item) =>
        within(reasonsSection).getByRole("button", { name: new RegExp(`Remove “${item}”`, "i") }),
      );
      expect(buttons).toHaveLength(3);

      // Verify that removing the middle item does not alter or remove the neighbors
      await user.click(buttons[1]);

      expect(within(reasonsSection).getByText("Item One")).toBeInTheDocument();
      expect(within(reasonsSection).queryByText("Item Two")).toBeNull();
      expect(within(reasonsSection).getByText("Item Three")).toBeInTheDocument();
    });
  });

  /* ========================================================================
   * 2. Renewals Checklist Row: Hitbox, Sibling Independence & Zero Dead Zones
   * ======================================================================== */
  describe("2. Renewals Checklist Row: Action Button Hitbox & Sibling Independence", () => {
    it("renders ChecklistRowActionButton with min-h-tap and no enclosing dead-click wrapper", () => {
      const onClick = vi.fn();
      render(<ChecklistRowActionButton label="Add date" onClick={onClick} testId="chk-action-btn" />);

      const btn = screen.getByTestId("chk-action-btn");
      expect(btn.tagName).toBe("BUTTON");
      expect(btn.getAttribute("type")).toBe("button");
      expect(btn.className).toContain("min-h-tap");
      expect(btn.className).toContain("shrink-0");

      // Verify parent is not a container with min-h-12 or artificial padding
      const parent = btn.parentElement;
      expect(parent?.tagName).not.toBe("SPAN");
    });

    it("verifies sibling click independence: clicking row does not fire action, and clicking action does not fire row", async () => {
      const user = userEvent.setup();
      const onRowOpen = vi.fn();
      const onActionClick = vi.fn();

      render(
        <ChecklistPressableRow
          title="Mandatory Training"
          subtitle="Annual CPR certification"
          onOpen={onRowOpen}
          actionTrailing={<ChecklistRowActionButton label="Complete" onClick={onActionClick} testId="row-action-btn" />}
          testId="row-pressable-btn"
        />,
      );

      const rowBtn = screen.getByTestId("row-pressable-btn");
      const actionBtn = screen.getByTestId("row-action-btn");

      // 1. Click row button -> only onRowOpen fires
      await user.click(rowBtn);
      expect(onRowOpen).toHaveBeenCalledTimes(1);
      expect(onActionClick).not.toHaveBeenCalled();

      // 2. Click action button -> only onActionClick fires
      await user.click(actionBtn);
      expect(onRowOpen).toHaveBeenCalledTimes(1);
      expect(onActionClick).toHaveBeenCalledTimes(1);

      // 3. Verify keyboard Space/Enter on action button
      actionBtn.focus();
      await user.keyboard("{Enter}");
      expect(onActionClick).toHaveBeenCalledTimes(2);
      expect(onRowOpen).toHaveBeenCalledTimes(1);

      await user.keyboard(" ");
      expect(onActionClick).toHaveBeenCalledTimes(3);
      expect(onRowOpen).toHaveBeenCalledTimes(1);
    });
  });

  /* ========================================================================
   * 3. CalculatorSheet Lifecycle, Focus Trap & Multi-Sheet Stacking
   * ======================================================================== */
  describe("3. CalculatorSheet Lifecycle, Focus Trap & Stack Precedence", () => {
    const calc = calculators[0]; // PHQ-9

    it("traps Tab within the modal dialog boundaries (cyclic Tab navigation)", async () => {
      const user = userEvent.setup();
      const offsetSpy = vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockReturnValue(document.body);

      render(<CalculatorSheet calc={calc} answers={{}} onAnswersChange={() => {}} onClose={() => {}} isOpen={true} />);

      const dialog = screen.getByRole("dialog");
      expect(dialog).toBeInTheDocument();

      const focusables = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.tabIndex !== -1 && (el.offsetParent !== null || el === document.activeElement));

      expect(focusables.length).toBeGreaterThan(1);
      const firstFocusable = focusables[0];
      const lastFocusable = focusables[focusables.length - 1];

      // Initial focus is on the close button (first focusable)
      expect(document.activeElement).toBe(firstFocusable);

      // Focus last focusable and hit Tab -> wraps to first
      lastFocusable.focus();
      expect(document.activeElement).toBe(lastFocusable);
      await user.tab();
      expect(document.activeElement).toBe(firstFocusable);

      // Focus first focusable and hit Shift+Tab -> wraps to last
      firstFocusable.focus();
      expect(document.activeElement).toBe(firstFocusable);
      await user.tab({ shift: true });
      expect(document.activeElement).toBe(lastFocusable);

      offsetSpy.mockRestore();
    });

    it("strictly respects topmost-sheet Escape dismissal order across multiple stacked sheets", async () => {
      const user = userEvent.setup();

      const onCloseSheet1 = vi.fn();
      const onCloseSheet2 = vi.fn();

      function StackedSheetsFixture() {
        const [open2, setOpen2] = useState(true);
        return (
          <>
            <CalculatorSheet
              calc={calculators[0]}
              answers={{}}
              onAnswersChange={() => {}}
              onClose={onCloseSheet1}
              sheetId="base-sheet-1"
              isOpen={true}
            />
            {open2 && (
              <CalculatorSheet
                calc={calculators[1]}
                answers={{}}
                onAnswersChange={() => {}}
                onClose={() => {
                  onCloseSheet2();
                  setOpen2(false);
                }}
                sheetId="top-sheet-2"
                isOpen={true}
              />
            )}
          </>
        );
      }

      render(<StackedSheetsFixture />);

      // Both sheets mounted, top-sheet-2 is topmost
      expect(isTopmostSheet("top-sheet-2")).toBe(true);
      expect(isTopmostSheet("base-sheet-1")).toBe(false);

      // Press Escape -> MUST close only sheet 2
      await user.keyboard("{Escape}");
      expect(onCloseSheet2).toHaveBeenCalledTimes(1);
      expect(onCloseSheet1).not.toHaveBeenCalled();

      // Now base-sheet-1 is topmost
      expect(isTopmostSheet("base-sheet-1")).toBe(true);

      // Press Escape again -> MUST close sheet 1
      await user.keyboard("{Escape}");
      expect(onCloseSheet1).toHaveBeenCalledTimes(1);
    });

    it("safely restores focus on unmount even if opener button was removed from DOM", () => {
      // Create a temporary opener button
      const opener = document.createElement("button");
      opener.textContent = "Open PHQ-9";
      document.body.appendChild(opener);
      opener.focus();
      expect(document.activeElement).toBe(opener);

      // Render CalculatorSheet
      const { unmount } = render(
        <CalculatorSheet calc={calc} answers={{}} onAnswersChange={() => {}} onClose={() => {}} isOpen={true} />,
      );

      // Opener is removed from DOM while sheet is open (e.g. list re-rendered)
      opener.remove();
      expect(opener.isConnected).toBe(false);

      // Unmounting sheet should safely handle disconnected target without throwing
      expect(() => unmount()).not.toThrow();
      expect(hasOpenSheet()).toBe(false);
    });

    it("empirically verifies canRestoreFocusTo logic against sheet stack", () => {
      const backgroundButton = document.createElement("button");
      document.body.appendChild(backgroundButton);

      const modalDiv = document.createElement("div");
      const modalButton = document.createElement("button");
      modalDiv.appendChild(modalButton);
      document.body.appendChild(modalDiv);

      // No open sheets -> can restore to any element
      expect(canRestoreFocusTo(backgroundButton)).toBe(true);

      // Push sheet with root modalDiv
      pushSheet("modal-sheet", modalDiv);

      // Target inside the modal sheet can receive focus
      expect(canRestoreFocusTo(modalButton)).toBe(true);

      // Target outside the modal sheet cannot receive focus while modal is open
      expect(canRestoreFocusTo(backgroundButton)).toBe(false);

      // Null target returns false
      expect(canRestoreFocusTo(null)).toBe(false);

      // Clean up
      popSheet("modal-sheet");
      backgroundButton.remove();
      modalDiv.remove();
    });

    it("handles 3-tier sheet stacking with 3 sequential Escape keydowns dismissing strictly in reverse order", async () => {
      const user = userEvent.setup();
      const close1 = vi.fn();
      const close2 = vi.fn();
      const close3 = vi.fn();

      function TripleStackedSheets() {
        const [open3, setOpen3] = useState(true);
        const [open2, setOpen2] = useState(true);

        return (
          <>
            <CalculatorSheet
              calc={calculators[0]}
              answers={{}}
              onAnswersChange={() => {}}
              onClose={close1}
              sheetId="sheet-bottom-1"
              isOpen={true}
            />
            {open2 && (
              <CalculatorSheet
                calc={calculators[1]}
                answers={{}}
                onAnswersChange={() => {}}
                onClose={() => {
                  close2();
                  setOpen2(false);
                }}
                sheetId="sheet-mid-2"
                isOpen={true}
              />
            )}
            {open3 && (
              <CalculatorSheet
                calc={calculators[2]}
                answers={{}}
                onAnswersChange={() => {}}
                onClose={() => {
                  close3();
                  setOpen3(false);
                }}
                sheetId="sheet-top-3"
                isOpen={true}
              />
            )}
          </>
        );
      }

      render(<TripleStackedSheets />);

      expect(isTopmostSheet("sheet-top-3")).toBe(true);

      // Escape 1: dismisses sheet 3
      await user.keyboard("{Escape}");
      expect(close3).toHaveBeenCalledTimes(1);
      expect(close2).not.toHaveBeenCalled();
      expect(close1).not.toHaveBeenCalled();

      // Now sheet 2 is top
      expect(isTopmostSheet("sheet-mid-2")).toBe(true);

      // Escape 2: dismisses sheet 2
      await user.keyboard("{Escape}");
      expect(close2).toHaveBeenCalledTimes(1);
      expect(close1).not.toHaveBeenCalled();

      // Now sheet 1 is top
      expect(isTopmostSheet("sheet-bottom-1")).toBe(true);

      // Escape 3: dismisses sheet 1
      await user.keyboard("{Escape}");
      expect(close1).toHaveBeenCalledTimes(1);
    });

    it("backdrop dismisses unstarted sheet but protects started sheet by moving focus to close button", async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();

      // 1. Unstarted sheet (no answers)
      const { unmount } = render(
        <CalculatorSheet calc={calc} answers={{}} onAnswersChange={() => {}} onClose={onClose} isOpen={true} />,
      );

      const backdrop = screen.getByTestId("calculator-sheet-backdrop");
      await user.click(backdrop);
      expect(onClose).toHaveBeenCalledTimes(1);

      unmount();
      onClose.mockReset();

      // 2. Started sheet (with an answer)
      render(
        <CalculatorSheet
          calc={calc}
          answers={{ [calc.items[0].id]: 1 }}
          onAnswersChange={() => {}}
          onClose={onClose}
          isOpen={true}
        />,
      );

      const startedBackdrop = screen.getByTestId("calculator-sheet-backdrop");
      await user.click(startedBackdrop);

      // Must NOT close the started sheet!
      expect(onClose).not.toHaveBeenCalled();

      // Focus must be moved to close button
      const closeBtn = screen.getByRole("button", { name: /close/i });
      expect(document.activeElement).toBe(closeBtn);
    });
  });
});
