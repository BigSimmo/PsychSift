# P06 Repository Content Task 5 Receipt Review 3

Reviewer: `/root/p06_task5_review2`

SPEC_VERDICT: FAIL

QUALITY_VERDICT: FAIL

Severity counts: P0 0, P1 0, P2 2, P3 0.

## Immutable scope

- Exact full range: `0ee8c09681a49b7891f99d4c3d33f426611ffd78..d4f820cf5edad1f8a0a32031c800e1b9dd6a6e45`.
- Commits: `70a05c266f9f53764900666313b23cd4f21444b6`, `126751ea2c9272193c84a424027f243d15e83998`, `d4f820cf5edad1f8a0a32031c800e1b9dd6a6e45`.
- Package: `docs/superpowers/rag-upgrade/execution-artifacts/rag-answer-quality-and-repository-coverage-v1/P06/P06-repository-content-task-5-receipt-review-3.diff`.
- Verified package SHA-256: `1034AF86A476C82AF37FEF466079A354DF17D2CCC898050B52EA61969C464C0E`.

## Findings

### P2 - unavailable owner authority still coalesces through one synthetic sentinel

`cacheIndexingVersion` uses the process-wide `public-authority-unavailable` value when scoped authority cannot be proved (`src/lib/rag/rag-cache.ts:41-45,637-693` at `d4f820cf`). `scopedAnswerInflightKey` hashes any supplied string, including that sentinel (`:195-201`), and `answerQuestionWithScope` installs the resulting key (`src/lib/rag/rag.ts:2417-2421`).

Trigger: two same-owner/query requests overlap while the request-start indexing authority is unavailable or changes across an unobservable O1/O2 boundary. Both join the same origin.

Expected: unavailable/empty indexing authority disables coalescing. Only valid exact authority may create an in-flight identity.

Risk: the failure sentinel becomes a false global generation and permits stale coalescing.

Minimal remedy/proof: return no in-flight key for unavailable authority; prove two independent origins and clean map teardown while retaining valid-generation coalescing.

### P2 - disabled-site compatibility erases source-policy, programme-mode, and non-site identities

`contextSnapshotKey` returns null whenever `publicSiteContent.state === "disabled"` (`src/lib/rag/rag-cache.ts:114-117` at `d4f820cf`). Local/shared answer and search keys, indexing identity, and coalescing therefore retain exact legacy bytes for every disabled-site snapshot, even when source policy, typed shadow/canary mode, uploaded-local activation, or Australian-public identity changes. `tests/rag-rollout.test.ts:40-66` proves raw snapshot-key separation, not the actual helpers that discard the key.

Trigger: run with site content disabled and change any covered non-site authority. Seeded legacy local/shared cache entries remain addressable.

Expected: exact byte compatibility is limited to the immutable legacy/off baseline. Every other accepted dimension contributes an opaque context identity without adding P09 authority.

Risk: stale or cross-mode cached answers/search results survive legitimate source-policy or corpus authority changes.

Minimal remedy/proof: centralize a narrow legacy-identity predicate and table-drive actual local answer/search, shared answer/search, indexing, and in-flight helpers.

## Prior closure

The correction closes Review 1's standalone/full-health defects and Review 2's zero-ID successor, valid O1/O2 generation, and exported A/B recursion proof. The valid O1/O2 correction remains incomplete only for unavailable authority as Finding 1.

## Checks and boundary

Verified package hash, three-commit range, ancestry, and complete changed-file content. Independently traced actual local/shared/in-flight/indexing helpers and focused tests rather than relying on raw snapshot-key assertions. No test/provider/live check was run.
