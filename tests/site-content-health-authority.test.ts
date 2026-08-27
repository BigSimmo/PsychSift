import { describe, expect, it } from "vitest";

import { classifySiteContentHealth } from "@/lib/health-response";
import { collectSiteContentHealthInput } from "@/lib/site-content/site-content-health-authority";
import { expectedSiteContentStaticManifestDigest } from "@/lib/site-content/site-content-static-build.generated";
import type { SiteContentRuntimeAuthoritySnapshot } from "@/lib/supabase/health";

const RELEASE_SHA = "4".repeat(40);

function authority(overrides: Partial<SiteContentRuntimeAuthoritySnapshot> = {}): SiteContentRuntimeAuthoritySnapshot {
  return {
    version: "site-content-runtime-authority-v1",
    observedAt: "2026-08-28T00:05:00.000Z",
    changeEpoch: "42",
    activeRelease: {
      releaseId: "00000000-0000-4000-8000-000000000004",
      state: "active",
      registryVersion: "site-content-registry-v1",
      staticManifestDigest: expectedSiteContentStaticManifestDigest,
      dynamicStateDigest: `sha256:${"2".repeat(64)}`,
      releaseDigest: `sha256:${"3".repeat(64)}`,
      deploymentSha: RELEASE_SHA,
      activatedAt: "2026-08-28T00:00:00.000Z",
      expectedRecordCount: 8,
      projectedRecordCount: 8,
      integrityVerified: true,
      publicVisibilityVerified: true,
      governanceVerified: true,
      mustPassVerified: true,
    },
    pendingLogicalIds: [],
    pendingLogicalIdCount: 0,
    directSuccessorCandidateCount: 0,
    orphanedNonterminalOutboxCount: 0,
    outbox: { pendingCount: 0, leasedCount: 0, quarantinedCount: 0, oldestPendingAgeSeconds: null },
    integrity: { gateArtifactCount: 3, gateArtifactSubjectMismatchCount: 0, projectionOperationMismatchCount: 0 },
    rollbackAvailable: true,
    synchronizer: {
      lastInvocationId: "11111111-1111-4111-8111-111111111111",
      lastWorkerId: "22222222-2222-4222-8222-222222222222",
      lastInvokedAt: "2026-08-28T00:04:00.000Z",
      lastHeartbeatAt: "2026-08-28T00:04:30.000Z",
      lastCompletedAt: "2026-08-28T00:04:31.000Z",
      lastOutcome: "succeeded",
    },
    ...overrides,
  };
}

describe("site-content request-time runtime authority", () => {
  it("binds the compiled static identity and actual runtime SHA to the current RPC snapshot", async () => {
    const input = await collectSiteContentHealthInput({
      readAuthority: async () => authority(),
      deploymentSha: () => RELEASE_SHA,
    });
    expect(input).toMatchObject({
      expectedStaticManifestDigest: expectedSiteContentStaticManifestDigest,
      deploymentSha: RELEASE_SHA,
      activeRelease: { deploymentSha: RELEASE_SHA },
    });
    expect(classifySiteContentHealth(input, { now: new Date("2026-08-28T00:05:00.000Z") }).stopReasons).toEqual([]);
  });

  it("observes a later dynamic publication without environment mutation", async () => {
    let snapshot = authority();
    const dependencies = { readAuthority: async () => snapshot, deploymentSha: () => RELEASE_SHA };
    expect(classifySiteContentHealth(await collectSiteContentHealthInput(dependencies)).health.state).toBe("current");
    snapshot = authority({
      changeEpoch: "43",
      pendingLogicalIds: ["medications:lithium"],
      pendingLogicalIdCount: 1,
      directSuccessorCandidateCount: 1,
      outbox: { pendingCount: 1, leasedCount: 0, quarantinedCount: 0, oldestPendingAgeSeconds: 20 },
    });
    expect(classifySiteContentHealth(await collectSiteContentHealthInput(dependencies)).health.state).toBe("updating");
  });

  it("fails closed for incomplete pending evidence and unavailable authority", async () => {
    const incomplete = await collectSiteContentHealthInput({
      readAuthority: async () => authority({ pendingLogicalIdCount: 1 }),
      deploymentSha: () => RELEASE_SHA,
    });
    expect(incomplete).toBeUndefined();
    await expect(
      collectSiteContentHealthInput({
        readAuthority: async () => {
          throw new Error("offline synthetic failure");
        },
      }),
    ).resolves.toBeUndefined();
  });

  it("fails a later stale or failed synchronizer against request wall clock", async () => {
    const failed = await collectSiteContentHealthInput({
      readAuthority: async () =>
        authority({
          observedAt: "2026-08-28T00:12:00.000Z",
          synchronizer: {
            ...authority().synchronizer,
            lastOutcome: "failed",
            lastHeartbeatAt: "2026-08-28T00:04:30.000Z",
          },
        }),
      deploymentSha: () => RELEASE_SHA,
    });
    const result = classifySiteContentHealth(failed, { now: new Date("2026-08-28T00:12:00.000Z") });
    expect(result.health.state).toBe("failure");
    expect(result.stopReasons).toEqual(expect.arrayContaining(["synchronizer_failed", "stale_worker_heartbeat"]));
  });
});
