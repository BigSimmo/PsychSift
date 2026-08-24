# P05 ingestion Task 3 review 2 report

## Findings

### P2 Important — rollback validation does not authenticate recovery readiness at the activation time

- **Evidence:** activation validation runs the complete readiness contract at `at`, including finite/current clocks, database/PITR/Storage/drill freshness, enabled/strong-enough PITR, successful isolated drill, basis binding, and validity (`src/lib/recovery-readiness-evidence.ts:322-353,372-394`). Rollback validation does not replay those predicates at the historical activation time. It checks evidence clock shape/current non-futurity, identity/digests/basis, and `validUntil`, but never checks historical freshness, PITR status/RPO, drill outcome/target, or the strict `activation.recordedAt >= evidence.verifiedAt` rule (`:432-465`).
- **Trigger / smallest proof:** independent provider-free probes constructed canonical receipt/evidence triples with disabled PITR, a failed restore drill, an `in-place` drill, and recovery evidence already stale at activation. Each returned `{"activation":false,"rollback":true}`. A second triple with evidence at `06:00` and activation at `05:58` returned `{"activationBindingAccepts":false,"rollbackBindingAcceptsSameActivation":true}` because rollback permits evidence up to five minutes after activation.
- **Expected:** rollback may consume evidence that is old **now**, but it must authenticate that the exact evidence satisfied the complete readiness contract **at the bound activation time**.
- **Actual risk:** a promotion that could never have passed activation — including one with stale evidence, disabled PITR, or a failed/in-place drill — can later be accepted as carrying an authenticated recovery basis for rollback. This defeats the recovery stop conditions on the rollback-only consumer path.
- **Smallest fix:** reuse the complete activation binding against `new Date(activation.recordedAt)` (or an equivalent historical-readiness helper), then retain the current-time non-futurity checks for the evidence and both receipts. This proves historical freshness/outcome/RPO/target/causality without requiring the evidence to remain fresh at rollback. Add the four negative cases above plus the one-to-five-minute pre-evidence activation case, while preserving the existing successful expired-evidence rollback regression.

### P2 Important — the opaque-reference grammar still admits URL schemes and token-labelled provider material

- **Evidence:** `opaqueReferenceIdSchema` allows `:` anywhere after the first character (`src/lib/recovery-readiness-evidence.ts:13-17`). Consequently, strict `{ kind, id }` parsing still accepts scheme-shaped values inside the allowed `id` field.
- **Trigger / smallest proof:** after recomputing the canonical envelope digest, independent probes found both `reference.id = "https:backup"` and `reference.id = "token:secret-value"` accepted. Node's offline URL parser normalizes the first to `https://backup/`. The submitted tests reject URLs containing `/` or `?`, but do not cover a scheme-form URL without those characters.
- **Expected:** the provider-free artifact admits only bounded non-sensitive handles and rejects all URL schemes, provider tokens, raw provider output, and unknown fields regardless of which field carries the value.
- **Actual risk:** a signed/location or credential-like provider value can still be retained in a digest-valid evidence artifact by placing a colon-form value in an otherwise valid reference object, leaving the prior privacy finding only partially closed.
- **Smallest fix:** remove `:` from the identifier allowlist or explicitly reject URI-scheme and credential-marker forms before accepting the ID; add regressions for `https:backup`, `mailto:user`, and token/secret-labelled values as well as the existing slash/query/JSON cases.

### P3 Minor — the scripts index increments its count but omits the new top-level verifier

- **Evidence:** `docs/scripts-index.md:3-8` says every top-level `.mjs`/`.ts`/`.cjs` script is named below, but `verify-recovery-readiness-evidence.ts` is absent from the index and from the ingestion/verification entries. `rg -n "verify-recovery-readiness|recovery readiness" docs/scripts-index.md package.json` returned no match.
- **Impact:** the only new operator-facing offline verifier is not discoverable from the repository's declared script map, despite this range updating that map's generated count from 266 to 267.
- **Smallest fix:** add the verifier by name under the appropriate offline verification or ingestion section with its provider-free/input-only role; a package script is unnecessary unless repository convention requires one.

