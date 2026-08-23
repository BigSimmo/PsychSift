# P04 ingestion Task 1 review 4

## Findings

### 1. Important (P2) — the indexing-health adapter can transplant reviewed evidence between documents

**Evidence:** `IndexingHealthAuditAdapterArgs.auditEvidence` is a complete `IngestionAuditInput`, including its `documentId`, expected state digest, generation identity, provenance, counts, and retrieval cases (`scripts/lib/indexing-audit-adapter.ts:11-17`). The adapter parses that evidence but never checks that `evidence.documentId === args.documentId`; instead it overwrites the evidence ID with the wrapper ID and preserves the remaining reviewed evidence (`scripts/lib/indexing-audit-adapter.ts:94-114`). The new ordinary-document test codifies this mismatch by passing the default fixture evidence under the different ID `adapted-guideline` and expecting acceptance (`tests/ingestion-audit.test.ts:792-813`).

**Reproduction:** the reviewer passed the checked-in synthetic current-guideline evidence (`documentId: "synthetic-guideline-current"`) to an otherwise matching indexing-health row labelled `synthetic-foreign-document`. The adapter accepted it, replaced the ID, retained the original expected state digest and complete provenance, and `auditDocument` certified the foreign ID with `action: "no_change"`, `eligibleForShadowPlan: true`, and no reasons.

```text
node scripts/run-tsx.mjs -e "import inventoryJson from './tests/fixtures/ingestion/active-corpus-inventory.json' with {type:'json'}; import {parseIngestionAuditInventory,auditDocument} from './src/lib/ingestion-audit.ts'; import {adaptIndexingHealthDocumentToAuditInput} from './scripts/lib/indexing-audit-adapter.ts'; const source=parseIngestionAuditInventory(inventoryJson).documents[0]; const result=adaptIndexingHealthDocumentToAuditInput({documentId:'synthetic-foreign-document',indexingHealthDocument:{status:'indexed',file_name:'synthetic-foreign.pdf',page_count:12,chunk_count:24,metadata:{source_kind:'document',publisher:'Synthetic authority',jurisdiction:'AU-WA',corpus_scope:'uploaded_local',source_role:'local_guideline',content_mode:'indexed_content',licence_policy:'public_index_permitted',source_policy_version:'synthetic-source-policy-v1',source_catalogue_key:null,source_excluded:false}},expectedPageCount:12,actualChunkCount:24,auditEvidence:source}); if(result.kind!=='document') throw new Error('unexpected exclusion'); const audit=auditDocument(result.input); console.log(JSON.stringify({evidenceDocumentId:source.documentId,adaptedDocumentId:result.input.documentId,stateDigestTransplanted:result.input.expectedStateDigest===source.expectedStateDigest,provenanceTransplanted:JSON.stringify(result.input.provenance)===JSON.stringify(source.provenance),action:audit.action,eligibleForShadowPlan:audit.eligibleForShadowPlan,reasons:audit.reasons},null,2));"
```

Observed: different evidence and adapted document IDs; both `stateDigestTransplanted` and `provenanceTransplanted` were true; the result was eligible `no_change` with no reasons.

**Expected:** fail closed before adaptation when the full evidence object's document identity differs from the indexing-health wrapper identity. Evidence fields that remain outside the current `IndexingHealthDocument` owner may be operator supplied, but they must be demonstrably for the same document.

**Risk:** reviewed state/provenance, generation, quality, embedding, and retrieval evidence for a healthy document can certify a different document. This defeats the adapter's purpose of connecting the current indexing-health population to document-specific audit evidence and can emit a healthy fingerprint for an unreviewed target.

**Smallest proof/fix:** require exact document-ID equality before the overlay, make the ordinary adapter fixture use the same ID, and add a hostile mismatched-ID regression that throws an identity/evidence error.

## Phase-finding disposition

