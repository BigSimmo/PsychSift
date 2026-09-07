## Task 2: Correct the U02 multi-item producer projection

Programme/unit: rag-source-ingestion-continuation-v1/U02, F02 corrective packet with F14 producer-regression coverage. The user authorised this correction, focused checks, independent reviews and local commits. Independent planning review and routing/checkpoint preflight are accepted in ADOPT/ADOPT-acceptance.json at the current task base. Original U02 briefs and accepted receipts remain unchanged.

Accepted original task base: 08df4cddce457ba016b0d31fcf7202a4b564776a. Accepted product: 6adb834e48b3c1af4579ef22738d942803ab6893. Assessed evidence HEAD: 2dad59e0ee26ab6586f6a49ec1dfdb993d1f9ad7. Correction immutable TASK_BASE: ae500cafc661d9a06536d09d73d827726f057ffa. Assign TASK_HEAD from the actual scoped candidate commit. Preserve this original base across all correction rounds.

Problem: projectSourceAnchoredSummary builds a newline-separated multi-item overview, while canonical-field validation collapses whitespace and rejects it. Flattening one field alone cannot solve exact projection equality. Reuse the audit's unchanged synthetic diagnostic as historical evidence; do not rerun it merely to establish context.

Owned product seam: supabase/functions/_shared/source-anchored-summary.ts and src/lib/document-enrichment.ts only where producer alignment needs it; affected tests/document-enrichment.test.ts and tests/indexing-v3-agent.test.ts. Other existing U02 files are read/verification inputs, not automatic edit scope. Add any further owner only for a demonstrated dependency and explicit brief update.

Correction: choose one consistent bounded aggregate projection or distinguish canonical items from formatted aggregates. Preserve exact equality, nested validation, all existing bounds, generation/anchor membership, model authority, provisional fallback and metadata ownership. No schema/RPC changes, semantic adjudication implementation, U03 persistence work, Answer/search edits or providers.

Initial regression name: "round-trips multi-item source-anchored summaries from the real producer". RED/GREEN command after the test is authored under current authority:

```text
node scripts/run-vitest.mjs run tests/document-enrichment.test.ts -t "round-trips multi-item source-anchored summaries from the real producer"
```

Expected product RED: supported two-item producer output rejected with source_anchored_summary_profile_overview_invalid; not missing test/dependency or environment failure. GREEN: valid 1/2/8-item collections pass actual adapter -> projection -> validator, while wrong aggregate, noncanonical item, bad nested anchors/generation and unsupported shapes reject. Use safe synthetic statements, not clinical recommendations.

Execution preflight: set process-local GATE_RECEIPTS=off and GATE_ARBITER=off before the focused wrapper/arbiter, and restore prior values afterward. These existing modes prevent protected-untracked bookkeeping and force real tests with the coordinator/offline sandbox retained. Record the arbiter RUN/off override. Local commits use the existing SKIP_DOCS_SYNC_HOOK=1 only for the commit, with explicit staged-path/format/import/index/adoption-scope inspection. The canonical SDD local bookkeeping section owns these scoped bridges; no hook/config or test weakening is authorised.

Final affected selector (consult the arbiter/coordinator with the safe settings above):

```text
node scripts/run-vitest.mjs run tests/indexing-v3-agent.test.ts tests/document-enrichment.test.ts tests/worker-shadow-extraction.test.ts tests/check-indexing-contract.test.ts
deno check --frozen --node-modules-dir=false supabase/functions/indexing-v3-agent/index.ts supabase/functions/site-content-sync/index.ts
```

The test name above must be authored before RED; its existence is not historical execution evidence. Record literal commands and actual counts at execution; do not predict 98 tests after additions. No broad Answer baseline is proposed for this bounded correction. That omission is scope selection, not acceptance or renewal of the historical exit-1 exception. If scope expands into evaluated Answer/search dependencies, reselect the gate and require a new explicit decision for any retained failure.

Approved writer: fresh Astra/high; distinct ingestion-worker and clinical-governance reviewers at their required floors. Review the complete immutable corrective TASK_BASE..TASK_HEAD and explicitly check integration with the original U02 contract/base using unchanged historical evidence. Keep original TASK_BASE for every correction round; no correction-only final review. Reviewer verdicts: specification and quality separately. Runtime SQL concurrency and provider/model parity remain unproven.

