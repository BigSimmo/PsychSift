# P06 Repository Content Task 5 Implementer Brief

## Immutable execution identity

- Programme: `rag-answer-quality-and-repository-coverage-v1`
- Phase: `P06` - Durable public site synchronization and request snapshots
- Global task key: `P06/repositoryContent/task-5`
- Task base: `0ee8c09681a49b7891f99d4c3d33f426611ffd78`
- Plan: `docs/superpowers/rag-upgrade/local/plans/2026-08-21-rag-repository-content-sync.md`, Task 5 only
- Spec: `docs/superpowers/rag-upgrade/local/specs/2026-08-20-rag-answer-and-australian-sources-design.md`
- Implementation model/effort: `gpt-5.6-sol` / `high`
- Review model/effort: `gpt-5.6-sol` / `xhigh`
- Environment/authority: `offline-source-only` / `local-code-migrations-not-applied`

## Outcome

Resolve one immutable request-local RAG context snapshot before cache lookup and bind every eligible public/shared search, answer-cache, and coalescing identity to that exact snapshot. A public site release or change-epoch transition must become a cache miss immediately, without allowing one answer to observe mixed releases. Site-lane staleness must not suppress valid uploaded-document or Australian-source lanes.

## Required scope

Follow every Task 5 step and acceptance condition in the named plan. Planned files are:

- create `src/lib/rag/rag-context-snapshot.ts`;
- modify `src/lib/rag/rag-contracts.ts`;
- modify `src/lib/rag/rag.ts`;
- modify `src/lib/rag/rag-cache.ts`;
- create `tests/rag-site-content-freshness.test.ts`;
- modify `tests/rag-cache-invalidation.test.ts`;
- modify `tests/rag-shared-cache.test.ts`; and
- create `tests/rag-rollout.test.ts` for the snapshot's existing typed programme-mode input without creating rollout authority; and
- use existing `tests/rag-abort-signal.test.ts` only where the contract requires a focused regression.

Reuse the accepted P03/P06 owners `ActiveSiteContentRelease`, `SiteContentPartitionSnapshot`, `assertSiteContentPartitionSnapshot`, `siteContentPendingLogicalIdsDigest`, source-policy versioning, document-index generation, and typed programme rollout mode. Do not create a second release, freshness, rollout, pending-set, retrieval-lane, or cache owner. Keep `src/lib/rag/rag.ts` at or below its protected 4,362-line ceiling by extracting snapshot behavior into the new module.

## Non-negotiable behavior

- Resolve `{ documentIndexGeneration, sourcePolicyVersion, activeSiteRelease, publicChangeEpoch, rolloutVersion }` once before cache lookup and reuse the same frozen snapshot through retrieval, generation, verification, telemetry, and incremental units.
- A matching expected/active static digest plus valid active dynamic/release identity resolves `current`; missing, malformed, staged, rolled-back, or mismatched releases resolve `unavailable` or `stale`, never `current`.
- A valid pending public edit changes epoch/cache identity immediately, resolves `updating`, and carries the exact pending logical-ID exclusion owner. Activation may change release/dynamic identity without changing the static digest.
- Anonymous and authenticated public readers receive the same public snapshot/cache fingerprint. No user/admin identity enters public/shared keys.
- Public/shared keys differ across registry, static, dynamic, release, epoch, source-policy, document-index generation, and programme rollout changes. Legacy keys remain byte-compatible when the site component is off.
- Consume the existing `RagProgrammeMode` as an opaque `rolloutVersion` snapshot input. Do not create rollout decisions, flags, cohorts, namespaces, or environment ownership; those remain assigned to the later rollout phase.
- A stale/unavailable site component removes only `clinical_kb_site`; it does not suppress valid uploaded/Australian retrieval, trigger unrestricted web search, alter administrator permissions, or reuse a prior site-backed answer.
- No raw release ID/digest, change epoch, route, content, source-lineage identity, administrator/user ID, or provider error may appear in client payloads or telemetry.
- Do not implement the later site-aware retrieval/RPC/domain-hint lane here. Task 5 hands the immutable snapshot to existing retrieval boundaries only.

## TDD and verification contract

First add the Task 5 request-snapshot/cache matrix, then run the literal RED selector exactly once:

```text
node scripts/run-vitest.mjs run tests/rag-site-content-freshness.test.ts tests/rag-cache-invalidation.test.ts tests/rag-shared-cache.test.ts tests/rag-rollout.test.ts tests/rag-abort-signal.test.ts
```

RED expectation: after adding request-local snapshot and cache-identity assertions and before implementation, fail because a question can observe mixed releases or reuse a stale cross-release answer.

After implementation, run the identical selector exactly once and require it to pass. Run `npm run arbiter -- typecheck` before the distinct compilation check and follow its verdict accurately. Run `npm run check:maintainability-budgets` and `git diff --check TASK_BASE..TASK_HEAD`. Do not run full Vitest, build, browser, hosted, provider, release, deployment, live database, or document/corpus-processing gates, and do not repeat an unchanged successful check.

## Safety boundary

Do not fetch, read, parse, OCR, upload, embed, enqueue, reindex, activate, withdraw, or otherwise process any document or corpus. Do not access the network, provider APIs, Supabase/database/Storage, hosted CI, or deployment state. Do not apply migrations. Do not push, open a PR, or deploy. Local task-scoped source/test commits are authorized by this SDD workflow. Synthetic metadata and fixture-only strings are allowed; no real content is.

## Handoff

Make coherent local product/test commits only. Leave this brief, the implementer report, review packages/reports, receipt, `.local/`, and `.superpowers/` untracked and unstaged for the controller's later atomic P06 phase-acceptance commit. Write the implementer report to `docs/superpowers/rag-upgrade/execution-artifacts/rag-answer-quality-and-repository-coverage-v1/P06/P06-repository-content-task-5-implementer-report.md`, recording literal RED/GREEN evidence, exact commits/files/checks, residual live gates, and confirmation that no documents or live systems were touched.
