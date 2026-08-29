# P06 repositoryContent Task 3 review 2

## Findings

### 1. CRITICAL — A pending publication still serves the stale active projection because the required logical-ID anti-join was removed

Evidence:

- `supabase/migrations/20260824130000_add_site_content_release_and_outbox.sql:186-201` correctly selects projections from `authority.active_release_id`, but the only outbox reference at line 190 computes a global `updating` label. The projection join at lines 198-200 contains no anti-join on `pending.logical_id = projection.logical_id`.
- `publish_site_content_record` updates the public publication, epoch, and outbox transactionally at lines 146-184. Nothing in that transaction makes the affected row in the old active projection ineligible.
- The binding plan explicitly requires immediate stale exclusion and allows only unaffected same-partition records through a proven anti-join (`docs/superpowers/rag-upgrade/local/plans/2026-08-21-rag-repository-content-sync.md:340-345`); the approved spec repeats the rule at lines 231-235 and 322.
- `tests/site-content-publication-access.test.ts:77-85,147-159` checks active-release and outbox source patterns but never asserts the pending logical-ID anti-join.

Trigger: publish an edit to logical ID A while release R remains active. The RPC labels the partition `updating` but still returns A's stale projection from R. Expected behavior is to exclude A immediately while retaining only unaffected records; actual risk is that public routes and later retrieval serve text known to be stale during retry/quarantine.

Smallest fix/proof: make the active-release reader anti-join the exact non-complete outbox identities for the relevant candidate/partition, and add a transactional fixture proving A disappears immediately, B remains, and neither the new A nor a mixed release appears before activation.

### 2. CRITICAL — The migration has no reachable first activation and no permitted transition for its verification flags

Evidence:

- The migration creates an empty authority row with `active_release_id = null` at line 27 and creates no initial release or bootstrap/adoption function.
- `begin_site_content_candidate_release` casts `previousReleaseId` and then requires a matching existing `active` or `retained` predecessor via `SELECT INTO STRICT` at line 113. An empty installation can therefore never begin its first candidate.
- Every release starts with `integrity_verified`, `public_visibility_verified`, `governance_verified`, and `must_pass_verified` false at lines 17-18; activation requires all four true at lines 356-357.
- All new tables are revoked from `service_role` at lines 406-409, and there is no guarded verification/marking RPC anywhere in the migration. The only granted mutation functions are begin, publish, stage, complete/fail, activate, and rollback at lines 425-437.

Trigger: apply the migration to the intended pre-adoption state and submit the first reviewed candidate. Begin fails because no predecessor exists. Even if a release row were somehow inserted, activation always rejects its immutable false verification flags. Expected behavior is provider-free initial legacy adoption followed by a guarded evidence-bound verification transition; actual behavior makes every public RPC remain `unavailable` forever.

Smallest fix/proof: an offline database transaction test starting from the migration's exact empty state must create the initial retained/active baseline or initial candidate through the authorized adoption authority, set each verification only through evidence-bound RPCs, and atomically activate it without direct table grants.

### 3. CRITICAL — The canonical planner cannot call the SQL begin contract, while an ad-hoc payload can substitute different changed logical IDs without invalidating the claimed digests

Evidence:

- `SiteContentSyncPlan` at `src/lib/site-content/site-content-sync.ts:55-74` has neither `operations` nor a top-level `recoveryEvidenceDigest`; the constructed plan at lines 214-239 does not add them.
- The administrator route passes `body.plan` unchanged to `begin_site_content_candidate_release` (`src/app/api/admin/site-content/publish/route.ts:15-16`). The runtime probe confirmed `planner_has_operations=false` and `planner_has_top_level_recovery_evidence_digest=false`.
- SQL requires both fields at `supabase/migrations/20260824130000_add_site_content_release_and_outbox.sql:102-112`, so an actual write plan from `planSiteContentSync` is rejected.
- For an ad-hoc replacement, begin only checks that `planDigest` and `releaseDigest` look like SHA-256 values; it never recomputes either from the supplied plan. It counts changed operations at lines 137-143 but persists outbox identities only for unchanged/tombstone operations at lines 128-136.
- `publish_site_content_record` at lines 146-184 checks release metadata but never proves the published logical ID was a changed operation in that plan. Activation checks aggregate projection count and outstanding status at lines 355-359, not the exact planned logical-ID/operation set.

Trigger: declare changed logical ID A in a one-record candidate, then publish and complete B instead. If the unreachable verification transition is supplied, B can satisfy the same aggregate count and activate under A's asserted plan/release digests. Expected behavior is a recomputed, immutable operation manifest binding every logical ID, operation, content hash, counts, target, generation, and resume state; actual risk is activation of a population different from the reviewed plan.

Smallest fix/proof: persist the canonical planner's exact operation manifest at begin, recompute its plan/release digests in the authority, reject every undeclared or hash-mismatched publication, and prove swapped/additional/missing/duplicate logical IDs cannot complete or activate.

### 4. CRITICAL — SQL still implements a weaker duplicate of P05 recovery/receipt validation

