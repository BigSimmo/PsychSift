import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CROSS_TENANT_OFFLINE_ANSWER_CODES,
  crossTenantDocumentIds,
  crossTenantFixtureMarker,
  crossTenantStagingFetch,
  readCrossTenantStagingConfig,
  requestCrossTenantAppJson,
  verifyCrossTenantDeploymentIdentity,
} from "../scripts/test-cross-tenant-staging";
import { analyzeClinicalQuery } from "../src/lib/clinical-search";
import { shouldApplyUnsupportedSearchShortCircuit } from "../src/lib/rag/rag-retrieval-variants";

const validConfig = {
  CROSS_TENANT_STAGING_APP_URL: "https://clinical-kb-staging.tests.invalid",
  CROSS_TENANT_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  CROSS_TENANT_PROJECT_REF: "abcdefghijklmnopqrst",
  CROSS_TENANT_PUBLISHABLE_KEY: "staging-publishable-key",
  CROSS_TENANT_SERVICE_ROLE_KEY: "staging-service-role-key",
  CROSS_TENANT_USER_A_EMAIL: "tenancy-a@tests.invalid",
  CROSS_TENANT_USER_A_PASSWORD: "staging-a-password",
  CROSS_TENANT_USER_B_EMAIL: "tenancy-b@tests.invalid",
  CROSS_TENANT_USER_B_PASSWORD: "staging-b-password",
  CROSS_TENANT_CHECKOUT_COMMIT_SHA: "0123456789abcdef0123456789abcdef01234567",
} as const;

