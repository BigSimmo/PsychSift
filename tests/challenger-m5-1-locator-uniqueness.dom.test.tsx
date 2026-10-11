/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CmeCustomisePage } from "@/components/cme/cme-customise-page";
import { cmeDashboardModuleIds, cmeDashboardModuleLabels, defaultCmeModuleOrder } from "@/lib/cme/module-order";
import { cmeModuleOrderStorageKey } from "@/lib/cme/module-order-keys";

const navigation = vi.hoisted(() => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation, usePathname: () => "/cme/customise" }));

describe("Challenger M5-1: CME Phone Customization Strict-Mode Locator Uniqueness (#F06YE4)", () => {
  beforeEach(() => {
    window.localStorage.removeItem(cmeModuleOrderStorageKey);
  });

  afterEach(() => {
    cleanup();
    window.localStorage.removeItem(cmeModuleOrderStorageKey);
  });

  function assertStrictModeUniqueness(container: HTMLElement) {
    // 1. Assert every data-testid in the DOM tree appears exactly once
    const elementsWithTestId = container.querySelectorAll("[data-testid]");
    const testIdMap = new Map<string, Element[]>();
    for (const el of elementsWithTestId) {
      const id = el.getAttribute("data-testid")!;
      if (!testIdMap.has(id)) testIdMap.set(id, []);
      testIdMap.get(id)!.push(el);
    }

    for (const [testId, elements] of testIdMap.entries()) {
      expect(
        elements.length,
        `Strict mode violation: data-testid="${testId}" resolved to ${elements.length} elements`,
      ).toBe(1);
      // Verify screen.getByTestId does not throw a multiple-matches error
      expect(screen.getByTestId(testId)).toBe(elements[0]);
    }

    // 2. Assert all buttons have unique accessible names (no ambiguous getByRole('button', { name: ... }))
    const buttons = screen.getAllByRole("button");
    const buttonNameMap = new Map<string, HTMLElement[]>();
    for (const btn of buttons) {
      const accessibleName =
        btn.getAttribute("aria-label")?.trim() ||
        btn.getAttribute("aria-labelledby")?.trim() ||
        btn.textContent?.trim() ||
        "";
      expect(accessibleName.length, "Button must have a non-empty accessible name").toBeGreaterThan(0);
      if (!buttonNameMap.has(accessibleName)) buttonNameMap.set(accessibleName, []);
      buttonNameMap.get(accessibleName)!.push(btn);
    }

    for (const [name, elements] of buttonNameMap.entries()) {
      expect(
        elements.length,
        `Strict mode violation: getByRole('button', { name: "${name}" }) resolved to ${elements.length} elements`,
      ).toBe(1);
      // Verify screen.getByRole resolves strictly to 1 element
      expect(screen.getByRole("button", { name })).toBe(elements[0]);
    }

    // 3. Assert headings have unique accessible names
    const headings = screen.getAllByRole("heading");
    const headingNameMap = new Map<string, HTMLElement[]>();
    for (const heading of headings) {
      const name = heading.textContent?.trim() || "";
      if (!headingNameMap.has(name)) headingNameMap.set(name, []);
      headingNameMap.get(name)!.push(heading);
    }
    for (const [name, elements] of headingNameMap.entries()) {
      expect(
        elements.length,
        `Strict mode violation: getByRole('heading', { name: "${name}" }) resolved to ${elements.length} elements`,
      ).toBe(1);
      expect(screen.getByRole("heading", { name })).toBe(elements[0]);
    }

    // 4. Assert role="main" resolves to exactly one element
    expect(screen.getByRole("main")).toBeInTheDocument();
  }

  it("verifies strict-mode locator uniqueness under default state (all 6 modules shown)", () => {
    const { container } = render(<CmeCustomisePage />);
    assertStrictModeUniqueness(container);

    // Verify key testids and roles explicitly
    expect(screen.getByTestId("cme-customise")).toBeInTheDocument();
    expect(screen.getByTestId("cme-customise-body")).toBeInTheDocument();
    expect(screen.getByTestId("cme-module-order")).toBeInTheDocument();
    expect(screen.queryByTestId("cme-module-order-hidden")).not.toBeInTheDocument();
    expect(screen.queryByTestId("cme-module-order-empty")).not.toBeInTheDocument();

    // Verify each module's 3 buttons are unique
    for (const id of defaultCmeModuleOrder) {
      const label = cmeDashboardModuleLabels[id];
      expect(screen.getByRole("button", { name: `Move ${label} up` })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: `Move ${label} down` })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: `Hide ${label}` })).toBeInTheDocument();
    }
  });

  it("verifies strict-mode locator uniqueness under partial hidden state (3 shown, 3 hidden)", () => {
    const shown = ["requirements", "routines-due", "audited-today"];
    window.localStorage.setItem(cmeModuleOrderStorageKey, JSON.stringify({ v: 2, shown }));

    const { container } = render(<CmeCustomisePage />);
    assertStrictModeUniqueness(container);

    expect(screen.getByTestId("cme-module-order")).toBeInTheDocument();
    expect(screen.getByTestId("cme-module-order-hidden")).toBeInTheDocument();
    expect(screen.queryByTestId("cme-module-order-empty")).not.toBeInTheDocument();

    // Verify shown modules have Move up/down and Hide
    for (const id of shown) {
      const label = cmeDashboardModuleLabels[id as keyof typeof cmeDashboardModuleLabels];
      expect(screen.getByRole("button", { name: `Move ${label} up` })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: `Move ${label} down` })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: `Hide ${label}` })).toBeInTheDocument();
    }

    // Verify hidden modules have Show button
    const hidden = cmeDashboardModuleIds.filter((id) => !shown.includes(id));
    for (const id of hidden) {
      const label = cmeDashboardModuleLabels[id];
      expect(screen.getByRole("button", { name: `Show ${label}` })).toBeInTheDocument();
    }
  });

  it("verifies strict-mode locator uniqueness under empty state (0 shown, all 6 hidden)", () => {
    window.localStorage.setItem(cmeModuleOrderStorageKey, JSON.stringify({ v: 2, shown: [] }));

    const { container } = render(<CmeCustomisePage />);
    assertStrictModeUniqueness(container);

    expect(screen.queryByTestId("cme-module-order")).not.toBeInTheDocument();
    expect(screen.getByTestId("cme-module-order-empty")).toBeInTheDocument();
    expect(screen.getByTestId("cme-module-order-hidden")).toBeInTheDocument();

    for (const id of cmeDashboardModuleIds) {
      const label = cmeDashboardModuleLabels[id];
      expect(screen.getByRole("button", { name: `Show ${label}` })).toBeInTheDocument();
    }
  });
});
