# P06 repositoryContent Task 3 review 3

## Findings

### 1. CRITICAL — The HMAC authority has two unconnected secret sources, so every evidence-bound SQL transition is unreachable

Evidence:

- The administrator route reads and signs with `SITE_CONTENT_RECOVERY_VALIDATION_SECRET` (`src/app/api/admin/site-content/publish/route.ts:21-23,41-50,56-60,65-70`).
- SQL does not receive that secret or the already-authenticated result. `site_content_validation_binding_valid` independently reads `current_setting('app.site_content_validation_secret', true)` and rejects an empty value (`supabase/migrations/20260824130000_add_site_content_release_and_outbox.sql:105-120`).
- The bounded repository search found no setter or configuration for `app.site_content_validation_secret`; its only occurrence is the SQL read at migration line 108. `src/lib/env.ts:24` defines only the application environment value, while `supabase/config.toml:7-8` configures JWT verification for the Edge worker and does not configure the database setting.
- The route invokes each mutation through an ordinary authenticated Supabase RPC (`src/app/api/admin/site-content/publish/route.ts:122-123`); it neither can nor does establish the transaction-local PostgreSQL GUC used by the security-definer verifier.
- Adoption, begin, verification, activation, and rollback all call that verifier (`supabase/migrations/20260824130000_add_site_content_release_and_outbox.sql:135-136,186-187,490-491,529-531,583-585`). With repository-defined configuration, each returns false before the corrected transition can run.

Trigger: configure the application secret and submit any otherwise-valid adoption/begin/verify/activate/rollback request. The application produces a MAC, but PostgreSQL reads an unset, differently named database setting and rejects it. Expected behavior is one deployable server-validation authority; actual behavior leaves first adoption and every later activation/rollback unreachable.

Smallest fix/proof: define one secure, deployable key boundary that the RPC verifier can actually consume without exposing the secret to clients, then execute an offline interoperability fixture through the real signer and SQL verifier. Prove configured success plus missing/wrong key, purpose, project, payload, expiry, and tampering rejection. The binding has no nonce/consumption record, but successful replays are currently idempotent or rejected by release-state transitions; that replay observation is not promoted beyond this authority finding.

### 2. CRITICAL — Adoption and candidate verification authenticate administrator assertions, not the asserted release evidence

Evidence:

- `createSiteContentEvidenceValidationBinding` parses and validates only P05 recovery readiness, then signs the digest of an otherwise arbitrary adoption/begin/verify payload (`src/lib/site-content/site-content-recovery-authority.ts:57-73`). It does not validate static/dynamic/release digests, legacy dispositions, counts, public visibility, governance, or must-pass results.
- The route gives adoption only a project equality check before signing the entire caller-supplied object (`src/app/api/admin/site-content/publish/route.ts:43-51`). SQL checks that four adoption fields merely look like SHA-256 values and that logical IDs are unique (`supabase/migrations/20260824130000_add_site_content_release_and_outbox.sql:135-150`); it never recomputes the plan/release/dynamic/legacy digests or reconciles dispositions against a canonical P03 plan.
- Adoption then records every verification flag as true and makes the release active in the same transaction (`supabase/migrations/20260824130000_add_site_content_release_and_outbox.sql:151-172`), even though no byte/count/hash/public-visibility/governance/must-pass verifier ran.
- Candidate verification similarly accepts four literal client-supplied `true` fields and sets all persisted flags true (`supabase/migrations/20260824130000_add_site_content_release_and_outbox.sql:483-503`). The HMAC proves only that the API route signed those assertions; the route at lines 62-74 performs no gate verification before signing them.
- The binding plan requires activation only after counts, hashes, public visibility, administrator publication evidence, governance, and must-pass retrieval checks agree (`docs/superpowers/rag-upgrade/local/plans/2026-08-21-rag-repository-content-sync.md:344-350`).

Trigger: an administrator submits internally inconsistent but syntactically shaped adoption digests/dispositions, or submits a candidate verification object whose four flags are all true without running the named checks. Once the secret plumbing is fixed, the route will sign it and SQL will mark it verified/active. Expected behavior is digest-bound evidence produced or recomputed by the canonical P03/P05/gate owners; actual behavior permits authenticated self-attestation of the facts that are supposed to prevent a partial or mismatched activation.

