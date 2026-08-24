# P05 phase review 6

## Findings

### 1. P1 — canonical page state still cannot preserve arbitrarily split lexical syntax

The correction closes the attempt-5 case where an unbounded sequence of removable punctuation or zero-width characters separates already-canonical text. It does not make canonicalization itself streaming. `protectedPublicSourceChunkPage` still reparses only `previousState.rawSuffix + rawPage`, with `rawSuffix` fixed at 256 raw characters (`supabase/functions/indexing-v3-agent/behavior.ts:82-128`). The separately retained 64-character compact/spaced suffixes are computed from each page after that page-local lexical parse, so they cannot repair an HTML construct whose opening syntax was evicted before its closing syntax arrives.

An exact schema-valid offline probe split a decimal character reference over the worker page edge: rows 499=`Health&#`, 500=`0` repeated 300 times, and 501=`100;irect`. The complete shared matcher returns `true` because the valid reference `&#000...0100;` decodes to `d`. The real paged owner returns:

```json
{
  "name": "numeric",
  "whole": true,
  "page1": false,
  "rawLength": 256,
  "rawHasHealth": false,
  "compactSuffix": "health",
  "page2": false,
  "scan": false
}
```

The same structural defect is observable with a long split tag:

```json
{
  "name": "tag",
  "whole": true,
  "page1": false,
  "rawLength": 256,
  "rawHasHealth": false,
  "compactSuffix": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "page2": false,
  "scan": false
}
```

The actual worker invokes this scanner over ordered 500-row pages (`supabase/functions/indexing-v3-agent/index.ts:1800`), so the independent worker backstop still differs from the complete acquisition matcher. The existing split-entity regression uses only `He&af` / `r;lthdirect` and therefore fits inside the raw suffix (`tests/indexing-v3-agent.test.ts:266-278`).

The state is bounded, but it is not content-free: `rawSuffix`, `compactSuffix`, and `spacedSuffix` retain plaintext-derived content, and the probe exposes `compactSuffix: "health"`. The fields are ephemeral and are not emitted or persisted, which limits privacy impact, but does not satisfy the review's explicit content-free-state requirement.

Expected correction: use a bounded incremental canonicalizer/parser state rather than a fixed raw substring. That state must preserve incomplete numeric/named reference and tag syntax across arbitrary page boundaries without retaining source plaintext, then feed bounded protected-pattern automaton state. Add the exact long numeric-reference and long-tag page-edge regressions through `scanProtectedPublicSourceChunkPages`.

### 2. P1 — the changed actual worker module fails Deno type checking

P05 added an explicit-extension import to `behavior.ts` preceded by `@ts-expect-error` (`supabase/functions/indexing-v3-agent/behavior.ts:1-3`). Under the repository's Deno 2.9.4 runtime, explicit `.ts` extensions are valid, so the suppression is unused and Deno rejects the changed worker module:

```text
TS2578 [ERROR]: Unused '@ts-expect-error' directive.
// @ts-expect-error Deno edge imports require explicit TypeScript extensions.
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
```

`deno check --node-modules-dir=manual --no-lock supabase/functions/_shared/public-source-policy.ts supabase/functions/indexing-v3-agent/behavior.ts` exits 1. The implementer report checked only the shared policy module, not the actual worker importer. Node/TypeScript tests passing therefore do not establish Deno worker compatibility.

Expected correction: use a cross-runtime import/suppression form that passes both the repository TypeScript gate and Deno checking, and include the actual worker module (or its function entrypoint) in the offline Deno gate.

## Verdicts

SPEC_VERDICT: FAIL

QUALITY_VERDICT: FAIL

The attempt-5 normalized-separator defect is closed, and all earlier lifecycle, recovery, policy, entity, cache, acquisition, identity, and authority corrections remain intact. P05 still fails because split lexical syntax can bypass the real worker and the changed worker module does not pass Deno checking.

## Attempt-5 finding disposition

| Attempt-5 finding                                                                | Attempt-6 disposition                                      | Evidence                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Raw-character carry loses a protected prefix across removable normalized content | **CLOSED for canonical separators; generalized gap FAILS** | Bounded compact/spaced canonical suffixes now preserve rows 499=`Health`, 500=300 periods, 501=`direct`, and the zero-width variant. Finding 1 proves that lexical constructs split beyond the remaining 256-character raw reparse window still bypass. |

## Attempt-4 finding disposition

