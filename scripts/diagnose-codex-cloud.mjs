#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

import { lockPythonVersion, workerPythonLockTargets } from "./worker-python-lock-config.mjs";

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
}) {
  const issues = [];
  if (major(nodeVersion) !== "24") {
    issues.push({
      code: "NODE_RUNTIME",
      issue: `Node 24.x is required; detected ${nodeVersion || "unavailable"}.`,
      fix: "Select Node 24 in the Cloud environment or rerun setup with nvm available.",
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

function commandVersion(command, args = ["--version"]) {
  const result = spawnSync(command, args, { encoding: "utf8", shell: false });
  if (result.status !== 0) return null;
  return `${result.stdout || result.stderr}`.match(/\d+(?:\.\d+){1,2}/)?.[0] ?? null;
}

function npmVersion() {
  if (process.env.npm_execpath) return commandVersion(process.execPath, [process.env.npm_execpath, "--version"]);
  if (process.platform === "win32")
    return commandVersion(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "npm.cmd --version"]);
  return commandVersion("npm");
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

export function main() {
  if (process.env.CODEX_CLOUD !== "1") {
    console.log("[Codex Cloud Diagnose] status=NOT_APPLICABLE issues=0");
    console.log(
      "[Codex Cloud Diagnose] INFO DESKTOP_CONTEXT: Run this command inside a Codex Cloud shell; local Python versions are not Cloud runtime evidence.",
    );
    return 0;
  }

  const cloudLock = workerPythonLockTargets.cloud.outputFile;
  const pythonBin = argument("--python-bin") || process.env.CODEX_CLOUD_OCR_PYTHON || "python3";
  const issues = diagnoseCodexCloud({
    nodeVersion: commandVersion(process.execPath, ["--version"]),
    npmVersion: npmVersion(),
    pythonVersion: commandVersion(pythonBin),
    cloudLockContents: existsSync(cloudLock) ? readFileSync(cloudLock, "utf8") : null,
    setupStep: argument("--setup-step"),
    setupExitCode: argument("--exit-code"),
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
