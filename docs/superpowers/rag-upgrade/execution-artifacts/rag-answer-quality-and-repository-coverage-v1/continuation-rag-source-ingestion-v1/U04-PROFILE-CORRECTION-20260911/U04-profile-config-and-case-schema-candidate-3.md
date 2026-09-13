# U04 config and ordered case schema candidate 3

11 September 2026. **Design recommendation only; not adopted, implemented or admitted.** This contribution belongs outside the repository. Root owns the enclosing execution profile, SQL settings/evidence representation, governing amendment and adoption. It does not amend the current U04 contract.

Source basis: `U04-execution-profile-config-owner-map-1.md`, with targeted inspection of its named declarations in `C:/Users/joshs/.codex/worktrees/rag-local-build-20260822/Database`, HEAD `e502ecd9b18f4a8f22469f68c0ffa5976a33a619`. No source/config modules were imported. These records bind supplied effective values; they do not establish that a deployed engine used them.

## 1. Strict representation rules

The schema notation below is a closed JSON record definition, not executable TypeScript and not a permissive `Record<string, unknown>`. Every listed key is required unless suffixed `?`; every unlisted key is rejected at every nested level. A `?` key may be absent or present with exactly the listed value type. Presence is retained. Explicit JSON null is rejected except where expressly listed. Thus absent `forceEmbedding` differs in bytes from present `false`, and absent `programmeExpectation` is never rewritten to null or an empty object.

`S` means an unchanged JSON string with paired Unicode surrogates; `S1` additionally has length at least one, without trimming or case folding. `N` is a finite JSON number supported without loss by the reviewed strict client encoder (including rejection of unsafe integers and negative zero); `I0` is a safe integer >= 0; `I1` is a safe integer >= 1. `B` is a JSON boolean. `T[]` preserves all entries and their order, including duplicates; no array is implicitly a set. No coercion, fallback, silent unknown-key removal, rounding, whitespace normalization, default insertion or sorting of arrays occurs at this boundary.

The full resolved retrieval fields that the existing golden-case loader defaults are required here. Any default resolution happens during explicitly admitted case preparation, before capture of this final record. The parser must not call the current permissive ranking resolver or golden-case Zod parser to repair a supplied record. Optional quality fields remain optional because the source type has no corresponding required default.

Runtime strict parsers for each shape below are still required. The existing TypeScript declarations alone do not validate external data. If external bytes are accepted, duplicate object keys must be rejected before ordinary JSON parsing can erase their occurrence; reject unsafe numeric tokens before conversion can round them. Canonical node-json-v1 bytes must equal re-encoding of the strictly parsed value, rather than accepting alternate lexical forms as the canonical payload. This semantic/canonical parser is additional to the frozen byte-only envelope validator. Never use it to parse and reserialize received pg-jsonb-text-v1 evidence.

## 2. Generation identity: complete existing record, narrowed provider vocabulary

Closed `GenerationIdentity` follows all 19 fields of `AnswerGenerationFingerprintInput`, `src/lib/rag/rag-cache.ts:121`. The string-typed effort/verbosity/provider fields receive the existing narrower runtime enums below. All fields remain required even when an associated feature is disabled or the provider is offline; neither disabled reranking nor offline mode permits omission of the configured effective identity.

| Keys | Exact external type |
| --- | --- |
| answerModel, fastModel, strongModel, classifierModel, indexingModel, embeddingModel, semanticRerankModel | S1 |
| embeddingDimensions, maxOutputTokens | I1 |
| fastReasoningEffort, strongReasoningEffort | `none | low | medium | high | xhigh` |
| answerVerbosity | `low | medium | high` |
| providerMode | `openai | offline` |
| promptVersion, schemaVersion, classifierPromptVersion, retrievalVersion, indexingPromptVersion | S1 |
| semanticRerankEnabled | B |

