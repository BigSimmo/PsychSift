# P07 phase review 2

## Finding

### 1. P2 - the phase correction bypasses the required final-task re-review chain

The executable correction at `97a13cfaa10bff4188f57137264c86e54b23291c` closes both Phase Review 1 product findings, but its acceptance evidence is not yet coherent with the governing SDD contract. A correction after phase review must reopen the final scheduled task, update that task's head, commit list, evidence and artifacts, obtain a fresh full-base PASS task review, then update `PHASE_END` and re-review the complete phase (`docs/superpowers/rag-upgrade/local/sdd-execution.md:73-77`).

The current draft receipt still records Task 2 head and phase end as `0499ee71363f43d1528028f059fdc4936d61e145`. Its last Task 2 review package covers only `f936f555a5d668b8a52b6ab735e5b14ad1acbb99..0499ee71363f43d1528028f059fdc4936d61e145`; there is no Task 2 review package/report covering the correction commit. `P07-phase-review-2.diff` correctly covers the complete phase range through `97a13cf`, and the phase-fix report accurately describes the correction, but neither substitutes for the required reopened final-task full-base review.

**Trigger:** attempt to finalize or accept the P07 receipt at corrected head `97a13cf` using the present task evidence.

**Expected:** Task 2 is reopened from immutable base `f936f555a5d668b8a52b6ab735e5b14ad1acbb99`, its head/commit list includes `97a13cf`, affected evidence and artifacts are updated, and a fresh task review passes both verdicts over that full range before the next full-phase review.

**Risk:** accepting the current chain would record a phase-end commit that no final-task reviewer assessed, weaken the correction/full-range invariant, and make the receipt inconsistent with the immutable task history that the acceptance checker is designed to prove. This is an evidence/process defect, not a defect in the corrected query-planning behavior.

**Required remedy:** reopen Task 2 as prescribed, produce the next uniquely named full-base Task 2 review package/report, update the draft receipt's Task 2 and phase-end identities, then generate a new complete `PHASE_START..PHASE_END` phase review package and request fresh phase review. Preserve both failed phase-review attempts in order.

## Verdicts and severity counts

SPEC_VERDICT: FAIL

QUALITY_VERDICT: FAIL

- P0: 0
- P1: 0
- P2: 1
- P3: 0

There is no remaining product-code finding in the reviewed range. Both verdicts fail because the phase package is not yet eligible for acceptance without the mandatory final-task correction review and coherent receipt identity.

## Phase Review 1 product-finding closure

Both earlier P2s are **CLOSED in executable behavior**:

- `comparisonSides` no longer promotes the first two analyzed medicines. It parses the explicit comparator relation and accepts only identifiable sides (`src/lib/rag/rag-query-plan.ts:109-136`). The two exact contextual-second-medicine regressions remain single, while explicit `clozapine versus lithium`, `clozapine and lithium`, and inpatient/community comparisons retain their bounded three-question decomposition (`tests/rag-query-plan.test.ts:35-82`).
- Every `clarification_required` return unconditionally carries `targetSiteDomains: []` and `siteDomainDecision: "none"` (`src/lib/rag/rag-query-plan.ts:170-182`). Domain-bearing required form/tool cases pin the open result, while anchored clozapine/WA form and tool decisions remain ordinary single plans with explicit hints (`tests/rag-query-plan.test.ts:115-158`). The ambiguity recognizer also covers service, medication and calculator required-object forms (`src/lib/rag/rag-query-plan.ts:69-106`).
- A narrow provider-free `tsx` probe at the exact head confirmed both original negative strings, explicit medicine and setting positive controls, all five unanchored required-object domain words, and both anchored ordinary controls. No query text left the local process.

The conservative single-plan result for unresolved comparison grammar is safe and preserves the original query; decomposition remains capped at four and deterministic.

## Complete combined-range reassessment

Apart from Finding 1's acceptance-evidence gap, the full `c933f33f6f8d74299f4b19199018ec98b8166223..97a13cfaa10bff4188f57137264c86e54b23291c` implementation remains compliant at source level:

