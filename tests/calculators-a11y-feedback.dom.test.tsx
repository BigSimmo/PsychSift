/** @vitest-environment jsdom */

// Three gaps between what a sighted clinician sees and what a screen-reader user
// (or anyone pasting a copied score) gets:
//   - an unanswered checkbox and an explicit "No" looked and announced the same,
//   - the pinned running score in the calculator sheet was never announced,
//   - a refused clipboard write on "Copy result" / "Copy draft" showed nothing,
//     so the previous clipboard contents were pasted as the new result.

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/formulation/builder",
  useSearchParams: () => new URLSearchParams(),
}));

import { allCalculatorFixtures, type CalculatorFixture } from "@/components/calculators/calculator-fixtures";
import { CalculatorSheet } from "@/components/calculators/calculator-sheet";
import {
  CalculatorItems,
  CopyResultButton,
  deriveCalculator,
  type AnswerMap,
} from "@/components/calculators/calculator-ui";
import { FormulationBuilderPage } from "@/components/formulation/formulation-builder-page";
import { LiveAnnouncer, resetAnnouncerForTests } from "@/components/ui/live-announcer";

function fixture(id: string): CalculatorFixture {
  const found = allCalculatorFixtures.find((calculator) => calculator.id === id);
  if (!found) throw new Error(`Missing calculator fixture: ${id}`);
  return found;
}

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
const originalExecCommand = document.execCommand;

function refuseClipboard() {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockRejectedValue(new Error("NotAllowedError")) },
  });
  document.execCommand = vi.fn(() => false);
}

beforeEach(() => {
  resetAnnouncerForTests();
});

afterEach(() => {
  cleanup();
  resetAnnouncerForTests();
  vi.useRealTimers();
  if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
  else Reflect.deleteProperty(navigator, "clipboard");
  document.execCommand = originalExecCommand;
});

describe("checkbox items say when they are unanswered", () => {
  it("marks an MDQ item 'Not answered' until a Yes or an explicit No is recorded", () => {
    const calc = fixture("mdq");
    const firstCheckbox = calc.items.find((item) => item.kind === "checkbox");
    if (!firstCheckbox) throw new Error("MDQ has checkbox items");

    const { rerender } = render(<CalculatorItems calc={calc} answers={{}} onAnswersChange={() => {}} />);
    const boxes = () => screen.getAllByRole("checkbox");
    expect(boxes()[0]).toHaveAccessibleName(expect.stringContaining("Not answered"));

    rerender(<CalculatorItems calc={calc} answers={{ [firstCheckbox.id]: 0 }} onAnswersChange={() => {}} />);
    expect(boxes()[0]).toHaveAttribute("aria-checked", "false");
    expect(boxes()[0]).not.toHaveAccessibleName(expect.stringContaining("Not answered"));
    // The other items are still unanswered, and still say so.
    expect(boxes()[1]).toHaveAccessibleName(expect.stringContaining("Not answered"));

    rerender(<CalculatorItems calc={calc} answers={{ [firstCheckbox.id]: 1 }} onAnswersChange={() => {}} />);
    expect(boxes()[0]).toHaveAttribute("aria-checked", "true");
    expect(boxes()[0]).not.toHaveAccessibleName(expect.stringContaining("Not answered"));
  });
});

describe("calculator sheet announces the running score", () => {
  it("announces score, band and progress once a run of answers settles, not on opening", () => {
    vi.useFakeTimers();
    const originalScrollTo = Element.prototype.scrollTo;
    Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
    try {
      const calc = fixture("phq9");
      const opened: AnswerMap = { p1: 1 };
      const sheet = (answers: AnswerMap) => (
        <>
          <LiveAnnouncer />
          <CalculatorSheet calc={calc} answers={answers} onAnswersChange={() => {}} onClose={() => {}} />
        </>
      );
      const polite = () => screen.getByTestId("live-announcer-polite").textContent;

      const { rerender } = render(sheet(opened));
      act(() => vi.advanceTimersByTime(2000));
      expect(polite()).toBe("");

      rerender(sheet({ ...opened, p2: 2 }));
      rerender(sheet({ ...opened, p2: 2, p3: 3 }));
      act(() => vi.advanceTimersByTime(100));
      expect(polite()).toBe("");

      act(() => vi.advanceTimersByTime(1000));
      const derived = deriveCalculator(calc, { ...opened, p2: 2, p3: 3 });
      expect(polite()).toBe(`PHQ-9 score 6 of ${calc.maxScore}, ${derived.result.label}. 3 of 9 answered.`);
    } finally {
      Element.prototype.scrollTo = originalScrollTo;
    }
  });
});

describe("a refused clipboard is shown, not swallowed", () => {
  it("Copy result says Not copied and announces it", async () => {
    refuseClipboard();
    const calc = fixture("phq9");
    const complete = deriveCalculator(calc, Object.fromEntries(calc.items.map((item) => [item.id, 0])));
    render(
      <>
        <LiveAnnouncer />
        <CopyResultButton calc={calc} state={complete} />
      </>,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy result" }));
    });

    expect(screen.getByRole("button", { name: "Not copied" })).toBeInTheDocument();
    expect(screen.getByTestId("live-announcer-polite")).toHaveTextContent(
      "Result not copied. Copy it into the note by hand.",
    );
  });

  it("Copy draft on the formulation builder says Not copied instead of rejecting unhandled", async () => {
    refuseClipboard();
    const { container } = render(
      <>
        <LiveAnnouncer />
        <FormulationBuilderPage />
      </>,
    );
    const stepButtons = container.querySelectorAll('ol[aria-label="Formulation builder steps"] button');
    fireEvent.click(stepButtons[3]!);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy draft" }));
    });

    expect(screen.getByRole("button", { name: "Not copied" })).toBeInTheDocument();
    expect(screen.getByTestId("live-announcer-polite")).toHaveTextContent(
      "Draft not copied. Select the draft text and copy it by hand.",
    );
  });
});
