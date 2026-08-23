# P04 ingestion Task 1 review 1

## Findings

### 1. Important (P2) — missing and contradictory retrieval measurements are accepted as `retrieval_miss`

**Evidence:** `src/lib/source-coverage-registry.ts:89-93` substitutes an empty set when a must-pass case is absent from `retrievedDocumentIdsByCase`. The task contract says `retrieval_miss` means an active, eligible source was measured and the measured case did not retrieve it; an absent measurement cannot prove that outcome (`P04-ingestion-task-1-brief.md:196`). `src/lib/ingestion-audit.ts:373-382` also builds source coverage independently from each document's `mustPassCases`, with no cross-validation between the two evidence representations.

**Trigger:** supply an active expected source and active document, but omit its must-pass case from the retrieval map. The reviewer probe returned `retrieval_miss`. In a second probe, the document-level case said `passed: true` and rank 1 while the retrieval map explicitly contained the same case with no retrieved IDs; the report simultaneously returned document action `no_change` and source coverage `retrieval_miss`.

**Expected:** reject an absent case measurement as incomplete integrity evidence, and reject contradictions between per-document case evidence and the retrieval map. Only an explicitly measured empty result may become `retrieval_miss`.

**Risk:** the audit can prescribe a shadow re-index for an unmeasured case, or emit mutually incompatible evidence under one population fingerprint. That defeats the audit-before-mutation boundary.

**Smallest proof/fix:** add tests for an omitted case key and for both directions of document/map disagreement, then validate complete case coverage and consistency before classification.

### 2. Important (P2) — arbitrary source roles and content modes can be declared valid and receive `no_change`

**Evidence:** `src/lib/ingestion-audit.ts:97-105` accepts arbitrary non-empty strings for `sourceRole` and `contentMode`, then trusts the independent `sourceGovernanceValid` boolean. The accepted canonical role union is owned by `src/lib/types.ts:138-152`, and ingestion is required to import canonical programme vocabularies rather than define look-alike strings (`trusted-admin-document-ingestion-design.md:45`). Activated uploaded records also require `content_mode = indexed_content` and the applicable source/licence policy (`trusted-admin-document-ingestion-design.md:232-239`). The checked-in synthetic inventory itself uses unsupported `national_guideline` at `tests/fixtures/ingestion/active-corpus-inventory.json:69-72` while claiming governance validity.

**Trigger:** the reviewer probe supplied `sourceRole: "invented_authority"`, `contentMode: "link_only"`, and `sourceGovernanceValid: true`; `auditDocument` returned `action: "no_change"` with no reasons.

**Expected:** use the canonical `ClinicalSourceRole`/content-mode contracts and fail closed on unknown roles, link-only content, excluded-source evidence, incompatible corpus/content mode, or otherwise inconsistent policy. A caller-provided boolean must not override those invariants.

**Risk:** eTG/AMH-style link-only or otherwise non-indexable material can be reported healthy and eligible for later shadow planning if an adapter mislabels one boolean.

**Smallest proof/fix:** replace free-form policy strings with the canonical schemas/types, add explicit uploaded-local/indexed-content and protected-source checks, and add hostile unknown/link-only/excluded-source fixtures.

### 3. Important (P2) — integrity drift detection is one-sided and the fingerprint is not bound to the coverage/version contract

**Evidence:** `src/lib/ingestion-audit.ts:253-255` treats only `actual < expected` as a count defect, and lines 302-314 use that helper for page, chunk, searchable-unit, table, and image classification. Therefore surplus pages or artifacts can receive `no_change` despite the specification requiring expected-versus-actual integrity auditing (`rag-answer-and-australian-sources-design.md:219-229`). The audit schema also has no original-content hash, extraction/parser/configuration version, chunker/index-unit version, or source-policy version even though these are durable derived-artifact provenance (`trusted-admin-document-ingestion-design.md:225-239`). Finally, `scripts/audit-ingestion-corpus.ts:66-68` discards `coverageVersion`; `src/lib/ingestion-audit.ts:365-400` neither emits nor hashes it.

