# U04 whole-unit amendment schema review 2

Date: 11 September 2026 (Australia/Perth). Independent corrected whole-unit source/design review.

- Specification compliance: **FAIL**.
- Design/interface quality: **FAIL**.
- Critical findings: **0**. Important findings: **2**, I2 and I3 below.
- Prior schema I1 is **closed** by the corrected fixed capture interface. Package1 and its FAIL report remain valid historical evidence.
- Fresh implementation dispatch remains blocked by the two concrete contract conflicts below. No SQL execution or real measurement run is required to correct them.

## Important I2 — one family-level producer/D binding cannot represent mixed index-unit producers

**Evidence:** `U04-evidence-record-contract-1.md:29-33` gives a candidate ViewBinding one artifactGenerationId. Lines 110-123 require exactly one FamilyManifest per Family, with that binding, one producer and one outputManifestDigest. Lines 42 and 133 simultaneously require core index units to have null D and local-worker deep-memory index units to have D. The literal manifest lacks a per-unit or producer-subset binding that can express both. Its immutable pre-write expected population also needs to accommodate those separately planned producer stages without retroactively changing the first declaration.

This is an actual supported producer combination: `worker/main.ts:1374-1396` builds and writes visual index units through the base-artifact path, while `src/lib/deep-memory.ts:710-723,781-795` independently generates a distinct artifact generation and writes additional local-worker index units with D. The integrated amendment keeps both owners and explicitly requires retaining both outputs.

**Trigger:** One candidate document produces at least one core visual index unit and at least one local-worker deep-memory index unit. A single index_units manifest cannot set its one D to both null and the deep-memory UUID. Choosing null fails the D rule for deep-memory output; choosing D misattributes core output; creating two FamilyManifests violates the exact-one-per-family rule. Treating this D as merely an advisory envelope field would invent semantics that the strict contract does not define.

**Expected:** A family-level completeness result binds both independently declared producer subsets, each with exact C/job/token and its own producer/D/output-manifest identity, without replacing one producer's expectations or discarding output from the other.

**Smallest correction:** Keep one family summary whose common binding ends at source/member/C/job/first-token. Define literal per-unit or per-producer subset records carrying D, producer identity, requiredness and outputManifestDigest, with disjoint complete expected-unit membership and immutable declaration-before-that-subset-write rules. Name exactly how the family closes after its approved producer subsets are terminal. The existing per-unit inventory artifact_generation_id/producer fields already provide storage; this does not need a new table or generic producer mechanism. Apply the same common-versus-unit distinction to aggregate families where multiple source/projection owners are deliberately retained.

**Smallest later proof:** Actual candidate reconciliation accepts one core-null-D plus one deep-memory-D index unit in the same family after both predeclared subsets finalize; it rejects wrong D/token, duplicate membership, undeclared late output, altered earlier expectations and omitted available output. Partial optional deep-memory failure must preserve bytes and cannot satisfy its required evaluation capability. No tests were executed here.

## Important I3 — document-owned policy mapping conflicts with unchanged U03 authority

**Evidence:** Origin transaction contract 3 line 48 requires the exact metadata mapping from the existing audit adapter, including source_policy_version. The actual adapter at `scripts/lib/indexing-audit-adapter.ts:104-126` maps metadata.source_policy_version to P04 metadata.sourcePolicyVersion and requires equality. The new evidence appendix at lines 42 and 259 keeps unchanged U03 authority and that mapping; its proposed positive fixture at lines 265-268 is uploaded_local/document-owned.

Actual P04 `src/lib/ingestion-audit.ts:437-451` requires a nonempty metadata.sourcePolicyVersion for every admitted document-owned corpus scope; lines 595-614 quarantine invalid source policy and set eligibleForShadowPlan=false. But unchanged accepted U03's non-catalogue branch at `supabase/migrations/20260831101000_fence_ingestion_leases_and_repairs.sql:98-103` refuses the presence of metadata.source_policy_version, even null, as a stray public-source marker. It likewise refuses presence of source_catalogue_key, so copying the adapter fixture's explicit-null catalogue key into raw document metadata is not a valid authority fixture either.

