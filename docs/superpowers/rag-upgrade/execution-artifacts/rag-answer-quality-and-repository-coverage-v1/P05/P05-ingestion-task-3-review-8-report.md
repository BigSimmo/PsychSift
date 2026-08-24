# P05 ingestion Task 3 review 8 report

## Findings

No P0-P2 finding was identified across the complete immutable Task 3 range.

## Phase-review-4 correction disposition

- **Valid named references encoding protected-identity letters: closed.** The shared owner now applies the public `entities@8` WHATWG `decodeHTML` implementation after the existing defensive numeric prepass, then NFKC and spaced/compact matching (`supabase/functions/_shared/public-source-policy.ts:1-78`). Exact `&afr;`, `&ifr;`, `&tscr;`, `&dd;`, and multi-code-point `&DifferentialD;` cases reconstruct the protected identities and are rejected.
- **Complete entity-category probe: closed.** Synthetic production-function probes covered semicolon-terminated named letters and whitespace, browser-compatible legacy semicolonless `&nbsp`, `&amp`, and `&not`, valid decimal/hex numeric references with and without semicolons, and zero/control/surrogate/out-of-range numeric values. Every protected case returned the expected identity, trusted-page `quarantine`, and worker `true`. Unknown or malformed names retain standards-compatible literal behavior rather than being invented as valid references.
- **Trusted-page and actual worker boundaries: closed.** Retained main HTML is checked before admission and decoded through the same owner for retained text (`src/lib/public-source-acquisition.ts:654-692`). The real worker invokes the shared matcher over ordered SQL pages before provider/artifact work (`supabase/functions/indexing-v3-agent/index.ts:1795-1815`; `supabase/functions/indexing-v3-agent/behavior.ts:71-109`). Focused regressions cover both consumers (`tests/public-source-acquisition.test.ts:442-481`; `tests/indexing-v3-agent.test.ts:73-157`).
- **Cross-page overlap: closed.** The exact 499/500/501 `Australian` / `Medicines` / `Handbook` case still rejects on page two with a bounded 256-character carry and reads `[0,500]`, `[500,500]`. Independent probes also split a named reference (`He&af` / `r;lthdirect`), a legacy semicolonless reference (`Health&nbs` / `pdirect`), and a numeric reference (`Health&#x6` / `4irect`) across the page boundary; each rejected on the second page with the same bounded read sequence.

## Dependency and runtime review

