#!/usr/bin/env node
/**
 * Pin Gitleaks to the workflow event's base/head SHAs and the checked-out commit.
 *
 * The stock gitleaks-action re-queries the PR commits API mid-run; a concurrent
 * push can move the tip so the scan range is not in the workspace (#097).
 * Event payload SHAs are immutable for the run — use those, then verify HEAD.
 *
 * merge_group: the queue candidate is scanned over merge_group.base_sha..head_sha, the full
 * immutable range of commits the queue would add to main. It fails closed: a missing or
 * all-zero base throws here, and main() refuses a base that is absent from the checkout or not
 * an ancestor of the head, instead of falling back to a tip-only scan.
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";
import { childProcessExitCode } from "./child-process-result.mjs";

const zeroSha = /^0{40}$/;

/** Keep in lockstep with `.github/workflows/secret-scan.yml` env pins. */
export const PINNED_GITLEAKS_LINUX_X64 = {
  version: "8.30.1",
  sha256: "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb",
};

export function resolveGitleaksScanRange({ eventName, pinnedBase, pinnedHead, checkedOutHead }) {
  if (!pinnedHead || !checkedOutHead) {
    throw new Error("pinnedHead and checkedOutHead are required for a pinned Gitleaks scan.");
  }
  if (pinnedHead !== checkedOutHead) {
    throw new Error(
      `Checked-out HEAD ${checkedOutHead} does not match pinned event head ${pinnedHead}. ` +
        "Refuse to scan an unstable tip (issue #097).",
    );
  }

  const base = typeof pinnedBase === "string" ? pinnedBase.trim() : "";
  if (eventName === "merge_group") {
    if (!/^[0-9a-f]{40}$/.test(base) || zeroSha.test(base)) {
      throw new Error(
        `merge_group needs merge_group.base_sha to scan the full queued range; got "${base}". ` +
          "Refusing a tip-only scan of a merge candidate.",
      );
    }
    return { mode: "range", base, head: pinnedHead, logOpts: `${base}..${pinnedHead}` };
  }
  const useRange =
    (eventName === "pull_request" || eventName === "pull_request_target" || eventName === "push") &&
    base.length > 0 &&
    !zeroSha.test(base);

  if (useRange) {
    return { mode: "range", base, head: pinnedHead, logOpts: `${base}..${pinnedHead}` };
  }

  // schedule / workflow_dispatch / unreachable before-sha: scan the tip commit only.
  return { mode: "tip", base: null, head: pinnedHead, logOpts: "-1" };
}

/**
 * merge_group only: the pinned base must exist in this checkout and be an ancestor of the head,
 * or the `base..head` log would scan the wrong (or no) commits. Throws to fail the job closed.
 */
export function assertMergeGroupBaseAvailable({ base, head, gitOk }) {
  if (!gitOk(["cat-file", "-e", `${base}^{commit}`])) {
    throw new Error(`merge_group base ${base} is not in the checkout; refusing to scan an incomplete range.`);
  }
  if (!gitOk(["merge-base", "--is-ancestor", base, head])) {
    throw new Error(`merge_group base ${base} is not an ancestor of ${head}; refusing to scan an unrelated range.`);
  }
}

