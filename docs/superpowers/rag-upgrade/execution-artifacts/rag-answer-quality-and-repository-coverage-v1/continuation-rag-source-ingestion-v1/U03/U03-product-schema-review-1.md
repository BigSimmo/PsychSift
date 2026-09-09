# U03 final product schema review 1

Specification: **FAIL**. Quality: **FAIL**. Two Important findings remain in the integrated Node-to-SQL attempt lifecycle. No Critical finding was established. These are source-traced defects, not claims of observed PostgreSQL or production failures. Final U03 acceptance remains pending.

## Important findings

### U03-S1 — Concurrent heartbeat can cancel the successful G0-to-G1 handoff

**Classification:** confirmed control-flow defect by source inspection; Important (P1). This is not a new requirement or a request to weaken stale-generation refusal.

**Owners:** `worker/main.ts:1536-1540`, `worker/behavior.ts:94-103`; the intended SQL transition is `supabase/migrations/20260831101000_fence_ingestion_leases_and_repairs.sql:633-643`, mirrored at `supabase/schema.sql:12375-12385`. The guard's G0 refusal is at migration lines 150-151.

**Trigger and path:** a Node job is committing its reserved G1 while its lifetime heartbeat fires. `runIngestionMutation` reads `attempt.fence` when each independent request is dispatched. There is no per-attempt serialization or handoff barrier. The heartbeat can therefore carry G0 while the core RPC already holds the document lock. The core transaction advances the durable expected generation and document pointer to G1 and returns its successful next Fence. The queued G0 heartbeat then obtains the lock, correctly receives `lease_lost`, and unconditionally aborts the same local attempt. The same result occurs when the database committed G1 but the successful response is still in flight when heartbeat sends G0. No new token, competing worker or G2 is required.

**Expected:** this attempt must adopt the successful G1 result and perform its remaining fenced enrichment/terminal work. Independent genuinely stale G0 callers must continue to refuse.

**Actual risk:** healthy core ingestion aborts because of its own renewal request. If heartbeat refusal wins the response race, even `handoff()` refuses the legitimate response because `accept()` first checks cancellation. Otherwise the already-adopted G1 attempt is canceled. `processJob` then throws through its lease-loss path without completing/releasing the still-current database job; enrichment is skipped and the job awaits lease expiry/reclaim. The durable SQL guard remains conservative, but the supported Node execution path cannot reliably complete the required handoff.

**Violated requirement:** the adopted U03 attempt/generation contract requires the actual Node caller to adopt the transactional G0-to-G1 Fence and use G1 thereafter, with one monotonic attempt state. Unconditional cancellation is correct only after the caller has prevented its own handoff from producing obsolete concurrent requests.

**Smallest correction/proof:** serialize Fence-dependent mutation dispatch for a single attempt, or introduce an equivalent handoff/heartbeat barrier that drains prior renewal work and prevents G0 dispatch across the commit/response interval. Do not merely ignore `lease_lost`. Add a controlled-promise regression using the actual `runIngestionMutation`/`IngestionAttempt` seam: hold the core response, schedule renewal, advance fake durable state to G1, resolve the core and renewal in both orders, and require a usable G1 attempt with the same token and no G0 request after transition. Keep the separate stale-token/G0 refusal tests. No SQL/provider execution is needed for this discriminating caller test; eventual SQL concurrency proof remains separate.

### U03-S2 — Shared persistence RPC failures do not cancel the Node attempt

**Classification:** confirmed error-routing defect by source inspection; Important (P1).

**Owners:** `src/lib/document-enrichment.ts:873-887`, `src/lib/deep-memory.ts:614-620` and `803-806`, integrated into `worker/main.ts:1732-1741`, `1753-1787`, `1842-1871`.

