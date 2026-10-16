import { describe, expect, it } from "vitest";

import { answerSloSnapshot, type SloProbeClient } from "@/lib/observability/answer-slo";

// Fake PostgREST count builder: from().select().gt() is the "total" query; adding
// .not(column,...) narrows it to the hybrid-error count, .or(filters) narrows it
// to provider-generation fallbacks, and .ilike(col, pattern) narrows it to the
// truncation or timeout fallback subset by pattern. Awaiting
// resolves to { count, error }.
type SloFilterKey = "total" | "hybrid" | "degraded" | "truncation" | "timeout";

function fakeClient(
  counts: {
    total: number;
    hybrid: number;
    degraded: number;
    truncation?: number;
    timeout?: number;
    /** Rows returned by the hybrid-error-filtered identity read. */
    hybridRows?: Array<{ metadata: unknown }>;
    /** Rows returned by the unfiltered, bounded quality sample. */
    sampleRows?: Array<{ metadata: unknown }>;
  },
  error?: unknown,
  observedBaseFilters: Array<{ column: string; value: null }> = [],
  observedNarrowingFilters: Array<{ method: "eq" | "not" | "or"; column: string; value: unknown }> = [],
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
    let filteredToHybridErrors = false;
    const builder = {
      gt: () => builder,
      is: (column: string, value: null) => {
        observedBaseFilters.push({ column, value });
        return builder;
      },
      not: (column: string, _operator: string, value: null) => {
        observedNarrowingFilters.push({ method: "not", column, value });
        filteredToHybridErrors = true;
        return builder;
      },
      limit: () => builder,
      then: (resolve: (value: { data: Array<{ metadata: unknown }>; error: unknown }) => unknown) =>
        resolve({
          data: error ? [] : filteredToHybridErrors ? (counts.hybridRows ?? []) : (counts.sampleRows ?? []),
          error: error ?? null,
        }),
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
    // Seven queries scope by event_type, including the bounded hybrid-RPC identity evidence read and
    // the bounded quality sample.
    expect(observedBaseFilters).toEqual(
      Array.from({ length: 7 }, () => ({ column: "metadata->>event_type", value: null })),
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

  it("computes sourceGap, unsupported, and latencyBudgetBreach metrics even when hybrid_rpc_errors is zero (R27)", async () => {
    const snapshot = await answerSloSnapshot(
      fakeClient({
        total: 4,
        hybrid: 0,
        degraded: 0,
        sampleRows: [
          { metadata: { source_gap: true, latency_ms: 4000, mode: "fast" } },
          { metadata: { unsupported: true, latency_ms: 12000, mode: "fast" } },
          { metadata: { latency_ms: 30000, mode: "strong" } },
          { metadata: { latency_ms: 2000, mode: "fast" } },
        ],
      }),
    );
    expect(snapshot.hybridRpcErrorQueries).toBe(0);
    expect(snapshot.hybridRpcIdentityEvidenceComplete).toBe(true);
    expect(snapshot.sourceGapQueries).toBe(1);
    expect(snapshot.sourceGapRate).toBeCloseTo(0.25, 5);
    expect(snapshot.unsupportedQueries).toBe(1);
    expect(snapshot.unsupportedRate).toBeCloseTo(0.25, 5);
    expect(snapshot.latencyBudgetBreachQueries).toBe(2);
    expect(snapshot.latencyBudgetBreachRate).toBeCloseTo(0.5, 5);
  });

  it("uses the sampled row count as the denominator when the window is larger than the sample", async () => {
    // 3,000 answers in the window but only 4 sampled rows: dividing by 3,000 would hide a real breach.
    const snapshot = await answerSloSnapshot(
      fakeClient({
        total: 3000,
        hybrid: 0,
        degraded: 0,
        sampleRows: [
          { metadata: { source_gap: true } },
          { metadata: { source_gap: true } },
          { metadata: {} },
          { metadata: {} },
        ],
      }),
    );
    expect(snapshot.totalQueries).toBe(3000);
    expect(snapshot.sourceGapRate).toBeCloseTo(0.5, 5);
  });

  it("reads hybrid RPC identity evidence from the filtered query, not the quality sample", async () => {
    const snapshot = await answerSloSnapshot(
      fakeClient({
        total: 2,
        hybrid: 1,
        degraded: 0,
        hybridRows: [{ metadata: { hybrid_rpc_errors: { hybrid_search: "timeout" } } }],
        sampleRows: [{ metadata: {} }, { metadata: {} }],
      }),
    );
    expect(snapshot.hybridRpcIdentityEvidenceComplete).toBe(true);
    expect(snapshot.hybridRpcErrorCounts).toEqual({ hybrid_search: 1 });
  });
});
