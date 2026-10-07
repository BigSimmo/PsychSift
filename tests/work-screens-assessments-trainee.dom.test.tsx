/** @vitest-environment jsdom */

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AssessmentsTraineePage } from "@/components/work-screens/assessments/assessments-trainee-page";
import { ToastProvider } from "@/components/ui/toast";

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

function renderPage(id: string) {
  return render(
    <ToastProvider>
      <AssessmentsTraineePage doctorId={id} />
    </ToastProvider>,
  );
}

describe("supervisor's view of a trainee", () => {
  it("answers an EPA request, blocks patient details, and sends with Undo", async () => {
    renderPage("mia");
    expect(screen.getByTestId("work-screens-assessments-sample")).toHaveTextContent(/Made-up/);
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
    expect(await screen.findByText(/Sending to Dr Mia Chen in 10/)).toBeInTheDocument();
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
    expect(await screen.findByText(/Correction asked of Dr Sam Lee/)).toBeInTheDocument();
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
});
