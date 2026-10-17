#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { closeSync, fstatSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";
import { configuredProviderCredentialNames } from "./check-codex-cloud-setup.mjs";
import { nodeVersionSatisfiesRange } from "./setup-codex-worktree.mjs";

import { lockPythonVersion, workerPythonLockTargets } from "./worker-python-lock-config.mjs";

const repositoryNodeRange = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).engines.node;

function major(version) {
  return version?.match(/\d+/)?.[0] ?? null;
}

export function diagnoseCodexCloud({
  nodeVersion,
  npmVersion,
  pythonVersion,
  cloudLockContents,
  setupStep,
  setupExitCode,
  expectedNodeRange = repositoryNodeRange,
}) {
  const issues = [];
  if (!nodeVersionSatisfiesRange(nodeVersion, expectedNodeRange)) {
    issues.push({
      code: "NODE_RUNTIME",
      issue: `Node ${expectedNodeRange} is required; detected ${nodeVersion || "unavailable"}.`,
      fix: "Select the Node range from package.json engines.node in the Cloud environment or rerun setup with nvm available.",
    });
  }
  if (major(npmVersion) !== "11") {
    issues.push({
      code: "NPM_RUNTIME",
      issue: `npm 11.x is required; detected ${npmVersion || "unavailable"}.`,
      fix: "Run the repository Cloud setup so it installs the packageManager version from package.json.",
    });
  }
  const expectedPython = workerPythonLockTargets.cloud.pythonVersion;
  const actualLockPython = cloudLockContents ? lockPythonVersion(cloudLockContents) : null;
  if (!cloudLockContents) {
    issues.push({
      code: "CLOUD_PYTHON_LOCK_MISSING",
      issue: `${workerPythonLockTargets.cloud.outputFile} is missing.`,
      fix: `Generate it with Python ${expectedPython}: ${workerPythonLockTargets.cloud.generateCommand}.`,
    });
  } else if (actualLockPython !== expectedPython) {
    issues.push({
      code: "CLOUD_PYTHON_LOCK_TARGET",
      issue: `The Cloud Python lock targets ${actualLockPython || "an unknown version"}; Cloud requires Python ${expectedPython}.`,
      fix: `Regenerate it with Python ${expectedPython}: ${workerPythonLockTargets.cloud.generateCommand}.`,
    });
  } else if (!/^setuptools==/m.test(cloudLockContents) || !/--hash=sha256:/.test(cloudLockContents)) {
    issues.push({
      code: "CLOUD_PYTHON_LOCK_INTEGRITY",
      issue: "The Cloud Python lock does not pin and hash its Python 3.12 bootstrap dependencies.",
      fix: `Regenerate it with Python ${expectedPython}: ${workerPythonLockTargets.cloud.generateCommand}.`,
    });
  }
  if (!pythonVersion) {
    issues.push({
      code: "CLOUD_PYTHON_RUNTIME",
      issue: `The Cloud OCR Python interpreter could not be executed; Python ${expectedPython} is required.`,
      fix: `Rerun Cloud setup so it creates the Python ${expectedPython} OCR environment, or select Python ${expectedPython} in the Cloud environment.`,
    });
  } else if (!pythonVersion.startsWith(`${expectedPython}.`) && pythonVersion !== expectedPython) {
    issues.push({
      code: "CLOUD_PYTHON_RUNTIME",
      issue: `Cloud OCR uses Python ${pythonVersion}; the Cloud lock targets Python ${expectedPython}.`,
      fix: `Select Python ${expectedPython} in the Cloud environment, or deliberately add and validate a lock for the new runtime.`,
    });
  }
  if (setupExitCode && setupExitCode !== "0") {
    const pythonStep = setupStep === "python-worker-requirements";
    issues.push({
      code: "SETUP_COMMAND_FAILED",
      issue: `Cloud setup stopped in ${setupStep || "an unknown step"} with exit code ${setupExitCode}.`,
      fix: pythonStep
        ? `Review the pip error immediately above, regenerate the Python ${expectedPython} Cloud lock, then run npm run check:worker-python-cloud-lock.`
        : "Review the first error immediately above, apply its suggested fix, and retry setup. The failed step is reported here to narrow the search.",
    });
  }
  return issues;
}

// Version output is a single short line; anything larger is a malfunction.
export const VERSION_PROBE_OUTPUT_LIMIT_BYTES = 64 * 1024;

export function commandVersion(command, args = ["--version"], timeoutMilliseconds = 5000) {
  // File-backed stdio prevents descendants of a wrapper from keeping pipes
  // open after the timed-out process is killed.
  const outputDirectory = mkdtempSync(path.join(os.tmpdir(), "codex-cloud-version-"));
  const stdoutPath = path.join(outputDirectory, "stdout");
  const stderrPath = path.join(outputDirectory, "stderr");
  const stdout = openSync(stdoutPath, "w+");
  const stderr = openSync(stderrPath, "w+");
  // On POSIX hosts a file-size limit stops a noisy probe from filling
  // temporary storage before its deadline (SIGXFSZ fails the probe).
  const limitBlocks = String(Math.floor(VERSION_PROBE_OUTPUT_LIMIT_BYTES / 1024));
  const [spawnCommand, spawnArgs] =
    process.platform === "win32"
      ? [command, args]
      : ["/bin/sh", ["-c", 'ulimit -f "$1" || exit 125; shift; exec "$@"', "sh", limitBlocks, command, ...args]];
  try {
    const result = spawnSync(spawnCommand, spawnArgs, {
      shell: false,
      stdio: ["ignore", stdout, stderr],
      timeout: timeoutMilliseconds,
      killSignal: "SIGKILL",
    });
    const outputBytes = fstatSync(stdout).size + fstatSync(stderr).size;
    closeSync(stdout);
    closeSync(stderr);
    if (result.status !== 0 || outputBytes > VERSION_PROBE_OUTPUT_LIMIT_BYTES) return null;
    const output = `${readFileSync(stdoutPath, "utf8")}${readFileSync(stderrPath, "utf8")}`;
    return output.match(/\d+(?:\.\d+){1,2}/)?.[0] ?? null;
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true });
  }
}

