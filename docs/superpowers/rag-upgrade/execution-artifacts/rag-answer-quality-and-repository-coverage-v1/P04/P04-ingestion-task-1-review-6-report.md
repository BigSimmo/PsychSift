# P04 ingestion Task 1 review 6

## Findings

No findings. I re-reviewed the complete immutable base-to-corrected-head range. The same-document adapter substitution defect identified by phase review 2 is closed, the direct identity guard remains intact, and every earlier phase/task finding remains closed without scope or safety-boundary regression.

## Phase-review-2 finding disposition

**Closed — the adapter preserves reviewed expectations and governance evidence.** After parsing and binding the wrapper/evidence document ID, `adaptIndexingHealthDocumentToAuditInput` requires wrapper `expectedPageCount` and indexing-health `chunk_count` to exactly match the reviewed expected page/chunk counts (`scripts/lib/indexing-audit-adapter.ts:94-104`). It normalizes publisher, jurisdiction, corpus scope, source role, content mode, licence policy, source-policy version, catalogue key, and exclusion flag, then compares every field with the reviewed metadata (`scripts/lib/indexing-audit-adapter.ts:105-133`). It returns the parsed reviewed evidence with only current actual page and chunk measurements overlaid; reviewed metadata and expected counts are not replaced (`scripts/lib/indexing-audit-adapter.ts:134-143`).

The reviewer independently proved all of the following with checked-in synthetic metadata:

- a valid same-ID wrapper produced an input exactly equal to the reviewed input except `counts.pages.actual` and `counts.chunks.actual`;
- reviewed metadata, both expected counts, and complete provenance remained unchanged;
- wrapper/evidence document-ID mismatch still threw before overlay;
- mismatched wrapper expected page count and indexing-health expected chunk count each threw the bounded expected-count error;
- mismatches in each of the nine normalized governance fields independently threw the bounded governance-metadata error;
- leading/trailing whitespace in wrapper publisher and source role normalized to the reviewed values and remained valid.

The literal regression block covers both expected-count substitutions and all nine governance fields (`tests/ingestion-audit.test.ts:775-855`) while retaining direct ID, missing-evidence, registry, and site cases.

## Earlier phase/task finding disposition

| Finding family | Attempt 6 disposition |
| --- | --- |
| Direct cross-document evidence transplant | **Closed.** Strict evidence parsing is followed immediately by exact `evidence.documentId === args.documentId` enforcement before any consistency check or overlay (`scripts/lib/indexing-audit-adapter.ts:94-99`). The hostile ID mismatch remains covered and independently reproduced as rejected. |
| Retrieval completeness, presence, and rank semantics | **Closed.** Explicit measurements and bounded code/rank/presence invariants remain fail closed at `src/lib/ingestion-audit.ts:316-348`. Only measured `document_not_retrieved` and `document_rank_exceeded` failures authorize retrieval-driven shadow action. |
| Provider/timeout/role/governance causal boundary | **Closed.** Provider/timeout failures remain incomplete evidence; role/governance failures remain invalid governance evidence. All are non-actionable/quarantined and rejected before source-coverage classification (`src/lib/ingestion-audit.ts:534-549,593-610,662-681`). |
| Property-order canonical provenance and bidirectional/version drift | **Closed.** The digest helper rebuilds all eight expected fields in contract order (`src/lib/ingestion-audit.ts:465-492`); count, source-policy, provenance, and coverage-version drift remain bound into audit/fingerprint identity. |
| Pure provider-free indexing-health adapter | **Closed.** The adapter reuses `IndexingHealthDocument`, fails closed for missing evidence, excludes registry/site projections, binds direct identity, validates same-ID expectations/governance, preserves reviewed fields, and overlays only actual measurements (`scripts/lib/indexing-audit-adapter.ts:1-159`). |
| Canonical source policy and document/site ownership | **Closed.** The document-owned scope allowlist and Australian catalogue rules remain enforced; registry and `clinical_kb_site` rows remain excluded by the adapter and invalid in document audit. |
| Exact non-null action and blocked totals | **Closed.** Ineligible rows remain safe `no_change` with separate diagnostic intent, and every actionable total excludes blocked rows. |
| Privacy, strict schemas, duplicates/unknowns, deterministic schema-v1 output | **Closed.** Failure evidence remains bounded to six codes; strict schema rejection, stable ordering, coverage ownership/version, and deterministic fingerprint behavior are unchanged. |
| CLI import/non-mutation and synthetic-only scope | **Closed.** The CLI remains provider free, import safe, deterministic, and refuses live read before input/output access. All review evidence is checked-in synthetic metadata only. |

## Package identity and scope

- Task key: `P04/ingestion/task-1`
- Immutable base: `be43d38daf9b22fdee11119a2e1509a951a04a20`
- Corrected head: `8dee5cc34294adfe1eb5b0e8ee267d72aa5fbc11`
- Full commit list in order:
  1. `036f47075b7d9ac2f7905ad78a69ab2e1e6733d4 feat(ingestion): classify document repair needs`
  2. `f1e3c99393494e76849d1f119a41e1ab1069e0db fix(ingestion): fail closed on audit evidence`
  3. `c46aa6624ef57eae2aac3efb882ae98f4241985b fix(ingestion): validate audit evidence semantics`
  4. `a0babd33f8b72240b35158eb2e6675954225abaa fix(ingestion): preserve audit failure boundaries`
  5. `2fa8ef1fb7235a8e9401ce628276acbd3ac9c309 fix(ingestion): bind adapter evidence identity`
  6. `8dee5cc34294adfe1eb5b0e8ee267d72aa5fbc11 fix(ingestion): preserve reviewed adapter evidence`
