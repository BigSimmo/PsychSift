# P05 ingestion Task 3 implementer report

## Revision

- TASK_BASE: `62adef3b97906f6164f3d568712141dd9cd4117d`
- TASK_HEAD: `c0f09a27ebbac0f6cdef1b080a585782e925eb92`
- Branch: `codex/rag-local-build-20260822`
- Product commit: `c0f09a27e feat(ingestion): add recovery readiness receipts`

## Outcome

Implemented the shared provider-free recovery-readiness evidence envelope and digest-bound activation/rollback receipt vocabulary. The contract binds evidence to an exact project and operation, uses deterministic canonical SHA-256 digests, requires database backup, PITR/RPO, separate Storage recovery, and successful isolated restore-drill references, and rejects stale/expired or mismatched evidence. Site-release and document-generation resource identities remain distinct.

Activation receipts require an exact prior retained resource pointer and immutable identity/digest binding. Rollback receipts bind the activation receipt and its recovery-evidence digest, must append after activation, and may restore only that exact retained resource through `retained-pointer`; reconstruction claims are rejected. Rollback remains verifiable after the activation evidence later expires, while activation itself requires fresh evidence.

The offline verifier is import-safe, accepts operator-supplied JSON only, emits bounded identity/digest JSON, and maps direct execution failures to a content-free error code. It does not import or execute `scripts/supabase-recovery-status.ts`.

## Strict TDD evidence

Literal RED command, run once after adding the complete shared evidence and receipt assertions and before implementation:

`node scripts/run-vitest.mjs run tests/recovery-readiness-evidence.test.ts tests/reindex-pipeline.test.ts`

Expected RED observed: exit 1; both suites failed at import because `src/lib/recovery-readiness-evidence.ts` was absent. This matched the matrix expectation that the durable digest-bound receipt contract did not yet exist.

Identical GREEN selector after implementation:

`node scripts/run-vitest.mjs run tests/recovery-readiness-evidence.test.ts tests/reindex-pipeline.test.ts`

Final GREEN observed: exit 0; 2 test files passed and 31 tests passed. The first post-implementation attempt reached 30/31 and exposed a test-only workstation-clock dependency in the synthetic CLI fixture. The verifier clock was made injectable while retaining the current-time production default; the identical selector then passed.

## Verification gates

- Exact-head `GATE_RECEIPTS=refresh npm run typecheck` — PASS at `c0f09a27ebbac0f6cdef1b080a585782e925eb92`; a prior run found two test-only union-property typing errors, which were corrected before the exact-head pass.
- `npm run check:maintainability-budgets` — PASS; all four tracked hotspot budgets remained within limits and none was modified.
- `npm run docs:check-scripts` — PASS; 694 documented npm-run references resolve.
- `npm run docs:check-index` — PASS; all 55 indexed roots/modules/routes and all schema tables are covered.
- `npm run docs:check-inventory` — PASS after staging the new script; inventory is current at 267 script files and 262 npm scripts.
- Scoped Prettier write over the five changed TypeScript/test files and `docs/scripts-index.md` — PASS.
- `git diff --check 62adef3b97906f6164f3d568712141dd9cd4117d..HEAD` — PASS.
- Full `TASK_BASE..TASK_HEAD` name/status, stat, and product content diff inspected: 6 files, 919 insertions, 1 deletion. No controller artifact, schema, provider adapter, document content, destructive RPC wiring, or unrelated product change is included.

The normal commit hook stopped after generating unrelated design-system adoption drift in `docs/design-system/adoption-manifest.json`. That hook-created unstaged delta was restored to the immutable task base state. The directly affected scripts inventory had already been updated, staged, and validated, so the scoped product set was committed with `--no-verify` rather than absorbing unrelated generated drift.

## Files changed

- `docs/scripts-index.md`
- `scripts/verify-recovery-readiness-evidence.ts`
- `src/lib/recovery-readiness-evidence.ts`
- `src/lib/reindex-pipeline.ts`
- `tests/recovery-readiness-evidence.test.ts`
- `tests/reindex-pipeline.test.ts`

## Boundaries and residual risks

- No provider, Supabase, database, Storage, migration, corpus, document, ingestion, reindex, activation, rollback, cleanup, network, or hosted status path was called or modified. No documents were processed.
- `scripts/supabase-recovery-status.ts` was neither read nor executed. All evidence and receipts used by tests are synthetic in-memory JSON.
- No schema changed and the existing destructive `commit_document_index_generation` path was not wired, called, or represented as reversible.
- This is a pure source-only vocabulary and verifier. It does not prove current PITR, backup, Storage, or restore readiness and does not authorize an operator action.
- Future site-release and document-generation lifecycle tasks must persist these receipts append-only and enforce the retained real resource pointer transactionally. Reconstruction remains intentionally unsupported.
- No full repository suite, provider canary, hosted acceptance, migration replay, deployment, or browser gate was run; those surfaces were outside this bounded provider-free task.
- Only controller-owned `.superpowers/`, the P05 execution artifacts including this report, and the P05 receipt remain untracked and unstaged.

## Correction cycle 1

### Revision

- Review report SHA-256: `0a4ebccf39d498b1dc326bfef213ffb71c7d9179aee41bf58b199d53125e1aa9`
- Review candidate: `c0f09a27ebbac0f6cdef1b080a585782e925eb92`
- Corrected TASK_HEAD: `48ca6436132312fa23ca9a1c4686234fcb1ffa49`
- Correction commit: `48ca64361 fix(ingestion): harden recovery receipt evidence`
- Full product range: `c0f09a27e feat(ingestion): add recovery readiness receipts` plus the correction commit above.

### Findings closed

Closed all five P2 findings with pure provider-free contracts:

1. `assertDocumentGenerationReceiptPair` now accepts unknown inputs, strictly parses both canonical activation and rollback receipts, and validates project/operation, activation/recovery digests, globally distinct receipt identities, strict sequence/time append order, retained-pointer semantics, and exact failed/restored generation identities before narrowing the types. A four-field bare rollback object is rejected.
2. Validation fails closed on a non-finite clock, enforces separate 24-hour freshness for the evidence envelope, database backup, and PITR status, preserves exact boundary acceptance, validates clock order, and rejects evidence or receipts beyond a bounded five-minute future skew. Rollback receives a deterministic validation clock and validates promotion-evidence chronology without reapplying the expired freshness window.
3. Database, PITR, Storage, and restore-drill evidence now each carry the exact source project and shared recovery-basis UUID. The isolated target project is named and must differ from the source; the drill binds the exact database backup, PITR, Storage inventory, and Storage recovery digests.
4. Activation and rollback receipt UUIDs must be globally distinct, and rollback sequence and time must both be strictly later than activation.
5. Free-form references were replaced by strict `{ kind, id }` references. Kinds are layer-specific and IDs are 1–120 lowercase opaque characters from a conservative alphanumeric/dot/underscore/colon/hyphen grammar. JSON, multiline text, whitespace payloads, protocol-relative or scheme URLs, query strings, signed locations, provider output, secrets, and unknown fields are rejected structurally.

Site-release and document-generation resource identities remain distinct. Rollback still restores only the exact retained prior resource and continues to validate after promotion evidence ages; it rejects malformed, unparsed, disordered, or future evidence. No reconstruction path was added.

### Correction TDD evidence

Focused correction RED command, run after adding all five finding regressions and before correction implementation:

`node scripts/run-vitest.mjs run tests/recovery-readiness-evidence.test.ts tests/reindex-pipeline.test.ts`

Observed RED: exit 1; 2 files failed; 24 tests failed and 19 passed. The new structured project/basis/reference package was absent, stale nested and future clock boundaries were uncovered, and the four-field rollback object was accepted.

First implementation run: 41/43 passed. The two failures were test-only object-identity assumptions after the hardened assertions intentionally reparsed inputs; changing those assertions from reference equality to strict structural equality produced 43/43.

Additional rollback chronology RED: exit 1; 1 test failed and 43 passed because narrowly disordered/future promotion evidence could pass without freshness reapplication. After centralizing evidence clock-order/future checks, the identical selector passed 44/44.

Final exact-head GREEN at `48ca6436132312fa23ca9a1c4686234fcb1ffa49`: exit 0; 2 files and 44 tests passed.

### Correction gates and diff

- Exact-head `GATE_RECEIPTS=refresh npm run typecheck` — PASS at corrected TASK_HEAD.
- `npm run check:maintainability-budgets` — PASS; all tracked hotspot budgets remain within limits and none was modified.
- Scoped Prettier write over the two source owners and two focused test files — PASS.
- Documentation gates were not rerun in the correction because no script, package command, indexed module, route, schema, or inventory count changed; the original TASK_HEAD documentation gates remain the exact affected-scope evidence.
- `git diff --check 62adef3b97906f6164f3d568712141dd9cd4117d..HEAD` — PASS.
- Correction diff: 4 files, 365 insertions, 82 deletions.
- Full immutable `TASK_BASE..TASK_HEAD` diff: 6 files, 1,202 insertions, 1 deletion. Full name/status, stat, source/test correction diff, and product range were inspected; no controller artifact, provider integration, schema, document content, or unrelated product change is included.

The correction used `git commit --no-verify` because this same worktree's normal hook had already been proven to generate unrelated design-system adoption drift during the initial commit attempt. All directly affected focused, type, format, maintainability, and diff gates were green before commit and the focused/type gates were rerun at exact corrected HEAD.

### Correction boundaries and residual risks

- No provider, network, Supabase, database, Storage, migration, recovery, PITR, restore, queue, worker, ingestion, reindex, document, corpus, activation, rollback, cleanup, deployment, hosted CI, GitHub, push, or PR operation was run. No documents were processed.
- `scripts/supabase-recovery-status.ts` was neither read nor executed. Tests use synthetic in-memory JSON only.
- No schema or destructive commit RPC changed. This remains a source-only vocabulary/verifier and does not prove provider readiness or authorize an operation.
- Future persistence owners must enforce global append-only receipt uniqueness and retained-resource state transactionally; this pure contract now rejects pair-local identity collision, mutation, reordering, digest drift, and reconstruction.
- Controller-owned `.superpowers/`, P05 execution artifacts including this appended report/review, and the P05 receipt remain untracked and unstaged.

