import { sessionPhase } from "@/components/teaching/session-phase";
import { addDays, dayParts, perthDateKey, perthTime } from "@/components/teaching/teaching-dates";
import { withUnit } from "@/components/teaching/teaching-number";
import type { SessionSummaryRead } from "@/components/teaching/teaching-reads";
import { sessionHref, teamLabel } from "@/components/teaching/teaching-view-model";
import { RELOCATED_SERVICE_ID, type AttendanceMark, type TeamSummary } from "@/lib/teaching/model";

/*
 * Pure shaping for This week (mock-up v5 screen 01). Perth wall-clock, 24-hour, NBSP before units.
 * Every count the page prints comes from here, so the words and the list can never disagree.
 */

const MINUTE = 60_000;
const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const running = (s: SessionSummaryRead) => s.status !== "cancelled";
const byStart = (a: SessionSummaryRead, b: SessionSummaryRead) =>
  a.startsAt.localeCompare(b.startsAt) || a.title.localeCompare(b.title);
export const isFromOnCall = (s: SessionSummaryRead) =>
  s.source === "on_call_relocated" || s.serviceId === RELOCATED_SERVICE_ID;

function parts(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return { weekday: WEEKDAYS_LONG[date.getUTCDay()], day: date.getUTCDate(), month: MONTHS_LONG[date.getUTCMonth()] };
}

/** "5 to 9 October", or "28 September to 2 October" across a month end. */
export function weekTitle(first: string, last: string): string {
  const a = parts(first);
  const b = parts(last);
  return a.month === b.month ? `${a.day} to ${b.day} ${b.month}` : `${a.day} ${a.month} to ${b.day} ${b.month}`;
}

/** "Tuesday 6 · today", "Wednesday 7". */
export function dayHeading(dateKey: string, today: string): string {
  const p = parts(dateKey);
  return dateKey === today ? `${p.weekday} ${p.day} · today` : `${p.weekday} ${p.day}`;
}

/** Monday to Friday, or the whole week when anything runs at the weekend. */
export function weekDayKeys(monday: string, sessions: readonly SessionSummaryRead[]): string[] {
  const all = Array.from({ length: 7 }, (_, index) => addDays(monday, index));
  const weekend = sessions.some((s) => running(s) && all.slice(5).includes(perthDateKey(s.startsAt)));
  return weekend ? all : all.slice(0, 5);
}

export type StripDay = { key: string; weekday: string; day: string; count: number; today: boolean };

export function stripDays(keys: readonly string[], sessions: readonly SessionSummaryRead[], today: string): StripDay[] {
  return keys.map((key) => {
    const { weekday, day } = dayParts(key);
    return {
      key,
      weekday,
      day,
      count: sessions.filter((s) => running(s) && perthDateKey(s.startsAt) === key).length,
      today: key === today,
    };
  });
}

/** The sessions on one day, in time order. */
export function sessionsOn(sessions: readonly SessionSummaryRead[], dateKey: string): SessionSummaryRead[] {
  return sessions.filter((s) => perthDateKey(s.startsAt) === dateKey).sort(byStart);
}

/** How many sessions run this week, and the words for it. `partial` says some may be missing. */
export function weekCountLabel(
  sessions: readonly SessionSummaryRead[],
  partial: boolean,
  prefix = "This week",
): string {
  const count = sessions.filter(running).length;
  if (count === 0 && !partial) return `${prefix} · nothing booked yet`;
  const noun = count === 1 ? "session" : "sessions";
  return partial ? `${prefix} · at least ${withUnit(count, noun)}` : `${prefix} · ${withUnit(count, noun)}`;
}

export type RowState = "now" | "done" | "past" | "cancelled" | "moved" | "upcoming";

export type ThisWeekRow = {
  id: string;
  href: string | null;
  time: string;
  title: string;
  meta: string;
  state: RowState;
  fromOnCall: boolean;
  checkedIn: string | null;
};

export function weekRow(
  session: SessionSummaryRead,
  context: { teams: readonly TeamSummary[]; attendance: readonly AttendanceMark[]; showTeam: boolean; now: Date },
): ThisWeekRow {
  const start = Date.parse(session.startsAt);
  const end = Date.parse(session.endsAt);
  const time = context.now.getTime();
  const fromOnCall = isFromOnCall(session);
  const mark = context.attendance.find((item) => item.occurrenceId === session.occurrenceId) ?? null;
  const cancelled = session.status === "cancelled";
  const state: RowState = cancelled
    ? "cancelled"
    : time >= start && time < end
      ? "now"
      : mark
        ? "done"
        : time >= end
          ? "past"
          : session.status === "moved"
            ? "moved"
            : "upcoming";
  const was = session.status === "moved" && session.previousStartsAt ? perthTime(session.previousStartsAt) : null;
  const where = session.venue ?? (session.hasJoinLink ? "Online" : "Room to confirm");
  const pieces = [
    state === "now" && "On now",
    fromOnCall && "From On Call",
    cancelled ? "Cancelled" : session.status === "moved" ? (was ? `Moved from ${was}` : "Moved") : null,
    !cancelled && where,
    !cancelled && session.venue && session.hasJoinLink && "also online",
    !cancelled && session.isPresenter && "you present",
    context.showTeam && !fromOnCall && teamLabel(session, context.teams),
    state === "done" && "checked in",
    state === "past" && !fromOnCall && "no check-in recorded",
  ].filter((p): p is string => Boolean(p));
  return {
    id: session.occurrenceId,
    href: sessionHref(session),
    time: session.allDay ? "All day" : perthTime(session.startsAt),
    title: session.title,
    meta: pieces.join(" · "),
    state,
    fromOnCall,
    checkedIn: mark ? mark.method : null,
  };
}

