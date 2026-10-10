import type { CalendarEvent } from "@/lib/calendar/calendar-event";
import { EXAMPLE_ID_PREFIX, isExampleRecord } from "@/lib/example-data/guards";
import { ordinal } from "@/lib/roster/rotations/allocate";
import type { MyRound } from "@/lib/roster/rotations/model";
import { zonedDateOf, zonedTimeOf } from "@/lib/work-time/format";

/**
 * Work calendar entries: things that sit on a doctor's calendar beside their
 * shifts but are not shifts. A published rotation placement is one; a course
 * someone booked is another. Each feature turns its own records into entries
 * here, and the calendar views (Roster month, My Day, the calendar feed) read
 * only this shape, so a new feature plugs in without touching those views.
 *
 * Dates are calendar dates in the work time zone (Perth by default),
 * `YYYY-MM-DD`, with `end` inclusive. An example entry's id starts `example:`
 * so `withoutExampleRecords` keeps it out of exports and notifications.
 */

/** "rotation" and "course" are known. Any other string is allowed for a later feature. */
export type WorkCalendarEntryKind = "rotation" | "course" | (string & {});

/** Only confirmed entries are drawn on a calendar. Waitlisted and cancelled ones stay on their own feature's page. */
export type WorkCalendarEntryStatus = "confirmed" | "waitlisted" | "cancelled";

export type WorkCalendarEntry = {
  /** Stable across reads, e.g. `rotation:<roundId>:<termId>` or `booking:<courseId>`. */
  readonly id: string;
  readonly kind: WorkCalendarEntryKind;
  /** Short, e.g. "Consultation liaison". */
  readonly title: string;
  /** One muted line, e.g. "Term 1 · Example Hospital · your 1st choice". */
  readonly detail?: string;
  /** `YYYY-MM-DD`, the first day. */
  readonly start: string;
  /** `YYYY-MM-DD`, the last day (inclusive). Same as `start` for a one-day entry. */
  readonly end: string;
  /** True for whole days (rotations). A timed entry carries `startTime` and `endTime`. */
  readonly allDay?: boolean;
  /** `HH:MM` on the work zone's clock, on `start`. */
  readonly startTime?: string;
  /** `HH:MM` on the work zone's clock, on `end`. */
  readonly endTime?: string;
  /** Where, e.g. a hospital or a room. Never a patient detail. */
  readonly location?: string;
  /** Defaults to confirmed. */
  readonly status?: WorkCalendarEntryStatus;
  /** In-app page for the entry. */
  readonly href?: string;
  /** ISO instant of the last change, so a view can say "Updated". */
  readonly updatedAt?: string;
  /** True when it comes from example data. Its id then starts `example:` too. */
  readonly isExample?: boolean;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The entry's status, confirmed when it does not say. */
export function entryStatus(entry: Pick<WorkCalendarEntry, "status">): WorkCalendarEntryStatus {
  return entry.status ?? "confirmed";
}

/** True when a calendar view should draw the entry: confirmed, with valid dates in order. */
export function isShownOnCalendar(entry: WorkCalendarEntry): boolean {
  return (
    entryStatus(entry) === "confirmed" && DATE.test(entry.start) && DATE.test(entry.end) && entry.start <= entry.end
  );
}

/** Earliest first, then by start time (whole days first), then by title. */
export function compareEntries(a: WorkCalendarEntry, b: WorkCalendarEntry): number {
  return (
    a.start.localeCompare(b.start) ||
    (a.startTime ?? "").localeCompare(b.startTime ?? "") ||
    a.title.localeCompare(b.title) ||
    a.id.localeCompare(b.id)
  );
}

/** Several sources' entries as one list: each id once (the first wins), sorted. */
export function mergeEntries(lists: readonly (readonly WorkCalendarEntry[])[]): WorkCalendarEntry[] {
  const seen = new Set<string>();
  const merged: WorkCalendarEntry[] = [];
  for (const list of lists) {
    for (const entry of list) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      merged.push(entry);
    }
  }
  return merged.sort(compareEntries);
}

