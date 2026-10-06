# CI Operations and Runner Usage Assessment

See also [continuous-integration.md](continuous-integration.md) for pre-push safety controls and Guard 2 in-flight CI push guard details.

## Efficiency changes, October 2026

These changes came out of the 6 October 2026 CI-efficiency review and its handover. They change
which runs repeat work. They don't change tests, assertions, thresholds, budgets, browser
projects, shard counts, required check names, security gates or `main` concurrency.

| Change                                      | PR                                 | What it does                                                                                                                                                                                                                                                                                | What still always runs                                                                                                                                                                                      |
| ------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Proven-tree skip on `main`                  | #3313                              | On a push to `main` whose tree equals the tree the merged PR's own `pull_request` run **recorded testing**, skips unit coverage, Production UI and Lighthouse if every leg of that job passed there.                                                                                        | Static checks, safety, Build + deployment boot smoke, Playwright build, visual baselines, the Firefox/WebKit `release-browser-matrix`, failure routing; the weekly schedule and every dispatch run in full. |
| Lighthouse requirement matches its producer | `ci/lighthouse-required-condition` | `PR required` demands a `Lighthouse budget` success on every event where that job is expected to run (schedule, ordinary dispatch and lockfile-only pushes included). A skip is accepted only for the skip label, baseline-refresh dispatch, drafts/out-of-scope changes, or a proven skip. | The producer, budget, baseline and thresholds are unchanged.                                                                                                                                                |
| PR branch-update reuse                      | `ci/pr-update-proof`               | On `synchronize` of a same-repo PR, reuses an earlier green run of the **same PR**. If the newly tested tree is identical, coverage, UI and Lighthouse carry. If the delta lies entirely outside the build/browser/Lighthouse inputs, UI and Lighthouse carry.                              | Lint, typecheck, unit coverage (unless the tree is identical), safety, secret scanning, SAST, Build.                                                                                                        |
| Scheduled npm cache keys                    | #3318                              | Six scheduled workflows hash `package-lock.json` + `.nvmrc`, the key CI's `npm ci` jobs populate, instead of the lockfile-only key a bare `setup-node` can fill empty.                                                                                                                      | Every `npm ci`.                                                                                                                                                                                             |
| Merge-queue Gitleaks                        | #3322                              | `merge_group` scans the full immutable `base_sha..head_sha` range with the pinned binary and fails closed on a missing, zero, absent or non-ancestor base.                                                                                                                                  | Push/PR/schedule/dispatch scans, `contents: read`, no persisted credentials.                                                                                                                                |

### How a skip is proven (`scripts/ci-main-tree-proof.mjs`)

- **Tested-tree record.** The `Change scope` job of every CI run writes a `CI tested tree`
  notice (`event=… sha=… tree=…`) from its checkout of the run's `GITHUB_SHA`. Every job that can
  be skipped also checks out `GITHUB_SHA`; a test pins this. A proof matches that record. It
  never uses the API's `head_sha`, which for a `pull_request` run is the PR head rather than the
  `refs/pull/N/merge` commit the run actually tested.
- **Rejected:**
  - fork PRs;
  - runs that are cancelled, failed, older than 24h or from a different PR;
  - a job list that is incomplete or still in progress, or any skipped, cancelled or missing leg;
  - a missing, duplicated or non-`pull_request` record;
  - a multi-commit or branch-creation push, or a checkout that is not the expected merge commit;
  - any API or git error.

  In every case all outputs are false and the run does the full job set. A result carried
  forward (a skipped leg) is never used as proof for the next update.

- **Delta between actually tested trees.** For a PR update, the earlier run's recorded tree is
  rebuilt locally by its exact hash (its head's tree, or `git merge-tree` of its head with one of
  the last 40 `main` commits). The file delta is then `git diff` between the two tested trees, so
  lockfile, runtime, workflow, config, helper and generated-file changes are all included.