export type NowPanel = {
  session: SessionSummaryRead;
  /** "On now · 12:30 to 13:30", "Next · today 14:00 · in 85 min", "Next · Wed 7 Oct 08:00". */
  kicker: string;
  live: boolean;
  meta: string;
  /** Elapsed share of a running session, 0–100; null before it starts. */
  elapsed: number | null;
  checkIn: "open" | "done" | "not-yet" | "none";
  doneLabel: string | null;
  opensAt: string | null;
};

function duration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return withUnit(rest, "min");
  return rest ? `${withUnit(hours, "h")} ${withUnit(rest, "min")}` : withUnit(hours, "h");
}

/** The session on now, else the next one that has not ended; null when nothing is ahead. */
export function nowPanel(
  sessions: readonly SessionSummaryRead[],
  context: {
    teams: readonly TeamSummary[];
    attendance: readonly AttendanceMark[];
    showTeam: boolean;
    now: Date;
    today: string;
  },
): NowPanel | null {
  const time = context.now.getTime();
  const session =
    [...sessions].sort(byStart).find((s) => running(s) && !s.allDay && Date.parse(s.endsAt) > time) ?? null;
  if (!session) return null;
  const start = Date.parse(session.startsAt);
  const end = Date.parse(session.endsAt);
  const live = time >= start;
  const isToday = perthDateKey(session.startsAt) === context.today;
  const range = `${perthTime(session.startsAt)} to ${perthTime(session.endsAt)}`;
  const mark = context.attendance.find((item) => item.occurrenceId === session.occurrenceId) ?? null;
  const phase = sessionPhase(session, context.now);
  const canCheckIn = sessionHref(session) !== null;
  const kicker = live
    ? `On now · ${range}`
    : isToday
      ? `Next · today ${perthTime(session.startsAt)} · in ${duration(Math.max(1, Math.ceil((start - time) / MINUTE)))}`
      : `Next · ${dayParts(perthDateKey(session.startsAt)).weekday} ${dayParts(perthDateKey(session.startsAt)).day} ${dayParts(perthDateKey(session.startsAt)).month} ${perthTime(session.startsAt)}`;
  const meta = [
    session.venue ?? (session.hasJoinLink ? "Online" : "Room to confirm"),
    (context.showTeam || isFromOnCall(session)) && teamLabel(session, context.teams),
    live && `${duration(Math.max(1, Math.ceil((end - time) / MINUTE)))} left`,
    !live && duration(Math.round((end - start) / MINUTE)),
  ].filter((p): p is string => Boolean(p));
  return {
    session,
    kicker,
    live,
    meta: meta.join(" · "),
    elapsed: live ? Math.round(((time - start) / (end - start)) * 100) : null,
    checkIn: !canCheckIn
      ? "none"
      : mark
        ? "done"
        : phase === "checkin" && isToday
          ? "open"
          : isToday
            ? "not-yet"
            : "none",
    doneLabel: mark ? "You checked in" : null,
    opensAt: isToday && phase === "upcoming" ? perthTime(new Date(start - 15 * MINUTE).toISOString()) : null,
  };
}

/** The next session after the panel's that is yours to present, else simply the next one. */
export function nextForYou(
  sessions: readonly SessionSummaryRead[],
  afterId: string | null,
  now: Date,
): SessionSummaryRead | null {
  const ahead = [...sessions]
    .sort(byStart)
    .filter((s) => running(s) && s.occurrenceId !== afterId && Date.parse(s.startsAt) > now.getTime());
  return ahead.find((s) => s.isPresenter) ?? ahead[0] ?? null;
}

/** "You present · room still to confirm", "Seminar Room 1". */
export function nextForYouMeta(session: SessionSummaryRead, today: string): string {
  const day = perthDateKey(session.startsAt);
  const when = day === today ? null : `${dayParts(day).weekday} ${perthTime(session.startsAt)}`;
  return [
    when,
    session.isPresenter && "You present",
    session.venue ??
      (session.hasJoinLink ? "online" : session.isPresenter ? "room still to confirm" : "room to confirm"),
  ]
    .filter((p): p is string => Boolean(p))
    .join(" · ");
}

/** Sessions other services have opened to this reader that are not already in their week. */
export function openFromOtherServices(rows: readonly { own: boolean; inMyWeek: boolean; status: string }[]): number {
  return rows.filter((row) => !row.own && !row.inMyWeek && row.status !== "cancelled").length;
}
