# P06 Repository Content Task 3 Implementer Report

## Execution identity

- Task: `P06/repositoryContent/task-3`
- TASK_BASE: `1788f3d95c88b4df65d3e13ddc6e5a7b186e8a07`
- TASK_HEAD: `aed1c5eec5ef7d276b16b8a9226f1ff5080a749b`
- Commits:
  - `10aeecc13 feat(rag): add durable site content synchronization`
  - `00ec54523 fix(rag): harden site content release authority`
  - `3c91ff9d6 fix(rag): close site content authority gaps`
  - `746c9578b fix(rag): connect site content evidence authority`
  - `1cf43c060 fix(rag): harden site content release authority`
  - `c197600a5 fix(rag): derive site content gate evidence`
  - `908b7edf2 fix(rag): close site content bootstrap gates`
  - `0ec478c07 fix(rag): unify site content gate clocks`
  - `aed1c5eec fix(rag): separate site content gate clocks`
- Environment: offline source-only; local code and migration source were not applied.

## Outcome

Implemented a forward-only public site-content publication/release authority, transactional outbox, exact pending-record exclusion, lease/generation-fenced bounded worker, deterministic changed-only planner, verified embedding reuse, tombstones, provider-free legacy reconciliation planning, activation/retained-pointer rollback receipts, and an explicit dry-run CLI. Public collection/detail routes now use one canonical reader RPC with a bundled-fixture fallback only while that forward migration is absent; actor-owned legacy rows no longer select reader results. Request-time seed helpers no longer invoke the compatibility best-effort embedding hooks.

The correction commit closes all seven review findings: public records are projected only from the exact active release; candidate completion and activation are exact-release/population atomic and quarantine-blocked; all seven services/forms/medications/differentials routes have anonymous/authenticated/administrator byte-parity proof; SQL validates the accepted P05 receipt identity, digest, project, predecessor, chronology, recovery binding, and retained pointer; the authenticated Deno handler performs periodic fenced heartbeats and concrete changed/reused/tombstone staging; candidate work is durable, idempotent, digest/count/generation bound, resumable after interruption, and verifies exact big-endian float bytes/model/dimensions; the sole server mutation route and JWT-backed SQL authority reject non-administrators without a spoofable flag or direct table grants; and reader fallback is exact `42883` only with malformed/null/error responses failing closed. Generated table, relationship, and function types cover the new authority.

Correction cycle 2 closes the six attempt-2 findings with one executable contract. Candidate operations are persisted by exact logical ID/operation/content hash and active readers anti-join only those identities affected by a successor candidate, hiding stale A immediately while preserving unaffected B until atomic activation. Empty authority now has an administrator/evidence/digest-bound adoption path, and candidate verification flags can change only through the guarded verification transition. The P03 manifest, normalized legacy dispositions, exact operation manifest, recovery digest, canonical plan/release digests, server route, SQL functions, CLI write driver, and worker all share the same plan identity. Exact P05 TypeScript parsers/binders validate every activation and rollback request before signing a short-lived server-to-SQL HMAC binding. A synthetic pure transaction authority and all-seven-route/three-identity state matrix provide executable offline proof without contacting a database or provider.

Correction cycle 3 connects the signer and SQL verifier to one deployable secret boundary. The application secret can be copied into the protected database counterpart only through an administrator-authenticated server action invoking a service-role-only, advisory-locked Supabase Vault provisioning RPC. Initial configuration is write-once; rotation requires the exact predecessor digest and a reason. The SQL verifier reads only the named Vault secret, while offline interoperability tests exercise the same canonical HMAC algorithm and reject missing/wrong keys, tampering, purpose/project/payload drift, and expired bindings. Adoption and verification now accept canonical plans plus independent digest-bound public-visibility, governance, and must-pass artifacts; the server validates exact release subjects and populations before signing, and SQL binds the same subject/artifact digests. The literal `--manifest ... --dry-run` command works from a deterministic empty state, while a guarded bearer transport exposes provision/adopt/begin/resume/publish/verify/activate actions without carrying or printing the validation secret. The offline transaction authority now uses the real signer/verifier rather than `() => true`.

