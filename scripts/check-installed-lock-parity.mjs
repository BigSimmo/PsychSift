#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

export const criticalInstalledPackages = ["next", "react", "react-dom", "eslint", "playwright", "typescript", "vitest"];
export const installedTreeStampName = ".codex-installed-tree.json";

const STAMP_SCHEMA = 1;
const VOLATILE_DIRECTORIES = new Set([".cache", ".tmp", ".vite", ".vite-temp"]);

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function packageEntries(lock) {
  return Object.entries(lock.packages ?? {}).filter(
    ([packagePath, entry]) => packagePath.startsWith("node_modules/") && entry?.version,
  );
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

export function packageLockDigest(projectRoot) {
  return sha256(readFileSync(path.join(projectRoot, "package-lock.json")));
}

/**
 * npm's hidden lock records the concrete packages it actually installed. Match
 * that inventory to the project lock while allowing platform-specific optional
 * entries to remain absent.
 */
export function installedMetadataMatches(projectRoot) {
  const installedLockPath = path.join(projectRoot, "node_modules", ".package-lock.json");
  if (!existsSync(installedLockPath)) return false;

  try {
    const expectedPackages = new Map(packageEntries(readJson(path.join(projectRoot, "package-lock.json"))));
    const installedPackages = new Map(packageEntries(readJson(installedLockPath)));
    return (
      [...installedPackages].every(
        ([packagePath, entry]) => expectedPackages.get(packagePath)?.version === entry.version,
      ) &&
      [...expectedPackages].every(
        ([packagePath, entry]) => entry.optional || installedPackages.get(packagePath)?.version === entry.version,
      )
    );
  } catch {
    return false;
  }
}

/** Validate every concrete installed package location, including nested transitives. */
export function installedPackageLocationParity(projectRoot) {
  const installedLockPath = path.join(projectRoot, "node_modules", ".package-lock.json");
  let expected;
  let installed;
  try {
    expected = readJson(path.join(projectRoot, "package-lock.json"));
    installed = readJson(installedLockPath);
  } catch (error) {
    return [
      {
        packagePath: "node_modules",
        lockedVersion: null,
        installedVersion: null,
        ok: false,
        reason: `lock metadata is unavailable (${error instanceof Error ? error.message : String(error)})`,
      },
    ];
  }

  const expectedPackages = new Map(packageEntries(expected));
  const installedPackages = new Map(packageEntries(installed));
  const packagePaths = new Set([
    ...installedPackages.keys(),
    ...[...expectedPackages].filter(([, entry]) => !entry.optional).map(([packagePath]) => packagePath),
  ]);

  return [...packagePaths].sort().map((packagePath) => {
    const lockedVersion = expectedPackages.get(packagePath)?.version ?? null;
    const metadataVersion = installedPackages.get(packagePath)?.version ?? null;
    let installedVersion = null;
    let installedError = null;
    try {
      installedVersion = readJson(path.join(projectRoot, ...packagePath.split("/"), "package.json")).version ?? null;
    } catch (error) {
      installedError = error instanceof Error ? error.message : String(error);
    }

    const ok = Boolean(
      lockedVersion &&
      metadataVersion &&
      installedVersion &&
      lockedVersion === metadataVersion &&
      lockedVersion === installedVersion,
    );
    return {
      packagePath,
      lockedVersion,
      installedVersion,
      ok,
      reason: !lockedVersion
        ? "installed package is missing from package-lock.json"
        : !metadataVersion
          ? "required package is missing from node_modules/.package-lock.json"
          : !installedVersion
            ? `installed package is unavailable (${installedError ?? "unknown read error"})`
            : metadataVersion !== lockedVersion
              ? `installed metadata ${metadataVersion} does not match locked ${lockedVersion}`
              : installedVersion !== lockedVersion
                ? `installed ${installedVersion} does not match locked ${lockedVersion}`
                : null,
    };
  });
}

/**
 * Build a cheap structural fingerprint. Every path is included, so deleting an
 * arbitrary non-entry file changes the digest. Declaration and native-binary
 * sizes are included as well, catching the measured zero-byte extraction case
 * without reading nearly a gigabyte of dependency contents on every gate.
 */
export function installedTreeInventory(projectRoot) {
  const nodeModulesRoot = path.join(projectRoot, "node_modules");
  const digest = createHash("sha256");
  let fileCount = 0;
  let directoryCount = 0;
  let sizeTrackedFileCount = 0;

  function walk(directory, relativeDirectory = "") {
    const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    for (const entry of entries) {
      const isVolatileDirectory = entry.isDirectory() && VOLATILE_DIRECTORIES.has(entry.name);
      if (entry.name === installedTreeStampName || isVolatileDirectory) {
        continue;
      }
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        digest.update(`L\0${relativePath}\0`);
      } else if (entry.isDirectory()) {
        directoryCount += 1;
        digest.update(`D\0${relativePath}\0`);
        walk(absolutePath, relativePath);
      } else if (entry.isFile()) {
        fileCount += 1;
        digest.update(`F\0${relativePath}\0`);
        if (relativePath.endsWith(".d.ts") || relativePath.endsWith(".node")) {
          const size = statSync(absolutePath).size;
          sizeTrackedFileCount += 1;
          digest.update(`S\0${size}\0`);
        }
      }
    }
  }

  walk(nodeModulesRoot);
  return { digest: digest.digest("hex"), fileCount, directoryCount, sizeTrackedFileCount };
}

