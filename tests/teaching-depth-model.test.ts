import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import {
  FEEDBACK_PRIVACY_LINE,
  IMPORT_MAX_ROWS,
  IMPORT_TEMPLATE_HEADERS,
  SUPERVISION_UNDO_MS,
  cpdReviewBodySchema,
  feedbackTotalsSchema,
  pendingConfirmations,
  reviewHours,
  supervisionReadSchema,
  teachingDepthActionSchema,
  teachingDepthQuerySchema,
  teachingDepthUrl,
  unloggedReviewRows,
} from "@/lib/teaching/depth-model";
import { demoCpdReview, demoFeedbackOpen, demoSupervision, demoTeach } from "@/lib/teaching/depth-demo";
import { previewRows } from "@/lib/teaching/import-sheet";
import { parseCsv, readXlsxRows } from "@/lib/teaching/import-sheet-reader";
import { logbookRowSchema, teamSummarySchema } from "@/lib/teaching/model";

import { ENTRY, ENTRY_2, NOTE, PAIRING, SERVICE, entry, pairing, pairingView } from "./helpers/teaching-depth-fixtures";

const ok = (body: unknown) => teachingDepthActionSchema.safeParse(body).success;
const log = {
  action: "supervision.log",
  pairingId: PAIRING,
  date: "2026-09-30",
  minutes: 60,
  type: "individual",
  topics: ["risk"],
};
const GROUP = "99999999-9999-4999-8999-999999999999";