function npmVersion() {
  if (process.env.npm_execpath) return commandVersion(process.execPath, [process.env.npm_execpath, "--version"]);
  if (process.platform === "win32")
    return commandVersion(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "npm.cmd --version"]);
  return commandVersion("npm");
}

/**
 * Parse only documented flags; never echo arbitrary argument or profile values.
 * @param {string[]} [args]
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 */
export function parseDiagnosticArguments(args = [], env = process.env) {
  const options = {};
  const errors = [];
  const valueFlags = new Set(["--python-bin", "--setup-step", "--exit-code"]);
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (Object.hasOwn(options, flag)) {
      errors.push("Diagnostic flags may be supplied only once.");
      break;
    }
    if (flag === "--legacy-profile") {
      options[flag] = true;
    } else if (valueFlags.has(flag)) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        errors.push(`${flag} requires a value.`);
        break;
      }
      options[flag] = value;
      index += 1;
    } else {
      errors.push("Unsupported Cloud-diagnostic argument.");
      break;
    }
  }
  if (
    env.CODEX_CLOUD_ACCESS_PROFILE !== undefined &&
    !["offline", "connected"].includes(env.CODEX_CLOUD_ACCESS_PROFILE)
  ) {
    errors.push("CODEX_CLOUD_ACCESS_PROFILE must be offline or connected.");
  }
  if (options["--exit-code"] !== undefined && !/^(?:0|[1-9]\d{0,2})$/.test(options["--exit-code"])) {
    errors.push("--exit-code must be an integer from 0 to 255.");
  } else if (Number(options["--exit-code"]) > 255) {
    errors.push("--exit-code must be an integer from 0 to 255.");
  }
  if (options["--setup-step"] !== undefined && !/^[a-z][a-z0-9-]{0,63}$/.test(options["--setup-step"])) {
    errors.push("--setup-step must be a short setup step identifier.");
  }
  if (args.length > 0 && !legacyCloudDiagnosticsSelected(args, env)) {
    errors.push("Diagnostic options require --legacy-profile or CODEX_CLOUD_ACCESS_PROFILE.");
  }
  return { options, errors };
}

/**
 * Diagnose the legacy toolchain only after explicit selection, independent of host branding.
 * @param {string[]} [args]
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 */
export function legacyCloudDiagnosticsSelected(args = [], env = process.env) {
  return args.includes("--legacy-profile") || env.CODEX_CLOUD_ACCESS_PROFILE !== undefined;
}

export function main() {
  const args = process.argv.slice(2);
  const { options, errors } = parseDiagnosticArguments(args);
  if (errors.length > 0) {
    console.error(`[Codex Cloud Diagnose] status=INVALID_INPUT issues=${errors.length}`);
    for (const error of errors) console.error(`[Codex Cloud Diagnose] FAIL: ${error}`);
    return 1;
  }
  if (!legacyCloudDiagnosticsSelected(args)) {
    console.log("[Codex Cloud Diagnose] status=NOT_APPLICABLE issues=0");
    console.log(
      "[Codex Cloud Diagnose] INFO PROFILE_NOT_SELECTED: Select the legacy profile explicitly with --legacy-profile or CODEX_CLOUD_ACCESS_PROFILE; local Python versions are not Cloud runtime evidence.",
    );
    return 0;
  }

  const providerNames = configuredProviderCredentialNames();
  if (providerNames.length > 0) {
    console.error("[Codex Cloud Diagnose] status=BLOCKED_ENVIRONMENT issues=1");
    console.error(
      `[Codex Cloud Diagnose] FAIL: Legacy diagnostics cannot probe runtimes with provider environment variables: ${providerNames.join(", ")}.`,
    );
    return 1;
  }

  const cloudLock = new URL(`../${workerPythonLockTargets.cloud.outputFile}`, import.meta.url);
  let cloudLockContents = null;
  try {
    cloudLockContents = readFileSync(cloudLock, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error("[Codex Cloud Diagnose] status=DEGRADED issues=1");
      console.error(
        "[Codex Cloud Diagnose] ISSUE CLOUD_PYTHON_LOCK_UNREADABLE: The repository Cloud Python lock could not be read.",
      );
      return 1;
    }
  }
  const pythonBin = options["--python-bin"] || process.env.CODEX_CLOUD_OCR_PYTHON || "python3";
  const issues = diagnoseCodexCloud({
    nodeVersion: commandVersion(process.execPath, ["--version"]),
    npmVersion: npmVersion(),
    pythonVersion: commandVersion(pythonBin),
    cloudLockContents,
    setupStep: options["--setup-step"],
    setupExitCode: options["--exit-code"],
  });
  console.log(`[Codex Cloud Diagnose] status=${issues.length === 0 ? "HEALTHY" : "DEGRADED"} issues=${issues.length}`);
  for (const issue of issues) {
    console.log(`[Codex Cloud Diagnose] ISSUE ${issue.code}: ${issue.issue}`);
    console.log(`[Codex Cloud Diagnose] FIX ${issue.code}: ${issue.fix}`);
  }
  if (issues.length === 0) console.log("[Codex Cloud Diagnose] No locally detectable setup issues.");
  return issues.length === 0 ? 0 : 1;
}

if (isDirectEntrypoint(import.meta.url)) process.exitCode = main();
