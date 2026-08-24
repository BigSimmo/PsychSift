# P05 phase review 8

## Findings

### 1. P1 — valid semicolonless named entities still lose speculative excess characters

The correction preserves a literal speculative branch for invalid entity syntax, but it cannot reproduce the `EntityDecoder` result when the decoder recognizes a shorter valid legacy entity after it has already speculatively read characters belonging to a longer alternative. The scanner writes one character at a time and tracks only a cumulative count plus one literal matcher branch (`supabase/functions/_shared/public-source-policy.ts:228-257`). When `write` returns a positive consumed length shorter than the characters already presented, the decoded callback updates the canonical state, but the wrapper has neither buffered text nor a checkpoint/branch from the recognized entity boundary with which to replay the already-read excess. It discards the literal branch because `consumed > 0`.

Exact standards-valid text-mode cases are `Health&ltdirect` and `Health&gtdirect`. The complete `entities` decoder produces `Health<direct` and `Health>direct`; punctuation compaction therefore yields `healthdirect`. The new scanner instead returns:

```json
{"value":"Health&ltdirect","identity":null,"eligibleForIndex":true,"mainText":"Health<direct","worker":false}
{"value":"Health&gtdirect","identity":null,"eligibleForIndex":true,"mainText":"Health>direct","worker":false}
```

Both inputs are accepted by `evaluateTrustedPageContent`, retained as the decoded protected text, and missed again by the real worker with one code point per page. This breaks one-shot/worker parity with the complete standards decoder even though both gates share the same flawed scanner.

The new regressions cover invalid `Health&direct` / `Health&di!rect` and complete named/numeric forms, but do not cover a valid legacy semicolonless entity whose trie has longer alternatives followed immediately by protected suffix letters (`tests/indexing-v3-agent.test.ts:103-113,364-382`; `tests/public-source-acquisition.test.ts:472-491`).

Expected correction: retain bounded finite checkpoints/branches sufficient to commit the decoded entity result at its returned consumed boundary and replay speculative excess characters without storing source text. Add the exact `&lt` and `&gt` cases through the one-shot acquisition/trusted-page gate and real one-character-per-page worker scan, while preserving all malformed and complete-reference cases.

## Verdicts

SPEC_VERDICT: FAIL

QUALITY_VERDICT: FAIL

The attempt-7 invalid-entity and unfinished-markup cases are closed, and arbitrary valid numeric/complete named/tag/comment streaming, content-free bounded state, Deno compatibility, and all lifecycle/recovery/authority corrections remain intact. P05 still fails on standards-valid legacy semicolonless entity alternatives.

## Attempt-7 finding disposition

| Attempt-7 finding                                                           | Attempt-8 disposition                             | Evidence                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Invalid entity prefixes and unfinished markup/comments made both gates open | **CLOSED for reported cases; adjacent gap FAILS** | Literal entity/markup speculative matcher branches now preserve `Health&direct`, `Health&di!rect`, `Health<direct`, `Health<!--direct`, and `< ` variants across one-character pages and end-of-input. Finding 1 is a valid semicolonless entity checkpoint gap. |

## Earlier entity/overlap finding disposition

| Earlier finding                                                                 | Attempt-8 disposition                        | Evidence                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Attempt 6: fixed raw suffix lost arbitrarily split lexical syntax/state content | **CLOSED**                                   | Three fixed primitive-only matcher states now handle unbounded valid lexical and malformed literal branches without retaining raw/canonical text.                                                                                               |
| Attempt 5: removable normalized content evicted the protected prefix            | **CLOSED**                                   | Finite pattern state advances across arbitrary punctuation and zero-width input without carrying raw content.                                                                                                                                   |
| Attempt 4: valid named references encoding letters bypassed both gates          | **FAIL overall**                             | Complete named references and tested legacy forms pass, but Finding 1 proves standards-valid semicolonless `&lt`/`&gt` alternatives lose following excess characters.                                                                           |
| Attempt 3: numeric references encoding letters bypassed both gates              | **CLOSED**                                   | Decimal/hex references, with/without semicolons and across arbitrary pages, feed decoded scalars to the finite matcher; long leading-zero and three-page cases pass.                                                                            |
| Attempt 2: three ordinary chunks spanning a 500-row page boundary were missed   | **CLOSED for represented canonical streams** | The actual worker owns one scanner across ordered 500-row pages and finalizes only at end of input (`supabase/functions/indexing-v3-agent/behavior.ts:88-111`; `indexing-v3-agent/index.ts:1800`). Finding 1 is loss inside entity speculation. |

