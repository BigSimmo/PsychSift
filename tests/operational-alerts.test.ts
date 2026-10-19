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

  it("emits quality warnings only above the documented thresholds with at least 20 queries", () => {
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

    // Exactly on each warning boundary is still within the SLO.
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
        sourceGapRate: 0.16,
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
    expect(warnings.find((w) => w.code === "OPS_SOURCE_GAP_RATE_WARNING")?.threshold).toEqual({
      operator: ">",
      value: 0.15,
      unit: "rate",
    });
  });

  it("pages source-gap above 30% and unsupported above 25%, without also warning", () => {
    expect(
      evaluateOperationalAlerts(snapshot({ totalQueries: 40, sourceGapRate: 0.3, unsupportedRate: 0.25 })).map(
        (a) => a.code,
      ),
    ).toEqual(["OPS_SOURCE_GAP_RATE_WARNING", "OPS_UNSUPPORTED_ANSWER_RATE_WARNING"]);

    const pages = evaluateOperationalAlerts(snapshot({ totalQueries: 40, sourceGapRate: 0.31, unsupportedRate: 0.26 }));
    expect(pages).toMatchObject([
      { code: "OPS_SOURCE_GAP_RATE_PAGE", severity: "page", observedValue: 0.31, owner: "Clinical evaluation owner" },
      { code: "OPS_UNSUPPORTED_ANSWER_RATE_PAGE", severity: "page", observedValue: 0.26, owner: "AI platform owner" },
    ]);
    expect(pages.every((a) => a.escalationOwner === "Clinical safety owner" && a.runbook.includes("_page"))).toBe(true);
  });

  it("ignores malformed quality rates instead of alerting on them", () => {
    expect(
      evaluateOperationalAlerts(snapshot({ totalQueries: 40, sourceGapRate: 1.5, unsupportedRate: Number.NaN })),
    ).toEqual([]);
  });

  describe("answer latency p95 by routing mode", () => {
    const latency = (byMode: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
      snapshot({ latencyP95MsByRouteMode: byMode, ...extra });

    it("stays quiet on or under each route's p95 budget", () => {
      expect(
        evaluateOperationalAlerts(
          latency({
            fast: { p95Ms: 10_000, samples: 50 },
            strong: { p95Ms: 25_000, samples: 50 },
            extractive: { p95Ms: 6_000, samples: 50 },
          }),
        ),
      ).toEqual([]);
    });

    it("warns above the budget and pages above the page line, one alert per severity", () => {
      const alerts = evaluateOperationalAlerts(
        latency({
          fast: { p95Ms: 20_001, samples: 30 },
          strong: { p95Ms: 25_001, samples: 20 },
          extractive: { p95Ms: 6_500, samples: 40 },
        }),
      );
      expect(alerts).toMatchObject([
        {
          code: "OPS_ANSWER_LATENCY_P95_PAGE",
          severity: "page",
          observedValue: ["fast=20001ms (n=30)"],
          threshold: { operator: ">", value: { fast: 20_000 }, unit: "p95 ms by routing mode" },
        },
        {
          code: "OPS_ANSWER_LATENCY_P95_WARNING",
          severity: "warning",
          observedValue: ["strong=25001ms (n=20)", "extractive=6500ms (n=40)"],
          threshold: { value: { strong: 25_000, extractive: 6_000 } },
        },
      ]);
      expect(alerts.every((a) => a.owner === "Platform operations" && a.escalationOwner === "AI platform owner")).toBe(
        true,
      );
    });

    it("pages strong above 35 s and extractive above 12 s", () => {
      const alerts = evaluateOperationalAlerts(
        latency({ strong: { p95Ms: 35_001, samples: 25 }, extractive: { p95Ms: 12_001, samples: 25 } }),
      );
      expect(alerts.map((a) => a.code)).toEqual(["OPS_ANSWER_LATENCY_P95_PAGE"]);
      expect(alerts[0]?.threshold.value).toEqual({ strong: 35_000, extractive: 12_000 });
    });

    it("does not judge a route with fewer than 20 sampled answers or a missing p95", () => {
      expect(
        evaluateOperationalAlerts(
          latency({ fast: { p95Ms: 60_000, samples: 19 }, strong: { p95Ms: null, samples: 0 }, extractive: {} }),
        ),
      ).toEqual([]);
      expect(evaluateOperationalAlerts(latency(undefined as unknown as Record<string, unknown>))).toEqual([]);
    });

    it("says so when the latency sample was capped", () => {
      const [warning] = evaluateOperationalAlerts(
        latency({ fast: { p95Ms: 11_000, samples: 1000 } }, { latencySampleTruncated: true }),
      );
      expect(warning?.code).toBe("OPS_ANSWER_LATENCY_P95_WARNING");
      expect(warning?.reason).toContain("capped");
    });

    it("never evaluates latency when the SLO window itself is unknown", () => {
      expect(
        evaluateOperationalAlerts(latency({ fast: { p95Ms: 60_000, samples: 50 } }, { totalQueries: 0 })).map(
          (a) => a.code,
        ),
      ).toEqual(["OPS_ANSWER_SLO_UNKNOWN"]);
    });
  });
});
