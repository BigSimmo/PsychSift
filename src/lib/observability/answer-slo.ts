// Answer-pipeline SLO snapshot for the deep /api/health probe.
//
// The repo's defining failure mode is *silent degradation*: hybrid retrieval RPCs
// can die while the app keeps returning 200s from fallbacks (see
// docs/observability-slos.md). This turns the two load-bearing reliability signals
// from that doc — the `hybrid_rpc_errors` rate and the degraded/source-only rate —
// into a scrapeable counter so host-native alerting can poll them instead of
// running the SQL by hand. It only aggregates `rag_queries.metadata` (never raw
// query text, which is redacted at write time), and runs behind the secret-gated
// deep probe. Cache hit-rate is exposed separately by cache-metrics.ts because it
// is an in-process hot-path counter rather than a trailing database aggregate.

export const ANSWER_LATENCY_BUDGET_MS = {
  fast: 10_000,
  strong: 25_000,
  extractive: 6_000,
} as const;

export type AnswerSloSnapshot = {
  windowMinutes: number;
  totalQueries: number;
  hybridRpcErrorQueries: number;
  /** Error counts by safe, internal RPC identifier for the current hourly window. */
  hybridRpcErrorCounts: Record<string, number>;
  /** False when the bounded identity query cannot prove that every error row was observed. */
  hybridRpcIdentityEvidenceComplete: boolean;
  degradedQueries: number;
  // Subsets of degradedQueries broken out by the two dominant answer-generation waste
  // classes: reasoning/answer token starvation (fallback_reason contains
  // "max_output_tokens") and generation timeouts (contains "timeout"). These are exactly
  // the failure modes the OPENAI_MAX_OUTPUT_TOKENS raise + reasoning-effort drop target,
  // surfaced as scrapeable counters so a regression is visible without hand-running SQL.
  truncationFallbackQueries: number;
  timeoutFallbackQueries: number;
  sourceGapQueries: number;
  unsupportedQueries: number;
  latencyBudgetBreachQueries: number;
  // 0..1; 0 when there were no queries in the window (avoid divide-by-zero noise).
  hybridRpcErrorRate: number;
  degradedRate: number;
  truncationFallbackRate: number;
  timeoutFallbackRate: number;
  sourceGapRate: number;
  unsupportedRate: number;
  latencyBudgetBreachRate: number;
};

type CountResult = { count: number | null; error: unknown };
type HybridRpcIdentityResult = { data: Array<{ metadata: unknown }> | null; error: unknown };

// Minimal structural view of the PostgREST count query we use. The Supabase admin
// client is assignable to this (same pattern as src/lib/supabase/health.ts), so the
// route passes it directly and tests pass a small fake.
type SloCountBuilder = PromiseLike<CountResult> & {
  gt(column: string, value: string): SloCountBuilder;
  eq(column: string, value: string): SloCountBuilder;
  is(column: string, value: null): SloCountBuilder;
  not(column: string, operator: string, value: null): SloCountBuilder;
  ilike(column: string, pattern: string): SloCountBuilder;
  or(filters: string): SloCountBuilder;
};

type HybridRpcIdentityBuilder = PromiseLike<HybridRpcIdentityResult> & {
  gt(column: string, value: string): HybridRpcIdentityBuilder;
  is(column: string, value: null): HybridRpcIdentityBuilder;
  not(column: string, operator: string, value: null): HybridRpcIdentityBuilder;
  limit(count: number): HybridRpcIdentityBuilder;
};

export type SloProbeClient = {
  from(table: string): {
    select(columns: string, options: { count: "exact"; head: true }): SloCountBuilder;
    select(columns: "metadata"): HybridRpcIdentityBuilder;
  };
};

function rate(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : 0;
}

const maxHybridRpcIdentityRows = 1000;
const safeRpcIdentifier = /^[a-zA-Z][a-zA-Z0-9_]{0,127}$/;

