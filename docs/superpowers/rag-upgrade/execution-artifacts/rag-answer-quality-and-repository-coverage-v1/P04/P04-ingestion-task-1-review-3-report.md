# P04 ingestion Task 1 review 3

## Findings

No findings. I re-reviewed the complete immutable base-to-corrected-head range and independently reproduced the corrected boundary behavior. The four Important findings from review attempt 2 are closed without weakening the previously accepted privacy, determinism, or non-mutation boundaries.

## Prior finding disposition

| Prior finding | Attempt 3 disposition |
| --- | --- |
| Measured retrieval completeness and failure-code/rank consistency | **Closed.** `src/lib/ingestion-audit.ts:316-348` requires an explicit measurement for every document case, binds retrieval-set presence to actual-rank presence, applies code-specific absence/rank invariants, and rejects incompatible combinations. A reviewer probe accepted a present rank-3/expected-rank-1 `document_rank_exceeded` failure and classified the document `shadow_reindex` with `must_pass_retrieval_failed`. The literal tests exercise valid and invalid evidence for all six bounded failure codes (`tests/ingestion-audit.test.ts:185-268`). |
| Canonical source policy and `clinical_kb_site` ownership | **Closed.** `src/lib/ingestion-audit.ts:431-462` uses an explicit document-owned allowlist (`uploaded_local`, `australian_public`, and `international_supplementary`) before the existing scope-specific Australian catalogue checks. The reviewer probe changed only `corpusScope` to `clinical_kb_site` and received safe `action: "no_change"`, diagnostic `metadata_only`, `eligibleForShadowPlan: false`, `quarantine_review`, and `source_governance_invalid`. This preserves the separate repository/site registry control plane required by the ingestion plan. |
| Bidirectional/version-bound provenance drift and canonical digest recomputation | **Closed.** The canonical helper at `src/lib/ingestion-audit.ts:465-483` hashes a versioned payload containing the review contract version and complete expected provenance, and audit recomputes it. `provenanceMismatch` includes that result (`src/lib/ingestion-audit.ts:486-491`), while invalid review identity independently quarantines the row (`src/lib/ingestion-audit.ts:566-571`). The reviewer confirmed the checked-in synthetic digest recomputes exactly and that changing expected and actual parser versions together without updating the digest produces `provenance_mismatch`, safe `no_change`, diagnostic `targeted_reprocess`, and quarantine. Bidirectional count drift remains covered by `isMissing`/`isSurplus` and classification at `src/lib/ingestion-audit.ts:419-425,536-559`; coverage version and complete document evidence remain fingerprint-bound at lines 655-666. |
| Exact non-null blocked action plus non-actionable totals | **Closed.** `IngestionDocumentAudit.action` is again the exact non-null `IngestionAuditAction` contract (`src/lib/ingestion-audit.ts:63-70`). Blocked records serialize safe `action: "no_change"`, retain hypothetical repair intent only in `diagnosticAction`, and remain ineligible (`src/lib/ingestion-audit.ts:572-583`). The report filters to eligible rows before all four actionable totals (`src/lib/ingestion-audit.ts:646-654`). The reviewer exercised withdrawn, superseded, quarantined, and review-due rows together: all four used non-null `no_change`, all four actionable totals were zero, and `blocked` was four. |
| Bounded privacy-safe failure evidence | **Closed.** Only the six programme-owned codes are accepted (`src/lib/ingestion-audit.ts:50-56,177-184`); passed/failed and duplicate-code constraints are fail closed (`src/lib/ingestion-audit.ts:251-271`), and emitted codes are sorted rather than replaced with free text (`src/lib/ingestion-audit.ts:593-598`). Strict schemas continue to reject unknown/private content-bearing fields, and the checked-in fixtures contain synthetic metadata only. |

## Package identity and reviewed scope

- Task key: `P04/ingestion/task-1`
- Immutable base: `be43d38daf9b22fdee11119a2e1509a951a04a20`
- Corrected head: `c46aa6624ef57eae2aac3efb882ae98f4241985b`
- Full commit list in order:
  1. `036f47075b7d9ac2f7905ad78a69ab2e1e6733d4 feat(ingestion): classify document repair needs`
  2. `f1e3c99393494e76849d1f119a41e1ab1069e0db fix(ingestion): fail closed on audit evidence`
  3. `c46aa6624ef57eae2aac3efb882ae98f4241985b fix(ingestion): validate audit evidence semantics`
- Canonical package: `docs/superpowers/rag-upgrade/execution-artifacts/rag-answer-quality-and-repository-coverage-v1/P04/P04-ingestion-task-1-review-3.diff`
- Package SHA-256: `1462fbb8dbed2d9ae063f9e4fb1b06391a0ab5eb8422d67d4017cf1083c06856`
- Updated implementer-report SHA-256: `cc59bdbc17ac7024bf89c9426608ea0bf592f2c535af20b561d0cd8e56b1059d`
- Full immutable range: eight files and 2,061 insertions. `git apply --numstat` over the canonical package matched the same eight-file range. The correction commit is limited to `src/lib/ingestion-audit.ts`, its synthetic fixture, and its focused test. The only owner outside the original seven-file brief remains the justified 16-line canonical-validator exposure in `src/lib/source-metadata.ts`; there is no unowned implementation scope.

