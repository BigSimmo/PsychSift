import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

const projectRef = "sjrfecxgysukkwxsowpy";
const documentA = "11111111-1111-4111-8111-111111111111";
const documentB = "22222222-2222-4222-8222-222222222222";
const baselineA = "33333333-3333-4333-8333-333333333333";
const baselineB = "44444444-4444-4444-8444-444444444444";
const candidate = "55555555-5555-4555-8555-555555555555";
const digest = (character: string) => `sha256:${character.repeat(64)}`;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

function canonicalDigest(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex")}`;
}

type LifecycleModule = {
  assertPromotableShadowGeneration?: (input: unknown) => unknown;
  planDocumentGenerationCleanup?: (input: unknown) => unknown;
  assertDocumentGenerationPromotionReceipt?: (input: unknown) => unknown;
  assertDocumentGenerationLifecycleRollbackReceipt?: (input: unknown) => unknown;
  assertDocumentGenerationLifecycleRollbackPair?: (promotion: unknown, rollback: unknown) => unknown;
};

async function lifecycleModule(): Promise<LifecycleModule> {
  return import("../src/lib/reindex-pipeline") as Promise<LifecycleModule>;
}

function requiredFunction<T>(value: T | undefined, name: string): NonNullable<T> {
  expect(value, `${name} must be exported`).toBeTypeOf("function");
  if (typeof value !== "function") throw new Error(`${name} must be exported`);
  return value as NonNullable<T>;
}

function promotionFixture() {
  const technicalEvidence = [
    {
      receiptId: "66666666-6666-4666-8666-666666666666",
      version: "document-generation-technical-evidence-v1",
      jobId: "77777777-7777-4777-8777-777777777777",
      documentId: documentA,
      generationId: candidate,
      admissionEventId: "88888888-8888-4888-8888-888888888888",
      policyVersion: "source-policy-v1",
      stateDigest: digest("1"),
      evidenceDigest: digest("3"),
      verdict: "activate",
      codes: [],
      receiptDigest: digest("5"),
    },
    {
      receiptId: "99999999-9999-4999-8999-999999999999",
      version: "document-generation-technical-evidence-v1",
      jobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      documentId: documentB,
      generationId: candidate,
      admissionEventId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      policyVersion: "source-policy-v1",
      stateDigest: digest("2"),
      evidenceDigest: digest("4"),
      verdict: "activate",
      codes: [],
      receiptDigest: digest("6"),
    },
  ];
  const authorization = {
    version: 1,
    operation: "promote",
    targetProjectRef: projectRef,
    candidateGenerationId: candidate,
    planDigest: digest("a"),
    stageReceiptDigest: digest("b"),
    evaluationReportDigest: digest("c"),
    recoveryEvidenceDigest: digest("d"),
    stageAuthorizationDigest: digest("e"),
    expectedDocumentIds: [documentA, documentB],
    expectedDocumentCount: 2,
    expectedTechnicalEvidenceReceiptDigests: technicalEvidence.map((receipt) => receipt.receiptDigest),
    authorizedAt: "2026-09-13T01:00:00.000Z",
    expiresAt: "2026-09-13T01:10:00.000Z",
    retainedUntil: "2026-10-13T01:00:00.000Z",
    confirmationSha256: digest("9"),
  };
  return {
    version: 1,
    projectRef,
    candidateGenerationId: candidate,
    planDigest: digest("a"),
    stageReceiptDigest: digest("b"),
    evaluationReportDigest: digest("c"),
    recoveryEvidenceDigest: digest("d"),
    stageAuthorizationDigest: digest("e"),
    decision: "GO",
    technicalEvidence,
    documents: [
      {
        documentId: documentA,
        baselineGenerationId: null,
        currentDocumentStatus: "indexed",
        currentGenerationId: null,
        expectedStateDigest: "1".repeat(64),
        actualStateDigest: "1".repeat(64),
        stageMemberReceiptDigest: digest("f"),
        stageAuthorityDigest: digest("a"),
        actualAuthorityDigest: digest("a"),
      },
      {
        documentId: documentB,
        baselineGenerationId: baselineB,
        currentDocumentStatus: "indexed",
        currentGenerationId: baselineB,
        expectedStateDigest: "2".repeat(64),
        actualStateDigest: "2".repeat(64),
        stageMemberReceiptDigest: digest("0"),
        stageAuthorityDigest: digest("b"),
        actualAuthorityDigest: digest("b"),
      },
    ],
    authorization,
    promoteAuthorizationDigest: canonicalDigest(authorization),
    trustedNow: "2026-09-13T01:05:00.000Z",
  };
}

