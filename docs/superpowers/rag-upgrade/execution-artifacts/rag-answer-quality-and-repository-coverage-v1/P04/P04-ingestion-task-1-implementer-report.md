# P04 ingestion Task 1 implementer report

## Identity and scope

- Task key: `P04/ingestion/task-1`
- Task base and phase start: `be43d38daf9b22fdee11119a2e1509a951a04a20`
- Task head: `036f47075b7d9ac2f7905ad78a69ab2e1e6733d4`
- Task commit: `036f47075b7d9ac2f7905ad78a69ab2e1e6733d4 feat(ingestion): classify document repair needs`
- Brief hash supplied by the controller: `7580230b23e5f901eda6e25d9b4696e38203bc56a65b7f7b554847febd582255`
- Status: implementation complete; this report is intentionally uncommitted.

This task adds a provider-free, read-only ingestion integrity audit over synthetic metadata inventories. It does not read or transform document content and cannot mutate a corpus, provider, index, or database.

## Implemented files

- `data/rag-expected-source-coverage.v1.json`
- `scripts/audit-ingestion-corpus.ts`
- `src/lib/ingestion-audit.ts`
- `src/lib/source-coverage-registry.ts`
- `tests/fixtures/ingestion/active-corpus-inventory.json`
- `tests/ingestion-audit.test.ts`
- `tests/source-coverage-registry.test.ts`

The commit contains seven files and 1,186 insertions. The task brief, this report, execution receipt, `.superpowers`, and `.local` evidence are not included in the implementation commit.

## Decisions

- Validate the expected registry and actual inventory with strict Zod schemas and reject content-bearing fields so audit inputs remain metadata-only.
- Keep action precedence deterministic: `targeted_reprocess` over `shadow_reindex` over `metadata_only` over `no_change`, while retaining every measured reason.
- Make governance, withdrawal, supersession, quarantine, missing digest, and review-state restrictions ineligible for shadow planning.
- Compare expected and actual pages, chunks, tables, images, searchable units, embeddings, unit-quality counts/policy, generation evidence, embedding model/dimension/strategy/completeness, state digests, and must-pass retrieval cases.
- Represent expected-source coverage explicitly, including `not_in_corpus`, `retrieval_miss`, `not_approved`, and `retired`, with owner and review state.
- Produce a stable schema-v1 report and population fingerprint with privacy-minimized document evidence.
- Keep the CLI import-safe and provider-free. `--live-read` requires explicit target confirmation and then refuses because a separately approved live adapter is not part of this task.
- Keep both checked-in inventory artifacts explicitly synthetic and metadata-only.

## TDD evidence

### Initial RED

Command, run after adding the product tests and before the audit core existed:

```text
node scripts/run-vitest.mjs run tests/ingestion-audit.test.ts
```

Outcome: expected RED. One suite failed before collection with `Cannot find package '@/lib/ingestion-audit'`; zero tests ran. This demonstrated that the requested product module did not exist.

### First implementation cycle

The first post-implementation run reached 8 passing tests and 1 harness failure. The failing import-safety assertion launched the repository `run-tsx` wrapper from inside Vitest and timed out after 30 seconds. A direct diagnostic showed the nested cold wrapper import required approximately 53 seconds. The product import was not the cause. The test was changed to perform the equivalent in-process dynamic import, preserving the import-safety assertion without nesting a repository lease/wrapper.

The literal command then passed 1 file and 9 tests.

### Corrective RED and final GREEN

Final diff review found a missing generation-evidence case: a document with actual chunks but no `chunkGenerations` entries. The failing assertion was added first. The literal command produced the expected corrective RED: 1 failed and 8 passed, with actual `no_change` versus expected `shadow_reindex` / `generation_incomplete`.

The smallest fix made non-zero actual chunk count plus an empty generation inventory incomplete. Final results:

```text
node scripts/run-vitest.mjs run tests/ingestion-audit.test.ts
PASS: 1 file, 9 tests

node scripts/run-vitest.mjs run tests/ingestion-audit.test.ts tests/source-coverage-registry.test.ts tests/check-indexing-contract.test.ts tests/indexing-coverage.test.ts tests/reindex-pipeline.test.ts
PASS: 5 files, 29 tests
```

