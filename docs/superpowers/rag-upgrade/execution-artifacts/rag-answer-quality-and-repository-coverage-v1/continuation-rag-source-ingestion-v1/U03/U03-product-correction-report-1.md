# U03 product review correction round 1 — implementer report

Source is frozen for controller gates and fresh independent full-range reviews. This is an implemented, focused-test-verified correction candidate, not product acceptance. Original TASK_BASE remains `8c11f138e6c683a13db3b465332e7f3cbb515c62`; current unchanged HEAD is failed candidate `b651ee23d8541fbebea77ca1c621fcdec42540ad`, branch `codex/rag-local-build-20260822`. Worktree: `C:/Users/joshs/.codex/worktrees/rag-local-build-20260822/Database`. No staging, unstaging, commit, reset, cleanup, unrelated worktree action or publication was performed by this writer.

`U03-implementation-freeze-5.json` SHA256 `198730fb1732ad1b8075dde09cdcc0a97a3eb78ca4bb54905a460ef74227fb50` freezes all **41 full-range product files**, with **18 changed since candidate b651**. The figure 41 is actual full-range product changed count, not a directory-wide allowlist. Existing admitted but unchanged tests retain their ownership. No source writes/checks remain and no writer process is running. Controller may proceed concurrently with this outside-only report.

## Correction closure

1. **Fatal persistence uncertainty (ING-U03-1 / U03-S2 / U03-CG-01).** The import-pure `runIngestionEnrichmentStage` is the actual optional-enrichment boundary now invoked by Node `processJob`, enclosing its actual summary/deep-memory work. `runIngestionPersistence` classifies returned RPC errors, rejected transports and malformed/refused mutation results as fatal `IngestionAttemptError` descendants; `IngestionPersistenceError` retains the transport message/cause. Both real shared producers use it. The orchestration cancels the attempt and rejects before shadow/native work or subsequent quality/document/terminal operations. Ordinary optional model failure stays distinct. Deep-memory stage transport failure never invokes cleanup. A local construction error before commit can invoke exact fenced cleanup; a cleanup RPC failure is itself fatal, not swallowed. Cleanup is still impossible after commit invocation, including ambiguous success/lost response. Existing positive cleanup tests now induce a genuine local embedding-dimension construction error; they no longer incorrectly model an RPC failure as safe cleanup authority.
2. **Core/heartbeat handoff (ING-U03-2 / U03-S1).** `IngestionAttempt.serialize` drains the previous dispatched request, including its response validation and core handoff, before the next callback captures the current Fence. The actual Node generic mutation transport and Edge fixed-domain transport use that per-attempt queue. The Node strict-completion special case also joins it, retains legitimate completion-gate-blocked handling, and cancels on transport failure. Controlled promises cover core-first and heartbeat-first schedules, G1 adoption, no second dispatch while the first is held, subsequent G1 progress and the existing real stale-authority refusal tests. SQL authority predicates are unchanged.
3. **Rejected structured summary (U03-CG-02).** `ensureSourceAnchoredSummary` is the actual import-safe summary decision/persistence seam called by the Edge entrypoint. It uses the unchanged accepted normalizer and verifies the returned summary projection against the requested payload and actual structured/provisional completion marker. A prior kind/generation-only preserved-success response is rejected, including malformed, old-model and source-mismatched same-generation records with old complete artifact counts and labels. Real Edge orchestration cancels on this publication-boundary error before its completion gate. SQL now hard-refuses fallback over **any current structured row under the row lock** with `ingestion_summary_requires_structured_repair`; it does not preserve an unvalidated row as success. This is the expressly permitted conservative refusal route: no SQL copy of the normalizer, row-validity assertion from kind, CAS/repair subsystem, or new write authority. A concurrently replaced structured row likewise refuses fallback. Fully valid existing structured input remains the positive control; accepted new zero-label fallback is provisional and deferred. The SQL signature, arguments, grants and types remain unchanged. The schema mirror has the identical corrected function. SQL replay/concurrency is unrun.
4. **Caption/model signal (ING-U03-3).** The exact reviewed four-owner amendment was hash-verified and admitted before production edits. `classifyAndCaptionImageFromBase64` and `generateModelIndexProfile` accept an optional signal, check pre-abort, forward the same signal to lower generation, and refuse late successful results. Caption's post-await check is before its broad JSON fallback catch; model-index checks before truncation/parsing. Real worker caption and deep-memory callers supply their current attempt signal. Models, prompts, budgets, cache keys, SDK retry configuration and noncancelled defaults are unchanged. The controlled retry mock has an uncancelled two-request control. Installed SDK 7.4 backoff sleep is not immediately abortable: proof is no next simulated fetch after cancellation, not immediate settlement or live-provider behavior.

