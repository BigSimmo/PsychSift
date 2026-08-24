# P05 ingestion Task 3 review 9 report

## Findings

### 1. P1 — a split entity is decoded for the current page but its canonical value is not persisted for later pages

`protectedPublicSourceChunkPage` correctly reparses `previousState.rawSuffix + rawPage` into `lexicalCanonical`, but uses that result only for the immediate boolean match (`supabase/functions/indexing-v3-agent/behavior.ts:106-109,124-127`). The persisted canonical state is instead built from the already-misparsed `previousState.compactSuffix` / `spacedSuffix` plus `canonicalProtectedSourceIdentity(rawPage)` in isolation (`:110-123`). When an entity starts on page 1 and ends on page 2, only `lexicalCanonical` sees its real decoded value. If page 2 then contains more than 256 removable raw characters, page 3 has neither the original token nor its decoded canonical character.

Exact schema-valid synthetic probes used three real 500-row worker pages and the production scanner:

- Named: page 1 ends `He&af`; page 2 starts `r;` followed by 499 period rows; page 3 is `lthdirect`.
- Numeric: page 1 ends `Health&#x6`; page 2 starts `4` followed by 499 period rows; page 3 is `irect`.
- Spaced acronym: page 1 ends `e&ts`; page 2 starts `cr;` followed by 499 zero-width rows; page 3 is `G`.

For all three, the complete shared matcher returned `true` and the whole concatenated identity resolved respectively to `healthdirect`, `healthdirect`, and `etg_complete`. The paged production scanner returned `false` after reads `[0,500]`, `[500,500]`, `[1000,500]`; none of the three pages reported a hit. After page 2, the persisted compact suffixes were the literal partial-token spellings `heafr`, `health4`, and `etscr`, while the correct decoded values existed only in the discarded page-2 lexical result.

This leaves the actual worker backstop bypassable even though upstream whole-content acquisition rejects the same content. The real worker calls this paged owner before provider/artifact work (`supabase/functions/indexing-v3-agent/index.ts:1795-1815`), so the Task 2 requirement for an independent worker recheck is not satisfied.

Smallest proof/fix: add the three-page named and numeric regressions above (plus the spaced-acronym case) to `tests/indexing-v3-agent.test.ts`. Persist the canonical result of resolved lexical overlap, or use a bounded incremental entity-decoder/pending-token state, rather than appending a page canonicalized independently. The state transition must replace the prior tentative partial-token contribution with the decoded character before raw eviction, while retaining the existing 64/64/256 bounds and no-content diagnostics.

## Correction and prior-finding disposition

- **Phase-review-5 raw-separator finding: closed narrowly.** Plain `Health` + more than 256 periods + `direct` and plain `e` + removable zero-width characters + `TG` now pass whole and paged matching with bounded compact/spaced state. Finding 1 shows the generalized canonical-stream claim remains incomplete when a character reference itself crosses the preceding page boundary.
- **Named/numeric/legacy decoding: PASS outside Finding 1.** Complete semicolon-terminated named references, browser-compatible legacy semicolonless references, valid decimal/hex references with or without semicolons, and invalid/control/surrogate/out-of-range values still normalize correctly through trusted-page and worker helpers. Two-page split named/numeric references pass because the raw lexical window still contains the token and final identity on the same page.
- **Boundedness/privacy: PASS.** Independent probes observed raw/compact/spaced state bounded to 256/64/64 characters across many short rows. `streamState`, raw suffixes, and canonical suffixes occur only in the pure helper/scanner and focused tests; the real worker consumes the final boolean and does not serialize content state into diagnostics.
- **Dependency/runtime: PASS and unchanged.** `package.json`, `package-lock.json`, and `deno.lock` are byte-identical to reviewed attempt 8. The already-reviewed direct `entities@8.0.0` production resolution, npm/Deno workspace parity, BSD-2-Clause licence, public ESM import, Node 24 compatibility, frozen/manual Deno compatibility, and absence of a jsdom/Node-builtin runtime surface remain intact. No dependency or lock changed in this correction.
- **All other Task 3 findings remain closed.** Receipt strictness/canonical digests, finite ordered fresh clocks, exact recovery layer/project/operation/basis/target/digest binding, distinct monotonic receipt identities, opaque reference privacy, activation-time recovery replay, exact retained resource, typed site/document separation, no reconstruction/destructive claim, lifecycle/P02 locking and lineage, source authority, full acquisition resume, serving eligibility/state machine, cache pre/post-hit authority, URL/privacy, grants, and verifier import/error privacy are unchanged.
- Highest additional residual risk remains environment acceptance: lifecycle migrations are source-only and unreplayed, and no hosted edge bundle, real provider, source, document, worker, or recovery path was exercised.

## Reviewed range and artifact identity

