# Branch Cleanup Guide

Last reviewed: 2026-08-23

This guide defines the safe branch cleanup path for this repository. It is written for branch hygiene only: do not use it to discard source work, resolve merge conflicts, merge product changes, or rewrite history.

For historical cleanup snapshots (frozen branch inventories and progress logs), see `docs/archive/`.

## Goals

- Keep `main`, the current working branch, and any branch with useful content not yet represented on `main`.
- Delete local or remote branches only when their patch content is already on `main` or the branch is explicitly not useful.
- Preserve dirty worktrees, checked-out branches, detached review worktrees, and uncommitted user work.
- Avoid force pushes, rebases, resets, broad cleanup, or deleting unknown branch state.

## Safety Rules

Before deleting anything:

**Precondition — the clone must have full history. Check this before every other step on this
page, including the reconciliation preflight below:**

```bash
git rev-parse --is-shallow-repository       # must print false
git fetch --unshallow --tags origin         # if it printed true

git config --get-all remote.origin.fetch    # must map refs/heads/*
git remote set-branches origin '*'          # if it names a single branch
git fetch --prune origin                    # then repopulate
```

**Complete history is not complete branch coverage — check both.** `git clone --depth 1` implies
`--single-branch`, which pins `remote.origin.fetch` to the one cloned branch. `git fetch --unshallow`
converts the history, so `--is-shallow-repository` flips to `false` and the first check passes, but
it does **not** widen the refspec: every other branch stays invisible locally. Measured in a fixture
with `main` and `feature`, `git ls-remote --heads origin` listed both while `refs/remotes/origin` held
only `origin/main`, and the sweep exited **0** reporting an empty branch list. An empty inventory is
not a safe failure — it reads as "nothing to clean up", and where `origin/main` itself is missing every
comparison fails into `0/0`, making every branch look like a deletion candidate.

Every signal in this guide — ahead/behind, `--cherry-pick` patch-uniqueness, `git diff main...BRANCH`
— is derived from a **merge-base**. A shallow clone has a grafted root, so those results are wrong
_without erroring_: nothing fails, the numbers are simply fiction. Remote Claude Code sessions clone
shallow by default, so this is the normal state, not an edge case.

Measured 2026-07-29 (ledger `#109`): a session swept this repo with 74 of 2829 commits present. It
reported **90 of 91** branches as carrying unmerged work, and a stale local `main` as `ahead 52` with
`refusing to merge unrelated histories`. In a `--depth 1` clone the sweep exited **0** and named the
live checked-out branch as a deletion candidate with "no unique patch content" — a green run
recommending deletion of an active branch.

Both `npm run sweep:branch-ledger` and `node scripts/reconciliation-preflight.mjs` now refuse
outright unless the history is verified complete (`shallowCloneRefusal`, guarded in
`tests/repo-hygiene.test.ts`) — the preflight is included because it reports its own
merge-base-derived ahead/behind values. The sweep additionally refuses on a narrow refspec
(`branchCoverageRefusal`) and fetches an explicit `+refs/heads/*:refs/remotes/origin/*`, so an
ordinary run repairs its own coverage rather than reporting a partial inventory; with `--no-fetch`,
offline, or a failed fetch, it refuses instead. For the preflight the refusal lives in the exported
`collectReconciliationState`, not in its CLI, so `scripts/reconciliation-evidence-pack.mjs` cannot
write a `status: "complete"` pack around shallow numbers by calling the collector directly. The raw
`git` commands below have no such protection, so verify the precondition yourself before trusting
them.

**Never delete a branch, or report one as unmerged, from a shallow clone.**

For broad multi-worktree reconciliation, then run `node scripts/reconciliation-preflight.mjs` and follow
[`docs/reconciliation-playbook.md`](reconciliation-playbook.md). The preflight is report-only and
does not replace the fetch/approval and per-branch content proof below.

1. Fetch and prune:

   ```powershell
   git fetch --prune origin
   ```

