/** @vitest-environment jsdom */

import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/components/clinical-dashboard/universal-search-also-matches", () => ({
  UniversalSearchAlsoMatches: () => null,
}));

import { ClinicalMathPanel } from "@/components/calculators/clinical-math-panel";
import { CalculatorsSearchPage } from "@/components/calculators/search-page";

// A controllable (min-width: 1280px) query, so the test can cross the desktop breakpoint.
function installDesktopQuery(initial: boolean) {
  let matches = initial;
  const listeners = new Set<() => void>();
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      media: query,
      get matches() {
        return query === "(min-width: 1280px)" ? matches : false;
      },
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
      addListener: (listener: () => void) => listeners.add(listener),
      removeListener: (listener: () => void) => listeners.delete(listener),
      onchange: null,
      dispatchEvent: () => true,
    })),
  );
  return (next: boolean) => {
    matches = next;
    act(() => {
      for (const listener of listeners) listener();
    });
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// Owner decision 17 Oct 2026 22:12 AWST: the bedside calculator panel (renal, QTc, lithium) stays
// hidden from /calculators until clinician verification. See
// docs/decisions/2026-10-17-clinical-math-panel-hidden-until-clinician-verification.md.
describe("bedside calculator panel on the calculators page", () => {
  it("is not rendered in the sidebar or the mobile column at either breakpoint", () => {
    const setDesktop = installDesktopQuery(false);
    render(<CalculatorsSearchPage />);
    const expectPanelAbsent = () => {
      expect(screen.queryByTestId("clinical-math-panel")).not.toBeInTheDocument();
      expect(screen.queryByTestId("clinical-math-panel-toggle")).not.toBeInTheDocument();
      expect(screen.queryByTestId("clinical-math-release-hold")).not.toBeInTheDocument();
      expect(screen.queryByTestId("clinical-math-lithium-suggested-dose")).not.toBeInTheDocument();
    };
    expectPanelAbsent();

    setDesktop(true);
    expectPanelAbsent();

    setDesktop(false);
    expectPanelAbsent();
  });
});

describe("bedside calculator panel component (unwired, kept for clinician verification)", () => {
  it("withholds lithium inputs and management advice while dedicated clinical validation is pending", () => {
    render(<ClinicalMathPanel defaultOpen defaultTab="lithium" />);

    expect(screen.getByTestId("clinical-math-release-hold")).toHaveTextContent("dedicated clinical validation");
    expect(screen.getByTestId("clinical-math-release-hold")).toHaveTextContent("approved local reference");
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByTestId("clinical-math-lithium-level")).not.toBeInTheDocument();
    expect(screen.queryByTestId("clinical-math-lithium-results")).not.toBeInTheDocument();
    expect(screen.queryByText(/TOXICITY ALERT|Suggested dose:/)).not.toBeInTheDocument();
  });
});
