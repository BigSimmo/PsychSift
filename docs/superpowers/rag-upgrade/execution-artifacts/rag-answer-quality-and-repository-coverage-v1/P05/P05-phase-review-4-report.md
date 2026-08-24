# P05 phase review 4

## Findings

### 1. P1 — valid named character references that encode letters bypass acquisition and worker enforcement

Attempt 4 correctly decodes decimal and hexadecimal numeric references, but the semicolon-terminated named-reference branch still replaces every recognized or unknown named entity with a space (`supabase/functions/_shared/public-source-policy.ts:125-132`). NFKC and protected-identity matching happen only afterward (`:149-167`), and acquisition applies the same preprocessing (`src/lib/public-source-acquisition.ts:652-664`).

Exact offline probes against the production matcher returned `null` for:

- `He&afr;lthdirect`
- `Healthd&ifr;rect`
- `Therapeu&tscr;ic Guidelines`
- `Australian Medicines H&afr;ndbook`
- `Health&dd;irect`
- `Health&DifferentialD;irect`

These are valid HTML named character references. The installed HTML decoder confirms that their rendered mathematical letters normalize through NFKC to ordinary `a`, `i`, `t`, or `d`; for example, `He&afr;lthdirect` decodes to `He𝔞lthdirect` and normalizes to `Healthdirect`. The P05 helper instead produces `He lthdirect`. Because the acquisition and actual worker boundaries share this matcher, both explicit protected-source gates can be bypassed.

Expected correction: decode recognized named references to their Unicode values before NFKC, including semicolon-terminated references and only browser-compatible legacy semicolonless forms. Unknown, malformed, invalid, or unsafe references may conservatively become boundaries. Add named-letter cases through acquisition and the actual worker scan owner.

## Verdicts

SPEC_VERDICT: FAIL

QUALITY_VERDICT: FAIL

The numeric-reference correction and real worker page overlap both pass. The full phase still fails because valid named entities can encode the protected identities that Task 2 requires both acquisition and worker enforcement to reject.

## Attempt-3 finding disposition

| Attempt-3 finding                                                                | Attempt-4 disposition | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Numeric character references encoding letters bypass both protected-source gates | **CLOSED**            | `decodeNumericHtmlCharacterReference` decodes valid decimal/hex scalars, while invalid, surrogate, out-of-range, and unsafe control values become boundaries (`supabase/functions/_shared/public-source-policy.ts:85-123`). Exact `&#100;`, `&#100`, `&#x64;`, and `&#x64` probes reconstruct `d` and return `healthdirect`; zero, C0, surrogate, and out-of-range cases safely remain detectable boundaries. Acquisition and worker tests exercise the same shared owner (`tests/public-source-acquisition.test.ts:442-476`; `tests/indexing-v3-agent.test.ts:74-137`). |

## Attempt-2 finding disposition

| Attempt-2 finding                                                                      | Attempt-4 disposition | Evidence                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker overlap missed a protected identity spanning three chunks at a 500-row boundary | **CLOSED**            | The paged owner carries the final 256 characters of the complete concatenated stream (`supabase/functions/indexing-v3-agent/behavior.ts:82-109`), and the real worker calls it over ordered 500-row pages (`supabase/functions/indexing-v3-agent/index.ts:1795-1813`). Rows 499=`Australian`, 500=`Medicines`, and 501=`Handbook` return `true` with reads `[[0,500],[500,500]]`. |

## Phase-review-1 finding disposition

| Phase-review-1 finding                                                        | Attempt-4 disposition | Evidence                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Effective event RPC dropped active-indexable allowlist/evidence strictness | **CLOSED**            | Final event authority pins policy version/digest, the 18 active/indexable catalogue keys, bounded reason, and 1–50 unique nonblank evidence references (`supabase/migrations/20260824123000_harden_public_source_lifecycle_authority.sql:54-93`).                 |
| 2. No first-version activation path                                           | **CLOSED**            | Null-predecessor activation requires no current active row and no supersedes link; replacement requires the exact active predecessor and exact immutable lineage (`:357-412`).                                                                                    |
| 3. Historical P02 publications without a P05 row remained public              | **CLOSED**            | Exact active-version/approval eligibility, fail-closed prior-owner recovery, historical document/artifact re-ownership, cache deletion, epoch bump, and future constraints remain effective (`:603-724`).                                                         |
| 4. Source decisions and lifecycle used different locks/current authority      | **CLOSED**            | All source owners use the canonical per-catalogue advisory lock and activation reproves the latest sequenced E1 event under it (`:96-101,137-145,183-192,381-395,515-518,548-552,579-583`).                                                                       |
| 5. P05 activation bypassed P02 status/artifact/job locks                      | **CLOSED**            | Effective activation retains document/pages/images/artifact/job locks, active-work rejection, indexed/current and ownership checks, plus exact P02 approval/generation/state/acquisition proof (`:413-469`).                                                      |
| 6. Cache used a stale request-start lifecycle epoch                           | **CLOSED**            | Local/shared search/answer reads recheck serving authority before lookup and after a candidate hit; authority is never hidden behind the memoized document stamp and failure bypasses cache (`src/lib/rag/rag-cache.ts:185-210,358-383,475-550,555-581,644-665`). |
| 7. Actual worker did not use shared normalized protected-content semantics    | **FAIL overall**      | The actual worker uses the shared matcher with complete cross-page overlap; Finding 1 proves that matcher still discards valid named entities that decode/NFKC into required letters.                                                                             |
| 8. Effective stage/resume dropped full exact identity                         | **CLOSED**            | Latest authority and the complete version/document/metadata/owner/URL/version/byte/type/hash/provenance/licence/lifecycle/lineage/acquisition-digest matrix remain enforced (`20260824123000_harden_public_source_lifecycle_authority.sql:160-297`).              |
| 9. Effective transition removed the lifecycle state machine                   | **CLOSED**            | The obsolete overload remains dropped; explicit allowed edges and active ineligibility/epoch behavior remain effective (`:503-539`).                                                                                                                              |