/** The shown entries that cover `date` (`YYYY-MM-DD`), sorted. */
export function entriesOnDate(entries: readonly WorkCalendarEntry[], date: string): WorkCalendarEntry[] {
  return entries
    .filter((entry) => isShownOnCalendar(entry) && entry.start <= date && entry.end >= date)
    .sort(compareEntries);
}

/** The shown entries that overlap `from` to `to` (both inclusive), sorted. */
export function entriesOverlapping(
  entries: readonly WorkCalendarEntry[],
  from: string,
  to: string,
): WorkCalendarEntry[] {
  return entries
    .filter((entry) => isShownOnCalendar(entry) && entry.start <= to && entry.end >= from)
    .sort(compareEntries);
}

/** The first day or the last day of an entry. */
export type WorkCalendarEdge = {
  readonly date: string;
  readonly edge: "start" | "end";
  readonly entry: WorkCalendarEntry;
};

/**
 * Starts and ends of shown entries falling from `from` to `to` (inclusive), in
 * date order, a start before an end on the same day. A one-day entry gives only
 * its start. For "Coming up" lists and day markers.
 */
export function entryEdges(entries: readonly WorkCalendarEntry[], from: string, to: string): WorkCalendarEdge[] {
  const edges: WorkCalendarEdge[] = [];
  for (const entry of entries) {
    if (!isShownOnCalendar(entry)) continue;
    if (entry.start >= from && entry.start <= to) edges.push({ date: entry.start, edge: "start", entry });
    if (entry.end !== entry.start && entry.end >= from && entry.end <= to)
      edges.push({ date: entry.end, edge: "end", entry });
  }
  return edges.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.edge === b.edge ? compareEntries(a.entry, b.entry) : a.edge === "start" ? -1 : 1),
  );
}

/** Minutes from `HH:MM` to `HH:MM`, or null when either is missing or the end is not after the start. */
function minutesBetween(start: string | undefined, end: string | undefined): number | null {
  if (!start || !end || !/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) return null;
  const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  const span = toMinutes(end) - toMinutes(start);
  return span > 0 ? span : null;
}

function feedId(entryId: string, part: string): string {
  return `work-calendar-${entryId.replace(/[^A-Za-z0-9-]/g, "-")}-${part}`;
}

/**
 * Entries as calendar file events, for the private calendar feed. A whole-day
 * entry becomes its first day and its last day ("Consultation liaison starts",
 * "Consultation liaison ends"), not one long block that would cover every day
 * of a phone calendar for months. A timed one-day entry becomes one timed
 * event. Example entries, and anything not confirmed, are left out. No alarms.
 *
 * Rotations do not go through here: the feed reads them on the server from
 * the published rounds (`src/lib/calendar/rotation-feed-source.ts`), so pass
 * only other kinds (a booked course) to avoid listing a rotation twice.
 */
export function workCalendarFeedEvents(entries: readonly WorkCalendarEntry[]): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  for (const entry of entries) {
    if (!isShownOnCalendar(entry) || entry.isExample || isExampleRecord(entry.id)) continue;
    const shared = {
      kind: "other" as const,
      ...(entry.location ? { location: entry.location } : {}),
      ...(entry.detail ? { notes: entry.detail } : {}),
      ...(entry.href ? { href: entry.href } : {}),
    };
    const minutes = entry.start === entry.end ? minutesBetween(entry.startTime, entry.endTime) : null;
    if (!entry.allDay && minutes !== null) {
      events.push({
        ...shared,
        id: feedId(entry.id, "event"),
        title: entry.title,
        date: entry.start,
        startTime: entry.startTime,
        durationMinutes: minutes,
      });
      continue;
    }
    if (entry.start === entry.end) {
      events.push({ ...shared, id: feedId(entry.id, "day"), title: entry.title, date: entry.start });
      continue;
    }
    events.push({ ...shared, id: feedId(entry.id, "start"), title: `${entry.title} starts`, date: entry.start });
    events.push({ ...shared, id: feedId(entry.id, "end"), title: `${entry.title} ends`, date: entry.end });
  }
  return events;
}

