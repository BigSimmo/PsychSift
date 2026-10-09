/** @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { useReducer, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { AssessmentsKeptInCla } from "@/components/teaching/assessments/assessments-kept-in-cla";
import { AssessmentsSheets, type SheetState } from "@/components/teaching/assessments/assessments-help";
import { assessmentsReducer, initialAssessmentsState, type AssessmentsAction } from "@/lib/teaching/assessments/model";

vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => ({ status: "authenticated", authEpoch: 0 }) }));

/** The sheets with one EPA 1 request already sent to the supervisor, and no toast (so results show inline). */
function Harness({ first, setup = [] }: { first: SheetState; setup?: AssessmentsAction[] }) {
  const [s, dispatch] = useReducer(assessmentsReducer, undefined, () =>
    [{ type: "request-epa", epa: 1, who: "sup" } as AssessmentsAction, ...setup].reduce(
      assessmentsReducer,
      initialAssessmentsState(),
    ),
  );
  const [sheet, setSheet] = useState<SheetState>(first);
  return (
    <>
      <p data-testid="statuses">{s.epaRequests.map((r) => r.status).join(",")}</p>
      <AssessmentsSheets
        sheet={sheet}
        close={() => setSheet(null)}
        s={s}
        dispatch={dispatch}
        saveEpa={dispatch}
        openSheet={setSheet}
      />
    </>
  );
}

describe("Assessments: an assessor who can't do an EPA", () => {
  it("can't assess yet keeps the request with the assessor", () => {
    render(<Harness first={{ kind: "supepa", index: 0 }} />);
    expect(screen.getByText("Requires direct supervision")).toBeInTheDocument();
    expect(screen.getByText(/CLA has no send back button/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Can't assess yet" }));
    fireEvent.click(screen.getByRole("button", { name: "Tell Sam" }));
    expect(screen.getByTestId("statuses")).toHaveTextContent("not-yet");
  });

  it("send back needs a note before it can go", () => {
    render(<Harness first={{ kind: "supepa", index: 0 }} />);
    fireEvent.click(screen.getByRole("button", { name: "Send back" }));
    const send = screen.getByRole("button", { name: "Send back to Sam" });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Why, for Sam/), { target: { value: "Ask the night registrar." } });
    expect(send).toBeEnabled();
    fireEvent.click(send);
    expect(screen.getByTestId("statuses")).toHaveTextContent("sent-back");
  });
});

describe("Assessments: the doctor's own request", () => {
  it("cancels a waiting request", () => {
    render(<Harness first={{ kind: "myepa", index: 0 }} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel request" }));
    expect(screen.getByTestId("statuses")).toHaveTextContent("cancelled");
  });

  it("offers to ask someone else once it is sent back", () => {
    render(
      <Harness
        first={{ kind: "myepa", index: 0 }}
        setup={[{ type: "epa-send-back", index: 0, reply: "Ask the night registrar." }]}
      />,
    );
    expect(screen.getByText(`"Ask the night registrar."`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ask someone else" }));
    expect(screen.getByRole("button", { name: "Send request" })).toBeInTheDocument();
  });
});

describe("Assessments kept in CLA", () => {
  it("says how CLA works, with its sources", () => {
    render(<AssessmentsKeptInCla />);
    const card = screen.getByTestId("teaching-assessments-how-cla");
    expect(card).toHaveTextContent("At least 10 a year and at least 2 each term, with EPA 1 every term.");
    expect(card).toHaveTextContent("CLA has no send back button.");
    expect(card).toHaveTextContent("RANZCP registrars");
    expect(screen.getByRole("link", { name: /AMC framework/ })).toHaveAttribute(
      "href",
      expect.stringContaining("amc.org.au"),
    );
  });
});
