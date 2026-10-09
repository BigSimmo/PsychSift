/** @vitest-environment jsdom */

// My Day's week strip marks a day with something due. The mark is grey while the
// date is still ahead and amber only once it has passed: amber means passed or failed.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { StripDay } from "@/components/my-day/my-day-today-cards";

afterEach(cleanup);

function strip(date: string) {
  render(
    <ol>
      <StripDay date={date} today="2026-10-06" kinds={[]} due={1} />
    </ol>,
  );
  return screen.getByTestId(`dash-week-due-${date}`);
}

// Work-mode redesign, owner request 6 Oct 2026: the dots use the work-mode tokens,
// grey `--neutral-400` and amber `--warning-text`, in place of the old `--dash-*` ones.
describe("My Day due dots", () => {
  it("draws a not-yet-due date in grey, not amber", () => {
    const dot = strip("2026-10-09");
    expect(dot.className).toContain("--neutral-400");
    expect(dot.className).not.toContain("--warning-text");
    expect(dot.hasAttribute("data-passed")).toBe(false);
  });

  it("keeps today grey", () => {
    expect(strip("2026-10-06").className).not.toContain("--warning-text");
  });

  it("draws a passed date in amber", () => {
    const dot = strip("2026-10-03");
    expect(dot.className).toContain("--warning-text");
    expect(dot.hasAttribute("data-passed")).toBe(true);
  });

  it("draws no dot when nothing is due", () => {
    render(
      <ol>
        <StripDay date="2026-10-09" today="2026-10-06" kinds={[]} due={0} />
      </ol>,
    );
    expect(screen.queryByTestId("dash-week-due-2026-10-09")).toBeNull();
  });
});