Effort/verbosity owners: `src/lib/env.ts:132-145`. Provider comparator owner: `EvalQualityProviderMode`, `scripts/eval-quality.ts:38`. Explicitly reject `auto`; it is a valid broader application setting, but is not an admitted comparator identity. The established `evidenceMode: mocked | real` from adopted evidence-record1 is a separate classification owned by the enclosing profile, never a provider-mode value. Real evidence does not itself authorize connected use. Mocked evidence does not establish connected provider coverage; offline does not establish vector/provider coverage.

Model strings are identifiers, not a newly invented finite model list. Requiring nonempty identity strings is a proposed external-admission strengthening over the cache input's unconstrained string type; do not transform an empty supplied string into a default. Require supplied effective resolved identifiers, including answer-model fallback and classifier/indexing fallback where applicable. Unavailable effective values block admission, not drafting. No current environment values have been observed.

Version-value owners remain `rag-versioning.ts` and `deep-memory.ts`, as mapped. The existing 20-hex cache fingerprint is supplementary only. Hash this complete record through the full raw envelope below; never substitute the short fingerprint. This record is not claimed to close every engine setting or source revision.

## 3. Full RankingConfig

Owner: `src/lib/ranking-config.ts:22-83`; effective defaults/resolver at 115/183. Closed schema:

```text
RankingConfig {
  secondStage: SecondStageWeights,
  featureFusion: FeatureFusion,
  documentDiversityPenalty: N,
  documentDiversityPenaltyCap: N,
  freshness: FreshnessConfig
}
SecondStageWeights {
  positionBase: N, positionStep: N, memorySummaryBoost: N,
  documentLookupTitleBoost: N, tableThresholdEvidenceBoost: N,
  doseAmountBoost: N, tableVisualBoost: N, visualBoost: N,
  visualIntelligenceMax: N, visualIntelligencePivot: N,
  visualIntelligenceSlope: N, outdatedPenalty: N,
  unknownCurrentnessPenalty: N, poorExtractionPenalty: N,
  lowIndexQualityPenalty: N, lowIndexQualityThreshold: N
}
FeatureFusion {
  document_lookup: RankingFeatureWeights,
  table_threshold: RankingFeatureWeights,
  medication_dose_risk: RankingFeatureWeights,
  comparison: RankingFeatureWeights,
  broad_summary: RankingFeatureWeights,
  unsupported_or_general: RankingFeatureWeights
}
RankingFeatureWeights {
  hybridRelevance: N, lexicalCoverage: N, reciprocalRankFusion: N,
  titleSectionRelevance: N, metadataRelevance: N, clinicalEvidence: N
}
FreshnessConfig {
  mode: "step" | "linear",
  publicationCliffYears: N, publicationPenalty: N,
  reviewCliffYears: N, reviewPenalty: N, linearRampYears: N
}
```

Require effective-output invariants already imposed by `resolveRankingConfig`: all feature weights, `unknownCurrentnessPenalty`, `documentDiversityPenalty` and `documentDiversityPenaltyCap` are >= 0; `linearRampYears` is >= 0.0001. Reject violations instead of clamping them. Do not impose a blanket nonnegative rule on remaining fields: publication/review penalties are negative in the existing defaults, and other second-stage fields currently accept finite numbers. Do not round any supplied weights to four decimals; the source's `round4` belongs to freshness score computation, not configuration serialization. No tuning is proposed; the actual complete effective object must match the separately approved default or explicit configuration identity.

## 4. Full ReindexGateConfig

Owner: `src/lib/reindex-eval-gate.ts:47-70`; unchanged default thresholds at 72-100. Closed schema:

```text
ReindexGateConfig {
  retrieval: {
    documentRecallAt5Floor: N,
    contentRecallAt5Floor: N,
    topKHitRateFloor: N,
    failedCaseCountCeiling: I0,
    rateRegressionTolerance: N,
    latencyRegressionMs: N
  },
  quality: {
    groundedSupportedRateFloor: N,
    unsupportedCorrectRateFloor: N,
    citationFailureRateCeiling: N,
    numericGroundingFailureRateCeiling: N,
    sourceGovernanceDangerFailureRateCeiling: N,
    expectedDangerWarningMissingCountCeiling: I0,
    staleReviewUnknownRateCeiling: N,
    reviewRequiredRateCeiling: N,
    p95LatencyMsCeiling: N,
    rateRegressionTolerance: N,
    latencyRegressionMs: N
  }
}
```