**Trigger:** changing page counts from expected/actual `12/12` to `12/13` returned `no_change`. Changing only the parsed expected registry's `coverageVersion` produced the same population fingerprint.

**Expected:** classify every unexplained count mismatch according to a deterministic repair reason, carry the relevant expected/actual hash/parser/validation/version evidence, and bind the report/fingerprint to both inventory and expected-coverage contract versions.

**Risk:** a duplicated extraction, stale parser generation, changed source policy, or validation-contract drift can be certified by the same fingerprint as the reviewed healthy state.

**Smallest proof/fix:** add over-count and version-drift regressions, introduce explicit expected/actual provenance fields (or a reviewed versioned digest that covers them), pass the complete parsed coverage registry to the report builder, and include its version in report identity.

### 4. Important (P2) — blocked documents remain counted and printed as reprocess/re-index candidates

**Evidence:** `src/lib/ingestion-audit.ts:281-285` classifies repair action without considering disposition; lines 327-333 then attach the block separately. `src/lib/ingestion-audit.ts:383-390` counts every action regardless of eligibility, and `scripts/audit-ingestion-corpus.ts:71-75` prints those unqualified totals. The task contract requires the blocking disposition to prevent precedence from re-indexing ineligible content (`P04-ingestion-task-1-brief.md:194`).

**Trigger:** a withdrawn document with missing pages returned `action: "targeted_reprocess"`, `eligibleForShadowPlan: false`, and `blockingDisposition: "tombstone"`; it is counted in both `targetedReprocess` and `blocked`.

**Expected:** a tombstoned/quarantined document must not appear as an actionable repair candidate. If diagnostic repair intent is retained, separate it from the executable action and exclude blocked records from actionable summaries/CLI output.

**Risk:** an operator or later planner consuming the action/summary field can target content that must only be tombstoned or reviewed, bypassing the intended fail-closed disposition.

**Smallest proof/fix:** assert that blocked records never contribute to actionable totals and expose either a non-actionable diagnostic field or a disposition-first action contract.

### 5. Important (P2) — allowed free-text failure strings can leak clinical or private content into the persisted audit

**Evidence:** `src/lib/ingestion-audit.ts:147-157` accepts arbitrary 200-character `failedExpectations` strings and lines 343-348 copy them verbatim into output. The existing privacy test at `tests/ingestion-audit.test.ts:198-225` checks only whether field names contain a few forbidden words; it does not constrain values. The programme requires bounded reason codes and counts rather than raw clinical queries or answer prose (`rag-answer-and-australian-sources-design.md:333`) and this task promises output containing no extracted clinical content (`P04-ingestion-task-1-brief.md:200`).

**Trigger:** the reviewer probe placed the synthetic marker `synthetic_private_excerpt` in `failedExpectations`; the serialized report emitted it unchanged.

**Expected:** accept only a bounded programme-owned failure-code vocabulary (plus opaque IDs/counts), or fail closed before writing any free text.

**Risk:** a future reviewed live adapter could persist query text, source excerpts, identifiers, or other sensitive material in `.local` evidence while the report is labelled privacy-minimised.

**Smallest proof/fix:** replace free-form failure messages with reason codes, add hostile value-level privacy tests, and keep any diagnostic prose outside the durable report.

## Package identity and scope

- Task key: `P04/ingestion/task-1`
- Immutable base: `be43d38daf9b22fdee11119a2e1509a951a04a20`
- Reviewed head: `036f47075b7d9ac2f7905ad78a69ab2e1e6733d4`
- Commit list: exactly `036f47075b7d9ac2f7905ad78a69ab2e1e6733d4`
- Canonical package: `docs/superpowers/rag-upgrade/execution-artifacts/rag-answer-quality-and-repository-coverage-v1/P04/P04-ingestion-task-1-review-1.diff`
- Package SHA-256: `278f87abe3b47fc401876375b4e279e94675ca004b553de90a24b4334ef8bc28`
- Brief SHA-256: `7580230b23e5f901eda6e25d9b4696e38203bc56a65b7f7b554847febd582255`
- Implementer-report SHA-256: `b067ad0f37101dc1abffaf9185c2bc86773c2352c08ea23a3fc0b93e80af36a3`
- Full range: seven new files, 1,186 insertions; no unowned tracked path was present in the package.