Correction cycle 4 replaces that caller-authored evidence and parallel transaction proof. Adoption and verification now read three immutable, service-role-recorded gate artifacts from fixed public-reader, governance-registry, and RAG-programme owners; the server recomputes exact plan subjects, logical-ID/content-hash populations, receipt hashes, the repository fixture fingerprint and all 29 expected case IDs, strict canonical timestamps, five-minute freshness, and gate chronology before it can sign. SQL requires those exact stored artifact bytes before setting verification flags. The CLI bearer validated at the route is retained on the same user-context Supabase RPC client, so `auth.uid()` and administrator JWT claims reach every SQL mutation. The test-only transition authority was removed and replaced by route/RPC/migration source-contract proof. Every signed transition has a random UUID binding identity, and SQL validates then inserts it transactionally into a primary-keyed consumption table; replay fails, while a newly signed binding is the explicit safe retry mechanism.

Correction cycle 5 removes the remaining generic provenance recorder. Governance evidence is now produced only by a fixed application owner that recomputes the P03 manifest, exact planned population, legacy dispositions, and release subjects before signing with its dedicated owner secret. Must-pass evidence is produced only by a second fixed owner that parses the canonical repository fixture and compares actual baseline/candidate run outputs through the real RAG programme comparator; callers cannot supply pass booleans, case digests, or observation timestamps. The administrator route sends those narrow signed owner receipts to one SQL derivation authority. SQL independently reads the candidate release, exact persisted operations/projections, plan identities, required populations, repository fixture fingerprint and the two distinct Vault secrets, derives public-visibility evidence from database projection state at database time, and inserts all three immutable artifacts transactionally. The service role has no generic recorder and cannot call the derivation authority directly. Adoption uses the same derived path before activation, so arbitrary JSON can no longer become trusted authority. Generated types now require `observed_at` exactly and no longer invent a release relationship absent from the migration.

Correction cycle 6 makes the remaining bootstrap and policy boundaries executable. Three fixed-purpose, service-role-only Vault RPCs now provision or rotate the recovery, governance-owner, and RAG-programme-owner secrets. The administrator-authenticated route selects only those fixed RPCs from server configuration; application validation requires all three configured values to be pairwise distinct, while SQL serializes all three authorities on one advisory lock and rejects a new digest matching either cross-purpose Vault secret. Initial provisioning is write-once, rotation requires the exact predecessor digest plus a reason, raw secrets are never returned, and no generic name/value writer exists. Verification captures its validation clock only after SQL derivation and immutable artifact read, so the first valid attempt accepts the database-owned public observation while retaining strict future/stale rejection and exact validation binding. The literal `--plan-write` CLI mode creates an exact non-mutating write plan; guarded adoption recomputes it from the same manifest/state, requires byte-equivalent canonical plan input, loads the two fixed receipts, and submits that exact subject without a caller-edited digest shortcut. Must-pass receipts now bind the exact versioned `ragProgrammeGatePolicy` digest separately from the canonical GO decision/output digest, and both identities are enforced by the owner verifier, SQL authority, and release verifier.

Correction cycle 7 unifies the final SQL/application temporal contract. The derivation transaction captures one database verification clock, rejects owner observations later than that clock, accepts the exact five-minute edge and rejects anything one millisecond older with the same TypeScript semantics, and enforces recovery-to-governance-to-must-pass-to-public chronology before the first immutable insert. Malformed/null timestamps and MACs fail closed. Existing three-row sets are returned only after current freshness, owner HMAC, exact subject/output/artifact/column, policy, decision, population, and chronology revalidation; no compensating delete path exists. Derivation returns the authoritative database clock, which the route uses for both artifact verification and the signed verification binding, so response delay cannot create a second clock decision. Every rejected future/stale/chronology request raises before any insert, leaving zero rows for a newly signed valid retry.

Correction cycle 8 separates immutable evidence derivation time from transition-binding issuance. SQL normalizes its database-owned derivation clock to exact milliseconds before owner receipt comparisons, immutable inserts, HMAC-window validation, and response formatting. A previously derived exact three-row set is revalidated against its stored public derivation clock rather than later wall-clock age, preserving the historical attestation without widening its original five-minute evidence window. After the route reads and revalidates those rows, it captures a fresh issuance time and creates the final one-use validation binding at that time. The SQL transition continues to consume that fresh binding against current database time while exact-matching all three stored artifact identities and digests. Source-contract proof now uses the production binding verifier and demonstrates a delayed first transition plus a later retry both remain recoverable with new bindings, while future, exact-edge, one-millisecond-stale, and hidden-microsecond cases retain fail-closed parity.

