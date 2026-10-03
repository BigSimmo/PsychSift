#!/usr/bin/env node

/**
 * Safe orphan worktree pruning and reporting tool for the PsychSift repository.
 *
 * Task: #6GW95D - Safe orphan worktree pruning and reporting tool.
 *
 * This module cross-references `git worktree list --porcelain` with workspace directories,
 * distinguishes active, stale, and untracked/orphan worktrees, defaults to dry-run (report-only),
 * and enforces 3 strict safety invariants before any destructive directory cleanup:
 *   1. Branch check: merged into base or pushed to upstream remote.
 *   2. Status check: 0 uncommitted or untracked changes (`git status --porcelain --untracked-files=all`).
 *   3. Liveness check: fail-closed if any process is active or if liveness is unknown.
 * Plus Win32 reparse-point and directory-junction safety guards.
 */

import { spawnSync } from "node:child_process";
import { lstatSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";
import {
  classifyLiveness,
  inspectReparsePoint,
  normalizeWorktreePath,
  parseWorktreePorcelain,
} from "./clean-worktree.mjs";
import { inspectPathSegmentsForReparse } from "./worktree-inventory.mjs";

const READ_ONLY_GIT_ENV = Object.freeze({
  GIT_OPTIONAL_LOCKS: "0",
  GIT_NO_LAZY_FETCH: "1",
  GIT_LITERAL_PATHSPECS: "1",
  GIT_PAGER: "cat",
});

const OBJECT_ID = /^[0-9a-f]{40,64}$/i;

function sanitizedCode(value, fallback = "UNKNOWN") {
  const text = String(value ?? "").trim();
  return /^[A-Za-z0-9_.-]{1,40}$/.test(text) ? text : fallback;
}

function parseNulValues(value) {
  return String(value ?? "")
    .split("\0")
    .filter(Boolean);
}

function isSafeRevisionInput(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    value.trim() === value &&
    !/[\0\r\n]/.test(value)
  );
}

function isCommitSpec(value) {
  return isSafeRevisionInput(value) && value.endsWith("^{commit}") && value.length > "^{commit}".length;
}

function isSameOrAncestor(candidate, target) {
  const relative = path.relative(path.resolve(candidate), path.resolve(target));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

/**
 * Allow only safe Git commands needed for worktree auditing and pruning.
 * @param {string[]} args
 * @param {{ allowPrune?: boolean }} [options]
 */
export function assertSafeGitArgs(args, { allowPrune = false } = {}) {
  if (!Array.isArray(args) || args.length === 0 || args.some((item) => typeof item !== "string")) {
    throw new Error("Rejected by safe Git boundary: invalid argument vector.");
  }

  const [command, ...rest] = args;
  const exact = (...expected) =>
    rest.length === expected.length && rest.every((value, index) => value === expected[index]);
  const validObjectPair = (left, right) => OBJECT_ID.test(left ?? "") && OBJECT_ID.test(right ?? "");

  let allowed = false;
  if (command === "worktree") {
    allowed =
      exact("list", "--porcelain", "-z") ||
      exact("list", "--porcelain") ||
      exact("prune", "--dry-run", "-v") ||
      (allowPrune && exact("prune", "-v")) ||
      (allowPrune && exact("prune"));
  } else if (command === "rev-parse") {
    allowed =
      exact("--show-toplevel") ||
      exact("--path-format=absolute", "--git-common-dir") ||
      exact("HEAD") ||
      exact("--is-shallow-repository") ||
      (rest.length === 4 &&
        rest[0] === "--verify" &&
        rest[1] === "--quiet" &&
        rest[2] === "--end-of-options" &&
        isCommitSpec(rest[3]));
  } else if (command === "merge-base") {
    allowed =
      (rest.length === 3 && rest[0] === "--is-ancestor" && validObjectPair(rest[1], rest[2])) ||
      (rest.length === 2 && validObjectPair(rest[0], rest[1]));
  } else if (command === "status") {
    allowed = exact("--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=none");
  } else if (command === "symbolic-ref") {
    allowed = exact("--quiet", "--short", "HEAD");
  } else if (command === "branch") {
    allowed = rest.length === 3 && rest[0] === "-r" && rest[1] === "--contains" && OBJECT_ID.test(rest[2]);
  } else if (command === "remote") {
    allowed = exact("get-url", "origin");
  }

  if (!allowed) {
    throw new Error(`Rejected by safe Git boundary: ${command} ${rest.join(" ")}.`);
  }
}

/**
 * Execute Git with safe environment and strict argument boundary.
 * @param {string[]} args
 * @param {{ cwd?: string, runner?: typeof spawnSync, allowPrune?: boolean }} [options]
 */
export function runGit(args, { cwd = process.cwd(), runner = spawnSync, allowPrune = false } = {}) {
  assertSafeGitArgs(args, { allowPrune });
  const result = runner("git", ["--no-optional-locks", "--literal-pathspecs", "-c", "core.fsmonitor=false", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: { ...process.env, ...READ_ONLY_GIT_ENV },
  });
  const rawStdout = String(result?.stdout ?? "");
  const stdout = args.includes("-z") ? rawStdout : rawStdout.trim();

  if (result?.error) {
    return {
      ok: false,
      code: null,
      stdout: "",
      category: "spawn-error",
      errorCode: sanitizedCode(result.error.code),
    };
  }
  if (result?.status !== 0) {
    return {
      ok: false,
      code: Number.isInteger(result?.status) ? result.status : null,
      stdout: "",
      category: "git-exit",
      errorCode: sanitizedCode(result?.status, "UNKNOWN_EXIT"),
    };
  }
  return { ok: true, code: 0, stdout };
}

function requiredValue(argv, index, name) {
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) throw new Error(`Missing value for ${name}.`);
  return value;
}

