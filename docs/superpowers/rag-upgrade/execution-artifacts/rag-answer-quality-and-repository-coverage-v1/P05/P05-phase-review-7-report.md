# P05 phase review 7

## Findings

### 1. P1 — malformed entity or markup syntax makes both protected-content gates fail open

The new content-free scanner correctly streams complete named/numeric references, tags, and comments, but it discards input while a lexical construct is merely _potentially_ valid. When `EntityDecoder` consumes a partial invalid named-reference prefix and later returns no entity, `write` emits one boundary but does not replay the already-consumed letters (`supabase/functions/_shared/public-source-policy.ts:105-127`). Similarly, `finish` finalizes an entity and token but does not conservatively handle an unfinished `TagOpen`, `Tag`, quoted-tag, or comment mode (`:140-154,175-238`).

This permits a protected identity to be separated by malformed syntax that the prior complete normalizer treated as punctuation/boundary content. Exact offline cases:

```json
{"value":"Health&direct","identity":null,"eligible":true,"mainText":"Health&direct","worker":false}
{"value":"Health&di!rect","identity":null,"eligible":true,"mainText":"Health&di!rect","worker":false}
{"value":"Health<direct","identity":null,"eligible":true,"mainText":"Health<direct","worker":false}
{"value":"Health<!--direct","identity":null,"eligible":true,"mainText":"Health<!--direct","worker":false}
```

For every case, `forbiddenPublicSourceIdentity` returns null, `evaluateTrustedPageContent(<main>…</main>)` accepts and retains the string, and the real paged worker helper returns false. This is not only a malformed raw-HTML concern: the first two strings survive `decodeHtmlText` into staged plain text and still evade the worker. A reference evaluation using the phase's retained complete decoder plus NFKC/tag/punctuation/compact normalization returns true for these cases.

The new tests cover arbitrarily long _valid_ references, closed tags, and closed comments (`tests/indexing-v3-agent.test.ts:288-361`), but do not cover invalid named-reference rollback or unfinished lexical state at end of input.

Expected correction: make invalid entity parsing lossless for canonical matching, and make end-of-input in every incomplete markup/comment state conservative. Preserve the bounded, primitive-only state contract. Add the exact four acquisition and actual paged-worker regressions, including page splits inside the malformed syntax.

## Verdicts

SPEC_VERDICT: FAIL

QUALITY_VERDICT: FAIL

The attempt-6 arbitrary valid-stream and Deno-entrypoint defects are closed, and all earlier lifecycle, recovery, policy, cache, acquisition-identity, dependency, and authority corrections remain intact. P05 still fails because malformed lexical syntax bypasses both the acquisition gate and the independent real-worker backstop.

## Attempt-6 finding disposition

| Attempt-6 finding                                                                 | Attempt-7 disposition                            | Evidence                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Fixed raw suffix lost arbitrarily split entity/tag syntax and retained content | **CLOSED for valid/closed syntax; new gap FAIL** | One incremental scanner now carries fixed primitive lexical/entity/pattern state with no raw/canonical strings. Long numeric/named references, tags, quotes, comments, removables, and three-page cases pass. Finding 1 shows malformed/unfinished syntax is discarded. |
| 2. Changed actual worker module failed Deno check                                 | **CLOSED**                                       | The stale `@ts-expect-error` is now a narrow same-line `@ts-ignore` (`behavior.ts:1-3`). Offline Deno 2.9.4 checking of the shared policy, behavior module, and actual indexing entrypoint passes with all proxy routes forced to refused loopback.                     |

## Earlier entity/overlap finding disposition

| Earlier finding                                                               | Attempt-7 disposition                          | Evidence                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Attempt 5: removable normalized content evicted the protected prefix          | **CLOSED**                                     | Finite pattern state advances across arbitrary punctuation and zero-width input without carrying raw content.                                                                                                                                  |
| Attempt 4: valid named references encoding letters bypassed both gates        | **CLOSED for valid references**                | The installed WHATWG trie decoder streams complete named and legacy references across writes. Finding 1 concerns invalid-reference rollback.                                                                                                   |
| Attempt 3: numeric references encoding letters bypassed both gates            | **CLOSED**                                     | Decimal/hex references, with/without semicolons and across arbitrary pages, feed decoded scalars to the finite matcher; long leading-zero and three-page cases pass.                                                                           |
| Attempt 2: three ordinary chunks spanning a 500-row page boundary were missed | **CLOSED for valid canonical streams overall** | The actual worker owns one scanner across ordered 500-row pages and finalizes only at end of input (`supabase/functions/indexing-v3-agent/behavior.ts:88-111`; `indexing-v3-agent/index.ts:1800`). Finding 1 is a malformed lexical fail-open. |

