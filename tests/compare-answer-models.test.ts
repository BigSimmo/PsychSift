import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  comparisonConfig,
  createComparisonTransport,
  deterministicChecks,
  frozenSources,
  latencyDistribution,
  offlineComparisonExecutor,
  parseComparisonFixtures,
  planExecutions,
  runComparison,
  validateApproval,
  validatePriceCard,
  worstCasePlan,
  comparisonOutputPath,
  comparisonRoot,
  consumeComparisonApproval,
  type Approval,
  type PriceCard,
} from "../scripts/compare-answer-models";
import type { RagAnswer } from "../src/lib/types";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
});
const identity = {
  sourceSha256: "a".repeat(64),
  fixturesSha256: "b".repeat(64),
  configurationSha256: "c".repeat(64),
  environmentSha256: "d".repeat(64),
};
const approval = (overrides: Partial<Approval> = {}): Approval => ({
  version: 1,
  approvalReference: "synthetic-offline-test-only",
  outputDirectory: resolve("output/answer-model-comparison/approved-single-run"),
  approvedAt: "2026-01-01T00:00:00Z",
  expiresAt: "2099-01-01T00:00:00Z",
  ...identity,
  priceCardSha256: "e".repeat(64),
  maxUsd: 15,
  maxRequests: 150,
  maxInputTokens: 1_000_000,
  maxOutputTokens: 400_000,
  ...overrides,
});
// Artificial test prices/limits exercise arithmetic only; never used as provider evidence.
const card = (): PriceCard => ({
  verifiedAt: "2026-10-27",
  sources: ["https://developers.openai.com/api/docs/pricing"],
  serviceTier: "default",
  region: "global",
  models: Object.fromEntries(
    ["gpt-5.6-terra", "gpt-5.6-sol", "gpt-6.1-sol"].map((model) => [
      model,
      { input: 1, cacheWrite: 1.25, output: 2, maxContextTokens: 100, maxOutputTokens: 128_000 },
    ]),
  ),
});
const fixture = async () =>
  parseComparisonFixtures(
    await readFile(new URL("../scripts/fixtures/rag-model-comparison.json", import.meta.url), "utf8"),
  );
const request = (overrides = {}) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    model: "gpt-6.1-sol",
    input: "Synthetic equipment question",
    instructions: "Synthetic instructions",
    max_output_tokens: comparisonConfig.maxOutputTokens,
    store: false,
    service_tier: "default",
    reasoning: { effort: "low" },
    text: { format: { type: "json_schema", name: "clinical_rag_answer", schema: {} } },
    ...overrides,
  }),
});
const transport = async (
  options: {
    persist?: (r: Readonly<Record<string, unknown>>) => Promise<void>;
    dispatch?: (url: string, init: RequestInit) => Promise<Response>;
    approval?: Approval;
    card?: PriceCard;
  } = {},
) =>
  createComparisonTransport({
    approval: options.approval ?? approval(),
    card: options.card ?? card(),
    priceCardSha256: "e".repeat(64),
    persist: options.persist ?? (async () => {}),
    dispatch: options.dispatch ?? (async () => new Response("synthetic")),
  });

