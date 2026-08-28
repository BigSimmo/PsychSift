import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SiteContentHealthInput } from "../src/lib/health-response";
import type { RagAnswer } from "../src/lib/types";
import type { ActiveSiteContentRelease } from "../src/lib/site-content/site-content-contracts";
import { resolveRagContextSnapshot, type RagContextSnapshotInput } from "../src/lib/rag/rag-context-snapshot";

const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STATIC_DIGEST = `sha256:${"1".repeat(64)}`;
const healthFixturePath = resolve("tests/fixtures/site-content/release-evidence-current.json");

function currentHealthAuthority(): SiteContentHealthInput {
  const input = JSON.parse(readFileSync(healthFixturePath, "utf8")) as SiteContentHealthInput;
  const now = Date.now();
  return {
    ...input,
    activeRelease: {
      ...input.activeRelease!,
      activatedAt: new Date(now - 300_000).toISOString(),
    },
    queueHealth: {
      ...input.queueHealth,
      observedAt: new Date(now).toISOString(),
      lastHeartbeatAt: new Date(now - 30_000).toISOString(),
      lastInvocationAt: new Date(now - 60_000).toISOString(),
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock("@/lib/env");
  vi.doUnmock("@/lib/deep-memory");
  vi.doUnmock("@/lib/clinical-search");
  vi.doUnmock("@/lib/rag/rag-versioning");
  vi.doUnmock("@/lib/rag/rag-cache");
  vi.doUnmock("@/lib/site-content/site-content-health-authority");
  vi.doUnmock("@/lib/supabase/admin");
  vi.resetModules();
});

function contextSnapshot(
  overrides: Partial<RagContextSnapshotInput> & { release?: Partial<ActiveSiteContentRelease> } = {},
) {
  const release: ActiveSiteContentRelease = {
    version: "clinical-kb-site-release-v1",
    releaseId: "11111111-1111-4111-8111-111111111111",
    registryVersion: "site-content-registry-v1",
    staticManifestDigest: STATIC_DIGEST,
    dynamicStateDigest: `sha256:${"2".repeat(64)}`,
    releaseDigest: `sha256:${"3".repeat(64)}`,
    state: "active",
    activatedAt: "2026-08-29T00:00:00.000Z",
    ...overrides.release,
  };
  const { release: _release, ...inputOverrides } = overrides;
  return resolveRagContextSnapshot({
    expectedSiteStaticManifestDigest: STATIC_DIGEST,
    activePublicSiteRelease: release,
    publicSiteChangeEpoch: "epoch-1",
    pendingPublicSiteChangeCount: 0,
    pendingPublicSiteLogicalIds: [],
    documentIndexGeneration: "documents-generation-1",
    sourcePolicyVersion: "source-policy-v2",
    rolloutVersion: "legacy",
    resolvedAt: "2026-08-29T00:02:00.000Z",
    ...inputOverrides,
  });
}

function siteComponentOffSnapshot() {
  return resolveRagContextSnapshot({
    expectedSiteStaticManifestDigest: null,
    activePublicSiteRelease: null,
    publicSiteChangeEpoch: null,
    pendingPublicSiteChangeCount: 0,
    pendingPublicSiteLogicalIds: [],
    documentIndexGeneration: "documents-generation-legacy",
    sourcePolicyVersion: "source-policy-v2",
    rolloutVersion: "legacy",
  });
}

function sampleAnswer(answer = "Cached clinical answer."): RagAnswer {
  return {
    answer,
    grounded: true,
    confidence: "high",
    citations: [],
    sources: [],
    routingMode: "fast",
    routingReason: "test",
    modelUsed: "test-model",
  };
}

type FilterCall =
  | { method: "eq"; column: string; value: unknown }
  | { method: "is"; column: string; value: unknown }
  | { method: "in"; column: string; value: unknown };

class DeleteQuery implements PromiseLike<{ data: null; error: null }> {
  constructor(private readonly calls: FilterCall[]) {}

  eq(column: string, value: unknown) {
    this.calls.push({ method: "eq", column, value });
    return this;
  }

  is(column: string, value: unknown) {
    this.calls.push({ method: "is", column, value });
    return this;
  }

  in(column: string, value: unknown) {
    this.calls.push({ method: "in", column, value });
    return this;
  }

  then<TResult1 = { data: null; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: null; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: null, error: null }).then(onfulfilled, onrejected);
  }
}