| Phase review 1 finding | Attempt 4 disposition |
| --- | --- |
| Non-index failures fabricated as retrieval misses/actionable re-index | **Closed.** Only `document_not_retrieved` and `document_rank_exceeded` add `must_pass_retrieval_failed` (`src/lib/ingestion-audit.ts:534-548,593-595`). Provider/timeout cases add incomplete-integrity evidence; role/governance cases add source-governance invalidity; all four are quarantined and non-actionable (`src/lib/ingestion-audit.ts:536-549,598-610`). Report construction rejects those four classes before five-value source-coverage classification (`src/lib/ingestion-audit.ts:662-681`). The reviewer reproduced genuine not-retrieved -> `retrieval_miss`/`shadow_reindex`, genuine rank exceeded -> `available` plus `shadow_reindex`, and all four non-index classes -> safe `no_change`, ineligible, and report-construction rejection. |
| Provenance digest depends on property insertion order | **Closed.** `reviewedProvenanceEvidenceDigest` rebuilds all eight expected fields in explicit contract order (`src/lib/ingestion-audit.ts:465-492`). The reviewer reversed the input object's property order and reproduced the checked-in digest exactly; changing a field remains digest-changing under the focused tests. |
| Required pure indexing-health adapter absent | **Retained in narrower form.** The provider-free adapter now exists, imports the current `IndexingHealthDocument`, `metadataRecord`, and `isRegistryProjectionDocument` owner, maps ordinary page/chunk and canonical metadata evidence, fails when required evidence is absent, and excludes registry/site records (`scripts/lib/indexing-audit-adapter.ts:1-137`). However, its unbound document identity leaves the ordinary-document mapping fail open (Finding 1). |

## Prior task-finding disposition

All findings closed in Task review attempt 3 remain closed in the full corrected range:

- explicit retrieval measurement completeness and bounded rank/presence invariants remain at `src/lib/ingestion-audit.ts:316-348`;
- document-owned source-scope and Australian canonical-policy enforcement remain at `src/lib/ingestion-audit.ts:431-462`;
- expected/actual count and version drift, reviewed provenance recomputation, and coverage-version fingerprint binding remain intact;
- `action` remains the exact non-null four-value contract, blocked documents use safe `no_change`, and actionable totals exclude ineligible rows;
- bounded failure codes, strict unknown/private-field rejection, deterministic ordering, expected-state assertion, output privacy, CLI import safety, and provider-free refusal remain intact.

No regression was found in missing-versus-retrieval-miss classification, `clinical_kb_site` ownership, non-actionable blocked summaries, canonical source policy, duplicate handling, or schema-v1 report identity outside Finding 1.

## Package identity and scope

- Task key: `P04/ingestion/task-1`
- Immutable base: `be43d38daf9b22fdee11119a2e1509a951a04a20`
- Corrected head: `a0babd33f8b72240b35158eb2e6675954225abaa`
- Full commit list in order:
  1. `036f47075b7d9ac2f7905ad78a69ab2e1e6733d4 feat(ingestion): classify document repair needs`
  2. `f1e3c99393494e76849d1f119a41e1ab1069e0db fix(ingestion): fail closed on audit evidence`
  3. `c46aa6624ef57eae2aac3efb882ae98f4241985b fix(ingestion): validate audit evidence semantics`
  4. `a0babd33f8b72240b35158eb2e6675954225abaa fix(ingestion): preserve audit failure boundaries`
- Canonical full-range package: `docs/superpowers/rag-upgrade/execution-artifacts/rag-answer-quality-and-repository-coverage-v1/P04/P04-ingestion-task-1-review-4.diff`
- Package SHA-256: `f575874a2c5dc801fef7d8e5bc07901616ab7eea07c9e3a7cdb06c51d4ceca2c`
- Updated implementer-report SHA-256: `ae3ddcad1e726436648e3ea80b5f99f81bff148492f83af01832b87aaea17d32`
- Full immutable range: nine files and 2,380 insertions. `git apply --numstat` over the canonical package matched that range. The added `scripts/lib/indexing-audit-adapter.ts` is the adapter explicitly required by the plan and is justified owned scope; the existing 16-line `src/lib/source-metadata.ts` predicate export remains justified canonical-policy reuse. No unrelated tracked scope is present.

