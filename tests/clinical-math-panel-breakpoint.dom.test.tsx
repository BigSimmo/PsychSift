/** @vitest-environment jsdom */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/components/clinical-dashboard/universal-search-also-matches", () => ({
  UniversalSearchAlsoMatches: () => null,
}));

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

describe("bedside calculator panel across the desktop breakpoint", () => {
  it("keeps the clinician's entries when the panel moves between the sidebar and the mobile column", () => {
    const setDesktop = installDesktopQuery(false);
    render(<CalculatorsSearchPage />);

    fireEvent.click(screen.getByTestId("clinical-math-panel-toggle"));
    fireEvent.change(screen.getByLabelText("Age (years)"), { target: { value: "72" } });
    fireEvent.change(screen.getByLabelText("Weight (kg)"), { target: { value: "64" } });

    setDesktop(true);
    expect(screen.getAllByTestId("clinical-math-panel-toggle")).toHaveLength(1);
    expect(screen.getByLabelText("Age (years)")).toHaveValue(72);
    expect(screen.getByLabelText("Weight (kg)")).toHaveValue(64);

    setDesktop(false);
    expect(screen.getByLabelText("Age (years)")).toHaveValue(72);
  });

  it("shows the lithium toxicity alert from 1.2 mmol/L before an age is entered", () => {
    installDesktopQuery(false);
    render(<CalculatorsSearchPage />);

    fireEvent.click(screen.getByTestId("clinical-math-panel-toggle"));
    fireEvent.click(screen.getByTestId("clinical-math-tab-lithium"));
    const level = screen.getByTestId("clinical-math-lithium-level");

    fireEvent.change(level, { target: { value: "0.9" } });
    expect(screen.getByTestId("clinical-math-lithium-results")).toHaveTextContent("Enter current 12-hour trough level");

    fireEvent.change(level, { target: { value: "1.2" } });
    const results = screen.getByTestId("clinical-math-lithium-results");
    expect(results).toHaveTextContent("Level status: toxic");
    expect(results).toHaveTextContent("TOXICITY ALERT");
    expect(results).toHaveTextContent("Enter patient age to see the target range.");
    expect(results).not.toHaveTextContent("target 0");
  });
});
