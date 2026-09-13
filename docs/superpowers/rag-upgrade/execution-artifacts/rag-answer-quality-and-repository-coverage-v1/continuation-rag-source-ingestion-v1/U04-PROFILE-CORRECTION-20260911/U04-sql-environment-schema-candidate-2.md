# U04 fixed SQL environment evidence schema candidate 2

Controller design draft, 11 September 2026. Outside the repository. This defines a semantic evidence format; it does not describe observed server facts, issue SQL, authorize a collector or claim acceptance. It supplements the incomplete `U04-profile-sql-evidence-candidate-1.md`, whose unclosed header types cannot be treated as parsers. Original U04 TASK_BASE remains e502ecd9b18f4a8f22469f68c0ffa5976a33a619.

## Scope decision

The complete source-row preservation contract remains all 335 existing fields plus adopted U04 additions. That rule does not require copying every column of every PostgreSQL system catalog into this separate environment record. This record retains the exact semantic definitions, relevant settings, identities and attributable evidence listed below. Future version-specific collectors must have a reviewed mapping into these fields and must refuse unsupported or incomplete mappings. Choosing a schema does not establish that a particular collector or server supports it.

Pre-profile inputs are software identities, schema/function/index definitions, text-search and collation dependencies, effective settings and deadline configuration evidence. Per-side row-dependent query plans, statistics, ANN outcomes, actual latency and parity are later result evidence bound to the completed profile. They do not enter its preimage. Existing acknowledged planner/tie nondeterminism remains a limitation, never a completeness success or an excuse to omit logical source evidence.

## Primitives and encoding

Every object is exact-key and all listed fields are mandatory unless a union explicitly supplies another shape. `Text` is a nonempty surrogate-paired string, retained unchanged; identity fields additionally reject surrounding whitespace. `UInt` is a nonnegative safe integer; `PositiveInt` is positive. `Digest` is `sha256:` followed by exactly 64 lower-case hex digits. `QName` is exactly `{schema: Text, name: Text}`. A QName is an identity only: it is never interpolated into a query or used for dynamic dispatch. Fixed collector code owns all selectors.

`Timestamp` is an exact UTC timestamp text with an explicit decimal fraction of one to six digits and terminal Z. Validate calendar/time ranges without passing the authoritative value through JavaScript Date; compare padded fractional digits where necessary, retaining the original spelling. The profile comparison clock remains its separate exact millisecond-UTC type.

`RetainedBytes` is `{encoding: "utf8" | "base64", content: string, byteLength: UInt, digest: Digest}`. UTF-8 strings reject unpaired surrogates. Base64 must decode and re-encode identically using standard alphabet/padding with no whitespace. The digest hashes decoded original bytes, not the base64 spelling. Verify exact byte length and full SHA-256. This is a fixed byte container inside a typed record, not an arbitrary JSON/SQL selector or a completeness assertion. All enclosing size ceilings apply without clipping.

Package the typed records below under `u04-sql-execution-evidence-v1/node-json-v1` and the existing five-key raw-envelope frame. Strict kind tags prevent capture/review/bundle substitution. A server-native raw payload is retained as bytes as well as its fixed typed projection; the reviewed collector mapping must prove equality. Never hash a rounded or reserialized typed view as if it were the native original.

## Complete capture shape

