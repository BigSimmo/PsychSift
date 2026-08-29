# P06 repositoryContent Task 3 review 5

## Findings

### 1. CRITICAL — Fixed labels, case IDs, and freshness still validate generic service-role self-attestation, not production-derived owner evidence

Evidence:

- The sole artifact writer is `record_site_content_release_gate_artifact(jsonb)`. It accepts the complete subject and artifact JSON from its caller and proves only that the caller supplied an allowed owner string, internally consistent digests, a matching subject release ID, and a parseable `observedAt` (`supabase/migrations/20260824130000_add_site_content_release_and_outbox.sql:165-195`). It does not query the canonical public reader, governance registry/review authority, or RAG evaluation output.
- The function is executable by the undifferentiated generic `service_role` (`supabase/migrations/20260824130000_add_site_content_release_and_outbox.sql:818,847`). The fixed owner strings therefore describe caller-supplied JSON; they do not authenticate three distinct production owners. Any service-role holder can author all three rows.
- The bounded production-consumer search found no application, worker, or operator producer for `record_site_content_release_gate_artifact`; outside the migration/type declarations, it appears only in source-pattern tests. The guarded CLI exposes adopt/begin/resume/publish/verify/activate/provision actions but no owner artifact production path (`scripts/sync-site-content-corpus.ts:25,205-238`). Consequently the advertised workflow cannot produce these prerequisites itself.
- The administrator route only reads the three stored rows and passes them through the application verifier before HMAC-signing them (`src/app/api/admin/site-content/publish/route.ts:63-81,92-112`). `verifySiteContentReleaseGateArtifacts` now correctly enforces the exact plan population, fixed owners, registry/manifest identity, fixed 29-case population, empty failures, strict five-minute freshness, and chronology (`src/lib/site-content/site-content-release-evidence.ts:127-194`), but none of those checks establish who performed the observations or whether the arbitrary `runDigest` represents a run.
- The new tests demonstrate the bypass rather than preventing it: they construct all three supposedly production-owned artifacts locally, choose a synthetic run digest, and hash the objects themselves (`tests/site-content-release-gate-verifiers.test.ts:49-95`; `tests/site-content-publication-route.test.ts:28-71`). The production-authority test checks only source regexes and even treats the generic service-role grant as acceptance proof (`tests/site-content-production-authority.test.ts:7-21`).
- Adoption and verification SQL compare the signed evidence against those same generic-writer rows and then mark the gate booleans true (`supabase/migrations/20260824130000_add_site_content_release_and_outbox.sql:276-304`; `:680-696`). That preserves artifact integrity after insertion, not provenance before insertion.

Trigger: using any service-role client, construct three fresh, plan-shaped artifacts with the fixed owner strings, exact plan population, fixed case IDs, no failures, and an arbitrary SHA-256-shaped run digest; call the generic recorder three times. An administrator verify/adopt request then reads, validates, signs, and accepts those caller-authored claims. Conversely, the supplied operator workflow has no source path that can create legitimate artifacts at all.

Expected behavior: each gate artifact is emitted by a fixed production owner that derives its result from the actual public reader, canonical governance source/review, or canonical must-pass execution, with an owner-specific unforgeable authority and no generic service-role API capable of minting all three conclusions. Actual behavior is structurally strict but provenance-free self-attestation.

Smallest fix/proof: replace the generic JSON recorder with owner-specific source authorities that obtain/compute the relevant observation and write only their own server-derived fields. Bind each receipt to the exact plan subject and immutable raw-output digest. Add an adversarial boundary test proving that an administrator or generic service-role caller cannot submit a fabricated `current`, `locally_reviewed`, empty-failure, or arbitrary-run claim, while the real owner path can produce all three prerequisites.

### 2. MEDIUM — Generated database types do not describe the new gate-artifact table

Evidence:

- The migration defines a required `observed_at timestamptz` column and deliberately has no foreign key on `release_id` (`supabase/migrations/20260824130000_add_site_content_release_and_outbox.sql:94-104`). Pre-release artifact recording depends on that absence of a release-row FK.
- `Database` omits `observed_at` from both `Row` and `Insert`, while inventing a `site_content_release_gate_artifacts_release_id_fkey` relationship to `site_content_releases` that the migration never creates (`src/lib/supabase/database.types.ts:205-233`).

Impact: generated-client consumers cannot represent actual rows correctly and are told an impossible relationship exists. This violates the Task 3 database/types alignment requirement and can hide timestamp handling or generate invalid relationship selections.

Smallest fix/proof: regenerate or hand-align the checked-in type block from the migration: include required `observed_at` in `Row`/`Insert`, and use `Relationships: []` unless the SQL design adds a real compatible FK. Add a focused schema/type contract that compares columns and relationships for the new tables.

## Attempt 4 finding disposition

