# U03 contract clinical and governance review 1

Date: 8 September 2026.

Specification PASS.

Quality PASS.

No concrete Critical or Important clinical/governance defect was found in the complete frozen documentation range. No correction is requested by this specialist review. These verdicts cover the documentation's clinical, source-authority, privacy and recovery contracts; they are not U03 implementation acceptance, execution-recipe acceptance, whole-programme acceptance or authority to run a connected operation.

## Exact review target and independence

- Worktree `R = C:/Users/joshs/.codex/worktrees/rag-local-build-20260822/Database`.
- Branch `codex/rag-local-build-20260822`.
- Immutable original base `fd043b262ebd9b20315c2e46bc4838265787fa80`.
- Candidate head `481270d8b4267d479bc78d58815b365439f8a2ec`.
- Complete range `fd043b262ebd9b20315c2e46bc4838265787fa80..481270d8b4267d479bc78d58815b365439f8a2ec`.
- Canonical package `R/docs/superpowers/rag-upgrade/execution-artifacts/rag-answer-quality-and-repository-coverage-v1/continuation-rag-source-ingestion-v1/U03-PREP/U03-contract-review-1.diff`.
- Observed package SHA-256 `1d32c81401e22eeabba54b5b5f02bcdd967a4cc43f2c43bd14a9e0c26cdc4c40`.
- The range contains one candidate commit and exactly five documentation files, with no product source delta. Tracked working status was empty at initial and final inspection; final HEAD remained the candidate head. Untracked discovery was disabled.

I read all five changed documents in full, including the full continuation plan, and the complete range's changes. The canonical package's added contents for the two new contracts were also compared with the reviewed files: 204/204 and 126/126 lines respectively, identical. The five owners are:

1. `docs/superpowers/plans/2026-08-31-ingestion-first-continuation.md` (CP).
2. `docs/superpowers/specs/2026-08-31-ingestion-first-continuation-design.md` (CD).
3. `docs/superpowers/rag-upgrade/continuations/rag-source-ingestion-continuation-v1/rag-evidence-handoff.md` (RH).
4. `docs/superpowers/rag-upgrade/continuations/rag-source-ingestion-continuation-v1/shared-contract-freeze-v1.md` (SC).
5. `docs/superpowers/rag-upgrade/continuations/rag-source-ingestion-continuation-v1/U03-execution-contract.md` (U03).

All file/line references below are relative to R at the candidate head unless prefixed with the outside directory. I read the root AGENTS.md review/routing rules, `docs/codex-review-protocol.md`, the local review skill, canonical `sdd-execution.md`, the exact `2026-09-07-execution-authority.md`, and the clinical governance preflight. No deeper applicable documentation AGENTS.md was present. This older worktree embeds review throttling in root AGENTS.md; the newer extracted `docs/agents/codex-review-throttling.md` does not exist here.

`npm run ledger:lookup -- codex/rag-local-build-20260822 --scope U03-contract-clinical-review-1` returned `NOT REVIEWED at this HEAD and scope`. This is the requested fresh independent pass. The controller owns the completed ledger append and commits.

I read the two fixed outside design contributions and independently checked the hashes pinned at U03:17-18:

- `U03-schema-contract-recommendation.md`: `adb0735ae327f04a2206a78f2bc2c7ba8a51ce6bded28d89042cdf6065f2da0c`.
- `U03-operator-compatibility-followup.md`: `b22168040664b13fb15d4b30f5e68a5fd53db4d1311798caba12f60ca982215a`.

I did not read the moving v3 recipe files or moving verification-preparation report. The separate execution reviewer owns their independent proof. This review checks the clinical/governance meaning of U03's verification requirements, not whether those external recipes satisfy compiler, staging or discovery equivalence.

## Findings and covered requirements

No blocking findings.

