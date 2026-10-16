# Subagent-driven execution contract

The tracked `.agents/skills/rag-cloud-sdd/SKILL.md` is the self-contained Cloud controller. User-global Superpowers installations are optional references, not dependencies. The tracked `scripts/rag-task-brief.mjs` extracts an exact committed task body.

## Capability and route preflight

Before repository inspection, the launch prompt supplies `TARGET_PHASE` and the selected high/xhigh effort. Verify the target against the manifest and accepted receipts without selecting another phase. An xhigh target requires user confirmation of the selected xhigh effort; ordinary language is sufficient and no literal prompt token or resubmission is required. No additional CLI attestation is required; user confirmation is not runtime evidence. Stop on wrong target or effort and retain authoritative route checks.

Read and hash the controller skill/helper and every repo-local skill in the phase profiles. Assign the fresh read-only probe a useful bounded inspection of target-phase dependencies, accepted receipts and relevant source conflicts. Retain its findings, dispatch tool, agent ID and authoritative host metadata; do not dispatch a dummy task solely to demonstrate tool availability. No callable fresh-agent runtime means `BLOCKED_MISSING_SUBAGENT_RUNTIME`; a missing skill/helper means `BLOCKED_MISSING_CAPABILITY`.

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

## 2026-09-07 local amendment and receipt reconciliation

The [answer-quality amendment](execution-order.md#answer-quality-amendment--2026-09-07) binds new work to existing accepted task identities. The current local Astra High controller/allocation policy is explicit there; it does not claim compatibility with historical Cloud Sol route validators. Local R3 can resume only on separate user authority using its amended brief and formal P08B xhigh reviews. Formal Cloud/programme completion remains blocked on missing historical receipt and amended route/package compatibility.

P17 evaluation Task 6 owns the prospective reconciliation deliverable, with L00 verifying it before takeover: inventory each extant acceptance SHA, review artifact and receipt identity; record unavailable host/runtime/command fields as unavailable; bind this amendment content hash and new obligations to those identities; specify a versioned, reviewed schema/validator migration that preserves old receipt hashes and distinguishes accepted-local from formally-receipted status. A later separately authorized implementation must prove existing immutable receipts still validate, changed obligations cannot inherit old proof, missing route metadata cannot masquerade as verified, and wrong base/head/agent/effort remain fail-closed. No schema/checker change, invented receipt or reconciledBase reset is authorized by this documentation amendment. Retrospective route facts that cannot be proven remain explicit gaps; prospectively collect direct sanitized host evidence. No whole-programme rerun solely for paperwork.

## Local smart-agent preparation (2026-09-07)

The versioned `localAgentPolicy` in canonical programme-manifest.json is the sole machine-readable local routing owner. Both local CLI paths use scripts/lib/rag-local-agent-policy.mjs. It prepares intended dispatch configuration only: no agent is launched, no provider is called, no execution authority/observed route/acceptance is asserted. Historical Cloud and formal receipt schemas remain unchanged.

Prepare the next R3 writer without starting it:

```bash
node scripts/rag-phase-launch-check.mjs --mode local-smart --target P08B --task 6 --role writer --risk clinical
node scripts/rag-task-brief.mjs --variant local --phase P08B --task 6 --role writer --risk clinical
```

The controller must supply a bounded task_name and exact owned message when separately authorized to call the real dispatch tool. Every planned child has explicit model, reasoning_effort, fork_turns:none and a supported agent_type; child spawning is forbidden. Local briefs label the exact generated working-tree source path/SHA-256 rather than claiming committed proof. P08B Task6 also requires the amended local R3 brief, accepted Task5 and preserved 30-file snapshot.

Allocation: Terra Medium for small fully specified mechanical work/bounded lookup; Sol High for ordinary integration and routine independent review; Astra High for integration, clinical/privacy/security/concurrency or costly ambiguity. P08B Task6 writer stays Astra High despite understated input risk. Controller is always Astra High. Formal reviewers obey each phase's high/xhigh floor; P08B retrieval/governance are Astra xhigh and UI Sol xhigh; P17 final reviewer is Astra xhigh locally. Scout/readiness output never substitutes for formal review. Unknown roles, risks, phases/tasks, models, efforts, profiles, flags and invalid capacity fail closed.

One active writer, review only after writer freeze, no writer/reviewer identity reuse. Default planning uses at most two children, preserving one of three available child slots; --use-spare-slot must be explicit for a third. P08B's third formal specialty review normally follows the first pair sequentially. Planning counts are declared inputs and do not reserve runtime capacity: the controller must recheck actual agents before dispatch. All repository commands still use the coordinator; an environment/lease failure is not evidence of model failure.

Rounds1–3 require matching --writer-agent-id and --reuse-agent-id plus --previous-model and --previous-effort. Resume preserves that exact declared prior route only when both model and effort meet the current task floor; an inadequate route fails with a fresh controlled escalation requirement. These declarations are intended configuration, never observed runtime proof. Repair context before escalation. Rounds4–5 require --context-repaired, --failure-kind substantive and the previous explicit route: Terra→Sol→Astra, then fresh Astra xhigh if already Astra High. A stronger task floor cannot be downgraded by weaker prior-route metadata. At round6 the preparation returns BLOCKED_CORRECTION_BREAKER with no dispatch; unresolved Critical/Important never become accepted. Readiness/route planning cannot authorize an implementation, paid launch or commit.

Example formal review preparation after writer freeze (repeat with governance-review/ui-review for the other specialties):

```bash
node scripts/rag-phase-launch-check.mjs --mode local-smart --target P08B --task 6 --role retrieval-review --risk clinical --writer-frozen
```

## Implemented migration identity is not formal acceptance

The narrow continuation-artifact record pins P02 Australian Task4's exact migration filename, commit and Git blob. It permits the existing planned-name collision only when the task's actual Create contract owns it, the pinned commit follows reconciledBase on current ancestry, the file was absent at reconciledBase, and pinned commit, HEAD, index stage0 and raw working bytes all match. A rename/same-version duplicate, foreign/future commit, altered/deleted/untracked file, conflict-stage index or malformed record fails closed. This is local immutable artifact-identity proof, not an execution receipt or hosted migration proof. Never refresh a hash automatically, reset reconciledBase, rewrite the old plan or exempt all same-name files. Legitimate future changes need a separate reviewed new migration/identity decision.

Formal F21 reconciliation still belongs to P17 evaluation Task6/L00: preserve old receipt hashes and unavailable historic route evidence; separately review a prospective schema/validator migration binding amended package/obligations and direct future host evidence. Neither successful package generation nor a smart dispatch plan closes that historical chain. Local R3 continuation can be prepared while formal Cloud/programme acceptance remains blocked; RAG product implementation is still paused until separately resumed.
