# U04 private-object unit identity — controller binding 1

The adopted evidence-record contract1 names the private_objects UnitId.key as an object identity digest but leaves its exact encoding open. This is a narrow representation binding for the existing owner, not a new licence, access policy, envelope domain, producer or storage operation. Other unit-key meanings are unchanged.

For an already strictly validated ArtifactRef with tag private_object, construct exactly its seven declared fields: tag, bucket, objectPath, objectVersion, sha256, byteLength and mediaType. Include the fixed tag and explicit null objectVersion. Use the existing encodeShadowNodeJsonCanonicalPayload algorithm to encode this entire record; the unit key is sha256: followed by the lowercase SHA-256 of those complete canonicalPayload UTF-8 bytes. Hash no envelope frame and no object bytes at this identity-key step. The existing ref.sha256 separately binds the immutable object bytes. These identities must not be interchanged.

Do not trim, case-fold, normalize a path/media type, drop null, omit version/length, substitute a content-only digest, or add a parent document to the object identity. Exact document/origin/candidate ownership, permitted attachments and reciprocal relationships remain separately required and are never inferred from a matching key. Validate complete retained bytes, content digest and length independently. Unknown/missing object identity or bytes remains unavailable/refused under existing rules. No fetch, deletion or live object operation is authorized.

A fixed representation vector (not a consumer/clinical fixture):

```json
{"bucket":"synthetic-bucket","byteLength":0,"mediaType":"application/octet-stream","objectPath":"fixture.bin","objectVersion":null,"sha256":"sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","tag":"private_object"}
```

Expected unit key: sha256:55e52f679431feef1264444f5cdf0c5239a9b97066ff1d346a1c29c5a0bc9992. Root independently computed this with .NET SHA256 over the exact literal UTF-8 bytes; no project function, provider, actual document or object was executed/processed. Product verification must exercise the actual canonical encoder and identity helper, preserve property-order invariance, and distinguish changed bucket/path/version/media type/length or content digest. A changed key never relaxes attachment/owner checks.

Implement within the existing two-file consumer scope; include this binding and its complete use in the subsequent independent source review and focused tests. This controller ruling is not a separate clinical review or runtime acceptance, and it does not accept U04.
