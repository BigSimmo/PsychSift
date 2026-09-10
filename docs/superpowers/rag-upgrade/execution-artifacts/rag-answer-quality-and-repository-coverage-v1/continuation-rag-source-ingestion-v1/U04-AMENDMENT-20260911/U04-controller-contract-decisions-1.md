# U04 controller contract decisions — review candidate

Outside proposal at `3822cc1271b04dc85ec9d7c4afcf7afa26b06db2`. This is not an admitted implementation brief or product acceptance. U03 is accepted; U04 remains in preparation. Decisions below resolve routine design choices for independent amendment review under existing serial local authority. They do not authorize connected execution.

## 1. Storage and recovery decisions

Adopt the schema contributor's minimum of existing generation-addressed core artifacts, generation-addressed pages, and private fixed candidate projections. Preserve live summary, generated/manual labels, quality, organisation metadata, producer aliases and generation pointers. Candidate C belongs to one exact wave; each member retains its own G0 and immutable first attempt. Keep U03 Fence.expected at G0. Do not simulate a committed C handoff to use existing enrichment functions.

Adopt no reclaim after the first successful claim for a member in C. Same-plan enqueue may return its existing reservation and immutable receipt; it cannot restart a claimed member. Uncertain or failed first attempts require a new whole-wave C under later operational authority. This sacrifices same-wave retry availability to avoid mixing evidence under keys that lack attempt identity. Never delete uncertain evidence to make a retry fit. U05/U13 continue to own later retention and governed cleanup.

Adopt new shadow jobs with `batch_id=NULL`, managed as a population by the wave ledger. Keep original import-batch rows, their accounting and document linkage unchanged. Do not call the ordinary enqueue helper that changes live document fields. Standard ingestion retains its existing batch behavior. The candidate-specific terminal operation closes only the matched job and has no import-batch update.

Adopt a private, strictly validated control checkpoint/revision per member, updated atomically with each permitted shadow control transition. Its purpose is to distinguish the original state from this wave's own progress without ignoring queue columns globally. The contributor's state contract specifies original-row equality, exact owned IDs, source/G0 preservation, timestamp precision and unchanged foreign rows. This checkpoint is not a replacement for U03's lease/authority checks. Its implementation necessarily includes the shadow branches of actual claim/heartbeat/progress/stage/terminal owners; add those symbols explicitly to the reviewed allowlist. Preserve standard branches and the accepted U03 migration bytes.

Do not claim that row locks prevent new-row phantoms. The connected transaction boundary and complete cooperating-writer closure need an explicit reviewed choice and later SQL schedules. This unresolved evidence must remain visible in the brief and connected admission; it is not supplied by mocked tests.

## 2. Correct the origin-digest assumption

`U04-state-comparison-contract-1.md` corrects the schema proposal: P04 accepts an opaque bare 64-hex expected-state digest and compares it; it does not implement the assumed database/queue snapshot encoder. Retain the exact original audit and digest unchanged. Do not prefix it, replace it with a newly computed hash, or claim it includes queues.

Define a separately versioned U04 origin/baseline/control binding. A production adapter must prove the relationship between the reviewed P04 evidence and its locked pre-enqueue snapshot. Until that adapter and preimage contract are implemented and reviewed, the connected path must return `origin_binding_unavailable` before clients/mutations. An injected test origin verifier establishes only mocked orchestration behavior. Never leave a caller-supplied `verified:true` or arbitrary adapter name as the production authority.

The exact owning task for that origin adapter and its transaction contract remains a substantive closure item before a complete U04 dispatch. A permanently refusing placeholder cannot be described as a fully implemented stage workflow. Preserve this as an ownership gap rather than silently expanding P04's historical acceptance.

## 3. Digest mechanism proposed for review

Avoid assuming JavaScript JSON serialization and PostgreSQL `jsonb::text` produce identical bytes. Also avoid replacing accepted P04/recovery digests or their algorithms. New U04 digest envelopes use one named producer of canonical bytes, with every consumer hashing those retained bytes rather than independently reserializing a parsed value.

Proposed envelope: strict `{version:1, domain, encoding, canonicalPayload, digest}`. `domain` is a closed enumeration of plan, inventory, projection, baseline, control, member_receipt, wave_receipt, evaluation_report. `encoding` is `node-json-v1` for client-authored plan/report payloads, or `pg-jsonb-text-v1` for server-derived row/bundle/receipt payloads. The exact encoding is part of the digest and cannot be changed on an existing object. The payload is the complete validated value, excluding its own digest envelope; external evidence digests remain included as ordinary bound fields.

