# U04 correction: non-catalogue policy evidence without forbidden markers

This narrow mapper correction takes precedence over origin transaction3's blanket metadata mapping for the P04 metadata.sourcePolicyVersion field. Accepted U03 and P04 source, migration bytes, policy predicates and the old indexing-health adapter remain unchanged.

Confirmed integration conflict: U03 non-catalogue authority rejects the presence of metadata.source_policy_version, even null (`20260831101000_fence_ingestion_leases_and_repairs.sql:99-103`). P04 requires nonempty metadata.sourcePolicyVersion (`ingestion-audit.ts:437-451`). Mapping this P04 field only from the original document marker cannot accept an otherwise valid document-owned upload. This is a U04 mapper-interface correction, not permission to weaken either predicate or rewrite a document.

For a catalogue-version member, retain the original mapping and exact current catalogue/version/event policy evidence. For a document_owned member, require an explicit entry in the independently approved execution profile's `documentOwnedPolicies` array, whose strict entry shape is:

```ts
{
  documentId: Uuid;
  ownerId: Uuid | null;
  contentHash: Digest;
  sourcePolicyVersion: Text; // existing P04 version length/schema
  policyArtifact: { digest: Digest; retainedEnvelopeDigest: Digest };
  reviewArtifact: { digest: Digest; retainedEnvelopeDigest: Digest };
}
```

The array is sorted unique by documentId and contains exactly the document_owned members, no catalogue or foreign members. Each full retained policy artifact and review record is an input of the already existing explicit operation/profile admission, not a caller-only claim of approval. The review record identifies the exact policy bytes/version and document/owner/content population it admits. The controller's approved package binds those exact artifacts and the profile digest. This supplies the current audit/evaluation source-policy identity; it does not create a new licence, content eligibility rule, catalogue entry or approved supplementary source. Unsupported/missing policy or review evidence means not ready. Merely passing a nonempty string does not qualify, and a current configured default must never fill it.

The capture wrapper validates the complete approved profile before capture; origin capture binds its digest and the fixed sourcePolicyVersion argument. The returned origin retains every original document metadata byte, with forbidden public-source markers absent. On mapping, match profile entry document/owner/content to captured factual rows, and its version to the origin/profile effective policy version. For document_owned P04 metadata only, sourcePolicyVersion comes from this reviewed profile entry and sourceCatalogueKey is null. All other mapped metadata and every source exclusion/governance predicate remain as previously specified; sourceGovernanceValid is still their conjunction. Review evidence cannot authorize a failed U03 predicate. Mixed-policy waves refuse unless every member shares the exact policy identity required by the existing fixed profile/capture interface; do not silently select one member's policy.

SourceBinding.sourcePolicyVersion is that effective reviewed policy identity for document_owned members and the actual authoritative version for catalogue members. Existing complete provenance remains separate: expected/actual extraction/parser/chunker/index/model/source-policy versions require the existing attributable producer/review evidence. A profile's current audit policy is not substituted for a missing historical provenance.actual.sourcePolicyVersion. That provenance witness may point to an independently retained historical producer receipt in the bound reviewed evidence, as permitted by the evidence-record reference shape. If historical provenance is absent, preparation remains explicitly unavailable; do not fabricate it by copying expected values or adding a forbidden document marker.

Focused positive fixture: an uploaded_local document with no forbidden public-source metadata keys, existing supported corpus/role/content/licence fields and all other U03 source predicates satisfied; a separately bound reviewed profile policy record; full attributable provenance/witnesses; actual P04 parsing/classification. The P04 metadata policy value is nonempty while original metadata remains marker-free. Add wrong/missing/changed profile policy/content/owner/review refusal and every stray marker rejection, including source_policy_version:null. Retain a catalogue positive/regression fixture using its original source-version/event mapping. Mocked authority/profile evidence remains local-only and is rejected before operational clients.

The document-owned positive fixture must prove both authority predicates and actual P04 `eligibleForShadowPlan=true`, with `blockingDisposition=null`; merely parsing a quarantined record is insufficient. It may retain a truthful repairable diagnostic such as a fully witnessed duplicate chunk, but all policy/review/case evidence must be valid. Assert absence of both source_policy_version and source_catalogue_key in the raw document, rather than supplying null keys. The P04 result's policy version and null catalogue key are mapper output fields, not document mutations.

No new source acquisition, real evidence review, provider, SQL, migration application or source policy change is authorized or performed by this proposal.