**Trigger:** Prepare a valid non-catalogue uploaded_local document for shadow staging. If its raw metadata contains source_policy_version to satisfy the literal P04 mapping, U03 authority refuses capture/claim. If the key is absent to satisfy U03, the exact mapper yields null and P04 quarantines the document. The current specification offers no explicit third mapping. Merely making the fixture parse or classify diagnostically does not prove a supported document_owned record can reach authorized staging.

**Expected:** The U04-specific mapper has a reviewed source-policy evidence source for this branch that can coexist with the unchanged U03 marker prohibition. Its raw origin remains exact and policy/provenance authority is independently bound; no key is silently fabricated, overwritten or treated as absent.

**Smallest correction:** Define an explicit non-catalogue U04 mapping for the P04 policy field using independently approved, origin/profile-bound policy evidence and attributable producer provenance, while keeping the raw document marker absent and all existing U03/P04 predicates unchanged. Name precedence and disagreement refusal against the reviewed expectation/profile/provenance records. If that evidence cannot support the intended branch, explicitly narrow and document the supported target population before dispatch. Do not weaken U03's public-marker refusal, alter P04 policy validation, use a current configured default, or silently declare all document_owned inputs permanently unavailable.

**Smallest later proof:** An authored authority-valid uploaded_local origin with neither prohibited marker key, plus valid independently bound policy evidence, reaches the actual mapper and P04 with the intended non-blocked eligibility/diagnostic. Adding either stray marker, supplying mismatched policy/profile/provenance, or omitting required reviewed policy evidence fails before clients/mutation. Include the catalogue path unchanged. This is a U04 integration finding, not a new review verdict on accepted U03 or P04; their individual contracts remain retained.

## Corrected findings and complete scope disposition

Prior I1 is closed: request-context-and-capture contract1 lines 9-17 supplies required sorted unique manualAliasIds plus profile identity to the same fixed STABLE capture. It binds full disabled/out-of-W selected rows into the origin; baseline, enqueue, seal and reads validate the same profile/list. A digest alone is expressly not approval. This resolves the two-identical-W/different-M counterexample without a global alias read or a second capture.

RAG request-context correction is coherent at the inspected source seams: actual `rag.ts:1551-1560,2404-2407` and `rag-cache.ts:534-605` establish why branching must precede the ordinary resolver and its promises. The appendix now names that branch, rejects foreign supplied snapshot/promise identity and forbids resolve-then-overwrite. The unchanged pure helper at `rag-context-snapshot.ts:119-127,176-180,198-237` supports the proposed disabled site partition and synthetic document identity without provider reads. That compatibility object remains separate from real owner/public/source authority and cannot authorize public evidence. Actual engine closure remains part of the RAG review and later mocked implementation proofs.

The new evidence appendix closes the earlier descriptive-shape gap substantially: finite reference/relationship/limitation unions, explicit 18-family retention/capability rules, exact existing P04/U02 schema reuse, one supported reviewed-manual policy, exhaustive witness identity/denominators, explicit reviewer admission binding and real/mocked separation are now specified. Missing real measurements is an operational not-ready dependency, not a demand for a new assessor. The concrete mixed-producer binding and document-owned policy mapping conflicts above remain; the implementer must not improvise their resolution.

The complete corrected proposal was assessed, reusing unchanged evidence from schema review1 rather than re-auditing untouched source:

