# U04 execution-profile correction candidate 2

Controller draft, 11 September 2026. Not adopted; no profile consumer is admitted by this document. It closes the specific missing-domain/root-schema reference identified in `U04-execution-profile-domain-assessment-1.md`, using the bounded current-source owner map in `U04-execution-profile-config-owner-map-1.md`. It does not reopen the completed programme audit or change accepted P04/U02/U03 behavior. Original U04 TASK_BASE is `e502ecd9b18f4a8f22469f68c0ffa5976a33a619`.

## Proposed finite decisions

1. Propose four fully named domains, each paired only with `node-json-v1`: `u04-execution-profile-v1`, `u04-engine-config-v1`, `u04-evaluation-cases-v1`, and `u04-sql-execution-evidence-v1`. Their exact payloads are this root and its named companions; a domain name alone never makes missing evidence admissible. The nested identities retain complete records without reinterpreting `plan` or source-bound evidence domains. Preserve the five-key envelope and byte frame. None is yet in the frozen byte utility; additions require adoption and a focused domain regression.
2. Comparison provider mode is the existing evaluation enum `openai | offline`; reject `auto` for a bound comparison. Mocked versus real evidence uses the existing evidence-record discriminant; real evidence alone does not authorize connected use. This does not change ordinary provider defaults or authorize a provider call. Offline cannot silently remove required embedding cases from a bound case set.
3. Bind one explicitly selected existing programme mode `legacy | shadow | canary` identically on both sides. Shadow storage does not imply a retrieval rollout mode, activation, or enabling the superseded retrieval kernel.
4. Require the existing pure snapshot helper's exact valid millisecond-UTC clock, `YYYY-MM-DDTHH:mm:ss.sssZ`. This is a selected comparison instant only. Original source/control/database timestamp bytes retain their full precision.
5. Retain complete effective configuration and final ordered cases under full SHA-256 envelopes. Existing short cache fingerprints and optional summary fingerprints are not completeness proof. Their ordinary implementation stays unchanged.

These are controller recommendations within the existing local preparation scope. Independent correction review and explicit controller adoption remain required before implementation of the profile consumer. No external authority is inferred from a syntactically valid profile.

## Exact root payload

Every object is strict with exactly its declared keys. Every field below is required; explicit null is allowed only where shown. `Uuid` is canonical lowercase database UUID syntax; `Digest` is `sha256:` plus exactly 64 lowercase hex digits; `UInt` is a nonnegative safe integer; `PositiveInt` is a positive safe integer. Strings retain original contents; validation must reject rather than trim/coerce. `Version` is nonblank, already-trimmed text up to 100 characters, matching the existing P04 version constraint without mutating input.

```ts
type ExecutionProfileV1 = {
  kind: "u04-execution-profile-v1";
  evidenceMode: "mocked" | "real";
  target: { projectRef: string };
  access:
    | { mode: "owner"; ownerId: Uuid; includePublic: boolean }
    | { mode: "public"; ownerId: null; includePublic: true };
  documentIds: Uuid[];
  manualAliasIds: Uuid[];
  sourcePolicyVersion: Version;
  documentOwnedPolicies: DocumentOwnedPolicy[];
  rolloutMode: "legacy" | "shadow" | "canary";
  rolloutVersion: Version;
  providerMode: "openai" | "offline";
  comparisonClock: string;
  configuration: ConfigurationEnvelope;
  cases: CaseSetEnvelope;
  implementation: ImplementationBinding;
  providerPolicy: ProviderPolicy;
  sql: SqlExecutionBinding;
  limits: OperationLimits;
};

type DocumentOwnedPolicy = {
  documentId: Uuid;
  ownerId: Uuid | null;
  contentHash: Digest;
  sourcePolicyVersion: Version;
  policyArtifact: { digest: Digest; retainedEnvelopeDigest: Digest };
  reviewArtifact: { digest: Digest; retainedEnvelopeDigest: Digest };
};

type OperationLimits = {
  serverRequestDeadlineMs: 15000;
  lockTimeoutMs: PositiveInt; // <= 2000
  clientTotalDeadlineMs: 20000;
  maxMembers: PositiveInt; // <= 8
  maxCapturedRows: PositiveInt; // <= 250000
  maxOriginBundleBytes: PositiveInt; // <= 268435456
  maxAppendRows: PositiveInt; // <= 2000
  maxAppendBytes: PositiveInt; // <= 16777216
};

type ImplementationBinding = {
  revision: string; // exact 40 lowercase hex commit identity
  files: { path: string; digest: Digest }[];
};

type ProviderPolicy = {
  requestTimeoutMs: PositiveInt;
  answerTimeoutMs: PositiveInt;
  embeddingMaxRetries: UInt;
  generationMaxRetries: UInt;
  promptCacheRetention: "off" | "in_memory" | "24h";
  promptCacheTtl: "off" | "30m" | null;
  storeResponses: boolean;
  routeBudgetMs: { unsupported: 0; extractive: 12000; fast: 25000; strong: 35000 };
  generationRecoveryReserveMs: 2000;
  minimumGenerationRetryMs: 20000;
};
```

