# U03 contract execution review 2

Specification: **PASS**. Quality: **PASS**.

No remaining concrete Critical or Important blocker was found in the complete amended original planning range and frozen execution-recipe package. Both round-1 Important findings are resolved. This is acceptance of the reviewed documentation and prospective execution contract; it is not product acceptance or an assertion that any generator, compiler, test, SQL schedule or worker has run.

## Round-1 findings and correction evidence

### U03-EX-01 — Resolved

`R/docs/superpowers/rag-upgrade/continuations/rag-source-ingestion-continuation-v1/U03-execution-contract.md:145-147` now explicitly includes the final `guard_document_publication_transition()` from the P05 consolidation migration and preserves its `documents_require_publication_approval` binding. It names the three missing approval columns and the exact v2 completeness constraint from `20260822123000_govern_australian_source_activation.sql`.

The effective-object comparison now follows selected writers' DML-trigger dependencies and compares their effective definitions, rather than merely checking that referenced objects exist. It explicitly includes this guard/binding/column/constraint set and retains separately authorized migration-chain versus snapshot lifecycle-exit schedules. The correction expressly supersedes the older preparation recommendation's omission. It does not introduce obsolete bulk-publication behavior or historical backfills.

This closes the planning defect identified against the actual attached snapshot trigger at `supabase/schema.sql:8265-8356` and its final P05 replacement at `20260824120000_consolidate_public_source_lifecycle_authority.sql:379-465`. Those source observations are reused from review 1; the corrective planning commit changes no SQL.

### U03-EX-02 — Resolved

The corrected frozen native wrapper `O/U03-contract-review-2-inputs/U03-edge-native-check.mjs:1-5` has Node builtin static imports only. Lines 18-32 pin all four files in its local helper execution closure and verify canonical repository paths before reading their bytes. Lines 63-67 verify the entire closure before the two dynamic imports, then recheck before acquiring the unchanged coordinator. Lines 60, 84-87 include the helper identities in before/after evidence and revalidate before recording success.

The fixed helper hashes cannot be replaced by a future Edge manifest entry. All four currently match the actual named repository files. `U03-controller-gate-recipes.md:74` accurately documents this behavior and preserves the earlier wrapper/report. The correction closes the pre-import identity gap without removing the coordinator, weakening the environment helper, widening repository discovery or executing either Edge handler.

No altered-helper execution check was run: closure follows from the reviewed ordering and fixed comparisons in source. The reported syntax-only check remains syntax evidence, not an executed wrapper verdict.

## Full original-range assessment

The acceptance range remains `fd043b262ebd9b20315c2e46bc4838265787fa80..73b5b0f39671073eb135ddfd8e8ab25e2afba9ca`, not `481270d8..73b5b0f3`. The five original changed documentation files remain in scope. The only repository change after review 1 is the U03 prerequisite correction above. The two revised outside files are the native wrapper and controller recipes; the other twelve frozen inputs retain their prior hashes.

I reassessed the corrected integration against retained independent review-1 inspection of the applicable root instructions, canonical execution contract, execution authority, original Task 3/global constraints, both new contracts, all-writer preparation, operator boundaries, current P05 final definitions and installed Next/TypeScript source. This reuses unchanged evidence; it does not restart the historical audit or rely on another specialist's verdict.

The resulting contract remains coherent across:

- Durable kind/job/document/worker/token/generation/policy authority; Node G0-to-reserved-G1 handoff, cross-queue exclusion, wall-clock expiry and persisted renewal duration.
- P05 source/document/job/artifact/batch serialization; fixed domain operations, grant confinement, hard-error handling and exact stale refusal with no fallback mutation.
- Atomic summary/label/metadata and deep-memory/anchor/alias ownership; manual/organisation data preservation; strict operator-entry refusal; attempt-bound Storage attachment, monotonic cancellation and lost-response non-cleanup.
- Bounded dry-run repair plans/audit, explicit allowed files, one writer and one immutable U03 acceptance range across serial increments.
- Scoped generated Next ambient declarations, original compiler semantics and protected host, staged migration/index equivalents, truthful environment scrubbing and failure preservation. No new compiler options, generated roots or input-scope exceptions were introduced by the correction.

The prospective recipes are reviewable and adequately scoped after the two corrections. Their actual runtime compatibility and resulting product evidence must still be established by their later authorized executions. No unchanged source gate was re-derived.

## Range, package and input identities

R = `C:/Users/joshs/.codex/worktrees/rag-local-build-20260822/Database`.

O = `C:/Users/joshs/Codex-Handoffs/Ingestion/Execution/20260907-continuation`.

Branch: `codex/rag-local-build-20260822`. Observed HEAD: `73b5b0f39671073eb135ddfd8e8ab25e2afba9ca`. Tracked status remained empty using `git status --short --untracked-files=no`.

Original base: `fd043b262ebd9b20315c2e46bc4838265787fa80`.

Final reviewed head: `73b5b0f39671073eb135ddfd8e8ab25e2afba9ca`.

Canonical package: `R/docs/superpowers/rag-upgrade/execution-artifacts/rag-answer-quality-and-repository-coverage-v1/continuation-rag-source-ingestion-v1/U03-PREP/U03-contract-review-2.diff`.

Observed package SHA-256: `11936f3c54c5863ba578b7afc062b939b9806f8828573bc651ad0403326d6843`.