## Original preflight finding disposition

| Original preflight finding                                       | Attempt-4 disposition | Evidence                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Lifecycle, serving, and cache authority disconnected          | **CLOSED**            | Exact eligibility, historical/future constraints, transactional exits, cache deletion, epoch bumps, and fresh pre/post-hit reads remain one fail-closed chain.                                                                                                                        |
| 2. Replacement activation/lineage non-atomic                     | **CLOSED**            | Canonical source lock, one-active index, exact old/new/lineage proof, and old-before-new transactional publication remain intact.                                                                                                                                                     |
| 3. Exact P02 receipt/version binding incomplete                  | **CLOSED**            | Exact approval/source/policy/generation/state/manifest/acquisition binding and P02 locks/work/ownership checks remain enforced. Accepted P02 is `accepted` at `ac634ab358c92e6d943258a532aa5c6a98959e88`, package `2ada405d103719fb8a921bac8b08ca6ca922850c27530185995d647a10dfa7d9`. |
| 4. Unchanged checks trusted stale current input                  | **CLOSED**            | Locked exact active ID/catalogue/URL/version/hash/outcome reproving remains effective (`20260824123000_harden_public_source_lifecycle_authority.sql:542-566`).                                                                                                                        |
| 5. Acquisition not exactly resumable                             | **CLOSED**            | Deterministic identities, pre-upload resume, full SQL identity validation, and immutable acquisition digest remain intact.                                                                                                                                                            |
| 6. Protected normalization/encoding/worker parity                | **FAIL overall**      | Numeric encodings and worker paging are closed; valid named entities encoding NFKC-equivalent letters bypass both gates under Finding 1.                                                                                                                                              |
| 7. Event append order time/UUID based                            | **CLOSED**            | Unique monotonic per-catalogue sequence and sequence-ordered current authority remain under the canonical lock.                                                                                                                                                                       |
| 8. URL privacy accepted fragments/sensitive query keys           | **CLOSED**            | HTTPS/exact host, fragment rejection, the five-key query allowlist, and value-free diagnostics are unchanged (`src/lib/public-source-acquisition.ts:177-205`).                                                                                                                        |
| 9. Recovery opaque IDs accepted adjacent/plural sensitive labels | **CLOSED**            | Separator-stripped secret/credential/password/bearer/API-key/signature/signed/token rejection remains unchanged (`src/lib/recovery-readiness-evidence.ts:13-29`).                                                                                                                     |

## Other requirement assessment

- **Controlled acquisition — FAIL only for Finding 1.** Active catalogue/exact URL authority, SSRF/DNS/global-IP, address-pinned TLS/hostname, redirect, byte/type/signature/structure bounds, exact hashes, sanitization, provenance, deterministic staging/resume, enqueue, withdrawal review, and value-free diagnostics remain intact. Named-letter entity normalization is not fail closed.
- **Activation, withdrawal, replacement, and cache — PASS.** First/replacement activation, P02 safety locks, latest source authority, retroactive eligibility, atomic de-serving, human-review withdrawal, anonymous cache invalidation, and pre/post-hit lifecycle epochs remain unchanged.
- **Recovery readiness and durable receipts — PASS.** Operation/project/recovery-basis/database/PITR/Storage/restore input and digest binding, freshness, typed resource identities, distinct UUID/digest receipts, strict append order, activation-time recovery basis, and exact retained restoration remain intact (`src/lib/recovery-readiness-evidence.ts:4-472`; `src/lib/reindex-pipeline.ts:88-150`).
- **P02/P04 interaction — PASS outside Finding 1.** P02 publication safety remains composed. P04 remains accepted at `8dee5cc34294adfe1eb5b0e8ee267d72aa5fbc11` with the accepted package hash above; audit/reindex and legacy destructive commit owners are not widened.
- **Security/ACL/privacy — PASS outside Finding 1.** Security definers retain fixed empty search paths, all 34 public definers remain revoked from PUBLIC, P05 mutations remain service-role-only, and diagnostics/recovery output remain privacy-minimized.
- **No authority widening — PASS.** Task 3 remains provider-free and pure; no document-generation or live/destructive owner was added.

