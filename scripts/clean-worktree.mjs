#!/usr/bin/env node

/**
 * Registered-worktree reporting for the PsychSift repository.
 *
 * This module is intentionally incapable of changing files, refs, objects, registrations,
 * or worktree directories. The historical `clean:worktree` package command is retained as a
 * compatibility alias, but every CLI and exported path is report-only.
 */
import { spawnSync } from "node:child_process";
import { lstatSync } from "node:fs";
import path from "node:path";

import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

const ZERO_MUTATIONS = Object.freeze({ cleaned: 0, pruned: 0, removed: 0, deregistered: 0 });
const READ_ONLY_GIT_ENV = Object.freeze({
  GIT_OPTIONAL_LOCKS: "0",
  GIT_NO_LAZY_FETCH: "1",
  GIT_LITERAL_PATHSPECS: "1",
  GIT_PAGER: "cat",
});
const OBJECT_ID = /^[0-9a-f]{40,64}$/i;
const WINDOWS_REPARSE_PROBE_SCRIPT = [
  "$utf8 = New-Object System.Text.UTF8Encoding $false;",
  "[Console]::InputEncoding = $utf8; [Console]::OutputEncoding = $utf8;",
  "try { $request = [Console]::In.ReadToEnd() | ConvertFrom-Json -ErrorAction Stop; $results = @();",
  "foreach ($candidate in @($request.paths)) {",
  "try { $item = Get-Item -LiteralPath ([string]$candidate) -Force -ErrorAction Stop;",
  "$state = if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { 'reparse' } else { 'safe' };",
  "$results += [pscustomobject]@{ state = $state; code = $(if ($state -eq 'reparse') { 'REPARSE' } else { 'OK' }) }",
  "} catch { $state = 'unknown'; $results += [pscustomobject]@{ state = $state; code = 'GET_ITEM_FAILED' } };",
  "if ($request.stopOnBoundary -and $state -ne 'safe') { break }",
  "}; ConvertTo-Json -InputObject @($results) -Compress",
  "} catch { exit 11 }",
].join(" ");

function sanitizedCode(value, fallback = "UNKNOWN") {
  const text = String(value ?? "").trim();
  return /^[A-Za-z0-9_.-]{1,40}$/.test(text) ? text : fallback;
}

export function inspectWindowsReparsePaths(
  candidatePaths,
  { platform = process.platform, runner = spawnSync, stopOnBoundary = false } = {},
) {
  const paths = Array.isArray(candidatePaths) ? candidatePaths.map((candidate) => path.resolve(candidate)) : [];
  if (paths.length === 0) return [];
  if (platform !== "win32") return paths.map(() => ({ state: "safe" }));
  const result = runner(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_REPARSE_PROBE_SCRIPT],
    {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
      timeout: 5_000,
      input: JSON.stringify({ paths, stopOnBoundary }),
    },
  );
  if (result?.error) {
    return paths.map(() => ({ state: "unknown", code: sanitizedCode(result.error.code, "PROBE_ERROR") }));
  }
  if (result?.status !== 0) {
    const code = sanitizedCode(result?.status, "PROBE_EXIT");
    return paths.map(() => ({ state: "unknown", code }));
  }
  let parsed;
  try {
    parsed = JSON.parse(String(result.stdout ?? ""));
  } catch {
    parsed = null;
  }
  const validLength =
    Array.isArray(parsed) &&
    (stopOnBoundary ? parsed.length > 0 && parsed.length <= paths.length : parsed.length === paths.length);
  const validStates =
    validLength &&
    parsed.every((entry) => entry?.state === "safe" || entry?.state === "reparse" || entry?.state === "unknown");
  const validBoundaryStop =
    !stopOnBoundary ||
    parsed?.length === paths.length ||
    parsed?.at(-1)?.state === "reparse" ||
    parsed?.at(-1)?.state === "unknown";
  if (!validStates || !validBoundaryStop) {
    return paths.map(() => ({ state: "unknown", code: "MALFORMED_PROBE" }));
  }
  return parsed.map((entry) => ({
    state: entry.state,
    ...(entry.state === "safe" ? {} : { code: sanitizedCode(entry.code, "PROBE_RESULT") }),
  }));
}