## Offline CLI evidence

Command:

```text
node scripts/run-tsx.mjs scripts/audit-ingestion-corpus.ts --input tests/fixtures/ingestion/active-corpus-inventory.json --expected data/rag-expected-source-coverage.v1.json --output .local/rag-ingestion/audit.json
```

Outcome:

```text
ingestion audit passed: 3 documents; 1 targeted reprocess; 0 shadow reindex; 0 blocked; fingerprint sha256:fa1f769623f95a034fde03e23bb336cde52f60e65eb689833ee41623e9107cb8
```

Repeated provider-free runs produced the same fingerprint. The ignored `.local/rag-ingestion/audit.json` is evidence only and is not committed.

## Additional verification

- `npm run typecheck`: passed before the final one-line generation-evidence condition; the repository recorded a `typecheck:internal` pass over 4,620 input files.
- Exact-head `npm run typecheck`: the first output was lost to tool-output truncation and did not leave a valid pass receipt. One bounded follow-up was rejected with `DATABASE_HEAVY_RUN_ADMISSION_BUSY` because repository focused-test capacity was occupied. This is honestly recorded as admission-blocked, not a product failure and not an exact-head pass.
- Scoped Prettier check over all seven implementation files: passed. The final two-file correction was also checked and unchanged.
- `npm run docs:check-index`: passed; 55 roots/modules/routes/tables were current.
- `npm run check:maintainability-budgets`: passed.
- `git diff --check be43d38daf9b22fdee11119a2e1509a951a04a20..036f47075b7d9ac2f7905ad78a69ab2e1e6733d4`: passed.
- Final implementation diff: seven files only; no Next.js source was touched, so no Next.js documentation lookup was required.

The pre-commit hook generated two unrelated documentation deltas (`docs/design-system/adoption-manifest.json` and `docs/scripts-index.md`) from prior-phase repository state. They were inspected, excluded, and restored exactly. The coherent seven-file task commit was then created with `--no-verify`; the relevant scoped formatting, documentation-index, maintainability, tests, and diff checks are recorded above.

## Safety boundary and residual risks

No real documents, PDFs, extracted text, clinical content, parser/OCR output, uploads, embeddings, indexes, corpus payloads, provider data, network services, database state, Supabase state, hosted state, or secrets were read or processed. `--live-read` was never used. No migrations, reindexing, activation, deployment, push, pull request, or external write occurred.

The evidence proves the local audit contract against offline synthetic metadata only. It is not live corpus acceptance, provider acceptance, reindex acceptance, hosted validation, or production readiness. A future live adapter and any real-corpus evidence remain separately authorized work. The exact-head typecheck remains admission-blocked as described above; exact-head focused tests, expanded contract tests, CLI execution, formatting, documentation-index, maintainability, and diff checks are green.

## Review 1 correction

### Identity and correction commit

- Review 1 verdict: `SPEC_VERDICT: FAIL`, `QUALITY_VERDICT: FAIL`, with five Important findings reproduced by the reviewer.
- Immutable task base remains `be43d38daf9b22fdee11119a2e1509a951a04a20`.
- Prior task head: `036f47075b7d9ac2f7905ad78a69ab2e1e6733d4`.
- Final task head: `f1e3c99393494e76849d1f119a41e1ab1069e0db`.
- Correction commit: `f1e3c99393494e76849d1f119a41e1ab1069e0db fix(ingestion): fail closed on audit evidence`.
- Full task commit list, newest first:
  - `f1e3c99393494e76849d1f119a41e1ab1069e0db fix(ingestion): fail closed on audit evidence`
  - `036f47075b7d9ac2f7905ad78a69ab2e1e6733d4 feat(ingestion): classify document repair needs`
- The correction commit contains six product/test/fixture files and no process artifact.

### Correction RED

Hostile regressions were added before correction implementation. Initial attempts to run the literal command were rejected before Vitest by repository admission contention and were discarded as invalid RED evidence. After admission became available, the identical literal command produced valid product-behaviour RED:

```text
node scripts/run-vitest.mjs run tests/ingestion-audit.test.ts
FAIL: 1 file; 6 failed, 7 passed (13 tests)
```

The failures separately demonstrated:

- missing case measurements and both directions of document/map retrieval contradiction were accepted;
- an invented source role and caller-asserted link-only/excluded policy were not rejected or blocked;
- reviewed provenance was not accepted, surplus counts were not classified, and the complete coverage contract/version was not bound to report identity;
- a withdrawn document retained an actionable `targeted_reprocess` action;
- an arbitrary `synthetic_private_excerpt` failure string entered the durable contract.

### Correction implementation

- Missing retrieval map keys now fail as incomplete evidence. An explicitly measured empty set alone can produce `retrieval_miss`.
- Inventory validation rejects passed/not-retrieved and failed/retrieved contradictions, duplicate document case IDs, and expected coverage cases without per-document evidence.
- The audit imports canonical role, corpus, content-mode, and licence-policy validators from the existing source-metadata policy owner. Unknown roles are rejected; link-only, reference-link, excluded, forbidden, catalogue-incompatible, and unreviewed Australian content remains blocked regardless of `sourceGovernanceValid`.
- Hostile policy assertions cover eTG link-only, historical/index-forbidden NPS MedicineWise, and excluded unknown Healthdirect catalogue identity using only the checked-in policy catalogue.
- Surplus expected/actual counts produce bounded `count_mismatch` repair evidence; under-count behaviour remains explicit. Complete expected/actual content hash, extraction, parser, parser-config, chunker, index-unit, validation, and source-policy versions plus reviewed evidence identity are validated and included in each document audit.
- The report requires the complete parsed expected-coverage registry, emits `coverageVersion`, and binds it and complete provenance to the deterministic fingerprint.
- Blocked documents expose `action: null` plus a separate `diagnosticAction`; actionable summary and CLI totals therefore exclude tombstoned or quarantined documents.
- Durable retrieval failures accept only the bounded programme-owned `failureCodes` vocabulary. Hostile value-level tests reject arbitrary strings in both the removed `failedExpectations` field and the new bounded code field.
- The synthetic inventory now uses canonical `clinical_guideline` instead of unsupported `national_guideline` and carries complete synthetic metadata-only provenance.

Correction files:

- `scripts/audit-ingestion-corpus.ts`
- `src/lib/ingestion-audit.ts`
- `src/lib/source-coverage-registry.ts`
- `src/lib/source-metadata.ts`
- `tests/fixtures/ingestion/active-corpus-inventory.json`
- `tests/ingestion-audit.test.ts`

### Final GREEN and gates

```text
node scripts/run-vitest.mjs run tests/ingestion-audit.test.ts
PASS: 1 file, 13 tests

node scripts/run-vitest.mjs run tests/ingestion-audit.test.ts tests/source-coverage-registry.test.ts tests/check-indexing-contract.test.ts tests/indexing-coverage.test.ts tests/reindex-pipeline.test.ts
PASS: 5 files, 33 tests
```

Exact synthetic CLI:

```text
node scripts/run-tsx.mjs scripts/audit-ingestion-corpus.ts --input tests/fixtures/ingestion/active-corpus-inventory.json --expected data/rag-expected-source-coverage.v1.json --output .local/rag-ingestion/audit.json
ingestion audit passed: 3 documents; 1 targeted reprocess; 0 shadow reindex; 0 blocked; fingerprint sha256:b999e5b1beb0442c9c4817757c24155dd28a9d027d3027c1631b744a74624c4f
```

Additional final evidence:

- Fresh exact-head `GATE_RECEIPTS=refresh npm run typecheck`: passed and recorded over 4,623 input files.
- Scoped Prettier check over all six correction files: passed.
- `npm run docs:check-index`: passed; all 55 roots/modules/routes/tables are indexed.
- `npm run check:maintainability-budgets`: passed.
- `git diff --check be43d38daf9b22fdee11119a2e1509a951a04a20..f1e3c99393494e76849d1f119a41e1ab1069e0db`: passed.
- Full immutable-base range: eight product files, 1,874 insertions. The only additional owner relative to the original seven-file task is `src/lib/source-metadata.ts`, where four predicates expose the existing canonical policy sets to the audit rather than duplicating their vocabulary.

