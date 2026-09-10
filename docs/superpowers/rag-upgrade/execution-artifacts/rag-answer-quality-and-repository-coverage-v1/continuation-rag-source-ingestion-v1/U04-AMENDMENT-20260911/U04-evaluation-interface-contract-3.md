# U04 complete-engine evaluation interface — controller draft 3

10 September 2026. Source HEAD `378c9c3997f91921d89aa6d919b5c9ef05b2152a`; no executable changes since the owner investigation at `3822cc1271b04dc85ec9d7c4afcf7afa26b06db2`. This document applies the approved internal adapter extension. It is a concrete amendment input, not a passing amendment review, product implementation, connected-operation permit, or metric result.

## Decisions retained

The comparison corpus is the exact authorised wave, for both baseline and candidate. No implicit background corpus is added. Provider mode, fixture membership, scoring rules, retrieval limits, ranking formulas, clinical/source rules and answer-generation policy are identical between sides. A deliberately small comparison corpus limits the interpretation of results; it does not establish repository-wide or production quality.

The ordinary public search/Answer functions retain their current defaults. Separately exported internal evaluation entry points require a complete immutable evaluation dependency set. A present but incomplete evaluation context is an error, never a request to use production dependencies. No public flag, arbitrary RPC name, generic query-builder proxy, global admin-client replacement, or process-wide environment switch selects candidate evidence.

The original two chunk wrappers remain named operations, but they are not the complete adapter. The actual engine must retain every invoked retrieval, hydration, context, generation and verification path. A direct-wrapper diagnostic cannot supply full-engine acceptance metrics.

## Session contract

The session is constructed by `scripts/lib/reindex-eval-session.ts` only after closed-schema validation of operation authority and all bound artifacts. Its immutable identity includes:

- version, target project, operation ID and expiry;
- plan, prepared-origin, recovery, case-set and exact population digests;
- comparison side, baseline identity per document (including explicitly supported legacy null), candidate C, candidate member/aggregate receipt when applicable;
- source policy, owner/public scope, manual/source metadata snapshot, projection, inventory and alias identities;
- provider mode, engine/config identity and fixed comparison clock;
- a complete capability set and an opaque session identifier used only for this evaluation's caches.

Baseline and candidate receive distinct session identifiers. An engine invocation cannot mutate its session, expand population, switch side or borrow the other side's cache. Per-query subsets must be declared in the bound cases and validated as subsets before a read; an empty filter must not mean global scope. The evaluator never turns G0 into C in an ingestion Fence.

Every read returns a typed result with a binding to this session, the operation, exact document set, snapshot/generation and provenance. Explicit successful empty results are distinct from absent capability, malformed output, authority loss, missing evidence and read failure. Validation happens before the result enters the tolerant ordinary engine helpers. A monotonic failure collector outside those helpers records the latter conditions. The driver checks it after retrieval and after complete answer/verification, including caught fallback paths. Once failed, that invocation cannot become complete again.

**Snapshot rule:** a sequence of independent database RPCs does not share one database transaction. Adopt origin/transaction contract 3 section 6A for the proposed implementation: each fixed read must atomically establish exact origin/control/projection equality and derive its evidence in the same statement snapshot, including empty results. Every successful read therefore consumes the same bound logical inputs. A separate before/after check is insufficient. An observed mismatch permanently fails that evaluation. This does not claim that no transient change occurred between reads. Full immutable bundles remain recovery/evidence records; a dependency that cannot meet atomic equality needs an explicitly reviewed immutable-bundle implementation or remains unavailable. Do not hold database locks while calling providers.

The evaluation clock is fixed across both sides, including the actual hybrid 90-day recency boundary. Bind text-search configuration, relevant extension versions and retrieval-affecting settings such as `pg_trgm.similarity_threshold` and the existing vector `hnsw.ef_search=100` policy. A STABLE outer label cannot conceal a volatile nested factual read or side effect. Fixed evaluation-only function configuration may preserve planner settings without changing production RPCs; the effective call chain still requires independent review and later SQL proof.

## Closed operation ownership