/**
 * Node exposes symlinks and junctions through `isSymbolicLink()`, but not every Windows reparse
 * attribute. Query FileAttributes without interpolating candidates into shell source; unavailable
 * or malformed evidence is `unknown`, never safe.
 */
export function inspectReparsePoints(entries, options = {}) {
  const values = Array.isArray(entries) ? entries : [];
  const platform = options.platform ?? process.platform;
  const results = new Array(values.length);
  const uncertain = [];
  for (let index = 0; index < values.length; index += 1) {
    const stat = values[index]?.stat;
    if (stat?.isSymbolicLink?.() === true || stat?.reparsePoint === true) {
      results[index] = { state: "reparse", code: "REPARSE" };
    } else if (stat?.reparsePoint === false || platform !== "win32") {
      results[index] = { state: "safe" };
    } else {
      uncertain.push({ index, path: values[index]?.path });
    }
  }
  const batchFn = options.batchFn ?? inspectWindowsReparsePaths;
  const probed = batchFn(
    uncertain.map((entry) => entry.path),
    options,
  );
  for (let index = 0; index < uncertain.length; index += 1) {
    results[uncertain[index].index] = probed[index] ?? { state: "unknown", code: "MISSING_PROBE_RESULT" };
  }
  return results;
}

export function inspectReparsePoint(candidatePath, stat, options = {}) {
  return (
    inspectReparsePoints([{ path: candidatePath, stat }], options)[0] ?? {
      state: "unknown",
      code: "MISSING_PROBE_RESULT",
    }
  );
}

