# P05 phase review 5

## Findings

### 1. P1 — worker overlap is bounded in raw characters rather than the normalized matching domain

`protectedPublicSourceChunkPage` concatenates raw chunk text and retains only its last 256 raw characters (`supabase/functions/indexing-v3-agent/behavior.ts:82-92`). The protected matcher subsequently decodes entities, applies NFKC, removes non-alphanumerics, and compacts whitespace (`supabase/functions/_shared/public-source-policy.ts:56-74`). More than 256 raw characters can therefore contribute zero significant matching characters and evict the protected prefix from the page carry.

An exact offline production probe used rows 499 = `Health`, 500 = 300 periods, and 501 = `direct`. The middle row is valid under the schema's only content constraint (`length(btrim(content)) > 0`; `supabase/schema.sql:471-475`). Scanning all three rows together returned `true`, but the real paged owner returned:

```json
{ "whole": true, "page1": false, "carryLength": 256, "carryHasHealth": false, "page2": false, "scan": false }
```

The actual worker uses this paged scanner (`supabase/functions/indexing-v3-agent/index.ts:1795-1815`), so its independent protected-source backstop still differs from the complete shared matcher. The upstream acquisition scan detects this input, but Task 2 explicitly requires a worker recheck rather than relying solely on acquisition.

Expected correction: retain overlap in the canonical normalized/significant-character domain, or keep equivalent streaming matcher state sufficient for the longest protected identity, and add this exact 499/500/501 regression. A fixed raw-character window cannot prove parity when normalization removes an unbounded raw separator sequence.

## Verdicts

SPEC_VERDICT: FAIL

QUALITY_VERDICT: FAIL

Named, numeric, and legacy HTML character-reference decoding is now standards-complete for this boundary, and npm/Deno runtime integration passes. P05 still fails because the real worker can lose a protected prefix across a valid normalized-stream page boundary.

## Attempt-4 finding disposition

| Attempt-4 finding                                                                          | Attempt-5 disposition | Evidence                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------ | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Valid named character references encoding letters bypassed acquisition and worker matching | **CLOSED**            | The shared owner now imports `decodeHTML` from `entities`, safely handles numeric invalid/control scalars, then performs standards-compatible named and legacy decoding before NFKC/compact matching (`supabase/functions/_shared/public-source-policy.ts:1-74`). Exact `&afr;`, `&ifr;`, `&tscr;`, `&dd;`, and `&DifferentialD;` cases now match through acquisition and worker helpers. |

## Attempt-3 finding disposition

| Attempt-3 finding                                                 | Attempt-5 disposition | Evidence                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Numeric character references encoding letters bypassed both gates | **CLOSED**            | Valid decimal/hex values with and without semicolons reconstruct their code points; zero, unsafe controls, surrogates, and out-of-range values conservatively become boundaries (`public-source-policy.ts:11-53`). Acquisition and worker tests cover the shared owner. |

## Attempt-2 finding disposition

| Attempt-2 finding                                                  | Attempt-5 disposition                                | Evidence                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------ | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Three ordinary chunks spanning a 500-row page boundary were missed | **CLOSED narrowly; generalized overlap still fails** | The original rows 499=`Australian`, 500=`Medicines`, 501=`Handbook` now return `true` because their raw concatenation fits the 256-character carry (`behavior.ts:82-109`). Finding 1 proves the same three-row boundary fails when normalization discards more than 256 intervening raw separators. |

## Phase-review-1 finding disposition

| Phase-review-1 finding                                                        | Attempt-5 disposition | Evidence                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Effective event RPC dropped active-indexable allowlist/evidence strictness | **CLOSED**            | Final event authority still pins policy version/digest, the 18 active/indexable keys, bounded reason, and 1–50 unique nonblank evidence references (`supabase/migrations/20260824123000_harden_public_source_lifecycle_authority.sql:54-93`). |
| 2. No first-version activation path                                           | **CLOSED**            | Null-predecessor activation and exact replacement activation remain distinct and complete (`:357-412`).                                                                                                                                       |
| 3. Historical P02 publications without a P05 row remained public              | **CLOSED**            | Exact active eligibility, fail-closed owner recovery, retroactive re-ownership, cache/epoch invalidation, and future constraints remain effective (`:603-724`).                                                                               |
| 4. Source decisions and lifecycle used different locks/current authority      | **CLOSED**            | Canonical per-source locks and latest sequenced activation-event reproving remain effective (`:96-101,137-145,183-192,381-395,515-518,548-552,579-583`).                                                                                      |
| 5. P05 activation bypassed P02 status/artifact/job locks                      | **CLOSED**            | Document/artifact/job locks, active-work rejection, indexed/current/ownership checks, and exact approval/generation/state/acquisition proof remain effective (`:413-469`).                                                                    |
| 6. Cache used a stale request-start lifecycle epoch                           | **CLOSED**            | Local/shared answer/search owners still re-read authority before lookup and after candidate hit, independent of the memoized document stamp; failure bypasses cache (`src/lib/rag/rag-cache.ts:185-210,358-383,475-550,555-581,644-665`).     |
| 7. Actual worker did not use complete shared protected-content semantics      | **FAIL overall**      | Entity decoding and the ordinary three-chunk overlap are closed, but Finding 1 demonstrates that the real paged worker still loses significant normalized state that the whole shared matcher detects.                                        |
| 8. Effective stage/resume dropped full exact identity                         | **CLOSED**            | Complete event/version/document/metadata/owner/URL/version/byte/type/hash/provenance/licence/lifecycle/lineage/digest checks remain effective (`20260824123000_harden_public_source_lifecycle_authority.sql:160-297`).                        |
| 9. Effective transition removed the lifecycle state machine                   | **CLOSED**            | The obsolete overload remains dropped and the explicit allowed-edge/active-exit machine remains effective (`:503-539`).                                                                                                                       |

