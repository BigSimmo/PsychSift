# P06 repositoryContent Task 3 review 1

## Findings

### 1. CRITICAL — Public reads are not isolated by the active release, so per-record completion exposes a partial candidate before activation

Evidence:

- `supabase/migrations/20260824130000_add_site_content_release_and_outbox.sql:166-192` returns `activeReleaseId` as metadata but reads rows directly from `site_content_publications`; it never joins `site_content_release_projections` or filters publications to the active release.
- `supabase/migrations/20260824130000_add_site_content_release_and_outbox.sql:232-242` allows `p_release_id` to be null and marks an outbox row complete. Completion removes that logical ID from the pending anti-join at lines 186-190, making its publication immediately readable.
- `supabase/functions/site-content-sync/index.ts:22,65-70` makes `releaseId` optional and deliberately submits null when `processEvent` does not return one.
- `supabase/migrations/20260824130000_add_site_content_release_and_outbox.sql:265-287` swaps the pointer later, but that pointer does not control the rows selected by the reader.

Trigger: publish two changed logical IDs, complete only one event, and delay or fail candidate activation. The completed row is returned with the old (or null) `activeReleaseId` while the other row remains excluded. Expected behavior is an immutable active-release projection that changes as one atomic pointer swap only after every event, digest, count, recovery, and must-pass binding is verified. Actual risk is a mixed public corpus and partial activation despite the nominal release pointer.

Smallest proof/fix gate: a transactional database test must show that readers return byte-identical old-release bytes throughout staging and switch all changed/unchanged/tombstoned IDs together only after activation; event completion must require and verify the exact non-null candidate release.

### 2. CRITICAL — The canonical registry reader requests domains the database refuses, breaking public parity for two of the seven routes

Evidence:

- `src/app/api/registry/records/route.ts:185` and `src/app/api/registry/records/[slug]/route.ts:89` call the public reader with `forms` or `services`.
- `supabase/migrations/20260824130000_add_site_content_release_and_outbox.sql:40,131` permits only `registry`, `medications`, and `differentials` in publication rows.
- Once the RPC exists, an empty partition is authoritative rather than a bundled fallback (`src/lib/site-content/public-site-content.ts:36-44`). The migration initializes authority without an adopted active release at line 35 and contains no migration of legacy service/form rows into the new publication/release projection model.

Trigger: apply the migration and GET the registry collection or detail route. No row can be published under either requested domain, so the collection becomes an authoritative empty response and detail becomes 404 instead of preserving canonical public bytes. This disproves the required parity across all seven public routes and leaves no explicit legacy adoption/retirement disposition in the executable path.

Smallest proof/fix gate: a seven-route matrix using populated active-release fixtures must compare anonymous and authenticated response status, headers, and body bytes to the pre-migration canonical reader, including services and forms and an updating-state fallback.

### 3. CRITICAL — Activation/rollback creates a second, weaker receipt authority instead of reusing P05's exact recovery authority

Evidence:

- `supabase/migrations/20260824130000_add_site_content_release_and_outbox.sql:94-103` creates a new receipt schema containing none of P05's required receipt identity, sequence, project, operation, state digest, activation-receipt binding, and exact resource identity fields.
- The accepted P05 authority in `src/lib/recovery-readiness-evidence.ts:131-181,408-430` requires distinct receipt IDs, monotonic sequence/chronology, `activationReceiptId`, and rollback restoration to the activation receipt's exact `previousResource`.
- `supabase/migrations/20260824130000_add_site_content_release_and_outbox.sql:291-310` accepts any release currently labelled `retained` plus any syntactically valid SHA-256 recovery digest. It neither binds an activation receipt nor proves that the retained release is the failed release's exact prior pointer.
- Activation inserts the weaker parallel receipt directly at lines 265-287.

Trigger: retain releases A and B, activate C from A, then call rollback for C with B and any correctly shaped digest. The SQL can restore B, which is not C's exact predecessor, and emits a receipt that the accepted P05 parser could never accept. Expected behavior is exact reuse of P05 recovery evidence, activation receipts, rollback receipts, chronology, and retained-pointer authority. Actual risk is an unauthorized or irreproducible rollback recorded as valid.

Smallest proof/fix gate: feed P05-valid and adversarial activation/rollback receipt pairs through the single shared authority, then prove SQL rejects a non-predecessor retained release, a foreign activation receipt, a stale sequence, a mismatched project/operation, and a merely well-shaped recovery digest.

### 4. HIGH — The registered Edge worker has no invocation entry point and its failure/heartbeat fencing permits stale-worker mutation

