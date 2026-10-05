import type { ApprovedRuleSigner, RuleSignOff } from "@/lib/admin/rule-sign-off";
import { fatigueWarnings, type FatigueShift, type FatigueWarning } from "@/lib/roster/fatigue-rules";
import { FATIGUE_RULE_SET, FATIGUE_RULES_SIGN_OFF } from "@/lib/roster/fatigue-rules-source";
import { myShiftsAsAssignments } from "@/lib/roster/rest-cues";
import { isWorkedKind } from "@/lib/roster/shift-kind";
import { PERTH_OFFSET_MS, addDaysToDate, perthDateOf } from "@/lib/roster/shifts/perth-time";
import { hoursInWindow, restBefore, runPositions } from "@/lib/roster/team/rule-flags";
import type { RosterAssignment } from "@/lib/roster/team/model";

/**
 * Hours and rest: the next 14 days of the doctor's own roster measured against the signed fatigue
 * limits (`fatigue-rules-source.ts`). It shows the measured figure beside each limit, so the doctor
 * can see how close a roster comes, not only where it crosses.
 *
 * Every figure is measured exactly as `fatigueWarnings` measures it, from the same helpers, so a
 * gauge past its limit always has a matching warning: 7 and 14 day hours look back from the end of
 * each shift (`hoursInWindow`), breaks are `restBefore` between worked shifts, and night runs are
 * `runPositions` over the whole roster, so a run that began before the window still counts.
 * Leave and on call from home are not worked time. No new rule and no new number lives here.
 *
 * Off, with nothing measured, while the signed rule set is off.
 */

export type HoursRestGauge = {
  readonly rule: "maxHours7d" | "maxHours14d" | "maxShiftHours" | "maxShiftHoursAfterNoon" | "maxNightsInRow";
  readonly value: number;
  readonly limit: number;
  readonly unit: "hours" | "nights";
  readonly clause: string;
};

export type HoursRestBreak = {
  /** The shift the break ends at. */
  readonly shiftId: string;
  /** Perth dates of the shift before and the shift after. */
  readonly fromDate: string;
  readonly toDate: string;
  readonly hours: number;
};

export type HoursRestCheck =
  | { readonly on: false }
  | {
      readonly on: true;
      /** Perth dates, inclusive: today and the 13 days after. */
      readonly start: string;
      readonly end: string;
      readonly gauges: readonly HoursRestGauge[];
      readonly minBreakHours: number;
      readonly breaks: readonly HoursRestBreak[];
      /** The signed warnings for shifts starting in the window. */
      readonly warnings: readonly FatigueWarning[];
    };

const HOUR_MS = 3_600_000;
const rules = FATIGUE_RULE_SET.rules;

function round(hours: number): number {
  return Math.round(hours * 10) / 10;
}

const byStart = (a: RosterAssignment, b: RosterAssignment) =>
  Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id.localeCompare(b.id);

function startsAfterNoon(startsAt: string): boolean {
  const perthMs = (((Date.parse(startsAt) + PERTH_OFFSET_MS) % 86_400_000) + 86_400_000) % 86_400_000;
  return perthMs > 12 * HOUR_MS;
}

export function hoursRestCheck(
  shifts: readonly FatigueShift[],
  now: Date,
  signOff: RuleSignOff = FATIGUE_RULES_SIGN_OFF,
  approvedSigners?: readonly ApprovedRuleSigner[],
): HoursRestCheck {
  const signed = fatigueWarnings(shifts, signOff, approvedSigners, now.getTime());
  if (!signed.gate.on) return { on: false };

  const start = perthDateOf(now);
  const end = addDaysToDate(start, 13);
  const inWindow = (row: { startsAt: string }) => {
    const date = perthDateOf(row.startsAt);
    return date >= start && date <= end;
  };

  const rows = myShiftsAsAssignments(shifts.map((shift) => ({ ...shift, title: "" })));
  const worked = rows.filter((row) => isWorkedKind(row.kind)).sort(byStart);
  const ahead = worked.filter(inWindow);

  const most = (days: number) => round(Math.max(0, ...ahead.map((row) => hoursInWindow(worked, row, days))));

  // The shift closest to its own limit: 12 hours for one starting after noon, otherwise 14.
  let shift: { length: number; afterNoon: boolean } = { length: 0, afterNoon: false };
  for (const row of ahead) {
    const length = (Date.parse(row.endsAt) - Date.parse(row.startsAt)) / HOUR_MS;
    const afterNoon = startsAfterNoon(row.startsAt);
    const limit = afterNoon ? rules.maxShiftHoursAfterNoon.hours : rules.maxShiftHours.hours;
    const current = shift.afterNoon ? rules.maxShiftHoursAfterNoon.hours : rules.maxShiftHours.hours;
    if (length / limit > shift.length / current) shift = { length, afterNoon };
  }
  const shiftRule = shift.afterNoon ? rules.maxShiftHoursAfterNoon : rules.maxShiftHours;

  const nights = worked.filter((row) => row.kind === "night");
  const position = runPositions(nights);
  const nightsInRow = Math.max(0, ...nights.filter(inWindow).map((row) => position.get(row.id) ?? 1));

  const breaks: HoursRestBreak[] = [];
  for (const row of ahead) {
    const rest = restBefore(worked, row);
    if (rest === null) continue;
    const startMs = Date.parse(row.startsAt);
    const before = worked
      .filter((other) => Date.parse(other.endsAt) <= startMs)
      .reduce<RosterAssignment | null>(
        (latest, other) => (!latest || Date.parse(other.endsAt) > Date.parse(latest.endsAt) ? other : latest),
        null,
      );
    breaks.push({
      shiftId: row.id,
      fromDate: before ? perthDateOf(before.startsAt) : perthDateOf(row.startsAt),
      toDate: perthDateOf(row.startsAt),
      hours: round(rest),
    });
  }

  const aheadIds = new Set(rows.filter(inWindow).map((row) => row.id));

  return {
    on: true,
    start,
    end,
    gauges: [
      {
        rule: "maxHours7d",
        value: most(7),
        limit: rules.maxHours7d.hours,
        unit: "hours",
        clause: rules.maxHours7d.clause,
      },
      {
        rule: "maxHours14d",
        value: most(14),
        limit: rules.maxHours14d.hours,
        unit: "hours",
        clause: rules.maxHours14d.clause,
      },
      {
        rule: shift.afterNoon ? "maxShiftHoursAfterNoon" : "maxShiftHours",
        value: round(shift.length),
        limit: shiftRule.hours,
        unit: "hours",
        clause: shiftRule.clause,
      },
      {
        rule: "maxNightsInRow",
        value: nightsInRow,
        limit: rules.maxNightsInRow.nights,
        unit: "nights",
        clause: rules.maxNightsInRow.clause,
      },
    ],
    minBreakHours: rules.minBreakHours.hours,
    breaks,
    warnings: signed.warnings.filter((warning) => aheadIds.has(warning.shiftId)),
  };
}
