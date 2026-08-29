# P06 repositoryContent Task 3 review 8

## Findings

### 1. HIGH — A delayed derivation response still commits an immutable gate set that the final verification RPC cannot consume or recover

Evidence:

- `derive_site_content_release_gate_artifacts` captures its database clock, validates all owner evidence, and commits the immutable three-row set before returning that clock (`supabase/migrations/20260824130000_add_site_content_release_and_outbox.sql:208-304`). The route then performs a separate read and only afterwards creates and sends the verification mutation (`src/app/api/admin/site-content/publish/route.ts:116-143,191-192`).
- The route uses the returned derivation clock not only to verify the artifacts but also as the new recovery-validation binding's `validatedAt` (`route.ts:125,133,135-138`; `src/lib/site-content/site-content-recovery-authority.ts:110-131`). The final SQL authority rejects that binding once its timestamp is more than five minutes behind the final RPC transaction clock (`migration:127-145,825-865`).
- After a delay beyond five minutes, a retry cannot recover the candidate: existing-row derivation compares the stored public observation with a new database clock and rejects it as stale before returning (`migration:211-219`). The rows are immutable and there is no supported delete/replace path, so a newly signed retry cannot clear or supersede the stranded set.
- The new test explicitly advances the application clock by ten minutes between derivation and completion, but its RPC mock returns success for every non-read/non-derive RPC without executing the SQL binding-age check (`tests/site-content-publication-route.test.ts:91-101,363-401`). It therefore proves only that TypeScript artifact verification uses the returned clock, not that the real final mutation can consume the resulting binding.

Trigger: let the derive RPC commit and return after a process suspension, proxy delay, or response/read delay longer than five minutes. The route constructs a binding dated at the old derivation clock; `verify_site_content_candidate_release` rejects it. A retry then rejects the stored public artifact as older than five minutes.

Expected behavior: no transport/response delay between database-owned derivation and final verification can strand immutable candidate state. Either derivation and verification must be one transaction, or immutable evidence must remain safely consumable/recoverable after response loss while freshness is enforced at the correct authority boundary.

Smallest fix/proof: make derive, artifact verification, binding consumption, and candidate verification one database transaction, or separate the artifact verification clock from a fresh final-binding clock and provide an authenticated idempotent recovery path for committed artifacts. Add a SQL-faithful test in which more than five minutes elapse after derivation: the first final mutation and a subsequent retry must not leave an unrecoverable candidate.

### 2. MEDIUM — The database and TypeScript do not share the claimed exact millisecond five-minute edge

Evidence:

- SQL captures `clock_timestamp()` at native PostgreSQL sub-millisecond precision and uses that value directly for the inclusive owner-receipt bounds (`migration:180,208`). It only later formats the returned `verificationNow` with `to_char(..., '...SS.MS...')`, which emits millisecond precision (`migration:209-210`).
- TypeScript parses the returned millisecond string and applies its boundary to that truncated millisecond value (`src/lib/site-content/site-content-release-evidence.ts:121-148`). Therefore, when the database clock contains a fractional millisecond, a receipt exactly five minutes behind returned `verificationNow` is slightly more than five minutes behind SQL's actual comparison clock and can be rejected by SQL even though TypeScript accepts it.
- The new exact-edge test exercises only the TypeScript verifier. The SQL test asserts source patterns for `<` and `>` but never proves the runtime clock precision/normalization contract (`tests/site-content-release-gate-derivation-temporal-authority.test.ts:12-30`; `tests/site-content-release-gate-verifiers.test.ts:163-188`).

Expected behavior: the exact edge represented to and consumed by TypeScript is the exact same instant SQL used: the boundary is accepted, one millisecond older is rejected, and one millisecond future is rejected.

Smallest fix/proof: normalize the database verification clock to millisecond precision before every comparison, public-artifact timestamp, and returned value. Add a SQL-faithful boundary test with a non-zero microsecond component proving exact-edge acceptance and one-millisecond stale/future rejection.

## Attempt 7 finding disposition

1. **SQL-accepted immutable set rejected by the post-derivation verifier:** **CLOSED for ordinary and invalid-input chronology/freshness paths; REOPENED for delayed-response recovery by Finding 1.** One database clock now rejects future/stale owner receipts, validates recovery → governance → must-pass → public chronology before the first insert, returns its clock to the route, and exactly revalidates an existing set (`migration:165-305`; route lines `116-143`). Malformed timestamps/MACs fail closed, all validation precedes the multi-row insert, and an exception rolls the statement back. A corrected newly signed retry after invalid input can start from zero rows. The separate-RPC delay can still strand a set after a valid insert.
2. **Exact edge semantics:** **REOPENED by Finding 2.** SQL and TypeScript use the same strict `<`/`>` inclusivity and five-minute duration, but not the same clock precision.

## Preserved prior disposition