describe("offline-first answer model comparison", () => {
  it("consumes an approval once and rejects reuse with the same or another output", async () => {
    const root = await mkdtemp(join(tmpdir(), "sol61-approval-"));
    const approved = approval({ outputDirectory: join(root, "output/answer-model-comparison/approved-single-run") });
    const out = comparisonOutputPath(approved.outputDirectory, root);
    try {
      await consumeComparisonApproval(approved, out, root);
      expect(JSON.parse(await readFile(join(out, "approval-consumed.json"), "utf8"))).toMatchObject({
        approvalReference: approved.approvalReference,
      });
      await expect(consumeComparisonApproval(approved, out, root)).rejects.toThrow();
      await expect(
        consumeComparisonApproval(
          approved,
          comparisonOutputPath("output/answer-model-comparison/another-run", root),
          root,
        ),
      ).rejects.toThrow("different output");
      await expect(comparisonRoot(root)).rejects.toThrow("checkout");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("warms both model/effort routes symmetrically before 48 measured executions", async () => {
    const cases = await fixture(),
      plan = planExecutions(cases);
    expect(cases).toHaveLength(12);
    expect(new Set(cases.map((c) => c.category)).size).toBe(6);
    expect(plan).toHaveLength(52);
    expect(plan.filter((e) => e.warmup)).toHaveLength(4);
    for (const arm of ["control", "candidate"]) {
      expect(
        plan
          .filter((e) => e.arm === arm && e.warmup)
          .map((e) => e.route)
          .sort(),
      ).toEqual(["fast", "strong"]);
    }
    expect(plan.slice(0, 4).every((e) => e.warmup)).toBe(true);
    expect(plan.filter((e) => e.arm === "control" && !e.warmup)).toHaveLength(24);
    expect(plan.filter((e) => e.arm === "candidate" && !e.warmup)).toHaveLength(24);
    expect(plan.find((e) => e.arm === "control" && e.route === "strong")?.model).toBe("gpt-5.6-sol");
    expect(plan.find((e) => e.arm === "control" && e.route === "fast")?.model).toBe("gpt-5.6-terra");
    expect(Object.isFrozen(comparisonConfig.arms.control)).toBe(true);
  });

  it("rejects duplicated, non-synthetic, undersized and overlong fixtures", async () => {
    const cases = await fixture();
    const serialize = (overrides: Record<string, unknown>) =>
      JSON.stringify({ version: 1, synthetic: true, cases, ...overrides });
    expect(() => parseComparisonFixtures(serialize({ synthetic: false }))).toThrow();
    expect(() => parseComparisonFixtures(serialize({ cases: cases.slice(1) }))).toThrow();
    expect(() =>
      parseComparisonFixtures(serialize({ cases: cases.map((c, i) => (i === 1 ? cases[0] : c)) })),
    ).toThrow();
    expect(() =>
      parseComparisonFixtures(
        serialize({ cases: cases.map((c, i) => (i === 0 ? { ...c, sources: ["x".repeat(4_001)] } : c)) }),
      ),
    ).toThrow();
  });

  it("requires approval tied to source, fixtures, configuration, environment and price card", () => {
    expect(validateApproval(approval(), identity, "e".repeat(64))).toMatchObject({ maxUsd: 15 });
    for (const key of Object.keys(identity))
      expect(() => validateApproval({ ...approval(), [key]: "changed" }, identity, "e".repeat(64))).toThrow();
    expect(() => validateApproval(approval(), identity, "f".repeat(64))).toThrow();
    expect(() => validateApproval(approval({ maxUsd: 15.01 }), identity, "e".repeat(64))).toThrow();
    expect(() => validateApproval(approval({ maxRequests: 151 }), identity, "e".repeat(64))).toThrow();
    expect(() => validateApproval(approval({ maxInputTokens: 1_000_001 }), identity, "e".repeat(64))).toThrow();
    expect(() => validateApproval(approval({ maxOutputTokens: 400_001 }), identity, "e".repeat(64))).toThrow();
    expect(() => validateApproval(approval({ expiresAt: "2020-01-01" }), identity, "e".repeat(64))).toThrow();
    expect(() =>
      validateApproval(
        approval({ outputDirectory: "output/answer-model-comparison/replay" }),
        identity,
        "e".repeat(64),
      ),
    ).toThrow();
  });

  it("fails closed on missing published model limits or cache-write pricing", () => {
    const prices = card();
    delete (prices.models["gpt-6.1-sol"] as Partial<PriceCard["models"][string]>).cacheWrite;
    expect(() => validatePriceCard(prices)).toThrow();
    expect(() => validatePriceCard({ ...card(), region: "regional" })).toThrow();
    expect(() => validatePriceCard({ ...card(), sources: [] })).toThrow();
  });

  it("reports that conservative full-plan output reservations exceed the approved cap", async () => {
    const bound = worstCasePlan(planExecutions(await fixture()), card());
    expect(bound.outputTokens).toBe(832_000);
    expect(bound.fitsConfiguredCaps).toBe(false);
  });

  it("persists immutable reservations before mock dispatch and snapshots caller price data", async () => {
    const events: string[] = [],
      prices = card();
    const persist = vi.fn(async (r: Readonly<Record<string, unknown>>) => {
      expect(Object.isFrozen(r)).toBe(true);
      events.push("persist");
    });
    const dispatch = vi.fn(async () => {
      events.push("dispatch");
      return new Response("synthetic");
    });
    const t = await transport({ persist, dispatch, card: prices });
    prices.models["gpt-6.1-sol"].maxContextTokens = 1;
    await t.fetch("https://api.openai.com/v1/responses", request());
    expect(events).toEqual(["persist", "dispatch"]);
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({ inputTokenAllowance: 100, outputTokenAllowance: 16_000, aggregateInputAllowance: 100 }),
    );
    expect(t.snapshot()).toMatchObject({ actualRequests: 1, dispatchAttempts: { responses: 1, embeddings: 0 } });
  });

  it.each([
    ["https://api.openai.com/v1/embeddings", request()],
    ["https://api.openai.com/v1/models", request()],
    ["https://example.test/v1/responses", request()],
    ["https://api.openai.com/v1/responses", request({ model: "unapproved-model" })],
    ["https://api.openai.com/v1/responses", request({ service_tier: "flex" })],
    ["https://api.openai.com/v1/responses", request({ tools: [{ type: "web_search" }] })],
    ["https://api.openai.com/v1/responses", request({ max_output_tokens: 16_001 })],
    ["https://api.openai.com/v1/responses", request({ reasoning: { effort: "high" } })],
  ])("blocks unapproved network target or body before transport: %s", async (url, init) => {
    const dispatch = vi.fn(async () => new Response("never")),
      t = await transport({ dispatch });
    await expect(t.fetch(url, init)).rejects.toThrow();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("stops before dispatch if durable persistence fails and refuses retries", async () => {
    const dispatch = vi.fn(async () => new Response("never")),
      persist = vi.fn(async () => {
        throw new Error("disk full");
      });
    const t = await transport({ dispatch, persist });
    await expect(t.fetch("https://api.openai.com/v1/responses", request())).rejects.toThrow();
    await expect(t.fetch("https://api.openai.com/v1/responses", request())).rejects.toThrow();
    expect(dispatch).not.toHaveBeenCalled();
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it.each([{ maxRequests: 1 }, { maxInputTokens: 100 }, { maxOutputTokens: 16_000 }, { maxUsd: 0.04 }])(
    "enforces cumulative request/token/spend bounds: %o",
    async (limits) => {
      const dispatch = vi.fn(async () => new Response("synthetic"));
      const t = await transport({ dispatch, approval: approval(limits) });
      await t.fetch("https://api.openai.com/v1/responses", request());
      await expect(t.fetch("https://api.openai.com/v1/responses", request())).rejects.toThrow();
      expect(dispatch).toHaveBeenCalledTimes(1);
    },
  );

  it("stops the schedule after a failure without retrying or substituting models", async () => {
    const cases = await fixture(),
      execute = vi.fn(async () => {
        throw new Error("synthetic denial");
      });
    const run = await runComparison(cases, execute);
    expect(run.complete).toBe(false);
    expect(run.outcomes).toHaveLength(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("also stops on a returned incomplete provider response without further calls", async () => {
    const execute = vi.fn(async () => ({
      status: "failed" as const,
      latencyMs: 1,
      reason: "provider_incomplete",
      usage: { input_tokens: 10, output_tokens: 16_000 },
    }));
    const run = await runComparison(await fixture(), execute);
    expect(run.complete).toBe(false);
    expect(run.expectedExecutions).toBe(52);
    expect(run.outcomes).toHaveLength(1);
    expect(run.outcomes[0]?.usage).toEqual({ input_tokens: 10, output_tokens: 16_000 });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("uses production generation wrapper, source fencing, schema and parser offline without network", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network forbidden"));
    const cases = await fixture(),
      execute = await offlineComparisonExecutor();
    const run = await runComparison(cases, execute);
    expect(run.outcomes).toHaveLength(52);
    expect(run.complete).toBe(true);
    expect(run.outcomes.every((o) => o.checks?.validJson)).toBe(true);
    expect(
      run.outcomes.filter((o) => o.caseId === "unsupported-no-rule").every((o) => o.checks?.unsupportedCorrect),
    ).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("counts invalid raw citations even when the production parser removes them", async () => {
    const c = (await fixture())[0],
      sources = frozenSources(c);
    const answer = {
      answer: "Use the amber form.",
      sources,
      citations: [],
      grounded: false,
      confidence: "unsupported",
      answerSections: [],
    } as unknown as RagAnswer;
    expect(deterministicChecks(c, JSON.stringify({ citations: [{ chunk_id: "invented" }] }), answer)).toMatchObject({
      passed: false,
      invalidProposedCitations: 1,
    });
  });

  it.each([
    {},
    { answer: 42 },
    {
      answer: "I cannot answer.",
      grounded: true,
      confidence: "high",
      answerSections: [],
      citations: [],
      quoteCards: [],
      conflictsOrGaps: [],
    },
  ])("does not count malformed output or a recovered fallback as a correct refusal: %j", async (payload) => {
    const c = (await fixture()).find((item) => item.unsupported)!;
    const { parseAnswerJson } = await import("../src/lib/rag/rag");
    const raw = JSON.stringify(payload);
    const parsed = parseAnswerJson(raw, frozenSources(c), c.question);
    expect(deterministicChecks(c, raw, parsed).passed).toBe(false);
  });

  it("admits real SDK serialization through the guarded mock transport without network", async () => {
    vi.resetModules();
    vi.stubEnv("OPENAI_API_KEY", "synthetic-test-only");
    vi.stubEnv("OPENAI_BASE_URL", "https://api.openai.com/v1");
    const dispatch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: "synthetic-response",
            status: "completed",
            output_text: '{"answer":"synthetic"}',
            usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 },
          }),
          { headers: { "content-type": "application/json", "x-request-id": "synthetic-request" } },
        ),
    );
    const guarded = await transport({ dispatch });
    vi.spyOn(globalThis, "fetch").mockImplementation(guarded.fetch as typeof fetch);
    const { generateStructuredTextResult } = await import("../src/lib/openai");
    const result = await generateStructuredTextResult(
      "Synthetic question",
      {
        type: "object",
        properties: { answer: { type: "string" } },
        required: ["answer"],
        additionalProperties: false,
      },
      {
        model: "gpt-6.1-sol",
        operation: "answer",
        instructions: "Synthetic source instructions",
        schemaName: "clinical_rag_answer",
        maxOutputTokens: 16_000,
        reasoningEffort: "low",
        serviceTier: "default",
        store: false,
        maxRetries: 0,
      },
    );
    expect(result.text).toBe('{"answer":"synthetic"}');
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(guarded.snapshot()).toMatchObject({ actualRequests: 1, dispatchAttempts: { responses: 1, embeddings: 0 } });
  });

  it("keeps raw outputs inside the ignored comparison directory and describes empty latencies", () => {
    expect(() => comparisonOutputPath("tracked-output.json", process.cwd())).toThrow();
    expect(() => comparisonOutputPath("output/answer-model-comparison/../escape", process.cwd())).toThrow();
    expect(latencyDistribution([])).toEqual({
      count: 0,
      p50Ms: null,
      p90Ms: null,
      p95Ms: null,
      minMs: null,
      maxMs: null,
    });
    expect(latencyDistribution([50, 1, 4, 9])).toMatchObject({ p50Ms: 4, p95Ms: 50 });
  });
});
