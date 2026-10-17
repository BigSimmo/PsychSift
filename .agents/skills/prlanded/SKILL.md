---
name: prlanded
description: Verify a merged PR landed by content without orphaned late commits, record the landed entry in the review ledger, and plan cleanup only when explicitly requested. Use after a PR merges into main.
---

# PR Landed

Follow [Landed](../../../docs/agents/pull-request-workflow.md#landed) and [the detailed procedure](../../../.claude/skills/prlanded/SKILL.md):

1. Require an explicit PR identifier. Run `npm run workflow:lifecycle -- --phase landed --write-evidence` to render the approval-required lookup, then, once GitHub read access is authorized, execute `gh pr view <pr> --json state,mergeCommit,mergedAt`; continue only when the result is `MERGED` and records a non-null `mergeCommit` and `mergedAt`.
2. Fetch `origin/main`, inspect the verified merge shape with `git rev-list --parents -n 1 <merge-commit>`, and verify by content using explicit objects: for a two-parent merge run `git merge-base --is-ancestor <your-branch-tip> <merge-commit>^2` and `git show --remerge-diff <merge-commit>`; for a squash use `git diff --stat <squash-commit> <your-branch-tip>` (never three-dot). When behind `main`, compare `git diff <squash-commit>^ <squash-commit> | git patch-id --stable` with `git diff $(git merge-base <squash-commit>^ <your-branch-tip>) <your-branch-tip> | git patch-id --stable`.
3. Check for orphaned late commits pushed after auto-merge was armed; fix-forward with a new PR if any work was missed.
4. Worktree removal, remote branch deletion, and `git branch -D` require an explicit cleanup request; empty content proof does not itself authorize deletion.
5. Record the verification via `npm run ledger:append -- --ref <branch> --head <40-char-merge-sha> --scope prlanded --outcome <summary> --checks <commands>`.