// ---------------------------------------------------------------- rotations

function withoutExamplePrefix(id: string): string {
  return id.startsWith(EXAMPLE_ID_PREFIX) ? id.slice(EXAMPLE_ID_PREFIX.length) : id;
}

/** `rotation:<roundId>:<termId>`, or `example:rotation:...` for an example round. */
export function rotationEntryId(roundId: string, termId: string, example: boolean): string {
  const id = `rotation:${withoutExamplePrefix(roundId)}:${withoutExamplePrefix(termId)}`;
  return example ? `${EXAMPLE_ID_PREFIX}${id}` : id;
}

/** The doctor's page for one round. */
export function rotationRoundHref(roundId: string): string {
  return `/roster/rotations/${encodeURIComponent(roundId)}`;
}

/**
 * Published placements as calendar entries, one per term the doctor was
 * placed in: "Consultation liaison", "Term 1 · Example Hospital · your 1st
 * choice", whole days from the term's start to its end. Rounds that are not
 * published yet give nothing, and so do placements for anyone else.
 */
export function rotationCalendarEntries(myRounds: readonly MyRound[]): WorkCalendarEntry[] {
  const entries: WorkCalendarEntry[] = [];
  for (const mine of myRounds) {
    const { round } = mine;
    if (round.status !== "published") continue;
    const example = isExampleRecord(round.id);
    for (const placement of mine.placements) {
      if (placement.personId !== mine.personId) continue;
      const term = round.terms.find((candidate) => candidate.id === placement.termId);
      const rotation = round.rotations.find((candidate) => candidate.id === placement.rotationId);
      if (!term || !rotation) continue;
      const site = rotation.site.trim();
      entries.push({
        id: rotationEntryId(round.id, term.id, example),
        kind: "rotation",
        title: rotation.name,
        detail: [term.label, site, placement.rank ? `your ${ordinal(placement.rank)} choice` : null]
          .filter(Boolean)
          .join(" · "),
        start: term.start,
        end: term.end,
        allDay: true,
        ...(site ? { location: site } : {}),
        status: "confirmed",
        href: rotationRoundHref(round.id),
        ...(round.publishedAt ? { updatedAt: round.publishedAt } : {}),
        ...(example ? { isExample: true } : {}),
      });
    }
  }
  return entries.sort(compareEntries);
}

/**
 * The closing time of each open round the reader is in, so the date to send
 * preferences by is on the calendar too (owner request 10 Oct 2026, "wired up
 * to everything with a date or time"). One timed entry, kind "deadline", at
 * the round's close on the work zone's clock. A round no longer open gives
 * nothing, and neither does a close date that cannot be read.
 */
export function rotationDeadlineEntries(myRounds: readonly MyRound[], zone: string): WorkCalendarEntry[] {
  const entries: WorkCalendarEntry[] = [];
  for (const mine of myRounds) {
    const { round } = mine;
    const closes = Date.parse(round.closesAt);
    if (round.status !== "open" || !Number.isFinite(closes)) continue;
    const example = isExampleRecord(round.id);
    const id = `rotation-close:${withoutExamplePrefix(round.id)}`;
    const date = zonedDateOf(closes, zone);
    entries.push({
      id: example ? `${EXAMPLE_ID_PREFIX}${id}` : id,
      kind: "deadline",
      title: "Rotation preferences close",
      detail: [round.name, mine.submittedAt ? "yours are sent" : "yours aren't sent yet"].join(" · "),
      start: date,
      end: date,
      startTime: zonedTimeOf(closes, zone),
      status: "confirmed",
      href: rotationRoundHref(round.id),
      ...(example ? { isExample: true } : {}),
    });
  }
  return entries.sort(compareEntries);
}