function selfTest() {
  const head = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const base = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  const pr = resolveGitleaksScanRange({
    eventName: "pull_request",
    pinnedBase: base,
    pinnedHead: head,
    checkedOutHead: head,
  });
  if (pr.mode !== "range" || pr.logOpts !== `${base}..${head}`) {
    throw new Error(`expected PR range scan, got ${JSON.stringify(pr)}`);
  }

  let failed = false;
  try {
    resolveGitleaksScanRange({
      eventName: "pull_request",
      pinnedBase: base,
      pinnedHead: head,
      checkedOutHead: "cccccccccccccccccccccccccccccccccccccccc",
    });
  } catch {
    failed = true;
  }
  if (!failed) throw new Error("expected mismatch between pinned head and checkout to throw");

  const schedule = resolveGitleaksScanRange({
    eventName: "schedule",
    pinnedBase: "",
    pinnedHead: head,
    checkedOutHead: head,
  });
  if (schedule.mode !== "tip" || schedule.logOpts !== "-1") {
    throw new Error(`expected tip scan for schedule, got ${JSON.stringify(schedule)}`);
  }

  const zeroBefore = resolveGitleaksScanRange({
    eventName: "push",
    pinnedBase: "0000000000000000000000000000000000000000",
    pinnedHead: head,
    checkedOutHead: head,
  });
  if (zeroBefore.mode !== "tip") {
    throw new Error(`expected tip scan for zero before-sha, got ${JSON.stringify(zeroBefore)}`);
  }

  const queued = resolveGitleaksScanRange({
    eventName: "merge_group",
    pinnedBase: base,
    pinnedHead: head,
    checkedOutHead: head,
  });
  if (queued.mode !== "range" || queued.logOpts !== `${base}..${head}`) {
    throw new Error(`expected merge_group range scan, got ${JSON.stringify(queued)}`);
  }
  for (const missing of ["", "0000000000000000000000000000000000000000", "not-a-sha"]) {
    let threw = false;
    try {
      resolveGitleaksScanRange({
        eventName: "merge_group",
        pinnedBase: missing,
        pinnedHead: head,
        checkedOutHead: head,
      });
    } catch {
      threw = true;
    }
    if (!threw) throw new Error(`expected merge_group with base "${missing}" to fail closed`);
  }
  for (const [label, gitOk] of [
    ["absent base", (args) => args[0] !== "cat-file"],
    ["non-ancestor base", (args) => args[0] !== "merge-base"],
  ]) {
    let threw = false;
    try {
      assertMergeGroupBaseAvailable({ base, head, gitOk });
    } catch {
      threw = true;
    }
    if (!threw) throw new Error(`expected merge_group ${label} to fail closed`);
  }
  assertMergeGroupBaseAvailable({ base, head, gitOk: () => true });

  const workflowPath = join(dirname(fileURLToPath(import.meta.url)), "..", ".github", "workflows", "secret-scan.yml");
  const workflow = readFileSync(workflowPath, "utf8");
  if (!workflow.includes(`GITLEAKS_VERSION: "${PINNED_GITLEAKS_LINUX_X64.version}"`)) {
    throw new Error(`secret-scan.yml must pin GITLEAKS_VERSION to ${PINNED_GITLEAKS_LINUX_X64.version}`);
  }
  if (!workflow.includes(`GITLEAKS_LINUX_X64_SHA256: "${PINNED_GITLEAKS_LINUX_X64.sha256}"`)) {
    throw new Error("secret-scan.yml must pin GITLEAKS_LINUX_X64_SHA256 to the release checksum");
  }
  if (
    /if: github\.event_name != 'merge_group'/.test(workflow) ||
    !workflow.includes("github.event.merge_group.base_sha")
  ) {
    throw new Error("secret-scan.yml must scan merge_group candidates over merge_group.base_sha..head_sha");
  }
  if (!workflow.includes("sha256sum -c -")) {
    throw new Error("secret-scan.yml must verify the Gitleaks archive with sha256sum before install");
  }

  console.log("Pinned Gitleaks range self-test passed.");
}

function runGit(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (childProcessExitCode(result) !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function main(argv) {
  if (argv.includes("--self-test")) {
    selfTest();
    return;
  }

  const eventName = process.env.GITHUB_EVENT_NAME || "";
  const pinnedBase = process.env.GITLEAKS_PINNED_BASE || "";
  const pinnedHead = process.env.GITLEAKS_PINNED_HEAD || "";
  const gitleaksBin = process.env.GITLEAKS_BIN || "gitleaks";
  const checkedOutHead = runGit(["rev-parse", "HEAD"]);
  const range = resolveGitleaksScanRange({
    eventName,
    pinnedBase,
    pinnedHead,
    checkedOutHead,
  });

  if (eventName === "merge_group") {
    assertMergeGroupBaseAvailable({
      base: range.base,
      head: range.head,
      gitOk: (args) => childProcessExitCode(spawnSync("git", args, { encoding: "utf8" })) === 0,
    });
  }

  console.log(`Pinned Gitleaks scan mode=${range.mode} log-opts=${range.logOpts}`);
  const args = ["detect", "--source=.", `--log-opts=${range.logOpts}`, "--redact", "--verbose", "--exit-code=1"];
  const result = spawnSync(gitleaksBin, args, { stdio: "inherit" });
  process.exit(childProcessExitCode(result));
}

const invokedDirectly = isDirectEntrypoint(import.meta.url);
if (invokedDirectly) {
  main(process.argv.slice(2));
}
