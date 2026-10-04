import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AnswerProgress } from "@/components/clinical-dashboard/answer-status";
import type { TimedAnswerProgressUpdate } from "@/components/clinical-dashboard/answer-progress";
import type { PublicAnswerProgressStage } from "@/lib/answer-progress-public";

function renderAt(stage: PublicAnswerProgressStage, question: string | null = "lithium level timing") {
  const events: TimedAnswerProgressUpdate[] = [{ stage, message: "Working.", receivedAt: 0 }];
  return render(<AnswerProgress events={events} startedAt={0} active onStop={() => {}} question={question} />);
}

function stepStates() {
  const list = screen.getByRole("list", { name: "Search steps" });
  return within(list)
    .getAllByRole("listitem")
    .map((item) => item.getAttribute("data-step-state"));
}

describe("answer wait steps", () => {
  it("ticks only the steps the stream has moved past", () => {
    renderAt("ranking");
    expect(stepStates()).toEqual(["done", "done", "current", "upcoming", "upcoming"]);
    expect(screen.getByText("Step 3 of 5")).toBeTruthy();
  });

  it("keeps the step count out of the live status line", () => {
    renderAt("generating");
    const line = screen.getByTestId("answer-progress-line");
    expect(line.textContent).toContain("Writing the answer");
    expect(line.textContent).not.toMatch(/\d/);
  });

  it("pins the question being answered and keeps one Stop control", () => {
    renderAt("retrieving");
    expect(screen.getByTestId("answer-progress-question").textContent).toBe("lithium level timing");
    expect(screen.getAllByRole("button", { name: "Stop generating answer" })).toHaveLength(1);
  });

  it("still offers Stop when no question is known", () => {
    renderAt("scoping", null);
    expect(screen.queryByTestId("answer-progress-question")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Stop generating answer" })).toHaveLength(1);
  });

  it("holds empty source slots until real sources arrive", () => {
    const { container } = renderAt("ranking");
    expect(screen.getByText("None chosen yet")).toBeTruthy();
    expect(container.querySelector('[data-slot="answer-progress-source-slots"]')).not.toBeNull();
    expect(screen.queryByTestId("answer-evidence-preview")).toBeNull();
  });
});
