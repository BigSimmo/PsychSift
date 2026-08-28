import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { SiteContentHealthInput } from "../src/lib/health-response";
import type { ActiveSiteContentRelease } from "../src/lib/site-content/site-content-contracts";
import { siteContentPendingLogicalIdsDigest } from "../src/lib/site-content/site-content-registry";
import {
  ragContextSnapshotCacheKey,
  ragContextSnapshotInvalidationTags,
  ragContextSnapshotTelemetry,
  resolveRagContextSnapshot,
  selectRequestRagContextSnapshot,
  type RagContextSnapshotInput,
} from "../src/lib/rag/rag-context-snapshot";

const STATIC_A = `sha256:${"a".repeat(64)}`;
const STATIC_B = `sha256:${"b".repeat(64)}`;
const DYNAMIC_A = `sha256:${"c".repeat(64)}`;
const DYNAMIC_B = `sha256:${"d".repeat(64)}`;
const RELEASE_A = `sha256:${"e".repeat(64)}`;
const RELEASE_B = `sha256:${"f".repeat(64)}`;
const HEALTH_NOW = new Date("2026-08-28T00:05:00.000Z");
const healthFixturePath = resolve("tests/fixtures/site-content/release-evidence-current.json");

function fullHealthAuthority(): SiteContentHealthInput {
  return JSON.parse(readFileSync(healthFixturePath, "utf8")) as SiteContentHealthInput;
}

function updatingFullHealthAuthority(): SiteContentHealthInput {
  const input = fullHealthAuthority();
  const pendingLogicalIds = ["medications:lithium"];
  const pendingLogicalIdsDigest = siteContentPendingLogicalIdsDigest(pendingLogicalIds);
  return {
    ...input,
    activeRelease: {
      ...input.activeRelease!,
      changeEpoch: "43",
      pendingLogicalIds,
      pendingLogicalIdsDigest,
      integrity: { ...input.activeRelease!.integrity, directSuccessorCandidateCount: 1 },
    },
    queueHealth: {
      ...input.queueHealth,
      changeEpoch: "43",
      pendingLogicalIds,
      pendingLogicalIdsDigest,
      pendingCount: 1,
      oldestPendingAgeSeconds: 120,
    },
  };
}

async function resolveFullHealthAuthority(siteAuthority: SiteContentHealthInput) {
  const { resolveRequestRagContextSnapshot } = await import("../src/lib/rag/rag-cache");
  return resolveRequestRagContextSnapshot({}, "legacy", {
    readDocumentIndexGeneration: async () => "documents-generation-health-test",
    readSiteContentAuthority: async () => siteAuthority,
    now: () => HEALTH_NOW,
  });
}

function activeRelease(overrides: Partial<ActiveSiteContentRelease> = {}): ActiveSiteContentRelease {
  return {
    version: "clinical-kb-site-release-v1",
    releaseId: "11111111-1111-4111-8111-111111111111",
    registryVersion: "site-content-registry-v1",
    staticManifestDigest: STATIC_A,
    dynamicStateDigest: DYNAMIC_A,
    releaseDigest: RELEASE_A,
    state: "active",
    activatedAt: "2026-08-29T00:00:00.000Z",
    ...overrides,
  };
}

function snapshotInput(overrides: Partial<RagContextSnapshotInput> = {}): RagContextSnapshotInput {
  return {
    expectedSiteStaticManifestDigest: STATIC_A,
    activePublicSiteRelease: activeRelease(),
    publicSiteChangeEpoch: "epoch-17",
    pendingPublicSiteChangeCount: 0,
    pendingPublicSiteLogicalIds: [],
    documentIndexGeneration: "documents-generation-7",
    sourcePolicyVersion: "source-policy-v2",
    rolloutVersion: "legacy",
    resolvedAt: "2026-08-29T00:02:00.000Z",
    ...overrides,
  };
}