describe("depth requests carry only the fixed fields teaching_depth_command accepts", () => {
  it("logs 15 to 240 minutes in quarter hours, none to five known topics, and nothing else", () => {
    expect(ok(log)).toBe(true);
    expect(ok({ ...log, minutes: 20 })).toBe(false);
    expect(ok({ ...log, minutes: 255 })).toBe(false);
    expect(ok({ ...log, topics: [] })).toBe(true);
    expect(ok({ ...log, topics: ["risk", "formulation", "medication", "career", "wellbeing", "other"] })).toBe(false);
    expect(ok({ ...log, topics: ["risk", "risk"] })).toBe(false);
    expect(ok({ ...log, topics: ["patient_name"] })).toBe(false);
    for (const extra of [{ actorId: PAIRING }, { registrarId: PAIRING }, { comment: "free text" }])
      expect(ok({ ...log, ...extra })).toBe(false);
  });

  it("confirms one entry or a batch of up to 20, each once", () => {
    expect(ok({ action: "supervision.confirm", entryIds: [ENTRY] })).toBe(true);
    expect(ok({ action: "supervision.confirm", entryIds: [ENTRY, ENTRY] })).toBe(false);
    expect(ok({ action: "supervision.confirm", entryIds: [] })).toBe(false);
    expect(ok({ action: "supervision.confirm", entryIds: [ENTRY], supervisorId: PAIRING })).toBe(false);
  });

  it("takes a correction as its fixed field only, never free text", () => {
    const note = { action: "supervision.note", entryId: ENTRY };
    expect(ok({ ...note, reason: "wrong_length", correctedValue: { minutes: 45 } })).toBe(true);
    expect(ok({ ...note, reason: "wrong_length", correctedValue: { minutes: 45, comment: "free text" } })).toBe(false);
    expect(ok({ ...note, reason: "wrong_date", correctedValue: { minutes: 45 } })).toBe(false);
    expect(ok({ ...note, reason: "entered_in_error", correctedValue: {} })).toBe(true);
  });

  it("lets the registrar set a target in tenths of an hour, or clear it with null", () => {
    const target = { action: "supervision.target.set", pairingId: PAIRING };
    expect(ok({ ...target, targetHours: 20 })).toBe(true);
    expect(ok({ ...target, targetHours: 12.5 })).toBe(true);
    expect(ok({ ...target, targetHours: null })).toBe(true);
    expect(ok({ ...target, targetHours: 0.05 })).toBe(false);
    expect(ok({ ...target, targetHours: 501 })).toBe(false);
  });

  it("pairs two different people for up to two years, with no target from an organiser", () => {
    const pair = {
      action: "pairing.save",
      registrarId: PAIRING,
      supervisorId: ENTRY,
      startsOn: "2026-08-03",
      endsOn: "2027-02-01",
    };
    expect(ok(pair)).toBe(true);
    expect(ok({ ...pair, supervisorId: PAIRING })).toBe(false);
    expect(ok({ ...pair, endsOn: "2028-08-04" })).toBe(false);
    expect(ok({ ...pair, targetHours: 40 })).toBe(false);
  });

  it("takes feedback as two taps and no name", () => {
    const answer = { action: "feedback.submit", occurrenceId: ENTRY, useful: 4, pace: "right" };
    expect(ok(answer)).toBe(true);
    expect(ok({ ...answer, useful: 6 })).toBe(false);
    expect(ok({ ...answer, name: "Dr Demo" })).toBe(false);
  });

  it("refuses a read that names whose supervision it wants", () => {
    expect(teachingDepthQuerySchema.safeParse({ action: "supervision.read" }).success).toBe(true);
    expect(
      teachingDepthQuerySchema.safeParse({ action: "supervision.read", pairingId: PAIRING, registrarId: ENTRY })
        .success,
    ).toBe(false);
  });

  it("logs 0.25 to 8 CPD hours per row, each session once, 20 rows at most", () => {
    const row = { occurrenceId: ENTRY, hours: 1, requestId: NOTE };
    expect(cpdReviewBodySchema.safeParse({ rows: [row] }).success).toBe(true);
    expect(cpdReviewBodySchema.safeParse({ rows: [{ ...row, hours: 8 }] }).success).toBe(true);
    expect(cpdReviewBodySchema.safeParse({ rows: [{ ...row, hours: 8.25 }] }).success).toBe(false);
    expect(cpdReviewBodySchema.safeParse({ rows: [row, row] }).success).toBe(false);
  });

  // Master plan R25: the browser reads the file and sends its rows; no file ever reaches the server.
  it("previews rows the browser read, never a file", () => {
    const rows = [
      { line: 1, cells: [...IMPORT_TEMPLATE_HEADERS] },
      { line: 2, cells: ["Demo"] },
    ];
    expect(ok({ action: "import.preview", rows })).toBe(true);
    expect(ok({ action: "import.preview", format: "xlsx", content: "UEsDBA==" })).toBe(false);
    expect(ok({ action: "import.preview", rows, content: "UEsDBA==" })).toBe(false);
    expect(ok({ action: "import.preview", rows: [] })).toBe(false);
    expect(ok({ action: "import.preview", rows: [{ line: 1, cells: ["x".repeat(2001)] }] })).toBe(false);
    const tooMany = Array.from({ length: IMPORT_MAX_ROWS + 2 }, (_, index) => ({ line: index + 1, cells: ["Demo"] }));
    const refused = teachingDepthActionSchema.safeParse({ action: "import.preview", rows: tooMany });
    expect(refused.error?.issues[0]?.message).toBe("Import at most 200 rows at a time.");
  });

  it("commits new series only, with no presenter (R25)", () => {
    const row = {
      title: "Demo journal club",
      kind: "journal",
      repeat: "weekly",
      firstDate: "2026-10-07",
      startTime: "12:30",
      minutes: 60,
      endDate: "2026-12-16",
    };
    expect(ok({ action: "import.commit", rows: [row] })).toBe(true);
    expect(ok({ action: "import.commit", rows: [{ ...row, seriesId: ENTRY }] })).toBe(false);
    expect(ok({ action: "import.commit", rows: [{ ...row, presenterId: ENTRY }] })).toBe(false);
  });
});

