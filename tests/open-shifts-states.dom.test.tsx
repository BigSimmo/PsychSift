/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { OpenShiftsGate, openShiftsStatus } from "@/components/open-shifts/open-shifts-states";
import { Switch } from "@/components/open-shifts/open-shifts-ui";
import type { OpenShiftsState } from "@/components/open-shifts/use-open-shifts";

function state(overrides: Partial<OpenShiftsState>): OpenShiftsState {
  return {
    status: "ready",
    listings: [],
    teams: [],
    roster: [],
    rosterStatus: "ready",
    readAt: null,
    sample: null,
    offline: false,
    failedTeams: [],
    actorId: null,
    message: null,
    reload: () => undefined,
    ...overrides,
  };
}

describe("Open shifts states", () => {
  it("says the list didn't load rather than showing an empty list", () => {
    const reload = vi.fn();
    render(
      <OpenShiftsGate state={state({ status: "error", message: "Try again shortly.", reload })}>
        <p>the list</p>
      </OpenShiftsGate>,
    );
    expect(screen.queryByText("the list")).toBeNull();
    expect(screen.getByText(/the list didn't load/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reload).toHaveBeenCalledOnce();
  });

  it("shows a loading shape, never 'nothing open', while the list loads", () => {
    render(
      <OpenShiftsGate state={state({ status: "loading" })}>
        <p>the list</p>
      </OpenShiftsGate>,
    );
    expect(screen.getByRole("img", { name: "Loading open shifts" })).toBeTruthy();
    expect(screen.queryByText(/nothing/i)).toBeNull();
  });

  it("points a reader with no team to Roster", () => {
    render(
      <OpenShiftsGate state={state({ status: "no-team" })}>
        <p>the list</p>
      </OpenShiftsGate>,
    );
    expect(screen.getByRole("link", { name: "Join a Roster team" }).getAttribute("href")).toBe("/roster/join");
  });

  it("labels made-up records, offline copies and partial reads in the status line", () => {
    expect(openShiftsStatus(state({ sample: "signed-out" }))).toEqual({ kind: "sample" });
    expect(openShiftsStatus(state({ sample: "release-held" }))).toMatchObject({ kind: "text", info: true });
    expect(openShiftsStatus(state({ offline: true, readAt: new Date() }))).toEqual({ kind: "offline" });
    expect(openShiftsStatus(state({ failedTeams: ["Riverside"] }))).toEqual({
      kind: "failed",
      text: "Couldn't read Riverside",
    });
    expect(openShiftsStatus(state({ readAt: new Date("2026-10-05T01:50:00.000Z") }))).toEqual({
      kind: "text",
      text: "Shift list updated 09:50",
    });
  });

  it("the switch reads as a switch and works from the keyboard", () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="Hide roster clashes" />);
    const control = screen.getByRole("switch", { name: "Hide roster clashes" });
    expect(control.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(control);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
