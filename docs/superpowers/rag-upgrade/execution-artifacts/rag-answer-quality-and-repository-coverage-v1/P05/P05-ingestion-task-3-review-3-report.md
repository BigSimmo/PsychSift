# P05 ingestion Task 3 review 3 report

## Findings

### P2 Important — credential and secret labels bypass the opaque-reference filter when adjacent to other characters

- **Evidence:** `opaqueReferenceIdSchema` permits lowercase alphanumeric/dot/underscore/hyphen IDs, then rejects a sensitive label only when it is bounded by the start/end of the string or one of `.`, `_`, or `-` (`src/lib/recovery-readiness-evidence.ts:13-20`). The tests cover colon schemes and a hyphen-delimited `credential-private-value`, but do not cover a sensitive marker immediately followed or preceded by another allowed alphanumeric character (`tests/recovery-readiness-evidence.test.ts:269-289`).
- **Trigger / smallest proof:** the independent canonical-digest probe found `secretvalue`, `credential123`, `tokens`, `bearertoken`, `apikeyvalue`, `password123`, `signaturevalue`, and `signedurl` all accepted as `databaseBackup.reference.id`. In the same run, the submitted `https:backup`, `mailto:user`, `token:secret-value`, `credential-private-value`, `backup-secret-value`, `api-key-value`, and `signed-url` forms correctly rejected.
- **Expected:** the provider-free evidence artifact rejects credential/token/secret-labelled material regardless of punctuation or adjacency, rather than treating delimiter placement as the privacy boundary.
- **Actual risk:** a provider credential or accidental secret-bearing label can still be retained inside a strict, digest-valid evidence artifact by concatenating the marker with its value. This leaves the attempt-2 privacy finding partially open even though URI schemes are now closed.
- **Smallest fix:** reject the sensitive markers anywhere in the ID (remove the start/separator/end boundary requirements), or replace the free-form identifier with an application-issued handle format that cannot carry provider material. Add the eight accepted cases above, including digit, plural, prefix, and suffix adjacency, as regressions.

No other P0-P2 finding was identified across the complete immutable range.

## Attempt-2 correction disposition

| Attempt-2 finding | Attempt-3 disposition |
| --- | --- |
| Rollback did not authenticate complete readiness at activation time | **Closed.** `assertRollbackReceiptBinding` first rejects future-dated evidence at the rollback clock, then calls the complete activation binding with `new Date(activation.recordedAt)` (`src/lib/recovery-readiness-evidence.ts:432-450`). That historical replay covers evidence/database/PITR/Storage/drill freshness, PITR enabled/RPO, successful isolated drill, project/operation/basis/digest identity, and strict activation chronology without requiring the evidence to remain fresh now. Independent probes rejected disabled PITR, failed drill, in-place drill, stale-at-activation evidence, and evidence recorded after activation, while accepting evidence that expired only after a valid activation. |
| Scheme/credential/token/secret-labelled opaque IDs were accepted | **Partially closed.** Removing `:` closes URI-scheme forms, and delimiter-bounded sensitive labels reject. Alphanumeric-adjacent sensitive labels still parse; see the P2 finding. |
| Offline verifier absent from scripts index | **Closed.** The exact verifier is now named and described as provider-free/offline (`docs/scripts-index.md:57-58`), and the focused test pins that contract. |

## Earlier finding and full-contract recheck

- Both receipt inputs remain strict and canonical-digest verified before narrowing. Unknown keys, missing identity/digest/order fields, post-digest mutation, and a bare rollback object reject.
- Canonical hashing recursively sorts object properties and excludes only the record's own top-level `digest`; every strict-schema project, operation, resource, state, clock, recovery-basis, layer digest, activation, and retained-resource fact remains an input.
- Evidence remains exact-project and exact-operation bound. Database backup, PITR, Storage inventory/recovery, and restore drill share one recovery-basis UUID; the isolated target is identified and differs from source; the drill binds all four exact layer digests.
- Finite clocks, envelope/database/PITR 24-hour freshness, Storage seven-day freshness, drill 90-day freshness, strict validity order, and bounded five-minute future skew remain enforced. Rollback validates complete readiness at activation time and only omits reapplying freshness at the later rollback time.
- Activation and rollback receipt IDs must differ; rollback sequence and time are strictly later; exact failed/restored identities and digest bindings are required. Site-release and document-generation identities remain discriminated. Retained prior state is mandatory, distinct, immutable after parse, and rollback cannot claim reconstruction.
- The CLI remains import-safe, strict-argument/local-input only, and content-free on errors/output. It has no live/provider import. The range adds no schema, migration, provider adapter, database/Storage operation, document processing, persistence owner, or destructive-commit wiring.

