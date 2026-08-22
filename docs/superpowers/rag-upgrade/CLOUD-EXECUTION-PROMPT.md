# Perfected Cloud execution prompt

Use this prompt to execute the RAG upgrade programme in Codex Cloud. Run it once per Cloud session. Each session completes exactly one manifest phase, publishes its accepted receipt to the same programme branch, and stops so the next fresh session can continue.

## Prompt

You are the implementation controller for the Database RAG answer-quality and repository-coverage programme. Complete exactly one eligible offline phase during this Cloud session using Superpowers Subagent-Driven Development. Continue autonomously within the authority below; stop only for a defined stop condition, missing capability, genuine ambiguity that changes the implementation, or completion of the selected phase.

### Objective

Implement the ordered P00-P17 programme so Answer:

- retrieves across every approved public repository-content domain, including specifiers, differentials and medications;
- binds each question and answer cache entry to the newest valid request-local site-content release;
- prioritises relevant, current, eligible uploaded indexed guidelines;
- provides public anonymous/authenticated/administrator read parity while retaining administrator/backend-only mutation and publication;
- produces complete adaptive-length governed answers;
- delivers citation-complete immutable semantic units incrementally;
- excludes Healthdirect completely and treats eTG and AMH as link-only references;
- distinguishes missing corpus content, retrieval misses, context-packing loss, generation failure and display loss; and
- has dry-run-first ingestion, recovery, reindex, shadow evaluation, activation, rollback and cleanup contracts.

Do not treat the existing Safety findings, Clinical notes or Evidence panels as implementation scope. Preserve existing safety, source-verification and clinical-governance controls.

### Authoritative documents

Read these files before selecting or dispatching work. Repository instructions and these documents outrank this prompt if they are more restrictive.

1. [`AGENTS.md`](../../../AGENTS.md)
2. [Cloud START-HERE](cloud/START-HERE.md)
3. [Programme manifest](cloud/programme-manifest.json)
4. [Execution order](cloud/execution-order.md)
5. [Approval matrix](cloud/approval-matrix.md)
6. [SDD execution contract](cloud/sdd-execution.md)
7. [Task verification matrix](cloud/task-verification-matrix.json)
8. [Phase receipt schema](cloud/phase-receipt.schema.json) and [template](cloud/phase-receipt.template.json)
9. [Programme receipt schema](cloud/programme-receipt.schema.json) and [template](cloud/programme-receipt.template.json)
10. [Answer and Australian-source design](cloud/specs/2026-08-20-rag-answer-and-australian-sources-design.md)
11. [Trusted administrator ingestion design](cloud/specs/2026-08-21-trusted-admin-document-ingestion-design.md)

Read the selected phase's plan from this complete plan set:

- [Adaptive answers](cloud/plans/2026-08-20-rag-adaptive-answer.md)
- [Australian source governance](cloud/plans/2026-08-20-rag-australian-source-governance.md)
- [Evaluation and rollout](cloud/plans/2026-08-20-rag-evaluation-rollout.md)
- [Ingestion and reindex](cloud/plans/2026-08-20-rag-ingestion-reindex.md)
- [Retrieval and composition](cloud/plans/2026-08-20-rag-retrieval-composition.md)
- [Verified incremental delivery](cloud/plans/2026-08-20-rag-verified-incremental-delivery.md)
- [Repository-content synchronisation](cloud/plans/2026-08-21-rag-repository-content-sync.md)
- [Trusted administrator document ingestion](cloud/plans/2026-08-21-trusted-admin-document-ingestion.md)

Do not execute plans alphabetically or plan-by-plan. `programme-manifest.json` and `execution-order.md` are the scheduling authority.

### Authority for this Cloud session

This prompt authorises:

- read-only repository inspection;
- offline edits required by the one selected phase;
- synthetic/provider-free tests and repository-selected offline gates;
- task implementation commits, correction commits and the single atomic phase-receipt/artifact commit required by the SDD contract; and
- pushing the accepted phase tip to the existing remote programme branch `codex/rag-upgrade-programme-cloud` so the next Cloud session can continue.

This prompt does not authorise:

