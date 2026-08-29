# P06 Repository Content Task 4 Implementer Report

## Execution identity

- Global task key: `P06/repositoryContent/task-4`
- Task base: `aed1c5eec5ef7d276b16b8a9226f1ff5080a749b`
- Task head: `0ee8c09681a49b7891f99d4c3d33f426611ffd78`
- Environment/authority: offline source only; local code; migrations not applied
- Brief SHA-256 verified before work: `203d8e8d6e1e0ce69a9c1e827bf1d09184e8bd78a091dd61df4d803046620a20`

## Outcome

Task 4 binds the registered static manifest and administrator-published dynamic state to one deterministic, fail-closed health classifier. The implementation:

- reuses `ActiveSiteContentRelease`, `SiteContentPartitionSnapshot`, `assertSiteContentPartitionSnapshot`, `siteContentPendingLogicalIdsDigest`, and the exact pending logical-ID set/digest;
- requires complete release/population/domain integrity, matching runtime static digest and deployment SHA, exact pending-set/epoch parity, and a deployed/fresh synchronizer;
- distinguishes `current`, valid dynamic `updating`, and promotion-stopping `failure` states;
- caps public queue counts/age and exposes only the approved release-health projection, never internal digests, epochs, content, routes, actor IDs, or provider errors;
- adds an offline-only evidence CLI that rejects live mode; and
- adds a narrow `site_content_changed` CI signal whose selected job builds the provider-free manifest and runs domain-fixture tests without staging, synchronization, provider access, or a full re-index.

## Commits

1. `9d5daed3e` — `test(site-content): define release freshness contract`
2. `ac7118f83` — `feat(site-content): enforce release freshness health`
3. `e6890743d` — `fix(site-content): enforce runtime release freshness`
4. `c68b238e7` — `feat(site-content): add request-time runtime authority`
5. `ed9cfc2f3` — `fix(site-content): bind runtime governance evidence`
6. `0ee8c0968` — `fix(site-content): close runtime readiness gaps`

## Changed product/test files

- `.github/workflows/ci.yml`
- `scripts/ci-change-scope.mjs`
- `scripts/check-site-content-freshness.ts`
- `src/app/api/health/route.ts`
- `src/app/api/health/ready/route.ts`
- `src/lib/health-response.ts`
- `tests/site-content-freshness-workflow.test.ts`
- `tests/site-content-health.test.ts`
- `tests/ci-scope-contract.test.ts`
- `tests/fixtures/site-content/release-evidence-current.json`
- `tests/health-route.test.ts`

No other tracked file changed. `src/lib/rag/rag.ts` remains untouched at 4,362 lines.

## Literal TDD evidence

### RED

Command, run once after test admission and exact-lock offline dependency restoration:

```text
node scripts/run-vitest.mjs run tests/site-content-freshness-workflow.test.ts tests/site-content-health.test.ts tests/ci-scope-contract.test.ts
```

Decisive result: exit `1`.

```text
Test Files  3 failed (3)
Tests  40 failed | 1 passed (41)
```

Decisive failures:

```text
TypeError: classifySiteContentHealth is not a function
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../scripts/check-site-content-freshness.ts'
AssertionError: expected undefined to be true
```

Two earlier selector starts were rejected before Vitest launch by the repository coordinator (active build, then Playwright), and one later start exited before Vitest because this worktree's `node_modules` lacked Vitest. Those were admission/environment failures, not RED executions. The official worktree setup was then run cache-only with `npm_config_offline=true`; it restored 755 exact-lock packages and passed installed-lock parity without network access.

### GREEN

The identical selector was run once after implementation.

Decisive result: exit `0`.

```text
Test Files  3 passed (3)
Tests  41 passed (41)
Duration  5.46s
```

## Other exact checks

- `npm run arbiter -- typecheck` — `RUN "typecheck" — db scope never defers`.
- `npm run typecheck` — exit `0`; no TypeScript diagnostics.
- `npm run check:maintainability-budgets` — PASS; decisive lines included `src/lib/rag/rag.ts: 4362/4362 lines` and `Maintainability hotspot budgets passed.`
- `git diff --check aed1c5eec5ef7d276b16b8a9226f1ff5080a749b..ac7118f8325bf80dc0cb79500d6f9e1399bbd882` — exit `0`; no output.

## Review 1 correction

