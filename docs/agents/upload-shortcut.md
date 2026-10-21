# Upload Shortcut

<!-- BEGIN:upload-shortcut -->

# `upload` shortcut

When the user types exactly:

upload

as the entire task message, treat it as a shortcut for the safe Git handoff workflow below.

The goal is to leave useful completed work safely committed and, where safe, pushed to the current feature branch. The goal is not to merge into main, delete branches, discard work, force-push, close PRs, deploy, or perform destructive cleanup without explicit user confirmation.

## Protected and base branches

Treat `main`, `master`, `develop`, and `release/*` as protected/base branches for this workflow.

If `upload` is run while on `main`, automatically create or use a branch named exactly `temporary` before staging, committing, or pushing, then continue the upload workflow from `temporary`:

- If neither local `temporary` nor `origin/temporary` exists, run `git switch -c temporary`.
- If local `temporary` exists and is not checked out in another worktree, switch to it only when it is clearly safe.
- If `origin/temporary` exists, use it only when it is clearly the matching intended branch.
- If any `temporary` branch state is ambiguous, diverged, checked out elsewhere, or unsafe, stop and ask instead of overwriting.

If already on a non-protected feature branch, continue using that branch.

## Required inspection

Start with read-only inspection before making changes. Check:

- Current branch or detached HEAD state
- `git status`
- Staged, unstaged, and untracked files
- Recent commits relevant to the current branch
- Remote configuration and upstream branch
- Whether the branch is ahead, behind, or diverged
- Whether the current branch appears protected/base
- Other Git worktrees, if detectable
- Available checks such as tests, lint, type check, or build scripts
- Existing branch, commit, PR, and release-flow conventions

Do not assume branch names, remotes, package managers, test commands, deployment targets, or project structure. Inspect first.

## Safe actions allowed without further confirmation

When the repository state makes it clearly safe, you may:

- Stage coherent completed changes that clearly belong together
- Create one or more logical commits with clear messages based on the diff
- Fast-forward pull only when there are no local commits or conflict risks
- Push the current non-protected feature branch if it has a valid upstream
- Set an upstream for the current feature branch only when the correct remote and branch name are obvious
- Leave the worktree clean by committing safe completed changes

## Actions requiring explicit confirmation

Do not perform these without asking the user first:

- `git reset --hard`
- `git clean -fd` or other destructive cleanup
- Discarding, overwriting, or reverting uncommitted changes
- Deleting local or remote branches
- Renaming branches
- Force-pushing
- Rebasing a shared/public branch
- Resolving divergent branch history
- Merging into `main`, `master`, `develop`, `release/*`, or any protected/base branch
- Closing pull requests
- Changing GitHub default branch, branch protection, repository settings, or deployment settings
- Modifying production data or deployment configuration
- Committing secrets, credentials, tokens, private keys, or sensitive local configuration
- Updating branch references where the correct replacement branch is ambiguous

If any of these seem necessary, stop and report what is risky, why it is risky, the recommended next step, and the exact confirmation needed.

## Mixed, suspicious, or unsafe changes

Do not automatically commit files that look like `.env` files, credentials, secrets, logs, caches, build artifacts, editor or OS files, temporary/debug files, or generated files not normally committed by this project. Report only the path and concern for possible secrets; never print secret values.

If changes appear unrelated, incomplete, experimental, or WIP, do not commit everything together automatically. Commit only clearly coherent completed changes when safe; otherwise summarize the groups and ask what should be included.

## Branch cleanup and reference updates

During `upload`, branch cleanup is limited to the current branch and its upstream unless the user explicitly asks for `branch-cleanup`, branch hygiene, deletion candidates, or stale branch review.

Do not enumerate, diff, or re-review unrelated stale branches during a normal upload/handoff. If the user explicitly asks for branch cleanup, first apply prior review records ([Records](pull-request-workflow.md#records)) to skip unchanged reviewed branches, then follow `docs/branch-cleanup-guide.md`.

If stale, inappropriate, merged, or unnecessary current-branch references are detected, list cleanup candidates but do not delete or rename branches automatically.

Before recommending deletion or rename for the current branch, audit accessible references including `.github/workflows/*`, CI/CD config, deployment config, scripts, package scripts, docs, release notes or release scripts, safe environment/config files, branch-specific config, open PR metadata if accessible, and GitHub branch protection/default branch metadata if safely accessible.

Update repo-tracked references to a renamed or replacement branch only when the old branch reference is clearly found, the replacement is obvious, the change is low-risk, and the user has approved the branch rename or deletion. If the replacement is unclear, report the reference and ask what it should point to.

## Syncing and verification

Do not rebase, merge, or resolve remote divergence automatically. Fast-forward pulls are allowed only when clearly safe. Push only the current non-protected feature branch when clearly safe.

Run the smallest relevant checks that are available and appropriate, such as tests, lint, type check, or build checks. Do not claim checks passed unless they were actually run. If checks cannot be run, explain why and state the command that would normally be used.

## Final report

After completing `upload`, summarize the current branch and worktree state, whether the worktree is clean, what changed, files committed, commit hash and message if created, whether anything was pushed, remote branch and likely PR target, checks run and results, checks not run and why, current-branch cleanup candidates or why broader branch cleanup was skipped, branch references found or updated, risky actions skipped, and exact confirmation needed for any recommended follow-up.

<!-- END:upload-shortcut -->