## Actual mutation/schema inventory

- Node summary: existing `persist_ingestion_summary_projection` through new fatal response boundary.
- Node deep memory: existing `stage_ingestion_deep_memory`, `cleanup_ingestion_deep_memory_staging`, `commit_document_deep_memory_generation` through the same fatal response boundary. Cleanup remains pre-commit/local-error-only.
- Node main: all existing generic mutation names, including `commit_document_index_generation`, renewal/progress and terminal calls, dispatch through the per-attempt serial transport. Existing strict completion has its explicit serial branch. No direct table-write fallback added.
- Edge: all existing fixed-domain SQL RPC dispatch uses serial attempt state. Summary result is returned to and checked by the actual producer; failure cancels owning Edge attempt.
- SQL change: only body of `persist_ingestion_summary_projection` in `20260831101000_fence_ingestion_leases_and_repairs.sql` and its effective schema mirror. No new RPC/table/type/ACL/signature; final P05 prerequisite body/trigger/grant closure remains unchanged. No historical migration edited or applied.
- Shared Fence parsing, authority fields and accepted U02 normalizer remain unchanged. `IngestionAttempt` gains dispatch serialization; no fake/optional Fence or replacement authority.

## Commands and retained iteration outcomes

All repository commands used R explicitly. Before each test invocation the arbiter returned **RUN** for db scope. Tests used process-local `GATE_RECEIPTS=off` and `GATE_ARBITER=off`, restored in `finally`; the repository coordinator was retained. Every test log and immediate exit record is preserved under its unique name. No coordinator/parser/module failure is being called RED.

| Evidence prefix | Literal command | Immediate exit / result |
| --- | --- | --- |
| `U03-review-correction-red-1` | `node scripts/run-vitest.mjs run tests/worker-behavior.test.ts tests/worker-run-loop.test.ts tests/document-enrichment.test.ts tests/deep-memory.test.ts tests/indexing-v3-agent.test.ts tests/ingestion-lease-fencing.test.ts` | 1; 15 failed, 158 passed, 6 files. Twelve actual behavior failures (7 shared persistence, 2 dispatch races, 3 Edge preserved-invalid), one SQL source assertion, two existing source-location assertions after mechanical extraction. |
| `U03-review-correction-green-1` | Same six-file command | 1; 2 failed, 171 passed. Local-construction cleanup fixture supplied one vector instead of one per card; failure occurred at earlier embedding-count validation. Fixture corrected to preserve count and fail dimensions at intended post-staging local construction boundary. Not a product correction regression. |
| `U03-review-correction-green-2` | Same six-file command | 0; 175 passed, 6 files. Added locked-refusal and agreed provisional-fallback controls. Superseded only for later cleanup closure by GREEN3. |
| `U03-review-cleanup-red-1` | `node scripts/run-vitest.mjs run tests/deep-memory.test.ts -t "cleanup uncertainty"` | 1; 1 assertion failed, 33 skipped. Actual optional orchestration resolved after cleanup transport rejection. |
| `U03-review-correction-green-3` | Same six-file command | **0; 176 passed, 6 files, no skips**. Final source/test inputs rehashed at freeze and all match. Includes cleanup closure and source/schema parity. |
| `U03-review-wrapper-red-1` | `node scripts/run-vitest.mjs run tests/openai-cache.test.ts tests/model-index-extraction.test.ts` | 1; 8 assertion failures, 21 passed, 2 files. |
| `U03-review-wrapper-green-1` | Same two-file command | 0; 29 passed. |
| `U03-review-wrapper-green-2` | Same two-file command | **0; 29 passed, 2 files, no skips**. Final wrapper/test bytes after a test mock-parameter type annotation and formatting. |

