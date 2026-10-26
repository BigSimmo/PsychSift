import "server-only";

import { countDates, parseHeaderDates, type RosterGrid } from "@/lib/roster/import/grid";
import { RosterReadError, tableToGrid } from "@/lib/roster/import/table";
import { addDaysToDate } from "@/lib/roster/shifts/perth-time";

const MAX_PAGES = 12;
const LINE_TOLERANCE = 3;
/** How far after the last day read a page's first day may start and still continue the same roster. */
const MAX_DAYS_BETWEEN_PAGES = 7;

type Word = { readonly text: string; readonly x: number; readonly y: number; readonly width: number };

/** Text runs on one printed line, left to right. */
function linesOf(words: readonly Word[]): Word[][] {
  const lines: Word[][] = [];
  const sorted = [...words].sort((a, b) => b.y - a.y || a.x - b.x);
  for (const word of sorted) {
    const line = lines.at(-1);
    if (line && Math.abs(line[0]!.y - word.y) <= LINE_TOLERANCE) line.push(word);
    else lines.push([word]);
  }
  return lines.map((line) => line.sort((a, b) => a.x - b.x));
}

/** Where a page's columns sit: the left columns (name, grade, ward) by where they start, the days by their centre. */
type Layout = {
  readonly leftStarts: readonly number[];
  readonly centres: readonly number[];
  readonly gap: number;
  readonly firstLeft: number;
};

/** One page's table: its header row (null when the page repeats no header), its rows, and the layout it used. */
type PageTable = { readonly header: string[] | null; readonly rows: string[][]; readonly layout: Layout };

function rowsUnder(lines: readonly Word[][], layout: Layout): string[][] {
  const { leftStarts, centres, gap, firstLeft } = layout;
  return lines.map((line) => {
    const cells: string[] = new Array(leftStarts.length + centres.length).fill("");
    for (const word of line) {
      const middle = word.x + word.width / 2;
      if (middle < firstLeft) {
        let column = 0;
        leftStarts.forEach((start, index) => {
          if (word.x >= start - LINE_TOLERANCE) column = index;
        });
        cells[column] = `${cells[column]} ${word.text}`.trim();
        continue;
      }
      let nearest = 0;
      centres.forEach((centre, index) => {
        if (Math.abs(centre - middle) < Math.abs(centres[nearest]! - middle)) nearest = index;
      });
      const column = leftStarts.length + nearest;
      if (Math.abs(centres[nearest]! - middle) <= gap / 2) cells[column] = `${cells[column]} ${word.text}`.trim();
    }
    return cells;
  });
}

/**
 * One page's lines to table rows. The header line (the one with the most
 * dates) fixes the day columns by the centre of each date; every other word
 * joins the nearest column. Words left of the days join the column whose
 * header word they start under (name, grade, ward). Weekday words printed above or beside a date are ignored.
 * A page with no header of its own continues the previous page's table: its
 * lines are laid out by that page's columns, and only lines with a day filled
 * in are kept, so a page footer is not read as a person.
 */
function pageTable(words: readonly Word[], previous: Layout | null): PageTable | null {
  const lines = linesOf(words);
  const header = lines.reduce<Word[] | null>((best, line) => {
    const dates = countDates(line.map((word) => word.text));
    return dates >= 3 && dates > (best ? countDates(best.map((word) => word.text)) : 0) ? line : best;
  }, null);
  if (!header) {
    if (!previous || lines.length === 0) return null;
    const rows = rowsUnder(lines, previous).filter((row) => row.slice(previous.leftStarts.length).some(Boolean));
    return rows.length > 0 ? { header: null, rows, layout: previous } : null;
  }
  const dateWords = header.filter((word) => countDates([word.text]) === 1);
  const centres = dateWords.map((word) => word.x + word.width / 2);
  const gap = Math.min(...centres.slice(1).map((centre, index) => centre - centres[index]!), 60);
  const firstLeft = centres[0]! - gap / 2;
  // Columns left of the days (name, grade, ward) start where their header word starts.
  const leftHeaders = header.filter((word) => word.x + word.width / 2 < firstLeft);
  const leftStarts = leftHeaders.length > 0 ? leftHeaders.map((word) => word.x) : [0];
  const layout = { leftStarts, centres, gap, firstLeft };
  return {
    header: [...leftStarts.map((_, index) => leftHeaders[index]?.text ?? ""), ...dateWords.map((word) => word.text)],
    rows: rowsUnder(lines.slice(lines.indexOf(header) + 1), layout),
    layout,
  };
}

function rowKey(row: readonly string[], leftCount: number): string {
  return row
    .slice(0, leftCount)
    .map((cell) => cell.trim().toLowerCase())
    .join("|");
}

/**
 * A page with no header after a page that added days is laid out by that
 * page's columns, so its rows hold only those days: the table's last columns.
 * Each row joins its person's row when that person has none of those days yet,
 * or starts a new row, rather than the page being dropped for being narrower.
 */
