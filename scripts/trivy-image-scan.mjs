#!/usr/bin/env node
/**
 * trivy-image-scan — vulnerability scan and SBOM generation using a pinned
 * immutable Trivy Docker image. Designed for Linux CI; local runs need a
 * `trivy` binary on PATH or Docker.
 *
 * The Docker fallback exports the target image with `docker save` and mounts
 * only that tar (plus an optional output dir). It never bind-mounts the Docker
 * daemon socket, which would be equivalent to root on the host.
 */
import { basename, dirname, join, resolve } from "node:path";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Pin to a multi-platform image index digest. Update with:
//   node scripts/resolve-oci-image-digest.mjs aquasec/trivy:0.59.1
export const TRIVY_VERSION = "0.59.1";
export const TRIVY_IMAGE =
  "aquasec/trivy:0.59.1@sha256:029e990b328d149bf0a9ffe355919041e1f86192db2df47e217f8a36dd42ceac";
export const REQUIRED_TRIVY_SCAN_IMAGES = Object.freeze(["clinical-kb-app:ci", "clinical-kb-worker:ci"]);

// Owner decision 2026-10-21 (docs/decisions/2026-10-21-worker-scan-advisory-until-4-nov.md): until
// this date, HIGH/CRITICAL findings in the worker image are advisory everywhere, because a red
// main-branch scan held up production deploys while the worker fixes (#3701) are finished. App
// image findings and any unassessed scan still fail. The exemption ends by itself on this date.
export const WORKER_SCAN_ADVISORY_UNTIL = "2026-11-04T00:00:00Z";
export const WORKER_SCAN_IMAGE = "clinical-kb-worker:ci";

function run(cmd, args, opts = {}) {
  // Full worker inventories exceed spawnSync's default 1MiB buffer.
  // Bound both local and Docker scanner evidence at 32MiB.
  const result = spawnSync(cmd, args, { encoding: "utf8", stdio: "pipe", maxBuffer: 32 * 1024 * 1024, ...opts });
  if (result.error) throw result.error;
  return result;
}

