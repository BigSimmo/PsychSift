# P06 repositoryContent Task 3 review 4

## Findings

### 1. CRITICAL — Release verification is still caller-authored self-attestation, not independent public-visibility/governance/must-pass evidence

Evidence:

- `createSiteContentReleaseVerificationEvidence` accepts `observedLogicalIds`, `reviewEvidenceDigest`, `caseSetDigest`, `caseResults`, and all three timestamps directly from its caller, then hashes those values itself (`src/lib/site-content/site-content-release-evidence.ts:48-54,92-120`). No verifier observes the public reader, consumes a governance review owner, or executes the must-pass case set.
- The assertion proves only internal digest/plan-population consistency. It requires any SHA-256-shaped review/case-set digest, any non-empty list of caller-labelled `passed` cases, and merely parseable timestamps; it has no expected canonical case-set identity, provenance/signature, current-time/freshness bound, or connection to actual check outputs (`src/lib/site-content/site-content-release-evidence.ts:129-181`). A future or stale `checkedAt` is accepted because `assertTimestamp` only calls `Date.parse` (`src/lib/site-content/site-content-release-evidence.ts:65-67`).
- The bounded consumer search found no production evidence producer at all. `createSiteContentReleaseVerificationEvidence` is called only by tests; production code only asserts and signs the supplied structure. The administrator route accepts `verificationEvidence` from the request and passes it to the signer (`src/app/api/admin/site-content/publish/route.ts:81-95`).
- The tests manufacture arbitrary fixture digests and a `passed` result, then call the same constructor/assertion that is under test (`tests/site-content-release-evidence.test.ts:52-65,73-95,102-140`; `tests/site-content-transaction-authority.test.ts:38-55`). Calling these artifacts “independent” does not make them independent.
- SQL checks the HMAC and nested digest consistency, then sets all four verification flags true (`supabase/migrations/20260824130000_add_site_content_release_and_outbox.sql:552-581`). The Vault-backed HMAC proves the application signed the caller-authored claims; it does not prove the claims came from the required checks.
- The binding plan requires activation only after counts, hashes, public visibility, administrator publication evidence, governance, and must-pass retrieval checks agree (`docs/superpowers/rag-upgrade/local/plans/2026-08-21-rag-repository-content-sync.md:344-350`).

Trigger: construct verification evidence using the exact plan logical IDs, an arbitrary SHA-256-shaped governance digest, an arbitrary case-set digest, a made-up case labelled `passed`, and any parseable timestamps. The application accepts and signs it, and SQL marks the release verified. Expected behavior is evidence derived by strict independent owners from actual public reads, governance records, and the canonical must-pass run; actual behavior is digest-wrapped administrator assertion.

Smallest fix/proof: make the server obtain or verify immutable receipts from the canonical public-visibility, governance, and must-pass owners rather than accepting their conclusions from the request. Bind a fixed reviewed case-set identity, exact observed output digests/counts, provenance, and freshness to the plan subject. An adversarial test must show an administrator cannot mint a valid receipt by choosing arbitrary digests, `passed` results, or future/stale times.

### 2. HIGH — The built-in CLI transport authenticates the route but cannot authenticate its mutation RPCs

Evidence:

- The new CLI transport sends only an `Authorization: Bearer ...` header (`scripts/sync-site-content-corpus.ts:60-75,218-221`). This is the advertised executable transport for `adopt`, `begin`, `resume`, `publish`, `verify`, and `activate` (`scripts/sync-site-content-corpus.ts:25,222-243`).
- The route validates that bearer with `requireAuthenticatedUser(request, adminSupabase, { administrator: true })`, but then discards the authenticated token/user and creates a separate `createSupabaseServerClient()` for every ordinary mutation RPC (`src/app/api/admin/site-content/publish/route.ts:14-19,99-101,144`).
- `createSupabaseServerClient` is explicitly cookie-aware and reads only `cookies()`; it has no request/bearer input (`src/lib/supabase/server.ts:27-45`). A CLI request carries no Supabase session cookie, so the RPC reaches SQL without the administrator JWT. Every mutation function requires non-null `auth.uid()` and the database administrator claim.
- `provision-secret` happens to work because it uses the service-role `adminSupabase.rpc` instead (`src/app/api/admin/site-content/publish/route.ts:25-36`). Thus the operator can provision Vault but cannot use the same transport for the release workflow.
- `tests/site-content-sync-operator.test.ts:18-33` tests only that mocked `fetch` receives a bearer. `tests/site-content-publication-route.test.ts:21-39` replaces both authentication and the cookie client with permissive mocks, so it cannot detect the lost bearer session.

Trigger: invoke the guarded CLI with a valid administrator access token and `--write --action adopt` (or begin/resume/publish/verify/activate). Route authentication succeeds, but the cookie-only RPC client has no user session and SQL raises `administrator required`. Expected behavior is one executable guarded operator transport; actual behavior is provision-only reachability.

Smallest fix/proof: construct the mutation client with the already-validated bearer/session, or expose a server authority that preserves the administrator identity without weakening SQL authorization. Add an offline route test using a bearer-only request and a client mock that asserts the exact JWT reaches the RPC boundary for every supported action.

