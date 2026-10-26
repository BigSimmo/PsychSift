import { describe, expect, it, vi } from "vitest";

import { findRememberedRow, gridRowToShifts, parseHeaderDates, type CodeMap } from "@/lib/roster/import/grid";
import { readRosterPdf } from "@/lib/roster/import/read-pdf";
import { readRosterXlsx } from "@/lib/roster/import/read-xlsx";
import { RosterReadError, tableToGrid } from "@/lib/roster/import/table";
import { inferShiftKind } from "@/lib/roster/shift-kind";
import { perthDateOf, perthTimeOf } from "@/lib/roster/shifts/perth-time";

import {
  rosterPdf,
  SAMPLE_ROSTER,
  sampleRosterCsv,
  sampleRosterPdf,
  sampleRosterXlsx,
} from "./helpers/roster-fixtures";

vi.mock("server-only", () => ({}));

/*
 * Reading a printed roster: dates, "which row is you", codes, and the three
 * file readers agreeing on one invented roster.
 */

const TODAY = "2026-09-26";
const CODES: CodeMap = {
  D: { kind: "day", start: "08:00", end: "16:30" },
  E: { kind: "evening", start: "14:00", end: "22:30" },
  N: { kind: "night", start: "21:30", end: "08:00" },
};

function csvTable(text: string) {
  return text.split("\n").map((line) => line.split(","));
}

describe("parseHeaderDates", () => {
  it("reads day-first dates, with and without weekdays and years", () => {
    expect(parseHeaderDates(["Name", "Thu 1/10", "2 Oct", "03/10/2026", "2026-10-04", "Notes"], TODAY)).toEqual([
      null,
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
      null,
    ]);
  });

  it("rolls a December to January roster into the next year", () => {
    expect(parseHeaderDates(["30/12", "31/12", "1/1", "2/1"], "2026-12-10")).toEqual([
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
    ]);
  });

  it("puts a January roster read in December into next year", () => {
    expect(parseHeaderDates(["5/1", "6/1", "7/1"], "2026-12-20")[0]).toBe("2027-01-05");
  });

  it("refuses impossible dates rather than shifting them", () => {
    expect(parseHeaderDates(["31/2", "30/9", "1/13"], TODAY)).toEqual([null, "2026-09-30", null]);
  });
});

describe("gridRowToShifts", () => {
  const grid = tableToGrid(csvTable(sampleRosterCsv()), TODAY);

  it("turns known codes into Perth shifts, with nights ending the next morning", () => {
    const { shifts, unknown } = gridRowToShifts(grid, 0, CODES);
    expect(unknown).toEqual([]);
    expect(
      shifts.map((shift) => [
        perthDateOf(shift.startsAt),
        shift.kind,
        perthTimeOf(shift.startsAt),
        perthTimeOf(shift.endsAt),
      ]),
    ).toEqual([
      ["2026-10-01", "day", "08:00", "16:30"],
      ["2026-10-02", "evening", "14:00", "22:30"],
      ["2026-10-03", "night", "21:30", "08:00"],
    ]);
    expect(perthDateOf(shifts[2]!.endsAt)).toBe("2026-10-04");
  });

  it("lists an unknown code instead of guessing, and skips blank and OFF days", () => {
    const { shifts, unknown } = gridRowToShifts(grid, 1, CODES);
    expect(shifts).toHaveLength(2);
    expect(unknown).toEqual([{ code: "ADO", days: 1 }]);
  });

  it("reads a cell that holds times without needing a code", () => {
    const { shifts } = gridRowToShifts(grid, 2, {});
    expect(shifts[0]).toMatchObject({ kind: "day", title: "Day" });
    expect(perthTimeOf(shifts[0]!.startsAt)).toBe("08:00");
  });

  it("treats a code the doctor marked as a day off as nothing", () => {
    expect(gridRowToShifts(grid, 1, { ...CODES, ADO: { kind: "off" } }).unknown).toEqual([]);
  });
});