function joinLastDays(table: string[][], page: PageTable): string[][] | null {
  const header = table[0]!;
  const leftCount = page.layout.leftStarts.length;
  const dayCount = page.layout.centres.length;
  const tableLeftCount = header.findIndex((cell) => countDates([cell]) === 1);
  if (tableLeftCount !== leftCount || leftCount + dayCount > header.length) return null;
  const start = header.length - dayCount;
  const rows = table.map((row) => [...row]);
  for (const pageRow of page.rows) {
    const key = rowKey(pageRow, leftCount);
    const days = pageRow.slice(leftCount);
    const existing = pageRow.slice(0, leftCount).some(Boolean)
      ? rows.slice(1).find((row) => rowKey(row, leftCount) === key && row.slice(start).every((cell) => !cell))
      : undefined;
    if (existing) existing.splice(start, dayCount, ...days);
    else rows.push([...pageRow.slice(0, leftCount), ...new Array<string>(start - leftCount).fill(""), ...days]);
  }
  return rows;
}

/**
 * Add a later page to the table read so far, when it continues it; null when
 * it doesn't. A page continues the table when it repeats the same days (more
 * staff: its rows are added below), has no header (more staff, laid out by
 * the previous page), or has the same left columns and days that all come
 * after the table's last day (more days: each person's days are added to
 * their row, matched by the left columns).
 */
function continueTable(table: string[][], page: PageTable, today: string): string[][] | null {
  const header = table[0]!;
  if (!page.header) {
    const width = page.layout.leftStarts.length + page.layout.centres.length;
    if (!page.rows.every((row) => row.length === width)) return null;
    return width === header.length ? [...table, ...page.rows] : joinLastDays(table, page);
  }
  if (page.header.join("\u0000") === header.join("\u0000")) return [...table, ...page.rows];

  const leftCount = page.layout.leftStarts.length;
  const tableLeftCount = header.findIndex((cell) => countDates([cell]) === 1);
  const sameLeft =
    tableLeftCount === leftCount &&
    page.header.slice(0, leftCount).every((cell, index) => cell.toLowerCase() === header[index]?.toLowerCase());
  if (!sameLeft) return null;
  const tableDays = header.slice(leftCount);
  const pageDays = page.header.slice(leftCount);
  const dates = parseHeaderDates([...tableDays, ...pageDays], today);
  const lastSoFar = dates
    .slice(0, tableDays.length)
    .reduce<string | null>((last, date) => (date && (!last || date > last) ? date : last), null);
  const later = dates.slice(tableDays.length);
  if (!lastSoFar || later.some((date) => date === null || date <= lastSoFar)) return null;
  // Days that pick up where the table stopped. A page far later is another roster (or dates read a year out).
  if (later[0]! > addDaysToDate(lastSoFar, MAX_DAYS_BETWEEN_PAGES)) return null;

  const blanks = (count: number) => new Array<string>(count).fill("");
  const pageRows = new Map(page.rows.map((row) => [rowKey(row, leftCount), row]));
  const merged = [[...header, ...pageDays]];
  for (const row of table.slice(1)) {
    const key = rowKey(row, leftCount);
    const next = pageRows.get(key);
    pageRows.delete(key);
    merged.push([...row, ...(next ? next.slice(leftCount) : blanks(pageDays.length))]);
  }
  for (const row of pageRows.values()) {
    merged.push([...row.slice(0, leftCount), ...blanks(tableDays.length), ...row.slice(leftCount)]);
  }
  return merged;
}

/**
 * A text PDF roster to a grid, on the server, in memory. A scanned PDF has no
 * text to read and says so; reading scans is left off until a health service
 * agrees to it. The file is never stored or logged.
 */
export async function readRosterPdf(buffer: Buffer, today: string): Promise<RosterGrid> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: false });
  let pdf;
  try {
    pdf = await task.promise;
  } catch {
    await task.destroy();
    throw new RosterReadError("unreadable");
  }
  try {
    // A longer PDF is refused rather than read as a prefix: later pages could continue the roster.
    if (pdf.numPages > MAX_PAGES) throw new RosterReadError("too_big");
    let sawText = false;
    let lastError = new RosterReadError("no_dates");
    // The first page that reads as a roster, and every later page that continues it.
    let table: string[][] | null = null;
    let grid: RosterGrid | null = null;
    let previous: Layout | null = null;
    for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, MAX_PAGES); pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const words: Word[] = content.items.flatMap((item) =>
        "str" in item && item.str.trim()
          ? [
              {
                text: item.str.trim(),
                x: item.transform[4] as number,
                y: item.transform[5] as number,
                width: item.width,
              },
            ]
          : [],
      );
      if (words.length > 0) sawText = true;
      const read = pageTable(words, table ? previous : null);
      if (!read) continue;
      if (table) {
        const continued = continueTable(table, read, today);
        if (!continued) continue;
        try {
          grid = tableToGrid(continued, today);
          table = continued;
          previous = read.layout;
        } catch (error) {
          if (!(error instanceof RosterReadError)) throw error;
        }
        continue;
      }
      if (!read.header) continue;
      const first = [read.header, ...read.rows];
      try {
        grid = tableToGrid(first, today);
        table = first;
        previous = read.layout;
      } catch (error) {
        if (error instanceof RosterReadError) lastError = error;
        else throw error;
      }
    }
    if (grid) return grid;
    throw sawText ? lastError : new RosterReadError("scanned");
  } finally {
    await task.destroy();
  }
}
