# P01 phase review attempt 1

- Reviewer agent: `/root/p01_phase_review1`
- Phase base: `585524d78bd7931f7ca2fba1f0c21366396dd3d8`
- Phase head: `dd361e575d3b22fc3b824c8b42af9f76d1661f8a`
- Specification verdict: `FAIL`
- Quality verdict: `FAIL`

## Findings

### P1 — Recall gate treats correct negative cases as retrieval failures

`src/lib/rag/rag-programme-eval.ts:347-352` calculates document and content
recall across every programme case and requires both to equal `1.0`. However,
six canonical governance/exclusion cases intentionally have no expected
document, for example `scripts/fixtures/rag-programme-failures.v1.json:98-102`,
with the others at lines 121-125, 332-336, 355-359, 528-532, and 574-578.

Trigger: assign reciprocal rank `0` to those correct negative cases and `1` to
all positive cases in otherwise identical, complete canonical baseline and
candidate runs.

Expected: negative exclusion/governance cases are excluded from the recall
denominator and remain protected through their must-pass expectations and hard
violations.

Actual: `compareRagProgrammeRuns` returns:

```json
{"decision":"NO_GO","reasons":["content_recall_below_gate","document_recall_below_gate"]}
```

This makes the core phase gate unusable without reporting dishonest positive
ranks for cases where retrieval must not occur. Carry rank applicability from
the canonical fixture into the result/run contract, calculate recall only over
positive retrieval cases, and add a full canonical-population test containing
correct zero-rank negative cases.

### P2 — Ordinary generated-answer query rows retain a free-form reason path

`src/lib/rag/rag-query-telemetry.ts:43-53` uses bounded outcome metadata only
when the telemetry finalizer returns a different object. For the normal
no-governance-warning path, `buildGovernedAnswerClientResponse` returns the
original answer by identity at `src/lib/answer-response.ts:88-92`; therefore
`finalRagQueryFields` copies the free-form `routingReason` argument directly into
`rag_queries.metadata.routing_reason`. Its fallback helper can also return an
arbitrary matching reason segment (`src/lib/rag/rag-answer-support.ts:41-51`).

The cache/coalesced canary tests at
`tests/rag-programme-telemetry-writers.test.ts:296-326` use
`logRagQueryOutcome`, which always takes the bounded projector, so they do not
cover this ordinary uncached writer branch.

Expected: every programme-observed query row contains only bounded route and
insufficiency tokens, including when final governance leaves the answer
unchanged.

Actual risk: contaminated provider/protected prose can pass through the
string-typed reason fields into the query metadata owner, contrary to the phase
privacy stop condition. Use the bounded final-outcome projector for ordinary
programme writes too, and add a normal uncached writer test with contaminated
top-level and nested reason values.

## Task-boundary and prior-finding assessment

The two tasks otherwise form the intended evaluator-plus-two-store foundation.
Previously reported issues around canonical population binding, result
invariants, invalid metrics, stable fingerprints, fixture-schema validation,
truncation ownership, maintainability, terminal writer joins, corpus counts,
final-governance alignment, response-mode bounds, nested insufficiency reasons,
and client-payload exclusion remain closed.

No new telemetry table, identifier family, migration, RLS, retention, rollout
routing, provider call, hosted operation, or network scope was introduced. The
remaining ordinary query-writer gap means Task 2's prior claim that all complete
persisted reason paths are bounded is not yet fully established.

## Verification

- `npm run check:rag:fixtures` — PASS: 36 golden cases, 26 suites, 29 programme
  cases; fingerprint
  `sha256:4bf13e036a49ee077a9227c6b61d6f597efff15e8a5f2e3ea36f0cd4e4ea5107`.
- `npm run plans:rag:receipts:check -- --resume P01` — PASS.
- `node scripts/check-maintainability-budgets.mjs` — PASS; `rag.ts` is
  4,357/4,362 lines.
- Full-range `git diff --check` — PASS.
- Direct canonical-population evaluator probe — reproduced the P1 `NO_GO`.
- Focused Vitest run — BLOCKED by the legitimate `run-lighthouse-budget`
  focused-test lease in the performance-remediation worktree; it was not
  bypassed.
- Canonical phase package identifies the correct base/head and seven-commit
  range.
- No edits, commits, ledger mutations, provider calls, Supabase access, or
  network actions were performed.

Residual boundary: this review covers local/offline source and fixture evidence
only. Live corpus, provider, Supabase, hosted canary, migration, deployment, and
production readiness remain separately authorization-gated.
