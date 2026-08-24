import { afterEach, describe, expect, it, vi } from "vitest";

import { planSiteContentSync } from "../src/lib/site-content/site-content-sync";
import { createSiteContentReleaseVerificationEvidence } from "../src/lib/site-content/site-content-release-evidence";
import {
  fixtureSha,
  siteReleaseCandidateId,
  siteReleaseGenerationId,
  siteReleaseNow,
  siteReleasePreviousId,
  siteReleaseProjectRef,
  validSiteReleaseRecoveryFixture,
} from "./fixtures/site-release-recovery";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetModules();
});

async function loadRoute(role: "anonymous" | "authenticated" | "administrator") {
  const rpc = vi.fn(async () => ({ data: { candidateReleaseId: "release-1" }, error: null }));
  const adminRpc = vi.fn(async () => ({ data: { configured: true }, error: null }));
  vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: adminRpc }) }));
  vi.doMock("@/lib/env", () => ({
    env: {
      SUPABASE_PROJECT_REF: siteReleaseProjectRef,
      SITE_CONTENT_RECOVERY_VALIDATION_SECRET: "synthetic-validation-secret-with-32-bytes",
    },
  }));
  vi.doMock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ rpc }) }));
  vi.doMock("@/lib/supabase/auth", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../src/lib/supabase/auth")>();
    return {
      ...actual,
      requireAuthenticatedUser: async () => {
        if (role !== "administrator") throw new actual.AuthenticationError();
        return { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", appMetadata: { administrator: true } };
      },
    };
  });
  const route = await import("../src/app/api/admin/site-content/publish/route");
  return { route, rpc, adminRpc };
}

describe("administrator site-content publication route", () => {
  it.each(["anonymous", "authenticated"] as const)("rejects the %s role before mutation", async (role) => {
    const { route, rpc } = await loadRoute(role);
    const response = await route.POST(
      new Request("http://local/api/admin/site-content/publish", {
        method: "POST",
        body: JSON.stringify({ logicalId: "medication:alpha" }),
      }),
    );
    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("uses the single administrator-authenticated RPC without a spoofable authority flag", async () => {
    const { route, rpc } = await loadRoute("administrator");
    const record = { logicalId: "medication:alpha", candidateReleaseId: "release-1" };
    const response = await route.POST(
      new Request("http://local/api/admin/site-content/publish", {
        method: "POST",
        body: JSON.stringify(record),
      }),
    );
    expect(response.status).toBe(202);
    expect(rpc).toHaveBeenCalledWith("publish_site_content_record", { p_record: record });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("administrator_authorized");
  });

  it("begins a digest-bound candidate through the same administrator mutation authority", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(siteReleaseNow);
    const { route, rpc } = await loadRoute("administrator");
    const recovery = validSiteReleaseRecoveryFixture();
    const plan = planSiteContentSync({
      projectRef: siteReleaseProjectRef,
      expectedProjectRef: siteReleaseProjectRef,
      candidateReleaseId: siteReleaseCandidateId,
      previousReleaseId: siteReleasePreviousId,
      generationId: siteReleaseGenerationId,
      registryVersion: "site-content-registry-v1",
      staticManifestDigest: fixtureSha("8"),
      expectedEmbedding: { model: "synthetic", dimensions: 3 },
      desiredRecords: [],
      activeProjections: [],
      legacyRows: [],
      legacyDispositions: [],
      batchSize: 25,
      write: true,
      recoveryEvidence: recovery.evidence,
      now: siteReleaseNow,
    });
    const response = await route.POST(
      new Request("http://local/api/admin/site-content/publish", {
        method: "POST",
        body: JSON.stringify({ action: "begin", plan }),
      }),
    );
    expect(response.status).toBe(202);
    expect(rpc).toHaveBeenCalledWith("begin_site_content_candidate_release", {
      p_plan: plan,
      p_validation_binding: expect.objectContaining({ purpose: "begin", projectRef: siteReleaseProjectRef }),
    });
  });

  it("provisions only the protected Vault counterpart through the service-role client", async () => {
    const { route, rpc, adminRpc } = await loadRoute("administrator");
    const response = await route.POST(
      new Request("http://local/api/admin/site-content/publish", {
        method: "POST",
        body: JSON.stringify({ action: "provision-secret", expectedCurrentDigest: null, rotationReason: null }),
      }),
    );
    expect(response.status).toBe(202);
    expect(rpc).not.toHaveBeenCalled();
    expect(adminRpc).toHaveBeenCalledWith("provision_site_content_validation_secret", {
      p_configuration: {
        secret: "synthetic-validation-secret-with-32-bytes",
        expectedCurrentDigest: null,
        rotationReason: null,
      },
    });
  });

  it("signs canonical independent verification evidence instead of caller flags", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(siteReleaseNow);
    const { route, rpc } = await loadRoute("administrator");
    const recovery = validSiteReleaseRecoveryFixture();
    const plan = planSiteContentSync({
      projectRef: siteReleaseProjectRef,
      expectedProjectRef: siteReleaseProjectRef,
      candidateReleaseId: siteReleaseCandidateId,
      previousReleaseId: siteReleasePreviousId,
      generationId: siteReleaseGenerationId,
      registryVersion: "site-content-registry-v1",
      staticManifestDigest: fixtureSha("8"),
      expectedEmbedding: { model: "synthetic", dimensions: 3 },
      desiredRecords: [],
      activeProjections: [],
      legacyRows: [],
      legacyDispositions: [],
      batchSize: 25,
      write: true,
      recoveryEvidence: recovery.evidence,
      now: siteReleaseNow,
    });
    const verificationEvidence = createSiteContentReleaseVerificationEvidence(plan, {
      publicVisibility: { observedLogicalIds: [], checkedAt: siteReleaseNow.toISOString() },
      governance: {
        reviewedLogicalIds: [],
        reviewEvidenceDigest: fixtureSha("4"),
        checkedAt: siteReleaseNow.toISOString(),
      },
      mustPass: {
        caseSetDigest: fixtureSha("5"),
        caseResults: [{ caseId: "empty-release", outcome: "passed" }],
        checkedAt: siteReleaseNow.toISOString(),
      },
    });
    const response = await route.POST(
      new Request("http://local/api/admin/site-content/publish", {
        method: "POST",
        body: JSON.stringify({ action: "verify", plan, verificationEvidence, flags: { integrity: true } }),
      }),
    );
    expect(response.status).toBe(202);
    expect(rpc).toHaveBeenCalledWith("verify_site_content_candidate_release", {
      p_verification: { plan, verificationEvidence },
      p_validation_binding: expect.objectContaining({ purpose: "verify" }),
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("flags");
  });
});
