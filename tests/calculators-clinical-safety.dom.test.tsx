/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import {
  allCalculatorFixtures,
  calculators,
  calculatorEvidence,
  quarantinedCalculators,
  type CalculatorFixture,
} from "@/components/calculators/calculator-fixtures";
import { actionsForBand } from "@/components/calculators/calculator-pathways";
import { CalculatorsSearchPage } from "@/components/calculators/search-page";
import { CalculatorSheet } from "@/components/calculators/calculator-sheet";
import { NextActionsPanel, ScorePanel } from "@/components/calculators/search-detail";
import { CopyResultButton, deriveCalculator, type AnswerMap } from "@/components/calculators/calculator-ui";
import { sharedHomePresentation } from "@/lib/ui-copy";

// Cross-mode "also matches" panel is an AuthProvider-backed component of its own;
// it is exercised by tests/ui-universal-search.spec.ts, not by this page's unit test.
vi.mock("@/components/clinical-dashboard/universal-search-also-matches", () => ({
  UniversalSearchAlsoMatches: () => null,
}));
function fixture(id: string): CalculatorFixture {
  const found = allCalculatorFixtures.find((calculator) => calculator.id === id);
  if (!found) throw new Error(`Missing calculator fixture: ${id}`);
  return found;
}

function explicitAnswers(calc: CalculatorFixture, value = 0): AnswerMap {
  return Object.fromEntries(calc.items.map((item) => [item.id, value]));
}

