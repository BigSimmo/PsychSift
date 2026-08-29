# P06 Repository Content Task 3 Implementer Brief

## Immutable execution identity

- Programme: `rag-answer-quality-and-repository-coverage-v1`
- Phase: `P06` - Durable public site synchronization and request snapshots
- Global task key: `P06/repositoryContent/task-3`
- Task base: `1788f3d95c88b4df65d3e13ddc6e5a7b186e8a07`
- Plan: `docs/superpowers/rag-upgrade/local/plans/2026-08-21-rag-repository-content-sync.md`, Task 3 only
- Spec: `docs/superpowers/rag-upgrade/local/specs/2026-08-20-rag-answer-and-australian-sources-design.md`
- Implementation model/effort: `gpt-5.6-sol` / `high`
- Environment/authority: `offline-source-only` / `local-code-migrations-not-applied`

## Outcome

Replace optional best-effort site-record refresh with a durable, administrator-only publication/outbox contract and one bounded lease-fenced synchronizer. Implement deterministic changed-only staging, verified unchanged-embedding reuse, deletion tombstones, candidate release receipts, initial legacy-row reconciliation, and atomic activation/rollback contracts without applying migrations or contacting any provider or live system.

## Required scope

Follow every Task 3 step and acceptance condition in the named plan. The expected owner set includes:

- `src/lib/site-content/site-content-sync.ts`
- `scripts/sync-site-content-corpus.ts`
- the four existing public site-record detail/collection routes named by the plan
- `src/lib/registry-corpus.ts`
- `supabase/functions/site-content-sync/index.ts`
- `supabase/config.toml`
- one new forward-only migration whose timestamp is strictly later than every migration already present at task start
- `src/lib/supabase/database.types.ts`
- the Task 3 test owners named by the plan and verification matrix

Use existing P03 site-content contracts/manifests and P05 recovery, lifecycle, cache-authority, and activation-receipt owners. Do not create a second recovery policy or duplicate their authority seams.

## Non-negotiable behavior

- Published `clinical_kb_site` reads are identical for anonymous, authenticated, and administrator readers; actor/legacy `owner_id` is audit-only.
- Every mutation/publication path is administrator-only. Direct anon/authenticated writes remain revoked and service-role SQL/RPC boundaries are least privilege with fixed search paths.
- Publication atomically commits the public record, monotonic change epoch, exact pending-record exclusion, and durable outbox event. It never calls an embedding provider inline.
- One named worker claims a bounded batch with canonical row locks, attempt/lease/generation fencing, heartbeat/retry/quarantine, content-free logs, and ownership-checked completion.
- Staging is dry-run by default, digest/count/target bound, resumable, changed-only, carries forward only verified byte/model/dimension-compatible embeddings, tombstones deletions, and cannot activate a partial or mismatched population.
- Initial legacy adoption is provider-free and fail-closed on divergent duplicates until an explicit administrator disposition is represented.
- Activation and rollback reuse P05 recovery-evidence/receipt contracts, keep the prior release intact, and cannot claim live readiness.
- Keep `src/lib/rag/rag.ts` untouched at or below 4,362 lines.

## TDD and verification contract

First add the Task 3 assertions, then run the literal RED selector:

```text
node scripts/run-vitest.mjs run tests/site-content-sync.test.ts tests/site-content-sync-worker.test.ts tests/site-content-publication-access.test.ts tests/registry-records-route.test.ts tests/medications-route.test.ts tests/differentials-route.test.ts tests/registry-corpus.test.ts tests/function-grants.test.ts tests/supabase-schema.test.ts tests/ingestion-mutation-safety.test.ts tests/reindex-pipeline.test.ts
```

RED expectation: after adding durable outbox, public-reader parity, and admin-only mutation assertions and before implementation, fail because synchronization is best-effort or reader results vary by identity.

After implementation, the identical focused command must pass. Also run the provider-free dry-run required by the plan, migration-role/grant/static checks implicated by the diff, `npm run typecheck`, the maintainability budget, and `git diff --check TASK_BASE..TASK_HEAD`. Do not stack broader gates that cover no distinct changed failure class.

## Safety boundary

Do not fetch, read, parse, OCR, upload, embed, enqueue, reindex, activate, withdraw, or otherwise process any document or corpus. Do not access the network, provider APIs, Supabase/database/Storage, hosted CI, or deployment state. Do not apply migrations. Do not commit, push, open a PR, or deploy except for local task-scoped source/test commits explicitly required by the SDD workflow. Synthetic metadata and fixture-only strings are allowed; no real content is.

## Handoff

Make coherent local product/test commits only. Leave this brief, the implementer report, review packages/reports, receipt, and `.superpowers/` untracked and unstaged for the controller's later atomic phase-acceptance commit. Write the implementer report to `docs/superpowers/rag-upgrade/execution-artifacts/rag-answer-quality-and-repository-coverage-v1/P06/P06-repository-content-task-3-implementer-report.md`, recording RED/GREEN evidence, exact commits, files, checks, residual live gates, and confirmation that no documents or live systems were touched.