## Phase-review-1 finding disposition

| Phase-review-1 finding                                                        | Attempt-7 disposition | Evidence                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Effective event RPC dropped active-indexable allowlist/evidence strictness | **CLOSED**            | Final event authority still pins policy version/digest, the 18 active/indexable keys, bounded reason, and 1–50 unique nonblank evidence references (`supabase/migrations/20260824123000_harden_public_source_lifecycle_authority.sql:54-93`).    |
| 2. No first-version activation path                                           | **CLOSED**            | Null-predecessor first activation and exact replacement activation remain distinct and complete (`:357-412`).                                                                                                                                    |
| 3. Historical P02 publications without a P05 row remained public              | **CLOSED**            | Exact active eligibility, fail-closed owner recovery, retroactive re-ownership, cache/epoch invalidation, and future constraints remain effective (`:603-724`).                                                                                  |
| 4. Source decisions and lifecycle used different locks/current authority      | **CLOSED**            | Canonical per-source locks and latest sequenced activation-event reproving remain effective (`:96-101,137-145,183-192,381-395,515-518,548-552,579-583`).                                                                                         |
| 5. P05 activation bypassed P02 status/artifact/job locks                      | **CLOSED**            | Document/artifact/job locks, active-work rejection, indexed/current/ownership checks, and exact approval/generation/state/acquisition proof remain effective (`:413-469`).                                                                       |
| 6. Cache used a stale request-start lifecycle epoch                           | **CLOSED**            | Local/shared answer/search owners still re-read authority before every lookup and after a candidate hit independently of the memoized document stamp; epoch failure bypasses cache (`src/lib/rag/rag-cache.ts:185-210,358-383,475-581,644-665`). |
| 7. Actual worker did not use complete shared protected-content semantics      | **FAIL overall**      | Acquisition and worker now share one finite streaming matcher and actual Deno entrypoint, but Finding 1 demonstrates a shared malformed-syntax bypass.                                                                                           |
| 8. Effective stage/resume dropped full exact identity                         | **CLOSED**            | Complete event/version/document/metadata/owner/URL/version/byte/type/hash/provenance/licence/lifecycle/lineage/digest checks remain effective (`20260824123000_harden_public_source_lifecycle_authority.sql:160-297`).                           |
| 9. Effective transition removed the lifecycle state machine                   | **CLOSED**            | The obsolete overload remains dropped and the explicit allowed-edge/active-exit machine remains effective (`:503-539`).                                                                                                                          |

## Original preflight finding disposition

| Original preflight finding                                       | Attempt-7 disposition | Evidence                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Lifecycle, serving, and cache authority disconnected          | **CLOSED**            | Eligibility, retroactive/future constraints, atomic exits, cache deletion, epochs, and pre/post-hit checks remain connected.                                                                                                                                |
| 2. Replacement activation/lineage non-atomic                     | **CLOSED**            | Canonical lock, one-active index, exact old/new/lineage binding, and old-before-new transaction remain intact.                                                                                                                                              |
| 3. Exact P02 receipt/version binding incomplete                  | **CLOSED**            | Exact approval/source/policy/generation/state/manifest/acquisition binding and P02 safety locks remain enforced. P02 is accepted at `ac634ab358c92e6d943258a532aa5c6a98959e88`, package `2ada405d103719fb8a921bac8b08ca6ca922850c27530185995d647a10dfa7d9`. |
| 4. Unchanged checks trusted stale current input                  | **CLOSED**            | Locked exact active identity/outcome reproving remains effective (`20260824123000_harden_public_source_lifecycle_authority.sql:542-566`).                                                                                                                   |
| 5. Acquisition not exactly resumable                             | **CLOSED**            | Deterministic identities, pre-upload resume, full SQL validation, and immutable acquisition digest remain intact.                                                                                                                                           |
| 6. Protected normalization/encoding/worker parity                | **FAIL overall**      | The new scanner has acquisition/worker parity, bounded state, complete valid entity decoding, and arbitrary-page continuation, but both gates fail open on malformed syntax under Finding 1.                                                                |
| 7. Event append order time/UUID based                            | **CLOSED**            | Unique monotonic per-catalogue sequence and current-authority ordering remain under the canonical lock.                                                                                                                                                     |
| 8. URL privacy accepted fragments/sensitive query keys           | **CLOSED**            | HTTPS/exact-host validation, fragment rejection, the five-key query allowlist, and value-free diagnostics remain unchanged (`src/lib/public-source-acquisition.ts:177-205`).                                                                                |
| 9. Recovery opaque IDs accepted adjacent/plural sensitive labels | **CLOSED**            | Separator-stripped secret/credential/password/bearer/API-key/signature/signed/token rejection remains unchanged (`src/lib/recovery-readiness-evidence.ts:13-29`).                                                                                           |