Record accepted local corrective evidence. The controller then freezes shared contracts and may continue U03 under current authority; this U02 writer does not own U03. Do not apply SQL, process real documents, run workers, activate, deploy, publish or contact the separate RAG task.


### Bound execution instructions

Worktree: C:/Users/joshs/.codex/worktrees/rag-local-build-20260822/Database. Branch: codex/rag-local-build-20260822. Planning candidate 4cf61dfe065b7c41eb53bc9f890d1fd16dfbad70 has independent clinical and execution Specification PASS / Quality PASS at locally observed Astra/xhigh. Planning/evidence checkpoint is the immutable TASK_BASE above. No earlier U02 product changes are to be reimplemented.

Read applicable AGENTS.md and the installed test-driven-development and verification-before-completion skills. Task startup already ran for this continuation; do not rerun it, create another worktree, install broadly, run a baseline, or spawn subagents. You are not alone; preserve all other work and use only git status --untracked-files=no. Never enumerate protected 1/ or unrelated untracked files.

The real producer wraps source_anchored_summary_profile_overview_invalid in Error.cause under source_anchored_summary_generation_failed. RED must establish that underlying product cause. Eight valid projection items must respect the six-item maximum of ordinary categories; distribute them across categories. Preserve the current summary/overview byte and Unicode bounds; do not truncate evidence to make the round trip pass.

The frozen-lock Edge command above is the independently reviewed equivalent in ADOPT/ADOPT-edge-gate-disposition.md. It covers both current immediate function roots with the same cwd/config. Before and after it, verify deno.lock SHA256 b92c0d1c752f6d48da195ef062e473dfaca35f13e5cc692f8f95b92bed3881b9. Public dependency restoration pinned by that lock is authorised; application/provider calls, real documents, lifecycle scripts, reload, config changes and lock updates are not. Record the actual Deno version, literal command, output/exit, lock identity and whether downloads occurred. A missing dependency or frozen-lock failure is a blocker, not a reason to edit the lock. Report as frozen-lock equivalent, never as the literal npm wrapper passing or network-free if packages downloaded.

You own only these product paths, and only where required: supabase/functions/_shared/source-anchored-summary.ts; src/lib/document-enrichment.ts; tests/document-enrichment.test.ts; tests/indexing-v3-agent.test.ts. Read/execute the other affected tests as verification inputs. No migration/schema, worker operation, RAG/Answer change, unrelated test repair, dependency update or governing-doc edit. Controller owns all briefs/reports/review evidence and .superpowers/sdd/progress.md; do not stage them.

Use process-local GATE_RECEIPTS=off and GATE_ARBITER=off for the real wrapped Vitest runs and the arbiter, restoring prior values in finally. Consult npm run arbiter -- 'vitest(selected)' with those settings; record RUN/off override. Keep coordinator and offlineTestEnvironment in force. Never call broad arbiter/status/receipt paths, bypass leases, run direct Vitest, or set CI to evade bookkeeping. Keep designated check ownership with this writer; reviewers will consume your saved evidence.

Before the candidate commit, format only changed owned product files with installed Prettier, inspect exact diff/staged allowlist and run affected checks. Inspect import/module-index coverage if src/lib changes. The narrow U02 test/shared-helper surface must be assessed for design-system adoption and visual-baseline edge changes; record the actual manual conclusion rather than running unsafe generators. Commit only owned product files, using process-local SKIP_DOCS_SYNC_HOOK=1 and restoring its prior value. No --no-verify, hook/config edit, push, PR or publication. Do not modify or absorb unowned work.

Write the full implementation report outside the repository at C:/Users/joshs/Codex-Handoffs/Ingestion/Execution/20260907-continuation/U02-audit-correction-implementer-report.md. Save raw bounded command outputs alongside it with U02-audit-correction- prefixes. Include actual RED/GREEN commands, exits and salient output; final selector counts; Edge/lock result; changed files; self-review; commit SHA(s); immutable base; unresolved gates; and exact own session/model/effort fields from only the selected session_meta/turn_context in your exact local child log. Requested Astra/high is not observed execution evidence. Do not print secret/environment values or scan unrelated logs. Return DONE/DONE_WITH_CONCERNS/BLOCKED/NEEDS_CONTEXT, commits, one-line test result, concerns and report path. Controller dispatches independent reviews after your range is frozen.

