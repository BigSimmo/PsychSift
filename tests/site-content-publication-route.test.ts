import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SITE_CONTENT_RAG_PROGRAMME_GATE_DECISION_DIGEST,
  SITE_CONTENT_RAG_PROGRAMME_GATE_POLICY_DIGEST,
} from "../src/lib/site-content/site-content-gate-owners";
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

function releaseGateArtifacts(plan: SiteContentSyncPlan, observedAt = "2026-08-24T11:59:00.000Z") {
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
      gatePolicyDigest: SITE_CONTENT_RAG_PROGRAMME_GATE_POLICY_DIGEST,
      gateDecisionDigest: SITE_CONTENT_RAG_PROGRAMME_GATE_DECISION_DIGEST,
    }),
  };
}

async function loadRoute(
  role: "anonymous" | "authenticated" | "administrator",
  envOverrides: Record<string, string | undefined> = {},
) {
  let storedGateArtifacts: unknown = null;
  let deriveEffect: () => void = () => undefined;
  const rpc = vi.fn(async (name: string) => {
    if (name === "derive_site_content_release_gate_artifacts") deriveEffect();
    return {
      data:
        name === "read_site_content_release_gate_artifacts" ? storedGateArtifacts : { candidateReleaseId: "release-1" },
      error: null,
    };
  });
  const createBearerClient = vi.fn((_accessToken: string) => ({ rpc }));
  const adminRpc = vi.fn(async () => ({ data: { configured: true }, error: null }));
  vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: adminRpc }) }));
  vi.doMock("@/lib/env", () => ({
    env: {
      SUPABASE_PROJECT_REF: siteReleaseProjectRef,
      SITE_CONTENT_RECOVERY_VALIDATION_SECRET: "synthetic-validation-secret-with-32-bytes",
      SITE_CONTENT_GOVERNANCE_GATE_OWNER_SECRET: "synthetic-governance-secret-with-32-bytes",
      RAG_PROGRAMME_GATE_OWNER_SECRET: "synthetic-programme-secret-with-32-bytes",
      ...envOverrides,
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
    setDeriveEffect(value: () => void) {
      deriveEffect = value;
    },
  };
}

describe("administrator site-content publication route", () => {
  it.each(["anonymous", "authenticated"] as const)("rejects the %s role before mutation", async (role) => {
    const { route, rpc, adminRpc } = await loadRoute(role);
    const response = await route.POST(
      new Request("http://local/api/admin/site-content/publish", {
        method: "POST",
        body: JSON.stringify({ logicalId: "medication:alpha" }),
      }),
    );
    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
    expect(adminRpc).not.toHaveBeenCalled();
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

  it.each([
    ["provision-governance-secret", "provision_site_content_governance_gate_owner_secret"],
    ["provision-must-pass-secret", "provision_rag_programme_gate_owner_secret"],
  ] as const)("guards and provisions the fixed %s Vault counterpart", async (action, rpcName) => {
    const { route, rpc, adminRpc } = await loadRoute("administrator");
    const response = await route.POST(
      new Request("http://local/api/admin/site-content/publish", {
        method: "POST",
        body: JSON.stringify({ action, expectedCurrentDigest: null, rotationReason: null }),
      }),
    );
    expect(response.status).toBe(202);
    expect(rpc).not.toHaveBeenCalled();
    expect(adminRpc).toHaveBeenCalledWith(rpcName, {
      p_configuration: expect.objectContaining({ expectedCurrentDigest: null, rotationReason: null }),
    });
    expect(JSON.stringify(await response.json())).not.toContain("secret");
  });

  it("rejects missing or cross-purpose duplicate owner secret configuration", async () => {
    for (const envOverrides of [
      { SITE_CONTENT_GOVERNANCE_GATE_OWNER_SECRET: undefined },
      { RAG_PROGRAMME_GATE_OWNER_SECRET: "synthetic-validation-secret-with-32-bytes" },
    ]) {
      const { route, adminRpc } = await loadRoute("administrator", envOverrides);
      const response = await route.POST(
        new Request("http://local/api/admin/site-content/publish", {
          method: "POST",
          body: JSON.stringify({ action: "provision-governance-secret" }),
        }),
      );
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(adminRpc).not.toHaveBeenCalled();
    }
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

  it("validates SQL-derived public evidence against a post-derivation clock on the first attempt", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24T12:00:00.000Z"));
    const { route, rpc, setGateArtifacts, setDeriveEffect } = await loadRoute("administrator");
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
    setGateArtifacts(releaseGateArtifacts(plan, "2026-08-24T12:00:01.000Z"));
    setDeriveEffect(() => vi.setSystemTime(new Date("2026-08-24T12:00:02.000Z")));
    const response = await route.POST(
      new Request("http://local/api/admin/site-content/publish", {
        method: "POST",
        body: JSON.stringify({ action: "verify", plan }),
      }),
    );
    expect(response.status).toBe(202);
    expect(rpc).toHaveBeenCalledWith("verify_site_content_candidate_release", expect.any(Object));
  });
});
