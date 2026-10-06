import { sessionPhase } from "@/components/teaching/session-phase";
import type { TeachingAction } from "@/components/teaching/teaching-actions";
import {
  addDays,
  dayParts,
  longDayLabel,
  perthDateKey,
  perthTime,
  shortDayLabel,
} from "@/components/teaching/teaching-dates";
import type { HeroModelProps } from "@/components/teaching/teaching-hero";
import type { DayRailDay, TimelineGroup, TimelineRow } from "@/components/teaching/teaching-modules";
import { withUnit } from "@/components/teaching/teaching-number";
import type { SessionSummaryRead, TeamSummaryRead } from "@/components/teaching/teaching-reads";
import {
  attendanceLabels,
  RELOCATED_SERVICE_ID,
  type AttendanceMark,
  type SessionSummary,
  type TeamSummary,
} from "@/lib/teaching/model";

/* Pure shaping for Today and Week. Perth wall-clock, 24-hour, NBSP before units. */

export const ALL_TEAMS = "all";
const MINUTE = 60_000;
/** Check-in opens 15 minutes before the start and closes 15 minutes after the end (the server's windows). */
const CHECKIN_MARGIN = 15 * MINUTE;

export type RowContext = { teams: readonly TeamSummary[]; attendance: readonly AttendanceMark[]; showTeam: boolean };
export type WeekFilter = "all" | "presenting";
export type HeroModel = Omit<HeroModelProps, "actions"> & { actions: TeachingAction[] };
export type HeroInput = {
  now: Date;
  today: string;
  teams: readonly TeamSummary[];
  showTeam: boolean;
  attendance: readonly AttendanceMark[];
  joinUrl: string | null;
  /** Signed in and not the demo: "Add to calendar" can be offered. */
  calendar: boolean;
  /** Any session ran or runs today: "Nothing more today" rather than "No teaching today". */
  hadToday: boolean;
};

const byStart = (a: SessionSummary, b: SessionSummary) =>
  a.startsAt.localeCompare(b.startsAt) || a.title.localeCompare(b.title);
const isRelocated = (s: SessionSummary) => s.source === "on_call_relocated" || s.serviceId === RELOCATED_SERVICE_ID;
const joinMeta = (parts: readonly (string | null | undefined | false)[]) =>
  parts.filter((p): p is string => Boolean(p)).join(" · ");
const running = (s: SessionSummary) => s.status !== "cancelled";
const isoAt = (ms: number) => new Date(ms).toISOString();

export function sessionsForTeam(sessions: readonly SessionSummaryRead[], team: string): SessionSummaryRead[] {
  return (team === ALL_TEAMS ? [...sessions] : sessions.filter((s) => s.serviceId === team)).sort(byStart);
}

/** Relocated On Call sessions have no Teaching page. */
export function sessionHref(session: SessionSummary): string | null {
  return isRelocated(session) ? null : `/teaching/session/${session.occurrenceId}`;
}

export function teamLabel(session: SessionSummary, teams: readonly TeamSummary[]): string {
  if (isRelocated(session)) return "From On Call";
  return teams.find((team) => team.id === session.serviceId)?.name ?? "Your service";
}

export function teamInCalendar(team: TeamSummaryRead): boolean {
  return team.inCalendar === true;
}

/** The platform named from the link's host; null when the host says nothing. */
export function joinPlatform(url: string): string | null {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host.includes("teams.")) return "Microsoft Teams";
  if (host.includes("zoom.")) return "Zoom";
  if (host.includes("webex.")) return "Webex";
  return null;
}

export function joinLabel(url: string): string {
  const platform = joinPlatform(url);
  return platform === "Microsoft Teams" ? "Join on Teams" : platform ? `Join on ${platform}` : "Join online";
}

export function sessionRow(session: SessionSummaryRead, context: RowContext): TimelineRow {
  const team = isRelocated(session) || context.showTeam ? teamLabel(session, context.teams) : null;
  const was = session.status === "moved" && session.previousStartsAt ? perthTime(session.previousStartsAt) : null;
  const cancelled = session.status === "cancelled";
  const change = cancelled ? "Cancelled" : session.status === "moved" ? (was ? `Moved from ${was}` : "Moved") : null;
  const mark = cancelled ? undefined : context.attendance.find((item) => item.occurrenceId === session.occurrenceId);
  return {
    id: session.occurrenceId,
    href: sessionHref(session),
    timeTop: session.allDay ? "All day" : perthTime(session.startsAt),
    timeBottom: session.allDay ? null : perthTime(session.endsAt),
    was,
    title: session.title,
    meta: cancelled
      ? joinMeta([change, team])
      : joinMeta([change, session.venue, session.hasJoinLink && "also online", team]),
    status: mark ? { tone: "muted", text: attendanceLabels[mark.method] } : null,
    cancelled,
  };
}

export function dayGroups(
  sessions: readonly SessionSummaryRead[],
  today: string,
  context: RowContext,
): TimelineGroup[] {
  const byDay = new Map<string, SessionSummaryRead[]>();
  for (const s of [...sessions].sort(byStart)) {
    const key = perthDateKey(s.startsAt);
    byDay.set(key, [...(byDay.get(key) ?? []), s]);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, list]) => {
      const count = list.filter(running).length;
      return {
        id: key,
        anchor: `day-${key}`,
        label: key === today ? `Today · ${longDayLabel(key)}` : longDayLabel(key),
        count: withUnit(count, count === 1 ? "session" : "sessions"),
        rows: list.map((s) => sessionRow(s, context)),
      };
    });
}