| Requirement | Reviewed evidence and conclusion |
| --- | --- |
| Fidelity, complete evidence and precise anchors | SC:11-48 and CD:224-232 separate full evidence from bounded overviews, bind exact original and representation identity, define UTF-16 half-open ranges against the persisted string, require transform mapping/native relationships, and refuse unresolved or substituted anchors. Format-specific page/cell/part identities preserve qualifications without inventing DOCX/XLSX pagination or executing formulas. SC:63 and 114-118 preserve independent positive denominators and actual-producer proof. |
| Structural versus semantic support | SC:50-63, RH:23-29 and CD:226-228 explicitly prevent U02 direct/partial/not_found, lexical overlap, anchor membership, model confidence or averages from becoming independent semantic verification. Unknown support stays unassessed. Optional unsupported interpretation does not destroy sound originals; finite fixtures do not become universal clinical proof. |
| R1 supplementary-source authority | SC:65-71 and RH:13-21 distinguish explicit restriction from primary preference, leave request selection with RAG, require independent passage eligibility, and retain eTG/AMH link-only and Healthdirect exclusion. Topic inference does not grant permission. Australian supplementation does not grant international expansion or silently replace valid local guidance. These remain eligibility/selection boundaries; no governance score is introduced as a retrieval weight. |
| R3 partial fallback and qualifications | SC:73-83 and CP:1425-1427,1573 require a known matching complete snapshot and explicit dependency proof for each retained part. Unknown qualification/dependency completeness refuses partitioning; stale or inaccessible substitutes cannot create partial success. Optional enrichment failures preserve independent originals, while hard failures still block their dependent evidence. Public limitations cannot reveal a denied source's private identity. |
| R4 accountable ownership | SC:85-100 and RH:39-45 assign implementation stewardship to source-governance Task 3, persistence/access and reconciliation to that owner, request binding to U12, and invalidation to U13. Clinical adjudication is explicitly unassigned, with a person/service, method and scope required before clinical acceptance. Empty arrays remain unknown. Current `src/lib/source-role-policy.ts:202-244,275-315` consumes caller-supplied reviewed differences and can return an empty array; SC:98 correctly requires a reviewed adapter before treating that legacy shape as an explicit reviewed no-material-difference result. No existing persistence or clinical reviewer is invented. |
| U02 preservation through atomic persistence | U03:97,105-109,175 preserve the accepted payload/projection, exact anchors, zero-label provisional fallback, structured-payload non-downgrade, manual labels and organisation-owned metadata. Its five-key enrichment metadata boundary matches the current owner at `src/lib/document-enrichment.ts:859-869`. Current summary/label/marker writes are separate at :917-989; the new contract closes that named persistence seam without redesigning the accepted normaliser. |
| Current authority, stale writers and quality | U03:45-113 requires both queues' durable attempts, exact generation handoff, current locked source authority, fixed domain operations and hard refusal without direct-write fallback. The P05 lock namespace and acquisition-digest reuse match `supabase/migrations/20260824123000_harden_public_source_lifecycle_authority.sql:4-51,95-101`; progress/generation are not part of that acquisition digest. U03:113,179 expressly prevents strict completion from laundering extraction quality. The named current problem is real at `supabase/schema.sql:4884-4915`, where strict completion sets extraction quality to good and clears issues. U10 retains threshold ownership. |
| Recovery and cancellation | U03:109,129-135,150-158 preserve producer/generation ownership, exact retry identity, cancellation propagation, private attempt-specific upload paths and no cleanup after ambiguous commit/attachment responses. The deep-memory protection at `src/lib/deep-memory.ts:839-853` is retained, and the earlier anchor/stamp plus later alias writes at :832-833,855-876 are included in the new atomic ownership. Lease loss does not authorise new failure writes, deletion of potentially committed bytes, or a repaired outcome. Planned repair audit is explicitly not applied repair. |
| Operator refusal compatibility | U03:115-127 refuses every backfill write request, all three enrich modes, and archived default/mutating calls before lazy operational setup. That location is necessary: `scripts/backfill-smart-index.ts:329-359,401-408` sets up clients/reads and later writes before enrichment; `scripts/enrich-documents.ts:526-549` creates its client in the lazy block; `scripts/archive/backfill-enrichment.ts:445-484` currently imports before parsing and probes health before dry-run return. The contract retains the two genuine read modes, includes the npm-callable archived script, requires actual-entry mocked tests and import safety, and forbids fake/optional fences. U13 owns deliberate write-mode re-enablement. |
| Acceptance and programme boundaries | CP:19,408,410, CD:242, SC:120-126 and U03:160-204 bind one original corrected U03 range and independent reviews. U03 remains unstarted; C01 is incomplete. Parent P00-P07/C00/U01/U02 history remains preserved. No source-only result is elevated to SQL, Storage, native extraction, provider, clinical, production-readiness or ordinary Answer acceptance. The kernel stays structurally default-off. |

