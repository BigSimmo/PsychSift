import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AnswerNotInSources, notInSourcesSearchedLine } from "@/components/clinical-dashboard/answer-not-in-sources";
import { AnswerUtilityActions } from "@/components/clinical-dashboard/evidence-panels";

/**
 * The "Not in your sources" state (audit D03, 2026-10-13).
 *
 * A refusal used to wear a real answer's chrome. These pin the plain layout: the heading,
 * the pipeline's own sentence, one line on what was searched, no source cards, and an
 * action row with only "Report a problem" (no Copy, no Log as CPD, no thumbs up).
 */
describe("AnswerNotInSources", () => {
  it("shows a plain heading, the pipeline's own sentence and the searched line, with no source list", () => {
    render(
      <AnswerNotInSources
        text="The indexed sources do not cover this question."
        query="example question"
        preformatted={false}
        searchedCount={3}
      />,
    );
    expect(screen.getByRole("heading", { name: "Your sources don't cover this" })).toBeInTheDocument();
    expect(screen.getByText("The indexed sources do not cover this question.")).toBeInTheDocument();
    expect(screen.getByTestId("answer-not-in-sources-searched")).toHaveTextContent(
      "Checked 3 sources in your library. None of them answers this question.",
    );
    expect(screen.queryByText("Documents searched")).not.toBeInTheDocument();
    expect(screen.queryByText("Cited documents")).not.toBeInTheDocument();
  });

  it("words the searched line for zero and one source", () => {
    expect(notInSourcesSearchedLine(0)).toBe("Nothing in your library matched this question.");
    expect(notInSourcesSearchedLine(1)).toBe("Checked 1 source in your library. None of them answers this question.");
  });
});

describe("AnswerUtilityActions · reportOnly", () => {
  it("keeps only Report a problem", () => {
    render(
      <AnswerUtilityActions
        reportOnly
        copied={false}
        onCopy={() => undefined}
        cpdHref="/cme/new?source=x"
        pendingFeedback={null}
        onSubmitFeedback={() => undefined}
      />,
    );
    expect(screen.getByTestId("answer-feedback-trigger")).toHaveAccessibleName("Report a problem with this answer");
    expect(screen.queryByRole("button", { name: "Copy answer with source status" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("answer-log-cpd")).not.toBeInTheDocument();
    expect(screen.queryByTestId("answer-feedback-useful")).not.toBeInTheDocument();
  });
});