- **Origin/control:** 335-column/22-table literal coverage, all historical artifacts/queues, OR stage closure, batch siblings, source/event/approval identities and exact owned control after-images remain required. No ignored queue columns, timestamps or metadata-based ownership. Original history and owned additions stay distinct. Source/profile mapping must be corrected as I3 specifies.
- **Precision/digests:** raw canonical payload bytes, domain/encoding/length, meaningful array order, bigint/vector/timestamp precision and complete rows remain authoritative. New typed references locate evidence; they do not replace its retained bytes. Explicit new evidence/request domains are proposal additions, not a change to old P04/provenance digests.
- **Private projections/inventory:** full summary/quality rows, fixed metadata ownership, server-derived C/token identity, private generated labels/aliases and subordinate D avoid live singleton overwrite. Declare before writes; preserve partial/optional output and fail required evidence closed. I2 must fix the family-versus-producer binding before these literal validators are implementable for mixed output.
- **Locking/preservation:** full barriers only at enqueue/terminal seal, READ COMMITTED fresh facts, accepted source/row lock order, bounded remaining contention and complete rollback remain coherent. Intermediate fenced writes do not claim whole-origin equality. Existing cleanup and direct reset/commit/delete/page-replacement paths must protect every retained C/D at the actual write boundary, including failed/ambiguous members.
- **Read consistency/metrics:** per-read same-statement full guard plus evidence, affirmative empty results, fixed clock/settings, exact-wave vocabulary and sticky failure remain sound local contracts. Preserve effective formulas/branch limits and acknowledged ANN/tie uncertainty. Full retrieval/answer metrics and complete case denominators cannot come from extraction-quality rows or direct-wrapper diagnostics.
- **Privileges/visibility:** service-only fixed entrypoints, postgres ownership, empty search_path, unexposed helpers, private-table RLS and no ordinary read policy remain required. Restrict effective existing permissive FOR ALL/SELECT policies where needed, not merely add an OR-combined narrow policy. Preserve null-owner refusal/public sentinel mapping, generation-before-limit behavior, explicit legacy-null and malformed-pointer isolation.
- **Bounds/U05:** numerical operation ceilings are concrete enough for local refusal implementation; they prove no operational performance. Pre-dispatch server deadline/role configuration and client outcome_unknown remain distinct. Full bytes/relationships/control receipts and uncertain object dispositions go to U05; no activation, cleanup executor or inferred technical/clinical acceptance is introduced.

Apart from I2/I3, no additional high-confidence Critical/Important dispatch blocker was identified. A final file/symbol brief and staged verification admission remain required as already specified; no actual Vitest command is demanded before its test source exists.

## Evidence and observed route

Repository `C:/Users/joshs/.codex/worktrees/rag-local-build-20260822/Database`, branch `codex/rag-local-build-20260822`, observed HEAD `378c9c3997f91921d89aa6d919b5c9ef05b2152a`; tracked status clean. No untracked enumeration. Current AGENTS and canonical SDD instructions remain the same inspected source; their requirements were reused. This is an outside amendment review, not a branch/PR review; no repository review-ledger mutation is due.

Package2 SHA-256: `b44e6217976b42154fc2501795c8126aeb7ad9127ab929cd51f9880054f1c0a0`. Integrated candidate2 SHA-256: `2288097489ce4a279b49586b1e79320505f9b941e42056e51ef9780870e7ab06`. All 19 package pins matched before review. Candidate2's explicit precedence governs the new appendices and supersedes competing old interface interpretations.

Current source identities reconfirmed: AGENTS `8206463dca576d6d1cba7c6b718c46738f88bc7716f3e09f976ffaa536f8c193`; canonical sdd-execution `115aed33d1fc760c0f418f7a6211ae6e18461a91258a84c6e9d23d47d509addc`; schema.sql `34c22c97cabd6b9a0f754265c1b4da69b440c5c250f66fb3bffa551b83a31741`; accepted U03 migration `92924c2c2b324866a18a0436a581b37886a44f440b6fbc8cd84fda22eed9ad0f`. The unchanged 335-column source comparison from review1 is reused, not claimed as rerun.

Own identity: agent `/root/u04_amendment_schema_review_1`, session `01a08bf4-a9d3-7f31-941b-2f5cf775bd50`, parent `01a07b47-4623-7e90-825a-ec25116b8531`, provider openai, Supabase Schema Guardian. Exact own log `C:/Users/joshs/.codex/sessions/2026/09/10/rollout-2026-09-10T23-34-22-01a08bf4-a9d3-7f31-941b-2f5cf775bd50.jsonl`: matching session_meta at `2026-09-10T15:34:23.086Z`; latest selected turn_context for this correction at `2026-09-10T16:01:37.495Z` reports **gpt-6-astra / xhigh**. Observed local resolved configuration, not requested-parameter inference or backend attestation. Reviewer remains independent of the design contributors.