/**
 * @param {string[]} argv
 */
export function parseCleanupArgs(argv) {
  const tokens = Array.isArray(argv) ? argv : [];
  const roots = [];
  const options = {
    dryRun: true,
    apply: false,
    force: false,
    help: false,
    selfTest: false,
    json: false,
    baseRef: "origin/main",
    remote: "origin",
    roots,
    repositoryRoot: path.resolve(process.cwd()),
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--help" || token === "-h") {
      options.help = true;
    } else if (token === "--self-test") {
      options.selfTest = true;
    } else if (token === "--json") {
      options.json = true;
    } else if (token === "--dry-run") {
      options.dryRun = true;
      options.apply = false;
    } else if (token === "--apply") {
      options.apply = true;
      options.dryRun = false;
    } else if (token === "--force" || token === "-f") {
      options.force = true;
      options.apply = true;
      options.dryRun = false;
    } else if (token === "--root") {
      roots.push(path.resolve(requiredValue(tokens, index, "--root")));
      index += 1;
    } else if (token.startsWith("--root=")) {
      const val = token.slice("--root=".length);
      if (!val) throw new Error("Missing value for --root.");
      roots.push(path.resolve(val));
    } else if (token === "--base") {
      options.baseRef = requiredValue(tokens, index, "--base");
      index += 1;
    } else if (token.startsWith("--base=")) {
      options.baseRef = token.slice("--base=".length);
      if (!options.baseRef) throw new Error("Missing value for --base.");
    } else if (token === "--remote") {
      options.remote = requiredValue(tokens, index, "--remote");
      index += 1;
    } else if (token.startsWith("--remote=")) {
      options.remote = token.slice("--remote=".length);
      if (!options.remote) throw new Error("Missing value for --remote.");
    } else if (token === "--repository") {
      options.repositoryRoot = path.resolve(requiredValue(tokens, index, "--repository"));
      index += 1;
    } else if (token.startsWith("--repository=")) {
      options.repositoryRoot = path.resolve(token.slice("--repository=".length));
    } else {
      throw new Error(`Unknown argument: ${token}. Run with --help for usage.`);
    }
  }

  // Deduplicate and normalize roots
  const uniqueRoots = new Map();
  for (const root of roots) {
    uniqueRoots.set(normalizeWorktreePath(root), path.resolve(root));
  }
  options.roots = [...uniqueRoots.values()];

  return options;
}