Recommend rate fields and rate tolerances in [0,1], latency fields >= 0 and the two count ceilings as I0. These semantic constraints are a proposed external-admission rule; the existing TypeScript type itself states only `number`. They do not authorize threshold changes. Supply the entire existing default or explicitly approved complete alternative unchanged to `decideReindexGate`; equality to that admitted config identity is separate from merely passing this shape. Never infer a permissive gate config from missing fields.

## 5. Complete final retrieval case and execution entry

Owner: `GoldenRetrievalCase` / `goldenCaseSchema`, `scripts/eval-retrieval.ts:21-39`. Closed shape after existing preparation:

```text
GoldenRetrievalCase {
  id: S1,
  query: S1,
  expectedQueryClass: S1,
  expectedDocumentSubstrings: S1[],
  expectedContentTerms: (S1 | S1[at least one])[],
  topK: I1,
  expectTableEvidence: B,
  forceEmbedding?: B
}
RetrievalExecutionEntry {
  testCase: GoldenRetrievalCase,
  retrievalLimit: I1,
  effectiveForceEmbedding: B
}
```

Do not narrow retrieval `expectedQueryClass` to RagQueryClass: its actual owner permits any nonempty string. Keep the distinction between a string content expectation and an alternative-group array, even when a group has one entry. Preserve empty outer expectation arrays. `retrievalLimit` must equal `Math.max(testCase.topK, 10)`, exactly the existing helper at retrieval:486. `effectiveForceEmbedding` must equal `testCase.forceEmbedding === true || globalForceEmbedding`; retain the original optional `forceEmbedding` separately. Derived fields must be recomputed and compared, not trusted or substituted for the original case.

The final array is already selected and ordered before binding. Existing offline preparation removes per-case `forceEmbedding` requests before query/limit selection (`eval-quality.ts:344,1093-1100`). The admitted executor must not repeat that filtering on a bound array. Recommend rejecting an offline payload containing any effective embedding request, including global forceEmbedding, rather than silently dropping its cases or claiming vector coverage. An upstream filtered population is permitted only when explicitly admitted and captured as the final population.

Do not add uniqueness rules by silently deduplicating case IDs, content groups or queries. The array position preserves repeated entries if the admitted source preparation produced them; downstream receipts must bind ordered positions rather than assuming an ID is a unique key. If uniqueness is later required, it needs explicit refusal rules and review.

## 6. Complete final quality case and all nested safety expectations

Owner: `RagEvalCase`, `src/lib/rag/rag-eval-cases.ts:22-75`. Exact closed shape:

```text
RagEvalCase {
  id: S, question: S,
  category: "routine" | "complex" | "unsupported",
  suite?: "core" | "typo" | "paraphrase" | "false_positive" | "prompt_injection",
  relevanceGrade?: "direct" | "partial" | "unsupported",
  expectedQueryClass?: RagQueryClass,
  falsePositiveControl?: B,
  supported: B,
  expectedFiles: S[],
  allowedRoutes: ("unsupported" | "extractive" | "fast" | "strong")[],
  minCitations: N,
  requireExpectedFileCitation?: B,
  requiredDirectClaim?: RequiredDirectClaim,
  latencyTargetMs: N,
  requireVisualEvidence?: B,
  expectsSourceDangerWarning?: B,
  acceptSourceOnly?: B,
  programmeExpectation?: RagProgrammeExpectation
}
RequiredDirectClaim {
  riskClass: "routine" | "high_risk",
  conceptAlternatives?: S[][],
  semanticContract?: "positive_prescriptive_score_independent_distress_escalation"
}
RagProgrammeExpectation {
  expectedCorpusScopes: SourceCorpusScope[],
  expectedSourceRoles: ClinicalSourceRole[],
  expectedSiteDomains: SiteContentDomain[],
  expectedPublicSiteContentState: SiteContentPartitionState | "not_applicable",
  expectedSubquestionPurposes: RagSubquestionPurpose[],
  minimumDirectSubquestions: N,
  allowedAnswerShapes: AdaptiveAnswerShape[],
  requireSupportedPart: B,
  requireExactGap: B,
  expectedConflict: ExpectedConflict | null,
  forbiddenFallbackReasons: RagInsufficiencyReason[],
  requiredFacts: S[],
  forbiddenPatterns: S[],
  incrementalEligibility: "none" | "lead" | "independent_sections"
}
ExpectedConflict {
  localDocumentId: S,
  australianDocumentId: S,
  requireVisibleFields: (
    "source_identity" | "publication_or_effective_date" | "jurisdiction" |
    "source_role" | "material_difference" | "local_primary_decision" | "review_flag"
  )[]
}
```