**Trigger and path:** during inline enrichment, the summary RPC or a deep-memory stage/commit RPC reports a missing function, permission/transport/database error, or throws a transport exception while other RPCs remain available. These helpers invoke `supabase.rpc` outside `runIngestionMutation`. Their `error` branches create an ordinary `Error`; they neither abort the shared attempt nor return a typed infrastructure/attempt failure. The worker catch only cancels/rethrows `IngestionAttemptError`. An ordinary RPC error is classified as optional enrichment failure and execution continues. Deep-memory pre-commit handling can additionally invoke its cleanup RPC after an acknowledged stage RPC failure because the error is untyped.

**Expected:** a persistence infrastructure/authority failure must terminate further work for this attempt, while ordinary optional model/extraction failures retain their separately intended behavior. Missing RPC must not leave a valid local cancellation state.

**Actual risk:** after a missing/failed persistence boundary, the worker can start optional native shadow work, publish later document metadata and complete the core job. These later writes still carry fences; this finding does not claim they bypass SQL fencing or that a direct table-write fallback was restored. It is the missing-RPC/transport cancellation closure that is incomplete. The generic shared Node transport correctly cancels these failures, but the actual summary/deep-memory owners do not use that behavior.

**Violated requirement:** U03's current shared/owner contracts explicitly require missing-RPC/failed renewal/lease loss to stop new provider/native/Storage work, retain one monotonic attempt cancellation state, and keep database/permission/malformed-response failures hard failures rather than optional processing fallbacks.

**Smallest correction/proof:** route these persistence calls through the shared cancellation-aware mutation transport, or provide an equivalent typed persistence-failure boundary that the real Node owner cancels and propagates. Preserve ordinary optional model failures and the prohibition on cleanup after commit invocation. Using import-pure actual seams, inject a summary RPC error and a deep-memory stage/commit error while later RPCs would otherwise succeed; assert the shared attempt is canceled and no shadow, final-metadata or terminal continuation starts. Existing helper rejection assertions alone do not test the swallowing caller.

## Reviewed binding and independence

- Worktree: `C:/Users/joshs/.codex/worktrees/rag-local-build-20260822/Database`.
- Branch: `codex/rag-local-build-20260822`.
- Immutable original BASE: `8c11f138e6c683a13db3b465332e7f3cbb515c62`.
- Candidate HEAD and complete commit list: `b651ee23d8541fbebea77ca1c621fcdec42540ad` — `fix(ingestion): fence ingestion attempts and dry-run repairs` (one commit, 37 files).
- Canonical full-range diff: `docs/superpowers/rag-upgrade/execution-artifacts/rag-answer-quality-and-repository-coverage-v1/continuation-rag-source-ingestion-v1/U03/U03-product-review-1.diff`, SHA256 `36d56dc5f7dc79aea8ef8598ff81106560e7f161ffb1402a73a9f36576e48adf`.
- Outside brief: `U03-final-product-review-brief-1.md`, verified SHA256 `046415976df4600924d1a3a5fea0e84a1e1e976d2a9928a838eb580a00cb8667`.
- Final source manifest: `U03-implementation-freeze-4.json`, verified SHA256 `d56cee0eba974a08e4ed9afa60af28268ab451b7f36266f2ef2c08f4153cd6b1`.
- Candidate binding: `U03-candidate-binding-1.json`, verified SHA256 `bca26796b68eb6fe94a3de7e8c5e5f4ad72e94bdf210dd672f5cdd693dd62ed4`. All 37 explicitly named current raw hashes matched its source hashes; all 37 entries bind those bytes to candidate blobs. Tracked staged/unstaged status was empty. Unrelated untracked paths were not inventoried.

This review considers the complete original range, including the integrated P05 prerequisite/ACL addition, operator refusal, compiler corrections and admitted fixture supplement. It does not accept only an amendment or the seven corrected files. Read inputs included current root AGENTS/review protocol, original Task 3, adopted U03/shared contracts, authority/allocation and continuation global constraints; implementation and compiler-correction reports; frozen owner/schema preparation; and the exact P05 amendment inputs/admission.