| Attempt-4 finding                                                                          | Attempt-6 disposition | Evidence                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------ | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Valid named character references encoding letters bypassed acquisition and worker matching | **CLOSED**            | `decodeHTML` from the direct `entities` dependency still handles the complete named set and browser-compatible legacy forms before canonical matching (`supabase/functions/_shared/public-source-policy.ts:1,63-96`). |

## Attempt-3 finding disposition

| Attempt-3 finding                                                 | Attempt-6 disposition                                 | Evidence                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Numeric character references encoding letters bypassed both gates | **CLOSED for complete inputs; streaming split FAILS** | Complete decimal/hex references with and without semicolons decode to valid scalars, while invalid/control scalars become boundaries (`public-source-policy.ts:11-63`). Finding 1 is a page-streaming failure, not a regression in whole-input decoding. |

## Attempt-2 finding disposition

| Attempt-2 finding                                                  | Attempt-6 disposition                                | Evidence                                                                                                                                                                                                                     |
| ------------------------------------------------------------------ | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Three ordinary chunks spanning a 500-row page boundary were missed | **CLOSED narrowly; generalized overlap still fails** | The ordinary three-chunk case and arbitrary removable-separator case now pass through canonical suffix state (`behavior.ts:107-128`). Finding 1 demonstrates that arbitrary split lexical syntax remains outside that state. |

## Phase-review-1 finding disposition

| Phase-review-1 finding                                                        | Attempt-6 disposition | Evidence                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Effective event RPC dropped active-indexable allowlist/evidence strictness | **CLOSED**            | Final event authority still pins policy version/digest, the 18 active/indexable keys, bounded reason, and 1–50 unique nonblank evidence references (`supabase/migrations/20260824123000_harden_public_source_lifecycle_authority.sql:54-93`).     |
| 2. No first-version activation path                                           | **CLOSED**            | Null-predecessor first activation and exact replacement activation remain distinct and complete (`:357-412`).                                                                                                                                     |
| 3. Historical P02 publications without a P05 row remained public              | **CLOSED**            | Exact active eligibility, fail-closed owner recovery, retroactive re-ownership, cache/epoch invalidation, and future constraints remain effective (`:603-724`).                                                                                   |
| 4. Source decisions and lifecycle used different locks/current authority      | **CLOSED**            | Canonical per-source locks and latest sequenced activation-event reproving remain effective (`:96-101,137-145,183-192,381-395,515-518,548-552,579-583`).                                                                                          |
| 5. P05 activation bypassed P02 status/artifact/job locks                      | **CLOSED**            | Document/artifact/job locks, active-work rejection, indexed/current/ownership checks, and exact approval/generation/state/acquisition proof remain effective (`:413-469`).                                                                        |
| 6. Cache used a stale request-start lifecycle epoch                           | **CLOSED**            | Local/shared answer/search owners still re-read authority before every lookup and after a candidate hit, independently of the memoized document stamp; epoch failure bypasses cache (`src/lib/rag/rag-cache.ts:185-210,358-383,475-581,644-665`). |
| 7. Actual worker did not use complete shared protected-content semantics      | **FAIL overall**      | Whole-input entity standards and canonical separator carry are closed, but Finding 1 demonstrates a real paged-worker mismatch and Finding 2 demonstrates that the actual worker module fails Deno checking.                                      |
| 8. Effective stage/resume dropped full exact identity                         | **CLOSED**            | Complete event/version/document/metadata/owner/URL/version/byte/type/hash/provenance/licence/lifecycle/lineage/digest checks remain effective (`20260824123000_harden_public_source_lifecycle_authority.sql:160-297`).                            |
| 9. Effective transition removed the lifecycle state machine                   | **CLOSED**            | The obsolete overload remains dropped and the explicit allowed-edge/active-exit machine remains effective (`:503-539`).                                                                                                                           |

## Original preflight finding disposition

