#!/usr/bin/env node

/**
 * Cooperative primary-checkout write lease (#077).
 *
 * Prevents a second task from writing, switching, or synchronizing the
 * canonical primary checkout while another live owner holds the lease, or while
 * the primary is dirty / mid-operation. Read-only inspection and independent
 * feature worktrees do not acquire this lease and stay unblocked.
 *
 * This is intentionally not an OS-wide lock and never kills processes or discards work.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";
import { execFileSync } from "node:child_process";
import { redactSensitiveText } from "./sensitive-text.mjs";
import { reconciliationPreflightInternals } from "./reconciliation-preflight.mjs";

const defaultRepositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tokenEnvironmentKey = "CLINICAL_KB_PRIMARY_LEASE_TOKEN";
const pathEnvironmentKey = "CLINICAL_KB_PRIMARY_LEASE_PATH";
const { operationMarkers, normalizePath } = reconciliationPreflightInternals;

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function git(args, cwd, { allowFailure = false } = {}) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch (error) {
    if (allowFailure) return "";
    throw error;
  }
}

export function resolvePrimaryCheckoutPath(repositoryRoot = defaultRepositoryRoot) {
  const porcelain = git(["worktree", "list", "--porcelain"], repositoryRoot, { allowFailure: true });
  const match = porcelain.match(/^worktree (.+)$/m);
  if (!match) return path.resolve(repositoryRoot);
  return path.resolve(match[1]);
}

function resolveGitCommonDirectory(primaryPath) {
  const common = git(["rev-parse", "--path-format=absolute", "--git-common-dir"], primaryPath);
  if (!common) throw new Error("Could not resolve the shared Git directory for the primary-checkout lease.");
  return path.resolve(common);
}

function leaseFilePath({ gitCommonDirectory, baseDirectory }) {
  if (baseDirectory) {
    mkdirSync(baseDirectory, { recursive: true });
    return path.join(baseDirectory, "primary-checkout-lease.json");
  }
  return path.join(gitCommonDirectory, "clinical-kb-primary-checkout-lease.json");
}

function readLease(leasePath) {
  try {
    return JSON.parse(readFileSync(leasePath, "utf8"));
  } catch {
    return null;
  }
}

export function inspectPrimaryCheckoutState(primaryPath) {
  const resolved = path.resolve(primaryPath);
  const status = git(["status", "--porcelain=v1", "--untracked-files=normal"], resolved, { allowFailure: true });
  const gitDirectory = git(["rev-parse", "--path-format=absolute", "--git-dir"], resolved, { allowFailure: true });
  const head = git(["rev-parse", "HEAD"], resolved, { allowFailure: true }) || null;
  const branch = git(["branch", "--show-current"], resolved, { allowFailure: true }) || null;
  const statusEntries = status ? status.split(/\r?\n/).filter(Boolean).length : status === "" ? 0 : null;
  const operations =
    gitDirectory && existsSync(gitDirectory)
      ? operationMarkers.filter((marker) => existsSync(path.join(gitDirectory, marker)))
      : [];
  return {
    path: resolved,
    head,
    branch: branch || null,
    statusEntries,
    dirty: typeof statusEntries === "number" ? statusEntries > 0 : true,
    operations,
    inspectionFailed: statusEntries === null || !gitDirectory,
  };
}

function ownerIsLive(owner) {
  return Boolean(owner && processIsAlive(owner.pid));
}

/**
 * @param {{
 *   primaryPath?: string,
 *   repositoryRoot?: string,
 *   baseDirectory?: string,
 *   environment?: Record<string, string | undefined>,
 *   processId?: number,
 * }} [options]
 */