Evidence:

- The accepted P05 owner is strict: `src/lib/recovery-readiness-evidence.ts:87-106` validates the complete recovery evidence and its database/PITR/Storage/restore-drill gates; lines 376-399 bind activation to project, operation, evidence, and the full receipt time window; lines 402-450 enforce exact append-only rollback identity and chronology.
- SQL introduces independent canonicalization/digest helpers at `supabase/migrations/20260824130000_add_site_content_release_and_outbox.sql:71-86` and validates only a subset of those schemas in begin/activation/rollback.
- Activation checks evidence digest and `validUntil > now()` at lines 337-339, but does not validate the evidence's project, operation, backup/PITR/Storage/restore-drill gates, or full strict schema.
- It requires receipt `recordedAt > evidence.verifiedAt` at line 353 but never requires `recordedAt <= evidence.validUntil` or `recordedAt <= now()`. P05 rejects both cases at `src/lib/recovery-readiness-evidence.ts:392-398`.
- The focused static probe found both `activation_receipt_is_bounded_by_evidence_valid_until=False` and `recovery_evidence_project_and_operation_are_sql_validated=False`.

Trigger: provide a self-digested recovery object for a foreign project or failed recovery basis, or an activation receipt dated after the evidence validity window. The SQL subset can accept it while `assertRecoveryReadinessForOperation` / `assertActivationReceiptBinding` rejects it. Expected behavior is exact reuse of the accepted P05 authority; actual risk is an activation/rollback receipt that the programme's canonical recovery owner says is invalid.

Smallest fix/proof: use one exact persisted representation produced by the P05 parsers and bind activation to its complete validated result. A parity fixture must feed valid and adversarial evidence/receipt pairs to both boundaries and require identical verdicts, including project/operation, recovery layers, strict fields, future times, validity-window end, predecessor identity, sequence, and rollback binding.

### 5. HIGH — Initial legacy reconciliation, P03 manifest consumption, and the required dry-run/write driver remain non-executable

Evidence:

- The planner computes `legacyReconciliationDigest` in memory (`src/lib/site-content/site-content-sync.ts:116-145,161,228`) but does not carry normalized dispositions/retirements in the plan. The SQL release/outbox schema never stores or verifies that digest and contains no legacy-row adoption/retirement operation.
- No synchronization owner imports or consumes P03's `StaticSiteContentManifest`; the CLI defines a reduced duplicate manifest shape and never calls `planSiteContentSync`.
- `scripts/sync-site-content-corpus.ts:24-52` rejects every write and reports `changed: 0`, `unchanged: eligible.length`, and `tombstoned: 0` without reading an active release/projection or legacy rows. Its output therefore cannot be the required changed-only, deletion-aware, disposition-bound dry run.
- The new `site-content-candidate-store.ts` is an in-memory test-side authority with `exportState`; it is not called by the administrator route, CLI, SQL, or Edge worker. Its resume test does not establish durable repository behavior.

Trigger: run initial adoption with divergent duplicates, change one manifest item, or delete one active item. The CLI still reports all eligible records unchanged, no accepted plan can reach SQL, and no executor persists the administrator disposition. Expected behavior is a provider-free P03-backed adoption/diff plan plus an explicit guarded write driver; actual risk is no adoption, false dry-run evidence, and no reviewed retirement path.

Smallest fix/proof: build the synchronization plan from the P03 manifest and exact active/legacy projections, persist the reconciliation digest and every disposition, and run an offline mixed add/change/unchanged/delete/adopt resume fixture through the same interfaces used by the real route/worker/SQL path.

### 6. HIGH — The new green tests largely validate source text, fallback fixtures, or a parallel in-memory model rather than the corrected transaction authority

Evidence:

- `tests/site-content-publication-access.test.ts:77-159` uses regular expressions over the migration. Those patterns pass despite the missing pending anti-join, bootstrap, verification transition, exact plan binding, and P05 validation described above.
- The claimed seven-route byte-parity tests configure every non-rate-limit RPC to return `42883` (`tests/registry-records-route.test.ts:121-142`, `tests/medications-route.test.ts:109-130`, and `tests/differentials-route.test.ts:83-106`). The tests at registry lines 204-233, medications lines 194 onward, and differentials lines 176 onward therefore compare bundled fallback bytes, not active/updating/unavailable release-RPC bytes.
- The resumability assertion exercises `createCandidateProjectionStore` (`tests/site-content-sync.test.ts:248-286`), not the SQL outbox/projection functions used by the deployed worker.
- The implementer reports 12 files/189 tests and a narrower 4 files/20 tests green. Those results are accepted as reported and were not repeated, but they do not cover the failure paths above.

Smallest fix/proof: replace source-shape assertions for these invariants with an offline PostgreSQL transaction harness (or repository-standard equivalent) and make route mocks return valid active/updating/unavailable RPC partitions across all seven routes and all three reader identities.

## Prior finding disposition

