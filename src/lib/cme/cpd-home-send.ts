import { z } from "zod";

import { formatEntryForCpdHome } from "@/lib/cme/clipboard";
import { totalAllocatedHours } from "@/lib/cme/evaluate";
import { activeCmeYearEntries, cmeCsvCell } from "@/lib/cme/export";
import type { CmeCategory, CmeEntry, CmeRequirementSet } from "@/lib/cme/types";
import { cpdTextLooksLikePatient } from "@/lib/cme/patient-detail-check";

/**
 * Activity titles name courses and colleges in capitals ("ECT workshop", "RANZCP congress"), which
 * the initials check would read as a patient. Bare capitals are read past in titles only. Dotted
 * initials, record numbers, ages and every other finding still block the file.
 */
const TITLE_CHECK = { allowCapitals: true } as const;

/**
 * Send CPD to AMA CPD Home (#11).
 *
 * NOBODY HAS CHECKED WHAT AMA CPD HOME CAN IMPORT. Nothing in this repository
 * records its import format, so this module makes a plain CSV with the same
 * cell rules as the year export (`cmeCsvCell`, spreadsheet commands kept
 * literal) and says, everywhere it is shown, that the column names may need to
 * change once the format is checked. It never claims the file "works with" CPD
 * Home, and nothing is ever sent: the doctor downloads the file and tries it.
 *
 * The file is made on the device from the records already loaded on the page,
 * so it can be made offline. A file is refused outright, never made partial,
 * when any chosen activity has no date, no hours or no category.
 *
 * What the device keeps (`CpdHomeSendState`): the files made (when, how many
 * rows, which activity ids) and which ones the doctor said they added to CPD
 * Home. Activity ids only, never a title or a reflection.
 */

export const CPD_HOME_FILE_HISTORY_LIMIT = 20;
/** Rows checked per step while a file is made, so the page can show progress and offer Cancel. */
export const CPD_HOME_CHECK_CHUNK = 10;
/** From this month the year-end reminder asks for a file before 31 December. */
export const CPD_HOME_YEAR_END_MONTH = 12;
const ENTRY_ID_LIMIT = 2000;

const categoryShortLabels: Record<CmeCategory, string> = {
  educational: "Educational",
  reviewing: "Reviewing",
  measuring: "Outcomes",
};

export type CpdHomeRow = {
  readonly entryId: string;
  readonly date: string;
  readonly activity: string;
  readonly hours: number;
  readonly educational: number;
  readonly reviewing: number;
  readonly measuring: number;
  /** Short names of the categories with hours, in the standard order, joined with "and". */
  readonly category: string;
  readonly reflection: string;
};

export type CpdHomeScope = "all" | "new" | "chosen";

function hoursIn(entry: CmeEntry, category: CmeCategory): number {
  return entry.allocations.filter((a) => a.category === category).reduce((sum, a) => sum + a.hours, 0);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The year's active activities as file rows, oldest first, optionally limited to some ids. */
export function cpdHomeRows(entries: readonly CmeEntry[], year: number, onlyIds?: ReadonlySet<string>): CpdHomeRow[] {
  return activeCmeYearEntries(entries, year)
    .filter((entry) => !onlyIds || onlyIds.has(entry.id))
    .map((entry) => {
      const educational = round(hoursIn(entry, "educational"));
      const reviewing = round(hoursIn(entry, "reviewing"));
      const measuring = round(hoursIn(entry, "measuring"));
      const parts = (["educational", "reviewing", "measuring"] as const).filter(
        (category) => hoursIn(entry, category) > 0,
      );
      return {
        entryId: entry.id,
        date: entry.date,
        activity: entry.title.trim(),
        hours: round(totalAllocatedHours([entry])),
        educational,
        reviewing,
        measuring,
        category: parts.map((category) => categoryShortLabels[category]).join(" and "),
        reflection: entry.reflection.trim(),
      };
    });
}

export type CpdHomeRowProblem = { readonly entryId: string; readonly activity: string; readonly problem: string };

export const CPD_HOME_TITLE_PATIENT_PROBLEM = "Title looks like a patient detail";

/**
 * Every row that would make an incomplete or unsafe file. A file is made only when this is empty.
 * A title that reads like a patient detail stops the file the same way a missing date does,
 * because the title is in every row of every file and copy. Its row is named by date, so the
 * flagged words are not shown again.
 */
export function cpdHomeRowProblems(
  rows: readonly CpdHomeRow[],
  thisYear = new Date().getFullYear(),
): CpdHomeRowProblem[] {
  const problems: CpdHomeRowProblem[] = [];
  for (const row of rows) {
    const activity = row.activity || "Untitled activity";
    if (cpdTextLooksLikePatient(row.activity, thisYear, TITLE_CHECK))
      problems.push({
        entryId: row.entryId,
        activity: /^\d{4}-\d{2}-\d{2}$/.test(row.date) ? `Activity on ${row.date}` : "An activity",
        problem: CPD_HOME_TITLE_PATIENT_PROBLEM,
      });
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date))
      problems.push({ entryId: row.entryId, activity, problem: "No date" });
    else if (!(row.hours > 0)) problems.push({ entryId: row.entryId, activity, problem: "No hours" });
    else if (!row.category) problems.push({ entryId: row.entryId, activity, problem: "No category" });
    else if (!row.activity) problems.push({ entryId: row.entryId, activity, problem: "No title" });
  }
  return problems;
}

