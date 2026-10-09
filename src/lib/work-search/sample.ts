import { DEMO_CME_ENTRIES, DEMO_CME_INSTANT, DEMO_CME_YEAR } from "@/lib/cme/demo-year";
import type { CmeEntry, CmeRequirementSet } from "@/lib/cme/types";
import type { OnCallEntry } from "@/lib/on-call/entry-model";
import { DEMO_ON_CALL_ENTRIES } from "@/lib/on-call/demo-entries";
import { addDaysToDate, perthDateOf } from "@/lib/perth-time";
import { demoMyShifts, demoRosterLeave } from "@/lib/roster/team/demo-team";
import { demoTeachingSessions } from "@/lib/teaching/demo-programme";
import { cmeActivityWorkItems, leaveWorkItems, sessionWorkItems, shiftWorkItems } from "@/lib/work-search/items";
import { TEACHING_LOOKAHEAD_DAYS, type WorkItem } from "@/lib/work-search/model";

/**
 * The invented sample search answers from wherever the area's own screen shows
 * example data: the same demo records each area's sample shows (Roster's one
 * example roster, Teaching's programme, CPD's example year), so "Am I working
 * tomorrow?" gives the answer Roster, My Day and the Week view show. Split by
 * area, because a signed-in reader may see examples in one area and their own
 * records in another. Loaded with a dynamic import only when needed, and it
 * never fetches anything.
 */
export function workSearchSample(now: Date): {
  items: WorkItem[];
  roster: WorkItem[];
  teaching: WorkItem[];
  cme: WorkItem[];
  entries: readonly OnCallEntry[];
  cpd: { set: CmeRequirementSet; entries: readonly CmeEntry[]; today: string };
} {
  const today = perthDateOf(now);
  const roster = [...shiftWorkItems(demoMyShifts(now)), ...leaveWorkItems(demoRosterLeave(now))];
  const teaching = sessionWorkItems(
    demoTeachingSessions({ from: today, to: addDaysToDate(today, TEACHING_LOOKAHEAD_DAYS) }, now),
  );
  const cme = cmeActivityWorkItems(DEMO_CME_ENTRIES);
  return {
    items: [...roster, ...teaching, ...cme],
    roster,
    teaching,
    cme,
    entries: DEMO_ON_CALL_ENTRIES,
    // CPD's example year is worked out from its own day, as the CPD screen does.
    cpd: { set: DEMO_CME_YEAR, entries: DEMO_CME_ENTRIES, today: perthDateOf(DEMO_CME_INSTANT) },
  };
}
