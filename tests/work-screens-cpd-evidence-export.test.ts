import { describe, expect, it } from "vitest";

import { DEMO_CME_ENTRIES } from "@/lib/cme/demo-year";
import type { CmeEntry, CmeRequirementSet } from "@/lib/cme/types";
import {
  attachTarget,
  evidenceHref,
  evidenceRowLine,
  evidenceView,
  fileCountWords,
  needsEvidenceEmpty,
  parseEvidenceCategory,
  parseEvidenceOrder,
  parseEvidenceStatus,
} from "@/lib/work-screens/cpd/evidence";
import { cpdExportPatientFlags } from "@/lib/work-screens/cpd/patient-check";
import { withoutExampleRecords } from "@/lib/work-screens/cpd/sample";
import {
  cpdCsvFileName,
  cpdYearCsv,
  cpdExportSummary,
  cpdSummaryLine,
  cpdYearEndState,
} from "@/lib/work-screens/cpd/export";

const base = DEMO_CME_ENTRIES[0]!;

function entry(over: Partial<CmeEntry> & { id: string; date: string }): CmeEntry {
  return { ...base, title: `Activity ${over.id}`, archivedAt: null, ...over } as CmeEntry;
}

const entries: CmeEntry[] = [
  entry({
    id: "a",
    date: "2026-03-01",
    evidenceCount: 0,
    certificateCount: 0,
    allocations: [{ category: "educational", hours: 1 }] as CmeEntry["allocations"],
  }),
  entry({
    id: "b",
    date: "2026-04-01",
    evidenceCount: 2,
    certificateCount: 1,
    allocations: [{ category: "reviewing", hours: 2.5 }] as CmeEntry["allocations"],
  }),
  entry({
    id: "c",
    date: "2026-05-01",
    evidenceCount: undefined,
    certificateCount: undefined,
    allocations: [{ category: "measuring", hours: 1 }] as CmeEntry["allocations"],
  }),
  entry({
    id: "d",
    date: "2026-06-01",
    evidenceCount: 0,
    certificateCount: 0,
    allocations: [{ category: "reviewing", hours: 1 }] as CmeEntry["allocations"],
  }),
  entry({ id: "old", date: "2025-06-01", evidenceCount: 0, certificateCount: 0 }),
  entry({ id: "gone", date: "2026-07-01", evidenceCount: 0, certificateCount: 0, archivedAt: "2026-07-02T00:00:00Z" }),
];

describe("CPD evidence view", () => {
  it("counts the year's active activities by evidence state, leaving archived and other years out", () => {
    const view = evidenceView(entries, 2026, { category: "all", status: "all", order: "newest" });
    expect([view.total, view.missing, view.attached, view.unknown]).toEqual([4, 2, 1, 1]);
    expect(view.needs.map((r) => r.id)).toEqual(["d", "a"]);
    expect(view.has.map((r) => r.id)).toEqual(["b"]);
    expect(view.notCounted.map((r) => r.id)).toEqual(["c"]);
  });

  it("filters by type and status, and orders oldest first on request", () => {
    const reviewing = evidenceView(entries, 2026, { category: "reviewing", status: "all", order: "oldest" });
    expect(reviewing.typeCounts).toEqual({ all: 2, missing: 1, attached: 1 });
    const missing = evidenceView(entries, 2026, { category: "all", status: "missing", order: "oldest" });
    expect(missing.needs.map((r) => r.id)).toEqual(["a", "d"]);
    expect(missing.has).toEqual([]);
    expect(missing.notCounted).toEqual([]);
  });

  it("sends Attach evidence to the one activity, or to the list when several need it", () => {
    const one = evidenceView(
      entries.filter((e) => e.id !== "d"),
      2026,
      { category: "all", status: "all", order: "newest" },
    );
    expect(attachTarget(one)).toEqual({ kind: "entry", href: "/cme/log/a#cme-evidence-heading" });
    expect(attachTarget(evidenceView(entries, 2026, { category: "all", status: "all", order: "newest" }))).toEqual({
      kind: "list",
      clearFilters: false,
    });
    expect(
      attachTarget(evidenceView([entries[1]!], 2026, { category: "all", status: "all", order: "newest" })),
    ).toBeNull();
  });

  it("keeps filters in the address and parses unknown values to all", () => {
    expect(evidenceHref({ year: 2026, category: "reviewing", status: "missing" })).toBe(
      "/cme/evidence?year=2026&category=reviewing&show=missing",
    );
    expect(evidenceHref({})).toBe("/cme/evidence");
    expect(parseEvidenceCategory("nonsense")).toBe("all");
    expect(parseEvidenceStatus("missing")).toBe("missing");
    expect(parseEvidenceStatus(undefined)).toBe("all");
  });

  it("words rows plainly", () => {
    const view = evidenceView(entries, 2026, { category: "all", status: "all", order: "newest" });
    expect(evidenceRowLine(view.has[0]!)).toBe("Reviewing · 2.5\u00a0h");
    expect(fileCountWords(1)).toBe("1 file");
    expect(fileCountWords(3)).toBe("3 files");
    expect(fileCountWords(null)).toBe("Not counted");
  });
});

