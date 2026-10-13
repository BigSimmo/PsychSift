#!/usr/bin/env node
/**
 * eval-canary-case-summary — write every individually failing eval case to the job summary,
 * on every canary run, green or red (audit F24).
 *
 * An aggregate green run can still carry a failing case: #628 kept a residual case open through
 * a green canary, and the markdown report cut failed cases off at ten. The thresholds decide
 * whether the run is red; this report decides whether anyone can see which cases failed.
 */
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

/** The newest retrieval-quality-*.json that eval:quality wrote into `dir`, or null. */
export function latestQualityReport(dir) {
  if (!existsSync(dir)) return null;
  const newest = readdirSync(dir)
    .filter((name) => /^retrieval-quality-.*\.json$/.test(name))
    .sort()
    .at(-1);
  if (!newest) return null;
  try {
    return JSON.parse(readFileSync(join(dir, newest), "utf8"));
  } catch {
    return null;
  }
}

function section(label, summary) {
  const failed = Array.isArray(summary?.failed_cases) ? summary.failed_cases : [];
  const total = summary?.case_count ?? "?";
  if (!failed.length) return [`Every ${label} case passed individually.`];
  return [
    `**${failed.length} of ${total} ${label} cases failed individually:**`,
    "",
    ...failed.map((item) => `- \`${item.id}\`: ${(item.failures ?? []).join("; ") || "no reason recorded"}`),
  ];
}

export function renderCaseSummary(report) {
  const lines = ["## Eval canary: per-case results", ""];
  if (!report) {
    lines.push(
      "No per-case report was produced, so the evaluation did not complete. This is not a pass. Read the run log.",
    );
    return `${lines.join("\n")}\n`;
  }
  lines.push(
    "Every case that failed is listed here, whether or not the run's overall thresholds passed.",
    "",
    ...section("answer", report.rag?.summary),
    "",
    ...section("retrieval", report.retrieval?.summary),
  );
  return `${lines.join("\n")}\n`;
}

function main() {
  const index = process.argv.indexOf("--reports-dir");
  const dir = index > -1 ? process.argv[index + 1] : ".local/eval-canary/quality-reports";
  const report = latestQualityReport(dir);
  const text = renderCaseSummary(report);
  const target = process.env.GITHUB_STEP_SUMMARY;
  if (target) appendFileSync(target, text);
  process.stdout.write(text);
  const failed =
    (report?.rag?.summary?.failed_cases?.length ?? 0) + (report?.retrieval?.summary?.failed_cases?.length ?? 0);
  // A visible annotation on the run page, so a green run with failing cases is not silent.
  if (failed > 0)
    console.log(
      `::warning title=Eval canary cases failing::${failed} eval case(s) failed individually; see the job summary.`,
    );
}

if (isDirectEntrypoint(import.meta.url)) main();
