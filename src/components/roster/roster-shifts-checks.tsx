"use client";

import { Clock, Moon, TriangleAlert } from "lucide-react";
import { useMemo } from "react";

import { SHIFT_KIND_LABEL } from "@/lib/roster/shift-kind";
import { FATIGUE_RULE_SET } from "@/lib/roster/fatigue-rules-source";
import { hoursRestCheck } from "@/lib/roster/hours-rest-check";
import { formatSpanUntil, hoursUntilNextDuty, type OverviewShift } from "@/lib/roster/shifts-overview";
import { addDaysToDate, formatPerthDay, perthDateOf } from "@/lib/roster/shifts/perth-time";
import type { RosterDisplayShift as OnCallShift } from "@/lib/roster/team/team-view";

import { kindOf } from "./roster-format";
import { RosterIconLead, RosterNote, RosterRow } from "./roster-list";

/**
 * The signed hours-and-rest pieces Shifts shows, kept in their own chunk so
 * the rules and their quotes download after the page itself: the row that
 * opens Hours & rest, and the note under a night shift about rest after nights.
 * Neutral words only: what the roster shows and the clause, never a verdict.
 */

function useCheck(shifts: readonly OnCallShift[], now: Date) {
  return useMemo(
    () =>
      hoursRestCheck(
        shifts.map((shift) => ({ id: shift.id, startsAt: shift.startsAt, endsAt: shift.endsAt, kind: kindOf(shift) })),
        now,
      ),
    [shifts, now],
  );
}

/** "9.5 hours' break before this shift." → "9.5 hours' break before this shift" */
function trimStop(words: string): string {
  return words.replace(/\.$/, "");
}

export function RosterHoursRow({
  shifts,
  now,
  partial,
  href,
}: {
  readonly shifts: readonly OnCallShift[];
  readonly now: Date;
  readonly partial: boolean;
  readonly href: string;
}) {
  const check = useCheck(shifts, now);
  const startsAt = useMemo(() => new Map(shifts.map((shift) => [shift.id, shift.startsAt])), [shifts]);

  if (!check.on)
    return (
      <RosterRow
        href={href}
        lead={<RosterIconLead icon={Clock} />}
        title="Hours and rest: checks off"
        sub="Until the rules are signed off again"
        testId="roster-hours-row"
      />
    );
  const count = check.warnings.length;
  if (count === 0)
    return (
      <RosterRow
        href={href}
        lead={<RosterIconLead icon={Clock} />}
        title={partial ? "Hours and rest: part checked" : "Hours and rest"}
        sub={
          partial ? "Only part of your roster loaded, so a warning could be missing" : "No warnings in the next 14 days"
        }
        testId="roster-hours-row"
      />
    );
  const first = check.warnings[0]!;
  const day = startsAt.has(first.shiftId) ? `${formatPerthDay(perthDateOf(startsAt.get(first.shiftId)!))} · ` : "";
  return (
    <RosterRow
      href={href}
      tone="warning"
      lead={<RosterIconLead icon={TriangleAlert} tone="warning" />}
      title={`Hours and rest: ${count} ${count === 1 ? "warning" : "warnings"}${partial ? " or more" : ""}`}
      sub={`${day}${trimStop(first.words)}${count > 1 ? `, and ${count - 1} more` : ""}`}
      testId="roster-hours-row"
    />
  );
}

/** How many nights in a row end with `shift`, counting back one Perth day at a time. */
function nightsInRow(shifts: readonly OverviewShift[], shift: OverviewShift): number {
  const nightDates = new Set(shifts.filter((item) => item.kind === "night").map((item) => perthDateOf(item.startsAt)));
  let count = 1;
  let date = addDaysToDate(perthDateOf(shift.startsAt), -1);
  while (nightDates.has(date)) {
    count += 1;
    date = addDaysToDate(date, -1);
  }
  return count;
}

/**
 * Under a night shift on now: how long after it ends the next duty starts,
 * with the exact words of clause 15(6)(g). Shown only while the signed rules
 * are on, and only when the roster holds a next duty.
 */
export function RosterAfterNightNote({
  shifts,
  shift,
  now,
}: {
  readonly shifts: readonly OnCallShift[];
  readonly shift: OnCallShift;
  readonly now: Date;
}) {
  const check = useCheck(shifts, now);
  const overview = useMemo(
    () =>
      shifts.map((item) => ({
        id: item.id,
        startsAt: item.startsAt,
        endsAt: item.endsAt,
        kind: kindOf(item),
        place: item.workplace ?? item.location,
      })),
    [shifts],
  );
  const self = overview.find((item) => item.id === shift.id);
  if (!check.on || !self || self.kind !== "night") return null;
  const next = hoursUntilNextDuty(overview, self);
  if (!next) return null;
  const rule = FATIGUE_RULE_SET.rules.restAfterNights;
  const run = nightsInRow(overview, self);
  const band = rule.bands.find((item) => run <= item.upToNights) ?? rule.bands[rule.bands.length - 1]!;
  const what =
    next.next.kind === "on_call" ? "Your on call" : `Your next ${SHIFT_KIND_LABEL[next.next.kind].toLowerCase()} shift`;
  return (
    <RosterNote icon={Moon} testId="roster-after-night-note">
      <p className="font-semibold text-[color:var(--text-heading)]">
        {what} starts {formatSpanUntil(next.hours * 3_600_000)} after this shift ends.
      </p>
      <p className="text-xs text-[color:var(--text-muted)]">
        Clause {rule.clause}: “{rule.leadIn} {band.quote} … {rule.caveat}”
      </p>
    </RosterNote>
  );
}
