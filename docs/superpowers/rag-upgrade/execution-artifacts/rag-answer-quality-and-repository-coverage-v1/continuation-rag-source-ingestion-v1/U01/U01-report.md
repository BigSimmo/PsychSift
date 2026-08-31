# U01 implementation report

## Candidate

- Task base: `d38dce7ba7fada4ab1fb4588799f400916118c81`
- Candidate head/commit: `9a3b3dc4deee971bb287c979e786c6890922aa05`
- Commit subject: `fix(ingestion): retire duplicate processor`
- Worktree: `C:\Users\joshs\.codex\worktrees\rag-local-build-20260822\Database`

## RED evidence

Command (run after adding the focused tests and before production edits):

```text
node scripts/run-vitest.mjs run tests/ingestion-edge-function-auth.test.ts tests/indexing-v3-agent.test.ts tests/worker-run-loop.test.ts tests/worker-row-contract.test.ts tests/supabase-schema.test.ts
```

Expected outcome: exit 1; 4 test files failed and 1 passed, with 5 failed tests, 1 failed suite, and 114 existing tests passing.

The failures were the intended missing behaviors, not setup errors:

- `tests/indexing-v3-agent.test.ts` could not load `../supabase/functions/_shared/ingestion-generation-visibility`; the new shared generation-authority module did not yet exist.
- `expect(existsSync(.../ingestion-worker/index.ts)).toBe(false)` and the paired `auth.ts` assertion received `true`; the duplicate Edge processor was still present.
- `expect(existsSync(migrationPath)).toBe(true)` received `false`; the forward retirement migration did not yet exist.
- `runEdgeJobBatch is not a function`; the pure per-job Edge batch isolation helper had not yet been implemented/exported.
- `expect(schema).not.toContain("FUNCTION public.invoke_ingestion_worker")` failed; the current schema snapshot still exposed the invoker.
- The strict-generation migration assertion could not read `20260831100000_retire_ingestion_worker.sql`; that new current-state gate definition was intentionally absent at RED.

Dependencies were installed and the runner executed 114 existing tests successfully, so module/test setup was working. Each failure directly identified a U01 behavior that had not yet been implemented.

## Implementation outcome

- Added a shared fail-closed authority builder/predicate. The transitional committed set is exactly the validated active `documents.index_generation_id` set; missing, malformed, incomplete, duplicate, unexpected, typed/raw-mismatched, or ambiguous legacy authority is rejected.
- Loaded complete claimed-document authority before artifact work and applied the generation predicate in SQL before ordering, limits, and counts. TypeScript post-filtering remains an additional boundary.
- Propagated the same generation to all generated summaries, labels, sections, cards, index units, and embedding fields. Positive legacy writes omit generation authority.
- Preserved protected-source preflight as the first `processJob` operation, before provider or artifact work.
- Added a pure Edge batch runner whose per-job outer isolation survives both processing and nested failure-recorder errors.
- Retired only the duplicate `ingestion-worker` Edge processor/config registration and current `invoke_ingestion_worker(integer)` surface. Historical migrations were not edited.
- Updated the strict-gate current schema/view so counts admit exact active-generation artifacts or positive legacy rows only.
- Documented single-processor deployment and truthful forward-only rollback. Deferred drift-manifest reconciliation and hosted cron inspection to their assigned later boundaries.

## GREEN and focused static evidence

- `node scripts/run-vitest.mjs run tests/ingestion-edge-function-auth.test.ts tests/indexing-v3-agent.test.ts tests/worker-run-loop.test.ts tests/worker-row-contract.test.ts tests/supabase-schema.test.ts` — final exit 0; 5 files passed, 149 tests passed, duration 1.30s.
- `npm run check:edge:functions` — initial run found 6 TypeScript narrowing errors in generation-filtered section rows; the predicate type was corrected. Final exit 0, checking `indexing-v3-agent` and `site-content-sync`. The command's incidental `deno.lock` rewrite was restored exactly to HEAD and is not in the candidate.
- `npm run check:migration-role` — exit 0: `Hosted migration-role guard passed: active hosted SQL/tooling uses postgres and immutable applied history is unchanged.`
- `npm run check:function-grants` — exit 0: all 62 `SECURITY DEFINER` public functions were revoked from `PUBLIC`, and none were reopened to `PUBLIC`, `anon`, or `authenticated` by a later migration.
- `npm run check:dead-code-candidate -- --diff d38dce7ba7fada4ab1fb4588799f400916118c81` — exit 0 with no refusal or warning after its self-test.
- Targeted Prettier formatting/checking was run over owned TypeScript, tests, and documentation; final owned files were formatted.
- `git diff --cached --check` before commit and `git diff --check` before staging — exit 0.

