# P07 Retrieval Task 2 Review 1

SPEC_VERDICT: FAIL

QUALITY_VERDICT: FAIL

BLOCKER_STATUS: TASK 2 ACCEPTANCE BLOCKED

## Executive result

- Finding counts: P0 0, P1 0, P2 1, P3 0.
- The production integration is directionally compliant: it builds one deterministic plan after finalized analysis, derives shadow mode from the request snapshot, keeps served variants on the legacy array, bounds and abort-checks candidate planning, adds no candidate retrieval/provider call, versions the cache contract at v21 without raw subquestions, emits allow-listed content-free diagnostics, and keeps `rag.ts` at 4,358/4,362 lines.
- Acceptance is blocked because the mandatory adjacent orchestration regression does not exercise a decomposed shadow candidate at all. Its query produces a `single` plan whose candidate and served arrays are identical, while the only decomposed-query ID/order assertion elsewhere maps a local fixture to hard-coded IDs without invoking retrieval. The recorded green suite therefore does not prove that actual shadow orchestration would preserve legacy `SearchResult` IDs/order and avoid candidate fanout if the wiring regressed.

## Immutable identity and scope

- Global task key: `P07/retrieval/task-2`.
- Exact reviewed range: `f936f555a5d668b8a52b6ab735e5b14ad1acbb99..0430adf72921eae39ecfa32eede815f1018c9dd2`.
- Reviewed HEAD: `0430adf72921eae39ecfa32eede815f1018c9dd2`, matching the current worktree HEAD.
- Linear commit: `0430adf72921eae39ecfa32eede815f1018c9dd2`.
- Canonical package: `P07-retrieval-task-2-review-1.diff`; SHA-256 `5EE5D6E39F8D23A5F6B0F40EA49B8FF380360682AD2411AA056ED813A9BB17F5`.
- Brief SHA-256: `3F14E8DB1805915C9A9A5033DDD6DE2E092ABA29B7BBDBBD2C1897C6D07B1F13`.
- Implementer report SHA-256: `56374229C9688A085B9521F2EE7C54DD288C54FBD90FCB819318B0B7510F5E94`.
- Reviewed all ten changed files and the 305-addition/46-deletion canonical range against Task 2 of the retrieval-composition plan, the approved answer/Australian-sources design, the Task 2 brief, and the implementer report. This is a controller-owned governed task-artifact review, not a branch/PR/readiness review.

## Findings and remedies

### P2 - The required legacy/shadow orchestration proof never runs a divergent shadow candidate plan

Evidence: `tests/rag-variant-early-exit.test.ts:80,117,139-149`; `tests/rag-routing.test.ts:33-49`; `src/lib/rag/rag-retrieval-variants.ts:365-386`.

The adjacent test named `returns byte-identical legacy/shadow IDs and order without candidate retrieval fanout` drives `searchChunksWithTelemetry`, but it always uses `multiVariantQuery = "clozapine anc monitoring"`. A provider-free executable probe against the reviewed HEAD produced `kind: "single"`, three legacy served variants, and the same three shadow candidate variants. Therefore the test's equality of result IDs, served-variant count, and one text RPC per request does not distinguish correct legacy serving from an implementation that accidentally serves `candidateVariants`; for this input the arrays are identical. The 48-row pool's strong first result also deliberately triggers sibling early-exit, reducing the observable RPC surface to the common original variant.

The decomposed comparison query in `tests/rag-routing.test.ts` does create distinct candidate planning, but its claimed result-order proof is `fixture.map(({ id }) => id) === ["chunk-2", "chunk-1"]` over a locally constructed array. It never calls `searchChunksWithTelemetry`, never sends either variant set to an RPC, and cannot prove any orchestration behavior. The builder assertions around it prove the pure plan's `servedVariants`, diagnostics, and abort behavior only.

Trigger/failure path: a future integration edit changes `const queryVariants = retrievalVariantPlan.servedVariants` at `src/lib/rag/rag.ts:1654` to the shadow candidate array, or otherwise sends candidate-only subquestions to a text RPC. The current adjacent orchestration case still sees identical arrays and can remain green; the pure routing test also remains green because it does not execute the integration seam. Shadow can then fan out or return candidate-dependent ordering without this task's mandatory regression catching it.

Expected: the orchestration fixture must execute a genuinely decomposed plan whose legacy and candidate arrays are observably different, then prove actual legacy and shadow calls return the same `SearchResult` IDs/order and that shadow issues exactly the same served RPC queries/count as legacy. Candidate-only text must remain diagnostic-only.

Smallest proof/fix: change or add one adjacent `searchChunksWithTelemetry` case using a deterministic decomposed query such as the reviewed comparison query, first assert as a fixture guard that candidate variants differ from legacy served variants, and make RPC behavior query-sensitive or inspect every `query_text` argument. Avoid a strong-first-pool early exit for this proof (or explicitly assert only legacy query texts were issued despite the candidate difference). Require identical returned IDs/order, identical legacy/shadow served RPC arguments/count, shadow-only bounded candidate count, and absence of candidate-only strings from telemetry/cache material. Rerun only the affected orchestration selector plus the literal Task 2 selector if the correction touches shared test helpers.

## Mandatory-focus adjudication

