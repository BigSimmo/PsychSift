#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const operationMarkers = [
  "MERGE_HEAD",
  "CHERRY_PICK_HEAD",
  "REVERT_HEAD",
  "AM_HEAD",
  "BISECT_LOG",
  "sequencer",
  "rebase-merge",
  "rebase-apply",
];

function normalizePath(value) {
  const normalized = path.resolve(value).replaceAll("\\", "/").replace(/\/$/, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function parseArguments(argv) {
  const options = { allowDirty: false, cloud: false, selfTest: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--allow-dirty") options.allowDirty = true;
    else if (argument === "--cloud") options.cloud = true;
    else if (argument === "--self-test") options.selfTest = true;
    else if (["--expected-repo", "--expected-branch", "--expected-head", "--expected-status-hash"].includes(argument)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}`);
      options[argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
      index += 1;
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function parseWorktrees(output) {
  const worktrees = [];
  for (const block of output.trim().split(/\r?\n\r?\n/)) {
    const record = {};
    for (const line of block.split(/\r?\n/)) {
      const separator = line.indexOf(" ");
      const key = separator < 0 ? line : line.slice(0, separator);
      const value = separator < 0 ? true : line.slice(separator + 1);
      record[key] = value;
    }
    if (record.worktree) worktrees.push(record);
  }
  return worktrees;
}

function protectedBranch(branch) {
  return ["main", "master", "develop"].includes(branch) || branch.startsWith("release/");
}

export function evaluateRepositoryState(state, options = {}) {
  const reasons = [];
  const currentPath = normalizePath(state.root);
  const missingExpectedState = !options.expectedRepo || !options.expectedBranch || !options.expectedHead;
  const currentIndex = state.worktrees.findIndex(
    (worktree) => normalizePath(String(worktree.worktree)) === currentPath,
  );

  if (!path.isAbsolute(state.root)) reasons.push("repository_path_not_absolute");
  if (!state.branch) reasons.push("detached_head");
  else if (protectedBranch(state.branch)) reasons.push("protected_branch");
  if (currentIndex < 0) reasons.push("unregistered_worktree");
  else if (currentIndex === 0 && !options.cloud) reasons.push("primary_worktree");
  else if (currentIndex === 0 && options.cloud && state.worktrees.length !== 1)
    reasons.push("cloud_primary_requires_single_worktree");
  if (state.operations.length) reasons.push("git_operation_in_progress");
  if (options.expectedRepo && normalizePath(options.expectedRepo) !== currentPath) reasons.push("repository_drift");
  if (options.expectedBranch && options.expectedBranch !== state.branch) reasons.push("branch_drift");
  if (options.expectedHead && options.expectedHead !== state.head) reasons.push("head_drift");
  if (state.status && !options.allowDirty) reasons.push("dirty_worktree");
  if (options.allowDirty && missingExpectedState) reasons.push("dirty_override_requires_expected_state");
  if (options.allowDirty && !options.expectedStatusHash) reasons.push("dirty_override_requires_status_hash");
  if (options.expectedStatusHash && options.expectedStatusHash !== state.statusHash) reasons.push("status_drift");
  if (!options.allowDirty && missingExpectedState) reasons.push("expected_state_required");

  return { safe: reasons.length === 0, reason: reasons[0] ?? "", reasons };
}

function git(cwd, args, { trim = true } = {}) {
  try {
    const output = execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return trim ? output.trim() : output;
  } catch (error) {
    throw new Error(`git ${args.join(" ")} failed: ${error.status ?? "unknown"}`);
  }
}

function gitBuffer(cwd, args) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: null,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    throw new Error(`git ${args.join(" ")} failed: ${error.status ?? "unknown"}`);
  }
}

export function repositoryStatusHash({ status, stagedDiff, unstagedDiff, untrackedFiles = [] }) {
  const hash = crypto.createHash("sha256");
  const append = (label, value) => {
    const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value ?? "");
    hash.update(`${label}\0${buffer.length}\0`);
    hash.update(buffer);
  };

  append("status", status);
  append("staged", stagedDiff);
  append("unstaged", unstagedDiff);
  for (const file of [...untrackedFiles].sort((left, right) => left.path.localeCompare(right.path))) {
    append("untracked-path", file.path);
    append("untracked-content", file.content);
  }
  return hash.digest("hex");
}

function inspectRepository(cwd) {
  const revisionState = git(cwd, ["rev-parse", "--show-toplevel", "--absolute-git-dir", "HEAD"]).split(/\r?\n/);
  if (revisionState.length !== 3) throw new Error("git rev-parse returned incomplete repository state");
  const [root, gitDirectory, head] = revisionState;
  const worktrees = parseWorktrees(git(cwd, ["worktree", "list", "--porcelain"]));
  const currentWorktree = worktrees.find(
    (worktree) => normalizePath(String(worktree.worktree)) === normalizePath(root),
  );
  const rawStatus = git(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], { trim: false });
  const untrackedPaths = git(cwd, ["ls-files", "--others", "--exclude-standard", "-z"], { trim: false })
    .split("\0")
    .filter(Boolean);
  const snapshot = {
    status: rawStatus,
    stagedDiff: gitBuffer(cwd, ["diff", "--cached", "--binary", "--full-index", "--no-ext-diff"]),
    unstagedDiff: gitBuffer(cwd, ["diff", "--binary", "--full-index", "--no-ext-diff"]),
    untrackedFiles: untrackedPaths.map((filePath) => ({
      path: filePath,
      content: fs.readFileSync(path.join(root, filePath)),
    })),
  };
  return {
    root,
    branch: typeof currentWorktree?.branch === "string" ? currentWorktree.branch.replace(/^refs\/heads\//, "") : "",
    head,
    operations: operationMarkers.filter((marker) => fs.existsSync(path.join(gitDirectory, marker))),
    status: rawStatus,
    statusHash: repositoryStatusHash(snapshot),
    worktrees,
  };
}

function runSelfTest() {
  const head = "a".repeat(40);
  const cleanHash = repositoryStatusHash({ status: "", stagedDiff: "", unstagedDiff: "" });
  const dirtyStatus = " M file";
  const dirtyHash = repositoryStatusHash({ status: dirtyStatus, stagedDiff: "", unstagedDiff: "first" });
  const changedContentHash = repositoryStatusHash({
    status: dirtyStatus,
    stagedDiff: "",
    unstagedDiff: "second",
  });
  if (dirtyHash === changedContentHash) {
    throw new Error("dirty snapshot hashing did not detect a content-only change");
  }
  const base = {
    root: "/repo/task",
    branch: "codex/task",
    head,
    operations: [],
    status: "",
    statusHash: cleanHash,
    worktrees: [{ worktree: "/repo" }, { worktree: "/repo/task" }],
  };
  const expected = { expectedRepo: base.root, expectedBranch: base.branch, expectedHead: head };
  const cloudBase = { ...base, root: "/workspace/repo", worktrees: [{ worktree: "/workspace/repo" }] };
  const cloudExpected = {
    expectedRepo: cloudBase.root,
    expectedBranch: cloudBase.branch,
    expectedHead: head,
    cloud: true,
  };
  const cases = [
    ["safe secondary worktree", base, expected, true, ""],
    ["safe Cloud primary", cloudBase, cloudExpected, true, ""],
    ["Cloud primary without explicit mode", cloudBase, { ...cloudExpected, cloud: false }, false, "primary_worktree"],
    ...["expectedRepo", "expectedBranch", "expectedHead"].map((key) => [
      `Cloud missing ${key}`,
      cloudBase,
      { ...cloudExpected, [key]: undefined },
      false,
      "expected_state_required",
    ]),
    ["Cloud repository drift", cloudBase, { ...cloudExpected, expectedRepo: "/other" }, false, "repository_drift"],
    ["Cloud branch drift", cloudBase, { ...cloudExpected, expectedBranch: "codex/other" }, false, "branch_drift"],
    ["Cloud HEAD drift", cloudBase, { ...cloudExpected, expectedHead: "b".repeat(40) }, false, "head_drift"],
    ["Cloud protected branch", { ...cloudBase, branch: "main" }, cloudExpected, false, "protected_branch"],
    ["Cloud detached HEAD", { ...cloudBase, branch: "" }, cloudExpected, false, "detached_head"],
    ["Cloud dirty default", { ...cloudBase, status: dirtyStatus }, cloudExpected, false, "dirty_worktree"],
    [
      "Cloud dirty content drift",
      { ...cloudBase, status: dirtyStatus, statusHash: changedContentHash },
      { ...cloudExpected, allowDirty: true, expectedStatusHash: dirtyHash },
      false,
      "status_drift",
    ],
    [
      "Cloud primary with sibling worktree",
      { ...cloudBase, worktrees: [{ worktree: cloudBase.root }, { worktree: "/workspace/other" }] },
      cloudExpected,
      false,
      "cloud_primary_requires_single_worktree",
    ],
    ["missing expected state", base, {}, false, "expected_state_required"],
    ["primary worktree", { ...base, root: "/repo" }, expected, false, "primary_worktree"],
    ["detached head", { ...base, branch: "" }, expected, false, "detached_head"],
    ["protected branch", { ...base, branch: "main" }, expected, false, "protected_branch"],
    ["active operation", { ...base, operations: ["MERGE_HEAD"] }, expected, false, "git_operation_in_progress"],
    ["dirty default", { ...base, status: dirtyStatus, statusHash: dirtyHash }, expected, false, "dirty_worktree"],
    [
      "dirty continuation",
      { ...base, status: dirtyStatus, statusHash: dirtyHash },
      { ...expected, allowDirty: true, expectedStatusHash: dirtyHash },
      true,
      "",
    ],
    [
      "dirty continuation missing status hash",
      { ...base, status: dirtyStatus, statusHash: dirtyHash },
      { ...expected, allowDirty: true },
      false,
      "dirty_override_requires_status_hash",
    ],
    [
      "dirty status drift",
      { ...base, status: dirtyStatus, statusHash: dirtyHash },
      { ...expected, allowDirty: true, expectedStatusHash: "b".repeat(64) },
      false,
      "status_drift",
    ],
    ["state drift", base, { ...expected, expectedBranch: "codex/other" }, false, "branch_drift"],
  ];
  for (const [name, state, options, expectedSafe, expectedReason = ""] of cases) {
    const result = evaluateRepositoryState(state, options);
    if (result.safe !== expectedSafe) throw new Error(`${name}: expected safe=${expectedSafe}, got ${result.safe}`);
    if (result.reason !== expectedReason)
      throw new Error(`${name}: expected reason=${expectedReason}, got ${result.reason}`);
  }
  console.log(`prompt-perfector isolation self-test passed: ${cases.length}/${cases.length}`);
}

function emit(result, state, options = {}) {
  console.log(`SAFE_TO_EDIT=${result.safe}`);
  console.log(`PRECHECK_RESULT=${result.safe ? "SAFE" : "BLOCKED"}`);
  console.log(`SAFE_MODE=${options.cloud ? "CLOUD" : "WORKTREE"}`);
  if (!result.safe) console.log(`BLOCK_REASON=${result.reason}`);
  if (state) {
    console.log(`SAFE_REPO=${state.root}`);
    console.log(`SAFE_BRANCH=${state.branch || "DETACHED"}`);
    console.log(`SAFE_HEAD_HASH=${state.head}`);
    console.log(`SAFE_STATUS_HASH=${state.statusHash}`);
  }
}

function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.selfTest) runSelfTest();
    else {
      const state = inspectRepository(process.cwd());
      const result = evaluateRepositoryState(state, options);
      emit(result, state, options);
      if (!result.safe) process.exitCode = 1;
    }
  } catch (error) {
    emit({ safe: false, reason: "verification_error" });
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && normalizePath(process.argv[1]) === normalizePath(fileURLToPath(import.meta.url))) main();
