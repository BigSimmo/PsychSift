# U04 evidence record contract 1 — bounded R3 closure

Design appendix for the corrected integrated amendment; **proposed, not independently accepted**. This supplies the missing records in schema recommendation 1 section 3D and origin transaction 3 section 3. It does not implement U04, introduce a native/semantic assessor, amend P04/U02, or authorize connected operations. R1/R2 are owned by `U04-request-context-and-capture-contract-1.md`; this appendix uses its `executionProfileDigest` and exact sorted `manualAliasIds` without changing capture or request-context behavior.

Inspected source: `C:/Users/joshs/.codex/worktrees/rag-local-build-20260822/Database`, branch `codex/rag-local-build-20260822`, HEAD `378c9c3997f91921d89aa6d919b5c9ef05b2152a`, tracked status clean. Root AGENTS and canonical `docs/superpowers/rag-upgrade/canonical/sdd-execution.md` were read. `U04-origin-column-contract-2.json` remains the authority for the **335 existing SQL fields in 22 tables**, full-row keys, exact numeric/timestamp/vector representations and derived-field rules. Nothing below replaces those full rows with the much smaller references used to locate them.

## 1. Common rules and literal identity records

The TypeScript notation below specifies JSON shapes, not executable code or new shared modules. Every object is exact-key/strict; every property shown is mandatory, including explicit nulls. Reject unknown tags/keys, malformed UUID/digests, duplicate set entries, non-finite/unsafe numbers, absent values, conflicting copies and ambiguous resolution. `Uuid` is a canonical lower-case UUID; `Digest` is `sha256:` plus 64 lower-case hex; `Text` is a nonempty UTF-8 string; `UInt` is a nonnegative safe integer; `DateOnly` uses P04's existing date schema. No implicit coercion. Arrays preserve producer order unless explicitly called sets; sets are unique and canonically sorted by their complete identity. Existing producer limits and the integrated row/byte ceilings apply before effects; exceeding them refuses, never clips.

New envelope payloads use the already reviewed raw-byte mechanism: exact `{version:1,domain,encoding,canonicalPayload,digest}`. Add only these literal payload domains to that closed enumeration: `u04-evidence-expectations-v1`, `u04-reviewed-measurements-v1`, `u04-reviewed-evidence-approval-v1`, `u04-retained-evidence-v1`. No caller-selected domain dispatch. Preserve/hash raw envelope bytes, then validate the parsed value; no independent second authoritative payload. P04 bare64 expected-state digest and `reviewedProvenanceEvidenceDigest` keep their existing algorithms.

```ts
type SourceBinding = {
  version: 1;
  originDigest: Digest;
  executionProfileDigest: Digest;
  documentId: Uuid;
  ownerId: Uuid | null;
  contentHash: Digest;
  authorityDigest: Digest;
  sourcePolicyVersion: Text;
  manualAliasIds: Uuid[]; // exact origin/profile set, not per-member filtering
  source: { tag: "document_owned" }
        | { tag: "catalogue_version"; sourceCatalogueKey: Text;
            sourceVersionId: Uuid; activationEventId: Uuid };
  baselineGenerationId: Uuid | null;
};
type ViewBinding =
  | { tag: "origin"; source: SourceBinding;
      selection: "active" | "legacy_null" | "captured_history" }
  | { tag: "candidate"; source: SourceBinding; candidateGenerationId: Uuid;
      jobId: Uuid; firstLeaseToken: Uuid; artifactGenerationId: Uuid | null };
type UnitId = { family: Family; key: Text };
type Family = "pages" | "native_structure" | "chunks" | "images" |
  "table_facts" | "embedding_fields" | "index_units" | "sections" |
  "memory_cards" | "summary" | "generated_labels" | "quality" |
  "document_metadata" | "producer_aliases" | "private_objects" |
  "attempt_control" | "cache_inputs" | "repair_audit_inputs";
```

SourceBinding is a projection for joins, not a replacement source authority: it must equal the corresponding full origin document/authority/source-version/event rows and profile. Unknown or conflicting source markers refuse under unchanged U03 rules. Content hash must be attributable to captured evidence; absent content identity cannot be supplied from a current configured default. Owner null is preserved and still requires the explicit public/owner access mode. All candidates bind C, their exact persisted Node job and immutable first token. D is required for local-worker sections/cards/units and producer aliases, differs from G0/C, and equals the private deep-memory receipt; other families use null D. Pre-finalization D rows retain D plus the explicit C association; finalized typed/metadata index generation equals C and retained artifact generation remains D. No new timestamp or attempt is imputed to legacy evidence. Origin records retain raw historical identities, including missing ones; only the approved active/legacy-null selection contributes P04 counts. `captured_history` never contributes those counts or candidate capability.

