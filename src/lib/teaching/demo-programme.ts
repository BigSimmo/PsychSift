import { addDays } from "@/lib/calendar/calendar-event";
import { nextTeachingOccurrence, type RecurringSessionFrequency } from "@/lib/dates/recurring-session";
import type { SessionRef } from "@/lib/teaching/depth-model";
import {
  RELOCATED_SERVICE_ID,
  type AttendanceMark,
  type LogbookRow,
  type Notice,
  type SeriesAudience,
  type SessionDetail,
  type SessionSummary,
  type TeachingWeek,
  type TeamSummary,
  type WhatsOnRow,
} from "@/lib/teaching/model";
import { perthInstant, perthToday } from "@/lib/teaching/time";

/**
 * The demo service's programme, shaped to the Teaching v5 mock-up's week: eleven weekly
 * sessions of the demo service's own, Monday to Friday, plus the weekly registrar teaching
 * that comes across from On Call (twelve in all), so This week, My record and Presenting
 * read as a real, busy term rather than three lonely rows.
 *
 * Everything here must stay obviously made up: every title and room starts "Demo",
 * the only presenter is "Demo presenter", and every link is example.org. Shown in
 * demo mode and to signed-out visitors, never mixed with a real team.
 *
 * Recurring series hang off fixed 2026 anchors, so a week view is a real timetable
 * and a session keeps its id from one day to the next. The made-up record (who attended
 * what, what is in CPD, what still wants feedback) is worked out from "now", so the
 * screens look the same on any day: twelve weeks of check-ins with one empty week, the
 * last three check-ins not yet in CPD, and feedback owed on the latest case presentation
 * and case discussion.
 *
 * What's on (master plan R8) adds two more made-up services in the made-up "Demo health
 * service", which open three weekly sessions to it between them. The demo viewer is a
 * visitor there, so those sessions open read-only.
 */

export const DEMO_TEACHING_SERVICE_ID = "00000000-0000-4000-9000-000000000001";

export const DEMO_TEACHING_TEAM: TeamSummary = {
  id: DEMO_TEACHING_SERVICE_ID,
  name: "Example teaching service",
  role: "doctor",
  acceptsRealData: true,
  isDemo: true,
};

type DemoSeries = {
  readonly key: number;
  readonly title: string;
  /** Fixed anchor for a repeating series; null for the one-off. */
  readonly anchor: string | null;
  readonly anchorOffsetDays: number;
  readonly frequency: RecurringSessionFrequency | null;
  readonly startTime: string;
  readonly minutes: number;
  /** Null when the room is still to be confirmed (or the session is online only). */
  readonly venue: string | null;
  readonly presenter: boolean;
  readonly joinLink: boolean;
  /** Master plan R4: which level the series is for. Left out, it is for all doctors. */
  readonly audience?: SeriesAudience;
};

/** A weekly series another made-up service has opened to the demo health service. */
type DemoOpenSeries = DemoSeries & { readonly serviceId: string; readonly teamName: string };

