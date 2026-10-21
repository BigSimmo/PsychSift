---
name: prlanded
description: Verify a merged PR landed by content without orphaned late commits, post its `Review record` comment on the merged PR, and plan cleanup only when explicitly requested. Use after a PR merges into main.
---

# PR Landed

Follow [Landed](../../../docs/agents/pull-request-workflow.md#landed) and [the detailed procedure](../../../.claude/skills/prlanded/SKILL.md):

1. Require an explicit `<pr>`. Run `npm run workflow:lifecycle -- --phase landed --write-evidence`, then once GitHub read access is authorized run `gh pr view <pr> --json state,mergeCommit,mergedAt` and verify `state` is `MERGED` with non-null `mergeCommit` and `mergedAt`.
2. Fetch `origin/main`, inspect `git rev-list --parents -n 1 <merge-commit>`, and verify by content: `git merge-base --is-ancestor <your-branch-tip> <merge-commit>^2` plus `git show --remerge-diff <merge-commit>` for a two-parent merge; `git diff --stat <squash-commit> <your-branch-tip>` (or `git patch-id --stable` comparing `git diff <squash-commit>^ <squash-commit>` with `git diff $(git merge-base <squash-commit>^ <your-branch-tip>) <your-branch-tip>` when behind `main`) for a squash merge.
3. Check for orphaned late commits pushed after auto-merge was armed; fix-forward with a new PR if any work was missed.
4. Worktree removal, remote branch deletion, and `git branch -D` require an explicit cleanup request; empty content proof does not itself authorize deletion.
5. Record the verification as one `Review record` comment on the merged PR with scope `prlanded`, per [Records](../../../docs/agents/pull-request-workflow.md#records).
