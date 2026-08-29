# P07 Retrieval Task 1 Implementer Brief

## Immutable execution identity

- Programme: `rag-answer-quality-and-repository-coverage-v1`
- Phase: `P07` - Query, coverage and fallback contracts
- Global task key: `P07/retrieval/task-1`
- Task base: `c933f33f6f8d74299f4b19199018ec98b8166223`
- Plan: `docs/superpowers/rag-upgrade/local/plans/2026-08-20-rag-retrieval-composition.md`, Task 1 only
- Spec: `docs/superpowers/rag-upgrade/local/specs/2026-08-20-rag-answer-and-australian-sources-design.md`
- Implementation model/effort: `gpt-5.6-sol` / `high`
- Review model/effort: `gpt-5.6-sol` / `high`
- Environment/authority: `offline-shadow` / `local-code-and-fixtures`

## Outcome

Define deterministic, total, provider-free query-plan, clinical-ambiguity, evidence-coverage, and sanitized fallback-reason contracts. Preserve the original query and existing canonical types, cap decomposition at four subquestions, and make ambiguity/coverage decisions only from existing query analysis and directly selected/cited evidence.

## Required scope

Follow every Task 1 step and acceptance condition in the named plan. Planned owners are:

- modify `src/lib/types.ts`;
- create `src/lib/rag/rag-query-plan.ts`;
- create `src/lib/rag/rag-coverage.ts`;
- create `src/lib/rag/rag-fallback-reason.ts`;
- create `tests/rag-query-plan.test.ts`;
- create `tests/rag-coverage.test.ts`; and
- create `tests/rag-fallback-reason.test.ts`.

Reuse `ClinicalQueryAnalysis`, `RagSubquestionPurpose`, `RagInsufficiencyReason`, `SourceCorpusScope`, `SiteContentDomain`, `SourcePolicyConflict`, `evaluateEvidenceCoverageGate`, retrieval selection, source-role decisions, and directly cited chunk membership. Do not create parallel enums, a second coverage owner, or another model/provider call.

## Non-negotiable behavior

- Simple questions stay single; broad management questions decompose deterministically to at most four ordered purposes; comparisons create primary plus two sides only when both sides are identifiable.
- Preserve acronym expansion, medicine aliases/common misspellings, exact document/section, population, setting, and jurisdiction signals in deterministic interpretation/reason codes.
- Ask one clarification only when material ambiguity changes retrieval. Ordinary uncertainty becomes a stated interpretation.
- `evaluateAnswerCoverage` cannot infer clinical support from metadata alone; it uses directly selected/cited evidence and existing governance/source-role conflict owners.
- `SearchResult` gains optional server-side `corpus_scope` and `site_content_domain`; absent/unknown candidate scope is rejected rather than guessed. Existing registry records are `clinical_kb_site`, never `uploaded_local`.
- Typed fallback fields take precedence. Legacy free-form parsing is compatibility-only, maps unknown text to `unknown`, and never exposes exceptions, hosts, secrets, query strings, or provider internals.
- Query and subquestion text remains request-local and must not enter telemetry builders.

## TDD and verification contract

First add the three contract suites, then run the literal RED selector exactly once:

```text
node scripts/run-vitest.mjs run tests/rag-query-plan.test.ts tests/rag-coverage.test.ts tests/rag-fallback-reason.test.ts
```

RED expectation: `FAIL because the modules/types do not exist.`

After implementation, run the identical selector and require it to pass. Run `npm run arbiter -- typecheck` before `npm run typecheck` and follow the arbiter verdict accurately. Run scoped lint/format and `git diff --check TASK_BASE..TASK_HEAD`. Do not run full Vitest, build, browser, provider, hosted, release, deployment, live database, or document/corpus gates; do not repeat an unchanged successful check.

## Safety boundary

Do not fetch, read, parse, OCR, upload, embed, enqueue, reindex, or otherwise process any document or corpus. Do not access the network, provider APIs, Supabase/database/Storage, hosted CI, or deployment state. Do not apply migrations, push, open a PR, or deploy. Synthetic fixture strings and local source/test commits are authorized.

## Handoff

Commit only the task-owned tracked source/tests. Leave this brief, the implementer report, review packages/reports, receipt, `.local/`, `.superpowers/`, `1/`, and all protected P06 artifacts untracked and unstaged for the controller's later atomic P07 acceptance commit. Write the implementer report to `docs/superpowers/rag-upgrade/execution-artifacts/rag-answer-quality-and-repository-coverage-v1/P07/P07-retrieval-task-1-implementer-report.md`, recording RED/GREEN evidence, exact commits/files/checks, and confirmation that no documents or live systems were touched.
