# P06 repositoryContent Task 3 review 9

## Findings

No material spec-compliance or code-quality findings remain in the immutable review range.

## Attempt 8 finding disposition

1. **HIGH — delayed response committed an immutable set whose final binding expired:** **CLOSED.** New-set derivation normalizes and persists one database-owned artifact clock, while an existing complete set restores `verificationNow` from its canonical stored public observation and revalidates the submitted owner outputs and every stored artifact against that original clock without imposing current-age expiry (`supabase/migrations/20260824130000_add_site_content_release_and_outbox.sql:208-220,233-303`). The route uses that clock only for artifact verification, then captures a fresh post-read binding time and creates a new UUID/MAC-bound validation binding for the final transition (`src/app/api/admin/site-content/publish/route.ts:116-146`; `src/lib/site-content/site-content-recovery-authority.ts:110-135`). The production SQL transition still validates the binding against the current database transaction clock, consumes its UUID exactly once, and compares all three evidence artifacts to the immutable rows (`migration:127-163,824-865`). Thus a delayed first response and a later idempotent retry can reuse the same immutable evidence while issuing distinct current bindings; no artifact delete, replacement, or stale-binding replay is required.
2. **MEDIUM — SQL/TypeScript exact-edge precision mismatch:** **CLOSED.** SQL now applies `date_trunc('milliseconds', clock_timestamp())` before owner freshness comparison, public timestamp construction, persistence, and serialization (`migration:208-220`). The returned canonical ISO millisecond value is the same instant consumed by the TypeScript parser and inclusive five-minute verifier (`src/lib/site-content/site-content-release-evidence.ts:13-14,122-149`). Exact-edge acceptance and one-millisecond stale/future rejection therefore use one precision and the same strict `<`/`>` semantics.

## Preserved prior disposition

- All attempt-7 and earlier findings remain **CLOSED / unchanged**: invalid future/stale/malformed owner evidence commits zero rows; full recovery → governance → must-pass → public chronology precedes the first insert; the three-row insert is atomic; complete existing rows are subject/digest/observed-time and byte-exact revalidated; fixed-purpose Vault custody/provision/rotation and cross-purpose distinctness; fixed independent governance and programme-owner provenance; exact versioned policy and GO decision digests; administrator bearer propagation; no generic or parallel mutation authority; transactionally consumed binding UUID replay fencing; exact P03/P05 parser, recovery, activation, and rollback reuse; plan/operation/target/digest/count/resume binding; exact pending anti-join; one public logical identity and legacy disposition; active-release-only seven-route current/updating/unavailable parity; atomic publication/epoch/outbox; changed-only staging and exact embedding-byte reuse; deletion tombstones; lease/row/generation/attempt/retry/quarantine/heartbeat fencing; fixed search paths and direct-table revocation; content-free errors/logs; no inline provider call; and no partial activation.
- Generated database types remain aligned with the migration RPC surface; attempt 9 changes no SQL signature or result type. No canonical brief, plan, spec, manifest, matrix, or accepted P03/P05 authority changed in the ninth commit.

## Adversarial checks

- **Delay and retry:** A ten-minute delay after derivation produces a binding timestamped at the post-read application time, not the old artifact clock; the real TypeScript binding verifier accepts its exact purpose/project/recovery/payload/MAC/time contract. A later retry produces a different binding UUID and another current valid binding while the derivation result remains anchored to the immutable stored clock (`tests/site-content-publication-route.test.ts:364-445`).
- **Current SQL binding authority:** SQL retains inclusive current ±5-minute validation, exact payload/project/purpose/recovery digest and Vault HMAC verification, exception-safe rejection, and transactionally unique UUID consumption (`migration:127-163`). `verify_site_content_candidate_release` consumes before state mutation and requires each of the three exact stored artifacts (`migration:824-865`).
- **Stored immutability:** Existing derivation accepts only exactly three rows, canonicalizes the stored public clock, revalidates owner HMACs and chronology at that clock, rebuilds the expected three artifacts, and rejects any subject, digest, observed-time, or artifact divergence before returning `derived: false` (`migration:202-220,233-295`). There is no delete/replace path.
- **Clock boundaries:** New derivation truncates once to milliseconds before any comparison. Owner receipt timestamps must be canonical millisecond UTC, exact five-minute age is accepted, one millisecond older is rejected, and any future millisecond is rejected; TypeScript uses the same maximum age, ISO precision, and strict inequalities (`migration:165-186,208-220`; `site-content-release-evidence.ts:122-149`; `tests/site-content-gate-derivation-temporal-authority.test.ts:13-70`; `tests/site-content-release-gate-verifiers.test.ts:163-188`).
- **Malformed/null evidence:** Null/non-canonical timestamps, bad owners/subjects/digests/MACs, missing Vault secrets, and invalid chronology fail before the multi-row insert. The PL/pgSQL verifier catches cast/HMAC errors and returns false; derivation raises before insert, so the transaction leaves zero new rows (`migration:165-186,233-270,297-303`).

