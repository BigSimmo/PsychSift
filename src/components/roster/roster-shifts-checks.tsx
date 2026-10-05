"use client";

import { Clock, Moon, TriangleAlert } from "lucide-react";
import { useMemo } from "react";

import { SHIFT_KIND_LABEL } from "@/lib/roster/shift-kind";
import { FATIGUE_RULE_SET } from "@/lib/roster/fatigue-rules-source";
import { hoursRestCheck } from "@/lib/roster/hours-rest-check";
import { formatSpanUntil, type OverviewShift } from "@/lib/roster/shifts-overview";
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
        sub="Until the rules are signed off"
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

/** The night run `shift` belongs to, as Perth start dates, and whether `shift` is its last night. */
function nightRun(
  shifts: readonly OverviewShift[],
  shift: OverviewShift,
): { readonly length: number; readonly last: boolean } {
  const nightDates = new Set(shifts.filter((item) => item.kind === "night").map((item) => perthDateOf(item.startsAt)));
  const own = perthDateOf(shift.startsAt);
  let length = 1;
  for (let date = addDaysToDate(own, -1); nightDates.has(date); date = addDaysToDate(date, -1)) length += 1;
  return { length, last: !nightDates.has(addDaysToDate(own, 1)) };
}

/**
 * Under the last night of a run, on now: how long after it ends the next duty
 * starts, with the exact words of clause 15(6)(g). It follows the signed check:
 * the band by nights in the run, no note for a run the bands do not cover, and
 * a duty that overlaps the end of the night leaves no free time. When the
 * signed check warns about this rest, the note shows that warning. Hidden while
 * the rules are off, while only part of the roster loaded (an earlier duty
 * could be missing), and when the roster holds no next duty.
 */
export function RosterAfterNightNote({
  shifts,
  shift,
  now,
  partial,
}: {
  readonly shifts: readonly OnCallShift[];
  readonly shift: OnCallShift;
  readonly now: Date;
  readonly partial: boolean;
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
  if (!check.on || partial || !self || self.kind !== "night") return null;
  const run = nightRun(overview, self);
  if (!run.last) return null;
  const rule = FATIGUE_RULE_SET.rules.restAfterNights;
  const band = rule.bands.find((item) => run.length <= item.upToNights);
  if (!band) return null;
  const end = Date.parse(self.endsAt);
  const next = overview
    .filter((item) => item.id !== self.id && item.kind !== "leave" && Date.parse(item.endsAt) > end)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];
  if (!next) return null;
  const warning = check.warnings.find((item) => item.rule === "restAfterNights" && item.shiftId === next.id);
  const free = Math.max(0, Date.parse(next.startsAt) - end);
  const what =
    next.kind === "on_call" ? "Your on call" : `Your next ${SHIFT_KIND_LABEL[next.kind].toLowerCase()} shift`;
  return (
    <RosterNote
      icon={warning ? TriangleAlert : Moon}
      tone={warning ? "warning" : "neutral"}
      testId="roster-after-night-note"
    >
      <p className="font-semibold text-[color:var(--text-heading)]">
        {warning ? trimStop(warning.words) + "." : `${what} starts ${formatSpanUntil(free)} after this shift ends.`}
      </p>
      <p className="text-xs text-[color:var(--text-muted)]">
        Clause {rule.clause}: “{rule.leadIn} … {band.quote} … {rule.caveat}”
      </p>
    </RosterNote>
  );
}
