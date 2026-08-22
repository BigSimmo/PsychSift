import { describe, expect, it } from "vitest";

import { stampAgeText, trackerRowState } from "@/components/ward-management/tracker/tracker-derivations";
import type { TransportJob } from "@/components/ward-management/ward-model";

/**
 * Task 10: the live tracker's own rendering decisions — never a re-test of `transportLeg`'s
 * precedence chain, which already has full coverage in `tests/ward-derivations.test.ts`. This
 * file exists specifically to close the gap the task-10 preflight's LATE ADDITION section flags:
 * the seed fixture only ever exercises two of the five legs ("Accepted", "Collected") end to end,
 * so a Playwright assertion against real seed data can never prove the other three legs, or
 * "Cancelled", or the no-transport absence, render correctly. Every case below constructs its own
 * `TransportJob` rather than relying on the fixture, for exactly that reason.
 */
function transportJob(overrides: Partial<TransportJob> = {}): TransportJob {
  return {
    id: "TR-TEST",
    provider: "St John WA",
    escortRequired: false,
    ...overrides,
  };
}

describe("trackerRowState", () => {
  it("returns an explicit absence for a movement with no transport job at all", () => {
    expect(trackerRowState(undefined)).toEqual({ leg: undefined, stampAt: undefined });
  });

  it("returns the Requested leg with no stamp, since the model never timestamps job creation", () => {
    expect(trackerRowState(transportJob())).toEqual({ leg: "Requested", stampAt: undefined });
  });

  it("returns the Accepted leg with acceptedAt as its stamp", () => {
    expect(trackerRowState(transportJob({ acceptedAt: 100 }))).toEqual({ leg: "Accepted", stampAt: 100 });
  });

  it("returns the En route leg with enRouteAt as its stamp, not acceptedAt", () => {
    expect(trackerRowState(transportJob({ acceptedAt: 100, enRouteAt: 120 }))).toEqual({
      leg: "En route",
      stampAt: 120,
    });
  });

  it("returns the Collected leg with collectedAt as its stamp, not an earlier one", () => {
    expect(trackerRowState(transportJob({ acceptedAt: 100, enRouteAt: 120, collectedAt: 130 }))).toEqual({
      leg: "Collected",
      stampAt: 130,
    });
  });

  it("returns the Arrived leg with arrivedAt as its stamp, the furthest-progressed of all four", () => {
    expect(
      trackerRowState(transportJob({ acceptedAt: 100, enRouteAt: 120, collectedAt: 130, arrivedAt: 150 })),
    ).toEqual({ leg: "Arrived", stampAt: 150 });
  });

  it("returns the Cancelled leg with cancelledAt as its stamp, even when earlier stamps exist", () => {
    expect(trackerRowState(transportJob({ acceptedAt: 100, enRouteAt: 120, cancelledAt: 125 }))).toEqual({
      leg: "Cancelled",
      stampAt: 125,
    });
  });
});

describe("stampAgeText", () => {
  it("names the absence explicitly, in prose containing 'since', when there is no stamp", () => {
    const text = stampAgeText(undefined, 500);
    expect(text).toMatch(/since/i);
    expect(text).not.toMatch(/ago/i);
  });

  it("renders the elapsed duration since the stamp, in prose containing 'ago'", () => {
    expect(stampAgeText(400, 475)).toBe("1h 15m ago");
  });

  it("never renders a negative duration when the stamp is after now", () => {
    expect(stampAgeText(500, 480)).toBe("0m ago");
  });
});