I read the repository instructions, both complete RAG specifications, programme manifest, task-verification and approval matrices, SDD execution contract, accepted P02/P03 receipts, ingestion plan preamble, exact task brief, implementer report, and the complete seven-file package. Review was local and read-only except for this required report artifact.

## Commands and evidence

### Identity and prior-review checks

- `git rev-parse HEAD` -> `036f47075b7d9ac2f7905ad78a69ab2e1e6733d4`.
- `git diff --stat be43d38daf9b22fdee11119a2e1509a951a04a20..036f47075b7d9ac2f7905ad78a69ab2e1e6733d4` -> seven expected files, 1,186 insertions.
- `Get-FileHash -Algorithm SHA256 <package>,<brief>,<implementer-report>` -> all three supplied hashes matched.
- `npm run ledger:lookup -- 036f47075b7d9ac2f7905ad78a69ab2e1e6733d4 --scope "P04 ingestion task 1"` -> `NOT REVIEWED at this HEAD and scope`. No branch/PR ledger record was appended because this is the programme's in-progress task-review artifact, not a completed branch or PR review.

### Reviewer behavioural probe

The following provider-free command used only the checked-in synthetic metadata fixture and pure library functions:

```text
node scripts/run-tsx.mjs -e "import inventoryJson from './tests/fixtures/ingestion/active-corpus-inventory.json' with { type: 'json' }; import coverageJson from './data/rag-expected-source-coverage.v1.json' with { type: 'json' }; import { auditDocument, buildIngestionAuditReport, parseIngestionAuditInventory } from './src/lib/ingestion-audit.ts'; import { auditExpectedSourceCoverage, parseExpectedSourceCoverageRegistry } from './src/lib/source-coverage-registry.ts'; const inv=parseIngestionAuditInventory(inventoryJson); const cov=parseExpectedSourceCoverageRegistry(coverageJson); const base=structuredClone(inv.documents[0]); const invalidPolicy=auditDocument({...base,metadata:{...base.metadata,sourceRole:'invented_authority',contentMode:'link_only'},sourceGovernanceValid:true}); const surplus=auditDocument({...base,counts:{...base.counts,pages:{expected:12,actual:13}}}); const blocked=auditDocument({...base,lifecycle:'withdrawn',counts:{...base.counts,pages:{expected:12,actual:0}}}); const missingMeasurement=auditExpectedSourceCoverage({expected:[{key:'active',owner:'owner',reviewStatus:'active',expectedDocumentIds:['doc'],mustPassCaseIds:['case']}],activeDocumentIds:new Set(['doc']),retrievedDocumentIdsByCase:new Map()}); const contradictory=buildIngestionAuditReport({inventory:{schemaVersion:1,inventoryVersion:'v1',documents:[{...base,mustPassCases:[{id:'case',passed:true,expectedDocumentRank:1,actualDocumentRank:1,failedExpectations:[]}]}],retrievedDocumentIdsByCase:{case:[]}},expectedCoverage:[{key:'active',owner:'owner',reviewStatus:'active',expectedDocumentIds:[base.documentId],mustPassCaseIds:['case']}]}); const v1=buildIngestionAuditReport({inventory:inv,expectedCoverage:cov.records}); const v2=buildIngestionAuditReport({inventory:inv,expectedCoverage:parseExpectedSourceCoverageRegistry({...coverageJson,coverageVersion:'changed-policy-version'}).records}); const privacy=buildIngestionAuditReport({inventory:{schemaVersion:1,inventoryVersion:'v1',documents:[{...base,mustPassCases:[{id:'case',passed:false,expectedDocumentRank:1,actualDocumentRank:null,failedExpectations:['synthetic_private_excerpt']}]}],retrievedDocumentIdsByCase:{case:[]}},expectedCoverage:[]}); console.log(JSON.stringify({invalidPolicy:{action:invalidPolicy.action,reasons:invalidPolicy.reasons},surplus:{action:surplus.action,reasons:surplus.reasons},blocked:{action:blocked.action,eligibleForShadowPlan:blocked.eligibleForShadowPlan,blockingDisposition:blocked.blockingDisposition,reasons:blocked.reasons},missingMeasurement,contradictory:{documentAction:contradictory.documents[0]?.action,documentCase:contradictory.documents[0]?.mustPassCases,coverage:contradictory.sourceCoverage},coverageVersionFingerprintsEqual:v1.populationFingerprint===v2.populationFingerprint,privacyStringEmitted:JSON.stringify(privacy).includes('synthetic_private_excerpt')},null,2));"
```

