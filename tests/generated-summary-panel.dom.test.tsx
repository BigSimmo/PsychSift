import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it } from "vitest";

import { GeneratedSummaryPanel } from "@/components/document-viewer/generated-summary-panel";
import type { AnswerPayload } from "@/components/clinical-dashboard/search-utils";
import { sanitizeUnsupportedSummaryAnswer, UNSUPPORTED_SUMMARY_TEXT } from "@/lib/rag/rag-document-summary-context";
import type { RagAnswer } from "@/lib/types";

// Audit NEW-G-01 (24 Oct 2026): the Summarise panel showed a summary the model itself marked as
// unsupported, with a wrong lithium range, as a clean "Clinical summary". Synthetic text only.
const wrongRange = "Check lithium levels every 2 weeks and keep the level at 1.0-1.2 mmol/L.";

function renderPanel(summary: Partial<AnswerPayload>) {
  const payload = { citations: [], sources: [], ...summary } as unknown as AnswerPayload;
  render(
    <GeneratedSummaryPanel
      loadingSummary={false}
      summary={payload}
      summaryError={null}
      summaryProgressStartedAt={null}
      summaryProgressEvents={[]}
      stopSummary={() => undefined}
      generatedSummaryRef={createRef<HTMLElement>()}
      generatedAnswerIsSummary
      generatedSummaryText={payload.answer}
    />,
  );
}

describe("Summarise panel safety signals (NEW-G-01)", () => {
  it("replaces an unsupported summary's text on the server and keeps system notes only", () => {
    const answer = sanitizeUnsupportedSummaryAnswer({
      answer: wrongRange,
      grounded: false,
      confidence: "medium",
      citations: [],
      sources: [],
      answerSections: [{ heading: "Monitoring", body: wrongRange }],
      conflictsOrGaps: [
        { type: "gap", message: "Model note about a range.", origin: "model" },
        { type: "gap", message: "Check the source for the current range." },
      ],
    } as unknown as RagAnswer);
    expect(answer.answer).toBe(UNSUPPORTED_SUMMARY_TEXT);
    expect(answer.confidence).toBe("unsupported");
    expect(answer.answerSections).toEqual([]);
    expect(answer.conflictsOrGaps).toEqual([{ type: "gap", message: "Check the source for the current range." }]);
  });

  it("leaves a grounded, supported summary alone", () => {
    const answer = sanitizeUnsupportedSummaryAnswer({
      answer: "Check lithium levels 5 to 7 days after a dose change.",
      grounded: true,
      confidence: "high",
      citations: [],
      sources: [],
    } as unknown as RagAnswer);
    expect(answer.answer).toBe("Check lithium levels 5 to 7 days after a dose change.");
  });

  it("shows the answer view's caution when the summary is unsupported", () => {
    renderPanel({ answer: UNSUPPORTED_SUMMARY_TEXT, grounded: false, confidence: "unsupported" });
    expect(screen.getByTestId("verification-notice")).toHaveAttribute("data-state", "ungrounded");
  });

  it("shows the caution when a summary's figures could not be matched to the source", () => {
    renderPanel({ answer: wrongRange, grounded: true, confidence: "high", unverifiedNumericTokens: ["1.0-1.2"] });
    expect(screen.getByTestId("verification-notice")).toHaveAttribute("data-state", "ungrounded");
  });

  it("shows no caution on a checked summary", () => {
    renderPanel({
      answer: "Check lithium levels 5 to 7 days after a dose change.",
      grounded: true,
      confidence: "high",
    });
    expect(screen.queryByTestId("verification-notice")).not.toBeInTheDocument();
  });
});