Names below are proposed internal TypeScript operations, not permission to pass arbitrary function/table names. Each operation has fixed argument/result types and fixed SQL or immutable-snapshot implementation. Reuse existing row validators and result shapes where their semantics match; do not weaken them.

| Internal operation | Actual owner and existing execution | Required evaluation behavior |
| --- | --- | --- |
| `readAliases` | `rag-retrieval-variants.ts:fetchEnabledRagAliases` | Exact side's generated aliases plus the same frozen permitted manual aliases; no G0 producer aliases in C; no scope-global alias cache or error-to-valid-empty conversion. |
| `readCorpusTermStats` | `corpus-grounding.ts:classifyCorpusGrounding`; `corpus_topic_term_stats_v2` | Same bounded corpus and frozen metadata; isolated term/inflight caches; missing version is unavailable, not ordinary legacy fallback. |
| `correctClinicalTerms` | `rag.ts:1691`; `rag-candidate-sources.ts:281`; `correct_clinical_query_terms` | Preserve the same tokenization/trigram/order/limit policy and public/enabled eligibility. Derive each side's vocabulary from its exact selected titles and permitted alias overlay, binding its actual dictionary identity. Do not call the unbounded global `document_title_words`/alias corpus. Preserve duplicate word/document rows where they affect branch limits. Candidate-owned aliases may differ from G0; manual/shared inputs stay frozen. No new external source or clinical correction policy. |
| `readTextChunks` | `rag-candidate-sources.ts:searchTextChunkCandidates`; text_v2 -> effective `match_document_chunks_text_scoped` | Exact generation/population before rank/limit; side-specific inline labels, summary and document metadata; preserve formula and order. |
| `readHybridChunks`, `readVectorChunks` | `rag.ts:2092,2205`; hybrid_v2/vector_v2 and effective base bodies | Preserve ranking/dedup/owner-public semantics; side-specific quality/metadata/image inputs; no mixed generation or legacy-null escape in C. |
| `readLookupChunks`, `readLookupDocuments` | `rag-candidate-sources.ts:393-555`; lookup_chunks_text_v2, documents_for_query_v2 plus direct chunk/document reads | Exact population before rescue limits; snapshot-specific document status/count/search-vector/metadata; fixed ID/index lookup operations. |
| `readTableFacts`, `readEmbeddingFields`, `readIndexUnits` | same file: `searchTableFactCandidates`, `searchEmbeddingFieldCandidates`, `searchIndexUnitCandidates` | Preserve existing text/vector ranking and actual evidence/source membership; exact C or retained baseline before limit; fixed projection inputs. |
| `readMemoryCards` | `deep-memory.ts:fetchMemoryCardsForQuery`, invoked by memory-boost helpers | Exact snapshot and sealed subordinate D identity where present; preserve hybrid/lexical semantics without a production-reader fallback. Prefer injection at immediate caller if it avoids editing this read owner. |
| `readChunksByIds`, `readChunksByIndexes`, `readDocumentSnapshots` | candidate sources: `loadChunksForMemoryCards`, `loadChunksForSignalMatches`, lookup helpers | All ID membership and generation checks before hydration/limit; retain complete actual source text and references, not preview text. |
| `readRankingMetadata`, `readQuality` | `rag-hydration.ts:attachDocumentRankingMetadata/attachIndexQualityMetadata`; related-metadata helpers | Read fixed side projections; missing/not-required projection is explicit. No live singleton fallback. |
| `readImagesByIds`, `readImagesByPages`, `readVisualCounts` | `rag-hydration.ts:attachPageVisualEvidence`; invoked visual read functions in `document-enrichment.ts` | Exact membership before order/limit/count/cover; preserve caption/source relationships. No signing or fetching private Storage objects for mocked acceptance. |
| `readRelatedDocuments` | `rag.ts:buildRelatedDocumentsSafe`; related-document metadata helpers | Same session and authorised population, fixed side projections; no fresh production admin client. Preserve ordinary fallback behavior outside evaluation. |
| `readAdjacentChunks` | `rag-cache.ts:packAdjacentSourceContext`; `rag.ts:packContextForGeneration` | Exact snapshot/population before limit80 and adjacency expansion; no C-to-null fallback; preserve full evidence and source identity. |
| `embedQuery`, `classifyQuery`, existing rerank/generation/verification calls | existing engine call sites reached from search/answer | Same provider mode/config and declared call policy, injected mocks for local proof. No provider implementation/model/prompt/retry tuning. Any enabled cache is session-bound and records identity; default semantic comparison bypasses persistent caches. |

