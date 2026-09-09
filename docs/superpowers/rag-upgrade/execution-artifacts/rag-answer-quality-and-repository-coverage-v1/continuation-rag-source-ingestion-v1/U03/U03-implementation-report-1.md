# U03 implementer product handoff 1

Status: source freeze for controller final gates and independent product reviews; not U03 acceptance. No product commit or staging performed. All four serial U03 increments are implemented in one original task range. No known intentionally deferred U03 product owner remains; compilation, final selector and independent review are pending and may require corrections.

## Immutable context and final bytes

Worktree: C:/Users/joshs/.codex/worktrees/rag-local-build-20260822/Database. Branch: codex/rag-local-build-20260822. Original TASK_BASE and actual HEAD: 8c11f138e6c683a13db3b465332e7f3cbb515c62. Tracked staged diff is empty; owned working changes are preserved. Seven new files plus 29 modified tracked files, listed below. No unrelated untracked paths enumerated.

Final manifest: U03-implementation-freeze-2.json, SHA256 41705b7341e1f3a766c06efe48efb3999fb4a0579c75619f8d8c331b19150160. It supersedes freeze-1 only because final inspection removed 23 trailing-whitespace occurrences in the new migration and matching snapshot. Prior evidence is retained. The final main.ts dynamic RPC adapter annotation postdates the shadow/Edge test run; it changes transport typing only. Controller compilation and final selector remain pending.

Own local session: 01a08132-76f2-7161-a28c-07d907a472f4, /root/u03_implementation, gpt-6-astra/high; selected local turn_context inspected, provider openai. Log: C:/Users/joshs/.codex/sessions/2026/09/08/rollout-2026-09-08T21-26-03-01a08132-76f2-7161-a28c-07d907a472f4.jsonl. Local configuration observation is not backend attestation. No own check/process remains running.

Accepted P05 amendment: U03-p05-prerequisite-amendment-acceptance-1.json SHA ce89d880c39bf582f607bc3cc1e597380c50420dcf8a44d59ea08f7b1e73c78b; input manifest SHA9cd5b29e3860f2432b33c0e347f69ff0a83baedbedf65fe83276989c13a8a0dd. All seven amendment input hashes were rechecked before dependent edits. Governing contract adopted byte-for-byte from candidate SHA877594a62de02ef3391ae0c9ca7594b827e768d8b0603eef3adfba0530dc2939. The amendment supplements the original range and adds only that governing contract to product scope.

## Completed writer and transaction closure

- Durable authority: fresh per-claim UUID tokens; stored lease duration/expiry, expected/write generations and live authority digest; source/document/job lock order, exact matched tuple, wall-clock expiry under lock. Explicit null claim bounds refuse. Noncatalogue fallback refuses actual P05 marker presence even JSON null. P05 mutation candidates are shadow/approved only; active reviewed-state immutability is preserved.
- Node: claim-row parsing, monotonic cancellation, lifetime heartbeat, progress/document metadata, staged base chunks/images/table facts/embedding fields/index units, quality, atomic non-empty G0-to-G1 core handoff, post-commit metadata, strict completion/failure/batch aggregates. No sibling supersession and no direct table-write fallback. Malformed claims do not invent terminal mutation authority.
- Edge: full tuple parsing, renewal, stage identity, generation-bound family preparation, source membership and fixed family replacement transactions, owned visual metadata, summary projection, quality preservation, strict completion/defer/fail/batch semantics. Actual import-safe mutation boundary is used by the Edge owner; startup entrypoint was not imported by tests.
- Summary: the existing U02 normalizer is unchanged. Atomic source-anchored summary/generated-label/owned-metadata projection, null-safe summary discriminator, manual/organisation preservation, no recursive payload pollution. A validated persisted payload can be retried without a provider.
- Deep memory: every staged family is fenced and stamped with producer/artifact/attempt; exact generation membership and returned section mapping; anchor repair/stamps and owned aliases move into the commit transaction. Commit retry requires exact full identity after current authority validation. Inner commit result identity is checked before aliases/receipt publication. Alias failure shares rollback. No cleanup after commit invocation or typed lease loss; pre-invocation cleanup remains exact unpublished producer/attempt only. No destructive lost-response compensation.
- Storage/native boundaries: actual prepare/upload/attach image seam uses immutable document/token/generation/UUID paths and upsert:false; late or ambiguous upload does not delete bytes. Actual shadow preparation/work seam refuses native work after failed progress and late canceled results, retaining ordinary optional work failure semantics. Native/provider operations themselves were mocked/unrun.
- Repair/operator: canonical 1..100-document pure dry-run planner and SQL audit encoding; audit is append-only with planned-only outcome and no apply path. Three existing unleased write scripts refuse before lazy operational imports/effects. Exactly the two existing read-only modes remain under mocks. No operators executed.
- Schema/types/docs: U03 schema mirror equals the new migration after exclusion of its migration-only drain precondition. Queue/stage/audit types and fenced RPC argument surfaces updated. Runbooks supersede historical no-heartbeat/worker-id-only instructions while keeping their audit history. Index documentation names new owners. No whole-schema parity claim.
- P05 prerequisite: selected existing nine effective functions retained; final approval guard, three active-source helpers and nine constraint triggers restored; publication guard/binding and three approval columns/v2 constraint retained. Exact ACL correction touches only three named P05 tables and eleven internal functions; eight governed service entrypoint grants are retained in their existing migration owners. No historical migration changed or serving stamp added/revoked. Source declarations do not establish installed privilege enforcement.

