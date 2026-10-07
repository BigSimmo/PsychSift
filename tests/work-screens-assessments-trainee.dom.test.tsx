/** @vitest-environment jsdom */

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AssessmentsTraineePage } from "@/components/work-screens/assessments/assessments-trainee-page";
import { ToastProvider } from "@/components/ui/toast";
import { EXAMPLE_ASSESSMENTS_SUPERVISION } from "@/lib/example-data/datasets/assessments-supervision";
import { initialAssessmentsState } from "@/lib/teaching/assessments/model";
import { exportDoctors } from "@/lib/work-screens/assessments/export";

/** Names come from the shared example list, so read them rather than pinning them. */
const doctorName = (id: string) => exportDoctors(initialAssessmentsState()).find((d) => d.id === id)?.name ?? "missing";
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  vi.useRealTimers();
  setOnline(true);
});

/** The browser's connection hint, and the event the page listens for. */
function setOnline(on: boolean) {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => on });
  act(() => {
    window.dispatchEvent(new Event(on ? "online" : "offline"));
  });
}

function renderPage(id: string) {
  return render(
    <ToastProvider>
      <AssessmentsTraineePage doctorId={id} supervision={EXAMPLE_ASSESSMENTS_SUPERVISION} />
    </ToastProvider>,
  );
}

