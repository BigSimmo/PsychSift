import type { CpdCoachingResult } from "@/lib/cme/category-coaching";
import type { TodayItem } from "@/lib/today/today-item";

/**
 * CPD category coaching as Today items. Nothing while the rule set is switched off; `info` severity,
 * because the lines are neutral memory aids against the Medical Board minimums, not deadlines.
 */

/** Unmet Medical Board lines and any target set below the Board's minimum. */
export function cpdCoachingTodayItems(result: CpdCoachingResult, year: number): TodayItem[] {
  if (!result.gate.on || result.coaching === null) return [];
  const lines = result.coaching.lines
    .filter((line) => !line.met)
    .map((line): TodayItem => ({
      id: `cme:board-minimum:${year}:${line.id}`,
      mode: "cme",
      title: `${line.label}: ${line.hoursShort} h to go`,
      detail: `${line.hoursLogged} of ${line.hoursRequired} h logged. Medical Board standard: "${line.quote}"`,
      due: null,
      severity: "info",
      href: "/cme",
    }));
  const mismatches = result.coaching.mismatches.map((mismatch): TodayItem => ({
    id: `cme:target-below-minimum:${year}:${mismatch.id}`,
    mode: "cme",
    title: mismatch.words,
    detail: `Medical Board standard: "${mismatch.quote}"`,
    due: null,
    severity: "info",
    href: "/cme",
  }));
  return [...mismatches, ...lines];
}
