import { rosterInvalidRequest } from "@/lib/roster/team/errors";
import { DemoReadUnsupportedError, demoRosterRead as demoRosterReadCore } from "@/lib/roster/team/demo-team-core";
import type { RosterReadResult, RosterReadWhat } from "@/lib/roster/team/model";

/**
 * The invented sample team the API serves. The data lives in `demo-team-core`
 * (no server imports, so the browser's signed-out sample can use it too); this
 * file adds the API's own error for a read the sample cannot answer.
 */
export {
  DEMO_ME_ID,
  DEMO_SERVICE_ID,
  demoMyShifts,
  demoPublishPreview,
  demoPublishReceipt,
  demoRosterCommand,
  demoRosterLeave,
  demoRosterTeams,
} from "@/lib/roster/team/demo-team-core";

export function demoRosterRead<W extends RosterReadWhat>(
  what: W,
  range: { from?: string; to?: string },
  now = new Date(),
): RosterReadResult<W> {
  try {
    return demoRosterReadCore(what, range, now);
  } catch (error) {
    if (error instanceof DemoReadUnsupportedError) throw rosterInvalidRequest();
    throw error;
  }
}
