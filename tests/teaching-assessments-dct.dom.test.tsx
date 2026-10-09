/** @vitest-environment jsdom */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { useReducer } from "react";
import { describe, expect, it, vi } from "vitest";

import { DctHome, DctPlan, DctSignoff } from "@/components/teaching/assessments/assessments-dct";
import { dctReducer, initialDctState } from "@/lib/teaching/assessments/dct";
import { initialAssessmentsState } from "@/lib/teaching/assessments/model";

/** One DCT screen over the opening story, with no toast (so a sign-off shows inline). */
function Harness({ screen: which, id = "" }: { screen: "home" | "sign" | "plan"; id?: string }) {
  const [dct, dctDispatch] = useReducer(dctReducer, undefined, initialDctState);
  const props = {
    s: initialAssessmentsState(),
    params: new URLSearchParams(id ? { id } : {}),
    go: vi.fn(),
    dct,
    dctDispatch,
  };
  if (which === "sign") return <DctSignoff {...props} />;
  if (which === "plan") return <DctPlan {...props} />;
  return <DctHome {...props} />;
}

describe("Assessments: the DCT's home", () => {
  it("lists forms to sign, plans, who is behind, and the rest of the service", () => {
    render(<Harness screen="home" />);
    expect(screen.getByText("2 forms to sign off")).toBeInTheDocument();
    expect(screen.getByText("Dr Charlie Balga · Term 3")).toBeInTheDocument();
    // No last day is shown: the AMC form does not say when the 14 days start.
    expect(screen.getByText("Can still reply")).toBeInTheDocument();
    expect(screen.queryByText(/Reply until/)).toBeNull();
    expect(
      within(screen.getByRole("list", { name: "Improvement plans" })).getByText("Dr Rowan Sheoak"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("list", { name: "Behind this term" })).getByText("Dr Rowan Sheoak"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Guest assessors/ }));
    expect(screen.getByTestId("assess-dct-guests")).toHaveTextContent("Unapproved");
  });

  it("explains the panel from the AMC guide", () => {
    render(<Harness screen="home" />);
    fireEvent.click(screen.getByRole("button", { name: /Assessment Review Panel/ }));
    expect(screen.getByTestId("assess-dct-panel")).toHaveTextContent("At least three members");
  });
});

describe("Assessments: the DCT signs one form", () => {
  it("signs with feedback, then sends changes to the MEU", () => {
    render(<Harness screen="sign" id="noah-t3" />);
    expect(screen.getByText("No written reply from Lou")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Feedback for Lou/), { target: { value: "A strong term." } });
    fireEvent.click(screen.getByRole("button", { name: "Sign off as DCT" }));
    expect(screen.getByTestId("assess-dct-signed")).toHaveTextContent('"A strong term."');
    expect(screen.getByText("Signed off for Dr Lou Quandong.")).toBeInTheDocument();
    expect(screen.getByTestId("assess-dct-signed")).toHaveTextContent("ask your MEU to return it to draft");
    expect(screen.queryByRole("button", { name: "Take back" })).toBeNull();
  });

  it("won't sign feedback that looks like patient details", () => {
    render(<Harness screen="sign" id="ella-t3" />);
    expect(screen.getByText("Charlie can still reply in writing")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Feedback for Charlie/), {
      target: { value: "URN 1234567 was well managed" },
    });
    expect(screen.getByRole("button", { name: "Sign off as DCT" })).toBeDisabled();
  });

  it("says so when the form isn't in the story", () => {
    render(<Harness screen="sign" id="nobody" />);
    expect(screen.getByText("Form not found")).toBeInTheDocument();
  });
});

describe("Assessments: an improvement plan", () => {
  it("shows the phase and the agreed actions", () => {
    render(<Harness screen="plan" id="ravi" />);
    expect(screen.getByText("2. Formal plan")).toBeInTheDocument();
    expect(screen.getByText(/1.1 Patient safety/)).toBeInTheDocument();
  });
});

describe("Assessments: changing a DCT sign-off", () => {
  // Rules audit W7: in CLA only the MEU returns a submitted form to draft, so there is no Take back.
  it("offers no Take back once signed", () => {
    render(<Harness screen="sign" id="noah-t3" />);
    fireEvent.click(screen.getByRole("button", { name: "Sign off as DCT" }));
    expect(screen.queryByRole("button", { name: "Take back" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign off as DCT" })).toBeNull();
  });

  it("tells the DCT the doctor can still reply, with no last day", () => {
    render(<Harness screen="sign" id="ella-t3" />);
    expect(screen.getByText(/your MEU says when the 14 days start/)).toBeInTheDocument();
    expect(screen.getByText(/Charlie can still write to you within the 14 days/)).toBeInTheDocument();
    expect(screen.queryByText(/Fri 9 Oct/)).toBeNull();
  });

  it("shows the supervisor's comments before signing", () => {
    render(<Harness screen="sign" id="ella-t3" />);
    const comments = screen.getByRole("list", { name: "Supervisor's comments" });
    expect(comments).toHaveTextContent("Strengths");
    expect(comments).toHaveTextContent("Areas for improvement");
  });
});
