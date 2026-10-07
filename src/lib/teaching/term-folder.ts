import { cmeCsvCell } from "@/lib/cme/export";
import type { SupervisionPairingView } from "@/lib/teaching/depth-model";
import { attendanceLabels, type LogbookRow } from "@/lib/teaching/model";
import { perthDate } from "@/lib/teaching/time";
import {
  daysBetween,
  epaSummary,
  milestoneIds,
  milestoneLabels,
  milestoneState,
  termWeekCount,
  termWeekOf,
  TERM_TRACKER_SOURCES,
  weekdayDayMonth,
  dayMonth,
  type MilestoneId,
  type TermRecord,
  type TermTrackerState,
} from "@/lib/teaching/term-tracker";

/*
 * The term evidence folder (feature 12, 6 Oct 2026): the doctor's own term, gathered in one place from
 * records PsychSift already holds, ready to show a supervisor or to keep for accreditation.
 *
 * It reads three things and stores nothing new: teaching check-ins (`/api/teaching?view=logbook`),
 * supervision logs (`/api/teaching/depth?view=supervision`, the reader's own pairings as registrar) and
 * the term tracker kept on this device (dates, assessment dates marked done, EPA counts). It holds
 * status and counts only. Assessment forms, ratings and comments live in Clinical Learning Australia and
 * with the Medical Education Unit, never here, and the folder says so on screen and in the export.
 *
 * Statuses describe what the records show, never a judgement against an invented standard: a part is
 * "to fix" only when a date the doctor set has passed, or the term has ended short of a target the
 * doctor chose. Every figure is computed here so the meter, the screen-reader sentence, the lists and
 * the CSV can never disagree.
 */

export const TERM_FOLDER_PATH = "/teaching/term/folder";

export const folderStatuses = ["complete", "on_track", "to_fix", "not_updating", "not_started"] as const;
export type FolderStatus = (typeof folderStatuses)[number];

export const folderStatusWords: Record<FolderStatus, string> = {
  complete: "complete",
  on_track: "on track",
  to_fix: "to fix",
  not_updating: "not updating",
  not_started: "not started",
};

/** Section headings on the page, in the order they appear (what needs action first). */
export const folderSectionOrder: readonly FolderStatus[] = [
  "to_fix",
  "not_updating",
  "on_track",
  "complete",
  "not_started",
];

export const folderSectionLabels: Record<FolderStatus, string> = {
  to_fix: "To fix",
  not_updating: "Not updating",
  on_track: "On track",
  complete: "Complete",
  not_started: "Still to come",
};

export type FolderPartId = "details" | "attendance" | "supervision" | MilestoneId | "epas";
export type FolderIcon = "term" | "attendance" | "supervision" | "assessment" | "epa";

export interface FolderPart {
  readonly id: FolderPartId;
  readonly label: string;
  readonly status: FolderStatus;
  /** One short line: counts and dates only. */
  readonly detail: string;
  readonly icon: FolderIcon;
  /** Where the doctor fixes or adds to this part. */
  readonly href: string;
  /** The detail with people's names left out, for an export with names off. */
  readonly detailWithoutNames?: string;
}

/** What a remote source has given the folder so far. */
export type FolderSource<T> =
  | { readonly status: "ready"; readonly data: T }
  | { readonly status: "loading" }
  | { readonly status: "failed" }
  /** The latest read failed, but an earlier one on this visit worked: keep its figures, marked as of then. */
  | { readonly status: "stale"; readonly data: T; readonly asOf: string };

export interface FolderSessionRow {
  readonly date: string;
  readonly title: string;
  readonly serviceName: string;
  readonly hours: number;
  readonly how: string;
  readonly inCpd: boolean;
}

export interface FolderSupervisionRow {
  readonly date: string;
  readonly minutes: number;
  readonly type: string;
  readonly status: "Confirmed" | "Awaiting confirmation";
}

