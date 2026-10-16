---
name: code-review
description: Review the current working diff for correctness bugs plus reuse, simplification, and efficiency cleanups. Use when the user asks to review their changes, review the diff, or sanity-check code before committing or pushing. Honour requested review depth and optional comments or fixes only when supported by current tools and task authority.
---

# Code Review (working diff)

Use an available diff-review tool or inspect the working diff directly. Check the current
host's command/skill inventory and supported arguments; this copied wrapper does not prove
that a built-in review, effort control or paid review mode is available. Project review-ledger,
independence, provider and publication requirements remain binding.

When invoked:

1. **Establish the requested review scope before dispatch or inspection.** Check `git status --short` and task ownership. For a working-change review, include owned staged changes, unstaged changes and untracked files; read untracked file contents explicitly because `git diff` omits them. Preserve unrelated work and report any excluded scope. For an explicitly requested branch/PR review, record the reviewed HEAD and verified base commit, then compare those pinned revisions. Branch location alone must not replace a working-change review with committed changes only. Include owned uncommitted changes when the request covers them, and identify the evidence snapshot so later edits do not silently alter the reviewed inputs.

2. **Use supported review tooling when suitable.** If an available review command/skill resolves to something other than this file, use only arguments its current schema supports and only actions already authorised. A request for review does not by itself authorise paid review or external comments.

3. **Local fallback and recursion guard.** If suitable review tooling is unavailable or `code-review` resolves back to this skill, perform the review inline; do not call this skill recursively:
   - Inspect the scope established above: `git diff` for unstaged changes, `git diff --staged` for staged changes, explicit reads for owned untracked files, and a comparison of the pinned base/HEAD commits for branch changes. Check for relevant drift before reporting conclusions.
   - Read each changed file for surrounding context, not just the hunk.
   - Report findings ranked most-severe first: correctness bugs first, then reuse / simplification / efficiency cleanups. For each finding give `file:line`, a one-sentence defect statement, and a concrete failure scenario (inputs/state → wrong result).
   - Scale breadth to the requested effort: `low`/`medium` = a few high-confidence findings; `high`/`max` = broader coverage that may include less certain findings.
   - Apply accepted fixes only when requested. Post external comments only with applicable explicit authority and available authenticated tooling; otherwise return the findings locally.

Never invent findings — if the diff is clean, say so plainly.

If a requested review mode is unavailable, report the concrete gap and offer the supported local review path. Do not claim that a named slash command or billing mode exists without current evidence.
