# C02 core-ingestion tranche acceptance — 13 September 2026

C01-through-C02 is accepted at the local source, focused offline-test and canonical-schema replay boundary. U04/U05/U06 retain their earlier unit acceptances. This record closes the separate core tranche review and its corrections; it does not establish hosted readiness, migration-chain execution or ordinary Answer quality.

## Identity and canonical evidence

- Worktree: `C:/Users/joshs/.codex/worktrees/rag-local-build-20260822/Database`.
- Branch: `codex/rag-local-build-20260822`.
- Full tranche base: `d38dce7ba7fada4ab1fb4588799f400916118c81`.
- Correction base / accepted U06: `d3412a667ed1485029be99d7b0b4089e3e211d5e`.
- Accepted product: `b107d5916118308d0b4e16a36afe9e0798f8afaf`.
- Outside evidence directory, abbreviated O below: `C:/Users/joshs/Codex-Handoffs/Ingestion/Execution/20260907-continuation`.
- `O/C02-local-acceptance-manifest-1.json` binds 14 product files, 29 evidence records and the complete original-range review package. SHA-256: `88e25ec28af83e74581fdfe0093e370c4208968ed81f7a362acce07e82af7c51`.
- Canonical package: `docs/superpowers/rag-upgrade/execution-artifacts/rag-answer-quality-and-repository-coverage-v1/continuation-rag-source-ingestion-v1/C02/C02-final-original-range-review-1.diff`. SHA-256: `12a62e60d4013407922a122375c9bf3df7bb3258400db65e7c62166418e0aaed`. This known local artifact remains outside the staged product scope.

The immutable initial review package and every failed review/run remain preserved. `O/C02-evidence-map-1.md` records the initial evidence qualification at U06; its pending statements are historical and are superseded by this acceptance and the final review reports. Retained C01/U04/U05/U06 ancestry and original evidence hashes were checked rather than rediscovered or rerun indiscriminately.

## Findings and independent verdicts

| Finding | Correction and proof |
| --- | --- |
| C02-F1: rollback client and SQL authorization disagree | Use SQL's exact project/population fields; derive inverse transitions from the promotion receipt. Permit recovery of an immutable pre-expiry receipt on a later retry while preserving SQL refusal of expired first execution. Bind returned receipt time to both authorization bounds. Focused rollback cases pass. |
| C02-F2: positive projection acknowledgements are insufficiently validated | Summary compares all native clinical/source/model fields and exact timestamp instants while retaining SQL timestamp text. Deep-memory acknowledgements reuse the existing complete stored-row/native-output reconciliation. Realistic complete rows and digest-valid substitutions exercise the actual producer boundary. |
| C02-F3: promotion does not compare report and plan populations | Add fail-closed population-fingerprint equality before the future U10 technical gate in both migration and schema. Focused source contract passes. |
| C02-F4: drift manifest is stale | Regenerate from a clean, task-owned PostgreSQL 17 schema replay. Replay exposed CASE operand and qualified EXTRACT syntax defects; batch-correct those and invalid qualified COALESCE expressions in migration/schema. Successful replay and independent manifest reconciliation close the local gap. |

The independent reviewers used Sol High with bounded ownership and retained original-range inspection:

- `O/C02-ingestion-review-3.md`: Specification SOURCE PASS / Quality SOURCE PASS. Its addendum independently checks the final two test corrections and covers the clinical/provenance questions from the earlier projection review.
- `O/C02-schema-review-2.md`: Specification PASS at the full-original-range local source boundary / Quality PASS at local source and successful canonical-schema replay boundary.
- `O/C02-rag-review-2.md`: Specification SOURCE PASS / Quality SOURCE PASS for the RAG partition.

The Astra controller integrated the separate tranche verdicts, qualified evidence and owned every gate. Sol Medium handled bounded rollback/projection work; the projection correction escalated to Sol High after concrete shared-validator and timestamp gaps. A separate clinical-reviewer reuse attempt hit the session agent-thread limit; the independent ingestion reviewer assessed the same three evidence questions explicitly. No other agent's verdict is attributed to that reviewer.

## Executed verification

The reviewed restricted-discovery runner was reused unchanged. These are exact local equivalents with pinned inputs, not claims that a broad CLI suite ran.