export function nextSession(sessions: readonly SessionSummaryRead[], now: Date): SessionSummaryRead | null {
  return (
    [...sessions].sort(byStart).find((s) => running(s) && !s.allDay && Date.parse(s.endsAt) > now.getTime()) ?? null
  );
}

function startsIn(session: SessionSummary, now: Date): string {
  const minutes = Math.max(1, Math.ceil((Date.parse(session.startsAt) - now.getTime()) / MINUTE));
  if (minutes < 60) return `Starts in ${withUnit(minutes, "min")}`;
  const rest = minutes % 60;
  const hours = withUnit(Math.floor(minutes / 60), "h");
  return rest ? `Starts in ${hours} ${withUnit(rest, "min")}` : `Starts in ${hours}`;
}

export function heroModel(session: SessionSummaryRead | null, input: HeroInput): HeroModel {
  if (!session) {
    return {
      eyebrowRight: null,
      figureDate: null,
      figure: null,
      figureEnd: null,
      title: "Nothing more this week",
      meta: "",
      status: null,
      live: false,
      actions: [],
    };
  }
  const href = sessionHref(session);
  const start = Date.parse(session.startsAt);
  const end = Date.parse(session.endsAt);
  const isToday = perthDateKey(session.startsAt) === input.today;
  const on = input.now.getTime() >= start && input.now.getTime() < end;
  const mark = input.attendance.find((item) => item.occurrenceId === session.occurrenceId);
  const phase = sessionPhase(session, input.now);
  const checkinOpen = href !== null && isToday && phase === "checkin" && !mark;

  let actions: TeachingAction[];
  if (href === null)
    actions = [{ id: "week", label: "See it in This week", href: "/teaching/week", emphasis: "primary" }];
  else if (checkinOpen)
    actions = [
      { id: "scan", label: "Check in with code", href: `${href}?check-in=scan`, emphasis: "primary" },
      { id: "self", label: "Check in without code", emphasis: "text" },
    ];
  else if (!isToday)
    actions = [
      { id: "details", label: "Details", href, emphasis: "primary" },
      ...(input.calendar ? [{ id: "calendar", label: "Add to calendar", emphasis: "secondary" as const }] : []),
    ];
  else if (session.hasJoinLink && input.joinUrl)
    actions = [
      { id: "join", label: joinLabel(input.joinUrl), href: input.joinUrl, external: true, emphasis: "primary" },
      { id: "details", label: "Details", href, emphasis: "secondary" },
    ];
  else actions = [{ id: "details", label: "Details", href, emphasis: "primary" }];

  return {
    eyebrowRight: !isToday
      ? input.hadToday
        ? "Nothing more today"
        : "No teaching today"
      : on
        ? "On now"
        : startsIn(session, input.now),
    figureDate: isToday ? null : shortDayLabel(perthDateKey(session.startsAt)),
    figure: perthTime(session.startsAt),
    figureEnd: `–${perthTime(session.endsAt)}`,
    title: session.title,
    meta: joinMeta([
      session.venue,
      (input.showTeam || href === null) && teamLabel(session, input.teams),
      checkinOpen && `check-in open until ${perthTime(isoAt(end + CHECKIN_MARGIN))}`,
      href !== null &&
        isToday &&
        !mark &&
        phase === "upcoming" &&
        `check-in opens ${perthTime(isoAt(start - CHECKIN_MARGIN))}`,
    ]),
    status: mark ? attendanceLabels[mark.method] : null,
    live: isToday && on,
    actions,
  };
}

export function restOfWeek(
  sessions: readonly SessionSummary[],
  heroId: string | null,
  now: Date,
  today: string,
): string {
  const remaining = sessions.filter(
    (s) => s.occurrenceId !== heroId && running(s) && Date.parse(s.endsAt) > now.getTime(),
  ).length;
  const cancelledToday = sessions.find(
    (s) => !running(s) && perthDateKey(s.startsAt) === today && Date.parse(s.startsAt) > now.getTime(),
  );
  const parts = [
    remaining > 0 && withUnit(remaining, remaining === 1 ? "more session" : "more sessions"),
    cancelledToday && `today's ${perthTime(cancelledToday.startsAt)} is cancelled`,
  ].filter((p): p is string => Boolean(p));
  return parts.length > 0 ? parts.join(" · ") : "Nothing else this week";
}

export function weekDays(monday: string, sessions: readonly SessionSummary[], today: string): DayRailDay[] {
  return Array.from({ length: 7 }, (_, index) => {
    const key = addDays(monday, index);
    const { weekday, day } = dayParts(key);
    return {
      key,
      weekday,
      day,
      count: sessions.filter((s) => running(s) && perthDateKey(s.startsAt) === key).length,
      past: key < today,
    };
  });
}

/** Part 2's relocated occurrence ids are `<on_call_entries.id>@<YYYY-MM-DD>`. */
export function relocatedEntryId(occurrenceId: string): string {
  return occurrenceId.split("@")[0];
}
