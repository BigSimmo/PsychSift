// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { OpenShiftsState } from "@/components/open-shifts/use-open-shifts";
import type { OpenShiftListing } from "@/lib/open-shifts/model";

/*
 * My requests "Past" row (mockup `rost_mine`, work-mode redesign, owner
 * request 6 Oct 2026): approved shifts already worked leave the groups, so a
 * row points to the payslip check in Hours and rest. Invented shifts.
 */

const hook = vi.hoisted(() => ({ state: null as unknown }));
vi.mock("next/navigation", () => ({ usePathname: () => "/open-shifts/mine", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/open-shifts/use-open-shifts", () => ({ useOpenShifts: () => hook.state }));
vi.mock("@/components/roster/roster-format", async (original) => ({
  ...(await original<typeof import("@/components/roster/roster-format")>()),
  useRosterNow: () => new Date("2026-10-07T01:00:00Z"),
}));

import { OpenShiftsMinePage } from "@/components/open-shifts/open-shifts-mine-page";

let counter = 0;
function listing(date: string, status: OpenShiftListing["status"]): OpenShiftListing {
  counter += 1;
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    status,
    urgent: false,
    startsAt: `${date}T08:00:00+08:00`,
    endsAt: `${date}T16:30:00+08:00`,
    shiftCode: "D",
    kind: "day",
    minGrade: "registrar",
    siteId: "00000000-0000-4000-8000-00000000b001",
    siteName: "Example Hospital",
    serviceId: "00000000-0000-4000-8000-00000000a001",
    teamName: "Example team",
    mine: false,
    claimedByMe: true,
    myGrade: "registrar",
  } as OpenShiftListing;
}

function state(listings: OpenShiftListing[], sample: OpenShiftsState["sample"] = null): OpenShiftsState {
  return {
    status: "ready",
    listings,
    teams: [],
    roster: [],
    rosterStatus: "ready",
    readAt: null,
    sample,
    offline: false,
    failedTeams: [],
    refreshFailed: false,
    actorId: null,
    message: null,
    reload: () => undefined,
  };
}

afterEach(cleanup);

describe("My requests: recently worked", () => {
  it("counts approved shifts already worked and links to the payslip check", () => {
    hook.state = state([
      listing("2026-10-03", "approved"),
      listing("2026-10-05", "approved"),
      listing("2026-10-09", "approved"),
    ]);
    render(<OpenShiftsMinePage />);
    const row = screen.getByTestId("open-shifts-mine-past");
    expect(row.textContent).toContain("Recently worked · 2");
    expect(row.getAttribute("href")).toBe("/roster?view=hours");
  });

  it("shows no row when nothing approved has been worked yet", () => {
    hook.state = state([listing("2026-10-09", "approved"), listing("2026-10-03", "claimed")]);
    render(<OpenShiftsMinePage />);
    expect(screen.queryByTestId("open-shifts-mine-past")).toBeNull();
  });
});
