export type EvalCaseStatus = "PASS" | "FAIL";

export type EvalCaseResult = {
  id: string;
  status: EvalCaseStatus;
  latencyMs?: number;
  failures?: string[];
  domain?: "answer" | "retrieval" | "quality";
};

export type CanaryDomainSummary = {
  case_count: number;
  passed_count?: number;
  failed_count?: number;
  failed_cases?: Array<{ id: string; failures?: string[]; latencyMs?: number }>;
  passed_cases?: Array<{ id: string; latencyMs?: number }>;
  cases?: EvalCaseResult[];
};

export type CanaryEvalReport = {
  runId?: string;
  timestamp?: string;
  overallPassed?: boolean;
  rag?: {
    summary?: CanaryDomainSummary;
    cases?: EvalCaseResult[];
  };
  retrieval?: {
    summary?: CanaryDomainSummary;
    cases?: EvalCaseResult[];
  };
  cases?: EvalCaseResult[];
};

/**
 * Formats a single eval case line with status, latency, and failure details.
 */
export function formatCaseLine(item: EvalCaseResult): string {
  const statusTag = item.status === "PASS" ? "[PASS]" : "[FAIL]";
  const latencyPart = item.latencyMs !== undefined ? ` (${item.latencyMs}ms)` : "";
  const failuresPart =
    item.status === "FAIL" && item.failures && item.failures.length > 0 ? `: ${item.failures.join("; ")}` : "";

  return `- ${statusTag} \`${item.id}\`${latencyPart}${failuresPart}`;
}

/**
 * Formats an array of case results into a markdown list breakdown.
 */
export function formatCaseBreakdown(cases: EvalCaseResult[]): string[] {
  if (cases.length === 0) {
    return ["No individual cases recorded."];
  }
  return cases.map(formatCaseLine);
}

/**
 * Extracts normalized EvalCaseResults from a domain summary.
 */
export function extractDomainCases(summary?: CanaryDomainSummary): EvalCaseResult[] {
  if (!summary) return [];

  if (summary.cases && summary.cases.length > 0) {
    return summary.cases;
  }

  const results: EvalCaseResult[] = [];

  const passed = summary.passed_cases ?? [];
  for (const item of passed) {
    results.push({
      id: item.id,
      status: "PASS",
      latencyMs: item.latencyMs,
    });
  }

  const failed = summary.failed_cases ?? [];
  for (const item of failed) {
    results.push({
      id: item.id,
      status: "FAIL",
      latencyMs: item.latencyMs,
      failures: item.failures,
    });
  }

  // Count-only summary (no case arrays): synthesise one entry per counted case so the report reads
  // e.g. 4/5, not 0/0. Without explicit counts, every counted case is unknown and reads as failed,
  // never as passed.
  if (passed.length === 0 && failed.length === 0 && summary.case_count > 0) {
    const failedCount = Math.max(0, summary.failed_count ?? summary.case_count - (summary.passed_count ?? 0));
    const passedCount = Math.max(0, Math.min(summary.passed_count ?? 0, summary.case_count - failedCount));
    for (let index = 0; index < passedCount; index += 1) {
      results.push({ id: `case-${index + 1}`, status: "PASS" });
    }
    for (let index = 0; index < failedCount; index += 1) {
      results.push({ id: `case-${passedCount + index + 1}`, status: "FAIL" });
    }
  }

  return results;
}

/**
 * Calculates summary metrics across a collection of cases.
 */
export function calculateCaseMetrics(cases: EvalCaseResult[]) {
  const total = cases.length;
  const passed = cases.filter((c) => c.status === "PASS").length;
  const failed = cases.filter((c) => c.status === "FAIL").length;

  const latencies = cases
    .map((c) => c.latencyMs)
    .filter((ms): ms is number => typeof ms === "number" && Number.isFinite(ms))
    .sort((a, b) => a - b);

  const avgLatencyMs =
    latencies.length > 0 ? Math.round(latencies.reduce((sum, val) => sum + val, 0) / latencies.length) : null;

  const p95Index = Math.floor(latencies.length * 0.95);
  const p95LatencyMs = latencies.length > 0 ? latencies[Math.min(p95Index, latencies.length - 1)] : null;

  return {
    total,
    passed,
    failed,
    avgLatencyMs,
    p95LatencyMs,
  };
}

/**
 * Renders the full case-by-case canary breakdown report.
 */
export function renderCanaryReleaseReport(report: CanaryEvalReport | null | undefined): string {
  const lines: string[] = ["## Eval Canary: Case-by-Case Breakdown", ""];

  if (!report) {
    lines.push("No canary evaluation report available to display.");
    return lines.join("\n") + "\n";
  }

  const ragCases = report.rag?.cases ?? extractDomainCases(report.rag?.summary);
  const retrievalCases = report.retrieval?.cases ?? extractDomainCases(report.retrieval?.summary);
  const directCases = report.cases ?? [];

  const allCases = [...directCases, ...ragCases, ...retrievalCases];
  const metrics = calculateCaseMetrics(allCases);

  lines.push(`Overall Summary: ${metrics.passed}/${metrics.total} passed (${metrics.failed} failed).`);
  if (metrics.avgLatencyMs !== null) {
    lines.push(
      `Latency: avg ${metrics.avgLatencyMs}ms${metrics.p95LatencyMs !== null ? `, p95 ${metrics.p95LatencyMs}ms` : ""}.`,
    );
  }
  lines.push("");

  if (ragCases.length > 0) {
    const ragMetrics = calculateCaseMetrics(ragCases);
    lines.push(`### Answer Quality Cases (${ragMetrics.passed}/${ragMetrics.total} passed)`);
    lines.push("");
    lines.push(...formatCaseBreakdown(ragCases));
    lines.push("");
  }

  if (retrievalCases.length > 0) {
    const retMetrics = calculateCaseMetrics(retrievalCases);
    lines.push(`### Retrieval Cases (${retMetrics.passed}/${retMetrics.total} passed)`);
    lines.push("");
    lines.push(...formatCaseBreakdown(retrievalCases));
    lines.push("");
  }

  if (directCases.length > 0 && ragCases.length === 0 && retrievalCases.length === 0) {
    lines.push("### Evaluation Cases");
    lines.push("");
    lines.push(...formatCaseBreakdown(directCases));
    lines.push("");
  }

  return lines.join("\n") + "\n";
}

function main() {
  console.log("Eval reporter loaded.");
}

if (process.argv[1]?.endsWith("eval-reporter.ts")) {
  main();
}