- **Unrelated inputs.** `UNRELATED_INPUT_RULES` is limited to:
  - root `*.md`;
  - the PR template;
  - non-code files under `worker/` and `eval/` (`.py`, `.txt`, `.toml`, `.cfg`, `.ini`, `.lock`, plus `.md` in `eval/`).

  Nothing under `docs/` qualifies: `prebuild` reads `docs/outstanding-issues.md`, `src` imports
  `docs/**/*.json`, and specs read docs files. No code file qualifies either, because `tsconfig.json`
  puts every `*.ts` file in `next build`'s type check. `tests/ci-main-tree-proof.test.ts` scans every code input, with comments stripped,
  and fails if any of them references an allowlisted root. The scanned inputs are `src`, `public`,
  specs, helpers, fixtures, setup actions, `package.json` scripts, configs, and the import closure
  of every script the build and browser/Lighthouse jobs run.

- **Drift backstops.** The weekly scheduled full run and every dispatch never take a proof path.
  Proofs expire after 24h.

Inspect a decision in the `Change scope` job summary ("Tree proof") of the run concerned. To
disable everything, delete the `Main tree proof` step: its outputs go empty and every gate returns
to the full run.

## Overview and Concurrency Architecture

In PR #2209 (merged `af2075a`), GitHub Actions workflow concurrency for base-branch (`main`, `release/**`) pushes was changed to key on `github.run_id`:

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.event_name == 'push' && (github.ref == 'refs/heads/main' || startsWith(github.ref, 'refs/heads/release/')) && github.run_id || github.ref }}
  cancel-in-progress: ${{ github.event_name != 'push' }}
