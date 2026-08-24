# P05 phase review 3

## Findings

### 1. P1 — numeric character references that encode letters bypass both protected-source gates

`replaceHtmlCharacterReferencesWithBoundaries` consumes every decimal or hexadecimal numeric character reference and emits a space instead of decoding its character value (`supabase/functions/_shared/public-source-policy.ts:85-107`). That output feeds the shared acquisition and worker matcher (`:131-160`), and acquisition also applies it before retaining HTML text (`src/lib/public-source-acquisition.ts:652-664`).

Exact offline probes against the production matcher returned no protected identity for all of these inputs:

- `Health&#100;irect` and `Health&#100irect`
- `Health&#x64;irect` and `Health&#x64irect`
- `Australian Medicines Hand&#98;ook`
- `Therapeutic Guide&#108;ines`

For example, the helper changes `Health&#100;irect` to `Health irect`, although HTML decodes decimal 100 to `d`, producing `Healthdirect`. This also regresses the preceding implementation's semicolon-terminated numeric decoding. The new tests cover numeric whitespace references such as `&#9` and `&#10`, but not numeric references that encode a required identity letter (`tests/indexing-v3-agent.test.ts:74-127`; `tests/public-source-acquisition.test.ts:442-466`).

Because acquisition and the real worker share this matcher, a protected source identity encoded this way can pass both explicit Task 2 policy/licence gates.

Expected correction: decode valid numeric references, with or without a semicolon, to their code point before NFKC/compact matching; map invalid, surrogate, or unsafe control values to a boundary. Add decimal and hexadecimal letter-encoding regressions through both acquisition and the actual worker scan boundary.

## Verdicts

SPEC_VERDICT: FAIL

QUALITY_VERDICT: FAIL

The attempt-2 three-chunk/500-row worker-overlap defect is closed, and the lifecycle, cache, acquisition identity, recovery, and authority contracts remain intact. P05 still fails because the new semicolonless-entity correction introduces the reproducible shared-matcher bypass above.

## Attempt-2 finding disposition

| Attempt-2 finding                                                                      | Attempt-3 disposition | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker overlap missed a protected identity spanning three chunks at a 500-row boundary | **CLOSED**            | `protectedPublicSourceChunkPage` now carries the final 256 characters of the complete concatenated stream, and `scanProtectedPublicSourceChunkPages` owns pagination (`supabase/functions/indexing-v3-agent/behavior.ts:82-109`). The real worker calls that owner with ordered 500-row pages (`supabase/functions/indexing-v3-agent/index.ts:1795-1813`). Exact rows 499=`Australian`, 500=`Medicines`, 501=`Handbook` now produce a carry containing `AustralianMedicines` and return `true` on page two. |

## Phase-review-1 finding disposition

| Phase-review-1 finding                                                        | Attempt-3 disposition | Evidence                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Effective event RPC dropped active-indexable allowlist/evidence strictness | **CLOSED**            | The effective definition pins policy version/digest, the 18 active/indexable keys, bounded reason, and 1–50 unique nonblank evidence references (`supabase/migrations/20260824123000_harden_public_source_lifecycle_authority.sql:54-93`).                                                                |
| 2. No first-version activation path                                           | **CLOSED**            | Null-predecessor activation requires no active row and no supersedes link; replacement requires the exact active predecessor and immutable lineage (`:357-412`).                                                                                                                                          |
| 3. Historical P02 publications without a P05 row remained public              | **CLOSED**            | Exact active-version/approval eligibility, fail-closed prior-owner recovery, historical document/artifact re-ownership, cache deletion, epoch bump, and future document/artifact constraints remain effective (`:603-724`).                                                                               |
| 4. Source decisions and lifecycle used different locks/current authority      | **CLOSED**            | Every source owner uses `public_source:<catalogue>` and activation reproves the latest sequenced E1 event under that lock (`:96-101,137-145,183-192,381-395,515-518,548-552,579-583`).                                                                                                                    |
| 5. P05 activation bypassed P02 status/artifact/job locks                      | **CLOSED**            | The effective activation retains document/pages/images/artifact/job locks, active-work rejection, indexed/current checks, exact ownership, P02 approval/generation/state digest, and acquisition digest checks (`:413-469`).                                                                              |
| 6. Cache used a stale request-start lifecycle epoch                           | **CLOSED**            | Local/shared search/answer getters re-read authority before lookup and after candidate hit; memoized document stamps do not memoize the authority epoch, and epoch failure bypasses cache (`src/lib/rag/rag-cache.ts:185-210,358-383,475-550,555-581,644-665`).                                           |
| 7. Actual worker did not use shared normalized protected-content semantics    | **FAIL overall**      | The actual worker now uses the shared normalized matcher and its complete paged overlap. Finding 1 shows that the shared normalization itself deletes encoded required letters, so actual worker parity remains unsafe for valid numeric HTML references.                                                 |
| 8. Effective stage/resume dropped full exact identity                         | **CLOSED**            | Effective staging still locks latest authority and compares the complete existing/new version, document, metadata, owner, URL/version, byte/type/hash, provenance, licence, lifecycle, supersedes, and acquisition-digest matrix (`20260824123000_harden_public_source_lifecycle_authority.sql:160-297`). |
| 9. Effective transition removed the lifecycle state machine                   | **CLOSED**            | The obsolete overload remains dropped and the explicit allowed-edge machine plus active ineligibility/epoch path remains effective (`:503-539`).                                                                                                                                                          |

