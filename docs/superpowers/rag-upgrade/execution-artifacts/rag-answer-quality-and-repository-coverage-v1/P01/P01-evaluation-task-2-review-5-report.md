# P01 evaluation Task 2 review attempt 5

- Reviewer agent: `/root/p01_eval_task2_review1`
- Review base: `47c0eb53b8d62540596eaa2f9828ddbfd59d9d49`
- Review head: `16816ba657dcea36a1bce8a0e896c7c7dc0f02cd`
- Specification verdict: `FAIL`
- Quality verdict: `FAIL`

## Important findings

1. `src/lib/rag/rag-programme-eval.ts:276-282,328-331,369`: the new
   `rankApplicability` field is excluded from `populationFingerprint`. A probe
   changed the canonical mapping and matching runs so all 23 positive-retrieval
   cases became `correct_negative` with zero ranks. The fingerprint remained
   unchanged and `compareRagProgrammeRuns` returned `GO` with no reasons,
   bypassing both recall gates. Bind applicability into population integrity and
   validate its runtime enum while retaining the existing fixture case-set
   fingerprint.

2. `src/lib/rag/rag-query-telemetry.ts:44-58`: the observation-context branch
   couples bounded metadata selection to source-ID selection. When governance
   leaves an answer unchanged, it now uses `answer.sources` rather than legacy
   `originalSources`. A probe returned `["selected"]` with observation context
   versus `["retrieved-a","retrieved-b"]` without it. Preserve original source
   IDs for identity-unchanged answers while independently using bounded outcome
   metadata; transformed governance refusals should continue using transformed
   sources.

## Closure assessment

- Phase P2's free-form ordinary-writer reason path is closed.
- Phase P1's recall denominator is correct for an untampered parsed population,
  and correct negatives remain must-pass with zero ranks, but population tamper
  resistance remains incomplete.
- All earlier Task 2 privacy, UUID, terminal-writer, response-mode,
  nested-reason, client-boundary, and final-governance findings remain closed.
- Test isolation cleanup, no-observation legacy metadata, fixture fingerprint
  compatibility, and the 4,362-line budget remain intact.

## Verification

- Direct applicability-tamper probe — reproduced false `GO`.
- Direct source-ID compatibility probe — reproduced observed/legacy divergence.
- `npm run check:rag:fixtures` — PASS; 36 cases, 26 suites, 29 programme
  cases; fingerprint unchanged.
- `npm run check:rag:adversarial-fixtures` — PASS; 24 cases, 8 categories, 6
  canaries.
- Maintainability — PASS; `rag.ts` 4,362/4,362.
- Full-range `git diff --check` — PASS.
- Focused Vitest attempted twice but blocked by the legitimate
  `run-lighthouse-budget` lease; not bypassed. Fresh exact-head implementer
  results were reviewed.
- No edits, commits, artifacts, ledger mutations, provider/network calls, or
  Supabase access.
