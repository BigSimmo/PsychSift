#!/usr/bin/env node
/**
 * check-worker-python-lock — verify that the selected Python runtime's lock
 * is in sync with its source input and is a hashed lockfile.
 */
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  assertLockTarget,
  pythonMajorMinor,
  requestedLockTarget,
  workerPythonLockTargets,
} from "./worker-python-lock-config.mjs";

const PYTHON = process.env.PYTHON_BIN?.trim() || (process.platform === "win32" ? "python" : "python3");
const PIP_TOOLS_VERSION = "7.6.0";
const target = requestedLockTarget();
const IN_FILE = target.inputFile;

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { encoding: "utf8", stdio: "pipe", ...opts });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(" ")}\n${result.stderr || ""}\n${result.stdout || ""}`);
  }
  return result;
}

function venvPython(venvDir) {
  return process.platform === "win32"
    ? path.join(venvDir, "Scripts", "python.exe")
    : path.join(venvDir, "bin", "python");
}

function ensureVenv(venvDir) {
  if (existsSync(venvDir)) rmSync(venvDir, { recursive: true, force: true });
  run(PYTHON, ["-m", "venv", venvDir]);
  const python = venvPython(venvDir);
  run(python, ["-m", "pip", "install", "setuptools", "wheel"]);
  run(python, ["-m", "pip", "install", `pip-tools==${PIP_TOOLS_VERSION}`]);
}

function pipCompile(venvDir, outputFile) {
  const python = venvPython(venvDir);
  const args = ["-m", "piptools", "compile", "--generate-hashes", "--output-file", outputFile, IN_FILE];
  if (target.includeUnsafe) args.splice(3, 0, "--allow-unsafe");
  run(python, args, {
    env: { ...process.env, CUSTOM_COMPILE_COMMAND: target.generateCommand },
  });
}

function normalize(contents) {
  return contents
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "" && !line.trim().startsWith("#"))
    .join("\n");
}

function main() {
  if (!existsSync(IN_FILE)) throw new Error(`Missing ${IN_FILE}`);
  for (const lockTarget of Object.values(workerPythonLockTargets)) {
    if (!existsSync(lockTarget.outputFile)) throw new Error(`Missing ${lockTarget.outputFile}`);
    assertLockTarget(lockTarget);
  }
  if (process.argv.includes("--static")) {
    console.log("Worker Python lock headers, pins, and hashes are valid for production and Cloud targets.");
    return;
  }

  const actualPythonVersion = pythonMajorMinor(PYTHON);
  if (actualPythonVersion !== target.pythonVersion) {
    throw new Error(
      `${target.name} lock verification requires Python ${target.pythonVersion}; ${PYTHON} is Python ${actualPythonVersion}. Set PYTHON_BIN to the matching interpreter.`,
    );
  }

  const committed = readFileSync(target.outputFile, "utf8");

  const venvDir = mkdtempSync(path.join(tmpdir(), "pip-tools-check-"));
  let generated;
  try {
    ensureVenv(venvDir);
    const tempOut = path.join(venvDir, path.basename(target.outputFile));
    pipCompile(venvDir, tempOut);
    generated = readFileSync(tempOut, "utf8");
  } finally {
    rmSync(venvDir, { recursive: true, force: true });
  }

  if (normalize(committed) !== normalize(generated)) {
    mkdirSync("tmp", { recursive: true });
    writeFileSync(
      "tmp/requirements-generated-diff.txt",
      `--- committed\n+++ generated\n${committed}\n---\n${generated}`,
    );
    throw new Error(`${target.outputFile} is out of sync with ${IN_FILE}. Regenerate with: ${target.generateCommand}`);
  }

  console.log(`${target.outputFile} is in sync with ${IN_FILE} for Python ${target.pythonVersion}`);
}

main();
