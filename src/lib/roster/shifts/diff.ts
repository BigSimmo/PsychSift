import {
  ON_CALL_SHIFT_CHANGES_MAX,
  shiftSnapshot,
  type OnCallShiftChange,
  type OnCallShiftInput,
} from "@/lib/roster/shifts/model";
import { perthDateOf } from "@/lib/roster/shifts/perth-time";

/**
 * What a new roster changes, compared with what is already stored.
 *
 * Only shifts inside the new roster's dates are compared, because only those
 * are replaced: a roster for October says nothing about November.
 *
 * Matching is by the calendar's own ID first, which survives a shift being
 * moved. Without an ID (a spreadsheet, or a calendar that does not keep them),
 * a shift is the same shift when it starts on the same Perth day with the same
 * title. A matched shift whose times or site differ is "moved"; everything
 * left over is "added" or "removed".
 */

export type OwnShiftConflict = {
  readonly first: OnCallShiftInput;
  readonly second: OnCallShiftInput;
  readonly overlapMinutes: number;
};

export type RosterDiff = {
  readonly added: number;
  readonly changed: number;
  readonly removed: number;
  /** The first lines of the change list, in date order, capped for storage. */
  readonly changes: OnCallShiftChange[];
  /** Pairs of shifts that overlap in time (`startA < endB && endA > startB`). */
  readonly conflicts: OwnShiftConflict[];
};

/**
 * Find every pair of shifts whose intervals strictly overlap (`startA < endB && endA > startB`).
 * Adjacent shifts where `endA === startB` do not conflict.
 */
export function detectOwnShiftConflicts(shifts: readonly OnCallShiftInput[]): OwnShiftConflict[] {
  const indexed = shifts
    .map((shift, index) => ({
      shift,
      index,
      startMs: Date.parse(shift.startsAt),
      endMs: Date.parse(shift.endsAt),
    }))
    .filter((item) => Number.isFinite(item.startMs) && Number.isFinite(item.endMs) && item.endMs > item.startMs)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs || a.index - b.index);

  const conflicts: OwnShiftConflict[] = [];
  for (let i = 0; i < indexed.length; i += 1) {
    const first = indexed[i]!;
    for (let j = i + 1; j < indexed.length; j += 1) {
      const second = indexed[j]!;
      if (second.startMs >= first.endMs) break;
      if (first.startMs < second.endMs && first.endMs > second.startMs) {
        const overlapMs = Math.min(first.endMs, second.endMs) - Math.max(first.startMs, second.startMs);
        const overlapMinutes = Math.round(overlapMs / 60_000);
        if (overlapMinutes > 0) {
          conflicts.push({
            first: first.shift,
            second: second.shift,
            overlapMinutes,
          });
        }
      }
    }
  }
  return conflicts;
}

/** The Perth dates a roster covers, inclusive, or null for an empty roster. */
export function rosterWindow(shifts: readonly OnCallShiftInput[]): { start: string; end: string } | null {
  if (shifts.length === 0) return null;
  let start = perthDateOf(shifts[0]!.startsAt);
  let end = start;
  for (const shift of shifts) {
    const day = perthDateOf(shift.startsAt);
    if (day < start) start = day;
    if (day > end) end = day;
  }
  return { start, end };
}

export function shiftIsInWindow(shift: OnCallShiftInput, window: { start: string; end: string }): boolean {
  const day = perthDateOf(shift.startsAt);
  return day >= window.start && day <= window.end;
}

function sameDayKey(shift: OnCallShiftInput): string {
  return `${perthDateOf(shift.startsAt)}|${shift.title.trim().toLowerCase()}`;
}

function differs(a: OnCallShiftInput, b: OnCallShiftInput): boolean {
  return (
    Date.parse(a.startsAt) !== Date.parse(b.startsAt) ||
    Date.parse(a.endsAt) !== Date.parse(b.endsAt) ||
    (a.location ?? "") !== (b.location ?? "") ||
    a.title !== b.title
  );
}

export function diffRoster(
  stored: readonly OnCallShiftInput[],
  incoming: readonly OnCallShiftInput[],
  window: { start: string; end: string } | null = rosterWindow(incoming),
): RosterDiff {
  const before = window ? stored.filter((shift) => shiftIsInWindow(shift, window)) : [...stored];
  const retainedOutsideWindow = window ? stored.filter((shift) => !shiftIsInWindow(shift, window)) : [];
  const unmatchedBefore = new Set(before.map((_, index) => index));
  const pairs: Array<{ before: OnCallShiftInput; after: OnCallShiftInput }> = [];
  const added: OnCallShiftInput[] = [];
  const unmatchedIncoming: OnCallShiftInput[] = [];

  const byUid = new Map<string, number>();
  before.forEach((shift, index) => {
    if (shift.sourceUid && !byUid.has(shift.sourceUid)) byUid.set(shift.sourceUid, index);
  });
  for (const shift of incoming) {
    const match = shift.sourceUid ? byUid.get(shift.sourceUid) : undefined;
    if (match !== undefined && unmatchedBefore.has(match)) {
      unmatchedBefore.delete(match);
      pairs.push({ before: before[match]!, after: shift });
    } else unmatchedIncoming.push(shift);
  }

  const byDay = new Map<string, number[]>();
  for (const index of unmatchedBefore) {
    const key = sameDayKey(before[index]!);
    byDay.set(key, [...(byDay.get(key) ?? []), index]);
  }
  for (const shift of unmatchedIncoming) {
    const candidates = byDay.get(sameDayKey(shift)) ?? [];
    const match = candidates.shift();
    if (match !== undefined) {
      unmatchedBefore.delete(match);
      pairs.push({ before: before[match]!, after: shift });
    } else added.push(shift);
  }

  const moved = pairs.filter((pair) => differs(pair.before, pair.after));
  const removed = [...unmatchedBefore].map((index) => before[index]!);

  const changes: Array<{ at: string; change: OnCallShiftChange }> = [
    ...added.map((shift) => ({ at: shift.startsAt, change: { kind: "added", after: shiftSnapshot(shift) } as const })),
    ...moved.map((pair) => ({
      at: pair.after.startsAt,
      change: { kind: "moved", before: shiftSnapshot(pair.before), after: shiftSnapshot(pair.after) } as const,
    })),
    ...removed.map((shift) => ({
      at: shift.startsAt,
      change: { kind: "removed", before: shiftSnapshot(shift) } as const,
    })),
  ];
  changes.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  return {
    added: added.length,
    changed: moved.length,
    removed: removed.length,
    changes: changes.slice(0, ON_CALL_SHIFT_CHANGES_MAX).map((entry) => entry.change),
    conflicts: detectOwnShiftConflicts([...retainedOutsideWindow, ...incoming]),
  };
}