describe("findRememberedRow", () => {
  const grid = tableToGrid(csvTable(sampleRosterCsv()), TODAY);

  it("finds the doctor's row again despite Dr, case and Surname, First order", () => {
    expect(findRememberedRow(grid, "alex example")).toBe(0);
    expect(findRememberedRow(grid, "Example, Alex")).toBe(0);
  });

  it("asks rather than guesses when two rows share the name or none match", () => {
    const twice = { ...grid, rows: [...grid.rows, grid.rows[0]!] };
    expect(findRememberedRow(twice, "Alex Example")).toBeNull();
    expect(findRememberedRow(grid, "Nobody Here")).toBeNull();
    expect(findRememberedRow(grid, null)).toBeNull();
  });
});

describe("tableToGrid", () => {
  it("picks the name column beside a grade column", () => {
    const grid = tableToGrid(csvTable(sampleRosterCsv()), TODAY);
    expect(grid.rows.map((row) => row.name)).toEqual(SAMPLE_ROSTER.rows.map((row) => row[0]));
  });

  it("keeps a blank-name shift for explicit open-row sorting but skips empty and total rows", () => {
    const grid = tableToGrid(
      [
        ["Name", "1/10/2026", "2/10/2026", "3/10/2026"],
        ["Alex Example", "D", "E", "N"],
        ["", "", "08:00-16:30", ""],
        ["", "", "", ""],
        ["", "1", "2", "3"],
        ["", "TOTAL", "", ""],
        ["TBA", "D", "", ""],
      ],
      TODAY,
    );
    expect(grid.rows.map((row) => row.name)).toEqual(["Alex Example", "", "TBA"]);
    expect(gridRowToShifts(grid, 1, {}).shifts).toHaveLength(1);
    expect(findRememberedRow(grid, "Alex Example")).toBe(0);
    expect(findRememberedRow(grid, "TBA")).toBe(2);
    expect(findRememberedRow(grid, "")).toBeNull();
  });

  it("says there are no dates when the file has no date header", () => {
    expect(() =>
      tableToGrid(
        [
          ["Name", "Phone"],
          ["Alex", "1"],
        ],
        TODAY,
      ),
    ).toThrow(RosterReadError);
  });
});

