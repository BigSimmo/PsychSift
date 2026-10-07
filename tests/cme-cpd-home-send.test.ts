import fs from "node:fs";

import { describe, expect, it } from "vitest";

import { CPD_HOME_SEND_STORAGE_KEY } from "@/lib/account-scoped-browser-state";
import {
  addedEntryIds,
  cpdHomeActivityText,
  cpdHomeAllText,
  cpdHomeFileName,
  cpdHomeNeedsYouItems,
  cpdHomeRowProblems,
  cpdHomeRows,
  cpdHomeSearchRecords,
  CPD_HOME_FILE_HISTORY_LIMIT,
  EMPTY_CPD_HOME_SEND,
  entriesNotYetAdded,
  formatCpdHomeCsv,
  formatCpdHomeTable,
  isValidCpdHomeSendState,
  lastAddedFile,
  markCpdHomeFileAdded,
  parseCpdHomeSendState,
  recordCpdHomeFile,
  reflectionsToLeaveOut,
  removeCpdHomeFile,
  unmarkCpdHomeFileAdded,
  type CpdHomeFile,
} from "@/lib/cme/cpd-home-send";
import type { CmeEntry, CmeRequirementSet } from "@/lib/cme/types";

const set: CmeRequirementSet = {
  year: 2026,
  confirmedOn: "2026-02-03",
  confirmedSource: "RANZCP",
  totalHours: 50,
  requirements: [],
};

function entry(id: string, date: string, overrides: Partial<CmeEntry> = {}): CmeEntry {
  return {
    id,
    date,
    title: `Activity ${id}`,
    allocations: [{ category: "educational", hours: 1 }],
    reflection: "",
    costCents: null,
    transcribed: false,
    routineId: null,
    documentId: null,
    buckets: [],
    ...overrides,
  };
}

function file(id: string, entryIds: string[], addedAt: string | null, year = 2026): CpdHomeFile {
  return {
    id,
    year,
    madeAt: "2026-10-06T05:11:00.000Z",
    name: `cpd-log-${year}.csv`,
    rows: entryIds.length,
    entryIds,
    includeReflections: false,
    addedAt,
  };
}

const entries = [
  entry("b", "2026-10-02", {
    title: "Grand round",
    allocations: [
      { category: "educational", hours: 1 },
      { category: "reviewing", hours: 0.5 },
    ],
    reflection: "Changed how I review lithium levels",
  }),
  entry("a", "2026-01-15", { title: "Peer review group", allocations: [{ category: "reviewing", hours: 1.5 }] }),
  entry("old", "2025-12-30"),
  entry("gone", "2026-03-01", { archivedAt: "2026-03-02T00:00:00Z" }),
];

describe("CPD Home rows", () => {
  it("keeps only the year's active activities, oldest first, with split hours and short category names", () => {
    const rows = cpdHomeRows(entries, 2026);
    expect(rows.map((row) => row.entryId)).toEqual(["a", "b"]);
    expect(rows[1]).toMatchObject({
      hours: 1.5,
      educational: 1,
      reviewing: 0.5,
      measuring: 0,
      category: "Educational and Reviewing",
    });
  });

  it("limits to chosen ids", () => {
    expect(cpdHomeRows(entries, 2026, new Set(["b"])).map((row) => row.entryId)).toEqual(["b"]);
    expect(cpdHomeRows(entries, 2026, new Set())).toEqual([]);
  });

  it("refuses a file when a row has no hours, no category or no title", () => {
    const rows = cpdHomeRows(
      [
        entry("z", "2026-05-01", { allocations: [] }),
        entry("t", "2026-05-02", { title: "  " }),
        entry("ok", "2026-05-03"),
      ],
      2026,
    );
    expect(cpdHomeRowProblems(rows)).toEqual([
      { entryId: "z", activity: "Activity z", problem: "No hours" },
      { entryId: "t", activity: "Untitled activity", problem: "No title" },
    ]);
  });
});

describe("CPD Home file", () => {
  const rows = cpdHomeRows(entries, 2026);

  it("leaves reflections out unless asked, with a byte-order mark and CRLF rows", () => {
    const csv = formatCpdHomeCsv(rows, { includeReflections: false });
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).not.toContain("Reflection");
    expect(csv).not.toContain("lithium");
    expect(csv.split("\r\n")).toHaveLength(4);
    expect(csv).toContain('"2026-10-02","Grand round","1.5","1","0.5","0","Educational and Reviewing"');
  });

  it("includes reflections when asked, minus any withheld", () => {
    expect(formatCpdHomeCsv(rows, { includeReflections: true })).toContain("lithium");
    expect(formatCpdHomeCsv(rows, { includeReflections: true, withheldReflections: new Set(["b"]) })).not.toContain(
      "lithium",
    );
  });

  it("keeps spreadsheet commands literal", () => {
    const csv = formatCpdHomeCsv(cpdHomeRows([entry("x", "2026-02-02", { title: "=HYPERLINK(1)" })], 2026), {
      includeReflections: false,
    });
    expect(csv).toContain(`"'=HYPERLINK(1)"`);
  });

  it("copies as a tab-separated table with no stray tabs or line breaks inside a cell", () => {
    const table = formatCpdHomeTable(cpdHomeRows([entry("x", "2026-02-02", { title: "Two\tparts\nhere" })], 2026), {
      includeReflections: false,
    });
    const [, line] = table.split("\n");
    expect(line!.split("\t")).toHaveLength(7);
    expect(line).toContain("Two parts here");
  });

  it("withholds reflections that read like a patient detail", () => {
    const flagged = cpdHomeRows(
      [
        entry("p", "2026-04-01", { reflection: "Saw Mrs Smith, URN 1234567" }),
        entry("q", "2026-04-02", { reflection: "Read the new guideline on clozapine" }),
      ],
      2026,
    );
    expect([...reflectionsToLeaveOut(flagged, 2026)]).toEqual(["p"]);
  });

  it("names files by year and scope", () => {
    expect(cpdHomeFileName(2026, "all", "2026-10-06")).toBe("cpd-log-2026.csv");
    expect(cpdHomeFileName(2026, "new", "2026-10-06")).toBe("cpd-log-2026-new-2026-10-06.csv");
    expect(cpdHomeFileName(2026, "chosen", "2026-10-06")).toBe("cpd-log-2026-chosen-2026-10-06.csv");
  });
});