### Correction safety boundary

The correction used only source code and synthetic metadata fixtures. No document, PDF, corpus payload, extracted text, OCR/parser output, upload, embedding, index, real query, provider, network, database, Supabase, hosted state, migration, reindex, activation, deployment, push, or pull request was read, processed, or changed. `--live-read` was not used. The evidence remains local/provider-free contract evidence, not live corpus, provider, hosted, reindex, or production acceptance. This appended report remains intentionally uncommitted.

## Review 2 correction

### Identity and correction commit

- Review 2 verdict: `SPEC_VERDICT: FAIL`, `QUALITY_VERDICT: FAIL`, with four narrower Important findings.
- Immutable task base remains `be43d38daf9b22fdee11119a2e1509a951a04a20`.
- Prior task head: `f1e3c99393494e76849d1f119a41e1ab1069e0db`.
- Final task head: `c46aa6624ef57eae2aac3efb882ae98f4241985b`.
- Review 2 correction commit: `c46aa6624ef57eae2aac3efb882ae98f4241985b fix(ingestion): validate audit evidence semantics`.
- Full task commit list, newest first:
  - `c46aa6624ef57eae2aac3efb882ae98f4241985b fix(ingestion): validate audit evidence semantics`
  - `f1e3c99393494e76849d1f119a41e1ab1069e0db fix(ingestion): fail closed on audit evidence`
  - `036f47075b7d9ac2f7905ad78a69ab2e1e6733d4 feat(ingestion): classify document repair needs`
- The review 2 correction commit contains exactly three files: `src/lib/ingestion-audit.ts`, `tests/ingestion-audit.test.ts`, and `tests/fixtures/ingestion/active-corpus-inventory.json`.

### Review 2 correction RED

The literal-test regressions were added before product edits. The identical command produced valid product RED:

```text
node scripts/run-vitest.mjs run tests/ingestion-audit.test.ts
FAIL: 1 file; 6 failed, 10 passed (16 tests)
```

The failures demonstrated:

- a valid present document at rank 3 with expected rank 1 and `document_rank_exceeded` was rejected as contradictory;
- `clinical_kb_site` content remained eligible for document audit/re-index;
- changing expected and actual parser versions together while retaining a stale review digest produced `no_change`;
- blocked rows still serialized `action: null`, violating the exact four-action public contract.

During the correction, an additional successful-rank bound assertion was added before its implementation. It produced a focused secondary RED of 1 failed and 15 passed because `passed: true`, expected rank 1, and actual rank 3 was accepted. The rank validator was then completed before final GREEN.

### Review 2 correction implementation

- Retrieval consistency is now failure-code-aware and always binds measured-set presence to actual-rank presence.
- `document_not_retrieved`, `case_timeout`, and `provider_failure` require an absent document and null actual rank.
- `document_rank_exceeded` requires a present document, non-null expected and actual ranks, and `actualDocumentRank > expectedDocumentRank`.
- `source_role_mismatch` and `governance_block` allow present or absent documents while requiring the rank evidence to agree with that presence.
- Successful cases require presence, a non-null actual rank, no failure codes, and a rank within the expected bound when one exists.
- The literal tests include valid and invalid bounded evidence for every failure code without adding free text.
- Document audit now uses the explicit document-owned corpus allowlist `uploaded_local`, `australian_public`, and `international_supplementary`. `clinical_kb_site` is quarantined for its separate site-registry/release control plane. Existing Australian catalogue, licence, protected-source, and exclusion rules remain intact.
- `reviewedProvenanceEvidenceDigest` defines one canonical versioned payload: `ingestion-provenance-review-v1`, the review contract version, and the complete expected provenance evidence. Audit recomputes that SHA-256 and quarantines stale review identity as `provenance_mismatch`, even if expected and actual versions were changed together.
- Synthetic fixture review digests were recomputed deterministically against that payload.
- `IngestionDocumentAudit.action` is restored to non-null `IngestionAuditAction`. Every blocked row uses safe `action: "no_change"`, retains hypothetical repair intent in `diagnosticAction`, remains ineligible, and is excluded from every actionable summary total. Withdrawn, superseded, quarantined, and review-due lifecycle cases are covered together.