/**
 * Reflections that read like they hold a patient detail (a record number, a
 * date of birth, a title and surname, a bed, initials, an age and sex, a phone
 * number: `cpdTextLooksLikePatient`). These are left out of the file and every
 * copy even when reflections are included, and the page names them.
 */
export function reflectionsToLeaveOut(rows: readonly CpdHomeRow[], thisYear: number): Set<string> {
  return new Set(
    rows.filter((row) => row.reflection && cpdTextLooksLikePatient(row.reflection, thisYear)).map((row) => row.entryId),
  );
}

/** The ids of activities whose title reads like a patient detail. No file or copy holds them. */
export function titlesToHoldBack(entries: readonly CmeEntry[], thisYear: number): Set<string> {
  return new Set(
    entries.filter((entry) => cpdTextLooksLikePatient(entry.title, thisYear, TITLE_CHECK)).map((entry) => entry.id),
  );
}

export type CpdHomeFileOptions = {
  readonly includeReflections: boolean;
  /** Entry ids whose reflection is left out even when reflections are included. */
  readonly withheldReflections?: ReadonlySet<string>;
};

const BASE_HEADER = [
  "Activity date",
  "Activity",
  "Total hours",
  "Educational activities hours",
  "Reviewing performance hours",
  "Measuring outcomes hours",
  "Category",
] as const;

function rowCells(row: CpdHomeRow, options: CpdHomeFileOptions): (string | number)[] {
  const cells: (string | number)[] = [
    row.date,
    row.activity,
    row.hours,
    row.educational,
    row.reviewing,
    row.measuring,
    row.category,
  ];
  if (options.includeReflections) cells.push(options.withheldReflections?.has(row.entryId) ? "" : row.reflection);
  return cells;
}

function header(options: CpdHomeFileOptions): string[] {
  return options.includeReflections ? [...BASE_HEADER, "Reflection"] : [...BASE_HEADER];
}

/** The CSV, with a byte-order mark so a spreadsheet reads it as UTF-8, rows ending CRLF. */
export function formatCpdHomeCsv(rows: readonly CpdHomeRow[], options: CpdHomeFileOptions): string {
  const lines = [header(options), ...rows.map((row) => rowCells(row, options))];
  return "﻿" + lines.map((line) => line.map(cmeCsvCell).join(",")).join("\r\n") + "\r\n";
}

function tableCell(value: string | number): string {
  // A tab or a line break inside a cell would start a new column or row when pasted.
  const text = String(value)
    .replace(/[\t\r\n]+/g, " ")
    .trim();
  // As in the CSV (`cmeCsvCell`): a pasted cell starting = + - or @ would run as a spreadsheet formula.
  return typeof value === "string" && /^[=+@-]/.test(text) ? `'${text}` : text;
}

