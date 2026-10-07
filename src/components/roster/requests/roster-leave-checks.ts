import { addDaysToDate, perthDateOf } from "@/lib/roster/shifts/perth-time";
import type { ShiftKind } from "@/lib/roster/shift-kind";

/**
 * The Plan leave sheet's "Checks" (mockup `rost_leaveSheet`, work-mode
 * redesign 6 Oct 2026): which of your team shifts the leave clashes with, and
 * your first team shift back. Computed only from the team roster the
 * Requests page already read, and honest about where that read stops: past
 * `loadedTo` nothing is claimed, so a clash count becomes a minimum and a
 * missing first shift back says the roster isn't loaded that far.
 */

export type LeaveCheckShift = {
  readonly id: string;
  readonly userId: string | null;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly kind: ShiftKind;
};

export type LeaveChecks = {
  /** Your working team shifts that touch a leave day, earliest first. */
  readonly clashes: readonly LeaveCheckShift[];
  /** True when the leave runs past the loaded roster, so `clashes` is a minimum. */
  readonly clashesPartial: boolean;
  /** Your first working team shift starting after the leave, if loaded. */
  readonly firstBack: LeaveCheckShift | null;
  /** "loaded": `firstBack` is the answer (null means none by `loadedTo`). "beyond": not loaded that far. */
  readonly firstBackState: "loaded" | "beyond";
};

export function leaveChecks(
  assignments: readonly LeaveCheckShift[],
  actorId: string,
  startsOn: string,
  endsOn: string,
  loadedTo: string,
): LeaveChecks {
  const mine = assignments
    .filter((shift) => shift.userId === actorId && shift.kind !== "leave")
    .slice()
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const clashes = mine.filter(
    (shift) => perthDateOf(shift.startsAt) <= endsOn && perthDateOf(shift.endsAt) >= startsOn,
  );
  const firstBack = mine.find((shift) => perthDateOf(shift.startsAt) > endsOn) ?? null;
  return {
    clashes,
    clashesPartial: endsOn > loadedTo,
    firstBack,
    firstBackState: firstBack || addDaysToDate(endsOn, 1) <= loadedTo ? "loaded" : "beyond",
  };
}

/** "Thu 22, Fri 23" up to four days, then "and 3 more". */
export function clashDayWords(days: readonly string[], dayWords: (date: string) => string): string {
  const unique = [...new Set(days)];
  const shown = unique.slice(0, 4).map(dayWords).join(", ");
  return unique.length > 4 ? `${shown} and ${unique.length - 4} more` : shown;
}