Review 1 reported `SPEC_VERDICT: FAIL` and `QUALITY_VERDICT: FAIL` at
`ac7118f8325bf80dc0cb79500d6f9e1399bbd882`. The bounded correction was implemented on top of that head:

- both real health routes now read the server-only `SITE_CONTENT_HEALTH_EVIDENCE_JSON` artifact and always pass its parsed value, including `undefined`, into the shared classifier, so missing/malformed/stale evidence returns a bounded `siteContent` failure projection and `503`;
- route-level mocked/offline assertions cover current, updating, missing, invalid, and stale evidence for both `/api/health` and `/api/health/ready`, with no provider fetch;
- a public release ID must have canonical UUID shape and the complete identity must bind the exact `siteContentRegistryVersion` before the ID can be projected;
- release integrity must include the unique complete canonical domain-disposition set and its registry-bound SHA-256 digest, while active domain evidence must be the exact set of eligible producers; omitted, duplicate, unknown, unreviewed, and reviewed-ineligible evidence fails closed;
- the exact pending logical-ID owner and `fnv1a64` digest algorithm remain unchanged; and
- `site_content_changed` now covers app modes, shared types, and the real registry/adapter fixture and snapshot inputs. The provider-free selected CI step runs both manifest and registry coverage tests, while unrelated source/docs controls remain false.

Regression assertions were added before the product corrections. Per the correction contract, the already-recorded original RED and original GREEN were not replayed. The identical three-file Task 4 selector was run exactly once after all corrections:

```text
node scripts/run-vitest.mjs run tests/site-content-freshness-workflow.test.ts tests/site-content-health.test.ts tests/ci-scope-contract.test.ts
```

Decisive result: exit `0`.

```text
Test Files  3 passed (3)
Tests  71 passed (71)
Duration  6.93s
```

Correction checks:

- `npm run arbiter -- typecheck` — `RUN "typecheck" — db scope never defers`.
- `npm run typecheck` — exit `0`; no TypeScript diagnostics; a pass receipt was recorded for 5,837 inputs.
- `npm run check:maintainability-budgets` — PASS; `src/lib/rag/rag.ts: 4362/4362 lines` and `Maintainability hotspot budgets passed.`
- `git diff --check aed1c5eec5ef7d276b16b8a9226f1ff5080a749b..e6890743d0539515252b04ab5c76af590802dc3d` — exit `0`; no output.

The normal pre-commit documentation synchronizer tried to refresh the out-of-scope script inventory for the already-added Task 4 CLI. That generated-only change was reverted, and the correction commit used the hook's documented one-time `SKIP_DOCS_SYNC_HOOK=1` escape to preserve the immutable Task 4 tracked scope. No documentation file was committed.

## Safety confirmation

- No document or corpus was fetched, read, parsed, OCRed, uploaded, embedded, enqueued, reindexed, activated, withdrawn, or otherwise processed.
- No network, provider API, Supabase/database/Storage, hosted CI, or deployment state was accessed.
- No migration was applied.
- No push, pull request, deployment, or production configuration change occurred.
- Test content is synthetic metadata/fixture-only data.
- The Task 4 brief, this report, review artifacts, receipt, `.local/`, `.superpowers/`, and the pre-existing untracked `1/` directory remain untracked and unstaged.

## Residual and unrun gates

Intentionally unrun by the immutable Task 4 brief: full Vitest, build, browser, hosted CI, provider-backed evaluation, Supabase/database/Storage checks, migration replay/application, release, deployment, document/corpus processing, reindex, and Task 5 tests.

Still requires separate authorization and owner evidence: hosted candidate staging, live dynamic publication/outbox behavior, production worker heartbeat/invocation and ten-minute stop telemetry, runtime deployment-SHA/static-manifest parity, live activation within the five-minute SLO, rollback availability/exercise, provider-backed evaluation, migration application, deployment, and production promotion.

## Review 2 runtime-authority correction

Review 2 returned `SPEC_VERDICT: FAIL` and `QUALITY_VERDICT: FAIL` at
`e6890743d0539515252b04ab5c76af590802dc3d`. The controller then authorized the bounded local-code/migration correction described by the read-only schema pass. The corrected task head is `c68b238e7bc759aa89f41018dc505677f695c7d8`.

Correction commit:

1. `c68b238e7` — `feat(site-content): add request-time runtime authority`

The correction:

- adds the unique forward migration `20260827213539_add_site_content_runtime_authority.sql`, after the accepted Task 3 migration and without editing applied history;
- binds every release plan and canonical plan digest to the manifest's full lowercase deployment commit SHA, exposes it as a generated constrained release column, and adds a singleton service-role-only synchronizer state owner;
- adds fixed-empty-search-path service-role-only RPCs for fenced invocation telemetry and one bounded active-release/change-epoch/pending/outbox/synchronizer runtime snapshot;
- records worker `started` before claim, periodic invocation heartbeats, and terminal success/failure including idle invocations, while stopping before work when telemetry cannot be established;
- replaces the environment artifact as real-route authority with a server-only per-request collector using the actual runtime SHA, compiled registry/static-manifest identity, and the canonical runtime RPC snapshot;
- checks database observation time independently against request wall clock, fails unavailable, malformed, future-skewed, stale, failed-worker, deployment-mismatched, and incomplete pending evidence closed, and preserves the exact nine-field HTTP projection;
- reconciles Task 3 and Task 4 objects into `supabase/schema.sql`, generated database types, and the offline drift manifest; the local drift replay now supplies only the platform-owned `auth.jwt()` scaffold needed by the bare Supabase image;
- keeps offline artifact injection limited to the classifier/CLI tests; and
- completes `site_content_changed` parity for `src/lib/differentials.ts`, `src/lib/service-ranker.ts`, and `src/lib/catalog-search.ts`, retaining unrelated negative controls.

The single authorized composite selector was run once after the correction:

```text
node scripts/run-vitest.mjs run tests/site-content-health-authority.test.ts tests/site-content-health.test.ts tests/health-route.test.ts tests/site-content-sync-worker.test.ts tests/site-content-gate-types-parity.test.ts tests/site-content-publication-access.test.ts tests/site-content-manifest.test.ts tests/site-content-freshness-workflow.test.ts tests/function-grants.test.ts tests/supabase-schema.test.ts tests/ci-scope-contract.test.ts
```

Decisive result: exit `0`.

```text
Test Files  11 passed (11)
Tests  215 passed (215)
Duration  15.19s
```

The `check:function-grants: FAIL` lines within that output were expected negative-fixture assertions; the enclosing test file and selector passed.

Correction checks:

- `npm run check:migration-role` — exit `0`; active hosted SQL/tooling uses `postgres` and immutable applied history is unchanged.
- `npm run check:function-grants` — exit `0`; all 60 public `SECURITY DEFINER` functions are revoked from PUBLIC/anon and none are reopened.
- `npm run drift:manifest` — final exit `0`; offline scratch replay completed in 16 seconds and regenerated `supabase/drift-manifest.json`. Earlier local replay attempts exposed and then closed the bare-image `auth.jwt()` scaffold and SQL `extract`/`greatest` parser/type issues; no live project was contacted and no migration was applied.
- `npm run arbiter -- typecheck` — `RUN "typecheck" — db scope never defers`.
- `npm run typecheck` — final exit `0`; pass receipt recorded for 5,870 input files. The first run found only missing deployment-SHA test fixture fields and Vitest mock tuple typing; those were corrected before the passing run.
- `npm run check:maintainability-budgets` — exit `0`; `src/lib/rag/rag.ts: 4362/4362 lines` and `Maintainability hotspot budgets passed.`
- `git diff --check aed1c5eec5ef7d276b16b8a9226f1ff5080a749b..c68b238e7bc759aa89f41018dc505677f695c7d8` — exit `0`; no output.

The original RED, original GREEN, Review 1 selector, and the already-passing composite selector were not rerun. No broad/live/provider gate was run. `check:drift`, hosted CI, live Supabase/database/Storage checks, migration application, worker invocation against a hosted project, document/corpus processing, embeddings, reindex, deployment, push, PR, and Task 5 remain unrun and unauthorized.

## Review 3 governance, authentication, and queue-health correction

Review 3 returned `FAIL` at `c68b238e7bc759aa89f41018dc505677f695c7d8`. The primary review found that the runtime collector still synthesized current/approved governance, the Edge Function gateway JWT setting conflicted with the custom bearer-secret contract, and CI scope omitted `src/lib/registry-records.ts`. The independent schema review additionally found that a completed changed/tombstoned outbox could retain a pending exclusion ID while reporting a null oldest age, causing fail-closed health to classify the legitimate pre-activation interval as invalid instead of `updating`.

The bounded correction at `ed9cfc2f34240ad470b6184b90d6d7657020cf22`:

- binds each governance receipt population entry to a canonical digest of the exact persisted projection identity, payload, governance, publication version, content hash, and lineage digest;
- recomputes and revalidates those projection bindings at publication, gate derivation, governance verification, and activation, with generated digest columns and fail-closed governance constraints;
- derives only bounded per-domain counts/status aggregates from active persisted projections and maps those request-time values without synthesizing governance approvals or exposing content/record identity;
- derives a numeric candidate/operation age after outbox completion and before activation so legitimate pending state remains `updating` until the SLO/stop boundary;
- aligns `supabase/config.toml` with the custom bearer-secret contract and uses a fixed-work SHA-256 comparison in the worker handler;
- adds `src/lib/registry-records.ts` to the fail-closed site-content CI scope; and
- keeps migration, schema snapshot, generated types, and offline drift manifest in parity.

The first attempt to launch the corrected selector was rejected before Vitest started because the repository coordinator was legitimately owned by another worktree's Chromium gate. No lock was bypassed and that attempt consumed no test execution. After the owner exited, the correction selector ran once:

```text
node scripts/run-vitest.mjs run tests/site-content-runtime-governance-sql.test.ts tests/site-content-sync-auth-config.test.ts tests/site-content-health-authority.test.ts tests/site-content-health.test.ts tests/health-route.test.ts tests/site-content-gate-owner-provenance.test.ts tests/site-content-sync-cli.test.ts tests/site-content-sync-worker.test.ts tests/ci-scope-contract.test.ts
```

Decisive result: exit `0`.

```text
Test Files  9 passed (9)
Tests  111 passed (111)
Duration  8.09s
```

Correction checks:

- `npm run check:migration-role` — exit `0`; hosted migration-role guard passed and immutable applied history is unchanged.
- `npm run check:function-grants` — exit `0`; all 63 public `SECURITY DEFINER` functions are revoked from PUBLIC/anon and none are reopened.
- `npm run drift:manifest` — exit `0`; disposable local Postgres replay completed in 24 seconds and regenerated `supabase/drift-manifest.json`; no live project was contacted and no migration was applied.
- `npm run arbiter -- typecheck` — `RUN "typecheck" — db scope never defers`.
- The first `npm run typecheck` found one generic-string versus `SiteContentDomain` boundary in the new runtime snapshot. The snapshot contract was narrowed, then `npm run typecheck` exited `0` and recorded a pass receipt for 5,901 input files.
- After that type-only correction, `node scripts/run-vitest.mjs run tests/site-content-health-authority.test.ts tests/health-route.test.ts tests/site-content-health.test.ts` exited `0`: 3 files and 52 tests passed in 1.18 seconds.
- `npm run check:maintainability-budgets` — exit `0`; all hotspot budgets passed.
- Focused Prettier checks for all changed supported source/test files — exit `0`.
- `git diff --check aed1c5eec5ef7d276b16b8a9226f1ff5080a749b..ed9cfc2f34240ad470b6184b90d6d7657020cf22` — exit `0`; no output.

The normal pre-commit documentation hook exposed pre-existing generated documentation debt from the earlier Task 4 schema/script additions. Its generated `docs/scripts-index.md` count-only edit was reverted, and the correction commit used the hook's documented one-time `SKIP_DOCS_SYNC_HOOK=1` override so unrelated generated documentation was not absorbed into the bounded correction. The debt remains explicit for the atomic P06 phase metadata/documentation step.

No broad/full/browser/hosted/provider check was run. No corpus or document was fetched, read, parsed, OCRed, uploaded, embedded, enqueued, reindexed, activated, withdrawn, or otherwise processed. No Supabase/database/Storage service, deployment, push, or pull request was touched.

## Review 4 domain, adoption, candidate-age, and secret correction

Independent Review 4 returned `SPEC_VERDICT: FAIL`, `QUALITY_VERDICT: FAIL`, `SCHEMA_VERDICT: FAIL`, and `SECURITY_VERDICT: FAIL` at `ed9cfc2f34240ad470b6184b90d6d7657020cf22`. Both reviewers confirmed all Review 3 findings closed, then identified four new bounded blockers:

1. persisted SQL exposes only the four dynamic release-projection domains while health required all eight eligible dynamic/static domains, so real readiness could never become current;
2. first adoption sent canonical `kind` while the baseline RPC reads `recordKind` into a non-null column;
3. an all-unchanged direct-successor candidate emitted no age and could remain `updating` past the ten-minute stop; and
4. the JWT-disabled worker accepted any matching nonblank custom secret, including weak or service-role-equal configuration.