Observed manifest SHA-256: `ec8e042af347d6215ae0a405e80c1c6ee8e96628fcfbb8f28b37d05aac99906a`, for `O/U03-contract-review-2-inputs.json`.

All fourteen frozen copies and their explicitly named current originals matched these manifest hashes:

| Input | SHA-256 |
| --- | --- |
| U03-frozen-task-context.md | f19c9a082edf068d9700e09401badfbcd270694abecb4ef8a0c4a6e62d3cdcea |
| U03-frozen-owner-preparation.md | 74bf1c4d4960feaf87787f187f1de474b9680b98b8e8b7594da324a256e78ec7 |
| U03-schema-contract-recommendation.md | adb0735ae327f04a2206a78f2bc2c7ba8a51ce6bded28d89042cdf6065f2da0c |
| U03-operator-compatibility-followup.md | b22168040664b13fb15d4b30f5e68a5fd53db4d1311798caba12f60ca982215a |
| U03-verification-preparation.md | 21abda3f3606389592fe56a71c456e3d595ffd7dfeca361291de84f37713ac0a |
| U03-verification-recipes-v3.md | 89affd9a450e51521b87ddb98d79e8e96274299fc750d37874c237f0400d26c2 |
| U03-generate-next-ambient.mjs | 5e030753100ff2c7fbc51a5893ba751e806f7b5a0a9b80a505a936a68b78caf4 |
| U03-tracked-typecheck-v3.mjs | 76b7d36588738e7db9edd60c146026e1771455315278ed495b07d97386b72879 |
| U03-reviewed-compile-inputs.json | edd5a7bba598532082fe69049cbcf3d3a09d126258f6ee29713e57a5e4d29643 |
| U03-staged-migration-role.mjs | 08f41c5dd10428d8b55b3c2594b566890af71e485a6e9d4f2aca791651128bae |
| U03-staged-index-coverage.mjs | f4b08f35b5f08c02c054e1364dd8cddb860e579321e9ddd8308e041bf6581041 |
| U03-edge-native-check.mjs | a5a02594c3a4e4e91c0492b275364fff6dfd6c6dc25fec69a33167c5852172b7 |
| U03-controller-gate-recipes.md | 9f9ef41e48e51b8b3ff12ed563a63ec9ff72190b4d4de51cb1a0ccd1aaf4d3d9 |
| U03-plan-static-preparation.json | e1224decb77a6e4ffaf706fdecad6eaac62e51277bf59d3f9411a0bfdf894389 |

Review 1 remains preserved as FAIL at `O/U03-contract-execution-review-1.md`, observed SHA-256 `e7e1f2ba5166fa98f2ebbe99a067414c976322f2b1218daeb0d0137471139f05`. This report supersedes its unresolved verdict for the corrected range; it does not rewrite that attempt.

## Requested and observed own route

Requested for this correction review: independent `gpt-6-astra` / `xhigh`, role `supabase-schema-guardian`. This is the same independent reviewer continuing its own correction cycle, not a preparation author.

Exact own log, read with shared access and only selected session_meta/turn_context fields:

`C:/Users/joshs/.codex/sessions/2026/09/08/rollout-2026-09-08T21-02-01-01a0811c-7550-7980-926d-fdfe2e62bfa7.jsonl`.

- `session_meta`, line 1: session `01a0811c-7550-7980-926d-fdfe2e62bfa7`; provider `openai`; parent `01a07b47-4623-7e90-825a-ec25116b8531`; path `/root/u03_contract_execution_review`; role `supabase-schema-guardian`.
- Current correction `turn_context`, line 231: model `gpt-6-astra`, effort `xhigh`; matching collaboration model/reasoning settings. The original turn_context at line 8 has the same route.

This is observed local resolved configuration, not backend attestation. No other child's route or launch request substituted for observation. I did not author the fixes or read another independent reviewer's verdict. No recursion or other-task messaging occurred.

## Checks and residual gates

This round performed read-only Git/diff and corrected-source inspection, package/manifest/frozen-copy/current-input/four-helper hash checks, and selected own-route metadata inspection. It reused the unchanged installed-framework and SQL source inspection documented in review 1. No tests, arbiter, ledger, generator, compiler, staged validator, SQL, provider/network call, worker/server/handler/native-document operation, install, commit or publication was run. The only write is this outside report; controller owns ledger/checkpoints.

Before any native Edge gate, the complete future product source/config/import closure must actually be frozen and independently reviewed. The `reviewReference` string alone cannot establish that. The six future TypeScript sources remain planned pre-implementation inputs; generated ambient files and actual compiler outcomes remain unproved. All implementation RED/GREEN, effective-schema parity and final original-range product/specialist gates still apply.

Separate residuals remain: disposable SQL replay/roles/grants/concurrency/rollback and both lifecycle-exit schedules; physical Storage/provider cancellation and orphan behavior; native or real document extraction; source acquisition and live workers; clinical adjudication; hosted/provider parity; activation, deployment/publication, C07 production readiness and ordinary Answer acceptance. Local source acceptance will not prove concurrency or deployment.

Historical U02 evaluation remains exit 1, four failed suites, 45 failed and 586 passed overall. It is not green and supplies no U03 exception. U03 product remains unstarted at this review; accepted U02 and historical receipts remain unchanged.