GREEN3 and wrapper GREEN2 are **two separate focused runs**, totaling 205 passing tests, not a single full-suite verdict. Wrapper GREEN2's input inventory also records contextual Node caller files: deep-memory's later cleanup-only edit changes that contextual full-file hash, but not the wrapper test import closure or its signal call. The updated actual deep-memory caller is covered at final bytes in GREEN3. No unaffected wrapper rerun was performed after that cleanup-only edit.

Before corrections, the Node optional and Edge summary logic were mechanically extracted into actual production-used import-pure seams; their behavior was preserved for RED. No missing export/module was used as RED. Exact RED test bytes are saved separately. Two old Edge source-location assertions were updated to follow the adopted production seam, retaining the normalizer/coverage requirements. Later tests add two Edge controls and one cleanup regression. The original initial-U03 actual-summary RED/GREEN snapshot and all earlier freezes/reviews/reports remain intact.

Formatting: `node node_modules/prettier/bin/prettier.cjs --write` ran on the 16 explicit corrected TS/Markdown paths (the 18 changed paths minus SQL migration/schema), exit 0. Subsequent final edits were formatted on `worker/main.ts tests/deep-memory.test.ts` (raw `U03-review-final-format-1.log`, exit 0) and `src/lib/deep-memory.ts tests/deep-memory.test.ts` (tool transcript, exit 0). The last source edit simplified that already formatted cleanup helper to one awaited statement. No whole-repository formatter/gate ran. Controller owns final exact-byte formatting verification.

Source self-review inspected the corrected production diff, unchanged normalizer, actual caller/adopted seams, cleanup entry/commit boundary and test fixtures; caught and fixed the cleanup swallow before freeze. Two read-only outside-path misses (`U03-source-freeze-4.json` instead of `U03-implementation-freeze-4.json`, and the earlier retained context lookup) are tooling lookup issues only, not test evidence. The current round's recorded terminal miss did not write source or change acceptance state.

## Scope changed since candidate

- `docs/ingestion-state-machine.md`
- `src/lib/deep-memory.ts`
- `src/lib/document-enrichment.ts`
- `src/lib/model-index-extraction.ts`
- `src/lib/openai.ts`
- `supabase/functions/_shared/ingestion-attempt.ts`
- `supabase/functions/indexing-v3-agent/behavior.ts`
- `supabase/functions/indexing-v3-agent/index.ts`
- `supabase/migrations/20260831101000_fence_ingestion_leases_and_repairs.sql`
- `supabase/schema.sql`
- `tests/deep-memory.test.ts`
- `tests/document-enrichment.test.ts`
- `tests/indexing-v3-agent.test.ts`
- `tests/ingestion-lease-fencing.test.ts`
- `tests/model-index-extraction.test.ts`
- `tests/openai-cache.test.ts`
- `worker/behavior.ts`
- `worker/main.ts`

## Source freeze — full original product range

