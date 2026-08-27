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
}) {
  vi.resetModules();
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
  vi.stubEnv("SITE_CONTENT_HEALTH_EVIDENCE_JSON", JSON.stringify(CURRENT_SITE_CONTENT_EVIDENCE));
}

function healthRequest(query = "", headers?: HeadersInit) {
  return new Request(`http://localhost/api/health${query}`, headers ? { headers } : undefined);
}

async function payload(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("GET /api/health", () => {
  it("reports ok when fully configured", async () => {
    vi.stubEnv("RAILWAY_GIT_COMMIT_SHA", "2ae5a0aa5d339a7dc9089db134c2d9d0220444ae");
    mockEnv({ configured: true });
    const { GET } = await import("../src/app/api/health/route");

    const response = await GET(healthRequest());
    const body = await payload(response);

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.checks).toMatchObject({ supabaseConfig: "ok", openaiConfig: "ok" });
    expect(body.demoMode).toBe(false);
    expect(typeof body.uptimeSeconds).toBe("number");
    expect(body.deploymentCommitSha).toBe("2ae5a0aa5d339a7dc9089db134c2d9d0220444ae");
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