describe("CPD export", () => {
  it("sums the year by type and counts activities not yet copied to the CPD home", () => {
    const summary = cpdExportSummary(
      [
        entry({
          id: "x",
          date: "2026-02-01",
          transcribed: false,
          allocations: [{ category: "educational", hours: 1.25 }] as CmeEntry["allocations"],
        }),
        entry({
          id: "y",
          date: "2026-02-02",
          transcribed: true,
          allocations: [{ category: "measuring", hours: 2 }] as CmeEntry["allocations"],
        }),
        entry({ id: "z", date: "2025-02-02", transcribed: false }),
      ],
      2026,
    );
    expect(summary.activities).toBe(2);
    expect(summary.hours).toBe(3.25);
    expect(summary.byCategory).toEqual({ educational: 1.25, reviewing: 0, measuring: 2 });
    expect(summary.notCopied).toBe(1);
    expect(cpdSummaryLine(summary)).toBe("2 activities · 3.25\u00a0h");
  });

  it("leaves example records out of the CSV", () => {
    const real = entry({ id: "real-1", date: "2026-02-01", title: "Grand round kept" });
    const made = entry({ id: "example:1", date: "2026-02-02", title: "Made-up workshop" });
    expect(withoutExampleRecords([real, made]).map((e) => e.id)).toEqual(["real-1"]);
    const csv = cpdYearCsv([real, made], { year: 2026 } as unknown as CmeRequirementSet);
    expect(csv).toContain("Grand round kept");
    expect(csv).not.toContain("Made-up workshop");
  });

  it("names the CSV as the server route does", () => {
    expect(cpdCsvFileName(2026, false)).toBe("cme-2026.csv");
    expect(cpdCsvFileName(2026, true)).toBe("cme-2026-demo.csv");
  });

  it("says when the year can be closed", () => {
    const set = { year: 2026, closedAt: null } as unknown as CmeRequirementSet;
    expect(
      cpdYearEndState(
        { ...set, closedAt: "2026-12-20T00:00:00Z" } as CmeRequirementSet,
        new Date("2026-12-21T00:00:00Z"),
      ).kind,
    ).toBe("closed");
    expect(cpdYearEndState(set, new Date("2027-01-05T04:00:00Z")).kind).toBe("open-to-close");
    const early = cpdYearEndState(set, new Date("2026-10-07T04:00:00Z"));
    expect(early.kind).toBe("not-yet");
    if (early.kind === "not-yet") expect(early.from).toMatch(/December 2026/);
  });
});