`ConfigurationEnvelope` and `CaseSetEnvelope` must resolve to the complete finite records in companion `U04-profile-config-and-case-schema-candidate-3.md`, subject to its independent review. They are embedded full raw envelopes, not a pathname or short digest standing in for missing records. Their payloads must exclude the profile/origin/final plan and their own envelope digests. The profile digest therefore binds their original complete bytes without a hash cycle. The companion is a design contribution, not a currently existing runtime parser. Earlier companion candidates 1/2 and the failed review1 are retained. Candidate 3 explicitly represents optional own-undefined case fields in a bound preparation ledger, retaining original runtime presence without weakening the strict JSON byte encoder.

Require profile.providerMode, the complete generation configuration providerMode and case-set providerMode to be identical. Validate all companion-derived fields against that one identity; a valid nested envelope cannot supply a conflicting provider mode or silently filter the fixed cases. The same complete configuration/cases are consumed on both sides. Document-owned policy artifacts follow their already adopted evidence schema and admission rules; the profile wrapper does not replace them.

ProviderPolicy retains the existing effective timeout/retry/cache/storage inputs from `src/lib/env.ts:110-131`, the retry distinction in `src/lib/openai.ts:147-152`, and fixed route/recovery policy from `src/lib/rag/rag-route-budget.ts:4-23`. These are independent from database request deadlines. Explicit null records absence of the existing optional prompt-cache TTL; it does not mean a new default. No secret, credential, safety-identifier key or raw environment dump belongs in the profile. Values must match independently admitted effective provider configuration; the record is not permission to alter it or to store provider responses. The complete actual adapter input closure must additionally prove that every material runtime option is either bound by these finite fields/configuration or is unchanged source-owned policy. This bounded record does not assert that a full engine closure review has already passed.

Project reference is explicit nonblank text with no surrounding whitespace, maximum 100 characters, not a URL, credential, connection string, or command. Its equality to the separately admitted target is mandatory before operational client construction. The mocked reference is still explicit and cannot be used in connected admission. This field alone supplies no connection configuration.

Document IDs are a nonempty canonical ascending unique set, bounded by maxMembers. Manual aliases are a canonical ascending unique set, including an explicit empty set. No implicit global corpus or alias population is allowed. `documentOwnedPolicies` is sorted unique by documentId and contains exactly the document-owned members; catalogue members have no entry. The retained policy/review evidence, document/owner/content equality and common effective source policy follow the adopted mapper unchanged. All actual source/owner/public predicates remain separately enforced by capture and every operational boundary. Public inclusion never follows merely from an absent owner.

Implementation files are a nonempty ascending unique list of repository-relative forward-slash paths with full byte digests. Reject absolute paths, dot segments, drive letters and protected/unrelated paths. This record is an identity manifest, never an instruction to import, enumerate or execute a path. The admitted complete evaluation dependency closure determines its exact membership; an arbitrary caller's subset cannot certify completeness. The revision alone does not represent uncommitted files: the exact effective file bytes must also match, and connected admission requires the final accepted product/evidence identity. Pending full engine closure remains pending rather than implicitly satisfied by the current bounded owner map.

## SQL execution binding: one complete reviewed environment

```ts
type SqlExecutionBinding = {
  environment: ReviewedSqlEnvironmentBundleEnvelope;
};
```

Embed the full strict bundle from `U04-sql-environment-schema-candidate-2.md`, including original nested envelope bytes. Its deadlineConfiguration is specified by U04-deadline-configuration-contract-candidate-2.md; no runtime diagnostic witness is embedded or required for profile construction. This replaces candidate1's duplicated loose versions/operation values and unresolved two-digest section references. The configuration has one authoritative environment value, not several references a caller can mix. Envelope digest checks do not stand in for semantic equality or external admission.

Require the same evidenceMode and target.projectRef throughout profile, environment capture/review and deadline configuration. The capture implementation equals the profile's complete revision/file-byte binding. Deadline policy equals OperationLimits, and the actual path/role/target must agree throughout the evidence. For every one of the 26 fixed operations, effective TimeZone and comparison clock context agree across the comparison; settings remain exactly the finite seven-name vocabulary in the companion. Effective statement_timeout is 15000 ms before top-level dispatch. The positive lock_timeout equals the at-most-2000-ms profile value before relevant blocking acquisition; the adopted function-local setting at that boundary is permitted. Validate effective text/units with the fixed admitted producer's lossless conversion, never a permissive parseFloat or default. vector_chunks hnsw.ef_search is exactly 100; other operations retain their separately evidenced value. All trigram thresholds are finite [0,1]. Configuration and text-search identity must match the actual fixed reader dependencies.

Versions/settings/definitions are explicitly observed or synthetic inputs, not tuning controls. Do not add exact-scan forcing, tie-breakers, thresholds, limits, global HNSW overrides or a title-word catalogue read. Corrector min_sim=0.45 and fact similarity=0.18 remain unchanged source-owned formulas. The relevant structural/function/text-search/collation evidence is complete for the fixed admitted implementation, while complete source-row evidence separately retains all 335 existing fields plus adopted additions. Do not expand this into every system catalog or planner setting.

