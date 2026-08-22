# Cloud execution package — start here

This is the Linux/Cloud launcher for the complete RAG upgrade programme. Shared specifications, task bodies, execution order, models, gates and acceptance criteria are byte-identical to the Local package. Only this environment bootstrap differs.

## Package availability and base

Cloud must check out a committed, pushed branch containing this package that was materialized and verified on a fresh current-`origin/main` branch. A local drive/worktree path or stale planning-branch commit is never a Cloud handoff. Record the remote branch, the verified materialization base as `packageBaseSha`, and the committed package tip as `packageHeadSha`; the manifest `reconciledBase` must equal that package base. If main moved after materialization, revalidate paths, migration versions, package parity, dependency graph, current implementation state, and baseline/evaluation evidence, then regenerate before P00.

## Environment setup

- Codex Cloud environment setup must already run `bash scripts/setup-codex-cloud.sh && bash scripts/install-codex-cloud-command-shims.sh`.
- Claude web uses the checked-in SessionStart hooks and `bash scripts/setup-claude-cloud.sh --session`; before intentional browser/worker proof use `bash scripts/setup-claude-cloud.sh browsers python`.
- In the task, run `npm run check:runtime` and `npm run check:installed-lock-parity`. In Codex Cloud also run `npm run check:codex-cloud`.
- The required runtime is Node `>=24.15.0 <25`, npm 11, with package manager `npm@11.17.0`. Do not weaken engine-strict when an image starts on Node 22.
- Run `git fetch --no-tags origin main`, `git rev-parse --verify origin/main`, and record `git rev-parse HEAD` plus `git merge-base HEAD origin/main`. Stop if fetch/ref verification fails; a shallow single-branch checkout without a verified current `origin/main` is not sufficient.
- Run `npm run plans:rag:check` before using the package; it fails closed when `origin/main` or the recorded reconciliation commit is unavailable. Immediately before P00 also run `npm run plans:rag:publish-check`; it fails if current `origin/main` moved after package materialization, requiring reconciliation and regeneration before any implementation receipt exists. P01 and later validate the immutable package/base plus accepted receipt ancestry with `plans:rag:check`; unrelated later movement on main does not rewrite already accepted programme history.

Ordinary Cloud implementation is offline/source-only: no credentials, protected documents, production data, provider calls or current-source browsing are assumed. Hosted Supabase-generated types, current publisher/licence verification, provider canaries, migrations and reindex operations remain explicitly gated evidence.

## Superpowers and SDD

Read `programme-manifest.json`, `execution-order.md`, `approval-matrix.md`, `sdd-execution.md`, `task-verification-matrix.json`, `phase-receipt.schema.json`, both specifications, and the selected plan slice. Capability-probe every named Superpowers skill; installations differ between Codex and Claude Cloud, so stop rather than silently substituting a weaker workflow.

The manifest records the Codex model/effort calibration. In Codex Cloud, use those exact IDs and reasoning levels when available. In Claude Cloud, map `gpt-5.6-sol` high/xhigh work to the highest-reasoning frontier/Opus-class option available in that session, and map `gpt-5.6-terra` high work to the available highest-capability workhorse/Sonnet-class option; preserve the phase's relative effort/risk intent and record the actual provider/model/reasoning choice in the phase receipt. Do not pin an unverified Claude version name. Stop if the environment cannot provide an equivalent high-risk reviewer/implementer capability.

Obtain explicit authority for local per-task commits on the Cloud task branch before dispatch. This does not authorize pushing the branch or any hosted/provider action. Run exactly one manifest phase per Cloud session/worktree, with one fresh implementer and one fresh two-verdict reviewer per task. Before a phase, validate accepted predecessors with `npm run plans:rag:receipts:check -- --before` followed by that phase's literal manifest ID. A later phase can consume the work only after its receipt and code commit are available on an explicitly authorized published branch.

P18 is never an ordinary Cloud implementation phase. It runs only in a connected, approved environment with exact service/project identity and a separate authorization for each action in `approval-matrix.md`.

Repository authorization overrides finishing-a-development-branch defaults. Without separately explicit target-specific authority, do not merge, push, open/update a PR, delete the worktree, deploy, or run provider actions; retain the accepted branch/worktree and stop after recording its receipt.