describe("file readers agree on the same roster", () => {
  async function namesAndFirstRow(read: Promise<import("@/lib/roster/import/grid").RosterGrid>) {
    const grid = await read;
    return {
      names: grid.rows.map((row) => row.name),
      shifts: gridRowToShifts(grid, 0, CODES).shifts.map((shift) => [perthDateOf(shift.startsAt), shift.kind]),
    };
  }
  const expected = {
    names: SAMPLE_ROSTER.rows.map((row) => row[0]),
    shifts: [
      ["2026-10-01", "day"],
      ["2026-10-02", "evening"],
      ["2026-10-03", "night"],
    ],
  };

  it("reads Excel, including a title row above the header and real date cells", async () => {
    expect(await namesAndFirstRow(sampleRosterXlsx().then((buffer) => readRosterXlsx(buffer, TODAY)))).toEqual(
      expected,
    );
  });

  it("reads a text PDF", async () => {
    expect(await namesAndFirstRow(readRosterPdf(sampleRosterPdf(), TODAY))).toEqual(expected);
  });

  it("reads staff rows that continue on a second page, with or without a repeated header", async () => {
    const [first, second, third] = SAMPLE_ROSTER.rows;
    const withHeader = rosterPdf([
      { title: SAMPLE_ROSTER.title, table: [SAMPLE_ROSTER.header, first, second] },
      { table: [SAMPLE_ROSTER.header, third] },
    ]);
    expect(await namesAndFirstRow(readRosterPdf(withHeader, TODAY))).toEqual(expected);
    const withoutHeader = rosterPdf([
      { title: SAMPLE_ROSTER.title, table: [SAMPLE_ROSTER.header, first, second] },
      { title: "Page 2 of 2", table: [third] },
    ]);
    expect(await namesAndFirstRow(readRosterPdf(withoutHeader, TODAY))).toEqual(expected);
  });

  it("reads days that continue on a second page, each person's days joined to their row", async () => {
    const pdf = rosterPdf([
      {
        table: [
          ["Name", "Grade", "Mon 5/10", "Tue 6/10", "Wed 7/10"],
          ["Dr Alex Example", "Registrar", "D", "E", "N"],
          ["Sam Sample", "Resident", "N", "N", ""],
        ],
      },
      {
        table: [
          ["Name", "Grade", "Thu 8/10", "Fri 9/10", "Sat 10/10"],
          ["Sam Sample", "Resident", "D", "", "E"],
          ["Dr Alex Example", "Registrar", "OFF", "D", "D"],
        ],
      },
    ]);
    const grid = await readRosterPdf(pdf, TODAY);
    expect(grid.dates.filter(Boolean)).toEqual([
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
      "2026-10-10",
    ]);
    const days = (cells: readonly string[]) => cells.filter((_, column) => grid.dates[column] !== null).join(",");
    expect(grid.rows.map((row) => [row.name, days(row.cells)])).toEqual([
      ["Dr Alex Example", "D,E,N,OFF,D,D"],
      ["Sam Sample", "N,N,,D,,E"],
    ]);
  });

  it("joins a page with no header that continues the staff of a page that added days", async () => {
    const pdf = rosterPdf([
      {
        table: [
          ["Name", "Grade", "Mon 5/10", "Tue 6/10", "Wed 7/10"],
          ["Dr Alex Example", "Registrar", "D", "E", "N"],
          ["Sam Sample", "Resident", "N", "N", ""],
        ],
      },
      {
        table: [
          ["Name", "Grade", "Thu 8/10", "Fri 9/10", "Sat 10/10"],
          ["Dr Alex Example", "Registrar", "OFF", "D", "D"],
        ],
      },
      { title: "Page 3 of 3", table: [["Sam Sample", "Resident", "D", "", "E"]] },
    ]);
    const grid = await readRosterPdf(pdf, TODAY);
    const days = (cells: readonly string[]) => cells.filter((_, column) => grid.dates[column] !== null).join(",");
    expect(grid.rows.map((row) => [row.name, days(row.cells)])).toEqual([
      ["Dr Alex Example", "D,E,N,OFF,D,D"],
      ["Sam Sample", "N,N,,D,,E"],
    ]);
  });

  it("does not join a later page whose days go backwards or repeat", async () => {
    const pdf = rosterPdf([
      { table: [SAMPLE_ROSTER.header, ...SAMPLE_ROSTER.rows] },
      {
        table: [
          ["Name", "Grade", "Wed 30/9", "Thu 1/10", "Fri 2/10"],
          ["Other Person", "Intern", "D", "D", "D"],
        ],
      },
    ]);
    expect(await namesAndFirstRow(readRosterPdf(pdf, TODAY))).toEqual(expected);
  });

  it("refuses a PDF longer than the page cap instead of reading only its first pages", async () => {
    const pages = Array.from({ length: 13 }, () => ({ table: [SAMPLE_ROSTER.header, ...SAMPLE_ROSTER.rows] }));
    await expect(readRosterPdf(rosterPdf(pages), TODAY)).rejects.toMatchObject({ reason: "too_big" });
  });

  it("says a scanned PDF can't be read", async () => {
    await expect(readRosterPdf(sampleRosterPdf({ scanned: true }), TODAY)).rejects.toMatchObject({ reason: "scanned" });
  });

  it("says a file that isn't a workbook is unreadable", async () => {
    await expect(readRosterXlsx(Buffer.from("not a workbook"), TODAY)).rejects.toMatchObject({ reason: "unreadable" });
  });
});

describe("inferShiftKind", () => {
  it("uses the title first, then Perth times", () => {
    expect(
      inferShiftKind({ startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-10-01T09:00:00Z", title: "Registrar on call" }),
    ).toBe("on_call");
    expect(inferShiftKind({ startsAt: "2026-10-01T13:30:00Z", endsAt: "2026-10-02T00:00:00Z", title: "Ward" })).toBe(
      "night",
    );
    expect(inferShiftKind({ startsAt: "2026-10-01T06:00:00Z", endsAt: "2026-10-01T14:30:00Z", title: "Ward" })).toBe(
      "evening",
    );
    expect(inferShiftKind({ startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-10-01T08:30:00Z", title: "Ward" })).toBe(
      "day",
    );
  });
});
