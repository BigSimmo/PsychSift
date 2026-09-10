# U04 amendment schema review 3

Date: 11 September 2026. Independent full-range source/design reassessment of frozen package 3, with unchanged source and prior review evidence reused. Reviewer: `/root/u04_amendment_schema_review_1` (Supabase Schema Guardian). This reviewer did not design either correction.

## Verdict

**Spec: PASS. Quality: PASS.** No remaining Critical or Important finding. The corrected proposal is sufficiently concrete for a fresh local implementer within the named file/symbol ownership and staged verification plan. This is design acceptance for local implementation, not acceptance of an implementation, executed SQL, deployed grants, operational staging, clinical behavior, or U04 completion.

The review follows candidate 3's explicit precedence. In particular, inventory-manifest-storage contract 1 replaces the earlier single-producer family record and implicit in-memory storage; document-owned-policy mapping 1 replaces the incompatible raw-marker-only P04 policy mapping. Frozen earlier reviews remain truthful FAIL evidence for their own packages.

## Exact review identity and observed route

- Worktree: `C:/Users/joshs/.codex/worktrees/rag-local-build-20260822/Database`.
- Branch: `codex/rag-local-build-20260822`.
- HEAD: `378c9c3997f91921d89aa6d919b5c9ef05b2152a`.
- `git status --short --untracked-files=no` returned no tracked changes. No unrelated/untracked inventory was requested or scanned.
- Package: `U04-amendment-review-package-3.json`, SHA-256 `d2f187773bf1969ec37e9f543df06be2a867e000c6ec11b50630cbb77782b5de`.
- Integrated candidate: `U04-integrated-amendment-candidate-3.md`, SHA-256 `f22d394f805f9eae44d1799fd652a43df5ff863056caa5b35761da3553c03acc`.
- All **23/23** package input hashes matched their actual bytes, with no mismatches.
- Own observed session: `01a08bf4-a9d3-7f31-941b-2f5cf775bd50`; parent `01a07b47-4623-7e90-825a-ec25116b8531`; agent path `/root/u04_amendment_schema_review_1`; provider `openai`.
- Selected `session_meta` and latest `turn_context` fields were read, with shared file access, from the exact own log `C:/Users/joshs/.codex/sessions/2026/09/10/rollout-2026-09-10T23-34-22-01a08bf4-a9d3-7f31-941b-2f5cf775bd50.jsonl`. Latest observed context timestamp `2026-09-10T16:14:06.593Z`: **gpt-6-astra / xhigh**. This is observed local resolved routing, not merely requested effort and not backend attestation.

Current AGENTS, review protocol/throttling and canonical execution instructions were read in this continuing review. AGENTS and canonical execution bytes were rechecked unchanged. This is an outside-repository design review, not a branch/PR completion review requiring a repository ledger mutation; no ledger was edited or appended.

## Prior blockers and correction evidence

### I1 — manual aliases missing from atomic capture input: CLOSED

The original trigger was a reviewed manual alias outside the wave, or disabled at capture, for which the two-argument capture RPC could not receive the required exact IDs. Request-context-and-capture contract 1 and candidate 3 retain the explicit four-argument capture signature, including `p_manual_alias_ids` and `p_execution_profile_digest`. The complete reviewed list is captured irrespective of enabled state, bound to the approved profile, and checked against source/owner/manual lineage. No discovery query silently broadens the evidence population. This closure remains unchanged from review 2.

### I2 — mixed core/deep-memory index units could not share a family: CLOSED

The original trigger was one core index unit with D=null plus one deep-memory unit with owned D in the same document/C/job/first-token family. Actual owners remain `worker/main.ts:1374-1396` and `src/lib/deep-memory.ts:710-723,781-795`; forcing one producer/D onto both would misattribute or omit evidence.

