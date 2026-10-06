import type { ApprovedRuleSigner, RuleSignOff } from "@/lib/admin/rule-sign-off";
import { fatigueWarnings, type FatigueShift, type FatigueWarning } from "@/lib/roster/fatigue-rules";
import { FATIGUE_RULE_SET, FATIGUE_RULES_SIGN_OFF } from "@/lib/roster/fatigue-rules-source";
import { isWorkedKind } from "@/lib/roster/shift-kind";
import { perthDateOf } from "@/lib/roster/shifts/perth-time";
import { hoursInWindow } from "@/lib/roster/team/rule-flags";
import { myShiftsAsAssignments } from "@/lib/roster/rest-cues";

/**
 * The roster check on a shift advert. It compares one open shift with the
 * doctor's own PsychSift roster (their imported, hand-added and team shifts)
 * and nothing else, so every figure it gives is "at least".
 *
 * - An overlap is the only thing that blocks a request, and it is checked
 *   whether or not the fatigue rules are signed: two shifts at once is a fact,
 *   not a rule.
 * - Breaks and 14-day hours come from the signed fatigue rules
 *   (`fatigueWarnings`), so nothing is measured while they are switched off:
 *   the advert then says "Clash check only".
 * - Advice only. Roster's `open.claim` and `open.approve` recheck level, and
 *   overlap with TEAM roster shifts only, in the database. Imported and
 *   hand-added shifts are checked here and nowhere else, so this check fails
 *   honest (loading, couldn't read, beyond the roster) rather than green.
 */

export type Candidate = Pick<FatigueShift, "id" | "startsAt" | "endsAt" | "kind">;

export type RosterCheck =
  /** No roster saved to compare with. */
  | { readonly state: "none" }
  /** The roster is still being read. */
  | { readonly state: "loading" }
  /** The roster couldn't be read, so nothing was checked. */
  | { readonly state: "unread" }
  /** The shift is after the last date the saved roster reaches: no overlap, but nothing else is known. */
  | { readonly state: "beyond"; readonly coveredUntil: string }
  /** The candidate overlaps a rostered shift. Blocks the request. */
  | { readonly state: "overlap"; readonly withShift: FatigueShift; readonly overlapMinutes: number }
  /** No overlap, and the fatigue rules are off: nothing else was checked. */
  | { readonly state: "clash-only"; readonly coveredUntil: string | null }
  /** No overlap, and the signed rules flag something. Never blocks. */
  | {
      readonly state: "flag";
      readonly warnings: readonly FatigueWarning[];
      readonly breakBefore: number | null;
      readonly breakAfter: number | null;
      readonly coveredUntil: string | null;
    }
  /** No overlap and nothing flagged. */
  | {
      readonly state: "ok";
      readonly breakBefore: number | null;
      readonly breakAfter: number | null;
      /** At least this many hours in the busiest 14 days that include the shift. */
      readonly busiest14d: number;
      readonly limit14d: number;
      readonly nightsBefore: boolean;
      readonly coveredUntil: string | null;
    };

const HOUR_MS = 3_600_000;

function round(hours: number): number {
  return Math.round(hours * 10) / 10;
}

/** The last Perth date the saved roster reaches; null when there is no roster. */
export function rosterCoveredUntil(shifts: readonly FatigueShift[]): string | null {
  let last: string | null = null;
  for (const shift of shifts) {
    const date = perthDateOf(shift.endsAt);
    if (!last || date > last) last = date;
  }
  return last;
}

