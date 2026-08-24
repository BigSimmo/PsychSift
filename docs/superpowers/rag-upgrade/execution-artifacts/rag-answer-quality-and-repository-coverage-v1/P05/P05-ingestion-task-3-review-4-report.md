# P05 ingestion Task 3 review 4 report

## Findings

### P1 Critical — atomic activation publishes artifacts whose owner was never approved

- **Evidence:** `activate_public_source_version` proves the document row and the append-only approval, but then unconditionally changes every owner-bearing artifact to `owner_id = null` (`supabase/migrations/20260824120000_consolidate_public_source_lifecycle_authority.sql:130-162,177-195`). It never checks that those artifact rows still belong to `v_new_version.staging_owner_id`. The approval digest cannot close this gap: `document_publication_state_digest` deliberately removes `owner_id` from labels, summaries, sections, memory cards, table facts, embedding fields, quality, and index units (`supabase/migrations/20260722190000_bind_publication_approval_to_reviewed_state.sql:43-109`). The accepted P02 activation owner explicitly rejected any one of those rows with a different owner before publication (`supabase/migrations/20260822123000_govern_australian_source_activation.sql:446-476`).
- **Trigger / smallest proof:** keep the document owned by staging owner A and its reviewed bytes/state unchanged, but attach or alter one `document_labels`/`document_sections`/other owner-bearing row to owner B. The state digest remains the approved digest because artifact owner columns are excluded. The new activation RPC then changes B's row to public instead of failing.
- **Expected:** atomic activation must lock and require the exact staging owner on every owner-bearing artifact before any owner is cleared.
- **Actual risk:** a cross-owner artifact can be disclosed to anonymous/public retrieval under an otherwise valid P02 approval. This violates the exact P02 identity and privacy boundary.
- **Smallest fix:** restore the complete owner-mismatch `exists (... union all ...)` fail-closed check from the accepted P02 activation owner, under row locks, before retiring the old version; add a regression in which one artifact owner differs and the entire swap aborts.

### P1 Critical — protected-source text passes both admission checks when split by a named HTML entity

- **Evidence:** `normalizedProtectedIdentity` decodes numeric references and a short hand-written named-entity subset, then treats all remaining letters as content (`supabase/functions/_shared/public-source-policy.ts:9-23`). Named whitespace entities such as `&Tab;` and `&NewLine;` therefore inject the letters `tab`/`newline` into the compact identity and break every protected marker. `evaluateTrustedPageContent` and the production local content-identity scan both call this same predicate (`src/lib/public-source-acquisition.ts:95-116,591-640,651-689`).
- **Trigger / smallest proof:** the offline exact-head probe passed `<main>Health&Tab;direct guidance</main>`, `<main>Australian Medicines&Tab;Handbook excerpt</main>`, and `<main>Therapeutic&NewLine;Guidelines advice</main>` through `evaluateTrustedPageContent` as `eligibleForIndex: true`, then through `localPublicSourceContentIdentityVerdict` as `accepted: true, contentIdentity: "clear"`.
- **Expected:** markup/entity normalization must not let Healthdirect, AMH, or Therapeutic Guidelines identities disappear before either acquisition or worker admission.
- **Actual risk:** explicitly forbidden source content can reach Storage, ingestion, embeddings, searchable chunks, prompts, and citations despite the two advertised fail-closed checks.
- **Smallest fix:** use one complete HTML character-reference decoder before identity normalization, or conservatively remove every syntactically valid residual entity token without retaining its name; add the three exact end-to-end regressions above at both acquisition and worker boundaries.

### P1 Critical — lifecycle epoch is still bypassed on real cache-read paths

