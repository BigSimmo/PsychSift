// @vitest-environment jsdom
import "./setup/jsdom.setup";

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement as h } from "react";
import { describe, expect, it, vi } from "vitest";

import { calculators as mockupCalculators } from "@/components/calculator-mockups/calculator-fixtures";
import { CalculatorsBedsideSheetMockup } from "@/components/calculators/bedside-sheet";
import { calculators as productionCalculators } from "@/components/calculators/calculator-fixtures";
import { deriveCalculator } from "@/components/calculators/calculator-ui";
import { CalculatorsClinicalConsoleMockup } from "@/components/calculators/clinical-console";
import { CalculatorsGuidedFlowMockup } from "@/components/calculators/guided-flow";
import { CalculatorsSearchDetailMockup, ScorePanel } from "@/components/calculators/search-detail";
import { ToastProvider } from "@/components/ui/toast";

const EXPECTED_DISCLAIMER =
  "Clinical reference — not validated decision support. Confirm scoring and interpretation against the source instrument.";

describe("Calculator Completion Policy, Disclaimers & Quarantine Parity (P1-7)", () => {
  it("prevents copying incomplete bedside scores and copies only completed scales", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    render(h(ToastProvider, null, h(CalculatorsBedsideSheetMockup)));

    const copyButton = screen.getByRole("button", { name: "Copy summary" });
    expect(copyButton).toBeDisabled();

    // Answer only the first item of PHQ-9 (1 of 9 items -> started, but incomplete)
    const phq9Section = document.getElementById("sheet-phq9")!;
    const firstItemButtons = within(phq9Section).getAllByRole("button", { name: /Nearly every day/i });
    await user.click(firstItemButtons[0]);

    // Copy summary must remain disabled because PHQ-9 is incomplete (1/9)
    expect(copyButton).toBeDisabled();
    expect(writeText).not.toHaveBeenCalled();

    // Open CAGE (4 checkbox items) and answer all 4 items so CAGE is complete
    const cageSection = document.getElementById("sheet-cage")!;
    const cageToggle = within(cageSection).getByRole("button", { name: /CAGE/i });
    await user.click(cageToggle);

    const cageCheckboxes = within(cageSection).getAllByRole("checkbox");
    expect(cageCheckboxes).toHaveLength(4);
    for (const btn of cageCheckboxes) {
      await user.click(btn);
    }

    // Now CAGE is complete while PHQ-9 is still incomplete; Copy summary is enabled
    expect(copyButton).toBeEnabled();
    await user.click(copyButton);

    expect(writeText).toHaveBeenCalledTimes(1);
    const copiedText = String(writeText.mock.calls[0]?.[0] ?? "");
    expect(copiedText).toContain("CAGE 4/4");
    expect(copiedText).not.toContain("PHQ-9");
  });

  it("renders the clinical reference disclaimer inside the sticky score strip / footer of bedside-sheet, search-detail, clinical-console, and guided-flow", async () => {
    const user = userEvent.setup();
    const phq9 = productionCalculators.find((c) => c.id === "phq9")!;
    const cage = productionCalculators.find((c) => c.id === "cage")!;

    // 1. Bedside sheet: pinned inside Session summary dock even when all sections are collapsed or multiple sections are open
    const { unmount: unmountBedside } = render(h(ToastProvider, null, h(CalculatorsBedsideSheetMockup)));
    const sessionSummaryDock = screen.getByRole("region", { name: "Session summary" });
    expect(within(sessionSummaryDock).getByText(EXPECTED_DISCLAIMER)).toBeInTheDocument();
    const phq9Section = document.getElementById("sheet-phq9")!;
    await user.click(within(phq9Section).getByRole("button", { name: /PHQ-9/i }));
    // With all sections collapsed, the disclaimer remains visible in the sticky session summary dock
    expect(within(sessionSummaryDock).getByText(EXPECTED_DISCLAIMER)).toBeInTheDocument();
    unmountBedside();

    // 2. Search detail (ScorePanel with custom disclaimer + CalculatorsSearchDetailMockup sticky Live score strip)
    const { unmount: unmountScorePanel } = render(
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
    unmountScorePanel();

    const originalScrollTo = window.scrollTo;
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
    const { unmount: unmountSearchDetail } = render(h(ToastProvider, null, h(CalculatorsSearchDetailMockup)));
    await user.click(screen.getByRole("button", { name: /PHQ-9/i }));
    const liveScoreStrip = screen.getByRole("region", { name: "Live score" });
    expect(within(liveScoreStrip).getByText(EXPECTED_DISCLAIMER)).toBeInTheDocument();
    unmountSearchDetail();
    window.scrollTo = originalScrollTo;

    // 3. Clinical console: pinned inside sticky Live result strip
    const { unmount: unmountConsole } = render(h(ToastProvider, null, h(CalculatorsClinicalConsoleMockup)));
    const liveResultStrip = screen.getByRole("region", { name: "Live result" });
    expect(within(liveResultStrip).getByText(EXPECTED_DISCLAIMER)).toBeInTheDocument();
    unmountConsole();

    // 4. Guided flow ResultScreen (complete 4-item CAGE to reach ResultScreen)
    const { unmount: unmountGuided } = render(h(ToastProvider, null, h(CalculatorsGuidedFlowMockup)));
    await user.click(screen.getByRole("button", { name: new RegExp(cage.abbrev, "i") }));
    for (let i = 0; i < cage.items.length; i++) {
      await user.click(screen.getByRole("button", { name: /^No/i }));
    }
    expect(screen.getByText(EXPECTED_DISCLAIMER)).toBeInTheDocument();
    unmountGuided();
  });

  it("excludes quarantined instruments (mdq, sadpersons, ybocs) from mockup calculator-fixtures", () => {
    const mockupIds = mockupCalculators.map((calc) => calc.id);
    expect(mockupIds).not.toContain("mdq");
    expect(mockupIds).not.toContain("sadpersons");
    expect(mockupIds).not.toContain("ybocs");
    expect(mockupIds).toEqual(["phq9", "gad7", "k10", "cage", "auditc"]);
  });
});
