import { describe, expect, it, vi } from "vitest";

import {
  assertSiteReleaseReceiptPair,
  planSiteContentSync,
  runSiteContentSync,
} from "../src/lib/site-content/site-content-sync";
import { activationReceiptDigest, rollbackReceiptDigest } from "../src/lib/recovery-readiness-evidence";

const sha = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}` as const;
const releaseId = "11111111-1111-4111-8111-111111111111";
const priorReleaseId = "22222222-2222-4222-8222-222222222222";
const generationId = "33333333-3333-4333-8333-333333333333";

function desired(logicalId: string, contentHash: `sha256:${string}`) {
  return {
    logicalId,
    domain: "medications" as const,
    publicationVersion: "2026-08-24T00:00:00.000Z",
    contentHash,
    sourceLineageDigest: sha("a"),
  };
}

function plan(overrides: Record<string, unknown> = {}) {
  return planSiteContentSync({
    projectRef: "synthetic-project",
    expectedProjectRef: "synthetic-project",
    candidateReleaseId: releaseId,
    previousReleaseId: priorReleaseId,
    generationId,
    registryVersion: "site-content-registry-v1",
    staticManifestDigest: sha("b"),
    expectedEmbedding: { model: "synthetic-embedding-v1", dimensions: 3 },
    desiredRecords: [desired("medication:alpha", sha("c")), desired("medication:beta", sha("d"))],
    activeProjections: [
      {
        logicalId: "medication:alpha",
        contentHash: sha("c"),
        embedding: {
          model: "synthetic-embedding-v1",
          dimensions: 3,
          contentHash: sha("c"),
          digest: sha("e"),
        },
      },
      {
        logicalId: "medication:removed",
        contentHash: sha("f"),
        embedding: {
          model: "synthetic-embedding-v1",
          dimensions: 3,
          contentHash: sha("f"),
          digest: sha("0"),
        },
      },
    ],
    legacyRows: [],
    legacyDispositions: [],
    batchSize: 25,
    ...overrides,
  });
}

describe("durable site-content synchronization", () => {
  it("plans verified unchanged reuse, changed-only staging, and deletion tombstones deterministically", () => {
    const result = plan();

    expect(result.mode).toBe("dry-run");
    expect(result.unchanged.map((entry) => entry.logicalId)).toEqual(["medication:alpha"]);
    expect(result.changed.map((entry) => entry.logicalId)).toEqual(["medication:beta"]);
    expect(result.tombstoned.map((entry) => entry.logicalId)).toEqual(["medication:removed"]);
    expect(result.unchanged[0]?.reusedEmbedding.digest).toBe(sha("e"));
    expect(result.expectedCounts).toEqual({ desired: 2, changed: 1, unchanged: 1, tombstoned: 1 });
    expect(result.dynamicStateDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.releaseDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.planDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(plan().planDigest).toBe(result.planDigest);
  });

  it("fails closed on target drift, incompatible embedding reuse, and unresolved divergent legacy rows", () => {
    expect(() => plan({ expectedProjectRef: "different-project" })).toThrow(/project/i);

    const incompatible = plan({
      activeProjections: [
        {
          logicalId: "medication:alpha",
          contentHash: sha("c"),
          embedding: {
            model: "old-model",
            dimensions: 3,
            contentHash: sha("c"),
            digest: sha("e"),
          },
        },
      ],
    });
    expect(incompatible.changed.map((entry) => entry.logicalId)).toContain("medication:alpha");
    expect(incompatible.unchanged).toHaveLength(0);

    expect(() =>
      plan({
        legacyRows: [
          { rowId: "legacy-a", logicalId: "medication:alpha", contentHash: sha("1") },
          { rowId: "legacy-b", logicalId: "medication:alpha", contentHash: sha("2") },
        ],
      }),
    ).toThrow(/disposition|divergent/i);
  });

  it("never sends verified unchanged records to the embedding stage and rejects a stale lease or generation", async () => {
    const syncPlan = plan();
    const stageChanged = vi.fn(async () => undefined);
    const carryForward = vi.fn(async () => undefined);
    const tombstone = vi.fn(async () => undefined);
    const lease = {
      workerId: "44444444-4444-4444-8444-444444444444",
      leaseId: "55555555-5555-4555-8555-555555555555",
      generationId,
      expiresAt: "2026-08-24T01:05:00.000Z",
    };

    await expect(
      runSiteContentSync(syncPlan, lease, {
        now: () => new Date("2026-08-24T01:00:00.000Z"),
        stageChanged,
        carryForward,
        tombstone,
      }),
    ).resolves.toMatchObject({ changed: 1, unchanged: 1, tombstoned: 1, releaseDigest: syncPlan.releaseDigest });
    expect(stageChanged).toHaveBeenCalledTimes(1);
    expect(stageChanged).toHaveBeenCalledWith(expect.objectContaining({ logicalId: "medication:beta" }), lease);
    expect(carryForward).toHaveBeenCalledWith(
      expect.objectContaining({ logicalId: "medication:alpha", reusedEmbedding: expect.any(Object) }),
      lease,
    );
    expect(tombstone).toHaveBeenCalledTimes(1);

    await expect(
      runSiteContentSync(syncPlan, { ...lease, generationId: "66666666-6666-4666-8666-666666666666" }, {}),
    ).rejects.toThrow(/generation/i);
    await expect(
      runSiteContentSync(
        syncPlan,
        { ...lease, expiresAt: "2026-08-24T00:59:59.000Z" },
        {
          now: () => new Date("2026-08-24T01:00:00.000Z"),
        },
      ),
    ).rejects.toThrow(/lease/i);
  });

  it("reuses the shared append-only activation and retained-pointer rollback receipt authority", () => {
    const activation = {
      version: 1,
      receiptId: "77777777-7777-4777-8777-777777777777",
      sequence: 7,
      recordedAt: "2026-08-24T01:10:00.000Z",
      projectRef: "synthetic-project",
      operation: "site-release",
      recoveryEvidenceId: "88888888-8888-4888-8888-888888888888",
      recoveryEvidenceDigest: sha("3"),
      stateDigest: sha("4"),
      resource: { kind: "site-release", releaseId, releaseDigest: sha("5") },
      previousResource: { kind: "site-release", releaseId: priorReleaseId, releaseDigest: sha("6") },
    };
    const activationWithDigest = { ...activation, digest: activationReceiptDigest(activation) };
    const rollback = {
      version: 1,
      receiptId: "99999999-9999-4999-8999-999999999999",
      sequence: 8,
      recordedAt: "2026-08-24T01:11:00.000Z",
      projectRef: "synthetic-project",
      operation: "site-release",
      activationReceiptId: activationWithDigest.receiptId,
      activationReceiptDigest: activationWithDigest.digest,
      recoveryEvidenceDigest: activationWithDigest.recoveryEvidenceDigest,
      failedResource: activationWithDigest.resource,
      restoredResource: activationWithDigest.previousResource,
      restorationMethod: "retained-pointer",
    };
    const rollbackWithDigest = { ...rollback, digest: rollbackReceiptDigest(rollback) };

    expect(assertSiteReleaseReceiptPair(activationWithDigest, rollbackWithDigest)).toMatchObject({
      activation: { operation: "site-release" },
      rollback: { restorationMethod: "retained-pointer" },
    });
  });
});
