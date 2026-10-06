import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CmeLogMonthChart } from "@/components/cme/cme-log-month-chart";
import { CmePlanGoalSplit } from "@/components/cme/cme-plan-goal-split";

afterEach(cleanup);

describe("CPD chart scaling", () => {
  it("shows a later month's recorded hours instead of an empty placeholder", () => {
    render(
      <CmeLogMonthChart
        year={2026}
        today="2026-10-05"
        groups={[{ key: "2026-11", label: "November 2026", hours: 2, entries: [] }]}
      />,
    );
    expect(screen.getByTestId("cme-log-month-hours-2026-11")).toHaveTextContent("2");
    expect(screen.getByTestId("cme-log-month-hours-2026-12")).toHaveTextContent("");
  });

  it("fills the whole goal bar when every logged hour, even under one, belongs to one goal", () => {
    render(
      <CmePlanGoalSplit
        tally={[{ goal: { id: "g1", goal: "Learn a new therapy approach", sortOrder: 0 }, hours: 0.5, entryCount: 1 }]}
      />,
    );
    const bar = screen.getByTestId("cme-plan-tally-bar");
    expect(Number(bar.getAttribute("width")) + Number(bar.getAttribute("x"))).toBeCloseTo(100, 0);
  });
});
