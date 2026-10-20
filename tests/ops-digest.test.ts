import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  normalizeOpsStatus,
  renderDigest,
  renderIngestionWorkerState,
  renderStorageCleanupBacklog,
  resolveHealthUrl,
  serializeGitHubOutputs,
  updateHybridRpcHourlyEvidence,
} from "../scripts/ops-digest.mjs";
import { evaluateOperationalAlerts, summarizeOperationalAlerts } from "../scripts/lib/operational-alerts.mjs";

describe("resolveHealthUrl", () => {
  it("appends the deep health path to a bare base URL", () => {
    expect(resolveHealthUrl("https://app.example")).toBe("https://app.example/api/health?deep=1");
    expect(resolveHealthUrl("https://app.example/")).toBe("https://app.example/api/health?deep=1");
  });

  it("leaves a full health URL untouched", () => {
    expect(resolveHealthUrl("https://app.example/api/health?deep=1")).toBe("https://app.example/api/health?deep=1");
  });

  it("returns undefined for empty input", () => {
    expect(resolveHealthUrl("")).toBeUndefined();
    expect(resolveHealthUrl(undefined)).toBeUndefined();
  });
});

describe("ops digest workflow contract", () => {
  it("publishes alerting, highest severity, and the compact machine-readable summary", () => {
    const workflow = readFileSync(new URL("../.github/workflows/ops-digest.yml", import.meta.url), "utf8");
    const script = readFileSync(new URL("../scripts/ops-digest.mjs", import.meta.url), "utf8");
    expect(script).toContain("alerting=${safeSummary.alerting}");
    expect(script).toContain("severity=${singleLine(safeSeverity)}");
    expect(script).toContain("alert_summary=${singleLine(JSON.stringify(safeSummary))}");
    expect(workflow).toContain("steps.digest.outputs.severity");
    expect(workflow).toContain("steps.digest.outputs.alert_summary");
    expect(workflow).toContain("OPS_DIGEST_STATUS: ${{ steps.digest.outputs.status }}");
    expect(workflow).toContain("JSON.parse(process.env.OPS_DIGEST_ALERT_SUMMARY");
    expect(workflow).toContain("publish_alert_comment");
    expect(workflow).toContain("publishAttentionComment");
    expect(workflow).toContain("ops-digest-rpc-history");
    // Assignment subscribes the owner; the @mention below is what GitHub mobile pushes to the phone.
    expect(workflow).toContain("github.rest.issues.addAssignees");
    // A scheduled outage (unreachable, degraded or unknown status) must reach the phone too.
    expect(workflow).toContain(
      '(context.eventName === "schedule" && (severity === "warning" || severity === "page" || status !== "ok"))',
    );
    // The rolling issue is reused, so the mention, not the assignment, pushes every later alert.
    expect(workflow).toContain("body: `@${alertAssignee} ⚠ Attention");
    expect(workflow.indexOf("await assignAlert(issueNumber);")).toBeGreaterThan(
      workflow.indexOf('if (publishAttentionComment && (status !== "ok" || alerting))'),
    );
    expect(workflow.indexOf("await assignAlert(issueNumber);")).toBeLessThan(
      workflow.indexOf("github.rest.issues.createComment"),
    );
    expect(workflow).not.toContain('const status = "${{ steps.digest.outputs.status }}"');
    expect(workflow).not.toContain("const alertSummary = '${{ steps.digest.outputs.alert_summary }}'");
  });

  it("allow-lists workflow values and prevents output-command injection", () => {
    expect(normalizeOpsStatus("ok\nowned=true")).toBe("unknown");
    const output = serializeGitHubOutputs("ok\nowned=true", {
      alerting: true,
      severity: "page\nowned=true",
      count: 1,
      codes: ["OPS_SAFE", "OPS_BAD\nowned=true"],
    });
    expect(output).toBe(
      'status=unknown\nalerting=true\nseverity=unknown\nalert_summary={"alerting":true,"severity":"unknown","count":1,"codes":["OPS_SAFE"]}\n',
    );
    expect(output).not.toContain("\nowned=true");
  });
});

