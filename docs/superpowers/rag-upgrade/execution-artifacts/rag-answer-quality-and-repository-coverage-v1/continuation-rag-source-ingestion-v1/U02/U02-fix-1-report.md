# U02 correction loop 1 report

## Candidate

- Original U02 task base: `08df4cddce457ba016b0d31fcf7202a4b564776a`
- Original reviewed candidate: `4621b3000a05cd88494f4b87d807c8761d7f862f`
- Correction checkpoint base: `b68a8de1476d08ec46a72f86f10d65428b1f7a11`
- Final correction head/commit: `6adb834e48b3c1af4579ef22738d942803ab6893`
- Commit subject: `fix(ingestion): close U02 review gaps`
- Worktree: `C:\Users\joshs\.codex\worktrees\rag-local-build-20260822\Database`

The original strict RED receipt remains immutable: the exact four-file selector exited 1 with 22 intended failures and 62 existing passes before the original U02 production edits.

## Correction RED history

Every correction began with focused test-only changes and the same exact selector:

```text
node scripts/run-vitest.mjs run tests/indexing-v3-agent.test.ts tests/document-enrichment.test.ts tests/worker-shadow-extraction.test.ts tests/check-indexing-contract.test.ts
```

- Initial correction RED: exit 1; all 4 files failed; 11 tests failed and 85 passed. The intended failures covered strict primitive numbers, exact fallback projection, Unicode code-point boundaries, complete Node/Edge projection currentness, independent Edge model authority, marker ordering, live worker authority reload, enrichment-owned metadata patching, connected-script preflight ordering, and provisional zero-label Edge fallback deferral.
- Metadata-retry review RED: exit 1; 1 file failed and 3 passed; 1 test failed and 96 passed. It proved that a failed final document-metadata RPC was not retried after summary and label completion.
- Concurrent-organization review RED: exit 1; 1 file failed and 3 passed; 2 tests failed and 96 passed. It proved that stale organization projections could either remain unhealed or overwrite newer manual authority depending on the path.
- Final ownership-boundary RED: exit 1; 1 file failed and 3 passed; 1 test failed and 97 passed. A `manual_override` injected after the last metadata read and immediately before the generic deep-merge RPC was overwritten, proving the remaining read-then-write race.

All RED runs loaded the runner and retained passing focused tests. None was a setup or coordinator failure.

## Implementation

- Shared validation rejects string-coerced pages and label confidence, enforces the exact first-selected-chunk or otherwise first-image fallback projection, and uses Unicode code-point-safe label boundaries including astral letters and numbers.
- Node and Edge currentness compare every persisted summary projection. Valid stored-payload projection drift repairs without another provider call, and completion is false before label repair.
- Edge obtains structured-model authority independently from stored candidate data. Its zero-label deterministic fallback remains provisional, so the unchanged completion gate defers it.
- Worker enrichment rereads live typed/raw generation and P05 policy metadata after generation commit, requires exact equality, and passes that live document onward.
- Connected enrichment/backfill scripts load exact-generation evidence and complete local P05 preflight before metadata stamping. They were not executed.
- Node summary and label completion retries the complete U02-owned metadata stamp without another provider call.
- The U02 document metadata patch now contains only `rag_enrichment_version`, `rag_indexing_version`, `rag_memory_version`, `rag_enrichment_updated_at`, and `generated_label_count`. `organization_profile` and `organization_profile_version` are outside U02 ownership and remain with their dedicated organization owner. Excluding them prevents both automatic-profile loss on retry and concurrent human-authority overwrite without a schema or RPC change.

## GREEN and required gates

- Final exact four-file selector: exit 0; 4 files passed; 98 tests passed.
- `npm run check:edge:functions`: exit 0. Its transient `deno.lock` rewrite was restored exactly and is absent from the correction commit.
- `npm run eval:rag:offline`: exit 1. Fixture and manifest validation passed for 36 golden cases, 26 suites, and 29 programme cases. The test phase reproduced the authorized exception exactly: the same four Answer/search suites failed; the isolated subset remained 45 failed and 56 passed; the overall run was 4 failed and 22 passed suites with 45 failed and 586 passed tests.

The offline result is an accepted U02 exception, not a green gate. No changed assertion, count, suite, or U02 path appeared.

## Final reviews

- `/root/u02_ingestion_review_2`: no P0-P3 findings; specification `PASS`; task quality `PASS`.
- `/root/u02_clinical_review_2`: no P0-P3 findings; specification `PASS`; task quality `PASS`.

Both reviews were read-only static reviews of `b68a8de1476d08ec46a72f86f10d65428b1f7a11..6adb834e48b3c1af4579ef22738d942803ab6893`. They did not rerun tests or exercise providers, connected scripts, or a database runtime.

## Changed files

The correction range contains exactly:

- `scripts/backfill-smart-index.ts`
- `scripts/enrich-documents.ts`
- `src/lib/document-enrichment.ts`
- `supabase/functions/_shared/source-anchored-summary.ts`
- `supabase/functions/indexing-v3-agent/index.ts`
- `tests/check-indexing-contract.test.ts`
- `tests/document-enrichment.test.ts`
- `tests/indexing-v3-agent.test.ts`
- `tests/worker-shadow-extraction.test.ts`
- `worker/main.ts`

## Residuals and scope attestation

Evidence is static and local only. Runtime database concurrency and provider parity remain unproven. Edge fallback remains intentionally provisional and deferred.

No schema, RPC, migration, ordinary Answer/search, or P08A file changed. No provider, hosted Supabase, API, connected script, migration apply, deployment, reindex, production-readiness check, push, or pull request occurred. Unrelated untracked files were preserved.