const DEMO_SERIES: readonly DemoSeries[] = [
  {
    key: 21,
    title: "Morning report",
    anchor: "2026-01-05",
    anchorOffsetDays: 0,
    frequency: "weekly",
    startTime: "08:00",
    minutes: 60,
    venue: "Room 4",
    presenter: false,
    joinLink: false,
  },
  {
    key: 3,
    title: "Education meeting",
    anchor: "2026-01-05",
    anchorOffsetDays: 0,
    frequency: "weekly",
    startTime: "12:30",
    minutes: 50,
    venue: "Lecture theatre",
    presenter: true,
    joinLink: false,
  },
  {
    key: 22,
    title: "Case presentation",
    anchor: "2026-01-06",
    anchorOffsetDays: 0,
    frequency: "weekly",
    startTime: "12:30",
    minutes: 60,
    venue: "Seminar room 2",
    presenter: true,
    joinLink: false,
  },
  {
    key: 2,
    title: "Journal club",
    anchor: "2026-01-06",
    anchorOffsetDays: 0,
    frequency: "weekly",
    startTime: "14:00",
    minutes: 60,
    venue: null,
    presenter: true,
    joinLink: false,
    audience: "registrars",
  },
  {
    key: 5,
    title: "Grand rounds",
    anchor: "2026-01-06",
    anchorOffsetDays: 0,
    frequency: "weekly",
    startTime: "17:00",
    minutes: 60,
    venue: "Lecture theatre",
    presenter: true,
    joinLink: false,
  },
  {
    key: 23,
    title: "Psychotherapy seminar",
    anchor: "2026-01-07",
    anchorOffsetDays: 0,
    frequency: "weekly",
    startTime: "09:00",
    minutes: 60,
    venue: "Seminar room 1",
    presenter: true,
    joinLink: false,
  },
  {
    key: 7,
    title: "Supervision group",
    anchor: "2026-01-07",
    anchorOffsetDays: 0,
    frequency: "weekly",
    startTime: "13:00",
    minutes: 60,
    venue: "Room 4",
    presenter: false,
    joinLink: false,
  },
  {
    key: 24,
    title: "Research meeting",
    anchor: "2026-01-08",
    anchorOffsetDays: 0,
    frequency: "weekly",
    startTime: "08:30",
    minutes: 60,
    venue: null,
    presenter: false,
    joinLink: true,
  },
  {
    key: 6,
    title: "Clinical skills workshop",
    anchor: "2026-01-08",
    anchorOffsetDays: 0,
    frequency: "weekly",
    startTime: "12:00",
    minutes: 60,
    venue: "Simulation suite",
    presenter: true,
    joinLink: false,
    audience: "registrars",
  },
  {
    key: 25,
    title: "Case discussion",
    anchor: "2026-01-08",
    anchorOffsetDays: 0,
    frequency: "weekly",
    startTime: "15:00",
    minutes: 60,
    venue: "Room 4",
    presenter: true,
    joinLink: false,
  },
  {
    key: 26,
    title: "Mental health update",
    anchor: "2026-01-09",
    anchorOffsetDays: 0,
    frequency: "weekly",
    startTime: "10:00",
    minutes: 60,
    venue: "Lecture theatre",
    presenter: true,
    joinLink: false,
  },
];

export const DEMO_OLDER_ADULT_SERVICE_ID = "00000000-0000-4000-9000-000000000002";
export const DEMO_YOUTH_SERVICE_ID = "00000000-0000-4000-9000-000000000003";
const OLDER_ADULT = { serviceId: DEMO_OLDER_ADULT_SERVICE_ID, teamName: "Older adult service" } as const;
const YOUTH = { serviceId: DEMO_YOUTH_SERVICE_ID, teamName: "Youth service" } as const;

/** Keys 11 to 14, so their occurrence ids never meet the demo service's own (2 to 7 and 21 to 26). */
const DEMO_OPEN_SERIES: readonly DemoOpenSeries[] = [
  {
    ...OLDER_ADULT,
    key: 11,
    title: "Psychopharmacology update",
    anchor: "2026-01-07",
    anchorOffsetDays: 0,
    frequency: "weekly",
    startTime: "11:15",
    minutes: 60,
    venue: "Older adult unit, also on Teams",
    presenter: true,
    joinLink: true,
  },

  {
    ...OLDER_ADULT,
    key: 13,
    title: "Delirium teaching",
    anchor: "2026-01-08",
    anchorOffsetDays: 0,
    frequency: "weekly",
    startTime: "08:00",
    minutes: 60,
    venue: "Education centre",
    presenter: true,
    joinLink: false,
    audience: "interns",
  },
  {
    ...YOUTH,
    key: 14,
    title: "Eating disorders case conference",
    anchor: "2026-01-07",
    anchorOffsetDays: 0,
    frequency: "weekly",
    startTime: "14:00",
    minutes: 60,
    venue: "Youth unit, also on Teams",
    presenter: true,
    joinLink: true,
    audience: "consultants",
  },
];

const DEMO_PRESENTER = "Presenter";
const DEMO_JOIN_URL = "https://example.org/demo-teaching-join";
const DEMO_MATERIAL = { label: "Reading list", url: "https://example.org/demo-reading" };
/** The next education meeting is shown moved, so the change notice has something to show. */
const MOVED_SERIES_KEY = 3;
const MOVED_VENUE = "Seminar room 1";
const MAX_DEMO_OCCURRENCES = 60;
const ID_PATTERN = /^00000000-0000-4000-9(\d{3})-(\d{8})0000$/;

/** A stable, valid uuid for one occurrence: the series key and the date are readable in it. */
export function demoOccurrenceId(key: number, date: string): string {
  return `00000000-0000-4000-9${String(key).padStart(3, "0")}-${date.replace(/-/g, "")}0000`;
}

function demoNoticeId(key: number, date: string): string {
  return `00000000-0000-4000-a${String(key).padStart(3, "0")}-${date.replace(/-/g, "")}0000`;
}

function anchorOf(series: DemoSeries, today: string): string {
  return series.anchor ?? addDays(today, series.anchorOffsetDays);
}

