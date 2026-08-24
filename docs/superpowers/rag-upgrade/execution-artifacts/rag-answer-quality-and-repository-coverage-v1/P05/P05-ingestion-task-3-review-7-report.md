# P05 ingestion Task 3 review 7 report

## Findings

No P0-P2 finding was identified across the complete immutable Task 3 range.

## Phase-review-3 correction disposition

- **Numeric character references encoding protected-identity letters: closed.** `decodeNumericHtmlCharacterReference` decodes finite valid decimal or hexadecimal scalar values and maps zero, surrogates, values above `U+10FFFF`, and unsafe C0/C1 controls to a conservative boundary (`supabase/functions/_shared/public-source-policy.ts:85-99`). The scanner consumes the complete digit run with an optional semicolon and feeds the result through NFKC plus the shared spaced/compact matcher (`:101-168`).
- **Trusted-page boundary: closed.** Acquisition checks the retained raw main-content HTML with the shared matcher before admitting it, then uses the same character-reference owner when producing retained text (`src/lib/public-source-acquisition.ts:654-692`). Exact synthetic probes quarantined decimal and hexadecimal letter encodings with and without semicolons for Healthdirect, Australian Medicines Handbook, and Therapeutic Guidelines.
- **Actual worker boundary: closed.** The real pre-provider worker preflight calls the shared matcher through ordered `chunk_index, id` SQL pages before any completion/provider work (`supabase/functions/indexing-v3-agent/index.ts:1795-1815`). Its production helper rejects the same decimal/hex encodings and invalid scalar values (`supabase/functions/indexing-v3-agent/behavior.ts:71-109`; `tests/indexing-v3-agent.test.ts:73-145`).
- **Invalid and out-of-range handling: closed.** Zero, unsafe control, surrogate, above-maximum, and excessively large decimal/hex values do not throw and become boundaries. Both semicolon-terminated and semicolonless synthetic forms failed closed at the trusted-page and worker helpers. A syntactically malformed `&#x;` has no numeric value and correctly remains literal rather than being decoded; benign malformed inputs did not throw.
- **Page overlap: closed.** The final 256 characters of the complete prior-carry/current-page stream are retained (`supabase/functions/indexing-v3-agent/behavior.ts:82-108`). The exact rows 499/500/501 `Australian` / `Medicines` / `Handbook` case rejected on page two with reads `[0,500]`, `[500,500]`. A second probe split `Health&#x6` / `4irect` across that same page boundary and also rejected on page two with bounded carry.

## Full-range contract recheck

- The correction is exactly three files and 48 insertions/1 deletion. Every recovery, receipt, reindex, lifecycle migration, acquisition implementation, cache, schema/type, CLI, documentation, and grant owner covered by review 6 is unchanged between `3d528b6d3214efb56c649b38222ad86def0d2984` and this head. The same reviewer carried forward the complete immutable review-6 inspection and exhaustively reviewed the correction, final callers, package inventory, and effective owners.
- All earlier Task 3 findings remain closed: strict parsing and canonical digest verification apply to both receipt inputs; clocks are finite, ordered, freshness-bound, and future-skew bounded; database/PITR/Storage/restore-drill layers bind the exact project, operation, shared recovery basis, isolated target, and input digests; activation/rollback identities are globally distinct and monotonic; and structured opaque references reject unknown fields, URLs/schemes, credentials/sensitive labels, raw output, and secrets.
- Rollback still replays the complete promotion-time readiness basis without requiring evidence to remain freshly aged later. It remains bound to the exact activation receipt, recovery digest, retained prior resource, and `retained-pointer` method; reconstruction and destructive-commit claims remain rejected. Site-release and document-generation resource identities remain typed and distinct.
- The final effective lifecycle migration still owns the canonical per-source lock/latest sequence, complete stage/resume acquisition identity, P02 locks and exact approval/generation/state bindings, first and replacement activation, atomic lineage/old-exit/new-entry ordering, historical/future serving eligibility, explicit lifecycle state machine, cache deletion/epoch bump, fixed search paths, and service-role-only mutation grants.
- Every real local/shared search/answer cache hit still reads lifecycle authority before access and after candidate validation; epoch failure bypasses cache. URL fragments/sensitive query keys, non-identity `Content-Encoding`, protected identities, cross-owner publication, stale authority, active work, and incomplete acquisition identity remain fail closed.
- The offline recovery verifier remains indexed, import-safe, operator-input-only, and content-free on success/error boundaries. It does not import the prohibited recovery-status script. No migration or live/provider/schema coupling was introduced by the correction.
- Highest residual risk is environment acceptance: the forward-only lifecycle migrations remain source-only and were not replayed against a database, and no real provider, source, document, worker, or hosted recovery path was exercised. This does not reduce the requested provider-free offline spec/quality verdict.

## Reviewed range and artifact identity

