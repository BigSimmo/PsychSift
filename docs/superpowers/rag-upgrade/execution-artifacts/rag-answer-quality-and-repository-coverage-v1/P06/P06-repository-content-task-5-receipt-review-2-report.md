# P06 Repository Content Task 5 Receipt Review 2

Reviewer: `/root/p06_task5_review2`

SPEC_VERDICT: FAIL

QUALITY_VERDICT: FAIL

Severity counts: P0 0, P1 0, P2 3, P3 0.

## Immutable scope

- Exact full range: `0ee8c09681a49b7891f99d4c3d33f426611ffd78..126751ea2c9272193c84a424027f243d15e83998`.
- Commits: `70a05c266f9f53764900666313b23cd4f21444b6`, `126751ea2c9272193c84a424027f243d15e83998`.
- Package: `docs/superpowers/rag-upgrade/execution-artifacts/rag-answer-quality-and-repository-coverage-v1/P06/P06-repository-content-task-5-receipt-review-2.diff`.
- Verified package SHA-256: `5BDC17F811344FAC810CEE9A11FF32DCBCA5E4A34D4CB68D4A7AB7F9462882DD`.
- Reviewer identity: `/root/p06_task5_review2`.

## Findings

### P2 - the zero-ID direct successor is relabelled current

The correction now calls the full Task 4 classifier, but the snapshot resolver independently derives state from pending-ID length. A healthy direct successor with pending count zero is accepted as `updating` by Task 4, then becomes `current` at `src/lib/rag/rag-context-snapshot.ts:140-155` at `126751ea`.

Trigger: the direct-successor activation contract is healthy but has no exact exclusion IDs. Task 4 says updating; Task 5 emits current.

Expected: preserve the accepted state or fail only the site partition closed when the updating state cannot be represented without an exact non-empty exclusion owner. Never relabel it current.

Risk: an in-progress successor can be represented as fully current and receive an unsafe reusable cache identity.

Minimal remedy/proof: pass the accepted classification into the pure resolver, reject classifier/inferred-state conflicts, and cover the zero-ID successor directly.

### P2 - answer coalescing omits owner-scoped request-start indexing authority

The answer wrapper resolves a cache context but builds the in-flight key from `scopedAnswerCacheKey(args)` alone (`src/lib/rag/rag.ts:2401-2418` at `126751ea`). That key contains owner/access/query and public snapshot identity, but not the captured owner-scoped document generation.

Trigger: two same-owner, same-query requests overlap across O1 to O2 while public authority remains constant. The O2 request waits on and clones the O1 origin.

Expected: await the already-created request-start owner authority before map lookup and hash it into in-flight identity. Identical valid O2 requests may still coalesce.

Risk: private/owner-scoped answers can cross an indexing-generation boundary despite cache invalidation.

Minimal remedy/proof: add O1/O2 overlap and identical-O2 coalescing tests through `answerQuestionWithScope`.

### P2 - standalone A/B cache and recursion regression is absent

The production wiring defect from Review 1 is corrected, but the tests cover resolver/helper behavior and abort boundaries rather than a production-like exported standalone search with no prebuilt context.

Trigger: a later refactor reorders the standalone resolver behind either local/shared lookup or loses exact context reuse during typo recursion. Existing helper tests still pass.

Expected: an integration regression must seed release A, transition to B, observe both local and shared misses, and pin exact B snapshot/cache-context reuse through recursion.

Risk: the corrected production boundary is not protected against the realistic stale-hit regression it fixed.

Minimal remedy: add the exported-search A/B test using production-like arguments.

## Prior closure

- Review 1 standalone wiring: product correction closed, integration proof still open above.
- Review 1 Task 4 authority bypass: most malformed authority cases now fail closed, but the zero-ID successor conflict remains.
- Review 1 report wording: closed by separating controller and implementer evidence.

## Checks and boundary

Verified package hash, full-base range, ancestry, two-commit list, and all changed source/tests. Independently traced Task 4 classification, answer coalescing, standalone search, recursion, abort, telemetry, and cache identities. No tests or provider/live operations were run.