### 3. HIGH — The transaction green still executes a parallel in-memory authority rather than the Vault/route/SQL contract

Evidence:

- The retry removes `bindingVerifier: () => true`, which is an improvement, but `tests/site-content-transaction-authority.test.ts:66-78` still injects the JavaScript verifier into `createSiteContentTransactionAuthority` and exercises in-memory `adoptBaseline`, `beginCandidate`, `completeOperation`, `verifyCandidate`, and `activate` (`tests/site-content-transaction-authority.test.ts:104-158`).
- `src/lib/site-content/site-content-transaction-reference.ts:38-226` maintains its own maps, release states, operation completion, partition reader, and activation implementation. The bounded consumer search found it used only by that test; the route, CLI, worker, migration, and production source do not use this authority.
- The model verifies against a plaintext test secret in JavaScript, not the Vault lookup, service-role provision/rotation function, SQL canonical JSON/HMAC function, grants, `auth.uid()`/JWT claim, or actual RPC payload boundary. It therefore stayed green despite Finding 2 and cannot establish deployable app/SQL interoperability.
- The focused 22-test selector passed, demonstrating that the current green suite does not catch Findings 1-2.

Smallest fix/proof: retain pure unit tests where useful, but make the acceptance path exercise one faithful offline boundary using the real route payloads, authenticated client propagation, Vault-compatible signer/verifier behavior, and migration SQL (or a repository-standard SQL harness). The success test must not substitute a second transition authority for the functions being accepted.

### 4. MEDIUM — Validation bindings remain reusable throughout their five-minute window

Evidence:

- `SiteContentRecoveryValidationBinding` has no nonce, binding ID, or consumption identity (`src/lib/site-content/site-content-recovery-authority.ts:21-29`). Both JavaScript and SQL validate purpose/project/recovery/payload/MAC plus a symmetric five-minute timestamp window, but neither records or rejects a previously accepted binding (`src/lib/site-content/site-content-recovery-authority.ts:164-194`; migration lines 106-124).
- The boundary test covers wrong secret, purpose, project, payload, time, and MAC, but does not replay the same valid binding (`tests/site-content-recovery-authority.test.ts:58-93`). Calling the verifier twice with the same inputs returns true twice.
- Release-state preconditions make adoption/activation/rollback replays terminal and begin/verify are largely idempotent, so the present impact is bounded. Nevertheless the explicitly required replay-rejection property is absent from the authority itself.

Smallest fix/proof: give non-idempotent validation bindings a unique identity and consume it transactionally with the authorized transition; explicitly define which resume/idempotent calls may reuse a plan identity. Add same-payload replay tests at the actual SQL transition boundary.

## Prior finding disposition

### Attempt 1 findings

1. **Active-release isolation / partial candidate visibility:** **CLOSED.** Exact active-release projections, pending logical-ID anti-joins, non-null candidate completion, and atomic pointer activation remain present.
2. **Services/forms route-domain mismatch:** **CLOSED.** SQL accepts the four executable domains and all seven collection/detail handlers retain identity-neutral release-state coverage.
3. **Weaker parallel P05 receipt authority:** **CLOSED in source.** Activation/rollback use the accepted P05 parsers and exact receipt/context HMAC binding; no second receipt table remains.
4. **Missing worker entrypoint and stale lease fencing:** **CLOSED.** The bounded handler, periodic heartbeat, row/lease/generation/attempt/expiry fencing, retry, and quarantine corrections remain unchanged.
5. **Durable changed-only/reuse/tombstone/resume path:** **CLOSED in migration/planner source.** Exact operation manifests, verified embedding-byte reuse, tombstones, target/digest/count/generation binding, and partial-activation guards remain present.
6. **Spoofable administrator flag / broad table grants:** **CLOSED.** Administrator claims are database-derived, direct table access remains revoked, and Vault provisioning alone is service-role-executable.
7. **Fail-open reader / missing types / route proof:** **CLOSED.** Exact `42883` fallback, malformed/unrelated-error rejection, generated schema types, and the seven-route `current`/`updating`/`unavailable` identity matrix remain intact.

### Attempts 2-3 findings

