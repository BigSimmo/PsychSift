# P05 phase review 1

## Findings

### 1. P1 — the effective source-event RPC drops the reviewed active-indexable allowlist

The original control-plane definition rejects `activate` outside the accepted active/indexable catalogue and rejects blank or duplicate evidence (`supabase/migrations/20260820121000_create_public_source_control_plane.sql:143-197`). The later effective `create or replace` definition retains the policy digest and evidence count but removes the allowlist, reason-length, nonblank-evidence, and evidence-uniqueness checks (`supabase/migrations/20260824120000_consolidate_public_source_lifecycle_authority.sql:578-616`). Fetch authorization and staging then trust that event (`:621-658,660-734`). Because the final definition is service-role callable (`:754`), a service-role operator can activate and stage an excluded, historical, link-only, protected, or unknown catalogue key despite the accepted P02 policy. The existing schema test reads only the superseded migration (`tests/supabase-schema.test.ts:147-150,1638-1668`), so all focused tests remain green while the effective function is weaker.

Expected correction: preserve the complete accepted allowlist/evidence contract in the final function definition and test the effective last definition, not an earlier migration in isolation.

### 2. P1 — there is no supported first-version activation path

`activate_public_source_version` requires an `expectedOldVersionId` whose row already exists and is `active` (`supabase/migrations/20260824120000_consolidate_public_source_lifecycle_authority.sql:103-119`). The replacement `transition_public_source_version` explicitly refuses every target `active` (`:252-254`), while the new publication constraint refuses P02 owner-null publication until the exact version is already active (`:350-377`). No migration seeds or backfills a first active P05 version. A fresh source can therefore be activated at the definition level, acquired, staged, indexed, P02-reviewed, and moved to `approved`, but it can never complete its first exact-version activation.

Expected correction: provide one atomic first-activation path with no old version, while retaining all exact acquisition and P02 publication proofs. Keep replacement activation as the old/new swap path.

### 3. P1 — pre-existing P02 publications without a P05 row remain public

The new eligibility helper correctly requires an exact active version (`supabase/migrations/20260824120000_consolidate_public_source_lifecycle_authority.sql:328-348`), but it is unused outside generated types and static tests. Existing retrieval owners continue to treat `owner_id is null` as public; the new migration merely lists those owners in comments (`:302-314`). The constraint trigger applies only to future document inserts/updates (`:350-377`). Reconciliation visits only owner-null documents already joined to a non-active `public_source_versions` row (`:549-560`), so a catalogue-tagged P02-published document with no P05 version row is untouched and remains retrievable.

Expected correction: fail closed or re-own every existing catalogue-tagged owner-null document that cannot prove one exact active P05 version, and make the eligibility invariant executable at every retrieval boundary or otherwise prove a retroactive invariant.

### 4. P1 — source decisions and version lifecycle operations do not serialize

Replacement activation, transition, and tombstone use `hashtextextended('public_source_lifecycle:' || catalogue, 0)` (`supabase/migrations/20260824120000_consolidate_public_source_lifecycle_authority.sql:110-112,244-245,277-278`). Source-event recording, fetch authorization, and staging instead lock `hashtextextended(catalogue, 0)` (`:594,638,683`). These are different advisory locks. `activate_public_source_version` also never re-reads the latest `source_sequence` or proves that the candidate activation event remains current. A concurrent retire and replacement swap can therefore interleave between the retire function's separate make-ineligible and lifecycle-update statements (`:601-607`), leaving the newly swapped document owner-null while its version is quarantined, without the corresponding lifecycle epoch/ineligibility operation.

Expected correction: use one per-source lock namespace for every event/version operation and reprove the latest event/sequence under that lock inside activation.

### 5. P1 — P05 activation bypasses P02's publication safety primitive

P05 checks an approval row and state digest, then directly nulls artifact and document owners (`supabase/migrations/20260824120000_consolidate_public_source_lifecycle_authority.sql:130-197`). It does not require `documents.status = 'indexed'`, lock pages/images/chunks and all owner-bearing artifacts, lock ingestion/agent jobs, reject active ingestion work, or reject mismatched artifact ownership. P02's accepted publication owner performs those checks and locks (`supabase/migrations/20260822123000_govern_australian_source_activation.sql:384-443,415-425,466-481`). An approval can exist before P02 publication, so P05 can publish a non-indexed or concurrently mutating document and can race artifact changes after its digest read.

