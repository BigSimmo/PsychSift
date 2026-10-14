import { describe, expect, it } from "vitest";

import {
  calculateCaseMetrics,
  formatCaseLine,
  renderCanaryReleaseReport,
  type CanaryEvalReport,
  type EvalCaseResult,
} from "../scripts/eval-reporter";

describe("eval-reporter", () => {
  it("formats individual passing cases with latency", () => {
    const item: EvalCaseResult = {
      id: "lithium-monitoring",
      status: "PASS",
      latencyMs: 1250,
    };
    const line = formatCaseLine(item);
    expect(line).toBe("- [PASS] `lithium-monitoring` (1250ms)");
  });

  it("formats individual failing cases with latency and reasons", () => {
    const item: EvalCaseResult = {
      id: "clozapine-anc-withhold",
      status: "FAIL",
      latencyMs: 3400,
      failures: ["expected numeric threshold 1.5, got 1.0", "citation count below minimum"],
    };
    const line = formatCaseLine(item);
    expect(line).toContain("[FAIL] `clozapine-anc-withhold` (3400ms)");
    expect(line).toContain("expected numeric threshold 1.5, got 1.0; citation count below minimum");
  });

  it("calculates summary metrics accurately", () => {
    const cases: EvalCaseResult[] = [
      { id: "c1", status: "PASS", latencyMs: 100 },
      { id: "c2", status: "PASS", latencyMs: 200 },
      { id: "c3", status: "FAIL", latencyMs: 300, failures: ["error"] },
      { id: "c4", status: "PASS", latencyMs: 400 },
    ];
    const metrics = calculateCaseMetrics(cases);
    expect(metrics.total).toBe(4);
    expect(metrics.passed).toBe(3);
    expect(metrics.failed).toBe(1);
    expect(metrics.avgLatencyMs).toBe(250);
    expect(metrics.p95LatencyMs).toBe(400);
  });

  it("renders a full case-by-case report for answer and retrieval domains", () => {
    const report: CanaryEvalReport = {
      runId: "run-12345",
      rag: {
        summary: {
          case_count: 2,
          passed_cases: [{ id: "case-pass-1", latencyMs: 800 }],
          failed_cases: [{ id: "case-fail-1", latencyMs: 2500, failures: ["unsupported claim"] }],
        },
      },
      retrieval: {
        summary: {
          case_count: 1,
          passed_cases: [{ id: "retrieval-pass-1", latencyMs: 450 }],
        },
      },
    };

    const text = renderCanaryReleaseReport(report);
    expect(text).toContain("## Eval Canary: Case-by-Case Breakdown");
    expect(text).toContain("Overall Summary: 2/3 passed (1 failed)");
    expect(text).toContain("### Answer Quality Cases (1/2 passed)");
    expect(text).toContain("- [PASS] `case-pass-1` (800ms)");
    expect(text).toContain("- [FAIL] `case-fail-1` (2500ms): unsupported claim");
    expect(text).toContain("### Retrieval Cases (1/1 passed)");
    expect(text).toContain("- [PASS] `retrieval-pass-1` (450ms)");
  });

  it("handles null or missing report safely", () => {
    const text = renderCanaryReleaseReport(null);
    expect(text).toContain("No canary evaluation report available to display.");
  });
});