## Verdicts

SPEC_VERDICT: PASS

The complete base-to-head implementation now satisfies the Task 3 synchronization, publication, reader, governance, recovery, fencing, and offline/source-only constraints. Both attempt-8 temporal blockers are closed without weakening immutable evidence, owner HMAC authority, binding replay protection, or previously accepted P03/P05 boundaries.

QUALITY_VERDICT: PASS

The correction separates the immutable artifact clock from the fresh transition-binding clock cleanly, normalizes precision at the database authority, preserves one-way immutable state, and adds focused delay/retry, real binding-verifier, SQL-source, edge, and type coverage. No duplicated authority or permissive production fallback was introduced.

## Immutable scope and package verification

- Original base: `1788f3d95c88b4df65d3e13ddc6e5a7b186e8a07`
- Attempt-9 head: `aed1c5eec5ef7d276b16b8a9226f1ff5080a749b`
- Base is an ancestor of head; the full range contains exactly nine commits: `10aeecc135c286fadc09e45cb2e04f43bcaefbff`, `00ec54523d7d6896d06ea6b56a622b95dcf4f46d`, `3c91ff9d6927a9df7947e10f165b6193a865212c`, `746c9578ba299e16a59f63e651bafc5d9e7f2fc7`, `1cf43c060544577b8059a9d85b529c36492e85c6`, `c197600a52ee9584f37989a4b36b9bb780d12849`, `908b7edf2af8d8aa151a170405c7e254da71ba6f`, `0ec478c0791a4c81fc36236126d8a00b97d0b150`, and `aed1c5eec5ef7d276b16b8a9226f1ff5080a749b`.
- Reviewed package: `P06-repository-content-task-3-review-9.diff`
- Required SHA-256: `82b4d729e5eae77d6f89d1c01fa39cb819bda2ca9fa51ddde91bf8814317771e`
- Observed SHA-256: `82b4d729e5eae77d6f89d1c01fa39cb819bda2ca9fa51ddde91bf8814317771e` — exact match.
- `npm run ledger:lookup -- aed1c5eec5ef7d276b16b8a9226f1ff5080a749b --scope "P06 repositoryContent task-3"`: `NOT REVIEWED at this HEAD and scope.` No ledger write was made because this review was authorized to write only this report.
- Repository instructions, canonical SDD execution, original Task 3 brief/plan/specs, programme manifest/matrix, accepted P03/P05 authorities, and reports 1-8 were reviewed across this same reviewer identity. Unchanged accepted evidence was reused.

## Focused offline verification

1. Exact head, ancestry, nine-commit range, package header/SHA-256, and `git diff --check` — PASS.
2. `GATE_RECEIPTS=off node scripts/run-vitest.mjs run tests/site-content-gate-derivation-temporal-authority.test.ts tests/site-content-publication-route.test.ts tests/site-content-release-gate-verifiers.test.ts tests/site-content-recovery-authority.test.ts tests/site-content-gate-types-parity.test.ts` — PASS, 5 files / 24 tests.
3. Bounded source/transaction review confirmed millisecond clock normalization, original-clock existing-set revalidation, post-read fresh unique bindings, current SQL binding verification/consumption, exact immutable-row matching, validation-before-insert ordering, migration/type alignment, and no change to prior accepted reader/synchronization/lease authorities.

This is offline source/test evidence, not hosted/provider acceptance. No network, provider, Supabase/database/Storage access, migration application, embedding, enqueueing, reindexing, activation, rollback, deployment, document/corpus processing, commit, push, or PR action occurred. The report is left untracked and unstaged.