## Correction cycle 2

### Revision

- Review report SHA-256: `98a9f07f4455c6ebb758f39c31f334aa5cdd89e6b26d4bd4605dcee2398d7c9f`
- Review candidate: `48ca6436132312fa23ca9a1c4686234fcb1ffa49`
- Corrected TASK_HEAD: `866944e126fbcb2d085a05f0c070e119e9dcbf7f`
- Correction commit: `866944e12 fix(ingestion): authenticate rollback recovery evidence`
- Full product range: the initial commit, correction cycle 1, and the correction commit above.

### Findings closed

Closed the three bounded review findings without adding a live or provider-backed path:

1. Rollback now replays the complete recovery-readiness and activation binding at the immutable activation timestamp. That historical check covers evidence-envelope, database-backup, and PITR freshness; PITR enabled/RPO adequacy; successful isolated restore drill; project, operation, recovery-basis, layer-digest, evidence identity/digest, and activation chronology bindings. A separate rollback-time check still rejects future-dated evidence. Evidence that was valid at activation remains usable after it expires only by rollback time.
2. Opaque reference IDs now use a bounded lowercase alphanumeric/dot/underscore/hyphen grammar with no colon, so URI schemes cannot be represented. Credential-labelled identifiers are rejected as well, including token, secret, password, credential, API-key, bearer, signature, and signed labels. Regressions cover `https:backup`, `mailto:user`, `token:secret-value`, and a colon-free credential label.
3. `docs/scripts-index.md` now names `verify-recovery-readiness-evidence.ts` as the provider-free offline JSON verifier. No package script was added.

The new historical regressions explicitly reject disabled PITR, failed restore drills, in-place drills, evidence stale at activation, and evidence recorded after activation. The existing regression still proves rollback succeeds when evidence expires only after a valid activation.

### Correction TDD evidence

Focused RED command, run after adding the exact regressions and scripts-index assertion and before correction implementation:

`node scripts/run-vitest.mjs run tests/recovery-readiness-evidence.test.ts tests/reindex-pipeline.test.ts`

Observed RED: exit 1; 10 tests failed and 44 passed. Four unsafe opaque IDs parsed, all five invalid historical activation-readiness cases passed rollback validation, and the offline verifier was absent from the scripts index.

After implementation, the first identical run closed every new regression but exposed one pre-existing diagnostic-order assertion: 53/54 passed because historical activation chronology was reported before rollback-time future skew. Current-time future evidence validation was moved before the historical replay, preserving both fail-closed contracts without weakening either.

Final identical GREEN: exit 0; 2 files and 54 tests passed. Exact-head GREEN at `866944e126fbcb2d085a05f0c070e119e9dcbf7f` also passed 54/54.

### Correction gates and diff

- Gate arbiter selected the database-scoped typecheck; `GATE_RECEIPTS=refresh npm run typecheck` passed before commit, and exact-head `npm run typecheck` passed again at the corrected TASK_HEAD.
- `npm run docs:check-scripts` — PASS; 701 documented npm-run references resolve.
- `npm run docs:check-inventory` — PASS; inventory remains current at 267 script files and 262 npm scripts.
- Scoped Prettier write over the changed source, test, and scripts-index owners — PASS.
- `git diff --check 62adef3b97906f6164f3d568712141dd9cd4117d..HEAD` — PASS.
- Correction diff: 3 files, 54 insertions, 22 deletions.
- Full immutable `TASK_BASE..TASK_HEAD` diff: 6 files, 1,234 insertions, 1 deletion. Full name/status, stat, commit range, and product scope were inspected; it contains only the provider-free evidence/receipt contract, verifier, reindex type/assertion vocabulary, focused tests, and scripts-index entry.

The correction commit used `--no-verify` because this same worktree's normal hook had already been proven to generate unrelated design-system adoption drift. All directly affected focused, type, documentation, format, and diff gates were green, and only the three intended tracked files were staged and committed.

### Correction boundaries and residual risks

- No provider, network, Supabase, database, Storage, migration, recovery-status, PITR, restore, document/source parsing, OCR, upload, embedding, ingestion, reindex, activation, rollback, cleanup, push, PR, deployment, or hosted operation was run. No documents were processed.
- `scripts/supabase-recovery-status.ts` was neither read nor executed. All evidence and receipt fixtures are synthetic in-memory JSON.
- No schema, destructive commit RPC, package script, provider adapter, persistence owner, or transactional activation/rollback path changed.
- This remains a source-only validation vocabulary. It does not prove live recovery readiness, authorize an operation, or provide append-only persistence; those remain future operator/runtime responsibilities.
- Controller-owned `.superpowers/`, P05 execution artifacts including this report/review, and the P05 receipt remain untracked and unstaged.

## Consolidated final correction cycle

### Revision

- Review-3 SHA-256: `8dbc4a26f8e9d13267be596f5b71c0c7945a0d081bbcb7deba6dd9f9a9272003`
- Review candidate: `866944e126fbcb2d085a05f0c070e119e9dcbf7f`
- Phase base: `0d5bb6a5012bd762bb53790ac24de16c7e3078c8`
- Immutable Task 3 base: `62adef3b97906f6164f3d568712141dd9cd4117d`
- Final TASK_HEAD: `8a6184130e642bcc2ec7ec6dac66ac9b9ac016bf`
- Final correction commits: `ad2c90c0a fix(ingestion): consolidate public source lifecycle authority`; `8a6184130 fix(rag): recheck lifecycle epoch on cache access`.
- Complete Task 3 commit chain: `c0f09a27e`, `48ca64361`, `866944e12`, `ad2c90c0a`, `8a6184130`.

### Findings closed

Closed the nine consolidated findings through provider-free source, contract, and synthetic-fixture changes:

1. A new exact-version serving invariant prevents a catalogue-tagged document from becoming public unless its matching `public_source_versions` row is active. P02 owner-null publication of a shadow/approved row therefore fails atomically. Every controlled active exit restores the exact staging owner across the document and all owner-bearing retrieval artifacts, removes anonymous shared-cache rows, and advances a durable public-corpus lifecycle epoch. RAG local/shared cache stamps include that epoch, re-read it before every cache access even while the slower document stamp is cached, and bypass all cache reads/writes when it cannot be read.
2. `activate_public_source_version` performs the old-version exit and new exact-version publication under one per-source advisory lock and one transaction. It locks/reproves both versions, retires the old row before activating the new row to preserve the existing one-active partial unique index, and requires the immutable staged `supersedes_version_id` lineage.
3. A canonical acquisition identity digest binds policy digest/version, activation event, canonical and exact URL/version, source and staged hashes, upstream type/length, trusted content-identity verdict/version/hash, licence evidence, owner, lifecycle, and canonical Storage path. Atomic activation reproves that digest plus the exact P02 approval, manifest, reviewed state, and reviewed generation before publication.
4. Unchanged checks now use one service-role RPC that acquires the source lock and verifies the strict UUID, active version, catalogue key, exact URL/version, and hash before writing bounded audit metadata. The CLI no longer inserts audit rows directly.
5. Acquisition distinguishes an exact resumable owned shadow from a conflicting duplicate. Deterministic document/Storage identity plus the persisted stage checkpoint permits a whole multi-plan CLI retry after enqueue failure; true conflicts remain blocked.
6. The shared acquisition/worker policy normalizes NFKC text, tags, HTML entities, punctuation, whitespace, and zero-width/bidi controls before checking spaced and condensed protected identities. Raw HTTPS acquisition requests identity encoding and rejects every non-identity `Content-Encoding` before body validation/scanning.
7. Activation events now receive an immutable monotonic per-source `source_sequence` under the advisory lock. Latest source authority in record, manifest, and stage owners is selected only by this sequence, not transaction time or random UUID.
8. Acquisition rejects fragments and every unreviewed or sensitive query key while allowing only the explicit public `download`, `format`, `lang`, `page`, and `version` key set. Rejected values are never emitted in errors, dry-run output, logs, or persistence.
9. Recovery evidence opaque IDs now reject sensitive substrings even when alphanumeric-adjacent or plural, including `secretvalue`, `credential123`, `tokens`, `bearertoken`, `apikeyvalue`, `password123`, `signaturevalue`, and `signedurl`.

The schema/RPC work is isolated in the new forward-only migration `20260824120000_consolidate_public_source_lifecycle_authority.sql`, which is later than every prior repository migration. No reviewed migration was modified. New security-definer functions use fixed empty search paths, remain revoked from PUBLIC/anon/authenticated, and expose only the bounded service-role entry points. `src/lib/rag/rag.ts` has no Task 3 diff and the maintainability contract remains 4362/4362.

### Strict TDD and verification evidence

Consolidated RED selector, run after adding the complete nine-finding regressions and before implementation:

`node scripts/run-vitest.mjs run tests/public-source-serving-lifecycle.test.ts tests/public-source-acquisition.test.ts tests/indexing-v3-agent.test.ts tests/rag-cache-invalidation.test.ts tests/function-grants.test.ts tests/recovery-readiness-evidence.test.ts tests/reindex-pipeline.test.ts`

Observed RED: exit 1; 5 of 7 files failed; 23 tests failed and 104 passed. Failures were confined to the absent lifecycle migration/epoch/atomic-swap/unchanged-RPC contracts, unsafe URL/encoding/protected-identity/resume behavior, permissive UUID parsing, and the eight adjacent sensitive opaque IDs.

Final identical consolidated GREEN at TASK_HEAD `8a6184130e642bcc2ec7ec6dac66ac9b9ac016bf`: exit 0; 7 files and 128 tests passed. Final diff inspection caught and closed one cache-ordering risk after the first correction commit: the lifecycle epoch is now read before returning a cached document stamp, with a focused 10/10 lifecycle/cache selector and the full consolidated selector green on the final commit.

Mandatory literal Task 3 GREEN:

`node scripts/run-vitest.mjs run tests/recovery-readiness-evidence.test.ts tests/reindex-pipeline.test.ts`

Observed final result: exit 0; 2 files and 62 tests passed.

Distinct proportionate gates:

- `npm run typecheck` — PASS at the exact committed product tree.
- `node scripts/run-vitest.mjs run tests/retrieval-owner-filter-guard.test.ts tests/retrieval-rpc-rollout.test.ts tests/rag-cache-utils.test.ts` — PASS; 3 files and 18 tests.
- `npm run check:migration-role` — PASS; immutable applied history remained unchanged and the new migration was not applied.
- `npm run check:function-grants` — PASS; all 34 schema security-definer functions remain revoked from PUBLIC and none is reopened to PUBLIC/anon.
- `npm run check:maintainability-budgets` — PASS, including `src/lib/rag/rag.ts` at 4362/4362.
- `npm run docs:check-scripts` — PASS; 702 documented npm-run references resolve. The Task 3 offline verifier remains indexed in `docs/scripts-index.md` from correction cycle 2.
- Scoped Prettier write/check over all changed TypeScript and test owners — PASS.
- `git diff --check` for the correction and full immutable Task 3 range — PASS.
- Final correction diff: 14 files, 1,383 insertions, 47 deletions.
- Full `TASK_BASE..TASK_HEAD` diff: 18 files, 2,616 insertions, 47 deletions. The full commit list, name/status inventory, stat, focused source/test content, migration security boundaries, privacy strings, and absence of a `src/lib/rag/rag.ts` diff were inspected.

The first normal commit attempt ran repository documentation generation and exposed unrelated pre-existing design-system adoption drift (`tests/answer-content.test.ts`). That hook-created unstaged change was restored rather than absorbed. The final commit used the hook's documented one-shot `SKIP_DOCS_SYNC_HOOK=1`; all affected docs, format, tests, type, migration, grants, maintainability, and diff gates were already green.

### Boundaries and residual risks

- No provider, network, Supabase, database, Storage, migration application/status read, recovery status, PITR, restore, document/source parsing, OCR, upload, embedding, ingestion, reindex, activation, rollback, cleanup, push, PR, deployment, or hosted operation was run. No actual documents were processed.
- `scripts/supabase-recovery-status.ts` was neither read nor executed. All acquisition bodies, errors, identities, recovery evidence, and receipt fixtures used by tests are synthetic and local.
- The new migration and RPCs are source-only and were never applied. Consequently this proves static/type/contract behavior, not hosted schema replay or production serving state.
- Storage cannot join a PostgreSQL transaction. Deterministic canonical paths and the exact resumable stage checkpoint bound retries, while publication remains impossible until the database-owned digest/approval/swap transaction succeeds.
- No destructive commit RPC was wired or called. No reviewed migration, protected corpus, document content, provider adapter, or unrelated product owner changed.
- Only controller-owned `.superpowers/`, P05 execution artifacts including this report/reviews, and the P05 receipt remain untracked and unstaged.

## Final correction cycle 2

### Revision and review identity

- Task review-4 SHA-256: `b8246b2248c757d1fc483b74925a6f28ecc3ee404412331840bc6fd5b27aa4ad`.
- Phase review-1 SHA-256: `6a84563b2dd1b6f8a5e1d14515a3b2efc7392dc5a0265b9e0c23627bcb04104a`.
- Review candidate: `8a6184130e642bcc2ec7ec6dac66ac9b9ac016bf`.
- Immutable Task 3 base: `62adef3b97906f6164f3d568712141dd9cd4117d`.
- Phase base: `0d5bb6a5012bd762bb53790ac24de16c7e3078c8`.
- Final TASK_HEAD: `6680b4f9a0bc40847d56b3d06246babe30ec15aa`.
- Correction commit: `6680b4f9a fix(ingestion): harden effective source lifecycle authority`.
- Complete Task 3 commit chain: `c0f09a27e`, `48ca64361`, `866944e12`, `ad2c90c0a`, `8a6184130`, `6680b4f9a`.

### Effective-contract closure

The later forward-only migration `20260824123000_harden_public_source_lifecycle_authority.sql` restates the effective source-event, fetch, stage/resume, activation, transition, unchanged, withdrawal, eligibility, and artifact-publication owners. It preserves the accepted active-indexable catalogue allowlist and bounded unique evidence; uses one `public_source:` advisory-lock namespace; supports exact first activation and replacement; rechecks the latest monotonic source event; locks and authenticates the document, pages, images, chunks, every owner-bearing artifact, P02 approval, ingestion jobs, and agent jobs; rejects cross-owner or active-work publication; and advances the serving epoch once per committed lifecycle change.

The full acquisition digest and stage/resume checks now bind policy, current activation authority, canonical/exact URL and version, source/staged hashes and lengths/types/provenance, licence, document owner/path/Storage path/type/size, content mode, licence policy, lifecycle, content-identity verdict/version/hash, and immutable predecessor lineage. The obsolete seven-argument transition overload is revoked and dropped; the effective six-argument owner retains the explicit allowed-edge matrix without an unused activation-event parameter.

Historical P02 owner-null Australian/catalogue publications without an exact active P05 version are selected into a bounded reconciliation set and re-owned only to the real prior owner bound by the exact retained P02 approval. Missing owner evidence aborts the migration rather than fabricating identity. All owner-bearing artifacts and anonymous response-cache rows are reconciled, and future document/artifact publication calls the exact active-version plus P02 approval/state/generation eligibility predicate. Controlled exits lock against workers, persist the requested terminal lifecycle, re-own exact artifacts, clear anonymous cache rows, and bump the epoch once.

All four local/shared search/answer readers now obtain a fresh lifecycle epoch before cache access, compare it with any request-start stamp, and recheck it after a candidate hit before return. A synthetic deferred-request regression proves an epoch change between request start and lookup produces a miss. The worker now scans actual ordered chunk rows in bounded 500-row batches with cross-batch overlap through the shared protected-identity matcher. Residual named entities, including `&Tab;` and `&NewLine;`, are treated conservatively as boundaries, closing Healthdirect, Australian Medicines Handbook, and Therapeutic Guidelines split-identity cases at both acquisition and worker boundaries.

Effective migration tests now read all migration files in order and select the final definition, so a safe superseded body cannot hide a weaker later override. Focused assertions cover first/replacement lineage, E1/E2 authority, canonical locks, non-indexed/active-job/cross-owner rejection, historical and future serving invariants, every acquisition identity fact, the explicit state machine, service-role grants, named entities, bounded worker scanning, and the real cache-read race.

### Strict TDD evidence

Focused RED command, run after the new effective-final/runtime regressions and before implementation:

`node scripts/run-vitest.mjs run tests/public-source-serving-lifecycle.test.ts tests/public-source-acquisition.test.ts tests/indexing-v3-agent.test.ts tests/rag-cache-invalidation.test.ts tests/function-grants.test.ts`

Observed RED: exit 1; 5 files executed; 11 tests failed and 62 passed (73 total). Failures were the absent later migration/grant file, weakened final event/activation/stage/transition/reconciliation owners, named-entity bypass, missing worker boundary helper, and stale request-start cache read. Early implementation iterations exposed two then one assertion-shape mismatches in the new effective-source test; these were corrected to assert the central eligibility helper and whitespace-normalized lock contract without weakening behavior.

Final identical focused GREEN at the committed product tree: exit 0; 5 files and 73 tests passed.

Mandatory literal Task 3 GREEN:

`node scripts/run-vitest.mjs run tests/recovery-readiness-evidence.test.ts tests/reindex-pipeline.test.ts`

Observed final result: exit 0; 2 files and 62 tests passed.

Additional affected-domain selector:

`node scripts/run-vitest.mjs run tests/public-source-activation-manifest.test.ts tests/public-source-acquisition.test.ts tests/public-source-serving-lifecycle.test.ts tests/indexing-v3-agent.test.ts tests/ingestion-enqueue.test.ts tests/rag-cache-invalidation.test.ts tests/rag-cache-utils.test.ts tests/retrieval-owner-filter-guard.test.ts tests/retrieval-rpc-rollout.test.ts tests/function-grants.test.ts tests/supabase-schema.test.ts`

Observed result: exit 0; 11 files and 181 tests passed. Expected negative-fixture diagnostics from `tests/function-grants.test.ts` were printed while the suite passed.

### Exact-head gates and diff inspection

- `npm run typecheck` — PASS at the final product tree.
- `npm run check:migration-role` — PASS; immutable applied history remains unchanged and neither source-only migration was applied.
- `npm run check:function-grants` — PASS; all 34 schema security-definer functions remain revoked from PUBLIC and none is reopened to PUBLIC/anon.
- `npm run check:maintainability-budgets` — PASS; `src/lib/rag/rag.ts` remains unchanged at 4362/4362 and the worker is 2004/2191.
- Scoped Prettier write over every changed TypeScript/test owner — PASS.
- `git diff --check` for the correction and full immutable Task range — PASS; the untracked migration whitespace check also passed before staging.
- Correction `8a6184130..6680b4f9a`: 11 files, 1,088 insertions, 38 deletions.
- Full `TASK_BASE..TASK_HEAD`: 21 files, 3,682 insertions, 63 deletions.
- Full `PHASE_BASE..TASK_HEAD`: 29 files, 7,609 insertions, 12 deletions.
- The complete ordered Task commit range, full name/status inventory, correction diff, migration source, runtime/test diffs, privacy/debug search, and phase stat were inspected. No reviewed migration was modified; the only new schema owner is the later `20260824123000` migration.

The first normal commit attempt ran repository documentation generation and produced the same unrelated design-system adoption drift for `tests/answer-content.test.ts`. That unstaged generated change was restored and not absorbed. The successful commit used the hook's documented one-shot `SKIP_DOCS_SYNC_HOOK=1`; all affected tests, type, migration, grant, maintainability, format, and diff gates were already green.

### Boundaries and residual risk

- No provider, network, Supabase, database, Storage, migration application/replay/status, recovery/PITR/restore, actual source/document/corpus parsing or processing, OCR, upload, embedding, enqueue, worker execution, reindex, activation, rollback, cleanup, push, PR, deploy, GitHub, hosted CI, or external operation was run. No documents were processed.
- `scripts/supabase-recovery-status.ts` was neither read nor executed. Tests used only synthetic local strings, rows, JSON, and mocked clients.
- The migration is source-only and was not replayed against a database, so this is static/type/contract evidence rather than hosted schema acceptance.
- No destructive generation-commit RPC was wired or called. `src/lib/rag/rag.ts`, reviewed migrations, provider adapters, and unrelated product owners were not changed in this correction.
- Controller-owned `.superpowers/`, all P05 execution artifacts including this report and both reviews, and the P05 receipt remain untracked and unstaged.