## Correction cycle 8 RED evidence

Command:

`GATE_RECEIPTS=off node scripts/run-vitest.mjs run tests/site-content-gate-derivation-temporal-authority.test.ts tests/site-content-publication-route.test.ts tests/site-content-release-gate-verifiers.test.ts`

Result before correction: exit 1; 2 failed files; 3 failed and 14 passing tests. The failures identified the missing shared millisecond-precision contract, absent SQL clock normalization, wall-clock freshness revalidation of immutable rows, and a final validation binding issued at the historical derivation time rather than the current post-read time.

## Correction cycle 8 GREEN and check evidence

- Identical three-file RED selector: exit 0; 3 files and 17 tests passed, including the production binding-verifier delayed-first-call and new-binding retry proof.
- Focused publication-route selector after the test-only RPC tuple type correction: exit 0; 1 file and 12 tests passed.
- Fresh `npm run typecheck`: exit 0 against 4,765 input files. The first run found only the focused test mock's tuple inference mismatch; the callback signature was corrected before the passing run.
- `npm run check:function-grants`: exit 0; all 34 checked schema functions remain revoked from PUBLIC/anon.
- `npm run check:migration-role`: exit 0; immutable applied migration history remained unchanged.
- `npm run check:maintainability-budgets`: exit 0; every hotspot passed and `src/lib/rag/rag.ts` remained exactly 4,362/4,362 lines.
- Migration ordering check: `20260824130000_add_site_content_release_and_outbox.sql` remains strictly later than `20260824123000`, the next-latest migration.
- Scoped Prettier over every changed TypeScript/test owner, staged/worktree `git diff --check`, and final scoped diff review: exit 0 / clean.
- Provider-free CLI dry-run was not repeated because cycle 8 did not change the planner, CLI, transport, or any provider-facing path.

## Correction cycle 7 RED evidence

Command:

`GATE_RECEIPTS=off node scripts/run-vitest.mjs run tests/site-content-gate-derivation-temporal-authority.test.ts tests/site-content-publication-route.test.ts tests/site-content-release-gate-verifiers.test.ts`

Result before correction: exit 1; 3 failed files; 4 failed and 13 passing tests. The failures identified the absent shared clock/age contract, missing pre-insert SQL chronology and existing-set revalidation, route rejection after response delay, and unavailable exact stale/future boundary parity.

## Correction cycle 7 GREEN and check evidence

- Identical three-file RED selector: exit 0; 3 files and 17 tests passed after the final fail-closed SQL strengthening.
- Fresh `npm run typecheck`: exit 0 against 4,763 input files.
- `npm run check:function-grants`: exit 0; all 34 checked schema functions remain revoked from PUBLIC/anon and the expanded temporal helper remains internal.
- `npm run check:migration-role`: exit 0; immutable applied migration history remained unchanged.
- `npm run check:maintainability-budgets`: exit 0; every hotspot passed and `src/lib/rag/rag.ts` remained exactly 4,362/4,362 lines.
- Migration ordering check: `20260824130000_add_site_content_release_and_outbox.sql` remains strictly later than every other migration.
- Scoped Prettier over changed TypeScript/test owners, staged `git diff --check`, and final scoped diff review: exit 0 / clean.
- Provider-free CLI dry-run was not repeated because cycle 7 did not change the planner, CLI, transport, or any provider-facing path.

## Correction cycle 6 RED evidence

Command:

`GATE_RECEIPTS=off node scripts/run-vitest.mjs run tests/site-content-authority-secret-provisioning.test.ts tests/site-content-gate-owner-provenance.test.ts tests/site-content-publication-route.test.ts tests/site-content-sync-cli.test.ts tests/site-content-release-gate-verifiers.test.ts`

Result before correction: exit 1; 5 failed files; 7 failed and 12 passing tests plus one expected suite-load failure. The failures exactly identified the absent fixed-purpose provisioner/RPCs and distinctness contract, pre-derivation verification clock, dry-run output from `--plan-write`, and missing exact policy/decision digest enforcement.

## Correction cycle 6 GREEN and check evidence

