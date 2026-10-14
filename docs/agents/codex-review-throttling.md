# Codex Review Throttling & Thread Resolution

<!-- BEGIN:codex-review-throttling -->

## Codex review throttling and routing

Do not review branches opportunistically. Review the current changed diff, PR, or branch only when the user explicitly asks for review/audit/hunter/cleanup/upload work, when CI/check failures are the task, or when the current change touches high-risk areas that require a targeted review before handoff.

Use `docs/codex-review-protocol.md` as the shared review protocol for every repo-local review skill, branch/PR review, audit, bug hunt, release-readiness check, and PR/CI review.

Before reviewing a branch or PR:

- Run `npm run ledger:lookup -- <branch-or-ref> --scope "<scope>"`. It resolves the HEAD, matches the abbreviated SHAs older records used, and prints an explicit verdict. Do not read `docs/branch-review-ledger.md` by eye — live + archive rows are many, and eyeballing is how repeat reviews slipped through. `ledger:lookup` reads archives under `docs/archive/branch-review-ledger-*.md` too.
- On `ALREADY REVIEWED`, summarize the prior ledger outcome and skip the repeat review unless the user explicitly requests a fresh pass.
- On `NOT REVIEWED at this HEAD`, review only the changed scope and append a record after the review.

Before reviewing multiple branches:

- Build a short branch inventory first: branch, upstream, ahead/behind, last commit, and merged status.
- Skip branches already merged into `main`.
- Skip unchanged branches already recorded in `docs/branch-review-ledger.md`.
- Do not re-review every branch after ordinary coding tasks.
- If a repeated request targets unchanged reviewed branches, summarize the prior result and ask before doing another full pass.

Review routing:

- `review` (legacy `diff-review`): Use for explicit review of the current diff, PR, or named branch. Findings first, ordered by severity, with file/line evidence.
- `audit` (legacy `bug-hunter` / `repo-auditor`): Use for the exact `bug-hunter` shortcut, explicit defect-hunt requests (prioritizing reproducible bugs and smallest proof), or repo-wide audit/refactor/dead-code/import/dependency-structure requests (treating outputs as triage, not automatic delete lists).
- `release` (legacy `release-readiness`): Use for explicit release, merge, PR readiness, or handoff confidence requests. Do not run provider-backed gates without confirmation.
- `prlanded` / `task` (legacy `branch-cleanup`): Use only when the prompt explicitly asks for branch cleanup/hygiene or branch deletion candidates. Apply `docs/branch-cleanup-guide.md` and the review ledger before inspecting branch diffs.
- `fix` (legacy `pr-ci-fix`): Use for local verification failures; GitHub/GitLab API calls, PR comments, CI reruns, commits, and pushes remain confirmation-required for this repo and must respect the upload/handoff rules. Exception: an explicit `Run PR` sweep carries this approval (see "## Run PR shortcut").

When a branch or PR review completes, record it with `npm run ledger:append -- --ref <x> --head <full-40-char-sha> --scope <s> --outcome <o> --checks <c>`. It creates one content-addressed immutable record file, so concurrent reviews never edit a shared Markdown hunk. Never hand-write a record: hand-written rows produced the mojibake, wrong-width, and duplicate records that the 2026-07-28 hygiene pass had to repair, and `see PR head` or abbreviated HEADs make the throttle unreliable. The legacy Markdown table is frozen for normal PRs; append a correction or superseding record (`--supersede`) instead. `npm run check:branch-review-ledger` validates all sources, while `check:ledger-write-discipline` rejects a legacy-table row change before it becomes a GitHub conflict.

Babysit / Run PR record policy (never push a record-only tip; one Run PR record per PR per sweep with `--supersede` on later sweeps): see [Records](pull-request-workflow.md#records).

<!-- END:codex-review-throttling -->

<!-- BEGIN:resolve-review-threads-after-fixing -->

## Resolve review threads after fixing them

Resolving the review thread a fix answers is part of the same unit of work as pushing the fix.
The single rule every tool follows — authority, validation, reply before resolving, and what to
leave open for Josh — is [Review threads](pull-request-workflow.md#review-threads).

<!-- END:resolve-review-threads-after-fixing -->