export interface TermFolder {
  readonly termId: string;
  /** "Term 4 · Psychiatry" */
  readonly title: string;
  /** "31 Aug to 6 Nov · week 6 of 10" */
  readonly dates: string;
  readonly phase: "before" | "during" | "ended";
  readonly supervisor: string;
  readonly site: string;
  readonly parts: readonly FolderPart[];
  readonly counts: Record<FolderStatus, number>;
  /** "3 of 7 complete" */
  readonly headline: string;
  /** The meter's words for a screen reader, which cannot see the coloured segments. */
  readonly meterLabel: string;
  /** Still waiting on a source: the meter says so instead of guessing. */
  readonly loading: boolean;
  readonly sessions: readonly FolderSessionRow[];
  readonly supervision: readonly FolderSupervisionRow[];
}

const NBSP = " ";
const unit = (value: number | string, word: string) => `${value}${NBSP}${word}`;
const plural = (count: number, one: string, many: string) => unit(count, count === 1 ? one : many);

function hoursText(hours: number): string {
  return unit(Number(hours.toFixed(2)).toString(), "h");
}

function rowHours(row: Pick<LogbookRow, "startsAt" | "endsAt">): number {
  const ms = Date.parse(row.endsAt) - Date.parse(row.startsAt);
  return Number.isFinite(ms) && ms > 0 ? ms / 3_600_000 : 0;
}

/** The term's title as the doctor set it up: "Term 4 · Psychiatry", or the unit alone. */
export function folderTermTitle(term: Pick<TermRecord, "number" | "unit">): string {
  return [term.number ? `Term ${term.number}` : null, term.unit || null].filter(Boolean).join(" · ") || "This term";
}

export function folderPhase(term: Pick<TermRecord, "startsOn" | "endsOn">, today: string): TermFolder["phase"] {
  if (today < term.startsOn) return "before";
  if (today > term.endsOn) return "ended";
  return "during";
}

function datesLine(term: TermRecord, today: string): string {
  const span = `${dayMonth(term.startsOn)} to ${dayMonth(term.endsOn)}`;
  const phase = folderPhase(term, today);
  if (phase === "before") return `${span} · starts ${weekdayDayMonth(term.startsOn)}`;
  if (phase === "ended") return `${span} · ended`;
  return `${span} · week ${unit(termWeekOf(term, today), "of")} ${termWeekCount(term)}`;
}

