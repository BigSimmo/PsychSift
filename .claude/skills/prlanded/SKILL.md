---
name: prlanded
description: Verify a merged PR actually landed correctly in this repo and clean up after it. Use right after a PR merges (especially squash + auto-merge) to confirm the squashed commit matches your branch by content, catch late commits that were orphaned by the auto-merge race, and update the ledger and memory.
---

# prlanded — confirm a merge landed and tidy up

The rules for proving a merge carried the work — decide squash versus merge commit by parent
count, the right comparison for each, late commits, and cleanup — are in
[Landed](../../../docs/agents/pull-request-workflow.md#landed). This skill is the Claude Code procedure for applying them.
Owner-merge PRs are merged by Josh, not by agents ([Merge authority](../../../docs/agents/pull-request-workflow.md#merge-authority)).

## Steps

The user's explicit request to verify a named PR authorizes the read-only PR lookup for that target.
Otherwise ask before GitHub access; never infer provider authority merely from local branch state.

1. **Confirm the merge:** `gh pr view <pr> --json state,mergeCommit,mergedAt` → `MERGED`.
2. **Verify by content, branching on the merge shape.** `git fetch --quiet origin main`, read the
   parent count with `git rev-list --parents -n 1 <merge-commit>`, then run the comparison
   [Landed](../../../docs/agents/pull-request-workflow.md#landed) names for that shape: for a
   two-parent merge, run `git merge-base --is-ancestor <your-branch-tip> <merge-commit>^2`
   and `git show --remerge-diff <merge-commit>`; for a squash, run the two-dot
   `git diff --stat <squash-commit> <your-branch-tip>` (never three-dot). Any unexplained
   remaining line is work that did not land — investigate before deleting anything.
   If the branch was behind `main` when it merged (always true for a merge-queue merge), that
   two-dot diff also shows `main`'s changes: compare the explicit PR diff
   `git diff <squash-commit>^ <squash-commit> | git patch-id --stable` with
   `git diff $(git merge-base <squash-commit>^ <your-branch-tip>) <your-branch-tip> | git patch-id --stable`,
   exactly as [Landed](../../../docs/agents/pull-request-workflow.md#landed) describes.
3. **Check for orphaned late commits** pushed after auto-merge was armed; if missing,
   fix-forward with a new PR — do not force-push.
4. **Prepare cleanup only after the content diff is empty.** Worktree removal, remote branch
   deletion, and `git branch -D` are destructive and require an explicit cleanup request. Resolve
   and validate the exact worktree path from a different worktree, then report the commands or run
   them only within that authorization. For squash-merged branches, explain why `-d` refuses and
   why `-D` would be needed; empty content proof is necessary but does not itself authorize deletion.
5. **Record** per [Records](../../../docs/agents/pull-request-workflow.md#records): `npm run ledger:append` with `--ref <branch>`,
   the merged commit's full 40-character `--head`, `--scope prlanded`, `--outcome`, and `--checks`,
   plus any relevant memory note.

## Notes

- Do not re-review a branch/HEAD already recorded in the ledger for the same scope.
- If the content diff is non-empty and you are unsure why, stop and report rather than
  deleting anything.