- **Evidence:** the final commit correctly queries `public_source_serving_authority_stamp` before returning a memoized document stamp inside `cacheIndexingVersion` (`src/lib/rag/rag-cache.ts:471-488`). However all four cache readers accept `indexingVersionAtRequestStart` and skip `cacheIndexingVersion` entirely when it is supplied (`src/lib/rag/rag-cache.ts:182-203,355-373,546-561,636-648`). Production supplies that value: search reads it before query classification and alias loading, then reuses it for local and shared cache access (`src/lib/rag/rag.ts:1610-1631,1665-1683`); answer lookup similarly passes it into both readers (`src/lib/rag/rag.ts:2500-2537`). The new test only asserts RPC ordering inside `cacheIndexingVersion`, so it does not cover this caller-visible bypass (`tests/public-source-serving-lifecycle.test.ts:81-96`).
- **Trigger / smallest proof:** a request reads epoch 1; while classification/alias work is pending, activation or tombstone commits epoch 2. The database transaction removes shared rows, but cannot clear another process's local `searchCache`/`answerCache`. `getCachedSearch` or `getCachedAnswer` receives the epoch-1 option, performs no authority RPC, sees an epoch-1 local entry, and returns superseded content after the lifecycle exit committed. An authority RPC failure on that access is likewise never observed.
- **Expected:** the current lifecycle epoch is read immediately before every cache read, even when the slower document/index component is memoized or a request-start stamp exists; inability to read it must bypass that cache surface.
- **Actual risk:** quarantined, retired, tombstoned, or superseded public clinical content remains servable from process-local cache during an ordinary request race, defeating the central serving authority.
- **Smallest fix:** separate the memoized document stamp from the non-memoized lifecycle epoch. Have every read helper fetch the current epoch and compare it with the cached/request stamp before touching/returning cache data; return a miss on RPC failure. Add a deferred-classification regression that bumps the mocked epoch between request-start capture and local/shared access.

### P1 Critical — activation can use a superseded source authority and does not share the event lock

- **Evidence:** `activate_public_source_version` locks a key prefixed with `public_source_lifecycle:` but never selects or verifies the latest activation event (`supabase/migrations/20260824120000_consolidate_public_source_lifecycle_authority.sql:110-162`). Event recording, fetch-manifest creation, and staging instead lock the unprefixed catalogue key and select latest authority by `source_sequence` (`...consolidate_public_source_lifecycle_authority.sql:564-599,621-645,660-688`). Thus activation neither serializes with the authority owners nor rechecks that `v_new_version.activation_event_id` is still the latest `activate` event with the same policy.
- **Trigger / smallest proof:** stage and approve candidate V under activation event E1; append a newer `activate` event E2 for the same catalogue while the old serving version remains active; call atomic activation for V/E1. Old/new lifecycle, lineage, acquisition digest, and P02 approval can all match, and the RPC succeeds because it never observes E2. The static exact-head probe reported `activation_rechecks_latest_event=False` and distinct activation/event advisory-lock keys.
- **Expected:** activation must be serialized with event creation and must prove the candidate's activation event is the current monotonic per-source authority immediately before publication.
- **Actual risk:** a candidate approved under a superseded source definition can become public after an operator has issued a newer activation authority; the mismatched locks also leave event/activation ordering race-prone.
- **Smallest fix:** use one canonical advisory-lock key across record/fetch/stage/activate/retire owners, then select the latest event `order by source_sequence desc ... for update` and require its ID, decision, policy version, and digest to equal the candidate before any old-version exit. Add sequential E1/E2 and concurrent-order regressions.

### P2 Important — the resumable shadow path no longer authenticates the complete persisted acquisition

