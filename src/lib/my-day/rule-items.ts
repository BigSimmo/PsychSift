import { ruleGate } from "@/lib/admin/rule-sign-off";
import { fatigueTodayItems } from "@/lib/admin/today-rule-items";
import { cpdCategoryCoaching } from "@/lib/cme/category-coaching";
import { CPD_CATEGORY_RULE_SET, CPD_CATEGORY_RULES_SIGN_OFF } from "@/lib/cme/category-rules-source";
import { cpdCoachingTodayItems } from "@/lib/cme/coaching-today-items";
import type { CmeEntry, CmeRequirementSet } from "@/lib/cme/types";
import type { MyDayItem } from "@/lib/my-day/model";
import { fatigueWarnings, type FatigueShift } from "@/lib/roster/fatigue-rules";
import { inferShiftKind, type ShiftKind } from "@/lib/roster/shift-kind";
import { perthDateOf } from "@/lib/roster/shifts/perth-time";

/**
 * The signed Today rule engines, as My Day items. Each returns nothing while its engine is switched
 * off (unsigned, or its sign-off no longer matches), so My Day shows these only once the owner has
 * signed them with `npm run rules:sign`.
 *
 * - Roster fatigue warnings: the reader's own shifts, warnings on shifts starting today or later.
 * - CPD category coaching: the confirmed year's targets and activities, unmet Medical Board lines.
 *
 * Mental Health Act countdowns have no My Day source yet: nothing records an order to count from.
 */

/** Whether each engine is on now; a caller skips the extra read for an engine that is off. */
export function ruleEnginesOn(now: Date): { readonly fatigue: boolean; readonly cpd: boolean } {
  return {
    fatigue: fatigueWarnings([], undefined, undefined, now.getTime()).gate.on,
    cpd: ruleGate(CPD_CATEGORY_RULES_SIGN_OFF, CPD_CATEGORY_RULE_SET, undefined, now.getTime()).on,
  };
}

/** One of the reader's shifts as the roster reads return it; `kind` may be unset on older rows. */
export type MyDayRuleShift = {
  readonly id: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly title: string;
  readonly kind?: ShiftKind | null;
};

export function fatigueMyDayItems(shifts: readonly MyDayRuleShift[], now: Date): MyDayItem[] {
  const fatigue: FatigueShift[] = shifts.map((shift) => ({
    id: shift.id,
    startsAt: shift.startsAt,
    endsAt: shift.endsAt,
    kind: shift.kind ?? inferShiftKind(shift),
  }));
  const result = fatigueWarnings(fatigue, undefined, undefined, now.getTime());
  if (!result.gate.on) return [];
  const today = perthDateOf(now);
  const starts = new Map(shifts.map((shift) => [shift.id, shift.startsAt]));
  const upcoming = {
    gate: result.gate,
    warnings: result.warnings.filter((warning) => perthDateOf(starts.get(warning.shiftId) ?? "") >= today),
  };
  return fatigueTodayItems(upcoming, starts).map((item) => ({ ...item, mode: "roster" }));
}

export function cpdCoachingMyDayItems(
  set: CmeRequirementSet | null,
  entries: readonly CmeEntry[],
  now: Date,
): MyDayItem[] {
  if (!set || set.closedAt) return [];
  const result = cpdCategoryCoaching(set, entries, undefined, undefined, now.getTime());
  return cpdCoachingTodayItems(result, set.year).map((item) => ({ ...item, mode: "cme" }));
}
