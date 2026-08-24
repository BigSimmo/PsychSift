# P05 ingestion Task 3 review 1 report

## Findings

### P2 Important — the document receipt-pair assertion accepts an unparsed, undigested rollback object

- **Evidence:** `src/lib/reindex-pipeline.ts:107-149` explicitly accepts `RollbackReceipt | unknown`, checks only `operation`, three property names, `activationReceiptId`, and the two resource identities, then casts the object at line 132 and returns it as `DocumentGenerationRollbackReceipt`. It does not require or verify the rollback `receiptId`, `sequence`, `recordedAt`, `projectRef`, `activationReceiptDigest`, `recoveryEvidenceDigest`, `restorationMethod`, or canonical `digest`.
- **Trigger:** pass a valid parsed activation plus `{ operation: "document-generation", activationReceiptId, failedResource, restoredResource }` with the matching resource identities.
- **Expected:** the shared reindex owner accepts only a strict, canonical-digest-valid, promotion-bound rollback receipt and authenticates the exact activation/recovery basis.
- **Actual risk:** a caller can receive a typed, apparently validated rollback pair with no immutable rollback identity, no digest, no append-only ordering, no project binding, and no authenticated recovery basis. Later Task 8 code could rely on this helper and falsely treat an arbitrary object as a real retained-generation rollback receipt.
- **Smallest proof:** the independent synthetic probe returned `"bareRollbackAccepted":true` for exactly that four-field object.
- **Smallest fix:** take both inputs as `unknown`, parse them with `parseActivationReceipt` and `parseRollbackReceipt`, and validate all cross-receipt fields. Prefer accepting the evidence and expected project too, then delegate to `assertRollbackReceiptBinding`; otherwise at minimum verify canonical digests, project/operation, activation digest, recovery digest, strict sequence/time ordering, restoration method, and exact resources before narrowing the types. Add the bare-object regression to `tests/reindex-pipeline.test.ts`.

### P2 Important — stale database-backup/PITR evidence, invalid clocks, and future-dated receipts can pass

- **Evidence:** `src/lib/recovery-readiness-evidence.ts:237-242` performs date arithmetic without first requiring a finite clock. `assertRecoveryReadinessForOperation` at `:270-307` applies the 24-hour limit only to the envelope `verifiedAt`; database-backup and PITR timestamps are checked only for being non-future at `:289-295`. Storage and restore evidence receive explicit seven- and 90-day limits at `:297-305`, but database and PITR receive no age limit. `assertActivationReceiptBinding` at `:326-343` does not reject a `recordedAt` later than its supplied `at`, and rollback binding at `:345-379` has no clock parameter or future-time guard.
- **Trigger:** create a freshly signed envelope whose `databaseBackup.verifiedAt` and `pitr.verifiedAt` are from 2020; call readiness with `new Date(Number.NaN)`; or submit canonical activation/rollback receipts dated years in the future.
- **Expected:** database backup and PITR status are current at activation time, an unusable injected clock fails closed, and append-only receipts cannot be future-dated relative to the validation clock.
- **Actual risk:** a fresh outer envelope can launder arbitrarily old database/PITR evidence into a passing readiness decision. A malformed injected clock makes every freshness/future/expiry comparison false and bypasses all time gates. Future-dated events can also occupy or reorder an append-only identity/sequence space before the operation actually occurs.
- **Smallest proof:** independent probes returned `"staleNestedAccepted":true` for 2020 database/PITR timestamps at a 2026 activation time, `"invalidClockAccepted":true` for an invalid `Date`, and `{"futureActivationAccepted":true,"futureRollbackAccepted":true}` for receipts dated in 2030/2031 and validated in 2026.
- **Smallest fix:** reject a non-finite `at.getTime()` before any comparison; enforce the current-evidence bound on database-backup and PITR timestamps (the same 24-hour activation boundary unless the governing plan defines a stricter one); reject activation `recordedAt > at`; and give rollback binding a deterministic `at` parameter that rejects a future receipt without reapplying evidence freshness. Add exact-boundary, stale, future, and invalid-clock cases.

