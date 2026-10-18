import { describe, expect, it } from "vitest";

import { answerSloSnapshot, type SloProbeClient } from "@/lib/observability/answer-slo";

// Fake PostgREST count builder: from().select().gt() is the "total" query; adding
// .not(column,...) narrows it to the hybrid-error count, .or(filters) narrows it
// to provider-generation fallbacks, and .ilike(col, pattern) narrows it to the
// truncation or timeout fallback subset by pattern. Awaiting
// resolves to { count, error }.
type SloFilterKey = "total" | "hybrid" | "degraded" | "truncation" | "timeout" | "sourceGap" | "unsupported";

function fakeClient(
  counts: {
    total: number;
    hybrid: number;
    degraded: number;
    truncation?: number;
    timeout?: number;
    sourceGap?: number;
    unsupported?: number;
    hybridRows?: Array<{ metadata: unknown }>;
  },
  error?: unknown,
  observedBaseFilters: Array<{ column: string; value: null }> = [],
  observedNarrowingFilters: Array<{ method: "eq" | "not" | "or"; column: string; value: unknown }> = [],
  observedSampleCalls: string[] = [],
): SloProbeClient {
  const build = (filter: SloFilterKey) => {
    const builder = {
      gt: () => builder,
      is: (column: string, value: null) => {
        observedBaseFilters.push({ column, value });
        return builder;
      },
      eq: (column: string, value: string) => {
        observedNarrowingFilters.push({ method: "eq", column, value });
        return build("degraded");
      },
      not: (column: string, _operator: string, value: null) => {
        observedNarrowingFilters.push({ method: "not", column, value });
        return build("hybrid");
      },
      or: (filters: string) => {
        observedNarrowingFilters.push({ method: "or", column: "", value: filters });
        return build(
          filters.startsWith("metadata->>fallback_reason_code.eq.provider_timeout")
            ? "timeout"
            : filters.startsWith("metadata->>provider_generation_truncated.eq.true")
              ? "truncation"
              : filters.startsWith("metadata->>source_gap.eq.true")
                ? "sourceGap"
                : filters.startsWith("metadata->>unsupported.eq.true")
                  ? "unsupported"
                  : "degraded",
        );
      },
      ilike: (_column: string, pattern: string) =>
        build(pattern.includes("max_output_tokens") ? "truncation" : "timeout"),
      then: (resolve: (value: { count: number | null; error: unknown }) => unknown) =>
        resolve({ count: error ? null : (counts[filter] ?? 0), error: error ?? null }),
    };
    return builder;
  };
  const buildIdentity = () => {
    const builder = {
      gt: () => builder,
      is: (column: string, value: null) => {
        observedBaseFilters.push({ column, value });
        return builder;
      },
      not: (column: string, _operator: string, value: null) => {
        observedNarrowingFilters.push({ method: "not", column, value });
        return builder;
      },
      order: (column: string, options: { ascending: boolean }) => {
        observedSampleCalls.push(`order:${column}:${options.ascending ? "asc" : "desc"}`);
        return builder;
      },
      limit: (count: number) => {
        observedSampleCalls.push(`limit:${count}`);
        return builder;
      },
      then: (resolve: (value: { data: Array<{ metadata: unknown }>; error: unknown }) => unknown) =>
        resolve({ data: error ? [] : (counts.hybridRows ?? []), error: error ?? null }),
    };
    return builder;
  };
  return {
    from: () => ({
      select: (columns: string) => (columns === "metadata" ? buildIdentity() : build("total")),
    }),
  } as unknown as SloProbeClient;
}

