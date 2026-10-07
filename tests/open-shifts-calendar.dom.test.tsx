// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OpenShiftsCalendar } from "@/components/open-shifts/open-shifts-calendar";

/*
 * The Browse calendar after its restyle (work-mode redesign, owner request
 * 6 Oct 2026): the meanings stay in each day's spoken label, days outside
 * the 14-day window can't be chosen, and the month arrows stop at the window.
 */

afterEach(cleanup);

function draw(onSelect = vi.fn(), selected = "2026-10-07") {
  render(
    <OpenShiftsCalendar
      today="2026-10-07"
      windowEnd="2026-10-20"
      selected={selected}
      onSelect={onSelect}
      perDay={new Map([["2026-10-09", 3]])}
      urgentDays={new Set(["2026-10-09"])}
      rosteredDays={new Set(["2026-10-12", "2026-10-01"])}
    />,
  );
  return onSelect;
}

describe("Open shifts Browse calendar", () => {
  it("says each day's count, urgency and rostering in words", () => {
    draw();
    expect(
      screen.getByRole("button", {
        name: "Friday 9 October, 3 shifts match, includes an urgent shift",
      }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Monday 12 October, you're rostered" })).toBeTruthy();
    // A past rostered day is not called rostered.
    expect(screen.getByRole("button", { name: "Thursday 1 October" })).toBeTruthy();
    const today = screen.getByRole("button", { name: "Wednesday 7 October, today" });
    expect(today.getAttribute("aria-current")).toBe("date");
    expect(today.getAttribute("aria-pressed")).toBe("true");
  });

  it("lets you choose a day in the window only", () => {
    const onSelect = draw();
    fireEvent.click(screen.getByRole("button", { name: /^Friday 9 October/ }));
    expect(onSelect).toHaveBeenCalledWith("2026-10-09");
    expect(screen.getByRole("button", { name: "Wednesday 21 October" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Tuesday 6 October" })).toHaveProperty("disabled", true);
  });

  it("stops the month arrows at the window", () => {
    draw();
    expect(screen.getByRole("button", { name: "Previous month" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Next month" })).toHaveProperty("disabled", true);
  });
});