```

### Background and Root Cause Closed

Prior to this change, base-branch pushes shared a single concurrency group (`CI-refs/heads/main`). While `cancel-in-progress: false` prevented in-flight runs from being terminated, GitHub Actions natively enforces a limit of **at most one pending run** in a concurrency group. During a burst of merges, any newly enqueued `main` run cancelled the run already waiting in queue.

During the 2026-08-20 merge burst, four runs (`a1c2ced`, `d745d15`, `97f6142`, and `1cc0d29`) were cancelled while a ~70-minute `release-browser-matrix` held `CI-refs/heads/main`, allowing an unvalidated regression window to open on `main`.

### Runner Usage and Capacity Measurement (#72G3XZ)

Keying each base-branch push on `github.run_id` eliminates the queue eviction defect entirely:

1. **Change Scoping Backstop:** The `changes` job (`scripts/ci-change-scope.mjs`) selectively schedules heavy jobs (e.g., `release-browser-matrix`, `static-heavy`, Docker builds). Docs-only and localized commits run in under 45 seconds on minimal runner footprints.
2. **Runner Minute Profile:** Concurrent runs on `main` do not create queuing bottlenecks across the repository fleet; each merge candidate receives complete, isolated validation.
3. **Safety Assertions:** Contract assertions in `tests/ci-cache-safety.test.ts` pin that base-branch pushes never cancel in-flight runs and retain the per-run concurrency group.

## Branch Protection & Concurrency (#WE5G2C)

GitHub Merge Queue is the recommended architectural solution to eliminate behind-branch cancellation races during high merge frequency.

High-throughput merge bursts frequently trigger the **behind-branch race condition**:

1. When multiple pull requests (e.g., PR #1 and PR #2) are developed concurrently, both branch from an identical base commit (`main@C0`).
2. Both PRs execute their pre-merge CI suites against `C0` and pass.
3. PR #1 merges to `main`, advancing the branch head to `main@C1`.
4. PR #2 is now behind `main`. If PR #2 is merged without re-testing against `C1`, semantic or structural incompatibilities between PR #1 and PR #2 can break `main` (for instance, conflicting database schema assumptions, shared bundle budget thresholds, or incompatible API contracts).
5. Conversely, requiring branches to be strictly up-to-date before merging ("Require branches to be up to date before merging") forces PR authors and automated bots into repetitive rebase/merge loops. In a busy repository, this causes quadratic CI churn, runner queue starvation, and "behind-branch thrashing" where each completed test run is invalidated by an intervening merge before the PR can land.

### Speculative Merge Trains

GitHub Merge Queue stabilizes high-throughput merges by creating **speculative merge trains**:

- **Pipelined Verification:** When PRs are approved and enqueued, Merge Queue sequences them in a FIFO queue. Rather than waiting for PR #1 to merge before starting PR #2's CI run, it creates speculative merge refs:
  - Train Candidate 1: `main` + PR #1
  - Train Candidate 2: `main` + PR #1 + PR #2
- **Parallel Testing:** Both candidate states are validated in parallel. If Candidate 1 passes, PR #1 is merged directly. If Candidate 2 also passes, PR #2 merges immediately behind it without any additional verification delay.
- **Automatic De-queuing on Failure:** If Candidate 1 fails tests or exhibits merge conflicts, GitHub automatically drops PR #1 from the queue. Candidate 2 is immediately re-based and re-tested against `main` (i.e. `main` + PR #2) in a fresh train, preventing PR #1's failure from blocking or poisoning subsequent pull requests.

### Adoption Guidelines and Repository CI Requirements

To safely adopt GitHub Merge Queue for `main`:

1. **`merge_group` Event Trigger:** All required CI workflows must listen to the `merge_group` trigger. In `.github/workflows/ci.yml`, the event trigger is configured alongside `push` and `pull_request`:

   ```yaml
   on:
     push:
       branches: [main, "release/**"]
     pull_request:
       branches: [main, "release/**"]
     merge_group:
   ```

   A required check that never reports on a `merge_group` run leaves every queue entry waiting until it times out. The checks that do report on `merge_group` today:
   - `PR required`, `Change scope` and `Static PR checks` (CI, `ci.yml`), plus whichever scoped CI jobs the diff selects.
   - `PR policy` (`pr-policy.yml`): re-checks migration order against the queue entry's real base.
   - `PR mergeability` (`pr-mergeability.yml`): passes straight through, because a queue entry is by construction a clean merge onto its queue base. `scripts/check-pr-mergeability-workflow.mjs` requires that pass-through.
   - `Gitleaks` (`secret-scan.yml`): reports success but skips its scan steps on `merge_group`. The scan already ran on the pull request.

   `SAST` (`sast.yml`) and `Claude review` (`claude-review.yml`) have no `merge_group` trigger, so neither may be a required check while the queue is on.

2. **Required Status Check Alignment:** Branch protection rules must require the consolidated gate (`PR required`) emitted during `merge_group` executions. The change scoping script (`scripts/ci-change-scope.mjs`) correctly handles `merge_group.base_sha` and `merge_group.head_sha`. The Clear PRs batch runner also insists on `Gitleaks` and `PR policy` being required, and both report on `merge_group`.
   - **Lighthouse labels are invisible in the queue.** A `merge_group` run has no `github.event.pull_request`, so the `lighthouse-budget` and `skip-lighthouse-budget` labels read as absent there, in both the `lighthouse-budget` job's `if:` and the `PR required` aggregate. In practice: `skip-lighthouse-budget` is not an escape hatch in the queue. If the diff is in performance scope, Lighthouse runs on the queue entry and must pass. And the `lighthouse-budget` opt-in label does not force a queue run, so a PR measured only because of that label is not measured again in the queue.
   - **Which workflow file runs is not documented.** GitHub's docs do not say which version of a workflow file runs for a `merge_group` event. `pr-policy.yml` checks out `github.workflow_sha`, so its queue re-check loads `scripts/pr-policy.mjs` from whichever commit supplied that workflow file. If that is the queue entry's own commit, a PR that edits the policy script is re-checked in the queue by its own version. Its `pull_request_target` run was still judged by the trusted base version.
3. **Train Concurrency and Batch Size Bounds:**
   - **Maximum Concurrency:** Cap concurrent merge trains to 2–4 to stay well within runner pool limits and avoid starving ordinary pull requests.
   - **Minimum Batch Size:** Set to 1 for latency-sensitive merges during regular development.
   - **Merge Method:** Pinned to Squash and Merge to align with the repository's single-parent commit history discipline.
4. **Non-Reentrant Workflow Operations:** Workflows that perform branch-specific operations (e.g. branch cleanup or bot synchronization) must remain excluded from `merge_group` runs.
5. **No branch syncing under the queue:** With the queue on, do not sync PR branches with `main` at all (AGENTS.md "Open PR branch sync"). The queue tests each PR against the latest `main`. The Clear PRs batch runner skips its one late `update-branch` sync when `main`'s ruleset has a merge queue, and refuses a sync outright in that case (`scripts/pr-batch-core.mjs`, `scripts/pr-batch-github.mjs`).

## CodeRabbit Review (#3F76JZ)

Automatic reviews require at least 10 repository stars on GitHub, not additional budget spend:

- **Eligibility Requirement:** As verified on PRs #2522 and #2542, CodeRabbit reports: _"This repository does not receive automatic reviews because it has fewer than 10 stars"_ (`Plan: Team`, repository star count: 0).
- **Not a Spending Cap Issue:** This is a categorical repository eligibility requirement, not a credit exhaustion or spending cap issue.
- **Operational Guidance:** Sessions should not treat a missing CodeRabbit review as a budget symptom. Do not undraft PRs solely in an attempt to trigger review, as draft status is skipped by CodeRabbit outright and undrafting mid-CI unnecessarily escalates workflows to the full heavy test set.

## Scheduled Workflows (#QSHHGK)

Scheduled automation runs on off-peak schedules to maintain repository baseline freshness:

- **Weekly Baseline Refresh:** `.github/workflows/bundle-budget-refresh.yml` runs weekly on Wednesdays at 04:40 UTC to prevent baseline staleness.
- **Early Visibility:** By executing cold builds (`check-bundle-budget.mjs --refresh-baseline`) and reporting metrics into a rolling GitHub issue, accumulated bundle growth from merged PRs is surfaced before crossing the 10% failure threshold.
- **Report-Only Invariant:** The workflow never auto-commits or pushes changes; baseline refreshes remain explicit, reviewed human pull requests.

## When `main` goes red (#T82ND3, #TN512M)

`pr-required` is a **pull-request** aggregate. Once a change is merged there is nothing left for it
to block, so before 2026-09-18 a failing `main` run told nobody: CI on `main` failed six of its last
eight pushes from 2026-09-13 with no workflow reporting it, and across the four most recent red runs
(`35345371375`, `35336141954`, `35327912411`, `35274280932`) the only failing jobs were
`release-browser-matrix (firefox)` and `(webkit)` while `pr-required` concluded success each time.

- **Delivery, not detection.** `.github/workflows/ci.yml` now ends with a `main-failure-routing` job.
  On a push to `main` it opens or updates one pinned issue labelled `main-ci-failure`, names the
  individual failing jobs (including each matrix leg), and **closes the issue on the next green
  `main` run**. An open issue therefore means `main` is red right now, not that it once was. When
  `main` goes red again it **reopens the most recent issue it closed** (matched by its own marker)
  rather than opening a new one, so the alert history stays in one place (owner decision, 2026-09-26).
- **Report only.** It mutates no branch and re-runs nothing. `scripts/check-github-action-pins.mjs`
  forbids workflow-authored branch mutation, and a red `main` is a fact to deliver, not to repair
  automatically.
- **Scoped privilege.** `issues: write` and `actions: read` live on that job alone, which checks out
  no code and runs nothing from the repository. Every other job in `ci.yml` keeps `contents: read`.
- **Do not "fix" this by widening PR checks.** `release-browser-matrix` never runs on a
  `pull_request` event, so adding it to `pr-required`'s `needs` would aggregate a skipped job and
  change nothing, while making every branch wait on a ~45-minute matrix (#9Z197J).

### Reading an unexplained `pr-required` failure (#K06J63)

On 2026-09-07 `pr-required` went red several times on a UI-only branch while every local gate was
green, and the branch merged with the cause never identified — because the failing job's log was
never opened. A theory was offered and disproved instead. **Read the log first; theorise second.**

- If a Claude Code session cannot reach the CI logs because the PR-handoff marker is armed, ask the
  owner to unlock it (`CLAUDE_ALLOW_PR_FOLLOW=1 rm "$(git rev-parse --absolute-git-dir)/claude-pr-handoff-<session-id>"`)
  **before** spending the session on hypotheses. As of 2026-09-18 that marker denies only
  `CronCreate`, so a blocked log read is a signal that something else is in the way — say which.
- Record the failing job name and its first error line in the branch review record even when the
  fix is obvious. "Red, cause unknown, merged anyway" is the outcome this row exists to stop.
- Two contributing factors worth ruling out before blaming the change: a second agent pushing to the
  same branch concurrently, and a large number of `main` merges landing during the session.

## Operational Invariants (#055, #0H0S89, #6GW95D)

Repository stability depends on strict operational invariants that prevent automation drift, silent regression, and workspace destruction.

### Exact-SHA Release Protocol (#055)

Releases, production deployments (Railway, Supabase migrations), and full-confidence handoffs must target an **exact, verified commit SHA** (full 40-character hexadecimal hash), never a floating ref (such as `main`, `HEAD`, `origin/main`, or a release branch tag):

- **Floating Ref Non-Determinism:** A floating ref can advance between verification and deployment. If CI or preflight audits run against `origin/main`, but another commit lands before deployment kicks off, unverified code enters production.
- **Verification Protocol:** Record the candidate commit SHA before starting the release gate. Execute all local, provider-backed, cross-browser (Firefox/WebKit), and hosted CI checks (`PR required`) explicitly pegged to that SHA. Stop at the first actionable failure; re-runs must verify the exact repaired commit SHA.
- **Audit Verification:** Use `npm run audit:final-merge -- --dry-run --base-ref origin/main --head-ref HEAD --expected-head <exact-sha>` to verify exact-head match before landing.

### Lighthouse Baseline Freeze and Pinned-Browser CI Refresh (#0H0S89)

Performance baselines committed in `lighthouse-budget.json` are frozen:

- **No Local or Ad-Hoc Updates:** Never update `lighthouse-budget.json` from a developer laptop or arbitrary local machine. Differences in operating systems, CPU throttling, and font hinting make local Lighthouse measurements non-comparable to CI.
- **Pinned Browser Requirement:** Ambient runner-image Chrome versions float over time (e.g., HeadlessChrome/150 vs /151). All official Lighthouse measurements must resolve Playwright's pinned Chromium via `./.github/actions/setup-lighthouse-chromium` on `ubuntu-24.04`.
- **Dedicated CI Refresh Workflow:** Baselines may ONLY be refreshed via the dedicated `workflow_dispatch` trigger in `.github/workflows/ci.yml` (`refresh_lighthouse_baseline: true`).
- **No Self-Greening Gate:** The refresh workflow deliberately uploads the rewritten `lighthouse-budget.json` as an inspection artifact for human review. It NEVER auto-commits or auto-pushes, because a workflow that rewrites its own gate's baseline is a gate that can green itself and mask true regressions.

### Report-Only Worktree Fleet Inventory Policy (#6GW95D)

All tooling and scripts for inspecting worktree fleets and checkout directories (`scripts/clean-worktree.mjs`, `scripts/worktree-inventory.mjs`, `npm run worktrees:report`, `npm run worktrees:inventory`) must operate strictly in **report-only mode**:

- **Incident Precedent (#XCAX01):** On 2026-08-21, an aggressive automated cleanup sweep deleted an in-use worktree mid-session, destroying uncommitted developer work. Multi-agent workflows frequently hold open file handles across multiple roots (`.claude/worktrees`, `D:/Worktrees`, `.codex/worktrees`, `.gemini/antigravity/worktrees`).
- **Zero Mutation Invariant:** No fleet auditing script is permitted to delete, deregister, prune, or mutate developer checkouts. Any removal or mutation flag is rejected before adapters execute. Git prune operations are permitted only as read-only dry runs (`git worktree prune --dry-run -v`).
- **Deferred Cleanup:** Exact-path worktree removal remains deferred indefinitely. Any future cleanup must be executed via explicit human instruction targeting named, verified-dead directory paths with confirmed zero live process handles.
