import { withUnit } from "@/components/teaching/teaching-number";
import { inferShiftKind, type ShiftKind } from "@/lib/roster/shift-kind";

/*
 * Teaching clashes on the Week page (ideas 12; work-mode redesign, owner request 6 Oct 2026). A
 * rostered shift is the commonest reason a doctor misses teaching, so Week tags a session that
 * runs into one. Read only: the shifts come from Roster's own hook and nothing is stored or sent.
 *
 * - "Rostered": the session overlaps an evening, night or on-call shift. A day shift is not a
 *   clash: teaching is usually protected time inside the working day, so tagging it would mark
 *   nearly every session and mean nothing.
 * - "After a night": the session starts within 10 hours after a night or on-call shift ends.
 */

export type RosterClash = "Rostered" | "After a night";

type Shift = { startsAt: string; endsAt: string; title: string; kind?: ShiftKind | null };
type Session = { occurrenceId: string; startsAt: string; endsAt: string; status: string; allDay?: boolean };

const HOUR = 3_600_000;
const REST_HOURS = 10;
const CLASHING: ReadonlySet<ShiftKind> = new Set(["evening", "night", "on_call"]);
const TIRING: ReadonlySet<ShiftKind> = new Set(["night", "on_call"]);

export function rosterClashes(
  sessions: readonly Session[],
  shifts: readonly Shift[],
): ReadonlyMap<string, RosterClash> {
  const result = new Map<string, RosterClash>();
  const kinded = shifts.map((shift) => ({
    start: Date.parse(shift.startsAt),
    end: Date.parse(shift.endsAt),
    kind: shift.kind ?? inferShiftKind(shift),
  }));
  for (const session of sessions) {
    if (session.status === "cancelled" || session.allDay) continue;
    const start = Date.parse(session.startsAt);
    const end = Date.parse(session.endsAt);
    if (kinded.some((shift) => CLASHING.has(shift.kind) && shift.start < end && shift.end > start)) {
      result.set(session.occurrenceId, "Rostered");
      continue;
    }
    if (kinded.some((shift) => TIRING.has(shift.kind) && shift.end <= start && start - shift.end < REST_HOURS * HOUR))
      result.set(session.occurrenceId, "After a night");
  }
  return result;
}

/** "1 session clashes with your roster", "2 sessions clash with your roster". */
export function clashSummary(count: number): string {
  return count === 1
    ? `${withUnit(1, "session")} clashes with your roster`
    : `${withUnit(count, "sessions")} clash with your roster`;
}