1. **Production-derived fixed-owner public-visibility/governance/must-pass evidence:** **OPEN / REWORKED BUT NOT CLOSED.** Exact owners, population, fixed case-set identity, empty failures, freshness, chronology, immutability, and digest binding are materially stronger. Finding 1 shows that the sole writer remains a generic caller-supplied JSON API with no production owner producer, so the trust property is still absent.
2. **Bearer lost before administrator mutation RPC:** **CLOSED in source.** The route extracts the already-validated bearer and constructs one user-context Supabase client carrying it in every PostgREST request (`src/app/api/admin/site-content/publish/route.ts:15-25,160`; `src/lib/supabase/server.ts:65-76`). Missing, non-administrator, and wrong-bearer tests reject before mutation; the valid-bearer test proves the exact token reaches the client and mutation RPC (`tests/site-content-publication-route.test.ts:120-145,183-230`; `tests/supabase-server.test.ts:8-33`). Provisioning alone intentionally remains on the service-role client.
3. **Parallel in-memory transaction authority:** **CLOSED for the required source-only contract.** The test-only `site-content-transaction-reference.ts` and its transaction test are deleted. The remaining production path is route -> authenticated RPC -> fixed-search-path migration/Vault authority, and the bounded consumer search found no second transition implementation. `tests/site-content-production-authority.test.ts:7-21` is only a source-contract check, not executed Postgres proof, but no live database/migration application was authorized for this task.
4. **Replayable validation bindings:** **CLOSED in source.** Both binding creators include a fresh signed UUID v4 (`src/lib/site-content/site-content-recovery-authority.ts:95-116,119-165`), while SQL validates the HMAC/purpose/project/recovery/payload/time tuple and transactionally inserts the UUID into the primary-keyed consumption table before each adopt/begin/verify/activate/rollback transition (`supabase/migrations/20260824130000_add_site_content_release_and_outbox.sql:127-163,258,352,657,715,769`). A committed successful transition makes replay return false; a later transition failure rolls the insert back with the surrounding RPC, and every route retry creates a safe new binding. Direct table and helper execution remain revoked (`:807-818`).

## Earlier finding disposition

### Attempt 1

1. **Active-release isolation / partial candidate visibility:** **CLOSED.** Active-release projection selection, pending exact-logical-ID anti-join, complete-operation requirement, and atomic activation remain unchanged.
2. **Services/forms route-domain mismatch:** **CLOSED.** The four executable domains and seven collection/detail handlers retain the accepted identity-neutral reader coverage.
3. **Weaker parallel P05 receipt authority:** **CLOSED.** Activation/rollback retain accepted P05 parser/receipt/context binding and no parallel receipt authority remains.
4. **Missing worker entrypoint / stale lease fencing:** **CLOSED.** Bounded handling, heartbeat, lease/row/generation/attempt/expiry fencing, retry, and quarantine are unchanged.
5. **Durable changed-only/reuse/tombstone/resume path:** **CLOSED in source.** Exact operation manifests, verified unchanged embedding-byte reuse, tombstones, resume bindings, and activation guards remain unchanged.
6. **Spoofable administrator flag / broad table grants:** **CLOSED.** SQL derives administrator claims, direct table access is revoked, and only the protected provision/artifact RPCs are service-role executable. Finding 1 is a separate artifact-provenance defect in the latter API.
7. **Fail-open reader / missing types / route proof:** **CLOSED for reader fallback and seven-route behavior; database/type alignment REOPENED by Finding 2.** Exact `42883` fallback, malformed/unrelated-error rejection, and active/updating/unavailable route identity remain intact.

### Attempts 2-3

1. **Missing exact pending anti-join:** **CLOSED.** The exact candidate operation/non-complete outbox anti-join remains present.
2. **Unreachable bootstrap/verification:** **PARTIALLY CLOSED.** Vault bootstrap and bearer-authenticated RPC reachability are corrected. Legitimate verification remains unreachable from the supplied source because no production owner produces gate artifacts (Finding 1).
3. **Planner/SQL operation/digest mismatch:** **CLOSED.** Plan, release, legacy reconciliation, operation, count, and target bindings remain exact.
4. **P05 parser/HMAC authority:** **CLOSED in source, including replay.** Vault custody, purpose/project/payload/recovery/expiry/MAC validation, exact P05 parser reuse, and transactionally consumed binding IDs are retained.
5. **Initial legacy/P03 CLI/adoption/resume:** **CLOSED for dry-run and guarded bearer transport; full verification remains blocked by Finding 1.** The literal source-only plan and guarded actions exist, and the bearer now reaches SQL.
6. **Permissive/parallel transaction and seven-route proof:** **CLOSED.** The parallel model is removed, and unchanged seven-route executable proof is retained.
7. **Disconnected app/SQL HMAC secrets:** **CLOSED.** The Vault-backed secret, protected provision/rotation, and source signer/verifier boundary remain unchanged.
8. **Self-attested adoption/verification gates:** **OPEN.** Finding 1 records the remaining generic-recorder provenance failure.
9. **Non-executable CLI workflow:** **CLOSED for mutation authentication; PARTIAL end-to-end because gate production is absent.**
10. **Permissive transaction model:** **CLOSED.** No parallel authority remains.

