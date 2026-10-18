import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { evaluateOperationalAlerts, summarizeOperationalAlerts } from "../scripts/lib/operational-alerts.mjs";

function snapshot(overrides = {}) {
  return {
    status: "ok",
    slo: {
      windowMinutes: 60,
      totalQueries: 100,
      hybridRpcErrorRate: 0,
      degradedRate: 0,
      ...overrides,
    },
  };
}

describe("evaluateOperationalAlerts", () => {
  it("gives every configured alert a runbook with diagnosis and recovery actions", () => {
    const source = readFileSync("scripts/lib/operational-alerts.mjs", "utf8");
    const runbook = readFileSync("docs/observability-slos.md", "utf8");
    const codes = [...source.matchAll(/code: "(OPS_[A-Z_]+)"/g)].map((match) => match[1]);
    expect(codes.length).toBeGreaterThan(0);
    for (const code of codes) {
      const section = runbook.split(`### \`${code}\``)[1]?.split(/\n###? /)[0];
      expect(section, `Missing runbook for ${code}`).toBeDefined();
      for (const action of ["Diagnose", "Acknowledge", "Recover", "Escalate"]) {
        expect(section, `${code} needs ${action}`).toContain(`**${action}:**`);
      }
    }
    expect(runbook).not.toContain("Only two of the");
    expect(runbook).toContain("latencyBudgetBreachRate");
    expect(runbook).toContain("at least 20");
  });

  it("warns only above the hybrid-RPC 0.5% boundary", () => {
    expect(evaluateOperationalAlerts(snapshot({ hybridRpcErrorRate: 0.005 }))).toEqual([]);
    expect(evaluateOperationalAlerts(snapshot({ hybridRpcErrorRate: 0.0051 }))).toMatchObject([
      { code: "OPS_HYBRID_RPC_ERROR_RATE_WARNING", severity: "warning", owner: "Platform operations" },
    ]);
  });

  it("pages only when persisted evidence names the same failing RPC across three contiguous hours", () => {
    expect(evaluateOperationalAlerts(snapshot({ hybridRpcErrorRate: 0.01 }))[0]?.severity).toBe("warning");
    expect(
      evaluateOperationalAlerts(snapshot({ hybridRpcErrorRate: 0.001 }), {
        repeatedHybridRpcNames: ["hybrid_search"],
      })[0],
    ).toMatchObject({
      code: "OPS_HYBRID_RPC_ERROR_RATE_PAGE",
      severity: "page",
      observedValue: ["hybrid_search"],
    });
    expect(
      evaluateOperationalAlerts(snapshot({ hybridRpcErrorRate: 0.001 }), { repeatedHybridRpcNames: ["bad name"] }),
    ).toEqual([]);
  });

  it("warns above 20% and pages above 50% degraded answers", () => {
    expect(evaluateOperationalAlerts(snapshot({ degradedRate: 0.2 }))).toEqual([]);
    expect(evaluateOperationalAlerts(snapshot({ degradedRate: 0.2001 }))[0]?.code).toBe(
      "OPS_DEGRADED_ANSWER_RATE_WARNING",
    );
    expect(evaluateOperationalAlerts(snapshot({ degradedRate: 0.5 }))[0]?.severity).toBe("warning");
    expect(evaluateOperationalAlerts(snapshot({ degradedRate: 0.5001 }))[0]?.code).toBe(
      "OPS_DEGRADED_ANSWER_RATE_PAGE",
    );
  });

  it("treats missing SLO data and a zero denominator as unknown, never healthy", () => {
    const missing = evaluateOperationalAlerts({ status: "ok" });
    expect(missing[0]).toMatchObject({
      code: "OPS_ANSWER_SLO_UNKNOWN",
      severity: "unknown",
    });
    expect(summarizeOperationalAlerts(missing).alerting).toBe(true);
    expect(evaluateOperationalAlerts(snapshot({ totalQueries: 0 }))[0]).toMatchObject({
      code: "OPS_ANSWER_SLO_UNKNOWN",
      observedValue: 0,
    });
  });

  it("treats malformed rates and non-hourly snapshots as unknown", () => {
    for (const hybridRpcErrorRate of [-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(evaluateOperationalAlerts(snapshot({ hybridRpcErrorRate }))[0]).toMatchObject({
        code: "OPS_HYBRID_RPC_ERROR_RATE_UNKNOWN",
        severity: "unknown",
      });
    }
    for (const degradedRate of [-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(evaluateOperationalAlerts(snapshot({ degradedRate }))[0]).toMatchObject({
        code: "OPS_DEGRADED_ANSWER_RATE_UNKNOWN",
        severity: "unknown",
      });
    }
    expect(evaluateOperationalAlerts(snapshot({ windowMinutes: 59 }))).toMatchObject([
      { code: "OPS_ANSWER_SLO_UNKNOWN", severity: "unknown", windowMinutes: 59 },
    ]);
    expect(evaluateOperationalAlerts(snapshot({ windowMinutes: 61 }))).toMatchObject([
      { code: "OPS_ANSWER_SLO_UNKNOWN", severity: "unknown", windowMinutes: 61 },
    ]);
  });

  it("preserves spend and stale-canary signals and orders multiple alerts by severity", () => {
    const alerts = evaluateOperationalAlerts(
      {
        ...snapshot({ degradedRate: 0.8 }),
        spend: { alerting: true, projectedDailyUsd: 120, alertDailyUsdThreshold: 100, windowMinutes: 60 },
      },
      { canaryStale: true, canaryMessage: "last run 9 days ago" },
    );
    expect(alerts.map((item) => item.code)).toEqual([
      "OPS_DEGRADED_ANSWER_RATE_PAGE",
      "OPS_EVAL_CANARY_STALE_WARNING",
      "OPS_PROJECTED_DAILY_SPEND_WARNING",
    ]);
    expect(summarizeOperationalAlerts(alerts)).toEqual({
      alerting: true,
      severity: "page",
      count: 3,
      codes: alerts.map((item) => item.code),
    });
    expect(alerts.every((item) => item.escalationOwner && item.runbook)).toBe(true);
  });

  it("emits source-gap, unsupported-answer, and latency-budget warnings when >15% with at least 20 queries", () => {
    expect(
      evaluateOperationalAlerts(
        snapshot({
          totalQueries: 19,
          sourceGapRate: 0.5,
          unsupportedRate: 0.5,
          latencyBudgetBreachRate: 0.5,
        }),
      ),
    ).toEqual([]);

    expect(
      evaluateOperationalAlerts(
        snapshot({
          totalQueries: 20,
          sourceGapRate: 0.15,
          unsupportedRate: 0.15,
          latencyBudgetBreachRate: 0.15,
        }),
      ),
    ).toEqual([]);

    const warnings = evaluateOperationalAlerts(
      snapshot({
        totalQueries: 25,
        sourceGapRate: 0.2,
        unsupportedRate: 0.24,
        latencyBudgetBreachRate: 0.16,
      }),
    );
    expect(warnings.map((w) => w.code)).toEqual([
      "OPS_ANSWER_LATENCY_BUDGET_WARNING",
      "OPS_SOURCE_GAP_RATE_WARNING",
      "OPS_UNSUPPORTED_ANSWER_RATE_WARNING",
    ]);
    expect(warnings.every((w) => w.severity === "warning" && Boolean(w.runbook))).toBe(true);
  });
});
