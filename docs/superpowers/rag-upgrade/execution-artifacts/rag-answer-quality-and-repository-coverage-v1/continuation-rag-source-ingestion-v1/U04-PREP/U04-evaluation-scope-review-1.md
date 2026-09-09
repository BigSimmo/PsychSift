# U04 evaluation scope review 1

**Scope verdict: the original full U04 evaluation requirement has no complete existing narrow seam at the reviewed HEAD. Completing it requires an explicit extension into shared RAG/Answer implementation owners, or a separately accepted RAG dependency that provides that seam. The current Task 4 owner list is not sufficient for full dispatch or acceptance.**

No implementation or operational authority is granted by this review. This is an independent bounded preparation review, not U04 product acceptance, a programme audit, or a reopening of U03.

## Material finding and authority boundary

**Important scope gap U04-ES-01:** Task 4 promises exact baseline and candidate retrieval **and quality** evaluation, while its existing files own two chunk RPC wrappers and CLI/gate changes but not the shared engine's complete read path. The supplied authority explicitly excludes that missing implementation ownership:

> ordinary Answer and the separate RAG programme are not implementation owners in this continuation.

That sentence is at line 23 of the canonical `2026-09-07-execution-authority.md`. Its permission to continue U03–U13 at line 13 does not silently remove this explicit exclusion. An evaluation-only internal seam can preserve ordinary behavior, but editing its shared owners is still a material owner extension requiring a concrete user scope decision. This is a source/ownership dependency, not a request for permission to start the next already-authorised ordinary unit.

The minimum change requested for that decision is dependency/context plumbing for the current engine, not ranking tuning, a new Answer policy, general RAG modernization or activation. A permanently refusing evaluator or direct-wrapper diagnostic may be a partial local deliverable; it cannot be called complete Task 4 implementation under unchanged acceptance.

## Independent source basis

I read the frozen owner-closure contribution once and independently inspected the relevant current engine contract, callsites, hydration, alias and adjacent-context paths. The decisive evidence is:

1. **The CLI client is not the engine client.** `scripts/eval-quality.ts:1132-1161` accepts a Supabase client for captured-case loading, imports `answerQuestionWithScope`, then calls it with query, owner, `logQuery:false` and `skipCache:true`. It passes no exact candidate population/generation or reader. The retrieval runner similarly calls `searchChunksWithTelemetry` without such a reader (`scripts/eval-quality.ts:1082-1112`; `scripts/eval-retrieval.ts:978-982`). Modifying the CLI's own client cannot redirect those engine operations.
2. **Existing arguments provide identity and filtering, not a candidate data plane.** `SearchChunksArgs` (`src/lib/rag/rag-contracts.ts:16-45`) includes document/owner scope and a context/cache snapshot but no client or closed reader dependency. `AnswerQuestionWithScopeArgs:82-87` extends that same contract. A snapshot or indexing-version promise cannot select private candidate projections by itself.
3. **The engine constructs independent clients and performs auxiliary reads.** `src/lib/rag/rag.ts:1551-1604` resolves cache authority, creates an admin client at line 1560, then starts classification/grounding and alias loading. Related-document hydration creates another client at line 2291. Answer context packing creates one at line 3248. A transaction-local setting inside a chunk RPC cannot govern these separate subsequent client requests.
4. **Quality/metadata are consumed outside the chunk wrappers.** `rag-hydration.ts:145-168` directly reads live `document_index_quality` by document ID and tolerates failures. Metadata hydration attaches labels/summary at lines 118-133. Those values affect the delivered evidence/context and may differ between G0 and C even if candidate chunk rows are selected correctly.
5. **skipCache is insufficient isolation.** `rag-retrieval-variants.ts:134-189` keys aliases only by access scope, reads enabled live `rag_aliases`, and may return an empty set after a read error. Baseline and candidate must not inherit each other's producer aliases or silently interpret unavailable projection data as valid absence. The contribution additionally identifies grounding and classifier caches that are not controlled by the outer skipCache flag.
6. **Answer evidence packing can cross the generation boundary.** `rag-cache.ts:1098-1108` derives a generation from result metadata and filters returned neighbor rows afterward, while allowing rows without generation IDs. This is not a complete exact-C reader. Candidate filtering must precede relevant order/limit operations, and null-generation baseline semantics must not become a candidate escape.
7. **Required metrics are actual delivered-answer metrics.** `reindex-eval-gate.ts:16-44,120-142` requires passage MRR/content counts and grounded-supported, unsupported-correct, citation/numeric/governance warning/failure and latency metrics. `eval-quality.ts:1154-1170` derives quality from the delivered answer and its source policy. Extraction-quality table rows or direct SQL passage scores cannot stand in for those outcomes.

