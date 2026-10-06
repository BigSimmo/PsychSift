import { addDaysToDate, perthDateOf } from "@/lib/roster/shifts/perth-time";
import type { RosterManageOpenShift } from "@/lib/roster/team/model";

type Row = Pick<RosterManageOpenShift, "status" | "startsAt" | "endsAt">;

export type PostedGroups<T extends Row> = {
  /** Someone has asked for it, or reported they can't work it: a manager decides. */
  readonly hasRequest: readonly T[];
  /** Still open: nobody has asked yet. */
  readonly open: readonly T[];
  /** Approved and starting in the next 7 days. */
  readonly filledThisWeek: readonly T[];
};

const byStart = (a: Row, b: Row) => Date.parse(a.startsAt) - Date.parse(b.startsAt);

/** Upcoming posted shifts by what the poster has to do: decide, wait, or nothing. */
export function groupPosted<T extends Row>(shifts: readonly T[], now: Date): PostedGroups<T> {
  const upcoming = shifts.filter((row) => Date.parse(row.endsAt) > now.getTime());
  const weekEnd = Date.parse(`${addDaysToDate(perthDateOf(now), 7)}T00:00:00+08:00`);
  return {
    hasRequest: upcoming.filter((row) => row.status === "claimed" || row.status === "reported").sort(byStart),
    open: upcoming.filter((row) => row.status === "open").sort(byStart),
    filledThisWeek: upcoming
      .filter((row) => row.status === "approved" && Date.parse(row.startsAt) < weekEnd)
      .sort(byStart),
  };
}
