import { readFileSync } from "node:fs";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

type EvalSummary = Record<string, unknown>;

type EvalPayload = {
  summary?: EvalSummary;
  results?: unknown[];
};

type MetricKind = "number" | "array" | "layer";

type MetricSpec = {
  name: string;
  // Summary field to read, or the layer name when kind is "layer".
  field: string;
  kind: MetricKind;
  // Required metrics feed the re-index gate; a missing value must fail closed rather than read
  // as 0. Optional/context metrics are mode-dependent (latency, force-embedding, layer coverage)
  // or superseded by content_mrr_at_10 (doc-level mrr_at_10) — absent is reported as n/a.
  required: boolean;
  digits: number;
};

const METRIC_SPECS: MetricSpec[] = [
  { name: "case_count", field: "case_count", kind: "number", required: true, digits: 0 },
  { name: "document_recall_at_5", field: "document_recall_at_5", kind: "number", required: true, digits: 4 },
  { name: "content_recall_at_5", field: "content_recall_at_5", kind: "number", required: true, digits: 4 },
  { name: "top_k_hit_rate", field: "top_k_hit_rate", kind: "number", required: true, digits: 4 },
  // Passage rank is the decisive retrieval metric; its case count guards the population it is
  // averaged over. Both are required so a missing value is surfaced, not silently zeroed.
  { name: "content_mrr_at_10", field: "content_mrr_at_10", kind: "number", required: true, digits: 4 },
  { name: "content_mrr_case_count", field: "content_mrr_case_count", kind: "number", required: true, digits: 0 },
  { name: "failed_cases", field: "failed_cases", kind: "array", required: true, digits: 0 },
  { name: "mrr_at_10", field: "mrr_at_10", kind: "number", required: false, digits: 4 },
  { name: "median_latency_ms", field: "median_latency_ms", kind: "number", required: false, digits: 0 },
  { name: "p90_latency_ms", field: "p90_latency_ms", kind: "number", required: false, digits: 0 },
  {
    name: "force_embedding_failure_count",
    field: "force_embedding_failure_count",
    kind: "number",
    required: false,
    digits: 0,
  },
  { name: "latency_failed_cases", field: "latency_failed_cases", kind: "array", required: false, digits: 0 },
  { name: "index_units_layer_count", field: "index_units", kind: "layer", required: false, digits: 0 },
  { name: "ndcg_at_10", field: "ndcg_at_10", kind: "number", required: false, digits: 4 },
  {
    name: "irrelevant_source_rate_at_10",
    field: "irrelevant_source_rate_at_10",
    kind: "number",
    required: false,
    digits: 4,
  },
  {
    name: "required_signal_coverage_at_10",
    field: "required_signal_coverage_at_10",
    kind: "number",
    required: false,
    digits: 4,
  },
];

type MetricValue = { present: boolean; value: number };

function readNumber(summary: EvalSummary, key: string): MetricValue {
  const value = summary[key];
  return typeof value === "number" && Number.isFinite(value) ? { present: true, value } : { present: false, value: 0 };
}

function readArrayLength(summary: EvalSummary, key: string): MetricValue {
  const value = summary[key];
  return Array.isArray(value) ? { present: true, value: value.length } : { present: false, value: 0 };
}

function readLayer(summary: EvalSummary, layer: string): MetricValue {
  const counts = summary.retrieval_layer_counts;
  if (!counts || typeof counts !== "object") return { present: false, value: 0 };
  const value = (counts as Record<string, unknown>)[layer];
  return typeof value === "number" && Number.isFinite(value) ? { present: true, value } : { present: false, value: 0 };
}

function readMetric(summary: EvalSummary, spec: MetricSpec): MetricValue {
  switch (spec.kind) {
    case "array":
      return readArrayLength(summary, spec.field);
    case "layer":
      return readLayer(summary, spec.field);
    default:
      return readNumber(summary, spec.field);
  }
}

export type ComparisonRow = {
  name: string;
  baseline: MetricValue;
  candidate: MetricValue;
  digits: number;
};

export type RetrievalEvalComparison = {
  rows: ComparisonRow[];
  missingRequired: string[];
};

export type PerCaseRankRegression = {
  caseId: string;
  metric: "reciprocalRankAt10" | "contentReciprocalRankAt10";
  baseline: number;
  candidate: number;
};

