import { addDays, addMonthsClamped, dateKeyToUtcMillis } from "@/lib/calendar/calendar-event";
import { monthGrid, monthGridRange, monthKeyOf } from "@/lib/calendar/month-grid";
import { isWaPublicHolidayDate } from "@/lib/on-call/wa-public-holidays";
import { gradeRank } from "./eligibility";
import { ROSTER_GRADES, type RosterAssignment, type RosterGrade } from "./model";
import { assignmentStartDate, withMe } from "./team-view";

/**
 * The team calendar's state and its pure layout. View, date and filter live in
 * the URL (`?view=&date=&show=`), never on the device.
 *
 * Every assignment sits on the Perth date it starts. A night that starts at
 * 21:30 on the last day of a month or week belongs to that day alone; the
 * views show the end as "+1" rather than counting the shift a second time.
 */

export type CalendarView = "month" | "week" | "day";

export type CalendarShow =
  | { kind: "everyone" }
  | { kind: "me" }
  | { kind: "with_me" }
  | { kind: "grade"; grade: RosterGrade }
  | { kind: "person"; userId: string }
  | { kind: "compare"; userId: string };

export type CalendarState = { view: CalendarView; date: string; show: CalendarShow };

const VIEWS: readonly CalendarView[] = ["month", "week", "day"];
const DEFAULT_VIEW: CalendarView = "week";
const EVERYONE: CalendarShow = { kind: "everyone" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isCalendarDate(value: string | null): value is string {
  return value !== null && dateKeyToUtcMillis(value) !== null;
}

function readShow(value: string | null): CalendarShow {
  if (value === "me") return { kind: "me" };
  if (value === "with-me") return { kind: "with_me" };
  if (!value) return EVERYONE;
  const colon = value.indexOf(":");
  if (colon < 0) return EVERYONE;
  const kind = value.slice(0, colon);
  const rest = value.slice(colon + 1);
  if (kind === "grade" && (ROSTER_GRADES as readonly string[]).includes(rest)) {
    return { kind: "grade", grade: rest as RosterGrade };
  }
  if ((kind === "person" || kind === "compare") && UUID.test(rest)) return { kind, userId: rest };
  return EVERYONE;
}

function showValue(show: CalendarShow): string | null {
  switch (show.kind) {
    case "everyone":
      return null;
    case "me":
      return "me";
    case "with_me":
      return "with-me";
    case "grade":
      return `grade:${show.grade}`;
    case "person":
      return `person:${show.userId}`;
    case "compare":
      return `compare:${show.userId}`;
  }
}

/** Anything missing or unrecognised falls back to the default, so a stale link still opens. */
export function readCalendarState(params: URLSearchParams, today: string): CalendarState {
  const view = params.get("view");
  const date = params.get("date");
  return {
    view: VIEWS.includes(view as CalendarView) ? (view as CalendarView) : DEFAULT_VIEW,
    date: isCalendarDate(date) ? date : today,
    show: readShow(params.get("show")),
  };
}

/** The query string (no leading `?`). The default view and show are left out; the date is always kept. */
export function calendarStateQuery(state: CalendarState): string {
  const parts: string[] = [];
  if (state.view !== DEFAULT_VIEW) parts.push(`view=${state.view}`);
  parts.push(`date=${state.date}`);
  const show = showValue(state.show);
  if (show) parts.push(`show=${encodeURIComponent(show).replace(/%3A/g, ":")}`);
  return parts.join("&");
}

/** Monday = 0 … Sunday = 6. */
function mondayIndex(date: string): number {
  const millis = dateKeyToUtcMillis(date);
  if (millis === null) throw new Error(`Not a calendar date: ${date}`);
  return (new Date(millis).getUTCDay() + 6) % 7;
}

function mondayOf(date: string): string {
  return addDays(date, -mondayIndex(date));
}

/**
 * The dates to read, inclusive. The day view reads a day either side so a night
 * that began yesterday still shows its "to 07:30" span. Never more than 42 days,
 * well inside `ROSTER_MAX_WINDOW_DAYS`.
 */
export function calendarWindow(state: CalendarState): { from: string; to: string } {
  switch (state.view) {
    case "month": {
      const { start, end } = monthGridRange(monthKeyOf(state.date));
      return { from: start, to: end };
    }
    case "week": {
      const monday = mondayOf(state.date);
      return { from: monday, to: addDays(monday, 6) };
    }
    case "day":
      return { from: addDays(state.date, -1), to: addDays(state.date, 1) };
  }
}

/** Previous or next month, week or day. A month step keeps the day, clamped to a shorter month. */
export function stepCalendar(state: CalendarState, direction: -1 | 1): CalendarState {
  const date =
    state.view === "month"
      ? addMonthsClamped(state.date, direction)
      : addDays(state.date, direction * (state.view === "week" ? 7 : 1));
  return { ...state, date };
}

/**
 * `with_me` keeps the colleagues whose shifts overlap my next seven that have
 * not ended, which is why it needs `now`.
 */
export function filterAssignments(
  rows: readonly RosterAssignment[],
  show: CalendarShow,
  me: string | null,
  now: Date = new Date(),
): RosterAssignment[] {
  switch (show.kind) {
    case "everyone":
      return [...rows];
    case "me":
      return me === null ? [] : rows.filter((row) => row.userId === me);
    case "with_me":
      return me === null ? [] : withMe(rows, me, now);
    case "grade":
      return rows.filter((row) => row.grade === show.grade);
    case "person":
      return rows.filter((row) => row.userId === show.userId);
    case "compare":
      return rows.filter((row) => row.userId === show.userId || (me !== null && row.userId === me));
  }
}

const byStart = (a: RosterAssignment, b: RosterAssignment) =>
  Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id.localeCompare(b.id);

/** Assignments by the Perth date they start, each day in start order. */
function byStartDate(rows: readonly RosterAssignment[]): Map<string, RosterAssignment[]> {
  const days = new Map<string, RosterAssignment[]>();
  for (const row of [...rows].sort(byStart)) {
    const date = assignmentStartDate(row);
    const list = days.get(date);
    if (list) list.push(row);
    else days.set(date, [row]);
  }
  return days;
}

export type MonthCell = {
  date: string;
  inMonth: boolean;
  holiday: boolean;
  shifts: RosterAssignment[];
  mine: RosterAssignment[];
};

/** The month as Monday-first weeks. `mine` is the part of `shifts` that is mine (empty when I am not known). */
export function monthCells(monthKey: string, rows: readonly RosterAssignment[], me: string | null): MonthCell[][] {
  const days = byStartDate(rows);
  return monthGrid(monthKey).map((week) =>
    week.map(({ date, inMonth }) => {
      const shifts = days.get(date) ?? [];
      return {
        date,
        inMonth,
        holiday: isWaPublicHolidayDate(date),
        shifts,
        mine: me === null ? [] : shifts.filter((row) => row.userId === me),
      };
    }),
  );
}

export type BoardRow = {
  userId: string | null;
  name: string;
  grade: RosterGrade | null;
  isMe: boolean;
  days: RosterAssignment[][];
};

const UNNAMED = "Unnamed";

/**
 * One row per person for the week starting `monday`, seven day lists each. Me
 * first, then higher grades, then name. A person with no name or grade still
 * gets a row; a shift with no person at all gets a row of its own.
 */
export function weekBoard(monday: string, rows: readonly RosterAssignment[], me: string | null): BoardRow[] {
  const dates = Array.from({ length: 7 }, (_, index) => addDays(monday, index));
  const people = new Map<string, BoardRow>();
  for (const row of [...rows].sort(byStart)) {
    const day = dates.indexOf(assignmentStartDate(row));
    if (day < 0) continue;
    const key = row.userId ?? `open:${row.name ?? ""}`;
    let person = people.get(key);
    if (!person) {
      person = {
        userId: row.userId,
        name: UNNAMED,
        grade: null,
        isMe: me !== null && row.userId === me,
        days: dates.map(() => []),
      };
      people.set(key, person);
    }
    if (person.name === UNNAMED && row.name) person.name = row.name;
    person.grade ??= row.grade;
    person.days[day].push(row);
  }
  return [...people.values()].sort(
    (a, b) =>
      Number(b.isMe) - Number(a.isMe) ||
      (gradeRank(b.grade) ?? 0) - (gradeRank(a.grade) ?? 0) ||
      a.name.localeCompare(b.name),
  );
}