describe("supervisor's view of a trainee", () => {
  it("answers an EPA request, blocks patient details, and sends with Undo", async () => {
    renderPage("mia");
    // The frame's example data banner labels the records, so the page carries no banner of its own.
    expect(screen.queryByTestId("work-screens-assessments-sample")).toBeNull();
    fireEvent.click(screen.getByTestId("assessments-trainee-request-mia-epa-2"));
    const sheet = await screen.findByTestId("assessments-trainee-answer-sheet");
    const send = within(sheet).getByTestId("assessments-trainee-answer-send");
    expect(send).toBeDisabled();
    fireEvent.click(within(sheet).getByRole("radio", { name: "Proximal" }));
    fireEvent.change(within(sheet).getByTestId("assessments-trainee-answer-text"), {
      target: { value: "Calm review of bed 12 overnight" },
    });
    expect(within(sheet).getByTestId("assessments-trainee-patient-detail")).toBeInTheDocument();
    expect(send).toBeDisabled();
    fireEvent.change(within(sheet).getByTestId("assessments-trainee-answer-text"), {
      target: { value: "Calm, clear escalation." },
    });
    expect(within(sheet).queryByTestId("assessments-trainee-patient-detail")).toBeNull();
    fireEvent.click(send);
    expect(await screen.findByText(new RegExp(`Sending to ${escape(doctorName("mia"))} in 10`))).toBeInTheDocument();
    expect(screen.queryByTestId("assessments-trainee-request-mia-epa-2")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByTestId("assessments-trainee-request-mia-epa-2")).toBeInTheDocument();
  });

  it("confirms supervision after 10 seconds unless undone", async () => {
    renderPage("sam");
    fireEvent.click(screen.getByTestId("assessments-trainee-confirm-example:sam-s3"));
    expect(await screen.findByText(/Confirming Mon 5 Oct in 10/)).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(10_500);
    });
    expect(screen.getByTestId("assessments-trainee-no-sessions")).toBeInTheDocument();
    expect(within(screen.getByTestId("assessments-trainee-recent")).getAllByText("Confirmed")).toHaveLength(3);
  });

  it("asks for a correction only once a field is chosen", async () => {
    renderPage("sam");
    fireEvent.click(screen.getByTestId("assessments-trainee-ask-example:sam-s3"));
    const sheet = await screen.findByTestId("assessments-trainee-ask-sheet");
    const send = within(sheet).getByTestId("assessments-trainee-ask-send");
    expect(send).toBeDisabled();
    fireEvent.click(within(sheet).getByTestId("assessments-trainee-ask-field-length"));
    expect(send).not.toBeDisabled();
    fireEvent.click(send);
    expect(await screen.findByText(new RegExp(`Correction asked of ${escape(doctorName("sam"))}`))).toBeInTheDocument();
    expect(screen.getByText(/Correction asked · Length/)).toBeInTheDocument();
  });

  it("reviews a proposed correction and keeps the original", async () => {
    renderPage("ben");
    fireEvent.click(screen.getByTestId("assessments-trainee-correction-open"));
    const sheet = await screen.findByTestId("assessments-trainee-correction-sheet");
    expect(within(sheet).getByText("The original record is kept beside the correction.")).toBeInTheDocument();
    fireEvent.click(within(sheet).getByTestId("assessments-trainee-correction-confirm"));
    expect(await screen.findByText(/Correction confirmed/)).toBeInTheDocument();
    expect(within(screen.getByTestId("assessments-trainee-correction")).getByText("Confirmed")).toBeInTheDocument();
  });

  it("shows status only for another consultant's doctor, and a way back for an unknown link", () => {
    const { unmount } = renderPage("ravi");
    expect(screen.getByTestId("assessments-trainee-not-yours")).toBeInTheDocument();
    expect(screen.queryByTestId("assessments-trainee-sessions")).toBeNull();
    unmount();
    renderPage("nobody");
    expect(screen.getByRole("link", { name: "Open the inbox" })).toHaveAttribute(
      "href",
      "/teaching/assessments?view=inbox&as=supervisor",
    );
  });

  it("says plainly when Undo comes after the send has gone", async () => {
    renderPage("sam");
    fireEvent.click(screen.getByTestId("assessments-trainee-confirm-example:sam-s3"));
    await screen.findByText(/Confirming Mon 5 Oct in 10/);
    const undo = screen.getByRole("button", { name: "Undo" });
    // Focus on the toast pauses it, so it can outlive the 10 seconds.
    fireEvent.focus(undo);
    await act(async () => {
      vi.advanceTimersByTime(10_500);
    });
    expect(screen.getByTestId("assessments-trainee-no-sessions")).toBeInTheDocument();
    fireEvent.click(undo);
    expect(await screen.findByText("Already sent, so it can't be undone here.")).toBeInTheDocument();
    expect(screen.getByTestId("assessments-trainee-no-sessions")).toBeInTheDocument();
  });

  it("keeps a confirmation as To send offline, then gives it 10 seconds and Undo once back online", async () => {
    renderPage("sam");
    setOnline(false);
    expect(screen.getByTestId("assessments-trainee-offline")).toHaveTextContent(/Corrections need a connection/);
    fireEvent.click(screen.getByTestId("assessments-trainee-confirm-example:sam-s3"));
    expect(await screen.findByText("Kept to confirm when you are back online")).toBeInTheDocument();
    expect(within(screen.getByTestId("assessments-trainee-sessions")).getByText("To send")).toBeInTheDocument();
    setOnline(true);
    expect(await screen.findByText(/Back online. Sending what you kept in 10/)).toBeInTheDocument();
    expect(within(screen.getByTestId("assessments-trainee-sessions")).getByText("Sending")).toBeInTheDocument();
    const undos = screen.getAllByRole("button", { name: "Undo" });
    fireEvent.click(undos[undos.length - 1]!);
    expect(screen.getByTestId("assessments-trainee-confirm-example:sam-s3")).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(10_500);
    });
    // Undone, so the 10 seconds passing confirms nothing.
    expect(screen.getByTestId("assessments-trainee-confirm-example:sam-s3")).toBeInTheDocument();
  });

  it("does not ask for a correction or confirm one while offline", async () => {
    renderPage("ben");
    setOnline(false);
    fireEvent.click(screen.getByTestId("assessments-trainee-correction-open"));
    const sheet = await screen.findByTestId("assessments-trainee-correction-sheet");
    expect(within(sheet).getByTestId("assessments-trainee-correction-confirm")).toBeDisabled();
    expect(within(sheet).getByTestId("assessments-trainee-correction-offline")).toBeInTheDocument();
  });

  it("blocks Ask while offline, with the reason", async () => {
    renderPage("mia");
    setOnline(false);
    fireEvent.click(screen.getByTestId("assessments-trainee-ask-example:mia-s1"));
    const sheet = await screen.findByTestId("assessments-trainee-ask-sheet");
    fireEvent.click(within(sheet).getByTestId("assessments-trainee-ask-field-length"));
    expect(within(sheet).getByTestId("assessments-trainee-ask-send")).toBeDisabled();
    expect(within(sheet).getByTestId("assessments-trainee-ask-blocker")).toHaveTextContent(/offline/);
  });

  it("confirms a correction that was left for later", async () => {
    renderPage("ben");
    fireEvent.click(screen.getByTestId("assessments-trainee-correction-open"));
    fireEvent.click(
      within(await screen.findByTestId("assessments-trainee-correction-sheet")).getByTestId(
        "assessments-trainee-correction-later",
      ),
    );
    expect(await screen.findByText("Left for later")).toBeInTheDocument();
    expect(within(screen.getByTestId("assessments-trainee-correction")).getByText("Later")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("assessments-trainee-correction-open"));
    fireEvent.click(
      within(await screen.findByTestId("assessments-trainee-correction-sheet")).getByTestId(
        "assessments-trainee-correction-confirm",
      ),
    );
    expect(await screen.findByText(/Correction confirmed/)).toBeInTheDocument();
    expect(within(screen.getByTestId("assessments-trainee-correction")).getByText("Confirmed")).toBeInTheDocument();
  });

  it("lets you answer what another consultant's doctor asked of you, and nothing more", () => {
    renderPage("ravi");
    expect(screen.getByTestId("assessments-trainee-not-yours")).toHaveTextContent(/anything they asked of you/);
    expect(screen.getByTestId("assessments-trainee-request-ravi-epa-3")).toBeInTheDocument();
    expect(screen.queryByTestId("assessments-trainee-sessions")).toBeNull();
    expect(screen.queryByTestId("assessments-trainee-correction")).toBeNull();
    // Every link keeps the supervisor's view.
    for (const link of screen.getAllByRole("link")) expect(link.getAttribute("href")).toMatch(/as=supervisor/);
  });
});
