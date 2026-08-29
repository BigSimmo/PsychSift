# P07 Retrieval Task 2 Review 2

SPEC_VERDICT: PASS

QUALITY_VERDICT: PASS

BLOCKER_STATUS: NONE - TASK 2 ACCEPTANCE UNBLOCKED

## Executive result

- Finding counts: P0 0, P1 0, P2 0, P3 0.
- Correction cycle 1 closes Review 1's only finding. The adjacent orchestration regression now executes a genuinely decomposed query with divergent legacy-served and shadow-candidate arrays, makes RPC results query-sensitive, poisons candidate-only queries, and proves actual legacy/shadow calls issue only the legacy sequence and return identical IDs/order without provider work.
- The local-array result-order tautology was removed. Full-range reassessment found no new specification, correctness, clinical-safety, privacy, compatibility, maintainability, or test-quality defect.

## Immutable identity and scope

- Global task key: `P07/retrieval/task-2`.
- Exact reviewed range: `f936f555a5d668b8a52b6ab735e5b14ad1acbb99..0499ee71363f43d1528028f059fdc4936d61e145`.
- Reviewed HEAD: `0499ee71363f43d1528028f059fdc4936d61e145`, matching the current worktree HEAD.
- Linear commits: `0430adf72921eae39ecfa32eede815f1018c9dd2` and `0499ee71363f43d1528028f059fdc4936d61e145`.
- Canonical full-range package: `P07-retrieval-task-2-review-2.diff`; SHA-256 `798B74257244D428A78F2EAF861047334F87D300796B6E47453D41B65DBE0966`.
- Updated implementer report SHA-256: `D8770B5452089693C6FF84F83256D1760E75665420A6F25FEFD445C015D61B7A`.
- Review 1 report SHA-256: `D766A3672CF46E1BAF334F0D3FFE2B186675FF1297C1889D485F5B05C1EC2F8A`.
- Reviewed all ten changed files and the 366-addition/48-deletion canonical full range against Task 2 of the retrieval-composition plan, the approved answer/Australian-sources design, the brief, the updated implementer report, and Review 1. This is a controller-owned governed task-artifact review, not a branch/PR/readiness review.

## Findings and remedies

No P0-P3 findings. No correction remedy is required before Task 2 acceptance.

## Review 1 closure

| Review 1 finding | Status | Independent adjudication |
| --- | --- | --- |
| P2: required legacy/shadow orchestration proof never ran a divergent candidate plan | CLOSED | The corrected case builds the comparison plan, requires `decomposed`, derives a non-empty candidate-only set, and requires candidate and served arrays to differ. It runs two real `searchChunksWithTelemetry` requests against a query-sensitive RPC fixture, asserts the exact duplicated legacy query sequence, excludes every candidate-only query, returns the same expected IDs/order in both modes, rejects a candidate-only poison result, and records no provider call (`tests/rag-variant-early-exit.test.ts:159-197`). The hard-coded local fixture mapping was removed from `tests/rag-routing.test.ts:33-51`. |

## Mandatory-focus adjudication