## Prior finding disposition

| Review-1 finding | Attempt-2 disposition |
| --- | --- |
| Both receipt inputs were not strictly parsed/digest-verified | **Closed.** `parseActivationReceipt` and `parseRollbackReceipt` enforce strict schemas and canonical digests, and `assertReceiptAppendOnlyPair` parses both unknown inputs before narrowing (`src/lib/recovery-readiness-evidence.ts:356-369,398-403`). Bare rollback and post-digest activation/rollback mutation probes all rejected. |
| Stale database/PITR evidence, invalid clock, and future receipts | **Not fully closed.** Finite `at`, 24-hour database/PITR freshness, bounded five-minute future skew, evidence ordering, and future activation/rollback checks are present (`:246-295,322-353,372-394,432-465`) and the former direct bypass probes now reject. However, rollback omits the historical activation-time readiness predicates and accepts stale/disabled/failed/in-place evidence or evidence shortly after activation; see the first P2 finding. |
| Recovery layers were not project/basis/isolated-target/input-digest bound | **Closed.** Every layer carries project and recovery-basis identity; the target must differ from the source; and the drill binds all four exact input digests (`:469-488`). Mixed-project, mixed-basis, digest-drift, and in-place-target probes rejected. |
| Activation and rollback could reuse one receipt identity | **Closed.** Equal IDs are rejected, sequence and time are strictly increasing, and exact failed/restored identities are checked (`:398-429`). Reused-ID and non-monotonic probes rejected. |
| Free-form references admitted raw provider content | **Not fully closed.** Strict structured references reject unknown keys, JSON, multiline text, slash/query URLs, and root-level raw output, but the colon-bearing ID grammar admits URL-scheme and token-labelled values; see the second P2 finding. |

## Other specification and quality observations

- Canonical hashing recursively orders object properties and excludes only the record's own top-level `digest`; all strict-schema evidence, resource, identity, clock, project, operation, state, recovery-basis, and prior-resource facts remain hash inputs (`src/lib/recovery-readiness-evidence.ts:216-235`). No property-order or omitted authorization-fact defect was found.
- Database backup, PITR, Storage inventory/recovery, and isolated restore-drill evidence are required and strict. Readiness stops on disabled/weak PITR, stale database/PITR/Storage/drill evidence, failed/non-isolated drill, wrong project/operation, expired evidence, or mismatched recovery basis/digests (`:322-353,469-488`).
- Activation/rollback schemas are strict and deeply frozen, site-release and document-generation identities are discriminated and operation-checked, a retained previous resource is mandatory and distinct, and rollback must restore that exact pointer without reconstruction (`:104-201,238-243,398-429`).
- The reindex owner adds only pure document-generation receipt narrowing; it does not wire or claim reversibility for `commit_document_index_generation` (`src/lib/reindex-pipeline.ts:97-139`).
- The CLI is import-safe, reads only an injected/local JSON artifact, emits bounded identity/digest JSON on success, emits a content-free code on command-line failure, and imports no provider/live adapter (`scripts/verify-recovery-readiness-evidence.ts:1-74`).
- The range adds no schema, migration, provider, live, Storage, database, document-processing, activation, rollback, or destructive-commit implementation.

## Reviewed range and artifact identity

