import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { frozenSources, parseComparisonFixtures } from "../scripts/compare-answer-models";
import {
  buildSmokeOutcome,
  buildSmokePlan,
  createSmokeTransport,
  runOfflineSmoke,
  smokeLimits,
  validateSmokeApproval,
  type SmokeRequest,
  type SmokePriceCard,
} from "../scripts/smoke-answer-models";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
});

const plan = (): SmokeRequest[] =>
  Array.from({ length: 12 }, () => ["control", "candidate"] as const).flatMap((arms, i) =>
    arms.map((arm) => {
      const route = i % 2 ? "strong" : "fast";
      const model = arm === "candidate" ? "gpt-6.1-sol" : route === "fast" ? "gpt-5.6-terra" : "gpt-5.6-sol";
      return {
        model,
        caseId: `synthetic-case-${i}`,
        arm,
        route,
        tokenBody: {
          model,
          input: `Synthetic equipment case ${i}`,
          instructions: "Use only the synthetic sources.",
          reasoning: { effort: route === "fast" ? "low" : "medium" },
          text: {
            format: { type: "json_schema", name: "clinical_rag_answer", strict: true, schema: { type: "object" } },
          },
        },
      };
    }),
  );
// Invented rates exercise budget arithmetic only; never use these as live pricing evidence.
const card = (): SmokePriceCard => ({
  verifiedAt: "2026-11-03",
  sources: ["https://developers.openai.com/api/docs/pricing"],
  serviceTier: "default",
  region: "global",
  counting: {
    usdPerRequest: 0.0001,
    source: "https://developers.openai.com/api/docs/pricing",
    verifiedAt: "2026-11-03",
  },
  models: Object.fromEntries(
    ["gpt-5.6-terra", "gpt-5.6-sol", "gpt-6.1-sol"].map((model) => [
      model,
      { input: 1, output: 2, cacheWrite: 1.25, maxContextTokens: 1000000, maxOutputTokens: 32000 },
    ]),
  ),
});
const caps = () => ({
  maxUsd: 5,
  remainingMonthlyUsd: 5,
  maxRequests: 48,
  maxInputTokens: 1000000,
  maxOutputTokens: 384000,
  maxRuntimeMs: 840000,
});
const init = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
const generated = (p: SmokeRequest) => ({
  ...p.tokenBody,
  max_output_tokens: 16000,
  store: false,
  service_tier: "default",
  metadata: { operation: "answer" },
});
function setup(options: { inputTokens?: number; countFee?: number; now?: () => number; dispatchError?: boolean } = {}) {
  const requests = plan(),
    prices = card(),
    events: string[] = [];
  if (options.countFee !== undefined) prices.counting.usdPerRequest = options.countFee;
  const dispatch = vi.fn(async (url: string) => {
    events.push("dispatch");
    if (options.dispatchError) throw new Error("synthetic transport failed");
    return new Response(
      JSON.stringify(
        url.endsWith("input_tokens")
          ? { object: "response.input_tokens", input_tokens: options.inputTokens ?? 200 }
          : { status: "completed" },
      ),
      { headers: { "content-type": "application/json" } },
    );
  });
  const persist = vi.fn(async () => {
    events.push("persist");
  });
  const transport = createSmokeTransport({
    plan: requests,
    card: prices,
    caps: caps(),
    persist,
    dispatch,
    now: options.now,
  });
  return { requests, prices, events, dispatch, persist, transport };
}
async function countAll(f: ReturnType<typeof setup>) {
  for (const request of f.requests)
    await f.transport.fetch("https://api.openai.com/v1/responses/input_tokens", init(request.tokenBody));
}

