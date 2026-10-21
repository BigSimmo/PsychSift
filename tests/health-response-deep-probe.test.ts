import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const DEEP_TOKEN = "deep-probe-secret";

function mockEnv() {
  vi.resetModules();
  vi.doMock("@/lib/env", () => ({
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "https://sjrfecxgysukkwxsowpy.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      OPENAI_API_KEY: "openai-key",
      RAG_PROVIDER_MODE: "auto",
      HEALTH_DEEP_PROBE_SECRET: DEEP_TOKEN,
      OPENAI_PRICE_INPUT_PER_MTOK: 1.25,
      OPENAI_PRICE_CACHED_INPUT_PER_MTOK: 0.125,
      OPENAI_PRICE_OUTPUT_PER_MTOK: 10,
      SPEND_ALERT_DAILY_USD: 25,
      SITE_CONTENT_EXPECTED_STATIC_MANIFEST_DIGEST: "a".repeat(64),
    },
    isDemoMode: () => false,
  }));
}

function mockSupabase(healthy: boolean, options: { fails?: boolean; timesOut?: boolean } = {}) {
  vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({ id: "admin-client" })) }));
  vi.doMock("@/lib/supabase/health", () => ({
    probeSupabaseHealth: vi.fn(async () => ({ ok: healthy, checkedAt: "2026-08-01T00:00:00.000Z" })),
  }));
  const current = new Date().toISOString();
  const readSiteContentHealthEvidence = vi.fn(async (client: unknown, signal?: AbortSignal) => {
    // Mirror the real call: the admin client is forwarded, and an expired deadline aborts
    // rather than being ignored.
    expect(client).toEqual({ id: "admin-client" });
    signal?.throwIfAborted();
    if (options.timesOut) {
      throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    }
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
  return { readSiteContentHealthEvidence };
}

async function deepProbe() {
  const { healthResponse } = await import("../src/lib/health-response");
  const response = await healthResponse(
    new Request("http://localhost/api/health?deep=1", { headers: { "x-health-deep-token": DEEP_TOKEN } }),
  );
  return { response, body: (await response.json()) as Record<string, unknown> };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("authorized deep health probe diagnostics", () => {
  it("reports the SLO and spend snapshots when Supabase is healthy", async () => {
    mockEnv();
    mockSupabase(true);
    const answerSloSnapshot = vi.fn(async () => ({ windowMinutes: 60, answers: 12 }));
    const spendCalls: unknown[][] = [];
    const spendSnapshot = vi.fn(async (...args: unknown[]) => {
      spendCalls.push(args);
      return { windowMinutes: 60, totalUsd: 1.5 };
    });
    vi.doMock("@/lib/observability/answer-slo", () => ({ answerSloSnapshot }));
    vi.doMock("@/lib/observability/spend-metrics", () => ({ spendSnapshot }));

    const { response, body } = await deepProbe();

    expect(response.status).toBe(200);
    expect(body.checks).toMatchObject({ supabase: "ok", siteContent: "ok" });
    expect(body.siteContent).toMatchObject({ state: "current", releaseDigestPrefix: "cccccccccccc" });
    expect(body.slo).toMatchObject({ answers: 12 });
    expect(body.spend).toMatchObject({ totalUsd: 1.5 });
    expect(spendCalls[0]?.[1]).toMatchObject({
      pricing: { inputPerMTok: 1.25, cachedInputPerMTok: 0.125, outputPerMTok: 10 },
      alertDailyUsd: 25,
    });
  });

  it("adds a trailing answer-quality snapshot as long as the digest interval (audit EVAL-02)", async () => {
    mockEnv();
    mockSupabase(true);
    const answerSloSnapshot = vi.fn(async (_client: unknown, windowMinutes = 60) => ({
      windowMinutes,
      totalQueries: windowMinutes === 60 ? 0 : 12,
    }));
    vi.doMock("@/lib/observability/answer-slo", () => ({ answerSloSnapshot }));
    vi.doMock("@/lib/observability/spend-metrics", () => ({ spendSnapshot: vi.fn(async () => ({})) }));
    const { ANSWER_QUALITY_WINDOW_MINUTES } = await import("../scripts/lib/operational-alerts.mjs");

    const { response, body } = await deepProbe();

    expect(response.status).toBe(200);
    // The hourly snapshot keeps feeding the hybrid-RPC identity history; the trailing one is
    // the window every answer-rate alert reads, and it must match the alert policy exactly.
    expect(answerSloSnapshot).toHaveBeenCalledTimes(2);
    expect(answerSloSnapshot).toHaveBeenCalledWith({ id: "admin-client" });
    expect(answerSloSnapshot).toHaveBeenCalledWith({ id: "admin-client" }, ANSWER_QUALITY_WINDOW_MINUTES);
    expect(body.slo).toMatchObject({ windowMinutes: 60, totalQueries: 0 });
    expect(body.sloTrailing).toMatchObject({ windowMinutes: ANSWER_QUALITY_WINDOW_MINUTES, totalQueries: 12 });
  });

  it("keeps the hourly snapshot when only the trailing snapshot query fails", async () => {
    mockEnv();
    mockSupabase(true);
    const answerSloSnapshot = vi.fn(async (_client: unknown, windowMinutes = 60) => {
      if (windowMinutes !== 60) throw new Error("trailing slo query failed");
      return { windowMinutes, totalQueries: 3 };
    });
    vi.doMock("@/lib/observability/answer-slo", () => ({ answerSloSnapshot }));
    vi.doMock("@/lib/observability/spend-metrics", () => ({ spendSnapshot: vi.fn(async () => ({})) }));

    const { response, body } = await deepProbe();

    expect(response.status).toBe(200);
    expect(body.slo).toMatchObject({ windowMinutes: 60, totalQueries: 3 });
    // A current build marks the failed trailing query explicitly, so the digest reports answer
    // quality as unknown instead of falling back to the hourly-only rules of an older build.
    expect(body.sloTrailing).toEqual({ windowMinutes: 360, unavailable: true });
    expect(JSON.stringify(body)).not.toContain("query failed");
  });

  it("keeps the probe healthy when a diagnostic snapshot query fails", async () => {
    mockEnv();
    mockSupabase(true);
    vi.doMock("@/lib/observability/answer-slo", () => ({
      answerSloSnapshot: vi.fn(async () => {
        throw new Error("slo query failed");
      }),
    }));
    vi.doMock("@/lib/observability/spend-metrics", () => ({
      spendSnapshot: vi.fn(async () => {
        throw new Error("spend query failed");
      }),
    }));

    const { response, body } = await deepProbe();

    expect(response.status).toBe(200);
    expect(body.checks).toMatchObject({ supabase: "ok" });
    expect(body.slo).toBeUndefined();
    expect(body.spend).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("query failed");
  });

  it("skips both snapshots when the Supabase probe is unhealthy", async () => {
    mockEnv();
    mockSupabase(false);
    const answerSloSnapshot = vi.fn();
    const spendSnapshot = vi.fn();
    vi.doMock("@/lib/observability/answer-slo", () => ({ answerSloSnapshot }));
    vi.doMock("@/lib/observability/spend-metrics", () => ({ spendSnapshot }));

    const { response, body } = await deepProbe();

    expect(response.status).toBe(503);
    expect(body.checks).toMatchObject({ supabase: "error" });
    expect(answerSloSnapshot).not.toHaveBeenCalled();
    expect(spendSnapshot).not.toHaveBeenCalled();
  });

  it("degrades without leaking details when the Supabase probe itself throws", async () => {
    mockEnv();
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: vi.fn(() => {
        throw new Error("service role key rejected");
      }),
    }));
    vi.doMock("@/lib/supabase/health", () => ({ probeSupabaseHealth: vi.fn() }));

    const { response, body } = await deepProbe();

    expect(response.status).toBe(503);
    expect(body.checks).toMatchObject({ supabase: "error" });
    expect(JSON.stringify(body)).not.toContain("service role key rejected");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("omits slo for an unauthenticated deep probe even when includeSlo is not passed", async () => {
    // `answer-slo`'s tenancy exemption (scripts/lib/tenancy-scan.mjs) states that this
    // deliberate cross-tenant aggregate is reached "only from /api/health's deep probe behind
    // HEALTH_DEEP_PROBE_SECRET". Until 2026-09-02 the SLO branch was gated on
    // `health.ok && options.includeSlo !== false` with no `tokenAuthorized`, so it also ran for
    // any caller passing `allowUnauthenticatedDeep`. The claim held only because the sole such
    // caller (/api/health/ready) opts out with `includeSlo: false` — one flag at one caller,
    // not a gate. This pins the gate itself, with the opt-out deliberately omitted.
    mockEnv();
    mockSupabase(true);
    const answerSloSnapshot = vi.fn(async () => ({ windowMinutes: 60, answers: 12 }));
    const spendSnapshot = vi.fn(async () => ({ totalUsd: 1 }));
    vi.doMock("@/lib/observability/answer-slo", () => ({ answerSloSnapshot }));
    vi.doMock("@/lib/observability/spend-metrics", () => ({ spendSnapshot }));
    const { healthResponse } = await import("../src/lib/health-response");

    const response = await healthResponse(new Request("http://localhost/api/health/ready"), {
      forceDeep: true,
      allowUnauthenticatedDeep: true,
    });
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.checks).toMatchObject({ supabase: "ok" });
    expect(body.slo, "an unauthenticated deep probe must not receive the cross-tenant SLO aggregate").toBeUndefined();
    expect(answerSloSnapshot).not.toHaveBeenCalled();
    // The other operator-gated snapshots were already token-gated; assert they stay that way.
    expect(body.spend).toBeUndefined();
    expect(spendSnapshot).not.toHaveBeenCalled();
    expect(body.cache).toBeUndefined();
    expect(body.coalescing).toBeUndefined();
  });

  it("suppresses opted-out snapshots for an authorized caller", async () => {
    mockEnv();
    mockSupabase(true);
    const answerSloSnapshot = vi.fn(async () => ({ answers: 1 }));
    const spendSnapshot = vi.fn(async () => ({ totalUsd: 1 }));
    vi.doMock("@/lib/observability/answer-slo", () => ({ answerSloSnapshot }));
    vi.doMock("@/lib/observability/spend-metrics", () => ({ spendSnapshot }));
    const { healthResponse } = await import("../src/lib/health-response");

    const response = await healthResponse(
      new Request("http://localhost/api/health?deep=1", { headers: { "x-health-deep-token": DEEP_TOKEN } }),
      { includeSlo: false, includeSpend: false, includeCache: false, includeCoalescing: false },
    );
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.slo).toBeUndefined();
    expect(body.spend).toBeUndefined();
    expect(body.cache).toBeUndefined();
    expect(body.coalescing).toBeUndefined();
    expect(answerSloSnapshot).not.toHaveBeenCalled();
    expect(spendSnapshot).not.toHaveBeenCalled();
  });
});

