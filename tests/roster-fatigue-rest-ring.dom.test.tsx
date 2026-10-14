/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { calculateRestTurnaround, RosterFatigueRestRing } from "@/components/roster/roster-fatigue-rest-ring";

describe("RosterFatigueRestRing", () => {
  it("calculates safe rest interval when turnaround is >= 10h", () => {
    const now = new Date("2026-10-05T08:00:00+08:00");
    const shifts = [
      { id: "s1", startsAt: "2026-10-04T08:00:00+08:00", endsAt: "2026-10-04T16:30:00+08:00" },
      { id: "s2", startsAt: "2026-10-05T13:00:00+08:00", endsAt: "2026-10-05T21:30:00+08:00" },
    ];
    const result = calculateRestTurnaround(shifts, now);
    expect(result.isBreach).toBe(false);
    expect(result.restRemainingMs).toBe(5 * 60 * 60 * 1000); // 5 hours remaining until 13:00
  });

  it("flags short turnaround (< 10h) as an industrial safe-hours breach", () => {
    const now = new Date("2026-10-04T22:00:00+08:00");
    // Evening shift ends 21:30, morning shift starts 07:00 (9.5h turnaround)
    const shifts = [
      { id: "s1", startsAt: "2026-10-04T13:00:00+08:00", endsAt: "2026-10-04T21:30:00+08:00" },
      { id: "s2", startsAt: "2026-10-05T07:00:00+08:00", endsAt: "2026-10-05T15:30:00+08:00" },
    ];
    const result = calculateRestTurnaround(shifts, now);
    expect(result.isBreach).toBe(true);
    expect(result.totalTurnaroundMs).toBe(9.5 * 60 * 60 * 1000);

    render(<RosterFatigueRestRing shifts={shifts} now={now} />);
    expect(screen.getByText(/< 10 h turnaround/i)).toBeTruthy();
    expect(screen.getByText(/Find a swap/i)).toBeTruthy();
  });

  it("renders safe recovery state when rule is met", () => {
    const now = new Date("2026-10-05T08:00:00+08:00");
    const shifts = [
      { id: "s1", startsAt: "2026-10-04T08:00:00+08:00", endsAt: "2026-10-04T16:30:00+08:00" },
      { id: "s2", startsAt: "2026-10-05T14:00:00+08:00", endsAt: "2026-10-05T22:00:00+08:00" },
    ];
    render(<RosterFatigueRestRing shifts={shifts} now={now} />);
    expect(screen.getByText(/10 h minimum rest/i)).toBeTruthy();
    expect(screen.getByText("6.0h")).toBeTruthy(); // 6 hours remaining
  });

  it("does not infer turnaround or flag breach when there is no preceding shift", () => {
    const now = new Date("2026-10-05T08:00:00+08:00");
    const shifts = [{ id: "s1", startsAt: "2026-10-05T10:00:00+08:00", endsAt: "2026-10-05T18:00:00+08:00" }];
    const result = calculateRestTurnaround(shifts, now);
    expect(result.isBreach).toBe(false);
    expect(result.restRemainingMs).toBeNull();
    expect(result.previousShift).toBeNull();

    const { container } = render(<RosterFatigueRestRing shifts={shifts} now={now} />);
    expect(container.firstChild).toBeNull();
  });

  it("suppresses rendering when shifts are sample data", () => {
    const now = new Date("2026-10-04T22:00:00+08:00");
    const shifts = [
      { id: "s1", startsAt: "2026-10-04T13:00:00+08:00", endsAt: "2026-10-04T21:30:00+08:00" },
      { id: "s2", startsAt: "2026-10-05T07:00:00+08:00", endsAt: "2026-10-05T15:30:00+08:00" },
    ];
    const { container } = render(<RosterFatigueRestRing shifts={shifts} now={now} sample={true} />);
    expect(container.firstChild).toBeNull();
  });

  it("treats back-to-back shifts as a breach with no recovery", () => {
    const now = new Date("2026-10-04T12:00:00+08:00");
    const shifts = [
      { id: "s1", startsAt: "2026-10-04T08:00:00+08:00", endsAt: "2026-10-04T16:00:00+08:00" },
      { id: "s2", startsAt: "2026-10-04T16:00:00+08:00", endsAt: "2026-10-05T00:00:00+08:00" },
    ];
    const result = calculateRestTurnaround(shifts, now);
    expect(result.totalTurnaroundMs).toBe(0);
    expect(result.isBreach).toBe(true);
    render(<RosterFatigueRestRing shifts={shifts} now={now} />);
    expect(screen.queryByText(/10 h minimum rest/i)).toBeNull();
  });

  it("uses the overlapping preceding shift rather than an older safe gap", () => {
    const now = new Date("2026-10-04T09:00:00+08:00");
    const shifts = [
      { id: "s0", startsAt: "2026-10-01T08:00:00+08:00", endsAt: "2026-10-01T16:00:00+08:00" },
      { id: "s1", startsAt: "2026-10-04T08:00:00+08:00", endsAt: "2026-10-04T18:00:00+08:00" },
      { id: "s2", startsAt: "2026-10-04T16:00:00+08:00", endsAt: "2026-10-05T00:00:00+08:00" },
    ];
    const result = calculateRestTurnaround(shifts, now);
    expect(result.previousShift?.id).toBe("s1");
    expect(result.isBreach).toBe(true);
  });

  it("counts rest from the end of the shift still in progress", () => {
    const now = new Date("2026-10-04T12:00:00+08:00"); // four hours into a shift that ends 16:00
    const shifts = [
      { id: "s1", startsAt: "2026-10-04T08:00:00+08:00", endsAt: "2026-10-04T16:00:00+08:00" },
      { id: "s2", startsAt: "2026-10-05T00:00:00+08:00", endsAt: "2026-10-05T08:00:00+08:00" },
    ];
    const result = calculateRestTurnaround(shifts, now);
    expect(result.restRemainingMs).toBe(8 * 60 * 60 * 1000);
    expect(result.totalTurnaroundMs).toBe(8 * 60 * 60 * 1000);
  });

  it("judges turnaround against the team's own minimum break", () => {
    const now = new Date("2026-10-04T22:00:00+08:00");
    const shifts = [
      { id: "s1", startsAt: "2026-10-04T13:00:00+08:00", endsAt: "2026-10-04T21:30:00+08:00" },
      { id: "s2", startsAt: "2026-10-05T07:00:00+08:00", endsAt: "2026-10-05T15:30:00+08:00" },
    ];
    expect(calculateRestTurnaround(shifts, now, 8).isBreach).toBe(false);
    expect(calculateRestTurnaround(shifts, now, 12).isBreach).toBe(true);
    render(<RosterFatigueRestRing shifts={shifts} now={now} minRestHours={12} />);
    expect(screen.getByText(/< 12 h turnaround/i)).toBeTruthy();
  });
});
