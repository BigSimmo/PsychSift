import { describe, expect, it } from "vitest";

import type { LogbookRow } from "@/lib/teaching/model";
import {
  buildTermFolder,
  folderMeterLabel,
  folderSections,
  otherTerms,
  pickFolderTerm,
  sessionsInTerm,
  supervisionInTerm,
  termFolderCsv,
  termFolderFileName,
  termFolderNeedsYou,
  termFolderSearchEntries,
  type FolderSource,
} from "@/lib/teaching/term-folder";
import { EMPTY_TERM_TRACKER, type TermRecord, type TermTrackerState } from "@/lib/teaching/term-tracker";
import { entry, pairingView } from "./helpers/teaching-depth-fixtures";

const NB = " ";

const term = (overrides: Partial<TermRecord> = {}): TermRecord => ({
  id: "t4",
  number: 4,
  unit: "Psychiatry",
  site: "Example Hospital",
  startsOn: "2026-08-31",
  endsOn: "2026-11-06",
  supervisor: "Dr Example",
  milestones: {
    start: { dueOn: "2026-09-06", doneOn: "2026-09-02" },
    mid: { dueOn: "2026-10-02", doneOn: null },
    end: { dueOn: "2026-11-06", doneOn: null },
  },
  goals: [],
  toRaise: [],
  meeting: null,
  ...overrides,
});

const tracker = (t: TermRecord = term(), extra: Partial<TermTrackerState> = {}): TermTrackerState => ({
  ...EMPTY_TERM_TRACKER,
  currentTermId: t.id,
  terms: [t],
  ...extra,
});

const row = (startsAt: string, overrides: Partial<LogbookRow> = {}): LogbookRow => ({
  occurrenceId: `occ-${startsAt}`,
  method: "code_room",
  recordedAt: startsAt,
  title: "Grand rounds",
  startsAt,
  endsAt: new Date(Date.parse(startsAt) + 3_600_000).toISOString(),
  serviceName: "Example service",
  cpdEntryId: null,
  ...overrides,
});

const ready = <T>(data: T): FolderSource<T> => ({ status: "ready", data });