/**
 * Safety Invariant 1: Branch Check
 * Must be merged into baseRef OR pushed to upstream remote.
 * @param {string} candidatePath
 * @param {{ baseRef?: string, remote?: string, gitFn?: (args: string[], options?: any) => any }} [options]
 */
export function checkBranchSafety(candidatePath, { baseRef = "origin/main", remote = "origin", gitFn = runGit } = {}) {
  const resolvedPath = path.resolve(candidatePath);

  // Check if it's a git repo/worktree
  const headResult = gitFn(["rev-parse", "HEAD"], { cwd: resolvedPath });
  if (!headResult.ok || !OBJECT_ID.test(headResult.stdout)) {
    // Check if directory has no git files at all
    return {
      safe: false,
      state: "unknown-or-corrupt-git",
      reason: "HEAD commit could not be determined",
    };
  }

  const headCommit = headResult.stdout;

  // 1a. Check if merged into baseRef
  const baseCommitResult = gitFn(["rev-parse", "--verify", "--quiet", "--end-of-options", `${baseRef}^{commit}`], {
    cwd: resolvedPath,
  });

  if (baseCommitResult.ok && OBJECT_ID.test(baseCommitResult.stdout)) {
    const baseCommit = baseCommitResult.stdout;
    const isAncestor = gitFn(["merge-base", "--is-ancestor", headCommit, baseCommit], { cwd: resolvedPath });
    if (isAncestor.ok) {
      return {
        safe: true,
        state: "merged-to-base",
        basis: `Merged into ${baseRef} (${baseCommit.slice(0, 8)})`,
        headCommit,
      };
    }
  }

  // 1b. Check if pushed to upstream remote
  const remoteBranchResult = gitFn(["branch", "-r", "--contains", headCommit], { cwd: resolvedPath });
  if (remoteBranchResult.ok && remoteBranchResult.stdout) {
    const remoteBranches = remoteBranchResult.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith(`${remote}/`) || line.includes(`/${remote}/`));

    if (remoteBranches.length > 0) {
      return {
        safe: true,
        state: "pushed-to-remote",
        basis: `Pushed to upstream remote (${remoteBranches.join(", ")})`,
        headCommit,
        remoteBranches,
      };
    }
  }

  return {
    safe: false,
    state: "unmerged-unpushed",
    reason: `Branch at ${headCommit.slice(0, 8)} is neither merged into ${baseRef} nor found on remote ${remote}`,
    headCommit,
  };
}

/**
 * Safety Invariant 2: Status Check
 * Must have 0 uncommitted changes and 0 untracked files.
 * @param {string} candidatePath
 * @param {{ gitFn?: (args: string[], options?: any) => any, lstatFn?: (p: string) => any, readdirFn?: (p: string, options?: any) => any }} [options]
 */
export function checkStatusSafety(
  candidatePath,
  { gitFn = runGit, lstatFn = lstatSync, readdirFn = readdirSync } = {},
) {
  const resolvedPath = path.resolve(candidatePath);

  // Check if directory exists
  try {
    const stat = lstatFn(resolvedPath);
    if (!stat.isDirectory()) {
      return { safe: false, state: "not-directory", reason: "Target is not a directory", dirtyCount: 0 };
    }
  } catch (error) {
    return { safe: false, state: "missing", reason: `Directory inaccessible: ${error?.message}`, dirtyCount: 0 };
  }

  // Run git status
  const statusResult = gitFn(["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=none"], {
    cwd: resolvedPath,
  });

  if (!statusResult.ok) {
    // Non-git directory: check if it is completely empty
    try {
      const entries = readdirFn(resolvedPath);
      if (entries.length === 0) {
        return { safe: true, state: "clean-empty-directory", dirtyCount: 0, basis: "Directory is completely empty" };
      }
      return {
        safe: false,
        state: "non-git-with-files",
        reason: `Non-git directory contains ${entries.length} untracked file(s)`,
        dirtyCount: entries.length,
      };
    } catch {
      return { safe: false, state: "status-failed", reason: "git status failed and readdir failed", dirtyCount: -1 };
    }
  }

  const entries = parseNulValues(statusResult.stdout);
  if (entries.length === 0) {
    return { safe: true, state: "clean", dirtyCount: 0, basis: "0 uncommitted or untracked changes" };
  }

  return {
    safe: false,
    state: "dirty",
    dirtyCount: entries.length,
    reason: `Directory has ${entries.length} uncommitted or untracked changes`,
  };
}