describe("document generation promotion lifecycle", () => {
  it("requires a complete promote authorization in addition to a GO evaluation", async () => {
    const assertPromotable = requiredFunction(
      (await lifecycleModule()).assertPromotableShadowGeneration,
      "assertPromotableShadowGeneration",
    );
    const input = promotionFixture();

    expect(assertPromotable(input)).toMatchObject({
      projectRef,
      candidateGenerationId: candidate,
      promoteAuthorizationDigest: input.promoteAuthorizationDigest,
    });
    expect(() => assertPromotable({ ...input, authorization: undefined })).toThrow(/authoriz/i);
    expect(() => assertPromotable({ ...input, promoteAuthorizationDigest: undefined })).toThrow(/authoriz|digest/i);
  });

  it("accepts a legacy G0 baseline only for an indexed document with the exact null pointer", async () => {
    const assertPromotable = requiredFunction(
      (await lifecycleModule()).assertPromotableShadowGeneration,
      "assertPromotableShadowGeneration",
    );

    expect(assertPromotable(promotionFixture())).toMatchObject({ candidateGenerationId: candidate });
  });

  it("requires an already-published document, its exact baseline pointer, and every retained binding", async () => {
    const assertPromotable = requiredFunction(
      (await lifecycleModule()).assertPromotableShadowGeneration,
      "assertPromotableShadowGeneration",
    );
    const input = promotionFixture();

    for (const changed of [
      { ...input, planDigest: digest("7") },
      { ...input, stageReceiptDigest: digest("7") },
      { ...input, evaluationReportDigest: digest("7") },
      { ...input, recoveryEvidenceDigest: digest("7") },
      { ...input, stageAuthorizationDigest: digest("7") },
      {
        ...input,
        documents: input.documents.map((row, index) =>
          index === 0 ? { ...row, actualAuthorityDigest: digest("7") } : row,
        ),
      },
      { ...input, decision: "NO_GO" },
      { ...input, technicalEvidence: input.technicalEvidence.slice(0, 1) },
      {
        ...input,
        technicalEvidence: input.technicalEvidence.map((receipt, index) =>
          index === 0 ? { ...receipt, verdict: "technical_review", codes: ["generation_incomplete"] } : receipt,
        ),
      },
      {
        ...input,
        technicalEvidence: input.technicalEvidence.map((receipt, index) =>
          index === 0 ? { ...receipt, generationId: baselineA } : receipt,
        ),
      },
      {
        ...input,
        documents: input.documents.map((row, index) =>
          index === 0 ? { ...row, currentDocumentStatus: "staging" } : row,
        ),
      },
      {
        ...input,
        documents: input.documents.map((row, index) =>
          index === 1 ? { ...row, currentGenerationId: baselineA } : row,
        ),
      },
      { ...input, documents: input.documents.map((row, index) => (index === 0 ? { ...row, actualStateDigest: "3".repeat(64) } : row)) },
      { ...input, authorization: { ...input.authorization, expectedDocumentIds: [documentA] } },
    ]) {
      expect(() => assertPromotable(changed)).toThrow();
    }
  });

  it("rejects malformed scalar identities instead of relying on TypeScript casts", async () => {
    const assertPromotable = requiredFunction(
      (await lifecycleModule()).assertPromotableShadowGeneration,
      "assertPromotableShadowGeneration",
    );
    const input = promotionFixture();

    expect(() => assertPromotable({ ...input, projectRef: "wrong project ref" })).toThrow();
    expect(() => assertPromotable({ ...input, candidateGenerationId: "candidate" })).toThrow();
    expect(() => assertPromotable({ ...input, planDigest: "a".repeat(64) })).toThrow();
    expect(() => assertPromotable({ ...input, documents: [...input.documents, input.documents[0]] })).toThrow();
    expect(() =>
      assertPromotable({
        ...input,
        authorization: { ...input.authorization, retainedUntil: input.trustedNow },
      }),
    ).toThrow(/retention|retainedUntil|deadline/i);
  });
});