## Verification evidence

### Implementer evidence reviewed

- Phase-correction RED: literal audit suite -> 3 failed / 14 passed before implementation.
- Final literal GREEN: `node scripts/run-vitest.mjs run tests/ingestion-audit.test.ts` -> 1 file / 17 tests passed.
- Expanded GREEN: `node scripts/run-vitest.mjs run tests/ingestion-audit.test.ts tests/source-coverage-registry.test.ts tests/check-indexing-contract.test.ts tests/indexing-coverage.test.ts tests/reindex-pipeline.test.ts` -> 5 files / 37 tests passed.
- Scoped Prettier, documentation index, maintainability budget, and immutable-range `git diff --check` passed.

Those tests cover the three original phase findings but do not reject the cross-document evidence mismatch reproduced above.

### Fresh exact-head typecheck

`npm run typecheck` passed freshly on `a0babd33f8b72240b35158eb2e6675954225abaa`; `typecheck:internal` recorded a pass over 4,632 input files.

### Deterministic CLI and import safety

The exact checked-in synthetic CLI was run twice to separate ignored outputs:

```text
node scripts/run-tsx.mjs scripts/audit-ingestion-corpus.ts --input tests/fixtures/ingestion/active-corpus-inventory.json --expected data/rag-expected-source-coverage.v1.json --output .local/rag-ingestion/reviewer-4-a.json
node scripts/run-tsx.mjs scripts/audit-ingestion-corpus.ts --input tests/fixtures/ingestion/active-corpus-inventory.json --expected data/rag-expected-source-coverage.v1.json --output .local/rag-ingestion/reviewer-4-b.json
```

Both returned 3 documents, 1 targeted reprocess, 0 shadow re-index, 0 blocked, and fingerprint `sha256:08bf1d12e8b431f3ec2e243fcc595b743acb222cb4bb7593fd766ce0834a5083`. Both JSON files had identical SHA-256 `f7421f631f846fe6570f8c0614224c2f7c0b221797b5ea3f5f891c1a0f7d3c6b`.

Import probe:

```text
node scripts/run-tsx.mjs -e "process.argv.push('--output','.local/rag-ingestion/reviewer-4-import-unexpected.json'); await import('./scripts/audit-ingestion-corpus.ts');"
```

Exited 0 and `reviewer-4-import-unexpected.json` did not exist. The CLI remains import safe. `--live-read` remains refused before input or output access (`scripts/audit-ingestion-corpus.ts:55-70`).

## Safety boundary and residuals

- Review and probes used only repository source and checked-in synthetic metadata. No document, PDF, corpus payload, extracted text, OCR/parser output, upload, embedding, index operation, real query, live read, provider, network, database/Supabase, hosted state, migration, re-index, activation, deployment, push, or PR action occurred.
- The result remains provider-free local contract evidence, not live corpus, provider, hosted, re-index, or production acceptance.
- The cross-document evidence-binding defect is the only implementation blocker found. Live/provider/hosted acceptance remains intentionally unrun and outside this task.

## Verdicts

`SPEC_VERDICT: FAIL`

The phase corrections now preserve retrieval-cause boundaries, canonical provenance hashing, and the separate site/registry control plane, but the required indexing-health adapter does not yet fail closed when reviewed audit evidence belongs to a different document.

`QUALITY_VERDICT: FAIL`

The implementation compiles, is deterministic, remains provider free, and closes the three phase findings in their original form. The reproduced identity transplant can nevertheless certify an unreviewed document as healthy using another document's integrity evidence, which is an Important audit-boundary defect.