describe("calculator clinical catalogue", () => {
  it("fails closed for unsafe or rights-blocked instruments", () => {
    const activeIds = calculators.map((calculator) => calculator.id);
    expect(activeIds).toEqual(["phq9", "gad7", "k10", "cage", "auditc"]);
    expect(activeIds).not.toContain("sadpersons");
    expect(activeIds).not.toContain("ybocs");
    expect(activeIds).not.toContain("mdq");

    expect(quarantinedCalculators.map((calculator) => calculator.id)).toEqual(
      expect.arrayContaining(["mdq", "sadpersons", "ybocs"]),
    );
  });

  it("requires evidence, rights and review metadata for every active instrument", () => {
    for (const calc of calculators) {
      expect(calc.instrumentVersion).toBeTruthy();
      expect(calc.sourceIds.length).toBeGreaterThan(0);
      expect(calc.claimIds.length).toBeGreaterThan(0);
      expect(calc.rights.status).toBe("available");
      expect(calc.lastReviewed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(calc.nextReview).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(calc.releaseStatus).toBe("available");
    }
  });

  it("resolves every source and claim reference", () => {
    const sourceIds = new Set(calculatorEvidence.sources.map((source) => source.id));
    const claimIds = new Set(calculatorEvidence.claims.map((claim) => claim.id));

    for (const calc of allCalculatorFixtures) {
      for (const sourceId of calc.sourceIds) expect(sourceIds.has(sourceId)).toBe(true);
      for (const claimId of calc.claimIds) expect(claimIds.has(claimId)).toBe(true);
    }

    for (const claim of calculatorEvidence.claims) {
      expect(claim.sourceIds.length).toBeGreaterThan(0);
      for (const sourceId of claim.sourceIds) expect(sourceIds.has(sourceId)).toBe(true);
    }

    for (const source of calculatorEvidence.sources) {
      expect(source.type).toBeTruthy();
      expect(source.version).toBeTruthy();
      expect(source.url).toMatch(/^https:\/\//);
      expect(source.claimsSupported.length).toBeGreaterThan(0);
      expect(source.limitations.length).toBeGreaterThan(0);
      for (const claimId of source.claimsSupported) expect(claimIds.has(claimId)).toBe(true);
    }
  });

  it("keeps deterministic treatment and disposition language out of score bands", () => {
    const forbidden =
      /\b(pharmacotherapy|start an? ssri|initiate|ect|admission|discharge|specialist referral|augmentation|treatment warranted)\b/i;

    for (const calc of allCalculatorFixtures) {
      for (const band of calc.bands) expect(band.interpretation).not.toMatch(forbidden);
    }
  });
});

describe("completion is not inferred from a partial score", () => {
  it("withholds a PHQ-9 band and considerations until all nine items are answered", () => {
    const calc = fixture("phq9");
    const partial = deriveCalculator(calc, { p1: 1 });

    expect(partial.started).toBe(true);
    expect(partial.complete).toBe(false);
    expect(partial.band).toBeUndefined();
    expect(partial.result.label).toBe("Incomplete");
    expect(actionsForBand(calc, partial)).toEqual([]);
  });

  it("surfaces the PHQ-9 item 9 safety alert before completion", () => {
    const calc = fixture("phq9");
    const partial = deriveCalculator(calc, { p9: 1 });

    expect(partial.complete).toBe(false);
    expect(partial.flags).toContain(
      "Item 9 endorsed — directly assess suicidal thoughts, self-harm thoughts and immediate safety now.",
    );
    expect(calc.items.find((item) => item.id === "p9")?.flagClaimId).toBe("claim:phq9:safety-flag");

    render(<NextActionsPanel calc={calc} derived={partial} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Item 9 endorsed — directly assess suicidal thoughts, self-harm thoughts and immediate safety now.",
    );
  });

  it("does not publish a final GAD-7 band from six answers", () => {
    const calc = fixture("gad7");
    const answers = Object.fromEntries(calc.items.slice(0, 6).map((item) => [item.id, 0]));
    const partial = deriveCalculator(calc, answers);

    expect(partial.complete).toBe(false);
    expect(partial.band).toBeUndefined();
    expect(partial.result.label).toBe("Incomplete");
  });

  it("does not turn an impairment-only MDQ into a completed negative screen", () => {
    const calc = fixture("mdq");
    const partial = deriveCalculator(calc, { mimp: 0 });

    expect(partial.complete).toBe(false);
    expect(partial.result.label).toBe("Incomplete");
  });

  it.each([
    ["a symptom response", "m1"],
    ["the co-occurrence response", "mco"],
    ["the impairment response", "mimp"],
  ])("does not complete MDQ when %s is missing", (_label, omittedItemId) => {
    const calc = fixture("mdq");
    const answers = explicitAnswers(calc, 0);
    delete answers[omittedItemId];

    const partial = deriveCalculator(calc, answers);
    expect(partial.complete).toBe(false);
    expect(partial.band).toBeUndefined();
    expect(partial.result.label).toBe("Incomplete");
  });

  it("allows a completed explicit-negative MDQ result in the quarantined fixture", () => {
    const calc = fixture("mdq");
    const answers = explicitAnswers(calc, 0);
    const complete = deriveCalculator(calc, answers);

    expect(complete.complete).toBe(true);
    expect(complete.result.label).toBe("Negative screen");
  });

  it("disables copying a result until the instrument is complete", () => {
    const calc = fixture("phq9");
    const partial = deriveCalculator(calc, { p1: 1 });
    render(<CopyResultButton calc={calc} state={partial} />);

    const copy = screen.getByRole("button", { name: "Copy result" });
    expect(copy).toHaveAttribute("aria-disabled", "true");
    expect(copy).not.toBeDisabled();
  });

  /**
   * L7: the internal governance record is attached to every calculator's
   * sourceIds and was rendered in the same "Sources:" line as a validation
   * study. It is provenance, not clinical evidence, so it must be labelled
   * separately. Owner decision 2026-09-25 (#XSZ4XV part 1): it is shown as plain
   * text, not a link — its target is a private engineering record a clinician
   * cannot open.
   */
  it("separates the internal governance record from the clinical sources line", () => {
    const calc = fixture("phq9");
    const complete = deriveCalculator(calc, explicitAnswers(calc));
    const governance = calculatorEvidence.sources.find((source) => source.type === "internal_governance_record");
    expect(governance).toBeDefined();

    const { container } = render(<ScorePanel calc={calc} derived={complete} onReset={vi.fn()} />);

    const sourcesLine = Array.from(container.querySelectorAll("p")).find((node) =>
      node.textContent?.startsWith("Sources:"),
    );
    expect(sourcesLine).toBeDefined();
    expect(sourcesLine?.textContent).not.toContain(governance!.title);

    const provenanceLine = Array.from(container.querySelectorAll("p")).find((node) =>
      node.textContent?.startsWith("Governance reference:"),
    );
    expect(provenanceLine?.textContent).toContain(governance!.title);
    expect(screen.queryByRole("link", { name: governance!.title })).toBeNull();
    expect(container.querySelector(`a[href="${governance!.url}"]`)).toBeNull();
  });

  it("renders a completed clinical consideration with its source link", () => {
    const calc = fixture("phq9");
    const complete = deriveCalculator(calc, explicitAnswers(calc));

    render(<NextActionsPanel calc={calc} derived={complete} />);
    expect(
      screen.getByRole("link", { name: "The PHQ-9: Validity of a Brief Depression Severity Measure" }),
    ).toHaveAttribute("href", "https://pmc.ncbi.nlm.nih.gov/articles/PMC1495268/");
  });
});

describe("calculator mode copy", () => {
  it("describes assessment, limitations and source-linked considerations without claiming all tools are validated", () => {
    expect(sharedHomePresentation.calculators.subtitle).toBe(
      "Psychiatry assessment and monitoring tools with scoring guidance, limitations, safety prompts, and source-linked clinical considerations.",
    );
  });

  it("keeps the scope line pinned with the live score, not below the fold", () => {
    // The sheet pins a live strip (score, progress, severity, band bar) above a
    // scrolling body. A caveat at the foot of that body is not in view while a
    // clinician answers a nine-item instrument and watches the running score, so
    // asserting the line merely EXISTS would pass for a placement that fails the
    // point of the change. `caution` is set on one of the five released
    // instruments, so for the other four this line is the only qualifier shown.
    // jsdom implements no scroll methods, and the sheet resets its scroll position
    // on mount. Stub rather than skip: the placement assertion below is the point.
    const originalScrollTo = Element.prototype.scrollTo;
    Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;

    const SCOPE =
      /Clinical reference — not validated decision support\. Confirm scoring and interpretation against the source instrument\./;
    const withoutCaution = calculators.filter((calculator) => !calculator.caution);
    expect(withoutCaution.length, "most released instruments carry no per-instrument caution").toBeGreaterThan(0);

    for (const calculator of withoutCaution) {
      const { container, unmount } = render(
        <CalculatorSheet calc={calculator} answers={{}} onAnswersChange={() => {}} onClose={() => {}} />,
      );

      const line = screen.getByText(SCOPE);
      expect(line, `${calculator.abbrev} renders a score with no scope line`).toBeInTheDocument();

      // The decisive assertion: it must not live inside the scrolling region.
      const scrollRegion = container.querySelector(".overflow-y-auto");
      expect(scrollRegion, "the sheet should still have a scrolling body").not.toBeNull();
      expect(
        scrollRegion?.contains(line),
        `${calculator.abbrev} scope line sits in the scroll body, so it is below the fold while the score is read`,
      ).toBe(false);

      unmount();
    }

    Element.prototype.scrollTo = originalScrollTo;
  });

  it("states the calculator interface privacy boundary on the live catalogue", () => {
    render(<CalculatorsSearchPage />);

    for (const notice of screen.getAllByText(/Calculator answers remain in this browser session/)) {
      expect(notice).toHaveTextContent(
        "Calculator answers remain in this browser session and are not intentionally submitted by this calculator interface. Application telemetry and clinical-record documentation are governed separately.",
      );
    }
  });
});
