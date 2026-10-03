import type { OnCallShiftChange, OnCallShiftImportSummary, OnCallShiftSnapshot } from "@/lib/roster/shifts/model";
import { formatPerthDay, perthDateOf, perthTimeOf } from "@/lib/roster/shifts/perth-time";
import type { RosterAssignment } from "@/lib/roster/team/model";

/**
 * Roster "what changed": one line per change to the user's own shifts, for the
 * "Needs you" group on Roster Today (and, through the Today shell, My Day).
 *
 * Two sources feed it, and both already record the change on the server:
 *
 * - a re-imported personal roster (file or calendar link): the import summary
 *   keeps the before/after of every added, moved or removed shift, plus
 *   `seenAt` once the user has dismissed it;
 * - a team roster the manager republished: the `my_changes` read returns the
 *   user's own duties before and after, grouped by Perth day by
 *   `personalRosterChanges`, until the user marks that publication seen.
 *
 * This module only turns those records into plain lines. It reads nothing,
 * stores nothing and sends nothing; dismissing a line is the caller's job,
 * through the existing seen markers.
 */

export type RosterChangeNoticeSource = "import" | "team";

export type RosterChangeNotice = {
  /** Stable within one source, for React keys and test ids. */
  readonly id: string;
  readonly source: RosterChangeNoticeSource;
  /** The Perth date the change is about, `YYYY-MM-DD`. Sorted on. */
  readonly date: string;
  /** "Mon 6 Oct: moved", "Tue 7 Oct: added". */
  readonly title: string;
  /** What it was and what it is now, in words. */
  readonly detail: string;
  /** Where the user sees the whole roster. */
  readonly href: string;
};

const SHIFTS_HREF = "/roster/shifts";

/** `08:00–17:00`, with ` +1` when the shift ends on a later Perth day. */
export function formatSnapshotTimes(shift: Pick<OnCallShiftSnapshot, "startsAt" | "endsAt">): string {
  const plusOne = perthDateOf(shift.endsAt) > perthDateOf(shift.startsAt);
  return `${perthTimeOf(shift.startsAt)}–${perthTimeOf(shift.endsAt)}${plusOne ? " +1" : ""}`;
}

function describeSnapshot(shift: OnCallShiftSnapshot): string {
  const place = shift.location?.trim();
  return [shift.title.trim(), formatSnapshotTimes(shift), place].filter(Boolean).join(" · ");
}

function importChangeDate(change: OnCallShiftChange): string {
  return perthDateOf(change.kind === "removed" ? change.before.startsAt : change.after.startsAt);
}

function importNotice(change: OnCallShiftChange, index: number): RosterChangeNotice {
  const date = importChangeDate(change);
  const day = formatPerthDay(date);
  const base = { id: `import-${index}`, source: "import" as const, date, href: SHIFTS_HREF };
  if (change.kind === "added") return { ...base, title: `${day}: added`, detail: describeSnapshot(change.after) };
  if (change.kind === "removed") return { ...base, title: `${day}: removed`, detail: describeSnapshot(change.before) };
  const movedDay = perthDateOf(change.before.startsAt) !== date;
  return {
    ...base,
    title: `${day}: moved`,
    detail: `Was ${movedDay ? `${formatPerthDay(perthDateOf(change.before.startsAt))} ` : ""}${describeSnapshot(
      change.before,
    )}. Now ${describeSnapshot(change.after)}`,
  };
}

/**
 * The lines for a personal roster re-import that has not been dismissed. An
 * import already seen, or one that changed nothing, gives no lines. Changes to
 * days before `today` are left out: a shift that has been and gone needs
 * nothing from anyone.
 */
export function importChangeNotices(
  summary: Pick<OnCallShiftImportSummary, "changes" | "seenAt"> | null | undefined,
  today: string,
): RosterChangeNotice[] {
  if (!summary || summary.seenAt) return [];
  return summary.changes
    .map((change, index) => ({ change, notice: importNotice(change, index) }))
    .filter(({ change, notice }) => {
      if (notice.date >= today) return true;
      // A shift moved from a coming day into the past still frees that coming day, so it stays.
      return change.kind === "moved" && perthDateOf(change.before.startsAt) >= today;
    })
    .map(({ notice }) => notice)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** One day's own duties before and after a republish, as `personalRosterChanges` returns them. */
export type TeamDayChange = {
  readonly date: string;
  readonly before: readonly Pick<RosterAssignment, "startsAt" | "endsAt" | "shiftCode" | "siteName">[];
  readonly after: readonly Pick<RosterAssignment, "startsAt" | "endsAt" | "shiftCode" | "siteName">[];
};

function describeDuties(rows: TeamDayChange["before"]): string {
  if (rows.length === 0) return "off";
  return rows
    .map((row) =>
      [row.shiftCode, formatSnapshotTimes(row), row.siteName?.trim()].filter((part) => Boolean(part)).join(" · "),
    )
    .join(", ");
}

/**
 * The lines for a republished team roster the user has not marked seen. One
 * line per changed day, worded from the user's point of view: a day that gains
 * duties reads "added", a day that loses them all reads "now off".
 */
export function teamChangeNotices(changes: readonly TeamDayChange[], today: string): RosterChangeNotice[] {
  return changes
    .filter((change) => change.date >= today)
    .map((change) => {
      const day = formatPerthDay(change.date);
      const verb = change.before.length === 0 ? "added" : change.after.length === 0 ? "now off" : "changed";
      return {
        id: `team-${change.date}`,
        source: "team" as const,
        date: change.date,
        title: `${day}: ${verb}`,
        detail:
          change.before.length === 0
            ? describeDuties(change.after)
            : `Was ${describeDuties(change.before)}. Now ${describeDuties(change.after)}`,
        href: SHIFTS_HREF,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}
