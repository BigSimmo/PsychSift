# P05 ingestion Task 3 review 10 report

## Findings

### 1. P1 — a raw ampersand starts a speculative entity parse that discards protected-name characters on failure

Every `&` starts `EntityDecoder` (`supabase/functions/_shared/public-source-policy.ts:233-237`). While the decoder is active, input characters are withheld from canonical matching; if it later returns `0` for an invalid named reference, the scanner emits only one boundary and reprocesses only the final mismatching character (`:112-124`). All earlier tentative characters have already been consumed and cannot reach the protected-pattern automata.

Exact synthetic probes used the production one-shot matcher, `evaluateTrustedPageContent`, and the real worker paging owner with one character per page. `Health&direct`, `Therapeutic&Guidelines`, and `Australian&Medicines&Handbook` all returned `null` from `forbiddenPublicSourceIdentity`, `false` from `scanProtectedPublicSourceChunkPages`, and `accepted` from the trusted-page gate. The standards decoder preserves these invalid references literally, and the preceding canonical contract normalizes their raw ampersands as punctuation: its compact results are `healthdirect`, `therapeuticguidelines`, and `australianmedicineshandbook`. The first and third are exact protected patterns and the second contains the governed singular `therapeuticguideline` pattern.

This is not merely helper parity: trusted acquisition calls the matcher before returning accepted retained main text (`src/lib/public-source-acquisition.ts:668-692`), while the actual worker calls the paged scanner before provider/artifact work (`supabase/functions/indexing-v3-agent/index.ts:1795-1815`). A retained raw ampersand therefore bypasses both independent policy gates and can admit protected Healthdirect/eTG/AMH content, contrary to the programme's pre-storage/pre-provider stop condition.

Smallest proof/fix: add the three exact raw-ampersand cases through trusted-page and actual-worker tests. Preserve invalid character-reference text semantics without retaining an unbounded source string: use a bounded/finitely branched tentative entity state whose raw matcher branch can be committed when decoding fails (or conservatively fail closed on an invalid entity in a protected-prefix context). Do not consume tentative named-reference characters irreversibly before validity is known.

### 2. P1 — invalid tag-open text suppresses the remainder of a protected identity

The lexical scanner treats every `<` as `TagOpen` and emits a boundary (`public-source-policy.ts:228-231`). `TagOpen` then treats any next character other than `!`, quote, or `>` as the start of a tag (`:203-209`), although HTML only enters a start/end tag for the corresponding valid tag-open syntax. If no later `>` appears, `finish()` does not replay or canonicalize the suppressed characters (`:140-155`).

The exact retained-main-content fixture `<main>Health< direct</main>` isolates `Health< direct` before scanning. That visible text should canonicalize to `healthdirect`; it contains no completed tag, and the prior complete-input `<[^>]*>` rule does not remove it. Nevertheless, the production one-shot matcher returned `null`, the one-character-per-page worker scan returned `false`, and `evaluateTrustedPageContent` returned `accepted` with the protected marker still present in `mainText`.

Smallest proof/fix: add `<main>Health< direct</main>` to the trusted-page and actual-worker matrices. In `TagOpen`, enter tag/comment suppression only for valid HTML tag/declaration syntax; otherwise emit `<` as a boundary and reprocess the following code point as text. Finalization must also resolve any unfinished speculative lexical state conservatively rather than silently dropping visible text.

## Correction and prior-finding disposition

- **Attempt-9 split-entity persistence finding: closed.** The actual worker now carries one incremental scanner across every ordered row/page. Three-page named, numeric, and spaced-acronym cases where the entity resolves on page 2 and the protected suffix completes on page 3 all return the same protected identity as the complete one-shot matcher.
- **Phase-review-6 unbounded lexical-state and Deno findings: closed.** Ten-thousand-leading-zero numeric references, long named references, 10,000-character quoted tags, comments containing an internal `>`, and many-page named/numeric continuation all completed with fixed primitive-only snapshot shape and no source strings. The actual `indexing-v3-agent/index.ts` passed Deno 2.9.4 checking with a regenerated disposable cache-only lock followed by an exact frozen check under refused-loopback proxy settings.
- **One-shot/worker parity: structurally PASS but unsafe in Findings 1–2.** Both production paths share the same scanner and returned identical results for all positive/negative matrices. Fullwidth NFKC letters, punctuation plus zero-width controls, compact protected patterns, and exact `eTG`/`AMH` token boundaries behaved correctly. Prefix/suffix forms `xetg`, `etgx`, `xamh`, and `amhx` remained allowed; standalone boundary-delimited forms were rejected.
- **Boundedness and diagnostic privacy: PASS.** After numeric input spanning more than 10,000 one-character pages and after long entity/tag/comment inputs, `snapshot()` retained the same twelve keys and only numbers/booleans; serialized size remained 264–265 bytes. Searches found no content/state logging in either scanner or paging owner; the only scanner error is the constant `protected_identity_scanner_finished`.
- **Dependency/runtime surface: PASS.** `entities@8.0.0` remains the direct production resolution and the transitive parse5 resolution; npm installed-lock parity passes. The correction changes no manifest or lock file. Its public ESM decoder imports work in Node 24/Vitest and the actual Deno entrypoint check passed offline.
- **All other Task 3 findings remain closed and unchanged.** Strict receipt parsing/canonical digests; finite ordered fresh clocks; exact recovery layer/project/operation/basis/target/digest binding; distinct monotonic receipt identities; opaque-reference privacy; historical activation-time recovery replay; retained-resource rollback; typed site/document separation; no reconstruction/destructive claim; transactional lifecycle/P02 locks, replacement and lineage; source authority and full acquisition resume; serving eligibility/state machine; cache pre/post-hit authority; URL privacy; grants; and verifier import/error privacy are untouched by the three-file correction and retain the preceding passing evidence.
- Highest residual environment risk remains source-only acceptance: no hosted edge bundle, migration replay, provider, real source/document, worker, or recovery operation was exercised.