An inventory unit key is fixed at declaration: row UUID for existing id-keyed owners; decimal page ordinal for pages; `singleton` for summary, quality and document metadata; label UUID for each generated label; object identity digest for private objects; producer output ordinal plus its complete payload digest for otherwise ownerless native evidence; captured envelope digest for cache/repair inputs. Attempt-control keys are the literal owner tag plus its original row key. These are identifiers, never SQL expressions. Family-empty declarations use a separate family manifest below, not a fake successful unit.

## 2. Closed references, pointers, relationships and dispositions

```ts
type RowOwner = "page" | "chunk" | "image" | "table_fact" | "embedding_field" |
  "index_unit" | "section" | "memory_card" | "summary" | "label" | "quality" |
  "document" | "alias" | "node_job" | "edge_job" | "job_stage" | "import_batch";
type ProjectionSlot = "summary" | "generated_labels" | "quality" |
  "worker_metadata" | "document_counts" | "enrichment_metadata" |
  "deep_memory_metadata" | "deep_memory_receipt" | "producer_aliases";
type ArtifactRef =
  | { tag: "origin_row"; owner: RowOwner; rowId: Uuid; rowDigest: Digest }
  | { tag: "candidate_row"; owner: "page" | "chunk" | "image" | "table_fact" |
        "embedding_field" | "index_unit" | "section" | "memory_card";
      rowId: Uuid; rowDigest: Digest }
  | { tag: "candidate_projection"; slot: ProjectionSlot;
      itemId: Uuid | null; payloadDigest: Digest }
  | { tag: "retained_payload"; envelopeDigest: Digest;
      representation: "producer_text" | "producer_json" | "producer_bytes" |
        "cache_input" | "repair_audit_input" | "control_checkpoint";
      mediaType: Text; byteLength: UInt }
  | { tag: "private_object"; bucket: Text; objectPath: Text;
      objectVersion: Text | null; sha256: Digest; byteLength: UInt; mediaType: Text };
type EvidencePointer = {
  ref: ArtifactRef;
  path: (string | UInt)[];
};
type Relationship =
  | { tag: "source_chunk"; field: (string | UInt)[]; target: UnitId }
  | { tag: "source_image"; field: (string | UInt)[]; target: UnitId }
  | { tag: "section"; field: (string | UInt)[]; target: UnitId }
  | { tag: "page"; field: (string | UInt)[]; target: UnitId }
  | { tag: "private_object"; field: (string | UInt)[]; target: UnitId }
  | { tag: "anchor"; field: (string | UInt)[]; target: UnitId; value: Text }
  | { tag: "input"; field: (string | UInt)[]; target: UnitId };
type Reason = "producer_unavailable" | "producer_failed" | "producer_skipped" |
  "policy_excluded" | "not_applicable" | "no_units_expected" |
  "native_capability_unknown" | "native_capability_unavailable" |
  "reference_unavailable" | "object_attachment_ambiguous" |
  "measurement_unavailable" | "source_identity_unavailable";
type Limitation = {
  version: 1; code: Reason; scope: UnitId | { family: Family; key: "*" };
  evidence: EvidencePointer[]; explanation: Text;
  blocks: Capability[];
};
type Capability = "audit_mapping" | "text_retrieval" | "vector_retrieval" |
  "structured_retrieval" | "visual_retrieval" | "summary_context" |
  "deep_memory_context" | "alias_expansion" | "recovery" |
  "full_engine_evaluation" | "native_fidelity" | "semantic_support";
```

Row-owner resolution is a fixed switch, never interpolation: page→document_pages, chunk→document_chunks, image→document_images, table_fact→document_table_facts, embedding_field→document_embedding_fields, index_unit→document_index_units, section→document_sections, memory_card→document_memory_cards, summary→document_summaries, label→document_labels, quality→document_index_quality, document→documents, alias→rag_aliases, node_job→ingestion_jobs, edge_job→indexing_v3_agent_jobs, job_stage→ingestion_job_stages, import_batch→import_batches. `quality.rowId` is the document_id key; other rowId variants use id. Origin refs resolve inside the captured raw envelope only. Candidate refs resolve only through exact member/C/first-token ownership. Full stored columns, metadata, arrays, embeddings and precision remain retained; rowDigest verifies their complete representation from column contract 2. Foreign sibling/control rows allowed by the frozen origin selector are audit inputs, never candidate-owned rows or retrieval content.

Projection itemId is non-null only for generated_labels/producer_aliases, selecting the matching full-row id; all other slots use null. The reference digest covers the complete selected item/slot and is bound by the whole projection digest. The full summary has all 12 existing row columns; quality has all 13. Generated labels and aliases retain all existing full-row fields, including owner/timestamps and full metadata, with candidate identity server-derived as already specified. The single document_metadata unit's artifact_ref is a retained producer_json payload containing exactly `{worker_metadata,document_counts,enrichment_metadata,deep_memory_metadata,deep_memory_receipt}`. Worker_metadata/document_counts are non-null; other values may be null only while their optional owner is unavailable. Every non-null value equals the corresponding complete named projection slot. No extra synthetic slot units are implied. This fixed aggregate is not a patch API.

