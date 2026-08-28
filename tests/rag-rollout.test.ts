import { describe, expect, it } from "vitest";
import type { ActiveSiteContentRelease } from "../src/lib/site-content/site-content-contracts";
import type { RagProgrammeMode } from "../src/lib/types";
import {
  ragContextSnapshotCacheKey,
  ragContextSnapshotInvalidationTags,
  resolveRagContextSnapshot,
  type RagContextSnapshotInput,
} from "../src/lib/rag/rag-context-snapshot";

const STATIC_DIGEST = `sha256:${"1".repeat(64)}`;

function release(): ActiveSiteContentRelease {
  return {
    version: "clinical-kb-site-release-v1",
    releaseId: "33333333-3333-4333-8333-333333333333",
    registryVersion: "site-content-registry-v1",
    staticManifestDigest: STATIC_DIGEST,
    dynamicStateDigest: `sha256:${"2".repeat(64)}`,
    releaseDigest: `sha256:${"3".repeat(64)}`,
    state: "active",
    activatedAt: "2026-08-29T00:00:00.000Z",
  };
}

function input(rolloutVersion: RagProgrammeMode): RagContextSnapshotInput {
  return {
    expectedSiteStaticManifestDigest: STATIC_DIGEST,
    activePublicSiteRelease: release(),
    publicSiteChangeEpoch: "epoch-21",
    pendingPublicSiteChangeCount: 0,
    pendingPublicSiteLogicalIds: [],
    documentIndexGeneration: "documents-generation-9",
    sourcePolicyVersion: "source-policy-v2",
    rolloutVersion,
    resolvedAt: "2026-08-29T00:02:00.000Z",
  };
}

describe("RAG request snapshot programme-mode input", () => {
  it("consumes the existing typed programme mode as an opaque rollout version", () => {
    const modes = ["legacy", "shadow", "canary"] satisfies readonly RagProgrammeMode[];

    for (const mode of modes) {
      const snapshot = resolveRagContextSnapshot(input(mode));
      expect(snapshot.rolloutVersion).toBe(mode);
      expect(ragContextSnapshotInvalidationTags(snapshot)).toContain(`rollout:${mode}`);
    }
  });

  it("separates public/shared cache identity for every existing programme mode", () => {
    const modes = ["legacy", "shadow", "canary"] satisfies readonly RagProgrammeMode[];
    const keys = modes.map((mode) => ragContextSnapshotCacheKey(resolveRagContextSnapshot(input(mode))));

    expect(new Set(keys).size).toBe(modes.length);
  });

  it("does not derive cohort, namespace, environment, or rollout authority inside the request snapshot", () => {
    const snapshot = resolveRagContextSnapshot(input("canary"));

    expect(snapshot).not.toHaveProperty("cohort");
    expect(snapshot).not.toHaveProperty("namespace");
    expect(snapshot).not.toHaveProperty("environment");
    expect(snapshot).not.toHaveProperty("rolloutDecision");
    expect(snapshot).not.toHaveProperty("rolloutAuthority");
  });
});