## Verification evidence

### Implementer evidence reviewed

- Review-2 correction RED: literal `node scripts/run-vitest.mjs run tests/ingestion-audit.test.ts` -> 6 failed / 10 passed, followed by a focused rank-bound RED of 1 failed / 15 passed.
- Final literal GREEN: the identical literal command -> 1 file / 16 tests passed.
- Expanded GREEN: `node scripts/run-vitest.mjs run tests/ingestion-audit.test.ts tests/source-coverage-registry.test.ts tests/check-indexing-contract.test.ts tests/indexing-coverage.test.ts tests/reindex-pipeline.test.ts` -> 5 files / 36 tests passed.
- Scoped Prettier, documentation index, maintainability budget, and `git diff --check be43d38daf9b22fdee11119a2e1509a951a04a20..c46aa6624ef57eae2aac3efb882ae98f4241985b` passed.

### Reviewer hostile probe

The reviewer used only parsed checked-in synthetic fixtures and pure library functions to exercise: a valid rank-threshold failure; a site-registry record presented to the document audit; expected/actual provenance changed together under a stale digest; canonical digest recomputation; and all four blocked lifecycle states in one report.

Observed result:

- valid rank-threshold failure -> accepted, `shadow_reindex`, `must_pass_retrieval_failed`;
- `clinical_kb_site` -> safe non-actionable `no_change`, diagnostic `metadata_only`, quarantine;
- stale reviewed provenance -> safe non-actionable `no_change`, diagnostic `targeted_reprocess`, `provenance_mismatch`, quarantine;
- checked-in review digest -> exact canonical recomputation match;
- four blocked lifecycle rows -> four non-null `no_change` actions, zero in every actionable total, four blocked.

### Exact-head typecheck

`npm run typecheck` passed freshly on `c46aa6624ef57eae2aac3efb882ae98f4241985b`; the repository recorded a `typecheck:internal` pass over 4,627 input files.

### Deterministic CLI and import safety

The exact synthetic CLI was run twice to separate ignored outputs:

```text
node scripts/run-tsx.mjs scripts/audit-ingestion-corpus.ts --input tests/fixtures/ingestion/active-corpus-inventory.json --expected data/rag-expected-source-coverage.v1.json --output .local/rag-ingestion/reviewer-3-a.json
node scripts/run-tsx.mjs scripts/audit-ingestion-corpus.ts --input tests/fixtures/ingestion/active-corpus-inventory.json --expected data/rag-expected-source-coverage.v1.json --output .local/rag-ingestion/reviewer-3-b.json
```

Both returned 3 documents, 1 targeted reprocess, 0 shadow re-index, 0 blocked, and fingerprint `sha256:08bf1d12e8b431f3ec2e243fcc595b743acb222cb4bb7593fd766ce0834a5083`. Both JSON files had identical SHA-256 `f7421f631f846fe6570f8c0614224c2f7c0b221797b5ea3f5f891c1a0f7d3c6b`.

Import probe:

```text
node scripts/run-tsx.mjs -e "process.argv.push('--output','.local/rag-ingestion/reviewer-3-import-unexpected.json'); await import('./scripts/audit-ingestion-corpus.ts');"
```

Exited 0 and `reviewer-3-import-unexpected.json` did not exist. The direct-entry guard at `scripts/audit-ingestion-corpus.ts:78-83` remains side-effect safe; `--live-read` still fails before either input read or output write (`scripts/audit-ingestion-corpus.ts:54-69`).

## Safety boundary and residuals

- Only checked-in source code and synthetic metadata fixtures were read. No document, PDF, corpus payload, extracted text, OCR/parser output, real query, upload, embedding, index, provider, network, database/Supabase, hosted state, migration, re-index, activation, deployment, push, or PR action occurred.
- `--live-read` was not used.
- The result is provider-free local contract evidence only. Live corpus, provider, hosted, re-index, and production acceptance remain intentionally unrun and outside this task; they are not acceptance requirements for the P04 read-only audit slice.
- No implementation residual or scope drift was found in the reviewed package.

## Verdicts

`SPEC_VERDICT: PASS`

The corrected range now satisfies the task's deterministic schema-v1 audit contract, measured retrieval and source-coverage semantics, canonical document ownership/policy boundary, reviewed provenance and version drift checks, exact four-action interface, blocked disposition behavior, privacy-safe output, and provider-free CLI boundary.

`QUALITY_VERDICT: PASS`

The implementation is fail closed at the reviewed evidence boundaries, keeps classifications and fingerprints deterministic, preserves import safety and output privacy, compiles at the exact head, is covered by focused and expanded synthetic tests, and introduces no unowned production behavior.
