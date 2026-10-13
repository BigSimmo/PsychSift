#!/usr/bin/env node
/**
 * guard-push — pre-push safety net for this repo's known, repeated traps.
 *
 * Runs six independent guards; any one can BLOCK the push (non-zero exit).
 * All except the auto-merge force-push guard have an explicit override env var:
 *
 *   1. Auto-merge force-push guard (all PR branches)
 *      Per-PR auto-merge state is user-owned. An ordinary fast-forward push to a PR
 *      whose auto-merge is already armed is safe — GitHub re-validates required
 *      checks against the new head before it will merge, so an additive commit
 *      cannot make it merge something unvalidated. That is allowed through with a
 *      warning note. A force-push (history rewrite) while armed is different: it
 *      can discard the commit GitHub already validated or is mid-evaluating, and
 *      for actors without write permission GitHub disables auto-merge outright. If
 *      `gh` reports an armed autoMergeRequest AND this push force-updates that
 *      branch, block without an automation override.
 *      Fails OPEN (never blocks) when gh is missing/unauthenticated, so
 *      contributors without gh can still push.
 *
 *   2. In-flight CI push guard (all PR branches)
 *      Detects when an operator or branch sync pushes a commit to a PR branch while
 *      required CI runs are currently in-flight (queued, in_progress, waiting, requested, pending)
 *      on GitHub Actions for that PR. Pushing a new commit restarts CI and cancels
 *      the in-flight run via cancel-in-progress, wasting runner capacity and hiding
 *      actionable test signals (see #HSSHRG).
 *      Override: SKIP_IN_FLIGHT_CI_GUARD=1.
 *
 *   3. Format-before-push
 *      verify:cheap does NOT run format:check but CI requires it, so unformatted
 *      files reach CI and fail there. Reproduces what CI sees: the pushed blobs
 *      *and* the pushed prettier config are materialised into a scratch tree and
 *      checked there. Neither half can come from the working copy — formatting
 *      after committing, or correcting a committed config without committing the
 *      correction, both left the guard green and CI red.
 *      Override: SKIP_FORMAT_GUARD=1.
 *
 *   4. Drift-manifest freshness
 *      Editing supabase/schema.sql without regenerating supabase/drift-manifest.json
 *      fails check:drift in CI. Caught here at push time instead. Override:
 *      SKIP_DRIFT_GUARD=1.
 *
 *   5. Static gate (lint + source typecheck)
 *      Neither lint nor typecheck was in the pre-push path, so a plain lint error
 *      (PR #1606) and a plain type error (PR #1618) each burned a full CI cycle
 *      for a defect one local command would have caught. Runs eslint over the
 *      pushed files and tsc over tsconfig.typecheck.json — the source-only
 *      config, so a stale .next/dev/types validator cannot make it red for a
 *      defect that is not in the push. Both are incremental (seconds when warm).
 *      Skips loudly when node_modules is absent. Override: SKIP_STATIC_GUARD=1.
 *
 *   6. Ledger write discipline
 *      The historical Markdown ledgers are serial-only. Feature PRs add immutable
 *      review records or issue-inbox JSON; only a verified transaction may change
 *      the canonical issue ledger. Override: SKIP_LEDGER_WRITE_GUARD=1.
 *
 * The .githooks/pre-push hook invokes this with the raw `git push` stdin (lines of
 * "<localRef> <localSha> <remoteRef> <remoteSha>"). Run `--self-test` for the
 * offline unit checks used by tests/guard-push.test.ts.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmdirSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

const ZERO_SHA = "0000000000000000000000000000000000000000";
const MAIN_REMOTE_REF = "refs/remotes/origin/main";
const SCHEMA_PATH = "supabase/schema.sql";
const MANIFEST_PATH = "supabase/drift-manifest.json";
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LEDGER_WRITE_CHECK = path.join(PROJECT_ROOT, "scripts", "check-ledger-write-discipline.mjs");
const LEDGER_HOT_PATHS = new Set(["docs/branch-review-ledger.md", "docs/outstanding-issues.md"]);

/**
 * sha256 over CRLF-normalized schema text. MUST stay byte-identical to
 * normalizedSchemaSha256() in scripts/check-drift.ts — tests/guard-push.test.ts
 * asserts parity so the two cannot silently diverge.
 */
export function normalizedSchemaSha256(schemaSqlText) {
  return createHash("sha256").update(schemaSqlText.replace(/\r\n/g, "\n")).digest("hex");
}

function runGit(args, cwd = PROJECT_ROOT) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function tryGit(args, cwd = PROJECT_ROOT) {
  try {
    return runGit(args, cwd);
  } catch {
    return undefined;
  }
}

function currentBranch() {
  return tryGit(["rev-parse", "--abbrev-ref", "HEAD"]) ?? "";
}

/**
 * Resolve the set of files being pushed from the pre-push stdin payload. Each
 * line is "<localRef> <localSha> <remoteRef> <remoteSha>". For a brand-new remote
 * branch (remoteSha all-zero) we use PR-style three-dot scope against origin/main
 * so main-only commits cannot inflate the changed-file command line. Deletion
 * pushes (local sha all-zero) are dropped, so an empty array means "nothing to
 * check".
 */
export function parsePushRanges(stdinText) {
  const ranges = [];
  for (const raw of stdinText.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const [localRef, localSha, remoteRef, remoteSha] = line.split(/\s+/);
    if (!localSha || localSha === ZERO_SHA) continue; // branch deletion — nothing to push
    ranges.push({ localRef, localSha, remoteRef, remoteSha: remoteSha ?? ZERO_SHA });
  }
  return ranges;
}

/** Exported for tests: resolve the remote PR branches a push will mutate. */
export function pushedBranchNames(ranges, fallbackBranch = "") {
  const branches = new Set();
  for (const range of ranges) {
    const ref = range.remoteRef || range.localRef || "";
    if (ref.startsWith("refs/heads/")) branches.add(ref.slice("refs/heads/".length));
  }
  if (branches.size === 0 && fallbackBranch) branches.add(fallbackBranch);
  return [...branches];
}

