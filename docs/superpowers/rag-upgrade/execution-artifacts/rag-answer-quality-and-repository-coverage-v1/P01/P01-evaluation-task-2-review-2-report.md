# P01 evaluation Task 2 review attempt 2

- Reviewer agent: `/root/p01_eval_task2_review1`
- Model: `gpt-5.6-sol`
- Reasoning: `high` review against the xhigh-confirmed approved privacy/RAG plan
- Review base: `47c0eb53b8d62540596eaa2f9828ddbfd59d9d49`
- Review head: `f4699fda1a8f9b6b566728dc3b04c4d8b2e41e00`
- Specification verdict: `FAIL`
- Quality verdict: `FAIL`

## Important findings

1. `src/lib/answer-telemetry.ts:87`: complete retrieval inserts still accept unvalidated `responseMode`. When `fallbackReason` is absent, the same value becomes top-level `miss_reason` at lines 135-138. A contaminated probe put `protected-source-text-canary` in both metadata and `miss_reason`. Runtime-allowlist `responseMode`, derive `miss_reason` only from validated tokens, and extend the complete-row test with a canary `responseMode` and no fallback reason.

2. `src/lib/rag/rag.ts:3802`: programme diagnostics are finalized/written to `rag_queries` at lines 3826-3837 before the route's final source-governance boundary. `src/lib/answer-response.ts:58` then spreads those diagnostics unchanged while replacing the served answer with an unsupported governance refusal. A probe produced `servedGrounded: false` and `telemetryGrounded: false`, but retained `coverageCounts.direct: 1`, `insufficiencyReason: null`, and `generationOutcome: generated`; the already-written query row remains grounded/high-confidence. Recompute the bounded answer projection after governance refusal and ensure the query-store write represents the same final served outcome.

## Confirmed closed

- Cache, coalesced, streaming-summary, and empty-scope paths join the same route UUID to both stores.
- Normal/streaming routes share observation context.
- Candidate/selected diagnostics attach once from actual results; missing corpus annotations remain honest zeros.
- Programme diagnostics are excluded from JSON/SSE clients.
- Flag off emits only `interaction_id`; flag on emits answer/SLO allowlist; invalid UUIDs fail in both states.
- No second ID, migration, RLS, retention, rollout routing, provider, or live-operation scope.

## Verification

- Seven-file focused offline suite — PASS, 7 files and 34 tests.
- Maintainability — PASS; `rag.ts` 4,356/4,362.
- Full-range `git diff --check` — PASS.
- No edits, commits, artifacts, ledger writes, provider calls, Supabase access, or network actions.
