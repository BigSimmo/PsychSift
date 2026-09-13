# U04 audit consumer: narrow representation correction 2

11 September 2026. Corrected within the dispatched actual-audit consumer scope under explicit controller representation rulings. Proposal 1 remains immutable; this correction is for narrow delta review before adoption/product implementation. No repository source changed. Existing source/test remain frozen at 8d7e4a01984ed75c7fb7eef7be45856eb017de939c8a21b49e16de89482ded47 / 313b45dc067f34e5c8f13c86d2f136179c5bd671c401a6b61b43b49b20a17366. No tests, compiler, application imports, SQL or providers ran. This proposal supplies missing root/lookup/binding names; adopted source authority, scoring, requiredness and P04 remain unchanged.

## Existing definitions reused exactly

RawEnvelope is the existing five-field raw byte envelope; no new domain. SourceBinding, ArtifactRef, EvidencePointer, UnitId, Limitation, Expectations, Measurements and Approval remain evidence-record1 definitions. Profile is the adopted full execution profile. Full rows use column contract2's 335 original fields plus the exact currently authored U04 additions in the frozen migration/schema; all 27 table slots are mandatory. No preview or generated-type subset is a full row.

The complete scored engine report is **EvalQualityReport**, exactly the returned root at scripts/eval-quality.ts:772–799: generated_at, run_context, provider, thresholds, retrieval, rag, threshold_failures, accepted_threshold_failures, blocking_threshold_failures, source_metadata_debt_acceptance. Preserve all current nested fields from that return and the source-owned builders, including their optional presence. Retrieval results use GoldenRetrievalResult at scripts/eval-retrieval.ts:57–132; quality results use RagQualityResult at scripts/eval-quality.ts:60–107. Do not substitute the smaller reindex-eval-gate summary types. These are closed source references requiring runtime validators against those actual declarations/builders, not a permissive Record<string,unknown> report.

Existing retrieval topResultSummary explicitly slices to ten and emits content_preview, not full content or document_id (eval-retrieval.ts:525–560). RagQualityResult omits the full answer/source objects. Therefore the wrapper also retains actual complete ordered SearchResult[] and RagAnswer objects from src/lib/types.ts:631 and1279. Their full declared nested types, including source metadata, claims, citations, verification and diagnostics, remain authoritative. Declared telemetry dictionaries are retained in full with their declared value types; they are not arbitrary success fields. No script main or environment resolver is imported to validate these records.

## 1. Origin root and exact retained row lookup

The proposed origin remains baseline/pg-jsonb-text-v1, with this exact payload:

```ts
type OriginV1 = {
  kind: "u04-origin-snapshot-v1";
  evidenceMode: "mocked" | "real";
  capturedAt: SqlTimestampText;
  executionProfileEnvelope: RawEnvelope; // exact profile node-json-v1
  documentIds: Uuid[];
  manualAliasIds: Uuid[];
  sourcePolicyVersion: Text;
  rows: OriginRowsV1;
};
```

OriginRowsV1 has exactly the 22 literal column-contract table names and the five frozen U04 table names: documents, document_pages, document_chunks, document_images, document_table_facts, document_embedding_fields, document_index_units, document_sections, document_memory_cards, document_summaries, document_labels, document_index_quality, ingestion_jobs, indexing_v3_agent_jobs, ingestion_job_stages, import_batches, rag_aliases, document_title_words, public_source_versions, public_source_activation_events, public_source_serving_authority, document_publication_approvals, shadow_reindex_waves, document_index_generations, document_generation_projections, document_generation_inventory, document_generation_baselines. Each value is an array of full rows sorted uniquely by its exact declared key; empty is explicit. Selection remains the adopted W/Q/B/K/A/M predicates and exact related private-ledger membership, not a caller-provided selector.

**Row representation:** each array element is a full original row **RawEnvelope in baseline/pg-jsonb-text-v1**. Its payload is precisely the full row object, with no new row wrapper or self-digest field. This gives ArtifactRef.rowDigest a single exact meaning: that row envelope's framed digest. Origin raw bytes contain those exact envelope scalar values. Validate every literal stored key/type before indexing by owner/key; no second decoded row input. Include generated fields in this initial representation to avoid creating a new generated-field waiver. Server timestamps/vector text and arbitrary nested JSON retain original precision; a typed consumer must use the approved textual view or reject unsafe conversion, while retaining original bytes. No Node reserialization is used to reconstruct SQL row identity.