## Phase-review-1 finding disposition

| Phase-review-1 finding                                                        | Attempt-8 disposition | Evidence                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Effective event RPC dropped active-indexable allowlist/evidence strictness | **CLOSED**            | Final event authority still pins policy version/digest, the 18 active/indexable keys, bounded reason, and 1–50 unique nonblank evidence references (`supabase/migrations/20260824123000_harden_public_source_lifecycle_authority.sql:54-93`).    |
| 2. No first-version activation path                                           | **CLOSED**            | Null-predecessor first activation and exact replacement activation remain distinct and complete (`:357-412`).                                                                                                                                    |
| 3. Historical P02 publications without a P05 row remained public              | **CLOSED**            | Exact active eligibility, fail-closed owner recovery, retroactive re-ownership, cache/epoch invalidation, and future constraints remain effective (`:603-724`).                                                                                  |
| 4. Source decisions and lifecycle used different locks/current authority      | **CLOSED**            | Canonical per-source locks and latest sequenced activation-event reproving remain effective (`:96-101,137-145,183-192,381-395,515-518,548-552,579-583`).                                                                                         |
| 5. P05 activation bypassed P02 status/artifact/job locks                      | **CLOSED**            | Document/artifact/job locks, active-work rejection, indexed/current/ownership checks, and exact approval/generation/state/acquisition proof remain effective (`:413-469`).                                                                       |
| 6. Cache used a stale request-start lifecycle epoch                           | **CLOSED**            | Local/shared answer/search owners still re-read authority before every lookup and after a candidate hit independently of the memoized document stamp; epoch failure bypasses cache (`src/lib/rag/rag-cache.ts:185-210,358-383,475-581,644-665`). |
| 7. Actual worker did not use complete shared protected-content semantics      | **FAIL overall**      | Acquisition and worker share one bounded streaming matcher and pass the actual Deno entrypoint, but Finding 1 demonstrates incomplete standards parity in both gates.                                                                            |
| 8. Effective stage/resume dropped full exact identity                         | **CLOSED**            | Complete event/version/document/metadata/owner/URL/version/byte/type/hash/provenance/licence/lifecycle/lineage/digest checks remain effective (`20260824123000_harden_public_source_lifecycle_authority.sql:160-297`).                           |
| 9. Effective transition removed the lifecycle state machine                   | **CLOSED**            | The obsolete overload remains dropped and the explicit allowed-edge/active-exit machine remains effective (`:503-539`).                                                                                                                          |

## Original preflight finding disposition

| Original preflight finding                                       | Attempt-8 disposition | Evidence                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Lifecycle, serving, and cache authority disconnected          | **CLOSED**            | Eligibility, retroactive/future constraints, atomic exits, cache deletion, epochs, and pre/post-hit checks remain connected.                                                                                                                                |
| 2. Replacement activation/lineage non-atomic                     | **CLOSED**            | Canonical lock, one-active index, exact old/new/lineage binding, and old-before-new transaction remain intact.                                                                                                                                              |
| 3. Exact P02 receipt/version binding incomplete                  | **CLOSED**            | Exact approval/source/policy/generation/state/manifest/acquisition binding and P02 safety locks remain enforced. P02 is accepted at `ac634ab358c92e6d943258a532aa5c6a98959e88`, package `2ada405d103719fb8a921bac8b08ca6ca922850c27530185995d647a10dfa7d9`. |
| 4. Unchanged checks trusted stale current input                  | **CLOSED**            | Locked exact active identity/outcome reproving remains effective (`20260824123000_harden_public_source_lifecycle_authority.sql:542-566`).                                                                                                                   |
| 5. Acquisition not exactly resumable                             | **CLOSED**            | Deterministic identities, pre-upload resume, full SQL validation, and immutable acquisition digest remain intact.                                                                                                                                           |
| 6. Protected normalization/encoding/worker parity                | **FAIL overall**      | The scanner has acquisition/worker implementation parity and bounded content-free state, but both gates fail on the standards-valid inputs in Finding 1.                                                                                                    |
| 7. Event append order time/UUID based                            | **CLOSED**            | Unique monotonic per-catalogue sequence and current-authority ordering remain under the canonical lock.                                                                                                                                                     |
| 8. URL privacy accepted fragments/sensitive query keys           | **CLOSED**            | HTTPS/exact-host validation, fragment rejection, the five-key query allowlist, and value-free diagnostics remain unchanged (`src/lib/public-source-acquisition.ts:177-205`).                                                                                |
| 9. Recovery opaque IDs accepted adjacent/plural sensitive labels | **CLOSED**            | Separator-stripped secret/credential/password/bearer/API-key/signature/signed/token rejection remains unchanged (`src/lib/recovery-readiness-evidence.ts:13-29`).                                                                                           |