### P2 Important — recovery layers are not bound to the claimed project or to one restore basis

- **Evidence:** the nested schemas at `src/lib/recovery-readiness-evidence.ts:14-54` contain references, digests, timestamps, and limited status fields, but none carries the source project identity. The restore drill records only the generic enum `target: "isolated-project"`; it does not identify the isolated target or bind the drill to the exact database backup, PITR snapshot/window, Storage inventory, or Storage recovery digest. `assertRecoveryReadinessForOperation` compares only the outer envelope project at `:276-278`.
- **Trigger:** reuse database/PITR/Storage/restore references and digests collected for project A, set the outer envelope `projectRef` to project B, recompute the canonical envelope digest, and validate against project B.
- **Expected:** every recovery layer proves the exact source project/resource it covers, and the restore drill proves the same promotion-bound recovery basis rather than any unrelated isolated drill.
- **Actual risk:** the strict/canonical envelope authenticates what was supplied but cannot distinguish a complete project-B recovery package from foreign or mixed-project evidence. That defeats the project-bound stop condition this contract exists to enforce.
- **Smallest fix:** include and validate the source project identity on database, PITR, Storage, and restore evidence; identify the isolated restore target; and bind the drill to the exact backup/PITR and relevant Storage evidence digests. Add mixed-project and mixed-basis rejection tests.

### P2 Important — activation and rollback receipts may reuse the same immutable receipt identity

- **Evidence:** both receipt schemas independently require a UUID (`src/lib/recovery-readiness-evidence.ts:99-105` and `:136-145`), but `assertRollbackReceiptBinding` at `:345-379` never requires `receipt.receiptId !== activation.receiptId`. It checks increasing sequence and non-decreasing time only.
- **Trigger:** construct a canonical rollback receipt whose `receiptId` equals the activation `receiptId`, with every other binding correct.
- **Expected:** append-only activation and rollback events have distinct unique identities; one immutable event identity cannot be replaced by another event body.
- **Actual risk:** the pair validates while two different canonical records share one identity. Any append-only store or deduplication keyed by `receiptId` can replace, conflate, or suppress one of the events, violating the brief's immutable/unique receipt identity requirement.
- **Smallest proof:** the independent parsed-receipt probe returned `"reusedReceiptIdAccepted":true`.
- **Smallest fix:** reject equal activation/rollback receipt IDs in `assertRollbackReceiptBinding` (and in the reindex pair assertion), then add a regression. Storage-level uniqueness remains a later lifecycle responsibility, but this pure pair contract must at least prevent self-collision.

### P2 Important — arbitrary raw provider content can be hidden inside an evidence reference

- **Evidence:** `evidenceReferenceSchema` at `src/lib/recovery-readiness-evidence.ts:12` accepts any trimmed 1–500-character string. `assertSafeReference` at `:215-223` rejects only strings starting with HTTP(S) or matching a small keyword/JWT heuristic. It does not require an opaque identifier grammar or reject JSON, multiline content, other URL schemes, query fragments such as SAS `sig=`, or arbitrary provider response text.
- **Trigger:** put serialized provider output such as `{"providerPayload":{"backup":"private-record"}}` in `databaseBackup.reference`, recompute the digest, and parse the evidence.
- **Expected:** evidence stores bounded opaque references/digests only and rejects raw provider output or secret-bearing/signed-location content regardless of which string field carries it.
- **Actual risk:** the strict unknown-key guard is bypassed simply by serializing raw output into an allowed reference field. The artifact can then persist provider/private content despite the task's privacy boundary; keyword filtering is not a content-free contract.
- **Smallest proof:** the independent probe returned `"rawStringReferenceAccepted":true`.
- **Smallest fix:** replace the free-form reference with a structured allowlisted opaque-reference type (for example, an enum kind plus a short identifier restricted to a conservative character grammar), reject control characters/whitespace/JSON delimiters/query strings/all URL schemes, and add JSON, multiline, protocol-relative, non-HTTP URL, and signed-query regressions.

## Strengths

