# P06 repositoryContent Task 3 review 7

## Findings

### 1. HIGH — SQL can commit an immutable gate set that the post-derivation verifier can never accept

Evidence:

- The SQL owner-receipt verifier accepts an owner observation anywhere in the symmetric window `now() - 5 minutes` through `now() + 5 minutes` (`supabase/migrations/20260824130000_add_site_content_release_and_outbox.sql:165-184`). It does not enforce the application chronology or reserve any lifetime for the later application RPC boundary.
- `derive_site_content_release_gate_artifacts` then inserts the three-row immutable set and commits as a standalone PostgREST RPC (`supabase/migrations/20260824130000_add_site_content_release_and_outbox.sql:186-254`; route `src/app/api/admin/site-content/publish/route.ts:110-123`). A subsequent application failure cannot roll that RPC back.
- The application verifier is deliberately stricter: it rejects any artifact later than its post-derivation clock, rejects any artifact more than five minutes old, and requires `governanceAt >= recoveryVerifiedAt`, `mustPassAt >= governanceAt`, and SQL public observation `publicAt >= mustPassAt` (`src/lib/site-content/site-content-release-evidence.ts:119-130,186-196`).
- Consequently, an owner receipt one minute in the future is valid to SQL, but SQL stamps public visibility at its current clock, so the application rejects both future evidence and `publicAt < mustPassAt`. Likewise, a receipt accepted at the trailing edge of SQL's five-minute window can expire while derive/read completes and is then rejected by the application.
- Retry cannot recover the candidate. Once any three rows exist, derivation returns `derived: false` without revalidating/replacing them (`supabase/migrations/20260824130000_add_site_content_release_and_outbox.sql:193-200`). Direct table mutation remains correctly revoked, so no supported path can repair or remove the poisoned set.
- The new route regression test covers only the ordinary fresh case: SQL-derived time is one second after request entry and the application clock is advanced another second before verification (`tests/site-content-publication-route.test.ts:350-383`). Pure verifier tests prove stale/future rejection, but no test proves SQL rejects before insertion or that an expiry/skew failure remains recoverable.

Trigger A: submit correctly HMAC-signed governance/must-pass receipts timestamped 60 seconds ahead of the database/application clock. SQL accepts and commits the three artifacts; the application rejects them, and every retry reads the same invalid rows. Trigger B: submit receipts 4 minutes 59 seconds old and allow the two RPCs to cross the five-minute boundary; the same permanent candidate failure occurs.

Expected behavior: stale, future, invalid-chronology, and insufficient-remaining-lifetime owner evidence fails before any immutable gate row commits, while every SQL-accepted set is guaranteed acceptable by the post-derivation verifier. Actual behavior has two clock authorities and a commit between them.

Smallest fix/proof: use one authoritative derivation timestamp and enforce the complete application freshness/chronology contract inside SQL before insertion, including a reviewed minimum remaining-lifetime margin, then bind/return that timestamp to the application verifier. Prefer one transactional derive-and-verify authority if feasible. Add boundary tests showing future, clock-skewed, and expiry-edge receipts leave zero artifact rows, while one fresh first attempt succeeds and a response-loss retry reads the same valid immutable set.

## Attempt 6 finding disposition

