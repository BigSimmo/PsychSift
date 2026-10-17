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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Pin to a multi-platform image index digest. Update with:
//   node scripts/resolve-oci-image-digest.mjs aquasec/trivy:0.59.1
export const TRIVY_VERSION = "0.59.1";
export const TRIVY_IMAGE =
  "aquasec/trivy:0.59.1@sha256:029e990b328d149bf0a9ffe355919041e1f86192db2df47e217f8a36dd42ceac";
export const REQUIRED_TRIVY_SCAN_IMAGES = Object.freeze(["clinical-kb-app:ci", "clinical-kb-worker:ci"]);

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { encoding: "utf8", stdio: "pipe", ...opts });
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

export function evaluateTrivySummaryText(summaryText, requiredImages = REQUIRED_TRIVY_SCAN_IMAGES) {
  const text = typeof summaryText === "string" ? summaryText.trim() : "";
  if (!text) {
    return {
      assessed: false,
      ok: false,
      high: 0,
      critical: 0,
      reason: "empty_summary",
    };
  }
  if (/\bSTATUS=unassessed\b/.test(text)) {
    return {
      assessed: false,
      ok: false,
      high: 0,
      critical: 0,
      reason: "contains_unassessed_status",
    };
  }
  for (const imageRef of requiredImages) {
    const escaped = imageRef.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const okLineRe = new RegExp(`^Trivy scan completed \\(${escaped}\\): STATUS=ok\\b`, "m");
    if (!okLineRe.test(text)) {
      return {
        assessed: false,
        ok: false,
        high: 0,
        critical: 0,
        reason: `missing_status_ok_for_${imageRef}`,
      };
    }
  }

  const high = [...text.matchAll(/\bHIGH=(\d+)\b/g)].reduce((sum, match) => sum + Number(match[1]), 0);
  const critical = [...text.matchAll(/\bCRITICAL=(\d+)\b/g)].reduce((sum, match) => sum + Number(match[1]), 0);
  return {
    assessed: true,
    ok: high === 0 && critical === 0,
    high,
    critical,
    reason: high === 0 && critical === 0 ? null : "high_or_critical_vulnerabilities_found",
  };
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
function cachedTrivyDbNeedsRefresh(cacheDir, subdir, dbFile) {
  if (!existsSync(join(cacheDir, subdir, dbFile))) return true;
  let metadataText = null;
  try {
    metadataText = readFileSync(join(cacheDir, subdir, "metadata.json"), "utf8");
  } catch {
    // Unreadable metadata is treated as absent.
  }
  return trivyDbNeedsRefresh(metadataText);
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
  const [imageRef, ...rest] = process.argv.slice(2);
  if (!imageRef) {
    console.error("Usage: node scripts/trivy-image-scan.mjs <image:tag> [--severity SEV] [--sbom <output.json>]");
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
    ? run(trivy, ["image", "--format", "json", "--exit-code", "0", "--severity", severity, imageRef])
    : runDockerTrivy(imageRef, ["image", "--format", "json", "--exit-code", "0", "--severity", severity, "__IMAGE__"], {
        needsVulnerabilityDb: true,
      });

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

  const { counts } = validated;
  console.log(
    `Trivy scan completed (${imageRef}): STATUS=ok HIGH=${counts.HIGH} CRITICAL=${counts.CRITICAL} MEDIUM=${counts.MEDIUM} LOW=${counts.LOW} UNKNOWN=${counts.UNKNOWN}`,
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