- All attempt-6 and earlier findings remain **CLOSED / unchanged**: fixed-purpose Vault custody/provision/rotation and cross-purpose distinctness; exact governance and programme-owner provenance; exact versioned policy and GO decision digests; administrator bearer propagation; no generic or parallel mutation authority; transactionally consumed binding UUID replay fencing; exact P03/P05 parser, recovery, activation, and rollback reuse; plan/operation/target/digest/count/resume binding; pending anti-join; one public logical identity and legacy disposition; active-release-only readers and seven-route current/updating/unavailable parity; atomic publication/epoch/outbox; changed-only staging and exact embedding-byte reuse; tombstones; lease/row/generation/attempt/retry/quarantine/heartbeat fencing; fixed search paths and direct-table revocation; content-free errors/logs; no inline provider call; and no partial activation.
- The attempt-8 generated type additions match the helper's new `p_verification_now` argument and the derive/read RPC JSON contracts (`src/lib/supabase/database.types.ts:2652-2689`). No canonical plan, spec, manifest, matrix, or accepted P03/P05 authority changed in commit 8.

## Verdicts

SPEC_VERDICT: FAIL

Attempt 8 closes the original future-receipt, trailing-edge, chronology-before-insert, and normal first-attempt clock split. It does not make the multi-RPC verification path recoverable after a sufficiently delayed committed derivation, and it does not implement the requested exact shared millisecond edge.

QUALITY_VERDICT: FAIL

The focused tests are green and the correction is directionally sound, but the response-delay test replaces the SQL authority with a permissive mock and the edge test checks SQL text rather than timestamp precision. Those omissions conceal the unrecoverable delay path and the SQL/TypeScript boundary mismatch.

## Positive controls observed

- A single database-owned derivation clock now controls owner receipt freshness, public observation, chronology, existing-row freshness, and the clock returned to the route.
- Future, malformed, null, wrong-owner, wrong-subject, wrong-purpose-secret, and malformed/wrong MAC owner receipts fail before insertion. Recovery/governance/must-pass/public chronology is checked before artifacts are built or inserted.
- The three artifact rows are inserted by one statement after all source validation; partial insert failure rolls back the function transaction. Existing rows must be complete, fresh, internally consistent, and byte-equal to the newly derived set.
- Route and generated types consume the new derivation result without caller-supplied clock authority. The eighth commit does not add document processing, provider access, or live transport.

## Immutable scope and package verification

- Original base: `1788f3d95c88b4df65d3e13ddc6e5a7b186e8a07`
- Attempt-8 head: `0ec478c0791a4c81fc36236126d8a00b97d0b150`
- Base is an ancestor of head; the full range contains exactly eight commits: `10aeecc135c286fadc09e45cb2e04f43bcaefbff`, `00ec54523d7d6896d06ea6b56a622b95dcf4f46d`, `3c91ff9d6927a9df7947e10f165b6193a865212c`, `746c9578ba299e16a59f63e651bafc5d9e7f2fc7`, `1cf43c060544577b8059a9d85b529c36492e85c6`, `c197600a52ee9584f37989a4b36b9bb780d12849`, `908b7edf2af8d8aa151a170405c7e254da71ba6f`, and `0ec478c0791a4c81fc36236126d8a00b97d0b150`.
- Reviewed package: `P06-repository-content-task-3-review-8.diff`
- Required SHA-256: `e28058e43f0faa38ac8a75613c6c4e8134e45a39f602a2739179cfd7ae2340f7`
- Observed SHA-256: `e28058e43f0faa38ac8a75613c6c4e8134e45a39f602a2739179cfd7ae2340f7` — exact match.
- `npm run ledger:lookup -- 0ec478c0791a4c81fc36236126d8a00b97d0b150 --scope "P06 repositoryContent task-3"`: `NOT REVIEWED at this HEAD and scope.` No ledger write was made because this review was authorized to write only this report.
- Repository instructions, canonical SDD execution, original Task 3 brief/plan/specs, programme manifest/matrix, accepted P03/P05 authorities, and reports 1-7 were reviewed across this same reviewer identity. Unchanged accepted evidence was reused.

## Focused offline verification

1. Exact head, ancestry, eight-commit range, package header/SHA-256, and `git diff --check` — PASS.
2. `GATE_RECEIPTS=off node scripts/run-vitest.mjs run tests/site-content-gate-derivation-temporal-authority.test.ts tests/site-content-publication-route.test.ts tests/site-content-release-gate-verifiers.test.ts tests/site-content-gate-types-parity.test.ts` — PASS, 4 files / 18 tests. These prove the corrected TypeScript/source contracts but not the two cross-RPC/runtime-clock findings above.
3. Bounded source/transaction checks confirmed validation and chronology precede the single multi-row insert, exception rollback remains fail-closed, complete existing rows are exactly revalidated, generated types align, and the prior closed synchronization/reader/lease authorities are unchanged.

No network, provider, Supabase/database/Storage access, migration application, embedding, enqueueing, reindexing, activation, rollback, deployment, document/corpus processing, commit, push, or PR action occurred. The report is left untracked and unstaged.