Inventory-manifest-storage contract 1 lines 7-19 now stores a strict manifest on the proposed member row, with a common document/C/job binding and the exact `worker_core` and `deep_memory` slots for `index_units`. Lines 26-42 bind the immutable first token, actual producer/version/output manifest, D or null, and disjoint complete unit sets per slot. Deep-memory D remains distinct from G0/C and shared across that producer's related families and receipt. Historical origins retain their original producer identities separately.

Lines 46-56 give the existing fixed inventory RPC the literal declaration envelope, atomic slot/unit/checkpoint mutation, one-way declarations, idempotent identical replay, once-final expected digest, full final digest, and direct-write protection. A producer's several ordinary append batches cannot become late additions to an already declared group: complete planned membership must be established before artifact persistence. The existing worker's multiple embedding-field append sites (`worker/main.ts:1244-1250,1342-1347,1422-1428`) are compatible with this requirement under the already owned orchestration changes; they do not require a new producer slot or a changed generation contract.

The separate durable-family gap is also closed: all 18 families and exact slots exist at enqueue, including zero-unit families; unknown/unavailable is distinct from reviewed known-empty. Complete manifest bytes survive reload and enter receipts/recovery. The contract no longer asks a fresh implementer to choose a new table or undisclosed persistence mechanism.

Line 58 resolves bootstrap and digest recursion: server control checkpoints precede declarations; artifact/projection writes require declarations; the inventory retains a declared pre-seal checkpoint and prior receipts; terminal control after-image and final stage receipt bind the inventory without hashing the receipt into its own preimage. The member/bundle retains both and the later whole-wave receipt binds completed member receipts. This is implementable without inventing a future timestamp or weakening first-token fencing.

### I3 — document-owned P04 policy conflicted with accepted U03: CLOSED

The original trigger was a legitimate `uploaded_local` document-owned member with no public-source metadata markers. Accepted U03 rejects the presence of `metadata.source_policy_version`, even null (accepted migration lines 98-103), while actual P04 requires a nonempty mapped policy value (`src/lib/ingestion-audit.ts:437-451`) and otherwise quarantines the record (lines 595-614). The old raw-marker-only mapping could not satisfy both.

Document-owned-policy mapping 1 lines 7-24 now supplies a strict, separately reviewed profile entry bound to exact document/owner/content and retained policy/review bytes. Capture binds the approved profile and effective policy; the mapper validates factual identity and supplies only the P04 output field. Raw metadata remains marker-free, including absence of `source_catalogue_key`; mapper output null does not add a raw null key. Catalogue mapping and all U03/P04 governance predicates remain unchanged. Unsupported/missing policy remains not ready, and mixed-policy waves refuse rather than selecting one member's policy.

Historical actual provenance is explicitly separate from current profile policy. Missing historical source-policy evidence cannot be filled from the current policy or expected values. Attributable historical evidence may produce a truthful P04 mismatch diagnostic; it is not rewritten to suppress that diagnostic. Lines 26-28 require an actual positive uploaded-local fixture with both U03 authority and P04 `eligibleForShadowPlan=true`, `blockingDisposition=null`, plus refusal cases. This closes the integration contradiction without editing accepted U03, P04, the old adapter, or source policy.

## Full corrected scope assessment