## Reviewed range and artifact identity

- Task: `P05/ingestion/task-3`, correction review attempt 10 by the same independent reviewer.
- TASK_BASE: `62adef3b97906f6164f3d568712141dd9cd4117d`.
- TASK_HEAD: `de7714a5aa0a225f0d986071dbcc5eecf1505c58`.
- HEAD resolved exactly and the merge base with TASK_BASE is TASK_BASE. The ordered range contains eleven commits from `c0f09a27e` through `de7714a5`; 24 files, 4,337 insertions, and 69 deletions. The attempt-10 correction is 3 files, 430 insertions, and 93 deletions.
- Canonical full-range package `P05-ingestion-task-3-review-10.diff`: supplied and verified SHA-256 `672b7b624aeb0237ff631e35ec336e189d8071b577aeea19684acf323e08ddc7`; its header names the exact base/head and all eleven commits. It contains 5,978 lines, and `git apply --reverse --check` passes against TASK_HEAD.
- Final implementer report: supplied and verified SHA-256 `59c1b0072567cf4cc432752b71fd7e1a3dc03565a6d9ae37e7261e5b407d3116`; its complete cumulative report and final correction cycle were read.
- Prior Task 3 review-9 report: supplied and verified SHA-256 `4726aaa51fefaa1fda83a46b016ad98746e7638fffeaa1355551a51e14a0b669`.
- Phase-review-6 report: located and verified SHA-256 `c0ab623c08848a14656fe80bceef163b936fe5e4889ba9399a30be90662e5d9e`.
- Immutable Task 3 brief: verified SHA-256 `fd3774d84e4e259f820ea35619c5dfb17b314cbf02cad16b09eb1e963ca17614`.
- `npm run ledger:lookup -- de7714a5aa0a225f0d986071dbcc5eecf1505c58 --scope "P05/ingestion/task-3 review attempt 10"` returned `NOT REVIEWED at this HEAD and scope`. No ledger record was appended because this controller-owned untracked SDD report is the requested review record.

## Commands and evidence

- Read-only Git/hash/status/merge-base/log, package-header/inventory, full/correction stat, artifact-hash, and canonical reverse-apply checks — exact identities above; full-range and correction-only `git diff --check` passed.
- Independent production scanner/trusted-page matrix — FAIL as a product result for Findings 1–2: all three raw-ampersand protected identities and `Health< direct` returned one-shot `null`, paged-worker `false`, and trusted-page `accepted`. The same matrix passed NFKC/fullwidth, punctuation/zero-width, exact acronym boundary, long valid tag/comment/entity, unlimited numeric-leading-zero, and entity-resolution-on-page-2/suffix-on-page-3 cases.
- Many-page boundedness probe — PASS: more than 10,000 one-character pages retained constant primitive-only snapshot shape and 264–265-byte serialized state, with no input-derived string exposed.
- `node scripts/run-vitest.mjs run tests/public-source-acquisition.test.ts tests/indexing-v3-agent.test.ts` — fresh PASS, 2 files and 54 tests. Findings 1–2 are absent from the committed suite.
- `node scripts/run-vitest.mjs run tests/recovery-readiness-evidence.test.ts tests/reindex-pipeline.test.ts` — fresh PASS, 2 files and 62 tests.
- `npm run typecheck` — fresh PASS. `npm run check:maintainability-budgets` — PASS; the real worker remains 1,993/2,191 lines.
- `npm ls entities --all --json` and `npm run check:installed-lock-parity` — PASS; direct `entities@8.0.0`, 755 package locations, and 51,732 installed files match the npm lock.
- Direct `deno check --frozen --node-modules-dir=none supabase/functions/indexing-v3-agent/index.ts` first stopped on unrelated pre-existing full-workspace `deno.lock` drift. Using a disposable OS-temp lock, `deno check --lock=<temp-lock> --frozen=false --node-modules-dir=none ...` followed by the same command with `--frozen` passed under Deno 2.9.4 with HTTP/HTTPS/ALL proxies forced to refused loopback. No registry/network access or repository file mutation occurred.
- `npm run check:migration-role` and `npm run check:function-grants` — PASS; immutable hosted migration history remains unchanged and all 34 public security-definer functions remain closed to PUBLIC/anon.
- Broad repository/browser/provider/hosted gates, schema replay, live recovery, and real source/document operations were not run. They cannot close the deterministic offline blockers in Findings 1–2.

## No-live and no-document statement

No provider, registry, or external network call, Supabase, database, Storage, migration application/replay/status, recovery, PITR, restore-drill, queue, worker execution, ingestion, reindex, actual-document or real-source parsing/processing, corpus, activation, rollback, production cleanup, deployment, hosted CI, GitHub, push, PR, or other external operation was run. No actual document, source payload, provider output, backup, Storage object, or database record was read or processed. Verification used only the immutable repository package/range, installed/cache-resident dependencies, and explicitly synthetic in-memory strings/rows. `scripts/supabase-recovery-status.ts` was not read or executed. No product file was edited; this report is intentionally uncommitted, untracked, and unstaged.

SPEC_VERDICT: FAIL

QUALITY_VERDICT: FAIL
