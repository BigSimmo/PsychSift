---
name: prlanded
description: Verify a merged PR landed by content without orphaned late commits, record the landed entry in the review ledger, and plan cleanup only when explicitly requested. Use after a PR merges into main.
---

# PR Landed

Follow [Landed](../../../docs/agents/pull-request-workflow.md#landed) and [the detailed procedure](../../../.claude/skills/prlanded/SKILL.md):

1. Run `npm run workflow:lifecycle -- --phase landed --write-evidence` and confirm the PR state, `mergeCommit`, and `mergedAt` once GitHub read access is authorized.
2. Fetch `origin/main` and verify by content according to the merge parent count (`git merge-base --is-ancestor` plus `git show --remerge-diff` for a merge commit; two-dot `git diff --stat` or `git patch-id --stable` when behind `main` for a squash merge).
3. Check for orphaned late commits pushed after auto-merge was armed; fix-forward with a new PR if any work was missed.
4. Worktree removal, remote branch deletion, and `git branch -D` require an explicit cleanup request; empty content proof does not itself authorize deletion.
5. Record the verification via `npm run ledger:append -- --ref <branch> --head <40-char-merge-sha> --scope prlanded --outcome <summary> --checks <commands>`.