describe("hybrid RPC digest-sample evidence", () => {
  it("requires three consecutive identity-complete samples for the same RPC", () => {
    let history: unknown;
    for (const observedAt of ["2026-08-23T01:20:00Z", "2026-08-23T02:20:00Z", "2026-08-23T03:20:00Z"]) {
      const result = updateHybridRpcHourlyEvidence(
        history,
        {
          slo: {
            hybridRpcIdentityEvidenceComplete: true,
            hybridRpcErrorCounts: { hybrid_search: 1, keyword_search: observedAt.endsWith("02:20:00Z") ? 1 : 0 },
          },
        },
        new Date(observedAt),
      );
      history = result.history;
      if (observedAt.endsWith("03:20:00Z")) expect(result.repeatedRpcNames).toEqual(["hybrid_search"]);
    }
  });

  it("counts windows from a manual run between scheduled runs as consecutive evidence", () => {
    const result = updateHybridRpcHourlyEvidence(
      {
        version: 1,
        windows: [
          { hour: "2026-08-23T00:00:00.000Z", rpcNames: ["hybrid_search"] },
          { hour: "2026-08-23T03:00:00.000Z", rpcNames: ["hybrid_search"] },
        ],
      },
      { slo: { hybridRpcIdentityEvidenceComplete: true, hybridRpcErrorCounts: { hybrid_search: 1 } } },
      new Date("2026-08-23T06:20:00Z"),
    );
    expect(result.repeatedRpcNames).toEqual(["hybrid_search"]);
  });

  it("pages from three consecutive six-hourly scheduled samples of the same failing RPC", () => {
    const failing = { slo: { hybridRpcIdentityEvidenceComplete: true, hybridRpcErrorCounts: { hybrid_search: 2 } } };
    let history: unknown;
    let repeated: string[] = [];
    // The schedule is `15 */6 * * *`; the middle fire arrives late, as GitHub cron fires often do.
    for (const observedAt of ["2026-08-23T00:15:00Z", "2026-08-23T07:05:00Z", "2026-08-23T12:15:00Z"]) {
      const result = updateHybridRpcHourlyEvidence(history, failing, new Date(observedAt));
      history = result.history;
      repeated = result.repeatedRpcNames;
    }
    expect(repeated).toEqual(["hybrid_search"]);
    expect(
      evaluateOperationalAlerts(
        { status: "ok", slo: { windowMinutes: 60, totalQueries: 100, hybridRpcErrorRate: 0.02, degradedRate: 0 } },
        { repeatedHybridRpcNames: repeated },
      ).map((item) => item.code),
    ).toContain("OPS_HYBRID_RPC_ERROR_RATE_PAGE");
  });

  it("does not join samples more than two schedule intervals apart", () => {
    const result = updateHybridRpcHourlyEvidence(
      {
        version: 1,
        windows: [
          { hour: "2026-08-23T00:00:00.000Z", rpcNames: ["hybrid_search"] },
          { hour: "2026-08-23T13:00:00.000Z", rpcNames: ["hybrid_search"] },
        ],
      },
      { slo: { hybridRpcIdentityEvidenceComplete: true, hybridRpcErrorCounts: { hybrid_search: 1 } } },
      new Date("2026-08-23T14:20:00Z"),
    );
    expect(result.repeatedRpcNames).toEqual([]);
  });

  it("breaks the paging sequence when an identity snapshot is incomplete", () => {
    const result = updateHybridRpcHourlyEvidence(
      {
        version: 1,
        windows: [
          { hour: "2026-08-23T01:00:00.000Z", rpcNames: ["hybrid_search"] },
          { hour: "2026-08-23T02:00:00.000Z", rpcNames: ["hybrid_search"] },
        ],
      },
      { slo: { hybridRpcIdentityEvidenceComplete: false, hybridRpcErrorCounts: { hybrid_search: 1 } } },
      new Date("2026-08-23T03:20:00Z"),
    );
    expect(result.repeatedRpcNames).toEqual([]);
  });
});

