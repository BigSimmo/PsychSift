import { perthDateKey, perthTime, shortDayLabel } from "@/components/teaching/teaching-dates";
import { durationText, withUnit } from "@/components/teaching/teaching-number";
import type { SessionSummaryRead } from "@/components/teaching/teaching-reads";
import { isFromOnCall } from "@/components/teaching/this-week-model";
import { sessionHref, teamLabel } from "@/components/teaching/teaching-view-model";
import type { AttendanceMark, AttendanceMethod, TeamSummary } from "@/lib/teaching/model";

/*
 * Pure shaping for Teaching's Today hero (work-mode redesign, owner request 6 Oct 2026). Perth
 * wall-clock, 24-hour, NBSP before units. The windows are the server's (session-phase.ts): the
 * code from 15 minutes before the start to 15 minutes after the end, check in without code from
 * the start. "After" is the stretch from the end until the code closes, when the useful taps are
 * Log to CPD and Feedback.
 */

const MINUTE = 60_000;
const MARGIN = 15 * MINUTE;

export type TodayPhase = "later" | "before" | "code" | "on" | "after";

const running = (s: SessionSummaryRead) => s.status !== "cancelled" && !s.allDay;
const byStart = (a: SessionSummaryRead, b: SessionSummaryRead) =>
  a.startsAt.localeCompare(b.startsAt) || a.title.localeCompare(b.title);

export function todayPhase(session: Pick<SessionSummaryRead, "startsAt" | "endsAt">, now: Date, today: string) {
  const time = now.getTime();
  const start = Date.parse(session.startsAt);
  const end = Date.parse(session.endsAt);
  if (time < start - MARGIN) return perthDateKey(session.startsAt) === today ? "before" : "later";
  if (time < start) return "code";
  if (time < end) return "on";
  return "after";
}

/**
 * The hero's session: the one on now, else one that ended within the last 15 minutes (the latest),
 * else the next that has not ended. Null when nothing is ahead or just behind.
 */
export function heroSession(sessions: readonly SessionSummaryRead[], now: Date): SessionSummaryRead | null {
  const time = now.getTime();
  const list = [...sessions].filter(running).sort(byStart);
  const on = list.find((s) => Date.parse(s.startsAt) <= time && Date.parse(s.endsAt) > time);
  if (on) return on;
  const finished = list.filter((s) => Date.parse(s.endsAt) <= time && Date.parse(s.endsAt) + MARGIN >= time).at(-1);
  if (finished) return finished;
  return list.find((s) => Date.parse(s.endsAt) > time) ?? null;
}

/** "4:45" over "to start", or "40" over "min to start"; the spoken form says it whole. */
export function countdown(session: Pick<SessionSummaryRead, "startsAt">, now: Date) {
  const minutes = Math.max(1, Math.ceil((Date.parse(session.startsAt) - now.getTime()) / MINUTE));
  const hours = Math.floor(minutes / 60);
  return {
    figure: hours > 0 ? `${hours}:${String(minutes % 60).padStart(2, "0")}` : String(minutes),
    label: hours > 0 ? "to start" : "min to start",
    spoken: `Starts in ${durationText(minutes)}`,
    // The ring fills over the last 12 hours before the start.
    fraction: 1 - Math.min(minutes, 720) / 720,
  };
}

/** How far through a running session: the share elapsed and the minutes left. */
export function progress(session: Pick<SessionSummaryRead, "startsAt" | "endsAt">, now: Date) {
  const start = Date.parse(session.startsAt);
  const end = Date.parse(session.endsAt);
  const time = now.getTime();
  return {
    percent: Math.max(0, Math.min(100, Math.round(((time - start) / Math.max(1, end - start)) * 100))),
    left: `${durationText(Math.max(1, Math.ceil((end - time) / MINUTE)))} left`,
  };
}

/** Lower case, for a kicker: "checked in by code", "self-reported". */
export function markWords(method: AttendanceMethod): string {
  return method === "self" ? "self-reported" : "checked in by code";
}

export type HeroText = { kicker: string; meta: string; note: string | null };

/** The hero's kicker, meta line and one note, by phase. */
export function heroText(
  session: SessionSummaryRead,
  input: {
    phase: TodayPhase;
    now: Date;
    teams: readonly TeamSummary[];
    showTeam: boolean;
    mark: AttendanceMark | null;
    loggedHours: number | null;
    hadToday: boolean;
    canCheckIn: boolean;
  },
): HeroText {
  const { phase, mark } = input;
  const start = Date.parse(session.startsAt);
  const end = Date.parse(session.endsAt);
  const range = `${perthTime(session.startsAt)} to ${perthTime(session.endsAt)}`;
  const place = session.venue ?? (session.hasJoinLink ? "Online" : "Room to confirm");
  const team =
    (input.showTeam || isFromOnCall(session) || sessionHref(session) === null) && teamLabel(session, input.teams);
  const minutes = Math.round((end - start) / MINUTE);
  const at = (ms: number) => perthTime(new Date(ms).toISOString());

  if (phase === "after") {
    return {
      kicker: [
        `Finished ${perthTime(session.endsAt)}`,
        mark ? markWords(mark.method) : null,
        input.loggedHours !== null ? "logged to CPD" : null,
      ]
        .filter(Boolean)
        .join(" · "),
      meta: [place, team, durationText(minutes)].filter(Boolean).join(" · "),
      note:
        input.loggedHours !== null
          ? `${withUnit(input.loggedHours, "h")} added to your CPD log`
          : !mark && input.canCheckIn
            ? `Check in without code works until 7 days after it ends.`
            : null,
    };
  }
  if (phase === "on") {
    return {
      kicker: `On now · ${range}`,
      meta: [place, team].filter(Boolean).join(" · "),
      note: !mark && input.canCheckIn ? `Open until ${at(end + MARGIN)} · organisers see who checked in` : null,
    };
  }
  if (phase === "later") {
    return {
      kicker: `Next up · ${shortDayLabel(perthDateKey(session.startsAt))}`,
      meta: [range, place, team].filter(Boolean).join(" · "),
      note: input.hadToday ? "Nothing more today" : "No teaching today",
    };
  }
  return {
    kicker: "Next up · today",
    meta: [range, place, team].filter(Boolean).join(" · "),
    note:
      !input.canCheckIn || mark
        ? null
        : phase === "code"
          ? `One-tap check in opens when it starts at ${perthTime(session.startsAt)}.`
          : `Check-in opens ${at(start - MARGIN)}${session.hasJoinLink ? " · also online" : ""}`,
  };
}