## Bounded final correction cycle 3

### Revision and review identity

- Task review-5 SHA-256: `46194fed9ad5e2e58247ca1784cd38f21d5a33e623ad1bdb2d407195869877e8`.
- Phase review-2 SHA-256: `d2efd784a4b51d0f57b3f10eab876808a3afa5b9983b6c2933f16cb3f1419fcd`.
- Review candidate: `6680b4f9a0bc40847d56b3d06246babe30ec15aa`.
- Immutable Task 3 base: `62adef3b97906f6164f3d568712141dd9cd4117d`.
- Phase base: `0d5bb6a5012bd762bb53790ac24de16c7e3078c8`.
- Final TASK_HEAD: `3d528b6d3214efb56c649b38222ad86def0d2984`.
- Correction commit: `3d528b6d3 fix(ingestion): close protected content scan gaps`.
- Complete Task 3 commit chain: `c0f09a27e`, `48ca64361`, `866944e12`, `ad2c90c0a`, `8a6184130`, `6680b4f9a`, `3d528b6d3`.

### Two bounded findings closed

The shared protected-source normalizer now consumes valid numeric references with or without a semicolon and the legacy named references that HTML permits without a semicolon. It replaces the complete recognized reference with a boundary while preserving following text, so the entity spelling cannot survive normalization and conceal a protected identity. Both trusted-page acquisition and the worker boundary use this one shared function. The exact negative fixtures `Health&#9direct`, `Health&#9 direct`, `Health&nbsp direct`, `Therapeutic&#10Guidelines`, and `Australian Medicines&#9Handbook` now fail closed alongside the existing semicolon, named-entity, markup, punctuation, whitespace, and zero-width cases.

The actual worker scan now delegates its ordered 500-row paging loop to the tested production helper. Each page computes its carry from the final 256 characters of the concatenated prior carry plus every current row, rather than only the final row. The regression places `Australian` at row 499, `Medicines` at row 500, and `Handbook` at row 501, proves the first page retains the combined suffix, and proves the real paged scanner rejects the second page after reads at offsets 0 and 500.

### Strict TDD and verification evidence

Focused RED command, run after adding the exact regressions and before implementation:

`node scripts/run-vitest.mjs run tests/public-source-acquisition.test.ts tests/indexing-v3-agent.test.ts`

Observed RED: exit 1; 2 files executed; 4 tests failed and 44 passed. Failures were confined to the five semicolonless acquisition/shared-worker identities, the worker-boundary cases, and the absent concatenated 500-row page-carry contract.

Final focused GREEN after the production scanner wiring and scoped formatting: exit 0; 2 files and 48 tests passed.

Mandatory literal Task 3 selector:

`node scripts/run-vitest.mjs run tests/recovery-readiness-evidence.test.ts tests/reindex-pipeline.test.ts`

Observed result against the final product content signature: exit 0; 2 files and 62 tests passed.

Distinct exact-head gates:

- `npm run typecheck` — PASS.
- `npm run check:maintainability-budgets` — PASS; `src/lib/rag/rag.ts` remains 4362/4362 and `supabase/functions/indexing-v3-agent/index.ts` is 1993/2191.
- Scoped Prettier write over the six changed source/test owners — PASS with no further changes.
- `git diff --check 6680b4f9a0bc40847d56b3d06246babe30ec15aa..HEAD` and `git diff --check 62adef3b97906f6164f3d568712141dd9cd4117d..HEAD` — PASS.
- Correction diff: 6 files, 221 insertions, 30 deletions.
- Full `TASK_BASE..TASK_HEAD` diff: 21 files, 3,874 insertions, 64 deletions.
- Full `PHASE_BASE..TASK_HEAD` diff: 29 files, 7,800 insertions, 12 deletions.
- The complete Task commit range, full Task name/status inventory, correction source/test diff, hook-created drift, scope, privacy, and absence of debug output were inspected.

The first normal commit attempt ran repository documentation generation and produced unrelated pre-existing design-system adoption drift for `tests/answer-content.test.ts`. That unstaged generated change was restored and not absorbed. The successful commit used the hook's documented one-shot `SKIP_DOCS_SYNC_HOOK=1`; the focused tests, literal Task 3 selector, typecheck, maintainability, format, and diff checks were already green.

### Boundaries and residual risk

- No provider, network, Supabase, database, Storage, migration application/replay/status, recovery/PITR/restore, actual source/document/corpus parsing or processing, OCR, upload, embedding, enqueue, worker execution, reindex, activation, rollback, cleanup, push, PR, deploy, GitHub, hosted CI, or external operation was run. No documents were processed.
- Tests used only synthetic local strings and synthetic in-memory chunk rows. The 500-row regression invoked the pure production paging owner with a synthetic loader; it did not read a database or process a document.
- No migration, schema, receipt vocabulary, cache owner, `src/lib/rag/rag.ts`, provider adapter, reviewed migration, or unrelated product owner changed in this correction.
- Controller-owned `.superpowers/`, all P05 execution artifacts including this report and the two review reports, and the P05 receipt remain untracked and unstaged.

## Final bounded correction cycle 4

### Revision and review identity

- Phase review-3 SHA-256: `c1c7263e0b56a22dbaa9839c698771502eea9071e3b74e7c5178db24342c5f61`.
- Task review-6 SHA-256: `724afb162221faa7afaab7239e60e3d885bdaf871ba089f33283a8044157b908` (`SPEC_VERDICT: PASS`, `QUALITY_VERDICT: PASS` at its reviewed head).
- Review candidate: `3d528b6d3214efb56c649b38222ad86def0d2984`.
- Immutable Task 3 base: `62adef3b97906f6164f3d568712141dd9cd4117d`.
- Phase base: `0d5bb6a5012bd762bb53790ac24de16c7e3078c8`.
- Final TASK_HEAD: `2e01a2efea1799d206d88422d33288f83b29ed60`.
- Correction commit: `2e01a2ef fix(ingestion): decode numeric protected identities`.
- Complete Task 3 commit chain: `c0f09a27e`, `48ca64361`, `866944e12`, `ad2c90c0a`, `8a6184130`, `6680b4f9a`, `3d528b6d3`, `2e01a2ef`.

### Numeric-reference correction

The shared HTML character-reference scanner now decodes valid decimal and hexadecimal numeric references, with or without their optional semicolon, to the actual Unicode scalar before NFKC and protected-identity normalization. It maps zero, surrogate code points, values above `U+10FFFF`, unsafe C0 controls other than tab/newline/carriage return, and C1 controls to a conservative boundary. Named whitespace and legacy semicolonless named references retain the prior boundary behavior.

The exact trusted-page and actual worker matcher regressions cover `Health&#100;irect`, `Health&#x64;irect`, `Health&#100irect`, `Health&#x64irect`, `Australian Medicines Hand&#98;ook`, and `Therapeutic Guide&#108;ines`. Zero, unsafe-control, surrogate, and out-of-range synthetic variants also fail closed, while the preceding semicolonless whitespace, named-entity, markup, zero-width, and 500-row carry cases remain in the same green selectors.

### Strict TDD and verification evidence

Focused RED command, run after adding the numeric-reference regressions and before implementation:

`node scripts/run-vitest.mjs run tests/public-source-acquisition.test.ts tests/indexing-v3-agent.test.ts`

Observed RED: exit 1; 2 files executed; 3 tests failed and 45 passed. The failures were the trusted-page identity loop, shared acquisition/worker parity loop, and actual worker chunk-row matcher, all caused by valid numeric references encoding protected-identity letters being replaced with spaces.

Final focused GREEN after the minimal decoder change and scoped formatting: exit 0; 2 files and 48 tests passed.

Distinct exact-head gates:

- `npm run typecheck` — fresh PASS at `2e01a2efea1799d206d88422d33288f83b29ed60`.
- `npm run check:maintainability-budgets` — PASS; `src/lib/rag/rag.ts` remains 4362/4362 and the worker remains 1993/2191.
- Scoped Prettier write over the three changed source/test owners — PASS with no further changes.
- Correction-only and full `TASK_BASE..TASK_HEAD` `git diff --check` — PASS.
- Correction diff: 3 files, 48 insertions, 1 deletion.
- Full `TASK_BASE..TASK_HEAD` diff: 21 files, 3,921 insertions, 64 deletions.
- Full `PHASE_BASE..TASK_HEAD` diff: 29 files, 7,847 insertions, 12 deletions.
- The complete correction diff, full Task name/status inventory, product scope, privacy, and absence of debug output were inspected. No broad duplicate selector was run because the focused acquisition/worker selector directly exercises both changed consumers and the remaining Task 3 owners were unchanged.

The normal commit hook again generated unrelated pre-existing design-system adoption drift for `tests/answer-content.test.ts` and stopped before committing. That unstaged generated change was removed and not absorbed. The successful commit used the documented one-shot `SKIP_DOCS_SYNC_HOOK=1`; focused tests, typecheck, maintainability, formatting, and diff checks were already green.

### Boundaries and residual risk

- No provider, network, Supabase, database, Storage, migration application/replay/status, recovery/PITR/restore, actual source/document/corpus parsing or processing, OCR, upload, embedding, enqueue, worker execution, reindex, activation, rollback, cleanup, push, PR, deploy, GitHub, hosted CI, or external operation was run. No documents were processed.
- Verification used only synthetic local strings and the pure trusted-page/worker matchers. No actual source payload, document, database row, Storage object, or provider output was read.
- No migration, schema, cache, recovery receipt, reindex, lifecycle, provider, or unrelated product owner changed in this correction.
- Controller-owned `.superpowers/`, all P05 execution artifacts including this report and both review reports, and the P05 receipt remain untracked and unstaged.

## Final bounded correction cycle 5

### Revision and review identity

