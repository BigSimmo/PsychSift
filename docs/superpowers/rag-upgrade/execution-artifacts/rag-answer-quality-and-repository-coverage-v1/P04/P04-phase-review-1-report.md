# P04 phase review 1

## Findings

### 1. Important (P2) — non-index evaluation failures are fabricated as retrieval misses and actionable shadow re-index work

**Evidence:** `auditExpectedSourceCoverage` decides `retrieval_miss` from the retrieved-ID set alone (`src/lib/source-coverage-registry.ts:89-99`), so it cannot distinguish a measured empty result from a case that never produced a usable retrieval result. `auditDocument` then converts every failed must-pass case into `must_pass_retrieval_failed` (`src/lib/ingestion-audit.ts:560-562`), and that reason always selects `shadow_reindex` (`src/lib/ingestion-audit.ts:413-417,514-518`). The tests explicitly require all six failure codes—including `provider_failure`, `case_timeout`, `source_role_mismatch`, and `governance_block`—to produce an eligible `shadow_reindex` action (`tests/ingestion-audit.test.ts:226-241`).

**Reproduction:** a pure in-memory probe changed the otherwise healthy checked-in synthetic current guideline to `passed: false`, `actualDocumentRank: null`, `failureCodes: ["provider_failure"]`, with an explicit empty retrieved set. The report returned `action: "shadow_reindex"`, `eligibleForShadowPlan: true`, reason `must_pass_retrieval_failed`, and source coverage outcome `retrieval_miss`.

**Expected:** `retrieval_miss` must mean an active eligible source was actually searched and not retrieved, as required by the plan (`2026-08-20-rag-ingestion-reindex.md:295`). Provider failure, timeout, role mismatch, and governance block are distinct programme failure classes (`2026-08-20-rag-answer-and-australian-sources-design.md:185`) and must not authorize index mutation. Within the current five-value source-coverage interface, incomplete/provider/timeout evidence should fail closed instead of fabricating `retrieval_miss`; role/governance failures should be classified through their own metadata/governance boundary or rejected as non-actionable evidence.

**Risk:** a provider outage, evaluation timeout, or policy mismatch can be turned into a reason-coded mutation candidate. That violates audit-before-mutation and the design requirement to diagnose the failing layer before recommending re-indexing (`2026-08-20-rag-ingestion-reindex.md:29`; `2026-08-20-rag-answer-and-australian-sources-design.md:92`).

**Smallest proof/fix:** make report construction validate the case outcome before source-coverage classification; allow `must_pass_retrieval_failed` to drive `shadow_reindex` only for measured index/retrieval defects such as a genuine `document_not_retrieved` or `document_rank_exceeded`. Add regressions proving provider/timeout evidence cannot become `retrieval_miss` or an actionable re-index, and role/governance failures remain non-actionable or separately classified.

### 2. Important (P2) — the reviewed-provenance digest is not canonical across semantically identical objects

**Evidence:** `reviewedProvenanceEvidenceDigest` places the caller-supplied `expected` object directly into the digest payload (`src/lib/ingestion-audit.ts:465-473`), while `sha256` hashes plain `JSON.stringify` bytes (`src/lib/ingestion-audit.ts:611-613`). JavaScript object insertion order therefore becomes part of the evidence identity even though it is not part of the typed provenance contract.

**Reproduction:** the checked-in expected provenance produced `sha256:f9f6034458857f0ef1c75f245a854a138b06cb6c129b5c6803aa41cba029e925`; a new object containing the exact same eight field/value pairs in reverse insertion order produced `sha256:b02e4b820e3b2cfe2036cc13b33a62d2db82f98027bad347cb89b2384beac92d`.

**Expected:** the exported digest helper must canonicalize its complete semantic payload, either by explicitly rebuilding every nested field in contract order or by using the repository's stable canonical serializer. Equivalent provenance must generate the same review digest regardless of producer/property insertion order.

**Risk:** an operator or later adapter can generate a valid reviewed digest that this audit rejects solely because its serializer emitted fields in another order. This undermines the deterministic/versioned provenance identity that later shadow planning and receipts rely on.

**Smallest proof/fix:** canonicalize the nested `expected` object inside `reviewedProvenanceEvidenceDigest` and add a test that differently ordered but semantically identical expected provenance yields the same digest, while any field-value change still changes it.

### 3. Important (P2) — the phase does not implement the required adapter from the existing indexing-health owner