The origin/profile document and alias lists and effective policy agree exactly. SourceBinding.originDigest is the external origin envelope digest and therefore is not embedded back inside OriginV1. SourceBinding.authorityDigest is checked against the adopted U03 source projection using the exact original authority fields/algorithm; adding a caller `sourceGovernanceValid` or `authorityVerified` field is prohibited. The fixed SQL capture remains responsible for factual snapshot/authority; mocked rows do not become real capture.

## 2. Complete retained evidence lookup and independent admission

Add one non-envelope transport record supplied to the consumer, whose collection entries are each already raw-envelope-bound:

```ts
type AuditInputsV1 = {
  originEnvelope: RawEnvelope;
  caseResultsEnvelope: RawEnvelope;
  documents: DocumentAuditInputsV1[];
  retainedEvidence: RetainedEntry[];
};
type DocumentAuditInputsV1 = {
  documentId: Uuid;
  reviewedExpectationsEnvelope: RawEnvelope;
  measurementsEnvelope: RawEnvelope;
  historicalArtifact: { artifactDigest: Digest; expectedStateDigest: Bare64 | null; envelope: RawEnvelope };
  approvalEnvelope: RawEnvelope;
};
type RetainedEntry =
  | { tag: "payload"; envelope: RawEnvelope; representation: "producer_text" | "producer_json" | "producer_bytes" |
        "cache_input" | "repair_audit_input" | "control_checkpoint";
      mediaType: Text; byteLength: UInt }
  | { tag: "private_object"; ref: Extract<ArtifactRef,{tag:"private_object"}>;
      bytes: { encoding: "base64"; content: string } };
type AuditAdmissionV1 = {
  executionProfileDigest: Digest; originDigest: Digest;
  caseResultsDigest: Digest;
  documents: {
    documentId: Uuid; expectationsDigest: Digest; measurementsDigest: Digest;
    approvalEnvelopeDigest: Digest; historicalArtifactDigest: Digest;
  }[];
  documentPolicyBindings: {
    documentId: Uuid; ownerId: Uuid | null; contentHash: Digest; sourcePolicyVersion: Text;
    policyArtifact: { digest: Digest; retainedEnvelopeDigest: Digest };
    reviewArtifact: { digest: Digest; retainedEnvelopeDigest: Digest };
  }[];
  evidenceMode: "mocked" | "real";
};
```

prepareShadowAuditV1 receives AuditInputsV1 and a **separate** AuditAdmissionV1 argument loaded from the controller's already admitted exact package. This record's equality is necessary binding, never proof of who approved it. No `approved`, signature service or magic role label is added. A caller's adjacent approval cannot populate the independent argument. Real operational callers must source that argument through the existing controller admission boundary; pure fixtures use a separate explicitly authored mocked admission record.

**Whole-wave cardinality and binding:** AuditInputsV1.documents and AuditAdmissionV1.documents are strictly ascending, unique by documentId, and their document IDs each equal the complete origin/profile documentIds array exactly. Missing, extra, duplicate or substituted members refuse preparation. Origin, execution profile, case report and retained lookup are wave-wide; Expectations, Measurements, Approval and historical identities are per-document. Each per-document envelope's SourceBinding must name that member and agree on every origin/profile/owner/content/G0/policy/manual-alias identity. Its subordinate digests and full historical artifact identities must match that member's separate admission entry, not an adjacent or first-document entry. The per-document historicalArtifactDigest binds the existing historicalArtifact.artifactDigest, and the complete historical envelope and its member association must validate under their adopted artifact contract. Preserve its expectedStateDigest exactly and separately; no new digest meaning or substitution is implied.

