import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { RagEvaluationContext } from "../src/lib/rag/rag-contracts";
import type { ShadowEvaluationSqlDependenciesV1 } from "../scripts/lib/reindex-eval-runtime";

const DOCUMENT_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "33333333-3333-4333-8333-333333333333";
const REQUEST_DIGEST = `sha256:${"1".repeat(64)}`;
const AUTHORITY_DIGEST = `sha256:${"2".repeat(64)}`;
const RESULT_DIGEST = `sha256:${"3".repeat(64)}`;
const NOW = "2026-09-13T00:00:00.000Z";

type WorkloadArgs = Parameters<typeof import("../scripts/eval-quality").runBoundEvalQualityWorkload>[0];

const mocks = vi.hoisted(() => ({
  prepareError: null as Error | null,
  semanticError: null as Error | null,
  foreignScope: false,
  invokeProvider: false,
  invokeStructuredProvider: false,
  wrongQuery: false,
  phaseErrorAt: null as number | null,
  prepared: [] as Array<Record<string, unknown>>,
  semantic: [] as Array<Record<string, unknown>>,
  engineContexts: [] as RagEvaluationContext[],
  workloadArgs: null as WorkloadArgs | null,
  phaseAdmission: vi.fn(),
  captureNative: vi.fn(),
  readNative: vi.fn(),
  parseProfile: vi.fn(),
  restoreCases: vi.fn(),
  prepareSql: vi.fn(),
  readResult: vi.fn(),
  search: vi.fn(),
  answer: vi.fn(),
  workload: vi.fn(),
}));

vi.mock("../scripts/lib/reindex-eval-session", () => ({
  prepareShadowEvaluationRuntimeAdmissionV1: mocks.phaseAdmission,
  captureShadowProducerInputV1: mocks.captureNative,
  readShadowProducerInputV1: mocks.readNative,
  parseShadowExecutionProfileEnvelope: mocks.parseProfile,
  restoreShadowComparisonCases: mocks.restoreCases,
  prepareShadowEvaluationSqlContextV1: mocks.prepareSql,
  readShadowEvaluationResultV1: mocks.readResult,
}));

vi.mock("../src/lib/rag/rag", () => ({
  searchChunksWithTelemetryForEvaluation: mocks.search,
  answerQuestionWithScopeForEvaluation: mocks.answer,
}));

vi.mock("../scripts/eval-quality", () => ({
  runBoundEvalQualityWorkload: mocks.workload,
}));

import { runShadowEvaluationRuntimeV1 } from "../scripts/lib/reindex-eval-runtime";

function deepFrozenClone<T>(value: T): T {
  const cloned = structuredClone(value);
  const freeze = (current: unknown): void => {
    if (current === null || typeof current !== "object" || Object.isFrozen(current)) return;
    for (const nested of Object.values(current)) freeze(nested);
    Object.freeze(current);
  };
  freeze(cloned);
  return cloned;
}

const retrievalCases = [
  {
    id: "duplicate-case",
    query: "first captured query",
    expectedQueryClass: "document_lookup",
    expectedDocumentSubstrings: [],
    expectedContentTerms: [],
    topK: 8,
    expectTableEvidence: false,
  },
  {
    id: "duplicate-case",
    query: "second captured query",
    expectedQueryClass: "broad_summary",
    expectedDocumentSubstrings: [],
    expectedContentTerms: [],
    topK: 8,
    expectTableEvidence: false,
  },
];
const qualityCases = [{
  id: "quality-case",
  question: "captured quality question",
  category: "routine" as const,
  supported: false,
  expectedFiles: [],
  allowedRoutes: ["unsupported" as const],
  minCitations: 0,
  latencyTargetMs: 1000,
}];