- **Evidence:** once the `(catalogueKey, exactUrl, contentHash)` row is found, `stage_public_source_version` checks only lifecycle, owner, activation event, exact version, staged hash, and supersedes ID, then returns `resumed` without loading the staging document (`supabase/migrations/20260824120000_consolidate_public_source_lifecycle_authority.sql:690-704`). It does not compare policy version/digest, exact canonical URL, licence digest, document identity/path/hash/type/size, content mode/licence/policy check, source type/length/provenance, canonical Storage path, content-identity hash, or the stored acquisition digest. The exact-head static probe reported all of `resume_checks_document`, `resume_checks_policy_digest`, `resume_checks_canonical`, and `resume_checks_licence` as false. The replaced owner had complete row and document comparisons before returning `resumed` (`supabase/migrations/20260820121000_create_public_source_control_plane.sql:324-387`).
- **Trigger / smallest proof:** retry the same exact URL/source hash with a changed canonical URL or licence evidence digest, or mutate the retained shadow document's owner-bound metadata/path after the checkpoint. The RPC returns the old version/document as resumed and the CLI enqueues it under the new candidate facts rather than rejecting the non-identical checkpoint.
- **Expected:** resume is idempotent only for the byte-for-byte authorization/acquisition identity and the still-intact owned shadow checkpoint.
- **Actual risk:** retries silently conflate distinct authorizations or a drifted/corrupt persisted shadow, undermining the acquisition digest and deterministic checkpoint claims. Later activation checks catch some document drift, but they cannot make the retry truthful or prevent work from being enqueued against the wrong checkpoint.
- **Smallest fix:** restore the complete existing-version plus locked-document identity matrix, including exact stored acquisition-digest recomputation/comparison and immutable lineage, before returning `resumed`; add one negative regression for every fact in the canonical acquisition digest.

No other P0-P2 finding was identified across the complete immutable range.

## Prior Task 3 finding disposition and contract recheck

- **Attempt 1 (five findings): closed.** Both receipt inputs are strictly parsed and canonical-digest verified; clocks are finite, ordered, freshness-bound, and future-skew bounded; every recovery layer is exact-project/shared-basis/drill-digest bound; activation/rollback identities are distinct and strictly append; evidence references are structured, strict, and reject raw output, URLs, credentials, and unknown fields.
- **Attempt 2 (three findings): closed.** Rollback replays complete readiness at the immutable activation time while allowing evidence to expire only later; scheme/credential/token/secret-labelled references reject; the offline verifier is named in the scripts index.
- **Attempt 3 (one finding): closed.** Sensitive markers reject regardless of alphanumeric adjacency or plural form, including all eight prior accepted examples.
- Recovery evidence still covers database backup, PITR/RPO, Storage inventory/recovery, and a successful isolated restore drill with exact project, operation, recovery basis, target, layer digests, and stop conditions. Canonical hashing is property-order independent while retaining every strict authorization fact.
- Activation receipts still require a distinct retained previous resource; rollback authenticates the exact promotion-bound evidence/receipt/resource without requiring evidence to remain freshly aged at rollback; reconstruction is rejected. Site-release and document-generation identities remain discriminated.
- The verifier remains import-safe, local/offline, content-free on success/error boundaries, and does not import the prohibited recovery-status script. No destructive generation-commit claim or wiring was added.
- The consolidated migration is forward-only, uses fixed empty search paths on security definers, revokes PUBLIC/anon/authenticated execution, and exposes bounded service-role entry points. Static migration-role and function-grant gates pass. The five findings above keep the consolidated lifecycle/acquisition/cache/privacy claims open.

## Reviewed range and artifact identity

