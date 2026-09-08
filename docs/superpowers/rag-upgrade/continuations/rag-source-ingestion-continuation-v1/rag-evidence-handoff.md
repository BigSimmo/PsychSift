# Ingestion evidence handoff to the separate RAG programme

Adopted R1–R5 requirements under [current execution authority](2026-09-07-execution-authority.md). ING-F01–F16 retain ingestion identity; RAG-F01–F21 remain findings in the separately assessed programme. Current ingestion evidence establishes an ingestion defect; the other worktree diagnostic alone does not.

Provenance: RAG assessment SHA-256 984be51bbababa37326e401b0ec581c05d4cb42050dc566fa7aa70e2d4dfb964; handoff 38a7ab31b0b405dabdf5cb54be9f8392d4575ae2fa152d8b974064c19cb52252; snapshot d927d3429731cacf42ad213bea27d83991565e4585781651694777bd29e215bb. These match completed ingestion audit references. RAG assessed HEAD 64da5e56a70eb7e21017eb21f9e6c3001bee43c8 is historical and distinct from this programme.

Owning documents: [continuation design](../../../specs/2026-08-31-ingestion-first-continuation-design.md), [continuation plan](../../../plans/2026-08-31-ingestion-first-continuation.md), [source governance](../../../plans/2026-08-20-rag-australian-source-governance.md), [extraction acceptance](extraction-fidelity-acceptance.md). Ordinary Answer, query/follow-up/cache, DTO, prompt/render and streaming implementation stay with the separate RAG programme. No task message or code transfer is implied.

The user adopted these five requirements on 7 September 2026. They extend existing ingestion owners and define the separate RAG consumer dependency, without transferring implementation or acceptance between worktrees.

The post-U02 [shared contract freeze](shared-contract-freeze-v1.md) resolves the supplier-side R1 mode boundary, R3 dependency/snapshot conditions and R4 implementation stewardship for independent review. Source-governance Task 3 owns canonical reviewed records; the actual clinical adjudicator remains unassigned and blocks clinical acceptance. U03 lease work cannot create a clinical review record or make an unreviewed difference authoritative. Separate RAG execution/acceptance remains with its existing task owners.

### R1 — Define source preference and usable-source readiness

The U07/U12 handoff must distinguish **only the explicitly restricted source(s)** from **preferred primary plus approved supplementary evidence**. An inferred topic/domain is not an access permission or a user restriction. RAG owns request resolution and bounded gap-driven selection; ingestion owns eligible evidence, source roles, rights/currentness, exact scope and withdrawal. Do not add broad query fanout to U12.

For each reference answer part, record the nominated primary or supplementary passage, source version/anchor, permitted claim role, access/rights state and readiness: catalogue-only, admitted, evidence retained, indexed, technically eligible, retrievable, or consumer accepted. A catalogue entry or publisher approval does not establish passage readiness. The reference map is acceptance evidence, not a new production database.

Current U12 plans shared activated uploaded_local, australian_public and clinical_kb_site. The other worktree's temporary uploaded exclusion is not this programme's permanent target. Approved Australian sources may already serve a supplementary role. International expansion needs a distinct policy/rights and activation owner; U07/P16 completion alone cannot be assumed to supply it. Link-only sources cannot fill factual gaps using unseen content.

Acceptance: primary complete, primary partial plus approved supplement, explicit restriction, supplements disabled, role-ineligible and link-only variants remain distinct. Adding a source must fill a material supported gap rather than inflate source count. This extends ING-F10/F13/F14; it does not relax eligibility.

### R2 — Specify support semantics beyond critical numeric examples

ING-F03 and existing E1/E6 expectations must include ordinary nonnumeric causal/explanatory pairs: retain a legitimate supported paraphrase, withhold an invented causal relationship, preserve population/entity/negation/qualification, and exercise supported evidence late in the source. All nominated evidence remains retrievable even when omitted from a bounded overview.

U02's structural direct/partial/not_found labels must not be converted automatically to semantic verification. A downstream confidence downgrade does not make an unsupported assertion supported. Absence remains limited to the selected/retrieved evidence unless wider coverage is actually proved; the existing U02 prefix already follows this rule.

U09 supplies originals and relationship anchors; U10 preserves eligibility/support limits; U12 supplies the versioned evidence contract. The separate RAG verifier owns every displayed claim, including its 24/25 overflow boundary and valid explanatory support policy. The narrow ING-F02 formatting correction does not implement semantic adjudication. Independently authored expectations and a suitable subject-matter reviewer remain necessary; no new model call is mandated.

### R3 — Retain independent evidence and typed limitations through fallback

U09/U10/U12, with U08 security and U13 invalidation, must distinguish extraction/provider cause, capability/completeness, source authority, and synthesis/support status. Carry typed reasons through real producer, serialisation, eligibility, resolution and recovery paths. A weaker fallback cannot report stronger completeness, clear a denied permission, or turn optional summary failure into loss of sound original evidence.