## Original preflight finding disposition

| Original preflight finding                                       | Attempt-5 disposition | Evidence                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Lifecycle, serving, and cache authority disconnected          | **CLOSED**            | Eligibility, retroactive/future constraints, atomic exits, cache deletion, epochs, and pre/post-hit checks remain connected.                                                                                                                                |
| 2. Replacement activation/lineage non-atomic                     | **CLOSED**            | Canonical lock, one-active index, exact old/new/lineage binding, and old-before-new transaction remain intact.                                                                                                                                              |
| 3. Exact P02 receipt/version binding incomplete                  | **CLOSED**            | Exact approval/source/policy/generation/state/manifest/acquisition binding and P02 safety locks remain enforced. P02 is accepted at `ac634ab358c92e6d943258a532aa5c6a98959e88`, package `2ada405d103719fb8a921bac8b08ca6ca922850c27530185995d647a10dfa7d9`. |
| 4. Unchanged checks trusted stale current input                  | **CLOSED**            | Locked exact active identity/outcome reproving remains effective (`20260824123000_harden_public_source_lifecycle_authority.sql:542-566`).                                                                                                                   |
| 5. Acquisition not exactly resumable                             | **CLOSED**            | Deterministic identities, pre-upload resume, full SQL validation, and immutable acquisition digest remain intact.                                                                                                                                           |
| 6. Protected normalization/encoding/worker parity                | **FAIL overall**      | Standards-complete entity decoding passes, but normalized-domain worker overlap fails under Finding 1.                                                                                                                                                      |
| 7. Event append order time/UUID based                            | **CLOSED**            | Unique monotonic per-catalogue sequence and current-authority ordering remain under the canonical lock.                                                                                                                                                     |
| 8. URL privacy accepted fragments/sensitive query keys           | **CLOSED**            | HTTPS/exact-host validation, fragment rejection, the five-key query allowlist, and value-free diagnostics remain unchanged (`src/lib/public-source-acquisition.ts:177-205`).                                                                                |
| 9. Recovery opaque IDs accepted adjacent/plural sensitive labels | **CLOSED**            | Separator-stripped secret/credential/password/bearer/API-key/signature/signed/token rejection remains unchanged (`src/lib/recovery-readiness-evidence.ts:13-29`).                                                                                           |

## Other requirement assessment

- **HTML entity decoding — PASS.** Full named references, numeric references with/without semicolons, and browser-compatible legacy semicolonless references decode before NFKC. Invalid numeric scalars and unsafe controls fail safely to boundaries. Direct acquisition and worker-helper probes detect the reviewed protected identities.
- **Dependency/runtime compatibility — PASS.** `entities@8.0.0` is a direct production dependency in `package.json`/`package-lock.json`, present in the Deno workspace lock, ESM, BSD-2-Clause, and compatible with the repository's Node 24 floor. `npm ls entities --depth=0` resolves exactly 8.0.0. Frozen/manual Deno checking and runtime evaluation of the shared policy and worker-helper path pass without network access.
- **Controlled acquisition — FAIL only for Finding 1's worker backstop.** Catalogue/exact URL, SSRF/DNS/IP/TLS/hostname/redirect, byte/type/signature/structure, exact hash/provenance, sanitization, deterministic stage/resume, enqueue, withdrawal review, and privacy diagnostics remain intact. Whole acquisition matching detects the adversarial input.
- **Activation, withdrawal, replacement, cache, recovery receipts, and P02/P04 interaction — PASS.** The attempt-5 dependency/helper change does not alter the effective lifecycle SQL, cache owners, receipt types, P02 safety binding, P04 audit/reindex owners, or legacy destructive commit path.
- **Security/ACL/privacy — PASS outside Finding 1.** Fixed search paths, service-role-only mutation entry points, PUBLIC revocation, opaque diagnostics, and recovery minimization remain intact.
- **No authority widening — PASS.** No provider/live/destructive/document-generation owner was added or exercised.