function resolveRouteLatencyBudgetMs(metadata: Record<string, unknown>): number {
  const rawMode = String(
    metadata.routing_mode ?? metadata.mode ?? metadata.route_mode ?? metadata.answer_mode ?? "fast",
  )
    .trim()
    .toLowerCase();
  if (rawMode === "strong") return ANSWER_LATENCY_BUDGET_MS.strong;
  if (rawMode === "extractive" || rawMode === "source_only" || rawMode === "source-only") {
    return ANSWER_LATENCY_BUDGET_MS.extractive;
  }
  return ANSWER_LATENCY_BUDGET_MS.fast;
}

export function computeAnswerQualitySloMetrics(rows: Array<{ metadata: unknown }>, totalQueries: number) {
  let sourceGapQueries = 0;
  let unsupportedQueries = 0;
  let latencyBudgetBreachQueries = 0;

  for (const row of rows) {
    if (!row.metadata || typeof row.metadata !== "object" || Array.isArray(row.metadata)) {
      continue;
    }
    const meta = row.metadata as Record<string, unknown>;

    const isSourceGap =
      meta.source_gap === true ||
      meta.sourceGap === true ||
      meta.fallback_reason_code === "source_gap" ||
      meta.answer_outcome === "source_gap" ||
      (typeof meta.fallback_reason === "string" && meta.fallback_reason.includes("source_gap"));
    if (isSourceGap) {
      sourceGapQueries += 1;
    }

    const isUnsupported =
      meta.unsupported === true ||
      meta.answer_supported === false ||
      meta.grounding_status === "unsupported" ||
      meta.fallback_reason_code === "unsupported" ||
      meta.answer_outcome === "unsupported";
    if (isUnsupported) {
      unsupportedQueries += 1;
    }

    const rawLatency = Number(meta.latency_ms ?? meta.duration_ms ?? meta.total_latency_ms ?? meta.response_ms);
    const budgetMs = resolveRouteLatencyBudgetMs(meta);
    if (meta.latency_budget_breached === true || (Number.isFinite(rawLatency) && rawLatency > budgetMs)) {
      latencyBudgetBreachQueries += 1;
    }
  }

  return {
    sourceGapQueries,
    unsupportedQueries,
    latencyBudgetBreachQueries,
    sourceGapRate: rate(sourceGapQueries, totalQueries),
    unsupportedRate: rate(unsupportedQueries, totalQueries),
    latencyBudgetBreachRate: rate(latencyBudgetBreachQueries, totalQueries),
  };
}

function hybridRpcIdentityEvidence(rows: Array<{ metadata: unknown }>, expectedRows: number) {
  const counts: Record<string, number> = {};
  let complete = rows.length === expectedRows;
  for (const row of rows) {
    const errors =
      row.metadata &&
      typeof row.metadata === "object" &&
      !Array.isArray(row.metadata) &&
      "hybrid_rpc_errors" in row.metadata
        ? (row.metadata as { hybrid_rpc_errors?: unknown }).hybrid_rpc_errors
        : null;
    if (!errors || typeof errors !== "object" || Array.isArray(errors)) {
      complete = false;
      continue;
    }
    const names = Object.keys(errors);
    if (names.length === 0) complete = false;
    for (const name of names) {
      if (!safeRpcIdentifier.test(name)) {
        complete = false;
        continue;
      }
      counts[name] = (counts[name] ?? 0) + 1;
    }
  }
  return { counts, complete };
}

/**
 * Count answered queries in the trailing window and how many carried a
 * `hybrid_rpc_errors` map or an explicit provider-generation fallback flag. Throws on
 * a query error so the caller can mark the probe degraded rather than report a
 * falsely-healthy zero.
 */
