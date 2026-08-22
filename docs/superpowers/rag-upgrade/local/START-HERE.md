# Local execution package — start here

This is the Windows/local launcher for the complete RAG upgrade programme. Shared specifications, task bodies, execution order, models, gates and acceptance criteria are byte-identical to the Cloud package. Only this environment bootstrap differs.

## Package publication boundary

Do not commit or publish this package from a stale authoring/planning worktree. Materialize only the reviewed package diff onto a fresh branch created at the verified current `origin/main`, run setup and every package/docs/focused gate there, and record that exact `origin/main` as `packageBaseSha` plus the committed package tip as `packageHeadSha` in every phase receipt. The manifest `reconciledBase` must equal `packageBaseSha` at generation. If `origin/main` moves before an authorized publication, repeat the reconciliation/materialization and regenerate; never hide source drift inside an old branch.

## Before implementation

1. Run the repository task-start preflight from the root `AGENTS.md` once for the execution task.
2. In the source checkout run `git fetch --no-tags origin main`, `git rev-parse --verify origin/main`, and record `git rev-parse HEAD` plus `git merge-base HEAD origin/main`. Stop if fetch/ref verification fails.
3. Use a fresh isolated task worktree based on that current `origin/main`; do not implement from the planning worktree or absorb unrelated/untracked work.
4. Run `node scripts/setup-codex-worktree.mjs`, then `npm run check:runtime` and `npm run check:installed-lock-parity`.
5. Before package publication and again immediately before P00, run `npm run plans:rag:publish-check`. It requires current `origin/main` to equal the manifest `reconciledBase`; if main moved, revalidate paths, migration versions, dependencies, current implementation state, and baseline/evaluation evidence, update the base, and regenerate. P01 and later sessions run `npm run plans:rag:check`, which verifies immutable package/base integrity without invalidating accepted receipts merely because unrelated main work advanced.
6. Read `programme-manifest.json`, `execution-order.md`, `approval-matrix.md`, `sdd-execution.md`, `task-verification-matrix.json`, `phase-receipt.schema.json`, both specifications, and the plan slice for the selected phase.
7. Capability-probe every Superpowers skill named in `sdd-execution.md`. Stop if any required capability is unavailable.

## Commit authority required by SDD

Before the first implementer is dispatched, obtain one explicit authorization for local per-task commits on the named task branch. That authorization does not include push, PR, merge, deploy, provider calls, hosted reads/writes, migrations, reindex, promotion or cleanup. If local task commits are not authorized, stop: the required `BASE..HEAD` review packages would otherwise omit the implementation.

## Execute

Run exactly one manifest phase per session/worktree and the per-task loop in `sdd-execution.md`. Before a phase, validate its accepted predecessors with `npm run plans:rag:receipts:check -- --before` followed by that phase's literal manifest ID. Use the model/reasoning recorded for that phase. Use the task plan's exact focused gates and repository arbiter/receipt rules. Do not start P18 locally without a new explicit per-operation approval.

At phase end, preserve the tracked phase receipt and use finishing-a-development-branch only within the authority recorded here. Repository authorization overrides any skill default: without separately explicit target-specific authority, do not merge, push, open/update a PR, delete the worktree, deploy, or run provider actions. Retain the accepted branch/worktree and stop. Publishing the phase for a later Cloud session is a separate action requiring explicit push/PR authority.