Observed results:

- invalid role plus `link_only` plus `sourceGovernanceValid: true` -> `no_change`, no reasons;
- page count `expected: 12, actual: 13` -> `no_change`, no reasons;
- withdrawn plus missing pages -> `targeted_reprocess`, ineligible, tombstone;
- active source with omitted case measurement -> `retrieval_miss`;
- contradictory document/map case evidence -> document `no_change` plus coverage `retrieval_miss`;
- coverage-version-only change -> equal fingerprints;
- synthetic private marker in `failedExpectations` -> marker emitted in serialized report.

The command exited 0; these are reproduced product-contract failures, not environment errors.

### Implementer evidence reviewed, not redundantly rerun

- Literal GREEN: `node scripts/run-vitest.mjs run tests/ingestion-audit.test.ts` -> 1 file / 9 tests passed at the reviewed head.
- Expanded GREEN: `node scripts/run-vitest.mjs run tests/ingestion-audit.test.ts tests/source-coverage-registry.test.ts tests/check-indexing-contract.test.ts tests/indexing-coverage.test.ts tests/reindex-pipeline.test.ts` -> 5 files / 29 tests passed at the reviewed head.
- Synthetic CLI -> 3 documents, 1 targeted reprocess, 0 shadow re-index, 0 blocked, deterministic fingerprint `sha256:fa1f769623f95a034fde03e23bb336cde52f60e65eb689833ee41623e9107cb8`.
- Scoped Prettier, documentation-index, maintainability, and full-range `git diff --check` were reported passing. `src/lib/rag/rag.ts` was untouched at 4,362/4,362 lines.

These commands do not cover the five hostile boundary cases above, so their green result does not close the findings.

### Exact-head typecheck

- `npm run typecheck` -> admission-blocked with exit 75: `DATABASE_HEAVY_RUN_ADMISSION_BUSY`; the current exclusive owner was another worktree running `npm run lint:internal` (PID 20520, started `2026-08-23T15:23:27.367Z`).

This is repository lease contention, not a product failure and not an exact-head typecheck pass. The earlier implementer typecheck preceded the final one-line generation correction, so exact-head compile evidence remains unproven.

## Safety and residual evidence

- No document, PDF, corpus payload, extracted text, OCR, upload, embedding, source fetch, network/provider call, database/Supabase access, migration, re-index, activation, deployment, push, or PR action occurred.
- CLI import safety and provider-free refusal behavior are correctly implemented in the reviewed range.
- The checked-in fixtures are synthetic metadata only.
- Exact-head typecheck remains admission-blocked. Live corpus, provider, hosted, and production acceptance remain outside this phase and unrun by design.

## Verdicts

`SPEC_VERDICT: FAIL`

The implementation does not yet satisfy fail-closed measured retrieval classification, canonical source policy, complete/version-bound integrity evidence, non-actionable blocking semantics, or privacy-minimised output.

`QUALITY_VERDICT: FAIL`

The code is deterministic and well-structured on its happy path, but the reproduced boundary failures can generate unsafe or contradictory operational evidence. The missing exact-head typecheck is an environment-gated residual, not the reason for the quality failure.
