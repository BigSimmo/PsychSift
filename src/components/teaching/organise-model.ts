import type { z } from "zod";

import {
  addDays,
  dayParts,
  durationMinutes,
  mondayOf,
  monthLabel,
  perthDateKey,
  perthTime,
  timeRange,
} from "@/components/teaching/teaching-dates";
import type { LedgerGroup } from "@/components/teaching/teaching-modules";
import { withUnit } from "@/components/teaching/teaching-number";
import {
  attendanceLabels,
  teachingCpdEntryHref,
  type GroupRow,
  type LogbookRow,
  type organiseResultSchema,
  type SeriesAudience,
  type SeriesRow as ModelSeriesRow,
  type SessionSummary,
} from "@/lib/teaching/model";

/*
 * Pure shaping for the Logbook and Organise. Perth wall-clock, 24-hour, a
 * non-breaking space before every unit. Nothing here reads or writes the
 * device: the CSV is built from rows already on screen.
 */

/** The addendum's S10 `SeriesRow`. `openTo` and `audience` are already optional on the model. */
export type SeriesRow = ModelSeriesRow;
export type { GroupRow };
export type OrganiseMember = z.infer<typeof organiseResultSchema>["members"][number];
export type OrganiseRead = { series: SeriesRow[]; groups: GroupRow[]; members: OrganiseMember[] };
export type Risk = { occurrenceId: string; rule: "room" | "clash"; text: string };
export type ChangeDraft = {
  status: "moved" | "cancelled";
  date: string;
  startTime: string;
  minutes: number;
  venue: string;
  reason: string;
};

/** Master plan R4: the words the series sheet's Audience picker shows. */
export const AUDIENCE_LABELS: Record<SeriesAudience, string> = {
  interns: "Interns",
  residents: "Residents",
  registrars: "Registrars",
  consultants: "Consultants",
  all_doctors: "All doctors",
};

/** Mock-up v5: a series row reads "Weekly · Tue 12:30 · everyone". */
const REPEAT_SHORT: Record<string, string> = {
  once: "Once",
  weekly: "Weekly",
  fortnightly: "Fortnightly",
  monthly_nth: "Monthly",
};

export function seriesMeta(series: SeriesRow): string {
  const weekday = /^\d{4}-\d{2}-\d{2}$/.test(series.firstDate) ? dayParts(series.firstDate).weekday : null;
  const audience = series.audience
    ? series.audience === "all_doctors"
      ? "everyone"
      : AUDIENCE_LABELS[series.audience].toLowerCase()
    : null;
  return [REPEAT_SHORT[series.repeat] ?? null, [weekday, series.startTime].filter(Boolean).join(" "), audience]
    .filter(Boolean)
    .join(" · ");
}

/** One change already posted to members: a session moved or cancelled. */
export type SentChange = {
  id: string;
  title: string;
  /** Perth date key of the changed session. */
  date: string;
  status: "moved" | "cancelled";
  venue: string | null;
  /** Only known when the change was read with its reason; the week read does not carry one. */
  reason: string | null;
};

/** The changes the week read shows: this service's own sessions that were moved or cancelled. */
export function sentChanges(sessions: readonly SessionSummary[]): SentChange[] {
  return sessions
    .filter((s) => s.source === "teaching" && (s.status === "moved" || s.status === "cancelled"))
    .map((s) => ({
      id: s.occurrenceId,
      title: s.title,
      date: perthDateKey(s.startsAt),
      status: s.status === "cancelled" ? ("cancelled" as const) : ("moved" as const),
      venue: s.venue,
      reason: null,
    }));
}

/** "Clinical skills workshop, Thu 12 Nov" over "Moved to Simulation suite B · room clash". */
export function sentChangeLines(change: SentChange): { title: string; meta: string } {
  const { weekday, day, month } = dayParts(change.date);
  const what = change.status === "cancelled" ? "Cancelled" : change.venue ? `Moved to ${change.venue}` : "Moved";
  return {
    title: `${change.title}, ${weekday} ${day} ${month}`,
    meta: [what, change.reason].filter(Boolean).join(" · "),
  };
}