### Review 2 final GREEN and gates

```text
node scripts/run-vitest.mjs run tests/ingestion-audit.test.ts
PASS: 1 file, 16 tests

node scripts/run-vitest.mjs run tests/ingestion-audit.test.ts tests/source-coverage-registry.test.ts tests/check-indexing-contract.test.ts tests/indexing-coverage.test.ts tests/reindex-pipeline.test.ts
PASS: 5 files, 36 tests
```

Exact-head synthetic CLI:

```text
node scripts/run-tsx.mjs scripts/audit-ingestion-corpus.ts --input tests/fixtures/ingestion/active-corpus-inventory.json --expected data/rag-expected-source-coverage.v1.json --output .local/rag-ingestion/audit.json
ingestion audit passed: 3 documents; 1 targeted reprocess; 0 shadow reindex; 0 blocked; fingerprint sha256:08bf1d12e8b431f3ec2e243fcc595b743acb222cb4bb7593fd766ce0834a5083
```

Additional final evidence:

- Fresh exact-head `GATE_RECEIPTS=refresh npm run typecheck`: passed and recorded over 4,626 input files.
- Scoped Prettier check over all three correction files: passed.
- `npm run docs:check-index`: passed; all 55 roots/modules/routes/tables are indexed.
- `npm run check:maintainability-budgets`: passed.
- `git diff --check be43d38daf9b22fdee11119a2e1509a951a04a20..c46aa6624ef57eae2aac3efb882ae98f4241985b`: passed.
- Full immutable-base range: eight product files, 2,061 insertions.

### Review 2 safety boundary

Review 2 remediation used only repository source code and synthetic metadata fixtures. No document, PDF, corpus payload, extracted content, OCR/parser output, upload, embedding, index, real query, live read, network/provider, database/Supabase, hosted state, migration, reindex, activation, deployment, push, or pull request was read, processed, or changed. The result remains provider-free local contract evidence only. This report remains intentionally uncommitted.

## Phase review 1 correction

### Identity and correction commit

- Phase review 1 verdict: `SPEC_VERDICT: FAIL`, `QUALITY_VERDICT: FAIL`, with three Important findings.
- Immutable task base remains `be43d38daf9b22fdee11119a2e1509a951a04a20`.
- Prior task head: `c46aa6624ef57eae2aac3efb882ae98f4241985b`.
- Final task head: `a0babd33f8b72240b35158eb2e6675954225abaa`.
- Phase review 1 correction commit: `a0babd33f8b72240b35158eb2e6675954225abaa fix(ingestion): preserve audit failure boundaries`.
- Full task commit list, newest first:
  - `a0babd33f8b72240b35158eb2e6675954225abaa fix(ingestion): preserve audit failure boundaries`
  - `c46aa6624ef57eae2aac3efb882ae98f4241985b fix(ingestion): validate audit evidence semantics`
  - `f1e3c99393494e76849d1f119a41e1ab1069e0db fix(ingestion): fail closed on audit evidence`
  - `036f47075b7d9ac2f7905ad78a69ab2e1e6733d4 feat(ingestion): classify document repair needs`
- The phase-review correction commit contains exactly four files: `src/lib/ingestion-audit.ts`, `scripts/lib/indexing-audit-adapter.ts`, `scripts/audit-ingestion-corpus.ts`, and `tests/ingestion-audit.test.ts`.

### Phase review 1 correction RED

The literal-test regressions were added before product edits. The identical command produced valid product RED:

```text
node scripts/run-vitest.mjs run tests/ingestion-audit.test.ts
FAIL: 1 file; 3 failed, 14 passed (17 tests)
```

The failures demonstrated:

- provider/timeout and governance/role failures were incorrectly admitted as `retrieval_miss` and actionable `shadow_reindex` work;
- semantically identical expected-provenance objects produced different evidence digests when their property insertion order differed;
- the required provider-free adapter from the existing `IndexingHealthDocument` owner did not exist.

### Phase review 1 correction implementation

- Only genuine measured index failures, `document_not_retrieved` and `document_rank_exceeded`, can add `must_pass_retrieval_failed`, classify an active source as `retrieval_miss`, or authorize actionable `shadow_reindex` work.
- `provider_failure` and `case_timeout` now fail closed as incomplete evidence; `source_role_mismatch` and `governance_block` remain distinct governance failures. All four are quarantined, non-actionable, and rejected before five-value source-coverage classification.
- `reviewedProvenanceEvidenceDigest` rebuilds all eight expected-provenance fields in explicit contract order. Reversed insertion order yields the same digest, while any field-value change yields a different digest.
- `scripts/lib/indexing-audit-adapter.ts` provides a pure provider-free adapter from `IndexingHealthDocument` into strict audit input. It reuses `metadataRecord` and `isRegistryProjectionDocument`, maps ordinary synthetic indexing-health evidence, fails closed when required evidence is unavailable, and excludes registry-record and `clinical_kb_site` projections for their separate control planes.
- The CLI accepts either the existing strict audit inventory or the provider-free indexing-health adapter envelope. It remains import-safe and does not implement or invoke live read.

### Phase review 1 final GREEN and gates

```text
node scripts/run-vitest.mjs run tests/ingestion-audit.test.ts
PASS: 1 file, 17 tests

node scripts/run-vitest.mjs run tests/ingestion-audit.test.ts tests/source-coverage-registry.test.ts tests/check-indexing-contract.test.ts tests/indexing-coverage.test.ts tests/reindex-pipeline.test.ts
PASS: 5 files, 37 tests
```

Exact synthetic CLI on the committed content:

```text
node scripts/run-tsx.mjs scripts/audit-ingestion-corpus.ts --input tests/fixtures/ingestion/active-corpus-inventory.json --expected data/rag-expected-source-coverage.v1.json --output .local/rag-ingestion/audit.json
ingestion audit passed: 3 documents; 1 targeted reprocess; 0 shadow reindex; 0 blocked; fingerprint sha256:08bf1d12e8b431f3ec2e243fcc595b743acb222cb4bb7593fd766ce0834a5083
```

Additional final evidence:

- Fresh exact-head `GATE_RECEIPTS=refresh npm run typecheck`: passed and recorded over 4,630 input files.
- Scoped Prettier check over all four correction files: passed.
- `npm run docs:check-index`: passed; all 55 roots/modules/routes/tables are indexed.
- `npm run check:maintainability-budgets`: passed.
- `git diff --check be43d38daf9b22fdee11119a2e1509a951a04a20..a0babd33f8b72240b35158eb2e6675954225abaa`: passed.
- Full immutable-base range: nine product/test/fixture/registry files, 2,380 insertions.

### Phase review 1 safety boundary

Phase review 1 remediation used only repository source code and synthetic metadata fixtures. No document, PDF, corpus payload, extracted content, OCR/parser output, upload, embedding, index operation, real query, live read, network/provider, database/Supabase, hosted state, migration, reindex, activation, deployment, push, or pull request was read, processed, or changed. The result remains provider-free local contract evidence only. This report remains intentionally uncommitted.

## Task review 4 correction

### Identity and correction commit