describe("depth results", () => {
  it("gives organisers totals and status, never topics or the registrar's target", () => {
    const [row] = supervisionReadSchema.parse({
      pairings: [pairing({ access: "organiser", targetHours: 20 })],
    }).pairings;
    expect(row).toMatchObject({ entries: null, targetHours: null, confirmedMinutes: 60, pendingCount: 1 });
  });

  it("gives a presenter counts only, and nothing before release", () => {
    expect(feedbackTotalsSchema.parse({ released: false, replies: 2 })).toEqual({ released: false });
    const totals = feedbackTotalsSchema.parse({
      released: true,
      replies: 3,
      useful: { 1: 0, 2: 0, 3: 1, 4: 1, 5: 1 },
      pace: { slow: 0, right: 3, fast: 0 },
      responders: ["x"],
    });
    expect(Object.keys(totals).sort()).toEqual(["pace", "released", "replies", "useful"]);
  });

  it("lists what waits for the reader as supervisor, oldest first, and nothing from their own pairing", () => {
    const note = {
      noteId: NOTE,
      reason: "wrong_length" as const,
      correctedValue: { minutes: 45 },
      createdAt: "2026-09-29T02:00:00.000Z",
      confirmedAt: null,
    };
    const supervised = pairingView({
      access: "supervisor",
      entries: [
        entry({ status: "confirmed", confirmedAt: "2026-09-29T01:00:00.000Z", notes: [note] }),
        entry({ entryId: ENTRY_2, date: "2026-09-21" }),
      ],
    });
    expect(pendingConfirmations([supervised, pairingView()]).map((item) => [item.kind, item.id, item.since])).toEqual([
      ["entry", ENTRY_2, "2026-09-21"],
      ["note", NOTE, "2026-09-29"],
    ]);
  });

  it("never asks a leaver to confirm anything", () => {
    const left = pairingView({ access: "supervisor", readOnlyUntil: "2026-12-01T00:00:00.000Z" });
    expect(pendingConfirmations([left])).toEqual([]);
  });

  it("defaults review hours to the scheduled length in quarter hours, 0.25 to 8", () => {
    expect(reviewHours("2026-09-30T04:30:00Z", "2026-09-30T05:30:00Z")).toBe(1);
    expect(reviewHours("2026-09-30T04:30:00Z", "2026-09-30T04:40:00Z")).toBe(0.25);
    expect(reviewHours("2026-09-30T00:00:00Z", "2026-09-30T10:00:00Z")).toBe(8);
    const row = {
      occurrenceId: ENTRY,
      method: "self" as const,
      recordedAt: "2026-09-29T04:30:00Z",
      title: "Demo",
      startsAt: "2026-09-29T04:30:00Z",
      endsAt: "2026-09-29T05:30:00Z",
      serviceName: "Demo service",
      cpdEntryId: null,
    };
    const now = new Date("2026-09-30T03:50:00Z");
    expect(
      unloggedReviewRows(
        [
          row,
          { ...row, occurrenceId: NOTE, cpdEntryId: ENTRY_2 },
          { ...row, occurrenceId: PAIRING, endsAt: "2026-09-30T05:30:00Z" },
        ],
        now,
      ).map((r) => r.occurrenceId),
    ).toEqual([ENTRY]);
  });

  it("builds the service-scoped depth address", () => {
    expect(teachingDepthUrl(SERVICE, { action: "feedback.totals", occurrenceId: ENTRY })).toBe(
      `/api/teaching/services/${SERVICE}/depth?action=feedback.totals&occurrenceId=${ENTRY}`,
    );
  });

  it("keeps the fixed words and the 10-second hold (R24, R26)", () => {
    expect(FEEDBACK_PRIVACY_LINE).toBe("Presenter and organisers see answers, not your name");
    expect(SUPERVISION_UNDO_MS).toBe(10_000);
  });

  it("reads week.read's presenting flag and a leaver's read-only date from the logbook", () => {
    const team = { id: SERVICE, name: "Demo service", role: "doctor", acceptsRealData: true, isDemo: true };
    expect(teamSummarySchema.parse({ ...team, presenting: true }).presenting).toBe(true);
    expect(teamSummarySchema.parse(team).presenting).toBeUndefined();
    const row = logbookRowSchema.parse({
      occurrenceId: ENTRY,
      method: "self",
      recordedAt: "2026-09-29T04:30:00Z",
      title: "Demo",
      startsAt: "2026-09-29T04:30:00Z",
      endsAt: "2026-09-29T05:30:00Z",
      serviceId: SERVICE,
      serviceName: "Demo service",
      readOnlyUntil: "2026-12-01T00:00:00Z",
      cpdEntryId: null,
    });
    expect(row).toMatchObject({ serviceId: SERVICE, readOnlyUntil: "2026-12-01T00:00:00Z" });
  });
});

describe("the made-up depth demo", () => {
  const today = "2026-09-30";

  it("parses through the same result schemas and names only made-up people", () => {
    const pairings = demoSupervision(today);
    expect(supervisionReadSchema.parse({ pairings }).pairings).toHaveLength(2);
    const text = JSON.stringify([pairings, demoTeach(today), demoFeedbackOpen(today)]);
    for (const name of text.match(/Dr [A-Z][a-z]+ [A-Z][a-z]+/g) ?? []) expect(name).toMatch(/^Dr Demo /);
    expect(pendingConfirmations(pairings).map((item) => item.registrarName)).toEqual([
      "Dr Demo Trainee",
      "Dr Demo Trainee",
    ]);
  });

  it("offers the demo logbook's unlogged sessions for the weekly CPD review", () => {
    const now = new Date("2026-09-30T03:50:00Z");
    expect(demoCpdReview(now).every((row) => row.hours === 1)).toBe(true);
  });
});