- All evidence and receipt object schemas are strict, and the site-release/document-generation resource union is discriminated and operation-checked (`src/lib/recovery-readiness-evidence.ts:56-174`).
- Canonical digesting recursively orders object properties and retains nested evidence/receipt facts while excluding only the record's own top-level `digest` (`:185-205`); parsed results are recursively frozen.
- Activation correctly requires currently fresh evidence and exact evidence ID/digest/project/operation binding, while rollback intentionally authenticates the promotion-bound digest without reapplying the freshness window (`:326-379`). The exact retained previous resource is compared rather than reconstructed.
- The offline CLI is import-safe, strict about flags, emits bounded identity/digest JSON only, and its direct-execution failure is a constant content-free code (`scripts/verify-recovery-readiness-evidence.ts:17-74`).
- Site-release and document-generation identities remain typed separately. The existing destructive commit path was neither wired nor described as reversible, and no schema/provider adapter was added.

## Reviewed identity and scope

- TASK_BASE: `62adef3b97906f6164f3d568712141dd9cd4117d`
- TASK_HEAD: `c0f09a27ebbac0f6cdef1b080a585782e925eb92`
- Commit: `c0f09a27e feat(ingestion): add recovery readiness receipts`
- Brief SHA-256: `fd3774d84e4e259f820ea35619c5dfb17b314cbf02cad16b09eb1e963ca17614` — matched.
- Implementer report SHA-256: `bb987f9287d4d54d882aef8d6dad0a4d2db4f81e4e8174429aff9247ea12423b` — matched.
- Canonical full-range package SHA-256: `acfff677c90dce86285e70f25a6942c934f04f7e16b6a233aad74b69b0665911` — matched.
- Full range: six files, 919 insertions, one deletion. The canonical 1,043-line package was reviewed in full, together with the complete brief/report, governing ingestion plan and approved design, accepted P04 audit evidence, accepted P05 Task 2 source-control evidence, the repository-content consumer interface, and current reindex ownership/call sites.
- `npm run ledger:lookup -- c0f09a27ebbac0f6cdef1b080a585782e925eb92 --scope "P05/ingestion/task-3 full range 62adef3b..c0f09a27"` returned `NOT REVIEWED at this HEAD and scope`. No immutable review record was appended because this controller-owned SDD review requested an uncommitted, unstaged artifact report only.

## Commands and results

- `node scripts/run-vitest.mjs run tests/recovery-readiness-evidence.test.ts tests/reindex-pipeline.test.ts` — PASS; 2 files and 31 tests passed. This confirms the submitted focused selector is green but does not cover the findings above.
- Pure provider-free inline probes through `node scripts/run-tsx.mjs -e <synthetic probe>` — reproduced `{"staleNestedAccepted":true,"bareRollbackAccepted":true,"reusedReceiptIdAccepted":true,"rawStringReferenceAccepted":true}`, `{"invalidClockAccepted":true}`, and `{"futureActivationAccepted":true,"futureRollbackAccepted":true}`.
- `git diff --check 62adef3b97906f6164f3d568712141dd9cd4117d..c0f09a27ebbac0f6cdef1b080a585782e925eb92` — PASS (exit 0).
- Exact artifact hash checks, branch/HEAD/status, range log/stat/name-status, governing owner search, and current call-site search were read-only and matched the supplied immutable range.
- Typecheck, maintainability, documentation inventory/index checks, broad unit suites, browser checks, hosted SQL/migration replay, and provider/live gates were not rerun. The implementer report already records the distinct static gates at TASK_HEAD; broad/live checks would not replace the focused negative proofs and some would cross the prohibited boundary.

## No-live and no-document statement

No provider, network, Supabase, database, Storage, migration, recovery, PITR, restore, queue, worker, ingestion, reindex, document, corpus, activation, rollback, deployment, hosted CI, GitHub, push, or PR operation was run. No actual document, source payload, provider output, backup, Storage object, or database record was read or processed. Verification used repository source/diff text and synthetic in-memory values only. `scripts/supabase-recovery-status.ts` was not read or executed. No product file was edited; this report is intentionally uncommitted and unstaged.

SPEC_VERDICT: FAIL

QUALITY_VERDICT: FAIL