## Verdicts

SPEC_VERDICT: FAIL

The full range preserves the public reader, atomic release/outbox, fencing, changed-only reuse, tombstone, digest/count/resume, P05, Vault, administrator, CLI bearer, and replay-consumption contracts. It still does not provide production-derived independent activation-gate evidence, and the new checked-in database types are not aligned with the migration.

QUALITY_VERDICT: FAIL

The focused correction suite is green and three attempt-4 defects are materially fixed. However, its gate tests fabricate the evidence they call production-owned, its source-pattern test blesses the generic writer rather than proving owner provenance, and it misses a concrete schema/type drift. Those gaps let the highest-trust activation evidence be minted by a generic credential while tests report success.

## Positive controls observed

- The bearer is retained into the user-context Supabase client without logging or returning it; no bearer-bearing value is included in route errors or response payloads.
- Binding UUIDs are HMAC-covered, globally single-use after commit, purpose/project/recovery/payload/time-bound, and consumed inside the same database transaction as every protected transition. Direct access to the consumption table/helper is revoked.
- Direct table access remains revoked for public, anonymous, authenticated, and service-role roles; security-definer functions use fixed empty search paths. Administrator mutation functions require a database-derived claim and non-null `auth.uid()`.
- The generic artifact table is immutable per release/owner after first insert and the application/SQL validators reject wrong owners, subjects, digests, populations, case sets, failures, stale/future timestamps, or chronology. This integrity does not cure Finding 1's provenance gap.
- Previously accepted exact pending exclusion, public fallback/error semantics, one active public identity across seven routes, atomic activation/outbox, changed-only staging, verified embedding-byte reuse, tombstones, operation/digest/count/resume binding, worker lease fencing, P05 recovery/activation/rollback authority, content-free errors, and no inline provider call remain unchanged.
- The full range changes no document processing/ingestion/reindex owner and no document, corpus, embedding, provider, Supabase, database, Storage, migration, activation, deployment, or other live action occurred during this review.

## Immutable scope and package verification

- Original base: `1788f3d95c88b4df65d3e13ddc6e5a7b186e8a07`
- Attempt-5 head: `1cf43c060544577b8059a9d85b529c36492e85c6`
- Base is an ancestor of head; the full range contains exactly five commits: `10aeecc135c286fadc09e45cb2e04f43bcaefbff`, `00ec54523d7d6896d06ea6b56a622b95dcf4f46d`, `3c91ff9d6927a9df7947e10f165b6193a865212c`, `746c9578ba299e16a59f63e651bafc5d9e7f2fc7`, and `1cf43c060544577b8059a9d85b529c36492e85c6`.
- Reviewed package: `P06-repository-content-task-3-review-5.diff`
- Required SHA-256: `a280fcd9becce55c9b9137d2d354c93e49f8ab0f7b94ea3bf5cb3d5f8da131c5`
- Observed SHA-256: `a280fcd9becce55c9b9137d2d354c93e49f8ab0f7b94ea3bf5cb3d5f8da131c5` — exact match.
- `npm run ledger:lookup -- 1cf43c060544577b8059a9d85b529c36492e85c6 --scope "P06 repositoryContent task-3"`: `NOT REVIEWED at this HEAD and scope.` No ledger write was made because this review was authorized to write only this report.
- Repository instructions, canonical SDD execution, original Task 3 brief/plan/specs, programme manifest/matrix, accepted P03/P05 authorities, and review reports 1-4 were read across this same reviewer identity. Unchanged accepted evidence was reused rather than rerun.

## Focused offline verification

1. Package SHA-256, package header, exact head, ancestry, five-commit range, and `git diff --check` — exact match / PASS.
2. `GATE_RECEIPTS=off node scripts/run-vitest.mjs run tests/site-content-release-gate-verifiers.test.ts tests/site-content-publication-route.test.ts tests/site-content-recovery-authority.test.ts tests/site-content-production-authority.test.ts tests/site-content-publication-access.test.ts tests/supabase-server.test.ts` — PASS, 6 files / 30 tests. The suite proves the corrected unit/source contracts are green but does not invalidate Findings 1-2.
3. Bounded source-consumer and migration/type checks confirmed: no production caller of the gate-artifact recorder; the bearer client is used by every non-provision mutation; the parallel transaction reference is absent; all five protected transitions call the consumption helper; the consumption/artifact tables have no direct grants; and the generated gate-artifact type differs from the actual migration columns/relationships.

No network, provider, Supabase/database/Storage access, migration application, embedding, enqueueing, reindexing, activation, rollback, deployment, document/corpus processing, commit, push, or PR action occurred. The report is left untracked and unstaged.