export function isCompatibleLocalTrivyVersion(versionOutput, expectedVersion = TRIVY_VERSION) {
  if (typeof versionOutput !== "string" || !versionOutput.trim()) return false;
  const escaped = expectedVersion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\bVersion:\\s*v?${escaped}\\b`, "i").test(versionOutput);
}

function localTrivy(env = process.env) {
  try {
    const result = run(process.platform === "win32" ? "where" : "which", ["trivy"]);
    const binary = result.stdout?.split(/\r?\n/)[0]?.trim() || null;
    if (!binary) return null;
    if (env.TRIVY_PREFER_LOCAL === "1" || env.TRIVY_PREFER_LOCAL === "true") {
      return binary;
    }
    const versionCheck = run(binary, ["--version"]);
    if (versionCheck.status === 0 && isCompatibleLocalTrivyVersion(versionCheck.stdout, TRIVY_VERSION)) {
      return binary;
    }
    return null;
  } catch {
    return null;
  }
}

export function validateTrivyReportJson(rawStdout) {
  if (typeof rawStdout !== "string" || !rawStdout.trim()) {
    return { ok: false, reason: "invalid_trivy_json" };
  }
  let report;
  try {
    report = JSON.parse(rawStdout);
  } catch {
    return { ok: false, reason: "invalid_trivy_json" };
  }
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    return { ok: false, reason: "invalid_trivy_json" };
  }
  if (typeof report.SchemaVersion !== "number" || !Number.isFinite(report.SchemaVersion)) {
    return { ok: false, reason: "invalid_trivy_json" };
  }
  const hasResultsArray = Array.isArray(report.Results);
  const hasVerifiedMetadata =
    report.Metadata !== null &&
    typeof report.Metadata === "object" &&
    !Array.isArray(report.Metadata) &&
    (typeof report.Metadata.ImageID === "string" ||
      (report.Metadata.OS !== null && typeof report.Metadata.OS === "object") ||
      Array.isArray(report.Metadata.DiffIDs));
  if (!hasResultsArray && !hasVerifiedMetadata) {
    return { ok: false, reason: "invalid_trivy_json" };
  }

  const results = hasResultsArray ? report.Results : [];
  const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 };
  let totalVulnerabilities = 0;

  for (const entry of results) {
    if (!entry || typeof entry !== "object") continue;
    const vulns = Array.isArray(entry.Vulnerabilities) ? entry.Vulnerabilities : [];
    for (const vuln of vulns) {
      totalVulnerabilities += 1;
      const sev = typeof vuln?.Severity === "string" && vuln.Severity in counts ? vuln.Severity : "UNKNOWN";
      counts[sev] += 1;
    }
  }

  return {
    ok: true,
    report,
    counts,
    totalVulnerabilities,
  };
}

export const DEFAULT_TRIVY_SUPPRESSIONS_PATH = fileURLToPath(
  new URL("../scripts/trivy-suppressions.json", import.meta.url),
);
const SUPPRESSION_KEYS = ["image", "package", "installed", "cve", "justification", "remove_when"];

/**
 * @typedef {{ image: string; package: string; installed: string; cve: string; justification: string; remove_when: string; [key: string]: unknown }} TrivySuppression
 */

/**
 * Load and validate the exact-match suppression list (scripts/trivy-suppressions.json).
 * @param {string} text
 * @returns {TrivySuppression[]}
 */
export function parseTrivySuppressions(text) {
  const doc = JSON.parse(text);
  if (!doc || doc.schema_version !== 1 || !Array.isArray(doc.suppressions)) {
    throw new Error("Invalid Trivy suppressions file: expected schema_version 1 with suppressions[]");
  }
  for (const [i, row] of doc.suppressions.entries()) {
    for (const key of SUPPRESSION_KEYS) {
      if (typeof row?.[key] !== "string" || !row[key].trim()) {
        throw new Error(`Invalid Trivy suppression #${i}: missing ${key}`);
      }
    }
    if (!/^(CVE|GHSA)-[0-9A-Za-z-]+$/.test(row.cve)) throw new Error(`Invalid Trivy suppression #${i}: bad cve`);
  }
  return doc.suppressions;
}

/**
 * Remove findings that exactly match (image, package, installed version, CVE). Anything else,
 * including the same CVE at a different installed version, stays counted.
 * @param {any} report
 * @param {string} imageRef
 * @param {Array<{ image: string; package: string; installed: string; cve: string }>} suppressions
 * @returns {{ report: any; suppressed: any[] }}
 */
export function applyTrivySuppressions(report, imageRef, suppressions) {
  const keys = new Set(
    suppressions.filter((s) => s.image === imageRef).map((s) => `${s.package}\u0000${s.installed}\u0000${s.cve}`),
  );
  const suppressed = [];
  const results = Array.isArray(report?.Results)
    ? report.Results.map((result) => {
        if (!result || typeof result !== "object" || !Array.isArray(result.Vulnerabilities)) return result;
        const kept = [];
        for (const v of result.Vulnerabilities) {
          const key = `${v?.PkgName}\u0000${v?.InstalledVersion}\u0000${v?.VulnerabilityID}`;
          if (keys.has(key)) suppressed.push(v);
          else kept.push(v);
        }
        return { ...result, Vulnerabilities: kept };
      })
    : report?.Results;
  return { report: { ...report, Results: results }, suppressed };
}

