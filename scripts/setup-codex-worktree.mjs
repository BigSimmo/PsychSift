#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

import {
  installedMetadataMatches as fullInstalledMetadataMatches,
  installedTreeParity,
} from "./check-installed-lock-parity.mjs";

const logPrefix = "[codex-worktree:setup]";

function log(message) {
  console.log(`${logPrefix} ${message}`);
}

function fail(message) {
  console.error(`${logPrefix} ERROR: ${message}`);
  process.exit(1);
}

export function parseWorktreeList(output) {
  return output
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => path.resolve(line.slice("worktree ".length).trim()));
}

export function lockDigest(projectRoot) {
  return createHash("sha256")
    .update(readFileSync(path.join(projectRoot, "package-lock.json")))
    .digest("hex");
}

export function installedMetadataMatches(projectRoot) {
  return fullInstalledMetadataMatches(projectRoot);
}

export function installationIsComplete(projectRoot, packageNames) {
  void packageNames;
  try {
    return installedTreeParity(projectRoot).ok;
  } catch {
    return false;
  }
}

function samePath(left, right) {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

export function findDependencyDonor(worktrees, currentRoot, packageNames) {
  const expectedDigest = lockDigest(currentRoot);
  for (const candidate of worktrees) {
    if (samePath(candidate, currentRoot)) continue;
    if (!existsSync(path.join(candidate, "package-lock.json"))) continue;
    if (!existsSync(path.join(candidate, "node_modules"))) continue;
    try {
      if (lockDigest(candidate) !== expectedDigest) continue;
      if (installationIsComplete(candidate, packageNames)) return candidate;
    } catch {
      // A concurrently removed or incomplete worktree is not a donor.
    }
  }
  return null;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
    shell: false,
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.error) fail(`${command} could not start: ${result.error.message}`);
  return result;
}

export function resolveNpmCli(environment = process.env) {
  const candidates = [
    environment.APPDATA && path.join(environment.APPDATA, "npm", "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function runNpm(args, options = {}) {
  const npmCli = resolveNpmCli();
  if (npmCli) return run(process.execPath, [npmCli, ...args], options);
  if (process.platform === "win32") fail("Could not locate npm-cli.js for the active Windows Node runtime.");
  return run("npm", args, options);
}

export function nodeVersionSatisfiesRange(version, range) {
  const actualMatch = String(version).match(/^(\d+)\.(\d+)\.(\d+)$/u);
  const rangeMatch = String(range)
    .trim()
    .match(/^>=\s*(\d+)\.(\d+)\.(\d+)\s+<\s*(\d+)$/u);
  if (!actualMatch || !rangeMatch) return false;

  const actual = actualMatch.slice(1).map(Number);
  const minimum = rangeMatch.slice(1, 4).map(Number);
  const exclusiveMajor = Number(rangeMatch[4]);
  const belowMinimum = actual.some((part, index) => {
    if (part === minimum[index]) return false;
    return (
      actual.slice(0, index).every((value, prefixIndex) => value === minimum[prefixIndex]) && part < minimum[index]
    );
  });

  return !belowMinimum && actual[0] < exclusiveMajor;
}

function assertRuntime(projectRoot) {
  const expectedNodeMajor = readFileSync(path.join(projectRoot, ".node-version"), "utf8").trim();
  const packageJson = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));
  const expectedNodeRange = String(packageJson.engines?.node ?? "");
  const expectedNpm = String(packageJson.packageManager ?? "").replace(/^npm@/u, "");
  const npmResult = runNpm(["--version"], { cwd: projectRoot, capture: true });
  const actualNpm = npmResult.stdout?.trim();

  const declaredFloorMajor = expectedNodeRange.match(/^>=\s*(\d+)\./u)?.[1];
  if (declaredFloorMajor !== expectedNodeMajor) {
    fail(
      `package.json engines.node (${expectedNodeRange || "missing"}) must track .node-version (${expectedNodeMajor}).`,
    );
  }
  if (!nodeVersionSatisfiesRange(process.versions.node, expectedNodeRange)) {
    fail(`Node ${expectedNodeRange} is required; detected ${process.versions.node}.`);
  }
  if (npmResult.status !== 0 || actualNpm !== expectedNpm) {
    fail(`npm ${expectedNpm} is required; detected ${actualNpm || "unavailable"}.`);
  }
}

