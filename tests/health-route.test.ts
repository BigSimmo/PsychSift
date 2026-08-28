import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const DEEP_TOKEN = "deep-probe-secret";
const CURRENT_SITE_CONTENT_EVIDENCE = JSON.parse(
  readFileSync(resolve("tests/fixtures/site-content/release-evidence-current.json"), "utf8"),
) as unknown;

function mockEnv(options: {
  configured: boolean;
  openAIConfigured?: boolean;
  demoMode?: boolean;
  deepSecret?: boolean;
  providerMode?: "auto" | "openai" | "offline";
  siteContentEvidence?: unknown;
}) {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  const openAIConfigured = options.openAIConfigured ?? options.configured;
  vi.doMock("@/lib/env", () => ({
    env: {
      NEXT_PUBLIC_SUPABASE_URL: options.configured ? "https://sjrfecxgysukkwxsowpy.supabase.co" : undefined,
      SUPABASE_SERVICE_ROLE_KEY: options.configured ? "service-role-key" : undefined,
      OPENAI_API_KEY: openAIConfigured ? "openai-key" : undefined,
      RAG_PROVIDER_MODE: options.providerMode ?? "auto",
      HEALTH_DEEP_PROBE_SECRET: options.deepSecret ? DEEP_TOKEN : undefined,
    },
    isDemoMode: () => Boolean(options.demoMode),
  }));
  vi.doMock("@/lib/site-content/site-content-health-authority", () => ({
    collectSiteContentHealthInput: vi.fn(async () => options.siteContentEvidence ?? CURRENT_SITE_CONTENT_EVIDENCE),
  }));
  vi.setSystemTime(new Date("2026-08-28T00:05:00.000Z"));
}

function healthRequest(query = "", headers?: HeadersInit) {
  return new Request(`http://localhost/api/health${query}`, headers ? { headers } : undefined);
}