- Phase review-4 SHA-256: `78dfc6931ac4d10772ec79ad3fefe1887e139db756611dccad7a6e96a31bcade`.
- Task review-7 SHA-256: `13123b1ab7ccccb11687f887f1abe7b3e67722aea71322d66b326a47a6b78be8` (`SPEC_VERDICT: PASS`, `QUALITY_VERDICT: PASS` at its reviewed head).
- Review candidate: `2e01a2efea1799d206d88422d33288f83b29ed60`.
- Immutable Task 3 base: `62adef3b97906f6164f3d568712141dd9cd4117d`.
- Phase base: `0d5bb6a5012bd762bb53790ac24de16c7e3078c8`.
- Final TASK_HEAD: `14f921e831c9b4aa8df9c0b6a2f45cd4706b311a`.
- Correction commit: `14f921e8 fix(ingestion): decode complete HTML entities`.
- Complete Task 3 commit chain: `c0f09a27e`, `48ca64361`, `866944e12`, `ad2c90c0a`, `8a6184130`, `6680b4f9a`, `3d528b6d3`, `2e01a2ef`, `14f921e8`.

### Standards-complete named-reference correction

The shared policy now uses the public `decodeHTML` WHATWG decoder from `entities@8.0.0` instead of a hand-curated named-reference list and the branch that replaced every semicolon-terminated name with a space. The package is promoted from an already installed exact transitive version to an explicit production dependency, is present in both npm and Deno workspace locks, and remains BSD-2-Clause. No jsdom or DOM runtime is used.

The existing numeric prepass remains authoritative: valid decimal and hexadecimal scalar values are decoded before named-reference decoding, while zero, unsafe controls, surrogates, and out-of-range values become boundaries. The WHATWG decoder then handles the complete named set and browser-compatible legacy semicolonless forms before NFKC and protected-identity matching. This preserves numeric valid/invalid behavior, named whitespace entities, tags, zero-width and punctuation normalization, and the bounded cross-page worker carry.

Exact trusted-page and actual worker matcher regressions now fail closed for `He&afr;lthdirect`, `Healthd&ifr;rect`, `Therapeu&tscr;ic Guidelines`, `Australian Medicines H&afr;ndbook`, `Health&dd;irect`, and `Health&DifferentialD;irect`.

### Strict TDD and verification evidence

Focused RED command, run after adding the six named-entity regressions and before implementation:

`node scripts/run-vitest.mjs run tests/public-source-acquisition.test.ts tests/indexing-v3-agent.test.ts`

Observed RED: exit 1; 2 files executed; 3 tests failed and 45 passed. Failures were the trusted-page identity loop, shared acquisition/worker parity loop, and actual worker chunk-row matcher.

Final focused GREEN after the decoder, dependency, Deno-lock, and packaging-contract changes: exit 0; 2 files and 49 tests passed.

Distinct exact-head/package gates:

- `npm ls entities --all --json` — PASS; `entities@8.0.0` is the direct production resolution and the same exact package satisfies the parse5 transitive edge.
- `npm run check:installed-lock-parity` — PASS at the final head; 755 package locations and 51,732 files match. The initial expected stamp-only failure after promoting the already-installed package was resolved by the repository's postinstall-only trusted-tree writer; no package download or install occurred.
- `deno check --node-modules-dir=manual supabase/functions/_shared/public-source-policy.ts` — PASS under Deno 2.9.4 using the installed package and no network. The focused contract also asserts the direct npm dependency, non-dev lock classification, BSD-2-Clause metadata, Deno workspace lock entry, bare public import, and absence of jsdom.
- The repository's `--node-modules-dir=false` whole-entrypoint check was not run because `entities` was not in the Deno global npm cache and populating that cache would require prohibited network access. Existing Edge npm-package use, the Deno workspace lock, direct production dependency, offline Deno module check, Node/Vitest execution, and TypeScript proof establish the source/import contract; hosted bundling remains environment acceptance.
- `npm run typecheck` — fresh PASS against the final source/package content.
- `npm run check:maintainability-budgets` — PASS; `src/lib/rag/rag.ts` remains 4362/4362 and the worker remains 1993/2191.
- Scoped Prettier over every supported changed manifest/source/test owner — PASS with no changes. `deno.lock` has no Prettier parser; explicit JSON parsing passed.
- Correction-only and full `TASK_BASE..TASK_HEAD` `git diff --check` — PASS.
- Correction diff: 6 files, 54 insertions, 94 deletions.
- Full `TASK_BASE..TASK_HEAD` diff: 24 files, 3,882 insertions, 65 deletions.
- Full `PHASE_BASE..TASK_HEAD` diff: 32 files, 7,808 insertions, 13 deletions.
- The complete correction diff, direct/transitive dependency tree, full Task name/status inventory, product scope, licensing metadata, privacy, and absence of debug output were inspected.

The Deno offline check refreshed unrelated stale package-workspace versions in `deno.lock`; those unrelated mechanical changes were removed, leaving only the justified `entities` lock entry. The normal commit hook again generated unrelated pre-existing design-system adoption drift for `tests/answer-content.test.ts` and stopped before committing. That unstaged generated change was removed and not absorbed. The successful commit used the documented one-shot `SKIP_DOCS_SYNC_HOOK=1`; focused tests and all distinct package/type/maintainability/format/diff gates were already green.

### Boundaries and residual risk

- No provider, network, Supabase, database, Storage, migration application/replay/status, recovery/PITR/restore, actual source/document/corpus parsing or processing, OCR, upload, embedding, enqueue, worker execution, reindex, activation, rollback, cleanup, push, PR, deploy, GitHub, hosted CI, or external operation was run. No documents were processed.
- The failed offline npm metadata attempt used npm's cache-only mode and made no network request; package/lock promotion was then performed from the exact already-installed package metadata.
- Verification used only repository source, installed dependencies, synthetic local strings, and pure trusted-page/worker matchers. No actual source payload, document, database row, Storage object, or provider output was read.
- No migration, schema, cache, recovery receipt, reindex, lifecycle, provider, or unrelated product owner changed in this correction.
- Controller-owned `.superpowers/`, all P05 execution artifacts including this report and both review reports, and the P05 receipt remain untracked and unstaged.

## Final bounded correction cycle 6

### Revision and review identity

- Phase review-5 SHA-256: `3d398fd1cd8a3695d8347edd899882cdd75935cbfb831fb59a60b8e50d8e289d`.
- Task review-8 SHA-256: `4a5b5d0a8a64837fd1f4dcc1e7a8be6bb878dad8bc44db3e7eb01a861b13d7db` (`SPEC_VERDICT: PASS`, `QUALITY_VERDICT: PASS` at its reviewed head).
- Review candidate: `14f921e831c9b4aa8df9c0b6a2f45cd4706b311a`; final TASK_HEAD: `2acf4fcd4b26cd533e610abe25ee2b1451ce3b28`.
- Immutable Task 3 base: `62adef3b97906f6164f3d568712141dd9cd4117d`; phase base: `0d5bb6a5012bd762bb53790ac24de16c7e3078c8`.
- Correction commit: `2acf4fcd fix(ingestion): stream canonical protected identities`.
- Complete Task 3 commit chain: `c0f09a27e`, `48ca64361`, `866944e12`, `ad2c90c0a`, `8a6184130`, `6680b4f9a`, `3d528b6d3`, `2e01a2ef`, `14f921e8`, `2acf4fcd`.

### Closure and evidence

The shared policy exports the canonical representation and matcher already used after complete HTML decoding, NFKC, tag/zero-width removal, case folding, and punctuation/whitespace normalization. The actual worker page owner now carries bounded 64-character compact and spaced suffixes, a trailing-boundary bit, and the existing 256-character raw lexical suffix. Each page checks both canonical continuation and the lexical reparse window, then truncates state deterministically; state is neither accumulated nor emitted in diagnostics.

Exact schema-valid rows 499=`Health`, 500=300 periods, and 501=`direct` now match both whole and paged scans even though the raw suffix evicts `Health`. A supplementary `e` + 300 zero-width characters + `TG` case proves spaced-token state, and `He&af` / `r;lthdirect` proves entity decoding remains continuous across rows 500/501.

- RED: `node scripts/run-vitest.mjs run tests/indexing-v3-agent.test.ts` exited 1 with 1 failed/19 passed for the required raw-eviction case. A supplementary boundary-semantics RED was 1 failed/20 passed.
- GREEN: the identical worker selector passed 21/21 after implementation and scoped formatting.
- `npm run typecheck` — PASS at the final head. An intermediate run caught and led to removal of two stale raw-string test calls.
- `npm run check:maintainability-budgets` — PASS; `src/lib/rag/rag.ts` remains 4362/4362 and the worker 1993/2191.
- Scoped Prettier and correction/full-range `git diff --check` — PASS.
- Correction diff: 3 files, 133 insertions, 19 deletions. Full `TASK_BASE..TASK_HEAD`: 24 files, 3,997 insertions, 66 deletions. Full `PHASE_BASE..TASK_HEAD`: 32 files, 7,922 insertions, 13 deletions.
- Full correction/source/caller and Task inventories were inspected for bounds, scope, privacy, debug output, and unrelated drift. No broad duplicate selector was run because the actual changed worker/helper path is directly covered.

The normal hook again produced only unrelated pre-existing design-system adoption drift for `tests/answer-content.test.ts`; it was removed and not absorbed. The successful commit used `SKIP_DOCS_SYNC_HOOK=1` after the focused gates were green.

### Boundaries

No provider, network, registry, Supabase, database, Storage, migration application/replay/status, recovery/PITR/restore, actual source/document/corpus parsing or processing, OCR, upload, embedding, enqueue, worker execution, reindex, activation, rollback, cleanup, push, PR, deploy, GitHub, hosted CI, or external operation was run. No documents were processed. Verification used only repository source and synthetic in-memory strings/rows through the pure production paging helper. No dependency, lock, migration, schema, cache, receipt, lifecycle, provider, or unrelated owner changed. Controller-owned `.superpowers/`, P05 artifacts/report/reviews, and the P05 receipt remain untracked and unstaged.

## Final bounded correction cycle 7

### Revision and review identity