describe("CPD evidence, adversarial review fixes", () => {
  const all = { category: "all", status: "all", order: "newest" } as const;

  it("never says every activity has evidence when some evidence was not counted", () => {
    const uncounted = [entries[1]!, entries[2]!];
    const view = evidenceView(uncounted, 2026, all);
    expect(view.missing).toBe(0);
    expect(needsEvidenceEmpty(view, false).title).toBe("None known to need evidence");
    expect(needsEvidenceEmpty(view, false).body).toBe("Evidence was not counted for 1 activity. Open it to check.");
    const demo = evidenceView(DEMO_CME_ENTRIES, 2026, all);
    expect(demo.unknown).toBe(demo.total);
    expect(needsEvidenceEmpty(demo, false).title).not.toMatch(/Every activity/);
    expect(needsEvidenceEmpty(evidenceView([entries[1]!], 2026, all), false).title).toBe("Every activity has evidence");
    expect(needsEvidenceEmpty(evidenceView([entries[1]!], 2026, all), true).title).toBe("Nothing here needs evidence");
  });

  it("clears the filters when they hide every activity that needs evidence", () => {
    const educationalHidden = evidenceView(entries.slice(1), 2026, { ...all, category: "educational" });
    expect(educationalHidden.missing).toBe(1);
    expect(attachTarget(educationalHidden)).toEqual({ kind: "list", clearFilters: true });
    const onlyAttached = evidenceView(entries, 2026, { ...all, status: "attached" });
    expect(attachTarget(onlyAttached)).toEqual({ kind: "list", clearFilters: true });
    expect(attachTarget(evidenceView(entries, 2026, all))).toEqual({ kind: "list", clearFilters: false });
  });

  it("keeps the sort order in the address", () => {
    expect(evidenceHref({ year: 2026, order: "oldest" })).toBe("/cme/evidence?year=2026&order=oldest");
    expect(evidenceHref({ year: 2026, order: "newest" })).toBe("/cme/evidence?year=2026");
    expect(parseEvidenceOrder("oldest")).toBe("oldest");
    expect(parseEvidenceOrder("sideways")).toBe("newest");
  });

  it("counts a certificate as a file and explains a missing certificate beside other files", () => {
    const cert = entry({ id: "cert", date: "2026-08-01", evidenceCount: 0, certificateCount: 1 });
    const files = entry({ id: "files", date: "2026-08-02", evidenceCount: 2, certificateCount: 0 });
    const view = evidenceView([cert, files], 2026, all);
    expect(view.has[0]!.files).toBe(1);
    expect(fileCountWords(view.has[0]!.files)).toBe("1 file");
    expect(view.needs[0]!.id).toBe("files");
    expect(evidenceRowLine(view.needs[0]!)).toMatch(/· 2 files, no certificate$/);
    expect(evidenceRowLine(evidenceView([entries[0]!], 2026, all).needs[0]!)).not.toMatch(/certificate/);
  });
});

describe("CPD export, adversarial review fixes", () => {
  const set = {
    year: 2026,
    confirmedOn: "2026-02-03",
    confirmedSource: "Medical Board",
  } as unknown as CmeRequirementSet;

  it("writes a CSV Excel reads: byte-order mark, CRLF lines, quoted cells, formulas kept literal", () => {
    const risky = [
      entry({ id: "r1", date: "2026-02-01", title: '=HYPERLINK("x")', reflection: "+1 point" }),
      entry({ id: "r2", date: "2026-02-02", title: "-2 talk", reflection: "@SUM(A1)" }),
      entry({ id: "r3", date: "2026-02-03", title: "  =cmd", reflection: 'Said "fine", then left' }),
    ];
    const csv = cpdYearCsv(risky, set);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.split("\r\n")).toHaveLength(5);
    expect(csv).not.toMatch(/[^\r]\n/);
    expect(csv).toContain('"\'=HYPERLINK(""x"")"');
    expect(csv).toContain('"\'+1 point"');
    expect(csv).toContain('"\'-2 talk"');
    expect(csv).toContain('"\'@SUM(A1)"');
    expect(csv).toContain('"\'  =cmd"');
    expect(csv).toContain('"Said ""fine"", then left"');
    for (const line of csv.slice(1).trimEnd().split("\r\n")) {
      for (const cell of line.match(/"(?:[^"]|"")*"/g) ?? []) expect(cell).not.toMatch(/^"[=+\-@]/);
    }
  });

  it("puts every exported title and reflection through the shared patient-detail check", () => {
    const flagged = cpdExportPatientFlags(
      [
        entry({ id: "ok", date: "2026-03-01", title: "RANZCP ECT workshop", reflection: "Useful refresher." }),
        entry({ id: "t", date: "2026-03-02", title: "Case review for Mrs Smith", reflection: "" }),
        entry({
          id: "r",
          date: "2026-03-03",
          title: "Peer review",
          reflection: "Discussed a 45 year old male in bed 12",
        }),
        entry({ id: "example:1", date: "2026-03-04", title: "Mrs Jones, UMRN D4678677", reflection: "" }),
        entry({ id: "past", date: "2025-03-04", title: "Mrs Jones review", reflection: "" }),
        entry({ id: "gone", date: "2026-03-05", title: "Mrs Brown review", archivedAt: "2026-03-06T00:00:00Z" }),
      ],
      2026,
    );
    expect(flagged.map((f) => [f.id, f.field])).toEqual([
      ["t", "title"],
      ["r", "reflection"],
    ]);
    expect(flagged[0]!.problem.title).toBeTruthy();
    expect(cpdExportPatientFlags(DEMO_CME_ENTRIES, 2026)).toEqual([]);
  });
});