Hash UTF-8 bytes of `U04-SHADOW/1\n` + domain + `\n` + encoding + `\n` + decimal UTF-8 payload byte length + `\n` + canonicalPayload. Header fields are fixed enumerations with no newline; length is base-10 without leading zeros. Never truncate or normalize evidence strings, Unicode, line endings or precision-bearing native payloads to form a digest.

For `node-json-v1`, the client validates a strict JSON value, recursively sorts object keys by JavaScript code-unit order, preserves meaningful array order, sorts only explicitly set-valued collections by their declared identities, and serializes once. Reject undefined, non-finite numbers, unsafe integer values, cyclic objects and unpaired surrogates. For `pg-jsonb-text-v1`, the server produces the bytes once from its validated fixed-family object, using explicit ORDER BY for every set aggregation; preserve those exact bytes in the envelope. Runtime/version and encoding provenance are recorded. Consumers preserve the raw payload string even when parsing a typed view. Precision-bearing values that cannot safely round-trip in JavaScript must use declared textual representations or fail typed validation while retaining raw evidence; no silent numeric rounding.

The receiver verifies the digest against the original bytes and parses the authoritative payload under the fixed domain schema. Do not accept a second independently supplied payload that can differ from the hashed one. Server-derived envelopes cannot be manufactured by accepting client-supplied baseline/receipt fields; their fixed RPC derives them from locked rows. Node-authored content is still untrusted plan input and all source/member/operation predicates remain server checked. Byte identity alone never proves authority or completeness.

This proposal requires explicit envelope changes to the new RPC/TypeScript contracts and independent schema/RAG review. Required authored vectors include reordered keys, semantic set order versus meaningful sequence order, null/absent rejection, non-ASCII and multiline evidence, fractional numbers, unsafe integers, wrong domain/encoding/length, extra fields and one-byte tampering. Source-only SQL checks cannot claim runtime cross-language conformance; later SQL proof must verify actual database-generated vectors. If review finds this too costly, choose a simpler single-producer format explicitly; do not silently fall back to unbound JSON.stringify comparisons.

## 4. Artifact requiredness and honest evaluation

For each format/path, the approved producer contract declares expected families/units before persistence. Required core/control/provenance evidence must be retained and resolvable before seal. Every available producer output and relationship must be represented by an exact artifact reference or complete retained payload. Failure/skip/exclusion dispositions remain explicit with scoped reasons; surviving counts are not the expected population.

Optional summary/deep-memory/provider failures may leave an inert sealed candidate only where the existing product contract makes that family optional and original evidence remains usable. Such a receipt must carry its limitations and cannot claim complete structured enrichment. Required gaps, ambiguous attachment, pending dispositions, mixed attempts, lost authority or uncertain seal block the dependent evaluation. U02's structured marker and richer fallback preservation remain unchanged.

Native capability and semantic support are separate axes. U04 must faithfully retain what its existing producers return and preserve unknown/limited extraction evidence; it cannot mark U09's extraction-fidelity work or U10's eligibility complete. A metric report must declare its exact evidence/population scope. Required unavailable metrics or an unsupported candidate context produce NO_GO, never an automatically accepted reduced test set. Neither a stage receipt nor a metric GO activates anything.

The closed field schemas, producer limits and exact native-capability dispositions must be expanded into the final brief from actual validators, not left as an implementer's arbitrary JSON contract. Pending evaluation owner closure must also name source metadata, quality, summaries/labels, aliases, adjacent context and cache boundaries. The two proposed SQL chunk wrappers alone do not establish a complete candidate RAG context.

## 5. Remaining dispatch gates

1. Resolve the origin-preimage/transaction owner and exact candidate evaluation owner closure; finalize per-family schemas and the exact source/test/SQL-symbol allowlist.
2. Correct and independently review the prospective runner, then bind actual input manifests and focused failure-accounting proof. Schema-test migration enumeration remains a separate owned correction. Do not run candidate 1 or a default broad discovery command.
3. Freeze the complete amendment/brief and source inputs; obtain required independent xhigh verdicts with observed local route evidence. Keep failed reviews and distinguish design contributors from independent reviewers.
4. Only then dispatch one fresh Astra/high U04 implementer. Root owns gates, index, commits and full-range acceptance. No connected operations, providers, SQL execution, native/real documents, activation or publication are authorized by these preparation decisions.

Historical U02 offline evaluation remains exit 1, four failed suites, 45 failed and 586 passed overall. It is not green and supplies no U04 exception. P08A remains superseded and the retrieval kernel default-off.