## Original preflight finding disposition

| Original preflight finding                                       | Attempt-3 disposition | Evidence                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Lifecycle, serving, and cache authority disconnected          | **CLOSED**            | Exact active eligibility, retroactive/future constraints, atomic exits, cache deletion, lifecycle epoch bumps, and fresh pre/post-hit reads remain connected.                                                                                                                                             |
| 2. Replacement activation/lineage non-atomic                     | **CLOSED**            | The canonical per-source lock, one-active unique index, exact old/new/lineage binding, and old-before-new transactional publication remain unchanged.                                                                                                                                                     |
| 3. Exact P02 receipt/version binding incomplete                  | **CLOSED**            | Exact approval/source/policy/generation/state/manifest/acquisition bindings and the P02 lock/work/ownership safety matrix remain enforced. Accepted P02 is `accepted` at `ac634ab358c92e6d943258a532aa5c6a98959e88` with package hash `2ada405d103719fb8a921bac8b08ca6ca922850c27530185995d647a10dfa7d9`. |
| 4. Unchanged checks trusted stale current input                  | **CLOSED**            | The locked RPC still reproves the exact active ID, catalogue, URL, exact version, hash, and unchanged outcome before bounded audit insertion (`20260824123000_harden_public_source_lifecycle_authority.sql:542-566`).                                                                                     |
| 5. Acquisition not exactly resumable                             | **CLOSED**            | Deterministic storage/document identity, pre-upload resume probe, full SQL identity matrix, and persisted acquisition digest remain intact.                                                                                                                                                               |
| 6. Protected normalization/encoding/worker parity                | **FAIL overall**      | The 500-row overlap is closed and semicolonless whitespace entities pass narrowly, but numeric references encoding letters bypass both acquisition and worker matching under Finding 1.                                                                                                                   |
| 7. Event append order time/UUID based                            | **CLOSED**            | Unique monotonic per-catalogue `source_sequence` and descending-sequence current-authority reads remain effective under the canonical lock.                                                                                                                                                               |
| 8. URL privacy accepted fragments/sensitive query keys           | **CLOSED**            | HTTPS/exact-host checks, fragment rejection, the five-key query allowlist, and value-free diagnostics are unchanged (`src/lib/public-source-acquisition.ts:177-205`).                                                                                                                                     |
| 9. Recovery opaque IDs accepted adjacent/plural sensitive labels | **CLOSED**            | Separator-stripped secret/credential/password/bearer/API-key/signature/signed/token rejection remains unchanged and covered (`src/lib/recovery-readiness-evidence.ts:13-29`).                                                                                                                             |

## Other requirement assessment

- **Controlled acquisition — FAIL only for Finding 1.** Active catalogue, exact operator-supplied URL, SSRF/DNS/global-IP, address-pinned TLS/hostname, redirects, byte/type/signature/structure limits, exact upstream/staged hashes, HTML sanitization, digest-only provenance, deterministic storage/document identity, persisted authority rechecks, idempotent resume, enqueue ownership, withdrawal review, and value-free diagnostics remain present. The shared protected-content gate is bypassable by numeric letter references.
- **Activation, withdrawal, replacement, and cache — PASS.** First/replacement activation, P02 locks and safety state, source authority, retroactive eligibility, one-active lineage, atomic de-serving, review-only withdrawal, anonymous cache deletion, and lifecycle epoch reads remain unchanged from the effective final migration/cache owners.
- **Recovery readiness and durable receipts — PASS.** Strict parsing still binds operation, exact project, shared recovery basis, database/PITR/Storage/isolated-restore references/digests and freshness. Activation/rollback receipt UUIDs/digests, typed exact resources, strict append sequence/time, activation-time recovery basis, and exact retained restoration remain intact (`src/lib/recovery-readiness-evidence.ts:4-472`; `src/lib/reindex-pipeline.ts:88-150`).
- **P02/P04 interaction — PASS outside Finding 1.** P02 publication safety remains composed into P05. P04 remains accepted at `8dee5cc34294adfe1eb5b0e8ee267d72aa5fbc11` with the same accepted package hash; its audit/reindex owners and the legacy destructive commit path are not widened.
- **Security/ACL/privacy — PASS outside Finding 1.** Security definers retain fixed empty search paths; all 34 public definers are revoked from PUBLIC and none are reopened to PUBLIC/anon; mutating P05 entry points remain service-role-only. Diagnostics and recovery output remain privacy-minimized and opaque.
- **No authority widening — PASS.** Task 3 remains provider-free and pure. No document-generation staging/evaluation/promotion/rollback/cleanup, provider integration, or destructive/live owner was added.