// Put actionable public package/CVE metadata in job logs as well as the full
// retained report. Keep stderr separate from the strictly parsed summary.
export function trivyFindingDetails(report, limit = 512) {
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > 512) throw new RangeError("Invalid finding log limit");
  const rows = [];
  let total = 0;
  const field = (value) => (typeof value === "string" ? value.replace(/[^\x20-\x7e]/g, "?").slice(0, 256) : "");
  for (const result of Array.isArray(report.Results) ? report.Results : []) {
    for (const vulnerability of Array.isArray(result?.Vulnerabilities) ? result.Vulnerabilities : []) {
      if (!["HIGH", "CRITICAL"].includes(vulnerability?.Severity)) continue;
      total += 1;
      if (rows.length < limit) {
        rows.push({
          type: field(result.Type),
          package: field(vulnerability.PkgName),
          source: field(vulnerability.SrcName),
          installed: field(vulnerability.InstalledVersion),
          fixed: field(vulnerability.FixedVersion),
          cve: field(vulnerability.VulnerabilityID),
          severity: vulnerability.Severity,
        });
      }
    }
  }
  return { rows, total, truncated: total > rows.length };
}

export function evaluateTrivySummaryText(summaryText, requiredImages = REQUIRED_TRIVY_SCAN_IMAGES) {
  const unassessed = (reason) => ({ assessed: false, ok: false, high: 0, critical: 0, reason });
  const text = typeof summaryText === "string" ? summaryText.trim() : "";
  if (!text) return unassessed("empty_summary");
  if (/\bSTATUS=unassessed\b/.test(text)) return unassessed("contains_unassessed_status");

  // Each image must supply exactly one complete record. Never infer a missing,
  // malformed or overflowing count as zero, or count unrelated diagnostic text.
  const evidence = new Map();
  const record =
    /^Trivy scan completed \(([^)]+)\): STATUS=ok HIGH=(0|[1-9]\d*) CRITICAL=(0|[1-9]\d*) MEDIUM=(0|[1-9]\d*) LOW=(0|[1-9]\d*) UNKNOWN=(0|[1-9]\d*)(?: SUPPRESSED=(?:0|[1-9]\d*))?$/;
  for (const line of text.split(/\r?\n/).filter((line) => line.trim())) {
    const match = record.exec(line);
    if (!match) return unassessed("malformed_scan_record");
    const [, imageRef, ...rawCounts] = match;
    if (!requiredImages.includes(imageRef)) return unassessed(`unexpected_image_${imageRef}`);
    if (evidence.has(imageRef)) return unassessed(`duplicate_scan_record_for_${imageRef}`);
    const counts = rawCounts.map(Number);
    if (!counts.every(Number.isSafeInteger)) return unassessed(`invalid_counts_for_${imageRef}`);
    evidence.set(imageRef, counts);
  }

  let high = 0;
  let critical = 0;
  const byImage = {};
  for (const imageRef of requiredImages) {
    const counts = evidence.get(imageRef);
    if (!counts) return unassessed(`missing_status_ok_for_${imageRef}`);
    high += counts[0];
    critical += counts[1];
    byImage[imageRef] = { high: counts[0], critical: counts[1] };
    if (!Number.isSafeInteger(high) || !Number.isSafeInteger(critical)) return unassessed("count_overflow");
  }
  return {
    assessed: true,
    ok: high === 0 && critical === 0,
    high,
    critical,
    byImage,
    reason: high === 0 && critical === 0 ? null : "high_or_critical_vulnerabilities_found",
  };
}

/**
 * Whether assessed findings fail this event. Pull requests and merge groups stay advisory. Elsewhere
 * any finding fails, except worker-image findings before WORKER_SCAN_ADVISORY_UNTIL.
 */
export function trivyFindingsBlock(result, eventName, now = new Date()) {
  if (!result?.assessed) return true;
  if (result.ok) return false;
  if (["pull_request", "merge_group"].includes(eventName)) return false;
  if (now.getTime() >= Date.parse(WORKER_SCAN_ADVISORY_UNTIL)) return true;
  return Object.entries(result.byImage ?? {}).some(
    ([imageRef, counts]) => imageRef !== WORKER_SCAN_IMAGE && (counts.high > 0 || counts.critical > 0),
  );
}

