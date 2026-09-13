import type {
  RagEvaluationConfiguration,
  RagEvaluationProviderDependencies,
  RagEvaluationProviderPolicy,
  RagEvaluationSdkRequestPolicy,
} from "../../src/lib/rag/rag-contracts";
import {
  embedTextWithEvaluationClient,
  generateParsedTextResultWithEvaluationClient,
  generateStructuredTextResultWithEvaluationClient,
  type OpenAIEvaluationClient,
  type OpenAIEvaluationSdkPolicy,
  type OpenAIEvaluationTextOptions,
} from "../../src/lib/openai";

export type ShadowEvaluationProviderAdapterInputV1 = Readonly<{
  client: OpenAIEvaluationClient;
  configuration: RagEvaluationConfiguration;
  providerPolicy: RagEvaluationProviderPolicy;
  now: () => number;
}>;

function invalidProviderCall(message: string): never {
  throw new Error(`Invalid U04 evaluation provider call: ${message}.`);
}

function sameSdkPolicy(
  actual: RagEvaluationSdkRequestPolicy,
  expected: RagEvaluationProviderPolicy,
) {
  return actual.promptCacheRetention === expected.promptCacheRetention &&
    actual.promptCacheTtl === expected.promptCacheTtl &&
    actual.storeResponses === expected.storeResponses;
}

function sdkPolicy(providerPolicy: RagEvaluationProviderPolicy): OpenAIEvaluationSdkPolicy {
  return Object.freeze({
    promptCacheRetention: providerPolicy.promptCacheRetention,
    promptCacheTtl: providerPolicy.promptCacheTtl,
    storeResponses: providerPolicy.storeResponses,
  });
}

function frozenSnapshot<T>(value: T): T {
  const freeze = (entry: unknown): unknown => {
    if (entry === null || typeof entry !== "object" || Object.isFrozen(entry)) return entry;
    for (const key of Reflect.ownKeys(entry)) {
      const descriptor = Object.getOwnPropertyDescriptor(entry, key);
      if (descriptor && "value" in descriptor) freeze(descriptor.value);
    }
    return Object.freeze(entry);
  };
  return freeze(structuredClone(value)) as T;
}

function captureClient(client: OpenAIEvaluationClient): OpenAIEvaluationClient {
  const createResponse = client.responses.create.bind(client.responses) as typeof client.responses.create;
  const parseResponse = client.responses.parse.bind(client.responses) as typeof client.responses.parse;
  const createEmbedding = client.embeddings.create.bind(client.embeddings) as typeof client.embeddings.create;
  return Object.freeze({
    responses: Object.freeze({ create: createResponse, parse: parseResponse }),
    embeddings: Object.freeze({ create: createEmbedding }),
  });
}

function generationOptions(
  options: OpenAIEvaluationTextOptions & RagEvaluationSdkRequestPolicy,
): OpenAIEvaluationTextOptions {
  if (!options.model || !Number.isInteger(options.maxOutputTokens) || options.maxOutputTokens < 1 ||
    !options.operation || !options.promptCacheKey || !options.schemaName || !options.instructions ||
    !options.reasoningEffort || !options.textVerbosity || !Number.isInteger(options.timeoutMs) ||
    options.timeoutMs < 1 || !Number.isInteger(options.maxRetries) || options.maxRetries < 0) {
    return invalidProviderCall("generation options are incomplete");
  }
  return Object.freeze({
    model: options.model,
    maxOutputTokens: options.maxOutputTokens,
    operation: options.operation,
    promptCacheKey: options.promptCacheKey,
    schemaName: options.schemaName,
    instructions: options.instructions,
    reasoningEffort: options.reasoningEffort,
    textVerbosity: options.textVerbosity,
    timeoutMs: options.timeoutMs,
    maxRetries: options.maxRetries,
    signal: options.signal,
    safetyIdentifier: options.safetyIdentifier,
  });
}