## Immutable review identity

- Phase: `P05` — Tasks 2 and 3 of `docs/superpowers/rag-upgrade/local/plans/2026-08-20-rag-ingestion-reindex.md`
- Base: `0d5bb6a5012bd762bb53790ac24de16c7e3078c8`
- Head: `3d528b6d3214efb56c649b38222ad86def0d2984`
- Merge base: `0d5bb6a5012bd762bb53790ac24de16c7e3078c8`
- Canonical package: `docs/superpowers/rag-upgrade/execution-artifacts/rag-answer-quality-and-repository-coverage-v1/P05/P05-phase-review-3.diff`
- Canonical package SHA-256: `8112e85e2f77b6c133224c27890d0f6296379cfd61100bac7086c433c201e307`
- Package header range: `0d5bb6a5012bd762bb53790ac24de16c7e3078c8..3d528b6d3214efb56c649b38222ad86def0d2984`; eleven listed commits; 8,680 lines
- Final implementer report SHA-256: `f866fb1fb691b16f7e890dabb833f1e8a7c3abd4e3b4a83c4714c4cb86a70c44`
- Prior phase-review-2 report SHA-256: `d2efd784a4b51d0f57b3f10eab876808a3afa5b9983b6c2933f16cb3f1419fcd`
- Accepted predecessor package: local variant, SHA-256 `2ada405d103719fb8a921bac8b08ca6ca922850c27530185995d647a10dfa7d9`

## Commands and evidence

- `git rev-parse HEAD`, `git merge-base`, package/report `Get-FileHash -Algorithm SHA256`, and package-header inspection — exact immutable identities above.
- `git diff --check 0d5bb6a5..3d528b6d` — PASS. `git diff --stat` — 29 files, 7,800 insertions, 12 deletions.
- `npm run ledger:lookup -- 3d528b6d3214efb56c649b38222ad86def0d2984 --scope "P05 phase review-3"` — `NOT REVIEWED at this HEAD and scope`; no ledger write was made.
- Exact numeric-reference production-matcher probe — every input listed in Finding 1 returned `null`; `Health&#100;irect` was transformed to `Health irect`.
- Exact production worker-page probe — `{"first":false,"carryHasPrefix":true,"second":true,"paged":true,"reads":[[0,500],[500,500]]}` for rows 499/500/501 `Australian`/`Medicines`/`Handbook`.
- `GATE_RECEIPTS=refresh node scripts/run-vitest.mjs run tests/public-source-activation-manifest.test.ts tests/public-source-acquisition.test.ts tests/public-source-serving-lifecycle.test.ts tests/indexing-v3-agent.test.ts tests/ingestion-enqueue.test.ts tests/rag-cache-invalidation.test.ts tests/rag-cache-utils.test.ts tests/retrieval-owner-filter-guard.test.ts tests/retrieval-rpc-rollout.test.ts tests/function-grants.test.ts tests/supabase-schema.test.ts` — fresh PASS, 11 files and 182 tests; the numeric-letter entity case is absent.
- `GATE_RECEIPTS=refresh node scripts/run-vitest.mjs run tests/recovery-readiness-evidence.test.ts tests/reindex-pipeline.test.ts` — fresh PASS, 2 files and 62 tests.
- `GATE_RECEIPTS=refresh npm run typecheck` — fresh PASS.
- `npm run check:migration-role` — PASS; immutable applied history unchanged and no migration applied.
- `npm run check:function-grants` — PASS; 34 public security-definer functions revoked from PUBLIC and none reopened to PUBLIC/anon.
- `npm run check:maintainability-budgets` — PASS; `src/lib/rag/rag.ts` is 4,362/4,362 and worker 1,993/2,191.
- A fresh independent adversarial reviewer reproduced the same numeric-reference blocker, confirmed the 500-row overlap closure, and found no second high-confidence defect.

## No-live / no-document statement

This review used only repository source, migration text, accepted receipts/reports, static searches, and synthetic offline tests/probes. No provider or network call, Supabase/database/Storage access, migration application or live status read, recovery/PITR/restore operation, source fetch, document/PDF/corpus read, parsing, OCR, upload, embedding, enqueue, worker execution, reindex, activation, rollback, cleanup, deployment, push, or PR was run. No documents were processed. No product, test, plan, receipt, or accepted predecessor artifact was edited. This report is the only write and remains untracked and unstaged.
