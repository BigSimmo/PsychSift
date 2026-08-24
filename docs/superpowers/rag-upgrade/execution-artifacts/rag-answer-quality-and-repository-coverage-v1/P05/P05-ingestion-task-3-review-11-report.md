# P05 ingestion Task 3 review 11 report

## Findings

### 1. P1 — committing a malformed lexical token consumes the starter of the next valid token

When an entity parse fails, `write()` commits `entitySpeculativeState` and advances past the current code point (`supabase/functions/_shared/public-source-policy.ts:254-279`). If that current code point is another `&`, it is never passed back through `consumeRawCodePoint()` and therefore cannot start the immediately following valid character reference. The markup state machine has the same handoff defect: invalid `TagOpen`/declaration/end-tag states call `commitInvalidMarkup()` (`:357-398`), whose implementation only copies the speculative matcher and returns to text mode (`:438-441`); a current `&` or `<` is not reconsidered as the next token starter.

Exact local synthetic probes show the consequence:

| Input                | Complete canonical interpretation                        | One-shot scanner | Trusted page | Real paged worker |
| -------------------- | -------------------------------------------------------- | ---------------- | ------------ | ----------------- |
| `Health&&#100;irect` | `Health&direct` -> `healthdirect`                        | `null`           | `accepted`   | `false`           |
| `Health&&amp;direct` | `Health&&direct` -> `healthdirect`                       | `null`           | `accepted`   | `false`           |
| `Health<<em>direct`  | invalid literal `<`, then valid `<em>` -> `healthdirect` | `null`           | `accepted`   | `false`           |
| `Health<&#100;irect` | invalid literal `<`, then `&#100;` -> `healthdirect`     | `null`           | `accepted`   | `false`           |

The worker probe used `scanProtectedPublicSourceChunkPages` with one input code point per page, so this is the actual worker boundary rather than helper-only behavior. `localPublicSourceContentIdentityVerdict` also classified each exact text/plain byte sequence as `accepted: true` / `contentIdentity: "clear"`; the production acquisition path uses that shared result after its same-matcher text/plain precheck (`src/lib/public-source-acquisition.ts:616-642`). Equivalent numeric-reference probes for `Therapeutic Guidelines` and `Australian Medicines Handbook` also returned `null`/`accepted`/`false`. These are adjacent malformed/valid lexical tokens, not incomplete legacy-entity checkpoints. They bypass the retained-main-content quarantine (`:668-692`), the text/plain pre-storage validation, and the shared real-worker paging guard at `supabase/functions/indexing-v3-agent/behavior.ts:99-113`, violating the required pre-storage/pre-provider protected-source stop condition.

Smallest proof/fix: add the four exact inputs above to the one-shot, trusted-page, and one-character-page worker matrices. When a speculative entity/markup token fails, commit only its literal interpretation and reprocess a terminating `&` or `<` through text mode so it may begin the next token; preserve the fixed matcher-state/checkpoint bound and avoid retaining source substrings.

## Correction and prior-finding disposition

- **Phase-review-8 legacy semicolonless-entity finding: closed.** `Health&ltdirect`, `Health&gtdirect`, `Healthd&notirect`, `TherapeuticGu&notideline`, and `AustralianMed&noticinesHandbook` all matched at the one-shot, trusted-page, and one-character-page worker boundaries. Negative controls `Health&notidirect` and `Heal&notithdirect` remained allowed.
- **Checkpoint selection and multi-codepoint behavior: PASS.** `Health&NotEqualTilde;direct` matched after the two-code-point entity, while the excess-letter control `Health&NotEqualTilde;idirect` and the two-letter `Health&fjlig;direct` control did not false-positive. The callback accumulates all decoded code units for one consumed-length checkpoint before committing it.
- **Bounded non-content state: PASS.** Checkpoints are a preallocated 64-entry array of finite matcher states. After synthetic inputs exceeding 100,000 characters, snapshots remained 872–874 bytes, exposed only numbers/booleans, and contained no input strings. Arbitrarily long numeric/entity/tag/comment cases completed without state growth or content diagnostics.
- **Previously reported malformed/valid/finish/page behavior: PASS for the recorded cases, but unsafe for Finding 1's adjacent-token shape.** Single malformed `Health&direct`, `Health&di!rect`, `Health<direct`, `Health<!--direct`, and `Health< direct` cases remain rejected; valid tags/comments/entities, long quoted tags/comments, entity resolution on page 2 with suffix completion on page 3, and the exact rows 499/500/501 bounded-carry edge remain green. `finish()` is idempotent and rejects writes after finalization.
- **Deno/runtime/dependency surface: PASS.** The actual `indexing-v3-agent/index.ts`, shared policy, and behavior module pass Deno 2.9.4 checking offline. `entities@8.0.0` remains the direct production resolution and installed-lock parity passes; the correction adds no new dependency surface.
- **All non-scanner Task 3 findings remain closed and unchanged.** Strict receipt parsing and digest verification; deterministic finite ordered/fresh clocks; exact project/resource/operation/shared-recovery-basis/isolated-target/input-digest binding; globally distinct monotonic immutable receipt identity; opaque-reference privacy; historical activation-time readiness replay; retained-resource rollback; typed site/document separation; no reconstruction/destructive claim; transactional lifecycle/P02 authority, atomic replacement/lineage, acquisition resume and source locks; exact first/replacement activation and historical eligibility; cache pre/post-hit epoch authority; URL privacy; grants; and verifier index/import safety are unaffected by the final three-file correction and retain the preceding passing evidence.
- Highest residual environment risk remains source-only acceptance. No hosted edge bundle, migration replay, provider, real source/document, worker, or recovery operation was exercised.