// Audit F-10: the storage cleanup backlog reaches the ops digest only through the deep probe.
describe("the storage cleanup backlog snapshot", () => {
  const backlog = { pending: 1, failed: 2, outstanding: 3, oldestOutstandingAt: "2026-10-18T00:00:00.000Z" };

  function mockBacklog(impl: () => Promise<unknown>) {
    const storageCleanupBacklogSnapshot = vi.fn(impl);
    vi.doMock("@/lib/observability/answer-slo", () => ({ answerSloSnapshot: vi.fn(async () => null) }));
    vi.doMock("@/lib/observability/spend-metrics", () => ({ spendSnapshot: vi.fn(async () => null) }));
    vi.doMock("@/lib/observability/cleanup-backlog", () => ({ storageCleanupBacklogSnapshot }));
    return storageCleanupBacklogSnapshot;
  }

  it("is reported to the token-gated deep probe with the admin client", async () => {
    mockEnv();
    mockSupabase(true);
    const snapshot = mockBacklog(async () => backlog);

    const { response, body } = await deepProbe();

    expect(response.status).toBe(200);
    expect(body.storageCleanup).toEqual(backlog);
    expect(snapshot).toHaveBeenCalledWith({ id: "admin-client" });
  });

  it("is dropped, without flipping liveness or leaking the error, when its query fails", async () => {
    mockEnv();
    mockSupabase(true);
    mockBacklog(async () => {
      throw new Error("private cleanup query failure");
    });

    const { response, body } = await deepProbe();

    expect(response.status).toBe(200);
    expect(body.storageCleanup).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("private cleanup query failure");
  });

  it("never runs for readiness or an unauthenticated deep probe", async () => {
    mockEnv();
    mockSupabase(true);
    const snapshot = mockBacklog(async () => backlog);
    const { healthResponse } = await import("../src/lib/health-response");

    const readiness = await healthResponse(
      new Request("http://localhost/api/health/ready", { headers: { "x-health-deep-token": DEEP_TOKEN } }),
      { forceDeep: true, allowUnauthenticatedDeep: true, probes: "readiness" },
    );
    const anonymous = await healthResponse(new Request("http://localhost/api/health?deep=1"), {
      allowUnauthenticatedDeep: true,
    });

    expect(((await readiness.json()) as Record<string, unknown>).storageCleanup).toBeUndefined();
    expect(((await anonymous.json()) as Record<string, unknown>).storageCleanup).toBeUndefined();
    expect(snapshot).not.toHaveBeenCalled();
  });

  it("is suppressed when an authorized caller opts out", async () => {
    mockEnv();
    mockSupabase(true);
    const snapshot = mockBacklog(async () => backlog);
    const { healthResponse } = await import("../src/lib/health-response");

    const response = await healthResponse(
      new Request("http://localhost/api/health?deep=1", { headers: { "x-health-deep-token": DEEP_TOKEN } }),
      { includeStorageCleanup: false },
    );

    expect(((await response.json()) as Record<string, unknown>).storageCleanup).toBeUndefined();
    expect(snapshot).not.toHaveBeenCalled();
  });
});