function datesBetween(series: DemoSeries, from: string, to: string, today: string): string[] {
  const anchor = anchorOf(series, today);
  const dates: string[] = [];
  let date = nextTeachingOccurrence(anchor, series.frequency, from);
  while (date && date <= to && dates.length < MAX_DEMO_OCCURRENCES) {
    dates.push(date);
    if (!series.frequency) break;
    date = nextTeachingOccurrence(anchor, series.frequency, addDays(date, 1));
  }
  return dates;
}

function movedDate(today: string): string | null {
  const series = DEMO_SERIES.find((candidate) => candidate.key === MOVED_SERIES_KEY);
  return series ? nextTeachingOccurrence(anchorOf(series, today), series.frequency, today) : null;
}

function isOpenSeries(series: DemoSeries | DemoOpenSeries): series is DemoOpenSeries {
  return "serviceId" in series;
}

function demoSummary(series: DemoSeries | DemoOpenSeries, date: string, today: string): SessionSummary {
  const startsAt = perthInstant(date, series.startTime);
  const moved = series.key === MOVED_SERIES_KEY && date === movedDate(today);
  return {
    occurrenceId: demoOccurrenceId(series.key, date),
    serviceId: isOpenSeries(series) ? series.serviceId : DEMO_TEACHING_SERVICE_ID,
    title: series.title,
    startsAt,
    endsAt: new Date(Date.parse(startsAt) + series.minutes * 60_000).toISOString(),
    venue: moved ? MOVED_VENUE : series.venue,
    hasJoinLink: series.joinLink,
    status: moved ? "moved" : "scheduled",
    // The demo viewer presents at this week's journal club, so Presenting and "Next for you" have a talk.
    isPresenter: series.key === PRESENTING_KEY && mondayOfDate(date) === mondayOfDate(today),
    source: "teaching",
  };
}

export function demoTeachingSessions(range: { from: string; to: string }, now: Date = new Date()): SessionSummary[] {
  const today = perthToday(now);
  return DEMO_SERIES.flatMap((series) =>
    datesBetween(series, range.from, range.to, today).map((date) => demoSummary(series, date, today)),
  ).sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.title.localeCompare(b.title));
}

export function demoTeachingWeek(range: { from: string; to: string }, now: Date = new Date()): TeachingWeek {
  const sessions = demoTeachingSessions(range, now);
  const notices: Notice[] = sessions
    .filter((session) => session.status === "moved")
    .map((session) => ({
      id: demoNoticeId(MOVED_SERIES_KEY, session.startsAt.slice(0, 10)),
      occurrenceId: session.occurrenceId,
      serviceId: DEMO_TEACHING_SERVICE_ID,
      kind: "moved" as const,
      createdAt: now.toISOString(),
    }));
  return { teams: [DEMO_TEACHING_TEAM], sessions, notices, attendance: demoAttendanceIn(range, now) };
}

function whatsOnRow(series: DemoSeries | DemoOpenSeries, date: string, today: string): WhatsOnRow {
  const own = !isOpenSeries(series);
  return {
    ...demoSummary(series, date, today),
    teamName: isOpenSeries(series) ? series.teamName : DEMO_TEACHING_TEAM.name,
    joinUrl: series.joinLink ? DEMO_JOIN_URL : null,
    own,
    // The demo service's own sessions are already in the viewer's week; an open one is not until added.
    inMyWeek: own,
    audience: series.audience ?? "all_doctors",
  };
}

/**
 * What's on for the demo (master plan R8): the demo service's own week, plus the five sessions the
 * two other made-up services open to the demo health service each week. Ordered as the database
 * orders it, by start time and then id.
 */
export function demoWhatsOnSessions(range: { from: string; to: string }, now: Date = new Date()): WhatsOnRow[] {
  const today = perthToday(now);
  return [...DEMO_SERIES, ...DEMO_OPEN_SERIES]
    .flatMap((series) =>
      datesBetween(series, range.from, range.to, today).map((date) => whatsOnRow(series, date, today)),
    )
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.occurrenceId.localeCompare(b.occurrenceId));
}

/** The demo series' own ids, for resources linked to a whole series. */
export function demoSeriesId(key: number): string {
  return `00000000-0000-4000-b${String(key).padStart(3, "0")}-000000000000`;
}

/** A demo occurrence id read back into its series key and Perth date, or null. */
export function parseDemoOccurrenceId(occurrenceId: string): { key: number; date: string } | null {
  const match = ID_PATTERN.exec(occurrenceId);
  if (!match) return null;
  const compact = match[2];
  return { key: Number(match[1]), date: `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}` };
}