A retained_payload resolves to the complete raw envelope retained in the private inventory evidence slots/baseline bundle, never a mutable local pathname or a digest alone. `producer_text` goes in retained_evidence_text unchanged; producer_json preserves the complete producer serialization in retained_native_payload; producer_bytes uses canonical base64 of the complete existing bytes there. representation_version and transform_version are the actual known producer values; unavailable values stay null with a limitation, not a fabricated `v1` native format. An opaque preserved payload proves retention, not interpretable native structure. Cache/repair/control payloads are full fixed captured inputs/checkpoints; their ref cannot execute or refresh anything. Private-object bucket/path must be the captured or newly authorized immutable object identity, never a caller URL to fetch. Actual bytes must be retained or the unchanged immutable reference must remain resolvable under the approved storage evidence; ambiguous/unattached objects do not become retained attachments.

EvidencePointer paths are inert locations into the already retained payload/row. They never name a callable validator, query, table, filesystem read or policy. A pointer must resolve exactly and its value must equal the claimed source field. Relationship field paths are limited by the following mapping and the unchanged U02 shapes: scalar source_chunk_id/source_image_id/section_id; arrays image_ids/chunk_ids/source_chunk_ids/source_image_ids with exact array offsets; page_number/page_start/page_end; storage_path; anchor_id; metadata.chunk_ids, metadata.source_chunk_ids, metadata.source_image_ids; all source_chunk_ids/source_image_ids/pages locations in the full accepted source_anchored_summary_v1 payload and projected label metadata; and the explicit deep-memory receipt anchor/alias source fields. `input` is limited to the fixed cache/repair/control/metadata aggregate inputs named above. No wildcard traversal invents provenance from arbitrary JSON strings. Preserve all other metadata losslessly; an unrecognized producer-declared relationship cannot be dropped or treated as validated—it is an unsupported capability/dispatch refusal requiring a reviewed extension.

Every non-null declared reference produces exactly one relationship for each scalar/array occurrence. Equal repeated targets at different array positions retain those positions; duplicate identical field/target records refuse. Source targets must resolve to the same document/source and permitted generation: C chunks/images/pages and D-owned sections for candidate output; the exact G0/legacy-null view for baseline audit. D's section relation must also belong to that candidate's receipt. Page relationships follow the producer's page meaning, never fabricated DOCX/XLSX physical pages; null page locations remain null and produce no page edge. Anchor values match existing complete source-span/anchor values or the recorded sanctioned null-to-value C repair, never a new guessed coordinate. Broken baseline links become explicit orphan witnesses; broken required candidate links block seal. Original rows/payloads remain available even when a link is broken.

Disposition rules: declaration fixes expected/required/producer/source/D and planned identity before that stage writes. `pending` has no final ref/digest/reason. `retained` has exactly one resolvable full ref, matching content_digest, complete relationships, and null reason_code; limitations can describe missing capabilities but cannot contradict retained bytes. `failed`, `skipped`, `excluded` require respectively producer_failed, producer_skipped/producer_unavailable, policy_excluded plus a limitation and all already-available partial bytes preserved as separately declared units. `not_required` requires expected=false and not_applicable/no_units_expected; it cannot hide available output. Unavailable expected output uses failed or skipped with its exact limitation, not a new successful disposition. Required not-retained/pending/contradictory/mixed-attempt units block seal. Final disposition is write-once; same valid-fence same-byte retransmission is idempotent, not a replacement attempt. `blocks` is computed from the family/capability rules below; caller omission never grants capability.

## 3. All 18 families: owners, generation and requiredness

Every member has exactly one manifest per Family:

```ts
type FamilyManifest = {
  family: Family; binding: ViewBinding;
  population: { tag: "known"; expectedUnits: UnitId[];
                basis: EvidencePointer[]; reason: "no_units_expected" | null }
            | { tag: "unknown"; limitation: Limitation };
  requiredForSeal: boolean;
  producer: { name: Text; version: Text | null; outputManifestDigest: Digest };
};
```

The 18-manifest set is mandatory, including known-empty sets. ExpectedUnits are recorded from the immutable reviewed source expectation or complete planned producer output **before writes**, not selected from successful inserts. Output manifest digest binds full ordered producer output identities and all excluded/failed/skipped entries. Unknown is permitted only for native_structure and unused cache/repair inputs with the limitations below; an actually used cache/repair input must be known and retained. All available produced units, even from an optional family, must be declared and retained in full. No format/path gets to drop a family silently. A known-empty family needs a reviewed/pre-write no-units reason, not zero surviving rows. Unexpected output refuses until represented by a fresh pre-write declaration for that independently planned later stage; already finalized declarations never change.