function evaluateSummaryFile(summaryPath, eventName) {
  let summary;
  try {
    summary = readFileSync(summaryPath, "utf8");
  } catch {
    console.error("::error::Trivy scan unassessed: summary is missing or unreadable.");
    return 1;
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    writeFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## Trivy image scan (HIGH,CRITICAL)\n\n\`\`\`\n${summary}\n\`\`\`\n`,
      { flag: "a" },
    );
  }
  const result = evaluateTrivySummaryText(summary);
  if (!result.assessed) {
    console.error(`::error::Trivy scan unassessed: ${result.reason}.`);
    return 1;
  }
  const counts = `HIGH=${result.high} CRITICAL=${result.critical}`;
  console.log(counts);
  if (result.ok) return 0;
  if (["pull_request", "merge_group"].includes(eventName)) {
    console.log(
      `::warning::Trivy found ${counts} in the production images (advisory on pull requests and merge groups).`,
    );
    return 0;
  }
  if (!trivyFindingsBlock(result, eventName)) {
    console.log(
      `::warning::Trivy found ${counts}, all in the worker image, which is advisory until ${WORKER_SCAN_ADVISORY_UNTIL.slice(0, 10)} (owner decision 2026-10-21).`,
    );
    return 0;
  }
  console.error(`::error::Trivy found ${counts} in the production images; see the job summary.`);
  return 1;
}

/**
 * Docker volume arguments for a containerised Trivy run. The saved image tarball stays read-only.
 * Only the throwaway vulnerability-database cache is writable: Trivy opens its database file
 * read-write, and a read-only mount made every scan fail with "read-only file system", which is
 * reported as unassessed. The container still runs with no network.
 *
 * @param {{ workDir: string; cacheDir?: string | null; outputDir?: string | null }} options
 * @returns {string[]}
 */
export function trivyDockerMounts({ workDir, cacheDir = null, outputDir = null }) {
  const mounts = ["-v", `${workDir}:/work:ro`];
  if (cacheDir) mounts.push("-v", `${cacheDir}:/cache`);
  if (outputDir) mounts.push("-v", `${outputDir}:/out`);
  return mounts;
}

/**
 * Whether the cached vulnerability database must be downloaded before an offline scan. Scans pass
 * --skip-db-update, so a persistent TRIVY_CACHE_DIR would otherwise keep using an expired database
 * and report STATUS=ok on stale data. A missing, unreadable or undated metadata file, or a
 * NextUpdate time that has passed, all require a fresh download.
 *
 * @param {string | null} metadataText contents of <cache>/db/metadata.json, or null when absent
 * @param {Date} [now]
 * @returns {boolean}
 */
export function trivyDbNeedsRefresh(metadataText, now = new Date()) {
  if (typeof metadataText !== "string") return true;
  let nextUpdate;
  try {
    nextUpdate = Date.parse(JSON.parse(metadataText)?.NextUpdate);
  } catch {
    return true;
  }
  return !Number.isFinite(nextUpdate) || nextUpdate <= now.getTime();
}

/**
 * Whether a cached Trivy database directory needs downloading: its database file is missing (a
 * partial cache), or its metadata says it is stale. The main database lives in `db/trivy.db` and
 * the Java database in `java-db/trivy-java.db`, each beside its own metadata.json.
 */
export function cachedTrivyDbNeedsRefresh(cacheDir, subdir, dbFile, now = new Date()) {
  if (!existsSync(join(cacheDir, subdir, dbFile))) return true;
  let metadataText = null;
  try {
    metadataText = readFileSync(join(cacheDir, subdir, "metadata.json"), "utf8");
  } catch {
    // Unreadable metadata is treated as absent.
  }
  return trivyDbNeedsRefresh(metadataText, now);
}

/**
 * @param {string} imageRef
 * @param {string[]} trivyArgs use "__IMAGE__" where the image ref belongs and
 *   "__OUT__" where an output path belongs (when outputHostPath is set)
 * @param {{ outputHostPath?: string | null; needsVulnerabilityDb?: boolean }} [opts]
 */
