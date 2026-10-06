import { fatigueWarnings, type FatigueShift } from "@/lib/roster/fatigue-rules";
import { FATIGUE_RULE_SET } from "@/lib/roster/fatigue-rules-source";
import { isWorkedKind } from "@/lib/roster/shift-kind";
import { addDaysToDate, perthDateOf } from "@/lib/roster/shifts/perth-time";

import type { OpenShiftListing } from "./model";

/**
 * My shifts: the open shifts the reader has asked for, and an "at least"
 * hours meter for the busiest 14 days ahead.
 *
 * Every figure is "at least": the meter counts only what PsychSift holds (the
 * reader's own roster plus the open shifts they asked for), never work
 * elsewhere.
 */

export type MineGroups = {
  /** Asked for and waiting on the roster manager. */
  readonly requested: readonly OpenShiftListing[];
  /** Approved and not yet finished. */
  readonly booked: readonly OpenShiftListing[];
  /** Asked for, then cancelled by the team before it was worked. */
  readonly cancelled: readonly OpenShiftListing[];
};

const byStart = (a: { startsAt: string }, b: { startsAt: string }) => Date.parse(a.startsAt) - Date.parse(b.startsAt);

export function groupMine(listings: readonly OpenShiftListing[], now: Date): MineGroups {
  const mine = listings.filter((row) => row.claimedByMe);
  const notEnded = (row: OpenShiftListing) => Date.parse(row.endsAt) > now.getTime();
  return {
    requested: mine.filter((row) => row.status === "claimed" && notEnded(row)).sort(byStart),
    booked: mine.filter((row) => row.status === "approved" && notEnded(row)).sort(byStart),
    cancelled: mine.filter((row) => row.status === "cancelled" && notEnded(row)).sort(byStart),
  };
}

export type HoursMeter = {
  readonly from: string;
  readonly to: string;
  readonly total: number;
  readonly rostered: number;
  readonly approved: number;
  readonly requested: number;
  /** The agreement's 14-day limit, shown only while the signed fatigue rules are on. */
  readonly limit: number | null;
};

const HOUR_MS = 3_600_000;
const round = (hours: number) => Math.round(hours * 10) / 10;

function hoursInside(row: { startsAt: string; endsAt: string }, fromMs: number, toMs: number): number {
  const start = Math.max(Date.parse(row.startsAt), fromMs);
  const end = Math.min(Date.parse(row.endsAt), toMs);
  return end > start ? (end - start) / HOUR_MS : 0;
}

const perthMidnight = (date: string) => Date.parse(`${date}T00:00:00+08:00`);

/**
 * The busiest 14 consecutive days among the windows that start today or in
 * the next 13 days. An approved open shift that already sits on the reader's
 * roster is counted once, as rostered.
 */
export function hoursMeter(
  roster: readonly FatigueShift[],
  listings: readonly OpenShiftListing[],
  now: Date,
  gateOn: boolean = fatigueWarnings([], undefined, undefined, now.getTime()).gate.on,
): HoursMeter {
  const worked = roster.filter((shift) => isWorkedKind(shift.kind));
  // Once approved, the shift becomes a team roster shift with the same times; count that copy once.
  const onRoster = (row: OpenShiftListing) =>
    worked.some(
      (shift) =>
        Math.abs(Date.parse(shift.startsAt) - Date.parse(row.startsAt)) < 60_000 &&
        Math.abs(Date.parse(shift.endsAt) - Date.parse(row.endsAt)) < 60_000,
    );
  const approved = listings.filter((row) => row.claimedByMe && row.status === "approved" && !onRoster(row));
  // A request still undecided after its shift ended was never worked, so it no longer counts.
  const requested = listings.filter(
    (row) => row.claimedByMe && row.status === "claimed" && Date.parse(row.endsAt) > now.getTime(),
  );

  const today = perthDateOf(now);
  let best: HoursMeter | null = null;
  for (let offset = 0; offset < 14; offset += 1) {
    const from = addDaysToDate(today, offset);
    const to = addDaysToDate(from, 13);
    const fromMs = perthMidnight(from);
    const toMs = perthMidnight(addDaysToDate(to, 1));
    const sum = (rows: readonly { startsAt: string; endsAt: string }[]) =>
      rows.reduce((total, row) => total + hoursInside(row, fromMs, toMs), 0);
    const r = sum(worked);
    const a = sum(approved);
    const q = sum(requested);
    if (!best || r + a + q > best.total) {
      best = {
        from,
        to,
        total: round(r + a + q),
        rostered: round(r),
        approved: round(a),
        requested: round(q),
        limit: gateOn ? FATIGUE_RULE_SET.rules.maxHours14d.hours : null,
      };
    }
  }
  return best!;
}