export type PerCaseRankComparison = {
  regressions: PerCaseRankRegression[];
  // Case IDs present in one artifact but not the other. A vanished case is not a "no
  // regression" — the pair is not comparable case-for-case, so callers must fail closed.
  missingInCandidate: string[];
  missingInBaseline: string[];
  // Shared cases where a rank metric is absent or non-finite on either side. Skipping the
  // metric would report "zero regressions" without evidence for it, so these also make the
  // pair non-comparable.
  unavailableMetrics: Array<{ caseId: string; metric: (typeof PER_CASE_RANK_METRICS)[number] }>;
  invalidCases: string[];
  contentPopulationChanges: string[];
  comparedCaseCount: number;
};

const PER_CASE_RANK_METRICS = ["reciprocalRankAt10", "contentReciprocalRankAt10"] as const;

type PerCaseResult = Record<string, unknown>;

function indexCases(results: unknown[], side: string, invalidCases: string[]): Map<string, PerCaseResult> {
  const byId = new Map<string, PerCaseResult>();
  if (results.length === 0) invalidCases.push(`${side}.results must contain at least one case`);
  for (const [index, result] of results.entries()) {
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      invalidCases.push(`${side}.results[${index}] must be a case object`);
      continue;
    }
    const entry = result as PerCaseResult;
    if (typeof entry.id !== "string" || entry.id.trim().length === 0) {
      invalidCases.push(`${side}.results[${index}] must have a nonempty case ID`);
      continue;
    }
    if (byId.has(entry.id)) {
      invalidCases.push(`${side}.results has duplicate case ID: ${entry.id}`);
      continue;
    }
    byId.set(entry.id, entry);
  }
  return byId;
}