describe("CPD Home copies", () => {
  it("copies one activity with or without its reflection, never its cost", () => {
    const withCost = { ...entries[0]!, costCents: 12_000 };
    expect(cpdHomeActivityText(withCost, set, true)).toContain("Reflection: Changed how I review");
    const bare = cpdHomeActivityText(withCost, set, false);
    expect(bare).not.toContain("Reflection");
    expect(bare).not.toContain("120");
    expect(bare).toContain("Activity: Grand round");
  });

  it("copies all, one after another, skipping archived and withheld reflections", () => {
    const text = cpdHomeAllText(
      entries.filter((item) => item.date.startsWith("2026")),
      set,
      true,
      new Set(["b"]),
    );
    expect(text.split("\n\n")).toHaveLength(2);
    expect(text).not.toContain("lithium");
    expect(text).not.toContain("Activity gone");
  });
});

describe("CPD Home device record", () => {
  it("reads back an empty record from nothing, junk or a wrong shape", () => {
    expect(parseCpdHomeSendState(null)).toEqual(EMPTY_CPD_HOME_SEND);
    expect(parseCpdHomeSendState("{not json")).toEqual(EMPTY_CPD_HOME_SEND);
    expect(parseCpdHomeSendState(JSON.stringify({ version: 2, files: [] }))).toEqual(EMPTY_CPD_HOME_SEND);
  });

  it("records files newest first, capped, and round-trips", () => {
    let state = EMPTY_CPD_HOME_SEND;
    for (let index = 0; index < CPD_HOME_FILE_HISTORY_LIMIT + 3; index += 1)
      state = recordCpdHomeFile(state, file(`f${index}`, ["a"], null));
    expect(state.files).toHaveLength(CPD_HOME_FILE_HISTORY_LIMIT);
    expect(state.files[0]!.id).toBe(`f${CPD_HOME_FILE_HISTORY_LIMIT + 2}`);
    expect(isValidCpdHomeSendState(state)).toBe(true);
    expect(parseCpdHomeSendState(JSON.stringify(state))).toEqual(state);
  });

  it("marks added, undoes, and finds what is new since", () => {
    let state = recordCpdHomeFile(EMPTY_CPD_HOME_SEND, file("f1", ["a"], null));
    expect(lastAddedFile(state, 2026)).toBeNull();
    state = markCpdHomeFileAdded(state, "f1", "2026-10-06T05:20:00.000Z");
    expect([...addedEntryIds(state, 2026)]).toEqual(["a"]);
    expect(entriesNotYetAdded(entries, state, 2026).map((item) => item.id)).toEqual(["b"]);
    expect(addedEntryIds(state, 2025).size).toBe(0);
    state = unmarkCpdHomeFileAdded(state, "f1");
    expect(lastAddedFile(state, 2026)).toBeNull();
    expect(removeCpdHomeFile(state, "f1").files).toEqual([]);
  });

  it("is cleared with the other account-scoped keys", () => {
    const source = fs.readFileSync("src/lib/account-scoped-browser-state.ts", "utf8");
    const clear = source.slice(source.indexOf("export function clearAccountScopedBrowserStorage"));
    expect(clear).toContain("CPD_HOME_SEND_STORAGE_KEY");
    expect(CPD_HOME_SEND_STORAGE_KEY).toBe("psychsift:cpd:cpd-home-v1");
  });
});

describe("CPD Home hooks for other areas", () => {
  it("raises nothing before a first file is marked added", () => {
    expect(cpdHomeNeedsYouItems(entries, EMPTY_CPD_HOME_SEND, 2026)).toEqual([]);
  });

  it("raises an update for activities not yet in an added file", () => {
    const state = markCpdHomeFileAdded(
      recordCpdHomeFile(EMPTY_CPD_HOME_SEND, file("f1", ["a"], null)),
      "f1",
      "2026-10-06T05:20:00.000Z",
    );
    expect(cpdHomeNeedsYouItems(entries, state, 2026)).toEqual([
      {
        id: "cpd:cpd-home:new:2026",
        title: "1 CPD activity not yet in a CPD Home file",
        dueOn: null,
        area: "cpd",
        href: "/cme/cpd-home",
        kind: "update",
      },
    ]);
  });

  it("offers the page to work search", () => {
    expect(cpdHomeSearchRecords()[0]).toMatchObject({ href: "/cme/cpd-home", area: "cpd" });
  });
});
