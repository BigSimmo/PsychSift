# P07 Retrieval Task 1 Implementer Report

## Identity

- Programme: `rag-answer-quality-and-repository-coverage-v1`
- Phase/task: `P07/retrieval/task-1`
- Task base: `c933f33f6f8d74299f4b19199018ec98b8166223`
- Task head: `f936f555a5d668b8a52b6ab735e5b14ad1acbb99`
- Commits:
  - `e8dc922f7fe5cabf2f3c0a4a703acde99e9dc8ed` (`feat(rag): define bounded query and coverage plans`)
  - `f936f555a5d668b8a52b6ab735e5b14ad1acbb99` (`fix(rag): enforce direct coverage contracts`)
- Implementer: `/root/p07_query_contract_impl`
- Model/effort: `gpt-5.6-sol` / `high`
- Environment/authority: `offline-shadow` / `local-code-and-fixtures`

## Outcome

Implemented total, provider-free query-plan, clinical-ambiguity, evidence-coverage, and sanitized fallback-reason contracts. Query planning is deterministic and bounded to four subquestions, comparisons add two sides only when both can be identified, material retrieval ambiguity yields one clarification, and original/subquestion text remains request-local. Coverage uses the existing evidence coverage gate plus explicit selected/eligible/cited chunk membership; it fails closed for absent or unknown corpus scope and rejects registry records mislabelled as uploaded documents. Typed fallback fields take precedence over compatibility-only legacy parsing, and public messages are fixed strings that cannot expose raw errors or infrastructure details.

Review 1 (`P07-retrieval-task-1-review-1-report.md`, SHA-256 `15F2A795A3A33DBF7E82534A6FCA5D899CF5DEC53D185FAB4DC9EC1E4DEE9526`) returned FAIL/FAIL with one P1 and two P2 findings. Correction cycle 1 now makes eligibility and non-gated support decisions explicit required inputs, fails closed when either is absent, and prevents any canonical evidence-gate rejection from becoming direct or complete coverage. Comparison fallback parsing now accepts only bounded identifiable entities, so benefits/risks of one medicine remain a single question while inpatient/community still decomposes. Material ambiguity now covers a required document/form with missing clinical workflow and jurisdiction anchors, while the anchored equivalent proceeds with a stated interpretation.

`SearchResult.corpus_scope` and `SearchResult.site_content_domain` made the existing exhaustive client-boundary map fail closed during typecheck. With controller approval, the smallest correctness-required adjacent update marked both fields server-only in `src/lib/answer-client-payload.ts`; the existing boundary test now proves neither crosses JSON/SSE source payloads.

## Files committed

- `src/lib/types.ts`
- `src/lib/rag/rag-query-plan.ts`
- `src/lib/rag/rag-coverage.ts`
- `src/lib/rag/rag-fallback-reason.ts`
- `src/lib/answer-client-payload.ts` (required server-only boundary expansion)
- `tests/rag-query-plan.test.ts`
- `tests/rag-coverage.test.ts`
- `tests/rag-fallback-reason.test.ts`
- `tests/answer-client-payload.test.ts` (focused boundary proof)

## TDD evidence

### RED

Command, run exactly once before any production implementation:

`node scripts/run-vitest.mjs run tests/rag-query-plan.test.ts tests/rag-coverage.test.ts tests/rag-fallback-reason.test.ts`

Result: expected failure. All three suites failed at import because `rag-query-plan`, `rag-coverage`, and `rag-fallback-reason` did not exist; zero tests ran.

### GREEN

Identical command after implementation:

`node scripts/run-vitest.mjs run tests/rag-query-plan.test.ts tests/rag-coverage.test.ts tests/rag-fallback-reason.test.ts`

Final result: PASS, 3 files and 15 tests. The selector was run again only after subsequent source changes, not against unchanged content.

Focused client-boundary proof:

`node scripts/run-vitest.mjs run tests/answer-client-payload.test.ts`

Result: PASS, 1 file and 10 tests.

## Static and diff evidence

- `npm run arbiter -- typecheck`: `RUN` because the arbiter classified the current change as fail-closed `db` scope and confirmed CI coverage.
- `npm run typecheck`: final PASS; gate receipt recorded for 10,976 input files. An earlier run correctly failed on the exhaustive client-field policy and one local status-narrowing error; both were fixed before the final pass.
- Scoped Prettier write/check across the nine committed files: PASS, all files formatted.
- Scoped ESLint with `--quiet` across the nine committed files: PASS, zero errors. The initial non-quiet invocation surfaced only the existing `_programmeDiagnostics` unused-variable warning in `answer-client-payload.ts`; it introduced no new error and was outside this task's behavior.
- `git diff --check c933f33f6f8d74299f4b19199018ec98b8166223..e8dc922f7fe5cabf2f3c0a4a703acde99e9dc8ed`: PASS, no output.
- Inspected the existing telemetry builders (`rag-programme-telemetry.ts`, `rag-eval-diagnostics.ts`, and `answer-telemetry.ts`): no query-plan or subquestion text field was added. Only bounded types/reason/status contracts are available for later telemetry wiring.

## Review 1 correction evidence

Direct RED command, run after adding only the four requested regressions and before correction production edits:

`node scripts/run-vitest.mjs run tests/rag-query-plan.test.ts tests/rag-coverage.test.ts`

RED result: expected failure, 2 files with 4 failed and 14 passed tests. The failures reproduced (1) gate-rejected clozapine evidence reported as `direct`, (2) omitted eligibility reported as `direct`, (3) fabricated benefits/risks comparison sides, and (4) an unclarified `Which form is required?` plan.

Identical GREEN command after the correction:

`node scripts/run-vitest.mjs run tests/rag-query-plan.test.ts tests/rag-coverage.test.ts`

GREEN result: PASS, 2 files and 18 tests.

- `npm run arbiter -- typecheck`: `RUN`, fail-closed `db` scope.
- `npm run typecheck`: PASS; gate receipt recorded for 11,003 input files.
- Scoped ESLint `--quiet` and Prettier write/check for the four correction files: PASS.
- `git diff --check e8dc922f7fe5cabf2f3c0a4a703acde99e9dc8ed..f936f555a5d668b8a52b6ab735e5b14ad1acbb99`: PASS.
- `git diff --check c933f33f6f8d74299f4b19199018ec98b8166223..f936f555a5d668b8a52b6ab735e5b14ad1acbb99`: PASS.

The correction commit's normal hook again stopped only on the same unrelated nine-table codebase-index inventory debt; the established narrow `SKIP_DOCS_SYNC_HOOK=1` override was used. No other hook or gate was bypassed.

The first normal commit attempt stopped only on the known unrelated nine-table `docs/codebase-index.md` inventory debt. The already-established narrow `SKIP_DOCS_SYNC_HOOK=1` override was used; no verification, formatting, or other commit hook was bypassed.

## Safety boundary confirmation

No document or corpus was fetched, read, parsed, OCRed, uploaded, embedded, enqueued, reindexed, or otherwise processed. No network, provider, OpenAI, Supabase/database/Storage, hosted CI, migration, deployment, push, or PR action occurred. Work used only local source, types, deterministic synthetic test strings, and offline checks. The brief, this report, receipts, review artifacts, `.superpowers/`, `1/`, and all protected P06 artifacts remain untracked and unstaged.
