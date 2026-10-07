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
  it("shows status marks only, with the meter and every mark in words", () => {
    renderWith(<AssessmentsTermOverview {...props(initialAssessmentsState())} />);
    expect(screen.getByRole("img", { name: "Mid-term: 4 done, 2 due, 2 overdue, of 8 doctors." })).toBeInTheDocument();
    expect(screen.getByText(/Ratings and comments are never shown here/)).toBeInTheDocument();
    const ravi = screen.getByTestId("assessments-overview-ravi");
    expect(within(ravi).getByRole("img", { name: "Mid-term overdue" })).toBeInTheDocument();
    expect(within(ravi).getByRole("img", { name: /^EPAs 0 of 2, below the term target$/ })).toBeInTheDocument();
    expect(within(ravi).getByRole("img", { name: "End-of-term not open yet" })).toBeInTheDocument();
    // One tap opens the doctor's own status page.
    expect(within(ravi).getByRole("link")).toHaveAttribute(
      "href",
      "/teaching/assessments?view=overview&as=supervisor&doctor=ravi",
    );
    fireEvent.click(screen.getByRole("button", { name: "Export status" }));
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

  it("keeps on-track doctors behind Show more, and opens them on a tap", () => {
    renderWith(<AssessmentsTermOverview {...props(initialAssessmentsState())} />);
    expect(screen.queryByTestId("assessments-overview-noah")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Show 1 more/ }));
    expect(screen.getByTestId("assessments-overview-noah")).toBeInTheDocument();
  });

  it("reminds several supervisors at once, showing the exact status-only message", async () => {
    renderWith(<AssessmentsTermOverview {...props(initialAssessmentsState())} />);
    fireEvent.click(screen.getByRole("button", { name: "Remind Dr Omar Ahmed about Dr Ravi Kaur's mid-term" }));
    fireEvent.click(screen.getByRole("radio", { name: "Supervisors" }));
    expect(screen.getByText("1 already reminded today")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "3 doctors · mid-term 1 done, 1 due, 1 overdue" })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("assessments-overview-bulk-open"));
    const bulk = await screen.findByTestId("assessments-overview-bulk");
    // Dr Ahmed was reminded today: shown, unticked, marked Today.
    expect(within(bulk).queryByRole("checkbox", { name: /Dr Omar Ahmed/ })).toBeNull();
    expect(within(bulk).getByText("Today")).toBeInTheDocument();
    expect(within(bulk).getByTestId("assessments-overview-bulk-message")).toHaveTextContent(
      /assessment is (overdue|due .*)\. Please finish it in Assessments/,
    );
    const send = within(bulk).getByTestId("assessments-overview-bulk-send");
    expect(send).toHaveTextContent("Send 2 reminders");
    fireEvent.click(within(bulk).getByRole("checkbox", { name: /Dr Hana Ito/ }));
    fireEvent.click(within(bulk).getByRole("checkbox", { name: /Dr Priya Nair/ }));
    expect(send).toBeDisabled();
    expect(within(bulk).getByText("Tick at least one supervisor.")).toBeInTheDocument();
    fireEvent.click(within(bulk).getByRole("checkbox", { name: /Dr Hana Ito/ }));
    fireEvent.click(send);
    expect(await screen.findByText("1 reminder sent to supervisors")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /Sent · 3/ }));
    const sent = screen.getByTestId("assessments-overview-sent");
    expect(within(sent).getAllByText("Dr Hana Ito")).toHaveLength(2);
    expect(within(sent).getByText("Dr Omar Ahmed")).toBeInTheDocument();
  });

  it("shows one doctor's status timeline, private content, and Remind once a day", async () => {
    const p = props(initialAssessmentsState(), {
      params: new URLSearchParams("view=overview&as=supervisor&doctor=tom"),
    });
    renderWith(<AssessmentsTermOverview {...p} />);
    const page = screen.getByTestId("assessments-overview-doctor");
    expect(within(page).getByRole("heading", { name: "Dr Tom Fraser" })).toBeInTheDocument();
    expect(within(page).getByText("Overdue since Fri 2 Oct")).toBeInTheDocument();
    expect(within(page).getByText("Content stays private")).toBeInTheDocument();
    expect(within(page).getByRole("link", { name: /Open Clinical Learning Australia/ })).toHaveAttribute(
      "target",
      "_blank",
    );
    expect(within(page).getByText("No reminders yet.")).toBeInTheDocument();
    fireEvent.click(within(page).getByTestId("assessments-overview-doctor-remind"));
    expect(await screen.findByText("Reminder to Dr Hana Ito about Dr Tom Fraser's mid-term")).toBeInTheDocument();
    expect(within(page).getByTestId("assessments-overview-doctor-remind")).toBeDisabled();
    expect(within(page).getByText("Reminded today. One reminder a day per form.")).toBeInTheDocument();
    expect(within(page).getByText("Dr Hana Ito reminded")).toBeInTheDocument();
  });

  it("says plainly when a doctor link is not in the list", () => {
    const p = props(initialAssessmentsState(), {
      params: new URLSearchParams("view=overview&as=supervisor&doctor=nobody"),
    });
    renderWith(<AssessmentsTermOverview {...p} />);
    expect(screen.getByText("That doctor isn't in this made-up list")).toBeInTheDocument();
  });

  it("exports only what is ticked, and refuses an empty export with a reason", () => {
    renderWith(<AssessmentsTermOverview {...props(initialAssessmentsState())} />);
    fireEvent.click(screen.getByRole("button", { name: "Export status" }));
    const sheet = screen.getByTestId("assessments-overview-export");
    expect(within(sheet).getByRole("checkbox", { name: /Reminder history/ })).not.toBeChecked();
    fireEvent.click(within(sheet).getByRole("checkbox", { name: /Mid-term and end-of-term/ }));
    const href = decodeURIComponent(within(sheet).getByTestId("assessments-overview-csv").getAttribute("href")!);
    expect(href).toContain('"Doctor","Grade","Unit","Supervisor","EPAs this term"');
    fireEvent.click(within(sheet).getByRole("checkbox", { name: /EPA counts/ }));
    expect(within(sheet).getByText("Choose the forms, the EPA counts or both.")).toBeInTheDocument();
    expect(within(sheet).queryByTestId("assessments-overview-csv")).toBeNull();
  });

  it("greys the bells offline and says the status is as of a time", () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    try {
      renderWith(<AssessmentsTermOverview {...props(initialAssessmentsState())} />);
      expect(screen.getByTestId("assessments-overview-offline")).toHaveTextContent(
        /Status as of \d\d:\d\d\. Reminders wait until you are back online\./,
      );
      const bell = screen.getByRole("button", { name: "Reminder unavailable offline: Dr Ravi Kaur" });
      expect(bell).toHaveAttribute("aria-disabled", "true");
      fireEvent.click(bell);
      expect(screen.queryByText(/Reminder to Dr Omar Ahmed/)).toBeNull();
    } finally {
      online.mockRestore();
    }
  });

  it("starts the Sent tab empty with an honest note", () => {
    renderWith(<AssessmentsTermOverview {...props(initialAssessmentsState())} />);
    fireEvent.click(screen.getByRole("radio", { name: "Sent" }));
    expect(screen.getByTestId("assessments-overview-sent-empty")).toHaveTextContent("No reminders yet");
  });
});
