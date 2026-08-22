# Subagent-Driven Development execution contract

Use this contract for P00–P17 in both packages. The environment-specific `START-HERE.md` handles setup only; the task bodies, models, gates and review standard are identical.

## Capability preflight

Before the first scheduled task of a Cloud/local execution session, including Task 0 in P00/P16A, locate and read the installed equivalents of:

- using-superpowers;
- using-git-worktrees;
- writing-plans;
- test-driven-development;
- subagent-driven-development;
- requesting-code-review and receiving-code-review;
- systematic-debugging when a RED/GREEN command fails unexpectedly;
- verification-before-completion; and
- finishing-a-development-branch.

Stop if the environment cannot provide the required capabilities. Resolve the directory containing the selected subagent-driven-development `SKILL.md` as `SDD_SKILL_DIR` and verify its executable `scripts/task-brief` helper. Local Windows runs that helper through the installed Git Bash; Cloud uses its native Bash. The repository receipt checker, not an environment-specific skill version, owns canonical review-package bytes. `systematic-debugging` is conditionally required before diagnosing an unexpected failure; do not silently emulate missing workflow contracts or retry unchanged failures. Repository `AGENTS.md` remains authoritative for current commands, risk gates and provider boundaries.

Before dispatch, verify that the manifest's implementation and review model/effort are available. `allowModelFallback` is false. A reasoning-capacity block may be escalated from Terra to Sol at high/xhigh only when the phase receipt records the reason and the higher-capability route; never silently downgrade, substitute, or blind-retry. In Claude Cloud use the environment mapping in `START-HERE.md` and record the actual model.

## One phase per session/worktree

Run one manifest phase in one isolated session/worktree. Never run two phases concurrently when they touch RAG, Supabase, schema/types, site-content, answer UI, ingestion or shared documentation owners. Before P00, require `PROGRAMME_IMPLEMENTATION_BASE = PACKAGE_HEAD = PHASE_START`. Each later phase has the previous manifest row as `executionPredecessor`; pass the new phase's exact ID to the receipt checker (for example `npm run plans:rag:receipts:check -- --before P08A`) and require current `HEAD` to equal the commit containing the accepted predecessor receipt. `dependsOn` receipts are checked in addition to this linear predecessor. Stop on a missing, modified, untracked, non-ancestor, or non-PASS receipt/artifact.

The durable programme ledger directory is `docs/superpowers/rag-upgrade/execution-receipts/rag-answer-quality-and-repository-coverage-v1/`; each receipt filename is its exact manifest phase ID plus `.json` (for example `P08A.json`) and is validated against the executable `phase-receipt.schema.json`. Finalized briefs, reports, and full-range diff packages live under `docs/superpowers/rag-upgrade/execution-artifacts/rag-answer-quality-and-repository-coverage-v1/<phase-id>/`; replace the bracketed segment with the exact manifest ID before dispatch. Ignored `.superpowers/sdd` files are scratch only. Copy `phase-receipt.template.json`, replace every example value with observed evidence, and commit the accepted receipt plus all hashed artifacts only under the pre-authorized local task-commit boundary. Record exact agent IDs so each task implementer, task reviewer, phase reviewer, and final reviewer can be proven fresh/distinct.

At package publication, record `packageBaseSha` as the fresh verified `origin/main` used to materialize the package and `packageHeadSha` as the committed package tip. Before P00, `plans:rag:publish-check` must prove that base is still current. Compute the committed package digest with `npm run plans:rag:receipts:check -- --print-package-hash local --at PACKAGE_HEAD_SHA` or the same command with `cloud`; replace `PACKAGE_HEAD_SHA` with the literal recorded SHA. The checker reads blobs from that commit, not the working tree. Before every phase, both SHAs must resolve locally, `packageHeadSha` must be an ancestor of `phaseStartSha`, and every receipt must retain the same `programmeImplementationBase`. After P00, preserve that immutable programme base; later unrelated main movement is reconciled at final handoff rather than rewriting accepted receipts.

## Interrupted phase

Keep a draft phase receipt in its final tracked path while the current phase is in progress. To resume the same preserved branch/worktree, run `npm run plans:rag:receipts:check -- --resume P08A` with the actual phase ID. The checker requires completed tasks to be an exact manifest prefix, contiguous from the immutable `phaseStartSha`, with exact commit lists and final-head PASS reviews; current `HEAD` must equal the last completed `taskHeadSha` (or `phaseStartSha` before the first task). It also revalidates the committed package identity against P00 and rejects any implementer/reviewer ID already reserved by an accepted earlier phase. Continue only with the next task. If the draft or exact branch/worktree is unavailable, do not reconstruct or skip history: start that unaccepted phase again from its recorded predecessor receipt commit. Never rewrite an accepted phase.

Draft receipts and process artifacts may remain uncommitted only inside that exact preserved phase worktree. They are not implementation changes and must not enter any task or phase review range. If the worktree cannot preserve them, restart the unaccepted phase; never insert an unreviewed process-artifact commit between task ranges.