An unlisted read reached by a bound evaluation case is a capability-closure failure. The implementation brief must bind each operation to its effective SQL body or retained-snapshot query before dispatch; this table does not make an uninspected SQL implementation safe. Do not edit unused `summarizeDocument`/`rag-document-summary-context.ts` merely because it also uses an admin client.

## Local acceptance cases owned by U04

1. Invoke actual search/answer orchestration with exact dependency fakes. Exercise aliases, corpus classification, text/hybrid/vector, title/lookup rescue, tables/fields/units, memory, visual/quality hydration, related and adjacent context through positive paths. Assert the same session reaches every invoked dependency and output retains full fixture text/provenance.
2. Use two documents with different G0s, one explicit legacy-null baseline case, and one C shared by the wave. Interleave both evaluation sessions; prove no cache, generation or metadata bleed. Include manual/generated label and alias conflicts with the frozen overlay rule.
3. Inject unavailable/error/wrong-binding output into each material operation; even if the existing engine returns a plausible fallback answer, the outside failure collector must make metrics incomplete/NO_GO. A valid empty result must remain distinguishable and must not itself fabricate a failure.
4. Place more wrong-generation rows than each relevant limit before the eligible rows. Confirm database/read-adapter selection occurs before limits, counts, cover choice and ordering. Application-side filtering of a truncated wrong-generation result cannot pass.
5. Keep original ordinary-entry-point fixtures with no evaluation context. Assert unchanged dependency selection, default cache behavior and outputs; candidate entry points cannot be reached through public inputs. No ranking/prompt/model change is allowed to make evaluation pass.
6. Exercise complete required metric/case binding through actual injected case runners. Missing metrics, changed case order/content, different corpus/mode, incomplete projections or any failure-collector entry must fail closed. Direct-wrapper retrieval and stored extraction-quality rows cannot populate full answer-quality acceptance fields.
7. Model an intermediate live G0 mutation during a multi-read answer. The baseline remains on its retained immutable snapshot or refuses before accepting evidence. Before/after equality alone is insufficient. A later source revocation still invalidates operational acceptance even when historical evidence remains readable by its service-only owner.
8. Cover the exact-wave correction vocabulary, duplicate words across selected documents, public/private eligibility and an unrelated global alias/title that must not enter the comparison. A recency case straddling 90 days must use the same bound clock on both sides. Bind relevant similarity/settings inputs instead of relying on changing connection defaults.

These tests establish local contract behavior only. They cannot establish SQL execution/ranking, hosted provenance/privacy, provider semantic support, native extraction fidelity, real latency or clinical usefulness. Those remain separately authorised connected/native acceptance with realistic complete-document/case fixtures and independent review.

## Boundaries and outstanding integration

F06/F08/F09 require full staged inventory and evidence-loss accounting, not a new extraction capability; U09 owns extraction-fidelity improvement and native fixtures. U10 owns technical eligibility. U05 owns atomic promotion/rollback/retention; no activation or cleanup is introduced here. Approved supplementary-source use remains governed by the exact authorised population/source policy; neither empty evidence nor fallback authorises arbitrary web access.

Before implementation: integrate the resolved origin/transaction contract, exact SQL/read-body bindings, fixed per-family schemas, owned path/test allowlist and independently admitted verification recipe into one whole-unit amendment. Then obtain independent xhigh amendment review and dispatch one fresh implementer. This document is not that acceptance.

Historical U02 offline evaluation remains exit 1, four failed suites, 45 failed and 586 passed overall. It is not green; U04 requires its own complete gate results and inherits no exception. P08A remains superseded and the retrieval kernel default-off.