describe("renderDigest", () => {
  it("renders source-gap, unsupported and per-route p95 latency lines", () => {
    const md = renderDigest({
      status: "ok",
      slo: {
        windowMinutes: 60,
        totalQueries: 40,
        hybridRpcErrorRate: 0,
        degradedRate: 0,
        sourceGapQueries: 4,
        sourceGapRate: 0.1,
        unsupportedQueries: 2,
        unsupportedRate: 0.05,
        latencyP95MsByRouteMode: {
          fast: { p95Ms: 21_000, samples: 30 },
          strong: { p95Ms: null, samples: 0 },
          extractive: { p95Ms: 3_000, samples: 10 },
        },
        latencySampleTruncated: true,
      },
    });
    expect(md).toContain("- source gaps: 4 (10.0%)");
    expect(md).toContain("- unsupported: 2 (5.0%)");
    expect(md).toContain("- p95 latency: fast 21.0s (n=30), strong — (n=0), extractive 3.0s (n=10) ⚠ sample capped");
    expect(md).toContain("PAGE OPS_ANSWER_LATENCY_P95_PAGE");
  });

  it("distinguishes an empty hourly window without clearing its unknown-quality alert", () => {
    const health = {
      status: "ok",
      slo: {
        windowMinutes: 60,
        totalQueries: 0,
        hybridRpcErrorRate: 0,
        degradedRate: 0,
        truncationFallbackRate: 0,
        timeoutFallbackRate: 0,
      },
    };
    const md = renderDigest(health);
    expect(md).toContain("**Service readiness:** 🟢 ok");
    expect(md).toContain("No answered queries observed—answer quality not assessed.");
    for (const label of ["hybrid RPC errors", "degraded/source-only", "truncation fallbacks", "timeout fallbacks"]) {
      expect(md).toContain(`${label}: 0 (N/A)`);
    }
    expect(md).not.toContain("0.0%");
    expect(md).toContain("**Alert state:** unknown (1)");
    const summary = summarizeOperationalAlerts(evaluateOperationalAlerts(health));
    expect(summary).toEqual({
      alerting: true,
      severity: "unknown",
      count: 1,
      codes: ["OPS_ANSWER_SLO_UNKNOWN"],
    });
    expect(serializeGitHubOutputs(health.status, summary)).toContain("alerting=true\nseverity=unknown\n");
  });

  it("shows the trailing six-hour answer-quality window that the alerts judge (audit EVAL-02)", () => {
    const md = renderDigest({
      status: "ok",
      slo: { windowMinutes: 60, totalQueries: 0, hybridRpcErrorRate: 0, degradedRate: 0 },
      sloTrailing: {
        windowMinutes: 360,
        totalQueries: 12,
        hybridRpcErrorRate: 0,
        degradedRate: 0,
        sourceGapQueries: 6,
        sourceGapRate: 0.5,
        unsupportedQueries: 1,
        unsupportedRate: 1 / 12,
      },
    });
    expect(md).toContain("**Answer quality** (trailing 360m, the window alerts judge)");
    expect(md).toContain("- source gaps: 6 (50.0%)");
    expect(md).toContain("PAGE OPS_SOURCE_GAP_RATE_PAGE");
    // The empty last hour is shown as such, not as unassessed answer quality.
    expect(md).toContain("**Answer SLO** (trailing 60m)");
    expect(md).toContain("No answered queries in the last 60 minutes.");
    expect(md).not.toContain("No answered queries observed—answer quality not assessed.");
    expect(md).not.toContain("OPS_ANSWER_SLO_UNKNOWN");
  });

  it("says when the trailing window has too few answers to judge rates", () => {
    const md = renderDigest({
      status: "ok",
      sloTrailing: { windowMinutes: 360, totalQueries: 4, hybridRpcErrorRate: 0, degradedRate: 0, sourceGapRate: 0.5 },
    });
    expect(md).toContain("Fewer than 10 answers: source-gap, unsupported and latency-budget rates are not judged.");
    expect(md).toContain("**Alert state:** none (0)");
  });

  it.each([undefined, {}, { windowMinutes: 60 }, { windowMinutes: 30, totalQueries: 0 }])(
    "does not describe missing or invalid hourly telemetry as no answer activity: %j",
    (slo) => {
      const md = renderDigest({ status: "ok", slo });
      expect(md).not.toContain("No answered queries observed—answer quality not assessed.");
      expect(md).toContain("**Alert state:** unknown (1)");
      expect(md).toContain("OPS_ANSWER_SLO_UNKNOWN");
    },
  );

  it.each([
    [0.3, "warning", "OPS_DEGRADED_ANSWER_RATE_WARNING"],
    [0.6, "page", "OPS_DEGRADED_ANSWER_RATE_PAGE"],
  ] as const)("preserves measured degradation at rate %s", (degradedRate, severity, code) => {
    const md = renderDigest({
      status: "ok",
      slo: { windowMinutes: 60, totalQueries: 10, hybridRpcErrorRate: 0, degradedRate },
    });
    expect(md).not.toContain("No answered queries observed—answer quality not assessed.");
    expect(md).not.toContain("N/A");
    expect(md).toContain(`(${(degradedRate * 100).toFixed(1)}%)`);
    expect(md).toContain(`**Alert state:** ${severity} (1)`);
    expect(md).toContain(code);
  });

  it("names the build it measured and when the container answered", () => {
    // Without this the digest could not tell a healthy NEW deploy from a healthy
    // three-day-old one — the exact state the live site sat in while 24 rollbacks
    // went unnoticed. The payload has always carried deploymentCommitSha; nothing
    // read it.
    const md = renderDigest({
      status: "ok",
      demoMode: false,
      uptimeSeconds: 7200,
      timestamp: "2026-09-17T05:29:38.022Z",
      deploymentCommitSha: "a3cfb6362782d2025643371bf0746472515e33ad",
      checks: { supabase: "ok", supabaseConfig: "ok" },
    });
    expect(md).toContain("**Build:** `a3cfb6362782`");
    expect(md).toContain("**Container answered:** 2026-09-17T05:29:38.022Z");
  });

  it("omits the build line when the probe never came back", () => {
    // An absent build line must read as "the probe did not answer", not as a
    // deployment whose identity is unknown to us.
    const md = renderDigest(null, { error: "timeout after 20000ms" });
    expect(md).not.toContain("**Build:**");
  });

  it("reports an answering container whose build SHA is missing as unknown", () => {
    const md = renderDigest({ status: "ok", timestamp: "2026-09-17T05:29:38.022Z", checks: {} });
    expect(md).toContain("**Build:** unknown");
  });

  it("renders an unreachable digest when the probe failed", () => {
    const md = renderDigest(null, { error: "timeout after 20000ms" });
    expect(md).toContain("unreachable");
    expect(md).toContain("timeout after 20000ms");
    expect(md).toContain("OPS_ANSWER_SLO_UNKNOWN");
  });

  it("renders SLO, cache, and spend sections from a healthy payload", () => {
    const md = renderDigest({
      status: "ok",
      demoMode: false,
      uptimeSeconds: 7200,
      checks: { supabase: "ok", supabaseConfig: "ok" },
      slo: {
        windowMinutes: 60,
        totalQueries: 100,
        hybridRpcErrorQueries: 0,
        hybridRpcErrorRate: 0,
        degradedQueries: 4,
        degradedRate: 0.04,
        truncationFallbackQueries: 1,
        truncationFallbackRate: 0.01,
        timeoutFallbackQueries: 0,
        timeoutFallbackRate: 0,
      },
      cache: { lookups: 50, hits: 40, hitRate: 0.8 },
      spend: {
        windowMinutes: 60,
        answers: 100,
        usd: 1.23,
        usdByRoute: { fast: 0.4, strong: 0.83 },
        projectedDailyUsd: 29.52,
        alertDailyUsdThreshold: 50,
        alerting: false,
        sampleTruncated: false,
      },
    });
    expect(md).toContain("🟢 ok");
    expect(md).toContain("Answer SLO");
    expect(md).toContain("degraded/source-only: 4 (4.0%)");
    expect(md).toContain("Cache:** 40/50 hits (80.0%)");
    expect(md).toContain("Spend");
    expect(md).toContain("$1.23");
    expect(md).toContain("projected/day: $29.52");
    expect(md).toContain("fast $0.40");
    expect(md).toContain("Alert state:** none (0)");
  });

  it("flags an over-threshold spend and a truncated sample", () => {
    const md = renderDigest({
      status: "ok",
      spend: {
        windowMinutes: 60,
        answers: 5000,
        usd: 200,
        usdByRoute: {},
        projectedDailyUsd: 4800,
        alertDailyUsdThreshold: 100,
        alerting: true,
        sampleTruncated: true,
      },
    });
    expect(md).toContain("OVER THRESHOLD");
    expect(md).toContain("sample truncated");
    expect(md).toContain("OPS_PROJECTED_DAILY_SPEND_WARNING");
  });
});

