const RUNBOOKS = {
  sloUnknown: "docs/observability-slos.md#ops_answer_slo_unknown",
  hybridUnknown: "docs/observability-slos.md#ops_hybrid_rpc_error_rate_unknown",
  degradedUnknown: "docs/observability-slos.md#ops_degraded_answer_rate_unknown",
  hybridWarning: "docs/observability-slos.md#ops_hybrid_rpc_error_rate_warning",
  hybridPage: "docs/observability-slos.md#ops_hybrid_rpc_error_rate_page",
  degradedWarning: "docs/observability-slos.md#ops_degraded_answer_rate_warning",
  degradedPage: "docs/observability-slos.md#ops_degraded_answer_rate_page",
  sourceGapWarning: "docs/observability-slos.md#ops_source_gap_rate_warning",
  sourceGapPage: "docs/observability-slos.md#ops_source_gap_rate_page",
  unsupportedWarning: "docs/observability-slos.md#ops_unsupported_answer_rate_warning",
  unsupportedPage: "docs/observability-slos.md#ops_unsupported_answer_rate_page",
  latencyBudgetWarning: "docs/observability-slos.md#ops_answer_latency_budget_warning",
  latencyP95Warning: "docs/observability-slos.md#ops_answer_latency_p95_warning",
  latencyP95Page: "docs/observability-slos.md#ops_answer_latency_p95_page",
  spend: "docs/observability-slos.md#ops_projected_daily_spend_warning",
  canary: "docs/observability-slos.md#ops_eval_canary_stale_warning",
};

const severityRank = { none: 0, unknown: 1, warning: 2, page: 3 };

const policies = {
  sloUnknown: {
    code: "OPS_ANSWER_SLO_UNKNOWN",
    severity: "unknown",
    owner: "Platform operations",
    escalationOwner: "Clinical safety owner",
    runbook: RUNBOOKS.sloUnknown,
  },
  hybridUnknown: {
    code: "OPS_HYBRID_RPC_ERROR_RATE_UNKNOWN",
    severity: "unknown",
    owner: "Platform operations",
    escalationOwner: "Clinical safety owner",
    runbook: RUNBOOKS.hybridUnknown,
  },
  degradedUnknown: {
    code: "OPS_DEGRADED_ANSWER_RATE_UNKNOWN",
    severity: "unknown",
    owner: "AI platform owner",
    escalationOwner: "Clinical safety owner",
    runbook: RUNBOOKS.degradedUnknown,
  },
  hybridWarning: {
    code: "OPS_HYBRID_RPC_ERROR_RATE_WARNING",
    severity: "warning",
    owner: "Platform operations",
    escalationOwner: "Clinical safety owner",
    runbook: RUNBOOKS.hybridWarning,
  },
  hybridPage: {
    code: "OPS_HYBRID_RPC_ERROR_RATE_PAGE",
    severity: "page",
    owner: "Platform operations",
    escalationOwner: "Clinical safety owner",
    runbook: RUNBOOKS.hybridPage,
  },
  degradedWarning: {
    code: "OPS_DEGRADED_ANSWER_RATE_WARNING",
    severity: "warning",
    owner: "AI platform owner",
    escalationOwner: "Clinical safety owner",
    runbook: RUNBOOKS.degradedWarning,
  },
  degradedPage: {
    code: "OPS_DEGRADED_ANSWER_RATE_PAGE",
    severity: "page",
    owner: "AI platform owner",
    escalationOwner: "Clinical safety owner",
    runbook: RUNBOOKS.degradedPage,
  },
  sourceGapWarning: {
    code: "OPS_SOURCE_GAP_RATE_WARNING",
    severity: "warning",
    owner: "Clinical evaluation owner",
    escalationOwner: "Clinical safety owner",
    runbook: RUNBOOKS.sourceGapWarning,
  },
  sourceGapPage: {
    code: "OPS_SOURCE_GAP_RATE_PAGE",
    severity: "page",
    owner: "Clinical evaluation owner",
    escalationOwner: "Clinical safety owner",
    runbook: RUNBOOKS.sourceGapPage,
  },
  unsupportedPage: {
    code: "OPS_UNSUPPORTED_ANSWER_RATE_PAGE",
    severity: "page",
    owner: "AI platform owner",
    escalationOwner: "Clinical safety owner",
    runbook: RUNBOOKS.unsupportedPage,
  },
  latencyP95Warning: {
    code: "OPS_ANSWER_LATENCY_P95_WARNING",
    severity: "warning",
    owner: "Platform operations",
    escalationOwner: "AI platform owner",
    runbook: RUNBOOKS.latencyP95Warning,
  },
  latencyP95Page: {
    code: "OPS_ANSWER_LATENCY_P95_PAGE",
    severity: "page",
    owner: "Platform operations",
    escalationOwner: "AI platform owner",
    runbook: RUNBOOKS.latencyP95Page,
  },
  unsupportedWarning: {
    code: "OPS_UNSUPPORTED_ANSWER_RATE_WARNING",
    severity: "warning",
    owner: "AI platform owner",
    escalationOwner: "Clinical safety owner",
    runbook: RUNBOOKS.unsupportedWarning,
  },
  latencyBudgetWarning: {
    code: "OPS_ANSWER_LATENCY_BUDGET_WARNING",
    severity: "warning",
    owner: "Platform operations",
    escalationOwner: "AI platform owner",
    runbook: RUNBOOKS.latencyBudgetWarning,
  },
  spend: {
    code: "OPS_PROJECTED_DAILY_SPEND_WARNING",
    severity: "warning",
    owner: "Platform operations",
    escalationOwner: "Product owner",
    runbook: RUNBOOKS.spend,
  },
  canary: {
    code: "OPS_EVAL_CANARY_STALE_WARNING",
    severity: "warning",
    owner: "Clinical evaluation owner",
    escalationOwner: "Clinical safety owner",
    runbook: RUNBOOKS.canary,
  },
};

