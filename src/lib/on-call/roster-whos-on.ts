import {
  addDaysToDate,
  formatPerthDay,
  perthDateOf,
  perthTimeOf,
  perthWallToIso,
} from "@/lib/roster/shifts/perth-time";
import type { RosterAssignment, RosterAssignmentKind } from "@/lib/roster/team/model";

/**
 * "From your team roster" (round 2 feature 22, who is on, kept up to date by
 * the department): On Call reads the PUBLISHED team roster, so nobody keeps a
 * second list. When the roster manager changes the roster, this changes.
 *
 * Names and shift kind only (and the shift's own times). Never a phone
 * number, a grade, a leave or sick reason: a leave row is dropped entirely, so
 * "away" is never shown. Nobody is ever guessed: a day with no rows says so.
 *
 * Pure: no React, no storage, no network. Nothing here is written to the device.
 */

export const ROSTER_WHOS_ON_HREF = "/on-call/whos-on/roster";

export const ROSTER_WHOS_ON_DAYS = ["yesterday", "today", "tomorrow"] as const;
export type RosterWhosOnDay = (typeof ROSTER_WHOS_ON_DAYS)[number];

export const ROSTER_WHOS_ON_DAY_LABELS: Readonly<Record<RosterWhosOnDay, string>> = {
  yesterday: "Yesterday",
  today: "Today",
  tomorrow: "Tomorrow",
};

export type RosterShownKind = Exclude<RosterAssignmentKind, "leave">;

export const ROSTER_KIND_LABELS: Readonly<Record<RosterShownKind, string>> = {
  day: "Day",
  evening: "Evening",
  night: "Night",
  on_call: "On call",
  other: "Shift",
};

/** The Perth date each day choice names. */
export function rosterWhosOnDate(day: RosterWhosOnDay, now: Date): string {
  const today = perthDateOf(now);
  return day === "yesterday" ? addDaysToDate(today, -1) : day === "tomorrow" ? addDaysToDate(today, 1) : today;
}

/**
 * The one read window: yesterday to the day after tomorrow, so a shift that
 * runs into a chosen day and the person after the last one are both in it.
 * Four days, well inside the 62-day limit.
 */
export function rosterWhosOnRange(now: Date): { readonly from: string; readonly to: string } {
  const today = perthDateOf(now);
  return { from: addDaysToDate(today, -1), to: addDaysToDate(today, 2) };
}

