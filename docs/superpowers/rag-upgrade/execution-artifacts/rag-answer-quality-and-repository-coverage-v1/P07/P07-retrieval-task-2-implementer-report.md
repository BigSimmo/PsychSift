# P07 Retrieval Task 2 Implementer Report

## Identity

- Programme: `rag-answer-quality-and-repository-coverage-v1`
- Phase/task: `P07/retrieval/task-2`
- Task base: `f936f555a5d668b8a52b6ab735e5b14ad1acbb99`
- Task head: `97a13cfaa10bff4188f57137264c86e54b23291c`
- Commits:
  - `0430adf72921eae39ecfa32eede815f1018c9dd2` (`feat(rag): shadow bounded query decomposition`)
  - `0499ee71363f43d1528028f059fdc4936d61e145` (`test(rag): prove divergent shadow query isolation`)
  - `97a13cfaa10bff4188f57137264c86e54b23291c` (`fix(rag): keep ambiguous query plans open`)
- Implementer: `/root/p07_shadow_query_impl` (`gpt-5.6-sol` / `high`)
- Phase-review correction implementer: `/root/p07_query_contract_impl` (`gpt-5.6-sol` / `high`)
- Mechanical handoff after implementer usage exhaustion: `/root` (`gpt-5.6-sol` / `high`)
- Environment/authority: `offline-shadow` / `local-code-and-fixtures`

## Outcome

Integrated one deterministic `RagQueryPlan` after the finalized classifier/fallback analysis and request-local query-mode override. Legacy and shadow both serve the unchanged legacy retrieval variants; shadow additionally computes bounded candidate variants and content-free diagnostics without a provider call, retrieval fanout, or candidate cache write. Query-plan versioning now participates in the privacy-hashed retrieval-plan cache identity, and the RAG cache dependency generation is `rag-cache-v21`.

The implementation derives rollout mode from the immutable request snapshot, preserves adversarial and ordinary unsupported short circuits, and never persists original/subquestion text in diagnostics. The corrected orchestration-level fixture uses a genuinely decomposed query with divergent candidate and served variants plus query-sensitive RPC results. It proves legacy and shadow return identical result IDs/order, issue only the legacy served variant sequence, never retrieve candidate-only poison results, make no provider call, and expose only a content-free candidate count.

The final Task 2 head also adopts the full-phase review correction implemented by the original query-contract implementer, `/root/p07_query_contract_impl`: comparison plans now decompose only from an explicit comparator relation, while every clarification-required plan remains open with no closed site-domain hint. This phase correction changed only the query-plan owner and its direct tests; `src/lib/rag/rag.ts` remains under its no-growth ceiling at 4,358/4,362 lines.

## Files committed

- `src/lib/rag/rag-cache.ts`
- `src/lib/rag/rag-contracts.ts`
- `src/lib/rag/rag-retrieval-variants.ts`
- `src/lib/rag/rag.ts`
- `tests/clinical-search.test.ts`
- `tests/retrieval-query-variants.test.ts`
- `tests/rag-routing.test.ts`
- `tests/rag-classifier-memo.test.ts`
- `tests/rag-cache-invalidation.test.ts` (adjacent plan-version/cache identity proof)
- `tests/rag-variant-early-exit.test.ts` (adjacent byte-identical legacy/shadow orchestration proof)
- `src/lib/rag/rag-query-plan.ts` (full-phase review correction adopted into the final Task 2 head)
- `tests/rag-query-plan.test.ts` (direct negative and positive controls for the adopted phase correction)

No programme-telemetry owner was changed because the in-memory `SearchTelemetry` contract and orchestration fixture directly proved the required content-free fields; no persisted raw query/subquestion field was introduced.

## TDD evidence

### RED

Literal selector, run after adding tests and before production implementation:

`node scripts/run-vitest.mjs run tests/clinical-search.test.ts tests/retrieval-query-variants.test.ts tests/rag-routing.test.ts tests/rag-classifier-memo.test.ts`