Expected correction: compose with one shared P02 publication primitive, or reproduce its complete status, ownership, artifact-lock, job-lock, and active-work contract inside the same old/new transaction.

### 6. P1 — the lifecycle epoch is not re-read before each real cache lookup

Commit `8a6184130e642bcc2ec7ec6dac66ac9b9ac016bf` correctly moves the lifecycle RPC ahead of the memoized document-stamp return inside `cacheIndexingVersion` (`src/lib/rag/rag-cache.ts:471-543`) and fails closed when the RPC fails. The main owners, however, compute one request-start stamp and pass it unchanged to both local and shared cache reads (`src/lib/rag/rag.ts:1610-1616,1667-1683,2500-2509,2535-2539`). Each cache helper accepts that supplied value instead of calling `cacheIndexingVersion` (`src/lib/rag/rag-cache.ts:182-205,355-377,546-565,636-655`). A withdrawal or replacement between the request-start read and either lookup can therefore serve an old-epoch local/shared result. Epoch failure bypass works only when a fresh epoch read is attempted; the supplied request value bypasses it.

Expected correction: re-read just the lifecycle epoch immediately before every local/shared cache use (the slower document stamp may remain memoized) and reject a supplied stamp whose epoch is no longer current.

### 7. P1 — the worker's actual protected-content scan does not use the shared normalization

The shared helper normalizes NFKC, tags, numeric entities, punctuation/whitespace, and zero-width/bidi controls (`supabase/functions/_shared/public-source-policy.ts:9-33`). The worker does not pass chunk content through that helper. Its actual database query still uses a raw regex (`supabase/functions/indexing-v3-agent/index.ts:1794-1811`) that misses `Health direct`, `Health&amp;direct`, `Australian Medicines Hand-book`, and `Therapeutic\u200bGuidelines`. The regression test invokes `forbiddenPublicSourceIdentity` directly (`tests/indexing-v3-agent.test.ts:69-80`); worker execution receives only the boolean produced by the weaker SQL regex.

Expected correction: make the real worker scan share the normalized matcher semantics and test through the worker's actual scan boundary.

### 8. P1 — the final staging override weakens exact resumability and acquisition identity

The original RPC validates the existing staging document and full version/document identity for resume (`supabase/migrations/20260820121000_create_public_source_control_plane.sql:324-381`) and performs the same full checks for new staging (`:394-429`). The final override checks only a subset of the existing version row and never loads its document before returning `resumed` (`supabase/migrations/20260824120000_consolidate_public_source_lifecycle_authority.sql:690-703`). Fresh staging at `:707-715` omits source path, document hash, file type/size, canonical URL, upstream type/length/hash, digest-only provenance, licence, `source_policy_checked`, lifecycle, and activation metadata checks. Hashing the resulting inconsistent pair later does not prove it matched the approved acquisition input.

Expected correction: restore every exact document/version check in the effective RPC, then add the new supersedes and acquisition-digest bindings without replacing the earlier fail-closed contract.

### 9. P2 — the final transition RPC removes the explicit lifecycle state machine

The final transition accepts any current lifecycle and any target in `approved`, `quarantined`, or `tombstoned` (`supabase/migrations/20260824120000_consolidate_public_source_lifecycle_authority.sql:246-260`); `p_activation_event_id` is accepted but unused. This permits rewinds such as `tombstoned -> approved`, `quarantined -> approved`, and `active -> approved`. The original explicit allowed-edge matrix is at `supabase/migrations/20260820121000_create_public_source_control_plane.sql:533-541`.

Expected correction: retain the original edge matrix, extend it only for the intentional `superseded` terminal state, and remove or validate every parameter.

## Verdicts

SPEC_VERDICT: FAIL

QUALITY_VERDICT: FAIL

The provider-free recovery vocabulary is strong and several individual acquisition/lifecycle safeguards pass, but the effective final schema and cache/worker owners do not satisfy the complete P05 controlled-acquisition, active-version serving, protected-content, atomic publication, and lifecycle-recovery contracts.

## Nine preflight finding closure matrix

