import type { OnCallShift } from "@/lib/roster/shifts/model";
import { demoMyShifts } from "@/lib/roster/team/demo-team-core";

/**
 * The shifts a local demo build's `/api/roster/shifts` answers with: the one
 * example roster (Dr Alex Example's own shifts, `demoMyShifts`), the same one
 * the example data switch shows in Roster, My Day, On Call and Open shifts. So
 * the demo build reads the same day with the switch on or off.
 */
export function demoOnCallShifts(now: Date): OnCallShift[] {
  return demoMyShifts(now);
}