Reviewer: fresh independent `/root/u03_product_schema_review_1`, role `supabase-schema-guardian`, local session `01a083d2-353e-7f62-bc04-0abfc57696ab`. Own exact session selected fields show `gpt-6-astra`, effort `xhigh`, provider `openai`: `C:/Users/joshs/.codex/sessions/2026/09/09/rollout-2026-09-09T09-39-46-01a083d2-353e-7f62-bc04-0abfc57696ab.jsonl`, session_meta line 1 and turn_context line 8 at `2026-09-09T01:39:51.009Z`. This is observed local configuration, not backend attestation. The inherited turn cwd field is `D:/Repos/Database`; every repository inspection command explicitly targeted the required C: worktree and verified its root/branch/head. I was neither implementer nor prerequisite preparation/acceptance contributor.

## SQL/source assessment apart from the blockers

The full new 1,179-line migration and its integrated snapshot were inspected, including the inherited deep-memory function reached internally. The source establishes explicit two-queue branches, complete processing lease tuples, fresh UUID claims, stored bounded duration, source/document/Node/Edge locking, wall-clock expiry, reserved-generation handoff and repeated terminal job predicates. Core and strict wrappers raise on nested refusal after earlier mutations, providing authored rollback boundaries rather than returning false after writes. Required service entrypoints have explicit postgres ownership and empty search_path; internal helpers and obsolete worker overloads are revoked. The earlier four/eight-argument terminal overloads were already dropped by the July hardening owner; U03 revokes their later unfenced signatures. Generic metadata-patch capability remains available to its independent caller.

Summary publication retains the accepted U02 normalizer/projection, manual labels and organisation-owned keys; only generated labels and owned metadata are replaced. Deep-memory staging carries producer/artifact/attempt identity; source/count/collision checks, exact-current-Fence committed receipt retries, anchor repair/stamps and aliases are inside its commit path. No cleanup follows commit invocation. The dry-run repair planner and audit use the fixed UTF-8 encoding, bounded vocabulary and unique canonical UUIDs; audit is RLS-enabled, planned-only, SELECT-only for direct service access, and rejects UPDATE/DELETE/TRUNCATE. No repair-apply endpoint is introduced. These are source conclusions, not executed lock/rollback/privilege results.

The final P05 definitions were inspected in the integrated snapshot, including the restored approval-v2 guard, three active-version helper functions, nine constraint triggers, retained publication guard/bindings, three-table ACL reset and eleven internal helper revocations. The eight governed entrypoint grants remain in their existing migration owners: activation-event recording, fetch-manifest creation, staging, activation, six-argument transition, unchanged check, tombstone, and `public_source_serving_authority_stamp()`. The final U03 ACL block does not revoke those entrypoints or change global defaults. Named direct source consumers remain SELECT/governed RPC consumers; U03 reaches internal acquisition authority beneath postgres-owned functions. The snapshot's omitted unrelated P05 APIs and positional column-order difference remain disclosed parity debt. No new unrelated P05 expansion or separate catalogue was identified.

P05 review input identities: amendment admission `ce89d880c39bf582f607bc3cc1e597380c50420dcf8a44d59ea08f7b1e73c78b`; input manifest `9cd5b29e3860f2432b33c0e347f69ff0a83baedbedf65fe83276989c13a8a0dd`; frozen comparison inventory `d26029cd84b9bbf9677425b1234aa3adb4043a436c74177035a8fe7fa7332168`; exact closure addition `f0a4d9fbf17e62d6d65326f2ec952cd7ee9233fca3317a0647ae9ac98e5a96ee`; ACL correction `e7783ab81851a9f1c035781fff8609031aeebaee9ba3a6cc7abb6400ae39205d`. Earlier amendment PASS reports authorize their specific addition; they do not supply this final product verdict.

## Shared evidence consumed

No test, compiler, SQL, provider, server, worker, operator, migration or native-document processing was executed by this reviewer. The controller remains sole gate owner.