function readCaseRank(result: PerCaseResult, key: string): number | undefined {
  const value = result[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

// The safeguards protocol's "zero per-case rr regressions" gate (docs/rag-behaviour/
// safeguards.md, canary-pair step 3), mechanized: any per-case drop in doc-level rr@10 or
// content rr@10 between the baseline and post artifacts is a regression, even when the
// case still passes its top-5 recall gate (rank depth can silently erode otherwise).
export function comparePerCaseRanks(baselineResults: unknown[], candidateResults: unknown[]): PerCaseRankComparison {
  const invalidCases: string[] = [];
  const baselineById = indexCases(baselineResults, "baseline", invalidCases);
  const candidateById = indexCases(candidateResults, "candidate", invalidCases);
  const regressions: PerCaseRankRegression[] = [];
  const missingInCandidate: string[] = [];
  const unavailableMetrics: PerCaseRankComparison["unavailableMetrics"] = [];
  const contentPopulationChanges: string[] = [];
  let comparedCaseCount = 0;
  for (const [caseId, baselineResult] of baselineById) {
    const candidateResult = candidateById.get(caseId);
    if (!candidateResult) {
      missingInCandidate.push(caseId);
      continue;
    }
    comparedCaseCount += 1;
    if (
      Array.isArray(baselineResult.expectedContentTerms) &&
      Array.isArray(candidateResult.expectedContentTerms) &&
      baselineResult.expectedContentTerms.length > 0 !== candidateResult.expectedContentTerms.length > 0
    ) {
      contentPopulationChanges.push(caseId);
    }
    for (const metric of PER_CASE_RANK_METRICS) {
      const baselineRank = readCaseRank(baselineResult, metric);
      const candidateRank = readCaseRank(candidateResult, metric);
      if (baselineRank === undefined || candidateRank === undefined) {
        unavailableMetrics.push({ caseId, metric });
        continue;
      }
      if (candidateRank < baselineRank) {
        regressions.push({ caseId, metric, baseline: baselineRank, candidate: candidateRank });
      }
    }
  }
  const missingInBaseline = [...candidateById.keys()].filter((id) => !baselineById.has(id));
  return {
    regressions,
    missingInCandidate,
    missingInBaseline,
    unavailableMetrics,
    invalidCases,
    contentPopulationChanges,
    comparedCaseCount,
  };
}

// A rank delta alone cannot establish the canary's absolute recall/quality gates or prove
// that the summary denominators describe the supplied cases. Keep these release checks
// separate from the report-only summary comparison.
function canaryArtifactFailures(payload: EvalPayload, side: string): string[] {
  const failures: string[] = [];
  const summary = payload.summary ?? {};
  for (const metric of ["document_recall_at_5", "content_recall_at_5", "top_k_hit_rate"]) {
    if (summary[metric] !== 1) failures.push(`${side}.${metric} must equal 1.0`);
  }
  if (!Array.isArray(summary.failed_cases) || summary.failed_cases.length > 0) {
    failures.push(`${side}.failed_cases must be an empty array`);
  }
  const results = payload.results;
  if (!Array.isArray(results)) return failures; // The per-case gate reports absent results.
  const caseCount = summary.case_count;
  if (!Number.isInteger(caseCount) || (caseCount as number) <= 0 || caseCount !== results.length) {
    failures.push(`${side}.case_count must be a positive integer matching results.length (${results.length})`);
  }
  const contentCount = summary.content_mrr_case_count;
  if (!Number.isInteger(contentCount) || (contentCount as number) < 0 || (contentCount as number) > results.length) {
    failures.push(`${side}.content_mrr_case_count must be an integer between 0 and results.length`);
  }
  let declaredContentCount = 0;
  for (const [index, result] of results.entries()) {
    if (!result || typeof result !== "object" || Array.isArray(result)) continue;
    const entry = result as PerCaseResult;
    if (!Array.isArray(entry.expectedContentTerms)) {
      failures.push(`${side}.results[${index}].expectedContentTerms is required to verify content_mrr_case_count`);
    } else if (entry.expectedContentTerms.length > 0) {
      declaredContentCount += 1;
    }
    if (!Array.isArray(entry.failures) || entry.failures.length > 0) {
      failures.push(`${side}.results[${index}].failures must be an empty array`);
    }
  }
  if (contentCount !== declaredContentCount) {
    failures.push(
      `${side}.content_mrr_case_count must match cases declaring expectedContentTerms (${declaredContentCount})`,
    );
  }
  return failures;
}

// Pure so it can be unit-tested without touching the filesystem or process exit code.
export function compareRetrievalEval(baseline: EvalSummary, candidate: EvalSummary): RetrievalEvalComparison {
  const rows: ComparisonRow[] = [];
  const missingRequired: string[] = [];
  for (const spec of METRIC_SPECS) {
    const baselineValue = readMetric(baseline, spec);
    const candidateValue = readMetric(candidate, spec);
    if (spec.required) {
      if (!baselineValue.present) missingRequired.push(`baseline.${spec.name}`);
      if (!candidateValue.present) missingRequired.push(`candidate.${spec.name}`);
    }
    rows.push({ name: spec.name, baseline: baselineValue, candidate: candidateValue, digits: spec.digits });
  }
  return { rows, missingRequired };
}

const PINNED_RECALL_METRICS = new Set(["document_recall_at_5", "content_recall_at_5"]);

/**
 * Recall rows that fail the canary-pair protocol: doc and content recall are pinned at 1.0, so a
 * candidate below 1.0, or below its baseline, is a regression even when every per-case rank holds.
 */
export function recallFailures(rows: readonly ComparisonRow[]): string[] {
  const failures: string[] = [];
  for (const row of rows) {
    if (!PINNED_RECALL_METRICS.has(row.name) || !row.candidate.present) continue;
    const candidate = row.candidate.value;
    if (candidate < 1) failures.push(`${row.name} is ${candidate.toFixed(row.digits)}, below the pinned 1.0`);
    else if (row.baseline.present && candidate < row.baseline.value)
      failures.push(
        `${row.name} fell from ${row.baseline.value.toFixed(row.digits)} to ${candidate.toFixed(row.digits)}`,
      );
  }
  return failures;
}

function formatCell(row: ComparisonRow): string {
  if (!row.baseline.present || !row.candidate.present) {
    const candidate = row.candidate.present ? row.candidate.value.toFixed(row.digits) : "n/a";
    const baseline = row.baseline.present ? row.baseline.value.toFixed(row.digits) : "n/a";
    return `${candidate} (baseline ${baseline})`;
  }
  const delta = row.candidate.value - row.baseline.value;
  const sign = delta > 0 ? "+" : "";
  return `${row.candidate.value.toFixed(row.digits)} (${sign}${delta.toFixed(row.digits)})`;
}

function readPayload(path: string): EvalPayload {
  return JSON.parse(readFileSync(path, "utf8")) as EvalPayload;
}

function main() {
  const positional = process.argv.slice(2).filter((arg) => arg !== "--fail-on-regression");
  const failOnRegression = process.argv.includes("--fail-on-regression");
  const [baselinePath, candidatePath] = positional;
  if (!baselinePath || !candidatePath) {
    throw new Error(
      "Usage: tsx scripts/compare-retrieval-eval.ts <baseline.json> <candidate.json> [--fail-on-regression]",
    );
  }

  const baselinePayload = readPayload(baselinePath);
  const candidatePayload = readPayload(candidatePath);
  const { rows, missingRequired } = compareRetrievalEval(baselinePayload.summary ?? {}, candidatePayload.summary ?? {});

  console.log("Retrieval eval comparison: candidate (delta from baseline)");
  for (const row of rows) {
    console.log(`  ${row.name}: ${formatCell(row)}`);
  }

  const recallDrops = recallFailures(rows);
  if (failOnRegression && recallDrops.length > 0) {
    console.error(`\nRecall gate failed: ${recallDrops.join("; ")}.`);
    process.exitCode = 1;
  }

  if (missingRequired.length > 0) {
    console.error(`\nMissing required metric(s), refusing a clean comparison: ${missingRequired.join(", ")}`);
    console.error("A missing decision metric is not the same as 0 — regenerate the eval JSON with the full summary.");
    process.exitCode = 1;
  }

  if (failOnRegression) {
    const failures = [
      ...canaryArtifactFailures(baselinePayload, "baseline"),
      ...canaryArtifactFailures(candidatePayload, "candidate"),
    ];
    if (failures.length > 0) {
      console.error(`\nCanary quality/population gate failed:\n  ${failures.join("\n  ")}`);
      process.exitCode = 1;
    }
  }

  const baselineResults = baselinePayload.results;
  const candidateResults = candidatePayload.results;
  if (Array.isArray(baselineResults) && Array.isArray(candidateResults)) {
    const perCase = comparePerCaseRanks(baselineResults, candidateResults);
    console.log(`\nPer-case rank comparison over ${perCase.comparedCaseCount} shared case(s):`);
    if (perCase.regressions.length === 0) {
      console.log("  zero per-case rr regressions");
    }
    for (const regression of perCase.regressions) {
      console.log(
        `  REGRESSION ${regression.caseId} ${regression.metric}: ${regression.baseline.toFixed(4)} -> ${regression.candidate.toFixed(4)}`,
      );
    }
    for (const id of perCase.missingInCandidate) console.log(`  MISSING in candidate: ${id}`);
    for (const id of perCase.missingInBaseline) console.log(`  NEW in candidate (no baseline): ${id}`);
    for (const entry of perCase.unavailableMetrics) {
      console.log(`  METRIC UNAVAILABLE ${entry.caseId} ${entry.metric}: absent or non-finite on one side`);
    }
    for (const issue of perCase.invalidCases) console.log(`  INVALID CASES: ${issue}`);
    for (const id of perCase.contentPopulationChanges) console.log(`  CONTENT MRR POPULATION CHANGED: ${id}`);
    // Any difference in the case sets — either direction — or an unavailable metric means the
    // pair cannot prove the identical-case-set gate; fail closed rather than report a pass.
    const notComparable =
      perCase.missingInCandidate.length > 0 ||
      perCase.missingInBaseline.length > 0 ||
      perCase.unavailableMetrics.length > 0 ||
      perCase.invalidCases.length > 0 ||
      perCase.contentPopulationChanges.length > 0;
    if (failOnRegression && (perCase.regressions.length > 0 || notComparable)) {
      console.error(
        "\nPer-case gate failed: the canary-pair protocol (docs/rag-behaviour/safeguards.md) requires zero per-case rr regressions over an identical nonempty set of unique cases with both rank metrics present and a consistent content-MRR population.",
      );
      process.exitCode = 1;
    }
  } else if (failOnRegression) {
    // Summary-only artifacts cannot prove the per-case gate — fail closed rather than
    // reporting a green pair without the evidence.
    console.error(
      "\n--fail-on-regression requires per-case results in both artifacts (re-run the eval with --json-out).",
    );
    process.exitCode = 1;
  }
}

if (isDirectEntrypoint(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
