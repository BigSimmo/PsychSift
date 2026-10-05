import { attendanceWeeks, type AttendanceWeek } from "@/components/teaching/attendance-chart";
import {
  addDays,
  dayParts,
  mondayOf,
  perthDateKey,
  perthTime,
  shortDayLabel,
} from "@/components/teaching/teaching-dates";
import { withUnit } from "@/components/teaching/teaching-number";
import type { CpdReviewRow, SessionRef } from "@/lib/teaching/depth-model";
import type { LogbookRow } from "@/lib/teaching/model";
import {
  currentTerm,
  epaSummary,
  milestoneLabels,
  nextMilestone,
  termWeekCount,
  termWeekOf,
  weekdayDayMonth,
  type TermRecord,
  type TermTrackerState,
} from "@/lib/teaching/term-tracker";

/*
 * Pure shaping for My record (mock-up v5 screen 03). Every count the page prints comes from here,
 * so the headline, the chart, the gap line and the summaries can never disagree.
 */

const DAY = 86_400_000;
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

function longDayMonth(key: string): string {
  const [, month, day] = key.split("-").map(Number);
  return `${day} ${MONTHS_LONG[month - 1]}`;
}

const hoursText = (hours: number) => withUnit(Number(hours.toFixed(2)).toString(), "h");
const sessions = (count: number) => withUnit(count, count === 1 ? "session" : "sessions");

/** The Term row: "Term 4 · week 6 of 10" over "Mid-term due Thu 15 Oct · 7 EPAs logged this year". */
export function termRow(state: TermTrackerState, today: string): { title: string; meta: string } {
  const term = currentTerm(state);
  if (!term) return { title: "Track your term", meta: "Term assessments, EPAs and supervisor meeting" };
  const total = termWeekCount(term);
  const week = termWeekOf(term, today);
  const title =
    [
      term.number ? `Term ${term.number}` : null,
      week >= 1 && week <= total ? `week ${withUnit(week, "of")} ${total}` : null,
    ]
      .filter(Boolean)
      .join(" · ") || term.unit;
  const next = nextMilestone(term);
  const epas = epaSummary(state, term.id, today).year;
  return {
    title,
    meta: [
      next ? `${milestoneLabels[next].short} due ${weekdayDayMonth(term.milestones[next].dueOn)}` : "All three done",
      `${withUnit(epas, epas === 1 ? "EPA" : "EPAs")} logged this year`,
    ].join(" · "),
  };
}

export type RecordChart = {
  weeks: AttendanceWeek[];
  currentKey: string;
  total: number;
  /** "You checked in at teaching in 11 of the last 12 weeks." */
  headline: string;
  /** Average over the 11 full weeks before this one; null when there were none. */
  average: number | null;
  averageLabel: string | null;
  axis: [string, string, string];
  /** "None in the week of 7 September. This week so far: 1." */
  gapLine: string;
  /** The same facts for a screen reader, since the bars are drawn. */
  description: string;
};

export function recordChart(rows: readonly LogbookRow[], today: string): RecordChart {
  const weeks = attendanceWeeks(
    rows.map((row) => row.startsAt),
    today,
  );
  const currentKey = mondayOf(today);
  const total = weeks.reduce((sum, week) => sum + week.count, 0);
  const attended = weeks.filter((week) => week.count > 0).length;
  const full = weeks.slice(0, -1);
  const fullTotal = full.reduce((sum, week) => sum + week.count, 0);
  const average = fullTotal > 0 ? fullTotal / full.length : null;
  const averageLabel = average === null ? null : `average ${average.toFixed(1)} a week`;
  const missed = full.filter((week) => week.count === 0);
  const thisWeek = weeks[weeks.length - 1].count;
  const gap =
    missed.length === 0
      ? null
      : missed.length === 1
        ? `None in the week of ${longDayMonth(missed[0].key)}.`
        : `None in ${withUnit(missed.length, "weeks")}.`;
  const label = (week: AttendanceWeek) => `${dayParts(week.key).day} ${dayParts(week.key).month}`;
  return {
    weeks,
    currentKey,
    total,
    headline:
      attended === 0
        ? `No teaching check-ins in the last ${withUnit(12, "weeks")}.`
        : `You checked in at teaching in ${withUnit(attended, "of")} the last ${withUnit(12, "weeks")}.`,
    average,
    averageLabel,
    axis: [label(weeks[0]), label(weeks[6]), "This week"],
    gapLine: [gap, `This week so far: ${thisWeek}.`].filter(Boolean).join(" "),
    description: `Sessions per week, ${longDayMonth(weeks[0].key)} to this week: ${weeks.map((w) => w.count).join(", ")}.${
      average === null ? "" : ` Average ${average.toFixed(1)} a week over the 11 full weeks.`
    }`,
  };
}

/** "Tue 29 Sep · 12:30" for a session that still wants your feedback. */
export function feedbackMeta(session: SessionRef): string {
  return `${shortDayLabel(perthDateKey(session.startsAt))} · ${perthTime(session.startsAt)}`;
}

export type CpdWeek = {
  rows: (CpdReviewRow & { meta: string })[];
  /** "3.5 h · 1 already logged". */
  right: string | null;
  /** Unlogged sessions older than this week, which stay on the full review page. */
  older: number;
};

/** Attended sessions from the last seven days not yet in CPD, and how many of that week are already in. */
export function cpdWeek(review: readonly CpdReviewRow[], logbook: readonly LogbookRow[], now: Date): CpdWeek {
  const since = now.getTime() - 7 * DAY;
  const recent = (iso: string) => Date.parse(iso) >= since;
  const rows = review
    .filter((row) => recent(row.startsAt))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .map((row) => ({ ...row, meta: shortDayLabel(perthDateKey(row.startsAt)) }));
  const logged = logbook.filter((row) => row.cpdEntryId !== null && recent(row.startsAt)).length;
  const hours = rows.reduce((sum, row) => sum + row.hours, 0);
  const right = [rows.length ? hoursText(hours) : null, logged ? `${logged} already logged` : null]
    .filter(Boolean)
    .join(" · ");
  return { rows, right: right || null, older: review.length - rows.length };
}

/** "Log 3 sessions to my CPD". */
export function cpdButtonLabel(count: number): string {
  return `Log ${withUnit(count, count === 1 ? "session" : "sessions")} to my CPD`;
}

/**
 * The supervisor summary: counts only. Within the current term when one is set up, else the last 12
 * weeks, so the row always says which span it covers.
 */
export function supervisorSummary(
  rows: readonly LogbookRow[],
  term: TermRecord | null,
  today: string,
): { title: string; meta: string } {
  const from = term ? term.startsOn : addDays(mondayOf(today), -77);
  const to = term ? term.endsOn : today;
  const inSpan = rows.filter((row) => {
    const key = perthDateKey(row.startsAt);
    return key >= from && key <= to;
  });
  const hours = inSpan.reduce((sum, row) => sum + (Date.parse(row.endsAt) - Date.parse(row.startsAt)) / 3_600_000, 0);
  return {
    title: term?.number
      ? `Term ${term.number} attendance summary`
      : `Attendance summary, last ${withUnit(12, "weeks")}`,
    meta: inSpan.length ? `${sessions(inSpan.length)} · ${hoursText(hours)}` : "No check-ins in this span yet",
  };
}
