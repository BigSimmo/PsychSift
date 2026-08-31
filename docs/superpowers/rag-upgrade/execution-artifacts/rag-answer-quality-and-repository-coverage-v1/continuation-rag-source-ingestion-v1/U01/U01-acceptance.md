# U01 acceptance record

## Range and identities

- Unit: `U01` / Task 1 / retire duplicate processor and enforce committed-generation reads
- Original task base: `d38dce7ba7fada4ab1fb4588799f400916118c81`
- Original candidate: `9a3b3dc4deee971bb287c979e786c6890922aa05`
- Correction checkpoint base: `d187915b73c98aefd146749f41b354c4d8e4ee8e`
- Accepted product head: `5895e5da45b96d0d90a42c32856cb25f2026bf36`
- Implementer: `/root/u01_implementer`
- Worker/generation reviewer: `/root/u01_worker_review_xhigh`
- Schema/migration reviewer: `/root/u01_schema_review_xhigh`

## Immutable packages

- Original package: `U01-review.diff`
- Original package SHA-256: `0289A6B08737F5435B39DC5638332B49140BA93E29B7AAF2469ED148F41A919D`
- Correction package: `U01-fix-1-review.diff`
- Correction package range: `d187915b73c98aefd146749f41b354c4d8e4ee8e..5895e5da45b96d0d90a42c32856cb25f2026bf36`
- Correction package SHA-256: `748822B177E5E12F7981254BA8F560551A531D3DA8CD6C7493B021F53EACF636`

## Review history

The first independent review round returned specification `FAIL` and task quality `FAIL`.

- Worker/generation review: no Critical findings; two Important findings. Positive-legacy generated-label conflicts could retain an existing stale or malformed `index_generation_id`, preventing strict-gate convergence. The broad source-string tests did not bind every required SQL predicate or generated-artifact write.
- Schema/migration review: no Critical findings; one Important finding matching the ineffective per-statement SQL proof; one Minor finding that unguarded `JSON.stringify` could escape the per-job catch for cyclic or bigint-containing thrown values and abort later siblings.

Correction loop 1 used strict test-first development. Its valid RED reproduced the legacy-label conflict and cyclic-error escape with 2 failed tests and 38 passing tests. The correction then removed previous generation authority before label-conflict replacement, made thrown-value conversion non-throwing, and replaced broad source windows with statement-specific read, write, conflict, and mutation contracts.

The final independent re-review round returned:

- `/root/u01_worker_review_xhigh`: specification `PASS`; task quality `PASS`; no Critical, Important, or Minor findings.
- `/root/u01_schema_review_xhigh`: specification `PASS`; task quality `PASS`; no Critical, Important, or Minor findings.

Both reviewers verified the correction package hash and declared range. They did not rerun the implementer's reported suites. RED/GREEN chronology, connected migration execution, and hosted schedule state are not proven by the immutable diffs.

## Verification evidence

- Correction RED: `node scripts/run-vitest.mjs run tests/indexing-v3-agent.test.ts tests/worker-run-loop.test.ts` — exit 1; 2 failed tests, 38 passed, for the two expected missing behaviors.
- Correction GREEN: same command — exit 0; 40 tests passed.
- Final U01 focused gate: `node scripts/run-vitest.mjs run tests/ingestion-edge-function-auth.test.ts tests/indexing-v3-agent.test.ts tests/worker-run-loop.test.ts tests/worker-row-contract.test.ts tests/supabase-schema.test.ts` — exit 0; 151 tests passed.
- `npm run check:edge:functions` — passed.
- `npm run check:migration-role` — passed.
- `npm run check:function-grants` — passed.
- Targeted formatting and diff checks — passed.

## Acceptance and residuals

U01 is accepted locally at product head `5895e5da45b96d0d90a42c32856cb25f2026bf36`. U02 has not started.

Hosted migration execution and discovery or cleanup of a possible hosted `pg_cron` invocation remain deliberately unverified and reserved for the separately authorized C07 boundary. No document or corpus processing, provider access, hosted Supabase or Storage access, migration apply, deployment, reindex, push, or pull request occurred.