1. **Owner HMAC Vault custody/rotation and cross-purpose distinctness:** **CLOSED in source.** Three fixed-purpose service-role-only functions use the same global advisory transaction lock, fixed Vault names, minimum secret length, write-once initial provisioning, exact predecessor digest plus non-empty reason for rotation, changed-secret enforcement, and pairwise digest rejection against the other two authorities (`supabase/migrations/20260824130000_add_site_content_release_and_outbox.sql:280-386,951-953,980-982`). The application requires all three secrets, enforces pairwise value distinctness, maps a fixed purpose to a fixed RPC, and never returns raw secret material (`src/lib/site-content/site-content-authority-secrets.ts:1-59`; route lines `35-64`). Generated RPC types align. No generic secret-name provisioner exists.
2. **First verification rejected SQL's later public timestamp:** **CLOSED for the ordinary fresh path; REOPENED at the adversarial clock/expiry boundary by Finding 1.** The route now captures `verificationNow` after derive/read and uses it for both evidence verification and the signed binding (`src/app/api/admin/site-content/publish/route.ts:110-137`), so a normal first attempt passes. SQL and application still disagree on accepted future/expiry-edge evidence before immutable commit.
3. **Initial adoption write-plan/receipt bootstrap cycle:** **CLOSED.** `--plan-write` is explicitly incompatible with `--write`, builds the exact write-mode plan without constructing/sending live transport, and prints it (`scripts/sync-site-content-corpus.ts:217-245,295-297`). Guarded adoption accepts `--canonical-plan` plus separate owner-receipt paths and requires byte-canonical equality with a freshly recomputed manifest/state plan before sending (`:238-294`). The literal mocked-transport integration produces the write plan, creates both fixed-owner receipts from it, and proves the adoption request uses that exact subject without caller editing (`tests/site-content-sync-cli.test.ts:172-308`).
4. **Must-pass policy digest did not identify the policy:** **CLOSED.** `SITE_CONTENT_RAG_PROGRAMME_GATE_POLICY_DIGEST` hashes the exact versioned `ragProgrammeGatePolicy`; `gateDecisionDigest` independently hashes the exact `GO`/empty-reasons result (`src/lib/site-content/site-content-gate-owners.ts:21-25,140-174`). Owner verification, SQL derivation, and release-evidence verification require both exact constants (`site-content-gate-owners.ts:177-209`; migration lines `227-251`; `src/lib/site-content/site-content-release-evidence.ts:174-184`). Threshold-drift/resigning tests fail closed.

## Preserved earlier disposition

- **Attempt-5 generic artifact self-attestation:** **CLOSED except for Finding 1's commit-time clock split.** The generic recorder/grant remains absent. Governance and must-pass outputs are produced by fixed source owners, HMAC-bound to distinct fixed Vault keys and the exact plan subject; SQL alone derives public visibility from complete persisted projections. Arbitrary administrator/service-role artifact JSON has no generic writer.
- **Database/type parity:** **CLOSED.** `observed_at`, the intentionally empty relationship set, and all three provisioning RPCs match migration source (`src/lib/supabase/database.types.ts:205-228,2625-2636`; `tests/site-content-gate-types-parity.test.ts:5-46`).
- **Bearer propagation, administrator-only mutation, no parallel transaction authority, replay-consumed binding UUIDs, recovery Vault/P05 parser/activation/rollback authority, exact pending anti-join, one public logical identity, active-release isolation, seven-route parity/fallback/error semantics, operation/target/digest/count/resume binding, changed-only staging, exact embedding-byte reuse, tombstones, worker lease/row/generation/attempt/retry/quarantine/heartbeat fencing, atomic publication/epoch/pending/outbox, partial-activation prevention, fixed search paths, direct-table revocation, content-free errors/logs, and no inline provider call:** **CLOSED / unchanged.** The seventh commit does not weaken the previously accepted source evidence.

## Verdicts

SPEC_VERDICT: FAIL

Attempt 7 closes the secret-custody, normal clock ordering, initial-adoption bootstrap, and exact policy-binding findings while preserving all earlier accepted synchronization, reader, recovery, and fencing invariants. It still permits SQL-accepted future/expiry-edge owner receipts to commit an immutable artifact set that the stricter verifier rejects permanently, so the required fail-closed activation gate is not transactionally coherent.

QUALITY_VERDICT: FAIL

The focused suite is green and the corrections are materially stronger, but it tests fresh first-attempt time and pure stale/future rejection separately. It misses the cross-RPC clock TOCTOU and irreversible intermediate commit, leaving a realistic skew/expiry failure path without supported recovery.

## Positive controls observed