export async function answerSloSnapshot(client: SloProbeClient, windowMinutes = 60): Promise<AnswerSloSnapshot> {
  const sinceIso = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const base = () =>
    client
      .from("rag_queries")
      .select("*", { count: "exact", head: true })
      .gt("created_at", sinceIso)
      // Search observations share rag_queries but carry a dedicated event_type.
      // Answer text is privacy-redacted to null by default, so it cannot be the
      // discriminator without hiding normal production answers from the SLO.
      .is("metadata->>event_type", null);

  const windowMetadataRows = client
    .from("rag_queries")
    .select("metadata")
    .gt("created_at", sinceIso)
    .is("metadata->>event_type", null)
    .limit(maxHybridRpcIdentityRows);
  const [total, hybrid, degraded, truncation, timeout, hybridIdentity] = await Promise.all([
    base(),
    base().not("metadata->hybrid_rpc_errors", "is", null),
    // Source-only/extractive answers can be intentional and healthy. Count only
    // model-generation failures that actually forced a local fallback. Keep the
    // legacy reason match until pre-flag rows have aged out of every SLO window.
    base().or(
      "metadata->>provider_generation_degraded.eq.true,metadata->>fallback_reason_code.in.(provider_auth,provider_quota,provider_rate_limit,provider_timeout,provider_failure),metadata->>fallback_reason.ilike.%generation_fallback:%",
    ),
    // fallback_reason values look like "...generation_fallback:provider_incomplete_max_output_tokens"
    // and "...generation_fallback:provider_timeout" (confirmed in live rag_queries).
    base().or("metadata->>provider_generation_truncated.eq.true,metadata->>fallback_reason.ilike.%max_output_tokens%"),
    base().or("metadata->>fallback_reason_code.eq.provider_timeout,metadata->>fallback_reason.ilike.%timeout%"),
    windowMetadataRows,
  ]);

  for (const result of [total, hybrid, degraded, truncation, timeout, hybridIdentity]) {
    if (result.error) {
      if (result.error instanceof Error) throw result.error;
      // Supabase surfaces a plain PostgrestError object ({ message, code, ... }),
      // not an Error — pull the message out rather than stringify to "[object Object]".
      const message =
        result.error && typeof result.error === "object" && "message" in result.error
          ? String((result.error as { message?: unknown }).message ?? "")
          : String(result.error);
      throw new Error(message || "answer SLO count query failed");
    }
  }

  const totalQueries = total.count ?? 0;
  const hybridRpcErrorQueries = hybrid.count ?? 0;
  const degradedQueries = degraded.count ?? 0;
  const truncationFallbackQueries = truncation.count ?? 0;
  const timeoutFallbackQueries = timeout.count ?? 0;
  const metadataRows = hybridIdentity.data ?? [];
  const hybridErrorRows = metadataRows.filter(
    (row) =>
      row.metadata &&
      typeof row.metadata === "object" &&
      !Array.isArray(row.metadata) &&
      "hybrid_rpc_errors" in row.metadata &&
      (row.metadata as { hybrid_rpc_errors?: unknown }).hybrid_rpc_errors !== null &&
      (row.metadata as { hybrid_rpc_errors?: unknown }).hybrid_rpc_errors !== undefined,
  );
  const hybridRpcIdentity = hybridRpcIdentityEvidence(hybridErrorRows, hybridRpcErrorQueries);
  const qualityMetrics = computeAnswerQualitySloMetrics(metadataRows, totalQueries);

  return {
    windowMinutes,
    totalQueries,
    hybridRpcErrorQueries,
    hybridRpcErrorCounts: hybridRpcIdentity.counts,
    hybridRpcIdentityEvidenceComplete: hybridRpcIdentity.complete,
    degradedQueries,
    truncationFallbackQueries,
    timeoutFallbackQueries,
    sourceGapQueries: qualityMetrics.sourceGapQueries,
    unsupportedQueries: qualityMetrics.unsupportedQueries,
    latencyBudgetBreachQueries: qualityMetrics.latencyBudgetBreachQueries,
    hybridRpcErrorRate: rate(hybridRpcErrorQueries, totalQueries),
    degradedRate: rate(degradedQueries, totalQueries),
    truncationFallbackRate: rate(truncationFallbackQueries, totalQueries),
    timeoutFallbackRate: rate(timeoutFallbackQueries, totalQueries),
    sourceGapRate: qualityMetrics.sourceGapRate,
    unsupportedRate: qualityMetrics.unsupportedRate,
    latencyBudgetBreachRate: qualityMetrics.latencyBudgetBreachRate,
  };
}
