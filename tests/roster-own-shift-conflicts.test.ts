import { describe, expect, it } from "vitest";

import { detectOwnShiftConflicts, diffRoster } from "@/lib/roster/shifts/diff";
import type { OnCallShiftInput } from "@/lib/roster/shifts/model";
import { perthWallToIso } from "@/lib/roster/shifts/perth-time";

function makeShift(date: string, start: string, end: string, title = "Day", endDate = date): OnCallShiftInput {
  return {
    startsAt: perthWallToIso(date, start)!,
    endsAt: perthWallToIso(endDate, end)!,
    title,
    location: null,
    sourceUid: null,
  };
}

describe("Roster own-shift double-booking detector", () => {
  it("does not flag adjacent shifts where endA === startB", () => {
    const morning = makeShift("2026-10-05", "08:00", "16:30", "Day");
    const afternoon = makeShift("2026-10-05", "16:30", "22:30", "Evening");
    expect(detectOwnShiftConflicts([morning, afternoon])).toEqual([]);
  });

  it("returns exact overlapMinutes for overlapping shifts on the same day", () => {
    const dayShift = makeShift("2026-10-05", "08:00", "16:30", "Day");
    const eveningShift = makeShift("2026-10-05", "14:00", "22:30", "Evening");
    const conflicts = detectOwnShiftConflicts([dayShift, eveningShift]);
    expect(conflicts).toEqual([
      {
        first: dayShift,
        second: eveningShift,
        overlapMinutes: 150,
      },
    ]);
  });

  it("returns exact overlapMinutes when an overnight shift overlaps an early-morning shift", () => {
    const nightShift = makeShift("2026-10-05", "21:30", "08:30", "Night", "2026-10-06");
    const earlyMorning = makeShift("2026-10-06", "07:30", "16:00", "Day");
    const conflicts = detectOwnShiftConflicts([nightShift, earlyMorning]);
    expect(conflicts).toEqual([
      {
        first: nightShift,
        second: earlyMorning,
        overlapMinutes: 60,
      },
    ]);
  });

  it("includes conflicts on RosterDiff returned by diffRoster", () => {
    const retainedOutside = makeShift("2026-10-04", "21:30", "08:30", "Night", "2026-10-05");
    const incomingA = makeShift("2026-10-05", "08:00", "16:30", "Day");
    const incomingB = makeShift("2026-10-05", "15:00", "22:30", "Evening");

    const diff = diffRoster([retainedOutside], [incomingA, incomingB], {
      start: "2026-10-05",
      end: "2026-10-05",
    });

    expect(diff.conflicts).toEqual([
      {
        first: retainedOutside,
        second: incomingA,
        overlapMinutes: 30,
      },
      {
        first: incomingA,
        second: incomingB,
        overlapMinutes: 90,
      },
    ]);
  });
});