/** Closed configured provider surface for one fully admitted U04 evaluation session. */
export function createShadowEvaluationProviderDependenciesV1(
  input: ShadowEvaluationProviderAdapterInputV1,
): RagEvaluationProviderDependencies {
  const configuration = frozenSnapshot(input.configuration);
  const providerPolicy = frozenSnapshot(input.providerPolicy);
  const client = captureClient(input.client);
  const now = input.now.bind(undefined);
  if (configuration.generation.providerMode !== "openai")
    invalidProviderCall("configured adapter requires openai provider mode");
  const policy = sdkPolicy(providerPolicy);
  const answerModels = new Set([
    configuration.generation.answerModel,
    configuration.generation.fastModel,
    configuration.generation.strongModel,
  ]);
  const answerTokenBudgets = new Set([
    configuration.generation.maxOutputTokens,
    Math.max(configuration.generation.maxOutputTokens * 2, 24_000),
  ]);

  return Object.freeze({
    embedQuery: async (request) => {
      if (request.model !== configuration.generation.embeddingModel ||
        request.dimensions !== configuration.generation.embeddingDimensions ||
        request.timeoutMs !== providerPolicy.requestTimeoutMs ||
        request.maxRetries !== providerPolicy.embeddingMaxRetries) {
        return invalidProviderCall("embedding request does not match captured configuration");
      }
      return embedTextWithEvaluationClient(client, request, now);
    },
    generateClassifier: async (providerInput, schema, options) => {
      if (options.model !== configuration.generation.classifierModel ||
        options.maxOutputTokens !== 220 ||
        options.operation !== "text_generation" ||
        options.schemaName !== "clinical_rag_query_classifier" ||
        options.reasoningEffort !== "low" ||
        options.textVerbosity !== "low" ||
        options.promptCacheKey !== configuration.generation.classifierPromptVersion ||
        options.timeoutMs !== Math.min(6_000, providerPolicy.requestTimeoutMs) ||
        options.maxRetries !== providerPolicy.generationMaxRetries ||
        !sameSdkPolicy(options, providerPolicy)) {
        return invalidProviderCall("classifier request does not match captured configuration");
      }
      return generateParsedTextResultWithEvaluationClient(
        client,
        [...providerInput],
        schema,
        generationOptions(options),
        policy,
        now,
      );
    },
    generateRerank: async (providerInput, schema, options, requestPolicy) => {
      if (!configuration.generation.semanticRerankEnabled ||
        options.model !== configuration.generation.semanticRerankModel ||
        options.maxOutputTokens !== 400 ||
        options.operation !== "rerank" ||
        options.schemaName !== "rag_semantic_ranking" ||
        options.promptCacheKey !== "rag-semantic-rerank-v1" ||
        options.reasoningEffort !== "none" ||
        options.textVerbosity !== "low" ||
        options.timeoutMs !== 3_000 ||
        options.timeoutMs > providerPolicy.requestTimeoutMs ||
        options.maxRetries !== 0 ||
        !sameSdkPolicy(requestPolicy, providerPolicy)) {
        return invalidProviderCall("rerank request does not match captured configuration");
      }
      return generateParsedTextResultWithEvaluationClient(
        client,
        providerInput,
        schema,
        generationOptions({ ...options, ...requestPolicy }),
        policy,
        now,
      );
    },
    generateAnswer: async (providerInput, schema, options) => {
      if (!answerModels.has(options.model) ||
        options.operation !== "answer" ||
        options.schemaName !== "clinical_rag_answer" ||
        options.promptCacheKey !== configuration.generation.promptVersion ||
        !answerTokenBudgets.has(options.maxOutputTokens) ||
        options.timeoutMs > providerPolicy.answerTimeoutMs ||
        options.maxRetries !== 0 ||
        !sameSdkPolicy(options, providerPolicy)) {
        return invalidProviderCall("answer request does not match captured configuration");
      }
      return generateStructuredTextResultWithEvaluationClient(
        client,
        providerInput,
        { ...schema },
        generationOptions(options),
        policy,
        now,
      );
    },
  });
}
