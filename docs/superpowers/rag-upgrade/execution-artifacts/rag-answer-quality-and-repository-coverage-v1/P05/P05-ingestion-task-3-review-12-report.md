# P05 ingestion Task 3 review 12 report

## Findings

### 1. P1 — an existing legacy-entity checkpoint still consumes an adjacent lexical starter

The new two-pass loop correctly reprocesses `&`/`<` after `consumed === 0`, but the valid shorter-entity branch still advances the input whenever `entityCallbackCheckpointWasExisting` is true (`supabase/functions/_shared/public-source-policy.ts:275-290`). An existing checkpoint means the decoded matcher state was recorded earlier; it does not mean the current mismatching code point was consumed by the entity. When that current code point is `&` or `<`, the checkpoint has only treated it as a literal boundary and the code skips the text-mode pass that must start the immediately adjacent entity/tag.

Exact synthetic production probes reproduced the bypass:

| Input                                  | Complete canonical interpretation               | One-shot | Trusted page | Text/plain verdict | Real paged worker |
| -------------------------------------- | ----------------------------------------------- | -------- | ------------ | ------------------ | ----------------- |
| `Healthd&not&#105;rect`                | `Healthd¬irect` -> `healthdirect`               | `null`   | `accepted`   | `clear`            | `false`           |
| `Health&lt&#100;irect`                 | `Health<direct` -> `healthdirect`               | `null`   | `accepted`   | `clear`            | `false`           |
| `Health&lt<em>direct`                  | decoded `<` plus valid `<em>` -> `healthdirect` | `null`   | `accepted`   | `clear`            | `false`           |
| `TherapeuticGu&not&#105;deline`        | `TherapeuticGu¬ideline`                         | `null`   | `accepted`   | `clear`            | `false`           |
| `AustralianMed&not&#105;cinesHandbook` | `AustralianMed¬icinesHandbook`                  | `null`   | `accepted`   | `clear`            | `false`           |

`scanProtectedPublicSourceChunkPages` received one code point per page, so the failure reaches the real worker paging owner. `localPublicSourceContentIdentityVerdict` classified the same text/plain bytes as accepted/clear, so the acquisition pre-storage boundary also fails. This composes the previously corrected shorter legacy match with the newly corrected adjacent-starter handoff and violates the programme's zero-tolerance protected-source stop condition.

Smallest proof/fix: add the first three inputs through the one-shot, trusted-page, text/plain, and one-character-page worker matrices. After a positive entity result that did not consume the current code point, reprocess a current `&`/`<` even when its decoded checkpoint already existed; the already-advanced checkpoint boundary can remain because an additional boundary is matcher-idempotent. Keep the two-pass cap and constant error so an impossible third interpretation continues to fail closed.

## Correction and prior-finding disposition

- **Task review-11 malformed-fallback finding: closed for the reported branch.** `Health&&#100;irect`, `Health&&amp;direct`, `Health<<em>direct`, and `Health<&#100;irect` now return `healthdirect`, trusted-page quarantine, protected text/plain verdict, and `true` from the real one-character-page worker. Repeated `&&&&` and `<<<<` variants also reject.
- **Two-pass progress/fail-closed bound: PASS.** Each fallback resets entity/markup mode before the second interpretation; the second pass can only begin a new token or consume text, so repeated starters advance one input code point at a time. A third pass throws the content-free constant `protected_identity_lexical_reconsume_limit`. Independent 100,000-character `&`, `<`, and alternating `&<` streams completed without recursion/state growth.
- **Legacy/entity/tag/page behavior: PASS outside Finding 1's intersection.** `Health&ltdirect`, `Healthd&notirect`, multi-codepoint `Health&NotEqualTilde;direct`, invalid `Health&direct`, unfinished `Health<direct`/`Health<!--direct`, numeric references, valid tags/comments, rows 499/500/501 carry, and entity-resolution/page-suffix cases remain green. The negative `Health&notidirect` control remains allowed.
- **Bounded non-content state: PASS.** After each 100,000-character repeated-starter stream, the fixed snapshot remained 872–874 bytes, exposed only numbers/booleans, retained no input string, and stayed within the 64-checkpoint bound.
- **Deno/runtime/dependency surface: PASS.** Deno 2.9.4 checks the actual worker entrypoint and shared policy/behavior offline. Direct `entities@8.0.0` resolution and installed-lock parity remain valid; the correction introduces no dependency surface.
- **All non-scanner Task 3 findings remain closed and unchanged.** Strict receipt parsing/digest verification; deterministic finite ordered/fresh clocks; exact project/resource/operation/shared-recovery-basis/isolated-target/input-digest binding; globally distinct monotonic immutable receipt identity; opaque-reference privacy; historical activation-time readiness replay; retained-resource rollback; typed site/document separation; no reconstruction/destructive claim; transactional lifecycle/P02 authority, atomic replacement/lineage, acquisition resume/source locks; exact first/replacement activation and historical eligibility; cache pre/post-hit epoch authority; URL privacy; grants; and verifier index/import safety are unchanged and retain prior passing evidence.
- Highest residual environment risk remains source-only acceptance. No hosted edge bundle, migration replay, provider, real source/document, worker, or recovery operation was exercised.