Smallest fix/proof: accept only a canonical adoption plan validated by `assertSiteContentSyncPlan` (or an exact P03 adoption authority) and make each verification flag derive from independently validated, digest-bound evidence. Adversarial fixtures must reject recomputed-digest mismatches, omitted/additional records, false legacy dispositions, and forged public-visibility/governance/must-pass claims.

### 3. HIGH — The required P03-backed dry-run/write/adoption workflow is still not executable from its CLI

Evidence:

- The plan's literal provider-free command supplies `--manifest ... --dry-run` (`docs/superpowers/rag-upgrade/local/plans/2026-08-21-rag-repository-content-sync.md:374-383`), but the CLI now requires an additional `--state` file and rejects before reading the manifest when it is absent (`scripts/sync-site-content-corpus.ts:84-94`). No producer for this ad-hoc offline state is defined.
- A process invocation cannot execute `--write`: `runSiteContentSyncCli` defaults `dependencies` to an object without `send`, then rejects every write unless a transport was injected programmatically (`scripts/sync-site-content-corpus.ts:84-103`). The only executable module entrypoint calls it without such a dependency (`scripts/sync-site-content-corpus.ts:111-115`).
- The write driver sends only `begin` followed by changed publications (`scripts/sync-site-content-corpus.ts:47-72`). It has no adoption command and cannot drive the new `adopt_site_content_baseline` authority from an empty installation.
- The test proves only the programmatic injection seam and expects `begin`/`publish` calls (`tests/site-content-sync-cli.test.ts:75-80,115-133`); it does not run the plan's literal CLI, initial adoption, durable resume, verification, or activation path.
- Task 3 requires provider-free initial legacy reconciliation and a dry-run-default, target-confirmed write path (`P06-repository-content-task-3-brief.md:40-42`; plan lines 364-368).

Trigger: run the mandated dry-run command or invoke the CLI with `--write` from the shell; the former fails for missing `--state`, and the latter cannot acquire a transport. Starting from empty authority has no CLI adoption path at all. Expected behavior is an executable P03 manifest/adoption/diff/resume workflow; actual behavior is a library seam demonstrated only by injected unit-test dependencies.

Smallest fix/proof: provide a repository-owned offline state/adoption input producer and a real guarded transport/command for dry-run, adopt, begin, resume, and publication. Run the literal provider-free CLI from empty authority through adoption and a mixed add/change/unchanged/delete plan, with exact target confirmation and no live/provider access.

### 4. HIGH — The transactional green proof remains a permissive parallel model rather than the SQL/API authority

Evidence:

- `tests/site-content-transaction-authority.test.ts` imports `site-content-transaction-reference`, constructs it with `bindingVerifier: () => true`, and passes the same `"synthetic-binding"` to adoption, begin, completion, verification, and activation (`tests/site-content-transaction-authority.test.ts:4,29-40,66-85`). It therefore cannot detect the broken application/SQL key interoperability or self-attested evidence in Findings 1-2.
- The reference is used only by that test: the bounded source search found no application, CLI, worker, or SQL owner importing it. It implements separate in-memory release maps and its own transitions (`src/lib/site-content/site-content-transaction-reference.ts:36-73,76-113,151-211`).
- The new seven-route matrix is genuine executable handler coverage across `current`/`updating`/`unavailable` and three reader identities, but it mocks `readPublicSiteContentPartition` and fabricates the release partition (`tests/site-content-route-release-states.test.ts:18-69,95-135`). It proves HTTP byte parity/status mapping, not that SQL can bootstrap, verify, or activate the partition.
- The SQL-focused test remains source-pattern validation (`tests/site-content-publication-access.test.ts:77-78,158,166`). These checks can stay green while the actual transition path is unreachable.

Smallest fix/proof: replace the permissive reference-model success case with an offline harness that exercises the real signer, route/RPC payload shapes, and migration functions (or a faithful repository-standard SQL execution boundary). Keep the seven-route handler matrix, then feed it partitions produced by that authority for empty/current/updating/failed activation states.

## Prior finding disposition

