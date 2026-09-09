# U04 local scope decision

Proposal only; no permit or repository source change applied. Current source HEAD: `3822cc1271b04dc85ec9d7c4afcf7afa26b06db2`. Independent bounded scope review is pending in `U04-evaluation-scope-review-1.md` and must be read with this proposal before a decision is represented as review-supported.

## Requested decision

Permit a narrowly scoped **internal candidate-evaluation adapter** in the shared RAG owners used by U04, while preserving ordinary Answer behavior, ranking, clinical/source policy and default configuration. This extends the local source-owner allowlist; it does not authorize connected evaluation, providers, documents, SQL execution, activation or publication.

Recommendation: admit this extension after the bounded independent review supports it, then finalize the detailed interface and whole-unit amendment review before dispatch. The alternative is to retain the existing RAG exclusion and explicitly make complete U04 acceptance depend on a separately owned RAG adapter. A direct chunk-query diagnostic alone cannot close U04 and cannot stand in for the required complete baseline before staging.

## Why the existing permit is insufficient

The governing `2026-09-07-execution-authority.md` says: **"ordinary Answer and the separate RAG programme are not implementation owners in this continuation."** The original Task 4 owns staging and two evaluation SQL wrappers, but it also requires full retrieval and answer-quality comparisons.

Current source establishes that the existing search/answer entry points create their own clients and use live aliases, corpus statistics, quality/summary metadata, related evidence, adjacent context and caches. Passing a candidate client to the evaluation script does not pass it into those operations. An evaluation GUC in one RPC cannot govern subsequent independent RPCs. Consequently two correct chunk wrappers can still produce a mixed G0/C evaluation or a fallback that hides unavailable candidate evidence.

These are verified design/ownership gaps at the U04 integration boundary, not a claim that the earlier separate-worktree RAG assessment proved a new ingestion defect. Full source references and hashes are in `U04-evaluation-owner-closure-1.md` (SHA-256 `2a06470da8089a519f3f77ce4bb0dc13892636dc02e9bb12f24520a2a1103070`).

## Concrete additional owner scope

| Owners | Bounded change |
| --- | --- |
| `src/lib/rag/rag-contracts.ts`, `src/lib/rag/rag.ts` | Evaluation-only immutable context and typed dependencies; propagate the same context through classification, recursive search, answering, related evidence and context packing. Ordinary entry points retain production dependencies. |
| `src/lib/rag/rag-candidate-sources.ts`, `src/lib/rag/rag-hydration.ts` | Closed candidate read operations covering the actual retrieval paths, candidate projection/image hydration, and generation filtering before limits. Missing evaluation operations refuse rather than falling back to production RPCs. |
| `src/lib/rag/rag-retrieval-variants.ts`, `src/lib/corpus-grounding.ts`, `src/lib/rag/rag-cache.ts` | Session-scoped aliases, corpus statistics and adjacent evidence; isolate/bypass relevant evaluation caches without changing production cache policy. |
| Candidate read adapters at those callers; conditionally the named read functions in `src/lib/deep-memory.ts` and `src/lib/document-enrichment.ts` | Exact C/D memory and related/visual evidence. Prefer caller injection when it avoids extra edits. No general mutation/producer refactor. |
| Focused tests for the above owners | Ordinary-default parity, full evaluation-context propagation, failure visibility, mixed-generation exclusion before limits and baseline/candidate cache isolation. Exact test paths belong in the final reviewed brief. |

The already planned U04 scripts, gate, migration/schema/types and focused tests remain responsible for stage/session/report contracts and fixed candidate SQL operations. Effective inline SQL projection/ranking inputs must be covered, not merely similarly named helpers. The complete fixed operation list and signatures still require the whole-unit review; this scope decision is not permission to add arbitrary table/query forwarding.

No production HTTP route or public request flag may select the candidate context. No global monkeypatching of the admin client. No ranking redesign, new clinical rules, wider source eligibility, cache-policy change, OpenAI implementation change, document summarization feature or transfer from the separate RAG worktree. The retrieval kernel remains default-off; P08A remains superseded.

## Evaluation rules to retain

Use the same exact wave and case population for baseline and candidate, preserving per-document G0/null and candidate C. Do not add an implicit background corpus; any later background overlay needs its own explicit inventory and authority. Preserve permitted manual metadata and freeze its identity; replace only the candidate's corresponding generated sets. Bind source/policy, projection/alias identities, provider mode and comparison clock.

Record any missing candidate capability, reader error, stale authority or mixed generation even if the engine returns a fallback answer. Required unavailable metrics produce NO_GO before numeric gates. Never fill absent metrics with zeros, substitute stored extraction quality for delivered answer quality, or reuse mocked scores as operational evidence. In-memory fakes prove adapters and failure behavior only; connected and clinical proof remain separate.

## Work still needed even if this scope is approved

Approval would resolve the RAG source-owner boundary; it would not declare U04 ready or accepted. Before product dispatch:

1. Resolve the P04 origin-preimage adapter and transaction/phantom contract. The existing audit digest is opaque and must remain unchanged; do not invent its meaning.
2. Finalize the exact storage/claim/control/projection/inventory/digest and read-interface contracts, source/test allowlist and realistic acceptance matrix.
3. Correct the outside runner's two remaining Important lifecycle findings and independently review its concrete manifests/proof. Neither runner candidate has executed. Schema-test migration enumeration requires its own scoped correction.
4. Complete independent xhigh review of the whole frozen amendment and observe the actual agent route before dispatching one fresh Astra/high implementer.

U03 remains locally accepted at product `bbd978a5708ed70c51e293aab079ead9c5bcb1ce`; its acceptance, failures and qualifications are preserved. C01 unit evidence is consolidated; tranche review remains after C02. U04 is unstarted. The historical U02 offline exception remains exit 1, four failed suites, 45 failed and 586 passed overall, never automatically inherited.