```text
SqlEnvironmentCaptureV1 {
  kind: "u04-sql-environment-capture-v1",
  evidenceMode: "mocked" | "real",
  target: {
    projectRef: Text, databaseIdentity: Text, serverIdentity: Text,
    effectiveRole: Text, requestPathIdentity: Text
  },
  capturedAt: Timestamp,
  producer: { identity: Text, toolVersion: Text, toolArtifactDigest: Digest },
  implementation: ImplementationBinding,
  runtime: {
    postgresVersion: Text, pgvectorVersion: Text, pgTrgmVersion: Text,
    serverEncoding: Text, distributionIdentity: Text
  },
  nativeCapture: RetainedBytes,
  textSearch: TextSearchDefinition,
  collations: CollationDefinition[],
  relations: RelationDefinition[],
  routines: RoutineDefinition[],
  operations: OperationEnvironment[],
  deadlineConfiguration: DeadlineConfigurationV1
}

TextSearchDefinition {
  configuration: QName,
  parser: {
    identity: QName,
    start: RoutineIdentity, token: RoutineIdentity, end: RoutineIdentity,
    lexTypes: RoutineIdentity, headline: RoutineIdentity | null
  },
  tokenMappings: {
    tokenId: UInt, tokenAlias: Text, dictionaries: QName[]
  }[],
  dictionaries: {
    identity: QName, template: QName,
    initializationRoutine: RoutineIdentity | null,
    lexizeRoutine: RoutineIdentity,
    optionsDefinition: RetainedBytes,
    dependencies: DictionaryDependency[]
  }[]
}
RoutineIdentity { identity: QName, argumentTypes: Text[], resultType: Text }
DictionaryDependency =
  { kind: "distribution_builtin", identity: Text, distributionIdentity: Text }
  | { kind: "retained_resource", identity: Text, bytes: RetainedBytes }

CollationDefinition {
  identity: QName,
  provider: Text,
  encoding: Text,
  localeDefinition: RetainedBytes,
  deterministic: boolean,
  declaredProviderVersion: Text | null,
  observedProviderVersion: Text | null,
  nullVersionReason: "not_applicable" | null
}

RelationDefinition {
  relation: Relation,
  definition: RetainedBytes,
  indexes: {
    identity: QName, accessMethod: Text, valid: boolean, ready: boolean,
    definition: RetainedBytes,
    operatorClasses: QName[], collations: QName[]
  }[]
}
RoutineDefinition {
  routine: RoutineIdentity,
  definition: RetainedBytes,
  provenance:
    | { kind: "repository", implementationPath: Text, sourceDigest: Digest }
    | { kind: "distribution", distributionIdentity: Text, artifactDigest: Digest }
}

OperationEnvironment {
  operation: SqlOperation,
  entryRoutine: RoutineIdentity,
  dependencyRoutines: RoutineIdentity[],
  relations: Relation[],
  collations: QName[],
  settings: SettingEvidence[]
}
SettingEvidence {
  name: SettingName,
  effectiveText: Text,
  unit: Text | null,
  source: "function" | "role" | "database" | "request" | "server",
  definingRoutine: RoutineIdentity | null
}
```

ImplementationBinding is the enclosing profile's strict commit/file-byte identity, not permission to execute an arbitrary path. The nativeCapture retains one exact NativeEnvironmentFactsV1 object in the fixed representation defined below. Its preimage excludes nativeCapture, any runtime witness, capture/review/bundle envelopes and their digests; no self or witness cycle is permitted. The reviewed producer artifact maps the actual supported server observations into that fixed facts shape, never an input-selected schema. Retained relation/index/routine definitions are full non-pretty semantic definitions from the chosen supported producer, including expressions, predicates, keys/includes/order, access methods and options where applicable. They are inert evidence bytes; the parser never executes them. Merely accepting a nonempty definition is not verification that it matches a server object.

The external capture-admission package must specify the supported server/extension build and the exact collector/mapping artifact. An unknown build or mapping is unavailable, not coerced into the nearest representation. The parser can validate this semantic record without hard-coding unobserved deployed version values; real admission additionally requires an independently accepted collector-to-server mapping and the real captured records. Actual implementation of that collector is a named pending connected-acceptance dependency, not evidence provided by this document.

## Acyclic native facts and exact projection

`NativeEnvironmentFactsV1` is a closed record with exactly kind="u04-native-environment-facts-v1", evidenceMode, target, capturedAt, producer, implementation, runtime, textSearch, collations, relations, routines, operations and deadlineConfiguration. The latter twelve fields have exactly the same types and values as the corresponding capture fields above. It contains no nativeCapture or later runtime witness. Complete nativeCapture bytes must decode as one UTF-8 JSON object of that exact shape; reject duplicate keys, unsafe numeric tokens, extra/missing fields and invalid primitive types before projection. Preserve the original native JSON serialization without canonicalizing it or passing it through Date. The retained byte digest and length always refer to original bytes; equality of the validated typed projection is a separate check.

Every corresponding native-facts field must equal the outer capture field exactly, including ordered arrays, optional nulls, original text and definition/resource bytes. This is a finite field-to-field comparison, not a generic caller-supplied mapping or unchecked spread. The producer's version-specific SQL/catalog extraction must supply these fields faithfully, but implementing or executing that collector is later evidence. A synthetic complete facts record can exercise the exact same parser locally under mocked mode.

Native facts include the complete deadlineConfiguration from U04-deadline-configuration-contract-candidate-2.md and precede capture/review/bundle construction. No runtime witness is embedded or needed to construct a profile. A later separately admitted runtime witness may cite the completed nativeCapture raw byte digest under the explicit native-environment-facts meaning; it cannot be placed back inside that same facts/capture preimage. No profile/origin/final-plan digest enters native facts.

## Finite populations and selectors