No broad, live-provider, hosted, migration-apply, deployment, or document-processing gate was run because U01 requires focused offline evidence and expressly prohibits those actions.

## Changed and deleted files

- Added `docs/superpowers/rag-upgrade/execution-artifacts/rag-answer-quality-and-repository-coverage-v1/continuation-rag-source-ingestion-v1/U01/U01-brief.md` unchanged as the candidate checkpoint.
- Modified `docs/worker-deploy-runbook.md`.
- Modified `src/lib/supabase/database.types.ts`.
- Modified `supabase/config.toml`.
- Added `supabase/functions/_shared/ingestion-generation-visibility.ts`.
- Modified `supabase/functions/indexing-v3-agent/behavior.ts`.
- Modified `supabase/functions/indexing-v3-agent/index.ts`.
- Modified `supabase/functions/indexing-v3-agent/utils.ts`.
- Deleted `supabase/functions/ingestion-worker/auth.ts`.
- Deleted `supabase/functions/ingestion-worker/index.ts`.
- Added `supabase/migrations/20260831100000_retire_ingestion_worker.sql`.
- Modified `supabase/schema.sql`.
- Modified `tests/indexing-v3-agent.test.ts`.
- Modified `tests/ingestion-edge-function-auth.test.ts`.
- Modified `tests/supabase-schema.test.ts`.
- Modified `tests/worker-run-loop.test.ts`.

This report was written after the product candidate commit and is intentionally not part of that commit.

## Migration, grants, rollback, and compatibility

- The forward migration first revokes `invoke_ingestion_worker(integer)` execution from `PUBLIC`, `anon`, `authenticated`, and `service_role`, then drops that function. It does not alter applied migration history.
- The strict view remains service-role-only; the migration revokes broad access and grants `SELECT` only to `service_role`. Static migration-role and function-grant gates passed.
- Rollback is not a redeploy of deleted duplicate Edge code. Reinstating the retired surface would require a reviewed forward migration and an explicit operational decision; the runbook says so.
- Existing positive legacy rows remain compatible only where the document has both typed null authority and no raw metadata generation key. Active documents accept only artifacts matching the exact validated active UUID.
- `supabase/drift-manifest.json` remains intentionally unchanged until the stable C01/C02 tranche boundary. Possible untracked hosted `pg_cron` scheduling is an inspection/cleanup concern assigned to C07, not U01.
- No migration was applied locally or hosted, so database execution behavior remains supported by offline schema/static tests rather than live migration evidence.

## Self-review and concerns

- Reviewed all owned diffs for scope, protected-source ordering, generation predicate ordering, uniform writes, grant safety, data preservation, rollback truth, test meaning, and stray/generated output.
- Only explicit owned paths were staged. Pre-existing untracked P06/P07/P08A and `.superpowers` work was preserved.
- The first commit attempt was stopped by `docs:check-index` for pre-existing, out-of-scope `.superpowers` and site-content index entries. No generated files changed. The successful retry used the repository hook's documented one-shot `SKIP_DOCS_SYNC_HOOK=1`; `docs/codebase-index.md` was not broadened into U01.
- Residual concern: the new migration and hosted scheduler retirement have no live proof in U01 by design. Migration apply remains separately authorized, and hosted cron discovery/cleanup remains C07-only.

## Attestation

No documents or corpora were processed; no provider, hosted Supabase, Storage, scanner, or model asset was accessed; no migration was applied; no deployment, reindex, push, or pull request occurred; no historical migration or drift manifest was edited; and no later continuation task was started.