- Identical five-file RED selector: exit 0; 5 files and 21 tests passed.
- Final directly affected route/CLI/authority/grant/type selector: exit 0; 10 files and 39 tests passed.
- Fresh `npm run typecheck`: exit 0 against 4,760 input files. The first run found one test-only callback annotation mismatch; that exact annotation was corrected and the unchanged gate then passed.
- `npm run check:function-grants`: exit 0; all 34 checked schema functions remain revoked from PUBLIC/anon, and only service role receives the three fixed Vault provisioning RPCs.
- `npm run check:migration-role`: exit 0; immutable applied migration history remained unchanged.
- `npm run check:maintainability-budgets`: exit 0; every hotspot passed and `src/lib/rag/rag.ts` remained exactly 4,362/4,362 lines.
- Literal provider-free `node scripts/run-tsx.mjs scripts/sync-site-content-corpus.ts --manifest tests/fixtures/site-content-sync-manifest.json --dry-run`: exit 0; deterministic dry-run plan only, with no transport or write action.
- Migration ordering check: `20260824130000_add_site_content_release_and_outbox.sql` remains strictly later than every other migration.
- Scoped Prettier over every changed TypeScript/test owner, staged `git diff --check`, and final diff review: exit 0 / clean.

## Correction cycle 5 RED evidence

Command:

`GATE_RECEIPTS=off node scripts/run-vitest.mjs run tests/site-content-gate-owner-provenance.test.ts tests/site-content-gate-types-parity.test.ts`

Result before correction: exit 1; 2 failed files. The provenance suite could not load because the fixed gate-owner module did not exist, and the exact type-parity assertion found missing required `observed_at` plus the invented release foreign-key relationship.

## Correction cycle 5 GREEN and check evidence

- Identical two-file RED selector: exit 0; 2 files and 3 tests passed.
- Final directly affected selector covering fixed owners, generated-type parity, production route/RPC/SQL authority, recovery binding, access grants, CLI wiring, release-gate verification, and authenticated Supabase client behavior: exit 0; 9 files and 35 tests passed.
- Fresh `npm run typecheck`: exit 0 against 4,756 input files.
- `npm run check:function-grants`: exit 0; all 34 checked schema functions remain revoked from PUBLIC, the generic recorder is absent, and the narrow derivation authority is unavailable to service role.
- `npm run check:migration-role`: exit 0; immutable applied migration history remained unchanged.
- `npm run check:maintainability-budgets`: exit 0; every hotspot passed and `src/lib/rag/rag.ts` remained exactly 4,362/4,362 lines.
- Literal provider-free `node scripts/run-tsx.mjs scripts/sync-site-content-corpus.ts --manifest tests/fixtures/site-content-sync-manifest.json --dry-run`: exit 0; deterministic empty-authority plan only, with no transport or write action.
- Migration ordering check: `20260824130000_add_site_content_release_and_outbox.sql` remains strictly later than every other migration.
- Scoped Prettier over every changed TypeScript/test owner and `git diff --check`: exit 0. The commit hook generated and staged only the expected scripts-inventory count update.

## Correction cycle 4 RED evidence

Command:

`node scripts/run-vitest.mjs run tests/site-content-release-gate-verifiers.test.ts tests/site-content-production-authority.test.ts tests/site-content-recovery-authority.test.ts tests/site-content-publication-route.test.ts tests/site-content-publication-access.test.ts`

Result before correction: exit 1; 5 failed files; 7 failed and 17 passing tests. The failures exactly identified absent trusted gate verifiers, discarded bearer identity, the remaining parallel transaction authority, absent Vault/gate production-path proof, and absent one-time binding consumption.

## Correction cycle 4 GREEN and check evidence

- Final focused selector (the identical RED owners plus the bearer-client owner): exit 0; 6 test files and 30 tests passed.
- `npm run typecheck` with a fresh receipt: exit 0 against 4,750 input files.
- `npm run check:function-grants`: exit 0; all 34 checked schema security-definer functions remain revoked from PUBLIC, with new gate/consumption helpers explicitly internal and the gate recorder service-role-only.
- `npm run check:migration-role`: exit 0; immutable applied migration history remained unchanged.
- `npm run check:maintainability-budgets`: exit 0; every hotspot passed and `src/lib/rag/rag.ts` remained exactly 4,362/4,362 lines.
- Literal provider-free `node scripts/run-tsx.mjs scripts/sync-site-content-corpus.ts --manifest tests/fixtures/site-content-sync-manifest.json --dry-run`: exit 0; deterministic empty-authority plan only, with no transport or write action.
- Scoped Prettier for every changed TypeScript/test owner, migration ordering source check, staged and worktree `git diff --check`: exit 0. `20260824130000_add_site_content_release_and_outbox.sql` remains strictly later than every other migration.

