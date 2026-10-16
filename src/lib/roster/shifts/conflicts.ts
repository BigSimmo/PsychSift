import { shiftSnapshot, type OnCallShiftInput, type OnCallShiftSnapshot } from "@/lib/roster/shifts/model";

export type OwnShiftConflict = {
  readonly first: OnCallShiftSnapshot;
  readonly second: OnCallShiftSnapshot;
};

/**
 * Detect overlapping own-shift intervals in a roster or manual shift list.
 *
 * Two shifts conflict when both have valid timestamps (`end > start`) and their
 * intervals strictly overlap (`startA < endB && startB < endA`). Back-to-back
 * adjacency (`endA === startB`) is not a conflict. Results are deterministically
 * ordered by start time.
 */
export function detectOwnConflicts(shifts: readonly OnCallShiftInput[]): OwnShiftConflict[] {
  const parsed: Array<{
    readonly shift: OnCallShiftInput;
    readonly start: number;
    readonly end: number;
    readonly index: number;
  }> = [];

  shifts.forEach((shift, index) => {
    const start = Date.parse(shift.startsAt);
    const end = Date.parse(shift.endsAt);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      parsed.push({ shift, start, end, index });
    }
  });

  parsed.sort((a, b) => a.start - b.start || a.end - b.end || a.index - b.index);

  const conflicts: OwnShiftConflict[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const a = parsed[i]!;
    for (let j = i + 1; j < parsed.length; j++) {
      const b = parsed[j]!;
      if (b.start >= a.end) break;
      if (a.start < b.end && b.start < a.end) {
        conflicts.push({
          first: shiftSnapshot(a.shift),
          second: shiftSnapshot(b.shift),
        });
      }
    }
  }
  return conflicts;
}
