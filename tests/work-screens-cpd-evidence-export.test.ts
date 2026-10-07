import { describe, expect, it } from "vitest";

import { DEMO_CME_ENTRIES } from "@/lib/cme/demo-year";
import type { CmeEntry, CmeRequirementSet } from "@/lib/cme/types";
import {
  attachTarget,
  evidenceHref,
  evidenceRowLine,
  evidenceView,
  fileCountWords,
  parseEvidenceCategory,
  parseEvidenceStatus,
} from "@/lib/work-screens/cpd/evidence";
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