export function demoTeachingSessionDetail(occurrenceId: string, now: Date = new Date()): SessionDetail | null {
  const parsed = parseDemoOccurrenceId(occurrenceId);
  if (!parsed) return null;
  const { key, date } = parsed;
  const series = [...DEMO_SERIES, ...DEMO_OPEN_SERIES].find((candidate) => candidate.key === key);
  if (!series) return null;
  const today = perthToday(now);
  if (!datesBetween(series, date, date, today).includes(date)) return null;
  const summary = demoSummary(series, date, today);
  // Master plan R5/R15: another service's open session is a read-only visitor view with no presenter name.
  const visitor = isOpenSeries(series);
  return {
    ...summary,
    joinUrl: series.joinLink ? DEMO_JOIN_URL : null,
    presenterName: series.presenter && !visitor ? DEMO_PRESENTER : null,
    materials: [DEMO_MATERIAL],
    changeReason: summary.status === "moved" ? "room_change" : null,
    canShowCode: false,
    counts: null,
    visitor,
  };
}

/** The weekday a Perth date falls on, Monday 0 to Sunday 6. */
function weekdayIndex(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
}

function mondayOfDate(date: string): string {
  return addDays(date, -weekdayIndex(date));
}

/** The journal club key: the demo viewer presents at this week's one. */
const PRESENTING_KEY = 2;
const CASE_PRESENTATION_KEY = 22;
const CASE_DISCUSSION_KEY = 25;

/**
 * Check-ins per week, this week first and then back eleven weeks. This week's count comes from
 * {@link THIS_WEEK_ATTENDS} as sessions end; the eleven full weeks hold 31 between them (an
 * average of 2.8 a week), with none in the week four weeks back.
 */
const PAST_WEEK_COUNTS = [4, 2, 3, 0, 5, 3, 3, 4, 2, 3, 2] as const;
/** Last week: the case presentation, the psychotherapy seminar, the case discussion and the update. */
const LAST_WEEK_ATTENDS = [CASE_PRESENTATION_KEY, 23, CASE_DISCUSSION_KEY, 26] as const;
/** Older weeks take the first few of this rotation, starting one further along each week. */
const ROTATION = [21, CASE_PRESENTATION_KEY, 23, CASE_DISCUSSION_KEY, 26, 5, 7, PRESENTING_KEY] as const;
/**
 * This week the viewer goes to everything they can once it has ended, except the education meeting
 * (missed, so it has a recording to watch), the clinical skills workshop and today's case presentation
 * (which the on-now panel offers to check in to).
 */
const THIS_WEEK_ATTENDS = new Set<number>([21, PRESENTING_KEY, 5, 23, 7, 24, CASE_DISCUSSION_KEY, 26]);
/** The newest check-in is already in CPD; the three before it are not, so the weekly review has three. */
const UNLOGGED_AFTER_NEWEST = 3;
/** Feedback is open for seven days after a session the viewer checked in to. */
const FEEDBACK_OPEN_DAYS = 7;

function seriesByKey(key: number): DemoSeries | undefined {
  return DEMO_SERIES.find((candidate) => candidate.key === key);
}

function demoCpdEntryId(key: number, date: string): string {
  return `00000000-0000-4000-8${String(key).padStart(3, "0")}-${date.replace(/-/g, "")}0000`;
}

type Attended = { series: DemoSeries; date: string };

/** Every session the demo viewer checked in to, oldest first, all ended by `now`. */
function demoAttended(now: Date): Attended[] {
  const today = perthToday(now);
  const monday = mondayOfDate(today);
  const picked: Attended[] = [];
  const add = (key: number, weekMonday: string) => {
    const series = seriesByKey(key);
    if (!series) return;
    const [date] = datesBetween(series, weekMonday, addDays(weekMonday, 6), today);
    if (date) picked.push({ series, date });
  };
  PAST_WEEK_COUNTS.forEach((count, index) => {
    const weekMonday = addDays(monday, -7 * (index + 1));
    const keys =
      index === 0
        ? LAST_WEEK_ATTENDS.slice(0, count)
        : Array.from({ length: count }, (_, step) => ROTATION[(index * 3 + step) % ROTATION.length]);
    for (const key of keys) add(key, weekMonday);
  });
  for (const series of DEMO_SERIES) if (THIS_WEEK_ATTENDS.has(series.key)) add(series.key, monday);
  return picked
    .filter(({ series, date }) => Date.parse(demoSummary(series, date, today).endsAt) <= now.getTime())
    .sort((a, b) =>
      demoSummary(a.series, a.date, today).startsAt.localeCompare(demoSummary(b.series, b.date, today).startsAt),
    );
}

