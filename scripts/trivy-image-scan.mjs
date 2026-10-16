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
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Pin to a multi-platform image index digest. Update with:
//   node scripts/resolve-oci-image-digest.mjs aquasec/trivy:0.59.1
export const TRIVY_VERSION = "0.59.1";
export const TRIVY_IMAGE =
  "aquasec/trivy:0.59.1@sha256:029e990b328d149bf0a9ffe355919041e1f86192db2df47e217f8a36dd42ceac";
/**
 * Host directory holding a pre-downloaded Trivy vulnerability database. The scan container runs with
 * `--network=none`, so it cannot fetch the database itself; a separate networked step fills this
 * directory first (`--prefetch-db`), and the isolated scan then reads it with updates skipped.
 */
export const TRIVY_DB_CACHE_ENV = "TRIVY_DB_CACHE_DIR";
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
  const hasMetadataObject =
    report.Metadata !== null && typeof report.Metadata === "object" && !Array.isArray(report.Metadata);
  if (!hasResultsArray && !hasMetadataObject) {
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
 * @param {string} imageRef
 * @param {string[]} trivyArgs use "__IMAGE__" where the image ref belongs and
 *   "__OUT__" where an output path belongs (when outputHostPath is set)
 * @param {{ outputHostPath?: string | null }} [opts]
 */
function runDockerTrivy(imageRef, trivyArgs, { outputHostPath = null } = {}) {
  const workDir = mkdtempSync(join(tmpdir(), "trivy-scan-"));
  const tarName = "image.tar";
  const tarPath = join(workDir, tarName);
  try {
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

    const mounts = ["-v", `${workDir}:/work:ro`];
    if (outputHostPath) {
      mounts.push("-v", `${dirname(resolve(outputHostPath))}:/out`);
    }
    const dbCacheDir = process.env[TRIVY_DB_CACHE_ENV];
    let effectiveTrivyArgs = trivyArgs;
    if (dbCacheDir) {
      mounts.push("-v", `${resolve(dbCacheDir)}:/trivy-cache`);
      // Global scan flags follow the subcommand: use the prefetched database and never try the network.
      effectiveTrivyArgs = [
        trivyArgs[0],
        "--cache-dir",
        "/trivy-cache",
        "--skip-db-update",
        "--skip-java-db-update",
        ...trivyArgs.slice(1),
      ];
    }

    const dockerArgs = ["run", "--rm", "--network=none", ...mounts, TRIVY_IMAGE];
    for (const arg of effectiveTrivyArgs) {
      if (arg === "__IMAGE__") {
        dockerArgs.push("--input", `/work/${tarName}`);
      } else if (arg === "__OUT__" && outputHostPath) {
        dockerArgs.push(`/out/${basename(outputHostPath)}`);
      } else {
        dockerArgs.push(arg);
      }
    }

    return run("docker", dockerArgs);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

/**
 * Downloads the vulnerability database into `cacheDir` using the pinned Trivy image. This is the only
 * networked Trivy step; scans themselves stay `--network=none` and read the result.
 */
function prefetchDatabase(cacheDir) {
  if (!cacheDir) {
    console.error("Usage: node scripts/trivy-image-scan.mjs --prefetch-db <cache-dir>");
    process.exit(1);
  }
  mkdirSync(resolve(cacheDir), { recursive: true });
  const result = run("docker", [
    "run",
    "--rm",
    "-v",
    `${resolve(cacheDir)}:/trivy-cache`,
    TRIVY_IMAGE,
    "image",
    "--download-db-only",
    "--cache-dir",
    "/trivy-cache",
  ]);
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout || "Trivy vulnerability database download failed");
    process.exit(1);
  }
  console.log(`Trivy vulnerability database downloaded to ${resolve(cacheDir)}`);
}

function main() {
  const [imageRef, ...rest] = process.argv.slice(2);
  if (imageRef === "--prefetch-db") {
    prefetchDatabase(rest[0]);
    return;
  }
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
    : runDockerTrivy(imageRef, ["image", "--format", "json", "--exit-code", "0", "--severity", severity, "__IMAGE__"]);

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
