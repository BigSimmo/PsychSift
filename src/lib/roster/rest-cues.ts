import { inferShiftKind } from "@/lib/roster/shift-kind";
import type { RosterAssignment, RosterRules } from "@/lib/roster/team/model";
import { isWorkedAssignment, restBefore, ruleFlags, runPositions } from "@/lib/roster/team/rule-flags";
import { assignmentStartDate } from "@/lib/roster/team/team-view";
import type { RosterDisplayShift } from "@/lib/roster/team/team-view";
import { addDaysToDate } from "@/lib/roster/shifts/perth-time";

/**
 * Quiet cues on the doctor's OWN shifts: how long a rest comes before each
 * worked shift, and where a night sits in a run of nights. A warning appears
 * only where the team's own rule is crossed, in `ruleFlags`' exact words; this
 * file sets no thresholds of its own.
 *
 * Worked time, rest and runs are the definitions `rule-flags.ts` uses (leave
 * and on call are not worked), imported rather than copied.
 */

export type RestCue = {
  readonly shiftId: string;
  /** Hours since my previous worked shift ended; null for leave, on call, or no earlier worked shift. */
  readonly restHours: number | null;
  /** Place in a run of nights on consecutive Perth days, only when the run is two nights or more. */
  readonly nightOf?: { readonly n: number; readonly of: number };
  /** The team rule(s) this shift crosses, in `ruleFlags`' words, joined with "; ". */
  readonly warning?: string;
};

/** The minimal shape read from one of my shifts. */
export type RestCueShift = Pick<RosterDisplayShift, "id" | "startsAt" | "endsAt" | "title" | "kind">;

/** One fixed owner id: every row is the reader's own, so `ruleFlags` judges them as one person. */
const ME = "me";

/**
 * Adapter: my shift rows → the `RosterAssignment` rows `ruleFlags` reads. Only
 * the fields the rule helpers use carry meaning (id, owner, times, kind); a
 * shift whose kind was never set gets the same inferred kind the screens show.
 */
export function myShiftsAsAssignments(shifts: readonly RestCueShift[]): RosterAssignment[] {
  return shifts.map((shift) => ({
    id: shift.id,
    userId: ME,
    name: null,
    grade: null,
    siteId: null,
    siteName: null,
    startsAt: shift.startsAt,
    endsAt: shift.endsAt,
    shiftCode: shift.title,
    kind: shift.kind ?? inferShiftKind(shift),
  }));
}

/** For each night, its place in its run and the run's length, from `runPositions`. */
function nightRuns(nights: readonly RosterAssignment[]): Map<string, { n: number; of: number }> {
  const positions = runPositions(nights);
  const byDate = new Map<string, number>();
  for (const row of nights) byDate.set(assignmentStartDate(row), positions.get(row.id) ?? 1);
  const dates = [...byDate.keys()].sort();
  const length = new Map<string, number>();
  for (let index = dates.length - 1; index >= 0; index -= 1) {
    const date = dates[index]!;
    const next = dates[index + 1];
    const position = byDate.get(date)!;
    length.set(date, next !== undefined && next === addDaysToDate(date, 1) ? length.get(next)! : position);
  }
  return new Map(
    nights.map((row) => {
      const date = assignmentStartDate(row);
      return [row.id, { n: byDate.get(date)!, of: length.get(date)! }];
    }),
  );
}

export function restCues(myShifts: readonly RestCueShift[], rules: RosterRules): RestCue[] {
  const rows = myShiftsAsAssignments(myShifts);
  const worked = rows
    .filter(isWorkedAssignment)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id.localeCompare(b.id));
  const nights = nightRuns(worked.filter((row) => row.kind === "night"));
  const warnings = new Map<string, string[]>();
  for (const flag of ruleFlags(rows, rules)) {
    const list = warnings.get(flag.assignmentId);
    if (list) list.push(flag.words);
    else warnings.set(flag.assignmentId, [flag.words]);
  }
  return rows.map((row): RestCue => {
    if (!isWorkedAssignment(row)) return { shiftId: row.id, restHours: null };
    const night = nights.get(row.id);
    const words = warnings.get(row.id);
    return {
      shiftId: row.id,
      restHours: restBefore(worked, row),
      ...(night && night.of > 1 ? { nightOf: night } : {}),
      ...(words ? { warning: words.join("; ") } : {}),
    };
  });
}

/** Each team's limits judge its own shifts against the person's complete worked history. */
export function restCuesByTeam(
  shifts: readonly (RestCueShift & { readonly serviceId?: string | null })[],
  rulesByTeam: ReadonlyMap<string, RosterRules>,
): RestCue[] {
  const baseline = restCues(shifts, {});
  const warnings = new Map<string, Map<string, string>>();
  for (const [id, rules] of rulesByTeam) {
    warnings.set(
      id,
      new Map(restCues(shifts, rules).flatMap((cue) => (cue.warning ? [[cue.shiftId, cue.warning] as const] : []))),
    );
  }
  return baseline.map((cue, index) => {
    const team = shifts[index]?.serviceId;
    const warning = team ? warnings.get(team)?.get(cue.shiftId) : undefined;
    return warning ? { ...cue, warning } : cue;
  });
}