- Finalized classifier analysis used once/no added provider call: PASS by source inspection. Planning occurs once after classifier fallback and the query-mode override (`src/lib/rag/rag.ts:1613-1622`); the provider-count regression remains at `tests/rag-classifier-memo.test.ts:79-91`.
- Request-local rollout mode: PASS. Search context selects the supplied request snapshot and uses its `rolloutVersion`; no new environment reread or route activation was added (`src/lib/rag/rag.ts:1551-1558,1614-1621`; `src/lib/rag/rag-cache.ts:579-606`).
- Legacy/shadow served variants and production result path: PASS by source inspection, but FAIL for the mandatory executable proof described above. The runtime assigns `queryVariants` from `retrievalVariantPlan.servedVariants` (`src/lib/rag/rag.ts:1654`), while the test does not exercise a divergent candidate plan.
- Shadow candidate bounds/abort/no RPC fanout/no candidate cache write: PASS by source inspection. The builder is synchronous/pure, checks abort before and after bounded computation, caps through the existing four-variant builder, and returns candidate data only to diagnostics (`src/lib/rag/rag-retrieval-variants.ts:319-386`). Runtime RPC and cache calls continue to consume the served array (`src/lib/rag/rag.ts:1654-1678`).
- Original query first, maximum four, maximum three text RPCs: PASS in the builders and focused assertions (`src/lib/rag/rag-retrieval-variants.ts:319-345`; `tests/retrieval-query-variants.test.ts:82-95`). The existing text-RPC owner retains its three-variant cap.
- Pathway questions: PASS. Duress-procedure and IM-agitation inputs remain single plans and preserve legacy variants (`tests/clinical-search.test.ts:51-60`; `tests/retrieval-query-variants.test.ts:69-80`).
- Unsupported/adversarial short circuits: PASS by source inspection. Adversarial refusal remains before context/client/classifier work; ordinary unsupported routing still precedes network-capable candidate retrieval, and the added plan computation is pure (`src/lib/rag/rag.ts:1539-1550,1613-1622,1680-1719`).
- Plan/cache v21 identity and privacy: PASS. `rag-cache-v21` is exported, the bounded plan version enters the storage-key material, and candidate subquestion strings are not persisted as fields (`src/lib/rag/rag-cache.ts:38,338-377`; `src/lib/rag/rag-contracts.ts:39`; `tests/rag-cache-invalidation.test.ts:159-226`; `tests/retrieval-query-variants.test.ts:1206-1227`).
- Diagnostics: PASS. Plan kind/count and allow-listed reason codes are bounded; candidate variant count is present only for shadow, with no raw query/subquestion fields (`src/lib/rag/rag-contracts.ts:106-109`; `src/lib/rag/rag-retrieval-variants.ts:329-386`; `tests/rag-routing.test.ts:43-51`).
- `rag.ts` ceiling: PASS at 4,358 lines against 4,362.
- Compatibility: PASS by source/type evidence. The added input and telemetry fields are optional, legacy serving remains the default, and the recorded fresh typecheck passed.

## Checks and evidence

Checks run during this review:

- Exact base/HEAD/status, one-commit chain, changed-file inventory, canonical diff, plan/spec/brief/report, review protocol, and relevant current-owner inspection.
- `npm run ledger:lookup -- 0430adf72921eae39ecfa32eede815f1018c9dd2 --scope "P07 retrieval task 2 canonical review attempt 1"`: `NOT REVIEWED at this HEAD and scope`.
- SHA-256 verification for the canonical package, brief, and implementer report: values recorded above.
- `git apply --check` for the canonical package: PASS.
- Provider-free executable variant probes under the repository's React-server condition:
  - `Compare clozapine and olanzapine monitoring requirements.` produced a decomposed plan with two legacy served variants and three distinct candidate variants.
  - The actual orchestration fixture query `clozapine anc monitoring` produced a single plan with identical three-item served and candidate arrays, confirming the P2 trigger.
- Direct source/test trace confirmed the decomposed-query ID assertion in `rag-routing.test.ts` is a local-array tautology, while the actual orchestration case uses the non-divergent single plan.

Reused, not rerun, implementer evidence:

- Literal Task 2 selector: PASS, 4 files and 247 tests.
- Focused cache/orchestration selector: PASS, 2 files and 16 tests after the recorded cache-literal correction.
- Fresh typecheck: PASS across 11,035 inputs.
- Maintainability budget: PASS; final `rag.ts` 4,358/4,362.
- Scoped ESLint/Prettier and range diff check: PASS.

No Vitest selector was rerun because the issue is that the existing passing fixture cannot distinguish the required behavior; rerunning it would reproduce the same inadequate verdict. No broad suite, build, browser, provider-backed RAG evaluation, OpenAI, Supabase/database/Storage, document/corpus, migration, reindex, hosted CI, deployment, commit, push, or PR action occurred. No ledger record was appended because the controller explicitly constrained this review's sole write to this untracked/unstaged report.

## Acceptance boundary

Task 2 must not advance until the one adjacent orchestration regression is made non-tautological and independently re-reviewed. No separate production-code defect was found in this range; the blocker is the missing executable protection at the exact served-versus-candidate integration seam.