export function normalizeWorktreePath(value) {
  const resolved = path.resolve(String(value ?? ""));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function assertReportOnlyOptions(options = {}) {
  const supplied = Object(options);
  if ("remove" in supplied || "apply" in supplied) {
    throw new Error("Mutation options are unsupported: worktree tooling is permanently report-only.");
  }
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

function requireRevisionInput(value, label) {
  if (!isSafeRevisionInput(value)) {
    throw new Error(`${label} must be a non-empty revision without control characters.`);
  }
  return value;
}

function normalizeDriveFilter(value) {
  if (value === null || value === undefined) return null;
  const match = /^([A-Za-z]):?$/.exec(String(value));
  if (!match) throw new Error("Drive filter must be exactly one ASCII letter with an optional colon.");
  return match[1].toUpperCase();
}

/**
 * Allow only the Git commands needed to build a cached, read-only report. A future caller cannot
 * add a new Git operation without extending this deliberately narrow boundary and its tests.
 */
export function assertReadOnlyGitArgs(args) {
  if (!Array.isArray(args) || args.length === 0 || args.some((item) => typeof item !== "string")) {
    throw new Error("Rejected by read-only Git boundary: invalid argument vector.");
  }

  const [command, ...rest] = args;
  const exact = (...expected) =>
    rest.length === expected.length && rest.every((value, index) => value === expected[index]);
  const validObjectPair = (left, right) => OBJECT_ID.test(left ?? "") && OBJECT_ID.test(right ?? "");
  let allowed = false;
  if (command === "worktree") {
    allowed = exact("list", "--porcelain", "-z") || exact("prune", "--dry-run", "-v");
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
  } else if (command === "diff") {
    const nameOnlyShape =
      rest.length === 8 &&
      rest[0] === "--no-ext-diff" &&
      rest[1] === "--no-textconv" &&
      rest[2] === "--no-renames" &&
      rest[3] === "--name-only" &&
      rest[4] === "-z" &&
      validObjectPair(rest[5], rest[6]) &&
      rest[7] === "--";
    const quietPathShape =
      rest.length === 8 &&
      rest[0] === "--quiet" &&
      rest[1] === "--no-ext-diff" &&
      rest[2] === "--no-textconv" &&
      rest[3] === "--no-renames" &&
      validObjectPair(rest[4], rest[5]) &&
      rest[6] === "--" &&
      Boolean(rest[7]) &&
      !/[\0\r\n]/.test(rest[7]);
    allowed = nameOnlyShape || quietPathShape;
  } else if (command === "remote") {
    allowed = exact("get-url", "origin");
  }

  if (!allowed) {
    throw new Error(`Rejected by read-only Git boundary: ${command}.`);
  }
}

/**
 * @param {string[]} args
 * @param {{ cwd?: string, runner?: typeof spawnSync }} [options]
 */
export function runReadOnlyGit(args, { cwd = process.cwd(), runner = spawnSync } = {}) {
  assertReadOnlyGitArgs(args);
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

/** Parse newline- or NUL-delimited `git worktree list --porcelain` output. */
export function parseWorktreePorcelain(output) {
  const text = String(output ?? "");
  const tokens = text.includes("\0") ? text.split("\0") : text.split(/\r?\n/);
  const worktrees = [];
  let current = null;

  const flush = () => {
    if (current?.path) worktrees.push(current);
    current = null;
  };

  for (const rawToken of tokens) {
    const token = !text.includes("\0") && rawToken.endsWith("\r") ? rawToken.slice(0, -1) : rawToken;
    if (!token) {
      if (!text.includes("\0")) flush();
      continue;
    }
    const separator = token.indexOf(" ");
    const key = separator === -1 ? token : token.slice(0, separator);
    const value = separator === -1 ? "" : token.slice(separator + 1);

    if (key === "worktree") {
      flush();
      current = {
        path: value,
        head: null,
        branch: null,
        detached: false,
        locked: false,
        prunable: null,
      };
      continue;
    }
    if (!current) continue;
    if (key === "HEAD") current.head = value;
    else if (key === "branch") current.branch = value;
    else if (key === "detached") current.detached = true;
    else if (key === "locked") current.locked = value || true;
    else if (key === "prunable") current.prunable = value || "marked prunable";
  }
  flush();
  return worktrees;
}

/**
 * A process probe can prove activity. It cannot prove inactivity merely by returning no match.
 * Only an explicit authoritative owner signal can produce `inactive`.
 */
export function classifyLiveness(evidence) {
  if (evidence?.state === "active" || Number(evidence?.matchingProcesses) > 0) {
    return {
      state: "active",
      source: typeof evidence?.source === "string" ? evidence.source : "process-match",
    };
  }
  if (
    evidence?.state === "inactive" &&
    evidence.authoritative === true &&
    typeof evidence.source === "string" &&
    evidence.source.trim() &&
    typeof evidence.checkedAt === "string" &&
    evidence.checkedAt.trim()
  ) {
    return { state: "inactive", source: evidence.source, checkedAt: evidence.checkedAt };
  }
  return { state: "unknown", reason: "absence of activity evidence is not proof of inactivity" };
}

function mutationOptionToken(token) {
  return token === "--remove" || token.startsWith("--remove=") || token === "--apply" || token.startsWith("--apply=");
}

function requiredValue(argv, index, name) {
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) throw new Error(`Missing value for ${name}.`);
  return value;
}

export function parseArgs(argv) {
  const tokens = Array.isArray(argv) ? argv : [];
  if (tokens.some(mutationOptionToken)) {
    throw new Error("Mutation options are unsupported: worktree tooling is permanently report-only.");
  }

  const options = {
    reportOnly: true,
    help: false,
    selfTest: false,
    json: false,
    dryRun: false,
    merged: false,
    squashed: false,
    baseRef: "origin/main",
    drive: null,
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--help" || token === "-h") options.help = true;
    else if (token === "--self-test") options.selfTest = true;
    else if (token === "--json") options.json = true;
    else if (token === "--dry-run") options.dryRun = true;
    else if (token === "--merged") options.merged = true;
    else if (token === "--squashed") options.squashed = true;
    else if (token === "--base") {
      options.baseRef = requiredValue(tokens, index, "--base");
      index += 1;
    } else if (token.startsWith("--base=")) {
      options.baseRef = token.slice("--base=".length);
      if (!options.baseRef) throw new Error("Missing value for --base.");
    } else if (token === "--drive") {
      options.drive = requiredValue(tokens, index, "--drive");
      index += 1;
    } else if (token.startsWith("--drive=")) {
      options.drive = token.slice("--drive=".length);
      if (!options.drive) throw new Error("Missing value for --drive.");
    } else {
      throw new Error(`Unknown argument: ${token}. Run with --help for usage.`);
    }
  }

  if (options.squashed && !options.merged) {
    throw new Error("--squashed is only valid together with --merged.");
  }
  options.drive = normalizeDriveFilter(options.drive);
  return options;
}

function inspectionError(category, code = "UNKNOWN", extra = {}) {
  return { category, code: sanitizedCode(code), ...extra };
}

function fileSystemError(category, error, extra = {}) {
  return inspectionError(category, error?.code, extra);
}

function gitFailure(category, result, extra = {}) {
  return inspectionError(category, result?.errorCode ?? result?.code, extra);
}

function parseNulValues(value) {
  return String(value ?? "")
    .split("\0")
    .filter(Boolean);
}

function computeLandedState(branch, baseCommit, { includeContentEquivalent, gitFn, cwd }) {
  if (!isSafeRevisionInput(branch) || !OBJECT_ID.test(baseCommit ?? "")) {
    return {
      state: "unknown",
      error: inspectionError("revision-input-invalid", "INVALID_REVISION"),
    };
  }
  const branchResult = gitFn(["rev-parse", "--verify", "--quiet", "--end-of-options", `${branch}^{commit}`], { cwd });
  if (!branchResult.ok || !OBJECT_ID.test(branchResult.stdout)) {
    return { state: "unknown", error: gitFailure("branch-commit-inspection-failed", branchResult) };
  }
  const branchCommit = branchResult.stdout;
  const ancestor = gitFn(["merge-base", "--is-ancestor", branchCommit, baseCommit], { cwd });
  if (ancestor.ok) return { state: "proven", basis: "ancestor" };
  if (ancestor.code !== 1) {
    return { state: "unknown", error: gitFailure("ancestor-inspection-failed", ancestor) };
  }
  if (!includeContentEquivalent) return { state: "not-landed", basis: "not-ancestor" };

  const mergeBase = gitFn(["merge-base", baseCommit, branchCommit], { cwd });
  if (!mergeBase.ok || !OBJECT_ID.test(mergeBase.stdout)) {
    return { state: "unknown", error: gitFailure("merge-base-inspection-failed", mergeBase) };
  }
  const names = gitFn(
    [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--no-renames",
      "--name-only",
      "-z",
      mergeBase.stdout,
      branchCommit,
      "--",
    ],
    { cwd },
  );
  if (!names.ok) return { state: "unknown", error: gitFailure("changed-path-inspection-failed", names) };

  const changedPaths = parseNulValues(names.stdout);
  for (const changedPath of changedPaths) {
    const equivalent = gitFn(
      [
        "diff",
        "--quiet",
        "--no-ext-diff",
        "--no-textconv",
        "--no-renames",
        branchCommit,
        baseCommit,
        "--",
        changedPath,
      ],
      { cwd },
    );
    if (equivalent.ok) continue;
    if (equivalent.code === 1) return { state: "not-landed", basis: "changed-path-differs" };
    return { state: "unknown", error: gitFailure("content-equivalence-inspection-failed", equivalent) };
  }
  return { state: "content-equivalent", basis: "all-branch-changed-paths-match-base" };
}

function inspectRegisteredWorktree(descriptor, index, context, { gitFn, lstatFn, livenessResolver, reparseProbeFn }) {
  const errors = [];
  const resolvedPath = path.resolve(descriptor.path);
  let pathState = "present";
  try {
    const stat = lstatFn(resolvedPath);
    const reparse = reparseProbeFn(resolvedPath, stat);
    if (reparse?.state === "reparse") {
      pathState = "reparse-boundary";
      errors.push(inspectionError("registered-path-reparse-boundary", "REPARSE"));
    } else if (reparse?.state !== "safe") {
      pathState = "unknown";
      errors.push(inspectionError("registered-path-reparse-inspection-failed", reparse?.code));
    } else if (!stat?.isDirectory?.()) {
      pathState = "not-directory";
      errors.push(inspectionError("registered-path-not-directory", "NOT_DIRECTORY"));
    }
  } catch (error) {
    if (error?.code === "ENOENT") pathState = "absent";
    else {
      pathState = "unknown";
      errors.push(fileSystemError("registered-path-lstat-unavailable", error));
    }
  }

  let topLevel = null;
  let commonDir = null;
  let observedHead = null;
  let observedBranch = descriptor.detached ? null : descriptor.branch?.replace(/^refs\/heads\//, "") || null;
  let dirtyEntries = null;

  if (pathState === "present") {
    const top = gitFn(["rev-parse", "--show-toplevel"], { cwd: resolvedPath });
    if (top.ok && top.stdout) topLevel = path.resolve(top.stdout);
    else errors.push(gitFailure("toplevel-inspection-failed", top));

    const common = gitFn(["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: resolvedPath });
    if (common.ok && common.stdout) commonDir = path.resolve(common.stdout);
    else errors.push(gitFailure("common-dir-inspection-failed", common));

    const head = gitFn(["rev-parse", "HEAD"], { cwd: resolvedPath });
    if (head.ok && head.stdout) observedHead = head.stdout;
    else errors.push(gitFailure("head-inspection-failed", head));

    const branch = gitFn(["symbolic-ref", "--quiet", "--short", "HEAD"], { cwd: resolvedPath });
    if (branch.ok) observedBranch = branch.stdout || null;
    else if (branch.code === 1) observedBranch = null;
    else errors.push(gitFailure("branch-inspection-failed", branch));

    const status = gitFn(["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=none"], {
      cwd: resolvedPath,
    });
    if (status.ok) dirtyEntries = parseNulValues(status.stdout).length;
    else errors.push(gitFailure("status-inspection-failed", status));
  }

  if (topLevel && normalizeWorktreePath(topLevel) !== normalizeWorktreePath(resolvedPath)) {
    errors.push(inspectionError("toplevel-mismatch", "MISMATCH"));
  }
  if (
    commonDir &&
    context.primaryCommonDir &&
    normalizeWorktreePath(commonDir) !== normalizeWorktreePath(context.primaryCommonDir)
  ) {
    errors.push(inspectionError("common-dir-mismatch", "MISMATCH"));
  }
  if (descriptor.head && observedHead && descriptor.head !== observedHead) {
    errors.push(inspectionError("head-changed-during-report", "MISMATCH"));
  }
  const expectedBranch = descriptor.branch?.replace(/^refs\/heads\//, "") || null;
  if (pathState === "present" && expectedBranch !== observedBranch) {
    errors.push(inspectionError("branch-state-changed-during-report", "MISMATCH"));
  }

  let livenessEvidence;
  try {
    livenessEvidence = livenessResolver(resolvedPath);
  } catch (error) {
    errors.push(fileSystemError("liveness-inspection-failed", error));
  }
  const liveness = classifyLiveness(livenessEvidence);

  let landed = { state: context.merged ? "unknown" : "not-requested", basis: "report-mode" };
  if (context.merged && expectedBranch && errors.length === 0 && context.mergeInspectionAvailable) {
    landed = computeLandedState(descriptor.branch, context.baseCommit, {
      includeContentEquivalent: context.squashed,
      gitFn,
      cwd: resolvedPath,
    });
    if (landed.error) errors.push(landed.error);
  }

  return {
    path: resolvedPath,
    branch: observedBranch,
    head: observedHead ?? descriptor.head,
    registered: true,
    primary: index === 0,
    current: topLevel
      ? normalizeWorktreePath(topLevel) === normalizeWorktreePath(context.currentTopLevel)
      : normalizeWorktreePath(resolvedPath) === normalizeWorktreePath(context.currentTopLevel),
    mainBranch: observedBranch === "main" || expectedBranch === "main",
    locked: Boolean(descriptor.locked),
    detached: Boolean(descriptor.detached || !observedBranch),
    prunableHint: descriptor.prunable ? true : false,
    pathState,
    dirtyEntries,
    liveness,
    landed: { state: landed.state, basis: landed.basis },
    inspectionErrors: errors,
    disposition: "report-only; no automated removal path exists",
  };
}

function driveMatches(worktreePath, drive) {
  if (!drive) return true;
  const match = /^([A-Za-z]):/.exec(worktreePath);
  return Boolean(match && match[1].toUpperCase() === drive);
}

/**
 * @param {Record<string, any>} [options]
 * @param {{ gitFn?: typeof runReadOnlyGit, cwd?: string, lstatFn?: typeof lstatSync,
 *   livenessResolver?: (path: string) => any }} [adapters]
 */
export function collectRegisteredWorktreeReport(options = {}, adapters = {}) {
  assertReportOnlyOptions(options);
  const gitFn = adapters.gitFn ?? runReadOnlyGit;
  const cwd = path.resolve(adapters.cwd ?? process.cwd());
  const lstatFn = adapters.lstatFn ?? lstatSync;
  const livenessResolver = adapters.livenessResolver ?? (() => undefined);
  const reparseProbeFn = adapters.reparseProbeFn ?? inspectReparsePoint;
  const baseRef = requireRevisionInput(options.baseRef ?? "origin/main", "Base ref");
  const drive = normalizeDriveFilter(options.drive);
  const merged = options.merged === true;
  const squashed = options.squashed === true;
  const inspectionErrors = [];

  const listed = gitFn(["worktree", "list", "--porcelain", "-z"], { cwd });
  if (!listed.ok) {
    const failure = gitFailure("worktree-list-unavailable", listed);
    throw new Error(`worktree-list-unavailable (${failure.code})`);
  }
  const descriptors = parseWorktreePorcelain(listed.stdout);
  if (descriptors.length === 0) throw new Error("worktree-list-unavailable (EMPTY)");

  const preview = gitFn(["worktree", "prune", "--dry-run", "-v"], { cwd });
  if (!preview.ok) inspectionErrors.push(gitFailure("prune-preview-unavailable", preview));

  const current = gitFn(["rev-parse", "--show-toplevel"], { cwd });
  const currentTopLevel = current.ok && current.stdout ? path.resolve(current.stdout) : cwd;
  if (!current.ok) inspectionErrors.push(gitFailure("current-toplevel-unavailable", current));

  let mergeInspectionAvailable = true;
  let baseCommit = null;
  if (merged) {
    const shallow = gitFn(["rev-parse", "--is-shallow-repository"], { cwd });
    if (!shallow.ok || shallow.stdout !== "false") {
      mergeInspectionAvailable = false;
      inspectionErrors.push(
        shallow.ok
          ? inspectionError("full-history-required", sanitizedCode(shallow.stdout, "SHALLOW"))
          : gitFailure("history-inspection-unavailable", shallow),
      );
    }
    const base = gitFn(["rev-parse", "--verify", "--quiet", "--end-of-options", `${baseRef}^{commit}`], {
      cwd,
    });
    if (!base.ok || !OBJECT_ID.test(base.stdout)) {
      mergeInspectionAvailable = false;
      inspectionErrors.push(gitFailure("base-ref-unavailable", base));
    } else baseCommit = base.stdout;
  }

  let primaryCommonDir = null;
  const primaryPath = path.resolve(descriptors[0].path);
  try {
    const primaryStat = lstatFn(primaryPath);
    const primaryReparse = reparseProbeFn(primaryPath, primaryStat);
    if (primaryReparse?.state === "safe" && primaryStat?.isDirectory?.()) {
      const primaryCommon = gitFn(["rev-parse", "--path-format=absolute", "--git-common-dir"], {
        cwd: primaryPath,
      });
      if (primaryCommon.ok && primaryCommon.stdout) primaryCommonDir = path.resolve(primaryCommon.stdout);
      else inspectionErrors.push(gitFailure("primary-common-dir-unavailable", primaryCommon));
    } else {
      inspectionErrors.push(
        inspectionError(
          primaryReparse?.state === "reparse" ? "primary-path-reparse-boundary" : "primary-path-uninspectable",
          primaryReparse?.code ?? "PATH_BOUNDARY",
        ),
      );
    }
  } catch (error) {
    inspectionErrors.push(fileSystemError("primary-path-lstat-unavailable", error));
  }

  const context = {
    currentTopLevel,
    primaryCommonDir,
    merged,
    squashed,
    baseRef,
    baseCommit,
    mergeInspectionAvailable,
  };
  const worktrees = descriptors
    .filter((descriptor) => driveMatches(descriptor.path, drive))
    .map((descriptor) =>
      inspectRegisteredWorktree(descriptor, descriptors.indexOf(descriptor), context, {
        gitFn,
        lstatFn,
        livenessResolver,
        reparseProbeFn,
      }),
    )
    .sort((left, right) => left.path.localeCompare(right.path));

  const rowErrors = worktrees.flatMap((item) =>
    item.inspectionErrors.map((error) => ({ ...error, worktree: item.path })),
  );
  const allErrors = [...inspectionErrors, ...rowErrors];
  return {
    mode: "report-only",
    cachedRefsOnly: true,
    complete: allErrors.length === 0,
    baseRef: merged ? baseRef : null,
    mergeMode: merged ? (squashed ? "ancestor-or-content-equivalent" : "ancestor-only") : "not-requested",
    dryRunCompatibilityFlag: options.dryRun === true,
    driveFilter: drive,
    prunePreviewEntries: preview.ok ? String(preview.stdout).split(/\r?\n/).filter(Boolean).length : null,
    mutations: { ...ZERO_MUTATIONS },
    inspectionErrors: allErrors,
    worktrees,
  };
}

export function renderRegisteredWorktreeReport(report, { stdout = process.stdout } = {}) {
  const lines = [
    "[worktrees] REPORT ONLY — no files, refs, objects, registrations, or directories were changed.",
    `[worktrees] Registered: ${report.worktrees.length}; inspection: ${report.complete ? "complete" : "INCOMPLETE"}; cached refs only.`,
    `[worktrees] Dry-run prune preview entries: ${report.prunePreviewEntries ?? "unavailable"}.`,
  ];
  for (const item of report.worktrees) {
    lines.push(
      `  - ${item.path}`,
      `      branch=${item.branch ?? "unknown"} dirty=${item.dirtyEntries ?? "unknown"} liveness=${item.liveness.state} landed=${item.landed.state}`,
      `      disposition=${item.disposition}`,
    );
  }
  if (!report.complete) {
    lines.push(`[worktrees] Refused complete verdict: ${report.inspectionErrors.length} inspection error(s).`);
  }
  lines.push("[worktrees] Mutations: cleaned=0 pruned=0 removed=0 deregistered=0.");
  stdout.write(`${lines.join("\n")}\n`);
}

export function runRegisteredWorktreeReport(options = {}, adapters = {}) {
  assertReportOnlyOptions(options);
  const report = collectRegisteredWorktreeReport(options, adapters);
  if (options.json === true) (adapters.stdout ?? process.stdout).write(`${JSON.stringify(report, null, 2)}\n`);
  else renderRegisteredWorktreeReport(report, adapters);
  return report;
}

export function printHelp() {
  console.log(`worktrees:report — cached, report-only registered-worktree inspection.

Usage:
  npm run worktrees:report [-- --merged [--squashed] [--base <ref>] [--drive <letter>]]
  npm run clean:worktree   # historical report-only compatibility alias

Options:
  --merged            Report cached ancestor evidence against the base ref.
  --squashed          Also report exact changed-path content equivalence (requires --merged).
  --base <ref>        Cached base ref (default: origin/main); this command never fetches.
  --drive <letter>    Limit displayed registered worktrees to one drive.
  --json              Emit structured JSON.
  --dry-run           Compatibility no-op; every invocation is already report-only.
  --self-test         Run pure offline contract assertions.

Mutation flags are unsupported. No environment variable can unlock removal.
Absence of a matching process remains liveness=unknown, never inactive.`);
}

export function selfTest() {
  if (classifyLiveness().state !== "unknown") throw new Error("self-test: absent liveness was not unknown");
  if (parseArgs(["--merged"]).reportOnly !== true) throw new Error("self-test: report-only flag missing");
  let refused = false;
  try {
    parseArgs(["--apply"]);
  } catch {
    refused = true;
  }
  if (!refused) throw new Error("self-test: mutation option was accepted");
  assertReadOnlyGitArgs(["worktree", "prune", "--dry-run", "-v"]);
  console.log("[worktrees] Report-only self-test passed.");
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) return printHelp();
    if (options.selfTest) return selfTest();
    const report = runRegisteredWorktreeReport(options);
    if (!report.complete) process.exitCode = 1;
  } catch (error) {
    console.error(`[worktrees] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

const isDirectRun = isDirectEntrypoint(import.meta.url);
if (isDirectRun) main();
