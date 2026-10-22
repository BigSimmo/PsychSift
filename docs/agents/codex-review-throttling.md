# Codex Review Throttling & Thread Resolution

_Updated 2026-10-17 — clarified review-history evidence scope; Documentation owns._

<!-- BEGIN:codex-review-throttling -->

## Codex review throttling and routing

Do not review branches opportunistically. Review the current changed diff, PR, or branch only when the user explicitly asks for review/audit/hunter/cleanup/upload work, when CI/check failures are the task, or when the current change touches high-risk areas that require a targeted review before handoff.

Use `docs/codex-review-protocol.md` as the shared review protocol for every repo-local review skill, branch/PR review, audit, bug hunt, release-readiness check, and PR/CI review.

Before reviewing a branch or PR:

- For a PR, read its comments for a `Review record` comment at the PR's current head SHA with the same scope (see [Records](pull-request-workflow.md#records)). If there is one, summarise its outcome and skip unless a fresh pass was explicitly requested.
- A matching record certifies only the PR head and scope. It does not compare the review base, staged/unstaged/untracked inputs, environment or required artifacts. For a current-diff, comparison-base or readiness claim, establish equivalence of the relevant additional inputs before reuse; review any changed scope or record the precise evidence gap.
- For history before 2026-10-20, `npm run ledger:lookup -- <branch-or-ref> --scope "<scope>"` searches the archived records and the frozen `docs/branch-review-ledger.md` table. Do not read that table by eye.

Before reviewing multiple branches:

- Build a short branch inventory first: branch, upstream, ahead/behind, last commit, and merged status.
- Skip branches already merged into `main`.
- Skip unchanged branches whose PR already has a matching `Review record` comment.
- Do not re-review every branch after ordinary coding tasks.
- If a repeated request targets unchanged reviewed branches, summarize the prior result and ask before doing another full pass.

Review routing:

- `review` (legacy `diff-review`): Use for explicit review of the current diff, PR, or named branch. Findings first, ordered by severity, with file/line evidence.
- `audit` (legacy `bug-hunter` / `repo-auditor`): Use for the exact `bug-hunter` shortcut, explicit defect-hunt requests (prioritizing reproducible bugs and smallest proof), or repo-wide audit/refactor/dead-code/import/dependency-structure requests (treating outputs as triage, not automatic delete lists).
- `release` (legacy `release-readiness`): Use for explicit release, merge, PR readiness, or handoff confidence requests. Do not run provider-backed gates without confirmation.
- `prlanded` / `task` (legacy `branch-cleanup`): Use only when the prompt explicitly asks for branch cleanup/hygiene or branch deletion candidates. Apply `docs/branch-cleanup-guide.md` and any prior review records before inspecting branch diffs.
- `fix` (legacy `pr-ci-fix`): Use for local verification failures; GitHub/GitLab API calls, PR comments, CI reruns, commits, and pushes remain confirmation-required for this repo and must respect the upload/handoff rules. Exception: an explicit `Run PR` sweep carries this approval (see "## Run PR shortcut").

When a PR review completes, post one `Review record` comment on the PR with the branch, the full 40-character head SHA, the scope, the outcome and the checks run, per [Records](pull-request-workflow.md#records). A branch with no PR gets no record; report the review in the task's reply. Never add, edit or delete the archived records or the frozen `docs/branch-review-ledger.md` table.

<!-- END:codex-review-throttling -->

<!-- BEGIN:resolve-review-threads-after-fixing -->

## Resolve review threads after fixing them

Resolving the review thread a fix answers is part of the same unit of work as pushing the fix.
The single rule every tool follows — authority, validation, reply before resolving, and what to
leave open for Josh — is [Review threads](pull-request-workflow.md#review-threads).

<!-- END:resolve-review-threads-after-fixing -->