- protected or patient-identifiable content access;
- copying, indexing, embedding, summarising or quoting protected eTG or AMH content;
- internet source acquisition or licence verification;
- hosted Supabase reads or writes, migrations, generated hosted types or function deployment;
- embedding or generation provider calls, live evaluations or canaries;
- reindex, promotion, rollback, cleanup, feature-flag or production operations;
- opening or updating another PR, merging, deleting branches/worktrees, or deploying; or
- P18 operations.

Stop and request exact action-specific approval before any excluded action. Never infer credentials, hosted state, source currency or production acceptance from local configuration.

### Cloud bootstrap and branch selection

1. Confirm `CODEX_CLOUD=1`, a clean checkout and a task-specific non-protected branch. Do not proceed from a dirty, detached or protected checkout.
2. For the first session only, start from the committed planning-package branch `codex/rag-upgrade-cloud-execution-plan`, record that commit as `PACKAGE_HEAD`, and create `codex/rag-upgrade-programme-cloud` from it. For later sessions, check out the existing remote `codex/rag-upgrade-programme-cloud` branch and fast-forward only to its exact remote tip. Do not rebase accepted programme history onto a newer main.
3. Run the Cloud environment setup required by [Cloud START-HERE](cloud/START-HERE.md). Use Node `>=24.15.0 <25`, npm 11 and `npm@11.17.0`; do not weaken engine-strict.
4. Run:

   ```bash
   git fetch --no-tags origin main
   git rev-parse --verify origin/main
   git status --short
   npm run check:runtime
   npm run check:installed-lock-parity
   npm run check:codex-cloud
   npm run plans:rag:check
   ```

5. Before P00, also run `npm run plans:rag:publish-check`. Stop if the package's `reconciledBase` is not current. Once P00 is accepted, retain the immutable recorded package/base identity rather than rewriting programme history for unrelated later main movement.
6. Resolve and record `PACKAGE_BASE`, `PACKAGE_HEAD`, `PROGRAMME_IMPLEMENTATION_BASE`, the current branch and the committed Cloud package hash. Use the receipt checker's `--print-package-hash cloud --at PACKAGE_HEAD` command; do not hash working-tree files manually.

### Mandatory Superpowers capability probe

Before selecting a task, locate and completely read the installed equivalents of:

- using-superpowers;
- using-git-worktrees or the Cloud isolation equivalent;
- writing-plans;
- test-driven-development;
- subagent-driven-development;
- requesting-code-review and receiving-code-review;
- systematic-debugging when an expected command fails unexpectedly;
- verification-before-completion; and
- finishing-a-development-branch.

Record the resolved skill paths and verify that the selected Subagent-Driven Development skill provides a working `scripts/task-brief` helper. Stop with `BLOCKED_MISSING_CAPABILITY` if any required capability is unavailable; do not imitate or silently weaken it.

Use the manifest's exact Codex model and reasoning assignment. `allowModelFallback` is false. Use one fresh implementer and one distinct fresh reviewer per task, plus a distinct phase reviewer. The final whole-programme reviewer is frontier-class at xhigh reasoning. Record actual model, effort, provider mapping and agent identities in the receipts.

### Select exactly one phase

1. Inspect the tracked receipts under `docs/superpowers/rag-upgrade/execution-receipts/rag-answer-quality-and-repository-coverage-v1/`.
2. If no accepted phase receipt exists, select P00. Otherwise select the immediate next phase in `execution-order.md` after the last accepted receipt.
3. Never skip a phase, reconstruct accepted history, reuse an accepted agent identity or run two phases in one session.
4. Never select P18 in ordinary Cloud. After P17 offline completion, report the six required residual P18 gates and stop.
5. Run `npm run plans:rag:receipts:check -- --before PHASE_ID`, replacing `PHASE_ID` with the selected literal manifest ID. Current `HEAD` must equal the accepted execution-predecessor receipt commit.
6. Create or resume the selected phase receipt using the supplied schema and template. For a preserved interrupted phase, run `--resume PHASE_ID` and continue only at the next exact task. If the exact draft/worktree cannot be proven, restart that unaccepted phase from its predecessor; never rewrite an accepted receipt.

### Execute the selected phase with SDD

For each task in the selected phase, in numeric order:

1. Extract only the exact task body with the installed `task-brief` helper. Supply the implementer with both specifications, global constraints, accepted dependency receipts, selected task brief, exact model/effort, authority boundary and literal RED/GREEN or verification-only contract.
2. Record immutable `TASK_BASE` before dispatch.
3. Dispatch one fresh implementer. Require repository-grounded inspection, the task's exact product-behaviour RED, the smallest implementation, the identical GREEN command, a scoped diff inspection and a durable implementer report.
4. Commit only the task implementation and its owned tests/docs/schema artifacts. Do not include briefs, reports, review packages or receipts in the task implementation commit.
5. Build the canonical full-range review package with the repository receipt checker from the immutable `TASK_BASE` through final `TASK_HEAD`.
6. Dispatch one distinct fresh reviewer. Require two explicit verdicts: specification compliance and code quality.
7. Return every Critical or Important finding to the same implementer, retain the original `TASK_BASE`, correct, rerun affected gates, regenerate the full-range review package and re-review until both verdicts PASS. Preserve earlier failed review attempts.
8. Add the exact task evidence, commits, artifacts, hashes and agent IDs to the draft phase receipt. Run `--resume PHASE_ID` after every accepted task.

Do not dispatch multiple writing implementers concurrently. Read-only research may run concurrently only when it cannot race the phase worktree.

### Close and publish the phase

1. After the final task, dispatch a fresh phase reviewer over the immutable `PHASE_START..PHASE_END` range. Resolve Critical or Important findings through the final scheduled task as specified by the SDD contract, then repeat the full phase review.
2. Run the phase's exact focused gates and the receipt checker. Do not run broad, provider-backed or connected gates unless the selected task explicitly owns an offline version.
3. Finalise the receipt with exact evidence. Create exactly one atomic metadata commit after `PHASE_END` containing only the new phase receipt and its referenced briefs/reports/review artifacts.
4. Run `npm run plans:rag:receipts:check -- --accept-phase PHASE_ID`. It must pass at the metadata commit tip.
5. Inspect the final status and diff, then push that exact accepted tip to `origin/codex/rag-upgrade-programme-cloud`. Do not push an unaccepted phase or any unrelated change.
6. Stop the session after the push. State the next eligible phase but do not start it.

### P17 and offline programme completion

During the P17 session, complete P17 normally and accept its phase receipt first. Then follow the whole-programme review contract:

- keep `FINAL_HEAD` equal to the accepted P17 receipt commit;
- dispatch a fresh frontier-class xhigh whole-programme reviewer over `PROGRAMME_IMPLEMENTATION_BASE..FINAL_HEAD`;
- require final specification and quality PASS verdicts;
- if the reviewer finds a Critical or Important correction, mark this programme blocked and create a separately reviewed remediation programme rather than adding unreceipted post-P17 implementation;
- run every exact offline completion command in the manifest;
- create and atomically commit `PROGRAMME.json` plus its exact review artifacts;
- run `--accept-programme` at that commit; and
- push the accepted offline programme tip to the same programme branch.

Offline completion is not deployment, migration, live-provider validation, reindex completion or production readiness. Preserve the exact required residual gate IDs for official source/licence verification, hosted Supabase and migrations, targeted reindex/shadow evaluation, provider canaries, controlled activation/rollback/cleanup, and deployment/production acceptance.

### Required end-of-session response

Return a concise evidence report containing:

- selected phase and why it was next;
- branch, `PACKAGE_BASE`, `PACKAGE_HEAD`, `PROGRAMME_IMPLEMENTATION_BASE`, `PHASE_START` and accepted tip;
- tasks completed and commit SHAs;
- implementer, task-reviewer and phase-reviewer agent IDs plus actual model/reasoning routes;
- literal RED/GREEN or verification-only commands and exact outcomes;
- task and phase review verdicts;
- receipt path and `--accept-phase` result;
- pushed remote branch and exact remote tip, or a truthful publication blocker;
- checks not run and why;
- residual hosted/provider/P18 gates; and
- the next eligible phase.

Use the labels `COMPLETE`, `BLOCKED`, `PARTIAL`, `UNRUN` and `RESIDUAL_GATE` precisely. Never claim a phase, programme, deployment or production state without its required receipt and evidence.
