import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { PublicApiError } from "@/lib/http";
import type { OpenAIEvaluationClient } from "@/lib/openai";
import type {
  RagEvaluationConfiguration,
  RagEvaluationProviderPolicy,
} from "@/lib/rag/rag-contracts";
import { rankingConfig } from "@/lib/ranking-config";
import { createShadowEvaluationProviderDependenciesV1 } from "../scripts/lib/reindex-eval-providers";

function apiResult<T>(data: T, requestId: string) {
  return {
    withResponse: async () => ({ data, request_id: requestId }),
  };
}

function fixture() {
  const responseCreate = vi.fn();
  const responseParse = vi.fn();
  const embeddingCreate = vi.fn();
  const rawClient = {
    responses: { create: responseCreate, parse: responseParse },
    embeddings: { create: embeddingCreate },
  };
  const client = rawClient as unknown as OpenAIEvaluationClient;
  const configuration = {
    generation: {
      answerModel: "gpt-5.6-answer",
      fastModel: "gpt-5.6-fast",
      strongModel: "gpt-5.6-strong",
      classifierModel: "gpt-5.6-classifier",
      indexingModel: "gpt-5.6-index",
      embeddingModel: "text-embedding-u04",
      embeddingDimensions: 2,
      fastReasoningEffort: "low",
      strongReasoningEffort: "high",
      answerVerbosity: "medium",
      maxOutputTokens: 1_200,
      providerMode: "openai",
      promptVersion: "clinical-rag-answer-u04",
      schemaVersion: "clinical-rag-answer-schema-u04",
      classifierPromptVersion: "clinical-rag-classifier-u04",
      retrievalVersion: "clinical-rag-retrieval-u04",
      indexingPromptVersion: "clinical-rag-indexing-u04",
      semanticRerankEnabled: true,
      semanticRerankModel: "gpt-5.6-rerank",
    },
    retrieval: { textWeakOrRelaxation: true },
    ranking: { ...rankingConfig },
  } satisfies RagEvaluationConfiguration;
  const providerPolicy = {
    requestTimeoutMs: 15_000,
    answerTimeoutMs: 20_000,
    embeddingMaxRetries: 2,
    generationMaxRetries: 1,
    promptCacheRetention: "24h",
    promptCacheTtl: "30m",
    storeResponses: false,
    routeBudgetMs: { unsupported: 500, extractive: 1_000, fast: 8_000, strong: 18_000 },
    generationRecoveryReserveMs: 1_000,
    minimumGenerationRetryMs: 750,
  } satisfies RagEvaluationProviderPolicy;
  let clock = 100;
  const now = vi.fn(() => {
    const value = clock;
    clock += 25;
    return value;
  });
  const adapterInput = {
    client,
    configuration,
    providerPolicy,
    now,
  };
  const providers = createShadowEvaluationProviderDependenciesV1(adapterInput);
  return {
    adapterInput,
    client,
    configuration,
    providerPolicy,
    providers,
    rawClient,
    responseCreate,
    responseParse,
    embeddingCreate,
    now,
  };
}