/** True when `ancestor` is reachable from `descendant`, i.e. the push fast-forwards. */
function isAncestor(ancestor, descendant, cwd = PROJECT_ROOT) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], { cwd, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Exported for tests: true when this range rewrites the remote branch's history
 * (force-push) rather than fast-forwarding it. A brand-new branch (remote sha
 * all-zero) is never a force-push — there is no prior tip to discard. */
export function isForcePushRange(range, cwd = PROJECT_ROOT) {
  if (!range.remoteSha || range.remoteSha === ZERO_SHA) return false;
  return !isAncestor(range.remoteSha, range.localSha, cwd);
}

/** Exported for tests: branches this push force-updates — the one case the
 * auto-merge guard still hard-blocks while armed, with no override. */
export function forcePushedBranchNames(ranges, cwd = PROJECT_ROOT) {
  const branches = new Set();
  for (const range of ranges) {
    if (!isForcePushRange(range, cwd)) continue;
    const ref = range.remoteRef || range.localRef || "";
    if (ref.startsWith("refs/heads/")) branches.add(ref.slice("refs/heads/".length));
  }
  return branches;
}

/** Merge base with origin/main — the base a PR is actually evaluated against, and
 * the same one CI passes as LEDGER_WRITE_BASE_SHA (.github/workflows/ci.yml). */
function mainMergeBase(range, cwd = PROJECT_ROOT) {
  if (!tryGit(["rev-parse", "--verify", "--quiet", MAIN_REMOTE_REF], cwd)) return undefined;
  return tryGit(["merge-base", MAIN_REMOTE_REF, range.localSha], cwd);
}

/** Return the merge base with main when this fast-forward newly integrates
 * commits from origin/main. Comparing from the old feature tip would otherwise
 * treat main-only ledger transactions as changes introduced by the feature push. */
function newlyIntegratedMainMergeBase(range, cwd = PROJECT_ROOT) {
  if (!range.remoteSha || range.remoteSha === ZERO_SHA) return undefined;
  if (!isAncestor(range.remoteSha, range.localSha, cwd)) return undefined;
  const mergeBase = mainMergeBase(range, cwd);
  if (!mergeBase) return undefined;
  return isAncestor(mergeBase, range.remoteSha, cwd) ? undefined : mergeBase;
}

/** Exported for tests: a fast-forward push normally compares from its remote
 * tip. When it freshly integrates main commits, compare from that merge base so
 * main-only changes are out of scope. A new branch, or one whose history was
 * rewritten, compares from the PR merge base for the same reason.
 *
 * The rewritten-history case matters: after a force-push the old remote tip is an
 * abandoned line, so every request it carried reads as deleted and the ledger
 * transaction guard can never pass — no matter how clean the rebuild is. Falling
 * back to the merge base asks the question CI asks instead of an unanswerable one. */
export function guardBaseForRange(range, cwd = PROJECT_ROOT) {
  if (range.remoteSha && range.remoteSha !== ZERO_SHA) {
    if (isAncestor(range.remoteSha, range.localSha, cwd)) {
      return newlyIntegratedMainMergeBase(range, cwd) ?? range.remoteSha;
    }
    return mainMergeBase(range, cwd);
  }
  return mainMergeBase(range, cwd);
}

export function changedFilesForRange(range, cwd = PROJECT_ROOT) {
  // A rewritten history is treated like a new branch here for the same reason as
  // guardBaseForRange: `<abandoned tip>..<local>` is not the set of files this push
  // actually introduces relative to main.
  const existingRemote =
    range.remoteSha && range.remoteSha !== ZERO_SHA && isAncestor(range.remoteSha, range.localSha, cwd);
  const integratedMain = existingRemote ? newlyIntegratedMainMergeBase(range, cwd) : undefined;
  const hasOriginMain = !existingRemote && tryGit(["rev-parse", "--verify", "--quiet", MAIN_REMOTE_REF], cwd);
  const spec = integratedMain
    ? `${integratedMain}..${range.localSha}`
    : existingRemote
      ? `${range.remoteSha}..${range.localSha}`
      : hasOriginMain
        ? `${MAIN_REMOTE_REF}...${range.localSha}`
        : undefined;
  let out = spec
    ? tryGit(["diff", "--name-only", spec], cwd)
    : tryGit(["show", "--name-only", "--pretty=format:", range.localSha], cwd);
  if (out === undefined && !existingRemote && hasOriginMain) {
    // Three-dot scope requires a merge base. Orphan branches and ancestry-
    // incomplete clones can have origin/main without one; conservatively compare
    // the endpoint trees so a Git error cannot become "no changed files".
    out = tryGit(["diff", "--name-only", `${MAIN_REMOTE_REF}..${range.localSha}`], cwd);
  }
  if (!out) return [];
  return out
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);
}

function collectChangedFiles(ranges) {
  const files = new Set();
  for (const range of ranges) {
    for (const file of changedFilesForRange(range)) files.add(file);
  }
  return [...files];
}

/**
 * Changed files paired with the commit they are being pushed at.
 *
 * A push sends commits, not the working tree. Checking `<file>` on disk lets a
 * formatted working copy vouch for an unformatted committed blob: commit
 * `const a   =    1`, run `npm run format`, and `prettier --check <path>` passes
 * while `git show HEAD:<path>` is still unformatted — so the guard went green and
 * CI failed anyway. Carry the sha so the guard can read what is actually pushed.
 */
function collectChangedBlobs(ranges) {
  const seen = new Map();
  for (const range of ranges) {
    for (const file of changedFilesForRange(range)) {
      seen.set(`${range.localSha}:${file}`, { sha: range.localSha, file });
    }
  }
  return [...seen.values()];
}

