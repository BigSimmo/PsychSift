# U02 audit correction brief — authorised after planning and capability gates

Programme/unit: rag-source-ingestion-continuation-v1/U02, F02 corrective packet with F14 producer-regression coverage. The user authorised this correction, focused checks, independent reviews and local commits. Dispatch follows independent planning review and routing/checkpoint preflight. Original U02 briefs and accepted receipts remain unchanged.

Accepted original task base: 08df4cddce457ba016b0d31fcf7202a4b564776a. Accepted product: 6adb834e48b3c1af4579ef22738d942803ab6893. Assessed evidence HEAD: 2dad59e0ee26ab6586f6a49ec1dfdb993d1f9ad7. Correction TASK_BASE/TASK_HEAD: not assigned; pin the actual authorised post-documentation base before future dispatch. Never report these proposed fields as execution evidence.

Problem: projectSourceAnchoredSummary builds a newline-separated multi-item overview, while canonical-field validation collapses whitespace and rejects it. Flattening one field alone cannot solve exact projection equality. Reuse the audit's unchanged synthetic diagnostic as historical evidence; do not rerun it merely to establish context.

Owned product seam: supabase/functions/_shared/source-anchored-summary.ts and src/lib/document-enrichment.ts only where producer alignment needs it; affected tests/document-enrichment.test.ts and tests/indexing-v3-agent.test.ts. Other existing U02 files are read/verification inputs, not automatic edit scope. Add any further owner only for a demonstrated dependency and explicit brief update.

Correction: choose one consistent bounded aggregate projection or distinguish canonical items from formatted aggregates. Preserve exact equality, nested validation, all existing bounds, generation/anchor membership, model authority, provisional fallback and metadata ownership. No schema/RPC changes, semantic adjudication implementation, U03 persistence work, Answer/search edits or providers.

Proposed initial regression name: "round-trips multi-item source-anchored summaries from the real producer". RED/GREEN command after the test is authored under current authority:

```text
node scripts/run-vitest.mjs run tests/document-enrichment.test.ts -t "round-trips multi-item source-anchored summaries from the real producer"
```

Expected product RED: supported two-item producer output rejected with source_anchored_summary_profile_overview_invalid; not missing test/dependency or environment failure. GREEN: valid 1/2/8-item collections pass actual adapter -> projection -> validator, while wrong aggregate, noncanonical item, bad nested anchors/generation and unsupported shapes reject. Use safe synthetic statements, not clinical recommendations.

Execution preflight: set process-local GATE_RECEIPTS=off and GATE_ARBITER=off before the focused wrapper/arbiter, and restore prior values afterward. These existing modes prevent protected-untracked bookkeeping and force real tests with the coordinator/offline sandbox retained. Record the arbiter RUN/off override. Local commits use the existing SKIP_DOCS_SYNC_HOOK=1 only for the commit, with explicit staged-path/format/import/index/adoption-scope inspection. The canonical SDD local bookkeeping section owns these scoped bridges; no hook/config or test weakening is authorised.

Final affected selector (consult the arbiter/coordinator with the safe settings above):

```text
node scripts/run-vitest.mjs run tests/indexing-v3-agent.test.ts tests/document-enrichment.test.ts tests/worker-shadow-extraction.test.ts tests/check-indexing-contract.test.ts
npm run check:edge:functions
```

The test name above is proposed and does not exist as verified execution evidence. Record literal commands and actual counts at execution; do not predict 98 tests after additions. No broad Answer baseline is proposed for this bounded correction. That omission is scope selection, not acceptance or renewal of the historical exit-1 exception. If scope expands into evaluated Answer/search dependencies, reselect the gate and require a new explicit decision for any retained failure.

Proposed writer after policy adoption: Astra/high; distinct ingestion-worker and clinical-governance reviewers at their required floors. Review the complete immutable corrective TASK_BASE..TASK_HEAD and explicitly check integration with the original U02 contract/base using unchanged historical evidence. Keep original TASK_BASE for every correction round; no correction-only final review. Reviewer verdicts: specification and quality separately. Runtime SQL concurrency and provider/model parity remain unproven.

Record accepted local corrective evidence. The controller then freezes shared contracts and may continue U03 under current authority; this U02 writer does not own U03. Do not apply SQL, process real documents, run workers, activate, deploy, publish or contact the separate RAG task.