| Family | Full owner/reference and mandatory relationships | Candidate identity | Seal rule and evaluation capability |
| --- | --- | --- | --- |
| pages | candidate_row page; full text/ocr/metadata plus approved new typed generation; preserve actual ExtractedPage information, including needsOcr if produced | C/token | Core required for every declared produced page. Audit/recovery; missing required page blocks audit and full evaluation. No physical-page inference. |
| native_structure | retained_payload of complete already-produced representation/text; known source/structural links retained; existing ExtractedDocument pages/images/warnings/budgetUsage retained without temporary scratch paths being recovery references | C/token, no D | Optional U04 native capability only; unknown/unavailable explicit. Available output must be retained. Never establishes native_fidelity; a required case depending on it stays incomplete. |
| chunks | candidate_row chunk, full content/synopsis/hash/vector/metadata; image_ids, page and anchors | C/token | Core required for every planned chunk; audit/text/vector/recovery. |
| images | candidate_row image, full caption/bbox/quality/metadata; page and private object | C/token | Required for each planned extracted image, even searchable=false; audit/visual/recovery. Searchability affects engine eligibility, not preservation. |
| table_facts | candidate_row table_fact; source_chunk_id/source_image_id/page | C/token | Required for every planned table-fact output, including known-empty. Structured retrieval/audit/recovery; no substitution of one fact for an entire physical table. |
| embedding_fields | candidate_row embedding_field; source_chunk_id and full embedding/content | C/token | Required for planned outputs; vector/structured retrieval/audit/recovery. |
| index_units | candidate_row index_unit; scalar source links, source_span and all metadata links retained; full vector | C/token, D for local-worker deep-memory output; non-D core units keep null D | Core planned units required; optional deep-memory subset follows its producer manifest without discarding any existing output. Structured/vector/deep-memory capability requires its complete declared subset. |
| sections | candidate_row section; chunk_ids, page range, full summary/tags/metadata | C/token/D | Optional producer may fail before output; all available sections retained. Deep-memory/recovery. Null/foreign D refuses. |
| memory_cards | candidate_row memory_card; section_id, complete source arrays, page, vector | C/token/D | Same deep-memory rule; audit/vector/deep-memory/recovery for selected cards. |
| summary | candidate_projection summary; full existing row, complete U02 payload/source arrays/metadata and projection marker | C/token | Optional only as existing producer permits; retained requires unchanged U02 validation. Summary_context requires complete structured U02 result, never heuristic fallback as structured success. |
| generated_labels | candidate_projection generated_labels per full label row; exact U02 projection source/page links | C/token | Optional with summary producer; preserve complete output. Manual rows stay captured baseline inputs only. Summary context requires the actual declared label set and unchanged projection checks, not positive label count. |
| quality | candidate_projection quality, complete 13-field row and issue/metric payload | C/token | Required singleton from actual quality owner. Audit/recovery; quality_score alone supplies no measurement witness or semantic acceptance. |
| document_metadata | fixed retained aggregate of document_counts and named worker/enrichment/deep-memory slots; complete allowed values | C/token; deep-memory slots bind D | Required singleton worker/count portion; unavailable optional slots remain explicit. Recovery and every consumer depending on a slot. Organization/manual metadata remains origin-only and unchanged. |
| producer_aliases | candidate_projection producer_aliases per full alias row; metadata.source_chunk_ids plus document/producer/D metadata | C/token/D | Optional with deep-memory producer; complete declared set required for alias_expansion. Collision refusal unchanged; no foreign/manual aliases relabelled candidate. |
| private_objects | private_object for original/candidate immutable bytes; each attached image/input object has reciprocal declared relationship | C/token; original source input remains origin-bound | Required for every attached object; ambiguous/unavailable attachment blocks dependent visual/recovery capability and required seal. Never deletes or fetches objects here. |
| attempt_control | origin_row node_job/edge_job/job_stage/import_batch; retained_payload exact own control checkpoint/receipt; full captured foreign siblings retained | Original raw identity or exact owned C/job/token; never adopts Edge/sibling rows | Required origin/control evidence, complete server checkpoint and terminal receipt. All capabilities blocked by missing/drifted control. |
| cache_inputs | retained_payload cache_input for each input actually used, full key/version/content/source identities | origin-bound input; candidate usage bound C/token without rewriting original identity | Known-empty when explicitly bypassed, otherwise used input required. Missing/unknown unused input may be a limitation; no missing used input can satisfy evaluation. |
| repair_audit_inputs | retained_payload repair_audit_input for exact prior evidence actually consumed | origin-bound input, C/token usage link | Same as cache_inputs; audit/recovery provenance only, no operational repair authority. |