- Query/ambiguity/coverage/fallback builders are pure, deterministic and bounded. Direct coverage still fails closed on missing eligibility, canonical gate rejection and unknown/absent corpus scope; fallback output remains total, typed-first, bounded and sanitized.
- `corpus_scope` and `site_content_domain` remain server-only. No raw query, subquestion, clarification, source content, provider detail or user/admin identifier enters client payloads, cache keys or telemetry.
- Runtime still finalizes clinical analysis once, performs no additional provider call, and derives the request-local query plan only after that finalized analysis. Legacy and shadow continue to serve the exact legacy variant/RPC/result identity; candidate variants remain pure diagnostics with no retrieval or cache write.
- Candidate/original variant budgets remain at four total with the existing three-text-RPC limit. Unsupported and adversarial short circuits retain their no-provider/no-retrieval behavior, and shadow planning remains abortable.
- Query-plan identity remains isolated behind `rag-query-plan-v1` and `rag-cache-v21`; variant text reaches persisted identity only through the existing privacy hash. Telemetry stays bounded and content-free.
- `src/lib/rag/rag.ts` remains 4,358 lines against the 4,362-line ceiling. The 19-file range contains no Task 3 served activation, new retrieval lane/RPC, source/ranking change, route/environment activation, provider retry, migration, ingestion, reindex, UI or live-system work.

The Review 1 assessment of Task 1 direct-evidence closure and Task 2 query-sensitive orchestration proof remains valid because the correction changes only `src/lib/rag/rag-query-plan.ts` and `tests/rag-query-plan.test.ts` and does not reopen those owners or invariants.

## Package, hashes, and agent independence

- Exact phase base/head: `c933f33f6f8d74299f4b19199018ec98b8166223..97a13cfaa10bff4188f57137264c86e54b23291c`; linear five-commit chain `e8dc922f` -> `f936f555` -> `0430adf7` -> `0499ee71` -> `97a13cfa`.
- Canonical 19-file full-range package `P07-phase-review-2.diff` reverse-applies cleanly at the exact head. SHA-256: `228A0EF0EF937D2C861AAD6E48D4EC3B65CDE7ED84932DD77447531F9B940A00`.
- Phase Review 1 report SHA-256: `E950D992105C35568348AB711170F9E8A6E979F3881FA04191E72059F2C1BAB3`.
- Phase-fix implementer report SHA-256: `B48676025FB76809282F4D6A10995A8D869A6D976571D4C5D46D36FAC399A12B`, matching the supplied identity and exact correction head.
- All unchanged receipt-recorded Task 1/Task 2 brief, implementer, review-package and review-report hashes remain coherent with the identities verified in Phase Review 1. Their accepted task reviews end at `f936f555` and `0499ee71`, respectively; that exact fact exposes Finding 1 rather than closing it.
- Agent identities remain independently disclosed: Task 1 implementer `/root/p07_query_contract_impl`, Task 1 reviewer `/root/p07_task1_review1c`, Task 2 implementer `/root/p07_shadow_query_impl`, Task 2 reviewer `/root/p07_task2_review1`, and this phase reviewer are distinct in their recorded roles. The phase fix reused the Task 1 implementer, but no independent final-task review of that fix exists yet.

## Checks and evidence boundary

- `npm run ledger:lookup -- 97a13cfaa10bff4188f57137264c86e54b23291c --scope "P07 full phase review attempt 2"` - `NOT REVIEWED at this HEAD and scope`.
- `Get-FileHash -Algorithm SHA256` - the canonical phase package, Phase Review 1 report and phase-fix report matched the identities stated above.
- `git apply --check --reverse P07-phase-review-2.diff` - PASS at exact head `97a13cf`.
- `git log --reverse <base>..<head>` and `git diff --name-status` - confirmed the exact linear five-commit, 19-file phase range.
- Narrow local provider-free query-plan probe - PASS for both corrected negative cases, explicit medicine/setting positive controls, open clarification domains, and anchored hints.
- Reused the correction report's focused RED/GREEN evidence: four intended RED failures with fourteen passes, then one file/eighteen tests passing; typecheck across 11,068 inputs; scoped format/lint/diff checks passing. No unchanged broad or provider/live gate was rerun.

No network/provider/OpenAI call, Supabase/database/Storage read or write, corpus/document access, migration, retrieval evaluation, reindex, activation, deployment, commit, push or PR action occurred. No product, test, plan, manifest, receipt, brief, fix report, or prior review artifact was edited. This report is the only write and must remain untracked and unstaged.