- Task: `P05/ingestion/task-3`, correction review attempt 2 by the same independent reviewer.
- TASK_BASE: `62adef3b97906f6164f3d568712141dd9cd4117d`.
- TASK_HEAD: `48ca6436132312fa23ca9a1c4686234fcb1ffa49`.
- Merge base resolved exactly to TASK_BASE; reviewed commits were `c0f09a27ebbac0f6cdef1b080a585782e925eb92` and `48ca6436132312fa23ca9a1c4686234fcb1ffa49`.
- Canonical full-range package `P05-ingestion-task-3-review-2.diff`: supplied and verified SHA-256 `8ee0c728dcb7afb932957f3495bb1eed89f1cdef7bfaa88e7777ea230ad8913b`; all 1,327 lines were read across the complete base..head range.
- Task brief `P05-ingestion-task-3-brief.md`: supplied and verified SHA-256 `fd3774d84e4e259f820ea35619c5dfb17b314cbf02cad16b09eb1e963ca17614`.
- Final implementer report: supplied and verified SHA-256 `0520039a6dca9b5ca5d2e111fd3ea1c8a37f833e7645d3e352e878526d9cf8fd`.
- Prior review report: supplied and verified SHA-256 `0a4ebccf39d498b1dc326bfef213ffb71c7d9179aee41bf58b199d53125e1aa9`.
- The governing plan Task 3, accepted P04 phase review 3, accepted P05 Task 2 review 4, current reindex owner, correction implementation, tests, and full original range were reviewed; the implementer report was treated as a claim, not as proof.
- `npm run ledger:lookup -- 48ca6436132312fa23ca9a1c4686234fcb1ffa49 --scope "P05/ingestion/task-3 SDD review-2"` returned `NOT REVIEWED at this HEAD and scope`. No ledger record was appended because the controller requested only this uncommitted/unstaged SDD report.

## Commands and evidence

- Read-only Git identity/status/log/stat and SHA-256 verification — base/head and all four supplied artifact hashes matched; the six-file full range was confirmed.
- `node scripts/run-vitest.mjs run tests/recovery-readiness-evidence.test.ts tests/reindex-pipeline.test.ts` — PASS; 2 files and 44 tests passed.
- Pure in-memory correction probe through `node scripts/run-tsx.mjs -e <synthetic probe>` — former bypasses rejected: bare rollback, tampered activation/rollback digest, invalid clock, stale nested database evidence, future activation/rollback, mixed project, mixed recovery basis, drill digest drift, in-place target, reused receipt ID, non-monotonic sequence, signed slash/query URL, raw root output, and unknown reference key all returned `true` for rejection. Expired-evidence rollback returned `true` for acceptance as intended. The same probe returned `{"schemeLikeReferenceAccepted":true,"tokenLikeReferenceAccepted":true}`.
- Pure historical-readiness probes through `node scripts/run-tsx.mjs -e <synthetic probe>` — disabled PITR, failed drill, in-place drill, and stale-at-activation cases each returned `{"activation":false,"rollback":true}`; the pre-evidence activation case returned `{"activationBindingAccepts":false,"rollbackBindingAcceptsSameActivation":true}`.
- `node -e "process.stdout.write(JSON.stringify({normalized:new URL('https:backup').href}))"` — offline parse returned `{"normalized":"https://backup/"}`.
- `git diff --check 62adef3b97906f6164f3d568712141dd9cd4117d..48ca6436132312fa23ca9a1c4686234fcb1ffa49` — PASS.
- `rg -n "fetch\\s*\\(|createClient|@supabase|commit_document_index_generation|process\\.env|SUPABASE_|DATABASE_URL" scripts/verify-recovery-readiness-evidence.ts src/lib/recovery-readiness-evidence.ts` — no matches (exit 1), confirming no direct live/provider/destructive coupling in the new owners.
- Broad suites, browser tests, typecheck, hosted/provider checks, SQL/migration replay, and live recovery operations were not run. The exact focused selector plus static and synthetic negative proofs were the proportionate source-only review evidence; live checks were prohibited.

## No-live and no-document statement

No provider, network, Supabase, database, Storage, migration, recovery, PITR, restore-drill, cleanup, queue, worker, ingestion, reindex, document parsing/processing, corpus, activation, rollback, deployment, hosted CI, GitHub, push, or PR operation was run. No actual document, source payload, provider output, backup, Storage object, or database record was read or processed. Verification used repository source/diff text and explicitly synthetic in-memory values only. `scripts/supabase-recovery-status.ts` was not read or executed. No product file was edited; this report is intentionally uncommitted and unstaged.

SPEC_VERDICT: FAIL

QUALITY_VERDICT: FAIL