/** The 48-hour list names a risk in a short lower-case phrase after the day: "Today · no room set". */
export function riskPhrase(risk: Risk): string {
  if (risk.rule === "room") return "no room set";
  return risk.text.charAt(0).toLowerCase() + risk.text.slice(1);
}

const overlaps = (a: SessionSummary, b: SessionSummary) =>
  Date.parse(a.startsAt) < Date.parse(b.endsAt) && Date.parse(b.startsAt) < Date.parse(a.endsAt);

/** The rules the change sheet and the 48-hour list both name. Only one service's own sessions can clash. */
export function sessionRisks(sessions: readonly SessionSummary[]): Risk[] {
  const running = sessions.filter((s) => s.status !== "cancelled" && s.source === "teaching");
  return running.flatMap((s) => {
    const risks: Risk[] = [];
    if (!s.venue && !s.hasJoinLink)
      risks.push({ occurrenceId: s.occurrenceId, rule: "room", text: "Room not confirmed" });
    const other = running.find(
      (o) => o.occurrenceId !== s.occurrenceId && o.serviceId === s.serviceId && overlaps(o, s),
    );
    if (other)
      risks.push({
        occurrenceId: s.occurrenceId,
        rule: "clash",
        text: `Clashes with ${other.title} at ${perthTime(other.startsAt)}`,
      });
    return risks;
  });
}

export function draftFor(session: SessionSummary): ChangeDraft {
  return {
    status: "moved",
    date: perthDateKey(session.startsAt),
    startTime: perthTime(session.startsAt),
    minutes: durationMinutes(session.startsAt, session.endsAt),
    venue: session.venue ?? "",
    reason: "presenter_unavailable",
  };
}

/** Perth has no daylight saving, so +08:00 is exact. An unreadable date or time keeps the session's own. */
export function afterChange(session: SessionSummary, draft: ChangeDraft): SessionSummary {
  if (draft.status === "cancelled") return { ...session, status: "cancelled" };
  const start = Date.parse(`${draft.date}T${draft.startTime}:00+08:00`);
  const startsAt = Number.isFinite(start) ? new Date(start).toISOString() : session.startsAt;
  const endsAt = Number.isFinite(start) ? new Date(start + draft.minutes * 60_000).toISOString() : session.endsAt;
  return { ...session, status: "moved", startsAt, endsAt, venue: draft.venue.trim() || null };
}

/** A move that leaves the time and the room as they were has nothing to tell anyone. */
export function draftChangesSomething(session: SessionSummary, draft: ChangeDraft): boolean {
  if (draft.status === "cancelled") return true;
  const after = afterChange(session, draft);
  return (
    Date.parse(after.startsAt) !== Date.parse(session.startsAt) ||
    Date.parse(after.endsAt) !== Date.parse(session.endsAt) ||
    (after.venue ?? null) !== (session.venue ?? null)
  );
}

export function changeRisks(session: SessionSummary, draft: ChangeDraft, others: readonly SessionSummary[]): Risk[] {
  const after = afterChange(session, draft);
  return sessionRisks([after, ...others.filter((o) => o.occurrenceId !== session.occurrenceId)]).filter(
    (r) => r.occurrenceId === session.occurrenceId,
  );
}

export function changeBody(session: SessionSummary, draft: ChangeDraft): Record<string, unknown> {
  if (draft.status === "cancelled")
    return {
      action: "occurrence.change",
      occurrenceId: session.occurrenceId,
      status: "cancelled",
      reason: draft.reason,
    };
  const after = afterChange(session, draft);
  return {
    action: "occurrence.change",
    occurrenceId: session.occurrenceId,
    status: "moved",
    startsAt: after.startsAt,
    endsAt: after.endsAt,
    venue: after.venue,
    reason: draft.reason,
  };
}