## Correction cycle 3 RED evidence

Command:

`node scripts/run-vitest.mjs run tests/site-content-recovery-authority.test.ts tests/site-content-release-evidence.test.ts tests/site-content-sync-operator.test.ts tests/site-content-publication-access.test.ts tests/site-content-transaction-authority.test.ts`

Result before correction: exit 1; 4 failed files and 1 passed file; 5 failed tests, 1 suite-load failure, and 12 passing tests. Failures exactly identified the missing release-evidence owner, verifier option/key mismatch, absent Vault provisioning/reader contract, unreachable literal CLI, missing built-in transport, and absent authority-produced partition API.

## Correction cycle 3 GREEN and check evidence

- Exact final focused selector: exit 0; 18 test files passed; 249 tests passed.
- `npm run typecheck`: exit 0; fresh receipt recorded against 4,749 input files.
- `npm run check:function-grants`: exit 0; all 34 schema security-definer functions remained revoked from PUBLIC/anon; the new unapplied migration additionally revokes its provisioning RPC from all roles and grants only service role.
- `npm run check:migration-role`: exit 0; immutable applied history remained unchanged.
- `npm run check:maintainability-budgets`: exit 0; all hotspots passed and `src/lib/rag/rag.ts` remained 4,362/4,362 lines.
- Literal `node scripts/run-tsx.mjs scripts/sync-site-content-corpus.ts --manifest tests/fixtures/site-content-sync-manifest.json --dry-run`: exit 0 with deterministic empty-authority dry-run output and no state argument.
- Migration timestamp source check and `git diff --check`: exit 0.
- Scoped Prettier over every corrected TypeScript/test owner: exit 0.

## Correction cycle 2 RED evidence

Command:

`node scripts/run-vitest.mjs run tests/site-content-sync.test.ts tests/site-content-transaction-authority.test.ts tests/site-content-recovery-authority.test.ts tests/site-content-sync-cli.test.ts tests/site-content-sync-worker.test.ts tests/site-content-publication-access.test.ts tests/site-content-publication-route.test.ts`

Result before correction: exit 1; 4 failed files, 4 failed tests, 2 suite-load failures, and 18 passing tests. The expected failures identified missing canonical operation/disposition fields, absent executable transaction and P05 binding authorities, and absent real CLI exports.

## Correction cycle 2 GREEN and check evidence

- Exact final focused selector: exit 0; 16 test files passed; 241 tests passed. It included planner, pure transaction, P05 binding parity, CLI, worker, all seven route state owners, publication authority, schema/grants, recovery evidence, ingestion mutation safety, and reindex safety.
- `npm run typecheck`: exit 0; fresh `typecheck:internal` receipt recorded against 4,743 input files.
- `npm run check:function-grants`: exit 0; all 34 security-definer public functions are revoked from PUBLIC/anon and none reopened.
- `npm run check:migration-role`: exit 0; hosted migration-role guard passed and immutable applied history remained unchanged.
- `npm run check:maintainability-budgets`: exit 0; all hotspot budgets passed and `src/lib/rag/rag.ts` remained exactly 4,362/4,362 lines.
- Migration timestamp source check: exit 0; `20260824130000_add_site_content_release_and_outbox.sql` is strictly later than every other migration.
- `git diff --check`: exit 0 before commit.
- Scoped Prettier over every corrected TypeScript/test owner: exit 0.
- Provider-free CLI invocation using the P03 local static manifest plus `tests/fixtures/site-content-sync-offline-state.json`: exit 0; canonical dry-run plan produced with no writes. The checked-in manifest currently had zero eligible executable records, while the focused CLI test proved a real mixed changed/unchanged/tombstone/legacy-disposition plan and exact begin/publication requests.

## Correction RED evidence

Command:

`node scripts/run-vitest.mjs run tests/site-content-sync.test.ts tests/site-content-sync-worker.test.ts tests/site-content-publication-access.test.ts`

Result before correction: exit 1; 3 failed test files; 5 failed tests plus 1 suite-load failure / 6 passing tests. Failures covered permissive fallback, direct/non-atomic publication reads, weaker receipt/admin/type SQL, absent durable candidate store, absent authenticated handler/periodic heartbeat, and nullable/mismatched candidate completion.