Validate every wave member, every required reference and the shared case report before calling actual parseIngestionAuditInventory exactly once with the complete documents array and one consistent case-ID-to-ordered-document-map. A private per-document mapping helper may call the actual per-document parser, but no first-document success or partially validated array may escape as wave preparation. Invoke unchanged actual auditDocument for the complete validated population; retain diagnostics in document order. A malformed/unresolvable member refuses preparation for the whole wave. A structurally valid but incomplete member (including unknown expectations) blocks whole-wave readiness while retaining the complete truthful diagnostics/limitations; it cannot be omitted to obtain success.

RetainedEntry arrays are uniquely ordered by envelope digest or complete private-object identity. Every used ref must resolve to exactly one full entry or origin row, with digest/size/representation equality. Payload text and bytes remain complete. Producer_json/control/cache/repair pointer paths must resolve in the exact decoded original payload without coercion/prototype traversal; text/bytes admit only their full-value empty path unless their fixed producer schema defines more. No generic retained payload establishes an expectation, policy, review, clinical claim or success: the typed claim, exact source scope, applicable adopted producer schema and independent approval must also validate. Extra supplied entries cannot create extra approved units. Private-object bytes hash/length/type bind the exact ref and are never fetched.

Approval.reviewer's evidence resolves to a separately retained review record with this new exact binding wrapper:

```ts
type MeasurementReviewV1 = {
  kind: "u04-measurement-review-v1"; evidenceMode: "mocked" | "real";
  source: SourceBinding; expectationsDigest: Digest; measurementsDigest: Digest;
  producerIdentity: Text;
  reviewer: { identity: Text; role: "clinical_governance" | "corpus_steward" | "source_governance"; reviewedAt: DateOnly };
  reviewText: Text;
};
```

This payload uses u04-retained-evidence-v1/node-json-v1. Approval remains its existing separate domain/shape and binds the review's complete bytes; the review never includes its own digest or the future approval digest. ReviewText is retained rationale, not machine proof. Reviewer identity/date/role, producer identity, source and both subordinate digests must equal Approval/Measurements exactly; real author/reviewer distinction remains mandatory. Existing historical artifact identity is retained separately and cannot replace the new origin bare64 P04 input.

## 3. Minimum complete document-owned policy records

Both use u04-retained-evidence-v1/node-json-v1. Their artifact.digest is SHA-256 of the original canonicalPayload UTF-8 bytes; retainedEnvelopeDigest is the existing framed envelope digest. These two values have explicit different meanings and are both verified.

```ts
type PolicyMember = { documentId: Uuid; ownerId: Uuid | null; contentHash: Digest };
type DocumentOwnedPolicyV1 = {
  kind: "u04-document-owned-policy-v1"; evidenceMode: "mocked" | "real";
  sourcePolicyVersion: Text; members: PolicyMember[]; policyText: Text;
};
type DocumentOwnedPolicyReviewV1 = {
  kind: "u04-document-owned-policy-review-v1"; evidenceMode: "mocked" | "real";
  sourcePolicyVersion: Text; members: PolicyMember[];
  policyArtifact: { digest: Digest; retainedEnvelopeDigest: Digest };
  reviewer: { identity: Text; role: "clinical_governance" | "corpus_steward" | "source_governance"; reviewedAt: DateOnly };
  reviewText: Text;
};
```

Members are sorted unique full identities and equal the independently admitted policy population; per-document profile entries point to those exact records. Policy text is the complete admitted artifact, not a inferred licence/default, and review text retains the independent review. The consumer matches document/owner/content/version and both complete artifact identities to profile, source rows and separate admission. It still checks every U03 predicate and actual P04 metadata/licence predicate. No forbidden raw source_policy_version/source_catalogue_key key may be added, even null. Historical provenance is checked separately and cannot be filled from current policyText/version.

**Concrete minimal positive serialized payload for this new policy wrapper** (not an end-to-end engine or clinical fixture):

```json
{"evidenceMode":"mocked","kind":"u04-document-owned-policy-v1","members":[{"contentHash":"sha256:1111111111111111111111111111111111111111111111111111111111111111","documentId":"00000000-0000-0000-0000-000000000001","ownerId":null}],"policyText":"Synthetic uploaded-local policy artifact for the explicitly listed content. This fixture grants no operational permission.","sourcePolicyVersion":"synthetic-source-policy-v1"}
```

