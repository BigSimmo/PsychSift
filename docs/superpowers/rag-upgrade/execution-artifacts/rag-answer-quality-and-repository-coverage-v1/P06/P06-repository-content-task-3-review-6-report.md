# P06 repositoryContent Task 3 review 6

## Findings

### 1. HIGH — The two new owner HMAC authorities have no deployable Vault custody/rotation path and are not guaranteed distinct

Evidence:

- Governance and must-pass receipts are signed from two process environment variables (`scripts/create-site-content-gate-owner-receipt.ts:22-39`). SQL verifies them against two different named Vault entries (`supabase/migrations/20260824130000_add_site_content_release_and_outbox.sql:165-182,214-217`).
- The bounded full-range consumer/provisioning search found no source path that creates, rotates, or checks either `site_content_governance_gate_owner_secret` or `rag_programme_gate_owner_secret`. The only Vault provisioner creates/rotates `site_content_recovery_validation_secret` (`supabase/migrations/20260824130000_add_site_content_release_and_outbox.sql:275-301`), and the route/CLI exposes only that provisioner (`src/app/api/admin/site-content/publish/route.ts:31-42`; `scripts/sync-site-content-corpus.ts:127-136,235-251`).
- Nothing proves the two owner secrets differ from each other or from the recovery signer secret. The provenance test actually signs both owners with the same `secret` constant (`tests/site-content-gate-owner-provenance.test.ts:24,102-108`). HMAC coverage includes the owner claim, but if the keys are equal, either key holder can recompute a valid receipt for the other owner; message purpose binding does not create key separation.
- The SQL verifier correctly fails closed when its named Vault entry is absent (`supabase/migrations/20260824130000_add_site_content_release_and_outbox.sql:170-179`). Thus the supplied deployment/operator path cannot validate either receipt until an undocumented, out-of-band Vault mutation occurs. Such a live mutation is explicitly outside this source-only task and is not a deployable repository contract.

Trigger A: deploy the reviewed source and use the advertised guarded provision action. It provisions only the recovery binding secret; the first owner receipt derivation returns `fixed gate-owner output invalid` because both owner Vault lookups are empty. Trigger B: configure both named entries to the same key, which no source guard forbids; a holder of the governance key can sign a must-pass-shaped message and SQL accepts it under the must-pass name.

Expected behavior: independently controlled owner signer/verifier keys have an explicit source-owned provision/rotation contract, exact predecessor/rotation audit, non-exposure, and enforced digest inequality across governance, must-pass, and recovery purposes. Actual behavior splits environment signers from unavailable Vault verifiers and relies on unverified operator discipline for key separation.

Smallest fix/proof: add an owner-specific deployment/provisioning authority that cannot mint receipts, provisions/rotates only the fixed owner Vault name, exposes digests only, and rejects a new digest equal to either other owner/recovery digest. Do not grant a generic service-role receipt-writing path. Add source-boundary tests for initial provisioning, rotation, absent keys, equal-key rejection, wrong-owner key rejection, and raw-secret non-exposure.

### 2. HIGH — A first guarded candidate verification rejects the public artifact that SQL just created

Evidence:

- The route captures `now` before any derivation RPC (`src/app/api/admin/site-content/publish/route.ts:26-30`), then calls `derive_site_content_release_gate_artifacts`, reads the result, and verifies it using that earlier timestamp (`:88-105`).
- SQL stamps the public-visibility artifact with `clock_timestamp()` inside the later RPC (`supabase/migrations/20260824130000_add_site_content_release_and_outbox.sql:186-191,236-252`). In an ordinary request this observation is later than the route's captured clock.
- `verifySiteContentReleaseGateArtifacts` rejects any artifact whose timestamp is greater than its supplied `now` (`src/lib/site-content/site-content-release-evidence.ts:113-123,178-188`). Therefore the newly derived SQL public artifact is treated as future-dated.
- Derivation is its own successfully committed RPC. A later retry can work because the function returns the already immutable three-row set without re-deriving it (`supabase/migrations/20260824130000_add_site_content_release_and_outbox.sql:193-200`), and that later request captures a clock after the stored public observation. The literal CLI sends one verify request and treats a non-success response as failure (`scripts/sync-site-content-corpus.ts:61-78,152-162`), so the supported operation is spuriously fail-once/retry rather than executable once.
- The route test cannot see this boundary: it freezes one JavaScript clock and injects already stored artifacts timestamped one minute earlier, while its mocked derive RPC does no database stamping (`tests/site-content-publication-route.test.ts:28-80,251-293`).

