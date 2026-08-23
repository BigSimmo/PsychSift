# P01 evaluation Task 2 review attempt 1

- Reviewer agent: `/root/p01_eval_task2_review1`
- Model: `gpt-5.6-sol`
- Reasoning: `high` review against the xhigh-confirmed approved privacy/RAG plan
- Review base: `47c0eb53b8d62540596eaa2f9828ddbfd59d9d49`
- Review head: `bdeb2f3d22329b8e294a35a84890d55e6a9b5956`
- Specification verdict: `FAIL`
- Quality verdict: `FAIL`

## Important findings

1. `src/lib/rag/rag.ts:2468`: cache and in-flight coalescing return before any `logRagQuery` call. The second route-created UUID reaches `rag_retrieval_logs` through `logAnswerDiagnostics` but never reaches `rag_queries`. The same missing two-store join affects local/shared cache returns at lines 2536-2586, streaming summaries at `src/app/api/answer/stream/route.ts:244`, and empty-scope answers at `src/app/api/answer/route.ts:115`. The route-parity test mocks both owners and verifies only argument plumbing. Add end-to-end writer tests covering cache/coalescing, summary, and empty-scope outcomes.

2. `src/lib/answer-telemetry.ts:76`: retrieval telemetry passes `sources.length` as candidate count, while `src/lib/rag/rag-programme-telemetry.ts:281-292` classifies every candidate/selected source as `uploaded_local`. With extended telemetry, an answer reporting `retrievalDiagnostics.candidateCount = 9` and two selected sources projected candidate/selected counts as 2 and zeroed every other corpus. The stores can disagree for the same UUID, and retrieval metadata lacks promised real route/corpus counts. Build diagnostics once from real retrieval/corpus outcomes and project that shared object into both owners.

3. `src/lib/answer-telemetry.ts:85`: final `rag_retrieval_logs.metadata.answer` still copies free-form `routingReason` and `fallbackReason` verbatim. A contaminated builder input produced provider error text and protected source content in persisted metadata. Current canary tests cover only the programme sub-projection, not the merged stored row. Replace these fields with bounded tokens or apply a strict final metadata allowlist, then test the complete stored row.

## Verified

- Flag off emits only `interaction_id`; contaminated values absent; invalid UUID rejected.
- Flag on emits the answer/SLO allowlist; contaminated values absent; invalid UUID rejected.
- `git diff --check 47c0eb53...bdeb2f3d` — PASS.
- Prescribed five-file suite was attempted twice but blocked by legitimate `lint:internal` and Vitest coordinator leases; neither was bypassed.
- No edits, provider calls, Supabase access, network actions, or ledger writes occurred.