/**
 * Safety Invariant 3: Liveness Check
 * Fail-closed unless explicitly and authoritatively proven inactive.
 * @param {string} candidatePath
 * @param {{ currentCwd?: string, livenessResolver?: (path: string) => any }} [options]
 */
export function checkLivenessSafety(
  candidatePath,
  { currentCwd = process.cwd(), livenessResolver = () => undefined } = {},
) {
  const resolved = path.resolve(candidatePath);
  const normalizedCandidate = normalizeWorktreePath(resolved);
  const normalizedCurrent = normalizeWorktreePath(path.resolve(currentCwd));

  // Current working directory or parent of current working directory is always active
  if (normalizedCandidate === normalizedCurrent || isSameOrAncestor(resolved, currentCwd)) {
    return {
      safe: false,
      state: "active",
      reason: "Current active process working directory",
    };
  }

  let evidence;
  try {
    evidence = livenessResolver(resolved);
  } catch (error) {
    return {
      safe: false,
      state: "unknown",
      reason: `Liveness resolution error: ${error?.message}`,
    };
  }

  const classified = classifyLiveness(evidence);
  if (classified.state === "active") {
    return {
      safe: false,
      state: "active",
      reason: `Active process detected (${classified.source ?? "process-match"})`,
    };
  }

  if (classified.state === "inactive") {
    return {
      safe: true,
      state: "inactive",
      basis: `Authoritatively confirmed inactive by ${classified.source}`,
    };
  }

  // Fail-closed rule: absence of evidence is not proof of inactivity
  return {
    safe: false,
    state: "unknown",
    reason: "Liveness unknown (fail-closed: unverified process handles)",
  };
}

/**
 * Safety Guard 4: Win32 Reparse Point / Junction Check
 * @param {string} candidatePath
 * @param {{ lstatFn?: (p: string) => any, platform?: string, reparseProbeFn?: (p: string, stat: any, opts?: any) => any, inspectPathSegmentsFn?: (p: string, opts?: any) => any }} [options]
 */
export function checkReparseSafety(
  candidatePath,
  {
    lstatFn = lstatSync,
    platform = process.platform,
    reparseProbeFn = inspectReparsePoint,
    inspectPathSegmentsFn = inspectPathSegmentsForReparse,
  } = {},
) {
  const resolved = path.resolve(candidatePath);

  let stat;
  try {
    stat = lstatFn(resolved);
  } catch (error) {
    return { safe: false, state: "missing", reason: `Cannot lstat target: ${error?.message}` };
  }

  const probe = reparseProbeFn(resolved, stat, { platform });
  if (probe?.state === "reparse") {
    return {
      safe: false,
      state: "reparse-boundary",
      reason: `Path is a reparse point / junction (${probe.code ?? "REPARSE"})`,
    };
  }
  if (probe?.state !== "safe") {
    return {
      safe: false,
      state: "unknown-reparse",
      reason: `Reparse point check failed (${probe?.code ?? "UNKNOWN"})`,
    };
  }

  const segmentCheck = inspectPathSegmentsFn(resolved, { lstatFn, platform });
  if (segmentCheck?.state !== "safe") {
    return {
      safe: false,
      state: "ancestor-reparse-boundary",
      reason: `Ancestor path segment contains reparse boundary (${segmentCheck?.code ?? "REPARSE"})`,
    };
  }

  return { safe: true, state: "safe", basis: "Verified non-reparse local directory" };
}

/**
 * Main Worktree Auditor & Cleaner
 * @param {Record<string, any>} [options]
 * @param {Record<string, any>} [adapters]
 */
