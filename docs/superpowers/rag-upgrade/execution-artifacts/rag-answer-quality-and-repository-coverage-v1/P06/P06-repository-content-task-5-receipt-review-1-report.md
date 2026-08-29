# P06 Repository Content Task 5 Receipt Review 1

Reviewer: `/root/p06_task5_review2`

SPEC_VERDICT: FAIL

QUALITY_VERDICT: FAIL

Severity counts: P0 0, P1 0, P2 2, P3 1.

## Immutable scope

- Global task key: `P06/repositoryContent/task-5`.
- Exact range: `0ee8c09681a49b7891f99d4c3d33f426611ffd78..70a05c266f9f53764900666313b23cd4f21444b6`.
- Commit list: `70a05c266f9f53764900666313b23cd4f21444b6`.
- Package: `docs/superpowers/rag-upgrade/execution-artifacts/rag-answer-quality-and-repository-coverage-v1/P06/P06-repository-content-task-5-receipt-review-1.diff`.
- Verified package SHA-256: `ACA02713488AD0F9540A6764A0FC038D9C90BB7D9D22272520E2C6A1A239D938`.
- Brief SHA-256: `CC6AB9BF7A4379B346E9793138F2304B7ECBBD68BCD82C077D9596251BB26F0E`.
- Consolidated implementer-report SHA-256 observed during this canonical reconstruction: `0B2F55BF1EC93943F481654312E06C54A5BD6AD770F252B5A886DB594038E53E`. Later corrections in that report were not treated as proof for this historical head.

## Findings

### P2 - standalone search can read cache and index authority before resolving a request snapshot

At this head, `searchChunksWithTelemetry` merely selects an already supplied snapshot and otherwise proceeds to `cacheIndexingVersion`, local cache, and shared cache (`src/lib/rag/rag.ts:1590-1598,1651-1668` at `70a05c26`). Production `/api/search` and universal document-search callers do not supply one. Corrected-query recursion forwards the same empty context rather than creating the missing authority.

Trigger: seed a public/shared search result under release A, change the site release/epoch while the legacy indexing stamp remains reusable, and repeat the same standalone search. The second request can retain the legacy identity and serve A.

Expected: after the intentional adversarial refusal, every answer or standalone-search request resolves exactly one immutable snapshot before any cache, coalescing, or indexing read and reuses the same object through recursion.

Risk: a real non-answer search entry point can serve stale cross-release clinical results.

Minimal remedy/proof: resolve the request cache context inside the exported search boundary and add an exported A-to-B regression that proves local and shared misses plus exact snapshot/context reuse through corrected-query recursion.

### P2 - request resolution discards the accepted Task 4 health authority

`resolveRequestRagContextSnapshot` reads the complete health input but forwards only active release, epoch/count/IDs, and the generated digest (`src/lib/rag/rag-cache.ts:522-549` at `70a05c26`). The pure resolver then performs a smaller structural check and derives current/updating itself (`src/lib/rag/rag-context-snapshot.ts:64-77,118-157`). It does not enforce Task 4's deployment, registry, integrity, governance, domain, synchronizer, pending-set, or temporal stop conditions.

Trigger: return structurally readable authority with a registry/deployment mismatch, failed governance/integrity, stopped synchronizer, or inconsistent pending evidence. The reduced fields can still produce a raw current/updating release identity.

Expected: consume the full accepted `classifySiteContentHealth` decision. Any unprovable authority becomes identity-free unavailable; only the accepted static-mismatch case remains stale.

Risk: authority Task 4 rejects can remain site-eligible and cacheable.

Minimal remedy/proof: classify the full health input once at request time and table-drive every fail-closed Task 4 condition, including malformed pending evidence and the valid updating case.

### P3 - implementer verification wording is internally ambiguous

The implementation report simultaneously records controller-run final selector/maintainability success and says those gates were not repeated, without initially distinguishing controller from implementer ownership. Clarify provenance; no product rerun is required.

## Checks and boundary

Verified package hash, embedded base/head and commit identity, ancestry, and the complete historical source/test patch. Inspected the accepted Task 4 authority owner and production answer/search call paths. No tests, typecheck, build, provider, network, database, Storage, migration, deployment, reindex, document/corpus, stage, commit, or push action was run.