## Reviewed range and artifact identity

- Task: `P05/ingestion/task-3`, correction review attempt 11 by the same independent reviewer.
- TASK_BASE: `62adef3b97906f6164f3d568712141dd9cd4117d`.
- TASK_HEAD: `a1cc01c91db66d416f35d6d5cf1bae9b766061b8`.
- HEAD resolved exactly and the merge base with TASK_BASE is TASK_BASE. The ordered range contains thirteen commits from `c0f09a27e` through `a1cc01c91`; 24 files, 4,594 insertions, and 67 deletions. The final correction is 3 files, 120 insertions, and 10 deletions.
- Canonical full-range package `P05-ingestion-task-3-review-11.diff`: supplied and verified SHA-256 `d94e888bc9a30bd4bbadc9c7577a90b75fa4ce1999b78191998f8d89c4e6d9a1`; its header names the exact base/head and all thirteen commits. It contains 6,239 lines, and `git apply --reverse --check` passes against TASK_HEAD.
- Final implementer report: supplied and verified SHA-256 `e02284d5caae74655cfdbee315bea75752f61f1689c2e1698427a37cac3233fd`; its complete cumulative report and final correction cycle were read.
- Prior completed Task 3 review-10 report: verified SHA-256 `8e6efd73f10e59bbf746cf7c842863c88eeee3938d96039a574ff5f86666f7fb`.
- Phase-review-8 report: verified SHA-256 `9b06e9a48a1e7b2294ed6c8a93f20cde21f89f12af6531ca9cb23e5bd5e33923`.
- Immutable Task 3 brief: verified SHA-256 `fd3774d84e4e259f820ea35619c5dfb17b314cbf02cad16b09eb1e963ca17614`.
- `npm run ledger:lookup -- a1cc01c91db66d416f35d6d5cf1bae9b766061b8 --scope "P05/ingestion/task-3 review attempt 11"` returned `NOT REVIEWED at this HEAD and scope`. No ledger record was appended because this controller-owned untracked SDD report is the requested review record.

## Commands and evidence

- Read-only Git/hash/status/merge-base/log, package-header/inventory, full/correction stat, artifact-hash, canonical reverse-apply, and diff checks — exact identities above; full-range and correction-only `git diff --check` passed.
- Independent Node/tsx production differential matrix — the reported shorter legacy cases, `&not` excess, multi-codepoint positive/negative controls, and bounded-state probes passed. Finding 1's four adjacent-token inputs returned one-shot `null`, trusted-page `accepted`, local text/plain verdict `accepted`/`clear`, and real one-character-page worker `false` despite their canonical protected identities.
- `node scripts/run-vitest.mjs run tests/public-source-acquisition.test.ts tests/indexing-v3-agent.test.ts` — fresh PASS, 2 files and 56 tests. Finding 1's adjacent malformed/valid-token cases are absent from the committed suite.
- `node scripts/run-vitest.mjs run tests/recovery-readiness-evidence.test.ts tests/reindex-pipeline.test.ts` — fresh PASS, 2 files and 62 tests.
- `npm run typecheck` — fresh PASS.
- `npm run check:maintainability-budgets`, `npm run check:installed-lock-parity`, `npm run check:migration-role`, and `npm run check:function-grants` — PASS; the actual worker remains 1,993/2,191 lines, 755 installed package locations/51,732 files match the npm lock, immutable migration-role history remains unchanged, and all 34 public security-definer functions remain closed to PUBLIC/anon.
- `npm ls entities --all --json` — PASS; direct and parse5-transitive resolutions are both `entities@8.0.0`.
- With HTTP/HTTPS/ALL proxy routes forced to refused loopback, `deno check --no-lock --node-modules-dir=none supabase/functions/_shared/public-source-policy.ts supabase/functions/indexing-v3-agent/behavior.ts supabase/functions/indexing-v3-agent/index.ts` — PASS under Deno 2.9.4 from installed/cache-resident dependencies.
- Broad repository/browser/provider/hosted gates, schema replay, live recovery, and real source/document operations were not run. They cannot close the deterministic offline blocker in Finding 1.

## No-live and no-document statement

No provider, registry, or external network call, Supabase, database, Storage, migration application/replay/status, recovery, PITR, restore-drill, queue, worker execution, ingestion, reindex, actual-document or real-source parsing/processing, corpus, activation, rollback, production cleanup, deployment, hosted CI, GitHub, push, PR, or other external operation was run. No actual document, source payload, provider output, backup, Storage object, or database record was read or processed. Verification used only the immutable repository package/range, installed/cache-resident dependencies, and explicitly synthetic in-memory strings/rows. `scripts/supabase-recovery-status.ts` was not read or executed. No product file was edited; this report is intentionally uncommitted, untracked, and unstaged.

SPEC_VERDICT: FAIL

QUALITY_VERDICT: FAIL