## Correction GREEN and check evidence

- Final expanded focused selector (the correction RED owners plus the seven route/authority/schema safety owners): exit 0; 12 test files passed; 189 tests passed.
- Final narrowed correction owners after the last SQL/worker strengthening: exit 0; 4 test files passed; 20 tests passed.
- `npm run typecheck`: exit 0 after the complete correction type surface.
- `npm run check:function-grants`: exit 0; all 34 checked security-definer functions remain revoked from PUBLIC/anon. Negative self-test diagnostics in Vitest are expected and the test file passed.
- `npm run check:migration-role`: exit 0; hosted migration-role guard passed and immutable applied history was unchanged.
- `npm run check:maintainability-budgets`: exit 0; all hotspot budgets passed; `src/lib/rag/rag.ts` remained exactly 4,362 lines.
- Provider-free dry-run: exit 0; mode `dry-run`, registry `site-content-registry-v1`, static digest `sha256:ec80bbd26c0d87ce7973b0e9f4501551d802d905c06d3033b925767792309182`, desired 3 / changed 0 / unchanged 3 / tombstoned 0.
- Scoped Prettier over every corrected TypeScript/test owner: exit 0; SQL was covered by focused static migration assertions and diff checks.
- `npm run docs:check-index`: exit 0 after registering the new administrator route; the commit hook regenerated the site map successfully.
- `git diff --check 1788f3d95c88b4df65d3e13ddc6e5a7b186e8a07..00ec54523d7d6896d06ea6b56a622b95dcf4f46d`: exit 0.

## RED evidence

Command:

`node scripts/run-vitest.mjs run tests/site-content-sync.test.ts tests/site-content-sync-worker.test.ts tests/site-content-publication-access.test.ts tests/registry-records-route.test.ts tests/medications-route.test.ts tests/differentials-route.test.ts tests/registry-corpus.test.ts tests/function-grants.test.ts tests/supabase-schema.test.ts tests/ingestion-mutation-safety.test.ts tests/reindex-pipeline.test.ts`

Result before implementation: exit 1; 3 failed files / 8 passed files; 4 failed tests / 165 passed tests. Expected contract failures were missing `site-content-sync` planner, missing worker, missing forward migration, and owner-preferring public reader selection. There was no parse, admission, dependency, or environment failure.

## GREEN and check evidence

- Identical focused selector: exit 0; 11 test files passed; 177 tests passed.
- `npm run typecheck`: exit 0; fresh `typecheck:internal` receipt recorded against 4,727 input files.
- `node scripts/run-tsx.mjs scripts/sync-site-content-corpus.ts --manifest .local/rag-site-content/manifest.json --dry-run`: exit 0; mode `dry-run`, registry `site-content-registry-v1`, digest `sha256:ec80bbd26c0d87ce7973b0e9f4501551d802d905c06d3033b925767792309182`, desired 3 / changed 0 / unchanged 3 / tombstoned 0.
- `npm run check:function-grants`: exit 0; all 34 checked security-definer functions revoked from PUBLIC and none reopened. The focused Vitest output also contains intentional negative-fixture `FAIL` diagnostics; the suite itself passed.
- `npm run check:migration-role`: exit 0; hosted migration-role guard passed and immutable applied history was unchanged.
- `npm run check:maintainability-budgets`: exit 0; all hotspot budgets passed; `src/lib/rag/rag.ts` remained exactly 4,362 lines.
- Scoped Prettier over changed TypeScript/test owners: formatted successfully. SQL/TOML have no inferred Prettier parser and were checked through source/static gates.
- `git diff --check 1788f3d95c88b4df65d3e13ddc6e5a7b186e8a07..HEAD`: exit 0.
- Next 16 installed route-handler and route file-convention documentation was inspected before route behavior changed.

## Files in the product/test commit