export function inspectPrimaryCheckoutLease({
  primaryPath,
  repositoryRoot = defaultRepositoryRoot,
  baseDirectory,
  environment = process.env,
  processId = process.pid,
} = {}) {
  const resolvedPrimary = path.resolve(primaryPath ?? resolvePrimaryCheckoutPath(repositoryRoot));
  const gitCommonDirectory = resolveGitCommonDirectory(resolvedPrimary);
  const leasePath = leaseFilePath({ gitCommonDirectory, baseDirectory });
  const primary = inspectPrimaryCheckoutState(resolvedPrimary);
  const owner = readLease(leasePath);
  const inheritedToken = environment[tokenEnvironmentKey];
  const inheritedPath = environment[pathEnvironmentKey];
  const sameOwner =
    Boolean(inheritedToken) &&
    normalizePath(inheritedPath) === normalizePath(leasePath) &&
    owner?.token === inheritedToken &&
    ownerIsLive(owner);
  const liveForeignOwner = Boolean(owner && ownerIsLive(owner) && !sameOwner);
  const staleOwner = Boolean(owner && !ownerIsLive(owner));
  const blockers = [];

  if (primary.inspectionFailed) {
    blockers.push({
      code: "primary-inspection-failed",
      detail: "The primary checkout could not be inspected completely.",
    });
  }
  if (primary.dirty) {
    blockers.push({
      code: "primary-dirty",
      detail: "The primary checkout has tracked or untracked changes.",
    });
  }
  if (primary.operations.length > 0) {
    blockers.push({
      code: "active-git-operation",
      detail: `Active Git operation marker(s): ${primary.operations.join(", ")}.`,
    });
  }
  if (liveForeignOwner) {
    blockers.push({
      code: "lease-held",
      detail: `Primary write lease held by PID ${owner.pid} (${redactSensitiveText(owner.purpose ?? "unknown")}).`,
    });
  }

  return {
    primaryPath: resolvedPrimary,
    leasePath,
    primary,
    owner: owner
      ? {
          ...owner,
          purpose: redactSensitiveText(owner.purpose ?? ""),
          alive: ownerIsLive(owner),
          stale: staleOwner,
        }
      : null,
    sameOwner,
    writeAllowed: blockers.length === 0 || sameOwner,
    readOnlyAllowed: true,
    featureWorktreesUnaffected: true,
    blockers,
    inspectedByPid: processId,
  };
}

/**
 * @param {{
 *   primaryPath?: string,
 *   repositoryRoot?: string,
 *   baseDirectory?: string,
 *   environment?: Record<string, string | undefined>,
 *   processId?: number,
 *   ownerLabel?: string,
 *   purpose?: string,
 * }} [options]
 */
export function acquirePrimaryCheckoutLease({
  primaryPath,
  repositoryRoot = defaultRepositoryRoot,
  baseDirectory,
  environment = process.env,
  processId = process.pid,
  ownerLabel = "task",
  purpose = "primary-write",
} = {}) {
  const inspection = inspectPrimaryCheckoutLease({
    primaryPath,
    repositoryRoot,
    baseDirectory,
    environment,
    processId,
  });

  if (inspection.sameOwner && inspection.owner) {
    return {
      path: inspection.leasePath,
      owner: inspection.owner,
      reentrant: true,
      environment: { ...environment },
      release() {},
    };
  }

  if (inspection.blockers.some((item) => item.code !== "lease-held")) {
    const detail = inspection.blockers.map((item) => item.detail).join(" ");
    throw new Error(`Primary checkout write refused: ${detail}`);
  }

  if (inspection.owner && inspection.owner.alive) {
    throw new Error(
      `Primary checkout write refused: lease held by PID ${inspection.owner.pid} (${redactSensitiveText(inspection.owner.purpose ?? "unknown")}).`,
    );
  }

  if (inspection.owner && !inspection.owner.alive && existsSync(inspection.leasePath)) {
    rmSync(inspection.leasePath, { force: true });
  }

  const token = randomUUID();
  const owner = {
    pid: processId,
    token,
    ownerLabel: redactSensitiveText(ownerLabel),
    purpose: redactSensitiveText(purpose),
    primaryPath: inspection.primaryPath,
    startedAt: new Date().toISOString(),
  };
  writeFileSync(inspection.leasePath, `${JSON.stringify(owner, null, 2)}\n`, "utf8");

  let released = false;
  return {
    path: inspection.leasePath,
    owner,
    reentrant: false,
    environment: {
      ...environment,
      [tokenEnvironmentKey]: token,
      [pathEnvironmentKey]: inspection.leasePath,
    },
    release() {
      if (released) return;
      released = true;
      const current = readLease(inspection.leasePath);
      if (current?.token === token) rmSync(inspection.leasePath, { force: true });
    },
  };
}

export function assertPrimaryWriteAllowed(options = {}) {
  const inspection = inspectPrimaryCheckoutLease(options);
  if (!inspection.writeAllowed) {
    const detail = inspection.blockers.map((item) => `${item.code}: ${item.detail}`).join("; ");
    throw new Error(`Primary checkout write refused (${detail})`);
  }
  return inspection;
}