## Other requirement assessment

- **Content-free streaming state — PASS.** The scanner handle exposes only methods; its snapshot is a constant-shape set of numbers/booleans for lexical mode, entity progress, finite pattern/token progress, match bits, and completion. No raw, compact, spaced, markup, comment, or entity substring is retained or emitted. Memory stays constant across arbitrarily long valid constructs and removable content.
- **Streaming semantics — FAIL only for Finding 1.** Complete named/numeric/legacy entities, NFKC, zero-width removal, punctuation boundaries, valid/closed tags and comments, arbitrary page boundaries, and end-of-stream acronym finalization pass. Invalid named-reference rollback and unfinished markup/comment finalization fail open.
- **Dependency/npm/Deno compatibility — PASS.** `entities@8.0.0` remains a direct production npm dependency and Deno workspace-lock entry. Installed-lock parity and direct dependency resolution pass. Deno 2.9.4 checks the actual shared policy, worker behavior module, and indexing entrypoint from cache with network routes refused.
- **Controlled acquisition — FAIL only for Finding 1.** Catalogue/exact URL, protected/link-only exclusions, SSRF/DNS/IP/TLS/redirect controls, identity encoding, byte/type/signature/structure bounds, exact digest/provenance, sanitization, deterministic staging/resume/enqueue, withdrawal review, and value-free diagnostics remain intact.
- **Activation, withdrawal, replacement, cache, and lifecycle — PASS.** One canonical lock/current authority, exact first/replacement activation, atomic old-before-new publication, P02 locks, active-indexable enforcement, historical reconciliation, lifecycle state machine, cache deletion/epoch advancement, and pre/post-hit epoch checks remain effective.
- **Recovery readiness/receipts — PASS.** Exact project/resource/operation/recovery-basis/retained-pointer/evidence/digest binding, readiness freshness, deterministic canonical digests, receipt identity, uniqueness, chronology/append order, historical activation replay, and exact rollback restoration remain provider-free and fail closed.
- **P02/P04 interaction — PASS.** P02 publication locks/state/approval remain composed into P05 activation. P04 remains accepted at `8dee5cc34294adfe1eb5b0e8ee267d72aa5fbc11`, shares accepted package hash `2ada405d103719fb8a921bac8b08ca6ca922850c27530185995d647a10dfa7d9`, and its read-only audit/reindex owners are not widened. The legacy destructive commit path remains unchanged and unwired.
- **Security/ACL/privacy — PASS outside Finding 1.** Effective mutators retain fixed search paths, service-role-only grants, PUBLIC revocation, owner checks, bounded evidence, opaque diagnostics, and recovery-reference minimization.
- **No authority widening — PASS.** No provider/live/destructive/document-processing or document-generation authority was added or exercised.

## Immutable review identity