The independently authored review fixture uses reviewer identity `synthetic-policy-reviewer`, role `source_governance`, reviewedAt `2026-09-11`, exactly that member/version, the computed full payload/envelope digests, and reviewText `Synthetic review of the complete bound policy and member identity.` Its separate admission fixture binds both computed full record identities and the already constructed profile. The full one-page/one-chunk consumer fixture required by brief1 must embed these complete serialized artifacts and all full rows/reports; this concise representation example does not replace that required test or claim its hashes have been executed/verified.

## 4. Bound complete case report

Use evaluation_report/node-json-v1 and preserve this exact root:

```ts
type AuditCaseReportV1 = {
  kind: "u04-audit-case-results-v1"; evidenceMode: "mocked" | "real";
  originDigest: Digest; executionProfileDigest: Digest; caseSetDigest: Digest;
  configurationDigest: Digest; providerMode: "openai" | "offline";
  comparisonClock: MillisecondUtcText; documentIds: Uuid[]; manualAliasIds: Uuid[];
  sourceBindings: SourceBinding[];
  report: EvalQualityReport;
  executions: CaseExecutionV1[];
};
type CaseExecutionV1 = {
  kind: "retrieval" | "quality"; index: UInt; caseId: Text;
  outcome: "complete" | "timeout" | "provider_failure" | "incomplete";
  searchResults: SearchResult[]; answer: RagAnswer | null;
  limitations: Limitation[];
  documentResults: { documentId: Uuid; expectedDocumentRank: UInt | null;
    actualDocumentRank: UInt | null; failureCodes: IngestionFailureCode[] }[];
};
```

Index is the exact position in the corresponding final bound case array. executions is retrieval entries in original order followed by quality entries in original order, exactly once each. This binds duplicate textual IDs without removing or sorting cases. Report retrieval/rag results match the corresponding IDs/queries/questions and complete record values; configuration/provider/clock/populations match the profile/origin. Do not invent a case fingerprint from ordinary short cache hashes. SourceBindings are sorted by document ID and equal factual origin/profile authority.

searchResults retains every actual returned result in order, not topResults. For quality, answer is the actual complete returned RagAnswer; when an answer exists, searchResults equals its complete sources. This is the full returned answer-source stage, not all pre-packing retrieval candidates. Keep any separately captured pre-packing source evidence complete in its separately bound retained record; do not relabel answer.sources as that earlier stage or expand configured retrieval limits. For retrieval answer is null. Incomplete executions retain every available partial result/answer and explicit limitation; timeout/provider_failure cannot be presented as complete. A required quality answer missing under complete is invalid. All nested output fields are validated under the exact source declarations; a bare arbitrary JSON object is not sufficient.

documentResults uses the existing P04 failure-code vocabulary and rank meaning. Expected ranks come from the separately approved Expectations, not the report. Actual ranks are mechanically checked against the first-occurrence ordered unique document IDs derived from full searchResults. All raw repeated passage results remain retained. Positive rank is >=1, not zero. Source-role/governance failure codes require their actual governed output evidence; no free-form failure-message parsing fabricates codes. P04 `passed` is derived from validated outcomes/ranks/codes, never accepted as an independent new success field. The unchanged full P04 inventory parser receives those exact derived ordered document sets.

An Expectations.mustPassCases textual ID must identify exactly one (kind,index) occurrence across the full bound retrieval-plus-quality case set; otherwise refuse readiness. There is no admission override, occurrence-selection escape hatch, rename or dropped execution. The report retains every execution unchanged, including duplicate textual IDs that are not required. Each required ID shared by several documents resolves to that same unique execution, and the single whole-inventory map uses the mechanically derived first-occurrence ordered unique document IDs from that execution. Scalar actualDocumentRank must equal the document's position in this map (or null when absent), independently of P04's narrower membership/threshold checks. Preserve actual scored report failures and debt-acceptance fields; no existing debt waiver automatically authorizes missing U04 evidence or an incomplete case. Failed partial outputs remain fully retained in their original execution and report. The local P04 timeout/provider_failure input requires document absence/no rank: when honest actual output contains a returned document/rank that makes that mapping contradictory, refuse preparation rather than erase partial results, alter the ordered map, fabricate a null rank, or change the failure code. Do not invoke P04 with contradictory synthetic facts. A truthful incomplete case that can map consistently remains incomplete/NO_GO under the consumer capability contract; a plausible fallback does not erase its failure. No ordinary search limit, packing stage, scoring or report summary changes are authorized.

