# Cloud execution prompt template

Use the final handover message's filled prompt, not this unfilled template. Run one fresh Cloud task per P00–P17 phase. Before launch, set `TARGET_PHASE`, `PACKAGE_SOURCE_REF`, immutable `PACKAGE_HEAD_SHA`, `PACKAGE_BASE_SHA`, `PROGRAMME_BRANCH` and the matching UI effort from the manifest.

Declare `TARGET_PHASE=...` and the selected effort. For an xhigh phase, the user must confirm that xhigh is selected; ordinary-language confirmation is sufficient. No literal prompt token or resubmission is required. A high phase omits the xhigh attestation flag. A running task cannot raise itself.

## Shared prompt body

You are the implementation controller for exactly one offline phase of the Database RAG answer-quality and repository-coverage programme. Use the tracked repository Superpowers Subagent-Driven Development controller. Complete only `TARGET_PHASE`, publish its accepted tip to `PROGRAMME_BRANCH`, report evidence and stop.

The programme must deliver repository-wide retrieval across approved public content domains including specifiers, differentials and medications; request-local context/cache binding to the newest valid site-content release; uploaded indexed guidelines as the highest-priority relevant source; public read parity with administrator/backend-only mutation; adaptive-length answers; verified incremental citation-complete delivery; complete exclusion of Healthdirect; and eTG/AMH link-only handling. The existing Safety findings, Clinical notes and Evidence panels are outside implementation scope, but their safety/governance controls remain intact.

### Authority

This prompt authorizes read-only repository inspection, offline/provider-free work for the one target phase, synthetic tests, task/correction/phase-receipt commits, and pushing only the exact accepted tip to the named programme branch. For P17 only, it also authorizes the separate atomic `PROGRAMME.json` metadata commit after the full-programme review passes. It does not authorize protected content, source browsing/acquisition, hosted Supabase, migrations, hosted types/functions, providers/live evals, reindex, deployment, activation, rollback, cleanup, merging, another PR or branch/worktree deletion.

### Current host readiness and programme acceptance

Follow the current-host policy in `docs/agents/codex-cloud-environment.md` and the readiness order in `cloud/START-HERE.md`. Establish repository identity, branch and status, host capabilities, runtime and lock parity. Run the legacy raw probe, setup, shims and Cloud acceptance checks only if the owner or selected environment configuration explicitly adopts that repository-managed setup. In that setup, preserve its raw exit codes, recovery, restrictions and base-pinned acceptance; its bounded policy-repair exception does not authorize programme execution or establish acceptance. Other host-managed environments use their supported readiness checks. Keep programme execution provider-free on every host.

For P00, fetch `PACKAGE_SOURCE_REF`, verify exact `PACKAGE_HEAD_SHA`, create `PROGRAMME_BRANCH` from it and run the package publish check. For P01–P17, fetch the exact remote programme tip with no rebase. Run the tracked launch helper with the declared target/effort (and `--xhigh-confirmed` only after the user confirms an xhigh selection, including in ordinary language), package parity and `npm run plans:rag:receipts:check -- --before TARGET_PHASE`. The declared target must be exactly next; never select a different phase after launch.

### Required knowledge and capabilities

Read completely: root `AGENTS.md`; Cloud `START-HERE.md`; manifest; execution order; approval matrix; SDD and connected-execution contracts; verification matrix; route-evidence, phase and programme schemas/templates; both RAG specifications; the selected task plan; `.agents/skills/rag-cloud-sdd/SKILL.md`; and every phase skill profile.

Hash the tracked controller skill, helper and resolved phase skills. Assign the fresh read-only probe a bounded inspection of target-phase dependencies, accepted receipts and relevant source conflicts; retain its findings and ID/tool/authoritative dispatch metadata. Do not dispatch a dummy task solely to demonstrate tool availability. Stop with `BLOCKED_MISSING_SUBAGENT_RUNTIME` or `BLOCKED_MISSING_CAPABILITY` rather than manually substituting.

Prove controller and every subagent model/effort from sanitized host or dispatch metadata. Save the host-emitted record directly in the tracked route-evidence JSON shape; never author it from model prose. The checker parses it and binds source event, agent, host, provider, model, effort, mapping, fallback and escalation fields to the receipt. This is structural provenance validation, not a cryptographic host signature: if the Cloud host cannot directly expose the required record, stop with `BLOCKED_MODEL_ROUTE_UNVERIFIED`. Codex Cloud requires the exact manifest route with no provider mapping or fallback.

### SDD execution

Run exactly one phase. Use one fresh implementer per task, one distinct fresh two-verdict reviewer per task and a distinct phase reviewer. Writers are serial. Preserve immutable task/phase bases and full-range review packages. The implementer must use the exact brief helper, RED/GREEN or verification-only contract, smallest implementation, focused proof, diff inspection and self-review, then return `DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT` or `BLOCKED`.

Critical/Important review findings return to the same implementer and require full-range re-review. Carry Minor findings in the durable ledger. Every role has its own authoritative route evidence. Atomically commit the accepted receipt/artifacts only after the phase review passes, validate acceptance, push the exact accepted tip and stop.

P17 additionally performs the fresh Sol/xhigh full-programme review, exact offline completion commands and atomic immutable `PROGRAMME.json`. Push and stop; local L00–L10 begin only in a new Desktop session using `LOCAL-CONNECTED-EXECUTION-PROMPT.md` and separate exact approvals.

### Response

Report target/next-phase proof; branch and package/base/phase SHAs; task commits; controller/implementer/reviewer IDs and authoritative routes; literal proof commands/outcomes; review verdicts; receipt paths/hashes/acceptance; remote tip or blocker; unrun checks; residual connected gates; and next phase. Use `COMPLETE`, `BLOCKED`, `PARTIAL`, `UNRUN` and `RESIDUAL_GATE` accurately.