export function auditAndCleanWorktrees(options = {}, adapters = {}) {
  const dryRun = options.dryRun !== false && !options.apply;
  const apply = options.apply === true || options.force === true;
  const baseRef = options.baseRef ?? "origin/main";
  const remote = options.remote ?? "origin";
  const gitFn = adapters.gitFn ?? runGit;
  const lstatFn = adapters.lstatFn ?? lstatSync;
  const readdirFn = adapters.readdirFn ?? readdirSync;
  const rmFn = adapters.rmFn ?? rmSync;
  const livenessResolver = adapters.livenessResolver ?? (() => undefined);
  const reparseProbeFn = adapters.reparseProbeFn ?? inspectReparsePoint;
  const inspectPathSegmentsFn = adapters.inspectPathSegmentsFn ?? inspectPathSegmentsForReparse;
  const platform = adapters.platform ?? process.platform;
  const repositoryRoot = path.resolve(options.repositoryRoot ?? process.cwd());

  const inspectionErrors = [];
  const registeredActive = [];
  const staleRegistered = [];
  const untrackedOrphans = [];

  // 1. Query Git Worktree List
  const listResult = gitFn(["worktree", "list", "--porcelain", "-z"], { cwd: repositoryRoot });
  let descriptors = [];
  if (listResult.ok) {
    descriptors = parseWorktreePorcelain(listResult.stdout);
  } else {
    // Fallback without -z
    const plainResult = gitFn(["worktree", "list", "--porcelain"], { cwd: repositoryRoot });
    if (plainResult.ok) {
      descriptors = parseWorktreePorcelain(plainResult.stdout);
    } else {
      inspectionErrors.push({
        category: "worktree-list-failed",
        code: sanitizedCode(listResult.errorCode ?? listResult.code),
        message: "Failed to retrieve git worktree list",
      });
    }
  }

  // 2. Query git worktree prune preview
  const prunePreview = gitFn(["worktree", "prune", "--dry-run", "-v"], { cwd: repositoryRoot });
  const prunablePathsFromGit = new Set();
  if (prunePreview.ok && prunePreview.stdout) {
    const lines = prunePreview.stdout.split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      // e.g. "Removing worktrees/foo: gitdir file points to non-existent location"
      const match = /(?:Removing|prunable)\s+([^\s:]+)/i.exec(line);
      if (match) {
        prunablePathsFromGit.add(normalizeWorktreePath(path.resolve(repositoryRoot, match[1])));
      }
    }
  }

  // Map of registered worktree paths
  const registeredPathMap = new Map();
  for (let index = 0; index < descriptors.length; index += 1) {
    const desc = descriptors[index];
    const resolvedPath = path.resolve(desc.path);
    const normalized = normalizeWorktreePath(resolvedPath);
    registeredPathMap.set(normalized, { desc, index, resolvedPath });
  }

  // Classify registered worktrees
  for (const { desc, index, resolvedPath } of registeredPathMap.values()) {
    let existsOnDisk = false;

    try {
      lstatFn(resolvedPath);
      existsOnDisk = true;
    } catch {
      // Missing from disk
    }

    const isPrunable =
      Boolean(desc.prunable) || !existsOnDisk || prunablePathsFromGit.has(normalizeWorktreePath(resolvedPath));

    if (isPrunable) {
      // Category B: Stale registered worktree
      staleRegistered.push({
        path: resolvedPath,
        classification: "stale-registered",
        branch: desc.branch?.replace(/^refs\/heads\//, "") ?? null,
        head: desc.head ?? null,
        existsOnDisk,
        prunableReason: desc.prunable || (existsOnDisk ? "Git marked prunable" : "Directory missing on disk"),
        eligibleForCleanup: true,
        action: apply ? "prune" : "dry-run-prune",
        disposition: apply
          ? "Pruned stale git worktree registration"
          : "Would prune stale git worktree registration via git worktree prune",
      });
    } else {
      // Category A: Registered active worktree
      const branchName = desc.branch?.replace(/^refs\/heads\//, "") ?? (desc.detached ? "detached" : "unknown");
      registeredActive.push({
        path: resolvedPath,
        classification: "registered-active",
        primary: index === 0,
        branch: branchName,
        head: desc.head ?? null,
        locked: Boolean(desc.locked),
        existsOnDisk,
        eligibleForCleanup: false,
        action: "retain",
        disposition: "Active registered worktree retained",
      });
    }
  }

  // 3. Determine roots to scan for untracked/orphan workspace directories
  const candidateRoots = new Set((options.roots ?? []).map((r) => path.resolve(r)));

  // If no roots specified, auto-discover from repository root and parent of worktree directory
  if (candidateRoots.size === 0) {
    const parentDir = path.dirname(repositoryRoot);
    if (
      normalizeWorktreePath(parentDir) !== normalizeWorktreePath(path.parse(parentDir).root) &&
      !isSameOrAncestor(parentDir, homedir())
    ) {
      candidateRoots.add(parentDir);
    }
  }

  // Scan roots for orphan directories
  for (const root of candidateRoots) {
    const resolvedRoot = path.resolve(root);

    // Root safety check
    const rootReparse = inspectPathSegmentsFn(resolvedRoot, { lstatFn, platform });
    if (rootReparse?.state !== "safe") {
      inspectionErrors.push({
        category: "root-reparse-boundary-excluded",
        path: resolvedRoot,
        code: sanitizedCode(rootReparse?.code, "REPARSE"),
      });
      continue;
    }

    let entries = [];
    try {
      entries = readdirFn(resolvedRoot, { withFileTypes: true });
    } catch (error) {
      inspectionErrors.push({
        category: "root-readdir-failed",
        path: resolvedRoot,
        code: sanitizedCode(error?.code),
      });
      continue;
    }

    for (const entry of entries) {
      const entryName = typeof entry === "string" ? entry : entry.name;
      const childPath = path.join(resolvedRoot, entryName);
      const normalizedChild = normalizeWorktreePath(childPath);

      // Skip if already in registered worktrees
      if (registeredPathMap.has(normalizedChild)) {
        continue;
      }

      // Check if directory
      let isDir = false;
      let stat = null;
      try {
        stat = lstatFn(childPath);
        isDir = stat.isDirectory();
      } catch {
        continue;
      }

      if (!isDir) continue;

      // Category C: Untracked/orphan workspace directory
      // Run the 3 strict safety invariants + reparse safety
      const reparseSafety = checkReparseSafety(childPath, {
        lstatFn,
        platform,
        reparseProbeFn,
        inspectPathSegmentsFn,
      });

      const branchSafety = checkBranchSafety(childPath, { baseRef, remote, gitFn });
      const statusSafety = checkStatusSafety(childPath, { gitFn, lstatFn, readdirFn });
      const livenessSafety = checkLivenessSafety(childPath, {
        currentCwd: repositoryRoot,
        livenessResolver,
      });

      const safetyPassed = reparseSafety.safe && branchSafety.safe && statusSafety.safe && livenessSafety.safe;

      const failingInvariants = [];
      if (!reparseSafety.safe) failingInvariants.push(`Reparse guard: ${reparseSafety.reason}`);
      if (!branchSafety.safe) failingInvariants.push(`Branch invariant: ${branchSafety.reason}`);
      if (!statusSafety.safe) failingInvariants.push(`Status invariant: ${statusSafety.reason}`);
      if (!livenessSafety.safe) failingInvariants.push(`Liveness invariant: ${livenessSafety.reason}`);

      let action = "refuse-cleanup";
      let disposition = `Cleanup refused: safety invariant(s) violated [${failingInvariants.join("; ")}]`;

      if (safetyPassed) {
        if (apply) {
          action = "remove";
          disposition = "Removed safe orphan directory";
        } else {
          action = "dry-run-remove";
          disposition = "Would remove safe orphan directory (all safety invariants passed)";
        }
      }

      untrackedOrphans.push({
        path: childPath,
        classification: "untracked-orphan",
        branchSafety,
        statusSafety,
        livenessSafety,
        reparseSafety,
        safetyPassed,
        eligibleForCleanup: safetyPassed,
        action,
        disposition,
      });
    }
  }

  // 4. Perform mutations in Apply mode if authorized
  let prunedCount = 0;
  let removedCount = 0;

  if (apply) {
    // 4a. Prune stale worktrees
    if (staleRegistered.length > 0) {
      const pruneResult = gitFn(["worktree", "prune", "-v"], { cwd: repositoryRoot, allowPrune: true });
      if (pruneResult.ok) {
        prunedCount = staleRegistered.length;
      } else {
        inspectionErrors.push({
          category: "git-worktree-prune-failed",
          code: sanitizedCode(pruneResult.errorCode ?? pruneResult.code),
        });
      }
    }

    // 4b. Remove safe orphan directories
    for (const orphan of untrackedOrphans) {
      if (orphan.eligibleForCleanup && orphan.action === "remove") {
        try {
          // Double-check reparse point before deletion
          const stat = lstatFn(orphan.path);
          if (stat.isSymbolicLink?.() || stat.reparsePoint) {
            orphan.disposition = "Removal aborted: target became reparse point before deletion";
            continue;
          }
          rmFn(orphan.path, { recursive: true, force: false });
          removedCount += 1;
        } catch (error) {
          orphan.disposition = `Removal failed: ${error?.message}`;
          inspectionErrors.push({
            category: "orphan-directory-removal-failed",
            path: orphan.path,
            code: sanitizedCode(error?.code),
          });
        }
      }
    }
  }

  const totalScanned = registeredActive.length + staleRegistered.length + untrackedOrphans.length;
  const eligibleForCleanup = staleRegistered.length + untrackedOrphans.filter((o) => o.eligibleForCleanup).length;
  const refusedCount = untrackedOrphans.filter((o) => !o.eligibleForCleanup).length;

  return {
    mode: apply ? "apply" : "dry-run",
    dryRun,
    baseRef,
    remote,
    timestamp: new Date().toISOString(),
    summary: {
      totalScanned,
      registeredActive: registeredActive.length,
      staleRegistered: staleRegistered.length,
      untrackedOrphans: untrackedOrphans.length,
      eligibleForCleanup,
      pruned: prunedCount,
      removed: removedCount,
      refused: refusedCount,
    },
    registeredActive,
    staleRegistered,
    untrackedOrphans,
    inspectionErrors,
  };
}

/**
 * @param {Record<string, any>} report
 * @param {{ stdout?: any }} [options]
 */
export function renderCleanupReport(report, { stdout = process.stdout } = {}) {
  const isDryRun = report.dryRun || report.mode === "dry-run";
  const lines = [
    `[worktree-cleanup] MODE: ${isDryRun ? "DRY-RUN (Report Only — 0 mutations performed)" : "APPLY (Mutations Enabled)"}`,
    `[worktree-cleanup] Scanned: ${report.summary.totalScanned} | Active: ${report.summary.registeredActive} | Stale: ${report.summary.staleRegistered} | Orphans: ${report.summary.untrackedOrphans}`,
    `[worktree-cleanup] Eligible for cleanup: ${report.summary.eligibleForCleanup} | Refused: ${report.summary.refused}`,
    "",
  ];

  if (report.registeredActive.length > 0) {
    lines.push("=== Registered Active Worktrees ===");
    for (const item of report.registeredActive) {
      lines.push(`  [ACTIVE] ${item.path}`);
      lines.push(
        `           branch=${item.branch} head=${item.head ? item.head.slice(0, 8) : "none"} primary=${item.primary}`,
      );
      lines.push(`           disposition: ${item.disposition}`);
    }
    lines.push("");
  }

  if (report.staleRegistered.length > 0) {
    lines.push("=== Stale Registered Worktrees (Prunable) ===");
    for (const item of report.staleRegistered) {
      lines.push(`  [STALE]  ${item.path}`);
      lines.push(`           reason=${item.prunableReason} existsOnDisk=${item.existsOnDisk}`);
      lines.push(`           disposition: ${item.disposition}`);
    }
    lines.push("");
  }

  if (report.untrackedOrphans.length > 0) {
    lines.push("=== Untracked / Orphan Workspace Directories ===");
    for (const item of report.untrackedOrphans) {
      const tag = item.eligibleForCleanup ? "[SAFE ORPHAN]" : "[REFUSED ORPHAN]";
      lines.push(`  ${tag} ${item.path}`);
      lines.push(
        `           branch=${item.branchSafety.state} status=${item.statusSafety.state} liveness=${item.livenessSafety.state} reparse=${item.reparseSafety.state}`,
      );
      lines.push(`           disposition: ${item.disposition}`);
    }
    lines.push("");
  }

  if (report.inspectionErrors.length > 0) {
    lines.push(`[worktree-cleanup] Warning: ${report.inspectionErrors.length} inspection error(s) encountered.`);
  }

  lines.push(
    `[worktree-cleanup] Mutations summary: pruned=${report.summary.pruned}, removed=${report.summary.removed} (mode: ${report.mode}).`,
  );

  stdout.write(`${lines.join("\n")}\n`);
}

export function printHelp() {
  console.log(`worktree-cleanup — Safe orphan worktree pruning and reporting tool.

Usage:
  node scripts/worktree-cleanup.mjs [options]

Options:
  --dry-run           Report-only mode (default). Zero disk or git mutations.
  --apply             Apply safe cleanup: prune stale worktrees & remove verified safe orphan directories.
  --force, -f         Alias for --apply.
  --root <path>       Workspace root directory to scan for orphan worktrees.
  --base <ref>        Base branch reference for merge checks (default: origin/main).
  --remote <name>     Remote name for push checks (default: origin).
  --json              Output structured JSON report.
  --self-test         Run pure in-memory self-test assertions.
  -h, --help          Show this help message.

Safety Invariants Enforced Before Directory Cleanup:
  1. Branch check: Must be merged into base OR pushed to upstream remote.
  2. Status check: 0 uncommitted or untracked changes (clean git status).
  3. Liveness check: Fail-closed if active process detected or liveness is unknown.
  4. Reparse check: Fail-closed if path/ancestor is a Win32 reparse point or junction.`);
}

export function selfTest() {
  // Test arg parsing defaults
  const defaults = parseCleanupArgs([]);
  if (!defaults.dryRun || defaults.apply) throw new Error("self-test: default mode must be dry-run");

  const applyParsed = parseCleanupArgs(["--apply"]);
  if (applyParsed.dryRun || !applyParsed.apply) throw new Error("self-test: --apply failed to set apply mode");

  // Test liveness safety fail-closed
  const unknownLiveness = checkLivenessSafety("D:/test/orphan", {
    currentCwd: "D:/other",
    livenessResolver: () => undefined,
  });
  if (unknownLiveness.safe !== false || unknownLiveness.state !== "unknown") {
    throw new Error("self-test: liveness must fail closed on unknown evidence");
  }

  // Test branch safety rejection for unmerged/unpushed
  const fakeGit = (args) => {
    if (args[0] === "rev-parse" && args[1] === "HEAD")
      return { ok: true, stdout: "1111111111111111111111111111111111111111" };
    if (args[0] === "rev-parse" && args.includes("--verify"))
      return { ok: true, stdout: "2222222222222222222222222222222222222222" };
    if (args[0] === "merge-base" && args[1] === "--is-ancestor") return { ok: false, code: 1, stdout: "" };
    if (args[0] === "branch" && args[0] === "branch") return { ok: true, stdout: "" };
    return { ok: false, code: 1, stdout: "" };
  };
  const branchCheck = checkBranchSafety("D:/test/orphan", { gitFn: fakeGit });
  if (branchCheck.safe !== false) throw new Error("self-test: unmerged unpushed branch must fail safety check");

  console.log("[worktree-cleanup] Self-test passed successfully.");
}

function main() {
  try {
    const options = parseCleanupArgs(process.argv.slice(2));
    if (options.help) return printHelp();
    if (options.selfTest) return selfTest();

    const report = auditAndCleanWorktrees(options);
    if (options.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      renderCleanupReport(report);
    }
  } catch (error) {
    console.error(`[worktree-cleanup] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

const isDirectRun = isDirectEntrypoint(import.meta.url);
if (isDirectRun) main();