`SqlOperation` is exactly the 26 tags already adopted in SQL-binding1: aliases, corpus_terms, correct_terms, text_chunks, hybrid_chunks, vector_chunks, lookup_chunks, lookup_chunk_terms, lookup_chunk_prefix, lookup_documents, lookup_document_terms, table_facts, embedding_fields, index_units, memory_cards_hybrid, memory_cards_lexical, chunks_by_ids, chunks_by_indexes, documents, ranking_metadata, related_documents, quality, images_by_ids, images_by_pages, visual_rows, adjacent_chunks. Require each once, sorted by code-unit order. The final fixed U04 reader implementation maps each tag to its exact signature/dependencies; supplied routine identities cannot change that mapping.

`Relation` is exactly these existing 22 plus the five authored private tables: documents, document_pages, document_chunks, document_images, document_table_facts, document_embedding_fields, document_index_units, document_sections, document_memory_cards, document_summaries, document_labels, document_index_quality, ingestion_jobs, indexing_v3_agent_jobs, ingestion_job_stages, import_batches, rag_aliases, document_title_words, public_source_versions, public_source_activation_events, public_source_serving_authority, document_publication_approvals, shadow_reindex_waves, document_index_generations, document_generation_projections, document_generation_inventory, document_generation_baselines. All are public-schema identities. These 27 names are the maximum existing U04 relation vocabulary, not a requirement to collect every one for physical evidence. Require exactly the structural dependency set of the fixed admitted entry/guard/projection implementation, once and sorted, including an explicit empty index array where appropriate. Each operation relation list must equal its admitted mapping; the capture relation set is the exact dependency union of those operations and the fixed deadline operation family. The latter includes only already adopted capture/mutation/control owners whose actual definitions/configuration must be covered; it adds no new operation. Full dependencies come from the fixed source closure, never an input-selected subset. The source/origin full-row contract remains independently complete. This record does not add a retrieval read or speculative physical audit of document_title_words or any other excluded source.

For each relation retain the full index population attached to that relation, not a caller-selected successful index subset. Collect every collation referenced by these definitions or the fixed query-expression/text-search dependency closure. Keep every custom rule/resource required by those definitions. Native catalog identifiers may be used internally by the reviewed collector, but this interface identifies objects semantically; it does not accept arbitrary catalog table/column names. The exact version-specific extraction queries and mapping tests are implementation evidence, not new shape choices for consumers.

The parser QName identifies the text-search parser object; its five support-routine slots bind the exact signatures and complete retained or distribution-owned implementations, including the optional headline slot. It is not treated as a single SQL function. Text-search configuration is the actual English configuration used by the fixed readers, resolved to a QName. Token mappings are complete, sorted by tokenId; dictionary order within each token mapping is meaningful and preserved. Dictionaries are the complete transitive referenced set, sorted by QName; duplicate/unknown/missing identities refuse. Preserve full options/resource bytes. Distribution-built-in references require the same independently bound distribution identity; custom/external resources require retained complete bytes, not filenames or mutable URLs. A configuration merely named english is insufficient.

Collations are the complete referenced set sorted by QName. Both provider versions must be present or both null with nullVersionReason=not_applicable, supported by the admitted provider mapping. Unknown/unavailable versions cannot masquerade as not applicable. If declared and observed versions differ, real admission refuses until separately resolved; no refresh or index rebuild is authorized here. Provider/locale text is descriptive, not a new caller-selected behavior. Unsupported provider mapping refuses.

Routine definitions cover the exact entry routines and fixed helper closure of the reviewed U04 reader/capture/guard/mutation implementation and deadline bindings. Each identity includes ordered argument types to disambiguate overloads. Require matching signatures, full definitions and exact provenance. Repository-owned provenance resolves to an admitted implementation file/digest; distribution-owned provenance resolves to the separately admitted build/artifact identity, never a fabricated repository path. Include the text-search parser and dictionary support-routine closure as well as entry/guard helpers. A routine name alone is not enough. A new unexpected helper is a closure failure. No query to the global source corpus, config resolver or provider is justified by this environment capture.

## Fixed setting contract proposed for review

This is an explicitly finite comparison setting policy, not a claim that every PostgreSQL setting affects logical ranking or that identical settings make ANN deterministic. Set names are exact literals; retained values are text to avoid losing native units or precision:

```text
SettingName =
  "TimeZone" | "default_text_search_config" | "search_path" |
  "statement_timeout" | "lock_timeout" |
  "pg_trgm.similarity_threshold" | "hnsw.ef_search"
```

Require all seven names exactly once per operation, sorted by name; no missing setting becomes a default. These are contract identities, not a report that the current server exposes them or uses a particular value. The first three bind the existing time/text-search/name-resolution environment, the next two the adopted deadline controls, and the last two the explicitly identified similarity/ANN settings. Values on an operation that does not use them are observations, not instructions to apply a global override. Common native observations may be referenced by the fixed operation mappings; do not perform 26 duplicate captures merely to populate this representation.

