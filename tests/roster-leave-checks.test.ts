import { describe, expect, it } from "vitest";

import { clashDayWords, leaveChecks, type LeaveCheckShift } from "@/components/roster/requests/roster-leave-checks";

/*
 * The Plan leave sheet's Checks (work-mode redesign, owner request 6 Oct
 * 2026): clashes and first shift back, honest about where the roster read
 * stops. Every shift here is invented.
 */

const ME = "me";
function shift(id: string, date: string, kind: LeaveCheckShift["kind"] = "day", userId: string | null = ME) {
  return {
    id,
    userId,
    kind,
    startsAt: `${date}T08:00:00+08:00`,
    endsAt: `${date}T16:30:00+08:00`,
  } satisfies LeaveCheckShift;
}

const roster = [
  shift("before", "2026-10-21"),
  shift("thu", "2026-10-22"),
  shift("fri", "2026-10-23"),
  shift("theirs", "2026-10-22", "day", "someone-else"),
  shift("al", "2026-10-24", "leave"),
  shift("back", "2026-10-26", "night"),
];

describe("leaveChecks", () => {
  it("lists only my working shifts during the leave, and my first shift back", () => {
    const checks = leaveChecks(roster, ME, "2026-10-22", "2026-10-25", "2026-11-30");
    expect(checks.clashes.map((row) => row.id)).toEqual(["thu", "fri"]);
    expect(checks.clashesPartial).toBe(false);
    expect(checks.firstBack?.id).toBe("back");
    expect(checks.firstBackState).toBe("loaded");
  });

  it("says no shift back by the end of the loaded roster only when the day after leave is loaded", () => {
    const loaded = leaveChecks([], ME, "2026-11-01", "2026-11-05", "2026-11-30");
    expect(loaded).toMatchObject({ firstBack: null, firstBackState: "loaded", clashesPartial: false });
    const beyond = leaveChecks([], ME, "2026-11-25", "2026-12-05", "2026-11-30");
    expect(beyond).toMatchObject({ firstBack: null, firstBackState: "beyond", clashesPartial: true });
  });

  it("joins clash days in words and shortens a long list", () => {
    const words = (date: string) => date.slice(8);
    expect(clashDayWords(["2026-10-22", "2026-10-22", "2026-10-23"], words)).toBe("22, 23");
    expect(
      clashDayWords(
        ["01", "02", "03", "04", "05", "06"].map((d) => `2026-10-${d}`),
        words,
      ),
    ).toBe("01, 02, 03, 04 and 2 more");
  });
});
