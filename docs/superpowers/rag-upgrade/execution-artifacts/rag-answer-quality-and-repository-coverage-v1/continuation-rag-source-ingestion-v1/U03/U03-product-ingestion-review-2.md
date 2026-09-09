# U03 final product ingestion review 2

Specification: **PASS**. Quality: **PASS**. No remaining Critical or Important ingestion finding identified in the complete original U03 range. The four unique first-round findings are closed for bounded local source acceptance. These verdicts do not accept SQL runtime, physical cancellation, native extraction, providers, clinical behavior, deployment, C01, or the whole continuation. Other mandatory independent specialist verdicts and controller acceptance remain required.

## Candidate and independent identity

- Review root R: `C:/Users/joshs/.codex/worktrees/rag-local-build-20260822/Database`; every repository command explicitly used R.
- Branch: `codex/rag-local-build-20260822`.
- Original TASK_BASE: `8c11f138e6c683a13db3b465332e7f3cbb515c62`.
- Corrected candidate HEAD: `57ba6d6fc2505f03a1ee0df82b186bccd0a455c2`.
- Complete range: two product commits, preserved failed candidate `b651ee23d8541fbebea77ca1c621fcdec42540ad` followed by `57ba6d6fc2505f03a1ee0df82b186bccd0a455c2`; 41 files, 6,544 insertions and 2,624 deletions. This review is not limited to the 18 correction paths.
- Canonical package: `R/docs/superpowers/rag-upgrade/execution-artifacts/rag-answer-quality-and-repository-coverage-v1/continuation-rag-source-ingestion-v1/U03/U03-product-review-2.diff`, SHA-256 `5f0807fecba0aa3863e94bf3cb4df4377234e5f9d20b88dec8c39e974db17236`. Both canonical and outside copies matched; package header and commit list agree with Git.
- Outside directory O: `C:/Users/joshs/Codex-Handoffs/Ingestion/Execution/20260907-continuation`.
- Independently verified `U03-candidate-binding-2.json` SHA-256 `edf2f8feb6ec557a6cecfaab565e00407e5cf5abd7a0ec22772d56d0cd3bf539`, freeze6 `13ab6556319cd71146d0da8fdfb7b3596aa4b7f0188700a012560f248b083283`, correction report `820a6867881eb4c52624122e5cc1ed52003ae633b60fae3dfab40375e4280bc4`, and controller inventory2 `1f7e03137c13660fa0907f494c4d3ec44fb027f86ecdfdb12c39afc691f03abf`. All 41 actual raw source hashes matched binding2; every artifact hash listed in inventory2 matched. Tracked status was clean at initial and final inspection, with unchanged HEAD.
- Own observed identity: `/root/u03_product_ingestion_review_2`, session `01a08401-1c25-7690-a95d-46a32f246891`, nickname `Jason`, role `ingestion-worker-reviewer`. Exact own local log: `C:/Users/joshs/.codex/sessions/2026/09/09/rollout-2026-09-09T10-31-00-01a08401-1c25-7690-a95d-46a32f246891.jsonl`. Selected line 1 `session_meta` identifies this child and parent `01a07b47-4623-7e90-825a-ec25116b8531`; selected line 8 `turn_context` at `2026-09-09T02:31:04.109Z` gives `model=gpt-6-astra`, `effort=xhigh`, and matching collaboration settings. Only selected fields from the first 12 own-session lines were read. This is observed local configuration, not backend attestation. No writer route was borrowed.

Read applicable R/AGENTS.md, ingest/review skills, review protocol, U03 execution contract, shared freeze, dated execution authority, canonical continuation rules, frozen all-writer inventory, first ingestion review and consolidated first-round disposition, correction brief/report, four-owner cancellation amendment/admission, formatting report and final verification routing/addendum. The separately named `docs/agents/codex-review-throttling.md` is absent in R; throttling is inline in R/AGENTS.md. Reused the controller's tracked-only lookup: 456 sources, no review at this HEAD. The controller owns ledger append. Earlier programme audit and accepted preparation are context, not new acceptance evidence.

## First-round dispositions

### ING-U03-1 / U03-S2 / U03-CG-01 — fatal persistence uncertainty: CLOSED

The shared `runIngestionPersistence` boundary at `supabase/functions/_shared/ingestion-attempt.ts:23-43` converts returned RPC errors and rejected transports to `IngestionPersistenceError`, a distinct `IngestionAttemptError`, while preserving typed refusal. Actual summary persistence uses it at `src/lib/document-enrichment.ts:873-889`; deep-memory batches and commit use it at `src/lib/deep-memory.ts:614-618`.

The production-used optional boundary `worker/behavior.ts:188-202` cancels and rethrows these errors. `worker/main.ts:1687-1747` adopts it, and the outer catch at `1878-1891` cannot convert that error into retry/failure writes. Therefore summary transport failure, deep staging uncertainty, or lost commit response exits before shadow/native work and final metadata/terminal publication. After cancellation, guarded queued requests also refuse at dispatch.