No new universal planner-GUC inventory is required. Preserve relevant structural definitions and later measured parity/limits with acknowledged planner/ANN uncertainty. The final adapter/source review must still identify any additional explicit material override in its own implementation; if present, amend this finite setting vocabulary before admission. It may not silently read or tune an unbound extra setting. This initial format does not claim exhaustive attestation of every physical planner input or deterministic recall.

`source=function` requires definingRoutine equal to the appropriate fixed function, with evidence that its configuration applies during execution. Other source kinds require definingRoutine=null and attributable role/database/request/server evidence in nativeCapture. A prior session SHOW or configured environment string cannot alone establish effective nested-function settings. The consumer compares the exact admitted operation settings with those effective on each guarded read, alongside origin/control checks.

Retain vector_chunks hnsw.ef_search=100, without applying it globally. Distinguish pg_trgm.similarity_threshold from unchanged corrector min_sim=0.45 and fact threshold0.18. TimeZone/text-search/settings and the profile clock must agree across comparison sides. Preserve exact source formulas, limits, cache isolation and acknowledged ties. Per-side plans/statistics/ANN and latency evidence remain later obligations; they are not replaced by this environment identity.

## Review and retained bundle

```text
SqlEnvironmentReviewV1 {
  kind: "u04-sql-environment-review-v1",
  evidenceMode: "mocked" | "real",
  captureEnvelopeDigest: Digest,
  reviewer: { identity: Text, role: "database_schema_reviewer", reviewedAt: Timestamp },
  coverage: {
    area: "target_and_implementation" | "text_search" | "collations" |
          "structural_dependencies" | "operation_settings" | "server_deadline",
    outcome: "satisfied" | "unsatisfied" | "unavailable",
    findings: Text[]
  }[]
}
ReviewedSqlEnvironmentBundleV1 {
  kind: "u04-reviewed-sql-environment-v1",
  evidenceMode: "mocked" | "real",
  captureEnvelope: SqlEnvironmentCaptureEnvelope,
  reviewEnvelope: SqlEnvironmentReviewEnvelope
}
```

Each of the six review areas appears exactly once in literal code-unit order. Unsatisfied/unavailable has nonempty concrete findings. A satisfied area is independently judged against the complete fixed selection below, not a caller-selected subset, arbitrary witness ID or empty successful observation list. The review already binds the full capture envelope digest; these fixed selectors require no separate locator protocol.

| Review area | Complete selected evidence |
| --- | --- |
| target_and_implementation | target, producer, implementation, runtime and their exact native-facts counterparts |
| text_search | full textSearch, every referenced support-routine definition/provenance and dictionary resource/distribution binding |
| collations | full collations and all referenced collation dependencies in retained definitions |
| structural_dependencies | full relations, all attached indexes, routines and each operation's fixed routine/relation/collation dependency population |
| operation_settings | all seven effective settings for every one of the 26 operations, with full native attribution and defining routines |
| server_deadline | complete deadlineConfiguration, associated operation settings, full role/path/routine-override facts and client implementation binding |

Every area also uses the original nativeCapture bytes and exact mapping checks. No source fact is verified merely by the presence of a typed field. The reviewer must be distinct from the producer, including distinct mock fixture actors. The role label is descriptive; authority comes from the existing independently supplied controller admission package binding the exact outer bundle digest, target, implementation and actor identities. No self-approval or signature service is introduced.

The profile embeds the complete outer bundle in sql.environment; the nested review captureEnvelopeDigest equals this exact capture envelope digest. Full nested bytes must resolve and validate, and the review must bind that same capture. Real operational acceptance requires all six areas satisfied and externally admitted. Mocked or incomplete records cannot construct clients. The profile consumes this one complete bundle; no separate per-section reference may substitute conflicting evidence.

Capture, native facts, review and bundle contain no profile/origin/final-plan/receipt/request digest; the graph stays acyclic. DeadlineConfigurationV1 is exactly the closed nested contract in U04-deadline-configuration-contract-candidate-2.md. Whole-correction review and controller adoption are required before implementation. Actual collector and final adapter source closure remain separate later implementation/acceptance proof; neither is claimed complete here.

## Focused local acceptance after adoption

Strict parsing tests cover all required/extra keys, duplicate/missing populations, false not-applicable versions, mismatched native/typed mapping, wrong routine overload, removed index/dependency/dictionary resource, reordered dictionary meaning, changed settings, wrong effective source, byte precision/tampering, actor/mode/target mismatch and unresolved configuration evidence. Positive fixtures retain complete explicit synthetic definitions and settings under mocked mode and refuse operational entry. They prove format and orchestration only. Actual catalog extraction, same-call effective settings, effective deadline configuration and later server enforcement, role/grant/privacy, extension behavior and connected parity require later separately authorized proof.