describe("RAG cache invalidation", () => {
  it("keeps exact legacy answer/search cache bytes when the site component is off", async () => {
    vi.resetModules();
    vi.doMock("@/lib/env", () => ({
      env: {
        OPENAI_ANSWER_MODEL: "answer",
        OPENAI_FAST_ANSWER_MODEL: "fast",
        OPENAI_STRONG_ANSWER_MODEL: "strong",
        OPENAI_QUERY_CLASSIFIER_MODEL: "classifier",
        OPENAI_INDEXING_MODEL: "indexing",
        OPENAI_EMBEDDING_MODEL: "embed",
        EMBEDDING_DIMENSIONS: 1536,
        OPENAI_FAST_REASONING_EFFORT: "low",
        OPENAI_STRONG_REASONING_EFFORT: "high",
        OPENAI_TEXT_VERBOSITY: "medium",
        OPENAI_MAX_OUTPUT_TOKENS: 4096,
        RAG_PROVIDER_MODE: "offline",
        RAG_SEMANTIC_RERANK_ENABLED: false,
        OPENAI_RERANK_MODEL: "rerank",
        RAG_PERSIST_RAW_QUERY_TEXT: true,
        RAG_QUERY_HASH_SECRET: "",
      },
      isDemoMode: () => false,
      isLocalNoAuthMode: () => false,
    }));
    vi.doMock("@/lib/deep-memory", () => ({ ragDeepMemoryVersion: "test-rag-version" }));
    vi.doMock("@/lib/clinical-search", () => ({
      buildClinicalTextSearchQuery: (query: string) => query.trim(),
    }));
    vi.doMock("@/lib/rag/rag-versioning", () => ({
      ragAnswerPromptVersion: "answer-prompt",
      ragAnswerSchemaVersion: "answer-schema",
      ragIndexingPromptVersion: "indexing-prompt",
      ragQueryClassifierPromptVersion: "classifier-prompt",
    }));

    const { retrievalPlanCacheQuery, scopedAnswerCacheKey } = await import("../src/lib/rag/rag-cache");
    const legacyArgs = {
      query: "  Lithium   monitoring ",
      ownerId,
      accessScope: { ownerId, includePublic: true as const },
    };
    const siteOffArgs = { ...legacyArgs, ragContextSnapshot: siteComponentOffSnapshot() };
    const expectedAnswerKey =
      "rag-cache-v20|owner:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa+public|all-documents|auto|" +
      "generation:9ff8d6d7a6647c834f6c|lithium monitoring";
    const expectedSearchKey =
      "plan:balanced_hybrid:chunks_fields_units_memory|class:unknown|query:lithium monitoring|" +
      "variants:e3b0c44298fc1c14|mode:auto|topK:8|min:0.15|forceEmbedding:0|lexicalOnly:0|" +
      "rag:test-rag-version|force:0";

    expect(scopedAnswerCacheKey(legacyArgs)).toBe(expectedAnswerKey);
    expect(scopedAnswerCacheKey(siteOffArgs)).toBe(expectedAnswerKey);
    expect(retrievalPlanCacheQuery(legacyArgs)).toBe(expectedSearchKey);
    expect(retrievalPlanCacheQuery(siteOffArgs)).toBe(expectedSearchKey);
  });

  it("binds local answer, search, and coalescing identities to the exact active request snapshot", async () => {
    vi.resetModules();
    vi.doMock("@/lib/env", () => ({
      env: {
        OPENAI_ANSWER_MODEL: "answer",
        OPENAI_FAST_ANSWER_MODEL: "fast",
        OPENAI_STRONG_ANSWER_MODEL: "strong",
        OPENAI_QUERY_CLASSIFIER_MODEL: "classifier",
        OPENAI_INDEXING_MODEL: "indexing",
        OPENAI_EMBEDDING_MODEL: "embed",
        EMBEDDING_DIMENSIONS: 1536,
        OPENAI_FAST_REASONING_EFFORT: "low",
        OPENAI_STRONG_REASONING_EFFORT: "high",
        OPENAI_TEXT_VERBOSITY: "medium",
        OPENAI_MAX_OUTPUT_TOKENS: 4096,
        RAG_PROVIDER_MODE: "offline",
        RAG_SEMANTIC_RERANK_ENABLED: false,
        OPENAI_RERANK_MODEL: "rerank",
        RAG_PERSIST_RAW_QUERY_TEXT: true,
      },
      isDemoMode: () => false,
      isLocalNoAuthMode: () => false,
    }));
    vi.doMock("@/lib/deep-memory", () => ({ ragDeepMemoryVersion: "test-rag-version" }));
    vi.doMock("@/lib/clinical-search", () => ({
      buildClinicalTextSearchQuery: (query: string) => query.trim(),
    }));
    vi.doMock("@/lib/rag/rag-versioning", () => ({
      ragAnswerPromptVersion: "answer-prompt",
      ragAnswerSchemaVersion: "answer-schema",
      ragIndexingPromptVersion: "indexing-prompt",
      ragQueryClassifierPromptVersion: "classifier-prompt",
    }));

    const { retrievalPlanCacheQuery, scopedAnswerCacheKey } = await import("../src/lib/rag/rag-cache");
    const releaseOne = contextSnapshot();
    const releaseTwo = contextSnapshot({
      publicSiteChangeEpoch: "epoch-2",
      release: {
        releaseId: "22222222-2222-4222-8222-222222222222",
        dynamicStateDigest: `sha256:${"4".repeat(64)}`,
        releaseDigest: `sha256:${"5".repeat(64)}`,
        activatedAt: "2026-08-29T00:01:00.000Z",
      },
    });
    const baseArgs = {
      query: "lithium monitoring",
      ownerId,
      accessScope: { ownerId, includePublic: true as const },
    };

    expect(scopedAnswerCacheKey({ ...baseArgs, ragContextSnapshot: releaseOne })).not.toBe(
      scopedAnswerCacheKey({ ...baseArgs, ragContextSnapshot: releaseTwo }),
    );
    expect(retrievalPlanCacheQuery({ ...baseArgs, ragContextSnapshot: releaseOne })).not.toBe(
      retrievalPlanCacheQuery({ ...baseArgs, ragContextSnapshot: releaseTwo }),
    );
  });

  it("does not coalesce an O2 answer request onto an overlapping O1 owner-index flight", async () => {
    vi.resetModules();
    const o1Answer = Promise.withResolvers<RagAnswer>();
    const o2Answer = Promise.withResolvers<RagAnswer>();
    let ownerIndexGeneration = "owner-index-O1";
    const siteAuthority = currentHealthAuthority();
    const cacheIndexingVersion = vi.fn(async (args: { ownerId?: string; ragContextSnapshot?: unknown }) => {
      if (!args.ownerId && !args.ragContextSnapshot) return "public-index-P";
      return ownerIndexGeneration;
    });
    const getCachedAnswer = vi.fn(
      async (_args: unknown, _startedAt: number, options?: { indexingVersionAtRequestStart?: string | null }) => {
        if (options?.indexingVersionAtRequestStart === "owner-index-O1") return o1Answer.promise;
        if (options?.indexingVersionAtRequestStart === "owner-index-O2") return o2Answer.promise;
        throw new Error(`Unexpected request-start indexing authority: ${options?.indexingVersionAtRequestStart}`);
      },
    );

    vi.doMock("@/lib/env", () => ({
      env: {
        RAG_ANSWER_CACHE_TTL_MS: 60_000,
        RAG_ANSWER_CACHE_SIZE: 20,
        OPENAI_ANSWER_MODEL: "answer",
        OPENAI_FAST_ANSWER_MODEL: "fast",
        OPENAI_STRONG_ANSWER_MODEL: "strong",
        OPENAI_QUERY_CLASSIFIER_MODEL: "classifier",
        OPENAI_INDEXING_MODEL: "indexing",
        OPENAI_EMBEDDING_MODEL: "embed",
        EMBEDDING_DIMENSIONS: 1536,
        OPENAI_FAST_REASONING_EFFORT: "low",
        OPENAI_STRONG_REASONING_EFFORT: "high",
        OPENAI_TEXT_VERBOSITY: "medium",
        OPENAI_MAX_OUTPUT_TOKENS: 4096,
        RAG_PROVIDER_MODE: "offline",
        RAG_SEMANTIC_RERANK_ENABLED: false,
        OPENAI_RERANK_MODEL: "rerank",
        RAG_PERSIST_RAW_QUERY_TEXT: false,
        RAG_QUERY_HASH_SECRET: "test-query-hash-secret",
      },
      isDemoMode: () => false,
      isLocalNoAuthMode: () => false,
    }));
    vi.doMock("@/lib/deep-memory", () => ({ ragDeepMemoryVersion: "test-rag-version" }));
    vi.doMock("@/lib/clinical-search", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../src/lib/clinical-search")>()),
      buildClinicalTextSearchQuery: (query: string) => query.trim(),
    }));
    vi.doMock("@/lib/rag/rag-versioning", () => ({
      ragAnswerPromptVersion: "answer-prompt",
      ragAnswerSchemaVersion: "answer-schema",
      ragIndexingPromptVersion: "indexing-prompt",
      ragQueryClassifierPromptVersion: "classifier-prompt",
    }));
    vi.doMock("@/lib/site-content/site-content-health-authority", () => ({
      collectSiteContentHealthInput: vi.fn(async () => siteAuthority),
    }));
    vi.doMock("@/lib/rag/rag-cache", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../src/lib/rag/rag-cache")>()),
      cacheIndexingVersion,
      getCachedAnswer,
      getSharedCachedAnswer: vi.fn(async () => {
        throw new Error("local synthetic answer should finish before shared-cache lookup");
      }),
    }));

    const { answerQuestionWithScope } = await import("../src/lib/rag/rag");
    const request = { query: "synthetic owner generation question", ownerId, logQuery: false };
    const o1 = answerQuestionWithScope(request);
    await vi.waitFor(() => expect(getCachedAnswer).toHaveBeenCalledTimes(1));

    ownerIndexGeneration = "owner-index-O2";
    const o2Origin = answerQuestionWithScope(request);
    const o2Waiter = answerQuestionWithScope(request);
    await vi.waitFor(() =>
      expect(cacheIndexingVersion.mock.calls.filter(([args]) => args.ownerId === ownerId)).toHaveLength(3),
    );
    const answerReadsBeforeRelease = getCachedAnswer.mock.calls.length;

    o2Answer.resolve(sampleAnswer("owner-index-O2 answer"));
    o1Answer.resolve(sampleAnswer("owner-index-O1 answer"));
    const [o1Result, o2OriginResult, o2WaiterResult] = await Promise.all([o1, o2Origin, o2Waiter]);

    expect(answerReadsBeforeRelease).toBe(2);
    expect(getCachedAnswer.mock.calls.map((call) => call[2]?.indexingVersionAtRequestStart)).toEqual([
      "owner-index-O1",
      "owner-index-O2",
    ]);
    expect(o1Result.answer).toBe("owner-index-O1 answer");
    expect(o2OriginResult.answer).toBe("owner-index-O2 answer");
    expect(o2WaiterResult.answer).toBe("owner-index-O2 answer");
    expect(o2WaiterResult.routingReason).toContain("answer_inflight_coalesced");
  });

  it("does not reuse a locally cached site-backed answer after the active snapshot changes", async () => {
    vi.resetModules();
    vi.doMock("@/lib/env", () => ({
      env: {
        RAG_ANSWER_CACHE_TTL_MS: 60_000,
        RAG_ANSWER_CACHE_SIZE: 20,
        RAG_PERSIST_RAW_QUERY_TEXT: false,
        RAG_QUERY_HASH_SECRET: "test-query-hash-secret",
      },
      isDemoMode: () => false,
      isLocalNoAuthMode: () => false,
    }));
    vi.doMock("@/lib/deep-memory", () => ({ ragDeepMemoryVersion: "test-rag-version" }));
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        rpc: vi.fn(async () => ({ data: "1", error: null })),
        from: vi.fn((table: string) => {
          if (table === "documents") {
            const builder = {
              select: () => builder,
              eq: () => builder,
              is: () => builder,
              or: () => builder,
              in: () => builder,
              order: () => builder,
              limit: async () => ({
                data: [{ id: "doc-1", updated_at: "2026-08-29T00:00:00.000Z", metadata: {} }],
                error: null,
              }),
            };
            return builder;
          }
          const shared = {
            eq: () => shared,
            is: () => shared,
            delete: () => shared,
            insert: async () => ({ data: null, error: null }),
            then: (resolve: (value: { data: null; error: null }) => unknown) =>
              Promise.resolve({ data: null, error: null }).then(resolve),
          };
          return shared;
        }),
      }),
    }));

    const { cacheIndexingVersion, getCachedAnswer, setCachedAnswer } = await import("../src/lib/rag/rag-cache");
    const request = {
      query: "synthetic site-backed question",
      ownerId,
      accessScope: { ownerId, includePublic: true as const },
    };
    const releaseOne = contextSnapshot();
    const releaseTwo = contextSnapshot({
      publicSiteChangeEpoch: "epoch-2",
      release: {
        releaseId: "22222222-2222-4222-8222-222222222222",
        dynamicStateDigest: `sha256:${"4".repeat(64)}`,
        releaseDigest: `sha256:${"5".repeat(64)}`,
      },
    });
    const retrievalStamp = await cacheIndexingVersion(
      { ...request, ragContextSnapshot: releaseOne },
      { forceRefresh: true },
    );
    await setCachedAnswer({ ...request, ragContextSnapshot: releaseOne }, sampleAnswer("release-one answer"), {
      indexingVersionAtRetrievalStart: retrievalStamp,
    });

    await expect(getCachedAnswer({ ...request, ragContextSnapshot: releaseTwo }, Date.now())).resolves.toBeNull();
  });

  it("retains owner-scoped legacy authority changes beneath one reused public snapshot", async () => {
    vi.resetModules();
    const initialNow = Date.parse("2026-08-29T01:00:00.000Z");
    const now = vi.spyOn(Date, "now").mockReturnValue(initialNow);
    let ownerDocument = { id: "owner-doc-1", updated_at: "2026-08-29T00:00:00.000Z", metadata: {} };

    vi.doMock("@/lib/env", () => ({
      env: {
        RAG_ANSWER_CACHE_TTL_MS: 60_000,
        RAG_ANSWER_CACHE_SIZE: 20,
        RAG_PERSIST_RAW_QUERY_TEXT: false,
        RAG_QUERY_HASH_SECRET: "test-query-hash-secret",
      },
      isDemoMode: () => false,
      isLocalNoAuthMode: () => false,
    }));
    vi.doMock("@/lib/deep-memory", () => ({ ragDeepMemoryVersion: "test-rag-version" }));
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        rpc: vi.fn(async () => ({ data: "public-epoch-1", error: null })),
        from: vi.fn((table: string) => {
          if (table === "documents") {
            const builder = {
              select: () => builder,
              eq: () => builder,
              is: () => builder,
              or: () => builder,
              in: () => builder,
              order: () => builder,
              limit: () => builder,
              then: (resolve: (value: { data: (typeof ownerDocument)[]; error: null }) => unknown) =>
                Promise.resolve({ data: [ownerDocument], error: null }).then(resolve),
            };
            return builder;
          }
          const shared = {
            delete: () => shared,
            eq: () => shared,
            is: () => shared,
            insert: async () => ({ data: null, error: null }),
            then: (resolve: (value: { data: null; error: null }) => unknown) =>
              Promise.resolve({ data: null, error: null }).then(resolve),
          };
          return shared;
        }),
      }),
    }));

    try {
      const { cacheIndexingVersion, getCachedAnswer, setCachedAnswer } = await import("../src/lib/rag/rag-cache");
      const ragContextSnapshot = contextSnapshot();
      const request = {
        query: "synthetic owner document question",
        ownerId,
        accessScope: { ownerId, includePublic: true as const },
        ragContextSnapshot,
      };
      const requestStamp = await cacheIndexingVersion(request, { forceRefresh: true });
      await setCachedAnswer(request, sampleAnswer("owner document one answer"), {
        indexingVersionAtRetrievalStart: requestStamp,
      });

      ownerDocument = { id: "owner-doc-2", updated_at: "2026-08-29T00:30:00.000Z", metadata: {} };
      now.mockReturnValue(initialNow + 6_000);

      await expect(getCachedAnswer(request, Date.now())).resolves.toBeNull();
    } finally {
      now.mockRestore();
    }
  });

  it("rechecks the lifecycle epoch after deferred request work before a real local answer-cache read", async () => {
    vi.resetModules();
    let lifecycleEpoch = "1";
    const rpc = vi.fn(async () => ({ data: lifecycleEpoch, error: null }));
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        rpc,
        from: vi.fn((table: string) => {
          if (table === "documents") {
            const builder = {
              select: vi.fn(() => builder),
              eq: vi.fn(() => builder),
              is: vi.fn(() => builder),
              or: vi.fn(() => builder),
              in: vi.fn(() => builder),
              order: vi.fn(() => builder),
              limit: vi.fn(async () => ({
                data: [{ id: "doc-1", updated_at: "2026-08-24T00:00:00.000Z", metadata: {} }],
                error: null,
              })),
              abortSignal: vi.fn(() => builder),
            };
            return builder;
          }
          return {
            delete: vi.fn(() => new DeleteQuery([])),
            insert: vi.fn(async () => ({ data: null, error: null })),
          };
        }),
      }),
    }));

    const { cacheIndexingVersion, getCachedAnswer, setCachedAnswer } = await import("../src/lib/rag/rag-cache");
    const args = {
      query: "synthetic deferred classification",
      ownerId,
      accessScope: { ownerId, includePublic: true as const },
    };
    const requestStartStamp = await cacheIndexingVersion(args, { forceRefresh: true });
    await setCachedAnswer(args, sampleAnswer("epoch-one answer"), {
      indexingVersionAtRetrievalStart: requestStartStamp,
    });
    const callsBeforeLookup = rpc.mock.calls.length;

    // Models classification/alias work yielding while an activation commits epoch 2.
    lifecycleEpoch = "2";
    await expect(
      getCachedAnswer(args, Date.now(), { indexingVersionAtRequestStart: requestStartStamp }),
    ).resolves.toBeNull();
    expect(rpc.mock.calls.length).toBeGreaterThan(callsBeforeLookup);
  });

  it("bypasses every cache surface when the public-source lifecycle epoch cannot be read", async () => {
    vi.resetModules();
    const from = vi.fn(() => {
      throw new Error("cache tables must not be touched without lifecycle authority");
    });
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        rpc: vi.fn(async () => ({ data: null, error: { message: "synthetic epoch unavailable" } })),
        from,
      }),
    }));

    const { cacheIndexingVersion } = await import("../src/lib/rag/rag-cache");
    await expect(
      cacheIndexingVersion({ ownerId, accessScope: { ownerId, includePublic: true } }, { forceRefresh: true }),
    ).resolves.toMatch(/public-authority-unavailable/);
    expect(from).not.toHaveBeenCalled();
  });

  it("clears anonymous shared cache rows with owner_id is null instead of writing the anonymous sentinel to UUID filters", async () => {
    vi.resetModules();
    const calls: FilterCall[][] = [];

    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from: vi.fn((table: string) => ({
          delete: vi.fn(() => {
            expect(table).toBe("rag_response_cache");
            const queryCalls: FilterCall[] = [];
            calls.push(queryCalls);
            return new DeleteQuery(queryCalls);
          }),
        })),
      }),
    }));

    const { invalidateRagCachesForDocumentMutation } = await import("../src/lib/rag/rag");

    invalidateRagCachesForDocumentMutation(ownerId);

    await vi.waitFor(() => expect(calls.length).toBe(2), { timeout: 10000 });

    expect(calls[0]).toContainEqual({ method: "eq", column: "owner_id", value: ownerId });
    expect(calls.flat()).not.toContainEqual({ method: "eq", column: "owner_id", value: "anonymous" });
    expect(calls[1]).toContainEqual({ method: "is", column: "owner_id", value: null });
    expect(calls[1]).toContainEqual({ method: "in", column: "cache_kind", value: ["search", "answer"] });

    calls.length = 0;
    invalidateRagCachesForDocumentMutation(ownerId, { affectsPublicCorpus: false });
    await vi.waitFor(() => expect(calls.length).toBe(1), { timeout: 10000 });
    expect(calls[0]).toContainEqual({ method: "eq", column: "owner_id", value: ownerId });

    calls.length = 0;
    invalidateRagCachesForDocumentMutation(ownerId, { affectsPublicCorpus: true });
    await vi.waitFor(() => expect(calls.length).toBe(2), { timeout: 10000 });
    expect(calls[1]).toContainEqual({ method: "is", column: "owner_id", value: null });
  });

  it("discards a deferred setCachedAnswer that resumes after invalidateRagCachesForOwner", async () => {
    vi.resetModules();

    let releaseIndexingVersion: (() => void) | undefined;
    const indexingVersionGate = new Promise<void>((resolve) => {
      releaseIndexingVersion = resolve;
    });
    const indexingStamp = "rag-deep-memory-v1:doc-1:2026-07-01T00:00:00.000Z::public:1";

    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        rpc: vi.fn(async () => ({ data: "1", error: null })),
        from: vi.fn((table: string) => {
          if (table === "documents") {
            const builder = {
              select: vi.fn(() => builder),
              eq: vi.fn(() => builder),
              is: vi.fn(() => builder),
              or: vi.fn(() => builder),
              in: vi.fn(() => builder),
              order: vi.fn(() => builder),
              limit: vi.fn(() => builder),
              abortSignal: vi.fn(() => builder),
              then: (onfulfilled?: (value: { data: unknown; error: null }) => unknown) =>
                indexingVersionGate
                  .then(() =>
                    Promise.resolve({
                      data: [{ id: "doc-1", updated_at: "2026-07-01T00:00:00.000Z", metadata: {} }],
                      error: null,
                    }),
                  )
                  .then(onfulfilled),
            };
            return builder;
          }

          const deleteCalls: FilterCall[] = [];
          return {
            delete: vi.fn(() => new DeleteQuery(deleteCalls)),
            insert: vi.fn(async () => ({ data: null, error: null })),
          };
        }),
      }),
    }));

    const { getCachedAnswer, invalidateRagCachesForOwner, setCachedAnswer } = await import("../src/lib/rag/rag-cache");

    const args = {
      query: "clozapine monitoring",
      ownerId,
      accessScope: { ownerId, includePublic: true as const },
    };
    const promotion = setCachedAnswer(args, sampleAnswer("pre-review answer"), {
      indexingVersionAtRetrievalStart: indexingStamp,
    });

    // Simulate a table-fact / review mutation while the deferred promotion awaits
    // its forced indexing-version read. Review metadata does not change that stamp.
    invalidateRagCachesForOwner(ownerId);
    releaseIndexingVersion?.();
    await promotion;

    const cached = await getCachedAnswer(args, Date.now(), {
      indexingVersionAtRequestStart: indexingStamp,
    });
    expect(cached).toBeNull();
  });

  it("does not let one owner's invalidation discard another owner's deferred setCachedAnswer", async () => {
    vi.resetModules();

    const ownerA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const ownerB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    let releaseIndexingVersion: (() => void) | undefined;
    const indexingVersionGate = new Promise<void>((resolve) => {
      releaseIndexingVersion = resolve;
    });
    const indexingStamp = "rag-deep-memory-v1:doc-1:2026-07-01T00:00:00.000Z::public:1";

    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        rpc: vi.fn(async () => ({ data: "1", error: null })),
        from: vi.fn((table: string) => {
          if (table === "documents") {
            const builder = {
              select: vi.fn(() => builder),
              eq: vi.fn(() => builder),
              is: vi.fn(() => builder),
              or: vi.fn(() => builder),
              in: vi.fn(() => builder),
              order: vi.fn(() => builder),
              limit: vi.fn(() => builder),
              abortSignal: vi.fn(() => builder),
              then: (onfulfilled?: (value: { data: unknown; error: null }) => unknown) =>
                indexingVersionGate
                  .then(() =>
                    Promise.resolve({
                      data: [{ id: "doc-1", updated_at: "2026-07-01T00:00:00.000Z", metadata: {} }],
                      error: null,
                    }),
                  )
                  .then(onfulfilled),
            };
            return builder;
          }

          const deleteCalls: FilterCall[] = [];
          return {
            delete: vi.fn(() => new DeleteQuery(deleteCalls)),
            insert: vi.fn(async () => ({ data: null, error: null })),
          };
        }),
      }),
    }));

    const { getCachedAnswer, invalidateRagCachesForOwner, setCachedAnswer } = await import("../src/lib/rag/rag-cache");

    const argsB = {
      query: "clozapine monitoring",
      ownerId: ownerB,
      accessScope: { ownerId: ownerB, includePublic: true as const },
    };
    const promotionB = setCachedAnswer(argsB, sampleAnswer("owner-b answer"), {
      indexingVersionAtRetrievalStart: indexingStamp,
    });

    invalidateRagCachesForOwner(ownerA);
    releaseIndexingVersion?.();
    await promotionB;

    const cachedB = await getCachedAnswer(argsB, Date.now(), {
      indexingVersionAtRequestStart: indexingStamp,
    });
    expect(cachedB?.answer).toBe("owner-b answer");
  });
});
