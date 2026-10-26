import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { renderCaseSummary, latestQualityReport } from "../scripts/eval-canary-case-summary.mjs";

// Audit F24: an aggregate green run can carry an individually failing case (#628),
// and the markdown report truncated failed cases at ten. Every case that failed
// must be listed on every run, green or red.
const report = (ragFailed: number, retrievalFailed = 0) => ({
  retrieval: {
    summary: {
      case_count: 36,
      failed_cases: Array.from({ length: retrievalFailed }, (_, i) => ({ id: `r-${i}`, failures: ["doc recall 0"] })),
    },
  },
  rag: {
    summary: {
      case_count: 44,
      failed_cases: Array.from({ length: ragFailed }, (_, i) => ({ id: `case-${i}`, failures: [`reason ${i}`] })),
    },
  },
});

describe("eval canary per-case summary", () => {
  it("lists every individually failing case, with no ten-case cut-off", () => {
    const text = renderCaseSummary(report(12, 1));
    for (let i = 0; i < 12; i++) expect(text).toContain(`\`case-${i}\`: reason ${i}`);
    expect(text).toContain("12 of 44 answer cases failed individually");
    expect(text).toContain("1 of 36 retrieval cases failed individually");
    expect(text).toContain("whether or not the run's overall thresholds passed");
  });

  it("says plainly when every case passed", () => {
    expect(renderCaseSummary(report(0))).toContain("Every answer case passed individually.");
  });

  it("says a section with no cases was not run, rather than that every case passed", () => {
    const ragOnly = { rag: report(0).rag, retrieval: { summary: { case_count: 0, failed_cases: [] } } };
    expect(renderCaseSummary(ragOnly)).toContain("No retrieval cases were run in this report.");
    expect(renderCaseSummary({ rag: report(0).rag })).toContain("No retrieval cases were run in this report.");
    expect(renderCaseSummary({ rag: report(0).rag })).not.toContain("Every retrieval case passed");
  });

  it("says the evaluation did not produce a report rather than implying a pass", () => {
    expect(renderCaseSummary(null)).toContain("No per-case report was produced");
  });

  it("reads the newest report in the directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "canary-"));
    writeFileSync(join(dir, "retrieval-quality-2026-09-01T00-00-00.json"), JSON.stringify(report(1)));
    writeFileSync(join(dir, "retrieval-quality-2026-09-20T00-00-00.json"), JSON.stringify(report(3)));
    writeFileSync(join(dir, "retrieval-quality-2026-09-20T00-00-00.md"), "not json");
    expect(latestQualityReport(dir)?.rag.summary.failed_cases).toHaveLength(3);
    expect(latestQualityReport(join(dir, "missing"))).toBeNull();
  });
});

describe("eval canary workflow runs the per-case summary on every run", () => {
  const workflow = readFileSync(new URL("../.github/workflows/eval-canary.yml", import.meta.url), "utf8");
  it("has an always-run summary step after the evaluations", () => {
    const step = workflow.slice(workflow.indexOf("- name: Per-case summary"));
    expect(step).toContain("if: always() && steps.install.outcome == 'success'");
    expect(step).toContain(
      "node scripts/eval-canary-case-summary.mjs --reports-dir .local/eval-canary/quality-reports",
    );
    expect(workflow.indexOf("- name: Per-case summary")).toBeGreaterThan(workflow.indexOf("id: answer_quality"));
  });
});
