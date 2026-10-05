"use client";

import { Clock, Moon, TriangleAlert } from "lucide-react";
import { useMemo } from "react";

import { SHIFT_KIND_LABEL } from "@/lib/roster/shift-kind";
import { FATIGUE_RULE_SET } from "@/lib/roster/fatigue-rules-source";
import { hoursRestCheck } from "@/lib/roster/hours-rest-check";
import { formatSpanUntil, longestRecentNightRun, type OverviewShift } from "@/lib/roster/shifts-overview";
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

function toOverview(shift: OnCallShift): OverviewShift {
  return {
    id: shift.id,
    startsAt: shift.startsAt,
    endsAt: shift.endsAt,
    kind: kindOf(shift),
    place: shift.workplace ?? shift.location,
  };
}

function useCheck(shifts: readonly OnCallShift[], now: Date) {
  return useMemo(() => hoursRestCheck(shifts.map(toOverview), now), [shifts, now]);
}

const REST_RULE = FATIGUE_RULE_SET.rules.restAfterNights;
/** The most nights in a row the signed rest rule has a band for. */
const COVERED_NIGHTS = REST_RULE.bands[REST_RULE.bands.length - 1]!.upToNights;
const NIGHTS_UNCHECKED = `Rest after more than ${COVERED_NIGHTS} nights in a row isn't checked`;

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
  const longRun = useMemo(() => longestRecentNightRun(shifts.map(toOverview), now), [shifts, now]) > COVERED_NIGHTS;

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
        title={partial || longRun ? "Hours and rest: part checked" : "Hours and rest"}
        sub={
          partial
            ? "Only part of your roster loaded, so a warning could be missing"
            : longRun
              ? NIGHTS_UNCHECKED
              : "No warnings in the next 14 days"
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
      sub={`${day}${trimStop(first.words)}${count > 1 ? `, and ${count - 1} more` : ""}${longRun ? `. ${NIGHTS_UNCHECKED}` : ""}`}
      testId="roster-hours-row"
    />
  );
}

/** Shifts in start order, ties by id, as the signed check orders them. */
const byStart = (a: OverviewShift, b: OverviewShift) =>
  Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id.localeCompare(b.id);

/**
 * The night run `shift` belongs to, by Perth start date as the signed check
 * groups it: every night row in the run, how many nights it is, and whether
 * `shift` falls on its last night.
 */
function nightRun(
  shifts: readonly OverviewShift[],
  shift: OverviewShift,
): { readonly rows: readonly OverviewShift[]; readonly length: number; readonly last: boolean } {
  const nights = shifts.filter((item) => item.kind === "night");
  const dates = new Set(nights.map((item) => perthDateOf(item.startsAt)));
  const own = perthDateOf(shift.startsAt);
  let first = own;
  while (dates.has(addDaysToDate(first, -1))) first = addDaysToDate(first, -1);
  let last = own;
  while (dates.has(addDaysToDate(last, 1))) last = addDaysToDate(last, 1);
  const rows = nights.filter((item) => {
    const date = perthDateOf(item.startsAt);
    return date >= first && date <= last;
  });
  return { rows, length: new Set(rows.map((item) => perthDateOf(item.startsAt))).size, last: own === last };
}

/**
 * Under the last night of a run, on now: how long after the run ends the next
 * duty starts, with the exact words of clause 15(6)(g). It follows the signed
 * check: the band by nights in the run, measured from the latest end in the
 * run, the next duty that is not one of the run's nights, and a duty that
 * overlaps the end leaves no free time. When the signed check warns about this
 * rest, the note is amber and says it is under the band. A run longer than the
 * bands cover says its rest is not checked. Hidden while the rules are off,
 * while only part of the roster loaded (an earlier duty could be missing), and
 * when the roster holds no next duty.
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
  const overview = useMemo(() => shifts.map(toOverview), [shifts]);
  const self = overview.find((item) => item.id === shift.id);
  if (!check.on || partial || !self || self.kind !== "night") return null;
  const run = nightRun(overview, self);
  if (!run.last) return null;
  const band = REST_RULE.bands.find((item) => run.length <= item.upToNights);
  if (!band)
    return (
      <RosterNote icon={Moon} testId="roster-after-night-note">
        <p className="font-semibold text-[color:var(--text-heading)]">
          {NIGHTS_UNCHECKED}, because the signed rule only covers runs of up to {COVERED_NIGHTS}.
        </p>
        <p className="text-xs text-[color:var(--text-muted)]">
          Clause {REST_RULE.clause}: “{REST_RULE.leadIn} … {REST_RULE.bands.map((item) => item.quote).join(" ")} …{" "}
          {REST_RULE.caveat}”
        </p>
      </RosterNote>
    );
  const end = Math.max(...run.rows.map((item) => Date.parse(item.endsAt)));
  const next = overview
    .filter((item) => item.kind !== "leave" && !run.rows.includes(item) && Date.parse(item.endsAt) > end)
    .sort(byStart)[0];
  if (!next) return null;
  const warning = check.warnings.some((item) => item.rule === "restAfterNights" && item.shiftId === next.id);
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
        {what} starts {formatSpanUntil(free)} after {run.length === 1 ? "this shift ends" : "these nights end"}
        {warning ? `, under the ${band.hours} hours free in clause ${REST_RULE.clause}.` : "."}
      </p>
      <p className="text-xs text-[color:var(--text-muted)]">
        Clause {REST_RULE.clause}: “{REST_RULE.leadIn} … {band.quote} … {REST_RULE.caveat}”
      </p>
    </RosterNote>
  );
}