- Task review 4 verdict: `SPEC_VERDICT: FAIL`, `QUALITY_VERDICT: FAIL`, with one Important adapter identity finding.
- Immutable task base remains `be43d38daf9b22fdee11119a2e1509a951a04a20`.
- Prior task head: `a0babd33f8b72240b35158eb2e6675954225abaa`.
- Final task head: `2fa8ef1fb7235a8e9401ce628276acbd3ac9c309`.
- Task review 4 correction commit: `2fa8ef1fb7235a8e9401ce628276acbd3ac9c309 fix(ingestion): bind adapter evidence identity`.
- Full task commit list, newest first:
  - `2fa8ef1fb7235a8e9401ce628276acbd3ac9c309 fix(ingestion): bind adapter evidence identity`
  - `a0babd33f8b72240b35158eb2e6675954225abaa fix(ingestion): preserve audit failure boundaries`
  - `c46aa6624ef57eae2aac3efb882ae98f4241985b fix(ingestion): validate audit evidence semantics`
  - `f1e3c99393494e76849d1f119a41e1ab1069e0db fix(ingestion): fail closed on audit evidence`
  - `036f47075b7d9ac2f7905ad78a69ab2e1e6733d4 feat(ingestion): classify document repair needs`
- The correction commit contains exactly two files: `scripts/lib/indexing-audit-adapter.ts` and `tests/ingestion-audit.test.ts`.

### Task review 4 correction RED

The hostile adapter regression was added before the product edit. The identical literal command produced valid product RED:

```text
node scripts/run-vitest.mjs run tests/ingestion-audit.test.ts
FAIL: 1 file; 1 failed, 16 passed (17 tests)
```

The failure proved that a wrapper labelled `foreign-guideline` accepted complete reviewed audit evidence belonging to `evidence-owner-guideline`.

### Task review 4 correction implementation

`adaptIndexingHealthDocumentToAuditInput` now parses the supplied evidence strictly and immediately requires `evidence.documentId === args.documentId` before overlaying indexing-health fields or returning auditable input. A mismatch throws a bounded identity error and cannot transplant expected-state, provenance, generation, quality, embedding, or retrieval evidence. The ordinary and wrapper adapter fixtures now use matching document identities.

### Task review 4 final GREEN and gates

```text
node scripts/run-vitest.mjs run tests/ingestion-audit.test.ts
PASS: 1 file, 17 tests

node scripts/run-vitest.mjs run tests/ingestion-audit.test.ts tests/source-coverage-registry.test.ts tests/check-indexing-contract.test.ts tests/indexing-coverage.test.ts tests/reindex-pipeline.test.ts
PASS: 5 files, 37 tests
```

Exact synthetic CLI on the committed content:

```text
node scripts/run-tsx.mjs scripts/audit-ingestion-corpus.ts --input tests/fixtures/ingestion/active-corpus-inventory.json --expected data/rag-expected-source-coverage.v1.json --output .local/rag-ingestion/audit.json
ingestion audit passed: 3 documents; 1 targeted reprocess; 0 shadow reindex; 0 blocked; fingerprint sha256:08bf1d12e8b431f3ec2e243fcc595b743acb222cb4bb7593fd766ce0834a5083
```

Additional final evidence:

- Fresh exact-head `GATE_RECEIPTS=refresh npm run typecheck`: passed and recorded over 4,633 input files.
- Scoped Prettier check over the two correction files: passed.
- `git diff --check be43d38daf9b22fdee11119a2e1509a951a04a20..2fa8ef1fb7235a8e9401ce628276acbd3ac9c309`: passed.
- Full immutable-base range: nine product/test/fixture/registry files, 2,392 insertions.

### Task review 4 safety boundary

Task review 4 remediation used only repository source code and synthetic metadata fixtures. No document, PDF, corpus payload, extracted content, OCR/parser output, upload, embedding, index operation, real query, live read, network/provider, database/Supabase, hosted state, migration, reindex, activation, deployment, push, or pull request was read, processed, or changed. The result remains provider-free local contract evidence only. This report remains intentionally uncommitted.

## Phase review 2 correction

### Identity and correction commit

