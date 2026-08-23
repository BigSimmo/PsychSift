# P01 evaluation Task 1 implementer report

- Implementer agent: `/root/p01_eval_task1_impl`
- Model: `gpt-5.6-sol`
- Reasoning: `high` build against the xhigh-confirmed approved plan
- Task base: `585524d78bd7931f7ca2fba1f0c21366396dd3d8`
- Task head: `47c0eb53b8d62540596eaa2f9828ddbfd59d9d49`
- Commits:
  - `e2d06f90a6ed33e816364b5927ab7e39b8ede0c9` (`feat(rag): add programme evaluation gate`)
  - `f6d1e0d215f4199a80791375e74ce6b35432a1b5` (`fix(rag): harden programme evaluation gate`)
  - `47c0eb53b8d62540596eaa2f9828ddbfd59d9d49` (`refactor(rag): preserve generation budget ceiling`)

## Scope

Added the canonical shared programme vocabularies, pure offline programme evaluator and gate policy, a versioned privacy-reviewed synthetic/de-identified failure fixture with stable fingerprints, the existing `RagEvalCase` registry extension, fixture validation/tamper guards, and protected-owner assertions for routing, bounded generation recovery, and follow-up behavior.

Changed task files:

- `scripts/check-rag-fixtures.mjs`
- `scripts/fixtures/rag-programme-failures.v1.json`
- `src/lib/rag/rag-eval-cases.ts`
- `src/lib/rag/rag-programme-eval.ts`
- `src/lib/rag/rag.ts`
- `src/lib/types.ts`
- `tests/answer-follow-up.test.ts`
- `tests/rag-answer-fallback.test.ts`
- `tests/rag-eval-cases.test.ts`
- `tests/rag-generation-quality-diagnostics.test.ts`
- `tests/rag-programme-eval.test.ts`
- `tests/rag-routing.test.ts`

No Supabase, provider, network, routing behavior, token budget, follow-up behavior, or live corpus owner changed.

## TDD evidence

Literal RED:

`node scripts/run-vitest.mjs run tests/rag-programme-eval.test.ts`

Result: failed for the expected product absence, `Cannot find package '@/lib/rag/rag-programme-eval'`; the module, types, and fixture did not exist.

Additional fixture-hardening RED: 4 of 17 assertions failed for the absent fixture and absent `rank_metric_invalid` guard.

Additional registry RED: 1 of 173 assertions failed because the existing registry did not expose `programmeExpectation`.

Final focused GREEN:

`node scripts/run-vitest.mjs run tests/rag-programme-eval.test.ts tests/rag-eval-cases.test.ts tests/rag-eval-source-governance.test.ts tests/rag-routing.test.ts tests/rag-generation-quality-diagnostics.test.ts tests/answer-follow-up.test.ts`

Result: PASS, 6 files and 173 tests.

Acceptance commands:

- `npm run check:rag:fixtures` — PASS: 36 golden cases, 26 suites, 29 programme cases; fingerprint `sha256:4bf13e036a49ee077a9227c6b61d6f597efff15e8a5f2e3ea36f0cd4e4ea5107`.
- `npm run check:rag:adversarial-fixtures` — PASS: 24 synthetic cases, 8 categories, 6 canaries.
- `npm run arbiter -- typecheck` — selected RUN for RAG scope.
- `npm run typecheck` — PASS.
- Scoped Prettier check and `git diff --check` — PASS.

## Review correction evidence

Review attempt 1 exposed six fail-open or owner-proof gaps. Test-only corrections first produced 12 failures in 28 programme tests and one failure in the selected owner-level generation test:

- copied canonical fingerprints with an omitted must-pass population were accepted;
- `passed: true` contradicted by failed expectations was accepted;
- NaN, infinite, and negative latency/cost values were accepted;
- all 29 per-case fingerprints changed after parse/serialize/reparse;
- five recomputed-fingerprint malformed fixtures were accepted (invalid corpus enum, boolean public state, malformed conflict, invalid classification, and missing privacy declaration); and
- an incomplete eight-section provider result lacked the `partial_structure_not_served` diagnostic.

The correction binds comparison to exact canonical case IDs/fingerprints and a derived population fingerprint, validates outcome invariants and finite non-negative metrics, hashes fingerprint-free case payloads, validates complete canonical vocabulary/privacy schemas before fingerprint acceptance, and records the privacy-safe incomplete-structure diagnostic while preserving existing retry/fallback behavior.

Final correction GREEN:

- `node scripts/run-vitest.mjs run tests/rag-programme-eval.test.ts` — PASS, 39 tests.
- `node scripts/run-vitest.mjs run tests/rag-answer-fallback.test.ts` — PASS, 91 tests.
- Exact Step 4 six-file command — PASS, 6 files and 195 tests.
- `npm run check:rag:fixtures` — PASS, 36 golden cases, 26 suites, 29 programme cases; stable fingerprint unchanged.
- `npm run check:rag:adversarial-fixtures` — PASS, 24 synthetic cases, 8 categories, 6 canaries.
- `npm run typecheck` — PASS.
- Scoped Prettier and `git diff --check` — PASS.

Review attempt 2 confirmed the six fail-closed corrections but found the three diagnostic lines exceeded the protected `rag.ts` no-growth ceiling. Each diagnostic token was folded into its existing retry-reason push, removing three net lines with no ordering, retry, budget, routing, or fallback behavior change.

- `node scripts/check-maintainability-budgets.mjs` — PASS; `rag.ts` is exactly 4,362/4,362 lines.
- Focused incomplete eight-section owner test — PASS, 1 selected test with 90 skipped.
- Scoped Prettier and `git diff --check` — PASS.

Focused runs were temporarily admission-blocked by legitimate leases in other Database worktrees. No lease was bypassed or killed; blocked attempts were not counted as RED/GREEN evidence.

## Privacy and governance

Fixture content is synthetic or de-identified and explicitly records privacy review. It contains no patient/private data, production traces, provider output, full first-party record bodies, administrator/user identifiers, or copied eTG/AMH content. Healthdirect exclusion and eTG/AMH link-only rules appear only as bounded expectations. No provider, hosted, live, or network action occurred.

## Hook handling and residuals

A documentation hook generated two out-of-scope files during the first commit attempt. Those changes were restored and `SKIP_DOCS_SYNC_HOOK=1` was used so the task commit remained limited to its ten product/test/fixture files. A later centralized generated-scripts inventory refresh would increment its observed script count from 259 to 260; that generated inventory was intentionally excluded from this task range.

The adversarial checker continues to identify retrieval/answer owner runs as pending, as expected outside Task 1. Later consumers must pass the parsed canonical population to the comparator; there are no other current callers. This evidence is offline contract evidence only, not real-corpus, hosted/provider, production, clinical-safety, or deployment evidence.
