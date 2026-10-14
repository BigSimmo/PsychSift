---
name: handoff
description: Safely commit, verify, and push completed work on a feature branch in this repo, then open a PR and record the review in the ledger. Use when work is finished and you want to hand it off — it runs the repo's verification gate, preserves unrelated work, and never touches protected branches without the required confirmation.
---

# handoff — commit, verify, push, PR

Encodes this repo's safe Git handoff. The goal is to leave completed work committed and
pushed on a `claude/*` feature branch with a PR; NOT to merge into a protected branch,
force-push, or discard work.

## Preconditions

- You are on a `claude/*` (or other non-protected) feature branch, not `main`/`master`/
  `develop`/`release/*`. If on a protected branch, create a feature branch first.
- Only your own paths are staged (this worktree may hold other sessions' WIP).

## Steps

1. **Inspect first (read-only):** `git status --short --branch`, `git diff`, `git diff --cached`,
   and the ahead/behind from `node scripts/check-base-freshness.mjs`. Record the exact cached index
   state with `git diff --cached --raw --no-renames` before staging. Also record the worktree and
   untracked state for every intended path with `git status --porcelain=v1 -z --untracked-files=all -- <intended-paths>`.
   Immediately before staging, repeat and compare both snapshots; if any intended path changed,
   appeared, or disappeared, stop or move the handoff to an isolated worktree. Do not accept a
   concurrent change merely because its path is intended. If the cached index contains paths outside
   this session, stop and move the handoff to an isolated worktree; never unstage or otherwise
   mutate another session's index entries.
   Record `git branch --show-current` and `git rev-parse HEAD`; repeat both immediately before and
   after the commit. Immediately before committing, repeat `git diff --cached --raw --no-renames`
   and verify that every pre-existing cached entry is unchanged and every new entry is in the
   explicit intended-path allowlist. Stop if the branch moved, HEAD changed before your commit, or
   the cached index differs outside those intended paths. A shared worktree/index is not safe
   handoff state.
2. **Stage coherent, completed changes only.** Stage explicit paths — never `git add -A`
   blindly. Do not stage `.env*`, secrets, build output, logs, or unrelated WIP; if you
   see a possible secret, report the path (never the value) and stop.
3. **Format and verify.** From a fully owned feature worktree, run `npm run format`, inspect the
   complete formatter diff, and include only intended formatting. Then invoke the `gates` / `plan`
   skills and run the one smallest sufficient gate they select. Default PR-ready work uses
   `npm run verify:pr-local`; inspect its selection with `--dry-run` when uncertain. For
   UI/routing/styling, prove the affected journey first and add `verify:ui` only for shared UI
   foundations or when the planner says its distinct coverage is necessary. Never stack
   `verify:cheap` + `verify:ui` + `verify:release` by default.
   - Touched `src/app/`, `src/components/`, or `tests/` (or design-system adoption
     inputs): run `npm run design-system:adoption:update` and stage any regenerated
     `docs/design-system/adoption-manifest.json` / marked COMPONENTS/ADOPTION sections
     before push. Pre-commit syncs this when hooks are installed; Cloud agents that
     bypass hooks still need the explicit update or static-pr + coverage fail together
     (PR #1782).
   - Touched Supabase env/config: `npm run check:supabase-project` (provider — confirm first).
     Do not claim a gate passed unless it actually ran. Paste the decisive proof line (for example,
     the test count or named check success), not only exit code 0.
4. **Commit** with a clear message, then verify the new commit has your message, only your intended
   paths (`git show --name-only --format=fuller HEAD`), and the same branch name recorded in step 1.
   End the message with the attribution line your harness specifies (the session's own
   `Co-Authored-By:` instruction) — do not hard-code a specific model name here.
5. **Push** the feature branch: `git push -u origin <branch>`. Per-PR auto-merge state is user-owned:
   automation must not disable or re-enable it; an ordinary fast-forward push is safe while armed,
   a force-push or base change is not ([Merge authority](../../../docs/agents/pull-request-workflow.md#merge-authority)).
   Never pipe the push through `tail`,
   `head`, or another command that can mask its status. Confirm the remote tip equals local HEAD
   with `git ls-remote` before reporting success. The pre-push guards in `scripts/guard-push.mjs` run
   (non-bypassable `autoMergeGuard` sentinel, plus five scoped overrides `SKIP_STATIC_GUARD=1`,
   `SKIP_DRIFT_GUARD=1`, `SKIP_FORMAT_GUARD=1`,
   `SKIP_IN_FLIGHT_CI_GUARD=1`, and `SKIP_LEDGER_WRITE_GUARD=1`) — heed a block rather than
   overriding blindly.

   **Restarting a branch whose PR already merged:** GitHub deletes the remote branch on merge,
   so the local `origin/<branch>` ref is stale and `--force-with-lease` fails with `stale info`
   before it ever reaches the remote. That is not a lease violation to override — run
   `git remote prune origin` and push normally. There is nothing to force: the branch no longer
   exists remotely, so the push creates it fresh. Observed 2026-08-14 restarting this branch
   after PR #1944 merged.

6. **Fill the PR form's area lines.** After the push, run `npm run pr:areas` (read-only; it
   compares your commits with the local `origin/main` and never fetches) and include every line
   it prints in the body you write in step 7, under `## Summary`, in place of the template's `Areas touched` comment. When
   pr-policy classifies the change as ranking-protected it also prints a `RAG impact: ???`
   placeholder: replace that line with a real declaration, because pr-policy reports the
   placeholder as unsatisfied until you do. The ranking decision is pr-policy's, never the map's.
7. **Open a PR** with `gh pr create --base main`, body ending with the Claude Code
   attribution line. Write the body from `.github/pull_request_template.md` exactly as
   [Open](../../../docs/agents/pull-request-workflow.md#open) requires — full prose, verbatim Preflight lines checked only
   where true, a satisfying `RAG impact:` line. On an ordinary PR you may arm squash
   auto-merge at open (`gh pr merge --squash --auto`)
   ([Merge authority](../../../docs/agents/pull-request-workflow.md#merge-authority)).
8. **Record** the review per [Records](../../../docs/agents/pull-request-workflow.md#records) with `npm run ledger:append`.
9. **Follow CI while it is useful, then stop** per [Follow CI](../../../docs/agents/pull-request-workflow.md#follow-ci):
   fix only what this change broke, slow cadence, no cron, then report the PR URL and plainly
   where CI stands. `.claude/hooks/pr-handoff-stop.sh` enforces the no-cron rule.

## Requires explicit confirmation (do not do automatically)

Merging into a protected branch, arming auto-merge on anything other than an ordinary PR you
are opening, force-push, rebasing a shared branch, deleting/renaming branches, `git reset --hard`,
`git clean -fd`, or any provider-touching verification.