/** A Perth day as [start, end) instants. */
export function perthDayBounds(date: string): { readonly start: number; readonly end: number } | null {
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T00:00:00Z`) : Number.NaN;
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== date) return null;
  const start = perthWallToIso(date, "00:00");
  const end = perthWallToIso(addDaysToDate(date, 1), "00:00");
  if (!start || !end) return null;
  return { start: Date.parse(start), end: Date.parse(end) };
}

export type RosterWhosOnRow = {
  readonly id: string;
  /** Null when the roster carries no name for the shift: shown as "Name not on the roster", never guessed. */
  readonly name: string | null;
  readonly isMe: boolean;
  readonly kind: RosterShownKind;
  readonly kindLabel: string;
  readonly startsAt: string;
  readonly endsAt: string;
  /** "21:00 to 08:30 Wed", "08:00 to 16:30", "From Mon 21:00 to 08:30". */
  readonly span: string;
  /** On shift at `now`. */
  readonly onNow: boolean;
  /** Who starts as this shift ends, when the roster says: "Dr Patel from 08:00". */
  readonly next: { readonly name: string; readonly startsAt: string } | null;
  /** Where the shift sits on the chosen day, in percent of the day, for the time rail. */
  readonly rail: { readonly left: number; readonly width: number };
};

const HANDOVER_WINDOW_MS = 90 * 60_000;
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function weekdayOf(date: string): string {
  const ms = Date.parse(`${date}T00:00:00Z`);
  return Number.isNaN(ms) ? "" : DAY_NAMES[new Date(ms).getUTCDay()];
}

function isShown(row: RosterAssignment): row is RosterAssignment & { kind: RosterShownKind } {
  return row.kind !== "leave" && Number.isFinite(Date.parse(row.startsAt)) && Number.isFinite(Date.parse(row.endsAt));
}

/** "08:00 to 16:30", "21:00 to 08:30 Wed", "From Mon 21:00 to 08:30". */
export function rosterShiftSpan(row: Pick<RosterAssignment, "startsAt" | "endsAt">, date: string): string {
  const startDate = perthDateOf(row.startsAt);
  const endDate = perthDateOf(row.endsAt);
  const start = perthTimeOf(row.startsAt);
  const end = perthTimeOf(row.endsAt);
  // A shift ending exactly at midnight ends "24:00" on its own day, not "00:00" the next.
  const endsAtMidnight = end === "00:00" && endDate === addDaysToDate(startDate, 1);
  const endLabel = endsAtMidnight ? "midnight" : end;
  const endDay = endsAtMidnight || endDate === date ? "" : ` ${weekdayOf(endDate)}`;
  if (startDate !== date) return `From ${weekdayOf(startDate)} ${start} to ${endLabel}${endDay}`;
  return `${start} to ${endLabel}${endDay}`;
}

function nextPerson(
  row: RosterAssignment,
  all: readonly RosterAssignment[],
): { readonly name: string; readonly startsAt: string } | null {
  const end = Date.parse(row.endsAt);
  const candidates = all
    .filter(
      (other) =>
        other.id !== row.id &&
        other.kind !== "leave" &&
        other.name !== null &&
        other.userId !== row.userId &&
        Math.abs(Date.parse(other.startsAt) - end) <= HANDOVER_WINDOW_MS,
    )
    .sort(
      (a, b) =>
        Number(b.grade === row.grade) - Number(a.grade === row.grade) ||
        Number(b.kind === row.kind) - Number(a.kind === row.kind) ||
        Math.abs(Date.parse(a.startsAt) - end) - Math.abs(Date.parse(b.startsAt) - end) ||
        (a.name ?? "").localeCompare(b.name ?? ""),
    );
  const pick = candidates[0];
  return pick?.name ? { name: pick.name, startsAt: pick.startsAt } : null;
}

/**
 * Everyone on the published roster for one Perth day: anyone whose shift
 * overlaps it, leave dropped. On now first, then by start, then by name.
 */
export function rosterWhosOnRows(
  assignments: readonly RosterAssignment[],
  options: { readonly date: string; readonly now: Date; readonly actorId: string | null },
): RosterWhosOnRow[] {
  const bounds = perthDayBounds(options.date);
  if (!bounds) return [];
  const at = options.now.getTime();
  const span = bounds.end - bounds.start;
  return assignments
    .filter(isShown)
    .filter((row) => Date.parse(row.startsAt) < bounds.end && Date.parse(row.endsAt) > bounds.start)
    .map((row): RosterWhosOnRow => {
      const start = Date.parse(row.startsAt);
      const end = Date.parse(row.endsAt);
      const left = Math.max(0, ((start - bounds.start) / span) * 100);
      const right = Math.min(100, ((end - bounds.start) / span) * 100);
      return {
        id: row.id,
        name: row.name?.trim() ? row.name.trim() : null,
        isMe: options.actorId !== null && row.userId === options.actorId,
        kind: row.kind,
        kindLabel: ROSTER_KIND_LABELS[row.kind],
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        span: rosterShiftSpan(row, options.date),
        onNow: start <= at && end > at,
        next: nextPerson(row, assignments),
        rail: { left: Math.round(left * 10) / 10, width: Math.max(1, Math.round((right - left) * 10) / 10) },
      };
    })
    .sort(
      (a, b) =>
        Number(b.onNow) - Number(a.onNow) ||
        a.startsAt.localeCompare(b.startsAt) ||
        (a.name ?? "￿").localeCompare(b.name ?? "￿") ||
        a.id.localeCompare(b.id),
    );
}

/** Where "now" sits on the chosen day's rail, in percent; null on another day. */
export function rosterNowMark(date: string, now: Date): number | null {
  const bounds = perthDayBounds(date);
  if (!bounds) return null;
  const at = now.getTime();
  if (at < bounds.start || at >= bounds.end) return null;
  return Math.round(((at - bounds.start) / (bounds.end - bounds.start)) * 1000) / 10;
}

/** The rail's screen-reader text: "Dr Nguyen, night, 21:00 to 08:30 Wed, on now". */
export function rosterRailLabel(row: RosterWhosOnRow): string {
  const who = row.isMe ? "You" : (row.name ?? "Name not on the roster");
  return `${who}, ${row.kindLabel.toLowerCase()}, ${row.span}${row.onNow ? ", on now" : ""}`;
}

export type RosterPublicationSummary = {
  readonly version: number;
  readonly publishedAt: string;
  readonly periodStart: string;
  readonly periodEnd: string;
};

/**
 * Whether the chosen day is inside the latest published period. A day past
 * its end is "not published yet": nobody is shown, and nobody is guessed.
 */
export function rosterDayCoverage(
  publication: RosterPublicationSummary | null,
  date: string,
): "published" | "not-published" | "before" | "none" {
  if (!publication) return "none";
  if (date > publication.periodEnd) return "not-published";
  if (date < publication.periodStart) return "before";
  return "published";
}

/** "Published Sat 3 Oct 16:10, version 4": where this list comes from, and when it last changed. */
export function rosterProvenance(publication: RosterPublicationSummary): string {
  return `Published ${formatPerthDay(perthDateOf(publication.publishedAt))} ${perthTimeOf(publication.publishedAt)}, version ${publication.version}`;
}

/** Work-search records: titles and keywords only, never a name from the roster. */
export function rosterWhosOnSearchRecords(): {
  readonly title: string;
  readonly area: "On Call";
  readonly keywords: readonly string[];
  readonly href: string;
}[] {
  return [
    {
      title: "Who is on, from your team roster",
      area: "On Call",
      keywords: ["who is on", "who's on", "on call", "tonight", "roster", "registrar", "consultant", "nights", "today"],
      href: ROSTER_WHOS_ON_HREF,
    },
  ];
}