The source reads above were limited to the named concerns. I did not restart the historical ING-F01-F16 audit or review unrelated source owners.

## Clinical governance preflight disposition

- Linked exact source verification remains required for source-backed clinical claims. Structure and technical completion do not confer semantic or clinical approval.
- This is a documentation-only range and introduces no patient-identifiable document workflow, source acquisition or provider call. Future U07/U08 content clearance remains explicitly required; U03 authority hashing is not a protected-content scan or cross-border disclosure approval.
- The Supabase target is unchanged by this range: Clinical KB Database (`sjrfecxgysukkwxsowpy`) remains the governing project. No hosted identity or database state was inspected.
- Service/private access stays behind server-side authority; proposed worker RPC grants are narrow, and neither database-owner nor arbitrary service-role confinement is falsely claimed. Actual grants/RLS remain unproved until their authorised runtime gates.
- Authored in-memory fixtures remain separated from actual clinical sources; native document processing requires its own exception.
- Unknown, outdated, withdrawn, unsupported and unreviewed states remain conservative. No clinical decision-support behavior is activated by these docs. Deployment classification/TGA assessment is not claimed here and remains required at the dependent clinical/serving change.

## Residual gates and dispatch limits

1. The separate execution review must accept the final frozen recipe bytes, input manifests and protected-safe compilation/migration-check equivalents. Its verdict cannot be inferred from this report. U03:194 explicitly leaves missing Next ambient declarations unresolved until an accepted generation route supplies them.
2. After the documentation/evidence freeze, U03 still needs the fresh implementation, actual-producer RED/GREEN, complete corrected all-writer source/SQL inventory, effective schema/type/grant reconciliation, and the named independent ingestion/schema/clinical reviews. No product gate has run for this documentation candidate.
3. Actual disposable SQL schedules remain separately authorised and unrun: expiry/reclaim, cross-queue isolation, policy interleavings, rollback, batch aggregation and audit grants. Mocked caller responses and schema text are not atomicity proof.
4. Native extraction, real Storage/provider cancellation, deployed roles, production-readiness and hosted/connected acceptance remain unrun at their governing boundaries. No worker, source acquisition, migration application, repair, activation, publication or kernel operation is authorised by this specialist PASS.
5. Source-governance Task 3 still needs its governed reviewed-difference record/adapter implementation and an appointed clinical adjudicator before dependent clinical acceptance. Separate RAG owners still need their consumer implementation and evidence. This does not block the bounded U03 lease implementation, which cannot mint or consume false clinical approval.

Historical U02 `eval:rag:offline` remains **exit 1, four failed suites, 45 failed and 586 passed tests overall**. It is not green and supplies no inherited U03 exception. Historical focused proof and the later two-file corrective acceptance are not new semantic, SQL or clinical proof.

## Requested and observed own route

Requested route: fresh independent `gpt-6-astra`, `xhigh`, role `clinical-governance-reviewer`, task `/root/u03_contract_clinical_review`.

I read only selected `session_meta` and `turn_context` fields from my exact log, using `FileShare.ReadWrite`:

`C:/Users/joshs/.codex/sessions/2026/09/08/rollout-2026-09-08T20-51-03-01a08112-6bd7-7b23-951a-277da5c47a16.jsonl`

- Line 1, timestamp `2026-09-08T12:51:03.881Z`: `session_meta.id = 01a08112-6bd7-7b23-951a-277da5c47a16`; parent `01a07b47-4623-7e90-825a-ec25116b8531`; agent path `/root/u03_contract_clinical_review`; role `clinical-governance-reviewer`; model provider `openai`.
- Line 8, timestamp `2026-09-08T12:51:07.163Z`: `turn_context.model = gpt-6-astra`; `effort = xhigh`; collaboration settings also record `model = gpt-6-astra`, `reasoning_effort = xhigh`.

This establishes my observed local resolved configuration, not backend attestation. It is not another child's route or an inference from the request.

## Actions performed

Only read-only Git/source/document/hash inspection, the required read-only ledger lookup, and selected own-session metadata inspection were performed. No tests, product gates, SQL, providers, workers, native documents, publication, commits, recursive agents or other-task messages were used. Protected `1/` and unrelated untracked files were neither enumerated nor read. This outside report is my only write. The controller owns integration, ledger append and commits.