Three independent high-effort implementers corrected disjoint file sets in parallel, followed by one combined controller verification. The correction at `0ee8c09681a49b7891f99d4c3d33f426611ffd78`:

- adds a compact checked-in static-domain evidence owner bound to the accepted static-manifest identity, with conservative aggregate review/source/validation status for `dsm`, `formulation`, `therapies`, and `tools`;
- extends the provider-free manifest check to recompute and compare that compact evidence, requires the runtime RPC to contain exactly the four eligible dynamic domains, and merges the two owners into the exact eight-domain health set without promoting current review state;
- reports the current accepted static evidence honestly as failure while allowing future reviewed static evidence to reach `current` without changing the collector contract;
- rejects conflicting `kind`/`recordKind`, canonicalizes both outbound names plus the projection digest for adopt and publish, and therefore satisfies both existing SQL entry paths;
- emits a direct-candidate age whenever any direct successor exists, requires that age even when the pending logical-ID set is empty, and stops all-unchanged candidates after 600 seconds;
- enforces a trimmed minimum 32-character invocation secret at handler construction and treats weak or service-role-equal production configuration as unavailable while preserving fixed-work SHA-256 comparison; and
- regenerates the offline drift manifest from the corrected schema.

Independent implementer selectors passed before integration:

- adoption/auth: 3 files, 15 tests passed;
- candidate age: 2 files, 42 tests passed; and
- domain evidence: 2 files, 8 tests passed.

The controller then ran the combined correction selector once:

```text
node scripts/run-vitest.mjs run tests/site-content-health-authority.test.ts tests/site-content-static-domain-evidence.test.ts tests/site-content-health.test.ts tests/site-content-runtime-governance-sql.test.ts tests/site-content-sync-auth-config.test.ts tests/site-content-sync-cli.test.ts tests/site-content-sync-worker.test.ts tests/health-route.test.ts tests/ci-scope-contract.test.ts
```

Decisive result: exit `0`.

```text
Test Files  9 passed (9)
Tests  115 passed (115)
Duration  3.50s
```

After the controller normalized both outbound kind spellings, the directly affected CLI selector passed again: 1 file and 3 tests.

After both independent Review 5 verdicts passed, the literal final Task 4 contract selector was run at exact head `0ee8c09681a49b7891f99d4c3d33f426611ffd78` and exited `0`: 3 files and 81 tests passed in 4.97 seconds. A preceding launch returned no usable process verdict from the local execution wrapper and was treated as incomplete, not as evidence; the reported result is the completed run.

Correction checks:

- `npm run arbiter -- typecheck` — `RUN "typecheck" — db scope never defers`.
- `npm run typecheck` — exit `0`; pass receipt recorded for 5,961 input files.
- `npm run check:migration-role` — exit `0`; immutable applied history is unchanged.
- `npm run check:function-grants` — exit `0`; all 63 public `SECURITY DEFINER` functions remain closed to PUBLIC/anon.
- `npm run drift:manifest` — exit `0`; disposable local Postgres replay completed in 15 seconds, produced schema SHA-256 `e76358de646e9ee16ad8bf820f1b73ea83b4669b466fcfea5655afaa6fe2023a`, and contacted no live service.
- Focused Prettier checks for all changed supported source/test files — exit `0` after formatting two files.
- `git diff --check aed1c5eec5ef7d276b16b8a9226f1ff5080a749b..0ee8c09681a49b7891f99d4c3d33f426611ffd78` — exit `0`; no output.

The full static-manifest test/check was intentionally not run because it builds all repository content through adapters and the controller's explicit boundary forbids corpus/document processing. The new synthetic metadata-only static-domain evidence test covers the aggregation contract locally; CI remains configured to run the provider-free manifest check on an eventual published change.

The same pre-existing Task 4 generated documentation debt remains outside this bounded correction, so the local checkpoint commit used the documented one-time `SKIP_DOCS_SYNC_HOOK=1` override. No documentation or process artifact was included in the tracked commit.

No broad/full/browser/hosted/provider check was run. No corpus or document was fetched, read, parsed, OCRed, uploaded, embedded, enqueued, reindexed, activated, withdrawn, or otherwise processed. No Supabase/database/Storage service, deployment, push, or pull request was touched.