Deep cleanup is limited to local construction failure before commit (`src/lib/deep-memory.ts:759-803`). Cleanup transport uncertainty now propagates through the fatal boundary (`726-730`) instead of being swallowed. Stage transport failure never triggers cleanup, and commit invocation remains outside the cleanup catch (`805-834`). No cleanup follows a possibly committed lost response.

Inspected actual-helper regressions at `tests/document-enrichment.test.ts:404-455` and `tests/deep-memory.test.ts:694-839`: returned/rejected summary RPC, section/card/unit failure, rejected stage, lost commit response, cleanup failure, no continuation and ordinary optional failure control. These invoke the same seam and helpers used by production; they do not execute a worker or prove SQL rollback.

### ING-U03-2 / U03-S1 — heartbeat/core handoff race: CLOSED

`IngestionAttempt.serialize` at `supabase/functions/_shared/ingestion-attempt.ts:88-108` holds dispatch until the previous request and local response handling settle. `worker/behavior.ts:84-110` captures Fence inside that queue and performs core handoff before releasing it. Core, timer heartbeat and progress use this transport; strict completion uses the same attempt queue (`worker/main.ts:164-197`). The timer at `1545-1549` no longer captures G0 independently of an in-flight G1 commit.

Both controlled-promise orders are tested at `tests/ingestion-lease-fencing.test.ts:320-364`: only one request dispatches while held, the next request sees the proper generation, and G1 progress remains usable. Earlier real stale-token/generation refusal tests remain. SQL generation/token predicates were not relaxed. Actual database lock schedules remain separate evidence.

### U03-CG-02 — invalid structured fallback preservation: CLOSED

The locked SQL branch now raises `ingestion_summary_requires_structured_repair` rather than returning preserved success based on kind/generation (`supabase/migrations/20260831101000_fence_ingestion_leases_and_repairs.sql:320-325`; matching `supabase/schema.sql:12062-12067`). It refuses before labels or summary are changed. This deliberately preserves the rejected row for governed structured repair without reporting fallback success or allowing completion.

`ensureSourceAnchoredSummary` in `supabase/functions/indexing-v3-agent/behavior.ts:320` uses the unchanged U02 normalizer and validates returned projection/marker agreement against the requested payload. The actual entrypoint adopts it and cancels on refusal (`index.ts:790-829`), before its completion-gate read (`1666-1681`). Tests at `tests/indexing-v3-agent.test.ts:1210-1323` cover malformed, old-model and source-mismatched rows with old complete artifacts; false preserved responses and locked refusal cannot reach completion. Valid structured preservation and agreed provisional zero-label fallback remain positive controls. SQL refusal/parity assertions remain source evidence, not executed transactions.

### ING-U03-3 — caption/model-index provider signal: CLOSED

The admitted four-owner change forwards the existing attempt signal from `worker/main.ts:905-916` and `src/lib/deep-memory.ts:628-633`. Actual wrappers accept it, check before work and after response, and pass it to lower generation (`src/lib/openai.ts:1102-1167`; `src/lib/model-index-extraction.ts:364-385`). Ordinary caller defaults and prompts/models/retry budgets remain unchanged.

Inspected actual wrapper regressions in `tests/openai-cache.test.ts:795-904` and `tests/model-index-extraction.test.ts:119-172`: exact signal forwarding, pre-abort refusal, late-result refusal, controlled retry schedule and uncancelled controls. Installed SDK `client.mjs` checks `options.signal.aborted` in `makeRequest`; backoff sleep is not immediately abortable. The no-next-request assertion is a controlled SDK-schedule mock, not physical network cancellation or immediate settlement proof.

## Full-range integration coverage

Reassessed the frozen original inventory and actual Node/Edge call chains, with unchanged first-round audit evidence reused. Node control, base artifacts, image attachment/cache, quality, summary, deep memory, stages and terminal paths reach fixed fenced operations; no remaining direct table mutation was found in those four runtime persistence owners. The shared state remains monotonic and rejected claims supply no fabricated failure authority.

SQL source checks both queues under source/document/job locks, uses actual wall-clock expiry, reserves Node G1 while G0 stays live, and advances pointer/Fence together. Reset targets only this attempt's unpublished generation; core commit refuses empty/count-mismatched data. Strict completion retains independent quality issues; terminal/retry functions derive batch and retry budget from locked state, retain committed evidence, and do not supersede siblings. Deep generation commit keeps membership/count/producer ownership and aliases in its rollback boundary; exact committed retry revalidates Fence first. Immutable Storage paths and `upsert:false` remain integrated, with no destructive compensation after ambiguous publication.