function removePartialInstall(projectRoot) {
  const target = path.resolve(projectRoot, "node_modules");
  const expected = path.join(path.resolve(projectRoot), "node_modules");
  if (!samePath(target, expected)) fail(`Refusing to remove unexpected dependency path ${target}.`);
  rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}

function copyDependencies(donor, projectRoot) {
  const source = path.join(donor, "node_modules");
  const destination = path.join(projectRoot, "node_modules");
  removePartialInstall(projectRoot);

  if (process.platform === "win32") {
    const excluded = [".cache", ".vite", ".tmp"].map((name) => path.join(source, name));
    const result = run(
      "robocopy.exe",
      [
        source,
        destination,
        "/E",
        "/COPY:DAT",
        "/DCOPY:DAT",
        "/R:2",
        "/W:1",
        "/MT:32",
        "/NFL",
        "/NDL",
        "/NP",
        "/XD",
        ...excluded,
      ],
      { cwd: projectRoot, capture: true },
    );
    if (result.status === null || result.status > 7) {
      fail(`robocopy failed with exit ${result.status ?? "unknown"}.\n${result.stderr || result.stdout || ""}`);
    }
    return;
  }

  cpSync(source, destination, {
    recursive: true,
    filter: (sourcePath) => ![".cache", ".vite", ".tmp"].includes(path.basename(sourcePath)),
  });
}

function installHooks(projectRoot) {
  const result = run(process.execPath, ["scripts/install-git-hooks.mjs"], { cwd: projectRoot });
  if (result.status !== 0) fail(`Git hook setup failed with exit ${result.status ?? "unknown"}.`);
}

export function main(projectRoot = process.cwd(), options = {}) {
  const root = path.resolve(projectRoot);
  if (!existsSync(path.join(root, ".git")) || !existsSync(path.join(root, "package-lock.json"))) {
    fail("Run this script from a Database worktree.");
  }
  assertRuntime(root);

  const currentInstallationComplete = installationIsComplete(root);
  // Name the checked root in every verdict: run from the wrong directory (a shell whose cwd reset to
  // the main checkout), this script reports on that checkout's dependencies, not the worktree's.
  if (options.dryRun && currentInstallationComplete) {
    log(`DRY RUN: existing dependencies in ${root} match package-lock.json.`);
    return;
  }
  if (currentInstallationComplete) {
    installHooks(root);
    log(`PASS: existing dependencies in ${root} match package-lock.json.`);
    return;
  }

  const worktreeResult = run("git", ["worktree", "list", "--porcelain"], { cwd: root, capture: true });
  if (worktreeResult.status !== 0) fail("Could not enumerate local Git worktrees.");
  const donor = findDependencyDonor(parseWorktreeList(worktreeResult.stdout), root);

  if (options.dryRun) {
    log(
      donor
        ? `DRY RUN: would reuse byte-identical dependencies from ${donor}.`
        : "DRY RUN: no complete byte-identical donor; would run locked npm installation.",
    );
    return;
  }

  if (donor) {
    log(`Reusing byte-identical dependencies from ${donor}.`);
    copyDependencies(donor, root);
  } else {
    log("No complete byte-identical local install found; running locked npm installation.");
    removePartialInstall(root);
    const installResult = runNpm(["ci", "--include=dev", "--prefer-offline", "--no-audit", "--no-fund"], {
      cwd: root,
    });
    if (installResult.status !== 0) fail(`npm ci failed with exit ${installResult.status ?? "unknown"}.`);
  }

  if (!installationIsComplete(root)) fail("Installed dependencies do not match package-lock.json.");
  installHooks(root);
  log(`PASS: worktree dependencies in ${root} match package-lock.json.`);
}

const isDirectExecution = isDirectEntrypoint(import.meta.url);
if (isDirectExecution) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--dry-run")) fail(`Unknown option: ${args.find((arg) => arg !== "--dry-run")}`);
  main(process.cwd(), { dryRun: args.includes("--dry-run") });
}