1. **Active-release isolation / partial visibility:** **OPEN.** Exact active-release projection and non-null completion were added, but the required pending-record anti-join and exact planned-identity binding remain absent (Findings 1 and 3).
2. **Registry services/forms domain mismatch:** **CLOSED in source.** SQL now accepts the route domains. End-to-end parity remains unprovable because initial activation is unreachable (Finding 2).
3. **P05 recovery/rollback authority:** **OPEN.** The parallel receipt table was removed and predecessor binding improved, but SQL still duplicates only a weaker subset (Finding 4).
4. **Worker entrypoint and lease fencing:** **CLOSED for the prior defects.** A concrete handler, attempt fencing, periodic heartbeat, exact candidate completion, and expiry checks were added. Live deployment/invocation remains explicitly unrun.
5. **Durable changed-only/resume/tombstone/embedding path:** **OPEN.** SQL staging functions now exist, but the canonical plan/driver cannot reach them and identities/digests/adoption are not bound end-to-end (Findings 3 and 5).
6. **Administrator mutation authority:** **CLOSED for the spoofable flag/direct-grant defect.** The route and SQL derive the administrator claim and direct table grants were removed. A real retire/adoption driver remains missing under Finding 5.
7. **Reader fail-open and generated types:** **CLOSED.** Runtime probing confirmed unrelated errors and malformed payloads throw; generated table types are present. The active-RPC route coverage gap remains Finding 6.

## Verdicts

SPEC_VERDICT: FAIL

The retry does not meet Task 3's transactional stale exclusion, initial legacy adoption, exact plan/digest/identity binding, reachable activation, or exact P05 recovery-authority requirements.

QUALITY_VERDICT: FAIL

The principal paths are internally incompatible or unreachable, and the green tests do not execute the database transaction authority or active-release route semantics needed to detect those failures.

## Positive controls observed

- Package range now binds public reads to the exact active release projection and makes completion require the exact non-null candidate release.
- Services/forms domain alignment, strict `42883`-only fallback, malformed-response rejection, generated table types, database-derived administrator authorization, least-privilege table revocation, fixed search paths, attempt/lease/generation fencing, expiry-fenced failure, a concrete bounded handler, periodic heartbeat, quarantine blocking, and content-free logs are materially improved.
- Publication still performs no provider call inline; the provider call is confined to the outbox worker.
- `src/lib/rag/rag.ts` and document API/ingestion/indexing owners remain unchanged from attempt 1's verified evidence.

These improvements do not offset the blocking executable-path findings.

## Immutable scope and package verification

- Original base: `1788f3d95c88b4df65d3e13ddc6e5a7b186e8a07`
- Retry head: `00ec54523d7d6896d06ea6b56a622b95dcf4f46d`
- Base is an ancestor of head; the range contains exactly two commits (`10aeecc135c286fadc09e45cb2e04f43bcaefbff`, `00ec54523d7d6896d06ea6b56a622b95dcf4f46d`).
- Reviewed package: `P06-repository-content-task-3-review-2.diff`
- Required SHA-256: `4c585b3924065da884cf9044efd9fb0b61c809a891ba4cddba32b568a7a34466`
- Observed SHA-256: `4c585b3924065da884cf9044efd9fb0b61c809a891ba4cddba32b568a7a34466` — exact match.
- `npm run ledger:lookup -- 00ec54523d7d6896d06ea6b56a622b95dcf4f46d --scope "P06 repositoryContent task-3"`: `NOT REVIEWED at this HEAD and scope.` No ledger write was made because this review may write only this report.
- Canonical instructions, Task 3 plan/spec/brief, P03/P05 accepted authorities, and review protocol are unchanged since attempt 1 and their previously verified evidence was reused.

## Focused offline verification

Only two distinct retry probes were run; the implementer's green suite was not repeated.

1. Corrected-claim static transaction-authority probe — exit 1, intentionally reporting eight unmet invariants:
   - `active_reader_exact_pending_logical_id_antijoin=False`
   - `empty_authority_bootstrap_function_exists=False`
   - `verification_flags_have_guarded_transition_rpc=False`
   - `changed_operation_identity_is_persisted_at_begin=False`
   - `plan_digest_is_recomputed_from_plan=False`
   - `activation_receipt_is_bounded_by_evidence_valid_until=False`
   - `recovery_evidence_project_and_operation_are_sql_validated=False`
   - `worker_requires_nonempty_runtime_secrets=False` (configuration-hardening observation only; not promoted to a separate blocker because missing credentials currently make the direct handler reject).
2. `node --import tsx --input-type=module -e <retry contract probe>` — exit 1 on planner/SQL incompatibility while confirming the prior reader fix:
   - `reader_unrelated_error_throws=true`
   - `reader_malformed_response_throws=true`
   - `planner_has_operations=false`
   - `planner_has_top_level_recovery_evidence_digest=false`
   - `empty_runtime_secret_request_status=401`

No network, provider, Supabase/database/Storage access, migration application, embedding, enqueueing, reindexing, activation, rollback, deployment, document/corpus processing, commit, push, or PR action occurred.

