# Sequential PR batch runner

The **PR batch runner** prepares and merges a fixed snapshot of pull requests one
at a time. It ships disabled. Installing these workflows does not authorize a
batch, modify repository settings, or merge a PR. It never dispatches a repair:
a PR with a conflict, a failing check, or an unresolved thread is parked with a
clear reason and the batch moves on to the next PR.

## Chat shortcut

After activation and the single-PR pilot, say **`Clear PRs`** in a Database task.
The agent starts a fixed snapshot of eligible open PRs, continues an existing
running batch, or resumes a paused batch once its blocker is resolved. The phrase
authorizes the batch's protected merges and resulting Railway deployments without
another launch confirmation. Full dispatch and authorization procedure:
[`Clear PRs shortcut`](agents/pull-request-workflow.md#clear-prs-shortcut).

The shortcut is available to agents that read this repository's `AGENTS.md`.
Installing it locally does not publish or activate the GitHub runner.

## Activation

After separately authorizing activation, verify the repository's current rules,
the intended human `GH_TOKEN` identity (`BigSimmo`), `OPENAI_API_KEY` availability,
and a repository secret named `PR_BATCH_STATE_SIGNING_KEY` containing at least
32 bytes of cryptographically random material.
The human token needs the existing operator permissions plus repository variable
reads, Actions dispatch/rerun, and Git data writes for the state branch. Never put
credentials in dispatch inputs or the state branch.

Required protection includes `Gitleaks`, `PR policy`, `PR required`, PR reviews,
resolved conversations, and current-base validation (strict checks or native
merge queue). The runner refuses unreadable or insufficient protection. It uses
the existing merge method: merge commits, the only method enabled since 2026-10-18
(squash would be used if it were re-enabled). It does not create a merge queue, change
rules, approve reviews, or bypass protection.

When the ruleset for `main` has a merge queue, the runner never syncs a PR branch
with `update-branch`. A PR that is only behind `main` goes straight to the merge
request (`gh pr merge --auto`, which adds it to the queue), because the queue
tests every entry against the latest `main` itself. The adapter also refuses a
sync outright while the queue is on. With no queue, the single late sync before
merge is unchanged.

1. From Actions, launch **PR batch runner** on `main` with `operation: dry-run`.
   This reads GitHub metadata and reports eligible/excluded candidates. It does
   not create the state branch, start Codex, update branches, or arm a merge.
2. Configure `PR_BATCH_STATE_SIGNING_KEY` before any `start` dispatch. The key
   authenticates `state.json`; keep it out of workflow inputs, logs, artifacts,
   and the state branch.
3. Set repository variable `PR_BATCH_ENABLED` to the literal `true` only after
   approval. The absence of this variable is the default disabled state.
4. Start one low-risk docs PR using `operation: start`, `pr_numbers: <number>`,
   and a genuine desktop `codex://threads/<UUID>` or supported cloud Codex task
   URL in `authorization`. The URL is an audit reference, not authentication.
5. Enter the exact confirmation:

   `Authorize this batch: repairs, GitHub writes, protected merges and Railway deployments`

6. Verify the actual merge and audit state before starting a larger batch.

Launching the batch explicitly authorizes feature-branch commits and updates,
review replies/resolution, bounded failed-job reruns, protected merges, and the
resulting Railway app/worker production deployments. Supabase migrations remain
excluded. Ordinary `Run PR` keeps its maintenance-only scope.

## Controls and defaults

| Input             | Meaning                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------- |
| `operation`       | `dry-run`, `start`, `resume`, `pause`, or `status`                                       |
| `pr_numbers`      | Optional comma-separated PRs; empty captures currently open main-target PRs, at most 200 |
| `authorization`   | Desktop task reference or cloud task URL, recorded at launch                             |
| `confirmation`    | Exact authorization phrase, required for start and resume                                |
| `per_pr_limit`    | Retained for launch-schema compatibility; no longer bounds anything (see below)          |
| `batch_limit`     | Retained for launch-schema compatibility; no longer bounds anything (see below)          |
| `canary_evidence` | Optional existing canary run pairs, described below                                      |

Order is oldest first, with explicit `Depends-on: #123` lines taking precedence
inside the snapshot. Cycles are excluded. Dependencies outside the snapshot
remain blockers; a later batch may include them. New PRs are never absorbed.

Only BigSimmo may start, resume, or pause. Status is read-only. Pause is checked
before mutations and does not revoke an already-issued merge request. The report
identifies an armed active PR. Stop that merge through an explicit manual action
if necessary; this runner never disables or silently rearms auto-merge.

The runner never dispatches a repair. A PR with a real conflict (proved with
`git merge-tree`, not GitHub's sometimes-stale label), a failing check, or an
unresolved review thread is parked immediately with a reason of the form
`needs-repair: conflicting`, `needs-repair: failing-checks`, or
`needs-repair: unresolved-threads`, and the batch moves on to the next PR. This
park is not picked up by the automatic retry pass below — a person needs to fix
the PR — so re-run `Clear PRs`/`resume` (or a fresh batch) once it is fixed. An
unarmed PR with no actionable progress for two hours, or one still blocked on
an unmerged dependency, is parked the same way; those two reasons alone get one
automatic retry, after the first full pass through the snapshot, once the PR's
base has moved on. A batch pauses after 24 hours until explicitly resumed.

## Processing and evidence

The controller checks live head/base, eligibility, reviews, and checks. It
proves reported conflicts with `git merge-tree` rather than trusting GitHub's
label, which can be stale. A sync-only PR — no conflicts, no failing checks, no
unresolved threads, no CI in flight, just behind `main` — needs no repair and no
person: it is the one sync this runner ever performs, issued for the single
active PR right before merge, because the branch ruleset requires an
up-to-date branch to merge. Every other blocker is parked, not synced past.
Under a merge queue that sync is skipped too (see Activation above).

Required checks and already-started non-provider advisory lanes settle before
merge handoff. New review activity invalidates thread-resolution evidence. The
merger rechecks all readiness evidence immediately before requesting the merge.
Missing checks/approvals never count as green.

External head changes pause for revalidation rather than overwriting another
task's work. Already-armed/enqueued PRs block launch, including PRs outside the
requested subset.

RAG protected candidates require existing verified before/after canary evidence;
the runner does not infer no behavior change from a PR body's assertion. Optional
`canary_evidence` is JSON keyed by PR number:

```json
{ "123": { "head": "<exact PR SHA>", "base": "<exact main SHA>", "baseline_run": 100, "post_run": 101 } }
```

Both runs must be successful scheduled/manual `eval-canary.yml` executions at
the claimed SHAs, use the trusted workflow, and retain their `eval-canary-output`
artifact. Golden quality results must have document/content recall 1.0 and no
per-case reciprocal-rank regression. Artifacts are read only; no evaluation is
launched. A changed head/base invalidates the pair, which parks the candidate
for a person rather than reusing stale evidence.

The runner also excludes drafts, forks, opt-outs, protected branches, migrations,
controller/workflow changes, authorization/security policy and deployment/provider
configuration. Clinical governance preflight must already be satisfied; an agent
cannot manufacture the missing approval.

## Recovery and reporting

State lives on `codex/pr-batch-state`, an orphan JSON-only branch, separate from
application code and deployment triggers. `state-auth.json` authenticates every
`state.json` revision with the repository-only signing secret, so an ordinary
repository writer cannot forge executable batch authority. Its manifest is immutable. Each
transition creates a state commit and a new event JSON record; updates are
fast-forward against the observed parent. Do not edit, force-push, merge, or delete
this branch as part of normal queue operation.

The controller wakes only on completion of the workflows that can change a batch
PR's merge readiness — `CI`, `PR Policy`, `Secret Scan`, and `PR mergeability`,
the workflows that produce the required `Gitleaks`, `PR policy`, `PR required`,
and `PR mergeability` checks — plus an hourly schedule as a liveness backstop and
manual `workflow_dispatch`. There is no separate review-signal relay: this
repository requires zero approvals, so a review event alone cannot change merge
readiness, and thread state is re-read from GitHub on every reconciliation
regardless. Earlier revisions also woke on every `pull_request_target` event and
every workflow's completion; that produced roughly 106 `action_required` runs for
events that could never change readiness, which is why the trigger list is now
explicit. The schedule runs no controller job when disabled. GitHub Actions
execution time still has its normal cost.

Each external operation is journaled before execution. Replies carry unique
operation markers; resolution checks the reply is still the last thread activity.
Failed-job reruns are bound to a recorded run attempt. A lost response is reconciled
before any retry. Ambiguous ownership, authentication failure, policy changes, or
an unobserved merge request pause the batch rather than guessing.

Use `status` for the current report and `resume` after resolving the stated blocker.
If installed controller policy changed, an explicit confirmed resume records its
new digest without rewriting the original manifest. Keep an armed PR in the
active slot; resolve its blocker manually rather than expecting the runner to.

Reports distinguish `all_merged`, `completed_with_unresolved`, and `paused`, and
include merge commits and parked/excluded reasons. Actual merge inclusion in
`main` is required before advancing. Post-merge CI failures observed during the
active batch pause further mutations; merged does not mean deployment health was
verified. This is a finite batch, not ongoing production monitoring.