| Path | Raw SHA-256 |
| --- | --- |
| docs/codebase-index.md | 8b2a83555b2755e5a0c18954c547599f24d43cf9be882fccb578e8ead32ce398 |
| docs/ingestion-state-machine.md | db103656a2ddb41a41e3d4f169969436b7281990cd99aa02a84dd272d03ec21c |
| docs/reindex-runbook.md | 4a3f882afefd139a1ca1435056ca793126d3ea4bf98e2a53031be76b6b91c829 |
| docs/scripts-index.md | fbdba991d8317b5dab295fa0fd5f568cddc817085cd276c58210db60b0bc2bb4 |
| docs/superpowers/rag-upgrade/continuations/rag-source-ingestion-continuation-v1/U03-execution-contract.md | 877594a62de02ef3391ae0c9ca7594b827e768d8b0603eef3adfba0530dc2939 |
| docs/worker-deploy-runbook.md | 26905d350d69cad2c6d80791758fde73427bf29726e8a807a5c1c5851822072c |
| scripts/archive/backfill-enrichment.ts | 0cd838d19a18e26159c50c9291f33fbcb2263c6e8b0cbaf1d2ca981682fb0059 |
| scripts/backfill-smart-index.ts | e99df48b3474a7674616d0fb7e674adc4636ebcc68ea92f1e0993231963d05ba |
| scripts/enrich-documents.ts | 6f7d02225bfa4331c1ec7a75b1aaea7f15bb7d71ace1b0ac6c9e500748973b92 |
| scripts/lib/ingestion-operator-compatibility.ts | 1280b45cf22e8042c1d824721a67759eba5c8ad2dc6cd49c311ad635ba883fe0 |
| src/lib/deep-memory.ts | 5c49a98df7cc3c4137a8cecf3faea84ecfe681f499328f24e4c67ca82ada76b4 |
| src/lib/document-enrichment.ts | f61d7eb90176e256908c7191be18d06762b1ca74cbb1bda3abac9e91f021680f |
| src/lib/ingestion-repair-plan.ts | 5d271f9f51a6a01b5189a5d3b741c8c83e58b7b59e9ed57b7f8a3de5b0f58d9d |
| src/lib/model-index-extraction.ts | a56e05d4ec761307711285070f43585717d221937680f7e4ec575fd73cce2eda |
| src/lib/openai.ts | 91a4c355799f8b40e54a0a667704b65a9b7a2adcd1a3084912566b94c30a3600 |
| src/lib/supabase/database.types.ts | dcb21f4473fa1bc75d772583b2b5cbc239064f19084bc8a04514a852cc440480 |
| supabase/functions/_shared/ingestion-attempt.ts | d1ca227522e8aca6e4f28f1fa94a61c1980202a59b83cee3e8d4384e518cf0a7 |
| supabase/functions/indexing-v3-agent/behavior.ts | 18dc1a342773953d02a14a1609c1fd10f99776646aff7db28ee0775c6c8fad1a |
| supabase/functions/indexing-v3-agent/index.ts | 37de3c8731fb379b0786ab22ff4ce9c7254ba8f504cf95cb7f0f2409a956a331 |
| supabase/migrations/20260831101000_fence_ingestion_leases_and_repairs.sql | 92924c2c2b324866a18a0436a581b37886a44f440b6fbc8cd84fda22eed9ad0f |
| supabase/schema.sql | 34c22c97cabd6b9a0f754265c1b4da69b440c5c250f66fb3bffa551b83a31741 |
| tests/check-indexing-contract.test.ts | 52f422d78bc76172404ee6677ae71817d639070bbf92dff082576718009f122e |
| tests/deep-memory-transaction-sql.test.ts | dbd6cfab7b858d4023386f1054641fb644e01716cf3ecd34db0cec8b2700e533 |
| tests/deep-memory.test.ts | cb70e89b5a78c9892478f6e081ba456b7e233fad6e9202d3405451fc629617b0 |
| tests/document-clinical-summary.test.ts | 5bda65ee6ab49b2a2f4b6cb773e77fccd775d88aee4732d63286e605b49841a6 |
| tests/document-enrichment.test.ts | 8949b27ab7d80216c01660c28cc4b93aa863dfa94a9f4c27e2bd2ab8711d92dc |
| tests/indexing-v3-agent.test.ts | 577f5992151b27ac43db66f23be2ad98624ea8b3d7d604f9ba85585994656023 |
| tests/ingestion-lease-fencing.test.ts | d0a1501be8b9e553a4c990e872832533556dd55fe7a1e2e4a0372c29af6da575 |
| tests/ingestion-operator-compatibility.test.ts | 54716210a3f6de028c1a2f219cb1cf1f90e281019c281e8b898c95937f025961 |
| tests/ingestion-repair-plan.test.ts | 4b8d6236584fed0fca96219fb007d3476fed2efdb833ef2a0b59149450f816f4 |
| tests/model-index-extraction.test.ts | 448686b87165b8f55cd93b837961322fb22fb084905be635444d0f7823005757 |
| tests/openai-cache.test.ts | 7a81176ac9714585122cc855160b3e7dd2b15767c6984f1d07a5f21ee270ea26 |
| tests/storage-upload-compensation.test.ts | addc75e18eea0b1bb15dcebb4474637a58eaee0a0de05964d7ffbb21b0f455b2 |
| tests/worker-row-contract.test.ts | 0b87c98f55e464ecc5675f63b76df4cfd2f756d7cbd7c3a305ab8705e50b0c10 |
| tests/worker-run-loop.test.ts | 3e44bd5f35b26d2c7cd8dbfc49bef80dc8ccf9d7551ba6036a82a8e1045238d5 |
| tests/worker-shadow-extraction.test.ts | 85369bb50897e913bcebbb743b82708132fe5d59d4c2e73a2b8e725b2f6eca7f |
| tests/worker-visual-capture.test.ts | f3f793cce7bc8a01910f7c8d44a7671d26d823cdb5dd8a7022675950b81178a6 |
| worker/behavior.ts | 0c88c04898e3d9425b7158c30b55fed15a4788fac246a006f734f9f7a48d1183 |
| worker/main.ts | bc7554899c99953cc21da91f1ee3ce745e46fdac90cb8e092282b96f69bc871c |
| worker/row-contracts.ts | 41474352c1ea70ec15e77894e50e656ccb8e76e071713243b7e1f20e899252db |
| worker/types.ts | b9c2647b1982149551756648436d1f7d4b630cf06be9700d4a701338222bb53c |