function stubConfig(overrides: Partial<Record<keyof typeof validConfig, string>> = {}) {
  for (const [key, value] of Object.entries({ ...validConfig, ...overrides })) vi.stubEnv(key, value);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("cross-tenant staging configuration safety", () => {
  it("uses a unique clinically anchored marker that reaches lexical retrieval", () => {
    const marker = crossTenantFixtureMarker("12345678-1234-4234-8234-123456789abc", "a");
    const analysis = analyzeClinicalQuery(marker);

    expect(marker).toBe("lithium tenancyprobe123456781234a");
    expect(shouldApplyUnsupportedSearchShortCircuit(marker, analysis)).toBe(false);
  });

  it("prefers document_id over a chunk id in search and answer sources", () => {
    expect(crossTenantDocumentIds([{ id: "chunk-id", document_id: "document-id" }], "sources")).toEqual([
      "document-id",
    ]);
  });

  it("passes a bounded abort signal to Supabase transport calls", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));

    await crossTenantStagingFetch("https://staging.tests.invalid/rest/v1/documents", {}, 1_000);

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://staging.tests.invalid/rest/v1/documents",
      expect.objectContaining({ redirect: "error", signal: expect.any(AbortSignal) }),
    );
    fetchSpy.mockRestore();
  });

  it("refuses redirects for authenticated app requests", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }),
      );

    await requestCrossTenantAppJson("https://staging.tests.invalid", "/api/documents", {
      redirect: "follow",
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://staging.tests.invalid/api/documents",
      expect.objectContaining({ redirect: "error", signal: expect.any(AbortSignal) }),
    );
  });

  it("accepts a dedicated, internally consistent staging configuration", () => {
    stubConfig();
    expect(readCrossTenantStagingConfig()).toMatchObject({
      projectRef: "abcdefghijklmnopqrst",
      documentBucket: "clinical-documents",
    });
  });

  it("rejects the production project before clients or fixtures are created", () => {
    stubConfig({
      CROSS_TENANT_PROJECT_REF: "sjrfecxgysukkwxsowpy",
      CROSS_TENANT_SUPABASE_URL: "https://sjrfecxgysukkwxsowpy.supabase.co",
    });
    expect(() => readCrossTenantStagingConfig()).toThrow(/Refusing.*production Supabase project/);
  });

  it("rejects the production application host and its subdomains", () => {
    stubConfig({ CROSS_TENANT_STAGING_APP_URL: "https://psychiatry.tools" });
    expect(() => readCrossTenantStagingConfig()).toThrow(/production application host/);

    stubConfig({ CROSS_TENANT_STAGING_APP_URL: "https://preview.psychiatry.tools" });
    expect(() => readCrossTenantStagingConfig()).toThrow(/production application host/);
  });

  it("requires a full checkout commit SHA", () => {
    stubConfig({ CROSS_TENANT_CHECKOUT_COMMIT_SHA: "0123456" });
    expect(() => readCrossTenantStagingConfig()).toThrow(/full 40-character Git commit SHA/);
  });

  it("requires the staging deployment health SHA to exactly match the checkout", async () => {
    stubConfig();
    const config = readCrossTenantStagingConfig();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          deploymentCommitSha: validConfig.CROSS_TENANT_CHECKOUT_COMMIT_SHA,
          checks: { openaiConfig: "skipped" },
        }),
        { status: 200 },
      ),
    );
    await expect(verifyCrossTenantDeploymentIdentity(config)).resolves.toBe(
      validConfig.CROSS_TENANT_CHECKOUT_COMMIT_SHA,
    );

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ deploymentCommitSha: "abcdefabcdefabcdefabcdefabcdefabcdefabcd" }), {
        status: 200,
      }),
    );
    await expect(verifyCrossTenantDeploymentIdentity(config)).rejects.toThrow(/does not match checkout SHA/);
  });

  it("requires /api/health to report the offline, keyless provider profile", async () => {
    stubConfig();
    const config = readCrossTenantStagingConfig();
    for (const openaiConfig of ["ok", "missing", undefined]) {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            deploymentCommitSha: validConfig.CROSS_TENANT_CHECKOUT_COMMIT_SHA,
            checks: openaiConfig === undefined ? {} : { openaiConfig },
          }),
          { status: 200 },
        ),
      );
      await expect(verifyCrossTenantDeploymentIdentity(config)).rejects.toThrow(/RAG_PROVIDER_MODE=offline/);
    }
  });

  it("accepts evidence-gate reasons on the offline answer but never a provider-call reason", () => {
    // The synthetic fixture cannot support a clinical answer, so offline staging answers it with
    // an evidence-gate code (low_signal for the lithium anchor), not provider_offline.
    for (const code of ["provider_offline", "low_signal", "coverage_gap", "no_candidates", "unsupported"]) {
      expect(CROSS_TENANT_OFFLINE_ANSWER_CODES.has(code)).toBe(true);
    }
    for (const code of [
      "provider_missing_key",
      "provider_auth",
      "provider_quota",
      "provider_rate_limit",
      "provider_timeout",
      "provider_failure",
      "unknown",
    ]) {
      expect(CROSS_TENANT_OFFLINE_ANSWER_CODES.has(code)).toBe(false);
    }
  });

  it("rejects missing or malformed deployment identity metadata", async () => {
    stubConfig();
    const config = readCrossTenantStagingConfig();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "ok" }), { status: 200 }),
    );
    await expect(verifyCrossTenantDeploymentIdentity(config)).rejects.toThrow(/full deploymentCommitSha/);
  });

  it("rejects a URL/ref mismatch, placeholders, and duplicate users", () => {
    stubConfig({ CROSS_TENANT_SUPABASE_URL: "https://zzzzzzzzzzzzzzzzzzzz.supabase.co" });
    expect(() => readCrossTenantStagingConfig()).toThrow(/does not match/);

    stubConfig({ CROSS_TENANT_SERVICE_ROLE_KEY: "replace-with-staging-key" });
    expect(() => readCrossTenantStagingConfig()).toThrow(/placeholder/);

    stubConfig({ CROSS_TENANT_USER_B_EMAIL: validConfig.CROSS_TENANT_USER_A_EMAIL });
    expect(() => readCrossTenantStagingConfig()).toThrow(/different users/);
  });

  it("rejects a shared password across distinct test users", () => {
    stubConfig({ CROSS_TENANT_USER_B_PASSWORD: validConfig.CROSS_TENANT_USER_A_PASSWORD });

    expect(() => readCrossTenantStagingConfig()).toThrow(/distinct passwords/);
  });
});
