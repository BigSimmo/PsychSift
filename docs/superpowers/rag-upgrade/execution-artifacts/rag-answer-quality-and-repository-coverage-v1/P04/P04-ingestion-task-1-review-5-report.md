# P04 ingestion Task 1 review 5

## Findings

No findings. I re-reviewed the complete immutable base-to-corrected-head task range. The adapter identity defect from attempt 4 is closed, and the phase and task findings closed in earlier attempts remain closed without weakening determinism, privacy, or the provider-free/read-only boundary.

## Attempt-4 finding disposition

**Closed — adapter evidence is bound to the wrapper document identity.** `adaptIndexingHealthDocumentToAuditInput` strictly parses the complete supplied evidence and immediately compares `evidence.documentId` with `args.documentId` before overlaying indexing-health fields or returning auditable input (`scripts/lib/indexing-audit-adapter.ts:94-100`). A mismatch throws the bounded error `Indexing-health audit evidence document identity mismatch.` The ordinary adapter and inventory-envelope tests now use matching IDs, while a dedicated hostile mismatch regression expects rejection (`tests/ingestion-audit.test.ts:792-826,872-884`).

The reviewer independently repeated the prior transplant probe with checked-in synthetic evidence belonging to `synthetic-guideline-current` and wrapper ID `synthetic-foreign-document`. It now threw the identity-mismatch error before adaptation. The matching-ID form produced document input for `synthetic-guideline-current` and audited as `no_change`, confirming the guard does not block valid evidence.

## Phase and prior-task finding disposition

| Finding family | Attempt 5 disposition |
| --- | --- |
| Retrieval measurement completeness and rank/presence consistency | **Closed.** Explicit case measurements and bounded presence/rank/failure-code invariants remain fail closed at `src/lib/ingestion-audit.ts:316-348`. Reviewer evidence reproduced not-retrieved as actionable `shadow_reindex` plus source `retrieval_miss`, and rank-exceeded as actionable `shadow_reindex` with the source correctly still `available`. |
| Provider/timeout/role/governance causal boundary | **Closed.** Only `document_not_retrieved` and `document_rank_exceeded` can add `must_pass_retrieval_failed`; provider/timeout become incomplete integrity evidence and role/governance become invalid governance evidence (`src/lib/ingestion-audit.ts:534-549,593-610`). The reviewer reproduced all four non-index cases as safe non-actionable `no_change`, ineligible, and rejected before source-coverage classification (`src/lib/ingestion-audit.ts:662-681`). |
| Canonical provenance digest and bidirectional/version drift | **Closed.** The digest helper rebuilds all eight expected-provenance fields in contract order (`src/lib/ingestion-audit.ts:465-492`). The reviewer reversed property insertion order and obtained the exact checked-in digest. Expected/actual count drift, source-policy/provenance drift, reviewed-digest recomputation, and coverage-version fingerprint binding remain intact. |
| Required pure indexing-health adapter and control-plane separation | **Closed.** `scripts/lib/indexing-audit-adapter.ts:1-140` reuses the current `IndexingHealthDocument`, `metadataRecord`, and `isRegistryProjectionDocument` owner; maps ordinary page/chunk/canonical metadata evidence; rejects missing required evidence; excludes `registry_record` and `clinical_kb_site`; binds document identity before overlay; and emits only strict audit inventory. Reviewer probes independently confirmed ordinary mapping, missing-evidence rejection, identity rejection, and registry/site exclusion. |
| Canonical source policy and site ownership | **Closed.** The document-owned scope allowlist and Australian source catalogue rules remain enforced at `src/lib/ingestion-audit.ts:431-462`; site/registry records are also excluded at the adapter boundary. |
| Non-null action contract and blocked totals | **Closed.** `action` remains the exact four-value non-null type; ineligible rows use safe `no_change`, retain diagnostic intent separately, and are excluded from all actionable totals. |
| Bounded privacy evidence, duplicate/unknown handling, deterministic schema-v1 identity | **Closed.** Failure evidence remains restricted to six bounded codes; strict schemas reject unknown/private fields and duplicates; report ordering and fingerprints remain deterministic; coverage version and complete document/source evidence remain bound. |
| CLI import/non-mutation and synthetic-only scope | **Closed.** The CLI accepts strict audit or pure adapter envelopes, remains import safe, refuses `--live-read` before reads/writes, and the fixture/test evidence remains synthetic metadata only. |

## Package identity and scope

- Task key: `P04/ingestion/task-1`
- Immutable base: `be43d38daf9b22fdee11119a2e1509a951a04a20`
- Corrected head: `2fa8ef1fb7235a8e9401ce628276acbd3ac9c309`
- Full commit list in order:
  1. `036f47075b7d9ac2f7905ad78a69ab2e1e6733d4 feat(ingestion): classify document repair needs`
  2. `f1e3c99393494e76849d1f119a41e1ab1069e0db fix(ingestion): fail closed on audit evidence`
  3. `c46aa6624ef57eae2aac3efb882ae98f4241985b fix(ingestion): validate audit evidence semantics`
  4. `a0babd33f8b72240b35158eb2e6675954225abaa fix(ingestion): preserve audit failure boundaries`
  5. `2fa8ef1fb7235a8e9401ce628276acbd3ac9c309 fix(ingestion): bind adapter evidence identity`