The frozen contribution's SQL/function inventory supplies additional design evidence about live inline metadata/quality reads and the remaining waterfall operations. I did not independently re-audit all of its SQL bodies in this bounded scope review. The independent evidence above already disproves the claim that the two wrappers and current arguments fully contain evaluation.

## Smallest coherent extension to propose

Recommend a **local-only full-engine evaluation seam amendment** if the user wants unchanged complete Task 4 acceptance within this continuation. Its coherent scope is an immutable internal evaluation context plus a closed typed dependency set, selected by evaluation-only entry points. Ordinary entry points keep their existing dependencies and behavior.

The amendment should name this owner envelope explicitly and then narrow symbols in its frozen implementation brief:

| Additional shared owner | Permitted purpose |
| --- | --- |
| `src/lib/rag/rag-contracts.ts` | Internal evaluation context/dependency contracts; not a public request or route option. |
| `src/lib/rag/rag.ts` | Propagate the same evaluation context through classification, complete search, recursion, answering, related reads and context packing before any client/cache/provider selection. Preserve generation, ranking, grounding and verification policies. |
| `src/lib/rag/rag-candidate-sources.ts` | Closed operation dispatch and exact population/generation selection across the existing waterfall; no fallback to live/legacy operations in evaluation mode. |
| `src/lib/rag/rag-hydration.ts` | Sealed projection/quality/image readers with exact membership and failures recorded for acceptance. |
| `src/lib/rag/rag-retrieval-variants.ts` | Session-bound alias reads and cache isolation/bypass. |
| `src/lib/corpus-grounding.ts` | Exact comparison-corpus grounding and isolated cache/dependency behavior. |
| `src/lib/rag/rag-cache.ts` | Evaluation cache isolation and exact adjacent-context reader/packing dependencies; no shared production-cache invalidation redesign. |
| `src/lib/deep-memory.ts`, `src/lib/document-enrichment.ts` — conditional read-only symbols | Adapt their invoked memory/related/visual read operations only if they are not instead replaced through fixed typed dependencies at the immediate engine/hydration callers. Producers, mutations and unrelated exports remain excluded. |

This is seven core shared owners plus up to two existing read-helper owners, not a licence to edit entire directories. A chosen design may avoid some helper-file edits by replacing fixed read operations at their caller; the **operation closure** must remain complete. Minimizing filenames by adding a generic Supabase query emulator, global client monkeypatch or a forked copy of the engine would not be a smaller maintainable seam.

Already-owned `scripts/eval-retrieval.ts`, `scripts/eval-quality.ts`, `scripts/lib/reindex-eval-session.ts`, the driver/gate, U04 migration/schema/types and focused tests must connect this seam. The SQL API must cover the actual invoked operation set and sealed projections, not just two chunk wrappers. Prefer fixed service-only evaluation operations reusing existing formulas, with ordinary/unset behavior preserved. The final brief must name effective SQL symbols; this review does not pre-approve unnamed broad helper rewrites.

No OpenAI implementation change, prompt/budget/model/retry tuning, ranking algorithm change, semantic adjudication, HTTP/UI route, summarization-only endpoint, retrieval-kernel activation or production cache policy belongs in the proposed extension. In particular, the separate `summarizeDocument` route is not automatically an owner merely because one of its helpers creates a client.

The internal context must bind baseline's per-document G0/null identities versus candidate C, exact case and population fingerprints, source authority, sealed projections/subordinate artifacts, aliases, provider/engine mode and comparison clock. A closed completeness channel must survive tolerant engine catches, so missing capability, wrong-generation rows, projection read failures or authority drift cannot yield an acceptable polished fallback. This preserves ordinary fallback behavior while refusing incomplete evaluation evidence.

## Concrete user decision and separate-dependency alternative

The concrete approval proposition is:

**Extend local U04 ownership to the named shared RAG files solely to implement the internal exact-generation evaluation context/read dependency seam, preserving ordinary behavior and all existing retrieval/quality requirements. Connected execution and all existing operational boundaries remain separate.**

The controller should present that proposition and its alternative, not ask for unrestricted RAG/Answer work.

If the user keeps the current shared-RAG exclusion, record the full evaluator as a **separate RAG dependency**. U04 may retain authorised design or explicitly partial local staging/driver work, but original full U04 acceptance remains pending until that dependency is implemented, reviewed and integrated under its own authority. An injected successful fake evaluator proves orchestration only. A permanently unavailable production capability must remain visibly incomplete.

Neither choice permits:

- replacing complete retrieval/quality acceptance with text/hybrid diagnostics or an automatically reduced case set;
- treating unavailable required metrics as zeros, approved absence or GO;
- starting connected staging before required complete baseline evidence exists;
- treating candidate metric GO as promotion/activation authority;
- selecting an unfrozen background corpus or manual/global alias population implicitly.

