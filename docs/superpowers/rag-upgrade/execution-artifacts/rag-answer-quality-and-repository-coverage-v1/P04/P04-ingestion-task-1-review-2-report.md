# P04 ingestion Task 1 review 2

## Findings

### 1. Important (P2) — valid rank-threshold failures are rejected as contradictory retrieval evidence

**Evidence:** `src/lib/ingestion-audit.ts:315-328` requires retrieval-set membership to equal the case's overall `passed` flag. That equivalence holds only for `document_not_retrieved`; it is false for the newly supported `document_rank_exceeded`, `source_role_mismatch`, `governance_block`, `case_timeout`, and `provider_failure` codes declared at `src/lib/ingestion-audit.ts:50-56`. A document may be retrieved at rank 3, fail an expected-rank-1 gate, and correctly remain present in `retrievedDocumentIdsByCase`.

**Trigger:** the reviewer supplied a case with `passed: false`, expected rank 1, actual rank 3, `failureCodes: ["document_rank_exceeded"]`, and the expected document present in the measured retrieval set. `buildIngestionAuditReport` rejected it as `contradictory retrieval evidence`.

**Expected:** consistency validation must be failure-code aware. `document_not_retrieved` requires absence; `document_rank_exceeded` requires presence and an actual rank worse than the expected rank; other codes need their own bounded invariants and must not be inferred from set membership alone.

**Risk:** legitimate measured retrieval underperformance cannot enter the audit, so the system cannot produce the required shadow-reindex decision for rank regressions even though the public type advertises that exact failure code.

**Smallest proof/fix:** add one valid and one invalid test per bounded failure-code/rank combination, then replace the `retrieved !== passed` equality with code-specific validation.

### 2. Important (P2) — document re-index audit accepts `clinical_kb_site` records as eligible

**Evidence:** `src/lib/ingestion-audit.ts:415-438` validates Australian sources specially but returns `true` for every other canonical corpus scope, including `clinical_kb_site` at line 431. The ingestion plan forbids classifying repository/site records as uploaded guidelines or sending them through document re-index (`2026-08-20-rag-ingestion-reindex.md:32`), and the trusted-ingestion design assigns `clinical_kb_site` exclusively to the repository-content registry/release path (`trusted-admin-document-ingestion-design.md:42`).

**Trigger:** changing only the synthetic document's `corpusScope` to `clinical_kb_site` returned `action: "no_change"`, `eligibleForShadowPlan: true`, and no reasons.

**Expected:** this document audit must reject/block the site-content corpus before any action classification. The accepted document scopes need an explicit allowlist rather than accepting every non-Australian canonical value.

**Risk:** later planners can route first-party site records through targeted document reprocessing or shadow document re-index, creating the parallel control plane the programme explicitly prohibits.

**Smallest proof/fix:** add a `clinical_kb_site` hostile fixture and make source-policy validation allow only the document-owned scopes and their scope-specific policy contracts.

### 3. Important (P2) — reviewed provenance evidence is not bound to its evidence digest

**Evidence:** `src/lib/ingestion-audit.ts:164-175` validates only the shape of `review.evidenceDigest`; it never recomputes or compares that digest with the reviewed expected provenance. `provenanceMismatch` at `src/lib/ingestion-audit.ts:441-446` compares expected with actual and the actual policy version with metadata, but ignores the review digest. The resulting expected baseline is self-declared in the same input rather than authenticated by the purported reviewed evidence.

**Trigger:** the reviewer changed both expected and actual parser versions from `parser-v1` to `parser-v2` while leaving the original review evidence digest unchanged. `auditDocument` returned `no_change` with no reasons.

**Expected:** the review digest must be deterministically derived from and verified against the complete expected provenance contract (including its contract version), or the audit must fail closed with missing/mismatched integrity evidence.

**Risk:** changing both sides of a parser/hash/validation baseline silently erases version drift while retaining a stale review identity, defeating the purpose of reviewed expected provenance.

**Smallest proof/fix:** define one canonical digest payload, verify `evidenceDigest` during parsing/audit, and add a regression that changes expected and actual together without updating the digest.

### 4. Important (P2) — the correction breaks the task's exact non-null action interface

**Evidence:** the immutable task interface requires `action: IngestionAuditAction` (`P04-ingestion-task-1-brief.md:51`) and the plan states the audit assigns one of four actions to every document (`2026-08-20-rag-ingestion-reindex.md:7,150`). The corrected export changes this to `IngestionAuditAction | null` at `src/lib/ingestion-audit.ts:67`, and blocked records receive null at line 532.