## Other requirement assessment

- **Content-free/bounded streaming state — PASS.** Canonical, entity-speculative, and markup-speculative matcher states contain only fixed numeric/boolean lexical, prefix, token, match, and completion data. The public handle exposes methods only; no input substring, raw/canonical suffix, growing collection, diagnostic content, or persistence is introduced.
- **Streaming/one-shot semantics — FAIL only for Finding 1.** Arbitrary page lengths, complete named/numeric references, long numeric leading zeros, invalid entity literal rollback, valid/closed and unfinished tags/comments, NFKC, punctuation, zero-width removal, acronym finalization, and one-shot/worker use of the same owner pass. Valid legacy entity excess replay does not.
- **Dependency/npm/Deno compatibility — PASS.** `entities@8.0.0` remains a direct production npm dependency and Deno workspace-lock entry. Installed-lock parity and direct dependency resolution pass. Deno 2.9.4 checks the shared policy, worker behavior module, and actual indexing entrypoint from cache with network routes refused.
- **Controlled acquisition — FAIL only for Finding 1.** Catalogue/exact URL, protected/link-only exclusions, SSRF/DNS/IP/TLS/redirect controls, identity encoding, byte/type/signature/structure bounds, exact digest/provenance, sanitization, deterministic staging/resume/enqueue, withdrawal review, and value-free diagnostics remain intact.
- **Activation, withdrawal, replacement, cache, and lifecycle — PASS.** One canonical lock/current authority, exact first/replacement activation, atomic old-before-new publication, P02 locks, active-indexable enforcement, historical reconciliation, lifecycle state machine, cache deletion/epoch advancement, and pre/post-hit epoch checks remain effective.
- **Recovery readiness/receipts — PASS.** Exact project/resource/operation/recovery-basis/retained-pointer/evidence/digest binding, readiness freshness, deterministic canonical digests, receipt identity, uniqueness, chronology/append order, historical activation replay, and exact rollback restoration remain provider-free and fail closed.
- **P02/P04 interaction — PASS.** P02 publication locks/state/approval remain composed into P05 activation. P04 remains accepted at `8dee5cc34294adfe1eb5b0e8ee267d72aa5fbc11`, shares accepted package hash `2ada405d103719fb8a921bac8b08ca6ca922850c27530185995d647a10dfa7d9`, and its read-only audit/reindex owners are not widened. The legacy destructive commit path remains unchanged and unwired.
- **Security/ACL/privacy — PASS outside Finding 1.** Effective mutators retain fixed search paths, service-role-only grants, PUBLIC revocation, owner checks, bounded evidence, opaque diagnostics, and recovery-reference minimization.
- **No authority widening — PASS.** No provider/live/destructive/document-processing or document-generation authority was added or exercised.

## Immutable review identity