The original extracted Task 2 context is retained outside at C:/Users/joshs/Codex-Handoffs/Ingestion/Execution/20260907-continuation/U02-original-task-context.md (SHA256 47f3d143e6ba4dd19cdfe3e5aba62c90730f30dc4d177a301a45d9745f8eb33f). It supplies unchanged original-contract context only; this corrective brief defines the current edit scope and selectors. The original accepted U02 artifacts remain untouched.

### Binding programme global constraints (verbatim)


- The immutable implementation anchor is `03aa32d731d1cb9009be55213580e9ea3994017c`. P00-P07 receipts and their accepted artifacts are never edited.
- The unaccepted P08A draft is superseded. Do not resume it, use its reserved migration name, or claim P08A/P14/P15/P16 acceptance under the parent manifest.
- This plan may produce only continuation states C00-C06. It cannot produce `PRODUCTION_ACCEPTED`.
- Do not process a document or corpus. Do not access hosted Supabase, Storage, PITR, scanners, model assets, or providers. Do not apply migrations, deploy, reindex, stage, evaluate, activate, withdraw, roll back, clean up, push, or open a pull request.
- Keep one writer at a time across `worker/**`, `supabase/**`, RAG, upload, and dashboard owners. Preserve unrelated staged, unstaged, and untracked work.
- Before product dispatch, verify current execution authority and complete the independent planning review/capability gates; local task-commit and implementation authority are granted. For each authorised product task: create a fresh task brief; record RED before implementation; implement the smallest behavior; run the exact focused GREEN selector; create the scoped candidate task commit needed to pin `TASK_HEAD`; create an immutable `TASK_BASE..TASK_HEAD` review package; obtain separate specification and quality verdicts; correct every Critical or Important finding in authorised follow-up commits; re-review the whole corrected range; then record the accepted checkpoint. A candidate commit is not acceptance. Never push.
- Reuse final corrected behavior from `0f9a52f22^..03d68b3a1` and the dirty `rag-ingestion-design-20260821` worktree only as read-only semantic references. Never cherry-pick or copy either range wholesale, and never treat either as acceptance evidence.
- Preserve the accepted P04 ingestion classifier, P05 public-source policy and recovery-evidence vocabulary, P06 site-release authority, and P07 query/cache/ranking behavior unless a task below explicitly names the owner.
- All SQL functions use a fixed empty or explicit `search_path`, validate bounded inputs, serialize conflicting writes, and revoke `PUBLIC`, `anon`, and `authenticated` unless an authenticated administrator wrapper is explicitly named.
- `service_role` alone is not trusted-backend identity. Backend admission requires a distinct high-entropy capability whose digest is readable only inside a narrowly granted `SECURITY DEFINER` wrapper. Administrator admission independently verifies `auth.uid()`, the administrator claim, and staging ownership.
- The source-ingestion retrieval kernel is structurally default-off. `src/lib/rag/rag.ts`, Answer/search routes, answer-support code, and legacy cache readers/writers must neither import nor invoke it.
- Unknown admission, safety, policy, generation, lease, lineage, activation, withdrawal, or recovery state fails closed.
- Before Task 11 route/UI work, read the installed Next 16 route-handler and dynamic-route guides named in that task. Before browser work, run `npm run ensure` and use only its printed, project-verified URL.
- The approved migration reservation is the following ordered set. Before creating the first migration, prove every full filename is absent and every version sorts after the then-latest migration; if either check fails, stop before RED and record a newly allocated ordered set in the plan and task brief.

```text
20260831100000_retire_ingestion_worker.sql
20260831101000_fence_ingestion_leases_and_repairs.sql
20260831102000_stage_shadow_document_generations.sql
20260831103000_activate_retained_document_generations.sql
20260831104000_create_document_admission_events.sql
20260831105000_add_document_technical_activation.sql
20260831106000_add_source_ingestion_retrieval_kernel.sql
```

- Reconcile `supabase/schema.sql` and `src/lib/supabase/database.types.ts` in each migration-owning task. Regenerate or reconcile `supabase/drift-manifest.json` once after C01/C02 migrations stabilize and once after C03/C04 migrations stabilize; never copy generated artifacts from another worktree.
- `npm run check:production-readiness` is approval-gated by the saved workflow flightplan. Do not execute it during C00-C06 without a later explicit approval. Record it in C07, not as a local pass.
- Use `npm run arbiter -- <gate>` before any expensive final gate. A `DEFER` or `PROVEN` result is evidence, not a pass. Never rerun an unchanged successful gate.

