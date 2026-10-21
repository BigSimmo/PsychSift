import { z } from "zod";

/**
 * The round trip when a doctor tries to carry a goal into a year whose
 * targets are not confirmed yet: the plan page sends them to set up next
 * year with where they came from, and set-up sends them back to that same
 * year's carry section, with the goal they chose ready to carry. Nothing is
 * carried on the way back; the doctor still taps Carry.
 *
 * Every value is checked on the server before it shapes a link. A bad or
 * stale value is dropped, so the worst case is the old behaviour (set-up
 * stays on set-up), never a link somewhere else.
 */

const goalIdSchema = z.string().uuid();

/** A goal id from the address bar, or null. */
export function cmeCarryGoalId(value: unknown): string | null {
  const parsed = goalIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Set up next year's targets, then come back to carry. `goalId` names the goal chosen, if one was. */
export function cmeCarryConfirmHref(fromYear: number, goalId?: string): string {
  const params = new URLSearchParams({ year: String(fromYear + 1), carryFrom: String(fromYear) });
  if (goalId) params.set("carryGoal", goalId);
  return `/cme/setup?${params.toString()}`;
}

/**
 * Where set-up for `year` returns to once its targets are confirmed: the plan
 * for the year before, at its carry section. Null unless `carryFrom` is
 * exactly the year before `year`.
 */
export function cmeCarryReturnHref(year: number, carryFrom: unknown, carryGoal: unknown): string | null {
  const from = typeof carryFrom === "string" && /^\d{4}$/.test(carryFrom) ? Number(carryFrom) : null;
  if (from === null || from !== year - 1) return null;
  const params = new URLSearchParams({ year: String(from) });
  const goalId = cmeCarryGoalId(carryGoal);
  if (goalId) params.set("carry", goalId);
  return `/cme/plan?${params.toString()}#cme-carry-goals`;
}
