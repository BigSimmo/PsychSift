/** @vitest-environment jsdom */

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AssessmentsExtrasProvider,
  AssessmentsSampleViewsNav,
} from "@/components/teaching/assessments/assessments-extras";
import { AssessmentsInbox } from "@/components/teaching/assessments/assessments-inbox";
import { AssessmentsTermOverview } from "@/components/teaching/assessments/assessments-term-overview";
import type { ScreenProps } from "@/components/teaching/assessments/teaching-assessments";
import { ToastProvider } from "@/components/ui/toast";
import { assessmentsReducer, initialAssessmentsState, type AssessmentsState } from "@/lib/teaching/assessments/model";

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

function props(s: AssessmentsState, extra: Partial<ScreenProps> = {}): ScreenProps {
  return {
    s,
    dispatch: vi.fn(),
    params: new URLSearchParams("view=inbox&as=supervisor"),
    role: "supervisor",
    openSheet: vi.fn(),
    go: vi.fn(),
    ...extra,
  };
}

function renderWith(ui: React.ReactNode) {
  return render(
    <ToastProvider>
      <AssessmentsExtrasProvider>{ui}</AssessmentsExtrasProvider>
    </ToastProvider>,
  );
}

const windowOpen = assessmentsReducer(initialAssessmentsState(), { type: "set-now", now: 0 });

describe("consultant inbox", () => {
  it("lists what is waiting, overdue first, and filters by kind", () => {
    renderWith(<AssessmentsInbox {...props(windowOpen)} />);
    const inbox = screen.getByTestId("assessments-inbox");
    expect(within(inbox).getByRole("heading", { name: "Overdue · 1" })).toBeInTheDocument();
    expect(within(inbox).getByRole("button", { name: /Dr Ben Ortiz · Mid-term assessment/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "EPAs · 3" }));
    expect(screen.queryByRole("button", { name: /Dr Ben Ortiz/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Dr Mia Chen · EPA 2/ })).toBeInTheDocument();
  });

  it("opens a request in one tap, catches patient details, and sends with Undo", async () => {
    renderWith(<AssessmentsInbox {...props(windowOpen)} />);
    fireEvent.click(screen.getByRole("button", { name: /Dr Mia Chen · EPA 2/ }));
    const sheet = await screen.findByTestId("assessments-inbox-feedback");
    const send = within(sheet).getByTestId("assessments-inbox-send");
    expect(send).toBeDisabled();
    expect(within(sheet).getByText("Choose the supervision the doctor needed.")).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("radio", { name: "Proximal" }));
    fireEvent.change(within(sheet).getByLabelText(/A few lines/), {
      target: { value: "Calm review of bed 12 overnight" },
    });
    expect(within(sheet).getByRole("alert")).toHaveTextContent("catches some details, not all");
    expect(send).toBeDisabled();
    fireEvent.change(within(sheet).getByLabelText(/A few lines/), { target: { value: "Calm, clear escalation." } });
    expect(within(sheet).queryByRole("alert")).toBeNull();
    fireEvent.click(send);
    expect(await screen.findByTestId("toast")).toHaveTextContent(/Sending to Dr Mia Chen in 10/);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    // Undone: back in the list, and the answer is kept for reopening.
    fireEvent.click(screen.getByRole("button", { name: /Dr Mia Chen · EPA 2/ }));
    const again = await screen.findByTestId("assessments-inbox-feedback");
    expect(within(again).getByLabelText(/A few lines/)).toHaveValue("Calm, clear escalation.");
    fireEvent.click(within(again).getByTestId("assessments-inbox-send"));
    await act(async () => {
      vi.advanceTimersByTime(10_500);
    });
    fireEvent.click(screen.getByRole("radio", { name: /Done · 1/ }));
    expect(screen.getByText("Proximal, with a few lines")).toBeInTheDocument();
  });

  it("opens Sam's EPA in the sample's own sheet and Sam's form on its screen", () => {
    const s = [
      { type: "form-example", who: "self" } as const,
      { type: "form-finish", who: "self" } as const,
      { type: "send-request" } as const,
      { type: "request-epa", epa: 1, who: "sup" } as const,
    ].reduce(assessmentsReducer, windowOpen);
    const p = props(s);
    renderWith(<AssessmentsInbox {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /Dr Sam Lee · EPA 1/ }));
    expect(p.openSheet).toHaveBeenCalledWith({ kind: "supepa", index: 0 });
    fireEvent.click(screen.getByRole("button", { name: /Dr Sam Lee · End-of-term assessment/ }));
    expect(p.go).toHaveBeenCalledWith("/teaching/assessments?view=form&as=supervisor");
  });

  it("moves a request to Later and says Nothing waiting once all are answered", async () => {
    renderWith(<AssessmentsInbox {...props(initialAssessmentsState())} />);
    for (const name of [/Dr Mia Chen/, /Dr Ella Okafor/, /Dr Ravi Kaur/]) {
      fireEvent.click(screen.getByRole("button", { name }));
      fireEvent.click(await screen.findByRole("button", { name: "Can't do this one" }));
      fireEvent.click(await screen.findByRole("button", { name: /Better from another consultant/ }));
    }
    expect(screen.getByRole("radio", { name: /Waiting · 1/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Dr Ben Ortiz/ }));
    expect(await screen.findByTestId("assessments-inbox-status")).toHaveTextContent("isn't built into the sample");
  });

  it("is reached from the supervisor home with a waiting count", () => {
    renderWith(<AssessmentsSampleViewsNav s={initialAssessmentsState()} />);
    expect(screen.getByRole("link", { name: /Inbox/ })).toHaveAttribute(
      "href",
      "/teaching/assessments?view=inbox&as=supervisor",
    );
    expect(screen.getByText(/4 requests waiting/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Term overview/ })).toHaveAttribute(
      "href",
      "/teaching/assessments?view=overview&as=supervisor",
    );
  });
});