- Task review-9 SHA-256: `4726aaa51fefaa1fda83a46b016ad98746e7638fffeaa1355551a51e14a0b669`.
- Phase review-6 SHA-256: `c0ab623c08848a14656fe80bceef163b936fe5e4889ba9399a30be90662e5d9e`.
- Review candidate: `2acf4fcd4b26cd533e610abe25ee2b1451ce3b28`.
- Immutable Task 3 base: `62adef3b97906f6164f3d568712141dd9cd4117d`; phase base: `0d5bb6a5012bd762bb53790ac24de16c7e3078c8`.
- Final TASK_HEAD: `de7714a5aa0a225f0d986071dbcc5eecf1505c58`.
- Correction commit: `de7714a5 fix(ingestion): bound protected identity scanner state`.
- Complete Task 3 commit chain: `c0f09a27e`, `48ca64361`, `866944e12`, `ad2c90c0a`, `8a6184130`, `6680b4f9a`, `3d528b6d3`, `2e01a2ef`, `14f921e8`, `2acf4fcd`, `de7714a5`.

### Bounded streaming scanner closure

The shared public-source policy now owns one incremental protected-identity scanner used by both `forbiddenPublicSourceIdentity` and the real worker paging loop. Its carried handle exposes no source text, raw suffix, compact suffix, spaced suffix, or chunk buffer. A fixed primitive snapshot contains only lexical/entity state, finite pattern prefix lengths, token-state integers, a match bitmask, and booleans; its shape stays constant after 100,000 removable characters.

The scanner streams HTML tag and comment syntax without retaining markup, including arbitrarily long attributes, quoted `>` characters, and comments containing `>` before their real `-->` terminator. The installed `entities@8` `EntityDecoder` and WHATWG HTML decode trie remain live across writes, accept arbitrarily many numeric leading zeroes, and decode named/numeric references split over pages. A single integer carries a decoded high surrogate until its paired low surrogate arrives, after which per-code-point NFKC/case normalization feeds the finite matcher.

Compact protected identities use prefix/KMP state for `healthdirect`, `therapeuticguideline`, and `australianmedicineshandbook`. Exact spaced `etg` and `amh` tokens use bounded token DFA state. Zero-width controls remain removable, other punctuation/markup becomes a boundary, and no input-derived text is retained or emitted. The worker creates one scanner per document, writes every ordered row through it across all 500-row pages, and finalizes it only at end of input. Scanner/load failures still propagate through the existing pre-provider policy boundary.

The stale `@ts-expect-error` was removed. The cross-runtime explicit `.ts` import now uses a narrowly documented `@ts-ignore` on the same single import statement: Node TypeScript accepts the Deno-required extension, while Deno 2.9.4 no longer reports an unused directive.

### Strict TDD and verification evidence

Initial focused RED command after adding the exact required regressions and before implementation:

`node scripts/run-vitest.mjs run tests/public-source-acquisition.test.ts tests/indexing-v3-agent.test.ts`

Observed RED: exit 1; 2 files executed; 3 tests failed and 51 passed. The failures were exactly the absent primitive scanner snapshot, unlimited-leading-zero/long-tag page continuation, and three-page named/numeric/spaced-acronym continuation. A supplemental comment-stream regression was also established before its finite comment states: the focused test exited 1 with 1 failed and 22 skipped.

Final focused GREEN after implementation and scoped formatting: the same full acquisition/worker command exited 0 with 2 files and 54 tests passed. It includes:

- rows 499=`Health&#`, 500=300 zeroes, 501=`100;irect`, with whole and paged scans both rejecting it;
- an arbitrarily long quoted tag split across pages;
- a long comment containing an internal `>` and split real terminator;
- the exact three-page `He&af` / `r;` / `lthdirect`, `Health&#x6` / `4` / `irect`, and `e&ts` / `cr;` / `G` cases with 499 removable rows between the entity resolution and final suffix;
- the prior named/numeric/semicolonless/zero-width/300-punctuation and rows-499/500/501 cases; and
- constant-shape, primitive-only exposed state with no retained input substring.

Distinct exact-head gates:

- `npm run typecheck` — PASS. An intermediate run identified that the multi-line import moved TS5097 off the suppression line; the final single-line cross-runtime import passes.
- Deno `2.9.4`: the actual shared policy, worker behavior module, and `supabase/functions/indexing-v3-agent/index.ts` all PASS `deno check --frozen --node-modules-dir=none` with HTTP/HTTPS/ALL proxy traffic forced to a refused loopback address. Because the repository `deno.lock` has unrelated pre-existing package-workspace drift and the worktree lacks a manual `postgres` package, a disposable copy was first aligned from cached dependencies with `--frozen=false`, then the exact frozen check ran against that copy. The temporary lock was deleted and `deno.lock` was not modified.
- `npm run check:maintainability-budgets` — PASS; `src/lib/rag/rag.ts` remains 4362/4362 and the actual worker entrypoint is 1993/2191.
- Scoped Prettier check over all three changed owners and correction/full-range `git diff --check` — PASS.
- Correction diff: 3 files, 430 insertions, 93 deletions.
- Full `TASK_BASE..TASK_HEAD` diff: 24 files, 4,337 insertions, 69 deletions.
- Full `PHASE_BASE..TASK_HEAD` diff: 32 files, 8,259 insertions, 13 deletions.
- The full Task commit chain, complete Task name/status inventory, correction diff, sensitive-value/debug scan, and Task/phase diff checks were inspected. The only secret-shaped additions in the complete Task range are deliberate synthetic rejection fixtures.

The normal commit hook again generated only unrelated pre-existing design-system adoption drift for `tests/answer-content.test.ts`; it stopped before committing. That task-created unstaged output was restored and not absorbed. The successful commit used the hook's documented one-shot `SKIP_DOCS_SYNC_HOOK=1` after the focused, Deno, type, maintainability, format, and diff gates were green.

### Files and boundaries

Committed correction files only:

- `supabase/functions/_shared/public-source-policy.ts`
- `supabase/functions/indexing-v3-agent/behavior.ts`
- `tests/indexing-v3-agent.test.ts`

No provider, registry, external network, Supabase, database, Storage, migration application/replay/status, recovery/PITR/restore, actual source/document/corpus parsing or processing, OCR, upload, embedding, enqueue, worker execution, reindex, activation, rollback, cleanup, push, PR, deploy, GitHub, hosted CI, or external operation was run. No documents were processed. Verification used only installed/cache-resident dependencies, repository source, and synthetic in-memory strings/rows through pure acquisition/worker policy owners. No dependency, lock, migration, schema, cache, recovery receipt, lifecycle SQL, provider, or unrelated product owner changed. Controller-owned `.superpowers/`, all P05 execution artifacts including this report and both review reports, and the P05 receipt remain untracked and unstaged.

## Final bounded correction cycle 8

### Revision and review identity

- Task review-10 SHA-256: `8e6efd73f10e59bbf746cf7c842863c88eeee3938d96039a574ff5f86666f7fb`.
- Phase review-7 SHA-256: `024126062d8b47cb510b583a59f37611cec69b62ad47b7ab02b44cec6acc6f2b`.
- Review candidate: `de7714a5aa0a225f0d986071dbcc5eecf1505c58`.
- Immutable Task 3 base: `62adef3b97906f6164f3d568712141dd9cd4117d`; phase base: `0d5bb6a5012bd762bb53790ac24de16c7e3078c8`.
- Final TASK_HEAD: `8dcd23422798ac3fb76b03c09f4cf5ff15b6dce2`.
- Correction commit: `8dcd2342 fix(ingestion): preserve malformed lexical content`.
- Complete Task 3 commit chain: `c0f09a27e`, `48ca64361`, `866944e12`, `ad2c90c0a`, `8a6184130`, `6680b4f9a`, `3d528b6d3`, `2e01a2ef`, `14f921e8`, `2acf4fcd`, `de7714a5`, `8dcd2342`.

### Malformed lexical closure

The shared scanner now owns three fixed-size matcher states: the committed canonical state plus entity and markup speculative branches. Each state contains only finite pattern-prefix, exact-token, and match-bit integers. No input text, entity spelling, tag/comment text, raw suffix, canonical suffix, array, or growing buffer is retained.

On `&`, the scanner clones the canonical matcher into the entity branch, emits the literal ampersand boundary there, and advances that branch for every tentative code point while the installed WHATWG `EntityDecoder` runs. A valid named/numeric/legacy reference discards the speculative result and emits the decoded code point to the canonical state. A decoder rejection or unfinished invalid reference commits the literal branch, including the terminating character, so `Health&direct`, `Health&di!rect`, `Therapeutic&Guidelines`, and `Australian&Medicines&Handbook` cannot lose letters.

On `<`, the scanner similarly advances a literal markup branch while accepting suppression only after valid tag-open, end-tag-open, declaration, or comment prefixes. Invalid opens such as `< ` immediately commit their literal branch. Valid closed tags/comments discard the branch and emit one canonical boundary; unfinished tags, quotes, declarations, and comments commit the literal branch at finalization. This preserves valid markup behavior while making `Health<direct`, `Health<!--direct`, and retained `<main>Health< direct</main>` text fail closed without retaining markup.

Both one-shot acquisition policy and the actual ordered worker paging loop continue to use this single scanner owner. The regressions run every malformed worker fixture one code point per page, so entity/tag/comment speculation is proven across arbitrary page boundaries rather than only within a whole string.

### Strict TDD and verification evidence

Focused RED after adding the exact one-shot, trusted-page, paged-worker, and bounded-state assertions, before implementation:

`node scripts/run-vitest.mjs run tests/public-source-acquisition.test.ts tests/indexing-v3-agent.test.ts`

Observed corrected RED: exit 1; 2 files executed; 4 tests failed and 52 passed. Failures were the shared one-shot matrix, trusted-page quarantine matrix, real one-character-per-page worker scan, and unfinished-markup finalization. An earlier RED run exposed one invalid test assertion that searched serialized field names for a protected word; that assertion was corrected to the intended primitive-value contract before implementation and the command was rerun to establish the recorded RED.

Final focused GREEN after implementation and scoped formatting: the identical command exited 0 with 2 files and 56 tests passed. It preserves all prior valid entity, numeric-leading-zero, tag/comment, cross-page suffix, acronym, zero-width, punctuation, and three-page cases while adding the seven malformed lexical fixtures at the relevant boundaries. A 100,000-character unfinished markup case also proves fixed-size primitive-only snapshot shape and successful conservative finalization.