## Inputs supplied to every subagent

Bind these exact inputs separately when dispatching the implementer and reviewer; do not assume conversation inheritance:

- both specifications;
- `programme-manifest.json`, `approval-matrix.md`, `task-verification-matrix.json`, this execution contract, and the selected phase's accepted dependency receipts;
- the selected plan's global constraints and ordered-programme sections that appear before its first Task heading;
- only the exact extracted task body for the current task; and
- the repository `AGENTS.md`, current branch/base, authority boundary, model/effort, and literal RED/GREEN commands.

Artifact names are deterministic, never generic counters. Under the P08A artifact directory, Retrieval Task 3 uses exactly `P08A-retrieval-task-3-brief.md`, `P08A-retrieval-task-3-implementer-report.md`, `P08A-retrieval-task-3-review-1.diff`, and `P08A-retrieval-task-3-review-1-report.md`. The phase review names are exactly `P08A-phase-review-1.diff` and `P08A-phase-review-1-report.md`. The installed `task-brief` extraction boundary is the next `### Task N:` heading or EOF; package validation rejects a plan-level tail after the last task.

After resolving literal `PLAN_PATH`, `TASK_NUMBER`, `BRIEF_PATH`, `TASK_BASE`, `TASK_HEAD`, and `DIFF_PATH`, invoke the installed extraction helper and repository-owned canonical review-package writer exactly:

```bash
"$SDD_SKILL_DIR/scripts/task-brief" "$PLAN_PATH" "$TASK_NUMBER" "$BRIEF_PATH"
npm run plans:rag:receipts:check -- --write-review-package "$TASK_BASE" "$TASK_HEAD" "$DIFF_PATH"
```

Hash every final artifact with `npm run plans:rag:receipts:check -- --print-artifact-hash` followed by its repository-relative path and store that digest in the receipt. Diff-package and reviewer-report paths are always distinct.
The receipt checker independently reconstructs the immutable base/head commit list and stable patch identity for each review package. The stored artifact bytes remain hash-bound, while cross-environment Git presentation differences cannot make a valid package fail; a stale correction-only or unrelated diff still cannot pass.

## Per-task loop

For every task in the phase, in numeric order:

1. Re-read the exact task body, global inputs and accepted dependency receipts. Generate the literal plan-qualified brief path defined above; never reuse a generic Task 1 report path across plans.
2. Record immutable `TASK_BASE = git rev-parse HEAD` before dispatch and verify the worktree has no unowned overlap. Commit-based review requires the one-time local task-commit authority described in `START-HERE.md`; otherwise stop before dispatch.
3. Dispatch one fresh implementer using the model/reasoning in `programme-manifest.json`. The implementer must follow test-driven-development (or the matrix's explicit verification-only strategy), inspect the named current owners, implement only the task, run the smallest listed gate, inspect the diff, and write the plan-qualified report without secrets or protected content. The report and other SDD process artifacts stay outside the implementation commit until the atomic phase metadata commit.
4. Require a product-behaviour RED from the task's literal command before implementation, followed by the identical GREEN command after implementation. When `task-verification-matrix.json` contains the task, its literal command and exact expected product failure supplement any shorthand in the plan and are mandatory. The receipt's RED `expected` field must match that text; a missing file/module/assertion or intentionally failing behavioural expectation is valid only when it is the specified product failure. An environment, parser, dependency, lease, or command error is not. GREEN uses the canonical passing expectation recorded by the receipt checker and a fresh `passed` outcome. If the matrix identifies a verification-only task, record its exact precondition and all acceptance commands instead. Obtain `TASK_HEAD = git rev-parse HEAD` and build the review package from `TASK_BASE..TASK_HEAD`. The task commit must contain only that task and its product tests/docs/schema artifacts, never briefs, reports, review packages, receipts, or unrelated files.
5. Dispatch one fresh reviewer, normally `gpt-5.6-sol` at high reasoning. The reviewer must return two explicit verdicts: specification compliance and code quality. Both must cite files/lines and verification evidence.
6. Send Critical or Important findings back to the same implementer for the smallest correction. Retain immutable `TASK_BASE`; after each fix update only `TASK_HEAD`, create the next uniquely named review package from the full `TASK_BASE..TASK_HEAD` range, and re-review until both verdicts pass. Never review only `prior-TASK_HEAD..new-TASK_HEAD`. Rerun every gate affected by the correction. Do not waive a failing test, access/source policy, migration/grant/RLS concern, provider boundary, deadline/abort invariant or evidence gap.
7. Append the task result using a global key formed from the exact phase ID, plan key, and `task-` plus task number (for example `P08A/retrieval/task-3`), strategy, immutable original `TASK_BASE`, final `TASK_HEAD`, exact `git rev-list --reverse TASK_BASE..TASK_HEAD`, literal evidence, artifact paths/hashes, implementer ID, and every review attempt. Earlier FAIL verdicts remain in order; the final task review must cover `TASK_BASE..TASK_HEAD` and PASS both verdicts. Validate the draft receipt after every task with `--resume`.

No two implementation subagents write concurrently. Read-only research can run in parallel only when it cannot race the task worktree and its result is reviewed before use.

## Phase and programme review

After the last task in a phase, dispatch a fresh phase reviewer at the recorded review effort. Review the immutable `PHASE_START..PHASE_END` range for cross-task contract drift, migrations/types/schema alignment, access/source boundaries, cache/snapshot identity, fallback/timeout semantics, and unowned changes. Preserve every phase review diff/report in the ordered `phaseReviews` array. A correction reopens the final scheduled task: update its `TASK_HEAD`, commit list, evidence/artifacts, and full-base PASS review, then update `PHASE_END`, rerun affected gates, and re-review the complete original phase range. The final phase review must cover `PHASE_START..PHASE_END` and PASS both verdicts.

Validate the accepted receipt before committing. Then create exactly one atomic metadata commit after `PHASE_END`. It must add, for the first and only time, the phase receipt and every exact brief/report/review artifact referenced by that receipt; it may contain no source, migration, product test, package, unrelated artifact, modified prior receipt, or additional commit. Immediately run `npm run plans:rag:receipts:check -- --accept-phase P08A`, replacing `P08A` with the exact phase ID. This command requires current `HEAD` to be that one atomic commit and verifies its complete added-path allowlist. Do not state phase completion, hand off, publish, or begin the next phase until it passes. The next phase begins exactly at that accepted metadata commit.

After P17, set `FINAL_HEAD` to the exact commit that atomically introduced the accepted P17 receipt; no implementation, test, migration, configuration, or behavioural documentation commit is permitted after it. Copy `programme-receipt.template.json` to `docs/superpowers/rag-upgrade/execution-receipts/rag-answer-quality-and-repository-coverage-v1/<PROGRAMME.json>`, replacing the bracketed filename with `PROGRAMME.json`. Dispatch a fresh whole-programme reviewer at xhigh reasoning. Record the planned and actual provider/model, frontier capability, xhigh effort, provider mapping, and `fallbackUsed: false` in `finalReviewRouting`; the receipt checker rejects a silent downgrade. Give the reviewer both specifications, the manifest, approval matrix, this contract, all accepted phase receipts, every tracked implementer/reviewer report, the full package diff, and the immutable `PROGRAMME_IMPLEMENTATION_BASE..FINAL_HEAD` review package. Preserve every full-range attempt under the tracked `programme/` artifact directory. The final review must cover that unchanged P17 receipt commit and PASS both verdicts. If it finds a Critical or Important correction, mark this programme blocked and author a new reviewed package/programme with explicit remediation tasks; do not add an unreceipted post-P17 correction lane or accept the current programme. It verifies:

- every task appears exactly once in the manifest and every dependency preceded it;
- uploaded-guideline priority, public read parity/admin-only mutation, Healthdirect exclusion, and eTG/AMH link-only rules;
- repository-wide producer coverage and newest valid request-local site snapshots;
- expected-source inventory, retrieval/coverage/context packing, adaptive answer completeness, and verified immutable incremental delivery;
- generation-timeout/source-only acceptance status rather than code-only claims;
- migration uniqueness, RLS/grants, generated-type provenance and recovery/rollback boundaries;
- exact local/cloud body parity; and
- precise separation of offline, hosted, provider, canary, deployment and production evidence.

Record every command in `programme-manifest.json.offlineCompletionCommands` with a passing result (or a policy-valid unchanged-content receipt); failed, blocked, provider, hosted, migration, deployment, reindex, and production evidence belongs in `residualGates`, never as passing offline verification. An accepted offline receipt must retain exactly every stable gate ID in `programme-manifest.json.requiredResidualGates`; an empty list or omission is invalid, and P18 can close a gate only through its separately authorized completion evidence. Set `PROGRAMME_RECEIPT` to the repository-relative final `PROGRAMME.json` path, then validate with `npm run plans:rag:receipts:check -- --programme "$PROGRAMME_RECEIPT"`. Create exactly one final atomic metadata commit after `FINAL_HEAD` containing only the newly added `PROGRAMME.json` and its exact referenced programme-review artifacts. Then run `npm run plans:rag:receipts:check -- --accept-programme "$PROGRAMME_RECEIPT"`; it requires current `HEAD` to equal that commit and rejects extra commits, modified prior metadata, or any additional path. Only then may offline completion be stated.

Use verification-before-completion before any completion statement, then finishing-a-development-branch only within repository authorization. Repository authority overrides any skill default: never auto-merge, push, open/update a PR, deploy, or remove a worktree. Without separately explicit target-specific authority, retain the accepted branch/worktree, report the exact handoff state, and stop. No push, PR, merge, deploy or provider operation is implied.