- Task: `P05/ingestion/task-3`, correction review attempt 9 by the same independent reviewer.
- TASK_BASE: `62adef3b97906f6164f3d568712141dd9cd4117d`.
- TASK_HEAD: `2acf4fcd4b26cd533e610abe25ee2b1451ce3b28`.
- HEAD resolved exactly and merge base with TASK_BASE is TASK_BASE. The ordered range contains ten commits from `c0f09a27e` through `2acf4fcd`; 24 files, 3,997 insertions, and 66 deletions.
- Canonical full-range package `P05-ingestion-task-3-review-9.diff`: supplied and verified SHA-256 `e989a504163e43044071f8a32ed63252ec6f07145e4a5fbd77712159e70c0e40`; its header names the exact range and ten commits. The complete 5,639-line package/range was reviewed, including every delta beyond immutable attempt 8.
- Final implementer report: supplied and verified SHA-256 `83782e5a9cf716da8c048134ae7136b7432559be7eab01dc45d996626b5aa592`; all 499 lines were read cumulatively by the same reviewer.
- Prior Task 3 review-8 report: supplied and verified SHA-256 `4a5b5d0a8a64837fd1f4dcc1e7a8be6bb878dad8bc44db3e7eb01a861b13d7db`.
- Phase-review-5 report: located and verified SHA-256 `3d398fd1cd8a3695d8347edd899882cdd75935cbfb831fb59a60b8e50d8e289d`.
- Immutable Task 3 brief: supplied and verified SHA-256 `fd3774d84e4e259f820ea35619c5dfb17b314cbf02cad16b09eb1e963ca17614`.
- `npm run ledger:lookup -- 2acf4fcd4b26cd533e610abe25ee2b1451ce3b28 --scope "P05/ingestion/task-3 immutable range review attempt 9"` returned `NOT REVIEWED at this HEAD and scope`. No ledger record was appended because this controller-owned untracked SDD report is the requested review record.

## Commands and evidence

- Read-only Git/hash/status/merge-base/log checks, canonical package header/file inventory, full/correction stats, and implementer/prior/phase/brief hashes — all supplied identities matched.
- Full-range and correction-only `git diff --check` — PASS. Correction: 3 files, 133 insertions, 19 deletions.
- Exact three-page production scanner probe described in Finding 1 — FAIL as a product result: whole matching and exact identities were true, while every paged scan returned false with reads at offsets 0, 500, and 1000. The probe used only synthetic in-memory rows and emitted state only from the pure helper in the local review output.
- Independent two-page/bounded probes and focused committed tests — PASS for plain more-than-256 separator cases, many short rows, original 499/500/501 overlap, split named/numeric tokens whose suffix completes on page 2, spaced acronym continuation, and 256/64/64 state bounds.
- `node scripts/run-vitest.mjs run tests/public-source-serving-lifecycle.test.ts tests/public-source-acquisition.test.ts tests/indexing-v3-agent.test.ts tests/rag-cache-invalidation.test.ts tests/function-grants.test.ts` — fresh PASS, 5 files and 78 tests. Expected negative-fixture grant diagnostics were printed while the suite passed; the three-page composition in Finding 1 is absent.
- `node scripts/run-vitest.mjs run tests/recovery-readiness-evidence.test.ts tests/reindex-pipeline.test.ts` — PASS by an exact-content reused receipt from `2026-08-23T23:48:40.156Z`; explicitly not a fresh execution.
- `npm run typecheck` — PASS by an exact-content reused receipt from `2026-08-23T23:48:54.386Z`; explicitly not a fresh execution.
- `npm run check:migration-role`, `npm run check:function-grants`, and `npm run check:maintainability-budgets` — PASS; immutable applied history is unchanged, all 34 public security-definer functions remain closed to PUBLIC/anon, `src/lib/rag/rag.ts` remains 4,362/4,362, and the real worker remains 1,993/2,191.
- Dependency/lock files are unchanged from attempt 8, so successful exact installed-lock, `npm ls entities`, Node import, and frozen/manual Deno evidence was reused rather than rerun. The network-requiring Deno global-cache/hosted edge check remains unrun.
- Broad repository/browser/provider/hosted gates, schema replay, live recovery, and real source/document operations were not run. They cannot close the deterministic offline blocker in Finding 1.

## No-live and no-document statement

No provider, registry, or external network call, Supabase, database, Storage, migration application/replay/status, recovery, PITR, restore-drill, cleanup, queue, worker execution, ingestion, reindex, actual-document or real-source parsing/processing, corpus, activation, rollback, deployment, hosted CI, GitHub, push, PR, or other external operation was run. No actual document, source payload, provider output, backup, Storage object, or database record was read or processed. Verification used only the immutable repository package/range, installed dependency files, and explicitly synthetic in-memory strings/rows. `scripts/supabase-recovery-status.ts` was not read or executed. No product file was edited; this report is intentionally uncommitted, untracked, and unstaged.

SPEC_VERDICT: FAIL

QUALITY_VERDICT: FAIL
