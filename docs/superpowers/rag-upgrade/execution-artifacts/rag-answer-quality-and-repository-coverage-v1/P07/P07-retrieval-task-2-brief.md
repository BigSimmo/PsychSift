# P07 Retrieval Task 2 Implementer Brief

## Immutable execution identity

- Programme: `rag-answer-quality-and-repository-coverage-v1`
- Phase: `P07` - Query, coverage and fallback contracts
- Global task key: `P07/retrieval/task-2`
- Task base: `f936f555a5d668b8a52b6ab735e5b14ad1acbb99`
- Plan: `docs/superpowers/rag-upgrade/local/plans/2026-08-20-rag-retrieval-composition.md`, Task 2 only
- Spec: `docs/superpowers/rag-upgrade/local/specs/2026-08-20-rag-answer-and-australian-sources-design.md`
- Implementation model/effort: `gpt-5.6-sol` / `high`
- Review model/effort: `gpt-5.6-sol` / `high`
- Environment/authority: `offline-shadow` / `local-code-and-fixtures`

Task 1 received canonical dual-PASS review at this task base before dispatch.

## Outcome

Integrate the deterministic `RagQueryPlan` once after the existing classifier/fallback analysis, but keep served retrieval, cache writes, and returned `SearchResult` IDs/order byte-identical in `legacy` and `shadow`. Shadow may calculate bounded candidate variants and content-free counters only. It must add no provider/classifier calls, no retrieval fanout, and no raw query/subquestion telemetry or cache material.

## Planned owners

- inspect `src/lib/clinical-search.ts`;
- modify `src/lib/rag/rag-retrieval-variants.ts`;
- modify `src/lib/rag/rag-contracts.ts`;
- modify `src/lib/rag/rag-cache.ts`;
- modify `src/lib/rag/rag.ts`;
- modify `tests/clinical-search.test.ts`;
- modify `tests/retrieval-query-variants.test.ts`;
- modify `tests/rag-routing.test.ts`; and
- modify `tests/rag-classifier-memo.test.ts`.

The smallest correctness-required adjacent owners are permitted only when exercised directly: `src/lib/rag/rag-programme-telemetry.ts` for persisted allow-listed plan metadata, `tests/rag-programme-telemetry.test.ts` for privacy proof, `tests/rag-cache-invalidation.test.ts` for plan-version isolation, and one existing orchestration-level RAG test for byte-identical legacy/shadow results. Document every adjacent file in the implementer report. Do not broaden into Task 3 corpus retrieval, migrations, rollout activation, UI, generation, or fallback integration.

## Exact integration seams

- Reuse `analyzeClinicalQuery` and `analyzeQueryWithClassifierFallback`; build the plan exactly once after the finalized analysis and query-mode override in `rag.ts`, without changing classifier memoization or call count.
- Derive mode from the request-local `RagContextSnapshot`/observation context. Do not reread environment variables or activate API routes.
- Extend `buildRetrievalQueryVariants(query, analysis, aliases = [], plan?)`. With no plan or a simple/single plan, return exactly the current legacy variants. Candidate variants keep the original query first, dedupe deterministically, and never exceed the existing four-variant and three-text-RPC budgets.
- Compute and retain the unchanged legacy variants for every served RPC, result, cache read/write, and fallback. In `shadow`, compute candidate variants separately for diagnostics only. Candidate work must be pure, abortable, and must never call retrieval or write a legacy/shared cache entry.
- Add a bounded query-plan version to cache identity and bump/export the existing cache dependency version as required. Never place raw subquestion text in a persisted key; candidate text may influence only the existing privacy-hashed variant digest path.
- Add only content-free bounded telemetry: plan kind, subquestion count, deterministic reason codes/counts, and candidate variant count if required. Never emit original query, subquestion text, clarification text, provider detail, source content, or user/admin identifiers.
- Keep the adversarial and ordinary unsupported short circuits free of provider/retrieval fanout. Pure plan computation must not move network-capable work ahead of either branch.
- Keep `src/lib/rag/rag.ts` at or below its enforced 4,362-line ceiling; integration is thin wiring, not a second orchestration owner.

## Required regressions

Add tests first for all Task 2 plan bullets, including:

- simple queries preserve the exact legacy variant array;
- specifier, differential, and medication terms set bounded site-domain hints without provider work;
- duress-procedure and IM-medication-in-agitation questions remain clinical/pathway questions rather than source-inventory document lookups;
- ambiguous queries keep the domain filter open;
- cross-domain, broad, and comparison plans retain original query first and stay within four total variants;
- classifier memo/provider call counts do not increase;
- unsupported queries cause no retrieval/provider fanout;
- plan-version cache identities differ while raw subqueries cannot appear in storage keys or telemetry; and
- an orchestration fixture proves legacy and shadow return identical `SearchResult` IDs/order while candidate counts exist only in content-free shadow diagnostics.

## TDD and verification contract

After adding the failing assertions and before production implementation, run the literal RED selector exactly once:

```text
node scripts/run-vitest.mjs run tests/clinical-search.test.ts tests/retrieval-query-variants.test.ts tests/rag-routing.test.ts tests/rag-classifier-memo.test.ts
```

RED expectation: `FAIL on absent query-plan integration.` Record the exact failing assertions and keep existing baseline assertions passing.

After implementation, run the identical selector and require PASS. Run only the smallest additional focused orchestration/cache/telemetry tests needed for adjacent owners. Consult `npm run arbiter -- typecheck` before typecheck and follow its verdict accurately. Run `npm run check:maintainability-budgets`, scoped lint/format, and `git diff --check TASK_BASE..TASK_HEAD`. Do not repeat unchanged successful checks or run full Vitest, build, browser, hosted, provider, live database, release, or document/corpus gates.

## Safety boundary

Do not fetch, read, parse, OCR, upload, embed, enqueue, reindex, or otherwise process a document or corpus. Do not access provider APIs, Supabase/database/Storage, hosted CI, or deployment state. Do not apply migrations, push, open a PR, deploy, or activate rollout flags. Synthetic fixture strings and local source/test commits are authorized.

## Handoff

Commit only Task 2 tracked source/tests. Leave this brief, implementer/reviewer reports, review packages, P07 receipt, `.superpowers/`, `1/`, and protected P06 artifacts untracked and unstaged for the later atomic P07 acceptance commit. Write the implementer report to `docs/superpowers/rag-upgrade/execution-artifacts/rag-answer-quality-and-repository-coverage-v1/P07/P07-retrieval-task-2-implementer-report.md`, recording exact RED/GREEN evidence, commits/files/checks, adjacent scope, maintained legacy/shadow identity, and confirmation that no documents or live systems were touched.
