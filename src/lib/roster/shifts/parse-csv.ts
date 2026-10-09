import {
  ON_CALL_SHIFT_IMPORT_MAX,
  ON_CALL_SHIFT_LOCATION_MAX,
  ON_CALL_SHIFT_TITLE_MAX,
  type OnCallShiftInput,
} from "@/lib/roster/shifts/model";
import { plural, type RosterParseResult } from "@/lib/roster/shifts/parse-ics";
import { addDaysToDate, perthWallToIso } from "@/lib/roster/shifts/perth-time";

/**
 * Reads shifts out of a simple spreadsheet export, on the device.
 *
 * The first row names the columns: `date`, `start`, `end`, and optionally
 * `role` (or `title` or `shift`) and `site` (or `location` or `hospital`).
 * Dates are `YYYY-MM-DD` or Australian `DD/MM/YYYY`; times are `HH:MM`, `H:MM`
 * or `HHMM`, in Perth time. An end at or before the start is the next morning,
 * which is what a night shift looks like on a roster. Any other column is
 * ignored, so a spreadsheet with a notes column does not carry its notes over.
 */

const COLUMN_ALIASES: Record<string, "date" | "start" | "end" | "title" | "location"> = {
  date: "date",
  day: "date",
  start: "start",
  "start time": "start",
  from: "start",
  end: "end",
  "end time": "end",
  finish: "end",
  to: "end",
  role: "title",
  title: "title",
  shift: "title",
  site: "location",
  location: "location",
  hospital: "location",
  ward: "location",
};

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      cells.push(cell.trim());
      cell = "";
    } else cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

function readDate(value: string): string | null {
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (iso) return `${iso[1]}-${iso[2]!.padStart(2, "0")}-${iso[3]!.padStart(2, "0")}`;
  const au = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (au) return `${au[3]}-${au[2]!.padStart(2, "0")}-${au[1]!.padStart(2, "0")}`;
  return null;
}

function readTime(value: string): string | null {
  const match = /^(\d{1,2}):?(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

export function parseRosterCsv(text: string): RosterParseResult {
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map((line) => line.trim());
  const headerIndex = lines.findIndex((line) => line !== "");
  if (headerIndex < 0) return { shifts: [], notes: ["The file is empty."] };

  const columns = splitCsvLine(lines[headerIndex]!).map((name) => COLUMN_ALIASES[name.toLowerCase()] ?? null);
  const position = (field: "date" | "start" | "end" | "title" | "location") => columns.indexOf(field);
  if (position("date") < 0 || position("start") < 0 || position("end") < 0) {
    return {
      shifts: [],
      notes: ["The first row needs columns named date, start and end (and optionally role and site)."],
    };
  }

  const shifts: OnCallShiftInput[] = [];
  const badRows: number[] = [];
  let overLimit = 0;
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line === "" || /^,*$/.test(line)) continue;
    const cells = splitCsvLine(line);
    const cell = (field: "date" | "start" | "end" | "title" | "location") => {
      const at = position(field);
      return at < 0 ? "" : (cells[at] ?? "");
    };
    const date = readDate(cell("date"));
    const start = readTime(cell("start"));
    const end = readTime(cell("end"));
    const startsAt = date && start ? perthWallToIso(date, start) : null;
    const endsAt = date && end ? perthWallToIso(end <= start! ? addDaysToDate(date, 1) : date, end) : null;
    if (!startsAt || !endsAt) {
      badRows.push(index + 1);
      continue;
    }
    if (shifts.length >= ON_CALL_SHIFT_IMPORT_MAX) {
      overLimit += 1;
      continue;
    }
    const title = cell("title").slice(0, ON_CALL_SHIFT_TITLE_MAX).trim() || "Shift";
    const location = cell("location").slice(0, ON_CALL_SHIFT_LOCATION_MAX).trim();
    shifts.push({ startsAt, endsAt, title, location: location || null, sourceUid: null });
  }

  const notes: string[] = [];
  if (badRows.length) {
    const shown = badRows.slice(0, 5).join(", ");
    notes.push(
      `${plural(badRows.length, "row")} could not be read and ${badRows.length === 1 ? "was" : "were"} skipped (row ${shown}${badRows.length > 5 ? ", …" : ""}).`,
    );
  }
  if (overLimit)
    notes.push(`Only the first ${ON_CALL_SHIFT_IMPORT_MAX} shifts were read, and ${overLimit} more were left out.`);
  shifts.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return { shifts, notes };
}