**Evidence:** Task 1 explicitly names `scripts/lib/indexing-health-document.ts` for reuse (`2026-08-20-rag-ingestion-reindex.md:111`) and states that the adapter maps existing indexing-health data into the pure audit input (`2026-08-20-rag-ingestion-reindex.md:285`). The new CLI only reads JSON already shaped as the new `IngestionAuditInventory` and passes it directly to the new parser (`scripts/audit-ingestion-corpus.ts:62-68`). Neither production code nor tests reference `IndexingHealthDocument`, `isRegistryProjectionDocument`, or any other existing indexing-health owner; a scoped `rg` over all eight changed files returned no match.

**Expected:** provide a pure, provider-free adapter/contract from the current indexing-health representation into the audit input. Evidence unavailable from that owner may remain explicitly unknown and fail closed, but registry/site projections must retain their separate control plane and the mapping must be tested against the existing contract.

**Risk:** the phase currently proves a classifier over a hand-authored synthetic replacement schema, not that the existing ingestion/indexing system can produce that evidence. Later work would have to invent an unreviewed mapping at the live-read or mutation boundary, where the audit is intended to prevent mistakes.

**Smallest proof/fix:** add the planned adapter at the CLI/library boundary, reuse `scripts/lib/indexing-health-document.ts`, and add focused provider-free tests for an ordinary document, missing evidence, and a `registry_record` exclusion. Keep the live adapter refused and do not read any real corpus.

## Package identity and reviewed scope

- Phase: `P04` — Read-only corpus and ingestion coverage audit.
- Immutable phase start: `be43d38daf9b22fdee11119a2e1509a951a04a20`.
- Reviewed phase end: `c46aa6624ef57eae2aac3efb882ae98f4241985b`.
- Canonical full-range package: `docs/superpowers/rag-upgrade/execution-artifacts/rag-answer-quality-and-repository-coverage-v1/P04/P04-phase-review-1.diff`.
- Verified package SHA-256: `1462fbb8dbed2d9ae063f9e4fb1b06391a0ab5eb8422d67d4017cf1083c06856`.
- Full range: eight files and 2,061 insertions. It contains the seven planned audit/fixture files plus the justified 16-line export of canonical source-policy predicates from `src/lib/source-metadata.ts`; no unrelated tracked change is present.
- I reviewed both approved specifications, the local manifest, verification/approval matrices, SDD contract, ingestion plan preamble and Task 1 brief, accepted P02/P03 receipts, the final implementer report, all three task-review reports, and the complete canonical package.

## Verification evidence

- The final task review's exact-head evidence remains valid for the reviewed head: fresh typecheck passed; literal suite passed 16 tests; expanded suite passed 36 tests; deterministic synthetic CLI, import safety, scoped formatting, documentation index, maintainability budget, and immutable-range whitespace checks passed.
- I independently verified the canonical phase-package hash and `git diff --check` for the immutable phase range.
- I ran two pure in-memory synthetic probes only: one reproduced provider failure becoming both `retrieval_miss` and `shadow_reindex`; the other proved property-order-dependent provenance digests. No test wrapper rerun was needed to reproduce either finding.

## Safety boundary and residuals

- Review and probes used only repository source and checked-in synthetic metadata. No document, PDF, corpus payload, extracted text, parser/OCR output, upload, embedding, index operation, real query, provider, network, database, Supabase, hosted state, migration, re-index, activation, deployment, push, or pull request was read, processed, or changed.
- `--live-read` was not used. Its import-safe refusal boundary remains intact.
- Blocked lifecycle dispositions, document/site control-plane separation, canonical Australian protected-source policy, bounded failure-code values, exact state-digest assertion, privacy-safe strict schemas, deterministic report ordering, CLI non-mutation, and reindex-pipeline compatibility tests otherwise remain intact.
- Live-corpus, hosted, provider, re-index, and production evidence remain intentionally unrun and are not P04 acceptance evidence.

## Verdicts

`SPEC_VERDICT: FAIL`

The phase does not yet preserve the required distinction between a measured retrieval miss and provider/timeout/governance failure, can recommend mutation for non-index defects, and omits the explicitly required adapter from the current indexing-health owner.

`QUALITY_VERDICT: FAIL`

The implementation is well bounded and substantially tested, but the reproduced causal-classification error and non-canonical provenance digest can produce unsafe action advice or reject semantically identical reviewed evidence. Both are Important correctness defects at the audit control-plane boundary.