| Area | Spec / Quality assessment |
| --- | --- |
| Source and own-control equality | PASS. Exact first token and immutable original G0/source remain load-bearing. Selected document artifacts include history; selected Node/Edge jobs include all statuses; stage selection includes document OR selected job; batch siblings and source/version/event/approval/epoch closure remain included. Only exact ledger-owned new rows qualify as candidate additions. Each owned mutation records the exact checkpoint/after-image; no broad queue-field exclusion is restored. |
| Full preimage and precision | PASS. Reused prior direct lexical schema comparison established 335 existing stored fields over 22 tables, with no omission. Source/schema/column-contract pins are unchanged. Complete raw canonical envelopes, timestamps, numeric/vector precision, array order and future-field coverage remain explicit; new inventory_manifest is specifically included. Digests do not replace recoverable bytes. |
| Private projections and producer inventory | PASS. The five private-table design, complete 12-column summary/13-column quality projections, existing U02 validators, fixed counts/metadata allowlists, full generated labels and manual-label separation remain unchanged. New durable per-slot declarations close the mixed-producer and empty-family gaps; required missing evidence blocks seal, and optional limitations cannot satisfy a required evaluation capability. |
| Full transaction boundaries | PASS. Enqueue/terminal seal lock the fixed complete 22+5 relation set in qualified lexical order, SHARE ROW EXCLUSIVE NOWAIT at READ COMMITTED before facts/effects, then the accepted source/row order with finite timeout. Intermediate mutations retain U03 fencing and exact checkpoint equality without broad relation locks. Refusal rolls back; response loss stays outcome_unknown, without automatic retry. |
| Protection beyond the transaction | PASS as a concrete implementation requirement. Existing cleanup at schema.sql:2025-2262 and its service grant, standard commit page deletion near 12362, direct writes and reset/delete paths must exclude exact protected C/D at the actual write boundary. Reserved/building/staged/failed/ambiguous evidence cannot be released by an invented cleanup state. No U05 release executor is authorized. |
| Atomic evaluation reads | PASS. The fixed SQL operation surface requires unconditional logical-view guard plus returned evidence/data from one physical statement snapshot, including empty results, using the constrained STABLE/read-only design. Separate before/data/after hashes and production fallback remain forbidden. It claims observable snapshot equality, not proof that no historical ABA ever occurred. |
| Engine/context/manual overlay | PASS. Closed evaluation context precedes ordinary resolver/admin/site/index-version promises at both search and answer entrypoints; sticky failure collection survives caught failures. Cache/session/coalescing separation, fixed clock/config, exact-wave vocabulary and all dependent reads remain bound. Manual aliases remain exact reviewed full rows; unlisted or foreign generated aliases cannot enter evidence. Existing formulas/limits/ties and ANN uncertainty are preserved. |
| Profile bounds and deadlines | PASS for local implementation. The literal 8-member, 250,000-row, 256 MiB total and 2,000-row/16 MiB append ceilings, lower-only profile overrides, pre-effect size refusal, pre-dispatch 15-second server deadline, at-most-2-second lock timeout and 20-second client deadline are concrete. They are proposed operational ceilings, not performance proof. In-RPC statement_timeout does not establish a top-level deadline. |
| Reviewed P04 measurements | PASS. Literal policy, strict expectation/measurement/approval/witness records, complete denominators, source/producer provenance, complete relationship coverage, actual parser/classifier and independent source expectations remain implementable. Mocked versus real admission and missing-measurement refusal prevent invented fidelity or semantic success. The corrected noncatalogue policy mapping closes the previously incompatible positive path. |
| Tenancy, grants and ordinary visibility | PASS as design. New private tables and service-only fixed RPCs require explicit effective grants, postgres ownership/empty search_path, no helper execution exposure and enforced owner/source scope. Candidate C stays invisible under G0/null/malformed pointers; selection precedes ranges/limits/signing. Existing permissive policy OR-composition must actually be corrected where applicable; adding a restrictive-looking SELECT policy beside an existing FOR ALL policy is not sufficient. Null-owner fail-closed and the accepted public sentinel behavior remain unchanged. |
| U05 and whole-wave handoff | PASS. Full bytes, manifests, relationships, original source/control identities, member/whole-wave receipts and exact digests survive; no successful member substitutes for complete-wave readiness. Retained inert partial evidence remains NO_GO. No activation, promotion, retention release, cleanup execution or operational repair is introduced. |

The source-owner checks above are narrow consistency checks of the accepted scope, not a new repository audit. No unrelated refactor is proposed.

## Residual boundaries and fresh-implementer readiness

No remaining interface detail is an Important/Critical dispatch blocker. Normal implementation work still includes strict parsers, complete SQL bodies, matching schema/types, effective privileges/policies, precise control snapshots, producer orchestration and meaningful tests. The specification now fixes the choices previously missing: durable manifest location, literal family/slot membership, per-producer D, declaration/freeze lifecycle, acyclic terminal receipt and document-owned effective policy authority.