The new migration declares 31 functions. Exact signatures/returns/owner declarations and whether each body invokes the current-attempt guard are inventoried in freeze-2. The two claims issue authority; lock/assert/source-membership helpers and audit trigger are internal. record_ingestion_repair_plan is the separate append-only, dry-run-only audit entrypoint. All processor mutation families pass through current authority. Fixed SQL operations expose no arbitrary table/callback transaction facility.

## Iteration evidence and limitations

Every Vitest invocation used the repository coordinator and consulted the arbiter; actual verdict RUN/off. Process-local GATE_RECEIPTS=off and GATE_ARBITER=off were restored in finally. No final selector, compiler, broad baseline, provider gate, migration-role gate, server or native extraction was run by the writer.

- Initial actual summary producer RED: exit1, one genuine assertion failure/33 skipped; same selected command GREEN exit0,1 passed/33 skipped. Exact original test bytes remain U03-increment-1-regression-test.ts.txt, SHA a8479e3df617229ce43844c0df2d9dad71a66e74302407bcf3b79819a0949b14 (rechecked at freeze). Failure was lease_lost expected but missing, not a missing module/parser/provider failure.
- Planner red-1: coordinator blocked before Vitest, not product RED. Planner red-2: genuine absent-file assertion RED; matching selected existence assertion GREEN. Full planner invalid-input table was subsequently corrected to avoid it.each spreading array rows; original15-pass run had that coverage limitation, corrected15-pass run retained below.
- Operator/planner1: exit1,4 failed22 passed. Operator array-row harness error; fixed, operator11/11 later passed. Original planner15-pass result had the separately corrected invalid-input coverage limitation.
- Summary/operator1: exit1,3 failed42 passed; operator11/11 passed. Two encoding-damaged literals and one obsolete metadata-argument assertion corrected.
- Summary/deep/planner1: exit1,5 failed71 passed. Corrected planner15/15 and deep27/27 passed. Summary failures identified accidental signal field pollution in canonical payload; removed that field without changing the accepted normalizer.
- Owners1: exit1,17 failed146 passed;5/8 files passed. Summary34/34 passed. Failed row/Edge/indexing static fixtures still expected old unsafe mutation paths; corrected to new actual owners.
- Owners2: exit1,1 failed183 passed;8/9 files passed. Sole old shadow assertion demanded swallowed lease loss; replaced with actual preparation/work behavior proof plus adopted source boundary.
- Shadow/Edge1: exit0,2 files64 passed. Includes actual mocked native preparation/cancellation and Edge static contracts.
- SQL/row1: exit0,3 files74 passed. Includes source-only null/identity/current authority, nested rollback and mirror assertions; no SQL execution.
- P05 closure1: exit0,10 passed35 skipped. Five exact effective function definitions (four restored plus publication guard), nine restored and two preserved trigger bindings, migration/snapshot exact ACL end state, eight retained grants, direct internal-call boundary and U03 mirror. Final SQL whitespace cleanup is nonsemantic and is recorded in freeze-2; controller owns final checks.