describe("storageCleanupBacklogSnapshot", () => {
  beforeEach(() => {
    // The describe block above mocks this module for the probe; these tests need the real one.
    vi.doUnmock("@/lib/observability/cleanup-backlog");
  });

  type Call = { table: string; columns: string; options?: unknown; filters: Array<[string, unknown]> };

  function fakeClient(resolve: (call: Call) => unknown) {
    const calls: Call[] = [];
    const client = {
      from(table: string) {
        return {
          select(columns: string, options?: unknown) {
            const call: Call = { table, columns, options, filters: [] };
            calls.push(call);
            const builder = {
              eq(column: string, value: unknown) {
                call.filters.push([`eq:${column}`, value]);
                return builder;
              },
              lte(column: string, value: unknown) {
                call.filters.push([`lte:${column}`, value]);
                return builder;
              },
              or(filters: string) {
                call.filters.push(["or", filters]);
                return builder;
              },
              order(column: string, value: unknown) {
                call.filters.push([`order:${column}`, value]);
                return builder;
              },
              limit(count: number) {
                call.filters.push(["limit", count]);
                return builder;
              },
              then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
                return Promise.resolve(resolve(call)).then(onFulfilled, onRejected);
              },
            };
            return builder;
          },
        };
      },
    };
    return { client, calls };
  }

  it("counts only actionable jobs and reads only the oldest actionable timestamp", async () => {
    vi.resetModules();
    const { storageCleanupBacklogSnapshot } = await import("../src/lib/observability/cleanup-backlog");
    const now = new Date("2026-10-19T12:00:00.000Z");
    const { client, calls } = fakeClient((call) => {
      const status = call.filters.find(([key]) => key === "eq:status")?.[1];
      if (status === "pending") return { count: 2, error: null };
      if (status === "failed") return { count: 5, error: null };
      if (status === "processing") return { count: 1, error: null };
      return { data: [{ created_at: "2026-10-17T03:04:05.000Z" }], error: null };
    });

    await expect(storageCleanupBacklogSnapshot(client as never, now)).resolves.toEqual({
      pending: 2,
      failed: 5,
      expiredClaims: 1,
      outstanding: 8,
      oldestOutstandingAt: "2026-10-17T03:04:05.000Z",
    });
    expect(calls.every((call) => call.table === "storage_cleanup_jobs")).toBe(true);
    // Head-only counts, and the age lookup selects nothing but created_at.
    expect(calls.filter((call) => call.columns === "id").map((call) => call.options)).toEqual([
      { count: "exact", head: true },
      { count: "exact", head: true },
      { count: "exact", head: true },
    ]);
    // A governed public-source row is not counted before its cleanup deadline; an expired
    // processing claim is, because the drain reclaims it.
    const due =
      'public_source_cleanup_not_before.is.null,public_source_cleanup_not_before.lte."2026-10-19T12:00:00.000Z"';
    const countFilters = calls.filter((call) => call.columns === "id").map((call) => call.filters);
    expect(countFilters).toEqual([
      [
        ["eq:status", "pending"],
        ["or", due],
      ],
      [
        ["eq:status", "failed"],
        ["or", due],
      ],
      [
        ["eq:status", "processing"],
        ["lte:public_source_claim_expires_at", "2026-10-19T12:00:00.000Z"],
      ],
    ]);
    expect(calls.find((call) => call.columns === "created_at")?.filters).toEqual([
      [
        "or",
        `and(status.in.(pending,failed),or(${due})),and(status.eq.processing,public_source_claim_expires_at.lte."2026-10-19T12:00:00.000Z")`,
      ],
      ["order:created_at", { ascending: true }],
      ["limit", 1],
    ]);
  });

  it("reports an empty queue with no oldest timestamp", async () => {
    vi.resetModules();
    const { storageCleanupBacklogSnapshot } = await import("../src/lib/observability/cleanup-backlog");
    const { client } = fakeClient((call) =>
      call.columns === "id" ? { count: 0, error: null } : { data: [], error: null },
    );

    await expect(storageCleanupBacklogSnapshot(client as never)).resolves.toEqual({
      pending: 0,
      failed: 0,
      expiredClaims: 0,
      outstanding: 0,
      oldestOutstandingAt: null,
    });
  });

  it("throws rather than reporting a falsely empty queue when a count fails", async () => {
    vi.resetModules();
    const { storageCleanupBacklogSnapshot } = await import("../src/lib/observability/cleanup-backlog");
    const { client } = fakeClient((call) =>
      call.columns === "id" ? { count: null, error: { message: "permission denied" } } : { data: [], error: null },
    );

    await expect(storageCleanupBacklogSnapshot(client as never)).rejects.toThrow(
      "Storage cleanup backlog count failed.",
    );
  });
});