- Phase: `P05` — Tasks 2 and 3 of `docs/superpowers/rag-upgrade/local/plans/2026-08-20-rag-ingestion-reindex.md`
- Base: `0d5bb6a5012bd762bb53790ac24de16c7e3078c8`
- Head: `de7714a5aa0a225f0d986071dbcc5eecf1505c58`
- Merge base: `0d5bb6a5012bd762bb53790ac24de16c7e3078c8`
- Canonical package: `docs/superpowers/rag-upgrade/execution-artifacts/rag-answer-quality-and-repository-coverage-v1/P05/P05-phase-review-7.diff`
- Canonical package SHA-256: `0bd477ee648948d3bcb6b522df3275fef729a5919edb56bf13236f95d74a4f0c`
- Package header range: `0d5bb6a5012bd762bb53790ac24de16c7e3078c8..de7714a5aa0a225f0d986071dbcc5eecf1505c58`; fifteen listed commits; 9,240 lines
- Full immutable range: 32 files, 8,259 insertions, 13 deletions
- Final implementer report SHA-256: `59c1b0072567cf4cc432752b71fd7e1a3dc03565a6d9ae37e7261e5b407d3116`
- Prior phase-review-6 report SHA-256: `c0ab623c08848a14656fe80bceef163b936fe5e4889ba9399a30be90662e5d9e`
- Accepted predecessor package SHA-256: `2ada405d103719fb8a921bac8b08ca6ca922850c27530185995d647a10dfa7d9`

## Commands and evidence

- Immutable Git/hash/header checks — exact identities above; `git diff --check` passed.
- `npm run ledger:lookup -- de7714a5aa0a225f0d986071dbcc5eecf1505c58 --scope "P05 phase review-7"` — `NOT REVIEWED at this HEAD and scope`; no ledger write.
- Direct Node/tsx production probe through `forbiddenPublicSourceIdentity`, `evaluateTrustedPageContent`, and `scanProtectedPublicSourceChunkPages` — all four exact Finding-1 inputs were accepted by acquisition and missed by the paged worker.
- Reference differential probe using the retained complete decoder/NFKC/tag/punctuation/compact semantics — `Health&direct`, `Health&di!rect`, `Health<direct`, and `Health<!--direct` evaluate protected under the prior normalization but clear under the new scanner.
- Deno 2.9.4 `check --no-lock --node-modules-dir=none` over `public-source-policy.ts`, `behavior.ts`, and `index.ts`, with HTTP/HTTPS/ALL proxy routes forced to refused loopback — PASS from installed/cache-resident dependencies, exit 0.
- `GATE_RECEIPTS=refresh node scripts/run-vitest.mjs run tests/public-source-activation-manifest.test.ts tests/public-source-acquisition.test.ts tests/public-source-serving-lifecycle.test.ts tests/indexing-v3-agent.test.ts tests/ingestion-enqueue.test.ts tests/rag-cache-invalidation.test.ts tests/rag-cache-utils.test.ts tests/retrieval-owner-filter-guard.test.ts tests/retrieval-rpc-rollout.test.ts tests/function-grants.test.ts tests/supabase-schema.test.ts` — fresh PASS, 11 files and 188 tests; expected synthetic bad-schema diagnostics were emitted by the passing grant tests. The malformed Finding-1 cases are absent.
- `GATE_RECEIPTS=refresh node scripts/run-vitest.mjs run tests/recovery-readiness-evidence.test.ts tests/reindex-pipeline.test.ts` — fresh PASS, 2 files and 62 tests.
- `GATE_RECEIPTS=refresh npm run typecheck` — fresh PASS.
- `npm run check:migration-role`, `npm run check:function-grants`, `npm run check:maintainability-budgets`, and `npm run check:installed-lock-parity` — PASS; immutable migration history remained valid, all 34 definers were closed to PUBLIC, the worker remained 1,993/2,191 lines, and 755 installed package locations/51,732 files matched the npm lock.
- `npm ls entities --depth=0` — PASS, direct `entities@8.0.0`.

## No-live / no-document statement

This review used repository source, migration text, accepted receipts/reports, installed/cache-resident dependencies, static searches, and synthetic local strings/rows. Network routes were explicitly forced to a refused loopback endpoint for the Deno entrypoint check. No provider or external network call, Supabase/database/Storage access, migration application or live status read, recovery/PITR/restore operation, source fetch, document/PDF/corpus read, parsing, OCR, upload, embedding, enqueue, worker execution, reindex, activation, rollback, cleanup, deployment, push, or PR was run. No documents were processed. No ambiguous-help script was invoked. No product, test, plan, receipt, or accepted predecessor artifact was edited. This report is the only write and remains untracked and unstaged.