describe("exact generation cleanup planning", () => {
  it("stable-sorts exact pairs and binds their exact count and complete plan digest", async () => {
    const planCleanup = requiredFunction(
      (await lifecycleModule()).planDocumentGenerationCleanup,
      "planDocumentGenerationCleanup",
    );
    const common = {
      version: 1,
      projectRef,
      createdAt: "2026-09-13T02:00:00.000Z",
      trustedNow: "2026-09-13T02:00:00.000Z",
    };
    const rows = [
      { documentId: documentB, generationId: baselineB, state: "abandoned", activeGenerationId: candidate, retainedUntil: null },
      { documentId: documentA, generationId: baselineA, state: "retained", activeGenerationId: candidate, retainedUntil: "2026-09-13T01:59:59.999Z" },
    ];

    const planned = planCleanup({ ...common, rows }) as {
      targets: readonly { documentId: string; generationId: string }[];
      expectedCount: number;
      digest: string;
    };
    const reordered = planCleanup({ ...common, rows: [...rows].reverse() });

    expect(planned.targets).toEqual([
      { documentId: documentA, generationId: baselineA },
      { documentId: documentB, generationId: baselineB },
    ]);
    expect(planned.expectedCount).toBe(2);
    expect(planned.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(reordered).toEqual(planned);
    expect(Object.isFrozen(planned)).toBe(true);
    expect(Object.isFrozen(planned.targets)).toBe(true);
  });

  it("refuses active, newly referenced, staged, and retention-protected rows", async () => {
    const planCleanup = requiredFunction(
      (await lifecycleModule()).planDocumentGenerationCleanup,
      "planDocumentGenerationCleanup",
    );
    const base = {
      version: 1,
      projectRef,
      createdAt: "2026-09-13T02:00:00.000Z",
      trustedNow: "2026-09-13T02:00:00.000Z",
    };
    const row = { documentId: documentA, generationId: baselineA, activeGenerationId: candidate, retainedUntil: null };

    expect(() => planCleanup({ ...base, rows: [{ ...row, state: "active", activeGenerationId: baselineA }] })).toThrow();
    expect(() => planCleanup({ ...base, rows: [{ ...row, state: "abandoned", activeGenerationId: baselineA }] })).toThrow();
    expect(() => planCleanup({ ...base, rows: [{ ...row, state: "staged" }] })).toThrow();
    expect(() =>
      planCleanup({ ...base, rows: [{ ...row, state: "retained", retainedUntil: "2026-09-13T02:00:00.001Z" }] }),
    ).toThrow();
  });

  it("canonicalizes exact cleanup UUID pairs to lowercase before sorting and hashing", async () => {
    const planCleanup = requiredFunction(
      (await lifecycleModule()).planDocumentGenerationCleanup,
      "planDocumentGenerationCleanup",
    );
    const planned = planCleanup({
      version: 1,
      projectRef,
      createdAt: "2026-09-13T02:00:00.000Z",
      trustedNow: "2026-09-13T02:00:00.000Z",
      rows: [
        {
          documentId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
          generationId: "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB",
          state: "abandoned",
          activeGenerationId: candidate,
          retainedUntil: null,
        },
      ],
    }) as { targets: unknown[] };

    expect(planned.targets).toEqual([
      {
        documentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        generationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      },
    ]);
  });
});

function appendReceiptDigest<T extends Record<string, unknown>>(payload: T) {
  return { ...payload, receiptDigest: canonicalDigest(payload) };
}

function lifecycleReceiptFixture() {
  const promotion = appendReceiptDigest({
    version: 1,
    kind: "document-generation-promotion-v1",
    operationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    projectRef,
    candidateGenerationId: candidate,
    planDigest: digest("a"),
    stageReceiptDigest: digest("b"),
    evaluationReportDigest: digest("c"),
    recoveryEvidenceDigest: digest("d"),
    stageAuthorizationDigest: digest("e"),
    promoteAuthorizationDigest: digest("f"),
    technicalEvidenceReceiptDigests: [digest("5"), digest("6")],
    transitions: [
      {
        documentId: documentA,
        fromGenerationId: null,
        toGenerationId: candidate,
        previousServingSnapshotDigest: digest("1"),
        candidateServingSnapshotDigest: digest("2"),
        retainedUntil: "2026-10-13T01:00:00.000Z",
      },
      {
        documentId: documentB,
        fromGenerationId: baselineB,
        toGenerationId: candidate,
        previousServingSnapshotDigest: digest("3"),
        candidateServingSnapshotDigest: digest("4"),
        retainedUntil: "2026-10-13T01:00:00.000Z",
      },
    ],
    promotedAt: "2026-09-13T01:05:00.000Z",
  });
  const rollback = appendReceiptDigest({
    version: 1,
    kind: "document-generation-rollback-v1",
    operationId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    promotionOperationId: promotion.operationId,
    promotionReceiptDigest: promotion.receiptDigest,
    rollbackManifestDigest: digest("7"),
    candidateGenerationId: candidate,
    transitions: [
      { documentId: documentA, fromGenerationId: candidate, toGenerationId: null, retainedUntil: "2027-01-13T01:00:00.000Z" },
      { documentId: documentB, fromGenerationId: candidate, toGenerationId: baselineB, retainedUntil: "2027-01-13T01:00:00.000Z" },
    ],
    rolledBackAt: "2026-12-13T01:05:00.000Z",
  });
  return { promotion, rollback };
}

describe("receipt-bound retained generation rollback", () => {
  it("restores the exact prior pointers even after recovery evidence freshness has expired", async () => {
    const module = await lifecycleModule();
    const assertPair = requiredFunction(
      module.assertDocumentGenerationLifecycleRollbackPair,
      "assertDocumentGenerationLifecycleRollbackPair",
    );
    const { promotion, rollback } = lifecycleReceiptFixture();

    expect(assertPair(promotion, rollback)).toMatchObject({ promotion, rollback });
  });

  it("rejects a rollback rebound to another promotion, pointer, or expired failed-candidate retention", async () => {
    const module = await lifecycleModule();
    const assertPromotion = requiredFunction(
      module.assertDocumentGenerationPromotionReceipt,
      "assertDocumentGenerationPromotionReceipt",
    );
    const assertRollback = requiredFunction(
      module.assertDocumentGenerationLifecycleRollbackReceipt,
      "assertDocumentGenerationLifecycleRollbackReceipt",
    );
    const assertPair = requiredFunction(
      module.assertDocumentGenerationLifecycleRollbackPair,
      "assertDocumentGenerationLifecycleRollbackPair",
    );
    const { promotion, rollback } = lifecycleReceiptFixture();
    const { receiptDigest: _rollbackDigest, ...rollbackPayload } = rollback;
    const rebound = appendReceiptDigest({ ...rollbackPayload, promotionReceiptDigest: digest("0") });
    const wrongPointerPayload = {
      ...rollbackPayload,
      transitions: rollback.transitions.map((transition, index) =>
        index === 0 ? { ...transition, toGenerationId: baselineA } : transition,
      ),
    };
    const wrongPointer = appendReceiptDigest(wrongPointerPayload);
    const expiredPayload = {
      ...rollbackPayload,
      transitions: rollback.transitions.map((transition) => ({ ...transition, retainedUntil: rollback.rolledBackAt })),
    };
    const expired = appendReceiptDigest(expiredPayload);
    const { receiptDigest: _promotionDigest, ...promotionPayload } = promotion;
    const expiredPrior = appendReceiptDigest({
      ...promotionPayload,
      transitions: promotion.transitions.map(transition => ({ ...transition, retainedUntil: promotion.promotedAt })),
    });
    const reusedOperation = appendReceiptDigest({ ...rollbackPayload, operationId: promotion.operationId });
    const prematureRollback = appendReceiptDigest({ ...rollbackPayload, rolledBackAt: promotion.promotedAt });

    expect(() => assertPair(promotion, rebound)).toThrow(/promotion/i);
    expect(() => assertPair(promotion, wrongPointer)).toThrow(/pointer|transition|restore/i);
    expect(() => assertRollback(expired)).toThrow(/retention|deadline/i);
    expect(() => assertPromotion(expiredPrior)).toThrow(/retention|deadline/i);
    expect(() => assertPair(promotion, reusedOperation)).toThrow(/promotion/i);
    expect(() => assertPair(promotion, prematureRollback)).toThrow(/promotion/i);
  });

  it("passes the exact promotion and rollback manifest bytes through the injected driver", async () => {
    const { promotion } = lifecycleReceiptFixture();
    const authorization = {
      version: 1 as const,
      operation: "rollback" as const,
      targetProjectRef: projectRef,
      promotionOperationId: promotion.operationId,
      promotionReceiptDigest: promotion.receiptDigest,
      candidateGenerationId: candidate,
      expectedDocumentIds: promotion.transitions.map(transition => transition.documentId),
      expectedDocumentCount: promotion.transitions.length,
      reasonCode: "post_promotion_observation_failed",
      authorizedAt: "2026-12-13T01:00:00.000Z",
      expiresAt: "2026-12-13T01:10:00.000Z",
      retainedUntil: "2027-01-13T01:00:00.000Z",
      confirmationSha256: digest("8"),
    };
    const rollbackManifestDigest = canonicalDigest(authorization);
    const rollbackPayload = {
      version: 1 as const,
      kind: "document-generation-rollback-v1" as const,
      operationId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      promotionOperationId: promotion.operationId,
      promotionReceiptDigest: promotion.receiptDigest,
      rollbackManifestDigest,
      candidateGenerationId: candidate,
      transitions: promotion.transitions.map(transition => ({
        documentId: transition.documentId,
        fromGenerationId: transition.toGenerationId,
        toGenerationId: transition.fromGenerationId,
        retainedUntil: authorization.retainedUntil,
      })),
      rolledBackAt: "2026-12-13T01:05:00.000Z",
    };
    const rollback = appendReceiptDigest(rollbackPayload);
    const calls: unknown[] = [];
    const { rollbackDocumentIndexGenerationV1 } = await import("../scripts/reindex-shadow");

    await expect(
      rollbackDocumentIndexGenerationV1(
        {
          promotionReceipt: promotion,
          rollbackManifest: { authorization, rollbackManifestDigest },
          trustedNow: "2026-12-13T01:05:00.000Z",
        },
        {
          projectRef,
          client: {
            rpc: async (name, args) => {
              calls.push({ name, args });
              return { data: rollback, error: null };
            },
          },
        },
      ),
    ).resolves.toEqual(rollback);
    expect(calls).toEqual([
      {
        name: "rollback_document_index_generation",
        args: {
          p_promotion_receipt: promotion,
          p_rollback_manifest: { authorization, rollbackManifestDigest },
        },
      },
    ]);

    const staleRollback = appendReceiptDigest({ ...rollbackPayload, rolledBackAt: "2026-12-12T01:05:00.000Z" });
    await expect(
      rollbackDocumentIndexGenerationV1(
        {
          promotionReceipt: promotion,
          rollbackManifest: { authorization, rollbackManifestDigest },
          trustedNow: "2026-12-13T01:05:00.000Z",
        },
        { projectRef, client: { rpc: async () => ({ data: staleRollback, error: null }) } },
      ),
    ).rejects.toThrow(/clock|time|promotion/i);
  });
});

describe("cleanup command safety", () => {
  it("causes no environment, client, RPC, logging, or exit effect on import", async () => {
    vi.resetModules();
    const loadEnvConfig = vi.fn();
    vi.doMock("@next/env", () => ({ loadEnvConfig }));
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const previousExitCode = process.exitCode;

    await import("../scripts/cleanup-abandoned-reindex-generations");

    expect(loadEnvConfig).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(previousExitCode);
    log.mockRestore();
    error.mockRestore();
    vi.doUnmock("@next/env");
    vi.resetModules();
  });

  it("is import-safe and exposes an explicit entry point", () => {
    const path = fileURLToPath(new URL("../scripts/cleanup-abandoned-reindex-generations.ts", import.meta.url));
    const source = readFileSync(path, "utf8");

    expect(source).not.toMatch(/^loadEnvConfig\(process\.cwd\(\)\);/m);
    expect(source).not.toMatch(/^main\(\)\.catch\(/m);
    expect(source).toMatch(/export\s+(?:async\s+)?function\s+runDocumentGenerationCleanup/);
  });

  it("has no broad all-eligible apply path", () => {
    const path = fileURLToPath(new URL("../scripts/cleanup-abandoned-reindex-generations.ts", import.meta.url));
    const source = readFileSync(path, "utf8");

    expect(source).not.toContain("all eligible documents");
    expect(source).not.toContain("p_document_id");
    expect(source).not.toContain("p_limit");
    expect(source).toContain("p_manifest");
    expect(source).toContain("p_apply");
  });

  it("requires one exact manifest path and rejects legacy selectors", async () => {
    const { parseDocumentGenerationCleanupArgs } = await import("../scripts/cleanup-abandoned-reindex-generations");

    expect(parseDocumentGenerationCleanupArgs(["--manifest", "cleanup.json"])).toEqual({
      manifestPath: "cleanup.json",
      apply: false,
      yes: false,
    });
    expect(() => parseDocumentGenerationCleanupArgs([])).toThrow(/manifest/i);
    expect(() => parseDocumentGenerationCleanupArgs(["--document-id", documentA])).toThrow(/unknown/i);
    expect(() => parseDocumentGenerationCleanupArgs(["--limit", "100"])).toThrow(/unknown/i);
  });

  it("dry-runs first and applies only the identical validated manifest", async () => {
    const pipeline = await lifecycleModule();
    const planCleanup = requiredFunction(pipeline.planDocumentGenerationCleanup, "planDocumentGenerationCleanup");
    const manifest = planCleanup({
      version: 1,
      projectRef,
      createdAt: "2026-09-13T02:00:00.000Z",
      trustedNow: "2026-09-13T02:00:00.000Z",
      rows: [
        {
          documentId: documentA,
          generationId: baselineA,
          state: "abandoned",
          activeGenerationId: candidate,
          retainedUntil: null,
        },
      ],
    }) as { digest: string; expectedCount: number; targets: unknown[] };
    const calls: Array<{ name: string; args: unknown }> = [];
    const { runDocumentGenerationCleanup } = await import("../scripts/cleanup-abandoned-reindex-generations");
    const result = await runDocumentGenerationCleanup(
      manifest,
      { apply: true, yes: true },
      {
        rpc: async (name, args) => {
          calls.push({ name, args });
          const base = {
            ok: true as const,
            applied: args.p_apply,
            manifestDigest: manifest.digest,
            expectedCount: manifest.expectedCount,
            targets: manifest.targets,
            operationId: args.p_apply ? "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" : null,
            eligibleCount: manifest.expectedCount,
            deletedArtifactCount: args.p_apply ? 1 : 0,
            privateObjectReferenceInventory: [],
            physicalDeletionAuthorized: false as const,
          };
          if (!args.p_apply) return { data: base, error: null };
          const payload = {
            version: 1 as const,
            kind: "document-generation-cleanup-v1" as const,
            ...base,
            applied: true as const,
            cleanedAt: "2026-09-13T02:01:00.000Z",
          };
          return {
            data: appendReceiptDigest(payload),
            error: null,
          };
        },
      },
    );

    expect(result.kind).toBe("document-generation-cleanup-applied");
    if (result.kind !== "document-generation-cleanup-applied") throw new Error("Expected cleanup apply receipt");
    expect(result.applied).toMatchObject({
      version: 1,
      kind: "document-generation-cleanup-v1",
      physicalDeletionAuthorized: false,
      privateObjectReferenceInventory: [],
    });
    expect(Object.isFrozen(result.applied)).toBe(true);
    expect(calls).toEqual([
      { name: "cleanup_document_index_generations", args: { p_manifest: manifest, p_apply: false } },
      { name: "cleanup_document_index_generations", args: { p_manifest: manifest, p_apply: true } },
    ]);
  });

  it("rejects substituted cleanup receipts and destination projects before client or health access", async () => {
    const pipeline = await lifecycleModule();
    const planCleanup = requiredFunction(pipeline.planDocumentGenerationCleanup, "planDocumentGenerationCleanup");
    const manifest = planCleanup({
      version: 1,
      projectRef,
      createdAt: "2026-09-13T02:00:00.000Z",
      trustedNow: "2026-09-13T02:00:00.000Z",
      rows: [{ documentId: documentA, generationId: baselineA, state: "abandoned", activeGenerationId: candidate, retainedUntil: null }],
    }) as { digest: string; expectedCount: number; targets: unknown[] };
    const { runDocumentGenerationCleanup, runDocumentGenerationCleanupCli } = await import(
      "../scripts/cleanup-abandoned-reindex-generations"
    );
    const dryResult = {
      ok: true as const,
      applied: false as const,
      operationId: null,
      manifestDigest: manifest.digest,
      expectedCount: manifest.expectedCount,
      eligibleCount: manifest.expectedCount,
      deletedArtifactCount: 0,
      targets: manifest.targets,
      privateObjectReferenceInventory: [],
      physicalDeletionAuthorized: false as const,
    };
    const applyPayload = {
      version: 1 as const,
      kind: "document-generation-cleanup-v1" as const,
      ...dryResult,
      applied: true as const,
      operationId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      deletedArtifactCount: 1,
      cleanedAt: "2026-09-13T02:01:00.000Z",
    };
    let call = 0;
    await expect(
      runDocumentGenerationCleanup(manifest, { apply: true, yes: true }, {
        rpc: async () => ({ data: call++ === 0 ? dryResult : { ...appendReceiptDigest(applyPayload), receiptDigest: digest("0") }, error: null }),
      }),
    ).rejects.toThrow(/digest/i);
    for (const invalidPayload of [
      { ...applyPayload, version: 2 },
      { ...applyPayload, kind: "other-cleanup-receipt-v1" },
      { ...applyPayload, eligibleCount: 0 },
      { ...applyPayload, physicalDeletionAuthorized: true },
      { ...applyPayload, targets: [{ documentId: documentB, generationId: baselineB }] },
      { ...applyPayload, unexpected: true },
    ]) {
      let rpcCall = 0;
      await expect(
        runDocumentGenerationCleanup(manifest, { apply: true, yes: true }, {
          rpc: async () => ({
            data: rpcCall++ === 0 ? dryResult : appendReceiptDigest(invalidPayload),
            error: null,
          }),
        }),
      ).rejects.toThrow(/receipt|manifest|mode/i);
    }

    const rpc = vi.fn();
    const createClient = vi.fn(async () => ({
      rpc,
      from: () => ({ select: () => ({ limit: async () => ({ error: null }) }) }),
    }));
    const assertHealthy = vi.fn(async () => undefined);
    await expect(
      runDocumentGenerationCleanupCli(["--manifest", "cleanup.json"], {
        readManifest: async () => manifest,
        loadDestinationIdentity: async () => ({ projectRef: "abcdefghijklmnopqrst", projectName: "wrong" }),
        createClient,
        assertHealthy,
        log: vi.fn(),
      }),
    ).rejects.toThrow(/destination project/i);
    expect(createClient).not.toHaveBeenCalled();
    expect(assertHealthy).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
