/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenShiftsState } from "@/components/open-shifts/use-open-shifts";
import { sampleListings, sampleRoster } from "@/lib/open-shifts/sample";

/*
 * Browse remembers filter choices on this device (spec B2, work-mode
 * redesign, owner request 6 Oct 2026): only No clashes, levels and start
 * times; never for the signed-out example; Reset forgets them.
 */

const NOW = new Date("2026-10-05T00:00:00.000Z");
const KEY = "psychsift.open-shifts.filters.v1";
const hook = vi.hoisted(() => ({ state: null as unknown as OpenShiftsState }));
vi.mock("@/components/open-shifts/use-open-shifts", () => ({ useOpenShifts: () => hook.state }));
vi.mock("@/components/roster/roster-format", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/roster/roster-format")>()),
  useRosterNow: () => NOW,
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));

import { OpenShiftsBrowsePage } from "@/components/open-shifts/open-shifts-browse-page";
import { readSavedFilters } from "@/components/open-shifts/open-shifts-saved-filters";

function state(sample: OpenShiftsState["sample"]): OpenShiftsState {
  return {
    status: "ready",
    listings: sampleListings(NOW),
    teams: [],
    roster: sampleRoster(NOW),
    rosterStatus: "ready",
    readAt: NOW,
    sample,
    offline: false,
    failedTeams: [],
    refreshFailed: false,
    actorId: null,
    message: null,
    reload: () => undefined,
  };
}

const noClashes = () => screen.getByRole("button", { name: "No clashes" });

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe("Open shifts remembered filters", () => {
  it("keeps No clashes off on the next visit, and Reset forgets it", () => {
    hook.state = state(null);
    const first = render(<OpenShiftsBrowsePage />);
    expect(noClashes().getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(noClashes());
    expect(JSON.parse(window.localStorage.getItem(KEY)!)).toEqual({
      hideClashes: false,
      includeLowerLevels: false,
      starts: [],
    });
    first.unmount();

    render(<OpenShiftsBrowsePage />);
    expect(noClashes().getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(noClashes().getAttribute("aria-pressed")).toBe("true");
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("never saves or applies choices on the signed-out example", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ hideClashes: false }));
    hook.state = state("signed-out");
    render(<OpenShiftsBrowsePage />);
    expect(noClashes().getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(noClashes());
    expect(JSON.parse(window.localStorage.getItem(KEY)!)).toEqual({ hideClashes: false });
  });

  it("ignores a damaged or foreign saved value", () => {
    window.localStorage.setItem(KEY, "{not json");
    expect(readSavedFilters()).toBeNull();
    window.localStorage.setItem(KEY, JSON.stringify({ hideClashes: "no", starts: ["night", "lunch"], siteIds: ["x"] }));
    expect(readSavedFilters()).toEqual({
      hideClashes: true,
      siteIds: [],
      includeLowerLevels: false,
      starts: ["night"],
    });
  });
});
