<!-- BEGIN:upload-shortcut -->

# `upload` shortcut

For the `upload` safe Git handoff workflow — protected branches, required inspection, safe versus confirmation-required actions, branch cleanup, syncing, and the final report, see [`docs/agents/upload-shortcut.md`](../../../docs/agents/upload-shortcut.md).
<!-- END:upload-shortcut -->

<!-- BEGIN:run-pr-shortcut -->

<!-- BEGIN:pr-branch-sync -->

## Open PR branch sync (anti-churn)

**Sync an open PR branch with `main` (merge `main` in, or `update-branch`) at most once, and only
when the PR is otherwise ready — required checks green, review threads resolved — and GitHub reports
it out of date: the ruleset's strict up-to-date rule blocks the merge until then. Never sync while
its CI is still running or while it has failing checks or open review work; sync earlier only for a
real conflict (`git merge-tree --write-tree origin/main <tip>` is dirty) or when the owner asks.**

When the merge queue is on for `main`, do not sync PR branches at all; the queue tests each PR against the latest `main` itself.

For the rest of the anti-churn branch-sync mitigations, see [Branch sync](../../../docs/agents/pull-request-workflow.md#branch-sync).
<!-- END:pr-branch-sync -->

## Run PR shortcut

For the `Run PR` open-PR maintenance sweep — what it authorizes, its hard guardrails, and its procedure, see [Run PR](../../../docs/agents/pull-request-workflow.md#run-pr).
<!-- END:run-pr-shortcut -->

## Clear PRs shortcut

When the user says `Clear PRs` (case-insensitive, entire message after trimming), invoke the sequential PR batch runner using [Clear PRs](../../../docs/agents/pull-request-workflow.md#clear-prs). This authorizes the documented batch actions without another launch confirmation. Read that procedure before dispatch; do not substitute the maintenance-only `Run PR` sweep.

## Babysit the pull request, then stop

Follow a PR's CI while it is useful, fix only this change's breakage, stop when CI settles, and never park a cron job on a PR — see [Follow CI](../../../docs/agents/pull-request-workflow.md#follow-ci) for detail and how the no-cron rule is enforced. Review-thread handling for every tool is in [Review threads](../../../docs/agents/pull-request-workflow.md#review-threads).

## Automated review coverage and fallback policy

<a id="automated-review-coverage"></a>
<a id="automated-review-coverage-owner-decision-2026-08-22"></a>

For the automated review coverage policy, the 2026-09-19 triple-outage trigger (#JQ3KY7), multi-layered fallback strategy (Codex connector + redundant Claude review workflow), reply-first resolution protocol (`<!-- codex-thread-disposition:resolved -->`), and deterministic CI gate invariance, see [Automated review coverage](../../../docs/agents/pull-request-workflow.md#automated-review-coverage).

## PR bundling (reduce one-task-one-PR churn)

For when a task may ride an already-open PR, the two-way low-risk test, and what must never be bundled, see [Bundling](../../../docs/agents/pull-request-workflow.md#bundling).
<!-- BEGIN:anti-conflict-speed -->

## Anti-conflict and CI-speed operating procedure

Goal: fewer false merge conflicts, less cancelled CI, and faster feedback — without weakening required gates, flake policy, provider boundaries, or clinical/RAG safeguards. Do not touch unrelated active PRs unless the user explicitly asks (`Run PR`, sync, or a named PR).

### Prevent conflicts before they start

- Prefer fewer, shorter-lived PRs. Bundle independently low-risk append-only docs/ledger chores (see "## PR bundling") instead of one PR per line.
- Start from a fresh `origin/main` worktree/branch (`newtask`); do not pile new work onto a stale head that already shares hot files with the open queue.
- The legacy `docs/branch-review-ledger.md` and `docs/outstanding-issues.md` are **serial-only**: normal PRs must not add rows there. `npm run ledger:append` creates an immutable review record; `npm run issues:add|update|queue|done` creates one immutable inbox request (`queue` corrects a recommended-execution-queue row; see ledger `#M6JNR8`). One fresh-base, cross-worktree-locked `npm run issues:reconcile` operation applies landed requests to the canonical issue ledger. `check:ledger-write-discipline` rejects direct table-row edits, changed request records, deleted requests, and a canonical issue diff that does not exactly equal its recorded reconciliation transaction.
- Before calling GitHub `DIRTY`/`CONFLICTING` a real conflict, run `git merge-tree --write-tree origin/main <tip>`. A clean tree means the branch is only behind — sync it once, when it is otherwise ready (see the rule above); a dirty tree means a real conflict (see [Branch sync](../../../docs/agents/pull-request-workflow.md#branch-sync)).

### Speed CI without skipping quality

- Assemble every commit for a head before the first push, or wait for the current PR CI run to settle before pushing again. Apply the same settle-first rule whenever a real conflict actually needs resolving: wait for required CI in flight, then perform the `update-branch` / `git merge origin/main` once review and fix work is assembled. Being merely behind is a reason to sync only once, when the PR is otherwise ready (see [Branch sync](../../../docs/agents/pull-request-workflow.md#branch-sync)). Cancel-in-progress remains enabled for pull requests (pushes mid-run cancel Production UI), but is deliberately disabled for base-branch pushes (`tests/ci-cache-safety.test.ts`).
- For Run PR sweeps and normal readiness pushes — never an explicit bare PR publication — run `npm run format` **and commit the result**, then `npm run verify:pr-local` (or the smallest gate that covers the change). Format is in `static-pr` but not in `verify:cheap`; an uncommitted format leaves CI red on the pushed blob. Whole-tree Prettier, not a single edited file.
- If a PR has auto-merge armed, its auto-merge state is user-owned and automation must not disable or re-enable it. Ordinary fast-forward pushes, bundled additions, and an `update-branch`/merge-main-in sync that the branch-sync rule above allows (a real conflict, or the owner asks) may proceed — GitHub re-validates required checks against the new head before merging, so an additive push cannot slip past that. A force-push, history rewrite, or base/target change while armed still hard-blocks with no override; wait for the user to change that state first.
- Missing CI checks are not a green pass. The `PR mergeability` check uses trusted `pull_request_target` events and refreshes unchanged PR heads after protected-base pushes; it fails explicitly on `mergeable_state: dirty`. When a sync is actually warranted (a real conflict, or the owner asks), use `npm run sync:pr-branches` / `:apply` with human `gh` auth — never bot `update-branch`.
- Triage and repair actionable review threads early; reply before resolving (`<!-- codex-thread-disposition:resolved -->`). Leave ambiguous or product-sensitive threads open for the owner.
- Babysit dormant: observe fresh CI only at meaningful stage boundaries (at most once every 5 min, ≤30 min per run). If queued/running at limit, record run URL as deferred and continue sweep.
- For sweeps needing local repair, prepare one isolated, exact-lock worktree via `node scripts/setup-codex-worktree.mjs`.
- Treat merge queue state as read-only. Fall back to Actions runs for exact head SHA if `gh pr checks` cannot read check runs.
- Treat outstanding-issue IDs as display locators, not proof that work landed. Queue changes only through `npm run issues:add|update|done`; reconcile via `npm run issues:reconcile` from a dedicated branch after PRs land.
- Keep Playwright blocking tests at zero retries; quarantine via `tests/flake-ledger.json` only after three reproductions on the same SHA.

### Operator sync (explicit only)

- Leave active PRs alone unless requested. Report: `npm run sync:pr-branches`. Apply with confirmation and human/operator auth: `npm run sync:pr-branches:apply`.

<!-- END:anti-conflict-speed -->

<!-- BEGIN:codex-productivity-defaults -->

## Codex productivity defaults

For Codex-specific productivity shortcuts and operating rules, see [`docs/agents/codex-productivity-defaults.md`](../../../docs/agents/codex-productivity-defaults.md).

<!-- END:codex-productivity-defaults -->

<!-- BEGIN:repo-productivity-skills -->

## Repository productivity skills

For the repo-local skill catalogue and the foundational orchestration skills, see [`docs/agents/repository-skills-and-issues.md`](../../../docs/agents/repository-skills-and-issues.md).
<!-- END:repo-productivity-skills -->

## Outstanding-work memory (`/issues`)

For the `/issues` durable cross-session ledger and its inbox and reconciliation discipline, see [`docs/agents/repository-skills-and-issues.md`](../../../docs/agents/repository-skills-and-issues.md).