function generation() {
  return {
    answerModel: "answer", fastModel: "fast", strongModel: "strong", classifierModel: "classifier",
    indexingModel: "indexing", embeddingModel: "embedding", embeddingDimensions: 1536,
    fastReasoningEffort: "low" as const, strongReasoningEffort: "high" as const,
    answerVerbosity: "medium" as const, maxOutputTokens: 1200, providerMode: "openai" as const,
    promptVersion: "prompt-v1", schemaVersion: "schema-v1", classifierPromptVersion: "classifier-v1",
    retrievalVersion: "retrieval-v1", indexingPromptVersion: "indexing-v1",
    semanticRerankEnabled: true, semanticRerankModel: "rerank",
  };
}

function ranking() {
  const weights = {
    hybridRelevance: 1, lexicalCoverage: 1, reciprocalRankFusion: 1,
    titleSectionRelevance: 1, metadataRelevance: 1, clinicalEvidence: 1,
  };
  return {
    secondStage: {
      positionBase: 0, positionStep: 0, memorySummaryBoost: 0, documentLookupTitleBoost: 0,
      tableThresholdEvidenceBoost: 0, doseAmountBoost: 0, tableVisualBoost: 0, visualBoost: 0,
      visualIntelligenceMax: 0, visualIntelligencePivot: 0, visualIntelligenceSlope: 0,
      outdatedPenalty: 0, unknownCurrentnessPenalty: 0, poorExtractionPenalty: 0,
      lowIndexQualityPenalty: 0, lowIndexQualityThreshold: 0,
    },
    featureFusion: {
      document_lookup: { ...weights }, table_threshold: { ...weights },
      medication_dose_risk: { ...weights }, comparison: { ...weights },
      broad_summary: { ...weights }, unsupported_or_general: { ...weights },
    },
    documentDiversityPenalty: 0,
    documentDiversityPenaltyCap: 0,
    freshness: {
      mode: "step" as const, publicationCliffYears: 1, publicationPenalty: 0,
      reviewCliffYears: 1, reviewPenalty: 0, linearRampYears: 1,
    },
  };
}

function profile() {
  return {
    payload: {
      sourcePolicyVersion: "source-policy-v1",
      rolloutMode: "shadow" as const,
      rolloutVersion: "synthetic-rollout-v1",
      comparisonClock: NOW,
      providerMode: "openai" as const,
      access: { mode: "owner" as const, ownerId: OWNER_ID, includePublic: false },
      providerPolicy: {
        requestTimeoutMs: 15000, answerTimeoutMs: 20000, embeddingMaxRetries: 1, generationMaxRetries: 0,
        promptCacheRetention: "off" as const, promptCacheTtl: null, storeResponses: false,
        routeBudgetMs: { unsupported: 0, extractive: 12000, fast: 25000, strong: 35000 },
        generationRecoveryReserveMs: 2000, minimumGenerationRetryMs: 20000,
      },
    },
    configuration: { payload: { generation: generation(), retrieval: { textWeakOrRelaxation: true }, ranking: ranking() } },
    cases: {
      payload: {
        globalForceEmbedding: false,
        retrieval: retrievalCases.map((testCase) => ({ testCase })),
        quality: qualityCases,
      },
    },
  };
}

function request() {
  const scopes = [
    ...retrievalCases.map((testCase, index) => ({
      case: { kind: "retrieval" as const, index, caseId: testCase.id },
      documentIds: [DOCUMENT_ID],
    })),
    {
      case: { kind: "quality" as const, index: 0, caseId: qualityCases[0]!.id },
      documentIds: [DOCUMENT_ID],
    },
  ];
  return {
    envelope: { digest: REQUEST_DIGEST },
    payload: {
      sessionId: SESSION_ID,
      phase: { side: "baseline" as const },
      caseScopes: { scopes },
    },
    authority: {
      envelope: { digest: AUTHORITY_DIGEST },
      executionProfileEnvelope: { digest: `sha256:${"4".repeat(64)}` },
      payload: {
        runnerPolicy: {
          evaluatorRetry: { maxAttempts: 2, initialDelayMs: 1, maxDelayMs: 2 },
          costRates: null,
          runContext: { git_sha: null, github_run_id: null, github_run_attempt: null, latency_context: "local" },
          crossRegionRunner: false,
        },
      },
    },
  };
}