- Task: `P05/ingestion/task-3`, correction review attempt 4 by the same independent reviewer.
- TASK_BASE: `62adef3b97906f6164f3d568712141dd9cd4117d`.
- FINAL TASK_HEAD: `8a6184130e642bcc2ec7ec6dac66ac9b9ac016bf`.
- HEAD and merge base resolved exactly. The immutable range contains `c0f09a27e`, `48ca64361`, `866944e12`, `ad2c90c0a`, and `8a6184130`; 18 files, 2,616 insertions, and 47 deletions.
- Canonical full-range package `P05-ingestion-task-3-review-4.diff`: supplied and verified SHA-256 `026ec24759255827eb3da74b72d3a133ef89d574382e4e4874d2a676119e892a`; all 3,936 lines were read. The interrupted superseded `ad2c90c0a` package was discarded and was not used as review authority.
- Final implementer report: supplied and verified SHA-256 `f7d90b65c35b14d3e3e9b61a2b8a51bf13b77a728cbf38d8896a252d1e449ac7`; all 238 lines were read.
- Prior review-3 report: supplied and verified SHA-256 `8dbc4a26f8e9d13267be596f5b71c0c7945a0d081bbcb7deba6dd9f9a9272003`.
- Immutable Task 3 brief: supplied and verified SHA-256 `fd3774d84e4e259f820ea35619c5dfb17b314cbf02cad16b09eb1e963ca17614`.
- The complete package/range, brief, governing plan/spec, implementer claims, prior findings, accepted P02/public-source owners, reindex owner, migration security/grants, retrieval/cache fail-closed behavior, and final cache correction were reviewed. Working-tree or later-head product content was not used as review authority.
- `npm run ledger:lookup -- 8a6184130e642bcc2ec7ec6dac66ac9b9ac016bf --scope "P05/ingestion/task-3 SDD review-4"` returned `NOT REVIEWED at this HEAD and scope`. No ledger record was appended because this controller-owned SDD report is the requested review record.

## Commands and evidence

- Read-only Git resolution, branch/status, merge-base, ordered log, range name/status/stat, and SHA-256 verification — exact immutable range and every supplied artifact hash matched.
- `node scripts/run-vitest.mjs run tests/public-source-serving-lifecycle.test.ts tests/public-source-acquisition.test.ts tests/indexing-v3-agent.test.ts tests/rag-cache-invalidation.test.ts tests/function-grants.test.ts tests/recovery-readiness-evidence.test.ts tests/reindex-pipeline.test.ts` — PASS; 7 files and 128 tests passed. Expected negative fixture diagnostics from `tests/function-grants.test.ts` were printed while the suite itself passed.
- Mandatory literal `node scripts/run-vitest.mjs run tests/recovery-readiness-evidence.test.ts tests/reindex-pipeline.test.ts` — PASS; 2 files and 62 tests passed.
- `node scripts/run-vitest.mjs run tests/retrieval-owner-filter-guard.test.ts tests/retrieval-rpc-rollout.test.ts tests/rag-cache-utils.test.ts` — PASS; 3 files and 18 tests passed.
- `npm run check:migration-role` — PASS; active hosted tooling uses the expected role and immutable applied history was unchanged. The new migration was not applied or replayed.
- `npm run check:function-grants` — PASS; all 34 public security-definer functions are revoked from PUBLIC and none is reopened to PUBLIC/anon.
- `git diff --check 62adef3b97906f6164f3d568712141dd9cd4117d..8a6184130e642bcc2ec7ec6dac66ac9b9ac016bf` — PASS.
- Pure exact-head TypeScript probe through `node --import tsx --input-type=module -e <synthetic protected-identity probe>` — all three named-entity protected fixtures were accepted by both page admission and the local content-identity verdict, as quoted in finding 2.
- Pure exact-head migration-source probe — resume document/policy/canonical/licence checks were all absent; activation latest-event recheck and artifact-owner check were absent; activation and event owners used different advisory-lock keys.
- Broad repository suites, browser checks, provider/hosted gates, schema replay, and live recovery/source/document operations were not run. The exact focused selectors, static gates, full source review, and synthetic negative probes were proportionate offline evidence.

## No-live and no-document statement

No provider, network, Supabase, database, Storage, migration application/replay, recovery, PITR, restore-drill, cleanup, queue, worker, ingestion, reindex, actual-document or real-source parsing/processing, corpus, activation, rollback, deployment, hosted CI, GitHub, push, PR, or external operation was run. No actual document, source payload, provider output, backup, Storage object, or database record was read or processed. Verification used only the immutable repository package/range and explicitly synthetic local values. `scripts/supabase-recovery-status.ts` was not read or executed. No product file was edited; this report is intentionally uncommitted and unstaged.

SPEC_VERDICT: FAIL

QUALITY_VERDICT: FAIL
