import {
  addDaysToDate,
  formatPerthDay,
  perthDateOf,
  perthTimeOf,
  perthWallToIso,
} from "@/lib/roster/shifts/perth-time";
import type { RosterAssignment, RosterAssignmentKind, RosterGrade } from "@/lib/roster/team/model";

/**
 * "From your team roster" (round 2 feature 22, who is on, kept up to date by
 * the department): On Call reads the PUBLISHED team roster, so nobody keeps a
 * second list. When the roster manager changes the roster, this changes.
 *
 * Names, the role the roster gives (grade and shift kind, "Registrar on
 * call"), the site and the shift's own times. Never a phone number, a leave or
 * sick reason: a leave row is dropped entirely, so "away" is never shown.
 * Nobody is ever guessed: a day with no rows says so.
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

const GRADE_WORDS: Readonly<Record<RosterGrade, string | null>> = {
  intern: "Intern",
  resident: "Resident",
  registrar: "Registrar",
  fellow: "Fellow",
  consultant: "Consultant",
  other: null,
};

/**
 * The role a shift stands for, from the roster's own grade and shift kind:
 * "Registrar on call", "Night registrar", "Day consultant", "Late consultant".
 * With no grade it is the shift kind alone ("On call").
 */
export function rosterRoleLabel(grade: RosterGrade | null, kind: RosterShownKind): string {
  const word = grade ? GRADE_WORDS[grade] : null;
  if (!word) return ROSTER_KIND_LABELS[kind];
  const lower = word.toLowerCase();
  switch (kind) {
    case "on_call":
      return `${word} on call`;
    case "day":
      return `Day ${lower}`;
    case "evening":
      return `Late ${lower}`;
    case "night":
      return `Night ${lower}`;
    case "other":
      return word;
  }
}

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
  /** "Registrar on call", from the roster's grade and shift kind. */
  readonly roleLabel: string;
  /** The site the roster names for the shift, if any. */
  readonly site: string | null;
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
/** The usual handover overlap: the next shift may start up to an hour before this one ends. */
const HANDOVER_OVERLAP_MS = 60 * 60_000;
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
        // Only someone of the same grade takes over: a registrar's row never says "then" an intern.
        other.grade === row.grade &&
        // A handover: starts no more than the overlap before this shift ends, and within 90 minutes after.
        Date.parse(other.startsAt) > Date.parse(row.startsAt) &&
        Date.parse(other.startsAt) - end >= -HANDOVER_OVERLAP_MS &&
        Date.parse(other.startsAt) - end <= HANDOVER_WINDOW_MS,
    )
    .sort(
      (a, b) =>
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
        roleLabel: rosterRoleLabel(row.grade, row.kind),
        site: row.siteName?.trim() ? row.siteName.trim() : null,
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

/** The rail's screen-reader text: "Dr Nguyen, night registrar, 21:00 to 08:30 Wed, on now". */
export function rosterRailLabel(row: RosterWhosOnRow): string {
  const who = row.isMe ? "You" : (row.name ?? "Nobody rostered");
  return `${who}, ${row.roleLabel.toLowerCase()}, ${row.span}${row.onNow ? ", on now" : ""}`;
}

// ------------------------------------------------------------------ changes

function signature(row: RosterAssignment): string {
  return [row.userId ?? "", row.name?.trim() ?? "", row.kind, row.startsAt, row.endsAt, row.siteId ?? ""].join("|");
}

/**
 * What changed between two reads of the same roster window, so a swap, sick
 * cover or a republish shows by itself: the shifts that are new or different,
 * and how many went. Compared in memory only, never stored.
 */
export function rosterWhosOnChanges(
  previous: readonly RosterAssignment[],
  current: readonly RosterAssignment[],
): { readonly changedIds: readonly string[]; readonly removed: number; readonly count: number } {
  const before = new Map(previous.filter((row) => row.kind !== "leave").map((row) => [row.id, signature(row)]));
  const shown = current.filter((row) => row.kind !== "leave");
  const changedIds = shown.filter((row) => before.get(row.id) !== signature(row)).map((row) => row.id);
  const kept = new Set(shown.map((row) => row.id));
  const removed = [...before.keys()].filter((id) => !kept.has(id)).length;
  return { changedIds, removed, count: changedIds.length + removed };
}

export const ROSTER_REPORT_REASONS = ["someone-else", "swapped", "not-here", "other"] as const;
export type RosterReportReason = (typeof ROSTER_REPORT_REASONS)[number];

export const ROSTER_REPORT_REASON_LABELS: Readonly<Record<RosterReportReason, string>> = {
  "someone-else": "Someone else is on",
  swapped: "They swapped",
  "not-here": "Not here",
  other: "Other",
};

/**
 * A short note for the roster manager about one shift, for the doctor to copy
 * and send. The list itself never changes from here: it changes only when the
 * roster does. The note carries the shift, the reason and the doctor's own
 * words (checked for patient details before this is called), nothing else.
 */
export function rosterReportText(input: {
  readonly row: Pick<RosterWhosOnRow, "name" | "isMe" | "roleLabel" | "span">;
  readonly date: string;
  readonly teamName: string | null;
  readonly reason: RosterReportReason;
  readonly note: string;
}): string {
  const who = input.row.isMe ? "my shift" : (input.row.name ?? "a shift with no name");
  const where = input.teamName ? ` on the ${input.teamName} roster` : " on the roster";
  const lines = [
    `Hello, the roster may not be right${where}.`,
    `${formatPerthDay(input.date)}, ${input.row.roleLabel.toLowerCase()}, ${input.row.span}: ${who}.`,
    `What I noticed: ${ROSTER_REPORT_REASON_LABELS[input.reason].toLowerCase()}.`,
  ];
  const note = input.note.trim();
  if (note) lines.push(note);
  lines.push("Could you check it and republish if it needs changing? Thank you.");
  return lines.join("\n");
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
