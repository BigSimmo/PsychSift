/** @vitest-environment jsdom */

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AssessmentsExtrasProvider,
  AssessmentsSampleViewsNav,
  useAssessmentsExtras,
} from "@/components/teaching/assessments/assessments-extras";
import { AssessmentsInbox } from "@/components/teaching/assessments/assessments-inbox";
import { AssessmentsTermOverview } from "@/components/teaching/assessments/assessments-term-overview";
import type { ScreenProps } from "@/components/teaching/assessments/teaching-assessments";
import { ToastProvider, useToast } from "@/components/ui/toast";
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

  it("puts the sort with its label, above the lists it orders", () => {
    renderWith(<AssessmentsInbox {...props(windowOpen)} />);
    const sort = screen.getByTestId("assessments-inbox-sort");
    expect(within(sort).getByRole("radiogroup", { name: "Sort" })).toBeInTheDocument();
    const firstList = screen.getAllByRole("list")[0]!;
    expect(sort.compareDocumentPosition(firstList) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText(/first$/)).toBeNull();
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
    expect(screen.getByText(/^Sent \d\d:\d\d · Proximal, with a few lines$/)).toBeInTheDocument();
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
      fireEvent.click(await screen.findByRole("radio", { name: /Better from another consultant/ }));
      fireEvent.click(screen.getByTestId("assessments-inbox-cant-send"));
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

describe("consultant inbox, more behaviours", () => {
  it("gives every row a status rail and one tag", () => {
    renderWith(<AssessmentsInbox {...props(windowOpen)} />);
    const ben = screen.getByRole("button", { name: /Dr Ben Ortiz · Mid-term assessment/ }).closest("li")!;
    expect(ben).toHaveAttribute("data-rail", "overdue");
    expect(within(ben).getByText("Overdue")).toBeInTheDocument();
    const ella = screen.getByRole("button", { name: /Dr Ella Okafor · EPA 4/ }).closest("li")!;
    expect(ella).toHaveAttribute("data-rail", "long");
  });

  it("sorts by doctor with the segmented control", () => {
    renderWith(<AssessmentsInbox {...props(initialAssessmentsState())} />);
    fireEvent.click(screen.getByRole("radio", { name: "Doctor" }));
    const waiting = screen.getByRole("list", { name: "Waiting" });
    const names = within(waiting)
      .getAllByRole("button")
      .map((b) => b.textContent ?? "");
    expect(names[0]).toMatch(/^.*Dr Ben Ortiz/);
    expect(names.at(-1)).toMatch(/Dr Ravi Kaur/);
  });

  it("moves a request to Later from the sheet, with Undo", async () => {
    renderWith(<AssessmentsInbox {...props(initialAssessmentsState())} />);
    fireEvent.click(screen.getByRole("button", { name: /Dr Mia Chen · EPA 2/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Later" }));
    expect(await screen.findByText("Moved to Later · back Mon 08:00")).toBeInTheDocument();
    const later = screen.getByRole("list", { name: "Later" });
    expect(within(later).getByText("Later · Mon 08:00")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.queryByRole("list", { name: "Later" })).toBeNull();
  });

  it("passes a request on with a suggested colleague, showing what the doctor sees", async () => {
    renderWith(<AssessmentsInbox {...props(initialAssessmentsState())} />);
    fireEvent.click(screen.getByRole("button", { name: /Dr Ella Okafor · EPA 4/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Can't do this one" }));
    const sheet = await screen.findByTestId("assessments-inbox-cant");
    expect(within(sheet).getByRole("radio", { name: /I did not see this work/ })).toBeChecked();
    fireEvent.click(within(sheet).getByRole("button", { name: "Dr Hana Ito" }));
    expect(within(sheet).getByTestId("assessments-inbox-cant-preview")).toHaveTextContent(
      "Dr Ella Okafor seesNot able to assess this one, as I did not see this work. Try Dr Hana Ito.",
    );
    // Not this week takes no suggestion and becomes Move to Later.
    fireEvent.click(within(sheet).getByRole("radio", { name: /Not this week/ }));
    expect(within(sheet).queryByRole("group", { name: "Suggest someone" })).toBeNull();
    expect(within(sheet).getByTestId("assessments-inbox-cant-send")).toHaveTextContent("Move to Later");
    fireEvent.click(within(sheet).getByRole("radio", { name: /I did not see this work/ }));
    fireEvent.click(within(sheet).getByTestId("assessments-inbox-cant-send"));
    fireEvent.click(screen.getByRole("radio", { name: /Done · 1/ }));
    expect(screen.getByText("Not seen by you · suggested Dr Hana Ito")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Dr Ella Okafor · EPA 4/ }));
    const preview = await screen.findByTestId("assessments-inbox-doctor");
    expect(preview).toHaveTextContent("Your supervisor passed this on");
    fireEvent.click(within(preview).getByRole("button", { name: "Move back to my inbox" }));
    expect(screen.getByRole("radio", { name: /Waiting · 4/ })).toBeInTheDocument();
  });

  it("shows what the doctor sees once sent, and copies it for Clinical Learning Australia", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderWith(<AssessmentsInbox {...props(initialAssessmentsState())} />);
    fireEvent.click(screen.getByRole("button", { name: /Dr Ravi Kaur · EPA 3/ }));
    const sheet = await screen.findByTestId("assessments-inbox-feedback");
    fireEvent.click(within(sheet).getByRole("radio", { name: "Minimal" }));
    fireEvent.change(within(sheet).getByLabelText(/A few lines/), { target: { value: "Safe, tidy prescribing." } });
    expect(within(sheet).getByTestId("assessments-inbox-send")).toHaveTextContent("Send to Dr Ravi Kaur");
    fireEvent.click(within(sheet).getByTestId("assessments-inbox-send"));
    expect(screen.getByTestId("assessments-inbox-sending")).toHaveTextContent("Sending 1 answer");
    await act(async () => {
      vi.advanceTimersByTime(10_500);
    });
    fireEvent.click(screen.getByRole("radio", { name: /Done · 1/ }));
    fireEvent.click(screen.getByRole("button", { name: /Dr Ravi Kaur · EPA 3/ }));
    const view = await screen.findByTestId("assessments-inbox-doctor");
    expect(view).toHaveTextContent("Your supervisor answered");
    expect(view).toHaveTextContent("Minimal supervision");
    expect(view).toHaveTextContent("Safe, tidy prescribing.");
    fireEvent.click(within(view).getByTestId("assessments-inbox-copy-cla"));
    await act(async () => {});
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("Supervision needed: Minimal"));
    expect(within(view).getByTestId("assessments-inbox-copy-cla")).toHaveTextContent("Copied");
  });

  it("offers Edit and Remove it when a few lines hold patient details", async () => {
    renderWith(<AssessmentsInbox {...props(initialAssessmentsState())} />);
    fireEvent.click(screen.getByRole("button", { name: /Dr Mia Chen · EPA 2/ }));
    const sheet = await screen.findByTestId("assessments-inbox-feedback");
    const box = within(sheet).getByLabelText(/A few lines/);
    fireEvent.change(box, { target: { value: "Calm review of the man in bed 12 overnight, escalated early" } });
    const problem = within(sheet).getByTestId("assessments-inbox-problem");
    expect(problem).toHaveTextContent("This looks like a bed number");
    fireEvent.click(within(problem).getByRole("button", { name: "Edit" }));
    expect(box).toHaveFocus();
    fireEvent.click(within(problem).getByRole("button", { name: "Remove it" }));
    expect((box as HTMLTextAreaElement).value).not.toMatch(/bed 12/);
    expect(within(sheet).queryByTestId("assessments-inbox-problem")).toBeNull();
  });

  it("keeps an answer as To send while offline, and sends it with Undo when back online", async () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    renderWith(<AssessmentsInbox {...props(initialAssessmentsState())} />);
    expect(screen.getByTestId("assessments-inbox-offline")).toHaveTextContent("No connection");
    fireEvent.click(screen.getByRole("button", { name: /Dr Mia Chen · EPA 2/ }));
    const sheet = await screen.findByTestId("assessments-inbox-feedback");
    fireEvent.click(within(sheet).getByRole("radio", { name: "Direct" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Keep to send" }));
    const mia = screen.getByRole("button", { name: /Dr Mia Chen · EPA 2/ });
    expect(mia).toHaveTextContent("To send");
    online.mockReturnValue(true);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    expect(await screen.findByText("Back online · sending 1 answer in 10 s")).toBeInTheDocument();
    expect(screen.queryByTestId("assessments-inbox-offline")).toBeNull();
    online.mockRestore();
  });

  it("brings a reminder sent from the term overview into the inbox banner", async () => {
    render(
      <ToastProvider>
        <AssessmentsExtrasProvider>
          <AssessmentsTermOverview {...props(initialAssessmentsState())} />
          <AssessmentsInbox {...props(initialAssessmentsState())} />
        </AssessmentsExtrasProvider>
      </ToastProvider>,
    );
    expect(screen.queryByTestId("assessments-inbox-dct")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remind Dr Priya Nair about Dr Ben Ortiz's mid-term" }));
    const banner = await screen.findByTestId("assessments-inbox-dct");
    expect(banner).toHaveTextContent(/Reminder from the DCTDr Ben Ortiz · mid-term · \d\d:\d\d/);
    fireEvent.click(within(banner).getByRole("button", { name: "Open" }));
    expect(await screen.findByTestId("assessments-inbox-status")).toBeInTheDocument();
  });

  it("says Nothing waiting with a way to see what was done", async () => {
    renderWith(<AssessmentsInbox {...props(initialAssessmentsState())} />);
    for (const name of [/Dr Mia Chen/, /Dr Ella Okafor/, /Dr Ravi Kaur/, /Dr Ben Ortiz/]) {
      fireEvent.click(screen.getByRole("button", { name }));
      fireEvent.click(await screen.findByRole("button", { name: "Can't do this one" }));
      fireEvent.click(screen.getByTestId("assessments-inbox-cant-send"));
    }
    const empty = screen.getByTestId("assessments-inbox-empty");
    expect(empty).toHaveTextContent("Nothing waiting");
    fireEvent.click(within(empty).getByRole("button", { name: "See done" }));
    expect(screen.getByRole("radio", { name: /Done · 4/ })).toBeChecked();
    expect(screen.getAllByText("Passed on")).toHaveLength(4);
  });
});

/** Answers Dr Mia Chen's EPA with a level and presses Send. */
async function sendMia() {
  fireEvent.click(screen.getByRole("button", { name: /Dr Mia Chen · EPA 2/ }));
  const sheet = await screen.findByTestId("assessments-inbox-feedback");
  fireEvent.click(within(sheet).getByRole("radio", { name: "Proximal" }));
  fireEvent.click(within(sheet).getByTestId("assessments-inbox-send"));
  return (await screen.findAllByTestId("toast")).at(-1)!;
}

function PushOthers({ count }: { count: number }) {
  const toast = useToast();
  return (
    <button
      type="button"
      onClick={() => Array.from({ length: count }, (_, i) => toast.push({ tone: "info", title: `Other ${i}` }))}
    >
      Push others
    </button>
  );
}

describe("consultant inbox, the 10-second Undo", () => {
  it("waits while the Undo message is touched, then sends when its own time is up", async () => {
    renderWith(<AssessmentsInbox {...props(windowOpen)} />);
    const toast = await sendMia();
    fireEvent.pointerEnter(toast);
    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    // Still undoable: nothing was sent while the doctor was reaching for Undo.
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
    expect(screen.getByTestId("assessments-inbox-sending")).toHaveTextContent("Sending 1 answer");
    // No drain bar that would claim the time is up while Undo still works.
    expect(screen.getByTestId("assessments-inbox-sending").querySelector("i")).toBeNull();
    fireEvent.pointerLeave(toast);
    await act(async () => {
      vi.advanceTimersByTime(10_500);
    });
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /Done · 1/ }));
    expect(screen.getByText(/^Sent \d\d:\d\d · Proximal$/)).toBeInTheDocument();
  });

  it("keeps a send pushed off the message stack: it goes at its own time, with Undo on the inbox meanwhile", async () => {
    renderWith(
      <>
        <PushOthers count={5} />
        <AssessmentsInbox {...props(windowOpen)} />
      </>,
    );
    await sendMia();
    fireEvent.click(screen.getByRole("button", { name: "Push others" }));
    // The message is gone, but the answer is still only sending, and Undo is still in reach.
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    expect(screen.getByTestId("assessments-inbox-sending")).toHaveTextContent("Sending 1 answer");
    fireEvent.click(screen.getByTestId("assessments-inbox-undo-sending"));
    expect(screen.queryByTestId("assessments-inbox-sending")).toBeNull();
    expect(screen.getByRole("button", { name: /Dr Mia Chen · EPA 2/ })).toBeInTheDocument();
    // Sent again and pushed off again: it goes when its own 10 seconds end, once.
    await sendMia();
    fireEvent.click(screen.getByRole("button", { name: "Push others" }));
    await act(async () => {
      vi.advanceTimersByTime(9_000);
    });
    expect(screen.getByTestId("assessments-inbox-sending")).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(1_500);
    });
    expect(screen.queryByTestId("assessments-inbox-sending")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /Done · 1/ }));
    expect(screen.getByText(/^Sent \d\d:\d\d · Proximal$/)).toBeInTheDocument();
  });

  it("closes the Undo when Assessments closes, so it never claims to keep an answer on a page that is gone", async () => {
    const view = render(
      <ToastProvider>
        <AssessmentsExtrasProvider>
          <AssessmentsInbox {...props(windowOpen)} />
        </AssessmentsExtrasProvider>
      </ToastProvider>,
    );
    await sendMia();
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
    view.rerender(
      <ToastProvider>
        <p>Another page</p>
      </ToastProvider>,
    );
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    expect(screen.queryByTestId("toast")).toBeNull();
  });

  it("sends a To send answer when the connection comes back on another assessments screen", async () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    function Switcher() {
      const [inbox, setInbox] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setInbox(false)}>
            Leave the inbox
          </button>
          {inbox ? (
            <AssessmentsInbox {...props(initialAssessmentsState())} />
          ) : (
            <AssessmentsTermOverview {...props(initialAssessmentsState())} />
          )}
        </>
      );
    }
    renderWith(<Switcher />);
    fireEvent.click(screen.getByRole("button", { name: /Dr Mia Chen · EPA 2/ }));
    const sheet = await screen.findByTestId("assessments-inbox-feedback");
    fireEvent.click(within(sheet).getByRole("radio", { name: "Direct" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Keep to send" }));
    fireEvent.click(screen.getByRole("button", { name: "Leave the inbox" }));
    expect(screen.queryByTestId("assessments-inbox")).toBeNull();
    online.mockReturnValue(true);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    expect(await screen.findByText("Back online · sending 1 answer in 10 s")).toBeInTheDocument();
    online.mockRestore();
  });
});