The nested programme owner is `src/lib/types.ts:345-375`. The source type permits both optional direct-claim subfields, either one, or neither; do not invent an exclusive union or fill empty concept groups. Empty arrays, explicit false values and optional presence remain intact. A separate admission rule may reject a semantically unusable safety case, but must not repair or discard its expectations. For quality cases the source has no strict runtime range/string validator; `S` and `N` above deliberately reflect those existing types. Recommend separately adopting nonempty IDs/questions, nonnegative safe-integer citation/subquestion counts and nonnegative latency targets if desired; these stronger semantic restrictions are not silently included in the source-equivalent shape.

Closed enum expansion, all from `src/lib/types.ts`:

- `RagQueryClass` (1011): document_lookup, table_threshold, medication_dose_risk, comparison, broad_summary, unsupported_or_general.
- `SourceCorpusScope` (140): uploaded_local, clinical_kb_site, australian_public, international_supplementary.
- `ClinicalSourceRole` (143): local_guideline, clinical_guideline, clinical_reference, service_directory, form_reference, tool_reference, safety_alert, regulatory, quality_standard, legal, subsidy, professional_review, service_policy, reference_link.
- `SiteContentDomain` (222): services, forms, medications, differentials, specifiers, dsm, formulation, therapies, dictionary, factsheets, calculators, tools.
- `SiteContentPartitionState` (236): current, updating, stale, unavailable, disabled.
- `RagSubquestionPurpose` (238): primary, comparison_side, required_action, monitoring, risk, special_population.
- `AdaptiveAnswerShape` (301): narrow, focused, comprehensive, comparison, partial.
- `RagInsufficiencyReason` (306): not_in_corpus, retrieval_miss, insufficient_claim_support, source_role_mismatch, source_conflict, governance_block, site_content_updating, site_content_stale, site_content_unavailable, timeout, provider_failure.

`allowedRoutes` closes `NonNullable<RagAnswer["routingMode"]>` at types:1293. No imported server/runtime enum object is necessary to describe these finite literals; a future pure parser must explicitly check them and have drift coverage against these owners.

The currently mapped quality runner selects `RagEvalCase`, not the additional `AnswerQualityEvalCase` workload. Do not silently accept-and-drop `expectedIntent`, `mustContainAny` or `mustNotContain`. If that separate workload is later adopted, define a separate closed variant retaining all RagEvalCase keys plus required `expectedIntent` = dose | contraindication | monitoring_schedule | red_result_action | document_lookup | pathway_referral | unsupported | general and optional `mustContainAny: S[]`, `mustNotContain: S[]` (rag-eval-cases:12-20,77-81). It would require its actual scorer to be in the admitted closure; this proposal does not add that workload.

## 7. Proposed config and case envelopes with explicit domains

Controller correction 2 preserves candidate 1 and proposes two explicit new envelope domains: ConfigPayload uses u04-engine-config-v1; CasePayload uses u04-evaluation-cases-v1. Both use node-json-v1. These additions require independent review and adoption; the current utility whitelist remains unchanged. Closed full payloads:

```text
ConfigPayload {
  kind: "u04-comparison-config-v1",
  generation: GenerationIdentity,
  ranking: RankingConfig,
  gate: ReindexGateConfig
}
CasePayload {
  kind: "u04-comparison-cases-v1",
  providerMode: "openai" | "offline",
  globalForceEmbedding: B,
  preparation: { optionalUndefined: OptionalUndefinedField[] },
  selection: {
    retrieval: { query?: S, limit?: I0 },
    quality: { question?: S, limit?: I0 }
  },
  retrieval: RetrievalExecutionEntry[],
  quality: RagEvalCase[]
}
```

Both full arrays and every nested record are retained, not replaced by names, IDs, file paths or partial fingerprints. `selection` records admitted preparation inputs without re-executing selection. Preserve absent versus present empty query/question and absent versus present zero limit; current truthiness/slice semantics are distinct from a normalizer that rejects or trims them. No captured-case read, captured-first merge, normalization, custom-question manufacture or reload may happen independently for baseline and candidate after binding. Actual prepared arrays must be reviewed against the declared selection before admission; the final arrays are the execution source of truth, not an instruction to query changing sources.

`CasePayload.providerMode` must equal `ConfigPayload.generation.providerMode`. Distinct retrieval/quality counts are their array lengths. Passage-content denominator must come from the existing retrieval scoring/population owner, not be assumed equal to retrieval length; do not fabricate a new denominator from a lossy case summary. The enclosing profile may bind separately checked expected population counts. A wrapper shape permits an empty array for accurate representation; the gate/admission population requirement still refuses an unusable comparison.

For either payload P, construct the exact existing envelope:

```text
version = 1
domain = "u04-engine-config-v1" for ConfigPayload; "u04-evaluation-cases-v1" for CasePayload
encoding = "node-json-v1"
canonicalPayload = strictCanonicalNodeJson(P)
payloadBytes = UTF8(canonicalPayload)
preimage = UTF8("U04-SHADOW/1\n" + domain + "\nnode-json-v1\n" +
                decimal(payloadBytes.length) + "\n") || payloadBytes
digest = "sha256:" + lowercaseHex(SHA256(preimage))
```

Actual canonical config bytes emit root keys in order `gate`, `generation`, `kind`, `ranking`; case bytes emit `globalForceEmbedding`, `kind`, `preparation`, `providerMode`, `quality`, `retrieval`, `selection`. Include the complete values with no omitted records, optional spaces or placeholders and recursively sort object keys by JS code units. Use the frozen utility algorithm unchanged. Do not hash an ordinary JSON.stringify of an insertion-ordered object or the old short cache fingerprint.

The raw validator must bind the exact expected dedicated domain and node-json-v1, followed by a strict parser requiring the exact expected kind and complete schema. A digest under the other wrapper domain or the ordinary plan domain is not a valid config/case record. Keep both full retained envelopes available; the enclosing profile can bind their two SHA-256 digests. Neither payload contains its own digest, the enclosing profile digest, captured origin, final plan, stage receipts, comparison outputs or evaluation-request digest. This avoids self-reference and downstream-to-upstream cycles. Evidence mode remains outside these payloads in root's enclosing profile and must be independently equal across the two sides.

## 8. Residual closure and implementation boundaries

This is complete shape coverage for the named generation/config/final-case owners, not a complete engine closure. Provider timeout/retry/budget policies, programme mode, fixed comparison clock, source/policy versions, source implementation manifest, request execution mode, concurrency, external selection provenance, SQL settings and operational evidence remain root-owned enclosing-profile concerns. Do not label the config wrapper digest alone an engine digest.

No live resolved config, final admitted case population, provider capability, captured-case source, SQL version/settings or deployed identity was observed. The owner types/defaults and permissive preparers do not establish such evidence. Strict runtime parsers, duplicate-key/lossless input handling, exact-wrapper cross-checks, unchanged adapter/scorer consumption, population verification and independent adversarial tests remain unimplemented. Future source movement must preserve all existing scoring and safety behavior and avoid operational eval-script imports.