- Canonical full-range package: `docs/superpowers/rag-upgrade/execution-artifacts/rag-answer-quality-and-repository-coverage-v1/P04/P04-ingestion-task-1-review-5.diff`
- Package SHA-256: `c6b7aef559251ee3570ca5267b53995fda4e1ffa7ca18c14c266e698390922ac`
- Updated implementer-report SHA-256: `c71b47fe07c62c60ffb3fae0ccc468022f504706a7940a9a35d9c7918d7aa285`
- Full immutable range: nine files and 2,392 insertions. `git apply --numstat` over the canonical package matched that range and `git diff --check` passed. `scripts/lib/indexing-audit-adapter.ts` is explicitly required adapter scope; the 16-line `src/lib/source-metadata.ts` change exposes the canonical policy predicates rather than duplicating policy. No unrelated tracked implementation scope is present.

## Verification evidence

### Implementer evidence reviewed

- Attempt-4 corrective RED: literal audit suite -> 1 failed / 16 passed before the identity guard.
- Final literal GREEN: `node scripts/run-vitest.mjs run tests/ingestion-audit.test.ts` -> 1 file / 17 tests passed.
- Expanded GREEN: `node scripts/run-vitest.mjs run tests/ingestion-audit.test.ts tests/source-coverage-registry.test.ts tests/check-indexing-contract.test.ts tests/indexing-coverage.test.ts tests/reindex-pipeline.test.ts` -> 5 files / 37 tests passed.
- Scoped Prettier and immutable-range `git diff --check` passed.

### Fresh reviewer exact-head checks

`node scripts/run-vitest.mjs run tests/ingestion-audit.test.ts` passed freshly on `2fa8ef1fb7235a8e9401ce628276acbd3ac9c309`: 1 file and 17 tests. The repository recorded a receipt over 4,634 input files.

`npm run typecheck` also passed freshly at the exact head; `typecheck:internal` recorded a pass over 4,634 input files.

The independent pure synthetic probe confirmed:

- wrapper/evidence ID mismatch -> bounded identity-mismatch exception before overlay;
- matching identity -> ordinary adapted input and `no_change` audit;
- registry record and `clinical_kb_site` -> separate-control-plane exclusion;
- missing required indexing-health/audit evidence -> fail-closed exception;
- reversed expected-provenance property order -> exact digest match;
- only measured not-retrieved/rank-exceeded failures -> actionable shadow classification;
- provider/timeout/role/governance failures -> non-actionable quarantine and report rejection before source-coverage classification.

### Deterministic CLI and import safety

The exact checked-in synthetic CLI was run twice to separate ignored outputs:

```text
node scripts/run-tsx.mjs scripts/audit-ingestion-corpus.ts --input tests/fixtures/ingestion/active-corpus-inventory.json --expected data/rag-expected-source-coverage.v1.json --output .local/rag-ingestion/reviewer-5-a.json
node scripts/run-tsx.mjs scripts/audit-ingestion-corpus.ts --input tests/fixtures/ingestion/active-corpus-inventory.json --expected data/rag-expected-source-coverage.v1.json --output .local/rag-ingestion/reviewer-5-b.json
```

Both returned 3 documents, 1 targeted reprocess, 0 shadow re-index, 0 blocked, and fingerprint `sha256:08bf1d12e8b431f3ec2e243fcc595b743acb222cb4bb7593fd766ce0834a5083`. Both JSON files had identical SHA-256 `f7421f631f846fe6570f8c0614224c2f7c0b221797b5ea3f5f891c1a0f7d3c6b`.

Import probe:

```text
node scripts/run-tsx.mjs -e "process.argv.push('--output','.local/rag-ingestion/reviewer-5-import-unexpected.json'); await import('./scripts/audit-ingestion-corpus.ts');"
```

Exited 0 and `reviewer-5-import-unexpected.json` did not exist. Import remains side-effect free and `--live-read` remains refused before input or output access (`scripts/audit-ingestion-corpus.ts:55-70`).

## Safety boundary and residuals

- Review and verification used only repository source code and checked-in synthetic metadata fixtures. No document, PDF, corpus payload, extracted text, OCR/parser output, upload, embedding, index operation, real query, live read, provider, network, database/Supabase, hosted state, migration, re-index, activation, deployment, push, or PR action occurred.
- The result is provider-free local contract evidence only. Live corpus, provider, hosted, re-index, and production acceptance remain intentionally unrun and are outside this task's acceptance boundary.
- No implementation residual or scope drift was found in the reviewed package.

## Verdicts

`SPEC_VERDICT: PASS`

The complete corrected range satisfies the schema-v1 read-only audit contract, causal retrieval and source-coverage semantics, canonical provenance identity, source-policy and document/site ownership boundaries, exact non-null action/disposition behavior, pure indexing-health adaptation with identity binding, privacy-safe deterministic output, and provider-free CLI requirements.

`QUALITY_VERDICT: PASS`

The implementation fails closed for missing, contradictory, non-index, governance, and cross-document evidence; compiles and passes focused and expanded synthetic tests at the reviewed head; preserves deterministic fingerprints and import safety; and introduces no unowned or external behavior.
