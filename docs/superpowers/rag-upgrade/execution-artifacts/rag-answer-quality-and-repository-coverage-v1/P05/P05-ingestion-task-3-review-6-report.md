# P05 ingestion Task 3 review 6 report

## Findings

No P0-P2 finding was identified across the complete immutable range.

## Review-5 correction disposition and full contract recheck

- **Review-5 protected-reference finding: closed.** The shared normalizer now consumes numeric HTML character references with or without a semicolon and conservatively replaces complete semicolon-terminated or legacy semicolonless named references with a boundary while preserving following text (`supabase/functions/_shared/public-source-policy.ts:9-141`). Trusted-page admission and extracted text both use that shared owner (`src/lib/public-source-acquisition.ts:17-23,651-691`), and the real indexing worker delegates its ordered SQL page reads to the same protected-identity path (`supabase/functions/indexing-v3-agent/index.ts:1795-1815`).
- **Exact negative probe:** `Health&#9direct`, `Health&#9 direct`, and `Health&nbsp direct` resolved to `healthdirect`; `Therapeutic&#10Guidelines` resolved to `etg_complete`; and `Australian Medicines&#9Handbook` resolved to `australian_medicines_handbook`. Every value produced `trustedPage: "quarantine"` and `worker: true` through the production functions.
- **Exact 499/500/501 edge:** a synthetic 500-row first page placed `Australian` at row 499 and `Medicines` at row 500; the production page helper retained a bounded 256-character carry containing `AustralianMedicines`. A second page containing row 501 `Handbook` was rejected. The production paged helper made exactly the expected reads at offsets/limits `[0,500]` and `[500,500]` (`supabase/functions/indexing-v3-agent/behavior.ts:82-109`). The real worker calls that helper with ordered `chunk_index, id` SQL and its supplied limit/offset (`supabase/functions/indexing-v3-agent/index.ts:1800-1811`).
- **Review-4 corrections remain closed.** The last effective activation owner retains complete P02 document/artifact/job locks, exact staging-owner checks, acquisition/P02 digest binding, exact first/replacement lineage, and old-exit-before-new-entry atomicity. The effective event/fetch/stage/activation/transition/tombstone/unchanged owners retain one canonical source lock and latest monotonic authority. Resume still rechecks the complete persisted acquisition identity. Historical owner-null catalogue publications still require exact active-version/P02 eligibility or are re-owned to the real prior approval owner. The explicit lifecycle state machine and service-role-only grants remain the final definitions.
- **Cache correction remains closed.** Every real local/shared search/answer hit reads lifecycle authority before access and after candidate validation; epoch failure bypasses cache even when the document stamp is memoized.
- **Earlier Task 3 findings remain closed.** Recovery evidence and both receipt inputs are strict and canonical-digest verified; clocks are finite, ordered, freshness-bound, and future-skew bounded; every layer is exact-project/operation/shared-basis/isolated-target/digest bound; activation and rollback identities are distinct and monotonic; evidence references are structured opaque values rejecting unknowns, schemes, URLs, credentials, sensitive labels, and raw provider content. Rollback replays complete readiness at immutable activation time without falsely requiring evidence to remain freshly aged later. Retained prior resource identity remains mandatory, reconstruction remains rejected, and site-release/document-generation identities remain typed and distinct.
- The offline verifier remains import-safe, content-free at success/error boundaries, and indexed in `docs/scripts-index.md`. It does not import the prohibited recovery-status script. No destructive generation-commit path was rewired or represented as reversible. Migration security/grants and retrieval/cache fail-closed behavior remain unchanged by the bounded correction.
- Highest residual risk is environment acceptance: both lifecycle migrations remain source-only and were not replayed against a database, and no real worker/document/provider path was exercised. This does not reduce the offline spec/quality verdict for the requested provider-free slice.

## Reviewed range and artifact identity

