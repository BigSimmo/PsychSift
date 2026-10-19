#!/usr/bin/env node
/**
 * generate-worker-python-lock — pin the selected Python runtime's dependency
 * input using pip-tools. Target paths live in worker-python-lock-config.mjs.
 */
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { pythonMajorMinor, requestedLockTarget } from "./worker-python-lock-config.mjs";

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
  run(python, args, { env: { ...process.env, CUSTOM_COMPILE_COMMAND: target.generateCommand } });
}

function main() {
  if (!existsSync(IN_FILE)) throw new Error(`Missing ${IN_FILE}`);
  const actualPythonVersion = pythonMajorMinor(PYTHON);
  if (actualPythonVersion !== target.pythonVersion) {
    throw new Error(
      `${target.name} lock generation requires Python ${target.pythonVersion}; ${PYTHON} is Python ${actualPythonVersion}. Set PYTHON_BIN to the matching interpreter.`,
    );
  }

  const venvDir = mkdtempSync(path.join(tmpdir(), "pip-tools-"));
  try {
    ensureVenv(venvDir);
    pipCompile(venvDir, target.outputFile);
    console.log(`Generated ${target.outputFile} for Python ${target.pythonVersion}`);
  } finally {
    rmSync(venvDir, { recursive: true, force: true });
  }
}

main();
