// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/*
 * Hours and rest: a warned team shift that hasn't started offers "Swap {day}"
 * into the existing swap request flow (mockup "Swap Wed 14", work-mode
 * redesign, owner request 6 Oct 2026). Invented shifts.
 */

vi.mock("next/navigation", () => ({ usePathname: () => "/roster", useRouter: () => ({ push: vi.fn() }) }));

import { RosterHoursRestCheck } from "@/components/roster/roster-hours-rest-check";

function shift(id: string, start: string, end: string, kind: string, team: boolean) {
  return {
    id,
    startsAt: start,
    endsAt: end,
    title: "Shift",
    location: null,
    sourceUid: null,
    kind,
    source: team ? "team" : "manual",
    seriesId: null,
    workplace: "Example Hospital",
    ...(team ? { assignmentId: `a-${id}`, serviceId: "example" } : {}),
  } as never;
}

// One night, then an evening 8 hours after it ends: under the 24 hours free after a single night.
const roster = (team: boolean) => [
  shift("night", "2026-10-15T21:30:00+08:00", "2026-10-16T08:00:00+08:00", "night", team),
  shift("eve", "2026-10-16T16:00:00+08:00", "2026-10-16T22:00:00+08:00", "evening", team),
];

afterEach(cleanup);

describe("Hours and rest warning actions", () => {
  it("offers Swap on a warned team shift, into the swap request for that shift", async () => {
    render(<RosterHoursRestCheck shifts={roster(true)} now={new Date("2026-10-13T02:00:00Z")} />);
    const swaps = await screen.findAllByTestId("roster-hours-rest-swap");
    expect(swaps.length).toBeGreaterThan(0);
    for (const swap of swaps) {
      expect(swap.textContent).toMatch(/^Swap (Thu 15|Fri 16) Oct$/);
      expect(swap.getAttribute("href")).toMatch(
        /^\/roster\/requests\?start=swap&assignment=a-(night|eve)&team=example/,
      );
    }
  });

  it("offers no Swap on a shift you added yourself", async () => {
    render(<RosterHoursRestCheck shifts={roster(false)} now={new Date("2026-10-13T02:00:00Z")} />);
    expect(await screen.findByTestId("roster-hours-rest-warnings")).toBeTruthy();
    expect(screen.queryByTestId("roster-hours-rest-swap")).toBeNull();
  });
});