## Immutable review identity

- Phase: `P05` — Tasks 2 and 3 of `docs/superpowers/rag-upgrade/local/plans/2026-08-20-rag-ingestion-reindex.md`
- Base: `0d5bb6a5012bd762bb53790ac24de16c7e3078c8`
- Head: `2e01a2efea1799d206d88422d33288f83b29ed60`
- Merge base: `0d5bb6a5012bd762bb53790ac24de16c7e3078c8`
- Canonical package: `docs/superpowers/rag-upgrade/execution-artifacts/rag-answer-quality-and-repository-coverage-v1/P05/P05-phase-review-4.diff`
- Canonical package SHA-256: `594e686447640f51ff1be3c86426fcc2db50de2ef02e8b983d2d1c36e9ee9c59`
- Package header range: `0d5bb6a5012bd762bb53790ac24de16c7e3078c8..2e01a2efea1799d206d88422d33288f83b29ed60`; twelve listed commits; 8,728 lines
- Final implementer report SHA-256: `5b5bc8d766c9eaa853829eb20bfb0a774c4af618d1b1a4d3884c41229ef6e726`
- Prior phase-review-3 report SHA-256: `c1c7263e0b56a22dbaa9839c698771502eea9071e3b74e7c5178db24342c5f61`
- Accepted predecessor package SHA-256: `2ada405d103719fb8a921bac8b08ca6ca922850c27530185995d647a10dfa7d9`

## Commands and evidence

- Immutable Git/hash/header checks — exact identities above; `git diff --check` passed and full range is 29 files, 7,847 insertions, 12 deletions.
- `npm run ledger:lookup -- 2e01a2efea1799d206d88422d33288f83b29ed60 --scope "P05 phase review-4"` — `NOT REVIEWED at this HEAD and scope`; no ledger write.
- Numeric production-matcher probe — valid decimal/hex values, with/without semicolon, returned `healthdirect`; invalid scalar/control cases became boundaries and remained detectable.
- Actual worker paging probe — `{"result":true,"reads":[[0,500],[500,500]]}` for the 499/500/501 three-chunk identity.
- Installed HTML decoder plus production matcher probe — the six named-entity inputs in Finding 1 decode/NFKC to protected identities but P05 returns `null`.
- `GATE_RECEIPTS=refresh node scripts/run-vitest.mjs run tests/public-source-activation-manifest.test.ts tests/public-source-acquisition.test.ts tests/public-source-serving-lifecycle.test.ts tests/indexing-v3-agent.test.ts tests/ingestion-enqueue.test.ts tests/rag-cache-invalidation.test.ts tests/rag-cache-utils.test.ts tests/retrieval-owner-filter-guard.test.ts tests/retrieval-rpc-rollout.test.ts tests/function-grants.test.ts tests/supabase-schema.test.ts` — fresh PASS, 11 files and 182 tests; named-letter entities are absent.
- `GATE_RECEIPTS=refresh node scripts/run-vitest.mjs run tests/recovery-readiness-evidence.test.ts tests/reindex-pipeline.test.ts` — fresh PASS, 2 files and 62 tests.
- `GATE_RECEIPTS=refresh npm run typecheck` — fresh PASS.
- `npm run check:migration-role`, `npm run check:function-grants`, and `npm run check:maintainability-budgets` — PASS; immutable history unchanged, 34 definers closed to PUBLIC, worker 1,993/2,191.
- A fresh independent adversarial reviewer reproduced the named-entity bypass, confirmed numeric decoding and worker overlap closure, and found no second high-confidence defect.

## No-live / no-document statement

This review used repository source, migration text, accepted receipts/reports, installed offline decoder behavior, static searches, and synthetic offline tests/probes only. No provider or network call, Supabase/database/Storage access, migration application or live status read, recovery/PITR/restore operation, source fetch, document/PDF/corpus read, parsing, OCR, upload, embedding, enqueue, worker execution, reindex, activation, rollback, cleanup, deployment, push, or PR was run. No documents were processed. No product, test, plan, receipt, or predecessor artifact was edited. This report is the only write and remains untracked and unstaged.