Resolve the U12 all-or-nothing result boundary: keep the material-conflict refusal for affected evidence. Before U12 is implemented, define a versioned result that can identify independently eligible, nonconflicting evidence and the unresolved portion without falsely returning the conflicted set as ready. If that safe partition cannot be proved, retain the conservative refusal and expose a precise limitation. Never reuse stale, inaccessible or snapshot-mismatched evidence to produce a partial success.

RAG P08C coverage and P12 supported-part retention own use of the safely resolved subset; RAG P08B owns answer-provider reasons and display. Test supplement removal, optional enrichment failure, JS no-OCR fallback, a denied source and an unrelated safe evidence part. This is a contract decision over ING-F03/F06/F08/F09/F13, not authority to weaken hard gates.

### R4 — Assign reviewed-conflict record ownership

The source-governance Task 3/U12 handoff must explicitly assign who creates and clinically reviews a material difference, who persists/access-controls it, who loads it for the exact request snapshot, and who expires/reconciles it after source replacement, withdrawal or policy change.

Bind reviewed differences to both source versions, permitted passages and claim scope. U12 resolves source evidence and review-reference identity; U13 supplies invalidation. RAG P08C loads reviewed inputs and P12 presents the supported difference with the correct authority. The actual person/service responsible for clinical adjudication is still an owner decision.

Distinguish reviewed difference, unreviewed/unknown status and an explicit reviewed no-material-difference result. An empty array does not prove no conflict. Source-family identity prevents false corroboration; it is not clinical conflict adjudication. Native/OCR disagreement also remains a separate extraction issue. Reuse the existing policy owner; no model may invent canonical conflict records.

### R5 — Connect the existing evidence milestone to a downstream answer acceptance case

Extend ING-F13/F14, existing E1–E7 and the separate Answer handoff rather than create another extraction suite. Prepare one shared reference case: primary guidance supports two requested parts, an approved supplementary passage supplies a third, and a fourth remains unresolved. Map each part and qualification through source -> extracted/structured evidence -> index unit -> U12 resolution -> RAG packed evidence -> verified retained claim -> visible/copied answer.

The ingestion owner proves the first four transitions through actual producer output. The RAG owner proves request-specific composition, useful partial retention, elaboration, public payload projection and complete display/copy. Internal evidence fields are not automatically public DTO fields: RAG must project only the bounded citation/provenance information needed by consumers, preserving access checks and excluding owner/private metadata.

Use existing content-free diagnostics for stage counts, versions and typed loss reasons; retain fixture identities in controlled acceptance artifacts. Do not log raw questions, passages, private markers or provider payloads. Distinguish extraction loss, selection/packing loss, unsupported generation, verification removal and display clipping.

Define the positive improvement criterion before evaluation: targeted weak cases must gain supported requested-part coverage or useful supported explanation, with no mandatory safety/privacy regression. Ties and longer generic prose do not close the goal. The RAG report's 15–20 reference expectations are a suggested reuse set, not a new ingestion suite or paid evaluation mandate. Deterministic/mocked completion proves wiring; later separately authorised model/blinded evaluation proves usefulness.

## Focused shared acceptance and decisions

| Case                                              | Ingestion supplier proof                                                                   | Separate RAG consumer proof                                                                       |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| H1 Primary complete                               | Exact original evidence and qualifications resolve                                         | Correct requested parts; no unnecessary supplement                                                |
| H2 Primary partial plus supplement                | Both permitted sources and their distinct roles resolve                                    | Supplement fills only supported gaps with precise citations                                       |
| H3 Remove/revoke supplement                       | Dependent evidence excluded; independent eligible evidence retained where safely separable | Only dependent claims removed; useful primary-supported parts remain                              |
| H4 Reviewed conflict / no reviewed data           | Exact versions, review state and invalidation retained                                     | Reviewed difference shown correctly; unknown is not no conflict                                   |
| H5 Paraphrase / invented relation / late evidence | Native evidence and full qualifiers remain accessible                                      | Valid explanations retained; unsupported and overflow claims not marked verified                  |
| H6 Fallback or optional enrichment failure        | Typed cause, capability and sound original evidence survive                                | Truthful synthesis/degradation explanation without generic refusal of answerable parts            |
| H7 Explicit restriction / elaborate / delivery    | Source/access snapshot and supplier identity remain exact                                  | Restriction survives; bounded subject context, request-cache isolation and display/copy agreement |

These are variants over the existing source fixtures and the RAG reference case. Future tests use the real applicable adapters; supplying an ideal object only to a finaliser is insufficient producer proof. These are required acceptance cases, not a record of execution.

Before the shared-contract freeze, review R1's mode semantics, R3's safe partial-result contract and R4's named governance owner. R2's clinical expectations need the appropriate reviewer before semantic acceptance. R5 needs acceptance ownership in the separate RAG programme; this document records the dependency without contacting or assigning that task. These decisions need not block the already bounded ING-F02 correction.

Keep U02's accepted historical offline exception exactly: exit 1, four failed suites, 45 failed and 586 passed tests overall. It is not green and cannot automatically carry into this reconciliation, the correction, U03, C06 or the other RAG programme.