/** Check-ins whose Perth date falls inside the term. */
export function sessionsInTerm(rows: readonly LogbookRow[], term: Pick<TermRecord, "startsOn" | "endsOn">) {
  return rows
    .filter((row) => {
      const key = perthDate(row.startsAt);
      return key >= term.startsOn && key <= term.endsOn;
    })
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/** The reader's own supervision as registrar, inside the term. A supervisor's or organiser's view is not theirs. */
export function supervisionInTerm(
  pairings: readonly SupervisionPairingView[],
  term: Pick<TermRecord, "startsOn" | "endsOn">,
) {
  const mine = pairings.filter((pairing) => pairing.access === "registrar");
  const entries = mine
    .flatMap((pairing) => pairing.entries ?? [])
    .filter((entry) => entry.date >= term.startsOn && entry.date <= term.endsOn)
    .sort((a, b) => a.date.localeCompare(b.date));
  return { paired: mine.length > 0, entries };
}

function detailsPart(term: TermRecord): FolderPart {
  const missing = [term.supervisor.trim() ? null : "supervisor", term.unit.trim() ? null : "unit"].filter(
    Boolean,
  ) as string[];
  return {
    id: "details",
    label: "Term details",
    icon: "term",
    href: "/teaching/term",
    status: missing.length ? "to_fix" : "complete",
    detail: missing.length
      ? `Add your ${missing.join(" and ")}`
      : [term.unit, term.supervisor, term.site].filter((part) => part.trim()).join(" · "),
    detailWithoutNames: missing.length
      ? `Add your ${missing.join(" and ")}`
      : [term.unit, term.site].filter((part) => part.trim()).join(" · "),
  };
}

/** A part built from last good figures: not updating, and saying as of when. */
function staleOf(part: FolderPart, asOf: string): FolderPart {
  return { ...part, status: "not_updating", detail: `As of ${asOf} · ${part.detail}` };
}

function attendancePart(
  term: TermRecord,
  today: string,
  source: FolderSource<readonly LogbookRow[]>,
): { part: FolderPart; rows: LogbookRow[] } {
  const base = { id: "attendance" as const, label: "Teaching attendance", icon: "attendance" as const };
  if (source.status === "failed")
    return {
      rows: [],
      part: { ...base, href: "/teaching/logbook", status: "not_updating", detail: "Check-ins did not load" },
    };
  if (source.status === "loading")
    return { rows: [], part: { ...base, href: "/teaching/logbook", status: "not_started", detail: "Loading" } };
  if (source.status === "stale") {
    const kept = attendancePart(term, today, { status: "ready", data: source.data });
    return { rows: kept.rows, part: staleOf(kept.part, source.asOf) };
  }
  const rows = sessionsInTerm(source.data, term);
  if (rows.length === 0)
    return {
      rows,
      part: {
        ...base,
        href: "/teaching/week",
        status: "not_started",
        detail: folderPhase(term, today) === "before" ? "From your first check-in" : "No check-ins this term yet",
      },
    };
  const hours = rows.reduce((sum, row) => sum + rowHours(row), 0);
  const last = rows[rows.length - 1]!;
  return {
    rows,
    part: {
      ...base,
      href: "/teaching/logbook",
      status: folderPhase(term, today) === "ended" ? "complete" : "on_track",
      detail: `${plural(rows.length, "session", "sessions")} · ${hoursText(hours)} · last ${weekdayDayMonth(perthDate(last.startsAt))}`,
    },
  };
}

function supervisionPart(
  term: TermRecord,
  today: string,
  source: FolderSource<readonly SupervisionPairingView[]>,
): { part: FolderPart; rows: FolderSupervisionRow[] } {
  const base = {
    id: "supervision" as const,
    label: "Supervision",
    icon: "supervision" as const,
    href: "/teaching/supervision",
  };
  if (source.status === "failed")
    return { rows: [], part: { ...base, status: "not_updating", detail: "Supervision logs did not load" } };
  if (source.status === "loading") return { rows: [], part: { ...base, status: "not_started", detail: "Loading" } };
  if (source.status === "stale") {
    const kept = supervisionPart(term, today, { status: "ready", data: source.data });
    return { rows: kept.rows, part: staleOf(kept.part, source.asOf) };
  }
  const { paired, entries } = supervisionInTerm(source.data, term);
  const rows = entries.map<FolderSupervisionRow>((entry) => ({
    date: entry.date,
    minutes: entry.minutes,
    type: entry.type === "group" ? "Group" : "Individual",
    status: entry.status === "confirmed" ? "Confirmed" : "Awaiting confirmation",
  }));
  if (!paired) return { rows, part: { ...base, status: "not_started", detail: "No supervision pairing yet" } };
  if (entries.length === 0)
    return { rows, part: { ...base, status: "not_started", detail: "Nothing logged this term yet" } };
  const confirmed = entries.filter((entry) => entry.status === "confirmed");
  const pending = entries.length - confirmed.length;
  const confirmedHours = confirmed.reduce((sum, entry) => sum + entry.minutes, 0) / 60;
  const detail = [
    `${hoursText(confirmedHours)} confirmed`,
    pending ? `${unit(pending, "awaiting")} confirmation` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    rows,
    part: {
      ...base,
      status: folderPhase(term, today) === "ended" && pending === 0 ? "complete" : "on_track",
      detail,
    },
  };
}

function milestonePart(term: TermRecord, id: MilestoneId, today: string): FolderPart {
  const milestone = term.milestones[id];
  const base = { id, label: milestoneLabels[id].long, icon: "assessment" as const, href: "/teaching/term" };
  switch (milestoneState(term, id, today)) {
    case "done":
      return { ...base, status: "complete", detail: `Marked done ${weekdayDayMonth(milestone.doneOn!)}` };
    case "overdue":
      return {
        ...base,
        status: "to_fix",
        detail: `Was due ${weekdayDayMonth(milestone.dueOn)}. Mark it done once signed in CLA`,
      };
    case "due":
      return { ...base, status: "on_track", detail: `Due ${weekdayDayMonth(milestone.dueOn)}` };
    default:
      return { ...base, status: "not_started", detail: `Due ${weekdayDayMonth(milestone.dueOn)}` };
  }
}

function epaPart(state: TermTrackerState, term: TermRecord, today: string): FolderPart {
  const count = epaSummary(state, term.id, today).term;
  const target = state.targets?.perTerm ?? null;
  const base = { id: "epas" as const, label: "EPAs this term", icon: "epa" as const, href: "/teaching/term" };
  const logged = plural(count, "EPA", "EPAs");
  if (target === null)
    return count > 0
      ? { ...base, status: "on_track", detail: `${logged} logged · no target set` }
      : { ...base, status: "not_started", detail: "None logged · no target set" };
  const ofTarget = `${unit(count, "of")} ${target} logged`;
  if (count >= target) return { ...base, status: "complete", detail: ofTarget };
  if (folderPhase(term, today) === "ended")
    return { ...base, status: "to_fix", detail: `${ofTarget} by the end of term` };
  return { ...base, status: count > 0 ? "on_track" : "not_started", detail: ofTarget };
}

export function emptyCounts(): Record<FolderStatus, number> {
  return { complete: 0, on_track: 0, to_fix: 0, not_updating: 0, not_started: 0 };
}

/** "7 parts: 3 complete, 2 on track, 1 to fix, 1 not started." */
export function folderMeterLabel(counts: Record<FolderStatus, number>, loading = false): string {
  const total = folderStatuses.reduce((sum, status) => sum + counts[status], 0);
  const words = (["complete", "on_track", "to_fix", "not_updating", "not_started"] as const)
    .filter((status) => counts[status] > 0)
    .map((status) => `${counts[status]} ${folderStatusWords[status]}`);
  return `${plural(total, "part", "parts")}${words.length ? `: ${words.join(", ")}` : ""}.${loading ? " Still loading." : ""}`;
}

export interface FolderInput {
  readonly today: string;
  readonly state: TermTrackerState;
  readonly term: TermRecord;
  readonly attendance: FolderSource<readonly LogbookRow[]>;
  readonly supervision: FolderSource<readonly SupervisionPairingView[]>;
}

export function buildTermFolder({ today, state, term, attendance, supervision }: FolderInput): TermFolder {
  const att = attendancePart(term, today, attendance);
  const sup = supervisionPart(term, today, supervision);
  const parts: FolderPart[] = [
    detailsPart(term),
    att.part,
    sup.part,
    ...milestoneIds.map((id) => milestonePart(term, id, today)),
    epaPart(state, term, today),
  ];
  const counts = emptyCounts();
  for (const part of parts) counts[part.status] += 1;
  const loading = attendance.status === "loading" || supervision.status === "loading";
  return {
    termId: term.id,
    title: folderTermTitle(term),
    dates: datesLine(term, today),
    phase: folderPhase(term, today),
    supervisor: term.supervisor,
    site: term.site,
    parts,
    counts,
    headline: `${unit(counts.complete, "of")} ${parts.length} complete`,
    meterLabel: folderMeterLabel(counts, loading),
    loading,
    sessions: att.rows.map((row) => ({
      date: perthDate(row.startsAt),
      title: row.title,
      serviceName: row.serviceName,
      hours: Number(rowHours(row).toFixed(2)),
      how: attendanceLabels[row.method],
      inCpd: row.cpdEntryId !== null,
    })),
    supervision: sup.rows,
  };
}

/** Parts grouped by status in page order, with empty groups left out. */
export function folderSections(folder: Pick<TermFolder, "parts">): { status: FolderStatus; parts: FolderPart[] }[] {
  return folderSectionOrder
    .map((status) => ({ status, parts: folder.parts.filter((part) => part.status === status) }))
    .filter((section) => section.parts.length > 0);
}

/** Terms other than the one shown, newest first, for the "Earlier terms" row. */
export function otherTerms(state: TermTrackerState, shownId: string): TermRecord[] {
  return state.terms.filter((term) => term.id !== shownId).sort((a, b) => b.startsOn.localeCompare(a.startsOn));
}

/** The term a `?term=` link asks for, else the current term, else the newest one. */
export function pickFolderTerm(state: TermTrackerState, requested: string | null): TermRecord | null {
  if (requested) {
    const asked = state.terms.find((term) => term.id === requested);
    if (asked) return asked;
  }
  const current = state.terms.find((term) => term.id === state.currentTermId);
  if (current) return current;
  return [...state.terms].sort((a, b) => b.startsOn.localeCompare(a.startsOn))[0] ?? null;
}

export const FOLDER_PRIVACY_LINE = "Status and counts only. No assessment content, ratings or comments.";
export const FOLDER_NOT_KEPT_LINE =
  "Assessment forms are not kept in PsychSift. They are completed and signed in Clinical Learning Australia (CLA), with your Medical Education Unit.";
export const FOLDER_CLA_URL = TERM_TRACKER_SOURCES.pmcwaCla;

/** What goes into an export. Gaps and the part statuses always go; names are left out unless asked for. */
export interface FolderExportOptions {
  readonly sessions: boolean;
  readonly supervision: boolean;
  /** People's names (the supervisor). Off keeps it to counts and dates. */
  readonly names: boolean;
}

export const FOLDER_EXPORT_DEFAULTS: FolderExportOptions = { sessions: true, supervision: true, names: false };

/** The parts that need action, in page order: they lead every export, never hidden. */
export function folderGaps(folder: Pick<TermFolder, "parts">): FolderPart[] {
  return folder.parts.filter((part) => part.status === "to_fix" || part.status === "not_updating");
}

/**
 * The folder as a spreadsheet: a header, the gaps first, one line per part, then the sessions and supervision
 * entries it counted. Every cell goes through `cmeCsvCell`, which quotes it and defuses a leading formula
 * character.
 */
export function termFolderCsv(
  folder: TermFolder,
  exportedOn: string,
  options: FolderExportOptions = { sessions: true, supervision: true, names: true },
): string {
  const line = (cells: (string | number | null)[]) => cells.map(cmeCsvCell).join(",");
  const detail = (part: FolderPart) => (options.names ? part.detail : (part.detailWithoutNames ?? part.detail));
  const gaps = folderGaps(folder);
  const lines = [
    line(["Term evidence folder"]),
    line(["Term", folder.title]),
    line(["Dates", folder.dates]),
    line(["Supervisor", options.names ? folder.supervisor || "Not added" : "Left out (names off)"]),
    line(["Hospital or service", folder.site || "Not added"]),
    line(["Exported", exportedOn]),
    line(["Summary", folder.meterLabel]),
    "",
    line([`Gaps · ${gaps.length}`]),
    ...(gaps.length
      ? gaps.map((part) => line([part.label, folderStatusWords[part.status], detail(part)]))
      : [line(["None"])]),
    "",
    line(["Part", "Status", "Detail"]),
    ...folder.parts.map((part) => line([part.label, folderStatusWords[part.status], detail(part)])),
    ...(options.sessions
      ? [
          "",
          line(["Teaching sessions this term"]),
          line(["Date", "Session", "Service", "Hours", "Check-in", "In CPD"]),
          ...folder.sessions.map((row) =>
            line([row.date, row.title, row.serviceName, row.hours, row.how, row.inCpd ? "Yes" : "No"]),
          ),
        ]
      : []),
    ...(options.supervision
      ? [
          "",
          line(["Supervision this term"]),
          line(["Date", "Minutes", "Type", "Status"]),
          ...folder.supervision.map((row) => line([row.date, row.minutes, row.type, row.status])),
        ]
      : []),
    "",
    line([FOLDER_NOT_KEPT_LINE]),
    line([FOLDER_PRIVACY_LINE]),
  ];
  return `${lines.join("\r\n")}\r\n`;
}

/** Why the folder cannot be exported yet, or null. Before the term starts there is nothing in it. */
export function folderExportBlocker(
  folder: Pick<TermFolder, "phase">,
  term: Pick<TermRecord, "startsOn">,
): string | null {
  return folder.phase === "before"
    ? `Nothing to export until the term starts on ${weekdayDayMonth(term.startsOn)}.`
    : null;
}

/** Early in the term (before it starts, or its first week): nothing can be behind yet. */
export function folderIsEarly(term: Pick<TermRecord, "startsOn" | "endsOn">, today: string): boolean {
  const phase = folderPhase(term, today);
  return phase === "before" || (phase === "during" && termWeekOf(term, today) <= 1);
}

export interface FolderComingUp {
  readonly date: string;
  readonly title: string;
  readonly detail: string;
}

/** The dates still ahead this term, soonest first: assessment dates not yet done, then the term's end. */
export function folderComingUp(term: TermRecord, today: string): FolderComingUp[] {
  const items: FolderComingUp[] = milestoneIds
    .filter((id) => !term.milestones[id].doneOn && term.milestones[id].dueOn > today)
    .map((id) => ({
      date: term.milestones[id].dueOn,
      title: `${milestoneLabels[id].long} due`,
      detail: "Mark it done once it is signed in CLA",
    }));
  if (term.endsOn >= today)
    items.push({ date: term.endsOn, title: "Term ends", detail: "The folder is ready to export after" });
  return items.sort((a, b) => a.date.localeCompare(b.date));
}

/** "term-4-psychiatry-evidence-folder.csv", safe for any file system. */
export function termFolderFileName(folder: Pick<TermFolder, "title">, demo = false): string {
  const slug = folder.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return `${slug || "term"}-evidence-folder${demo ? "-demo" : ""}.csv`;
}

/* ---------- hook points for the shared frame (Needs you, work search) ---------- */

export interface FolderNeedsYouItem {
  readonly id: string;
  readonly title: string;
  readonly dueOn: string;
  readonly area: "teaching";
  readonly href: string;
  readonly kind: "action" | "update";
}

/**
 * Needs-you source, from the device term tracker alone (no network): from a week before the current
 * term ends to a fortnight after, a prompt to export the folder; and one line for each assessment date
 * the doctor set that has passed without being marked done.
 */
export function termFolderNeedsYou(state: TermTrackerState, today: string): FolderNeedsYouItem[] {
  const term = state.terms.find((t) => t.id === state.currentTermId);
  if (!term) return [];
  const items: FolderNeedsYouItem[] = [];
  for (const id of milestoneIds) {
    if (milestoneState(term, id, today) === "overdue")
      items.push({
        id: `term-folder-${term.id}-${id}`,
        title: `${milestoneLabels[id].long} not marked done`,
        dueOn: term.milestones[id].dueOn,
        area: "teaching",
        href: `${TERM_FOLDER_PATH}?term=${encodeURIComponent(term.id)}`,
        kind: "update",
      });
  }
  const toEnd = daysBetween(today, term.endsOn);
  if (toEnd <= 7 && toEnd >= -14)
    items.push({
      id: `term-folder-${term.id}-export`,
      title: `Export your ${folderTermTitle(term)} evidence folder`,
      dueOn: term.endsOn < today ? today : term.endsOn,
      area: "teaching",
      href: `${TERM_FOLDER_PATH}?term=${encodeURIComponent(term.id)}`,
      kind: "action",
    });
  return items;
}

export interface FolderSearchEntry {
  readonly title: string;
  readonly area: "teaching";
  readonly keywords: readonly string[];
  readonly href: string;
}

/**
 * Work-search provider: the page itself, never record text (Teaching rows stay out of search, see
 * tests/teaching-search-privacy.test.ts).
 */
export function termFolderSearchEntries(): FolderSearchEntry[] {
  return [
    {
      title: "Term evidence folder",
      area: "teaching",
      keywords: ["accreditation", "evidence", "folder", "term", "export", "portfolio", "supervisor", "attendance"],
      href: TERM_FOLDER_PATH,
    },
  ];
}
