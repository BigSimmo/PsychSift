import { afterEach, describe, expect, it, vi } from "vitest";

const DEEP_TOKEN = "deep-probe-secret";

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
      SITE_CONTENT_EXPECTED_STATIC_MANIFEST_DIGEST: options.configured ? "a".repeat(64) : undefined,
    },
    isDemoMode: () => Boolean(options.demoMode),
  }));
}

function mockHealthySiteContent(options: { fails?: boolean } = {}) {
  const current = new Date().toISOString();
  const probeSupabaseHealth = vi.fn(async () => ({ ok: true, checkedAt: current }));
  vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({ id: "admin" })) }));
  vi.doMock("@/lib/supabase/health", () => ({ probeSupabaseHealth }));
  const readSiteContentHealthEvidence = vi.fn(async () => {
    if (options.fails) throw new Error("private database failure");
    return {
      initialized: true,
      bootstrapIntegrityState: "not_applicable",
      activePublicSiteRelease: {
        version: "clinical-kb-site-release-v1",
        releaseId: "11111111-1111-5111-8111-111111111111",
        registryVersion: "site-content-registry-v1",
        staticManifestDigest: "a".repeat(64),
        dynamicStateDigest: "b".repeat(64),
        releaseDigest: "c".repeat(64),
        state: "active",
        activatedAt: current,
      },
      publicSiteChangeEpoch: "7",
      outstandingHeadCount: 0,
      populationComplete: true,
      releaseDigestValid: true,
      dynamicDigestValid: true,
      administratorAttestationValid: true,
      governanceValid: true,
      pendingSetExact: true,
      outstandingHeadCountAgrees: true,
      pendingCount: 0,
      retryPendingCount: 0,
      processingCount: 0,
      readyCount: 0,
      quarantinedCount: 0,
      oldestOutstandingOriginAgeMs: null,
      countOverflow: false,
      timeIntegrityValid: true,
      expiredProcessingLeaseCount: 0,
      synchronizerSeen: true,
      lastInvocationAt: current,
      lastSuccessfulInvocationAt: current,
      latestInvocationSucceeded: true,
      lastActivation: current,
      rollbackAvailable: false,
    };
  });
  vi.doMock("@/lib/site-content/site-content-publication", () => ({ readSiteContentHealthEvidence }));
  return { probeSupabaseHealth, readSiteContentHealthEvidence };
}

function healthRequest(query = "", headers?: HeadersInit) {
  return new Request(`http://localhost/api/health${query}`, headers ? { headers } : undefined);
}