## Raw evidence and byte identity

`U03-product-correction-artifacts-1.json` enumerates raw logs, input/result records and exact RED test snapshots. Every original filename is retained; no failed result or old hash was rewritten. The artifact inventory SHA-256 is `ff62de83f53999191acc117425e3e393311aac2e9d08a08b6bfbb7fa3f4b11d3`.

| Artifact in O | SHA-256 |
| --- | --- |
| U03-review-correction-red-1.log | 5bb484467990c2e124e7e01b3578e93ff72cabf4c734890073b70a3dfdba2dc3 |
| U03-review-correction-red-1-inputs.json | 94315ab98a2018b0a57b00e56f1ff5519f86578d0e26ec57ee8f90b81a005d93 |
| U03-review-correction-red-1-result.json | 90df6097d8d66b580d9cd5a9ad984b3033dd01abd12b6023d3f92516989c04f0 |
| U03-review-correction-green-1.log | 0f9108a0c6419172d920acbfb319a548114d3be9763e184293048e001540cd57 |
| U03-review-correction-green-1-inputs.json | cc77f9f7a91204131add910e07ef7cf4f7a21fcc13a1df7668fcf933d94c7665 |
| U03-review-correction-green-1-result.json | 0549f51d0c10d5db00bfc16c4efabe83ec983213b910a66aa0b6cc5e572a16b5 |
| U03-review-correction-green-2.log | 17c30e51303e8adb73dfef3724ba512b72020f033e701b78ab841aaf2eaa4250 |
| U03-review-correction-green-2-inputs.json | 290751543c99601c84a48030fba74022f4813e272405db84681e9ab2a25136af |
| U03-review-correction-green-2-result.json | a7a613e5b056be3de4a62e89290d1c3ed07c5540bf2005d5cbcbb8f862dfcf62 |
| U03-review-correction-green-3.log | 0ecac889a355cf9eecdc47985de90d8b5f10bc58d1ec61f1760d18a49f292c7c |
| U03-review-correction-green-3-inputs.json | 2bb788f658047ca54c7149e89f7a3ab711390ce14bdd2146f7cfc996db98f23e |
| U03-review-correction-green-3-result.json | 60dcd9e112b6d6f0fcd7e7f85cb9c5e49eaf8e0c50ad5207326847f32bd695ac |
| U03-review-wrapper-red-1.log | a3f9be321a65f38520f111add205d1b60c92b8a014d732d38face5991c094a7e |
| U03-review-wrapper-red-1-inputs.json | aa09971c019084fc8fa998a8cd3da1e5657fc21ed8e8e8a7481492675e5e2873 |
| U03-review-wrapper-red-1-result.json | 9bee114ecdb9d4dc22e0bd0e35649cebf5e79ca4521f6222ae33b5cc7978898d |
| U03-review-wrapper-green-1.log | e8e1e7c096b9006e76ca3ee0bb8a9eae8b486d6f1124da2dd7d4719680223290 |
| U03-review-wrapper-green-1-inputs.json | ae7e8f10daa520ebdc80ea34b4930ee5fdb525a3a9bf679579c192c50263c1d5 |
| U03-review-wrapper-green-1-result.json | 615e66dfdda79af1ca3a03866006c74d65966d758c319e54714ba9c68eb115df |
| U03-review-wrapper-green-2.log | 793b7b05449a55212fa2e086d1a31d9caac7fb3ce48549996176524b436d50c1 |
| U03-review-wrapper-green-2-inputs.json | 5da4e274ac4a80ea487661b4e75d61b0244aa26eaf456cd16fa795f86b50d676 |
| U03-review-wrapper-green-2-result.json | 81c863c3caad27d92ba26a9575225d4d7c4c4c73ab12956785c9171a92d1e5b6 |
| U03-review-cleanup-red-1.log | 0a96226b77318f9a2c2d5b51abb60d1dd33163f6376f12abf3250fb10c13511a |
| U03-review-cleanup-red-1-inputs.json | 1f39ccbedf06fd0381b4403bac45a9b07f39c41e993b16e0882c5039788e2c5b |
| U03-review-cleanup-red-1-result.json | 5d82c60b85830a148fad85b0d9a5362954d26aa2089244636e8b6605a54b50b5 |
| U03-review-wrapper-green-2-arbiter.log | 82627bbbbc6871be85d955e0043c72963be1f0842797257ce342fe97327944ca |
| U03-review-final-format-1.log | 7aa8292331c07c3718e39196c169c843a441af7a4c8e406edb8073c05a53e108 |
| U03-implementation-freeze-5.json | 198730fb1732ad1b8075dde09cdcc0a97a3eb78ca4bb54905a460ef74227fb50 |
| U03-review-correction-red-1-worker-behavior.test.ts.txt | 929b27afe1d90457580f8d266797bff8764534a922f7291cc56cf55e3d461127 |
| U03-review-correction-red-1-worker-run-loop.test.ts.txt | 3e44bd5f35b26d2c7cd8dbfc49bef80dc8ccf9d7551ba6036a82a8e1045238d5 |
| U03-review-correction-red-1-document-enrichment.test.ts.txt | c09844f5ad063c9922e121ac77d8ec5e80e9892d65ec1f1eb698e7471cc0cdc8 |
| U03-review-correction-red-1-deep-memory.test.ts.txt | ea9e683871175ce689c5bb4bf6b058e4e10c67fe5a18baeccf16f4947dd2cd9b |
| U03-review-correction-red-1-indexing-v3-agent.test.ts.txt | a848b1b6e771476883f31b5c499bf1627574d80566aa0c05ff4086d71d97bf82 |
| U03-review-correction-red-1-ingestion-lease-fencing.test.ts.txt | 0481577209bac69c86d66f9a524e45ceed76f0030b3673b58638aedd102b56c6 |
| U03-review-wrapper-red-1-openai-cache.test.ts.txt | af2636a720c1d599f031a2d83fa621e8d9c1821d1c451d15a7c12503468dd178 |
| U03-review-wrapper-red-1-model-index-extraction.test.ts.txt | ca118be477fd330a67cfe1005c25d14d1551af8847728294b359406edae9ac03 |
| U03-review-cleanup-red-1-deep-memory.test.ts.txt | 16f29613d2db0c5d4fa887ed0b4a1b5e62804f662a97e4090f848704a4727288 |

