# P06 Repository Content Task 4 Implementer Brief

## Immutable execution identity

- Programme: `rag-answer-quality-and-repository-coverage-v1`
- Phase: `P06` - Durable public site synchronization and request snapshots
- Global task key: `P06/repositoryContent/task-4`
- Task base: `aed1c5eec5ef7d276b16b8a9226f1ff5080a749b`
- Plan: `docs/superpowers/rag-upgrade/local/plans/2026-08-21-rag-repository-content-sync.md`, Task 4 only
- Spec: `docs/superpowers/rag-upgrade/local/specs/2026-08-20-rag-answer-and-australian-sources-design.md`
- Implementation model/effort: `gpt-5.6-sol` / `high`
- Environment/authority: `offline-source-only` / `local-code-migrations-not-applied`

## Outcome

Bind registered static repository content and administrator-published dynamic site content to one fail-closed activation and freshness contract. Add an offline evidence checker, a bounded privacy-safe health projection, and CI change-scope parity so deployment cannot treat a mismatched, incomplete, stale, unreviewed, or operationally unhealthy public release as current.

## Required scope

Follow every Task 4 step and acceptance condition in the named plan. The exact planned files are:

- modify `.github/workflows/ci.yml`
- modify `scripts/ci-change-scope.mjs`
- create `scripts/check-site-content-freshness.ts`
- modify `src/lib/health-response.ts`
- create `tests/site-content-freshness-workflow.test.ts`
- create `tests/site-content-health.test.ts`
- create `tests/ci-scope-contract.test.ts`
- create `tests/fixtures/site-content/release-evidence-current.json`

Reuse the P03/P06 owners `ActiveSiteContentRelease`, `SiteContentPartitionSnapshot`, `assertSiteContentPartitionSnapshot`, `siteContentPendingLogicalIdsDigest`, and the exact pending logical-ID set/digest. Do not create a second release, recovery, queue, freshness, or activation owner.

## Non-negotiable behavior

- Keep the classifier pure, deterministic, provider-free, and fail-closed over `{ expectedStaticManifestDigest, activeRelease, queueHealth, deploymentSha }`.
- Static producer/adapter/governance/embedding/retrieval changes select the bounded manifest/domain-fixture validation path; ordinary unrelated repository changes do not trigger a full site re-index.
- A dynamic administrator publication may become `updating` without a redeploy or static-digest change only when the exact pending-record exclusion set is valid, worker invocation is fresh, and integrity is complete.
- `current` requires an exact runtime expected-static-digest match and complete release integrity. Missing/malformed digests, partial population, untracked deletion, duplicate published logical IDs, non-admin publication evidence, inconsistent epoch/pending evidence, stale validation/source state, an unreviewed domain, or deployment-SHA mismatch fail closed.
- Preserve the distinction between an unreviewed domain and a reviewed-but-ineligible domain; do not collapse either into an eligible or current state.
- A failed item, worker heartbeat/invocation staleness, pending item beyond ten minutes, or other integrity failure is an operation/promotion stop. The initial activation SLO is five minutes.
- Health exposes only the bounded fields named by the plan: public release ID, static-match boolean, release-digest prefix, aggregate state, synchronizer deployment/invocation freshness, bounded queue counts/oldest age/failed count, last activation, and rollback availability. It must not expose content, exact digests, epochs, routes/private identifiers, actor IDs, or provider errors.
- The CLI uses offline artifacts by default. Do not add or exercise live-read mode in this task; any future live path remains separately approval-gated.
- Keep `src/lib/rag/rag.ts` untouched at or below 4,362 lines.

## TDD and verification contract

First add the Task 4 assertions, then run the literal RED selector exactly once:

```text
node scripts/run-vitest.mjs run tests/site-content-freshness-workflow.test.ts tests/site-content-health.test.ts tests/ci-scope-contract.test.ts
```

RED expectation: after adding digest-bound activation assertions and before implementation, fail because static and administrator-published content do not share one activation contract.

After implementation, run the identical selector exactly once and require it to pass. Run `npm run arbiter -- typecheck` before the distinct compilation check and follow its verdict accurately; for this deployment/RAG-adjacent scope a RUN verdict is expected. Also run `npm run check:maintainability-budgets` and `git diff --check TASK_BASE..TASK_HEAD`. Do not run full Vitest, build, browser, hosted, provider, release, or deployment gates, and do not repeat an unchanged successful check.

## Safety boundary

Do not fetch, read, parse, OCR, upload, embed, enqueue, reindex, activate, withdraw, or otherwise process any document or corpus. Do not access the network, provider APIs, Supabase/database/Storage, hosted CI, or deployment state. Do not apply migrations. Do not push, open a PR, or deploy. Local task-scoped source/test commits are authorized by this SDD workflow. Synthetic metadata and fixture-only strings are allowed; no real content is.

## Handoff

Make coherent local product/test commits only. Leave this brief, the implementer report, review packages/reports, receipt, `.local/`, and `.superpowers/` untracked and unstaged for the controller's later atomic phase-acceptance commit. Write the implementer report to `docs/superpowers/rag-upgrade/execution-artifacts/rag-answer-quality-and-repository-coverage-v1/P06/P06-repository-content-task-4-implementer-report.md`, recording literal RED/GREEN evidence, exact commits, files, checks, residual live gates, and confirmation that no documents or live systems were touched.