Read-only checks: exact package/pin/source hashes, branch/HEAD/tracked-status, bounded source/doc text reads, and outside candidate1-to-candidate2 text diff. `git diff --no-index` returned 1 because the proposal files differ, not a test failure. One guessed context-helper path was absent; the actual rag-cache import resolved it to rag/rag-context-snapshot.ts, which was inspected. No product/config modules were executed.

No tests, config loads, SQL, providers, real/native documents, workers, servers, installs, repository/source changes, commits, publication or delegation occurred. The only write is this new outside report. Runner host attempt3 PASS/five scenarios/exit0, unchanged pins/restored environment and source review6 PASS are supplied frozen controller evidence; their review was not duplicated. Host proof does not establish actual Vitest discovery/report/error-accounting or product acceptance.

Actual SQL concurrency/rollback, installed grants/RLS, migration/snapshot parity, effective timeout/profile performance, real measurement/native/Storage/provider and clinical proof remain separately authorized and unrun here. Historical U02 remains **exit 1, four failed suites, 45 failed and 586 passed**, not green and not an inherited U04 exception. Preserve every failed review and freeze the next corrected whole-unit package before independent reassessment.

## Exact package2 input hashes

| Input | SHA-256 |
| --- | --- |
| U04-integrated-amendment-candidate-2.md | 2288097489ce4a279b49586b1e79320505f9b941e42056e51ef9780870e7ab06 |
| U04-controller-contract-decisions-2.md | 2e1c3e0c38b3d289e8b290e72246937188376dd418fa355a585f838dc7586346 |
| U04-evaluation-interface-contract-3.md | eccb897da735c27aeb7c9d5fcec5a8da14d8b9ff166bf7ee0d81876bb6245a11 |
| U04-evaluation-sql-binding-1.md | 6ffbeb7351e0ad6b58ff293c2441017a671cc54a0315caa2dd7dce64ec45a8de |
| U04-origin-transaction-contract-3.md | 60dfd0cdaa29dd717154cc90622a1c178bc6b0c00f66c16c2cf6323682f3c520 |
| U04-origin-column-parity-1.md | e541c1f6495c6c7a480d6d48a8a3d0cd171d58aedf3f46bc51021407d2e2ce22 |
| U04-origin-column-contract-2.json | 8f933621bfa7d9a73e839567e5fe368dd53f23436cd05eda26c81011ef7fab90 |
| U04-controller-contract-decisions-1.md | 37ecdb202c75a462a8a43b04c06a036ade7e28ff403a7a255e36bde6d15f43f8 |
| U04-state-comparison-contract-1.md | 27f4635420851f9e8ba00d76f57d57b6dad7f18296b7c2cf785a8ee690e25af2 |
| U04-schema-contract-recommendation-1.md | 8ac2b47f8448bc851c9ac447eb87a7fa23af6208a3596061531b20337b54528e |
| U04-controller-acceptance-constraints-1.md | 974222d88439ebb4300851d446ce403b4bda7f35a8c3a26a0bc172b87280484a |
| U04-task4-at-b335cfbe5e.md | f968d03ff603dbbc35b39a7a2c9a326efe4a6d3ef3447d7bcf0bea99b16956b5 |
| U04-request-context-and-capture-contract-1.md | 236171701e986f98a9d643412417d0d1ddc3dff2babf29f0b6d9791da444e9cb |
| U04-evidence-record-contract-1.md | 34bb0981884966bef9a664e70bc28938cee9949bd58f1cd1514a74f310eeb03e |
| U04-amendment-correction-disposition-1.md | 5d5505c09cc982653156be0edc07a3c6e32a68b82fa91760c1c7566bba292cf2 |
| U04-amendment-rag-review-1.md | 1d484cf1fbf59042e306b20f0d30168693b7bd74e55d457c6442076e8d65aed7 |
| U04-amendment-schema-review-1.md | 6f92b33b0db23a96d36bc06eaeab77ec90d0842b2f2416d4f8f11b4c8d8ad136 |
| U04-host-lifecycle-acceptance-1.md | 907ced0f3f039e80261ecf54cde9eea7a5cbcf876ba8dfa7e39c365a8a0a8d9c |
| U04-host-experiment-review-6.md | 11f0d9c70d9abef2b38f3da6f9e087b07f50584f0d3175a6f6ab49e2d6969932 |
