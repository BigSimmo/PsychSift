# P06 Repository Content Task 5 Receipt Review 4

Reviewer: `/root/p06_task5_review2`

SPEC_VERDICT: FAIL

QUALITY_VERDICT: FAIL

Severity counts: P0 0, P1 0, P2 1, P3 0.

## Immutable scope

- Exact full range: `0ee8c09681a49b7891f99d4c3d33f426611ffd78..ac080841dda98bbf437b1fbb5824ca3f5e4a65f2`.
- Commits: `70a05c266f9f53764900666313b23cd4f21444b6`, `126751ea2c9272193c84a424027f243d15e83998`, `d4f820cf5edad1f8a0a32031c800e1b9dd6a6e45`, `ac080841dda98bbf437b1fbb5824ca3f5e4a65f2`.
- Package: `docs/superpowers/rag-upgrade/execution-artifacts/rag-answer-quality-and-repository-coverage-v1/P06/P06-repository-content-task-5-receipt-review-4.diff`.
- Verified package SHA-256: `2611EEA9C9FCA207403C4DDD809349B2934FACF913C97A99D3F169263549B5A0`.

## Finding

### P2 - a future current source-policy version collapses onto the prior legacy/off identity

The new compatibility predicate takes the running deployment's mutable current policy as an argument and considers equality to it legacy (`src/lib/rag/rag-context-snapshot.ts:183-196` at `ac080841`). `contextSnapshotKey` passes `australianSourcePolicyVersion` (`src/lib/rag/rag-cache.ts:114-118`). Therefore a future deployment whose current policy becomes v2 also omits the suffix for v2, even though the previous deployment's legacy/off bytes represented v1.

Trigger: deployment A uses current v1 and caches under legacy bytes; deployment B changes the catalogue constant to current v2 while site state, owner generation, and other authority remain constant. B again emits the same legacy key.

Expected: cache-format compatibility is pinned to the immutable accepted v1 baseline, not equality with a mutable current value. A future v2 must contribute the existing opaque fingerprint.

Risk: a real source-policy rollout can reuse answers/search results from the previous policy.

Minimal remedy/proof: remove the mutable argument, pin the baseline to `australian-source-policy-v1`, and mock a future-current v2 while asserting actual local/shared/indexing/in-flight separation.

## Prior closure

Review 3's unavailable-sentinel defect is closed by declining an in-flight key for unavailable authority. Disabled-site shadow/canary, uploaded-local, Australian-public, and explicit non-current-policy variants now separate through actual helpers. The mutable-current transition above is the remaining gap. All Review 1-2 findings remain closed.

## Checks and boundary

Verified package hash, four-commit range, ancestry, and complete source/test content. Traced the actual predicate call sites and future-deployment transition rather than relying on same-binary value variation. No test, provider, network, database, or mutation action was run.
