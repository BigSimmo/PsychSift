# P01 evaluation Task 1 review attempt 2

- Reviewer agent: `/root/p01_eval_task1_review1`
- Model: `gpt-5.6-sol`
- Reasoning: `high` review against the xhigh-confirmed approved plan
- Review base: `585524d78bd7931f7ca2fba1f0c21366396dd3d8`
- Review head: `f6d1e0d215f4199a80791375e74ce6b35432a1b5`
- Specification verdict: `FAIL`
- Quality verdict: `FAIL`

## Important finding

The correction violates the enforced `rag.ts` no-growth ceiling. The approved plan requires `src/lib/rag/rag.ts` to remain at or below 4,362 lines (`evaluation plan:32`), and `scripts/check-maintainability-budgets.mjs:11` pins that exact limit. The three added diagnostics at `rag.ts:3576`, `rag.ts:3665`, and `rag.ts:3728` raise it from 4,362 to 4,365 lines. `node scripts/check-maintainability-budgets.mjs` fails. Fold each diagnostic into the existing retry-reason push or move the cohesive diagnostic helper outside the monolith; do not raise the budget.

## Prior findings corrected

- Canonical population binding derives and verifies the exact ID/fingerprint population and rejects omitted must-pass cases (`rag-programme-eval.ts:265`, `rag-programme-eval.test.ts:223`).
- Contradictory result flags produce `case_result_invariant_violation` (`rag-programme-eval.ts:289`, `rag-programme-eval.test.ts:239`).
- Baseline/candidate latency and cost must be finite and non-negative (`rag-programme-eval.ts:378`, `rag-programme-eval.test.ts:254`).
- Per-case hashes exclude fingerprints and remain stable after JSON round-trip (`rag-programme-eval.ts:681`, `rag-programme-eval.test.ts:356`).
- Runtime/script validation covers enums, privacy declarations/classifications, booleans, incremental eligibility, and conflict shape before accepting recomputed fingerprints (`rag-programme-eval.ts:546`, `check-rag-fixtures.mjs:176`).
- Owner-level eight-section test supplies actual incomplete provider text and proves bounded fallback, empty returned sections, no partial prose, and the bounded diagnostic (`rag-answer-fallback.test.ts:3458,3618`).

No routing threshold, model selection, token limit, retry count/budget, provider, corpus, or privacy scope changed. Runtime additions are bounded diagnostic tokens on existing terminal truncation paths.

## Verification

- `node scripts/run-vitest.mjs run tests/rag-programme-eval.test.ts` — PASS, 39 tests.
- Focused owner test — PASS, 1 passed and 90 skipped.
- `npm run check:rag:fixtures` — PASS, 36 golden cases, 26 suites, 29 programme cases.
- `node scripts/check-maintainability-budgets.mjs` — FAIL: `rag.ts` is 4,365/4,362 lines.
- Full-range canonical package exactly matches 119,592 bytes and two commits.
- `git diff --check 585524d...f6d1e0d` — PASS.
- No live/provider/hosted/network checks, edits, commits, or ledger writes occurred.