/** The same rows tab-separated, for pasting straight into a spreadsheet or a web table. */
export function formatCpdHomeTable(rows: readonly CpdHomeRow[], options: CpdHomeFileOptions): string {
  const lines = [header(options), ...rows.map((row) => rowCells(row, options))];
  return lines.map((line) => line.map(tableCell).join("\t")).join("\n");
}

/** One activity as the CPD-home text the Log copies, with the reflection dropped when asked. */
export function cpdHomeActivityText(entry: CmeEntry, set: CmeRequirementSet, includeReflection: boolean): string {
  const text = formatEntryForCpdHome(entry, set);
  if (includeReflection) return text;
  const at = text.startsWith("Reflection: ") ? 0 : text.indexOf("\nReflection: ");
  return at < 0 ? text : text.slice(0, at);
}

/**
 * Every chosen activity, one after another, a blank line between. An activity whose title reads
 * like a patient detail (`heldTitles`) is left out altogether, and a held-back reflection is dropped.
 */
export function cpdHomeAllText(
  entries: readonly CmeEntry[],
  set: CmeRequirementSet,
  includeReflections: boolean,
  withheldReflections: ReadonlySet<string> = new Set(),
  heldTitles: ReadonlySet<string> = new Set(),
): string {
  return entries
    .filter((entry) => !entry.archivedAt && !heldTitles.has(entry.id))
    .map((entry) => cpdHomeActivityText(entry, set, includeReflections && !withheldReflections.has(entry.id)))
    .join("\n\n");
}

export function cpdHomeFileName(year: number, scope: CpdHomeScope, today: string): string {
  if (scope === "all") return `cpd-log-${year}.csv`;
  if (scope === "new") return `cpd-log-${year}-new-${today}.csv`;
  return `cpd-log-${year}-chosen-${today}.csv`;
}

/* ---------------------------------------------------------------- device record */

const dateTime = z.string().refine((value) => Number.isFinite(Date.parse(value)), "Not a time");
const fileSchema = z.object({
  id: z.string().min(1).max(40),
  year: z.number().int().min(2000).max(2100),
  madeAt: dateTime,
  name: z.string().min(1).max(80),
  rows: z.number().int().min(0).max(ENTRY_ID_LIMIT),
  entryIds: z.array(z.string().min(1).max(80)).max(ENTRY_ID_LIMIT),
  includeReflections: z.boolean(),
  addedAt: dateTime.nullable(),
});
const stateSchema = z.object({
  version: z.literal(1),
  files: z.array(fileSchema).max(CPD_HOME_FILE_HISTORY_LIMIT),
});

export type CpdHomeFile = z.infer<typeof fileSchema>;
export type CpdHomeSendState = z.infer<typeof stateSchema>;

export const EMPTY_CPD_HOME_SEND: CpdHomeSendState = { version: 1, files: [] };

export function parseCpdHomeSendState(raw: string | null): CpdHomeSendState {
  if (!raw) return EMPTY_CPD_HOME_SEND;
  try {
    const parsed = stateSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : EMPTY_CPD_HOME_SEND;
  } catch {
    return EMPTY_CPD_HOME_SEND;
  }
}

export function isValidCpdHomeSendState(state: CpdHomeSendState): boolean {
  return stateSchema.safeParse(state).success;
}

/** The newest file first; the oldest drop off past the history limit. */
export function recordCpdHomeFile(state: CpdHomeSendState, file: CpdHomeFile): CpdHomeSendState {
  return {
    ...state,
    files: [file, ...state.files.filter((existing) => existing.id !== file.id)].slice(0, CPD_HOME_FILE_HISTORY_LIMIT),
  };
}

export function markCpdHomeFileAdded(state: CpdHomeSendState, fileId: string, at: string): CpdHomeSendState {
  return { ...state, files: state.files.map((file) => (file.id === fileId ? { ...file, addedAt: at } : file)) };
}

export function unmarkCpdHomeFileAdded(state: CpdHomeSendState, fileId: string): CpdHomeSendState {
  return { ...state, files: state.files.map((file) => (file.id === fileId ? { ...file, addedAt: null } : file)) };
}