1. **Pending publication stale exclusion:** **CLOSED in SQL.** The active reader now anti-joins exact candidate operation and non-complete outbox logical IDs while retaining unaffected projections (`supabase/migrations/20260824130000_add_site_content_release_and_outbox.sql:317-343`).
2. **Reachable bootstrap and verification:** **OPEN.** Adoption and verification RPCs now exist, but the secret split makes them unreachable and their evidence checks are self-attested (Findings 1-2).
3. **Planner/SQL operation and digest binding:** **CLOSED for candidate plans.** Begin recomputes plan/release digests, persists exact operations, validates counts, and publish requires the declared changed identity/hash (`supabase/migrations/20260824130000_add_site_content_release_and_outbox.sql:186-269,273-312`). Adoption is still outside this canonical validation (Finding 2).
4. **P05 activation/rollback authority:** **CLOSED in application source, execution blocked.** The route now calls the accepted P05 parsers and binds exact context/payload before the SQL transition (`src/lib/site-content/site-content-recovery-authority.ts:76-121`; route lines 75-117). Purpose/project/payload/time are SQL-bound; release state makes successful binding replay idempotent or terminal. The unconnected verifier secret keeps the real transition unreachable (Finding 1).
5. **Initial legacy/P03 CLI/adoption/resume:** **OPEN.** P03's manifest type and canonical planner are now consumed, but the literal dry-run, shell write, and initial adoption are not executable (Finding 3).
6. **Executable transaction and seven-route proof:** **PARTIALLY CLOSED.** The seven handler routes now execute across all three release states and identities. The synchronization/activation proof is still a parallel permissive model (Finding 4).

## Verdicts

SPEC_VERDICT: FAIL

The retry corrects pending exclusion and candidate operation/digest binding, but its configured authority cannot execute adoption or activation, and the evidence/adoption boundary can certify unverified claims. The required executable initial adoption/dry-run/write path remains absent.

QUALITY_VERDICT: FAIL

The new tests demonstrate useful route behavior and an intended transaction model, but they do not execute the signer/SQL boundary where the remaining critical failures occur.

## Positive controls observed

- Exact pending logical-ID anti-joins, active-release isolation, unchanged verified embedding carry-forward, changed/tombstone operation manifests, non-null candidate completion, and partial-population activation checks are present in the migration.
- Candidate plan/release digests and exact operation identities are recomputed/persisted; changed publication is bound to the planned logical ID/content hash.
- The accepted P05 recovery/activation/rollback parsers are called in application source, and HMAC fields bind purpose, project, recovery digest, payload digest, and a five-minute validation window.
- The seven public collection/detail route handlers are exercised for `current`, `updating`, and `unavailable` responses across anonymous, authenticated, and administrator identities.
- Previously verified least-privilege grants/fixed search paths, administrator-only mutation, canonical lease/row/generation/attempt fencing, heartbeat/retry/quarantine, content-free logs/errors, no inline publication provider call, generated types, and no document/RAG live-action change remain intact.

## Immutable scope and package verification

- Original base: `1788f3d95c88b4df65d3e13ddc6e5a7b186e8a07`
- Retry head: `3c91ff9d6927a9df7947e10f165b6193a865212c`
- Base is an ancestor of head; the range contains exactly three commits (`10aeecc135c286fadc09e45cb2e04f43bcaefbff`, `00ec54523d7d6896d06ea6b56a622b95dcf4f46d`, `3c91ff9d6927a9df7947e10f165b6193a865212c`).
- Reviewed package: `P06-repository-content-task-3-review-3.diff`
- Required SHA-256: `5b1cfd76ede77b2d0c7433f370b9ebee8eb77f19b57632fc8dc9e5ad2d8501fb`
- Observed SHA-256: `5b1cfd76ede77b2d0c7433f370b9ebee8eb77f19b57632fc8dc9e5ad2d8501fb` — exact match.
- `npm run ledger:lookup -- 3c91ff9d6927a9df7947e10f165b6193a865212c --scope "P06 repositoryContent task-3"`: `NOT REVIEWED at this HEAD and scope.` No ledger write was made because this review may write only this report.
- Canonical instructions, Task 3 plan/spec/brief, accepted P03/P05 authorities, and review protocol are unchanged from the prior attempt; previously verified unchanged evidence was reused.

## Focused offline verification

No broad test suite was repeated. The distinct retry checks were limited to:

1. Immutable package SHA-256, package base/head header, ancestry, and exact three-commit range — all matched.
2. Bounded source searches for the application/SQL HMAC secret boundary, adoption/verification evidence transitions, CLI action/transport reachability, and transaction-reference consumers — produced Findings 1-4.
3. Focused inspection of the corrected SQL pending anti-join, plan/operation/digest binding, P05 application boundary, and seven-route release-state test — prior Findings 1, 3, and the HTTP portion of 6 are closed.

No network, provider, Supabase/database/Storage access, migration application, embedding, enqueueing, reindexing, activation, rollback, deployment, document/corpus processing, commit, push, or PR action occurred.
