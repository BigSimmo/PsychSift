import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { comparePerCaseRanks, compareRetrievalEval, recallFailures } from "../scripts/compare-retrieval-eval";

// A complete retrieval eval summary as emitted by summarizeGoldenRetrievalResults, trimmed to the
// fields the comparison reads.
function summary(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    case_count: 24,
    document_recall_at_5: 1,
    content_recall_at_5: 1,
    top_k_hit_rate: 0.95,
    content_mrr_at_10: 0.9,
    content_mrr_case_count: 12,
    mrr_at_10: 0.88,
    median_latency_ms: 400,
    p90_latency_ms: 900,
    force_embedding_failure_count: 0,
    failed_cases: [],
    latency_failed_cases: [],
    retrieval_layer_counts: { index_units: 111991 },
    ...overrides,
  };
}

function row(comparison: ReturnType<typeof compareRetrievalEval>, name: string) {
  const found = comparison.rows.find((entry) => entry.name === name);
  if (!found) throw new Error(`missing row: ${name}`);
  return found;
}

describe("compareRetrievalEval", () => {
  it("reports content_mrr_at_10 and content_mrr_case_count deltas", () => {
    const comparison = compareRetrievalEval(
      summary({ content_mrr_at_10: 0.9, content_mrr_case_count: 12 }),
      summary({ content_mrr_at_10: 0.95, content_mrr_case_count: 12 }),
    );
    expect(comparison.missingRequired).toEqual([]);

    const passageMrr = row(comparison, "content_mrr_at_10");
    expect(passageMrr.baseline).toEqual({ present: true, value: 0.9 });
    expect(passageMrr.candidate).toEqual({ present: true, value: 0.95 });

    const passageCases = row(comparison, "content_mrr_case_count");
    expect(passageCases.candidate).toEqual({ present: true, value: 12 });
  });

  it("flags a missing required metric instead of coercing it to zero", () => {
    const candidate = summary();
    delete candidate.content_mrr_at_10;
    const comparison = compareRetrievalEval(summary(), candidate);

    expect(comparison.missingRequired).toContain("candidate.content_mrr_at_10");
    // The row is still emitted, but the candidate is marked absent rather than a misleading 0.
    expect(row(comparison, "content_mrr_at_10").candidate).toEqual({ present: false, value: 0 });
  });

  it("also fails closed when a core retrieval metric is missing on the baseline", () => {
    const baseline = summary();
    delete baseline.content_recall_at_5;
    const comparison = compareRetrievalEval(baseline, summary());
    expect(comparison.missingRequired).toContain("baseline.content_recall_at_5");
  });

  it("keeps optional context metrics best-effort when absent", () => {
    const withoutOptional = summary();
    delete withoutOptional.mrr_at_10;
    delete withoutOptional.p90_latency_ms;
    delete withoutOptional.retrieval_layer_counts;
    const comparison = compareRetrievalEval(withoutOptional, withoutOptional);

    // Optional metrics never contribute to missingRequired.
    expect(comparison.missingRequired).toEqual([]);
    expect(row(comparison, "mrr_at_10").baseline.present).toBe(false);
    expect(row(comparison, "p90_latency_ms").candidate.present).toBe(false);
    expect(row(comparison, "index_units_layer_count").baseline.present).toBe(false);
  });
});

// Per-case results as written by eval-retrieval's --json-out (trimmed to the compared fields).
function perCase(id: string, rr: number, contentRR: number): Record<string, unknown> {
  return { id, reciprocalRankAt10: rr, contentReciprocalRankAt10: contentRR };
}