/**
 * Why a tree is too empty to be an install, or null. Every other parity check compares the tree
 * with the lock, the stamp and npm's hidden lock, so it passes vacuously when all of them describe
 * nothing — a lock with no packages, a stamp written over an empty tree, or a stamp and hidden lock
 * copied without the packages. Require at least one verified package location, at least one
 * installed file, and every critical toolchain package the project lock declares.
 */
export function emptyInstallReason(projectRoot, packageLocations, inventory) {
  if (!packageLocations.some((result) => result.ok)) {
    return "no installed package location was verified; node_modules is empty or missing";
  }
  if (inventory && inventory.fileCount === 0) return "node_modules contains no installed files";
  let lock;
  try {
    lock = readJson(path.join(projectRoot, "package-lock.json"));
  } catch {
    return "package-lock.json is unreadable";
  }
  const declared = criticalInstalledPackages.filter((name) => lock.packages?.[`node_modules/${name}`]?.version);
  const missing = installedLockParity(projectRoot, declared).filter((result) => !result.ok);
  return missing.length > 0
    ? `critical package(s) not installed: ${missing.map((result) => result.packageName).join(", ")}`
    : null;
}

export function writeInstalledTreeStamp(projectRoot) {
  const locationResults = installedPackageLocationParity(projectRoot);
  const failures = locationResults.filter((result) => !result.ok);
  if (failures.length > 0 || !installedMetadataMatches(projectRoot)) {
    throw new Error("Cannot stamp dependencies whose package metadata does not match package-lock.json.");
  }

  const inventory = installedTreeInventory(projectRoot);
  const emptyReason = emptyInstallReason(projectRoot, locationResults, inventory);
  if (emptyReason) throw new Error(`Cannot stamp an incomplete install: ${emptyReason}.`);
  const stamp = {
    schema: STAMP_SCHEMA,
    lockSha256: packageLockDigest(projectRoot),
    ...inventory,
  };
  const stampPath = path.join(projectRoot, "node_modules", installedTreeStampName);
  const temporaryPath = `${stampPath}.${process.pid}.tmp`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(stamp, null, 2)}\n`);
    renameSync(temporaryPath, stampPath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
  return stamp;
}

export function installedTreeParity(projectRoot) {
  const packageLocations = installedPackageLocationParity(projectRoot);
  const packageFailures = packageLocations.filter((result) => !result.ok);
  const stampPath = path.join(projectRoot, "node_modules", installedTreeStampName);
  let stamp = null;
  try {
    stamp = readJson(stampPath);
  } catch (error) {
    return {
      ok: false,
      reason: `trusted install stamp is unavailable (${error instanceof Error ? error.message : String(error)})`,
      packageLocations,
    };
  }

  if (stamp.schema !== STAMP_SCHEMA) {
    return { ok: false, reason: `install stamp schema ${stamp.schema ?? "missing"} is unsupported`, packageLocations };
  }
  if (stamp.lockSha256 !== packageLockDigest(projectRoot)) {
    return { ok: false, reason: "install stamp belongs to a different package-lock.json", packageLocations };
  }
  if (packageFailures.length > 0 || !installedMetadataMatches(projectRoot)) {
    return {
      ok: false,
      reason: `${packageFailures.length || 1} installed package location(s) do not match`,
      packageLocations,
    };
  }

  const inventory = installedTreeInventory(projectRoot);
  if (
    inventory.digest !== stamp.digest ||
    inventory.fileCount !== stamp.fileCount ||
    inventory.directoryCount !== stamp.directoryCount ||
    inventory.sizeTrackedFileCount !== stamp.sizeTrackedFileCount
  ) {
    return {
      ok: false,
      reason: "installed file inventory differs from the trusted post-install stamp",
      packageLocations,
      inventory,
    };
  }

  const emptyReason = emptyInstallReason(projectRoot, packageLocations, inventory);
  if (emptyReason) return { ok: false, reason: emptyReason, packageLocations, inventory };

  return { ok: true, reason: null, packageLocations, inventory };
}

export function installedLockParity(projectRoot, packageNames = criticalInstalledPackages) {
  const lockPath = path.join(projectRoot, "package-lock.json");
  const lock = readJson(lockPath);

  return packageNames.map((packageName) => {
    const lockEntry = lock.packages?.[`node_modules/${packageName}`];
    const installedPath = path.join(projectRoot, "node_modules", ...packageName.split("/"), "package.json");
    let installedVersion = null;
    let installedError = null;

    try {
      installedVersion = readJson(installedPath).version ?? null;
    } catch (error) {
      installedError = error instanceof Error ? error.message : String(error);
    }

    const lockedVersion = lockEntry?.version ?? null;
    return {
      packageName,
      lockedVersion,
      installedVersion,
      ok: Boolean(lockedVersion && installedVersion && lockedVersion === installedVersion),
      reason: !lockedVersion
        ? "package is missing from package-lock.json"
        : !installedVersion
          ? `installed package is unavailable (${installedError ?? "unknown read error"})`
          : lockedVersion !== installedVersion
            ? `installed ${installedVersion} does not match locked ${lockedVersion}`
            : null,
    };
  });
}

function parseArgs(args) {
  const options = {
    json: false,
    root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
    writeStamp: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--json") {
      options.json = true;
      continue;
    }
    if (token === "--root") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--root requires a project directory.");
      options.root = path.resolve(value);
      index += 1;
      continue;
    }
    if (token === "--write-stamp") {
      options.writeStamp = true;
      continue;
    }
    if (token === "--help" || token === "-h") {
      console.log("Usage: npm run check:installed-lock-parity -- [--json] [--root directory] [--write-stamp]");
      process.exit(0);
    }
    throw new Error(`Unknown option: ${token}`);
  }
  return options;
}

function isDirectExecution() {
  return isDirectEntrypoint(import.meta.url);
}

if (isDirectExecution()) {
  const options = parseArgs(process.argv.slice(2));
  if (options.writeStamp) {
    if (process.env.npm_lifecycle_event !== "postinstall") {
      throw new Error("--write-stamp is reserved for the trusted npm postinstall lifecycle.");
    }
    const stamp = writeInstalledTreeStamp(options.root);
    console.log(`[installed-lock-parity] wrote trusted install stamp for ${stamp.fileCount} files.`);
    process.exit(0);
  }

  const results = installedLockParity(options.root);
  const tree = installedTreeParity(options.root);
  const failures = results.filter((result) => !result.ok);

  if (options.json) {
    console.log(JSON.stringify({ ok: failures.length === 0 && tree.ok, packages: results, tree }, null, 2));
  } else {
    for (const result of results) {
      if (result.ok) console.log(`[installed-lock-parity] ${result.packageName}: ${result.lockedVersion}`);
      else console.error(`[installed-lock-parity] ${result.packageName}: ${result.reason}`);
    }
    if (tree.ok) {
      console.log(
        `[installed-lock-parity] full tree: ${tree.packageLocations.length} package locations; ${tree.inventory.fileCount} files.`,
      );
    } else {
      console.error(`[installed-lock-parity] full tree: ${tree.reason}`);
    }
  }

  if (failures.length > 0 || !tree.ok) {
    console.error(
      "Installed dependencies do not match package-lock.json. Run npm ci before interpreting test failures.",
    );
    process.exit(1);
  }
}