Evidence:

- `supabase/functions/site-content-sync/index.ts:31-101` exports only an injected `drainSiteContentSyncBatch` helper; there is no `Deno.serve`, request authentication/authorization, environment binding, Supabase client, or concrete `processEvent`. `supabase/config.toml:7-8` nevertheless registers the function.
- Heartbeats occur only before selected events (`supabase/functions/site-content-sync/index.ts:42-65`), never while a slow provider operation is running.
- `supabase/migrations/20260824130000_add_site_content_release_and_outbox.sql:248-259` fences failure by event/worker/lease/generation/status but omits the `lease_expires_at > now()` check used by heartbeat and completion.

Trigger: let embedding work exceed the lease, then fail before another worker reclaims the row. The expired worker can retry or quarantine the event. Independently, the deployed function has no handler capable of running the drain at all. Expected behavior is a real bounded handler and canonical row/worker/lease/generation/attempt fencing with heartbeats that cover long work. Actual risk is either no synchronization or stale-worker mutation.

Smallest proof/fix gate: an offline handler test plus a clock-controlled concurrency test must prove periodic heartbeat during processing and rejection of completion, retry, and quarantine at and after lease expiry or after generation/lease replacement.

### 5. HIGH — Changed-only staging, exact embedding reuse, tombstones, and resumable target/digest/count binding exist only as an in-memory plan

Evidence:

- `site_content_release_projections` is declared at `supabase/migrations/20260824130000_add_site_content_release_and_outbox.sql:58-68` but has no executable writer or reader outside that migration.
- `src/lib/site-content/site-content-sync.ts:239-258` checks the lease once and then invokes optional callbacks sequentially. It does not persist or revalidate plan digest, target/project, release/generation, expected counts, resume cursor, or lease ownership between writes, and a partial callback sequence has no compensating transaction.
- Embedding reuse at `src/lib/site-content/site-content-sync.ts:170-184` trusts matching metadata and a syntactically valid stored digest; it does not verify the embedding bytes against that digest before declaring exact reuse.
- The only CLI path rejects writes and reports every eligible record as unchanged with zero tombstones without reading active projections (`scripts/sync-site-content-corpus.ts:24-52`).

Trigger: change one item, delete one item, or resume after `stageChanged` succeeds and `carryForward` fails. There is no durable candidate projection, tombstone, resume binding, or exact verified carry-forward to activate; the dry run still reports all records unchanged. Expected behavior is a durable, idempotent candidate bound to confirmed target/project, plan/release/static/dynamic digests, counts, generation, and resume state, with changed-only embedding calls and verified byte-for-byte reuse. Actual risk is silent omission, duplicate work, stale reuse, or a falsely complete candidate.

Smallest proof/fix gate: a repository-backed offline integration fixture must interrupt and resume a mixed add/change/unchanged/delete plan, verify only changed chunks invoke the mocked embedder, recompute reused embedding digests from bytes, and reject every target/digest/count/generation mismatch before activation.

### 6. HIGH — Administrator-only mutation is asserted by the caller and can be bypassed through broad service-role table grants

Evidence:

- `supabase/migrations/20260824130000_add_site_content_release_and_outbox.sql:116-131` trusts a caller-supplied `p_administrator_authorized` boolean; the security-definer function does not derive or verify an administrator claim.
- Lines 325-326 grant `ALL` on every new release/publication/projection/outbox/receipt table to `service_role`, so a service-role caller can bypass `publish_site_content_record`, its epoch/outbox atomicity, and its boolean check entirely.
- `tests/site-content-publication-access.test.ts:45-83` checks text patterns and the absence of public/authenticated mutation grants, but supplies no administrator/non-administrator execution proof and no canonical server mutation entry point.

Trigger: any internal service-role path calls the function with `true`, or writes the granted tables directly. Expected behavior is one administrator-authenticated mutation authority that constructs the transaction and cannot be bypassed by a weaker parallel write path. Actual risk is unproved administrator origin and corpus/epoch/outbox divergence.

Smallest proof/fix gate: a role matrix must prove anon, authenticated non-admin, and untrusted service callers cannot mutate; the one administrator path must atomically publish row + epoch + pending exclusion + outbox, while direct table mutation is denied outside that authority.

### 7. HIGH — Public fallback/error semantics fail open, while tests and generated database types do not cover the deployed contract

Evidence:

- `src/lib/site-content/public-site-content.ts:33-36` treats any error message containing `does not exist` as “migration absent” and also treats null or malformed successful data as fallback. The focused behavior probe proved both an unrelated `XX000: relation cache does not exist` error and `{ records: "not-an-array" }` silently return null.
- `tests/site-content-publication-access.test.ts:15-95` tests one helper partition plus source regexes. It does not execute active/updating/unavailable RPC responses across all seven routes or compare anonymous/authenticated bytes, errors, and headers.
- `src/lib/supabase/database.types.ts:2356-2410` adds function signatures (and types completion release ID as nullable) but omits all six new table definitions. Static probing found no `site_content_releases:` table entry.

Trigger: a permission/schema/cache error happens to contain “does not exist,” or the RPC returns a malformed payload. The public routes serve stale bundled fixtures instead of failing closed or returning the specified public unavailable/updating state. Expected behavior is fallback only for the exact undefined-function migration code and strict validation of every reader state; actual risk is hidden corruption and inconsistent public semantics.

Smallest proof/fix gate: table-driven tests must cover exact `42883`, unrelated messages/codes, null/malformed payloads, every valid state, all seven routes, anon/auth byte parity, and generated-type coverage of the migration.

## Verdicts

SPEC_VERDICT: FAIL

The immutable package does not satisfy the Task 3 brief. Findings 1-6 break active-release atomicity, seven-route parity, lease fencing, durable changed-only/tombstone/resume semantics, administrator-only mutation, and exact reuse of P05 recovery/rollback authority.

QUALITY_VERDICT: FAIL

The code is not deployable as a complete synchronization path, the reader fails open, the generated database types omit the new schema, and the tests rely mainly on source-shape assertions that do not exercise the public or concurrency contracts.

## Positive controls observed

- The migration uses fixed empty `search_path` on security-definer functions, revokes the new tables/functions from `public`, `anon`, and `authenticated`, and uses `FOR UPDATE SKIP LOCKED` for bounded claims.
- Worker errors/logs are content-free identifiers, counts, attempts, and fixed error codes.
- The seven GET routes no longer select canonical public content by owner identity, and no public mutation HTTP method was added.
- Publication removes the affected RAG cache row and inserts the outbox row in the publication function's transaction; there is no inline provider call in that path.
- `src/lib/rag/rag.ts` is unchanged and remains 4,362 lines. No document API, document ingestion function, or document indexing function changed in the review range.

These positives do not offset the blocking findings above.

## Immutable scope and package verification

- Base: `1788f3d95c88b4df65d3e13ddc6e5a7b186e8a07`
- Head: `10aeecc135c286fadc09e45cb2e04f43bcaefbff`
- Base is an ancestor of head; the range contains exactly one commit.
- Reviewed package: `P06-repository-content-task-3-review-1.diff`
- Required SHA-256: `572ec8379264a96671028c9ebe050957785cf41381b692d6a803124a76f6266b`
- Observed SHA-256: `572ec8379264a96671028c9ebe050957785cf41381b692d6a803124a76f6266b` — exact match.
- `npm run ledger:lookup -- 10aeecc135c286fadc09e45cb2e04f43bcaefbff --scope "P06 repositoryContent task-3"`: `NOT REVIEWED at this HEAD and scope.` No ledger write was made because this review is authorized to write only this report.

## Focused offline verification

Only distinct probes needed to adjudicate the disputed high-risk invariants were run. The implementer's already-reported broad tests/checks were not repeated.

1. Corrected static synchronization invariant probe — exit 1, as a finding-bearing adversarial probe. All seven required assertions were false:
   - `worker_has_http_entrypoint=False`
   - `public_reader_joins_active_release_projection=False`
   - `registry_route_domains_fit_publication_constraint=False`
   - `completion_requires_non_null_release=False`
   - `failed_attempt_requires_unexpired_lease=False`
   - `generated_types_cover_release_tables=False`
   - `public_fallback_is_strictly_undefined_function_code_only=False`
2. `node --import tsx --input-type=module -e <focused reader probe>` — exit 1, deliberately detecting both violations:
   - `malformed_response_fell_back=true`
   - `unrelated_does_not_exist_error_fell_back=true`
3. Focused untouched-scope check over the exact range — exit 0:
   - `rag_ts_changed=false`
   - `rag_ts_lines=4362`
   - `document_or_ingestion_changed_count=0`

An initial version of the static probe used two incorrect local paths and exited 1; its affected detail-route/type results were discarded. The paths were resolved with `rg --files`, the probe was corrected once, and only the corrected results above are evidence.

No network, provider, Supabase/database/Storage access, migration application, embedding, enqueueing, reindexing, activation, rollback, deployment, document processing, live action, commit, push, or PR action occurred.

