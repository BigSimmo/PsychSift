import { addDaysToDate, perthDateOf } from "@/lib/roster/shifts/perth-time";
import { gradeRank, placementProblem } from "@/lib/roster/team/eligibility";
import type { RosterAssignment, RosterGrade, RosterTeamMember, RosterUnavailability } from "@/lib/roster/team/model";

/**
 * "Who could do this" on a posted shift that is still open: the team's
 * members at or above the shift's level whose PsychSift team roster has
 * nothing at the same time. Names and level only; nobody is messaged.
 *
 * It reads what a roster manager already reads: the team's `members` (names
 * and levels), its `assignments` around the shift (every member's live team
 * roster rows), and `unavailability` (the days members said they can't or
 * would rather not work; managers see everyone's). A doctor's other jobs and
 * private shifts are never read, so this is a starting point for a phone
 * call, not a promise anyone is free. Roster rechecks level and overlap when
 * someone asks for the shift and it is approved.
 */

/** Days of roster read before the shift's start date, so a long or overnight shift that began earlier is seen. */
export const WHO_COULD_LOOKBACK_DAYS = 7;

/** The `assignments` read window for a shift: a week before its start date to its end date (Perth). */
export function whoCouldWindow(startsAt: string, endsAt: string): { from: string; to: string } {
  const startDate = perthDateOf(startsAt);
  const endDate = perthDateOf(endsAt);
  return { from: addDaysToDate(startDate, -WHO_COULD_LOOKBACK_DAYS), to: endDate < startDate ? startDate : endDate };
}

export type WhoCouldPerson = {
  readonly userId: string;
  readonly name: string | null;
  readonly grade: RosterGrade | null;
  /** They said they'd rather not work that day. Still listed: it isn't a "can't". */
  readonly prefersOff: boolean;
  readonly isYou: boolean;
};

export type WhoCould = {
  readonly people: readonly WhoCouldPerson[];
  /** Left out because their team roster has something at the same time (leave counts). */
  readonly busy: number;
  /** Left out because they said they can't work that day. */
  readonly cantWork: number;
};

/** True when `grade` meets the shift's minimum. A shift for any level takes everyone. */
export function meetsLevel(grade: RosterGrade | null, minGrade: RosterGrade | null): boolean {
  const mine = gradeRank(grade);
  if (mine === null) return false;
  if (minGrade === null) return true;
  const minimum = gradeRank(minGrade);
  return minimum !== null && mine >= minimum;
}

export function whoCouldDoThis(input: {
  shift: { startsAt: string; endsAt: string; minGrade: RosterGrade | null };
  members: readonly RosterTeamMember[];
  assignments: readonly RosterAssignment[];
  /** Null when the read failed or wasn't made: nobody is then left out for it. */
  unavailability: RosterUnavailability["unavailability"] | null;
  actorId: string | null;
  posterId?: string | null;
}): WhoCould {
  const { shift, members, assignments, unavailability, actorId, posterId } = input;
  const day = perthDateOf(shift.startsAt);
  const said = new Map<string, "cant" | "prefer_off">();
  for (const row of unavailability ?? []) {
    if (row.date !== day) continue;
    // "Can't" outranks "rather not" if a member somehow has both.
    if (row.kind === "cant" || !said.has(row.userId)) said.set(row.userId, row.kind);
  }
  let busy = 0;
  let cantWork = 0;
  const people: WhoCouldPerson[] = [];
  for (const member of members) {
    if (posterId && member.userId === posterId) continue;
    if (!meetsLevel(member.grade, shift.minGrade)) continue;
    if (placementProblem(assignments, member.userId, shift.startsAt, shift.endsAt, [], null) === "clash") {
      busy += 1;
      continue;
    }
    const note = said.get(member.userId);
    if (note === "cant") {
      cantWork += 1;
      continue;
    }
    people.push({
      userId: member.userId,
      name: member.name,
      grade: member.grade,
      prefersOff: note === "prefer_off",
      isYou: member.userId === actorId,
    });
  }
  // Closest to the shift's level first, then by name, so the likeliest fit leads.
  people.sort(
    (a, b) =>
      (gradeRank(a.grade) ?? 99) - (gradeRank(b.grade) ?? 99) || (a.name ?? "￿").localeCompare(b.name ?? "￿", "en-AU"),
  );
  return { people, busy, cantWork };
}