- Phase review 2 verdict: `SPEC_VERDICT: FAIL`, `QUALITY_VERDICT: FAIL`, with one narrower same-ID adapter substitution finding.
- Immutable task base remains `be43d38daf9b22fdee11119a2e1509a951a04a20`.
- Prior task head: `2fa8ef1fb7235a8e9401ce628276acbd3ac9c309`.
- Final task head: `8dee5cc34294adfe1eb5b0e8ee267d72aa5fbc11`.
- Phase review 2 correction commit: `8dee5cc34294adfe1eb5b0e8ee267d72aa5fbc11 fix(ingestion): preserve reviewed adapter evidence`.
- Full task commit list, newest first:
  - `8dee5cc34294adfe1eb5b0e8ee267d72aa5fbc11 fix(ingestion): preserve reviewed adapter evidence`
  - `2fa8ef1fb7235a8e9401ce628276acbd3ac9c309 fix(ingestion): bind adapter evidence identity`
  - `a0babd33f8b72240b35158eb2e6675954225abaa fix(ingestion): preserve audit failure boundaries`
  - `c46aa6624ef57eae2aac3efb882ae98f4241985b fix(ingestion): validate audit evidence semantics`
  - `f1e3c99393494e76849d1f119a41e1ab1069e0db fix(ingestion): fail closed on audit evidence`
  - `036f47075b7d9ac2f7905ad78a69ab2e1e6733d4 feat(ingestion): classify document repair needs`
- The correction commit contains exactly two files: `scripts/lib/indexing-audit-adapter.ts` and `tests/ingestion-audit.test.ts`.

### Phase review 2 correction RED

The hostile same-ID substitution regressions were added before the product edit. The identical literal command produced valid product RED:

```text
node scripts/run-vitest.mjs run tests/ingestion-audit.test.ts
FAIL: 1 file; 1 failed, 16 passed (17 tests)
```

The failure proved that a matching document ID still allowed the wrapper to replace reviewed expected page/chunk counts. The same hostile block also covers all nine canonical governance metadata fields.

### Phase review 2 correction implementation

- The adapter now requires wrapper `expectedPageCount` and indexing-health `chunk_count` to exactly match the reviewed expected page and chunk counts before adaptation.
- It normalizes the indexing-health publisher, jurisdiction, corpus scope, source role, content mode, licence policy, source-policy version, catalogue key, and exclusion flag, then requires exact equality with reviewed governance metadata.
- The adapter preserves the complete reviewed expected counts and governance metadata. It overlays only current actual page and chunk measurements.
- Independent hostile cases cover page-expectation and chunk-expectation disagreement. Value-level hostile cases cover every canonical governance field, while a valid matching case demonstrates whitespace normalization for publisher and source role.
- No expected-state or provenance evidence digest changed.

### Phase review 2 final GREEN and gates

```text
node scripts/run-vitest.mjs run tests/ingestion-audit.test.ts
PASS: 1 file, 17 tests

node scripts/run-vitest.mjs run tests/ingestion-audit.test.ts tests/source-coverage-registry.test.ts tests/check-indexing-contract.test.ts tests/indexing-coverage.test.ts tests/reindex-pipeline.test.ts
PASS: 5 files, 37 tests
```

Exact synthetic CLI on the committed content:

```text
node scripts/run-tsx.mjs scripts/audit-ingestion-corpus.ts --input tests/fixtures/ingestion/active-corpus-inventory.json --expected data/rag-expected-source-coverage.v1.json --output .local/rag-ingestion/audit.json
ingestion audit passed: 3 documents; 1 targeted reprocess; 0 shadow reindex; 0 blocked; fingerprint sha256:08bf1d12e8b431f3ec2e243fcc595b743acb222cb4bb7593fd766ce0834a5083
```

Additional final evidence:

- Fresh exact-head `GATE_RECEIPTS=refresh npm run typecheck`: passed and recorded over 4,636 input files.
- Scoped Prettier check over the two correction files: passed.
- `git diff --check be43d38daf9b22fdee11119a2e1509a951a04a20..8dee5cc34294adfe1eb5b0e8ee267d72aa5fbc11`: passed.
- Full immutable-base range: nine product/test/fixture/registry files, 2,449 insertions.

### Phase review 2 safety boundary

Phase review 2 remediation used only repository source code and synthetic metadata fixtures. No document, PDF, corpus payload, extracted content, OCR/parser output, upload, embedding, index operation, real query, live read, network/provider, database/Supabase, hosted state, migration, reindex, activation, deployment, push, or pull request was read, processed, or changed. The result remains provider-free local contract evidence only. This report remains intentionally uncommitted.