- Finalized classifier analysis used once/no added provider call: PASS. Planning remains once after finalized classifier fallback and the query-mode override (`src/lib/rag/rag.ts:1613-1622`); the correction's provider sentinel is not called (`tests/rag-variant-early-exit.test.ts:126-143,193`).
- Request-local rollout mode: PASS. Search consumes the supplied immutable request snapshot and its rollout version; no environment reread or route activation was added (`src/lib/rag/rag.ts:1551-1558,1614-1621`; `src/lib/rag/rag-cache.ts:579-606`).
- Legacy/shadow served variants and actual result identity: PASS. Runtime selects `retrievalVariantPlan.servedVariants` (`src/lib/rag/rag.ts:1654`). The corrected orchestration proof uses divergent candidate content, asserts both issued query sequences are exactly the legacy variants, and returns identical expected IDs/order (`tests/rag-variant-early-exit.test.ts:159-197`).
- Shadow candidate bounds/abort/no RPC fanout/no candidate cache write: PASS. Candidate planning remains synchronous, pure, four-bounded, and abort-checked; runtime RPC/cache consumers receive only served variants (`src/lib/rag/rag-retrieval-variants.ts:319-386`; `src/lib/rag/rag.ts:1654-1678`). Candidate-only poison results and query texts are absent in the corrected orchestration result/telemetry proof.
- Original query first, maximum four, maximum three text RPCs: PASS. Candidate construction retains the original first and caps at four, while the existing text owner retains its three-variant RPC cap (`src/lib/rag/rag-retrieval-variants.ts:319-345`; `tests/retrieval-query-variants.test.ts:82-95`).
- Pathway questions: PASS. Duress-procedure and IM-agitation inputs remain single plans and preserve legacy variants (`tests/clinical-search.test.ts:51-60`; `tests/retrieval-query-variants.test.ts:69-80`).
- Unsupported/adversarial short circuits: PASS. Adversarial refusal remains before context/client/classifier work; ordinary unsupported routing remains ahead of network-capable candidate retrieval, and planning itself is pure (`src/lib/rag/rag.ts:1539-1550,1613-1622,1680-1719`).
- Plan/cache v21 identity and privacy: PASS. `rag-cache-v21` and the bounded query-plan version isolate cache identity; candidate subquestion strings do not become persisted key or telemetry fields (`src/lib/rag/rag-cache.ts:38,338-377`; `src/lib/rag/rag-contracts.ts:39`; `tests/rag-cache-invalidation.test.ts:159-226`; `tests/retrieval-query-variants.test.ts:1206-1227`).
- Diagnostics: PASS. Plan kind/count and reason codes are allow-listed/bounded; candidate count is shadow-only; the corrected orchestration fixture excludes both the original query and every candidate-only variant from telemetry (`src/lib/rag/rag-contracts.ts:106-109`; `src/lib/rag/rag-retrieval-variants.ts:329-386`; `tests/rag-variant-early-exit.test.ts:191-195`).
- `rag.ts` ceiling: PASS at 4,358 lines against 4,362.
- Compatibility: PASS. The correction is test-only, the added runtime input/telemetry fields remain optional, legacy serving remains default, and the previously fresh typecheck passed across the unchanged production/type range.

## Checks and evidence

Checks run during this review:

- Exact base/HEAD/status, two-commit chain, changed-file inventory, canonical full-range package, plan/spec/brief/report, Review 1, and relevant current-owner inspection.
- `npm run ledger:lookup -- 0499ee71363f43d1528028f059fdc4936d61e145 --scope "P07 retrieval task 2 canonical review attempt 2"`: `NOT REVIEWED at this HEAD and scope`.
- SHA-256 verification for the canonical package, updated implementer report, and Review 1 report: values recorded above.
- Canonical package reverse-apply check against the exact reviewed HEAD: PASS.
- Correction-only diff inspection: only `tests/rag-routing.test.ts` and `tests/rag-variant-early-exit.test.ts` changed; the tautology was removed and the new orchestration fixture directly closes its trigger without changing product behavior.

Reused, not rerun, correction evidence:

- Direct correction RED: 1 file, 1 expected failure and 3 passes before query-sensitive RPC wiring.
- Identical correction GREEN: 1 file, 4 passes.
- Focused companion selector after tautology removal: 1 file, 88 passes.
- Correction scoped Prettier, ESLint, full-range/correction-range diff checks: PASS.
- Original Task 2 selector: 4 files, 247 passes; adjacent cache/orchestration selector: 2 files, 16 passes.
- Fresh pre-correction typecheck: PASS across 11,035 inputs; production/type files were unchanged by the correction.
- Maintainability budget: PASS; final `rag.ts` 4,358/4,362.

No focused suite was rerun because the recorded correction RED/GREEN directly covers Review 1's sole trigger and full source inspection found no new concern requiring a distinct check. No broad suite, build, browser, provider-backed RAG evaluation, OpenAI, Supabase/database/Storage, document/corpus, migration, reindex, hosted CI, deployment, commit, push, or PR action occurred. No ledger record was appended because the controller explicitly constrained this review's sole write to this untracked/unstaged report.

## Residual boundary

Task 2 acceptance is unblocked. The highest residual risk belongs to later Tasks 3-5, where candidate variants become inputs to corpus-scoped retrieval and coverage merging; those future tasks must preserve the bounded query budget, request snapshot, fail-closed source scope, and cache/privacy contracts accepted here.
