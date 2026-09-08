# Shared ingestion contracts v1

Review candidate based on accepted checkpoint `fd043b262ebd9b20315c2e46bc4838265787fa80`. The independent acceptance record, not this heading, establishes the frozen revision. These contracts refine the adopted A1–A7/R1–R5 requirements; they do not accept unfinished product work or rewrite historical receipts.

Owners: [continuation design](../../../specs/2026-08-31-ingestion-first-continuation-design.md), [continuation plan](../../../plans/2026-08-31-ingestion-first-continuation.md), [RAG handoff](rag-evidence-handoff.md), [extraction acceptance](extraction-fidelity-acceptance.md), [U03 execution contract](U03-execution-contract.md). Current [execution authority](2026-09-07-execution-authority.md) permits serial local implementation after these gates. P05 source policy, P06 release/epoch/outbox authority and the accepted U02 summary contract remain their existing owners.

## 1. Scope and interpretation

The supported routes remain PDF/DOCX/XLSX/TXT uploads, policy-approved HTML/PDF acquisition and canonical eligible repository producers. Public retrieval eventually admits the active shared `uploaded_local`, `australian_public` and `clinical_kb_site` populations. This contract adds no formats, source licence, international expansion, ordinary-user private upload overlay, general crawler, formula execution or automatic source activation.

Use one source identity and an immutable content version throughout admission, extraction, storage, index generation, eligibility and resolution. A derivative carries its true upstream family identity as well as its own representation identity. Family membership deduplicates corroboration; it never proves agreement, support or permission.

Full evidence is distinct from a bounded display summary, selected context or query result. Existing U02 aggregate/category limits remain unchanged. All nominated source evidence and its required qualifications must remain resolvable outside that overview. An intentionally bounded projection cannot be reused as the complete source representation.

## 2. Evidence identity and coordinates — U09 supplies, U12 resolves

Every evidence unit binds the immutable source version, original artifact digest, representation digest/version, native unit identity, and the exact generation or release/epoch. It also carries source role, content mode, applicable policy identity and source-family lineage. Original/structured evidence remains stored independently of optional summaries and labels, subject to source rights.

The versioned text range is half-open `[start, end)` in **UTF-16 code units of the exact persisted evidence-text string**, after its declared transform. Record that string's digest and transform version. Bounds are checked against that exact string; code-point, byte and pre-normalisation offsets must not be treated as equivalent. A transform changing offsets supplies a source mapping or an exact native structural anchor. If neither can reconstruct the claimed relationship, mark the anchor unresolved rather than claiming exactness. Do not silently search another generation for a matching substring.

Native anchors supplement that text range:

| Format             | Required native identity and relationship                                                                                                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PDF                | Original physical page number, page geometry/rotation and extraction path; boxes declare coordinate origin, units and transform. Text/OCR alternatives retain distinct method identities for the same source region.                                    |
| DOCX               | Package/part identity and stable paragraph/table-cell/media relationship within that exact version; table row/column/header and footnote relationships remain attached. No invented physical page number.                                               |
| XLSX               | Worksheet identity and cell/range coordinates; distinguish source formula, cached value and displayed representation. Preserve merged-cell/header/unit relationships. Missing cached values stay unavailable; never execute formulas or external links. |
| TXT                | Original text artifact and declared decoding/normalisation mapping to the persisted evidence text.                                                                                                                                                      |
| HTML               | Policy-permitted retained snapshot and exact structural/text-node identity, including qualifying asides, tables, captions, footnotes and source links. A digest without recoverable retained evidence is insufficient.                                  |
| Repository content | Canonical producer identity, exact release/epoch and representation version, plus genuine upstream lineage where derived. Preview clipping never replaces the full body.                                                                                |

U09 chooses persisted field names against its real producers; it cannot weaken these coordinate semantics. U12 validates/resolves them in one snapshot. Schema storage choice is an owning-task decision; no generic coordinate service or duplicate source catalogue is required by this contract.

The supplier/resolver envelope is `source-evidence-v1`. Its required logical fields are below; an owning-task adapter must explicitly map an existing storage field to each field rather than duplicate the record:

| Logical field                                                 | Contract                                                                                                                                                                                      |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sourceBinding`                                               | The complete existing U12 candidate discriminant and its route-specific document/generation/activation or source-version/release/epoch binding; no cross-route optional-field bag.            |
| `evidenceId`, `representationVersion`, `representationSha256` | Stable unit identity within that immutable representation. The same unit ID under changed bytes is a different version, never an in-place identity substitution.                              |
| `originalSha256`, `sourceFamilyId`                            | Exact source bytes and corroboration lineage, separately from generated representation hashes. Unknown family is not inferred independence.                                                   |
| `originalEvidence`                                            | Exact retained text/structure payload or an access-controlled reference that this resolver actually resolves; its digest must match. A reference-only catalogue result is not ready evidence. |
| `anchor`                                                      | Versioned native anchor plus exact text range/coordinate declaration where applicable; unresolved anchors are typed unavailable.                                                              |
| `requiredEvidenceIds`                                         | Complete known qualification/structural dependencies in the same immutable bundle. Unknown dependency completeness is explicit and cannot prove safe partition.                               |
| `authorityBinding`                                            | Applicable policy/version, role/content mode, currentness and lifecycle/eligibility identity; validation comes from authority, not generated payload claims.                                  |
| `interpretation`                                              | Original extractive evidence or model interpretation, with separate structural producer support and independently assessed support/reference. Missing independent review is unassessed.       |
| `limitations`                                                 | Versioned typed stage/dimension/code and affected scope, retaining cause independently of the resulting eligibility decision.                                                                 |

`resolveSourceEvidenceV1` is a contract name for the U12 adapter boundary, not a new service mandate: it accepts exact candidate references plus the immutable request snapshot and returns this resolved evidence in that same snapshot or typed unavailability. U12 must bind that payload to its candidate result in the same invocation/evidence package; a second unbound "fetch latest" call cannot complete it.

## 3. Four independent verdicts and typed limitations

Keep these dimensions separate in producer output, serialisation, eligibility, resolution and acceptance records:

1. **Structure/identity:** shape, exact version, valid ranges and linked relationships.
2. **Extraction completeness/capability:** expected units, retained units, excluded/failed units and capabilities actually available.
3. **Source authority:** access, rights, currentness, policy, lifecycle and source role.
4. **Semantic support:** unassessed interpretation, independently assessed supported/unsupported interpretation, or inconclusive assessment with a scoped reason.

U02 `direct`/`partial`/`not_found` remain structural producer labels. They do not populate an independently assessed support verdict. A model result, anchor membership, lexical overlap, confidence downgrade or quality average cannot create that verdict. Absence claims are limited to the selected/inspected evidence unless full relevant coverage was proved.

Use a closed, versioned reason vocabulary at the owning implementation seam. The required distinctions include unsupported feature, unavailable native/OCR capability, resource cap, missing unit/qualification, unresolved coordinate, native/OCR disagreement, optional enrichment/provider failure, unsupported interpretation, policy/access rejection, stale source/snapshot, unreviewed difference, reviewed material conflict, cancellation and lease loss. Each reason binds the affected unit/artifact/stage, whether it is critical to the requested evidence, and its effect on eligibility. Do not collapse these into one success flag or free-text error. U09/U10 own extraction and eligibility reasons; U08 authority/egress; U03 attempt refusal; U12 resolution; U13 invalidation.

Expected inventory is identity-based. Every expected unit is retained, deliberately excluded, failed or skipped with its reason. Counters must reconcile to that inventory. Failed and withheld positive fixtures do not count as preserved evidence. Existing finite E1–E7 expectations, including late evidence and ordinary explanatory paraphrases, supply the denominators; there is no universal semantic guarantee.

## 4. R1 source preference and restriction

Request interpretation remains with the separate RAG owner. It supplies an explicit mode: restricted source set, or preferred primary with permitted supplements. A topic inference is neither an access grant nor a source restriction. Unknown/contradictory restriction resolution is not widened by ingestion.

For restricted mode, the consumer may use only evidence belonging to the explicit authorised set. For preferred mode, independently eligible approved supplementary passages may fill a supported material gap; they do not silently replace valid local guidance. Supplements-disabled, role-ineligible and link-only states remain distinct. eTG/AMH remain link-only and Healthdirect excluded. Unseen linked content cannot support a factual gap.

The passage-level reference map records source role, exact version/anchor, permitted claim role and readiness: catalogue-only, admitted, retained, indexed, technically eligible, retrievable or consumer-accepted. Those states are not synonyms. U07/U12 enforce supplier authority and eligibility; RAG owns bounded request selection and source preference. U12 gains no broad query fanout or ranking-policy implementation from this contract.

## 5. R3 partial resolution without weakened authority

Retain the planned `ready | partial | insufficient` result union and version it with the U12 kernel/evidence contract. All successful candidates carry resolvable original evidence and qualifications; a candidate identifier by itself is insufficient evidence delivery. The resolver must return a typed unavailable outcome if the exact payload cannot be resolved. No old-generation, inaccessible or family-adjacent substitution is allowed.

- `ready`: non-empty eligible evidence, exact immutable request snapshot, and no unresolved issue affecting that returned evidence or a required qualification. This is supplier readiness, not complete coverage of the user's question or semantic verification of generated prose.
- `partial`: non-empty independently eligible evidence plus non-empty bounded unresolved reasons. The complete request authority/version snapshot is known and matches. Every retained part is proven independent of the excluded claim, required qualification, source authority and material-difference scope.
- `insufficient`: no safe non-empty set, unknown/mismatched snapshot, or inability to establish that independence. Material conflict blocks the affected set; unknown review state cannot be presented as a reviewed no-conflict result.

The dependency proof is tied to explicit source units/relationships and reviewed claim scopes, not a model assertion or mere topic separation. Unknown cross-unit dependency means the candidate set cannot safely be partitioned. A denied or withdrawn supplement may be omitted only if the remaining source's authority and qualifications are independently sound in the same current snapshot. Do not expose the denied source's private identity in public limitation payloads.

Optional summary/enrichment failure cannot erase valid original evidence or make a fallback claim more complete than its input. Required safety, permission, source, generation and critical-completeness failures still block their dependent evidence. RAG P08B/P08C/P12 own how the supported subset and its limitations are composed and displayed; internal owner, review and private identifiers are not automatically public DTO fields.

## 6. R4 reviewed differences and accountable ownership

The **source-governance Task 3 owner** (`src/lib/source-governance.ts` and `src/lib/source-role-policy.ts` contract) owns canonical reviewed-difference creation, persistence/access policy and reconciliation rules. This is a named implementation owner, not a claim that the required clinical reviewer has been appointed or that persistence already exists. Reuse its `SourcePolicyConflict` vocabulary; do not create a competing clinical conflict model in U03 or U12.

| Responsibility                                                                                                                               | Owning task and acceptance boundary                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Propose a material difference with both exact source versions, permitted passages, claim/population/qualification scope and supporting units | Source-governance Task 3; a proposal is unreviewed data.                                                                                                                                                                       |
| Clinically adjudicate supported differences or explicit no-material-difference                                                               | A user-appointed clinical/subject-matter reviewer; currently **unassigned**. Clinical acceptance remains blocked until the person/service, method and scope are recorded. No model or administrator role silently substitutes. |
| Persist and access-control the canonical reviewed record and immutable review reference                                                      | Source-governance Task 3; a narrow governed owner, no direct model-authored canonical record.                                                                                                                                  |
| Load exact review identity for the immutable evidence request                                                                                | U12 supplies source/version/review binding; separate RAG P08C consumes it.                                                                                                                                                     |
| Present supported differences with correct authority                                                                                         | Separate RAG P12; not ingestion acceptance.                                                                                                                                                                                    |
| Expire/reconcile after replacement, withdrawal, review expiry or policy change                                                               | U13 invalidates synchronously; source-governance Task 3 creates any reviewed replacement.                                                                                                                                      |

At the boundary distinguish `unknown/unreviewed`, `reviewed_difference` and `reviewed_no_material_difference`, all with explicit scope. An empty differences array alone is unknown. Existing consumers that accept only an array require a reviewed compatibility adapter in their owning task; do not retrofit that array into evidence of no conflict. Clinical records cannot outlive either source/version/policy binding. Native/OCR disagreement stays a separate extraction limitation.

The unassigned clinical person and separate RAG execution owner prevent their dependent clinical/consumer acceptance, not U03's source-only lease work. Formal review must verify that the U03 implementation cannot mint or consume a false clinical approval. This explicitly records the unresolved evidence instead of declaring R4 fully operational.

## 7. Attempt, egress and artifact boundaries

The [U03 execution contract](U03-execution-contract.md) binds each actual Node/Edge mutation owner to a durable attempt and server-owned generation/policy authority. Same worker ID is not the same attempt. Authority validation and mutation must be atomic; client preflight and RPC argument mocks cannot establish that property. Required runtime SQL schedules remain separately authorised.

Carry the attempt/cancellation guard to every provider/native invocation boundary and check again before publishing its result. Cancellation/lease loss prevents further work and late publication; it cannot retract bytes already sent to a provider. U07/U08 own admission, malware/identifier/rights clearance and pre-egress permits. U03 must expose the guard without claiming those later clearance gates exist.

The complete artifact inventory includes pages/OCR/layout and private evidence objects; chunks, embeddings, index units, embedding fields and table facts; images/captions; sections/cards and deep-memory generations; summaries, generated labels and projection markers; aliases; document/quality metadata; stages, heartbeats, jobs, terminal/sibling/batch state; caches; and repair audit. U04 stages the inventory, U05 owns its single switch/retention, U10 supplies the final eligibility receipt, U13 owns invalidation and governed cleanup. U03 fencing is not a second activation mechanism.

No task can declare completion using only the active pointer if other writers can still overwrite evidence. Candidate Storage objects need attempt/generation identity, no overwrite of shared current paths and safe exact-owner compensation; ambiguous/lost-response publication is never followed by destructive cleanup of potentially committed evidence. Existing deep-memory lost-response protection remains mandatory.

## 8. Acceptance and early user value

Reuse E1–E7 and H1–H7 with one shared reference case: primary source supports two requested parts, an approved supplement supplies a third, and a fourth is unresolved. Record every supported part and qualification through actual source producer, retained structure, index unit and U12 resolution. The separate RAG owner proves packing, verified claim retention and full display/copy. A mock finaliser object alone cannot supply producer proof.

The early milestone is retrievable preserved evidence, including late qualifications and exact source anchors. It can prepare authored in-memory adapter tests under current authority; native file extraction requires the separate synthetic-document exception. Do not accept U09/C03 out of order, activate the kernel or claim ordinary Answer availability from this milestone.

Finite positive fixtures must preserve every nominated critical atom/relationship; negative mutations must not gain supported status. Record preserved, withheld and missing separately. Improve the targeted weak Answer cases by supported requested-part coverage or useful supported explanation; longer generic prose and ties do not establish improvement. Semantic/provider usefulness needs its own authorised reviewer/evaluation.

## 9. Freeze, implementation and residual decisions

Independent xhigh review covers this full contract and the concrete U03 brief. Preserve all failed reviews, resolve Critical/Important findings, pin the accepted original range/hash, then dispatch one fresh U03 implementer at the required High floor. Later unit briefs inherit these semantics and choose their smallest concrete storage/type implementation; a change to a frozen semantic boundary requires a reviewed amendment before dependent implementation.

No renewed general approval is needed for authorised local work. Actual-source licence/retention, international expansion, the clinical adjudicator, native fixture execution, disposable SQL, providers/hosted acceptance and publication/activation remain separate decisions before their dependent actions. Unknown states retain conservative behaviour. C01 remains incomplete; U03 remains unstarted until dispatch; P00–P07/C00/U01/U02 history remains unchanged; P08A superseded; kernel default-off.

Historical U02 offline evaluation remains exit 1, four failed suites, 45 failed and 586 passed overall. Its exception is not green and not inherited. The latest U02 corrective acceptance is the two-file product at `876cb09405d81d9c4a8a4931b3d735fd252934ba` with 103/103 focused tests and reviewed Edge compilation equivalence, not new semantic or runtime proof.
