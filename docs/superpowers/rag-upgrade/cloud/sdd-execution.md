# Subagent-driven execution contract

The tracked `.agents/skills/rag-cloud-sdd/SKILL.md` is the self-contained Cloud controller. User-global Superpowers installations are optional references, not dependencies. The tracked `scripts/rag-task-brief.mjs` extracts an exact committed task body.

## Capability and route preflight

Before repository inspection, the launch prompt supplies `TARGET_PHASE` and the selected high/xhigh effort. Verify the target against the manifest and accepted receipts without selecting another phase. An xhigh target must carry the exact repository confirmation marker. Stop on wrong target or effort.

Read and hash the controller skill/helper and every repo-local skill in the phase profiles. Dispatch one fresh read-only probe agent and record the dispatch tool, agent ID and authoritative host metadata. No callable fresh-agent runtime means `BLOCKED_MISSING_SUBAGENT_RUNTIME`; a missing skill/helper means `BLOCKED_MISSING_CAPABILITY`.

Authoritative route evidence comes only from sanitized Codex host runtime or dispatch metadata exported directly into `route-evidence.schema.json`. The checker parses and binds source event, agent ID, host, provider, planned/actual model and effort, mapping, fallback and escalation. Model prose and controller-authored substitutes are not evidence, and the structural checker does not cryptographically attest an unsigned record. If the host cannot directly supply the record, stop with `BLOCKED_MODEL_ROUTE_UNVERIFIED`. Cloud routes must be Codex with exact IDs and effort, no provider mapping and no fallback.

Scan the selected plan, accepted dependency receipts, current relevant code and concurrent worktrees for conflicts or already-landed behaviour. Current main's extractive-answer predicate hardening and guidance-wrapper gate are baseline owners for P08C, not missing work to reimplement. Preserve the quarantined `codex/rag-local-build-20260822` worktree.

## Task brief and implementer

For each task in manifest order:

1. Record immutable `TASK_BASE`.
2. Generate the brief with the tracked helper. Include both specs, dependency receipts, authority, phase skills, exact model/effort and the verification matrix contract.
3. Dispatch one fresh implementer. Require repository-grounded inspection, the exact RED where applicable, the smallest implementation, identical GREEN command, focused gates, final diff inspection and self-review.
4. The implementer returns exactly `DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT` or `BLOCKED`. Concerns are resolved or carried explicitly; they are never converted silently to done.
5. Commit only the task implementation and owned tests/docs/schema outputs. Briefs, reports, review packages and receipts remain outside the implementation commit.

Do not run writing implementers in parallel. A task correction returns to the same implementer so context and ownership remain stable.

## Task and phase review

Build the canonical full `TASK_BASE..TASK_HEAD` package after every implementation/correction. Dispatch a distinct fresh reviewer at the manifest task-review route. Require separate specification and quality verdicts. Critical and Important findings return to the implementer; retain the original base, correct, rerun affected proof, rebuild the whole range and re-review until both verdicts pass. Preserve failed attempts.

Record Minor findings in a durable phase ledger with owner and disposition. The final phase and whole-programme reviewers must see the ledger.

After the last task, dispatch a new phase reviewer over immutable `PHASE_START..PHASE_END`. It cannot be any implementer or task reviewer. Resolve Critical/Important findings through the final task owner and repeat full-phase review. Then atomically commit only the accepted phase receipt and its referenced briefs/reports/evidence.

Every receipt binds each role to its own route evidence. Agent IDs are unique across controller, implementers, task reviewers and phase reviewer within a phase. Terra-to-Sol escalation is allowed only where the manifest says so, with a fresh dispatch, `escalationUsed=true`, exact actual route and a recorded reason; it is not fallback.

## P17 and local handover

P17 receives its normal phase receipt, then a fresh Sol/xhigh whole-programme review and a separately authorized add-only atomic `PROGRAMME.json` metadata commit. Corrections after accepted P17 require a separate remediation programme; do not add unreceipted code after the final range.

The Cloud controller pushes the accepted offline programme tip and stops. Local L00–L10 use `connected-execution.md`, the connected receipt schema and a fresh local session. They are evidence/operation phases, not SDD implementation tasks, but still require a fresh controller/reviewer pair, authoritative routes and exact approvals.

Repository authority overrides any finishing-branch skill: never infer permission to push, open/update a PR, merge, deploy, access hosted/provider data, reindex, activate, roll back, clean up or delete a branch/worktree.