Corpus comparison scope must be frozen explicitly: exact wave population or a separately governed frozen background plus C overlay. Cases, baseline and candidate must use the same complete engine/context mode and applicable population. Unsupported cases/capabilities lead to unavailable/NO_GO, not silent exclusion.

## Disposition of the concrete user-decision proposal

I also reviewed the frozen `U04-scope-decision-proposal-1.md`. **PASS as a bounded scope-decision proposal**, not implementation admission or product acceptance. It asks for the seven shared owners and conditional read-helper symbols above, preserves ordinary entry points and policies, forbids public candidate selection/global client patching, and leaves the complete interface/SQL/test closure for whole-unit amendment review. Its exact-wave comparison rule avoids silently adding a background corpus. Its alternative correctly leaves complete U04 dependent on separately owned RAG work instead of accepting partial diagnostics.

I found no materially smaller existing route that supplies the unchanged complete retrieval and delivered-answer quality comparison. Further mechanical narrowing is possible when the final brief chooses caller injection over read-helper edits; that is not an existing seam or a reason to hide the required shared-engine owner extension. The proposal is therefore concrete enough for the controller's user scope question. Approval would settle only that owner boundary.

The proposal identifies origin/transaction work, detailed contracts and runner findings as remaining preparation. I did not inspect the runner in this bounded review and give it no verdict. Nothing in this scope PASS closes those items or permits dispatch before their required reviews.

## Separate origin and execution prerequisites

This evaluation decision does not close the origin problem. Controller decisions section 2 and state-comparison sections 1/9 correctly preserve the existing P04 bare 64-hex digest without inventing its preimage, asserting queue coverage or substituting a new U04 hash. A separately reviewed origin-verification adapter/preimage contract and snapshot transaction/isolation owner remain necessary. An injected verifier is fixture proof; a caller's `verified:true` is not production authority.

Similarly, read-only preflight followed by unconstrained later reads does not establish one stable evaluated state. The brief needs a coherent immutable/snapshot transaction design and later appropriate SQL proof, including set changes/phantoms. This review selects no isolation implementation and authorises no SQL execution. These are independent preparation prerequisites even if the RAG owner extension is approved.

## Binding, route and limits

Repository: `C:/Users/joshs/.codex/worktrees/rag-local-build-20260822/Database`. Branch: `codex/rag-local-build-20260822`. Observed HEAD: `3822cc1271b04dc85ec9d7c4afcf7afa26b06db2`. Tracked status is clean. Governing AGENTS/review-skill/protocol files are unchanged since this reviewer's prior inspected checkpoint; their read-only preparation rules continue to apply. No new ledger/test-runner invocation was needed for this outside scope review.

Recomputed input SHA-256:

| Input | SHA-256 |
| --- | --- |
| Canonical 2026-09-07-execution-authority.md | 2e37181410f4b7febdb1a5fe84a2942d37d28b5809c0b705ee8219ddc2553dc9 |
| U04-task4-at-b335cfbe5e.md | f968d03ff603dbbc35b39a7a2c9a326efe4a6d3ef3447d7bcf0bea99b16956b5 |
| U04-controller-contract-decisions-1.md | 37ecdb202c75a462a8a43b04c06a036ade7e28ff403a7a255e36bde6d15f43f8 |
| U04-state-comparison-contract-1.md | 27f4635420851f9e8ba00d76f57d57b6dad7f18296b7c2cf785a8ee690e25af2 |
| U04-evaluation-owner-closure-1.md | 2a06470da8089a519f3f77ce4bb0dc13892636dc02e9bb12f24520a2a1103070 |
| U04-scope-decision-proposal-1.md | 366dfbf8c4b8848d47fad68c03d0b3d4675a2c8cbab3ee88d034ecbc0a4c70ce |

Own reviewer session remains `01a0840c-168e-7fd0-bdac-98b09b074c88`, role `rag-retrieval-reviewer`, agent path `/root/u03_product_wrapper_review_1` reused for this new bounded question. The selected latest own `turn_context` at `2026-09-09T03:57:16.842Z` records **gpt-6-astra / xhigh**, with the same collaboration settings. It was read only from this own exact session file:

`C:/Users/joshs/.codex/sessions/2026/09/09/rollout-2026-09-09T10-42-59-01a0840c-168e-7fd0-bdac-98b09b074c88.jsonl`.

That is observed local route evidence, not backend attestation. This reviewer authored neither frozen U04 design contribution and did not modify them.

No repository edits, tests, gates, configuration loading, provider calls, SQL, workers, real documents, operator commands, publication, commits or child agents occurred. This new outside report is the sole write. The memory query found no current U04 owner/authority evidence; current source and canonical authority govern. Historical U02 remains exit 1, four failed suites, 45 failed and 586 passed overall. Source-only/static reasoning supplies no hosted, SQL-runtime, provider-quality or clinical acceptance.
