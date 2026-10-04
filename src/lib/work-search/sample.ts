import { DEMO_CME_ENTRIES } from "@/lib/cme/demo-year";
import type { OnCallEntry } from "@/lib/on-call/entry-model";
import { DEMO_ON_CALL_ENTRIES } from "@/lib/on-call/demo-entries";
import { addDaysToDate, perthDateOf } from "@/lib/perth-time";
import { demoMyShifts, demoRosterLeave } from "@/lib/roster/team/demo-team";
import { demoTeachingSessions } from "@/lib/teaching/demo-programme";
import { cmeActivityWorkItems, leaveWorkItems, sessionWorkItems, shiftWorkItems } from "@/lib/work-search/items";
import type { WorkItem } from "@/lib/work-search/model";

/**
 * The invented sample a signed-out visitor searches: the same demo records each
 * area's own signed-out sample shows. Loaded with a dynamic import only when the
 * search opens signed out, and it never fetches anything.
 */
export function workSearchSample(now: Date): { items: WorkItem[]; entries: readonly OnCallEntry[] } {
  const today = perthDateOf(now);
  return {
    items: [
      ...shiftWorkItems(demoMyShifts(now)),
      ...leaveWorkItems(demoRosterLeave(now)),
      ...sessionWorkItems(demoTeachingSessions({ from: today, to: addDaysToDate(today, 41) }, now)),
      ...cmeActivityWorkItems(DEMO_CME_ENTRIES),
    ],
    entries: DEMO_ON_CALL_ENTRIES,
  };
}
