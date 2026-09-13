import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { TextDecoder, types } from "node:util";
import type { RagEvalCase } from "../../src/lib/rag/rag-eval-cases";
import {
  auditDocument, buildIngestionAuditReport, parseIngestionAuditInput, parseIngestionAuditInventory, reviewedProvenanceEvidenceDigest,
  type IngestionAuditInput, type IngestionAuditInventory,
} from "../../src/lib/ingestion-audit";
import { parseExpectedSourceCoverageRegistry } from "../../src/lib/source-coverage-registry";
import { parseRecoveryReadinessEvidence, assertRecoveryReadinessForOperation } from "../../src/lib/recovery-readiness-evidence";
import { hashIndexQualityText } from "../../src/lib/index-quality";
import { australianSourceByKey, australianSourcePolicyVersion, isIndexableAustralianSource } from "../../src/lib/australian-source-catalogue";
import { sourceGovernanceWarnings } from "../../src/lib/source-governance";
import { normalizeOptionalSourceMetadata, normalizeSourceMetadata } from "../../src/lib/source-metadata";
import { normalizeImageBbox } from "../../src/lib/image-filtering";
import { expectedFileCoverage } from "../../src/lib/eval-document-matching";
import { answerRouteBudgetMs } from "../../src/lib/rag/rag-route-budget";
import { metadataText, safeRecord } from "../../src/lib/rag/rag-answer-text";
import { compactContextText } from "../../src/lib/rag/rag-source-block";
import {
  normalizeSourceAnchoredSummary, requireExactSourceAnchoredGeneration,
  persistedSourceAnchoredSummaryProjectionMatches, projectSourceAnchoredLabels,
} from "../../supabase/functions/_shared/source-anchored-summary";
import { matchesShadowCoreStoredRowV1, matchesShadowPrivateObjectAttachmentV1,
  type ShadowCoreFamilyV1 } from "./reindex-core-row-reconciliation";

const domains = [
  "plan",
  "inventory",
  "projection",
  "baseline",
  "control",
  "member_receipt",
  "wave_receipt",
  "evaluation_report",
  "u04-evidence-expectations-v1",
  "u04-reviewed-measurements-v1",
  "u04-reviewed-evidence-approval-v1",
  "u04-retained-evidence-v1",
  "u04-evaluation-request-v1",
  "u04-execution-profile-v1",
  "u04-engine-config-v1",
  "u04-evaluation-cases-v1",
  "u04-sql-execution-evidence-v1",
] as const;
const nodeOnlyDomains: readonly ShadowEnvelopeDomain[] = [
  "u04-execution-profile-v1",
  "u04-engine-config-v1",
  "u04-evaluation-cases-v1",
  "u04-sql-execution-evidence-v1",
];
const encodings = ["node-json-v1", "pg-jsonb-text-v1"] as const;

export type ShadowEnvelopeDomain = (typeof domains)[number];
export type ShadowEnvelopeEncoding = (typeof encodings)[number];

export type ShadowRawEnvelope = Readonly<{
  version: 1;
  domain: ShadowEnvelopeDomain;
  encoding: ShadowEnvelopeEncoding;
  canonicalPayload: string;
  digest: string;
}>;

/** Byte identity only. No parsed row view, source provenance, completeness or operation authority. */
export type ShadowEnvelopeByteValidation = Readonly<{
  kind: "shadow-envelope-bytes-only";
  envelope: ShadowRawEnvelope;
  payloadUtf8Bytes: number;
}>;

function invalidCanonicalJson(): never {
  throw new Error("Invalid canonical JSON value.");
}

function invalidEnvelopeBytes(): never {
  throw new Error("Invalid shadow envelope bytes.");
}

function hasPairedSurrogates(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function dataProperties(value: object, fail: () => never): Record<string, PropertyDescriptor> {
  // Reflective operations on a Proxy can execute user traps just like getters.
  if (types.isProxy(value)) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !hasPairedSurrogates(key)) fail();
    const descriptor = descriptors[key]!;
    if (!("value" in descriptor)) fail();
  }
  return descriptors;
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Encode strict JSON with object keys in JS code-unit order and meaningful arrays unchanged. */
export function encodeShadowNodeJsonCanonicalPayload(value: unknown): string {
  const ancestors = new Set<object>();
  function encode(current: unknown): string {
    if (current === null) return "null";
    if (typeof current === "string") {
      if (!hasPairedSurrogates(current)) invalidCanonicalJson();
      return JSON.stringify(current);
    }
    if (typeof current === "boolean") return current ? "true" : "false";
    if (typeof current === "number") {
      if (
        !Number.isFinite(current) ||
        (Number.isInteger(current) && !Number.isSafeInteger(current)) ||
        Object.is(current, -0)
      ) {
        invalidCanonicalJson();
      }
      return JSON.stringify(current);
    }
    if (typeof current !== "object" || types.isProxy(current)) invalidCanonicalJson();
    if (ancestors.has(current)) invalidCanonicalJson();
    const descriptors = dataProperties(current, invalidCanonicalJson);
    ancestors.add(current);
    try {
      if (Array.isArray(current)) {
        if (Object.getPrototypeOf(current) !== Array.prototype) invalidCanonicalJson();
        const length = descriptors.length!.value as number;
        const keys = Object.keys(descriptors);
        // Reject holes and properties JSON.stringify would silently discard.
        if (keys.length !== length + 1) invalidCanonicalJson();
        const entries: string[] = [];
        for (let index = 0; index < length; index += 1) {
          const descriptor = descriptors[String(index)];
          if (!descriptor || !descriptor.enumerable) invalidCanonicalJson();
          entries.push(encode(descriptor.value));
        }
        return `[${entries.join(",")}]`;
      }
      if (!isPlainObject(current)) invalidCanonicalJson();
      const entries = Object.keys(descriptors)
        .sort()
        .map((key) => {
          const descriptor = descriptors[key]!;
          if (!descriptor.enumerable) invalidCanonicalJson();
          return `${JSON.stringify(key)}:${encode(descriptor.value)}`;
        });
      // Rebuilding a sorted object would let JSON.stringify reorder integer keys.
      return `{${entries.join(",")}}`;
    } finally {
      ancestors.delete(current);
    }
  }
  return encode(value);
}

function assertDomain(domain: unknown): asserts domain is ShadowEnvelopeDomain {
  if (typeof domain !== "string" || !domains.some((allowed) => allowed === domain)) {
    invalidEnvelopeBytes();
  }
}

function assertEncoding(encoding: unknown): asserts encoding is ShadowEnvelopeEncoding {
  if (typeof encoding !== "string" || !encodings.some((allowed) => allowed === encoding)) {
    invalidEnvelopeBytes();
  }
}

function payloadDigest(domain: ShadowEnvelopeDomain, encoding: ShadowEnvelopeEncoding, payload: string) {
  const payloadUtf8Bytes = Buffer.byteLength(payload, "utf8");
  const header = `U04-SHADOW/1\n${domain}\n${encoding}\n${payloadUtf8Bytes}\n`;
  const digest = `sha256:${createHash("sha256").update(header, "utf8").update(payload, "utf8").digest("hex")}`;
  return { digest, payloadUtf8Bytes };
}

function byteResult(envelope: ShadowRawEnvelope, payloadUtf8Bytes: number): ShadowEnvelopeByteValidation {
  return Object.freeze({
    kind: "shadow-envelope-bytes-only",
    envelope: Object.freeze(envelope),
    payloadUtf8Bytes,
  });
}

/** Create client-encoded bytes, without claiming domain semantics or source authority. */
export function createShadowNodeJsonByteEnvelope(
  value: unknown,
  domain: ShadowEnvelopeDomain,
): ShadowEnvelopeByteValidation {
  assertDomain(domain);
  const canonicalPayload = encodeShadowNodeJsonCanonicalPayload(value);
  const { digest, payloadUtf8Bytes } = payloadDigest(domain, "node-json-v1", canonicalPayload);
  return byteResult(
    { version: 1, domain, encoding: "node-json-v1", canonicalPayload, digest },
    payloadUtf8Bytes,
  );
}

/** Validate the original string bytes only. In particular, never parse/reserialize pg-jsonb-text-v1. */
export function validateShadowEnvelopeBytes(
  input: unknown,
  expectedDomain: ShadowEnvelopeDomain,
  expectedEncoding: ShadowEnvelopeEncoding,
): ShadowEnvelopeByteValidation {
  assertDomain(expectedDomain);
  assertEncoding(expectedEncoding);
  if (nodeOnlyDomains.includes(expectedDomain) && expectedEncoding !== "node-json-v1") invalidEnvelopeBytes();
  if (input === null || typeof input !== "object" || types.isProxy(input)) invalidEnvelopeBytes();
  if (!isPlainObject(input)) invalidEnvelopeBytes();
  const properties = dataProperties(input, invalidEnvelopeBytes);
  const expectedKeys = ["canonicalPayload", "digest", "domain", "encoding", "version"];
  const keys = Object.keys(properties).sort();
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    invalidEnvelopeBytes();
  }
  if (keys.some((key) => !properties[key]!.enumerable)) invalidEnvelopeBytes();
  const version: unknown = properties.version!.value;
  const domain: unknown = properties.domain!.value;
  const encoding: unknown = properties.encoding!.value;
  const canonicalPayload: unknown = properties.canonicalPayload!.value;
  const digest: unknown = properties.digest!.value;
  if (
    version !== 1 ||
    domain !== expectedDomain ||
    encoding !== expectedEncoding ||
    typeof canonicalPayload !== "string" ||
    !hasPairedSurrogates(canonicalPayload) ||
    typeof digest !== "string" ||
    digest.length !== 71 ||
    !/^sha256:[0-9a-f]{64}$/.test(digest)
  ) {
    invalidEnvelopeBytes();
  }
  const computed = payloadDigest(expectedDomain, expectedEncoding, canonicalPayload);
  if (digest !== computed.digest) invalidEnvelopeBytes();
  // Copy immutable scalars rather than freezing or retaining the caller's object.
  return byteResult(
    { version: 1, domain: expectedDomain, encoding: expectedEncoding, canonicalPayload, digest },
    computed.payloadUtf8Bytes,
  );
}

type Schema<T> = (value: unknown) => T;
type Shape = { [key: string]: Schema<unknown> };
type ShapeValue<S extends Shape> = { [K in keyof S]: ReturnType<S[K]> };
type ImmutableJson = null | boolean | number | string | readonly ImmutableJson[] | { readonly [key: string]: ImmutableJson };
type ImmutableFields<T> = T extends object ? { readonly [K in keyof T]: Immutable<T[K]> } : T;
// Keep recursive JSON as one named readonly type across nested validated receipts.
// Re-expanding its index signatures at every freeze exhausts TypeScript's depth limit.
type Immutable<T> = 0 extends (1 & T) ? T : [AuditJson] extends [T]
  ? [T] extends [ImmutableJson] ? ImmutableJson : ImmutableFields<T>
  : ImmutableFields<T>;

function invalidComparison(): never {
  throw new Error("Invalid shadow comparison record.");
}

function record<R extends Shape, O extends Shape = Record<never, never>>(
  required: R,
  optional?: O,
): Schema<ShapeValue<R> & Partial<ShapeValue<O>>> {
  return (value) => {
    if (value === null || typeof value !== "object" || types.isProxy(value) || !isPlainObject(value)) {
      invalidComparison();
    }
    const descriptors = dataProperties(value, invalidComparison);
    const output: { [key: string]: unknown } = {};
    for (const key of Object.keys(required)) {
      if (!Object.hasOwn(descriptors, key)) invalidComparison();
    }
    for (const key of Object.keys(descriptors)) {
      if (!descriptors[key]!.enumerable) invalidComparison();
      const schema = Object.hasOwn(required, key)
        ? required[key]
        : optional && Object.hasOwn(optional, key)
          ? optional[key]
          : undefined;
      if (!schema) invalidComparison();
      Object.defineProperty(output, key, {
        value: schema(descriptors[key]!.value),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return output as ShapeValue<R> & Partial<ShapeValue<O>>;
  };
}

function list<T>(item: Schema<T>, minimum = 0): Schema<T[]> {
  return (value) => {
    if (value === null || typeof value !== "object" || types.isProxy(value) || !Array.isArray(value)) {
      invalidComparison();
    }
    if (Object.getPrototypeOf(value) !== Array.prototype || value.length < minimum) invalidComparison();
    const descriptors = dataProperties(value, invalidComparison);
    if (Object.keys(descriptors).length !== value.length + 1) invalidComparison();
    const result: T[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !descriptor.enumerable) invalidComparison();
      result.push(item(descriptor.value));
    }
    return result;
  };
}

function choice<const T extends readonly string[]>(...allowed: T): Schema<T[number]> {
  return (value) => {
    if (typeof value !== "string" || !allowed.includes(value)) invalidComparison();
    return value as T[number];
  };
}

const stringValue: Schema<string> = (value) => {
  if (typeof value !== "string" || !hasPairedSurrogates(value)) invalidComparison();
  return value;
};
const nonemptyString: Schema<string> = (value) => {
  const result = stringValue(value);
  if (result.length === 0) invalidComparison();
  return result;
};
const booleanValue: Schema<boolean> = (value) => {
  if (typeof value !== "boolean") invalidComparison();
  return value;
};
const numberValue: Schema<number> = (value) => {
  if (
    typeof value !== "number" || !Number.isFinite(value) || Object.is(value, -0) ||
    (Number.isInteger(value) && !Number.isSafeInteger(value))
  ) {
    invalidComparison();
  }
  return value;
};
function boundedNumber(minimum: number, maximum = Infinity, integer = false): Schema<number> {
  return (value) => {
    const result = numberValue(value);
    if (result < minimum || result > maximum || (integer && !Number.isSafeInteger(result))) invalidComparison();
    return result;
  };
}
const nonnegative = boundedNumber(0);
const nonnegativeInteger = boundedNumber(0, Infinity, true);
const positiveInteger = boundedNumber(1, Infinity, true);
const rate = boundedNumber(0, 1);
const providerMode = choice("openai", "offline");
export type ShadowComparisonProviderMode = ReturnType<typeof providerMode>;
const queryClass = choice(
  "document_lookup", "table_threshold", "medication_dose_risk", "comparison", "broad_summary", "unsupported_or_general",
);
const generationSchema = record({
  answerModel: nonemptyString, fastModel: nonemptyString, strongModel: nonemptyString,
  classifierModel: nonemptyString, indexingModel: nonemptyString, embeddingModel: nonemptyString,
  embeddingDimensions: positiveInteger,
  fastReasoningEffort: choice("none", "low", "medium", "high", "xhigh"),
  strongReasoningEffort: choice("none", "low", "medium", "high", "xhigh"),
  answerVerbosity: choice("low", "medium", "high"), maxOutputTokens: positiveInteger, providerMode,
  promptVersion: nonemptyString, schemaVersion: nonemptyString, classifierPromptVersion: nonemptyString,
  retrievalVersion: nonemptyString, indexingPromptVersion: nonemptyString,
  semanticRerankEnabled: booleanValue, semanticRerankModel: nonemptyString,
});
const featureWeights = record({
  hybridRelevance: nonnegative, lexicalCoverage: nonnegative, reciprocalRankFusion: nonnegative,
  titleSectionRelevance: nonnegative, metadataRelevance: nonnegative, clinicalEvidence: nonnegative,
});
const rankingSchema = record({
  secondStage: record({
    positionBase: numberValue, positionStep: numberValue, memorySummaryBoost: numberValue,
    documentLookupTitleBoost: numberValue, tableThresholdEvidenceBoost: numberValue,
    doseAmountBoost: numberValue, tableVisualBoost: numberValue, visualBoost: numberValue,
    visualIntelligenceMax: numberValue, visualIntelligencePivot: numberValue, visualIntelligenceSlope: numberValue,
    outdatedPenalty: numberValue, unknownCurrentnessPenalty: nonnegative, poorExtractionPenalty: numberValue,
    lowIndexQualityPenalty: numberValue, lowIndexQualityThreshold: numberValue,
  }),
  featureFusion: record({
    document_lookup: featureWeights, table_threshold: featureWeights, medication_dose_risk: featureWeights,
    comparison: featureWeights, broad_summary: featureWeights, unsupported_or_general: featureWeights,
  }),
  documentDiversityPenalty: nonnegative, documentDiversityPenaltyCap: nonnegative,
  freshness: record({
    mode: choice("step", "linear"), publicationCliffYears: numberValue, publicationPenalty: numberValue,
    reviewCliffYears: numberValue, reviewPenalty: numberValue, linearRampYears: boundedNumber(0.0001),
  }),
});
const gateSchema = record({
  retrieval: record({
    documentRecallAt5Floor: rate, contentRecallAt5Floor: rate, topKHitRateFloor: rate,
    failedCaseCountCeiling: nonnegativeInteger, rateRegressionTolerance: rate, latencyRegressionMs: nonnegative,
  }),
  quality: record({
    groundedSupportedRateFloor: rate, unsupportedCorrectRateFloor: rate, citationFailureRateCeiling: rate,
    numericGroundingFailureRateCeiling: rate, sourceGovernanceDangerFailureRateCeiling: rate,
    expectedDangerWarningMissingCountCeiling: nonnegativeInteger, staleReviewUnknownRateCeiling: rate,
    reviewRequiredRateCeiling: rate, p95LatencyMsCeiling: nonnegative,
    rateRegressionTolerance: rate, latencyRegressionMs: nonnegative,
  }),
});
const configSchema = record({
  kind: choice("u04-comparison-config-v1"), generation: generationSchema, ranking: rankingSchema, gate: gateSchema,
  retrieval: record({ textWeakOrRelaxation: booleanValue }),
});
const directClaimSchema = record({ riskClass: choice("routine", "high_risk") }, {
  conceptAlternatives: list(list(stringValue)),
  semanticContract: choice("positive_prescriptive_score_independent_distress_escalation"),
});
const conflictSchema = record({
  localDocumentId: stringValue, australianDocumentId: stringValue,
  requireVisibleFields: list(choice(
    "source_identity", "publication_or_effective_date", "jurisdiction", "source_role",
    "material_difference", "local_primary_decision", "review_flag",
  )),
});
const programmeSchema = record({
  expectedCorpusScopes: list(choice("uploaded_local", "clinical_kb_site", "australian_public", "international_supplementary")),
  expectedSourceRoles: list(choice(
    "local_guideline", "clinical_guideline", "clinical_reference", "service_directory", "form_reference",
    "tool_reference", "safety_alert", "regulatory", "quality_standard", "legal", "subsidy", "professional_review",
    "service_policy", "reference_link",
  )),
  expectedSiteDomains: list(choice(
    "services", "forms", "medications", "differentials", "specifiers", "dsm", "formulation", "therapies",
    "dictionary", "factsheets", "calculators", "tools",
  )),
  expectedPublicSiteContentState: choice("current", "updating", "stale", "unavailable", "disabled", "not_applicable"),
  expectedSubquestionPurposes: list(choice("primary", "comparison_side", "required_action", "monitoring", "risk", "special_population")),
  minimumDirectSubquestions: numberValue,
  allowedAnswerShapes: list(choice("narrow", "focused", "comprehensive", "comparison", "partial")),
  requireSupportedPart: booleanValue, requireExactGap: booleanValue,
  expectedConflict: (value: unknown) => value === null ? null : conflictSchema(value),
  forbiddenFallbackReasons: list(choice(
    "not_in_corpus", "retrieval_miss", "insufficient_claim_support", "source_role_mismatch", "source_conflict",
    "governance_block", "site_content_updating", "site_content_stale", "site_content_unavailable", "timeout", "provider_failure",
  )),
  requiredFacts: list(stringValue), forbiddenPatterns: list(stringValue),
  incrementalEligibility: choice("none", "lead", "independent_sections"),
});
const qualityOptional = {
  suite: choice("core", "typo", "paraphrase", "false_positive", "prompt_injection"),
  relevanceGrade: choice("direct", "partial", "unsupported"), expectedQueryClass: queryClass,
  falsePositiveControl: booleanValue, requireExpectedFileCitation: booleanValue,
  requiredDirectClaim: directClaimSchema, requireVisualEvidence: booleanValue,
  expectsSourceDangerWarning: booleanValue, acceptSourceOnly: booleanValue, programmeExpectation: programmeSchema,
};
const qualityCaseSchema = record({
  id: stringValue, question: stringValue, category: choice("routine", "complex", "unsupported"),
  supported: booleanValue, expectedFiles: list(stringValue),
  allowedRoutes: list(choice("unsupported", "extractive", "fast", "strong")),
  minCitations: numberValue, latencyTargetMs: numberValue,
}, qualityOptional);
const retrievalCaseSchema = record({
  id: nonemptyString, query: nonemptyString, expectedQueryClass: nonemptyString,
  expectedDocumentSubstrings: list(nonemptyString),
  expectedContentTerms: list((value: unknown) => typeof value === "string" ? nonemptyString(value) : list(nonemptyString, 1)(value)),
  topK: positiveInteger, expectTableEvidence: booleanValue,
}, { forceEmbedding: booleanValue });
const qualityOmissionField = choice(
  "suite", "relevanceGrade", "expectedQueryClass", "falsePositiveControl", "requireExpectedFileCitation",
  "requiredDirectClaim", "requiredDirectClaim.conceptAlternatives", "requiredDirectClaim.semanticContract",
  "requireVisualEvidence", "expectsSourceDangerWarning", "acceptSourceOnly", "programmeExpectation",
);
const qualityOmission = record({ scope: choice("quality"), index: nonnegativeInteger, field: qualityOmissionField });
const retrievalOmission = record({ scope: choice("retrieval"), index: nonnegativeInteger, field: choice("forceEmbedding") });
type Omission = ReturnType<typeof qualityOmission> | ReturnType<typeof retrievalOmission>;
const omissionSchema: Schema<Omission> = (value) => {
  // Inspect via a descriptor, never a caller accessor or prototype lookup.
  if (value === null || typeof value !== "object") invalidComparison();
  const descriptors = dataProperties(value, invalidComparison);
  return descriptors.scope?.value === "quality" ? qualityOmission(value) : retrievalOmission(value);
};
const selectionSchema = record({
  retrieval: record({}, { query: stringValue, limit: nonnegativeInteger }),
  quality: record({}, { question: stringValue, limit: nonnegativeInteger }),
});
const casesSchema = record({
  kind: choice("u04-comparison-cases-v1"), providerMode, globalForceEmbedding: booleanValue,
  preparation: record({ optionalUndefined: list(omissionSchema) }), selection: selectionSchema,
  retrieval: list(record({ testCase: retrievalCaseSchema, retrievalLimit: positiveInteger, effectiveForceEmbedding: booleanValue })),
  quality: list(qualityCaseSchema),
});
type Cases = ReturnType<typeof casesSchema>;
export type ShadowComparisonConfigPayload = Immutable<ReturnType<typeof configSchema>>;
export type ShadowComparisonCasePayload = Immutable<Cases>;
type ParsedComparison<T> = Readonly<{ kind: "shadow-comparison-schema-only"; bytes: ShadowEnvelopeByteValidation; payload: T }>;

function freezeTree<T>(value: T): Immutable<T> {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value as Immutable<T>;
}

/** Decode only strict client JSON. Duplicate keys are checked before constructing objects. */
function decodeStrictJson(text: string, canonical: boolean, integerTokensOnly = false, exactDecimalTokens = false): unknown {
  let offset = 0;
  function whitespace() {
    while (offset < text.length && /[\x20\x09\x0a\x0d]/.test(text[offset]!)) offset += 1;
  }
  function stringToken(): string {
    const start = offset++;
    while (offset < text.length) {
      const char = text[offset++];
      if (char === "\\") {
        offset += 1;
        continue;
      }
      if (char === '"') {
        const value: unknown = JSON.parse(text.slice(start, offset));
        return stringValue(value);
      }
    }
    return invalidComparison();
  }
  function numberToken(): number {
    const token = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(offset))?.[0];
    if (!token) invalidComparison();
    // Validate exact integral decimal magnitude before converting a possibly unsafe token.
    const parts = /^-?(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(token)!;
    const exponent = parts[3] ? Number(parts[3]) : 0;
    if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 400) invalidComparison();
    let digits = (parts[1]! + (parts[2] ?? "")).replace(/^0+/, "");
    let shift = exponent - (parts[2]?.length ?? 0);
    while (digits.endsWith("0")) {
      digits = digits.slice(0, -1);
      shift += 1;
    }
    // Native facts contain only integer numeric fields. Check the exact decimal,
    // not a rounded Number (for example 1.00000000000000001 must not become 1).
    if (integerTokensOnly && digits && shift < 0) invalidComparison();
    if (digits && shift >= 0) {
      if (digits.length + shift > 16 || BigInt(digits + "0".repeat(shift)) > 9007199254740991n) invalidComparison();
    }
    const numeric = numberValue(Number(token));
    if (exactDecimalTokens) {
      const decimalIdentity = (input: string) => {
        const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(input)!;
        let significant = (match[2]! + (match[3] ?? "")).replace(/^0+/, "");
        let exponent = Number(match[4] ?? 0) - (match[3]?.length ?? 0);
        while (significant.endsWith("0")) { significant = significant.slice(0, -1); exponent += 1; }
        return significant ? `${match[1]}${significant}e${exponent}` : "0";
      };
      if (decimalIdentity(token) !== decimalIdentity(String(numeric))) invalidComparison();
    }
    offset += token.length;
    return numeric;
  }
  function value(): unknown {
    whitespace();
    if (text[offset] === '"') return stringToken();
    if (text[offset] === "{") {
      offset += 1;
      whitespace();
      const result: { [key: string]: unknown } = {};
      const keys = new Set<string>();
      if (text[offset] === "}") {
        offset += 1;
        return result;
      }
      while (offset < text.length) {
        if (text[offset] !== '"') invalidComparison();
        const key = stringToken();
        if (keys.has(key)) invalidComparison();
        keys.add(key);
        whitespace();
        if (text[offset++] !== ":") invalidComparison();
        Object.defineProperty(result, key, { value: value(), enumerable: true, writable: true, configurable: true });
        whitespace();
        if (text[offset] === "}") {
          offset += 1;
          return result;
        }
        if (text[offset++] !== ",") invalidComparison();
        whitespace();
      }
      invalidComparison();
    }
    if (text[offset] === "[") {
      offset += 1;
      whitespace();
      const result: unknown[] = [];
      if (text[offset] === "]") {
        offset += 1;
        return result;
      }
      while (offset < text.length) {
        result.push(value());
        whitespace();
        if (text[offset] === "]") {
          offset += 1;
          return result;
        }
        if (text[offset++] !== ",") invalidComparison();
      }
      invalidComparison();
    }
    for (const [token, literal] of [["true", true], ["false", false], ["null", null]] as const) {
      if (text.startsWith(token, offset)) {
        offset += token.length;
        return literal;
      }
    }
    return numberToken();
  }
  try {
    const result = value();
    whitespace();
    if (offset !== text.length || (canonical && encodeShadowNodeJsonCanonicalPayload(result) !== text)) invalidComparison();
    return result;
  } catch {
    return invalidComparison();
  }
}

function omissionOrder(left: Omission, right: Omission): number {
  if (left.scope !== right.scope) return left.scope < right.scope ? -1 : 1;
  if (left.index !== right.index) return left.index - right.index;
  return left.field === right.field ? 0 : left.field < right.field ? -1 : 1;
}

function omissionTarget(cases: Cases, omission: Omission): { record: object; key: string } {
  if (omission.scope === "retrieval") {
    const entry = cases.retrieval[omission.index];
    if (!entry) invalidComparison();
    return { record: entry.testCase, key: "forceEmbedding" };
  }
  const testCase = cases.quality[omission.index];
  if (!testCase) invalidComparison();
  switch (omission.field) {
    case "requiredDirectClaim.conceptAlternatives":
    case "requiredDirectClaim.semanticContract": {
      if (!Object.hasOwn(testCase, "requiredDirectClaim") || !testCase.requiredDirectClaim) invalidComparison();
      return {
        record: testCase.requiredDirectClaim,
        key: omission.field === "requiredDirectClaim.conceptAlternatives" ? "conceptAlternatives" : "semanticContract",
      };
    }
    case "suite":
    case "relevanceGrade":
    case "expectedQueryClass":
    case "falsePositiveControl":
    case "requireExpectedFileCitation":
    case "requiredDirectClaim":
    case "requireVisualEvidence":
    case "expectsSourceDangerWarning":
    case "acceptSourceOnly":
    case "programmeExpectation":
      return { record: testCase, key: omission.field };
  }
}

function validateCases(value: unknown): Cases {
  const cases = casesSchema(value);
  if (cases.providerMode === "offline" && cases.globalForceEmbedding) invalidComparison();
  for (const entry of cases.retrieval) {
    const effective = entry.testCase.forceEmbedding === true || cases.globalForceEmbedding;
    if (
      entry.retrievalLimit !== Math.max(entry.testCase.topK, 10) || entry.effectiveForceEmbedding !== effective ||
      (cases.providerMode === "offline" && effective)
    ) {
      invalidComparison();
    }
  }
  let previous: Omission | undefined;
  for (const omission of cases.preparation.optionalUndefined) {
    if (previous && omissionOrder(previous, omission) >= 0) invalidComparison();
    const target = omissionTarget(cases, omission);
    if (Object.hasOwn(target.record, target.key)) invalidComparison();
    previous = omission;
  }
  return cases;
}

/** Full local shape and bytes only; no configuration provenance or operational authority. */
export function parseShadowComparisonConfigEnvelope(input: unknown): ParsedComparison<ShadowComparisonConfigPayload> {
  const bytes = validateShadowEnvelopeBytes(input, "u04-engine-config-v1", "node-json-v1");
  const payload = configSchema(decodeStrictJson(bytes.envelope.canonicalPayload, true));
  return Object.freeze({ kind: "shadow-comparison-schema-only", bytes, payload: freezeTree(payload) });
}

/** The expected mode comes from the separately bound configuration; selection provenance remains external. */
export function parseShadowComparisonCaseEnvelope(
  input: unknown,
  expectedProviderMode: ShadowComparisonProviderMode,
): ParsedComparison<ShadowComparisonCasePayload> {
  const expected = providerMode(expectedProviderMode);
  const bytes = validateShadowEnvelopeBytes(input, "u04-evaluation-cases-v1", "node-json-v1");
  const payload = validateCases(decodeStrictJson(bytes.envelope.canonicalPayload, true));
  if (payload.providerMode !== expected) invalidComparison();
  return Object.freeze({ kind: "shadow-comparison-schema-only", bytes, payload: freezeTree(payload) });
}

type PreparationContext = "retrieval" | "quality" | "directClaim" | null;
function copyPreparedCase(value: unknown, scope: "retrieval" | "quality", index: number, omissions: Omission[]): unknown {
  const ancestors = new Set<object>();
  function copy(current: unknown, context: PreparationContext): unknown {
    if (current === null || typeof current !== "object") {
      encodeShadowNodeJsonCanonicalPayload(current);
      return current;
    }
    if (types.isProxy(current) || ancestors.has(current)) invalidComparison();
    const descriptors = dataProperties(current, invalidComparison);
    ancestors.add(current);
    try {
      if (Array.isArray(current)) return list((entry: unknown) => copy(entry, null))(current);
      if (!isPlainObject(current)) invalidComparison();
      const output: { [key: string]: unknown } = {};
      for (const key of Object.keys(descriptors)) {
        const descriptor = descriptors[key]!;
        if (!descriptor.enumerable) invalidComparison();
        if (descriptor.value === undefined) {
          if (context === "retrieval" && key === "forceEmbedding") {
            omissions.push({ scope: "retrieval", index, field: "forceEmbedding" });
          } else if (context === "quality" && Object.hasOwn(qualityOptional, key)) {
            omissions.push({ scope: "quality", index, field: qualityOmissionField(key) });
          } else if (context === "directClaim" && (key === "conceptAlternatives" || key === "semanticContract")) {
            omissions.push({ scope: "quality", index, field: qualityOmissionField(`requiredDirectClaim.${key}`) });
          } else invalidComparison();
          continue;
        }
        Object.defineProperty(output, key, {
          value: copy(descriptor.value, context === "quality" && key === "requiredDirectClaim" ? "directClaim" : null),
          enumerable: true, configurable: true, writable: true,
        });
      }
      return output;
    } finally {
      ancestors.delete(current);
    }
  }
  return copy(value, scope);
}

/** Prepare the already selected population once; only the finite case omission ledger permits undefined. */
export function prepareShadowComparisonCasePayload(input: unknown): ShadowComparisonCasePayload {
  const selected = record({
    providerMode, globalForceEmbedding: booleanValue, selection: selectionSchema,
    retrieval: list((value: unknown) => value), quality: list((value: unknown) => value),
  })(input);
  const optionalUndefined: Omission[] = [];
  const retrieval = selected.retrieval.map((value, index) => {
    const testCase = retrievalCaseSchema(copyPreparedCase(value, "retrieval", index, optionalUndefined));
    return {
      testCase,
      retrievalLimit: Math.max(testCase.topK, 10),
      effectiveForceEmbedding: testCase.forceEmbedding === true || selected.globalForceEmbedding,
    };
  });
  const quality = selected.quality.map((value, index) =>
    qualityCaseSchema(copyPreparedCase(value, "quality", index, optionalUndefined)),
  );
  optionalUndefined.sort(omissionOrder);
  return freezeTree(validateCases({
    kind: "u04-comparison-cases-v1", providerMode: selected.providerMode, globalForceEmbedding: selected.globalForceEmbedding,
    selection: selected.selection, preparation: { optionalUndefined }, retrieval, quality,
  }));
}

/** Restore own-undefined on fresh copies; retained JSON and caller objects remain untouched. */
export function restoreShadowComparisonCases(payload: ShadowComparisonCasePayload): Immutable<{
  retrieval: ReturnType<typeof retrievalCaseSchema>[];
  quality: RagEvalCase[];
}> {
  const cases = validateCases(payload);
  for (const omission of cases.preparation.optionalUndefined) {
    const target = omissionTarget(cases, omission);
    Object.defineProperty(target.record, target.key, { value: undefined, enumerable: true, writable: true, configurable: true });
  }
  return freezeTree({ retrieval: cases.retrieval.map((entry) => entry.testCase), quality: cases.quality });
}

const identityText: Schema<string> = (value) => {
  const text = nonemptyString(value);
  if (text.trim() !== text) invalidComparison();
  return text;
};
const digestValue: Schema<string> = (value) => {
  const text = stringValue(value);
  if (text.length !== 71 || !/^sha256:[0-9a-f]{64}$/.test(text)) invalidComparison();
  return text;
};
const revisionValue: Schema<string> = (value) => {
  const text = stringValue(value);
  if (text.length !== 40 || !/^[0-9a-f]{40}$/.test(text)) invalidComparison();
  return text;
};
const implementationPath: Schema<string> = (value) => {
  const text = identityText(value);
  const segments = text.split("/");
  if (/[\\:\x00-\x1f\x7f]/.test(text) || segments[0] === "1" ||
      segments.some((segment) => segment === "" || segment === "." || segment === "..")) invalidComparison();
  return text;
};
const timestampValue: Schema<string> = (value) => {
  const text = stringValue(value);
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{1,6})Z$/.exec(text);
  if (!parts || parts[0].length !== text.length) invalidComparison();
  const [year, month, day, hour, minute, second] = parts.slice(1, 7).map(Number);
  const leap = year! % 4 === 0 && (year! % 100 !== 0 || year! % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year! < 1 || month! < 1 || month! > 12 || day! < 1 || day! > days[month! - 1]! ||
      hour! > 23 || minute! > 59 || second! > 59) invalidComparison();
  return text;
};
function nullable<T>(schema: Schema<T>): Schema<T | null> {
  return (value) => value === null ? null : schema(value);
}
function fixedNumber(expected: number): Schema<number> {
  return (value) => {
    const number = numberValue(value);
    if (number !== expected) invalidComparison();
    return number;
  };
}
const retainedBytesShape = record({
  encoding: choice("utf8", "base64"), content: stringValue, byteLength: nonnegativeInteger, digest: digestValue,
});
type RetainedBytes = ReturnType<typeof retainedBytesShape>;
function retainedBuffer(value: RetainedBytes): Buffer {
  const buffer = Buffer.from(value.content, value.encoding === "utf8" ? "utf8" : "base64");
  if (value.encoding === "base64" && buffer.toString("base64") !== value.content) invalidComparison();
  if (buffer.length !== value.byteLength || `sha256:${createHash("sha256").update(buffer).digest("hex")}` !== value.digest) {
    invalidComparison();
  }
  return buffer;
}
const retainedBytes: Schema<RetainedBytes> = (value) => {
  const bytes = retainedBytesShape(value);
  retainedBuffer(bytes);
  return bytes;
};
const qnameSchema = record({ schema: identityText, name: identityText });
const routineIdentitySchema = record({ identity: qnameSchema, argumentTypes: list(identityText), resultType: identityText });
const implementationSchema = record({
  revision: revisionValue, files: list(record({ path: implementationPath, digest: digestValue }), 1),
});
const sqlOperationTags = [
  "aliases", "corpus_terms", "correct_terms", "text_chunks", "hybrid_chunks", "vector_chunks", "lookup_chunks",
  "lookup_chunk_terms", "lookup_chunk_prefix", "lookup_documents", "lookup_document_terms", "table_facts",
  "embedding_fields", "index_units", "memory_cards_hybrid", "memory_cards_lexical", "chunks_by_ids", "chunks_by_indexes",
  "documents", "ranking_metadata", "related_documents", "quality", "images_by_ids", "images_by_pages", "visual_rows", "adjacent_chunks",
] as const;
const relationTag = choice(
  "documents", "document_pages", "document_chunks", "document_images", "document_table_facts", "document_embedding_fields",
  "document_index_units", "document_sections", "document_memory_cards", "document_summaries", "document_labels", "document_index_quality",
  "ingestion_jobs", "indexing_v3_agent_jobs", "ingestion_job_stages", "import_batches", "rag_aliases", "document_title_words",
  "public_source_versions", "public_source_activation_events", "public_source_serving_authority", "document_publication_approvals",
  "shadow_reindex_waves", "document_index_generations", "document_generation_projections", "document_generation_inventory", "document_generation_baselines",
);
const settingNames = [
  "TimeZone", "default_text_search_config", "search_path", "statement_timeout", "lock_timeout",
  "pg_trgm.similarity_threshold", "hnsw.ef_search",
] as const;
const settingSource = choice("function", "role", "database", "request", "server");
function discriminant(value: unknown, field: string): unknown {
  if (value === null || typeof value !== "object") invalidComparison();
  return dataProperties(value, invalidComparison)[field]?.value;
}
const dictionaryDependency = (value: unknown) => discriminant(value, "kind") === "distribution_builtin"
  ? record({ kind: choice("distribution_builtin"), identity: identityText, distributionIdentity: identityText })(value)
  : record({ kind: choice("retained_resource"), identity: identityText, bytes: retainedBytes })(value);
const routineProvenance = (value: unknown) => discriminant(value, "kind") === "repository"
  ? record({ kind: choice("repository"), implementationPath, sourceDigest: digestValue })(value)
  : record({ kind: choice("distribution"), distributionIdentity: identityText, artifactDigest: digestValue })(value);
const deadlineSchema = record({
  kind: choice("u04-deadline-configuration-v1"), deploymentIdentity: identityText,
  transport: choice("supabase-postgrest-rpc"), requestPathIdentity: identityText,
  policy: record({ topLevelStatementDeadlineMs: fixedNumber(15000), lockTimeoutMs: boundedNumber(1, 2000, true), clientTotalDeadlineMs: fixedNumber(20000) }),
  bindings: list(record({
    routine: routineIdentitySchema, sessionRole: identityText, effectiveRole: identityText,
    statementTimeout: record({
      effectiveMs: nonnegativeInteger, source: choice("role", "database", "request", "server"),
      appliesBefore: choice("top_level_dispatch"), configurationEvidence: retainedBytes,
    }),
    lockTimeout: record({
      effectiveMs: nonnegativeInteger, source: settingSource,
      appliesBefore: choice("blocking_acquisition"), configurationEvidence: retainedBytes,
    }),
  })),
  client: record({ implementationPath, sourceDigest: digestValue, totalDeadlineMs: fixedNumber(20000), scope: choice("one_operation_total") }),
});
// The twelve native/capture fields are fixed locally, never supplied as a projection map.
const sqlFactFields = {
  evidenceMode: choice("mocked", "real"),
  target: record({ projectRef: identityText, databaseIdentity: identityText, serverIdentity: identityText,
    effectiveRole: identityText, requestPathIdentity: identityText }),
  capturedAt: timestampValue,
  producer: record({ identity: identityText, toolVersion: identityText, toolArtifactDigest: digestValue }),
  implementation: implementationSchema,
  runtime: record({ postgresVersion: nonemptyString, pgvectorVersion: nonemptyString, pgTrgmVersion: nonemptyString,
    serverEncoding: nonemptyString, distributionIdentity: identityText }),
  textSearch: record({
    configuration: qnameSchema,
    parser: record({ identity: qnameSchema, start: routineIdentitySchema, token: routineIdentitySchema,
      end: routineIdentitySchema, lexTypes: routineIdentitySchema, headline: nullable(routineIdentitySchema) }),
    tokenMappings: list(record({ tokenId: nonnegativeInteger, tokenAlias: identityText, dictionaries: list(qnameSchema) })),
    dictionaries: list(record({ identity: qnameSchema, template: qnameSchema,
      initializationRoutine: nullable(routineIdentitySchema), lexizeRoutine: routineIdentitySchema,
      optionsDefinition: retainedBytes, dependencies: list(dictionaryDependency) })),
  }),
  collations: list(record({ identity: qnameSchema, provider: nonemptyString, encoding: nonemptyString,
    localeDefinition: retainedBytes, deterministic: booleanValue, declaredProviderVersion: nullable(nonemptyString),
    observedProviderVersion: nullable(nonemptyString), nullVersionReason: nullable(choice("not_applicable")) })),
  relations: list(record({ relation: relationTag, definition: retainedBytes,
    indexes: list(record({ identity: qnameSchema, accessMethod: identityText, valid: booleanValue, ready: booleanValue,
      definition: retainedBytes, operatorClasses: list(qnameSchema), collations: list(qnameSchema) })) })),
  routines: list(record({ routine: routineIdentitySchema, definition: retainedBytes, provenance: routineProvenance })),
  operations: list(record({ operation: choice(...sqlOperationTags), entryRoutine: routineIdentitySchema,
    dependencyRoutines: list(routineIdentitySchema), relations: list(relationTag), collations: list(qnameSchema),
    settings: list(record({ name: choice(...settingNames), effectiveText: nonemptyString, unit: nullable(nonemptyString),
      source: settingSource, definingRoutine: nullable(routineIdentitySchema) })) })),
  deadlineConfiguration: deadlineSchema,
};
const captureSchema = record({ kind: choice("u04-sql-environment-capture-v1"), ...sqlFactFields, nativeCapture: retainedBytes });
const nativeFactsSchema = record({ kind: choice("u04-native-environment-facts-v1"), ...sqlFactFields });
type SqlCapture = ReturnType<typeof captureSchema>;
type QName = ReturnType<typeof qnameSchema>;
type RoutineIdentity = ReturnType<typeof routineIdentitySchema>;
export type ShadowSqlEnvironmentCapturePayload = Immutable<SqlCapture>;

function compareText(left: string, right: string): number { return left === right ? 0 : left < right ? -1 : 1; }
function compareQName(left: QName, right: QName): number {
  return compareText(left.schema, right.schema) || compareText(left.name, right.name);
}
function compareRoutine(left: RoutineIdentity, right: RoutineIdentity): number {
  const name = compareQName(left.identity, right.identity);
  if (name) return name;
  for (let index = 0; index < Math.min(left.argumentTypes.length, right.argumentTypes.length); index += 1) {
    const difference = compareText(left.argumentTypes[index]!, right.argumentTypes[index]!);
    if (difference) return difference;
  }
  return left.argumentTypes.length - right.argumentTypes.length || compareText(left.resultType, right.resultType);
}
function sortedUnique<T>(values: readonly T[], compare: (left: T, right: T) => number): void {
  for (let index = 1; index < values.length; index += 1) {
    if (compare(values[index - 1]!, values[index]!) >= 0) invalidComparison();
  }
}
function qnameKey(value: QName): string { return JSON.stringify([value.schema, value.name]); }
function routineKey(value: RoutineIdentity): string { return JSON.stringify([value.identity.schema, value.identity.name, value.argumentTypes]); }
function exactPopulation(values: readonly string[], expected: readonly string[]): void {
  sortedUnique(values, compareText);
  if (values.length !== expected.length || expected.some((entry) => !values.includes(entry))) invalidComparison();
}
function validateSqlCapture(capture: SqlCapture): void {
  const manifest = capture.implementation.files;
  sortedUnique(manifest, (left, right) => compareText(left.path, right.path));
  const checkImplementation = (path: string, digest: string) => {
    if (!manifest.some((entry) => entry.path === path && entry.digest === digest)) invalidComparison();
  };
  sortedUnique(capture.routines, (left, right) => compareRoutine(left.routine, right.routine));
  const routines = new Map<string, RoutineIdentity>();
  for (const definition of capture.routines) {
    const key = routineKey(definition.routine);
    if (routines.has(key)) invalidComparison(); // Same signature cannot disagree on result type.
    routines.set(key, definition.routine);
    if (definition.provenance.kind === "repository") {
      checkImplementation(definition.provenance.implementationPath, definition.provenance.sourceDigest);
    } else if (definition.provenance.distributionIdentity !== capture.runtime.distributionIdentity) invalidComparison();
  }
  const checkRoutine = (routine: RoutineIdentity) => {
    const retained = routines.get(routineKey(routine));
    if (!retained || compareRoutine(retained, routine) !== 0) invalidComparison();
  };
  sortedUnique(capture.collations, (left, right) => compareQName(left.identity, right.identity));
  const collations = new Set(capture.collations.map((value) => qnameKey(value.identity)));
  const checkCollation = (value: QName) => { if (!collations.has(qnameKey(value))) invalidComparison(); };
  for (const collation of capture.collations) {
    const bothNull = collation.declaredProviderVersion === null && collation.observedProviderVersion === null;
    const bothPresent = collation.declaredProviderVersion !== null && collation.observedProviderVersion !== null;
    if ((!bothNull && !bothPresent) || collation.nullVersionReason !== (bothNull ? "not_applicable" : null)) invalidComparison();
  }
  sortedUnique(capture.relations, (left, right) => compareText(left.relation, right.relation));
  const relations = new Set(capture.relations.map((value) => value.relation));
  const indexNames = new Set<string>();
  for (const relation of capture.relations) {
    sortedUnique(relation.indexes, (left, right) => compareQName(left.identity, right.identity));
    for (const index of relation.indexes) {
      const key = qnameKey(index.identity);
      if (indexNames.has(key)) invalidComparison();
      indexNames.add(key);
      // Positional index column/operator-class/collation ordering is retained.
      index.collations.forEach(checkCollation);
    }
  }
  const search = capture.textSearch;
  [search.parser.start, search.parser.token, search.parser.end, search.parser.lexTypes].forEach(checkRoutine);
  if (search.parser.headline !== null) checkRoutine(search.parser.headline);
  sortedUnique(search.dictionaries, (left, right) => compareQName(left.identity, right.identity));
  const dictionaries = new Set(search.dictionaries.map((value) => qnameKey(value.identity)));
  for (const dictionary of search.dictionaries) {
    if (dictionary.initializationRoutine !== null) checkRoutine(dictionary.initializationRoutine);
    checkRoutine(dictionary.lexizeRoutine);
    const resources = new Set<string>();
    for (const dependency of dictionary.dependencies) {
      if (resources.has(dependency.identity)) invalidComparison();
      resources.add(dependency.identity);
      if (dependency.kind === "distribution_builtin" && dependency.distributionIdentity !== capture.runtime.distributionIdentity) {
        invalidComparison();
      }
    }
  }
  sortedUnique(search.tokenMappings, (left, right) => left.tokenId - right.tokenId);
  for (const mapping of search.tokenMappings) {
    for (const dictionary of mapping.dictionaries) if (!dictionaries.has(qnameKey(dictionary))) invalidComparison();
  }
  exactPopulation(capture.operations.map((value) => value.operation), sqlOperationTags);
  for (const operation of capture.operations) {
    checkRoutine(operation.entryRoutine);
    sortedUnique(operation.dependencyRoutines, compareRoutine);
    operation.dependencyRoutines.forEach(checkRoutine);
    sortedUnique(operation.relations, compareText);
    for (const relation of operation.relations) if (!relations.has(relation)) invalidComparison();
    sortedUnique(operation.collations, compareQName);
    operation.collations.forEach(checkCollation);
    exactPopulation(operation.settings.map((value) => value.name), settingNames);
    for (const setting of operation.settings) {
      if (setting.source === "function") {
        if (setting.definingRoutine === null) invalidComparison();
        checkRoutine(setting.definingRoutine);
        if (![operation.entryRoutine, ...operation.dependencyRoutines].some((routine) => compareRoutine(routine, setting.definingRoutine!) === 0)) {
          invalidComparison();
        }
      } else if (setting.definingRoutine !== null) invalidComparison();
    }
  }
  const deadline = capture.deadlineConfiguration;
  if (deadline.requestPathIdentity !== capture.target.requestPathIdentity) invalidComparison();
  checkImplementation(deadline.client.implementationPath, deadline.client.sourceDigest);
  sortedUnique(deadline.bindings, (left, right) => compareRoutine(left.routine, right.routine));
  deadline.bindings.forEach((binding) => checkRoutine(binding.routine));
  for (const operation of capture.operations) {
    if (!deadline.bindings.some((binding) => compareRoutine(binding.routine, operation.entryRoutine) === 0)) invalidComparison();
  }
}

/** Complete intrinsic format/projection checks only; no collector, closure or operational admission. */
export function parseShadowSqlEnvironmentCaptureEnvelope(input: unknown): Readonly<{
  kind: "shadow-sql-evidence-schema-only";
  bytes: ShadowEnvelopeByteValidation;
  payload: ShadowSqlEnvironmentCapturePayload;
}> {
  const bytes = validateShadowEnvelopeBytes(input, "u04-sql-execution-evidence-v1", "node-json-v1");
  const capture = captureSchema(decodeStrictJson(bytes.envelope.canonicalPayload, true));
  let nativeText: string;
  try {
    nativeText = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(retainedBuffer(capture.nativeCapture));
  } catch {
    return invalidComparison();
  }
  const native = nativeFactsSchema(decodeStrictJson(nativeText, false, true));
  for (const field of [
    "evidenceMode", "target", "capturedAt", "producer", "implementation", "runtime",
    "textSearch", "collations", "relations", "routines", "operations", "deadlineConfiguration",
  ] as const) {
    if (encodeShadowNodeJsonCanonicalPayload(native[field]) !== encodeShadowNodeJsonCanonicalPayload(capture[field])) invalidComparison();
  }
  validateSqlCapture(capture);
  return Object.freeze({ kind: "shadow-sql-evidence-schema-only", bytes, payload: freezeTree(capture) });
}

const sqlReviewAreas = [
  "target_and_implementation", "text_search", "collations", "structural_dependencies", "operation_settings", "server_deadline",
] as const;
const sqlReviewSchema = record({
  kind: choice("u04-sql-environment-review-v1"), evidenceMode: choice("mocked", "real"),
  captureEnvelopeDigest: digestValue,
  reviewer: record({ identity: identityText, role: choice("database_schema_reviewer"), reviewedAt: timestampValue }),
  coverage: list(record({
    area: choice(...sqlReviewAreas), outcome: choice("satisfied", "unsatisfied", "unavailable"), findings: list(nonemptyString),
  })),
});
export type ShadowSqlEnvironmentReviewPayload = Immutable<ReturnType<typeof sqlReviewSchema>>;

/** Review format only. Coverage labels and actor identities do not supply independent authority. */
export function parseShadowSqlEnvironmentReviewEnvelope(input: unknown): Readonly<{
  kind: "shadow-sql-evidence-schema-only";
  bytes: ShadowEnvelopeByteValidation;
  payload: ShadowSqlEnvironmentReviewPayload;
}> {
  const bytes = validateShadowEnvelopeBytes(input, "u04-sql-execution-evidence-v1", "node-json-v1");
  const review = sqlReviewSchema(decodeStrictJson(bytes.envelope.canonicalPayload, true));
  exactPopulation(review.coverage.map((entry) => entry.area), sqlReviewAreas);
  for (const entry of review.coverage) {
    if (entry.outcome !== "satisfied" && entry.findings.length === 0) invalidComparison();
  }
  return Object.freeze({ kind: "shadow-sql-evidence-schema-only", bytes, payload: freezeTree(review) });
}

export type ShadowSqlEnvironmentBundlePayload = Readonly<{
  kind: "u04-reviewed-sql-environment-v1";
  evidenceMode: "mocked" | "real";
  captureEnvelope: ShadowRawEnvelope;
  reviewEnvelope: ShadowRawEnvelope;
}>;

/** Bind complete original nested envelopes without claiming satisfied evidence or operational admission. */
export function parseShadowSqlEnvironmentBundleEnvelope(input: unknown): Readonly<{
  kind: "shadow-sql-evidence-schema-only";
  bytes: ShadowEnvelopeByteValidation;
  payload: ShadowSqlEnvironmentBundlePayload;
  capture: ReturnType<typeof parseShadowSqlEnvironmentCaptureEnvelope>;
  review: ReturnType<typeof parseShadowSqlEnvironmentReviewEnvelope>;
}> {
  const bytes = validateShadowEnvelopeBytes(input, "u04-sql-execution-evidence-v1", "node-json-v1");
  const bundle = record({
    kind: choice("u04-reviewed-sql-environment-v1"), evidenceMode: choice("mocked", "real"),
    captureEnvelope: parseShadowSqlEnvironmentCaptureEnvelope,
    reviewEnvelope: parseShadowSqlEnvironmentReviewEnvelope,
  })(decodeStrictJson(bytes.envelope.canonicalPayload, true));
  const capture = bundle.captureEnvelope;
  const review = bundle.reviewEnvelope;
  if (
    capture.payload.evidenceMode !== bundle.evidenceMode || review.payload.evidenceMode !== bundle.evidenceMode ||
    review.payload.captureEnvelopeDigest !== capture.bytes.envelope.digest ||
    review.payload.reviewer.identity === capture.payload.producer.identity
  ) {
    invalidComparison();
  }
  // Both copies contain precisely the original five validated scalar fields;
  // canonicalPayload strings retain the original nested serialized bytes.
  const payload: ShadowSqlEnvironmentBundlePayload = Object.freeze({
    kind: bundle.kind,
    evidenceMode: bundle.evidenceMode,
    captureEnvelope: capture.bytes.envelope,
    reviewEnvelope: review.bytes.envelope,
  });
  return Object.freeze({ kind: "shadow-sql-evidence-schema-only", bytes, payload, capture, review });
}

const uuidValue: Schema<string> = (value) => {
  const text = stringValue(value);
  if (text.length !== 36 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(text)) invalidComparison();
  return text;
};
const versionValue: Schema<string> = (value) => {
  const text = identityText(value);
  if (text.length > 100) invalidComparison();
  return text;
};
const projectReference: Schema<string> = (value) => {
  const text = versionValue(value);
  // Recognized URL/connection forms only. This does not establish absence of
  // arbitrary credentials/commands or supply real-target admission.
  if (/^[a-z][a-z0-9+.-]*:/i.test(text) || text.startsWith("//") ||
      /(?:^|\s)(?:host|hostaddr|port|dbname|database|user|password|service|sslmode)\s*=/i.test(text)) invalidComparison();
  return text;
};
const comparisonClock = (value: unknown) => {
  const text = timestampValue(value);
  if (text.length !== 24) invalidComparison();
  return text;
};
const publicNull: Schema<null> = (value) => {
  if (value !== null) invalidComparison();
  return null;
};
const publicTrue: Schema<true> = (value) => {
  if (value !== true) invalidComparison();
  return true;
};
const profileAccess = (value: unknown) => discriminant(value, "mode") === "owner"
  ? record({ mode: choice("owner"), ownerId: uuidValue, includePublic: booleanValue })(value)
  : record({ mode: choice("public"), ownerId: publicNull, includePublic: publicTrue })(value);
const profileLimits = record({
  serverRequestDeadlineMs: fixedNumber(15000), lockTimeoutMs: boundedNumber(1, 2000, true), clientTotalDeadlineMs: fixedNumber(20000),
  maxMembers: boundedNumber(1, 8, true), maxCapturedRows: boundedNumber(1, 250000, true),
  maxOriginBundleBytes: boundedNumber(1, 268435456, true), maxAppendRows: boundedNumber(1, 2000, true),
  maxAppendBytes: boundedNumber(1, 16777216, true),
});
const policyArtifact = record({ digest: digestValue, retainedEnvelopeDigest: digestValue });
const documentOwnedPolicy = record({
  documentId: uuidValue, ownerId: nullable(uuidValue), contentHash: digestValue, sourcePolicyVersion: versionValue,
  policyArtifact, reviewArtifact: policyArtifact,
});
const providerPolicySchema = record({
  requestTimeoutMs: positiveInteger, answerTimeoutMs: positiveInteger,
  embeddingMaxRetries: nonnegativeInteger, generationMaxRetries: nonnegativeInteger,
  promptCacheRetention: choice("off", "in_memory", "24h"), promptCacheTtl: nullable(choice("off", "30m")),
  storeResponses: booleanValue,
  routeBudgetMs: record({ unsupported: fixedNumber(0), extractive: fixedNumber(12000), fast: fixedNumber(25000), strong: fixedNumber(35000) }),
  generationRecoveryReserveMs: fixedNumber(2000), minimumGenerationRetryMs: fixedNumber(20000),
});
const profileSchema = record({
  kind: choice("u04-execution-profile-v1"), evidenceMode: choice("mocked", "real"),
  target: record({ projectRef: projectReference }), access: profileAccess,
  documentIds: list(uuidValue, 1), manualAliasIds: list(uuidValue), manualAliasReviews: (value: unknown) => list(auditAnyEnvelope)(value), sourcePolicyVersion: versionValue,
  documentOwnedPolicies: list(documentOwnedPolicy), rolloutMode: choice("legacy", "shadow", "canary"),
  rolloutVersion: versionValue, providerMode, comparisonClock,
  configuration: parseShadowComparisonConfigEnvelope,
  // Only this intermediate slot remains opaque until the root's mode is known.
  // The public result cannot escape before the complete case parser below runs.
  cases: (value: unknown) => value,
  implementation: implementationSchema, providerPolicy: providerPolicySchema,
  sql: record({ environment: parseShadowSqlEnvironmentBundleEnvelope }), limits: profileLimits,
});
export type ShadowExecutionProfilePayload = Immutable<
  Omit<ReturnType<typeof profileSchema>, "configuration" | "cases" | "sql"> & {
    configuration: ShadowRawEnvelope;
    cases: ShadowRawEnvelope;
    sql: { environment: ShadowRawEnvelope };
  }
>;

/** Intrinsic profile consistency only. Actual closure, facts and external admission remain separate. */
export function parseShadowExecutionProfileEnvelope(input: unknown): Readonly<{
  kind: "shadow-execution-profile-schema-only";
  bytes: ShadowEnvelopeByteValidation;
  payload: ShadowExecutionProfilePayload;
  configuration: ReturnType<typeof parseShadowComparisonConfigEnvelope>;
  cases: ReturnType<typeof parseShadowComparisonCaseEnvelope>;
  sql: ReturnType<typeof parseShadowSqlEnvironmentBundleEnvelope>;
}> {
  const bytes = validateShadowEnvelopeBytes(input, "u04-execution-profile-v1", "node-json-v1");
  const profile = profileSchema(decodeStrictJson(bytes.envelope.canonicalPayload, true));
  const configuration = profile.configuration;
  const cases = parseShadowComparisonCaseEnvelope(profile.cases, profile.providerMode);
  const sql = profile.sql.environment;
  const capture = sql.capture.payload;
  sortedUnique(profile.documentIds, compareText);
  sortedUnique(profile.manualAliasIds, compareText);
  validateManualAliasReviews(profile);
  sortedUnique(profile.documentOwnedPolicies, (left, right) => compareText(left.documentId, right.documentId));
  sortedUnique(profile.implementation.files, (left, right) => compareText(left.path, right.path));
  if (profile.documentIds.length > profile.limits.maxMembers) invalidComparison();
  for (const policy of profile.documentOwnedPolicies) {
    if (!profile.documentIds.includes(policy.documentId) || policy.sourcePolicyVersion !== profile.sourcePolicyVersion) invalidComparison();
  }
  if (
    profile.providerMode !== configuration.payload.generation.providerMode || profile.evidenceMode !== sql.payload.evidenceMode ||
    profile.target.projectRef !== capture.target.projectRef ||
    encodeShadowNodeJsonCanonicalPayload(profile.implementation) !== encodeShadowNodeJsonCanonicalPayload(capture.implementation)
  ) {
    invalidComparison();
  }
  if (sql.review.payload.coverage.some((entry) => entry.outcome !== "satisfied")) invalidComparison();
  if (capture.collations.some((entry) => entry.declaredProviderVersion !== entry.observedProviderVersion)) invalidComparison();
  const deadline = capture.deadlineConfiguration;
  if (
    deadline.policy.topLevelStatementDeadlineMs !== profile.limits.serverRequestDeadlineMs ||
    deadline.policy.lockTimeoutMs !== profile.limits.lockTimeoutMs ||
    deadline.policy.clientTotalDeadlineMs !== profile.limits.clientTotalDeadlineMs ||
    deadline.client.totalDeadlineMs !== profile.limits.clientTotalDeadlineMs
  ) {
    invalidComparison();
  }
  for (const binding of deadline.bindings) {
    if (binding.statementTimeout.effectiveMs !== 15000 || binding.lockTimeout.effectiveMs !== profile.limits.lockTimeoutMs) invalidComparison();
  }
  const payload: ShadowExecutionProfilePayload = freezeTree({
    ...profile,
    configuration: configuration.bytes.envelope,
    cases: cases.bytes.envelope,
    sql: { environment: sql.bytes.envelope },
  });
  return Object.freeze({ kind: "shadow-execution-profile-schema-only", bytes, payload, configuration, cases, sql });
}

const inventoryFamilies = [
  "attempt_control", "cache_inputs", "chunks", "document_metadata", "embedding_fields", "generated_labels",
  "images", "index_units", "memory_cards", "native_structure", "pages", "private_objects", "producer_aliases",
  "quality", "repair_audit_inputs", "sections", "summary", "table_facts",
] as const;
const inventoryFamily = choice(...inventoryFamilies);
type InventoryFamily = ReturnType<typeof inventoryFamily>;
const inventorySlots = {
  attempt_control: ["control"], cache_inputs: ["cache"], chunks: ["worker_core"], document_metadata: ["projection_aggregate"],
  embedding_fields: ["worker_core"], generated_labels: ["enrichment"], images: ["worker_core"],
  index_units: ["worker_core", "deep_memory"], memory_cards: ["deep_memory"], native_structure: ["worker_native"],
  pages: ["worker_core"], private_objects: ["private_objects"], producer_aliases: ["deep_memory"],
  quality: ["worker_core"], repair_audit_inputs: ["repair"], sections: ["deep_memory"], summary: ["enrichment"],
  table_facts: ["worker_core"],
} as const satisfies { [F in InventoryFamily]: readonly string[] };
const inventoryUnit = record({ family: inventoryFamily, key: nonemptyString });
const inventoryRowOwner = choice("page", "chunk", "image", "table_fact", "embedding_field", "index_unit", "section",
  "memory_card", "summary", "label", "quality", "document", "alias", "node_job", "edge_job", "job_stage", "import_batch");
const inventoryProjection = record({
  tag: choice("candidate_projection"), slot: choice("summary", "generated_labels", "quality", "worker_metadata",
    "document_counts", "enrichment_metadata", "deep_memory_metadata", "deep_memory_receipt", "producer_aliases"),
  itemId: nullable(uuidValue), payloadDigest: digestValue,
});
function inventoryArtifact(value: unknown) {
  switch (discriminant(value, "tag")) {
    case "origin_row": return record({ tag: choice("origin_row"), owner: inventoryRowOwner, rowId: uuidValue, rowDigest: digestValue })(value);
    case "candidate_row": return record({ tag: choice("candidate_row"), owner: choice("page", "chunk", "image", "table_fact",
      "embedding_field", "index_unit", "section", "memory_card"), rowId: uuidValue, rowDigest: digestValue })(value);
    case "candidate_projection": {
      const projection = inventoryProjection(value);
      const item = projection.slot === "generated_labels" || projection.slot === "producer_aliases";
      if (item !== (projection.itemId !== null)) invalidComparison();
      return projection;
    }
    case "retained_payload": return record({ tag: choice("retained_payload"), envelopeDigest: digestValue,
      representation: choice("producer_text", "producer_json", "producer_bytes", "cache_input", "repair_audit_input", "control_checkpoint"),
      mediaType: nonemptyString, byteLength: nonnegativeInteger })(value);
    case "private_object": return record({ tag: choice("private_object"), bucket: nonemptyString, objectPath: nonemptyString,
      objectVersion: nullable(nonemptyString), sha256: digestValue, byteLength: nonnegativeInteger, mediaType: nonemptyString })(value);
    default: return invalidComparison();
  }
}
const inventoryPointer = record({ ref: inventoryArtifact,
  path: list((value: unknown) => typeof value === "string" ? stringValue(value) : nonnegativeInteger(value)),
});
const inventoryLimitation = record({
  version: fixedNumber(1), code: choice("producer_unavailable", "producer_failed", "producer_skipped", "policy_excluded",
    "not_applicable", "no_units_expected", "native_capability_unknown", "native_capability_unavailable", "reference_unavailable",
    "object_attachment_ambiguous", "measurement_unavailable", "source_identity_unavailable"),
  scope: inventoryUnit, evidence: list(inventoryPointer), explanation: nonemptyString,
  blocks: list(choice("audit_mapping", "text_retrieval", "vector_retrieval", "structured_retrieval", "visual_retrieval",
    "summary_context", "deep_memory_context", "alias_expansion", "recovery", "full_engine_evaluation", "native_fidelity", "semantic_support")),
});
function inventoryPopulation(value: unknown) {
  switch (discriminant(value, "tag")) {
    case "known": return record({ tag: choice("known"), expectedUnits: list(inventoryUnit), basis: list(inventoryPointer),
      reason: nullable(choice("no_units_expected")) })(value);
    case "unknown": return record({ tag: choice("unknown"), limitation: inventoryLimitation })(value);
    case "unavailable": return record({ tag: choice("unavailable"), limitation: inventoryLimitation })(value);
    default: return invalidComparison();
  }
}
const inventoryDeclaration = record({ firstLeaseToken: uuidValue,
  producer: record({ name: nonemptyString, version: nullable(nonemptyString), outputManifestDigest: digestValue }),
  artifactGenerationId: nullable(uuidValue), population: inventoryPopulation, outputManifestEnvelope: (value: unknown) => auditAnyEnvelope(value),
});
function inventoryGroup(value: unknown) {
  const groupKey = choice("worker_core", "worker_native", "deep_memory", "enrichment", "projection_aggregate", "private_objects", "control", "cache", "repair");
  return discriminant(value, "state") === "pending"
    ? record({ groupKey, state: choice("pending"), declaration: publicNull })(value)
    : record({ groupKey, state: choice("declared"), declaration: inventoryDeclaration })(value);
}
const inventoryManifest = record({ version: fixedNumber(1), documentId: uuidValue, candidateGenerationId: uuidValue, jobId: uuidValue,
  families: list(record({ family: inventoryFamily, groups: list(inventoryGroup) })),
});
export type ShadowInventoryManifestPayload = Immutable<ReturnType<typeof inventoryManifest>>;

/** Stored JSON shape and intrinsic identities only; no byte-envelope, reservation or seal authority. */
export function parseShadowInventoryManifestPayload(input: unknown): Readonly<{
  kind: "shadow-inventory-manifest-schema-only";
  payload: ShadowInventoryManifestPayload;
}> {
  const payload = inventoryManifest(input);
  exactPopulation(payload.families.map((entry) => entry.family), inventoryFamilies);
  let firstToken: string | undefined;
  let deepMemoryGeneration: string | undefined;
  for (const family of payload.families) {
    const slots: readonly string[] = inventorySlots[family.family];
    if (family.groups.length !== slots.length || family.groups.some((group, index) => group.groupKey !== slots[index])) invalidComparison();
    const declaredUnits = new Set<string>();
    for (const group of family.groups) {
      if (group.state === "pending") continue;
      const declaration = group.declaration;
      if (declaration.outputManifestEnvelope.digest !== declaration.producer.outputManifestDigest) invalidComparison();
      if (firstToken !== undefined && firstToken !== declaration.firstLeaseToken) invalidComparison();
      firstToken = declaration.firstLeaseToken;
      const generation = declaration.artifactGenerationId;
      if (group.groupKey !== "deep_memory" && generation !== null) invalidComparison();
      if (group.groupKey === "deep_memory" && generation !== null) {
        if (generation === payload.candidateGenerationId || (deepMemoryGeneration !== undefined && deepMemoryGeneration !== generation)) invalidComparison();
        deepMemoryGeneration = generation;
      }
      const population = declaration.population;
      if (population.tag === "known") {
        sortedUnique(population.expectedUnits, (left, right) => compareText(left.family, right.family) || compareText(left.key, right.key));
        if (population.expectedUnits.length === 0) {
          if (population.reason !== "no_units_expected" || population.basis.length === 0) invalidComparison();
        } else if (population.reason !== null || (group.groupKey === "deep_memory" && generation === null)) invalidComparison();
        for (const unit of population.expectedUnits) {
          if (unit.family !== family.family || declaredUnits.has(unit.key)) invalidComparison();
          declaredUnits.add(unit.key);
        }
      } else {
        if (population.limitation.scope.family !== family.family) invalidComparison();
        if (population.tag === "unknown" && !["native_structure", "cache_inputs", "repair_audit_inputs"].includes(family.family)) invalidComparison();
        if (population.tag === "unavailable" && (
          !["worker_native", "deep_memory", "enrichment", "cache", "repair"].includes(group.groupKey) ||
          !["producer_unavailable", "producer_failed", "producer_skipped"].includes(population.limitation.code)
        )) invalidComparison();
      }
    }
  }
  // Fresh copies only. Pending/unknown/unavailable remain evidence states, never readiness flags.
  return Object.freeze({ kind: "shadow-inventory-manifest-schema-only", payload: freezeTree(payload) });
}

// Reviewed manual evidence is interpreted only through this fixed, side-effect-free consumer.
// Byte equality and this mapping never establish an operational controller admission.
type AuditJson = null | boolean | number | string | AuditJson[] | { [key: string]: AuditJson };
const auditJson: Schema<AuditJson> = (value) => decodeStrictJson(encodeShadowNodeJsonCanonicalPayload(value), true) as AuditJson;
const auditObject: Schema<{ [key: string]: AuditJson }> = (value) => {
  const result = auditJson(value);
  if (result === null || typeof result !== "object" || Array.isArray(result)) invalidComparison();
  return result;
};
function auditEqual(left: unknown, right: unknown): void {
  if (encodeShadowNodeJsonCanonicalPayload(left) !== encodeShadowNodeJsonCanonicalPayload(right)) invalidComparison();
}
const auditBareDigest: Schema<string> = (value) => {
  const text = stringValue(value);
  if (text.length !== 64 || !/^[0-9a-f]{64}$/.test(text)) invalidComparison();
  return text;
};
const auditDate: Schema<string> = (value) => {
  const text = stringValue(value);
  if (text.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(text)) invalidComparison();
  return text;
};
const auditMode = choice("mocked", "real");
const auditRole = choice("clinical_governance", "corpus_steward", "source_governance");
const auditPolicy = choice("u04-reviewed-manual-p04-v1");
const auditCounts = ["pages", "chunks", "tables", "images", "searchableUnits", "embeddings"] as const;
const auditStructureNames = ["chunkBoundsValid", "headingContinuityPassed", "tableContinuityPassed", "extractionQualityPassed"] as const;
const auditProvenanceNames = ["contentHash", "extractionVersion", "parserVersion", "parserConfigVersion", "chunkerVersion", "indexUnitVersion", "validationVersion", "sourcePolicyVersion"] as const;
const auditSource = record({
  version: fixedNumber(1), originDigest: digestValue, executionProfileDigest: digestValue, documentId: uuidValue,
  ownerId: nullable(uuidValue), contentHash: digestValue, authorityDigest: digestValue, sourcePolicyVersion: versionValue,
  manualAliasIds: list(uuidValue), baselineGenerationId: nullable(uuidValue),
  source: (value: unknown) => discriminant(value, "tag") === "document_owned"
    ? record({ tag: choice("document_owned") })(value)
    : record({ tag: choice("catalogue_version"), sourceCatalogueKey: nonemptyString, sourceVersionId: uuidValue, activationEventId: uuidValue })(value),
});
const auditProducer = record({ kind: choice("reviewed_manual"), consumerContract: choice("u04-reviewed-measurements-v1"),
  identity: nonemptyString, version: choice("1"), evidenceMode: auditMode });
const auditProvenance = record({ contentHash: digestValue, extractionVersion: versionValue, parserVersion: versionValue,
  parserConfigVersion: versionValue, chunkerVersion: versionValue, indexUnitVersion: versionValue,
  validationVersion: versionValue, sourcePolicyVersion: versionValue });
const auditProvenanceReview = record({ contractVersion: versionValue, evidenceDigest: digestValue, reviewedAt: auditDate, reviewerRole: auditRole });
const auditPopulation = (value: unknown) => discriminant(value, "tag") === "known"
  ? record({ tag: choice("known"), units: list(inventoryUnit), basis: list(inventoryPointer, 1) })(value)
  : record({ tag: choice("unknown"), reason: choice("measurement_unavailable"), basis: list(inventoryPointer, 1) })(value);
const auditExpected = record({
  kind: choice("u04-evidence-expectations-v1"), policyId: auditPolicy, source: auditSource, evidenceMode: auditMode,
  lifecycle: choice("current", "review_due", "superseded", "withdrawn", "quarantined"), lifecycleEvidence: list(inventoryPointer, 1),
  populations: record({ pages: auditPopulation, chunks: auditPopulation, tables: auditPopulation, images: auditPopulation,
    searchableUnits: auditPopulation, embeddings: auditPopulation }),
  checks: list(record({ id: nonemptyString, metric: choice(...auditStructureNames), expectedUnit: inventoryUnit, basis: list(inventoryPointer, 1) }), 4),
  provenance: auditProvenance, provenanceReview: auditProvenanceReview,
  embedding: record({ expectedModel: identityText, expectedDimensions: positiveInteger, expectedStrategy: identityText }),
  configurationEvidence: list(inventoryPointer, 1),
  mustPassCases: list(record({ id: identityText, expectedDocumentRank: nullable(positiveInteger) })),
});
const auditRelationship = (value: unknown) => discriminant(value, "tag") === "anchor"
  ? record({ tag: choice("anchor"), field: inventoryPointerPath, target: inventoryUnit, value: nonemptyString })(value)
  : record({ tag: choice("source_chunk", "source_image", "section", "page", "private_object", "input"),
    field: inventoryPointerPath, target: inventoryUnit })(value);
function inventoryPointerPath(value: unknown) {
  return list((entry: unknown) => typeof entry === "string" ? stringValue(entry) : nonnegativeInteger(entry))(value);
}
function auditWitness(value: unknown) {
  const evidence = list(inventoryPointer, 1);
  switch (discriminant(value, "tag")) {
    case "population": return record({ tag: choice("population"), metric: choice(...auditCounts),
      observations: list(record({ unit: inventoryUnit, evidence })), result: nonnegativeInteger })(value);
    case "unit_quality": return record({ tag: choice("unit_quality"), unit: inventoryUnit, evidence,
      empty: booleanValue, oversized: booleanValue, undersized: booleanValue, lowInformation: booleanValue, rationale: nonemptyString })(value);
    case "structure": return record({ tag: choice("structure"), checkId: nonemptyString, metric: choice(...auditStructureNames),
      evidence, result: choice("pass", "fail", "unavailable"), rationale: nonemptyString })(value);
    case "duplicates": return record({ tag: choice("duplicates"), policy: choice("index-quality-whitespace-sha256-v1"),
      groups: list(record({ contentHash: auditBareDigest, units: list(inventoryUnit, 1) })), result: nonnegativeInteger })(value);
    case "relationships": return record({ tag: choice("relationships"), checked: list(record({ unit: inventoryUnit,
      relationship: auditRelationship, result: choice("resolved", "orphan"), evidence })), result: nonnegativeInteger })(value);
    case "embedding": return record({ tag: choice("embedding"), unit: inventoryUnit, evidence, present: booleanValue,
      model: nullable(nonemptyString), dimensions: nullable(positiveInteger), strategy: nullable(nonemptyString) })(value);
    case "provenance": return record({ tag: choice("provenance"), field: choice(...auditProvenanceNames), evidence, value: nonemptyString })(value);
    case "generations": return record({ tag: choice("generations"), units: list(record({ unit: inventoryUnit, evidence,
      generation: nullable(uuidValue) })), result: list(uuidValue) })(value);
    default: return invalidComparison();
  }
}
const auditCount = record({ expected: nullable(nonnegativeInteger), actual: nonnegativeInteger });
const auditFields = record({
  counts: record({ pages: auditCount, chunks: auditCount, tables: auditCount, images: auditCount,
    searchableUnits: auditCount, embeddings: auditCount, duplicateChunks: nonnegativeInteger, orphanedArtifacts: nonnegativeInteger }),
  unitQuality: record({ policyVersion: auditPolicy, empty: nonnegativeInteger, oversized: nonnegativeInteger,
    undersized: nonnegativeInteger, lowInformation: nonnegativeInteger }),
  structure: record({ chunkBoundsValid: booleanValue, headingContinuityPassed: booleanValue,
    tableContinuityPassed: booleanValue, extractionQualityPassed: booleanValue }),
  embeddingContract: record({ expectedModel: identityText, actualModels: list(identityText), expectedDimensions: positiveInteger,
    actualDimensions: list(positiveInteger), expectedStrategy: identityText, actualStrategies: list(identityText), completeness: boundedNumber(0, 1) }),
  provenance: record({ expected: auditProvenance, actual: auditProvenance, review: auditProvenanceReview }),
  chunkGenerations: list(uuidValue),
});
const auditMeasurements = record({ kind: choice("reviewed-origin-measurements-v1"), policyId: auditPolicy, source: auditSource,
  expectationsDigest: digestValue, producer: auditProducer, fields: auditFields, witnesses: list(auditWitness) });
const auditApproval = record({ kind: choice("u04-reviewed-evidence-approval-v1"), policyId: auditPolicy, source: auditSource,
  evidenceMode: auditMode, expectationsDigest: digestValue, measurementsDigest: digestValue, producer: auditProducer,
  reviewer: record({ identity: nonemptyString, role: auditRole, reviewedAt: auditDate, evidence: inventoryArtifact, evidenceDigest: digestValue }) });
const auditReviewActor = record({ identity: nonemptyString, role: auditRole, reviewedAt: auditDate });
const auditMeasurementReview = record({ kind: choice("u04-measurement-review-v1"), evidenceMode: auditMode, source: auditSource,
  expectationsDigest: digestValue, measurementsDigest: digestValue, producerIdentity: nonemptyString,
  reviewer: auditReviewActor, reviewText: nonemptyString });
const auditPolicyMember = record({ documentId: uuidValue, ownerId: nullable(uuidValue), contentHash: digestValue });
const auditDocumentPolicy = record({ kind: choice("u04-document-owned-policy-v1"), evidenceMode: auditMode,
  sourcePolicyVersion: versionValue, members: list(auditPolicyMember, 1), policyText: nonemptyString });
const auditPolicyReview = record({ kind: choice("u04-document-owned-policy-review-v1"), evidenceMode: auditMode,
  sourcePolicyVersion: versionValue, members: list(auditPolicyMember, 1), policyArtifact,
  reviewer: auditReviewActor, reviewText: nonemptyString });
function auditEnvelope<T>(input: unknown, domain: ShadowEnvelopeDomain, schema: Schema<T>, encoding: ShadowEnvelopeEncoding = "node-json-v1") {
  const bytes = validateShadowEnvelopeBytes(input, domain, encoding);
  return { envelope: bytes.envelope, payload: schema(decodeStrictJson(bytes.envelope.canonicalPayload, encoding === "node-json-v1")) };
}
const auditAnyEnvelope: Schema<ShadowRawEnvelope> = (input) => {
  const header = record({ version: fixedNumber(1), domain: choice(...domains), encoding: choice(...encodings),
    canonicalPayload: stringValue, digest: digestValue })(input);
  return validateShadowEnvelopeBytes(header, header.domain, header.encoding).envelope;
};
const auditHistorical = record({ artifactDigest: digestValue, expectedStateDigest: nullable(auditBareDigest), envelope: auditAnyEnvelope });
const auditHistoricalBytes = record({ kind: choice("u04-historical-audit-bytes-v1"), documentId: uuidValue,
  expectedStateDigest: nullable(auditBareDigest), bytes: record({ encoding: choice("base64"), content: stringValue }) });
const auditRetainedEvidence = (value: unknown) => discriminant(value, "tag") === "payload"
  ? record({ tag: choice("payload"), envelope: auditAnyEnvelope,
    representation: choice("producer_text", "producer_json", "producer_bytes", "cache_input", "repair_audit_input", "control_checkpoint"),
    mediaType: nonemptyString, byteLength: nonnegativeInteger })(value)
  : record({ tag: choice("private_object"), ref: (ref: unknown) => {
    const parsed = inventoryArtifact(ref);
    if (parsed.tag !== "private_object") invalidComparison();
    return parsed;
  }, bytes: record({ encoding: choice("base64"), content: stringValue }) })(value);
const auditInputTransport = record({ originEnvelope: auditAnyEnvelope, caseResultsEnvelope: auditAnyEnvelope,
  documents: list(record({ documentId: uuidValue, reviewedExpectationsEnvelope: auditAnyEnvelope,
    measurementsEnvelope: auditAnyEnvelope, approvalEnvelope: auditAnyEnvelope, historicalArtifact: auditHistorical }), 1),
  retainedEvidence: list(auditRetainedEvidence),
});
const auditAdmission = record({ executionProfileDigest: digestValue, originDigest: digestValue, caseResultsDigest: digestValue,
  documents: list(record({ documentId: uuidValue, expectationsDigest: digestValue, measurementsDigest: digestValue,
    approvalEnvelopeDigest: digestValue, historicalArtifactDigest: digestValue, historicalEnvelopeDigest: digestValue }), 1),
  documentPolicyBindings: list(documentOwnedPolicy), manualAliasReviewBindings: list(record({ aliasId: uuidValue,
    ownerId: nullable(uuidValue), rowDigest: digestValue, reviewEnvelopeDigest: digestValue })), evidenceMode: auditMode });

// Literal stored column closure: adopted column-contract2 plus the frozen U04 foundation additions.
const auditStoredColumns = {
  documents: { "id":"uuid", "owner_id":"uuid?", "title":"text", "description":"text?", "file_name":"text", "file_type":"text", "file_size":"integer", "storage_path":"text", "content_hash":"text?", "source_path":"text?", "import_batch_id":"uuid?", "status":"text", "page_count":"integer", "chunk_count":"integer", "image_count":"integer", "error_message":"text?", "metadata":"json", "search_tsv":"text?", "title_search_tsv":"text?", "index_generation_id":"uuid?", "created_at":"timestamp", "updated_at":"timestamp" },
  document_pages: { "id":"uuid", "document_id":"uuid", "page_number":"integer", "text":"text", "ocr_used":"boolean", "metadata":"json", "created_at":"timestamp", "index_generation_id":"uuid?" },
  document_chunks: { "id":"uuid", "document_id":"uuid", "page_number":"integer?", "chunk_index":"integer", "section_heading":"text?", "section_path":"texts", "heading_level":"integer?", "parent_heading":"text?", "anchor_id":"text?", "content":"text", "retrieval_synopsis":"text?", "content_hash":"text?", "index_generation_id":"uuid?", "token_estimate":"integer", "image_ids":"uuids", "metadata":"json", "embedding":"vector", "search_tsv":"text?", "created_at":"timestamp" },
  document_images: { "id":"uuid", "document_id":"uuid", "page_number":"integer?", "storage_path":"text", "mime_type":"text", "caption":"text", "bbox":"json?", "image_type":"text", "searchable":"boolean", "clinical_relevance_score":"number", "skip_reason":"text?", "source_kind":"text", "width":"integer?", "height":"integer?", "image_hash":"text?", "perceptual_hash":"text?", "labels":"texts", "index_generation_id":"uuid?", "caption_confidence":"number?", "clinical_priority_score":"number?", "crop_completeness":"number?", "image_quality_score":"number?", "ocr_text_density":"number?", "structured_extraction_confidence":"number?", "visual_duplicate_group":"text?", "metadata":"json", "created_at":"timestamp" },
  document_table_facts: { "id":"uuid", "owner_id":"uuid?", "document_id":"uuid", "source_chunk_id":"uuid?", "source_image_id":"uuid?", "page_number":"integer?", "table_title":"text?", "row_label":"text?", "clinical_parameter":"text?", "threshold_value":"text?", "action":"text?", "normalized_terms":"texts", "index_generation_id":"uuid?", "metadata":"json", "search_tsv":"text?", "created_at":"timestamp" },
  document_embedding_fields: { "id":"uuid", "owner_id":"uuid?", "document_id":"uuid", "source_chunk_id":"uuid?", "field_type":"text", "content":"text", "content_hash":"text", "embedding":"vector", "index_generation_id":"uuid?", "metadata":"json", "search_tsv":"text?", "created_at":"timestamp" },
  document_index_units: { "id":"uuid", "owner_id":"uuid?", "document_id":"uuid", "unit_type":"text", "source_chunk_id":"uuid?", "source_image_id":"uuid?", "page_start":"integer?", "page_end":"integer?", "heading_path":"texts", "title":"text", "content":"text", "normalized_terms":"texts", "source_span":"json?", "quality_score":"number", "extraction_mode":"text", "index_generation_id":"uuid?", "producer":"text?", "artifact_generation_id":"uuid?", "embedding":"vector", "metadata":"json", "search_tsv":"text?", "created_at":"timestamp", "updated_at":"timestamp" },
  document_sections: { "id":"uuid", "document_id":"uuid", "owner_id":"uuid?", "section_index":"integer", "heading":"text", "heading_path":"texts", "page_start":"integer?", "page_end":"integer?", "chunk_ids":"uuids", "summary":"text", "tags":"texts", "extraction_quality":"text", "index_generation_id":"uuid?", "producer":"text?", "artifact_generation_id":"uuid?", "metadata":"json", "created_at":"timestamp", "updated_at":"timestamp" },
  document_memory_cards: { "id":"uuid", "document_id":"uuid", "owner_id":"uuid?", "section_id":"uuid?", "card_type":"text", "title":"text", "content":"text", "normalized_terms":"texts", "page_number":"integer?", "source_chunk_ids":"uuids", "source_image_ids":"uuids", "confidence":"number", "index_generation_id":"uuid?", "producer":"text?", "artifact_generation_id":"uuid?", "metadata":"json", "embedding":"vector", "search_tsv":"text?", "created_at":"timestamp", "updated_at":"timestamp" },
  document_summaries: { "id":"uuid", "document_id":"uuid", "owner_id":"uuid?", "summary":"text", "clinical_specifics":"json", "source_chunk_ids":"uuids", "source_image_ids":"uuids", "model":"text?", "metadata":"json", "generated_at":"timestamp", "created_at":"timestamp", "updated_at":"timestamp" },
  document_labels: { "id":"uuid", "document_id":"uuid", "owner_id":"uuid?", "label":"text", "label_type":"text", "source":"text", "confidence":"number", "metadata":"json", "created_at":"timestamp", "updated_at":"timestamp" },
  document_index_quality: { "document_id":"uuid", "owner_id":"uuid?", "quality_score":"number", "extraction_quality":"text", "anchor_coverage":"number?", "model_fallback_rate":"number?", "noisy_unit_rate":"number?", "retrievable_visual_hit":"boolean?", "source_span_coverage":"number?", "typed_unit_coverage":"number?", "metrics":"json", "issues":"texts", "updated_at":"timestamp" },
  ingestion_jobs: { "id":"uuid", "document_id":"uuid", "batch_id":"uuid?", "status":"text", "stage":"text", "progress":"integer", "error_message":"text?", "attempt_count":"integer", "max_attempts":"integer", "locked_at":"timestamp?", "locked_by":"text?", "next_run_at":"timestamp?", "started_at":"timestamp?", "completed_at":"timestamp?", "created_at":"timestamp", "updated_at":"timestamp", "lease_token":"uuid?", "lease_expected_generation_id":"uuid?", "lease_write_generation_id":"uuid?", "lease_authority_digest":"text?", "lease_expires_at":"timestamp?", "lease_duration_seconds":"integer?", "operation":"text", "requested_generation_id":"uuid?", "shadow_plan_digest":"text?" },
  indexing_v3_agent_jobs: { "id":"uuid", "document_id":"uuid", "status":"text", "enrichment_status":"text", "attempt_count":"integer", "max_attempts":"integer", "locked_by":"text?", "locked_at":"timestamp?", "next_run_at":"timestamp?", "version":"text", "last_error":"text?", "metadata":"json", "created_at":"timestamp", "updated_at":"timestamp", "lease_token":"uuid?", "lease_expected_generation_id":"uuid?", "lease_write_generation_id":"uuid?", "lease_authority_digest":"text?", "lease_expires_at":"timestamp?", "lease_duration_seconds":"integer?" },
  ingestion_job_stages: { "id":"uuid", "job_id":"uuid", "document_id":"uuid", "stage_name":"text", "stage_status":"text", "error_class":"text?", "retry_count":"integer", "metadata":"json", "artifact_counts":"json", "error_message":"text?", "started_at":"timestamp", "finished_at":"timestamp?", "created_at":"timestamp", "job_kind":"text?", "lease_token":"uuid?", "index_generation_id":"uuid?" },
  import_batches: { "id":"uuid", "owner_id":"uuid?", "name":"text", "source_root":"text?", "include_glob":"text", "status":"text", "total_files":"integer", "queued_files":"integer", "skipped_files":"integer", "failed_files":"integer", "total_bytes":"integer", "metadata":"json", "completed_at":"timestamp?", "created_at":"timestamp", "updated_at":"timestamp" },
  rag_aliases: { "id":"uuid", "owner_id":"uuid?", "alias":"text", "canonical":"text", "alias_type":"text", "weight":"number", "enabled":"boolean", "metadata":"json", "created_at":"timestamp", "updated_at":"timestamp" },
  document_title_words: { "word":"text", "document_id":"uuid" },
  public_source_versions: { "id":"uuid", "source_catalogue_key":"text", "source_policy_version":"text", "source_policy_digest":"text", "exact_canonical_url":"text", "exact_version_url":"text", "exact_version":"text", "content_hash":"text", "staged_content_hash":"text", "retrieved_at":"timestamp", "licence_evidence_digest":"text", "staging_document_id":"uuid", "extraction_generation_id":"uuid?", "index_generation_id":"uuid?", "lifecycle":"text", "acquisition_identity_digest":"text?", "supersedes_version_id":"uuid?", "activation_event_id":"uuid", "staging_owner_id":"uuid", "publication_approval_id":"uuid?", "publication_manifest_digest":"text?", "publication_reviewed_state_digest":"text?", "publication_reviewed_index_generation_id":"uuid?", "created_at":"timestamp", "updated_at":"timestamp" },
  public_source_activation_events: { "id":"uuid", "source_catalogue_key":"text", "source_policy_version":"text", "source_policy_digest":"text", "decision":"text", "operator_id":"uuid", "reason":"text", "evidence_references":"texts", "source_sequence":"integer", "created_at":"timestamp" },
  public_source_serving_authority: { "singleton":"boolean", "lifecycle_epoch":"integer", "updated_at":"timestamp" },
  document_publication_approvals: { "id":"uuid", "document_id":"uuid", "expected_prior_owner_id":"uuid", "approving_operator_id":"uuid", "decision":"text", "reason":"text", "evidence_references":"texts", "manifest_digest":"text", "reviewed_state_digest":"text?", "approved_at":"timestamp", "source_catalogue_key":"text?", "source_policy_version":"text?", "reviewed_index_generation_id":"uuid?" },
  shadow_reindex_waves: { "candidate_generation_id":"uuid", "plan_digest":"text", "plan_version":"integer", "project_ref":"text", "source_policy_version":"text", "audit_digest":"text", "population_fingerprint":"text", "recovery_evidence_digest":"text", "baseline_evaluation_digest":"text", "operation_manifest_digest":"text", "plan_payload":"json", "created_at":"timestamp", "prepared_origin_digest":"text", "execution_profile_digest":"text", "case_set_digest":"text", "baseline_report":"json", "baseline_report_digest":"text" },
  document_index_generations: { "document_id":"uuid", "index_generation_id":"uuid", "owner_id":"uuid?", "baseline_generation_id":"uuid?", "expected_state_digest":"text", "authority_digest":"text", "source_binding":"json", "job_id":"uuid", "first_lease_token":"uuid?", "claimed_at":"timestamp?", "state":"text", "expected_inventory_digest":"text?", "inventory_digest":"text?", "candidate_projection_digest":"text?", "baseline_bundle_digest":"text", "stage_receipt":"json?", "stage_receipt_digest":"text?", "staged_at":"timestamp?", "control_revision":"integer", "control_snapshot":"json", "original_origin_envelope":"json", "inventory_manifest":"json" },
  document_generation_projections: { "document_id":"uuid", "index_generation_id":"uuid", "lease_token":"uuid", "owner_id":"uuid?", "summary":"json?", "generated_labels":"json?", "summary_projection_complete":"boolean?", "enrichment_metadata":"json?", "quality":"json?", "worker_metadata":"json?", "document_counts":"json?", "deep_memory_artifact_generation_id":"uuid?", "deep_memory_receipt":"json?", "deep_memory_metadata":"json?", "producer_aliases":"json?", "summary_digest":"text?", "quality_digest":"text?", "deep_memory_digest":"text?", "worker_state_digest":"text?", "sealed_at":"timestamp?" },
  document_generation_inventory: { "document_id":"uuid", "index_generation_id":"uuid", "family":"text", "unit_key":"text", "lease_token":"uuid", "expected":"boolean", "required":"boolean", "disposition":"text", "reason_code":"text?", "limitations":"json", "producer":"text", "artifact_generation_id":"uuid?", "artifact_ref":"json?", "content_digest":"text?", "source_binding":"json", "relationships":"json", "retained_evidence_text":"text?", "retained_native_payload":"text?", "representation_version":"text?", "transform_version":"text?" },
  document_generation_baselines: { "document_id":"uuid", "candidate_generation_id":"uuid", "baseline_generation_id":"uuid?", "expected_state_digest":"text", "bundle_version":"integer", "bundle_payload":"json", "bundle_digest":"text", "captured_at":"timestamp" },
} as const;
type AuditTable = keyof typeof auditStoredColumns;
type AuditRow = { table: AuditTable; envelope: ShadowRawEnvelope; row: { [key: string]: AuditJson } };
const auditOwnerTable = {
  page: "document_pages", chunk: "document_chunks", image: "document_images", table_fact: "document_table_facts",
  embedding_field: "document_embedding_fields", index_unit: "document_index_units", section: "document_sections",
  memory_card: "document_memory_cards", summary: "document_summaries", label: "document_labels", quality: "document_index_quality",
  document: "documents", alias: "rag_aliases", node_job: "ingestion_jobs", edge_job: "indexing_v3_agent_jobs",
  job_stage: "ingestion_job_stages", import_batch: "import_batches",
} as const;
const auditTableFamily: Partial<Record<AuditTable, InventoryFamily>> = {
  document_pages: "pages", document_chunks: "chunks", document_images: "images", document_table_facts: "table_facts",
  document_embedding_fields: "embedding_fields", document_index_units: "index_units", document_sections: "sections",
  document_memory_cards: "memory_cards", document_summaries: "summary", document_labels: "generated_labels",
  document_index_quality: "quality", documents: "document_metadata", rag_aliases: "producer_aliases",
};
function auditSqlTimestamp(value: unknown) {
  const text = stringValue(value);
  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(text) || /\n|\r/.test(text)) invalidComparison();
  return text; // Never truncate a stored timestamp through Date.
}
function auditStoredRowSchema(table: AuditTable) {
  const shape: Shape = {};
  for (const [key, description] of Object.entries(auditStoredColumns[table])) {
    const optionalNull = description.endsWith("?");
    const kind = optionalNull ? description.slice(0, -1) : description;
    const schema = ({ uuid: uuidValue, uuids: list(uuidValue), texts: list(stringValue), text: stringValue,
      timestamp: auditSqlTimestamp, integer: boundedNumber(-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, true),
      number: numberValue, boolean: booleanValue, json: auditJson, vector: stringValue } as Record<string, Schema<unknown>>)[kind];
    if (!schema) invalidComparison();
    shape[key] = table==="ingestion_jobs"&&key==="shadow_plan_digest" ? nullable(digestValue) : optionalNull ? nullable(schema) : schema;
  }
  return record(shape);
}
function auditStoredRow(table: AuditTable, value: unknown): AuditRow {
  const parsed = auditEnvelope(value, "baseline", auditStoredRowSchema(table), "pg-jsonb-text-v1");
  // The original SQL text remains authoritative. Refuse a decimal that native JSON would round.
  decodeStrictJson(parsed.envelope.canonicalPayload, false, false, true);
  return { table, envelope: parsed.envelope, row: parsed.payload as { [key: string]: AuditJson } };
}
function auditRowKey(entry: Immutable<AuditRow>): readonly ImmutableJson[] {
  const keys: Partial<Record<AuditTable, readonly string[]>> = {
    document_index_quality: ["document_id"], document_title_words: ["word", "document_id"],
    public_source_serving_authority: ["singleton"], shadow_reindex_waves: ["candidate_generation_id"],
    document_index_generations: ["document_id", "index_generation_id"], document_generation_projections: ["document_id", "index_generation_id"],
    document_generation_inventory: ["document_id", "index_generation_id", "family", "unit_key"],
    document_generation_baselines: ["document_id", "candidate_generation_id"],
  };
  return (keys[entry.table] ?? ["id"]).map((key) => entry.row[key]!);
}
function auditOrigin(value: unknown) {
  const shape: Shape = {};
  for (const table of Object.keys(auditStoredColumns) as AuditTable[]) shape[table] = list((row) => auditStoredRow(table, row));
  const origin = auditEnvelope(value, "baseline", record({ kind: choice("u04-origin-snapshot-v1"), evidenceMode: auditMode,
    capturedAt: auditSqlTimestamp, executionProfileEnvelope: auditAnyEnvelope, documentIds: list(uuidValue, 1),
    manualAliasIds: list(uuidValue), sourcePolicyVersion: versionValue, rows: record(shape) }), "pg-jsonb-text-v1");
  const rows = origin.payload.rows as Record<AuditTable, AuditRow[]>;
  for (const entries of Object.values(rows)) {
    sortedUnique(entries, (left, right) => {
      const a = auditRowKey(left); const b = auditRowKey(right);
      for (let index = 0; index < a.length; index += 1) {
        const comparison = compareText(String(a[index]), String(b[index]));
        if (comparison !== 0) return comparison;
      }
      return 0;
    });
  }
  return { ...origin, rows };
}
function auditRowUnit(entry: AuditRow) {
  const family = auditTableFamily[entry.table];
  if (!family) invalidComparison();
  const key = family === "pages" ? String(positiveInteger(entry.row.page_number))
    : ["summary", "quality", "document_metadata"].includes(family) ? "singleton" : uuidValue(entry.row.id);
  return { family, key };
}
function auditUnitKey(unit: ReturnType<typeof inventoryUnit>) { return encodeShadowNodeJsonCanonicalPayload([unit.family, unit.key]); }
function auditUnitOrder(a: ReturnType<typeof inventoryUnit>, b: ReturnType<typeof inventoryUnit>) {
  return compareText(a.family, b.family) || compareText(a.key, b.key);
}
function auditUnits(rows: AuditRow[]) { return rows.map(auditRowUnit).sort(auditUnitOrder); }
function auditGeneration(row: AuditRow): string | null {
  const metadata = Object.hasOwn(row.row, "metadata") ? auditObject(row.row.metadata) : {};
  const marker = Object.hasOwn(metadata, "index_generation_id") ? metadata.index_generation_id : null;
  if (marker !== null) uuidValue(marker);
  const typed = Object.hasOwn(row.row, "index_generation_id") ? nullable(uuidValue)(row.row.index_generation_id) : null;
  if (marker !== null && typed !== null && marker !== typed) invalidComparison();
  if (row.table === "document_pages" && Object.hasOwn(metadata, "index_generation_id") && marker === null) invalidComparison();
  return typed ?? (marker as string | null);
}
function auditSelected(origin: ReturnType<typeof auditOrigin>, source: ReturnType<typeof auditSource>) {
  const selected = {} as Record<AuditTable, AuditRow[]>;
  for (const table of Object.keys(auditStoredColumns) as AuditTable[]) {
    const rows = origin.rows[table].filter((entry) => table === "rag_aliases"
      ? auditObject(entry.row.metadata).document_id === source.documentId
      : entry.row.document_id === source.documentId);
    if (table === "rag_aliases") {
      const producerRows = rows.filter((entry) => auditObject(entry.row.metadata).generated_by === "local-worker");
      if (producerRows.length === 0) { selected[table] = []; continue; }
      const document = origin.rows.documents.find((entry) => entry.row.id === source.documentId);
      if (!document) invalidComparison();
      const current = uuidValue(auditObject(auditObject(document.row.metadata).deep_memory_generations)["local-worker"]);
      selected[table] = producerRows.filter((entry) => auditObject(entry.row.metadata).artifact_generation_id === current);
      continue;
    }
    if (!auditTableFamily[table] || table === "documents") { selected[table] = rows; continue; }
    const active = source.baselineGenerationId;
    const matching = rows.filter((entry) => auditGeneration(entry) === active);
    // Pages choose the whole active set before any window, with genuine typed-null fallback only when absent.
    selected[table] = table === "document_pages" && active !== null && matching.length === 0
      ? rows.filter((entry) => auditGeneration(entry) === null) : matching;
  }
  for (const [table, rows] of Object.entries(selected) as [AuditTable, AuditRow[]][]) {
    if (!auditTableFamily[table]) continue;
    for (const entry of rows) if (Object.hasOwn(entry.row, "owner_id") && entry.row.owner_id !== source.ownerId) invalidComparison();
  }
  return selected;
}
function auditPath(value: unknown, path: readonly (string | number)[]): unknown {
  let current = value;
  for (const part of path) {
    if (current === null || typeof current !== "object" || types.isProxy(current)) invalidComparison();
    if (Array.isArray(current) !== (typeof part === "number")) invalidComparison();
    const descriptor = Object.getOwnPropertyDescriptor(current, part);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) invalidComparison();
    current = descriptor.value;
  }
  return current;
}
function auditResolver(origin: ReturnType<typeof auditOrigin>, input: ReturnType<typeof auditInputTransport>) {
  const payloads = new Map<string, Extract<ReturnType<typeof auditInputTransport>["retainedEvidence"][number], { tag: "payload" }>>();
  const objects = new Map<string, Extract<ReturnType<typeof auditInputTransport>["retainedEvidence"][number], { tag: "private_object" }>>();
  const identities: string[] = [];
  for (const entry of input.retainedEvidence) {
    if (entry.tag === "payload") {
      const digest = entry.envelope.digest;
      if (payloads.has(digest) || Buffer.byteLength(entry.envelope.canonicalPayload, "utf8") !== entry.byteLength) invalidComparison();
      payloads.set(digest, entry); identities.push(`payload/${digest}`);
    } else {
      const bytes = Buffer.from(entry.bytes.content, "base64");
      if (bytes.toString("base64") !== entry.bytes.content || bytes.length !== entry.ref.byteLength ||
        `sha256:${createHash("sha256").update(bytes).digest("hex")}` !== entry.ref.sha256) invalidComparison();
      const key = encodeShadowNodeJsonCanonicalPayload(entry.ref);
      if (objects.has(key)) invalidComparison();
      objects.set(key, entry); identities.push(`private_object/${key}`);
    }
  }
  sortedUnique(identities, compareText);
  function resolve(pointer: ReturnType<typeof inventoryPointer>): unknown {
    const ref = pointer.ref;
    if (ref.tag === "origin_row") {
      const table = auditOwnerTable[ref.owner];
      const key = ref.owner === "quality" ? "document_id" : "id";
      const rows = origin.rows[table].filter((entry) => entry.row[key] === ref.rowId && entry.envelope.digest === ref.rowDigest);
      if (rows.length !== 1) invalidComparison();
      return auditPath(rows[0]!.row, pointer.path);
    }
    if (ref.tag === "retained_payload") {
      const entry = payloads.get(ref.envelopeDigest);
      if (!entry || entry.representation !== ref.representation || entry.mediaType !== ref.mediaType || entry.byteLength !== ref.byteLength) invalidComparison();
      if (ref.representation === "producer_text" || ref.representation === "producer_bytes") {
        if (pointer.path.length !== 0) invalidComparison();
        return entry.envelope.canonicalPayload;
      }
      return auditPath(decodeStrictJson(entry.envelope.canonicalPayload, entry.envelope.encoding === "node-json-v1"), pointer.path);
    }
    if (ref.tag === "private_object") {
      const entry = objects.get(encodeShadowNodeJsonCanonicalPayload(ref));
      if (!entry || pointer.path.length !== 0) invalidComparison();
      return entry.bytes.content;
    }
    return invalidComparison(); // Fresh-origin mapping never adopts candidate projections or rows.
  }
  function evidence(pointers: readonly ReturnType<typeof inventoryPointer>[]) { return pointers.map(resolve); }
  const document = (documentId: string) => origin.rows.documents.find((entry) => entry.row.id === documentId);
  return { resolve, evidence, payloads, objects, document };
}
// Full returned-output shapes mirror src/lib/types.ts; only its explicit JSON/telemetry dictionaries are open.
function auditFieldsOf<const K extends readonly string[], T>(keys: K, schema: Schema<T>): { [P in K[number]]: Schema<T> } {
  return Object.fromEntries(keys.map((key) => [key, schema])) as { [P in K[number]]: Schema<T> };
}
function auditDictionary<T>(schema: Schema<T>): Schema<Record<string, T>> {
  return (input) => {
    const object = auditObject(input); const result: Record<string, T> = Object.create(null);
    for (const [key, value] of Object.entries(object)) result[key] = schema(value);
    return result;
  };
}
const auditStrings = list(stringValue);
const auditNumbers = list(numberValue);
const auditSourceRole = choice("local_guideline", "clinical_guideline", "clinical_reference", "service_directory", "form_reference",
  "tool_reference", "safety_alert", "regulatory", "quality_standard", "legal", "subsidy", "professional_review", "service_policy", "reference_link");
const auditCorpus = choice("uploaded_local", "clinical_kb_site", "australian_public", "international_supplementary");
const auditSiteDomain = choice("services", "forms", "medications", "differentials", "specifiers", "dsm", "formulation", "therapies", "dictionary", "factsheets", "calculators", "tools");
const auditStrength = choice("strong", "moderate", "limited");
const auditImageType = choice("clinical_table", "flowchart_algorithm", "form_checklist", "risk_matrix", "medication_chart", "graph", "screenshot_ui", "cover_page", "photo", "logo_decorative", "unclear");
const auditExtractionQuality = choice("good", "partial", "poor", "unknown");
const auditDocumentStatus = choice("current", "review_due", "outdated", "unknown");
const auditSourceMetadata = (value: unknown) => {
  const metadata = auditObject(value);
  const known: Shape = {
    ...auditFieldsOf(["source_kind", "registry_record_kind", "registry_record_subkind", "registry_record_id", "registry_record_slug",
      "source_title", "publisher", "publisher_code", "jurisdiction", "version", "publication_date", "review_date", "uploaded_at", "indexed_at",
      "uploaded_by", "source_catalogue_key", "source_policy_version", "canonical_url", "effective_date", "expiry_date", "supersedes_document_id",
      "superseded_by_document_id", "retrieved_at", "content_hash"], nullable(stringValue)),
    document_status: auditDocumentStatus, clinical_validation_status: choice("unverified", "locally_reviewed", "approved", "unknown"),
    clinical_validation_evidence: nullable(auditObject), extraction_quality: auditExtractionQuality,
    corpus_scope: nullable(auditCorpus), source_role: nullable(auditSourceRole),
    content_mode: nullable(choice("indexed_content", "link_only")),
    licence_policy: nullable(choice("review_required", "public_index_permitted", "metadata_link_only", "index_forbidden")),
    change_state: choice("unchanged", "changed", "withdrawn", "superseded", "unknown"),
  };
  for (const [key, schema] of Object.entries(known)) if (Object.hasOwn(metadata, key)) schema(metadata[key]);
  return metadata; // ClinicalSourceMetadataRecordInput explicitly permits other stored JSON fields.
};
const auditScore = record({
  ...auditFieldsOf(["vectorScore", "textRank", "lexicalCoverageScore", "metadataMatchScore", "sectionTitleMatchBoost", "freshnessRecencyBoost",
    "weightedHybridScore", "rrfBoost", "memoryBoost", "titleBoost", "metadataBoost", "clinicalSignalBoost", "penalty", "rankScore", "finalScore"], numberValue),
  rrfScore: nullable(numberValue), strategy: choice("weighted_hybrid", "weighted_hybrid_rrf_blend"),
}, {
  ...auditFieldsOf(["rawPenalty", "releaseRankScore", "finalRank", "semanticRerankScore", "preClampFinalScore"], numberValue),
  fusionSignals: record(auditFieldsOf(["hybridRelevance", "lexicalCoverage", "reciprocalRankFusion", "titleSectionRelevance", "metadataRelevance", "clinicalEvidence", "fixedAdjustment"], numberValue)),
});
const auditRelevanceFields = { verdict: choice("direct", "partial", "nearby", "none"), label: stringValue, matchedTerms: auditStrings,
  missingTerms: auditStrings, directSourceCount: numberValue, weakSourceCount: numberValue, score: numberValue,
  supportReason: stringValue, isSourceBacked: booleanValue };
const auditRelevance = record(auditRelevanceFields);
const auditSourceRelevance = record({ ...auditRelevanceFields, coverageScore: numberValue, rankScore: numberValue,
  titleMatchedTerms: auditStrings, contentMatchedTerms: auditStrings, metadataMatchedTerms: auditStrings, chips: auditStrings });
const auditLabel = record({ id: stringValue, document_id: stringValue, label: stringValue,
  label_type: choice("site", "topic", "document_type", "medication", "risk", "setting", "workflow", "population", "service", "clinical_action", "care_phase", "document_intent", "content_feature", "custom"),
  source: choice("generated", "manual"), confidence: numberValue,
}, { owner_id: nullable(stringValue), metadata: nullable(auditObject), created_at: stringValue, updated_at: stringValue });
const auditMemory = record({ document_id: stringValue,
  card_type: choice("section_summary", "askable_question", "table_row", "threshold", "medication", "risk", "workflow", "definition", "citation_anchor"),
  title: stringValue, content: stringValue, normalized_terms: auditStrings, page_number: nullable(numberValue),
  source_chunk_ids: auditStrings, source_image_ids: auditStrings, confidence: numberValue,
}, { id: stringValue, owner_id: nullable(stringValue), section_id: nullable(stringValue), index_generation_id: nullable(stringValue),
  producer: nullable(stringValue), artifact_generation_id: nullable(stringValue), metadata: auditObject,
  embedding: auditNumbers, created_at: stringValue, updated_at: stringValue });
const auditImageOptional = {
  image_type: auditImageType, clinical_relevance_score: numberValue, source_kind: nullable(stringValue),
  ...auditFieldsOf(["tableLabel", "tableTitle", "tableRole", "tableTextSnippet", "clinicalUseReason", "accessibleTableMarkdown"], nullable(stringValue)),
  clinicalUseClass: nullable(choice("clinical_evidence", "administrative", "reference", "decorative_or_empty", "ambiguous")),
  tableRows: nullable(list(auditStrings)), tableColumns: nullable(auditStrings), labels: auditStrings,
};
const auditChunkImage = record({ id: stringValue, storage_path: stringValue, caption: stringValue, page_number: nullable(numberValue) },
  { ...auditImageOptional, image_type: stringValue, signed_url: stringValue, bbox: nullable((value: unknown) => {
    const bounds = auditNumbers(value); if (bounds.length !== 4) invalidComparison(); return bounds;
  }), width: nullable(numberValue), height: nullable(numberValue), searchable: booleanValue,
    sourceKind: nullable(stringValue), metadata: nullable(auditObject) });
const auditTableFact = record({ id: stringValue, document_id: stringValue, source_chunk_id: nullable(stringValue), source_image_id: nullable(stringValue),
  page_number: nullable(numberValue), ...auditFieldsOf(["table_title", "row_label", "clinical_parameter", "threshold_value", "action"], nullable(stringValue)),
}, { text_rank: nullable(numberValue), match_reason: nullable(stringValue), metadata: nullable(auditObject) });
const auditIndexMatch = record({ id: stringValue, unit_type: stringValue, title: stringValue, content: stringValue,
  source_chunk_id: nullable(stringValue), source_image_id: nullable(stringValue), page_start: nullable(numberValue), page_end: nullable(numberValue),
  heading_path: auditStrings, normalized_terms: auditStrings, quality_score: nullable(numberValue), extraction_mode: choice("deterministic", "model_heavy", "hybrid"),
}, { source_span: nullable(auditObject), similarity: nullable(numberValue), text_rank: nullable(numberValue), hybrid_score: nullable(numberValue), metadata: nullable(auditObject) });
const auditMatchExplanation = record({ reasons: auditStrings }, {
  ...auditFieldsOf(["titleHit", "labelHit", "sectionHit", "contentHit", "tableHit"], booleanValue),
  indexUnitType: nullable(stringValue), matchedAliases: auditStrings, vectorSimilarity: nullable(numberValue), textRank: nullable(numberValue),
  fieldType: nullable(stringValue), freshness: nullable(auditDocumentStatus), extractionQuality: nullable(auditExtractionQuality),
  indexQualityScore: nullable(numberValue), indexQualityIssues: auditStrings,
});
const auditSearchResult = record({ id: stringValue, document_id: stringValue, title: stringValue, file_name: stringValue,
  page_number: nullable(numberValue), chunk_index: numberValue, section_heading: nullable(stringValue), content: stringValue,
  image_ids: auditStrings, similarity: numberValue, images: list(auditChunkImage),
}, {
  section_path: auditStrings, heading_level: nullable(numberValue), parent_heading: nullable(stringValue), anchor_id: nullable(stringValue),
  retrieval_synopsis: nullable(stringValue), corpus_scope: auditCorpus, site_content_domain: nullable(auditSiteDomain),
  similarity_origin: choice("cosine", "synthetic_text", "document_context"), text_rank: numberValue, hybrid_score: numberValue,
  lexical_score: nullable(numberValue), rrf_score: numberValue, score_explanation: auditScore, source_strength: auditStrength,
  source_metadata: nullable(auditSourceMetadata), document_labels: list(auditLabel), document_summary: nullable(stringValue),
  adjacent_context: nullable(stringValue), memory_cards: list(auditMemory), memory_score: numberValue, relevance: auditSourceRelevance,
  match_explanation: auditMatchExplanation, table_facts: list(auditTableFact), index_unit: nullable(auditIndexMatch),
  indexing_quality: nullable(record({ document_id: stringValue, quality_score: numberValue, extraction_quality: stringValue,
    metrics: auditObject, issues: auditStrings }, { owner_id: nullable(stringValue), updated_at: stringValue })),
});
const auditCitationRequired = { chunk_id: stringValue, document_id: stringValue, title: stringValue, file_name: stringValue,
  page_number: nullable(numberValue), chunk_index: numberValue };
const auditCitationOptional = { similarity: numberValue, source_metadata: nullable(auditSourceMetadata),
  provenance: choice("model_selected", "section_selected", "exact_quote", "deterministic_support", "review_only", "retrieval_only") };
const auditCitation = record(auditCitationRequired, auditCitationOptional);
const auditQuote = record({ ...auditCitationRequired, quote: stringValue, section_heading: nullable(stringValue) },
  { ...auditCitationOptional, source_strength: auditStrength, isTruncated: booleanValue });
const auditVisual = record({ id: stringValue, image_id: stringValue, signed_url_endpoint: stringValue, caption: stringValue,
  document_id: stringValue, title: stringValue, file_name: stringValue, page_number: nullable(numberValue),
  source_chunk_id: stringValue, chunk_index: numberValue, viewer_href: stringValue }, { ...auditImageOptional, relevance: auditSourceRelevance });
const auditBreakdown = record({ document_id: stringValue, title: stringValue, file_name: stringValue, top_similarity: numberValue,
  source_strength: auditStrength, source_count: numberValue, quote_count: numberValue, pages: auditNumbers }, { best_quote: stringValue });
const auditBest = record({ ...auditCitationRequired, source_strength: auditStrength, score: numberValue, snippet: stringValue,
  section_heading: nullable(stringValue), image_count: numberValue, viewer_href: stringValue },
{ ...auditCitationOptional, quote: stringValue, relevance: auditSourceRelevance });
const auditEvidenceSummary = record({ document_count: numberValue, total_sources: numberValue, quote_count: numberValue,
  image_count: numberValue, source_strength: choice("strong", "moderate", "limited", "none"), summary: stringValue });
const auditSourceCoverage = record({ documents_used: numberValue, pages: auditNumbers, strongest_similarity: numberValue, has_images: booleanValue });
const auditGap = record({ type: choice("gap", "conflict"), message: stringValue }, { source_chunk_ids: auditStrings });
const auditRelated = record({ document_id: stringValue, title: stringValue, file_name: stringValue, labels: list(auditLabel),
  summary: nullable(stringValue), best_pages: auditNumbers, best_chunk_ids: auditStrings, image_count: numberValue,
  match_reason: stringValue, score: numberValue }, { table_count: numberValue, cover_image_id: nullable(stringValue) });
const auditPanel = record({ query: stringValue, total_sources: numberValue, documents: list(auditBreakdown), quotes: list(auditQuote),
  visualEvidence: list(auditVisual), image_count: numberValue, evidenceSummary: auditEvidenceSummary,
  sourceCoverage: auditSourceCoverage, conflictsOrGaps: list(auditGap) },
{ bestSource: nullable(auditBest), relatedDocuments: list(auditRelated), relevance: auditRelevance });
const auditQueryAnalysis = record({ originalQuery: stringValue, normalizedQuery: stringValue, queryClass,
  intent: choice("definition", "protocol", "drug_dosing", "escalation_risk", "document_lookup", "comparison", "broad_summary", "general"),
  confidence: numberValue, reasons: auditStrings, canonicalTerms: auditStrings, expandedTerms: auditStrings,
  typoCorrections: list(record({ from: stringValue, to: stringValue })), medications: auditStrings, acronyms: auditStrings,
  thresholdTerms: auditStrings, documentTitleTerms: auditStrings,
  queryRewrite: record({ normalizedQuery: stringValue, searchQuery: stringValue, expansions: auditStrings, reasons: auditStrings }),
  ...auditFieldsOf(["documentTitleIntent", "comparisonIntent", "freshnessNeed", "needsVisualEvidence", "needsSynthesis", "needsClassifierFallback"], booleanValue),
}, { corpusGrounding: choice("in_corpus_topic", "out_of_corpus", "inconclusive") });
const auditProgramme = record({ queryPlanKind: choice("single", "decomposed", "clarification_required"), subquestionCount: numberValue,
  materialAmbiguity: booleanValue, coverageCounts: record(auditFieldsOf(["direct", "partial", "conflicting", "absent"], numberValue)),
  candidateCounts: record(auditFieldsOf(["uploaded_local", "clinical_kb_site", "australian_public", "international_supplementary"], numberValue)),
  selectedCounts: record(auditFieldsOf(["uploaded_local", "clinical_kb_site", "australian_public", "international_supplementary"], numberValue)),
  selectedSiteDomains: list(auditSiteDomain), siteCandidateCount: numberValue, siteSelectedCount: numberValue,
  publicSiteContentState: choice("current", "updating", "stale", "unavailable", "disabled"), siteStaticManifestMatch: nullable(booleanValue),
  sitePendingCount: nullable(numberValue), augmentationOutcome: choice("not_needed", "used", "no_eligible_evidence", "unavailable", "disabled"),
  roleExclusionCount: numberValue,
  insufficiencyReason: nullable(choice("not_in_corpus", "retrieval_miss", "insufficient_claim_support", "source_role_mismatch", "source_conflict", "governance_block", "site_content_updating", "site_content_stale", "site_content_unavailable", "timeout", "provider_failure")),
  generationOutcome: choice("generated", "extractive", "source_only", "failed"), verifiedUnitsEmitted: numberValue, verifiedUnitsDiscarded: numberValue,
  reconciliationOutcome: choice("not_applicable", "matched", "mismatch"),
});
const auditRoute = choice("unsupported", "extractive", "fast", "strong");
const auditAnswerMode = choice("checklist", "comparison_matrix", "threshold_table", "clinical_pathway", "document_lookup", "evidence_gap");
const auditRetrievalIntent = record({
  ...auditFieldsOf(["needsTable", "needsMedicationChart", "needsFlowchartStep", "needsPatientEducation", "needsSourceImage", "needsRiskFlowchart", "needsExactVisualTable", "needsDoseRouteFrequency", "needsComparison"], booleanValue),
  preferredDocumentSignals: auditStrings, requiredTermSignals: auditStrings,
});
const auditSelection = record({ candidateCount: numberValue, selectedCount: numberValue, requiredSignalsSatisfied: booleanValue,
  matchedSignals: auditStrings, missingRequiredSignals: auditStrings, rescueApplied: booleanValue,
  topChunkTypes: record(auditFieldsOf(["text", "table", "flowchart", "medication_chart", "patient_education"], numberValue)) });
const auditSmartApi = record({ query: stringValue, queryClass,
  intent: choice("find_document", "find_threshold_or_table", "medication_or_risk_answer", "compare_sources", "summarize_sources", "general_or_unsupported"),
  responseMode: choice("document_lookup", "extractive_answer", "fast_grounded_answer", "strong_synthesis", "multi_document_synthesis", "unsupported"),
  retrievalStrategy: choice("search_cache", "text_fast_path", "document_lookup_fast_path", "hybrid", "vector_fallback", "unsupported_short_circuit", "unknown"),
  latencyPlan: choice("cache_or_text_first", "balanced_hybrid", "strong_generation", "no_supported_answer"), answerFocus: stringValue,
  answerPlan: record({ intent: choice("clinical_synthesis", "source_lookup", "document_lookup", "unsupported"), queryClass, routeMode: auditRoute,
    modelStrategy: choice("fast_model_then_quality_gate", "strong_model_then_quality_gate", "extractive_lookup", "source_gap"),
    retrievalQuality: choice("strong", "partial", "weak", "conflicting"), retrievalIntent: auditRetrievalIntent, sourceSelection: auditSelection,
    qualityCriteria: auditStrings, fallbackBehavior: choice("retry_strong_then_source_gap", "source_gap", "extractive_lookup_only"),
    sourcePolicy: choice("required_citations", "nearby_sources_allowed", "exact_source_links") }),
  displayMode: auditAnswerMode, sourceLinkCount: numberValue, coreSourceLinks: list(record({ id: stringValue, label: stringValue,
    href: stringValue, document_id: stringValue, chunk_id: stringValue, title: stringValue, file_name: stringValue,
    page_number: nullable(numberValue), source_strength: auditStrength, reason: stringValue, snippet: stringValue })), streamPlan: auditStrings,
});
const auditLatency = record({}, {
  ...auditFieldsOf(["search_cache_hit", "shared_cache_hit", "embedding_skipped", "embedding_cache_hit", "embedding_prefetched", "second_stage_rerank_used", "route_deadline_exceeded", "route_budget_exhausted_by_retrieval"], booleanValue),
  ...auditFieldsOf(["text_fast_path_latency_ms", "text_candidate_budget", "text_candidate_count", "embedding_latency_ms", "vector_candidate_count", "embedding_field_count", "retrieval_query_variant_count", "supabase_rpc_latency_ms", "rerank_latency_ms", "second_stage_rerank_latency_ms", "context_pack_latency_ms", "context_pack_cache_hits", "answer_retry_count", "pre_retrieval_latency_ms", "retrieval_latency_ms", "routing_latency_ms", "search_latency_ms", "generation_latency_ms", "verification_latency_ms", "route_budget_ms", "total_latency_ms"], numberValue),
  shared_cache_status: choice("hit", "miss"), shared_cache_miss_reason: nullable(stringValue), text_fast_path_reason: nullable(stringValue),
  embedding_skip_reason: nullable(stringValue), answer_retry_reasons: auditStrings,
});
const auditAnswer = record({ answer: stringValue, grounded: booleanValue, confidence: choice("high", "medium", "low", "unsupported"),
  citations: list(auditCitation), sources: list(auditSearchResult) }, {
  interactionId: stringValue, feedbackToken: stringValue,
  supportedClaims: list(record({ claimId: stringValue, text: stringValue, riskClass: choice("routine", "high_risk"),
    supportingChunkIds: auditStrings, supportStatus: choice("direct", "partial", "unsupported") })),
  evidenceAssessments: auditDictionary(record({ relevance: choice("direct", "partial", "nearby", "none"), claimSupport: choice("direct", "partial", "unsupported"),
    authority: choice("approved", "locally_reviewed", "unverified"), currency: choice("current", "review_due", "outdated", "unknown"), extractionQuality: auditExtractionQuality })),
  retrievalDiagnostics: record({ ...auditFieldsOf(["candidateCount", "retrievalDepth", "distinctDocumentCount", "topScore", "secondScore", "scoreSpread"], numberValue),
    gateStatus: choice("passed", "blocked") }, { queryClass, routeMode: auditRoute, fallbackReason: nullable(stringValue), retrievalReason: nullable(stringValue) }),
  programmeDiagnostics: auditProgramme, modelUsed: nullable(stringValue), routingMode: auditRoute, routingReason: stringValue,
  providerMode: choice("auto", "openai", "offline"), answerQualityTier: choice("model_synthesis", "source_only", "cached"), fallbackReason: nullable(stringValue),
  degradedMode: record({ active: booleanValue }, { reason: nullable(stringValue) }), queryClass, queryAnalysis: auditQueryAnalysis,
  responseMode: auditAnswerMode, comparisonEvaluationState: choice("evaluated", "not_evaluated"),
  comparisonMatrix: record({ documents: list(record({ documentId: stringValue, title: stringValue, fileName: stringValue })),
    rows: list(record({ parameter: stringValue, entries: list(record({ documentId: stringValue, chunkIds: auditStrings,
      value: nullable(stringValue), qualifiers: auditStrings })), status: choice("agreement", "conflict", "missing") })) }),
  preformatted: booleanValue, latencyTimings: auditLatency, openAIRequestIds: auditStrings,
  openAIUsage: record({}, auditFieldsOf(["input_tokens", "output_tokens", "total_tokens", "cached_input_tokens", "cache_write_tokens", "reasoning_output_tokens"], numberValue)),
  answerSections: list(record({ heading: stringValue, body: stringValue, citation_chunk_ids: auditStrings }, {
    kind: choice("bottom_line", "required_actions", "monitoring_timing", "medication_dose", "thresholds", "escalation_risk", "contraindications_cautions", "comparison", "documentation", "source_gap", "visual_evidence", "quotes", "verification"),
    supportLevel: choice("direct", "partial", "nearby", "unsupported") })),
  evidenceSummary: auditEvidenceSummary, conflictsOrGaps: list(auditGap), sourceCoverage: auditSourceCoverage, quoteCards: list(auditQuote),
  visualEvidence: list(auditVisual), bestSource: nullable(auditBest), documentBreakdown: list(auditBreakdown), smartPanel: auditPanel,
  relatedDocuments: list(auditRelated), relevance: auditRelevance, memoryCardsUsed: list(auditMemory), indexingVersion: nullable(choice("rag-universal-v1", "rag-deep-memory-v1")),
  indexingQuality: record({}, { indexingVersion: nullable(choice("rag-universal-v1", "rag-deep-memory-v1")), memoryVersion: nullable(choice("rag-universal-v1", "rag-deep-memory-v1")),
    extractionQuality: auditExtractionQuality, ...auditFieldsOf(["sectionCount", "memoryCardCount", "missingEmbeddings", "qualityScore"], numberValue), qualityIssues: auditStrings, stale: booleanValue }),
  smartApiPlan: auditSmartApi, scoreExplanations: list(record({ chunk_id: stringValue, document_id: stringValue, finalScore: numberValue }, { score_explanation: auditScore })),
  scope: record({ summary: stringValue, activeFilterCount: numberValue, matchedDocumentCount: nullable(numberValue), warnings: auditStrings }, {
    queryMode: choice("auto", "monitoring_schedule", "dose_threshold_lookup", "contraindications_cautions", "escalation_criteria", "required_documentation", "compare_guidance"),
    retrieval: nullable(record({ degraded: publicTrue, reason: stringValue })) }),
  sourceGovernanceWarnings: list(record({ code: choice("outdated_source", "review_due_source", "non_local_source", "unverified_source", "poor_extraction", "partial_extraction", "low_index_quality", "weak_evidence", "weak_table_extraction", "registry_record_source"),
    severity: choice("info", "warning", "danger"), message: stringValue }, { uiToken: choice("destructive", "warning", "caution", "neutral", "muted"), document_id: stringValue, title: stringValue })),
  safetyWarnings: list(record({ id: stringValue, kind: choice("contraindication", "red_flag", "escalation", "dose_limit", "monitoring", "exclusion", "caveat"),
    label: stringValue, text: stringValue, citation: auditCitation, href: stringValue })), truncated: booleanValue, truncationReason: stringValue,
  unverifiedNumericTokens: auditStrings, faithfulnessWarning: stringValue,
});
function auditPgText(value: AuditJson): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    const text = String(numberValue(value));
    if (!/[eE]/.test(text)) return text;
    const [mantissa, exponentText] = text.toLowerCase().split("e");
    const sign = mantissa!.startsWith("-") ? "-" : "";
    const unsigned = mantissa!.replace(/^-/, ""); const [whole, fraction = ""] = unsigned.split(".");
    const digits = whole! + fraction; const point = whole!.length + Number(exponentText);
    return sign + (point <= 0 ? `0.${"0".repeat(-point)}${digits}` : point >= digits.length
      ? digits + "0".repeat(point - digits.length) : `${digits.slice(0, point)}.${digits.slice(point)}`);
  }
  if (Array.isArray(value)) return `[${value.map(auditPgText).join(", ")}]`;
  const keys = Object.keys(value).sort((a, b) => Buffer.byteLength(a, "utf8") - Buffer.byteLength(b, "utf8") || Buffer.compare(Buffer.from(a), Buffer.from(b)));
  return `{${keys.map((key) => `${JSON.stringify(key)}: ${auditPgText(value[key]!)}`).join(", ")}}`;
}
function auditRawDigest(text: string) { return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`; }
function auditSourceAuthority(origin: ReturnType<typeof auditOrigin>, source: ReturnType<typeof auditSource>, profile: ReturnType<typeof parseShadowExecutionProfileEnvelope>) {
  const documents = origin.rows.documents.filter((entry) => entry.row.id === source.documentId);
  if (documents.length !== 1) invalidComparison();
  const document = documents[0]!; const row = document.row; const metadata = auditObject(row.metadata);
  const get = (key: string) => metadata[key] ?? null;
  const text = (key: string): string | null => {
    const value = get(key);
    return value === null ? null : typeof value === "string" ? value : auditPgText(value);
  };
  if (row.owner_id !== source.ownerId || row.content_hash !== source.contentHash || source.originDigest !== origin.envelope.digest ||
    source.executionProfileDigest !== profile.bytes.envelope.digest || source.sourcePolicyVersion !== profile.payload.sourcePolicyVersion) invalidComparison();
  auditEqual(source.manualAliasIds, profile.payload.manualAliasIds);
  const access = profile.payload.access;
  if (source.ownerId === null ? !access.includePublic : access.mode !== "owner" || source.ownerId !== access.ownerId) invalidComparison();
  const markerPresent = Object.hasOwn(metadata, "index_generation_id");
  const marker = markerPresent ? uuidValue(metadata.index_generation_id) : null;
  if (row.index_generation_id !== marker || source.baselineGenerationId !== marker) invalidComparison();
  const versions = origin.rows.public_source_versions.filter((entry) => entry.row.staging_document_id === source.documentId);
  let authority: AuditJson;
  if (source.source.tag === "document_owned") {
    if (versions.length !== 0 || get("corpus_scope") === "australian_public") invalidComparison();
    for (const key of ["source_catalogue_key", "source_policy_version", "source_policy_digest", "source_activation_event_id", "source_canonical_url",
      "source_exact_url", "source_exact_version", "source_content_hash", "licence_evidence_digest", "public_source_lifecycle"]) {
      if (Object.hasOwn(metadata, key)) invalidComparison();
    }
    authority = { owner: row.owner_id!, source: row.source_path!, storage: row.storage_path!, file: row.file_name!, file_type: row.file_type!,
      file_size: row.file_size!, content_hash: row.content_hash!, corpus_scope: get("corpus_scope"), content_mode: get("content_mode"),
      licence_policy: get("licence_policy"), source_policy_checked: get("source_policy_checked"), content_identity_verdict: get("content_identity_verdict"),
      content_identity_hash: get("content_identity_hash"), content_identity_verdict_version: get("content_identity_verdict_version"),
      canonical_storage_path: get("canonical_storage_path"), public_corpus: get("public_corpus") };
  } else {
    if (versions.length !== 1) invalidComparison();
    const version = versions[0]!.row;
    const sourceRoute = source.source;
    const events = origin.rows.public_source_activation_events.filter((entry) => entry.row.source_catalogue_key === sourceRoute.sourceCatalogueKey)
      .sort((a, b) => numberValue(b.row.source_sequence) - numberValue(a.row.source_sequence));
    if (events.length === 0) invalidComparison();
    const event = events[0]!.row;
    if (version.id !== sourceRoute.sourceVersionId || version.source_catalogue_key !== sourceRoute.sourceCatalogueKey ||
      metadata.source_catalogue_key !== sourceRoute.sourceCatalogueKey || event.id !== sourceRoute.activationEventId || event.decision !== "activate" ||
      version.activation_event_id !== event.id || !["shadow", "approved"].includes(stringValue(version.lifecycle)) ||
      version.source_policy_version !== event.source_policy_version || version.source_policy_digest !== event.source_policy_digest ||
      version.source_policy_version !== source.sourcePolicyVersion) invalidComparison();
    for (const [key, expected] of Object.entries({ source_policy_version: version.source_policy_version, source_policy_digest: version.source_policy_digest,
      source_activation_event_id: event.id, source_canonical_url: version.exact_canonical_url, source_exact_url: version.exact_version_url,
      source_exact_version: version.exact_version, source_content_hash: version.content_hash, content_hash: version.staged_content_hash,
      licence_evidence_digest: version.licence_evidence_digest, content_identity_verdict: "clear", content_identity_hash: version.staged_content_hash,
      content_identity_verdict_version: "public-source-content-identity-v1" })) auditEqual(text(key), expected);
    const acquisition: { [key: string]: AuditJson } = {};
    for (const key of ["source_catalogue_key", "source_policy_version", "source_policy_digest", "activation_event_id", "exact_canonical_url",
      "exact_version_url", "exact_version", "content_hash", "staged_content_hash", "licence_evidence_digest", "staging_owner_id", "supersedes_version_id"]) acquisition[key] = version[key]!;
    Object.assign(acquisition, { document_id: row.id!, document_owner_id: row.owner_id!, source_path: row.source_path!, storage_path: row.storage_path!,
      document_content_hash: row.content_hash!, file_type: row.file_type!, file_size: row.file_size!, target_lifecycle: "shadow" });
    for (const key of ["corpus_scope", "content_mode", "licence_policy", "source_policy_checked", "public_source_lifecycle", "source_content_type",
      "source_content_byte_length", "source_content_provenance", "content_identity_verdict", "content_identity_hash", "content_identity_verdict_version", "canonical_storage_path"]) acquisition[key] = text(key);
    const acquisitionDigest = auditRawDigest(auditPgText(acquisition));
    if (version.acquisition_identity_digest !== acquisitionDigest) invalidComparison();
    authority = { acquisition: acquisitionDigest, version: version.id!, lifecycle: version.lifecycle!, event: event.id!,
      sequence: event.source_sequence!, decision: event.decision!, policy: event.source_policy_version!, policy_digest: event.source_policy_digest! };
  }
  if (auditRawDigest(auditPgText(authority)) !== source.authorityDigest) invalidComparison();
  return { document, metadata };
}
function auditPolicies(source: ReturnType<typeof auditSource>, resolver: ReturnType<typeof auditResolver>,
  profile: ReturnType<typeof parseShadowExecutionProfileEnvelope>, admission: ReturnType<typeof auditAdmission>) {
  auditEqual(admission.documentPolicyBindings, profile.payload.documentOwnedPolicies);
  if (source.source.tag !== "document_owned") return;
  const binding = admission.documentPolicyBindings.find((entry) => entry.documentId === source.documentId);
  if (!binding || binding.ownerId !== source.ownerId || binding.contentHash !== source.contentHash || binding.sourcePolicyVersion !== source.sourcePolicyVersion) invalidComparison();
  function artifact<T>(identity: ReturnType<typeof policyArtifact>, schema: Schema<T>) {
    const retained = resolver.payloads.get(identity.retainedEnvelopeDigest);
    if (!retained || retained.representation !== "producer_json" || auditRawDigest(retained.envelope.canonicalPayload) !== identity.digest) invalidComparison();
    return auditEnvelope(retained.envelope, "u04-retained-evidence-v1", schema).payload;
  }
  const policy = artifact(binding.policyArtifact, auditDocumentPolicy);
  const review = artifact(binding.reviewArtifact, auditPolicyReview);
  auditEqual(policy.members, review.members); auditEqual(review.policyArtifact, binding.policyArtifact);
  const members = admission.documentPolicyBindings.filter((entry) =>
    entry.policyArtifact.retainedEnvelopeDigest === binding.policyArtifact.retainedEnvelopeDigest)
    .map(({ documentId, ownerId, contentHash }) => ({ documentId, ownerId, contentHash }));
  sortedUnique(policy.members, (a, b) => compareText(a.documentId, b.documentId));
  auditEqual(policy.members, members);
  if (policy.sourcePolicyVersion !== source.sourcePolicyVersion || review.sourcePolicyVersion !== source.sourcePolicyVersion ||
    policy.evidenceMode !== admission.evidenceMode || review.evidenceMode !== admission.evidenceMode) invalidComparison();
}
const auditGoldenResult = record({
  id: stringValue, query: stringValue, forceEmbedding: booleanValue, expectedQueryClass: stringValue, actualQueryClass: nullable(stringValue),
  expectedDocumentSubstrings: auditStrings, missingDocumentSubstrings: auditStrings, expectedContentTerms: auditStrings, missingContentTerms: auditStrings,
  ...auditFieldsOf(["documentRecallAt5", "contentRecallAt5", "topK", "reciprocalRankAt10", "contentReciprocalRankAt10", "declaredSignalCount", "ndcgAt10", "irrelevantSourceRateAt10", "requiredSignalCoverageAt10", "latencyMs", "resultCount"], numberValue),
  hitAtK: booleanValue, retrievalStrategy: nullable(stringValue), retrievalPlan: nullable(stringValue), embeddingSkipped: booleanValue,
  embeddingSkipReason: nullable(stringValue), textFastPathReason: nullable(stringValue), textCandidateBudget: nullable(numberValue),
  textCandidateCount: nullable(numberValue), vectorCandidateCount: nullable(numberValue), secondStageRerankUsed: booleanValue,
  tableEvidenceFound: booleanValue, failures: auditStrings,
  topResults: list(record({ rank: numberValue, title: stringValue, file_name: stringValue, chunk_id: stringValue, page_number: nullable(numberValue),
    hybrid_score: nullable(numberValue), similarity: numberValue, text_rank: nullable(numberValue), rrf_score: nullable(numberValue),
    relevanceGrade: nullable(numberValue), matchedDeclaredSignals: auditStrings, content_preview: stringValue }, {
      ...auditFieldsOf(["document_status", "clinical_validation_status", "clinical_validation_evidence_status", "clinical_validation_evidence_basis",
        "clinical_validation_evidence_type", "extraction_quality", "publisher_code", "jurisdiction"], nullable(stringValue)), score_explanation: auditScore,
    })),
}, { searchTotalLatencyMs: numberValue, retrievalPhaseLatenciesMs: auditDictionary(numberValue),
  retrievalLayerCounts: auditDictionary(numberValue), retrievalLayerTopScores: auditDictionary(numberValue), retrievalLayerLatenciesMs: auditDictionary(numberValue),
  coverageGateDecision: nullable(stringValue), coverageGateReason: nullable(stringValue), vectorSkippedReason: nullable(stringValue),
  sourceImageRequired: booleanValue, sourceImageSatisfied: booleanValue, timedOut: booleanValue, latencyFailures: auditStrings });
const auditQualityResult = record({
  id: stringValue, question: stringValue, category: choice("routine", "complex", "unsupported"),
  supported: booleanValue, expectedFiles: auditStrings, matchedFiles: auditStrings, missingFiles: auditStrings, topFiles: auditStrings,
  expectedHit: booleanValue, grounded: booleanValue, latencyMs: numberValue, route: stringValue, latencyRoute: stringValue, model: nullable(stringValue),
  citations: numberValue, visualEvidence: numberValue, failures: auditStrings, sourceWarningCount: numberValue, sourceDangerWarningCount: numberValue,
  unverifiedNumericTokenCount: numberValue, hasFaithfulnessWarning: booleanValue, executionType: choice("cached", "api", "rule-based"), estimatedCostUsd: nullable(numberValue),
}, { acceptSourceOnly: booleanValue, ...auditFieldsOf(["searchLatencyMs", "generationLatencyMs", "rpcLatencyMs", "embeddingLatencyMs"], numberValue),
  routingReason: stringValue, timings: record({ ...auditFieldsOf(["retrievalMs", "routingMs", "generationMs", "verificationMs", "totalMs", "routeBudgetMs"], numberValue),
    routeDeadlineExceeded: booleanValue }, { budgetExhaustedByRetrieval: booleanValue }), routeCeilingExceeded: booleanValue,
  openAIRequestIds: auditStrings, openAIUsage: record({ inputTokens: numberValue, cachedInputTokens: numberValue, outputTokens: numberValue }) });
const auditFailureCategories = ["query_class", "expected_source", "expected_content", "table_evidence", "grounding", "unsupported_correctness",
  "citation", "visual_evidence", "latency", "numeric_grounding", "source_governance", "other"] as const;
const auditFailureCounts = record({}, auditFieldsOf(auditFailureCategories, nonnegativeInteger));
const auditDebt = (value: unknown) => discriminant(value, "status") === "not_requested"
  ? record({ status: choice("not_requested"), accepted_failures: auditStrings, rejection_reasons: auditStrings })(value)
  : record({ status: choice("accepted", "rejected"), accepted_by: stringValue, accepted_at: stringValue, reason: stringValue,
    accepted_failures: auditStrings, rejection_reasons: auditStrings }, { path: stringValue, expires_at: stringValue })(value);
const auditFullReport = record({
  generated_at: stringValue,
  run_context: record({ git_sha: nullable(stringValue), github_run_id: nullable(stringValue), github_run_attempt: nullable(stringValue), latency_context: stringValue }),
  provider: record({ mode: providerMode, ...auditFieldsOf(["model_case_count", "openai_request_id_count", "token_usage_case_count", "nonzero_cost_case_count", "generation_latency_case_count"], nonnegativeInteger), passed: booleanValue }),
  thresholds: record({ ...auditFieldsOf(["retrievalTopKHitRate", "retrievalDocumentRecallAt5", "retrievalContentRecallAt5", "ragGroundedSupportedRate",
    "ragUnsupportedCorrectRate", "ragCitationFailureRate", "ragSourceBackedReviewFallbackCount", "numericGroundingFailureRate", "staleTopResultRate", "reviewRequiredTopResultRate", "ragP95LatencyMs"], numberValue),
    ragRouteP95LatencyMs: auditDictionary(numberValue) }),
  retrieval: record({
    summary: record({ ...auditFieldsOf(["case_count", "document_recall_at_5", "content_recall_at_5", "top_k_hit_rate", "mrr_at_10", "content_mrr_at_10",
      "content_mrr_case_count", "ndcg_at_10", "irrelevant_source_rate_at_10", "required_signal_coverage_at_10", "signal_metric_case_count", "median_latency_ms",
      "p90_latency_ms", "embedding_skipped_rate", "force_embedding_case_count", "force_embedding_failure_count", "median_text_candidate_budget", "second_stage_rerank_rate"], numberValue),
      ...auditFieldsOf(["retrieval_strategy_counts", "retrieval_plan_counts", "embedding_skip_reason_counts", "text_fast_path_reason_counts", "retrieval_layer_counts"], auditDictionary(numberValue)),
      failed_cases: list(auditGoldenResult), latency_failed_cases: list(auditGoldenResult) }),
    source_governance: record({ ...auditFieldsOf(["total_top_results", "stale_top_results", "review_due_top_results", "unknown_status_top_results", "unverified_top_results", "unknown_extraction_top_results", "poor_extraction_top_results", "stale_rate", "stale_review_unknown_rate", "review_required_top_results", "review_required_rate"], numberValue), metadata_policy: stringValue }),
    failure_category_counts: auditFailureCounts, results: list(auditGoldenResult),
  }),
  rag: record({ summary: record({ ...auditFieldsOf(["case_count", "supported_count", "unsupported_count", "grounded_supported_rate", "unsupported_correct_rate",
    "expected_hit_rate", "citation_failure_rate", "numeric_grounding_failure_rate", "source_warning_count", "source_governance_warning_rate", "source_governance_danger_failure_rate",
    "expected_danger_warning_missing_count", "route_ceiling_failure_count", "generation_fallback_count", "source_backed_review_fallback_count", "source_backed_review_fallback_rate",
    "substantive_grounded_count", "substantive_grounded_rate", "comparison_source_extractive_fallback_count", "median_latency_ms", "p95_latency_ms"], numberValue),
    route_p95_latency_ms: auditDictionary(numberValue), estimated_cost_usd: nullable(numberValue), failure_category_counts: auditFailureCounts,
    failed_cases: list(auditQualityResult) }), results: list(auditQualityResult) }),
  threshold_failures: auditStrings, accepted_threshold_failures: auditStrings, blocking_threshold_failures: auditStrings,
  source_metadata_debt_acceptance: auditDebt,
});
const auditFailureCode = choice("document_not_retrieved", "document_rank_exceeded", "source_role_mismatch", "governance_block", "case_timeout", "provider_failure");
const auditCaseReport = record({ kind: choice("u04-audit-case-results-v1"), evidenceMode: auditMode,
  originDigest: digestValue, executionProfileDigest: digestValue, caseSetDigest: digestValue, configurationDigest: digestValue,
  providerMode, comparisonClock, documentIds: list(uuidValue, 1), manualAliasIds: list(uuidValue), sourceBindings: list(auditSource, 1),
  inputBinding: record({ requestEnvelope: auditAnyEnvelope, authorityEnvelope: auditAnyEnvelope }),
  report: auditFullReport,
  executions: list(record({ kind: choice("retrieval", "quality"), index: nonnegativeInteger, caseId: nonemptyString,
    outcome: choice("complete", "timeout", "provider_failure", "incomplete"), searchResults: list(auditSearchResult), answer: nullable(auditAnswer),
    limitations: list(inventoryLimitation), documentResults: list(record({ documentId: uuidValue, expectedDocumentRank: nullable(positiveInteger),
      actualDocumentRank: nullable(positiveInteger), failureCodes: list(auditFailureCode) })) })),
});
function auditRequireRowEvidence(pointers: readonly ReturnType<typeof inventoryPointer>[], entry: AuditRow, resolver: ReturnType<typeof auditResolver>) {
  resolver.evidence(pointers);
  if (!pointers.some((pointer) => pointer.ref.tag === "origin_row" && auditOwnerTable[pointer.ref.owner] === entry.table &&
    pointer.ref.rowId === (entry.table === "document_index_quality" ? entry.row.document_id : entry.row.id) &&
    pointer.ref.rowDigest === entry.envelope.digest)) invalidComparison();
}
function auditRowFieldValue(pointer: ReturnType<typeof inventoryPointer>, entry: AuditRow,
  paths: readonly (readonly string[])[], value: string, resolver: ReturnType<typeof auditResolver>) {
  const ref = pointer.ref;
  return ref.tag === "origin_row" && auditOwnerTable[ref.owner] === entry.table && ref.rowDigest === entry.envelope.digest &&
    ref.rowId === (entry.table === "document_index_quality" ? entry.row.document_id : entry.row.id) &&
    paths.some((path) => path.length === pointer.path.length && path.every((part, index) => part === pointer.path[index])) &&
    resolver.resolve(pointer) === value;
}
function auditWitnessIdentity(witness: ReturnType<typeof auditWitness>) {
  switch (witness.tag) {
    case "population": return `population/${witness.metric}`;
    case "unit_quality": case "embedding": return `${witness.tag}/${auditUnitKey(witness.unit)}`;
    case "structure": return `structure/${witness.checkId}`;
    case "provenance": return `provenance/${witness.field}`;
    default: return witness.tag;
  }
}
function auditMeasuredDocument(expected: ReturnType<typeof auditExpected>, measured: ReturnType<typeof auditMeasurements>,
  selected: Record<AuditTable, AuditRow[]>, resolver: ReturnType<typeof auditResolver>) {
  const allSlots = [...selected.document_chunks, ...selected.document_embedding_fields, ...selected.document_index_units, ...selected.document_memory_cards]
    .sort((a, b) => auditUnitOrder(auditRowUnit(a), auditRowUnit(b)));
  const vectors = new Map<string, number[] | null>();
  for (const row of allSlots) {
    const vector = row.row.embedding === null ? null : list(numberValue)(decodeStrictJson(stringValue(row.row.embedding), false, false, true));
    if (vector !== null && vector.length !== 1536) invalidComparison();
    vectors.set(auditUnitKey(auditRowUnit(row)), vector);
  }
  const populations = { pages: selected.document_pages, chunks: selected.document_chunks, tables: selected.document_table_facts,
    images: selected.document_images, searchableUnits: allSlots, embeddings: allSlots.filter((entry) => vectors.get(auditUnitKey(auditRowUnit(entry))) !== null) };
  const witnesses = new Map<string, ReturnType<typeof auditWitness>>();
  for (const witness of measured.witnesses) {
    const key = auditWitnessIdentity(witness);
    if (witnesses.has(key)) invalidComparison();
    witnesses.set(key, witness);
  }
  function take<T extends ReturnType<typeof auditWitness>["tag"]>(key: string, tag: T): Extract<ReturnType<typeof auditWitness>, { tag: T }> {
    const witness = witnesses.get(key);
    if (!witness || witness.tag !== tag) invalidComparison();
    witnesses.delete(key);
    return witness as Extract<ReturnType<typeof auditWitness>, { tag: T }>;
  }
  const limitations: ReturnType<typeof inventoryLimitation>[] = [];
  const familyForCount = { pages: "pages", chunks: "chunks", tables: "table_facts", images: "images", searchableUnits: "index_units", embeddings: "embedding_fields" } as const;
  resolver.evidence(expected.lifecycleEvidence); resolver.evidence(expected.configurationEvidence);
  const containsPointer = (evidence: readonly ReturnType<typeof inventoryPointer>[], pointer: ReturnType<typeof inventoryPointer>) =>
    evidence.some((entry) => encodeShadowNodeJsonCanonicalPayload(entry) === encodeShadowNodeJsonCanonicalPayload(pointer));
  const requiresReviewedBasis = (evidence: readonly ReturnType<typeof inventoryPointer>[], basis: readonly ReturnType<typeof inventoryPointer>[]) => {
    if (!expected.configurationEvidence.every((pointer) => containsPointer(evidence, pointer)) ||
      !basis.every((pointer) => containsPointer(evidence, pointer))) invalidComparison();
  };
  for (const metric of auditCounts) {
    const expectation = expected.populations[metric]; const rows = populations[metric];
    resolver.evidence(expectation.basis);
    // Expected units need an independently retained original source/plan, not only surviving output rows.
    if (expectation.basis.every((pointer) => pointer.ref.tag === "origin_row" || pointer.ref.tag === "candidate_row" || pointer.ref.tag === "candidate_projection")) invalidComparison();
    let expectedCount: number | null = null;
    if (expectation.tag === "known") {
      sortedUnique(expectation.units, auditUnitOrder); expectedCount = expectation.units.length;
      const allowed = metric === "searchableUnits" || metric === "embeddings"
        ? ["chunks", "embedding_fields", "index_units", "memory_cards"] : [familyForCount[metric]];
      if (expectation.units.some((unit) => !allowed.includes(unit.family))) invalidComparison();
      const expectedIds = new Set(expectation.units.map(auditUnitKey));
      if (auditUnits(rows).some((unit) => !expectedIds.has(auditUnitKey(unit)))) {
        limitations.push({ version: 1, code: "measurement_unavailable", scope: { family: familyForCount[metric], key: "*" },
          evidence: expectation.basis, explanation: "An actual unit is outside the independently reviewed expected identity set.", blocks: ["audit_mapping"] });
      }
    } else {
      limitations.push({ version: 1, code: "measurement_unavailable", scope: { family: familyForCount[metric], key: "*" },
        evidence: expectation.basis, explanation: "The independently reviewed expected population is unavailable.", blocks: ["audit_mapping"] });
    }
    const witness = take(`population/${metric}`, "population");
    sortedUnique(witness.observations, (a, b) => auditUnitOrder(a.unit, b.unit));
    auditEqual(witness.observations.map((entry) => entry.unit), auditUnits(rows));
    for (const observation of witness.observations) {
      const row = rows.find((entry) => auditUnitKey(auditRowUnit(entry)) === auditUnitKey(observation.unit));
      if (!row) invalidComparison(); auditRequireRowEvidence(observation.evidence, row, resolver);
    }
    if (witness.result !== rows.length) invalidComparison();
    auditEqual(measured.fields.counts[metric], { expected: expectedCount, actual: rows.length });
  }
  const expectedEmbeddings = expected.populations.embeddings; const expectedSearchable = expected.populations.searchableUnits;
  if (expectedEmbeddings.tag === "known" && expectedSearchable.tag === "known") auditEqual(expectedEmbeddings.units, expectedSearchable.units);
  const quality = { policyVersion: "u04-reviewed-manual-p04-v1", empty: 0, oversized: 0, undersized: 0, lowInformation: 0 };
  const models = new Set<string>(); const dimensions = new Set<number>(); const strategies = new Set<string>();
  for (const row of allSlots) {
    const unit = auditRowUnit(row); const key = auditUnitKey(unit);
    const judgement = take(`unit_quality/${key}`, "unit_quality"); auditRequireRowEvidence(judgement.evidence, row, resolver);
    requiresReviewedBasis(judgement.evidence, expected.populations.searchableUnits.basis);
    for (const flag of ["empty", "oversized", "undersized", "lowInformation"] as const) if (judgement[flag]) quality[flag] += 1;
    const embedding = take(`embedding/${key}`, "embedding"); auditRequireRowEvidence(embedding.evidence, row, resolver);
    const vector = vectors.get(key)!;
    if (embedding.present !== (vector !== null)) invalidComparison();
    if (vector === null) {
      if (embedding.model !== null || embedding.dimensions !== null || embedding.strategy !== null) invalidComparison();
    } else {
      if (embedding.model === null || embedding.strategy === null || embedding.dimensions !== vector.length) invalidComparison();
      // Observed producer identity belongs to this exact vector slot, never a configured default beside an own-row pointer.
      const model = embedding.model; const strategy = embedding.strategy;
      if (!embedding.evidence.some((pointer) => auditRowFieldValue(pointer, row, [["metadata", "embedding_model"]], model, resolver)) ||
        !embedding.evidence.some((pointer) => auditRowFieldValue(pointer, row, [["metadata", "embedding_strategy"]], strategy, resolver))) invalidComparison();
      models.add(embedding.model); dimensions.add(vector.length); strategies.add(embedding.strategy);
    }
  }
  auditEqual(measured.fields.unitQuality, quality);
  auditEqual(measured.fields.embeddingContract, { ...expected.embedding, actualModels: [...models].sort(compareText),
    actualDimensions: [...dimensions].sort((a, b) => a - b), actualStrategies: [...strategies].sort(compareText),
    completeness: allSlots.length === 0 ? 0 : populations.embeddings.length / allSlots.length });
  const checks = new Set<string>();
  const structure = { chunkBoundsValid: true, headingContinuityPassed: true, tableContinuityPassed: true, extractionQualityPassed: true };
  for (const metric of auditStructureNames) if (!expected.checks.some((check) => check.metric === metric)) invalidComparison();
  for (const check of expected.checks) {
    if (checks.has(check.id)) invalidComparison(); checks.add(check.id); resolver.evidence(check.basis);
    const witness = take(`structure/${check.id}`, "structure");
    if (witness.metric !== check.metric) invalidComparison(); resolver.evidence(witness.evidence);
    requiresReviewedBasis(witness.evidence, check.basis);
    if (check.expectedUnit.family === "document_metadata" && check.expectedUnit.key === "singleton") {
      if (!witness.evidence.some((pointer) => pointer.ref.tag === "origin_row" && pointer.ref.owner === "document" && pointer.ref.rowId === expected.source.documentId)) invalidComparison();
    } else {
      const actual = Object.values(populations).flat().find((row) => auditUnitKey(auditRowUnit(row)) === auditUnitKey(check.expectedUnit));
      if (actual) auditRequireRowEvidence(witness.evidence, actual, resolver);
      else {
        const declared = Object.values(expected.populations).some((population) => population.tag === "known" && population.units.some((unit) => auditUnitKey(unit) === auditUnitKey(check.expectedUnit)));
        if (!declared || witness.result === "pass") invalidComparison();
      }
    }
    if (witness.result === "unavailable") {
      limitations.push({ version: 1, code: "measurement_unavailable", scope: check.expectedUnit, evidence: witness.evidence,
        explanation: "A required reviewed structure judgement is unavailable.", blocks: ["audit_mapping"] });
    } else if (witness.result === "fail") structure[check.metric] = false;
  }
  // No unavailable judgement becomes a fabricated P04 boolean. Caller returns an incomplete retained result.
  if (!limitations.some((entry) => entry.explanation === "A required reviewed structure judgement is unavailable.")) auditEqual(measured.fields.structure, structure);
  const duplicates = take("duplicates", "duplicates");
  const grouped = new Map<string, ReturnType<typeof inventoryUnit>[]>();
  for (const row of selected.document_chunks) {
    const hash = hashIndexQualityText(stringValue(row.row.content));
    grouped.set(hash, [...(grouped.get(hash) ?? []), auditRowUnit(row)]);
  }
  const groups = [...grouped].sort(([a], [b]) => compareText(a, b)).map(([contentHash, units]) => ({ contentHash, units: units.sort(auditUnitOrder) }));
  auditEqual(duplicates.groups, groups);
  const duplicateCount = groups.reduce((sum, group) => sum + group.units.length - 1, 0);
  if (duplicates.result !== duplicateCount || measured.fields.counts.duplicateChunks !== duplicateCount) invalidComparison();
  const relationships = take("relationships", "relationships");
  const generationWitness = take("generations", "generations");
  sortedUnique(generationWitness.units, (a, b) => auditUnitOrder(a.unit, b.unit));
  auditEqual(generationWitness.units.map((entry) => entry.unit), auditUnits(selected.document_chunks));
  const generations = new Set<string>();
  for (const entry of generationWitness.units) {
    const row = selected.document_chunks.find((row) => auditUnitKey(auditRowUnit(row)) === auditUnitKey(entry.unit));
    if (!row) invalidComparison(); auditRequireRowEvidence(entry.evidence, row, resolver);
    const generation = auditGeneration(row);
    if (generation !== entry.generation) invalidComparison();
    if (generation === null && expected.source.baselineGenerationId !== null) limitations.push({ version: 1, code: "source_identity_unavailable", scope: entry.unit, evidence: entry.evidence,
      explanation: "The selected original chunk has no attributable generation.", blocks: ["audit_mapping"] });
    // A positively source-bound legacy-null view preserves null per unit and no UUID aggregate.
    // The unchanged P04 classifier still reports generation_incomplete; no generation is invented.
    if (generation !== null) generations.add(generation);
  }
  auditEqual(generationWitness.result, [...generations].sort(compareText)); auditEqual(measured.fields.chunkGenerations, generationWitness.result);
  auditEqual(measured.fields.provenance.expected, expected.provenance); auditEqual(measured.fields.provenance.review, expected.provenanceReview);
  if (reviewedProvenanceEvidenceDigest({ contractVersion: expected.provenanceReview.contractVersion, expected: expected.provenance }) !== expected.provenanceReview.evidenceDigest) invalidComparison();
  for (const field of auditProvenanceNames) {
    const witness = take(`provenance/${field}`, "provenance"); resolver.evidence(witness.evidence);
    if (witness.value !== measured.fields.provenance.actual[field]) invalidComparison();
    const snake = field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
    const paths = [["metadata", "provenance", field], ["metadata", snake], ...(field === "contentHash" ? [["content_hash"]] : [])];
    if (!witness.evidence.some((pointer) => {
      const ref = pointer.ref;
      if (ref.tag !== "origin_row") return false;
      const row = ref.owner === "document" ? resolver.document(expected.source.documentId)
        : selected[auditOwnerTable[ref.owner]].find((entry) => entry.envelope.digest === ref.rowDigest && entry.row.id === ref.rowId);
      return row !== undefined && auditRowFieldValue(pointer, row, paths, witness.value, resolver);
    })) invalidComparison();
  }
  if (witnesses.size !== 0) invalidComparison();
  return { limitations, relationships };
}
/** Complete private-object identity, distinct from the SHA-256 of its object bytes. */
export function shadowPrivateObjectIdentityV1(input: unknown): string {
  const ref = inventoryArtifact(input);
  if (ref.tag !== "private_object") invalidComparison();
  return auditRawDigest(encodeShadowNodeJsonCanonicalPayload(ref));
}
/** Same unchanged U02 semantic owner for baseline and candidate source sets. */
function auditStructuredSummaryProjection(documentId: string, generation: string | null,
  selected: { document_summaries: Pick<AuditRow, "row">[]; document_labels: Pick<AuditRow, "row">[];
    document_chunks: AuditRow[]; document_images: AuditRow[] },
  profile: ReturnType<typeof parseShadowExecutionProfileEnvelope>) {
  for (const summary of selected.document_summaries) {
    const summaryMetadata = auditObject(summary.row.metadata);
    const declaredGeneration = requireExactSourceAnchoredGeneration(generation, summaryMetadata);
    if (declaredGeneration !== generation) invalidComparison();
    const payload = normalizeSourceAnchoredSummary(summaryMetadata.source_anchored_summary_v1, {
      documentId: documentId, indexGenerationId: generation,
      expectedStructuredModel: profile.configuration.payload.generation.indexingModel,
      // The unchanged enrichment owner aliases this exact deep-memory version; no env-bearing import.
      expectedStructuredModelVersion: "rag-deep-memory-v1",
      selectedChunks: selected.document_chunks.map((entry) => ({ id: uuidValue(entry.row.id), page_number: nullable(numberValue)(entry.row.page_number), index_generation_id: auditGeneration(entry) })),
      selectedImages: selected.document_images.map((entry) => ({ id: uuidValue(entry.row.id), page_number: nullable(numberValue)(entry.row.page_number), index_generation_id: auditGeneration(entry) })),
    });
    if (!persistedSourceAnchoredSummaryProjectionMatches({ summary: stringValue(summary.row.summary), clinical_specifics: summary.row.clinical_specifics,
      source_chunk_ids: summary.row.source_chunk_ids, source_image_ids: summary.row.source_image_ids, model: summary.row.model,
      generated_at: summary.row.generated_at, metadata: summaryMetadata }, payload)) invalidComparison();
    const projected = projectSourceAnchoredLabels(payload);
    const labels = selected.document_labels.filter((entry) => entry.row.source === "generated");
    if (labels.length !== projected.length) invalidComparison();
    for (const label of projected) {
      const matches = labels.filter((entry) => entry.row.label === label.label && entry.row.label_type === label.label_type);
      if (matches.length !== 1) invalidComparison();
      const stored = matches[0]!.row; const labelMetadata = auditObject(stored.metadata);
      auditEqual(stored.confidence, label.confidence);
      for (const key of ["source_chunk_ids", "source_image_ids", "pages"] as const) auditEqual(labelMetadata[key], label[key]);
    }
  }
  if (selected.document_summaries.length === 0 && selected.document_labels.some((entry) => entry.row.source === "generated")) invalidComparison();
}
function auditProjectionSources(source: ReturnType<typeof auditSource>, document: AuditRow, selected: Record<AuditTable, AuditRow[]>,
  profile: ReturnType<typeof parseShadowExecutionProfileEnvelope>) {
  const metadata = auditObject(document.row.metadata);
  auditStructuredSummaryProjection(source.documentId, source.baselineGenerationId, selected, profile);
  const deep = [...selected.document_sections, ...selected.document_memory_cards, ...selected.document_index_units]
    .filter((entry) => entry.row.producer === "local-worker" || entry.row.artifact_generation_id !== null);
  const receiptMetadata = metadata.deep_memory_commit_receipts === undefined ? {} : auditObject(metadata.deep_memory_commit_receipts);
  if (deep.length === 0 && selected.rag_aliases.length === 0 && receiptMetadata["local-worker"] === undefined) return;
  const receipts = auditObject(metadata.deep_memory_commit_receipts); const receipt = auditObject(receipts["local-worker"]);
  const request = auditObject(receipt.request); const result = auditObject(receipt.result); const fence = auditObject(request.fence);
  const d = uuidValue(request.artifact_generation);
  if (d === source.baselineGenerationId || fence.document_id !== source.documentId || fence.expected_generation_id !== source.baselineGenerationId ||
    result.document_id !== source.documentId || result.producer !== "local-worker" || result.artifact_generation_id !== d ||
    result.index_generation_id !== source.baselineGenerationId || result.ok === false ||
    auditObject(metadata.deep_memory_generations)["local-worker"] !== d) invalidComparison();
  const token = uuidValue(fence.lease_token);
  for (const entry of deep) {
    const rowMetadata = auditObject(entry.row.metadata);
    if (entry.row.producer !== "local-worker" || entry.row.artifact_generation_id !== d || rowMetadata.ingestion_lease_token !== token) invalidComparison();
  }
  auditEqual(request.section_count, selected.document_sections.filter((row) => row.row.producer === "local-worker").length);
  auditEqual(request.memory_card_count, selected.document_memory_cards.filter((row) => row.row.producer === "local-worker").length);
  const unitCounts: Record<string, number> = {};
  for (const unit of selected.document_index_units.filter((entry) => entry.row.producer === "local-worker")) {
    const kind = stringValue(unit.row.unit_type); unitCounts[kind] = (unitCounts[kind] ?? 0) + 1;
  }
  auditEqual(request.index_unit_counts_by_type, unitCounts);
  const anchors = list(record({ id: uuidValue, anchor_id: nonemptyString }))(request.anchors);
  if (new Set(anchors.map((anchor) => anchor.id)).size !== anchors.length) invalidComparison();
  for (const anchor of anchors) {
    const chunk = selected.document_chunks.find((entry) => entry.row.id === anchor.id);
    if (!chunk || chunk.row.anchor_id !== anchor.anchor_id || auditObject(chunk.row.metadata).anchor_id !== anchor.anchor_id) invalidComparison();
  }
  const aliases = list(record({ alias: stringValue, canonical: stringValue, alias_type: stringValue, weight: numberValue, metadata: auditObject }))(request.aliases);
  if (aliases.length !== selected.rag_aliases.length) invalidComparison();
  for (const alias of aliases) {
    const matches = selected.rag_aliases.filter((entry) => entry.row.alias === alias.alias && entry.row.canonical === alias.canonical && entry.row.alias_type === alias.alias_type);
    if (matches.length !== 1) invalidComparison();
    const row = matches[0]!.row; auditEqual(row.weight, alias.weight);
    if (row.owner_id !== source.ownerId || row.enabled !== true) invalidComparison();
    auditEqual(row.metadata, { ...alias.metadata, document_id: source.documentId, generated_by: "local-worker", artifact_generation_id: d, ingestion_lease_token: token });
  }
}
type AuditEdge = { unit: ReturnType<typeof inventoryUnit>; relationship: ReturnType<typeof auditRelationship>; result: "resolved" | "orphan"; row: AuditRow };
function auditEdges(document: AuditRow, selected: Record<AuditTable, AuditRow[]>, resolver: ReturnType<typeof auditResolver> | null,
  generatedLabelPagesOnly = false) {
  const rows = [document, ...Object.entries(selected).filter(([table]) => Boolean(auditTableFamily[table as AuditTable]) && table !== "documents").flatMap(([, entries]) => entries)];
  const units = new Set(rows.map((entry) => auditUnitKey(auditRowUnit(entry))));
  const edges: AuditEdge[] = [];
  const add = (row: AuditRow, field: (string | number)[], tag: "source_chunk" | "source_image" | "section" | "page", family: InventoryFamily, value: unknown) => {
    const key = tag === "page" ? String(positiveInteger(value)) : uuidValue(value);
    const target = { family, key };
    edges.push({ row, unit: auditRowUnit(row), relationship: { tag, field, target }, result: units.has(auditUnitKey(target)) ? "resolved" : "orphan" });
  };
  const array = (row: AuditRow, object: { [key: string]: AuditJson }, path: (string | number)[], key: string, family: InventoryFamily, tag: "source_chunk" | "source_image" | "page") => {
    if (!Object.hasOwn(object, key) || object[key] === null) return;
    const entries = list<string | number>(tag === "page" ? positiveInteger : uuidValue)(object[key]);
    entries.forEach((value, index) => add(row, [...path, key, index], tag, family, value));
  };
  for (const row of rows) {
    const stored = row.row;
    for (const [key, tag, family] of [["source_chunk_id", "source_chunk", "chunks"], ["source_image_id", "source_image", "images"], ["section_id", "section", "sections"]] as const) {
      if (stored[key] !== undefined && stored[key] !== null) add(row, [key], tag, family, stored[key]);
    }
    for (const key of ["image_ids", "source_image_ids"]) array(row, stored, [], key, "images", "source_image");
    for (const key of ["chunk_ids", "source_chunk_ids"]) array(row, stored, [], key, "chunks", "source_chunk");
    if (row.table !== "document_pages") for (const key of ["page_number", "page_start", "page_end"]) {
      if (stored[key] !== undefined && stored[key] !== null) add(row, [key], "page", "pages", stored[key]);
    }
    const metadata = Object.hasOwn(stored, "metadata") ? auditObject(stored.metadata) : {};
    for (const key of ["chunk_ids", "source_chunk_ids"]) array(row, metadata, ["metadata"], key, "chunks", "source_chunk");
    array(row, metadata, ["metadata"], "source_image_ids", "images", "source_image");
    if (row.table === "document_labels" && (!generatedLabelPagesOnly || stored.source === "generated"))
      array(row, metadata, ["metadata"], "pages", "pages", "page");
    if (Object.hasOwn(metadata, "relationships") || Object.hasOwn(metadata, "source_relationships")) invalidComparison();
    if (row.table === "documents" && metadata.deep_memory_commit_receipts !== undefined) {
      const receipt = auditObject(metadata.deep_memory_commit_receipts)["local-worker"];
      if (receipt !== undefined) {
        const request = auditObject(auditObject(receipt).request);
        const base = ["metadata", "deep_memory_commit_receipts", "local-worker", "request"];
        list(auditObject)(request.anchors).forEach((anchor, index) => {
          add(row, [...base, "anchors", index, "id"], "source_chunk", "chunks", anchor.id);
          const target = { family: "chunks" as const, key: uuidValue(anchor.id) };
          const value = nonemptyString(anchor.anchor_id);
          const sourceChunk = selected.document_chunks.find((entry) => entry.row.id === anchor.id);
          edges.push({ row, unit: auditRowUnit(row), relationship: { tag: "anchor", field: [...base, "anchors", index, "anchor_id"], target, value },
            result: sourceChunk?.row.anchor_id === value ? "resolved" : "orphan" });
        });
        list(auditObject)(request.aliases).forEach((alias, index) => {
          const aliasMetadata = auditObject(alias.metadata); const path = [...base, "aliases", index, "metadata"];
          array(row, aliasMetadata, path, "source_chunk_ids", "chunks", "source_chunk");
          array(row, aliasMetadata, path, "chunk_ids", "chunks", "source_chunk");
          array(row, aliasMetadata, path, "source_image_ids", "images", "source_image");
        });
      }
    }
    if (resolver !== null && stored.storage_path !== undefined && stored.storage_path !== null) {
      const candidates = [...resolver.objects.values()].filter((entry) => entry.ref.objectPath === stored.storage_path);
      if (candidates.length !== 1) invalidComparison();
      if (row.table === "documents" && (candidates[0]!.ref.sha256 !== stored.content_hash || candidates[0]!.ref.byteLength !== stored.file_size)) invalidComparison();
      const target = { family: "private_objects" as const, key: shadowPrivateObjectIdentityV1(candidates[0]!.ref) };
      edges.push({ row, unit: auditRowUnit(row), relationship: { tag: "private_object", field: ["storage_path"], target }, result: "resolved" });
    }
    if (stored.anchor_id !== undefined && stored.anchor_id !== null) {
      const value = nonemptyString(stored.anchor_id); const target = auditRowUnit(row);
      const storedAnchor = metadata.anchor_id;
      edges.push({ row, unit: target, relationship: { tag: "anchor", field: ["anchor_id"], target, value },
        result: storedAnchor === undefined || storedAnchor === value ? "resolved" : "orphan" });
    }
    if (row.table === "document_summaries") {
      const payload = auditObject(metadata.source_anchored_summary_v1);
      const base = ["metadata", "source_anchored_summary_v1"];
      array(row, payload, base, "source_chunk_ids", "chunks", "source_chunk");
      array(row, payload, base, "source_image_ids", "images", "source_image");
      const profile = auditObject(auditObject(payload.clinical_specifics).profile);
      for (const key of ["applies_to", "key_clinical_actions", "medication_dose_monitoring", "thresholds_timing", "escalation_risk_warnings",
        "required_forms_documentation", "not_covered", "important_tables_images", "best_questions", "source_quality_notes"]) {
        const items = list(auditObject)(profile[key]);
        items.forEach((item, index) => {
          const path = [...base, "clinical_specifics", "profile", key, index];
          array(row, item, path, "source_chunk_ids", "chunks", "source_chunk");
          array(row, item, path, "source_image_ids", "images", "source_image"); array(row, item, path, "pages", "pages", "page");
        });
      }
    }
  }
  return edges.sort((a, b) => compareText(encodeShadowNodeJsonCanonicalPayload([a.unit, a.relationship]), encodeShadowNodeJsonCanonicalPayload([b.unit, b.relationship])));
}
function auditCheckEdges(witness: Extract<ReturnType<typeof auditWitness>, { tag: "relationships" }>, expected: AuditEdge[],
  measured: ReturnType<typeof auditMeasurements>, resolver: ReturnType<typeof auditResolver>) {
  const claimed = witness.checked.map((edge) => {
    const key = encodeShadowNodeJsonCanonicalPayload([edge.unit, edge.relationship]);
    const actual = expected.find((entry) => encodeShadowNodeJsonCanonicalPayload([entry.unit, entry.relationship]) === key);
    if (!actual || actual.result !== edge.result) invalidComparison();
    auditRequireRowEvidence(edge.evidence, actual.row, resolver);
    // Every relationship also resolves its exact stored field, including the array offset.
    auditPath(actual.row.row, edge.relationship.field);
    return { unit: edge.unit, relationship: edge.relationship, result: edge.result };
  });
  const compare = (a: typeof claimed[number], b: typeof claimed[number]) =>
    compareText(encodeShadowNodeJsonCanonicalPayload([a.unit, a.relationship]), encodeShadowNodeJsonCanonicalPayload([b.unit, b.relationship]));
  claimed.sort(compare); sortedUnique(claimed, compare);
  auditEqual(claimed, expected.map(({ unit, relationship, result }) => ({ unit, relationship, result })));
  const orphans = expected.filter((edge) => edge.result === "orphan").length;
  if (witness.result !== orphans || measured.fields.counts.orphanedArtifacts !== orphans) invalidComparison();
}
function auditDirectAnswerFacts(answer: ReturnType<typeof auditAnswer>, crossRegionRunner: boolean) {
  // Exact policy inputs consumed by sourceGovernanceWarnings; full returns remain independently retained.
  const warnings = answer.sourceGovernanceWarnings ?? sourceGovernanceWarnings({
    results: answer.sources.map((source) => ({ id: source.id, document_id: source.document_id, title: source.title, file_name: source.file_name,
      page_number: source.page_number, chunk_index: source.chunk_index, section_heading: source.section_heading, content: source.content,
      image_ids: source.image_ids, images: [], similarity: source.similarity, source_metadata: normalizeSourceMetadata(source.source_metadata),
      indexing_quality: source.indexing_quality, table_facts: source.table_facts })), relevance: answer.relevance,
  });
  // Delivered-grounding semantics are copied from eval-quality's pure policy (its module loads env at top level).
  const refusalApplies = answer.grounded !== false && answer.confidence !== "unsupported" && answer.responseMode !== "evidence_gap";
  const grounded = refusalApplies && warnings.some((warning) => warning.severity === "danger") ? false : answer.grounded;
  const latency = answer.latencyTimings;
  const totalMs = latency?.total_latency_ms ?? 0; const generationMs = latency?.generation_latency_ms ?? 0;
  const route = answer.routingMode ?? "none";
  let latencyRoute: string = route;
  if (generationMs > 0) {
    latencyRoute = /\bgeneration_fallback:/i.test(answer.routingReason ?? "") ? "fallback" : route === "strong" ||
      /^(?:broad_clinical_management_synthesis|clinical_risk_or_complex_query|limited_retrieval_strength|multi_document_comparison_synthesis|retrieval_gap_or_conflict)\b/i.test(answer.routingReason ?? "") ? "strong" : "fast";
  }
  const routeBudgetMs = latency?.route_budget_ms ?? answerRouteBudgetMs[answer.routingMode ?? "unsupported"];
  const routeDeadlineExceeded = latency?.route_deadline_exceeded ?? false;
  const budgetExhaustedByRetrieval = latency?.route_budget_exhausted_by_retrieval ?? false;
  const timings = { retrievalMs: latency?.retrieval_latency_ms ?? latency?.search_latency_ms ?? 0, routingMs: latency?.routing_latency_ms ?? 0,
    generationMs, verificationMs: latency?.verification_latency_ms ?? 0, totalMs, routeBudgetMs, routeDeadlineExceeded, budgetExhaustedByRetrieval };
  const excused = crossRegionRunner && budgetExhaustedByRetrieval && generationMs === 0;
  const routeCeilingExceeded = !excused && (routeDeadlineExceeded || (routeBudgetMs === 0 ? generationMs > 0 : totalMs > routeBudgetMs));
  const usage = { inputTokens: answer.openAIUsage?.input_tokens ?? 0, cachedInputTokens: answer.openAIUsage?.cached_input_tokens ?? 0,
    outputTokens: answer.openAIUsage?.output_tokens ?? 0 };
  const hasUsage = usage.inputTokens + usage.cachedInputTokens + usage.outputTokens > 0;
  const requestIds = answer.openAIRequestIds?.filter(Boolean) ?? [];
  const hasProvider = hasUsage || requestIds.length > 0 || Boolean(answer.modelUsed) || generationMs > 0;
  return { warnings, grounded, route, latencyRoute, totalMs, generationMs, timings, routeCeilingExceeded,
    executionType: hasProvider ? "api" : answer.routingMode === "unsupported" ? "rule-based" : "cached",
    hasUsage, hasProvider, usage, requestIds };
}
type AuditCandidateReportBinding = Readonly<{
  requestEnvelope: ShadowRawEnvelope;
  authorityEnvelope: ShadowRawEnvelope;
  baselineCaseReport: ReturnType<typeof auditCaseReport>;
}>;

function auditEvaluationReportInputBindingV1(report: ReturnType<typeof auditCaseReport>,
  profile: ReturnType<typeof parseShadowExecutionProfileEnvelope>, origin: ReturnType<typeof auditOrigin>,
  sources: ReturnType<typeof auditSource>[], candidateBinding: AuditCandidateReportBinding | null = null) {
  // Historical integrity only. Fresh execution authority remains the independently admitted
  // readShadowEvaluationAuthorityV1 call made before the workload runs.
  const authority = auditEnvelope(report.inputBinding.authorityEnvelope, "plan", u04EvaluationAuthorityPayload);
  const request = auditEnvelope(report.inputBinding.requestEnvelope, "u04-evaluation-request-v1", u04EvaluationRequestPayload);
  const manifest = authority.payload.manifest;
  const expectedSide = candidateBinding === null ? "baseline" : "candidate";
  if (authority.payload.phase.side !== expectedSide || request.payload.phase.side !== expectedSide ||
    (expectedSide === "baseline" && (manifest.planPath !== null || manifest.reportOrReceiptPath !== null)) ||
    (expectedSide === "candidate" && manifest.planPath === null) ||
    request.payload.authorityEnvelopeDigest !== authority.envelope.digest ||
    authority.payload.executionProfileDigest !== profile.bytes.envelope.digest ||
    authority.payload.originalOriginDigest !== origin.envelope.digest ||
    authority.payload.caseScopes.caseSetDigest !== profile.cases.bytes.envelope.digest ||
    manifest.targetProjectRef !== profile.payload.target.projectRef ||
    manifest.expectedDocumentCount !== profile.payload.documentIds.length ||
    request.payload.executionProfileDigest !== profile.bytes.envelope.digest ||
    request.payload.originalOriginDigest !== origin.envelope.digest ||
    request.payload.caseSetDigest !== profile.cases.bytes.envelope.digest ||
    request.payload.configurationDigest !== profile.configuration.bytes.envelope.digest ||
    request.payload.comparisonClock !== profile.payload.comparisonClock ||
    u04EvaluationAuthorityConfirmationV1(authority.payload) !== manifest.confirmationSha256 ||
    shadowMicros(manifest.expiresAt) <= shadowMicros(manifest.authorizedAt) ||
    shadowMicros(origin.payload.capturedAt) > shadowMicros(manifest.authorizedAt) ||
    shadowMicros(manifest.authorizedAt) > shadowMicros(auditSqlTimestamp(report.report.generated_at)) ||
    shadowMicros(auditSqlTimestamp(report.report.generated_at)) >= shadowMicros(manifest.expiresAt)) invalidComparison();
  if (candidateBinding !== null) {
    auditEqual(authority.envelope, candidateBinding.authorityEnvelope);
    auditEqual(request.envelope, candidateBinding.requestEnvelope);
  }
  auditEqual(manifest.expectedDocumentIds, profile.payload.documentIds);
  auditEqual(authority.payload.caseScopes, request.payload.caseScopes);
  auditEqual(authority.payload.phase, request.payload.phase);
  auditEqual(authority.payload.runnerPolicy.runContext, report.report.run_context);
  auditEqual(request.payload.sourceBindings, sources);
  auditEqual(request.payload.requiredSqlOperations, literal26sqlOperationTags);
  validateU04EvaluationAuthorityCaseScopesV1(authority.payload.caseScopes, profile);
  return { crossRegionRunner: authority.payload.runnerPolicy.crossRegionRunner,
    costRates: authority.payload.runnerPolicy.costRates };
}

function auditCandidateDocumentResultsV1(report: ReturnType<typeof auditCaseReport>,
  baseline: ReturnType<typeof auditCaseReport>) {
  if (report.executions.length !== baseline.executions.length) invalidComparison();
  for (let ordinal = 0; ordinal < report.executions.length; ordinal += 1) {
    const execution = report.executions[ordinal]!, baselineExecution = baseline.executions[ordinal]!;
    if (execution.kind !== baselineExecution.kind || execution.index !== baselineExecution.index ||
      execution.caseId !== baselineExecution.caseId ||
      execution.outcome !== "complete" || execution.limitations.length !== 0 ||
      execution.documentResults.length !== baselineExecution.documentResults.length) invalidComparison();
    const baselineByDocument = new Map(baselineExecution.documentResults.map(result => [result.documentId, result]));
    if (baselineByDocument.size !== baselineExecution.documentResults.length) invalidComparison();
    for (const result of execution.documentResults) {
      const reviewed = baselineByDocument.get(result.documentId);
      if (!reviewed || result.expectedDocumentRank !== reviewed.expectedDocumentRank) invalidComparison();
      const expectedCodes: ReturnType<typeof auditFailureCode>[] = [];
      if (result.actualDocumentRank === null) expectedCodes.push("document_not_retrieved");
      if (result.actualDocumentRank !== null && result.expectedDocumentRank !== null &&
        result.actualDocumentRank > result.expectedDocumentRank) expectedCodes.push("document_rank_exceeded");
      const insufficiency = execution.answer?.programmeDiagnostics?.insufficiencyReason;
      if (insufficiency === "source_role_mismatch") expectedCodes.push("source_role_mismatch");
      if (insufficiency === "governance_block") expectedCodes.push("governance_block");
      auditEqual([...result.failureCodes].sort(compareText), expectedCodes.sort(compareText));
    }
  }
}

function auditValidateReport(report: ReturnType<typeof auditCaseReport>, profile: ReturnType<typeof parseShadowExecutionProfileEnvelope>,
  origin: ReturnType<typeof auditOrigin>, sources: ReturnType<typeof auditSource>[], selectedByDocument: Map<string, Record<AuditTable, AuditRow[]>>,
  candidateBinding: AuditCandidateReportBinding | null = null) {
  const runnerPolicy = auditEvaluationReportInputBindingV1(report, profile, origin, sources, candidateBinding);
  if (candidateBinding !== null) auditCandidateDocumentResultsV1(report, candidateBinding.baselineCaseReport);
  auditEqual(report.documentIds, profile.payload.documentIds); auditEqual(report.manualAliasIds, profile.payload.manualAliasIds);
  auditEqual(report.sourceBindings, sources);
  if (report.originDigest !== origin.envelope.digest || report.executionProfileDigest !== profile.bytes.envelope.digest ||
    report.caseSetDigest !== profile.cases.bytes.envelope.digest || report.configurationDigest !== profile.configuration.bytes.envelope.digest ||
    report.providerMode !== profile.payload.providerMode || report.evidenceMode !== profile.payload.evidenceMode ||
    report.comparisonClock !== profile.payload.comparisonClock || report.report.provider.mode !== profile.payload.providerMode) invalidComparison();
  const cases = profile.cases.payload;
  if (report.executions.length !== cases.retrieval.length + cases.quality.length ||
    report.report.retrieval.results.length !== cases.retrieval.length || report.report.rag.results.length !== cases.quality.length) invalidComparison();
  auditEqual(report.report.retrieval.summary.case_count, cases.retrieval.length); auditEqual(report.report.rag.summary.case_count, cases.quality.length);
  auditEqual(report.report.retrieval.summary.failed_cases, report.report.retrieval.results.filter((entry) => entry.failures.length > 0));
  auditEqual(report.report.retrieval.summary.latency_failed_cases, report.report.retrieval.results.filter((entry) => entry.timedOut || (entry.latencyFailures?.length ?? 0) > 0));
  auditEqual(report.report.rag.summary.failed_cases, report.report.rag.results.filter((entry) => entry.failures.length > 0));
  auditEqual(report.report.accepted_threshold_failures, report.report.source_metadata_debt_acceptance.accepted_failures);
  auditEqual(report.report.blocking_threshold_failures, report.report.threshold_failures.filter((failure) => !report.report.accepted_threshold_failures.includes(failure)));
  const ordered = new Map<number, string[]>();
  for (let ordinal = 0; ordinal < report.executions.length; ordinal += 1) {
    const execution = report.executions[ordinal]!;
    const retrieval = ordinal < cases.retrieval.length;
    const index = retrieval ? ordinal : ordinal - cases.retrieval.length;
    const testCase = retrieval ? cases.retrieval[index]!.testCase : cases.quality[index]!;
    if (execution.kind !== (retrieval ? "retrieval" : "quality") || execution.index !== index || execution.caseId !== testCase.id) invalidComparison();
    if (retrieval) {
      const result = report.report.retrieval.results[index]!; const requested = cases.retrieval[index]!;
      if (result.id !== requested.testCase.id || result.query !== requested.testCase.query || result.forceEmbedding !== requested.effectiveForceEmbedding ||
        result.topK !== requested.testCase.topK || result.expectedQueryClass !== requested.testCase.expectedQueryClass ||
        execution.searchResults.length > requested.retrievalLimit || result.resultCount !== execution.searchResults.length || execution.answer !== null ||
        result.topResults.length !== Math.min(10, execution.searchResults.length)) invalidComparison();
      if (result.timedOut === true && execution.outcome !== "timeout") invalidComparison();
      auditEqual(result.expectedDocumentSubstrings, requested.testCase.expectedDocumentSubstrings);
      auditEqual(result.expectedContentTerms, requested.testCase.expectedContentTerms.map((entry) => Array.isArray(entry) ? entry.join(" OR ") : entry));
      for (let position = 0; position < result.topResults.length; position += 1) {
        const preview = result.topResults[position]!; const full = execution.searchResults[position]!;
        if (preview.rank !== position + 1 || preview.chunk_id !== full.id || preview.title !== full.title || preview.file_name !== full.file_name ||
          preview.page_number !== full.page_number || preview.content_preview !== (full.retrieval_synopsis || full.content).replace(/\s+/g, " ").trim().slice(0, 220)) invalidComparison();
        auditEqual(preview.similarity, full.similarity); auditEqual(preview.hybrid_score, full.hybrid_score ?? null);
        auditEqual(preview.text_rank, full.text_rank ?? null); auditEqual(preview.rrf_score, full.rrf_score ?? null);
      }
    } else {
      const result = report.report.rag.results[index]!; const requested = cases.quality[index]!;
      if (result.id !== requested.id || result.question !== requested.question || result.category !== requested.category || result.supported !== requested.supported) invalidComparison();
      auditEqual(result.expectedFiles, requested.expectedFiles);
      if (execution.outcome === "complete" && execution.answer === null) invalidComparison();
      if (execution.answer !== null) {
        const answer = execution.answer; auditEqual(execution.searchResults, answer.sources);
        const facts = auditDirectAnswerFacts(answer, runnerPolicy.crossRegionRunner);
        if (result.citations !== answer.citations.length || result.visualEvidence !== (answer.visualEvidence?.length ?? 0) ||
          result.model !== (answer.modelUsed ?? null) || result.route !== facts.route || result.latencyRoute !== facts.latencyRoute ||
          result.latencyMs !== facts.totalMs || result.grounded !== facts.grounded || result.executionType !== facts.executionType ||
          result.sourceWarningCount !== facts.warnings.length || result.sourceDangerWarningCount !== facts.warnings.filter((warning) => warning.severity === "danger").length) invalidComparison();
        auditEqual(result.topFiles, answer.sources.slice(0, 5).map((source) => source.file_name));
        const coverage = expectedFileCoverage([...requested.expectedFiles], answer.sources, requested.expectedFiles.length > 1 ? 5 : 3);
        auditEqual(result.matchedFiles, coverage.matchedFiles); auditEqual(result.missingFiles, coverage.missingFiles);
        auditEqual(result.expectedHit, requested.expectedFiles.length > 1 ? coverage.allHit : coverage.anyHit);
        auditEqual(result.unverifiedNumericTokenCount, answer.unverifiedNumericTokens?.length ?? 0);
        auditEqual(result.hasFaithfulnessWarning, Boolean(answer.faithfulnessWarning));
        if (result.searchLatencyMs !== answer.latencyTimings?.search_latency_ms || result.generationLatencyMs !== (facts.generationMs > 0 ? facts.generationMs : undefined) ||
          result.rpcLatencyMs !== answer.latencyTimings?.supabase_rpc_latency_ms || result.embeddingLatencyMs !== answer.latencyTimings?.embedding_latency_ms ||
          result.routingReason !== answer.routingReason || result.acceptSourceOnly !== requested.acceptSourceOnly) invalidComparison();
        auditEqual(result.timings, facts.timings); auditEqual(result.routeCeilingExceeded, facts.routeCeilingExceeded);
        auditEqual(result.openAIRequestIds ?? [], facts.requestIds); auditEqual(result.openAIUsage ?? null, facts.hasUsage ? facts.usage : null);
        if (!facts.hasProvider && result.estimatedCostUsd !== 0) invalidComparison();
        if (facts.hasProvider && !facts.hasUsage && result.estimatedCostUsd !== null) invalidComparison();
        if (facts.hasUsage) {
          const rates = runnerPolicy.costRates;
          const estimated = rates === null ? null :
            (Math.max(facts.usage.inputTokens - facts.usage.cachedInputTokens, 0) * rates.input +
              facts.usage.cachedInputTokens * rates.cachedInput + facts.usage.outputTokens * rates.output) / 1_000_000;
          auditEqual(result.estimatedCostUsd, estimated);
        }
      }
    }
    const ids: string[] = [];
    for (const result of execution.searchResults) {
      const selected = selectedByDocument.get(result.document_id);
      if (!selected) invalidComparison();
      // Result identity must resolve to one actual selected stored source. A title/preview never supplies provenance.
      const candidates = [...selected.document_chunks, ...selected.document_index_units, ...selected.document_memory_cards,
        ...selected.document_embedding_fields].filter((entry) => entry.row.id === result.id);
      if (candidates.length !== 1 || candidates[0]!.row.content !== result.content) invalidComparison();
      if (!ids.includes(result.document_id)) ids.push(result.document_id);
    }
    ordered.set(ordinal, ids);
    sortedUnique(execution.documentResults, (a, b) => compareText(a.documentId, b.documentId));
    for (const result of execution.documentResults) {
      if (!profile.payload.documentIds.includes(result.documentId)) invalidComparison();
      const position = ids.indexOf(result.documentId);
      if (result.actualDocumentRank !== (position < 0 ? null : position + 1)) invalidComparison();
      if (new Set(result.failureCodes).size !== result.failureCodes.length) invalidComparison();
    }
  }
  const estimatedTotal = report.report.rag.results.some((result) => result.estimatedCostUsd === null) ? null :
    Number(report.report.rag.results.reduce((sum, result) => sum + (result.estimatedCostUsd ?? 0), 0).toFixed(6));
  auditEqual(report.report.rag.summary.estimated_cost_usd, estimatedTotal);
  return ordered;
}
function auditWavePopulation(origin: ReturnType<typeof auditOrigin>, profile: ReturnType<typeof parseShadowExecutionProfileEnvelope>) {
  const w = new Set(profile.payload.documentIds);
  exactPopulation(origin.rows.documents.map((entry) => stringValue(entry.row.id)), profile.payload.documentIds);
  const batches = new Set<string>(origin.rows.documents.flatMap((entry) => entry.row.import_batch_id === null ? [] : [uuidValue(entry.row.import_batch_id)]));
  const node = origin.rows.ingestion_jobs.filter((entry) => w.has(stringValue(entry.row.document_id)));
  for (const job of node) if (job.row.batch_id !== null) batches.add(uuidValue(job.row.batch_id));
  const inBatch = (value: AuditJson | undefined) => value !== null && value !== undefined && batches.has(uuidValue(value));
  const q = new Set([...origin.rows.ingestion_jobs.filter((entry) => w.has(stringValue(entry.row.document_id)) || inBatch(entry.row.batch_id)),
    ...origin.rows.indexing_v3_agent_jobs.filter((entry) => w.has(stringValue(entry.row.document_id)))].map((entry) => uuidValue(entry.row.id)));
  const keys = new Set(origin.rows.public_source_versions.map((entry) => stringValue(entry.row.source_catalogue_key)));
  const approvals = new Set(origin.rows.public_source_versions.flatMap((entry) => entry.row.publication_approval_id === null ? [] : [uuidValue(entry.row.publication_approval_id)]));
  const memberGenerations = new Set(origin.rows.document_index_generations.map((entry) => uuidValue(entry.row.index_generation_id)));
  auditEqual(origin.rows.import_batches.map((entry) => uuidValue(entry.row.id)).sort(compareText), [...batches].sort(compareText));
  for (const id of approvals) if (!origin.rows.document_publication_approvals.some((entry) => entry.row.id === id)) invalidComparison();
  for (const [table, entries] of Object.entries(origin.rows) as [AuditTable, AuditRow[]][]) {
    for (const entry of entries) {
      const row = entry.row;
      switch (table) {
        case "documents": break;
        case "ingestion_jobs": if (!w.has(stringValue(row.document_id)) && !inBatch(row.batch_id)) invalidComparison(); break;
        case "ingestion_job_stages": if (!w.has(stringValue(row.document_id)) && !q.has(uuidValue(row.job_id))) invalidComparison(); break;
        case "import_batches": if (!batches.has(uuidValue(row.id))) invalidComparison(); break;
        case "rag_aliases": {
          const metadata = auditObject(row.metadata);
          if (!w.has(String(metadata.document_id)) && !profile.payload.manualAliasIds.includes(stringValue(row.id))) invalidComparison();
          if (profile.payload.manualAliasIds.includes(stringValue(row.id)) && metadata.generated_by !== undefined) invalidComparison();
          break;
        }
        case "public_source_versions": if (!w.has(stringValue(row.staging_document_id))) invalidComparison(); break;
        case "public_source_activation_events": if (!keys.has(stringValue(row.source_catalogue_key))) invalidComparison(); break;
        case "public_source_serving_authority": if (row.singleton !== true) invalidComparison(); break;
        case "document_publication_approvals": if (!w.has(stringValue(row.document_id)) && !approvals.has(uuidValue(row.id))) invalidComparison(); break;
        case "shadow_reindex_waves": if (!memberGenerations.has(uuidValue(row.candidate_generation_id))) invalidComparison(); break;
        default: if (!w.has(stringValue(row.document_id))) invalidComparison();
      }
    }
  }
  if (origin.rows.public_source_serving_authority.length !== 1) invalidComparison();
  for (const id of profile.payload.manualAliasIds) if (!origin.rows.rag_aliases.some((entry) => entry.row.id === id)) invalidComparison();
  const count = Object.values(origin.rows).reduce((sum, rows) => sum + rows.length, 0);
  if (count > profile.payload.limits.maxCapturedRows || origin.payload.documentIds.length > profile.payload.limits.maxMembers ||
    Buffer.byteLength(origin.envelope.canonicalPayload, "utf8") > profile.payload.limits.maxOriginBundleBytes) invalidComparison();
}
type AuditPreparation = Readonly<{
  kind: "shadow-audit-incomplete" | "shadow-audit-prepared";
  evidenceMode: ReturnType<typeof auditMode>;
  input: ReturnType<typeof auditInputTransport>;
  admission: ReturnType<typeof auditAdmission>;
  executionProfile: ShadowExecutionProfilePayload;
  inventory: IngestionAuditInventory | null;
  audits: readonly ReturnType<typeof auditDocument>[];
  limitations: readonly ReturnType<typeof inventoryLimitation>[];
  caseReport: ReturnType<typeof auditCaseReport>;
}>;
/** Pure whole-wave evidence preparation; all returned data is deeply frozen, with a finite public result type. */
export function prepareShadowAuditV1(untrustedInput: unknown, independentlyAdmitted: unknown): AuditPreparation {
  try {
    const input = auditInputTransport(untrustedInput); const admission = auditAdmission(independentlyAdmitted);
    const origin = auditOrigin(input.originEnvelope); const profile = parseShadowExecutionProfileEnvelope(origin.payload.executionProfileEnvelope);
    if (origin.envelope.digest !== admission.originDigest || profile.bytes.envelope.digest !== admission.executionProfileDigest ||
      input.caseResultsEnvelope.digest !== admission.caseResultsDigest || origin.payload.evidenceMode !== admission.evidenceMode ||
      profile.payload.evidenceMode !== admission.evidenceMode || origin.payload.sourcePolicyVersion !== profile.payload.sourcePolicyVersion) invalidComparison();
    auditEqual(origin.payload.documentIds, profile.payload.documentIds); auditEqual(origin.payload.manualAliasIds, profile.payload.manualAliasIds);
    exactPopulation(input.documents.map((entry) => entry.documentId), profile.payload.documentIds);
    exactPopulation(admission.documents.map((entry) => entry.documentId), profile.payload.documentIds);
    auditWavePopulation(origin, profile);
    const manualReviews = validateManualAliasReviews(profile.payload);
    auditEqual(admission.manualAliasReviewBindings, manualReviews.map((entry) => ({ aliasId: entry.payload.aliasId,
      ownerId: entry.payload.ownerId, rowDigest: entry.payload.rowDigest, reviewEnvelopeDigest: entry.envelope.digest })));
    for (const entry of manualReviews) {
      const row = origin.rows.rag_aliases.find((row) => row.row.id === entry.payload.aliasId);
      if (!row || row.envelope.canonicalPayload !== entry.payload.rowEnvelope.canonicalPayload || row.envelope.digest !== entry.payload.rowDigest) invalidComparison();
    }
    const resolver = auditResolver(origin, input);
    const members = input.documents.map((member, index) => {
      const binding = admission.documents[index]!;
      if (member.reviewedExpectationsEnvelope.digest !== binding.expectationsDigest || member.measurementsEnvelope.digest !== binding.measurementsDigest ||
        member.approvalEnvelope.digest !== binding.approvalEnvelopeDigest || member.historicalArtifact.artifactDigest !== binding.historicalArtifactDigest) invalidComparison();
      // Retain the old digest separately; it never becomes the new expected-state digest or review digest.
      if (member.historicalArtifact.envelope.digest !== binding.historicalEnvelopeDigest) invalidComparison();
      const historical = auditEnvelope(member.historicalArtifact.envelope, "u04-retained-evidence-v1", auditHistoricalBytes).payload;
      const historicalBytes = Buffer.from(historical.bytes.content, "base64");
      if (historical.bytes.content !== historicalBytes.toString("base64") || historical.documentId !== member.documentId ||
        historical.expectedStateDigest !== member.historicalArtifact.expectedStateDigest ||
        `sha256:${createHash("sha256").update(historicalBytes).digest("hex")}` !== member.historicalArtifact.artifactDigest) invalidComparison();
      const expected = auditEnvelope(member.reviewedExpectationsEnvelope, "u04-evidence-expectations-v1", auditExpected).payload;
      const measured = auditEnvelope(member.measurementsEnvelope, "u04-reviewed-measurements-v1", auditMeasurements).payload;
      const approval = auditEnvelope(member.approvalEnvelope, "u04-reviewed-evidence-approval-v1", auditApproval).payload;
      const source = expected.source;
      if (source.documentId !== member.documentId || expected.evidenceMode !== admission.evidenceMode || approval.evidenceMode !== admission.evidenceMode ||
        measured.producer.evidenceMode !== admission.evidenceMode || measured.expectationsDigest !== binding.expectationsDigest ||
        approval.expectationsDigest !== binding.expectationsDigest || approval.measurementsDigest !== binding.measurementsDigest ||
        approval.reviewer.identity === measured.producer.identity) invalidComparison();
      auditEqual(source, measured.source); auditEqual(source, approval.source); auditEqual(measured.producer, approval.producer);
      const reviewRef = approval.reviewer.evidence;
      if (reviewRef.tag !== "retained_payload" || reviewRef.representation !== "producer_json" || reviewRef.envelopeDigest !== approval.reviewer.evidenceDigest) invalidComparison();
      const review = auditMeasurementReview(resolver.resolve({ ref: reviewRef, path: [] }));
      auditEqual(review.source, source); auditEqual(review.reviewer, { identity: approval.reviewer.identity, role: approval.reviewer.role, reviewedAt: approval.reviewer.reviewedAt });
      if (review.expectationsDigest !== binding.expectationsDigest || review.measurementsDigest !== binding.measurementsDigest ||
        review.producerIdentity !== measured.producer.identity || review.evidenceMode !== admission.evidenceMode) invalidComparison();
      const authority = auditSourceAuthority(origin, source, profile); auditPolicies(source, resolver, profile, admission);
      if (authority.metadata.document_status !== undefined && authority.metadata.document_status !== expected.lifecycle) invalidComparison();
      if (!resolver.evidence(expected.lifecycleEvidence).some((value) => value === expected.lifecycle)) invalidComparison();
      const selected = auditSelected(origin, source); auditProjectionSources(source, authority.document, selected, profile);
      const reconciled = auditMeasuredDocument(expected, measured, selected, resolver);
      auditCheckEdges(reconciled.relationships, auditEdges(authority.document, selected, resolver), measured, resolver);
      return { member, expected, measured, source, authority, selected, limitations: reconciled.limitations };
    });
    const cases = auditEnvelope(input.caseResultsEnvelope, "evaluation_report", auditCaseReport).payload;
    const ordered = auditValidateReport(cases, profile, origin, members.map((entry) => entry.source), new Map(members.map((entry) => [entry.source.documentId, entry.selected])));
    const limitations = [...members.flatMap((member) => member.limitations), ...cases.executions.flatMap((execution) => execution.limitations)];
    for (const execution of cases.executions) if (execution.outcome !== "complete") {
      limitations.push({ version: 1, code: "measurement_unavailable", scope: { family: "chunks", key: "*" }, evidence: [],
        explanation: "A bound actual engine invocation is incomplete.", blocks: ["audit_mapping", "full_engine_evaluation"] });
    }
    const retrievedDocumentIdsByCase: Record<string, string[]> = Object.create(null);
    let representable = !limitations.some((entry) => entry.code === "source_identity_unavailable" || entry.explanation === "A required reviewed structure judgement is unavailable.");
    const mapped: IngestionAuditInput[] = [];
    for (const member of members) {
      const mustPassCases: IngestionAuditInput["mustPassCases"] = [];
      const seen = new Set<string>();
      for (const required of member.expected.mustPassCases) {
        if (seen.has(required.id)) invalidComparison(); seen.add(required.id);
        const matches = cases.executions.map((execution, ordinal) => ({ execution, ordinal })).filter(({ execution }) => execution.caseId === required.id);
        if (matches.length !== 1) {
          representable = false;
          limitations.push({ version: 1, code: "measurement_unavailable", scope: { family: "chunks", key: "*" }, evidence: [],
            explanation: "A required textual case ID does not resolve to exactly one bound execution.", blocks: ["audit_mapping", "full_engine_evaluation"] });
          continue;
        }
        const { execution, ordinal } = matches[0]!; const ids = ordered.get(ordinal)!;
        const result = execution.documentResults.find((entry) => entry.documentId === member.source.documentId);
        if (!result || result.expectedDocumentRank !== required.expectedDocumentRank) invalidComparison();
        retrievedDocumentIdsByCase[required.id] = ids;
        const actualRank = result.actualDocumentRank;
        const codes = [...result.failureCodes];
        const incomplete = execution.outcome !== "complete";
        const failedCode = execution.outcome === "timeout" ? "case_timeout" : execution.outcome === "provider_failure" ? "provider_failure" : null;
        if (failedCode !== null && !codes.includes(failedCode)) invalidComparison();
        if ((incomplete && actualRank !== null) || (execution.outcome === "incomplete" && codes.length === 0)) representable = false;
        if (codes.includes("source_role_mismatch") && execution.answer?.programmeDiagnostics?.insufficiencyReason !== "source_role_mismatch") representable = false;
        if (codes.includes("governance_block") && execution.answer?.programmeDiagnostics?.insufficiencyReason !== "governance_block") representable = false;
        const exceeds = actualRank !== null && required.expectedDocumentRank !== null && actualRank > required.expectedDocumentRank;
        if (!incomplete && actualRank === null && !codes.includes("document_not_retrieved")) invalidComparison();
        if (exceeds && !codes.includes("document_rank_exceeded")) invalidComparison();
        mustPassCases.push({ id: required.id, passed: !incomplete && actualRank !== null && !exceeds && codes.length === 0,
          expectedDocumentRank: required.expectedDocumentRank, actualDocumentRank: actualRank, failureCodes: codes });
      }
      const metadata = member.authority.metadata;
      const nullableText = (key: string) => metadata[key] === undefined || metadata[key] === null ? null : identityText(metadata[key]);
      const catalogueKey = member.source.source.tag === "document_owned" ? null : member.source.source.sourceCatalogueKey;
      const catalogueEntry = catalogueKey === null ? null : australianSourceByKey(catalogueKey);
      const governance = metadata.source_excluded === false && metadata.content_mode === "indexed_content" && metadata.licence_policy === "public_index_permitted" &&
        metadata.source_role !== "reference_link" && metadata.source_role !== null && metadata.source_role !== undefined &&
        ["uploaded_local", "australian_public", "international_supplementary"].includes(String(metadata.corpus_scope)) &&
        (metadata.corpus_scope !== "australian_public" || (catalogueEntry !== null && catalogueEntry !== undefined &&
          member.source.sourcePolicyVersion === australianSourcePolicyVersion && catalogueEntry.roles.includes(auditSourceRole(metadata.source_role)) &&
          isIndexableAustralianSource(catalogueKey!, "public_index_permitted")));
      const mappedValue = { documentId: member.source.documentId, expectedStateDigest: origin.envelope.digest.slice(7),
        activeGenerationId: member.source.baselineGenerationId, lifecycle: member.expected.lifecycle,
        metadata: { publisher: nullableText("publisher"), jurisdiction: nullableText("jurisdiction"), corpusScope: nullableText("corpus_scope"),
          sourceRole: nullableText("source_role"), contentMode: nullableText("content_mode"), licencePolicy: nullableText("licence_policy"),
          sourcePolicyVersion: member.source.sourcePolicyVersion, sourceCatalogueKey: catalogueKey,
          sourceExcluded: booleanValue(metadata.source_excluded) },
        sourceGovernanceValid: governance, ...member.measured.fields, mustPassCases };
      if (representable) mapped.push(parseIngestionAuditInput(mappedValue));
    }
    // No partial inventory can escape. Diagnostic inputs exist only when every member maps honestly.
    const inventory = representable && mapped.length === members.length ? parseIngestionAuditInventory({ schemaVersion: 1,
      inventoryVersion: "u04-reviewed-manual-p04-v1", documents: mapped, retrievedDocumentIdsByCase }) : null;
    const audits = inventory === null ? [] : inventory.documents.map(auditDocument);
    const prepared: AuditPreparation = { kind: inventory === null || limitations.length > 0 || audits.some((audit) => !audit.eligibleForShadowPlan)
      ? "shadow-audit-incomplete" as const : "shadow-audit-prepared" as const,
      evidenceMode: admission.evidenceMode, input, admission, executionProfile: profile.payload,
      inventory, audits, limitations, caseReport: cases };
    freezeTree(prepared);
    return prepared;
  } catch {
    return invalidComparison(); // Static message; never echo retained source content or an underlying parser payload.
  }
}

// Enqueue data is evidence, never an admission channel. The independent argument
// is deliberately absent from the four SQL parameters and the retained bundle.
const persistenceObservations = record({ auditPreparedAt: auditSqlTimestamp,
  baselineCompletedAt: auditSqlTimestamp, recoveryCheckedAt: auditSqlTimestamp });
const persistencePlanCore = record({ version: fixedNumber(1), targetProjectRef: projectReference,
  sourcePolicyVersion: versionValue, auditDigest: digestValue, populationFingerprint: digestValue,
  candidateGenerationId: uuidValue, documents: list(record({ documentId: uuidValue,
    expectedStateDigest: auditBareDigest, baselineGenerationId: nullable(uuidValue) }), 1), chunkingExperiment: booleanValue });
const persistencePlan = record({ kind: choice("u04-enqueue-plan-v1"), plan: persistencePlanCore,
  audit: record({ input: auditInputTransport, coverageEnvelope: auditAnyEnvelope, p04ReportEnvelope: auditAnyEnvelope,
    validation: persistenceObservations }) });
const persistenceOperationManifest = record({ version: fixedNumber(1),
  operation: choice("stage", "evaluate", "promote", "rollback", "cleanup"), targetProjectRef: projectReference,
  planPath: nonemptyString, reportOrReceiptPath: nullable(nonemptyString), recoveryEvidencePath: nonemptyString,
  recoveryEvidenceSha256: digestValue, expectedDocumentIds: list(uuidValue, 1), expectedDocumentCount: positiveInteger,
  confirmationSha256: digestValue, authorizedAt: auditSqlTimestamp, expiresAt: auditSqlTimestamp });
const persistenceOperation = record({ kind: choice("u04-enqueue-operation-v1"), manifest: persistenceOperationManifest,
  planDigest: digestValue, baselineEvaluationDigest: digestValue, recoveryEnvelopeDigest: digestValue });
const persistenceParameters = record({ p_plan: auditAnyEnvelope, p_baseline_evaluation: auditAnyEnvelope,
  p_recovery_evidence: auditAnyEnvelope, p_operation_manifest: auditAnyEnvelope });
const persistenceAdmission = record({ audit: auditAdmission, planDigest: digestValue, baselineEvaluationDigest: digestValue,
  recoveryEnvelopeDigest: digestValue, operationManifestDigest: digestValue, coverageEnvelopeDigest: digestValue,
  p04ReportEnvelopeDigest: digestValue, rawRecoveryFileDigest: digestValue, recoveryEvidenceDigest: digestValue,
  manifest: persistenceOperationManifest, validation: persistenceObservations });
const persistenceBundle = record({ kind: choice("u04-original-recovery-bundle-v1"), parameters: persistenceParameters });
export type ShadowPersistenceParametersV1 = Readonly<ReturnType<typeof persistenceParameters>>;

/**
 * Intrinsic readback of the persisted reservation for the actual Node worker.
 * This is not controller admission: each fixed writer still checks live source,
 * deadline, first-token and checkpoint authority under its database locks.
 */
export function readShadowWorkerContextV1(value: unknown, fenceValue: unknown, trustedNowValue: unknown) {
  try {
    const input = record({ member: auditStoredRowSchema("document_index_generations"),
      wave: auditStoredRowSchema("shadow_reindex_waves"), baseline: auditStoredRowSchema("document_generation_baselines"),
      document: auditStoredRowSchema("documents") })(value);
    const fence = record({ job_kind: choice("node"), job_id: uuidValue, document_id: uuidValue, worker_id: nonemptyString,
      lease_token: uuidValue, expected_generation_id: nullable(uuidValue), authority_digest: digestValue })(fenceValue);
    const member = input.member; const wave = input.wave; const baseline = input.baseline;
    const plan = auditEnvelope(wave.plan_payload, "plan", persistencePlan);
    const origin = auditOrigin(plan.payload.audit.input.originEnvelope);
    const profile = parseShadowExecutionProfileEnvelope(origin.payload.executionProfileEnvelope);
    const source = auditSource(member.source_binding);
    const authority = auditSourceAuthority(origin, source, profile);
    const checkpoint = shadowControlCheckpoint(member.control_snapshot);
    if (checkpoint.ownNodeJobs.length !== 1) invalidComparison();
    const job = checkpoint.ownNodeJobs[0]!;
    const bundle = auditEnvelope(baseline.bundle_payload, "baseline", persistenceBundle, "pg-jsonb-text-v1");
    const operation = auditEnvelope(bundle.payload.parameters.p_operation_manifest, "plan", persistenceOperation);
    const now = shadowMicros(trustedNowValue);
    const candidateGenerationId = uuidValue(member.index_generation_id);
    const expected = plan.payload.plan.documents.find(entry => entry.documentId === fence.document_id);
    if (!expected || member.state !== "building" || member.job_id !== fence.job_id || member.document_id !== fence.document_id ||
      member.first_lease_token !== fence.lease_token || member.baseline_generation_id !== fence.expected_generation_id ||
      member.authority_digest !== fence.authority_digest || member.owner_id !== source.ownerId ||
      source.documentId !== fence.document_id || source.baselineGenerationId !== fence.expected_generation_id ||
      source.authorityDigest !== fence.authority_digest || candidateGenerationId === fence.expected_generation_id ||
      wave.candidate_generation_id !== candidateGenerationId || plan.payload.plan.candidateGenerationId !== candidateGenerationId ||
      wave.plan_digest !== plan.envelope.digest || wave.prepared_origin_digest !== origin.envelope.digest ||
      wave.execution_profile_digest !== profile.bytes.envelope.digest || wave.case_set_digest !== profile.payload.cases.digest ||
      member.expected_state_digest !== expected.expectedStateDigest || expected.expectedStateDigest !== origin.envelope.digest.slice(7) ||
      expected.baselineGenerationId !== fence.expected_generation_id || member.baseline_bundle_digest !== bundle.envelope.digest ||
      baseline.bundle_digest !== bundle.envelope.digest || baseline.document_id !== fence.document_id ||
      baseline.candidate_generation_id !== candidateGenerationId || baseline.baseline_generation_id !== fence.expected_generation_id ||
      baseline.expected_state_digest !== member.expected_state_digest ||
      checkpoint.controlRevision !== member.control_revision || job.id !== fence.job_id || job.document_id !== fence.document_id ||
      job.operation !== "shadow_reindex" || job.status !== "processing" || job.attempt_count !== 1 || job.max_attempts !== 1 ||
      job.batch_id !== null || job.locked_by !== fence.worker_id || job.lease_token !== fence.lease_token ||
      job.lease_expected_generation_id !== fence.expected_generation_id || job.lease_write_generation_id !== candidateGenerationId ||
      job.lease_authority_digest !== fence.authority_digest || job.shadow_plan_digest !== plan.envelope.digest ||
      now >= shadowMicros(job.lease_expires_at) || operation.payload.manifest.operation !== "stage" ||
      now < shadowMicros(operation.payload.manifest.authorizedAt) || now >= shadowMicros(operation.payload.manifest.expiresAt)) invalidComparison();
    auditEqual(member.original_origin_envelope, origin.envelope);
    auditEqual(input.document, authority.document.row);
    auditEqual(bundle.payload.parameters.p_plan, plan.envelope);
    auditEqual(bundle.payload.parameters.p_baseline_evaluation, wave.baseline_report);
    auditEqual(plan.payload.audit.input.caseResultsEnvelope, wave.baseline_report);
    const ids = plan.payload.plan.documents.map(entry => entry.documentId);
    exactPopulation(ids, profile.payload.documentIds);
    const manifest = parseShadowInventoryManifestPayload(member.inventory_manifest).payload;
    if (manifest.documentId !== fence.document_id || manifest.candidateGenerationId !== candidateGenerationId || manifest.jobId !== fence.job_id)
      invalidComparison();
    const binding = shadowCandidateView({ tag: "candidate", source, candidateGenerationId,
      jobId: fence.job_id, firstLeaseToken: fence.lease_token, artifactGenerationId: null });
    return freezeTree({ kind: "shadow-worker-reservation-readback" as const, binding,
      planEnvelope: plan.envelope, executionProfileEnvelope: profile.bytes.envelope,
      executionProfile: profile.payload, originalOriginEnvelope: origin.envelope, baselineBundleEnvelope: bundle.envelope,
      controlRevision: checkpoint.controlRevision, controlSnapshot: checkpoint, inventoryManifest: manifest });
  } catch { return invalidComparison(); }
}
export type ShadowWorkerContextV1 = ReturnType<typeof readShadowWorkerContextV1>;

export type ShadowProducerBatchV1 = Readonly<{
  groupKey: (typeof inventorySlots)[InventoryFamily][number];
  families: readonly InventoryFamily[];
  artifactGenerationId: string | null;
  producerVersion: string;
  units: readonly { family: InventoryFamily; key: string; output: unknown }[];
}>;

/** Preserve own-undefined native fields separately from the actual JSON RPC input. */
export function captureShadowProducerInputV1(value: unknown) {
  const ownUndefinedPaths: (string | number)[][] = [];
  const ancestors = new Set<object>();
  function capture(input: unknown, path: (string | number)[]): AuditJson {
    if (input === undefined) { ownUndefinedPaths.push(path); return null; }
    if (input === null || typeof input !== "object") return auditJson(input);
    if (types.isProxy(input) || ancestors.has(input)) invalidComparison();
    ancestors.add(input);
    try {
      const descriptors = dataProperties(input, invalidComparison);
      if (Array.isArray(input)) {
        if (Object.getPrototypeOf(input) !== Array.prototype || Object.keys(descriptors).length !== input.length + 1) invalidComparison();
        return Array.from({ length: input.length }, (_, index) => {
          const descriptor = descriptors[String(index)];
          if (!descriptor || !descriptor.enumerable) invalidComparison();
          return capture(descriptor.value, [...path, index]);
        });
      }
      if (!isPlainObject(input)) invalidComparison();
      const result: { [key: string]: AuditJson } = {};
      for (const key of Object.keys(descriptors).sort(compareText)) {
        const descriptor = descriptors[key]!;
        if (!descriptor.enumerable) invalidComparison();
        const retained = capture(descriptor.value, [...path, key]);
        if (descriptor.value !== undefined) Object.defineProperty(result, key, { value: retained, enumerable: true, writable: true, configurable: true });
      }
      return result;
    } finally { ancestors.delete(input); }
  }
  return freezeTree({ input: capture(value, []), ownUndefinedPaths });
}

/** Reconstruct native own-property presence and prove the retained RPC bytes round-trip. */
export function readShadowProducerInputV1(value: unknown) {
  const retained = record({ input: auditJson, ownUndefinedPaths: list(list((part: unknown) =>
    typeof part === "string" ? stringValue(part) : nonnegativeInteger(part))) })(value);
  let nativeInput: unknown = auditJson(retained.input);
  for (const path of retained.ownUndefinedPaths) {
    if (path.length === 0) {
      if (nativeInput !== null || retained.ownUndefinedPaths.length !== 1) invalidComparison();
      nativeInput = undefined;
      continue;
    }
    let parent: unknown = nativeInput;
    for (const [index, part] of path.entries()) {
      if (parent === null || typeof parent !== "object" ||
        (Array.isArray(parent) ? typeof part !== "number" || part >= parent.length : typeof part !== "string")) invalidComparison();
      const descriptor = Object.getOwnPropertyDescriptor(parent, part);
      if (index < path.length - 1) {
        if (!descriptor) invalidComparison();
        parent = descriptor.value;
      } else {
        // JSON arrays retain an undefined slot as null; objects omit that key.
        if (Array.isArray(parent) ? descriptor?.value !== null : descriptor !== undefined) invalidComparison();
        Object.defineProperty(parent, part, { value: undefined, enumerable: true, writable: true, configurable: true });
      }
    }
  }
  // This also rejects duplicates, ancestor conflicts and noncanonical path order.
  auditEqual(captureShadowProducerInputV1(nativeInput), retained);
  return freezeTree({ input: retained.input, ownUndefinedPaths: retained.ownUndefinedPaths, nativeInput });
}

/** Full native/planned output is frozen once, before the first artifact effect. */
export function prepareShadowProducerDeclarationV1(bindingValue: unknown, revisionValue: unknown, batch: ShadowProducerBatchV1) {
  const binding = shadowCandidateView(bindingValue);
  const revision = nonnegativeInteger(revisionValue);
  const families = list(inventoryFamily, 1)(batch.families);
  sortedUnique(families, compareText);
  const artifactGenerationId = nullable(uuidValue)(batch.artifactGenerationId);
  if (artifactGenerationId === binding.candidateGenerationId ||
    (artifactGenerationId !== null && artifactGenerationId === binding.source.baselineGenerationId) ||
    (batch.groupKey === "deep_memory") !== (artifactGenerationId !== null)) invalidComparison();
  for (const family of families) {
    const slots: readonly string[] = inventorySlots[family];
    if (!slots.includes(batch.groupKey)) invalidComparison();
  }
  const view = { ...binding, artifactGenerationId };
  const units = batch.units.map(unit => ({ family: inventoryFamily(unit.family), key: nonemptyString(unit.key), output: unit.output }));
  units.sort((a, b) => compareText(a.family, b.family) || compareText(a.key, b.key));
  sortedUnique(units, (a, b) => compareText(a.family, b.family) || compareText(a.key, b.key));
  if (units.some(unit => !families.includes(unit.family))) invalidComparison();
  // The canonical encoder rejects getters, custom serialization and unsupported
  // values without invoking them. Nothing is silently stripped from native output.
  const outputManifestEnvelope = createShadowNodeJsonByteEnvelope({
    producer: "local-worker", producerVersion: nonemptyString(batch.producerVersion), binding: view, units,
  }, "u04-retained-evidence-v1").envelope;
  const ref = { tag: "retained_payload" as const, envelopeDigest: outputManifestEnvelope.digest,
    representation: "producer_json" as const, mediaType: "application/json",
    byteLength: Buffer.byteLength(outputManifestEnvelope.canonicalPayload, "utf8") };
  const groups = families.map(family => {
    const expectedUnits = units.filter(unit => unit.family === family).map(({ family: unitFamily, key }) => ({ family: unitFamily, key }));
    return { family, groupKey: batch.groupKey, declaration: { firstLeaseToken: binding.firstLeaseToken,
      producer: { name: "local-worker", version: batch.producerVersion, outputManifestDigest: outputManifestEnvelope.digest },
      artifactGenerationId, outputManifestEnvelope, population: { tag: "known" as const, expectedUnits,
        basis: [{ ref, path: ["units"] }], reason: expectedUnits.length === 0 ? "no_units_expected" as const : null } } };
  });
  const declarations = units.map(unit => ({ family: unit.family, unitKey: unit.key, expected: true,
    required: ["pages", "chunks", "images", "table_facts", "embedding_fields", "quality", "document_metadata", "private_objects", "attempt_control", "cache_inputs", "repair_audit_inputs"].includes(unit.family) ||
      (unit.family === "index_units" && batch.groupKey === "worker_core"), producer: "local-worker", sourceBinding: view }));
  return freezeTree({ outputManifestEnvelope, declarations: { version: 1 as const, expectedControlRevision: revision, groups, units: declarations } });
}


/** Validates one complete candidate component; it grants no terminal or controller authority. */
export function readShadowSummaryProjectionV1(envelopeValue: unknown, bindingValue: unknown, profileValue: unknown, sourceRowsValue: unknown) {
  const binding = shadowCandidateView(bindingValue);
  if (binding.artifactGenerationId !== null || binding.candidateGenerationId === binding.source.baselineGenerationId) invalidComparison();
  const profile = parseShadowExecutionProfileEnvelope(profileValue);
  if (profile.bytes.envelope.digest !== binding.source.executionProfileDigest) invalidComparison();
  const parsed = auditEnvelope(envelopeValue, "projection", record({ kind: choice("u04-summary-projection-v1"), binding: shadowCandidateView,
    outputManifestEnvelope: auditAnyEnvelope, summary: row => auditObject(auditStoredRowSchema("document_summaries")(row)),
    generated_labels: list(row => auditObject(auditStoredRowSchema("document_labels")(row))), summary_projection_complete: booleanValue,
    enrichment_metadata: record({ rag_enrichment_version: choice("rag-deep-memory-v1"), rag_indexing_version: choice("rag-deep-memory-v1"),
      rag_memory_version: choice("rag-deep-memory-v1"), rag_enrichment_updated_at: auditSqlTimestamp, generated_label_count: nonnegativeInteger }),
  }), "pg-jsonb-text-v1");
  const component = parsed.payload;
  auditEqual(component.binding, binding);
  if (!component.summary_projection_complete || component.enrichment_metadata.generated_label_count !== component.generated_labels.length) invalidComparison();
  const sourceRows = record({ chunks: list(row => auditStoredRow("document_chunks", row)), images: list(row => auditStoredRow("document_images", row)) })(sourceRowsValue);
  for (const rows of [sourceRows.chunks, sourceRows.images]) {
    if (new Set(rows.map(row => uuidValue(row.row.id))).size !== rows.length) invalidComparison();
    for (const entry of rows) {
      const metadata = auditObject(entry.row.metadata);
      if (entry.row.document_id !== binding.source.documentId || auditGeneration(entry) !== binding.candidateGenerationId ||
        metadata.ingestion_job_kind !== "node" || metadata.ingestion_job_id !== binding.jobId || metadata.ingestion_lease_token !== binding.firstLeaseToken) invalidComparison();
    }
  }
  const manifest = auditEnvelope(component.outputManifestEnvelope, "u04-retained-evidence-v1", record({ producer: choice("local-worker"),
    producerVersion: choice("rag-deep-memory-v1"), binding: shadowCandidateView,
    units: list(record({ family: choice("summary", "generated_labels"), key: nonemptyString, output: auditObject })),
  })).payload;
  auditEqual(manifest.binding, binding);
  sortedUnique(manifest.units, (a,b) => compareText(a.family,b.family) || compareText(a.key,b.key));
  const summaries = manifest.units.filter(unit => unit.family === "summary");
  if (summaries.length !== 1 || summaries[0]!.key !== "singleton") invalidComparison();
  const summary = component.summary; const summaryMetadata = auditObject(summary.metadata);
  const stamps = { index_generation_id: binding.candidateGenerationId, ingestion_job_kind: "node", ingestion_job_id: binding.jobId, ingestion_lease_token: binding.firstLeaseToken };
  for (const row of [summary, ...component.generated_labels]) {
    if (row.document_id !== binding.source.documentId || row.owner_id !== binding.source.ownerId) invalidComparison();
    const metadata = auditObject(row.metadata);
    for (const [key,value] of Object.entries(stamps)) if (metadata[key] !== value) invalidComparison();
    if (shadowMicros(row.updated_at) !== shadowMicros(row.created_at)) invalidComparison();
  }
  if (summaryMetadata.generated_by !== "local-worker" || summaryMetadata.source_anchored_summary_projection_complete_v1 !== true ||
    auditObject(summaryMetadata.source_anchored_summary_v1).summary_kind !== "structured" ||
    auditObject(summaryMetadata.source_anchored_summary_v1).heuristic_fallback !== false ||
    shadowMicros(summary.created_at) < shadowMicros(summary.generated_at) ||
    component.enrichment_metadata.rag_enrichment_updated_at !== summary.generated_at) invalidComparison();
  auditStructuredSummaryProjection(binding.source.documentId, binding.candidateGenerationId, {
    document_summaries: [{ row: summary }], document_labels: component.generated_labels.map(row => ({ row })),
    document_chunks: sourceRows.chunks, document_images: sourceRows.images.filter(row => row.row.searchable === true),
  }, profile);
  const originalMetadata = { ...summaryMetadata };
  for (const key of ["ingestion_job_kind", "ingestion_job_id", "ingestion_lease_token"]) delete originalMetadata[key];
  const { id: _id, created_at: _created, updated_at: _updated, ...originalSummary } = summary;
  auditEqual(summaries[0]!.output, { summary: { ...originalSummary, metadata: originalMetadata, updated_at: summary.generated_at },
    enrichment_metadata: component.enrichment_metadata });
  const nativeLabels = manifest.units.filter(unit => unit.family === "generated_labels");
  if (nativeLabels.length !== component.generated_labels.length) invalidComparison();
  for (const row of component.generated_labels) {
    const key = encodeShadowNodeJsonCanonicalPayload({ label: row.label, label_type: row.label_type });
    const native = nativeLabels.find(unit => unit.key === key);
    if (!native) invalidComparison();
    const { id: _labelId, created_at: _labelCreated, updated_at: _labelUpdated, ...originalLabel } = row;
    const metadata = { ...auditObject(row.metadata) };
    for (const stamp of ["ingestion_job_kind", "ingestion_job_id", "ingestion_lease_token"]) delete metadata[stamp];
    auditEqual(native.output, { ...originalLabel, metadata });
  }
  return freezeTree({ kind: "shadow-summary-component-validated" as const, envelope: parsed.envelope, payload: component });
}
const shadowQualityCountKeys = ["page_count", "ocr_page_count", "needs_ocr_page_count", "text_character_count",
  "extracted_image_count", "searchable_image_count", "skipped_image_count", "section_count", "memory_card_count"] as const;
const shadowQualityRatioKeys = ["duplicate_chunk_ratio", "heading_density", "section_path_coverage", "ocr_coverage"] as const;
const shadowQualityNullableKeys = ["table_extraction_coverage", "searchable_image_coverage", "visual_unit_coverage",
  "average_image_quality_score", "average_crop_completeness", "average_structured_visual_confidence"] as const;
const shadowQualityNullColumns = ["anchor_coverage", "model_fallback_rate", "noisy_unit_rate",
  "retrievable_visual_hit", "source_span_coverage", "typed_unit_coverage"] as const;
const shadowCountMap = (value: unknown) => {
  const counts = auditObject(value);
  for (const count of Object.values(counts)) nonnegativeInteger(count);
  return counts;
};
const shadowQualityMetrics: Schema<Record<string, unknown>> = record({
  ...Object.fromEntries(shadowQualityCountKeys.map(key => [key, nonnegativeInteger])),
  ...Object.fromEntries(shadowQualityRatioKeys.map(key => [key, boundedNumber(0, 1)])),
  ...Object.fromEntries(shadowQualityNullableKeys.map(key => [key, nullable(boundedNumber(0, 1))])),
  avg_chunk_length: nonnegative, average_page_text_chars: nonnegative,
  skipped_image_reasons: shadowCountMap, image_type_counts: shadowCountMap,
  extraction_warnings: list(stringValue), document_embedding_field_types: list(stringValue),
  optional_index_write_issues: list(record({ stage: stringValue, message: stringValue }, { code: nullable(stringValue) })),
  search_eval_hit_rate: (value: unknown) => { if (value !== null) invalidComparison(); return null; },
});

/** Reconciles the stored quality after-image with the original producer output and C population.
 * This mechanical component proof is not an answer-quality evaluation or a member seal.
 */
export function readShadowQualityProjectionV1(envelopeValue: unknown, bindingValue: unknown, sourceRowsValue: unknown) {
  const binding = shadowCandidateView(bindingValue);
  if (binding.artifactGenerationId !== null || binding.candidateGenerationId === binding.source.baselineGenerationId) invalidComparison();
  const component = auditEnvelope(envelopeValue, "projection", record({ kind: choice("u04-quality-projection-v1"),
    binding: shadowCandidateView, outputManifestEnvelope: auditAnyEnvelope,
    quality: auditStoredRowSchema("document_index_quality") }), "pg-jsonb-text-v1");
  auditEqual(component.payload.binding, binding);
  const manifest = auditEnvelope(component.payload.outputManifestEnvelope, "u04-retained-evidence-v1", record({
    producer: choice("local-worker"), producerVersion: choice("rag-deep-memory-v1"), binding: shadowCandidateView,
    units: list(record({ family: choice("quality"), key: choice("singleton"), output: auditObject })) })).payload;
  auditEqual(manifest.binding, binding);
  if (manifest.units.length !== 1) invalidComparison();
  const quality = component.payload.quality;
  if (quality.document_id !== binding.source.documentId || quality.owner_id !== binding.source.ownerId) invalidComparison();
  boundedNumber(0, 1)(quality.quality_score); choice("good", "partial", "poor")(quality.extraction_quality);
  const original = { ...quality };
  for (const key of shadowQualityNullColumns) {
    if (quality[key] !== null) invalidComparison();
    delete original[key];
  }
  const native = manifest.units[0]!.output;
  // PostgreSQL renders timestamptz with an offset; retain both spellings while
  // proving the instant before comparing every other producer field exactly.
  if (shadowMicros(native.updated_at) !== shadowMicros(quality.updated_at)) invalidComparison();
  original.updated_at = native.updated_at;
  auditEqual(native, original);
  const metrics = shadowQualityMetrics(quality.metrics);
  const sources = record({ pages: list(value => auditStoredRow("document_pages", value)),
    images: list(value => auditStoredRow("document_images", value)),
    sections: list(value => auditStoredRow("document_sections", value)),
    cards: list(value => auditStoredRow("document_memory_cards", value)),
    embeddingFields: list(value => auditStoredRow("document_embedding_fields", value)) })(sourceRowsValue);
  for (const rows of Object.values(sources)) {
    if (new Set(rows.map(row => row.row.id)).size !== rows.length) invalidComparison();
    for (const entry of rows) {
      const metadata = auditObject(entry.row.metadata);
      if (entry.row.document_id !== binding.source.documentId || auditGeneration(entry) !== binding.candidateGenerationId ||
        metadata.ingestion_job_kind !== "node" || metadata.ingestion_job_id !== binding.jobId ||
        metadata.ingestion_lease_token !== binding.firstLeaseToken) invalidComparison();
    }
  }
  if (metrics.page_count !== sources.pages.length || metrics.searchable_image_count !== sources.images.filter(row => row.row.searchable === true).length ||
    metrics.section_count !== sources.sections.length || metrics.memory_card_count !== sources.cards.length ||
    Number(metrics.ocr_page_count) > Number(metrics.page_count) || Number(metrics.needs_ocr_page_count) > Number(metrics.page_count)) invalidComparison();
  auditEqual(metrics.document_embedding_field_types, [...new Set(sources.embeddingFields.map(row => stringValue(row.row.field_type))
    .filter(type => type === "document_title" || type === "document_summary"))].sort(compareText));
  return freezeTree({ kind: "shadow-quality-component-validated" as const, envelope: component.envelope, payload: component.payload });
}

const shadowWorkerCountFields = {
  page_count: nonnegativeInteger, ocr_page_count: nonnegativeInteger, needs_ocr_page_count: nonnegativeInteger,
  text_character_count: nonnegativeInteger, extracted_image_count: nonnegativeInteger,
  searchable_image_count: nonnegativeInteger, skipped_image_count: nonnegativeInteger,
} as const;
const shadowWorkerExtractionSummary = record({
  page_count: nonnegativeInteger, text_character_count: nonnegativeInteger, table_count: nonnegativeInteger,
  table_cell_count: nonnegativeInteger, numeric_token_count: nonnegativeInteger,
});
const shadowWorkerLegacyExtractionSummary = record({
  page_count: nonnegativeInteger, text_character_count: nonnegativeInteger, ocr_page_count: nonnegativeInteger,
  table_count: nonnegativeInteger, table_row_count: nonnegativeInteger, numeric_token_count: nonnegativeInteger,
  wall_ms: nullable(nonnegative),
});
const shadowWorkerExtractionDelta = record({
  page_count: numberValue, text_character_ratio: nullable(numberValue), table_count: numberValue,
  numeric_token_ratio: nullable(numberValue),
});
const shadowWorkerExtractionMetadata = (value: unknown) => {
  const metadata = record({
    version: fixedNumber(1), extractor: choice("docling"), mode: choice("shadow"), index_generation_id: uuidValue,
    cohort_percent: boundedNumber(1, 5, true), cohort_bucket: boundedNumber(0, 99, true),
    cohort_signals: list(choice("tables", "ocr", "layout")),
    outcome: choice("ok", "extraction_failed", "timeout", "runtime_unavailable", "process_error", "skipped_page_cap", "skipped_concurrent"),
    error_kind: nullable(stringValue), measured_at: auditSqlTimestamp, docling_version: nullable(stringValue),
    wall_ms: nullable(nonnegative), peak_rss_bytes: nullable(nonnegativeInteger), exit_code: nullable(nonnegativeInteger),
    docling: nullable(shadowWorkerExtractionSummary), legacy: shadowWorkerLegacyExtractionSummary,
    delta: nullable(shadowWorkerExtractionDelta),
  })(value);
  if (new Set(metadata.cohort_signals).size !== metadata.cohort_signals.length ||
    (metadata.outcome === "ok") !== (metadata.docling !== null && metadata.delta !== null)) invalidComparison();
  if (metadata.delta !== null &&
    (!Number.isSafeInteger(metadata.delta.page_count) || !Number.isSafeInteger(metadata.delta.table_count))) invalidComparison();
  return metadata;
};
const shadowWorkerMetadata = record({
  indexed_at: auditSqlTimestamp, index_generation_id: uuidValue, cover_image_id: nullable(uuidValue),
  rag_enrichment_version: choice("rag-deep-memory-v1"), rag_indexing_version: choice("rag-deep-memory-v1"),
  rag_memory_version: choice("rag-deep-memory-v1"), rag_memory_updated_at: nullable(auditSqlTimestamp),
  rag_enrichment_updated_at: nullable(auditSqlTimestamp), enrichment_status: choice("pending", "completed", "failed"),
  enrichment_error: nullable(stringValue), section_count: nonnegativeInteger, memory_card_count: nonnegativeInteger,
  extraction_quality: choice("good", "partial", "poor"), index_quality_score: boundedNumber(0, 1),
  index_quality_issues: list(stringValue), index_quality_metrics: shadowQualityMetrics,
  optional_index_write_issues: list(record({ stage: stringValue, message: stringValue }, { code: nullable(stringValue) })),
  indexing_v3_agent_status: choice("pending", "completed"), indexing_v3_agent_last_error: nullable(stringValue),
  indexing_v3_agent_repair_reason: nullable(stringValue), indexing_v3_agent_updated_at: auditSqlTimestamp,
  embedding_model: nonemptyString, ...shadowWorkerCountFields,
  skipped_image_reasons: shadowCountMap, image_type_counts: shadowCountMap, extraction_warnings: list(stringValue),
}, {
  completion_gate_missing: nullable(list(stringValue)), document_embedding_field_types: list(stringValue),
  shadow_extraction: shadowWorkerExtractionMetadata,
});
const shadowWorkerDocumentCounts = record({
  page_count: nonnegativeInteger, chunk_count: nonnegativeInteger, image_count: nonnegativeInteger,
  status: choice("queued", "processing", "indexed", "failed"), error_message: nullable(stringValue),
});

/** Reconciles the complete private worker projection with its original output, quality component and C rows.
 * This mechanical proof does not score output or grant a member seal.
 */
export function readShadowWorkerProjectionV1(envelopeValue: unknown, bindingValue: unknown, profileValue: unknown,
  qualityEnvelopeValue: unknown, sourceRowsValue: unknown) {
  const binding = shadowCandidateView(bindingValue);
  if (binding.artifactGenerationId !== null || binding.candidateGenerationId === binding.source.baselineGenerationId) invalidComparison();
  const profile = parseShadowExecutionProfileEnvelope(profileValue);
  if (profile.bytes.envelope.digest !== binding.source.executionProfileDigest) invalidComparison();
  const sources = record({ pages: list(value => auditStoredRow("document_pages", value)),
    chunks: list(value => auditStoredRow("document_chunks", value)),
    images: list(value => auditStoredRow("document_images", value)),
    sections: list(value => auditStoredRow("document_sections", value)),
    cards: list(value => auditStoredRow("document_memory_cards", value)),
    embeddingFields: list(value => auditStoredRow("document_embedding_fields", value)) })(sourceRowsValue);
  const quality = readShadowQualityProjectionV1(qualityEnvelopeValue, binding, {
    pages: sources.pages.map(row => row.envelope), images: sources.images.map(row => row.envelope),
    sections: sources.sections.map(row => row.envelope), cards: sources.cards.map(row => row.envelope),
    embeddingFields: sources.embeddingFields.map(row => row.envelope),
  });
  const component = auditEnvelope(envelopeValue, "projection", record({ kind: choice("u04-worker-projection-v1"),
    binding: shadowCandidateView, outputManifestEnvelope: auditAnyEnvelope,
    worker_metadata: shadowWorkerMetadata, document_counts: shadowWorkerDocumentCounts,
  }), "pg-jsonb-text-v1");
  auditEqual(component.payload.binding, binding);
  const manifest = auditEnvelope(component.payload.outputManifestEnvelope, "u04-retained-evidence-v1", record({
    producer: choice("local-worker"), producerVersion: choice("rag-deep-memory-v1"), binding: shadowCandidateView,
    units: list(record({ family: choice("document_metadata"), key: choice("singleton"), output: record({
      worker_metadata: shadowWorkerMetadata, document_counts: shadowWorkerDocumentCounts,
    }) })),
  })).payload;
  auditEqual(manifest.binding, binding);
  if (manifest.units.length !== 1) invalidComparison();
  auditEqual(manifest.units[0]!.output, {
    worker_metadata: component.payload.worker_metadata, document_counts: component.payload.document_counts,
  });
  const metadata = component.payload.worker_metadata;
  const counts = component.payload.document_counts;
  if (metadata.index_generation_id !== binding.candidateGenerationId ||
    metadata.embedding_model !== profile.configuration.payload.generation.embeddingModel) invalidComparison();
  if ((metadata.indexing_v3_agent_status === "completed") !== (metadata.enrichment_status === "completed") ||
    (metadata.indexing_v3_agent_status === "completed"
      ? metadata.indexing_v3_agent_last_error !== null || metadata.indexing_v3_agent_repair_reason !== null ||
        metadata.completion_gate_missing !== null
      : metadata.indexing_v3_agent_last_error === null || metadata.indexing_v3_agent_repair_reason === null ||
        Object.hasOwn(metadata, "completion_gate_missing"))) invalidComparison();
  if (metadata.shadow_extraction && metadata.shadow_extraction.index_generation_id !== binding.candidateGenerationId) invalidComparison();
  const qualityRow = quality.payload.quality;
  if (metadata.extraction_quality !== qualityRow.extraction_quality || metadata.index_quality_score !== qualityRow.quality_score) invalidComparison();
  auditEqual(metadata.index_quality_issues, qualityRow.issues);
  auditEqual(metadata.index_quality_metrics, qualityRow.metrics);
  auditEqual(metadata.optional_index_write_issues, auditObject(qualityRow.metrics).optional_index_write_issues);
  for (const key of [...shadowQualityCountKeys, "skipped_image_reasons", "image_type_counts", "extraction_warnings"] as const) {
    if (Object.hasOwn(metadata, key)) auditEqual(metadata[key], auditObject(qualityRow.metrics)[key]);
  }
  if (Object.hasOwn(metadata, "document_embedding_field_types"))
    auditEqual(metadata.document_embedding_field_types, auditObject(qualityRow.metrics).document_embedding_field_types);
  for (const rows of [sources.pages, sources.chunks, sources.images]) {
    if (new Set(rows.map(row => row.row.id)).size !== rows.length) invalidComparison();
    for (const entry of rows) {
      const rowMetadata = auditObject(entry.row.metadata);
      if (entry.row.document_id !== binding.source.documentId || auditGeneration(entry) !== binding.candidateGenerationId ||
        rowMetadata.ingestion_job_kind !== "node" || rowMetadata.ingestion_job_id !== binding.jobId ||
        rowMetadata.ingestion_lease_token !== binding.firstLeaseToken) invalidComparison();
    }
  }
  if (counts.page_count !== sources.pages.length || counts.chunk_count !== sources.chunks.length ||
    counts.image_count !== sources.images.filter(row => row.row.searchable === true).length) invalidComparison();
  if (metadata.cover_image_id !== null && !sources.images.some(row => row.row.id === metadata.cover_image_id)) invalidComparison();
  return freezeTree({ kind: "shadow-worker-component-validated" as const, envelope: component.envelope,
    payload: component.payload, quality });
}

const shadowDeepUnitType = choice("document_profile", "section_summary", "page_text", "chunk_evidence", "table_fact",
  "askable_question", "clinical_fact", "threshold", "workflow_step", "medication_monitoring", "alias", "vocabulary_term",
  "visual_summary", "flowchart_step", "diagram_decision", "risk_matrix_cell", "medication_chart_row", "chart_finding",
  "visual_askable_question", "table_threshold");
const shadowDeepProfileItemFields = { title: stringValue, content: stringValue, source_chunk_ids: list(uuidValue),
  source_image_ids: list(uuidValue), confidence: boundedNumber(0, 1) };
const shadowDeepProfile = record({ sections: list(record(shadowDeepProfileItemFields)),
  askable_questions: list(record(shadowDeepProfileItemFields)), clinical_facts: list(record(shadowDeepProfileItemFields)),
  table_facts: list(record({ ...shadowDeepProfileItemFields, table_title: nullable(stringValue),
    clinical_parameter: nullable(stringValue), threshold_value: nullable(stringValue), action: nullable(stringValue) })),
  aliases: list(record({ alias: stringValue, canonical: stringValue, alias_type: stringValue,
    source_chunk_ids: list(uuidValue), confidence: boundedNumber(0, 1) })), quality_issues: list(stringValue),
  model: nullable(stringValue), version: choice("model-heavy-index-v1") });
const shadowDeepCounts = (input: unknown) => {
  const counts = auditObject(input);
  for (const [key, value] of Object.entries(counts)) { shadowDeepUnitType(key); nonnegativeInteger(value); }
  return counts;
};
const shadowDeepRequest = record({ fence: record({ job_kind: choice("node"), job_id: uuidValue, document_id: uuidValue,
  worker_id: nonemptyString, lease_token: uuidValue, expected_generation_id: nullable(uuidValue), authority_digest: digestValue }),
  artifact_generation: uuidValue, rag_memory_version: choice("rag-deep-memory-v1"),
  document_intelligence_version: choice("document-intelligence-v2"), section_count: nonnegativeInteger,
  memory_card_count: nonnegativeInteger, index_unit_counts_by_type: shadowDeepCounts,
  anchors: list(record({ id: uuidValue, anchor_id: nonemptyString })), aliases: list(record({ alias: stringValue,
    canonical: stringValue, alias_type: stringValue, weight: boundedNumber(0.5, 1.5), enabled: (value: unknown) => {
      if (value !== true) invalidComparison(); return true as const;
    }, metadata: auditObject })) });

/** Reconciles complete native D output with the final C rows; this is not a member seal. */
export function validateShadowCandidateDeepProjectionV1(envelopeValue: unknown, bindingValue: unknown,
  sourceRowsValue: unknown) {
  const binding = shadowCandidateView(bindingValue);
  const d = binding.artifactGenerationId;
  if (d === null || d === binding.candidateGenerationId || d === binding.source.baselineGenerationId) invalidComparison();
  const component = auditEnvelope(envelopeValue, "projection", record({ kind: choice("u04-deep-projection-v1"),
    binding: shadowCandidateView, outputManifestEnvelope: auditAnyEnvelope, deep_memory_receipt: auditAnyEnvelope,
    deep_memory_metadata: auditObject, producer_aliases: list(auditStoredRowSchema("rag_aliases")) }), "pg-jsonb-text-v1");
  auditEqual(component.payload.binding, binding);
  const receipt = auditEnvelope(component.payload.deep_memory_receipt, "projection", record({
    kind: choice("u04-deep-memory-receipt-v1"), binding: shadowCandidateView, producer: choice("local-worker"),
    outputManifestEnvelope: auditAnyEnvelope, request: shadowDeepRequest,
    rows: record({ sections: list(value => auditStoredRow("document_sections", value)),
      cards: list(value => auditStoredRow("document_memory_cards", value)),
      units: list(value => auditStoredRow("document_index_units", value)), aliases: list(value => auditStoredRow("rag_aliases", value)) }),
    finalizedAt: auditSqlTimestamp }), "pg-jsonb-text-v1").payload;
  auditEqual(receipt.binding, binding); auditEqual(receipt.outputManifestEnvelope, component.payload.outputManifestEnvelope);
  const batch = auditEnvelope(receipt.outputManifestEnvelope, "u04-retained-evidence-v1", record({ producer: choice("local-worker"),
    producerVersion: choice("rag-deep-memory-v1"), binding: shadowCandidateView,
    units: list(record({ family: choice("sections", "memory_cards", "index_units", "producer_aliases"), key: nonemptyString,
      output: record({ nativeInput: auditObject }, { sectionAssociation: record({ tag: choice("absent", "own_undefined", "index") }, { index: nonnegativeInteger }),
        producerContext: record({ modelProfile: shadowDeepProfile, request: shadowDeepRequest }) }) })) })).payload;
  auditEqual(batch.binding, binding);
  const request = receipt.request;
  if (request.artifact_generation !== d || request.fence.document_id !== binding.source.documentId ||
    request.fence.job_id !== binding.jobId || request.fence.lease_token !== binding.firstLeaseToken ||
    request.fence.expected_generation_id !== binding.source.baselineGenerationId ||
    request.fence.authority_digest !== binding.source.authorityDigest) invalidComparison();
  const sources = record({ chunks: list(value => auditStoredRow("document_chunks", value)),
    images: list(value => auditStoredRow("document_images", value)) })(sourceRowsValue);
  for (const rows of [sources.chunks, sources.images]) {
    if (new Set(rows.map(row => row.row.id)).size !== rows.length) invalidComparison();
    for (const row of rows) if (row.row.document_id !== binding.source.documentId || auditGeneration(row) !== binding.candidateGenerationId ||
      auditObject(row.row.metadata).ingestion_lease_token !== binding.firstLeaseToken) invalidComparison();
  }
  const sourceIds = (value: unknown, rows: AuditRow[]) => {
    const ids = list(uuidValue)(value);
    if (new Set(ids).size !== ids.length || ids.some(id => !rows.some(row => row.row.id === id))) invalidComparison();
  };
  const checkSources = (native: Record<string, unknown>) => {
    for (const key of ["source_chunk_ids", "chunk_ids"]) if (Object.hasOwn(native, key)) sourceIds(native[key], sources.chunks);
    if (Object.hasOwn(native, "source_image_ids")) sourceIds(native.source_image_ids, sources.images);
    for (const [key, rows] of [["source_chunk_id", sources.chunks], ["source_image_id", sources.images]] as const)
      if (Object.hasOwn(native, key) && native[key] !== null && !rows.some(row => row.row.id === native[key])) invalidComparison();
  };
  const plannedSections = batch.units.filter(unit => unit.family === "sections");
  const context = plannedSections.find(unit => unit.key === "deep:0")?.output.producerContext;
  if (!context || plannedSections.length === 0 || request.memory_card_count === 0) invalidComparison();
  auditEqual(context.request, request);
  for (const group of [context.modelProfile.sections, context.modelProfile.askable_questions, context.modelProfile.clinical_facts,
    context.modelProfile.table_facts, context.modelProfile.aliases]) for (const item of group) checkSources(item);
  const plannedAliases = context.modelProfile.aliases.filter(alias => alias.confidence >= 0.65).map(alias => ({
    alias: alias.alias, canonical: alias.canonical, alias_type: alias.alias_type,
    weight: Math.max(0.5, Math.min(1.5, alias.confidence + 0.25)), enabled: true,
    metadata: { source: "model_index_profile", document_id: binding.source.documentId, source_chunk_ids: alias.source_chunk_ids,
      model_index_version: "model-heavy-index-v1", generated_by: "local-worker", artifact_generation_id: d } }));
  auditEqual(request.aliases, plannedAliases);
  const counts: Record<string, number> = {};
  const identities = new Set<string>();
  let createdAt: bigint | undefined;
  const mapping: { family: string; unitKey: string; rowEnvelope: ShadowRawEnvelope }[] = [];
  for (const [family, rows, table] of [["sections", receipt.rows.sections, "document_sections"],
    ["memory_cards", receipt.rows.cards, "document_memory_cards"], ["index_units", receipt.rows.units, "document_index_units"],
    ["producer_aliases", receipt.rows.aliases, "rag_aliases"]] as const) {
    const planned = batch.units.filter(unit => unit.family === family);
    if (planned.length !== rows.length || new Set(planned.map(unit => unit.key)).size !== planned.length) invalidComparison();
    const used = new Set<string>();
    for (let index = 0; index < planned.length; index++) {
      const unit = planned.find(value => value.key === `deep:${index}`);
      if (!unit) invalidComparison();
      const native = unit.output.nativeInput;
      if (family !== "sections" && unit.output.producerContext !== undefined ||
        family === "sections" && (index === 0) !== (unit.output.producerContext !== undefined) ||
        (family === "memory_cards") !== (unit.output.sectionAssociation !== undefined)) invalidComparison();
      checkSources(native); const metadata = auditObject(native.metadata);
      if (metadata.generated_by !== "local-worker" || metadata.artifact_generation_id !== d) invalidComparison();
      if (family === "producer_aliases") auditEqual(native, request.aliases[index]);
      else if (native.document_id !== binding.source.documentId || native.owner_id !== binding.source.ownerId ||
        native.producer !== "local-worker" || native.artifact_generation_id !== d || native.index_generation_id !== d ||
        metadata.index_generation_id !== d || metadata.ingestion_lease_token !== binding.firstLeaseToken) invalidComparison();
      if (family === "sections" && native.section_index !== index) invalidComparison();
      if (family === "index_units") { const kind = shadowDeepUnitType(native.unit_type); counts[kind] = (counts[kind] ?? 0) + 1; }
      const matches = rows.filter(row => {
        if (used.has(String(row.row.id))) return false;
        const expected: Record<string, unknown> = { ...native, id: row.row.id, created_at: row.row.created_at, updated_at: row.row.updated_at,
          metadata: { ...metadata, ingestion_job_kind: "node", ingestion_job_id: binding.jobId,
            ingestion_lease_token: binding.firstLeaseToken, index_generation_id: binding.candidateGenerationId } };
        if (family === "producer_aliases") expected.owner_id = binding.source.ownerId;
        else expected.index_generation_id = binding.candidateGenerationId;
        if (family === "memory_cards") {
          const association = unit.output.sectionAssociation!;
          if (native.section_id !== null || (association.tag === "index") !== (association.index !== undefined)) invalidComparison();
          const section = receipt.rows.sections.filter(section => section.row.section_index === association.index);
          if (association.tag === "index" && section.length !== 1) invalidComparison();
          expected.section_id = association.tag === "index" ? section[0]!.row.id : null;
        }
        if (family === "memory_cards" || family === "index_units") {
          const vector = list(numberValue, 1536)(native.embedding).map(Math.fround);
          const storedVector = list(numberValue, 1536)(decodeStrictJson(stringValue(row.row.embedding), false));
          if (vector.length !== 1536 || storedVector.length !== 1536) invalidComparison();
          if (!shadowSame(vector, storedVector.map(Math.fround))) return false;
          expected.embedding = row.row.embedding; expected.search_tsv = row.row.search_tsv;
        }
        // The closed stored schema rejects any absent, extra or incorrectly typed native field.
        const parsed = auditStoredRowSchema(table)(expected);
        return shadowSame(parsed, row.row);
      });
      if (matches.length !== 1) invalidComparison();
      const row = matches[0]!; const id = uuidValue(row.row.id);
      const created = shadowMicros(row.row.created_at);
      if (createdAt === undefined) createdAt = created;
      if (identities.has(id) || created !== createdAt || created > shadowMicros(receipt.finalizedAt) ||
        shadowMicros(row.row.updated_at) > shadowMicros(receipt.finalizedAt)) invalidComparison();
      identities.add(id); used.add(id); mapping.push({ family, unitKey: unit.key, rowEnvelope: row.envelope });
    }
  }
  if (receipt.rows.sections.length !== request.section_count || receipt.rows.cards.length !== request.memory_card_count) invalidComparison();
  auditEqual(request.index_unit_counts_by_type, counts);
  if(component.payload.producer_aliases.length!==receipt.rows.aliases.length)invalidComparison();
  for(let index=0;index<component.payload.producer_aliases.length;index++){
    const retained=mapping.filter(value=>value.family==="producer_aliases"&&value.unitKey===`deep:${index}`);
    if(retained.length!==1||shadowStoredEvidence("rag_aliases",component.payload.producer_aliases[index]!).envelope.digest!==
      retained[0]!.rowEnvelope.digest)invalidComparison();
  }
  if (new Set(request.anchors.map(anchor => anchor.id)).size !== request.anchors.length) invalidComparison();
  for (const anchor of request.anchors) {
    const row = sources.chunks.find(row => row.row.id === anchor.id);
    if (!row || row.row.anchor_id !== anchor.anchor_id) invalidComparison();
    const metadata = auditObject(row.row.metadata);
    if (metadata.anchor_id !== anchor.anchor_id || metadata.anchor_repaired_by !== request.document_intelligence_version) invalidComparison();
  }
  const result = { document_id: binding.source.documentId, producer: "local-worker", artifact_generation_id: d,
    index_generation_id: binding.candidateGenerationId, section_count: request.section_count,
    memory_card_count: request.memory_card_count, index_unit_count: receipt.rows.units.length };
  auditEqual(component.payload.deep_memory_metadata, { rag_indexing_version: request.rag_memory_version,
    rag_memory_version: request.rag_memory_version, rag_memory_updated_at: receipt.finalizedAt,
    document_intelligence_version: request.document_intelligence_version, document_intelligence_updated_at: receipt.finalizedAt,
    section_count: request.section_count, memory_card_count: request.memory_card_count, index_unit_count: receipt.rows.units.length,
    index_unit_counts_by_type: counts, repaired_anchor_count: request.anchors.length,
    deep_memory_generations: { "local-worker": d }, deep_memory_commit_receipts: { "local-worker": { request, result } } });
  return freezeTree({ kind: "shadow-candidate-deep-projection-validated" as const, envelope: component.envelope,
    binding, outputManifestEnvelope: component.payload.outputManifestEnvelope,
    receipt: component.payload.deep_memory_receipt, request, rows: receipt.rows, mapping });
}

function shadowProjectionComponentEnvelope(value: unknown): ShadowRawEnvelope {
  const canonicalPayload = auditPgText(auditJson(value));
  const framed = payloadDigest("projection", "pg-jsonb-text-v1", canonicalPayload);
  return { version: 1, domain: "projection", encoding: "pg-jsonb-text-v1", canonicalPayload, digest: framed.digest };
}

/** Reconstructs every present component digest from one complete projection row and its retained declarations.
 * This is component reconciliation only; sealed rows gain no member or terminal authority here.
 */
function readShadowProjectionAggregate(envelopeValue: unknown, bindingValue: unknown, profileValue: unknown,
  declarationEnvelopesValue: unknown, sourceRowsValue: unknown, expectedSealedAtValue: unknown) {
  const binding = shadowCandidateView(bindingValue);
  if (binding.artifactGenerationId !== null || binding.candidateGenerationId === binding.source.baselineGenerationId) invalidComparison();
  const profile = parseShadowExecutionProfileEnvelope(profileValue);
  if (profile.bytes.envelope.digest !== binding.source.executionProfileDigest) invalidComparison();
  const projection = auditEnvelope(envelopeValue, "projection", auditStoredRowSchema("document_generation_projections"), "pg-jsonb-text-v1");
  const row = projection.payload;
  const expectedSealedAt = nullable(auditSqlTimestamp)(expectedSealedAtValue);
  if (row.document_id !== binding.source.documentId || row.index_generation_id !== binding.candidateGenerationId ||
    row.lease_token !== binding.firstLeaseToken || row.owner_id !== binding.source.ownerId || row.sealed_at !== expectedSealedAt) invalidComparison();
  const declarations = record({ summary: nullable(auditAnyEnvelope), quality: nullable(auditAnyEnvelope),
    worker: nullable(auditAnyEnvelope), deep: nullable(auditAnyEnvelope) })(declarationEnvelopesValue);
  const sources = record({ pages: list(auditAnyEnvelope), chunks: list(auditAnyEnvelope), images: list(auditAnyEnvelope),
    sections: list(auditAnyEnvelope), cards: list(auditAnyEnvelope), embeddingFields: list(auditAnyEnvelope) })(sourceRowsValue);
  const summaryPresent = row.summary_digest !== null;
  const qualityPresent = row.quality_digest !== null;
  const workerPresent = row.worker_state_digest !== null;
  const deepPresent = row.deep_memory_digest !== null;
  if (![summaryPresent, qualityPresent, workerPresent, deepPresent].some(Boolean) ||
    [declarations.summary, row.summary, row.generated_labels, row.summary_projection_complete, row.enrichment_metadata]
      .some(value => (value !== null) !== summaryPresent) ||
    [declarations.quality, row.quality].some(value => (value !== null) !== qualityPresent) ||
    [declarations.worker, row.worker_metadata, row.document_counts].some(value => (value !== null) !== workerPresent) ||
    [declarations.deep, row.deep_memory_artifact_generation_id, row.deep_memory_receipt, row.deep_memory_metadata, row.producer_aliases]
      .some(value => (value !== null) !== deepPresent)) invalidComparison();

  let summary: ReturnType<typeof readShadowSummaryProjectionV1> | null = null;
  if (summaryPresent) {
    const component = shadowProjectionComponentEnvelope({ kind: "u04-summary-projection-v1", binding,
      outputManifestEnvelope: declarations.summary, summary: row.summary, generated_labels: row.generated_labels,
      summary_projection_complete: row.summary_projection_complete, enrichment_metadata: row.enrichment_metadata });
    if (component.digest !== row.summary_digest) invalidComparison();
    summary = readShadowSummaryProjectionV1(component, binding, profileValue, { chunks: sources.chunks, images: sources.images });
  }

  let quality: ReturnType<typeof readShadowQualityProjectionV1> | null = null;
  let qualityEnvelope: ShadowRawEnvelope | null = null;
  if (qualityPresent) {
    qualityEnvelope = shadowProjectionComponentEnvelope({ kind: "u04-quality-projection-v1", binding,
      outputManifestEnvelope: declarations.quality, quality: row.quality });
    if (qualityEnvelope.digest !== row.quality_digest) invalidComparison();
    quality = readShadowQualityProjectionV1(qualityEnvelope, binding, { pages: sources.pages, images: sources.images,
      sections: sources.sections, cards: sources.cards, embeddingFields: sources.embeddingFields });
  }

  let worker: ReturnType<typeof readShadowWorkerProjectionV1> | null = null;
  if (workerPresent) {
    if (qualityEnvelope === null) invalidComparison();
    const component = shadowProjectionComponentEnvelope({ kind: "u04-worker-projection-v1", binding,
      outputManifestEnvelope: declarations.worker, worker_metadata: row.worker_metadata, document_counts: row.document_counts });
    if (component.digest !== row.worker_state_digest) invalidComparison();
    worker = readShadowWorkerProjectionV1(component, binding, profileValue, qualityEnvelope, sources);
  }

  let deep: ReturnType<typeof validateShadowCandidateDeepProjectionV1> | null = null;
  if (deepPresent) {
    const deepBinding = shadowCandidateView({ ...binding, artifactGenerationId: row.deep_memory_artifact_generation_id });
    const component = shadowProjectionComponentEnvelope({ kind: "u04-deep-projection-v1", binding: deepBinding,
      outputManifestEnvelope: declarations.deep, deep_memory_receipt: row.deep_memory_receipt,
      deep_memory_metadata: row.deep_memory_metadata, producer_aliases: row.producer_aliases });
    if (component.digest !== row.deep_memory_digest) invalidComparison();
    deep = validateShadowCandidateDeepProjectionV1(component, deepBinding, { chunks: sources.chunks, images: sources.images });
    for (const [table, supplied, retained] of [["document_sections", sources.sections, deep.rows.sections],
      ["document_memory_cards", sources.cards, deep.rows.cards]] as const) {
      const order = (rows: readonly { readonly envelope: unknown;
        readonly row: Readonly<Record<string, unknown>> }[]) => [...rows].sort((left, right) =>
        compareText(uuidValue(left.row.id), uuidValue(right.row.id)));
      const suppliedRows = order(supplied.map(value => auditStoredRow(table, value)));
      const retainedRows = order(retained);
      auditEqual(suppliedRows.map(value => ({ envelope: value.envelope, row: value.row })),
        retainedRows.map(value => ({ envelope: value.envelope, row: value.row })));
    }
  }
  return freezeTree({ kind: "shadow-projection-aggregate-validated" as const, envelope: projection.envelope,
    row, components: { summary, quality, worker, deep } });
}

/** Public component reconciliation remains pre-seal only. */
export function readShadowProjectionAggregateV1(envelopeValue: unknown, bindingValue: unknown, profileValue: unknown,
  declarationEnvelopesValue: unknown, sourceRowsValue: unknown) {
  return readShadowProjectionAggregate(envelopeValue, bindingValue, profileValue, declarationEnvelopesValue, sourceRowsValue, null);
}

const shadowFinalDisposition = record({ family: inventoryFamily, unitKey: nonemptyString,
  disposition: choice("retained", "failed", "skipped", "excluded"),
  reasonCode: nullable(choice("producer_failed", "producer_skipped", "producer_unavailable", "policy_excluded")),
  limitations: list(inventoryLimitation), artifactRef: nullable(inventoryArtifact), contentDigest: nullable(digestValue),
  relationships: list(auditRelationship), retainedEvidenceText: nullable(stringValue), retainedNativePayload: nullable(stringValue),
  representationVersion: nullable(nonemptyString), transformVersion: nullable(nonemptyString) });
const shadowCandidateView = record({tag:choice("candidate"),source:auditSource,candidateGenerationId:uuidValue,
  jobId:uuidValue,firstLeaseToken:uuidValue,artifactGenerationId:nullable(uuidValue)});
const shadowExpectedDeclaration = record({ family: inventoryFamily, unitKey: nonemptyString, expected: booleanValue,
  required: booleanValue, producer: nonemptyString, sourceBinding: shadowCandidateView });
const shadowCandidateTable = choice("document_pages", "document_chunks", "document_images", "document_table_facts",
  "document_embedding_fields", "document_index_units", "document_sections", "document_memory_cards");
type ShadowCandidateTable = ReturnType<typeof shadowCandidateTable>;
const shadowFinalInventoryPayload = record({ kind: choice("u04-final-inventory-v1"), version: fixedNumber(1),
  binding: shadowCandidateView, expectedInventoryEnvelope: auditAnyEnvelope, finalDispositions: list(shadowFinalDisposition),
  projectionEnvelope: auditAnyEnvelope, preSealControlEnvelope: auditAnyEnvelope,
  candidateRows: list(record({ table: shadowCandidateTable, rowEnvelope: auditAnyEnvelope })),
  retainedEvidence: list(auditRetainedEvidence) });
const shadowFinalInventoryContext = record({ memberRowEnvelope: auditAnyEnvelope, profileEnvelope: auditAnyEnvelope,
  inventoryRowEnvelopes: list(auditAnyEnvelope), originalOriginEnvelope: auditAnyEnvelope, sealedAt: auditSqlTimestamp });

function shadowDispositionRow(value: ReturnType<typeof shadowFinalDisposition>) {
  return { family:value.family,unitKey:value.unitKey,disposition:value.disposition,reasonCode:value.reasonCode,
    limitations:value.limitations,artifactRef:value.artifactRef,contentDigest:value.contentDigest,relationships:value.relationships,
    retainedEvidenceText:value.retainedEvidenceText,retainedNativePayload:value.retainedNativePayload,
    representationVersion:value.representationVersion,transformVersion:value.transformVersion };
}
function shadowInventoryStoredOutcome(row: AuditRow["row"]) {
  return { family:row.family,unitKey:row.unit_key,disposition:row.disposition,reasonCode:row.reason_code,
    limitations:row.limitations,artifactRef:row.artifact_ref,contentDigest:row.content_digest,relationships:row.relationships,
    retainedEvidenceText:row.retained_evidence_text,retainedNativePayload:row.retained_native_payload,
    representationVersion:row.representation_version,transformVersion:row.transform_version };
}
function shadowInventoryRequired(family: InventoryFamily, group: string) {
  return ["pages", "chunks", "images", "table_facts", "embedding_fields", "quality", "document_metadata", "private_objects",
    "attempt_control", "cache_inputs", "repair_audit_inputs"].includes(family) || (family === "index_units" && group === "worker_core");
}

function shadowSupportedProjectionPayload(projection: ReturnType<typeof readShadowProjectionAggregate>,
  disposition: ReturnType<typeof shadowFinalDisposition>) {
  const ref = disposition.artifactRef;
  if (!ref || ref.tag !== "candidate_projection") invalidComparison();
  const slot = disposition.family === "summary" ? "summary"
    : disposition.family === "generated_labels" ? "generated_labels"
    : disposition.family === "quality" ? "quality"
    : disposition.family === "document_metadata" ? "worker_metadata"
    : disposition.family === "producer_aliases" ? "producer_aliases" : invalidComparison();
  if (ref.slot !== slot) invalidComparison();
  let value: AuditJson;
  if (disposition.family === "generated_labels" || disposition.family === "producer_aliases") {
    if (typeof ref.itemId !== "string") invalidComparison();
    const items = list(auditObject)(projection.row[slot]);
    const matches = items.map((item, index) => ({ item, index })).filter(entry => entry.item.id === ref.itemId);
    if (matches.length !== 1) invalidComparison();
    const match = matches[0]!;
    const key = disposition.family === "generated_labels"
      ? encodeShadowNodeJsonCanonicalPayload({ label: stringValue(match.item.label), label_type: stringValue(match.item.label_type) })
      : (()=>{
        if(projection.components.deep===null)invalidComparison();
        const digest=shadowStoredEvidence("rag_aliases",match.item).envelope.digest;
        const retained=projection.components.deep.mapping.filter(entry=>entry.family==="producer_aliases"&&
          entry.rowEnvelope.digest===digest);
        if(retained.length!==1)return invalidComparison();
        return retained[0]!.unitKey;
      })();
    if (disposition.unitKey !== key) invalidComparison();
    value = match.item;
  } else {
    if (disposition.unitKey !== "singleton" || ref.itemId !== null) invalidComparison();
    value = auditJson(projection.row[slot]);
  }
  if (value === null || value === undefined) invalidComparison();
  const digest = shadowProjectionComponentEnvelope(value).digest;
  if (ref.payloadDigest !== digest || disposition.contentDigest !== digest) invalidComparison();
  return value;
}

const shadowCoreTable: Record<ShadowCoreFamilyV1, ShadowCandidateTable> = {
  pages: "document_pages", chunks: "document_chunks", images: "document_images", table_facts: "document_table_facts",
  embedding_fields: "document_embedding_fields", index_units: "document_index_units",
};
const shadowCoreOwner: Record<ShadowCoreFamilyV1, string> = {
  pages: "page", chunks: "chunk", images: "image", table_facts: "table_fact",
  embedding_fields: "embedding_field", index_units: "index_unit",
};
const shadowDeepTable = {
  sections: "document_sections", memory_cards: "document_memory_cards", index_units: "document_index_units",
} as const satisfies Record<string, ShadowCandidateTable>;
const shadowDeepOwner = { sections: "section", memory_cards: "memory_card", index_units: "index_unit" } as const;
type ShadowDeepRowFamily = keyof typeof shadowDeepTable;
function shadowCoreFamily(value: InventoryFamily): ShadowCoreFamilyV1 | null {
  return Object.hasOwn(shadowCoreTable, value) ? value as ShadowCoreFamilyV1 : null;
}
function shadowDeepRowFamily(family: InventoryFamily, group: string): ShadowDeepRowFamily | null {
  return group === "deep_memory" && Object.hasOwn(shadowDeepTable, family) ? family as ShadowDeepRowFamily : null;
}
const shadowUndefinedOr = <T>(schema: Schema<T>): Schema<T | undefined> => value =>
  value === undefined ? undefined : schema(value);
const shadowExtractedPage = record({ pageNumber: positiveInteger, text: stringValue }, {
  ocrUsed: shadowUndefinedOr(booleanValue), needsOcr: shadowUndefinedOr(booleanValue),
});
const shadowExtractedImage = record({ pageNumber: nullable(positiveInteger), path: nonemptyString, mimeType: nonemptyString }, {
  bbox: shadowUndefinedOr(nullable((value: unknown) => {
    const result = list(numberValue)(value); if (result.length !== 4) invalidComparison(); return result;
  })), width: shadowUndefinedOr(nullable(positiveInteger)), height: shadowUndefinedOr(nullable(positiveInteger)),
  sourceKind: shadowUndefinedOr(choice("embedded", "table_crop", "diagram_crop", "page_region", "fallback", "cover_page")),
  metadata: shadowUndefinedOr(auditObject),
});
const shadowExtractedDocument = record({ pages: list(shadowExtractedPage), images: list(shadowExtractedImage) }, {
  warnings: shadowUndefinedOr(list(stringValue)), temporaryPaths: shadowUndefinedOr(list(stringValue)),
  budgetUsage: shadowUndefinedOr(record({ pages: nonnegativeInteger, artifacts: nonnegativeInteger,
    artifactBytes: nonnegativeInteger, textBytes: nonnegativeInteger })),
});
const shadowVisualProvenance = {
  source_image_id: shadowUndefinedOr(nullable(stringValue)), page_number: shadowUndefinedOr(nullable(numberValue)),
  source_region: shadowUndefinedOr(nullable(auditObject)), visible_text: shadowUndefinedOr(nullable(stringValue)),
};
const shadowStringRecord:Schema<Record<string,string>>=value=>{
  const object=auditObject(value),result:Record<string,string>={};
  for(const [key,item] of Object.entries(object))result[key]=stringValue(item);
  return result;
};
const shadowVisualText = record({ label: stringValue, confidence: rate }, {
  value: shadowUndefinedOr(nullable(stringValue)), action: shadowUndefinedOr(nullable(stringValue)),
  source_text: shadowUndefinedOr(nullable(stringValue)), ...shadowVisualProvenance,
});
const shadowVisualProfile = record({ clinical_purpose: nullable(stringValue), key_terms: list(stringValue),
  medications: list(stringValue), thresholds: list(shadowVisualText), actions: list(stringValue),
  monitoring_items: list(stringValue), flowchart_nodes: list(record({ id: stringValue, label: stringValue }, {
    type: shadowUndefinedOr(nullable(stringValue)), ...shadowVisualProvenance })),
  flowchart_edges: list(record({ from: stringValue, to: stringValue }, {
    label: shadowUndefinedOr(nullable(stringValue)), ...shadowVisualProvenance })),
  risk_matrix_axes: list(stringValue), risk_matrix_cells: list(record({ row: stringValue, column: stringValue,
    risk: stringValue, confidence: rate }, { action: shadowUndefinedOr(nullable(stringValue)), ...shadowVisualProvenance })),
  chart_axes: list(stringValue), chart_findings: list(record({ label: stringValue, confidence: rate }, {
    value: shadowUndefinedOr(nullable(stringValue)), interpretation: shadowUndefinedOr(nullable(stringValue)),
    ...shadowVisualProvenance })), table_column_roles: shadowStringRecord, source_regions: list(auditObject), confidence: rate });
const shadowImageClassification = record({ image_type: choice("clinical_table", "flowchart_algorithm", "form_checklist",
  "risk_matrix", "medication_chart", "graph", "screenshot_ui", "photo", "logo_decorative", "unclear"),
  searchable: booleanValue, clinical_relevance_score: rate, labels: list(stringValue), caption: stringValue,
  skip_reason: nullable(stringValue), clinical_use_class: choice("clinical_evidence", "administrative", "reference",
    "decorative_or_empty", "ambiguous"), clinical_use_reason: stringValue, clinical_signal_score: boundedNumber(0,10),
  admin_signal_score: boundedNumber(0,10), structured_visual_profile: shadowVisualProfile,
  structured_extraction_confidence: rate });
const shadowRankedVisualCandidate = record({ pageNumber: nullable(positiveInteger), width: nullable(positiveInteger),
  height: nullable(positiveInteger), bbox: nullable((value: unknown) => {
    const result = list(numberValue)(value); if (result.length !== 4) invalidComparison(); return result;
  }), sourceKind: nullable(choice("embedded", "table_crop", "diagram_crop", "page_region", "fallback", "cover_page")),
  imageHash: nullable(stringValue), perceptualHash: nullable(stringValue),
  metadata: auditObject, nearbyText: shadowUndefinedOr(nullable(stringValue)), originalIndex: nonnegativeInteger,
  candidatePriorityScore: numberValue, imageQualityScore: numberValue, cropCompleteness: numberValue,
  ocrTextDensity: numberValue, captionBudgetClass: choice("clinical_table", "flowchart", "risk_matrix", "medication_chart",
    "form_checklist", "graph", "clinical_region", "admin_reference", "low_signal"), reasons: list(stringValue),
  duplicateGroup: nullable(stringValue) }, { id: shadowUndefinedOr(nullable(stringValue)) });
const shadowCacheTask = record({ candidate: shadowRankedVisualCandidate, index: nonnegativeInteger,
  image: shadowExtractedImage, perceptualHash: stringValue, imageHash: auditBareDigest,
  nearbyText: shadowUndefinedOr(stringValue), tableMetadata: record({ candidateType: nullable(stringValue),
    tableLabel: nullable(stringValue), tableTitle: nullable(stringValue), tableRole: nullable(stringValue),
    tableConfidence: nullable(numberValue), tableText: nullable(stringValue), tableTextSnippet: nullable(stringValue),
    accessibleTableMarkdown: nullable(stringValue), tableRows: nullable(list(auditJson)), tableColumns: nullable(list(auditJson)) }),
  contextHash: (value:unknown)=>{
    const text=stringValue(value);if(!/^[0-9a-f]{32}$/.test(text))invalidComparison();return text;
  }, presetClassification: nullable(shadowImageClassification) });
function shadowRetainedCapture(value: unknown) {
  const capture = auditEnvelope(value, "u04-retained-evidence-v1", auditJson);
  const retained = readShadowProducerInputV1(capture.payload);
  return { envelope: capture.envelope, retained: capture.payload, nativeInput: retained.nativeInput };
}
function shadowNativeCapture(value: unknown) {
  const capture = shadowRetainedCapture(value);
  const input = record({ extracted: shadowExtractedDocument,
    imageBytes: list(record({ path: nonemptyString, encoding: choice("base64"), content: stringValue })) })(capture.nativeInput);
  if (input.extracted.images.length !== input.imageBytes.length) invalidComparison();
  input.imageBytes.forEach((entry, index) => {
    if (entry.path !== input.extracted.images[index]!.path) invalidComparison();
    const bytes = Buffer.from(entry.content, "base64");
    if (bytes.toString("base64") !== entry.content) invalidComparison();
  });
  return { ...capture, input };
}
function shadowCacheCapture(value: unknown, unitKey: string, native: ReturnType<typeof shadowNativeCapture>, ownerId: string | null) {
  const capture = shadowRetainedCapture(value);
  const input = record({ task: shadowCacheTask, classification: shadowImageClassification,
    classificationCacheHit: booleanValue, ownerId: nullable(uuidValue), model: nonemptyString })(capture.nativeInput);
  const index = input.task.index;
  if (unitKey !== String(index) || input.task.candidate.originalIndex !== index || input.ownerId !== ownerId ||
    index >= native.input.extracted.images.length) invalidComparison();
  auditEqual(captureShadowProducerInputV1(input.task.image),
    captureShadowProducerInputV1(native.input.extracted.images[index]));
  const bytes = native.input.imageBytes[index]!;
  if (bytes.path !== input.task.image.path || createHash("sha256").update(Buffer.from(bytes.content, "base64")).digest("hex") !== input.task.imageHash)
    invalidComparison();
  const image=input.task.image,candidate=input.task.candidate;
  const nearbyTextMatches=image.pageNumber===null
    ?Object.hasOwn(candidate,"nearbyText")&&candidate.nearbyText===null&&
      Object.hasOwn(input.task,"nearbyText")&&input.task.nearbyText===undefined
    :candidate.nearbyText===input.task.nearbyText&&
      Object.hasOwn(candidate,"nearbyText")===Object.hasOwn(input.task,"nearbyText");
  if(candidate.pageNumber!==image.pageNumber||candidate.width!==(image.width??null)||candidate.height!==(image.height??null)||
    !shadowSame(candidate.bbox,image.bbox??null)||candidate.sourceKind!==(image.sourceKind??null)||
    candidate.imageHash!==input.task.imageHash||candidate.perceptualHash!==input.task.perceptualHash||
    !shadowSame(candidate.metadata,image.metadata??{})||!nearbyTextMatches)invalidComparison();
  const metadata=image.metadata??{};
  const metadataText=(key:string)=>{
    const value=metadata[key];return typeof value==="string"&&value.trim()?value.trim():null;
  };
  const compact=(text:string|null)=>{
    if(!text)return null;const value=text.replace(/\s+/g," ").trim();
    return !value?null:value.length>1200?`${value.slice(0,1197).trim()}...`:value;
  };
  const tableText=metadataText("table_text"),confidence=Number(metadata.table_confidence);
  auditEqual(input.task.tableMetadata,{candidateType:metadataText("candidate_type"),tableLabel:metadataText("table_label"),
    tableTitle:metadataText("table_title"),tableRole:metadataText("table_role"),
    tableConfidence:Number.isFinite(confidence)?confidence:null,tableText,tableTextSnippet:compact(tableText),
    accessibleTableMarkdown:metadataText("accessible_table_markdown")??tableText,
    tableRows:Array.isArray(metadata.table_rows)?metadata.table_rows:null,
    tableColumns:Array.isArray(metadata.table_columns)?metadata.table_columns:null});
  if(input.task.presetClassification!==null&&!shadowSame(input.task.presetClassification,input.classification))invalidComparison();
  if(input.classificationCacheHit&&(input.ownerId===null||input.task.presetClassification!==null))invalidComparison();
  return { ...capture, input };
}
const shadowOptionalIndexWriteIssue=record({stage:stringValue,message:stringValue},{
  code:shadowUndefinedOr(nullable(stringValue)),
});
const shadowRepairDecisionInput=record({enrichmentStatus:choice("pending","completed","failed"),
  enrichmentErrorMessage:nullable(stringValue),optionalIssueCount:nonnegativeInteger});
function shadowExpectedRepairDecision(input:ReturnType<typeof shadowRepairDecisionInput>){
  const optionalRepairRequired=input.optionalIssueCount>0;
  const optionalRepairMessage="Optional index artifact writes failed; queued for indexing-v3-agent repair.";
  const enrichmentStatus=optionalRepairRequired&&input.enrichmentStatus==="completed"?"pending":input.enrichmentStatus;
  const enrichmentErrorMessage=optionalRepairRequired&&input.enrichmentStatus==="completed"
    ?optionalRepairMessage:input.enrichmentErrorMessage;
  return {enrichmentStatus,enrichmentErrorMessage,repairRequired:enrichmentStatus!=="completed"||optionalRepairRequired,
    repairReason:optionalRepairRequired?"optional_index_write_issues":enrichmentStatus==="failed"
      ?"inline_enrichment_failed":"enrichment_deferred",
    repairMessage:enrichmentErrorMessage??(optionalRepairRequired?optionalRepairMessage:
      "Core index complete; enrichment queued for indexing-v3-agent.")};
}
function shadowRepairCapture(value:unknown,projection:ReturnType<typeof readShadowProjectionAggregate>){
  const capture=shadowRetainedCapture(value);
  const input=record({input:shadowRepairDecisionInput,optionalIndexWriteIssues:list(shadowOptionalIndexWriteIssue),
    decision:record({enrichmentStatus:choice("pending","completed","failed"),enrichmentErrorMessage:nullable(stringValue),
      repairRequired:booleanValue,repairReason:choice("optional_index_write_issues","inline_enrichment_failed","enrichment_deferred"),
      repairMessage:stringValue})})(capture.nativeInput);
  if(input.input.optionalIssueCount!==input.optionalIndexWriteIssues.length)invalidComparison();
  auditEqual(input.decision,shadowExpectedRepairDecision(input.input));
  const worker=projection.components.worker,quality=projection.components.quality;
  if(worker===null||quality===null)invalidComparison();
  const metadata=worker.payload.worker_metadata,metrics=auditObject(quality.payload.quality.metrics);
  auditEqual(input.optionalIndexWriteIssues,metadata.optional_index_write_issues);
  auditEqual(input.optionalIndexWriteIssues,metrics.optional_index_write_issues);
  if(metadata.enrichment_status!==input.decision.enrichmentStatus||
    metadata.enrichment_error!==input.decision.enrichmentErrorMessage||
    metadata.indexing_v3_agent_status!==(input.decision.repairRequired?"pending":"completed")||
    metadata.indexing_v3_agent_last_error!==(input.decision.repairRequired?input.decision.repairMessage:null)||
    metadata.indexing_v3_agent_repair_reason!==(input.decision.repairRequired?input.decision.repairReason:null))invalidComparison();
  return {...capture,input};
}
function shadowControlCapture(value:unknown,binding:ReturnType<typeof shadowCandidateView>,
  latest:ReturnType<typeof shadowControlCheckpoint>){
  const capture=shadowRetainedCapture(value),checkpoint=shadowControlCheckpoint(capture.nativeInput);
  if(checkpoint.controlRevision<1||checkpoint.controlRevision>latest.controlRevision||
    checkpoint.ownNodeJobs.length!==1||checkpoint.ownStages.length!==0||latest.ownNodeJobs.length!==1)invalidComparison();
  const initial=checkpoint.ownNodeJobs[0]!,current=latest.ownNodeJobs[0]!;
  if(initial.id!==binding.jobId||initial.document_id!==binding.source.documentId||initial.status!=="processing"||
    initial.attempt_count!==1||initial.operation!=="shadow_reindex"||initial.batch_id!==null||initial.max_attempts!==1||
    initial.requested_generation_id!==binding.candidateGenerationId||initial.lease_token!==binding.firstLeaseToken||
    initial.lease_expected_generation_id!==binding.source.baselineGenerationId||
    initial.lease_write_generation_id!==binding.candidateGenerationId||
    initial.lease_authority_digest!==binding.source.authorityDigest||nonemptyString(initial.locked_by)!==current.locked_by||
    initial.lease_duration_seconds===null||positiveInteger(initial.lease_duration_seconds)!==current.lease_duration_seconds)
    invalidComparison();
  if(current.status!=="processing"||!shadowUnchanged(initial,current,["stage","progress","locked_at","lease_expires_at","updated_at"]))
    invalidComparison();
  shadowMicros(initial.locked_at);shadowMicros(initial.lease_expires_at);
  for(const key of ["id","document_id","batch_id","max_attempts","operation","requested_generation_id","shadow_plan_digest",
    "attempt_count","lease_token","lease_expected_generation_id","lease_write_generation_id","lease_authority_digest",
    "lease_duration_seconds","locked_by","started_at","created_at"])
    if(!shadowSame(initial[key],current[key]))invalidComparison();
  sortedUnique(latest.ownStages,(left,right)=>compareText(uuidValue(left.id),uuidValue(right.id)));
  for(const stage of latest.ownStages)if(stage.job_id!==binding.jobId||stage.document_id!==binding.source.documentId||
    stage.job_kind!=="node"||stage.lease_token!==binding.firstLeaseToken||
    stage.index_generation_id!==binding.source.baselineGenerationId)invalidComparison();
  return {...capture,checkpoint};
}
function shadowOptionalPath(value: AuditJson, path: readonly (string | number)[]): { present: boolean; value: AuditJson } {
  let current: AuditJson = value;
  for (const part of path) {
    if (current === null || typeof current !== "object") return { present: false, value: null };
    if (Array.isArray(current) !== (typeof part === "number")) invalidComparison();
    const descriptor = Object.getOwnPropertyDescriptor(current, part);
    if (!descriptor) return { present: false, value: null };
    if (!("value" in descriptor) || !descriptor.enumerable) invalidComparison();
    current = descriptor.value as AuditJson;
  }
  return { present: true, value: current };
}
function shadowSupportedRelationships(payload: AuditJson, disposition: ReturnType<typeof shadowFinalDisposition>,
  units: readonly { family: InventoryFamily; unitKey: string; declaration: ShadowDeclaredProducer;
    group: (typeof inventorySlots)[InventoryFamily][number] }[],
  candidateRows: readonly { table: ShadowCandidateTable; row: AuditRow }[],
  projection: ReturnType<typeof readShadowProjectionAggregate>, findPlanned: (unit: typeof units[number]) => AuditJson) {
  const expected: ReturnType<typeof auditRelationship>[] = [];
  const object = auditObject(payload);
  if (Object.hasOwn(object, "metadata")) {
    const metadata = auditObject(object.metadata);
    if (Object.hasOwn(metadata, "relationships") || Object.hasOwn(metadata, "source_relationships")) invalidComparison();
  }
  const specs: { path: readonly (string | number)[]; tag: "source_chunk" | "source_image" | "section" | "page";
    family: InventoryFamily; array: boolean; only?: InventoryFamily }[] = [
    { path: ["source_chunk_id"], tag: "source_chunk", family: "chunks", array: false },
    { path: ["source_image_id"], tag: "source_image", family: "images", array: false },
    { path: ["cover_image_id"], tag: "source_image", family: "images", array: false, only: "document_metadata" },
    { path: ["section_id"], tag: "section", family: "sections", array: false },
    { path: ["image_ids"], tag: "source_image", family: "images", array: true },
    { path: ["source_image_ids"], tag: "source_image", family: "images", array: true },
    { path: ["chunk_ids"], tag: "source_chunk", family: "chunks", array: true },
    { path: ["source_chunk_ids"], tag: "source_chunk", family: "chunks", array: true },
    { path: ["metadata", "chunk_ids"], tag: "source_chunk", family: "chunks", array: true },
    { path: ["metadata", "source_chunk_ids"], tag: "source_chunk", family: "chunks", array: true },
    { path: ["metadata", "source_image_ids"], tag: "source_image", family: "images", array: true },
    { path: ["metadata", "pages"], tag: "page", family: "pages", array: true, only: "generated_labels" },
    { path: ["page_number"], tag: "page", family: "pages", array: false },
    { path: ["page_start"], tag: "page", family: "pages", array: false },
    { path: ["page_end"], tag: "page", family: "pages", array: false },
  ];
  if (disposition.family === "summary") {
    const base = ["metadata", "source_anchored_summary_v1"] as const;
    specs.push(
      { path: [...base, "source_chunk_ids"], tag: "source_chunk", family: "chunks", array: true },
      { path: [...base, "source_image_ids"], tag: "source_image", family: "images", array: true },
    );
    const profile = auditObject(auditObject(auditObject(object.metadata).source_anchored_summary_v1).clinical_specifics).profile;
    const claims = auditObject(profile);
    for (const key of ["applies_to", "key_clinical_actions", "medication_dose_monitoring", "thresholds_timing",
      "escalation_risk_warnings", "required_forms_documentation", "not_covered", "important_tables_images",
      "best_questions", "source_quality_notes"] as const) {
      list(auditObject)(claims[key]).forEach((_claim, index) => specs.push(
        { path: [...base, "clinical_specifics", "profile", key, index, "source_chunk_ids"], tag: "source_chunk", family: "chunks", array: true },
        { path: [...base, "clinical_specifics", "profile", key, index, "source_image_ids"], tag: "source_image", family: "images", array: true },
        { path: [...base, "clinical_specifics", "profile", key, index, "pages"], tag: "page", family: "pages", array: true },
      ));
    }
  }
  for (const spec of specs) {
    if ((spec.only !== undefined && spec.only !== disposition.family) ||
      (disposition.family === "pages" && spec.tag === "page")) continue;
    const selected = shadowOptionalPath(object, spec.path);
    if (!selected.present || selected.value === null) continue;
    const values = spec.array ? list(auditJson)(selected.value) : [selected.value];
    for (let index = 0; index < values.length; index++) {
      const value = values[index]!;
      let key: string;
      if (spec.tag === "page") key = String(positiveInteger(value));
      else {
        const id = uuidValue(value); key = id;
        if (spec.tag === "section") {
          const section = candidateRows.filter(entry => entry.table === "document_sections" && entry.row.row.id === id);
          if (section.length !== 1 || projection.components.deep === null) invalidComparison();
          const mapped = projection.components.deep.mapping.filter(entry => entry.family === "sections" &&
            entry.rowEnvelope.digest === section[0]!.row.envelope.digest);
          if (mapped.length !== 1) invalidComparison();
          key = mapped[0]!.unitKey;
        }
      }
      expected.push({ tag: spec.tag, field: [...spec.path, ...(spec.array ? [index] : [])],
        target: { family: spec.family, key } } as ReturnType<typeof auditRelationship>);
    }
  }
  if (object.anchor_id !== undefined && object.anchor_id !== null) {
    const value = nonemptyString(object.anchor_id);
    const metadata = Object.hasOwn(object, "metadata") ? auditObject(object.metadata) : {};
    if (Object.hasOwn(metadata, "anchor_id") && metadata.anchor_id !== value) invalidComparison();
    expected.push({ tag: "anchor", field: ["anchor_id"], target: { family: disposition.family, key: disposition.unitKey }, value });
  }
  if (object.storage_path !== undefined && object.storage_path !== null) {
    const path = nonemptyString(object.storage_path);
    const matches = units.filter(unit => unit.family === "private_objects").filter(unit => {
      const planned = auditObject(findPlanned(unit));
      return planned.tag === "private_object" && auditObject(planned.ref).objectPath === path;
    });
    if (matches.length !== 1) invalidComparison();
    expected.push({ tag: "private_object", field: ["storage_path"],
      target: { family: "private_objects", key: matches[0]!.unitKey } });
  }
  if(disposition.family==="private_objects"){
    const retained=auditRetainedEvidence(payload);
    if(retained.tag!=="private_object")invalidComparison();
    const objectPath=retained.ref.objectPath;
    const images=candidateRows.filter(value=>value.table==="document_images"&&value.row.row.storage_path===objectPath);
    if(images.length!==1)invalidComparison();
    const imageId=uuidValue(images[0]!.row.row.id);
    const targets=units.filter(unit=>unit.family==="images"&&unit.unitKey===imageId&&unit.group==="worker_core"&&
      unit.declaration.artifactGenerationId===null&&unit.declaration.producer.name==="local-worker");
    if(targets.length!==1)invalidComparison();
    expected.push({tag:"input",field:["ref","objectPath"],target:{family:"images",key:imageId}});
  }
  if(disposition.family==="cache_inputs"){
    const captured=auditObject(object.input),task=auditObject(captured.task);
    nonemptyString(auditObject(task.image).path);
    expected.push({tag:"input",field:["input","task","image","path"],
      target:{family:"native_structure",key:"extracted-document"}});
  }
  for (const edge of expected) {
    const targets = units.filter(unit => unit.family === edge.target.family && unit.unitKey === edge.target.key);
    if (targets.length !== 1 ||
      (["chunks", "images", "pages"].includes(edge.target.family) && targets[0]!.declaration.artifactGenerationId !== null) ||
      (edge.target.family === "sections" &&
        (targets[0]!.declaration.artifactGenerationId === null || targets[0]!.declaration.producer.name !== "local-worker")) ||
      (edge.target.family === "native_structure" && (targets[0]!.group !== "worker_native" ||
        targets[0]!.declaration.artifactGenerationId !== null || targets[0]!.declaration.producer.name !== "local-worker"))) invalidComparison();
  }
  const order = (left: ReturnType<typeof auditRelationship>, right: ReturnType<typeof auditRelationship>) =>
    compareText(encodeShadowNodeJsonCanonicalPayload(left), encodeShadowNodeJsonCanonicalPayload(right));
  const actual = [...disposition.relationships];
  expected.sort(order); actual.sort(order); sortedUnique(expected, order); sortedUnique(actual, order); auditEqual(actual, expected);
}

function shadowRequireOriginRow(origin: ReturnType<typeof auditOrigin>, row: Immutable<AuditRow>) {
  const identity = shadowRowIdentity(row);
  const matches = origin.rows[row.table].filter(value => shadowRowIdentity(value) === identity && value.envelope.digest === row.envelope.digest);
  if (matches.length !== 1) invalidComparison();
}
function shadowStoredEvidence(table: AuditTable, value: unknown): AuditRow {
  const row = auditObject(auditStoredRowSchema(table)(value));
  const canonicalPayload = auditPgText(row);
  const framed = payloadDigest("baseline", "pg-jsonb-text-v1", canonicalPayload);
  return { table, row, envelope: { version: 1, domain: "baseline", encoding: "pg-jsonb-text-v1", canonicalPayload, digest: framed.digest } };
}

/** Validates the complete pre-seal evidence graph. It does not validate a terminal transition. */
export function readShadowFinalInventoryV1(envelopeValue: unknown, contextValue: unknown) {
  return readShadowInventoryEvidence(envelopeValue, shadowFinalInventoryContext(contextValue), false);
}

/** Complete current evidence before a seal; no predicted terminal timestamp or receipt. */
export function readShadowPreSealInventoryV1(envelopeValue: unknown, contextValue: unknown) {
  const context = record({ memberRowEnvelope: auditAnyEnvelope, profileEnvelope: auditAnyEnvelope,
    inventoryRowEnvelopes: list(auditAnyEnvelope), originalOriginEnvelope: auditAnyEnvelope })(contextValue);
  return readShadowInventoryEvidence(envelopeValue, { ...context, sealedAt: null }, true);
}

function readShadowInventoryEvidence(envelopeValue: unknown,
  context: Omit<ReturnType<typeof shadowFinalInventoryContext>, "sealedAt"> & { sealedAt: string | null }, preSeal: boolean) {
  const member = auditStoredRow("document_index_generations", context.memberRowEnvelope);
  const final = auditEnvelope(envelopeValue, "inventory", shadowFinalInventoryPayload, "pg-jsonb-text-v1");
  const binding = final.payload.binding;
  const row = member.row;
  const profile=parseShadowExecutionProfileEnvelope(context.profileEnvelope);
  if(Buffer.byteLength(final.envelope.canonicalPayload,"utf8")>profile.payload.limits.maxOriginBundleBytes)invalidComparison();
  if (binding.artifactGenerationId !== null || row.document_id !== binding.source.documentId ||
    row.index_generation_id !== binding.candidateGenerationId || row.job_id !== binding.jobId ||
    row.first_lease_token !== binding.firstLeaseToken || row.owner_id !== binding.source.ownerId ||
    row.baseline_generation_id !== binding.source.baselineGenerationId || !shadowSame(row.source_binding,binding.source) ||
    row.expected_inventory_digest !== final.payload.expectedInventoryEnvelope.digest ||
    (!preSeal && row.inventory_digest !== final.envelope.digest))
    invalidComparison();
  const expected = auditEnvelope(final.payload.expectedInventoryEnvelope, "inventory", record({ manifest: inventoryManifest,
    declarations: list(shadowExpectedDeclaration) }), "pg-jsonb-text-v1");
  const manifest = parseShadowInventoryManifestPayload(expected.payload.manifest).payload;
  if (manifest.documentId!==binding.source.documentId||manifest.candidateGenerationId!==binding.candidateGenerationId||
    manifest.jobId!==binding.jobId||!shadowSame(expected.payload.manifest,row.inventory_manifest)) invalidComparison();
  const declared = manifest.families.flatMap(family=>family.groups.map(group=>{
    if(group.state!=="declared")invalidComparison();
    return {family:family.family,group:group.groupKey,declaration:group.declaration};
  }));
  const units = declared.flatMap(entry=>entry.declaration.population.tag==="known"
    ? entry.declaration.population.expectedUnits.map(unit=>({family:unit.family,unitKey:unit.key,declaration:entry.declaration,group:entry.group})) : [])
    .sort((a,b)=>compareText(a.family,b.family)||compareText(a.unitKey,b.unitKey));
  const order=(a:{family:string;unitKey:string},b:{family:string;unitKey:string})=>compareText(a.family,b.family)||compareText(a.unitKey,b.unitKey);
  sortedUnique(final.payload.finalDispositions,order); sortedUnique(expected.payload.declarations,order);
  auditEqual(expected.payload.declarations, units.map(unit=>{
    const found=expected.payload.declarations.find(value=>value.family===unit.family&&value.unitKey===unit.unitKey);
    if(!found||found.expected!==true||found.required!==shadowInventoryRequired(unit.family,unit.group)||
      found.producer!==unit.declaration.producer.name||!shadowSame(found.sourceBinding,{...binding,artifactGenerationId:unit.declaration.artifactGenerationId}))invalidComparison();
    return found;
  }));
  for(const entry of declared)shadowDeclarationEvidence(entry.declaration,entry.family,
    {...binding,artifactGenerationId:entry.declaration.artifactGenerationId});
  if(final.payload.finalDispositions.length!==units.length)invalidComparison();
  const inventoryRows=context.inventoryRowEnvelopes.map(value=>auditStoredRow("document_generation_inventory",value));
  sortedUnique(inventoryRows,(a,b)=>order({family:String(a.row.family),unitKey:String(a.row.unit_key)},{family:String(b.row.family),unitKey:String(b.row.unit_key)}));
  if(inventoryRows.length!==units.length)invalidComparison();
  const candidateRows=final.payload.candidateRows.map(entry=>({table:entry.table,row:auditStoredRow(entry.table,entry.rowEnvelope)}));
  sortedUnique(candidateRows,(a,b)=>compareText(a.table,b.table)||compareText(shadowRowIdentity(a.row),shadowRowIdentity(b.row)));
  const origin=auditOrigin(context.originalOriginEnvelope);
  const projectionRow=auditEnvelope(final.payload.projectionEnvelope,"projection",auditStoredRowSchema("document_generation_projections"),"pg-jsonb-text-v1").payload;
  const componentDeclarations={summary:projectionRow.summary_digest===null?null:declared.find(value=>value.family==="summary")?.declaration.outputManifestEnvelope,
    quality:projectionRow.quality_digest===null?null:declared.find(value=>value.family==="quality")?.declaration.outputManifestEnvelope,
    worker:projectionRow.worker_state_digest===null?null:declared.find(value=>value.family==="document_metadata")?.declaration.outputManifestEnvelope,
    deep:projectionRow.deep_memory_digest===null?null:declared.find(value=>value.group==="deep_memory")?.declaration.outputManifestEnvelope};
  if(Object.values(componentDeclarations).some(value=>value===undefined))invalidComparison();
  const sourceRows={pages:candidateRows.filter(value=>value.table==="document_pages").map(value=>value.row.envelope),
    chunks:candidateRows.filter(value=>value.table==="document_chunks").map(value=>value.row.envelope),
    images:candidateRows.filter(value=>value.table==="document_images").map(value=>value.row.envelope),
    sections:candidateRows.filter(value=>value.table==="document_sections").map(value=>value.row.envelope),
    cards:candidateRows.filter(value=>value.table==="document_memory_cards").map(value=>value.row.envelope),
    embeddingFields:candidateRows.filter(value=>value.table==="document_embedding_fields").map(value=>value.row.envelope)};
  const projection=readShadowProjectionAggregate(final.payload.projectionEnvelope,binding,context.profileEnvelope,
    componentDeclarations,sourceRows,context.sealedAt);
  const control=auditEnvelope(final.payload.preSealControlEnvelope,"control",shadowControlCheckpoint,"pg-jsonb-text-v1");
  if(preSeal) {
    if(row.state!=="building" || row.inventory_digest!==null || row.candidate_projection_digest!==null ||
      row.stage_receipt!==null || row.stage_receipt_digest!==null || row.staged_at!==null ||
      control.payload.controlRevision!==row.control_revision || !shadowSame(control.payload,row.control_snapshot) ||
      control.payload.ownNodeJobs.length!==1 || control.payload.ownNodeJobs[0]!.status!=="processing" ||
      control.payload.ownStages.length===0 || control.payload.ownStages.some(stage=>stage.stage_status!=="completed"||stage.finished_at===null))
      invalidComparison();
  } else if(control.payload.controlRevision+1!==row.control_revision)invalidComparison();
  const retainedPayloads=final.payload.retainedEvidence.filter(value=>value.tag==="payload");
  const retainedObjects=final.payload.retainedEvidence.filter(value=>value.tag==="private_object");
  const evidenceIdentities=final.payload.retainedEvidence.map(value=>value.tag==="payload"?`payload/${value.envelope.digest}`:
    `private_object/${encodeShadowNodeJsonCanonicalPayload(value.ref)}`).sort(compareText);
  sortedUnique(evidenceIdentities,compareText);
  const findPlanned=(unit:typeof units[number])=>{
    const envelope=unit.declaration.outputManifestEnvelope;
    const payload=auditObject(decodeStrictJson(envelope.canonicalPayload,envelope.encoding==="node-json-v1"));
    const matches=list(auditObject)(payload.units).filter(value=>value.family===unit.family&&value.key===unit.unitKey);
    if(matches.length!==1)return invalidComparison();
    return matches[0]!.output;
  };
  type ShadowNestedRepresentation="producer_json"|"cache_input"|"control_checkpoint"|"repair_audit_input";
  const expectedRetainedPayloads=new Map<string,{envelope:ShadowRawEnvelope;representation:ShadowNestedRepresentation}>();
  const expectRetainedPayload=(envelope:ShadowRawEnvelope,representation:ShadowNestedRepresentation)=>{
    const prior=expectedRetainedPayloads.get(envelope.digest);
    if(prior&&!shadowSame(prior,{envelope,representation}))invalidComparison();
    expectedRetainedPayloads.set(envelope.digest,{envelope,representation});
  };
  for(const entry of declared)expectRetainedPayload(entry.declaration.outputManifestEnvelope,"producer_json");
  for(const unit of units.filter(value=>["native_structure","cache_inputs","attempt_control","repair_audit_inputs"].includes(value.family))){
    const nested=auditAnyEnvelope(findPlanned(unit));
    expectRetainedPayload(nested,unit.family==="cache_inputs"?"cache_input":unit.family==="attempt_control"
      ?"control_checkpoint":unit.family==="repair_audit_inputs"?"repair_audit_input":"producer_json");
  }
  if(retainedPayloads.length!==expectedRetainedPayloads.size)invalidComparison();
  for(const entry of retainedPayloads){
    const expectedPayload=expectedRetainedPayloads.get(entry.envelope.digest);
    if(!expectedPayload||entry.representation!==expectedPayload.representation||entry.mediaType!=="application/json"||
      entry.byteLength!==Buffer.byteLength(entry.envelope.canonicalPayload,"utf8")||
      !shadowSame(entry.envelope,expectedPayload.envelope))invalidComparison();
  }
  const nativeUnits=units.filter(unit=>unit.family==="native_structure");
  const cacheUnits=units.filter(unit=>unit.family==="cache_inputs");
  if(nativeUnits.length>1||(cacheUnits.length>0&&nativeUnits.length!==1))invalidComparison();
  const nativeCapture=nativeUnits.length===1?shadowNativeCapture(findPlanned(nativeUnits[0]!)):null;
  if(nativeCapture!==null){
    const nativeUnit=nativeUnits[0]!;
    if(nativeUnit.unitKey!=="extracted-document"||nativeUnit.group!=="worker_native"||
      nativeUnit.declaration.artifactGenerationId!==null||nativeUnit.declaration.producer.name!=="local-worker")invalidComparison();
    const pageUnits=units.filter(unit=>unit.family==="pages"&&unit.group==="worker_core");
    if(pageUnits.length!==nativeCapture.input.extracted.pages.length)invalidComparison();
    const pageOrder=(left:{key:string},right:{key:string})=>compareText(left.key,right.key);
    const nativePages=nativeCapture.input.extracted.pages.map(page=>({key:String(page.pageNumber),page})).sort(pageOrder);
    const declaredPages=pageUnits.map(unit=>{
      const pageOutput=auditObject(findPlanned(unit));
      if(!Object.hasOwn(pageOutput,"extractedPage"))invalidComparison();
      return {key:unit.unitKey,page:pageOutput.extractedPage};
    }).sort(pageOrder);
    sortedUnique(nativePages,pageOrder);sortedUnique(declaredPages,pageOrder);auditEqual(declaredPages,nativePages);
  }
  const privateUnits=units.filter(unit=>unit.family==="private_objects");
  if(retainedObjects.length!==privateUnits.length)invalidComparison();
  for(const unit of privateUnits){
    const planned=auditRetainedEvidence(findPlanned(unit));
    if(planned.tag!=="private_object"||unit.group!=="private_objects"||
      unit.declaration.artifactGenerationId!==null||unit.declaration.producer.name!=="local-worker"||
      unit.unitKey!==shadowPrivateObjectIdentityV1(planned.ref)||
      retainedObjects.filter(value=>shadowSame(value,planned)).length!==1)invalidComparison();
  }
  const consumedCandidateRows=new Set<string>();
  const resolve=(ref:ReturnType<typeof inventoryArtifact>,disposition:ReturnType<typeof shadowFinalDisposition>,bindContent=true)=>{
    if(ref.tag==="candidate_row"){
      const table=auditOwnerTable[ref.owner] as ShadowCandidateTable;
      const matches=candidateRows.filter(value=>value.table===table&&value.row.row.id===ref.rowId&&value.row.envelope.digest===ref.rowDigest);
      if(matches.length!==1||(bindContent&&disposition.contentDigest!==ref.rowDigest))return invalidComparison();
      return matches[0]!.row.row;
    }
    if(ref.tag==="origin_row"){
      const table=auditOwnerTable[ref.owner];const matches=origin.rows[table].filter(value=>value.row.id===ref.rowId&&value.envelope.digest===ref.rowDigest);
      if(matches.length!==1||(bindContent&&disposition.contentDigest!==ref.rowDigest))return invalidComparison();return matches[0]!.row;
    }
    if(ref.tag==="candidate_projection"){
      if(!shadowSame(ref,disposition.artifactRef))return invalidComparison();
      const value=shadowSupportedProjectionPayload(projection,disposition);
      if(!bindContent&&ref.payloadDigest!==shadowProjectionComponentEnvelope(value).digest)return invalidComparison();
      return value;
    }
    if(ref.tag==="retained_payload"){
      const matches=retainedPayloads.filter(value=>value.envelope.digest===ref.envelopeDigest&&value.representation===ref.representation&&
        value.mediaType===ref.mediaType&&value.byteLength===ref.byteLength);
      if(matches.length!==1||(bindContent&&disposition.contentDigest!==ref.envelopeDigest))return invalidComparison();
      return decodeStrictJson(matches[0]!.envelope.canonicalPayload,matches[0]!.envelope.encoding==="node-json-v1");
    }
    const matches=retainedObjects.filter(value=>shadowSame(value.ref,ref));
    if(matches.length!==1)return invalidComparison();
    const bytes=Buffer.from(matches[0]!.bytes.content,"base64");
    if(bytes.toString("base64")!==matches[0]!.bytes.content||`sha256:${createHash("sha256").update(bytes).digest("hex")}`!==ref.sha256||
      bytes.length!==ref.byteLength||(bindContent&&disposition.contentDigest!==ref.sha256))return invalidComparison();return matches[0]!;
  };
  for(let index=0;index<units.length;index++){
    const unit=units[index]!,disposition=final.payload.finalDispositions[index]!,stored=inventoryRows[index]!.row;
    const deepFamily=shadowDeepRowFamily(unit.family,unit.group);
    const coreFamily=deepFamily===null?shadowCoreFamily(unit.family):null;
    if(coreFamily===null&&deepFamily===null&&!["summary","generated_labels","quality","document_metadata","private_objects","producer_aliases",
      "native_structure","cache_inputs","attempt_control","repair_audit_inputs"].includes(unit.family))invalidComparison();
    if(disposition.family!==unit.family||disposition.unitKey!==unit.unitKey||stored.document_id!==binding.source.documentId||
      stored.index_generation_id!==binding.candidateGenerationId||stored.lease_token!==binding.firstLeaseToken||
      stored.expected!==expected.payload.declarations[index]!.expected||stored.required!==expected.payload.declarations[index]!.required||
      stored.producer!==expected.payload.declarations[index]!.producer||!shadowSame(stored.source_binding,expected.payload.declarations[index]!.sourceBinding)||
      stored.artifact_generation_id!==unit.declaration.artifactGenerationId||
      !shadowSame(shadowDispositionRow(disposition),shadowInventoryStoredOutcome(stored)))invalidComparison();
    const planned=findPlanned(unit);
    if(disposition.disposition!=="retained"){
      if(deepFamily!==null||["summary","generated_labels","producer_aliases"].includes(unit.family))invalidComparison();
      const allowedReason=disposition.disposition==="failed"?disposition.reasonCode==="producer_failed":
        disposition.disposition==="skipped"?["producer_skipped","producer_unavailable"].includes(String(disposition.reasonCode)):
        disposition.reasonCode==="policy_excluded";
      const matchingLimitation=disposition.limitations.some(value=>value.code===disposition.reasonCode&&
        value.scope.family===disposition.family&&(value.scope.key===disposition.unitKey||value.scope.key==="*"));
      if(disposition.artifactRef!==null||disposition.contentDigest!==null||disposition.reasonCode===null||disposition.limitations.length===0||
        !allowedReason||!matchingLimitation||disposition.retainedNativePayload!==encodeShadowNodeJsonCanonicalPayload(planned)||
        expected.payload.declarations[index]!.required)invalidComparison();
    }else{
      if(disposition.reasonCode!==null||disposition.artifactRef===null||disposition.contentDigest===null)return invalidComparison();
      if(disposition.retainedNativePayload===null)return invalidComparison();
      let resolved: AuditJson;
      if(unit.family==="private_objects"){
        const retained=auditRetainedEvidence(planned),ref=disposition.artifactRef;
        if(retained.tag!=="private_object"||ref.tag!=="private_object"||!shadowSame(ref,retained.ref)||
          disposition.contentDigest!==ref.sha256||disposition.retainedNativePayload!==retained.bytes.content||
          unit.group!=="private_objects"||unit.declaration.artifactGenerationId!==null||
          unit.declaration.producer.name!=="local-worker")invalidComparison();
        const matches=retainedObjects.filter(value=>shadowSame(value,retained));
        const images=candidateRows.filter(value=>value.table==="document_images"&&value.row.row.storage_path===ref.objectPath&&
          matchesShadowPrivateObjectAttachmentV1({documentId:binding.source.documentId,ownerId:binding.source.ownerId,
            candidateGenerationId:binding.candidateGenerationId,jobId:binding.jobId,
            firstLeaseToken:binding.firstLeaseToken},retained,value.row.row));
        if(matches.length!==1||images.length!==1)invalidComparison();
        const imageId=uuidValue(images[0]!.row.row.id);
        const imageUnits=units.filter(value=>value.family==="images"&&value.unitKey===imageId&&value.group==="worker_core"&&
          value.declaration.artifactGenerationId===null&&value.declaration.producer.name==="local-worker");
        if(imageUnits.length!==1)invalidComparison();
        resolved=retained;
      }else if(["native_structure","cache_inputs","attempt_control","repair_audit_inputs"].includes(unit.family)){
        const ref=disposition.artifactRef,nested=auditAnyEnvelope(planned);
        const representation:ShadowNestedRepresentation=unit.family==="cache_inputs"?"cache_input":
          unit.family==="attempt_control"?"control_checkpoint":unit.family==="repair_audit_inputs"?"repair_audit_input":"producer_json";
        const expectedGroup=unit.family==="native_structure"?"worker_native":unit.family==="cache_inputs"?"cache":
          unit.family==="attempt_control"?"control":"repair";
        const expectedKey=unit.family==="native_structure"?"extracted-document":unit.family==="cache_inputs"?unit.unitKey:
          unit.family==="attempt_control"?binding.jobId:"enrichment-repair";
        if(ref.tag!=="retained_payload"||ref.envelopeDigest!==nested.digest||ref.representation!==representation||
          ref.mediaType!=="application/json"||ref.byteLength!==Buffer.byteLength(nested.canonicalPayload,"utf8")||
          disposition.contentDigest!==nested.digest||disposition.retainedNativePayload!==nested.canonicalPayload||
          disposition.retainedEvidenceText!==null||disposition.representationVersion!==null||disposition.transformVersion!==null||
          unit.declaration.artifactGenerationId!==null||unit.declaration.producer.name!=="local-worker"||
          unit.group!==expectedGroup||unit.unitKey!==expectedKey||
          ((unit.family==="attempt_control"||unit.family==="repair_audit_inputs")&&disposition.relationships.length!==0))
          invalidComparison();
        const capture=unit.family==="native_structure"?nativeCapture:unit.family==="cache_inputs"
          ?nativeCapture===null?invalidComparison():shadowCacheCapture(planned,unit.unitKey,nativeCapture,binding.source.ownerId)
          :unit.family==="attempt_control"?shadowControlCapture(planned,binding,control.payload)
          :shadowRepairCapture(planned,projection);
        if(capture===null||!shadowSame(capture.envelope,nested))invalidComparison();
        resolved=capture.retained;
      }else{
        const native=auditAnyEnvelope(decodeStrictJson(disposition.retainedNativePayload,false));
        auditEqual(decodeStrictJson(native.canonicalPayload,native.encoding==="node-json-v1"),planned);
        if(coreFamily===null&&deepFamily===null){
        if(disposition.artifactRef.tag!=="candidate_projection")invalidComparison();
        if((["summary","generated_labels"].includes(unit.family)&&
            (projection.components.summary===null||!shadowSame(unit.declaration.outputManifestEnvelope,
              projection.components.summary.payload.outputManifestEnvelope)))||
          (unit.family==="producer_aliases"&&
            (projection.components.deep===null||!shadowSame(unit.declaration.outputManifestEnvelope,
              projection.components.deep.outputManifestEnvelope))))invalidComparison();
          resolved=shadowSupportedProjectionPayload(projection,disposition);
        }else if(deepFamily!==null){
        const deep=projection.components.deep,ref=disposition.artifactRef;
        if(deep===null||ref.tag!=="candidate_row"||ref.owner!==shadowDeepOwner[deepFamily]||
          unit.declaration.artifactGenerationId===null||unit.declaration.artifactGenerationId!==deep.binding.artifactGenerationId||
          unit.declaration.producer.name!=="local-worker"||!shadowSame(unit.declaration.outputManifestEnvelope,deep.outputManifestEnvelope))invalidComparison();
        const table=shadowDeepTable[deepFamily];
        const matches=candidateRows.filter(entry=>entry.table===table&&entry.row.row.id===ref.rowId&&
          entry.row.envelope.digest===ref.rowDigest);
        const mapped=deep.mapping.filter(entry=>entry.family===deepFamily&&entry.unitKey===unit.unitKey&&
          entry.rowEnvelope.digest===ref.rowDigest);
        if(matches.length!==1||mapped.length!==1||disposition.contentDigest!==ref.rowDigest)invalidComparison();
        const candidate=matches[0]!.row;
        if(candidate.row.document_id!==binding.source.documentId||auditGeneration(candidate)!==binding.candidateGenerationId)invalidComparison();
        const candidateKey=`${table}/${shadowRowIdentity(candidate)}/${candidate.envelope.digest}`;
        if(consumedCandidateRows.has(candidateKey))invalidComparison();
          consumedCandidateRows.add(candidateKey);resolved=candidate.row;
        }else{
        if(coreFamily===null)invalidComparison();
        const ref=disposition.artifactRef;
        if(ref.tag!=="candidate_row"||ref.owner!==shadowCoreOwner[coreFamily]||unit.group!=="worker_core"||
          unit.declaration.artifactGenerationId!==null||unit.declaration.producer.name!=="local-worker")invalidComparison();
        const table=shadowCoreTable[coreFamily];
        const matches=candidateRows.filter(entry=>entry.table===table&&entry.row.row.id===ref.rowId&&
          entry.row.envelope.digest===ref.rowDigest);
        if(matches.length!==1||disposition.contentDigest!==ref.rowDigest)invalidComparison();
        const candidate=matches[0]!.row;
        const key=coreFamily==="pages"?String(positiveInteger(candidate.row.page_number)):uuidValue(candidate.row.id);
        const original=coreFamily==="pages"?planned:readShadowProducerInputV1(planned).input;
        const repairs=coreFamily==="chunks"&&projection.components.deep!==null
          ? projection.components.deep.request.anchors.filter(anchor=>anchor.id===candidate.row.id):[];
        if(repairs.length>1)invalidComparison();
        const repair=repairs.length===1?{chunkId:uuidValue(candidate.row.id),anchorId:repairs[0]!.anchor_id,
          documentIntelligenceVersion:projection.components.deep!.request.document_intelligence_version}:undefined;
        if(key!==unit.unitKey||candidate.row.document_id!==binding.source.documentId||auditGeneration(candidate)!==binding.candidateGenerationId||
          !matchesShadowCoreStoredRowV1(coreFamily,{documentId:binding.source.documentId,ownerId:binding.source.ownerId,
            candidateGenerationId:binding.candidateGenerationId,jobId:binding.jobId,firstLeaseToken:binding.firstLeaseToken},original,candidate.row,repair))
          invalidComparison();
        const candidateKey=`${table}/${shadowRowIdentity(candidate)}/${candidate.envelope.digest}`;
        if(consumedCandidateRows.has(candidateKey))invalidComparison();
          consumedCandidateRows.add(candidateKey);resolved=candidate.row;
        }
      }
      shadowSupportedRelationships(resolved,disposition,units,candidateRows,projection,findPlanned);
    }
    for(const limitation of disposition.limitations)for(const pointer of limitation.evidence){
      const evidence=resolve(pointer.ref,disposition,false);auditPath(evidence,pointer.path);
    }
  }
  if(consumedCandidateRows.size!==candidateRows.length)invalidComparison();
  return freezeTree({kind:"shadow-final-inventory-validated" as const,envelope:final.envelope,payload:final.payload,
    member,expectedInventory:expected.envelope,projection,preSealControl:control});
}

const shadowMemberReceiptPayload=record({kind:choice("u04-member-seal-receipt-v1"),version:fixedNumber(1),
  binding:shadowCandidateView,planDigest:digestValue,preparedOriginDigest:digestValue,executionProfileDigest:digestValue,
  caseSetDigest:digestValue,expectedStateDigest:auditBareDigest,baselineBundleDigest:digestValue,expectedInventoryDigest:digestValue,
  finalInventoryEnvelope:auditAnyEnvelope,candidateProjectionDigest:digestValue,terminalControlEnvelope:auditAnyEnvelope,
  sealedAt:auditSqlTimestamp,limitations:list(inventoryLimitation)});
const shadowMemberReceiptContext=record({memberRowEnvelope:auditAnyEnvelope,profileEnvelope:auditAnyEnvelope,
  inventoryRowEnvelopes:list(auditAnyEnvelope),originalOriginEnvelope:auditAnyEnvelope,planDigest:digestValue});

/** Validates one immutable member receipt and its exact pre-seal to terminal control transition. */
export function readShadowMemberSealReceiptV1(envelopeValue:unknown,contextValue:unknown){
  const context=shadowMemberReceiptContext(contextValue);
  const receipt=auditEnvelope(envelopeValue,"member_receipt",shadowMemberReceiptPayload,"pg-jsonb-text-v1");
  const member=auditStoredRow("document_index_generations",context.memberRowEnvelope),row=member.row,binding=receipt.payload.binding;
  const profile=parseShadowExecutionProfileEnvelope(context.profileEnvelope);
  if(Buffer.byteLength(receipt.envelope.canonicalPayload,"utf8")>profile.payload.limits.maxOriginBundleBytes)invalidComparison();
  if(binding.artifactGenerationId!==null||binding.source.documentId!==row.document_id||binding.candidateGenerationId!==row.index_generation_id||
    binding.jobId!==row.job_id||binding.firstLeaseToken!==row.first_lease_token||!shadowSame(binding.source,row.source_binding)||
    row.authority_digest!==binding.source.authorityDigest||!shadowSame(row.original_origin_envelope,context.originalOriginEnvelope)||
    receipt.payload.planDigest!==context.planDigest||receipt.payload.preparedOriginDigest!==context.originalOriginEnvelope.digest||
    receipt.payload.executionProfileDigest!==context.profileEnvelope.digest||receipt.payload.executionProfileDigest!==binding.source.executionProfileDigest||
    receipt.payload.caseSetDigest!==profile.payload.cases.digest||receipt.payload.expectedStateDigest!==row.expected_state_digest||
    receipt.payload.baselineBundleDigest!==row.baseline_bundle_digest||receipt.payload.expectedInventoryDigest!==row.expected_inventory_digest||
    receipt.payload.finalInventoryEnvelope.digest!==row.inventory_digest||receipt.payload.candidateProjectionDigest!==row.candidate_projection_digest||
    row.stage_receipt_digest!==receipt.envelope.digest||!shadowSame(row.stage_receipt,receipt.envelope)||row.state!=="staged"||
    row.staged_at!==receipt.payload.sealedAt)return invalidComparison();
  const final=readShadowFinalInventoryV1(receipt.payload.finalInventoryEnvelope,{memberRowEnvelope:member.envelope,
    profileEnvelope:context.profileEnvelope,inventoryRowEnvelopes:context.inventoryRowEnvelopes,
    originalOriginEnvelope:context.originalOriginEnvelope,sealedAt:receipt.payload.sealedAt});
  if(final.projection.envelope.digest!==receipt.payload.candidateProjectionDigest||final.projection.row.sealed_at!==receipt.payload.sealedAt)invalidComparison();
  const terminal=auditEnvelope(receipt.payload.terminalControlEnvelope,"control",shadowControlCheckpoint,"pg-jsonb-text-v1");
  if(terminal.payload.controlRevision!==row.control_revision||!shadowSame(terminal.payload,row.control_snapshot)||
    terminal.payload.controlRevision!==final.preSealControl.payload.controlRevision+1||terminal.payload.ownNodeJobs.length!==1)invalidComparison();
  const prior=final.preSealControl.payload.ownNodeJobs[0]!,after=terminal.payload.ownNodeJobs[0]!;
  const intent={kind:"seal",binding:{documentId:binding.source.documentId,jobId:binding.jobId,
    candidateGenerationId:binding.candidateGenerationId,planDigest:receipt.payload.planDigest,
    baselineGenerationId:binding.source.baselineGenerationId,authorityDigest:binding.source.authorityDigest,
    workerId:prior.locked_by,firstLeaseToken:binding.firstLeaseToken,leaseDurationSeconds:prior.lease_duration_seconds}};
  const transition=shadowControlTransition(final.preSealControl.payload,intent,terminal.payload,
    {transactionStartedAt:after.updated_at,observedAt:receipt.payload.sealedAt});
  if(!transition.ok||after.status!=="completed"||after.stage!=="shadow_staged"||
    after.progress!==100||after.completed_at!==receipt.payload.sealedAt||after.locked_at!==null||after.locked_by!==null||
    final.preSealControl.payload.ownStages.length===0||
    final.preSealControl.payload.ownStages.some(stage=>stage.stage_status!=="completed"||stage.finished_at===null))invalidComparison();
  const limitations=final.payload.finalDispositions.flatMap(value=>value.limitations);
  auditEqual(receipt.payload.limitations,limitations);
  return freezeTree({kind:"shadow-member-seal-receipt-validated" as const,envelope:receipt.envelope,payload:receipt.payload,
    member,finalInventory:final,terminalControl:terminal});
}

const shadowWaveReceiptPayload=record({kind:choice("u04-wave-seal-receipt-v1"),version:fixedNumber(1),candidateGenerationId:uuidValue,
  planDigest:digestValue,preparedOriginDigest:digestValue,executionProfileDigest:digestValue,caseSetDigest:digestValue,
  baselineReportDigest:digestValue,recoveryEvidenceDigest:digestValue,operationManifestDigest:digestValue,documentIds:list(uuidValue,1),
  members:list(record({documentId:uuidValue,memberReceiptEnvelope:auditAnyEnvelope}),1),sealedAt:auditSqlTimestamp});
const shadowWaveReadbackPayload=record({version:fixedNumber(1),waveReceiptEnvelope:auditAnyEnvelope,
  baselineRows:list(record({documentId:uuidValue,rowEnvelope:auditAnyEnvelope}),1),observedOriginEnvelope:auditAnyEnvelope});
const shadowWaveMemberContext=record({documentId:uuidValue,memberContext:shadowMemberReceiptContext,persistenceAdmission:auditObject});
const shadowWaveReadbackContext=record({waveRowEnvelope:auditAnyEnvelope,currentOriginEnvelope:auditAnyEnvelope,
  members:list(shadowWaveMemberContext,1)});

/** Exact PostgreSQL-jsonb byte measure used by the complete wave ceiling. */
export function measureShadowWaveReadbackBytesV1(value:unknown){
  return Buffer.byteLength(auditPgText(auditJson(shadowWaveReadbackPayload(value))),"utf8");
}

/** Validates the deterministic whole-wave receipt and every immutable member/baseline readback. */
export function readShadowWaveReadbackV1(readbackValue:unknown,contextValue:unknown){
  const readback=shadowWaveReadbackPayload(readbackValue),context=shadowWaveReadbackContext(contextValue);
  const waveReceipt=auditEnvelope(readback.waveReceiptEnvelope,"wave_receipt",shadowWaveReceiptPayload,"pg-jsonb-text-v1");
  const wave=auditStoredRow("shadow_reindex_waves",context.waveRowEnvelope),row=wave.row;
  const memberContexts=[...context.members];sortedUnique(memberContexts,(a,b)=>compareText(a.documentId,b.documentId));
  sortedUnique(waveReceipt.payload.documentIds,compareText);sortedUnique(waveReceipt.payload.members,(a,b)=>compareText(a.documentId,b.documentId));
  sortedUnique(readback.baselineRows,(a,b)=>compareText(a.documentId,b.documentId));
  const profile=parseShadowExecutionProfileEnvelope(memberContexts[0]!.memberContext.profileEnvelope);
  if(measureShadowWaveReadbackBytesV1(readback)>profile.payload.limits.maxOriginBundleBytes)invalidComparison();
  if(waveReceipt.payload.members.length!==waveReceipt.payload.documentIds.length||readback.baselineRows.length!==waveReceipt.payload.documentIds.length||
    memberContexts.length!==waveReceipt.payload.documentIds.length||waveReceipt.payload.candidateGenerationId!==row.candidate_generation_id||
    waveReceipt.payload.planDigest!==row.plan_digest||
    waveReceipt.payload.preparedOriginDigest!==row.prepared_origin_digest||waveReceipt.payload.executionProfileDigest!==row.execution_profile_digest||
    waveReceipt.payload.caseSetDigest!==row.case_set_digest||waveReceipt.payload.baselineReportDigest!==row.baseline_report_digest||
    waveReceipt.payload.recoveryEvidenceDigest!==row.recovery_evidence_digest||waveReceipt.payload.operationManifestDigest!==row.operation_manifest_digest||
    !shadowSame(waveReceipt.payload.documentIds,profile.payload.documentIds)||!shadowSame(waveReceipt.payload.documentIds,memberContexts.map(value=>value.documentId))||
    !shadowSame(readback.observedOriginEnvelope,context.currentOriginEnvelope))invalidComparison();
  const observed=auditOrigin(readback.observedOriginEnvelope);
  if(observed.payload.executionProfileEnvelope.digest!==waveReceipt.payload.executionProfileDigest||
    Buffer.byteLength(readback.observedOriginEnvelope.canonicalPayload,"utf8")>profile.payload.limits.maxOriginBundleBytes)invalidComparison();
  auditWavePopulation(observed,profile);
  shadowRequireOriginRow(observed,wave);
  const bundleCache=new Map<string,ReturnType<typeof readShadowPersistenceBundleV1>>();
  const members=waveReceipt.payload.members.map((entry,index)=>{
    const supplied=memberContexts[index]!,baselineEntry=readback.baselineRows[index]!;
    if(entry.documentId!==supplied.documentId||baselineEntry.documentId!==entry.documentId)return invalidComparison();
    if(supplied.memberContext.planDigest!==waveReceipt.payload.planDigest||
      supplied.memberContext.originalOriginEnvelope.digest!==waveReceipt.payload.preparedOriginDigest||
      supplied.memberContext.profileEnvelope.digest!==waveReceipt.payload.executionProfileDigest)invalidComparison();
    const member=readShadowMemberSealReceiptV1(entry.memberReceiptEnvelope,supplied.memberContext);
    if(member.payload.binding.source.documentId!==entry.documentId||
      member.payload.binding.candidateGenerationId!==waveReceipt.payload.candidateGenerationId)invalidComparison();
    const baseline=auditStoredRow("document_generation_baselines",baselineEntry.rowEnvelope);
    if(baseline.row.document_id!==entry.documentId||baseline.row.candidate_generation_id!==waveReceipt.payload.candidateGenerationId||
      baseline.row.baseline_generation_id!==member.payload.binding.source.baselineGenerationId||
      baseline.row.expected_state_digest!==member.payload.expectedStateDigest||baseline.row.bundle_version!==1||
      baseline.row.bundle_digest!==member.payload.baselineBundleDigest||
      auditAnyEnvelope(baseline.row.bundle_payload).digest!==baseline.row.bundle_digest)return invalidComparison();
    const admitted=persistenceAdmission(supplied.persistenceAdmission);
    const bundleKey=encodeShadowNodeJsonCanonicalPayload([auditAnyEnvelope(baseline.row.bundle_payload),admitted]);
    let bundle=bundleCache.get(bundleKey);
    if(bundle===undefined){bundle=readShadowPersistenceBundleV1(baseline.row.bundle_payload,admitted,waveReceipt.payload.sealedAt);
      bundleCache.set(bundleKey,bundle);}
    const document=bundle.plan.documents.find(value=>value.documentId===entry.documentId);
    if(bundle.plan.digest!==waveReceipt.payload.planDigest||bundle.preparedOriginDigest!==waveReceipt.payload.preparedOriginDigest||
      bundle.executionProfileDigest!==waveReceipt.payload.executionProfileDigest||bundle.caseSetDigest!==waveReceipt.payload.caseSetDigest||
      bundle.parameters.p_baseline_evaluation.digest!==waveReceipt.payload.baselineReportDigest||
      bundle.recoveryEvidenceDigest!==row.recovery_evidence_digest||
      bundle.parameters.p_operation_manifest.digest!==row.operation_manifest_digest||!document||
      document.baselineGenerationId!==baseline.row.baseline_generation_id||document.expectedStateDigest!==baseline.row.expected_state_digest||
      !shadowSame(row.plan_payload,bundle.parameters.p_plan)||!shadowSame(row.baseline_report,bundle.parameters.p_baseline_evaluation)||
      row.plan_version!==bundle.plan.version||row.project_ref!==bundle.plan.targetProjectRef||
      row.source_policy_version!==bundle.plan.sourcePolicyVersion||row.audit_digest!==bundle.plan.auditDigest||
      row.population_fingerprint!==bundle.plan.populationFingerprint||row.baseline_evaluation_digest!==bundle.parameters.p_baseline_evaluation.digest||
      row.baseline_report_digest!==bundle.parameters.p_baseline_evaluation.digest)return invalidComparison();
    shadowRequireOriginRow(observed,member.member);
    shadowRequireOriginRow(observed,shadowStoredEvidence("document_generation_projections",member.finalInventory.projection.row));
    shadowRequireOriginRow(observed,baseline);
    for(const value of member.finalInventory.payload.candidateRows)
      shadowRequireOriginRow(observed,auditStoredRow(value.table,value.rowEnvelope));
    for(const value of supplied.memberContext.inventoryRowEnvelopes)shadowRequireOriginRow(observed,auditStoredRow("document_generation_inventory",value));
    for(const value of member.terminalControl.payload.ownNodeJobs)shadowRequireOriginRow(observed,shadowStoredEvidence("ingestion_jobs",value));
    for(const value of member.terminalControl.payload.ownStages)shadowRequireOriginRow(observed,shadowStoredEvidence("ingestion_job_stages",value));
    return member;
  });
  const maximum=members.reduce((value,member)=>shadowMicros(member.payload.sealedAt)>shadowMicros(value)?member.payload.sealedAt:value,members[0]!.payload.sealedAt);
  if(waveReceipt.payload.sealedAt!==maximum)return invalidComparison();
  return freezeTree({kind:"shadow-wave-readback-validated" as const,readback,waveReceipt:waveReceipt.envelope,wave,
    members,observedOrigin:observed.envelope});
}

function persistenceOriginalJson(input: unknown, kind: "u04-source-coverage-bytes-v1" | "u04-p04-report-bytes-v1" | "u04-recovery-readiness-bytes-v1") {
  const decoded = auditEnvelope(input, "u04-retained-evidence-v1", record({ kind: choice(kind),
    bytes: record({ encoding: choice("base64"), content: stringValue }) }));
  const bytes = Buffer.from(decoded.payload.bytes.content, "base64");
  if (bytes.toString("base64") !== decoded.payload.bytes.content) invalidComparison();
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { return invalidComparison(); }
  // A BOM belongs to the retained file. Only the parser's separate view removes it.
  const view = decodeStrictJson(text.startsWith("\uFEFF") ? text.slice(1) : text, false, false, true);
  return { envelope: decoded.envelope, value: view, rawDigest: `sha256:${createHash("sha256").update(bytes).digest("hex")}` };
}

function persistenceConfirmation(operation: ReturnType<typeof persistenceOperation>): string {
  const { confirmationSha256: _confirmation, ...manifest } = operation.manifest;
  return auditRawDigest(encodeShadowNodeJsonCanonicalPayload({ ...operation, manifest }));
}

/** Complete original-byte bundle validation. It does not acquire locks or authorize SQL. */
export function prepareShadowPersistenceV1(parametersValue: unknown, independentlyAdmitted: unknown, trustedNowValue: unknown) {
  try {
    const parameters = persistenceParameters(parametersValue);
    const admission = persistenceAdmission(independentlyAdmitted);
    const nowText = auditSqlTimestamp(trustedNowValue); const now = shadowMicros(nowText);
    const parsed = auditEnvelope(parameters.p_plan, "plan", persistencePlan);
    const { plan, audit } = parsed.payload;
    const operation = auditEnvelope(parameters.p_operation_manifest, "plan", persistenceOperation).payload;
    const manifest = operation.manifest;
    if (parameters.p_plan.digest !== admission.planDigest || parameters.p_baseline_evaluation.digest !== admission.baselineEvaluationDigest ||
      parameters.p_recovery_evidence.digest !== admission.recoveryEnvelopeDigest || parameters.p_operation_manifest.digest !== admission.operationManifestDigest ||
      audit.coverageEnvelope.digest !== admission.coverageEnvelopeDigest || audit.p04ReportEnvelope.digest !== admission.p04ReportEnvelopeDigest ||
      operation.planDigest !== parameters.p_plan.digest || operation.baselineEvaluationDigest !== parameters.p_baseline_evaluation.digest ||
      operation.recoveryEnvelopeDigest !== parameters.p_recovery_evidence.digest || manifest.operation !== "stage" ||
      manifest.targetProjectRef !== plan.targetProjectRef || persistenceConfirmation(operation) !== manifest.confirmationSha256) invalidComparison();
    auditEqual(manifest, admission.manifest); auditEqual(audit.validation, admission.validation);
    auditEqual(parameters.p_baseline_evaluation, audit.input.caseResultsEnvelope);
    if (shadowMicros(manifest.authorizedAt) > now || now >= shadowMicros(manifest.expiresAt) ||
      shadowMicros(manifest.expiresAt) <= shadowMicros(manifest.authorizedAt)) invalidComparison();
    const prepared = prepareShadowAuditV1(audit.input, admission.audit);
    if (prepared.kind !== "shadow-audit-prepared" || prepared.inventory === null) invalidComparison();
    const origin = auditOrigin(audit.input.originEnvelope);
    const profile = prepared.executionProfile;
    const retained = auditResolver(origin, audit.input);
    // Capture retains history as well as the selected G0 set. Recover every
    // captured object attachment, even when it did not contribute P04 counts.
    for (const entry of [...origin.rows.documents, ...origin.rows.document_images]) {
      const matches = [...retained.objects.values()].filter(object => object.ref.objectPath === entry.row.storage_path);
      if (matches.length !== 1) invalidComparison();
      const object = matches[0]!;
      if (entry.table === "documents" && (object.ref.sha256 !== entry.row.content_hash || object.ref.byteLength !== entry.row.file_size)) invalidComparison();
      if (entry.table === "document_images") {
        const metadata = auditObject(entry.row.metadata);
        // Existing local-worker capture records SHA256 of the actual image file
        // in both fields. A self-consistent replacement object is not that file.
        const hash = auditBareDigest(entry.row.image_hash);
        if (metadata.extractor !== "local-worker" || metadata.image_hash !== hash ||
          object.ref.sha256 !== `sha256:${hash}` || object.ref.mediaType !== entry.row.mime_type) invalidComparison();
      }
    }
    if (plan.targetProjectRef !== profile.target.projectRef || plan.sourcePolicyVersion !== profile.sourcePolicyVersion) invalidComparison();
    const ids = plan.documents.map((entry) => entry.documentId);
    sortedUnique(ids, compareText); exactPopulation(ids, profile.documentIds);
    exactPopulation(manifest.expectedDocumentIds, ids);
    if (manifest.expectedDocumentCount !== ids.length || ids.length > profile.limits.maxMembers) invalidComparison();
    for (const [index, member] of plan.documents.entries()) {
      const source = prepared.caseReport.sourceBindings[index]!;
      if (source.documentId !== member.documentId || source.baselineGenerationId !== member.baselineGenerationId ||
        member.expectedStateDigest !== origin.envelope.digest.slice(7) || plan.candidateGenerationId === member.baselineGenerationId) invalidComparison();
    }
    if (origin.rows.document_index_generations.some((entry) => entry.row.index_generation_id === plan.candidateGenerationId) ||
      origin.rows.shadow_reindex_waves.some((entry) => entry.row.candidate_generation_id === plan.candidateGenerationId)) invalidComparison();
    const generated = shadowMicros(prepared.caseReport.report.generated_at);
    const baseline = shadowMicros(audit.validation.baselineCompletedAt);
    const auditAt = shadowMicros(audit.validation.auditPreparedAt);
    const recoveryAt = shadowMicros(audit.validation.recoveryCheckedAt);
    if (shadowMicros(origin.payload.capturedAt) > generated || generated > baseline || baseline > auditAt ||
      auditAt > shadowMicros(manifest.authorizedAt) || recoveryAt > shadowMicros(manifest.authorizedAt)) invalidComparison();
    const coverageBytes = persistenceOriginalJson(audit.coverageEnvelope, "u04-source-coverage-bytes-v1");
    const expectedCoverage = parseExpectedSourceCoverageRegistry(coverageBytes.value);
    const report = buildIngestionAuditReport({ inventory: prepared.inventory, expectedCoverage });
    const reportBytes = persistenceOriginalJson(audit.p04ReportEnvelope, "u04-p04-report-bytes-v1");
    auditEqual(reportBytes.value, report);
    exactPopulation(report.documents.map((entry) => entry.documentId), ids);
    if (plan.auditDigest !== reportBytes.envelope.digest || plan.populationFingerprint !== report.populationFingerprint) invalidComparison();
    const recoveryBytes = persistenceOriginalJson(parameters.p_recovery_evidence, "u04-recovery-readiness-bytes-v1");
    const recovery = parseRecoveryReadinessEvidence(recoveryBytes.value);
    if (recoveryBytes.rawDigest !== admission.rawRecoveryFileDigest || recoveryBytes.rawDigest !== manifest.recoveryEvidenceSha256 ||
      recovery.digest !== admission.recoveryEvidenceDigest) invalidComparison();
    assertRecoveryReadinessForOperation(recovery, "document-generation", plan.targetProjectRef, new Date(Number(recoveryAt / 1000n)));
    assertRecoveryReadinessForOperation(recovery, "document-generation", plan.targetProjectRef, new Date(Number(now / 1000n)));
    // prepareShadowAuditV1 has resolved every selected attachment and retained ref
    // to full bytes and original rows. The bundle keeps the complete transport,
    // including historical and unselected captured rows; no summaries substitute.
    const bundlePayload = { kind: "u04-original-recovery-bundle-v1" as const, parameters };
    // This lower-bound check cannot replace SQL's exact PostgreSQL byte check.
    // Only the fixed SQL owner can construct the stored PG envelope.
    if (Buffer.byteLength(encodeShadowNodeJsonCanonicalPayload(bundlePayload), "utf8") > profile.limits.maxOriginBundleBytes) invalidComparison();
    return freezeTree({ kind: "shadow-persistence-prepared" as const, parameters, bundlePayload,
      plan: { ...plan, digest: parsed.envelope.digest }, report,
      rawP04ReportDigest: reportBytes.rawDigest, rawRecoveryFileDigest: recoveryBytes.rawDigest,
      recoveryEvidenceDigest: recovery.digest, preparedOriginDigest: origin.envelope.digest,
      executionProfileDigest: origin.payload.executionProfileEnvelope.digest, caseSetDigest: profile.cases.digest,
      terminalAcceptance: "unavailable" as const });
  } catch { return invalidComparison(); }
}

/** Integrity readback remains available after expiry/failure. It cannot authorize another stage dispatch. */
export function readShadowPersistenceBundleV1(bundleValue: unknown, independentlyAdmitted: unknown, trustedNowValue: unknown) {
  const parsed = auditEnvelope(bundleValue, "baseline", persistenceBundle, "pg-jsonb-text-v1");
  const admission = persistenceAdmission(independentlyAdmitted);
  const observedAt = auditSqlTimestamp(trustedNowValue);
  // Validate the original reservation basis at its independently bound historical
  // authorization observation; current freshness belongs only to preparation.
  const prepared = prepareShadowPersistenceV1(parsed.payload.parameters, admission, admission.manifest.authorizedAt);
  auditEqual(parsed.payload, prepared.bundlePayload);
  const origin = auditOrigin(auditEnvelope(prepared.parameters.p_plan, "plan", persistencePlan).payload.audit.input.originEnvelope);
  const profile = parseShadowExecutionProfileEnvelope(origin.payload.executionProfileEnvelope);
  if (Buffer.byteLength(parsed.envelope.canonicalPayload, "utf8") > profile.payload.limits.maxOriginBundleBytes) invalidComparison();
  return freezeTree({ ...prepared, kind: "shadow-persistence-integrity-only" as const, observedAt,
    bundle: parsed.envelope, stageReadiness: "not-assessed" as const });
}

function manualAliasReview(value: unknown) {
  return auditEnvelope(value, "u04-retained-evidence-v1", record({
    kind: choice("u04-manual-alias-lineage-review-v1"), evidenceMode: auditMode, target: record({ projectRef: projectReference }),
    aliasId: uuidValue, ownerId: nullable(uuidValue), rowDigest: digestValue, rowEnvelope: auditAnyEnvelope,
    producerIdentity: identityText, reviewer: record({ identity: identityText, role: auditRole, reviewedAt: auditDate }),
    basis: list(record({ producerIdentity: identityText, entry: record({ tag: choice("payload"), envelope: auditAnyEnvelope,
      representation: choice("producer_text", "producer_json", "producer_bytes"), mediaType: nonemptyString, byteLength: nonnegativeInteger }) }), 1),
    reviewText: identityText,
  }));
}
function validateManualAliasReviews(profile: { manualAliasIds: readonly string[]; manualAliasReviews: readonly ShadowRawEnvelope[];
  evidenceMode: "mocked" | "real"; target: { projectRef: string }; access: ReturnType<typeof profileAccess> }) {
  const reviews = profile.manualAliasReviews.map(manualAliasReview);
  sortedUnique(reviews, (a, b) => compareText(a.payload.aliasId, b.payload.aliasId));
  auditEqual(reviews.map((entry) => entry.payload.aliasId), profile.manualAliasIds);
  for (const { payload, envelope } of reviews) {
    const row = auditStoredRow("rag_aliases", payload.rowEnvelope);
    const metadata = auditObject(row.row.metadata);
    if (payload.rowDigest !== row.envelope.digest || row.row.id !== payload.aliasId || row.row.owner_id !== payload.ownerId ||
      payload.evidenceMode !== profile.evidenceMode || payload.target.projectRef !== profile.target.projectRef ||
      payload.producerIdentity === payload.reviewer.identity || Object.hasOwn(metadata, "generated_by") ||
      Object.hasOwn(metadata, "artifact_generation_id") || Object.hasOwn(metadata, "ingestion_lease_token")) invalidComparison();
    if (payload.ownerId === null ? !profile.access.includePublic : profile.access.mode !== "owner" || payload.ownerId !== profile.access.ownerId) invalidComparison();
    sortedUnique(payload.basis, (a, b) => compareText(a.entry.envelope.digest, b.entry.envelope.digest));
    for (const basis of payload.basis) {
      if (basis.producerIdentity === payload.reviewer.identity || basis.entry.envelope.digest === row.envelope.digest ||
        basis.entry.envelope.digest === envelope.digest || basis.entry.byteLength === 0 ||
        Buffer.byteLength(basis.entry.envelope.canonicalPayload,"utf8") !== basis.entry.byteLength) invalidComparison();
    }
  }
  // This verifies retained structure and independent bindings, never human authorship.
  return reviews;
}

const shadowGuardReasons = ["invalid_input", "origin_binding_unavailable", "origin_digest_mismatch", "snapshot_incomplete",
  "source_changed", "owner_changed", "live_generation_changed", "baseline_evidence_changed", "foreign_queue_changed", "batch_changed",
  "own_job_identity_changed", "own_control_changed", "lease_lost", "shadow_wave_restart_required", "unsealed_wave", "failed_wave", "control_transition_invalid"] as const;
type ShadowGuardReason = (typeof shadowGuardReasons)[number];
const shadowGuardScopes = ["origin", "source", "document", "artifact", "node_queue", "edge_queue", "stage", "batch", "claim", "seal"] as const;
type ShadowGuardScope = (typeof shadowGuardScopes)[number];
type ShadowGuardRefusal = Readonly<{ ok: false; version: 1; reason: ShadowGuardReason; documentId: string | null; scope: ShadowGuardScope; fieldPaths: readonly string[] }>;
function shadowRefusal(reason: ShadowGuardReason, scope: ShadowGuardScope, fieldPaths: string[], documentId: string | null = null): ShadowGuardRefusal {
  return Object.freeze({ ok: false, version: 1, reason, documentId, scope, fieldPaths: Object.freeze([...new Set(fieldPaths)].sort(compareText)) });
}
const shadowGuardPhase = choice("pre_enqueue", "before_claim", "building", "before_seal", "after_seal", "after_failure", "evaluate");
const shadowGuardClock = record({ transactionStartedAt: auditSqlTimestamp, observedAt: auditSqlTimestamp });
const shadowControlBinding = record({ documentId: uuidValue, jobId: uuidValue, candidateGenerationId: uuidValue,
  planDigest: digestValue, baselineGenerationId: nullable(uuidValue), authorityDigest: digestValue,
  workerId: nullable(identityText), firstLeaseToken: nullable(uuidValue), leaseDurationSeconds: boundedNumber(60,86400,true) });
function shadowControlCheckpoint(value: unknown) {
  return record({ controlRevision: nonnegativeInteger,
    ownNodeJobs: list((row) => auditObject(auditStoredRowSchema("ingestion_jobs")(row)), 1),
    ownStages: list((row) => auditObject(auditStoredRowSchema("ingestion_job_stages")(row))),
  })(value);
}
function shadowMicros(value: unknown): bigint {
  const text = auditSqlTimestamp(value);
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)$/.exec(text);
  if (!match) invalidComparison();
  const day = Date.parse(`${match[1]}T00:00:00.000Z`);
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0,10) !== match[1]) invalidComparison();
  const hour=Number(match[2]), minute=Number(match[3]), second=Number(match[4]);
  if (hour>23 || minute>59 || second>59) invalidComparison();
  const zone=match[6]!; let offset=0;
  if (zone!=="Z") {
    const parts=zone.slice(1).replace(":",""); const h=Number(parts.slice(0,2)), m=Number(parts.slice(2)||"0");
    if (h>15 || m>59) invalidComparison(); offset=(h*60+m)*(zone[0]==="-"?-1:1);
  }
  // Date is used only for whole UTC days; all stored sub-second precision is bigint.
  return BigInt(day)*1000n+BigInt(hour*3600+minute*60+second-offset*60)*1000000n+BigInt((match[5]??"").padEnd(6,"0"));
}
function shadowSame(a: unknown,b: unknown) { return encodeShadowNodeJsonCanonicalPayload(a)===encodeShadowNodeJsonCanonicalPayload(b); }
function shadowUnchanged(before: AuditRow["row"],after: AuditRow["row"],allowed: readonly string[]) {
  return Object.keys(before).every((key)=>allowed.includes(key)||shadowSame(before[key],after[key]));
}
function shadowIntent(value: unknown) {
  const common={binding:shadowControlBinding};
  switch(discriminant(value,"kind")) {
    case "enqueue": return record({kind:choice("enqueue"),...common,nextRunAt:auditSqlTimestamp})(value);
    case "claim": return record({kind:choice("claim"),...common})(value);
    case "heartbeat": return record({kind:choice("heartbeat"),...common})(value);
    case "progress": return record({kind:choice("progress"),...common,stage:stringValue,progress:boundedNumber(0,100,true)})(value);
    case "start_stage": return record({kind:choice("start_stage"),...common,stageId:uuidValue,stage:nonemptyString,metadata:auditObject})(value);
    case "finish_stage": return record({kind:choice("finish_stage"),...common,stageId:uuidValue,ok:booleanValue,counts:auditObject,error:nullable(stringValue)})(value);
    case "seal": return record({kind:choice("seal"),...common})(value);
    case "fail": return record({kind:choice("fail"),...common,error:nonemptyString})(value);
    default:return invalidComparison();
  }
}
/** Pure transition validation. A supplied checkpoint is a test value, never operational authority. */
export function validateShadowControlTransitionV1(beforeValue: unknown,intentValue: unknown,afterValue: unknown,clockValue: unknown,
  sealEvidenceValue?: unknown): ReturnType<typeof shadowControlTransition> {
  const transition=shadowControlTransition(beforeValue,intentValue,afterValue,clockValue);
  if(!transition.ok)return transition;
  const intent=shadowIntent(intentValue);
  if(intent.kind!=="seal")return sealEvidenceValue===undefined?transition:shadowRefusal("invalid_input","claim",["sealEvidence"]);
  if(sealEvidenceValue===undefined)return shadowRefusal("unsealed_wave","seal",["stage_receipt.semanticValidation"],intent.binding.documentId);
  try {
    const evidence=record({memberReceiptEnvelope:auditAnyEnvelope,memberContext:shadowMemberReceiptContext})(sealEvidenceValue);
    const receipt=readShadowMemberSealReceiptV1(evidence.memberReceiptEnvelope,evidence.memberContext);
    const binding=receipt.payload.binding, prior=receipt.finalInventory.preSealControl.payload.ownNodeJobs[0]!;
    auditEqual(beforeValue,receipt.finalInventory.preSealControl.payload);
    auditEqual(afterValue,receipt.terminalControl.payload);
    auditEqual(intent.binding,{documentId:binding.source.documentId,jobId:binding.jobId,
      candidateGenerationId:binding.candidateGenerationId,planDigest:receipt.payload.planDigest,
      baselineGenerationId:binding.source.baselineGenerationId,authorityDigest:binding.source.authorityDigest,
      workerId:prior.locked_by,firstLeaseToken:binding.firstLeaseToken,leaseDurationSeconds:prior.lease_duration_seconds});
    const clock=shadowGuardClock(clockValue);
    if(shadowMicros(clock.observedAt)!==shadowMicros(receipt.payload.sealedAt))invalidComparison();
    return transition;
  } catch {return shadowRefusal("unsealed_wave","seal",["stage_receipt.semanticValidation"],intent.binding.documentId);}
}

/** Structural transition shared by the full receipt validator; never exported as seal authority. */
function shadowControlTransition(beforeValue: unknown,intentValue: unknown,afterValue: unknown,clockValue: unknown):
  Readonly<{ok:true;version:1;kind:"control_transition_valid";controlRevision:number}>|ShadowGuardRefusal {
  let before:ReturnType<typeof shadowControlCheckpoint>|null,after:ReturnType<typeof shadowControlCheckpoint>,intent:ReturnType<typeof shadowIntent>,clock:ReturnType<typeof shadowGuardClock>;
  try { before=nullable(shadowControlCheckpoint)(beforeValue);after=shadowControlCheckpoint(afterValue);intent=shadowIntent(intentValue);clock=shadowGuardClock(clockValue);
    shadowMicros(clock.transactionStartedAt);shadowMicros(clock.observedAt);
  } catch {return shadowRefusal("invalid_input","claim",["control"]);}
  const b=intent.binding;const reject=()=>shadowRefusal("control_transition_invalid","claim",["control"],b.documentId);
  try {
    if(after.ownNodeJobs.length!==1||(before&&before.ownNodeJobs.length!==1)||b.candidateGenerationId===b.baselineGenerationId)return reject();
    const row=after.ownNodeJobs[0]!,prior=before?.ownNodeJobs[0];
    const now=shadowMicros(clock.observedAt),tx=shadowMicros(clock.transactionStartedAt);
    if(tx>now||row.id!==b.jobId||row.document_id!==b.documentId||row.batch_id!==null||row.max_attempts!==1||row.operation!=="shadow_reindex"||
      row.requested_generation_id!==b.candidateGenerationId||row.shadow_plan_digest!==b.planDigest)return reject();
    for(const checkpoint of [before,after]) if(checkpoint){
      sortedUnique(checkpoint.ownStages,(a,c)=>compareText(uuidValue(a.id),uuidValue(c.id)));
      for(const stage of checkpoint.ownStages) if(stage.job_id!==b.jobId||stage.document_id!==b.documentId||stage.job_kind!=="node"||
        stage.lease_token!==b.firstLeaseToken||stage.index_generation_id!==b.baselineGenerationId)return reject();
    }
    if(intent.kind==="enqueue"){
      if(before!==null||after.controlRevision!==0||after.ownStages.length!==0||b.firstLeaseToken!==null||b.workerId!==null||
        row.status!=="pending"||row.stage!=="queued"||row.progress!==0||row.attempt_count!==0||row.next_run_at!==intent.nextRunAt||
        shadowMicros(row.created_at)!==tx||shadowMicros(row.updated_at)!==tx||shadowMicros(intent.nextRunAt)!==now)return reject();
      for(const key of ["error_message","locked_at","locked_by","started_at","completed_at","lease_token","lease_expected_generation_id","lease_write_generation_id","lease_authority_digest","lease_expires_at","lease_duration_seconds"])
        if(row[key]!==null)return reject();
    } else {
      if(!before||!prior||after.controlRevision!==before.controlRevision+1||prior.id!==b.jobId||prior.document_id!==b.documentId||
        prior.batch_id!==null||prior.max_attempts!==1||prior.operation!=="shadow_reindex"||prior.requested_generation_id!==b.candidateGenerationId||prior.shadow_plan_digest!==b.planDigest)return reject();
      if(intent.kind==="claim"){
        if(prior.status!=="pending"||prior.attempt_count!==0||prior.lease_token!==null||!b.firstLeaseToken||!b.workerId||
          (prior.next_run_at!==null&&shadowMicros(prior.next_run_at)>now)||row.status!=="processing"||row.attempt_count!==1||row.next_run_at!==null||
          row.lease_token!==b.firstLeaseToken||row.locked_by!==b.workerId||row.lease_expected_generation_id!==b.baselineGenerationId||
          row.lease_write_generation_id!==b.candidateGenerationId||row.lease_authority_digest!==b.authorityDigest||row.lease_duration_seconds!==b.leaseDurationSeconds||
          shadowMicros(row.locked_at)!==now||shadowMicros(row.lease_expires_at)!==now+BigInt(b.leaseDurationSeconds)*1000000n||
          !shadowUnchanged(prior,row,["status","attempt_count","next_run_at","locked_at","locked_by","lease_token","lease_expected_generation_id","lease_write_generation_id","lease_authority_digest","lease_expires_at","lease_duration_seconds","updated_at"]))return reject();
      } else {
        if(!b.firstLeaseToken||!b.workerId||prior.status!=="processing"||prior.attempt_count!==1||prior.lease_token!==b.firstLeaseToken||
          prior.locked_by!==b.workerId||prior.lease_expected_generation_id!==b.baselineGenerationId||prior.lease_write_generation_id!==b.candidateGenerationId||
          prior.lease_authority_digest!==b.authorityDigest||prior.lease_duration_seconds!==b.leaseDurationSeconds||shadowMicros(prior.lease_expires_at)<=now)return reject();
        let allowed:string[]=[];
        if(intent.kind==="heartbeat"||intent.kind==="progress"){
          allowed=["locked_at","lease_expires_at","updated_at"];
          const locked=shadowMicros(row.locked_at),expiry=shadowMicros(row.lease_expires_at),duration=BigInt(b.leaseDurationSeconds)*1000000n;
          if(locked<tx||locked>now||expiry<locked+duration||expiry-duration>now||expiry<=now)return reject();
          if(intent.kind==="progress"){
            allowed.push("stage","progress");if(intent.stage.length>500||row.stage!==intent.stage||row.progress!==intent.progress)return reject();
          }
        }else if(intent.kind==="seal"){
          allowed=["status","stage","progress","locked_at","locked_by","completed_at","updated_at"];
          if(row.status!=="completed"||row.stage!=="shadow_staged"||row.progress!==100||row.locked_at!==null||row.locked_by!==null||shadowMicros(row.completed_at)!==now)return reject();
        }else if(intent.kind==="fail"){
          allowed=["status","stage","error_message","next_run_at","locked_at","locked_by","completed_at","updated_at"];
          if(intent.error.length>65536||row.status!=="failed"||row.stage!=="shadow_failed"||row.error_message!==intent.error||row.next_run_at!==null||
            row.locked_at!==null||row.locked_by!==null||shadowMicros(row.completed_at)!==now)return reject();
        }
        if(!shadowUnchanged(prior,row,allowed))return reject();
      }
      if(intent.kind!=="start_stage"&&intent.kind!=="finish_stage"){
        if(shadowMicros(row.updated_at)!==tx||!shadowSame(before.ownStages,after.ownStages))return reject();
      }else{
        const existing=before.ownStages.find((stage)=>stage.id===intent.stageId),changed=after.ownStages.find((stage)=>stage.id===intent.stageId);
        if(!changed||!shadowSame(before.ownStages.filter((stage)=>stage.id!==intent.stageId),after.ownStages.filter((stage)=>stage.id!==intent.stageId)))return reject();
        if(intent.kind==="start_stage"){
          if(existing||intent.stage.length>240||Buffer.byteLength(auditPgText(intent.metadata),"utf8")>65536||changed.stage_name!==intent.stage||
            !shadowSame(changed.metadata,intent.metadata)||changed.stage_status!=="started"||changed.error_class!==null||changed.retry_count!==0||
            !shadowSame(changed.artifact_counts,{})||changed.error_message!==null||changed.finished_at!==null||
            shadowMicros(changed.started_at)!==tx||shadowMicros(changed.created_at)!==tx)return reject();
        }else if(!existing||existing.stage_status!=="started"||changed.stage_status!==(intent.ok?"completed":"failed")||
          shadowMicros(changed.finished_at)!==now||!shadowSame(changed.artifact_counts,intent.counts)||changed.error_message!==intent.error||
          Buffer.byteLength(auditPgText(intent.counts),"utf8")>65536||!shadowUnchanged(existing,changed,["stage_status","finished_at","artifact_counts","error_message"]))return reject();
      }
    }
    return Object.freeze({ok:true,version:1,kind:"control_transition_valid",controlRevision:after.controlRevision});
  }catch{return reject();}
}

const shadowStateBinding = record({ projectRef: projectReference, planDigest: digestValue, candidateGenerationId: uuidValue,
  members:list(record({documentId:uuidValue,ownerId:nullable(uuidValue),baselineGenerationId:nullable(uuidValue),jobId:uuidValue,planDigest:digestValue,
    firstLeaseToken:nullable(uuidValue),authorityDigest:digestValue}),1) });
const shadowStateInput = record({version:fixedNumber(1),phase:shadowGuardPhase,binding:shadowStateBinding,
  auditInput:auditInputTransport,currentOriginEnvelope:auditAnyEnvelope,clock:shadowGuardClock});
type ShadowDeclaredProducer=Extract<ShadowInventoryManifestPayload["families"][number]["groups"][number],{state:"declared"}>["declaration"];
function shadowDeclarationEvidence(declaration:ShadowDeclaredProducer,family:string,expectedView:unknown) {
  // This existing full producer-batch representation is mechanically supported.
  // Other producer semantics remain unavailable, including unknown/unavailable
  // capability records; their structural retention never grants sanctioned state.
  if(declaration.population.tag!=="known"||declaration.population.basis.length===0)invalidComparison();
  const output=declaration.outputManifestEnvelope;
  const planned=record({producer:nonemptyString,producerVersion:nullable(nonemptyString),binding:shadowCandidateView,
    units:list(record({family:inventoryFamily,key:nonemptyString,output:auditJson}))})(decodeStrictJson(output.canonicalPayload,output.encoding==="node-json-v1"));
  if(planned.producer!==declaration.producer.name||planned.producerVersion!==declaration.producer.version)invalidComparison();
  auditEqual(planned.binding,expectedView);
  const keys=planned.units.map(unit=>encodeShadowNodeJsonCanonicalPayload({family:unit.family,key:unit.key}));
  if(new Set(keys).size!==keys.length)invalidComparison();
  const own=planned.units.filter(unit=>unit.family===family).map(unit=>({family:unit.family,key:unit.key})).sort((a,b)=>compareText(a.key,b.key));
  auditEqual(own,declaration.population.expectedUnits);
  for(const pointer of declaration.population.basis){
    const ref=pointer.ref;
    if(ref.tag!=="retained_payload"||ref.envelopeDigest!==output.digest||ref.representation!=="producer_json"||
      ref.byteLength!==Buffer.byteLength(output.canonicalPayload,"utf8"))invalidComparison();
    auditPath(planned,pointer.path);
  }
}
function shadowDeepDeclarationEvidence(unit:AuditRow,artifact:AuditRow,declaration:Extract<ShadowInventoryManifestPayload["families"][number]["groups"][number],{state:"declared"}>["declaration"]) {
  if(declaration.population.tag!=="known"||declaration.population.basis.length===0)invalidComparison();
  // The declaration retains the full batch, including zero-output slots. Unit
  // bytes remain independent evidence and are never replaced with batch bytes.
  const output=declaration.outputManifestEnvelope;
  const native=auditAnyEnvelope(decodeStrictJson(stringValue(unit.row.retained_native_payload),false));
  const planned=auditObject(decodeStrictJson(output.canonicalPayload,output.encoding==="node-json-v1"));
  if(planned.producer!==declaration.producer.name||planned.producerVersion!==declaration.producer.version)invalidComparison();
  auditEqual(planned.binding,unit.row.source_binding);
  const units=list(auditObject)(planned.units);
  const own=units.filter((entry)=>entry.family===unit.row.family&&entry.key===unit.row.unit_key);
  if(own.length!==1)invalidComparison();
  const nativeRow=auditObject(decodeStrictJson(native.canonicalPayload,native.encoding==="node-json-v1"));
  auditEqual(own[0]!.output,nativeRow);
  const originalMetadata=auditObject(nativeRow.metadata);
  if(nativeRow.index_generation_id!==declaration.artifactGenerationId||originalMetadata.index_generation_id!==declaration.artifactGenerationId)invalidComparison();
  // D-to-C finalization changes only the searchable generation marker here;
  // artifact D and every other original producer field remain exact.
  nativeRow.index_generation_id=artifact.row.index_generation_id!;
  const nativeMetadata=auditObject(nativeRow.metadata);nativeMetadata.index_generation_id=artifact.row.index_generation_id!;nativeRow.metadata=nativeMetadata;
  auditEqual(nativeRow,artifact.row);
  if(output.digest!==declaration.producer.outputManifestDigest)invalidComparison();
  const payload=decodeStrictJson(output.canonicalPayload,output.encoding==="node-json-v1");
  for(const pointer of declaration.population.basis){
    const ref=pointer.ref;
    if(ref.tag!=="retained_payload"||ref.envelopeDigest!==output.digest||ref.representation!=="producer_json"||
      ref.byteLength!==Buffer.byteLength(output.canonicalPayload,"utf8"))invalidComparison();
    auditPath(payload,pointer.path);
  }
}
function shadowRowIdentity(row:Immutable<AuditRow>){return encodeShadowNodeJsonCanonicalPayload(auditRowKey(row));}
function shadowTableScope(table:AuditTable):ShadowGuardScope {
  if(table==="documents")return "document";
  if(table==="ingestion_jobs")return "node_queue";
  if(table==="indexing_v3_agent_jobs")return "edge_queue";
  if(table==="ingestion_job_stages")return "stage";
  if(table==="import_batches")return "batch";
  if(table.startsWith("public_source_")||table==="document_publication_approvals")return "source";
  return "artifact";
}
/** Complete persisted-state comparison, not a lease/mutation/activation authority. */
export function compareShadowStateV1(untrustedInput: unknown, independentlyAdmitted: unknown,
  independentlyAdmittedCandidateRows: unknown = [], terminalEvidenceValue?: unknown) {
  return compareShadowStatePreparedV1(untrustedInput, independentlyAdmitted, independentlyAdmittedCandidateRows, terminalEvidenceValue);
}
// Private reuse inside one validated read. Public callers cannot provide a purported prior verdict.
function compareShadowStatePreparedV1(untrustedInput:unknown,independentlyAdmitted:unknown,independentlyAdmittedCandidateRows:unknown=[],
  terminalEvidenceValue?:unknown, validatedWave?: ReturnType<typeof readShadowWaveReadbackV1>):ShadowGuardRefusal|Readonly<{
  ok:true;version:1;kind:"origin_equal"|"sanctioned_u04_state";phase:ReturnType<typeof shadowGuardPhase>;
  p04ExpectedStateDigests:readonly Readonly<{documentId:string;expectedStateDigest:string}>[];
  u04BaselineDigest:string;controlRevisions:readonly Readonly<{documentId:string;controlRevision:number}>[];
}> {
  let input:ReturnType<typeof shadowStateInput>,original:ReturnType<typeof auditOrigin>,current:ReturnType<typeof auditOrigin>,prepared:AuditPreparation;
  let candidateBindings:{table:AuditTable;rowDigest:string}[];
  try {input=shadowStateInput(untrustedInput);original=auditOrigin(input.auditInput.originEnvelope);current=auditOrigin(input.currentOriginEnvelope);
    candidateBindings=list(record({table:choice(...Object.keys(auditStoredColumns) as [AuditTable,...AuditTable[]]),rowDigest:digestValue}))(independentlyAdmittedCandidateRows);
    sortedUnique(candidateBindings,(a,b)=>compareText(a.table,b.table)||compareText(a.rowDigest,b.rowDigest));
    shadowMicros(input.clock.transactionStartedAt);shadowMicros(input.clock.observedAt);
    sortedUnique(input.binding.members,(a,b)=>compareText(a.documentId,b.documentId));
  }catch{return shadowRefusal("invalid_input","origin",["input"]);}
  try{prepared=prepareShadowAuditV1(input.auditInput,independentlyAdmitted);}catch{return shadowRefusal("origin_binding_unavailable","origin",["auditAdmission"]);}
  if(prepared.kind!=="shadow-audit-prepared")return shadowRefusal("origin_binding_unavailable","origin",["auditInput"]);
  const failures:ShadowGuardRefusal[]=[];
  const add=(reason:ShadowGuardReason,scope:ShadowGuardScope,paths:string[],documentId:string|null=null)=>failures.push(shadowRefusal(reason,scope,paths,documentId));
  const revisions:{documentId:string;controlRevision:number}[]=[];
  try{
    const profile=prepared.executionProfile;
    if(!shadowSame(input.binding.members.map((m)=>m.documentId),profile.documentIds)||input.binding.members.some((m)=>m.planDigest!==input.binding.planDigest)||input.binding.projectRef!==profile.target.projectRef||
      !shadowSame(current.payload.executionProfileEnvelope,original.payload.executionProfileEnvelope)||!shadowSame(current.payload.documentIds,original.payload.documentIds)||
      !shadowSame(current.payload.manualAliasIds,original.payload.manualAliasIds)||current.payload.evidenceMode!==original.payload.evidenceMode||
      current.payload.sourcePolicyVersion!==original.payload.sourcePolicyVersion)add("origin_digest_mismatch","origin",["binding"]);
    try{auditWavePopulation(current,parseShadowExecutionProfileEnvelope(current.payload.executionProfileEnvelope));}
    catch{add("snapshot_incomplete","origin",["rows"]);}
    const allowed=new Set<string>();
    const consumedBindings=new Set<string>();
    const allow=(row:AuditRow)=>{
      const bindingKey=`${row.table}/${row.envelope.digest}`;
      if(!candidateBindings.some((binding)=>binding.table===row.table&&binding.rowDigest===row.envelope.digest)){
        add("own_control_changed",shadowTableScope(row.table),[`${row.table}.admittedRowDigest`],nullable(uuidValue)(row.row.document_id??null));return;
      }
      consumedBindings.add(bindingKey);allowed.add(`${row.table}/${shadowRowIdentity(row)}/${row.envelope.digest}`);
    };
    const ownJobIds=new Set(input.binding.members.map((member)=>member.jobId));
    const originalIds=new Map<AuditTable,Set<string>>((Object.keys(auditStoredColumns) as AuditTable[]).map((table)=>[table,new Set(original.rows[table].map(shadowRowIdentity))]));
    const c=input.binding.candidateGenerationId;
    const terminalInventories=new Map<string,ReturnType<typeof readShadowFinalInventoryV1>>();
    if(terminalEvidenceValue!==undefined) {
      try {
        if(input.phase==="before_seal") {
          const evidence=record({kind:choice("before_seal"),members:list(record({documentId:uuidValue,
            inventoryEnvelope:auditAnyEnvelope,context:auditObject}),1)})(terminalEvidenceValue);
          sortedUnique(evidence.members,(a,b)=>compareText(a.documentId,b.documentId));
          auditEqual(evidence.members.map(value=>value.documentId),input.binding.members.map(value=>value.documentId));
          for(const value of evidence.members) {
            const final=readShadowPreSealInventoryV1(value.inventoryEnvelope,value.context);
            const context=record({memberRowEnvelope:auditAnyEnvelope,profileEnvelope:auditAnyEnvelope,
              inventoryRowEnvelopes:list(auditAnyEnvelope),originalOriginEnvelope:auditAnyEnvelope})(value.context);
            auditEqual(context.originalOriginEnvelope,original.envelope);
            auditEqual(context.profileEnvelope,original.payload.executionProfileEnvelope);
            if(final.payload.binding.source.documentId!==value.documentId)invalidComparison();
            shadowRequireOriginRow(current,final.member);
            shadowRequireOriginRow(current,shadowStoredEvidence("document_generation_projections",final.projection.row));
            for(const row of final.payload.candidateRows)shadowRequireOriginRow(current,auditStoredRow(row.table,row.rowEnvelope));
            for(const row of context.inventoryRowEnvelopes)shadowRequireOriginRow(current,auditStoredRow("document_generation_inventory",row));
            for(const row of final.preSealControl.payload.ownNodeJobs)shadowRequireOriginRow(current,shadowStoredEvidence("ingestion_jobs",row));
            for(const row of final.preSealControl.payload.ownStages)shadowRequireOriginRow(current,shadowStoredEvidence("ingestion_job_stages",row));
            terminalInventories.set(value.documentId,final);
          }
        } else if(input.phase==="after_seal"||input.phase==="evaluate") {
          const evidence=record({kind:choice("sealed"),readback:shadowWaveReadbackPayload,context:shadowWaveReadbackContext})(terminalEvidenceValue);
          auditEqual(evidence.context.currentOriginEnvelope,current.envelope);
          if (validatedWave && (!shadowSame(validatedWave.readback,evidence.readback) ||
            !shadowSame(validatedWave.observedOrigin,evidence.context.currentOriginEnvelope))) invalidComparison();
          const wave=validatedWave??readShadowWaveReadbackV1(evidence.readback,evidence.context);
          const payload=auditEnvelope(wave.waveReceipt,"wave_receipt",shadowWaveReceiptPayload,"pg-jsonb-text-v1").payload;
          if(payload.candidateGenerationId!==c||payload.planDigest!==input.binding.planDigest||payload.preparedOriginDigest!==original.envelope.digest||
            payload.executionProfileDigest!==original.payload.executionProfileEnvelope.digest)invalidComparison();
          auditEqual(payload.documentIds,input.binding.members.map(value=>value.documentId));
          for(const member of wave.members)terminalInventories.set(member.payload.binding.source.documentId,member.finalInventory);
        } else invalidComparison();
      } catch {terminalInventories.clear();add("unsealed_wave","seal",["stage_receipt.semanticValidation"]);}
    }
    for(const member of input.binding.members){
      const document=original.rows.documents.find((row)=>row.row.id===member.documentId),observed=current.rows.documents.find((row)=>row.row.id===member.documentId);
      if(!document||!observed){add("snapshot_incomplete","document",["documents"],member.documentId);continue;}
      if(document.row.owner_id!==member.ownerId||observed.row.owner_id!==member.ownerId)add("owner_changed","document",["documents.owner_id"],member.documentId);
      if(document.row.index_generation_id!==member.baselineGenerationId||observed.row.index_generation_id!==member.baselineGenerationId||c===member.baselineGenerationId)
        add("live_generation_changed","document",["documents.index_generation_id"],member.documentId);
      const expected=auditEnvelope(input.auditInput.documents.find((doc)=>doc.documentId===member.documentId)?.reviewedExpectationsEnvelope,
        "u04-evidence-expectations-v1",auditExpected).payload;
      if(expected.source.authorityDigest!==member.authorityDigest)add("source_changed","source",["authorityDigest"],member.documentId);
      try{auditSourceAuthority(current,{...expected.source,originDigest:current.envelope.digest},parseShadowExecutionProfileEnvelope(current.payload.executionProfileEnvelope));}
      catch{add("source_changed","source",["authority"],member.documentId);}
      const ledger=current.rows.document_index_generations.filter((row)=>row.row.document_id===member.documentId&&row.row.index_generation_id===c);
      const job=current.rows.ingestion_jobs.find((row)=>row.row.id===member.jobId);
      if(input.phase==="pre_enqueue"){
        if(ledger.length||job||member.firstLeaseToken!==null)add("own_job_identity_changed","claim",["member"],member.documentId);
        continue;
      }
      if(ledger.length!==1||!job){add("own_job_identity_changed","claim",["member"],member.documentId);continue;}
      const g=ledger[0]!,r=g.row;
      if(r.job_id!==member.jobId||r.owner_id!==member.ownerId||r.baseline_generation_id!==member.baselineGenerationId||r.first_lease_token!==member.firstLeaseToken||
        r.authority_digest!==member.authorityDigest||r.expected_state_digest!==original.envelope.digest.slice(7)||!shadowSame(r.source_binding,expected.source)||
        !shadowSame(r.original_origin_envelope,original.envelope))add("own_job_identity_changed","claim",["document_index_generations"],member.documentId);
      if(originalIds.get("ingestion_jobs")!.has(shadowRowIdentity(job)))add("own_job_identity_changed","claim",["ingestion_jobs.id"],member.documentId);
      const checkpoint=shadowControlCheckpoint(r.control_snapshot);
      revisions.push({documentId:member.documentId,controlRevision:checkpoint.controlRevision});
      if(r.control_revision!==checkpoint.controlRevision||checkpoint.ownNodeJobs.length!==1||!shadowSame(checkpoint.ownNodeJobs[0],job.row))
        add("own_control_changed","node_queue",["control_snapshot.ownNodeJobs"],member.documentId);
      const stages=current.rows.ingestion_job_stages.filter((stage)=>stage.row.job_id===member.jobId);
      if(!shadowSame(checkpoint.ownStages,stages.map((stage)=>stage.row)))add("own_control_changed","stage",["control_snapshot.ownStages"],member.documentId);
      for(const stage of stages){if(stage.row.document_id!==member.documentId||stage.row.job_kind!=="node"||stage.row.lease_token!==member.firstLeaseToken||stage.row.index_generation_id!==member.baselineGenerationId)
        add("own_job_identity_changed","stage",["ingestion_job_stages"],member.documentId);allow(stage);}
      if(job.row.document_id!==member.documentId||job.row.batch_id!==null||job.row.operation!=="shadow_reindex"||job.row.requested_generation_id!==c||job.row.shadow_plan_digest!==member.planDigest||
        job.row.max_attempts!==1||job.row.lease_token!==member.firstLeaseToken)add("own_job_identity_changed","node_queue",["ingestion_jobs"],member.documentId);
      if(numberValue(job.row.attempt_count)>1)add("shadow_wave_restart_required","claim",["ingestion_jobs.attempt_count"],member.documentId);
      if(input.phase==="before_claim"){
        if(member.firstLeaseToken!==null||job.row.status!=="pending"||job.row.attempt_count!==0||r.state!=="reserved"||checkpoint.controlRevision!==0||
          job.row.stage!=="queued"||job.row.progress!==0||stages.length!==0||job.row.next_run_at===null||
          ["error_message","locked_at","locked_by","started_at","completed_at","lease_token","lease_expected_generation_id","lease_write_generation_id","lease_authority_digest","lease_expires_at","lease_duration_seconds"].some((key)=>job.row[key]!==null))
          add("shadow_wave_restart_required","claim",["member.firstLeaseToken"],member.documentId);
      }else if(input.phase==="building"||input.phase==="before_seal"){
        if(!member.firstLeaseToken||r.state!=="building"||job.row.attempt_count!==1||job.row.status!=="processing"||job.row.locked_by===null||job.row.lease_expected_generation_id!==member.baselineGenerationId||
          job.row.lease_write_generation_id!==c||job.row.lease_authority_digest!==member.authorityDigest||shadowMicros(job.row.lease_expires_at)<=shadowMicros(input.clock.observedAt))
          add("lease_lost","claim",["ingestion_jobs.lease"],member.documentId);
      }else if(input.phase==="after_failure"){
        if(job.row.status!=="failed"||job.row.stage!=="shadow_failed"||job.row.locked_by!==null||job.row.locked_at!==null||job.row.next_run_at!==null||r.state==="staged")
          add("own_control_changed","claim",["ingestion_jobs.status"],member.documentId);
      }else if(job.row.status!=="completed"||job.row.stage!=="shadow_staged"||r.state!=="staged"||r.stage_receipt===null||r.stage_receipt_digest===null)
        add(job.row.status==="failed"?"failed_wave":"unsealed_wave","seal",["member.state"],member.documentId);
      const terminalInventory=terminalInventories.get(member.documentId);
      if(input.phase==="before_seal"||input.phase==="after_seal"||input.phase==="evaluate") {
        if(!terminalInventory || !shadowSame(terminalInventory.member.envelope,g.envelope))
          add("unsealed_wave","seal",["stage_receipt.semanticValidation"],member.documentId);
      }
      if(terminalInventory)for(const value of terminalInventory.payload.candidateRows)allow(auditStoredRow(value.table,value.rowEnvelope));
      const manifest=parseShadowInventoryManifestPayload(r.inventory_manifest).payload;
      if(manifest.documentId!==member.documentId||manifest.candidateGenerationId!==c||manifest.jobId!==member.jobId)invalidComparison();
      for(const family of manifest.families)for(const group of family.groups){
        if(group.state==="declared"&&group.declaration.firstLeaseToken!==member.firstLeaseToken)invalidComparison();
        if((input.phase==="after_seal"||input.phase==="evaluate")&&group.state!=="declared")add("unsealed_wave","seal",["inventory_manifest"],member.documentId);
      }
      const inventory=current.rows.document_generation_inventory.filter((row)=>row.row.document_id===member.documentId&&row.row.index_generation_id===c);
      const declarations=manifest.families.flatMap((family)=>family.groups.flatMap((group)=>group.state==="declared"?[{family:family.family,group:group.groupKey,declaration:group.declaration}]:[]));
      for(const entry of declarations)shadowDeclarationEvidence(entry.declaration,entry.family,{tag:"candidate",source:expected.source,
        candidateGenerationId:c,jobId:member.jobId,firstLeaseToken:member.firstLeaseToken,artifactGenerationId:entry.declaration.artifactGenerationId});
      for(const unit of inventory){
        if(unit.row.lease_token!==member.firstLeaseToken)invalidComparison();
        const declaration=declarations.find((entry)=>entry.family===unit.row.family&&entry.declaration.population.tag==="known"&&
          entry.declaration.population.expectedUnits.some((expectedUnit)=>expectedUnit.key===unit.row.unit_key));
        if(unit.row.expected===true&&!declaration)invalidComparison();
        if((input.phase==="after_seal"||input.phase==="evaluate")&&(unit.row.disposition==="pending"||(unit.row.required===true&&unit.row.disposition!=="retained")))
          add("unsealed_wave","seal",["document_generation_inventory.disposition"],member.documentId);
        if(unit.row.artifact_ref!==null){
          const ref=inventoryArtifact(unit.row.artifact_ref);
          if(ref.tag==="candidate_row"){
            const table=auditOwnerTable[ref.owner];const artifact=current.rows[table].find((row)=>row.row.id===ref.rowId&&row.envelope.digest===ref.rowDigest);
            if(!artifact||artifact.row.document_id!==member.documentId||(Object.hasOwn(artifact.row,"owner_id")&&artifact.row.owner_id!==member.ownerId)||!declaration)invalidComparison();
            const metadata=auditObject(artifact.row.metadata);
            if(metadata.ingestion_lease_token!==member.firstLeaseToken)invalidComparison();
            if(auditTableFamily[table]!==unit.row.family||unit.row.producer!==declaration.declaration.producer.name||
              unit.row.artifact_generation_id!==declaration.declaration.artifactGenerationId)invalidComparison();
            const view=shadowCandidateView(unit.row.source_binding);
            if(!shadowSame(view.source,expected.source)||view.candidateGenerationId!==c||view.jobId!==member.jobId||
              view.firstLeaseToken!==member.firstLeaseToken||view.artifactGenerationId!==unit.row.artifact_generation_id)invalidComparison();
            if(declaration.group==="deep_memory"){
              const d=declaration.declaration.artifactGenerationId;
              if(d===null||d===c||d===member.baselineGenerationId||(!terminalInventory&&unit.row.unit_key!==ref.rowId)||declaration.declaration.producer.name!=="local-worker"||
                !["document_sections","document_memory_cards","document_index_units"].includes(table)||artifact.row.producer!=="local-worker"||
                metadata.generated_by!=="local-worker"||artifact.row.artifact_generation_id!==d||metadata.artifact_generation_id!==d||
                (auditGeneration(artifact)!==d&&auditGeneration(artifact)!==c)||metadata.index_generation_id!==artifact.row.index_generation_id)invalidComparison();
              if(!terminalInventory)shadowDeepDeclarationEvidence(unit,artifact,declaration.declaration);
            }else if(auditGeneration(artifact)!==c)invalidComparison();
            allow(artifact);
          }
        }
        allow(unit);
      }
      const baselines=current.rows.document_generation_baselines.filter((row)=>row.row.document_id===member.documentId&&row.row.candidate_generation_id===c);
      if(baselines.length!==1)add("snapshot_incomplete","artifact",["document_generation_baselines"],member.documentId);
      for(const baseline of baselines){
        const bundle=auditAnyEnvelope(baseline.row.bundle_payload);
        if(baseline.row.baseline_generation_id!==member.baselineGenerationId||bundle.domain!=="baseline"||bundle.encoding!=="pg-jsonb-text-v1"||
          baseline.row.bundle_digest!==bundle.digest||r.baseline_bundle_digest!==bundle.digest)invalidComparison();
        // Retain the distinct baseline bundle exactly. Its semantic recovery contents
        // are not inferred from this independently admitted full-row identity.
        allow(baseline);
      }
      for(const projection of current.rows.document_generation_projections.filter((row)=>row.row.document_id===member.documentId&&row.row.index_generation_id===c)){
        if(projection.row.lease_token!==member.firstLeaseToken||projection.row.owner_id!==member.ownerId)invalidComparison();
        // Projection payload is an owned private addition, not a live baseline overwrite.
        // Complete projection/receipt semantic seals remain the fixed writer's own gate.
        allow(projection);
      }
      if(r.stage_receipt!==null){const receipt=auditAnyEnvelope(r.stage_receipt);if(receipt.domain!=="member_receipt"||receipt.digest!==r.stage_receipt_digest)invalidComparison();}
      allow(g);allow(job);
    }
    const waves=current.rows.shadow_reindex_waves.filter((row)=>row.row.candidate_generation_id===c);
    if(input.phase!=="pre_enqueue"&&waves.length!==1)add("snapshot_incomplete","artifact",["shadow_reindex_waves"]);
    for(const wave of waves){
      if(wave.row.plan_digest!==input.binding.planDigest||wave.row.project_ref!==input.binding.projectRef||wave.row.source_policy_version!==profile.sourcePolicyVersion||
        wave.row.prepared_origin_digest!==original.envelope.digest||wave.row.execution_profile_digest!==prepared.admission.executionProfileDigest)invalidComparison();allow(wave);
    }
    for(const table of Object.keys(auditStoredColumns) as AuditTable[]){
      const priorRows=new Map(original.rows[table].map((row)=>[shadowRowIdentity(row),row]));
      const currentRows=new Map(current.rows[table].map((row)=>[shadowRowIdentity(row),row]));
      const scope=shadowTableScope(table);
      for(const key of new Set([...priorRows.keys(),...currentRows.keys()])){
        const before=priorRows.get(key),after=currentRows.get(key);
        if(before&&after&&before.envelope.canonicalPayload===after.envelope.canonicalPayload)continue;
        if(!before&&after&&allowed.has(`${table}/${key}/${after.envelope.digest}`))continue;
        // Existing rows can never be excused by a candidate label or owned-ID claim.
        const doc=nullable(uuidValue)((after??before)!.row.document_id??(table==="documents"?(after??before)!.row.id:null));
        const reason:ShadowGuardReason=scope==="source"?"source_changed":scope==="batch"?"batch_changed":
          ["node_queue","edge_queue","stage"].includes(scope)?"foreign_queue_changed":"baseline_evidence_changed";
        const paths=before&&after?Object.keys(before.row).filter((field)=>!shadowSame(before.row[field],after.row[field])).map((field)=>`${table}.${field}`):[table];
        add(reason,scope,paths,doc);
      }
    }
    if(ownJobIds.size!==input.binding.members.length)add("own_job_identity_changed","claim",["binding.members.jobId"]);
    if(consumedBindings.size!==candidateBindings.length)add("own_control_changed","origin",["candidateRowBindings"]);
  }catch{add("invalid_input","origin",["state"]);}
  if(failures.length){failures.sort((a,b)=>shadowGuardReasons.indexOf(a.reason)-shadowGuardReasons.indexOf(b.reason)||compareText(a.documentId??"",b.documentId??"")||
    shadowGuardScopes.indexOf(a.scope)-shadowGuardScopes.indexOf(b.scope)||compareText(a.fieldPaths.join("/"),b.fieldPaths.join("/")));return failures[0]!;}
  return Object.freeze({ok:true,version:1,kind:input.phase==="pre_enqueue"?"origin_equal":"sanctioned_u04_state",phase:input.phase,
    p04ExpectedStateDigests:Object.freeze(input.auditInput.documents.map((member)=>Object.freeze({documentId:member.documentId,expectedStateDigest:original.envelope.digest.slice(7)}))),
    u04BaselineDigest:original.envelope.digest,controlRevisions:Object.freeze(revisions.map((revision)=>Object.freeze(revision)))});
}

// Evaluation authority and request parsing is deliberately transport-only. It
// validates complete immutable inputs but cannot construct an SQL/provider client.
const literal26sqlOperationTags = Object.freeze([...sqlOperationTags].sort(compareText));
const u04EvaluationAuthorityRunnerPolicy = record({
  kind: choice("u04-evaluation-runner-policy-v1"), version: fixedNumber(1),
  workload: choice("eval-quality-retrieval-and-rag-v1"), retrievalConcurrency: fixedNumber(1),
  qualityConcurrency: fixedNumber(1), evaluatorRetry: record({
    maxAttempts: positiveInteger, initialDelayMs: positiveInteger, maxDelayMs: positiveInteger,
  }),
  costRates: nullable(record({ input: numberValue, cachedInput: numberValue, output: numberValue })),
  runContext: record({ git_sha: nullable(stringValue), github_run_id: nullable(stringValue),
    github_run_attempt: nullable(stringValue), latency_context: identityText }),
  crossRegionRunner: booleanValue,
});
const u04EvaluationAuthorityReadPhase = (value: unknown) => discriminant(value, "side") === "baseline"
  ? record({ side: choice("baseline"), planDigest: publicNull, candidateGenerationId: publicNull,
    waveReceiptDigest: publicNull })(value)
  : record({ side: choice("candidate"), planDigest: digestValue, candidateGenerationId: uuidValue,
    waveReceiptDigest: digestValue })(value);
const u04EvaluationAuthorityCaseAddress = record({ kind: choice("retrieval", "quality"), index: nonnegativeInteger,
  caseId: stringValue });
const u04EvaluationAuthorityCaseScope = record({ case: u04EvaluationAuthorityCaseAddress, documentIds: list(uuidValue) });
const u04EvaluationAuthorityCaseScopes = record({ caseSetDigest: digestValue, scopes: list(u04EvaluationAuthorityCaseScope) });
const u04EvaluationAuthorityManifest = record({ version: fixedNumber(1), operation: choice("evaluate"),
  targetProjectRef: projectReference, planPath: nullable(nonemptyString), reportOrReceiptPath: nullable(nonemptyString),
  recoveryEvidencePath: nonemptyString, recoveryEvidenceSha256: digestValue,
  expectedDocumentIds: list(uuidValue, 1), expectedDocumentCount: positiveInteger,
  confirmationSha256: digestValue, authorizedAt: auditSqlTimestamp, expiresAt: auditSqlTimestamp });
const u04EvaluationAuthorityPayload = record({ kind: choice("u04-evaluation-authority-v1"), version: fixedNumber(1),
  manifest: u04EvaluationAuthorityManifest, phase: u04EvaluationAuthorityReadPhase, executionProfileDigest: digestValue,
  originalOriginDigest: digestValue, caseScopes: u04EvaluationAuthorityCaseScopes,
  runnerPolicy: u04EvaluationAuthorityRunnerPolicy, recoveryEnvelopeDigest: digestValue });
const u04EvaluationAuthorityPhaseEvidence = (value: unknown) => discriminant(value, "side") === "baseline"
  ? record({ side: choice("baseline"), planEnvelope: publicNull, waveReceiptEnvelope: publicNull })(value)
  : record({ side: choice("candidate"), planEnvelope: auditAnyEnvelope,
    waveReceiptEnvelope: auditAnyEnvelope })(value);
const u04EvaluationAuthorityContext = record({ authorityEnvelopeDigest: digestValue,
  targetProjectRef: projectReference, phase: u04EvaluationAuthorityReadPhase,
  expectedDocumentIds: list(uuidValue, 1), expectedManualAliasIds: list(uuidValue),
  executionProfileEnvelope: auditAnyEnvelope, originalOriginEnvelope: auditAnyEnvelope,
  recoveryEnvelope: auditAnyEnvelope, sourceBindings: list(auditSource, 1),
  caseScopes: u04EvaluationAuthorityCaseScopes, runnerPolicy: u04EvaluationAuthorityRunnerPolicy,
  phaseEvidence: u04EvaluationAuthorityPhaseEvidence, expectedExpiresAt: auditSqlTimestamp });
const u04EvaluationRequestPayload = record({ kind: choice("u04-evaluation-request-v1"), version: fixedNumber(1),
  sessionId: uuidValue, authorityEnvelopeDigest: digestValue, executionProfileDigest: digestValue,
  originalOriginDigest: digestValue, caseSetDigest: digestValue, configurationDigest: digestValue,
  sourceBindings: list(auditSource, 1), caseScopes: u04EvaluationAuthorityCaseScopes,
  phase: u04EvaluationAuthorityReadPhase, comparisonClock, requiredSqlOperations: list(choice(...sqlOperationTags), 26) });

export type ShadowEvaluationRunnerPolicyV1 = Immutable<ReturnType<typeof u04EvaluationAuthorityRunnerPolicy>>;
export type ShadowEvaluationReadPhaseV1 = Immutable<ReturnType<typeof u04EvaluationAuthorityReadPhase>>;
export type ShadowEvaluationAuthorityContextV1 = Immutable<ReturnType<typeof u04EvaluationAuthorityContext>>;

function validateU04EvaluationAuthorityCaseScopesV1(scopes: ReturnType<typeof u04EvaluationAuthorityCaseScopes>,
  profile: ReturnType<typeof parseShadowExecutionProfileEnvelope>) {
  if (scopes.caseSetDigest !== profile.cases.bytes.envelope.digest) invalidComparison();
  const cases = [
    ...profile.cases.payload.retrieval.map((entry, index) => ({ kind: "retrieval" as const, index,
      caseId: entry.testCase.id })),
    ...profile.cases.payload.quality.map((entry, index) => ({ kind: "quality" as const, index, caseId: entry.id })),
  ];
  if (scopes.scopes.length !== cases.length) invalidComparison();
  for (const [index, scope] of scopes.scopes.entries()) {
    auditEqual(scope.case, cases[index]);
    sortedUnique(scope.documentIds, compareText);
    if (scope.documentIds.some((documentId) => !profile.payload.documentIds.includes(documentId))) invalidComparison();
  }
}

function u04EvaluationAuthorityConfirmationV1(authority: ReturnType<typeof u04EvaluationAuthorityPayload>) {
  const { confirmationSha256: _confirmationSha256, ...manifest } = authority.manifest;
  return auditRawDigest(encodeShadowNodeJsonCanonicalPayload({ ...authority, manifest }));
}

function validateU04EvaluationCandidateEvidenceV1(
  authority: ReturnType<typeof u04EvaluationAuthorityPayload>,
  context: ReturnType<typeof u04EvaluationAuthorityContext>,
  recoveryEvidenceDigest: string,
) {
  if (authority.phase.side === "baseline") {
    if (authority.manifest.planPath !== null || authority.manifest.reportOrReceiptPath !== null ||
      context.phaseEvidence.side !== "baseline") invalidComparison();
    return;
  }
  if (authority.manifest.planPath === null || context.phaseEvidence.side !== "candidate") invalidComparison();
  const plan = auditEnvelope(context.phaseEvidence.planEnvelope, "plan", persistencePlan);
  const wave = auditEnvelope(context.phaseEvidence.waveReceiptEnvelope, "wave_receipt", shadowWaveReceiptPayload,
    "pg-jsonb-text-v1");
  const phase = authority.phase;
  const authorizedAt = shadowMicros(authority.manifest.authorizedAt);
  if (plan.envelope.digest !== phase.planDigest || plan.payload.plan.candidateGenerationId !== phase.candidateGenerationId ||
    wave.envelope.digest !== phase.waveReceiptDigest || wave.payload.planDigest !== phase.planDigest ||
    wave.payload.candidateGenerationId !== phase.candidateGenerationId ||
    wave.payload.preparedOriginDigest !== authority.originalOriginDigest ||
    wave.payload.executionProfileDigest !== authority.executionProfileDigest ||
    wave.payload.caseSetDigest !== authority.caseScopes.caseSetDigest ||
    wave.payload.recoveryEvidenceDigest !== recoveryEvidenceDigest ||
    plan.payload.plan.targetProjectRef !== authority.manifest.targetProjectRef ||
    !shadowSame(plan.payload.audit.input.originEnvelope, context.originalOriginEnvelope)) invalidComparison();
  if (shadowMicros(plan.payload.audit.validation.auditPreparedAt) > authorizedAt ||
    shadowMicros(wave.payload.sealedAt) > authorizedAt) invalidComparison();
  sortedUnique(plan.payload.plan.documents, (left, right) => compareText(left.documentId, right.documentId));
  sortedUnique(wave.payload.documentIds, compareText);
  sortedUnique(wave.payload.members, (left, right) => compareText(left.documentId, right.documentId));
  auditEqual(plan.payload.plan.documents.map((entry) => entry.documentId), authority.manifest.expectedDocumentIds);
  auditEqual(wave.payload.documentIds, authority.manifest.expectedDocumentIds);
  auditEqual(wave.payload.members.map((entry) => entry.documentId), authority.manifest.expectedDocumentIds);
  if (wave.payload.baselineReportDigest !== plan.payload.audit.input.caseResultsEnvelope.digest) invalidComparison();
  let maximumMemberSeal: string | null = null;
  for (const [index, member] of wave.payload.members.entries()) {
    const receipt = auditEnvelope(member.memberReceiptEnvelope, "member_receipt", shadowMemberReceiptPayload,
      "pg-jsonb-text-v1");
    const source = context.sourceBindings[index]!;
    const planned = plan.payload.plan.documents[index]!;
    if (member.documentId !== source.documentId || receipt.payload.binding.source.documentId !== member.documentId ||
      receipt.payload.binding.candidateGenerationId !== phase.candidateGenerationId ||
      receipt.payload.planDigest !== phase.planDigest || receipt.payload.preparedOriginDigest !== authority.originalOriginDigest ||
      receipt.payload.executionProfileDigest !== authority.executionProfileDigest ||
      receipt.payload.caseSetDigest !== authority.caseScopes.caseSetDigest ||
      planned.documentId !== source.documentId || planned.baselineGenerationId !== source.baselineGenerationId ||
      receipt.payload.expectedStateDigest !== planned.expectedStateDigest ||
      receipt.payload.binding.source.baselineGenerationId !== source.baselineGenerationId ||
      !shadowSame(receipt.payload.binding.source, source)) invalidComparison();
    if (maximumMemberSeal === null || shadowMicros(receipt.payload.sealedAt) > shadowMicros(maximumMemberSeal))
      maximumMemberSeal = receipt.payload.sealedAt;
  }
  if (maximumMemberSeal === null || wave.payload.sealedAt !== maximumMemberSeal) invalidComparison();
}

/**
 * Validates a separately admitted evaluation authority and all complete immutable context bytes.
 * This result is evidence only and grants no dispatch, SQL, provider, mutation or acceptance authority.
 */
export function readShadowEvaluationAuthorityV1(envelopeValue: unknown, contextValue: unknown, trustedNowValue: unknown) {
  try {
    const context = u04EvaluationAuthorityContext(contextValue);
    const authority = auditEnvelope(envelopeValue, "plan", u04EvaluationAuthorityPayload);
    const nowText = auditSqlTimestamp(trustedNowValue); const now = shadowMicros(nowText);
    const authorizedAt = shadowMicros(authority.payload.manifest.authorizedAt);
    const profile = parseShadowExecutionProfileEnvelope(context.executionProfileEnvelope);
    const origin = auditOrigin(context.originalOriginEnvelope);
    if (authority.envelope.digest !== context.authorityEnvelopeDigest ||
      authority.payload.manifest.targetProjectRef !== context.targetProjectRef ||
      authority.payload.manifest.expiresAt !== context.expectedExpiresAt ||
      !shadowSame(authority.payload.phase, context.phase) ||
      !shadowSame(authority.payload.caseScopes, context.caseScopes) ||
      !shadowSame(authority.payload.runnerPolicy, context.runnerPolicy) ||
      authority.payload.executionProfileDigest !== profile.bytes.envelope.digest ||
      authority.payload.originalOriginDigest !== origin.envelope.digest ||
      !shadowSame(origin.payload.executionProfileEnvelope, profile.bytes.envelope) ||
      origin.payload.sourcePolicyVersion !== profile.payload.sourcePolicyVersion ||
      !shadowSame(origin.payload.documentIds, profile.payload.documentIds) ||
      !shadowSame(origin.payload.manualAliasIds, profile.payload.manualAliasIds) ||
      !shadowSame(context.expectedDocumentIds, profile.payload.documentIds) ||
      !shadowSame(context.expectedManualAliasIds, profile.payload.manualAliasIds) ||
      !shadowSame(authority.payload.manifest.expectedDocumentIds, profile.payload.documentIds) ||
      authority.payload.manifest.expectedDocumentCount !== profile.payload.documentIds.length ||
      u04EvaluationAuthorityConfirmationV1(authority.payload) !== authority.payload.manifest.confirmationSha256 ||
      shadowMicros(origin.payload.capturedAt) > authorizedAt || authorizedAt > now ||
      now >= shadowMicros(authority.payload.manifest.expiresAt) ||
      shadowMicros(authority.payload.manifest.expiresAt) <= authorizedAt) invalidComparison();
    sortedUnique(context.expectedDocumentIds, compareText);
    sortedUnique(context.expectedManualAliasIds, compareText);
    sortedUnique(authority.payload.manifest.expectedDocumentIds, compareText);
    sortedUnique(context.sourceBindings, (left, right) => compareText(left.documentId, right.documentId));
    auditEqual(context.sourceBindings.map((source) => source.documentId), profile.payload.documentIds);
    auditWavePopulation(origin, profile);
    for (const source of context.sourceBindings) auditSourceAuthority(origin, source, profile);
    validateU04EvaluationAuthorityCaseScopesV1(authority.payload.caseScopes, profile);
    const recoveryBytes = persistenceOriginalJson(context.recoveryEnvelope, "u04-recovery-readiness-bytes-v1");
    const recovery = parseRecoveryReadinessEvidence(recoveryBytes.value);
    if (context.recoveryEnvelope.digest !== authority.payload.recoveryEnvelopeDigest ||
      recoveryBytes.rawDigest !== authority.payload.manifest.recoveryEvidenceSha256 ||
      recovery.projectRef !== context.targetProjectRef) invalidComparison();
    assertRecoveryReadinessForOperation(recovery, "document-generation", context.targetProjectRef,
      new Date(Number(authorizedAt / 1000n)));
    assertRecoveryReadinessForOperation(recovery, "document-generation", context.targetProjectRef,
      new Date(Number(now / 1000n)));
    validateU04EvaluationCandidateEvidenceV1(authority.payload, context, recovery.digest);
    return freezeTree({ kind: "shadow-evaluation-authority-validated" as const, envelope: authority.envelope,
      payload: authority.payload, context, executionProfileEnvelope: profile.bytes.envelope,
      originalOriginEnvelope: origin.envelope, recoveryEnvelope: context.recoveryEnvelope });
  } catch { return invalidComparison(); }
}

/** Prepares canonical authority bytes, then applies the same separate admission as the reader. */
export function prepareShadowEvaluationAuthorityV1(payloadValue: unknown, contextValue: unknown, trustedNowValue: unknown) {
  const payload = u04EvaluationAuthorityPayload(payloadValue);
  const envelope = createShadowNodeJsonByteEnvelope(payload, "plan").envelope;
  return readShadowEvaluationAuthorityV1(envelope, contextValue, trustedNowValue);
}

/** Validates a request against its complete separately admitted authority. No operation is dispatched. */
export function readShadowEvaluationRequestV1(requestEnvelopeValue: unknown, authorityEnvelopeValue: unknown,
  contextValue: unknown, trustedNowValue: unknown) {
  try {
    const authority = readShadowEvaluationAuthorityV1(authorityEnvelopeValue, contextValue, trustedNowValue);
    const request = auditEnvelope(requestEnvelopeValue, "u04-evaluation-request-v1", u04EvaluationRequestPayload);
    const profile = parseShadowExecutionProfileEnvelope(authority.context.executionProfileEnvelope);
    if (request.payload.authorityEnvelopeDigest !== authority.envelope.digest ||
      request.payload.executionProfileDigest !== authority.payload.executionProfileDigest ||
      request.payload.originalOriginDigest !== authority.payload.originalOriginDigest ||
      request.payload.caseSetDigest !== profile.cases.bytes.envelope.digest ||
      request.payload.configurationDigest !== profile.configuration.bytes.envelope.digest ||
      request.payload.comparisonClock !== profile.payload.comparisonClock ||
      !shadowSame(request.payload.sourceBindings, authority.context.sourceBindings) ||
      !shadowSame(request.payload.caseScopes, authority.payload.caseScopes) ||
      !shadowSame(request.payload.phase, authority.payload.phase) ||
      !shadowSame(request.payload.requiredSqlOperations, literal26sqlOperationTags)) invalidComparison();
    validateU04EvaluationAuthorityCaseScopesV1(request.payload.caseScopes, profile);
    return freezeTree({ kind: "shadow-evaluation-request-validated" as const, envelope: request.envelope,
      payload: request.payload, authority });
  } catch { return invalidComparison(); }
}

/**
 * Admits the complete runtime identity even when a workload issues no SQL reads.
 * Candidate evidence is validated here rather than being left to a per-read path.
 */
export function prepareShadowEvaluationRuntimeAdmissionV1(
  requestEnvelopeValue: unknown, authorityEnvelopeValue: unknown, independentlyAdmitted: unknown,
  trustedNowValue: unknown, candidateEvidence: unknown = null,
) {
  const request = readShadowEvaluationRequestV1(requestEnvelopeValue, authorityEnvelopeValue,
    independentlyAdmitted, trustedNowValue);
  if (request.payload.phase.side === "baseline") {
    if (candidateEvidence !== null) invalidComparison();
  } else validateU04EvaluationCandidateReadEvidence(request, candidateEvidence);
  return request;
}

/** Prepares canonical request bytes, then validates them against the admitted authority. */
export function prepareShadowEvaluationRequestV1(payloadValue: unknown, authorityEnvelopeValue: unknown,
  contextValue: unknown, trustedNowValue: unknown) {
  const payload = u04EvaluationRequestPayload(payloadValue);
  const envelope = createShadowNodeJsonByteEnvelope(payload, "u04-evaluation-request-v1").envelope;
  return readShadowEvaluationRequestV1(envelope, authorityEnvelopeValue, contextValue, trustedNowValue);
}

const shadowEvaluationIntegerValue: Schema<number> = (value) => {
  const result = numberValue(value);
  if (!Number.isSafeInteger(result) || result < -2147483648 || result > 2147483647) invalidComparison();
  return result;
};

const shadowEvaluationNullableText = nullable(stringValue);
const shadowEvaluationNullableUuid = nullable(uuidValue);
const shadowEvaluationNullableInteger = nullable(shadowEvaluationIntegerValue);
const shadowEvaluationNullableJson = nullable(auditJson);
const shadowEvaluationTextArray = list(nullable(stringValue));
const shadowEvaluationUuidArray = list(nullable(uuidValue));

const shadowEvaluationEmptyArray: Schema<never[]> = (value) =>
  list((_entry: unknown): never => invalidComparison())(value);
const shadowEvaluationNull: Schema<null> = (value) => {
  if (value !== null) invalidComparison();
  return null;
};
const shadowEvaluationEmptyObject = record({});

const shadowEvaluationLabelRow = record({
  id: uuidValue,
  document_id: uuidValue,
  owner_id: shadowEvaluationNullableUuid,
  label: stringValue,
  label_type: stringValue,
  source: stringValue,
  confidence: numberValue,
  metadata: auditJson,
  created_at: auditSqlTimestamp,
  updated_at: auditSqlTimestamp,
});

const shadowEvaluationImageMetadataRow = record({
  id: uuidValue,
  page_number: shadowEvaluationNullableInteger,
  storage_path: stringValue,
  caption: stringValue,
  bbox: shadowEvaluationNullableJson,
  image_type: stringValue,
  searchable: booleanValue,
  clinical_relevance_score: numberValue,
  source_kind: stringValue,
  sourceKind: stringValue,
  tableLabel: shadowEvaluationNullableText,
  tableTitle: shadowEvaluationNullableText,
  tableRole: shadowEvaluationNullableText,
  tableTextSnippet: shadowEvaluationNullableText,
  width: shadowEvaluationNullableInteger,
  height: shadowEvaluationNullableInteger,
  labels: shadowEvaluationTextArray,
  metadata: auditJson,
});

const shadowEvaluationHydratedChunkRow = record({
  id: uuidValue,
  document_id: uuidValue,
  page_number: shadowEvaluationNullableInteger,
  chunk_index: shadowEvaluationIntegerValue,
  section_heading: shadowEvaluationNullableText,
  section_path: shadowEvaluationTextArray,
  heading_level: shadowEvaluationNullableInteger,
  parent_heading: shadowEvaluationNullableText,
  anchor_id: shadowEvaluationNullableText,
  content: stringValue,
  retrieval_synopsis: shadowEvaluationNullableText,
  image_ids: shadowEvaluationUuidArray,
  index_generation_id: shadowEvaluationNullableUuid,
});

const shadowEvaluationDirectLookupChunkRow = record({
  id: uuidValue,
  document_id: uuidValue,
  page_number: shadowEvaluationNullableInteger,
  chunk_index: shadowEvaluationIntegerValue,
  section_heading: shadowEvaluationNullableText,
  section_path: shadowEvaluationTextArray,
  heading_level: shadowEvaluationNullableInteger,
  parent_heading: shadowEvaluationNullableText,
  anchor_id: shadowEvaluationNullableText,
  content: stringValue,
  retrieval_synopsis: shadowEvaluationNullableText,
  image_ids: shadowEvaluationUuidArray,
});

const shadowEvaluationImageRow = record({
  id: uuidValue,
  document_id: uuidValue,
  page_number: shadowEvaluationNullableInteger,
  storage_path: stringValue,
  caption: stringValue,
  bbox: shadowEvaluationNullableJson,
  image_type: stringValue,
  searchable: booleanValue,
  clinical_relevance_score: numberValue,
  source_kind: stringValue,
  width: shadowEvaluationNullableInteger,
  height: shadowEvaluationNullableInteger,
  labels: shadowEvaluationTextArray,
  metadata: auditJson,
});

const shadowEvaluationDocumentLookupFields = {
  id: uuidValue,
  owner_id: shadowEvaluationNullableUuid,
  title: stringValue,
  file_name: stringValue,
  status: stringValue,
  page_count: shadowEvaluationIntegerValue,
  chunk_count: shadowEvaluationIntegerValue,
  image_count: shadowEvaluationIntegerValue,
  metadata: auditJson,
};

const shadowEvaluationMemoryCardFields = {
  id: uuidValue,
  document_id: uuidValue,
  owner_id: shadowEvaluationNullableUuid,
  section_id: shadowEvaluationNullableUuid,
  card_type: stringValue,
  title: stringValue,
  content: stringValue,
  normalized_terms: shadowEvaluationTextArray,
  page_number: shadowEvaluationNullableInteger,
  source_chunk_ids: shadowEvaluationUuidArray,
  source_image_ids: shadowEvaluationUuidArray,
  confidence: numberValue,
  metadata: auditJson,
};

const shadowEvaluationTextChunkRow = record({
  id: uuidValue,
  document_id: uuidValue,
  title: stringValue,
  file_name: stringValue,
  page_number: shadowEvaluationNullableInteger,
  chunk_index: shadowEvaluationIntegerValue,
  section_heading: shadowEvaluationNullableText,
  content: stringValue,
  retrieval_synopsis: shadowEvaluationNullableText,
  image_ids: shadowEvaluationUuidArray,
  source_metadata: auditJson,
  document_labels: list(shadowEvaluationLabelRow),
  document_summary: shadowEvaluationNullableText,
  similarity: numberValue,
  text_rank: numberValue,
  hybrid_score: numberValue,
  lexical_score: numberValue,
  images: list(shadowEvaluationImageMetadataRow),
});

const shadowEvaluationHybridChunkRow = record({
  id: uuidValue,
  document_id: uuidValue,
  title: stringValue,
  file_name: stringValue,
  page_number: shadowEvaluationNullableInteger,
  chunk_index: shadowEvaluationIntegerValue,
  section_heading: shadowEvaluationNullableText,
  content: stringValue,
  retrieval_synopsis: shadowEvaluationNullableText,
  image_ids: shadowEvaluationUuidArray,
  source_metadata: auditJson,
  similarity: numberValue,
  text_rank: numberValue,
  hybrid_score: numberValue,
  rrf_score: numberValue,
  images: list(shadowEvaluationImageMetadataRow),
});

const shadowEvaluationVectorChunkRow = record({
  id: uuidValue,
  document_id: uuidValue,
  title: stringValue,
  file_name: stringValue,
  page_number: shadowEvaluationNullableInteger,
  chunk_index: shadowEvaluationIntegerValue,
  section_heading: shadowEvaluationNullableText,
  content: stringValue,
  retrieval_synopsis: shadowEvaluationNullableText,
  image_ids: shadowEvaluationUuidArray,
  source_metadata: auditJson,
  document_labels: shadowEvaluationEmptyArray,
  document_summary: shadowEvaluationNull,
  similarity: numberValue,
  images: shadowEvaluationEmptyArray,
});

const shadowEvaluationLookupChunkRow = record({
  id: uuidValue,
  document_id: uuidValue,
  page_number: shadowEvaluationNullableInteger,
  chunk_index: shadowEvaluationIntegerValue,
  section_heading: shadowEvaluationNullableText,
  section_path: shadowEvaluationTextArray,
  heading_level: shadowEvaluationNullableInteger,
  parent_heading: shadowEvaluationNullableText,
  anchor_id: shadowEvaluationNullableText,
  content: stringValue,
  retrieval_synopsis: shadowEvaluationNullableText,
  image_ids: shadowEvaluationUuidArray,
  text_rank: numberValue,
});

const shadowEvaluationTableFactRow = record({
  id: uuidValue,
  document_id: uuidValue,
  source_chunk_id: shadowEvaluationNullableUuid,
  source_image_id: shadowEvaluationNullableUuid,
  page_number: shadowEvaluationNullableInteger,
  table_title: shadowEvaluationNullableText,
  row_label: shadowEvaluationNullableText,
  clinical_parameter: shadowEvaluationNullableText,
  threshold_value: shadowEvaluationNullableText,
  action: shadowEvaluationNullableText,
  text_rank: numberValue,
  match_reason: stringValue,
  metadata: shadowEvaluationEmptyObject,
});

const shadowEvaluationEmbeddingFieldRow = record({
  id: uuidValue,
  document_id: uuidValue,
  source_chunk_id: uuidValue,
  field_type: stringValue,
  content: stringValue,
  similarity: numberValue,
  text_rank: numberValue,
  hybrid_score: numberValue,
});

const shadowEvaluationIndexUnitRow = record({
  id: uuidValue,
  document_id: uuidValue,
  source_chunk_id: uuidValue,
  source_image_id: shadowEvaluationNullableUuid,
  unit_type: stringValue,
  title: stringValue,
  content: stringValue,
  page_start: shadowEvaluationNullableInteger,
  page_end: shadowEvaluationNullableInteger,
  heading_path: shadowEvaluationTextArray,
  normalized_terms: shadowEvaluationTextArray,
  source_span: shadowEvaluationNullableJson,
  quality_score: numberValue,
  extraction_mode: stringValue,
  similarity: numberValue,
  text_rank: numberValue,
  hybrid_score: numberValue,
  metadata: auditJson,
});

const shadowEvaluationMemoryCardHybridRow = record({
  ...shadowEvaluationMemoryCardFields,
  similarity: numberValue,
  text_rank: numberValue,
  hybrid_score: numberValue,
  rrf_score: numberValue,
});

const shadowEvaluationRelatedDocumentRow = record({
  document_id: uuidValue,
  labels: list(shadowEvaluationLabelRow),
  summary: shadowEvaluationNullableText,
});

const shadowEvaluationRowSchemasV1 = {
  aliases: record({
    ownerRows: list(record({
      alias: stringValue,
      canonical: stringValue,
      alias_type: stringValue,
      weight: numberValue,
      owner_id: shadowEvaluationNullableUuid,
    })),
    publicRows: list(record({
      alias: stringValue,
      canonical: stringValue,
      alias_type: stringValue,
      weight: numberValue,
      owner_id: shadowEvaluationNullableUuid,
    })),
  }),
  corpus_terms: list(record({
    term: stringValue,
    has_ts_signal: booleanValue,
    title_doc_count: shadowEvaluationIntegerValue,
    chunk_present: booleanValue,
    total_doc_count: shadowEvaluationIntegerValue,
  })),
  correct_terms: stringValue,
  text_chunks: list(shadowEvaluationTextChunkRow),
  hybrid_chunks: list(shadowEvaluationHybridChunkRow),
  vector_chunks: list(shadowEvaluationVectorChunkRow),
  lookup_chunks: list(shadowEvaluationLookupChunkRow),
  lookup_chunk_terms: list(shadowEvaluationDirectLookupChunkRow),
  lookup_chunk_prefix: list(shadowEvaluationDirectLookupChunkRow),
  lookup_documents: list(record({
    ...shadowEvaluationDocumentLookupFields,
    text_rank: numberValue,
    match_reason: stringValue,
  })),
  lookup_document_terms: list(record(shadowEvaluationDocumentLookupFields)),
  table_facts: list(shadowEvaluationTableFactRow),
  embedding_fields: list(shadowEvaluationEmbeddingFieldRow),
  index_units: list(shadowEvaluationIndexUnitRow),
  memory_cards_hybrid: list(shadowEvaluationMemoryCardHybridRow),
  memory_cards_lexical: list(record(shadowEvaluationMemoryCardFields)),
  chunks_by_ids: list(shadowEvaluationHydratedChunkRow),
  chunks_by_indexes: list(shadowEvaluationHydratedChunkRow),
  documents: list(record({
    id: uuidValue,
    title: stringValue,
    file_name: stringValue,
    metadata: auditJson,
    owner_id: shadowEvaluationNullableUuid,
    status: stringValue,
  })),
  ranking_metadata: list(shadowEvaluationRelatedDocumentRow),
  related_documents: list(shadowEvaluationRelatedDocumentRow),
  quality: list(record({
    document_id: uuidValue,
    owner_id: shadowEvaluationNullableUuid,
    quality_score: numberValue,
    extraction_quality: stringValue,
    metrics: auditJson,
    issues: shadowEvaluationTextArray,
    updated_at: auditSqlTimestamp,
  })),
  images_by_ids: list(shadowEvaluationImageRow),
  images_by_pages: list(shadowEvaluationImageRow),
  visual_rows: list(record({
    id: uuidValue,
    document_id: uuidValue,
    page_number: shadowEvaluationNullableInteger,
    source_kind: stringValue,
    searchable: booleanValue,
    image_type: stringValue,
    clinical_relevance_score: numberValue,
    metadata: auditJson,
  })),
  adjacent_chunks: list(record({
    id: uuidValue,
    document_id: uuidValue,
    page_number: shadowEvaluationNullableInteger,
    chunk_index: shadowEvaluationIntegerValue,
    section_heading: shadowEvaluationNullableText,
    content: stringValue,
    retrieval_synopsis: shadowEvaluationNullableText,
    index_generation_id: shadowEvaluationNullableUuid,
  })),
} as const satisfies Record<(typeof sqlOperationTags)[number], Schema<unknown>>;

export type ShadowEvaluationOperationV1 = keyof typeof shadowEvaluationRowSchemasV1;

export function readShadowEvaluationRowsV1<K extends ShadowEvaluationOperationV1>(
  operation: K,
  rows: unknown,
): Immutable<ReturnType<(typeof shadowEvaluationRowSchemasV1)[K]>> {
  if (typeof operation !== "string" || !Object.hasOwn(shadowEvaluationRowSchemasV1, operation)) invalidComparison();
  const schema = shadowEvaluationRowSchemasV1[operation] as Schema<unknown>;
  return freezeTree(schema(rows)) as Immutable<ReturnType<(typeof shadowEvaluationRowSchemasV1)[K]>>;
}

// Preserve the actual fixed RPC arguments, including array order/duplicates and
// existing SQL clamp inputs. Only the separately bound case controls population.
const u04EvaluationDocumentFilters = nullable(list(uuidValue));
const u04EvaluationVectorArgument: Schema<string> = value => {
  const text = stringValue(value);
  // Keep the exact transport spelling; PostgreSQL performs the vector conversion.
  // Syntax/dimensions are validated here without replacing the original bytes.
  if (!/^\[\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?(?:\s*,\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)*\s*\]$/.test(text)) invalidComparison();
  const elements = text.slice(1, -1).split(",").map(part => Number(part.trim()));
  if (elements.length !== 1536 || elements.some(element => !Number.isFinite(element))) invalidComparison();
  return text;
};
const u04EvaluationHybridArguments = {
  query_embedding: u04EvaluationVectorArgument, query_text: stringValue,
  match_count: shadowEvaluationIntegerValue, min_similarity: numberValue,
  document_filters: u04EvaluationDocumentFilters,
};
const u04EvaluationArgumentsSchemas = {
  aliases: record({}),
  corpus_terms: record({ terms: list(stringValue) }),
  correct_terms: record({ input_query: stringValue, min_sim: numberValue }),
  text_chunks: record({ query_text: stringValue, match_count: shadowEvaluationIntegerValue,
    document_filters: u04EvaluationDocumentFilters }),
  hybrid_chunks: record(u04EvaluationHybridArguments),
  vector_chunks: record({ query_embedding: u04EvaluationVectorArgument, match_count: shadowEvaluationIntegerValue,
    min_similarity: numberValue, document_filter: nullable(uuidValue) }),
  lookup_chunks: record({ query_text: stringValue, document_filters: u04EvaluationDocumentFilters,
    match_count: shadowEvaluationIntegerValue }),
  lookup_chunk_terms: record({ document_filters: u04EvaluationDocumentFilters, terms: list(stringValue),
    match_count: shadowEvaluationIntegerValue }),
  lookup_chunk_prefix: record({ document_filters: u04EvaluationDocumentFilters, match_count: shadowEvaluationIntegerValue }),
  lookup_documents: record({ query_text: stringValue, match_count: shadowEvaluationIntegerValue }),
  lookup_document_terms: record({ terms: list(stringValue) }),
  table_facts: record({ query_text: stringValue, match_count: shadowEvaluationIntegerValue,
    document_filters: u04EvaluationDocumentFilters }),
  embedding_fields: record(u04EvaluationHybridArguments),
  index_units: record(u04EvaluationHybridArguments),
  memory_cards_hybrid: record(u04EvaluationHybridArguments),
  memory_cards_lexical: record({ query_text: stringValue, document_filters: u04EvaluationDocumentFilters,
    match_count: shadowEvaluationIntegerValue }),
  chunks_by_ids: record({ ids: list(uuidValue) }),
  chunks_by_indexes: record({ document_ids: list(uuidValue), indexes: list(shadowEvaluationIntegerValue),
    match_count: shadowEvaluationIntegerValue }),
  documents: record({ ids: list(uuidValue) }),
  ranking_metadata: record({ document_ids: list(uuidValue) }),
  related_documents: record({ document_ids: list(uuidValue) }),
  quality: record({ document_ids: list(uuidValue) }),
  images_by_ids: record({ ids: list(uuidValue) }),
  images_by_pages: record({ document_ids: list(uuidValue), page_numbers: list(shadowEvaluationIntegerValue) }),
  visual_rows: record({ document_ids: list(uuidValue) }),
  adjacent_chunks: record({ document_ids: list(uuidValue), chunk_indexes: list(shadowEvaluationIntegerValue) }),
} as const satisfies Record<ShadowEvaluationOperationV1, Schema<unknown>>;

export type ShadowEvaluationArgumentsV1<K extends ShadowEvaluationOperationV1> =
  Immutable<ReturnType<(typeof u04EvaluationArgumentsSchemas)[K]>>;

/** Closed transport only; row-ID membership and SQL equality require the bound session. */
export function readShadowEvaluationArgumentsV1<K extends ShadowEvaluationOperationV1>(operation: K, value: unknown):
  ShadowEvaluationArgumentsV1<K> {
  if (typeof operation !== "string" || !Object.hasOwn(u04EvaluationArgumentsSchemas, operation)) invalidComparison();
  const parsed = (u04EvaluationArgumentsSchemas[operation] as Schema<unknown>)(value);
  if (operation === "chunks_by_indexes") {
    const count = (parsed as ReturnType<typeof u04EvaluationArgumentsSchemas.chunks_by_indexes>).match_count;
    if (count < 1 || count > 80) invalidComparison();
  }
  return freezeTree(parsed) as ShadowEvaluationArgumentsV1<K>;
}


export type ShadowEvaluationCallV1<K extends ShadowEvaluationOperationV1> = Readonly<{
  operation: K;
  case: Immutable<ReturnType<typeof u04EvaluationAuthorityCaseAddress>>;
  readOrdinal: number;
  documentIds: readonly string[];
  originalArguments: ShadowEvaluationArgumentsV1<K>;
}>;

/** Prepare one exact call; this function cannot issue a read or grant SQL authority. */
export function prepareShadowEvaluationCallV1<K extends ShadowEvaluationOperationV1>(
  requestEnvelope: unknown, authorityEnvelope: unknown, independentlyAdmitted: unknown, trustedNow: unknown,
  operation: K, caseAddressValue: unknown, readOrdinalValue: unknown, argumentsValue: unknown,
): ShadowEvaluationCallV1<K> {
  const request = readShadowEvaluationRequestV1(requestEnvelope, authorityEnvelope, independentlyAdmitted, trustedNow);
  return prepareShadowEvaluationCallFromRequestV1(request, operation, caseAddressValue, readOrdinalValue, argumentsValue);
}
function prepareShadowEvaluationCallFromRequestV1<K extends ShadowEvaluationOperationV1>(
  request: ReturnType<typeof readShadowEvaluationRequestV1>, operation: K, caseAddressValue: unknown,
  readOrdinalValue: unknown, argumentsValue: unknown,
): ShadowEvaluationCallV1<K> {
  const address = u04EvaluationAuthorityCaseAddress(caseAddressValue);
  const readOrdinal = nonnegativeInteger(readOrdinalValue);
  const scope = request.payload.caseScopes.scopes.find(entry => shadowSame(entry.case, address));
  if (!scope) invalidComparison();
  const originalArguments = readShadowEvaluationArgumentsV1(operation, argumentsValue);
  // A null filter is interpreted by fixed SQL only within this declared case.
  // Empty and duplicate explicit filters remain exact, never rewritten to W.
  const parsed = originalArguments as Readonly<{ document_filters?: readonly string[] | null;
    document_filter?: string | null; document_ids?: readonly string[]; ids?: readonly string[] }>;
  for (const documentId of [
    ...(parsed.document_filters ?? []), ...(parsed.document_ids ?? []),
    ...(parsed.document_filter === null || parsed.document_filter === undefined ? [] : [parsed.document_filter]),
    ...(operation === "documents" ? parsed.ids ?? [] : []),
  ]) {
    if (!scope.documentIds.includes(documentId)) invalidComparison();
  }
  // Chunk/image ID membership is resolved against full retained rows by the
  // session and again before selection in fixed SQL, never guessed from UUIDs.
  return Object.freeze({ operation, case: freezeTree(address), readOrdinal, documentIds: scope.documentIds, originalArguments });
}


const u04EvaluationCandidateReadEvidence = record({
  readback: shadowWaveReadbackPayload, context: shadowWaveReadbackContext,
  stateInput: shadowStateInput, stateAdmission: auditAdmission,
  candidateRows: list(record({ table: choice(...Object.keys(auditStoredColumns) as [AuditTable, ...AuditTable[]]),
    rowDigest: digestValue })),
});

function validateU04EvaluationCandidateReadEvidence(request: ReturnType<typeof readShadowEvaluationRequestV1>,
  value: unknown, observedOriginValue?: unknown, observedAt?: string) {
  const evidence = u04EvaluationCandidateReadEvidence(value);
  const phase = request.payload.phase;
  if (phase.side !== "candidate" || request.authority.context.phaseEvidence.side !== "candidate" ||
    evidence.readback.waveReceiptEnvelope.digest !== phase.waveReceiptDigest ||
    evidence.stateInput.phase !== "evaluate" || evidence.stateInput.binding.planDigest !== phase.planDigest ||
    evidence.stateInput.binding.candidateGenerationId !== phase.candidateGenerationId ||
    !shadowSame(evidence.stateInput.auditInput.originEnvelope, request.authority.originalOriginEnvelope)) invalidComparison();
  const original = auditOrigin(evidence.stateInput.auditInput.originEnvelope);
  const current = auditOrigin(observedOriginValue ?? evidence.readback.observedOriginEnvelope);
  const readback = { ...evidence.readback, observedOriginEnvelope: current.envelope };
  const context = { ...evidence.context, currentOriginEnvelope: current.envelope };
  const validated = readShadowWaveReadbackV1(readback, context);
  const wave = auditEnvelope(validated.waveReceipt, "wave_receipt", shadowWaveReceiptPayload, "pg-jsonb-text-v1");
  if (wave.payload.preparedOriginDigest !== request.payload.originalOriginDigest ||
    !shadowSame(request.authority.context.phaseEvidence.planEnvelope,
      auditStoredRow("shadow_reindex_waves", context.waveRowEnvelope).row.plan_payload)) invalidComparison();
  const at = observedAt ?? current.payload.capturedAt;
  const stateInput = { ...evidence.stateInput, currentOriginEnvelope: current.envelope,
    clock: { transactionStartedAt: at, observedAt: at } };
  const comparison = compareShadowStatePreparedV1(stateInput, evidence.stateAdmission, evidence.candidateRows,
    { kind: "sealed", readback, context }, validated);
  if (!comparison.ok || comparison.kind !== "sanctioned_u04_state" ||
    comparison.u04BaselineDigest !== original.envelope.digest) invalidComparison();
  return { evidence, validated, readback, context };
}

/** Creates only a fixed, fully bound transport. It cannot construct a client or dispatch SQL. */
export function prepareShadowEvaluationSqlContextV1<K extends ShadowEvaluationOperationV1>(
  requestEnvelope: unknown, authorityEnvelope: unknown, independentlyAdmitted: unknown, trustedNow: unknown,
  operation: K, caseAddress: unknown, readOrdinal: unknown, args: unknown, candidateEvidence: unknown = null,
) {
  const request = readShadowEvaluationRequestV1(requestEnvelope, authorityEnvelope, independentlyAdmitted, trustedNow);
  const call = prepareShadowEvaluationCallFromRequestV1(request, operation, caseAddress, readOrdinal, args);
  let evidence: { side: "baseline"; planEnvelope: null; waveReadback: null } |
    { side: "candidate"; planEnvelope: ShadowRawEnvelope; waveReadback: ReturnType<typeof shadowWaveReadbackPayload> };
  if (request.payload.phase.side === "baseline") {
    if (candidateEvidence !== null) invalidComparison();
    evidence = { side: "baseline", planEnvelope: null, waveReadback: null };
  } else {
    const prepared = validateU04EvaluationCandidateReadEvidence(request, candidateEvidence);
    const phaseEvidence = request.authority.context.phaseEvidence;
    if (phaseEvidence.side !== "candidate") invalidComparison();
    evidence = { side: "candidate", planEnvelope: phaseEvidence.planEnvelope, waveReadback: prepared.readback };
  }
  return freezeTree({ version: 1 as const, kind: "u04-evaluation-sql-context-v1" as const,
    requestEnvelope: request.envelope, authorityEnvelope: request.authority.envelope,
    originalOriginEnvelope: request.authority.originalOriginEnvelope, recoveryEnvelope: request.authority.recoveryEnvelope,
    evidence, call });
}

const u04EvaluationObservation = record({ observedAt: auditSqlTimestamp,
  guard: record({ mode: choice("same_statement_logical_equality"), observedOriginEnvelope: auditAnyEnvelope,
    controls: list(record({ documentId: uuidValue, controlEnvelope: auditAnyEnvelope })) }),
  environment: record({ reviewedEnvironmentDigest: digestValue, operation: (value: unknown) => {
    const parsed = sqlFactFields.operations([value]);
    return parsed[0]!;
  } }),
});

/** Same-statement view proof only. Returned row/source semantics require their separate fixed validator. */
export function readShadowEvaluationObservationV1(
  value: unknown, requestEnvelope: unknown, authorityEnvelope: unknown, independentlyAdmitted: unknown,
  operation: ShadowEvaluationOperationV1, startedAtValue: unknown, finishedAtValue: unknown,
  candidateEvidence: unknown = null,
) {
  const observation = u04EvaluationObservation(value);
  const startedAt = auditSqlTimestamp(startedAtValue), finishedAt = auditSqlTimestamp(finishedAtValue);
  const request = readShadowEvaluationRequestV1(requestEnvelope, authorityEnvelope, independentlyAdmitted, finishedAt);
  const profile = parseShadowExecutionProfileEnvelope(request.authority.executionProfileEnvelope);
  if (shadowMicros(startedAt) > shadowMicros(observation.observedAt) ||
    shadowMicros(observation.observedAt) > shadowMicros(finishedAt) ||
    shadowMicros(startedAt) < shadowMicros(request.authority.payload.manifest.authorizedAt) ||
    shadowMicros(finishedAt) - shadowMicros(startedAt) > BigInt(profile.payload.limits.clientTotalDeadlineMs) * 1000n ||
    observation.environment.reviewedEnvironmentDigest !== profile.sql.bytes.envelope.digest ||
    observation.environment.operation.operation !== operation) invalidComparison();
  const expectedOperation = profile.sql.capture.payload.operations.find(entry => entry.operation === operation);
  if (!expectedOperation) invalidComparison();
  auditEqual(observation.environment.operation, expectedOperation);
  const original = auditOrigin(request.authority.originalOriginEnvelope);
  const current = auditOrigin(observation.guard.observedOriginEnvelope);
  if (shadowMicros(current.payload.capturedAt) !== shadowMicros(observation.observedAt) ||
    Buffer.byteLength(current.envelope.canonicalPayload, "utf8") > profile.payload.limits.maxOriginBundleBytes) invalidComparison();
  auditWavePopulation(current, profile);
  for (const source of request.payload.sourceBindings)
    auditSourceAuthority(current, { ...source, manualAliasIds: [...source.manualAliasIds], originDigest: current.envelope.digest }, profile);
  let candidateValidation: ReturnType<typeof validateU04EvaluationCandidateReadEvidence> | null = null;
  if (request.payload.phase.side === "baseline") {
    if (candidateEvidence !== null || observation.guard.controls.length !== 0) invalidComparison();
    const { capturedAt: _beforeAt, ...before } = original.payload;
    const { capturedAt: _afterAt, ...after } = current.payload;
    auditEqual(before, after);
  } else {
    const candidate = validateU04EvaluationCandidateReadEvidence(request, candidateEvidence, current.envelope, observation.observedAt);
    candidateValidation = candidate;
    const expectedControls = candidate.validated.members.map(member => ({
      documentId: member.payload.binding.source.documentId, controlEnvelope: member.terminalControl.envelope,
    }));
    auditEqual(observation.guard.controls, expectedControls);
  }
  return freezeTree({ kind: "shadow-evaluation-observation-validated" as const,
    observation, requestDigest: request.envelope.digest, operation,
    sourceState: { originalOrigin: original.envelope, observedOrigin: current.envelope,
      candidate: candidateValidation?.validated ?? null } });
}


const u04EvaluationView = (value: unknown) => discriminant(value, "tag") === "baseline"
  ? record({ tag: choice("baseline"), source: auditSource })(value) : shadowCandidateView(value);
const u04EvaluationResultSource = record({ part: choice("rows", "ownerRows", "publicRows", "value"),
  index: nullable(nonnegativeInteger), view: nullable(u04EvaluationView),
  refs: list(inventoryArtifact), relationships: list(auditRelationship) });
const u04EvaluationFixedCall = record({ operation: choice(...sqlOperationTags), case: u04EvaluationAuthorityCaseAddress,
  readOrdinal: nonnegativeInteger, documentIds: list(uuidValue), originalArguments: auditObject });

/** Exact result transport and occurrence binding; source resolution is a separate required semantic step. */
export function parseShadowEvaluationResultEnvelopeV1<K extends ShadowEvaluationOperationV1>(
  envelopeValue: unknown, requestEnvelopeValue: unknown, authorityEnvelopeValue: unknown, independentlyAdmitted: unknown,
  trustedNow: unknown, expectedCallValue: ShadowEvaluationCallV1<K>,
) {
  const request = readShadowEvaluationRequestV1(requestEnvelopeValue, authorityEnvelopeValue, independentlyAdmitted, trustedNow);
  const expected = u04EvaluationFixedCall(expectedCallValue);
  const call = prepareShadowEvaluationCallFromRequestV1(request, expected.operation, expected.case,
    expected.readOrdinal, expected.originalArguments);
  auditEqual(expected, call);
  const schema = record({ kind: choice("u04-evaluation-read-result-v1"), version: fixedNumber(1),
    operation: choice(...sqlOperationTags), requestDigest: digestValue, call: u04EvaluationFixedCall,
    observedAt: auditSqlTimestamp, guard: record({ mode: choice("same_statement_logical_equality"),
      observedOriginEnvelope: auditAnyEnvelope, controls: list(record({ documentId: uuidValue, controlEnvelope: auditAnyEnvelope })) }),
    environment: record({ reviewedEnvironmentDigest: digestValue,
      operation: (value: unknown) => sqlFactFields.operations([value])[0]! }),
    result: (value: unknown) => readShadowEvaluationRowsV1(expected.operation, value),
    sources: list(u04EvaluationResultSource) });
  const parsed = auditEnvelope(envelopeValue, "evaluation_report", schema, "pg-jsonb-text-v1");
  if (parsed.payload.operation !== expected.operation || parsed.payload.requestDigest !== request.envelope.digest) invalidComparison();
  auditEqual(parsed.payload.call, call);
  const sourcePositions: { part: "rows" | "ownerRows" | "publicRows" | "value"; index: number | null }[] = [];
  const result = parsed.payload.result;
  if (expected.operation === "correct_terms") sourcePositions.push({ part: "value", index: null });
  else if (expected.operation === "aliases") {
    const aliases = result as ReturnType<typeof shadowEvaluationRowSchemasV1.aliases>;
    for (const part of ["ownerRows", "publicRows"] as const)
      aliases[part].forEach((_row, index) => sourcePositions.push({ part, index }));
  } else {
    if (!Array.isArray(result)) invalidComparison();
    result.forEach((_row, index) => sourcePositions.push({ part: "rows", index }));
  }
  auditEqual(parsed.payload.sources.map(({ part, index }) => ({ part, index })), sourcePositions);
  const aggregate = expected.operation === "correct_terms" || expected.operation === "corpus_terms";
  for (const source of parsed.payload.sources) {
    if (aggregate !== (source.view === null)) invalidComparison();
    // Aggregate inputs can be empty even for a nonempty case (for example no
    // public indexed document). The semantic validator proves that population.
    if (source.refs.length === 0 && !aggregate) invalidComparison();
    if (source.view !== null) {
      if (source.view.tag !== request.payload.phase.side || !call.documentIds.includes(source.view.source.documentId) ||
        !request.payload.sourceBindings.some(value => shadowSame(value, source.view!.source))) invalidComparison();
      if (source.view.tag === "candidate" && (request.payload.phase.side !== "candidate" ||
        source.view.candidateGenerationId !== request.payload.phase.candidateGenerationId)) invalidComparison();
      if (source.refs.some(ref => source.view!.tag === "baseline" &&
        (ref.tag === "candidate_row" || ref.tag === "candidate_projection"))) invalidComparison();
    }
  }
  return freezeTree({ kind: "shadow-evaluation-result-transport-validated" as const,
    envelope: parsed.envelope, payload: parsed.payload, call, request });
}

type U04EvaluationEvidenceEntry = {
  table: AuditTable | null;
  row: AuditJson;
  envelope: ShadowRawEnvelope | null;
  ref: ReturnType<typeof inventoryArtifact>;
  relationships: ReturnType<typeof auditRelationship>[];
  unit: ReturnType<typeof inventoryUnit> | null;
  view: ReturnType<typeof shadowCandidateView> | null;
};
const u04EvaluationPrimaryTable: Partial<Record<ShadowEvaluationOperationV1, AuditTable>> = {
  text_chunks: "document_chunks", hybrid_chunks: "document_chunks", vector_chunks: "document_chunks",
  lookup_chunks: "document_chunks", lookup_chunk_terms: "document_chunks", lookup_chunk_prefix: "document_chunks",
  chunks_by_ids: "document_chunks", chunks_by_indexes: "document_chunks", adjacent_chunks: "document_chunks",
  lookup_documents: "documents", lookup_document_terms: "documents", documents: "documents",
  table_facts: "document_table_facts", embedding_fields: "document_embedding_fields", index_units: "document_index_units",
  memory_cards_hybrid: "document_memory_cards", memory_cards_lexical: "document_memory_cards",
  images_by_ids: "document_images", images_by_pages: "document_images", visual_rows: "document_images",
  quality: "document_index_quality", related_documents: "documents", ranking_metadata: "documents", aliases: "rag_aliases",
};
function u04EvaluationEvidenceKey(ref: ReturnType<typeof inventoryArtifact>) {
  return encodeShadowNodeJsonCanonicalPayload(ref);
}

/** A per-observation pool; never cached across SQL calls or accepted from a caller. */
function u04EvaluationEvidencePool(observation: ReturnType<typeof readShadowEvaluationObservationV1>,
  sourceValue: unknown, original: ReturnType<typeof auditOrigin>) {
  const source = auditSource(sourceValue);
  const entries: U04EvaluationEvidenceEntry[] = [];
  const addRow = (entry: AuditRow, tag: "origin_row" | "candidate_row",
    relationships: ReturnType<typeof auditRelationship>[] = []) => {
    const owner = Object.entries(auditOwnerTable).find(([, table]) => table === entry.table)?.[0];
    if (!owner) invalidComparison();
    const ref = inventoryArtifact({ tag, owner,
      rowId: entry.row[entry.table === "document_index_quality" ? "document_id" : "id"], rowDigest: entry.envelope.digest });
    const result: U04EvaluationEvidenceEntry = { table: entry.table, row: entry.row, envelope: entry.envelope, ref, relationships, view: null,
      unit: auditTableFamily[entry.table] ? auditRowUnit(entry) : null };
    entries.push(result); return result;
  };
  const baselineDocument = original.rows.documents.find(entry => entry.row.id === source.documentId);
  if (!baselineDocument) invalidComparison();
  addRow(baselineDocument, "origin_row");
  let document = baselineDocument.row;
  const manualLabels = original.rows.document_labels.filter(entry => entry.row.document_id === source.documentId && entry.row.source !== "generated");
  for (const entry of manualLabels) addRow(entry, "origin_row");
  for (const entry of original.rows.rag_aliases.filter(entry => source.manualAliasIds.includes(String(entry.row.id))))
    addRow(entry, "origin_row");
  const member = observation.sourceState.candidate?.members.find(value => value.payload.binding.source.documentId === source.documentId);
  if (observation.sourceState.candidate !== null) {
    if (!member || !shadowSame(member.payload.binding.source, source)) invalidComparison();
    const final = member.finalInventory;
    const declarations = list(shadowExpectedDeclaration)(auditObject(decodeStrictJson(final.expectedInventory.canonicalPayload, false)).declarations);
    const declaredView = (disposition: { family: InventoryFamily; unitKey: string }) => {
      const matches = declarations.filter(entry => entry.family === disposition.family && entry.unitKey === disposition.unitKey);
      if (matches.length !== 1) invalidComparison();
      return matches[0]!.sourceBinding;
    };
    for (const entry of final.payload.candidateRows) {
      const row = auditStoredRow(entry.table, entry.rowEnvelope);
      const dispositions = final.payload.finalDispositions.filter(item => item.disposition === "retained" &&
        item.artifactRef?.tag === "candidate_row" && item.artifactRef.rowDigest === row.envelope.digest);
      if (dispositions.length !== 1) invalidComparison();
      const added = addRow(row, "candidate_row", list(auditRelationship)(dispositions[0]!.relationships));
      added.unit = { family: dispositions[0]!.family, key: dispositions[0]!.unitKey };
      added.view = declaredView(dispositions[0]!);
    }
    const slots = ["summary", "generated_labels", "quality", "worker_metadata", "document_counts", "enrichment_metadata",
      "deep_memory_metadata", "deep_memory_receipt", "producer_aliases"] as const;
    for (const slot of slots) {
      const value = final.projection.row[slot];
      if (value === null || value === undefined) continue;
      const items = slot === "generated_labels" || slot === "producer_aliases" ? list(auditObject)(value) : [auditJson(value)];
      for (const item of items) {
        const ref = inventoryArtifact({ tag: "candidate_projection", slot,
          itemId: slot === "generated_labels" || slot === "producer_aliases" ? auditObject(item).id : null,
          payloadDigest: shadowProjectionComponentEnvelope(item).digest });
        const dispositions = final.payload.finalDispositions.filter(entry => entry.disposition === "retained" && shadowSame(entry.artifactRef, ref));
        if (["summary", "generated_labels", "quality", "worker_metadata", "producer_aliases"].includes(slot) && dispositions.length !== 1)
          invalidComparison();
        entries.push({ ref, row: item, envelope: shadowProjectionComponentEnvelope(item), table: slot === "summary" ? "document_summaries" : slot === "generated_labels" ? "document_labels"
          : slot === "quality" ? "document_index_quality" : slot === "producer_aliases" ? "rag_aliases" : null,
          relationships: list(auditRelationship)(dispositions.flatMap(entry => [...entry.relationships])),
          unit: dispositions.length === 1 ? { family: dispositions[0]!.family, key: dispositions[0]!.unitKey } : null,
          view: dispositions.length === 1 ? declaredView(dispositions[0]!) : shadowCandidateView(member.payload.binding) });
      }
    }
    const worker = auditObject(final.projection.row.worker_metadata), counts = auditObject(final.projection.row.document_counts);
    document = { ...document, metadata: { ...auditObject(document.metadata), ...worker },
      status: counts.status!, page_count: counts.page_count!, chunk_count: counts.chunk_count!, image_count: counts.image_count!,
      error_message: counts.error_message!, index_generation_id: member.payload.binding.candidateGenerationId, updated_at: worker.indexed_at! };
    for (const disposition of final.payload.finalDispositions) {
      const ref = disposition.artifactRef;
      if (disposition.disposition !== "retained" || !ref || (ref.tag !== "private_object" && ref.tag !== "retained_payload")) continue;
      const retained = final.payload.retainedEvidence.filter(entry => ref.tag === "private_object"
        ? entry.tag === "private_object" && shadowSame(entry.ref, ref)
        : entry.tag === "payload" && entry.envelope.digest === ref.envelopeDigest);
      if (retained.length !== 1) invalidComparison();
      // Full payload/object bytes are already validated and retained by the
      // observation's inventory. Do not copy those potentially large bytes into
      // the small lookup pool for each fixed read.
      entries.push({ table: null, row: null, envelope: null, ref: inventoryArtifact(ref),
        relationships: list(auditRelationship)(disposition.relationships), unit: { family: disposition.family, key: disposition.unitKey },
        view: declaredView(disposition) });
    }
  } else {
    const selected = auditSelected(original, source);
    for (const table of Object.values(auditOwnerTable)) {
      if (table === "documents" || !auditTableFamily[table]) continue;
      const rows = table === "document_index_quality" ? original.rows[table].filter(entry => entry.row.document_id === source.documentId)
        : table === "document_labels" ? selected[table].filter(entry => entry.row.source === "generated") : selected[table];
      for (const entry of rows) addRow(entry, "origin_row");
    }
    const selectedRows = Object.fromEntries((Object.keys(auditStoredColumns) as AuditTable[]).map(table => [table,
      entries.filter(entry => entry.table === table && entry.ref.tag === "origin_row").map(entry => ({
        table, row: auditObject(entry.row), envelope: original.rows[table].find(row => row.envelope.digest ===
          (entry.ref as Extract<ReturnType<typeof inventoryArtifact>, { tag: "origin_row" }>).rowDigest)!.envelope,
      }))])) as Record<AuditTable, AuditRow[]>;
    // SQL row reads retain storage paths and native rows. Private object byte
    // acceptance is separate; do not manufacture object evidence from a path.
    const edges = auditEdges(baselineDocument, selectedRows, null, true);
    for (const entry of entries) if (entry.ref.tag === "origin_row") {
      const digest = entry.ref.rowDigest;
      entry.relationships = edges.filter(edge => edge.row.envelope.digest === digest).map(edge => edge.relationship);
    }
  }
  return { source, document, entries, member: member ?? null };
}

function u04EvaluationCandidateSelectedRows(pool: ReturnType<typeof u04EvaluationEvidencePool>) {
  return Object.fromEntries((Object.keys(auditStoredColumns) as AuditTable[]).map(table => [table,
    pool.entries.filter(entry => entry.table === table && entry.ref.tag === "candidate_row").map(entry => {
      if (entry.envelope === null) invalidComparison();
      const row = auditStoredRow(table, entry.envelope);
      auditEqual(row.row, entry.row);
      return row;
    }),
  ])) as Record<AuditTable, AuditRow[]>;
}

function u04EvaluationCandidateEntryV1(entry: U04EvaluationEvidenceEntry,
  pool: ReturnType<typeof u04EvaluationEvidencePool>, deep = false) {
  const expectedDeepGeneration = pool.member === null ? null :
    auditObject(pool.member.finalInventory.projection.row).deep_memory_artifact_generation_id;
  if (pool.member === null || entry.view === null ||
    entry.view.candidateGenerationId !== pool.member.payload.binding.candidateGenerationId ||
    !shadowSame(entry.view.source, pool.source) ||
    (deep && (entry.view.artifactGenerationId === null ||
      entry.view.artifactGenerationId !== expectedDeepGeneration))) invalidComparison();
  return auditObject(entry.row);
}

function u04EvaluationCandidateReturnedRowV1(returnedValue: unknown, storedValue: unknown,
  transformed: Readonly<Record<string, AuditJson>> = {}) {
  const returned = auditObject(returnedValue), stored = auditObject(storedValue);
  for (const [key, value] of Object.entries(returned)) {
    if (Object.hasOwn(transformed, key)) auditEqual(value, transformed[key]);
    else if (Object.hasOwn(stored, key)) auditEqual(value, stored[key]);
  }
}

function u04EvaluationCandidateRelationshipV1(entry: U04EvaluationEvidenceEntry,
  tag: "source_chunk" | "source_image" | "page", family: InventoryFamily, key: string) {
  if (!entry.relationships.some(relationship => relationship.tag === tag &&
    relationship.target.family === family && relationship.target.key === key)) invalidComparison();
}

function u04EvaluationCandidateReportResultV1(result: ReturnType<typeof auditSearchResult>,
  pool: ReturnType<typeof u04EvaluationEvidencePool>) {
  if (pool.member === null) invalidComparison();
  const candidates = pool.entries.filter(entry => entry.ref.tag === "candidate_row" && entry.table !== null &&
    ["document_chunks", "document_index_units", "document_memory_cards", "document_embedding_fields"]
      .includes(entry.table) && auditObject(entry.row).id === result.id);
  if (candidates.length !== 1) invalidComparison();
  const candidate = candidates[0]!;
  const row = u04EvaluationCandidateEntryV1(candidate, pool), returned = auditObject(result);
  for (const key of ["id", "document_id", "page_number", "chunk_index", "section_heading", "section_path",
    "heading_level", "parent_heading", "anchor_id", "content", "retrieval_synopsis", "image_ids"])
    if (Object.hasOwn(returned, key) && Object.hasOwn(row, key)) auditEqual(returned[key], row[key]);
  auditEqual(result.title, pool.document.title);
  auditEqual(result.file_name, pool.document.file_name);
  if (Object.hasOwn(result, "source_metadata"))
    auditEqual(result.source_metadata, normalizeOptionalSourceMetadata(pool.document.metadata));

  if (Object.hasOwn(result, "document_labels")) {
    const seen = new Set<string>();
    for (const label of result.document_labels ?? []) {
      const matches = pool.entries.filter(entry => entry.table === "document_labels" &&
        auditObject(entry.row).id === label.id);
      if (matches.length !== 1 || seen.has(label.id)) invalidComparison();
      seen.add(label.id);
      const entry = matches[0]!;
      if (entry.ref.tag === "candidate_projection") u04EvaluationCandidateEntryV1(entry, pool);
      else if (entry.ref.tag !== "origin_row" || auditObject(entry.row).source !== "manual") invalidComparison();
      u04EvaluationCandidateReturnedRowV1(label, entry.row);
    }
  }
  if (Object.hasOwn(result, "document_summary") && result.document_summary !== null) {
    const summaries = pool.entries.filter(entry => entry.table === "document_summaries" &&
      auditObject(entry.row).summary === result.document_summary);
    if (summaries.length !== 1 || summaries[0]!.ref.tag !== "candidate_projection") invalidComparison();
    u04EvaluationCandidateEntryV1(summaries[0]!, pool);
  }
  if (Object.hasOwn(result, "indexing_quality") && result.indexing_quality !== null) {
    const qualities = pool.entries.filter(entry => entry.table === "document_index_quality" &&
      auditObject(entry.row).document_id === result.document_id);
    if (qualities.length !== 1 || qualities[0]!.ref.tag !== "candidate_projection") invalidComparison();
    const quality = u04EvaluationCandidateEntryV1(qualities[0]!, pool);
    u04EvaluationCandidateReturnedRowV1(result.indexing_quality, quality, {
      metrics: auditJson(safeRecord(quality.metrics)), issues: auditJson([...list(stringValue)(quality.issues)]),
    });
  }
  if (Object.hasOwn(result, "memory_cards")) {
    const seen = new Set<string>();
    for (const card of result.memory_cards ?? []) {
      if (card.id === undefined) invalidComparison();
      const matches = pool.entries.filter(entry => entry.table === "document_memory_cards" &&
        auditObject(entry.row).id === card.id);
      if (matches.length !== 1 || seen.has(String(card.id))) invalidComparison();
      seen.add(String(card.id));
      const entry = matches[0]!, stored = u04EvaluationCandidateEntryV1(entry, pool, true);
      if (!list(uuidValue)(stored.source_chunk_ids).includes(result.id)) invalidComparison();
      u04EvaluationCandidateRelationshipV1(entry, "source_chunk", "chunks", result.id);
      u04EvaluationCandidateReturnedRowV1(card, stored);
    }
  }
  if (Object.hasOwn(result, "table_facts")) {
    const seen = new Set<string>();
    for (const fact of result.table_facts ?? []) {
      const matches = pool.entries.filter(entry => entry.table === "document_table_facts" &&
        auditObject(entry.row).id === fact.id);
      if (matches.length !== 1 || seen.has(fact.id)) invalidComparison();
      seen.add(fact.id);
      const entry = matches[0]!, stored = u04EvaluationCandidateEntryV1(entry, pool);
      if (stored.source_chunk_id !== null) {
        if (stored.source_chunk_id !== result.id) invalidComparison();
        u04EvaluationCandidateRelationshipV1(entry, "source_chunk", "chunks", result.id);
      }
      u04EvaluationCandidateReturnedRowV1(fact, stored,
        Object.hasOwn(fact, "metadata") ? { metadata: {} } : {});
    }
  }
  if (result.index_unit !== undefined && result.index_unit !== null) {
    const units = pool.entries.filter(entry => entry.table === "document_index_units" &&
      entry.ref.tag === "candidate_row" && auditObject(entry.row).id === result.index_unit!.id);
    if (units.length !== 1) invalidComparison();
    const storedUnit = u04EvaluationCandidateEntryV1(units[0]!, pool, true);
    if (storedUnit.source_chunk_id !== null) {
      if (storedUnit.source_chunk_id !== result.id) invalidComparison();
      u04EvaluationCandidateRelationshipV1(units[0]!, "source_chunk", "chunks", result.id);
    }
    u04EvaluationCandidateReturnedRowV1(result.index_unit, storedUnit);
  }
  const seenImages = new Set<string>();
  for (const image of result.images) {
    const images = pool.entries.filter(entry => entry.table === "document_images" &&
      entry.ref.tag === "candidate_row" && auditObject(entry.row).id === image.id);
    if (images.length !== 1 || seenImages.has(image.id)) invalidComparison();
    seenImages.add(image.id);
    const entry = images[0]!, stored = u04EvaluationCandidateEntryV1(entry, pool);
    let associated = false;
    if (stored.page_number !== null && stored.page_number === result.page_number) {
      u04EvaluationCandidateRelationshipV1(entry, "page", "pages", String(stored.page_number));
      associated = true;
    }
    if (result.image_ids.includes(image.id)) {
      u04EvaluationCandidateRelationshipV1(candidate, "source_image", "images", image.id);
      associated = true;
    }
    if (result.index_unit?.source_image_id === image.id) {
      const parent = pool.entries.filter(value => value.table === "document_index_units" &&
        value.ref.tag === "candidate_row" && auditObject(value.row).id === result.index_unit!.id);
      if (parent.length !== 1) invalidComparison();
      u04EvaluationCandidateRelationshipV1(parent[0]!, "source_image", "images", image.id);
      associated = true;
    }
    for (const fact of result.table_facts ?? []) if (fact.source_image_id === image.id) {
      const parent = pool.entries.filter(value => value.table === "document_table_facts" &&
        value.ref.tag === "candidate_row" && auditObject(value.row).id === fact.id);
      if (parent.length !== 1) invalidComparison();
      u04EvaluationCandidateRelationshipV1(parent[0]!, "source_image", "images", image.id);
      associated = true;
    }
    if (!associated) invalidComparison();
    const metadata = safeRecord(stored.metadata), rawTableText = metadataText(metadata, "table_text");
    const tableText = metadataText(metadata, "table_text_snippet") ?? rawTableText;
    u04EvaluationCandidateReturnedRowV1(image, stored, {
      bbox: auditJson(normalizeImageBbox(stored.bbox)), sourceKind: auditJson(stored.source_kind),
      tableLabel: auditJson(metadataText(metadata, "table_label")), tableTitle: auditJson(metadataText(metadata, "table_title")),
      tableRole: auditJson(metadataText(metadata, "table_role")),
      clinicalUseClass: auditJson(typeof metadata.clinical_use_class === "string" ? metadata.clinical_use_class : null),
      clinicalUseReason: auditJson(typeof metadata.clinical_use_reason === "string" ? metadata.clinical_use_reason : null),
      accessibleTableMarkdown: auditJson(typeof metadata.accessible_table_markdown === "string" ?
        metadata.accessible_table_markdown : rawTableText),
      tableRows: auditJson(Array.isArray(metadata.table_rows) ? metadata.table_rows : null),
      tableColumns: auditJson(Array.isArray(metadata.table_columns) ? metadata.table_columns : null),
      tableTextSnippet: auditJson(tableText ? compactContextText(tableText, 500) : null),
      labels: auditJson(Array.isArray(stored.labels) ? [...stored.labels] : []), metadata: auditJson(metadata),
    });
  }
  if (Object.hasOwn(result, "adjacent_context") && result.adjacent_context !== null) {
    const adjacent: string[] = [];
    for (const chunkIndex of [result.chunk_index - 1, result.chunk_index + 1]) {
      const chunks = pool.entries.filter(entry => entry.table === "document_chunks" && entry.ref.tag === "candidate_row" &&
        auditObject(entry.row).document_id === result.document_id && auditObject(entry.row).chunk_index === chunkIndex);
      if (chunks.length > 1) invalidComparison();
      if (chunks.length === 0) continue;
      const chunk = u04EvaluationCandidateEntryV1(chunks[0]!, pool);
      if (chunk.id === result.id || !String(chunk.content).trim()) continue;
      const heading = chunk.section_heading ? `${chunk.section_heading}: ` : "";
      adjacent.push(compactContextText(`${heading}${chunk.retrieval_synopsis || chunk.content}`, 520));
    }
    if (adjacent.length === 0 || result.adjacent_context !== adjacent.join(" ")) invalidComparison();
  }
}

/**
 * Validates a complete candidate report against its exact admitted C/D receipts
 * and a fresh same-statement current guard. It grants no execution authority.
 */
export function readShadowCandidateCaseReportV1(
  reportEnvelopeValue: unknown, requestEnvelopeValue: unknown, authorityEnvelopeValue: unknown,
  independentlyAdmitted: unknown, observationValue: unknown, operation: ShadowEvaluationOperationV1,
  startedAtValue: unknown, finishedAtValue: unknown, candidateEvidence: unknown,
) {
  const startedAt = auditSqlTimestamp(startedAtValue), finishedAt = auditSqlTimestamp(finishedAtValue);
  const request = prepareShadowEvaluationRuntimeAdmissionV1(requestEnvelopeValue, authorityEnvelopeValue,
    independentlyAdmitted, finishedAt, candidateEvidence);
  if (request.payload.phase.side !== "candidate" || request.authority.context.phaseEvidence.side !== "candidate")
    invalidComparison();
  const observation = readShadowEvaluationObservationV1(observationValue, requestEnvelopeValue, authorityEnvelopeValue,
    independentlyAdmitted, operation, startedAt, finishedAt, candidateEvidence);
  if (observation.sourceState.candidate === null) invalidComparison();
  const profile = parseShadowExecutionProfileEnvelope(request.authority.executionProfileEnvelope);
  const original = auditOrigin(request.authority.originalOriginEnvelope);
  const candidateCaseReport = auditEnvelope(reportEnvelopeValue, "evaluation_report", auditCaseReport);
  const generatedAt = auditSqlTimestamp(candidateCaseReport.payload.report.generated_at);
  if (shadowMicros(generatedAt) > shadowMicros(finishedAt)) invalidComparison();
  const phaseEvidence = request.authority.context.phaseEvidence;
  const plan = auditEnvelope(phaseEvidence.planEnvelope, "plan", persistencePlan);
  const baselineCaseReport = auditEnvelope(plan.payload.audit.input.caseResultsEnvelope,
    "evaluation_report", auditCaseReport);
  const pools = request.payload.sourceBindings.map(source => u04EvaluationEvidencePool(observation, source, original));
  for (const execution of candidateCaseReport.payload.executions)
    for (const result of execution.searchResults) {
      const pool = pools.find(entry => entry.source.documentId === result.document_id);
      if (!pool) invalidComparison();
      u04EvaluationCandidateReportResultV1(result, pool);
    }
  const ordered = auditValidateReport(candidateCaseReport.payload, profile, original,
    list(auditSource)(request.payload.sourceBindings), new Map(pools.map(pool => [pool.source.documentId,
      u04EvaluationCandidateSelectedRows(pool)])),
    { requestEnvelope: request.envelope, authorityEnvelope: request.authority.envelope,
      baselineCaseReport: baselineCaseReport.payload });
  for (const [ordinal, documentIds] of ordered) {
    const scope = request.payload.caseScopes.scopes[ordinal];
    if (!scope || documentIds.some(documentId => !scope.documentIds.includes(documentId))) invalidComparison();
  }
  const waveReceipt = auditEnvelope(observation.sourceState.candidate.waveReceipt,
    "wave_receipt", shadowWaveReceiptPayload, "pg-jsonb-text-v1");
  return freezeTree({ kind: "shadow-candidate-case-report-validated" as const,
    candidateCaseReport: { envelope: candidateCaseReport.envelope, payload: candidateCaseReport.payload },
    baselineCaseReport: { envelope: baselineCaseReport.envelope, payload: baselineCaseReport.payload },
    executionProfile: { envelope: profile.bytes.envelope, payload: profile.payload },
    configuration: { envelope: profile.configuration.bytes.envelope, payload: profile.configuration.payload },
    plan: { envelope: plan.envelope, payload: plan.payload },
    waveIdentity: observation.sourceState.candidate.wave,
    waveReceipt: { envelope: waveReceipt.envelope, payload: waveReceipt.payload },
    request, observation });
}

/** Full bytes, same-statement source state, selected generation and output-field binding. */
export function readShadowEvaluationResultV1<K extends ShadowEvaluationOperationV1>(
  envelopeValue: unknown, requestEnvelope: unknown, authorityEnvelope: unknown, independentlyAdmitted: unknown,
  startedAt: unknown, finishedAt: unknown, expectedCall: ShadowEvaluationCallV1<K>, candidateEvidence: unknown = null,
) {
  const transport = parseShadowEvaluationResultEnvelopeV1(envelopeValue, requestEnvelope, authorityEnvelope,
    independentlyAdmitted, finishedAt, expectedCall);
  const payload = transport.payload, operation = transport.call.operation;
  const observation = readShadowEvaluationObservationV1({ observedAt: payload.observedAt, guard: payload.guard,
    environment: payload.environment }, requestEnvelope, authorityEnvelope, independentlyAdmitted, operation, startedAt, finishedAt, candidateEvidence);
  const original = auditOrigin(observation.sourceState.originalOrigin);
  const pools = transport.request.payload.sourceBindings.filter(source => transport.call.documentIds.includes(source.documentId))
    .map(source => u04EvaluationEvidencePool(observation, source, original));
  const rowFor = (source: typeof payload.sources[number]): AuditJson => source.part === "value" ? auditJson(payload.result)
    : source.part === "rows" ? auditJson((payload.result as readonly unknown[])[source.index!])
    : auditJson((payload.result as unknown as Record<string, readonly unknown[]>)[source.part]![source.index!]);
  const sameSet = (actual: readonly unknown[], expected: readonly unknown[]) => {
    const key = (item: unknown) => encodeShadowNodeJsonCanonicalPayload(item);
    auditEqual(actual.map(key).sort(compareText), expected.map(key).sort(compareText));
  };
  const args = auditObject(transport.call.originalArguments);
  if (operation === "corpus_terms") {
    const terms = [...new Set(list(stringValue)(args.terms).slice(0, 8)
      .map(term => term.replace(/^ +| +$/g, "").toLowerCase()).filter(term => term !== ""))];
    // Bind the complete statistic population without substituting JavaScript's
    // sort for the reviewed native collation. Original row order stays retained.
    sameSet((payload.result as readonly unknown[]).map(row => auditObject(row).term), terms);
  }
  for (const source of payload.sources) {
    const pool = source.view === null ? null : pools.find(entry => entry.source.documentId === source.view!.source.documentId) ?? invalidComparison();
    if (source.view !== null) {
      if (!pool) invalidComparison();
      if (pool.member === null) auditEqual(source.view, { tag: "baseline", source: pool.source });
    }
    const available = pool ? pool.entries : pools.flatMap(entry => entry.entries);
    const refs = source.refs.map(ref => {
      const matches = available.filter(entry => shadowSame(entry.ref, ref));
      // Shared manual aliases may belong to more than one scoped source. They
      // remain the same native row, never an inferred global alias population.
      if (matches.length === 0 || matches.some(entry => !shadowSame(entry.row, matches[0]!.row))) invalidComparison();
      return matches[0]!;
    });
    const roots = new Map<string, U04EvaluationEvidenceEntry>();
    const requireRef = (entry: U04EvaluationEvidenceEntry) => {
      if (!refs.some(ref => shadowSame(ref.ref, entry.ref))) invalidComparison();
      roots.set(u04EvaluationEvidenceKey(entry.ref), entry);
    };
    const requireDocument = (value: NonNullable<typeof pool>) => {
      for (const entry of value.entries.filter(entry => entry.table === "documents" ||
        (entry.ref.tag === "candidate_projection" && ["worker_metadata", "document_counts"].includes(entry.ref.slot)))) requireRef(entry);
    };
    const outputValue = rowFor(source);
    if (pool === null) {
      const shortCorrection = operation === "correct_terms" && String(auditObject(transport.call.originalArguments).input_query)
        .toLowerCase().split(/\s+/).every(token => [...token].length < 4);
      const eligible = shortCorrection ? [] : pools.filter(entry => entry.document.status === "indexed" && (operation !== "correct_terms" || entry.source.ownerId === null));
      const expected = eligible.flatMap(entry => entry.entries.filter(item => item.table === "documents" ||
        (item.ref.tag === "candidate_projection" && ["worker_metadata", "document_counts"].includes(item.ref.slot)) ||
        (operation === "corpus_terms" && item.table === "document_chunks")));
      if (operation === "correct_terms" && !shortCorrection) expected.push(...pools.flatMap(entry => entry.entries.filter(item => item.table === "rag_aliases" &&
        auditObject(item.row).owner_id === null && auditObject(item.row).enabled === true)));
      const unique = [...new Map(expected.map(entry => [u04EvaluationEvidenceKey(entry.ref), entry])).values()];
      sameSet(source.refs, unique.map(entry => entry.ref));
      // Aggregate provenance binds the exact native statistic inputs. It does
      // not assert a source graph for unreturned chunks across several views.
      if (source.relationships.length !== 0) invalidComparison();
      if (operation === "corpus_terms") {
        const row = auditObject(outputValue);
        if (row.total_doc_count !== eligible.length || numberValue(row.title_doc_count) > eligible.length || numberValue(row.title_doc_count) < 0)
          invalidComparison();
      }
      // Lexeme, trigram and ranking arithmetic belongs to the fixed, reviewed
      // native implementation; retained inputs do not pretend to emulate it.
    } else {
      const output = auditObject(outputValue), table = u04EvaluationPrimaryTable[operation];
      if (!table) invalidComparison();
      const id = table === "documents" && ["related_documents", "ranking_metadata"].includes(operation)
        ? output.document_id : table === "document_index_quality" ? output.document_id : output.id;
      const matching = pool.entries.filter(entry => entry.table === table && (operation === "aliases"
        ? ["alias", "canonical", "alias_type", "weight", "owner_id"].every(key => shadowSame(auditObject(entry.row)[key], output[key]))
        : auditObject(entry.row)[table === "document_index_quality" ? "document_id" : "id"] === id));
      if (matching.length === 0 || (operation !== "aliases" && matching.length !== 1)) invalidComparison();
      const primary = matching.find(entry => refs.some(ref => shadowSame(ref.ref, entry.ref)));
      if (!primary) invalidComparison();
      if (pool.member !== null) auditEqual(source.view, primary.view ?? pool.member.payload.binding);
      requireRef(primary);
      const native = table === "documents" ? pool.document : auditObject(primary.row);
      for (const key of ["document_filters", "document_ids"])
        if (args[key] !== undefined && args[key] !== null && !list(uuidValue)(args[key]).includes(pool.source.documentId)) invalidComparison();
      if (args.document_filter !== undefined && args.document_filter !== null && args.document_filter !== pool.source.documentId) invalidComparison();
      if (args.ids !== undefined && !list(uuidValue)(args.ids).includes(String(output.id))) invalidComparison();
      for (const [key, field] of [["indexes", "chunk_index"], ["chunk_indexes", "chunk_index"], ["page_numbers", "page_number"]] as const)
        if (args[key] !== undefined && !list(shadowEvaluationIntegerValue)(args[key]).includes(numberValue(native[field]))) invalidComparison();
      if (operation === "aliases" && (native.enabled !== true || (source.part === "publicRows") !== (native.owner_id === null))) invalidComparison();
      if (operation === "aliases" && primary.ref.tag === "origin_row" && pool.source.manualAliasIds.includes(primary.ref.rowId)) {
        const aliasId = primary.ref.rowId;
        if (pools.find(entry => entry.source.manualAliasIds.includes(aliasId)) !== pool) invalidComparison();
      }
      for (const [key, value] of Object.entries(output)) {
        if (!Object.hasOwn(native, key)) continue;
        if (key === "metadata" && operation === "table_facts") continue; // Literal '{}' in the fixed return contract.
        if (key === "source_chunk_id" && (operation === "embedding_fields" || operation === "index_units"))
          auditEqual(value, native.source_chunk_id ?? native.id);
        else auditEqual(value, native[key]);
      }
      if (table === "documents" || Object.hasOwn(output, "source_metadata") ||
        ["text_chunks", "hybrid_chunks", "vector_chunks"].includes(operation)) {
        requireDocument(pool);
        if (Object.hasOwn(output, "source_metadata")) auditEqual(output.source_metadata, pool.document.metadata);
        if (table !== "documents") for (const key of ["title", "file_name"])
          if (Object.hasOwn(output, key)) auditEqual(output[key], pool.document[key]);
      }
      if (operation === "text_chunks" || operation === "related_documents" || operation === "ranking_metadata") {
        requireDocument(pool);
        const textMode = operation === "text_chunks";
        const labels = pool.entries.filter(entry => entry.table === "document_labels").filter(entry => {
          const label = auditObject(entry.row), metadata = auditObject(label.metadata);
          return textMode ? metadata.review_status !== "hidden" && String(metadata.hidden ?? "false") !== "true"
            : pool.source.ownerId !== null && label.owner_id === pool.source.ownerId;
        });
        const returned = list(shadowEvaluationLabelRow)(output[textMode ? "document_labels" : "labels"]);
        sameSet(returned, labels.map(entry => entry.row)); labels.forEach(requireRef);
        const summaries = pool.entries.filter(entry => entry.table === "document_summaries" &&
          (textMode || (pool.source.ownerId !== null && auditObject(entry.row).owner_id === pool.source.ownerId)));
        const summary = output[textMode ? "document_summary" : "summary"];
        if (summaries.length === 0) { if (summary !== null) invalidComparison(); }
        else {
          const selected = summaries.filter(entry => auditObject(entry.row).summary === summary);
          if (selected.length === 0) invalidComparison();
          if (!textMode && !pool.member) {
            const newest = summaries.reduce((at, entry) => shadowMicros(String(auditObject(entry.row).generated_at)) > at
              ? shadowMicros(String(auditObject(entry.row).generated_at)) : at, 0n);
            if (!selected.some(entry => shadowMicros(String(auditObject(entry.row).generated_at)) === newest)) invalidComparison();
          }
          const referenced = selected.filter(entry => refs.some(ref => shadowSame(ref.ref, entry.ref)));
          if (referenced.length !== 1) invalidComparison();
          requireRef(referenced[0]!);
        }
      }
      if (operation === "text_chunks" || operation === "hybrid_chunks") {
        const ids = list(uuidValue)(native.image_ids);
        const images = pool.entries.filter(entry => entry.table === "document_images" && ids.includes(String(auditObject(entry.row).id)) &&
          auditObject(entry.row).searchable === true && auditObject(entry.row).image_type !== "logo_decorative");
        const returned = list(shadowEvaluationImageMetadataRow)(output.images);
        sameSet(returned.map(entry => entry.id), images.map(entry => auditObject(entry.row).id));
        for (const image of returned) {
          const retained = images.find(entry => auditObject(entry.row).id === image.id)!; requireRef(retained);
          const row = auditObject(retained.row), metadata = auditObject(row.metadata);
          for (const [key, value] of Object.entries(image)) if (Object.hasOwn(row, key)) auditEqual(value, row[key]);
          auditEqual(image.sourceKind, row.source_kind);
          const nullableText = (value: AuditJson | undefined) => value === null || value === undefined || value === "" ? null
            : typeof value === "string" ? value : auditPgText(value);
          auditEqual(image.tableLabel, nullableText(metadata.table_label)); auditEqual(image.tableTitle, nullableText(metadata.table_title));
          auditEqual(image.tableRole, nullableText(metadata.table_role));
          const snippet = nullableText(metadata.table_text_snippet ?? metadata.table_text ?? "");
          auditEqual(image.tableTextSnippet, snippet === null ? null : [...snippet].slice(0, 500).join(""));
        }
      }
    }
    const relationships = [...new Map([...roots.values()].flatMap(entry => entry.relationships)
      .map(entry => [encodeShadowNodeJsonCanonicalPayload(entry), entry])).values()];
    sameSet(source.relationships, relationships);
    for (const relationship of relationships) {
      const targets = available.filter(entry => entry.unit !== null && shadowSame(entry.unit, relationship.target));
      if (targets.length !== 1 || !refs.some(entry => shadowSame(entry.ref, targets[0]!.ref))) invalidComparison();
      if (relationship.tag === "anchor" && auditObject(targets[0]!.row).anchor_id !== relationship.value) invalidComparison();
      roots.set(u04EvaluationEvidenceKey(targets[0]!.ref), targets[0]!);
    }
    if (pool !== null) sameSet(source.refs, [...roots.values()].map(entry => entry.ref));
  }
  return freezeTree({ kind: "shadow-evaluation-result-validated" as const,
    envelope: transport.envelope, call: transport.call, observation, result: payload.result, sources: payload.sources });
}