describe("request-local RAG site-content snapshot", () => {
  it("resolves a complete matching active release as one frozen current public partition", () => {
    const snapshot = resolveRagContextSnapshot(snapshotInput());

    expect(snapshot).toMatchObject({
      version: "rag-context-snapshot-v1",
      documentIndexGeneration: "documents-generation-7",
      sourcePolicyVersion: "source-policy-v2",
      rolloutVersion: "legacy",
      publicSiteContent: {
        state: "current",
        registryVersion: "site-content-registry-v1",
        staticManifestMatch: true,
        pendingLogicalIds: [],
        pendingLogicalIdsDigest: siteContentPendingLogicalIdsDigest([]),
      },
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.publicSiteContent)).toBe(true);
    expect(Object.isFrozen(snapshot.publicSiteContent.pendingLogicalIds)).toBe(true);
    expect(snapshot.uploadedLocal.activationDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it.each([
    ["missing", null],
    ["malformed", { ...activeRelease(), releaseDigest: "not-a-digest" }],
    ["staged", { ...activeRelease(), state: "staged" }],
    ["rolled back", { ...activeRelease(), state: "rolled_back" }],
  ])("fails %s release authority closed to an identity-free unavailable partition", (_label, release) => {
    const snapshot = resolveRagContextSnapshot(
      snapshotInput({ activePublicSiteRelease: release as ActiveSiteContentRelease | null }),
    );

    expect(snapshot.publicSiteContent).toEqual({
      registryVersion: null,
      releaseId: null,
      expectedStaticManifestDigest: null,
      activeStaticManifestDigest: null,
      staticManifestDigest: null,
      staticManifestMatch: false,
      dynamicStateDigest: null,
      releaseDigest: null,
      changeEpoch: null,
      pendingLogicalIds: [],
      pendingLogicalIdsDigest: null,
      state: "unavailable",
    });
  });

  it("classifies a complete active release with a mismatched static manifest as stale, never current", () => {
    const snapshot = resolveRagContextSnapshot(snapshotInput({ expectedSiteStaticManifestDigest: STATIC_B }));

    expect(snapshot.publicSiteContent).toMatchObject({
      state: "stale",
      staticManifestMatch: false,
      expectedStaticManifestDigest: STATIC_B,
      activeStaticManifestDigest: STATIC_A,
      staticManifestDigest: STATIC_A,
    });
  });

  it("fails closed when active release authority claims activation after request resolution", () => {
    const snapshot = resolveRagContextSnapshot(
      snapshotInput({
        resolvedAt: "2026-08-29T00:00:00.000Z",
        activePublicSiteRelease: activeRelease({ activatedAt: "2026-08-29T00:00:01.000Z" }),
      }),
    );

    expect(snapshot.publicSiteContent.state).toBe("unavailable");
    expect(snapshot.publicSiteContent.releaseId).toBeNull();
  });

  it("binds a valid pending edit to the exact canonical exclusion set and changes identity before activation", () => {
    const current = resolveRagContextSnapshot(snapshotInput());
    const pendingLogicalIds = ["differential:mania", "medication:lithium"];
    const updating = resolveRagContextSnapshot(
      snapshotInput({
        publicSiteChangeEpoch: "epoch-18",
        pendingPublicSiteChangeCount: pendingLogicalIds.length,
        pendingPublicSiteLogicalIds: pendingLogicalIds,
      }),
    );

    expect(updating.publicSiteContent).toMatchObject({
      state: "updating",
      changeEpoch: "epoch-18",
      pendingLogicalIds,
      pendingLogicalIdsDigest: siteContentPendingLogicalIdsDigest(pendingLogicalIds),
    });
    expect(ragContextSnapshotCacheKey(updating)).not.toBe(ragContextSnapshotCacheKey(current));
    expect(ragContextSnapshotInvalidationTags(updating)).toContain(
      `site-pending:${siteContentPendingLogicalIdsDigest(pendingLogicalIds)}`,
    );
    expect(ragContextSnapshotTelemetry(updating).site_content_pending_bucket).toBe("few");
  });

  it.each([
    { pendingPublicSiteChangeCount: 1, pendingPublicSiteLogicalIds: [] },
    { pendingPublicSiteChangeCount: 1, pendingPublicSiteLogicalIds: [" medication:lithium"] },
    { pendingPublicSiteChangeCount: 2, pendingPublicSiteLogicalIds: ["medication:lithium"] },
    {
      pendingPublicSiteChangeCount: 2,
      pendingPublicSiteLogicalIds: ["medication:lithium", "medication:lithium"],
    },
  ])("does not make malformed pending authority retrievable: %o", (pending) => {
    const snapshot = resolveRagContextSnapshot(snapshotInput(pending));
    expect(snapshot.publicSiteContent.state).toBe("unavailable");
  });

  it("keeps non-site request authority intact when only the site partition is stale or unavailable", () => {
    const stale = resolveRagContextSnapshot(snapshotInput({ expectedSiteStaticManifestDigest: STATIC_B }));
    const unavailable = resolveRagContextSnapshot(snapshotInput({ activePublicSiteRelease: null }));

    for (const snapshot of [stale, unavailable]) {
      expect(snapshot.documentIndexGeneration).toBe("documents-generation-7");
      expect(snapshot.sourcePolicyVersion).toBe("source-policy-v2");
      expect(snapshot.rolloutVersion).toBe("legacy");
    }
  });

  it("changes release and dynamic identity on activation while the matched static digest stays fixed", () => {
    const before = resolveRagContextSnapshot(snapshotInput());
    const after = resolveRagContextSnapshot(
      snapshotInput({
        activePublicSiteRelease: activeRelease({
          releaseId: "22222222-2222-4222-8222-222222222222",
          dynamicStateDigest: DYNAMIC_B,
          releaseDigest: RELEASE_B,
          activatedAt: "2026-08-29T00:01:00.000Z",
        }),
        publicSiteChangeEpoch: "epoch-18",
      }),
    );

    expect(before.publicSiteContent.staticManifestDigest).toBe(STATIC_A);
    expect(after.publicSiteContent.staticManifestDigest).toBe(STATIC_A);
    expect(after.publicSiteContent.state).toBe("current");
    expect(ragContextSnapshotCacheKey(after)).not.toBe(ragContextSnapshotCacheKey(before));
  });

  it("changes public/shared identity across every snapshot authority dimension", () => {
    const baseline = ragContextSnapshotCacheKey(resolveRagContextSnapshot(snapshotInput()));
    const changedInputs: Array<[string, RagContextSnapshotInput]> = [
      [
        "registry",
        snapshotInput({ activePublicSiteRelease: activeRelease({ registryVersion: "site-content-registry-v2" }) }),
      ],
      [
        "static",
        snapshotInput({
          expectedSiteStaticManifestDigest: STATIC_B,
          activePublicSiteRelease: activeRelease({ staticManifestDigest: STATIC_B }),
        }),
      ],
      ["dynamic", snapshotInput({ activePublicSiteRelease: activeRelease({ dynamicStateDigest: DYNAMIC_B }) })],
      [
        "release",
        snapshotInput({
          activePublicSiteRelease: activeRelease({
            releaseId: "22222222-2222-4222-8222-222222222222",
            releaseDigest: RELEASE_B,
          }),
        }),
      ],
      ["epoch", snapshotInput({ publicSiteChangeEpoch: "epoch-18" })],
      ["source policy", snapshotInput({ sourcePolicyVersion: "source-policy-v3" })],
      ["document generation", snapshotInput({ documentIndexGeneration: "documents-generation-8" })],
      ["programme rollout", snapshotInput({ rolloutVersion: "shadow" })],
    ];

    for (const [dimension, input] of changedInputs) {
      expect(ragContextSnapshotCacheKey(resolveRagContextSnapshot(input)), dimension).not.toBe(baseline);
    }
  });

  it("copies authority into an immutable request snapshot while the next request observes a changed pointer", () => {
    const mutableRelease = activeRelease();
    const requestOne = resolveRagContextSnapshot(snapshotInput({ activePublicSiteRelease: mutableRelease }));

    mutableRelease.releaseId = "22222222-2222-4222-8222-222222222222";
    mutableRelease.dynamicStateDigest = DYNAMIC_B;
    mutableRelease.releaseDigest = RELEASE_B;
    const requestTwo = resolveRagContextSnapshot(snapshotInput({ activePublicSiteRelease: mutableRelease }));

    expect(requestOne.publicSiteContent).toMatchObject({
      releaseId: "11111111-1111-4111-8111-111111111111",
      dynamicStateDigest: DYNAMIC_A,
      releaseDigest: RELEASE_A,
    });
    expect(requestTwo.publicSiteContent).toMatchObject({
      releaseId: "22222222-2222-4222-8222-222222222222",
      dynamicStateDigest: DYNAMIC_B,
      releaseDigest: RELEASE_B,
    });
  });

  it("rejects conflicting direct and cache-context snapshot object references", () => {
    const direct = resolveRagContextSnapshot(snapshotInput());
    const conflicting = resolveRagContextSnapshot(snapshotInput());

    expect(selectRequestRagContextSnapshot(direct, direct)).toBe(direct);
    expect(() => selectRequestRagContextSnapshot(direct, conflicting)).toThrow(/conflicting context snapshot/i);
  });

  it("keeps raw release authority out of the cache fingerprint and bounded telemetry", () => {
    const snapshot = resolveRagContextSnapshot(snapshotInput());
    const cacheKey = ragContextSnapshotCacheKey(snapshot);
    const telemetry = ragContextSnapshotTelemetry(snapshot);
    const exposed = `${cacheKey}\n${JSON.stringify(telemetry)}`;

    expect(telemetry).toEqual({
      site_content_state: "current",
      site_content_static_manifest_match: true,
      site_content_pending_bucket: "none",
    });
    for (const forbidden of [
      snapshot.publicSiteContent.releaseId,
      snapshot.publicSiteContent.staticManifestDigest,
      snapshot.publicSiteContent.dynamicStateDigest,
      snapshot.publicSiteContent.releaseDigest,
      snapshot.publicSiteContent.changeEpoch,
      ...snapshot.publicSiteContent.pendingLogicalIds,
    ]) {
      if (forbidden !== null) expect(exposed).not.toContain(forbidden);
    }
  });

  it("fingerprints accepted corpus identities but excludes observational and raw release identity", () => {
    const baseline = resolveRagContextSnapshot(
      snapshotInput({
        resolvedAt: "2026-08-29T00:00:01.000Z",
        uploadedLocal: { indexGeneration: "uploaded-generation-1", activationDigest: `sha256:${"6".repeat(64)}` },
        australianPublic: { indexGeneration: "australian-generation-1", releaseDigest: `sha256:${"7".repeat(64)}` },
      }),
    );
    const observationalOnly = resolveRagContextSnapshot(
      snapshotInput({
        resolvedAt: "2026-08-29T00:00:02.000Z",
        activePublicSiteRelease: activeRelease({ releaseId: "22222222-2222-4222-8222-222222222222" }),
        uploadedLocal: baseline.uploadedLocal,
        australianPublic: baseline.australianPublic,
      }),
    );
    const uploadedChanged = resolveRagContextSnapshot(
      snapshotInput({
        uploadedLocal: { ...baseline.uploadedLocal, activationDigest: `sha256:${"8".repeat(64)}` },
        australianPublic: baseline.australianPublic,
      }),
    );
    const australianChanged = resolveRagContextSnapshot(
      snapshotInput({
        uploadedLocal: baseline.uploadedLocal,
        australianPublic: { ...baseline.australianPublic, releaseDigest: `sha256:${"9".repeat(64)}` },
      }),
    );

    expect(ragContextSnapshotCacheKey(observationalOnly)).toBe(ragContextSnapshotCacheKey(baseline));
    expect(ragContextSnapshotCacheKey(uploadedChanged)).not.toBe(ragContextSnapshotCacheKey(baseline));
    expect(ragContextSnapshotCacheKey(australianChanged)).not.toBe(ragContextSnapshotCacheKey(baseline));
  });

  it.each([
    [
      "registry mismatch",
      (input: SiteContentHealthInput) => ({
        ...input,
        activeRelease: { ...input.activeRelease!, registryVersion: "site-content-registry-v999" },
      }),
    ],
    ["deployment mismatch", (input: SiteContentHealthInput) => ({ ...input, deploymentSha: "5".repeat(40) })],
    [
      "integrity failure",
      (input: SiteContentHealthInput) => ({
        ...input,
        activeRelease: {
          ...input.activeRelease!,
          integrity: { ...input.activeRelease!.integrity, integrityVerified: false },
        },
      }),
    ],
    [
      "governance failure",
      (input: SiteContentHealthInput) => ({
        ...input,
        activeRelease: {
          ...input.activeRelease!,
          integrity: { ...input.activeRelease!.integrity, governanceVerified: false },
        },
      }),
    ],
    [
      "synchronizer unavailable",
      (input: SiteContentHealthInput) => ({
        ...input,
        queueHealth: { ...input.queueHealth, synchronizerDeployed: false },
      }),
    ],
    [
      "failed queue item",
      (input: SiteContentHealthInput) => ({
        ...input,
        queueHealth: { ...input.queueHealth, failedCount: 1 },
      }),
    ],
    [
      "over-age pending item",
      (_input: SiteContentHealthInput) => {
        const updating = updatingFullHealthAuthority();
        return { ...updating, queueHealth: { ...updating.queueHealth, oldestPendingAgeSeconds: 601 } };
      },
    ],
    [
      "pending set mismatch",
      (_input: SiteContentHealthInput) => {
        const updating = updatingFullHealthAuthority();
        const pendingLogicalIds = ["medications:valproate"];
        return {
          ...updating,
          queueHealth: {
            ...updating.queueHealth,
            pendingLogicalIds,
            pendingLogicalIdsDigest: siteContentPendingLogicalIdsDigest(pendingLogicalIds),
          },
        };
      },
    ],
    [
      "pending digest mismatch",
      (_input: SiteContentHealthInput) => {
        const updating = updatingFullHealthAuthority();
        return {
          ...updating,
          queueHealth: { ...updating.queueHealth, pendingLogicalIdsDigest: "fnv1a64:0000000000000000" },
        };
      },
    ],
  ] as const)("fails full Task 4 %s authority closed to identity-free unavailable", async (_label, mutate) => {
    const snapshot = await resolveFullHealthAuthority(mutate(fullHealthAuthority()) as SiteContentHealthInput);

    expect(snapshot.publicSiteContent).toMatchObject({
      state: "unavailable",
      registryVersion: null,
      releaseId: null,
      expectedStaticManifestDigest: null,
      activeStaticManifestDigest: null,
      dynamicStateDigest: null,
      releaseDigest: null,
      changeEpoch: null,
      pendingLogicalIds: [],
      pendingLogicalIdsDigest: null,
    });
  });

  it("accepts exact pending exclusions only after full health authority classifies updating", async () => {
    const authority = updatingFullHealthAuthority();
    const snapshot = await resolveFullHealthAuthority(authority);

    expect(snapshot.publicSiteContent).toMatchObject({
      state: "updating",
      changeEpoch: "43",
      pendingLogicalIds: ["medications:lithium"],
      pendingLogicalIdsDigest: authority.activeRelease!.pendingLogicalIdsDigest,
    });
  });

  it("permits stale only when static manifest mismatch is the sole full-health stop reason", async () => {
    const authority = fullHealthAuthority();
    const snapshot = await resolveFullHealthAuthority({
      ...authority,
      expectedStaticManifestDigest: `sha256:${"9".repeat(64)}`,
    });

    expect(snapshot.publicSiteContent).toMatchObject({
      state: "stale",
      staticManifestMatch: false,
      expectedStaticManifestDigest: `sha256:${"9".repeat(64)}`,
      activeStaticManifestDigest: authority.activeRelease!.staticManifestDigest,
    });
  });
});
