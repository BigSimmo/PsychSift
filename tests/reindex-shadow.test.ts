import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Buffer } from "node:buffer";
import { IngestionAttempt } from "../supabase/functions/_shared/ingestion-attempt";
import { stageIngestionShadowGeneration } from "../worker/behavior";
import type { ShadowWorkerContextV1 } from "../scripts/lib/reindex-eval-session";
import { createHash } from "node:crypto";
import type { Database } from "../src/lib/supabase/database.types";
import { mapCapturedEvalCase, type RagEvalCase } from "../src/lib/rag/rag-eval-cases";
import {
  createShadowNodeJsonByteEnvelope,
  captureShadowProducerInputV1,
  readShadowProducerInputV1,
  encodeShadowNodeJsonCanonicalPayload,
  validateShadowEnvelopeBytes,
  parseShadowComparisonConfigEnvelope,
  parseShadowComparisonCaseEnvelope,
  prepareShadowComparisonCasePayload,
  restoreShadowComparisonCases,
  parseShadowSqlEnvironmentCaptureEnvelope,
  parseShadowSqlEnvironmentReviewEnvelope,
  parseShadowSqlEnvironmentBundleEnvelope,
  parseShadowExecutionProfileEnvelope,
  type ShadowExecutionProfilePayload,
  parseShadowInventoryManifestPayload,
  type ShadowInventoryManifestPayload,
  type ShadowSqlEnvironmentCapturePayload,
  type ShadowSqlEnvironmentReviewPayload,
  type ShadowSqlEnvironmentBundlePayload,
  type ShadowComparisonConfigPayload,
  type ShadowComparisonCasePayload,
  type ShadowEnvelopeDomain,
  type ShadowEnvelopeEncoding,
  prepareShadowAuditV1,
  shadowPrivateObjectIdentityV1,
  compareShadowStateV1,
  validateShadowControlTransitionV1,
  prepareShadowPersistenceV1,
  readShadowPersistenceBundleV1,
  readShadowProjectionAggregateV1,
  readShadowFinalInventoryV1,
  readShadowPreSealInventoryV1,
  readShadowMemberSealReceiptV1,
  readShadowWaveReadbackV1,
  measureShadowWaveReadbackBytesV1,
  readShadowQualityProjectionV1,
  readShadowWorkerProjectionV1,
  prepareShadowEvaluationAuthorityV1,
  readShadowEvaluationAuthorityV1,
  prepareShadowEvaluationRequestV1,
  readShadowEvaluationRequestV1,
  prepareShadowEvaluationRuntimeAdmissionV1,
  readShadowEvaluationArgumentsV1,
  prepareShadowEvaluationCallV1,
  prepareShadowEvaluationSqlContextV1,
  readShadowEvaluationObservationV1,
  parseShadowEvaluationResultEnvelopeV1,
  readShadowEvaluationResultV1,
  readShadowCandidateCaseReportV1,
} from "../scripts/lib/reindex-eval-session";
import { buildIngestionAuditReport, reviewedProvenanceEvidenceDigest } from "../src/lib/ingestion-audit";
import { recoveryReadinessDigest } from "../src/lib/recovery-readiness-evidence";
import type { ExpectedSourceCoverageRegistry } from "../src/lib/source-coverage-registry";
import { australianSourceByKey, australianSourcePolicyVersion } from "../src/lib/australian-source-catalogue";
import { normalizeOptionalSourceMetadata } from "../src/lib/source-metadata";
import {
  evaluateShadowReindexV1,
  promoteShadowDocumentGenerationV1,
  rollbackDocumentIndexGenerationV1,
  readShadowReindexStageV1,
} from "../scripts/reindex-shadow";

// Literal independent Python hashlib vectors, copied from the reviewed input.
// Neither expectation is computed with the implementation under test.
const nodePlan = {
  version: 1,
  domain: "plan",
  encoding: "node-json-v1",
  canonicalPayload: '{"a":[1,2],"z":"café\\nline"}',
  digest: "sha256:72a82828eccab8fcf259746dbd3a0679fc01c1c4021e69e64f163ab6275540be",
} as const;
const pgBaseline = {
  version: 1,
  domain: "baseline",
  encoding: "pg-jsonb-text-v1",
  canonicalPayload:
    '{"value": 9007199254740993, "timestamp": "2026-09-11T02:00:00.123456+00:00", "embedding": [0.12345678901234567890]}',
  digest: "sha256:241cd6e4b776836144a9a1aa028ca396ba431384cc8c8ef0c06439df35bc1fc4",
} as const;

describe("C02 rollback SQL manifest compatibility", () => {
  const projectRef = "sjrfecxgysukkwxsowpy";
  const candidateGenerationId = "55555555-5555-4555-8555-555555555555";
  const documentIds = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  ] as const;
  const promotionPayload = {
    version: 1 as const,
    kind: "document-generation-promotion-v1" as const,
    operationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    projectRef,
    candidateGenerationId,
    planDigest: `sha256:${"a".repeat(64)}`,
    stageReceiptDigest: `sha256:${"b".repeat(64)}`,
    evaluationReportDigest: `sha256:${"c".repeat(64)}`,
    recoveryEvidenceDigest: `sha256:${"d".repeat(64)}`,
    stageAuthorizationDigest: `sha256:${"e".repeat(64)}`,
    promoteAuthorizationDigest: `sha256:${"f".repeat(64)}`,
    technicalEvidenceReceiptDigests: [`sha256:${"1".repeat(64)}`, `sha256:${"2".repeat(64)}`],
    transitions: documentIds.map((documentId, index) => ({
      documentId,
      fromGenerationId: index === 0 ? null : "33333333-3333-4333-8333-333333333333",
      toGenerationId: candidateGenerationId,
      previousServingSnapshotDigest: `sha256:${"3".repeat(64)}`,
      candidateServingSnapshotDigest: `sha256:${"4".repeat(64)}`,
      retainedUntil: "2026-10-13T01:00:00.000Z",
    })),
    promotedAt: "2026-09-13T01:05:00.000Z",
  };
  const promotionReceipt = {
    ...promotionPayload,
    receiptDigest: `sha256:${createHash("sha256")
      .update(encodeShadowNodeJsonCanonicalPayload(promotionPayload))
      .digest("hex")}`,
  };
  const authorization = {
    version: 1 as const,
    operation: "rollback" as const,
    targetProjectRef: projectRef,
    promotionOperationId: promotionReceipt.operationId,
    promotionReceiptDigest: promotionReceipt.receiptDigest,
    candidateGenerationId,
    expectedDocumentIds: [...documentIds],
    expectedDocumentCount: documentIds.length,
    retainedUntil: "2027-01-13T01:00:00.000Z",
    reasonCode: "post_promotion_observation_failed",
    authorizedAt: "2026-12-13T01:00:00.000Z",
    expiresAt: "2026-12-13T01:10:00.000Z",
    confirmationSha256: `sha256:${"5".repeat(64)}`,
  };
  const rollbackManifest = {
    authorization,
    rollbackManifestDigest: `sha256:${createHash("sha256")
      .update(encodeShadowNodeJsonCanonicalPayload(authorization))
      .digest("hex")}`,
  };
  const rollbackPayload = {
    version: 1 as const,
    kind: "document-generation-rollback-v1" as const,
    operationId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    promotionOperationId: promotionReceipt.operationId,
    promotionReceiptDigest: promotionReceipt.receiptDigest,
    rollbackManifestDigest: rollbackManifest.rollbackManifestDigest,
    candidateGenerationId,
    transitions: promotionReceipt.transitions.map((transition) => ({
      documentId: transition.documentId,
      fromGenerationId: transition.toGenerationId,
      toGenerationId: transition.fromGenerationId,
      retainedUntil: authorization.retainedUntil,
    })),
    rolledBackAt: "2026-12-13T01:05:00.000Z",
  };
  const rollbackReceipt = {
    ...rollbackPayload,
    receiptDigest: `sha256:${createHash("sha256")
      .update(encodeShadowNodeJsonCanonicalPayload(rollbackPayload))
      .digest("hex")}`,
  };

  it("C02 rollback exact keys: sends the SQL-compatible authorization and derives inverse receipt transitions", async () => {
    const rpc = vi.fn(async () => ({ data: rollbackReceipt, error: null }));

    await expect(
      rollbackDocumentIndexGenerationV1(
        { promotionReceipt, rollbackManifest, trustedNow: rollbackPayload.rolledBackAt },
        { projectRef, client: { rpc } },
      ),
    ).resolves.toEqual(rollbackReceipt);
    expect(Object.keys(authorization).sort()).toEqual([
      "authorizedAt", "candidateGenerationId", "confirmationSha256", "expectedDocumentCount",
      "expectedDocumentIds", "expiresAt", "operation", "promotionOperationId", "promotionReceiptDigest",
      "reasonCode", "retainedUntil", "targetProjectRef", "version",
    ]);
    expect(rpc).toHaveBeenCalledWith("rollback_document_index_generation", {
      p_promotion_receipt: promotionReceipt,
      p_rollback_manifest: rollbackManifest,
    });
  });

  it("C02 rollback pre-RPC refusal: rejects a wrong destination or exact-population mismatch", async () => {
    const rpc = vi.fn(async () => ({ data: rollbackReceipt, error: null }));
    await expect(
      rollbackDocumentIndexGenerationV1(
        { promotionReceipt, rollbackManifest, trustedNow: rollbackPayload.rolledBackAt },
        { projectRef: "abcdefghijklmnopqrst", client: { rpc } },
      ),
    ).rejects.toThrow(/different project/i);
    expect(rpc).not.toHaveBeenCalled();

    const substitutedAuthorization = {
      ...authorization,
      expectedDocumentIds: [documentIds[0]],
      expectedDocumentCount: 1,
    };
    const substitutedManifest = {
      authorization: substitutedAuthorization,
      rollbackManifestDigest: `sha256:${createHash("sha256")
        .update(encodeShadowNodeJsonCanonicalPayload(substitutedAuthorization))
        .digest("hex")}`,
    };
    await expect(
      rollbackDocumentIndexGenerationV1(
        { promotionReceipt, rollbackManifest: substitutedManifest, trustedNow: rollbackPayload.rolledBackAt },
        { projectRef, client: { rpc } },
      ),
    ).rejects.toThrow(/exact promotion receipt/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("C02 rollback receipt window: rejects a correctly digested receipt created at authorization expiry", async () => {
    const latePayload = { ...rollbackPayload, rolledBackAt: authorization.expiresAt };
    const lateReceipt = {
      ...latePayload,
      receiptDigest: `sha256:${createHash("sha256")
        .update(encodeShadowNodeJsonCanonicalPayload(latePayload))
        .digest("hex")}`,
    };
    const rpc = vi.fn(async () => ({ data: lateReceipt, error: null }));
    await expect(
      rollbackDocumentIndexGenerationV1(
        { promotionReceipt, rollbackManifest, trustedNow: authorization.expiresAt },
        { projectRef, client: { rpc } },
      ),
    ).rejects.toThrow("Rollback receipt time is outside its authorization window.");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("C02 rollback expired replay: recovers an existing receipt while SQL refuses a first execution", async () => {
    const retryClock = "2027-02-13T01:05:00.000Z";
    const existingReceiptRpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      expect(name).toBe("rollback_document_index_generation");
      expect(args).toEqual({ p_promotion_receipt: promotionReceipt, p_rollback_manifest: rollbackManifest });
      return { data: rollbackReceipt, error: null };
    });
    await expect(
      rollbackDocumentIndexGenerationV1(
        { promotionReceipt, rollbackManifest, trustedNow: retryClock },
        { projectRef, client: { rpc: existingReceiptRpc } },
      ),
    ).resolves.toEqual(rollbackReceipt);
    expect(existingReceiptRpc).toHaveBeenCalledTimes(1);

    const firstExecutionRpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      expect(name).toBe("rollback_document_index_generation");
      expect(args).toEqual({ p_promotion_receipt: promotionReceipt, p_rollback_manifest: rollbackManifest });
      return { data: null, error: { message: "document_generation_rollback_authorization_expired" } };
    });
    await expect(
      rollbackDocumentIndexGenerationV1(
        { promotionReceipt, rollbackManifest, trustedNow: retryClock },
        { projectRef, client: { rpc: firstExecutionRpc } },
      ),
    ).rejects.toThrow("document_generation_rollback_authorization_expired");
    expect(firstExecutionRpc).toHaveBeenCalledTimes(1);
  });
});

describe("U04 complete native producer input", () => {
  it("retains actual RPC bytes and reconstructs absent, null and own undefined fields", () => {
    const source = { text: " café\n ", metadata: { absentSibling: null, optional: undefined }, values: [undefined, null, { optional: undefined }] };
    const retained = captureShadowProducerInputV1(source);
    expect(retained).toEqual({ input: { text: " café\n ", metadata: { absentSibling: null }, values: [null, null, {}] },
      ownUndefinedPaths: [["metadata", "optional"], ["values", 0], ["values", 2, "optional"]] });
    const restored = readShadowProducerInputV1(retained);
    expect(restored.nativeInput).toStrictEqual(source);
    expect(JSON.parse(JSON.stringify(restored.nativeInput))).toEqual(restored.input);
    expect(captureShadowProducerInputV1(restored.nativeInput)).toEqual(retained);
    expect(Object.hasOwn((restored.nativeInput as typeof source).metadata, "optional")).toBe(true);
    expect(Object.hasOwn((restored.nativeInput as typeof source).metadata, "absent")).toBe(false);
    expect(Object.isFrozen(restored.nativeInput)).toBe(true);
    expect(source.metadata.optional).toBeUndefined();
  });

  it("preserves special own keys without prototype mutation and supports a native undefined root", () => {
    const native = Object.create(null);
    Object.defineProperty(native, "__proto__", { value: undefined, enumerable: true });
    const restored = readShadowProducerInputV1(captureShadowProducerInputV1(native));
    expect(Object.getOwnPropertyDescriptor(restored.nativeInput, "__proto__")?.value).toBeUndefined();
    expect(Object.hasOwn(restored.nativeInput as object, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(restored.nativeInput)).toBe(Object.prototype);
    expect(readShadowProducerInputV1({ input: null, ownUndefinedPaths: [[]] }).nativeInput).toBeUndefined();
  });

  it.each([
    { input: { value: null }, ownUndefinedPaths: [["value"]] },
    { input: { value: 1 }, ownUndefinedPaths: [["value"]] },
    { input: [], ownUndefinedPaths: [[0]] },
    { input: [null], ownUndefinedPaths: [["0"]] },
    { input: {}, ownUndefinedPaths: [[0]] },
    { input: {}, ownUndefinedPaths: [["missing", "child"]] },
    { input: {}, ownUndefinedPaths: [["x"], ["x"]] },
    { input: { nested: {} }, ownUndefinedPaths: [["nested", "x"], ["nested"]] },
    { input: {}, ownUndefinedPaths: [["z"], ["a"]] },
    { input: false, ownUndefinedPaths: [[]] },
    { input: {}, ownUndefinedPaths: [], extra: true },
  ])("refuses contradictory, lossy or ambiguous native presence records %#", (retained) => {
    expect(() => readShadowProducerInputV1(retained)).toThrow();
  });

  it("refuses accessors, sparse arrays and cycles before retaining or executing native data", () => {
    const getter = vi.fn(() => "secret");
    const accessor = Object.defineProperty({}, "value", { get: getter, enumerable: true });
    expect(() => captureShadowProducerInputV1(accessor)).toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(() => captureShadowProducerInputV1(new Array(1))).toThrow();
    const cycle: { value?: unknown } = {}; cycle.value = cycle;
    expect(() => captureShadowProducerInputV1(cycle)).toThrow();
    expect(() => readShadowProducerInputV1({ input: accessor, ownUndefinedPaths: [] })).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });
});

describe("U04 canonical client JSON bytes", () => {
  it("matches the independent Unicode plan vector including its UTF-8 byte length", () => {
    const result = createShadowNodeJsonByteEnvelope({ z: "café\nline", a: [1, 2] }, "plan");
    expect(result.envelope).toEqual(nodePlan);
    expect(result.payloadUtf8Bytes).toBe(29);
    expect(result.kind).toBe("shadow-envelope-bytes-only");
  });

  it("sorts numeric-looking, nested, BMP and astral keys by JS code units", () => {
    const first = { "\uE000": "bmp", "😀": "astral", "2": "two", a: { "2": 2, "10": 1 }, "10": "ten" };
    const reordered = { "10": "ten", a: { "10": 1, "2": 2 }, "2": "two", "😀": "astral", "\uE000": "bmp" };
    const expected = '{"10":"ten","2":"two","a":{"10":1,"2":2},"😀":"astral","\uE000":"bmp"}';
    expect(encodeShadowNodeJsonCanonicalPayload(first)).toBe(expected);
    expect(encodeShadowNodeJsonCanonicalPayload(reordered)).toBe(expected);
  });

  it("preserves meaningful array order, whitespace, Unicode, fractions and falsy JSON values", () => {
    expect(encodeShadowNodeJsonCanonicalPayload(["z", "a", false, 0, "", null, 1.25, -0.125, " café\n\t "])).toBe(
      '["z","a",false,0,"",null,1.25,-0.125," café\\n\\t "]',
    );
    expect(encodeShadowNodeJsonCanonicalPayload(["a", "z"])).toBe('["a","z"]');
    expect(encodeShadowNodeJsonCanonicalPayload(["z", "a"])).toBe('["z","a"]');
  });

  it("distinguishes an explicit null field from absence and refuses undefined", () => {
    expect(encodeShadowNodeJsonCanonicalPayload({ value: null })).toBe('{"value":null}');
    expect(encodeShadowNodeJsonCanonicalPayload({})).toBe("{}");
    expect(() => encodeShadowNodeJsonCanonicalPayload({ value: undefined })).toThrow("Invalid canonical JSON value.");
  });

  it("accepts shared acyclic values, frozen objects and plain null-prototype records without mutation", () => {
    const shared = Object.freeze({ b: 2, a: 1 });
    const dictionary = Object.create(null);
    Object.defineProperty(dictionary, "__proto__", { value: shared, enumerable: true });
    expect(encodeShadowNodeJsonCanonicalPayload([shared, shared, dictionary])).toBe(
      '[{"a":1,"b":2},{"a":1,"b":2},{"__proto__":{"a":1,"b":2}}]',
    );
    expect(Object.keys(shared)).toEqual(["b", "a"]);
    expect(Object.getPrototypeOf(dictionary)).toBeNull();
  });

  it.each([
    ["undefined", undefined],
    ["function", () => 1],
    ["symbol", Symbol("synthetic")],
    ["bigint", 1n],
    ["NaN", NaN],
    ["positive infinity", Infinity],
    ["negative infinity", -Infinity],
    ["unsafe positive integer", 9007199254740992],
    ["unsafe negative integer", -9007199254740992],
    ["negative zero coercion", -0],
    ["Date", new Date("2026-09-11T00:00:00Z")],
    ["Map", new Map()],
    ["boxed primitive", Object(1)],
  ])("rejects non-JSON or lossy value: %s", (_name, value) => {
    expect(() => encodeShadowNodeJsonCanonicalPayload(value)).toThrow("Invalid canonical JSON value.");
  });

  it.each([
    ["unpaired high surrogate value", { value: "\uD800" }],
    ["unpaired low surrogate value", { value: "\uDC00" }],
    ["unpaired high surrogate key", { ["\uD800"]: 1 }],
    ["unpaired low surrogate key", { ["\uDC00"]: 1 }],
  ])("rejects %s", (_name, value) => {
    expect(() => encodeShadowNodeJsonCanonicalPayload(value)).toThrow("Invalid canonical JSON value.");
  });

  it("rejects object and array cycles", () => {
    const object: Record<string, unknown> = {};
    object.self = object;
    const array: unknown[] = [];
    array.push(array);
    expect(() => encodeShadowNodeJsonCanonicalPayload(object)).toThrow("Invalid canonical JSON value.");
    expect(() => encodeShadowNodeJsonCanonicalPayload(array)).toThrow("Invalid canonical JSON value.");
  });

  it("rejects array holes and extra array properties rather than dropping them", () => {
    const hole = new Array(2);
    hole[1] = "retained";
    const extra = Object.assign([1], { other: 2 });
    expect(() => encodeShadowNodeJsonCanonicalPayload(hole)).toThrow("Invalid canonical JSON value.");
    expect(() => encodeShadowNodeJsonCanonicalPayload(extra)).toThrow("Invalid canonical JSON value.");
  });

  it("rejects symbol keys and non-enumerable data that JSON.stringify would omit", () => {
    const hidden = Object.defineProperty({}, "hidden", { value: 1 });
    expect(() => encodeShadowNodeJsonCanonicalPayload({ [Symbol("synthetic")]: 1 })).toThrow(
      "Invalid canonical JSON value.",
    );
    expect(() => encodeShadowNodeJsonCanonicalPayload(hidden)).toThrow("Invalid canonical JSON value.");
  });

  it("rejects object and array accessors without invoking them", () => {
    const getter = vi.fn(() => "synthetic private value");
    const object = Object.defineProperty({}, "value", { get: getter, enumerable: true });
    const array = Object.defineProperty([1], "0", { get: getter, enumerable: true });
    expect(() => encodeShadowNodeJsonCanonicalPayload(object)).toThrow("Invalid canonical JSON value.");
    expect(() => encodeShadowNodeJsonCanonicalPayload(array)).toThrow("Invalid canonical JSON value.");
    expect(getter).not.toHaveBeenCalled();
  });

  it("rejects own and inherited toJSON hooks without invoking them", () => {
    const toJSON = vi.fn(() => ({ fabricated: true }));
    const inherited = Object.create({ toJSON });
    expect(() => encodeShadowNodeJsonCanonicalPayload({ toJSON })).toThrow("Invalid canonical JSON value.");
    expect(() => encodeShadowNodeJsonCanonicalPayload(inherited)).toThrow("Invalid canonical JSON value.");
    expect(toJSON).not.toHaveBeenCalled();
  });

  it("rejects proxies without invoking reflective traps", () => {
    const trap = vi.fn(() => {
      throw new Error("Proxy trap must not run.");
    });
    const value = new Proxy({}, { ownKeys: trap, getPrototypeOf: trap, getOwnPropertyDescriptor: trap });
    expect(() => encodeShadowNodeJsonCanonicalPayload(value)).toThrow("Invalid canonical JSON value.");
    expect(trap).not.toHaveBeenCalled();
  });
});

describe("U04 received envelope byte validation only", () => {
  it.each([
    { name: "node Unicode", envelope: nodePlan, bytes: 29 },
    { name: "pg precision", envelope: pgBaseline, bytes: 115 },
  ])("validates independent $name bytes without adding a parsed or authority view", ({ envelope, bytes }) => {
    const result = validateShadowEnvelopeBytes(envelope, envelope.domain, envelope.encoding);
    expect(result).toEqual({ kind: "shadow-envelope-bytes-only", envelope, payloadUtf8Bytes: bytes });
    expect(Object.keys(result).sort()).toEqual(["envelope", "kind", "payloadUtf8Bytes"]);
    expect(result).not.toHaveProperty("parsed");
    expect(result).not.toHaveProperty("authorized");
  });

  it("preserves raw unsafe integers, timestamp precision, vector decimals and whitespace exactly", () => {
    const result = validateShadowEnvelopeBytes(pgBaseline, "baseline", "pg-jsonb-text-v1");
    expect(result.envelope.canonicalPayload).toBe(
      '{"value": 9007199254740993, "timestamp": "2026-09-11T02:00:00.123456+00:00", "embedding": [0.12345678901234567890]}',
    );
    expect(result.payloadUtf8Bytes).toBe(115);
    expect(result.envelope.digest).toBe(
      "sha256:241cd6e4b776836144a9a1aa028ca396ba431384cc8c8ef0c06439df35bc1fc4",
    );
  });

  it("binds the caller's expected domain and encoding despite otherwise valid bytes", () => {
    expect(() => validateShadowEnvelopeBytes(nodePlan, "baseline", "node-json-v1")).toThrow(
      "Invalid shadow envelope bytes.",
    );
    expect(() => validateShadowEnvelopeBytes(nodePlan, "plan", "pg-jsonb-text-v1")).toThrow(
      "Invalid shadow envelope bytes.",
    );
  });

  it.each([
    ["wrong version", { ...nodePlan, version: 2 }],
    ["coerced version", { ...nodePlan, version: "1" }],
    ["extra key", { ...nodePlan, authorized: true }],
    [
      "missing key",
      {
        domain: nodePlan.domain,
        encoding: nodePlan.encoding,
        canonicalPayload: nodePlan.canonicalPayload,
        digest: nodePlan.digest,
      },
    ],
    ["wrong domain", { ...nodePlan, domain: "baseline" }],
    ["wrong encoding", { ...nodePlan, encoding: "pg-jsonb-text-v1" }],
    ["non-string payload", { ...nodePlan, canonicalPayload: {} }],
    ["unpaired surrogate payload", { ...nodePlan, canonicalPayload: "\uD800" }],
    ["payload tampering", { ...nodePlan, canonicalPayload: '{"a":[2,1],"z":"café\\nline"}' }],
    ["whitespace tampering", { ...pgBaseline, canonicalPayload: pgBaseline.canonicalPayload + " " }],
    [
      "digest tampering",
      { ...nodePlan, digest: "sha256:02a82828eccab8fcf259746dbd3a0679fc01c1c4021e69e64f163ab6275540be" },
    ],
    ["digest trailing newline", { ...nodePlan, digest: nodePlan.digest + "\n" }],
    ["uppercase digest", { ...nodePlan, digest: nodePlan.digest.toUpperCase() }],
    ["null envelope", null],
    ["array envelope", []],
  ])("refuses %s with a static payload-free error", (_name, envelope) => {
    const domain = _name === "whitespace tampering" ? "baseline" : "plan";
    const encoding = _name === "whitespace tampering" ? "pg-jsonb-text-v1" : "node-json-v1";
    expect(() => validateShadowEnvelopeBytes(envelope, domain, encoding)).toThrow("Invalid shadow envelope bytes.");
  });

  it("rejects envelope accessors without invoking or exposing their values", () => {
    const getter = vi.fn(() => "synthetic private value");
    const envelope = Object.defineProperty({ ...nodePlan }, "canonicalPayload", { get: getter, enumerable: true });
    expect(() => validateShadowEnvelopeBytes(envelope, "plan", "node-json-v1")).toThrow(
      "Invalid shadow envelope bytes.",
    );
    expect(getter).not.toHaveBeenCalled();
  });

  it("rejects symbol and non-enumerable envelope properties", () => {
    const symbol = { ...nodePlan, [Symbol("extra")]: true };
    const hidden = Object.defineProperty({ ...nodePlan }, "digest", { value: nodePlan.digest, enumerable: false });
    expect(() => validateShadowEnvelopeBytes(symbol, "plan", "node-json-v1")).toThrow("Invalid shadow envelope bytes.");
    expect(() => validateShadowEnvelopeBytes(hidden, "plan", "node-json-v1")).toThrow("Invalid shadow envelope bytes.");
  });

  it("copies immutable scalars and freezes both result layers against mutation", () => {
    const input: Record<string, unknown> = { ...nodePlan };
    const result = validateShadowEnvelopeBytes(input, "plan", "node-json-v1");
    input.canonicalPayload = "changed after verification";
    expect(result.envelope).toEqual(nodePlan);
    expect(result.envelope).not.toBe(input);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.envelope)).toBe(true);
    expect(Reflect.set(result.envelope, "canonicalPayload", "tampered")).toBe(false);
    expect(Reflect.set(result, "envelope", {})).toBe(false);
    expect(() => Object.defineProperty(result.envelope, "digest", { value: "tampered" })).toThrow(TypeError);
    expect(result.envelope).toEqual(nodePlan);
  });

  it("preserves all 26 original pairs and adds exactly four node-only domain pairs", () => {
    const accepted: ShadowEnvelopeDomain[] = [
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
    ];
    for (const domain of accepted) {
      expect(createShadowNodeJsonByteEnvelope(null, domain).envelope.domain).toBe(domain);
      for (const encoding of ["node-json-v1", "pg-jsonb-text-v1"] as const) {
        const raw = rawEnvelope("null", domain, encoding);
        expect(validateShadowEnvelopeBytes(raw, domain, encoding).envelope).toEqual(raw);
      }
    }
    for (const domain of [
      "u04-execution-profile-v1", "u04-engine-config-v1", "u04-evaluation-cases-v1", "u04-sql-execution-evidence-v1",
    ] as const) {
      const raw = rawEnvelope("null", domain, "node-json-v1");
      expect(validateShadowEnvelopeBytes(raw, domain, "node-json-v1").envelope).toEqual(raw);
      expect(() => validateShadowEnvelopeBytes(rawEnvelope("null", domain, "pg-jsonb-text-v1"), domain, "pg-jsonb-text-v1"))
        .toThrow("Invalid shadow envelope bytes.");
    }
    expect(() => createShadowNodeJsonByteEnvelope(null, "execution_profile" as ShadowEnvelopeDomain)).toThrow(
      "Invalid shadow envelope bytes.",
    );
    expect(() => validateShadowEnvelopeBytes(nodePlan, "plan\nother" as ShadowEnvelopeDomain, "node-json-v1")).toThrow(
      "Invalid shadow envelope bytes.",
    );
    expect(() => validateShadowEnvelopeBytes(nodePlan, "plan", "json" as ShadowEnvelopeEncoding)).toThrow(
      "Invalid shadow envelope bytes.",
    );
  });
});

// Independent framing permits correctly hashed malformed payloads to reach the semantic parser.
function rawEnvelope(canonicalPayload: string, domain: ShadowEnvelopeDomain, encoding: ShadowEnvelopeEncoding = "node-json-v1") {
  const header = `U04-SHADOW/1\n${domain}\n${encoding}\n${Buffer.byteLength(canonicalPayload, "utf8")}\n`;
  return { version: 1, domain, encoding, canonicalPayload,
    digest: `sha256:${createHash("sha256").update(header).update(canonicalPayload).digest("hex")}` };
}
type Mutable<T> = T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
function clone<T>(value: T): Mutable<T> { return JSON.parse(JSON.stringify(value)) as Mutable<T>; }
function configFixture(): Mutable<ShadowComparisonConfigPayload> {
  const weights = { hybridRelevance: 1.125, lexicalCoverage: 0, reciprocalRankFusion: 0.5,
    titleSectionRelevance: 2, metadataRelevance: 0.25, clinicalEvidence: 0.9 };
  return {
    kind: "u04-comparison-config-v1",
    generation: {
      answerModel: "synthetic-answer", fastModel: "synthetic-fast", strongModel: "synthetic-strong",
      classifierModel: "synthetic-classifier", indexingModel: "synthetic-index", embeddingModel: "synthetic-embedding",
      embeddingDimensions: 8, fastReasoningEffort: "none", strongReasoningEffort: "xhigh", answerVerbosity: "high",
      maxOutputTokens: 1234, providerMode: "openai", promptVersion: "prompt-v1", schemaVersion: "schema-v1",
      classifierPromptVersion: "classifier-v1", retrievalVersion: "retrieval-v1", indexingPromptVersion: "index-v1",
      semanticRerankEnabled: false, semanticRerankModel: "synthetic-rerank",
    },
    retrieval: { textWeakOrRelaxation: true },
    ranking: {
      secondStage: {
        positionBase: 0.09, positionStep: 0.004, memorySummaryBoost: 0.035, documentLookupTitleBoost: 0.045,
        tableThresholdEvidenceBoost: 0.065, doseAmountBoost: 0.18, tableVisualBoost: 0.08, visualBoost: 0.04,
        visualIntelligenceMax: 0.035, visualIntelligencePivot: 0.55, visualIntelligenceSlope: 0.08,
        outdatedPenalty: -0.0312345, unknownCurrentnessPenalty: 0, poorExtractionPenalty: 0.035,
        lowIndexQualityPenalty: 0.035, lowIndexQualityThreshold: 0.55,
      },
      featureFusion: { document_lookup: { ...weights }, table_threshold: { ...weights }, medication_dose_risk: { ...weights },
        comparison: { ...weights }, broad_summary: { ...weights, clinicalEvidence: 0.8123456 }, unsupported_or_general: { ...weights } },
      documentDiversityPenalty: 0, documentDiversityPenaltyCap: 0.12,
      freshness: { mode: "linear", publicationCliffYears: 8, publicationPenalty: -0.01512345,
        reviewCliffYears: 5, reviewPenalty: -0.01, linearRampYears: 0.0001 },
    },
    gate: {
      retrieval: { documentRecallAt5Floor: 0.8, contentRecallAt5Floor: 0.9, topKHitRateFloor: 1,
        failedCaseCountCeiling: 0, rateRegressionTolerance: 0.02, latencyRegressionMs: 4321.5 },
      quality: { groundedSupportedRateFloor: 0.9, unsupportedCorrectRateFloor: 1, citationFailureRateCeiling: 0,
        numericGroundingFailureRateCeiling: 0, sourceGovernanceDangerFailureRateCeiling: 0,
        expectedDangerWarningMissingCountCeiling: 0, staleReviewUnknownRateCeiling: 0.25, reviewRequiredRateCeiling: 0.25,
        p95LatencyMsCeiling: 60000, rateRegressionTolerance: 0.02, latencyRegressionMs: 4000 },
    },
  };
}
function qualityFixture(): RagEvalCase {
  return {
    id: "quality-z", question: " café\nquestion ", category: "complex", suite: "prompt_injection", relevanceGrade: "direct",
    expectedQueryClass: "medication_dose_risk", falsePositiveControl: false, supported: true,
    expectedFiles: ["z.pdf", "a.pdf", "z.pdf"], allowedRoutes: ["strong", "extractive", "fast", "unsupported"],
    minCitations: 0, requireExpectedFileCitation: false, latencyTargetMs: 12345.125,
    requiredDirectClaim: { riskClass: "high_risk", conceptAlternatives: [["dose", "amount"], [], [""]],
      semanticContract: "positive_prescriptive_score_independent_distress_escalation" },
    requireVisualEvidence: true, expectsSourceDangerWarning: false, acceptSourceOnly: false,
    programmeExpectation: {
      expectedCorpusScopes: ["uploaded_local", "clinical_kb_site", "australian_public", "international_supplementary"],
      expectedSourceRoles: ["local_guideline", "clinical_guideline", "clinical_reference", "service_directory", "form_reference",
        "tool_reference", "safety_alert", "regulatory", "quality_standard", "legal", "subsidy", "professional_review", "service_policy", "reference_link"],
      expectedSiteDomains: ["services", "forms", "medications", "differentials", "specifiers", "dsm", "formulation", "therapies", "dictionary", "factsheets", "calculators", "tools"],
      expectedPublicSiteContentState: "not_applicable",
      expectedSubquestionPurposes: ["primary", "comparison_side", "required_action", "monitoring", "risk", "special_population"],
      minimumDirectSubquestions: 1, allowedAnswerShapes: ["narrow", "focused", "comprehensive", "comparison", "partial"],
      requireSupportedPart: true, requireExactGap: false,
      expectedConflict: { localDocumentId: "local-synthetic", australianDocumentId: "au-synthetic",
        requireVisibleFields: ["source_identity", "publication_or_effective_date", "jurisdiction", "source_role", "material_difference", "local_primary_decision", "review_flag"] },
      forbiddenFallbackReasons: ["not_in_corpus", "retrieval_miss", "insufficient_claim_support", "source_role_mismatch", "source_conflict", "governance_block",
        "site_content_updating", "site_content_stale", "site_content_unavailable", "timeout", "provider_failure"],
      requiredFacts: ["z", "", "a"], forbiddenPatterns: ["never fabricate", ""], incrementalEligibility: "independent_sections",
    },
  };
}
function selectedFixture() {
  return { providerMode: "openai", globalForceEmbedding: false,
    selection: { retrieval: { query: "", limit: 0 }, quality: { question: "" } },
    retrieval: [
      { id: "r-z", query: "query z", expectedQueryClass: "custom-owner-string", expectedDocumentSubstrings: ["z.pdf", "a.pdf"],
        expectedContentTerms: ["z", ["beta", "alpha"], ["single"]], topK: 3, expectTableEvidence: false, forceEmbedding: true },
      { id: "r-a", query: "query a", expectedQueryClass: "broad_summary", expectedDocumentSubstrings: [],
        expectedContentTerms: [], topK: 12, expectTableEvidence: true, forceEmbedding: false },
    ], quality: [qualityFixture(), { ...qualityFixture(), id: "quality-a", expectedFiles: [], programmeExpectation: undefined }],
  };
}
function parsedCase(payload: unknown, expected: "openai" | "offline" = "openai") {
  return parseShadowComparisonCaseEnvelope(createShadowNodeJsonByteEnvelope(payload, "u04-evaluation-cases-v1").envelope, expected);
}

describe("U04 complete comparison configuration", () => {
  it("retains the complete nondefault config without rounding, fallback or authority claims", () => {
    const input = configFixture();
    const envelope = createShadowNodeJsonByteEnvelope(input, "u04-engine-config-v1").envelope;
    const parsed = parseShadowComparisonConfigEnvelope(envelope);
    expect(parsed.payload).toEqual(input);
    expect(parsed.bytes.envelope).toEqual(envelope);
    expect(parsed.kind).toBe("shadow-comparison-schema-only");
    input.ranking.freshness.publicationPenalty = 1;
    expect(parsed.payload.ranking.freshness.publicationPenalty).toBe(-0.01512345);
    expect(Object.isFrozen(parsed.payload.ranking.featureFusion.broad_summary)).toBe(true);
    expect(Reflect.set(parsed.payload.generation, "providerMode", "offline")).toBe(false);
  });

  it.each([
    ["missing generation field", (p: ReturnType<typeof configFixture>) => Reflect.deleteProperty(p.generation, "classifierModel")],
    ["unknown generation field", (p: ReturnType<typeof configFixture>) => Object.assign(p.generation, { requestedModel: "unused" })],
    ["auto provider", (p: ReturnType<typeof configFixture>) => Object.assign(p.generation, { providerMode: "auto" })],
    ["empty model", (p: ReturnType<typeof configFixture>) => { p.generation.answerModel = ""; }],
    ["fractional dimensions", (p: ReturnType<typeof configFixture>) => { p.generation.embeddingDimensions = 1.5; }],
    ["invalid reasoning", (p: ReturnType<typeof configFixture>) => Object.assign(p.generation, { fastReasoningEffort: "minimal" })],
    ["missing second-stage weight", (p: ReturnType<typeof configFixture>) => Reflect.deleteProperty(p.ranking.secondStage, "doseAmountBoost")],
    ["missing query-class fusion", (p: ReturnType<typeof configFixture>) => Reflect.deleteProperty(p.ranking.featureFusion, "comparison")],
    ["unknown nested weight", (p: ReturnType<typeof configFixture>) => Object.assign(p.ranking.featureFusion.broad_summary, { unknown: 1 })],
    ["negative fusion", (p: ReturnType<typeof configFixture>) => { p.ranking.featureFusion.comparison.clinicalEvidence = -1; }],
    ["negative diversity", (p: ReturnType<typeof configFixture>) => { p.ranking.documentDiversityPenalty = -1; }],
    ["negative currentness", (p: ReturnType<typeof configFixture>) => { p.ranking.secondStage.unknownCurrentnessPenalty = -1; }],
    ["zero ramp", (p: ReturnType<typeof configFixture>) => { p.ranking.freshness.linearRampYears = 0; }],
    ["invalid mode", (p: ReturnType<typeof configFixture>) => Object.assign(p.ranking.freshness, { mode: "exponential" })],
    ["missing gate", (p: ReturnType<typeof configFixture>) => Reflect.deleteProperty(p.gate.quality, "expectedDangerWarningMissingCountCeiling")],
    ["rate outside unit interval", (p: ReturnType<typeof configFixture>) => { p.gate.retrieval.rateRegressionTolerance = 1.01; }],
    ["fractional count", (p: ReturnType<typeof configFixture>) => { p.gate.retrieval.failedCaseCountCeiling = 0.5; }],
    ["negative latency", (p: ReturnType<typeof configFixture>) => { p.gate.quality.latencyRegressionMs = -1; }],
    ["extra authority", (p: ReturnType<typeof configFixture>) => Object.assign(p, { authorized: true })],
  ])("rejects %s without repairing configuration", (_name, mutate) => {
    const input = configFixture();
    (mutate as (p: ReturnType<typeof configFixture>) => unknown)(input);
    expect(() => parseShadowComparisonConfigEnvelope(createShadowNodeJsonByteEnvelope(input, "u04-engine-config-v1").envelope))
      .toThrow("Invalid shadow comparison record.");
  });

  it.each([
    ["duplicate root key", '{"gate":', '{"kind":"ignored","gate":'],
    ["escaped duplicate key", '{"gate":', '{"\\u006bind":"ignored","gate":'],
    ["nested duplicate key", '"answerModel":', '"answerModel":"ignored","answerModel":'],
    ["unsafe integer", '"embeddingDimensions":8', '"embeddingDimensions":9007199254740993'],
    ["unsafe integral decimal", '"embeddingDimensions":8', '"embeddingDimensions":9007199254740993.0'],
    ["unsafe exponent", '"embeddingDimensions":8', '"embeddingDimensions":9.007199254740993e15'],
    ["rounded fraction", '"p95LatencyMsCeiling":60000', '"p95LatencyMsCeiling":0.10000000000000001'],
    ["overflow", '"p95LatencyMsCeiling":60000', '"p95LatencyMsCeiling":1e9999'],
    ["negative zero", '"p95LatencyMsCeiling":60000', '"p95LatencyMsCeiling":-0'],
    ["trailing comma", '"answerModel":"synthetic-answer",', '"answerModel":"synthetic-answer",,'],
    ["invalid string escape", '"synthetic-answer"', '"\\x"'],
    ["lone surrogate", '"synthetic-answer"', '"\\ud800"'],
  ])("rejects correctly hashed invalid JSON in a complete config: %s", (_name, before, after) => {
    const canonical = encodeShadowNodeJsonCanonicalPayload(configFixture());
    expect(canonical).toContain(before);
    const text = canonical.replace(before, after);
    expect(() => parseShadowComparisonConfigEnvelope(rawEnvelope(text, "u04-engine-config-v1")))
      .toThrow("Invalid shadow comparison record.");
  });

  it("rejects noncanonical spacing/key order/numeric spelling for an otherwise complete config", () => {
    const payload = configFixture();
    const canonical = encodeShadowNodeJsonCanonicalPayload(payload);
    for (const text of [JSON.stringify(payload), canonical + " ", canonical.replace('"embeddingDimensions":8', '"embeddingDimensions":8.0')]) {
      expect(text).not.toBe(canonical);
      expect(() => parseShadowComparisonConfigEnvelope(rawEnvelope(text, "u04-engine-config-v1")))
        .toThrow("Invalid shadow comparison record.");
    }
  });

  it("rejects cross-domain/kind substitution and changed bytes under the retained digest", () => {
    const input = configFixture();
    for (const domain of ["plan", "u04-evaluation-cases-v1"] as const) {
      expect(() => parseShadowComparisonConfigEnvelope(createShadowNodeJsonByteEnvelope(input, domain).envelope)).toThrow();
    }
    const envelope = createShadowNodeJsonByteEnvelope(input, "u04-engine-config-v1").envelope;
    expect(() => parseShadowComparisonConfigEnvelope({ ...envelope, canonicalPayload: envelope.canonicalPayload.replace("synthetic-answer", "changed-answer") })).toThrow();
    expect(() => parsedCase(input)).toThrow("Invalid shadow comparison record.");
  });
});

describe("U04 final ordered comparison cases", () => {
  it("preserves every safety field, array order and derived retrieval window", () => {
    const input = selectedFixture();
    const prepared = prepareShadowComparisonCasePayload(input);
    const parsed = parsedCase(prepared);
    expect(parsed.payload).toEqual(prepared);
    expect(parsed.payload.retrieval.map((entry) => entry.retrievalLimit)).toEqual([10, 12]);
    expect(parsed.payload.retrieval.map((entry) => entry.effectiveForceEmbedding)).toEqual([true, false]);
    expect(parsed.payload.quality[0]).toEqual(input.quality[0]);
    expect(restoreShadowComparisonCases(parsed.payload)).toEqual({ retrieval: input.retrieval, quality: input.quality });
    expect(parsed.payload.retrieval.map((entry) => entry.testCase.expectedContentTerms.length)).toEqual([3, 0]);
    expect(parsed.payload.preparation.optionalUndefined).toEqual([{ scope: "quality", index: 1, field: "programmeExpectation" }]);
    input.quality[0]!.expectedFiles.push("caller mutation");
    expect(parsed.payload.quality[0]!.expectedFiles).toEqual(["z.pdf", "a.pdf", "z.pdf"]);
    expect(Object.isFrozen(parsed.payload.quality[0]!.programmeExpectation!.expectedConflict)).toBe(true);
  });

  it("round trips the actual captured-case mapper's two own-undefined properties", () => {
    const mapped = mapCapturedEvalCase({ id: "synthetic", query: "Synthetic question", query_class: null,
      top_files: [], expected_file: null, miss_reason: null, metadata: {}, created_at: null });
    const prepared = prepareShadowComparisonCasePayload({ providerMode: "offline", globalForceEmbedding: false,
      selection: { retrieval: {}, quality: {} }, retrieval: [], quality: [mapped] });
    expect(prepared.preparation.optionalUndefined).toEqual([
      { scope: "quality", index: 0, field: "expectedQueryClass" },
      { scope: "quality", index: 0, field: "expectsSourceDangerWarning" },
    ]);
    const restored = restoreShadowComparisonCases(parsedCase(prepared, "offline").payload).quality[0]!;
    expect(restored).toEqual(mapped);
    for (const key of ["expectedQueryClass", "expectsSourceDangerWarning"] as const) {
      expect(Object.hasOwn(mapped, key)).toBe(true);
      expect(Object.hasOwn(prepared.quality[0]!, key)).toBe(false);
      expect(Object.hasOwn(restored, key)).toBe(true);
      expect(restored[key]).toBeUndefined();
    }
    expect(Object.hasOwn(restored, "acceptSourceOnly")).toBe(false);
    expect(Object.isFrozen(restored)).toBe(true);
  });

  it("distinguishes absence, false/empty, and every allowed own-undefined field", () => {
    const input = selectedFixture();
    input.retrieval.forEach((testCase) => Reflect.deleteProperty(testCase, "forceEmbedding"));
    Object.defineProperty(input.retrieval[1], "forceEmbedding", { value: undefined, enumerable: true });
    const absent = qualityFixture();
    const undefinedCase = qualityFixture();
    for (const field of ["suite", "relevanceGrade", "expectedQueryClass", "falsePositiveControl", "requireExpectedFileCitation",
      "requiredDirectClaim", "requireVisualEvidence", "expectsSourceDangerWarning", "acceptSourceOnly", "programmeExpectation"]) {
      Reflect.deleteProperty(absent, field);
      Object.defineProperty(undefinedCase, field, { value: undefined, enumerable: true });
    }
    const nested = qualityFixture();
    Object.assign(nested.requiredDirectClaim!, { conceptAlternatives: undefined, semanticContract: undefined });
    const prepared = prepareShadowComparisonCasePayload({ ...input, quality: [absent, undefinedCase, nested, qualityFixture()] });
    const restored = restoreShadowComparisonCases(parsedCase(prepared).payload);
    expect(restored.quality).toEqual([absent, undefinedCase, nested, qualityFixture()]);
    expect(Object.hasOwn(restored.retrieval[0]!, "forceEmbedding")).toBe(false);
    expect(Object.hasOwn(restored.retrieval[1]!, "forceEmbedding")).toBe(true);
    expect(Object.hasOwn(restored.quality[0]!, "suite")).toBe(false);
    expect(Object.hasOwn(restored.quality[1]!, "suite")).toBe(true);
    expect(Object.hasOwn(restored.quality[2]!.requiredDirectClaim!, "semanticContract")).toBe(true);
    expect(restored.quality[3]!.falsePositiveControl).toBe(false);
    expect(restored.quality[3]!.requiredDirectClaim!.conceptAlternatives).toEqual([["dose", "amount"], [], [""]]);
    expect(prepared.preparation.optionalUndefined).toHaveLength(13);
    expect(prepared.preparation.optionalUndefined.at(-1)).toEqual({ scope: "retrieval", index: 1, field: "forceEmbedding" });
  });

  it("keeps empty populations, duplicate cases, null conflict and source-equivalent quality scalars representable", () => {
    const input = selectedFixture();
    const q = qualityFixture();
    Object.assign(q, { id: "", question: "", minCitations: -0.5, latencyTargetMs: -1 });
    q.programmeExpectation!.expectedConflict = null;
    const prepared = prepareShadowComparisonCasePayload({ ...input, retrieval: [], quality: [q, q] });
    expect(parsedCase(prepared).payload.quality).toEqual([q, q]);
    const empty = prepareShadowComparisonCasePayload({ ...input, retrieval: [], quality: [] });
    expect(parsedCase(empty).payload.retrieval).toEqual([]);
    expect(parsedCase(empty).payload.quality).toEqual([]);
  });

  it("binds provider mode and rejects offline embedding instead of filtering cases", () => {
    const input = selectedFixture();
    expect(() => prepareShadowComparisonCasePayload({ ...input, providerMode: "offline" })).toThrow();
    const prepared = prepareShadowComparisonCasePayload(input);
    expect(() => parsedCase(prepared, "offline")).toThrow();
    const global = prepareShadowComparisonCasePayload({ ...input, globalForceEmbedding: true });
    expect(global.retrieval.map((entry) => entry.effectiveForceEmbedding)).toEqual([true, true]);
    expect(() => prepareShadowComparisonCasePayload({ ...input, providerMode: "offline", globalForceEmbedding: true, retrieval: [] })).toThrow();
  });

  it("rejects altered/reordered/filtered case bytes under the original retained identity", () => {
    const payload = prepareShadowComparisonCasePayload(selectedFixture());
    const envelope = createShadowNodeJsonByteEnvelope(payload, "u04-evaluation-cases-v1").envelope;
    const variants = [clone(payload), clone(payload), clone(payload)];
    variants[0]!.retrieval.reverse(); variants[1]!.quality[0]!.question = "changed"; variants[2]!.retrieval.pop();
    for (const variant of variants) {
      expect(() => parseShadowComparisonCaseEnvelope({ ...envelope, canonicalPayload: encodeShadowNodeJsonCanonicalPayload(variant) }, "openai")).toThrow();
    }
  });

  it.each([
    ["wrong kind", (p: Mutable<ShadowComparisonCasePayload>) => Object.assign(p, { kind: "other" })],
    ["missing preparation", (p: Mutable<ShadowComparisonCasePayload>) => Reflect.deleteProperty(p, "preparation")],
    ["unknown selection", (p: Mutable<ShadowComparisonCasePayload>) => Object.assign(p.selection.quality, { custom: true })],
    ["invalid query class", (p: Mutable<ShadowComparisonCasePayload>) => Object.assign(p.quality[0]!, { expectedQueryClass: "custom" })],
    ["missing programme field", (p: Mutable<ShadowComparisonCasePayload>) => Reflect.deleteProperty(p.quality[0]!.programmeExpectation!, "requireExactGap")],
    ["unknown conflict field", (p: Mutable<ShadowComparisonCasePayload>) => Object.assign(p.quality[0]!.programmeExpectation!.expectedConflict!, { approved: true })],
    ["invalid safety role", (p: Mutable<ShadowComparisonCasePayload>) => Object.assign(p.quality[0]!.programmeExpectation!, { expectedSourceRoles: ["invented"] })],
    ["invalid semantic contract", (p: Mutable<ShadowComparisonCasePayload>) => Object.assign(p.quality[0]!.requiredDirectClaim!, { semanticContract: "invented" })],
    ["unadopted quality workload", (p: Mutable<ShadowComparisonCasePayload>) => Object.assign(p.quality[0]!, { expectedIntent: "dose" })],
    ["empty alternative group", (p: Mutable<ShadowComparisonCasePayload>) => { p.retrieval[0]!.testCase.expectedContentTerms = [[]]; }],
    ["derived limit", (p: Mutable<ShadowComparisonCasePayload>) => { p.retrieval[0]!.retrievalLimit = 3; }],
    ["derived embedding", (p: Mutable<ShadowComparisonCasePayload>) => { p.retrieval[0]!.effectiveForceEmbedding = false; }],
    ["missing ledger field", (p: Mutable<ShadowComparisonCasePayload>) => Reflect.deleteProperty(p.preparation.optionalUndefined[0]!, "field")],
    ["extra ledger field", (p: Mutable<ShadowComparisonCasePayload>) => Object.assign(p.preparation.optionalUndefined[0]!, { path: "x" })],
    ["duplicate ledger", (p: Mutable<ShadowComparisonCasePayload>) => p.preparation.optionalUndefined.push(p.preparation.optionalUndefined[0]!)],
    ["out-of-range ledger", (p: Mutable<ShadowComparisonCasePayload>) => { p.preparation.optionalUndefined[0]!.index = 2; }],
    ["required ledger target", (p: Mutable<ShadowComparisonCasePayload>) => Object.assign(p.preparation.optionalUndefined[0]!, { field: "supported" })],
    ["unknown ledger target", (p: Mutable<ShadowComparisonCasePayload>) => Object.assign(p.preparation.optionalUndefined[0]!, { field: "__proto__" })],
    ["suppressed present value", (p: Mutable<ShadowComparisonCasePayload>) => Object.assign(p.preparation.optionalUndefined[0]!, { index: 0, field: "acceptSourceOnly" })],
    ["parent-child conflict", (p: Mutable<ShadowComparisonCasePayload>) => { Reflect.deleteProperty(p.quality[0]!, "requiredDirectClaim");
      p.preparation.optionalUndefined = [{ scope: "quality", index: 0, field: "requiredDirectClaim" }, { scope: "quality", index: 0, field: "requiredDirectClaim.semanticContract" }]; }],
    ["unsorted ledger", (p: Mutable<ShadowComparisonCasePayload>) => { Reflect.deleteProperty(p.quality[0]!, "suite");
      p.preparation.optionalUndefined.push({ scope: "quality", index: 0, field: "suite" }); }],
  ])("rejects internally invalid cases: %s", (_name, mutate) => {
    const payload = clone(prepareShadowComparisonCasePayload(selectedFixture()));
    (mutate as (p: Mutable<ShadowComparisonCasePayload>) => unknown)(payload);
    expect(() => parsedCase(payload)).toThrow("Invalid shadow comparison record.");
  });

  it.each(["required", "unknown", "selection", "nested required"])("refuses undefined outside the finite ledger: %s", (position) => {
    const input = selectedFixture();
    if (position === "required") Object.assign(input.quality[0]!, { supported: undefined });
    if (position === "unknown") Object.assign(input.quality[0]!, { unknown: undefined });
    if (position === "selection") Object.assign(input.selection.retrieval, { query: undefined });
    if (position === "nested required") Object.assign(input.quality[0]!.requiredDirectClaim!, { riskClass: undefined });
    expect(() => prepareShadowComparisonCasePayload(input)).toThrow();
  });

  it("refuses preparation accessors, hooks, proxies, cycles and sparse arrays without invoking user code", () => {
    const invoked = vi.fn(() => { throw new Error("must not invoke"); });
    const values = [Object.defineProperty(qualityFixture(), "suite", { get: invoked, enumerable: true }),
      Object.assign(qualityFixture(), { toJSON: invoked }), new Proxy(qualityFixture(), { ownKeys: invoked })];
    for (const quality of values) expect(() => prepareShadowComparisonCasePayload({ ...selectedFixture(), quality: [quality] })).toThrow();
    const cyclic = qualityFixture(); Object.assign(cyclic, { unknown: cyclic });
    expect(() => prepareShadowComparisonCasePayload({ ...selectedFixture(), quality: [cyclic] })).toThrow();
    expect(() => prepareShadowComparisonCasePayload({ ...selectedFixture(), quality: new Array(1) })).toThrow();
    expect(invoked).not.toHaveBeenCalled();
  });

  it("restores fresh frozen copies and revalidates ledgers rather than trusting a typed caller", () => {
    const prepared = prepareShadowComparisonCasePayload(selectedFixture());
    const first = restoreShadowComparisonCases(prepared);
    const second = restoreShadowComparisonCases(prepared);
    expect(first.quality[1]).not.toBe(second.quality[1]);
    expect(Object.hasOwn(prepared.quality[1]!, "programmeExpectation")).toBe(false);
    expect(Object.hasOwn(first.quality[1]!, "programmeExpectation")).toBe(true);
    expect(Reflect.set(first.quality[1]!, "programmeExpectation", {})).toBe(false);
    const forged = clone(prepared); forged.preparation.optionalUndefined[0]!.index = 99;
    expect(() => restoreShadowComparisonCases(forged)).toThrow("Invalid shadow comparison record.");
  });
});

function retainedFixture(content: string | Buffer) {
  const buffer = typeof content === "string" ? Buffer.from(content, "utf8") : content;
  return {
    encoding: typeof content === "string" ? "utf8" as const : "base64" as const,
    content: typeof content === "string" ? content : content.toString("base64"),
    byteLength: buffer.length,
    digest: `sha256:${createHash("sha256").update(buffer).digest("hex")}`,
  };
}
type SqlFixture = Mutable<ShadowSqlEnvironmentCapturePayload>;
function refreshNative(capture: SqlFixture): SqlFixture {
  const { kind: _kind, nativeCapture: _native, ...facts } = capture;
  capture.nativeCapture = retainedFixture(JSON.stringify({ kind: "u04-native-environment-facts-v1", ...facts }, null, 2));
  return capture;
}
function sqlFixture(): SqlFixture {
  const tags = [
    "aliases", "corpus_terms", "correct_terms", "text_chunks", "hybrid_chunks", "vector_chunks", "lookup_chunks",
    "lookup_chunk_terms", "lookup_chunk_prefix", "lookup_documents", "lookup_document_terms", "table_facts",
    "embedding_fields", "index_units", "memory_cards_hybrid", "memory_cards_lexical", "chunks_by_ids", "chunks_by_indexes",
    "documents", "ranking_metadata", "related_documents", "quality", "images_by_ids", "images_by_pages", "visual_rows", "adjacent_chunks",
  ] as const;
  const orderedTags = [...tags].sort();
  const qname = (name: string) => ({ schema: "public", name });
  const routine = (name: string) => ({ identity: qname(name), argumentTypes: ["jsonb"], resultType: "jsonb" });
  const supportNames = ["support_end", "support_headline", "support_init", "support_lex", "support_lex_types", "support_start", "support_token"];
  const sourceDigest = retainedFixture("synthetic source identity").digest;
  const clientDigest = retainedFixture("synthetic client identity").digest;
  const distributionDigest = retainedFixture("synthetic distribution identity").digest;
  const operations: SqlFixture["operations"] = orderedTags.map((operation): SqlFixture["operations"][number] => ({
    operation, entryRoutine: routine(`eval_${operation}`), dependencyRoutines: [routine("support_lex")],
    relations: ["documents"], collations: [qname("collation_a")],
    settings: [
      { name: "TimeZone", effectiveText: "UTC", unit: null, source: "server", definingRoutine: null },
      { name: "default_text_search_config", effectiveText: "public.english", unit: null, source: "database", definingRoutine: null },
      { name: "hnsw.ef_search", effectiveText: operation === "vector_chunks" ? "100" : "40", unit: null, source: "function", definingRoutine: routine(`eval_${operation}`) },
      { name: "lock_timeout", effectiveText: "0", unit: "ms", source: "function", definingRoutine: routine(`eval_${operation}`) },
      { name: "pg_trgm.similarity_threshold", effectiveText: "0.30000000000000000001", unit: null, source: "request", definingRoutine: null },
      { name: "search_path", effectiveText: "public, pg_catalog", unit: null, source: "role", definingRoutine: null },
      { name: "statement_timeout", effectiveText: "0", unit: "ms", source: "role", definingRoutine: null },
    ],
  }));
  const capture: SqlFixture = {
    kind: "u04-sql-environment-capture-v1", evidenceMode: "mocked",
    target: { projectRef: "synthetic-project", databaseIdentity: "synthetic-db", serverIdentity: "synthetic-server",
      effectiveRole: "synthetic-session", requestPathIdentity: "synthetic-postgrest-path" },
    capturedAt: "2024-02-29T23:59:59.123456Z",
    producer: { identity: "synthetic-producer", toolVersion: "fixture-v1", toolArtifactDigest: sourceDigest },
    implementation: { revision: "a".repeat(40), files: [
      { path: "scripts/lib/reindex-eval-session.ts", digest: clientDigest },
      { path: "supabase/migrations/synthetic.sql", digest: sourceDigest },
    ] },
    runtime: { postgresVersion: "synthetic-pg", pgvectorVersion: "synthetic-vector", pgTrgmVersion: "synthetic-trgm",
      serverEncoding: "UTF8", distributionIdentity: "synthetic-build" },
    nativeCapture: retainedFixture("temporary fixture construction"),
    textSearch: {
      configuration: qname("english"), parser: { identity: qname("synthetic_parser"), start: routine("support_start"),
        token: routine("support_token"), end: routine("support_end"), lexTypes: routine("support_lex_types"), headline: routine("support_headline") },
      tokenMappings: [{ tokenId: 1, tokenAlias: "word", dictionaries: [qname("dict_z"), qname("dict_a"), qname("dict_z")] }],
      dictionaries: ["dict_a", "dict_z"].map((name) => ({ identity: qname(name), template: qname("simple"),
        initializationRoutine: name === "dict_a" ? routine("support_init") : null, lexizeRoutine: routine("support_lex"),
        optionsDefinition: retainedFixture("'Unchanged Options' = 'café'"),
        dependencies: name === "dict_a"
          ? [{ kind: "distribution_builtin" as const, identity: "builtin-stopwords", distributionIdentity: "synthetic-build" }]
          : [{ kind: "retained_resource" as const, identity: "binary-rules", bytes: retainedFixture(Buffer.from([0, 255, 128])) }],
      })),
    },
    collations: [
      { identity: qname("collation_a"), provider: "synthetic-provider", encoding: "UTF8", localeDefinition: retainedFixture("locale raw bytes"),
        deterministic: true, declaredProviderVersion: "old-observation", observedProviderVersion: "new-observation", nullVersionReason: null },
      { identity: qname("collation_b"), provider: "synthetic-no-version", encoding: "UTF8", localeDefinition: retainedFixture("C"),
        deterministic: false, declaredProviderVersion: null, observedProviderVersion: null, nullVersionReason: "not_applicable" },
    ],
    relations: [{ relation: "documents", definition: retainedFixture("synthetic full relation definition"), indexes: [
      { identity: qname("documents_index"), accessMethod: "synthetic-btree", valid: false, ready: true,
        definition: retainedFixture("synthetic full index definition"), operatorClasses: [qname("text_ops"), qname("text_ops")],
        collations: [qname("collation_b"), qname("collation_a")] },
    ] }],
    routines: [
      ...operations.map((operation) => ({ routine: clone(operation.entryRoutine), definition: retainedFixture(`synthetic definition ${operation.operation}`),
        provenance: { kind: "repository" as const, implementationPath: "supabase/migrations/synthetic.sql", sourceDigest } })),
      ...supportNames.map((name) => ({ routine: routine(name), definition: retainedFixture(`synthetic distribution definition ${name}`),
        provenance: { kind: "distribution" as const, distributionIdentity: "synthetic-build", artifactDigest: distributionDigest } })),
    ],
    operations,
    deadlineConfiguration: {
      kind: "u04-deadline-configuration-v1", deploymentIdentity: "synthetic-deployment", transport: "supabase-postgrest-rpc",
      requestPathIdentity: "synthetic-postgrest-path", policy: { topLevelStatementDeadlineMs: 15000, lockTimeoutMs: 1000, clientTotalDeadlineMs: 20000 },
      bindings: operations.map((operation) => ({ routine: clone(operation.entryRoutine), sessionRole: "synthetic-session", effectiveRole: "synthetic-function-owner",
        statementTimeout: { effectiveMs: 0, source: "role", appliesBefore: "top_level_dispatch", configurationEvidence: retainedFixture("synthetic role settings") },
        lockTimeout: { effectiveMs: 0, source: "function", appliesBefore: "blocking_acquisition", configurationEvidence: retainedFixture("synthetic function settings") } })),
      client: { implementationPath: "scripts/lib/reindex-eval-session.ts", sourceDigest: clientDigest, totalDeadlineMs: 20000, scope: "one_operation_total" },
    },
  };
  return refreshNative(capture);
}
function parsedSql(capture: unknown) {
  return parseShadowSqlEnvironmentCaptureEnvelope(createShadowNodeJsonByteEnvelope(capture, "u04-sql-execution-evidence-v1").envelope);
}

describe("U04 complete SQL capture and original native facts", () => {
  it("preserves complete synthetic facts, meaningful order, binary bytes and nonconforming observations", () => {
    const input = sqlFixture();
    const original = input.nativeCapture.content;
    const result = parsedSql(input);
    expect(result.kind).toBe("shadow-sql-evidence-schema-only");
    expect(result.payload).toEqual(input);
    expect(result.payload.nativeCapture.content).toBe(original);
    expect(original).toContain('\n  "kind": "u04-native-environment-facts-v1"');
    expect(result.payload.capturedAt).toBe("2024-02-29T23:59:59.123456Z");
    expect(result.payload.operations).toHaveLength(26);
    expect(result.payload.operations.every((operation) => operation.settings.length === 7)).toBe(true);
    expect(result.payload.textSearch.tokenMappings[0]!.dictionaries.map((dictionary) => dictionary.name)).toEqual(["dict_z", "dict_a", "dict_z"]);
    expect(result.payload.textSearch.dictionaries[1]!.dependencies[0]).toEqual({ kind: "retained_resource", identity: "binary-rules", bytes: retainedFixture(Buffer.from([0, 255, 128])) });
    expect(result.payload.collations[0]!.declaredProviderVersion).toBe("old-observation");
    expect(result.payload.collations[0]!.observedProviderVersion).toBe("new-observation");
    expect(result.payload.deadlineConfiguration.bindings[0]!.statementTimeout.effectiveMs).toBe(0);
    expect(result.payload.deadlineConfiguration.bindings[0]!.lockTimeout.source).toBe("function");
    expect(result).not.toHaveProperty("authorized");
    input.operations.pop();
    expect(result.payload.operations).toHaveLength(26);
    expect(Object.isFrozen(result.payload.deadlineConfiguration.bindings[0]!.lockTimeout)).toBe(true);
    expect(Reflect.set(result.payload.target, "projectRef", "changed")).toBe(false);
  });

  it("accepts native key order/whitespace and exact integral decimal/exponent spellings without changing original bytes", () => {
    const input = sqlFixture();
    const raw = input.nativeCapture.content.replace('"tokenId": 1,', '"tokenId": 1.000e0,');
    expect(raw).not.toBe(input.nativeCapture.content);
    input.nativeCapture = retainedFixture(` \r\n${raw}\t `);
    expect(parsedSql(input).payload.nativeCapture.content).toBe(` \r\n${raw}\t `);
    input.nativeCapture = retainedFixture(Buffer.from(raw, "utf8"));
    expect(parsedSql(input).payload.nativeCapture).toEqual(input.nativeCapture);
  });

  it("accepts a distinct routine overload while resolving each full signature exactly", () => {
    const input = sqlFixture();
    const overload = clone(input.routines[0]!);
    overload.routine.argumentTypes = ["text"];
    input.routines.splice(1, 0, overload);
    input.operations[0]!.dependencyRoutines.unshift(clone(overload.routine));
    expect(parsedSql(refreshNative(input)).payload.routines).toHaveLength(34);
  });

  it("represents real-shaped facts without introducing review, bundle or operational acceptance", () => {
    const input = sqlFixture(); input.evidenceMode = "real";
    const result = parsedSql(refreshNative(input));
    expect(result.kind).toBe("shadow-sql-evidence-schema-only");
    expect(result.payload.evidenceMode).toBe("real");
    expect(Object.keys(result).sort()).toEqual(["bytes", "kind", "payload"]);
    expect(result).not.toHaveProperty("client");
  });

  it.each([
    ["wrong kind", (p: SqlFixture) => Object.assign(p, { kind: "u04-reviewed-sql-environment-v1" })],
    ["missing target field", (p: SqlFixture) => Reflect.deleteProperty(p.target, "serverIdentity")],
    ["extra runtime field", (p: SqlFixture) => Object.assign(p.runtime, { guessed: true })],
    ["missing operation", (p: SqlFixture) => p.operations.pop()],
    ["duplicate operation", (p: SqlFixture) => p.operations.push(clone(p.operations.at(-1)!))],
    ["unsorted operations", (p: SqlFixture) => p.operations.reverse()],
    ["missing setting", (p: SqlFixture) => p.operations[0]!.settings.pop()],
    ["duplicate setting", (p: SqlFixture) => p.operations[0]!.settings.push(clone(p.operations[0]!.settings.at(-1)!))],
    ["unsorted settings", (p: SqlFixture) => p.operations[0]!.settings.reverse()],
    ["unknown relation", (p: SqlFixture) => Object.assign(p.relations[0]!, { relation: "private_unrelated" })],
    ["missing referenced relation", (p: SqlFixture) => { p.relations = []; }],
    ["duplicate index", (p: SqlFixture) => p.relations[0]!.indexes.push(clone(p.relations[0]!.indexes[0]!))],
    ["missing referenced collation", (p: SqlFixture) => p.collations.pop()],
    ["unsorted collations", (p: SqlFixture) => p.collations.reverse()],
    ["mixed null versions", (p: SqlFixture) => { p.collations[0]!.observedProviderVersion = null; }],
    ["false not applicable", (p: SqlFixture) => { p.collations[0]!.nullVersionReason = "not_applicable"; }],
    ["missing null reason", (p: SqlFixture) => { p.collations[1]!.nullVersionReason = null; }],
    ["missing support routine", (p: SqlFixture) => p.routines.pop()],
    ["wrong overload", (p: SqlFixture) => { p.operations[0]!.entryRoutine.argumentTypes = ["text"]; }],
    ["wrong result type", (p: SqlFixture) => { p.operations[0]!.entryRoutine.resultType = "void"; }],
    ["conflicting same signature", (p: SqlFixture) => { const duplicate = clone(p.routines[0]!); duplicate.routine.resultType = "void"; p.routines.splice(1, 0, duplicate); }],
    ["unsorted routines", (p: SqlFixture) => p.routines.reverse()],
    ["missing operation dependency", (p: SqlFixture) => { p.operations[0]!.dependencyRoutines[0]!.identity.name = "missing"; }],
    ["duplicate operation dependency", (p: SqlFixture) => p.operations[0]!.dependencyRoutines.push(clone(p.operations[0]!.dependencyRoutines[0]!))],
    ["unknown parser support", (p: SqlFixture) => { p.textSearch.parser.start.identity.name = "missing"; }],
    ["missing dictionary", (p: SqlFixture) => p.textSearch.dictionaries.pop()],
    ["duplicate token", (p: SqlFixture) => p.textSearch.tokenMappings.push(clone(p.textSearch.tokenMappings[0]!))],
    ["missing dictionary bytes", (p: SqlFixture) => Reflect.deleteProperty(p.textSearch.dictionaries[1]!.dependencies[0]!, "bytes")],
    ["wrong distribution", (p: SqlFixture) => Object.assign(p.textSearch.dictionaries[0]!.dependencies[0]!, { distributionIdentity: "different" })],
    ["wrong routine distribution", (p: SqlFixture) => Object.assign(p.routines.at(-1)!.provenance, { distributionIdentity: "different" })],
    ["wrong repository digest", (p: SqlFixture) => Object.assign(p.routines[0]!.provenance, { sourceDigest: `sha256:${"0".repeat(64)}` })],
    ["wrong client digest", (p: SqlFixture) => { p.deadlineConfiguration.client.sourceDigest = `sha256:${"0".repeat(64)}`; }],
    ["missing client manifest entry", (p: SqlFixture) => p.implementation.files.shift()],
    ["unsorted manifest", (p: SqlFixture) => p.implementation.files.reverse()],
    ["unsafe revision", (p: SqlFixture) => { p.implementation.revision = "main"; }],
    ["dot path", (p: SqlFixture) => { p.implementation.files[0]!.path = "scripts/../secret.ts"; }],
    ["absolute path", (p: SqlFixture) => { p.implementation.files[0]!.path = "C:/secret.ts"; }],
    ["protected path", (p: SqlFixture) => { p.implementation.files[0]!.path = "1/owned.ts"; }],
    ["wrong deadline path", (p: SqlFixture) => { p.deadlineConfiguration.requestPathIdentity = "other"; }],
    ["raised statement policy", (p: SqlFixture) => { p.deadlineConfiguration.policy.topLevelStatementDeadlineMs = 15001; }],
    ["zero lock policy", (p: SqlFixture) => { p.deadlineConfiguration.policy.lockTimeoutMs = 0; }],
    ["raised lock policy", (p: SqlFixture) => { p.deadlineConfiguration.policy.lockTimeoutMs = 2001; }],
    ["raised client policy", (p: SqlFixture) => { p.deadlineConfiguration.client.totalDeadlineMs = 20001; }],
    ["function-only top-level timeout", (p: SqlFixture) => Object.assign(p.deadlineConfiguration.bindings[0]!.statementTimeout, { source: "function" })],
    ["late statement application", (p: SqlFixture) => Object.assign(p.deadlineConfiguration.bindings[0]!.statementTimeout, { appliesBefore: "blocking_acquisition" })],
    ["missing deadline binding", (p: SqlFixture) => p.deadlineConfiguration.bindings.pop()],
    ["nonfunction setting with routine", (p: SqlFixture) => { p.operations[0]!.settings[0]!.definingRoutine = clone(p.operations[0]!.entryRoutine); }],
    ["function setting without routine", (p: SqlFixture) => { p.operations[0]!.settings[2]!.definingRoutine = null; }],
    ["function setting outside operation closure", (p: SqlFixture) => { p.operations[0]!.settings[2]!.definingRoutine = clone(p.operations[1]!.entryRoutine); }],
  ])("rejects capture/native intrinsic fault: %s", (_name, mutate) => {
    const input = sqlFixture();
    (mutate as (p: SqlFixture) => unknown)(input);
    expect(() => parsedSql(refreshNative(input))).toThrow("Invalid shadow comparison record.");
  });

  it.each([
    "2023-02-29T23:59:59.123456Z", "1900-02-29T00:00:00.1Z", "2024-04-31T00:00:00.1Z",
    "0000-01-01T00:00:00.1Z", "2024-13-01T00:00:00.1Z", "2024-01-00T00:00:00.1Z",
    "2024-01-01T24:00:00.1Z", "2024-01-01T00:60:00.1Z", "2024-01-01T00:00:60.1Z",
    "2024-01-01T00:00:00Z", "2024-01-01T00:00:00.1234567Z", "2024-01-01T00:00:00.1+00:00", "2024-01-01T00:00:00.1Z\n",
  ])("rejects invalid calendar or precision: %s", (timestamp) => {
    const input = sqlFixture(); input.capturedAt = timestamp;
    expect(() => parsedSql(refreshNative(input))).toThrow("Invalid shadow comparison record.");
  });

  it.each([
    ["fraction rounded to integer", '"tokenId": 1,', '"tokenId": 1.00000000000000001,'],
    ["fraction with exponent", '"tokenId": 1,', '"tokenId": 100000000000000001e-17,'],
    ["unsafe integer", '"tokenId": 1,', '"tokenId": 9007199254740993,'],
    ["unsafe integral decimal", '"tokenId": 1,', '"tokenId": 9007199254740993.0,'],
    ["negative zero", '"tokenId": 1,', '"tokenId": -0,'],
    ["decoded duplicate key", '"tokenId": 1,', '"tokenId": 0, "\\u0074okenId": 1,'],
    ["native self capture", '"kind": "u04-native-environment-facts-v1",', '"kind": "u04-native-environment-facts-v1", "nativeCapture": {},'],
    ["native cycle digest field", '"kind": "u04-native-environment-facts-v1",', '"kind": "u04-native-environment-facts-v1", "profileDigest": "forged",'],
    ["missing field", '"evidenceMode": "mocked",', ''],
    ["mixed evidence mode", '"evidenceMode": "mocked",', '"evidenceMode": "real",'],
    ["wrong native kind", '"u04-native-environment-facts-v1"', '"u04-sql-environment-capture-v1"'],
    ["trailing JSON", '\n}', '\n} false'],
  ])("rejects correctly hashed native hazard: %s", (_name, before, after) => {
    const input = sqlFixture();
    expect(input.nativeCapture.content).toContain(before);
    input.nativeCapture = retainedFixture(input.nativeCapture.content.replace(before, after));
    expect(() => parsedSql(input)).toThrow("Invalid shadow comparison record.");
  });

  it("rejects UTF8 replacement decoding and BOM while retaining their original byte digest", () => {
    for (const prefix of [Buffer.from([0xff]), Buffer.from([0xef, 0xbb, 0xbf])]) {
      const input = sqlFixture();
      input.nativeCapture = retainedFixture(Buffer.concat([prefix, Buffer.from(input.nativeCapture.content, "utf8")]));
      expect(() => parsedSql(input)).toThrow("Invalid shadow comparison record.");
    }
  });

  it.each([
    ["length", (p: SqlFixture) => { p.nativeCapture.byteLength += 1; }],
    ["digest", (p: SqlFixture) => { p.nativeCapture.digest = `sha256:${"0".repeat(64)}`; }],
    ["invalid base64 alphabet", (p: SqlFixture) => { p.nativeCapture = { ...retainedFixture(Buffer.from("{}")), content: "e30*" }; }],
    ["missing base64 padding", (p: SqlFixture) => { p.nativeCapture = { ...retainedFixture(Buffer.from("{}")), content: "e30" }; }],
    ["base64 whitespace", (p: SqlFixture) => { p.nativeCapture = { ...retainedFixture(Buffer.from("{}")), content: "e30=\n" }; }],
    ["noncanonical base64 pad bits", (p: SqlFixture) => { p.nativeCapture = { ...retainedFixture(Buffer.from("{}")), content: "e31=" }; }],
    ["outer typed mismatch", (p: SqlFixture) => { p.target.projectRef = "changed"; }],
    ["ordered dictionary mismatch", (p: SqlFixture) => {
      const chain = p.textSearch.tokenMappings[0]!.dictionaries;
      chain.push(chain.shift()!);
    }],
    ["resource byte tamper", (p: SqlFixture) => Object.assign(p.textSearch.dictionaries[1]!.dependencies[0]!, { bytes: { ...retainedFixture(Buffer.from([0, 255, 128])), content: "AAAA" } })],
  ])("rejects original byte or typed-projection mismatch: %s", (_name, mutate) => {
    const input = sqlFixture(); (mutate as (p: SqlFixture) => unknown)(input);
    expect(() => parsedSql(input)).toThrow("Invalid shadow comparison record.");
  });

  it("rejects domain/kind substitution and preserves canonical outer-envelope requirements", () => {
    const input = sqlFixture();
    for (const domain of ["plan", "u04-execution-profile-v1"] as const) {
      expect(() => parseShadowSqlEnvironmentCaptureEnvelope(createShadowNodeJsonByteEnvelope(input, domain).envelope)).toThrow();
    }
    expect(() => parseShadowSqlEnvironmentCaptureEnvelope(rawEnvelope(JSON.stringify(input), "u04-sql-execution-evidence-v1")))
      .toThrow("Invalid shadow comparison record.");
  });
});

function sqlReviewFixture(captureDigest: string): Mutable<ShadowSqlEnvironmentReviewPayload> {
  return {
    kind: "u04-sql-environment-review-v1", evidenceMode: "mocked", captureEnvelopeDigest: captureDigest,
    reviewer: { identity: "synthetic-independent-reviewer", role: "database_schema_reviewer", reviewedAt: "2024-03-01T01:02:03.100001Z" },
    coverage: [
      { area: "collations", outcome: "unsatisfied", findings: ["Synthetic declared and observed versions differ."] },
      { area: "operation_settings", outcome: "satisfied", findings: ["Synthetic shape reviewed.", "Evidence is not operational admission."] },
      { area: "server_deadline", outcome: "unavailable", findings: ["Synthetic effective timeout is zero."] },
      { area: "structural_dependencies", outcome: "satisfied", findings: [] },
      { area: "target_and_implementation", outcome: "satisfied", findings: ["Explicit synthetic target."] },
      { area: "text_search", outcome: "satisfied", findings: [] },
    ],
  };
}
function sqlBundleFixture(): Mutable<ShadowSqlEnvironmentBundlePayload> {
  const captureEnvelope = createShadowNodeJsonByteEnvelope(sqlFixture(), "u04-sql-execution-evidence-v1").envelope;
  const reviewEnvelope = createShadowNodeJsonByteEnvelope(sqlReviewFixture(captureEnvelope.digest), "u04-sql-execution-evidence-v1").envelope;
  return clone({ kind: "u04-reviewed-sql-environment-v1", evidenceMode: "mocked", captureEnvelope, reviewEnvelope } as const);
}
function parsedSqlBundle(payload: unknown) {
  return parseShadowSqlEnvironmentBundleEnvelope(createShadowNodeJsonByteEnvelope(payload, "u04-sql-execution-evidence-v1").envelope);
}

describe("U04 SQL review and original nested bundle bindings", () => {
  it("preserves complete original nested/native bytes and immutable parsed convenience results", () => {
    const input = sqlBundleFixture();
    const original = clone(input);
    const result = parsedSqlBundle(input);
    expect(result.kind).toBe("shadow-sql-evidence-schema-only");
    expect(result.payload).toEqual(original);
    expect(result.capture.bytes.envelope).toEqual(original.captureEnvelope);
    expect(result.review.bytes.envelope).toEqual(original.reviewEnvelope);
    expect(result.capture.payload.nativeCapture).toEqual(sqlFixture().nativeCapture);
    expect(result.review.payload.coverage.map((entry) => entry.outcome)).toEqual([
      "unsatisfied", "satisfied", "unavailable", "satisfied", "satisfied", "satisfied",
    ]);
    expect(result.review.payload.coverage[1]!.findings).toEqual([
      "Synthetic shape reviewed.", "Evidence is not operational admission.",
    ]);
    expect(result.capture.payload.deadlineConfiguration.bindings[0]!.statementTimeout.effectiveMs).toBe(0);
    expect(Object.isFrozen(result.payload.captureEnvelope)).toBe(true);
    expect(Object.isFrozen(result.review.payload.coverage[0]!.findings)).toBe(true);
    expect(Object.isFrozen(result.capture.payload.operations[0]!.settings)).toBe(true);
    input.captureEnvelope.canonicalPayload = "caller mutation";
    expect(result.payload.captureEnvelope.canonicalPayload).toBe(original.captureEnvelope.canonicalPayload);
    expect(Reflect.set(result.review.payload.reviewer, "identity", "changed")).toBe(false);
    expect(Object.keys(result).sort()).toEqual(["bytes", "capture", "kind", "payload", "review"]);
  });

  it("parses a real-shaped review/bundle with the same non-authorizing result class and no ambient clock rule", () => {
    const capture = sqlFixture(); capture.evidenceMode = "real";
    const captureEnvelope = createShadowNodeJsonByteEnvelope(refreshNative(capture), "u04-sql-execution-evidence-v1").envelope;
    const review = sqlReviewFixture(captureEnvelope.digest); review.evidenceMode = "real";
    review.reviewer.reviewedAt = "2000-02-29T00:00:00.1Z";
    const reviewEnvelope = createShadowNodeJsonByteEnvelope(review, "u04-sql-execution-evidence-v1").envelope;
    expect(parseShadowSqlEnvironmentReviewEnvelope(reviewEnvelope).payload).toEqual(review);
    const result = parsedSqlBundle({ kind: "u04-reviewed-sql-environment-v1", evidenceMode: "real", captureEnvelope, reviewEnvelope });
    expect(result.kind).toBe("shadow-sql-evidence-schema-only");
    expect(result.review.payload.reviewer.reviewedAt).toBe("2000-02-29T00:00:00.1Z");
    expect(result).not.toHaveProperty("authorized");
    expect(result).not.toHaveProperty("client");
  });

  it.each([
    ["missing review field", (p: Mutable<ShadowSqlEnvironmentReviewPayload>) => Reflect.deleteProperty(p, "reviewer")],
    ["extra review target", (p: Mutable<ShadowSqlEnvironmentReviewPayload>) => Object.assign(p, { target: "invented" })],
    ["missing reviewer field", (p: Mutable<ShadowSqlEnvironmentReviewPayload>) => Reflect.deleteProperty(p.reviewer, "reviewedAt")],
    ["extra reviewer authority", (p: Mutable<ShadowSqlEnvironmentReviewPayload>) => Object.assign(p.reviewer, { approved: true })],
    ["wrong role", (p: Mutable<ShadowSqlEnvironmentReviewPayload>) => Object.assign(p.reviewer, { role: "clinical_governance" })],
    ["empty actor", (p: Mutable<ShadowSqlEnvironmentReviewPayload>) => { p.reviewer.identity = ""; }],
    ["untrimmed actor", (p: Mutable<ShadowSqlEnvironmentReviewPayload>) => { p.reviewer.identity = " reviewer"; }],
    ["short digest", (p: Mutable<ShadowSqlEnvironmentReviewPayload>) => { p.captureEnvelopeDigest = "abc"; }],
    ["invalid timestamp", (p: Mutable<ShadowSqlEnvironmentReviewPayload>) => { p.reviewer.reviewedAt = "2023-02-29T00:00:00.1Z"; }],
    ["missing area", (p: Mutable<ShadowSqlEnvironmentReviewPayload>) => p.coverage.pop()],
    ["duplicate area", (p: Mutable<ShadowSqlEnvironmentReviewPayload>) => p.coverage.push(clone(p.coverage.at(-1)!))],
    ["reordered areas", (p: Mutable<ShadowSqlEnvironmentReviewPayload>) => p.coverage.reverse()],
    ["unknown area", (p: Mutable<ShadowSqlEnvironmentReviewPayload>) => Object.assign(p.coverage[0]!, { area: "other" })],
    ["unknown outcome", (p: Mutable<ShadowSqlEnvironmentReviewPayload>) => Object.assign(p.coverage[0]!, { outcome: "approved" })],
    ["extra coverage locator", (p: Mutable<ShadowSqlEnvironmentReviewPayload>) => Object.assign(p.coverage[0]!, { locator: "custom" })],
    ["missing findings", (p: Mutable<ShadowSqlEnvironmentReviewPayload>) => Reflect.deleteProperty(p.coverage[0]!, "findings")],
    ["unsatisfied without findings", (p: Mutable<ShadowSqlEnvironmentReviewPayload>) => { p.coverage[0]!.findings = []; }],
    ["unavailable without findings", (p: Mutable<ShadowSqlEnvironmentReviewPayload>) => { p.coverage[2]!.findings = []; }],
    ["empty finding", (p: Mutable<ShadowSqlEnvironmentReviewPayload>) => { p.coverage[0]!.findings = [""]; }],
  ])("rejects invalid review through the public bundle helper: %s", (_name, mutate) => {
    const bundle = sqlBundleFixture();
    const review = sqlReviewFixture(bundle.captureEnvelope.digest);
    (mutate as (p: Mutable<ShadowSqlEnvironmentReviewPayload>) => unknown)(review);
    bundle.reviewEnvelope = clone(createShadowNodeJsonByteEnvelope(review, "u04-sql-execution-evidence-v1").envelope);
    expect(() => parsedSqlBundle(bundle)).toThrow("Invalid shadow comparison record.");
  });

  it.each([
    ["wrong bundle kind", (p: Mutable<ShadowSqlEnvironmentBundlePayload>) => Object.assign(p, { kind: "u04-sql-environment-review-v1" })],
    ["missing nested capture", (p: Mutable<ShadowSqlEnvironmentBundlePayload>) => Reflect.deleteProperty(p, "captureEnvelope")],
    ["extra bundle field", (p: Mutable<ShadowSqlEnvironmentBundlePayload>) => Object.assign(p, { authorized: true })],
    ["digest-only capture", (p: Mutable<ShadowSqlEnvironmentBundlePayload>) => Object.assign(p, { captureEnvelope: p.captureEnvelope.digest })],
    ["path-only review", (p: Mutable<ShadowSqlEnvironmentBundlePayload>) => Object.assign(p, { reviewEnvelope: "review.json" })],
    ["outer evidence mismatch", (p: Mutable<ShadowSqlEnvironmentBundlePayload>) => { p.evidenceMode = "real"; }],
    ["nested capture bytes tampered", (p: Mutable<ShadowSqlEnvironmentBundlePayload>) => { p.captureEnvelope.canonicalPayload += " "; }],
    ["nested review bytes tampered", (p: Mutable<ShadowSqlEnvironmentBundlePayload>) => { p.reviewEnvelope.canonicalPayload += " "; }],
    ["capture/review swap", (p: Mutable<ShadowSqlEnvironmentBundlePayload>) => { [p.captureEnvelope, p.reviewEnvelope] = [p.reviewEnvelope, p.captureEnvelope]; }],
  ])("rejects substituted/tampered nested records: %s", (_name, mutate) => {
    const bundle = sqlBundleFixture();
    (mutate as (p: Mutable<ShadowSqlEnvironmentBundlePayload>) => unknown)(bundle);
    expect(() => parsedSqlBundle(bundle)).toThrow();
  });

  it.each(["review mode", "capture digest", "self review", "capture mode"])("rejects correctly hashed relationship mismatch: %s", (fault) => {
    const bundle = sqlBundleFixture();
    const review = sqlReviewFixture(bundle.captureEnvelope.digest);
    if (fault === "review mode") review.evidenceMode = "real";
    if (fault === "capture digest") review.captureEnvelopeDigest = `sha256:${"0".repeat(64)}`;
    if (fault === "self review") review.reviewer.identity = "synthetic-producer";
    if (fault === "capture mode") {
      const capture = sqlFixture(); capture.evidenceMode = "real";
      bundle.captureEnvelope = clone(createShadowNodeJsonByteEnvelope(refreshNative(capture), "u04-sql-execution-evidence-v1").envelope);
      review.captureEnvelopeDigest = bundle.captureEnvelope.digest;
    }
    bundle.reviewEnvelope = clone(createShadowNodeJsonByteEnvelope(review, "u04-sql-execution-evidence-v1").envelope);
    expect(() => parsedSqlBundle(bundle)).toThrow("Invalid shadow comparison record.");
  });

  it("rejects a newly valid replacement capture still paired with the review of the prior capture", () => {
    const bundle = sqlBundleFixture();
    const replacement = sqlFixture(); replacement.target.projectRef = "other-synthetic-project";
    bundle.captureEnvelope = clone(createShadowNodeJsonByteEnvelope(refreshNative(replacement), "u04-sql-execution-evidence-v1").envelope);
    expect(() => parsedSqlBundle(bundle)).toThrow("Invalid shadow comparison record.");
  });

  it("rejects wrong domains/kinds and noncanonical review/bundle bytes", () => {
    const bundle = sqlBundleFixture();
    const review = sqlReviewFixture(bundle.captureEnvelope.digest);
    expect(() => parseShadowSqlEnvironmentReviewEnvelope(createShadowNodeJsonByteEnvelope(review, "plan").envelope)).toThrow();
    expect(() => parseShadowSqlEnvironmentBundleEnvelope(createShadowNodeJsonByteEnvelope(bundle, "u04-execution-profile-v1").envelope)).toThrow();
    expect(() => parseShadowSqlEnvironmentReviewEnvelope(bundle.captureEnvelope)).toThrow("Invalid shadow comparison record.");
    expect(() => parseShadowSqlEnvironmentBundleEnvelope(bundle.reviewEnvelope)).toThrow("Invalid shadow comparison record.");
    bundle.reviewEnvelope = { ...rawEnvelope(JSON.stringify(review), "u04-sql-execution-evidence-v1"), version: 1 };
    expect(() => parsedSqlBundle(bundle)).toThrow("Invalid shadow comparison record.");
    expect(() => parseShadowSqlEnvironmentBundleEnvelope(rawEnvelope(JSON.stringify(sqlBundleFixture()), "u04-sql-execution-evidence-v1")))
      .toThrow("Invalid shadow comparison record.");
  });
});

function conformingProfileCapture(): SqlFixture {
  const capture = sqlFixture();
  capture.collations[0]!.observedProviderVersion = capture.collations[0]!.declaredProviderVersion;
  for (const binding of capture.deadlineConfiguration.bindings) {
    binding.statementTimeout.effectiveMs = 15000;
    binding.lockTimeout.effectiveMs = 1000;
  }
  for (const operation of capture.operations) {
    operation.settings.find((entry) => entry.name === "statement_timeout")!.effectiveText = "15000";
    operation.settings.find((entry) => entry.name === "lock_timeout")!.effectiveText = "1000";
  }
  return refreshNative(capture);
}
function profileSqlEnvelope(capture: SqlFixture, reviewFault?: "unsatisfied" | "unavailable", nativeCaptureEncoding: "utf8" | "base64" = "utf8") {
  refreshNative(capture);
  if (nativeCaptureEncoding === "base64") capture.nativeCapture = retainedFixture(Buffer.from(capture.nativeCapture.content, "utf8"));
  const captureEnvelope = createShadowNodeJsonByteEnvelope(capture, "u04-sql-execution-evidence-v1").envelope;
  const review = sqlReviewFixture(captureEnvelope.digest);
  review.evidenceMode = capture.evidenceMode;
  for (const entry of review.coverage) {
    entry.outcome = "satisfied";
    entry.findings = ["Complete synthetic intrinsic fixture; external admission remains separate."];
  }
  if (reviewFault) review.coverage[0]!.outcome = reviewFault;
  const reviewEnvelope = createShadowNodeJsonByteEnvelope(review, "u04-sql-execution-evidence-v1").envelope;
  return clone(createShadowNodeJsonByteEnvelope({ kind: "u04-reviewed-sql-environment-v1", evidenceMode: capture.evidenceMode,
    captureEnvelope, reviewEnvelope }, "u04-sql-execution-evidence-v1").envelope);
}
function profileFixture(nativeCaptureEncoding: "utf8" | "base64" = "utf8"): Mutable<ShadowExecutionProfilePayload> {
  const capture = conformingProfileCapture();
  const digest = retainedFixture("synthetic policy reference").digest;
  return {
    kind: "u04-execution-profile-v1", evidenceMode: "mocked", target: { projectRef: capture.target.projectRef },
    access: { mode: "owner", ownerId: "00000000-0000-0000-0000-000000000099", includePublic: false },
    documentIds: ["00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002"],
    manualAliasIds: ["00000000-0000-0000-0000-000000000011", "00000000-0000-0000-0000-000000000012"],
    manualAliasReviews: [11,12].map((id)=>manualReviewFixture(capture.target.projectRef,`00000000-0000-0000-0000-${String(id).padStart(12,"0")}`).review),
    sourcePolicyVersion: "reviewed-policy-v1", documentOwnedPolicies: [{
      documentId: "00000000-0000-0000-0000-000000000001", ownerId: null, contentHash: digest,
      sourcePolicyVersion: "reviewed-policy-v1", policyArtifact: { digest, retainedEnvelopeDigest: digest },
      reviewArtifact: { digest, retainedEnvelopeDigest: digest },
    }], rolloutMode: "shadow", rolloutVersion: "synthetic-rollout-v1", providerMode: "openai",
    comparisonClock: "2024-02-29T23:59:59.123Z",
    configuration: clone(createShadowNodeJsonByteEnvelope(configFixture(), "u04-engine-config-v1").envelope),
    cases: clone(createShadowNodeJsonByteEnvelope(prepareShadowComparisonCasePayload(selectedFixture()), "u04-evaluation-cases-v1").envelope),
    implementation: clone(capture.implementation),
    providerPolicy: { requestTimeoutMs: 45000, answerTimeoutMs: 55000, embeddingMaxRetries: 2, generationMaxRetries: 0,
      promptCacheRetention: "in_memory", promptCacheTtl: null, storeResponses: false,
      routeBudgetMs: { unsupported: 0, extractive: 12000, fast: 25000, strong: 35000 },
      generationRecoveryReserveMs: 2000, minimumGenerationRetryMs: 20000 },
    sql: { environment: profileSqlEnvelope(capture, undefined, nativeCaptureEncoding) },
    limits: { serverRequestDeadlineMs: 15000, lockTimeoutMs: 1000, clientTotalDeadlineMs: 20000,
      maxMembers: 2, maxCapturedRows: 250000, maxOriginBundleBytes: 268435456, maxAppendRows: 2000, maxAppendBytes: 16777216 },
  };
}
function parsedProfile(payload: unknown) {
  return parseShadowExecutionProfileEnvelope(createShadowNodeJsonByteEnvelope(payload, "u04-execution-profile-v1").envelope);
}

describe("U04 enclosing execution profile intrinsic schema", () => {
  it("retains the complete profile, original nested bytes and immutable conveniences without admission", () => {
    const input = profileFixture();
    const envelope = createShadowNodeJsonByteEnvelope(input, "u04-execution-profile-v1").envelope;
    const parsed = parseShadowExecutionProfileEnvelope(envelope);
    expect(parsed.kind).toBe("shadow-execution-profile-schema-only");
    expect(parsed.bytes.envelope).toEqual(envelope);
    expect(parsed.payload).toEqual(input);
    expect(parsed.configuration.bytes.envelope).toEqual(input.configuration);
    expect(parsed.cases.bytes.envelope).toEqual(input.cases);
    expect(parsed.sql.bytes.envelope).toEqual(input.sql.environment);
    expect(parsed.sql.capture.payload).toEqual(conformingProfileCapture());
    expect(parsed.sql.capture.payload.capturedAt).toBe("2024-02-29T23:59:59.123456Z");
    expect(parsed.payload.comparisonClock).toBe("2024-02-29T23:59:59.123Z");
    expect(Object.keys(parsed).sort()).toEqual(["bytes", "cases", "configuration", "kind", "payload", "sql"]);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.payload.documentOwnedPolicies[0]!.policyArtifact)).toBe(true);
    expect(Object.isFrozen(parsed.configuration.payload.generation)).toBe(true);
    expect(Object.isFrozen(parsed.cases.payload.quality)).toBe(true);
    expect(Object.isFrozen(parsed.sql.capture.payload.deadlineConfiguration.bindings[0]!.statementTimeout)).toBe(true);
    input.documentIds.reverse(); input.providerPolicy.requestTimeoutMs = 1;
    expect(parsed.payload.documentIds[0]).toBe("00000000-0000-0000-0000-000000000001");
    expect(parsed.payload.providerPolicy.requestTimeoutMs).toBe(45000);
  });

  it("accepts explicit public access and empty aliases/policy references without inferring captured membership", () => {
    const input = profileFixture();
    input.access = { mode: "public", ownerId: null, includePublic: true };
    input.manualAliasIds = []; input.manualAliasReviews = []; input.documentOwnedPolicies = []; input.rolloutMode = "legacy";
    expect(parsedProfile(input).payload).toEqual(input);
  });

  it("preserves general database UUIDs and explicit synthetic project text outside the real target grammar", () => {
    const input = profileFixture(); const capture = conformingProfileCapture();
    input.target.projectRef = capture.target.projectRef = "Synthetic fixture with spaces";
    input.manualAliasReviews = input.manualAliasIds.map((id)=>manualReviewFixture(input.target.projectRef,id).review);
    input.sql.environment = profileSqlEnvelope(capture);
    input.limits.maxMembers = 8; input.rolloutMode = "canary";
    expect(parsedProfile(input).payload).toEqual(input);
  });

  it("retains real-shaped classification as schema-only, without manufacturing operational authority", () => {
    const input = profileFixture(); const capture = conformingProfileCapture();
    input.evidenceMode = capture.evidenceMode = "real";
    input.manualAliasIds = []; input.manualAliasReviews = [];
    input.sql.environment = profileSqlEnvelope(capture);
    const result = parsedProfile(input);
    expect(result.kind).toBe("shadow-execution-profile-schema-only");
    expect(result.payload).toEqual(input);
    expect(result.sql.review.payload.evidenceMode).toBe("real");
  });

  it("accepts an explicit offline case set and the positive lock ceiling without changing provider budgets", () => {
    const input = profileFixture(); const capture = conformingProfileCapture();
    const configuration = configFixture(); configuration.generation.providerMode = "offline";
    const selected = selectedFixture(); selected.providerMode = "offline";
    for (const entry of selected.retrieval) entry.forceEmbedding = false;
    input.providerMode = "offline";
    input.configuration = clone(createShadowNodeJsonByteEnvelope(configuration, "u04-engine-config-v1").envelope);
    input.cases = clone(createShadowNodeJsonByteEnvelope(prepareShadowComparisonCasePayload(selected), "u04-evaluation-cases-v1").envelope);
    input.limits.lockTimeoutMs = capture.deadlineConfiguration.policy.lockTimeoutMs = 2000;
    for (const binding of capture.deadlineConfiguration.bindings) binding.lockTimeout.effectiveMs = 2000;
    for (const operation of capture.operations) operation.settings.find((entry) => entry.name === "lock_timeout")!.effectiveText = "2000";
    input.sql.environment = profileSqlEnvelope(capture);
    input.providerPolicy.promptCacheRetention = "24h"; input.providerPolicy.promptCacheTtl = "30m";
    expect(parsedProfile(input).payload).toEqual(input);
  });

  it.each([
    ["kind", (p: Mutable<ShadowExecutionProfilePayload>) => Object.assign(p, { kind: "profile" })],
    ["missing root field", (p: Mutable<ShadowExecutionProfilePayload>) => Reflect.deleteProperty(p, "providerPolicy")],
    ["self binding", (p: Mutable<ShadowExecutionProfilePayload>) => Object.assign(p, { profileDigest: p.configuration.digest })],
    ["origin binding", (p: Mutable<ShadowExecutionProfilePayload>) => Object.assign(p, { origin: "synthetic" })],
    ["target extra", (p: Mutable<ShadowExecutionProfilePayload>) => Object.assign(p.target, { admitted: true })],
    ["access missing owner", (p: Mutable<ShadowExecutionProfilePayload>) => Reflect.deleteProperty(p.access, "ownerId")],
    ["access owner null", (p: Mutable<ShadowExecutionProfilePayload>) => Object.assign(p.access, { ownerId: null })],
    ["access public owner", (p: Mutable<ShadowExecutionProfilePayload>) => Object.assign(p.access, { mode: "public", includePublic: true })],
    ["access public exclusion", (p: Mutable<ShadowExecutionProfilePayload>) => Object.assign(p.access, { mode: "public", ownerId: null })],
    ["access mode", (p: Mutable<ShadowExecutionProfilePayload>) => Object.assign(p.access, { mode: "all" })],
    ["uppercase UUID", (p: Mutable<ShadowExecutionProfilePayload>) => { p.documentIds[0] = "ABCDEF00-0000-0000-0000-000000000001"; }],
    ["UUID trailing newline", (p: Mutable<ShadowExecutionProfilePayload>) => { p.documentIds[0] += "\n"; }],
    ["empty members", (p: Mutable<ShadowExecutionProfilePayload>) => { p.documentIds = []; }],
    ["duplicate members", (p: Mutable<ShadowExecutionProfilePayload>) => { p.documentIds[1] = p.documentIds[0]!; }],
    ["reordered members", (p: Mutable<ShadowExecutionProfilePayload>) => p.documentIds.reverse()],
    ["member ceiling", (p: Mutable<ShadowExecutionProfilePayload>) => { p.limits.maxMembers = 1; }],
    ["missing aliases", (p: Mutable<ShadowExecutionProfilePayload>) => Reflect.deleteProperty(p, "manualAliasIds")],
    ["duplicate aliases", (p: Mutable<ShadowExecutionProfilePayload>) => { p.manualAliasIds[1] = p.manualAliasIds[0]!; }],
    ["reordered aliases", (p: Mutable<ShadowExecutionProfilePayload>) => p.manualAliasIds.reverse()],
    ["invalid alias", (p: Mutable<ShadowExecutionProfilePayload>) => { p.manualAliasIds[0] = "alias"; }],
    ["duplicate policies", (p: Mutable<ShadowExecutionProfilePayload>) => p.documentOwnedPolicies.push(clone(p.documentOwnedPolicies[0]!))],
    ["reordered policies", (p: Mutable<ShadowExecutionProfilePayload>) => p.documentOwnedPolicies.unshift({ ...clone(p.documentOwnedPolicies[0]!), documentId: p.documentIds[1]! })],
    ["foreign policy", (p: Mutable<ShadowExecutionProfilePayload>) => { p.documentOwnedPolicies[0]!.documentId = p.manualAliasIds[0]!; }],
    ["policy version", (p: Mutable<ShadowExecutionProfilePayload>) => { p.documentOwnedPolicies[0]!.sourcePolicyVersion = "other"; }],
    ["policy short hash", (p: Mutable<ShadowExecutionProfilePayload>) => { p.documentOwnedPolicies[0]!.contentHash = "abc123"; }],
    ["policy short reference", (p: Mutable<ShadowExecutionProfilePayload>) => { p.documentOwnedPolicies[0]!.policyArtifact.retainedEnvelopeDigest = "abc123"; }],
    ["missing review reference", (p: Mutable<ShadowExecutionProfilePayload>) => Reflect.deleteProperty(p.documentOwnedPolicies[0]!.reviewArtifact, "digest")],
    ["policy extra field", (p: Mutable<ShadowExecutionProfilePayload>) => Object.assign(p.documentOwnedPolicies[0]!, { approved: true })],
    ["rollout mode", (p: Mutable<ShadowExecutionProfilePayload>) => Object.assign(p, { rolloutMode: "enabled" })],
    ["provider auto", (p: Mutable<ShadowExecutionProfilePayload>) => Object.assign(p, { providerMode: "auto" })],
    ["source blank version", (p: Mutable<ShadowExecutionProfilePayload>) => { p.sourcePolicyVersion = " "; }],
    ["rollout padded version", (p: Mutable<ShadowExecutionProfilePayload>) => { p.rolloutVersion = " version"; }],
    ["rollout oversized version", (p: Mutable<ShadowExecutionProfilePayload>) => { p.rolloutVersion = "v".repeat(101); }],
    ["clock microseconds", (p: Mutable<ShadowExecutionProfilePayload>) => { p.comparisonClock = "2024-02-29T23:59:59.123456Z"; }],
    ["clock invalid calendar", (p: Mutable<ShadowExecutionProfilePayload>) => { p.comparisonClock = "2023-02-29T23:59:59.123Z"; }],
    ["clock offset", (p: Mutable<ShadowExecutionProfilePayload>) => { p.comparisonClock = "2024-02-29T23:59:59.123+00:00"; }],
    ["empty implementation", (p: Mutable<ShadowExecutionProfilePayload>) => { p.implementation.files = []; }],
    ["duplicate implementation", (p: Mutable<ShadowExecutionProfilePayload>) => p.implementation.files.push(clone(p.implementation.files.at(-1)!))],
    ["reordered implementation", (p: Mutable<ShadowExecutionProfilePayload>) => p.implementation.files.reverse()],
    ["short implementation digest", (p: Mutable<ShadowExecutionProfilePayload>) => { p.implementation.files[0]!.digest = "abc123"; }],
    ["unsafe implementation path", (p: Mutable<ShadowExecutionProfilePayload>) => { p.implementation.files[0]!.path = "../outside.ts"; }],
    ["implementation revision mismatch", (p: Mutable<ShadowExecutionProfilePayload>) => { p.implementation.revision = "b".repeat(40); }],
    ["implementation digest mismatch", (p: Mutable<ShadowExecutionProfilePayload>) => { p.implementation.files[0]!.digest = `sha256:${"b".repeat(64)}`; }],
    ["implementation subset", (p: Mutable<ShadowExecutionProfilePayload>) => p.implementation.files.pop()],
    ["root evidence mismatch", (p: Mutable<ShadowExecutionProfilePayload>) => { p.evidenceMode = "real"; }],
    ["target mismatch", (p: Mutable<ShadowExecutionProfilePayload>) => { p.target.projectRef = "other-synthetic"; }],
    ["configuration fingerprint", (p: Mutable<ShadowExecutionProfilePayload>) => Object.assign(p, { configuration: "abc123" })],
    ["cases fingerprint", (p: Mutable<ShadowExecutionProfilePayload>) => Object.assign(p, { cases: "abc123" })],
    ["SQL fingerprint", (p: Mutable<ShadowExecutionProfilePayload>) => Object.assign(p.sql, { environment: "abc123" })],
    ["SQL extra copy", (p: Mutable<ShadowExecutionProfilePayload>) => Object.assign(p.sql, { captureDigest: p.sql.environment.digest })],
  ])("rejects strict profile shape or intrinsic relationship: %s", (_name, mutate) => {
    const input = profileFixture();
    (mutate as (p: Mutable<ShadowExecutionProfilePayload>) => unknown)(input);
    expect(() => parsedProfile(input)).toThrow();
  });

  it.each(["", " project", "project ", "p".repeat(101), "https://synthetic.invalid", "postgresql://synthetic", "//synthetic.invalid", "host=synthetic dbname=synthetic"])(
    "rejects malformed or recognized URL/connection project reference with matching nested reference: %s", (reference) => {
      const input = profileFixture(); const capture = conformingProfileCapture();
      input.target.projectRef = capture.target.projectRef = reference;
      input.sql.environment = profileSqlEnvelope(capture);
      expect(() => parsedProfile(input)).toThrow("Invalid shadow comparison record.");
    });

  it.each([
    ["serverRequestDeadlineMs", 14999], ["clientTotalDeadlineMs", 20001], ["lockTimeoutMs", 0], ["lockTimeoutMs", 2001],
    ["maxMembers", 9], ["maxCapturedRows", 250001], ["maxOriginBundleBytes", 268435457],
    ["maxAppendRows", 2001], ["maxAppendBytes", 16777217], ["maxCapturedRows", 0], ["maxAppendRows", 1.5],
  ])("rejects limit %s=%s", (key, value) => {
    const input = profileFixture(); Object.assign(input.limits, { [key]: value });
    expect(() => parsedProfile(input)).toThrow("Invalid shadow comparison record.");
  });

  it.each([
    ["requestTimeoutMs", 0], ["answerTimeoutMs", 1.5], ["embeddingMaxRetries", -1], ["generationMaxRetries", 0.5],
    ["promptCacheRetention", "default"], ["promptCacheTtl", "24h"], ["storeResponses", 1],
    ["generationRecoveryReserveMs", 2001], ["minimumGenerationRetryMs", 19999],
  ])("rejects provider policy %s=%s", (key, value) => {
    const input = profileFixture(); Object.assign(input.providerPolicy, { [key]: value });
    expect(() => parsedProfile(input)).toThrow("Invalid shadow comparison record.");
  });

  it.each(["unsupported", "extractive", "fast", "strong"] as const)("rejects changed fixed provider route budget: %s", (key) => {
    const input = profileFixture(); Object.assign(input.providerPolicy.routeBudgetMs, { [key]: input.providerPolicy.routeBudgetMs[key] + 1 });
    expect(() => parsedProfile(input)).toThrow("Invalid shadow comparison record.");
  });

  it.each(["configuration", "cases"] as const)("rejects independently valid nested provider mismatch: %s", (nested) => {
    const input = profileFixture();
    if (nested === "configuration") {
      const configuration = configFixture(); configuration.generation.providerMode = "offline";
      input.configuration = clone(createShadowNodeJsonByteEnvelope(configuration, "u04-engine-config-v1").envelope);
      expect(parseShadowComparisonConfigEnvelope(input.configuration).payload.generation.providerMode).toBe("offline");
    } else {
      const selected = selectedFixture(); selected.providerMode = "offline";
      for (const entry of selected.retrieval) entry.forceEmbedding = false;
      input.cases = clone(createShadowNodeJsonByteEnvelope(prepareShadowComparisonCasePayload(selected), "u04-evaluation-cases-v1").envelope);
      expect(parseShadowComparisonCaseEnvelope(input.cases, "offline").payload.providerMode).toBe("offline");
    }
    expect(() => parsedProfile(input)).toThrow("Invalid shadow comparison record.");
  });

  it.each(["unsatisfied", "unavailable"] as const)("retains lower-layer %s review but refuses the enclosing root", (outcome) => {
    const input = profileFixture(); input.sql.environment = profileSqlEnvelope(conformingProfileCapture(), outcome);
    const before = clone(input.sql.environment);
    expect(parseShadowSqlEnvironmentBundleEnvelope(input.sql.environment).review.payload.coverage[0]!.outcome).toBe(outcome);
    expect(() => parsedProfile(input)).toThrow("Invalid shadow comparison record.");
    expect(input.sql.environment).toEqual(before);
  });

  it.each(["statement zero", "statement different", "lock zero", "lock different", "policy lock mismatch", "collation conflict"])(
    "retains truthful lower-layer facts but refuses root conformance: %s", (fault) => {
      const input = profileFixture(); const capture = conformingProfileCapture();
      const binding = capture.deadlineConfiguration.bindings.at(-1)!;
      if (fault === "statement zero") binding.statementTimeout.effectiveMs = 0;
      if (fault === "statement different") binding.statementTimeout.effectiveMs = 15001;
      if (fault === "lock zero") binding.lockTimeout.effectiveMs = 0;
      if (fault === "lock different") binding.lockTimeout.effectiveMs = 999;
      if (fault === "policy lock mismatch") capture.deadlineConfiguration.policy.lockTimeoutMs = 999;
      if (fault === "collation conflict") capture.collations[0]!.observedProviderVersion = "conflicting-version";
      input.sql.environment = profileSqlEnvelope(capture);
      expect(parseShadowSqlEnvironmentBundleEnvelope(input.sql.environment).capture.payload).toEqual(capture);
      const before = clone(input.sql.environment);
      expect(() => parsedProfile(input)).toThrow("Invalid shadow comparison record.");
      expect(input.sql.environment).toEqual(before);
    });

  it("rejects a correctly rehashed client budget mismatch through complete nested validation", () => {
    const input = profileFixture(); const capture = conformingProfileCapture();
    Object.assign(capture.deadlineConfiguration.client, { totalDeadlineMs: 19999 });
    input.sql.environment = profileSqlEnvelope(capture);
    expect(() => parsedProfile(input)).toThrow("Invalid shadow comparison record.");
  });

  it("rejects wrong domain, wrong encoding, noncanonical root bytes and caller accessors without invoking them", () => {
    const input = profileFixture();
    expect(() => parseShadowExecutionProfileEnvelope(createShadowNodeJsonByteEnvelope(input, "plan").envelope)).toThrow();
    expect(() => parseShadowExecutionProfileEnvelope(rawEnvelope("{}", "plan", "pg-jsonb-text-v1"))).toThrow();
    expect(() => parseShadowExecutionProfileEnvelope(rawEnvelope(JSON.stringify(input), "u04-execution-profile-v1"))).toThrow("Invalid shadow comparison record.");
    const getter = vi.fn(() => "private payload");
    const envelope = { ...createShadowNodeJsonByteEnvelope(input, "u04-execution-profile-v1").envelope };
    Object.defineProperty(envelope, "canonicalPayload", { enumerable: true, get: getter });
    expect(() => parseShadowExecutionProfileEnvelope(envelope)).toThrow("Invalid shadow envelope bytes.");
    expect(getter).not.toHaveBeenCalled();
  });
});

type InventoryFixture = Mutable<ShadowInventoryManifestPayload>;
// These fixtures prove stored shape/identity only. Actual owner-specific unit-key
// construction, reference resolution and producer/reconciliation facts remain separate.
type InventoryFamilyFixture = InventoryFixture["families"][number]["family"];
type DeclarationFixture = NonNullable<InventoryFixture["families"][number]["groups"][number]["declaration"]>;
type KnownPopulationFixture = Extract<DeclarationFixture["population"], { tag: "known" }>;
const inventoryToken = "00000000-0000-0000-0000-000000000004";
const inventoryD = "00000000-0000-0000-0000-000000000005";
const inventoryUnitId = "00000000-0000-0000-0000-000000000010";
function inventoryReferences(): KnownPopulationFixture["basis"] {
  const digest = retainedFixture("complete synthetic retained reference").digest;
  return [
    { ref: { tag: "origin_row", owner: "node_job", rowId: inventoryUnitId, rowDigest: digest }, path: ["metadata", "", 0, "é"] },
    { ref: { tag: "candidate_row", owner: "chunk", rowId: inventoryUnitId, rowDigest: digest }, path: [] },
    { ref: { tag: "candidate_projection", slot: "generated_labels", itemId: inventoryUnitId, payloadDigest: digest }, path: ["source_chunk_ids", 2] },
    { ref: { tag: "candidate_projection", slot: "producer_aliases", itemId: inventoryUnitId, payloadDigest: digest }, path: ["metadata"] },
    { ref: { tag: "candidate_projection", slot: "summary", itemId: null, payloadDigest: digest }, path: ["sections", 0, "claims", 1] },
    { ref: { tag: "retained_payload", envelopeDigest: digest, representation: "producer_bytes", mediaType: "application/octet-stream", byteLength: 123 }, path: [] },
    { ref: { tag: "private_object", bucket: "synthetic-private", objectPath: "literal/../captured object", objectVersion: " original version ",
      sha256: digest, byteLength: 456, mediaType: "image/png" }, path: ["literal.key", "0", 0] },
  ];
}
function pendingInventoryFixture(): InventoryFixture {
  const families: [InventoryFamilyFixture, string[]][] = [
    ["attempt_control", ["control"]], ["cache_inputs", ["cache"]], ["chunks", ["worker_core"]],
    ["document_metadata", ["projection_aggregate"]], ["embedding_fields", ["worker_core"]], ["generated_labels", ["enrichment"]],
    ["images", ["worker_core"]], ["index_units", ["worker_core", "deep_memory"]], ["memory_cards", ["deep_memory"]],
    ["native_structure", ["worker_native"]], ["pages", ["worker_core"]], ["private_objects", ["private_objects"]],
    ["producer_aliases", ["deep_memory"]], ["quality", ["worker_core"]], ["repair_audit_inputs", ["repair"]],
    ["sections", ["deep_memory"]], ["summary", ["enrichment"]], ["table_facts", ["worker_core"]],
  ];
  return { version: 1, documentId: "00000000-0000-0000-0000-000000000001",
    candidateGenerationId: "00000000-0000-0000-0000-000000000002", jobId: "00000000-0000-0000-0000-000000000003",
    families: families.map(([family, groups]) => ({ family, groups: groups.map((groupKey) => ({
      groupKey: groupKey as InventoryFixture["families"][number]["groups"][number]["groupKey"], state: "pending", declaration: null,
    })) })),
  };
}
function inventoryGroupFixture(input: InventoryFixture, family: InventoryFamilyFixture, index = 0) {
  return input.families.find((entry) => entry.family === family)!.groups[index]!;
}
function inventoryDeclarationFixture(input: InventoryFixture, family: InventoryFamilyFixture, index = 0): DeclarationFixture {
  return inventoryGroupFixture(input, family, index).declaration!;
}
function inventoryKnownFixture(input: InventoryFixture, family: InventoryFamilyFixture, index = 0): KnownPopulationFixture {
  const population = inventoryDeclarationFixture(input, family, index).population;
  if (population.tag !== "known") throw new Error("Expected synthetic known population.");
  return population;
}
function inventoryLimitationFixture(family: InventoryFamilyFixture): Extract<DeclarationFixture["population"], { tag: "unavailable" }>["limitation"] {
  return { version: 1, code: "producer_unavailable", scope: { family, key: "*" }, evidence: inventoryReferences(),
    explanation: " Full synthetic producer limitation retained. ", blocks: ["recovery", "audit_mapping", "recovery"] };
}
function declaredInventoryFixture(): InventoryFixture {
  const input = pendingInventoryFixture();
  for (const family of input.families) {
    for (const group of family.groups) {
      const declaration: DeclarationFixture = {
        firstLeaseToken: inventoryToken, artifactGenerationId: group.groupKey === "deep_memory" ? inventoryD : null,
        producer: { name: `synthetic ${group.groupKey}`, version: " original version ", outputManifestDigest: fixtureEnvelope({ planned: `planned ${group.groupKey}` }).digest },
        outputManifestEnvelope: fixtureEnvelope({ planned: `planned ${group.groupKey}` }),
        population: { tag: "known", expectedUnits: [], basis: inventoryReferences(), reason: "no_units_expected" },
      };
      Object.assign(group, { state: "declared", declaration });
    }
  }
  for (const [family, index, key] of [
    ["index_units", 0, inventoryUnitId], ["index_units", 1, "00000000-0000-0000-0000-000000000020"],
    ["sections", 0, inventoryUnitId], ["generated_labels", 0, inventoryUnitId],
  ] as const) {
    const population = inventoryKnownFixture(input, family, index);
    population.expectedUnits = [{ family, key }]; population.reason = null;
  }
  const pages = inventoryKnownFixture(input, "pages");
  pages.expectedUnits = [{ family: "pages", key: "10" }, { family: "pages", key: "2" }]; pages.reason = null;
  const native = inventoryLimitationFixture("native_structure"); native.code = "native_capability_unknown";
  inventoryDeclarationFixture(input, "native_structure").population = { tag: "unknown", limitation: native };
  for (const family of ["memory_cards", "summary"] as const) {
    inventoryDeclarationFixture(input, family).population = { tag: "unavailable", limitation: inventoryLimitationFixture(family) };
  }
  return input;
}

describe("U04 durable inventory manifest schema", () => {
  it("copies all 18 preclaim families and 19 fixed pending slots without inventing a first token or seal", () => {
    const input = pendingInventoryFixture(); const before = clone(input);
    const result = parseShadowInventoryManifestPayload(input);
    expect(result).toEqual({ kind: "shadow-inventory-manifest-schema-only", payload: before });
    expect(result.payload.families).toHaveLength(18);
    expect(result.payload.families.flatMap((entry) => entry.groups)).toHaveLength(19);
    expect(result.payload.families.every((entry) => entry.groups.every((group) => group.declaration === null))).toBe(true);
    expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(input.families[0]!.groups)).toBe(false);
    expect(Object.isFrozen(result.payload.families[0]!.groups)).toBe(true);
    input.families.pop();
    expect(result.payload).toEqual(before);
  });

  it("preserves complete declarations, original refs, empty bases, unknown and unavailable without semantic authority", () => {
    const input = declaredInventoryFixture(); const before = clone(input);
    const result = parseShadowInventoryManifestPayload(input);
    expect(result.payload).toEqual(before);
    expect(Object.keys(result).sort()).toEqual(["kind", "payload"]);
    expect(Object.isFrozen(result)).toBe(true);
    const group = result.payload.families.find((entry) => entry.family === "pages")!.groups[0]!;
    expect(Object.isFrozen(group.declaration!.producer)).toBe(true);
    expect(Object.isFrozen(group.declaration!.population)).toBe(true);
    if (group.declaration!.population.tag !== "known") throw new Error("Expected known fixture.");
    expect(Object.isFrozen(group.declaration!.population.basis[0]!.path)).toBe(true);
    expect(group.declaration!.population.basis).toEqual(inventoryReferences());
    inventoryDeclarationFixture(input, "pages").producer.name = "changed";
    inventoryKnownFixture(input, "pages").basis[0]!.path.reverse();
    expect(result.payload).toEqual(before);
  });

  it("retains declared core index units while deep-memory remains pending", () => {
    const input = declaredInventoryFixture();
    Object.assign(inventoryGroupFixture(input, "index_units", 1), { state: "pending", declaration: null });
    expect(parseShadowInventoryManifestPayload(input).payload).toEqual(input);
  });

  it.each(["cache_inputs", "repair_audit_inputs"] as const)("represents unknown and unavailable %s without asserting unused status", (family) => {
    const input = declaredInventoryFixture(); const declaration = inventoryDeclarationFixture(input, family);
    declaration.population = { tag: "unknown", limitation: inventoryLimitationFixture(family) };
    expect(parseShadowInventoryManifestPayload(input).payload).toEqual(input);
    declaration.population = { tag: "unavailable", limitation: inventoryLimitationFixture(family) };
    expect(parseShadowInventoryManifestPayload(input).payload).toEqual(input);
  });

  it.each([null, inventoryD])("preserves optional unavailable reserved D=%s without imputing reservation facts", (generation) => {
    const input = declaredInventoryFixture();
    inventoryDeclarationFixture(input, "memory_cards").artifactGenerationId = generation;
    inventoryDeclarationFixture(input, "producer_aliases").producer.version = null;
    expect(parseShadowInventoryManifestPayload(input).payload).toEqual(input);
  });

  it.each([
    ["root version", (p: InventoryFixture) => { p.version = 2; }],
    ["root extra", (p: InventoryFixture) => Object.assign(p, { sealed: true })],
    ["missing job", (p: InventoryFixture) => Reflect.deleteProperty(p, "jobId")],
    ["malformed document", (p: InventoryFixture) => { p.documentId = "document"; }],
    ["uppercase generation", (p: InventoryFixture) => { p.candidateGenerationId = "ABCDEF00-0000-0000-0000-000000000001"; }],
    ["UUID newline", (p: InventoryFixture) => { p.jobId += "\n"; }],
    ["missing family", (p: InventoryFixture) => p.families.pop()],
    ["duplicate family", (p: InventoryFixture) => p.families.push(clone(p.families.at(-1)!))],
    ["reordered families", (p: InventoryFixture) => p.families.reverse()],
    ["unknown family", (p: InventoryFixture) => Object.assign(p.families[0]!, { family: "other" })],
    ["family extra", (p: InventoryFixture) => Object.assign(p.families[0]!, { artifactGenerationId: inventoryD })],
    ["missing deep slot", (p: InventoryFixture) => p.families.find((entry) => entry.family === "index_units")!.groups.pop()],
    ["duplicate slot", (p: InventoryFixture) => p.families[0]!.groups.push(clone(p.families[0]!.groups[0]!))],
    ["reordered slots", (p: InventoryFixture) => p.families.find((entry) => entry.family === "index_units")!.groups.reverse()],
    ["foreign slot", (p: InventoryFixture) => Object.assign(inventoryGroupFixture(p, "chunks"), { groupKey: "deep_memory" })],
    ["unknown slot", (p: InventoryFixture) => Object.assign(inventoryGroupFixture(p, "chunks"), { groupKey: "other" })],
    ["unknown state", (p: InventoryFixture) => Object.assign(inventoryGroupFixture(p, "chunks"), { state: "sealed" })],
    ["pending declaration", (p: InventoryFixture) => Object.assign(inventoryGroupFixture(p, "chunks"), { state: "pending" })],
    ["declared null", (p: InventoryFixture) => Object.assign(inventoryGroupFixture(p, "chunks"), { declaration: null })],
    ["missing declaration", (p: InventoryFixture) => Reflect.deleteProperty(inventoryGroupFixture(p, "chunks"), "declaration")],
    ["declaration extra", (p: InventoryFixture) => Object.assign(inventoryDeclarationFixture(p, "chunks"), { baselineGenerationId: null })],
    ["missing token", (p: InventoryFixture) => Reflect.deleteProperty(inventoryDeclarationFixture(p, "chunks"), "firstLeaseToken")],
    ["mixed token", (p: InventoryFixture) => { inventoryDeclarationFixture(p, "chunks").firstLeaseToken = inventoryD; }],
    ["malformed token", (p: InventoryFixture) => { inventoryDeclarationFixture(p, "chunks").firstLeaseToken = "token"; }],
    ["core D", (p: InventoryFixture) => { inventoryDeclarationFixture(p, "index_units").artifactGenerationId = inventoryD; }],
    ["missing deep D", (p: InventoryFixture) => { inventoryDeclarationFixture(p, "index_units", 1).artifactGenerationId = null; }],
    ["deep D equals C", (p: InventoryFixture) => { inventoryDeclarationFixture(p, "sections").artifactGenerationId = p.candidateGenerationId; }],
    ["mixed deep D", (p: InventoryFixture) => { inventoryDeclarationFixture(p, "memory_cards").artifactGenerationId = inventoryUnitId; }],
    ["empty producer", (p: InventoryFixture) => { inventoryDeclarationFixture(p, "chunks").producer.name = ""; }],
    ["empty producer version", (p: InventoryFixture) => { inventoryDeclarationFixture(p, "chunks").producer.version = ""; }],
    ["short manifest digest", (p: InventoryFixture) => { inventoryDeclarationFixture(p, "chunks").producer.outputManifestDigest = "abcd"; }],
    ["population extra", (p: InventoryFixture) => Object.assign(inventoryKnownFixture(p, "chunks"), { complete: true })],
    ["population tag", (p: InventoryFixture) => Object.assign(inventoryKnownFixture(p, "chunks"), { tag: "empty" })],
    ["nonempty reason", (p: InventoryFixture) => { inventoryKnownFixture(p, "pages").reason = "no_units_expected"; }],
    ["empty null reason", (p: InventoryFixture) => { inventoryKnownFixture(p, "chunks").reason = null; }],
    ["empty missing basis", (p: InventoryFixture) => { inventoryKnownFixture(p, "chunks").basis = []; }],
    ["duplicate unit", (p: InventoryFixture) => inventoryKnownFixture(p, "pages").expectedUnits.push({ family: "pages", key: "2" })],
    ["reordered units", (p: InventoryFixture) => inventoryKnownFixture(p, "pages").expectedUnits.reverse()],
    ["foreign unit family", (p: InventoryFixture) => { inventoryKnownFixture(p, "pages").expectedUnits[0]!.family = "chunks"; }],
    ["unit empty key", (p: InventoryFixture) => { inventoryKnownFixture(p, "pages").expectedUnits[0]!.key = ""; }],
    ["unit extra", (p: InventoryFixture) => Object.assign(inventoryKnownFixture(p, "pages").expectedUnits[0]!, { producer: "other" })],
    ["same unit both producers", (p: InventoryFixture) => { inventoryKnownFixture(p, "index_units", 1).expectedUnits = clone(inventoryKnownFixture(p, "index_units").expectedUnits); }],
    ["unknown core population", (p: InventoryFixture) => { inventoryDeclarationFixture(p, "chunks").population = { tag: "unknown", limitation: inventoryLimitationFixture("chunks") }; }],
    ["wrong limitation family", (p: InventoryFixture) => { const population = inventoryDeclarationFixture(p, "summary").population; if (population.tag === "unavailable") population.limitation.scope.family = "chunks"; }],
    ["unavailable false reason", (p: InventoryFixture) => { const population = inventoryDeclarationFixture(p, "summary").population; if (population.tag === "unavailable") population.limitation.code = "no_units_expected"; }],
    ["unknown limitation code", (p: InventoryFixture) => { const population = inventoryDeclarationFixture(p, "summary").population; if (population.tag === "unavailable") Object.assign(population.limitation, { code: "other" }); }],
    ["unknown capability", (p: InventoryFixture) => { const population = inventoryDeclarationFixture(p, "summary").population; if (population.tag === "unavailable") Object.assign(population.limitation, { blocks: ["approved"] }); }],
    ["empty explanation", (p: InventoryFixture) => { const population = inventoryDeclarationFixture(p, "summary").population; if (population.tag === "unavailable") population.limitation.explanation = ""; }],
    ["unsafe path integer", (p: InventoryFixture) => { inventoryKnownFixture(p, "chunks").basis[0]!.path = [9007199254740992]; }],
    ["fractional path integer", (p: InventoryFixture) => { inventoryKnownFixture(p, "chunks").basis[0]!.path = [1.5]; }],
    ["negative zero path", (p: InventoryFixture) => { inventoryKnownFixture(p, "chunks").basis[0]!.path = [-0]; }],
    ["unpaired UTF8 string", (p: InventoryFixture) => { inventoryKnownFixture(p, "chunks").basis[0]!.path = ["\ud800"]; }],
    ["pointer extra", (p: InventoryFixture) => Object.assign(inventoryKnownFixture(p, "chunks").basis[0]!, { resolve: true })],
    ["reference tag", (p: InventoryFixture) => Object.assign(inventoryKnownFixture(p, "chunks").basis[0]!.ref, { tag: "url" })],
    ["origin owner", (p: InventoryFixture) => Object.assign(inventoryKnownFixture(p, "chunks").basis[0]!.ref, { owner: "other" })],
    ["candidate forbidden owner", (p: InventoryFixture) => Object.assign(inventoryKnownFixture(p, "chunks").basis[1]!.ref, { owner: "summary" })],
    ["row short digest", (p: InventoryFixture) => Object.assign(inventoryKnownFixture(p, "chunks").basis[1]!.ref, { rowDigest: "abcd" })],
    ["label null item", (p: InventoryFixture) => Object.assign(inventoryKnownFixture(p, "chunks").basis[2]!.ref, { itemId: null })],
    ["alias null item", (p: InventoryFixture) => Object.assign(inventoryKnownFixture(p, "chunks").basis[3]!.ref, { itemId: null })],
    ["singleton projection item", (p: InventoryFixture) => Object.assign(inventoryKnownFixture(p, "chunks").basis[4]!.ref, { itemId: inventoryUnitId })],
    ["unknown projection", (p: InventoryFixture) => Object.assign(inventoryKnownFixture(p, "chunks").basis[4]!.ref, { slot: "document_metadata" })],
    ["payload representation", (p: InventoryFixture) => Object.assign(inventoryKnownFixture(p, "chunks").basis[5]!.ref, { representation: "file" })],
    ["unsafe byte length", (p: InventoryFixture) => Object.assign(inventoryKnownFixture(p, "chunks").basis[5]!.ref, { byteLength: 9007199254740992 })],
    ["empty object path", (p: InventoryFixture) => Object.assign(inventoryKnownFixture(p, "chunks").basis[6]!.ref, { objectPath: "" })],
    ["object extra", (p: InventoryFixture) => Object.assign(inventoryKnownFixture(p, "chunks").basis[6]!.ref, { signedUrl: "unused" })],
  ])("rejects invalid inventory shape or intrinsic relationship: %s", (_name, mutate) => {
    const input = declaredInventoryFixture();
    (mutate as (p: InventoryFixture) => unknown)(input);
    expect(() => parseShadowInventoryManifestPayload(input)).toThrow("Invalid shadow comparison record.");
  });

  it.each(["chunks", "document_metadata", "private_objects", "attempt_control"] as const)("rejects unavailable required slot in %s", (family) => {
    const input = declaredInventoryFixture();
    inventoryDeclarationFixture(input, family).population = { tag: "unavailable", limitation: inventoryLimitationFixture(family) };
    expect(() => parseShadowInventoryManifestPayload(input)).toThrow("Invalid shadow comparison record.");
  });

  it.each(["producer_failed", "producer_skipped", "producer_unavailable"] as const)("retains optional producer failure reason %s", (code) => {
    const input = declaredInventoryFixture(); const limitation = inventoryLimitationFixture("native_structure"); limitation.code = code;
    inventoryDeclarationFixture(input, "native_structure").population = { tag: "unavailable", limitation };
    expect(parseShadowInventoryManifestPayload(input).payload).toEqual(input);
  });

  it("rejects accessors, hooks and proxies without invocation or caller freezing", () => {
    const input = declaredInventoryFixture(); const getter = vi.fn(() => "private fixture");
    Object.defineProperty(inventoryDeclarationFixture(input, "chunks").producer, "name", { enumerable: true, get: getter });
    expect(() => parseShadowInventoryManifestPayload(input)).toThrow("Invalid shadow comparison record.");
    expect(getter).not.toHaveBeenCalled(); expect(Object.isFrozen(input)).toBe(false);
    const hook = vi.fn(); const hooked = Object.assign(pendingInventoryFixture(), { toJSON: hook });
    expect(() => parseShadowInventoryManifestPayload(hooked)).toThrow("Invalid shadow comparison record.");
    expect(hook).not.toHaveBeenCalled();
    const trap = vi.fn(() => { throw new Error("Must not invoke proxy."); });
    expect(() => parseShadowInventoryManifestPayload(new Proxy(pendingInventoryFixture(), { ownKeys: trap }))).toThrow("Invalid shadow comparison record.");
    expect(trap).not.toHaveBeenCalled();
  });

  it.each(["families", "groups", "units", "basis", "path"])("rejects array holes in %s", (location) => {
    const input = declaredInventoryFixture();
    const array = location === "families" ? input.families : location === "groups" ? input.families[0]!.groups :
      location === "units" ? inventoryKnownFixture(input, "pages").expectedUnits : location === "basis" ?
        inventoryKnownFixture(input, "chunks").basis : inventoryKnownFixture(input, "chunks").basis[0]!.path;
    Reflect.deleteProperty(array, "0");
    expect(() => parseShadowInventoryManifestPayload(input)).toThrow("Invalid shadow comparison record.");
  });
});

// Complete synthetic SQL rows and reviewed inputs. No application client or actual engine is invoked.
type AuditFixtureJson = null | boolean | number | string | AuditFixtureJson[] | { [key: string]: AuditFixtureJson };
type AuditFixtureObject = { [key: string]: AuditFixtureJson };
type AuditFixtureOptions = {
  nativeCaptureEncoding?: "base64";
  captureTime?: string;
  capturedHistory?: { rows: Record<string, ReturnType<typeof fixtureEnvelope>[]>; retainedEvidence: Array<{ tag: string; [key: string]: unknown }> };
  historicalNull?: boolean;
  manualAlias?: boolean;
  baselineNull?: boolean;
  nullChunk?: boolean;
  duplicateCase?: boolean;
  tableFact?: boolean;
  tableFactOwner?: string | null;
  documentFileSizeToken?: string;
  editCatalogue?: (version: AuditFixtureObject, event: AuditFixtureObject) => void;
  observedEmbeddingModel?: string;
  observedEmbeddingStrategy?: string;
  observedParserVersion?: string;
  capturedBatch?: boolean;
  historicalImage?: { bytes: Buffer; hash: string | null; metadataHash: string | null; extractor: string };
  members?: number; catalogue?: boolean; nonGreen?: boolean; quality?: boolean;
  editDocument?: (value: AuditFixtureObject) => void;
  editExpected?: (value: AuditFixtureObject) => void;
  editMeasured?: (value: AuditFixtureObject) => void;
  editApproval?: (value: AuditFixtureObject) => void;
  editCases?: (value: AuditFixtureObject) => void;
  identityUuid?: (ordinal: number) => string;
};
const auditFixtureUuid = (ordinal: number) => `00000000-0000-0000-0000-${String(ordinal).padStart(12, "0")}`;
const auditFixtureV4Uuid = (ordinal: number) => `00000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`;
const auditFixtureTime = "2024-02-29T23:59:59.123456Z";
function fixtureSha(value: string | Buffer) { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function fixtureEnvelope(value: unknown, domain: ShadowEnvelopeDomain = "u04-retained-evidence-v1", encoding: ShadowEnvelopeEncoding = "node-json-v1") {
  return { ...rawEnvelope(encoding === "node-json-v1" ? encodeShadowNodeJsonCanonicalPayload(value) : JSON.stringify(value), domain, encoding), version: 1 as const };
}
function fixturePg(value: AuditFixtureJson): string {
  if (Array.isArray(value)) return `[${value.map(fixturePg).join(", ")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort((a, b) => Buffer.byteLength(a) - Buffer.byteLength(b) || Buffer.compare(Buffer.from(a), Buffer.from(b)))
      .map((key) => `${JSON.stringify(key)}: ${fixturePg(value[key]!)}`).join(", ")}}`;
  }
  return JSON.stringify(value);
}

function qualityProjectionFixture() {
  const fixture = auditConsumerFixture();
  const binding = { tag: "candidate", source: fixture.memberPayloads[0]!.source,
    candidateGenerationId: auditFixtureUuid(700), jobId: auditFixtureUuid(701),
    firstLeaseToken: auditFixtureUuid(702), artifactGenerationId: null };
  const metrics: AuditFixtureObject = {
    page_count: 0, ocr_page_count: 0, needs_ocr_page_count: 0, text_character_count: 0,
    extracted_image_count: 0, searchable_image_count: 0, skipped_image_count: 0, section_count: 0, memory_card_count: 0,
    avg_chunk_length: 0, duplicate_chunk_ratio: 0, heading_density: 0, section_path_coverage: 0, ocr_coverage: 0,
    average_page_text_chars: 0, table_extraction_coverage: null, searchable_image_coverage: null, visual_unit_coverage: null,
    average_image_quality_score: null, average_crop_completeness: null, average_structured_visual_confidence: null,
    skipped_image_reasons: {}, image_type_counts: {}, extraction_warnings: ["No extracted text"],
    document_embedding_field_types: [], optional_index_write_issues: [{ stage: "embedding", message: "Synthetic failure", code: null }],
    search_eval_hit_rate: null,
  };
  const native: AuditFixtureObject = { document_id: binding.source.documentId!, owner_id: binding.source.ownerId!,
    quality_score: 0, extraction_quality: "poor", issues: ["No extracted text"], metrics, updated_at: auditFixtureTime };
  const payload = { kind: "u04-quality-projection-v1", binding, outputManifestEnvelope: fixtureEnvelope({
    producer: "local-worker", producerVersion: "rag-deep-memory-v1", binding,
    units: [{ family: "quality", key: "singleton", output: native }] }), quality: { ...native,
    anchor_coverage: null, model_fallback_rate: null, noisy_unit_rate: null, retrievable_visual_hit: null,
    source_span_coverage: null, typed_unit_coverage: null } as AuditFixtureObject };
  const sources = { pages: [] as ReturnType<typeof fixtureEnvelope>[], images: [], sections: [], cards: [], embeddingFields: [] };
  const rebind = () => { payload.outputManifestEnvelope = fixtureEnvelope({ producer: "local-worker", producerVersion: "rag-deep-memory-v1",
    binding, units: [{ family: "quality", key: "singleton", output: native }] }); };
  const read = () => readShadowQualityProjectionV1(fixtureEnvelope(payload, "projection", "pg-jsonb-text-v1"), binding, sources);
  return { fixture, binding, native, metrics, payload, sources, rebind, read };
}

describe("U04 quality projection reconciliation", () => {
  it.each(["same instant", "changed instant"])("reconciles PostgreSQL timestamp rendering: %s", fault => {
    const f = qualityProjectionFixture();
    f.payload.quality.updated_at = fault === "same instant" ? "2024-02-29T23:59:59.123456+00:00" : "2024-02-29T23:59:59.123457+00:00";
    if (fault === "same instant") {
      expect(f.read().payload.quality.updated_at).toBe(f.payload.quality.updated_at);
      expect(f.payload.outputManifestEnvelope.canonicalPayload).toContain(auditFixtureTime);
    } else expect(f.read).toThrow();
  });

  it("retains poor extraction evidence, nullable stored columns and optional issue presence", () => {
    const f = qualityProjectionFixture();
    const result = f.read();
    expect(result.kind).toBe("shadow-quality-component-validated");
    expect(result.payload.quality).toEqual(f.payload.quality);
    expect(Object.isFrozen(result.payload.quality)).toBe(true);
    delete (f.metrics.optional_index_write_issues as AuditFixtureObject[])[0]!.code;
    f.rebind();
    expect(f.read().payload.quality.metrics).toEqual(f.metrics);
  });

  it.each(["changed original", "foreign owner", "invented optional metric", "missing nullable column", "unknown metric", "nonfinite count",
    "fractional count", "invalid ratio", "invented evaluation score", "missing page", "missing fields", "OCR beyond pages"])("refuses %s even with a valid outer digest", fault => {
    const f = qualityProjectionFixture();
    if (fault === "changed original") f.payload.quality.quality_score = 0.75;
    if (fault === "foreign owner") { f.native.owner_id = auditFixtureUuid(999); f.payload.quality.owner_id = f.native.owner_id; }
    if (fault === "invented optional metric") f.payload.quality.source_span_coverage = 1;
    if (fault === "missing nullable column") delete f.payload.quality.source_span_coverage;
    if (fault === "unknown metric") f.metrics.unreviewed_score = 1;
    if (fault === "nonfinite count") f.metrics.page_count = 1e309;
    if (fault === "fractional count") f.metrics.page_count = 0.5;
    if (fault === "invalid ratio") f.metrics.heading_density = 1.01;
    if (fault === "invented evaluation score") f.metrics.search_eval_hit_rate = 1;
    if (fault === "missing page") f.metrics.page_count = 1;
    if (fault === "missing fields") f.metrics.document_embedding_field_types = ["document_summary"];
    if (fault === "OCR beyond pages") f.metrics.ocr_page_count = 1;
    if (fault !== "nonfinite count") f.rebind();
    expect(f.read).toThrow();
  });

  it.each(["valid", "foreign generation", "foreign lease", "duplicate row"])("checks full page evidence: %s", fault => {
    const f = qualityProjectionFixture();
    const page = { ...f.fixture.data[0]!.page, index_generation_id: fault === "foreign generation" ? auditFixtureUuid(999) : f.binding.candidateGenerationId,
      metadata: { index_generation_id: f.binding.candidateGenerationId, ingestion_job_kind: "node", ingestion_job_id: f.binding.jobId,
        ingestion_lease_token: fault === "foreign lease" ? auditFixtureUuid(999) : f.binding.firstLeaseToken } };
    f.sources.pages.push(fixtureEnvelope(page, "baseline", "pg-jsonb-text-v1"));
    if (fault === "duplicate row") f.sources.pages.push(f.sources.pages[0]!);
    f.metrics.page_count = f.sources.pages.length;
    f.rebind();
    if (fault === "valid") expect(f.read().kind).toBe("shadow-quality-component-validated");
    else expect(f.read).toThrow();
  });
});

function workerProjectionFixture() {
  const quality = qualityProjectionFixture();
  const pageBase=quality.fixture.data[0]!.page as AuditFixtureObject;
  const chunkBase=quality.fixture.data[0]!.chunk as AuditFixtureObject;
  const page:AuditFixtureObject = { ...pageBase, index_generation_id: quality.binding.candidateGenerationId,
    metadata: { index_generation_id: quality.binding.candidateGenerationId, ingestion_job_kind: "node",
      ingestion_job_id: quality.binding.jobId, ingestion_lease_token: quality.binding.firstLeaseToken } };
  const chunk:AuditFixtureObject = { ...chunkBase, index_generation_id: quality.binding.candidateGenerationId,
    metadata: { ...(chunkBase.metadata as AuditFixtureObject), index_generation_id: quality.binding.candidateGenerationId,
      ingestion_job_kind: "node", ingestion_job_id: quality.binding.jobId,
      ingestion_lease_token: quality.binding.firstLeaseToken } };
  const pageEnvelope = fixtureEnvelope(page, "baseline", "pg-jsonb-text-v1");
  const chunkEnvelope = fixtureEnvelope(chunk, "baseline", "pg-jsonb-text-v1");
  quality.sources.pages.push(pageEnvelope);
  Object.assign(quality.metrics, { page_count: 1, text_character_count: String(page.text).length,
    avg_chunk_length: String(chunk.content).length, average_page_text_chars: String(page.text).length });
  quality.rebind();
  const shadowExtraction: AuditFixtureObject = {
    version: 1, extractor: "docling", mode: "shadow", index_generation_id: quality.binding.candidateGenerationId,
    cohort_percent: 5, cohort_bucket: 2, cohort_signals: ["ocr"], outcome: "runtime_unavailable",
    error_kind: "ENOENT", measured_at: auditFixtureTime, docling_version: null, wall_ms: 5.25,
    peak_rss_bytes: null, exit_code: 20, docling: null,
    legacy: { page_count: 1, text_character_count: String(page.text).length, ocr_page_count: 0,
      table_count: 0, table_row_count: 0, numeric_token_count: 0, wall_ms: null },
    delta: null,
  };
  const metadata: AuditFixtureObject = {
    indexed_at: auditFixtureTime, index_generation_id: quality.binding.candidateGenerationId, cover_image_id: null,
    rag_enrichment_version: "rag-deep-memory-v1", rag_indexing_version: "rag-deep-memory-v1",
    rag_memory_version: "rag-deep-memory-v1", rag_memory_updated_at: null, rag_enrichment_updated_at: null,
    enrichment_status: "pending", enrichment_error: "Optional index artifact writes failed; queued for indexing-v3-agent repair.",
    section_count: 0, memory_card_count: 0,
    extraction_quality: quality.native.extraction_quality!, index_quality_score: quality.native.quality_score!,
    index_quality_issues: quality.native.issues!, index_quality_metrics: quality.metrics,
    optional_index_write_issues: quality.metrics.optional_index_write_issues!, indexing_v3_agent_status: "pending",
    indexing_v3_agent_last_error: "Optional index artifact writes failed; queued for indexing-v3-agent repair.",
    indexing_v3_agent_repair_reason: "optional_index_write_issues", indexing_v3_agent_updated_at: auditFixtureTime,
    embedding_model: "text-embedding-3-small", page_count: 1, ocr_page_count: 0, needs_ocr_page_count: 0,
    text_character_count: quality.metrics.text_character_count!, extracted_image_count: 0, searchable_image_count: 0,
    skipped_image_count: 0, skipped_image_reasons: {}, image_type_counts: {},
    extraction_warnings: quality.metrics.extraction_warnings!, shadow_extraction: shadowExtraction,
  };
  const counts: AuditFixtureObject = { page_count: 1, chunk_count: 1, image_count: 0, status: "indexed", error_message: null };
  const payload = { kind: "u04-worker-projection-v1", binding: quality.binding, outputManifestEnvelope: fixtureEnvelope({}),
    worker_metadata: metadata, document_counts: counts };
  const profileEnvelope = fixtureEnvelope(quality.fixture.profile, "u04-execution-profile-v1");
  const sources = { ...quality.sources, chunks: [chunkEnvelope] };
  const rebind = () => { payload.outputManifestEnvelope = fixtureEnvelope({ producer: "local-worker",
    producerVersion: "rag-deep-memory-v1", binding: quality.binding,
    units: [{ family: "document_metadata", key: "singleton", output: { worker_metadata: metadata, document_counts: counts } }] }); };
  rebind();
  const read = () => readShadowWorkerProjectionV1(fixtureEnvelope(payload, "projection", "pg-jsonb-text-v1"),
    quality.binding, profileEnvelope, fixtureEnvelope(quality.payload, "projection", "pg-jsonb-text-v1"), sources);
  return { quality, metadata, counts, payload, sources, shadowExtraction, rebind, read };
}

describe("U04 worker projection reconciliation", () => {
  it("retains complete worker metadata, explicit nulls, optional extraction evidence and strict C counts", () => {
    const f = workerProjectionFixture();
    const result = f.read();
    expect(result.kind).toBe("shadow-worker-component-validated");
    expect(result.payload.worker_metadata).toEqual(f.metadata);
    expect(result.payload.document_counts).toEqual(f.counts);
    expect(result.quality.kind).toBe("shadow-quality-component-validated");
    expect(result.payload.worker_metadata.cover_image_id).toBeNull();
    expect(result.payload.worker_metadata).not.toHaveProperty("completion_gate_missing");
    expect(Object.isFrozen(result.payload.worker_metadata)).toBe(true);
  });

  it("preserves the producer's absent optional shadow extraction instead of fabricating null", () => {
    const f = workerProjectionFixture();
    delete f.metadata.shadow_extraction;
    f.rebind();
    const result = f.read();
    expect(result.payload.worker_metadata).not.toHaveProperty("shadow_extraction");
  });

  it.each(["changed projection only", "foreign generation", "foreign embedding model", "quality mismatch", "wrong count", "foreign row lease",
    "duplicate chunk", "missing cover image", "foreign extraction generation", "invalid extraction outcome",
    "fabricated completion key", "unknown metadata",
    "fractional metric"] as const)("refuses rebound %s", fault => {
    const f = workerProjectionFixture();
    if (fault === "changed projection only") f.payload.worker_metadata = { ...f.metadata, indexed_at: "2024-02-29T23:59:58.123456Z" };
    if (fault === "foreign generation") f.metadata.index_generation_id = auditFixtureUuid(999);
    if (fault === "foreign embedding model") f.metadata.embedding_model = "different-embedding-model";
    if (fault === "quality mismatch") f.metadata.index_quality_score = 0.5;
    if (fault === "wrong count") f.counts.page_count = 2;
    if (fault === "foreign row lease") {
      const page = JSON.parse(f.sources.pages[0]!.canonicalPayload) as AuditFixtureObject;
      fixtureSet(page, ["metadata", "ingestion_lease_token"], auditFixtureUuid(999));
      f.sources.pages[0] = fixtureEnvelope(page, "baseline", "pg-jsonb-text-v1");
    }
    if (fault === "duplicate chunk") f.sources.chunks.push(f.sources.chunks[0]!);
    if (fault === "missing cover image") f.metadata.cover_image_id = auditFixtureUuid(998);
    if (fault === "foreign extraction generation") f.shadowExtraction.index_generation_id = auditFixtureUuid(997);
    if (fault === "invalid extraction outcome") f.shadowExtraction.outcome = "ok";
    if (fault === "fabricated completion key") f.metadata.completion_gate_missing = null;
    if (fault === "unknown metadata") f.metadata.caller_supplied = "not worker-owned";
    if (fault === "fractional metric") f.metadata.page_count = 1.5;
    f.rebind();
    expect(f.read).toThrow("Invalid shadow comparison record.");
  });
});

function projectionAggregateFixture() {
  const worker = workerProjectionFixture();
  const binding = worker.quality.binding;
  const documentId = binding.source.documentId!;
  const ownerId = binding.source.ownerId!;
  const chunkId = worker.quality.fixture.data[0]!.chunk.id!;
  const artifactGenerationId = auditFixtureUuid(703);
  const componentEnvelope = (value: unknown) => ({ ...rawEnvelope(fixturePg(value as AuditFixtureJson),
    "projection", "pg-jsonb-text-v1"), version: 1 as const });

  const summaryGeneratedAt = "2024-02-29T23:59:59.123Z";
  const summaryText = "- Use the complete synthetic source.";
  const summaryClaim: AuditFixtureObject = { text: "Use the complete synthetic source.", source_chunk_ids: [chunkId],
    source_image_ids: [], pages: [1], evidence_type: "text", support: "direct" };
  const summaryProfile: AuditFixtureObject = { overview: summaryText, applies_to: [], key_clinical_actions: [summaryClaim],
    medication_dose_monitoring: [], thresholds_timing: [], escalation_risk_warnings: [], required_forms_documentation: [],
    not_covered: [], important_tables_images: [], best_questions: [], source_quality_notes: [] };
  const clinicalSpecifics: AuditFixtureObject = { profile: summaryProfile, actions: [summaryClaim.text!], thresholds_timing: [],
    medication_monitoring: [], risk_escalation: [], documentation_forms: [], exceptions_gaps: [] };
  const anchoredSummary: AuditFixtureObject = { summary_kind: "structured", summary_version: "source-anchored-summary-v1",
    document_id: documentId, index_generation_id: binding.candidateGenerationId, model: "synthetic-index",
    model_version: "rag-deep-memory-v1", generated_at: summaryGeneratedAt, source_chunk_ids: [chunkId], source_image_ids: [],
    summary: summaryText, clinical_specifics: clinicalSpecifics, labels: [], heuristic_fallback: false };
  const summaryMetadata: AuditFixtureObject = { generated_by: "local-worker", index_generation_id: binding.candidateGenerationId,
    source_anchored_summary_v1: anchoredSummary, source_anchored_summary_projection_complete_v1: true,
    ingestion_job_kind: "node", ingestion_job_id: binding.jobId, ingestion_lease_token: binding.firstLeaseToken };
  const summary: AuditFixtureObject = { id: auditFixtureUuid(704), document_id: documentId, owner_id: ownerId,
    summary: summaryText, clinical_specifics: clinicalSpecifics, source_chunk_ids: [chunkId], source_image_ids: [],
    model: "synthetic-index", metadata: summaryMetadata, generated_at: summaryGeneratedAt,
    created_at: auditFixtureTime, updated_at: auditFixtureTime };
  const originalSummaryMetadata = { ...summaryMetadata };
  delete originalSummaryMetadata.ingestion_job_kind; delete originalSummaryMetadata.ingestion_job_id;
  delete originalSummaryMetadata.ingestion_lease_token;
  const originalSummary: AuditFixtureObject = { document_id: documentId, owner_id: ownerId, summary: summaryText,
    clinical_specifics: clinicalSpecifics, source_chunk_ids: [chunkId], source_image_ids: [], model: "synthetic-index",
    metadata: originalSummaryMetadata, generated_at: summaryGeneratedAt, updated_at: summaryGeneratedAt };
  const enrichmentMetadata: AuditFixtureObject = { rag_enrichment_version: "rag-deep-memory-v1",
    rag_indexing_version: "rag-deep-memory-v1", rag_memory_version: "rag-deep-memory-v1",
    rag_enrichment_updated_at: summaryGeneratedAt, generated_label_count: 0 };
  const summaryDeclaration = fixtureEnvelope({ producer: "local-worker", producerVersion: "rag-deep-memory-v1", binding,
    units: [{ family: "summary", key: "singleton", output: { summary: originalSummary, enrichment_metadata: enrichmentMetadata } }] });

  const nativeStamp: AuditFixtureObject = { generated_by: "local-worker", artifact_generation_id: artifactGenerationId,
    index_generation_id: artifactGenerationId, ingestion_lease_token: binding.firstLeaseToken };
  const storedStamp: AuditFixtureObject = { ...nativeStamp, index_generation_id: binding.candidateGenerationId,
    ingestion_job_kind: "node", ingestion_job_id: binding.jobId, ingestion_lease_token: binding.firstLeaseToken };
  const nativeSection: AuditFixtureObject = { document_id: documentId, owner_id: ownerId, section_index: 0,
    heading: "Synthetic section", heading_path: ["Synthetic section"], page_start: 1, page_end: 1, chunk_ids: [chunkId],
    summary: "Synthetic section summary.", tags: [], extraction_quality: "good", index_generation_id: artifactGenerationId,
    producer: "local-worker", artifact_generation_id: artifactGenerationId, metadata: nativeStamp };
  const section: AuditFixtureObject = { ...nativeSection, id: auditFixtureUuid(705),
    index_generation_id: binding.candidateGenerationId, metadata: storedStamp,
    created_at: auditFixtureTime, updated_at: auditFixtureTime };
  const embedding = Array.from({ length: 1536 }, (_, index) => index === 0 ? 1 : 0);
  const nativeCard: AuditFixtureObject = { document_id: documentId, owner_id: ownerId, section_id: null,
    card_type: "clinical_fact", title: "Synthetic card", content: "Synthetic evidence card.", normalized_terms: ["synthetic"],
    page_number: 1, source_chunk_ids: [chunkId], source_image_ids: [], confidence: 1,
    index_generation_id: artifactGenerationId, producer: "local-worker", artifact_generation_id: artifactGenerationId,
    metadata: nativeStamp, embedding };
  const card: AuditFixtureObject = { ...nativeCard, id: auditFixtureUuid(706), section_id: section.id!,
    index_generation_id: binding.candidateGenerationId, metadata: storedStamp, embedding: JSON.stringify(embedding),
    search_tsv: "'synthetic':1", created_at: auditFixtureTime, updated_at: auditFixtureTime };
  const sectionEnvelope = fixtureEnvelope(section, "baseline", "pg-jsonb-text-v1");
  const cardEnvelope = fixtureEnvelope(card, "baseline", "pg-jsonb-text-v1");
  (worker.sources.sections as ReturnType<typeof fixtureEnvelope>[]).push(sectionEnvelope);
  (worker.sources.cards as ReturnType<typeof fixtureEnvelope>[]).push(cardEnvelope);
  Object.assign(worker.quality.metrics, { section_count: 1, memory_card_count: 1 });
  Object.assign(worker.metadata, { section_count: 1, memory_card_count: 1 });
  worker.quality.rebind(); worker.rebind();

  const deepBinding = { ...binding, artifactGenerationId };
  const request: AuditFixtureObject = { fence: { job_kind: "node", job_id: binding.jobId, document_id: documentId,
    worker_id: "synthetic-worker", lease_token: binding.firstLeaseToken,
    expected_generation_id: binding.source.baselineGenerationId, authority_digest: binding.source.authorityDigest },
    artifact_generation: artifactGenerationId, rag_memory_version: "rag-deep-memory-v1",
    document_intelligence_version: "document-intelligence-v2", section_count: 1, memory_card_count: 1,
    index_unit_counts_by_type: {}, anchors: [], aliases: [] };
  const modelProfile: AuditFixtureObject = { sections: [], askable_questions: [], clinical_facts: [], table_facts: [], aliases: [],
    quality_issues: [], model: null, version: "model-heavy-index-v1" };
  const deepDeclaration = fixtureEnvelope({ producer: "local-worker", producerVersion: "rag-deep-memory-v1", binding: deepBinding,
    units: [
      { family: "sections", key: "deep:0", output: { nativeInput: nativeSection,
        producerContext: { modelProfile, request } } },
      { family: "memory_cards", key: "deep:0", output: { nativeInput: nativeCard,
        sectionAssociation: { tag: "index", index: 0 } } },
    ] });
  const deepReceipt = componentEnvelope({ kind: "u04-deep-memory-receipt-v1", binding: deepBinding, producer: "local-worker",
    outputManifestEnvelope: deepDeclaration, request,
    rows: { sections: [sectionEnvelope], cards: [cardEnvelope], units: [], aliases: [] }, finalizedAt: auditFixtureTime });
  const deepResult: AuditFixtureObject = { document_id: documentId, producer: "local-worker",
    artifact_generation_id: artifactGenerationId, index_generation_id: binding.candidateGenerationId,
    section_count: 1, memory_card_count: 1, index_unit_count: 0 };
  const deepMetadata: AuditFixtureObject = { rag_indexing_version: "rag-deep-memory-v1", rag_memory_version: "rag-deep-memory-v1",
    rag_memory_updated_at: auditFixtureTime, document_intelligence_version: "document-intelligence-v2",
    document_intelligence_updated_at: auditFixtureTime, section_count: 1, memory_card_count: 1, index_unit_count: 0,
    index_unit_counts_by_type: {}, repaired_anchor_count: 0, deep_memory_generations: { "local-worker": artifactGenerationId },
    deep_memory_commit_receipts: { "local-worker": { request, result: deepResult } } };

  const declarations: AuditFixtureObject = {
    summary: summaryDeclaration,
    quality: worker.quality.payload.outputManifestEnvelope,
    worker: worker.payload.outputManifestEnvelope,
    deep: deepDeclaration,
  };
  const summaryComponent = () => ({ kind: "u04-summary-projection-v1", binding,
    outputManifestEnvelope: declarations.summary, summary: row.summary, generated_labels: row.generated_labels,
    summary_projection_complete: row.summary_projection_complete, enrichment_metadata: row.enrichment_metadata });
  const qualityComponent = () => ({ kind: "u04-quality-projection-v1", binding,
    outputManifestEnvelope: declarations.quality, quality: row.quality });
  const workerComponent = () => ({ kind: "u04-worker-projection-v1", binding,
    outputManifestEnvelope: declarations.worker, worker_metadata: row.worker_metadata, document_counts: row.document_counts });
  const deepComponent = () => ({ kind: "u04-deep-projection-v1", binding: deepBinding,
    outputManifestEnvelope: declarations.deep, deep_memory_receipt: row.deep_memory_receipt,
    deep_memory_metadata: row.deep_memory_metadata, producer_aliases: row.producer_aliases });
  const row: AuditFixtureObject = {
    document_id: documentId, index_generation_id: binding.candidateGenerationId,
    lease_token: binding.firstLeaseToken, owner_id: ownerId,
    summary, generated_labels: [], summary_projection_complete: true, enrichment_metadata: enrichmentMetadata,
    quality: worker.quality.payload.quality, worker_metadata: worker.metadata, document_counts: worker.counts,
    deep_memory_artifact_generation_id: artifactGenerationId, deep_memory_receipt: deepReceipt,
    deep_memory_metadata: deepMetadata, producer_aliases: [],
    summary_digest: null, quality_digest: null, deep_memory_digest: null, worker_state_digest: null, sealed_at: null,
  };
  const rebindDigests = () => {
    row.summary_digest = row.summary === null ? null : componentEnvelope(summaryComponent()).digest;
    row.quality_digest = row.quality === null ? null : componentEnvelope(qualityComponent()).digest;
    row.worker_state_digest = row.worker_metadata === null ? null : componentEnvelope(workerComponent()).digest;
    row.deep_memory_digest = row.deep_memory_receipt === null ? null : componentEnvelope(deepComponent()).digest;
  };
  rebindDigests();
  const profileEnvelope = fixtureEnvelope(worker.quality.fixture.profile, "u04-execution-profile-v1");
  const read = () => readShadowProjectionAggregateV1(componentEnvelope(row), binding, profileEnvelope, declarations, worker.sources);
  const omitOptional = () => {
    declarations.summary = null; row.summary = null; row.generated_labels = null;
    row.summary_projection_complete = null; row.enrichment_metadata = null;
    declarations.deep = null; row.deep_memory_artifact_generation_id = null; row.deep_memory_receipt = null;
    row.deep_memory_metadata = null; row.producer_aliases = null; rebindDigests();
  };
  return { worker, binding, declarations, row, profileEnvelope, componentEnvelope, qualityComponent, workerComponent,
    rebindDigests, omitOptional, read };
}

describe("U04 aggregate projection reconciliation", () => {
  it("reconciles all four complete component envelopes in one private projection", () => {
    const f = projectionAggregateFixture();
    const result = f.read();
    expect(result.kind).toBe("shadow-projection-aggregate-validated");
    expect(result.row).toEqual(f.row);
    expect(result.components.summary?.kind).toBe("shadow-summary-component-validated");
    expect(result.components.quality?.kind).toBe("shadow-quality-component-validated");
    expect(result.components.worker?.kind).toBe("shadow-worker-component-validated");
    expect(result.components.deep?.kind).toBe("shadow-candidate-deep-projection-validated");
    expect(result.row.sealed_at).toBeNull();
    expect(Object.isFrozen(result.components)).toBe(true);
  });

  it("preserves consistently absent optional summary and deep components", () => {
    const f = projectionAggregateFixture(); f.omitOptional();
    const result = f.read();
    expect(result.components.summary).toBeNull(); expect(result.components.deep).toBeNull();
    expect(result.components.quality?.kind).toBe("shadow-quality-component-validated");
    expect(result.components.worker?.kind).toBe("shadow-worker-component-validated");
  });

  it.each(["missing component envelope", "swapped component envelope", "foreign identity", "unexpected nullable companion",
    "unexpected absent declaration", "changed digest", "changed data", "rebound changed data", "worker without quality",
    "fabricated seal timestamp", "invalid profile", "same-count substituted deep row"] as const)
  ("refuses %s", fault => {
    const f = projectionAggregateFixture();
    if (fault === "missing component envelope") f.declarations.worker = null;
    if (fault === "swapped component envelope") {
      const quality = f.declarations.quality; f.declarations.quality = f.declarations.worker!; f.declarations.worker = quality;
    }
    if (fault === "foreign identity") f.row.owner_id = auditFixtureUuid(998);
    if (fault === "unexpected nullable companion") { f.omitOptional(); f.row.summary_projection_complete = false; }
    if (fault === "unexpected absent declaration") { f.omitOptional(); f.declarations.deep = f.declarations.worker!; }
    if (fault === "changed digest") f.row.quality_digest = fixtureSha("substituted component digest");
    if (fault === "changed data" || fault === "rebound changed data")
      (f.row.quality as AuditFixtureObject).quality_score = 0.5;
    if (fault === "rebound changed data") f.rebindDigests();
    if (fault === "worker without quality") {
      f.row.quality = null; f.row.quality_digest = null; f.declarations.quality = null;
    }
    if (fault === "fabricated seal timestamp") f.row.sealed_at = auditFixtureTime;
    if (fault === "invalid profile") {
      f.omitOptional(); f.row.worker_metadata = null; f.row.document_counts = null;
      f.row.worker_state_digest = null; f.declarations.worker = null; f.rebindDigests();
      Object.assign(f.profileEnvelope, fixtureEnvelope({ ...f.worker.quality.fixture.profile,
        comparisonClock: "2024-03-01T00:00:00.000Z" }, "u04-execution-profile-v1"));
    }
    if (fault === "same-count substituted deep row") {
      const sections = f.worker.sources.sections as ReturnType<typeof fixtureEnvelope>[];
      const section = JSON.parse(sections[0]!.canonicalPayload) as AuditFixtureObject;
      section.heading = "Substituted same-count section";
      sections[0] = fixtureEnvelope(section, "baseline", "pg-jsonb-text-v1");
    }
    expect(f.read).toThrow("Invalid shadow comparison record.");
  });
});
function fixtureSet(value: AuditFixtureObject, path: readonly (string | number)[], replacement: AuditFixtureJson) {
  let parent: AuditFixtureJson = value;
  for (const key of path.slice(0, -1)) parent = (parent as AuditFixtureObject)[key]!;
  (parent as AuditFixtureObject)[path.at(-1)!] = replacement;
}
function fixtureGet(value: AuditFixtureObject, path: readonly (string | number)[]): AuditFixtureJson {
  let current: AuditFixtureJson = value;
  for (const key of path) current = (current as AuditFixtureObject)[key]!;
  return current;
}
function fixtureRowPointer(envelope: ReturnType<typeof fixtureEnvelope>, owner: string, rowId: string, path: (string | number)[] = []) {
  return { ref: { tag: "origin_row", owner, rowId, rowDigest: envelope.digest }, path };
}
function manualReviewFixture(projectRef:string,aliasId:string,mutate?:(row:AuditFixtureObject)=>void) {
  const row:AuditFixtureObject={id:aliasId,owner_id:"00000000-0000-0000-0000-000000000099",alias:"Synthetic alias",canonical:"Synthetic guidance",
    alias_type:"synonym",weight:1,enabled:false,metadata:{},created_at:"2024-02-29T23:59:59.123456Z",updated_at:"2024-02-29T23:59:59.123456Z"};
  mutate?.(row);
  const rowEnvelope={...rawEnvelope(fixturePg(row),"baseline","pg-jsonb-text-v1"),version:1 as const};
  const basis=fixtureEnvelope({kind:"synthetic-manual-alias-creation-record",aliasId,createdBy:"synthetic-alias-author",originalChanges:{alias:row.alias,canonical:row.canonical}});
  const payload={kind:"u04-manual-alias-lineage-review-v1",evidenceMode:"mocked",target:{projectRef},aliasId,ownerId:row.owner_id,
    rowDigest:rowEnvelope.digest,rowEnvelope,producerIdentity:"synthetic-record-collector",reviewer:{identity:"synthetic-independent-reviewer",role:"source_governance",reviewedAt:"2024-02-29"},
    basis:[{producerIdentity:"synthetic-alias-author",entry:{tag:"payload",envelope:basis,representation:"producer_json",mediaType:"application/json",byteLength:Buffer.byteLength(basis.canonicalPayload)}}],
    reviewText:"Synthetic independent review of the full original manual creation record and the exact current alias row."};
  const review=fixtureEnvelope(payload);
  return {row,rowEnvelope,payload,review,binding:{aliasId,ownerId:row.owner_id,rowDigest:rowEnvelope.digest,reviewEnvelopeDigest:review.digest}};
}
function auditConsumerFixture(options: AuditFixtureOptions = {}) {
  const count = options.members ?? 1;
  const identityUuid = options.identityUuid ?? auditFixtureUuid;
  const owner = identityUuid(99); const g0 = options.baselineNull ? null : identityUuid(50);
  const chunkGeneration = options.nullChunk ? null : g0;
  const docIds = Array.from({ length: count }, (_, index) => identityUuid(index + 1));
  const profile = profileFixture(options.nativeCaptureEncoding); profile.documentIds = docIds; profile.manualAliasIds = []; profile.manualAliasReviews = [];
  profile.access = { mode: "owner", ownerId: owner, includePublic: false };
  profile.sourcePolicyVersion = options.catalogue ? australianSourcePolicyVersion : "synthetic-source-policy-v1";
  profile.documentOwnedPolicies = []; profile.comparisonClock = "2024-02-29T23:59:59.123Z";
  const config = configFixture(); config.generation.embeddingModel = "text-embedding-3-small"; config.generation.embeddingDimensions = 1536;
  profile.configuration = fixtureEnvelope(config, "u04-engine-config-v1");
  const requests = {
    providerMode: "openai", globalForceEmbedding: false, selection: { retrieval: {}, quality: {} },
    retrieval: [{ id: "required-case", query: "Synthetic source", expectedQueryClass: "document_lookup", expectedDocumentSubstrings: ["synthetic"],
      expectedContentTerms: ["Synthetic"], topK: 12, expectTableEvidence: false, forceEmbedding: false }],
    quality: options.quality ? [{ id: options.duplicateCase ? "required-case" : "quality-case", question: "Synthetic source question", category: "routine", supported: true,
      expectedFiles: ["synthetic"], allowedRoutes: ["extractive"], minCitations: 1, latencyTargetMs: 12000 }] : [],
  };
  profile.cases = fixtureEnvelope(prepareShadowComparisonCasePayload(requests), "u04-evaluation-cases-v1");
  const retained: Array<{ tag: string; [key: string]: unknown }> = [];
  function retain(envelope: ReturnType<typeof fixtureEnvelope>) {
    const entry = { tag: "payload", envelope, representation: "producer_json", mediaType: "application/json", byteLength: Buffer.byteLength(envelope.canonicalPayload) };
    retained.push(entry);
    return { ref: { tag: "retained_payload", envelopeDigest: envelope.digest, representation: entry.representation,
      mediaType: entry.mediaType, byteLength: entry.byteLength }, path: [] as (string | number)[] };
  }
  const configurationPointer = retain(profile.configuration);
  const data = docIds.map((documentId, index) => {
    const bytes = Buffer.from(`Synthetic original document ${index + 1}.\nComplete fixture source.`, "utf8");
    const contentHash = fixtureSha(bytes); const file = `synthetic-${index + 1}.pdf`;
    const objectRef = { tag: "private_object", bucket: "documents", objectPath: `synthetic/${file}`, objectVersion: null,
      sha256: contentHash, byteLength: bytes.length, mediaType: "application/pdf" };
    retained.push({ tag: "private_object", ref: objectRef, bytes: { encoding: "base64", content: bytes.toString("base64") } });
    const provenance = { contentHash, extractionVersion: "synthetic-extractor-v1", parserVersion: "synthetic-parser-v1",
      parserConfigVersion: "synthetic-parser-config-v1", chunkerVersion: "synthetic-chunker-v1", indexUnitVersion: "synthetic-index-unit-v1",
      validationVersion: "synthetic-validation-v1", sourcePolicyVersion: profile.sourcePolicyVersion };
    const metadata: AuditFixtureObject = { index_generation_id: g0, publisher: "Synthetic publisher", jurisdiction: "AU-WA", corpus_scope: "uploaded_local",
      source_role: "local_guideline", content_mode: "indexed_content", licence_policy: "public_index_permitted", source_excluded: false,
      document_status: "current", source_policy_checked: true, provenance: { ...provenance, parserVersion: options.observedParserVersion ?? provenance.parserVersion }, content_identity_hash: contentHash,
      content_identity_verdict: "clear", content_identity_verdict_version: "synthetic-content-identity-v1" };
    if(g0===null)delete metadata.index_generation_id;
    const document: AuditFixtureObject = { id: documentId, owner_id: owner, title: `Synthetic ${index + 1}`, description: null, file_name: file,
      file_type: "pdf", file_size: bytes.length, storage_path: objectRef.objectPath, content_hash: contentHash, source_path: null,
      import_batch_id: options.capturedBatch ? auditFixtureUuid(600) : null, status: "indexed", page_count: 1, chunk_count: 1, image_count: 0, error_message: null, metadata,
      search_tsv: "'synthetic':1", title_search_tsv: "'synthetic':1", index_generation_id: g0, created_at: auditFixtureTime, updated_at: auditFixtureTime };
    const page: AuditFixtureObject = { id: auditFixtureUuid(100 + index), document_id: documentId, page_number: 1, text: `Synthetic complete page ${index + 1}.`,
      ocr_used: false, metadata: g0===null?{}:{ index_generation_id: g0 }, created_at: auditFixtureTime, index_generation_id: g0 };
    const chunk: AuditFixtureObject = { id: auditFixtureUuid(200 + index), document_id: documentId, page_number: 1, chunk_index: 0,
      section_heading: null, section_path: [], heading_level: null, parent_heading: null, anchor_id: null,
      content: options.nonGreen ? "" : `Synthetic complete page ${index + 1}.`, retrieval_synopsis: null,
      content_hash: fixtureSha(options.nonGreen ? "" : `Synthetic complete page ${index + 1}.`).slice(7), index_generation_id: chunkGeneration,
      token_estimate: 6, image_ids: [], metadata: { index_generation_id: chunkGeneration, embedding_model: options.observedEmbeddingModel ?? "text-embedding-3-small", embedding_strategy: options.observedEmbeddingStrategy ?? "chunk-and-structured-units-v1" },
      embedding: JSON.stringify(Array.from({ length: 1536 }, (_, offset) => offset === 0 ? 1 : 0)), search_tsv: "'synthetic':1", created_at: auditFixtureTime };
    options.editDocument?.(document);
    return { documentId, bytes, objectRef, provenance, document, page, chunk };
  });
  const policyMembers = data.map((item) => ({ documentId: item.documentId, ownerId: owner, contentHash: item.provenance.contentHash }));
  if (!options.catalogue) {
    const policy = fixtureEnvelope({ kind: "u04-document-owned-policy-v1", evidenceMode: "mocked", sourcePolicyVersion: profile.sourcePolicyVersion,
      members: policyMembers, policyText: "Complete synthetic policy scoped to these exact fixture members." });
    const policyArtifact = { digest: fixtureSha(policy.canonicalPayload), retainedEnvelopeDigest: policy.digest }; retain(policy);
    const review = fixtureEnvelope({ kind: "u04-document-owned-policy-review-v1", evidenceMode: "mocked", sourcePolicyVersion: profile.sourcePolicyVersion,
      members: policyMembers, policyArtifact, reviewer: { identity: "policy-reviewer", role: "source_governance", reviewedAt: "2024-02-29" },
      reviewText: "Synthetic review of the complete policy and exact member identities." }); retain(review);
    profile.documentOwnedPolicies = policyMembers.map((member) => ({ ...member, sourcePolicyVersion: profile.sourcePolicyVersion, policyArtifact,
      reviewArtifact: { digest: fixtureSha(review.canonicalPayload), retainedEnvelopeDigest: review.digest } }));
  }
  const rows: Record<string, ReturnType<typeof fixtureEnvelope>[]> = Object.fromEntries([
    "documents", "document_pages", "document_chunks", "document_images", "document_table_facts", "document_embedding_fields", "document_index_units",
    "document_sections", "document_memory_cards", "document_summaries", "document_labels", "document_index_quality", "ingestion_jobs", "indexing_v3_agent_jobs",
    "ingestion_job_stages", "import_batches", "rag_aliases", "document_title_words", "public_source_versions", "public_source_activation_events",
    "public_source_serving_authority", "document_publication_approvals", "shadow_reindex_waves", "document_index_generations",
    "document_generation_projections", "document_generation_inventory", "document_generation_baselines",
  ].map((table) => [table, []]));
  const manual=options.manualAlias?manualReviewFixture(profile.target.projectRef,auditFixtureUuid(11)):null;
  if(manual){profile.manualAliasIds=[String(manual.row.id)];profile.manualAliasReviews=[manual.review];rows.rag_aliases!.push(manual.rowEnvelope);}
  rows.public_source_serving_authority!.push(fixtureEnvelope({ singleton: true, lifecycle_epoch: 1, updated_at: auditFixtureTime }, "baseline", "pg-jsonb-text-v1"));
  if (options.capturedBatch) rows.import_batches!.push(fixtureEnvelope({ id: auditFixtureUuid(600), owner_id: owner, name: "Synthetic batch", source_root: null,
    include_glob: "**/*.pdf", status: "completed", total_files: count, queued_files: 0, skipped_files: 0, failed_files: 0,
    total_bytes: data.reduce((total, item) => total + item.bytes.length, 0), metadata: {}, completed_at: auditFixtureTime,
    created_at: auditFixtureTime, updated_at: auditFixtureTime }, "baseline", "pg-jsonb-text-v1"));
  const catalogueRows = options.catalogue ? data.map((item, index) => fixtureCatalogueRows(item, index, profile.sourcePolicyVersion)) : [];
  for (const catalogue of catalogueRows) {
    options.editCatalogue?.(catalogue.version, catalogue.event);
    rows.public_source_versions!.push(fixtureEnvelope(catalogue.version, "baseline", "pg-jsonb-text-v1"));
    rows.public_source_activation_events!.push(fixtureEnvelope(catalogue.event, "baseline", "pg-jsonb-text-v1"));
  }
  for (const item of data) {
    const documentEnvelope = fixtureEnvelope(item.document, "baseline", "pg-jsonb-text-v1");
    rows.documents!.push(options.documentFileSizeToken === undefined ? documentEnvelope : { ...rawEnvelope(
      documentEnvelope.canonicalPayload.replace(`"file_size":${item.document.file_size}`, `"file_size":${options.documentFileSizeToken.replace("SIZE", String(item.document.file_size))}`), "baseline", "pg-jsonb-text-v1"), version: 1 as const });
    rows.document_pages!.push(fixtureEnvelope(item.page, "baseline", "pg-jsonb-text-v1"));
    rows.document_chunks!.push(fixtureEnvelope(item.chunk, "baseline", "pg-jsonb-text-v1"));
    if (options.tableFact) rows.document_table_facts!.push(fixtureEnvelope({ id: auditFixtureUuid(500 + data.indexOf(item)),
      owner_id: options.tableFactOwner === undefined ? owner : options.tableFactOwner, document_id: item.documentId, source_chunk_id: item.chunk.id, source_image_id: null,
      page_number: 1, table_title: "Synthetic table", row_label: "Synthetic row", clinical_parameter: "synthetic parameter",
      threshold_value: null, action: "Synthetic action", normalized_terms: ["synthetic"], index_generation_id: g0,
      metadata: { index_generation_id: g0 }, search_tsv: "'synthetic':1", created_at: auditFixtureTime }, "baseline", "pg-jsonb-text-v1"));
  }
  if (options.historicalImage) {
    const image = options.historicalImage; const generation = auditFixtureUuid(601);
    const objectPath = "synthetic/historical-worker-image.png";
    retained.push({ tag: "private_object", ref: { tag: "private_object", bucket: "document-images", objectPath, objectVersion: null,
      sha256: fixtureSha(image.bytes), byteLength: image.bytes.length, mediaType: "image/png" },
      bytes: { encoding: "base64", content: image.bytes.toString("base64") } });
    const row: Database["public"]["Tables"]["document_images"]["Row"] = { id: auditFixtureUuid(600), document_id: docIds[0]!,
      page_number: 1, storage_path: objectPath, mime_type: "image/png", caption: "Complete captured historical image", bbox: null,
      image_type: "figure", searchable: true, clinical_relevance_score: 0.5, skip_reason: null, source_kind: "embedded", width: 1, height: 1,
      image_hash: image.hash, perceptual_hash: null, labels: [], index_generation_id: generation, caption_confidence: null,
      clinical_priority_score: null, crop_completeness: null, image_quality_score: null, ocr_text_density: null,
      structured_extraction_confidence: null, visual_duplicate_group: null,
      metadata: { extractor: image.extractor, image_hash: image.metadataHash, index_generation_id: generation }, created_at: auditFixtureTime };
    rows.document_images!.push(fixtureEnvelope(row, "baseline", "pg-jsonb-text-v1"));
  }
  if (options.captureTime) profile.comparisonClock = new Date(options.captureTime).toISOString();
  if (options.capturedHistory) {
    for (const [table, envelopes] of Object.entries(options.capturedHistory.rows)) rows[table] = structuredClone(envelopes);
    const retainedKey = (entry: { tag: string; [key: string]: unknown }) => encodeShadowNodeJsonCanonicalPayload(entry);
    const seen = new Set(retained.map(retainedKey));
    for (const entry of options.capturedHistory.retainedEvidence) {
      const key = retainedKey(entry); if (!seen.has(key)) { retained.push(structuredClone(entry)); seen.add(key); }
    }
  }
  const profileEnvelope = fixtureEnvelope(profile, "u04-execution-profile-v1");
  const origin = fixtureEnvelope({ kind: "u04-origin-snapshot-v1", evidenceMode: "mocked", capturedAt: options.captureTime ?? auditFixtureTime,
    executionProfileEnvelope: profileEnvelope, documentIds: docIds, manualAliasIds: profile.manualAliasIds, sourcePolicyVersion: profile.sourcePolicyVersion, rows }, "baseline", "pg-jsonb-text-v1");
  const memberPayloads: { expected: AuditFixtureObject; measured: AuditFixtureObject; approval: AuditFixtureObject; source: AuditFixtureObject }[] = [];
  const documents = data.map((item, index) => {
    const metadata = item.document.metadata as AuditFixtureObject;
    const authority = options.catalogue ? catalogueRows[index]!.authority : {
      owner: item.document.owner_id!, source: item.document.source_path!, storage: item.document.storage_path!, file: item.document.file_name!,
      file_type: item.document.file_type!, file_size: item.document.file_size!, content_hash: item.document.content_hash!,
      corpus_scope: metadata.corpus_scope ?? null, content_mode: metadata.content_mode ?? null, licence_policy: metadata.licence_policy ?? null,
      source_policy_checked: metadata.source_policy_checked ?? null, content_identity_verdict: metadata.content_identity_verdict ?? null,
      content_identity_hash: metadata.content_identity_hash ?? null, content_identity_verdict_version: metadata.content_identity_verdict_version ?? null,
      canonical_storage_path: metadata.canonical_storage_path ?? null, public_corpus: metadata.public_corpus ?? null,
    };
    const source: AuditFixtureObject = { version: 1, originDigest: origin.digest, executionProfileDigest: profileEnvelope.digest, documentId: item.documentId,
      ownerId: owner, contentHash: item.provenance.contentHash, authorityDigest: fixtureSha(fixturePg(authority)), sourcePolicyVersion: profile.sourcePolicyVersion,
      manualAliasIds: profile.manualAliasIds, baselineGenerationId: g0, source: options.catalogue ? { tag: "catalogue_version", sourceCatalogueKey: "nhmrc",
        sourceVersionId: catalogueRows[index]!.version.id!, activationEventId: catalogueRows[index]!.event.id! } : { tag: "document_owned" } };
    const pageUnit = { family: "pages", key: "1" }; const chunkUnit = { family: "chunks", key: auditFixtureUuid(200 + index) };
    const tableUnit = { family: "table_facts", key: auditFixtureUuid(500 + index) };
    const docPointer = fixtureRowPointer(rows.documents![index]!, "document", item.documentId);
    const pagePointer = fixtureRowPointer(rows.document_pages![index]!, "page", auditFixtureUuid(100 + index));
    const chunkPointer = fixtureRowPointer(rows.document_chunks![index]!, "chunk", auditFixtureUuid(200 + index));
    const tablePointer = options.tableFact ? fixtureRowPointer(rows.document_table_facts![index]!, "table_fact", auditFixtureUuid(500 + index)) : null;
    const originalPointer = { ref: item.objectRef, path: [] };
    const basis = [originalPointer];
    const provenanceReview = { contractVersion: "ingestion-provenance-v1", evidenceDigest: reviewedProvenanceEvidenceDigest({ contractVersion: "ingestion-provenance-v1", expected: item.provenance }), reviewedAt: "2024-02-29", reviewerRole: "clinical_governance" };
    const structureNames = ["chunkBoundsValid", "headingContinuityPassed", "tableContinuityPassed", "extractionQualityPassed"];
    const expected: AuditFixtureObject = { kind: "u04-evidence-expectations-v1", policyId: "u04-reviewed-manual-p04-v1", source, evidenceMode: "mocked",
      lifecycle: "current", lifecycleEvidence: [{ ...docPointer, path: ["metadata", "document_status"] }],
      populations: Object.fromEntries(["pages", "chunks", "tables", "images", "searchableUnits", "embeddings"].map((metric) =>
        [metric, { tag: "known", units: metric === "pages" ? [pageUnit] : metric === "tables" && options.tableFact ? [tableUnit] : ["chunks", "searchableUnits", "embeddings"].includes(metric) ? [chunkUnit] : [], basis }])),
      checks: structureNames.map((metric) => ({ id: metric, metric, expectedUnit: { family: "document_metadata", key: "singleton" }, basis })),
      provenance: item.provenance, provenanceReview, embedding: { expectedModel: "text-embedding-3-small", expectedDimensions: 1536, expectedStrategy: "chunk-and-structured-units-v1" },
      configurationEvidence: [configurationPointer], mustPassCases: ["required-case", ...(options.quality && !options.duplicateCase ? ["quality-case"] : [])].map((id) => ({ id, expectedDocumentRank: index + 1 })) };
    options.editExpected?.(expected);
    const expectedEnvelope = fixtureEnvelope(expected, "u04-evidence-expectations-v1");
    const countFields = Object.fromEntries(["pages", "chunks", "tables", "images", "searchableUnits", "embeddings"].map((metric) =>
      [metric, { expected: metric === "images" || (metric === "tables" && !options.tableFact) ? 0 : 1,
        actual: metric === "images" || (metric === "tables" && !options.tableFact) ? 0 : 1 }]));
    const objectKey = fixtureSha(encodeShadowNodeJsonCanonicalPayload(item.objectRef));
    const checked = [
      { unit: chunkUnit, relationship: { tag: "page", field: ["page_number"], target: pageUnit }, result: "resolved", evidence: [chunkPointer] },
      { unit: { family: "document_metadata", key: "singleton" }, relationship: { tag: "private_object", field: ["storage_path"], target: { family: "private_objects", key: objectKey } }, result: "resolved", evidence: [docPointer] },
      ...(tablePointer ? [
        { unit: tableUnit, relationship: { tag: "source_chunk", field: ["source_chunk_id"], target: chunkUnit }, result: "resolved", evidence: [tablePointer] },
        { unit: tableUnit, relationship: { tag: "page", field: ["page_number"], target: pageUnit }, result: "resolved", evidence: [tablePointer] },
      ] : []),
    ];
    const producer = { kind: "reviewed_manual", consumerContract: "u04-reviewed-measurements-v1", identity: `measurement-author-${index + 1}`, version: "1", evidenceMode: "mocked" };
    const observedProvenance = metadata.provenance as AuditFixtureObject;
    const observedEmbedding = item.chunk.metadata as AuditFixtureObject;
    const measured: AuditFixtureObject = { kind: "reviewed-origin-measurements-v1", policyId: "u04-reviewed-manual-p04-v1", source,
      expectationsDigest: expectedEnvelope.digest, producer,
      fields: { counts: { ...countFields, duplicateChunks: 0, orphanedArtifacts: 0 },
        unitQuality: { policyVersion: "u04-reviewed-manual-p04-v1", empty: options.nonGreen ? 1 : 0, oversized: 0, undersized: 0, lowInformation: 0 },
        structure: Object.fromEntries(structureNames.map((metric) => [metric, !(options.nonGreen && metric === "extractionQualityPassed")])),
        embeddingContract: { expectedModel: "text-embedding-3-small", expectedDimensions: 1536, expectedStrategy: "chunk-and-structured-units-v1",
          actualModels: [observedEmbedding.embedding_model!], actualDimensions: [1536], actualStrategies: [observedEmbedding.embedding_strategy!], completeness: 1 },
        provenance: { expected: expected.provenance!, actual: observedProvenance, review: expected.provenanceReview! }, chunkGenerations: chunkGeneration===null?[]:[chunkGeneration] },
      witnesses: [
        ...["pages", "chunks", "tables", "images", "searchableUnits", "embeddings"].map((metric) => ({ tag: "population", metric,
          observations: metric === "tables" && tablePointer ? [{ unit: tableUnit, evidence: [tablePointer] }] : ["tables", "images"].includes(metric) ? [] : [{ unit: metric === "pages" ? pageUnit : chunkUnit, evidence: [metric === "pages" ? pagePointer : chunkPointer] }],
          result: metric === "images" || (metric === "tables" && !options.tableFact) ? 0 : 1 })),
        { tag: "unit_quality", unit: chunkUnit, evidence: [chunkPointer, configurationPointer, originalPointer], empty: options.nonGreen ?? false,
          oversized: false, undersized: false, lowInformation: false, rationale: "Reviewed complete synthetic unit against original source and captured configuration." },
        ...structureNames.map((metric) => ({ tag: "structure", checkId: metric, metric, evidence: [docPointer, originalPointer, configurationPointer],
          result: options.nonGreen && metric === "extractionQualityPassed" ? "fail" : "pass", rationale: "Reviewed full source; absent table/heading is an explicit whole-document check." })),
        { tag: "duplicates", policy: "index-quality-whitespace-sha256-v1", groups: [{ contentHash: fixtureSha(String(item.chunk.content).replace(/\s+/g, " ").trim()).slice(7), units: [chunkUnit] }], result: 0 },
        { tag: "relationships", checked, result: 0 },
        { tag: "embedding", unit: chunkUnit, evidence: [chunkPointer, { ...chunkPointer, path: ["metadata", "embedding_model"] }, { ...chunkPointer, path: ["metadata", "embedding_strategy"] }],
          present: true, model: observedEmbedding.embedding_model!, dimensions: 1536, strategy: observedEmbedding.embedding_strategy! },
        ...Object.entries(observedProvenance).map(([field, value]) => ({ tag: "provenance", field, evidence: [{ ...docPointer, path: ["metadata", "provenance", field] }], value })),
        { tag: "generations", units: [{ unit: chunkUnit, evidence: [chunkPointer], generation: chunkGeneration }], result: chunkGeneration===null?[]:[chunkGeneration] },
      ] };
    options.editMeasured?.(measured);
    const measurementsEnvelope = fixtureEnvelope(measured, "u04-reviewed-measurements-v1");
    const reviewer = { identity: `independent-reviewer-${index + 1}`, role: "clinical_governance", reviewedAt: "2024-02-29" };
    const reviewEnvelope = fixtureEnvelope({ kind: "u04-measurement-review-v1", evidenceMode: "mocked", source, expectationsDigest: expectedEnvelope.digest,
      measurementsDigest: measurementsEnvelope.digest, producerIdentity: producer.identity, reviewer, reviewText: "Independent review of complete bound synthetic source and measurement records." });
    const reviewPointer = retain(reviewEnvelope);
    const approval: AuditFixtureObject = { kind: "u04-reviewed-evidence-approval-v1", policyId: "u04-reviewed-manual-p04-v1", source,
      evidenceMode: "mocked", expectationsDigest: expectedEnvelope.digest, measurementsDigest: measurementsEnvelope.digest, producer,
      reviewer: { ...reviewer, evidence: reviewPointer.ref, evidenceDigest: reviewEnvelope.digest } };
    options.editApproval?.(approval);
    const approvalEnvelope = fixtureEnvelope(approval, "u04-reviewed-evidence-approval-v1");
    const historicalBytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{\n  "legacy": true\n}\n')]);
    const oldDigest = options.historicalNull ? null : "a".repeat(64);
    const historicalArtifact = { artifactDigest: fixtureSha(historicalBytes), expectedStateDigest: oldDigest as string | null,
      envelope: fixtureEnvelope({ kind: "u04-historical-audit-bytes-v1", documentId: item.documentId, expectedStateDigest: oldDigest,
        bytes: { encoding: "base64", content: historicalBytes.toString("base64") } }) };
    memberPayloads.push({ expected, measured, approval, source });
    return { documentId: item.documentId, reviewedExpectationsEnvelope: expectedEnvelope, measurementsEnvelope, approvalEnvelope, historicalArtifact };
  });
  const casePayload = fixtureAuditCaseReport(data, memberPayloads.map((member) => member.source), profile, profileEnvelope, origin, options);
  options.editCases?.(casePayload);
  const caseResultsEnvelope = fixtureEnvelope(casePayload, "evaluation_report");
  retained.sort((a, b) => {
    const key = (entry: typeof a) => entry.tag === "payload" ? `payload/${(entry.envelope as ReturnType<typeof fixtureEnvelope>).digest}`
      : `private_object/${encodeShadowNodeJsonCanonicalPayload(entry.ref)}`;
    return key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;
  });
  const input = { originEnvelope: origin, caseResultsEnvelope, documents, retainedEvidence: retained };
  const admission = { executionProfileDigest: profileEnvelope.digest, originDigest: origin.digest, caseResultsDigest: caseResultsEnvelope.digest,
    documents: documents.map((member) => ({ documentId: member.documentId, expectationsDigest: member.reviewedExpectationsEnvelope.digest,
      measurementsDigest: member.measurementsEnvelope.digest, approvalEnvelopeDigest: member.approvalEnvelope.digest,
      historicalArtifactDigest: member.historicalArtifact.artifactDigest, historicalEnvelopeDigest: member.historicalArtifact.envelope.digest })),
    documentPolicyBindings: profile.documentOwnedPolicies, manualAliasReviewBindings: manual?[manual.binding]:[], evidenceMode: "mocked" };
  return { input, admission, data, memberPayloads, casePayload, profile, rows };
}

function fixtureCatalogueRows(item: { documentId: string; document: AuditFixtureObject; provenance: AuditFixtureObject }, index: number, policyVersion: string) {
  const metadata = item.document.metadata as AuditFixtureObject;
  const catalogue = australianSourceByKey("nhmrc")!;
  const event: AuditFixtureObject = { id: auditFixtureUuid(300 + index), source_catalogue_key: "nhmrc", source_policy_version: policyVersion,
    source_policy_digest: fixtureSha("synthetic catalogue policy"), decision: "activate", operator_id: auditFixtureUuid(99),
    reason: "Synthetic source-only activation record", evidence_references: ["synthetic-review"], source_sequence: index + 1, created_at: auditFixtureTime };
  const version: AuditFixtureObject = { id: auditFixtureUuid(400 + index), source_catalogue_key: "nhmrc", source_policy_version: policyVersion,
    source_policy_digest: event.source_policy_digest!, exact_canonical_url: "https://www.nhmrc.gov.au/synthetic", exact_version_url: "https://www.nhmrc.gov.au/synthetic-v1.pdf",
    exact_version: "synthetic-v1", content_hash: item.document.content_hash!, staged_content_hash: item.document.content_hash!, retrieved_at: auditFixtureTime,
    licence_evidence_digest: fixtureSha("synthetic licence review"), staging_document_id: item.documentId, extraction_generation_id: null,
    index_generation_id: item.document.index_generation_id!, lifecycle: "shadow", acquisition_identity_digest: null, supersedes_version_id: null,
    activation_event_id: event.id!, staging_owner_id: item.document.owner_id!, publication_approval_id: null, publication_manifest_digest: null,
    publication_reviewed_state_digest: null, publication_reviewed_index_generation_id: null, created_at: auditFixtureTime, updated_at: auditFixtureTime };
  Object.assign(metadata, { corpus_scope: "australian_public", source_role: catalogue.roles[0], source_catalogue_key: "nhmrc",
    source_policy_version: policyVersion, source_policy_digest: event.source_policy_digest, source_activation_event_id: event.id,
    source_canonical_url: version.exact_canonical_url, source_exact_url: version.exact_version_url, source_exact_version: version.exact_version,
    source_content_hash: version.content_hash, content_hash: version.staged_content_hash, licence_evidence_digest: version.licence_evidence_digest,
    content_identity_verdict_version: "public-source-content-identity-v1", public_source_lifecycle: "shadow", source_content_type: "application/pdf",
    source_content_byte_length: String(item.document.file_size), source_content_provenance: "synthetic retained original" });
  const acquisition: AuditFixtureObject = {};
  for (const key of ["source_catalogue_key", "source_policy_version", "source_policy_digest", "activation_event_id", "exact_canonical_url", "exact_version_url",
    "exact_version", "content_hash", "staged_content_hash", "licence_evidence_digest", "staging_owner_id", "supersedes_version_id"]) acquisition[key] = version[key]!;
  Object.assign(acquisition, { document_id: item.document.id, document_owner_id: item.document.owner_id, source_path: item.document.source_path,
    storage_path: item.document.storage_path, document_content_hash: item.document.content_hash, file_type: item.document.file_type,
    file_size: item.document.file_size, target_lifecycle: "shadow" });
  for (const key of ["corpus_scope", "content_mode", "licence_policy", "source_policy_checked", "public_source_lifecycle", "source_content_type",
    "source_content_byte_length", "source_content_provenance", "content_identity_verdict", "content_identity_hash", "content_identity_verdict_version", "canonical_storage_path"])
    acquisition[key] = metadata[key] === null || metadata[key] === undefined ? null : typeof metadata[key] === "string" ? metadata[key]! : fixturePg(metadata[key]!);
  version.acquisition_identity_digest = fixtureSha(fixturePg(acquisition));
  return { version, event, authority: { acquisition: version.acquisition_identity_digest, version: version.id!, lifecycle: version.lifecycle!, event: event.id!,
    sequence: event.source_sequence!, decision: event.decision!, policy: event.source_policy_version!, policy_digest: event.source_policy_digest! } };
}

function fixtureAuditCaseReport(data: { documentId: string; document: AuditFixtureObject; chunk: AuditFixtureObject }[], sources: AuditFixtureObject[],
  profile: ReturnType<typeof profileFixture>, profileEnvelope: ReturnType<typeof fixtureEnvelope>, origin: ReturnType<typeof fixtureEnvelope>, options: AuditFixtureOptions): AuditFixtureObject {
  const numbers = (keys: string[], value = 0): AuditFixtureObject => Object.fromEntries(keys.map((key) => [key, value]));
  const results = data.map((item) => ({ id: item.chunk.id!, document_id: item.documentId, content: item.chunk.content!, page_number: 1,
    title: item.document.title!, file_name: item.document.file_name!, chunk_index: 0, section_heading: null, image_ids: [], images: [], similarity: 1 }));
  const golden: AuditFixtureObject = { id: "required-case", query: "Synthetic source", forceEmbedding: false, expectedQueryClass: "document_lookup", actualQueryClass: "document_lookup",
    expectedDocumentSubstrings: ["synthetic"], missingDocumentSubstrings: [], expectedContentTerms: ["Synthetic"], missingContentTerms: [],
    documentRecallAt5: 1, contentRecallAt5: 1, topK: 12, reciprocalRankAt10: 1, contentReciprocalRankAt10: 1, declaredSignalCount: 1,
    ndcgAt10: 1, irrelevantSourceRateAt10: 0, requiredSignalCoverageAt10: 1, latencyMs: 1, resultCount: results.length,
    hitAtK: true, retrievalStrategy: "text", retrievalPlan: "synthetic", embeddingSkipped: true, embeddingSkipReason: "synthetic text route",
    textFastPathReason: null, textCandidateBudget: 12, textCandidateCount: results.length, vectorCandidateCount: 0, secondStageRerankUsed: false,
    tableEvidenceFound: false, failures: [], topResults: results.map((item, index) => ({ rank: index + 1, title: item.title, file_name: item.file_name,
      chunk_id: item.id, page_number: 1, hybrid_score: null, similarity: 1, text_rank: null, rrf_score: null, relevanceGrade: 1,
      matchedDeclaredSignals: ["synthetic"], content_preview: String(item.content).replace(/\s+/g, " ").trim().slice(0, 220) })) };
  const quality: AuditFixtureObject = { id: options.duplicateCase ? "required-case" : "quality-case", question: "Synthetic source question", category: "routine", supported: true,
    expectedFiles: ["synthetic"], matchedFiles: ["synthetic"], missingFiles: [], topFiles: data.map((item) => item.document.file_name!), expectedHit: true,
    grounded: true, latencyMs: 1, route: "extractive", latencyRoute: "extractive", model: null, citations: 1, visualEvidence: 0, failures: [],
    sourceWarningCount: 0, sourceDangerWarningCount: 0, unverifiedNumericTokenCount: 0, hasFaithfulnessWarning: false, executionType: "cached", estimatedCostUsd: 0,
    timings: { retrievalMs: 0, routingMs: 0, generationMs: 0, verificationMs: 0, totalMs: 1, routeBudgetMs: 12000,
      routeDeadlineExceeded: false, budgetExhaustedByRetrieval: false }, routeCeilingExceeded: false };
  const documentResults = data.map((item, index) => ({ documentId: item.documentId, expectedDocumentRank: index + 1, actualDocumentRank: index + 1, failureCodes: [] }));
  const executions: AuditFixtureObject[] = [{ kind: "retrieval", index: 0, caseId: "required-case", outcome: "complete", searchResults: results,
    answer: null, limitations: [], documentResults }];
  if (options.quality) executions.push({ kind: "quality", index: 0, caseId: options.duplicateCase ? "required-case" : "quality-case", outcome: "complete", searchResults: results,
    answer: { answer: "Synthetic complete extractive answer.", grounded: true, confidence: "high", routingMode: "extractive",
      latencyTimings: { total_latency_ms: 1 }, sourceGovernanceWarnings: [], citations: [{ document_id: data[0]!.documentId, chunk_id: data[0]!.chunk.id!,
      title: data[0]!.document.title!, file_name: data[0]!.document.file_name!, page_number: 1, chunk_index: 0 }], sources: results }, limitations: [], documentResults });
  const summaryRetrieval: AuditFixtureObject = { ...numbers(["case_count", "document_recall_at_5", "content_recall_at_5", "top_k_hit_rate", "mrr_at_10", "content_mrr_at_10",
    "content_mrr_case_count", "ndcg_at_10", "required_signal_coverage_at_10", "signal_metric_case_count", "median_latency_ms", "p90_latency_ms", "embedding_skipped_rate"], 1),
    ...numbers(["irrelevant_source_rate_at_10", "force_embedding_case_count", "force_embedding_failure_count", "second_stage_rerank_rate"]), median_text_candidate_budget: 12,
    retrieval_strategy_counts: { text: 1 }, retrieval_plan_counts: { synthetic: 1 }, embedding_skip_reason_counts: { "synthetic text route": 1 },
    text_fast_path_reason_counts: {}, retrieval_layer_counts: {}, failed_cases: [], latency_failed_cases: [] };
  const ragSummary: AuditFixtureObject = { ...numbers(["case_count", "supported_count", "unsupported_count", "grounded_supported_rate", "unsupported_correct_rate", "expected_hit_rate",
    "citation_failure_rate", "numeric_grounding_failure_rate", "source_warning_count", "source_governance_warning_rate", "source_governance_danger_failure_rate",
    "expected_danger_warning_missing_count", "route_ceiling_failure_count", "generation_fallback_count", "source_backed_review_fallback_count", "source_backed_review_fallback_rate",
    "substantive_grounded_count", "substantive_grounded_rate", "comparison_source_extractive_fallback_count", "median_latency_ms", "p95_latency_ms"]),
    route_p95_latency_ms: {}, estimated_cost_usd: 0, failure_category_counts: {}, failed_cases: [] };
  if (options.quality) Object.assign(ragSummary, { case_count: 1, supported_count: 1, grounded_supported_rate: 1, expected_hit_rate: 1,
    substantive_grounded_count: 1, substantive_grounded_rate: 1, median_latency_ms: 1, p95_latency_ms: 1, route_p95_latency_ms: { extractive: 1 } });
  const runContext = { git_sha: null, github_run_id: null, github_run_attempt: null, latency_context: "synthetic offline fixture" };
  const cases = JSON.parse(profile.cases.canonicalPayload) as AuditFixtureObject;
  const caseScopes = { caseSetDigest: profile.cases.digest, scopes: [
    ...((cases.retrieval as AuditFixtureObject[]).map((entry, index) => ({ case: { kind: "retrieval", index,
      caseId: String((entry.testCase as AuditFixtureObject).id) }, documentIds: [...profile.documentIds] }))),
    ...((cases.quality as AuditFixtureObject[]).map((entry, index) => ({ case: { kind: "quality", index,
      caseId: String(entry.id) }, documentIds: [...profile.documentIds] }))),
  ] };
  const phase = { side: "baseline", planDigest: null, candidateGenerationId: null, waveReceiptDigest: null };
  const originPayload = JSON.parse(origin.canonicalPayload) as AuditFixtureObject;
  const authorizedAt = String(originPayload.capturedAt);
  const manifest: AuditFixtureObject = { version: 1, operation: "evaluate", targetProjectRef: profile.target.projectRef,
    planPath: null, reportOrReceiptPath: null, recoveryEvidencePath: "synthetic-recovery.json",
    recoveryEvidenceSha256: fixtureSha("synthetic evaluation recovery bytes"), expectedDocumentIds: [...profile.documentIds],
    expectedDocumentCount: profile.documentIds.length, confirmationSha256: fixtureSha("placeholder evaluation confirmation"),
    authorizedAt, expiresAt: new Date(Date.parse(authorizedAt) + 60 * 60 * 1000).toISOString() };
  const runnerPolicy = { kind: "u04-evaluation-runner-policy-v1", version: 1,
    workload: "eval-quality-retrieval-and-rag-v1", retrievalConcurrency: 1, qualityConcurrency: 1,
    evaluatorRetry: { maxAttempts: 4, initialDelayMs: 5000, maxDelayMs: 45000 },
    costRates: { input: 1, cachedInput: 0.5, output: 2 }, runContext, crossRegionRunner: false };
  const authority: AuditFixtureObject = { kind: "u04-evaluation-authority-v1", version: 1, manifest, phase,
    executionProfileDigest: profileEnvelope.digest, originalOriginDigest: origin.digest, caseScopes, runnerPolicy,
    recoveryEnvelopeDigest: fixtureSha("synthetic evaluation recovery envelope") };
  const { confirmationSha256: _confirmation, ...manifestWithoutConfirmation } = manifest;
  manifest.confirmationSha256 = fixtureSha(encodeShadowNodeJsonCanonicalPayload({ ...authority, manifest: manifestWithoutConfirmation }));
  const authorityEnvelope = fixtureEnvelope(authority, "plan");
  const request: AuditFixtureObject = { kind: "u04-evaluation-request-v1", version: 1,
    sessionId: "33333333-3333-4333-8333-333333333333", authorityEnvelopeDigest: authorityEnvelope.digest,
    executionProfileDigest: profileEnvelope.digest, originalOriginDigest: origin.digest, caseSetDigest: profile.cases.digest,
    configurationDigest: profile.configuration.digest, sourceBindings: structuredClone(sources), caseScopes: structuredClone(caseScopes),
    phase: structuredClone(phase), comparisonClock: profile.comparisonClock,
    requiredSqlOperations: [...u04EvaluationAuthoritySqlOperationsFixture] };
  const inputBinding = { authorityEnvelope, requestEnvelope: fixtureEnvelope(request, "u04-evaluation-request-v1") };
  return { kind: "u04-audit-case-results-v1", evidenceMode: "mocked", originDigest: origin.digest, executionProfileDigest: profileEnvelope.digest,
    caseSetDigest: profile.cases.digest, configurationDigest: profile.configuration.digest, providerMode: profile.providerMode, comparisonClock: profile.comparisonClock,
    documentIds: profile.documentIds, manualAliasIds: profile.manualAliasIds, sourceBindings: sources, inputBinding,
    report: { generated_at: options.captureTime ?? auditFixtureTime, run_context: runContext,
      provider: { mode: "openai", model_case_count: 0, openai_request_id_count: 0, token_usage_case_count: 0, nonzero_cost_case_count: 0, generation_latency_case_count: 0, passed: true },
      thresholds: { ...numbers(["retrievalTopKHitRate", "retrievalDocumentRecallAt5", "retrievalContentRecallAt5", "ragGroundedSupportedRate", "ragUnsupportedCorrectRate"], 1),
        ...numbers(["ragCitationFailureRate", "ragSourceBackedReviewFallbackCount", "numericGroundingFailureRate", "staleTopResultRate", "reviewRequiredTopResultRate"]),
        ragP95LatencyMs: 12000, ragRouteP95LatencyMs: { extractive: 12000 } },
      retrieval: { summary: summaryRetrieval, source_governance: { ...numbers(["stale_top_results", "review_due_top_results", "unknown_status_top_results", "unverified_top_results",
        "unknown_extraction_top_results", "poor_extraction_top_results", "stale_rate", "stale_review_unknown_rate", "review_required_top_results", "review_required_rate"]),
        total_top_results: results.length, metadata_policy: "synthetic complete returned source metadata" }, failure_category_counts: {}, results: [golden] },
      rag: { summary: ragSummary, results: options.quality ? [quality] : [] }, threshold_failures: [], accepted_threshold_failures: [], blocking_threshold_failures: [],
      source_metadata_debt_acceptance: { status: "not_requested", accepted_failures: [], rejection_reasons: [] } }, executions };
}

function prepareAuditFixture(fixture: ReturnType<typeof auditConsumerFixture>) {
  return prepareShadowAuditV1(fixture.input, fixture.admission);
}
function fixtureCaseAbsent(payload: AuditFixtureObject, outcome = "complete", code = "document_not_retrieved") {
  fixtureSet(payload, ["executions", 0, "searchResults"], []);
  fixtureSet(payload, ["executions", 0, "outcome"], outcome);
  fixtureSet(payload, ["executions", 0, "documentResults", 0, "actualDocumentRank"], null);
  fixtureSet(payload, ["executions", 0, "documentResults", 0, "failureCodes"], [code]);
  fixtureSet(payload, ["report", "retrieval", "results", 0, "resultCount"], 0);
  fixtureSet(payload, ["report", "retrieval", "results", 0, "topResults"], []);
  fixtureSet(payload, ["report", "retrieval", "results", 0, "hitAtK"], false);
  fixtureSet(payload, ["report", "retrieval", "results", 0, "failures"], [code]);
  fixtureSet(payload, ["report", "retrieval", "summary", "failed_cases"], [fixtureGet(payload, ["report", "retrieval", "results", 0])]);
  fixtureSet(payload, ["report", "threshold_failures"], ["retrieval baseline below threshold"]);
  fixtureSet(payload, ["report", "blocking_threshold_failures"], ["retrieval baseline below threshold"]);
}

function rebindAuditReportInputFixture(payload: AuditFixtureObject, mutateAuthority: (authority: AuditFixtureObject) => void) {
  const binding = payload.inputBinding as AuditFixtureObject;
  const authority = JSON.parse(String((binding.authorityEnvelope as AuditFixtureObject).canonicalPayload)) as AuditFixtureObject;
  mutateAuthority(authority);
  const manifest = authority.manifest as AuditFixtureObject;
  const { confirmationSha256: _confirmation, ...manifestWithoutConfirmation } = manifest;
  manifest.confirmationSha256 = fixtureSha(encodeShadowNodeJsonCanonicalPayload({ ...authority, manifest: manifestWithoutConfirmation }));
  const authorityEnvelope = fixtureEnvelope(authority, "plan");
  const request = JSON.parse(String((binding.requestEnvelope as AuditFixtureObject).canonicalPayload)) as AuditFixtureObject;
  request.authorityEnvelopeDigest = authorityEnvelope.digest;
  request.phase = structuredClone(authority.phase);
  binding.authorityEnvelope = authorityEnvelope;
  binding.requestEnvelope = fixtureEnvelope(request, "u04-evaluation-request-v1");
}

function fixtureAuditCrossRegionDeadline(payload: AuditFixtureObject) {
  fixtureSet(payload, ["executions", 1, "answer", "latencyTimings", "route_deadline_exceeded"], true);
  fixtureSet(payload, ["executions", 1, "answer", "latencyTimings", "route_budget_exhausted_by_retrieval"], true);
  fixtureSet(payload, ["report", "rag", "results", 0, "timings", "routeDeadlineExceeded"], true);
  fixtureSet(payload, ["report", "rag", "results", 0, "timings", "budgetExhaustedByRetrieval"], true);
}

function fixtureAuditProviderCost(payload: AuditFixtureObject, estimatedCostUsd: number) {
  fixtureSet(payload, ["executions", 1, "answer", "modelUsed"], "synthetic-model");
  fixtureSet(payload, ["executions", 1, "answer", "openAIRequestIds"], ["req-synthetic"]);
  fixtureSet(payload, ["executions", 1, "answer", "openAIUsage"], { input_tokens: 10, cached_input_tokens: 4, output_tokens: 3 });
  fixtureSet(payload, ["report", "rag", "results", 0, "model"], "synthetic-model");
  fixtureSet(payload, ["report", "rag", "results", 0, "executionType"], "api");
  fixtureSet(payload, ["report", "rag", "results", 0, "openAIRequestIds"], ["req-synthetic"]);
  fixtureSet(payload, ["report", "rag", "results", 0, "openAIUsage"], { inputTokens: 10, cachedInputTokens: 4, outputTokens: 3 });
  fixtureSet(payload, ["report", "rag", "results", 0, "estimatedCostUsd"], estimatedCostUsd);
  fixtureSet(payload, ["report", "rag", "summary", "estimated_cost_usd"], Number(estimatedCostUsd.toFixed(6)));
  fixtureSet(payload, ["report", "provider", "model_case_count"], 1);
  fixtureSet(payload, ["report", "provider", "openai_request_id_count"], 1);
  fixtureSet(payload, ["report", "provider", "token_usage_case_count"], 1);
  fixtureSet(payload, ["report", "provider", "nonzero_cost_case_count"], 1);
}

describe("whole-wave shadow audit preparation using the unchanged P04 consumer", () => {
  it("prepares an eligible uploaded-local member with absent raw catalogue markers and separately admitted complete policy", () => {
    const fixture = auditConsumerFixture(); const prepared = prepareAuditFixture(fixture);
    expect(prepared.kind).toBe("shadow-audit-prepared");
    expect(prepared.audits).toHaveLength(1);
    expect(prepared.audits[0]).toMatchObject({ eligibleForShadowPlan: true, blockingDisposition: null, action: "no_change", reasons: [] });
    expect(fixture.data[0]!.document.metadata).not.toHaveProperty("source_policy_version");
    expect(fixture.data[0]!.document.metadata).not.toHaveProperty("source_catalogue_key");
    expect(prepared.inventory!.documents[0]!.metadata.sourcePolicyVersion).toBe("synthetic-source-policy-v1");
    expect(prepared.inventory!.documents[0]!.metadata.sourceCatalogueKey).toBeNull();
    expect(prepared.input).toEqual(fixture.input);
    expect(prepared.admission).toEqual(fixture.admission);
    expect(prepared.caseReport.inputBinding).toEqual(fixture.casePayload.inputBinding);
    expect(prepared.limitations).toEqual([]);
  });

  it("refuses a newly produced report without its owning authority and request envelopes", () => {
    const fixture = auditConsumerFixture({ editCases: payload => { delete payload.inputBinding; } });
    expect(() => prepareAuditFixture(fixture)).toThrow("Invalid shadow comparison record.");
  });

  it("refuses a fully rebound candidate authority and request in the baseline audit path", () => {
    const fixture = auditConsumerFixture({ editCases: payload => rebindAuditReportInputFixture(payload, authority => {
      authority.phase = { side: "candidate", planDigest: fixtureSha("candidate plan"),
        candidateGenerationId: auditFixtureV4Uuid(800), waveReceiptDigest: fixtureSha("candidate wave") };
      (authority.manifest as AuditFixtureObject).planPath = "synthetic-plan.json";
    }) });
    expect(() => prepareAuditFixture(fixture)).toThrow("Invalid shadow comparison record.");
  });

  it("refuses a fully rebound runner context that differs from the produced report context", () => {
    const fixture = auditConsumerFixture({ editCases: payload => rebindAuditReportInputFixture(payload, authority => {
      fixtureSet(authority, ["runnerPolicy", "runContext", "latency_context"], "cross-region-runner");
    }) });
    expect(() => prepareAuditFixture(fixture)).toThrow("Invalid shadow comparison record.");
  });

  it("uses the bound cross-region policy boolean instead of deriving it from the report context string", () => {
    const fixture = auditConsumerFixture({ quality: true, editCases: payload => {
      fixtureAuditCrossRegionDeadline(payload);
      rebindAuditReportInputFixture(payload, authority => { fixtureSet(authority, ["runnerPolicy", "crossRegionRunner"], true); });
    } });
    expect(prepareAuditFixture(fixture).kind).toBe("shadow-audit-prepared");
  });

  it("refuses a route-ceiling result excused by the report when the bound policy boolean is false", () => {
    const fixture = auditConsumerFixture({ quality: true, editCases: fixtureAuditCrossRegionDeadline });
    expect(() => prepareAuditFixture(fixture)).toThrow("Invalid shadow comparison record.");
  });

  it("binds provider usage cost to the retained runner rates", () => {
    const expectedCost = 0.000014;
    const fixture = auditConsumerFixture({ quality: true, editCases: payload => fixtureAuditProviderCost(payload, expectedCost) });
    expect(prepareAuditFixture(fixture).caseReport.report.rag.results[0]!.estimatedCostUsd).toBe(expectedCost);
  });

  it("refuses a fully rebound rate policy that differs from the produced provider cost", () => {
    const fixture = auditConsumerFixture({ quality: true, editCases: payload => {
      fixtureAuditProviderCost(payload, 0.000014);
      rebindAuditReportInputFixture(payload, authority => { fixtureSet(authority, ["runnerPolicy", "costRates", "input"], 2); });
    } });
    expect(() => prepareAuditFixture(fixture)).toThrow("Invalid shadow comparison record.");
  });

  it("maps every member once into a complete two-document P04 inventory with actual ordered document ranks", () => {
    const fixture = auditConsumerFixture({ members: 2 }); const prepared = prepareAuditFixture(fixture);
    expect(prepared.kind).toBe("shadow-audit-prepared");
    expect(prepared.inventory!.documents.map((document) => document.documentId)).toEqual(fixture.profile.documentIds);
    expect(prepared.inventory!.retrievedDocumentIdsByCase["required-case"]).toEqual(fixture.profile.documentIds);
    expect(prepared.inventory!.documents.map((document) => document.mustPassCases[0]!.actualDocumentRank)).toEqual([1, 2]);
    expect(prepared.audits.every((audit) => audit.eligibleForShadowPlan)).toBe(true);
  });

  it("uses captured catalogue version/event authority and the actual accepted catalogue policy", () => {
    const fixture = auditConsumerFixture({ catalogue: true }); const prepared = prepareAuditFixture(fixture);
    expect(prepared.kind).toBe("shadow-audit-prepared");
    expect(prepared.audits[0]).toMatchObject({ eligibleForShadowPlan: true, blockingDisposition: null });
    expect(prepared.inventory!.documents[0]!.metadata).toMatchObject({ corpusScope: "australian_public", sourceCatalogueKey: "nhmrc", sourcePolicyVersion: australianSourcePolicyVersion });
    expect(prepared.input.originEnvelope.canonicalPayload).toBe(fixture.input.originEnvelope.canonicalPayload);
  });

  it("counts a fully witnessed same-owner table-fact row and its actual source relationships", () => {
    const prepared = prepareAuditFixture(auditConsumerFixture({ tableFact: true }));
    expect(prepared.kind).toBe("shadow-audit-prepared");
    expect(prepared.inventory!.documents[0]!.counts.tables).toEqual({ expected: 1, actual: 1 });
    expect(prepared.audits[0]).toMatchObject({ eligibleForShadowPlan: true, blockingDisposition: null });
  });

  it("refuses a fully witnessed same-document/same-generation table fact owned by another principal", () => {
    const fixture = auditConsumerFixture({ tableFact: true, tableFactOwner: auditFixtureUuid(888) });
    expect(() => prepareAuditFixture(fixture)).toThrow("Invalid shadow comparison record.");
  });

  it("refuses a fully witnessed null artifact owner under a private member", () => {
    const fixture = auditConsumerFixture({ tableFact: true, tableFactOwner: null });
    expect(() => prepareAuditFixture(fixture)).toThrow("Invalid shadow comparison record.");
  });

  it("retains the complete explicitly referenced import batch", () => {
    const fixture = auditConsumerFixture({ capturedBatch: true }); const prepared = prepareAuditFixture(fixture);
    expect(prepared.kind).toBe("shadow-audit-prepared");
    expect(prepared.input.originEnvelope).toEqual(fixture.input.originEnvelope);
    expect(fixture.rows.import_batches).toHaveLength(1);
  });

  it("refuses a newly bound origin omitting its document's explicit batch reference", () => {
    const fixture = auditConsumerFixture({ editDocument: (document) => { document.import_batch_id = auditFixtureUuid(600); } });
    expect(fixture.rows.import_batches).toEqual([]);
    expect(() => prepareAuditFixture(fixture)).toThrow("Invalid shadow comparison record.");
  });

  it.each(["model", "strategy", "provenance"] as const)("refuses mixed own-row and unrelated matching-value pointers for %s", (field) => {
    const fixture = auditConsumerFixture({ observedEmbeddingModel: "observed-other-model", editMeasured: (payload) => {
      const config = fixtureGet(payload, ["witnesses", 6, "evidence", 1]) as AuditFixtureObject;
      if (field === "model") {
        fixtureSet(payload, ["fields", "embeddingContract", "actualModels"], ["text-embedding-3-small"]);
        fixtureSet(payload, ["witnesses", 13, "model"], "text-embedding-3-small");
        (fixtureGet(payload, ["witnesses", 13, "evidence"]) as AuditFixtureJson[]).push({ ...config, path: ["generation", "embeddingModel"] });
      } else if (field === "strategy") {
        fixtureSet(payload, ["fields", "embeddingContract", "actualStrategies"], ["index-v1"]);
        fixtureSet(payload, ["witnesses", 13, "strategy"], "index-v1");
        (fixtureGet(payload, ["witnesses", 13, "evidence"]) as AuditFixtureJson[]).push({ ...config, path: ["generation", "indexingPromptVersion"] });
      } else {
        fixtureSet(payload, ["fields", "provenance", "actual", "parserVersion"], "index-v1");
        fixtureSet(payload, ["witnesses", 16, "value"], "index-v1");
        const own = fixtureGet(payload, ["witnesses", 16, "evidence", 0]) as AuditFixtureObject;
        fixtureSet(payload, ["witnesses", 16, "evidence"], [{ ...own, path: [] }, { ...config, path: ["generation", "indexingPromptVersion"] }]);
      }
    } });
    expect(() => prepareAuditFixture(fixture)).toThrow("Invalid shadow comparison record.");
  });

  it("preserves attributable observed producer/provenance mismatches for actual P04 diagnostics", () => {
    const fixture = auditConsumerFixture({ observedEmbeddingModel: "observed-other-model", observedEmbeddingStrategy: "observed-other-strategy", observedParserVersion: "observed-parser-v2" });
    const prepared = prepareAuditFixture(fixture);
    expect(prepared.kind).toBe("shadow-audit-prepared");
    expect(prepared.inventory!.documents[0]!.embeddingContract).toMatchObject({ expectedModel: "text-embedding-3-small", actualModels: ["observed-other-model"], actualStrategies: ["observed-other-strategy"] });
    expect(prepared.inventory!.documents[0]!.provenance.actual.parserVersion).toBe("observed-parser-v2");
    expect(prepared.inventory!.documents[0]!.provenance.expected.parserVersion).toBe("synthetic-parser-v1");
    expect(prepared.audits[0]!.reasons.length).toBeGreaterThan(0);
  });

  it("refuses a same-row matching provenance value from the wrong producer field", () => {
    const fixture = auditConsumerFixture({
      editDocument: (document) => fixtureSet(document, ["metadata", "unrelated_value"], "synthetic-parser-v1"),
      editMeasured: (payload) => fixtureSet(payload, ["witnesses", 16, "evidence", 0, "path"], ["metadata", "unrelated_value"]),
    });
    expect(() => prepareAuditFixture(fixture)).toThrow("Invalid shadow comparison record.");
  });

  it.each(["event decision", "event identity", "acquisition identity", "wrong version document"] as const)("refuses rebound catalogue origin drift: %s", (fault) => {
    const fixture = auditConsumerFixture({ catalogue: true, editCatalogue: (version, event) => {
      if (fault === "event decision") event.decision = "deactivate";
      if (fault === "event identity") event.id = auditFixtureUuid(888);
      if (fault === "acquisition identity") version.acquisition_identity_digest = fixtureSha("different acquisition");
      if (fault === "wrong version document") version.staging_document_id = auditFixtureUuid(999);
    } });
    expect(() => prepareAuditFixture(fixture)).toThrow("Invalid shadow comparison record.");
  });

  it.each(["9007199254740993", "SIZE.00000000000000001", "1e400"])("refuses a raw original SQL numeric token before rounded native conversion: %s", (token) => {
    const fixture = auditConsumerFixture({ documentFileSizeToken: token });
    expect(() => prepareAuditFixture(fixture)).toThrow("Invalid shadow comparison record.");
  });

  it("preserves alternate exact SQL numeric spelling and microsecond timestamps without reserialization", () => {
    const fixture = auditConsumerFixture({ documentFileSizeToken: "SIZE.0000" }); const prepared = prepareAuditFixture(fixture);
    expect(prepared.kind).toBe("shadow-audit-prepared");
    expect(prepared.input.originEnvelope).toEqual(fixture.input.originEnvelope);
    expect(fixture.rows.documents![0]!.canonicalPayload).toContain(`"file_size":${fixture.data[0]!.document.file_size}.0000`);
    expect(fixture.rows.documents![0]!.canonicalPayload).toContain(auditFixtureTime);
  });

  it("retains known non-green quality findings and obtains actual eligible targeted-reprocess diagnostics", () => {
    const fixture = auditConsumerFixture({ nonGreen: true }); const prepared = prepareAuditFixture(fixture);
    expect(prepared.kind).toBe("shadow-audit-prepared");
    expect(prepared.audits[0]).toMatchObject({ eligibleForShadowPlan: true, blockingDisposition: null, action: "targeted_reprocess", diagnosticAction: "targeted_reprocess" });
    expect(prepared.audits[0]!.reasons).toEqual(expect.arrayContaining(["empty_index_units", "extraction_quality_poor"]));
    expect(prepared.inventory!.documents[0]!.unitQuality.empty).toBe(1);
  });

  it("retains a complete retrieval miss and its scored failures while obtaining actual P04 repair diagnostics", () => {
    const fixture = auditConsumerFixture({ editCases: (payload) => fixtureCaseAbsent(payload) });
    const prepared = prepareAuditFixture(fixture);
    expect(prepared.kind).toBe("shadow-audit-prepared");
    expect(prepared.audits[0]).toMatchObject({ eligibleForShadowPlan: true, blockingDisposition: null });
    expect(prepared.inventory!.documents[0]!.mustPassCases[0]).toMatchObject({ passed: false, actualDocumentRank: null, failureCodes: ["document_not_retrieved"] });
    expect(prepared.caseReport.report.blocking_threshold_failures).toEqual(["retrieval baseline below threshold"]);
    expect(prepared.caseReport.report.accepted_threshold_failures).toEqual([]);
  });

  it("preserves a complete known rank failure without converting it to unavailable evidence", () => {
    const fixture = auditConsumerFixture({ members: 2,
      editExpected: (payload) => fixtureSet(payload, ["mustPassCases", 0, "expectedDocumentRank"], 1),
      editCases: (payload) => { fixtureSet(payload, ["executions", 0, "documentResults", 1, "expectedDocumentRank"], 1);
        fixtureSet(payload, ["executions", 0, "documentResults", 1, "failureCodes"], ["document_rank_exceeded"]); } });
    const prepared = prepareAuditFixture(fixture);
    expect(prepared.kind).toBe("shadow-audit-prepared");
    expect(prepared.inventory!.documents[1]!.mustPassCases[0]).toMatchObject({ passed: false, actualDocumentRank: 2, expectedDocumentRank: 1 });
    expect(prepared.audits[1]).toMatchObject({ eligibleForShadowPlan: true, blockingDisposition: null });
  });

  it("retains the entire answer and returned answer-source stage beside the complete scored report", () => {
    const fixture = auditConsumerFixture({ quality: true }); const prepared = prepareAuditFixture(fixture);
    expect(prepared.kind).toBe("shadow-audit-prepared");
    expect(encodeShadowNodeJsonCanonicalPayload(prepared.caseReport)).toBe(encodeShadowNodeJsonCanonicalPayload(fixture.casePayload));
    expect(prepared.caseReport.executions[1]!.answer!.sources).toEqual(prepared.caseReport.executions[1]!.searchResults);
    expect(prepared.inventory!.documents[0]!.mustPassCases.map((entry) => entry.id)).toEqual(["required-case", "quality-case"]);
  });

  it.each(["incomplete", "timeout", "provider_failure"] as const)("latches a non-required bound quality execution with %s outcome and no caller limitation", (outcome) => {
    const fixture = auditConsumerFixture({ quality: true,
      editExpected: (payload) => (payload.mustPassCases as AuditFixtureJson[]).pop(),
      editCases: (payload) => fixtureSet(payload, ["executions", 1, "outcome"], outcome) });
    const prepared = prepareAuditFixture(fixture);
    expect(prepared.kind).toBe("shadow-audit-incomplete");
    expect(prepared.inventory!.documents[0]!.mustPassCases.map((entry) => entry.id)).toEqual(["required-case"]);
    expect(prepared.caseReport.executions[1]!.searchResults).toHaveLength(1);
    expect(prepared.caseReport.executions[1]!.limitations).toEqual([]);
    expect(prepared.limitations.some((entry) => entry.explanation === "A bound actual engine invocation is incomplete.")).toBe(true);
  });

  it.each([
    ["route", "strong"], ["latencyMs", 0], ["latencyRoute", "fast"], ["topFiles", ["foreign.pdf"]],
    ["sourceWarningCount", 1], ["sourceDangerWarningCount", 1], ["grounded", false], ["executionType", "rule-based"],
    ["expectedHit", false], ["matchedFiles", []],
  ] as const)("refuses a directly contradictory quality report %s", (field, value) => {
    const fixture = auditConsumerFixture({ quality: true, editCases: (payload) =>
      fixtureSet(payload, ["report", "rag", "results", 0, field], typeof value === "object" ? [...value] : value) });
    expect(() => prepareAuditFixture(fixture)).toThrow("Invalid shadow comparison record.");
  });

  it("uses delivered-grounding source-governance policy instead of equating it to raw answer.grounded", () => {
    const fixture = auditConsumerFixture({ quality: true, editCases: (payload) => {
      fixtureSet(payload, ["executions", 1, "answer", "sourceGovernanceWarnings"], [{ code: "outdated_source", severity: "danger", message: "Synthetic outdated source." }]);
      fixtureSet(payload, ["report", "rag", "results", 0, "grounded"], false);
      fixtureSet(payload, ["report", "rag", "results", 0, "sourceWarningCount"], 1);
      fixtureSet(payload, ["report", "rag", "results", 0, "sourceDangerWarningCount"], 1);
      fixtureSet(payload, ["report", "rag", "summary", "grounded_supported_rate"], 0);
      fixtureSet(payload, ["report", "rag", "summary", "substantive_grounded_count"], 0);
      fixtureSet(payload, ["report", "rag", "summary", "substantive_grounded_rate"], 0);
      fixtureSet(payload, ["report", "rag", "summary", "source_warning_count"], 1);
      fixtureSet(payload, ["report", "rag", "summary", "source_governance_warning_rate"], 1);
      fixtureSet(payload, ["report", "threshold_failures"], ["RAG grounded supported rate below threshold"]);
      fixtureSet(payload, ["report", "blocking_threshold_failures"], ["RAG grounded supported rate below threshold"]);
    } });
    const prepared = prepareAuditFixture(fixture);
    expect(prepared.caseReport.executions[1]!.answer!.grounded).toBe(true);
    expect(prepared.caseReport.report.rag.results[0]!.grounded).toBe(false);
  });

  it("blocks ambiguous required textual case IDs without renaming or removing either execution", () => {
    const fixture = auditConsumerFixture({ quality: true, duplicateCase: true }); const prepared = prepareAuditFixture(fixture);
    expect(prepared.kind).toBe("shadow-audit-incomplete"); expect(prepared.inventory).toBeNull(); expect(prepared.audits).toEqual([]);
    const identities: (string | number)[][] = prepared.caseReport.executions.map((execution) => [execution.kind, execution.index, execution.caseId]);
    expect(identities).toEqual([
      ["retrieval", 0, "required-case"], ["quality", 0, "required-case"],
    ]);
  });

  it("blocks same-count replacement identities without inventing a P04 count failure", () => {
    const fixture = auditConsumerFixture({ editExpected: (payload) => fixtureSet(payload, ["populations", "chunks", "units"], [{ family: "chunks", key: auditFixtureUuid(999) }]) });
    const expected = JSON.parse(fixture.input.documents[0]!.reviewedExpectationsEnvelope.canonicalPayload) as AuditFixtureObject;
    const measured = JSON.parse(fixture.input.documents[0]!.measurementsEnvelope.canonicalPayload) as AuditFixtureObject;
    expect(fixtureGet(expected, ["populations", "chunks", "units", 0, "key"])).toBe(auditFixtureUuid(999));
    expect(fixtureGet(measured, ["witnesses", 1, "observations", 0, "unit", "key"])).toBe(auditFixtureUuid(200));
    const prepared = prepareAuditFixture(fixture);
    expect(prepared.kind).toBe("shadow-audit-incomplete");
    expect(prepared.inventory!.documents[0]!.counts.chunks).toEqual({ expected: 1, actual: 1 });
    expect(prepared.audits[0]!.reasons).not.toContain("count_mismatch");
    expect(prepared.limitations.some((entry) => entry.explanation.includes("expected identity set"))).toBe(true);
  });

  it("retains a genuine expected-unit deficit as count-based repair evidence", () => {
    const fixture = auditConsumerFixture({
      editExpected: (payload) => fixtureSet(payload, ["populations", "pages", "units"], [{ family: "pages", key: "1" }, { family: "pages", key: "2" }]),
      editMeasured: (payload) => fixtureSet(payload, ["fields", "counts", "pages", "expected"], 2),
    });
    const prepared = prepareAuditFixture(fixture);
    expect(prepared.kind).toBe("shadow-audit-prepared");
    expect(prepared.inventory!.documents[0]!.counts.pages).toEqual({ expected: 2, actual: 1 });
    expect(prepared.audits[0]).toMatchObject({ eligibleForShadowPlan: true, blockingDisposition: null });
    expect(prepared.audits[0]!.reasons.length).toBeGreaterThan(0);
  });

  it("retains unknown expectations separately without fabricating P04 integrity reasons", () => {
    const fixture = auditConsumerFixture({
      editExpected: (payload) => fixtureSet(payload, ["populations", "pages"], { tag: "unknown", reason: "measurement_unavailable", basis: fixtureGet(payload, ["populations", "pages", "basis"]) }),
      editMeasured: (payload) => fixtureSet(payload, ["fields", "counts", "pages", "expected"], null),
    });
    const prepared = prepareAuditFixture(fixture);
    expect(prepared.kind).toBe("shadow-audit-incomplete");
    expect(prepared.inventory!.documents[0]!.counts.pages.expected).toBeNull();
    expect(prepared.audits[0]!.reasons).not.toContain("integrity_expectation_missing");
    expect(prepared.limitations).not.toEqual([]);
  });

  it.each(["timeout", "provider_failure"] as const)("retains honest absent-result %s diagnostics as incomplete", (outcome) => {
    const fixture = auditConsumerFixture({ editCases: (payload) => fixtureCaseAbsent(payload, outcome, outcome === "timeout" ? "case_timeout" : "provider_failure") });
    const prepared = prepareAuditFixture(fixture);
    expect(prepared.kind).toBe("shadow-audit-incomplete");
    expect(prepared.audits[0]).toMatchObject({ eligibleForShadowPlan: false, blockingDisposition: "quarantine_review" });
    expect(prepared.caseReport.executions[0]!.outcome).toBe(outcome);
  });

  it("retains failed partial output and refuses an invented P04 absence/rank conversion", () => {
    const fixture = auditConsumerFixture({ editCases: (payload) => {
      fixtureSet(payload, ["executions", 0, "outcome"], "provider_failure");
      fixtureSet(payload, ["executions", 0, "documentResults", 0, "failureCodes"], ["provider_failure"]);
    } });
    const prepared = prepareAuditFixture(fixture);
    expect(prepared.kind).toBe("shadow-audit-incomplete"); expect(prepared.inventory).toBeNull();
    expect(prepared.caseReport.executions[0]!.searchResults).toHaveLength(1);
    expect(prepared.caseReport.executions[0]!.documentResults[0]!.actualDocumentRank).toBe(1);
  });

  it.each([
    ["unknown expected structure unit", (p: AuditFixtureObject) => fixtureSet(p, ["checks", 0, "expectedUnit"], { family: "pages", key: "999" })],
    ["structure wrong document singleton", (p: AuditFixtureObject) => fixtureSet(p, ["checks", 0, "expectedUnit", "key"], "other")],
    ["expected source derived only from output", (p: AuditFixtureObject) => fixtureSet(p, ["populations", "pages", "basis"], fixtureGet(p, ["lifecycleEvidence"]))],
    ["unsupported policy", (p: AuditFixtureObject) => fixtureSet(p, ["policyId"], "unknown")],
  ] as const)("refuses independently rebound invalid expectations: %s", (_name, mutate) => {
    const fixture = auditConsumerFixture({ editExpected: mutate });
    expect(() => prepareAuditFixture(fixture)).toThrow("Invalid shadow comparison record.");
  });

  it.each([
    ["scalar population without full rows", (p: AuditFixtureObject) => fixtureSet(p, ["witnesses", 0, "observations"], [])],
    ["duplicate witness", (p: AuditFixtureObject) => (p.witnesses as AuditFixtureJson[]).push((p.witnesses as AuditFixtureJson[])[0]!)],
    ["missing witness", (p: AuditFixtureObject) => (p.witnesses as AuditFixtureJson[]).pop()],
    ["wrong generation", (p: AuditFixtureObject) => fixtureSet(p, ["witnesses", 22, "units", 0, "generation"], auditFixtureUuid(700))],
    ["wrong vector dimension", (p: AuditFixtureObject) => fixtureSet(p, ["witnesses", 13, "dimensions"], 1535)],
    ["wrong vector model", (p: AuditFixtureObject) => fixtureSet(p, ["witnesses", 13, "model"], "unobserved-model")],
    ["wrong vector strategy", (p: AuditFixtureObject) => fixtureSet(p, ["witnesses", 13, "strategy"], "unobserved-strategy")],
    ["quality lacks configuration/source review", (p: AuditFixtureObject) => fixtureSet(p, ["witnesses", 6, "evidence"], [fixtureGet(p, ["witnesses", 6, "evidence", 0])])],
    ["wrong duplicate hash", (p: AuditFixtureObject) => fixtureSet(p, ["witnesses", 11, "groups", 0, "contentHash"], "0".repeat(64))],
    ["dropped relationship", (p: AuditFixtureObject) => fixtureSet(p, ["witnesses", 12, "checked"], [])],
    ["wrong resolved target", (p: AuditFixtureObject) => fixtureSet(p, ["witnesses", 12, "checked", 0, "relationship", "target", "key"], "2")],
    ["wrong provenance value", (p: AuditFixtureObject) => fixtureSet(p, ["witnesses", 14, "value"], fixtureSha("foreign content"))],
    ["unknown producer", (p: AuditFixtureObject) => fixtureSet(p, ["producer", "kind"], "automatic")],
    ["substituted provenance review", (p: AuditFixtureObject) => fixtureSet(p, ["fields", "provenance", "review", "evidenceDigest"], fixtureSha("foreign review"))],
  ] as const)("refuses complete newly bound but inconsistent witnesses: %s", (_name, mutate) => {
    const fixture = auditConsumerFixture({ editMeasured: mutate });
    expect(() => prepareAuditFixture(fixture)).toThrow("Invalid shadow comparison record.");
  });

  it.each([
    ["wrong rank", ["executions", 0, "documentResults", 0, "actualDocumentRank"], 2],
    ["wrong ordered source", ["executions", 0, "searchResults", 0, "document_id"], auditFixtureUuid(999)],
    ["full content replaced by preview", ["executions", 0, "searchResults", 0, "content"], "Synthetic"],
    ["wrong query", ["report", "retrieval", "results", 0, "query"], "other query"],
    ["wrong limit", ["report", "retrieval", "results", 0, "resultCount"], 12],
    ["different case set", ["caseSetDigest"], fixtureSha("other cases")],
    ["different clock", ["comparisonClock"], "2024-02-29T23:59:58.123Z"],
    ["hidden full result", ["executions", 0, "searchResults"], []],
    ["unknown evaluator field", ["report", "passed"], true],
  ] as const)("refuses a rebound full report with %s", (_name, path, value) => {
    const fixture = auditConsumerFixture({ editCases: (payload) => fixtureSet(payload, path, typeof value === "object" ? [...value] : value) });
    expect(() => prepareAuditFixture(fixture)).toThrow("Invalid shadow comparison record.");
  });

  it.each(["missing second input", "missing second admission", "swapped second expectation", "missing private bytes", "policy raw digest replaced by framed digest", "approval self review"] as const)("refuses incomplete or self-supplied authority: %s", (fault) => {
    const fixture = auditConsumerFixture({ members: 2 });
    if (fault === "missing second input") fixture.input.documents.pop();
    if (fault === "missing second admission") fixture.admission.documents.pop();
    if (fault === "swapped second expectation") fixture.input.documents[1]!.reviewedExpectationsEnvelope = fixture.input.documents[0]!.reviewedExpectationsEnvelope;
    if (fault === "missing private bytes") fixture.input.retainedEvidence = fixture.input.retainedEvidence.filter((entry) => entry.tag !== "private_object");
    if (fault === "policy raw digest replaced by framed digest") fixture.admission.documentPolicyBindings[0]!.policyArtifact.digest = fixture.admission.documentPolicyBindings[0]!.policyArtifact.retainedEnvelopeDigest;
    if (fault === "approval self review") {
      const member = fixture.input.documents[1]!;
      const approval = JSON.parse(member.approvalEnvelope.canonicalPayload) as AuditFixtureObject;
      fixtureSet(approval, ["reviewer", "identity"], fixtureGet(approval, ["producer", "identity"]));
      member.approvalEnvelope = fixtureEnvelope(approval, "u04-reviewed-evidence-approval-v1");
      fixture.admission.documents[1]!.approvalEnvelopeDigest = member.approvalEnvelope.digest;
    }
    expect(() => prepareAuditFixture(fixture)).toThrow("Invalid shadow comparison record.");
  });

  it.each(["source_policy_version", "source_catalogue_key"] as const)("refuses a document-owned source with a present null raw %s marker", (key) => {
    const fixture = auditConsumerFixture({ editDocument: (document) => { (document.metadata as AuditFixtureObject)[key] = null; } });
    expect(() => prepareAuditFixture(fixture)).toThrow("Invalid shadow comparison record.");
  });

  it.each(["ownerId", "baselineGenerationId", "executionProfileDigest", "originDigest", "sourcePolicyVersion"] as const)("refuses a rebound expected %s mismatch", (key) => {
    const fixture = auditConsumerFixture({ editExpected: (payload) => fixtureSet(payload, ["source", key],
      key.endsWith("Digest") ? fixtureSha("foreign identity") : key === "sourcePolicyVersion" ? "foreign-policy-v1" : auditFixtureUuid(999)) });
    expect(() => prepareAuditFixture(fixture)).toThrow("Invalid shadow comparison record.");
  });

  it("does not turn an unavailable reviewed structure judgement into a P04 pass boolean", () => {
    const fixture = auditConsumerFixture({ editMeasured: (payload) => fixtureSet(payload, ["witnesses", 7, "result"], "unavailable") });
    const prepared = prepareAuditFixture(fixture);
    expect(prepared.kind).toBe("shadow-audit-incomplete"); expect(prepared.inventory).toBeNull(); expect(prepared.audits).toEqual([]);
    expect(prepared.input.documents[0]!.measurementsEnvelope.canonicalPayload).toContain('"result":"unavailable"');
  });

  it("retains governance failure as actual blocked P04 diagnostics rather than a document-owned bypass", () => {
    const fixture = auditConsumerFixture({ editDocument: (document) => { (document.metadata as AuditFixtureObject).source_excluded = true; } });
    const prepared = prepareAuditFixture(fixture);
    expect(prepared.kind).toBe("shadow-audit-incomplete");
    expect(prepared.audits[0]).toMatchObject({ eligibleForShadowPlan: false, blockingDisposition: "quarantine_review" });
  });

  it("keeps original historical pretty bytes, newline and BOM distinct from the framed envelope", () => {
    const fixture = auditConsumerFixture(); const prepared = prepareAuditFixture(fixture);
    const historical = prepared.input.documents[0]!.historicalArtifact;
    const payload = JSON.parse(historical.envelope.canonicalPayload) as { bytes: { content: string } };
    const original = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{\n  "legacy": true\n}\n')]);
    expect(Buffer.from(payload.bytes.content, "base64")).toEqual(original);
    expect(historical.artifactDigest).toBe(fixtureSha(original));
    expect(historical.artifactDigest).not.toBe(historical.envelope.digest);
    expect(historical.expectedStateDigest).toBe("a".repeat(64));
    expect(prepared.inventory!.documents[0]!.expectedStateDigest).toBe(fixture.input.originEnvelope.digest.slice(7));
  });

  it("retains independently associated arbitrary historical bytes without claiming old JSON semantic validity", () => {
    const fixture = auditConsumerFixture(); const member = fixture.input.documents[0]!;
    const bytes = Buffer.from([0xff, 0xfe, 0x00, 0x0a]);
    member.historicalArtifact.envelope = fixtureEnvelope({ kind: "u04-historical-audit-bytes-v1", documentId: member.documentId,
      expectedStateDigest: null, bytes: { encoding: "base64", content: bytes.toString("base64") } });
    member.historicalArtifact.expectedStateDigest = null; member.historicalArtifact.artifactDigest = fixtureSha(bytes);
    fixture.admission.documents[0]!.historicalArtifactDigest = member.historicalArtifact.artifactDigest;
    fixture.admission.documents[0]!.historicalEnvelopeDigest = member.historicalArtifact.envelope.digest;
    const prepared = prepareAuditFixture(fixture);
    expect(prepared.input.documents[0]!.historicalArtifact).toEqual(member.historicalArtifact);
    expect(prepared.kind).toBe("shadow-audit-prepared");
  });

  it.each(["changed bytes", "noncanonical base64", "wrong old digest", "wrong member", "missing wrapper admission", "swapped wrapper admission"] as const)("refuses substituted historical evidence: %s", (fault) => {
    const fixture = auditConsumerFixture({ members: 2 }); const historical = fixture.input.documents[0]!.historicalArtifact;
    const payload = JSON.parse(historical.envelope.canonicalPayload) as AuditFixtureObject;
    if (fault === "changed bytes") fixtureSet(payload, ["bytes", "content"], Buffer.from("replacement").toString("base64"));
    if (fault === "noncanonical base64") fixtureSet(payload, ["bytes", "content"], `${String(fixtureGet(payload, ["bytes", "content"]))}\n`);
    if (fault === "wrong old digest") { payload.expectedStateDigest = "b".repeat(64); historical.expectedStateDigest = "b".repeat(64); }
    if (fault === "wrong member") payload.documentId = fixture.input.documents[1]!.documentId;
    historical.envelope = fixtureEnvelope(payload);
    if (fault === "missing wrapper admission") Reflect.deleteProperty(fixture.admission.documents[0]!, "historicalEnvelopeDigest");
    if (fault === "swapped wrapper admission") fixture.admission.documents[0]!.historicalEnvelopeDigest = fixture.admission.documents[1]!.historicalEnvelopeDigest;
    expect(() => prepareAuditFixture(fixture)).toThrow("Invalid shadow comparison record.");
  });

  it.each(["changed bytes", "noncanonical base64", "wrong member"] as const)("refuses inner historical %s even with explicitly rebound synthetic wrapper admission", (fault) => {
    const fixture = auditConsumerFixture(); const member = fixture.input.documents[0]!; const historical = member.historicalArtifact;
    const payload = JSON.parse(historical.envelope.canonicalPayload) as AuditFixtureObject;
    if (fault === "changed bytes") fixtureSet(payload, ["bytes", "content"], Buffer.from("changed original bytes").toString("base64"));
    if (fault === "noncanonical base64") fixtureSet(payload, ["bytes", "content"], `${String(fixtureGet(payload, ["bytes", "content"]))}\n`);
    if (fault === "wrong member") payload.documentId = auditFixtureUuid(888);
    historical.envelope = fixtureEnvelope(payload);
    fixture.admission.documents[0]!.historicalEnvelopeDigest = historical.envelope.digest;
    expect(() => prepareAuditFixture(fixture)).toThrow("Invalid shadow comparison record.");
  });
});

describe("private-object identity uses all seven exact reference fields", () => {
  const ref = { tag: "private_object", bucket: "synthetic-bucket", objectPath: "fixture.bin", objectVersion: null,
    sha256: "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", byteLength: 0, mediaType: "application/octet-stream" };
  it("matches the independent literal vector and ignores only object property order", () => {
    expect(shadowPrivateObjectIdentityV1(ref)).toBe("sha256:55e52f679431feef1264444f5cdf0c5239a9b97066ff1d346a1c29c5a0bc9992");
    expect(shadowPrivateObjectIdentityV1(Object.fromEntries(Object.entries(ref).reverse()))).toBe(shadowPrivateObjectIdentityV1(ref));
  });
  it.each([
    ["bucket", "other-bucket"], ["objectPath", "Fixture.bin"], ["objectVersion", "v1"], ["sha256", `sha256:${"1".repeat(64)}`],
    ["byteLength", 1], ["mediaType", "application/pdf"],
  ] as const)("changes identity when %s changes", (key, value) => {
    expect(shadowPrivateObjectIdentityV1({ ...ref, [key]: value })).not.toBe(shadowPrivateObjectIdentityV1(ref));
  });
  it.each(["tag", "objectVersion"] as const)("refuses an omitted required %s", (key) => {
    const missing = { ...ref }; Reflect.deleteProperty(missing, key);
    expect(() => shadowPrivateObjectIdentityV1(missing)).toThrow();
  });
});

type ControlFixtureCheckpoint={controlRevision:number;ownNodeJobs:AuditFixtureObject[];ownStages:AuditFixtureObject[]};
function controlFixture(kind:"enqueue"|"claim"|"heartbeat"|"progress"|"start_stage"|"finish_stage"|"seal"|"fail",g0:string|null=auditFixtureUuid(50)) {
  const tx="2024-02-29T23:59:50.000000Z",now="2024-02-29T23:59:51.123456Z";
  const binding={documentId:auditFixtureUuid(1),jobId:auditFixtureUuid(700),candidateGenerationId:auditFixtureUuid(800),planDigest:fixtureSha("synthetic plan"),
    baselineGenerationId:g0,authorityDigest:fixtureSha("synthetic authority"),workerId:kind==="enqueue"?null:"synthetic-worker",firstLeaseToken:kind==="enqueue"?null:auditFixtureUuid(701),leaseDurationSeconds:60};
  const pending:Database["public"]["Tables"]["ingestion_jobs"]["Row"]={id:binding.jobId,document_id:binding.documentId,batch_id:null,status:"pending",stage:"queued",progress:0,error_message:null,
    attempt_count:0,max_attempts:1,locked_at:null,locked_by:null,next_run_at:now,started_at:null,completed_at:null,created_at:tx,updated_at:tx,
    lease_token:null,lease_expected_generation_id:null,lease_write_generation_id:null,lease_authority_digest:null,lease_expires_at:null,lease_duration_seconds:null,
    operation:"shadow_reindex",requested_generation_id:binding.candidateGenerationId,shadow_plan_digest:binding.planDigest};
  const processing:AuditFixtureObject={...pending,status:"processing",attempt_count:1,locked_at:tx,locked_by:"synthetic-worker",next_run_at:null,
    lease_token:auditFixtureUuid(701),lease_expected_generation_id:g0,lease_write_generation_id:binding.candidateGenerationId,
    lease_authority_digest:binding.authorityDigest,lease_expires_at:"2024-03-01T00:00:50.000000Z",lease_duration_seconds:60};
  const stage:AuditFixtureObject={id:auditFixtureUuid(702),job_id:binding.jobId,document_id:binding.documentId,stage_name:"synthetic stage",stage_status:"started",
    error_class:null,retry_count:0,metadata:{synthetic:true},artifact_counts:{},error_message:null,started_at:tx,finished_at:null,created_at:tx,
    job_kind:"node",lease_token:binding.firstLeaseToken,index_generation_id:g0};
  const before:ControlFixtureCheckpoint|null=kind==="enqueue"?null:{controlRevision:1,ownNodeJobs:[kind==="claim"?pending:processing],ownStages:kind==="finish_stage"?[stage]:[]};
  const after:ControlFixtureCheckpoint={controlRevision:kind==="enqueue"?0:2,ownNodeJobs:[structuredClone(kind==="enqueue"?pending:processing)],ownStages:[]};
  const intent:AuditFixtureObject={kind,binding};
  if(kind==="enqueue")intent.nextRunAt=now;
  if(kind==="claim"){after.ownNodeJobs[0]!.locked_at=now;after.ownNodeJobs[0]!.lease_expires_at="2024-03-01T00:00:51.123456Z";}
  if(kind==="heartbeat"||kind==="progress"){
    after.ownNodeJobs[0]!.locked_at="2024-02-29T23:59:51.123400Z";after.ownNodeJobs[0]!.lease_expires_at="2024-03-01T00:00:51.123450Z";
    if(kind==="progress"){intent.stage="reading";intent.progress=7;after.ownNodeJobs[0]!.stage="reading";after.ownNodeJobs[0]!.progress=7;}
  }
  if(kind==="start_stage"){intent.stageId=stage.id!;intent.stage=stage.stage_name!;intent.metadata=stage.metadata!;after.ownStages=[structuredClone(stage)];}
  if(kind==="finish_stage"){intent.stageId=stage.id!;intent.ok=true;intent.counts={chunks:1};intent.error=null;
    after.ownStages=[{...stage,stage_status:"completed",finished_at:now,artifact_counts:{chunks:1}}];}
  if(kind==="seal")Object.assign(after.ownNodeJobs[0]!,{status:"completed",stage:"shadow_staged",progress:100,locked_by:null,locked_at:null,completed_at:now});
  if(kind==="fail"){intent.error="synthetic_failure";Object.assign(after.ownNodeJobs[0]!,{status:"failed",stage:"shadow_failed",error_message:"synthetic_failure",next_run_at:null,locked_by:null,locked_at:null,completed_at:now});}
  return {before,intent,after,clock:{transactionStartedAt:tx,observedAt:now}};
}
function stateFixture(options:AuditFixtureOptions={}) {
  const fixture=auditConsumerFixture(options);
  const members=fixture.memberPayloads.map((payload,index)=>({documentId:auditFixtureUuid(index+1),ownerId:auditFixtureUuid(99),baselineGenerationId:options.baselineNull?null:auditFixtureUuid(50),
    jobId:auditFixtureUuid(700+index),planDigest:fixtureSha("synthetic plan"),firstLeaseToken:null as string|null,authorityDigest:String(payload.source.authorityDigest)}));
  const current=JSON.parse(fixture.input.originEnvelope.canonicalPayload) as AuditFixtureObject;
  current.capturedAt="2024-03-01T00:00:00.123456Z";
  const input={version:1,phase:"pre_enqueue",binding:{projectRef:fixture.profile.target.projectRef,planDigest:fixtureSha("synthetic plan"),candidateGenerationId:auditFixtureUuid(800),members},
    auditInput:fixture.input,currentOriginEnvelope:fixtureEnvelope(current,"baseline","pg-jsonb-text-v1"),
    clock:{transactionStartedAt:"2024-02-29T23:59:59.000000Z",observedAt:"2024-03-01T00:00:00.123456Z"}};
  return {fixture,input,current};
}
function mutateCurrent(state:ReturnType<typeof stateFixture>,table:string,index:number,mutate:(row:AuditFixtureObject)=>void){
  const envelope=fixtureGet(state.current,["rows",table,index]) as AuditFixtureObject;
  const row=JSON.parse(String(envelope.canonicalPayload)) as AuditFixtureObject;mutate(row);
  fixtureSet(state.current,["rows",table,index],fixtureEnvelope(row,"baseline","pg-jsonb-text-v1"));
  state.input.currentOriginEnvelope=fixtureEnvelope(state.current,"baseline","pg-jsonb-text-v1");
}

describe("U04 captured state and exact control transitions",()=>{
  it.each(["enqueue","claim","heartbeat","progress","start_stage","finish_stage","fail"] as const)("validates the exact %s after-image without mutating inputs",(kind)=>{
    const value=controlFixture(kind);const original=JSON.stringify(value);
    expect(validateShadowControlTransitionV1(value.before,value.intent,value.after,value.clock)).toMatchObject({ok:true,kind:"control_transition_valid"});
    expect(JSON.stringify(value)).toBe(original);
  });
  it("does not turn a valid terminal Node shape into seal readiness",()=>{
    const v=controlFixture("seal");expect(validateShadowControlTransitionV1(v.before,v.intent,v.after,v.clock)).toMatchObject({ok:false,reason:"unsealed_wave"});
  });
  it.each(["claim","start_stage","finish_stage","fail"] as const)("retains legacy-null G0 and consumed nullable schedule for %s",(kind)=>{
    const v=controlFixture(kind,null);expect(validateShadowControlTransitionV1(v.before,v.intent,v.after,v.clock)).toMatchObject({ok:true});
    expect(v.after.ownNodeJobs[0]!.next_run_at).toBeNull();
  });
  it.each([
    ["wrong worker",(v:ReturnType<typeof controlFixture>)=>{v.after.ownNodeJobs[0]!.locked_by="foreign";}],
    ["wrong token",(v:ReturnType<typeof controlFixture>)=>{v.after.ownNodeJobs[0]!.lease_token=auditFixtureUuid(999);}],
    ["wrong C",(v:ReturnType<typeof controlFixture>)=>{v.after.ownNodeJobs[0]!.requested_generation_id=auditFixtureUuid(999);}],
    ["wrong plan digest",(v:ReturnType<typeof controlFixture>)=>{v.after.ownNodeJobs[0]!.shadow_plan_digest=fixtureSha("foreign plan");}],
    ["attempt two",(v:ReturnType<typeof controlFixture>)=>{v.after.ownNodeJobs[0]!.attempt_count=2;}],
    ["batch linkage",(v:ReturnType<typeof controlFixture>)=>{v.after.ownNodeJobs[0]!.batch_id=auditFixtureUuid(999);}],
    ["unauthorized start",(v:ReturnType<typeof controlFixture>)=>{v.after.ownNodeJobs[0]!.started_at=v.clock.observedAt;}],
    ["not null schedule",(v:ReturnType<typeof controlFixture>)=>{v.after.ownNodeJobs[0]!.next_run_at=v.clock.observedAt;}],
    ["wrong revision",(v:ReturnType<typeof controlFixture>)=>{v.after.controlRevision=4;}],
  ] as const)("refuses claim %s",(_name,mutate)=>{
    const v=controlFixture("claim");mutate(v);expect(validateShadowControlTransitionV1(v.before,v.intent,v.after,v.clock)).toMatchObject({ok:false,reason:"control_transition_invalid"});
  });
  it.each(["missing timestamp","invalid timestamp","expired token","transaction time replaced by wall time","rounded expiry"])("refuses %s without temporal normalization",(fault)=>{
    const v=controlFixture("heartbeat");
    if(fault==="missing timestamp")delete v.after.ownNodeJobs[0]!.next_run_at;
    if(fault==="invalid timestamp")v.after.ownNodeJobs[0]!.next_run_at="not-a-timestamp";
    if(fault==="expired token")v.before!.ownNodeJobs[0]!.lease_expires_at=v.clock.observedAt;
    if(fault==="transaction time replaced by wall time")v.after.ownNodeJobs[0]!.updated_at=v.clock.observedAt;
    if(fault==="rounded expiry")v.after.ownNodeJobs[0]!.lease_expires_at="2024-03-01T00:00:51.123000Z";
    expect(validateShadowControlTransitionV1(v.before,v.intent,v.after,v.clock).ok).toBe(false);
  });
  it("refuses stage C because accepted stages retain Fence G0",()=>{
    const v=controlFixture("start_stage");v.after.ownStages[0]!.index_generation_id=auditFixtureUuid(800);
    expect(validateShadowControlTransitionV1(v.before,v.intent,v.after,v.clock)).toMatchObject({ok:false,reason:"control_transition_invalid"});
  });
  it.each([{members:2},{baselineNull:true},{catalogue:true},{manualAlias:true}] satisfies AuditFixtureOptions[])("compares complete retained capture scope %j",(options)=>{
    const state=stateFixture(options);const before=JSON.stringify(state);
    expect(compareShadowStateV1(state.input,state.fixture.admission)).toMatchObject({ok:true,kind:"origin_equal"});
    expect(state.input.currentOriginEnvelope.digest).not.toBe(state.fixture.input.originEnvelope.digest);
    if("baselineNull" in options&&options.baselineNull){
      const prepared=prepareShadowAuditV1(state.fixture.input,state.fixture.admission);
      expect(prepared.kind).toBe("shadow-audit-prepared");
      expect(prepared.inventory?.documents[0]).toMatchObject({activeGenerationId:null,chunkGenerations:[]});
      expect(prepared.audits[0]).toMatchObject({action:"shadow_reindex",diagnosticAction:"shadow_reindex",eligibleForShadowPlan:true,blockingDisposition:null});
      expect(prepared.audits[0]!.reasons).toContain("generation_incomplete");
      expect(prepared.limitations).toEqual([]);
      expect(Object.hasOwn(state.fixture.data[0]!.document.metadata as AuditFixtureObject,"index_generation_id")).toBe(false);
      expect(state.fixture.data[0]!.chunk.index_generation_id).toBeNull();
      expect(state.fixture.memberPayloads[0]!.measured.witnesses).toEqual(expect.arrayContaining([
        expect.objectContaining({tag:"generations",result:[],units:[expect.objectContaining({generation:null})]})]));
    }
    expect(JSON.stringify(state)).toBe(before);
  });
  it("refuses a fully bound legacy-null chunk as evidence of a non-null committed generation",()=>{
    const state=stateFixture({nullChunk:true});
    expect(state.fixture.data[0]!.document.index_generation_id).toBe(auditFixtureUuid(50));
    expect(state.fixture.data[0]!.chunk.index_generation_id).toBeNull();
    expect(state.fixture.memberPayloads[0]!.measured.fields).toMatchObject({chunkGenerations:[]});
    expect(()=>prepareShadowAuditV1(state.fixture.input,state.fixture.admission)).toThrow("Invalid shadow comparison record.");
    expect(compareShadowStateV1(state.input,state.fixture.admission)).toMatchObject({ok:false,
      reason:"origin_binding_unavailable",fieldPaths:["auditAdmission"]});
  });
  it.each([false,true])("returns the fresh P04 identity independently of historical-null=%s",(historicalNull)=>{
    const state=stateFixture({historicalNull});const historical=state.fixture.input.documents[0]!.historicalArtifact;
    const before=JSON.stringify(historical),fresh=state.fixture.input.originEnvelope.digest.slice(7);
    expect(historical.expectedStateDigest).toBe(historicalNull?null:"a".repeat(64));
    expect(historical.expectedStateDigest).not.toBe(fresh);
    expect(compareShadowStateV1(state.input,state.fixture.admission)).toMatchObject({ok:true,
      p04ExpectedStateDigests:[{documentId:auditFixtureUuid(1),expectedStateDigest:fresh}]});
    expect(fresh).toMatch(/^[0-9a-f]{64}$/);expect(JSON.stringify(historical)).toBe(before);
  });
  it.each([
    ["same-count chunk replacement","document_chunks","content","different complete content"],
    ["description","documents","description","changed description"],
    ["owner","documents","owner_id",auditFixtureUuid(88)],
    ["live generation","documents","index_generation_id",auditFixtureUuid(66)],
    ["stored microseconds","document_pages","created_at","2024-02-29T23:59:59.123457Z"],
  ] as const)("refuses %s drift while retaining complete original rows",(_name,table,field,value)=>{
    const state=stateFixture();mutateCurrent(state,table,0,(row)=>{row[field]=value;});
    expect(compareShadowStateV1(state.input,state.fixture.admission).ok).toBe(false);
    expect(state.fixture.input.originEnvelope).toEqual(state.input.auditInput.originEnvelope);
  });
  it.each(["inserted foreign job","removed original row","incomplete table","wrong profile","wrong origin admission"])("refuses %s",(fault)=>{
    const state=stateFixture();
    if(fault==="inserted foreign job")fixtureSet(state.current,["rows","ingestion_jobs"],[fixtureEnvelope({...controlFixture("enqueue").after.ownNodeJobs[0],id:auditFixtureUuid(955),operation:"standard",requested_generation_id:null,shadow_plan_digest:null},"baseline","pg-jsonb-text-v1")]);
    if(fault==="removed original row")fixtureSet(state.current,["rows","document_pages"],[]);
    if(fault==="incomplete table")Reflect.deleteProperty(fixtureGet(state.current,["rows"]) as AuditFixtureObject,"document_pages");
    if(fault==="wrong profile")state.current.executionProfileEnvelope=profileFixture().configuration;
    if(fault==="wrong origin admission")state.fixture.admission.originDigest=fixtureSha("foreign origin");
    state.input.currentOriginEnvelope=fixtureEnvelope(state.current,"baseline","pg-jsonb-text-v1");
    expect(compareShadowStateV1(state.input,state.fixture.admission).ok).toBe(false);
  });
  it.each(["before_seal","after_seal","evaluate"])("does not infer %s completeness from absent receipt validators",(phase)=>{
    const state=stateFixture();state.input.phase=phase;
    expect(compareShadowStateV1(state.input,state.fixture.admission).ok).toBe(false);
  });
});

describe("U04 positive manual alias lineage representation",()=>{
  it("requires separate admission of a disabled outside-wave alias's complete review and row",()=>{
    const fixture=auditConsumerFixture({manualAlias:true});const prepared=prepareAuditFixture(fixture);
    expect(prepared.kind).toBe("shadow-audit-prepared");
    expect(prepared.executionProfile.manualAliasIds).toEqual([auditFixtureUuid(11)]);
    expect(JSON.parse(fixture.rows.rag_aliases![0]!.canonicalPayload)).toMatchObject({enabled:false,metadata:{}});
    fixture.admission.manualAliasReviewBindings=[];
    expect(()=>prepareAuditFixture(fixture)).toThrow("Invalid shadow comparison record.");
  });
  it.each(["missing review","extra review","unsorted reviews","changed owner","generated lineage","missing basis","self review","changed target","changed mode","substituted bytes"])("refuses %s",(fault)=>{
    const input=profileFixture();
    if(fault==="missing review")input.manualAliasReviews.pop();
    else if(fault==="extra review")input.manualAliasReviews.push(input.manualAliasReviews[0]!);
    else if(fault==="unsorted reviews")input.manualAliasReviews.reverse();
    else{
      const payload=JSON.parse(input.manualAliasReviews[0]!.canonicalPayload) as AuditFixtureObject;
      if(fault==="changed owner")payload.ownerId=auditFixtureUuid(88);
      if(fault==="generated lineage"){
        const generated=manualReviewFixture(input.target.projectRef,input.manualAliasIds[0]!,row=>{row.metadata={generated_by:"local-worker"};});
        input.manualAliasReviews[0]=generated.review;
      }else{
        if(fault==="missing basis")payload.basis=[];
        if(fault==="self review")fixtureSet(payload,["reviewer","identity"],payload.producerIdentity!);
        if(fault==="changed target")fixtureSet(payload,["target","projectRef"],"foreign-target");
        if(fault==="changed mode")payload.evidenceMode="real";
        if(fault==="substituted bytes")fixtureSet(payload,["basis",0,"entry","envelope","canonicalPayload"],"substituted");
        input.manualAliasReviews[0]=fixtureEnvelope(payload);
      }
    }
    expect(()=>parsedProfile(input)).toThrow(fault==="substituted bytes"?"Invalid shadow envelope bytes.":"Invalid shadow comparison record.");
  });
  it("detects enabled or content drift despite unchanged alias IDs and newly framed capture",()=>{
    const state=stateFixture({manualAlias:true});mutateCurrent(state,"rag_aliases",0,row=>{row.enabled=true;row.alias="changed";});
    expect(compareShadowStateV1(state.input,state.fixture.admission).ok).toBe(false);
  });
});

function reservedStateFixture(building=false){
  const state=stateFixture();state.input.phase=building?"building":"before_claim";
  const member=state.input.binding.members[0]!,c=state.input.binding.candidateGenerationId;
  member.firstLeaseToken=building?auditFixtureUuid(701):null;
  const job:AuditFixtureObject={...controlFixture("enqueue").after.ownNodeJobs[0]!,created_at:"2024-02-29T23:59:59.500000Z",updated_at:"2024-02-29T23:59:59.500000Z",next_run_at:"2024-02-29T23:59:59.500000Z"};
  if(building)Object.assign(job,{status:"processing",attempt_count:1,next_run_at:null,locked_at:"2024-02-29T23:59:59.800000Z",locked_by:"synthetic-worker",
    lease_token:member.firstLeaseToken,lease_expected_generation_id:member.baselineGenerationId,lease_write_generation_id:c,
    lease_authority_digest:member.authorityDigest,lease_expires_at:"2024-03-01T00:00:59.800000Z",lease_duration_seconds:60});
  const manifest=pendingInventoryFixture();manifest.documentId=member.documentId;manifest.jobId=member.jobId;manifest.candidateGenerationId=c;
  const bundle=fixtureEnvelope({kind:"synthetic-opaque-retained-bundle",originalOrigin:state.fixture.input.originEnvelope,retainedEvidence:state.fixture.input.retainedEvidence},"baseline","pg-jsonb-text-v1");
  const ledger:AuditFixtureObject={document_id:member.documentId,index_generation_id:c,owner_id:member.ownerId,baseline_generation_id:member.baselineGenerationId,
    expected_state_digest:state.fixture.input.originEnvelope.digest.slice(7),authority_digest:member.authorityDigest,source_binding:state.fixture.memberPayloads[0]!.source,
    job_id:member.jobId,first_lease_token:member.firstLeaseToken,claimed_at:building?job.locked_at!:null,state:building?"building":"reserved",
    expected_inventory_digest:null,inventory_digest:null,candidate_projection_digest:null,baseline_bundle_digest:bundle.digest,
    stage_receipt:null,stage_receipt_digest:null,staged_at:null,control_revision:building?1:0,
    control_snapshot:{controlRevision:building?1:0,ownNodeJobs:[job],ownStages:[]},original_origin_envelope:state.fixture.input.originEnvelope,
    inventory_manifest:JSON.parse(JSON.stringify(manifest)) as AuditFixtureJson};
  const baseline:AuditFixtureObject={document_id:member.documentId,candidate_generation_id:c,baseline_generation_id:member.baselineGenerationId,
    expected_state_digest:ledger.expected_state_digest!,bundle_version:1,bundle_payload:bundle,bundle_digest:bundle.digest,captured_at:"2024-02-29T23:59:59.500000Z"};
  const wave:AuditFixtureObject={candidate_generation_id:c,plan_digest:state.input.binding.planDigest,plan_version:1,project_ref:state.input.binding.projectRef,
    source_policy_version:state.fixture.profile.sourcePolicyVersion,audit_digest:fixtureSha("synthetic audit"),population_fingerprint:fixtureSha("synthetic population"),
    recovery_evidence_digest:fixtureSha("synthetic recovery"),baseline_evaluation_digest:fixtureSha("synthetic evaluation"),operation_manifest_digest:fixtureSha("synthetic operation"),
    plan_payload:{kind:"synthetic retained plan"},created_at:"2024-02-29T23:59:59.500000Z",prepared_origin_digest:state.fixture.input.originEnvelope.digest,
    execution_profile_digest:state.fixture.admission.executionProfileDigest,case_set_digest:state.fixture.profile.cases.digest,
    baseline_report:state.fixture.casePayload,baseline_report_digest:state.fixture.input.caseResultsEnvelope.digest};
  const bindings:{table:string;rowDigest:string}[]=[];
  for(const [table,row] of [["ingestion_jobs",job],["document_index_generations",ledger],["document_generation_baselines",baseline],["shadow_reindex_waves",wave]] as const){
    const envelope=fixtureEnvelope(row,"baseline","pg-jsonb-text-v1");fixtureSet(state.current,["rows",table],[envelope]);bindings.push({table,rowDigest:envelope.digest});
  }
  bindings.sort((a,b)=>a.table<b.table?-1:a.table>b.table?1:a.rowDigest<b.rowDigest?-1:1);
  state.input.currentOriginEnvelope=fixtureEnvelope(state.current,"baseline","pg-jsonb-text-v1");
  return {...state,bindings};
}
function rebindStateRow(state:ReturnType<typeof reservedStateFixture>,table:string,index:number,mutate:(row:AuditFixtureObject)=>void){
  const prior=String(fixtureGet(state.current,["rows",table,index,"digest"]));
  mutateCurrent(state,table,index,mutate);
  const binding=state.bindings.find(entry=>entry.table===table&&entry.rowDigest===prior);
  if(!binding)throw new Error("Missing synthetic after-image binding.");
  binding.rowDigest=String(fixtureGet(state.current,["rows",table,index,"digest"]));
  state.bindings.sort((a,b)=>a.table<b.table?-1:a.table>b.table?1:a.rowDigest<b.rowDigest?-1:1);
}
function appendStateRow(state:ReturnType<typeof reservedStateFixture>,table:string,row:AuditFixtureObject){
  const envelope=fixtureEnvelope(row,"baseline","pg-jsonb-text-v1");
  (fixtureGet(state.current,["rows",table]) as AuditFixtureJson[]).push(envelope);
  state.bindings.push({table,rowDigest:envelope.digest});
  state.bindings.sort((a,b)=>a.table<b.table?-1:a.table>b.table?1:a.rowDigest<b.rowDigest?-1:1);
  state.input.currentOriginEnvelope=fixtureEnvelope(state.current,"baseline","pg-jsonb-text-v1");
}
describe("U04 separately admitted nonterminal after-image equality",()=>{
  it.each([false,true])("compares complete reserved/building private after-images, building=%s",(building)=>{
    const state=reservedStateFixture(building);const serialized=JSON.stringify(state);
    expect(compareShadowStateV1(state.input,state.fixture.admission,state.bindings)).toMatchObject({ok:true,kind:"sanctioned_u04_state"});
    expect(JSON.stringify(state)).toBe(serialized);
    expect(fixtureGet(state.current,["rows","document_generation_baselines",0,"canonicalPayload"])).not.toBe(state.fixture.input.originEnvelope.canonicalPayload);
  });
  it.each(["member","outer","wave"])("refuses a separately rebound foreign %s plan digest",(field)=>{
    const state=reservedStateFixture();const foreign=fixtureSha("foreign plan");
    if(field==="member")state.input.binding.members[0]!.planDigest=foreign;
    if(field==="outer")state.input.binding.planDigest=foreign;
    if(field==="wave")rebindStateRow(state,"shadow_reindex_waves",0,row=>{row.plan_digest=foreign;});
    expect(compareShadowStateV1(state.input,state.fixture.admission,state.bindings)).toMatchObject({ok:false,
      reason:field==="member"?"origin_digest_mismatch":"invalid_input",fieldPaths:field==="member"?["binding"]:["state"]});
  });
  it.each(["missing separate binding","modified checkpoint","attempt two","expired lease","foreign extra C row"])("refuses %s",(fault)=>{
    const state=reservedStateFixture(true);
    if(fault==="missing separate binding")state.bindings.pop();
    if(fault==="modified checkpoint")rebindStateRow(state,"document_index_generations",0,row=>fixtureSet(row,["control_snapshot","ownNodeJobs",0,"progress"],42));
    if(fault==="attempt two"||fault==="expired lease"){
      rebindStateRow(state,"ingestion_jobs",0,row=>{if(fault==="attempt two")row.attempt_count=2;else row.lease_expires_at=state.input.clock.observedAt;});
      const job=JSON.parse(String(fixtureGet(state.current,["rows","ingestion_jobs",0,"canonicalPayload"]))) as AuditFixtureObject;
      rebindStateRow(state,"document_index_generations",0,row=>fixtureSet(row,["control_snapshot","ownNodeJobs",0],job));
    }
    if(fault==="foreign extra C row"){
      const chunk=JSON.parse(state.fixture.rows.document_chunks![0]!.canonicalPayload) as AuditFixtureObject;chunk.id=auditFixtureUuid(955);chunk.index_generation_id=auditFixtureUuid(800);
      fixtureSet(chunk,["metadata","index_generation_id"],auditFixtureUuid(800));
      (fixtureGet(state.current,["rows","document_chunks"]) as AuditFixtureJson[]).push(fixtureEnvelope(chunk,"baseline","pg-jsonb-text-v1"));
      state.input.currentOriginEnvelope=fixtureEnvelope(state.current,"baseline","pg-jsonb-text-v1");
    }
    // Attempt two triggers both lease_lost and restart-required; the adopted earlier refusal wins.
    const expected=fault==="modified checkpoint"?{reason:"own_control_changed",fieldPaths:["control_snapshot.ownNodeJobs"]}:
      fault==="attempt two"||fault==="expired lease"?{reason:"lease_lost",fieldPaths:["ingestion_jobs.lease"]}:
      fault==="foreign extra C row"?{reason:"baseline_evidence_changed",fieldPaths:["document_chunks"]}:
      {reason:"baseline_evidence_changed",fieldPaths:["shadow_reindex_waves"]};
    expect(compareShadowStateV1(state.input,state.fixture.admission,state.bindings)).toMatchObject({ok:false,...expected});
  });
  it("refuses pre-seal readiness even when exact nonterminal after-images are separately admitted",()=>{
    const state=reservedStateFixture(true);state.input.phase="before_seal";
    expect(compareShadowStateV1(state.input,state.fixture.admission,state.bindings)).toMatchObject({ok:false,reason:"unsealed_wave",fieldPaths:["stage_receipt.semanticValidation"]});
  });
});

function deepCandidateStateFixture(finalized:boolean){
  const state=reservedStateFixture(true),member=state.input.binding.members[0]!,c=state.input.binding.candidateGenerationId,d=auditFixtureUuid(810);
  const view={tag:"candidate",source:state.fixture.memberPayloads[0]!.source,candidateGenerationId:c,jobId:member.jobId,
    firstLeaseToken:member.firstLeaseToken!,artifactGenerationId:d};
  const section:AuditFixtureObject={id:auditFixtureUuid(820),document_id:member.documentId,owner_id:member.ownerId,section_index:0,
    heading:"Synthetic section",heading_path:["Synthetic section"],page_start:null,page_end:null,chunk_ids:[],summary:"Full synthetic planned section.",
    tags:[],extraction_quality:"good",index_generation_id:d,producer:"local-worker",artifact_generation_id:d,
    metadata:{generated_by:"local-worker",artifact_generation_id:d,index_generation_id:d,ingestion_lease_token:member.firstLeaseToken},
    created_at:auditFixtureTime,updated_at:auditFixtureTime};
  const planned=fixtureEnvelope({producer:"local-worker",producerVersion:"rag-deep-memory-v1",binding:view,units:[{family:"sections",key:section.id!,output:section}]});
  const declaration:AuditFixtureObject={firstLeaseToken:member.firstLeaseToken!,producer:{name:"local-worker",version:"rag-deep-memory-v1",outputManifestDigest:planned.digest},
    outputManifestEnvelope:planned,artifactGenerationId:d,population:{tag:"known",expectedUnits:[{family:"sections",key:section.id!}],reason:null,
      basis:[{ref:{tag:"retained_payload",envelopeDigest:planned.digest,representation:"producer_json",mediaType:"application/json",
        byteLength:Buffer.byteLength(planned.canonicalPayload,"utf8")},path:["units"]}]}};
  rebindStateRow(state,"document_index_generations",0,row=>{
    const families=fixtureGet(row,["inventory_manifest","families"]) as AuditFixtureObject[];
    const family=families.find(entry=>entry.family==="sections")!;
    fixtureSet(family,["groups",0],{groupKey:"deep_memory",state:"declared",declaration});
  });
  const originalUnit=fixtureEnvelope(section);
  if(finalized){section.index_generation_id=c;fixtureSet(section,["metadata","index_generation_id"],c);}
  appendStateRow(state,"document_sections",section);
  const artifact=fixtureEnvelope(section,"baseline","pg-jsonb-text-v1");
  const unit:AuditFixtureObject={document_id:member.documentId,index_generation_id:c,family:"sections",unit_key:section.id!,lease_token:member.firstLeaseToken!,
    expected:true,required:true,disposition:"retained",reason_code:null,limitations:[],producer:"local-worker",artifact_generation_id:d,
    artifact_ref:{tag:"candidate_row",owner:"section",rowId:section.id!,rowDigest:artifact.digest},content_digest:artifact.digest,source_binding:view,
    relationships:[],retained_evidence_text:null,retained_native_payload:JSON.stringify(originalUnit),representation_version:null,transform_version:null};
  appendStateRow(state,"document_generation_inventory",unit);
  return state;
}
describe("U04 finite deep-memory nonterminal row identities",()=>{
  it.each([false,true])("retains declared D and exact C association with finalized=%s",(finalized)=>{
    const state=deepCandidateStateFixture(finalized),before=JSON.stringify(state);
    const row=JSON.parse(String(fixtureGet(state.current,["rows","document_sections",0,"canonicalPayload"]))) as AuditFixtureObject;
    expect(row.index_generation_id).toBe(auditFixtureUuid(finalized?800:810));expect(row.artifact_generation_id).toBe(auditFixtureUuid(810));
    expect(compareShadowStateV1(state.input,state.fixture.admission,state.bindings)).toMatchObject({ok:true,kind:"sanctioned_u04_state"});
    expect(JSON.stringify(state)).toBe(before);
    state.input.phase="before_seal";
    expect(compareShadowStateV1(state.input,state.fixture.admission,state.bindings)).toMatchObject({ok:false,reason:"unsealed_wave",fieldPaths:["stage_receipt.semanticValidation"]});
  });
  it.each(["foreign D","metadata D","foreign producer","metadata producer","foreign owner","foreign source","foreign C association","foreign first token","missing declaration evidence"])("refuses fully rebound %s",(fault)=>{
    const state=deepCandidateStateFixture(true);
    if(["foreign D","metadata D","foreign producer","metadata producer","foreign owner"].includes(fault)){
      rebindStateRow(state,"document_sections",0,row=>{
        if(fault==="foreign D"){row.artifact_generation_id=auditFixtureUuid(811);fixtureSet(row,["metadata","artifact_generation_id"],auditFixtureUuid(811));}
        if(fault==="metadata D")fixtureSet(row,["metadata","artifact_generation_id"],auditFixtureUuid(811));
        if(fault==="foreign producer"){row.producer="indexing-v3-agent";fixtureSet(row,["metadata","generated_by"],"indexing-v3-agent");}
        if(fault==="metadata producer")fixtureSet(row,["metadata","generated_by"],"indexing-v3-agent");
        if(fault==="foreign owner")row.owner_id=auditFixtureUuid(98);
      });
      const digest=String(fixtureGet(state.current,["rows","document_sections",0,"digest"]));
      rebindStateRow(state,"document_generation_inventory",0,row=>{fixtureSet(row,["artifact_ref","rowDigest"],digest);row.content_digest=digest;});
    }else rebindStateRow(state,"document_generation_inventory",0,row=>{
      if(fault==="foreign source")fixtureSet(row,["source_binding","source","contentHash"],fixtureSha("foreign source"));
      if(fault==="foreign C association")fixtureSet(row,["source_binding","candidateGenerationId"],auditFixtureUuid(801));
      if(fault==="foreign first token")fixtureSet(row,["source_binding","firstLeaseToken"],auditFixtureUuid(799));
      if(fault==="missing declaration evidence")row.retained_native_payload=null;
    });
    for(const binding of state.bindings){
      const rows=fixtureGet(state.current,["rows",binding.table]) as AuditFixtureObject[];
      expect(rows.some(row=>row.digest===binding.rowDigest)).toBe(true);
    }
    expect(compareShadowStateV1(state.input,state.fixture.admission,state.bindings)).toMatchObject({ok:false,reason:"invalid_input",fieldPaths:["state"]});
  });
});

// Complete serialization is constructed independently of the persistence helper;
// the existing actual P04/recovery owners supply their unchanged native digests.
function persistenceFixture(options: AuditFixtureOptions = {}) {
  const identityUuid = options.identityUuid ?? auditFixtureUuid;
  const fixture = auditConsumerFixture({ members: 2, ...options });
  const prepared = prepareAuditFixture(fixture);
  if (prepared.inventory === null) throw new Error("Synthetic inventory unavailable.");
  const coverage: ExpectedSourceCoverageRegistry = { schemaVersion: 1, coverageVersion: "synthetic-complete-registry-v1", records: [
    { key: "wave", owner: "fixture-steward", reviewStatus: "active", expectedDocumentIds: fixture.profile.documentIds, mustPassCaseIds: ["required-case"] },
    { key: "outside-wave", owner: "fixture-steward", reviewStatus: "absent", expectedDocumentIds: [identityUuid(999)], mustPassCaseIds: [] },
  ] };
  const report = buildIngestionAuditReport({ inventory: prepared.inventory, expectedCoverage: coverage });
  const original = (kind: string, value: unknown) => {
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8")]);
    return { bytes, envelope: fixtureEnvelope({ kind, bytes: { encoding: "base64", content: bytes.toString("base64") } }) };
  };
  const coverageBytes = original("u04-source-coverage-bytes-v1", coverage);
  const reportBytes = original("u04-p04-report-bytes-v1", report);
  const projectRef = fixture.profile.target.projectRef;
  const basis = "11111111-1111-4111-8111-111111111111";
  const verifiedAt = "2024-02-29T23:59:59.123Z";
  const recovery: AuditFixtureObject = { version: 1, evidenceId: "22222222-2222-4222-8222-222222222222", projectRef,
    operation: "document-generation", verifiedAt, validUntil: "2024-03-02T00:00:00.000Z", requiredRpoMinutes: 15,
    databaseBackup: { projectRef, recoveryBasisId: basis, reference: { kind: "database-backup", id: "backup-a" }, digest: fixtureSha("backup"), verifiedAt },
    pitr: { projectRef, recoveryBasisId: basis, enabled: true, rpoMinutes: 5, reference: { kind: "pitr-status", id: "pitr-a" }, digest: fixtureSha("pitr"), verifiedAt },
    storageRecovery: { projectRef, recoveryBasisId: basis, inventoryReference: { kind: "storage-inventory", id: "inventory-a" }, inventoryDigest: fixtureSha("object inventory"),
      recoveryReference: { kind: "storage-recovery", id: "recovery-a" }, recoveryDigest: fixtureSha("object recovery"), verifiedAt },
    restoreDrill: { projectRef, recoveryBasisId: basis, targetProjectRef: "synthetic-isolated-target", reportReference: { kind: "restore-drill", id: "drill-a" },
      reportDigest: fixtureSha("drill"), databaseBackupDigest: fixtureSha("backup"), pitrDigest: fixtureSha("pitr"), storageInventoryDigest: fixtureSha("object inventory"),
      storageRecoveryDigest: fixtureSha("object recovery"), completedAt: verifiedAt, outcome: "passed", target: "isolated-project" } };
  recovery.digest = recoveryReadinessDigest(recovery);
  const recoveryBytes = original("u04-recovery-readiness-bytes-v1", recovery);
  const validation = { baselineCompletedAt: "2024-03-01T00:00:00.000001Z", auditPreparedAt: "2024-03-01T00:00:00.000002Z", recoveryCheckedAt: "2024-03-01T00:00:00.000003Z" };
  const planPayload = { kind: "u04-enqueue-plan-v1", plan: { version: 1, targetProjectRef: projectRef, sourcePolicyVersion: fixture.profile.sourcePolicyVersion,
    auditDigest: reportBytes.envelope.digest, populationFingerprint: report.populationFingerprint, candidateGenerationId: identityUuid(800),
    documents: prepared.inventory.documents.map(entry => ({ documentId: entry.documentId, expectedStateDigest: entry.expectedStateDigest,
      baselineGenerationId: entry.activeGenerationId })), chunkingExperiment: false },
    audit: { input: fixture.input, coverageEnvelope: coverageBytes.envelope, p04ReportEnvelope: reportBytes.envelope, validation } };
  const parameters = { p_plan: fixtureEnvelope(planPayload, "plan"), p_baseline_evaluation: fixture.input.caseResultsEnvelope,
    p_recovery_evidence: recoveryBytes.envelope, p_operation_manifest: fixtureEnvelope({}, "plan") };
  const operation = { kind: "u04-enqueue-operation-v1", manifest: { version: 1, operation: "stage", targetProjectRef: projectRef,
    planPath: "synthetic-plan.json", reportOrReceiptPath: null as string | null, recoveryEvidencePath: "synthetic-recovery.json",
    recoveryEvidenceSha256: fixtureSha(recoveryBytes.bytes), expectedDocumentIds: [...fixture.profile.documentIds], expectedDocumentCount: fixture.profile.documentIds.length,
    authorizedAt: "2024-03-01T00:00:00.000004Z", expiresAt: "2024-03-01T01:00:00.000000Z", confirmationSha256: "" },
    planDigest: parameters.p_plan.digest, baselineEvaluationDigest: parameters.p_baseline_evaluation.digest, recoveryEnvelopeDigest: parameters.p_recovery_evidence.digest };
  const admission = { audit: fixture.admission, planDigest: parameters.p_plan.digest, baselineEvaluationDigest: parameters.p_baseline_evaluation.digest,
    recoveryEnvelopeDigest: parameters.p_recovery_evidence.digest, operationManifestDigest: "", coverageEnvelopeDigest: coverageBytes.envelope.digest,
    p04ReportEnvelopeDigest: reportBytes.envelope.digest, rawRecoveryFileDigest: fixtureSha(recoveryBytes.bytes), recoveryEvidenceDigest: String(recovery.digest),
    manifest: structuredClone(operation.manifest), validation: { ...validation } };
  function rebind() {
    parameters.p_plan = fixtureEnvelope(planPayload, "plan"); operation.planDigest = parameters.p_plan.digest;
    operation.baselineEvaluationDigest = parameters.p_baseline_evaluation.digest; operation.recoveryEnvelopeDigest = parameters.p_recovery_evidence.digest;
    const { confirmationSha256: _confirmation, ...manifest } = operation.manifest;
    operation.manifest.confirmationSha256 = fixtureSha(encodeShadowNodeJsonCanonicalPayload({ ...operation, manifest }));
    parameters.p_operation_manifest = fixtureEnvelope(operation, "plan");
    Object.assign(admission, { planDigest: parameters.p_plan.digest, baselineEvaluationDigest: parameters.p_baseline_evaluation.digest,
      recoveryEnvelopeDigest: parameters.p_recovery_evidence.digest, operationManifestDigest: parameters.p_operation_manifest.digest,
      coverageEnvelopeDigest: planPayload.audit.coverageEnvelope.digest, p04ReportEnvelopeDigest: planPayload.audit.p04ReportEnvelope.digest,
      manifest: structuredClone(operation.manifest), validation: { ...planPayload.audit.validation } });
  }
  if (options.captureTime) {
    const start = options.captureTime.slice(0, 19);
    Object.assign(planPayload.audit.validation, { baselineCompletedAt: `${start}.000001Z`, auditPreparedAt: `${start}.000002Z`, recoveryCheckedAt: `${start}.000003Z` });
    operation.manifest.authorizedAt = `${start}.000004Z`;
  }
  rebind();
  return { fixture, prepared, coverage, report, coverageBytes, reportBytes, recovery, recoveryBytes, original, planPayload, parameters, operation, admission, rebind,
    now: options.captureTime ? `${options.captureTime.slice(0, 19)}.000005Z` : "2024-03-01T00:00:00.000005Z" };
}

describe("U04 complete persistence input and native bundle readback", () => {
  it.each([false, true])("retains both members and complete original bytes with legacy-null=%s", (baselineNull) => {
    const f = persistenceFixture({ baselineNull, historicalNull: true });
    const result = prepareShadowPersistenceV1(f.parameters, f.admission, f.now);
    expect(result.kind).toBe("shadow-persistence-prepared"); expect(result.plan.documents).toHaveLength(2);
    expect(result.report).toEqual(f.report); expect(result.plan.digest).toBe(f.parameters.p_plan.digest);
    expect(result.report.sourceCoverage).toEqual(f.report.sourceCoverage);
    expect(result.report.sourceCoverage.some(entry => entry.key === "outside-wave")).toBe(true);
    expect(result.rawP04ReportDigest).toBe(fixtureSha(f.reportBytes.bytes));
    expect(result.rawRecoveryFileDigest).toBe(fixtureSha(f.recoveryBytes.bytes));
    expect(result.recoveryEvidenceDigest).toBe(f.recovery.digest);
    expect(new Set([result.rawRecoveryFileDigest, result.recoveryEvidenceDigest, f.parameters.p_recovery_evidence.digest]).size).toBe(3);
    expect((JSON.parse(result.parameters.p_baseline_evaluation.canonicalPayload) as AuditFixtureObject).inputBinding)
      .toEqual(f.fixture.casePayload.inputBinding);
    expect(result.terminalAcceptance).toBe("unavailable");
    const bundle = fixtureEnvelope(result.bundlePayload, "baseline", "pg-jsonb-text-v1");
    const loaded = readShadowPersistenceBundleV1(bundle, f.admission, f.now);
    expect(loaded.bundle).toEqual(bundle); expect(loaded.bundle.canonicalPayload).toBe(bundle.canonicalPayload);
    expect(loaded.parameters).toEqual(f.parameters);
    expect((JSON.parse(loaded.parameters.p_baseline_evaluation.canonicalPayload) as AuditFixtureObject).inputBinding)
      .toEqual(f.fixture.casePayload.inputBinding);
    expect(Buffer.from(JSON.parse(f.parameters.p_recovery_evidence.canonicalPayload).bytes.content, "base64")).toEqual(f.recoveryBytes.bytes);
    if (baselineNull) expect(result.report.documents.every(entry => entry.reasons.includes("generation_incomplete"))).toBe(true);
  });
  it("preserves complete truthful repair diagnostics without requiring a green scored report", () => {
    const f = persistenceFixture({ nonGreen: true });
    const result = prepareShadowPersistenceV1(f.parameters, f.admission, f.now);
    expect(result.report).toEqual(f.report);
    expect(result.report.documents.some(entry => entry.action !== "no_change")).toBe(true);
    expect(result.parameters.p_baseline_evaluation).toEqual(f.fixture.input.caseResultsEnvelope);
  });
  it.each(["planDigest", "baselineEvaluationDigest", "recoveryEnvelopeDigest", "operationManifestDigest", "coverageEnvelopeDigest",
    "p04ReportEnvelopeDigest", "rawRecoveryFileDigest", "recoveryEvidenceDigest"] as const)("refuses independent %s substitution", key => {
    const f = persistenceFixture(); f.admission[key] = fixtureSha("substituted binding");
    expect(() => prepareShadowPersistenceV1(f.parameters, f.admission, f.now)).toThrow("Invalid shadow comparison record.");
  });
  it.each(["missing second", "same-count replacement", "historical as fresh", "C equals G0", "wrong target", "wrong policy", "wrong fingerprint",
    "before baseline", "after authorization", "wrong stage", "wrong count", "expired", "wrong confirmation"] as const)("refuses fully rebound %s", fault => {
    const f = persistenceFixture();
    if (fault === "missing second") f.planPayload.plan.documents.pop();
    if (fault === "same-count replacement") f.planPayload.plan.documents[1]!.documentId = auditFixtureUuid(999);
    if (fault === "historical as fresh") f.planPayload.plan.documents[0]!.expectedStateDigest = "a".repeat(64);
    if (fault === "C equals G0") f.planPayload.plan.candidateGenerationId = auditFixtureUuid(50);
    if (fault === "wrong target") f.planPayload.plan.targetProjectRef = "another-target";
    if (fault === "wrong policy") f.planPayload.plan.sourcePolicyVersion = "another-policy";
    if (fault === "wrong fingerprint") f.planPayload.plan.populationFingerprint = fixtureSha("wrong population");
    if (fault === "before baseline") f.planPayload.audit.validation.baselineCompletedAt = "2024-02-29T00:00:00.000000Z";
    if (fault === "after authorization") f.planPayload.audit.validation.auditPreparedAt = "2024-03-01T00:00:00.000005Z";
    if (fault === "wrong stage") f.operation.manifest.operation = "evaluate";
    if (fault === "wrong count") f.operation.manifest.expectedDocumentCount = 1;
    if (fault === "expired") f.operation.manifest.expiresAt = f.now;
    f.rebind();
    if (fault === "wrong confirmation") { f.operation.manifest.confirmationSha256 = fixtureSha("wrong confirmation");
      f.parameters.p_operation_manifest = fixtureEnvelope(f.operation, "plan"); f.admission.operationManifestDigest = f.parameters.p_operation_manifest.digest;
      f.admission.manifest = structuredClone(f.operation.manifest); }
    expect(() => prepareShadowPersistenceV1(f.parameters, f.admission, f.now)).toThrow("Invalid shadow comparison record.");
  });
  it.each(["digest", "disabled PITR", "RPO", "wrong target", "wrong operation", "wrong basis", "failed drill", "in-place drill", "expired evidence"] as const)("refuses rebound recovery %s", fault => {
    const f = persistenceFixture();
    if (fault === "disabled PITR") fixtureSet(f.recovery, ["pitr", "enabled"], false);
    if (fault === "RPO") fixtureSet(f.recovery, ["pitr", "rpoMinutes"], 30);
    if (fault === "wrong target") f.recovery.projectRef = "other-target";
    if (fault === "wrong operation") f.recovery.operation = "site-release";
    if (fault === "wrong basis") fixtureSet(f.recovery, ["restoreDrill", "databaseBackupDigest"], fixtureSha("different backup"));
    if (fault === "failed drill") fixtureSet(f.recovery, ["restoreDrill", "outcome"], "failed");
    if (fault === "in-place drill") fixtureSet(f.recovery, ["restoreDrill", "target"], "in-place");
    if (fault === "expired evidence") f.recovery.validUntil = "2024-03-01T00:00:00.000Z";
    f.recovery.digest = fault === "digest" ? fixtureSha("false native digest") : recoveryReadinessDigest(f.recovery);
    const original = f.original("u04-recovery-readiness-bytes-v1", f.recovery);
    f.parameters.p_recovery_evidence = original.envelope; f.operation.manifest.recoveryEvidenceSha256 = fixtureSha(original.bytes);
    f.admission.rawRecoveryFileDigest = fixtureSha(original.bytes); f.admission.recoveryEvidenceDigest = String(f.recovery.digest); f.rebind();
    expect(() => prepareShadowPersistenceV1(f.parameters, f.admission, f.now)).toThrow("Invalid shadow comparison record.");
  });
  it.each(["missing object", "equal-length object replacement", "changed report", "changed registry", "trailing JSON", "invalid UTF8", "duplicate key", "noncanonical base64"] as const)("refuses fully rebound original evidence %s", fault => {
    const f = persistenceFixture();
    if (fault === "missing object") f.fixture.input.retainedEvidence = f.fixture.input.retainedEvidence.filter(entry => entry.tag !== "private_object");
    if (fault === "equal-length object replacement") {
      const object = f.fixture.input.retainedEvidence.find(entry => entry.tag === "private_object")!;
      const original = object.bytes as { encoding: string; content: string }; const bytes = Buffer.from(original.content, "base64"); bytes[0] = 0;
      object.bytes = { ...original, content: bytes.toString("base64") };
    }
    if (fault === "changed report") f.planPayload.audit.p04ReportEnvelope = f.original("u04-p04-report-bytes-v1", { ...f.report, summary: { ...f.report.summary, documents: 1 } }).envelope;
    if (fault === "changed registry") f.planPayload.audit.coverageEnvelope = f.original("u04-source-coverage-bytes-v1", { ...f.coverage, records: f.coverage.records.slice(0, 1) }).envelope;
    if (["trailing JSON", "invalid UTF8", "duplicate key", "noncanonical base64"].includes(fault)) {
      const valid = JSON.stringify(f.coverage);
      const bytes = fault === "invalid UTF8" ? Buffer.concat([Buffer.from(valid.slice(0, -1)), Buffer.from([0xff]), Buffer.from("}")])
        : Buffer.from(fault === "duplicate key" ? valid.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1')
          : fault === "trailing JSON" ? `${valid}{}` : valid);
      f.planPayload.audit.coverageEnvelope = fixtureEnvelope({ kind: "u04-source-coverage-bytes-v1", bytes: { encoding: "base64", content: bytes.toString("base64") + (fault === "noncanonical base64" ? "\n" : "") } });
    }
    f.planPayload.plan.auditDigest = f.planPayload.audit.p04ReportEnvelope.digest; f.rebind();
    expect(() => prepareShadowPersistenceV1(f.parameters, f.admission, f.now)).toThrow("Invalid shadow comparison record.");
  });
  it("retains integrity-only readback after expiry while fresh stage preparation refuses", () => {
    const f = persistenceFixture(); const prepared = prepareShadowPersistenceV1(f.parameters, f.admission, f.now);
    const bundle = fixtureEnvelope(prepared.bundlePayload, "baseline", "pg-jsonb-text-v1");
    const expired = "2025-03-01T00:00:00.000000Z";
    const readback = readShadowPersistenceBundleV1(bundle, f.admission, expired);
    expect(readback.kind).toBe("shadow-persistence-integrity-only"); expect(readback.stageReadiness).toBe("not-assessed");
    expect(readback.terminalAcceptance).toBe("unavailable"); expect(readback.bundle).toEqual(bundle);
    expect(readback.parameters).toEqual(f.parameters); expect(readback.rawRecoveryFileDigest).toBe(fixtureSha(f.recoveryBytes.bytes));
    expect(() => prepareShadowPersistenceV1(f.parameters, f.admission, expired)).toThrow("Invalid shadow comparison record.");
    expect(() => readShadowPersistenceBundleV1(fixtureEnvelope(prepared.bundlePayload, "baseline"), f.admission, f.now)).toThrow("Invalid shadow envelope bytes.");
  });
  it.each([false, true])("retains original worker bytes for an unselected historical image with legacy-null=%s", baselineNull => {
    const bytes = Buffer.from("Complete original historical image bytes."); const hash = fixtureSha(bytes).slice(7);
    const f = persistenceFixture({ baselineNull, historicalImage: { bytes, hash, metadataHash: hash, extractor: "local-worker" } });
    expect(f.prepared.kind).toBe("shadow-audit-prepared");
    expect(f.prepared.inventory!.documents.every(entry => entry.counts.images.actual === 0)).toBe(true);
    const result = prepareShadowPersistenceV1(f.parameters, f.admission, f.now);
    expect(result.bundlePayload.parameters.p_plan).toEqual(f.parameters.p_plan);
    const retained = f.fixture.input.retainedEvidence.find(entry => entry.tag === "private_object" && (entry.ref as { objectPath: string }).objectPath.includes("historical-worker-image"))!;
    expect(Buffer.from((retained.bytes as { content: string }).content, "base64")).toEqual(bytes);
  });
  it.each(["replaced bytes and ref", "missing captured hash", "missing metadata hash", "unproved producer"] as const)("refuses fully rebound historical-image %s", fault => {
    const original = Buffer.from("Complete original historical image bytes."); const hash = fixtureSha(original).slice(7);
    const bytes = Buffer.from(original); if (fault === "replaced bytes and ref") bytes[0] = 0;
    const f = persistenceFixture({ historicalImage: { bytes, hash: fault === "missing captured hash" ? null : hash,
      metadataHash: fault === "missing metadata hash" ? null : hash, extractor: fault === "unproved producer" ? "unknown" : "local-worker" } });
    // The actual audit selects G0; this historical row does not affect its counts.
    // All origin/report/plan/operation/admission bytes were rebuilt consistently.
    expect(f.prepared.kind).toBe("shadow-audit-prepared");
    expect(f.fixture.rows.document_images).toHaveLength(1);
    expect(bytes).toHaveLength(original.length);
    expect(() => prepareShadowPersistenceV1(f.parameters, f.admission, f.now)).toThrow("Invalid shadow comparison record.");
  });
});

function finalProjectionItemsFixture(binding: AuditFixtureObject, chunk: AuditFixtureObject, index: number,
  pgEnvelope: (value: AuditFixtureJson, domain: ShadowEnvelopeDomain) => ReturnType<typeof fixtureEnvelope>, imageIds: string[] = []) {
  const source = binding.source as AuditFixtureObject;
  const documentId = String(source.documentId), ownerId = String(source.ownerId);
  const candidateGenerationId = String(binding.candidateGenerationId), jobId = String(binding.jobId);
  const firstLeaseToken = String(binding.firstLeaseToken), chunkId = String(chunk.id);
  const generatedAt = "2024-02-29T23:59:59.123Z", summaryText = "- Use the complete synthetic source.";
  const claim: AuditFixtureObject = { text: "Use the complete synthetic source.", source_chunk_ids: [chunkId],
    source_image_ids: [], pages: [1], evidence_type: "text", support: "direct" };
  const summaryProfile: AuditFixtureObject = { overview: summaryText, applies_to: [], key_clinical_actions: [claim],
    medication_dose_monitoring: [], thresholds_timing: [], escalation_risk_warnings: [], required_forms_documentation: [],
    not_covered: [], important_tables_images: [], best_questions: [], source_quality_notes: [] };
  const clinicalSpecifics: AuditFixtureObject = { profile: summaryProfile, actions: [claim.text!], thresholds_timing: [],
    medication_monitoring: [], risk_escalation: [], documentation_forms: [], exceptions_gaps: [] };
  const anchoredSummary: AuditFixtureObject = { summary_kind: "structured", summary_version: "source-anchored-summary-v1",
    document_id: documentId, index_generation_id: candidateGenerationId, model: "synthetic-index",
    model_version: "rag-deep-memory-v1", generated_at: generatedAt, source_chunk_ids: [chunkId], source_image_ids: imageIds,
    summary: summaryText, clinical_specifics: clinicalSpecifics,
    labels: [{ label: "synthetic", label_type: "topic", confidence: 1 }], heuristic_fallback: false };
  const originalSummaryMetadata: AuditFixtureObject = { generated_by: "local-worker", index_generation_id: candidateGenerationId,
    source_anchored_summary_v1: anchoredSummary, source_anchored_summary_projection_complete_v1: true };
  const summaryMetadata: AuditFixtureObject = { ...originalSummaryMetadata, ingestion_job_kind: "node",
    ingestion_job_id: jobId, ingestion_lease_token: firstLeaseToken };
  const summary: AuditFixtureObject = { id: auditFixtureUuid(940 + index), document_id: documentId, owner_id: ownerId,
    summary: summaryText, clinical_specifics: clinicalSpecifics, source_chunk_ids: [chunkId], source_image_ids: imageIds,
    model: "synthetic-index", metadata: summaryMetadata, generated_at: generatedAt,
    created_at: auditFixtureTime, updated_at: auditFixtureTime };
  const enrichmentMetadata: AuditFixtureObject = { rag_enrichment_version: "rag-deep-memory-v1",
    rag_indexing_version: "rag-deep-memory-v1", rag_memory_version: "rag-deep-memory-v1",
    rag_enrichment_updated_at: generatedAt, generated_label_count: 1 };
  const originalSummary: AuditFixtureObject = { document_id: documentId, owner_id: ownerId, summary: summaryText,
    clinical_specifics: clinicalSpecifics, source_chunk_ids: [chunkId], source_image_ids: imageIds, model: "synthetic-index",
    metadata: originalSummaryMetadata, generated_at: generatedAt, updated_at: generatedAt };
  const labelMetadata: AuditFixtureObject = { source_chunk_ids: [chunkId], source_image_ids: [], pages: [1],
    index_generation_id: candidateGenerationId };
  const originalLabel: AuditFixtureObject = { document_id: documentId, owner_id: ownerId, label: "synthetic",
    label_type: "topic", source: "generated", confidence: 1, metadata: labelMetadata };
  const label: AuditFixtureObject = { id: auditFixtureUuid(950 + index), ...originalLabel,
    metadata: { ...labelMetadata, ingestion_job_kind: "node", ingestion_job_id: jobId,
      ingestion_lease_token: firstLeaseToken, index_generation_id: candidateGenerationId },
    created_at: auditFixtureTime, updated_at: auditFixtureTime };
  const labelKey = encodeShadowNodeJsonCanonicalPayload({ label: label.label, label_type: label.label_type });
  const summaryOutput = fixtureEnvelope({ producer: "local-worker", producerVersion: "rag-deep-memory-v1", binding,
    units: [{ family: "generated_labels", key: labelKey, output: originalLabel },
      { family: "summary", key: "singleton", output: { summary: originalSummary, enrichment_metadata: enrichmentMetadata } }] });

  const artifactGenerationId = auditFixtureUuid(930 + index);
  const deepBinding: AuditFixtureObject = { ...binding, artifactGenerationId };
  const nativeStamp: AuditFixtureObject = { generated_by: "local-worker", artifact_generation_id: artifactGenerationId,
    index_generation_id: artifactGenerationId, ingestion_lease_token: firstLeaseToken };
  const storedStamp: AuditFixtureObject = { ...nativeStamp, index_generation_id: candidateGenerationId,
    ingestion_job_kind: "node", ingestion_job_id: jobId };
  const nativeSection: AuditFixtureObject = { document_id: documentId, owner_id: ownerId, section_index: 0,
    heading: "Synthetic section", heading_path: ["Synthetic section"], page_start: 1, page_end: 1, chunk_ids: [chunkId],
    summary: "Synthetic section summary.", tags: [], extraction_quality: "good", index_generation_id: artifactGenerationId,
    producer: "local-worker", artifact_generation_id: artifactGenerationId, metadata: nativeStamp };
  const section: AuditFixtureObject = { ...nativeSection, id: auditFixtureUuid(960 + index),
    index_generation_id: candidateGenerationId, metadata: storedStamp, created_at: auditFixtureTime, updated_at: auditFixtureTime };
  const embedding = Array.from({ length: 1536 }, (_, position) => position === 0 ? 1 : 0);
  const nativeCard: AuditFixtureObject = { document_id: documentId, owner_id: ownerId, section_id: null,
    card_type: "clinical_fact", title: "Synthetic card", content: "Synthetic evidence card.", normalized_terms: ["synthetic"],
    page_number: 1, source_chunk_ids: [chunkId], source_image_ids: [], confidence: 1,
    index_generation_id: artifactGenerationId, producer: "local-worker", artifact_generation_id: artifactGenerationId,
    metadata: nativeStamp, embedding };
  const card: AuditFixtureObject = { ...nativeCard, id: auditFixtureUuid(970 + index), section_id: section.id!,
    index_generation_id: candidateGenerationId, metadata: storedStamp, embedding: JSON.stringify(embedding),
    search_tsv: "'synthetic':1", created_at: auditFixtureTime, updated_at: auditFixtureTime };
  const nativeUnit: AuditFixtureObject = { owner_id: ownerId, document_id: documentId, unit_type: "clinical_fact",
    source_chunk_id: chunkId, source_image_id: null, page_start: 1, page_end: 1, heading_path: ["Synthetic section"],
    title: "Synthetic unit", content: "Synthetic unit content.", normalized_terms: ["synthetic"], source_span: null,
    quality_score: 1, extraction_mode: "deterministic", index_generation_id: artifactGenerationId,
    producer: "local-worker", artifact_generation_id: artifactGenerationId, embedding, metadata: nativeStamp };
  const unit: AuditFixtureObject = { ...nativeUnit, id: auditFixtureUuid(920 + index), index_generation_id: candidateGenerationId,
    metadata: storedStamp, embedding: JSON.stringify(embedding), search_tsv: "'synthetic':1",
    created_at: auditFixtureTime, updated_at: auditFixtureTime };
  const modelAliases = ["synthetic", "synthetic-secondary"].map((alias, ordinal) => ({ alias,
    canonical: ordinal === 0 ? "Synthetic guidance" : "Secondary synthetic guidance", alias_type: "synonym",
    source_chunk_ids: [chunkId], confidence: 0.75 }));
  const nativeAliases: AuditFixtureObject[] = modelAliases.map(modelAlias => ({ alias: modelAlias.alias,
    canonical: modelAlias.canonical, alias_type: modelAlias.alias_type, weight: 1, enabled: true,
    metadata: { source: "model_index_profile", document_id: documentId, source_chunk_ids: [chunkId],
      model_index_version: "model-heavy-index-v1", generated_by: "local-worker", artifact_generation_id: artifactGenerationId } }));
  const aliases: AuditFixtureObject[] = nativeAliases.map((nativeAlias, ordinal) => ({
    id: auditFixtureUuid(910 + index * 2 + ordinal), owner_id: ownerId, ...nativeAlias,
    metadata: { ...(nativeAlias.metadata as AuditFixtureObject), ingestion_job_kind: "node", ingestion_job_id: jobId,
      ingestion_lease_token: firstLeaseToken, index_generation_id: candidateGenerationId },
    created_at: auditFixtureTime, updated_at: auditFixtureTime }));
  const modelProfile: AuditFixtureObject = { sections: [], askable_questions: [], clinical_facts: [], table_facts: [],
    aliases: modelAliases, quality_issues: [], model: null, version: "model-heavy-index-v1" };
  const request: AuditFixtureObject = { fence: { job_kind: "node", job_id: jobId, document_id: documentId,
    worker_id: "synthetic-worker", lease_token: firstLeaseToken, expected_generation_id: source.baselineGenerationId,
    authority_digest: source.authorityDigest }, artifact_generation: artifactGenerationId, rag_memory_version: "rag-deep-memory-v1",
    document_intelligence_version: "document-intelligence-v2", section_count: 1, memory_card_count: 1,
    index_unit_counts_by_type: { clinical_fact: 1 }, anchors: [{ id: chunkId, anchor_id: String(chunk.anchor_id) }],
    aliases: nativeAliases };
  const deepOutput = fixtureEnvelope({ producer: "local-worker", producerVersion: "rag-deep-memory-v1", binding: deepBinding,
    units: [{ family: "index_units", key: "deep:0", output: { nativeInput: nativeUnit } },
      { family: "memory_cards", key: "deep:0", output: { nativeInput: nativeCard, sectionAssociation: { tag: "index", index: 0 } } },
      ...nativeAliases.map((nativeInput, ordinal) => ({ family: "producer_aliases", key: `deep:${ordinal}`, output: { nativeInput } })),
      { family: "sections", key: "deep:0", output: { nativeInput: nativeSection, producerContext: { modelProfile, request } } }] });
  const sectionEnvelope = fixtureEnvelope(section, "baseline", "pg-jsonb-text-v1");
  const cardEnvelope = fixtureEnvelope(card, "baseline", "pg-jsonb-text-v1");
  const unitEnvelope = fixtureEnvelope(unit, "baseline", "pg-jsonb-text-v1");
  const aliasEnvelopes = aliases.map(alias => pgEnvelope(alias, "baseline"));
  const receipt = pgEnvelope({ kind: "u04-deep-memory-receipt-v1", binding: deepBinding, producer: "local-worker",
    outputManifestEnvelope: deepOutput, request,
    rows: { sections: [sectionEnvelope], cards: [cardEnvelope], units: [unitEnvelope], aliases: aliasEnvelopes },
    finalizedAt: auditFixtureTime }, "projection");
  const result = { document_id: documentId, producer: "local-worker", artifact_generation_id: artifactGenerationId,
    index_generation_id: candidateGenerationId, section_count: 1, memory_card_count: 1, index_unit_count: 1 };
  const deepMetadata: AuditFixtureObject = { rag_indexing_version: "rag-deep-memory-v1", rag_memory_version: "rag-deep-memory-v1",
    rag_memory_updated_at: auditFixtureTime, document_intelligence_version: "document-intelligence-v2",
    document_intelligence_updated_at: auditFixtureTime, section_count: 1, memory_card_count: 1, index_unit_count: 1,
    index_unit_counts_by_type: { clinical_fact: 1 }, repaired_anchor_count: 1,
    deep_memory_generations: { "local-worker": artifactGenerationId },
    deep_memory_commit_receipts: { "local-worker": { request, result } } };
  return { summary, label, labelKey, summaryOutput, enrichmentMetadata, artifactGenerationId, deepBinding, deepOutput,
    receipt, deepMetadata, section, card, unit, alias: aliases[0]!, aliases, sectionEnvelope, cardEnvelope, unitEnvelope,
    aliasEnvelope: aliasEnvelopes[0]!, aliasEnvelopes,
    planned: { summary: { summary: originalSummary, enrichment_metadata: enrichmentMetadata }, label: originalLabel,
      section: { nativeInput: nativeSection, producerContext: { modelProfile, request } },
      card: { nativeInput: nativeCard, sectionAssociation: { tag: "index", index: 0 } },
      unit: { nativeInput: nativeUnit }, alias: { nativeInput: nativeAliases[0]! }, aliases: nativeAliases.map(nativeInput=>({nativeInput})) } };
}

function finalReceiptFixture(baselineNull = false, includeCoreRows = false, includeProjectionItems = false,
  includePrivateImage = false, includeNativeCache = false, includeControlRepair = false,
  duplicateNativePagePopulation = false, quality = false) {
  const identityUuid = auditFixtureV4Uuid;
  const persistence = persistenceFixture({ baselineNull, identityUuid, quality });
  const prepared = prepareShadowPersistenceV1(persistence.parameters, persistence.admission, persistence.now);
  const bundleEnvelope = fixtureEnvelope(prepared.bundlePayload, "baseline", "pg-jsonb-text-v1");
  const profileEnvelope = fixtureEnvelope(persistence.fixture.profile, "u04-execution-profile-v1");
  const candidateGenerationId = persistence.planPayload.plan.candidateGenerationId as string;
  const pgEnvelope = (value: AuditFixtureJson, domain: ShadowEnvelopeDomain) =>
    ({ ...rawEnvelope(fixturePg(value), domain, "pg-jsonb-text-v1"), version: 1 as const });
  const members = persistence.fixture.memberPayloads.map((payload, index) => {
    if ((includeProjectionItems || includePrivateImage || includeNativeCache || duplicateNativePagePopulation) && !includeCoreRows)
      throw new Error("Projection-item fixture requires core source rows.");
    if (duplicateNativePagePopulation && !includeNativeCache)
      throw new Error("Duplicate native page fixture requires retained native evidence.");
    const documentId = payload.source.documentId as string, ownerId = payload.source.ownerId as string;
    const jobId = identityUuid(700 + index), firstLeaseToken = identityUuid(710 + index);
    const binding: AuditFixtureObject & { source: AuditFixtureObject } = { tag: "candidate", source: payload.source as AuditFixtureObject, candidateGenerationId,
      jobId, firstLeaseToken, artifactGenerationId: null };
    const pageText = `Complete candidate page ${index + 1}.`;
    const chunkContent = `Complete candidate chunk ${index + 1}.`;
    const pageNative: AuditFixtureObject = { input: { document_id: documentId, page_number: 1, text: pageText,
      ocr_used: false, metadata: {} }, extractedPage: { pageNumber: 1, text: pageText, ocrUsed: false, needsOcr: false } };
    const pageStored: AuditFixtureObject = { id: auditFixtureUuid(980 + index), document_id: documentId,
      index_generation_id: candidateGenerationId, page_number: 1, text: pageText, ocr_used: false,
      metadata: { index_generation_id: candidateGenerationId, ingestion_job_kind: "node", ingestion_job_id: jobId,
        ingestion_lease_token: firstLeaseToken }, created_at: auditFixtureTime };
    const page2Native: AuditFixtureObject = { input: { document_id: documentId, page_number: 2, text: pageText,
      ocr_used: false, metadata: {} }, extractedPage: { pageNumber: 2, text: pageText, ocrUsed: false, needsOcr: false } };
    const page2Stored: AuditFixtureObject = { ...structuredClone(pageStored), id: auditFixtureUuid(970 + index), page_number: 2 };
    const chunkInput: AuditFixtureObject = { id: auditFixtureUuid(990 + index), document_id: documentId, page_number: 1,
      chunk_index: 0, content: chunkContent, metadata: {}, embedding: Array.from({ length: 1536 }, () => 0) };
    const chunkNative = captureShadowProducerInputV1(chunkInput);
    const chunkStored: AuditFixtureObject = { id: chunkInput.id!, document_id: documentId, page_number: 1, chunk_index: 0,
      section_heading: null, section_path: [], heading_level: null, parent_heading: null, anchor_id: null,
      content: chunkContent, retrieval_synopsis: null, content_hash: null, index_generation_id: candidateGenerationId,
      token_estimate: 0, image_ids: [], metadata: { index_generation_id: candidateGenerationId, ingestion_job_kind: "node",
        ingestion_job_id: jobId, ingestion_lease_token: firstLeaseToken }, embedding: JSON.stringify(chunkInput.embedding),
      created_at: auditFixtureTime, search_tsv: null };
    if (includeProjectionItems) {
      chunkStored.anchor_id = `synthetic-anchor-${index}`;
      Object.assign(chunkStored.metadata as AuditFixtureObject, { anchor_id: chunkStored.anchor_id,
        anchor_repaired_by: "document-intelligence-v2" });
    }
    const imageBytes = Buffer.from(`Complete private candidate image ${index + 1}.`);
    const imageHash = createHash("sha256").update(imageBytes).digest("hex");
    const imageId = auditFixtureUuid(880 + index), imagePath = `${documentId}/${candidateGenerationId}/${imageId}.png`;
    const imageMetadata: AuditFixtureObject = { extractor: "local-worker", image_hash: imageHash };
    const imageInput: AuditFixtureObject = { id: imageId, document_id: documentId, storage_path: imagePath,
      mime_type: "image/png", image_hash: imageHash, labels: [], metadata: imageMetadata };
    const imageNative = captureShadowProducerInputV1(imageInput);
    const imageStored: AuditFixtureObject = { id: imageId, document_id: documentId, page_number: null,
      storage_path: imagePath, mime_type: "image/png", caption: "", bbox: null, image_type: "unclear",
      searchable: true, clinical_relevance_score: 0, skip_reason: null, source_kind: "embedded", width: null,
      height: null, image_hash: imageHash, perceptual_hash: null, labels: [], index_generation_id: candidateGenerationId,
      caption_confidence: null, clinical_priority_score: null, crop_completeness: null, image_quality_score: null,
      ocr_text_density: null, structured_extraction_confidence: null, visual_duplicate_group: null,
      metadata: { ...imageMetadata, index_generation_id: candidateGenerationId, ingestion_job_kind: "node",
        ingestion_job_id: jobId, ingestion_lease_token: firstLeaseToken }, created_at: auditFixtureTime };
    const privateRef: AuditFixtureObject = { tag: "private_object", bucket: "synthetic-private-images",
      objectPath: imagePath, objectVersion: null, sha256: `sha256:${imageHash}`,
      byteLength: imageBytes.length, mediaType: "image/png" };
    const privateObject: AuditFixtureObject = { tag: "private_object", ref: privateRef,
      bytes: { encoding: "base64", content: imageBytes.toString("base64") } };
    const privateKey = shadowPrivateObjectIdentityV1(privateRef);
    const imageOutput = fixtureEnvelope({ producer: "local-worker", producerVersion: "rag-deep-memory-v1", binding,
      units: includePrivateImage ? [{ family: "images", key: imageId, output: imageNative }] : [] });
    const privateOutput = fixtureEnvelope({ producer: "local-worker", producerVersion: "rag-deep-memory-v1", binding,
      units: includePrivateImage ? [{ family: "private_objects", key: privateKey, output: privateObject }] : [] });
    const imageRowEnvelope = pgEnvelope(imageStored, "baseline");
    const pageOutput = fixtureEnvelope({ producer: "local-worker", producerVersion: "rag-deep-memory-v1", binding,
      units: [{ family: "pages", key: "1", output: pageNative },
        ...(duplicateNativePagePopulation ? [{ family: "pages", key: "2", output: page2Native }] : [])] });
    const chunkOutput = fixtureEnvelope({ producer: "local-worker", producerVersion: "rag-deep-memory-v1", binding,
      units: [{ family: "chunks", key: String(chunkInput.id), output: chunkNative }] });
    const extractedBytes = Buffer.from(`Complete extracted image input ${index + 1}.`);
    const extractedPath = `C:/synthetic/extracted-${index + 1}.png`;
    const extractedImage: AuditFixtureObject = { pageNumber: 1, path: extractedPath, mimeType: "image/png",
      bbox: [0.25, 1.5, 120.75, 80.5], width: 121, height: 81, sourceKind: "embedded", metadata: {} };
    const extracted: AuditFixtureObject = { pages: duplicateNativePagePopulation
      ? [pageNative.extractedPage, pageNative.extractedPage] : [pageNative.extractedPage],
      images: [extractedImage], warnings: [], temporaryPaths: [extractedPath],
      budgetUsage: { pages: duplicateNativePagePopulation ? 2 : 1, artifacts: 1,
        artifactBytes: extractedBytes.length, textBytes: Buffer.byteLength(pageText, "utf8") *
          (duplicateNativePagePopulation ? 2 : 1) } };
    const nativeCaptureInput: AuditFixtureObject = { extracted,
      imageBytes: [{ path: extractedPath, encoding: "base64", content: extractedBytes.toString("base64") }] };
    const nativeCaptureEnvelope = fixtureEnvelope(captureShadowProducerInputV1(nativeCaptureInput),
    "u04-retained-evidence-v1");
    const nativeOutput = fixtureEnvelope({ producer: "local-worker", producerVersion: "rag-deep-memory-v1", binding,
      units: includeNativeCache ? [{ family: "native_structure", key: "extracted-document", output: nativeCaptureEnvelope }] : [] });
    const visualProfile: AuditFixtureObject = { clinical_purpose: "Synthetic visual evidence.", key_terms: ["synthetic"],
      medications: [], thresholds: [], actions: [], monitoring_items: [], flowchart_nodes: [], flowchart_edges: [],
      risk_matrix_axes: [], risk_matrix_cells: [], chart_axes: [], chart_findings: [], table_column_roles: {},
      source_regions: [], confidence: 0.375 };
    const classification: AuditFixtureObject = { image_type: "unclear", searchable: true,
      clinical_relevance_score: 0.625, labels: ["synthetic"], caption: "Synthetic extracted image.", skip_reason: null,
      clinical_use_class: "ambiguous", clinical_use_reason: "Synthetic evidence requires review.",
      clinical_signal_score: 1.25, admin_signal_score: 0.5, structured_visual_profile: visualProfile,
      structured_extraction_confidence: 0.375 };
    const extractedHash = createHash("sha256").update(extractedBytes).digest("hex");
    const cacheTask: AuditFixtureObject = { candidate: { pageNumber: 1, width: 121, height: 81,
      bbox: extractedImage.bbox!, sourceKind: "embedded", imageHash: extractedHash, perceptualHash: `perceptual-${index}`,
      metadata: {}, nearbyText: pageText, originalIndex: 0, candidatePriorityScore: 0.812,
      imageQualityScore: 0.456, cropCompleteness: 0.734, ocrTextDensity: 0.123,
      captionBudgetClass: "clinical_region", reasons: ["clinical text signal"], duplicateGroup: `perceptual-${index}` },
      index: 0, image: extractedImage, perceptualHash: `perceptual-${index}`, imageHash: extractedHash,
      nearbyText: pageText, tableMetadata: { candidateType: null, tableLabel: null, tableTitle: null, tableRole: null,
        tableConfidence: null, tableText: null, tableTextSnippet: null, accessibleTableMarkdown: null,
        tableRows: null, tableColumns: null }, contextHash: createHash("sha256").update(`synthetic-context-${index}`).digest("hex").slice(0,32),
      presetClassification: classification };
    const cacheCaptureInput: AuditFixtureObject = { task: cacheTask, classification,
      classificationCacheHit: false, ownerId, model: "synthetic-vision-model" };
    const cacheCaptureEnvelope = fixtureEnvelope(captureShadowProducerInputV1(cacheCaptureInput), "u04-retained-evidence-v1");
    const cacheOutput = fixtureEnvelope({ producer: "local-worker", producerVersion: "clinical-image-caption-cache-v2", binding,
      units: includeNativeCache ? [{ family: "cache_inputs", key: "0", output: cacheCaptureEnvelope }] : [] });
    const projectionItems = includeProjectionItems ? finalProjectionItemsFixture(binding, chunkStored, index, pgEnvelope, includePrivateImage ? [imageId] : []) : null;
    const optionalIssues:AuditFixtureObject[]=includeControlRepair?[{stage:"table fact",
      message:"Synthetic optional index write failed.",code:"SYNTHETIC_WRITE"}]:[];
    const metrics: AuditFixtureObject = { page_count: includeCoreRows ? duplicateNativePagePopulation ? 2 : 1 : 0,
      ocr_page_count: 0, needs_ocr_page_count: 0,
      text_character_count: includeCoreRows ? pageText.length * (duplicateNativePagePopulation ? 2 : 1) : 0,
      extracted_image_count: includePrivateImage ? 1 : 0, searchable_image_count: includePrivateImage ? 1 : 0,
      skipped_image_count: 0,
      section_count: includeProjectionItems ? 1 : 0, memory_card_count: includeProjectionItems ? 1 : 0,
      avg_chunk_length: includeCoreRows ? chunkContent.length : 0, duplicate_chunk_ratio: 0, heading_density: 0,
      section_path_coverage: 0, ocr_coverage: 0, average_page_text_chars: includeCoreRows ? pageText.length : 0,
      table_extraction_coverage: null, searchable_image_coverage: null, visual_unit_coverage: null,
      average_image_quality_score: null, average_crop_completeness: null, average_structured_visual_confidence: null,
      skipped_image_reasons: {}, image_type_counts: includePrivateImage ? { unclear: 1 } : {}, extraction_warnings: [], document_embedding_field_types: [],
      optional_index_write_issues: optionalIssues, search_eval_hit_rate: null };
    const nativeQuality: AuditFixtureObject = { document_id: documentId, owner_id: ownerId, quality_score: 1,
      extraction_quality: "good", issues: [], metrics, updated_at: auditFixtureTime };
    const quality: AuditFixtureObject = { ...nativeQuality, anchor_coverage: null, model_fallback_rate: null, noisy_unit_rate: null,
      retrievable_visual_hit: null, source_span_coverage: null, typed_unit_coverage: null };
    const qualityOutput = fixtureEnvelope({ producer: "local-worker", producerVersion: "rag-deep-memory-v1", binding,
      units: [{ family: "quality", key: "singleton", output: nativeQuality }] });
    const workerMetadata: AuditFixtureObject = { indexed_at: auditFixtureTime, index_generation_id: candidateGenerationId,
      cover_image_id: null, rag_enrichment_version: "rag-deep-memory-v1", rag_indexing_version: "rag-deep-memory-v1",
      rag_memory_version: "rag-deep-memory-v1", rag_memory_updated_at: null, rag_enrichment_updated_at: null,
      enrichment_status: "pending", enrichment_error: includeControlRepair
        ? "Optional index artifact writes failed; queued for indexing-v3-agent repair." : null,
      section_count: includeProjectionItems ? 1 : 0,
      memory_card_count: includeProjectionItems ? 1 : 0,
      extraction_quality: nativeQuality.extraction_quality!, index_quality_score: nativeQuality.quality_score!,
      index_quality_issues: nativeQuality.issues!, index_quality_metrics: metrics, optional_index_write_issues: optionalIssues,
      indexing_v3_agent_status: "pending", indexing_v3_agent_last_error: includeControlRepair
        ? "Optional index artifact writes failed; queued for indexing-v3-agent repair.":"queued for optional repair",
      indexing_v3_agent_repair_reason: "optional_index_write_issues",
      indexing_v3_agent_updated_at: auditFixtureTime, embedding_model: "text-embedding-3-small",
      page_count: includeCoreRows ? duplicateNativePagePopulation ? 2 : 1 : 0, ocr_page_count: 0, needs_ocr_page_count: 0,
      text_character_count: includeCoreRows ? pageText.length * (duplicateNativePagePopulation ? 2 : 1) : 0,
      extracted_image_count: includePrivateImage ? 1 : 0,
      searchable_image_count: includePrivateImage ? 1 : 0, skipped_image_count: 0, skipped_image_reasons: {},
      image_type_counts: includePrivateImage ? { unclear: 1 } : {},
      extraction_warnings: [] };
    const documentCounts: AuditFixtureObject = { page_count: includeCoreRows ? duplicateNativePagePopulation ? 2 : 1 : 0,
      chunk_count: includeCoreRows ? 1 : 0, image_count: includePrivateImage ? 1 : 0,
      status: "indexed", error_message: null };
    const workerNative = { worker_metadata: workerMetadata, document_counts: documentCounts };
    const workerOutput = fixtureEnvelope({ producer: "local-worker", producerVersion: "rag-deep-memory-v1", binding,
      units: [{ family: "document_metadata", key: "singleton", output: workerNative }] });
    const sealedAt = index === 0 ? "2024-02-29T23:59:51.123456Z" : "2024-02-29T23:59:52.123456Z";
    const control = controlFixture("seal", baselineNull ? null : identityUuid(50));
    const patchJob = (job: AuditFixtureObject) => Object.assign(job, { id: jobId, document_id: documentId,
      requested_generation_id: candidateGenerationId, shadow_plan_digest: persistence.parameters.p_plan.digest,
      lease_token: firstLeaseToken, lease_expected_generation_id: baselineNull ? null : identityUuid(50),
      lease_write_generation_id: candidateGenerationId, lease_authority_digest: payload.source.authorityDigest });
    patchJob(control.before!.ownNodeJobs[0]!); patchJob(control.after.ownNodeJobs[0]!);
    control.before!.controlRevision = 19; control.after.controlRevision = 20;
    control.after.ownNodeJobs[0]!.completed_at = sealedAt;
    const stage = { id: identityUuid(720 + index), job_id: jobId, document_id: documentId,
      stage_name: "all producers", stage_status: "completed", error_class: null, retry_count: 0,
      metadata: {}, artifact_counts: { quality: 1, document_metadata: 1 }, error_message: null,
      started_at: "2024-02-29T23:59:40.000000Z", finished_at: "2024-02-29T23:59:45.000000Z",
      created_at: "2024-02-29T23:59:40.000000Z", job_kind: "node", lease_token: firstLeaseToken,
      index_generation_id: baselineNull ? null : identityUuid(50) };
    control.before!.ownStages = [stage]; control.after.ownStages = [structuredClone(stage)];
    const initialControl=structuredClone(control.before!);initialControl.controlRevision=1;initialControl.ownStages=[];
    const controlCaptureEnvelope=fixtureEnvelope(captureShadowProducerInputV1(initialControl),"u04-retained-evidence-v1");
    const controlOutput=fixtureEnvelope({producer:"local-worker",producerVersion:"rag-deep-memory-v1",binding,
      units:includeControlRepair?[{family:"attempt_control",key:jobId,output:controlCaptureEnvelope}]:[]});
    const repairInput={enrichmentStatus:"completed",enrichmentErrorMessage:null,optionalIssueCount:optionalIssues.length};
    const repairDecision={enrichmentStatus:"pending",enrichmentErrorMessage:
      "Optional index artifact writes failed; queued for indexing-v3-agent repair.",repairRequired:true,
      repairReason:"optional_index_write_issues",repairMessage:
      "Optional index artifact writes failed; queued for indexing-v3-agent repair."};
    const repairCaptureInput={input:repairInput,optionalIndexWriteIssues:optionalIssues,decision:repairDecision};
    const repairCaptureEnvelope=fixtureEnvelope(captureShadowProducerInputV1(repairCaptureInput),"u04-retained-evidence-v1");
    const repairOutput=fixtureEnvelope({producer:"local-worker",producerVersion:"rag-deep-memory-v1",binding,
      units:includeControlRepair?[{family:"repair_audit_inputs",key:"enrichment-repair",output:repairCaptureEnvelope}]:[]});
    const manifest = pendingInventoryFixture(); manifest.documentId = documentId; manifest.candidateGenerationId = candidateGenerationId;
    manifest.jobId = jobId;
    const retainedEvidence: AuditFixtureObject[] = [];
    for (const family of manifest.families) for (const group of family.groups) {
      const artifactGenerationId = group.groupKey === "deep_memory"
        ? projectionItems?.artifactGenerationId ?? auditFixtureUuid(900 + index) : null;
      const view = { ...binding, artifactGenerationId };
      const output = family.family === "quality" ? qualityOutput : family.family === "document_metadata" ? workerOutput
        : includeCoreRows && family.family === "pages" ? pageOutput
        : includeCoreRows && family.family === "chunks" ? chunkOutput
        : includeNativeCache && family.family === "native_structure" ? nativeOutput
        : includeNativeCache && family.family === "cache_inputs" ? cacheOutput
        : includeControlRepair && family.family === "attempt_control" ? controlOutput
        : includeControlRepair && family.family === "repair_audit_inputs" ? repairOutput
        : includePrivateImage && family.family === "images" ? imageOutput
        : includePrivateImage && family.family === "private_objects" ? privateOutput
        : includeProjectionItems && ["summary", "generated_labels"].includes(String(family.family)) ? projectionItems!.summaryOutput
        : includeProjectionItems && group.groupKey === "deep_memory" ? projectionItems!.deepOutput : fixtureEnvelope({ producer: "local-worker",
        producerVersion: "rag-deep-memory-v1", binding: view, units: [] });
      const expectedUnits = family.family === "quality" ? [{ family: "quality", key: "singleton" }]
        : family.family === "document_metadata" ? [{ family: "document_metadata", key: "singleton" }]
        : includeCoreRows && family.family === "pages" ? [{ family: "pages", key: "1" },
          ...(duplicateNativePagePopulation ? [{ family: "pages", key: "2" }] : [])]
        : includeCoreRows && family.family === "chunks" ? [{ family: "chunks", key: String(chunkInput.id) }]
        : includeNativeCache && family.family === "native_structure" ? [{ family: "native_structure", key: "extracted-document" }]
        : includeNativeCache && family.family === "cache_inputs" ? [{ family: "cache_inputs", key: "0" }]
        : includeControlRepair && family.family === "attempt_control" ? [{ family: "attempt_control", key: jobId }]
        : includeControlRepair && family.family === "repair_audit_inputs" ? [{ family: "repair_audit_inputs", key: "enrichment-repair" }]
        : includePrivateImage && family.family === "images" ? [{ family: "images", key: imageId }]
        : includePrivateImage && family.family === "private_objects" ? [{ family: "private_objects", key: privateKey }]
        : includeProjectionItems && family.family === "summary" ? [{ family: "summary", key: "singleton" }]
        : includeProjectionItems && family.family === "generated_labels" ? [{ family: "generated_labels", key: projectionItems!.labelKey }]
        : includeProjectionItems && group.groupKey === "deep_memory" && family.family === "sections" ? [{ family: "sections", key: "deep:0" }]
        : includeProjectionItems && group.groupKey === "deep_memory" && family.family === "memory_cards" ? [{ family: "memory_cards", key: "deep:0" }]
        : includeProjectionItems && group.groupKey === "deep_memory" && family.family === "index_units" ? [{ family: "index_units", key: "deep:0" }]
        : includeProjectionItems && family.family === "producer_aliases" ? projectionItems!.aliases.map((_alias, ordinal) =>
          ({ family: "producer_aliases", key: `deep:${ordinal}` })) : [];
      const ref = { tag: "retained_payload", envelopeDigest: output.digest, representation: "producer_json",
        mediaType: "application/json", byteLength: Buffer.byteLength(output.canonicalPayload, "utf8") };
      Object.assign(group, { state: "declared", declaration: { firstLeaseToken, producer: { name: "local-worker",
        version: includeNativeCache && family.family === "cache_inputs" ? "clinical-image-caption-cache-v2" : "rag-deep-memory-v1",
        outputManifestDigest: output.digest }, artifactGenerationId,
        population: { tag: "known", expectedUnits, basis: [{ ref, path: ["units"] }],
          reason: expectedUnits.length === 0 ? "no_units_expected" : null }, outputManifestEnvelope: output } });
      if (!retainedEvidence.some(value => (value.envelope as AuditFixtureObject).digest === output.digest))
        retainedEvidence.push({ tag: "payload", envelope: output, representation: "producer_json",
          mediaType: "application/json", byteLength: Buffer.byteLength(output.canonicalPayload, "utf8") });
    }
    if(includeNativeCache)for(const [envelope,representation] of [[nativeCaptureEnvelope,"producer_json"],
      [cacheCaptureEnvelope,"cache_input"]] as const)retainedEvidence.push({tag:"payload",envelope,representation,
        mediaType:"application/json",byteLength:Buffer.byteLength(envelope.canonicalPayload,"utf8")});
    if(includeControlRepair)for(const [envelope,representation] of [[controlCaptureEnvelope,"control_checkpoint"],
      [repairCaptureEnvelope,"repair_audit_input"]] as const)retainedEvidence.push({tag:"payload",envelope,representation,
        mediaType:"application/json",byteLength:Buffer.byteLength(envelope.canonicalPayload,"utf8")});
    if(includePrivateImage)retainedEvidence.push(privateObject);
    const declarations = [{ family: "document_metadata", unitKey: "singleton", expected: true, required: true,
      producer: "local-worker", sourceBinding: binding }, { family: "quality", unitKey: "singleton", expected: true,
      required: true, producer: "local-worker", sourceBinding: binding }, ...(includeCoreRows ? [
      { family: "chunks", unitKey: String(chunkInput.id), expected: true, required: true,
        producer: "local-worker", sourceBinding: binding },
        { family: "pages", unitKey: "1", expected: true, required: true,
        producer: "local-worker", sourceBinding: binding }, ...(includeNativeCache ? [
        { family: "native_structure", unitKey: "extracted-document", expected: true, required: false,
          producer: "local-worker", sourceBinding: binding },
        { family: "cache_inputs", unitKey: "0", expected: true, required: true,
          producer: "local-worker", sourceBinding: binding }] : []), ...(includePrivateImage ? [
        { family: "images", unitKey: imageId, expected: true, required: true, producer: "local-worker", sourceBinding: binding },
        { family: "private_objects", unitKey: privateKey, expected: true, required: true,
          producer: "local-worker", sourceBinding: binding }] : []), ...(includeControlRepair ? [
        { family: "attempt_control", unitKey: jobId, expected: true, required: true,
          producer: "local-worker", sourceBinding: binding },
        { family: "repair_audit_inputs", unitKey: "enrichment-repair", expected: true, required: true,
          producer: "local-worker", sourceBinding: binding }] : [])] : []), ...(includeProjectionItems ? [
      { family: "summary", unitKey: "singleton", expected: true, required: false,
        producer: "local-worker", sourceBinding: binding },
      { family: "generated_labels", unitKey: projectionItems!.labelKey, expected: true, required: false,
        producer: "local-worker", sourceBinding: binding },
      { family: "sections", unitKey: "deep:0", expected: true, required: false,
        producer: "local-worker", sourceBinding: projectionItems!.deepBinding },
      { family: "memory_cards", unitKey: "deep:0", expected: true, required: false,
        producer: "local-worker", sourceBinding: projectionItems!.deepBinding },
      { family: "index_units", unitKey: "deep:0", expected: true, required: false,
        producer: "local-worker", sourceBinding: projectionItems!.deepBinding },
      ...projectionItems!.aliases.map((_alias, ordinal) => ({ family: "producer_aliases", unitKey: `deep:${ordinal}`,
        expected: true, required: false, producer: "local-worker", sourceBinding: projectionItems!.deepBinding }))] : [])]
      .sort((left, right) => String(left.family).localeCompare(String(right.family)) || String(left.unitKey).localeCompare(String(right.unitKey)));
    const expectedInventoryPayload = { manifest, declarations };
    const expectedInventoryEnvelope = pgEnvelope(expectedInventoryPayload, "inventory");
    const qualityProjection = { kind: "u04-quality-projection-v1", binding, outputManifestEnvelope: qualityOutput, quality };
    const qualityDigest = pgEnvelope(qualityProjection, "projection").digest;
    const projectionRow: AuditFixtureObject = { document_id: documentId, index_generation_id: candidateGenerationId,
      lease_token: firstLeaseToken, owner_id: ownerId, summary: projectionItems?.summary ?? null,
      generated_labels: projectionItems ? [projectionItems.label] : null,
      summary_projection_complete: projectionItems ? true : null,
      enrichment_metadata: projectionItems?.enrichmentMetadata ?? null, quality, worker_metadata: workerMetadata, document_counts: documentCounts,
      deep_memory_artifact_generation_id: projectionItems?.artifactGenerationId ?? null,
      deep_memory_receipt: projectionItems?.receipt ?? null, deep_memory_metadata: projectionItems?.deepMetadata ?? null,
      producer_aliases: projectionItems ? projectionItems.aliases : null,
      summary_digest: projectionItems ? pgEnvelope({ kind: "u04-summary-projection-v1", binding,
        outputManifestEnvelope: projectionItems.summaryOutput, summary: projectionItems.summary,
        generated_labels: [projectionItems.label], summary_projection_complete: true,
        enrichment_metadata: projectionItems.enrichmentMetadata }, "projection").digest : null,
      quality_digest: qualityDigest,
      deep_memory_digest: projectionItems ? pgEnvelope({ kind: "u04-deep-projection-v1", binding: projectionItems.deepBinding,
        outputManifestEnvelope: projectionItems.deepOutput, deep_memory_receipt: projectionItems.receipt,
        deep_memory_metadata: projectionItems.deepMetadata, producer_aliases: projectionItems.aliases }, "projection").digest : null,
      worker_state_digest: pgEnvelope({ kind: "u04-worker-projection-v1", binding, outputManifestEnvelope: workerOutput,
        worker_metadata: workerMetadata, document_counts: documentCounts }, "projection").digest, sealed_at: sealedAt };
    const projectionEnvelope = pgEnvelope(projectionRow, "projection");
    const valueEnvelope = pgEnvelope(quality, "projection");
    const nativeEnvelope = fixtureEnvelope(nativeQuality);
    const disposition: AuditFixtureObject = { family: "quality", unitKey: "singleton", disposition: "retained", reasonCode: null,
      limitations: [], artifactRef: { tag: "candidate_projection", slot: "quality", itemId: null,
        payloadDigest: valueEnvelope.digest }, contentDigest: valueEnvelope.digest, relationships: [], retainedEvidenceText: null,
      retainedNativePayload: JSON.stringify(nativeEnvelope), representationVersion: null, transformVersion: null };
    const workerValueEnvelope = pgEnvelope(workerMetadata, "projection");
    const workerDisposition: AuditFixtureObject = { family: "document_metadata", unitKey: "singleton", disposition: "retained",
      reasonCode: null, limitations: [], artifactRef: { tag: "candidate_projection", slot: "worker_metadata", itemId: null,
        payloadDigest: workerValueEnvelope.digest }, contentDigest: workerValueEnvelope.digest, relationships: [],
      retainedEvidenceText: null, retainedNativePayload: JSON.stringify(fixtureEnvelope(workerNative)),
      representationVersion: null, transformVersion: null };
    const pageRowEnvelope = fixtureEnvelope(pageStored, "baseline", "pg-jsonb-text-v1");
    const page2RowEnvelope = fixtureEnvelope(page2Stored, "baseline", "pg-jsonb-text-v1");
    const chunkRowEnvelope = fixtureEnvelope(chunkStored, "baseline", "pg-jsonb-text-v1");
    const pageDisposition: AuditFixtureObject = { family: "pages", unitKey: "1", disposition: "retained", reasonCode: null,
      limitations: [], artifactRef: { tag: "candidate_row", owner: "page", rowId: pageStored.id!,
        rowDigest: pageRowEnvelope.digest }, contentDigest: pageRowEnvelope.digest, relationships: [],
      retainedEvidenceText: null, retainedNativePayload: JSON.stringify(fixtureEnvelope(pageNative)),
      representationVersion: null, transformVersion: null };
    const page2Disposition: AuditFixtureObject = { family: "pages", unitKey: "2", disposition: "retained", reasonCode: null,
      limitations: [], artifactRef: { tag: "candidate_row", owner: "page", rowId: page2Stored.id!,
        rowDigest: page2RowEnvelope.digest }, contentDigest: page2RowEnvelope.digest, relationships: [],
      retainedEvidenceText: null, retainedNativePayload: JSON.stringify(fixtureEnvelope(page2Native)),
      representationVersion: null, transformVersion: null };
    const chunkRelationships: AuditFixtureObject[] = [
      { tag: "page", field: ["page_number"], target: { family: "pages", key: "1" } },
      ...(includeProjectionItems ? [{ tag: "anchor", field: ["anchor_id"],
        target: { family: "chunks", key: String(chunkInput.id) }, value: chunkStored.anchor_id! }] : []),
    ];
    const chunkDisposition: AuditFixtureObject = { family: "chunks", unitKey: String(chunkInput.id), disposition: "retained",
      reasonCode: null, limitations: [], artifactRef: { tag: "candidate_row", owner: "chunk", rowId: chunkStored.id!,
        rowDigest: chunkRowEnvelope.digest }, contentDigest: chunkRowEnvelope.digest, relationships: chunkRelationships,
      retainedEvidenceText: null, retainedNativePayload: JSON.stringify(fixtureEnvelope(chunkNative)),
      representationVersion: null, transformVersion: null };
    const imageDisposition: AuditFixtureObject = { family: "images", unitKey: imageId, disposition: "retained",
      reasonCode: null, limitations: [], artifactRef: { tag: "candidate_row", owner: "image", rowId: imageId,
        rowDigest: imageRowEnvelope.digest }, contentDigest: imageRowEnvelope.digest,
      relationships: [{ tag: "private_object", field: ["storage_path"],
        target: { family: "private_objects", key: privateKey } }], retainedEvidenceText: null,
      retainedNativePayload: JSON.stringify(fixtureEnvelope(imageNative)), representationVersion: null, transformVersion: null };
    const privateDisposition: AuditFixtureObject = { family: "private_objects", unitKey: privateKey,
      disposition: "retained", reasonCode: null, limitations: [], artifactRef: privateRef,
      contentDigest: privateRef.sha256!, relationships: [{ tag: "input", field: ["ref", "objectPath"],
        target: { family: "images", key: imageId } }], retainedEvidenceText: null,
      retainedNativePayload: (privateObject.bytes as AuditFixtureObject).content!, representationVersion: null,
      transformVersion: null };
    const retainedCaptureDisposition = (family: "native_structure" | "cache_inputs" | "attempt_control" | "repair_audit_inputs",
      unitKey: string, envelope: ReturnType<typeof fixtureEnvelope>,
      representation: "producer_json" | "cache_input" | "control_checkpoint" | "repair_audit_input",
      relationships: AuditFixtureJson[]): AuditFixtureObject => ({ family, unitKey, disposition: "retained", reasonCode: null,
      limitations: [], artifactRef: { tag: "retained_payload", envelopeDigest: envelope.digest, representation,
        mediaType: "application/json", byteLength: Buffer.byteLength(envelope.canonicalPayload, "utf8") },
      contentDigest: envelope.digest, relationships, retainedEvidenceText: null,
      retainedNativePayload: envelope.canonicalPayload, representationVersion: null, transformVersion: null });
    const nativeDisposition = retainedCaptureDisposition("native_structure", "extracted-document", nativeCaptureEnvelope,
      "producer_json", []);
    const cacheDisposition = retainedCaptureDisposition("cache_inputs", "0", cacheCaptureEnvelope, "cache_input",
      [{ tag: "input", field: ["input", "task", "image", "path"],
        target: { family: "native_structure", key: "extracted-document" } }]);
    const controlDisposition = retainedCaptureDisposition("attempt_control", jobId, controlCaptureEnvelope,
      "control_checkpoint", []);
    const repairDisposition = retainedCaptureDisposition("repair_audit_inputs", "enrichment-repair", repairCaptureEnvelope,
      "repair_audit_input", []);
    const sourceChunk = (field: (string | number)[]) => ({ tag: "source_chunk", field,
      target: { family: "chunks", key: String(chunkInput.id) } });
    const sourceImage = (field: (string | number)[]) => ({ tag: "source_image", field, target: { family: "images", key: imageId } });
    const sourcePage = (field: (string | number)[]) => ({ tag: "page", field, target: { family: "pages", key: "1" } });
    const projectionDisposition = (family: string, unitKey: string, slot: string, itemId: string | null,
      value: AuditFixtureJson, planned: AuditFixtureJson, relationships: AuditFixtureJson[]): AuditFixtureObject => {
      const valueEnvelope = pgEnvelope(value, "projection");
      return { family, unitKey, disposition: "retained", reasonCode: null, limitations: [],
        artifactRef: { tag: "candidate_projection", slot, itemId, payloadDigest: valueEnvelope.digest },
        contentDigest: valueEnvelope.digest, relationships, retainedEvidenceText: null,
        retainedNativePayload: JSON.stringify(fixtureEnvelope(planned)), representationVersion: null, transformVersion: null };
    };
    const summaryDisposition = projectionItems ? projectionDisposition("summary", "singleton", "summary", null,
      projectionItems.summary, projectionItems.planned.summary, [
        sourceChunk(["source_chunk_ids", 0]),
        sourceChunk(["metadata", "source_anchored_summary_v1", "source_chunk_ids", 0]),
        ...(includePrivateImage ? [sourceImage(["source_image_ids", 0]),
          sourceImage(["metadata", "source_anchored_summary_v1", "source_image_ids", 0])] : []),
        sourceChunk(["metadata", "source_anchored_summary_v1", "clinical_specifics", "profile", "key_clinical_actions", 0, "source_chunk_ids", 0]),
        sourcePage(["metadata", "source_anchored_summary_v1", "clinical_specifics", "profile", "key_clinical_actions", 0, "pages", 0]),
      ]) : null;
    const labelDisposition = projectionItems ? projectionDisposition("generated_labels", projectionItems.labelKey,
      "generated_labels", String(projectionItems.label.id), projectionItems.label, projectionItems.planned.label,
      [sourceChunk(["metadata", "source_chunk_ids", 0]), sourcePage(["metadata", "pages", 0])]) : null;
    const deepRowDisposition = (family: "sections" | "memory_cards" | "index_units", owner: string,
      row: AuditFixtureObject, rowEnvelope: ReturnType<typeof fixtureEnvelope>, planned: AuditFixtureJson,
      relationships: AuditFixtureJson[]): AuditFixtureObject => ({ family, unitKey: "deep:0", disposition: "retained",
      reasonCode: null, limitations: [], artifactRef: { tag: "candidate_row", owner, rowId: row.id!, rowDigest: rowEnvelope.digest },
      contentDigest: rowEnvelope.digest, relationships, retainedEvidenceText: null,
      retainedNativePayload: JSON.stringify(fixtureEnvelope(planned)), representationVersion: null, transformVersion: null });
    const sectionDisposition = projectionItems ? deepRowDisposition("sections", "section", projectionItems.section,
      projectionItems.sectionEnvelope, projectionItems.planned.section,
      [sourceChunk(["chunk_ids", 0]), sourcePage(["page_start"]), sourcePage(["page_end"])]) : null;
    const cardDisposition = projectionItems ? deepRowDisposition("memory_cards", "memory_card", projectionItems.card,
      projectionItems.cardEnvelope, projectionItems.planned.card, [
        { tag: "section", field: ["section_id"], target: { family: "sections", key: "deep:0" } },
        sourceChunk(["source_chunk_ids", 0]), sourcePage(["page_number"])]) : null;
    const deepUnitDisposition = projectionItems ? deepRowDisposition("index_units", "index_unit", projectionItems.unit,
      projectionItems.unitEnvelope, projectionItems.planned.unit,
      [sourceChunk(["source_chunk_id"]), sourcePage(["page_start"]), sourcePage(["page_end"])]) : null;
    const aliasDispositions = projectionItems ? projectionItems.aliases.map((alias, ordinal) =>
      projectionDisposition("producer_aliases", `deep:${ordinal}`, "producer_aliases", String(alias.id), alias,
        projectionItems.planned.aliases[ordinal]!, [sourceChunk(["metadata", "source_chunk_ids", 0])])) : [];
    const aliasDisposition = aliasDispositions[0] ?? null;
    const workerInventoryRow: AuditFixtureObject = { document_id: documentId, index_generation_id: candidateGenerationId,
      family: "document_metadata", unit_key: "singleton", lease_token: firstLeaseToken, expected: true, required: true,
      disposition: "retained", reason_code: null, limitations: [], producer: "local-worker", artifact_generation_id: null,
      artifact_ref: workerDisposition.artifactRef!, content_digest: workerDisposition.contentDigest!, source_binding: binding,
      relationships: [], retained_evidence_text: null, retained_native_payload: workerDisposition.retainedNativePayload!,
      representation_version: null, transform_version: null };
    const inventoryRow: AuditFixtureObject = { document_id: documentId, index_generation_id: candidateGenerationId,
      family: "quality", unit_key: "singleton", lease_token: firstLeaseToken, expected: true, required: true,
      disposition: "retained", reason_code: null, limitations: [], producer: "local-worker", artifact_generation_id: null,
      artifact_ref: disposition.artifactRef!, content_digest: disposition.contentDigest!, source_binding: binding, relationships: [],
      retained_evidence_text: null, retained_native_payload: disposition.retainedNativePayload!, representation_version: null, transform_version: null };
    const coreInventoryRow = (coreDisposition: AuditFixtureObject): AuditFixtureObject => {
      const deep = ["sections", "memory_cards", "producer_aliases"].includes(String(coreDisposition.family)) ||
        (coreDisposition.family === "index_units" && coreDisposition.unitKey === "deep:0");
      return { document_id: documentId,
      index_generation_id: candidateGenerationId, family: coreDisposition.family!, unit_key: coreDisposition.unitKey!,
      lease_token: firstLeaseToken, expected: true, required: true, disposition: "retained", reason_code: null,
      limitations: [], producer: "local-worker", artifact_generation_id: deep ? projectionItems!.artifactGenerationId : null,
      artifact_ref: coreDisposition.artifactRef!, content_digest: coreDisposition.contentDigest!,
      source_binding: deep ? projectionItems!.deepBinding : binding, relationships: coreDisposition.relationships!,
      retained_evidence_text: null, retained_native_payload: coreDisposition.retainedNativePayload!, representation_version: null,
      transform_version: null };
    };
    const pageInventoryRow = coreInventoryRow(pageDisposition);
    const page2InventoryRow = coreInventoryRow(page2Disposition);
    const chunkInventoryRow = coreInventoryRow(chunkDisposition);
    const projectionDispositions = projectionItems ? [summaryDisposition!, labelDisposition!, sectionDisposition!,
      cardDisposition!, deepUnitDisposition!, ...aliasDispositions] : [];
    const finalDispositions = [workerDisposition, disposition, ...(includeCoreRows ? [pageDisposition,
      ...(duplicateNativePagePopulation ? [page2Disposition] : []), chunkDisposition,
      ...(includeNativeCache ? [nativeDisposition, cacheDisposition] : []),
      ...(includePrivateImage ? [imageDisposition, privateDisposition] : []),
      ...(includeControlRepair ? [controlDisposition, repairDisposition] : [])] : []),
      ...projectionDispositions]
      .sort((left, right) => String(left.family).localeCompare(String(right.family)) || String(left.unitKey).localeCompare(String(right.unitKey)));
    const projectionInventoryRows = projectionDispositions.map(coreInventoryRow);
    for (const row of projectionInventoryRows) row.required = false;
    const inventoryRows = [workerInventoryRow, inventoryRow, ...(includeCoreRows ? [pageInventoryRow,
      ...(duplicateNativePagePopulation ? [page2InventoryRow] : []), chunkInventoryRow,
      ...(includeNativeCache ? [coreInventoryRow(nativeDisposition), coreInventoryRow(cacheDisposition)] : []),
      ...(includePrivateImage ? [coreInventoryRow(imageDisposition), coreInventoryRow(privateDisposition)] : []),
      ...(includeControlRepair ? [coreInventoryRow(controlDisposition), coreInventoryRow(repairDisposition)] : [])] : []),
      ...projectionInventoryRows]
      .sort((left, right) => String(left.family).localeCompare(String(right.family)) || String(left.unit_key).localeCompare(String(right.unit_key)));
    const nativeInventoryRow=inventoryRows.find(row=>row.family==="native_structure")??null;
    if(nativeInventoryRow)nativeInventoryRow.required=false;
    const inventoryRowEnvelopes = inventoryRows.map(row => fixtureEnvelope(row, "baseline", "pg-jsonb-text-v1"));
    const inventoryRowEnvelope = fixtureEnvelope(inventoryRow, "baseline", "pg-jsonb-text-v1");
    const preSealControlEnvelope = pgEnvelope(control.before as AuditFixtureJson, "control");
    const terminalControlEnvelope = pgEnvelope(control.after as AuditFixtureJson, "control");
    const finalInventoryPayload: AuditFixtureObject = { kind: "u04-final-inventory-v1", version: 1, binding,
      expectedInventoryEnvelope, finalDispositions, projectionEnvelope, preSealControlEnvelope,
      candidateRows: includeCoreRows ? [
        { table: "document_chunks", rowEnvelope: chunkRowEnvelope },
        ...(includePrivateImage ? [{ table: "document_images", rowEnvelope: imageRowEnvelope }] : []),
        ...(projectionItems ? [
          { table: "document_index_units", rowEnvelope: projectionItems.unitEnvelope },
          { table: "document_memory_cards", rowEnvelope: projectionItems.cardEnvelope }] : []),
        { table: "document_pages", rowEnvelope: pageRowEnvelope },
        ...(duplicateNativePagePopulation ? [{ table: "document_pages", rowEnvelope: page2RowEnvelope }] : []),
        ...(projectionItems ? [{ table: "document_sections", rowEnvelope: projectionItems.sectionEnvelope }] : []),
      ] : [], retainedEvidence };
    const finalInventoryEnvelope = pgEnvelope(finalInventoryPayload, "inventory");
    const receiptPayload: AuditFixtureObject = { kind: "u04-member-seal-receipt-v1", version: 1, binding,
      planDigest: persistence.parameters.p_plan.digest, preparedOriginDigest: persistence.fixture.input.originEnvelope.digest,
      executionProfileDigest: profileEnvelope.digest, caseSetDigest: persistence.fixture.profile.cases.digest,
      expectedStateDigest: persistence.fixture.input.originEnvelope.digest.slice(7), baselineBundleDigest: bundleEnvelope.digest,
      expectedInventoryDigest: expectedInventoryEnvelope.digest, finalInventoryEnvelope,
      candidateProjectionDigest: projectionEnvelope.digest, terminalControlEnvelope, sealedAt, limitations: [] };
    const memberReceiptEnvelope = pgEnvelope(receiptPayload, "member_receipt");
    const memberRow: AuditFixtureObject = { document_id: documentId, index_generation_id: candidateGenerationId, owner_id: ownerId,
      baseline_generation_id: baselineNull ? null : identityUuid(50), expected_state_digest: receiptPayload.expectedStateDigest!,
      authority_digest: payload.source.authorityDigest, source_binding: payload.source, job_id: jobId, first_lease_token: firstLeaseToken,
      claimed_at: control.before!.ownNodeJobs[0]!.locked_at!, state: "staged", expected_inventory_digest: expectedInventoryEnvelope.digest,
      inventory_digest: finalInventoryEnvelope.digest, candidate_projection_digest: projectionEnvelope.digest,
      baseline_bundle_digest: bundleEnvelope.digest, stage_receipt: memberReceiptEnvelope, stage_receipt_digest: memberReceiptEnvelope.digest,
      staged_at: sealedAt, control_revision: 20, control_snapshot: control.after, original_origin_envelope: persistence.fixture.input.originEnvelope,
      inventory_manifest: manifest };
    const memberRowEnvelope = fixtureEnvelope(memberRow, "baseline", "pg-jsonb-text-v1");
    const baselineRow: AuditFixtureObject = { document_id: documentId, candidate_generation_id: candidateGenerationId,
      baseline_generation_id: baselineNull ? null : identityUuid(50), expected_state_digest: receiptPayload.expectedStateDigest!,
      bundle_version: 1, bundle_payload: bundleEnvelope, bundle_digest: bundleEnvelope.digest, captured_at: persistence.now };
    const workerInventoryRowEnvelope = fixtureEnvelope(workerInventoryRow, "baseline", "pg-jsonb-text-v1");
    const memberContext = { memberRowEnvelope, profileEnvelope, inventoryRowEnvelopes,
      originalOriginEnvelope: persistence.fixture.input.originEnvelope, planDigest: persistence.parameters.p_plan.digest };
    return { documentId, binding, manifest, expectedInventoryPayload, expectedInventoryEnvelope, qualityOutput, disposition,
      workerDisposition, pageDisposition, page2Disposition, chunkDisposition, imageDisposition, privateDisposition,
      nativeDisposition, cacheDisposition, nativeCaptureEnvelope, cacheCaptureEnvelope, nativeOutput, cacheOutput,
      controlDisposition, repairDisposition, controlCaptureEnvelope, repairCaptureEnvelope, controlOutput, repairOutput,
      initialControl, repairCaptureInput,
      extracted, extractedImage, extractedBytes, cacheTask, classification, nativeCaptureInput, cacheCaptureInput,
      summaryDisposition, labelDisposition, sectionDisposition,
      cardDisposition, deepUnitDisposition, aliasDisposition, aliasDispositions, finalDispositions, projectionItems,
      projectionRow, projectionEnvelope, finalInventoryPayload,
      finalInventoryEnvelope, receiptPayload, memberReceiptEnvelope, memberRow, memberRowEnvelope, inventoryRow,
      inventoryRowEnvelope, workerInventoryRow, workerInventoryRowEnvelope, pageInventoryRow, page2InventoryRow, chunkInventoryRow,
      inventoryRows, inventoryRowEnvelopes, pageStored, chunkStored, imageStored, privateObject, privateRef, privateKey,
      pageRowEnvelope, page2RowEnvelope, chunkRowEnvelope, imageRowEnvelope, imageOutput, privateOutput, baselineRow,
      page2Native, page2Stored,
      baselineRowEnvelope: fixtureEnvelope(baselineRow, "baseline", "pg-jsonb-text-v1"),
      control, memberContext, sealedAt };
  });
  const wavePayload: AuditFixtureObject = { kind: "u04-wave-seal-receipt-v1", version: 1, candidateGenerationId,
    planDigest: persistence.parameters.p_plan.digest, preparedOriginDigest: persistence.fixture.input.originEnvelope.digest,
    executionProfileDigest: profileEnvelope.digest, caseSetDigest: persistence.fixture.profile.cases.digest,
    baselineReportDigest: persistence.fixture.input.caseResultsEnvelope.digest, recoveryEvidenceDigest: prepared.recoveryEvidenceDigest,
    operationManifestDigest: persistence.parameters.p_operation_manifest.digest, documentIds: members.map(value => value.documentId),
    members: members.map(value => ({ documentId: value.documentId, memberReceiptEnvelope: value.memberReceiptEnvelope })),
    sealedAt: members[1]!.sealedAt };
  const waveReceiptEnvelope = pgEnvelope(wavePayload, "wave_receipt");
  const waveRow: AuditFixtureObject = { candidate_generation_id: candidateGenerationId, plan_digest: wavePayload.planDigest!, plan_version: 1,
    project_ref: persistence.fixture.profile.target.projectRef, source_policy_version: persistence.fixture.profile.sourcePolicyVersion,
    audit_digest: persistence.planPayload.plan.auditDigest, population_fingerprint: persistence.planPayload.plan.populationFingerprint,
    recovery_evidence_digest: wavePayload.recoveryEvidenceDigest!, baseline_evaluation_digest: persistence.parameters.p_baseline_evaluation.digest,
    operation_manifest_digest: wavePayload.operationManifestDigest!, plan_payload: persistence.parameters.p_plan, created_at: persistence.now,
    prepared_origin_digest: wavePayload.preparedOriginDigest!, execution_profile_digest: wavePayload.executionProfileDigest!,
    case_set_digest: wavePayload.caseSetDigest!, baseline_report: persistence.parameters.p_baseline_evaluation,
    baseline_report_digest: wavePayload.baselineReportDigest! };
  const observed = JSON.parse(persistence.fixture.input.originEnvelope.canonicalPayload) as AuditFixtureObject;
  const add = (table: string, envelopes: AuditFixtureJson[]) => fixtureSet(observed, ["rows", table],
    [...(fixtureGet(observed, ["rows", table]) as AuditFixtureJson[]), ...envelopes]);
  add("document_index_generations", members.map(value => value.memberRowEnvelope));
  add("document_generation_inventory", members.flatMap(value => value.inventoryRowEnvelopes));
  add("document_generation_projections", members.map(value => pgEnvelope(value.projectionRow, "baseline")));
  add("document_generation_baselines", members.map(value => value.baselineRowEnvelope));
  add("ingestion_jobs", members.map(value => pgEnvelope(value.control.after.ownNodeJobs[0] as AuditFixtureJson, "baseline")));
  add("ingestion_job_stages", members.flatMap(value => value.control.after.ownStages.map(row => pgEnvelope(row as AuditFixtureJson, "baseline"))));
  if (includeCoreRows) {
    add("document_chunks", members.map(value => value.chunkRowEnvelope));
    add("document_pages", members.flatMap(value => [value.pageRowEnvelope,
      ...(duplicateNativePagePopulation ? [value.page2RowEnvelope] : [])]));
    if(includePrivateImage)add("document_images",members.map(value=>value.imageRowEnvelope));
  }
  if (includeProjectionItems) {
    add("document_index_units", members.map(value => value.projectionItems!.unitEnvelope));
    add("document_memory_cards", members.map(value => value.projectionItems!.cardEnvelope));
    add("document_sections", members.map(value => value.projectionItems!.sectionEnvelope));
  }
  const waveRowEnvelope = fixtureEnvelope(waveRow, "baseline", "pg-jsonb-text-v1"); add("shadow_reindex_waves", [waveRowEnvelope]);
  observed.capturedAt = "2024-03-01T00:01:00.000000Z";
  const observedOriginEnvelope = fixtureEnvelope(observed, "baseline", "pg-jsonb-text-v1");
  const readback = { version: 1, waveReceiptEnvelope,
    baselineRows: members.map(value => ({ documentId: value.documentId, rowEnvelope: value.baselineRowEnvelope })), observedOriginEnvelope };
  const context = { waveRowEnvelope, currentOriginEnvelope: observedOriginEnvelope,
    members: members.map(value => ({ documentId: value.documentId, memberContext: value.memberContext,
      persistenceAdmission: persistence.admission })) };
  const rebindMember = (index: number) => {
    const member = members[index]!;
    member.expectedInventoryEnvelope = pgEnvelope(member.expectedInventoryPayload, "inventory");
    member.finalInventoryPayload.expectedInventoryEnvelope = member.expectedInventoryEnvelope;
    member.projectionEnvelope = pgEnvelope(member.projectionRow, "projection");
    member.finalInventoryPayload.projectionEnvelope = member.projectionEnvelope;
    member.finalInventoryPayload.preSealControlEnvelope = pgEnvelope(member.control.before as AuditFixtureJson, "control");
    member.finalInventoryPayload.finalDispositions = member.finalDispositions;
    member.finalInventoryEnvelope = pgEnvelope(member.finalInventoryPayload, "inventory");
    member.receiptPayload.finalInventoryEnvelope = member.finalInventoryEnvelope;
    member.receiptPayload.expectedInventoryDigest = member.expectedInventoryEnvelope.digest;
    member.receiptPayload.candidateProjectionDigest = member.projectionEnvelope.digest;
    member.receiptPayload.terminalControlEnvelope = pgEnvelope(member.control.after as AuditFixtureJson, "control");
    member.receiptPayload.sealedAt = member.sealedAt;
    member.memberReceiptEnvelope = pgEnvelope(member.receiptPayload, "member_receipt");
    member.memberRow.inventory_digest = member.finalInventoryEnvelope.digest;
    member.memberRow.expected_inventory_digest = member.expectedInventoryEnvelope.digest;
    member.memberRow.candidate_projection_digest = member.projectionEnvelope.digest;
    member.memberRow.stage_receipt = member.memberReceiptEnvelope;
    member.memberRow.stage_receipt_digest = member.memberReceiptEnvelope.digest;
    member.memberRow.staged_at = member.sealedAt;
    member.memberRow.control_revision = member.control.after.controlRevision;
    member.memberRow.control_snapshot = member.control.after;
    member.memberRowEnvelope = fixtureEnvelope(member.memberRow, "baseline", "pg-jsonb-text-v1");
    member.memberContext.memberRowEnvelope = member.memberRowEnvelope;
    for (const disposition of member.finalDispositions) {
      const row = member.inventoryRows.find(value => value.family === disposition.family && value.unit_key === disposition.unitKey)!;
      row.disposition = disposition.disposition!; row.reason_code = disposition.reasonCode!;
      row.limitations = disposition.limitations!; row.artifact_ref = disposition.artifactRef!;
      row.content_digest = disposition.contentDigest!; row.relationships = disposition.relationships!;
      row.retained_evidence_text = disposition.retainedEvidenceText!;
      row.retained_native_payload = disposition.retainedNativePayload!;
      row.representation_version = disposition.representationVersion!; row.transform_version = disposition.transformVersion!;
    }
    member.inventoryRowEnvelopes = member.inventoryRows.map(row => fixtureEnvelope(row, "baseline", "pg-jsonb-text-v1"));
    member.memberContext.inventoryRowEnvelopes = member.inventoryRowEnvelopes;
    (wavePayload.members as AuditFixtureObject[])[index]!.memberReceiptEnvelope = member.memberReceiptEnvelope;
    readback.waveReceiptEnvelope = pgEnvelope(wavePayload, "wave_receipt");
  };
  const rebindCoreRow = (index: number, family: "pages" | "chunks" | "images") => {
    const member = members[index]!;
    const row = family === "pages" ? member.pageStored : family === "chunks" ? member.chunkStored : member.imageStored;
    const disposition = family === "pages" ? member.pageDisposition : family === "chunks" ? member.chunkDisposition : member.imageDisposition;
    const candidate = (member.finalInventoryPayload.candidateRows as AuditFixtureObject[])
      .find(value => value.table === (family === "pages" ? "document_pages" : family === "chunks" ? "document_chunks" : "document_images"))!;
    candidate.rowEnvelope = family === "images" ? pgEnvelope(row, "baseline") : fixtureEnvelope(row, "baseline", "pg-jsonb-text-v1");
    (disposition.artifactRef as AuditFixtureObject).rowId = row.id!;
    (disposition.artifactRef as AuditFixtureObject).rowDigest = (candidate.rowEnvelope as AuditFixtureObject).digest!;
    disposition.contentDigest = (candidate.rowEnvelope as AuditFixtureObject).digest!;
    rebindMember(index);
  };
  return { persistence, prepared, bundleEnvelope, profileEnvelope, candidateGenerationId, members, wavePayload,
    waveReceiptEnvelope, waveRow, waveRowEnvelope, observed, observedOriginEnvelope, readback, context, pgEnvelope,
    rebindMember, rebindCoreRow };
}

describe("U04 final inventory and receipt reconciliation", () => {
  it.each([false, true])("validates a complete two-member wave and maximum seal time with legacy-null=%s", baselineNull => {
    const f = finalReceiptFixture(baselineNull);
    const first = f.members[0]!;
    expect(readShadowFinalInventoryV1(first.finalInventoryEnvelope, { memberRowEnvelope: first.memberContext.memberRowEnvelope,
      profileEnvelope: first.memberContext.profileEnvelope, inventoryRowEnvelopes: first.memberContext.inventoryRowEnvelopes,
      originalOriginEnvelope: first.memberContext.originalOriginEnvelope, sealedAt: first.sealedAt }).kind)
      .toBe("shadow-final-inventory-validated");
    expect(readShadowMemberSealReceiptV1(f.members[0]!.memberReceiptEnvelope, f.members[0]!.memberContext).kind)
      .toBe("shadow-member-seal-receipt-validated");
    const result = readShadowWaveReadbackV1(f.readback, f.context);
    expect(result.kind).toBe("shadow-wave-readback-validated"); expect(result.members).toHaveLength(2);
    expect(f.wavePayload.baselineReportDigest).toBe(f.persistence.fixture.input.caseResultsEnvelope.digest);
    expect(f.wavePayload.sealedAt).toBe(f.members[1]!.sealedAt);
  });

  it.each(["missing member", "missing inventory", "missing retained", "extra candidate", "forged required", "swapped receipt", "changed projection",
    "changed disposition", "wrong worker slot", "substituted artifact", "substituted pointer", "terminal revision", "incomplete stage", "nested document",
    "seal timestamp", "wave maximum", "stale origin"] as const)("refuses rebound %s evidence", fault => {
    const f = finalReceiptFixture();
    if (fault === "missing member") f.readback.baselineRows.pop();
    if (fault === "missing inventory") f.members[0]!.memberContext.inventoryRowEnvelopes.pop();
    if (fault === "missing retained") { (f.members[0]!.finalInventoryPayload.retainedEvidence as AuditFixtureJson[]).pop(); f.rebindMember(0); }
    if (fault === "extra candidate") { (f.members[0]!.finalInventoryPayload.candidateRows as AuditFixtureJson[]).push({
      table: "document_pages", rowEnvelope: fixtureEnvelope(f.persistence.fixture.data[0]!.page, "baseline", "pg-jsonb-text-v1") });
      f.rebindMember(0); }
    if (fault === "forged required") { f.members[0]!.expectedInventoryPayload.declarations[0]!.required = false;
      f.members[0]!.workerInventoryRow.required = false; f.rebindMember(0); }
    if (fault === "swapped receipt") { const waveMembers=f.wavePayload.members as AuditFixtureObject[];
      f.wavePayload.members = [waveMembers[1]!, waveMembers[0]!];
      f.readback.waveReceiptEnvelope = f.pgEnvelope(f.wavePayload, "wave_receipt"); }
    if (fault === "changed projection") { f.members[0]!.projectionRow.quality_digest = fixtureSha("changed projection"); f.rebindMember(0); }
    if (fault === "changed disposition") { f.members[0]!.disposition.contentDigest = fixtureSha("changed disposition");
      f.members[0]!.inventoryRow.content_digest = f.members[0]!.disposition.contentDigest!; f.rebindMember(0); }
    if (fault === "wrong worker slot") { (f.members[0]!.workerDisposition.artifactRef as AuditFixtureObject).slot = "document_counts";
      f.rebindMember(0); }
    if (fault === "substituted artifact") { f.members[0]!.disposition.artifactRef = { tag: "retained_payload",
      envelopeDigest: f.members[0]!.qualityOutput.digest, representation: "producer_json", mediaType: "application/json",
      byteLength: Buffer.byteLength(f.members[0]!.qualityOutput.canonicalPayload, "utf8") };
      f.members[0]!.disposition.contentDigest = f.members[0]!.qualityOutput.digest; f.rebindMember(0); }
    if (fault === "substituted pointer") { const limitation = { version: 1, code: "measurement_unavailable",
      scope: { family: "quality", key: "singleton" }, evidence: [{ ref: f.members[0]!.workerDisposition.artifactRef,
        path: [] }], explanation: "synthetic pointer substitution", blocks: ["full_engine_evaluation"] };
      f.members[0]!.disposition.limitations = [limitation]; f.members[0]!.inventoryRow.limitations = [limitation]; f.rebindMember(0); }
    if (fault === "terminal revision") { f.members[0]!.control.after.controlRevision = 21; f.rebindMember(0); }
    if (fault === "incomplete stage") { f.members[0]!.control.before!.ownStages[0]!.stage_status = "failed";
      f.members[0]!.control.after.ownStages[0]!.stage_status = "failed"; f.rebindMember(0); }
    if (fault === "nested document") { (f.wavePayload.members as AuditFixtureObject[])[0]!.memberReceiptEnvelope = f.members[1]!.memberReceiptEnvelope;
      f.context.members[0]!.memberContext = f.members[1]!.memberContext;
      f.readback.waveReceiptEnvelope = f.pgEnvelope(f.wavePayload, "wave_receipt"); }
    if (fault === "seal timestamp") { f.members[0]!.sealedAt = "2024-02-29T23:59:53.123456Z";
      f.members[0]!.projectionRow.sealed_at = f.members[0]!.sealedAt;
      f.members[0]!.control.after.ownNodeJobs[0]!.completed_at = f.members[0]!.sealedAt; f.rebindMember(0); }
    if (fault === "wave maximum") { f.wavePayload.sealedAt = f.members[0]!.sealedAt;
      f.readback.waveReceiptEnvelope = f.pgEnvelope(f.wavePayload, "wave_receipt"); }
    if (fault === "stale origin") f.context.currentOriginEnvelope = f.persistence.fixture.input.originEnvelope;
    expect(() => readShadowWaveReadbackV1(f.readback, f.context)).toThrow("Invalid shadow comparison record.");
  });

  it("keeps bare seal and absent terminal state comparisons unavailable", () => {
    const seal = controlFixture("seal");
    expect(validateShadowControlTransitionV1(seal.before, seal.intent, seal.after, seal.clock)).toMatchObject({ ok: false, reason: "unsealed_wave" });
    const state = reservedStateFixture(true); state.input.phase = "after_seal";
    expect(compareShadowStateV1(state.input, state.fixture.admission, state.bindings)).toMatchObject({ ok: false, reason: "unsealed_wave" });
  });
});

describe("U04 core-row final inventory integration", () => {
  const finalContext = (member: ReturnType<typeof finalReceiptFixture>["members"][number]) => ({
    memberRowEnvelope: member.memberContext.memberRowEnvelope,
    profileEnvelope: member.memberContext.profileEnvelope,
    inventoryRowEnvelopes: member.memberContext.inventoryRowEnvelopes,
    originalOriginEnvelope: member.memberContext.originalOriginEnvelope,
    sealedAt: member.sealedAt,
  });

  it("validates exact page and chunk after-images through the complete two-member readback", () => {
    const f = finalReceiptFixture(false, true);
    expect(readShadowFinalInventoryV1(f.members[0]!.finalInventoryEnvelope, finalContext(f.members[0]!)).kind)
      .toBe("shadow-final-inventory-validated");
    expect(readShadowWaveReadbackV1(f.readback, f.context).kind).toBe("shadow-wave-readback-validated");
    expect(measureShadowWaveReadbackBytesV1(f.readback))
      .toBeGreaterThan(Buffer.byteLength(f.readback.observedOriginEnvelope.canonicalPayload, "utf8"));
  });

  it("refuses a fully rehashed chunk after-image whose native input is unchanged", () => {
    const f = finalReceiptFixture(false, true), member = f.members[0]!;
    member.chunkStored.content = "Rehashed substituted chunk content.";
    f.rebindCoreRow(0, "chunks");
    expect(() => readShadowFinalInventoryV1(member.finalInventoryEnvelope, finalContext(member)))
      .toThrow("Invalid shadow comparison record.");
  });

  it("refuses a rebound chunk with an omitted fixed page relationship", () => {
    const f = finalReceiptFixture(false, true), member = f.members[0]!;
    member.chunkDisposition.relationships = [];
    f.rebindMember(0);
    expect(() => readShadowFinalInventoryV1(member.finalInventoryEnvelope, finalContext(member)))
      .toThrow("Invalid shadow comparison record.");
  });

  it.each(["missing", "extra"] as const)("refuses %s candidate-row population", fault => {
    const f = finalReceiptFixture(false, true), member = f.members[0]!;
    const candidates = member.finalInventoryPayload.candidateRows as AuditFixtureObject[];
    if (fault === "missing") candidates.pop();
    else {
      const extra = structuredClone(member.chunkStored); extra.id = auditFixtureUuid(998);
      candidates.splice(1, 0, { table: "document_chunks", rowEnvelope: fixtureEnvelope(extra, "baseline", "pg-jsonb-text-v1") });
    }
    f.rebindMember(0);
    expect(() => readShadowFinalInventoryV1(member.finalInventoryEnvelope, finalContext(member)))
      .toThrow("Invalid shadow comparison record.");
  });

  it("refuses an unproved repaired chunk anchor even when its row digest and relationship are rebound", () => {
    const f = finalReceiptFixture(false, true), member = f.members[0]!;
    member.chunkStored.anchor_id = "candidate-anchor";
    Object.assign(member.chunkStored.metadata as AuditFixtureObject,
      { anchor_id: "candidate-anchor", anchor_repaired_by: "document-intelligence-v2" });
    member.chunkDisposition.relationships = [{ tag: "page", field: ["page_number"], target: { family: "pages", key: "1" } },
      { tag: "anchor", field: ["anchor_id"], target: { family: "chunks", key: String(member.chunkStored.id) }, value: "candidate-anchor" }];
    f.rebindCoreRow(0, "chunks");
    expect(() => readShadowFinalInventoryV1(member.finalInventoryEnvelope, finalContext(member)))
      .toThrow("Invalid shadow comparison record.");
  });

  it("does not reuse a validated bundle for a second member with changed admission", () => {
    const f = finalReceiptFixture(false, true);
    const changed = structuredClone(f.context.members[1]!.persistenceAdmission);
    (changed.validation as AuditFixtureObject).baselineCompletedAt = "2024-03-01T00:00:00.000099Z";
    f.context.members[1]!.persistenceAdmission = changed;
    expect(() => readShadowWaveReadbackV1(f.readback, f.context)).toThrow("Invalid shadow comparison record.");
  });
});

describe("U04 projection-item final inventory integration", () => {
  const finalContext = (member: ReturnType<typeof finalReceiptFixture>["members"][number]) => ({
    memberRowEnvelope: member.memberContext.memberRowEnvelope,
    profileEnvelope: member.memberContext.profileEnvelope,
    inventoryRowEnvelopes: member.memberContext.inventoryRowEnvelopes,
    originalOriginEnvelope: member.memberContext.originalOriginEnvelope,
    sealedAt: member.sealedAt,
  });

  it("validates summary, label, two aliases and exact deep row mappings in a complete wave", () => {
    const f = finalReceiptFixture(false, true, true), member = f.members[0]!;
    const final = readShadowFinalInventoryV1(member.finalInventoryEnvelope, finalContext(member));
    expect(final.projection.components.summary?.kind).toBe("shadow-summary-component-validated");
    expect(final.projection.components.deep?.kind).toBe("shadow-candidate-deep-projection-validated");
    expect(readShadowWaveReadbackV1(f.readback, f.context).kind).toBe("shadow-wave-readback-validated");
  });

  it.each(["summary slot", "label item", "alias item"] as const)("refuses a rebound wrong %s reference", fault => {
    const f = finalReceiptFixture(false, true, true), member = f.members[0]!;
    const disposition = fault === "summary slot" ? member.summaryDisposition!
      : fault === "label item" ? member.labelDisposition! : member.aliasDisposition!;
    const ref = disposition.artifactRef as AuditFixtureObject;
    if (fault === "summary slot") ref.slot = "generated_labels";
    else ref.itemId = auditFixtureUuid(999);
    f.rebindMember(0);
    expect(() => readShadowFinalInventoryV1(member.finalInventoryEnvelope, finalContext(member)))
      .toThrow("Invalid shadow comparison record.");
  });

  it("refuses a rebound summary that omits one claim-level source edge", () => {
    const f = finalReceiptFixture(false, true, true), member = f.members[0]!;
    member.summaryDisposition!.relationships = (member.summaryDisposition!.relationships as AuditFixtureObject[])
      .filter(edge => !((edge.field as AuditFixtureJson[]).includes("key_clinical_actions") && edge.tag === "page"));
    f.rebindMember(0);
    expect(() => readShadowFinalInventoryV1(member.finalInventoryEnvelope, finalContext(member)))
      .toThrow("Invalid shadow comparison record.");
  });

  it("refuses a fully rehashed deep section that no longer matches the validated receipt mapping", () => {
    const f = finalReceiptFixture(false, true, true), member = f.members[0]!;
    member.projectionItems!.section.heading = "Rehashed substituted deep section";
    const rowEnvelope = fixtureEnvelope(member.projectionItems!.section, "baseline", "pg-jsonb-text-v1");
    const candidate = (member.finalInventoryPayload.candidateRows as AuditFixtureObject[])
      .find(value => value.table === "document_sections")!;
    candidate.rowEnvelope = rowEnvelope;
    (member.sectionDisposition!.artifactRef as AuditFixtureObject).rowDigest = rowEnvelope.digest;
    member.sectionDisposition!.contentDigest = rowEnvelope.digest;
    f.rebindMember(0);
    expect(() => readShadowFinalInventoryV1(member.finalInventoryEnvelope, finalContext(member)))
      .toThrow("Invalid shadow comparison record.");
  });

  it("refuses a fully rehashed projection whose aliases reverse original deep ordinals", () => {
    const f = finalReceiptFixture(false, true, true), member = f.members[0]!, items = member.projectionItems!;
    member.projectionRow.producer_aliases = [...items.aliases].reverse();
    const swappedRefs = member.aliasDispositions.map(disposition => ({
      artifactRef: disposition.artifactRef, contentDigest: disposition.contentDigest,
    })).reverse();
    member.aliasDispositions.forEach((disposition, index) => Object.assign(disposition, swappedRefs[index]));
    member.projectionRow.deep_memory_digest = f.pgEnvelope({ kind: "u04-deep-projection-v1", binding: items.deepBinding,
      outputManifestEnvelope: items.deepOutput, deep_memory_receipt: items.receipt,
      deep_memory_metadata: items.deepMetadata, producer_aliases: member.projectionRow.producer_aliases }, "projection").digest;
    f.rebindMember(0);
    expect(() => readShadowFinalInventoryV1(member.finalInventoryEnvelope, finalContext(member)))
      .toThrow("Invalid shadow comparison record.");
  });

  it("refuses a source-bearing optional projection reported nonretained without its relationship graph", () => {
    const f = finalReceiptFixture(false, true, true), member = f.members[0]!, disposition = member.summaryDisposition!;
    disposition.disposition = "failed"; disposition.reasonCode = "producer_failed";
    disposition.artifactRef = null; disposition.contentDigest = null; disposition.relationships = [];
    disposition.limitations = [{ version: 1, code: "producer_failed", scope: { family: "summary", key: "singleton" },
      evidence: [], explanation: "Synthetic summary producer failed after retaining its planned output.",
      blocks: ["summary_context", "audit_mapping"] }];
    disposition.retainedNativePayload = encodeShadowNodeJsonCanonicalPayload(member.projectionItems!.planned.summary);
    f.rebindMember(0);
    expect(() => readShadowFinalInventoryV1(member.finalInventoryEnvelope, finalContext(member)))
      .toThrow("Invalid shadow comparison record.");
  });

  it("refuses a fresh readback whose private projection changes a stored slot", () => {
    const f = finalReceiptFixture(false, true, true);
    const observed = structuredClone(f.observed);
    const projections = fixtureGet(observed, ["rows", "document_generation_projections"]) as AuditFixtureObject[];
    const changed = structuredClone(f.members[0]!.projectionRow);
    changed.generated_labels = [{ ...(changed.generated_labels as AuditFixtureObject[])[0]!, label: "changed-live-projection-label" }];
    projections[0] = f.pgEnvelope(changed, "baseline");
    const envelope = fixtureEnvelope(observed, "baseline", "pg-jsonb-text-v1");
    f.readback.observedOriginEnvelope = envelope; f.context.currentOriginEnvelope = envelope;
    expect(() => readShadowWaveReadbackV1(f.readback, f.context)).toThrow("Invalid shadow comparison record.");
  });
});

describe("U04 image-private final inventory integration", () => {
  const finalContext = (member: ReturnType<typeof finalReceiptFixture>["members"][number]) => ({
    memberRowEnvelope: member.memberContext.memberRowEnvelope,
    profileEnvelope: member.memberContext.profileEnvelope,
    inventoryRowEnvelopes: member.memberContext.inventoryRowEnvelopes,
    originalOriginEnvelope: member.memberContext.originalOriginEnvelope,
    sealedAt: member.sealedAt,
  });

  it("validates complete private bytes and reciprocal image attachment for both members", () => {
    const f = finalReceiptFixture(false, true, false, true);
    for(const member of f.members)
      expect(readShadowFinalInventoryV1(member.finalInventoryEnvelope,finalContext(member)).kind)
        .toBe("shadow-final-inventory-validated");
    expect(readShadowWaveReadbackV1(f.readback,f.context).kind).toBe("shadow-wave-readback-validated");
  });

  it.each(["missing evidence", "tampered bytes", "unattested extra", "wrong ref"] as const)
  ("refuses fully rebound private-object %s", fault => {
    const f=finalReceiptFixture(false,true,false,true),member=f.members[0]!;
    const retained=member.finalInventoryPayload.retainedEvidence as AuditFixtureObject[];
    const privateIndex=retained.findIndex(value=>value.tag==="private_object");
    if(fault==="missing evidence")retained.splice(privateIndex,1);
    else if(fault==="tampered bytes"){
      const bytes=retained[privateIndex]!.bytes as AuditFixtureObject;
      bytes.content=Buffer.from("Tampered private candidate image!").toString("base64");
    }else if(fault==="unattested extra"){
      const extra=structuredClone(retained[privateIndex]!);
      (extra.ref as AuditFixtureObject).objectPath=`${String((extra.ref as AuditFixtureObject).objectPath)}.extra`;
      retained.push(extra);
    }else (member.privateDisposition.artifactRef as AuditFixtureObject).objectVersion="foreign-version";
    f.rebindMember(0);
    expect(()=>readShadowFinalInventoryV1(member.finalInventoryEnvelope,finalContext(member)))
      .toThrow("Invalid shadow comparison record.");
  });

  it.each(["image to object", "object to image"] as const)("refuses a missing reciprocal %s edge", direction => {
    const f=finalReceiptFixture(false,true,false,true),member=f.members[0]!;
    (direction==="image to object"?member.imageDisposition:member.privateDisposition).relationships=[];
    f.rebindMember(0);
    expect(()=>readShadowFinalInventoryV1(member.finalInventoryEnvelope,finalContext(member)))
      .toThrow("Invalid shadow comparison record.");
  });
});

describe("U04 native-cache final inventory integration", () => {
  const finalContext = (member: ReturnType<typeof finalReceiptFixture>["members"][number]) => ({
    memberRowEnvelope: member.memberContext.memberRowEnvelope,
    profileEnvelope: member.memberContext.profileEnvelope,
    inventoryRowEnvelopes: member.memberContext.inventoryRowEnvelopes,
    originalOriginEnvelope: member.memberContext.originalOriginEnvelope,
    sealedAt: member.sealedAt,
  });
  const rebindCapture = (f: ReturnType<typeof finalReceiptFixture>, memberIndex: number,
    family: "native_structure" | "cache_inputs", nativeInput: AuditFixtureObject) => {
    const member=f.members[memberIndex]!,isCache=family==="cache_inputs";
    const oldNested=isCache?member.cacheCaptureEnvelope:member.nativeCaptureEnvelope;
    const oldOutput=isCache?member.cacheOutput:member.nativeOutput;
    const nested=fixtureEnvelope(captureShadowProducerInputV1(nativeInput),"u04-retained-evidence-v1");
    const outputPayload=JSON.parse(oldOutput.canonicalPayload) as AuditFixtureObject;
    fixtureSet(outputPayload,["units",0,"output"],nested);
    const output=fixtureEnvelope(outputPayload);
    const group=(member.manifest.families as AuditFixtureObject[]).find(value=>value.family===family)!.groups as AuditFixtureObject[];
    const declaration=group[0]!.declaration as AuditFixtureObject;
    declaration.outputManifestEnvelope=output;
    fixtureSet(declaration,["producer","outputManifestDigest"],output.digest);
    fixtureSet(declaration,["population","basis",0,"ref","envelopeDigest"],output.digest);
    fixtureSet(declaration,["population","basis",0,"ref","byteLength"],Buffer.byteLength(output.canonicalPayload,"utf8"));
    const retained=member.finalInventoryPayload.retainedEvidence as AuditFixtureObject[];
    const replace=(digest:string,envelope:ReturnType<typeof fixtureEnvelope>,representation:string)=>{
      const entry=retained.find(value=>value.tag==="payload"&&(value.envelope as AuditFixtureObject).digest===digest)!;
      Object.assign(entry,{envelope,representation,mediaType:"application/json",
        byteLength:Buffer.byteLength(envelope.canonicalPayload,"utf8")});
    };
    replace(oldOutput.digest,output,"producer_json");
    replace(oldNested.digest,nested,isCache?"cache_input":"producer_json");
    const disposition=isCache?member.cacheDisposition:member.nativeDisposition;
    Object.assign(disposition.artifactRef as AuditFixtureObject,{envelopeDigest:nested.digest,
      byteLength:Buffer.byteLength(nested.canonicalPayload,"utf8")});
    disposition.contentDigest=nested.digest;disposition.retainedNativePayload=nested.canonicalPayload;
    if(isCache){member.cacheCaptureEnvelope=nested;member.cacheOutput=output;member.cacheCaptureInput=nativeInput;}
    else {member.nativeCaptureEnvelope=nested;member.nativeOutput=output;member.nativeCaptureInput=nativeInput;}
    f.rebindMember(memberIndex);
  };
  const nullPageInputs = (member: ReturnType<typeof finalReceiptFixture>["members"][number]) => {
    const native = structuredClone(member.nativeCaptureInput);
    fixtureSet(native, ["extracted", "images", 0, "pageNumber"], null);
    const cache = structuredClone(member.cacheCaptureInput);
    fixtureSet(cache, ["task", "image"], structuredClone(fixtureGet(native, ["extracted", "images", 0])));
    fixtureSet(cache, ["task", "candidate", "pageNumber"], null);
    fixtureSet(cache, ["task", "candidate", "nearbyText"], null);
    Object.defineProperty(cache.task as AuditFixtureObject, "nearbyText",
      { value: undefined, enumerable: true, writable: true, configurable: true });
    return { native, cache };
  };

  it("validates exact native extraction bytes and indexed cache inputs through the complete wave",()=>{
    const f=finalReceiptFixture(false,true,false,false,true);
    for(const member of f.members)
      expect(readShadowFinalInventoryV1(member.finalInventoryEnvelope,finalContext(member)).kind)
        .toBe("shadow-final-inventory-validated");
    expect(readShadowWaveReadbackV1(f.readback,f.context).kind).toBe("shadow-wave-readback-validated");
  });

  it("preserves the producer's null candidate and own-undefined task nearby text", () => {
    const f = finalReceiptFixture(false, true, false, false, true), member = f.members[0]!;
    const value = nullPageInputs(member);
    rebindCapture(f, 0, "native_structure", value.native);
    rebindCapture(f, 0, "cache_inputs", value.cache);
    expect(readShadowFinalInventoryV1(member.finalInventoryEnvelope, finalContext(member)).kind)
      .toBe("shadow-final-inventory-validated");
  });

  it.each(["missing task own-undefined", "candidate own-undefined"] as const)(
    "refuses a null-page cache capture with %s nearby text", fault => {
      const f = finalReceiptFixture(false, true, false, false, true), member = f.members[0]!;
      const value = nullPageInputs(member);
      if (fault === "missing task own-undefined")
        delete ((value.cache.task as AuditFixtureObject).nearbyText);
      else Object.defineProperty(fixtureGet(value.cache, ["task", "candidate"]) as AuditFixtureObject, "nearbyText",
        { value: undefined, enumerable: true, writable: true, configurable: true });
      rebindCapture(f, 0, "native_structure", value.native);
      rebindCapture(f, 0, "cache_inputs", value.cache);
      expect(() => readShadowFinalInventoryV1(member.finalInventoryEnvelope, finalContext(member)))
        .toThrow("Invalid shadow comparison record.");
    });

  it("refuses duplicate native pages paired with a different complete declared page", () => {
    const f = finalReceiptFixture(false, true, false, false, true, false, true), member = f.members[0]!;
    expect(() => readShadowFinalInventoryV1(member.finalInventoryEnvelope, finalContext(member)))
      .toThrow("Invalid shadow comparison record.");
  });

  it("accepts exact ECMAScript whitespace and UTF-16 table metadata derived by the producer", () => {
    const f = finalReceiptFixture(false, true, false, false, true), member = f.members[0]!;
    const native = structuredClone(member.nativeCaptureInput);
    const raw = `\uFEFF\u00A0X${"😀".repeat(600)}  clinical\u00A0table  \uFEFF`;
    const tableText = raw.trim();
    const compacted = tableText.replace(/\s+/g, " ").trim();
    const tableTextSnippet = compacted.length > 1200 ? `${compacted.slice(0, 1197).trim()}...` : compacted;
    fixtureSet(native, ["extracted", "images", 0, "metadata"], { table_text: raw });
    const cache = structuredClone(member.cacheCaptureInput);
    const metadata = { table_text: raw };
    fixtureSet(cache, ["task", "image", "metadata"], metadata);
    fixtureSet(cache, ["task", "candidate", "metadata"], metadata);
    fixtureSet(cache, ["task", "tableMetadata"], { candidateType: null, tableLabel: null, tableTitle: null,
      tableRole: null, tableConfidence: null, tableText, tableTextSnippet, accessibleTableMarkdown: tableText,
      tableRows: null, tableColumns: null });
    rebindCapture(f, 0, "native_structure", native);
    rebindCapture(f, 0, "cache_inputs", cache);
    expect(readShadowFinalInventoryV1(member.finalInventoryEnvelope, finalContext(member)).kind)
      .toBe("shadow-final-inventory-validated");
  });

  it.each(["native page", "missing image bytes", "changed image bytes", "cache owner", "cache index",
    "classification shape"] as const)("refuses a fully rebound %s capture",fault=>{
    const f=finalReceiptFixture(false,true,false,false,true),member=f.members[0]!;
    if(fault==="native page"){
      const native=structuredClone(member.nativeCaptureInput);
      fixtureSet(native,["extracted","pages",0,"text"],"Substituted extracted page text.");
      rebindCapture(f,0,"native_structure",native);
    }else if(fault==="missing image bytes"){
      const native=structuredClone(member.nativeCaptureInput);native.imageBytes=[];
      rebindCapture(f,0,"native_structure",native);
    }else if(fault==="changed image bytes"){
      const native=structuredClone(member.nativeCaptureInput);
      fixtureSet(native,["imageBytes",0,"content"],Buffer.from("Changed complete extracted image bytes.").toString("base64"));
      rebindCapture(f,0,"native_structure",native);
    }else{
      const cache=structuredClone(member.cacheCaptureInput);
      if(fault==="cache owner")cache.ownerId=auditFixtureUuid(999);
      if(fault==="cache index"){
        fixtureSet(cache,["task","index"],1);fixtureSet(cache,["task","candidate","originalIndex"],1);
      }
      if(fault==="classification shape")fixtureSet(cache,["classification","unrecorded_field"],true);
      rebindCapture(f,0,"cache_inputs",cache);
    }
    expect(()=>readShadowFinalInventoryV1(member.finalInventoryEnvelope,finalContext(member)))
      .toThrow("Invalid shadow comparison record.");
  });

  it("refuses a cache capture whose exact native-input relationship is omitted",()=>{
    const f=finalReceiptFixture(false,true,false,false,true),member=f.members[0]!;
    member.cacheDisposition.relationships=[];f.rebindMember(0);
    expect(()=>readShadowFinalInventoryV1(member.finalInventoryEnvelope,finalContext(member)))
      .toThrow("Invalid shadow comparison record.");
  });
});

describe("U04 control-repair final inventory integration", () => {
  const finalContext = (member: ReturnType<typeof finalReceiptFixture>["members"][number]) => ({
    memberRowEnvelope: member.memberContext.memberRowEnvelope,
    profileEnvelope: member.memberContext.profileEnvelope,
    inventoryRowEnvelopes: member.memberContext.inventoryRowEnvelopes,
    originalOriginEnvelope: member.memberContext.originalOriginEnvelope,
    sealedAt: member.sealedAt,
  });
  const rebindCapture = (f: ReturnType<typeof finalReceiptFixture>, memberIndex: number,
    family: "attempt_control" | "repair_audit_inputs", nativeInput: AuditFixtureObject) => {
    const member = f.members[memberIndex]!, isRepair = family === "repair_audit_inputs";
    const oldNested = isRepair ? member.repairCaptureEnvelope : member.controlCaptureEnvelope;
    const oldOutput = isRepair ? member.repairOutput : member.controlOutput;
    const nested = fixtureEnvelope(captureShadowProducerInputV1(nativeInput), "u04-retained-evidence-v1");
    const outputPayload = JSON.parse(oldOutput.canonicalPayload) as AuditFixtureObject;
    fixtureSet(outputPayload, ["units", 0, "output"], nested);
    const output = fixtureEnvelope(outputPayload);
    const familyEntry = (member.manifest.families as AuditFixtureObject[]).find(value => value.family === family)!;
    const declaration = ((familyEntry.groups as AuditFixtureObject[])[0]!.declaration) as AuditFixtureObject;
    declaration.outputManifestEnvelope = output;
    fixtureSet(declaration, ["producer", "outputManifestDigest"], output.digest);
    fixtureSet(declaration, ["population", "basis", 0, "ref", "envelopeDigest"], output.digest);
    fixtureSet(declaration, ["population", "basis", 0, "ref", "byteLength"], Buffer.byteLength(output.canonicalPayload, "utf8"));
    const retained = member.finalInventoryPayload.retainedEvidence as AuditFixtureObject[];
    const replace = (digest: string, envelope: ReturnType<typeof fixtureEnvelope>, representation: string) => {
      const entry = retained.find(value => value.tag === "payload" &&
        (value.envelope as AuditFixtureObject).digest === digest)!;
      Object.assign(entry, { envelope, representation, mediaType: "application/json",
        byteLength: Buffer.byteLength(envelope.canonicalPayload, "utf8") });
    };
    replace(oldOutput.digest, output, "producer_json");
    replace(oldNested.digest, nested, isRepair ? "repair_audit_input" : "control_checkpoint");
    const disposition = isRepair ? member.repairDisposition : member.controlDisposition;
    Object.assign(disposition.artifactRef as AuditFixtureObject, { envelopeDigest: nested.digest,
      byteLength: Buffer.byteLength(nested.canonicalPayload, "utf8") });
    disposition.contentDigest = nested.digest;
    disposition.retainedNativePayload = nested.canonicalPayload;
    if (isRepair) {
      member.repairCaptureEnvelope = nested;
      member.repairOutput = output;
      Object.assign(member.repairCaptureInput, nativeInput);
    } else {
      member.controlCaptureEnvelope = nested;
      member.controlOutput = output;
      Object.assign(member.initialControl, nativeInput);
    }
    f.rebindMember(memberIndex);
  };

  it("validates original claim control and exact repair inputs through the complete wave", () => {
    const f = finalReceiptFixture(false, true, false, false, true, true);
    for (const member of f.members)
      expect(readShadowFinalInventoryV1(member.finalInventoryEnvelope, finalContext(member)).kind)
        .toBe("shadow-final-inventory-validated");
    expect(readShadowWaveReadbackV1(f.readback, f.context).kind).toBe("shadow-wave-readback-validated");
  });

  it.each(["control revision", "control stage scope", "fabricated repair decision", "projection issue mismatch"] as const)(
    "refuses fully rebound %s evidence", fault => {
      const f = finalReceiptFixture(false, true, false, false, true, true), member = f.members[0]!;
      if (fault === "control revision" || fault === "control stage scope") {
        const initial = structuredClone(member.initialControl);
        if (fault === "control revision") initial.controlRevision = 20;
        else initial.ownStages = [structuredClone(member.control.before!.ownStages[0]!)];
        rebindCapture(f, 0, "attempt_control", initial);
      } else {
        const repair = structuredClone(member.repairCaptureInput);
        if (fault === "fabricated repair decision")
          fixtureSet(repair, ["decision", "repairMessage"], "Fabricated internally consistent repair message.");
        else fixtureSet(repair, ["optionalIndexWriteIssues", 0, "message"], "Substituted optional issue evidence.");
        rebindCapture(f, 0, "repair_audit_inputs", repair);
      }
      expect(() => readShadowFinalInventoryV1(member.finalInventoryEnvelope, finalContext(member)))
        .toThrow("Invalid shadow comparison record.");
    });

  it.each(["attempt_control", "repair_audit_inputs"] as const)("refuses an invented %s graph edge", family => {
    const f = finalReceiptFixture(false, true, false, false, true, true), member = f.members[0]!;
    const disposition = family === "attempt_control" ? member.controlDisposition : member.repairDisposition;
    disposition.relationships = [{ tag: "input", field: ["invented"],
      target: { family: "quality", key: "singleton" } }];
    f.rebindMember(0);
    expect(() => readShadowFinalInventoryV1(member.finalInventoryEnvelope, finalContext(member)))
      .toThrow("Invalid shadow comparison record.");
  });
});

function zeroUnitStateFixture(family:InventoryFamilyFixture="chunks"){
    const state=reservedStateFixture(true);
    const member=state.input.binding.members[0]!;
    const output=fixtureEnvelope({producer:"local-worker",producerVersion:"core-v1",binding:{tag:"candidate",source:state.fixture.memberPayloads[0]!.source,
      candidateGenerationId:state.input.binding.candidateGenerationId,jobId:member.jobId,firstLeaseToken:member.firstLeaseToken!,artifactGenerationId:null},units:[]});
    rebindStateRow(state,"document_index_generations",0,row=>{
      const families=fixtureGet(row,["inventory_manifest","families"]) as AuditFixtureObject[];
      const group=families.find(entry=>entry.family===family)!;
      fixtureSet(group,["groups",0],{groupKey:family==="sections"?"deep_memory":"worker_core",state:"declared",declaration:{firstLeaseToken:member.firstLeaseToken!,
        producer:{name:"local-worker",version:"core-v1",outputManifestDigest:output.digest},outputManifestEnvelope:output,artifactGenerationId:null,
        population:{tag:"known",expectedUnits:[],reason:"no_units_expected",basis:[{ref:{tag:"retained_payload",envelopeDigest:output.digest,
          representation:"producer_json",mediaType:"application/json",byteLength:Buffer.byteLength(output.canonicalPayload,"utf8")},path:["units"]}]}}});
    });
  return {state,output};
}

describe("U04 durable slot output envelopes", () => {
  it("retains a complete zero-unit declaration through the actual state reader with no unit row", () => {
    const {state,output}=zeroUnitStateFixture();
    expect(fixtureGet(state.current,["rows","document_generation_inventory"])).toEqual([]);
    const stored=JSON.parse(String(fixtureGet(state.current,["rows","document_index_generations",0,"canonicalPayload"]))) as AuditFixtureObject;
    const parsed=parseShadowInventoryManifestPayload(stored.inventory_manifest);
    const declaration=parsed.payload.families.find(family=>family.family==="chunks")!.groups[0]!;
    if(declaration.state!=="declared")throw new Error("Synthetic declaration missing.");
    expect(declaration.declaration.outputManifestEnvelope).toEqual(output);
    expect(compareShadowStateV1(state.input,state.fixture.admission,state.bindings)).toMatchObject({ok:true,kind:"sanctioned_u04_state"});
  });
  it.each(["missing","changed bytes","different valid envelope","extra key"])("refuses a %s declaration envelope", fault=>{
    const input=declaredInventoryFixture();const declaration=inventoryDeclarationFixture(input,"chunks");
    if(fault==="missing"){
      const {outputManifestEnvelope,...withoutEnvelope}=declaration;expect(outputManifestEnvelope).toBeDefined();
      Object.assign(inventoryGroupFixture(input,"chunks"),{declaration:withoutEnvelope});
    }else if(fault==="changed bytes") declaration.outputManifestEnvelope.canonicalPayload+=" ";
    else if(fault==="different valid envelope") declaration.outputManifestEnvelope=fixtureEnvelope({planned:"changed complete output"});
    else Object.assign(declaration.outputManifestEnvelope,{undeclared:true});
    expect(()=>parseShadowInventoryManifestPayload(input)).toThrow();
  });
  it("includes full zero-unit slot bytes in the all-slot digest and preserves shared batch identity",()=>{
    const input=declaredInventoryFixture();const parsed=parseShadowInventoryManifestPayload(input);
    const before=createShadowNodeJsonByteEnvelope(parsed.payload,"inventory").envelope.digest;
    const declaration=inventoryDeclarationFixture(input,"chunks");
    const replacement=fixtureEnvelope({planned:"different zero-unit complete output"});
    declaration.outputManifestEnvelope=replacement;declaration.producer.outputManifestDigest=replacement.digest;
    const after=parseShadowInventoryManifestPayload(input);
    expect(createShadowNodeJsonByteEnvelope(after.payload,"inventory").envelope.digest).not.toBe(before);
    const deep=after.payload.families.flatMap(family=>family.groups.filter(group=>group.groupKey==="deep_memory"));
    expect(new Set(deep.map(group=>group.state==="declared"?group.declaration.outputManifestEnvelope.digest:null)).size).toBe(1);
  });
  it.each(["missing unit bytes","different unit bytes"])("keeps independent nonzero unit evidence: %s",fault=>{
    const state=deepCandidateStateFixture(true);
    rebindStateRow(state,"document_generation_inventory",0,row=>{
      row.retained_native_payload=fault==="missing unit bytes"?null:JSON.stringify(fixtureEnvelope({id:auditFixtureUuid(820),summary:"substituted unit bytes"}));
    });
    expect(compareShadowStateV1(state.input,state.fixture.admission,state.bindings)).toMatchObject({ok:false,reason:"invalid_input",fieldPaths:["state"]});
  });
});

describe("U04 complete declaration reconciliation",()=>{
  it.each(["source","candidate","job","token","unlisted output","unavailable with output"])("refuses fully rebound zero-slot %s",fault=>{
    const family=fault==="unavailable with output"?"sections":"chunks";
    const {state}=zeroUnitStateFixture(family);
    rebindStateRow(state,"document_index_generations",0,row=>{
      const families=fixtureGet(row,["inventory_manifest","families"]) as AuditFixtureObject[];
      const declaration=fixtureGet(families.find(entry=>entry.family===family)!,["groups",0,"declaration"]) as AuditFixtureObject;
      const planned=JSON.parse(String(fixtureGet(declaration,["outputManifestEnvelope","canonicalPayload"]))) as AuditFixtureObject;
      if(fault==="source")fixtureSet(planned,["binding","source","contentHash"],fixtureSha("foreign original source"));
      if(fault==="candidate")fixtureSet(planned,["binding","candidateGenerationId"],auditFixtureUuid(802));
      if(fault==="job")fixtureSet(planned,["binding","jobId"],auditFixtureUuid(702));
      if(fault==="token")fixtureSet(planned,["binding","firstLeaseToken"],auditFixtureUuid(703));
      if(fault==="unlisted output"||fault==="unavailable with output")planned.units=[{family,key:auditFixtureUuid(888),output:{content:"Available partial output remains retained."}}];
      const envelope=fixtureEnvelope(planned);
      declaration.outputManifestEnvelope=envelope;fixtureSet(declaration,["producer","outputManifestDigest"],envelope.digest);
      fixtureSet(declaration,["population","basis",0,"ref","envelopeDigest"],envelope.digest);
      fixtureSet(declaration,["population","basis",0,"ref","byteLength"],Buffer.byteLength(envelope.canonicalPayload,"utf8"));
      if(fault==="unavailable with output")declaration.population={tag:"unavailable",limitation:inventoryLimitationFixture(family)};
      expect(()=>parseShadowInventoryManifestPayload(row.inventory_manifest)).not.toThrow();
    });
    expect(compareShadowStateV1(state.input,state.fixture.admission,state.bindings)).toMatchObject({ok:false,reason:"invalid_input",fieldPaths:["state"]});
  });
  it.each(["foreign typed","null typed","missing typed","foreign metadata","null metadata","missing metadata"])("refuses rebound original D evidence: %s",fault=>{
    const state=deepCandidateStateFixture(true);
    const unitRow=JSON.parse(String(fixtureGet(state.current,["rows","document_generation_inventory",0,"canonicalPayload"]))) as AuditFixtureObject;
    const nativeEnvelope=JSON.parse(String(unitRow.retained_native_payload)) as AuditFixtureObject;
    const nativeRow=JSON.parse(String(nativeEnvelope.canonicalPayload)) as AuditFixtureObject;
    if(fault==="foreign typed")nativeRow.index_generation_id=auditFixtureUuid(811);
    if(fault==="null typed")nativeRow.index_generation_id=null;
    if(fault==="missing typed")delete nativeRow.index_generation_id;
    if(fault==="foreign metadata")fixtureSet(nativeRow,["metadata","index_generation_id"],auditFixtureUuid(811));
    if(fault==="null metadata")fixtureSet(nativeRow,["metadata","index_generation_id"],null);
    if(fault==="missing metadata")delete (nativeRow.metadata as AuditFixtureObject).index_generation_id;
    rebindStateRow(state,"document_generation_inventory",0,row=>{row.retained_native_payload=JSON.stringify(fixtureEnvelope(nativeRow));});
    rebindStateRow(state,"document_index_generations",0,row=>{
      const families=fixtureGet(row,["inventory_manifest","families"]) as AuditFixtureObject[];
      const declaration=fixtureGet(families.find(family=>family.family==="sections")!,["groups",0,"declaration"]) as AuditFixtureObject;
      const planned=JSON.parse(String(fixtureGet(declaration,["outputManifestEnvelope","canonicalPayload"]))) as AuditFixtureObject;
      fixtureSet(planned,["units",0,"output"],nativeRow);
      const envelope=fixtureEnvelope(planned);declaration.outputManifestEnvelope=envelope;
      fixtureSet(declaration,["producer","outputManifestDigest"],envelope.digest);
      fixtureSet(declaration,["population","basis",0,"ref","envelopeDigest"],envelope.digest);
      fixtureSet(declaration,["population","basis",0,"ref","byteLength"],Buffer.byteLength(envelope.canonicalPayload,"utf8"));
    });
    expect(compareShadowStateV1(state.input,state.fixture.admission,state.bindings)).toMatchObject({ok:false,reason:"invalid_input",fieldPaths:["state"]});
  });
});

// Complete prepared wave images. These supplied after-images test the actual
// consumers; they are not a JavaScript scheduler or a claim of executed SQL.
function restartSortRows(rows: Record<string, ReturnType<typeof fixtureEnvelope>[]>) {
  const composite: Record<string, string[]> = { document_index_quality: ["document_id"], document_title_words: ["word", "document_id"],
    public_source_serving_authority: ["singleton"], shadow_reindex_waves: ["candidate_generation_id"],
    document_index_generations: ["document_id", "index_generation_id"], document_generation_projections: ["document_id", "index_generation_id"],
    document_generation_inventory: ["document_id", "index_generation_id", "family", "unit_key"], document_generation_baselines: ["document_id", "candidate_generation_id"] };
  for (const [table, values] of Object.entries(rows)) values.sort((a, b) => {
    const left = JSON.parse(a.canonicalPayload) as AuditFixtureObject, right = JSON.parse(b.canonicalPayload) as AuditFixtureObject;
    for (const key of composite[table] ?? ["id"]) { const l = String(left[key]), r = String(right[key]); if (l !== r) return l < r ? -1 : 1; }
    return 0;
  });
}
function restartPersistenceProof(f: ReturnType<typeof persistenceFixture>) {
  const prepared = prepareShadowPersistenceV1(f.parameters, f.admission, f.now);
  return { prepared, bundle: fixtureEnvelope(prepared.bundlePayload, "baseline", "pg-jsonb-text-v1") };
}
function restartPreparedState(f: ReturnType<typeof persistenceFixture>, phase: "before_claim" | "building", jobBase: number,
  proof = restartPersistenceProof(f)) {
  const { prepared, bundle } = proof;
  const candidate = f.planPayload.plan.candidateGenerationId;
  const time = f.now.slice(0, 19);
  const captured = `${time}.000030Z`;
  const rows = structuredClone(f.fixture.rows);
  const members = f.fixture.memberPayloads.map((payload, index) => ({ documentId: String(payload.source.documentId), ownerId: String(payload.source.ownerId),
    baselineGenerationId: payload.source.baselineGenerationId as string | null, jobId: auditFixtureUuid(jobBase + index), planDigest: f.parameters.p_plan.digest,
    firstLeaseToken: phase === "building" ? auditFixtureUuid(jobBase + 10 + index) : null, authorityDigest: String(payload.source.authorityDigest) }));
  const bindings: { table: string; rowDigest: string }[] = [];
  const put = (table: string, row: AuditFixtureObject) => {
    const envelope = fixtureEnvelope(row, "baseline", "pg-jsonb-text-v1"); rows[table]!.push(envelope); bindings.push({ table, rowDigest: envelope.digest });
  };
  for (const [index, member] of members.entries()) {
    const job: AuditFixtureObject = { ...controlFixture("enqueue", member.baselineGenerationId).after.ownNodeJobs[0]!,
      id: member.jobId, document_id: member.documentId, requested_generation_id: candidate, shadow_plan_digest: f.parameters.p_plan.digest,
      created_at: `${time}.000010Z`, updated_at: `${time}.000010Z`, next_run_at: `${time}.000010Z` };
    if (phase === "building") Object.assign(job, { status: "processing", attempt_count: 1, next_run_at: null,
      locked_by: "synthetic-restart-worker", locked_at: `${time}.000020Z`, lease_token: member.firstLeaseToken,
      lease_expected_generation_id: member.baselineGenerationId, lease_write_generation_id: candidate, lease_authority_digest: member.authorityDigest,
      lease_duration_seconds: 60, lease_expires_at: new Date(new Date(`${time}.000Z`).getTime() + 60000).toISOString().replace(".000Z", ".000020Z") });
    const manifest = pendingInventoryFixture(); manifest.documentId = member.documentId; manifest.candidateGenerationId = candidate; manifest.jobId = member.jobId;
    const ledger: AuditFixtureObject = { document_id: member.documentId, index_generation_id: candidate, owner_id: member.ownerId,
      baseline_generation_id: member.baselineGenerationId, expected_state_digest: f.fixture.input.originEnvelope.digest.slice(7), authority_digest: member.authorityDigest,
      source_binding: f.fixture.memberPayloads[index]!.source, job_id: member.jobId, first_lease_token: member.firstLeaseToken,
      claimed_at: phase === "building" ? job.locked_at! : null, state: phase === "building" ? "building" : "reserved",
      expected_inventory_digest: null, inventory_digest: null, candidate_projection_digest: null, baseline_bundle_digest: bundle.digest,
      stage_receipt: null, stage_receipt_digest: null, staged_at: null, control_revision: phase === "building" ? 1 : 0,
      control_snapshot: { controlRevision: phase === "building" ? 1 : 0, ownNodeJobs: [job], ownStages: [] },
      original_origin_envelope: f.fixture.input.originEnvelope, inventory_manifest: JSON.parse(JSON.stringify(manifest)) as AuditFixtureJson };
    put("ingestion_jobs", job); put("document_index_generations", ledger);
    put("document_generation_baselines", { document_id: member.documentId, candidate_generation_id: candidate, baseline_generation_id: member.baselineGenerationId,
      expected_state_digest: ledger.expected_state_digest!, bundle_version: 1, bundle_payload: bundle, bundle_digest: bundle.digest, captured_at: `${time}.000010Z` });
  }
  put("shadow_reindex_waves", { candidate_generation_id: candidate, plan_digest: f.parameters.p_plan.digest, plan_version: 1,
    project_ref: f.fixture.profile.target.projectRef, source_policy_version: f.fixture.profile.sourcePolicyVersion, audit_digest: f.planPayload.plan.auditDigest,
    population_fingerprint: prepared.report.populationFingerprint, recovery_evidence_digest: prepared.recoveryEvidenceDigest,
    baseline_evaluation_digest: f.parameters.p_baseline_evaluation.digest, operation_manifest_digest: f.parameters.p_operation_manifest.digest,
    plan_payload: f.parameters.p_plan, created_at: `${time}.000010Z`, prepared_origin_digest: f.fixture.input.originEnvelope.digest,
    execution_profile_digest: f.fixture.admission.executionProfileDigest, case_set_digest: f.fixture.profile.cases.digest,
    baseline_report: f.parameters.p_baseline_evaluation, baseline_report_digest: f.parameters.p_baseline_evaluation.digest });
  restartSortRows(rows);
  const current: AuditFixtureObject = { ...JSON.parse(f.fixture.input.originEnvelope.canonicalPayload) as AuditFixtureObject, capturedAt: captured, rows };
  const input = { version: 1, phase, binding: { projectRef: f.fixture.profile.target.projectRef, planDigest: f.parameters.p_plan.digest,
    candidateGenerationId: candidate, members }, auditInput: f.fixture.input, currentOriginEnvelope: fixtureEnvelope(current, "baseline", "pg-jsonb-text-v1"),
    clock: { transactionStartedAt: `${time}.000010Z`, observedAt: captured } };
  // Preserve the admitted cap: a complete chain that exceeds it is a blocker.
  for (const envelope of [f.fixture.input.originEnvelope, bundle, input.currentOriginEnvelope])
    expect(Buffer.byteLength(envelope.canonicalPayload, "utf8")).toBeLessThanOrEqual(f.fixture.profile.limits.maxOriginBundleBytes);
  bindings.sort((a, b) => a.table < b.table ? -1 : a.table > b.table ? 1 : a.rowDigest < b.rowDigest ? -1 : 1);
  return { prepared, bundle, rows, current, input, bindings };
}

function restartHistoryFixture(baselineNull = false) {
  // Choose the supported byte encoding before C1 exists; retain every original
  // native byte without repeatedly JSON-escaping its contents through history.
  const c1 = persistenceFixture({ baselineNull, nativeCaptureEncoding: "base64" });
  const state1 = restartPreparedState(c1, "building", 700);
  // Add truthful already-produced C1 pages/chunks and complete stage evidence.
  for (const [index, member] of state1.input.binding.members.entries()) {
    const stage: AuditFixtureObject = { ...controlFixture("start_stage", member.baselineGenerationId).after.ownStages[0]!,
      id: auditFixtureUuid(740 + index), job_id: member.jobId, document_id: member.documentId, lease_token: member.firstLeaseToken,
      stage_name: "extract", started_at: "2024-03-01T00:00:00.000025Z", created_at: "2024-03-01T00:00:00.000025Z" };
    state1.rows.ingestion_job_stages!.push(fixtureEnvelope(stage, "baseline", "pg-jsonb-text-v1"));
    const g = JSON.parse(state1.rows.document_index_generations![index]!.canonicalPayload) as AuditFixtureObject;
    g.control_revision = 2; fixtureSet(g, ["control_snapshot", "controlRevision"], 2); fixtureSet(g, ["control_snapshot", "ownStages"], [stage]);
    state1.rows.document_index_generations![index] = fixtureEnvelope(g, "baseline", "pg-jsonb-text-v1");
    const chunk = { ...c1.fixture.data[index]!.chunk, id: auditFixtureUuid(760 + index), index_generation_id: auditFixtureUuid(800),
      metadata: { index_generation_id: auditFixtureUuid(800), generated_by: "local-worker", ingestion_job_id: member.jobId, ingestion_lease_token: member.firstLeaseToken },
      created_at: "2024-03-01T00:00:00.000026Z" };
    const page = { ...c1.fixture.data[index]!.page, id: auditFixtureUuid(770 + index), index_generation_id: auditFixtureUuid(800),
      metadata: { index_generation_id: auditFixtureUuid(800), generated_by: "local-worker", ingestion_job_id: member.jobId, ingestion_lease_token: member.firstLeaseToken },
      created_at: "2024-03-01T00:00:00.000026Z" };
    state1.rows.document_chunks!.push(fixtureEnvelope(chunk, "baseline", "pg-jsonb-text-v1"));
    state1.rows.document_pages!.push(fixtureEnvelope(page, "baseline", "pg-jsonb-text-v1"));
  }
  const imageBytes = Buffer.from("Complete captured original C1 image bytes, including partial producer output.\n");
  const hash = fixtureSha(imageBytes).slice(7);
  const imageDonor = auditConsumerFixture({ historicalImage: { bytes: imageBytes, hash, metadataHash: hash, extractor: "local-worker" } });
  const image = JSON.parse(imageDonor.rows.document_images![0]!.canonicalPayload) as AuditFixtureObject;
  image.id = auditFixtureUuid(780); image.index_generation_id = auditFixtureUuid(800); image.created_at = "2024-03-01T00:00:00.000026Z";
  fixtureSet(image, ["metadata", "index_generation_id"], auditFixtureUuid(800));
  state1.rows.document_images!.push(fixtureEnvelope(image, "baseline", "pg-jsonb-text-v1"));
  const retained = [...c1.fixture.input.retainedEvidence, ...imageDonor.input.retainedEvidence.filter(entry => entry.tag === "private_object" &&
    fixtureGet(entry as AuditFixtureObject, ["ref", "objectPath"]) === image.storage_path)];
  restartSortRows(state1.rows);
  const immutableC1 = JSON.stringify({ rows: state1.rows, retained });
  return { c1, state1, retained, imageBytes, image, immutableC1 };
}
function restartChainFixture(baselineNull = false, history = restartHistoryFixture(baselineNull)) {
  const { state1, retained } = history;
  const c2 = persistenceFixture({ baselineNull, nativeCaptureEncoding: "base64", captureTime: "2024-03-01T00:02:00.000000Z", capturedHistory: { rows: state1.rows, retainedEvidence: retained } });
  c2.planPayload.plan.candidateGenerationId = auditFixtureUuid(801); c2.rebind();
  return { ...history, c2 };
}

function restartMutateCurrent(state: ReturnType<typeof restartPreparedState>, table: string, index: number, mutate: (row: AuditFixtureObject) => void) {
  const prior = state.rows[table]![index]!;
  const row = JSON.parse(prior.canonicalPayload) as AuditFixtureObject; mutate(row);
  const next = fixtureEnvelope(row, "baseline", "pg-jsonb-text-v1"); state.rows[table]![index] = next;
  const binding = state.bindings.find(entry => entry.table === table && entry.rowDigest === prior.digest);
  if (binding) binding.rowDigest = next.digest;
  state.bindings.sort((a, b) => a.table < b.table ? -1 : a.table > b.table ? 1 : a.rowDigest < b.rowDigest ? -1 : 1);
}

function freezeRestartData<T>(value: T): T {
  const seen = new WeakSet<object>();
  const freeze = (entry: unknown): void => {
    if (entry === null || typeof entry !== "object" || seen.has(entry)) return;
    seen.add(entry);
    for (const child of Object.values(entry)) freeze(child);
    Object.freeze(entry);
  };
  freeze(value); return value;
}
type RestartC2Proof = ReturnType<typeof restartPersistenceProof> & { immutableInput: string };
function restartSeed(chain: ReturnType<typeof restartChainFixture>, proof: RestartC2Proof,
  reserved: ReturnType<typeof restartPreparedState>, building: ReturnType<typeof restartPreparedState>) {
  // Data only: no mutable fixture callbacks or Buffer instances enter the seed.
  return freezeRestartData({
    c1: { parameters: chain.c1.parameters, admission: chain.c1.admission, profile: chain.c1.fixture.profile,
      rows: chain.state1.rows, retained: chain.retained, bundle: chain.state1.bundle, immutableHistory: chain.immutableC1 },
    c2: { parameters: chain.c2.parameters, admission: chain.c2.admission, input: chain.c2.fixture.input,
      auditAdmission: chain.c2.fixture.admission, profile: chain.c2.fixture.profile, audit: chain.c2.prepared,
      report: chain.c2.report, plan: chain.c2.planPayload.plan, prepared: proof.prepared,
      immutableInput: proof.immutableInput },
    reserved, building, imagePath: chain.image.storage_path, imageBytes: chain.imageBytes.toString("base64"),
  });
}
function restartSetupValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Restart fixture setup incomplete.");
  return value;
}

describe("U04 full retained C1 to fresh C2 pure preparation continuity", () => {
  for (const baselineNull of [false, true]) describe(`shared complete wave with null G0=${baselineNull}`, () => {
    let setup: { history?: ReturnType<typeof restartHistoryFixture>; chain?: ReturnType<typeof restartChainFixture>;
      proof?: RestartC2Proof; reserved?: ReturnType<typeof restartPreparedState> } = {};
    let seed: ReturnType<typeof restartSeed> | undefined;
    // Each shared stage retains the unchanged hook timeout. Comparisons remain
    // in timed tests; these hooks construct their common full evidence once.
    beforeAll(() => { setup.history = restartHistoryFixture(baselineNull); });
    beforeAll(() => { setup.chain = restartChainFixture(baselineNull, restartSetupValue(setup.history)); });
    beforeAll(() => {
      const f = restartSetupValue(setup.chain).c2;
      const immutableInput = JSON.stringify({ parameters: f.parameters, admission: f.admission });
      setup.proof = { ...restartPersistenceProof(f), immutableInput };
    });
    beforeAll(() => { setup.reserved = restartPreparedState(restartSetupValue(setup.chain).c2, "before_claim", 900, restartSetupValue(setup.proof)); });
    beforeAll(() => {
      const chain = restartSetupValue(setup.chain), proof = restartSetupValue(setup.proof);
      const building = restartPreparedState(chain.c2, "building", 900, proof);
      seed = restartSeed(chain, proof, restartSetupValue(setup.reserved), building);
      setup = {};
    });
    afterAll(() => { seed = undefined; setup = {}; });

  it(`prepares the complete two-document wave with retained expired C1 and null G0=${baselineNull}`, () => {
    const { c1, c2, reserved, building, imagePath, imageBytes } = structuredClone(restartSetupValue(seed));
    const originalNative = conformingProfileCapture().nativeCapture;
    for (const wave of [c1, c2]) {
      const capture = parsedProfile(wave.profile).sql.capture.payload;
      expect(capture.operations).toHaveLength(26);
      expect(capture.nativeCapture).toMatchObject({ encoding: "base64", digest: originalNative.digest, byteLength: originalNative.byteLength });
      expect(Buffer.from(capture.nativeCapture.content, "base64")).toEqual(Buffer.from(originalNative.content, "utf8"));
    }
    const { audit, prepared } = c2;
    expect(audit.kind).toBe("shadow-audit-prepared"); expect(audit.inventory!.documents).toHaveLength(2);
    expect(prepared.report).toEqual(c2.report); expect(prepared.report.populationFingerprint).toBe(c2.plan.populationFingerprint);
    expect(prepared.parameters.p_plan).toEqual(c2.parameters.p_plan); expect(prepared.parameters.p_baseline_evaluation).toEqual(c2.input.caseResultsEnvelope);
    expect(prepared.parameters.p_recovery_evidence).toEqual(c2.parameters.p_recovery_evidence);
    if (baselineNull) expect(prepared.report.documents.every(row => row.reasons.includes("generation_incomplete"))).toBe(true);
    for (const state of [reserved, building]) for (const [table, envelopes] of Object.entries(c1.rows))
      for (const envelope of envelopes) expect(state.rows[table]).toContainEqual(envelope);
    expect(building.input.binding.members.every(member => member.baselineGenerationId === (baselineNull ? null : auditFixtureUuid(50)))).toBe(true);
    expect(building.input.binding.members.map(member => member.firstLeaseToken)).toEqual([auditFixtureUuid(910), auditFixtureUuid(911)]);
    expect(JSON.stringify({ rows: c1.rows, retained: c1.retained })).toBe(c1.immutableHistory);
    expect(JSON.stringify({ parameters: c2.parameters, admission: c2.admission })).toBe(c2.immutableInput);
    const object = c2.input.retainedEvidence.find(entry => entry.tag === "private_object" && fixtureGet(entry as AuditFixtureObject, ["ref", "objectPath"]) === imagePath)!;
    expect(Buffer.from(String(fixtureGet(object as AuditFixtureObject, ["bytes", "content"])), "base64")).toEqual(Buffer.from(imageBytes, "base64"));
    const oldRead = readShadowPersistenceBundleV1(c1.bundle, c1.admission, "2025-03-01T00:00:00.000000Z");
    expect(oldRead).toMatchObject({ kind: "shadow-persistence-integrity-only", stageReadiness: "not-assessed", terminalAcceptance: "unavailable" });
    expect(oldRead.bundle).toEqual(c1.bundle); expect(oldRead.parameters).toEqual(c1.parameters);
  });

  // Finite functional large-history budget for the 41–50s observed comparisons;
  // this is not operational latency acceptance. Pre-enqueue keeps the default.
  for (const phase of ["pre_enqueue", "reserved", "building"] as const) it(`compares actual ${phase} state with null G0=${baselineNull}`, () => {
    const original = restartSetupValue(seed);
    const state = phase === "building" ? original.building : original.reserved;
    const input = phase === "pre_enqueue" ? { ...state.input, phase, currentOriginEnvelope: state.input.auditInput.originEnvelope } : state.input;
    const isolated = structuredClone({ input, admission: original.c2.auditAdmission, bindings: phase === "pre_enqueue" ? [] : state.bindings });
    expect(isolated.input).not.toBe(state.input); expect(isolated.admission).not.toBe(original.c2.auditAdmission);
    expect(compareShadowStateV1(isolated.input, isolated.admission, isolated.bindings))
      .toMatchObject({ ok: true, kind: phase === "pre_enqueue" ? "origin_equal" : "sanctioned_u04_state" });
  }, phase === "pre_enqueue" ? undefined : 90_000);

  if (!baselineNull) {
  // The same finite large-history integration budget applies to these eight cases.
  it.each(["changed C1 job", "missing C1 stage", "changed C1 checkpoint", "missing C1 chunk", "wrong C2 token", "missing C2 checkpoint", "C2 attempt2", "expired C2"] as const)("refuses actual comparison drift: %s", fault => {
    const original = restartSetupValue(seed);
    const { state, admission } = structuredClone({ state: original.building, admission: original.c2.auditAdmission });
    expect(Object.isFrozen(original.building.rows)).toBe(true);
    expect(state.rows).not.toBe(original.building.rows); expect(state.current.rows).toBe(state.rows);
    expect(admission).not.toBe(original.c2.auditAdmission);
    if (fault === "changed C1 job") restartMutateCurrent(state, "ingestion_jobs", 0, row => { row.progress = 7; });
    if (fault === "missing C1 stage") state.rows.ingestion_job_stages!.splice(0, 1);
    if (fault === "changed C1 checkpoint") restartMutateCurrent(state, "document_index_generations", 0, row => { row.control_revision = 99; });
    if (fault === "missing C1 chunk") state.rows.document_chunks!.splice(2, 1);
    if (fault === "wrong C2 token") restartMutateCurrent(state, "ingestion_jobs", 2, row => { row.lease_token = auditFixtureUuid(999); });
    if (fault === "missing C2 checkpoint") restartMutateCurrent(state, "document_index_generations", 1, row => { row.control_snapshot = {}; });
    if (fault === "C2 attempt2") restartMutateCurrent(state, "ingestion_jobs", 2, row => { row.attempt_count = 2; });
    if (fault === "expired C2") state.input.clock.observedAt = "2024-03-01T00:04:00.000000Z";
    if (fault !== "expired C2") state.input.currentOriginEnvelope = fixtureEnvelope(state.current, "baseline", "pg-jsonb-text-v1");
    expect(Buffer.byteLength(state.input.currentOriginEnvelope.canonicalPayload, "utf8")).toBeLessThanOrEqual(original.c2.profile.limits.maxOriginBundleBytes);
    const result = compareShadowStateV1(state.input, admission, state.bindings);
    expect(result.ok).toBe(false);
    if (fault === "changed C1 job" || fault === "missing C1 stage") expect(result).toMatchObject({ reason: "foreign_queue_changed" });
    if (fault === "changed C1 checkpoint" || fault === "missing C1 chunk") expect(result).toMatchObject({ reason: "baseline_evidence_changed" });
    if (fault === "expired C2") expect(result).toMatchObject({ reason: "lease_lost" });
  }, 90_000);
  }
  });

  it.each(["missing image bytes", "substituted image bytes", "reused C1", "wrong source admission"] as const)("refuses rebound C2 preparation input: %s", fault => {
    const chain = restartChainFixture(); const f = chain.c2;
    if (fault === "reused C1") f.planPayload.plan.candidateGenerationId = auditFixtureUuid(800);
    if (fault === "wrong source admission") f.fixture.admission.originDigest = chain.c1.fixture.input.originEnvelope.digest;
    if (fault === "missing image bytes" || fault === "substituted image bytes") {
      const index = f.fixture.input.retainedEvidence.findIndex(entry => entry.tag === "private_object" && fixtureGet(entry as AuditFixtureObject, ["ref", "objectPath"]) === chain.image.storage_path);
      if (fault === "missing image bytes") f.fixture.input.retainedEvidence.splice(index, 1);
      else fixtureSet(f.fixture.input.retainedEvidence[index] as AuditFixtureObject, ["bytes", "content"], Buffer.from("Substituted C1 bytes").toString("base64"));
    }
    f.rebind();
    expect(() => prepareShadowPersistenceV1(f.parameters, f.admission, f.now)).toThrow("Invalid shadow comparison record.");
  });
});


function terminalStateFixture(phase: "before_seal" | "after_seal" | "evaluate" = "evaluate", quality = false) {
  const f=finalReceiptFixture(false,true,true,true,true,false,false,quality);
  const origin=JSON.parse(f.persistence.fixture.input.originEnvelope.canonicalPayload) as AuditFixtureObject;
  const observed=structuredClone(f.observed);
  const beforeMembers=f.members.map(member=>{
    const row={...member.memberRow,state:"building",inventory_digest:null,candidate_projection_digest:null,
      stage_receipt:null,stage_receipt_digest:null,staged_at:null,
      control_revision:member.control.before!.controlRevision,control_snapshot:member.control.before};
    const projection={...member.projectionRow,sealed_at:null};
    const memberRowEnvelope=f.pgEnvelope(row,"baseline");
    const final={...member.finalInventoryPayload,projectionEnvelope:f.pgEnvelope(projection,"projection")};
    return {documentId:member.documentId,inventoryEnvelope:f.pgEnvelope(final,"inventory"),
      context:{memberRowEnvelope,profileEnvelope:f.profileEnvelope,
        inventoryRowEnvelopes:member.inventoryRowEnvelopes,originalOriginEnvelope:f.persistence.fixture.input.originEnvelope},
      row,projection};
  });
  if(phase==="before_seal") {
    for(const table of ["document_index_generations","document_generation_projections","ingestion_jobs","ingestion_job_stages"]) {
      const originals=fixtureGet(origin,["rows",table]) as AuditFixtureJson[];
      const additional=table==="document_index_generations"?beforeMembers.map(value=>value.context.memberRowEnvelope):
        table==="document_generation_projections"?beforeMembers.map(value=>f.pgEnvelope(value.projection,"baseline")):
        table==="ingestion_jobs"?f.members.map(value=>f.pgEnvelope(value.control.before!.ownNodeJobs[0] as AuditFixtureJson,"baseline")):
        f.members.flatMap(value=>value.control.before!.ownStages.map(row=>f.pgEnvelope(row as AuditFixtureJson,"baseline")));
      fixtureSet(observed,["rows",table],[...originals,...additional]);
    }
  }
  const currentOriginEnvelope=f.pgEnvelope(observed,"baseline");
  const rows=fixtureGet(observed,["rows"]) as Record<string,AuditFixtureObject[]>;
  const bindings=Object.entries(rows).flatMap(([table,values])=>{
    const originalDigests=new Set((fixtureGet(origin,["rows",table]) as AuditFixtureObject[]).map(value=>value.digest));
    return values.filter(value=>!originalDigests.has(value.digest)).map(value=>({table,rowDigest:value.digest as string}));
  }).sort((a,b)=>a.table<b.table?-1:a.table>b.table?1:a.rowDigest<b.rowDigest?-1:a.rowDigest>b.rowDigest?1:0);
  const input={version:1,phase,binding:{projectRef:f.persistence.fixture.profile.target.projectRef,
    planDigest:f.persistence.parameters.p_plan.digest,candidateGenerationId:f.candidateGenerationId,
    members:f.members.map(value=>({documentId:value.documentId,ownerId:value.binding.source.ownerId,
      baselineGenerationId:value.binding.source.baselineGenerationId,jobId:value.binding.jobId,
      planDigest:f.persistence.parameters.p_plan.digest,firstLeaseToken:value.binding.firstLeaseToken,
      authorityDigest:value.binding.source.authorityDigest}))},auditInput:f.persistence.fixture.input,currentOriginEnvelope,
    clock:phase==="before_seal"?{transactionStartedAt:"2024-02-29T23:59:50.123000Z",observedAt:"2024-02-29T23:59:50.123456Z"}:
      {transactionStartedAt:"2024-03-01T00:01:00.000000Z",observedAt:"2024-03-01T00:01:00.000000Z"}};
  const evidence=phase==="before_seal"?{kind:"before_seal",members:beforeMembers.map(({documentId,inventoryEnvelope,context})=>
    ({documentId,inventoryEnvelope,context}))}:{kind:"sealed",readback:{...f.readback,observedOriginEnvelope:currentOriginEnvelope},
      context:{...f.context,currentOriginEnvelope}};
  return {f,input,bindings,evidence,beforeMembers};
}

describe("U04 complete terminal state guards",()=>{
  it("composes the worker seal helper with complete real member receipt validation",async()=>{
    const f=finalReceiptFixture(false,true,true,true,true,true), member=f.members[0]!;
    const prior=member.control.before!.ownNodeJobs[0]!;
    const fence={job_kind:"node" as const,job_id:String(member.binding.jobId),document_id:member.documentId,
      worker_id:String(prior.locked_by),lease_token:String(member.binding.firstLeaseToken),
      expected_generation_id:member.binding.source.baselineGenerationId as string|null,
      authority_digest:String(member.binding.source.authorityDigest)};
    const shadow={binding:member.binding,planEnvelope:f.persistence.parameters.p_plan,
      executionProfileEnvelope:f.profileEnvelope,originalOriginEnvelope:f.persistence.fixture.input.originEnvelope,
      controlSnapshot:member.initialControl} as unknown as ShadowWorkerContextV1;
    const attempt=new IngestionAttempt(fence);
    const rpc=vi.fn(async(name:string,args:Record<string,unknown>)=>{
      expect(name).toBe("stage_document_index_generation");
      expect(args).toEqual({p_fence:fence,p_generation:f.candidateGenerationId});
      return {data:{ok:true,kind:"shadow_staged",memberReceiptEnvelope:member.memberReceiptEnvelope,
        memberContext:member.memberContext},error:null};
    });
    const result=await stageIngestionShadowGeneration({attempt,shadow,rpc});
    expect(result.memberReceiptEnvelope).toEqual(member.memberReceiptEnvelope);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(attempt.signal.aborted).toBe(false);
  });

  it.each(["before_seal","after_seal","evaluate"] as const)("validates complete two-member %s evidence while retaining G0",phase=>{
    const fixture=terminalStateFixture(phase), before=JSON.stringify(fixture);
    if(phase === "before_seal") for(const member of fixture.beforeMembers)
      readShadowPreSealInventoryV1(member.inventoryEnvelope,member.context);
    else readShadowWaveReadbackV1(fixture.f.readback,fixture.f.context);
    const result=compareShadowStateV1(fixture.input,fixture.f.persistence.fixture.admission,fixture.bindings,fixture.evidence);
    expect(result,JSON.stringify(result)).toMatchObject({ok:true,kind:"sanctioned_u04_state",phase});
    expect(JSON.stringify(fixture)).toBe(before);
    if(phase==="before_seal")for(const member of fixture.beforeMembers)
      expect(readShadowPreSealInventoryV1(member.inventoryEnvelope,member.context).member.row.state).toBe("building");
  });
  it("refuses an all-final inventory when the current job has failed",()=>{
    const v=terminalStateFixture("before_seal"), member=v.beforeMembers[0]!;
    const checkpoint=structuredClone(v.f.members[0]!.control.before!);
    Object.assign(checkpoint.ownNodeJobs[0]!,{status:"failed",stage:"shadow_failed",locked_at:null,locked_by:null});
    member.row.control_snapshot=checkpoint;
    member.context.memberRowEnvelope=v.f.pgEnvelope(member.row,"baseline");
    const payload=JSON.parse(member.inventoryEnvelope.canonicalPayload) as AuditFixtureObject;
    payload.preSealControlEnvelope=v.f.pgEnvelope(checkpoint as AuditFixtureJson,"control");
    member.inventoryEnvelope=v.f.pgEnvelope(payload,"inventory");
    expect(()=>readShadowPreSealInventoryV1(member.inventoryEnvelope,member.context)).toThrow();
  });

  it.each(["missing second member","swapped observation","live baseline drift","missing independent row admission"] as const)("refuses %s despite valid receipt bytes",fault=>{
    const v=terminalStateFixture();
    if(fault==="missing second member") (v.evidence as {context:typeof v.f.context}).context.members.pop();
    if(fault==="swapped observation") v.input.currentOriginEnvelope=v.f.persistence.fixture.input.originEnvelope;
    if(fault==="live baseline drift") {
      const current=JSON.parse(v.input.currentOriginEnvelope.canonicalPayload) as AuditFixtureObject;
      const documentEnvelopes=fixtureGet(current,["rows","documents"]) as AuditFixtureObject[];
      const document=JSON.parse(documentEnvelopes[0]!.canonicalPayload as string) as AuditFixtureObject;
      document.file_name="changed since origin";
      documentEnvelopes[0]=v.f.pgEnvelope(document,"baseline");
      v.input.currentOriginEnvelope=v.f.pgEnvelope(current,"baseline");
      const proof=v.evidence as {readback:typeof v.f.readback;context:typeof v.f.context};
      proof.readback.observedOriginEnvelope=v.input.currentOriginEnvelope;
      proof.context.currentOriginEnvelope=v.input.currentOriginEnvelope;
    }
    if(fault==="missing independent row admission")v.bindings.pop();
    expect(compareShadowStateV1(v.input,v.f.persistence.fixture.admission,v.bindings,v.evidence).ok).toBe(false);
  });
  it("requires exact complete receipt evidence for the public seal transition",()=>{
    const f=finalReceiptFixture(false,true,true,true,true), member=f.members[0]!, prior=member.control.before!.ownNodeJobs[0]!;
    const intent={kind:"seal",binding:{documentId:member.documentId,jobId:member.binding.jobId,
      candidateGenerationId:f.candidateGenerationId,planDigest:f.persistence.parameters.p_plan.digest,
      baselineGenerationId:member.binding.source.baselineGenerationId,authorityDigest:member.binding.source.authorityDigest,
      workerId:prior.locked_by,firstLeaseToken:member.binding.firstLeaseToken,leaseDurationSeconds:prior.lease_duration_seconds}};
    const clock={transactionStartedAt:member.control.after.ownNodeJobs[0]!.updated_at,observedAt:member.sealedAt};
    const proof={memberReceiptEnvelope:member.memberReceiptEnvelope,memberContext:member.memberContext};
    expect(readShadowMemberSealReceiptV1(member.memberReceiptEnvelope,member.memberContext).kind).toBe("shadow-member-seal-receipt-validated");
    const result=validateShadowControlTransitionV1(member.control.before,intent,member.control.after,clock,proof);
    expect(result,JSON.stringify(result)).toMatchObject({ok:true});
    expect(validateShadowControlTransitionV1(member.control.before,intent,member.control.after,clock)).toMatchObject({ok:false,reason:"unsealed_wave"});
    expect(validateShadowControlTransitionV1(member.control.before,intent,member.control.after,clock,
      {memberReceiptEnvelope:f.members[1]!.memberReceiptEnvelope,memberContext:f.members[1]!.memberContext}).ok).toBe(false);
  });
});

const u04EvaluationAuthoritySqlOperationsFixture = [
  "adjacent_chunks", "aliases", "chunks_by_ids", "chunks_by_indexes", "corpus_terms", "correct_terms", "documents",
  "embedding_fields", "hybrid_chunks", "images_by_ids", "images_by_pages", "index_units", "lookup_chunk_prefix",
  "lookup_chunk_terms", "lookup_chunks", "lookup_document_terms", "lookup_documents", "memory_cards_hybrid",
  "memory_cards_lexical", "quality", "ranking_metadata", "related_documents", "table_facts", "text_chunks",
  "vector_chunks", "visual_rows",
] as const;

function u04EvaluationAuthorityConfirmationFixture(authority: AuditFixtureObject) {
  const manifest = structuredClone(authority.manifest as AuditFixtureObject);
  delete manifest.confirmationSha256;
  return fixtureSha(encodeShadowNodeJsonCanonicalPayload({ ...authority, manifest }));
}

function u04EvaluationAuthorityFixture(side: "baseline" | "candidate", terminalValue?: ReturnType<typeof finalReceiptFixture>) {
  const terminal = side === "candidate" ? terminalValue ?? finalReceiptFixture(false, true) : null;
  const persistence = terminal?.persistence ?? persistenceFixture();
  const profileEnvelope = fixtureEnvelope(persistence.fixture.profile, "u04-execution-profile-v1");
  const originEnvelope = persistence.fixture.input.originEnvelope;
  const recoveryEnvelope = persistence.parameters.p_recovery_evidence;
  const sourceBindings = persistence.fixture.memberPayloads.map((member) => structuredClone(member.source));
  const cases = JSON.parse(persistence.fixture.profile.cases.canonicalPayload) as AuditFixtureObject;
  const documentIds = [...persistence.fixture.profile.documentIds];
  const scopes = [
    ...((cases.retrieval as AuditFixtureObject[]).map((entry, index) => ({ case: { kind: "retrieval", index,
      caseId: String((entry.testCase as AuditFixtureObject).id) }, documentIds: [...documentIds] }))),
    ...((cases.quality as AuditFixtureObject[]).map((entry, index) => ({ case: { kind: "quality", index,
      caseId: String(entry.id) }, documentIds: [...documentIds] }))),
  ];
  const caseScopes = { caseSetDigest: persistence.fixture.profile.cases.digest, scopes };
  const runnerPolicy = { kind: "u04-evaluation-runner-policy-v1", version: 1,
    workload: "eval-quality-retrieval-and-rag-v1", retrievalConcurrency: 1, qualityConcurrency: 1,
    evaluatorRetry: { maxAttempts: 4, initialDelayMs: 5000, maxDelayMs: 45000 },
    costRates: { input: 0.000001, cachedInput: 0.0000005, output: 0.000002 },
    runContext: { git_sha: null, github_run_id: null, github_run_attempt: null, latency_context: "near-region-runner" },
    crossRegionRunner: false };
  const phase = side === "baseline"
    ? { side, planDigest: null, candidateGenerationId: null, waveReceiptDigest: null }
    : { side, planDigest: persistence.parameters.p_plan.digest,
      candidateGenerationId: terminal!.candidateGenerationId, waveReceiptDigest: terminal!.waveReceiptEnvelope.digest };
  const manifest = { version: 1, operation: "evaluate", targetProjectRef: persistence.fixture.profile.target.projectRef,
    planPath: side === "baseline" ? null : "synthetic-plan.json", reportOrReceiptPath: null,
    recoveryEvidencePath: "synthetic-recovery.json",
    recoveryEvidenceSha256: persistence.operation.manifest.recoveryEvidenceSha256,
    expectedDocumentIds: [...documentIds], expectedDocumentCount: documentIds.length,
    confirmationSha256: fixtureSha("placeholder evaluation confirmation"),
    authorizedAt: "2024-03-01T00:00:00.000006Z", expiresAt: "2024-03-01T01:00:00.000000Z" };
  const authority: AuditFixtureObject = { kind: "u04-evaluation-authority-v1", version: 1, manifest, phase,
    executionProfileDigest: profileEnvelope.digest, originalOriginDigest: originEnvelope.digest,
    caseScopes, runnerPolicy, recoveryEnvelopeDigest: recoveryEnvelope.digest };
  manifest.confirmationSha256 = u04EvaluationAuthorityConfirmationFixture(authority);
  let authorityEnvelope = fixtureEnvelope(authority, "plan");
  const context: AuditFixtureObject = { authorityEnvelopeDigest: authorityEnvelope.digest,
    targetProjectRef: persistence.fixture.profile.target.projectRef, phase: structuredClone(phase),
    expectedDocumentIds: [...documentIds], expectedManualAliasIds: [...persistence.fixture.profile.manualAliasIds],
    executionProfileEnvelope: profileEnvelope, originalOriginEnvelope: originEnvelope, recoveryEnvelope,
    sourceBindings: structuredClone(sourceBindings), caseScopes: structuredClone(caseScopes),
    runnerPolicy: structuredClone(runnerPolicy), phaseEvidence: side === "baseline"
      ? { side, planEnvelope: null, waveReceiptEnvelope: null }
      : { side, planEnvelope: persistence.parameters.p_plan, waveReceiptEnvelope: terminal!.waveReceiptEnvelope },
    expectedExpiresAt: manifest.expiresAt };
  const request: AuditFixtureObject = { kind: "u04-evaluation-request-v1", version: 1,
    sessionId: side === "baseline" ? "33333333-3333-4333-8333-333333333333" : "44444444-4444-4444-8444-444444444444",
    authorityEnvelopeDigest: authorityEnvelope.digest, executionProfileDigest: profileEnvelope.digest,
    originalOriginDigest: originEnvelope.digest, caseSetDigest: persistence.fixture.profile.cases.digest,
    configurationDigest: persistence.fixture.profile.configuration.digest, sourceBindings: structuredClone(sourceBindings),
    caseScopes: structuredClone(caseScopes), phase: structuredClone(phase),
    comparisonClock: persistence.fixture.profile.comparisonClock,
    requiredSqlOperations: [...u04EvaluationAuthoritySqlOperationsFixture] };
  let requestEnvelope = fixtureEnvelope(request, "u04-evaluation-request-v1");
  const rebindAuthority = (synchronizeContext = true) => {
    (authority.manifest as AuditFixtureObject).confirmationSha256 = u04EvaluationAuthorityConfirmationFixture(authority);
    authorityEnvelope = fixtureEnvelope(authority, "plan");
    context.authorityEnvelopeDigest = authorityEnvelope.digest;
    request.authorityEnvelopeDigest = authorityEnvelope.digest;
    if (synchronizeContext) {
      context.phase = structuredClone(authority.phase);
      context.caseScopes = structuredClone(authority.caseScopes);
      context.runnerPolicy = structuredClone(authority.runnerPolicy);
      context.expectedExpiresAt = (authority.manifest as AuditFixtureObject).expiresAt!;
      request.phase = structuredClone(authority.phase);
      request.caseScopes = structuredClone(authority.caseScopes);
    }
  };
  const rebindRequest = () => { requestEnvelope = fixtureEnvelope(request, "u04-evaluation-request-v1"); };
  return { terminal, persistence, authority, context, request, now: "2024-03-01T00:00:01.000000Z",
    get authorityEnvelope() { return authorityEnvelope; }, get requestEnvelope() { return requestEnvelope; },
    rebindAuthority, rebindRequest };
}

describe("U04 evaluation authority and request strict pure transport", () => {
  const rebindCandidateMemberReceipt = (fixture: ReturnType<typeof u04EvaluationAuthorityFixture>, index: number) => {
    const terminal = fixture.terminal!;
    const member = terminal.members[index]!;
    member.memberReceiptEnvelope = terminal.pgEnvelope(member.receiptPayload, "member_receipt");
    (terminal.wavePayload.members as AuditFixtureObject[])[index]!.memberReceiptEnvelope = member.memberReceiptEnvelope;
  };
  const rebindCandidateWaveReceipt = (fixture: ReturnType<typeof u04EvaluationAuthorityFixture>) => {
    const terminal = fixture.terminal!;
    const waveReceiptEnvelope = terminal.pgEnvelope(terminal.wavePayload, "wave_receipt");
    fixtureSet(fixture.context, ["phaseEvidence", "waveReceiptEnvelope"], waveReceiptEnvelope);
    fixtureSet(fixture.authority, ["phase", "waveReceiptDigest"], waveReceiptEnvelope.digest);
    fixture.rebindAuthority();
  };

  it.each(["baseline", "candidate"] as const)("retains complete independently admitted %s authority and request envelopes", side => {
    const fixture = u04EvaluationAuthorityFixture(side);
    const authority = readShadowEvaluationAuthorityV1(fixture.authorityEnvelope, fixture.context, fixture.now);
    const request = readShadowEvaluationRequestV1(fixture.requestEnvelope, fixture.authorityEnvelope, fixture.context, fixture.now);
    expect(authority).toMatchObject({ kind: "shadow-evaluation-authority-validated",
      envelope: fixture.authorityEnvelope, executionProfileEnvelope: fixture.context.executionProfileEnvelope,
      originalOriginEnvelope: fixture.context.originalOriginEnvelope, recoveryEnvelope: fixture.context.recoveryEnvelope });
    expect(request).toMatchObject({ kind: "shadow-evaluation-request-validated", envelope: fixture.requestEnvelope });
    expect(request.authority.envelope).toEqual(fixture.authorityEnvelope);
    expect(prepareShadowEvaluationAuthorityV1(fixture.authority, fixture.context, fixture.now).envelope)
      .toEqual(fixture.authorityEnvelope);
    expect(prepareShadowEvaluationRequestV1(fixture.request, fixture.authorityEnvelope, fixture.context, fixture.now).envelope)
      .toEqual(fixture.requestEnvelope);
    expect(Object.isFrozen(request.authority.context.runnerPolicy)).toBe(true);
    if (side === "candidate") expect(authority.payload.phase).toMatchObject({
      candidateGenerationId: fixture.terminal!.candidateGenerationId,
      planDigest: fixture.persistence.parameters.p_plan.digest,
      waveReceiptDigest: fixture.terminal!.waveReceiptEnvelope.digest,
    });
  });

  it("preserves an explicitly admitted empty per-case subset as valid empty scope", () => {
    const fixture = u04EvaluationAuthorityFixture("baseline");
    fixtureSet(fixture.authority, ["caseScopes", "scopes", 0, "documentIds"], []);
    fixture.rebindAuthority(); fixture.rebindRequest();
    expect(readShadowEvaluationRequestV1(fixture.requestEnvelope, fixture.authorityEnvelope, fixture.context, fixture.now)
      .payload.caseScopes.scopes[0]!.documentIds).toEqual([]);
  });

  it.each(["missing occurrence", "foreign subset member", "duplicate subset member", "changed original case identity"] as const)(
    "refuses a fully rebound scope map with %s", fault => {
      const fixture = u04EvaluationAuthorityFixture("baseline");
      const scopes = fixtureGet(fixture.authority, ["caseScopes", "scopes"]) as AuditFixtureObject[];
      if (fault === "missing occurrence") scopes.pop();
      if (fault === "foreign subset member") scopes[0]!.documentIds = [auditFixtureV4Uuid(999)];
      if (fault === "duplicate subset member") scopes[0]!.documentIds = [
        String((scopes[0]!.documentIds as AuditFixtureJson[])[0]), String((scopes[0]!.documentIds as AuditFixtureJson[])[0])];
      if (fault === "changed original case identity") fixtureSet(scopes[0]!, ["case", "caseId"], "renamed-case");
      fixture.rebindAuthority(); fixture.rebindRequest();
      expect(() => readShadowEvaluationAuthorityV1(fixture.authorityEnvelope, fixture.context, fixture.now))
        .toThrow("Invalid shadow comparison record.");
    });

  it.each(["runner extra", "confirmation", "admitted digest", "admitted expiry", "expired"] as const)(
    "refuses changed authority or separate admission: %s", fault => {
      const fixture = u04EvaluationAuthorityFixture("baseline");
      if (fault === "runner extra") fixtureSet(fixture.authority, ["runnerPolicy", "unreviewed"], true);
      if (fault === "confirmation") fixtureSet(fixture.authority, ["manifest", "confirmationSha256"], fixtureSha("wrong confirmation"));
      if (fault === "runner extra" || fault === "confirmation") {
        fixture.rebindAuthority(false);
        if (fault === "confirmation") fixtureSet(fixture.authority, ["manifest", "confirmationSha256"], fixtureSha("wrong confirmation"));
        const envelope = fixtureEnvelope(fixture.authority, "plan"); fixture.context.authorityEnvelopeDigest = envelope.digest;
        expect(() => readShadowEvaluationAuthorityV1(envelope, fixture.context, fixture.now)).toThrow("Invalid shadow comparison record.");
        return;
      }
      if (fault === "admitted digest") fixture.context.authorityEnvelopeDigest = fixtureSha("other authority");
      if (fault === "admitted expiry") fixture.context.expectedExpiresAt = "2024-03-01T02:00:00.000000Z";
      const now = fault === "expired" ? String((fixture.authority.manifest as AuditFixtureObject).expiresAt) : fixture.now;
      expect(() => readShadowEvaluationAuthorityV1(fixture.authorityEnvelope, fixture.context, now))
        .toThrow("Invalid shadow comparison record.");
    });

  it("refuses candidate authority whose rebound receipt digest does not name the supplied full receipt", () => {
    const fixture = u04EvaluationAuthorityFixture("candidate");
    fixtureSet(fixture.authority, ["phase", "waveReceiptDigest"], fixtureSha("foreign wave receipt"));
    fixture.rebindAuthority();
    expect(() => readShadowEvaluationAuthorityV1(fixture.authorityEnvelope, fixture.context, fixture.now))
      .toThrow("Invalid shadow comparison record.");
  });

  it("refuses a fully rehashed candidate receipt whose expected state differs from its planned state", () => {
    const fixture = u04EvaluationAuthorityFixture("candidate");
    fixture.terminal!.members[0]!.receiptPayload.expectedStateDigest = "f".repeat(64);
    rebindCandidateMemberReceipt(fixture, 0); rebindCandidateWaveReceipt(fixture);
    expect(() => readShadowEvaluationAuthorityV1(fixture.authorityEnvelope, fixture.context, fixture.now))
      .toThrow("Invalid shadow comparison record.");
  });

  it("refuses a fully rehashed candidate wave timestamp that is not the maximum member seal", () => {
    const fixture = u04EvaluationAuthorityFixture("candidate");
    fixture.terminal!.wavePayload.sealedAt = "2024-02-29T23:59:53.123456Z";
    rebindCandidateWaveReceipt(fixture);
    expect(() => readShadowEvaluationAuthorityV1(fixture.authorityEnvelope, fixture.context, fixture.now))
      .toThrow("Invalid shadow comparison record.");
  });

  it("refuses a fully rehashed original origin captured after authorization", () => {
    const fixture = u04EvaluationAuthorityFixture("baseline");
    const origin = JSON.parse(String((fixture.context.originalOriginEnvelope as AuditFixtureObject).canonicalPayload)) as AuditFixtureObject;
    origin.capturedAt = "2024-03-01T00:00:00.000007Z";
    const originEnvelope = fixtureEnvelope(origin, "baseline", "pg-jsonb-text-v1");
    fixture.context.originalOriginEnvelope = originEnvelope;
    fixture.authority.originalOriginDigest = originEnvelope.digest;
    for (const source of fixture.context.sourceBindings as AuditFixtureObject[]) source.originDigest = originEnvelope.digest;
    fixture.rebindAuthority();
    expect(() => readShadowEvaluationAuthorityV1(fixture.authorityEnvelope, fixture.context, fixture.now))
      .toThrow("Invalid shadow comparison record.");
  });

  it("refuses a fully rehashed candidate plan prepared after authorization", () => {
    const fixture = u04EvaluationAuthorityFixture("candidate");
    fixture.persistence.planPayload.audit.validation.auditPreparedAt = "2024-03-01T00:00:00.000007Z";
    const planEnvelope = fixtureEnvelope(fixture.persistence.planPayload, "plan");
    fixtureSet(fixture.context, ["phaseEvidence", "planEnvelope"], planEnvelope);
    fixtureSet(fixture.authority, ["phase", "planDigest"], planEnvelope.digest);
    fixture.terminal!.wavePayload.planDigest = planEnvelope.digest;
    for (const [index, member] of fixture.terminal!.members.entries()) {
      member.receiptPayload.planDigest = planEnvelope.digest;
      rebindCandidateMemberReceipt(fixture, index);
    }
    rebindCandidateWaveReceipt(fixture);
    expect(() => readShadowEvaluationAuthorityV1(fixture.authorityEnvelope, fixture.context, fixture.now))
      .toThrow("Invalid shadow comparison record.");
  });

  it("refuses fully rehashed candidate evidence sealed after authorization", () => {
    const fixture = u04EvaluationAuthorityFixture("candidate");
    const futureSeal = "2024-03-01T00:00:00.000007Z";
    for (const [index, member] of fixture.terminal!.members.entries()) {
      member.sealedAt = futureSeal; member.receiptPayload.sealedAt = futureSeal;
      rebindCandidateMemberReceipt(fixture, index);
    }
    fixture.terminal!.wavePayload.sealedAt = futureSeal;
    rebindCandidateWaveReceipt(fixture);
    expect(() => readShadowEvaluationAuthorityV1(fixture.authorityEnvelope, fixture.context, fixture.now))
      .toThrow("Invalid shadow comparison record.");
  });

  it("validates bound recovery evidence at authorization as well as execution time", () => {
    const fixture = u04EvaluationAuthorityFixture("baseline");
    const recovery = fixture.persistence.recovery;
    // Existing recovery validation permits five minutes of clock skew.
    const futureVerification = "2024-03-01T00:06:00.000Z";
    fixture.now = "2024-03-01T00:07:00.000Z";
    recovery.verifiedAt = futureVerification;
    (recovery.databaseBackup as AuditFixtureObject).verifiedAt = futureVerification;
    (recovery.pitr as AuditFixtureObject).verifiedAt = futureVerification;
    (recovery.storageRecovery as AuditFixtureObject).verifiedAt = futureVerification;
    (recovery.restoreDrill as AuditFixtureObject).completedAt = futureVerification;
    recovery.digest = recoveryReadinessDigest(recovery);
    const recoveryBytes = fixture.persistence.original("u04-recovery-readiness-bytes-v1", recovery);
    fixture.context.recoveryEnvelope = recoveryBytes.envelope;
    fixture.authority.recoveryEnvelopeDigest = recoveryBytes.envelope.digest;
    fixtureSet(fixture.authority, ["manifest", "recoveryEvidenceSha256"], fixtureSha(recoveryBytes.bytes));
    fixture.rebindAuthority();
    expect(() => readShadowEvaluationAuthorityV1(fixture.authorityEnvelope, fixture.context, fixture.now))
      .toThrow("Invalid shadow comparison record.");
  });

  it.each(["raw file", "framed envelope", "internal evidence"] as const)(
    "refuses a fully rebound substitution of the %s recovery digest", fault => {
      const fixture = u04EvaluationAuthorityFixture(fault === "internal evidence" ? "candidate" : "baseline");
      if (fault === "raw file") fixtureSet(fixture.authority, ["manifest", "recoveryEvidenceSha256"], fixtureSha("other raw file"));
      if (fault === "framed envelope") fixture.authority.recoveryEnvelopeDigest = fixtureSha("other recovery envelope");
      if (fault === "internal evidence") {
        fixture.terminal!.wavePayload.recoveryEvidenceDigest = fixtureSha("other internal recovery evidence");
        rebindCandidateWaveReceipt(fixture);
      } else fixture.rebindAuthority();
      expect(() => readShadowEvaluationAuthorityV1(fixture.authorityEnvelope, fixture.context, fixture.now))
        .toThrow("Invalid shadow comparison record.");
    });

  it.each(["operation order", "configuration", "source", "unknown root"] as const)("refuses request %s drift", fault => {
    const fixture = u04EvaluationAuthorityFixture("baseline");
    if (fault === "operation order") (fixture.request.requiredSqlOperations as AuditFixtureJson[]).reverse();
    if (fault === "configuration") fixture.request.configurationDigest = fixtureSha("other configuration");
    if (fault === "source") fixtureSet(fixture.request, ["sourceBindings", 0, "contentHash"], fixtureSha("other source"));
    if (fault === "unknown root") fixture.request.unreviewed = true;
    fixture.rebindRequest();
    expect(() => readShadowEvaluationRequestV1(fixture.requestEnvelope, fixture.authorityEnvelope, fixture.context, fixture.now))
      .toThrow("Invalid shadow comparison record.");
  });
});

describe("U04 fixed evaluation return rows", () => {
  const id1 = "11111111-1111-4111-8111-111111111111";
  const id2 = "22222222-2222-4222-8222-222222222222";
  const id3 = "33333333-3333-4333-8333-333333333333";

  const label = {
    id: id3,
    document_id: id1,
    owner_id: null,
    label: "Falls",
    label_type: "topic",
    source: "generated",
    confidence: 0.8123456789012345,
    metadata: { nested: [null, true, 0.125, "value"] },
    created_at: "2026-09-13T00:00:00+00:00",
    updated_at: "2026-09-13T00:00:00.123456+00:00",
  };
  const inlineImage = {
    id: id2,
    page_number: null,
    storage_path: "private/image.png",
    caption: "",
    bbox: null,
    image_type: "clinical_table",
    searchable: true,
    clinical_relevance_score: 0.7345678901234567,
    source_kind: "embedded",
    sourceKind: "embedded",
    tableLabel: null,
    tableTitle: "Dose table",
    tableRole: "reference",
    tableTextSnippet: "Dose by age",
    width: null,
    height: 480,
    labels: ["dose", null],
    metadata: { untouched: { value: 1 } },
  };
  const hydratedChunk = {
    id: id2,
    document_id: id1,
    page_number: null,
    chunk_index: 4,
    section_heading: null,
    section_path: ["Medication", null],
    heading_level: null,
    parent_heading: null,
    anchor_id: null,
    content: "Dose guidance",
    retrieval_synopsis: null,
    image_ids: [id3, null],
    index_generation_id: null,
  };
  const directLookupChunk = {
    id: id2,
    document_id: id1,
    page_number: null,
    chunk_index: 4,
    section_heading: null,
    section_path: ["Medication", null],
    heading_level: null,
    parent_heading: null,
    anchor_id: null,
    content: "Dose guidance",
    retrieval_synopsis: null,
    image_ids: [id3, null],
  };
  const imageRow = {
    id: id2,
    document_id: id1,
    page_number: null,
    storage_path: "private/image.png",
    caption: "",
    bbox: { x: 0.1, y: 0.2 },
    image_type: "clinical_table",
    searchable: true,
    clinical_relevance_score: 0.7345678901234567,
    source_kind: "embedded",
    width: null,
    height: 480,
    labels: ["dose", null],
    metadata: { arbitrary: [1, null, { complete: true }] },
  };
  const documentLookup = {
    id: id1,
    owner_id: null,
    title: "Guideline",
    file_name: "guideline.pdf",
    status: "indexed",
    page_count: 10,
    chunk_count: 20,
    image_count: 2,
    metadata: { source: { nested: true } },
  };
  const memoryCard = {
    id: id3,
    document_id: id1,
    owner_id: null,
    section_id: null,
    card_type: "threshold",
    title: "Threshold",
    content: "Escalate at 5",
    normalized_terms: ["escalate", null],
    page_number: null,
    source_chunk_ids: [id2, null],
    source_image_ids: [id3, null],
    confidence: 0.8123456789012345,
    metadata: { producer: "fixture" },
  };
  const textChunk = {
    id: id2,
    document_id: id1,
    title: "Guideline",
    file_name: "guideline.pdf",
    page_number: null,
    chunk_index: 4,
    section_heading: null,
    content: "Dose guidance",
    retrieval_synopsis: null,
    image_ids: [id3, null],
    source_metadata: { anyJson: [null, "kept"] },
    document_labels: [label],
    document_summary: null,
    similarity: 0,
    text_rank: 0.7123456789012345,
    hybrid_score: 0.4123456789012345,
    lexical_score: 0.8123456789012345,
    images: [inlineImage],
  };
  const hybridChunk = {
    id: id2,
    document_id: id1,
    title: "Guideline",
    file_name: "guideline.pdf",
    page_number: null,
    chunk_index: 4,
    section_heading: null,
    content: "Dose guidance",
    retrieval_synopsis: null,
    image_ids: [id3, null],
    source_metadata: { anyJson: [null, "kept"] },
    similarity: 0.7123456789012345,
    text_rank: 0.3123456789012345,
    hybrid_score: 0.6123456789012345,
    rrf_score: 0.03125,
    images: [inlineImage],
  };
  const vectorChunk = {
    id: id2,
    document_id: id1,
    title: "Guideline",
    file_name: "guideline.pdf",
    page_number: null,
    chunk_index: 4,
    section_heading: null,
    content: "Dose guidance",
    retrieval_synopsis: null,
    image_ids: [id3, null],
    source_metadata: { anyJson: [null, "kept"] },
    document_labels: [],
    document_summary: null,
    similarity: 0.7123456789012345,
    images: [],
  };
  const lookupChunk = { ...directLookupChunk, text_rank: 0.6123456789012345 };
  const tableFact = {
    id: id3,
    document_id: id1,
    source_chunk_id: null,
    source_image_id: null,
    page_number: null,
    table_title: null,
    row_label: null,
    clinical_parameter: null,
    threshold_value: null,
    action: null,
    text_rank: 0.5123456789012345,
    match_reason: "table_row",
    metadata: {},
  };
  const embeddingField = {
    id: id3,
    document_id: id1,
    source_chunk_id: id2,
    field_type: "chunk_high_yield",
    content: "Escalation threshold",
    similarity: 0.7123456789012345,
    text_rank: 0.2123456789012345,
    hybrid_score: 0.6123456789012345,
  };
  const indexUnit = {
    id: id3,
    document_id: id1,
    source_chunk_id: id2,
    source_image_id: null,
    unit_type: "threshold",
    title: "Threshold",
    content: "Escalate at 5",
    page_start: null,
    page_end: null,
    heading_path: ["Medication", null],
    normalized_terms: ["escalate", null],
    source_span: { start: 3, end: 8 },
    quality_score: 0.7123456789012345,
    extraction_mode: "deterministic",
    similarity: 0.6123456789012345,
    text_rank: 0.2123456789012345,
    hybrid_score: 0.5123456789012345,
    metadata: { native: true },
  };

  function validResults() {
    const adjacentLater = {
      id: id3,
      document_id: id1,
      page_number: 3,
      chunk_index: 5,
      section_heading: "Later",
      content: "Later context",
      retrieval_synopsis: null,
      index_generation_id: null,
    };
    const adjacentEarlier = { ...adjacentLater, id: id2, page_number: null, chunk_index: 4 };
    return {
      aliases: {
        ownerRows: [{ alias: "falls", canonical: "fall prevention", alias_type: "clinical_term", weight: 0.9, owner_id: id1 }],
        publicRows: [{ alias: "fall", canonical: "fall prevention", alias_type: "clinical_term", weight: 0.8, owner_id: null }],
      },
      corpus_terms: [{ term: "falls", has_ts_signal: true, title_doc_count: 1, chunk_present: true, total_doc_count: 2 }],
      correct_terms: "fall prevention",
      text_chunks: [textChunk],
      hybrid_chunks: [hybridChunk],
      vector_chunks: [vectorChunk],
      lookup_chunks: [lookupChunk],
      lookup_chunk_terms: [directLookupChunk],
      lookup_chunk_prefix: [directLookupChunk],
      lookup_documents: [{ ...documentLookup, text_rank: 0.7, match_reason: "title" }],
      lookup_document_terms: [documentLookup],
      table_facts: [tableFact],
      embedding_fields: [embeddingField],
      index_units: [indexUnit],
      memory_cards_hybrid: [{ ...memoryCard, similarity: 0.7, text_rank: 0.2, hybrid_score: 0.6, rrf_score: 0.03 }],
      memory_cards_lexical: [memoryCard],
      chunks_by_ids: [hydratedChunk],
      chunks_by_indexes: [hydratedChunk],
      documents: [{ id: id1, title: "Guideline", file_name: "guideline.pdf", metadata: { native: [1, null] }, owner_id: null, status: "indexed" }],
      ranking_metadata: [{ document_id: id1, labels: [label], summary: null }],
      related_documents: [{ document_id: id1, labels: [], summary: "Summary" }],
      quality: [{ document_id: id1, owner_id: null, quality_score: 0.8, extraction_quality: "good", metrics: { nested: [1, null] }, issues: ["warning", null], updated_at: "2026-09-13T00:00:00+00:00" }],
      images_by_ids: [imageRow],
      images_by_pages: [imageRow],
      visual_rows: [{ id: id2, document_id: id1, page_number: null, source_kind: "embedded", searchable: true, image_type: "clinical_table", clinical_relevance_score: 0.7, metadata: { native: true } }],
      adjacent_chunks: [adjacentLater, adjacentEarlier, adjacentLater],
    };
  }

  async function reader() {
    const module = await import("../scripts/lib/reindex-eval-session");
    return module.readShadowEvaluationRowsV1 as (operation: string, rows: unknown) => unknown;
  }

  it("accepts all 26 fixed result shapes without normalizing JSON, order, or duplicates", async () => {
    const read = await reader();
    const results = validResults();
    expect(Object.keys(results)).toHaveLength(26);
    for (const [operation, value] of Object.entries(results)) {
      const parsed = read(operation, value);
      expect(parsed).toEqual(value);
      if (typeof parsed === "object" && parsed !== null) {
        expect(parsed).not.toBe(value);
        expect(Object.isFrozen(parsed)).toBe(true);
      }
    }
    expect((read("adjacent_chunks", results.adjacent_chunks) as Array<{ id: string }>).map((row) => row.id)).toEqual([id3, id2, id3]);
    expect(results.text_chunks[0]!.source_metadata).toEqual({ anyJson: [null, "kept"] });
  });

  it("rejects unknown operations and the three operation-specific root forms", async () => {
    const read = await reader();
    expect(() => read("unknown_operation", [])).toThrow();
    expect(() => read("aliases", [])).toThrow();
    expect(() => read("correct_terms", ["fall prevention"])).toThrow();
    expect(() => read("documents", { rows: [] })).toThrow();
  });

  it("rejects missing, extra, non-enumerable, and nested extra fields", async () => {
    const read = await reader();
    const missing = structuredClone(textChunk) as Record<string, unknown>;
    delete missing.content;
    expect(() => read("text_chunks", [missing])).toThrow();
    expect(() => read("text_chunks", [{ ...textChunk, unexpected: true }])).toThrow();
    expect(() => read("text_chunks", [{ ...textChunk, images: [{ ...inlineImage, unexpected: true }] }])).toThrow();
    const hidden = { ...documentLookup };
    Object.defineProperty(hidden, "hidden", { value: true, enumerable: false });
    expect(() => read("lookup_document_terms", [hidden])).toThrow();
  });

  it("preserves nullable columns and native JSON while rejecting illegal nulls and numeric representations", async () => {
    const read = await reader();
    expect(read("chunks_by_ids", [hydratedChunk])).toEqual([hydratedChunk]);
    expect(read("images_by_ids", [imageRow])).toEqual([imageRow]);
    expect(() => read("chunks_by_ids", [{ ...hydratedChunk, section_path: null }])).toThrow();
    expect(() => read("images_by_ids", [{ ...imageRow, searchable: null }])).toThrow();
    expect(() => read("corpus_terms", [{ term: "falls", has_ts_signal: true, title_doc_count: 1.5, chunk_present: true, total_doc_count: 2 }])).toThrow();
    expect(() => read("corpus_terms", [{ term: "falls", has_ts_signal: true, title_doc_count: 2147483648, chunk_present: true, total_doc_count: 2 }])).toThrow();
    expect(() => read("quality", [{ ...validResults().quality[0], quality_score: Number.POSITIVE_INFINITY }])).toThrow();
    expect(() => read("documents", [{ ...validResults().documents[0], metadata: undefined }])).toThrow();
  });

  it("enforces the fixed vector and table-fact placeholders", async () => {
    const read = await reader();
    expect(() => read("vector_chunks", [{ ...vectorChunk, document_labels: [label] }])).toThrow();
    expect(() => read("vector_chunks", [{ ...vectorChunk, document_summary: "invented" }])).toThrow();
    expect(() => read("vector_chunks", [{ ...vectorChunk, images: [inlineImage] }])).toThrow();
    expect(() => read("table_facts", [{ ...tableFact, metadata: { invented: true } }])).toThrow();
  });

  it("keeps alias scopes and exact nested label/image arrays closed", async () => {
    const read = await reader();
    const aliases = validResults().aliases;
    expect(read("aliases", aliases)).toEqual(aliases);
    expect(() => read("aliases", { ...aliases, rows: [] })).toThrow();
    expect(() => read("ranking_metadata", [{ document_id: id1, labels: [{ ...label, confidence: null }], summary: null }])).toThrow();
    expect(() => read("hybrid_chunks", [{ ...hybridChunk, images: [{ ...inlineImage, bbox: undefined }] }])).toThrow();
  });
});


describe("U04 fixed evaluation call arguments", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const vector = "[ " + Array.from({ length: 1536 }, (_, index) => index === 0 ? "1e-3" : "0").join(", ") + " ]";
  const hybrid = { query_embedding: vector, query_text: " exact query \n", match_count: -2,
    min_similarity: 0.123456789012345, document_filters: [id, id] };
  const samples = {
    aliases: {}, corpus_terms: { terms: ["dose", "dose", ""] }, correct_terms: { input_query: " exact ", min_sim: 0.45 },
    text_chunks: { query_text: "exact", match_count: 0, document_filters: null }, hybrid_chunks: hybrid,
    vector_chunks: { query_embedding: vector, match_count: -1, min_similarity: 0, document_filter: null },
    lookup_chunks: { query_text: "exact", document_filters: [], match_count: 0 },
    lookup_chunk_terms: { document_filters: [id], terms: ["a", "a"], match_count: 2 },
    lookup_chunk_prefix: { document_filters: [id], match_count: 3 },
    lookup_documents: { query_text: "exact", match_count: 4 }, lookup_document_terms: { terms: [] },
    table_facts: { query_text: "exact", match_count: 5, document_filters: null },
    embedding_fields: hybrid, index_units: hybrid, memory_cards_hybrid: hybrid,
    memory_cards_lexical: { query_text: "exact", document_filters: [], match_count: 6 },
    chunks_by_ids: { ids: [id, id] }, chunks_by_indexes: { document_ids: [id, id], indexes: [3, 1, 3], match_count: 80 },
    documents: { ids: [id] }, ranking_metadata: { document_ids: [id] }, related_documents: { document_ids: [] },
    quality: { document_ids: [id] }, images_by_ids: { ids: [] },
    images_by_pages: { document_ids: [id], page_numbers: [2, 1, 2] }, visual_rows: { document_ids: [] },
    adjacent_chunks: { document_ids: [id], chunk_indexes: [1, 0, 1] },
  };
  it("preserves the original arguments of all 26 fixed capabilities without reselecting or normalizing", () => {
    expect(Object.keys(samples)).toHaveLength(26);
    for (const operation of Object.keys(samples) as (keyof typeof samples)[]) {
      const result = readShadowEvaluationArgumentsV1(operation, samples[operation]);
      expect(result).toEqual(samples[operation]); expect(result).not.toBe(samples[operation]);
      expect(Object.isFrozen(result)).toBe(true);
    }
    expect(readShadowEvaluationArgumentsV1("hybrid_chunks", hybrid).query_embedding).toBe(vector);
    expect(readShadowEvaluationArgumentsV1("chunks_by_indexes", samples.chunks_by_indexes).indexes).toEqual([3, 1, 3]);
  });
  it("rejects unknown operations, parameters and missing explicit filters", () => {
    expect(() => readShadowEvaluationArgumentsV1("arbitrary_rpc" as never, {})).toThrow();
    expect(() => readShadowEvaluationArgumentsV1("aliases", { owner_filter: id })).toThrow();
    expect(() => readShadowEvaluationArgumentsV1("text_chunks", { query_text: "a", match_count: 1 })).toThrow();
    expect(() => readShadowEvaluationArgumentsV1("documents", { ids: ["foreign-not-uuid"] })).toThrow();
  });
  it("rejects unrepresentable vectors and integers while preserving admitted SQL clamp inputs", () => {
    for (const query_embedding of ["[0]", "[NaN]", "[Infinity]", vector.replace("1e-3", "1e999")]) {
      expect(() => readShadowEvaluationArgumentsV1("hybrid_chunks", { ...hybrid, query_embedding })).toThrow();
    }
    for (const match_count of [1.5, 2147483648, -2147483649, Number.NaN]) {
      expect(() => readShadowEvaluationArgumentsV1("hybrid_chunks", { ...hybrid, match_count })).toThrow();
    }
    expect(readShadowEvaluationArgumentsV1("hybrid_chunks", hybrid).match_count).toBe(-2);
  });
  it("enforces the separately adopted indexes capability bound with explicit empty arrays", () => {
    expect(readShadowEvaluationArgumentsV1("chunks_by_indexes", { document_ids: [], indexes: [], match_count: 1 }))
      .toEqual({ document_ids: [], indexes: [], match_count: 1 });
    for (const match_count of [0, 81]) {
      expect(() => readShadowEvaluationArgumentsV1("chunks_by_indexes", { ...samples.chunks_by_indexes, match_count })).toThrow();
    }
  });
});


describe("U04 fixed call scope binding", () => {
  function scopedFixture(documentIds: string[] | null = null) {
    const f = u04EvaluationAuthorityFixture("baseline");
    const scope = ((f.authority.caseScopes as AuditFixtureObject).scopes as AuditFixtureObject[])[0]!;
    if (documentIds !== null) scope.documentIds = documentIds;
    f.rebindAuthority(); f.rebindRequest();
    return { f, address: scope.case };
  }
  it("preserves declared empty scope for both null and empty ordinary document filters", () => {
    const { f, address } = scopedFixture([]);
    for (const document_filters of [null, []]) {
      const args = { query_text: "source question", match_count: 12, document_filters };
      const call = prepareShadowEvaluationCallV1(f.requestEnvelope, f.authorityEnvelope, f.context, f.now,
        "text_chunks", address, 0, args);
      expect(call).toEqual({ operation: "text_chunks", case: address, readOrdinal: 0, documentIds: [], originalArguments: args });
      expect(Object.isFrozen(call.documentIds)).toBe(true);
    }
  });
  it("preserves duplicate filter order within an independently declared subset", () => {
    const { f, address } = scopedFixture();
    const id = f.persistence.fixture.profile.documentIds[0]!;
    const args = { document_ids: [id, id], indexes: [4, 2, 4], match_count: 80 };
    expect(prepareShadowEvaluationCallV1(f.requestEnvelope, f.authorityEnvelope, f.context, f.now,
      "chunks_by_indexes", address, 3, args).originalArguments).toEqual(args);
  });
  it("refuses a foreign filter, unknown case or invalid read ordinal before dispatch exists", () => {
    const { f, address } = scopedFixture([]);
    const id = f.persistence.fixture.profile.documentIds[0]!;
    const prepare = (operation: "quality" | "aliases", args: unknown, caseAddress = address, ordinal = 0) =>
      prepareShadowEvaluationCallV1(f.requestEnvelope, f.authorityEnvelope, f.context, f.now,
        operation, caseAddress, ordinal, args);
    expect(() => prepare("quality", { document_ids: [id] })).toThrow();
    expect(() => prepare("aliases", {}, { kind: "retrieval", index: 999, caseId: "absent" })).toThrow();
    expect(() => prepare("aliases", {}, address, -1)).toThrow();
  });
});


describe("U04 same-statement evaluation observation", () => {
  function setup(side: "baseline" | "candidate" = "baseline") {
    const terminal = side === "candidate" ? terminalStateFixture("evaluate") : null;
    const f = u04EvaluationAuthorityFixture(side, terminal?.f);
    const startedAt = f.now, finishedAt = "2024-03-01T00:00:02.000000Z";
    const profile = parseShadowExecutionProfileEnvelope(f.context.executionProfileEnvelope);
    const observed = JSON.parse((terminal?.input.currentOriginEnvelope ?? f.persistence.fixture.input.originEnvelope).canonicalPayload) as AuditFixtureObject;
    observed.capturedAt = startedAt;
    const observedOriginEnvelope = fixtureEnvelope(observed, "baseline", "pg-jsonb-text-v1");
    const controls = terminal?.f.members.map(member => ({ documentId: member.documentId,
      controlEnvelope: (JSON.parse(member.memberReceiptEnvelope.canonicalPayload) as AuditFixtureObject).terminalControlEnvelope })) ?? [];
    const observation = { observedAt: startedAt,
      guard: { mode: "same_statement_logical_equality", observedOriginEnvelope, controls },
      environment: { reviewedEnvironmentDigest: profile.sql.bytes.envelope.digest,
        operation: structuredClone(profile.sql.capture.payload.operations.find(entry => entry.operation === "documents")!) } };
    const candidateEvidence = terminal === null ? null : {
      readback: terminal.f.readback, context: terminal.f.context, stateInput: terminal.input,
      stateAdmission: terminal.f.persistence.fixture.admission, candidateRows: terminal.bindings,
    };
    const scope = (f.request.caseScopes as { scopes: { case: unknown }[] }).scopes[0]!;
    const read = () => readShadowEvaluationObservationV1(observation, f.requestEnvelope, f.authorityEnvelope,
      f.context, "documents", startedAt, finishedAt, candidateEvidence);
    return { f, terminal, observation, candidateEvidence, scope, read, startedAt, finishedAt };
  }
  it("prepares exact baseline SQL context and validates unchanged full origin for an empty document result", () => {
    const v = setup();
    const context = prepareShadowEvaluationSqlContextV1(v.f.requestEnvelope, v.f.authorityEnvelope, v.f.context,
      v.startedAt, "documents", v.scope.case, 0, { ids: [] });
    expect(context.call.originalArguments).toEqual({ ids: [] });
    expect(context.evidence).toEqual({ side: "baseline", planEnvelope: null, waveReadback: null });
    expect(context.originalOriginEnvelope).toEqual(v.f.context.originalOriginEnvelope);
    expect(v.read().kind).toBe("shadow-evaluation-observation-validated");
  });
  it("refuses a fully rehashed changed baseline even when the requested IDs are empty", () => {
    const v = setup();
    const origin = JSON.parse(v.observation.guard.observedOriginEnvelope.canonicalPayload) as AuditFixtureObject;
    const rows = fixtureGet(origin, ["rows", "documents"]) as AuditFixtureObject[];
    const document = JSON.parse(rows[0]!.canonicalPayload as string) as AuditFixtureObject;
    document.title = "changed while query returned empty";
    rows[0] = fixtureEnvelope(document, "baseline", "pg-jsonb-text-v1") as unknown as AuditFixtureObject;
    v.observation.guard.observedOriginEnvelope = fixtureEnvelope(origin, "baseline", "pg-jsonb-text-v1");
    expect(v.read).toThrow("Invalid shadow comparison record.");
  });
  it("refuses changed actual settings despite the expected reviewed environment digest", () => {
    const v = setup();
    v.observation.environment.operation = { ...v.observation.environment.operation,
      settings: v.observation.environment.operation.settings.map((setting, index) =>
        index === 0 ? { ...setting, effectiveText: "changed" } : setting) };
    expect(v.read).toThrow("Invalid shadow comparison record.");
  });
  it("refuses observations outside the actual call interval and an exceeded client deadline", () => {
    const v = setup();
    expect(() => readShadowEvaluationObservationV1(v.observation, v.f.requestEnvelope, v.f.authorityEnvelope,
      v.f.context, "documents", v.startedAt, "2024-03-01T00:00:22.000001Z")).toThrow();
    v.observation.observedAt = "2024-03-01T00:00:00.000000Z";
    expect(v.read).toThrow();
  });
  it("binds all sealed candidate members and controls to the fresh observed origin", () => {
    const v = setup("candidate");
    const context = prepareShadowEvaluationSqlContextV1(v.f.requestEnvelope, v.f.authorityEnvelope, v.f.context,
      v.startedAt, "documents", v.scope.case, 0, { ids: [] }, v.candidateEvidence);
    expect(context.evidence.side).toBe("candidate");
    expect(v.read().kind).toBe("shadow-evaluation-observation-validated");
    v.observation.guard.controls.pop();
    expect(v.read).toThrow("Invalid shadow comparison record.");
  });
  it("refuses candidate read preparation without independently admitted complete row evidence", () => {
    const v = setup("candidate");
    v.candidateEvidence!.candidateRows = [];
    expect(() => prepareShadowEvaluationSqlContextV1(v.f.requestEnvelope, v.f.authorityEnvelope, v.f.context,
      v.startedAt, "documents", v.scope.case, 0, { ids: [] }, v.candidateEvidence)).toThrow();
  });
});


describe("U04 fixed result occurrence transport", () => {
  function fixture() {
    const f = u04EvaluationAuthorityFixture("baseline");
    const scopes = (f.request.caseScopes as { scopes: { case: unknown; documentIds: string[] }[] }).scopes;
    const scope = scopes[0]!;
    const call = prepareShadowEvaluationCallV1(f.requestEnvelope, f.authorityEnvelope, f.context, f.now,
      "documents", scope.case, 0, { ids: scope.documentIds });
    const profile = parseShadowExecutionProfileEnvelope(f.context.executionProfileEnvelope);
    const origin = JSON.parse(f.persistence.fixture.input.originEnvelope.canonicalPayload) as AuditFixtureObject;
    const rowEnvelope = (fixtureGet(origin, ["rows", "documents"]) as AuditFixtureObject[])[0]!;
    const row = JSON.parse(rowEnvelope.canonicalPayload as string) as AuditFixtureObject;
    const source = (f.request.sourceBindings as AuditFixtureObject[])[0]!;
    const payload: AuditFixtureObject = { kind: "u04-evaluation-read-result-v1", version: 1, operation: "documents",
      requestDigest: f.requestEnvelope.digest, call: call as unknown as AuditFixtureObject, observedAt: f.now,
      guard: { mode: "same_statement_logical_equality", observedOriginEnvelope: f.persistence.fixture.input.originEnvelope,
        controls: [] }, environment: { reviewedEnvironmentDigest: profile.sql.bytes.envelope.digest,
        operation: profile.sql.capture.payload.operations.find(entry => entry.operation === "documents") as unknown as AuditFixtureObject },
      result: [{ id: row.id!, title: row.title!, file_name: row.file_name!, metadata: row.metadata!, owner_id: row.owner_id!, status: row.status! }],
      sources: [{ part: "rows", index: 0, view: { tag: "baseline", source },
        refs: [{ tag: "origin_row", owner: "document", rowId: row.id!, rowDigest: rowEnvelope.digest! }], relationships: [] }] };
    const read = () => parseShadowEvaluationResultEnvelopeV1(fixtureEnvelope(payload, "evaluation_report", "pg-jsonb-text-v1"),
      f.requestEnvelope, f.authorityEnvelope, f.context, f.now, call);
    const semanticRead = () => {
      const observed = JSON.parse(f.persistence.fixture.input.originEnvelope.canonicalPayload) as AuditFixtureObject;
      observed.capturedAt = f.now;
      fixtureSet(payload, ["guard", "observedOriginEnvelope"], fixtureEnvelope(observed, "baseline", "pg-jsonb-text-v1") as unknown as AuditFixtureObject);
      return readShadowEvaluationResultV1(fixtureEnvelope(payload, "evaluation_report", "pg-jsonb-text-v1"),
        f.requestEnvelope, f.authorityEnvelope, f.context, f.now, "2024-03-01T00:00:02.000000Z", call);
    };
    return { f, call, payload, read, semanticRead };
  }
  it("retains the complete original result envelope and binds each duplicate output occurrence independently", () => {
    const v = fixture();
    (v.payload.result as AuditFixtureJson[]).push(structuredClone((v.payload.result as AuditFixtureJson[])[0]!));
    (v.payload.sources as AuditFixtureObject[]).push({ ...(v.payload.sources as AuditFixtureObject[])[0]!, index: 1 });
    expect(v.read().payload.sources).toHaveLength(2);
    (v.payload.sources as AuditFixtureObject[]).pop();
    expect(v.read).toThrow("Invalid shadow comparison record.");
  });
  it("refuses a rehashed result for a different operation or call ordinal", () => {
    const v = fixture(); v.payload.operation = "lookup_documents";
    expect(v.read).toThrow(); v.payload.operation = "documents";
    v.payload.call = { ...(v.payload.call as AuditFixtureObject), readOrdinal: 1 };
    expect(v.read).toThrow();
  });
  it("refuses a nonaggregate source without full refs or with a foreign view", () => {
    const v = fixture(), source = (v.payload.sources as AuditFixtureObject[])[0]!;
    const original = structuredClone(source.refs); source.refs = [];
    expect(v.read).toThrow(); source.refs = original!;
    fixtureSet(source, ["view", "source", "documentId"], auditFixtureV4Uuid(999));
    expect(v.read).toThrow();
  });
  it("accepts explicitly empty rows only with no fabricated row source occurrences", () => {
    const v = fixture(); v.payload.result = []; v.payload.sources = [];
    expect(v.read().payload.sources).toEqual([]);
    v.payload.sources = [{ part: "rows", index: 0, view: null, refs: [], relationships: [] }];
    expect(v.read).toThrow();
  });
  it("semantically binds returned fields to the complete same-statement document bytes", () => {
    const v = fixture();
    expect(v.semanticRead().kind).toBe("shadow-evaluation-result-validated");
    (v.payload.result as AuditFixtureObject[])[0]!.title = "plausible but not the retained title";
    expect(v.read().kind).toBe("shadow-evaluation-result-transport-validated");
    expect(v.semanticRead).toThrow("Invalid shadow comparison record.");
  });
  it("refuses a rehashed source reference absent from the fully retained origin", () => {
    const v = fixture();
    fixtureSet(v.payload, ["sources", 0, "refs", 0, "rowDigest"], `sha256:${"f".repeat(64)}`);
    expect(v.read().kind).toBe("shadow-evaluation-result-transport-validated");
    expect(v.semanticRead).toThrow("Invalid shadow comparison record.");
  });
  it("refuses invented relationships despite valid document bytes", () => {
    const v = fixture();
    fixtureSet(v.payload, ["sources", 0, "relationships"], [{ tag: "page", field: ["page_number"], target: { family: "pages", key: "1" } }]);
    expect(v.semanticRead).toThrow("Invalid shadow comparison record.");
  });
});


describe("U04 complete result semantic regressions", () => {
  let baseline: ReturnType<typeof u04EvaluationAuthorityFixture>;
  let candidateTerminal: ReturnType<typeof terminalStateFixture>;

  beforeAll(() => {
    baseline = u04EvaluationAuthorityFixture("baseline");
    candidateTerminal = terminalStateFixture("evaluate");
  });

  function resultPayload(
    f: ReturnType<typeof u04EvaluationAuthorityFixture>, operation: typeof u04EvaluationAuthoritySqlOperationsFixture[number],
    call: ReturnType<typeof prepareShadowEvaluationCallV1>, result: AuditFixtureJson, sources: AuditFixtureObject[],
    terminal: ReturnType<typeof terminalStateFixture> | null = null,
  ) {
    const profile = parseShadowExecutionProfileEnvelope(f.context.executionProfileEnvelope);
    const observed = JSON.parse((terminal?.input.currentOriginEnvelope ?? f.persistence.fixture.input.originEnvelope).canonicalPayload) as AuditFixtureObject;
    observed.capturedAt = f.now;
    return { kind: "u04-evaluation-read-result-v1", version: 1, operation,
      requestDigest: f.requestEnvelope.digest, call: call as unknown as AuditFixtureObject, observedAt: f.now,
      guard: { mode: "same_statement_logical_equality", observedOriginEnvelope: fixtureEnvelope(observed, "baseline", "pg-jsonb-text-v1"),
        controls: terminal?.f.members.map(member => ({ documentId: member.documentId,
          controlEnvelope: (JSON.parse(member.memberReceiptEnvelope.canonicalPayload) as AuditFixtureObject).terminalControlEnvelope })) ?? [] },
      environment: { reviewedEnvironmentDigest: profile.sql.bytes.envelope.digest,
        operation: profile.sql.capture.payload.operations.find(entry => entry.operation === operation) as unknown as AuditFixtureObject },
      result, sources } as AuditFixtureObject;
  }

  function read(
    f: ReturnType<typeof u04EvaluationAuthorityFixture>, call: ReturnType<typeof prepareShadowEvaluationCallV1>,
    payload: AuditFixtureObject, terminal: ReturnType<typeof terminalStateFixture> | null = null,
  ) {
    const candidateEvidence = terminal === null ? null : {
      readback: terminal.f.readback, context: terminal.f.context, stateInput: terminal.input,
      stateAdmission: terminal.f.persistence.fixture.admission, candidateRows: terminal.bindings,
    };
    return readShadowEvaluationResultV1(fixtureEnvelope(payload, "evaluation_report", "pg-jsonb-text-v1"),
      f.requestEnvelope, f.authorityEnvelope, f.context, f.now, "2024-03-01T00:00:02.000000Z", call, candidateEvidence);
  }

  function baselineCall(operation: typeof u04EvaluationAuthoritySqlOperationsFixture[number], args: AuditFixtureObject) {
    const scope = ((baseline.request.caseScopes as AuditFixtureObject).scopes as AuditFixtureObject[])[0]!;
    return prepareShadowEvaluationCallV1(baseline.requestEnvelope, baseline.authorityEnvelope, baseline.context, baseline.now,
      operation, scope.case, 0, args);
  }

  function originRow(f: ReturnType<typeof u04EvaluationAuthorityFixture>, table: string, documentId: string) {
    const origin = JSON.parse(f.persistence.fixture.input.originEnvelope.canonicalPayload) as AuditFixtureObject;
    const envelope = (fixtureGet(origin, ["rows", table]) as AuditFixtureObject[]).find(value =>
      (JSON.parse(value.canonicalPayload as string) as AuditFixtureObject)[table === "documents" ? "id" : "document_id"] === documentId)!;
    return { envelope, row: JSON.parse(envelope.canonicalPayload as string) as AuditFixtureObject };
  }

  function originRef(owner: string, envelope: AuditFixtureObject, rowId: AuditFixtureJson) {
    return { tag: "origin_row", owner, rowId, rowDigest: envelope.digest! } as AuditFixtureObject;
  }

  function corpusFixture(terms: string[], resultTerms: string[]) {
    const call = baselineCall("corpus_terms", { terms });
    const origin = JSON.parse(baseline.persistence.fixture.input.originEnvelope.canonicalPayload) as AuditFixtureObject;
    const rows = fixtureGet(origin, ["rows"]) as AuditFixtureObject;
    const refs = [
      ...(rows.documents as AuditFixtureObject[]).map(envelope => {
        const row = JSON.parse(envelope.canonicalPayload as string) as AuditFixtureObject;
        return originRef("document", envelope, row.id!);
      }),
      ...(rows.document_chunks as AuditFixtureObject[]).map(envelope => {
        const row = JSON.parse(envelope.canonicalPayload as string) as AuditFixtureObject;
        return originRef("chunk", envelope, row.id!);
      }),
    ];
    const result = resultTerms.map(term => ({ term, has_ts_signal: true, title_doc_count: 0,
      chunk_present: true, total_doc_count: baseline.persistence.fixture.profile.documentIds.length }));
    const sources = result.map((_row, index) => ({ part: "rows", index, view: null,
      refs: structuredClone(refs), relationships: [] }));
    return { call, payload: resultPayload(baseline, "corpus_terms", call, result, sources) };
  }

  it("refuses erased corpus-term rows for nonempty fixed inputs", () => {
    const v = corpusFixture([" Falls ", "dose", "falls", ""], []);
    expect(() => read(baseline, v.call, v.payload)).toThrow("Invalid shadow comparison record.");
  });

  it("refuses substituted corpus-term rows", () => {
    const v = corpusFixture([" Falls ", "dose", "falls", ""], ["dose", "other"]);
    expect(() => read(baseline, v.call, v.payload)).toThrow("Invalid shadow comparison record.");
  });

  it("refuses duplicate corpus-term rows", () => {
    const v = corpusFixture([" Falls ", "dose", "falls", ""], ["dose", "falls", "falls"]);
    expect(() => read(baseline, v.call, v.payload)).toThrow("Invalid shadow comparison record.");
  });

  it("accepts the valid empty corpus-term population", () => {
    const v = corpusFixture([], []);
    expect(read(baseline, v.call, v.payload).result).toEqual([]);
  });

  function baselineDocumentFixture(returnedDocumentIndex = 0, explicitDocumentIndexes = [0]) {
    const documentIds = baseline.persistence.fixture.profile.documentIds as string[];
    const call = baselineCall("documents", { ids: explicitDocumentIndexes.map(index => documentIds[index]!) });
    const source = (baseline.request.sourceBindings as AuditFixtureObject[])[returnedDocumentIndex]!;
    const { envelope, row } = originRow(baseline, "documents", String(source.documentId));
    const result = [{ id: row.id!, title: row.title!, file_name: row.file_name!, metadata: row.metadata!,
      owner_id: row.owner_id!, status: row.status! }];
    const sources = [{ part: "rows", index: 0, view: { tag: "baseline", source },
      refs: [originRef("document", envelope, row.id!)], relationships: [] }];
    return { call, payload: resultPayload(baseline, "documents", call, result, sources), source };
  }

  it("refuses an extra independently valid source ref", () => {
    const v = baselineDocumentFixture();
    const chunk = originRow(baseline, "document_chunks", String(v.source.documentId));
    ((v.payload.sources as AuditFixtureObject[])[0]!.refs as AuditFixtureObject[])
      .push(originRef("chunk", chunk.envelope, chunk.row.id!));
    expect(() => read(baseline, v.call, v.payload)).toThrow("Invalid shadow comparison record.");
  });

  it("refuses a duplicate independently valid source ref", () => {
    const v = baselineDocumentFixture();
    const refs = (v.payload.sources as AuditFixtureObject[])[0]!.refs as AuditFixtureObject[];
    refs.push(structuredClone(refs[0]!));
    expect(() => read(baseline, v.call, v.payload)).toThrow("Invalid shadow comparison record.");
  });

  it("refuses a result ID inside the case but outside the explicit ID arguments", () => {
    const v = baselineDocumentFixture(1, [0]);
    expect(() => read(baseline, v.call, v.payload)).toThrow("Invalid shadow comparison record.");
  });

  function candidateDeepFixture() {
    const terminal = candidateTerminal;
    const f = u04EvaluationAuthorityFixture("candidate", terminal.f);
    const member = terminal.f.members[0]!;
    const source = member.binding.source as AuditFixtureObject;
    const scope = ((f.request.caseScopes as AuditFixtureObject).scopes as AuditFixtureObject[])[0]!;
    const vector = `[${Array.from({ length: 1536 }, (_value, index) => index === 0 ? "1" : "0").join(",")}]`;
    const args = { query_embedding: vector, query_text: "Synthetic unit", match_count: 12,
      min_similarity: 0, document_filters: [source.documentId!] };
    const call = prepareShadowEvaluationCallV1(f.requestEnvelope, f.authorityEnvelope, f.context, f.now,
      "index_units", scope.case, 0, args);
    const unit = member.projectionItems!.unit;
    const result = [{ id: unit.id!, document_id: unit.document_id!, source_chunk_id: unit.source_chunk_id!,
      source_image_id: unit.source_image_id!, unit_type: unit.unit_type!, title: unit.title!, content: unit.content!,
      page_start: unit.page_start!, page_end: unit.page_end!, heading_path: unit.heading_path!, normalized_terms: unit.normalized_terms!,
      source_span: unit.source_span!, quality_score: unit.quality_score!, extraction_mode: unit.extraction_mode!,
      similarity: 1, text_rank: 1, hybrid_score: 1, metadata: unit.metadata! }];
    const sources = [{ part: "rows", index: 0, view: structuredClone(member.projectionItems!.deepBinding),
      refs: [member.deepUnitDisposition!.artifactRef!, member.chunkDisposition.artifactRef!, member.pageDisposition.artifactRef!],
      relationships: structuredClone(member.deepUnitDisposition!.relationships) }];
    return { f, terminal, call, payload: resultPayload(f, "index_units", call, result, sources, terminal) };
  }

  it("accepts a candidate deep result under its exact independently declared D view", () => {
    const v = candidateDeepFixture();
    expect(read(v.f, v.call, v.payload, v.terminal).kind).toBe("shadow-evaluation-result-validated");
  });

  it("refuses a candidate deep result rebound to the wrong D", () => {
    const v = candidateDeepFixture();
    fixtureSet(v.payload, ["sources", 0, "view", "artifactGenerationId"], auditFixtureUuid(999));
    expect(() => read(v.f, v.call, v.payload, v.terminal)).toThrow("Invalid shadow comparison record.");
  });

  it("refuses a candidate deep result rebound to a foreign owner", () => {
    const v = candidateDeepFixture();
    fixtureSet(v.payload, ["sources", 0, "view", "source", "ownerId"], auditFixtureUuid(998));
    expect(() => read(v.f, v.call, v.payload, v.terminal)).toThrow("Invalid shadow comparison record.");
  });

  function candidateSummaryFixture() {
    const terminal = candidateTerminal;
    const f = u04EvaluationAuthorityFixture("candidate", terminal.f);
    const member = terminal.f.members[0]!;
    const source = member.binding.source as AuditFixtureObject;
    const scope = ((f.request.caseScopes as AuditFixtureObject).scopes as AuditFixtureObject[])[0]!;
    const call = prepareShadowEvaluationCallV1(f.requestEnvelope, f.authorityEnvelope, f.context, f.now,
      "related_documents", scope.case, 0, { document_ids: [source.documentId!] });
    const originalDocument = originRow(f, "documents", String(source.documentId));
    const projection = member.projectionRow;
    const summary = member.projectionItems!.summary;
    const label = member.projectionItems!.label;
    const documentCountsRef = { tag: "candidate_projection", slot: "document_counts", itemId: null,
      payloadDigest: terminal.f.pgEnvelope(projection.document_counts!, "projection").digest };
    const roots = [originRef("document", originalDocument.envelope, originalDocument.row.id!),
      member.workerDisposition.artifactRef!, documentCountsRef, member.summaryDisposition!.artifactRef!,
      member.labelDisposition!.artifactRef!, member.chunkDisposition.artifactRef!, member.pageDisposition.artifactRef!,
      member.imageDisposition.artifactRef!];
    const relationships = [...new Map([
      ...(member.summaryDisposition!.relationships as AuditFixtureObject[]),
      ...(member.labelDisposition!.relationships as AuditFixtureObject[]),
    ].map(relationship => [encodeShadowNodeJsonCanonicalPayload(relationship), relationship])).values()];
    const result = [{ document_id: source.documentId!, labels: [label], summary: summary.summary! }];
    const sources = [{ part: "rows", index: 0, view: structuredClone(member.binding), refs: roots, relationships }];
    return { f, terminal, call, payload: resultPayload(f, "related_documents", call, result, sources, terminal) };
  }

  it("accepts complete candidate summary projection relationships", () => {
    const v = candidateSummaryFixture();
    expect(read(v.f, v.call, v.payload, v.terminal).kind).toBe("shadow-evaluation-result-validated");
  });

  it("refuses omitted candidate summary projection relationships", () => {
    const v = candidateSummaryFixture();
    const source = (v.payload.sources as AuditFixtureObject[])[0]!;
    source.relationships = structuredClone(candidateTerminal.f.members[0]!.labelDisposition!.relationships);
    expect(() => read(v.f, v.call, v.payload, v.terminal)).toThrow("Invalid shadow comparison record.");
  });
});

describe("U04 candidate case report semantic consumer", () => {
  // Reuse the unchanged complete sealed source; each test gets fresh report/observation objects.
  let sealedSource: ReturnType<typeof terminalStateFixture> | undefined;
  let admittedSource: ReturnType<typeof u04EvaluationAuthorityFixture> | undefined;
  function fixture(quality = false) {
    const terminal = quality ? terminalStateFixture("evaluate", true) : sealedSource ??= terminalStateFixture("evaluate");
    const f = quality ? u04EvaluationAuthorityFixture("candidate", terminal.f) : admittedSource ??= u04EvaluationAuthorityFixture("candidate", terminal.f);
    const generatedAt = f.now, startedAt = "2024-03-01T00:00:02.000000Z";
    const finishedAt = "2024-03-01T00:00:03.000000Z";
    const profile = parseShadowExecutionProfileEnvelope(f.context.executionProfileEnvelope);
    const observed = JSON.parse(terminal.input.currentOriginEnvelope.canonicalPayload) as AuditFixtureObject;
    observed.capturedAt = startedAt;
    const observedOriginEnvelope = fixtureEnvelope(observed, "baseline", "pg-jsonb-text-v1");
    const observation = { observedAt: startedAt,
      guard: { mode: "same_statement_logical_equality", observedOriginEnvelope,
        controls: terminal.f.members.map(member => ({ documentId: member.documentId,
          controlEnvelope: (JSON.parse(member.memberReceiptEnvelope.canonicalPayload) as AuditFixtureObject).terminalControlEnvelope })) },
      environment: { reviewedEnvironmentDigest: profile.sql.bytes.envelope.digest,
        operation: structuredClone(profile.sql.capture.payload.operations.find(entry => entry.operation === "documents")!) } };
    const candidateEvidence = { readback: terminal.f.readback, context: terminal.f.context,
      stateInput: terminal.input, stateAdmission: terminal.f.persistence.fixture.admission,
      candidateRows: terminal.bindings };
    const report: AuditFixtureObject = JSON.parse(JSON.stringify(terminal.f.persistence.fixture.casePayload));
    fixtureSet(report, ["inputBinding"], JSON.parse(JSON.stringify({ requestEnvelope: f.requestEnvelope, authorityEnvelope: f.authorityEnvelope })) as AuditFixtureObject);
    fixtureSet(report, ["report", "generated_at"], generatedAt);
    fixtureSet(report, ["report", "run_context"], structuredClone((f.authority.runnerPolicy as AuditFixtureObject).runContext!));
    const searchResults = terminal.f.members.map((member, index) => {
      const document = terminal.f.persistence.fixture.data[index]!.document;
      const chunk = member.chunkStored;
      const workerMetadata = member.projectionRow.worker_metadata as AuditFixtureObject;
      const unit = member.projectionItems!.unit;
      const label = member.projectionItems!.label;
      const summary = member.projectionItems!.summary;
      const quality = member.projectionRow.quality as AuditFixtureObject;
      return { id: chunk.id!, document_id: member.documentId, title: document.title!, file_name: document.file_name!,
        page_number: chunk.page_number!, chunk_index: chunk.chunk_index!, section_heading: chunk.section_heading!,
        content: chunk.content!, image_ids: chunk.image_ids!, images: [], similarity: 1,
        source_metadata: normalizeOptionalSourceMetadata({ ...(document.metadata as AuditFixtureObject), ...workerMetadata }),
        document_labels: [structuredClone(label)], document_summary: summary.summary!,
        indexing_quality: { document_id: quality.document_id!, owner_id: quality.owner_id!,
          quality_score: quality.quality_score!, extraction_quality: quality.extraction_quality!,
          metrics: structuredClone(quality.metrics!), issues: structuredClone(quality.issues!),
          updated_at: quality.updated_at! },
        ...(index === 0 ? { index_unit: { id: unit.id!, unit_type: unit.unit_type!, title: unit.title!, content: unit.content!,
          source_chunk_id: unit.source_chunk_id!, source_image_id: unit.source_image_id!, page_start: unit.page_start!,
          page_end: unit.page_end!, heading_path: unit.heading_path!, normalized_terms: unit.normalized_terms!,
          source_span: unit.source_span!, quality_score: unit.quality_score!, extraction_mode: unit.extraction_mode!,
          metadata: unit.metadata! } } : {}) };
    });
    fixtureSet(report, ["executions", 0, "searchResults"], JSON.parse(JSON.stringify(searchResults)) as AuditFixtureJson);
    if ((report.executions as AuditFixtureObject[]).length > 1) {
      fixtureSet(report, ["executions", 1, "searchResults"], JSON.parse(JSON.stringify(searchResults)) as AuditFixtureJson);
      fixtureSet(report, ["executions", 1, "answer", "sources"], JSON.parse(JSON.stringify(searchResults)) as AuditFixtureJson);
    }
    fixtureSet(report, ["report", "retrieval", "results", 0, "resultCount"], searchResults.length);
    fixtureSet(report, ["report", "retrieval", "results", 0, "topResults"], searchResults.map((result, index) => ({
      rank: index + 1, title: result.title, file_name: result.file_name, chunk_id: result.id, page_number: result.page_number,
      hybrid_score: null, similarity: 1, text_rank: null, rrf_score: null, relevanceGrade: 1,
      matchedDeclaredSignals: ["synthetic"], content_preview: String(result.content).replace(/\s+/g, " ").trim().slice(0, 220),
    })));
    fixtureSet(report, ["report", "retrieval", "source_governance", "total_top_results"], searchResults.length);
    const read = () => readShadowCandidateCaseReportV1(fixtureEnvelope(report, "evaluation_report"),
      f.requestEnvelope, f.authorityEnvelope, f.context, observation, "documents",
      startedAt, finishedAt, candidateEvidence);
    return { terminal, f, report, observation, candidateEvidence, searchResults, read, generatedAt, startedAt, finishedAt };
  }

  it("accepts the real complete sealed-wave candidate report and exposes its validated comparison inputs", () => {
    const v = fixture();
    expect(prepareShadowEvaluationRuntimeAdmissionV1(v.f.requestEnvelope, v.f.authorityEnvelope,
      v.f.context, v.startedAt, v.candidateEvidence).kind).toBe("shadow-evaluation-request-validated");
    const result = v.read();
    expect(result.kind).toBe("shadow-candidate-case-report-validated");
    expect(Date.parse(v.generatedAt)).toBeLessThan(Date.parse(v.startedAt));
    expect(result.candidateCaseReport.payload.executions[0]!.searchResults[0]!.content)
      .toBe(v.terminal.f.members[0]!.chunkStored.content);
    expect(result.baselineCaseReport.envelope).toEqual(v.terminal.f.persistence.fixture.input.caseResultsEnvelope);
    expect(result.configuration.envelope).toEqual(v.terminal.f.persistence.fixture.profile.configuration);
    expect(result.plan.envelope).toEqual(v.f.persistence.parameters.p_plan);
    expect(result.waveReceipt.envelope).toEqual(v.terminal.f.waveReceiptEnvelope);
    expect(result.request.envelope).toEqual(v.f.requestEnvelope);
  });

  it("dispatches promotion only from the full validated U04 stage and evaluation identities", async () => {
    const v = fixture(true);
    const reportEnvelope = fixtureEnvelope(v.report, "evaluation_report");
    const stage = readShadowReindexStageV1(v.terminal.f.readback, v.terminal.f.context);
    const evaluation = evaluateShadowReindexV1(
      reportEnvelope,
      v.f.requestEnvelope,
      v.f.authorityEnvelope,
      v.f.context,
      v.observation,
      "documents",
      v.startedAt,
      v.finishedAt,
      v.candidateEvidence,
    );
    expect(evaluation.decision.decision, evaluation.decision.failures.join("\n")).toBe("GO");
    const plan = evaluation.evidence.plan;
    const wave = evaluation.evidence.waveReceipt;
    const technicalEvidence = plan.payload.plan.documents.map((document, index) => ({
      receiptId: auditFixtureV4Uuid(900 + index),
      version: "document-generation-technical-evidence-v1" as const,
      jobId: auditFixtureV4Uuid(920 + index),
      documentId: document.documentId,
      generationId: plan.payload.plan.candidateGenerationId,
      admissionEventId: auditFixtureV4Uuid(940 + index),
      policyVersion: plan.payload.plan.sourcePolicyVersion,
      stateDigest: `sha256:${document.expectedStateDigest}`,
      evidenceDigest: fixtureSha(`technical evidence ${index}`),
      verdict: "activate" as const,
      codes: [] as const,
      receiptDigest: fixtureSha(`technical receipt ${index}`),
    }));
    const authorization = {
      version: 1 as const,
      operation: "promote" as const,
      targetProjectRef: plan.payload.plan.targetProjectRef,
      candidateGenerationId: plan.payload.plan.candidateGenerationId,
      planDigest: plan.envelope.digest,
      stageReceiptDigest: wave.envelope.digest,
      evaluationReportDigest: evaluation.report.digest,
      recoveryEvidenceDigest: wave.payload.recoveryEvidenceDigest,
      stageAuthorizationDigest: wave.payload.operationManifestDigest,
      expectedDocumentIds: plan.payload.plan.documents.map(document => document.documentId),
      expectedDocumentCount: plan.payload.plan.documents.length,
      expectedTechnicalEvidenceReceiptDigests: technicalEvidence.map(receipt => receipt.receiptDigest),
      authorizedAt: "2024-03-01T00:00:04.000Z",
      expiresAt: "2024-03-01T00:10:00.000Z",
      retainedUntil: "2024-04-01T00:00:00.000Z",
      confirmationSha256: fixtureSha("independent promote confirmation"),
    };
    const promoteAuthorizationDigest = fixtureSha(encodeShadowNodeJsonCanonicalPayload(authorization));
    const readiness = {
      version: 1 as const,
      projectRef: plan.payload.plan.targetProjectRef,
      candidateGenerationId: plan.payload.plan.candidateGenerationId,
      planDigest: plan.envelope.digest,
      stageReceiptDigest: wave.envelope.digest,
      evaluationReportDigest: evaluation.report.digest,
      recoveryEvidenceDigest: wave.payload.recoveryEvidenceDigest,
      stageAuthorizationDigest: wave.payload.operationManifestDigest,
      decision: "GO" as const,
      documents: plan.payload.plan.documents.map((document, index) => ({
        ...(() => {
          const memberReceipt = JSON.parse(
            wave.payload.members[index]!.memberReceiptEnvelope.canonicalPayload,
          ) as AuditFixtureObject;
          const authorityDigest = fixtureGet(memberReceipt, ["binding", "source", "authorityDigest"]) as string;
          return { stageAuthorityDigest: authorityDigest, actualAuthorityDigest: authorityDigest };
        })(),
        documentId: document.documentId,
        baselineGenerationId: document.baselineGenerationId,
        currentDocumentStatus: "indexed" as const,
        currentGenerationId: document.baselineGenerationId,
        expectedStateDigest: document.expectedStateDigest,
        actualStateDigest: document.expectedStateDigest,
        stageMemberReceiptDigest: wave.payload.members[index]!.memberReceiptEnvelope.digest,
      })),
      technicalEvidence,
      authorization,
      promoteAuthorizationDigest,
      trustedNow: "2024-03-01T00:05:00.000Z",
    };
    const promotionPayload = {
      version: 1 as const,
      kind: "document-generation-promotion-v1" as const,
      operationId: auditFixtureV4Uuid(980),
      projectRef: readiness.projectRef,
      candidateGenerationId: readiness.candidateGenerationId,
      planDigest: readiness.planDigest,
      stageReceiptDigest: readiness.stageReceiptDigest,
      evaluationReportDigest: readiness.evaluationReportDigest,
      recoveryEvidenceDigest: readiness.recoveryEvidenceDigest,
      stageAuthorizationDigest: readiness.stageAuthorizationDigest,
      promoteAuthorizationDigest,
      technicalEvidenceReceiptDigests: technicalEvidence.map(receipt => receipt.receiptDigest),
      transitions: readiness.documents.map((document, index) => ({
        documentId: document.documentId,
        fromGenerationId: document.baselineGenerationId,
        toGenerationId: readiness.candidateGenerationId,
        previousServingSnapshotDigest: fixtureSha(`previous snapshot ${index}`),
        candidateServingSnapshotDigest: fixtureSha(`candidate snapshot ${index}`),
        retainedUntil: authorization.retainedUntil,
      })),
      promotedAt: readiness.trustedNow,
    };
    const promotionReceipt = {
      ...promotionPayload,
      receiptDigest: fixtureSha(encodeShadowNodeJsonCanonicalPayload(promotionPayload)),
    };
    const rpc = vi.fn(async () => ({ data: promotionReceipt, error: null }));

    await expect(
      promoteShadowDocumentGenerationV1(
        {
          readiness,
          validatedStage: stage,
          validatedEvaluation: evaluation,
          authorizationManifest: { authorization, promoteAuthorizationDigest },
        },
        { projectRef: readiness.projectRef, client: { rpc } },
      ),
    ).resolves.toEqual(promotionReceipt);
    expect(rpc).toHaveBeenCalledWith("promote_shadow_document_generation", {
      p_plan: plan.envelope,
      p_stage_receipt: wave.envelope,
      p_evaluation_report: evaluation.report,
      p_authorization_manifest: { authorization, promoteAuthorizationDigest },
    });
    const stalePromotionPayload = { ...promotionPayload, promotedAt: "2024-03-01T00:04:59.000Z" };
    rpc.mockResolvedValueOnce({
      data: {
        ...stalePromotionPayload,
        receiptDigest: fixtureSha(encodeShadowNodeJsonCanonicalPayload(stalePromotionPayload)),
      },
      error: null,
    });
    await expect(
      promoteShadowDocumentGenerationV1(
        {
          readiness,
          validatedStage: stage,
          validatedEvaluation: evaluation,
          authorizationManifest: { authorization, promoteAuthorizationDigest },
        },
        { projectRef: readiness.projectRef, client: { rpc } },
      ),
    ).rejects.toThrow(/clock|time/i);
    await expect(
      promoteShadowDocumentGenerationV1(
        {
          readiness,
          validatedStage: { ...stage },
          validatedEvaluation: evaluation,
          authorizationManifest: { authorization, promoteAuthorizationDigest },
        },
        { projectRef: readiness.projectRef, client: { rpc } },
      ),
    ).rejects.toThrow(/full validated U04/i);
  });

  it("closes zero-read admission for both phases", () => {
    const candidate = fixture();
    expect(() => prepareShadowEvaluationRuntimeAdmissionV1(candidate.f.requestEnvelope, candidate.f.authorityEnvelope,
      candidate.f.context, candidate.startedAt)).toThrow("Invalid shadow comparison record.");
    const baseline = u04EvaluationAuthorityFixture("baseline");
    expect(() => prepareShadowEvaluationRuntimeAdmissionV1(baseline.requestEnvelope, baseline.authorityEnvelope,
      baseline.context, baseline.now, candidate.candidateEvidence)).toThrow("Invalid shadow comparison record.");
  });

  it.each(["phase", "content", "nested summary", "guard", "policy", "deep generation",
    "unit association", "document obligations", "failure codes"] as const)(
    "refuses a complete-looking report with swapped %s evidence", fault => {
      const v = fixture();
      if (fault === "phase") {
        const baseline = u04EvaluationAuthorityFixture("baseline");
        v.report.inputBinding = { requestEnvelope: baseline.requestEnvelope, authorityEnvelope: baseline.authorityEnvelope };
      }
      if (fault === "content") fixtureSet(v.report, ["executions", 0, "searchResults", 0, "content"], "Substituted C content.");
      if (fault === "nested summary") fixtureSet(v.report,
        ["executions", 0, "searchResults", 0, "document_summary"], "Substituted candidate summary.");
      if (fault === "guard") v.observation.guard.controls.pop();
      if (fault === "deep generation") fixtureSet(v.report,
        ["executions", 0, "searchResults", 0, "index_unit", "metadata", "artifact_generation_id"], auditFixtureUuid(999));
      if (fault === "unit association") fixtureSet(v.report,
        ["executions", 0, "searchResults", 0, "index_unit", "source_chunk_id"],
        v.terminal.f.members[1]!.chunkStored.id);
      if (fault === "document obligations") fixtureSet(v.report,
        ["executions", 0, "documentResults"], []);
      if (fault === "failure codes") fixtureSet(v.report,
        ["executions", 0, "documentResults", 0, "failureCodes"], ["document_not_retrieved"]);
      if (fault === "policy") {
        const binding = v.report.inputBinding as AuditFixtureObject;
        const authority = JSON.parse(String((binding.authorityEnvelope as AuditFixtureObject).canonicalPayload)) as AuditFixtureObject;
        fixtureSet(authority, ["runnerPolicy", "costRates", "input"], 999);
        fixtureSet(authority, ["manifest", "confirmationSha256"], u04EvaluationAuthorityConfirmationFixture(authority));
        const authorityEnvelope = fixtureEnvelope(authority, "plan");
        const request = JSON.parse(String((binding.requestEnvelope as AuditFixtureObject).canonicalPayload)) as AuditFixtureObject;
        request.authorityEnvelopeDigest = authorityEnvelope.digest;
        binding.authorityEnvelope = authorityEnvelope;
        binding.requestEnvelope = fixtureEnvelope(request, "u04-evaluation-request-v1");
      }
      expect(v.read).toThrow("Invalid shadow comparison record.");
    });
});
