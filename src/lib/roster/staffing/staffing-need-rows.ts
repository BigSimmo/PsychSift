import type { StaffingNeed } from "@/lib/roster/staffing/team-staffing";
import { ROSTER_MAX_STAFFING_NEEDS, ROSTER_OPEN_SHIFT_KINDS } from "@/lib/roster/team/model";

/**
 * One `roster_staffing_needs` row turned into a `StaffingNeed`: counts only,
 * no id and no names. Shared by the member-safe staffing-needs route and the
 * hospital-wide short-staffed read, so both judge a day by the same needs.
 */

/** The kinds a cover need may hold. A row of any other kind is skipped, never guessed. */
export const STAFFING_NEED_KINDS = ROSTER_OPEN_SHIFT_KINDS;

/** The API returns at most 1,000 rows per read, so every needs read pages by this many. */
export const STAFFING_NEEDS_PAGE = 1000;

/** The database stops one team at 2,000 needs: the same limit `needs.set` enforces. */
export const STAFFING_NEEDS_PER_TEAM_LIMIT = ROSTER_MAX_STAFFING_NEEDS;

export type StaffingNeedRow = {
  readonly weekday: number | null;
  readonly on_date: string | null;
  readonly kind: string;
  readonly grade: string | null;
  readonly site_id: string | null;
  readonly needed: number;
};

/** The need, or null for a kind this check does not know. */
export function staffingNeedFromRow(row: StaffingNeedRow): StaffingNeed | null {
  if (!(STAFFING_NEED_KINDS as readonly string[]).includes(row.kind)) return null;
  return {
    weekday: row.weekday,
    date: row.on_date,
    kind: row.kind,
    grade: row.grade,
    siteId: row.site_id,
    needed: row.needed,
  };
}
