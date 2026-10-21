import { describe, expect, it } from "vitest";

import { summariseAnswerSpeed, answerSpeedLine } from "../scripts/lib/answer-speed-line.mjs";
import { computeLatencyBudgetSloMetrics } from "../src/lib/observability/answer-slo";
import { answerLatencyMetadata } from "../src/lib/rag/rag-answer-telemetry-metadata";
import { createAnswerRouteDeadline } from "../src/lib/rag/rag-route-budget";

// Master plan section 4: measure how long answers take before something appears on screen.
// docs/verified-answer-incremental-delivery-design.md promised first_verified_content_ms when the
// evidence preview shipped; audit DOC-11 found it was never recorded.

describe("route deadline first-content stamp", () => {
  it("records the first stamp only, measured from the request start", () => {
    let clock = 1_000;
    const deadline = createAnswerRouteDeadline({ routeMode: "fast", startedAt: 0, now: () => clock });
    expect(deadline.timingFields()).not.toHaveProperty("first_verified_content_ms");
    deadline.markFirstVerifiedContent();
    clock = 5_000;
    deadline.markFirstVerifiedContent();
    expect(deadline.timingFields()).toEqual({
      route_budget_ms: deadline.budgetMs,
      route_deadline_exceeded: false,
      first_verified_content_ms: 1_000,
    });
    deadline.dispose();
  });

  it("works when passed as a bare callback", () => {
    const deadline = createAnswerRouteDeadline({ routeMode: "strong", startedAt: 0, now: () => 250 });
    const hook = deadline.markFirstVerifiedContent;
    hook();
    expect(deadline.timingFields().first_verified_content_ms).toBe(250);
    deadline.dispose();
  });
});

describe("answer latency metadata", () => {
  it("adds first_verified_content_ms only when a preview was sent", () => {
    expect(answerLatencyMetadata(10, 20, { total_latency_ms: 30 }, 0)).not.toHaveProperty("first_verified_content_ms");
    expect(answerLatencyMetadata(10, 20, { total_latency_ms: 30, first_verified_content_ms: 12.4 }, 0)).toMatchObject({
      first_verified_content_ms: 12,
      total_latency_ms: 30,
    });
  });
});

describe("time to first content in the SLO snapshot", () => {
  it("takes the preview when one was sent, otherwise the finished answer", () => {
    const rows = [
      { metadata: { routing_mode: "strong", total_latency_ms: 20_000, first_verified_content_ms: 8_000 } },
      { metadata: { routing_mode: "fast", total_latency_ms: 4_000 } },
      { metadata: { routing_mode: "extractive", total_latency_ms: 2_000, first_verified_content_ms: 9_000 } },
      { metadata: { routing_mode: "fast" } },
    ];
    const { timeToFirstContent } = computeLatencyBudgetSloMetrics(rows, rows.length);
    expect(timeToFirstContent).toEqual({ p50Ms: 4_000, p95Ms: 8_000, samples: 3, previewSamples: 1 });
  });
});

describe("answer speed line", () => {
  const health = {
    sloDaily: {
      latencySampleTruncated: false,
      timeToFirstContent: { p50Ms: 9_840, p95Ms: 21_000, samples: 37, previewSamples: 30 },
    },
  };

  it("states typical and slow time to first content in plain words", () => {
    expect(summariseAnswerSpeed(health)).toBe(
      "Answer speed, last 24 hours: something on screen in 9.8 s typically and 21.0 s at the slow end, across 37 answers. The source preview came first in 30 of them.",
    );
  });

  it("is null for an older build without the daily block, and says so on a quiet day", () => {
    expect(summariseAnswerSpeed({ sloTrailing: {} })).toBeNull();
    expect(
      summariseAnswerSpeed({
        sloDaily: { timeToFirstContent: { p50Ms: null, p95Ms: null, samples: 0, previewSamples: 0 } },
      }),
    ).toBe("Answer speed: no answers recorded in the last 24 hours.");
  });

  it("asks the deep probe for the daily window with the probe secret, and never throws", async () => {
    const seen: Array<{ url: string; token: string | null }> = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      seen.push({ url, token: new Headers(init?.headers).get("x-health-deep-token") });
      return new Response(JSON.stringify(health), { status: 200 });
    };
    const line = await answerSpeedLine({
      env: { PROD_HEALTH_URL: "https://example.test/", HEALTH_DEEP_PROBE_SECRET: "s" },
      fetchImpl,
    });
    expect(line).toContain("9.8 s typically");
    expect(seen).toEqual([{ url: "https://example.test/api/health?deep=1&answer_window=daily", token: "s" }]);

    const refused = async () => new Response("no", { status: 401 });
    expect(
      await answerSpeedLine({
        env: { PROD_HEALTH_URL: "https://x.test", HEALTH_DEEP_PROBE_SECRET: "s" },
        fetchImpl: refused,
      }),
    ).toBeNull();
    expect(await answerSpeedLine({ env: {}, fetchImpl: refused })).toBeNull();
  });
});
