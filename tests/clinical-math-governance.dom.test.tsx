/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ClinicalMathPanel } from "@/components/calculators/clinical-math-panel";
import governance from "@/lib/calculators/clinical-math/governance.json";

describe("physiological calculator clinical validation hold", () => {
  it("refuses available metadata while the dedicated clinical review is still pending", () => {
    const previous = governance.releaseStatus;
    try {
      governance.releaseStatus = "available";
      render(<ClinicalMathPanel defaultOpen defaultTab="lithium" />);
      expect(screen.getByTestId("clinical-math-release-hold")).toBeInTheDocument();
      expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    } finally {
      governance.releaseStatus = previous;
    }
  });

  it.each(["renal", "qtc", "lithium"] as const)("withholds %s tools even when requested open", (defaultTab) => {
    render(<ClinicalMathPanel defaultOpen defaultTab={defaultTab} />);
    expect(screen.getByTestId("clinical-math-release-hold")).toHaveTextContent("dedicated clinical validation");
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(screen.queryByTestId("clinical-math-lithium-suggested-dose")).not.toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByText(/Suggested dose:|TOXICITY ALERT|Level status:|Risk:/)).not.toBeInTheDocument();
  });
});