describe("comparePerCaseRanks", () => {
  it("reports zero regressions for an identical pair", () => {
    const results = [perCase("a", 1, 1), perCase("b", 0.33, 0.5)];
    const comparison = comparePerCaseRanks(results, results);
    expect(comparison.regressions).toEqual([]);
    expect(comparison.comparedCaseCount).toBe(2);
    expect(comparison.missingInCandidate).toEqual([]);
    expect(comparison.missingInBaseline).toEqual([]);
  });

  it("flags any per-case rr drop even when the case would still pass its top-5 gate", () => {
    const comparison = comparePerCaseRanks([perCase("patient-property", 1, 1)], [perCase("patient-property", 0.11, 1)]);
    expect(comparison.regressions).toEqual([
      { caseId: "patient-property", metric: "reciprocalRankAt10", baseline: 1, candidate: 0.11 },
    ]);
  });

  it("tracks doc-level and content-level rank drops independently", () => {
    const comparison = comparePerCaseRanks([perCase("a", 0.5, 1)], [perCase("a", 0.5, 0.33)]);
    expect(comparison.regressions).toEqual([
      { caseId: "a", metric: "contentReciprocalRankAt10", baseline: 1, candidate: 0.33 },
    ]);
  });

  it("does not count an improvement as a regression", () => {
    const comparison = comparePerCaseRanks([perCase("a", 0.33, 0.5)], [perCase("a", 1, 1)]);
    expect(comparison.regressions).toEqual([]);
  });

  it("surfaces non-identical case sets so callers can fail closed", () => {
    const comparison = comparePerCaseRanks(
      [perCase("kept", 1, 1), perCase("dropped", 1, 1)],
      [perCase("kept", 1, 1), perCase("added", 1, 1)],
    );
    expect(comparison.missingInCandidate).toEqual(["dropped"]);
    expect(comparison.missingInBaseline).toEqual(["added"]);
    expect(comparison.comparedCaseCount).toBe(1);
  });

  it("surfaces candidate-only cases even when every shared case is clean", () => {
    // Review finding (PR #1843): candidate-only cases must not slip past the identical-
    // case-set gate just because nothing regressed among the shared cases.
    const comparison = comparePerCaseRanks(
      [perCase("shared", 1, 1)],
      [perCase("shared", 1, 1), perCase("extra", 1, 1)],
    );
    expect(comparison.regressions).toEqual([]);
    expect(comparison.missingInBaseline).toEqual(["extra"]);
  });

  it("records an absent or non-finite rank metric as unavailable instead of skipping it", () => {
    const baseline = [perCase("a", 1, 1)];
    const candidate = [{ id: "a", reciprocalRankAt10: Number.NaN } as Record<string, unknown>];
    const comparison = comparePerCaseRanks(baseline, candidate);
    expect(comparison.regressions).toEqual([]);
    expect(comparison.unavailableMetrics).toEqual([
      { caseId: "a", metric: "reciprocalRankAt10" },
      { caseId: "a", metric: "contentReciprocalRankAt10" },
    ]);
  });

  it("reports no unavailable metrics for a complete pair", () => {
    const results = [perCase("a", 1, 1)];
    expect(comparePerCaseRanks(results, results).unavailableMetrics).toEqual([]);
  });
});

// CLI-level exit-code contract for --fail-on-regression: the pure-function tests above prove
// the classification, these prove main() actually turns each non-comparable shape into a
// non-zero exit (review finding on PR #1843 — the candidate-only shape previously exited 0).
describe("compare-retrieval-eval CLI --fail-on-regression", () => {
  const dir = mkdtempSync(join(tmpdir(), "compare-eval-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

  const summary = {
    case_count: 1,
    document_recall_at_5: 1,
    content_recall_at_5: 1,
    top_k_hit_rate: 1,
    content_mrr_at_10: 1,
    content_mrr_case_count: 1,
    failed_cases: [],
  };

  function writeArtifact(name: string, results: Array<Record<string, unknown>>): string {
    const filePath = join(dir, name);
    writeFileSync(filePath, JSON.stringify({ summary, results }));
    return filePath;
  }

  function runCli(baseline: string, candidate: string) {
    return spawnSync(
      process.execPath,
      ["scripts/run-tsx.mjs", "scripts/compare-retrieval-eval.ts", baseline, candidate, "--fail-on-regression"],
      { cwd: join(__dirname, ".."), encoding: "utf8" },
    );
  }

  it("exits 0 for an identical clean pair", () => {
    const baseline = writeArtifact("clean-base.json", [perCase("a", 1, 1)]);
    const candidate = writeArtifact("clean-cand.json", [perCase("a", 1, 1)]);
    const out = runCli(baseline, candidate);
    expect(out.stdout).toContain("zero per-case rr regressions");
    expect(out.status).toBe(0);
  });

  it("exits non-zero when the candidate carries a case the baseline lacks", () => {
    const baseline = writeArtifact("subset-base.json", [perCase("a", 1, 1)]);
    const candidate = writeArtifact("superset-cand.json", [perCase("a", 1, 1), perCase("extra", 1, 1)]);
    const out = runCli(baseline, candidate);
    expect(out.stdout).toContain("NEW in candidate (no baseline): extra");
    expect(out.status).toBe(1);
  });
});

describe("recallFailures", () => {
  it("passes a pair that holds recall at 1.0", () => {
    expect(recallFailures(compareRetrievalEval(summary(), summary()).rows)).toEqual([]);
  });

  it("fails a candidate below the pinned 1.0 even when the baseline was lower", () => {
    const rows = compareRetrievalEval(
      summary({ document_recall_at_5: 0.9 }),
      summary({ document_recall_at_5: 0.95 }),
    ).rows;
    expect(recallFailures(rows)).toEqual(["document_recall_at_5 is 0.9500, below the pinned 1.0"]);
  });

  it("fails a content recall drop", () => {
    const rows = compareRetrievalEval(summary(), summary({ content_recall_at_5: 0.9583 })).rows;
    expect(recallFailures(rows)).toHaveLength(1);
    expect(recallFailures(rows)[0]).toContain("content_recall_at_5");
  });
});