2. Confirm `main` and `origin/main`:

   ```powershell
   git rev-parse main origin/main
   ```

3. Check current worktree state:

   ```powershell
   git status --short --branch
   ```

4. Inspect worktrees:

   ```powershell
   git worktree list --porcelain
   ```

5. Filter candidates through prior review records before inspecting branch diffs. For a branch with a PR, read the PR's comments for a `Review record` at its current head with scope `branch-cleanup` ([Records](agents/pull-request-workflow.md#records)). For history before 2026-10-20:

   ```bash
   npm run ledger:lookup -- BRANCH_NAME --scope branch-cleanup
   ```

   The lookup resolves the HEAD itself and matches the abbreviated SHAs that older records used, which a literal regex on the full SHA silently missed. Skip the branch only on an `ALREADY REVIEWED` verdict — that requires the same branch/ref, reviewed HEAD, and an exact `branch-cleanup` scope together; a branch-name-only match is not enough, and a `branch-cleanup-deletion-pending` row must not match. Re-review when the HEAD changed or the user explicitly asks for a fresh pass. `npm run sweep:branch-ledger` applies this filter across every remote branch in one pass.

6. For each remaining candidate branch, check whether it has patch content not on `main`:

   ```powershell
   git log --format="%h %s" --right-only --cherry-pick main...BRANCH_NAME
   git diff --name-status main...BRANCH_NAME
   ```

Delete a branch only when the cherry-pick-aware log is empty, or when the branch is deliberately rejected as not useful after review.

Never print raw process command lines while checking whether a worktree is active. Use PID/name/start
metadata or `node scripts/reconciliation-preflight.mjs --include-processes`; command-line arguments can contain
credentials.

## Recommended Cleanup Order

1. Fetch and inspect current branch state with the commands above.
2. Resolve each candidate's HEAD and skip unchanged completed reviews recorded in a PR `Review record` comment or the archived history.
3. For each remaining candidate branch, confirm patch-unique commits and file diffs against `main`.
4. Port, commit, or explicitly reject useful patch content before deleting any branch ref.
5. Record a completed cleanup review of a branch with a PR as one `Review record` comment on that PR, with scope exactly `branch-cleanup` so a later sweep treats it as complete; `branch-cleanup-deletion-pending` deliberately does not count. A branch with no PR gets no record; report it in the task's reply.
6. Record worktree state with the report-only commands below. A report is evidence, not removal authority.

## Report-only Worktree Fleet Inspection (`#XCAX01`, `#6GW95D`)

The repository's fleet-sweep surfaces are permanently report-only as of 2026-08-23. Neither
`scripts/clean-worktree.mjs` nor `scripts/worktree-inventory.mjs` exposes a filesystem, ref, object,
registration, prune, or removal path. This boundary is deliberately narrow: it does not alter
`scripts/guard-push.mjs` and its separate exact-commit temporary-worktree lifecycle.

The 2026-08-22 inventory remains useful historical evidence: it separated registered worktrees,
standalone clones, and empty leftover directories, and confirmed that capacity was not an emergency.
The owner deferred exact-path cleanup indefinitely. This hardening pass removed zero files, refs,
objects, registrations, worktrees, or directories and does not resume that deferred cleanup.

### Dev Drive Trusted Package Cache (#6SMMB4)

When operating multi-worktree fleets on a Windows Dev Drive (`D:`, ReFS), verify that the npm package cache (`D:\.npm-cache`) is registered as a Dev Drive trusted cache. If unverified or untrusted, Microsoft Defender real-time scanning inspects every `npm ci` extraction across all worktrees.

From an **elevated administrator prompt**:

```cmd
fsutil devdrv query D:
fsutil devdrv trust D:\.npm-cache
```

### Registered-worktree report

Run the registered-worktree report only when fleet evidence is actually needed:

```powershell
npm run worktrees:report -- --merged --squashed
```

