/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenShiftsState } from "@/components/open-shifts/use-open-shifts";
import { sampleListings, sampleRoster } from "@/lib/open-shifts/sample";

// Mon 5 Oct 2026, 08:00 Perth: today's example shifts are still ahead.
const NOW = new Date("2026-10-05T00:00:00.000Z");

const hook = vi.hoisted(() => ({ state: null as unknown as OpenShiftsState }));
vi.mock("@/components/open-shifts/use-open-shifts", () => ({ useOpenShifts: () => hook.state }));
vi.mock("@/components/roster/roster-format", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/roster/roster-format")>()),
  useRosterNow: () => NOW,
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));

import { OpenShiftsBrowsePage } from "@/components/open-shifts/open-shifts-browse-page";

function sampleState(): OpenShiftsState {
  return {
    status: "ready",
    listings: sampleListings(NOW),
    teams: [],
    roster: sampleRoster(NOW),
    rosterStatus: "ready",
    readAt: NOW,
    sample: "signed-out",
    offline: false,
    failedTeams: [],
    refreshFailed: false,
    actorId: null,
    message: null,
    reload: () => undefined,
  };
}

beforeEach(() => {
  hook.state = sampleState();
});
afterEach(cleanup);

describe("Open shifts, signed-out preview", () => {
  it("shows the quick filters and a match count on the example list", () => {
    render(<OpenShiftsBrowsePage />);
    const filters = screen.getByRole("group", { name: "Quick filters" });
    expect(within(filters).getByRole("button", { name: /Filters/ })).toBeTruthy();
    expect(within(filters).getByRole("button", { name: "No clashes" })).toBeTruthy();
    expect(within(filters).getByRole("button", { name: /Sites/ })).toBeTruthy();
    expect(screen.getByText(/open shifts match/)).toBeTruthy();
  });

  it("labels today's example shifts from the made-up roster", () => {
    render(<OpenShiftsBrowsePage />);
    const list = screen.getByRole("list", { name: /Open shifts on/ });
    expect(within(list).getAllByRole("listitem").length).toBeGreaterThanOrEqual(2);
    expect(within(list).getByText("Roster flag: 9 h break")).toBeTruthy();
    expect(within(list).getByText(/No flags on your PsychSift roster/)).toBeTruthy();
  });

  it("filters the example list when No clashes is switched off", () => {
    render(<OpenShiftsBrowsePage />);
    const chip = screen.getByRole("button", { name: "No clashes" });
    const matches = () => /(\d+) of (\d+)/.exec(screen.getByText(/open shifts match/).parentElement?.textContent ?? "");
    const before = Number(matches()?.[1]);
    fireEvent.click(chip);
    expect(Number(matches()?.[1])).toBeGreaterThan(before);
  });

  it("offers a way back to My Day and says how fresh the example is", () => {
    render(<OpenShiftsBrowsePage />);
    const context = screen.getByTestId("open-shifts-sample-context");
    expect(within(context).getByRole("link", { name: "Back to My Day" }).getAttribute("href")).toBe("/my-day");
    expect(context.textContent).toContain("example roster as of Mon 5 Oct");
  });
});