## 5. Unknown expectations and refusal examples

Root's compatibility ruling is explicit: unknown expected populations remain null in the actual P04 input. **Do not fabricate integrity_expectation_missing, change actual P04 eligibility/action/reasons, erase the mandatory origin digest or pretend a provider timed out.** The consumer separately returns retained measurement_unavailable limitations scoped to the unknown population, mechanically blocked capability entries, and a discriminated incomplete preparation result. It can preserve the actual P04 diagnostic inside that result; it cannot authorize preparation/enqueue/operational use. This uses the existing classifier-plus-limitations contract, not a new scoring rule.

Refuse: adjacent self-selected approval substituted for independent admission; policy row with wrong content/owner or raw forbidden marker even null; two retained entries resolving the same ref; wrong envelope/content digest meaning; row missing any required literal field; unsafe numeric conversion; foreign or missing source-array edge; a truncated topResults preview offered as full searchResults; same report with different origin/profile/case ordinal; missing or duplicate execution; quality complete with null answer; wrong derived rank/P04 contradiction; missing/duplicate/foreign wave member; per-document admission swapped across members; partial first-document success; required duplicate textual case ID even with a proposed occurrence override; failed partial output erased to satisfy P04; omitted required result disguised as an empty successful set; unknown expectation presented as ready. Retain valid false structure/quality judgements and actual P04 non-green reasons.

## Controller rulings applied; remaining implementation obligations

Routine names are OriginV1.rows and its exact table slots, AuditInputsV1.documents/AuditAdmissionV1.documents, RetainedEntry lookup, measurement-review/policy-review roots and AuditCaseReportV1.executions. Existing domain/encoding/SourceBinding/P04/result vocabulary and scoring are copied, not invented. No callback, trust boolean, admission override or operational endpoint is proposed.

The controller now binds rowDigest to the framed individual original SQL-row envelope; policy artifact.digest to SHA-256 of complete original canonicalPayload UTF-8 bytes, with retainedEnvelopeDigest separately binding the framed envelope; wave-wide origin/profile/cases and exact sorted per-document evidence/admission collections; complete returned engine outputs beside the unchanged scored report; refusal for ambiguous required textual case IDs without an override; truthful partial-output retention with refusal on P04 mapping contradiction; and separate unknown-expectation readiness refusal with unchanged P04 diagnostics. The quality source list is explicitly the returned answer-source stage. These resolve the identified representation gaps without changing acquisition/licence/clinical policy or the accepted local P04 API.

The one-member serialized policy example above remains a minimal example of its newly named wrapper, not a complete consumer fixture or wave-acceptance proof. The implementation fixtures must include a positive two-member wave proving both actual classifier results and the common ordered case map, plus a second-member refusal regression; both retain exact per-document bindings and complete rows/report/returned outputs. Full runtime schemas for actual nested engine types and added row columns, complete ref/witness reconciliation, and the independently sourced external admission loader remain obligations; naming these wrappers proves none of them. Source remains frozen pending root adoption and dispatch. No test or gate has run for this correction.

## Bounded review incorporation

Read U04-audit-consumer-representation-review-1.md, SHA-256 71df83575e50688007f91049766839446f38c38a18436fb7c91931e65f42eb6b. This correction applies its two Important findings: R1 removes the unrepresentable duplicate-occurrence override; R2 replaces singular document evidence/admission with exact sorted whole-wave collections and one complete inventory parse. The compatible row/policy digest meanings, independent admission trust boundary, full-output stage distinction, mechanically checked rank, failed-partial refusal and unknown-expectation ruling are explicit above. No additional review finding introduces new scope.

That report is one independent schema/representation review with bounded evidence-binding assessment. The earlier clinical document is preparation, not a second review or clinical acceptance. Proposal 2 still requires root's narrow delta review/adoption; this authoring report does not claim it passed. The accepted local P04 API remains unchanged; RAG Main compatibility reconciliation stays with the later integration owners.