async function payload(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("GET /api/health", () => {
  it("reports ok when fully configured", async () => {
    vi.stubEnv("RAILWAY_GIT_COMMIT_SHA", "4444444444444444444444444444444444444444");
    mockEnv({ configured: true });
    const { GET } = await import("../src/app/api/health/route");

    const response = await GET(healthRequest());
    const body = await payload(response);

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.checks).toMatchObject({ supabaseConfig: "ok", openaiConfig: "ok" });
    expect(body.demoMode).toBe(false);
    expect(typeof body.uptimeSeconds).toBe("number");
    expect(body.deploymentCommitSha).toBe("4444444444444444444444444444444444444444");
  });

  it("returns 503 for stale active governance without exposing domain or record evidence", async () => {
    vi.stubEnv("RAILWAY_GIT_COMMIT_SHA", "4444444444444444444444444444444444444444");
    const stale = structuredClone(CURRENT_SITE_CONTENT_EVIDENCE) as {
      activeRelease: { integrity: { domains: Array<Record<string, unknown>> } };
    };
    stale.activeRelease.integrity.domains[0] = {
      ...stale.activeRelease.integrity.domains[0],
      reviewState: "unreviewed",
      sourceStatus: "review_due",
      validationStatus: "unverified",
    };
    mockEnv({ configured: true, siteContentEvidence: stale });
    const { GET } = await import("../src/app/api/health/route");
    const response = await GET(healthRequest());
    const body = await payload(response);
    expect(response.status).toBe(503);
    expect(body).toMatchObject({ status: "degraded", siteContent: { state: "failure" } });
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("review_due");
    expect(raw).not.toContain("unverified");
    expect(raw).not.toContain("differentials");
  });

  it("reports degraded with 503 when required config is missing", async () => {
    mockEnv({ configured: false });
    const { GET } = await import("../src/app/api/health/route");

    const response = await GET(healthRequest());
    const body = await payload(response);

    expect(response.status).toBe(503);
    expect(body.status).toBe("degraded");
    expect(body.checks).toMatchObject({ supabaseConfig: "missing", openaiConfig: "missing" });
  });

  it("treats a missing OpenAI key as intentionally skipped only in explicit offline mode", async () => {
    mockEnv({ configured: false, providerMode: "offline" });
    const { GET } = await import("../src/app/api/health/route");

    const response = await GET(healthRequest());
    const body = await payload(response);

    expect(response.status).toBe(503);
    expect(body.checks).toMatchObject({ supabaseConfig: "missing", openaiConfig: "skipped" });
  });

  it("reports healthy without an OpenAI key when Supabase is configured for explicit offline mode", async () => {
    mockEnv({ configured: true, openAIConfigured: false, providerMode: "offline" });
    const { GET } = await import("../src/app/api/health/route");

    const response = await GET(healthRequest());
    const body = await payload(response);

    expect(response.status).toBe(200);
    expect(body.checks).toMatchObject({ supabaseConfig: "ok", openaiConfig: "skipped" });
  });

  it("gates the deep probe without a token and omits diagnostic snapshots", async () => {
    mockEnv({ configured: true, deepSecret: true });
    const { GET } = await import("../src/app/api/health/route");

    const response = await GET(healthRequest("?deep=1"));
    const body = await payload(response);

    expect(response.status).toBe(503);
    expect(body.checks).toMatchObject({ supabase: "unauthorized" });
    expect(body.slo).toBeUndefined();
    expect(body.cache).toBeUndefined();
    expect(body.coalescing).toBeUndefined();
  });

  it("exposes the in-process cache hit-rate counter on an authorized deep probe", async () => {
    // Demo mode skips the Supabase-backed slo query, so no admin mock is needed;
    // the cache counter is in-process and must still be reported.
    mockEnv({ configured: true, demoMode: true, deepSecret: true });
    const { GET } = await import("../src/app/api/health/route");

    const response = await GET(healthRequest("?deep=1", { "x-health-deep-token": DEEP_TOKEN }));
    const body = await payload(response);

    expect(response.status).toBe(200);
    const cache = body.cache as Record<string, number>;
    // Counters are process-cumulative, so assert shape/invariants, not exact counts.
    expect(typeof cache.lookups).toBe("number");
    expect(typeof cache.hits).toBe("number");
    expect(cache.misses).toBe(cache.lookups - cache.hits);
    expect(cache.hitRate).toBeGreaterThanOrEqual(0);
    expect(cache.hitRate).toBeLessThanOrEqual(1);
    const coalescing = body.coalescing as Record<string, number>;
    expect(typeof coalescing.originations).toBe("number");
    expect(typeof coalescing.coalescedWaiters).toBe("number");
    expect(typeof coalescing.activeOriginations).toBe("number");
    expect(coalescing.coalescingRate).toBeGreaterThanOrEqual(0);
    expect(coalescing.coalescingRate).toBeLessThanOrEqual(1);
    expect(body.slo).toBeUndefined();
  });

  it("does not leak secret values in the payload", async () => {
    mockEnv({ configured: true });
    const { GET } = await import("../src/app/api/health/route");

    const response = await GET(healthRequest());
    const raw = JSON.stringify(await payload(response));

    expect(raw).not.toContain("service-role-key");
    expect(raw).not.toContain("openai-key");
  });
});

describe("GET /api/health/ready", () => {
  it("runs the Supabase readiness branch without requiring the diagnostic probe token", async () => {
    mockEnv({ configured: true, demoMode: true });
    const { GET } = await import("../src/app/api/health/ready/route");

    const response = await GET(new Request("http://localhost/api/health/ready"));
    const body = await payload(response);

    expect(response.status).toBe(200);
    expect(body.checks).toMatchObject({ supabaseConfig: "ok", openaiConfig: "ok", supabase: "skipped" });
  });

  it("exposes no diagnostic details even to a token-bearing caller", async () => {
    mockEnv({ configured: true, demoMode: true, deepSecret: true });
    const { GET } = await import("../src/app/api/health/ready/route");

    const response = await GET(
      new Request("http://localhost/api/health/ready", { headers: { "x-health-deep-token": DEEP_TOKEN } }),
    );
    const body = await payload(response);

    expect(body.slo).toBeUndefined();
    expect(body.cache).toBeUndefined();
    expect(body.coalescing).toBeUndefined();
  });

  it("returns 503 without leaking dependency details when the readiness query fails", async () => {
    mockEnv({ configured: true });
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));
    vi.doMock("@/lib/supabase/health", () => ({
      probeSupabaseHealth: vi.fn(async () => ({
        ok: false,
        checkedAt: "2026-07-22T00:00:00.000Z",
        message: "Supabase health check failed.",
        rawMessage: "permission denied",
      })),
    }));
    const { GET } = await import("../src/app/api/health/ready/route");

    const response = await GET(new Request("http://localhost/api/health/ready"));
    const body = await payload(response);

    expect(response.status).toBe(503);
    expect(body.status).toBe("degraded");
    expect(body.checks).toMatchObject({ supabase: "error" });
    expect(JSON.stringify(body)).not.toContain("permission denied");
  });
});