// ---------------------------------------------------------------------------
// Guard 1: auto-merge race sentinel
// ---------------------------------------------------------------------------
function ghIsAvailable() {
  try {
    execFileSync("gh", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Exported for tests: decide from a parsed `gh pr view` payload.
 *
 * Auto-merge itself is user-owned, so automation never disables/re-enables it —
 * that stays a hard, unconditional rule with no code path here at all. An
 * ordinary fast-forward push while armed is allowed through (with a warning):
 * GitHub re-validates required checks against the new head before it merges, so
 * an additive commit cannot make it merge something that was never validated. A
 * force-push while armed is the actual race — it can discard the commit GitHub
 * already validated or is mid-evaluating — so that alone still blocks.
 */
export function autoMergeVerdict(branch, prPayload, isForcePush = false, carriesMigration = false) {
  if (!prPayload) return { block: false, warn: false, reason: "no-open-pr" };
  if (prPayload.state && prPayload.state !== "OPEN") return { block: false, warn: false, reason: "pr-not-open" };
  if (prPayload.autoMergeRequest) {
    // Merging to `main` applies migrations to the live clinical database automatically,
    // within seconds, with no deploy step in between (AGENTS.md, "Supabase project safety").
    // Auto-merge on such a PR therefore schedules an unattended production schema change,
    // which is why AGENTS.md forbids it outright. That rule was documentation-only until
    // this branch: nothing in the push path knew what a migration was.
    if (carriesMigration) {
      return { block: true, warn: false, reason: "auto-merge-armed-migration", number: prPayload.number };
    }
    if (isForcePush) {
      return { block: true, warn: false, reason: "auto-merge-armed-force-push", number: prPayload.number };
    }
    return { block: false, warn: true, reason: "auto-merge-armed-fast-forward", number: prPayload.number };
  }
  return { block: false, warn: false, reason: "auto-merge-not-armed" };
}

/** Exported for tests: does this push carry a hosted migration? */
export function touchesProductionMigrations(changedFiles = []) {
  return changedFiles.some((f) => f.startsWith("supabase/migrations/"));
}

function autoMergeGuard(branches, forcePushBranches = new Set(), changedFiles = []) {
  if (!ghIsAvailable()) {
    return { name: "auto-merge", ok: true, note: "gh not available — auto-merge check skipped (fail-open)" };
  }
  const warnings = [];
  const migrations = touchesProductionMigrations(changedFiles);
  for (const branch of branches) {
    let payload;
    try {
      const raw = execFileSync("gh", ["pr", "view", branch, "--json", "autoMergeRequest,state,number"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      payload = JSON.parse(raw);
    } catch {
      // No PR for this branch, or gh unauthenticated: fail open.
      continue;
    }
    const verdict = autoMergeVerdict(branch, payload, forcePushBranches.has(branch), migrations);
    if (verdict.block) {
      const message =
        verdict.reason === "auto-merge-armed-migration"
          ? `PR #${verdict.number} on ${branch} has auto-merge ARMED and this push carries a hosted migration.\n` +
            `  Merging to main applies migrations to the LIVE clinical database automatically, within seconds.\n` +
            `  Auto-merge on a migration PR therefore schedules an unattended production schema change.\n` +
            `  Ask the user to disable auto-merge and merge it inside an approved window. No override.`
          : `PR #${verdict.number} on ${branch} has auto-merge ARMED and this push force-updates the branch.\n` +
            `  A force-push while armed can discard the commit GitHub already validated or is mid-evaluating.\n` +
            `  Push a fast-forward commit instead, or wait for the user to change the auto-merge state. No override.`;
      return { name: "auto-merge", ok: false, message };
    }
    if (verdict.warn) {
      warnings.push(`PR #${verdict.number} on ${branch} has auto-merge ARMED — pushing anyway (fast-forward).`);
    }
  }
  if (warnings.length > 0) {
    return {
      name: "auto-merge",
      ok: true,
      note:
        warnings.join(" ") +
        " Auto-merge state is still user-owned — do not disable/re-enable it, and never force-push while armed.",
    };
  }
  return { name: "auto-merge", ok: true };
}

// ---------------------------------------------------------------------------
// Guard 2: in-flight CI push guard (#HSSHRG)
// ---------------------------------------------------------------------------
export const ACTIVE_CI_RUN_STATES = new Set(["pending", "queued", "in_progress", "requested", "waiting"]);

export function isRequiredCiWorkflow(run) {
  if (!run) return false;
  const name = String(run.name || run.workflowName || "").trim();
  if (name === "CI") return true;
  const workflowPath = String(run.path || run.workflow_path || "").replaceAll("\\", "/");
  return /(?:^|\/)ci\.yml$/.test(workflowPath);
}

export function findInFlightCiRuns(runsPayload) {
  const runs = Array.isArray(runsPayload)
    ? runsPayload
    : Array.isArray(runsPayload?.workflow_runs)
      ? runsPayload.workflow_runs
      : [];

  return runs.filter((run) => {
    if (!isRequiredCiWorkflow(run)) return false;
    const status = String(run.status || "").toLowerCase();
    const conclusion = String(run.conclusion || "").toLowerCase();
    if (conclusion && conclusion !== "null" && conclusion !== "undefined" && conclusion !== "") {
      return false;
    }
    return ACTIVE_CI_RUN_STATES.has(status);
  });
}

export function inFlightCiVerdict(branch, prPayload, runsPayload) {
  if (!branch || branch === "main" || branch === "master" || branch.startsWith("release/")) {
    return { block: false, reason: "base-branch" };
  }
  if (!prPayload) return { block: false, reason: "no-open-pr" };
  if (prPayload.state && prPayload.state !== "OPEN") return { block: false, reason: "pr-not-open" };

  const inFlight = findInFlightCiRuns(runsPayload);
  if (inFlight.length === 0) {
    return { block: false, reason: "no-in-flight-ci", number: prPayload.number };
  }

  return {
    block: true,
    reason: "required-ci-in-flight",
    number: prPayload.number,
    runs: inFlight,
  };
}

function defaultPrView(branch) {
  try {
    const raw = execFileSync("gh", ["pr", "view", branch, "--json", "number,state,headRefOid,headRefName,url"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function defaultRunsFetch(branch, exec = execFileSync) {
  try {
    // Scope to the required CI workflow and page across the full run history. A
    // bare `--limit 10` over every workflow can hide an older in-flight CI run
    // behind newer non-CI runs, which would let the push through and cancel the
    // run this guard exists to protect (#HSSHRG).
    const raw = exec(
      "gh",
      [
        "run",
        "list",
        "--branch",
        branch,
        "--workflow",
        "ci.yml",
        "--limit",
        "100",
        "--json",
        "databaseId,name,workflowName,status,conclusion,url,headSha",
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function inFlightCiGuard(
  branches,
  _ranges = [],
  // `ghAvailable` is injectable for the same reason `prViewer`/`runFetcher` are: without it
  // the fail-open below short-circuits before either injected fetcher is consulted, so the
  // message-formatting cases could only ever run where the `gh` binary happens to be
  // installed. They passed in CI and failed in every container without it, which reads as a
  // product regression and is not one.
  { prViewer = defaultPrView, runFetcher = defaultRunsFetch, ghAvailable = ghIsAvailable } = {},
) {
  void _ranges;
  if (process.env.SKIP_IN_FLIGHT_CI_GUARD === "1") {
    return { name: "in-flight-ci", ok: true, skipped: "SKIP_IN_FLIGHT_CI_GUARD=1" };
  }
  if (!ghAvailable()) {
    return { name: "in-flight-ci", ok: true, note: "gh not available — in-flight CI check skipped (fail-open)" };
  }

  for (const branch of branches) {
    if (!branch || branch === "main" || branch === "master" || branch.startsWith("release/")) continue;
    const prPayload = prViewer(branch);
    if (!prPayload || prPayload.state !== "OPEN") continue;

    const runsPayload = runFetcher(branch);
    const verdict = inFlightCiVerdict(branch, prPayload, runsPayload);
    if (verdict.block) {
      const runLines = verdict.runs
        .map(
          (r) =>
            `  - Run ${r.databaseId || r.id || ""}: ${r.name || r.workflowName || "CI"} (${r.status || "in_progress"})${r.url ? ` ${r.url}` : ""}`,
        )
        .join("\n");
      return {
        name: "in-flight-ci",
        ok: false,
        message:
          `PR #${verdict.number} on ${branch} has required CI run(s) currently IN-FLIGHT on GitHub Actions:\n` +
          `${runLines}\n` +
          `  Pushing a new commit now will cancel the in-flight run via cancel-in-progress and restart CI (#HSSHRG).\n` +
          `  Wait for the in-flight run to finish before pushing, or override with:\n` +
          `    SKIP_IN_FLIGHT_CI_GUARD=1 git push`,
      };
    }
  }

  return { name: "in-flight-ci", ok: true };
}

// ---------------------------------------------------------------------------
// Guard 3: format-before-push
// ---------------------------------------------------------------------------
function fileSha256(file) {
  try {
    return createHash("sha256").update(readFileSync(file)).digest("hex");
  } catch {
    return undefined;
  }
}

function worktreeRoots() {
  const output = tryGit(["worktree", "list", "--porcelain"]);
  if (!output) return [];
  return output
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length).trim());
}

/**
 * Find Prettier only in a dependency tree produced from this exact lockfile.
 *
 * Isolated worktrees commonly junction a sibling node_modules tree. The push
 * guard must work before that junction exists, but accepting an arbitrary
 * sibling would let a stale Prettier version disagree with CI. Byte-identical
 * lockfiles plus the installed package version make the fallback deterministic.
 *
 * The borrow is deliberately NOT gated on whether the donor worktree is idle.
 * "Actively in use" is not cheaply detectable — an in-flight `npm ci` in another
 * process leaves nothing this can read — and a heuristic that misfires would
 * silently disable the format guard. The borrow is read-only; the deletion risk
 * lived entirely in the scratch checkout's teardown, which unlinkDependencyLink
 * and cleanupFormatCheckout now handle without following the link.
 */
export function findPrettierBin(projectRoot, candidateRoots) {
  const lockPath = path.join(projectRoot, "package-lock.json");
  const lockSha = fileSha256(lockPath);
  let lockedVersion;
  try {
    lockedVersion = JSON.parse(readFileSync(lockPath, "utf8")).packages?.["node_modules/prettier"]?.version;
  } catch {
    return undefined;
  }
  if (!lockSha || !lockedVersion) return undefined;

  const roots = [projectRoot, ...candidateRoots.filter((root) => path.resolve(root) !== path.resolve(projectRoot))];
  for (const root of roots) {
    if (fileSha256(path.join(root, "package-lock.json")) !== lockSha) continue;
    const packageRoot = path.join(root, "node_modules", "prettier");
    const prettierBin = path.join(packageRoot, "bin", "prettier.cjs");
    if (!existsSync(prettierBin)) continue;
    try {
      if (JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8")).version === lockedVersion) {
        return prettierBin;
      }
    } catch {
      // An incomplete candidate is not a usable dependency source.
    }
  }
  return undefined;
}

function resolvePrettierBin() {
  const prettierBin = findPrettierBin(PROJECT_ROOT, worktreeRoots());
  if (!prettierBin) {
    throw new Error("no exact-lock worktree provides node_modules/prettier");
  }
  return prettierBin;
}

/**
 * Does this path decide Prettier's verdict for files other than itself?
 *
 * Matched on the basename so a nested config counts too. When one of these
 * changes, the verdict for *unchanged* files can change with it — a `tabWidth`
 * edit can make existing source fail CI's repository-wide `prettier --check .`
 * while a changed-paths-only check passes — so a policy change escalates to a
 * whole-tree check.
 */
/** Does `<ref>:<file>` parse as JSON carrying a top-level `prettier` field? */
function carriesPrettierField(ref, file) {
  const contents = tryGit(["show", `${ref}:${file}`]);
  if (contents === undefined) return false; // absent at this ref (or no such ref)
  try {
    return JSON.parse(contents).prettier !== undefined;
  } catch {
    // Unparseable: assume it is policy rather than assume it is not.
    return true;
  }
}

/**
 * Does this path decide Prettier's verdict for files other than itself?
 *
 * A package.json counts only when it actually carries a `prettier` field —
 * matching every package.json would send each routine dependency bump through a
 * whole-tree check it cannot possibly need. **Both endpoints are inspected**, not
 * just the pushed one: adding a field and removing one each re-decide the verdict
 * for untouched files, and reading only the pushed side misses the removal (drop
 * `tabWidth: 4` and four-space-formatted source starts failing CI).
 */
function isPrettierPolicyFile(file, sha) {
  const base = path.basename(file);
  if (/^(?:\.prettierrc(?:\..+)?|prettier\.config\.(?:js|cjs|mjs|ts)|\.prettierignore|\.editorconfig)$/.test(base)) {
    return true;
  }
  if (base !== "package.json") return false;
  return carriesPrettierField(sha, file) || carriesPrettierField(`${sha}^`, file);
}

/**
 * Check the pushed commit the way CI does: in a real checkout of it.
 *
 * A worktree is what makes the verdict trustworthy, and it is cheap (<1s here).
 * Every earlier attempt leaked working-tree state into the answer:
 * - checking `<file>` on disk let a formatted working copy vouch for an
 *   unformatted committed blob (a push sends commits, not the working tree)
 * - piping committed blobs through stdin still resolved `.prettierrc` from disk,
 *   so a committed-broken/tree-corrected config passed here and failed CI
 * - hand-staging config files could not evaluate a dynamic `prettier.config.mjs`
 *   at all, because it may import plugins from `node_modules`
 * A checkout with `node_modules` linked in has none of those gaps.
 */
function checkPushedCommit(prettierBin, sha, files) {
  tryGit(["worktree", "prune"]); // clear any worktree a crashed run left behind
  const dir = mkdtempSync(path.join(tmpdir(), "guard-push-format-"));
  rmSync(dir, { recursive: true, force: true }); // `git worktree add` wants a fresh path
  try {
    execFileSync("git", ["worktree", "add", "--detach", "--quiet", dir, sha], {
      stdio: ["ignore", "ignore", "pipe"],
    });
  } catch (error) {
    // Fail CLOSED. Being unable to check is not evidence that the push is clean,
    // and SKIP_FORMAT_GUARD=1 is the escape hatch when this is genuinely stuck.
    const detail = (error?.stderr ? error.stderr.toString() : "").trim();
    return {
      verdict: "error",
      detail: `could not check out ${sha} to verify formatting${detail ? `: ${detail}` : ""}`,
    };
  }
  try {
    // The Prettier doing the checking is this checkout's, not the pushed
    // lockfile's. That only matters when the push changes dependencies — then a
    // version difference can make CI disagree with this verdict, so say so rather
    // than answer confidently with the wrong Prettier.
    if (files.some((file) => ["package.json", "package-lock.json"].includes(path.basename(file)))) {
      const mismatch = prettierVersionMismatch(prettierBin, dir);
      if (mismatch) return { verdict: "error", detail: mismatch };
    }
    // A dynamic config may import plugins; without this it cannot load at all.
    const modules = path.dirname(path.dirname(path.dirname(prettierBin)));
    try {
      symlinkSync(modules, path.join(dir, "node_modules"), process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      return {
        verdict: "error",
        detail: `could not link the exact-lock dependency tree into the formatting checkout: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    const policyChanged = files.some((file) => isPrettierPolicyFile(file, sha));
    // Deleted paths are gone from the checkout, and prettier errors on a missing
    // argument, so ask only for what is actually there.
    const present = files.filter((file) => existsSync(path.join(dir, file)));
    if (!policyChanged && present.length === 0) return { verdict: "formatted" };
    // A policy change alters the verdict for files this push never touched, so
    // check the whole tree — exactly what CI's `prettier --check .` does.
    const batches = policyChanged ? [["."]] : chunk(present, 200);
    for (const batch of batches) {
      const result = runPrettierCheck(prettierBin, dir, batch);
      if (result.verdict !== "formatted") return result;
    }
    return { verdict: "formatted" };
  } finally {
    cleanupFormatCheckout(dir);
  }
}

/**
 * Remove the linked dependency tree from a scratch checkout WITHOUT following it.
 *
 * That link is not necessarily this worktree's own `node_modules`. When the
 * pushing worktree has none, findPrettierBin deliberately borrows ANOTHER
 * worktree's real tree, and on Windows the borrow is linked in as a junction.
 * Everything cleanupFormatCheckout runs afterwards — `git worktree remove
 * --force` and a recursive rmSync — is a force-delete over the directory holding
 * that link, and neither respects `git worktree lock`. So the link is removed
 * first, by a call that operates on the link itself rather than on what it points
 * at.
 *
 * lstat, not existsSync: existsSync FOLLOWS the link, so once the borrowed tree
 * has gone away the link reads as absent and an existsSync-gated cleanup skips
 * it — leaving it in place for the force-deletes to interpret instead. lstat
 * sees the link whether or not it still resolves.
 *
 * unlink removes a junction and a POSIX directory symlink alike, and Windows can
 * want rmdir for a directory reparse point; rmdir on a junction also removes the
 * link, never its target. Neither call descends, and rmSync({recursive:true}) is
 * never used on this path under any branch.
 *
 * A real directory here is refused outright. Nothing in guard-push creates one,
 * so one means something unexpected — and recursively deleting an unexpected
 * directory is precisely the outcome this function exists to prevent.
 *
 * @returns {{removed: boolean, reason: "unlink"|"rmdir"|"absent"|"not-a-link"|"unreadable"|"failed", detail?: string}}
 */
export function unlinkDependencyLink(linkPath) {
  let stats;
  try {
    stats = lstatSync(linkPath);
  } catch (error) {
    if (error?.code === "ENOENT") return { removed: false, reason: "absent" };
    return { removed: false, reason: "unreadable", detail: describeError(error) };
  }
  if (!stats.isSymbolicLink()) return { removed: false, reason: "not-a-link" };
  try {
    unlinkSync(linkPath);
    return { removed: true, reason: "unlink" };
  } catch {
    // A directory reparse point can refuse unlink on Windows; rmdir removes the
    // link itself in that case, and still never touches the target.
  }
  try {
    rmdirSync(linkPath);
    return { removed: true, reason: "rmdir" };
  } catch (error) {
    return { removed: false, reason: "failed", detail: describeError(error) };
  }
}

function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Tear down a format-check scratch checkout, link first.
 *
 * The ordering is the point: the link is gone before `git worktree remove
 * --force` and before the recursive delete, so whether either of those can
 * traverse a junction never has to be relied upon.
 *
 * When the link could NOT be removed, neither force-delete runs. Swallowing that
 * failure and continuing is the single case where a force-delete would run over
 * a directory still holding a live link into another worktree's node_modules. A
 * leftover scratch directory is cheap and the `git worktree prune` at the top of
 * checkPushedCommit clears its registration on the next push; the alternative is
 * not cheap.
 *
 * Dependencies are injectable so the ordering and the skip are unit-testable
 * without creating and destroying real worktrees.
 */
export function cleanupFormatCheckout(
  dir,
  {
    unlink = unlinkDependencyLink,
    removeWorktree = (target) => tryGit(["worktree", "remove", "--force", target]),
    removeDir = (target) => rmSync(target, { recursive: true, force: true }),
    log = console.error,
  } = {},
) {
  const linkPath = path.join(dir, "node_modules");
  const result = unlink(linkPath);
  if (!result.removed && result.reason !== "absent") {
    log(
      "[guard-push] left " +
        dir +
        " in place: could not remove the linked dependency tree at " +
        linkPath +
        " (" +
        result.reason +
        (result.detail ? ": " + result.detail : "") +
        ").\n" +
        "  Skipping the force worktree removal and the recursive delete — neither may run over a " +
        "directory that still holds a live link into another worktree's node_modules.\n" +
        "  Remove it by hand once nothing is using it.",
    );
    return result;
  }
  removeWorktree(dir);
  removeDir(dir);
  return result;
}

function chunk(items, size) {
  const out = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

/**
 * Does the pushed lockfile pin a different Prettier than the one installed?
 *
 * The guard formats with this checkout's Prettier while CI installs the pushed
 * lockfile, so a push that bumps Prettier itself would be judged by the wrong
 * version. Returns a message when they disagree, and null when they agree or when
 * either version cannot be read — an unknown must not manufacture a block.
 */
function prettierVersionMismatch(prettierBin, checkoutDir) {
  const readJson = (file) => {
    try {
      return JSON.parse(readFileSync(file, "utf8"));
    } catch {
      return undefined;
    }
  };
  const installed = readJson(path.join(path.dirname(path.dirname(prettierBin)), "package.json"))?.version;
  const pinned = readJson(path.join(checkoutDir, "package-lock.json"))?.packages?.["node_modules/prettier"]?.version;
  if (!installed || !pinned || installed === pinned) return null;
  return (
    `node_modules has prettier ${installed}, but the pushed lockfile pins ${pinned}, so this ` +
    `check would not match CI. Run \`npm ci\` and push again.`
  );
}

/** Prettier: 0 clean, 1 unformatted, anything else a real failure. */
function runPrettierCheck(prettierBin, cwd, args) {
  try {
    execFileSync(process.execPath, [prettierBin, "--check", "--ignore-unknown", ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { verdict: "formatted" };
  } catch (error) {
    const detail = [error?.stdout, error?.stderr]
      .map((buffer) => (buffer ? buffer.toString() : ""))
      .join("")
      .trim();
    // An invalid config option also exits 1 under --check, reported as
    // `[error] Invalid tabWidth value…`, so the status alone cannot tell a
    // formatting difference from a broken config.
    if (error?.status === 1 && !detail.includes("[error]")) return { verdict: "unformatted", detail };
    // A malformed or unloadable config in the push fails CI's `prettier --check .`
    // for the same reason. Treating it as "unknown, allow" is how the guard would
    // wave through the break it exists to catch.
    return { verdict: "error", detail: detail || `prettier exited ${error?.status ?? "non-zero"}` };
  }
}

export function formatGuard(changedBlobs, prettierResolver = resolvePrettierBin) {
  if (process.env.SKIP_FORMAT_GUARD === "1") {
    return { name: "format", ok: true, skipped: "SKIP_FORMAT_GUARD=1" };
  }
  if (changedBlobs.length === 0) return { name: "format", ok: true };
  let prettierBin;
  try {
    prettierBin = prettierResolver();
  } catch (error) {
    return {
      name: "format",
      ok: false,
      message:
        `Prettier is unavailable for this exact lockfile, so formatting cannot be verified before push.\n` +
        `  ${error instanceof Error ? error.message : String(error)}\n` +
        `  Run \`npm ci --include=dev\` in this worktree, or make an exact-lock worktree dependency tree available.\n` +
        `  To push anyway: SKIP_FORMAT_GUARD=1 git push`,
    };
  }

  const bySha = new Map();
  for (const { sha, file } of changedBlobs) {
    if (!bySha.has(sha)) bySha.set(sha, []);
    bySha.get(sha).push(file);
  }

  const unformatted = [];
  const errors = [];
  for (const [sha, files] of bySha) {
    const { verdict, detail } = checkPushedCommit(prettierBin, sha, files);
    if (verdict === "unformatted") unformatted.push(detail);
    else if (verdict === "error") errors.push(detail);
  }

  if (errors.length > 0) {
    return {
      name: "format",
      ok: false,
      message:
        `Prettier could not check this push, so CI's \`prettier --check .\` will fail too:\n` +
        errors.map((detail) => `${detail}\n`).join("") +
        `  A malformed prettier config in the push is the usual cause.\n` +
        `  To push anyway: SKIP_FORMAT_GUARD=1 git push`,
    };
  }
  if (unformatted.length === 0) return { name: "format", ok: true };
  return {
    name: "format",
    ok: false,
    message:
      `Prettier found unformatted files in this push (CI format:check would fail):\n` +
      unformatted.map((detail) => `${detail}\n`).join("") +
      `  This is a checkout of the pushed commit, not your working copy — run\n` +
      `  \`npm run format\` and commit the result.\n` +
      `  To push anyway: SKIP_FORMAT_GUARD=1 git push`,
  };
}

// ---------------------------------------------------------------------------
// Guard 4: drift-manifest freshness
// ---------------------------------------------------------------------------
/** Exported for tests: pure comparison of schema text vs the manifest's sha. */
export function driftVerdict(schemaText, manifestJson) {
  const expected = manifestJson?.schema_sha256;
  const actual = normalizedSchemaSha256(schemaText);
  return { stale: Boolean(expected) && expected !== actual, expected, actual };
}

function driftGuard(changedFiles) {
  if (process.env.SKIP_DRIFT_GUARD === "1") {
    return { name: "drift", ok: true, skipped: "SKIP_DRIFT_GUARD=1" };
  }
  const schemaTouched = changedFiles.some((f) => f.replaceAll("\\", "/") === SCHEMA_PATH);
  if (!schemaTouched) return { name: "drift", ok: true };
  if (!existsSync(SCHEMA_PATH) || !existsSync(MANIFEST_PATH)) return { name: "drift", ok: true };
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  } catch {
    return { name: "drift", ok: true, note: "drift-manifest.json unreadable — drift check skipped" };
  }
  const verdict = driftVerdict(readFileSync(SCHEMA_PATH, "utf8"), manifest);
  if (verdict.stale) {
    return {
      name: "drift",
      ok: false,
      message:
        `${SCHEMA_PATH} changed but ${MANIFEST_PATH} is stale (check:drift would fail).\n` +
        `  schema sha:   ${verdict.actual}\n` +
        `  manifest sha: ${verdict.expected}\n` +
        `  Regenerate with: npm run drift:manifest (needs Docker)\n` +
        `  To push anyway: SKIP_DRIFT_GUARD=1 git push`,
    };
  }
  return { name: "drift", ok: true };
}

// ---------------------------------------------------------------------------
// Guard 5: static gate (lint + source typecheck)
// ---------------------------------------------------------------------------
/**
 * Roots that `lint:internal` passes to eslint. `eslint-rules/` is linted itself,
 * and changing a custom rule also re-decides the verdict for every file that
 * loads it.
 */
const LINT_ROOTS = ["src/", "tests/", "scripts/", "worker/", "supabase/", "playwright/", "eslint-rules/"];
const LINT_ROOT_FILES = new Set([
  "eslint.config.mjs",
  "next.config.ts",
  "playwright.config.ts",
  "playwright.visual.config.ts",
  "vitest.config.mts",
]);
const LINTABLE_EXT = /\.(?:ts|tsx|mts|js|jsx|mjs|cjs)$/;
/**
 * Extensions that tsconfig.typecheck.json's `include` covers. `.cts` is
 * deliberately omitted: neither the base nor source-only config includes it, so
 * a `.cts`-only push would otherwise spend a typecheck that covers nothing.
 */
const TYPECHECKABLE_EXT = /\.(?:ts|tsx|mts)$/;
/**
 * Directory prefixes excluded by tsconfig.typecheck.json. A push that only
 * touches these paths must not pay for a source typecheck that inspects none of
 * the changed work.
 */
const TYPECHECK_EXCLUDED_PREFIXES = [
  "supabase/functions/",
  "scripts/archive/",
  "scratch/",
  "worktrees/",
  "node_modules/",
  ".next/",
];
/** Guard-private eslint cache — never share writes with `lint:internal`. */
const STATIC_GUARD_ESLINT_CACHE = "node_modules/.cache/eslint-guard-push/";
/** Short wait via run-heavy; busy coordinator fails open rather than stalling a push. */
const STATIC_GUARD_LOCK_WAIT_MS = 30_000;

/** Exported for tests: which changed paths eslint would actually cover. */
export function lintableFiles(changedFiles) {
  return changedFiles
    .map((f) => f.replaceAll("\\", "/"))
    .filter((f) => LINTABLE_EXT.test(f))
    .filter((f) => LINT_ROOT_FILES.has(f) || LINT_ROOTS.some((root) => f.startsWith(root)));
}

/** Exported for tests: path prefixes the source-only typecheck config excludes. */
export function isTypecheckExcludedPath(file) {
  const normalized = file.replaceAll("\\", "/");
  return TYPECHECK_EXCLUDED_PREFIXES.some(
    (prefix) => normalized === prefix.slice(0, -1) || normalized.startsWith(prefix),
  );
}

/** Exported for tests: does this push need a typecheck at all? */
export function needsTypecheck(changedFiles) {
  return changedFiles
    .map((f) => f.replaceAll("\\", "/"))
    .some((f) => TYPECHECKABLE_EXT.test(f) && !isTypecheckExcludedPath(f));
}

/**
 * Does this path decide eslint's verdict for files other than itself?
 * Mirrors the format guard's prettier-policy escalation.
 */
export function isEslintPolicyFile(file) {
  const normalized = file.replaceAll("\\", "/");
  return normalized === "eslint.config.mjs" || normalized.startsWith("eslint-rules/");
}

/** Exported for tests: policy change ⇒ whole-tree lint, not changed-files only. */
export function needsRepoWideLint(changedFiles) {
  return changedFiles.some((f) => isEslintPolicyFile(f));
}

/**
 * The static guard reads the working tree. When the pushed tip is not HEAD
 * (e.g. `git push origin other-branch` from a different checkout), results
 * describe unrelated content — fail closed rather than false-pass/false-block.
 */
export function pushedTipMatchesHead(ranges, headSha = tryGit(["rev-parse", "HEAD"])) {
  if (!headSha || !Array.isArray(ranges) || ranges.length === 0) return { ok: true };
  // Only branch tips are checked against HEAD. Tag / note / other refs have
  // object SHAs that are not the commit checked out in the working tree.
  const branchRanges = ranges.filter(
    (range) => !range.localRef || range.localRef === "HEAD" || range.localRef.startsWith("refs/heads/"),
  );
  if (branchRanges.length === 0) return { ok: true };
  const mismatch = branchRanges.find((range) => range.localSha && range.localSha !== headSha);
  if (!mismatch) return { ok: true };
  return { ok: false, headSha, tipSha: mismatch.localSha, localRef: mismatch.localRef };
}

/**
 * Is the local checkout able to run these tools at all?
 *
 * Unlike Prettier, eslint and tsc cannot be borrowed from a sibling worktree —
 * both resolve plugins, configs and @types from *this* checkout's node_modules,
 * so a borrowed binary would report a different answer than CI. When the tools
 * are absent the guard says so loudly and lets the push through rather than
 * blocking every worktree that has not installed yet: a missing install is not
 * the failure this guard exists to catch, and blocking on it would push people
 * straight to GUARD_PUSH_DISABLE=1, losing the format and drift guards too.
 */
function staticToolsAvailable(root) {
  return (
    existsSync(path.join(root, "node_modules", "eslint", "bin", "eslint.js")) &&
    existsSync(path.join(root, "node_modules", "typescript", "bin", "tsc"))
  );
}

/**
 * Structured admission-busy signal from `scripts/run-heavy.mjs`. Prefer this
 * over prose — tsc/eslint output can quote the busy strings (e.g.
 * `tests/test-runner-safety.test.ts`) and false-pass a real failure.
 */
export const HEAVY_RUN_ADMISSION_BUSY_EXIT = 75;
export const HEAVY_RUN_ADMISSION_BUSY_MARKER = "DATABASE_HEAVY_RUN_ADMISSION_BUSY";

/**
 * Match the busy / capacity-full wording from `scripts/test-run-lock.mjs`
 * (`busyMessage` for exclusive + shared leases, plus the initializing retry).
 * Shared-slot exhaustion says "Database focused-test capacity is full", not
 * "heavyweight" — that string must fail open here or pushes are rejected as
 * fake typecheck failures. Prefer `isCoordinatorBusyResult` when a process
 * result is available.
 */
export function isCoordinatorBusyOutput(output) {
  return /Database heavyweight|Database focused-test capacity is full|coordinator is (?:busy|being initialized)|retry shortly/i.test(
    output ?? "",
  );
}

/** Exported for tests: structured admission-busy detection (exit code or marker). */
export function isCoordinatorBusyResult(error) {
  if (!error) return false;
  if (error.status === HEAVY_RUN_ADMISSION_BUSY_EXIT) return true;
  const output = `${error.stdout ?? ""}${error.stderr ?? ""}${error.message ?? ""}`;
  return output.includes(HEAVY_RUN_ADMISSION_BUSY_MARKER);
}

/**
 * Run eslint/tsc through `scripts/run-heavy.mjs` so the push takes the same
 * exclusive/shared leases as `npm run lint` / `npm run typecheck:source`.
 * Short wait + busy → fail-open (CI still enforces both).
 */
/**
 * ⚠️ "IT FAILED" AND "IT NEVER STARTED" ARE DIFFERENT FACTS, AND THIS GUARD REPORTED THEM IN
 * IDENTICAL WORDS UNTIL 2026-09-03.
 *
 * A push of a 992-commit branch was refused with `lint failed`, and eslint had never been spawned:
 * the changed-file list built a 56,570-byte argument vector against Windows' 32,767-byte limit, so
 * the process was refused and the only output was the sentence "The command line is too long."
 * Nothing in the message distinguished that from a real lint error, and both natural readings are
 * wrong — assume the code is broken, or assume the guard is noise and override it.
 *
 * A check that never launched has found NOTHING. It is not evidence of a defect and it is not
 * evidence of cleanliness. Saying exactly that is the whole fix.
 */
const NEVER_LAUNCHED_CODES = new Set(["ENAMETOOLONG", "E2BIG", "ENOENT", "EACCES", "ENOMEM"]);

export function isNeverLaunchedFailure(error, output) {
  if (error && NEVER_LAUNCHED_CODES.has(error.code)) return true;
  const text = `${output ?? ""}
${error?.message ?? ""}`;
  return /command line is too long/i.test(text) || /argument list too long/i.test(text);
}

function runStaticCheck(root, script, forwarded, label) {
  try {
    execFileSync(
      process.execPath,
      [path.join(root, "scripts", "run-heavy.mjs"), "--npm-script", script, ...forwarded],
      {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          HEAVY_RUN_WAIT_TIMEOUT_MS: String(STATIC_GUARD_LOCK_WAIT_MS),
        },
      },
    );
    return { ok: true };
  } catch (error) {
    const output = `${error?.stdout ?? ""}${error?.stderr ?? ""}`.trim();
    if (isCoordinatorBusyResult(error) || isCoordinatorBusyOutput(output) || isCoordinatorBusyOutput(error?.message)) {
      return { ok: true, busy: true, output: output || String(error?.message ?? error) };
    }
    return { ok: false, label, output, neverLaunched: isNeverLaunchedFailure(error, output) };
  }
}

/**
 * Catch the two failures that repeatedly reach CI because `verify:cheap` is the
 * smallest gate anyone remembers to run and neither of these is in the pre-push
 * path today:
 *
 *   - a lint error (PR #1606: `react-hooks/set-state-in-effect` in
 *     search-results-header-band.tsx, red `Static PR checks`)
 *   - a type error (PR #1618: `mode.devOnly` on a union member that lacks it,
 *     red `Build` + four dependent jobs)
 *
 * Typecheck runs against tsconfig.typecheck.json, NOT the base config, so a
 * stale `.next/dev/types/validator.ts` referencing a deleted page cannot make
 * the guard red for a defect that is not in the push (docs/outstanding-issues.md
 * #210). Both tools are incremental, so the warm cost is seconds.
 *
 * Coordinator: routes through `run-heavy.mjs` (short timeout, fail-open when
 * busy) so a push cannot race `npm run lint`/`build`/`test`. Eslint writes a
 * guard-private cache; tsc gets the per-worktree buildinfo path from run-heavy.
 *
 * Caveat: this reads the working tree, not the pushed blobs. When HEAD is not
 * the pushed tip the guard fails closed. A dirty tree after committing is
 * surfaced with a note. Override: SKIP_STATIC_GUARD=1.
 *
 * @param {string[]} changedFiles
 * @param {{ ranges?: Array<{ localRef?: string, localSha?: string }> }} [options]
 */
export function staticGuard(changedFiles, options = {}) {
  if (process.env.SKIP_STATIC_GUARD === "1") {
    return { name: "static", ok: true, skipped: "SKIP_STATIC_GUARD=1" };
  }

  const repoWide = needsRepoWideLint(changedFiles);
  const toLint = repoWide ? [] : lintableFiles(changedFiles);
  const wantTypecheck = needsTypecheck(changedFiles);
  // Docs-only / tag / no-op pushes never read the working tree — skip the
  // tip-vs-HEAD fail-closed check so `git push --tags` and docs branches are
  // not blocked before we know there is nothing to lint or typecheck.
  if (!repoWide && toLint.length === 0 && !wantTypecheck) return { name: "static", ok: true };

  const tipCheck = pushedTipMatchesHead(options.ranges ?? []);
  if (!tipCheck.ok) {
    return {
      name: "static",
      ok: false,
      message:
        `static guard reads the working tree at HEAD (${tipCheck.headSha}), ` +
        `but this push tip is ${tipCheck.tipSha}` +
        (tipCheck.localRef ? ` (${tipCheck.localRef})` : "") +
        `.\n` +
        `  Check out the tip being pushed, then push again.\n` +
        `  To push anyway: SKIP_STATIC_GUARD=1 git push`,
    };
  }

  if (!staticToolsAvailable(PROJECT_ROOT)) {
    return {
      name: "static",
      ok: true,
      note:
        "eslint/typescript not installed in this checkout — lint and typecheck NOT run. " +
        "CI still enforces both; install with `npm ci --include=dev` to get pre-push coverage.",
    };
  }

  const failures = [];
  const present = toLint.filter((f) => existsSync(path.join(PROJECT_ROOT, f)));

  if (repoWide || present.length > 0) {
    const result = repoWide
      ? runStaticCheck(PROJECT_ROOT, "lint:internal", [], "lint")
      : runStaticCheck(
          PROJECT_ROOT,
          "lint:changed:internal",
          [
            ...present,
            "--max-warnings",
            "0",
            "--no-error-on-unmatched-pattern",
            "--cache",
            "--cache-location",
            STATIC_GUARD_ESLINT_CACHE,
          ],
          "lint",
        );
    if (result.busy) {
      return {
        name: "static",
        ok: true,
        note:
          `run coordinator busy — lint and typecheck NOT run (${result.output}). ` +
          `CI still enforces both; retry the push once the other heavy run finishes.`,
      };
    }
    if (!result.ok) failures.push(result);
  }

  if (wantTypecheck) {
    const result = runStaticCheck(PROJECT_ROOT, "typecheck:source:internal", [], "typecheck");
    if (result.busy) {
      // Only fail open when nothing has already failed. A prior lint failure
      // must still block — dropping it would let a proven error through and
      // waste the CI cycle this guard exists to prevent.
      if (failures.length === 0) {
        return {
          name: "static",
          ok: true,
          note:
            `run coordinator busy — typecheck NOT run (${result.output}). ` +
            `CI still enforces it; retry the push once the other heavy run finishes.`,
        };
      }
    } else if (!result.ok) {
      failures.push(result);
    }
  }

  const dirty = tryGit(["status", "--porcelain"]);
  if (failures.length === 0) {
    // Warn on success too: a dirty tree can mask errors still present in the
    // pushed commit (the format guard avoids this by materialising blobs).
    if (dirty) {
      return {
        name: "static",
        ok: true,
        note:
          "lint/typecheck passed against a dirty working tree — they may not describe the pushed commit. " +
          "Commit or stash local edits if CI disagrees.",
      };
    }
    return { name: "static", ok: true };
  }

  const dirtyNote = dirty
    ? "\n  NOTE: your working tree has uncommitted changes, so this may not describe the pushed commit exactly.\n"
    : "";
  return {
    name: "static",
    ok: false,
    message:
      failures
        .map((f) =>
          f.neverLaunched
            ? `${f.label} COULD NOT RUN — the command was never launched, so NOTHING WAS CHECKED:

` +
              `${f.output || "(no output at all: the process never started)"}

` +
              `  This is not a ${f.label} failure. This guard does not know whether your code is clean.
` +
              `  Run \`npm run ${f.label}\` directly to find out before deciding what to do.
`
            : `${f.label} failed (CI's "Static PR checks"/"Build" would fail too):

${f.output}
`,
        )
        .join("\n") +
      dirtyNote +
      `\n  Fix, commit, then push again.\n` +
      `  To push anyway: SKIP_STATIC_GUARD=1 git push`,
  };
}

// ---------------------------------------------------------------------------
// Guard 6: ledger write discipline
// ---------------------------------------------------------------------------
export function hasHotLedgerWrite(changedFiles) {
  return changedFiles.some((file) => LEDGER_HOT_PATHS.has(file.replaceAll("\\", "/")));
}

function ledgerWriteGuard(ranges) {
  if (process.env.SKIP_LEDGER_WRITE_GUARD === "1") {
    return { name: "ledger-write", ok: true, skipped: "SKIP_LEDGER_WRITE_GUARD=1" };
  }
  if (!hasHotLedgerWrite(collectChangedFiles(ranges))) return { name: "ledger-write", ok: true };

  for (const range of ranges) {
    const base = guardBaseForRange(range);
    if (!base) {
      return {
        name: "ledger-write",
        ok: true,
        note: "could not resolve a base commit for the ledger transaction check; CI will verify it",
      };
    }
    try {
      execFileSync(process.execPath, [LEDGER_WRITE_CHECK, "--base", base, "--head", range.localSha], {
        cwd: PROJECT_ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      const output = `${error?.stdout ?? ""}${error?.stderr ?? ""}`.trim();
      return {
        name: "ledger-write",
        ok: false,
        message:
          `${output || "ledger transaction check failed"}\n\n` +
          "Use immutable ledger records/inbox requests, or reconcile from a fresh ledger branch. " +
          "To push a deliberate emergency repair: SKIP_LEDGER_WRITE_GUARD=1 git push",
      };
    }
  }
  return { name: "ledger-write", ok: true };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------
function report(results) {
  const blocked = results.filter((r) => !r.ok);
  for (const r of results) {
    if (r.skipped) console.error(`[guard-push] ${r.name}: skipped (${r.skipped})`);
    else if (r.note) console.error(`[guard-push] ${r.name}: ${r.note}`);
  }
  if (blocked.length === 0) return 0;
  console.error("\n[guard-push] Push blocked:\n");
  for (const r of blocked) console.error(`✖ ${r.name}\n  ${r.message}\n`);
  return 1;
}

function main() {
  if (process.argv.includes("--self-test")) {
    return selfTest();
  }
  const stdin = readStdinSync();
  const ranges = parsePushRanges(stdin);
  if (ranges.length === 0) process.exit(0); // deletion-only push or nothing to do
  const branch = currentBranch();
  const pushedBranches = pushedBranchNames(ranges, branch);
  const forcePushBranches = forcePushedBranchNames(ranges);
  const changedFiles = collectChangedFiles(ranges);
  // formatGuard reads the pushed blobs; drift/static only need the paths.
  const results = [
    autoMergeGuard(pushedBranches, forcePushBranches, changedFiles),
    inFlightCiGuard(pushedBranches, ranges),
    formatGuard(collectChangedBlobs(ranges)),
    driftGuard(changedFiles),
    staticGuard(changedFiles, { ranges }),
    ledgerWriteGuard(ranges),
  ];
  process.exit(report(results));
}

function readStdinSync() {
  if (process.stdin.isTTY) return "";
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Self-test: offline assertions on the pure decision functions.
// ---------------------------------------------------------------------------
function assert(condition, label) {
  if (!condition) {
    console.error(`✖ self-test failed: ${label}`);
    process.exitCode = 1;
    throw new Error(label);
  }
}

function selfTest() {
  // auto-merge verdicts
  assert(
    autoMergeVerdict("codex/x", { autoMergeRequest: { enabledAt: "t" }, state: "OPEN", number: 6 }).block === false,
    "armed auto-merge does not block a fast-forward push",
  );
  assert(
    autoMergeVerdict("codex/x", { autoMergeRequest: { enabledAt: "t" }, state: "OPEN", number: 6 }).warn === true,
    "armed auto-merge still warns on a fast-forward push",
  );
  assert(
    autoMergeVerdict("claude/x", { autoMergeRequest: { enabledAt: "t" }, state: "OPEN", number: 7 }, true).block ===
      true,
    "armed auto-merge blocks a force-push",
  );
  assert(
    autoMergeVerdict("claude/x", { autoMergeRequest: null, state: "OPEN" }).block === false,
    "unarmed does not block",
  );
  assert(autoMergeVerdict("claude/x", null).block === false, "no PR does not block");
  assert(
    autoMergeVerdict("claude/x", { autoMergeRequest: {}, state: "MERGED" }).block === false,
    "non-open PR does not block",
  );

  // in-flight CI verdicts (#HSSHRG)
  const activeCiRun = { databaseId: 101, name: "CI", status: "in_progress", conclusion: null };
  const queuedCiRun = { databaseId: 102, workflowName: "CI", status: "queued", conclusion: "" };
  const completedCiRun = { databaseId: 103, name: "CI", status: "completed", conclusion: "success" };
  const nonCiRun = { databaseId: 104, name: "Deploy", status: "in_progress", conclusion: null };

  assert(
    findInFlightCiRuns([activeCiRun, completedCiRun, nonCiRun]).length === 1,
    "findInFlightCiRuns filters active CI runs",
  );
  assert(
    findInFlightCiRuns({ workflow_runs: [queuedCiRun] }).length === 1,
    "findInFlightCiRuns handles workflow_runs payload",
  );
  assert(
    inFlightCiVerdict("claude/feature", { state: "OPEN", number: 42 }, [activeCiRun]).block === true,
    "inFlightCiVerdict blocks when required CI is in-flight on open PR",
  );
  assert(
    inFlightCiVerdict("claude/feature", { state: "OPEN", number: 42 }, [completedCiRun]).block === false,
    "inFlightCiVerdict allows push when CI run is completed",
  );
  assert(
    inFlightCiVerdict("claude/feature", { state: "CLOSED", number: 42 }, [activeCiRun]).block === false,
    "inFlightCiVerdict does not block closed PRs",
  );
  assert(
    inFlightCiVerdict("main", { state: "OPEN", number: 1 }, [activeCiRun]).block === false,
    "inFlightCiVerdict never blocks base branch pushes",
  );

  const mockBlockedGuard = inFlightCiGuard(["claude/feature"], [], {
    prViewer: () => ({ state: "OPEN", number: 99 }),
    runFetcher: () => [activeCiRun],
    // Same reason as the injected fetchers: the real probe short-circuits this case on any
    // machine without `gh`, so the self-test would silently assert nothing there.
    ghAvailable: () => true,
  });
  assert(mockBlockedGuard.ok === false, "inFlightCiGuard blocks on active CI run");
  assert(
    mockBlockedGuard.message.includes("#99") && mockBlockedGuard.message.includes("101"),
    "inFlightCiGuard message names PR and run ID",
  );

  // drift verdicts
  const text = "create table t();\n";
  const sha = normalizedSchemaSha256(text);
  assert(driftVerdict(text, { schema_sha256: sha }).stale === false, "matching sha is fresh");
  assert(driftVerdict(text, { schema_sha256: "deadbeef" }).stale === true, "mismatched sha is stale");
  assert(driftVerdict(text, {}).stale === false, "no manifest sha is treated as fresh (no false block)");
  assert(normalizedSchemaSha256("a\r\nb") === normalizedSchemaSha256("a\nb"), "CRLF normalization matches LF");

  // push-range parsing
  const ranges = parsePushRanges(`refs/heads/x abc123 refs/heads/x ${ZERO_SHA}\n`);
  assert(ranges.length === 1 && ranges[0].remoteSha === ZERO_SHA, "new-branch range parsed");
  assert(parsePushRanges(`refs/heads/x ${ZERO_SHA} refs/heads/x abc\n`).length === 0, "deletion range skipped");

  const missingPrettier = formatGuard([{ sha: "abc123", file: "README.md" }], () => {
    throw new Error("missing fixture dependency");
  });
  assert(missingPrettier.ok === false, "missing Prettier fails the format guard closed");

  // static-gate scope selection
  assert(
    lintableFiles(["src/components/a.tsx", "docs/x.md", "package-lock.json"]).length === 1,
    "only lint-root source files are linted",
  );
  assert(lintableFiles(["src\\components\\a.tsx"])[0] === "src/components/a.tsx", "backslash paths are normalized");
  assert(lintableFiles(["eslint.config.mjs"]).length === 1, "root config files eslint covers are linted");
  assert(lintableFiles(["eslint-rules/require-button-wiring.mjs"]).length === 1, "eslint-rules are linted");
  assert(lintableFiles(["public/demo/x.js"]).length === 0, "files outside the lint roots are not linted");
  assert(needsTypecheck(["src/lib/a.ts"]) === true, "a changed .ts triggers typecheck");
  assert(needsTypecheck(["docs/a.md", "x.png"]) === false, "docs-only pushes skip typecheck");
  assert(needsTypecheck(["src/lib/a.cts"]) === false, ".cts is outside the source-only include and does not trigger");
  assert(
    needsTypecheck(["supabase/functions/foo/index.ts"]) === false,
    "excluded edge-function .ts does not trigger typecheck",
  );
  assert(
    needsTypecheck(["scripts/archive/old.ts", "scratch/x.tsx"]) === false,
    "archive/scratch type files do not trigger typecheck",
  );
  assert(
    isCoordinatorBusyOutput("Database focused-test capacity is full (current owner PID 1)") === true,
    "shared-slot exhaustion fails open as coordinator busy",
  );
  assert(
    isCoordinatorBusyOutput("Another Database heavyweight command is active (PID 1)") === true,
    "exclusive heavyweight busy fails open",
  );
  assert(
    isCoordinatorBusyOutput("error TS2322: Type 'string' is not assignable") === false,
    "real tsc errors still fail",
  );
  assert(needsRepoWideLint(["eslint.config.mjs"]) === true, "eslint config change escalates to repo-wide lint");
  assert(needsRepoWideLint(["eslint-rules/x.mjs"]) === true, "eslint-rules change escalates to repo-wide lint");
  assert(needsRepoWideLint(["src/lib/a.ts"]) === false, "ordinary source does not escalate lint");
  assert(pushedTipMatchesHead([{ localSha: "aaa" }], "aaa").ok === true, "matching tip and HEAD is fine");
  assert(
    pushedTipMatchesHead([{ localSha: "aaa", localRef: "HEAD" }], "aaa").ok === true,
    "matching HEAD localRef is fine",
  );
  assert(
    pushedTipMatchesHead([{ localSha: "aaa", localRef: "HEAD" }], "bbb").ok === false,
    "mismatched HEAD localRef fails closed",
  );
  assert(pushedTipMatchesHead([{ localSha: "aaa" }], "bbb").ok === false, "mismatched tip fails closed");
  assert(
    staticGuard(["docs/only.md"]).ok === true && staticGuard(["docs/only.md"]).message === undefined,
    "docs-only push is a no-op for the static guard",
  );
  assert(
    staticGuard(["src/lib/a.ts"], { ranges: [{ localSha: "deadbeef", localRef: "refs/heads/other" }] }).ok === false,
    "push tip that is not HEAD fails closed",
  );
  assert(hasHotLedgerWrite(["docs/outstanding-issues.md"]) === true, "canonical issue ledger is hot");
  assert(hasHotLedgerWrite(["docs/outstanding-issues-inbox/request.json"]) === false, "inbox writes are merge-safe");

  if (process.exitCode !== 1) console.error("[guard-push] self-test passed");
  return process.exitCode ?? 0;
}

// Only run as a CLI when invoked directly — importing (tests) must not exit.
const invokedDirectly = isDirectEntrypoint(import.meta.url);
if (invokedDirectly) {
  main();
}