Result: expected failure, 4 files and 245 tests with 240 passed and 5 failed. Three failures were the intended absent-integration contracts: two missing `buildRagRetrievalVariantPlan` assertions and one missing query-plan cache identity. Two assertions characterized existing behavior incorrectly: the historical analyzer classifies the word “procedure” as document lookup, and the first cross-domain comparison fixture did not contain two identifiable sides. Those test inputs/assertions were corrected without changing or weakening the Task 2 requirement: duress/IM-agitation pathway plans remain single and their candidate variants remain exactly legacy rather than becoming source-inventory fanout; the cross-domain case now uses two deterministically identifiable subjects. This characterization correction is not claimed as additional RED evidence.

### GREEN

Identical literal selector after implementation:

`node scripts/run-vitest.mjs run tests/clinical-search.test.ts tests/retrieval-query-variants.test.ts tests/rag-routing.test.ts tests/rag-classifier-memo.test.ts`

Result: PASS, 4 files and 247 tests.

Focused adjacent cache/orchestration selector:

`node scripts/run-vitest.mjs run tests/rag-cache-invalidation.test.ts tests/rag-variant-early-exit.test.ts`

The first run found one stale expected cache literal (`v20` without query-plan identity). After updating that expectation to the required `v21`/`queryPlan` identity, the selector passed 2 files and 16 tests. The orchestration test proves byte-identical legacy/shadow result IDs and order, one text RPC per request, shadow-only candidate count, and no raw query in telemetry.

### Review 1 correction cycle 1

Review 1 (`D766A3672CF46E1BAF334F0D3FFE2B186675FF1297C1889D485F5B05C1EC2F8A`) returned `FAIL/FAIL` with one P2 proof gap and no separate production-wiring defect. The original orchestration fixture used a single-plan query whose candidate and served arrays were identical, while its query-insensitive strong pool collapsed each request to one RPC. The tautological local result-order fixture in `tests/rag-routing.test.ts` was removed.

Direct correction RED, after declaring but before wiring the query-sensitive callback:

`node scripts/run-vitest.mjs run tests/rag-variant-early-exit.test.ts`

Result: expected failure, 1 file and 4 tests with 3 passed and 1 failed. The new divergent decomposed-query regression expected legacy IDs `clozapine-chunk-100` and `clozapine-chunk-101` but received an empty result list because the RPC mock did not yet route results by its observed `query_text`.

Identical correction GREEN after wiring the callback and provider sentinel:

`node scripts/run-vitest.mjs run tests/rag-variant-early-exit.test.ts`

Result: PASS, 1 file and 4 tests. The query-sensitive fixture proves the actual legacy and shadow result IDs/order are byte-identical; both requests issue exactly the legacy served variant sequence; candidate-only variants never reach the RPC; the candidate poison result is never served; the shadow candidate count exists without query content; and no provider path is called.

Focused companion selector after removing the tautological local assertion:

`node scripts/run-vitest.mjs run tests/rag-routing.test.ts`

Result: PASS, 1 file and 88 tests. The correction is test-only; production and type contracts did not change, so the previously passing typecheck was not rerun.

### Full-phase review correction adoption

The final scheduled Task 2 was reopened under local SDD execution to adopt the already-completed full-phase correction at `97a13cfaa10bff4188f57137264c86e54b23291c`. The correction was implemented by the original query-contract implementer, `/root/p07_query_contract_impl`, under phase review; `/root/p07_shadow_query_impl` remains the final Task 2 implementer and report owner. The source evidence is `P07-phase-fix-1-implementer-report.md`, SHA-256 `B48676025FB76809282F4D6A10995A8D869A6D976571D4C5D46D36FAC399A12B`.

Phase correction RED, with tests added before production edits:

`node scripts/run-vitest.mjs run tests/rag-query-plan.test.ts`