describe("term evidence folder", () => {
  const today = "2026-10-06";
  const rows = [
    row("2026-08-20T04:30:00Z"), // before the term: left out
    row("2026-09-08T04:30:00Z"),
    row("2026-10-06T04:30:00Z", { cpdEntryId: "cpd-1", method: "self" }),
    row("2026-11-20T04:30:00Z"), // after the term: left out
  ];

  it("keeps only check-ins inside the term, by Perth date", () => {
    // 2026-08-30T17:00Z is 31 Aug 01:00 in Perth, the term's first day.
    const edge = [row("2026-08-30T17:00:00Z"), row("2026-08-30T15:00:00Z")];
    expect(sessionsInTerm(edge, term())).toHaveLength(1);
    expect(sessionsInTerm(rows, term())).toHaveLength(2);
  });

  it("reads only the reader's own registrar pairings for supervision", () => {
    const mine = pairingView();
    const supervising = pairingView({ access: "supervisor", entries: [entry({ date: "2026-09-10" })] });
    const result = supervisionInTerm([mine, supervising], term());
    expect(result.paired).toBe(true);
    expect(result.entries.map((e) => e.date)).toEqual(["2026-09-21", "2026-09-28"]);
    expect(supervisionInTerm([supervising], term()).paired).toBe(false);
  });

  it("builds seven parts with status and counts only, and a matching meter sentence", () => {
    const folder = buildTermFolder({
      today,
      state: tracker(),
      term: term(),
      attendance: ready(rows),
      supervision: ready([pairingView()]),
    });
    expect(folder.parts.map((p) => p.id)).toEqual(["details", "attendance", "supervision", "start", "mid", "end", "epas"]);
    const byId = Object.fromEntries(folder.parts.map((p) => [p.id, p]));
    expect(byId.details.status).toBe("complete");
    expect(byId.attendance).toMatchObject({ status: "on_track", detail: `2${NB}sessions · 2${NB}h · last Tue 6 Oct` });
    expect(byId.supervision).toMatchObject({ status: "on_track", detail: `1${NB}h confirmed · 1${NB}awaiting confirmation` });
    expect(byId.start).toMatchObject({ status: "complete", detail: "Marked done Wed 2 Sep" });
    expect(byId.mid.status).toBe("to_fix");
    expect(byId.end.status).toBe("not_started");
    expect(byId.epas).toMatchObject({ status: "not_started", detail: "None logged · no target set" });
    expect(folder.counts).toEqual({ complete: 2, on_track: 2, to_fix: 1, not_updating: 0, not_started: 2 });
    expect(folder.headline).toBe(`2${NB}of 7 complete`);
    expect(folder.meterLabel).toBe(`7${NB}parts: 2 complete, 2 on track, 1 to fix, 2 not started.`);
    expect(folder.dates).toBe(`31 Aug to 6 Nov · week 6${NB}of 10`);
    expect(folder.sessions).toHaveLength(2);
    expect(folder.sessions[1]).toMatchObject({ how: "Self-reported", inCpd: true, hours: 1 });
  });

  it("never carries supervision topics or any free text from the records", () => {
    const folder = buildTermFolder({
      today,
      state: tracker(),
      term: term(),
      attendance: ready(rows),
      supervision: ready([pairingView()]),
    });
    const csv = termFolderCsv(folder, today);
    expect(csv).not.toMatch(/case_review|psychotherapy|risk/i);
    expect(Object.keys(folder.supervision[0]!)).toEqual(["date", "minutes", "type", "status"]);
  });

  it("marks a failed read as not updating for that part only, and says when it is still loading", () => {
    const folder = buildTermFolder({
      today,
      state: tracker(),
      term: term(),
      attendance: { status: "failed" },
      supervision: { status: "loading" },
    });
    expect(folder.parts.find((p) => p.id === "attendance")?.status).toBe("not_updating");
    expect(folder.loading).toBe(true);
    expect(folder.meterLabel).toMatch(/Still loading\.$/);
  });

  it("asks for missing details, and handles no pairing and an empty term", () => {
    const folder = buildTermFolder({
      today: "2026-08-30",
      state: tracker(term({ supervisor: " " })),
      term: term({ supervisor: " " }),
      attendance: ready([]),
      supervision: ready([]),
    });
    const byId = Object.fromEntries(folder.parts.map((p) => [p.id, p]));
    expect(byId.details).toMatchObject({ status: "to_fix", detail: "Add your supervisor" });
    expect(byId.attendance.detail).toBe("From your first check-in");
    expect(byId.supervision.detail).toBe("No supervision pairing yet");
    expect(folder.phase).toBe("before");
    expect(folder.dates).toBe("31 Aug to 6 Nov · starts Mon 31 Aug");
  });

  it("judges EPAs only against a target the doctor chose, and flags a shortfall only once the term has ended", () => {
    const t = term();
    const epas = [{ id: "e1", termId: "t4", epa: 1 as const, on: "2026-09-10" }];
    const withTarget = tracker(t, { epas, targets: { perTerm: 2, perYear: 10 } });
    const during = buildTermFolder({ today, state: withTarget, term: t, attendance: ready([]), supervision: ready([]) });
    expect(during.parts.find((p) => p.id === "epas")).toMatchObject({ status: "on_track", detail: `1${NB}of 2 logged` });
    const after = buildTermFolder({
      today: "2026-11-20",
      state: withTarget,
      term: t,
      attendance: ready(rows),
      supervision: ready([]),
    });
    expect(after.parts.find((p) => p.id === "epas")?.status).toBe("to_fix");
    expect(after.parts.find((p) => p.id === "attendance")?.status).toBe("complete");
    expect(after.dates).toBe("31 Aug to 6 Nov · ended");
    const noTarget = tracker(t, { epas });
    const plain = buildTermFolder({ today, state: noTarget, term: t, attendance: ready([]), supervision: ready([]) });
    expect(plain.parts.find((p) => p.id === "epas")).toMatchObject({ status: "on_track", detail: `1${NB}EPA logged · no target set` });
  });

  it("groups parts urgent first and drops empty groups", () => {
    const folder = buildTermFolder({
      today,
      state: tracker(),
      term: term(),
      attendance: { status: "failed" },
      supervision: ready([pairingView()]),
    });
    expect(folderSections(folder).map((s) => s.status)).toEqual([
      "to_fix",
      "not_updating",
      "on_track",
      "complete",
      "not_started",
    ]);
  });

  it("writes a CSV that quotes every cell and defuses formulas", () => {
    const t = term({ unit: "=HYPERLINK(1)" });
    const folder = buildTermFolder({
      today,
      state: tracker(t),
      term: t,
      attendance: ready([row("2026-09-08T04:30:00Z", { title: '+cmd "x"' })]),
      supervision: ready([]),
    });
    const csv = termFolderCsv(folder, today);
    expect(csv).toContain(`"Term details","complete","'=HYPERLINK(1) · `);
    expect(csv).toContain(`"'+cmd ""x"""`);
    expect(csv).toContain('"Part","Status","Detail"');
    expect(csv).toContain("Assessment forms are not kept in PsychSift");
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(termFolderFileName({ title: "Term 4 · Psychiatry" })).toBe("term-4-psychiatry-evidence-folder.csv");
    expect(termFolderFileName({ title: "···" }, true)).toBe("term-evidence-folder-demo.csv");
  });

  it("picks the asked-for term, else the current one, else the newest", () => {
    const old = term({ id: "t3", number: 3, startsOn: "2026-06-22", endsOn: "2026-08-30" });
    const state = { ...tracker(), terms: [old, term()] };
    expect(pickFolderTerm(state, "t3")?.id).toBe("t3");
    expect(pickFolderTerm(state, "nope")?.id).toBe("t4");
    expect(pickFolderTerm({ ...state, currentTermId: null }, null)?.id).toBe("t4");
    expect(pickFolderTerm(EMPTY_TERM_TRACKER, null)).toBeNull();
    expect(otherTerms(state, "t4").map((t) => t.id)).toEqual(["t3"]);
  });

  it("gives Needs you an overdue line and, near the end of term, an export prompt", () => {
    expect(termFolderNeedsYou(tracker(), today)).toEqual([
      {
        id: "term-folder-t4-mid",
        title: "Mid-term assessment not marked done",
        dueOn: "2026-10-02",
        area: "teaching",
        href: "/teaching/term/folder?term=t4",
        kind: "update",
      },
    ]);
    const nearEnd = termFolderNeedsYou(tracker(), "2026-11-01").map((i) => i.title);
    expect(nearEnd).toContain("Export your Term 4 · Psychiatry evidence folder");
    expect(termFolderNeedsYou(tracker(), "2026-12-01").some((i) => i.kind === "action")).toBe(false);
    expect(termFolderNeedsYou(EMPTY_TERM_TRACKER, today)).toEqual([]);
  });

  it("offers work search the page only, never record text", () => {
    const [entry] = termFolderSearchEntries();
    expect(entry).toMatchObject({ title: "Term evidence folder", href: "/teaching/term/folder", area: "teaching" });
  });

  it("says nothing it cannot count", () => {
    expect(folderMeterLabel({ complete: 0, on_track: 0, to_fix: 0, not_updating: 0, not_started: 0 })).toBe(
      `0${NB}parts.`,
    );
  });
});