// Audit EVAL-03: a deliberately paused worker must read as paused in the digest, not as healthy
// and not as an outage. It never raises an alert by itself; the ingestion autopilot alerts on
// pending uploads that nothing has claimed.
describe("ingestion worker state line", () => {
  it("shows a deliberate pause without changing the alert state", () => {
    const health = { status: "ok" };
    const md = renderDigest(health, { ingestionWorkerPaused: "true" });
    expect(md).toContain(
      "**Ingestion worker:** ⏸ paused on purpose (repository variable INGESTION_WORKER_PAUSED=true). Uploaded documents are not processed until it is resumed. Not an outage: the ingestion autopilot alerts only if an upload waits more than 30 minutes.",
    );
    expect(evaluateOperationalAlerts(health, { ingestionWorkerPaused: "true" })).toEqual(
      evaluateOperationalAlerts(health),
    );
  });

  it("distinguishes an expected-running worker from an unrecorded state", () => {
    expect(renderIngestionWorkerState("false")).toBe("**Ingestion worker:** expected to be running.");
    expect(renderIngestionWorkerState(undefined)).toBe(
      "**Ingestion worker:** state not recorded (set repository variable INGESTION_WORKER_PAUSED to true or false).",
    );
    expect(renderIngestionWorkerState("maybe")).toBe(renderIngestionWorkerState(undefined));
  });

  it("passes the repository variable to the digest step", () => {
    const workflow = readFileSync(new URL("../.github/workflows/ops-digest.yml", import.meta.url), "utf8");
    expect(workflow).toContain("INGESTION_WORKER_PAUSED: ${{ vars.INGESTION_WORKER_PAUSED }}");
  });
});

