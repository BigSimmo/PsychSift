import { isExampleRecord } from "@/lib/example-data/guards";
import type { MyDayItem, MyDaySourceMode } from "@/lib/my-day/model";
import { ROSTER_LEAVE_KIND_LABEL, type RosterLeaveKind } from "@/lib/roster/leave-kinds";
import type { AdminRequest } from "@/lib/work-screens/admin/paperwork-model";
import { isShownOnCalendar, type WorkCalendarEntry } from "@/lib/work-calendar/entries";
import { zonedDateOf, zonedTimeOf } from "@/lib/work-time/format";

/**
 * The one calendar (owner request 10 Oct 2026, "one main large calendar that
 * handles all updates, course bookings, rotations, assessments, everything"):
 * every dated thing a doctor has in Work mode, in one shape, so the full-size
 * calendar page draws them all the same way.
 *
 * Each feature keeps its own records and its own page. This file only turns
 * what each one already reads into `MainCalendarItem`s. Nothing is stored, and
 * every item links back to the page that owns it.
 *
 * Dates are calendar dates in the work time zone, `YYYY-MM-DD`, `end` inclusive.
 */

export type MainCalendarItem = {
  /** Unique across sources, e.g. `shift:<id>` or `entry:rotation:<round>:<term>`. */
  readonly key: string;
  /** The area that owns it: its colour, its filter, and the area named under the title. */
  readonly area: MyDaySourceMode;
  /** What sort of thing it is, e.g. "Rotation", "Course", "Leave", "Shift". */
  readonly label: string;
  readonly title: string;
  readonly start: string;
  readonly end: string;
  /** `HH:MM` on the work zone's clock, or null for a whole day or a date with no time. */
  readonly time: string | null;
  /** One muted line, e.g. "until 17:00" or "Term 1 · Example Hospital". */
  readonly detail: string | null;
  /** A state in words ("Overdue", "Applied"), shown in amber when `warn`. */
  readonly state: string | null;
  readonly warn: boolean;
  readonly href: string;
  /**
   * True for a long whole-day stretch (a rotation term): drawn once as a band
   * over the month, not repeated in every day of the grid.
   */
  readonly band: boolean;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Areas in the order the filter lists them. */
export const MAIN_CALENDAR_AREAS: readonly MyDaySourceMode[] = ["roster", "teaching", "cme", "my-work", "on-call"];

function validRange(start: string, end: string): boolean {
  return DATE.test(start) && DATE.test(end) && start <= end;
}

// ---------------------------------------------------------------- sources

/** Work calendar entries (rotations, booked courses and any later source). Waitlisted and cancelled ones stay out. */
export function workEntryItems(entries: readonly WorkCalendarEntry[]): MainCalendarItem[] {
  return entries.filter((entry) => isShownOnCalendar(entry) && !entry.isExample && !isExampleRecord(entry.id)).map((entry): MainCalendarItem => {
    const rotation = entry.kind === "rotation";
    const course = entry.kind === "course";
    const timed = !entry.allDay && entry.startTime ? entry.startTime : null;
    const span = timed && entry.endTime ? `${timed} to ${entry.endTime}` : null;
    return {
      key: `entry:${entry.id}`,
      area: course ? "my-work" : "roster",
      label: rotation ? "Rotation" : course ? "Course" : "Date",
      title: entry.title,
      start: entry.start,
      end: entry.end,
      time: timed,
      detail: [span, entry.detail, course ? entry.location : null].filter(Boolean).join(" · ") || null,
      state: null,
      warn: false,
      href: entry.href ?? (course ? "/admin/bookings" : "/roster"),
      band: rotation || (entry.allDay === true && entry.start !== entry.end),
    };
  });
}

/** The doctor's own leave from Roster's leave list (planned, applied or approved), one item over its days. */
export type MainCalendarLeave = {
  readonly id: string;
  readonly kind: RosterLeaveKind;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly status: "planned" | "applied" | "approved";
};

const LEAVE_STATE: Readonly<Record<MainCalendarLeave["status"], string | null>> = {
  planned: "Planned",
  applied: "Applied",
  approved: null,
};

export function leaveItems(leave: readonly MainCalendarLeave[]): MainCalendarItem[] {
  return leave
    .filter((row) => validRange(row.startsOn, row.endsOn))
    .map((row) => ({
      key: `leave:${row.id}`,
      area: "roster",
      label: "Leave",
      title: ROSTER_LEAVE_KIND_LABEL[row.kind],
      start: row.startsOn,
      end: row.endsOn,
      time: null,
      detail: row.status === "approved" ? "Approved" : null,
      state: LEAVE_STATE[row.status],
      warn: false,
      href: "/roster/requests",
      band: false,
    }));
}

/** Admin requests still waiting on an answer, on the day the doctor chose to chase them. */
export function adminRequestItems(requests: readonly AdminRequest[]): MainCalendarItem[] {
  return requests.flatMap((request): MainCalendarItem[] => {
    if (request.status === "decided" || request.status === "draft") return [];
    if (!request.followUpOn || !DATE.test(request.followUpOn)) return [];
    return [
      {
        key: `request:${request.id}`,
        area: "my-work",
        label: "Request",
        title: `Chase: ${request.title}`,
        start: request.followUpOn,
        end: request.followUpOn,
        time: null,
        detail: `Sent to ${request.to}`,
        state: null,
        warn: false,
        href: "/admin/requests",
        band: false,
      },
    ];
  });
}

/** My Day's starts and ends of work calendar entries: left out here, where the entries are drawn whole. */
const CALENDAR_EDGE_ITEM = /^[a-z-]+:calendar-(?:start|end):/;

/**
 * Dated My Day items: renewals and expiry dates, CPD deadlines and routines,
 * swaps to answer, On Call dates. An item with no date is left out. One that is
 * late stays on its own date, marked, rather than moving to today.
 */
export function myDayCalendarItems(
  items: readonly MyDayItem[],
  area: (mode: MyDaySourceMode) => string,
  zone: string,
): MainCalendarItem[] {
  return items.flatMap((item): MainCalendarItem[] => {
    if (CALENDAR_EDGE_ITEM.test(item.id) || !item.due) return [];
    const timed = DATE.test(item.due) ? null : Date.parse(item.due);
    if (timed !== null && !Number.isFinite(timed)) return [];
    const date = timed === null ? item.due : zonedDateOf(timed, zone);
    const overdue = item.severity === "overdue";
    const state = overdue
      ? item.mode === "my-work"
        ? "Date passed"
        : "Overdue"
      : item.severity === "soon"
        ? "Due soon"
        : null;
    return [
      {
        key: `item:${item.id}`,
        area: item.mode,
        label: area(item.mode),
        title: item.title,
        start: date,
        end: date,
        time: timed === null ? null : zonedTimeOf(timed, zone),
        // The state already says the date has passed; a detail that repeats it is dropped.
        detail: item.detail && !(overdue && /passed|overdue/i.test(item.detail)) ? item.detail : null,
        state,
        warn: overdue,
        href: item.href,
        band: false,
      },
    ];
  });
}

// ---------------------------------------------------------------- reading the calendar

/** Every id once (the first wins). */
export function mergeCalendarItems(lists: readonly (readonly MainCalendarItem[])[]): MainCalendarItem[] {
  const seen = new Set<string>();
  const merged: MainCalendarItem[] = [];
  for (const list of lists)
    for (const item of list) {
      if (seen.has(item.key) || !validRange(item.start, item.end)) continue;
      seen.add(item.key);
      merged.push(item);
    }
  return merged;
}

/** Whole days first, then by time, then by title. */
function compareOnDay(a: MainCalendarItem, b: MainCalendarItem): number {
  if (a.time === null && b.time !== null) return -1;
  if (a.time !== null && b.time === null) return 1;
  return (a.time ?? "").localeCompare(b.time ?? "") || a.title.localeCompare(b.title) || a.key.localeCompare(b.key);
}

/** The items drawn in a day's cell: everything that covers `date` except the long bands. */
export function itemsOnDate(items: readonly MainCalendarItem[], date: string): MainCalendarItem[] {
  return items.filter((item) => !item.band && item.start <= date && item.end >= date).sort(compareOnDay);
}

/** Everything that covers `date`, bands first: the chosen day's full list. */
export function dayList(items: readonly MainCalendarItem[], date: string): MainCalendarItem[] {
  const covering = items.filter((item) => item.start <= date && item.end >= date);
  return [
    ...covering.filter((item) => item.band).sort(compareOnDay),
    ...covering.filter((item) => !item.band).sort(compareOnDay),
  ];
}

/** The bands that overlap `from` to `to`, earliest first. */
export function bandsOverlapping(items: readonly MainCalendarItem[], from: string, to: string): MainCalendarItem[] {
  return items
    .filter((item) => item.band && item.start <= to && item.end >= from)
    .sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
}

/** The items whose area is switched on. An empty set means every area. */
export function filterByArea(
  items: readonly MainCalendarItem[],
  hidden: ReadonlySet<MyDaySourceMode>,
): MainCalendarItem[] {
  return hidden.size ? items.filter((item) => !hidden.has(item.area)) : [...items];
}