const sqlNames = [
  "readAliases", "readCorpusTermStats", "correctClinicalTerms", "readTextChunks", "readHybridChunks",
  "readVectorChunks", "readLookupChunks", "readLookupChunkTerms", "readLookupChunkPrefix",
  "readLookupDocuments", "readLookupDocumentTerms", "readTableFacts", "readEmbeddingFields", "readIndexUnits",
  "readMemoryCardsHybrid", "readMemoryCardsLexical", "readChunksByIds", "readChunksByIndexes",
  "readDocumentSnapshots", "readRankingMetadata", "readRelatedDocuments", "readQuality", "readImagesByIds",
  "readImagesByPages", "readVisualCounts", "readAdjacentChunks",
] as const;

function sqlDependencies() {
  return Object.fromEntries(sqlNames.map((name) => [name, vi.fn(async () => ({ name }))])) as
    unknown as ShadowEvaluationSqlDependenciesV1;
}

function providers() {
  return {
    embedQuery: vi.fn<RagEvaluationContext["providers"]["embedQuery"]>(async () => ({ embedding: [], cacheHit: false })),
    generateClassifier: vi.fn(async () => ({ parsed: {} })),
    generateRerank: vi.fn(async () => ({ parsed: { ranking: [] } })),
    generateAnswer: vi.fn(async () => { throw new Error("answer not configured"); }),
  };
}

function runtimeInput(sql = sqlDependencies(), providerDependencies = providers()) {
  return {
    requestEnvelope: { retained: "request" },
    authorityEnvelope: { retained: "authority" },
    independentlyAdmitted: { admitted: true },
    clock: { trustedNow: () => NOW, now: () => Date.parse(NOW) },
    sql,
    providers: providerDependencies,
  };
}

function workloadResult(complete: boolean, error: unknown = null) {
  return {
    kind: "u04-bound-eval-quality-workload" as const,
    complete,
    failureLatched: !complete,
    error,
    events: [],
    retrieval: { results: [], occurrences: [] },
    rag: { results: [], occurrences: [] },
    report: null,
  };
}