describe("answerSloSnapshot", () => {
  it("computes counts and rates over the window", async () => {
    const snapshot = await answerSloSnapshot(
      fakeClient({ total: 20, hybrid: 3, degraded: 5, truncation: 1, timeout: 4 }),
      60,
    );
    expect(snapshot).toMatchObject({
      windowMinutes: 60,
      totalQueries: 20,
      hybridRpcErrorQueries: 3,
      degradedQueries: 5,
      truncationFallbackQueries: 1,
      timeoutFallbackQueries: 4,
    });
    expect(snapshot.hybridRpcErrorRate).toBeCloseTo(0.15, 5);
    expect(snapshot.degradedRate).toBeCloseTo(0.25, 5);
    expect(snapshot.truncationFallbackRate).toBeCloseTo(0.05, 5);
    expect(snapshot.timeoutFallbackRate).toBeCloseTo(0.2, 5);
  });

  it("returns only safe RPC identities when every hybrid-error row is represented", async () => {
    const snapshot = await answerSloSnapshot(
      fakeClient({
        total: 20,
        hybrid: 3,
        degraded: 0,
        hybridRows: [
          { metadata: { hybrid_rpc_errors: { hybrid_search: "timeout" } } },
          { metadata: { hybrid_rpc_errors: { hybrid_search: "timeout", keyword_search: "rpc_error" } } },
          { metadata: { hybrid_rpc_errors: { hybrid_search: "timeout" } } },
        ],
      }),
    );
    expect(snapshot.hybridRpcIdentityEvidenceComplete).toBe(true);
    expect(snapshot.hybridRpcErrorCounts).toEqual({ hybrid_search: 3, keyword_search: 1 });
  });

  it("counts privacy-redacted answer rows while excluding search observations by event type", async () => {
    const observedBaseFilters: Array<{ column: string; value: null }> = [];
    const snapshot = await answerSloSnapshot(
      fakeClient({ total: 7, hybrid: 1, degraded: 2 }, undefined, observedBaseFilters),
    );

    expect(snapshot.totalQueries).toBe(7);
    // Eight queries scope by event_type, including the bounded metadata sample read.
    expect(observedBaseFilters).toEqual(
      Array.from({ length: 8 }, () => ({ column: "metadata->>event_type", value: null })),
    );
  });

  it("counts only provider-generation fallbacks, not intentional source-only answers", async () => {
    const observedNarrowingFilters: Array<{
      method: "eq" | "not" | "or";
      column: string;
      value: unknown;
    }> = [];

    await answerSloSnapshot(fakeClient({ total: 7, hybrid: 1, degraded: 2 }, undefined, [], observedNarrowingFilters));

    expect(observedNarrowingFilters).toContainEqual({
      method: "or",
      column: "",
      value:
        "metadata->>provider_generation_degraded.eq.true,metadata->>fallback_reason_code.in.(provider_auth,provider_quota,provider_rate_limit,provider_timeout,provider_failure),metadata->>fallback_reason.ilike.%generation_fallback:%",
    });
    expect(observedNarrowingFilters).not.toContainEqual(
      expect.objectContaining({ method: "not", column: "metadata->>fallback_reason" }),
    );
  });

  it("counts typed timeout codes before retaining the legacy text fallback", async () => {
    const observedNarrowingFilters: Array<{
      method: "eq" | "not" | "or";
      column: string;
      value: unknown;
    }> = [];

    const snapshot = await answerSloSnapshot(
      fakeClient({ total: 7, hybrid: 0, degraded: 0, timeout: 2 }, undefined, [], observedNarrowingFilters),
    );

    expect(snapshot.timeoutFallbackQueries).toBe(2);
    expect(observedNarrowingFilters).toContainEqual({
      method: "or",
      column: "",
      value: "metadata->>fallback_reason_code.eq.provider_timeout,metadata->>fallback_reason.ilike.%timeout%",
    });
  });

  it("counts the bounded truncation flag before retaining the legacy text fallback", async () => {
    const observedNarrowingFilters: Array<{
      method: "eq" | "not" | "or";
      column: string;
      value: unknown;
    }> = [];

    await answerSloSnapshot(
      fakeClient({ total: 7, hybrid: 0, degraded: 0, truncation: 2 }, undefined, [], observedNarrowingFilters),
    );

    expect(observedNarrowingFilters).toContainEqual({
      method: "or",
      column: "",
      value: "metadata->>provider_generation_truncated.eq.true,metadata->>fallback_reason.ilike.%max_output_tokens%",
    });
  });

  it("reports zero rates (not NaN) when there are no queries in the window", async () => {
    const snapshot = await answerSloSnapshot(fakeClient({ total: 0, hybrid: 0, degraded: 0 }));
    expect(snapshot.totalQueries).toBe(0);
    expect(snapshot.hybridRpcErrorRate).toBe(0);
    expect(snapshot.degradedRate).toBe(0);
    expect(snapshot.truncationFallbackRate).toBe(0);
    expect(snapshot.timeoutFallbackRate).toBe(0);
  });

  it("throws when a count query errors so the probe is not falsely healthy", async () => {
    await expect(
      answerSloSnapshot(fakeClient({ total: 0, hybrid: 0, degraded: 0 }, { message: "boom" })),
    ).rejects.toThrow(/boom/);
  });

  it("counts source-gap and unsupported answers over the whole window, not the sampled rows (R27)", async () => {
    const observedNarrowingFilters: Array<{ method: "eq" | "not" | "or"; column: string; value: unknown }> = [];
    const snapshot = await answerSloSnapshot(
      fakeClient(
        {
          total: 5000,
          hybrid: 0,
          degraded: 0,
          sourceGap: 250,
          unsupported: 50,
          // The sample holds none of them: the counts must come from the server, not these rows.
          hybridRows: [{ metadata: { latency_ms: 2000, mode: "fast" } }],
        },
        undefined,
        [],
        observedNarrowingFilters,
      ),
    );
    expect(snapshot.sourceGapQueries).toBe(250);
    expect(snapshot.sourceGapRate).toBeCloseTo(0.05, 5);
    expect(snapshot.unsupportedQueries).toBe(50);
    expect(snapshot.unsupportedRate).toBeCloseTo(0.01, 5);
    expect(observedNarrowingFilters).toContainEqual(
      expect.objectContaining({ method: "or", value: expect.stringContaining("metadata->>source_gap.eq.true") }),
    );
    expect(observedNarrowingFilters).toContainEqual(
      expect.objectContaining({ method: "or", value: expect.stringContaining("metadata->>unsupported.eq.true") }),
    );
  });

  it("computes the latency budget breach metric from the sample even when hybrid_rpc_errors is zero (R27)", async () => {
    const snapshot = await answerSloSnapshot(
      fakeClient({
        total: 10,
        hybrid: 0,
        degraded: 0,
        hybridRows: [
          { metadata: { latency_ms: 4000, mode: "fast" } },
          { metadata: { latency_ms: 12000, mode: "fast" } },
          { metadata: { latency_ms: 30000, mode: "strong" } },
          { metadata: { latency_ms: 2000, mode: "fast" } },
        ],
      }),
    );
    expect(snapshot.hybridRpcErrorQueries).toBe(0);
    expect(snapshot.hybridRpcIdentityEvidenceComplete).toBe(true);
    expect(snapshot.latencyBudgetBreachQueries).toBe(2);
    expect(snapshot.latencyBudgetBreachRate).toBeCloseTo(0.2, 5);
  });

  it("computes per-route p95 latency from total_latency_ms and leaves unknown modes out", async () => {
    const fastRows = Array.from({ length: 20 }, (_, index) => ({
      metadata: { routing_mode: "fast", total_latency_ms: (index + 1) * 1000 },
    }));
    const snapshot = await answerSloSnapshot(
      fakeClient({
        total: 24,
        hybrid: 0,
        degraded: 0,
        hybridRows: [
          ...fastRows,
          { metadata: { routing_mode: "strong", total_latency_ms: 30_000 } },
          { metadata: { routing_mode: "source_only", total_latency_ms: 4_000 } },
          { metadata: { routing_mode: "unsupported", total_latency_ms: 90_000 } },
          { metadata: { routing_mode: "fast", total_latency_ms: "not a number" } },
          // No declared mode: left out of every p95 rather than guessed as fast.
          { metadata: { total_latency_ms: 120_000 } },
          { metadata: { routing_mode: null, total_latency_ms: 120_000 } },
        ],
      }),
    );
    // Nearest-rank p95 of 1..20 s is the 19th value.
    expect(snapshot.latencyP95MsByRouteMode).toEqual({
      fast: { p95Ms: 19_000, samples: 20 },
      strong: { p95Ms: 30_000, samples: 1 },
      extractive: { p95Ms: 4_000, samples: 1 },
    });
    expect(snapshot.latencySampleTruncated).toBe(false);
  });

  it("samples the newest answers first so a capped window is deterministic and recent", async () => {
    const calls: string[] = [];
    await answerSloSnapshot(fakeClient({ total: 7, hybrid: 0, degraded: 0 }, undefined, [], [], calls));
    expect(calls).toEqual(["order:created_at:desc", "limit:1000"]);
  });

  it("reports a null p95 and the cap flag honestly", async () => {
    const empty = await answerSloSnapshot(fakeClient({ total: 0, hybrid: 0, degraded: 0 }));
    expect(empty.latencyP95MsByRouteMode.fast).toEqual({ p95Ms: null, samples: 0 });

    const capped = await answerSloSnapshot(
      fakeClient({
        total: 5000,
        hybrid: 0,
        degraded: 0,
        hybridRows: Array.from({ length: 1000 }, () => ({ metadata: { routing_mode: "fast", total_latency_ms: 1 } })),
      }),
    );
    expect(capped.latencySampleTruncated).toBe(true);
  });
});