The report uses only cached refs and an exact read-only Git allowlist. It never fetches. Its sole prune
operation is `git worktree prune --dry-run -v`, which is preview-only. The historical
`npm run clean:worktree` command is retained only as a compatibility alias for this report. Ordinary
`verify:preflight` runs the report's pure self-test instead of inspecting the whole worktree fleet.

`--remove` and `--apply` are rejected before any CLI or programmatic inspection adapter can run,
regardless of their value. No environment variable or confirmation loop unlocks mutation. `--dry-run`
is a compatibility no-op because every invocation is already report-only.

Liveness is tri-state. Positive process or authoritative owner evidence can prove `active`; only an
explicit authoritative signal with its source and observation time can prove `inactive`. No matching
process, a zero count, a missing path, or unavailable evidence remains `unknown` and is never converted
to inactivity.

### Explicit-root multi-fleet inventory

Inventory roots are mandatory and repeatable; there is no implicit home or drive scan:

```powershell
npm run worktrees:inventory -- --root <explicit-fleet-root> --root <second-explicit-root>
```

Filesystem roots, home directories, and ancestors of the home directory are refused. Traversal uses
lexical paths, `lstat`, and batched Windows `FileAttributes` checks at every boundary; paths are sent
as JSON data to a fixed read-only probe and never interpolated into shell source. The scanner never
follows symbolic links, junctions, or other reparse points. Depth limits, reparse boundaries, bounded directory exclusions,
unreadable paths, and repository-inspection failures make the relevant root and overall report
incomplete; the CLI exits non-zero rather than returning a complete verdict.

The output keeps registered worktrees, unregistered linked checkouts, standalone clones, other
repositories, unknown repositories, and empty directories separated and deterministically ordered.
Every checkout and empty-directory record carries tri-state liveness. Every report ends with the
immutable mutation counts `cleaned=0 pruned=0 removed=0 deregistered=0`.

### Deferred cleanup boundary

No inventory or report result authorizes deletion. Exact-path cleanup remains deferred indefinitely
and requires a fresh owner instruction naming the paths and a separately designed, reviewed procedure;
the fleet tooling documented here cannot perform it.

## Merge-Loss Audit Verification (#311, #324)

Merge loss occurs when merge commits or manual conflict resolutions silently revert changes from previously landed PRs without failing tests (for example, bad merge commit `acf78bf` reverting PRs #1800, #1803, #1804, #1796, and #1811 because the reverts took each PR's tests at the same time).

The merge-loss audit tool was promoted into `scripts/audit-merge-loss.mjs` (#311) and provides verification of post-merge integrity (#324):

```bash
# Run advisory merge-loss audit over the default 14-day window on origin/main
npm run audit:merge-loss

# Audit a custom window or target branch
npm run audit:merge-loss -- --since 30 --ref origin/main

# Output findings as structured JSON
npm run audit:merge-loss -- --json

# Run in strict mode (exits non-zero on any finding)
npm run audit:merge-loss -- --strict

# Run self-tests directly
node scripts/audit-merge-loss.mjs --self-test
```

### Interpreting Findings

- **Advisory by design:** The audit exits `0` by default because an intentional revert is byte-identical at blob level to an accidental merge resolution revert. A finding is a prompt for human review, not an automatic defect.
- **Classification hierarchy:** Findings sort merge-resolution reverts first (high likelihood of accidental loss) before single-parent commits (usually deliberate reverts with explanatory commit messages).
- **Remediation:** If an accidental revert is confirmed, restore the lost files on a new branch and submit a PR to re-land the changes.

## Final Verification

After each cleanup pass:

```powershell
git fetch --prune origin
git branch --all --verbose --no-abbrev
git worktree list --porcelain
git status --short --branch
```

Expected invariant:

- `main` remains unchanged unless you intentionally merge or push there.
- The current dirty worktree remains untouched unless you explicitly choose to clean it.
- No branch with patch-unique commits is deleted unless its content was explicitly rejected or safely ported first.