describe("bounded exact-count model smoke transport", () => {
  it.each([
    { grounded: true, confidence: "high", rawGrounded: true, rawConfidence: "high" },
    {
      grounded: "synthetic-invalid-grounded-value",
      confidence: { unexpected: "synthetic-invalid-confidence-value" },
      rawGrounded: "invalid",
      rawConfidence: "invalid",
    },
  ])("retains diagnostics in serialized paid smoke outcomes: %j", async (flags) => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network forbidden"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const cases = parseComparisonFixtures(
      await readFile(new URL("../scripts/fixtures/rag-model-comparison.json", import.meta.url), "utf8"),
    );
    const testCase = cases.find((item) => item.unsupported)!;
    const request = (await buildSmokePlan(cases)).find(
      (item) => item.caseId === testCase.id && item.arm === "candidate",
    )!;
    const result = {
      model: request.model,
      providerModel: request.model,
      requestId: "synthetic-request-id",
      operation: "answer" as const,
      latencyMs: 1,
      status: "completed" as const,
      truncated: false,
      text: JSON.stringify({
        answer: "The synthetic sources do not specify the requested information.",
        grounded: flags.grounded,
        confidence: flags.confidence,
        citations: [],
        answerSections: [],
        conflictsOrGaps: [],
        quoteCards: [],
      }),
    };
    const { parseAnswerJson } = await import("../src/lib/rag/rag");
    const answer = parseAnswerJson(result.text, frozenSources(testCase), testCase.question);
    // Exercise the paid loop's constructor directly; the offline executor cannot cover it.
    const outcome = JSON.parse(JSON.stringify(buildSmokeOutcome(request, testCase, result, answer, 1)));
    expect(outcome).toMatchObject({ status: "completed", checks: { passed: false } });
    expect(outcome.diagnostics).toEqual({
      raw: { jsonObject: true, grounded: flags.rawGrounded, confidence: flags.rawConfidence },
      parsed: {
        grounded: false,
        confidence: "unsupported",
        routingFlags: [flags.rawGrounded === "invalid" ? "structured_parse_fallback" : "ungrounded_no_model_citation"],
        otherRoutingReason: false,
        unverifiedNumericCount: 0,
        faithfulnessWarning: false,
      },
    });
    expect(JSON.stringify(outcome.diagnostics)).not.toContain("synthetic-invalid");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("accepts the exact official counting fee article, refusing lookalikes", () => {
    const prices = card();
    prices.counting.source = "https://help.openai.com/en/articles/4936856-understanding-and-counting-tokens";
    prices.counting.usdPerRequest = 0;
    const options = {
      plan: plan(),
      card: prices,
      caps: caps(),
      persist: async () => {},
      dispatch: async () => new Response(),
    };
    expect(() => createSmokeTransport(options)).not.toThrow();
    for (const source of [
      prices.counting.source + ".example.test",
      "https://help.openai.com.example.test/en/articles/4936856-understanding-and-counting-tokens",
      "https://help.openai.com/en/articles/other",
    ])
      expect(() =>
        createSmokeTransport({ ...options, card: { ...prices, counting: { ...prices.counting, source } } }),
      ).toThrow("count_pricing_unverified");
  });
  it("runs every frozen synthetic case for both models without a provider client or network", async () => {
    const cases = parseComparisonFixtures(
      await readFile(new URL("../scripts/fixtures/rag-model-comparison.json", import.meta.url), "utf8"),
    );
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network forbidden"));
    const result = await runOfflineSmoke(cases);
    expect(result).toMatchObject({ complete: true, accepted: false, providerRequests: 0 });
    expect(result.outcomes).toHaveLength(24);
    expect(new Set(result.outcomes.map((o) => o.caseId)).size).toBe(12);
    expect(result.outcomes.filter((o) => o.arm === "candidate").every((o) => o.model === "gpt-6.1-sol")).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("can complete 24 exact counts and 24 frozen generation calls without reserving full model contexts", async () => {
    const f = setup();
    await countAll(f);
    f.transport.startGeneration();
    for (const request of f.requests)
      await f.transport.fetch("https://api.openai.com/v1/responses", init(generated(request)));
    expect(f.transport.snapshot()).toMatchObject({
      countRequests: 24,
      generationRequests: 24,
      inputTokens: 4800,
      outputTokens: 384000,
      stage: "complete",
    });
    expect(f.dispatch).toHaveBeenCalledTimes(48);
    expect(f.events.every((event, i) => event === (i % 2 ? "dispatch" : "persist"))).toBe(true);
  });
  it("refuses generation before all count responses are verified", async () => {
    const f = setup();
    expect(() => f.transport.startGeneration()).toThrow();
    expect(f.dispatch).not.toHaveBeenCalled();
  });
  it("refuses full-plan exact input/cost overflow before the first generation", async () => {
    const f = setup({ inputTokens: 50000 });
    await countAll(f);
    expect(() => f.transport.startGeneration()).toThrow();
    expect(f.transport.snapshot()).toMatchObject({ generationRequests: 0 });
  });

  it("checks full-plan counted cost before generation even when input and output volumes fit", async () => {
    const prices = card();
    for (const price of Object.values(prices.models)) price.output = 1000;
    const dispatch = vi.fn(
      async () => new Response(JSON.stringify({ object: "response.input_tokens", input_tokens: 200 })),
    );
    const t = createSmokeTransport({ plan: plan(), card: prices, caps: caps(), persist: async () => {}, dispatch });
    for (const p of plan()) await t.fetch("https://api.openai.com/v1/responses/input_tokens", init(p.tokenBody));
    expect(() => t.startGeneration()).toThrow("full_generation_budget");
    expect(t.snapshot()).toMatchObject({ generationRequests: 0 });
  });

  it("requires current monthly usage evidence within the existing dollar cap and exact source identity", () => {
    const now = Date.parse("2026-11-03T12:00:00Z");
    const identity = {
      sourceSha256: "a".repeat(64),
      fixturesSha256: "b".repeat(64),
      configurationSha256: "c".repeat(64),
      environmentSha256: "d".repeat(64),
    };
    const approved = {
      ...identity,
      version: 1,
      approvalReference: "synthetic-approval-only",
      outputDirectory: resolve("output/answer-model-comparison/synthetic-only"),
      approvedAt: new Date(now - 1000).toISOString(),
      expiresAt: new Date(now + 60000).toISOString(),
      priceCardSha256: "e".repeat(64),
      ...caps(),
      monthlyBudgetMonth: "2026-11",
      monthlyUsageEvidenceSha256: `sha256:${"f".repeat(64)}`,
    };
    expect(validateSmokeApproval(approved, identity, "e".repeat(64), now)).toMatchObject({ maxUsd: 5 });
    for (const patch of [
      { monthlyBudgetMonth: "2026-10" },
      { remainingMonthlyUsd: 4 },
      { monthlyUsageEvidenceSha256: "" },
    ])
      expect(() => validateSmokeApproval({ ...approved, ...patch }, identity, "e".repeat(64), now)).toThrow();
  });
  it("binds counted instructions, source input and schema to actual generation wire fields", async () => {
    const f = setup();
    await countAll(f);
    f.transport.startGeneration();
    await expect(
      f.transport.fetch(
        "https://api.openai.com/v1/responses",
        init({ ...generated(f.requests[0]), instructions: "changed" }),
      ),
    ).rejects.toThrow();
    expect(f.dispatch).toHaveBeenCalledTimes(24);
  });
  it("rejects absent verified count fees, monthly overspend and infeasible output bounds before dispatch", () => {
    const base = { plan: plan(), card: card(), caps: caps(), persist: vi.fn(), dispatch: vi.fn() };
    expect(() =>
      createSmokeTransport({ ...base, card: { ...base.card, counting: undefined } as unknown as SmokePriceCard }),
    ).toThrow();
    expect(() => createSmokeTransport({ ...base, caps: { ...caps(), remainingMonthlyUsd: 4 } })).toThrow();
    expect(() => createSmokeTransport({ ...base, caps: { ...caps(), maxOutputTokens: 300000 } })).toThrow();
    expect(base.dispatch).not.toHaveBeenCalled();
    expect(smokeLimits.maxOutputTokensAggregate).toBeLessThanOrEqual(400000);
  });
  it("latches ledger failure and runtime expiry closed without dispatch or retry", async () => {
    const f = setup();
    f.persist.mockRejectedValueOnce(new Error("ledger unavailable"));
    await expect(
      f.transport.fetch("https://api.openai.com/v1/responses/input_tokens", init(f.requests[0].tokenBody)),
    ).rejects.toThrow();
    await expect(
      f.transport.fetch("https://api.openai.com/v1/responses/input_tokens", init(f.requests[0].tokenBody)),
    ).rejects.toThrow();
    expect(f.dispatch).not.toHaveBeenCalled();
    let time = 0;
    const expired = setup({ now: () => time });
    time = 840001;
    await expect(
      expired.transport.fetch("https://api.openai.com/v1/responses/input_tokens", init(expired.requests[0].tokenBody)),
    ).rejects.toThrow();
    expect(expired.dispatch).not.toHaveBeenCalled();
  });

  it("matches the real SDK count endpoint and production generation serialization without provider access", async () => {
    vi.resetModules();
    vi.stubEnv("OPENAI_API_KEY", "synthetic-mocked-test-key");
    vi.stubEnv("OPENAI_BASE_URL", "https://api.openai.com/v1");
    const cases = parseComparisonFixtures(
      await readFile(new URL("../scripts/fixtures/rag-model-comparison.json", import.meta.url), "utf8"),
    );
    const requests = await buildSmokePlan(cases);
    const dispatch = vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.endsWith("input_tokens")
              ? { object: "response.input_tokens", input_tokens: 5000 }
              : { status: "completed", model: requests[0]!.model, output_text: '{"answer":"synthetic"}' },
          ),
          { headers: { "content-type": "application/json", "x-request-id": "synthetic-mock-response" } },
        ),
    );
    const transport = createSmokeTransport({
      plan: requests,
      card: card(),
      caps: caps(),
      dispatch,
      persist: async () => {},
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(transport.fetch as typeof fetch);
    const { createOpenAIClient, generateStructuredTextResult } = await import("../src/lib/openai");
    for (const p of requests) await createOpenAIClient().responses.inputTokens.count(p.tokenBody, { maxRetries: 0 });
    transport.startGeneration();
    const p = requests[0]!;
    const text = p.tokenBody.text as { format: { schema: Record<string, unknown> } };
    const result = await generateStructuredTextResult(p.tokenBody.input as string, text.format.schema, {
      model: p.model,
      operation: "answer",
      instructions: p.tokenBody.instructions as string,
      schemaName: "clinical_rag_answer",
      maxOutputTokens: 16000,
      reasoningEffort: p.route === "fast" ? "low" : "medium",
      maxRetries: 0,
      store: false,
      serviceTier: "default",
      promptCacheKey: "synthetic-answer-model-smoke-v1",
    });
    expect(result).toMatchObject({ model: p.model, providerModel: p.model, requestId: "synthetic-mock-response" });
    expect(transport.snapshot()).toMatchObject({ countRequests: 24, generationRequests: 1 });
    expect(dispatch).toHaveBeenCalledTimes(25);
  });
});
