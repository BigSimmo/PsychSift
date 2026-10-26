import { addDaysToDate, perthDateOf, perthTimeOf, perthWallToIso } from "@/lib/roster/shifts/perth-time";
import type { OnCallShift } from "@/lib/roster/shifts/model";
import type { RosterAssignment, RosterGrade, RosterTeam } from "./model";

export type RosterDisplayShift = Omit<OnCallShift, "source"> & {
  readonly source: OnCallShift["source"] | "team";
  readonly serviceId?: string;
  readonly teamName?: string;
  readonly assignmentId?: string;
};
const grades: readonly [RosterGrade | null, string][] = [
  ["consultant", "Consultants"],
  ["fellow", "Fellows"],
  ["registrar", "Registrars"],
  ["resident", "Residents"],
  ["intern", "Interns"],
  ["other", "Other grades"],
  [null, "Grade not set"],
];
export function groupByGrade(assignments: readonly RosterAssignment[]) {
  return grades
    .map(([grade, label]) => ({ grade, label, assignments: assignments.filter((row) => row.grade === grade) }))
    .filter((group) => group.assignments.length);
}
/** Midnight starting `day` on the work zone's wall clock, in ms; NaN for an impossible date. */
export function zonedDayStartMs(day: string, zone?: string) {
  return Date.parse(perthWallToIso(day, "00:00", zone) ?? "");
}
/**
 * The part of a shift on `day`, in minutes from that day's midnight in the work
 * zone. The day ends at the next midnight, so a daylight-saving day is 23 or 25 hours.
 */
export function timelineSpan(assignment: RosterAssignment, day: string, zone?: string) {
  const start = zonedDayStartMs(day, zone);
  const end = zonedDayStartMs(addDaysToDate(day, 1), zone);
  const a = Date.parse(assignment.startsAt),
    b = Date.parse(assignment.endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || a >= end || b <= start) return null;
  return {
    startMinute: (Math.max(start, a) - start) / 60000,
    endMinute: (Math.min(end, b) - start) / 60000,
    label:
      a < start
        ? `to ${perthTimeOf(assignment.endsAt, zone)}`
        : b > end
          ? `from ${perthTimeOf(assignment.startsAt, zone)}`
          : `${perthTimeOf(assignment.startsAt, zone)}–${b === end ? "24:00" : perthTimeOf(assignment.endsAt, zone)}`,
  };
}
export function withMe(assignments: readonly RosterAssignment[], me: string, now: Date) {
  const mine = assignments
    .filter((row) => row.userId === me && Date.parse(row.endsAt) > now.getTime())
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, 7);
  return assignments.filter((row) =>
    mine.some(
      (own) => Date.parse(row.startsAt) < Date.parse(own.endsAt) && Date.parse(row.endsAt) > Date.parse(own.startsAt),
    ),
  );
}
export function handover(assignments: readonly RosterAssignment[], mine: RosterAssignment) {
  const candidates = assignments.filter(
    (row) =>
      row.userId !== mine.userId &&
      row.siteId === mine.siteId &&
      row.grade === mine.grade &&
      row.kind !== "leave" &&
      row.kind !== "on_call",
  );
  const name = (rows: RosterAssignment[]) => (rows.length === 1 ? rows[0].name : null);
  return {
    from: name(candidates.filter((row) => Date.parse(row.endsAt) === Date.parse(mine.startsAt))),
    to: name(candidates.filter((row) => Date.parse(row.startsAt) === Date.parse(mine.endsAt))),
  };
}
export function mergeMyShifts(
  own: readonly OnCallShift[],
  teams: readonly { team: RosterTeam; assignments: readonly RosterAssignment[] }[],
  actorId: string,
): RosterDisplayShift[] {
  const teamShifts = teams
    .filter(({ team }) => team.enabled)
    .flatMap(({ team, assignments }) =>
      assignments
        .filter((row) => row.userId === actorId)
        .map((row): RosterDisplayShift => ({
          id: `team:${team.serviceId}:${row.id}`,
          assignmentId: row.id,
          serviceId: team.serviceId,
          teamName: team.name,
          startsAt: row.startsAt,
          endsAt: row.endsAt,
          kind: row.kind,
          title: row.shiftCode,
          workplace: row.siteName,
          source: "team",
          seriesId: null,
          sourceUid: null,
          location: row.siteName,
        })),
    );
  const key = (row: Pick<OnCallShift, "startsAt" | "endsAt">) =>
    `${Date.parse(row.startsAt)}:${Date.parse(row.endsAt)}`;
  const times = new Set(teamShifts.map(key));
  return [...own.filter((row) => !times.has(key(row))), ...teamShifts].sort(
    (a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt),
  );
}
export function assignmentIsOnDay(row: RosterAssignment, day: string) {
  return timelineSpan(row, day) !== null;
}
export function assignmentStartDate(row: RosterAssignment) {
  return perthDateOf(row.startsAt);
}

/** Publication replaces IDs; compare the actual duties, grouped by Perth start date. */
export function personalRosterChanges(before: readonly RosterAssignment[], after: readonly RosterAssignment[]) {
  const days = [...new Set([...before, ...after].map(assignmentStartDate))].sort();
  const signature = (row: RosterAssignment) =>
    JSON.stringify([Date.parse(row.startsAt), Date.parse(row.endsAt), row.shiftCode, row.kind, row.siteId]);
  return days.flatMap((date) => {
    const previous = before
      .filter((row) => assignmentStartDate(row) === date)
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
    const current = after
      .filter((row) => assignmentStartDate(row) === date)
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
    return JSON.stringify(previous.map(signature).sort()) === JSON.stringify(current.map(signature).sort())
      ? []
      : [{ date, before: previous, after: current }];
  });
}