const QUICK = ["q1", "q2", "q3", "q4", "q5", "q6", "q7"];

/** Sends made straight through the provider, as fast as a test can tap, with each answer's status in view. */
function QuickSends() {
  const { extras, sendAnswers } = useAssessmentsExtras();
  return (
    <>
      {QUICK.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => sendAnswers([{ id, level: "proximal", text: "Ok" }], `Sending ${id} in 10 s`)}
        >
          {`Send ${id}`}
        </button>
      ))}
      <output data-testid="quick-statuses">
        {QUICK.map((id) => `${id}:${extras.answers[id]?.status ?? "waiting"}`).join(" ")}
      </output>
    </>
  );
}

function quickStatuses(): Record<string, string> {
  return Object.fromEntries(
    screen
      .getByTestId("quick-statuses")
      .textContent!.split(" ")
      .map((pair) => pair.split(":") as [string, string]),
  );
}

describe("pretend sends never lost, rushed or repeated", () => {
  for (const count of [6, 7]) {
    it(`sends all ${count} of ${count} quick sends when their time is up, none stuck`, async () => {
      renderWith(<QuickSends />);
      for (const id of QUICK.slice(0, count)) fireEvent.click(screen.getByRole("button", { name: `Send ${id}` }));
      const sending = Object.values(quickStatuses()).filter((status) => status === "sending");
      expect(sending).toHaveLength(count);
      await act(async () => {
        vi.advanceTimersByTime(10_500);
      });
      const after = quickStatuses();
      for (const id of QUICK.slice(0, count)) expect(after[id], id).toBe("sent");
      // Every message closed with its send: nothing left showing an Undo that does nothing.
      expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    });
  }

  it("sends each answer once: a second tap or a second reconnect adds no second Undo", () => {
    renderWith(<QuickSends />);
    fireEvent.click(screen.getByRole("button", { name: "Send q1" }));
    fireEvent.click(screen.getByRole("button", { name: "Send q1" }));
    expect(screen.getAllByRole("button", { name: "Undo" })).toHaveLength(1);
  });

  it("does not send at once a message held past 10 seconds and then pushed off", async () => {
    renderWith(
      <>
        <PushOthers count={5} />
        <QuickSends />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Send q1" }));
    const undo = screen.getByRole("button", { name: "Undo" });
    fireEvent.focusIn(undo);
    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    expect(quickStatuses().q1).toBe("sending");
    fireEvent.click(screen.getByRole("button", { name: "Push others" }));
    await act(async () => {
      vi.advanceTimersByTime(10);
    });
    // Pushed off while held: still sending, not sent at once.
    expect(quickStatuses().q1).toBe("sending");
    await act(async () => {
      vi.advanceTimersByTime(9_000);
    });
    expect(quickStatuses().q1).toBe("sending");
    await act(async () => {
      vi.advanceTimersByTime(1_500);
    });
    expect(quickStatuses().q1).toBe("sent");
  });

  it("closes Later and Remind Undo messages on leaving Assessments, so neither speaks about a page that is gone", async () => {
    const view = render(
      <ToastProvider>
        <AssessmentsExtrasProvider>
          <AssessmentsTermOverview {...props(initialAssessmentsState())} />
        </AssessmentsExtrasProvider>
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remind Dr Omar Ahmed about Dr Ravi Kaur's mid-term" }));
    expect(await screen.findByRole("button", { name: "Undo" })).toBeInTheDocument();
    view.rerender(
      <ToastProvider>
        <p>Another page</p>
      </ToastProvider>,
    );
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("sends a To send answer when the page comes back into view online, in case the online event was missed", async () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    try {
      renderWith(<AssessmentsInbox {...props(initialAssessmentsState())} />);
      fireEvent.click(screen.getByRole("button", { name: /Dr Mia Chen · EPA 2/ }));
      const sheet = await screen.findByTestId("assessments-inbox-feedback");
      fireEvent.click(within(sheet).getByRole("radio", { name: "Direct" }));
      fireEvent.click(within(sheet).getByRole("button", { name: "Keep to send" }));
      online.mockReturnValue(true);
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(await screen.findByText("Back online · sending 1 answer in 10 s")).toBeInTheDocument();
    } finally {
      online.mockRestore();
    }
  });

  it("leaves an answer whose sheet is open out of the reconnect, and saves the words exactly as typed", async () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    try {
      renderWith(<AssessmentsInbox {...props(initialAssessmentsState())} />);
      fireEvent.click(screen.getByRole("button", { name: /Dr Mia Chen · EPA 2/ }));
      let sheet = await screen.findByTestId("assessments-inbox-feedback");
      fireEvent.click(within(sheet).getByRole("radio", { name: "Direct" }));
      fireEvent.click(within(sheet).getByRole("button", { name: "Keep to send" }));
      // Reopen the queued answer and edit it; the connection comes back while the sheet is open.
      fireEvent.click(screen.getByRole("button", { name: /Dr Mia Chen · EPA 2/ }));
      sheet = await screen.findByTestId("assessments-inbox-feedback");
      fireEvent.change(within(sheet).getByLabelText(/A few lines/), { target: { value: "Halve to ½ tab, x² ﬁne…" } });
      online.mockReturnValue(true);
      await act(async () => {
        window.dispatchEvent(new Event("online"));
      });
      expect(screen.queryByText(/Back online · sending/)).toBeNull();
      fireEvent.click(within(sheet).getByTestId("assessments-inbox-send"));
      await act(async () => {
        vi.advanceTimersByTime(10_500);
      });
      fireEvent.click(screen.getByRole("radio", { name: /Done · 1/ }));
      fireEvent.click(screen.getByRole("button", { name: /Dr Mia Chen/ }));
      expect(await screen.findByText("Halve to ½ tab, x² ﬁne…")).toBeInTheDocument();
    } finally {
      online.mockRestore();
    }
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

  it("labels the bell column and says how the chips count differently from the mid-term totals", () => {
    renderWith(<AssessmentsTermOverview {...props(initialAssessmentsState())} />);
    expect(screen.getByText("Remind")).toBeInTheDocument();
    expect(screen.getByText("Mid-term assessments only")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Filter doctors" })).toHaveAccessibleDescription(
      "Doctors, counted by their most urgent form of any kind",
    );
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

  it("lets a doctor's name wrap rather than cut off, with the initials giving way on a 320 px phone", () => {
    renderWith(<AssessmentsTermOverview {...props(initialAssessmentsState())} />);
    const ravi = screen.getByTestId("assessments-overview-ravi");
    const name = within(ravi).getByTestId("assessments-overview-name");
    expect(name.className).toContain("break-words");
    expect(ravi.querySelector(".truncate")).toBeNull();
    expect(ravi.querySelector('[aria-hidden="true"].max-\\[359px\\]\\:hidden')).not.toBeNull();
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
        /Status as of \d\d:\d\d\. Reminders can't be sent while offline\. Try again when you are back online\./,
      );
      expect(screen.getByTestId("assessments-overview-offline")).not.toHaveTextContent(/wait/);
      const bell = screen.getByRole("button", { name: "Reminder unavailable offline: Dr Ravi Kaur" });
      expect(bell).toHaveAttribute("aria-disabled", "true");
      fireEvent.click(bell);
      expect(screen.queryByText(/Reminder to Dr Omar Ahmed/)).toBeNull();
    } finally {
      online.mockRestore();
    }
  });

  it("gives the Supervisors tab's Remind its reason when it cannot open", () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    try {
      renderWith(<AssessmentsTermOverview {...props(initialAssessmentsState())} />);
      fireEvent.click(screen.getByRole("radio", { name: "Supervisors" }));
      const remind = screen.getByTestId("assessments-overview-bulk-open");
      expect(remind).toHaveAttribute("aria-disabled", "true");
      expect(remind).toHaveAccessibleDescription("Can't send while offline. Try again when you are back online.");
      fireEvent.click(remind);
      expect(screen.queryByTestId("assessments-overview-bulk")).toBeNull();
    } finally {
      online.mockRestore();
    }
  });

  it("says why Remind is unavailable once every supervisor was reminded today", async () => {
    renderWith(<AssessmentsTermOverview {...props(initialAssessmentsState())} />);
    fireEvent.click(screen.getByRole("radio", { name: "Supervisors" }));
    fireEvent.click(screen.getByTestId("assessments-overview-bulk-open"));
    fireEvent.click(await screen.findByTestId("assessments-overview-bulk-send"));
    const remind = screen.getByTestId("assessments-overview-bulk-open");
    expect(remind).toHaveAttribute("aria-disabled", "true");
    expect(remind).toHaveAccessibleDescription("Everyone with a due or overdue form was reminded today.");
  });

  it("starts the download from the tap before the export sheet closes", async () => {
    renderWith(<AssessmentsTermOverview {...props(initialAssessmentsState())} />);
    fireEvent.click(screen.getByRole("button", { name: "Export status" }));
    const link = screen.getByTestId("assessments-overview-csv");
    expect(decodeURIComponent(link.getAttribute("href")!)).toMatch(/^data:text\/csv;charset=utf-8,\uFEFF"Made-up/);
    fireEvent.click(link);
    expect(link).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(10);
    });
    expect(screen.queryByTestId("assessments-overview-export")).toBeNull();
  });

  it("starts the Sent tab empty with an honest note", () => {
    renderWith(<AssessmentsTermOverview {...props(initialAssessmentsState())} />);
    fireEvent.click(screen.getByRole("radio", { name: "Sent" }));
    expect(screen.getByTestId("assessments-overview-sent-empty")).toHaveTextContent("No reminders yet");
  });
});
