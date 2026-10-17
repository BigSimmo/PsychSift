import { ruleGate, type ApprovedRuleSigner, type RuleGate, type RuleSignOff } from "@/lib/admin/rule-sign-off";
import {
  FATIGUE_RULE_SET,
  FATIGUE_RULES_SIGN_OFF,
  type FatigueRuleCitation,
  type FatigueRuleId,
} from "@/lib/roster/fatigue-rules-source";
import { myShiftsAsAssignments } from "@/lib/roster/rest-cues";
import { isWorkedKind, type ShiftKind } from "@/lib/roster/shift-kind";
import { PERTH_OFFSET_MS, addDaysToDate, perthDateOf } from "@/lib/roster/shifts/perth-time";
import { restBefore, ruleFlags, runPositions } from "@/lib/roster/team/rule-flags";
import type { RosterAssignment } from "@/lib/roster/team/model";

/**
 * Fatigue warnings on the doctor's OWN roster, against the limits in the WA public health doctors'
 * industrial agreement (`fatigue-rules-source.ts`, which holds every number and its verbatim quote).
 *
 * Neutral by design: each warning states what the roster shows and quotes the clause, and never
 * says the roster is unlawful, that anyone is at fault, or what to do. The agreement lets a
 * practitioner agree to some of these (a lesser rest after nights, a 13 hour evening shift by
 * written agreement), which the roster cannot see.
 *
 * Reused, not copied: worked time, rest and consecutive-day runs are the definitions
 * `team/rule-flags.ts` uses (leave and on call from home are not worked), and the break and 7 and
 * 14 day hours checks are `ruleFlags` itself, fed the agreement's numbers.
 *
 * Known limits, stated so a signer can judge them:
 * - "12 days' work" counts Perth dates with a worked shift since the last 48 hours free from all
 *   duty (on call counts as duty there, but an on-call-only day is not counted as a day's work).
 * - The 7 and 14 day totals look back from the end of each shift, as `ruleFlags` does.
 * - Rest after nights counts on call as duty, because the clause says "free from all duty
 *   (including on call)". Runs longer than five nights get the night-run warning instead.
 *
 * Off until a named clinician signs `FATIGUE_RULES_SIGN_OFF`.
 */

export type FatigueShift = {
  readonly id: string;
  /** UTC ISO instants. */
  readonly startsAt: string;
  readonly endsAt: string;
  readonly kind: ShiftKind;
};

export type FatigueWarning = {
  /** The shift the warning sits on: the one that first crosses the limit. */
  readonly shiftId: string;
  readonly rule: FatigueRuleId;
  /** What the roster shows, in plain words. */
  readonly words: string;
  /** The clause and its exact words. */
  readonly citation: FatigueRuleCitation;
  /** A verbatim exception the roster cannot see, when the agreement has one for this rule. */
  readonly exception?: FatigueRuleCitation;
};

export type FatigueResult =
  | { readonly gate: Extract<RuleGate, { on: false }>; readonly warnings: readonly [] }
  | { readonly gate: Extract<RuleGate, { on: true }>; readonly warnings: readonly FatigueWarning[] };

const HOUR_MS = 3_600_000;
const rules = FATIGUE_RULE_SET.rules;

function hoursBetween(from: string, to: string): number {
  return (Date.parse(to) - Date.parse(from)) / HOUR_MS;
}

/** "9.5": one decimal, no trailing ".0". */
function hoursWords(hours: number): string {
  return String(Math.round(hours * 10) / 10);
}

