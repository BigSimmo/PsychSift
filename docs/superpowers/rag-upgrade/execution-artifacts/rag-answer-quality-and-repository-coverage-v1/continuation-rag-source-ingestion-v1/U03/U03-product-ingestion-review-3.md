# U03 product ingestion review 3: corrected-head full-range rebind

Specification: **PASS**. Quality: **PASS**. No remaining Critical or Important ingestion finding identified across the complete original U03 range `8c11f138e6c683a13db3b465332e7f3cbb515c62..bbd978a5708ed70c51e293aab079ead9c5bcb1ce`. This is the ingestion specialist's exact-head whole-integration verdict, reusing the unchanged full-range review and independently inspecting the bounded correction. It is not correction-only acceptance, controller acceptance, or SQL/runtime/provider/clinical readiness.

## Scope and independently verified binding

R is `C:/Users/joshs/.codex/worktrees/rag-local-build-20260822/Database`; O is `C:/Users/joshs/Codex-Handoffs/Ingestion/Execution/20260907-continuation`. Every repository command explicitly used R. Observed branch `codex/rag-local-build-20260822`, HEAD `bbd978a5708ed70c51e293aab079ead9c5bcb1ce`, clean tracked status. Only `git status --short --untracked-files=no` was used; protected `1/` and unrelated untracked content were not enumerated.

The full original range remains 41 files, 6,544 insertions and 2,624 deletions, comprising preserved failed candidate `b651ee23d8541fbebea77ca1c621fcdec42540ad`, candidate2 `57ba6d6fc2505f03a1ee0df82b186bccd0a455c2`, and candidate3. Git's full-range path set equals binding3's 41 paths. All 41 raw SHA-256 values match binding3 and freeze7; every current file's Git object hash equals its committed candidate3 object. Binding raw and committed SHA-256 fields agree. Freeze6-to-freeze7 and binding2-to-binding3 each change exactly the two wrapper tests; the other 39 files are identical.

Read the binding, freeze, controller verification inventory, correction route/report/result/inputs, raw test/format evidence, and the wrapper closure report. All 22 artifact hashes in controller inventory3 match; all 12 selected test inputs match current bytes. Freeze7 and test-input records correctly retain candidate2 as their pre-commit HEAD; candidate3 binding and Git object equality tie those tested bytes to the current commit without rewriting historical fields.

| Artifact | Independently recomputed SHA-256 |
| --- | --- |
| `U03-candidate-binding-3.json` | `4759824eb7d37b93eefd232df7d659116fc631fa01b66a4e17db46514306e4bb` |
| `U03-implementation-freeze-7.json` | `df84e179232a4c0408b742bbac2822c206679f9d70e364d32a82780894d930c2` |
| `U03-controller-verification-inventory-3.json` | `147e4f3b06d5008db7d5838aabea0d45b3459f57085f84cb47499ba208967061` |
| Prior own `U03-product-ingestion-review-2.md` | `4801e8106070c0b1018580ca5db35b04826bc362c04af410ec108ebaa931b9c1` |
| RAG `U03-product-wrapper-review-2.md` | `7d17dc960c7379a6e5697b31ef2a69fb866f58a125069e93e6913aa10c84cdf7` |

Canonical `R/docs/superpowers/rag-upgrade/execution-artifacts/rag-answer-quality-and-repository-coverage-v1/continuation-rag-source-ingestion-v1/U03/U03-product-review-3.diff` and outside `O/U03-product-review-3.diff` both hash to `a7713f3c523a1c55c9c8cabca3c93e58209d798f01ce95a239227ad23f19d244`. Package header and three-commit list agree with Git.

## Correction and original finding dispositions

The entire committed candidate2-to-candidate3 delta is two substitutions, independently read in Git and actual test source:

- `tests/model-index-extraction.test.ts:137` now checks `mocks.generateStructuredTextResponse.mock.calls[0]?.[2]?.signal` with `.toBe(controller.signal)`.
- `tests/openai-cache.test.ts:815` now checks `create.mock.calls[0]?.[1]?.signal` with `.toBe(controller.signal)`.

Both inspect the actual wrapper's forwarded options. A different signal object can no longer satisfy structural matching. Their mock implementations, producer calls, defaults, pre-abort/deferred/retry assertions, and all production code are unchanged. U03-WR-01 is **CLOSED**; the RAG reviewer explicitly reports Specification PASS and Quality PASS. The prior ingestion report's description of exact signal-forwarding proof must be read with this later-discovered structural-matcher weakness and its correction; the former assertions are not retrospectively promoted into identity proof. No new production RED or physical provider result is claimed.

The four unique first-round Important dispositions remain **CLOSED**, with exact triggers, source traces and proof detailed in the preserved own round2 report:

| Original finding | Retained current source conclusion |
| --- | --- |
| ING-U03-1 / U03-S2 / U03-CG-01: summary/deep persistence uncertainty | Shared `runIngestionPersistence` in `supabase/functions/_shared/ingestion-attempt.ts:23-43` makes returned errors/rejected transports fatal. The production optional boundary `worker/behavior.ts:188-202` cancels/rethrows; outer worker handling cannot write retry/failure/completion afterward. Deep cleanup is bounded to known pre-commit construction failure, cleanup failures propagate, and commit at `src/lib/deep-memory.ts:805-834` remains outside the cleanup catch. No cleanup follows an uncertain committed response. |
| ING-U03-2 / U03-S1: heartbeat/core G0-to-G1 race | Shared serialization at `supabase/functions/_shared/ingestion-attempt.ts:88-108` and fence capture/handoff inside `worker/behavior.ts:84-110` preserve ordering through response handling. Both controlled request orders and genuine stale refusal remain covered; SQL token/generation predicates are unchanged. |
| U03-CG-02: rejected structured summary falsely preserved | Migration `supabase/migrations/20260831101000_fence_ingestion_leases_and_repairs.sql:320-325` and snapshot refuse fallback over the locked structured row. `ensureSourceAnchoredSummary` at `supabase/functions/indexing-v3-agent/behavior.ts:320` validates actual result/marker agreement; the real Edge entrypoint cancels before completion. Invalid rows remain for governed repair. |
| ING-U03-3: signal lost at caption/model-index wrapper | Actual wrappers `src/lib/openai.ts:1102-1167` and `src/lib/model-index-extraction.ts:364-385` retain signal forwarding, pre/post checks, caller/default compatibility, and production caller integration. The strengthened identity assertions now supply the precise missing proof. |

## Complete integration verdict and retained evidence limits

The earlier review's applicable AGENTS/ingest/review protocol, U03 contract, shared freeze, dated execution authority and canonical continuation rules remain applicable. No unchanged programme audit was restarted. The complete earlier source assessment is retained: fenced Node/Edge persistence owners; monotonic attempt state and serialized generation handoff; strict quality/completion; both queue owners and source authority; committed-evidence retention; deep producer/membership/count/alias atomicity at source level; immutable Storage isolation without destructive ambiguous-response compensation; three actual operator entrypoint refusals; deterministic bounded repair planning and planned-only audit; selected P05 prerequisite/ACL/schema/type/document integration. None of those 39 unchanged files changed this round. No source-normalizer, ranking, Answer or activation mechanism was added.

The fresh writer command `node scripts/run-vitest.mjs run tests/openai-cache.test.ts tests/model-index-extraction.test.ts` records exit 0, **29 passed, 0 failed, 0 skipped, 2 files**. Raw output, result and 12 input hashes agree. This replaces the narrow old wrapper identity evidence, not the full-range behavioral evidence. The recorded arbiter was RUN/off, receipts off, coordinator retained. Exact two-file Prettier check records exit 0. This reviewer executed neither command.

Retain prior GREEN3 **176 passed / 6 files**, qualified by freeze6's whitespace-only Edge-test reflow; Storage/shadow **6 passed, 25 skipped / 2 files** with its actual-config qualification; and unaffected earlier focused evidence. Previous wrapper29/2 proof stays historical. Scoped compilation records 0 diagnostics/0 input-I/O violations over 1,959 roots, with original formatting qualification; no fresh compilation of these changed assertion bytes is claimed. Mandatory actual Edge two-root Deno check remains prior exit 0 evidence. Both compiler verdicts remain limited at the new Node `@ts-ignore` on the actual Edge runtime import: actual exports were independently inspected in round2, and neither compiler is represented as unqualified diagnostic proof at that annotated line. No declaration stub, remap or root omission supplies the verdict. Static migration-role proof remains 522 inputs PASS, not executed database ownership proof.

Module-index remains **exit 1 / FAILED**, with the exact previously compared `./.superpowers` root gap and nine missing `site_content_*` tables, zero stale tables and no new U03 gap. The detailed unchanged gap list and scoped attribution remain in round2 and the routing addendum. It is not green or an inherited U02 exception. Scripts inventory remains reused 272 files / 262 npm scripts. P04 remains historical fixture evidence, with controller-verified unchanged 21-file closure; it is not live population proof. Historical U02 remains **exit 1, four failed suites, 45 failed and 586 passed overall**.

Residuals remain actual SQL migration-chain/snapshot replay, trigger/privilege/lock schedules and transactional rollback/count enforcement; real Storage late bytes and orphan lifecycle; actual SDK retries/network cancellation and non-immediate backoff settlement; native extraction; providers; serving/source clearance; clinical usefulness; and C07 connected production-readiness. Mock cancellation tests do not prove physical cancellation. Kernel stays default-off, P08A superseded, C01 incomplete. Other specialist verdicts and controller acceptance remain separate.

## Own observed route and stop state

Own session is `01a08401-1c25-7690-a95d-46a32f246891`, `/root/u03_product_ingestion_review_2`, nickname Jason, role ingestion-worker-reviewer. Exact own log: `C:/Users/joshs/.codex/sessions/2026/09/09/rollout-2026-09-09T10-31-00-01a08401-1c25-7690-a95d-46a32f246891.jsonl`. Selected `session_meta` line 1 identifies this agent and parent `01a07b47-4623-7e90-825a-ec25116b8531`. Latest selected `turn_context` line 233, timestamp `2026-09-09T03:11:28.193Z`, gives **model gpt-6-astra, effort xhigh**, matching collaboration settings. Only selected identity/route fields were output. This is observed local configuration, not backend attestation or the writer's route.

Only this new outside report was written. No repository write, staging, commit, test, arbiter, compiler, SQL, provider, worker/server, operator, native extraction, real document operation, deployment/publication, untracked enumeration or delegation occurred. Controller owns ledger append and final acceptance. Preserve original base, failed candidate/reviews, all failed gate evidence and both earlier specialist reports.