function releasePrimaryCheckoutLeaseByToken({ primaryPath, repositoryRoot, baseDirectory, token }) {
  const inspection = inspectPrimaryCheckoutLease({ primaryPath, repositoryRoot, baseDirectory, environment: {} });
  const current = readLease(inspection.leasePath);
  if (!current) return { released: false, detail: "no-lease" };
  if (current.token !== token) throw new Error("Primary checkout lease token does not match the active owner.");
  rmSync(inspection.leasePath, { force: true });
  return { released: true, path: inspection.leasePath };
}

function parseArgs(argv) {
  const options = {
    check: false,
    acquire: false,
    release: false,
    json: false,
    ownerLabel: "task",
    purpose: "primary-write",
    primaryPath: undefined,
    token: undefined,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) throw new Error(`Missing value for ${token}`);
      index += 1;
      return value;
    };
    if (token === "--check") options.check = true;
    else if (token === "--acquire") options.acquire = true;
    else if (token === "--release") options.release = true;
    else if (token === "--json") options.json = true;
    else if (token === "--owner") options.ownerLabel = next();
    else if (token === "--purpose") options.purpose = next();
    else if (token === "--primary") options.primaryPath = next();
    else if (token === "--token") options.token = next();
    else if (token === "--help" || token === "-h") options.help = true;
    else throw new Error(`Unknown option: ${token}`);
  }
  const modes = [options.check, options.acquire, options.release].filter(Boolean).length;
  if (!options.help && modes === 0) options.check = true;
  if (!options.help && modes > 1) throw new Error("Use only one of --check, --acquire, or --release.");
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(
      "Usage: node scripts/primary-checkout-lease.mjs [--check|--acquire|--release] [--json] [--primary <path>] [--owner <label>] [--purpose <text>] [--token <token>]",
    );
    return;
  }
  if (options.release) {
    if (!options.token) throw new Error("Missing --token for --release");
    const result = releasePrimaryCheckoutLeaseByToken({
      primaryPath: options.primaryPath,
      token: options.token,
    });
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else console.log(result.released ? `Released primary checkout lease at ${result.path}` : "No lease to release.");
    return;
  }
  if (options.acquire) {
    const lease = acquirePrimaryCheckoutLease({
      primaryPath: options.primaryPath,
      ownerLabel: options.ownerLabel,
      purpose: options.purpose,
    });
    const payload = {
      acquired: true,
      reentrant: lease.reentrant,
      path: lease.path,
      owner: lease.owner,
      environment: {
        [tokenEnvironmentKey]: lease.environment[tokenEnvironmentKey],
        [pathEnvironmentKey]: lease.environment[pathEnvironmentKey],
      },
    };
    if (options.json) console.log(JSON.stringify(payload, null, 2));
    else {
      console.log(`Primary checkout lease acquired (PID ${lease.owner.pid}).`);
      console.log(`Lease path: ${lease.path}`);
      console.log(`Export ${tokenEnvironmentKey}=${lease.owner.token}`);
      console.log(`Export ${pathEnvironmentKey}=${lease.path}`);
      console.log(`Release with: node scripts/primary-checkout-lease.mjs --release --token ${lease.owner.token}`);
    }
    return;
  }

  const inspection = inspectPrimaryCheckoutLease({ primaryPath: options.primaryPath });
  if (options.json) console.log(JSON.stringify(inspection, null, 2));
  else {
    console.log("Primary checkout write lease check (cooperative; read-only worktrees unaffected)\n");
    console.log(`Primary: ${inspection.primaryPath}`);
    console.log(`Write allowed: ${inspection.writeAllowed}`);
    console.log(
      `Dirty: ${inspection.primary.dirty}; operations: ${inspection.primary.operations.join(", ") || "none"}`,
    );
    if (inspection.owner) {
      console.log(
        `Owner: PID ${inspection.owner.pid} alive=${inspection.owner.alive} stale=${inspection.owner.stale} purpose=${inspection.owner.purpose}`,
      );
    } else {
      console.log("Owner: none");
    }
    console.log("\nBlockers:");
    if (!inspection.blockers.length) console.log("- none");
    for (const blocker of inspection.blockers) console.log(`- ${blocker.code}: ${blocker.detail}`);
  }
  if (!inspection.writeAllowed) process.exitCode = 2;
}

const invokedDirectly = isDirectEntrypoint(import.meta.url);
if (invokedDirectly) {
  try {
    main();
  } catch (error) {
    console.error(`[primary-checkout-lease] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

export const primaryCheckoutLeaseInternals = {
  tokenEnvironmentKey,
  pathEnvironmentKey,
  processIsAlive,
  leaseFilePath,
  readLease,
};