Initial RED/GREEN and planner proof sidecars bind exact test/source hashes. Later failed iteration sidecars did not all record then-current per-file hashes; do not infer historical source identity from final hashes. Owners2, shadow/Edge1, SQL/row1 and P05 closure1 have explicit inputs JSON. Raw outputs and child exits are retained; commands below are copied from their sidecars.

Tooling-only authoring failures retained in the session transcript: initial Python f-string syntax failure before any write; unsupported PowerShell brace path syntax; later Python default Windows encoding corruption (corrected only reversible original Unicode misdecodings, detailed in U03-authoring-encoding-correction-1.json); rejected utf8-sig encoding name before any amendment write, corrected to utf-8-sig. These are not product RED. Some of those authoring errors have no standalone raw outside log; do not reconstruct them as original raw logs. All subsequent source read/write calls used explicit UTF8. Seven exact-file Prettier iteration logs are retained; no broad formatting was run. The final single-contract formatting pass was unchanged and preserved exact reviewed SHA877594a62de02ef3391ae0c9ca7594b827e768d8b0603eef3adfba0530dc2939.

- `node scripts/run-vitest.mjs run tests/document-enrichment.test.ts -t "U03 refuses summary publication after attempt replacement"` — `U03-increment-1-red-1.log`, child exit 1.
- `node scripts/run-vitest.mjs run tests/document-enrichment.test.ts -t "U03 refuses summary publication after attempt replacement"` — `U03-increment-1-green-1.log`, child exit 0.
- `node scripts/run-vitest.mjs run tests/ingestion-repair-plan.test.ts -t "provides the bounded dry-run planner contract"` — `U03-planner-red-1.log`, child exit 1.
- `node scripts/run-vitest.mjs run tests/ingestion-repair-plan.test.ts -t "provides the bounded dry-run planner contract"` — `U03-planner-red-2.log`, child exit 1.
- `node scripts/run-vitest.mjs run tests/ingestion-repair-plan.test.ts -t "provides the bounded dry-run planner contract"` — `U03-planner-green-1.log`, child exit 0.
- `node scripts/run-vitest.mjs run tests/ingestion-repair-plan.test.ts tests/ingestion-operator-compatibility.test.ts` — `U03-operator-planner-1.log`, child exit 1.
- `node scripts/run-vitest.mjs run tests/document-enrichment.test.ts tests/ingestion-operator-compatibility.test.ts` — `U03-summary-operator-1.log`, child exit 1.
- `node scripts/run-vitest.mjs run tests/document-enrichment.test.ts tests/deep-memory.test.ts tests/ingestion-repair-plan.test.ts` — `U03-summary-deep-planner-1.log`, child exit 1.
- `node scripts/run-vitest.mjs run tests/document-enrichment.test.ts tests/ingestion-lease-fencing.test.ts tests/worker-row-contract.test.ts tests/worker-behavior.test.ts tests/indexing-v3-agent.test.ts tests/check-indexing-contract.test.ts tests/worker-runtime-control.test.ts tests/worker-run-loop.test.ts` — `U03-owners-1.log`, child exit 1.
- `node scripts/run-vitest.mjs run tests/deep-memory.test.ts tests/worker-row-contract.test.ts tests/indexing-v3-agent.test.ts tests/check-indexing-contract.test.ts tests/worker-visual-capture.test.ts tests/worker-shadow-extraction.test.ts tests/storage-upload-compensation.test.ts tests/deep-memory-transaction-sql.test.ts tests/ingestion-lease-fencing.test.ts` — `U03-owners-2.log`, child exit 1.
- `node scripts/run-vitest.mjs run tests/worker-shadow-extraction.test.ts tests/indexing-v3-agent.test.ts` — `U03-shadow-edge-1.log`, child exit 0.
- `node scripts/run-vitest.mjs run tests/worker-row-contract.test.ts tests/deep-memory-transaction-sql.test.ts tests/ingestion-lease-fencing.test.ts` — `U03-sql-row-1.log`, child exit 0.
- `node scripts/run-vitest.mjs run tests/ingestion-lease-fencing.test.ts -t "reviewed P05 dependency closure|mirrors effective U03 objects"` — `U03-p05-closure-1.log`, child exit 0.

