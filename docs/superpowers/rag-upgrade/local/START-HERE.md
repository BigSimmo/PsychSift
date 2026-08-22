# Local operational package — start here

This is the new-session Windows/local handover for L00–L10 after accepted Cloud P00–P17 work. It is not an alternative implementation launcher.

## L00 start contract

1. Run the root repository task-start preflight once for this new local task.
2. Fetch `origin/main` and the exact remote Cloud programme branch named by the handover. Verify the remote tip and the commit that atomically introduced accepted `PROGRAMME.json`.
3. Create a brand-new isolated local operations branch/worktree from that programme metadata commit. Do not use, mutate, rebase, merge or cherry-pick the registered `codex/rag-local-build-20260822` worktree.
4. Run setup, runtime, installed-lock parity, package parity, tracked programme-receipt validation, and `npm run plans:rag:receipts:check -- --before-local L00`. That flag belongs to `scripts/check-rag-phase-receipts.mjs`; `scripts/rag-phase-launch-check.mjs` is Cloud P00–P17 only.
5. Bind the exact Cloud tip, package hash and programme receipt commit/hash. Compare current `origin/main` and the quarantined local WIP. Classify overlap; never absorb it silently.
6. Select Sol/high for both the L00 controller and the L00 reviewer in the local session control and prove both routes from authoritative metadata. L00 is the only local phase whose reviewer is high.
7. Produce and independently review the L00 receipt. No hosted or provider action occurs.

## Later local phases

Start each L01–L10 phase in a fresh local session from the exact accepted predecessor receipt commit. Before inspection, run `npm run plans:rag:receipts:check -- --before-local` with that phase id. Select controller AND reviewer effort before launch; after L00 the reviewer is always xhigh:

- L01: controller high / reviewer xhigh. Do not launch the L01 reviewer at high.
- L06: controller high / reviewer xhigh. Do not launch the L06 reviewer at high.
- L02–L05 and L07–L10: controller xhigh / reviewer xhigh.

Read `programme-manifest.json`, `execution-order.md`, `approval-matrix.md`, `connected-execution.md`, the connected receipt schema/template, both specifications and the P17-produced operational runbooks. Load and hash the phase skills. Dispatch a fresh reviewer distinct from the controller and prove both routes.

The local launch prompt does not itself authorize hosted reads/writes, source browsing, provider calls, migrations, deployment, reindex, activation, rollback or cleanup. Before each action, obtain and record the exact target-specific approval required by the matrix. Stop if approval is missing, expired or mismatched.

Accept one local phase receipt, push only when separately authorized, then stop. L10 may resume after retention/observation; do not run a permanent watcher.

## L10 finalization contract

L10 may resume across the retention period, but no watcher remains running. It cannot pass merely because cleanup is waiting. It passes only when the approved manifest proves either that zero objects are eligible or that the exact eligible set was deleted and independently verified.

`PROGRAMME.json` remains immutable with all connected gates open. After accepted L10, one fresh Sol/xhigh reviewer validates the complete `PROGRAMME`-commit-to-L10-receipt range with both verdicts. `OPERATIONAL.json`, its parsed route record and its exact review artifacts form one add-only atomic metadata commit; it never edits or replaces the offline or local acceptance receipts.

Accepted `PROGRAMME.json` and P00–P17 receipts remain immutable throughout local execution.
