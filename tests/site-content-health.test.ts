import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { classifySiteContentHealth, healthResponse, type SiteContentHealthInput } from "@/lib/health-response";
import { siteContentPendingLogicalIdsDigest } from "@/lib/site-content/site-content-registry";

const fixturePath = resolve("tests/fixtures/site-content/release-evidence-current.json");

function currentEvidence(): SiteContentHealthInput {
  return JSON.parse(readFileSync(fixturePath, "utf8")) as SiteContentHealthInput;
}

function updatingEvidence(): SiteContentHealthInput {
  const input = currentEvidence();
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

function unchangedCandidateEvidence(oldestPendingAgeSeconds: number | null = 120): SiteContentHealthInput {
  const input = currentEvidence();
  return {
    ...input,
    activeRelease: {
      ...input.activeRelease!,
      integrity: { ...input.activeRelease!.integrity, directSuccessorCandidateCount: 1 },
    },
    queueHealth: {
      ...input.queueHealth,
      oldestPendingAgeSeconds,
    },
  };
}

async function routeResponse(path: "/api/health" | "/api/health/ready", evidence: unknown) {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-28T00:05:00.000Z"));
  vi.doMock("@/lib/site-content/site-content-health-authority", () => ({
    collectSiteContentHealthInput: vi.fn(async () => evidence),
  }));
  vi.doMock("@/lib/env", () => ({
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
      OPENAI_API_KEY: "test-openai-key",
      RAG_PROVIDER_MODE: "offline",
      HEALTH_DEEP_PROBE_SECRET: undefined,
    },
    isDemoMode: () => true,
  }));
  const route =
    path === "/api/health"
      ? await import("../src/app/api/health/route")
      : await import("../src/app/api/health/ready/route");
  return route.GET(new Request(`http://health.test${path}`));
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("site-content activation health", () => {
  it("classifies one complete digest-bound static and dynamic release as current", () => {
    const result = classifySiteContentHealth(currentEvidence());

    expect(result.stopReasons).toEqual([]);
    expect(result.health).toEqual({
      publicReleaseId: "00000000-0000-4000-8000-000000000004",
      staticManifestMatch: true,
      releaseDigestPrefix: "sha256:333333333333",
      state: "current",
      synchronizerDeployed: true,
      synchronizerInvocationFresh: true,
      queue: { pendingCount: 0, oldestPendingAgeSeconds: null, failedCount: 0 },
      lastActivation: "2026-08-28T00:00:00.000Z",
      rollbackAvailable: true,
    });
  });

  it("allows a valid administrator publication to update without a static digest or deployment change", () => {
    const input = updatingEvidence();
    const result = classifySiteContentHealth(input);

    expect(result.stopReasons).toEqual([]);
    expect(result.health).toMatchObject({
      staticManifestMatch: true,
      state: "updating",
      synchronizerDeployed: true,
      synchronizerInvocationFresh: true,
      queue: { pendingCount: 1, oldestPendingAgeSeconds: 120, failedCount: 0 },
    });
  });

  it("keeps a young all-unchanged direct candidate updating with a numeric candidate age", () => {
    const result = classifySiteContentHealth(unchangedCandidateEvidence());

    expect(result.stopReasons).toEqual([]);
    expect(result.health).toMatchObject({
      state: "updating",
      queue: { pendingCount: 0, oldestPendingAgeSeconds: 120, failedCount: 0 },
    });
  });

  it("requires candidate age and stops an over-age all-unchanged direct candidate", () => {
    const missingAge = classifySiteContentHealth(unchangedCandidateEvidence(null));
    const overAge = classifySiteContentHealth(unchangedCandidateEvidence(601));

    expect(missingAge.stopReasons).toContain("invalid_queue_health");
    expect(missingAge.health.state).toBe("failure");
    expect(overAge.stopReasons).toContain("pending_item_over_age");
    expect(overAge.stopReasons).not.toContain("invalid_queue_health");
    expect(overAge.health.state).toBe("failure");
  });

  it.each([
    [
      "missing static digest",
      (input: SiteContentHealthInput) => ({ ...input, expectedStaticManifestDigest: "" }),
      "invalid_expected_static_digest",
    ],
    [
      "static digest mismatch",
      (input: SiteContentHealthInput) => ({
        ...input,
        expectedStaticManifestDigest: `sha256:${"9".repeat(64)}`,
      }),
      "static_manifest_mismatch",
    ],
    [
      "missing dynamic digest",
      (input: SiteContentHealthInput) => ({
        ...input,
        activeRelease: { ...input.activeRelease!, dynamicStateDigest: "" },
      }),
      "invalid_dynamic_state_digest",
    ],
    [
      "missing release digest",
      (input: SiteContentHealthInput) => ({
        ...input,
        activeRelease: { ...input.activeRelease!, releaseDigest: "" },
      }),
      "invalid_release_digest",
    ],
    [
      "partial population",
      (input: SiteContentHealthInput) => ({
        ...input,
        activeRelease: {
          ...input.activeRelease!,
          integrity: { ...input.activeRelease!.integrity, publishedRecordCount: 2 },
        },
      }),
      "partial_population",
    ],
    [
      "untracked deletion",
      (input: SiteContentHealthInput) => ({
        ...input,
        activeRelease: {
          ...input.activeRelease!,
          integrity: { ...input.activeRelease!.integrity, untrackedDeletionCount: 1 },
        },
      }),
      "untracked_deletion",
    ],
    [
      "duplicate publication",
      (input: SiteContentHealthInput) => ({
        ...input,
        activeRelease: {
          ...input.activeRelease!,
          integrity: { ...input.activeRelease!.integrity, duplicatePublishedLogicalIdCount: 1 },
        },
      }),
      "duplicate_published_logical_id",
    ],
    [
      "non-admin publication",
      (input: SiteContentHealthInput) => ({
        ...input,
        activeRelease: {
          ...input.activeRelease!,
          integrity: { ...input.activeRelease!.integrity, nonAdminPublicationCount: 1 },
        },
      }),
      "non_admin_publication",
    ],
    [
      "deployment mismatch",
      (input: SiteContentHealthInput) => ({ ...input, deploymentSha: "5".repeat(40) }),
      "deployment_sha_mismatch",
    ],
    [
      "failed queue item",
      (input: SiteContentHealthInput) => ({
        ...input,
        queueHealth: { ...input.queueHealth, failedCount: 1 },
      }),
      "failed_queue_item",
    ],
    [
      "stale worker heartbeat",
      (input: SiteContentHealthInput) => ({
        ...input,
        queueHealth: { ...input.queueHealth, lastHeartbeatAt: "2026-08-27T23:50:00.000Z" },
      }),
      "stale_worker_heartbeat",
    ],
    [
      "stale worker invocation",
      (input: SiteContentHealthInput) => ({
        ...input,
        queueHealth: { ...input.queueHealth, lastInvocationAt: "2026-08-27T23:50:00.000Z" },
      }),
      "stale_worker_invocation",
    ],
  ])("fails closed for %s", (_label, mutate, reason) => {
    const result = classifySiteContentHealth(mutate(currentEvidence()));

    expect(result.health.state).toBe("failure");
    expect(result.stopReasons).toContain(reason);
  });

  it("keeps unreviewed and reviewed-but-ineligible domains as distinct failures", () => {
    const input = currentEvidence();
    const domains = input.activeRelease!.integrity.domains;
    const unreviewed = classifySiteContentHealth({
      ...input,
      activeRelease: {
        ...input.activeRelease!,
        integrity: {
          ...input.activeRelease!.integrity,
          domains: [{ ...domains[0]!, reviewState: "unreviewed" }, ...domains.slice(1)],
        },
      },
    });
    const reviewedIneligible = classifySiteContentHealth({
      ...input,
      activeRelease: {
        ...input.activeRelease!,
        integrity: {
          ...input.activeRelease!.integrity,
          domains: [{ ...domains[0]!, eligibility: "reviewed_ineligible" }, ...domains.slice(1)],
        },
      },
    });

    expect(unreviewed.stopReasons).toContain("unreviewed_domain");
    expect(unreviewed.stopReasons).not.toContain("reviewed_ineligible_domain");
    expect(reviewedIneligible.stopReasons).toContain("reviewed_ineligible_domain");
    expect(reviewedIneligible.stopReasons).not.toContain("unreviewed_domain");
  });

  it("binds the active release to the canonical registry version and complete unique domain evidence", () => {
    const input = currentEvidence();
    const integrity = input.activeRelease!.integrity;
    const invalid = [
      classifySiteContentHealth({
        ...input,
        activeRelease: { ...input.activeRelease!, registryVersion: "site-content-registry-v999" },
      }),
      classifySiteContentHealth({
        ...input,
        activeRelease: { ...input.activeRelease!, integrity: { ...integrity, domains: integrity.domains.slice(1) } },
      }),
      classifySiteContentHealth({
        ...input,
        activeRelease: {
          ...input.activeRelease!,
          integrity: { ...integrity, domains: [...integrity.domains, integrity.domains[0]!] },
        },
      }),
      classifySiteContentHealth({
        ...input,
        activeRelease: {
          ...input.activeRelease!,
          integrity: {
            ...integrity,
            domains: [{ ...integrity.domains[0]!, domain: "unknown-domain" }, ...integrity.domains.slice(1)],
          },
        },
      }),
    ];

    expect(invalid[0]!.stopReasons).toContain("registry_version_mismatch");
    for (const result of invalid.slice(1)) {
      expect(result.stopReasons).toContain("domain_evidence_mismatch");
      expect(result.health.state).toBe("failure");
    }
  });

  it("requires the complete canonical domain-disposition set and its digest", () => {
    const input = currentEvidence();
    const integrity = input.activeRelease!.integrity;
    const dispositions = integrity.domainDispositions;
    const omittedReviewedIneligible = classifySiteContentHealth({
      ...input,
      activeRelease: {
        ...input.activeRelease!,
        integrity: { ...integrity, domainDispositions: dispositions.slice(0, -1) },
      },
    });
    const duplicate = classifySiteContentHealth({
      ...input,
      activeRelease: {
        ...input.activeRelease!,
        integrity: { ...integrity, domainDispositions: [...dispositions, dispositions[0]!] },
      },
    });
    const unknown = classifySiteContentHealth({
      ...input,
      activeRelease: {
        ...input.activeRelease!,
        integrity: {
          ...integrity,
          domainDispositions: [{ domain: "unknown-domain", disposition: "eligible" }, ...dispositions.slice(1)],
        },
      },
    });
    const wrongDigest = classifySiteContentHealth({
      ...input,
      activeRelease: {
        ...input.activeRelease!,
        integrity: { ...integrity, domainDispositionDigest: `sha256:${"9".repeat(64)}` },
      },
    });

    for (const result of [omittedReviewedIneligible, duplicate, unknown, wrongDigest]) {
      expect(result.stopReasons).toContain("domain_disposition_mismatch");
      expect(result.health.state).toBe("failure");
    }
  });

  it("never projects a malformed public release identity", () => {
    const input = currentEvidence();
    const result = classifySiteContentHealth({
      ...input,
      activeRelease: { ...input.activeRelease!, releaseId: "internal-release-row-42" },
    });

    expect(result.stopReasons).toContain("invalid_release_identity");
    expect(result.health.publicReleaseId).toBeNull();
    expect(result.health.state).toBe("failure");
  });

  it("requires the exact pending exclusion set, epoch, fresh worker, and ten-minute ceiling", () => {
    const valid = updatingEvidence();
    const wrongDigest = classifySiteContentHealth({
      ...valid,
      queueHealth: { ...valid.queueHealth, pendingLogicalIdsDigest: "fnv1a64:0000000000000000" },
    });
    const wrongEpoch = classifySiteContentHealth({
      ...valid,
      queueHealth: { ...valid.queueHealth, changeEpoch: "44" },
    });
    const overAge = classifySiteContentHealth({
      ...valid,
      queueHealth: { ...valid.queueHealth, oldestPendingAgeSeconds: 601 },
    });
    const absentWorker = classifySiteContentHealth({
      ...valid,
      queueHealth: { ...valid.queueHealth, synchronizerDeployed: false },
    });

    expect(wrongDigest.stopReasons).toContain("pending_exclusion_mismatch");
    expect(wrongEpoch.stopReasons).toContain("pending_epoch_mismatch");
    expect(overAge.stopReasons).toContain("pending_item_over_age");
    expect(absentWorker.stopReasons).toContain("synchronizer_not_deployed");
    for (const result of [wrongDigest, wrongEpoch, overAge, absentWorker]) {
      expect(result.health.state).toBe("failure");
    }
  });

  it("fails stale source or validation state without treating the domain as unreviewed", () => {
    const input = currentEvidence();
    const domains = input.activeRelease!.integrity.domains;
    const staleSource = classifySiteContentHealth({
      ...input,
      activeRelease: {
        ...input.activeRelease!,
        integrity: {
          ...input.activeRelease!.integrity,
          domains: [{ ...domains[0]!, sourceStatus: "review_due" }, ...domains.slice(1)],
        },
      },
    });
    const staleValidation = classifySiteContentHealth({
      ...input,
      activeRelease: {
        ...input.activeRelease!,
        integrity: {
          ...input.activeRelease!.integrity,
          domains: [{ ...domains[0]!, validationStatus: "unverified" }, ...domains.slice(1)],
        },
      },
    });

    expect(staleSource.stopReasons).toContain("stale_source_status");
    expect(staleValidation.stopReasons).toContain("stale_validation_status");
    expect(staleSource.stopReasons).not.toContain("unreviewed_domain");
    expect(staleValidation.stopReasons).not.toContain("unreviewed_domain");
  });

  it("projects only the bounded privacy-safe release health fields", async () => {
    const input = currentEvidence() as SiteContentHealthInput & Record<string, unknown>;
    input.actorId = "administrator-007";
    input.providerError = "provider-secret-message";
    input.route = "/private/record/42";

    const response = await healthResponse(new Request("http://health.test/api/health"), {
      siteContentHealthInput: input,
    });
    const body = (await response.json()) as Record<string, unknown>;
    const projection = body.siteContent as Record<string, unknown>;
    const serialized = JSON.stringify(projection);

    expect(Object.keys(projection)).toEqual([
      "publicReleaseId",
      "staticManifestMatch",
      "releaseDigestPrefix",
      "state",
      "synchronizerDeployed",
      "synchronizerInvocationFresh",
      "queue",
      "lastActivation",
      "rollbackAvailable",
    ]);
    expect(serialized).not.toContain(input.activeRelease!.releaseDigest);
    expect(serialized).not.toContain("changeEpoch");
    expect(serialized).not.toContain("administrator-007");
    expect(serialized).not.toContain("provider-secret-message");
    expect(serialized).not.toContain("/private/record/42");
  });

  it.each(["/api/health", "/api/health/ready"] as const)(
    "wires current server-only evidence into %s without provider calls",
    async (path) => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const response = await routeResponse(path, currentEvidence());
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(body.status).toBe("ok");
      expect(body.siteContent).toMatchObject({
        publicReleaseId: "00000000-0000-4000-8000-000000000004",
        state: "current",
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it.each(["/api/health", "/api/health/ready"] as const)(
    "fails %s when the actual runtime SHA differs from the active release",
    async (path) => {
      const input = currentEvidence();
      const response = await routeResponse(path, { ...input, deploymentSha: "5".repeat(40) });
      expect(response.status).toBe(503);
      expect((await response.json()) as Record<string, unknown>).toMatchObject({
        status: "degraded",
        siteContent: { state: "failure" },
      });
    },
  );

  it.each(["/api/health", "/api/health/ready"] as const)(
    "fails %s when an internally fresh authority observation is wall-clock old",
    async (path) => {
      const input = currentEvidence();
      const staleResponse = await routeResponse(path, {
        ...input,
        activeRelease: { ...input.activeRelease!, activatedAt: "2026-08-27T23:50:00.000Z" },
        queueHealth: {
          ...input.queueHealth,
          observedAt: "2026-08-27T23:55:00.000Z",
          lastHeartbeatAt: "2026-08-27T23:54:30.000Z",
          lastInvocationAt: "2026-08-27T23:54:00.000Z",
        },
      });
      expect(staleResponse.status).toBe(503);
    },
  );

  it.each(["/api/health", "/api/health/ready"] as const)(
    "projects an updating server-only release through %s",
    async (path) => {
      const response = await routeResponse(path, updatingEvidence());
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(body.status).toBe("ok");
      expect(body.siteContent).toMatchObject({
        state: "updating",
        queue: { pendingCount: 1, oldestPendingAgeSeconds: 120, failedCount: 0 },
      });
    },
  );

  it.each(["/api/health", "/api/health/ready"] as const)(
    "fails %s readiness closed when server-only evidence is missing",
    async (path) => {
      const response = await routeResponse(path, undefined);
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(503);
      expect(body.status).toBe("degraded");
      expect(body.siteContent).toMatchObject({ publicReleaseId: null, state: "failure" });
    },
  );

  it.each(["/api/health", "/api/health/ready"] as const)(
    "fails %s readiness closed when server-only evidence is invalid",
    async (path) => {
      const response = await routeResponse(path, {});
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(503);
      expect(body.status).toBe("degraded");
      expect(body.siteContent).toMatchObject({ publicReleaseId: null, state: "failure" });
    },
  );

  it.each(["/api/health", "/api/health/ready"] as const)(
    "fails %s readiness closed when server-only evidence is stale",
    async (path) => {
      const input = currentEvidence();
      const staleEvidence: SiteContentHealthInput = {
        ...input,
        queueHealth: {
          ...input.queueHealth,
          lastHeartbeatAt: "2026-08-27T23:50:00.000Z",
        },
      };
      const response = await routeResponse(path, staleEvidence);
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(503);
      expect(body.siteContent).toMatchObject({ state: "failure" });
    },
  );
});