/**
 * The split that keeps production deployable.
 *
 * `read_site_content_health()` audits the whole site-content control plane — record counts,
 * digest comparisons, tombstone reconciliation — and costs about seven seconds against the live
 * database. Railway allows each healthcheck attempt ten, so while `/api/health/ready` called it,
 * 24 consecutive production deploys (2026-09-11 to 2026-09-14) built, started cleanly, answered
 * too slowly and were rolled back. The audit is not weakened here; one caller stopped asking.
 * `docs/deployment-architecture.md` § Readiness carries the measurements.
 */
describe("the site-content control-plane audit", () => {
  it("runs for the token-gated deep probe", async () => {
    mockEnv();
    const { readSiteContentHealthEvidence } = mockSupabase(true);

    const { response, body } = await deepProbe();

    expect(response.status).toBe(200);
    expect(readSiteContentHealthEvidence).toHaveBeenCalledTimes(1);
    expect(body.checks).toMatchObject({ siteContent: "ok" });
    expect(body.siteContent).toMatchObject({ state: "current" });
  });

  it("is bounded by a deadline so it can never hang a request path", async () => {
    mockEnv();
    const { readSiteContentHealthEvidence } = mockSupabase(true);

    await deepProbe();

    const signal = readSiteContentHealthEvidence.mock.calls[0]?.[1];
    expect(signal, "an unbounded control-plane query is what caused the outage").toBeInstanceOf(AbortSignal);
  });

  /**
   * The deadline is a measured range, not a preference, and it went in below the range once.
   *
   * An abort is reported through the same `catch` as a corpus inconsistency — `checks.siteContent
   * = "error"`, which makes the whole probe 503 — so a deadline under the audit's healthy cost
   * does not bound a fault, it fabricates one, on every single call. That would take out
   * `check:production-readiness` too, since `scripts/lib/deployment-rag-activation.mjs` reads this
   * exact response and fails on a non-2xx. The opposite error is quieter but also real: a deadline
   * above that caller's own 15 s whole-response budget can never fire, so a one-field timeout
   * degrades into an opaque `health_probe_failed` instead.
   */
  it("keeps its deadline above the audit's measured cost and below the readiness prober's budget", async () => {
    mockEnv();
    mockSupabase(true);
    const { SITE_CONTENT_PROBE_TIMEOUT_MS } = await import("../src/lib/health-response");

    // Slowest of nine successful deep probes against the live warm container on 2026-09-14
    // (range 7.18-7.86 s, all HTTP 200), rounded up. Pinning the worst observed case rather than
    // the average is the point: the average is what a too-small deadline hides behind.
    // See docs/deployment-architecture.md § Readiness.
    const MEASURED_HEALTHY_COST_MS = 7_900;
    // scripts/lib/deployment-rag-activation.mjs: AbortSignal.timeout(15000) around this response.
    const READINESS_PROBER_BUDGET_MS = 15_000;

    expect(
      SITE_CONTENT_PROBE_TIMEOUT_MS,
      "a deadline below the audit's healthy cost reports every healthy call as an integrity fault",
    ).toBeGreaterThan(MEASURED_HEALTHY_COST_MS);
    expect(
      SITE_CONTENT_PROBE_TIMEOUT_MS,
      "a deadline above the readiness prober's own budget can never be reached",
    ).toBeLessThan(READINESS_PROBER_BUDGET_MS);
  });

  it("fails the deep probe closed, without leaking the RPC error", async () => {
    // Migrated from `tests/health-route.test.ts`, where it asserted the same fail-closed
    // behaviour on `/api/health/ready`. The behaviour is unchanged; only its caller moved.
    mockEnv();
    mockSupabase(true, { fails: true });

    const { response, body } = await deepProbe();

    expect(response.status).toBe(503);
    expect(body.checks).toMatchObject({ supabase: "ok", siteContent: "error" });
    expect(JSON.stringify(body)).not.toContain("private database failure");
  });

  it("is skipped, not failed, when a caller opts out", async () => {
    mockEnv();
    const { readSiteContentHealthEvidence } = mockSupabase(true, { fails: true });
    const { healthResponse } = await import("../src/lib/health-response");

    const response = await healthResponse(
      new Request("http://localhost/api/health?deep=1", { headers: { "x-health-deep-token": DEEP_TOKEN } }),
      { includeSiteContent: false },
    );
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.checks).toMatchObject({ supabase: "ok", siteContent: "skipped" });
    expect(body.siteContent).toBeUndefined();
    expect(readSiteContentHealthEvidence).not.toHaveBeenCalled();
  });
});

/**
 * A slow audit and a broken corpus are not the same incident.
 *
 * Both arrive through one `catch`, and until they were named apart both read as
 * `checks.siteContent = "error"` — an integrity fault. The responses are opposites: a timeout
 * means the query has outgrown its budget and wants profiling, an error means the control plane
 * disagrees with itself and wants a look at the data. The deadline is sized with about 27%
 * headroom over the measured cost and the cost grows with the corpus, so this distinction is not
 * hypothetical: it is what the next person sees first when the margin closes.
 *
 * Both still fail closed. An audit that did not finish is not evidence that the corpus is sound.
 */
describe("a site-content audit that runs out of time", () => {
  it("is reported as a timeout, not as an integrity fault", async () => {
    mockEnv();
    mockSupabase(true, { timesOut: true });

    const { response, body } = await deepProbe();

    expect(body.checks).toMatchObject({ supabase: "ok", siteContent: "timeout" });
    expect(response.status, "an unfinished audit is not proof of a sound corpus").toBe(503);
  });

  it("still calls a genuine control-plane failure an error", async () => {
    mockEnv();
    mockSupabase(true, { fails: true });

    const { body } = await deepProbe();

    expect(body.checks).toMatchObject({ siteContent: "error" });
  });
});
