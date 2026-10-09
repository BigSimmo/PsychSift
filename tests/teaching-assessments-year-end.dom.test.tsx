/** @vitest-environment jsdom */

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AllAssessments, TermDetails, YearRequirements } from "@/components/teaching/assessments/assessments-year";
import type { ScreenProps } from "@/components/teaching/assessments/teaching-assessments";
import { dctReducer, initialDctState, PANEL_DATE, SAM_FORM_ID, type DctState } from "@/lib/teaching/assessments/dct";
import { initialAssessmentsState, type AssessmentsState, type Signature } from "@/lib/teaching/assessments/model";

const sig = (date: string, day: number): Signature => ({ typed: "Sam Karri", image: null, date, day });

/** The story once Sam and Dr Wattle have both signed term 4. */
const bothSigned: AssessmentsState = {
  ...initialAssessmentsState(),
  sigs: { sup: sig("Mon 2 Nov", 0), doc: sig("Tue 3 Nov", 1) },
};

const signedOff: DctState = dctReducer(initialDctState(), {
  type: "dct-sign",
  id: SAM_FORM_ID,
  date: "Wed 4 Nov",
  feedback: "A strong term.",
});

function props(s: AssessmentsState, dct: DctState, query = "view=reqs"): ScreenProps {
  return {
    s,
    dispatch: vi.fn(),
    params: new URLSearchParams(query),
    role: "doctor",
    openSheet: vi.fn(),
    go: vi.fn(),
    saveEpa: vi.fn(),
    dct,
  };
}

describe("Assessments: the doctor's year end and PGY2 rules", () => {
  it("shows the panel, its four decisions and PGY1 general registration", () => {
    render(<YearRequirements {...props(initialAssessmentsState(), initialDctState())} tab />);
    const yearEnd = screen.getByTestId("assess-year-end");
    expect(within(yearEnd).getByText(new RegExp(`Meets ${PANEL_DATE}`))).toBeInTheDocument();
    expect(within(yearEnd).getByRole("list", { name: "What the panel can decide" }).children).toHaveLength(4);
    expect(within(yearEnd).getByText("General registration")).toBeInTheDocument();
    expect(within(yearEnd).getByText(/The Medical Board decides/)).toBeInTheDocument();
    expect(yearEnd).toHaveTextContent("PGY1 must be finished within 3 years");
  });

  it("lists PGY2's rules and its certificate in place of the old placeholder", () => {
    render(<YearRequirements {...props(initialAssessmentsState(), initialDctState())} tab />);
    const pgy2 = screen.getByTestId("assess-pgy2-rules");
    expect(within(pgy2).getByText("Finished within 4 years")).toBeInTheDocument();
    expect(pgy2).toHaveTextContent("A certificate of completion is issued at the end of PGY2");
    expect(screen.queryByText(/show here when you start PGY2/)).toBeNull();
    expect(screen.queryByText(/checked against the source before release/)).toBeNull();
  });

  it("labels the counter as term time and states the leave rules from the source", () => {
    render(<YearRequirements {...props(initialAssessmentsState(), initialDctState())} tab />);
    expect(screen.getByText("Weeks of term time")).toBeInTheDocument();
    expect(screen.getByText(/not counting annual leave/)).toBeInTheDocument();
    expect(screen.getByText(/such as sick, personal or carer's leave/)).toBeInTheDocument();
    expect(screen.queryByText(/countersign/i)).toBeNull();
    expect(screen.getByText(/In this example, counts are the made-up EPAs on this page/)).toBeInTheDocument();
  });

  it("says DCT sign-off is next once both have signed, and done with its date once the DCT signs off", () => {
    const { unmount } = render(<YearRequirements {...props(bothSigned, initialDctState())} tab />);
    expect(screen.getByText("Term 4 is signed by you both. DCT sign-off is next.")).toBeInTheDocument();
    unmount();
    render(<YearRequirements {...props(bothSigned, signedOff)} tab />);
    expect(screen.getByText("Term 4: DCT sign-off done Wed 4 Nov.")).toBeInTheDocument();
  });

  it("ignores a remembered sign-off once the story is reset", () => {
    render(<YearRequirements {...props(initialAssessmentsState(), signedOff)} tab />);
    expect(screen.queryByText(/DCT sign-off done Wed 4 Nov/)).toBeNull();
  });

  it("marks term 4 signed off on the term page and in all assessments", () => {
    const { unmount } = render(<TermDetails {...props(bothSigned, signedOff, "view=term&term=t4")} />);
    expect(screen.getByText("DCT sign-off done Wed 4 Nov")).toBeInTheDocument();
    expect(screen.getByText("Signed off")).toBeInTheDocument();
    unmount();
    render(<AllAssessments {...props(bothSigned, signedOff, "view=all")} />);
    expect(screen.getByText("DCT sign-off done Wed 4 Nov")).toBeInTheDocument();
  });
});