/**
 * Twelve weeks of the demo viewer's check-ins, most recent first (logbook.read's order): about 32
 * sessions with one empty week. The newest is already in CPD and the three before it are not.
 */
export function demoTeachingLogbook(now: Date = new Date()): LogbookRow[] {
  const today = perthToday(now);
  const newestFirst = demoAttended(now).reverse();
  return newestFirst.map(({ series, date }, index): LogbookRow => {
    const session = demoSummary(series, date, today);
    const logged = index === 0 || index > UNLOGGED_AFTER_NEWEST;
    return {
      occurrenceId: session.occurrenceId,
      // Mostly by the code in the room, now and then without it.
      method: index % 4 === 2 ? "self" : "code_room",
      recordedAt: new Date(Date.parse(session.startsAt) + 5 * 60_000).toISOString(),
      title: session.title,
      startsAt: session.startsAt,
      endsAt: session.endsAt,
      serviceName: DEMO_TEACHING_TEAM.name,
      serviceId: DEMO_TEACHING_SERVICE_ID,
      cpdEntryId: logged ? demoCpdEntryId(series.key, date) : null,
    };
  });
}

/** The check-ins that fall in one week, for This week's attended and missed rows. */
function demoAttendanceIn(range: { from: string; to: string }, now: Date): AttendanceMark[] {
  return demoTeachingLogbook(now)
    .filter((row) => {
      const date = parseDemoOccurrenceId(row.occurrenceId)?.date ?? "";
      return date >= range.from && date <= range.to;
    })
    .map(({ occurrenceId, method, recordedAt }) => ({ occurrenceId, method, recordedAt }));
}

/**
 * Feedback the demo viewer still owes: the latest case presentation and case discussion they went
 * to, oldest first, while still inside the seven days feedback stays open. The presenter sees
 * answers, never names.
 */
export function demoTeachingFeedbackOwed(now: Date = new Date()): SessionRef[] {
  const open = now.getTime() - FEEDBACK_OPEN_DAYS * 86_400_000;
  const rows = demoTeachingLogbook(now).filter((row) => Date.parse(row.endsAt) >= open);
  return [CASE_PRESENTATION_KEY, CASE_DISCUSSION_KEY]
    .map((key) => rows.find((row) => parseDemoOccurrenceId(row.occurrenceId)?.key === key))
    .filter((row): row is LogbookRow => row !== undefined)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .map(({ occurrenceId, title, startsAt, endsAt }) => ({
      occurrenceId,
      serviceId: DEMO_TEACHING_SERVICE_ID,
      title,
      startsAt,
      endsAt,
    }));
}

/**
 * The registrar teaching the demo viewer keeps in On Call, shown in This week as "From On Call":
 * every Tuesday at 16:00. Its id is the On Call demo entry's own (`demo-entries.ts`, id 50) and the
 * date, the shape `relocatedOnCallSessions` gives a real reader's entries.
 */
const ON_CALL_REGISTRAR_ENTRY_ID = "00000000-0000-4000-8000-000000000050";
const ON_CALL_REGISTRAR: DemoSeries = {
  key: 0,
  title: "Registrar teaching",
  anchor: "2026-01-06",
  anchorOffsetDays: 0,
  frequency: "weekly",
  startTime: "16:00",
  minutes: 60,
  venue: "Seminar room",
  presenter: false,
  joinLink: false,
};

export function demoRelocatedTeaching(range: { from: string; to: string }, now: Date = new Date()): SessionSummary[] {
  const today = perthToday(now);
  return datesBetween(ON_CALL_REGISTRAR, range.from, range.to, today).map((date) => {
    const startsAt = perthInstant(date, ON_CALL_REGISTRAR.startTime);
    return {
      occurrenceId: `${ON_CALL_REGISTRAR_ENTRY_ID}@${date}`,
      serviceId: RELOCATED_SERVICE_ID,
      title: ON_CALL_REGISTRAR.title,
      startsAt,
      endsAt: new Date(Date.parse(startsAt) + ON_CALL_REGISTRAR.minutes * 60_000).toISOString(),
      venue: ON_CALL_REGISTRAR.venue,
      hasJoinLink: false,
      status: "scheduled",
      isPresenter: false,
      source: "on_call_relocated",
    };
  });
}