/**
 * Master plan R9: a posted change reaches the members expected at that
 * session (its series' groups), or the whole service when the series has no
 * groups or is not known yet. Only active members are counted.
 */
export function expectedMemberCount(read: OrganiseRead, seriesId: string | null | undefined): number {
  const series = seriesId ? read.series.find((s) => s.seriesId === seriesId) : undefined;
  if (!series || series.groupIds.length === 0) return read.members.length;
  const active = new Set(read.members.map((m) => m.userId));
  const expected = new Set<string>();
  for (const group of read.groups)
    if (series.groupIds.includes(group.groupId))
      for (const userId of group.userIds) if (active.has(userId)) expected.add(userId);
  return expected.size;
}

const hours = (row: { startsAt: string; endsAt: string }) => durationMinutes(row.startsAt, row.endsAt) / 60;
const hoursText = (value: number) => String(Math.round(value * 100) / 100);

export function logbookFigures(
  rows: readonly LogbookRow[],
  today: string,
): { id: string; label: string; value: string; unit?: string }[] {
  const termStart = addDays(mondayOf(today), -77); // the chart's 12 weeks
  const term = rows.filter((r) => perthDateKey(r.startsAt) >= termStart);
  return [
    { id: "term", label: "This term", value: String(term.length), unit: term.length === 1 ? "session" : "sessions" },
    { id: "hours", label: "Hours", value: hoursText(term.reduce((sum, r) => sum + hours(r), 0)), unit: "h" },
    { id: "unlogged", label: "Not in CPD", value: String(rows.filter((r) => !r.cpdEntryId).length) },
  ];
}

/** The ledger by month, newest first. An unlogged row opens Log to CPD; a logged one links to its CPD entry. */
export function logbookGroups(rows: readonly LogbookRow[], onLog: (row: LogbookRow) => void): LedgerGroup[] {
  const byMonth = new Map<string, LogbookRow[]>();
  for (const r of [...rows].sort((a, b) => b.startsAt.localeCompare(a.startsAt))) {
    const key = perthDateKey(r.startsAt).slice(0, 7);
    byMonth.set(key, [...(byMonth.get(key) ?? []), r]);
  }
  return [...byMonth.entries()].map(([key, list]) => ({
    id: key,
    label: monthLabel(`${key}-01`),
    total: withUnit(hoursText(list.reduce((sum, r) => sum + hours(r), 0)), "h"),
    rows: list.map((r) => {
      const { weekday, day } = dayParts(perthDateKey(r.startsAt));
      return {
        id: `${r.occurrenceId}-${r.recordedAt}`,
        day,
        weekday,
        title: r.title,
        status: `${attendanceLabels[r.method]} · ${r.cpdEntryId ? "In CPD" : "Not in CPD"}`,
        hours: hoursText(hours(r)),
        href: r.cpdEntryId ? teachingCpdEntryHref(r.cpdEntryId) : null,
        onSelect: r.cpdEntryId ? undefined : () => onLog(r),
      };
    }),
  }));
}

/** One CSV cell: quoted when it holds a comma, quote or line break; a leading formula character is neutralised. */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function csvText(header: readonly string[], rows: readonly (readonly string[])[]): string {
  return [header.join(","), ...rows.map((cells) => cells.map(csvCell).join(","))].join("\r\n");
}

/** The reader's own attendance, from the rows already on screen. */
export function attendanceCsv(rows: readonly LogbookRow[]): string {
  return csvText(
    ["Date", "Start", "End", "Session", "Service", "How", "In CPD"],
    rows.map((r) => {
      const [start, end] = timeRange(r.startsAt, r.endsAt).split("–");
      return [
        perthDateKey(r.startsAt),
        start,
        end,
        r.title,
        r.serviceName,
        attendanceLabels[r.method],
        r.cpdEntryId ? "Yes" : "No",
      ];
    }),
  );
}

/** A `data:` link for a CSV: nothing is uploaded and nothing is stored. */
export function csvHref(csv: string): string {
  return `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
}