function runDockerTrivy(imageRef, trivyArgs, { outputHostPath = null, needsVulnerabilityDb = false } = {}) {
  const workDir = mkdtempSync(join(tmpdir(), "trivy-scan-"));
  const tarName = "image.tar";
  const tarPath = join(workDir, tarName);
  try {
    let cacheDir = null;
    if (needsVulnerabilityDb) {
      cacheDir = process.env.TRIVY_CACHE_DIR
        ? resolve(process.env.TRIVY_CACHE_DIR)
        : join(tmpdir(), `trivy-db-cache-${TRIVY_VERSION}`);
      mkdirSync(cacheDir, { recursive: true });
      // A failed refresh fails the scan rather than falling back to the expired database.
      if (cachedTrivyDbNeedsRefresh(cacheDir, "db", "trivy.db")) {
        const dbDownload = run("docker", [
          "run",
          "--rm",
          "-v",
          `${cacheDir}:/cache`,
          TRIVY_IMAGE,
          "image",
          "--download-db-only",
          "--cache-dir",
          "/cache",
        ]);
        if (dbDownload.status !== 0) {
          return {
            status: dbDownload.status ?? 1,
            stdout: dbDownload.stdout,
            stderr: dbDownload.stderr || dbDownload.stdout || "Trivy DB download failed",
          };
        }
      }
      // The Java database expires on its own schedule, so it is checked separately. Its download
      // stays best-effort: it only adds Java archive inspection, and a failure is retried next run.
      if (cachedTrivyDbNeedsRefresh(cacheDir, "java-db", "trivy-java.db")) {
        run("docker", [
          "run",
          "--rm",
          "-v",
          `${cacheDir}:/cache`,
          TRIVY_IMAGE,
          "image",
          "--download-java-db-only",
          "--cache-dir",
          "/cache",
        ]);
      }
    }

    // Keep Docker's save temp files inside workDir so finally{} can reclaim them
    // and CI runners do not fill the shared /tmp between sequential scans.
    const saveEnv = { ...process.env, TMPDIR: workDir, DOCKER_TMPDIR: workDir };
    const save = run("docker", ["save", "-o", tarPath, imageRef], { env: saveEnv });
    if (save.status !== 0) {
      const detail = save.stderr || save.stdout || `docker save failed for ${imageRef}`;
      if (/no space left on device/i.test(detail)) {
        console.error(`ENOSPC while docker-saving ${imageRef}; free builder cache and retry.`);
      }
      return {
        status: 1,
        stdout: save.stdout,
        stderr: detail,
      };
    }

    const mounts = trivyDockerMounts({
      workDir,
      cacheDir,
      outputDir: outputHostPath ? dirname(resolve(outputHostPath)) : null,
    });

    const dockerArgs = ["run", "--rm", "--network=none", ...mounts, TRIVY_IMAGE];
    for (const arg of trivyArgs) {
      if (arg === "__IMAGE__") {
        dockerArgs.push("--input", `/work/${tarName}`);
      } else if (arg === "__OUT__" && outputHostPath) {
        dockerArgs.push(`/out/${basename(outputHostPath)}`);
      } else {
        dockerArgs.push(arg);
      }
    }
    if (cacheDir) {
      dockerArgs.push("--cache-dir", "/cache", "--skip-db-update", "--skip-java-db-update");
    }

    return run("docker", dockerArgs);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

function main() {
  if (process.argv[2] === "--evaluate-summary") {
    const [, , , summaryPath, eventName] = process.argv;
    if (!summaryPath || !eventName || process.argv.length !== 5) {
      console.error("Usage: node scripts/trivy-image-scan.mjs --evaluate-summary <summary.txt> <event-name>");
      process.exit(1);
    }
    process.exit(evaluateSummaryFile(summaryPath, eventName));
  }
  const [imageRef, ...rest] = process.argv.slice(2);
  if (!imageRef) {
    console.error(
      "Usage: node scripts/trivy-image-scan.mjs <image:tag> [--severity SEV] [--sbom <output.json>] [--report <output.json>]",
    );
    process.exit(1);
  }

  function optionValue(flag) {
    const idx = rest.indexOf(flag);
    if (idx < 0) return null;
    const value = rest[idx + 1];
    if (!value || value.startsWith("--")) {
      console.error(`Missing value for ${flag}`);
      process.exit(1);
    }
    return value;
  }

  const sbomPath = optionValue("--sbom");
  const reportPath = optionValue("--report");
  const severity = optionValue("--severity") ?? "HIGH,CRITICAL";

  const trivy = localTrivy();

  if (sbomPath) {
    const out = resolve(sbomPath);
    const result = trivy
      ? run(trivy, ["image", "--format", "cyclonedx", "--output", out, imageRef])
      : runDockerTrivy(imageRef, ["image", "--format", "cyclonedx", "--output", "__OUT__", "__IMAGE__"], {
          outputHostPath: out,
        });
    if (result.status !== 0) {
      console.error(result.stderr || result.stdout);
      process.exit(1);
    }
    console.log(`SBOM written to ${out}`);
  }

  const result = trivy
    ? run(trivy, ["image", "--format", "json", "--list-all-pkgs", "--exit-code", "0", "--severity", severity, imageRef])
    : runDockerTrivy(
        imageRef,
        ["image", "--format", "json", "--list-all-pkgs", "--exit-code", "0", "--severity", severity, "__IMAGE__"],
        {
          needsVulnerabilityDb: true,
        },
      );

  if (result.status !== 0) {
    console.error(result.stderr || result.stdout || `Trivy failed to scan ${imageRef}`);
    console.log(`Trivy scan failed (${imageRef}): STATUS=unassessed reason=scanner_exit_${result.status ?? 1}`);
    process.exit(2);
  }

  const validated = validateTrivyReportJson(result.stdout);
  if (!validated.ok) {
    console.error(`Trivy scan failed (${imageRef}): STATUS=unassessed reason=${validated.reason}`);
    console.log(`Trivy scan failed (${imageRef}): STATUS=unassessed reason=${validated.reason}`);
    process.exit(2);
  }

  const suppressionsPath = optionValue("--suppressions") ?? DEFAULT_TRIVY_SUPPRESSIONS_PATH;
  let suppressions = [];
  if (!rest.includes("--no-suppressions") && existsSync(suppressionsPath)) {
    try {
      suppressions = parseTrivySuppressions(readFileSync(suppressionsPath, "utf8"));
    } catch (error) {
      console.log(`Trivy scan failed (${imageRef}): STATUS=unassessed reason=invalid_suppressions`);
      console.error(String(error?.message ?? error));
      process.exit(2);
    }
  }
  const applied = applyTrivySuppressions(validated.report, imageRef, suppressions);
  const { counts } = validateTrivyReportJson(JSON.stringify(applied.report));
  // The retained report stays the unfiltered scanner output; suppressions only change the gate counts.
  if (reportPath) writeFileSync(resolve(reportPath), `${JSON.stringify(validated.report, null, 2)}\n`);
  const suppressedDetails = trivyFindingDetails({
    Results: [{ Type: "suppressed", Vulnerabilities: applied.suppressed }],
  });
  for (const row of suppressedDetails.rows)
    console.error(`Trivy suppressed (scripts/trivy-suppressions.json): ${JSON.stringify(row)}`);
  const details = trivyFindingDetails(applied.report);
  for (const row of details.rows) console.error(`Trivy finding: ${JSON.stringify(row)}`);
  if (details.truncated)
    console.error(`Trivy finding details truncated: ${details.rows.length}/${details.total}; see retained report.`);
  console.log(
    `Trivy scan completed (${imageRef}): STATUS=ok HIGH=${counts.HIGH} CRITICAL=${counts.CRITICAL} MEDIUM=${counts.MEDIUM} LOW=${counts.LOW} UNKNOWN=${counts.UNKNOWN} SUPPRESSED=${applied.suppressed.length}`,
  );
}

function isDirectEntrypoint(metaUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fileURLToPath(metaUrl) === resolve(entry);
  } catch {
    return false;
  }
}

if (isDirectEntrypoint(import.meta.url)) {
  main();
}