describe("U04 session-owned evaluation runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prepareError = null;
    mocks.semanticError = null;
    mocks.foreignScope = false;
    mocks.invokeProvider = false;
    mocks.invokeStructuredProvider = false;
    mocks.wrongQuery = false;
    mocks.phaseErrorAt = null;
    mocks.prepared.length = 0;
    mocks.semantic.length = 0;
    mocks.engineContexts.length = 0;
    mocks.workloadArgs = null;
    mocks.phaseAdmission.mockImplementation(() => {
      if (mocks.phaseErrorAt === mocks.phaseAdmission.mock.calls.length)
        throw new Error("runtime phase admission refused");
      return request();
    });
    mocks.captureNative.mockImplementation((value: unknown) => deepFrozenClone({
      input: value,
      ownUndefinedPaths: [],
    }));
    mocks.readNative.mockImplementation((value: { input: unknown; ownUndefinedPaths: unknown }) => deepFrozenClone({
      ...value,
      nativeInput: value.input,
    }));
    mocks.parseProfile.mockReturnValue(profile());
    mocks.restoreCases.mockReturnValue({ retrieval: retrievalCases, quality: qualityCases });
    mocks.prepareSql.mockImplementation((
      _requestEnvelope: unknown,
      _authorityEnvelope: unknown,
      _admitted: unknown,
      _trustedNow: unknown,
      operation: string,
      address: Record<string, unknown>,
      readOrdinal: number,
      originalArguments: unknown,
    ) => {
      if (mocks.prepareError) throw mocks.prepareError;
      const context = {
        kind: "u04-evaluation-sql-context-v1",
        call: {
          operation,
          case: address,
          readOrdinal,
          documentIds: [DOCUMENT_ID],
          originalArguments,
        },
      };
      mocks.prepared.push(context);
      return context;
    });
    mocks.readResult.mockImplementation((
      envelope: unknown,
      _requestEnvelope: unknown,
      _authorityEnvelope: unknown,
      _admitted: unknown,
      _startedAt: unknown,
      _finishedAt: unknown,
      call: unknown,
    ) => {
      if (mocks.semanticError) throw mocks.semanticError;
      mocks.semantic.push({ envelope, call });
      return { envelope: { digest: RESULT_DIGEST }, result: [] };
    });
    mocks.search.mockImplementation(async (_input: unknown, evaluation: RagEvaluationContext) => {
      mocks.engineContexts.push(evaluation);
      if (mocks.invokeProvider) await evaluation.providers.embedQuery({
        query: "provider query", model: "embedding", dimensions: 1536,
        timeoutMs: 15000, maxRetries: 1,
      });
      if (mocks.invokeStructuredProvider) await evaluation.providers.generateClassifier(
        [{ role: "user", content: "captured classifier input" }],
        z.object({ verdict: z.string() }),
        {
          model: "classifier",
          maxOutputTokens: 220,
          operation: "text_generation",
          instructions: "captured classifier instructions",
          reasoningEffort: "low",
          textVerbosity: "low",
          schemaName: "clinical_rag_query_classifier",
          promptCacheKey: "classifier-v1",
          timeoutMs: 6000,
          maxRetries: 0,
          promptCacheRetention: "off",
          promptCacheTtl: null,
          storeResponses: false,
        },
      );
      const scope = {
        sessionId: evaluation.sessionId,
        side: evaluation.side,
        documentIds: mocks.foreignScope ? ["99999999-9999-4999-8999-999999999999"] : evaluation.documentIds,
        snapshotDigest: evaluation.snapshotDigest,
        ownerId: evaluation.ownerId,
        includePublic: evaluation.includePublic,
      };
      await evaluation.readers.readTextChunks({
        ...scope,
        query_text: "read query",
        match_count: 10,
        document_filters: [],
      });
      evaluation.failures.assertComplete();
      return { results: [], telemetry: {} };
    });
    mocks.answer.mockImplementation(async (_input: unknown, evaluation: RagEvaluationContext) => {
      mocks.engineContexts.push(evaluation);
      evaluation.failures.assertComplete();
      return { answer: "refused", sources: [], citations: [], grounded: false, confidence: "unsupported" };
    });
    mocks.workload.mockImplementation(async (args: WorkloadArgs) => {
      mocks.workloadArgs = args;
      try {
        for (const [ordinal, testCase] of args.retrievalCases.entries()) {
          await args.search({
            query: mocks.wrongQuery ? "substituted query" : testCase.query,
            ownerId: args.ownerId,
            topK: Math.max(testCase.topK, 10),
            minSimilarity: 0.12,
            skipCache: true,
            forceEmbedding: testCase.forceEmbedding || args.globalForceEmbedding,
          }, { kind: "retrieval", ordinal, id: testCase.id });
        }
        for (const [ordinal, testCase] of args.qualityCases.entries()) {
          await args.answer({
            query: testCase.question,
            ownerId: args.ownerId,
            logQuery: false,
            skipCache: true,
          }, { kind: "quality", ordinal, id: testCase.id });
        }
        return workloadResult(true);
      } catch (error) {
        return workloadResult(false, error);
      }
    });
  });

  it("uses exact case scope, preserves empty filters, and gates every row through prepared and semantic contexts", async () => {
    const sql = sqlDependencies();
    const result = await runShadowEvaluationRuntimeV1(runtimeInput(sql));

    expect(result.complete).toBe(true);
    expect(result.failureLatched).toBe(false);
    expect(mocks.workloadArgs?.retrievalCases).toEqual(retrievalCases);
    expect(mocks.workloadArgs?.qualityCases).toEqual(qualityCases);
    expect(mocks.workloadArgs?.evaluatorRetry).toEqual({ maxAttempts: 2, initialDelayMs: 1, maxDelayMs: 2 });
    expect(mocks.prepared).toHaveLength(2);
    expect(mocks.prepared.map((entry) => entry.call)).toMatchObject([
      {
        operation: "text_chunks",
        case: { kind: "retrieval", index: 0, caseId: "duplicate-case" },
        readOrdinal: 0,
        originalArguments: { query_text: "read query", match_count: 10, document_filters: [] },
      },
      {
        operation: "text_chunks",
        case: { kind: "retrieval", index: 1, caseId: "duplicate-case" },
        readOrdinal: 0,
        originalArguments: { query_text: "read query", match_count: 10, document_filters: [] },
      },
    ]);
    expect(mocks.semantic).toHaveLength(2);
    expect(result.readOccurrences.map((entry) => entry.resultEnvelope)).toEqual([
      { input: { name: "readTextChunks" }, ownUndefinedPaths: [] },
      { input: { name: "readTextChunks" }, ownUndefinedPaths: [] },
    ]);
    expect(result.requestEnvelope).toEqual({ digest: REQUEST_DIGEST });
    expect(result.authorityEnvelope).toEqual({ digest: AUTHORITY_DIGEST });
    expect(result.indexingVersionAtRequestStart).toBe(`u04-evaluation:${REQUEST_DIGEST}`);
    expect(mocks.phaseAdmission).toHaveBeenCalledTimes(2);
  });

  it("retains duplicate case IDs by ordinal while sharing one frozen snapshot and promise", async () => {
    const result = await runShadowEvaluationRuntimeV1(runtimeInput());

    expect(mocks.engineContexts).toHaveLength(3);
    expect(mocks.engineContexts[0]!.ragContextSnapshot).toBe(mocks.engineContexts[1]!.ragContextSnapshot);
    expect(mocks.engineContexts[0]!.indexingVersionAtRequestStart)
      .toBe(mocks.engineContexts[2]!.indexingVersionAtRequestStart);
    expect(mocks.engineContexts[0]!.ragContextSnapshot.documentIndexGeneration)
      .toBe(`u04-evaluation:${REQUEST_DIGEST}`);
    const firstCache = (mocks.search.mock.calls[0]![0] as { cacheContext: unknown }).cacheContext;
    const secondCache = (mocks.search.mock.calls[1]![0] as { cacheContext: unknown }).cacheContext;
    expect(firstCache).not.toBe(secondCache);
    expect(result.complete).toBe(true);
  });

  it("rejects a substituted case query before the engine or SQL can run", async () => {
    mocks.wrongQuery = true;
    const sql = sqlDependencies();
    const result = await runShadowEvaluationRuntimeV1(runtimeInput(sql));

    expect(mocks.search).not.toHaveBeenCalled();
    expect(sql.readTextChunks).not.toHaveBeenCalled();
    expect(result.complete).toBe(false);
    expect(result.failures).toContainEqual({ code: "context_mismatch", operation: "context" });
  });

  it("latches a foreign read scope before any SQL dependency dispatch", async () => {
    mocks.foreignScope = true;
    const sql = sqlDependencies();
    const result = await runShadowEvaluationRuntimeV1(runtimeInput(sql));

    expect(sql.readTextChunks).not.toHaveBeenCalled();
    expect(result.complete).toBe(false);
    expect(result.failureLatched).toBe(true);
    expect(result.failures).toContainEqual({ code: "context_mismatch", operation: "text_chunks" });
    expect(result.readOccurrences).toEqual([]);
  });

  it("rechecks expiry while preparing the call and refuses before dispatch", async () => {
    mocks.prepareError = new Error("authority expired");
    const sql = sqlDependencies();
    const result = await runShadowEvaluationRuntimeV1(runtimeInput(sql));

    expect(sql.readTextChunks).not.toHaveBeenCalled();
    expect(result.complete).toBe(false);
    expect(result.failureLatched).toBe(true);
    expect(result.failures).toContainEqual({ code: "context_mismatch", operation: "text_chunks" });
  });

  it("retains a semantically rejected result envelope and cannot report completion", async () => {
    mocks.semanticError = new Error("semantic source mismatch");
    const result = await runShadowEvaluationRuntimeV1(runtimeInput());

    expect(result.complete).toBe(false);
    expect(result.failureLatched).toBe(true);
    expect(result.readOccurrences).toHaveLength(1);
    expect(result.readOccurrences[0]).toMatchObject({
      operation: "text_chunks",
      status: "failed",
      resultEnvelope: { input: { name: "readTextChunks" }, ownUndefinedPaths: [] },
    });
  });

  it("retains provider failure input and keeps the session NO_GO after the caught error", async () => {
    mocks.invokeProvider = true;
    const providerDependencies = providers();
    providerDependencies.embedQuery.mockRejectedValueOnce(new Error("provider failed"));
    const result = await runShadowEvaluationRuntimeV1(runtimeInput(sqlDependencies(), providerDependencies));

    expect(result.complete).toBe(false);
    expect(result.failureLatched).toBe(true);
    expect(result.providerOccurrences).toHaveLength(1);
    expect(result.providerOccurrences[0]).toMatchObject({
      operation: "embed_query",
      status: "failed",
      input: {
        input: {
          request: {
            query: "provider query",
            model: "embedding",
            dimensions: 1536,
            timeoutMs: 15000,
            maxRetries: 1,
          },
          signal: { present: false },
        },
        ownUndefinedPaths: [],
      },
    });
    expect(result.providerOccurrences[0]!.error).toMatchObject({
      input: { name: "Error", message: "provider failed" },
    });
    expect(result.failures).toContainEqual({ code: "provider_error", operation: "embed_query" });
  });

  it("rejects a widened SQL dependency object before validating or dispatching the request", async () => {
    const sql = { ...sqlDependencies(), genericQuery: vi.fn() };
    await expect(runShadowEvaluationRuntimeV1(runtimeInput(
      sql as unknown as ShadowEvaluationSqlDependenciesV1,
    ))).rejects.toThrow("dependency surface");
    expect(mocks.phaseAdmission).not.toHaveBeenCalled();
    expect(sql.genericQuery).not.toHaveBeenCalled();
  });

  describe("U04 runtime capture and phase admission corrections", () => {
    it("retains malformed provider numbers through the actual native evidence protocol", async () => {
      const protocol = await vi.importActual<typeof import("../scripts/lib/reindex-eval-session")>("../scripts/lib/reindex-eval-session");
      const { embedTextWithEvaluationClient } = await import("../src/lib/openai");
      mocks.captureNative.mockImplementation(protocol.captureShadowProducerInputV1);
      mocks.readNative.mockImplementation(protocol.readShadowProducerInputV1);
      mocks.invokeProvider = true;
      const dependencies = providers();
      const vector = Array.from({ length: 1536 }, () => 0.25);
      vector[0] = Number.NaN;
      const create = vi.fn(() => Promise.resolve({ data: [{ index: 0, embedding: vector }] }));
      dependencies.embedQuery.mockImplementation(value => embedTextWithEvaluationClient({
        embeddings: { create }, responses: { create: vi.fn(), parse: vi.fn() },
      } as unknown as Parameters<typeof embedTextWithEvaluationClient>[0], value));
      const result = await runShadowEvaluationRuntimeV1(runtimeInput(sqlDependencies(), dependencies));
      expect(result.complete).toBe(false);
      expect(result.failureLatched).toBe(true);
      expect(result.providerOccurrences).toHaveLength(1);
      const retained = result.providerOccurrences[0]!;
      expect(retained.status).toBe("failed");
      expect(retained.error?.input).toMatchObject({ properties: { nativeResponse: {
        data: [{ index: 0, embedding: [{ type: "unrepresentable_number", value: "NaN" }, ...vector.slice(1)] }],
      } } });
      expect(() => protocol.captureShadowProducerInputV1(result)).not.toThrow();
    });

    it("retains a fresh candidate guard after all workload reads", async () => {
      mocks.phaseAdmission.mockReturnValue({ ...request(), payload: { ...request().payload, phase: { side: "candidate" } } });
      const sql = sqlDependencies();
      const result = await runShadowEvaluationRuntimeV1({ ...runtimeInput(sql), candidateEvidence: { synthetic: true } });
      expect(result.complete).toBe(true);
      expect(sql.readAliases).toHaveBeenCalledTimes(1);
      expect(result.readOccurrences.map(value => value.operation)).toEqual(["text_chunks", "text_chunks", "aliases"]);
      expect(result.completionRead).toBe(result.readOccurrences.at(-1));
      expect(result.completionRead).toMatchObject({ status: "complete", startedAt: NOW, finishedAt: NOW });
    });

    it("preserves NO_GO when the candidate changes after the workload", async () => {
      mocks.phaseAdmission.mockReturnValue({ ...request(), payload: { ...request().payload, phase: { side: "candidate" } } });
      const sql = sqlDependencies();
      vi.mocked(sql.readAliases).mockRejectedValue(new Error("synthetic final state drift"));
      const result = await runShadowEvaluationRuntimeV1({ ...runtimeInput(sql), candidateEvidence: { synthetic: true } });
      expect(result.complete).toBe(false);
      expect(result.failureLatched).toBe(true);
      expect(result.completionRead).toBeNull();
      expect(result.readOccurrences.at(-1)).toMatchObject({ operation: "aliases", status: "failed" });
      expect(result.failures).toContainEqual({ code: "dependency_error", operation: "aliases" });
    });

    it("refuses invalid phase evidence before a zero-read workload can run", async () => {
      mocks.phaseErrorAt = 1;
      mocks.restoreCases.mockReturnValue({ retrieval: [], quality: [] });
      const sql = sqlDependencies();

      await expect(runShadowEvaluationRuntimeV1(runtimeInput(sql))).rejects.toThrow("phase admission refused");

      expect(mocks.workload).not.toHaveBeenCalled();
      expect(sql.readTextChunks).not.toHaveBeenCalled();
      expect(mocks.prepared).toEqual([]);
    });

    it("revalidates phase evidence after a zero-read workload before reporting completion", async () => {
      mocks.phaseErrorAt = 2;
      mocks.restoreCases.mockReturnValue({ retrieval: [], quality: [] });
      mocks.workload.mockResolvedValue(workloadResult(true));
      const sql = sqlDependencies();

      const result = await runShadowEvaluationRuntimeV1(runtimeInput(sql));

      expect(mocks.phaseAdmission).toHaveBeenCalledTimes(2);
      expect(sql.readTextChunks).not.toHaveBeenCalled();
      expect(mocks.prepared).toEqual([]);
      expect(result.complete).toBe(false);
      expect(result.failureLatched).toBe(true);
      expect(result.failures).toContainEqual({ code: "context_mismatch", operation: "context" });
    });

    it("keeps admitted SQL, provider, clock and nested configuration fixed across awaits", async () => {
      mocks.invokeProvider = true;
      const sql = sqlDependencies();
      const providerDependencies = providers();
      const originalSql = vi.mocked(sql.readTextChunks);
      const originalProvider = providerDependencies.embedQuery;
      const replacementSql = vi.fn(async () => ({ name: "substituted SQL" }));
      const replacementProvider = vi.fn(async () => ({ embedding: [99], cacheHit: true }));
      let releaseProvider!: () => void;
      const providerGate = new Promise<void>((resolve) => { releaseProvider = resolve; });
      originalProvider.mockImplementation(async () => {
        await providerGate;
        return { embedding: [], cacheHit: false };
      });
      const profileValue = profile();
      mocks.parseProfile.mockReturnValue(profileValue);
      const input = runtimeInput(sql, providerDependencies);
      const trustedNow = vi.fn(() => NOW);
      Object.defineProperty(input, "clock", {
        value: { trustedNow, now: vi.fn(() => Date.parse(NOW)) },
        enumerable: true,
      });

      const pending = runShadowEvaluationRuntimeV1(input);
      await vi.waitFor(() => expect(originalProvider).toHaveBeenCalledTimes(1));
      Object.defineProperty(sql, "readTextChunks", { value: replacementSql, enumerable: true });
      Object.defineProperty(providerDependencies, "embedQuery", { value: replacementProvider, enumerable: true });
      Object.defineProperty(input.clock, "trustedNow", {
        value: vi.fn(() => "2099-01-01T00:00:00.000Z"),
        enumerable: true,
      });
      profileValue.configuration.payload.ranking.secondStage.positionBase = 99;
      releaseProvider();
      const result = await pending;

      expect(result.complete).toBe(true);
      expect(originalSql).toHaveBeenCalledTimes(2);
      expect(replacementSql).not.toHaveBeenCalled();
      expect(originalProvider).toHaveBeenCalledTimes(2);
      expect(replacementProvider).not.toHaveBeenCalled();
      expect(mocks.engineContexts[0]!.configuration.ranking.secondStage.positionBase).toBe(0);
      expect(Object.isFrozen(mocks.engineContexts[0]!.configuration.ranking.secondStage)).toBe(true);
      expect(result.readOccurrences.every((occurrence) => occurrence.startedAt === NOW)).toBe(true);
      expect(trustedNow).toHaveBeenCalled();
    });

    it("retains immutable serializable SQL and structured-provider evidence after dependency output mutation", async () => {
      mocks.invokeStructuredProvider = true;
      const sqlOutput = { name: "readTextChunks", nested: { value: "before" } };
      const providerOutput = { parsed: { verdict: "before" } };
      const sql = sqlDependencies();
      const readTextChunks = vi.fn(async () => sqlOutput);
      Object.defineProperty(sql, "readTextChunks", { value: readTextChunks, enumerable: true });
      const providerDependencies = providers();
      providerDependencies.generateClassifier.mockResolvedValue(providerOutput);

      const result = await runShadowEvaluationRuntimeV1(runtimeInput(sql, providerDependencies));
      sqlOutput.nested.value = "after";
      providerOutput.parsed.verdict = "after";

      expect(result.readOccurrences[0]!.resultEnvelope).toEqual({
        input: { name: "readTextChunks", nested: { value: "before" } },
        ownUndefinedPaths: [],
      });
      expect(result.providerOccurrences[0]!.output).toEqual({
        input: { parsed: { verdict: "before" } },
        ownUndefinedPaths: [],
      });
      const retainedRequest = result.providerOccurrences[0]!.input;
      expect(retainedRequest.input).toMatchObject({
        input: [{ role: "user", content: "captured classifier input" }],
        schema: { type: "json_schema", name: "clinical_rag_query_classifier", strict: true },
        options: {
          model: "classifier",
          instructions: "captured classifier instructions",
          schemaName: "clinical_rag_query_classifier",
        },
        signal: { present: false },
      });
      expect(JSON.stringify(result.providerOccurrences)).not.toContain("$parseRaw");
      expect(Object.isFrozen(result.readOccurrences[0]!.resultEnvelope?.input)).toBe(true);
      expect(Object.isFrozen(result.providerOccurrences[0]!.output?.input)).toBe(true);
    });
  });
});