The operator helper and all three real script entrypoints retain early unleased-write refusal before lazy operational setup, with only the original read-only modes available. The pure repair planner retains bounded unique canonical documents/reasons/digests, deterministic UTF-8 encoding, and a planned-only audit RPC with no apply endpoint. Selected P05 prerequisite/ACL/schema/type/doc changes remain within the reviewed scope; the correction's only SQL delta is the mirrored summary refusal. No source-normalizer, retrieval ranking, Answer, source activation, or clinical-approval mechanism was added. Independent schema and clinical specialist reviews remain mandatory.

## Evidence consumed, not rerun

The decisive raw evidence was opened and relevant inventories/hash bindings inspected. No gate was executed by this reviewer.

| Evidence | Outcome and qualification |
| --- | --- |
| `U03-review-correction-green-3.log` / result | Exit 0: `Test Files 6 passed (6)`; `Tests 176 passed (176)`. Exact six-file command is retained in its sidecar. Qualified reuse across freeze6's single whitespace-only Edge-test chain reflow; not a fresh freeze6 full selector. |
| `U03-review-wrapper-green-2.log` / result | Exit 0: `Test Files 2 passed (2)`; `Tests 29 passed (29)`. Actual wrapper/test bytes unchanged. Later deep-memory cleanup-only caller change is covered by GREEN3, not this wrapper verdict. |
| `U03-controller-extra-correction-tests-1.log` / result | Exit 0: `Tests 6 passed | 25 skipped (31)` in 2 files. Named Storage/shadow seams only; post-run actual-config qualification retained. |
| Scoped compiler correction | Exit 0 recorded; raw line `U03 tracked source-health compilation: 0 diagnostics; 0 input/I/O violations.` Result has 1,959 roots. Qualified formatting-only reuse; scoped application/worker/script/test equivalent, not literal repository-wide typecheck. |
| Native Edge2 | Recorded exitCode 0, unchanged true; raw log checks both actual `indexing-v3-agent/index.ts` and `site-content-sync/index.ts`, under Deno 2.9.4 with the frozen composite lock/import map. Source closure matches corrected runtime files. No native document extraction occurred. |
| Migration-role3 | Exit 0: `Scoped staged migration-role: PASS; 522 guarded inputs; immutable history included.` Indexed static equivalent, not literal CLI or PostgreSQL role proof. |
| Format | First final check failed only the Edge test; exact one-chain whitespace-only diff inspected, final same-file check passed. Preserve both results; do not relabel the initial failure. |
| Module-index2 | **Exit 1 / FAILED.** Independently compared baseline rootGaps/tables with current gaps/tables: exact equality. No new U03 gap; zero stale tables. |
| Unchanged evidence | Reuse first-round unaffected focused proof; scripts inventory remains 272 files / 262 npm scripts. P04 is reused historical fixture evidence with controller-verified unchanged 21-file closure: 3 documents, 1 targeted reprocess, 0 shadow, 0 blocked. No live population or new P04 audit inferred. |

The new Node `@ts-ignore` on Edge behavior's runtime import is explicitly disclosed. The actual imported runtime symbols and types exist in the shared source and its queue API. No new declaration stub, remap, wrapper suppression or root omission was introduced. The annotation is in the native source too, so neither compiler verdict is treated as unqualified import-line diagnostic proof; actual export/source inspection accompanies the mandatory two-root native evidence. This does not establish native worker execution.

Module-index's retained root gap is `./.superpowers`; missing tables are `site_content_public_authority`, `site_content_publications`, `site_content_release_gate_artifacts`, `site_content_release_operations`, `site_content_release_projections`, `site_content_releases`, `site_content_sync_outbox`, `site_content_synchronizer_state`, and `site_content_validation_binding_consumptions`. Accept the addendum's bounded attribution: it ran the unchanged checker on approved complete inputs and retained failure; unrelated documentation repair is outside U03. This is not green, whole-schema coverage, or an inherited U02 exception.

## Residuals and stop state

Highest residual risk is installed SQL behavior: migration-chain/selected-snapshot replay, DML triggers, effective owners/privileges, cross-queue and policy-event schedules, rollback/count enforcement, and actual concurrent G0/G1 handoff remain unrun. Real Storage may still write late bytes to isolated immutable paths; orphan lifecycle/cleanup stays with later units. Native extraction, actual provider retries/cancellation, source clearance, serving lifecycle and clinical usefulness remain independently gated. Rejected structured rows need governed repair; this correction refuses them rather than repairing them.

Historical U02 evaluation remains **exit 1, four failed suites, 45 failed and 586 passed overall**; no U03 green exception is inherited. Kernel default-off, P08A superseded, C01 incomplete, and C07 production-readiness/connected acceptance unchanged. Preserve the original base, failed candidate, failed reviews and every failed gate attempt.

No test, arbiter, compiler, SQL, provider, worker/server, native extraction, operator, real document, repair, reindex, deployment or publication ran in this review. No repository file was written, staged or committed; no agents were spawned. Only this new outside report was written. Final controller acceptance and the other specialist verdicts are separate from this ingestion PASS.