## Immutable review identity

- Phase: `P05` — Tasks 2 and 3 of `docs/superpowers/rag-upgrade/local/plans/2026-08-20-rag-ingestion-reindex.md`
- Base: `0d5bb6a5012bd762bb53790ac24de16c7e3078c8`
- Head: `14f921e831c9b4aa8df9c0b6a2f45cd4706b311a`
- Merge base: `0d5bb6a5012bd762bb53790ac24de16c7e3078c8`
- Canonical package: `docs/superpowers/rag-upgrade/execution-artifacts/rag-answer-quality-and-repository-coverage-v1/P05/P05-phase-review-5.diff`
- Canonical package SHA-256: `827cdc62b12665d4f1d8428d8ead2f54eccbaa3688cff4cd4a62b041df6a207a`
- Package header range: `0d5bb6a5012bd762bb53790ac24de16c7e3078c8..14f921e831c9b4aa8df9c0b6a2f45cd4706b311a`; thirteen listed commits; 8,787 lines
- Final implementer report SHA-256: `8ccf6b57cc3fd3bd74d9b3990fe34dcc729dcc3772ec488b49d0ee209afaa312`
- Prior phase-review-4 report SHA-256: `78dfc6931ac4d10772ec79ad3fefe1887e139db756611dccad7a6e96a31bcade`
- Accepted predecessor package SHA-256: `2ada405d103719fb8a921bac8b08ca6ca922850c27530185995d647a10dfa7d9`

## Commands and evidence

- Immutable Git/hash/header checks — exact identities above; `git diff --check` passed and the full range is 32 files, 7,808 insertions, 13 deletions.
- `npm run ledger:lookup -- 14f921e831c9b4aa8df9c0b6a2f45cd4706b311a --scope "P05 phase review-5"` — `NOT REVIEWED at this HEAD and scope`; no ledger write.
- Node production matcher and installed-decoder probes — named, numeric, and legacy cases match; the normalized-domain page case produces the failing JSON in Finding 1 while its whole scan returns `true`.
- `deno check --node-modules-dir=manual --frozen --lock=deno.lock supabase/functions/_shared/public-source-policy.ts` — PASS offline.
- Frozen/manual Deno runtime evaluation through `protectedPublicSourceChunkContents` and `scanProtectedPublicSourceChunkPages` — entity cases and the ordinary 499/500/501 overlap returned `true`; dependency resolution succeeded.
- `npm ls entities --depth=0` — PASS, direct `entities@8.0.0`.
- `GATE_RECEIPTS=refresh node scripts/run-vitest.mjs run tests/public-source-activation-manifest.test.ts tests/public-source-acquisition.test.ts tests/public-source-serving-lifecycle.test.ts tests/indexing-v3-agent.test.ts tests/ingestion-enqueue.test.ts tests/rag-cache-invalidation.test.ts tests/rag-cache-utils.test.ts tests/retrieval-owner-filter-guard.test.ts tests/retrieval-rpc-rollout.test.ts tests/function-grants.test.ts tests/supabase-schema.test.ts` — fresh PASS, 11 files and 183 tests; the normalized-domain overlap case is absent.
- `GATE_RECEIPTS=refresh node scripts/run-vitest.mjs run tests/recovery-readiness-evidence.test.ts tests/reindex-pipeline.test.ts` — fresh PASS, 2 files and 62 tests.
- `GATE_RECEIPTS=refresh npm run typecheck` — fresh PASS.
- `npm run check:migration-role`, `npm run check:function-grants`, and `npm run check:maintainability-budgets` — PASS; immutable history unchanged, 34 definers closed to PUBLIC, worker 1,993/2,191.
- A fresh independent adversarial reviewer independently confirmed the normalized-domain carry blocker after initially passing the named/numeric/runtime correction.

## No-live / no-document statement

This review used repository source, migration text, accepted receipts/reports, installed offline dependency behavior, static searches, and synthetic offline tests/probes only. No provider or network call, Supabase/database/Storage access, migration application or live status read, recovery/PITR/restore operation, source fetch, document/PDF/corpus read, parsing, OCR, upload, embedding, enqueue, worker execution, reindex, activation, rollback, cleanup, deployment, push, or PR was run. No documents were processed. No product, test, plan, receipt, or predecessor artifact was edited. This report is the only write and remains untracked and unstaged.