- Task: `P05/ingestion/task-3`, correction review attempt 6 by the same independent reviewer.
- TASK_BASE: `62adef3b97906f6164f3d568712141dd9cd4117d`.
- TASK_HEAD: `3d528b6d3214efb56c649b38222ad86def0d2984`.
- HEAD and merge base resolved exactly. The immutable range contains `c0f09a27e`, `48ca64361`, `866944e12`, `ad2c90c0a`, `8a6184130`, `6680b4f9a`, and `3d528b6d3`; 21 files, 3,874 insertions, and 64 deletions.
- Canonical full-range package `P05-ingestion-task-3-review-6.diff`: supplied and verified SHA-256 `98d90145c5a43f4cf7aab8b33b04e60f666b638ef830c4ab94ff05dc248ada7a`; the complete 5,416-line package/range was reviewed.
- Final implementer report: supplied and verified SHA-256 `f866fb1fb691b16f7e890dabb833f1e8a7c3abd4e3b4a83c4714c4cb86a70c44`; all 363 lines were read.
- Prior review-5 report: supplied and verified SHA-256 `46194fed9ad5e2e58247ca1784cd38f21d5a33e623ad1bdb2d407195869877e8`.
- Immutable Task 3 brief: supplied and verified SHA-256 `fd3774d84e4e259f820ea35619c5dfb17b314cbf02cad16b09eb1e963ca17614`.
- The complete canonical range, governing plan/spec, prior findings, accepted P02/P05 owners, last effective SQL definitions, real CLI/worker/cache callers, migration security/grants, and correction tests were reviewed. Working-tree content outside the canonical package was ignored as review authority.
- `npm run ledger:lookup -- 3d528b6d3214efb56c649b38222ad86def0d2984 --scope "P05/ingestion/task-3 SDD review-6"` returned `NOT REVIEWED at this HEAD and scope`. No ledger record was appended because this controller-owned untracked SDD report is the requested review record.

## Commands and evidence

- Read-only Git resolution, status, merge-base, ordered log, range inventory/numstat, package line count, and SHA-256 verification — exact base/head/range resolved and every supplied artifact hash matched.
- Pure exact-head TypeScript probe through the repository `tsx` binary with only synthetic values — all five semicolonless references failed closed at the trusted-page and actual worker helper boundaries; the exact 499/500/501 page edge returned protected with a 256-character carry and reads at offsets 0 and 500. An initial probe harness did not execute because top-level await is unsupported by the binary's CJS eval mode; wrapping the identical probe in an async IIFE succeeded.
- `node scripts/run-vitest.mjs run tests/public-source-serving-lifecycle.test.ts tests/public-source-acquisition.test.ts tests/indexing-v3-agent.test.ts tests/rag-cache-invalidation.test.ts tests/function-grants.test.ts` — PASS; 5 files and 74 tests passed. Expected negative-fixture diagnostics from `tests/function-grants.test.ts` were printed while the suite passed.
- Mandatory literal `node scripts/run-vitest.mjs run tests/recovery-readiness-evidence.test.ts tests/reindex-pipeline.test.ts` — PASS by an exact-content reused gate receipt from `2026-08-23T22:49:30.433Z`; explicitly a reused receipt, not a fresh execution. The final implementer run reported 2 files and 62 tests passed.
- `npm run typecheck` — PASS by an exact-content reused gate receipt from `2026-08-23T22:49:40.388Z`; explicitly a reused receipt, not a fresh execution.
- `npm run check:migration-role` — PASS; active hosted tooling uses the expected role and immutable applied history is unchanged. No migration was applied or replayed.
- `npm run check:function-grants` — PASS; all 34 public security-definer functions are revoked from PUBLIC and none is reopened to PUBLIC/anon.
- Full-range and correction-only `git diff --check` — PASS.
- Broad repository suites, browser checks, provider/hosted gates, schema replay, and live recovery/source/document operations were not run. Focused selectors, distinct static gates, full source review, and synthetic probes were proportionate offline evidence.

## No-live and no-document statement

No provider, network, Supabase, database, Storage, migration application/replay/status, recovery, PITR, restore-drill, cleanup, queue, worker execution, ingestion, reindex, actual-document or real-source parsing/processing, corpus, activation, rollback, deployment, hosted CI, GitHub, push, PR, or external operation was run. No actual document, source payload, provider output, backup, Storage object, or database record was read or processed. Verification used only the immutable repository package/range and explicitly synthetic local values and rows. `scripts/supabase-recovery-status.ts` was not read or executed. No product file was edited; this report is intentionally uncommitted and unstaged.

SPEC_VERDICT: PASS

QUALITY_VERDICT: PASS