**Trigger:** every quarantined/tombstoned record now serializes `action: null`.

**Expected:** retain the exact four-value public interface while ensuring blocked records are non-actionable, for example by assigning a safe non-reindex action and keeping `diagnosticAction` separate, with summaries continuing to exclude blocked rows.

**Risk:** later planned consumers compiled against the named interface can require widening/null handling or mis-handle a value the approved contract says cannot occur. This is a cross-phase contract drift, not merely an internal representation choice.

**Smallest proof/fix:** restore the non-null action type, assert all four blocked dispositions remain excluded from actionable summaries, and keep any hypothetical repair diagnosis in the separate field.

## Prior finding disposition

| Review 1 finding | Attempt 2 disposition |
| --- | --- |
| Measured retrieval completeness/consistency | **Retained in narrower form.** Missing measurements and simple pass/presence contradictions now fail closed, but valid rank and other non-presence failure semantics are rejected (Finding 1). |
| Canonical source policy | **Retained in narrower form.** Canonical vocabularies and Australian protected/excluded cases are enforced, but the document audit admits `clinical_kb_site` (Finding 2). |
| Bidirectional/version-bound provenance drift | **Retained in narrower form.** Surplus counts, coverage version, and expected/actual provenance drift are covered, but reviewed provenance is not digest-bound (Finding 3). |
| Non-actionable blocked dispositions | **Safety behavior closed; interface regression opened.** Blocked records no longer enter actionable totals, but `action: null` violates the exact task contract (Finding 4). |
| Bounded privacy-safe failure codes | **Closed.** Free-form `failedExpectations` is rejected; only the bounded `failureCodes` enum is persisted, and hostile value tests cover it. |

## Package identity and reviewed scope

- Task key: `P04/ingestion/task-1`
- Immutable base: `be43d38daf9b22fdee11119a2e1509a951a04a20`
- Corrected head: `f1e3c99393494e76849d1f119a41e1ab1069e0db`
- Full commit list in order:
  1. `036f47075b7d9ac2f7905ad78a69ab2e1e6733d4`
  2. `f1e3c99393494e76849d1f119a41e1ab1069e0db`
- Canonical package: `docs/superpowers/rag-upgrade/execution-artifacts/rag-answer-quality-and-repository-coverage-v1/P04/P04-ingestion-task-1-review-2.diff`
- Package SHA-256: `51e3b2133e3f3eaab28cfcd34f9241db9649c37ab2d0c6c1cfe25f798f9faacf`
- Updated implementer-report SHA-256: `d6b239a7e39a8afc87423c96518b0fe9ecd18b244bfca3bd2289b88410519167`
- Full immutable range: eight files, 1,874 insertions. The only additional production owner is `src/lib/source-metadata.ts`, whose 16-line change exposes the existing canonical policy predicates; this is justified adjacent scope and does not duplicate the vocabularies.

I re-reviewed the complete original base-to-corrected-head package, not only the correction commit. No unrelated tracked change is present in the range.

## Verification evidence

### Implementer evidence reviewed

- Correction RED: literal `node scripts/run-vitest.mjs run tests/ingestion-audit.test.ts` -> 6 failed / 7 passed after hostile tests and before the correction.
- Final literal GREEN: the identical command -> 1 file / 13 tests passed.
- Expanded GREEN: `node scripts/run-vitest.mjs run tests/ingestion-audit.test.ts tests/source-coverage-registry.test.ts tests/check-indexing-contract.test.ts tests/indexing-coverage.test.ts tests/reindex-pipeline.test.ts` -> 5 files / 33 tests passed.
- Scoped Prettier, documentation index, maintainability budget, and `git diff --check be43d38daf9b22fdee11119a2e1509a951a04a20..f1e3c99393494e76849d1f119a41e1ab1069e0db` passed.

### Fresh exact-head typecheck

`npm run typecheck` passed on `f1e3c99393494e76849d1f119a41e1ab1069e0db`; `typecheck:internal` recorded a fresh successful receipt over 4,625 input files. This closes the previous admission-blocked exact-head compile residual.

### Deterministic CLI and import safety

The exact synthetic CLI was run twice to separate ignored reviewer outputs:

```text
node scripts/run-tsx.mjs scripts/audit-ingestion-corpus.ts --input tests/fixtures/ingestion/active-corpus-inventory.json --expected data/rag-expected-source-coverage.v1.json --output .local/rag-ingestion/reviewer-2-a.json
node scripts/run-tsx.mjs scripts/audit-ingestion-corpus.ts --input tests/fixtures/ingestion/active-corpus-inventory.json --expected data/rag-expected-source-coverage.v1.json --output .local/rag-ingestion/reviewer-2-b.json
```

Both returned 3 documents, 1 targeted reprocess, 0 shadow re-index, 0 blocked, and fingerprint `sha256:b999e5b1beb0442c9c4817757c24155dd28a9d027d3027c1631b744a74624c4f`. Both JSON files had identical SHA-256 `a852d196eea1a6246aa3bc340f48c01adb953dc341e6c28bc97877b7f77b4537`.

Import probe:

```text
node scripts/run-tsx.mjs -e "process.argv.push('--output','.local/rag-ingestion/reviewer-import-unexpected.json'); await import('./scripts/audit-ingestion-corpus.ts');"
```

Exited 0 and `reviewer-import-unexpected.json` did not exist. CLI import safety is closed.

### Reviewer hostile probe

```text
node scripts/run-tsx.mjs -e "import inventoryJson from './tests/fixtures/ingestion/active-corpus-inventory.json' with {type:'json'}; import coverageJson from './data/rag-expected-source-coverage.v1.json' with {type:'json'}; import {auditDocument,buildIngestionAuditReport,parseIngestionAuditInventory} from './src/lib/ingestion-audit.ts'; import {parseExpectedSourceCoverageRegistry} from './src/lib/source-coverage-registry.ts'; const inv=parseIngestionAuditInventory(inventoryJson); const cov=parseExpectedSourceCoverageRegistry(coverageJson); const base=structuredClone(inv.documents[0]); let rankExceeded; try { buildIngestionAuditReport({inventory:{...inv,documents:[{...base,mustPassCases:[{id:'synthetic-current-guideline-retrieval',passed:false,expectedDocumentRank:1,actualDocumentRank:3,failureCodes:['document_rank_exceeded']}] }],retrievedDocumentIdsByCase:{'synthetic-current-guideline-retrieval':[base.documentId],'synthetic-absent-source-case':[]}},expectedCoverage:cov}); rankExceeded='accepted'; } catch(error){rankExceeded=error instanceof Error?error.message:String(error)} const site=auditDocument({...base,metadata:{...base.metadata,corpusScope:'clinical_kb_site'}}); const staleDigest=auditDocument({...base,provenance:{...base.provenance,expected:{...base.provenance.expected,parserVersion:'parser-v2'},actual:{...base.provenance.actual,parserVersion:'parser-v2'}}}); console.log(JSON.stringify({rankExceeded,site:{action:site.action,eligibleForShadowPlan:site.eligibleForShadowPlan,reasons:site.reasons},unchangedReviewDigestWithChangedReviewedEvidence:{action:staleDigest.action,reasons:staleDigest.reasons,evidenceDigest:staleDigest.provenance.review.evidenceDigest}},null,2));"
```

Exited 0 and reproduced Findings 1-3 exactly: rank failure rejected as contradictory, site content eligible with `no_change`, and stale evidence digest accepted with `no_change`.

## Safety and residuals

- Only checked-in source code and synthetic metadata fixtures were read. No document, PDF, corpus payload, extracted text, OCR/parser output, real query, upload, embedding, index, provider, network, database/Supabase, hosted state, migration, re-index, activation, deployment, push, or PR action occurred.
- `--live-read` was not used.
- Determinism, CLI import safety, bounded privacy fields, exact-head compilation, formatting, documentation indexing, maintainability, and whitespace checks are green.
- The four findings above remain product/specification blockers; live/provider/hosted/reindex/production evidence remains intentionally unrun and outside P04.

## Verdicts

`SPEC_VERDICT: FAIL`

Measured retrieval semantics, document/site corpus ownership, reviewed provenance binding, and the exact exported action interface remain incomplete.

`QUALITY_VERDICT: FAIL`

The correction substantially improves fail-closed behavior and closes privacy, count-direction, coverage-version, blocked-summary, determinism, import-safety, and exact-head compile gaps. The reproduced remaining failures can still reject valid audit evidence or admit the wrong corpus, so the task is not yet safe to accept.
