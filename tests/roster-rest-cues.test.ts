import { describe, expect, it } from "vitest";

import { restCues, restCuesByTeam, type RestCueShift } from "@/lib/roster/rest-cues";
import { perthWallToIso } from "@/lib/roster/shifts/perth-time";
import { ruleFlags } from "@/lib/roster/team/rule-flags";
import { myShiftsAsAssignments } from "@/lib/roster/rest-cues";

/* Rest and night-run cues on the reader's own shifts. */

let nextId = 1;
function shift(kind: RestCueShift["kind"], date: string, start: string, endDate: string, end: string): RestCueShift {
  return {
    id: `own-${nextId++}`,
    startsAt: perthWallToIso(date, start)!,
    endsAt: perthWallToIso(endDate, end)!,
    title: "Shift",
    kind,
  };
}

const cueFor = (cues: ReturnType<typeof restCues>, row: RestCueShift) => cues.find((cue) => cue.shiftId === row.id);

describe("restCues", () => {
  it("matches each team's limits while retaining work from the other team in its lookback", () => {
    const first = { ...shift("day", "2026-10-05", "08:00", "2026-10-05", "16:00"), serviceId: "first" };
    const second = { ...shift("evening", "2026-10-06", "00:00", "2026-10-06", "08:00"), serviceId: "second" };
    const third = { ...shift("day", "2026-10-06", "16:00", "2026-10-06", "23:00"), serviceId: "first" };
    const cues = restCuesByTeam(
      [first, second, third],
      new Map([
        ["first", { minBreakHours: 6 }],
        ["second", { minBreakHours: 10 }],
      ]),
    );
    expect(cueFor(cues, second)?.restHours).toBe(8);
    expect(cueFor(cues, second)?.warning).toBe("Less than 10 hours' rest before this shift");
    expect(cueFor(cues, third)?.warning).toBeUndefined();
  });
  it("measures rest from the previous worked shift, across an overnight", () => {
    const night = shift("night", "2026-10-05", "21:30", "2026-10-06", "08:00");
    const day = shift("day", "2026-10-06", "17:00", "2026-10-06", "22:00");
    const cues = restCues([night, day], {});
    expect(cueFor(cues, night)).toEqual({ shiftId: night.id, restHours: null });
    expect(cueFor(cues, day)).toEqual({ shiftId: day.id, restHours: 9 });
  });

  it("does not count leave or on call as worked, and gives them no cue", () => {
    const first = shift("day", "2026-10-05", "08:00", "2026-10-05", "16:00");
    const onCall = shift("on_call", "2026-10-05", "18:00", "2026-10-06", "06:00");
    const leave = shift("leave", "2026-10-06", "07:00", "2026-10-06", "08:00");
    const next = shift("day", "2026-10-06", "08:00", "2026-10-06", "16:00");
    const cues = restCues([first, onCall, leave, next], {});
    expect(cueFor(cues, onCall)).toEqual({ shiftId: onCall.id, restHours: null });
    expect(cueFor(cues, leave)).toEqual({ shiftId: leave.id, restHours: null });
    expect(cueFor(cues, next)?.restHours).toBe(16);
  });

  it("places each night in its run of consecutive nights", () => {
    const nights = ["2026-10-05", "2026-10-06", "2026-10-07"].map((date, index) =>
      shift("night", date, "21:30", ["2026-10-06", "2026-10-07", "2026-10-08"][index]!, "08:00"),
    );
    const lone = shift("night", "2026-10-12", "21:30", "2026-10-13", "08:00");
    const cues = restCues([...nights, lone], {});
    expect(nights.map((row) => cueFor(cues, row)?.nightOf)).toEqual([
      { n: 1, of: 3 },
      { n: 2, of: 3 },
      { n: 3, of: 3 },
    ]);
    expect(cueFor(cues, lone)?.nightOf).toBeUndefined();
  });

  it("gives no warning when the team has no rules", () => {
    const first = shift("day", "2026-10-05", "08:00", "2026-10-05", "16:00");
    const second = shift("evening", "2026-10-06", "00:00", "2026-10-06", "08:00");
    expect(restCues([first, second], {}).every((cue) => cue.warning === undefined)).toBe(true);
  });

  it("uses the team rule's own words when the rule is crossed", () => {
    const first = shift("day", "2026-10-05", "08:00", "2026-10-05", "16:00");
    const second = shift("evening", "2026-10-06", "00:00", "2026-10-06", "08:00");
    const rules = { minBreakHours: 10 };
    const cues = restCues([first, second], rules);
    const [flag] = ruleFlags(myShiftsAsAssignments([first, second]), rules);
    expect(cueFor(cues, second)).toEqual({ shiftId: second.id, restHours: 8, warning: flag!.words });
    expect(flag!.words).toBe("Less than 10 hours' rest before this shift");
    expect(cueFor(cues, first)?.warning).toBeUndefined();
  });

  it("keeps two crossed rules apart on one shift", () => {
    const first = shift("night", "2026-10-05", "21:30", "2026-10-06", "08:00");
    const second = shift("night", "2026-10-06", "21:30", "2026-10-07", "08:00");
    const rules = { minBreakHours: 14, maxNightsInRow: 1 };
    const words = ruleFlags(myShiftsAsAssignments([first, second]), rules)
      .filter((flag) => flag.assignmentId === second.id)
      .map((flag) => flag.words);
    expect(words).toHaveLength(2);
    expect(cueFor(restCues([first, second], rules), second)?.warning).toBe(words.join("; "));
  });

  it("infers a missing kind the way the screens do", () => {
    const night = { ...shift(null, "2026-10-05", "21:30", "2026-10-06", "08:00"), title: "Nights" };
    expect(myShiftsAsAssignments([night])[0]!.kind).toBe("night");
  });
});

describe("rest chip words", async () => {
  const { restCueWords, restWords } = await import("@/components/roster/roster-rest-chip");
  it("rounds rest down and names the night run", () => {
    expect(restWords(9)).toBe("9 h rest");
    expect(restWords(9.99)).toBe("9 h 59 min rest");
    expect(restWords(73)).toBe("3 days' rest");
    expect(restCueWords({ shiftId: "x", restHours: 13.5, nightOf: { n: 2, of: 3 } })).toBe(
      "13 h 30 min rest · 2nd night of 3",
    );
    expect(restCueWords({ shiftId: "x", restHours: null })).toBeNull();
  });
});