Trigger: on a candidate with complete operations and no gate rows, send one valid guarded `verify`. SQL commits all three rows, the route then rejects public visibility as future-dated, and the CLI reports failure. Send the same logical operation again with fresh bindings and it may pass.

Expected behavior: the first valid verification succeeds atomically/reliably; actual behavior always depends on an undocumented retry after a committed intermediate RPC.

Smallest fix/proof: capture the evidence-verification clock after derivation/read, or have SQL return one authoritative observation time that the application binds consistently without widening future tolerance. Add an offline faithful route/RPC-clock test where SQL-derived public time is later than request entry and prove first-call success, stale/future rejection, and safe retry after response loss.

### 3. HIGH — Initial adoption cannot bootstrap exact owner receipts through the literal guarded CLI

Evidence:

- Both owner producers require a canonical plan file and bind its exact `planDigest` into the receipt subject (`scripts/create-site-content-gate-owner-receipt.ts:17-39`; `src/lib/site-content/site-content-gate-owners.ts:52-59,109-125,146-161`).
- The sync CLI produces `mode: "dry-run"` unless `--write` is present, while `mode` participates in the final `planDigest` (`scripts/sync-site-content-corpus.ts:206-223`; `src/lib/site-content/site-content-sync.ts:336-368`). A receipt made from the printed dry-run plan cannot match the required write plan.
- With `--write --action adopt`, the CLI constructs the write plan but requires governance and must-pass receipts already present in the input state, sends the adoption request, and prints the plan only after that request returns (`scripts/sync-site-content-corpus.ts:224-255`; write-driver lines `139-150`). There is no guarded write-plan-only/output-plan-before-mutation action.
- SQL adoption requires exact write mode and derives against the persisted plan subject, so dry-run-subject receipts fail closed (`supabase/migrations/20260824130000_add_site_content_release_and_outbox.sql:311-374`). On an empty baseline, `begin` cannot be used merely to obtain the plan because it requires the previous active release.
- The CLI test avoids the cycle by constructing a write plan directly in memory, injecting a mocked sender, and passing placeholder receipt objects; it never runs the literal CLI/receipt handoff (`tests/site-content-sync-cli.test.ts:105-150`).

Trigger: run the supported dry-run, generate both receipts from its output, place them in state, then run `--write --action adopt`; SQL rejects the receipt subject because write-mode `planDigest` differs. Alternatively invoke write adoption without receipts; it fails before the plan is printed.

Expected behavior: source-only planning yields the exact prospective write plan before authority creation, then independent owners sign that immutable subject, and the guarded adoption consumes it. Actual behavior is a circular plan/receipt dependency for first adoption.

Smallest fix/proof: add a provider-free, non-mutating command that emits the exact write-mode prospective plan while still refusing mutation, then accept that same plan file (or assert byte/digest equality) during guarded adoption. Add a literal CLI integration with real plan and owner-receipt creators plus mocked transport, proving dry-run remains non-writing and the first adoption request carries receipts for exactly its write plan.

### 4. MEDIUM — The must-pass receipt's `gatePolicyDigest` does not identify the policy that made the decision

Evidence:

- The producer runs the real `compareRagProgrammeRuns` default gate, but records `gatePolicyDigest` as the digest of `{ decision, reasons }`, not the digest of `ragProgrammeGatePolicy` or any threshold/version contract (`src/lib/site-content/site-content-gate-owners.ts:128-161`).
- SQL checks the fixed case set, exact IDs, empty failures, and run-digest shapes, but neither recomputes nor compares `gatePolicyDigest`; it simply copies that field into the stored artifact (`supabase/migrations/20260824130000_add_site_content_release_and_outbox.sql:227-247`). The application verifier also ignores the policy identity (`src/lib/site-content/site-content-release-evidence.ts:168-176`).