## Route and residuals

Own selected current local route: session `01a08132-76f2-7161-a28c-07d907a472f4`, model `gpt-6-astra`, effort `high`. Only own selected turn-context model/effort and own thread identity were observed in `C:/Users/joshs/.codex/sessions/2026/09/08/rollout-2026-09-08T21-26-03-01a08132-76f2-7161-a28c-07d907a472f4.jsonl`. This is local configuration, not backend attestation. No child agents were spawned; one source writer.

Controller compiler, reviewed two-root Edge closure, indexed static checks and fresh independent full-original-range reviews remain pending for this freeze. Prior candidate compiler/test/Edge passes did not close these findings and are not claimed as corrected acceptance. No SQL replay, migration application, hosted/provider/real document/native extraction/Storage/worker/server/operator/repair/reindex/activation/deployment/publication was run. Mocked boundary behavior and authored SQL assertions do not prove installed transactional/concurrent/role behavior, physical cancellation or clinical validity. An invalid structured row refused by fallback remains for separately governed structured repair; this correction does not recover it. Optional non-persistence model failures retain their existing behavior.

Historical U02 remains exit 1, four failed suites, 45 failed and 586 passed overall; no inherited green exception. Kernel remains default-off; C01/U04 and clinical/C07 acceptance are not advanced. All original candidate/review history and unrelated baseline module-index gaps remain preserved.
