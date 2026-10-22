import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

export const workerPythonLockTargets = Object.freeze({
  production: Object.freeze({
    name: "production",
    pythonVersion: "3.11",
    inputFile: "worker/python/requirements.in",
    outputFile: "worker/python/requirements.txt",
    generateCommand: "npm run generate:worker-python-lock",
    includeUnsafe: true,
  }),
  cloud: Object.freeze({
    name: "cloud",
    pythonVersion: "3.12",
    inputFile: "worker/python/requirements-cloud.in",
    outputFile: "worker/python/requirements-cloud.txt",
    generateCommand: "npm run generate:worker-python-cloud-lock",
    includeUnsafe: true,
  }),
});

export function requestedLockTarget(args = process.argv.slice(2)) {
  const targetIndex = args.indexOf("--target");
  const targetName = targetIndex === -1 ? "production" : args[targetIndex + 1];
  const target = workerPythonLockTargets[targetName];
  if (!target) {
    throw new Error(`Unknown worker Python lock target: ${targetName || "missing"}. Use production or cloud.`);
  }
  return target;
}

export function pythonMajorMinor(python, run = spawnSync) {
  const result = run(python, ["-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"], {
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(`Could not execute ${python}: ${result.stderr || result.error?.message || "unknown error"}`);
  }
  return result.stdout.trim();
}

export function lockPythonVersion(contents) {
  return contents.match(/pip-compile with Python (\d+\.\d+)/)?.[1] ?? null;
}

export function assertLockTarget(target, contents = readFileSync(target.outputFile, "utf8")) {
  const generatedVersion = lockPythonVersion(contents);
  if (generatedVersion !== target.pythonVersion) {
    throw new Error(
      `${target.outputFile} must be generated with Python ${target.pythonVersion}; detected ${generatedVersion || "no version header"}. Regenerate with: ${target.generateCommand}.`,
    );
  }
  if (!contents.split(/\r?\n/).some((line) => line.includes("=="))) {
    throw new Error(`${target.outputFile} does not contain pinned (==) versions.`);
  }
  if (!contents.split(/\r?\n/).some((line) => line.includes("--hash=sha256:"))) {
    throw new Error(`${target.outputFile} does not contain --hash=sha256 entries.`);
  }
}