- Canonical full-range package: `docs/superpowers/rag-upgrade/execution-artifacts/rag-answer-quality-and-repository-coverage-v1/P04/P04-ingestion-task-1-review-6.diff`
- Package SHA-256: `b2f5216e583e9b2797a4efa68d9e5f76365a1147feeead637767058ed5b77d4b`
- Updated implementer-report SHA-256: `a6387e0c44be969315e7cb0be53f1dcfd1354699007cf4b01be16a5767dc00aa`
- Full immutable range: nine files and 2,449 insertions. `git apply --numstat` over the package matched that range, and `git diff --check` passed. The adapter is explicitly required scope; the small source-metadata export remains canonical-policy reuse. No unrelated tracked implementation scope is present.

## Verification evidence

### Implementer evidence reviewed

- Phase-review-2 corrective RED: literal audit suite -> 1 failed / 16 passed before product correction.
- Final literal GREEN: `node scripts/run-vitest.mjs run tests/ingestion-audit.test.ts` -> 1 file / 17 tests passed.
- Expanded GREEN: `node scripts/run-vitest.mjs run tests/ingestion-audit.test.ts tests/source-coverage-registry.test.ts tests/check-indexing-contract.test.ts tests/indexing-coverage.test.ts tests/reindex-pipeline.test.ts` -> 5 files / 37 tests passed.
- Scoped Prettier and immutable-range `git diff --check` passed.

### Fresh reviewer exact-head checks

`node scripts/run-vitest.mjs run tests/ingestion-audit.test.ts` passed freshly at `8dee5cc34294adfe1eb5b0e8ee267d72aa5fbc11`: 1 file and 17 tests. The repository recorded a receipt over 4,638 input files.

`npm run typecheck` passed freshly at the same exact head; `typecheck:internal` recorded a pass over 4,638 input files.

The reviewer pure synthetic probe reported:

```text
wholeInputEqualsExpectedWithActualsOnly: true
metadataPreserved: true
pageExpectedPreserved: true
chunkExpectedPreserved: true
provenancePreserved: true
pageActual: 10
chunkActual: 18
```

Direct ID mismatch, expected page mismatch, expected chunk mismatch, and each of publisher, jurisdiction, corpus scope, source role, content mode, licence policy, source-policy version, catalogue key, and exclusion-flag mismatch returned their bounded fail-closed errors.

### Deterministic CLI and import safety

The exact checked-in synthetic CLI was run twice to separate ignored outputs:

```text
node scripts/run-tsx.mjs scripts/audit-ingestion-corpus.ts --input tests/fixtures/ingestion/active-corpus-inventory.json --expected data/rag-expected-source-coverage.v1.json --output .local/rag-ingestion/reviewer-6-a.json
node scripts/run-tsx.mjs scripts/audit-ingestion-corpus.ts --input tests/fixtures/ingestion/active-corpus-inventory.json --expected data/rag-expected-source-coverage.v1.json --output .local/rag-ingestion/reviewer-6-b.json
```

Both returned 3 documents, 1 targeted reprocess, 0 shadow re-index, 0 blocked, and fingerprint `sha256:08bf1d12e8b431f3ec2e243fcc595b743acb222cb4bb7593fd766ce0834a5083`. Both JSON files had identical SHA-256 `f7421f631f846fe6570f8c0614224c2f7c0b221797b5ea3f5f891c1a0f7d3c6b`.

Import probe:

```text
node scripts/run-tsx.mjs -e "process.argv.push('--output','.local/rag-ingestion/reviewer-6-import-unexpected.json'); await import('./scripts/audit-ingestion-corpus.ts');"
```

Exited 0 and `reviewer-6-import-unexpected.json` did not exist. Import remains side-effect free and `--live-read` remains refused before input or output access (`scripts/audit-ingestion-corpus.ts:55-70`).

## Safety boundary and residuals

- Review and verification used only repository source code and checked-in synthetic metadata fixtures. No document, PDF, corpus payload, extracted text, OCR/parser output, upload, embedding, index operation, real query, live read, provider, network, database/Supabase, hosted state, migration, re-index, activation, deployment, push, or PR action occurred.
- The result is provider-free local contract evidence only. Live corpus, provider, hosted, re-index, and production acceptance remain intentionally unrun and outside this task's acceptance boundary.
- No implementation residual or scope drift was found in the reviewed package.

## Verdicts

`SPEC_VERDICT: PASS`

The complete corrected range satisfies the read-only schema-v1 audit contract, causal retrieval and source-coverage semantics, canonical provenance identity, policy/control-plane boundaries, exact action/disposition behavior, and pure indexing-health adaptation that binds identity, preserves reviewed expectations/governance, and overlays only actual measurements.

`QUALITY_VERDICT: PASS`

The implementation fails closed for missing, contradictory, non-index, governance, cross-document, and same-document substitution evidence; passes exact-head focused tests and typecheck; preserves deterministic/private import-safe output; and introduces no unowned or external behavior.