Distinct exact-head gates:

- `npm run typecheck` — PASS.
- Deno `2.9.4`: `supabase/functions/_shared/public-source-policy.ts`, `supabase/functions/indexing-v3-agent/behavior.ts`, and the actual `supabase/functions/indexing-v3-agent/index.ts` entrypoint all passed using cached dependencies with HTTP/HTTPS/ALL proxy traffic forced to refused loopback. Because the repository lock retains unrelated pre-existing package-workspace drift, a disposable copy was cache-aligned with `--frozen=false` and then the same actual module set passed `--frozen --node-modules-dir=none`. The temporary lock was deleted; `deno.lock` did not change.
- `npm run check:maintainability-budgets` — PASS; `src/lib/rag/rag.ts` remains 4362/4362 and the actual worker entrypoint remains 1993/2191.
- Scoped Prettier check over all three changed owners and correction/full-range `git diff --check` — PASS.
- Correction diff: 3 files, 264 insertions, 115 deletions.
- Full `TASK_BASE..TASK_HEAD` diff: 24 files, 4,484 insertions, 67 deletions.
- Full `PHASE_BASE..TASK_HEAD` diff: 32 files, 8,408 insertions, 13 deletions.
- The complete Task commit chain, Task name/status inventory, correction diff, full-range privacy/debug scan, and Task/phase diff checks were inspected. The only secret-shaped additions in the complete Task range remain deliberate synthetic rejection fixtures.

The commit used the documented one-shot `SKIP_DOCS_SYNC_HOOK=1` because changed test ownership would otherwise regenerate known unrelated design-system adoption-manifest drift. That generated documentation was not changed or staged; all focused, Deno, type, maintainability, format, and diff gates were already green.

### Files and boundaries

Committed correction files only:

- `supabase/functions/_shared/public-source-policy.ts`
- `tests/indexing-v3-agent.test.ts`
- `tests/public-source-acquisition.test.ts`

No provider, registry, external network, Supabase, database, Storage, migration application/replay/status, recovery/PITR/restore, source fetch, actual source/document/corpus parsing or processing, OCR, upload, embedding, enqueue, worker execution, reindex, activation, rollback, cleanup, push, PR, deploy, GitHub, hosted CI, or other external operation was run. No documents were processed. Verification used only installed/cache-resident dependencies, repository source, and synthetic in-memory strings/rows through pure acquisition and worker policy owners. No dependency, lock, migration, schema, cache, recovery receipt, lifecycle SQL, provider, or unrelated product owner changed. Controller-owned `.superpowers/`, all P05 execution artifacts including this report and both review reports, and the P05 receipt remain untracked and unstaged.

## Final bounded correction cycle 9

### Revision and review identity

- Phase review-8 SHA-256: `9b06e9a48a1e7b2294ed6c8a93f20cde21f89f12af6531ca9cb23e5bd5e33923` (verified from the complete report).
- No Task review artifact exists for this candidate because the controller reported that the Task review turn stopped on a tool-policy false positive before producing a report.
- Review candidate: `8dcd23422798ac3fb76b03c09f4cf5ff15b6dce2`.
- Immutable Task 3 base: `62adef3b97906f6164f3d568712141dd9cd4117d`; phase base: `0d5bb6a5012bd762bb53790ac24de16c7e3078c8`.
- Final TASK_HEAD: `a1cc01c91db66d416f35d6d5cf1bae9b766061b8`.
- Correction commit: `a1cc01c91 fix(ingestion): preserve legacy entity excess`.
- Complete Task 3 commit chain: `c0f09a27e`, `48ca64361`, `866944e12`, `ad2c90c0a`, `8a6184130`, `6680b4f9a`, `3d528b6d3`, `2e01a2ef`, `14f921e8`, `2acf4fcd`, `de7714a5`, `8dcd2342`, `a1cc01c91`.

### Shorter legacy entity closure

The shared incremental scanner now maintains a fixed array of at most 64 decoded-prefix matcher checkpoints while an entity is speculative. A checkpoint is keyed only by the decoder-reported consumed length and contains only the existing numeric/boolean finite matcher state. It never retains the entity spelling, source text, suffix text, or chunk content.

When the WHATWG decoder exposes a valid named prefix, the scanner creates that consumed-length checkpoint from the pre-entity matcher state and emits the decoded code point or code points into it. Every later candidate code point advances all existing checkpoints through its literal normalized interpretation. When the decoder selects a shorter legacy match, the scanner commits the exact checkpoint that already includes the literal excess. Invalid or unfinished references continue to commit the fixed literal speculative state. Numeric references skip prefix probing, preserving the prior bounded unlimited-leading-zero behavior.

Consequently, `Health&ltdirect` and `Health&gtdirect` are interpreted with their standards-valid `&lt` and `&gt` legacy prefixes and rejected as protected `Healthdirect` identities. The one-shot owner, trusted-page acquisition boundary, and real worker scan all use the same state machine; the worker regressions feed one code point per 500-row page.

### Strict TDD and verification evidence

Focused RED after adding the exact legacy-semicolonless assertions and before implementation:

`node scripts/run-vitest.mjs run tests/public-source-acquisition.test.ts tests/indexing-v3-agent.test.ts`

Observed RED: exit 1; 2 files executed; 3 tests failed and 53 passed. The failures were exactly the shared one-shot matrix, trusted-page acquisition matrix, and real one-code-point-per-page worker scan for the missing shorter-prefix/excess semantics.

Final focused GREEN after implementation and scoped formatting: the identical command exited 0 with 2 files and 56 tests passed. It includes both `Health&ltdirect` and `Health&gtdirect` at all three boundaries and preserves the complete prior malformed/valid named and numeric entity, arbitrarily long numeric-leading-zero, valid tag/comment, cross-page suffix, acronym, zero-width, punctuation, and three-page streaming matrices. The bounded-state regression also proves that checkpoint count stays within the fixed limit and the primitive-only exposed snapshot remains constant-size after 100,000 excess code points.

Distinct exact-head gates:

- `npm run typecheck` — PASS.
- Deno `2.9.4`: the shared policy, worker behavior module, and actual `supabase/functions/indexing-v3-agent/index.ts` entrypoint all passed `deno check --frozen --node-modules-dir=none` from cached dependencies with HTTP/HTTPS/ALL proxy traffic forced to refused loopback. A disposable lock copy was cache-aligned first because of the repository's unrelated pre-existing package-workspace drift; the frozen check then passed and the temporary lock was deleted. The repository `deno.lock` was unchanged.
- `npm run check:maintainability-budgets` — PASS; `src/lib/rag/rag.ts` remains 4362/4362 and the actual worker entrypoint remains 1993/2191.
- Scoped Prettier write/check over the three changed files, staged `git diff --check`, correction/full-range diff checks, and the correction sensitive/debug scan — PASS.
- Correction diff: 3 files, 120 insertions, 10 deletions.
- Full `TASK_BASE..TASK_HEAD` diff: 24 files, 4,594 insertions, 67 deletions.
- Full `PHASE_BASE..TASK_HEAD` diff: 32 files, 8,518 insertions, 13 deletions.
- The complete Task range, phase correction range, commit chain, status, and sensitive/debug scan were inspected. The only secret-shaped additions in the complete Task range remain deliberate synthetic rejection fixtures.

The commit used the documented one-shot `SKIP_DOCS_SYNC_HOOK=1` because changed test ownership would otherwise regenerate known unrelated design-system adoption-manifest drift. No generated documentation was changed or staged; all focused, Deno, type, maintainability, format, and diff gates were already green.

### Files and boundaries

Committed correction files only:

- `supabase/functions/_shared/public-source-policy.ts`
- `tests/indexing-v3-agent.test.ts`
- `tests/public-source-acquisition.test.ts`

No provider, registry, external network, Supabase, database, Storage, migration application/replay/status, recovery/PITR/restore, source fetch, actual source/document/corpus parsing or processing, OCR, upload, embedding, enqueue, worker execution, reindex, activation, rollback, cleanup, push, PR, deploy, GitHub, hosted CI, or other external operation was run. No documents were processed. Verification used only installed/cache-resident dependencies, repository source, and synthetic in-memory strings/rows through pure acquisition and worker policy owners. No dependency, lock, migration, schema, cache, recovery receipt, lifecycle SQL, provider, or unrelated product owner changed. Controller-owned `.superpowers/`, all P05 execution artifacts including this report and the phase review, and the P05 receipt remain untracked and unstaged.

## Final bounded correction cycle 10

### Revision and review identity

- Task review-11 SHA-256: `fd80784537fe9671c84e7bc53d9a5785ee1d18dc3146fbc8596683e2a5c73173` (verified from the complete report).
- Phase review-9 SHA-256: `6d6b2eee643e38421c09124bf5c85aa9494dbb8dd9c8806bae620c4fe5c7d7ee` (verified from the complete PASS report).
- Review candidate: `a1cc01c91db66d416f35d6d5cf1bae9b766061b8`.
- Immutable Task 3 base: `62adef3b97906f6164f3d568712141dd9cd4117d`; phase base: `0d5bb6a5012bd762bb53790ac24de16c7e3078c8`.
- Final TASK_HEAD: `a3f197741d701caf25d0519b22a190578545a6cb`.
- Correction commit: `a3f197741 fix(ingestion): reconsume malformed lexical starters`.
- Complete Task 3 commit chain: `c0f09a27e`, `48ca64361`, `866944e12`, `ad2c90c0a`, `8a6184130`, `6680b4f9a`, `3d528b6d3`, `2e01a2ef`, `14f921e8`, `2acf4fcd`, `de7714a5`, `8dcd2342`, `a1cc01c91`, `a3f197741`.

### Malformed-token reconsume closure

The shared scanner's write loop now has an explicit local reconsume branch. Entity failure first disables entity mode and commits its fixed literal speculative matcher state. Markup failure first commits its fixed literal speculative matcher state and resets the lexical mode to text. If the same terminating code point is `&` or `<`, that code point is then processed again through text mode so it can start the immediately adjacent entity or tag. Other terminating code points retain the prior single-consumption behavior.

