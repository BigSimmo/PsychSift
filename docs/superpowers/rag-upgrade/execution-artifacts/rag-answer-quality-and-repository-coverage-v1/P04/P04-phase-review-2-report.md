# P04 phase review 2

## Findings

### 1. Important (P2) — matching document IDs still allow reviewed expectations and governance metadata to be silently replaced

**Evidence:** the corrected adapter now checks `evidence.documentId === args.documentId` (`scripts/lib/indexing-audit-adapter.ts:94-100`), which closes the direct cross-document transplant from Task review 4. It then spreads the complete parsed evidence but overwrites all canonical source metadata and the expected/actual page and chunk counts (`scripts/lib/indexing-audit-adapter.ts:101-123`). No consistency check binds those replacement fields to the reviewed evidence, its unchanged expected-state digest, or its unchanged provenance review digest.

**Reproduction:** using the same checked-in synthetic document ID on both sides, I supplied the healthy reviewed evidence with expected pages/chunks `12/24`, `sourceRole: "local_guideline"`, and publisher `Synthetic authority`. The indexing-health wrapper supplied page/chunk expectations and actuals `10/20`, `source_role: "clinical_reference"`, and publisher `Different synthetic authority`. The adapter accepted it, replaced the reviewed expected counts and governance metadata, retained the original expected-state and provenance-review digests, and `auditDocument` returned `action: "no_change"`, `eligibleForShadowPlan: true`, and no reasons.

**Expected:** document-ID equality is necessary but not sufficient for evidence identity. The adapter should preserve reviewed expected values and overlay only actual measurements. Any supplied expected page/chunk values must match the reviewed expectations before adaptation. Canonical metadata that has no expected/actual representation must either match the reviewed metadata or fail closed for review rather than silently replace it while retaining the old review identity.

**Risk:** a stale or inconsistent same-document adapter envelope can erase a real page/chunk deficit and change publisher/source-role governance while producing a healthy, identity-bound audit fingerprint. That defeats audit-before-mutation and makes the new adapter a second unreviewed expectation/governance authority.

**Smallest proof/fix:** before overlay, compare `expectedPageCount` and the indexing-health expected chunk count with the reviewed expected counts, and compare normalized canonical metadata with the reviewed metadata. Preserve reviewed expected counts; overlay only current actual page/chunk measurements. Reject any disagreement that the current audit schema cannot represent. Add a regression reproducing the same-ID count/metadata substitution above and require a bounded fail-closed error (or an explicitly ineligible audit row), while retaining the valid matching-ID adapter case.

## Prior finding disposition

| Finding | Attempt 2 disposition |
| --- | --- |
| Non-index failures fabricated as retrieval misses/actionable re-index | **Closed.** Only `document_not_retrieved` and `document_rank_exceeded` can add `must_pass_retrieval_failed` (`src/lib/ingestion-audit.ts:534-549,593-610`). Provider/timeout evidence becomes incomplete integrity evidence; role/governance evidence becomes invalid governance evidence; all are quarantined and report construction rejects them before source-coverage classification (`src/lib/ingestion-audit.ts:662-681`). My synthetic provider-failure probe produced the bounded non-index/incomplete-evidence exception rather than `retrieval_miss` or an actionable report. |
| Property-order-dependent provenance digest | **Closed.** `reviewedProvenanceEvidenceDigest` rebuilds all eight nested fields in explicit order (`src/lib/ingestion-audit.ts:465-492`). Reversing insertion order reproduced the checked-in digest exactly. |
| Required indexing-health adapter absent | **Retained in narrower form.** The pure provider-free adapter now exists, reuses `IndexingHealthDocument`, fails when required evidence is absent, and excludes registry/site records. Its direct cross-document ID transplant is closed, but the same-ID reviewed expectation/governance substitution in Finding 1 means the adapter identity boundary is not yet complete. |
| Task-review-4 direct evidence transplant | **Retained in narrower form.** Exact wrapper/evidence document-ID mismatch now throws before overlay. Matching IDs can still preserve the old evidence digests while replacing reviewed expected counts and canonical governance metadata (Finding 1). |

All earlier task-review findings remain closed in the corrected full range: explicit retrieval measurement completeness and rank/presence invariants; canonical document-owned source scopes and Australian protected/excluded policy; provenance version drift; non-null four-action output; non-actionable blocked summaries; bounded failure-code vocabulary; strict privacy fields; deterministic schema-v1 report ordering; CLI import safety and live-read refusal.

## Package identity and reviewed scope

- Phase: `P04` — Read-only corpus and ingestion coverage audit.
- Immutable phase start: `be43d38daf9b22fdee11119a2e1509a951a04a20`.
- Corrected phase end reviewed: `2fa8ef1fb7235a8e9401ce628276acbd3ac9c309`.
- Canonical full-range package: `docs/superpowers/rag-upgrade/execution-artifacts/rag-answer-quality-and-repository-coverage-v1/P04/P04-phase-review-2.diff`.
- Verified package SHA-256: `c6b7aef559251ee3570ca5267b53995fda4e1ffa7ca18c14c266e698390922ac`.
- Full immutable range: nine files and 2,392 insertions. The two correction commits are `a0babd33f8b72240b35158eb2e6675954225abaa` and `2fa8ef1fb7235a8e9401ce628276acbd3ac9c309`; the added adapter is explicitly planned scope, and no unrelated tracked change is present.
- I re-reviewed the complete original phase range, the updated implementer report, Task reviews 4 and 5, all earlier phase/task dispositions, and the complete corrected package—not only the last correction commit.

## Verification evidence

- Canonical package hash and `git diff --check be43d38daf9b22fdee11119a2e1509a951a04a20..2fa8ef1fb7235a8e9401ce628276acbd3ac9c309` passed.
- Final Task review 5 reports a fresh exact-head literal suite pass (17 tests), fresh exact-head typecheck pass, expanded 37-test pass, deterministic CLI output, import safety, scoped formatting, and full-range whitespace proof.
- I independently ran one pure in-memory synthetic probe. It confirmed the provider/non-index and canonical-digest fixes, then reproduced the same-ID adapter substitution in Finding 1. No broad gate rerun was needed.

## Safety boundary and residuals

- Review and probes used only repository source and checked-in synthetic metadata. No document, PDF, corpus payload, extracted text, OCR/parser output, upload, embedding, index operation, real query, live read, provider, network, database, Supabase, hosted state, migration, re-index, activation, deployment, push, or pull request was read, processed, or changed.
- `--live-read` was not used. The CLI remains provider-free, import safe, and non-mutating.
- Registry/site control-plane separation, blocked/non-actionable dispositions, measured absence versus genuine retrieval miss, bounded privacy evidence, canonical provenance hashing, exact state assertion, and unchanged reindex-pipeline compatibility remain intact outside Finding 1.
- Live-corpus, hosted, provider, re-index, and production evidence remain intentionally unrun and are not P04 acceptance evidence.

## Verdicts

`SPEC_VERDICT: FAIL`

The original phase findings are substantially corrected, but the required indexing-health adapter still does not fail closed when same-document wrapper data contradicts the reviewed expected counts or governance metadata it replaces.

`QUALITY_VERDICT: FAIL`

The corrected implementation is deterministic, provider free, and well tested, but the reproduced same-ID substitution can certify incomplete or differently governed evidence as healthy while retaining stale review identities. This remains an Important audit-boundary correctness defect.