Candidate-specific query plans, statistics, ANN outcomes, latency and parity belong in later per-side result evidence bound to the completed profile, never its preimage. Their absence before the candidate exists is expected. Their later acceptance remains required where the adopted SQL contract calls for it. Equal configuration is not deterministic ANN recall or semantic answer proof.

A local mocked profile embeds complete explicit synthetic evidence and actors, has evidenceMode=mocked everywhere and is permanently refused by operational admission. A real profile requires actual retained records, exact supported collector-to-server mapping, independent technical review and the existing external admission of that exact bundle/implementation. Neither a role label nor a satisfied field provides authority. No client construction or dispatch occurs while any required real evidence is unavailable.

The shape and pure validators can be implemented locally after design adoption. The actual collector, effective server observations and final engine dependency closure are subsequent named implementation/connected acceptance proof; unknown deployed values are not filled with defaults and are not reasons to invent another universal schema. Any concrete additional runtime dependency found during the fixed adapter implementation is a bounded correction before that adapter is accepted, not permission to omit it.

## Validation order and authority

1. Verify the exact profile domain/encoding and raw envelope bytes. Parse those same preserved bytes with strict finite schemas; reject unsafe numeric views and every unknown/missing field. Received node-json-v1 bytes must match the canonical encoding of the validated precision-safe payload. No independent second payload is authoritative.
2. Validate complete nested configuration/cases, mandatory full identities, ordered cases, exact member/manual populations, policy relationships, implementation membership and all ceilings. No permissive current resolver may fill missing profile fields.
3. Validate equality to independently admitted target, source/review artifacts, configuration, case population and evidence classification. This is a separate admission result; no `verified: true`, caller review boolean, signature service or embedded self-approval is introduced.
4. For operational use, validate every retained evidence record's complete schema, bytes, producer/reviewer binding and applicability. Unavailable actual settings/deadline evidence, incomplete implementation closure or mocked records refuse before clients/dispatch. The existing separately admitted connected execution/role/deadline acceptance is also required before operational client construction; configuration review and parsing cannot replace it. Later capture returns origin bound to the profile identity; enqueue validates that same full profile and origin before effects.
5. Plan, origin, side-specific session, candidate receipt and evaluation-request identities bind the already completed profile. None belongs inside its pre-capture hash preimage. If the fixed capture argument requires bare64, strip the exact `sha256:` syntax at that one checked transport boundary only; do not recompute a different preimage or change accepted historical P04 digests.

Provider/engine invocation, query subsets, side caches, source revocation checks, atomic guarded reads, sticky failure and evaluation metric completeness remain governed by the existing adopted adapter. A validated profile cannot make missing adapter capabilities available. All provider failures/fallbacks remain explicit evaluation limitations; no optimistic success or new supplementary-source acquisition follows from them.

## Focused local implementation and acceptance boundary

Review this entire candidate with the complete config/case, SQL environment and deadline companions. Candidate1 and prior failed/contribution records remain historical; none is silently rewritten. The independent whole-correction reviews decide design adoption. Actual connected facts remain unavailable and must be reported separately from a complete local format.

After adoption, the existing sole U04 implementer owns `scripts/lib/reindex-eval-session.ts` and `tests/reindex-shadow.test.ts` for the next pure increment: add the four exact domain/encoding pairs and strict validation of full configuration/case envelopes first, then enclosing profile/evidence records. Do not add a client, SQL dispatcher, provider call, executable collector or eval-script main import as part of pure parsing. Freeze coherent increments for one root-owned focused manifest and independent review. Existing 51-test byte evidence is reused until its code changes; the new focused run then includes it once with the new cases.

Pure tests must reject wrong domain/encoding, missing/extra nested fields, wrong target/access/populations/policy, auto mode, comparison clock drift, short fingerprint substitution, reordered/altered/filtered cases, changed config, unsafe numbers, raised limits, tampering, cyclic self-binding, unresolved evidence, mixed mock/real actors and unauthorized operational use. Test optional own-undefined case preparation and fresh reconstruction exactly as independently reviewed companion3. Complete explicit mocked profiles are positive parsing cases but must fail operational admission before client construction. No process environment mutation supplies fixture configuration.

Finite remaining U04 implementation owners are unchanged: the fixed reader/capture/guard implementation supplies the exact admitted source dependency mappings and effective setting conversion; the actual search/answer adapter supplies the complete configuration/case/source closure and separate caches; the existing external controller admission binds accepted file identities and real evidence. U04's full-range source/type/domain/offline acceptance remains required before local acceptance/commits. Choosing this format does not declare those implementations complete.

Connected acceptance separately supplies effective SQL configuration/role/path, deadline enforcement, supported collector mapping, transaction/concurrency/grants and measured per-side parity. No diagnostic installation, trace-service change, SQL/provider operation or extra platform is authorized by this document. Native extraction and downstream detailed source-grounded answer quality retain their existing U09/C03/RAG owners; U10 owns eligibility and U05 retention/promotion. No task is accepted by this correction.

Historical U02 offline evaluation remains exit 1, four failed suites, 45 failed and 586 passed overall, not green and not inherited.
