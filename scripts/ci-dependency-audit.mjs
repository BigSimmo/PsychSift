import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/**
 * Minimal process evidence consumed by the audit policy, independent of spawnSync internals.
 * @typedef {{ status: number | null, stdout: string | null, stderr?: string | null, error?: Error, signal?: NodeJS.Signals | null }} AuditResult
 */

/** @param {AuditResult} result */
export function auditVerdict(result) {
  let report;
  try {
    report = JSON.parse(result.stdout ?? "");
  } catch {
    return "unassessed";
  }
  const counts = report?.metadata?.vulnerabilities;
  const severities = ["info", "low", "moderate", "high", "critical"];
  if (
    report?.auditReportVersion !== 2 ||
    report.error ||
    !report.vulnerabilities ||
    Array.isArray(report.vulnerabilities) ||
    typeof report.vulnerabilities !== "object" ||
    !severities.concat("total").every((key) => Number.isSafeInteger(counts?.[key]) && counts[key] >= 0) ||
    severities.reduce((sum, key) => sum + counts[key], 0) !== counts.total
  ) {
    return "unassessed";
  }
  if (counts.high + counts.critical > 0) return "findings";
  return result.status === 0 && !result.error && !result.signal ? "clean" : "unassessed";
}

/**
 * @param {{ run?: () => AuditResult, wait?: (milliseconds: number) => void | Promise<unknown>, log?: (message: string) => void }} [options]
 */
export async function runDependencyAudit({
  run = () => spawnSync("npm", ["audit", "--omit=dev", "--audit-level=high", "--json"], { encoding: "utf8" }),
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  log = (message) => console.error(message),
} = {}) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = run();
    if (result.stdout) log(result.stdout);
    if (result.stderr) log(result.stderr);
    const verdict = auditVerdict(result);
    if (verdict === "clean") return 0;
    if (verdict === "findings") {
      log("npm audit found blocking vulnerabilities; no retry can resolve this report.");
      return 1;
    }
    if (attempt === 3) {
      log("npm audit remains unassessed after 3 attempts; failing closed.");
      return 1;
    }
    log(`npm audit attempt ${attempt} could not establish a verdict; retrying in 10s.`);
    await wait(10_000);
  }
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runDependencyAudit();
}
