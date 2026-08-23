# P01 evaluation Task 1 review attempt 1

- Reviewer agent: `/root/p01_eval_task1_review1`
- Model: `gpt-5.6-sol`
- Reasoning: `high` review against the xhigh-confirmed approved plan
- Review base: `585524d78bd7931f7ca2fba1f0c21366396dd3d8`
- Review head: `e2d06f90a6ed33e816364b5927ab7e39b8ede0c9`
- Specification verdict: `FAIL`
- Quality verdict: `FAIL`

## Important findings

1. The aggregate gate is not bound to the canonical must-pass population. `compareRagProgrammeRuns` only compares candidate IDs/counts against the supplied baseline and trusts supplied fingerprints; it never verifies either run against the parsed fixture (`src/lib/rag/rag-programme-eval.ts:265`). Tests use an arbitrary one-case baseline (`tests/rag-programme-eval.test.ts:109`). A probe used the real 29-case `caseSetFingerprint` but supplied only the first case to both runs and received `GO`. Require exact canonical case IDs/fingerprints, or derive and verify the population fingerprint from them, so omitting any must-pass case fails closed.

2. Supplied run outcomes can contradict their evidence and still produce `GO`. The comparator checks `item.passed` (`rag-programme-eval.ts:279`) but does not reject `passed: true` with non-empty `failedExpectations`. The current test changes both consistently (`tests/rag-programme-eval.test.ts:163`). A probe with `passed: true, failedExpectations: ["tampered_failure"]` returned `GO`. Validate result invariants at the gate boundary.

3. Latency and cost thresholds fail open for invalid values. Only `null` is missing; percentile/sum comparisons do not validate finite non-negative values (`rag-programme-eval.ts:322`). Candidate `NaN` or JSON-valid negative latency/cost returned `GO`. The test covers `null` but not non-finite/negative values (`tests/rag-programme-eval.test.ts:205`). Validate baseline and candidate metrics with `Number.isFinite(value) && value >= 0`.

4. Per-case fingerprints are not stable across a parse/serialize cycle. Case-set hashing removes `caseFingerprint`, but per-case hashing includes a previously computed fingerprint (`rag-programme-eval.ts:469`). Parsing the fixture and reparsing `parsed.raw` preserved the set hash but changed the first case hash. The current stability test checks only the case-set fingerprint (`tests/rag-programme-eval.test.ts:225`). Hash fingerprint-free case payloads and assert every case fingerprint remains stable after reparse.

5. Fixture validation does not enforce canonical vocabulary or the complete runtime privacy schema. `validateExpectation` mostly checks array shape, not valid enum entries; `assertPrivacyBoundary` accepts omitted protected-data declarations (`rag-programme-eval.ts:377,390`). The script checker similarly checks shapes only (`scripts/check-rag-fixtures.mjs:153`). After recomputing a valid fingerprint, a fixture with `expectedCorpusScopes: [42]` and missing `containsPatientData` was accepted. Validate every enum, boolean, conflict field, classification, and required privacy declaration before fingerprint acceptance.

6. The structured-output protected-owner test does not exercise the protected owner. It manually constructs `GenerationQualityError("max_output_tokens", ...)` and checks metadata (`tests/rag-generation-quality-diagnostics.test.ts:89`). Production truncation throws a plain incomplete-generation error before parsing (`src/lib/rag/rag.ts:3542,3575`). The test can pass if an incomplete eight-section response is served despite the fixture requiring bounded recovery and `partial_structure_not_served` (`rag-programme-failures.v1.json:678`). Add an owner-level test using an incomplete eight-section provider result, asserting retry/fallback diagnostics and that partial structure is never returned.

## Other specification observations

- Shared vocabulary and exact policy constant match the brief.
- Evaluator is pure and provider-free.
- All 29 listed privacy-declared failure classes are present.
- `RagEvalCase` is extended rather than replaced; runtime routing/follow-up/generation behavior did not change.
- Canonical package exactly matches the immutable range: 90,777 bytes, one commit.

## Verification

- `npm run check:rag:fixtures` — PASS: 36 golden cases, 26 suites, 29 programme cases.
- `git diff --check 585524d...e2d06f9` — PASS.
- Focused Vitest — BLOCKED before execution by a legitimate Chromium Playwright lease in `D:\Repos\Database`; not bypassed.
- Read-only TSX probes reproduced omitted-population, inconsistent-outcome, invalid-metric, unstable-fingerprint, and malformed-loader cases.
- No edits, commits, ledger writes, provider calls, hosted checks, or network access occurred.