Impact: the receipt authenticates that the current producer returned `GO`, but its field named `gatePolicyDigest` cannot prove which latency, cost, recall, hard-violation, or regression thresholds produced that result. Policy drift can therefore retain an apparently policy-bound receipt without a detectable policy identity change.

Smallest fix/proof: digest the exact versioned `ragProgrammeGatePolicy`, include that digest in the fixed SQL/application expectation, and keep the decision/output digest as a separate field. Test that changing one threshold invalidates the receipt even when the same runs still produce `GO`.

## Attempt 5 finding disposition

1. **Generic self-attested release-gate provenance:** **PARTIALLY CLOSED; REOPENED by Findings 1-3.** The generic artifact recorder and service-role grant are removed. Governance receipts are derived from a digest-verified P03 manifest plus exact plan population (`src/lib/site-content/site-content-gate-owners.ts:78-126`); must-pass receipts parse the canonical fixture and execute the real baseline/candidate comparison (`:128-162`); SQL derives public visibility from exact complete candidate projections and stores one immutable three-row set (`supabase/migrations/20260824130000_add_site_content_release_and_outbox.sql:186-254`). Arbitrary administrator/service-role JSON cannot bypass the HMACs, and direct helper/table access remains revoked. However the independent keys are not deployably provisioned/distinct (Finding 1), first verification is fail-once (Finding 2), and initial adoption cannot obtain the exact write subject through the literal CLI (Finding 3).
2. **Generated gate-artifact table/type mismatch:** **CLOSED.** `observed_at` is required in `Row` and `Insert`, and `Relationships: []` matches the intentionally FK-free SQL table (`src/lib/supabase/database.types.ts:205-228`; migration lines `94-104`). The focused exact-column/relationship contract passes (`tests/site-content-gate-types-parity.test.ts:5-38`).

## Preserved earlier disposition

- **Bearer preserved into mutation RPCs:** **CLOSED.** The bearer user client remains the authority for all non-provision mutations; missing, wrong, and non-admin paths remain rejected.
- **Parallel in-memory transaction authority:** **CLOSED.** The test-only implementation remains deleted; route -> authenticated RPC -> fixed-search-path SQL/Vault is the sole transition source path.
- **Validation-binding replay:** **CLOSED in source.** Signed UUID identities remain transactionally consumed in every adopt/begin/verify/activate/rollback transition; rollback/retry semantics remain unchanged.
- **Recovery Vault/P05 authority:** **CLOSED.** The existing recovery secret provision/rotation, exact P05 parser/receipt/context binding, expiry/purpose/project/payload protection, activation, and rollback remain intact. Finding 1 applies only to the two newly introduced owner secrets.
- **Exact pending anti-join, one public logical identity, active-release isolation, fallback/error semantics, seven-route parity, operation/target/digest/count/resume binding, changed-only staging, verified embedding-byte reuse, tombstones, lease/row/generation/attempt/retry/quarantine/heartbeat fencing, atomic publication/epoch/pending/outbox, and partial-activation prevention:** **CLOSED / unchanged.** The sixth commit does not weaken the previously reviewed implementations.
- **Administrator-only mutation, fixed search paths, least-privilege direct-table revocation, content-free errors/logs, and no inline provider call:** **CLOSED / unchanged.** The new derive RPC is granted only to `authenticated` and performs its own administrator/non-null-user check; the owner-verifier helper has no external execute grant.
- **Initial P03 planning/operator path:** **REOPENED only for adoption receipt bootstrap (Finding 3).** The ordinary dry-run, begin/resume/publish/verify/activate transports and bearer propagation remain present.

## Verdicts

SPEC_VERDICT: FAIL

The full range now has a materially stronger, non-generic provenance design and exact table/type parity, while preserving the accepted release, reader, worker, recovery, and fencing contracts. It still lacks deployable and cross-purpose-safe custody for the two verifier secrets, fails the first valid candidate verification because of clock ownership, and cannot bootstrap exact write-plan receipts for initial adoption through the required literal CLI.

QUALITY_VERDICT: FAIL

The focused suite is green, but it uses one secret for both supposedly independent owners, mocks away SQL clock ordering, and constructs a write plan directly instead of exercising the literal adoption handoff. It also labels a decision digest as a policy digest. These tests do not protect the deployability and trust boundaries they claim.

## Positive controls observed