| Command, run from the worktree | Actual result |
| --- | --- |
| `node scripts/gate-arbiter.mjs test` and `node scripts/gate-arbiter.mjs typecheck` | RUN; database scope does not defer. |
| `O/U04-launch-focused-gate-4.ps1 -ManifestName U04-focused-green-manifest-2026091357.json -Attempt U04-c02-focused-1` | Exit 1: 63 passed, 9 failed, 1,165 skipped across five files. The nine failures were a server-timestamp assertion and eight mocks failing before the intended acknowledgement boundary. |
| `O/U04-launch-focused-gate-4.ps1 -ManifestName U04-focused-green-manifest-2026091358.json -Attempt U04-c02-focused-2` | Exit 0: all nine corrected cases passed, 91 skipped; 2.71 seconds. Exact RPC rejection and no downstream mutation were asserted. |
| `O/U04-launch-focused-typecheck-29.ps1 -Attempt c02-focused-1` | Thirteen roots; zero diagnostics and zero input/I/O violations. All production inputs still match. Two subsequently corrected assertion/mock-precondition files were executed and reviewed but not recompiled. |
| `node scripts/run-heavy.mjs --npm-script drift:manifest --container clinical-kb-c02-d3412a-20260913e` | Exit 0; clean canonical-schema replay completed in 17 seconds, generated `supabase/drift-manifest.json`, and removed the task-owned container. |
| `git diff --check` and `git diff --cached --check` | Exit 0 on the product correction. |

`O/C02-final-test-accounting-1.json` reconciles all 72 selected cases: 63 unchanged passes plus nine corrective passes. This is composed passing coverage, not a retroactively green initial run. Both test attempts report zero discovery calls, zero unhandled errors and completed teardown; all 611 final pinned inputs were checked. The original replay attempts remain recorded: one coordinator refusal before SQL and three SQL parser failures before successful replay.

The replay used the cached immutable image `supabase/postgres:17.6.1.127@sha256:be60aee15997daca475b710b734bc6bfe52cd544dcd7e9fd2ff58210b6747d83`. It applied the canonical schema in disposable local infrastructure, not the ordered migration chain or a hosted project. The user's bounded local SQL permission is recorded in [execution authority](2026-09-07-execution-authority.md).

The local product commit used the process-scoped `SKIP_DOCS_SYNC_HOOK=1` override because the hook unconditionally enumerates unrelated untracked files, prohibited by the user. No repository hook or publishing safeguard changed. No new route, module file or script entry was introduced. This is not PR-readiness evidence.

## Preserved limits and next dependency

- Historical U02 offline evaluation remains **exit 1, four failed suites, 45 failed and 586 passed tests overall**. It is non-green and non-inheritable.
- Signing remains 159 passed / 2 failed; production readiness remains exit 1, with 2 passed / 5 warnings / 2 failed. These are unresolved and unwaived. No broad test, build, live drift or production-readiness rerun was added merely for reassurance.
- C01's historical Edge import suppression and uncompiled final test-assertion changes remain qualified. Existing index failures retain their historical outcomes; newer scoped U06 documentation evidence applies only to its named scope.
- Ordered migration-chain upgrades, role switching, concurrency, trigger/transaction rollback behavior, real/native document extraction, physical Storage/provider cancellation, clinical usefulness and hosted deployment remain unproved. No provider, real-document, operational worker, promotion, cleanup, deployment or publication action occurred.
- U10's technical receipt lookup remains a deliberate refusal. U07/U08 own pre-egress admission; U09/U10/U12 and the separate RAG programme retain fidelity, eligibility, resolution and serving responsibilities. P08A is superseded and the retrieval kernel remains default-off.

Before U07 integration, execute the existing Trusted Task 0 entry procedure: qualify ancestry and current source/dependency coverage, run only missing or changed proof, and retain all Edge and migration qualifications. U07 is unstarted; this acceptance does not claim its entry gate passed.

Use `O/remaining-programme-efficiency-20260913.md` before the next task and record applicable mechanisms in the sole controller ledger, `O/U04-live-checkpoint.json`. Continue with bounded smart routing, disjoint ownership, one gate owner, retained passing evidence, batched corrections and one canonical acceptance record. Optional runtime optimisations remain in the existing post-core deferral register.