| Original preflight finding                                       | Attempt-6 disposition | Evidence                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Lifecycle, serving, and cache authority disconnected          | **CLOSED**            | Eligibility, retroactive/future constraints, atomic exits, cache deletion, epochs, and pre/post-hit checks remain connected.                                                                                                                                |
| 2. Replacement activation/lineage non-atomic                     | **CLOSED**            | Canonical lock, one-active index, exact old/new/lineage binding, and old-before-new transaction remain intact.                                                                                                                                              |
| 3. Exact P02 receipt/version binding incomplete                  | **CLOSED**            | Exact approval/source/policy/generation/state/manifest/acquisition binding and P02 safety locks remain enforced. P02 is accepted at `ac634ab358c92e6d943258a532aa5c6a98959e88`, package `2ada405d103719fb8a921bac8b08ca6ca922850c27530185995d647a10dfa7d9`. |
| 4. Unchanged checks trusted stale current input                  | **CLOSED**            | Locked exact active identity/outcome reproving remains effective (`20260824123000_harden_public_source_lifecycle_authority.sql:542-566`).                                                                                                                   |
| 5. Acquisition not exactly resumable                             | **CLOSED**            | Deterministic identities, pre-upload resume, full SQL validation, and immutable acquisition digest remain intact.                                                                                                                                           |
| 6. Protected normalization/encoding/worker parity                | **FAIL overall**      | Whole-input standards-complete entity decoding and canonical separator streaming pass, but split lexical syntax still fails in the real worker under Finding 1.                                                                                             |
| 7. Event append order time/UUID based                            | **CLOSED**            | Unique monotonic per-catalogue sequence and current-authority ordering remain under the canonical lock.                                                                                                                                                     |
| 8. URL privacy accepted fragments/sensitive query keys           | **CLOSED**            | HTTPS/exact-host validation, fragment rejection, the five-key query allowlist, and value-free diagnostics remain unchanged (`src/lib/public-source-acquisition.ts:177-205`).                                                                                |
| 9. Recovery opaque IDs accepted adjacent/plural sensitive labels | **CLOSED**            | Separator-stripped secret/credential/password/bearer/API-key/signature/signed/token rejection remains unchanged (`src/lib/recovery-readiness-evidence.ts:13-29`).                                                                                           |

## Other requirement assessment

- **Canonical streaming state — FAIL.** State is bounded (256 raw characters, 64 compact characters, 64 spaced characters, and one boundary bit) and is neither persisted nor logged. It is content-bearing, and it cannot represent arbitrarily split numeric/named-reference or tag syntax. Finding 1 is the exact failure.
- **HTML entity decoding — PASS for complete lexical input.** Full named references, valid decimal/hex numeric references with and without semicolons, browser-compatible legacy semicolonless references, invalid scalar handling, NFKC, tags, punctuation, whitespace, and zero-width normalization remain correct for complete input. The defect is loss of incomplete lexical state across page edges.
- **Dependency/npm/Deno compatibility — FAIL for the actual worker.** `entities@8.0.0` is a direct production dependency in npm and the Deno workspace lock; installed-lock parity and `npm ls entities --depth=0` pass. The shared policy resolves, but the actual worker module fails Deno check under Deno 2.9.4 (Finding 2). The full frozen workspace lock also has unrelated pre-existing dependency-version drift; the P05 range changes only the `entities` manifest/lock entries.
- **Controlled acquisition — FAIL only for the required independent worker backstop.** Catalogue/exact URL, protected/link-only exclusions, SSRF/DNS/IP/TLS/redirect controls, identity encoding, byte/type/signature/structure bounds, exact digest/provenance, sanitization, deterministic staging/resume/enqueue, withdrawal review, and value-free diagnostics remain intact. Whole acquisition matching detects the Finding-1 inputs.
- **Activation, withdrawal, replacement, cache, and lifecycle — PASS.** One canonical lock/current authority, exact first/replacement activation, atomic old-before-new publication, P02 locks, active-indexable enforcement, historical reconciliation, lifecycle state machine, cache deletion/epoch advancement, and pre/post-hit epoch checks remain effective.
- **Recovery readiness/receipts — PASS.** Exact project/resource/operation/recovery-basis/retained-pointer/evidence/digest binding, readiness freshness, deterministic canonical digests, receipt identity, uniqueness, chronology/append order, historical activation replay, and exact rollback restoration remain provider-free and fail closed.
- **P02/P04 interaction — PASS.** P02 publication locks/state/approval remain composed into P05 activation. P04 remains accepted at `8dee5cc34294adfe1eb5b0e8ee267d72aa5fbc11`, shares accepted package hash `2ada405d103719fb8a921bac8b08ca6ca922850c27530185995d647a10dfa7d9`, and its read-only audit/reindex owners are not widened. The legacy destructive commit path remains unchanged and unwired.
- **Security/ACL/privacy — PASS outside Finding 1's content-state criterion.** Effective mutators retain fixed search paths, service-role-only grants, PUBLIC revocation, owner checks, bounded evidence, opaque diagnostics, and recovery-reference minimization.
- **No authority widening — PASS.** No provider/live/destructive/document-processing or document-generation authority was added or exercised.

## Immutable review identity