| Preflight finding                                              | Disposition at final head | Evidence                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Serving/lifecycle/cache authority disconnected              | **FAIL**                  | Sequential controlled exits re-own artifacts and bump the epoch, but historical P02 publications are not reconciled (Finding 3) and real cache layers reuse a stale request-start epoch (Finding 6).                                                            |
| 2. Replacement activation/lineage non-atomic                   | **FAIL overall**          | Exact old/new IDs, immutable `supersedes_version_id`, old-before-new ordering, and the one-active index pass; retire/activate use different locks and activation does not reprove latest source authority (Finding 4).                                          |
| 3. Exact P02 receipt/version binding incomplete                | **FAIL overall**          | Exact approval/digest/generation/acquisition fields are checked, but P05 bypasses P02 publication locks/status/job/ownership gates (Finding 5), and the effective staging identity is weaker (Finding 8).                                                       |
| 4. Unchanged checks trust stale/tampered current input         | **CLOSED**                | Strict UUID parsing plus `record_unchanged_public_source_check` reprove the locked active version, catalogue, exact URL/version, and content hash before bounded audit insertion (`scripts/check-public-source-changes.ts:42-99`; final migration `:203-230`).  |
| 5. Initial/replacement acquisition is not exactly resumable    | **FAIL**                  | Deterministic document/storage identity and the multi-plan CLI retry pass, but the effective SQL resume returns without rechecking the existing document/full identity (Finding 8).                                                                             |
| 6. Protected-content normalization/encoding/worker parity      | **FAIL overall**          | Acquisition requests/requires identity encoding and shared normalization covers markup/entities/punctuation/zero-width input, but the actual worker scan remains the weaker raw regex (Finding 7).                                                              |
| 7. Source-event append order is time/UUID based                | **CLOSED narrowly**       | `source_sequence` is monotonic per source and latest-event queries order by it (`supabase/migrations/20260824120000_consolidate_public_source_lifecycle_authority.sql:4-24,564-618,621-686`). Cross-owner serialization still fails separately under Finding 4. |
| 8. Exact URL privacy accepts fragments/sensitive query keys    | **CLOSED**                | Fragments are rejected; only `download`, `format`, `lang`, `page`, and `version` keys are allowed; sensitive/unreviewed keys fail with a value-free diagnostic; transport/log tests pass (`src/lib/public-source-acquisition.ts:177-205`).                      |
| 9. Recovery opaque IDs accept adjacent/plural sensitive labels | **CLOSED**                | Opaque references strip separators before rejecting secret/credential/password/bearer/API-key/signature/signed/token substrings, including adjacent and plural forms (`src/lib/recovery-readiness-evidence.ts:13-29`).                                          |

## Other requirement assessment

- **Recovery readiness and receipts — PASS.** Strict parsing binds exact source project, operation, shared recovery-basis UUID, database/PITR/Storage/isolated-restore inputs and digests; clocks/freshness/future skew fail closed; activation/rollback receipts have distinct UUIDs, canonical digests, strict sequence/time order, exact retained-resource restoration, and historical activation-time validation (`src/lib/recovery-readiness-evidence.ts:4-472`).
- **Provider-free verifier/privacy — PASS.** The CLI reads operator-supplied JSON, emits only bounded identity/digest fields, emits a constant invalid diagnostic, and contains no provider-status integration (`scripts/verify-recovery-readiness-evidence.ts:1-74`).
- **P02/P04 accepted-package interaction — FAIL for P02 publication parity; PASS for P04 scope.** Accepted P02 and P04 receipts both bind local package `2ada405d103719fb8a921bac8b08ca6ca922850c27530185995d647a10dfa7d9`. P05 preserves P04's read-only audit/reindex owners and adds only pure receipt assertions to `src/lib/reindex-pipeline.ts`; it does not wire `commit_document_index_generation`. P02's exact approval fields are consumed, but its complete publication safety owner is bypassed (Finding 5).
- **Security-definer and ACL boundary — PASS narrowly.** New definers use fixed empty search paths and are revoked from PUBLIC/anon/authenticated; mutating entry points are service-role-only. The grant guard passes. The service-role governance implemented behind those grants is nevertheless defective under Findings 1, 4, 8, and 9.
- **No authority widening — PASS.** No legacy destructive document commit, cleanup, provider, live-source, embedding, OCR, parsing, reindex, activation, rollback, deployment, or hosted operation is wired by Task 3. The new migration is forward-only source and was not applied.
- **Controlled acquisition local boundaries — PASS where not superseded by SQL findings.** HTTPS-only exact host, DNS/non-global-IP rejection, address-pinned TLS with hostname verification, redirect revalidation, byte bounds, exact upstream/staged hashes, content type/signature/structure checks, sanitized HTML-only staging, deterministic Storage/document identity, immediate persisted authorization rechecks, enqueue ownership, withdrawal identity, and value-free diagnostics are present and exercised with synthetic fixtures.

## Immutable review identity