- The attempt-5 generic service-role artifact recorder and grant are absent. An arbitrary service-role JSON/digest/pass/timestamp submission has no direct writer and cannot call the authenticated administrator derive RPC or the revoked receipt-verifier helper.
- The governance producer validates the P03 manifest digest, registry/static identity, source/validation state, exact eligible logical-ID/content-hash population, and legacy reconciliation/dispositions binding before signing.
- The must-pass producer parses the versioned canonical fixture, proves all protected failure classes and population fingerprints through the existing parser/comparator, compares exact baseline/candidate case populations and metrics, requires `GO`, and rejects any failed candidate case before signing.
- SQL binds each receipt to the exact persisted release subject, a fixed owner and fixed Vault name; validates freshness and HMAC; derives public visibility from exact non-tombstoned persisted projections only after every operation is complete; and inserts the three immutable artifacts in one statement.
- Artifact/table access is revoked for public, anonymous, authenticated, and service-role roles; all new security-definer functions use an empty fixed search path. The derive/read functions require the database administrator claim and non-null `auth.uid()`.
- Generated columns/relationships now exactly match the migration, and the attempt-5 bearer, no-parallel-authority, replay consumption, recovery Vault/P05, anti-join, reader/routes, durable synchronization, and worker findings remain closed.
- No document-processing, ingestion, reindex, embedding, provider, Supabase, database, Storage, migration, activation, deployment, or other live action was performed.

## Immutable scope and package verification

- Original base: `1788f3d95c88b4df65d3e13ddc6e5a7b186e8a07`
- Attempt-6 head: `c197600a52ee9584f37989a4b36b9bb780d12849`
- Base is an ancestor of head; the full range contains exactly six commits: `10aeecc135c286fadc09e45cb2e04f43bcaefbff`, `00ec54523d7d6896d06ea6b56a622b95dcf4f46d`, `3c91ff9d6927a9df7947e10f165b6193a865212c`, `746c9578ba299e16a59f63e651bafc5d9e7f2fc7`, `1cf43c060544577b8059a9d85b529c36492e85c6`, and `c197600a52ee9584f37989a4b36b9bb780d12849`.
- Reviewed package: `P06-repository-content-task-3-review-6.diff`
- Required SHA-256: `19cc6293155ecf19e1ebefe4fd49029c9d38133708dceacb878b53b68e600ec9`
- Observed SHA-256: `19cc6293155ecf19e1ebefe4fd49029c9d38133708dceacb878b53b68e600ec9` — exact match.
- `npm run ledger:lookup -- c197600a52ee9584f37989a4b36b9bb780d12849 --scope "P06 repositoryContent task-3"`: `NOT REVIEWED at this HEAD and scope.` No ledger write was made because this review was authorized to write only this report.
- Repository instructions, canonical SDD execution, original Task 3 brief/plan/specs, programme manifest/matrix, accepted P03/P05 authorities, and reports 1-5 were reviewed across this same reviewer identity. The sixth commit changes none of those canonical instruction/spec artifacts, so accepted unchanged evidence was reused.

## Focused offline verification

1. Package SHA-256, package header, exact head, ancestry, six-commit range, and `git diff --check` — exact match / PASS.
2. `GATE_RECEIPTS=off node scripts/run-vitest.mjs run tests/site-content-gate-owner-provenance.test.ts tests/site-content-gate-types-parity.test.ts tests/site-content-publication-route.test.ts tests/site-content-production-authority.test.ts tests/site-content-sync-cli.test.ts tests/site-content-release-gate-verifiers.test.ts tests/site-content-publication-access.test.ts tests/site-content-recovery-authority.test.ts` — PASS, 8 files / 30 tests. The suite proves the corrected units/source patterns are green but misses Findings 1-4.
3. Bounded source/privilege checks confirmed no generic artifact recorder/grant, no production provision/rotation owner for either new Vault secret, no owner-secret distinctness guard, no direct table/helper grant, the exact route clock ordering, the dry-run/write-plan digest distinction, the circular adoption receipt handoff, and exact migration/type parity.

No network, provider, Supabase/database/Storage access, migration application, embedding, enqueueing, reindexing, activation, rollback, deployment, document/corpus processing, commit, push, or PR action occurred. The report is left untracked and unstaged.