1. **Missing exact pending anti-join:** **CLOSED.** The reader still anti-joins exact candidate operation and non-complete outbox logical IDs.
2. **Unreachable bootstrap/verification:** **PARTIALLY CLOSED.** The app/SQL secret split is corrected by service-role-only Vault provision/rotation, but verification remains caller-authored (Finding 1) and the CLI mutation path is unreachable (Finding 2).
3. **Planner/SQL operation/digest mismatch:** **CLOSED.** Canonical plan/release/legacy digests and exact operations are recomputed and persisted at both adoption and candidate begin.
4. **P05 parser/HMAC authority:** **CLOSED for secret custody, purpose/project/payload/expiry and parser reuse; replay remains OPEN.** Vault provisioning/rotation and service-role-only grants are source-correct. Finding 4 records the remaining replay property.
5. **Initial legacy/P03 CLI/adoption/resume:** **PARTIALLY CLOSED.** The literal P03 dry-run now works without `--state`, and action/target/provision interfaces exist; bearer loss prevents every non-provision write action (Finding 2).
6. **Permissive/parallel transaction and seven-route proof:** **PARTIALLY CLOSED.** The permissive verifier was replaced with the real JavaScript signer/verifier and seven-route handler proof remains green. The acceptance flow is still a parallel in-memory authority and misses route/Vault/SQL failures (Finding 3).
7. **Disconnected app/SQL HMAC secrets:** **CLOSED in source.** The signer secret is provisioned/rotated into Vault through an administrator-gated route and a service-role-only fixed-search-path RPC; SQL reads that named Vault secret and responses expose only digests (`src/app/api/admin/site-content/publish/route.ts:25-36`; migration lines 106-153,699-731).
8. **Self-attested adoption/verification gates:** **OPEN.** Boolean flags were replaced with structured digests, but their truth is still chosen by the request caller (Finding 1).
9. **Non-executable CLI workflow:** **OPEN for writes.** Literal dry-run and a transport exist; the transport loses authentication before SQL (Finding 2).
10. **Permissive transaction model:** **PARTIALLY CLOSED.** Signer verification is no longer permissive, but the model remains separate from the deployed authority (Finding 3).

## Verdicts

SPEC_VERDICT: FAIL

The range preserves the corrected release, outbox, fencing, reader, digest, P05, and Vault-secret contracts, but Task 3 still cannot demonstrate independently verified activation gates or execute the guarded CLI release workflow.

QUALITY_VERDICT: FAIL

The focused suite is green, yet it fabricates verification success and mocks away the bearer-to-RPC boundary. The principal end-to-end test still substitutes an in-memory authority for the implementation it is meant to accept.

## Positive controls observed

- The application/SQL secret split is materially corrected: administrator authentication gates the operator route, only the service-role RPC can create/rotate the named Vault secret, rotation binds the predecessor digest and reason, the HMAC verifier reads that Vault entry, and raw secret bytes are not returned.
- HMAC purpose, project, recovery digest, exact payload digest, five-minute expiry, and MAC tampering rejection are implemented in both JavaScript and SQL-compatible source; accepted P05 parsing remains the application authority for activation/rollback.
- The P03 literal source-only dry-run is now executable without an ad-hoc state file, target confirmation is required for writes, and no operator action ran during this review.
- Exact pending anti-join, one active public release, candidate operation/digest/count binding, verified unchanged embedding reuse, deletion tombstones, lease fencing, partial-activation prevention, administrator-only mutation, content-free errors/logs, no inline publication provider call, and seven-route reader identity remain intact from prior accepted evidence.
- The full range changes no document API/processing/ingestion/reindex owner and leaves `src/lib/rag/rag.ts` unchanged.

## Immutable scope and package verification

- Original base: `1788f3d95c88b4df65d3e13ddc6e5a7b186e8a07`
- Retry head: `746c9578ba299e16a59f63e651bafc5d9e7f2fc7`
- Base is an ancestor of head; the full range contains exactly four commits: `10aeecc135c286fadc09e45cb2e04f43bcaefbff`, `00ec54523d7d6896d06ea6b56a622b95dcf4f46d`, `3c91ff9d6927a9df7947e10f165b6193a865212c`, and `746c9578ba299e16a59f63e651bafc5d9e7f2fc7`.
- Reviewed package: `P06-repository-content-task-3-review-4.diff`
- Required SHA-256: `c4e51767bb2a8a872cf70c0d1c94b9a9aa6cd8e54cb02b9907eda7fe86dd3087`
- Observed SHA-256: `c4e51767bb2a8a872cf70c0d1c94b9a9aa6cd8e54cb02b9907eda7fe86dd3087` — exact match.
- `npm run ledger:lookup -- 746c9578ba299e16a59f63e651bafc5d9e7f2fc7 --scope "P06 repositoryContent task-3"`: `NOT REVIEWED at this HEAD and scope.` No ledger write was made because this review may write only this report.
- Repository instructions, canonical SDD execution, original Task 3 brief/plan/specs, programme manifest/matrix, and accepted P03/P05 authorities are unchanged since the prior review; their previously verified evidence was reused. Prior reports 1-3 were re-read for complete disposition.

## Focused offline verification

1. Package SHA-256, package base/head header, ancestry, exact four-commit range, and `git diff --check` — all matched/passed.
2. `node scripts/run-vitest.mjs run tests/site-content-recovery-authority.test.ts tests/site-content-release-evidence.test.ts tests/site-content-sync-operator.test.ts tests/site-content-transaction-authority.test.ts tests/site-content-publication-route.test.ts tests/site-content-route-release-states.test.ts` — PASS, 6 files / 22 tests. This proves the corrected units are green but does not cover Findings 1-3.
3. Bounded source-consumer checks confirmed no production verification-evidence producer, the bearer/cookie client disconnect, the reference model's test-only use, no binding nonce/consumption owner, and zero document/RAG live-owner changes.

No network, provider, Supabase/database/Storage access, migration application, embedding, enqueueing, reindexing, activation, rollback, deployment, document/corpus processing, commit, push, or PR action occurred.
