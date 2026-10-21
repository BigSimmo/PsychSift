/**
 * eval-canary-trend — one small, durable row per eval-canary run (audit EVAL-06, 2026-10-20).
 *
 * The canary's `eval-canary-output` artifact expires after 30 days, and nothing kept the
 * run-over-run trend: the newest result recorded anywhere in the repository was 4 Oct 2026. The
 * canary now posts one row per run, cancelled and timed-out runs included, as a comment on a
 * rolling "Eval canary trend" issue that is never closed, and repeats it in the job summary.
 * Nothing is committed from CI.
 *
 * A row holds aggregate numbers and case IDs only, never question, answer or source text: the
 * repository is public. It is not an alert, so it mentions nobody; failures alert through the
 * canary's own failure issue.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { latestQualityReport } from "../eval-canary-case-summary.mjs";

export const TREND_LABEL = "eval-canary-trend";
export const TREND_TITLE = "Eval canary trend";
export const TREND_ROW_MARKER = "<!-- eval-canary-trend-row:v1 -->";
export const TREND_ISSUE_BODY = [
  "One row per eval-canary run, posted as a comment by `.github/workflows/eval-canary.yml` (audit EVAL-06).",
  "The run's artifact expires after 30 days; these rows do not. Each row holds aggregate numbers and case",
  "IDs only, never question, answer or source text. Keep this issue open: the canary reuses it.",
  "",
  "The second line of each comment is the row as JSON, for reading the trend back with a script.",
].join("\n");

const CASE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const WORD = /^[a-z_]{1,32}$/;

function number(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function word(value) {
  const text = String(value ?? "");
  return WORD.test(text) ? text : "unknown";
}

function caseIds(failed) {
  if (!Array.isArray(failed)) return [];
  return failed
    .map((item) => (typeof item === "string" ? item : item?.id))
    .filter((id) => typeof id === "string" && CASE_ID.test(id))
    .sort();
}

function retrievalRow(golden) {
  const summary = golden?.summary;
  if (!summary || typeof summary !== "object") return null;
  return {
    cases: number(summary.case_count) ?? (Array.isArray(golden.results) ? golden.results.length : null),
    failed: caseIds(summary.failed_cases),
    doc_recall_at_5: number(summary.document_recall_at_5),
    content_recall_at_5: number(summary.content_recall_at_5),
    mrr_at_10: number(summary.mrr_at_10),
    content_mrr_at_10: number(summary.content_mrr_at_10),
    irrelevant_at_10: number(summary.irrelevant_source_rate_at_10),
    p90_ms: number(summary.p90_latency_ms),
  };
}

function answerRow(quality) {
  const summary = quality?.rag?.summary;
  if (!summary || typeof summary !== "object") return null;
  return {
    cases: number(summary.case_count),
    failed: caseIds(summary.failed_cases),
    grounded_supported_rate: number(summary.grounded_supported_rate),
    unsupported_correct_rate: number(summary.unsupported_correct_rate),
    expected_hit_rate: number(summary.expected_hit_rate),
    citation_failure_rate: number(summary.citation_failure_rate),
    estimated_cost_usd: number(summary.estimated_cost_usd),
  };
}

/**
 * The trend row for one run. `meta.jobStatus` is the job status when the row is written
 * (`success`, `failure` or `cancelled`; a timed-out job reads as cancelled), so a run that never
 * reached a verdict is recorded as such instead of disappearing.
 */
export function buildCanaryTrendRow({ golden, quality, meta = {} }) {
  const sha = String(meta.sha ?? "");
  return {
    v: 1,
    date: Number.isFinite(Date.parse(meta.date ?? "")) ? new Date(meta.date).toISOString() : null,
    run: /^\d+$/.test(String(meta.runId ?? "")) ? String(meta.runId) : null,
    attempt: /^\d+$/.test(String(meta.runAttempt ?? "")) ? String(meta.runAttempt) : null,
    trigger: word(meta.trigger),
    sha: /^[0-9a-f]{7,40}$/.test(sha) ? sha.slice(0, 12) : null,
    job: word(meta.jobStatus),
    steps: { golden: word(meta.goldenOutcome), answer: word(meta.answerOutcome) },
    retrieval: retrievalRow(golden),
    answer: answerRow(quality),
  };
}

function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/** Builds the row from the files the canary leaves in `.local/eval-canary/` (or `dir`). */
export function readCanaryTrendRow(dir, meta) {
  return buildCanaryTrendRow({
    golden: readJson(join(dir, "golden-retrieval.json")),
    quality: latestQualityReport(join(dir, "quality-reports")),
    meta,
  });
}

function halfLine(label, half, detail) {
  if (!half) return `${label} not recorded`;
  const failed = half.failed.length;
  return `${label} ${half.cases ?? "?"} cases, ${failed} failed${detail ? ` (${detail})` : ""}`;
}

/** The comment body: a marker, one readable line, and the row as one line of JSON. */
export function renderCanaryTrendComment(row, runUrl) {
  const trigger =
    row.trigger === "schedule" ? "scheduled" : row.trigger === "repository_dispatch" ? "dispatched" : row.trigger;
  const retrievalDetail = row.retrieval
    ? `doc recall ${row.retrieval.doc_recall_at_5 ?? "?"}, content recall ${row.retrieval.content_recall_at_5 ?? "?"}`
    : "";
  const readable = [
    (row.date ?? "unknown date").slice(0, 10),
    trigger,
    `job ${row.job}`,
    halfLine("retrieval", row.retrieval, retrievalDetail),
    halfLine("answers", row.answer, ""),
    String(runUrl ?? "").startsWith("https://") ? `[run](${runUrl})` : "run link unavailable",
  ].join(" · ");
  return [TREND_ROW_MARKER, readable, `\`${JSON.stringify(row)}\``].join("\n");
}
