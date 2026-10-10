import { describe, expect, it } from "vitest";

import { rosterActionSchema, type RosterMaker } from "@/lib/roster/team/model";
import {
  applySafeNumberChanges,
  emptySafeNumberGrid,
  otherNeedCount,
  safeNumberGrid,
  safeNumberIsGrouped,
  safeNumberNeeds,
  setSafeNumber,
  undoSafeNumberChanges,
} from "@/lib/roster/team/safe-number";

/*
 * The team's safe number editor, the pure part. It owns only whole-team
 * weekday needs for Day, Evening and Night, and keeps every other need as it
 * is, because `needs.set` replaces the team's whole list. Every id is invented.
 */

type Need = RosterMaker["needs"][number];
const SITE = "5e000000-0000-4000-8000-0000000000c1";
let next = 0;
const need = (fields: Partial<Need>): Need => ({
  id: `5e000000-0000-4000-8000-${String((next += 1)).padStart(12, "0")}`,
  weekday: 1,
  date: null,
  kind: "day",
  grade: null,
  siteId: null,
  needed: 1,
  ...fields,
});

describe("the safe number editor's numbers", () => {
  it("reads whole-team weekday needs, adding two for the same day and kind", () => {
    const grid = safeNumberGrid([
      need({ weekday: 1, kind: "day", needed: 2 }),
      need({ weekday: 1, kind: "day", needed: 1 }),
      need({ weekday: 6, kind: "night", needed: 1 }),
      // Not the editor's: a grade, a site, a date, on call.
      need({ weekday: 2, kind: "day", grade: "registrar", needed: 5 }),
      need({ weekday: 3, kind: "day", siteId: SITE, needed: 5 }),
      need({ weekday: null, date: "2026-12-25", kind: "day", needed: 5 }),
      need({ weekday: 4, kind: "on_call", needed: 5 }),
    ]);
    expect(grid.day).toEqual([3, 0, 0, 0, 0, 0, 0]);
    expect(grid.evening).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(grid.night).toEqual([0, 0, 0, 0, 0, 1, 0]);
  });

  it("shows the short view only when Monday to Friday and the weekend each share one number", () => {
    const even = setSafeNumber(setSafeNumber(emptySafeNumberGrid(), "day", [1, 2, 3, 4, 5], 3), "day", [6, 7], 2);
    expect(safeNumberIsGrouped(even)).toBe(true);
    expect(safeNumberIsGrouped(setSafeNumber(even, "day", [3], 4))).toBe(false);
  });

  it("keeps a number between 0 and 200", () => {
    expect(setSafeNumber(emptySafeNumberGrid(), "night", [1], -3).night[0]).toBe(0);
    expect(setSafeNumber(emptySafeNumberGrid(), "night", [1], 240).night[0]).toBe(200);
    expect(setSafeNumber(emptySafeNumberGrid(), "night", [1], 150).night[0]).toBe(150);
  });
});

describe("the list needs.set is sent", () => {
  const kept = [
    need({ weekday: 2, kind: "day", grade: "registrar", needed: 1 }),
    need({ weekday: 3, kind: "evening", siteId: SITE, needed: 2 }),
    need({ weekday: null, date: "2026-12-25", kind: "night", needed: 1 }),
    need({ weekday: 5, kind: "on_call", needed: 1 }),
  ];

  it("keeps every need the editor does not own, unchanged, and writes the editor's numbers without zeros", () => {
    const current = [...kept, need({ weekday: 1, kind: "day", needed: 4 }), need({ weekday: 7, kind: "night" })];
    const grid = setSafeNumber(setSafeNumber(safeNumberGrid(current), "day", [1, 2, 3, 4, 5], 3), "night", [7], 0);
    const sent = safeNumberNeeds(grid, current);
    expect(sent.slice(0, kept.length)).toEqual(safeNumberNeeds(emptySafeNumberGrid(), kept));
    expect(sent.slice(kept.length)).toEqual(
      [1, 2, 3, 4, 5].map((weekday) => ({ weekday, date: null, kind: "day", grade: null, siteId: null, needed: 3 })),
    );
    expect(sent.some((item) => "id" in item)).toBe(false);
    expect(otherNeedCount(current)).toBe(kept.length);
    // Exactly what the route's strict schema accepts.
    expect(rosterActionSchema.safeParse({ action: "needs.set", expectedIds: [], needs: sent }).success).toBe(true);
  });

  it("clears every number to an empty list when the team has no other need", () => {
    expect(safeNumberNeeds(emptySafeNumberGrid(), [need({ weekday: 1, kind: "day", needed: 2 })])).toEqual([]);
  });

  it("never sends a need the table would refuse (leave, or the grade other)", () => {
    const refused = [need({ kind: "leave" }), need({ grade: "other", weekday: 2 })];
    expect(safeNumberNeeds(emptySafeNumberGrid(), refused)).toEqual([]);
    expect(otherNeedCount(refused)).toBe(0);
  });
});