## Reviewed range and artifact identity

- Task: `P05/ingestion/task-3`, correction review attempt 3 by the same independent reviewer.
- TASK_BASE: `62adef3b97906f6164f3d568712141dd9cd4117d`.
- TASK_HEAD: `866944e126fbcb2d085a05f0c070e119e9dcbf7f`.
- Merge base resolved exactly to TASK_BASE. The immutable full range contains `c0f09a27e`, `48ca64361`, and `866944e12`; six files, 1,234 insertions, and one deletion.
- Canonical full-range package `P05-ingestion-task-3-review-3.diff`: supplied and verified SHA-256 `f646da88584ea260d24f34ce88df4598effb7d89b62bba2af03b1947f86b3507`; all 1,381 lines were read.
- Final implementer report: supplied and verified SHA-256 `1c145f3982a0fd60e6e4839a3630de31d2cb11632eed3af6c1a06d68da09d51b`.
- Prior review-2 report: supplied and verified SHA-256 `98a9f07f4455c6ebb758f39c31f334aa5cdd89e6b26d4bd4605dcee2398d7c9f`.
- Immutable task brief: supplied and verified SHA-256 `fd3774d84e4e259f820ea35619c5dfb17b314cbf02cad16b09eb1e963ca17614`.
- The full package, brief, implementer claims, prior review, governing Task 3 plan, accepted P04/P05 predecessor contracts, current reindex owner, and all prior finding dispositions were reviewed. Working-tree or later-head product content was not used as review authority.
- `npm run ledger:lookup -- 866944e126fbcb2d085a05f0c070e119e9dcbf7f --scope "P05/ingestion/task-3 SDD review-3"` returned `NOT REVIEWED at this HEAD and scope`. No ledger record was appended because the controller requested only this uncommitted/unstaged SDD report.

## Commands and evidence

- Read-only Git resolution, branch/status, merge-base, ordered log, range stat, and artifact SHA-256 checks — exact immutable range and all supplied hashes matched.
- `node scripts/run-vitest.mjs run tests/recovery-readiness-evidence.test.ts tests/reindex-pipeline.test.ts` — PASS; 2 files and 54 tests passed. HEAD was `866944e126fbcb2d085a05f0c070e119e9dcbf7f` immediately before and after the run.
- Pure synthetic probe through `node scripts/run-tsx.mjs -e <probe>` — rollback results: disabled PITR `false`, failed drill `false`, in-place drill `false`, stale-at-activation `false`, evidence-after-activation `false`, expired-only-later `true`; valid historical activation `true`; scripts index named `true`. The same probe produced the accepted/rejected reference-ID results quoted in the finding. HEAD remained the immutable TASK_HEAD before and after.
- `git diff --check 62adef3b97906f6164f3d568712141dd9cd4117d..866944e126fbcb2d085a05f0c070e119e9dcbf7f` — PASS.
- `rg -n "fetch\\s*\\(|createClient|@supabase|commit_document_index_generation|process\\.env|SUPABASE_|DATABASE_URL" scripts/verify-recovery-readiness-evidence.ts src/lib/recovery-readiness-evidence.ts` — no matches (exit 1).
- Broad suites, browser checks, hosted/provider gates, SQL/migration replay, and live recovery operations were not run. The exact focused selector, full source review, static gate, and synthetic negative probes were the proportionate source-only evidence.

## No-live and no-document statement

No provider, network, Supabase, database, Storage, migration, recovery, PITR, restore-drill, cleanup, queue, worker, ingestion, reindex, document parsing/processing, corpus, activation, rollback, deployment, hosted CI, GitHub, push, or PR operation was run. No actual document, source payload, provider output, backup, Storage object, or database record was read or processed. Verification used only the immutable repository package/range and explicitly synthetic in-memory values. `scripts/supabase-recovery-status.ts` was not read or executed. No product file was edited; this report is intentionally uncommitted and unstaged.

SPEC_VERDICT: FAIL

QUALITY_VERDICT: FAIL