## Final owned files and SHA256

- modified: `docs/codebase-index.md` — `8b2a83555b2755e5a0c18954c547599f24d43cf9be882fccb578e8ead32ce398`
- modified: `docs/ingestion-state-machine.md` — `e11371cc59a8ccfb00735c51663360d3df20944ed75f8aadc4dc28d92f0d93cc`
- modified: `docs/reindex-runbook.md` — `4a3f882afefd139a1ca1435056ca793126d3ea4bf98e2a53031be76b6b91c829`
- modified: `docs/scripts-index.md` — `6004689c2e8779662a16474dc401f4c1cd77d9571b050b9a3e0d7fd7d29c008f`
- modified: `docs/superpowers/rag-upgrade/continuations/rag-source-ingestion-continuation-v1/U03-execution-contract.md` — `877594a62de02ef3391ae0c9ca7594b827e768d8b0603eef3adfba0530dc2939`
- modified: `docs/worker-deploy-runbook.md` — `26905d350d69cad2c6d80791758fde73427bf29726e8a807a5c1c5851822072c`
- modified: `scripts/archive/backfill-enrichment.ts` — `0cd838d19a18e26159c50c9291f33fbcb2263c6e8b0cbaf1d2ca981682fb0059`
- modified: `scripts/backfill-smart-index.ts` — `e99df48b3474a7674616d0fb7e674adc4636ebcc68ea92f1e0993231963d05ba`
- modified: `scripts/enrich-documents.ts` — `d75dbbd2fcddcff444b3a2dfe7fcb399bc1d7d1ed23906609d6f008b39455854`
- new: `scripts/lib/ingestion-operator-compatibility.ts` — `1280b45cf22e8042c1d824721a67759eba5c8ad2dc6cd49c311ad635ba883fe0`
- modified: `src/lib/deep-memory.ts` — `40e0278ca438ca456b8d7418f2399b77da5ad1ef465bd0e2c393de7150700132`
- modified: `src/lib/document-enrichment.ts` — `c88add155b52c32043b2b21fedaf758ea9ff531206f8ecd995322f85ea9d4d5a`
- new: `src/lib/ingestion-repair-plan.ts` — `5d271f9f51a6a01b5189a5d3b741c8c83e58b7b59e9ed57b7f8a3de5b0f58d9d`
- modified: `src/lib/supabase/database.types.ts` — `cc66971dd7355e4422d29df1cacefa40524ee7b4ec81729e0017acd95a70eda8`
- new: `supabase/functions/_shared/ingestion-attempt.ts` — `9b202e70f1b1d67ea729ba9fb1e178e7e7a202055e86f2e9787ea5a485be4e71`
- modified: `supabase/functions/indexing-v3-agent/behavior.ts` — `5f3846d6ffaf9e06bb52f92f4c3e91d3bb0b3f37b3cb7b020e9d2f7260a1d0c2`
- modified: `supabase/functions/indexing-v3-agent/index.ts` — `9024019f81f7f42099cca9323621b12cbd9768bdf420e39053d99dc4074e5188`
- new: `supabase/migrations/20260831101000_fence_ingestion_leases_and_repairs.sql` — `5f83705c1de209ac324b095130df4d7687768e9031adaf994f4b4630106a9a9f`
- modified: `supabase/schema.sql` — `8b8bfaefc8cde9b9552fb9704905ecfb624979d546c8c08795e394acff2e9f9e`
- modified: `tests/check-indexing-contract.test.ts` — `52f422d78bc76172404ee6677ae71817d639070bbf92dff082576718009f122e`
- modified: `tests/deep-memory-transaction-sql.test.ts` — `dbd6cfab7b858d4023386f1054641fb644e01716cf3ecd34db0cec8b2700e533`
- modified: `tests/deep-memory.test.ts` — `aa9278696f18d4b37d3f2d9b553d93ad562b1de4bf45e1a4e85da926701d6bc7`
- modified: `tests/document-enrichment.test.ts` — `9740af0731e37343f50745155f28036459920585538be9a3d79e5bb6e3c3d898`
- modified: `tests/indexing-v3-agent.test.ts` — `1660055600d47fd98b082dff458f82cb5e1a76d4d8be9eb7d5812db1e7f0daf1`
- new: `tests/ingestion-lease-fencing.test.ts` — `137ae7ddbedbc982de488255717e06f50bdc15a8a932936546f83754fd417719`
- new: `tests/ingestion-operator-compatibility.test.ts` — `54716210a3f6de028c1a2f219cb1cf1f90e281019c281e8b898c95937f025961`
- new: `tests/ingestion-repair-plan.test.ts` — `4b8d6236584fed0fca96219fb007d3476fed2efdb833ef2a0b59149450f816f4`
- modified: `tests/storage-upload-compensation.test.ts` — `addc75e18eea0b1bb15dcebb4474637a58eaee0a0de05964d7ffbb21b0f455b2`
- modified: `tests/worker-row-contract.test.ts` — `0b87c98f55e464ecc5675f63b76df4cfd2f756d7cbd7c3a305ab8705e50b0c10`
- modified: `tests/worker-run-loop.test.ts` — `3e44bd5f35b26d2c7cd8dbfc49bef80dc8ccf9d7551ba6036a82a8e1045238d5`
- modified: `tests/worker-shadow-extraction.test.ts` — `85369bb50897e913bcebbb743b82708132fe5d59d4c2e73a2b8e725b2f6eca7f`
- modified: `tests/worker-visual-capture.test.ts` — `f3f793cce7bc8a01910f7c8d44a7671d26d823cdb5dd8a7022675950b81178a6`
- modified: `worker/behavior.ts` — `32abf24491a8e08ce3c861be16cc36e8e722cead68f7b522eaab969ca15ee17c`
- modified: `worker/main.ts` — `2156e3aad1488523433997a316845c34491729bb9c97869190065da7c7db4cca`
- modified: `worker/row-contracts.ts` — `41474352c1ea70ec15e77894e50e656ccb8e76e071713243b7e1f20e899252db`
- modified: `worker/types.ts` — `b9c2647b1982149551756648436d1f7d4b630cf06be9700d4a701338222bb53c`

## Residual gates and next owner

Controller: rebind this full original task range, preserve raw failed evidence, run the accepted final 15-file selector and specific compiler/Edge/static/index/migration-role recipes, commission fresh independent full-product reviews, then stage/commit only when accepted. P04 reuse/final dependency recheck remains controller-owned. No worktree restore or restart is needed.

Unrun and not inferred: SQL replay, installed roles/ACLs/owners and trigger semantics, transaction/concurrent/lease-expiry schedules, denied real internal/table access and retained live entrypoint behavior, physical Storage cancellation, provider/native documents, workers/operators/repair/reindex, activation/deployment/publication, hosted or clinical acceptance. The selected snapshot still has the explicitly retained unrelated P05 parity debt. Typed client transport and authored SQL must pass their pending controller gates; mocks do not prove atomic database rollback or concurrency.

U02 historical full evaluation remains exit1,4 failed suites,45 failed/586 passed overall. It is neither green nor inherited as a U03 exception. C01 incomplete, P08A superseded, retrieval kernel default-off. No earlier acceptance package or retained C00 hash was rewritten.
