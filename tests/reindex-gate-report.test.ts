import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildReindexGateReport, runReindexGateReport } from "../scripts/reindex-gate-report";

function bundle() {
  const retrieval = {
    case_count: 3,
    failed_case_count: 0,
    document_recall_at_5: 1,
    content_recall_at_5: 1,
    top_k_hit_rate: 1,
    content_mrr_at_10: 1,
    content_mrr_case_count: 3,
  };
  const quality = {
    case_count: 3,
    grounded_supported_rate: 1,
    unsupported_count: 1,
    unsupported_correct_rate: 1,
    citation_failure_rate: 0,
    numeric_grounding_failure_rate: 0,
    source_governance_danger_failure_rate: 0,
    expected_danger_warning_missing_count: 0,
    stale_review_unknown_rate: 0,
    review_required_rate: 0,
    p95_latency_ms: 100,
  };
  return {
    baselineRetrieval: { ...retrieval },
    candidateRetrieval: { ...retrieval },
    baselineQuality: { ...quality },
    candidateQuality: { ...quality },
  };
}

describe("offline reindex gate report", () => {
  it("reports a passing metric comparison without authorizing activation", () => {
    expect(buildReindexGateReport(bundle())).toMatchObject({
      decision: "GO",
      mode: "offline_advisory",
      activationAuthorized: false,
    });
  });

  it("refuses retrieval-only input, unknown operational fields, and malformed summaries", () => {
    const value = bundle();
    expect(() => buildReindexGateReport({ ...value, candidateQuality: undefined })).toThrow(/four complete/);
    expect(() => buildReindexGateReport({ ...value, apply: true })).toThrow(/four complete/);
    expect(() => buildReindexGateReport({ ...value, candidateRetrieval: [] })).toThrow(/four complete/);
  });

  it("does not hide empty evaluations behind otherwise passing rates", () => {
    const value = bundle();
    value.baselineRetrieval.case_count = value.candidateRetrieval.case_count = 0;
    value.baselineRetrieval.content_mrr_case_count = value.candidateRetrieval.content_mrr_case_count = 0;
    expect(buildReindexGateReport(value).decision).toBe("NO_GO");
  });

  it("rejects execution flags before opening any file", async () => {
    await expect(runReindexGateReport(["--input", "does-not-exist", "--apply"])).rejects.toThrow(/Usage/);
    await expect(runReindexGateReport(["--live-read"])).rejects.toThrow(/Usage/);
  });

  it("returns a failure status for a regression and bounds local input", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "reindex-gate-"));
    const file = path.join(directory, "summary.json");
    const stdout = vi.fn();
    try {
      const value = bundle();
      value.candidateQuality.citation_failure_rate = 0.5;
      await writeFile(file, JSON.stringify(value));
      expect(await runReindexGateReport(["--input", file], stdout)).toBe(1);
      expect(JSON.parse(stdout.mock.calls[0][0])).toMatchObject({ decision: "NO_GO", activationAuthorized: false });
      await writeFile(file, "x".repeat(65_537));
      await expect(runReindexGateReport(["--input", file], stdout)).rejects.toThrow(/64 KiB/);
      await writeFile(file, "{private input");
      await expect(runReindexGateReport(["--input", file], stdout)).rejects.toThrow(
        /^Comparison input must be valid UTF-8 JSON\.$/,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