function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? "th" : (({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th");
  return `${n}${suffix}`;
}

const cite = (rule: { clause: string; quote: string }): FatigueRuleCitation => ({
  clause: rule.clause,
  quote: rule.quote,
});

const byStart = (a: RosterAssignment, b: RosterAssignment) =>
  Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id.localeCompare(b.id);

/** The warnings, with no switch: exported for tests and for the signer's preview only. */
export function fatigueWarningsUngated(shifts: readonly FatigueShift[]): FatigueWarning[] {
  const rows = myShiftsAsAssignments(shifts.map((shift) => ({ ...shift, title: "" })));
  const worked = rows.filter((row) => isWorkedKind(row.kind)).sort(byStart);
  const duty = rows.filter((row) => row.kind !== "leave").sort(byStart);
  const warnings: FatigueWarning[] = [];

  // Break, 7 and 14 day hours: the team rule helper, fed the agreement's numbers.
  const flags = ruleFlags(rows, {
    minBreakHours: rules.minBreakHours.hours,
    maxHours7d: rules.maxHours7d.hours,
    maxHours14d: rules.maxHours14d.hours,
  });
  for (const flag of flags) {
    const row = worked.find((candidate) => candidate.id === flag.assignmentId)!;
    switch (flag.rule) {
      case "minBreakHours": {
        const rest = restBefore(worked, row) ?? 0;
        warnings.push({
          shiftId: row.id,
          rule: "minBreakHours",
          words: `${hoursWords(rest)} hours' break before this shift.`,
          citation: cite(rules.minBreakHours),
        });
        break;
      }
      case "maxHours7d":
      case "maxHours14d": {
        const rule = rules[flag.rule];
        const span = flag.rule === "maxHours7d" ? 7 : 14;
        warnings.push({
          shiftId: row.id,
          rule: flag.rule,
          words: `More than ${rule.hours} rostered hours in the ${span} days up to the end of this shift.`,
          citation: cite(rule),
        });
        break;
      }
      case "maxDaysInRow":
      case "maxNightsInRow":
        break; // Not passed to ruleFlags: both are handled below with the agreement's own wording.
    }
  }

  // Days of work since the last 48 consecutive hours free from ALL duty, on call included. A single
  // empty calendar day is not 48 hours free, so it does not restart the count; leave does not count
  // as duty or as work.
  const twoDaysOff = rules.maxDaysBeforeTwoDaysOff;
  let lastDutyEnd: number | null = null;
  let workedDates = new Set<string>();
  for (const row of duty) {
    const start = Date.parse(row.startsAt);
    if (lastDutyEnd !== null && (start - lastDutyEnd) / HOUR_MS >= twoDaysOff.hoursOff) workedDates = new Set();
    const interruptsBreak = lastDutyEnd !== null && workedDates.size >= twoDaysOff.days;
    lastDutyEnd = Math.max(lastDutyEnd ?? start, Date.parse(row.endsAt));
    if (!isWorkedKind(row.kind)) {
      // On call (or other non-worked duty) beginning before the 48 hours are free breaks the rest.
      if (interruptsBreak) {
        warnings.push({
          shiftId: row.id,
          rule: "maxDaysBeforeTwoDaysOff",
          words: `On call starts before 48 hours free from all duty after ${workedDates.size} days of work.`,
          citation: cite(twoDaysOff),
        });
      }
      continue;
    }
    const date = perthDateOf(row.startsAt);
    if (workedDates.has(date)) continue;
    workedDates.add(date);
    if (workedDates.size > twoDaysOff.days) {
      warnings.push({
        shiftId: row.id,
        rule: "maxDaysBeforeTwoDaysOff",
        words: `${ordinal(workedDates.size)} day of work without 48 hours free from all duty.`,
        citation: cite(twoDaysOff),
      });
    }
  }

  // Shift length: 14 hours, or 12 for a shift starting after 12 noon (Perth time).
  for (const row of worked) {
    const length = hoursBetween(row.startsAt, row.endsAt);
    // Compared to the second: 12:00:30 is after noon, 12:00:00 is not.
    const perthMs = (((Date.parse(row.startsAt) + PERTH_OFFSET_MS) % 86_400_000) + 86_400_000) % 86_400_000;
    const afterNoon = perthMs > 12 * HOUR_MS;
    const rule = afterNoon ? rules.maxShiftHoursAfterNoon : rules.maxShiftHours;
    if (length > rule.hours) {
      warnings.push({
        shiftId: row.id,
        rule: afterNoon ? "maxShiftHoursAfterNoon" : "maxShiftHours",
        words: `This shift is ${hoursWords(length)} hours long${afterNoon ? " and starts after 12 noon" : ""}.`,
        citation: cite(rule),
        ...(afterNoon ? { exception: cite(rules.maxShiftHoursAfterNoon.exception) } : {}),
      });
    }
  }

  // Nights: four in a row normally; a fifth only when the five total no more than fifty hours.
  const nights = worked.filter((row) => row.kind === "night");
  const position = runPositions(nights);
  // A run is keyed by the Perth date of its first night.
  const runByFirstNight = new Map<string, RosterAssignment[]>();
  for (const row of nights) {
    const first = addDaysToDate(perthDateOf(row.startsAt), 1 - (position.get(row.id) ?? 1));
    runByFirstNight.set(first, [...(runByFirstNight.get(first) ?? []), row]);
  }
  const runs = [...runByFirstNight.values()];
  const nightRule = rules.maxNightsInRow;
  for (const run of runs) {
    // Several rows on one Perth date share a position; count nights by date.
    const byNight = new Map<number, RosterAssignment[]>();
    for (const row of run) {
      const n = position.get(row.id) ?? 1;
      byNight.set(n, [...(byNight.get(n) ?? []), row]);
    }
    const firstFiveHours = [...byNight.entries()]
      .filter(([n]) => n <= nightRule.exception.nights)
      .flatMap(([, list]) => list)
      .reduce((sum, row) => sum + hoursBetween(row.startsAt, row.endsAt), 0);
    for (const [n, list] of byNight) {
      const fifthAllowed = n === nightRule.exception.nights && firstFiveHours <= nightRule.exception.maxTotalHours;
      if (n <= nightRule.nights || fifthAllowed) continue;
      const words =
        n === nightRule.exception.nights
          ? `5th night in a row, with ${hoursWords(firstFiveHours)} rostered hours across the five.`
          : `${ordinal(n)} night in a row.`;
      warnings.push({
        shiftId: list[0]!.id,
        rule: "maxNightsInRow",
        words,
        citation: cite(nightRule),
        exception: { clause: nightRule.clause, quote: nightRule.exception.quote },
      });
    }

    // Rest after the run: free from all duty, including on call, until the next duty starts.
    const length = byNight.size;
    const band = rules.restAfterNights.bands.find((candidate) => length <= candidate.upToNights);
    if (!band) continue;
    const lastEnd = Math.max(...run.map((row) => Date.parse(row.endsAt)));
    // The first other duty still running at or after the run's end; one that began earlier and
    // overlaps the end of the last night leaves no free time at all.
    const next = duty.find((row) => Date.parse(row.endsAt) > lastEnd && !run.includes(row));
    if (!next) continue;
    const free = Math.max(0, (Date.parse(next.startsAt) - lastEnd) / HOUR_MS);
    if (free < band.hours) {
      warnings.push({
        shiftId: next.id,
        rule: "restAfterNights",
        words: `${hoursWords(free)} hours free after ${length === 1 ? "a night" : `${length} nights in a row`} before this ${next.kind === "on_call" ? "on call" : "shift"}.`,
        citation: {
          clause: rules.restAfterNights.clause,
          quote: `${rules.restAfterNights.leadIn} … ${band.quote} … ${rules.restAfterNights.caveat}`,
        },
      });
    }
  }

  const startMsByShiftId = new Map(rows.map((row) => [row.id, Date.parse(row.startsAt)]));
  return warnings.sort(
    (a, b) =>
      (startMsByShiftId.get(a.shiftId) ?? 0) - (startMsByShiftId.get(b.shiftId) ?? 0) || a.rule.localeCompare(b.rule),
  );
}

/** Fatigue warnings, or none while the rule set is unsigned or switched off. */
export function fatigueWarnings(
  shifts: readonly FatigueShift[],
  signOff: RuleSignOff = FATIGUE_RULES_SIGN_OFF,
  approvedSigners?: readonly ApprovedRuleSigner[],
  now: number = Date.now(),
): FatigueResult {
  const gate = ruleGate(signOff, FATIGUE_RULE_SET, approvedSigners, now);
  if (!gate.on) return { gate, warnings: [] };
  // Fail closed once the source's review date has passed (end of that Perth day).
  const reviewEnd = Date.parse(`${FATIGUE_RULE_SET.source.reviewBy}T00:00:00.000Z`) + 86_400_000 - PERTH_OFFSET_MS;
  if (!Number.isFinite(reviewEnd) || now >= reviewEnd) {
    return { gate: { on: false, reason: "review-date-passed" }, warnings: [] };
  }
  return { gate, warnings: fatigueWarningsUngated(shifts) };
}
