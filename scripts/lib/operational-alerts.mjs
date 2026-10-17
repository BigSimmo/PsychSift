const RUNBOOKS = {
  sloUnknown: "docs/observability-slos.md#ops_answer_slo_unknown",
  hybridUnknown: "docs/observability-slos.md#ops_hybrid_rpc_error_rate_unknown",
  degradedUnknown: "docs/observability-slos.md#ops_degraded_answer_rate_unknown",
  hybridWarning: "docs/observability-slos.md#ops_hybrid_rpc_error_rate_warning",
  hybridPage: "docs/observability-slos.md#ops_hybrid_rpc_error_rate_page",
  degradedWarning: "docs/observability-slos.md#ops_degraded_answer_rate_warning",
  degradedPage: "docs/observability-slos.md#ops_degraded_answer_rate_page",
  sourceGapWarning: "docs/observability-slos.md#ops_source_gap_rate_warning",
  unsupportedWarning: "docs/observability-slos.md#ops_unsupported_answer_rate_warning",
  latencyBudgetWarning: "docs/observability-slos.md#ops_answer_latency_budget_warning",
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
  sourceGapUnknown: {
    code: "OPS_SOURCE_GAP_RATE_UNKNOWN",
    severity: "unknown",
    owner: "Clinical evaluation owner",
    escalationOwner: "Clinical safety owner",
    runbook: RUNBOOKS.sourceGapWarning,
  },
  sourceGapWarning: {
    code: "OPS_SOURCE_GAP_RATE_WARNING",
    severity: "warning",
    owner: "Clinical evaluation owner",
    escalationOwner: "Clinical safety owner",
    runbook: RUNBOOKS.sourceGapWarning,
  },
  unsupportedUnknown: {
    code: "OPS_UNSUPPORTED_ANSWER_RATE_UNKNOWN",
    severity: "unknown",
    owner: "AI platform owner",
    escalationOwner: "Clinical safety owner",
    runbook: RUNBOOKS.unsupportedWarning,
  },
  unsupportedWarning: {
    code: "OPS_UNSUPPORTED_ANSWER_RATE_WARNING",
    severity: "warning",
    owner: "AI platform owner",
    escalationOwner: "Clinical safety owner",
    runbook: RUNBOOKS.unsupportedWarning,
  },
  latencyBudgetUnknown: {
    code: "OPS_ANSWER_LATENCY_BUDGET_UNKNOWN",
    severity: "unknown",
    owner: "Platform operations",
    escalationOwner: "AI platform owner",
    runbook: RUNBOOKS.latencyBudgetWarning,
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
 * Evaluate one provider-neutral operations snapshot. The hourly digest supplies
 * identity-only history when it has three contiguous, persisted observations of
 * the same failed RPC. Missing or incomplete history never upgrades a warning.
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
            threshold: { operator: ">=", value: 3, unit: "contiguous hourly windows for the same RPC" },
            windowMinutes: finiteNumber(slo.windowMinutes) ? slo.windowMinutes : 60,
            reason: `Persisted hourly evidence observed ${repeatedHybridRpcNames.join(", ")} in three contiguous windows.`,
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

    if (slo.totalQueries >= 20) {
      const windowMinutes = finiteNumber(slo.windowMinutes) ? slo.windowMinutes : 60;
      if (!validRate(slo.sourceGapRate)) {
        alerts.push(alert(policies.sourceGapUnknown, {
          observedValue: null,
          threshold: { operator: "present", value: true, unit: "sourceGapRate" },
          windowMinutes,
          reason: "Source-gap rate is missing, non-finite, or outside 0..1.",
        }));
      } else if (slo.sourceGapRate > 0.15) {
        alerts.push(
          alert(policies.sourceGapWarning, {
            observedValue: slo.sourceGapRate,
            threshold: { operator: ">", value: 0.15, unit: "rate" },
            windowMinutes,
          }),
        );
      }
      if (!validRate(slo.unsupportedRate)) {
        alerts.push(alert(policies.unsupportedUnknown, {
          observedValue: null,
          threshold: { operator: "present", value: true, unit: "unsupportedRate" },
          windowMinutes,
          reason: "Unsupported-answer rate is missing, non-finite, or outside 0..1.",
        }));
      } else if (slo.unsupportedRate > 0.15) {
        alerts.push(
          alert(policies.unsupportedWarning, {
            observedValue: slo.unsupportedRate,
            threshold: { operator: ">", value: 0.15, unit: "rate" },
            windowMinutes,
          }),
        );
      }
      if (!validRate(slo.latencyBudgetBreachRate)) {
        alerts.push(alert(policies.latencyBudgetUnknown, {
          observedValue: null,
          threshold: { operator: "present", value: true, unit: "latencyBudgetBreachRate" },
          windowMinutes,
          reason: "Latency-budget breach rate is missing, non-finite, or outside 0..1.",
        }));
      } else if (slo.latencyBudgetBreachRate > 0.15) {
        alerts.push(
          alert(policies.latencyBudgetWarning, {
            observedValue: slo.latencyBudgetBreachRate,
            threshold: { operator: ">", value: 0.15, unit: "rate" },
            windowMinutes,
          }),
        );
      }
    }
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