function alert(policy, details) {
  return { ...policy, ...details };
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function validRate(value) {
  return finiteNumber(value) && value >= 0 && value <= 1;
}

/**
 * docs/observability-slos.md §2 configured thresholds, applied to the digest's 60-minute snapshot.
 * Rates are 0..1 and strictly-greater-than; latencies are p95 milliseconds per routing mode.
 * Kept in one table so the doc and the code can be compared line by line.
 */
export const ANSWER_QUALITY_THRESHOLDS = Object.freeze({
  minimumQueries: 20,
  sourceGapRate: Object.freeze({ warning: 0.15, page: 0.3 }),
  unsupportedRate: Object.freeze({ warning: 0.15, page: 0.25 }),
  latencyBudgetBreachRate: Object.freeze({ warning: 0.15 }),
});

export const ANSWER_LATENCY_P95_THRESHOLDS_MS = Object.freeze({
  fast: Object.freeze({ warning: 10_000, page: 20_000 }),
  strong: Object.freeze({ warning: 25_000, page: 35_000 }),
  extractive: Object.freeze({ warning: 6_000, page: 12_000 }),
});

/** A route's p95 is only judged once the sample holds this many of its answers. */
export const ANSWER_LATENCY_P95_MIN_SAMPLES = 20;

function rateAlert(rateValue, thresholds, warningPolicy, pagePolicy, windowMinutes) {
  if (!validRate(rateValue)) return null;
  if (pagePolicy && rateValue > thresholds.page) {
    return alert(pagePolicy, {
      observedValue: rateValue,
      threshold: { operator: ">", value: thresholds.page, unit: "rate" },
      windowMinutes,
    });
  }
  if (rateValue > thresholds.warning) {
    return alert(warningPolicy, {
      observedValue: rateValue,
      threshold: { operator: ">", value: thresholds.warning, unit: "rate" },
      windowMinutes,
    });
  }
  return null;
}

/**
 * One alert per severity, naming every route mode over that severity's p95 threshold.
 * A mode that pages is not repeated in the warning list.
 */
function latencyP95Alerts(byMode, sampleTruncated, windowMinutes) {
  if (!byMode || typeof byMode !== "object") return [];
  const breaches = { page: [], warning: [] };
  for (const [mode, limits] of Object.entries(ANSWER_LATENCY_P95_THRESHOLDS_MS)) {
    const entry = byMode[mode];
    if (!entry || !finiteNumber(entry.p95Ms) || entry.p95Ms < 0) continue;
    if (!Number.isInteger(entry.samples) || entry.samples < ANSWER_LATENCY_P95_MIN_SAMPLES) continue;
    const observed = `${mode}=${Math.round(entry.p95Ms)}ms (n=${entry.samples})`;
    if (entry.p95Ms > limits.page) breaches.page.push({ mode, observed, limit: limits.page });
    else if (entry.p95Ms > limits.warning) breaches.warning.push({ mode, observed, limit: limits.warning });
  }
  const note = sampleTruncated ? " Latency sample was capped, so the p95 covers part of the window only." : "";
  const result = [];
  for (const [severity, policy] of [
    ["page", policies.latencyP95Page],
    ["warning", policies.latencyP95Warning],
  ]) {
    const items = breaches[severity];
    if (items.length === 0) continue;
    result.push(
      alert(policy, {
        observedValue: items.map((item) => item.observed),
        threshold: {
          operator: ">",
          value: Object.fromEntries(items.map((item) => [item.mode, item.limit])),
          unit: "p95 ms by routing mode",
        },
        windowMinutes,
        reason: `p95 answer latency over the ${severity} threshold for ${items.map((item) => item.mode).join(", ")}.${note}`,
      }),
    );
  }
  return result;
}

/**
 * Evaluate one provider-neutral operations snapshot. The six-hourly digest supplies
 * identity-only history when three consecutive persisted digest samples (scheduled
 * or manual, whatever their spacing within the joining limit in ops-digest.mjs)
 * observed the same failed RPC. Missing or incomplete history never upgrades a warning.
 */
export function evaluateOperationalAlerts(health, context = {}) {
  const alerts = [];
  const slo = health?.slo;

  if (!slo || !finiteNumber(slo.totalQueries) || slo.totalQueries <= 0 || slo.windowMinutes !== 60) {
    alerts.push(
      alert(policies.sloUnknown, {
        observedValue: slo?.totalQueries ?? null,
        threshold: { operator: ">", value: 0, unit: "queries" },
        windowMinutes: finiteNumber(slo?.windowMinutes) ? slo.windowMinutes : null,
        reason: !slo
          ? "Answer SLO data is missing."
          : slo.windowMinutes !== 60
            ? "Answer SLO snapshot must cover exactly one 60-minute hourly window."
            : "No answered queries were observed; rates cannot establish health.",
      }),
    );
  } else {
    const hybridRate = validRate(slo.hybridRpcErrorRate) ? slo.hybridRpcErrorRate : null;
    if (hybridRate === null) {
      alerts.push(
        alert(policies.hybridUnknown, {
          observedValue: null,
          threshold: { operator: "present", value: true, unit: "hybridRpcErrorRate" },
          windowMinutes: finiteNumber(slo.windowMinutes) ? slo.windowMinutes : null,
          reason: "Hybrid-RPC error rate is missing, non-finite, or outside 0..1.",
        }),
      );
    } else {
      const repeatedHybridRpcNames = Array.from(
        new Set(
          (Array.isArray(context.repeatedHybridRpcNames) ? context.repeatedHybridRpcNames : []).filter(
            (name) => typeof name === "string" && /^[a-zA-Z][a-zA-Z0-9_]{0,127}$/.test(name),
          ),
        ),
      ).sort();
      if (hybridRate > 0 && repeatedHybridRpcNames.length > 0) {
        alerts.push(
          alert(policies.hybridPage, {
            observedValue: repeatedHybridRpcNames,
            threshold: { operator: ">=", value: 3, unit: "consecutive digest samples for the same RPC" },
            windowMinutes: finiteNumber(slo.windowMinutes) ? slo.windowMinutes : 60,
            reason: `Persisted digest evidence observed ${repeatedHybridRpcNames.join(", ")} in three consecutive samples.`,
          }),
        );
      } else if (hybridRate > 0.005) {
        alerts.push(
          alert(policies.hybridWarning, {
            observedValue: hybridRate,
            threshold: { operator: ">", value: 0.005, unit: "rate" },
            windowMinutes: finiteNumber(slo.windowMinutes) ? slo.windowMinutes : 60,
          }),
        );
      }
    }

    const degradedRate = validRate(slo.degradedRate) ? slo.degradedRate : null;
    if (degradedRate === null) {
      alerts.push(
        alert(policies.degradedUnknown, {
          observedValue: null,
          threshold: { operator: "present", value: true, unit: "degradedRate" },
          windowMinutes: finiteNumber(slo.windowMinutes) ? slo.windowMinutes : null,
          reason: "Degraded-answer rate is missing, non-finite, or outside 0..1.",
        }),
      );
    } else if (degradedRate > 0.5) {
      alerts.push(
        alert(policies.degradedPage, {
          observedValue: degradedRate,
          threshold: { operator: ">", value: 0.5, unit: "rate" },
          windowMinutes: finiteNumber(slo.windowMinutes) ? slo.windowMinutes : 60,
        }),
      );
    } else if (degradedRate > 0.2) {
      alerts.push(
        alert(policies.degradedWarning, {
          observedValue: degradedRate,
          threshold: { operator: ">", value: 0.2, unit: "rate" },
          windowMinutes: finiteNumber(slo.windowMinutes) ? slo.windowMinutes : 60,
        }),
      );
    }

    const windowMinutes = finiteNumber(slo.windowMinutes) ? slo.windowMinutes : 60;
    if (slo.totalQueries >= ANSWER_QUALITY_THRESHOLDS.minimumQueries) {
      for (const item of [
        rateAlert(
          slo.sourceGapRate,
          ANSWER_QUALITY_THRESHOLDS.sourceGapRate,
          policies.sourceGapWarning,
          policies.sourceGapPage,
          windowMinutes,
        ),
        rateAlert(
          slo.unsupportedRate,
          ANSWER_QUALITY_THRESHOLDS.unsupportedRate,
          policies.unsupportedWarning,
          policies.unsupportedPage,
          windowMinutes,
        ),
        rateAlert(
          slo.latencyBudgetBreachRate,
          ANSWER_QUALITY_THRESHOLDS.latencyBudgetBreachRate,
          policies.latencyBudgetWarning,
          null,
          windowMinutes,
        ),
      ]) {
        if (item) alerts.push(item);
      }
    }
    alerts.push(...latencyP95Alerts(slo.latencyP95MsByRouteMode, slo.latencySampleTruncated === true, windowMinutes));
  }

  if (health?.spend?.alerting) {
    alerts.push(
      alert(policies.spend, {
        observedValue: finiteNumber(health.spend.projectedDailyUsd) ? health.spend.projectedDailyUsd : null,
        threshold: {
          operator: ">",
          value: finiteNumber(health.spend.alertDailyUsdThreshold) ? health.spend.alertDailyUsdThreshold : null,
          unit: "USD/day",
        },
        windowMinutes: finiteNumber(health.spend.windowMinutes) ? health.spend.windowMinutes : null,
      }),
    );
  }

  if (context.canaryStale) {
    alerts.push(
      alert(policies.canary, {
        observedValue: true,
        threshold: { operator: ">", value: 8, unit: "days since completed canary" },
        windowMinutes: null,
        reason: context.canaryMessage || "The weekly eval canary is stale.",
      }),
    );
  }

  return alerts.sort(
    (left, right) => severityRank[right.severity] - severityRank[left.severity] || left.code.localeCompare(right.code),
  );
}

export function summarizeOperationalAlerts(alerts) {
  const highestSeverity = alerts.reduce(
    (highest, item) => (severityRank[item.severity] > severityRank[highest] ? item.severity : highest),
    "none",
  );
  return {
    // Unknown telemetry needs an operator response just as much as a measured
    // breach; otherwise a broken probe silently suppresses notifications.
    alerting: alerts.length > 0,
    severity: highestSeverity,
    count: alerts.length,
    codes: alerts.map((item) => item.code),
  };
}