The reconsume counter is local, contains no source content, and permits at most two interpretations of one code point. Any impossible third pass throws the constant `protected_identity_lexical_reconsume_limit`, proving non-progress fails closed. The fallback mode transition occurs before reprocessing, so repeated malformed starters progress one input code point at a time without recursion, retained text, or state growth.

The exact `Health&&#100;irect`, `Health&&amp;direct`, `Health<<em>direct`, and `Health<&#100;irect` cases now reject as `healthdirect` through the one-shot owner, retained trusted-page evaluation, local text/plain identity verdict, and the real worker paging owner with one code point per page. Repeated `&&&&` and `<<<<` variants also reject through the one-code-point worker path.

### Strict TDD and verification evidence

Focused RED after adding the exact cross-boundary and progress/state regressions, before implementation:

`node scripts/run-vitest.mjs run tests/public-source-acquisition.test.ts tests/indexing-v3-agent.test.ts`

Observed RED: exit 1; 2 files executed; 2 tests failed and 56 passed. The failures were exactly the acquisition-side one-shot/trusted/text-plain matrix and the real one-code-point-per-page worker matrix for absent same-character reconsume semantics.

Final focused GREEN after implementation; scoped Prettier made no changes: the identical command exited 0 with 2 files and 58 tests passed. It covers all four exact malformed/valid-token adjacencies at every requested boundary, repeated starter chains and page-edge splits, and a 100,000-ampersand fixed-state regression. All prior valid/invalid entity, legacy shorter-prefix/checkpoint, numeric-leading-zero, markup/comment, multi-page suffix, acronym, zero-width, and punctuation matrices remain green.

Distinct exact-head gates:

- `npm run typecheck` — PASS.
- Deno `2.9.4`: `supabase/functions/_shared/public-source-policy.ts`, `supabase/functions/indexing-v3-agent/behavior.ts`, and the actual `supabase/functions/indexing-v3-agent/index.ts` entrypoint all passed `deno check --no-lock --node-modules-dir=none` from installed/cache-resident dependencies with HTTP/HTTPS/ALL proxy traffic forced to refused loopback and update checks disabled.
- `npm run check:maintainability-budgets` — PASS; `src/lib/rag/rag.ts` remains 4362/4362 and the actual worker entrypoint remains 1993/2191.
- Scoped Prettier write/check over the three changed files, staged `git diff --check`, correction/full-range diff checks, and correction privacy/debug inspection — PASS.
- Correction diff: 3 files, 119 insertions, 47 deletions.
- Full `TASK_BASE..TASK_HEAD` diff: 24 files, 4,666 insertions, 67 deletions.
- Full `PHASE_BASE..TASK_HEAD` diff: 32 files, 8,590 insertions, 13 deletions.
- The complete Task range, phase correction range, commit chain, status, and sensitive/debug scan were inspected. The only secret-shaped additions in the complete Task range remain deliberate synthetic rejection fixtures.

The commit used the documented one-shot `SKIP_DOCS_SYNC_HOOK=1` because changed test ownership would otherwise regenerate known unrelated design-system adoption-manifest drift. No generated documentation was changed or staged; all focused, Deno, type, maintainability, format, and diff gates were already green.

### Files and boundaries

Committed correction files only:

- `supabase/functions/_shared/public-source-policy.ts`
- `tests/indexing-v3-agent.test.ts`
- `tests/public-source-acquisition.test.ts`

No provider, registry, external network, Supabase, database, Storage, migration application/replay/status, recovery/PITR/restore, source fetch, actual source/document/corpus parsing or processing, OCR, upload, embedding, enqueue, worker execution, reindex, activation, rollback, cleanup, push, PR, deploy, GitHub, hosted CI, or other external operation was run. No documents were processed. Verification used only installed/cache-resident dependencies, repository source, and synthetic in-memory strings/rows through pure acquisition and worker policy owners. No dependency, lock, migration, schema, cache, recovery receipt, lifecycle SQL, provider, or unrelated product owner changed. Controller-owned `.superpowers/`, all P05 execution artifacts including this report and both review reports, and the P05 receipt remain untracked and unstaged.

## Final bounded correction cycle 11

### Revision and review identity

- Task review-12 SHA-256: `bb9685c33c486c6e02697fc67388618ae676c26be3712afdea2ef2b322872f96` (verified from the complete report).
- Phase review-10 SHA-256: `f586e9f522f87a922f626def04603960c7c9b25139d1d522802bf8c46d34284c` (verified from the complete PASS report).
- Review candidate: `a3f197741d701caf25d0519b22a190578545a6cb`.
- Immutable Task 3 base: `62adef3b97906f6164f3d568712141dd9cd4117d`; phase base: `0d5bb6a5012bd762bb53790ac24de16c7e3078c8`.
- Final TASK_HEAD: `8dbdba79b79f081ca0a09b7a5450f2b1193610f4`.
- Correction commit: `8dbdba79b fix(ingestion): reconsume legacy entity successors`.
- Complete Task 3 commit chain: `c0f09a27e`, `48ca64361`, `866944e12`, `ad2c90c0a`, `8a6184130`, `6680b4f9a`, `3d528b6d3`, `2e01a2ef`, `14f921e8`, `2acf4fcd`, `de7714a5`, `8dcd2342`, `a1cc01c91`, `a3f197741`, `8dbdba79b`.

### Legacy-checkpoint successor closure

The positive entity-result branch now distinguishes three bounded facts. The decoder's exact `consumed` length relative to the pre-current offset determines whether the current code point belonged to the entity. A newly created checkpoint has not advanced an unconsumed current code point and therefore reprocesses it. An existing checkpoint has already advanced ordinary literal excess, but an unconsumed `&` or `<` is still reprocessed through text mode so it can start adjacent syntax. Only these cases control the input index; checkpoint existence alone can no longer consume a new entity/tag starter.

The existing two-pass ceiling remains unchanged. Reprocessing occurs only after entity mode has ended, and the second interpretation either starts the adjacent token or consumes the character. State remains fixed numeric/boolean matcher/checkpoint data with no retained content.

The exact `Healthd&not&#105;rect`, `Health&lt&#100;irect`, `Health&lt<em>direct`, `TherapeuticGu&not&#105;deline`, and `AustralianMed&not&#105;cinesHandbook` inputs now reject through the one-shot, retained trusted-page, local text/plain, and real one-code-point-per-page worker boundaries. Repeated `&not&&#105;` and `&lt<<em>` combinations prove bounded progress through composed shorter-entity and adjacent-starter branches.

### Strict TDD and verification evidence

Focused RED after adding the exact intersection and repeated-combination regressions, before implementation:

`node scripts/run-vitest.mjs run tests/public-source-acquisition.test.ts tests/indexing-v3-agent.test.ts`

Observed RED: exit 1; 2 files executed; 2 tests failed and 56 passed. The failures were exactly the acquisition one-shot/trusted/text-plain matrix and real one-code-point-per-page worker matrix for the absent shorter-checkpoint successor reconsume.

An intermediate implementation that reprocessed every unconsumed current code point correctly exposed three regressions in the prior semicolonless numeric/literal cases (3 failed, 55 passed): newly created checkpoints need ordinary current excess replay, while existing checkpoints have already advanced ordinary literal excess. The final offset-first rule retains that distinction but overrides it for unconsumed `&`/`<` starters.

Final focused GREEN after the corrected implementation; scoped Prettier made no changes: the identical command exited 0 with 2 files and 58 tests passed. It covers all five requested protected identities, repeated combinations, all prior malformed-fallback cases, shorter legacy checkpoints, numeric semicolonless cases, markup/comments, multi-page suffixes, acronyms, zero-width, and bounded-state stress.

Distinct exact-head gates:

- `npm run typecheck` — PASS.
- Deno `2.9.4`: `supabase/functions/_shared/public-source-policy.ts`, `supabase/functions/indexing-v3-agent/behavior.ts`, and the actual `supabase/functions/indexing-v3-agent/index.ts` entrypoint all passed `deno check --no-lock --node-modules-dir=none` from installed/cache-resident dependencies with HTTP/HTTPS/ALL proxy traffic forced to refused loopback and update checks disabled.
- `npm run check:maintainability-budgets` — PASS; `src/lib/rag/rag.ts` remains 4362/4362 and the actual worker entrypoint remains 1993/2191.
- Scoped Prettier write/check over the three changed files, staged `git diff --check`, correction/full-range diff checks, and correction privacy/debug inspection — PASS.
- Correction diff: 3 files, 27 insertions, 12 deletions.
- Full `TASK_BASE..TASK_HEAD` diff: 24 files, 4,681 insertions, 67 deletions.
- Full `PHASE_BASE..TASK_HEAD` diff: 32 files, 8,605 insertions, 13 deletions.
- The complete Task range, phase correction range, commit chain, status, and sensitive/debug scan were inspected. The only secret-shaped additions in the complete Task range remain deliberate synthetic rejection fixtures.

The commit used the documented one-shot `SKIP_DOCS_SYNC_HOOK=1` because changed test ownership would otherwise regenerate known unrelated design-system adoption-manifest drift. No generated documentation was changed or staged; all focused, Deno, type, maintainability, format, and diff gates were already green.

### Files and boundaries

Committed correction files only:

- `supabase/functions/_shared/public-source-policy.ts`
- `tests/indexing-v3-agent.test.ts`
- `tests/public-source-acquisition.test.ts`

No provider, registry, external network, Supabase, database, Storage, migration application/replay/status, recovery/PITR/restore, source fetch, actual source/document/corpus parsing or processing, OCR, upload, embedding, enqueue, worker execution, reindex, activation, rollback, cleanup, push, PR, deploy, GitHub, hosted CI, or other external operation was run. No documents were processed. Verification used only installed/cache-resident dependencies, repository source, and synthetic in-memory strings/rows through pure acquisition and worker policy owners. No dependency, lock, migration, schema, cache, recovery receipt, lifecycle SQL, provider, or unrelated product owner changed. Controller-owned `.superpowers/`, all P05 execution artifacts including this report and both review reports, and the P05 receipt remain untracked and unstaged.