The fresh writer must not resolve runtime uncertainty by weakening the contract. If the exact approved ceilings cannot be supported or actual SQL semantics cannot meet the single-snapshot/locking requirements, the result is a refused operation or a concrete amendment for review. This possibility does not require SQL execution before local implementation.

Connected SQL atomicity, rollback/concurrency schedules, effective roles/grants/RLS, migration/snapshot parity, configured server deadline, realistic worst-approved-size behavior, provider/native/Storage evidence and semantic/clinical acceptance remain separately gated and unproved here. No source-only PASS substitutes for them. Ordinary G0 behavior and end-to-end complete engine behavior require future actual implementation evidence.

The verified runner/host work is not re-reviewed or rerun here. Package 3 retains host attempt 3 PASS for five synthetic lifecycle scenarios, exit 0, unchanged pins and restored preload environment, plus source review 6 PASS. That is host lifecycle evidence, not actual Vitest/product evidence. Exact future test input admission occurs after those files exist. Earlier host attempts 1/2 remain FAIL. The full ordered 26-suite offline RAG contract remains required; no historical U02 exception transfers.

Historical U02 offline evidence remains **exit 1, four failed suites, 45 failed and 586 passed overall**. P08A is superseded and the retrieval kernel remains default-off.

## Verification and work performed

Read-only verification: exact package/input SHA-256 comparisons (23/23 match), branch/HEAD and tracked-status inspection, unchanged governing/source hash comparison, correction and precedence reading, reuse of unchanged prior whole-range review/source evidence, narrow producer-site search and selected own-session routing fields. One read-only hash command initially had a PowerShell pipeline syntax error; its corrected invocation succeeded and did not change files. A combined document read exceeded output allowance; decisive correction texts were complete and the unchanged evidence-record contract had already been reviewed.

No tests, config execution, builds, servers, SQL, providers, real documents, Storage operations, ingestion workers, repository writes, commits, publication, other-task messages or delegation occurred. Only this new outside report was created, using CreateNew to preserve every earlier artifact. No additional source or report file was edited.

## Unchanged source identity

| Input | SHA-256 |
| --- | --- |
| AGENTS.md | 8206463dca576d6d1cba7c6b718c46738f88bc7716f3e09f976ffaa536f8c193 |
| docs/superpowers/rag-upgrade/canonical/sdd-execution.md | 115aed33d1fc760c0f418f7a6211ae6e18461a91258a84c6e9d23d47d509addc |
| supabase/schema.sql | 34c22c97cabd6b9a0f754265c1b4da69b440c5c250f66fb3bffa551b83a31741 |
| src/lib/supabase/database.types.ts | dcb21f4473fa1bc75d772583b2b5cbc239064f19084bc8a04514a852cc440480 |
| supabase/migrations/20260831101000_fence_ingestion_leases_and_repairs.sql | 92924c2c2b324866a18a0436a581b37886a44f440b6fbc8cd84fda22eed9ad0f |

## Frozen package inputs

All names below resolve within the stated outside handoff directory. Hashes were checked against actual file bytes.

| Input | SHA-256 |
| --- | --- |
| U04-integrated-amendment-candidate-3.md | f22d394f805f9eae44d1799fd652a43df5ff863056caa5b35761da3553c03acc |
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
| U04-inventory-manifest-storage-contract-1.md | b4ebd6e7796e6e5d1afc148c58a890f57e8bbaca4f4df4e8de09e6643af5248d |
| U04-document-owned-policy-mapping-1.md | c213a31822beda1d4e20cbd8706cb0f4caccf5a08fec01ea34ffd38a52cad521 |
| U04-amendment-schema-review-2.md | ecb6823b7d2870b15c1b3684b6efd256168322aef7141849195731e8dde587ec |
| U04-amendment-rag-review-2.md | 92e093d0e0e0b0f813f5b5c0687603a5d7bd70c19abd437a0baa00e1b493de7f |