async function payload(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

/**
 * Wait for a condition instead of guessing a number of microtask ticks.
 * `healthResponse` reaches the Supabase probe through a `Promise.all` of dynamic
 * imports, so "has the probe started yet" is several unpredictable ticks away
 * from the call that started it.
 */
async function waitFor(predicate: () => boolean, label: string) {
  for (let attempt = 0; attempt < 500 && !predicate(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  if (!predicate()) throw new Error(`timed out waiting for ${label}`);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("GET /api/health", () => {
  it("P09 exposes only bounded programme defaults to authenticated detailed health", async () => {
    mockEnv({ configured: false, demoMode: true, deepSecret: true });
    const { healthResponse } = await import("../src/lib/health-response");
    const authenticated = await payload(
      await healthResponse(healthRequest("?deep=1", { "x-health-deep-token": DEEP_TOKEN })),
    );
    expect(authenticated.ragProgramme).toMatchObject({
      configuredMode: "legacy",
      candidatePercentage: 0,
      components: { siteContent: false, australianAugmentation: false, adaptiveAnswer: false, adaptiveRender: false },
    });
    const publicHealth = await payload(await healthResponse(healthRequest()));
    const publicReady = await payload(
      await healthResponse(healthRequest(), { forceDeep: true, allowUnauthenticatedDeep: true }),
    );
    expect(publicHealth).not.toHaveProperty("ragProgramme");
    expect(publicReady).not.toHaveProperty("ragProgramme");
    expect(JSON.stringify(authenticated.ragProgramme)).not.toMatch(/salt|ownerId|cohortBucket/i);
  });
  it("treats the documented blank site-content digest as an unset optional binding", async () => {
    vi.resetModules();
    vi.stubEnv("SITE_CONTENT_EXPECTED_STATIC_MANIFEST_DIGEST", "");
    const { env } = await import("../src/lib/env");

    expect(env.SITE_CONTENT_EXPECTED_STATIC_MANIFEST_DIGEST).toBeUndefined();
  });

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

  it("returns 401, not 503, for an unauthorized deep probe (#L29)", async () => {
    // Before this fix, GET /api/health?deep=1 without the diagnostic token
    // reported HTTP 503 status: "degraded" — indistinguishable from a genuine
    // outage to a monitor that pages on 5xx, when the service was actually
    // healthy and the caller simply omitted a bearer token.
    mockEnv({ configured: true, deepSecret: true });
    const { GET } = await import("../src/app/api/health/route");

    const response = await GET(healthRequest("?deep=1"));
    const body = await payload(response);

    expect(response.status).toBe(401);
    expect(body.checks).toMatchObject({ supabase: "unauthorized" });
    expect(body.slo).toBeUndefined();
    expect(body.cache).toBeUndefined();
    expect(body.coalescing).toBeUndefined();
  });

  it("still reports 503 degraded for a real Supabase outage on an authorized deep probe", async () => {
    mockEnv({ configured: true, deepSecret: true });
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));
    vi.doMock("@/lib/supabase/health", () => ({
      probeSupabaseHealth: vi.fn(async () => ({
        ok: false,
        checkedAt: "2026-07-22T00:00:00.000Z",
        message: "Supabase health check failed.",
        rawMessage: "permission denied",
      })),
    }));
    const { GET } = await import("../src/app/api/health/route");

    const response = await GET(healthRequest("?deep=1", { "x-health-deep-token": DEEP_TOKEN }));
    const body = await payload(response);

    expect(response.status).toBe(503);
    expect(body.status).toBe("degraded");
    expect(body.checks).toMatchObject({ supabase: "error" });
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
  // Railway allows each healthcheck attempt ten seconds. `read_site_content_health()` — the
  // site-content control-plane audit — costs about seven against the live database, and
  // between 2026-09-11 and 2026-09-14 that margin failed 24 production deploys in a row: each
  // one built, started cleanly, answered this endpoint too slowly and was rolled back, pinning
  // the live site to three-day-old code with nothing to say so. Readiness now answers only
  // "can THIS CONTAINER serve requests". The audit is unchanged and still runs on the
  // token-gated `/api/health?deep=1` — `tests/health-response-deep-probe.test.ts` holds the
  // cases that used to live here, including the fail-closed one.
  it("never runs the site-content control-plane audit", async () => {
    mockEnv({ configured: true });
    const { readSiteContentHealthEvidence } = mockHealthySiteContent();
    const { GET } = await import("../src/app/api/health/ready/route");

    const response = await GET(new Request("http://localhost/api/health/ready"));
    const body = await payload(response);

    expect(response.status).toBe(200);
    expect(body.checks).toMatchObject({ supabase: "ok", siteContent: "skipped" });
    expect(body.siteContent, "readiness must expose no control-plane projection").toBeUndefined();
    expect(
      readSiteContentHealthEvidence,
      "a seven-second audit on the deploy gate is what rolled back 24 deploys",
    ).not.toHaveBeenCalled();
  });

  it("stays deployable when the site-content audit would fail", async () => {
    mockEnv({ configured: true });
    const { readSiteContentHealthEvidence } = mockHealthySiteContent({ fails: true });
    const { GET } = await import("../src/app/api/health/ready/route");

    const response = await GET(new Request("http://localhost/api/health/ready"));
    const body = await payload(response);

    // The inverse of the old contract, and the point of the change: a control-plane fault is a
    // monitoring signal, not a reason to refuse to ship unrelated code.
    expect(response.status).toBe(200);
    expect(body.checks).toMatchObject({ supabase: "ok", siteContent: "skipped" });
    expect(readSiteContentHealthEvidence).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain("private database failure");
  });

  it("runs the Supabase readiness branch without requiring the diagnostic probe token", async () => {
    mockEnv({ configured: true, demoMode: true });
    const { GET } = await import("../src/app/api/health/ready/route");

    const response = await GET(new Request("http://localhost/api/health/ready"));
    const body = await payload(response);

    expect(response.status).toBe(200);
    expect(body.checks).toMatchObject({ supabaseConfig: "ok", openaiConfig: "ok", supabase: "skipped" });
  });

  it("exposes no diagnostic details even to a token-bearing caller", async () => {
    mockEnv({ configured: true, deepSecret: true });
    const { probeSupabaseHealth } = mockHealthySiteContent();
    const spendSnapshot = vi.fn(async () => ({ totalUsd: 42 }));
    const answerSloSnapshot = vi.fn(async () => ({ answers: 42 }));
    vi.doMock("@/lib/observability/spend-metrics", () => ({ spendSnapshot }));
    vi.doMock("@/lib/observability/answer-slo", () => ({ answerSloSnapshot }));
    const { GET } = await import("../src/app/api/health/ready/route");

    const response = await GET(
      new Request("http://localhost/api/health/ready", { headers: { "x-health-deep-token": DEEP_TOKEN } }),
    );
    const body = await payload(response);

    expect(body.slo).toBeUndefined();
    expect(body.cache).toBeUndefined();
    expect(body.coalescing).toBeUndefined();
    expect(body.spend).toBeUndefined();
    expect(body.ragProgramme).toBeUndefined();
    const cached = await payload(await GET(new Request("http://localhost/api/health/ready")));
    expect(cached).toEqual(body);
    expect(probeSupabaseHealth).toHaveBeenCalledTimes(1);
    expect(spendSnapshot).not.toHaveBeenCalled();
    expect(answerSloSnapshot).not.toHaveBeenCalled();
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

  // #L29: this route is Railway's healthcheck target, so it cannot require
  // auth or a token, and it runs an unauthenticated, unlimited Supabase probe
  // on every hit. A short in-process result cache means a burst of hits
  // (Railway's own healthcheck interval, or anyone else) shares one probe
  // instead of paying for one each — without adding a durable rate limiter
  // that would itself need a database round trip to check.
  it("caches the readiness result briefly so a burst of hits shares one Supabase probe (#L29)", async () => {
    vi.useFakeTimers();
    try {
      mockEnv({ configured: true });
      // Reuse the helper's spy: duplicate doMock factories can resolve out of order.
      const { probeSupabaseHealth } = mockHealthySiteContent();
      const { GET } = await import("../src/app/api/health/ready/route");

      const first = await GET(new Request("http://localhost/api/health/ready"));
      const second = await GET(new Request("http://localhost/api/health/ready"));
      expect(probeSupabaseHealth).toHaveBeenCalledTimes(1);
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect((await second.json()).checks).toMatchObject({ supabase: "ok" });

      await vi.advanceTimersByTimeAsync(2_001);
      const third = await GET(new Request("http://localhost/api/health/ready"));
      expect(probeSupabaseHealth).toHaveBeenCalledTimes(2);
      expect(third.status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });

  it("collapses a burst that arrives while the probe is still running (#L29)", async () => {
    mockEnv({ configured: true });
    // A probe that has not settled. The cache alone could never collapse these:
    // it only holds a FINISHED result, so every hit during the probe itself was a
    // fresh miss that started another one — and a burst during a slow probe is
    // precisely what Railway's healthcheck retries produce on a cold container.
    let release!: (value: { ok: true; checkedAt: string }) => void;
    const probeSupabaseHealth = vi.fn(
      () =>
        new Promise<{ ok: true; checkedAt: string }>((resolve) => {
          release = resolve;
        }),
    );
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({ id: "admin" })) }));
    vi.doMock("@/lib/supabase/health", () => ({ probeSupabaseHealth }));
    const { GET } = await import("../src/app/api/health/ready/route");

    const inFlight = [
      GET(new Request("http://localhost/api/health/ready")),
      GET(new Request("http://localhost/api/health/ready")),
      GET(new Request("http://localhost/api/health/ready")),
    ];
    await waitFor(() => probeSupabaseHealth.mock.calls.length > 0, "the shared probe to start");
    expect(probeSupabaseHealth, "three concurrent misses must share one probe").toHaveBeenCalledTimes(1);

    release({ ok: true, checkedAt: new Date().toISOString() });
    const responses = await Promise.all(inFlight);
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
    // Each joined caller needs its OWN response: a NextResponse body stream reads
    // once, so sharing one instance would leave all but the first with nothing.
    const bodies = await Promise.all(responses.map((response) => payload(response)));
    for (const body of bodies) expect(body.checks).toMatchObject({ supabase: "ok" });
  });

  it("starts the cache window when the probe finishes, not when the request arrived", async () => {
    vi.useFakeTimers();
    try {
      mockEnv({ configured: true });
      let release!: (value: { ok: true; checkedAt: string }) => void;
      const probeSupabaseHealth = vi.fn(
        () =>
          new Promise<{ ok: true; checkedAt: string }>((resolve) => {
            release = resolve;
          }),
      );
      vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({ id: "admin" })) }));
      vi.doMock("@/lib/supabase/health", () => ({ probeSupabaseHealth }));
      const { GET } = await import("../src/app/api/health/ready/route");

      const slow = GET(new Request("http://localhost/api/health/ready"));
      // Outlive the whole 2 s window before answering. Measured from request
      // start, the resulting entry would be born already expired — so the slower
      // the container, the less the cache helped, which is backwards.
      await vi.advanceTimersByTimeAsync(3_000);
      release({ ok: true, checkedAt: new Date().toISOString() });
      expect((await slow).status).toBe(200);

      const next = await GET(new Request("http://localhost/api/health/ready"));
      expect(next.status).toBe(200);
      expect(probeSupabaseHealth, "the entry must still be usable after a slow probe").toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed on an unexpected throw and recovers on the next request", async () => {
    vi.resetModules();
    // healthResponse guards its own Supabase faults, so reaching the route's catch
    // takes something it does not: a malformed request URL, a module-load failure,
    // a body that will not serialise. Whatever the cause, the answer is the same —
    // a thrown probe is not evidence the container is healthy, and it must never
    // fall back to a stale success. Railway reads the status code to decide
    // whether to keep this container in rotation.
    let attempt = 0;
    vi.doMock("@/lib/health-response", () => ({
      healthResponse: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error("service-role-key rejected by dependency");
        return Response.json({ status: "ok", checks: { supabase: "ok" } }, { status: 200 });
      },
    }));
    try {
      const { GET } = await import("../src/app/api/health/ready/route");

      const failed = await GET(new Request("http://localhost/api/health/ready"));
      expect(failed.status).toBe(503);
      const failedBody = await payload(failed);
      expect(failedBody.status).toBe("degraded");
      expect(JSON.stringify(failedBody), "a thrown dependency message must not be echoed").not.toContain(
        "service-role-key",
      );

      // The rejected promise must not stay pinned as the in-flight one: clearing
      // it only on success would hold every later caller on the same failure for
      // the life of the process.
      const recovered = await GET(new Request("http://localhost/api/health/ready"));
      expect(recovered.status).toBe(200);
      expect(attempt).toBe(2);
    } finally {
      // `vi.doMock` registrations outlive `vi.resetModules()` and the shared
      // afterEach, so without this the stub answers for every later test in this
      // file — which is what it did, silently, on the first full-suite run.
      vi.doUnmock("@/lib/health-response");
      vi.resetModules();
    }
  });

  describe("cross-caller isolation of the shared cache", () => {
    it("does not hand authorized-only fields to an unauthorized caller inside the cache window", async () => {
      vi.useFakeTimers();
      try {
        mockEnv({ configured: true, deepSecret: true });
        const { probeSupabaseHealth } = mockHealthySiteContent();
        const spendSnapshot = vi.fn(async () => ({ totalUsd: 42 }));
        vi.doMock("@/lib/observability/spend-metrics", () => ({ spendSnapshot }));
        const { GET } = await import("../src/app/api/health/ready/route");

        const authorized = await payload(
          await GET(
            new Request("http://localhost/api/health/ready", { headers: { "x-health-deep-token": DEEP_TOKEN } }),
          ),
        );
        const unauthorized = await payload(await GET(new Request("http://localhost/api/health/ready")));

        // The second call is served from the cache, so this is the exact window the leak lived in.
        expect(probeSupabaseHealth).toHaveBeenCalledTimes(1);
        for (const body of [authorized, unauthorized]) {
          expect(body.spend).toBeUndefined();
          expect(body.ragProgramme).toBeUndefined();
          expect(body.slo).toBeUndefined();
        }
        expect(spendSnapshot).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("never stores a diagnostic section in the cache, even if the probe starts emitting one", async () => {
      vi.resetModules();
      // Simulates a regression in health-response.ts that emits operator sections for a
      // token-bearing request, or unconditionally. Neither may reach a later caller.
      const seenTokens: Array<string | null> = [];
      vi.doMock("@/lib/health-response", () => ({
        healthResponse: async (request: Request) => {
          seenTokens.push(request.headers.get("x-health-deep-token"));
          return Response.json(
            {
              status: "ok",
              checks: { supabase: "ok" },
              spend: { totalUsd: 42 },
              ragProgramme: { configuredMode: "legacy" },
            },
            { status: 200 },
          );
        },
      }));
      try {
        const { GET } = await import("../src/app/api/health/ready/route");

        const authorized = await payload(
          await GET(
            new Request("http://localhost/api/health/ready", { headers: { "x-health-deep-token": DEEP_TOKEN } }),
          ),
        );
        const unauthorized = await payload(await GET(new Request("http://localhost/api/health/ready")));

        expect(seenTokens, "the shared probe must not see any caller's token").toEqual([null]);
        for (const body of [authorized, unauthorized]) {
          expect(body).not.toHaveProperty("spend");
          expect(body).not.toHaveProperty("ragProgramme");
          expect(body).toMatchObject({ status: "ok", checks: { supabase: "ok" } });
        }
      } finally {
        vi.doUnmock("@/lib/health-response");
        vi.resetModules();
      }
    });

    it("still returns 503 for a failing probe, for authorized and unauthorized callers alike", async () => {
      mockEnv({ configured: true, deepSecret: true });
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

      const authorized = await GET(
        new Request("http://localhost/api/health/ready", { headers: { "x-health-deep-token": DEEP_TOKEN } }),
      );
      const unauthorized = await GET(new Request("http://localhost/api/health/ready"));

      expect(authorized.status).toBe(503);
      expect(unauthorized.status).toBe(503);
      expect(JSON.stringify(await payload(unauthorized))).not.toContain("permission denied");
    });
  });
});

/**
 * The guard that outlives the incident.
 *
 * The 24 rolled-back deploys were not caused by the site-content audit being expensive. They
 * were caused by the SHAPE of the readiness contract: `/api/health/ready` opted into the deep
 * branch and then switched each expensive probe off by name, six `false`s long. A deny-list is
 * correct only until the next probe is added, and it stops being correct silently. The audit was
 * simply the next probe.
 *
 * The same mechanism had already misfired once, on `includeSlo`, and was read as a one-probe bug
 * — see that case in `tests/health-response-deep-probe.test.ts`, whose comment ends "one flag at
 * one caller, not a gate".
 *
 * So the useful test is not "the audit is not called" — that one pins yesterday's probe. It is
 * this: readiness returns EXACTLY these keys and nothing else. A probe added to the deep branch
 * that leaks onto the deploy gate adds a check or a body section, and fails here, in CI, in
 * milliseconds, instead of in production three days later.
 *
 * If you are here because this test failed after adding a probe: that is the test working. The
 * probe belongs on the token-gated `/api/health?deep=1`. Putting it on readiness means proving
 * it is bounded and cheap enough for Railway's ten-second window, and saying so in
 * `health-response.ts` beside the `probes` contract.
 */
describe("the readiness contract, pinned by shape rather than by yesterday's probe", () => {
  it("exposes exactly the container-level checks, and no diagnostic section at all", async () => {
    mockEnv({ configured: true, deepSecret: true });
    mockHealthySiteContent();
    const { GET } = await import("../src/app/api/health/ready/route");

    const body = await payload(await GET(new Request("http://localhost/api/health/ready")));

    expect(Object.keys(body.checks as Record<string, unknown>).sort()).toEqual([
      "openaiConfig",
      "siteContent",
      "supabase",
      "supabaseConfig",
    ]);
    expect(Object.keys(body).sort()).toEqual([
      "checks",
      "demoMode",
      "deploymentCommitSha",
      "status",
      "timestamp",
      "uptimeSeconds",
    ]);
  });

  it("bounds its one database call, because an unbounded one cannot beat a ten-second gate", async () => {
    mockEnv({ configured: true });
    const { probeSupabaseHealth } = mockHealthySiteContent();
    const { GET } = await import("../src/app/api/health/ready/route");

    await GET(new Request("http://localhost/api/health/ready"));

    const signal = (probeSupabaseHealth.mock.calls[0] as unknown[])[1];
    expect(signal, "a cold container can outrun Railway's window on even a one-row select").toBeInstanceOf(AbortSignal);
  });

  it("leaves the diagnostic probe fully populated, so nothing was removed, only relocated", async () => {
    mockEnv({ configured: true, deepSecret: true });
    const { readSiteContentHealthEvidence } = mockHealthySiteContent();
    const { healthResponse } = await import("../src/lib/health-response");

    const response = await healthResponse(
      new Request("http://localhost/api/health?deep=1", { headers: { "x-health-deep-token": DEEP_TOKEN } }),
    );
    const body = (await response.json()) as Record<string, unknown>;

    expect(readSiteContentHealthEvidence).toHaveBeenCalledTimes(1);
    expect(body.siteContent).toBeDefined();
    expect(body.checks).toMatchObject({ siteContent: "ok" });
  });
});
