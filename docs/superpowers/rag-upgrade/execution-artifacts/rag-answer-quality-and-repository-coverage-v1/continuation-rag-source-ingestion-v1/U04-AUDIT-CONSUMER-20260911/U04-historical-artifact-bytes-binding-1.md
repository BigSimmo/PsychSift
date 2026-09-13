# U04 historical audit bytes — controller binding 1

This closes the historicalArtifact byte representation within the adopted actual-audit consumer. Origin3 section3 requires original historical bytes and their opaque expectedStateDigest to remain unchanged. The current P04 CLI writes pretty JSON plus a newline; canonicalizing that JSON or labelling it PostgreSQL JSON text would change or misdescribe the original artifact. There is no newly asserted P04 expected-state preimage algorithm.

Use the existing u04-retained-evidence-v1 / node-json-v1 envelope for exactly this wrapper:

```ts
type HistoricalAuditBytesV1 = {
  kind: "u04-historical-audit-bytes-v1";
  documentId: Uuid;
  expectedStateDigest: Bare64 | null;
  bytes: { encoding: "base64"; content: string };
};
```

The base64 is canonical RFC4648 standard alphabet/padding with no whitespace. Decode it to original bytes and require exact re-encoding equality; an empty original byte sequence is representable, not evidence of a valid historical audit. Do not decode/re-encode the artifact through UTF-8 or JSON. This preserves whitespace, newline, BOM and any non-UTF8 bytes. The surrounding wrapper is canonical Node JSON; its contents do not claim that the original artifact was canonical JSON, SQL JSON text or a newly parsed/validated P04 record.

In existing DocumentAuditInputsV1.historicalArtifact, artifactDigest means sha256: followed by lowercase SHA-256 of the decoded ORIGINAL artifact bytes. Its envelope is the wrapper above, and the supplied outer expectedStateDigest must equal the wrapper value exactly. Preserve that historical value, including null; never replace it with this raw-byte hash, the wrapper envelope digest, the new origin digest or the provenance-review digest.

Add exactly one per-document independent admission field: historicalEnvelopeDigest: Digest. Keep existing historicalArtifactDigest bound to the original-byte artifactDigest. The new field binds the complete retained wrapper envelope digest, including documentId and opaque historical expectedStateDigest; both digests must match that document's separately approved admission entry. This prevents caller-supplied changes to the wrapper or old expected-state value while preserving the same original byte digest. The documentId must equal its exact admitted wave member. No self-supplied adjacent wrapper may populate independent admission.

This is explicit retention/attribution of previously approved historical evidence, not semantic validation of arbitrary old bytes. The opaque expectedStateDigest must come from the retained historical review/admission record; do not invent one by parsing guessed fields or current state. Missing independent historical association/digest evidence refuses preparation. A structurally retained historical artifact never proves current source authority, expected populations, clinical support or activation readiness. Actual current P04 inputs still derive only from the separately bound new origin/expectations/measurements/cases under the existing contract.

Update the existing synthetic consumer fixtures and independent admission fixtures together. Meaningful regressions must preserve original pretty bytes plus newline/BOM, distinguish original byte digest from envelope digest, reject modified bytes/base64, reject altered historical expectedStateDigest even with a newly framed adjacent wrapper, and reject a wrong member or missing/swapped historicalEnvelopeDigest. Include this finite correction in the next complete independent source review and focused gate. It does not authorize processing real documents, fetching artifacts, providers or operations, and does not create another envelope domain or source owner.
