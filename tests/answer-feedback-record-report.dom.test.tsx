import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => ({
  useOptionalAuthSession: () => ({ authorizationHeader: { Authorization: "Bearer synthetic" } }),
}));

import { AnswerUtilityActions } from "@/components/clinical-dashboard/evidence-panels";
import { RecordReportProblem } from "@/components/clinical-dashboard/record-report-problem";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("report a problem: optional note", () => {
  it("passes the trimmed note with the category from the answer surface", async () => {
    const user = userEvent.setup();
    const onSubmitFeedback = vi.fn();
    render(<AnswerUtilityActions copied={false} onCopy={() => undefined} onSubmitFeedback={onSubmitFeedback} />);
    await user.click(screen.getByTestId("answer-feedback-trigger"));
    const sheet = await screen.findByTestId("answer-feedback-sheet");
    const note = within(sheet).getByTestId("answer-feedback-note");
    expect(note).toHaveAttribute("maxlength", "500");
    await user.type(note, "  The cited table says 250 mg.  ");
    await user.click(within(sheet).getByRole("button", { name: /Numeric error/ }));
    expect(onSubmitFeedback).toHaveBeenCalledWith("numeric_error", "The cited table says 250 mg.");
  });

  it("sends a medication record report and shows the server's refusal message", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "This note looks like it holds a patient detail (a name)." }), {
          status: 400,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<RecordReportProblem recordType="medication" recordId="lithium" />);
    await user.click(screen.getByTestId("medication-report-problem-trigger"));
    const sheet = await screen.findByTestId("medication-report-problem-sheet");
    await user.type(within(sheet).getByTestId("answer-feedback-note"), "Synthetic note");
    await user.click(within(sheet).getByRole("button", { name: /Outdated guidance/ }));
    await waitFor(() =>
      expect(screen.getByTestId("medication-report-problem-notice")).toHaveTextContent(
        /looks like it holds a patient detail/,
      ),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/answer-feedback");
    expect(JSON.parse(String(init.body))).toEqual({
      recordType: "medication",
      recordId: "lithium",
      feedbackCategory: "outdated_guidance",
      note: "Synthetic note",
    });
  });
});