- Durable synchronization: `src/lib/site-content/site-content-sync.ts`, `src/lib/site-content/public-site-content.ts`, `supabase/functions/site-content-sync/index.ts`, `scripts/sync-site-content-corpus.ts`.
- Database authority: `supabase/migrations/20260824130000_add_site_content_release_and_outbox.sql`, `supabase/config.toml`, `src/lib/supabase/database.types.ts`.
- Public readers: all seven registry, medication, and differential collection/detail route owners named by Task 3.
- Legacy compatibility boundary: `src/lib/registry-corpus.ts`, `src/lib/registry-seed.ts`, `src/lib/medication-seed.ts`, `src/lib/differential-seed.ts`.
- Tests: the three new Task 3 test owners plus the registry, medication, and differential route suites.
- Generated repository contracts required by the commit hook: `docs/scripts-index.md`, `docs/design-system/adoption-manifest.json`.
- Cycle-2 canonical recovery authority: `src/lib/site-content/site-content-recovery-authority.ts`; the cycle-4 correction removed the test-only parallel transaction authority.
- Cycle-2/4 executable proof: `tests/site-content-recovery-authority.test.ts`, `tests/site-content-route-release-states.test.ts`, `tests/site-content-sync-cli.test.ts`, `tests/site-content-production-authority.test.ts`, `tests/site-content-release-gate-verifiers.test.ts`, and synthetic metadata fixtures under `tests/fixtures/`.
- Cycle-3 evidence/operator authority: `src/lib/site-content/site-content-release-evidence.ts`, the administrator publication route, Vault-backed forward migration, operator CLI, generated types, and focused evidence/operator/route/transaction tests.
- Cycle-5 fixed provenance owners: `src/lib/site-content/site-content-gate-owners.ts`, `scripts/create-site-content-gate-owner-receipt.ts`, the administrator publication route, migration derivation authority, operator CLI receipt transport, exact generated types, `tests/site-content-gate-owner-provenance.test.ts`, and `tests/site-content-gate-types-parity.test.ts`.
- Cycle-6 bootstrap authority: `src/lib/site-content/site-content-authority-secrets.ts`, the administrator route, environment schema, three fixed Vault RPCs in the forward migration, operator plan/receipt handoff, policy-bound gate owners/release evidence, generated RPC types, and the focused provisioning/route/CLI/policy/type tests.
- Cycle-7 temporal authority: the administrator route, shared release-evidence clock/age contract, forward migration derivation/helper, generated helper signature, `tests/site-content-gate-derivation-temporal-authority.test.ts`, and focused route/verifier boundary tests.
- Cycle-8 clock separation: the administrator route, recovery-binding issuer, shared millisecond precision contract, forward migration derivation/existing-row revalidation path, and focused temporal/route production-binding tests.

## Residual live gates

- The migration has not been applied and its live SQL transaction/lock behavior remains unverified.
- The edge worker has not been deployed or invoked; scheduler cadence and invocation credentials remain unavailable/unverified.
- No provider embeddings were requested, so live changed-record staging, resumability, retry/quarantine, five-minute SLO, activation, rollback, cache invalidation, and hosted anonymous/authenticated/administrator parity remain provider/database/deployment-gated.
- No live legacy reconciliation plan was generated and no release was activated.
- SQL syntax, transaction/lock behavior, exact Postgres float-byte digest evaluation, scheduler cadence, and hosted role behavior remain migration-application/deployment gated; no local database was contacted to claim otherwise.
- Deployment must configure the server recovery-validation secret and run the guarded service-role Vault provisioning action before adoption, verification, activation, or rollback can succeed. Provisioning and rotation were intentionally not executed here.
- Deployment must independently configure the governance and RAG-programme owner secrets in their fixed application producer environments and exact protected Vault counterparts. No secret was provisioned or rotated here.
- Deployment must configure three distinct recovery/governance/RAG-programme application secrets and invoke each guarded fixed-purpose provisioning action. Source proves the custody/rotation contract, but the three Vault writes and live signer/verifier interoperability remain intentionally unrun.
- The fixed governance and RAG-programme producer CLI, SQL derivation transition, adoption/verification transition, and HTTP transport were not invoked. Live SQL interoperability and the deployed gate-owner run-output integrations remain explicit provider/database/deployment gates.

## Safety confirmation

No documents or corpus content were fetched, read, parsed, OCRed, uploaded, embedded, enqueued, reindexed, activated, withdrawn, or otherwise processed. Only the pre-existing local static manifest metadata was read by the required provider-free dry-run. No network, provider API, Supabase/database/Storage, hosted CI, or deployment system was contacted. No migration was applied. Nothing was pushed and no PR was opened. The brief, this report, receipt, and `.superpowers/` artifacts remain untracked and unstaged.