## Reviewed range and artifact identity

- Task: `P05/ingestion/task-3`, correction review attempt 12 by the same independent reviewer.
- TASK_BASE: `62adef3b97906f6164f3d568712141dd9cd4117d`.
- TASK_HEAD: `a3f197741d701caf25d0519b22a190578545a6cb`.
- HEAD resolved exactly and the merge base with TASK_BASE is TASK_BASE. The ordered range contains fourteen commits from `c0f09a27e` through `a3f197741`; 24 files, 4,666 insertions, and 67 deletions. The final correction is 3 files, 119 insertions, and 47 deletions.
- Canonical full-range package `P05-ingestion-task-3-review-12.diff`: supplied and verified SHA-256 `c6a5989c275ebcf3ebda6aeb9d4534a7960c06f1d77a3aee484517baa9251505`; its header names the exact base/head and all fourteen commits. It contains 6,320 lines, and `git apply --reverse --check` passes against TASK_HEAD.
- Final implementer report: supplied and verified SHA-256 `29cbdebb98230db0a17ad72c52eefb9aa1a8e89fa994a8a097965d98669d6524`; its complete cumulative report and final correction cycle were read.
- Prior Task 3 review-11 report: verified SHA-256 `fd80784537fe9671c84e7bc53d9a5785ee1d18dc3146fbc8596683e2a5c73173`.
- Prior phase-review-9 PASS report: verified SHA-256 `6d6b2eee643e38421c09124bf5c85aa9494dbb8dd9c8806bae620c4fe5c7d7ee`.
- Immutable Task 3 brief: verified SHA-256 `fd3774d84e4e259f820ea35619c5dfb17b314cbf02cad16b09eb1e963ca17614`.
- `npm run ledger:lookup -- a3f197741d701caf25d0519b22a190578545a6cb --scope "P05/ingestion/task-3 review attempt 12"` returned `NOT REVIEWED at this HEAD and scope`. No ledger record was appended because this controller-owned untracked SDD report is the requested review record.

## Commands and evidence

- Read-only Git/hash/status/merge-base/log, package-header/inventory, full/correction stat, artifact-hash, canonical reverse-apply, and diff checks — exact identities above; full-range and correction-only `git diff --check` passed.
- Independent Node/tsx production matrix — PASS for the four review-11 cases and repeated starters; FAIL as a product result for Finding 1's five valid-legacy-plus-adjacent-starter inputs at the one-shot, trusted-page, local text/plain, and real one-character-page worker boundaries.
- Repeated-starter/state stress probe — PASS for 100,000 `&`, 100,000 `<`, and 100,000 alternating `&<` characters: completion made progress, snapshot values remained primitive-only, serialized size stayed 872–874 bytes, and no input-derived diagnostics were emitted.
- `node scripts/run-vitest.mjs run tests/public-source-acquisition.test.ts tests/indexing-v3-agent.test.ts` — fresh PASS, 2 files and 58 tests. Finding 1's shorter-valid-entity plus adjacent-starter intersection is absent from the committed suite.
- `node scripts/run-vitest.mjs run tests/recovery-readiness-evidence.test.ts tests/reindex-pipeline.test.ts` — fresh PASS, 2 files and 62 tests.
- `npm run typecheck` — fresh PASS.
- `npm run check:maintainability-budgets`, `npm run check:installed-lock-parity`, `npm run check:migration-role`, and `npm run check:function-grants` — PASS; the actual worker remains 1,993/2,191 lines, 755 installed package locations/51,732 files match the npm lock, immutable migration-role history remains unchanged, and all 34 public security-definer functions remain closed to PUBLIC/anon.
- `npm ls entities --depth=0` — PASS, direct `entities@8.0.0`.
- With Deno update checks disabled and HTTP/HTTPS/ALL proxy routes forced to refused loopback, `deno check --no-lock --node-modules-dir=none supabase/functions/_shared/public-source-policy.ts supabase/functions/indexing-v3-agent/behavior.ts supabase/functions/indexing-v3-agent/index.ts` — PASS under Deno 2.9.4 from installed/cache-resident dependencies.
- Broad repository/browser/provider/hosted gates, schema replay, live recovery, and real source/document operations were not run. They cannot close the deterministic offline blocker in Finding 1.

## No-live and no-document statement

No provider, registry, or external network call, Supabase, database, Storage, migration application/replay/status, recovery, PITR, restore-drill, queue, worker execution, ingestion, reindex, actual-document or real-source parsing/processing, corpus, activation, rollback, production cleanup, deployment, hosted CI, GitHub, push, PR, or other external operation was run. No actual document, source payload, provider output, backup, Storage object, or database record was read or processed. Verification used only the immutable repository package/range, installed/cache-resident dependencies, and explicitly synthetic in-memory strings/rows. `scripts/supabase-recovery-status.ts` was not read or executed. No product file was edited; this report is intentionally uncommitted, untracked, and unstaged.

SPEC_VERDICT: FAIL

QUALITY_VERDICT: FAIL
