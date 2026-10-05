import { addDays } from "@/lib/calendar/calendar-event";
import type { RosterAssignment, RosterManageSwap, RosterRules } from "./model";
import { assignmentStartDate } from "./team-view";

/**
 * Where a roster breaks the team's own rules, shown to the manager with the
 * reason on tap. Leave and on-call never count as worked time. A flag sits on
 * the shift that first crosses a limit, not on the ones before it.
 *
 * The server does not recheck these rules when a manager approves a swap: it
 * rechecks only that nobody is double-booked and that the grades still fit.
 * For a swap waiting on the manager, these flags are the only check on the
 * team's rules, so `swapRuleFlags` also judges the roster as the swap would
 * leave it.
 */

export type RuleFlag = {
  assignmentId: string;
  rule: "minBreakHours" | "maxNightsInRow" | "maxDaysInRow" | "maxHours7d" | "maxHours14d";
  words: string;
};

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

const worked = (row: RosterAssignment) => row.kind !== "leave" && row.kind !== "on_call";

function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? "th" : (({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th");
  return `${n}${suffix}`;
}

function hoursWords(hours: number): string {
  return String(Math.round(hours * 10) / 10);
}

const byStart = (a: RosterAssignment, b: RosterAssignment) =>
  Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id.localeCompare(b.id);

/** Rows that are one person's worked shifts, each person's list in start order. */
function workedByPerson(rows: readonly RosterAssignment[]): Map<string, RosterAssignment[]> {
  const people = new Map<string, RosterAssignment[]>();
  for (const row of rows) {
    if (!row.userId || !worked(row)) continue;
    const list = people.get(row.userId);
    if (list) list.push(row);
    else people.set(row.userId, [row]);
  }
  for (const list of people.values()) list.sort(byStart);
  return people;
}

/** Consecutive Perth start dates: for each row, its place in the run of days it belongs to. */
function runPositions(list: readonly RosterAssignment[]): Map<string, number> {
  const dates = [...new Set(list.map(assignmentStartDate))].sort();
  const position = new Map<string, number>();
  dates.forEach((date, index) => {
    const previous = dates[index - 1];
    position.set(date, previous !== undefined && addDays(previous, 1) === date ? (position.get(previous) ?? 0) + 1 : 1);
  });
  return new Map(list.map((row) => [row.id, position.get(assignmentStartDate(row)) ?? 1]));
}

/**
 * Hours between the latest worked shift that ended at or before `row` starts
 * and that start, exact to the minute (the break rule may be a fraction of an
 * hour, which `hoursSinceLastShift`'s whole hours would misjudge). Null with no earlier shift.
 */
function restBefore(list: readonly RosterAssignment[], row: RosterAssignment): number | null {
  const start = Date.parse(row.startsAt);
  const ends = list.map((other) => Date.parse(other.endsAt)).filter((end) => end <= start);
  return ends.length ? (start - Math.max(...ends)) / HOUR_MS : null;
}

/** Worked hours in the `days` up to and including the end of `row`. */
function hoursInWindow(list: readonly RosterAssignment[], row: RosterAssignment, days: number): number {
  const to = Date.parse(row.endsAt);
  const from = to - days * DAY_MS;
  return (
    list.reduce((sum, other) => {
      const overlap = Math.min(to, Date.parse(other.endsAt)) - Math.max(from, Date.parse(other.startsAt));
      return overlap > 0 ? sum + overlap : sum;
    }, 0) / HOUR_MS
  );
}

export function ruleFlags(rows: readonly RosterAssignment[], rules: RosterRules): RuleFlag[] {
  const flags: RuleFlag[] = [];
  for (const list of workedByPerson(rows).values()) {
    const { minBreakHours, maxNightsInRow, maxDaysInRow, maxHours7d, maxHours14d } = rules;
    const days = maxDaysInRow === undefined ? null : runPositions(list);
    const nightList = list.filter((row) => row.kind === "night");
    const nights = maxNightsInRow === undefined ? null : runPositions(nightList);
    for (const row of list) {
      if (minBreakHours !== undefined) {
        const rest = restBefore(list, row);
        if (rest !== null && rest < minBreakHours) {
          flags.push({
            assignmentId: row.id,
            rule: "minBreakHours",
            words: `Less than ${minBreakHours} hours' rest before this shift`,
          });
        }
      }
      const night = row.kind === "night" ? nights?.get(row.id) : undefined;
      if (maxNightsInRow !== undefined && night !== undefined && night > maxNightsInRow) {
        flags.push({
          assignmentId: row.id,
          rule: "maxNightsInRow",
          words: `${ordinal(night)} night in a row (team limit ${maxNightsInRow})`,
        });
      }
      const day = days?.get(row.id);
      if (maxDaysInRow !== undefined && day !== undefined && day > maxDaysInRow) {
        flags.push({
          assignmentId: row.id,
          rule: "maxDaysInRow",
          words: `${ordinal(day)} day in a row (team limit ${maxDaysInRow})`,
        });
      }
      for (const [rule, limit, span] of [
        ["maxHours7d", maxHours7d, 7],
        ["maxHours14d", maxHours14d, 14],
      ] as const) {
        if (limit === undefined) continue;
        const hours = hoursInWindow(list, row, span);
        if (hours > limit) {
          flags.push({
            assignmentId: row.id,
            rule,
            words: `${hoursWords(hours)} hours in ${span} days (team limit ${limit})`,
          });
        }
      }
    }
  }
  return flags;
}

/** A flag the roster would gain from a swap, with the person it would fall on. */
export type SwapRuleFlag = RuleFlag & { userId: string };

type SwapSides = Pick<RosterManageSwap, "requesterId" | "counterpartyId" | "give" | "take">;

/**
 * The flags a swap would add for either of its two people: the rules worked
 * out again on the roster with both shifts changed hands, less the flags that
 * person already had. A flag whose words change (more hours in the week, a
 * longer run) counts as new. `rows` should hold both shifts and each person's
 * look-back; a swapped shift missing from `rows` is added from the swap.
 */
export function swapRuleFlags(rows: readonly RosterAssignment[], rules: RosterRules, swap: SwapSides): SwapRuleFlag[] {
  const people = new Set([swap.requesterId, swap.counterpartyId]);
  const moves: [RosterAssignment | null, string][] = [
    [swap.give, swap.counterpartyId],
    [swap.take, swap.requesterId],
  ];
  const after = rows.map((row) => {
    const move = moves.find(([side]) => side?.id === row.id);
    return move ? { ...row, userId: move[1] } : row;
  });
  for (const [side, userId] of moves) {
    if (side && !rows.some((row) => row.id === side.id)) after.push({ ...side, userId });
  }
  const ownerBefore = new Map(rows.map((row) => [row.id, row.userId]));
  const ownerAfter = new Map(after.map((row) => [row.id, row.userId]));
  const key = (flag: RuleFlag, userId: string | null | undefined) =>
    `${userId}|${flag.assignmentId}|${flag.rule}|${flag.words}`;
  const before = new Set(ruleFlags(rows, rules).map((flag) => key(flag, ownerBefore.get(flag.assignmentId))));
  const added: SwapRuleFlag[] = [];
  for (const flag of ruleFlags(after, rules)) {
    const userId = ownerAfter.get(flag.assignmentId);
    if (userId && people.has(userId) && !before.has(key(flag, userId))) added.push({ ...flag, userId });
  }
  return added;
}

/**
 * The helpers `ruleFlags` judges with, exported unchanged so a doctor's own
 * rest cues (`src/lib/roster/rest-cues.ts`) and Hours and rest check (`hours-rest-check.ts`) use the very same definitions of
 * worked time, rest and consecutive-day runs instead of a second copy.
 */
export { worked as isWorkedAssignment, runPositions, restBefore, hoursInWindow };
