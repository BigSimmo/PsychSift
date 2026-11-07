import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("openai", () => ({
  default: class MockOpenAI {
    responses = { create: sdk.create };
  },
}));
vi.mock("@/lib/env", () => ({
  env: {
    OPENAI_API_KEY: "synthetic-unused-key",
    OPENAI_ANSWER_MODEL: "synthetic-model",
    OPENAI_MAX_OUTPUT_TOKENS: 16000,
    OPENAI_REQUEST_TIMEOUT_MS: 20000,
    OPENAI_MAX_RETRIES: 0,
  },
  requireOpenAIEnv: vi.fn(),
}));
vi.mock("@/lib/answer-pilot-budget", () => ({
  currentAnswerPilotBudget: () => null,
  isAnswerPilotBudgetActive: () => false,
}));
vi.mock("@/lib/observability/agent-monitoring", () => ({
  instrumentOpenAIClientForAgentMonitoring: <T>(client: T) => client,
}));
vi.mock("@/lib/logger", () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { createClinicalAskWebSearchResponse } from "@/lib/openai";

beforeEach(() => {
  sdk.create.mockReset();
  sdk.create.mockResolvedValue({ status: "completed", output: [] });
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Unexpected network in offline budget check");
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("Clinical Ask external-search request budget", () => {
  it("uses the configured output ceiling and one provider-managed tool call", async () => {
    await createClinicalAskWebSearchResponse({
      input: [],
      allowedDomains: ["health.wa.gov.au"],
      signal: new AbortController().signal,
      timeoutMs: 20000,
    });
    expect(sdk.create.mock.calls[0]?.[0]).toMatchObject({ max_output_tokens: 16000, max_tool_calls: 1 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("preserves the authority allow-list, cancellation, timeout, no-store and zero retries", async () => {
    const signal = new AbortController().signal;
    await createClinicalAskWebSearchResponse({
      input: [],
      allowedDomains: ["health.wa.gov.au"],
      signal,
      timeoutMs: 20000,
    });
    expect(sdk.create).toHaveBeenCalledWith(
      expect.objectContaining({
        store: false,
        tools: [expect.objectContaining({ filters: { allowed_domains: ["health.wa.gov.au"] } })],
      }),
      { signal, timeout: 20000, maxRetries: 0 },
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