Result: expected failure, 4 new negative contracts failed while 14 controls passed. The failures proved that contextual second-medicine mentions were being decomposed, `Which form is required?` retained a closed `forms` hint, and `Which tool is required?` did not enter clarification. Explicit medicine-versus-medicine and anchored ordinary cases remained valid positive controls.

Identical phase correction GREEN after the query-plan correction:

`node scripts/run-vitest.mjs run tests/rag-query-plan.test.ts`

Result: PASS, 1 file and 18 tests. Comparison sides now come only from the explicit comparator relation, and every clarification-required plan returns no target site domains with `siteDomainDecision: "none"`.

## Static and handoff evidence

- `npm run arbiter -- typecheck`: `RUN` for fail-closed `db` scope.
- `npm run typecheck`: PASS; fresh gate receipt across 11,035 inputs.
- `npm run check:maintainability-budgets`: PASS at 4,362/4,362 lines; final unused-import cleanup reduced `src/lib/rag/rag.ts` to 4,358/4,362 lines.
- Scoped Prettier write/check across all ten committed files, followed by a targeted write for the final two cleanup files: PASS; all files remained formatted.
- `node scripts/run-heavy.mjs --npm-script lint:changed:internal <ten committed files> --max-warnings 0`: PASS through the repository coordinator, no diagnostics.
- `git diff --check f936f555a5d668b8a52b6ab735e5b14ad1acbb99..0430adf72921eae39ecfa32eede815f1018c9dd2`: PASS, no output.
- Correction 1 `npx prettier --write tests/rag-variant-early-exit.test.ts tests/rag-routing.test.ts`: PASS; both files unchanged.
- Correction 1 `npm run arbiter -- lint`: `RUN` for fail-closed `db` scope.
- Correction 1 `node scripts/run-heavy.mjs --npm-script lint:changed:internal tests/rag-variant-early-exit.test.ts tests/rag-routing.test.ts --max-warnings 0`: PASS through the repository coordinator, no diagnostics.
- Correction 1 `git diff --check`: PASS before commit, no output.
- Pre-phase-correction `git diff --check f936f555a5d668b8a52b6ab735e5b14ad1acbb99..0499ee71363f43d1528028f059fdc4936d61e145` and correction-only `git diff --check 0430adf72921eae39ecfa32eede815f1018c9dd2..0499ee71363f43d1528028f059fdc4936d61e145`: PASS, no output.
- Adopted phase correction `npm run arbiter -- typecheck`: `RUN`; `npm run typecheck`: PASS across 11,068 input files.
- Adopted phase correction scoped Prettier write/check for `src/lib/rag/rag-query-plan.ts` and `tests/rag-query-plan.test.ts`: PASS, unchanged after formatting.
- Adopted phase correction scoped ESLint `--quiet` for the same two files: PASS, zero errors.
- Adopted phase correction `git diff --check 0499ee71363f43d1528028f059fdc4936d61e145..97a13cfaa10bff4188f57137264c86e54b23291c`: PASS.
- Adopted full-phase `git diff --check c933f33f6f8d74299f4b19199018ec98b8166223..97a13cfaa10bff4188f57137264c86e54b23291c`: PASS.

The implementer completed production work and all focused/typecheck evidence, then hit its Codex usage limit during final handoff. The controller inspected the full diff, ran only the previously unrecorded maintainability/format/lint/diff checks, and committed the exact ten owned files. The established narrow `SKIP_DOCS_SYNC_HOOK=1` override was used because the known unrelated codebase-index inventory debt blocks normal commits; no verification, formatting, static, or other commit hook was bypassed.

## Safety boundary confirmation

No document or corpus was fetched, read, parsed, OCRed, uploaded, embedded, enqueued, reindexed, or otherwise processed. No network, provider, OpenAI, Supabase/database/Storage, hosted CI, migration, deployment, push, or PR action occurred. Work used local source, deterministic synthetic test data, and offline checks only. Briefs, this report, review artifacts, the draft receipt, `.superpowers/`, `1/`, and protected P06 artifacts remain untracked and unstaged.
