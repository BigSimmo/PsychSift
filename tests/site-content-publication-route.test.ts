import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SITE_CONTENT_MUST_PASS_CASE_IDS,
  SITE_CONTENT_MUST_PASS_CASE_SET_FINGERPRINT,
} from "../src/lib/site-content/site-content-release-evidence";
import {
  planSiteContentSync,
  siteContentSyncDigest,
  type SiteContentSyncPlan,
} from "../src/lib/site-content/site-content-sync";
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

function releaseGateArtifacts(plan: SiteContentSyncPlan) {
  const observedAt = "2026-08-24T11:59:00.000Z";
  const subject = {
    projectRef: plan.projectRef,
    releaseId: plan.candidateReleaseId,
    planDigest: plan.planDigest,
    releaseDigest: plan.releaseDigest,
  };
  const subjectDigest = siteContentSyncDigest(subject);
  const population = plan.operations
    .filter((operation) => operation.operation !== "tombstone")
    .map(({ logicalId, contentHash }) => ({ logicalId, contentHash }));
  const receipt = <T extends object>(value: T) => ({ ...value, digest: siteContentSyncDigest(value) });
  return {
    version: "site-content-release-gate-artifacts-v1",
    subject,
    subjectDigest,
    publicVisibility: receipt({
      owner: "public-site-content-reader-v1",
      subjectDigest,
      observedAt,
      population,
      populationDigest: siteContentSyncDigest(population),
    }),
    governance: receipt({
      owner: "site-content-governance-registry-v1",
      subjectDigest,
      observedAt,
      population,
      registryVersion: plan.registryVersion,
      staticManifestDigest: plan.staticManifestDigest,
      sourceStatus: "current",
      validationStatus: "locally_reviewed",
    }),
    mustPass: receipt({
      owner: "rag-programme-eval-v1",
      subjectDigest,
      observedAt,
      caseSetFingerprint: SITE_CONTENT_MUST_PASS_CASE_SET_FINGERPRINT,
      evaluatedCaseIds: [...SITE_CONTENT_MUST_PASS_CASE_IDS],
      failedCaseIds: [],
      runDigest: fixtureSha("4"),
    }),
  };
}

async function loadRoute(role: "anonymous" | "authenticated" | "administrator") {
  let storedGateArtifacts: unknown = null;
  const rpc = vi.fn(async (name: string) => ({
    data:
      name === "read_site_content_release_gate_artifacts" ? storedGateArtifacts : { candidateReleaseId: "release-1" },
    error: null,
  }));
  const createBearerClient = vi.fn((_accessToken: string) => ({ rpc }));
  const adminRpc = vi.fn(async () => ({ data: { configured: true }, error: null }));
  vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: adminRpc }) }));
  vi.doMock("@/lib/env", () => ({
    env: {
      SUPABASE_PROJECT_REF: siteReleaseProjectRef,
      SITE_CONTENT_RECOVERY_VALIDATION_SECRET: "synthetic-validation-secret-with-32-bytes",
    },
  }));
  vi.doMock("@/lib/supabase/server", () => ({
    createSupabaseServerClient: async () => ({ rpc }),
    createSupabaseBearerServerClient: createBearerClient,
  }));
  vi.doMock("@/lib/supabase/auth", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../src/lib/supabase/auth")>();
    return {
      ...actual,
      requireAuthenticatedUser: async (request: Request) => {
        if (role !== "administrator") throw new actual.AuthenticationError();
        const authorization = request.headers.get("authorization");
        if (authorization && authorization !== "Bearer synthetic-administrator-jwt") {
          throw new actual.AuthenticationError();
        }
        return { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", appMetadata: { administrator: true } };
      },
    };
  });
  const route = await import("../src/app/api/admin/site-content/publish/route");
  return {
    route,
    rpc,
    adminRpc,
    createBearerClient,
    setGateArtifacts(value: unknown) {
      storedGateArtifacts = value;
    },
  };
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

  it("preserves the validated administrator bearer on the mutation RPC client", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(siteReleaseNow);
    const { route, rpc, createBearerClient } = await loadRoute("administrator");
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
        headers: { authorization: "Bearer synthetic-administrator-jwt" },
        body: JSON.stringify({ action: "begin", plan }),
      }),
    );
    expect(response.status).toBe(202);
    expect(createBearerClient).toHaveBeenCalledWith("synthetic-administrator-jwt");
    expect(rpc).toHaveBeenCalledWith("begin_site_content_candidate_release", expect.any(Object));
  });

  it("rejects an invalid bearer before constructing or invoking a mutation client", async () => {
    const { route, rpc, createBearerClient } = await loadRoute("administrator");
    const response = await route.POST(
      new Request("http://local/api/admin/site-content/publish", {
        method: "POST",
        headers: { authorization: "Bearer wrong-administrator-jwt" },
        body: JSON.stringify({ action: "publish", record: { logicalId: "medication:alpha" } }),
      }),
    );
    expect(response.status).toBe(401);
    expect(createBearerClient).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
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
    const { route, rpc, setGateArtifacts } = await loadRoute("administrator");
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
    setGateArtifacts(releaseGateArtifacts(plan));
    const response = await route.POST(
      new Request("http://local/api/admin/site-content/publish", {
        method: "POST",
        body: JSON.stringify({ action: "verify", plan, flags: { integrity: true } }),
      }),
    );
    expect(response.status).toBe(202);
    expect(rpc).toHaveBeenCalledWith("verify_site_content_candidate_release", {
      p_verification: {
        plan,
        verificationEvidence: expect.objectContaining({ version: "site-content-release-verification-v2" }),
      },
      p_validation_binding: expect.objectContaining({ purpose: "verify" }),
    });
    expect(rpc).toHaveBeenCalledWith("read_site_content_release_gate_artifacts", {
      p_release_id: plan.candidateReleaseId,
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("flags");
  });
});