`requiredForSeal` is derived by this table and the already approved producer path, not trusted from the client. All manifests/projections/available partial bytes and relationships are mandatory preservation evidence even when a family is optional. A stage seal records optional family failure honestly; it is inert. Evaluation separately requires every dependency in the frozen actual engine operation map to be present or **known empty under its reviewed population**, including candidate summary/deep-memory/alias paths when required by that map. Missing optional output is not known empty. Any blocked required metric or incomplete family dependency latches incomplete/NO_GO without shrinking the cases or denominators. Neither U04 inventory nor the manual policy below grants native_fidelity or semantic_support. Those remain unassessed/U09 and downstream governed acceptance respectively.

## 4. One supported reviewed manual policy and trust binding

Support exactly `policyId="u04-reviewed-manual-p04-v1"`, `producer.kind="reviewed_manual"`, and `producer.consumerContract="u04-reviewed-measurements-v1"`. There is no automatic producer, caller-supplied policy implementation, arbitrary nonempty policy string, runtime plugin, free-form executable rubric or default success producer. The policy is **human review of complete bound evidence plus mechanical consistency checks**. It does not mechanically discover extraction errors or semantic support.

The policy requires a reviewer to examine all declared source/expected units and complete produced evidence. Four unit-quality judgements are explicitly about the reviewed unit under the captured parser/chunker/index-unit configuration: empty (no usable source evidence), oversized (cannot preserve its governed unit meaning within that configuration's supported bound), undersized (split prevents usable governed meaning), and lowInformation (lacks the meaningful source content its expected unit calls for). Heading/table/extraction judgements compare every independently listed expected item with the full retained output; chunk-bounds judgements compare the complete actual unit locations to retained source bounds. These are recorded human judgements, not newly claimed token thresholds or outputs of assessDocumentIndexQuality. The review must cite the exact captured configuration/source/expectation evidence for each judgement and explain any failure. If the reviewer cannot decide, result is unavailable and preparation is not ready. No interpretation of a missing judgement as pass.

```ts
type EvidenceMode = "mocked" | "real";
type ReviewRole = "clinical_governance" | "corpus_steward" | "source_governance";
type Producer = { kind: "reviewed_manual";
  consumerContract: "u04-reviewed-measurements-v1";
  identity: Text; version: "1"; evidenceMode: EvidenceMode };
type Reviewer = { identity: Text; role: ReviewRole; reviewedAt: DateOnly;
  evidence: ArtifactRef; evidenceDigest: Digest };
type Approval = {
  kind: "u04-reviewed-evidence-approval-v1";
  policyId: "u04-reviewed-manual-p04-v1";
  source: SourceBinding;
  evidenceMode: EvidenceMode;
  expectationsDigest: Digest;
  measurementsDigest: Digest;
  producer: Producer;
  reviewer: Reviewer;
};
```

Approval is externally hash-bound by the existing reviewed execution/admission package, whose accepted bytes the caller receives through the existing controller admission boundary. The consumer must match the **exact approved approval-envelope digest**, both subordinate artifact digests, source/profile identities, reviewer/producer identities and mode. An approval envelope supplied only alongside untrusted input is not approval; a matching hash alone is not reviewer authority. Use the existing explicit review/admission process, not an invented signature service or an implicit trust-by-role string. No self-reference: reviewer.evidence is a separately retained complete review report/record whose digest and exact target expectations/measurements/source it names are checked; approval binds that report. The reviewer and producer have separate recorded identities; for real evidence the approved reviewer must be distinct from the measurement author. Mocked fixtures use explicitly distinct fixture identities and a test-only admission fixture, never production authority.

Every runtime connection/mutation path rejects mocked evidence before client construction. Mocked evidence is accepted by pure local parsers/mappers/reconciliation for contract proof only. Real records require separately authorized origin/native/Storage/provider operations if those were necessary to obtain their evidence; this design grants none. A well-formed supported real record can be consumed without inventing a new producer. Missing approved real measurements is a per-operation not-ready dependency, not a permanent hardcoded refusal for all records.

## 5. Exact expectations, measurements and witnesses

Use `P04Input = IngestionAuditInput` exported by unchanged `src/lib/ingestion-audit.ts`. Indexed-access notation below means precisely that existing field schema, including its strict keys/enums/nullability; it does not add fields to P04. Retain unchanged `parseIngestionAuditInput`, `parseIngestionAuditInventory`, `auditDocument`, and `reviewedProvenanceEvidenceDigest`. U02 uses unchanged `normalizeSourceAnchoredSummary`, `requireExactSourceAnchoredGeneration`, `persistedSourceAnchoredSummaryProjectionMatches` and `projectSourceAnchoredLabels` from `supabase/functions/_shared/source-anchored-summary.ts` with full exact selected source rows and accepted model/version authority, not a preview.

```ts
type CountName = "pages" | "chunks" | "tables" | "images" |
  "searchableUnits" | "embeddings";
type StructureName = "chunkBoundsValid" | "headingContinuityPassed" |
  "tableContinuityPassed" | "extractionQualityPassed";
type ExpectationPopulation =
  | { tag: "known"; units: UnitId[]; basis: EvidencePointer[] }
  | { tag: "unknown"; reason: "measurement_unavailable"; basis: EvidencePointer[] };
type ExpectedCheck = { id: Text; metric: StructureName;
  expectedUnit: UnitId; basis: EvidencePointer[] };
type Expectations = {
  kind: "u04-evidence-expectations-v1";
  policyId: "u04-reviewed-manual-p04-v1";
  source: SourceBinding;
  evidenceMode: EvidenceMode;
  lifecycle: P04Input["lifecycle"];
  lifecycleEvidence: EvidencePointer[];
  populations: { pages: ExpectationPopulation; chunks: ExpectationPopulation;
    tables: ExpectationPopulation; images: ExpectationPopulation;
    searchableUnits: ExpectationPopulation; embeddings: ExpectationPopulation };
  checks: ExpectedCheck[];
  provenance: P04Input["provenance"]["expected"];
  provenanceReview: P04Input["provenance"]["review"];
  embedding: { expectedModel: string; expectedDimensions: number; expectedStrategy: string };
  configurationEvidence: EvidencePointer[];
  mustPassCases: { id: string; expectedDocumentRank: number | null }[];
};
type Observation = { unit: UnitId; evidence: EvidencePointer[] };
type Judgement = "pass" | "fail" | "unavailable";
type Witness =
  | { tag: "population"; metric: CountName; observations: Observation[]; result: UInt }
  | { tag: "unit_quality"; unit: UnitId; evidence: EvidencePointer[];
      empty: boolean; oversized: boolean; undersized: boolean; lowInformation: boolean;
      rationale: Text }
  | { tag: "structure"; checkId: Text; metric: StructureName;
      evidence: EvidencePointer[]; result: Judgement; rationale: Text }
  | { tag: "duplicates"; policy: "index-quality-whitespace-sha256-v1";
      groups: { contentHash: string; units: UnitId[] }[]; result: UInt }
  | { tag: "relationships"; checked: { unit: UnitId; relationship: Relationship;
      result: "resolved" | "orphan"; evidence: EvidencePointer[] }[]; result: UInt }
  | { tag: "embedding"; unit: UnitId; evidence: EvidencePointer[];
      present: boolean; model: Text | null; dimensions: UInt | null; strategy: Text | null }
  | { tag: "provenance"; field: "contentHash" | "extractionVersion" | "parserVersion" |
      "parserConfigVersion" | "chunkerVersion" | "indexUnitVersion" |
      "validationVersion" | "sourcePolicyVersion";
      evidence: EvidencePointer[]; value: Text }
  | { tag: "generations"; units: { unit: UnitId; evidence: EvidencePointer[];
      generation: Uuid | null }[]; result: Uuid[] };
type Measurements = {
  kind: "reviewed-origin-measurements-v1";
  policyId: "u04-reviewed-manual-p04-v1";
  source: SourceBinding;
  expectationsDigest: Digest;
  producer: Producer;
  fields: { counts: P04Input["counts"]; unitQuality: P04Input["unitQuality"];
    structure: P04Input["structure"]; embeddingContract: P04Input["embeddingContract"];
    provenance: P04Input["provenance"]; chunkGenerations: P04Input["chunkGenerations"] };
  witnesses: Witness[];
};
```

Witness IDs are **derived**, not additional free-form strings: `population/<metric>`, `unit_quality/<family>/<key>`, `structure/<checkId>`, `duplicates`, `relationships`, `embedding/<family>/<key>`, `provenance/<field>`, `generations`. Exactly one of each required identity; omitted, extra, duplicate or conflicting witnesses refuse. Evidence lists are nonempty except a population proven empty by its bound full-row set and the two exhaustive duplicates/relationships lists when their exact inspected sets are empty. Every full-row/evidence ref resolves against the raw origin or retained approved evidence; a document title/summary excerpt is not full source coverage.

Fixed P04 denominators for this policy (record them literally in implementation, no caller selector): pages=selected document_pages; chunks=document_chunks; tables=document_table_facts **fact rows**, not physical tables; images=document_images regardless of searchable; searchableUnits=disjoint typed-ID union of selected chunks, embedding_fields, index_units and memory_cards; embedding slots=that same union's embedding fields; counts.embeddings.actual counts its non-null complete vectors. Unit-quality witnesses cover the full searchableUnits union. Deep-memory members must have the exact committed G0 producer receipt, or explicit supported legacy attribution in the original view; ambiguous generations refuse rather than silently omitting rows. For C reconciliation use exact C and its D receipt under the family rules. Origin row inventory still includes all captured history independently of these denominators. This named denominator is a U04 audit mapping contract; it does not change ordinary ranking or reinterpret old P04 reports.

Known expected populations come from the independently reviewed source expectation/producer plan retained in basis, not from observations or the output-row list. Each expected unit identity and its source-basis association are explicitly reviewed; the consumer rejects a population whose sole basis is the survivor inventory. Expected counts are units.length; unknown maps to null under existing P04 and retains `integrity_expectation_missing`, never a complete success. Each actual population witness lists exactly the selected complete captured set and result equals its cardinality (embedding population is present-vector units). Exact family/type IDs prevent equal counts hiding substitutions. For embeddings, expected population describes the independently expected slots and must agree with expected searchableUnits. Every actual slot also has an embedding witness; missing vectors are present=false with null model/dimensions/strategy. Present vectors require all three fields with attributable producer evidence; dimensions are recomputed from the complete captured vector, not assumed from the configured model. Distinct observed values must equal embeddingContract actual arrays. Completeness is present actual slots / all actual slots, **0 when the denominator is 0**; missing expected slots remain a separate expected/actual deficit. Unattributable model/strategy refuses preparation instead of fabricating an expected value.

Unit-quality aggregate counts are the exact sums of flags across all selected units; policyVersion must equal `u04-reviewed-manual-p04-v1`. Each structure witness matches exactly one independently reviewed ExpectedCheck. Every structure metric requires at least one check: if no table/heading exists, the review includes an explicit whole-document absence check with the complete reviewed source basis; there is no empty-array-every=true shortcut. Any unavailable result refuses preparation; field is true iff every check for it passes. This preserves truthful false values for actual P04 classification. It does not assert complete native or semantic correctness beyond the declared reviewed expectation.

Duplicate groups are mechanically recomputed with unchanged `hashIndexQualityText` over every full selected chunk content; include every equivalence class, singleton included; group contentHash is its existing bare64 result, units unique and sorted. result is sum(group.length-1), not a ratio rounded back into a count. The relationship witness exhaustively covers every finite mapped edge in section 2, exactly once by unit/tag/field/target identity. Its result is the number of orphan edges, not number of affected rows; all referenced source arrays/metadata fields participate. No issue list sampled down to a preview. These counts must equal fields.counts.duplicateChunks/orphanedArtifacts.

There are exactly eight provenance witnesses; each value equals the captured actual field and fields.provenance.actual. Expected and review objects equal Expectations exactly; recompute the existing `reviewedProvenanceEvidenceDigest({contractVersion,expected})` and require that review digest. Preserve expected-versus-actual mismatches so `auditDocument` diagnoses them. Never substitute originDigest for provenance review evidenceDigest. The generations witness covers every selected chunk, preserves missing generation as null, and derives the exact distinct non-null array. Null/malformed generation is a mapper refusal with retained evidence, not a dropped chunk. The supported legacy-null case therefore remains diagnostic/not ready where actual P04 cannot represent complete generation evidence; do not change P04 to manufacture a successful legacy generation.

CaseResults remain the closed complete actual engine report from the evaluation contract, with source/profile/origin/case-set/mode/config/clock binding. For each expected case, preserve the actual ordered retrieved document IDs, expected/actual rank and existing P04 failure codes. Do not author passed=true as a measurement witness or accept stored extraction quality in place of retrieval. Before classification construct the complete P04 inventory and call actual `parseIngestionAuditInventory`, including retrievedDocumentIdsByCase, so cross-document/rank/case contradictions are checked. Timeout/provider failure/incomplete reader state stays incomplete/NO_GO even if P04 can express its failure diagnostic.

## 6. Actual mapper/reconciliation flow and positive authored fixture

`prepareShadowAuditV1` (owned by the already allowed U04 orchestration/session owner, not a new P04 edit) takes the five origin-transaction inputs plus the exact approved admission reference containing Approval. Validate raw envelopes and exact approval; source/profile/population/expectations/measurement/case identities; strict shapes; exhaustive witness coverage; full-row/projection/relationship membership; all recomputable counts/digests; reviewed manual judgement coverage. Map document/generation/metadata/authority as origin transaction 3 section 3 prescribes. SourceGovernanceValid is the conjunction of the captured authority and existing P04 governance predicates, never a new standalone approval boolean. Then call **actual** parseIngestionAuditInput, parseIngestionAuditInventory and auditDocument. The expectedStateDigest passed to P04 is the new origin envelope's bare64 digest. Historical P04 artifact/digest is retained separately unchanged. Return the actual classifier result plus limitations and capability disposition, without replacing its action to make shadow staging eligible.

Candidate reconciliation is the actual U04 manifest/disposition resolver, not a separate fixture-only shortcut. It uses section 3's same family sets, actual refs/projection validators and relationships; recomputes exact declaration/retention membership and requiredness; refuses a missing required unit even if another unit makes the count equal; derives seal/capability disposition. The manual baseline approval never grants candidate C a measurement it has not supplied, and a stage receipt never supplies a retrieval/answer metric. Candidate evaluation follows the complete engine contract separately.

Smallest authored positive fixture recipe, to implement later in the owned U04 test file, is fully local JSON/rows and mock admission only:

1. Assign distinct valid UUIDs to document, G0, C, job, first token, one page and one chunk. Use the existing `tests/ingestion-audit.test.ts` uploaded_local/local_guideline/public_index_permitted/source-policy metadata and provenance fixture as a **synthetic** starting shape, replacing identifiers with those UUIDs and recomputing the real provenance digest through its actual export. Full captured document/page/chunk rows use column contract 2 with source metadata and one attributable vector plus model/strategy. Other selected row sets are honestly empty. No real/native document or provider execution.
2. Independently authored expectation evidence describes exactly one source page and one planned chunk/embedding, no facts/images/other units, four explicit structure checks (including source-wide heading/table absence checks), lifecycle current, captured synthetic configuration/version provenance and one required retrieval case. It is a separate retained evidence envelope, not constructed by reading successful output rows. Expected pages/chunks/searchableUnits/embeddings=1; tables/images=0. One empty chunk can be authored deliberately with empty=true and extractionQualityPassed=false; this still yields a valid positive **consumer acceptance plus actual non-green P04 diagnostic**, not clinical success.
3. Supply all six population witnesses, one unit-quality witness, all four structure witnesses, complete one-group duplicate witness (result 0), page relationship witness (resolved), one embedding witness, all eight provenance witnesses and one generations witness. All scalar fields are derived exactly as above. Supply a complete mocked actual-engine case report with the fixture document rank 1 and empty failure codes; the P04 inventory uses that ordered retrievedDocumentIdsByCase mapping. Approval and distinct producer/reviewer fixture identities bind every raw digest, source and mocked mode.
4. Require actual mapper parsing/classification success, truthful diagnostics, and refusal before clients if the same mocked input is sent to an operational entrypoint. For the independent positive candidate reconciliation build all 18 manifests before fake persistence; retain complete C page/chunk/image-empty/fact-empty/field-empty/quality/count/control evidence, mark unsupported native and optional unproduced structured/deep-memory families explicitly. Exact required inventory can seal inertly, while missing required engine capabilities produces incomplete/NO_GO. A separate full-engine positive fixture supplies the complete actual producer projection fixtures and exact D/source relationships; use actual U02 normalization/projection validation and actual reconciliation, not copied validator logic.
5. Mutate each independent boundary: unknown tag/key/policy/producer; missing/duplicate/conflicting witness; same count with wrong ID; origin/source/owner/profile/manual-alias/G0/C/D/job/token mismatch; wrong full-row/raw digest; dropped late source-array edge; survivor-derived expected population; wrong embedding denominator; missing reviewer approval; false provenance digest; real/mocked relabel; unavailable check coerced to true; optional limitation used to fill a required metric. Each must reject or retain truthful incomplete/NO_GO before effect. Existing ordinary P04 and U02 fixtures remain unchanged.

These are **authored future proof requirements, not executed tests**. Positive acceptance means the consumer can parse supported honest evidence and reach actual classification/reconciliation; it does not require every honest record to be a healthy candidate or every optional limitation to become an evaluation pass.

## 7. Scope, evidence and remaining operational dependencies

No new governance choice is intentionally delegated to the implementer: one policy/producer contract, one set of denominators, finite owners/variants/relationships, exact manual review/admission binding, exact requiredness and capability rules are proposed here for whole-amendment independent review. Actual operational expected-source/measurement/reviewer evidence is not present or approved by this appendix. If the approved reviewers reject this manual policy or denominator, amend this document before dispatch; do not let an implementer choose another policy string or automatic assessor. Unsupported additional native relationships require a later reviewed contract, not lossy interpretation in U04.

Own observed route: session `01a08bff-100b-79b2-ad95-5fda5a22cd45`, parent `01a07b47-4623-7e90-825a-ec25116b8531`, agent `/root/u04_evidence_contract_closure`, provider `openai`, **gpt-6-astra / high**. Selected session_meta/turn_context fields were read with shared access from exact log `C:/Users/joshs/.codex/sessions/2026/09/10/rollout-2026-09-10T23-45-44-01a08bff-100b-79b2-ad95-5fda5a22cd45.jsonl`. This is observed local resolved configuration, not backend attestation. This agent is a design contributor, not an independent reviewer.

Only this new outside file was authored. Read-only evidence consisted of exact source/doc reads, selected metadata, branch/HEAD/tracked-status inspection and column-contract field inspection. A guessed source-anchored-summary pathname was absent; the actual existing import resolved to the unchanged Supabase shared owner cited above. No tests/config loads, SQL, provider/native document/Storage/worker operations, repository writes, commits, publication or agents occurred. Root must hash-bind this appendix in the corrected frozen review package; it cannot self-accept.

Historical U02 offline evidence remains **exit 1, four failed suites, 45 failed and 586 passed overall**, not green and not a U04 exception. P08A remains superseded; retrieval kernel remains default-off. SQL/runtime/hosted/provider/native fidelity/semantic/clinical proof remains separate and unrun.