No repository writes, tests, gates, providers, SQL, environment/config imports or recursive agents were used for this contribution. The previously frozen utility and product files remain outside this task's write scope.


## 9. Correction 3: explicit preparation of optional own-undefined fields

This section takes precedence over earlier general preparation wording and closes review1 P2 without editing the ordinary captured-case mapper or relaxing the byte encoder. The existing mapCapturedEvalCase creates own expectedQueryClass and expectsSourceDangerWarning properties with undefined for ordinary captured inputs. That JavaScript representation is not strict JSON. Candidate 2 is retained unchanged as failed review evidence.

During one-time case preparation, before profile/case hashing, inspect own data descriptors of each actual selected case. Reject proxies, accessors, required or unknown undefined fields and all other unsupported values. Only an explicitly declared optional case field whose own value is undefined may be omitted from the JSON case copy. Record each omission in the mandatory preparation.optionalUndefined array below. A genuine absence produces no entry; explicit false, zero, empty string/array and every valid present value remain untouched. Do not add this transformation to the general byte utility or perform it separately for the two comparison sides.

```text
OptionalUndefinedField =
  { scope: "retrieval", index: I0, field: "forceEmbedding" }
  | { scope: "quality", index: I0, field:
      "suite" | "relevanceGrade" | "expectedQueryClass" |
      "falsePositiveControl" | "requireExpectedFileCitation" |
      "requiredDirectClaim" | "requiredDirectClaim.conceptAlternatives" |
      "requiredDirectClaim.semanticContract" | "requireVisualEvidence" |
      "expectsSourceDangerWarning" | "acceptSourceOnly" | "programmeExpectation"
    }
```

This ledger is exactly the complete omission set, sorted by scope using JS code-unit order, then numeric index, then field using JS code-unit order, with no duplicate identity. Index addresses the final ordered retrieval or quality array, never a case ID assumed unique. Fields are the closed literals above, not generic property paths. For retrieval it addresses testCase.forceEmbedding; for quality it addresses the named case field. A nested direct-claim omission requires a present valid requiredDirectClaim object, whose own omitted optional field is absent from the JSON copy. A parent-omission entry and a nested child entry cannot coexist. Every ledger entry must address an existing case and a declared optional field that is absent in the retained JSON case. A present value or unrelated field cannot be suppressed by an entry. Empty ledger is explicit. Optional selection inputs are supplied as strict JSON already; this narrowly defined case mapper is not a generic undefined scrubber for config, selection, SQL or other records.

The complete case envelope binds both final JSON cases and the omission ledger, preserving the difference between absent and own-undefined inputs. When constructing the session-owned typed cases, restore only these validated optional own-undefined properties on a fresh data-only copy; never mutate retained JSON, caller objects or ordinary case fixtures. Use fixed field switches, not an arbitrary pointer writer or prototype lookup. This restores the original runtime optional-property presence while all evidence/hashes continue to use the immutable strict JSON envelope. No provider, source reload, coercion or scoring change occurs. Effective forceEmbedding is recomputed under the existing true-only rule and still must match the retained derived boolean.

The producer's complete prepared record and exact source selection remain subject to existing independent admission; the ledger is not a caller's authority claim about source provenance. A parser can validate ledger structure and internal consistency, but actual preparation evidence/review must establish that omissions describe the selected source records. This is the same distinction as case population versus its declared selection.

Future focused tests must exercise actual mapCapturedEvalCase with absent optional values, then prepare, canonicalize, parse and reconstruct the complete case. Assert both original own-undefined properties are recorded and restored; genuine absent properties stay absent; explicit false/empty values stay present and unchanged. Reject missing/extra/duplicate/out-of-range ledger entries, unknown/required field targets, parent-child conflicts, attempts to suppress present values, required undefined, and accessors/proxies. Preserve all unchanged config/case schema and source safety checks from review1. No such tests have run; this is a reviewed-contract correction candidate only.