describe("U04 connected evaluation provider adapter", () => {
  it.each(["off", "in_memory"] as const)("preserves ordinary nullable TTL resolution with legacy retention %s", async retention => {
    const f = fixture();
    const policy = { ...f.providerPolicy, promptCacheRetention: retention, promptCacheTtl: null };
    const providers = createShadowEvaluationProviderDependenciesV1({ ...f.adapterInput, providerPolicy: policy });
    f.responseParse.mockReturnValue(apiResult({ status: "completed", output_text: "{}", output_parsed: {} }, "ttl-case"));
    await providers.generateClassifier([{ role: "user", content: "input" }], z.object({}), {
      model: "gpt-5.6-classifier", maxOutputTokens: 220, operation: "text_generation", instructions: "instructions",
      reasoningEffort: "low", textVerbosity: "low", schemaName: "clinical_rag_query_classifier",
      promptCacheKey: "clinical-rag-classifier-u04", timeoutMs: 6_000, maxRetries: 1,
      promptCacheRetention: retention, promptCacheTtl: null, storeResponses: false,
    });
    const body = f.responseParse.mock.calls[0]![0];
    if (retention === "off") expect(body).not.toHaveProperty("prompt_cache_options");
    else expect(body).toHaveProperty("prompt_cache_options.ttl", "30m");
  });

  it("uses the captured embedding model, dimensions, retries and timeout without shared cache reuse", async () => {
    const f = fixture();
    const firstNative = { data: [{ index: 0, embedding: [0.25, 0.75] }] };
    const secondNative = { data: [{ index: 0, embedding: [0.5, 0.5] }] };
    f.embeddingCreate
      .mockReturnValueOnce(apiResult(firstNative, "embed-1"))
      .mockReturnValueOnce(apiResult(secondNative, "embed-2"));
    const replacementEmbeddingCreate = vi.fn();
    f.configuration.generation.embeddingModel = "mutated-after-admission";
    f.providerPolicy.requestTimeoutMs = 1;
    f.rawClient.embeddings.create = replacementEmbeddingCreate;
    f.adapterInput.now = vi.fn(() => 9_999);
    const request = {
      query: "  Literal query survives  ",
      model: "text-embedding-u04",
      dimensions: 2,
      timeoutMs: 15_000,
      maxRetries: 2,
    };

    const first = await f.providers.embedQuery(request);
    const second = await f.providers.embedQuery(request);

    expect(f.embeddingCreate).toHaveBeenCalledTimes(2);
    expect(replacementEmbeddingCreate).not.toHaveBeenCalled();
    expect(f.embeddingCreate).toHaveBeenNthCalledWith(
      1,
      {
        model: "text-embedding-u04",
        input: ["  Literal query survives  "],
        dimensions: 2,
      },
      { timeout: 15_000, maxRetries: 2 },
    );
    expect(first).toMatchObject({ embedding: [0.25, 0.75], cacheHit: false });
    expect(second).toMatchObject({ embedding: [0.5, 0.5], cacheHit: false });
    expect(first).toHaveProperty("nativeResponse", firstNative);
  });

  it("preserves the classifier schema, instructions, model and captured SDK policy", async () => {
    const f = fixture();
    const native = {
      status: "completed",
      output_text: "{\"class\":\"clinical\"}",
      output_parsed: { class: "clinical" },
      usage: { input_tokens: 12, output_tokens: 4, input_tokens_details: { cached_tokens: 3 } },
    };
    f.responseParse.mockReturnValue(apiResult(native, "classifier-1"));
    const schema = z.object({ class: z.literal("clinical") });
    const input = [{ role: "user", content: "literal classifier input" }];

    const result = await f.providers.generateClassifier(input, schema, {
      model: "gpt-5.6-classifier",
      maxOutputTokens: 220,
      operation: "text_generation",
      instructions: "literal classifier instructions",
      reasoningEffort: "low",
      textVerbosity: "low",
      schemaName: "clinical_rag_query_classifier",
      promptCacheKey: "clinical-rag-classifier-u04",
      timeoutMs: 6_000,
      maxRetries: 1,
      promptCacheRetention: "24h",
      promptCacheTtl: "30m",
      storeResponses: false,
    });

    const [body, request] = f.responseParse.mock.calls[0] ?? [];
    expect(body).toMatchObject({
      model: "gpt-5.6-classifier",
      input,
      instructions: "literal classifier instructions",
      max_output_tokens: 2_000,
      store: false,
      prompt_cache_key: "clinical-rag-classifier-u04",
      prompt_cache_options: { ttl: "30m" },
      metadata: { operation: "text_generation" },
      reasoning: { effort: "low" },
      text: { verbosity: "low" },
    });
    expect((body as { text?: { format?: unknown } }).text?.format).toEqual(expect.objectContaining({
      type: "json_schema",
      name: "clinical_rag_query_classifier",
      strict: true,
    }));
    expect(request).toEqual({ timeout: 6_000, maxRetries: 1 });
    expect(result).toMatchObject({
      parsed: { class: "clinical" },
      text: "{\"class\":\"clinical\"}",
      usage: { input_tokens: 12, output_tokens: 4, cached_input_tokens: 3 },
      nativeResponse: native,
    });
  });

  it("retains incomplete answer status, usage and the full native response", async () => {
    const f = fixture();
    const native = {
      id: "response-native-1",
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      output_text: "partial answer",
      usage: {
        input_tokens: 100,
        output_tokens: 40,
        input_tokens_details: { cached_tokens: 25 },
        output_tokens_details: { reasoning_tokens: 10 },
      },
      provider_extension: { retained: true },
    };
    f.responseCreate.mockReturnValue(apiResult(native, "answer-1"));

    const result = await f.providers.generateAnswer("literal answer input", { type: "object" }, {
      model: "gpt-5.6-fast",
      maxOutputTokens: 1_200,
      operation: "answer",
      schemaName: "clinical_rag_answer",
      instructions: "literal answer instructions",
      promptCacheKey: "clinical-rag-answer-u04",
      timeoutMs: 12_000,
      maxRetries: 0,
      reasoningEffort: "low",
      textVerbosity: "medium",
      promptCacheRetention: "24h",
      promptCacheTtl: "30m",
      storeResponses: false,
    });

    expect(f.responseCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-5.6-fast",
        input: "literal answer input",
        instructions: "literal answer instructions",
        max_output_tokens: 2_000,
        store: false,
        prompt_cache_key: "clinical-rag-answer-u04",
        prompt_cache_options: { ttl: "30m" },
        text: expect.objectContaining({
          verbosity: "medium",
          format: expect.objectContaining({ name: "clinical_rag_answer", strict: true }),
        }),
      }),
      { timeout: 12_000, maxRetries: 0 },
    );
    expect(result).toMatchObject({
      text: "partial answer",
      status: "incomplete",
      truncated: true,
      incompleteReason: "max_output_tokens",
      requestId: "answer-1",
      latencyMs: 25,
      usage: { input_tokens: 100, output_tokens: 40, cached_input_tokens: 25, reasoning_output_tokens: 10 },
      nativeResponse: native,
    });
  });

  it("retains serializable native provider errors after ordinary error mapping", async () => {
    const f = fixture();
    const nativeError = Object.assign(new Error("rate limited"), {
      status: 429,
      code: "rate_limit_exceeded",
      request_id: "request-error-1",
      provider_extension: { retry_after_ms: 125 },
    });
    f.responseCreate.mockReturnValue({
      withResponse: async () => Promise.reject(nativeError),
    });

    let caught: unknown;
    try {
      await f.providers.generateAnswer("literal answer input", { type: "object" }, {
        model: "gpt-5.6-fast",
        maxOutputTokens: 1_200,
        operation: "answer",
        schemaName: "clinical_rag_answer",
        instructions: "literal answer instructions",
        promptCacheKey: "clinical-rag-answer-u04",
        timeoutMs: 12_000,
        maxRetries: 0,
        reasoningEffort: "low",
        textVerbosity: "medium",
        promptCacheRetention: "24h",
        promptCacheTtl: "30m",
        storeResponses: false,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(PublicApiError);
    expect(caught).toMatchObject({
      status: 429,
      details: { code: "rate_limit_exceeded", requestId: "request-error-1" },
      nativeError: expect.objectContaining({
        name: "Error",
        message: "rate limited",
        status: 429,
        code: "rate_limit_exceeded",
        request_id: "request-error-1",
        provider_extension: { retry_after_ms: 125 },
      }),
    });
  });

  it("rejects non-finite embedding values and retains a loss-marked serializable response", async () => {
    const f = fixture();
    const native = { data: [{ index: 0, embedding: [0.25, Number.NaN] }], provider_extension: "raw" };
    f.embeddingCreate.mockReturnValue(apiResult(native, "embed-invalid-1"));

    let caught: unknown;
    try {
      await f.providers.embedQuery({
        query: "query",
        model: "text-embedding-u04",
        dimensions: 2,
        timeoutMs: 15_000,
        maxRetries: 2,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      details: { code: "openai_embedding_invalid_value" },
      nativeResponse: { data: [{ index: 0, embedding: [0.25, { type: "unrepresentable_number", value: "NaN" }] }], provider_extension: "raw" },
    });
  });

  it("refuses a request that diverges from captured configuration before client dispatch", async () => {
    const f = fixture();

    await expect(f.providers.embedQuery({
      query: "query",
      model: "ambient-or-foreign-model",
      dimensions: 2,
      timeoutMs: 15_000,
      maxRetries: 2,
    })).rejects.toThrow(/does not match captured configuration/i);

    expect(f.embeddingCreate).not.toHaveBeenCalled();
    expect(f.responseCreate).not.toHaveBeenCalled();
    expect(f.responseParse).not.toHaveBeenCalled();

    const incompatiblePolicy = { ...f.providerPolicy, promptCacheRetention: "off" as const };
    const incompatibleConfiguration = {
      ...f.configuration,
      generation: { ...f.configuration.generation, classifierModel: "gpt-5.5-classifier" },
    };
    const incompatible = createShadowEvaluationProviderDependenciesV1({
      client: f.client,
      configuration: incompatibleConfiguration,
      providerPolicy: incompatiblePolicy,
      now: f.now,
    });
    await expect(incompatible.generateClassifier(
      [{ role: "user", content: "input" }],
      z.object({ class: z.string() }),
      {
        model: "gpt-5.5-classifier",
        maxOutputTokens: 220,
        operation: "text_generation",
        instructions: "instructions",
        reasoningEffort: "low",
        textVerbosity: "low",
        schemaName: "clinical_rag_query_classifier",
        promptCacheKey: "clinical-rag-classifier-u04",
        timeoutMs: 6_000,
        maxRetries: 1,
        promptCacheRetention: "off",
        promptCacheTtl: "30m",
        storeResponses: false,
      },
    )).rejects.toMatchObject({ details: { code: "openai_invalid_request" } });
    expect(f.responseParse).not.toHaveBeenCalled();
  });
});