describe("term overview", () => {
  it("shows status tags only, with the meter in words", () => {
    renderWith(<AssessmentsTermOverview {...props(initialAssessmentsState())} />);
    expect(screen.getByRole("img", { name: "Mid-term: 4 done, 2 due, 2 overdue, of 8 doctors." })).toBeInTheDocument();
    expect(screen.getByText(/Ratings and comments are never shown here/)).toBeInTheDocument();
    const ravi = screen.getByTestId("assessments-overview-ravi");
    expect(within(ravi).getByText("Mid · Overdue")).toBeInTheDocument();
    fireEvent.click(within(ravi).getByRole("button", { expanded: false }));
    expect(within(ravi).getByText("Overdue since Fri 2 Oct")).toBeVisible();
    expect(screen.getByTestId("assessments-overview-csv")).toHaveAttribute(
      "download",
      "made-up-term-assessments-status.csv",
    );
  });

  it("reminds the supervisor in one tap, once a day, with Undo", async () => {
    renderWith(<AssessmentsTermOverview {...props(initialAssessmentsState())} />);
    const remind = screen.getByRole("button", { name: "Remind Dr Omar Ahmed about Dr Ravi Kaur's mid-term" });
    fireEvent.click(remind);
    expect(await screen.findByText("Reminder to Dr Omar Ahmed about Dr Ravi Kaur's mid-term")).toBeInTheDocument();
    const done = screen.getByRole("button", { name: "Dr Omar Ahmed reminded today about Dr Ravi Kaur" });
    expect(done).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(
      screen.getByRole("button", { name: "Remind Dr Omar Ahmed about Dr Ravi Kaur's mid-term" }),
    ).toBeInTheDocument();
  });

  it("filters by status and groups by supervisor", () => {
    renderWith(<AssessmentsTermOverview {...props(initialAssessmentsState())} />);
    fireEvent.click(screen.getByRole("button", { name: "On track · 1" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    fireEvent.click(screen.getByRole("radio", { name: "Supervisors" }));
    expect(screen.getByRole("button", { name: "Remind Dr Hana Ito about 2 forms" })).toBeInTheDocument();
  });
});