- Phase: `P05` — Tasks 2 and 3 of `docs/superpowers/rag-upgrade/local/plans/2026-08-20-rag-ingestion-reindex.md`
- Base: `0d5bb6a5012bd762bb53790ac24de16c7e3078c8`
- Head: `8dcd23422798ac3fb76b03c09f4cf5ff15b6dce2`
- Merge base: `0d5bb6a5012bd762bb53790ac24de16c7e3078c8`
- Canonical package: `docs/superpowers/rag-upgrade/execution-artifacts/rag-answer-quality-and-repository-coverage-v1/P05/P05-phase-review-8.diff`
- Canonical package SHA-256: `e4cf74b2481bf9069a5358010d40977ca4f912bc2ef3a1512e41e89e8de5e74c`
- Package header range: `0d5bb6a5012bd762bb53790ac24de16c7e3078c8..8dcd23422798ac3fb76b03c09f4cf5ff15b6dce2`; sixteen listed commits; 9,390 lines
- Full immutable range: 32 files, 8,408 insertions, 13 deletions
- Final implementer report SHA-256: `000d3c8d7e2236dcad4eb927c13695482398555ff411037c8037275c5089f111`
- Prior phase-review-7 report SHA-256: `024126062d8b47cb510b583a59f37611cec69b62ad47b7ab02b44cec6acc6f2b`
- Accepted predecessor package SHA-256: `2ada405d103719fb8a921bac8b08ca6ca922850c27530185995d647a10dfa7d9`

## Commands and evidence

- Immutable Git/hash/header checks — exact identities above; `git diff --check` passed.
- `npm run ledger:lookup -- 8dcd23422798ac3fb76b03c09f4cf5ff15b6dce2 --scope "P05 phase review-8"` — `NOT REVIEWED at this HEAD and scope`; no ledger write.
- Direct Node/tsx production probe through `forbiddenPublicSourceIdentity`, `evaluateTrustedPageContent`, and `scanProtectedPublicSourceChunkPages`, using one code point per page — both exact Finding-1 inputs were accepted by acquisition and missed by the real paged worker.
- Direct complete-decoder differential probe — `replaceHtmlCharacterReferencesWithBoundaries` produced `Health<direct` and `Health>direct`, whose NFKC/punctuation/compact forms are `healthdirect`, while the streaming scanner returned null.
- Deno 2.9.4 `check --no-lock --node-modules-dir=none` over `public-source-policy.ts`, `behavior.ts`, and `index.ts`, with HTTP/HTTPS/ALL proxy routes forced to refused loopback — PASS from installed/cache-resident dependencies, exit 0.
- `GATE_RECEIPTS=refresh node scripts/run-vitest.mjs run tests/public-source-activation-manifest.test.ts tests/public-source-acquisition.test.ts tests/public-source-serving-lifecycle.test.ts tests/indexing-v3-agent.test.ts tests/ingestion-enqueue.test.ts tests/rag-cache-invalidation.test.ts tests/rag-cache-utils.test.ts tests/retrieval-owner-filter-guard.test.ts tests/retrieval-rpc-rollout.test.ts tests/function-grants.test.ts tests/supabase-schema.test.ts` — fresh PASS, 11 files and 190 tests; expected synthetic bad-schema diagnostics were emitted by the passing grant tests. The Finding-1 valid legacy-excess cases are absent.
- `GATE_RECEIPTS=refresh node scripts/run-vitest.mjs run tests/recovery-readiness-evidence.test.ts tests/reindex-pipeline.test.ts` — fresh PASS, 2 files and 62 tests.
- `GATE_RECEIPTS=refresh npm run typecheck` — fresh PASS.
- `npm run check:migration-role`, `npm run check:function-grants`, `npm run check:maintainability-budgets`, and `npm run check:installed-lock-parity` — PASS; immutable migration history remained valid, all 34 definers were closed to PUBLIC, the worker remained 1,993/2,191 lines, and 755 installed package locations/51,732 files matched the npm lock.
- `npm ls entities --depth=0` — PASS, direct `entities@8.0.0`.

## No-live / no-document statement

This review used repository source, migration text, accepted receipts/reports, installed/cache-resident dependencies, static searches, and synthetic local strings/rows. Network routes were explicitly forced to a refused loopback endpoint for the Deno entrypoint check. No provider or external network call, Supabase/database/Storage access, migration application or live status read, recovery/PITR/restore operation, source fetch, document/PDF/corpus read, parsing, OCR, upload, embedding, enqueue, worker execution, reindex, activation, rollback, cleanup, deployment, push, or PR was run. No documents were processed. No product, test, plan, receipt, or accepted predecessor artifact was edited. This report is the only write and remains untracked and unstaged.
