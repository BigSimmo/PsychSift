# P07 Retrieval Task 1 Review 2

SPEC_VERDICT: PASS

QUALITY_VERDICT: PASS

BLOCKER_STATUS: NONE - TASK 1 ACCEPTANCE UNBLOCKED

## Executive result

- Finding counts: P0 0, P1 0, P2 0, P3 0.
- Correction cycle 1 closes all three Review 1 findings. Canonical evidence-gate rejection and omitted eligibility/support decisions now fail closed; benefits/risks of one medicine remain a single plan while an identifiable inpatient/community pair decomposes; and the targeted retrieval-changing form ambiguity clarifies while its clinically and jurisdictionally anchored counterpart proceeds.
- Full-range reassessment found no new specification, correctness, clinical-safety, security, privacy, compatibility, maintainability, or test-quality defect.

## Immutable identity and scope

- Global task key: `P07/retrieval/task-1`.
- Exact reviewed range: `c933f33f6f8d74299f4b19199018ec98b8166223..f936f555a5d668b8a52b6ab735e5b14ad1acbb99`.
- Reviewed HEAD: `f936f555a5d668b8a52b6ab735e5b14ad1acbb99`, matching the current worktree HEAD.
- Linear commits: `e8dc922f7fe5cabf2f3c0a4a703acde99e9dc8ed` and `f936f555a5d668b8a52b6ab735e5b14ad1acbb99`.
- Canonical full-range package: `P07-retrieval-task-1-review-2.diff`; SHA-256 `E095D045A653346988744938A54CE150D38E1773DBAADC98CA04ACFB84160343`.
- Updated implementer report SHA-256: `0BD3EDD11BDAC20C4B597E102CDF885C2D3EC1CBA916B10D038F85A0181A42B4`.
- Review 1 report SHA-256: `15F2A795A3A33DBF7E82534A6FCA5D899CF5DEC53D185FAB4DC9EC1E4DEE9526`.
- Reviewed all nine changed files and 906 additions in the canonical full range against Task 1 of the retrieval-composition plan, the answer/Australian-sources design, the brief, the updated implementer report, and Review 1. This is a controller-owned governed task-artifact review, not a branch/PR/readiness review.

## Findings and remedies

No P0-P3 findings. No correction remedy is required before Task 1 acceptance.

## Review 1 closure

| Review 1 finding | Status | Independent adjudication |
| --- | --- | --- |
| P1: evidence-gate rejection and omitted eligibility could become direct/complete | CLOSED | `SubquestionEvidenceInput` now requires explicit eligibility and support decisions. Runtime omission creates empty eligibility or an absent status with bounded reason codes. Gate-applicable rejection empties `supportedEvidence`; only supported evidence contributes chunk IDs, conflict membership, or overall completion (`src/lib/rag/rag-coverage.ts:28-37,85-125,128-147`). The new negative cases pin rejected clozapine evidence and omitted eligibility (`tests/rag-coverage.test.ts:111-178`). |
| P2: benefits/risks fabricated comparison sides | CLOSED | Attribute-only sides are rejected before decomposition. The exact Review 1 input remains single, while identifiable non-medicine inpatient/community sides remain decomposed and ordered (`src/lib/rag/rag-query-plan.ts:109-137,187-207`; `tests/rag-query-plan.test.ts:44-69`). |
| P2: retrieval-changing form/jurisdiction ambiguity did not clarify | CLOSED | An unanchored required form/procedure/document request yields one material clarification with bounded dimensions. A medicine/workflow plus WA or care-setting anchor proceeds with a stated deterministic interpretation (`src/lib/rag/rag-query-plan.ts:69-106,158-184`; `tests/rag-query-plan.test.ts:91-114`). |

## Mandatory-focus adjudication

- Deterministic/provider-free maximum-four planning: PASS. No randomness or provider path was added; broad decomposition remains ordered and capped at four.
- Original retention and comparison identification: PASS. The original query remains present, comparison sides require bounded identifiable entities, and genuine non-medicine setting pairs are preserved.
- Material ambiguity and ordinary uncertainty: PASS for the Task 1 contracts and correction targets. The unanchored required-form case clarifies once; the anchored equivalent proceeds.
- Selected + eligible + directly cited coverage: PASS. Coverage intersects all three memberships, requires an explicit support decision, rejects absent decisions, and cannot promote a canonical gate rejection.
- Canonical corpus fail-closed behavior: PASS. Absent/unknown scope and a registry record mislabelled outside `clinical_kb_site` remain rejected; accepted scope/domain values are bounded.
- Typed/sanitized fallback mapping: PASS. Typed fields retain precedence, legacy text maps only to bounded codes, unknown text becomes `unknown`, and public output remains fixed rather than copying exceptions, hosts, secrets, query strings, or provider details.
- Server-only payload exclusion: PASS. `corpus_scope` and `site_content_domain` remain excluded by the exhaustive answer-client field policy and its focused regression.
- Telemetry/query privacy: PASS. Query/subquestion text remains request-local; no telemetry builder gained either string or another raw clinical payload.
- Compatibility: PASS. `SearchResult` additions remain optional and server-only. The new coverage input is not yet integrated into legacy runtime callers, so its stricter required decisions introduce no hidden existing-call compatibility break.

## Checks and evidence

Checks run during this review:

- Exact HEAD/base/status, commit chain, changed-file inventory, canonical full-range diff, plan/spec/brief/report, Review 1, and relevant existing-owner inspection.
- `npm run ledger:lookup -- f936f555a5d668b8a52b6ab735e5b14ad1acbb99 --scope "P07 retrieval task 1 canonical review 2"`: `NOT REVIEWED at this HEAD and scope`.
- SHA-256 verification for the canonical package, updated implementer report, and Review 1 report: values recorded above.
- Provider-free executable query-plan probe: exact outputs were single for benefits/risks, decomposed with the two expected sides for inpatient/community, clarification-required for the unanchored form, and single for the clozapine-monitoring-in-WA form.
- `git diff --check c933f33f6f8d74299f4b19199018ec98b8166223..f936f555a5d668b8a52b6ab735e5b14ad1acbb99`: PASS.

Reused, not rerun, correction evidence:

- Direct correction RED: 2 files, 4 expected failures and 14 passes.
- Identical correction GREEN: 2 files, 18 passes.
- Typecheck: PASS across 11,003 inputs.
- Scoped ESLint/Prettier and correction/full-range diff checks: PASS.
- Original Task 1 selector: 3 files, 15 passes; client-boundary selector: 1 file, 10 passes.

No focused suite was rerun because the recorded correction selector directly covers every Review 1 trigger and source inspection found no new concern needing a distinct check. No broad suite, build, browser, provider-backed RAG evaluation, OpenAI, Supabase/database/Storage, document/corpus, migration, reindex, hosted CI, deployment, commit, push, or PR action occurred. No ledger record was appended because the controller explicitly constrained this review's sole write to this untracked/unstaged report.

## Residual boundary

Task 1 acceptance is unblocked. The highest residual risk belongs to later integration: Task 2/4 callers must supply eligibility and direct-support decisions from the canonical source-role/retrieval owners rather than manufacture them locally. That future wiring is outside this Task 1 range and is not a defect in the reviewed contract.