| Evidence | Observed result and boundary | SHA256 |
| --- | --- | --- |
| `U03-controller-final-tests-1.log` | 277 tests / 15 files PASS at freeze 3, preceding classified compiler corrections | `83f1e58847c38b83b8000643eabe6b4f9cf54d0f81e84ff90bc8fca0a31bce8c` |
| `U03-compiler-correction-1.log` | 98 tests / 4 files PASS for affected corrections | `716f3135b0e386255aed7d178327ac824dde4922ee1ed10127e985ce890f3368` |
| `U03-clinical-fixture-1.log` | 6 tests / 1 file PASS; corrected complete input inventory is explicitly post-run | `381601fb021bdc10e8e068d8bbf18217efa42fcfbd2e3e9c639c0c0a949e299d` |
| `U03-controller-typecheck-correction-1.log` | Corrected tracked application compilation: 0 diagnostics, 0 input/I/O violations | `e8f2a177e9e2c12b0b4046a9c7370621f708944efc60a367556826b2a7f0256c` |
| `U03-tracked-typecheck-v3-correction-1-result.json` | PASS bound to candidate HEAD; original 24-diagnostic failed round remains preserved | `d8743a0fb92955606dd1499abdfb83f06f2f0d5ecb338b8f33d62ddbd7b64ca5` |
| `U03-controller-migration-role-2.log` | Scoped staged equivalent PASS, 522 guarded inputs, immutable history included; controller reports candidate HEAD | `9abe927670e497506c6de2c5ce4dfb5914948eacc275f9c07fed2a1befa2a9f6` |
| `U03-edge-native-result-1.json` | Two actual Edge roots, frozen lock/map, exit 0 and unchanged source closure; compilation only | `4badc77cc9a79691997304ded30fe84975e6bac2026a06a1076299f729564be6` |

The full selector command is the exact 15-file `node scripts/run-vitest.mjs run ...` recipe in U03-execution-contract; the correction selector is `node scripts/run-vitest.mjs run tests/document-enrichment.test.ts tests/deep-memory.test.ts tests/ingestion-operator-compatibility.test.ts tests/worker-shadow-extraction.test.ts`. Native compilation explicitly included both `indexing-v3-agent/index.ts` and `site-content-sync/index.ts`, using `deno check --frozen --node-modules-dir=false` with the approved outside composite lock and import map. Compilation and static SQL assertions do not exercise either reported interleaving/error propagation path end to end.

The module-index wrapper remains **exit 1 / failed, unchanged pre-existing documentation gaps**, not green. I inspected baseline and final structured gap results plus the new routing addendum: `.superpowers` and the same nine named site_content table omissions remain, with zero stale names and no added U03 gap. Baseline SHA `11f5085ba36d79b87492b6a5af319e85be2c8dedafd29397bbc60016f153425b`; final result SHA `d43015d6b1ed82eae8c79b7521901eefcff60adec3377650bf3001e02f2846c6`; addendum SHA `5598254b959e4c12064d63f3244923222dab11aaecdd38f51a696cef4d3f6836`. The disposition does not justify unrelated cleanup. Scripts documentation records 272 files / 262 scripts. P04 is reused historical fixture evidence subject to unchanged closure, not a new run or live population proof.

## Remaining boundaries and handoff

The controller reports tracked-input ledger lookup found zero reviews at candidate HEAD. This review created only this new outside report; repository ledger append/evidence incorporation remains with the controller under the explicit no-repository-write review brief. No source, staging, commit or operational mutation occurred here.

Correct U03-S1 and U03-S2, run their smallest discriminating actual-seam tests through the controller, and submit the complete corrected original BASE range for fresh required review. Current passing compiler/static/mocked evidence does not clear these findings. PostgreSQL replay, lock/concurrency/expiry schedules, rollback, actual owners/role inheritance/ACL enforcement, trigger behavior, physical Storage, providers, native documents, clinical adjudication, activation, deployment and C07/ordinary Answer acceptance remain unrun and separate. No runtime-safe or whole-schema parity claim is made.

Historical U02 evaluation remains exit 1, four failed suites, 45 failed and 586 passed overall; no U03 exception is inherited. P00-P07/C00/U01/U02 history is preserved, C01 remains incomplete, P08A stays superseded, the kernel stays default-off, and later units remain unstarted pending U03 acceptance.