- Task: `P05/ingestion/task-3`, correction review attempt 7 by the same independent reviewer.
- TASK_BASE: `62adef3b97906f6164f3d568712141dd9cd4117d`.
- TASK_HEAD: `2e01a2efea1799d206d88422d33288f83b29ed60`.
- HEAD resolved exactly and merge base with TASK_BASE is exactly TASK_BASE. The ordered range contains `c0f09a27e`, `48ca64361`, `866944e12`, `ad2c90c0a`, `8a6184130`, `6680b4f9a`, `3d528b6d3`, and `2e01a2ef`; 21 files, 3,921 insertions, and 64 deletions.
- Canonical full-range package `P05-ingestion-task-3-review-7.diff`: supplied and verified SHA-256 `0a988e1c37ef25bfb659f8efc670b49d5225fd68da149a447f1e4205c2d6b76b`; its header names the exact base/head and eight commits. The complete 5,464-line package/range was reviewed, including fresh review of every delta beyond the already-reviewed immutable attempt-6 range.
- Final implementer report: supplied and verified SHA-256 `5b5bc8d766c9eaa853829eb20bfb0a774c4af618d1b1a4d3884c41229ef6e726`; all 412 lines were read.
- Prior Task 3 review-6 report: supplied and verified SHA-256 `724afb162221faa7afaab7239e60e3d885bdaf871ba089f33283a8044157b908`.
- Phase-review-3 finding report: located and verified SHA-256 `c1c7263e0b56a22dbaa9839c698771502eea9071e3b74e7c5178db24342c5f61`.
- Immutable Task 3 brief: supplied and verified SHA-256 `fd3774d84e4e259f820ea35619c5dfb17b314cbf02cad16b09eb1e963ca17614`.
- `npm run ledger:lookup -- 2e01a2efea1799d206d88422d33288f83b29ed60 --scope "P05/ingestion/task-3 immutable range review attempt 7"` returned `NOT REVIEWED at this HEAD and scope`. No ledger record was appended because this controller-owned untracked SDD report is the requested review record.

## Commands and evidence

- Read-only `git rev-parse`, `git cat-file`, `git merge-base`, ordered log, status, range/correction name-status/stat, package header/file inventory, line count, and SHA-256 checks — all supplied immutable identities matched; the canonical package lists exactly the 21 files in the Git range.
- Full-range and correction-only `git diff --check` — PASS.
- Exact synthetic production-function probes via the repository `tsx` runtime — PASS for decimal/hex letter references with and without semicolons, zero/unsafe-control/surrogate/out-of-range/oversized values, trusted-page quarantine, worker helper rejection, exact 499/500/501 paging, and a numeric reference split across the page boundary. An initial `.cmd -e` multiline harness was rejected by the wrapper before product imports; invoking the same local CLI directly succeeded. One exploratory expectation incorrectly classified no-digit `&#x;` as a numeric reference; inspection and the bounded follow-up correctly treated it as literal malformed text, while every required numeric case passed.
- `node scripts/run-vitest.mjs run tests/public-source-serving-lifecycle.test.ts tests/public-source-acquisition.test.ts tests/indexing-v3-agent.test.ts tests/rag-cache-invalidation.test.ts tests/function-grants.test.ts` — fresh PASS, 5 files and 74 tests. Expected negative-fixture diagnostics from `tests/function-grants.test.ts` were printed while the suite passed.
- `node scripts/run-vitest.mjs run tests/recovery-readiness-evidence.test.ts tests/reindex-pipeline.test.ts` — fresh PASS, 2 files and 62 tests.
- `npm run typecheck` — fresh PASS.
- `npm run check:migration-role` — PASS; active hosted SQL/tooling uses the expected role and immutable applied history is unchanged. No migration was applied or replayed.
- `npm run check:function-grants` — PASS; all 34 public security-definer functions are revoked from PUBLIC and none is reopened to PUBLIC/anon.
- `npm run check:maintainability-budgets` — PASS; `src/lib/rag/rag.ts` remains 4,362/4,362 and the indexing worker remains 1,993/2,191.
- Broad repository suites, browser checks, provider/hosted gates, schema replay, and live recovery/source/document operations were not run. Focused selectors, distinct static gates, full immutable source review, and synthetic boundary probes were proportionate evidence for this provider-free slice.

## No-live and no-document statement

No provider, network, Supabase, database, Storage, migration application/replay/status, recovery, PITR, restore-drill, cleanup, queue, worker execution, ingestion, reindex, actual-document or real-source parsing/processing, corpus, activation, rollback, deployment, hosted CI, GitHub, push, PR, or external operation was run. No actual document, source payload, provider output, backup, Storage object, or database record was read or processed. Verification used only the immutable repository package/range and explicitly synthetic local strings and rows. `scripts/supabase-recovery-status.ts` was not read or executed. No product file was edited; this report is intentionally uncommitted, untracked, and unstaged.

SPEC_VERDICT: PASS

QUALITY_VERDICT: PASS