- All three secret authorities are fixed-purpose, globally serialized, service-role-only, pairwise distinct in application values and SQL digests, rotation-bound to an exact predecessor and reason, and digest-only in responses.
- The route preserves administrator bearer identity for every non-provision mutation; the service-role client is confined to the guarded fixed-purpose provision calls.
- `--plan-write` is non-mutating and provider-free, cannot be combined with `--write`, and produces the exact write-mode subject later revalidated by guarded adoption. Receipt files bind that exact plan.
- Governance receipts remain bound to the digest-verified canonical P03 manifest, plan population, governance state, and legacy disposition digests. Must-pass receipts remain bound to the parsed fixed fixture, exact baseline/candidate comparison, case population, run digests, versioned policy digest, and exact GO decision digest.
- SQL retains the fixed owner/Vault-name HMAC boundary, derives public population from exact complete persisted projections, inserts all three artifacts in one statement, and exposes no generic writer. Finding 1 concerns the accepted-time/commit boundary, not caller-authored evidence.
- Type/config/RPC declarations align; the attempt-6 bearer, no-parallel-authority, replay, P05, anti-join, reader/routes, durable sync, and worker findings remain closed.
- The full range adds no document-processing/ingestion/reindex authority, and no live/provider/database/document action occurred.

## Immutable scope and package verification

- Original base: `1788f3d95c88b4df65d3e13ddc6e5a7b186e8a07`
- Attempt-7 head: `908b7edf2af8d8aa151a170405c7e254da71ba6f`
- Base is an ancestor of head; the full range contains exactly seven commits: `10aeecc135c286fadc09e45cb2e04f43bcaefbff`, `00ec54523d7d6896d06ea6b56a622b95dcf4f46d`, `3c91ff9d6927a9df7947e10f165b6193a865212c`, `746c9578ba299e16a59f63e651bafc5d9e7f2fc7`, `1cf43c060544577b8059a9d85b529c36492e85c6`, `c197600a52ee9584f37989a4b36b9bb780d12849`, and `908b7edf2af8d8aa151a170405c7e254da71ba6f`.
- Reviewed package: `P06-repository-content-task-3-review-7.diff`
- Required SHA-256: `2246f93e0ab9804db0524f22e80a074572877e58b716ffbccbe8c95c0044ec96`
- Observed SHA-256: `2246f93e0ab9804db0524f22e80a074572877e58b716ffbccbe8c95c0044ec96` — exact match.
- `npm run ledger:lookup -- 908b7edf2af8d8aa151a170405c7e254da71ba6f --scope "P06 repositoryContent task-3"`: `NOT REVIEWED at this HEAD and scope.` No ledger write was made because this review was authorized to write only this report.
- Repository instructions, canonical SDD execution, original Task 3 brief/plan/specs, programme manifest/matrix, accepted P03/P05 authorities, and reports 1-6 were reviewed across this same reviewer identity. No canonical instruction/spec artifact changed in the seventh commit, so accepted unchanged evidence was reused.

## Focused offline verification

1. Package SHA-256, package header, exact head, ancestry, seven-commit range, and `git diff --check` — exact match / PASS.
2. `GATE_RECEIPTS=off node scripts/run-vitest.mjs run tests/site-content-authority-secret-provisioning.test.ts tests/site-content-gate-owner-provenance.test.ts tests/site-content-gate-types-parity.test.ts tests/site-content-publication-route.test.ts tests/site-content-release-gate-verifiers.test.ts tests/site-content-sync-cli.test.ts tests/site-content-production-authority.test.ts tests/site-content-publication-access.test.ts` — PASS, 8 files / 31 tests. This proves the corrected unit/source contracts but does not cover Finding 1's accepted-then-expired/future immutable commit.
3. Bounded source/privilege checks confirmed fixed secret RPCs/grants/locks/distinctness, post-derivation route clock, exact non-mutating write-plan/adoption handoff, exact policy/decision constants in TS/SQL, migration/type parity, and the remaining SQL/application freshness-window mismatch plus immutable early-return behavior.

No network, provider, Supabase/database/Storage access, migration application, embedding, enqueueing, reindexing, activation, rollback, deployment, document/corpus processing, commit, push, or PR action occurred. The report is left untracked and unstaged.