- Phase: `P05` — Tasks 2 and 3 of `docs/superpowers/rag-upgrade/local/plans/2026-08-20-rag-ingestion-reindex.md`
- Base: `0d5bb6a5012bd762bb53790ac24de16c7e3078c8`
- Head: `8a6184130e642bcc2ec7ec6dac66ac9b9ac016bf`
- Merge base: `0d5bb6a5012bd762bb53790ac24de16c7e3078c8`
- Canonical phase package: `docs/superpowers/rag-upgrade/execution-artifacts/rag-answer-quality-and-repository-coverage-v1/P05/P05-phase-review-1.diff`
- Canonical package SHA-256: `abd239ce68781636d97eb55e01987fd05af9bf528ee82c194ec931e1ddaec670`
- Package header range: `0d5bb6a5012bd762bb53790ac24de16c7e3078c8..8a6184130e642bcc2ec7ec6dac66ac9b9ac016bf`; nine listed commits; 7,377 lines
- Final implementer report SHA-256: `f7d90b65c35b14d3e3e9b61a2b8a51bf13b77a728cbf38d8896a252d1e449ac7`
- Accepted P02 receipt: status `accepted`, phase end `ac634ab358c92e6d943258a532aa5c6a98959e88`
- Accepted P04 receipt: status `accepted`, phase end `8dee5cc34294adfe1eb5b0e8ee267d72aa5fbc11`

## Commands and evidence

- `git rev-parse HEAD`, base, and merge-base — exact immutable identities above.
- `Get-FileHash -Algorithm SHA256` for the canonical package and implementer report — exact supplied hashes; package header and commit list match the immutable range.
- `git diff --stat`, `git diff --name-status`, and `git diff --check 0d5bb6a5..8a618413` — 28 changed files, 6,555 insertions, 8 deletions; whitespace check passed.
- `npm run ledger:lookup -- 8a6184130e642bcc2ec7ec6dac66ac9b9ac016bf --scope "P05 phase review-1"` — `NOT REVIEWED at this HEAD and scope`; no ledger write was made for this internal phase review.
- `node scripts/run-vitest.mjs run tests/public-source-activation-manifest.test.ts tests/public-source-acquisition.test.ts tests/public-source-serving-lifecycle.test.ts tests/indexing-v3-agent.test.ts tests/ingestion-enqueue.test.ts tests/rag-cache-invalidation.test.ts tests/recovery-readiness-evidence.test.ts tests/reindex-pipeline.test.ts tests/function-grants.test.ts tests/supabase-schema.test.ts` — fresh PASS, 10 files and 218 tests. Static tests do not exercise the effective cross-migration overrides described above.
- `GATE_RECEIPTS=refresh npm run typecheck` — fresh PASS at the immutable head.
- `GATE_RECEIPTS=refresh node scripts/run-vitest.mjs run tests/retrieval-owner-filter-guard.test.ts tests/retrieval-rpc-rollout.test.ts tests/rag-cache-utils.test.ts` — fresh PASS, 3 files and 18 tests; these existing owner-filter tests do not call the new unused eligibility helper.
- `npm run check:migration-role` — PASS; immutable applied history unchanged and no migration applied.
- `npm run check:function-grants` — PASS; 34 public security-definer functions revoked from PUBLIC and none reopened to PUBLIC/anon.
- `npm run check:maintainability-budgets` — PASS; `src/lib/rag/rag.ts` remains 4,362/4,362 and worker 1,993/2,191.
- Read-only effective-definition probe — confirmed: original allowlist `true`, final allowlist `false`; original existing-document resume check `true`, final `false`; final activation requires old active `true`; final transition refuses active `true`; record lock prefixed `false`, activate lock prefixed `true`; worker spaced-Healthdirect scan `false`; cache helpers accept a supplied request-start stamp `true`.
- Scoped source searches confirmed `public_source_document_is_serving_eligible` has no retrieval caller and `commit_document_index_generation` has no P05 product diff.

## No-live / no-document statement

This review used only repository source, migration text, accepted receipts/reports, static searches, and synthetic offline tests/probes. No provider or network call, Supabase/database/Storage access, migration application or status read, recovery/PITR/restore operation, source fetch, document/PDF/corpus read, parsing, OCR, upload, embedding, enqueue, worker execution, reindex, activation, rollback, cleanup, deployment, push, PR, or live status script was run. No documents were processed. No product, test, plan, receipt, or accepted predecessor artifact was edited. This report is the only write and remains untracked and unstaged.