export function removeCpdHomeFile(state: CpdHomeSendState, fileId: string): CpdHomeSendState {
  return { ...state, files: state.files.filter((file) => file.id !== fileId) };
}

export function cpdHomeFilesForYear(state: CpdHomeSendState, year: number): CpdHomeFile[] {
  return state.files.filter((file) => file.year === year);
}

/** Activity ids in any file of this year the doctor said they added to CPD Home. */
export function addedEntryIds(state: CpdHomeSendState, year: number): Set<string> {
  return new Set(cpdHomeFilesForYear(state, year).flatMap((file) => (file.addedAt ? file.entryIds : [])));
}

/** The most recent file of this year marked added, or null. */
export function lastAddedFile(state: CpdHomeSendState, year: number): CpdHomeFile | null {
  return (
    cpdHomeFilesForYear(state, year)
      .filter((file) => file.addedAt)
      .sort((a, b) => Date.parse(b.addedAt!) - Date.parse(a.addedAt!))[0] ?? null
  );
}

/** This year's active activities that are in no file marked added, oldest first. */
export function entriesNotYetAdded(entries: readonly CmeEntry[], state: CpdHomeSendState, year: number): CmeEntry[] {
  const added = addedEntryIds(state, year);
  return activeCmeYearEntries(entries, year).filter((entry) => !added.has(entry.id));
}

/* ---------------------------------------------------------------- hooks for other areas */

export const CPD_HOME_SEND_HREF = "/cme/cpd-home";

export type CpdNeedsYouItem = {
  readonly id: string;
  readonly title: string;
  /** Perth calendar date it is due, or null for an update with no date. */
  readonly dueOn: string | null;
  readonly area: "cpd";
  readonly href: string;
  readonly kind: "action" | "update";
};

/**
 * Ready for the Notification centre, NOT WIRED YET (the main build owns it):
 * - an update once a file has been marked added: activities logged since, not
 *   yet in a file marked added (nothing before a first file is marked added,
 *   because until then the doctor has not started using CPD Home this way);
 * - from 1 December, an action due 31 December to make the year's file, when
 *   any of the year's activities is in no file marked added. It replaces the
 *   update in December, so the doctor sees one item, not two.
 */
export function cpdHomeNeedsYouItems(
  entries: readonly CmeEntry[],
  state: CpdHomeSendState,
  year: number,
  today?: string,
): CpdNeedsYouItem[] {
  const count = entriesNotYetAdded(entries, state, year).length;
  if (count === 0) return [];
  const yearEnd =
    today !== undefined && Number(today.slice(0, 4)) === year && Number(today.slice(5, 7)) >= CPD_HOME_YEAR_END_MONTH;
  if (yearEnd) {
    return [
      {
        id: `cpd:cpd-home:year-end:${year}`,
        title: `Make your ${year} CPD Home file before 31 Dec · ${count} ${count === 1 ? "activity" : "activities"} not added yet`,
        dueOn: `${year}-12-31`,
        area: "cpd",
        href: `${CPD_HOME_SEND_HREF}?year=${year}`,
        kind: "action",
      },
    ];
  }
  if (!lastAddedFile(state, year)) return [];
  return [
    {
      id: `cpd:cpd-home:new:${year}`,
      title: `${count} CPD ${count === 1 ? "activity" : "activities"} not yet in a CPD Home file`,
      dueOn: null,
      area: "cpd",
      href: CPD_HOME_SEND_HREF,
      kind: "update",
    },
  ];
}

export type CpdSearchRecord = {
  readonly title: string;
  readonly area: "cpd";
  readonly keywords: readonly string[];
  readonly href: string;
};

/** The page itself, for work search. */
export function cpdHomeSearchRecords(): CpdSearchRecord[] {
  return [
    {
      title: "Send CPD to AMA CPD Home",
      area: "cpd",
      keywords: ["ama", "cpd home", "export", "csv", "spreadsheet", "copy", "import", "send", "upload", "cme"],
      href: CPD_HOME_SEND_HREF,
    },
  ];
}