describe("the spreadsheet import", () => {
  const header = IMPORT_TEMPLATE_HEADERS.join(",");
  const clean = "Demo journal club,journal,weekly,2026-10-07,2026-12-16,12:30,60,Demo library,,Registrars";

  it("reads quoted cells, doubled quotes, CRLF and keeps each row's line number", () => {
    expect(parseCsv('﻿a,b\r\n"x, ""y""",z\r\n\r\nlast,1')).toEqual([
      { line: 1, cells: ["a", "b"] },
      { line: 2, cells: ['x, "y"', "z"] },
      { line: 4, cells: ["last", "1"] },
    ]);
  });

  it("is ready only when every row is clean, and names each row's problem", () => {
    const groups = [{ groupId: GROUP, name: "Registrars", userIds: [] }];
    const good = previewRows(parseCsv(`${header}\n${clean}`), groups);
    expect(good.ready).toHaveLength(1);
    expect(good.ready?.[0]).toMatchObject({
      title: "Demo journal club",
      groupIds: [GROUP],
      joinUrl: null,
      presenterId: null,
    });

    const bad = previewRows(
      parseCsv(
        [
          header,
          clean,
          '"Demo grand round, term 4",grand_round,once,2026-10-08,,08:00,60,Demo theatre,https://teams.microsoft.com/meet/1?p=abc,Interns',
          clean,
        ].join("\n"),
      ),
      groups,
    );
    expect(bad.ready).toBeNull();
    expect(bad.rows.map((row) => [row.line, row.errors])).toEqual([
      [2, []],
      [
        3,
        [
          'groups: No group called "Interns". Add it in Organise first.',
          "join_link: Remove the passcode from this link. Share passcodes another way.",
        ],
      ],
      [4, ["Same session as line 2."]],
    ]);
  });

  it("names the missing columns instead of guessing", () => {
    expect(previewRows(parseCsv("title,kind\nDemo,journal"), []).rows[0].errors[0]).toContain("repeat, first_date");
  });

  it("refuses patient-shaped column headers before accepting any row", () => {
    const groups = [{ groupId: GROUP, name: "Registrars", userIds: [] }];
    const refused = previewRows(
      parseCsv(`${header},patient_name,mrn\n${clean},Alex Example,12345`),
      groups,
    );
    expect(refused.ready).toBeNull();
    expect(refused.rows[0].errors[0]).toMatch(/patient details/i);
    expect(refused.rows[0].errors[0]).toMatch(/patient_name/);
    expect(refused.rows[0].errors[0]).toMatch(/\bmrn\b/);
    expect(refused.rows[0].errors[0]).not.toMatch(/Alex Example|12345/);
  });

  it("reads dates and times from an .xlsx made from the template", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Term");
    sheet.addRow([...IMPORT_TEMPLATE_HEADERS]);
    sheet.addRow([
      "Demo journal club",
      "journal",
      "weekly",
      new Date(Date.UTC(2026, 9, 7)),
      new Date(Date.UTC(2026, 11, 16)),
      new Date(Date.UTC(1899, 11, 30, 12, 30)),
      60,
      "Demo library",
      "",
      "Registrars",
    ]);
    const rows = await readXlsxRows(new Uint8Array(await workbook.xlsx.writeBuffer()));
    expect(rows[1].cells.slice(0, 7)).toEqual([
      "Demo journal club",
      "journal",
      "weekly",
      "2026-10-07",
      "2026-12-16",
      "12:30",
      "60",
    ]);
  });

  it("refuses a file that is not a small spreadsheet, before opening it", async () => {
    await expect(readXlsxRows(new Uint8Array([1, 2, 3]))).rejects.toThrow(
      "This file couldn't be read. Save it from the template as .xlsx or .csv.",
    );
    await expect(readXlsxRows(new Uint8Array(1_048_577))).rejects.toThrow("Use a file under 1 MB.");
  });
});