export function rosterCheck(
  candidate: Candidate,
  roster: readonly FatigueShift[] | null,
  now: Date,
  signOff: RuleSignOff = FATIGUE_RULES_SIGN_OFF,
  approvedSigners?: readonly ApprovedRuleSigner[],
): RosterCheck {
  if (!roster || roster.length === 0) return { state: "none" };
  const start = Date.parse(candidate.startsAt);
  const end = Date.parse(candidate.endsAt);
  const coveredUntil = rosterCoveredUntil(roster);

  // Leave counts as a clash; anything rostered at the same time does.
  const overlapping = roster
    .filter((shift) => shift.id !== candidate.id)
    .filter((shift) => Date.parse(shift.startsAt) < end && Date.parse(shift.endsAt) > start)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];
  if (overlapping) {
    const minutes = Math.round(
      (Math.min(end, Date.parse(overlapping.endsAt)) - Math.max(start, Date.parse(overlapping.startsAt))) / 60_000,
    );
    return { state: "overlap", withShift: overlapping, overlapMinutes: minutes };
  }

  // Past the end of the saved roster nothing is known about breaks or hours, so say so rather than green.
  if (coveredUntil && perthDateOf(candidate.startsAt) > coveredUntil) return { state: "beyond", coveredUntil };

  const withCandidate = [...roster.filter((shift) => shift.id !== candidate.id), candidate];
  const signed = fatigueWarnings(withCandidate, signOff, approvedSigners, now.getTime());
  if (!signed.gate.on) return { state: "clash-only", coveredUntil };

  const worked = roster.filter((shift) => isWorkedKind(shift.kind));
  const before = worked
    .filter((shift) => Date.parse(shift.endsAt) <= start)
    .reduce<number | null>((latest, shift) => Math.max(latest ?? -Infinity, Date.parse(shift.endsAt)), null);
  const after = worked
    .filter((shift) => Date.parse(shift.startsAt) >= end)
    .reduce<number | null>((earliest, shift) => Math.min(earliest ?? Infinity, Date.parse(shift.startsAt)), null);
  const breakBefore = before === null ? null : round((start - before) / HOUR_MS);
  const breakAfter = after === null ? null : round((after - end) / HOUR_MS);

  // A warning on any shift the candidate changes counts: adding it can push a later shift over a limit.
  const warnings = signed.warnings.filter((warning) => {
    if (warning.shiftId === candidate.id) return true;
    const shift = withCandidate.find((row) => row.id === warning.shiftId);
    return shift ? Math.abs(Date.parse(shift.startsAt) - start) <= 14 * 24 * HOUR_MS : false;
  });
  if (warnings.length > 0) return { state: "flag", warnings, breakBefore, breakAfter, coveredUntil };

  const rows = myShiftsAsAssignments(withCandidate.map((shift) => ({ ...shift, title: "" })));
  const workedRows = rows.filter((row) => isWorkedKind(row.kind));
  const inReach = workedRows.filter((row) => Math.abs(Date.parse(row.startsAt) - start) <= 14 * 24 * HOUR_MS);
  const busiest14d = round(Math.max(0, ...inReach.map((row) => hoursInWindow(workedRows, row, 14))));
  const weekBefore = start - 7 * 24 * HOUR_MS;
  const nightsBefore = worked.some(
    (shift) => shift.kind === "night" && Date.parse(shift.startsAt) >= weekBefore && Date.parse(shift.startsAt) < start,
  );
  return {
    state: "ok",
    breakBefore,
    breakAfter,
    busiest14d,
    limit14d: FATIGUE_RULE_SET.rules.maxHours14d.hours,
    nightsBefore,
    coveredUntil,
  };
}

/** The check, or why it couldn't run: a roster that is still loading or failed is never "no roster". */
export function rosterCheckFor(
  candidate: Candidate,
  roster: readonly FatigueShift[] | null,
  rosterStatus: "loading" | "ready" | "error",
  now: Date,
): RosterCheck {
  if (rosterStatus === "loading") return { state: "loading" };
  if (rosterStatus === "error") return { state: "unread" };
  return rosterCheck(candidate, roster, now);
}

/** Whether a check hides the shift under "Hide roster clashes". Only an overlap does. */
export function isClash(check: RosterCheck): boolean {
  return check.state === "overlap";
}
