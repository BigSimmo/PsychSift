import { describe, expect, it } from "vitest";

import { buildMyDaySample } from "@/components/my-day/my-day-sample";
import { ON_CALL_NOW_EXAMPLE } from "@/components/on-call/now/signed-out-example";
import { DEMO_CME_ROUTINES } from "@/lib/cme/demo-year";
import { sampleRoster } from "@/lib/open-shifts/sample";
import { demoOnCallShifts } from "@/lib/roster/shifts/demo-shifts";
import { perthDateOf, perthTimeOf } from "@/lib/roster/shifts/perth-time";
import { DEMO_ME_ID, demoMyShifts, demoRosterLeave, demoRosterRead } from "@/lib/roster/team/demo-team-core";

/**
 * One example roster for every work area (review 2, item 2c): My Day, Roster
 * (personal and team), Open shifts and the local demo build all read Dr Alex
 * Example's own shifts, and On Call's example shows the same on call tonight.
 */

// Every day of a fortnight, at 09:00 Perth, so the cycle is checked whatever day it is opened.
const DAYS = Array.from({ length: 14 }, (_, index) => new Date(Date.UTC(2026, 9, 1 + index, 1)));
const slots = (rows: readonly { startsAt: string; endsAt: string }[]) =>
  rows.map((row) => `${row.startsAt}/${row.endsAt}`).sort();

describe("the one example roster", () => {
  it.each(DAYS.map((now) => [perthDateOf(now.toISOString()), now] as const))("agrees across areas on %s", (_, now) => {
    const mine = demoMyShifts(now);
    const today = perthDateOf(now.toISOString());
    // Roster's team view, Open shifts' roster check, My Day and the demo build's API.
    const team = demoRosterRead("assignments", {}, now).assignments.filter((row) => row.userId === DEMO_ME_ID);
    expect(slots(team)).toEqual(slots(mine));
    expect(slots(sampleRoster(now))).toEqual(slots(mine));
    expect(slots(buildMyDaySample(today, now).sources.roster.shifts)).toEqual(slots(mine));
    expect(slots(demoOnCallShifts(now))).toEqual(slots(mine));

    // On call tonight, at the times On Call's example shows.
    const tonight = mine.filter((shift) => perthDateOf(shift.startsAt) === today);
    expect(tonight).toHaveLength(1);
    expect(tonight[0]).toMatchObject({ kind: "on_call", title: "On call", workplace: ON_CALL_NOW_EXAMPLE.hospital });
    expect(perthTimeOf(tonight[0]!.startsAt)).toBe(ON_CALL_NOW_EXAMPLE.rightNow.start);
    expect(perthTimeOf(tonight[0]!.endsAt)).toBe(ON_CALL_NOW_EXAMPLE.rightNow.end);
  });

  it("never rosters the example doctor on leave or twice at once", () => {
    const now = DAYS[0]!;
    const mine = demoMyShifts(now);
    const [leave] = demoRosterLeave(now);
    expect(
      mine.some(
        (shift) => perthDateOf(shift.startsAt) >= leave!.startsOn && perthDateOf(shift.startsAt) <= leave!.endsOn,
      ),
    ).toBe(false);
    const sorted = [...mine].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    for (let index = 1; index < sorted.length; index += 1) {
      expect(Date.parse(sorted[index]!.startsAt)).toBeGreaterThanOrEqual(Date.parse(sorted[index - 1]!.endsAt));
    }
  });

  it("gives My Day the same Journal club due date as CPD's example routine", () => {
    const now = DAYS[0]!;
    const sample = buildMyDaySample(perthDateOf(now.toISOString()), now);
    const journal = sample.items.find((item) => item.title === "Journal club");
    expect(journal?.due).toBe(DEMO_CME_ROUTINES.find((routine) => routine.title === "Journal club")?.nextDue);
  });
});
