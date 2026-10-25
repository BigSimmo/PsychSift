// @vitest-environment jsdom
import "./setup/jsdom.setup";

import { render, screen } from "@testing-library/react";
import { createElement as h } from "react";
import { describe, expect, it } from "vitest";

import { calculators as productionCalculators } from "@/components/calculators/calculator-fixtures";
import { deriveCalculator } from "@/components/calculators/calculator-ui";
import { ScorePanel } from "@/components/calculators/search-detail";
import { ToastProvider } from "@/components/ui/toast";

const EXPECTED_DISCLAIMER =
  "Clinical reference — not validated decision support. Confirm scoring and interpretation against the source instrument.";

// The unrouted bedside, search-detail, clinical-console and guided-flow mockup surfaces, the
// calculator-mockups tree and their cases here were deleted as unused on 25 Oct 2026 (owner
// decision). ScorePanel is the live score panel inside CalculatorSheet, so its disclaimer stays pinned.
describe("Calculator disclaimers (P1-7)", () => {
  it("renders the clinical reference disclaimer inside the score panel", () => {
    const phq9 = productionCalculators.find((c) => c.id === "phq9")!;

    render(
      h(
        ToastProvider,
        null,
        h(ScorePanel, {
          calc: { ...phq9, disclaimer: EXPECTED_DISCLAIMER },
          derived: deriveCalculator(phq9, {}),
          onReset: () => {},
        }),
      ),
    );
    expect(screen.getByText(EXPECTED_DISCLAIMER)).toBeInTheDocument();
  });
});