// Audit F-10: failed storage deletions queue in storage_cleanup_jobs and are drained only by hand.
describe("storage cleanup backlog line", () => {
  const now = Date.parse("2026-10-19T12:00:00.000Z");

  it("shows an empty queue without a drain prompt", () => {
    expect(renderStorageCleanupBacklog({ pending: 0, failed: 0, outstanding: 0, oldestOutstandingAt: null }, now)).toBe(
      "**Storage cleanup backlog:** 0 outstanding (pending 0, failed 0)",
    );
  });

  it("prompts the manual drain when a storage removal failed", () => {
    const line = renderStorageCleanupBacklog(
      { pending: 1, failed: 2, outstanding: 3, oldestOutstandingAt: "2026-10-19T11:59:00.000Z" },
      now,
    );
    expect(line).toContain("3 outstanding (pending 1, failed 2)");
    expect(line).toContain("oldest 2026-10-19T11:59:00.000Z");
    expect(line).toContain("npm run cleanup:storage");
    expect(line).toContain("docs/observability-slos.md#storage-cleanup-backlog");
  });

  it("treats a fresh pending row as an in-flight delete, and an hour-old one as stuck", () => {
    const fresh = renderStorageCleanupBacklog(
      { pending: 1, failed: 0, outstanding: 1, oldestOutstandingAt: "2026-10-19T11:59:30.000Z" },
      now,
    );
    const stuck = renderStorageCleanupBacklog(
      { pending: 1, failed: 0, outstanding: 1, oldestOutstandingAt: "2026-10-19T10:30:00.000Z" },
      now,
    );
    expect(fresh).not.toContain("cleanup:storage");
    expect(stuck).toContain("cleanup:storage");
  });

  it("counts expired processing claims when the probe reports them", () => {
    const line = renderStorageCleanupBacklog(
      { pending: 0, failed: 0, expiredClaims: 2, outstanding: 2, oldestOutstandingAt: "2026-10-19T10:00:00.000Z" },
      now,
    );
    expect(line).toContain("2 outstanding (pending 0, failed 0, expired claims 2)");
    expect(line).toContain("cleanup:storage");
  });

  it("omits the line when the probe did not report usable counts", () => {
    expect(renderStorageCleanupBacklog(undefined, now)).toBeNull();
    expect(renderStorageCleanupBacklog({ pending: -1, failed: 0 }, now)).toBeNull();
    expect(renderStorageCleanupBacklog({ pending: 1.5, failed: 0 }, now)).toBeNull();
    expect(renderStorageCleanupBacklog({ pending: "3", failed: 0 }, now)).toBeNull();
  });

  it("renders the backlog in the digest without changing the alert state", () => {
    const health = {
      status: "ok",
      storageCleanup: { pending: 0, failed: 4, outstanding: 4, oldestOutstandingAt: "2026-10-18T00:00:00.000Z" },
    };
    expect(renderDigest(health)).toContain("**Storage cleanup backlog:** 4 outstanding (pending 0, failed 4)");
    const withoutBacklog = evaluateOperationalAlerts({ status: "ok" }).map((item) => item.code);
    expect(evaluateOperationalAlerts(health).map((item) => item.code)).toEqual(withoutBacklog);
  });

  it("leaves the digest unchanged when the probe has no storageCleanup block", () => {
    expect(renderDigest({ status: "ok" })).not.toContain("Storage cleanup backlog");
  });
});