describe("only the numbers that changed", () => {
  it("lays this manager's changes over the fresh numbers and keeps everything else as read", () => {
    const opened = setSafeNumber(emptySafeNumberGrid(), "day", [1, 2, 3, 4, 5], 2);
    const edited = setSafeNumber(opened, "day", [1, 2, 3, 4, 5], 3);
    const fresh = setSafeNumber(opened, "night", [6, 7], 1);
    const merged = applySafeNumberChanges(fresh, opened, edited);
    expect(merged.day).toEqual([3, 3, 3, 3, 3, 0, 0]);
    expect(merged.night).toEqual([0, 0, 0, 0, 0, 1, 1]);
    // Undo the same way: back to what was read, for the cells the save changed only.
    expect(applySafeNumberChanges(merged, merged, fresh)).toEqual(fresh);
  });
});

describe("a total over the database's limit", () => {
  it("is written in parts of 200 or fewer, so another number can still be saved", () => {
    const current = [need({ weekday: 1, kind: "day", needed: 200 }), need({ weekday: 1, kind: "day", needed: 150 })];
    const grid = setSafeNumber(safeNumberGrid(current), "night", [2], 1);
    expect(grid.day[0]).toBe(350);
    const sent = safeNumberNeeds(grid, current);
    expect(sent.filter((item) => item.kind === "day").map((item) => item.needed)).toEqual([200, 150]);
    expect(rosterActionSchema.safeParse({ action: "needs.set", expectedIds: [], needs: sent }).success).toBe(true);
  });

  it("steps down by one, not straight to 200", () => {
    const grid = safeNumberGrid([
      need({ weekday: 1, kind: "day", needed: 200 }),
      need({ weekday: 1, kind: "day", needed: 150 }),
    ]);
    expect(setSafeNumber(grid, "day", [1], 349).day[0]).toBe(349);
    expect(setSafeNumber(grid, "day", [1], 400).day[0]).toBe(350);
  });
});

describe("Undo of one save", () => {
  it("puts back only the numbers that still hold what the save wrote", () => {
    const previous = setSafeNumber(emptySafeNumberGrid(), "day", [1, 2], 2);
    const saved = setSafeNumber(previous, "day", [1, 2], 3);
    // Another manager has since set Monday to 4.
    const fresh = setSafeNumber(saved, "day", [1], 4);
    expect(undoSafeNumberChanges(fresh, saved, previous).day.slice(0, 2)).toEqual([4, 2]);
  });
});

describe("one source for the cover-need rules", () => {
  it("reads and writes needs under the same kinds and per-team limit", async () => {
    const rows = await import("@/lib/roster/staffing/staffing-need-rows");
    const model = await import("@/lib/roster/team/model");
    expect(rows.STAFFING_NEED_KINDS).toBe(model.ROSTER_OPEN_SHIFT_KINDS);
    expect(rows.STAFFING_NEEDS_PER_TEAM_LIMIT).toBe(model.ROSTER_MAX_STAFFING_NEEDS);
  });
});
