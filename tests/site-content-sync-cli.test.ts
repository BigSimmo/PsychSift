import { describe, expect, it, vi } from "vitest";

import {
  buildSiteContentSyncPlanFromInputs,
  createSiteContentSyncWriteDriver,
} from "../scripts/sync-site-content-corpus";
import type { StaticSiteContentManifest } from "../src/lib/site-content/site-content-manifest";
import { planSiteContentSync } from "../src/lib/site-content/site-content-sync";
import {
  fixtureSha,
  siteReleaseCandidateId,
  siteReleaseGenerationId,
  siteReleasePreviousId,
  siteReleaseProjectRef,
  validSiteReleaseRecoveryFixture,
} from "./fixtures/site-release-recovery";

describe("site-content synchronization CLI contract", () => {
  it("consumes the P03 manifest and produces a real mixed disposition-bound plan", () => {
    const manifest: StaticSiteContentManifest = {
      version: "clinical-kb-site-static-manifest-v1",
      gitSha: "a".repeat(40),
      registryVersion: "site-content-registry-v1",
      generatedAt: "2026-08-24T00:00:00.000Z",
      staticManifestDigest: fixtureSha("1"),
      records: [
        ["medications:a", fixtureSha("2")],
        ["medications:b", fixtureSha("3")],
        ["medications:c", fixtureSha("4")],
      ].map(([logicalId, contentHash]) => ({
        logicalId: logicalId!,
        domain: "medications" as const,
        route: `/medications/${logicalId!.split(":")[1]}`,
        contentHash: contentHash!,
        lineageDigest: fixtureSha("5"),
        validationStatus: "locally_reviewed" as const,
        sourceStatus: "current" as const,
        eligible: true,
        exclusionReason: null,
      })),
    };
    const plan = buildSiteContentSyncPlanFromInputs({
      manifest,
      projectRef: siteReleaseProjectRef,
      expectedProjectRef: siteReleaseProjectRef,
      candidateReleaseId: siteReleaseCandidateId,
      previousReleaseId: siteReleasePreviousId,
      generationId: siteReleaseGenerationId,
      expectedEmbedding: { model: "synthetic", dimensions: 3 },
      activeProjections: [
        ["medications:a", fixtureSha("9")],
        ["medications:b", fixtureSha("3")],
        ["medications:removed", fixtureSha("8")],
      ].map(([logicalId, contentHash]) => ({
        logicalId: logicalId!,
        contentHash: contentHash as `sha256:${string}`,
        embedding: {
          model: "synthetic",
          dimensions: 3,
          contentHash: contentHash as `sha256:${string}`,
          digest: fixtureSha("6"),
        },
      })),
      legacyRows: [
        { rowId: "legacy-a", logicalId: "medications:a", contentHash: fixtureSha("2") },
        { rowId: "legacy-a-old", logicalId: "medications:a", contentHash: fixtureSha("9") },
      ],
      legacyDispositions: [{ logicalId: "medications:a", selectedRowId: "legacy-a", retiredRowIds: ["legacy-a-old"] }],
      batchSize: 25,
    });
    expect(plan.expectedCounts).toEqual({ desired: 3, changed: 2, unchanged: 1, tombstoned: 1 });
    expect(plan.legacyDispositions[0]).toMatchObject({ selectedRowId: "legacy-a", retiredRowIds: ["legacy-a-old"] });
  });

  it("keeps the guarded write driver inert unless explicitly enabled and sends the exact canonical plan", async () => {
    const send = vi.fn(async () => ({ ok: true }));
    const driver = createSiteContentSyncWriteDriver({ send });
    await expect(
      driver.execute({} as never, { allowWrite: false, expectedProjectRef: siteReleaseProjectRef }),
    ).rejects.toThrow(/write/i);
    expect(send).not.toHaveBeenCalled();
    const recovery = validSiteReleaseRecoveryFixture();
    await expect(
      driver.execute({ projectRef: siteReleaseProjectRef, recoveryEvidence: recovery.evidence } as never, {
        allowWrite: true,
        expectedProjectRef: siteReleaseProjectRef,
      }),
    ).rejects.toThrow(/canonical.*plan/i);

    const publication = {
      logicalId: "medication:a",
      domain: "medications" as const,
      publicationVersion: "2026-08-24T00:00:00.000Z",
      contentHash: fixtureSha("2"),
      sourceLineageDigest: fixtureSha("3"),
    };
    const writePlan = planSiteContentSync({
      projectRef: siteReleaseProjectRef,
      expectedProjectRef: siteReleaseProjectRef,
      candidateReleaseId: siteReleaseCandidateId,
      previousReleaseId: siteReleasePreviousId,
      generationId: siteReleaseGenerationId,
      registryVersion: "site-content-registry-v1",
      staticManifestDigest: fixtureSha("4"),
      expectedEmbedding: { model: "synthetic", dimensions: 3 },
      desiredRecords: [publication],
      activeProjections: [],
      legacyRows: [],
      legacyDispositions: [],
      batchSize: 25,
      write: true,
      recoveryEvidence: recovery.evidence,
      now: new Date("2026-08-24T12:00:00.000Z"),
    });
    const writeSend = vi.fn(async () => ({ ok: true }));
    await createSiteContentSyncWriteDriver({
      send: writeSend,
      resolvePublication: (logicalId) => (logicalId === publication.logicalId ? publication : null),
    }).execute(writePlan, { allowWrite: true, expectedProjectRef: siteReleaseProjectRef });
    expect(writeSend).toHaveBeenNthCalledWith(1, {
      path: "/api/admin/site-content/publish",
      body: { action: "begin", plan: writePlan },
    });
    expect(writeSend).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        path: "/api/admin/site-content/publish",
        body: expect.objectContaining({
          action: "publish",
          record: expect.objectContaining({ logicalId: publication.logicalId, planDigest: writePlan.planDigest }),
        }),
      }),
    );
  });
});