- Phase: `P05` — Tasks 2 and 3 of `docs/superpowers/rag-upgrade/local/plans/2026-08-20-rag-ingestion-reindex.md`
- Base: `0d5bb6a5012bd762bb53790ac24de16c7e3078c8`
- Head: `2acf4fcd4b26cd533e610abe25ee2b1451ce3b28`
- Merge base: `0d5bb6a5012bd762bb53790ac24de16c7e3078c8`
- Canonical package: `docs/superpowers/rag-upgrade/execution-artifacts/rag-answer-quality-and-repository-coverage-v1/P05/P05-phase-review-6.diff`
- Canonical package SHA-256: `4aadac1b0edd895555d2cf7ded04e82f9235f15317044bb17ba0943aa208f470`
- Package header range: `0d5bb6a5012bd762bb53790ac24de16c7e3078c8..2acf4fcd4b26cd533e610abe25ee2b1451ce3b28`; fourteen listed commits; 8,902 lines
- Full immutable range: 32 files, 7,922 insertions, 13 deletions
- Final implementer report SHA-256: `83782e5a9cf716da8c048134ae7136b7432559be7eab01dc45d996626b5aa592`
- Prior phase-review-5 report SHA-256: `3d398fd1cd8a3695d8347edd899882cdd75935cbfb831fb59a60b8e50d8e289d`
- Accepted predecessor package SHA-256: `2ada405d103719fb8a921bac8b08ca6ca922850c27530185995d647a10dfa7d9`

## Commands and evidence

- Immutable Git/hash/header checks — exact identities above; `git diff --check` passed.
- `npm run ledger:lookup -- 2acf4fcd4b26cd533e610abe25ee2b1451ce3b28 --scope "P05 phase review-6"` — `NOT REVIEWED at this HEAD and scope`; no ledger write.
- Direct Node/tsx production probe through `protectedPublicSourceChunkPage` and `scanProtectedPublicSourceChunkPages` — the exact failing JSON in Finding 1; both complete shared scans returned `true`, both paged scans returned `false`.
- `deno check --node-modules-dir=manual --no-lock supabase/functions/_shared/public-source-policy.ts supabase/functions/indexing-v3-agent/behavior.ts` — FAIL with unused `@ts-expect-error` in the actual worker module (Finding 2). This evidence was obtained from installed local dependencies; no provider was contacted.
- `npm run check:installed-lock-parity` — PASS; 755 package locations and 51,732 files matched the npm lock.
- `npm ls entities --depth=0` — PASS, direct `entities@8.0.0`.
- `GATE_RECEIPTS=refresh node scripts/run-vitest.mjs run tests/public-source-activation-manifest.test.ts tests/public-source-acquisition.test.ts tests/public-source-serving-lifecycle.test.ts tests/indexing-v3-agent.test.ts tests/ingestion-enqueue.test.ts tests/rag-cache-invalidation.test.ts tests/rag-cache-utils.test.ts tests/retrieval-owner-filter-guard.test.ts tests/retrieval-rpc-rollout.test.ts tests/function-grants.test.ts tests/supabase-schema.test.ts` — fresh PASS, 11 files and 186 tests; the Finding-1 long lexical split cases are absent.
- `GATE_RECEIPTS=refresh node scripts/run-vitest.mjs run tests/recovery-readiness-evidence.test.ts tests/reindex-pipeline.test.ts` — fresh PASS, 2 files and 62 tests.
- `GATE_RECEIPTS=refresh npm run typecheck` — fresh PASS.
- `npm run check:migration-role`, `npm run check:function-grants`, and `npm run check:maintainability-budgets` — PASS; immutable migration history remained valid, all 34 definers were closed to PUBLIC, and the worker remained 1,993/2,191 lines.
- A fresh independent adversarial review reproduced the long split numeric-reference and tag failures and confirmed the state fields are bounded but content-bearing. Its later tool turn failed at the orchestration layer; its concrete reproduction was independently rerun by this reviewer.

## No-live / no-document statement

This review used repository source, migration text, accepted receipts/reports, installed dependencies, static searches, and synthetic local tests/probes. No provider, Supabase, database, Storage, migration application, live status read, recovery/PITR/restore operation, source fetch, document/PDF/corpus read, parsing, OCR, upload, embedding, enqueue, worker execution, reindex, activation, rollback, cleanup, deployment, push, or PR operation was run. No documents were processed. No product, test, plan, receipt, or accepted predecessor artifact was edited.

One command intended to inspect the repository edge-check wrapper was mistakenly invoked with `--help`; the wrapper has no help mode and emitted public npm-registry dependency-resolution/download attempts before exiting. It made no tracked repository change and performed no provider, application, database, Storage, source, document, or live operation. That command is excluded from verification evidence. This report is the only intentional write and remains untracked and unstaged.
