/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { NowShiftClock, onCallShiftClock } from "@/components/on-call/now/shift-clock";
import type { OnCallShiftContext } from "@/lib/on-call/shift-context";

// The after-hours clock on On Call Now (work-mode redesign idea 10, owner
// request 6 Oct 2026). It counts down the reader's own rostered shift only.

afterEach(cleanup);

/** Tue 6 Oct 21:00 to Wed 7 Oct 08:00, Perth (UTC+8). */
type RosterContext = Extract<OnCallShiftContext, { kind: "roster" }>;

function roster(phase: "start" | "during" | "end" = "during"): RosterContext {
  return {
    kind: "roster",
    shiftKey: "shift-1",
    period: "night",
    phase,
    startsAt: "2026-10-06T13:00:00.000Z",
    endsAt: "2026-10-07T00:00:00.000Z",
  };
}

const AT_0350 = new Date("2026-10-06T19:50:00.000Z"); // Wed 03:50 Perth

describe("onCallShiftClock", () => {
  it("counts down to the end of the rostered shift", () => {
    const clock = onCallShiftClock(roster(), AT_0350);
    expect(clock).toMatchObject({
      periodLabel: "Night",
      from: "Tue 21:00",
      until: "Wed 08:00",
      untilTime: "08:00",
      minutesLeft: 250,
      totalMinutes: 660,
      percent: 62,
      ending: false,
    });
  });

  it("never reads 0 min in the last minute", () => {
    const clock = onCallShiftClock(roster("end"), new Date("2026-10-06T23:59:30.000Z"));
    expect(clock?.minutesLeft).toBe(1);
    expect(clock?.ending).toBe(true);
  });

  it("draws nothing without a rostered shift on now", () => {
    expect(onCallShiftClock({ kind: "none", shiftKey: "clock", period: "night", phase: "unknown" }, AT_0350)).toBe(
      null,
    );
    expect(onCallShiftClock({ kind: "picked", shiftKey: "picked", period: "night", phase: "unknown" }, AT_0350)).toBe(
      null,
    );
    // Before the shift starts, after it ends, or with a broken shift.
    expect(onCallShiftClock(roster(), new Date("2026-10-06T12:00:00.000Z"))).toBe(null);
    expect(onCallShiftClock(roster(), new Date("2026-10-07T00:00:00.000Z"))).toBe(null);
    expect(onCallShiftClock({ ...roster(), endsAt: "not a date" }, AT_0350)).toBe(null);
  });
});

describe("NowShiftClock", () => {
  it("shows the until line and a meter screen readers can read", () => {
    render(<NowShiftClock context={roster()} now={AT_0350} />);
    expect(screen.getByRole("heading", { name: "Your shift · Night" })).toBeInTheDocument();
    expect(screen.getByTestId("on-call-now-shift-clock-line")).toHaveTextContent("Until 08:00· 4 h 10 min left");
    expect(
      screen.getByRole("img", { name: "4 h 10 min left of your 11 h shift, 62 percent done" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("on-call-now-shift-clock-handover")).toBeNull();
  });

  it("offers Handover in the shift's last hour", () => {
    render(<NowShiftClock context={roster("end")} now={new Date("2026-10-06T23:20:00.000Z")} />);
    expect(screen.getByTestId("on-call-now-shift-clock-line")).toHaveTextContent("40 min left");
    expect(screen.getByRole("link", { name: "Open handover" })).toHaveAttribute("href", "/on-call/handover");
  });

  it("renders nothing without a rostered shift", () => {
    const { container } = render(
      <NowShiftClock context={{ kind: "none", shiftKey: "clock", period: "night", phase: "unknown" }} now={AT_0350} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