- `entities` is an explicit production dependency at `^8.0.0` in `package.json` and the package-lock root. `package-lock.json` resolves exactly `8.0.0`, preserves the published SHA-512 integrity and BSD-2-Clause licence, and removes only the former dev-only classification. `npm ls entities --all --json` shows one exact package satisfying both the new direct edge and the existing parse5 transitive edge; no new transitive package/version was introduced.
- `deno.lock` adds only its canonical semver-equivalent workspace declaration `npm:entities@8`; JSON parsing and the focused lock contract pass. The correction contains no unrelated lock refresh. `npm run check:installed-lock-parity` passes the exact installed npm tree: 755 package locations and 51,732 files.
- The imported `decodeHTML` symbol is a public `entities` export. The package is ESM, declares Node `>=20.19.0` (within the repository's Node 24 contract), and its runtime distribution contains no Node builtin, `process`, `Buffer`, or Deno-global dependency. Direct Node import/execution and `deno check --frozen --node-modules-dir=manual supabase/functions/_shared/public-source-policy.ts` both pass against the exact installed package. No jsdom/DOM runtime was added to the edge path.
- The repository-wide `--node-modules-dir=false` edge check was not treated as offline proof because the Deno global npm cache lacks `entities` and resolving it would require registry access. A hard-blocked probe forced all HTTP(S) traffic to refused loopback `127.0.0.1:1`; it confirmed the global-cache miss without any external request. Deno also refreshed unrelated stale package-workspace declarations despite `--frozen`; that exact diagnostic delta was inspected and reversed, restoring `deno.lock` byte-for-byte to immutable HEAD. Hosted/global-cache bundling therefore remains environment acceptance, not a passing claim.

## Full-range contract recheck

- The correction is exactly six files and 54 insertions/94 deletions: three dependency/lock files, the one shared policy owner, and two focused tests. Every recovery, receipt, reindex, lifecycle migration, acquisition implementation, cache, schema/type, CLI, documentation, grant, and real worker caller covered by review 7 is unchanged between `2e01a2efea1799d206d88422d33288f83b29ed60` and this head. The same reviewer carried forward the complete immutable review-7 inspection and exhaustively reviewed the new correction, final consumers, package inventory, and dependency/runtime surface.
- All earlier Task 3 findings remain closed: strict receipt parsing and canonical digest verification; finite, ordered, fresh and future-skew-bounded clocks; exact project/operation/shared-basis/isolated-target/layer-digest binding; globally distinct monotonic activation/rollback identities; structured opaque references rejecting unknowns, URLs/schemes, credentials/sensitive labels, raw output and secrets; activation-time recovery replay; exact retained prior resource; typed site/document separation; and rejection of reconstruction/destructive-commit claims.
- The final effective lifecycle authority still owns canonical source locks and monotonic latest authority, full stage/resume acquisition identity, complete P02 locks and exact approval/generation/state binding, first/replacement activation, atomic lineage and publication order, historical/future serving eligibility, explicit state machine, cache deletion/epoch bump, fixed search paths and service-role-only grants. Every real cache hit still requires fresh pre/post-hit lifecycle authority and bypasses on epoch failure.
- URL/privacy, identity `Content-Encoding`, source lock/latest authority, unchanged audit, acquisition resume, migration grants/security, offline verifier import/error privacy, and no-schema/live/provider coupling remain unchanged. The prohibited recovery-status script is not imported by the verifier.
- Highest residual risk is environment acceptance: the forward-only migrations remain source-only and unreplayed, and the Deno global-cache/hosted edge bundle plus real provider/source/document/worker/recovery paths were not exercised. This does not reduce the requested provider-free offline verdict.

## Reviewed range and artifact identity

- Task: `P05/ingestion/task-3`, correction review attempt 8 by the same independent reviewer.
- TASK_BASE: `62adef3b97906f6164f3d568712141dd9cd4117d`.
- TASK_HEAD: `14f921e831c9b4aa8df9c0b6a2f45cd4706b311a`.
- HEAD resolved exactly and merge base with TASK_BASE is TASK_BASE. The ordered range contains `c0f09a27e`, `48ca64361`, `866944e12`, `ad2c90c0a`, `8a6184130`, `6680b4f9a`, `3d528b6d3`, `2e01a2ef`, and `14f921e8`; 24 files, 3,882 insertions, and 65 deletions.
- Canonical full-range package `P05-ingestion-task-3-review-8.diff`: supplied and verified SHA-256 `17f34ac7cfef6bcfd3b9b4a9306b26aff2ace1beb0cf8370243e21566915ac9e`; its header names the exact range and nine commits. The complete 5,523-line package/range was reviewed, including every delta beyond the already-reviewed immutable attempt-7 range.
- Final implementer report: supplied and verified SHA-256 `8ccf6b57cc3fd3bd74d9b3990fe34dcc729dcc3772ec488b49d0ee209afaa312`; all 468 lines were read cumulatively by the same reviewer.
- Prior Task 3 review-7 report: supplied and verified SHA-256 `13123b1ab7ccccb11687f887f1abe7b3e67722aea71322d66b326a47a6b78be8`.
- Phase-review-4 report: located and verified SHA-256 `78dfc6931ac4d10772ec79ad3fefe1887e139db756611dccad7a6e96a31bcade`.
- Immutable Task 3 brief: supplied and verified SHA-256 `fd3774d84e4e259f820ea35619c5dfb17b314cbf02cad16b09eb1e963ca17614`.
- `npm run ledger:lookup -- 14f921e831c9b4aa8df9c0b6a2f45cd4706b311a --scope "P05/ingestion/task-3 immutable range review attempt 8"` returned `NOT REVIEWED at this HEAD and scope`. No ledger record was appended because this controller-owned untracked SDD report is the requested review record.

## Commands and evidence

- Read-only Git resolution, hash/header verification, status, merge-base, ordered log, full/correction inventory and stat, package line/file inspection, direct source/caller review, and local dependency metadata/licence inspection — all supplied identities matched and the canonical package lists exactly the 24 files in the Git range.
- Full-range and correction-only `git diff --check` — PASS.
- Exact synthetic production-function entity/page probes through the local `tsx` runtime — PASS for 22 named/legacy/numeric/invalid cases at both trusted-page and worker boundaries, plus four exact two-page boundary scenarios.
- Direct installed `entities` API probe — PASS: complete named references decode to their Unicode values, legacy semicolonless references follow text-mode browser rules, unknown names remain literal, and numeric references retain their intended output before shared normalization.
- `npm ls entities --all --json` — PASS; direct `entities@8.0.0` and parse5 use the same exact resolution.
- `npm run check:installed-lock-parity` — PASS; exact npm lock/install parity for 755 locations and 51,732 files.
- `deno check --frozen --node-modules-dir=manual supabase/functions/_shared/public-source-policy.ts` with external traffic blocked — PASS. The `--node-modules-dir=false` variant was intentionally hard-blocked from external traffic and reported the expected uncached-registry failure; it is recorded as unverified hosted/global-cache acceptance, not a product failure or pass.
- `node scripts/run-vitest.mjs run tests/public-source-serving-lifecycle.test.ts tests/public-source-acquisition.test.ts tests/indexing-v3-agent.test.ts tests/rag-cache-invalidation.test.ts tests/function-grants.test.ts` — fresh PASS, 5 files and 75 tests. Expected negative-fixture grant diagnostics were printed while the suite passed.
- `node scripts/run-vitest.mjs run tests/recovery-readiness-evidence.test.ts tests/reindex-pipeline.test.ts` — PASS by an exact-content reused receipt from `2026-08-23T23:24:47.551Z`; explicitly not a fresh execution.
- `npm run typecheck` — PASS by an exact-content reused receipt from `2026-08-23T23:25:02.030Z`; explicitly not a fresh execution.
- `npm run check:migration-role`, `npm run check:function-grants`, and `npm run check:maintainability-budgets` — PASS; immutable applied history is unchanged, all 34 public security-definer functions remain closed to PUBLIC/anon, `src/lib/rag/rag.ts` remains 4,362/4,362, and the worker remains 1,993/2,191.
- Broad repository/browser/provider/hosted gates, schema replay, live recovery, and real source/document operations were not run. Focused selectors, dependency/runtime proof, static gates, the full immutable source review, and synthetic boundary probes were proportionate evidence.

## No-live and no-document statement

No external provider or registry request left the host; the one Deno global-cache diagnostic was forced through a refused loopback proxy. No Supabase, database, Storage, migration application/replay/status, recovery, PITR, restore-drill, cleanup, queue, worker execution, ingestion, reindex, actual-document or real-source parsing/processing, corpus, activation, rollback, deployment, hosted CI, GitHub, push, PR, or other external operation was run. No actual document, source payload, provider output, backup, Storage object, or database record was read or processed. Verification used only the immutable repository package/range, installed dependency files, and explicitly synthetic local strings/rows. `scripts/supabase-recovery-status.ts` was not read or executed. The diagnostic lock rewrite was fully reversed and no product file remains edited; this report is intentionally uncommitted, untracked, and unstaged.

SPEC_VERDICT: PASS

QUALITY_VERDICT: PASS
