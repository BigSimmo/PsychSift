import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActiveSiteContentRelease } from "../src/lib/site-content/site-content-contracts";
import { ragContextSnapshotCacheKey, resolveRagContextSnapshot } from "../src/lib/rag/rag-context-snapshot";

const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function publicContextSnapshot() {
  const staticManifestDigest = `sha256:${"1".repeat(64)}`;
  const activePublicSiteRelease: ActiveSiteContentRelease = {
    version: "clinical-kb-site-release-v1",
    releaseId: "11111111-1111-4111-8111-111111111111",
    registryVersion: "site-content-registry-v1",
    staticManifestDigest,
    dynamicStateDigest: `sha256:${"2".repeat(64)}`,
    releaseDigest: `sha256:${"3".repeat(64)}`,
    state: "active",
    activatedAt: "2026-08-29T00:00:00.000Z",
  };
  return resolveRagContextSnapshot({
    expectedSiteStaticManifestDigest: staticManifestDigest,
    activePublicSiteRelease,
    publicSiteChangeEpoch: "epoch-1",
    pendingPublicSiteChangeCount: 0,
    pendingPublicSiteLogicalIds: [],
    documentIndexGeneration: "documents-generation-1",
    sourcePolicyVersion: "source-policy-v2",
    rolloutVersion: "legacy",
    resolvedAt: "2026-08-29T00:02:00.000Z",
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

function createSharedCacheBuilder(payload: {
  answer: { routingReason: string; degradedMode?: { active: boolean; reason: string } };
}) {
  const sharedBuilder = {
    select: () => sharedBuilder,
    eq: () => sharedBuilder,
    is: () => sharedBuilder,
    in: () => sharedBuilder,
    gt: () => sharedBuilder,
    order: () => sharedBuilder,
    limit: () => sharedBuilder,
    maybeSingle: async () => ({ data: { payload }, error: null }),
    then: (resolve: (value: { data: unknown; error: null }) => unknown) =>
      Promise.resolve({ data: null, error: null }).then(resolve),
  };

  let deletionCalls = 0;
  const deleteBuilder = {
    eq: () => deleteBuilder,
    is: () => deleteBuilder,
    in: () => deleteBuilder,
    then: (resolve: (value: { data: unknown; error: null }) => unknown) => {
      deletionCalls += 1;
      return Promise.resolve({ data: null, error: null }).then(resolve);
    },
  };

  return {
    builder: {
      select: () => sharedBuilder,
      delete: () => deleteBuilder,
      eq: () => sharedBuilder,
      is: () => sharedBuilder,
      in: () => sharedBuilder,
      gt: () => sharedBuilder,
      order: () => sharedBuilder,
      limit: () => sharedBuilder,
      then: (resolve: (value: { data: unknown[]; error: null }) => unknown, reject?: (reason: unknown) => unknown) => {
        return Promise.resolve({
          data: [{ id: "doc-1", updated_at: "2026-07-14T00:00:00.000Z", metadata: {} }],
          error: null,
        }).then(resolve, reject);
      },
    },
    sharedBuilder,
    deleteBuilder,
    get deletionCalls() {
      return deletionCalls;
    },
  } as const;
}

describe("shared RAG search cache", () => {
  it("keeps the public snapshot fingerprint owner-neutral without sharing private owner cache scope", async () => {
    vi.resetModules();
    const selectorCalls: Array<Array<{ method: "eq" | "is"; column: string; value: unknown }>> = [];

    vi.doMock("@/lib/env", () => ({
      env: {
        RAG_SEARCH_CACHE_TTL_MS: 60_000,
        RAG_SEARCH_CACHE_SIZE: 200,
        RAG_PERSIST_RAW_QUERY_TEXT: false,
        RAG_QUERY_HASH_SECRET: "test-query-hash-secret",
        RAG_SEMANTIC_RERANK_ENABLED: false,
      },
      isDemoMode: () => false,
      isLocalNoAuthMode: () => false,
    }));
    vi.doMock("@/lib/deep-memory", () => ({ ragDeepMemoryVersion: "test-rag-version" }));
    vi.doMock("@/lib/clinical-search", () => ({
      buildClinicalTextSearchQuery: (query: string) => query.trim(),
    }));
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        rpc: async () => ({ data: "public-epoch-1", error: null }),
        from: (table: string) => {
          if (table === "documents") {
            const documents = {
              select: () => documents,
              eq: () => documents,
              is: () => documents,
              or: () => documents,
              in: () => documents,
              order: () => documents,
              limit: () => documents,
              then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
                Promise.resolve({
                  data: [{ id: "public-doc-1", updated_at: "2026-08-29T00:00:00.000Z", metadata: {} }],
                  error: null,
                }).then(resolve),
            };
            return documents;
          }
          expect(table).toBe("rag_response_cache");
          const calls: Array<{ method: "eq" | "is"; column: string; value: unknown }> = [];
          selectorCalls.push(calls);
          const builder = {
            select: () => builder,
            eq: (column: string, value: unknown) => {
              calls.push({ method: "eq" as const, column, value });
              return builder;
            },
            is: (column: string, value: unknown) => {
              calls.push({ method: "is" as const, column, value });
              return builder;
            },
            gt: () => builder,
            limit: () => builder,
            maybeSingle: async () => ({ data: null, error: null }),
          };
          return builder;
        },
      }),
    }));

    const { getSharedCachedSearch } = await import("../src/lib/rag/rag-cache");
    const anonymousSnapshot = publicContextSnapshot();
    const authenticatedSnapshot = publicContextSnapshot();
    expect(ragContextSnapshotCacheKey(authenticatedSnapshot)).toBe(ragContextSnapshotCacheKey(anonymousSnapshot));
    const sharedPublicRequest = {
      query: "lithium monitoring",
      accessScope: { includePublic: true as const },
      ragContextSnapshot: anonymousSnapshot,
    };
    await expect(getSharedCachedSearch(sharedPublicRequest)).resolves.toEqual({
      kind: "miss",
      reason: "unknown_filter_miss",
    });
    await expect(
      getSharedCachedSearch({
        ...sharedPublicRequest,
        ownerId,
        accessScope: { ownerId, includePublic: true as const },
        ragContextSnapshot: authenticatedSnapshot,
      }),
    ).resolves.toEqual({ kind: "miss", reason: "unknown_filter_miss" });

    expect(selectorCalls).toHaveLength(2);
    const anonymousSelector = selectorCalls[0]!;
    const authenticatedSelector = selectorCalls[1]!;
    expect(anonymousSelector).toContainEqual({ method: "is", column: "owner_id", value: null });
    expect(anonymousSelector).not.toContainEqual({ method: "eq", column: "owner_id", value: ownerId });
    expect(authenticatedSelector).toContainEqual({ method: "eq", column: "owner_id", value: ownerId });
    expect(authenticatedSelector).not.toContainEqual({ method: "is", column: "owner_id", value: null });

    const selectorValue = (calls: (typeof selectorCalls)[number], column: string) =>
      calls.find((call) => call.column === column)?.value;
    expect(selectorValue(anonymousSelector, "scope_key")).toBe("public-only|all-documents");
    expect(selectorValue(authenticatedSelector, "scope_key")).toBe(`owner:${ownerId}+public|all-documents`);
    expect(selectorValue(authenticatedSelector, "scope_key")).not.toBe(selectorValue(anonymousSelector, "scope_key"));
  });

  it("uses one shared-cache read for a cold filtered miss", async () => {
    vi.resetModules();
    let sharedCacheReads = 0;

    vi.doMock("@/lib/env", () => ({
      env: {
        RAG_SEARCH_CACHE_TTL_MS: 60_000,
        RAG_SEARCH_CACHE_SIZE: 200,
        RAG_PERSIST_RAW_QUERY_TEXT: false,
        RAG_QUERY_HASH_SECRET: "test-query-hash-secret",
      },
      isDemoMode: () => false,
      isLocalNoAuthMode: () => false,
    }));
    vi.doMock("@/lib/deep-memory", () => ({ ragDeepMemoryVersion: "test-rag-version" }));
    vi.doMock("@/lib/clinical-search", () => ({
      buildClinicalTextSearchQuery: (query: string) => query.trim(),
    }));
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        rpc: async () => ({ data: "public-epoch-1", error: null }),
        from: (table: string) => {
          const builder = {
            select: () => builder,
            eq: () => builder,
            is: () => builder,
            in: () => builder,
            or: () => builder,
            gt: () => builder,
            order: () => builder,
            limit: () => builder,
            maybeSingle: async () => {
              expect(table).toBe("rag_response_cache");
              sharedCacheReads += 1;
              return { data: null, error: null };
            },
            then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
              Promise.resolve({
                data:
                  table === "documents" ? [{ id: "doc-1", updated_at: "2026-07-14T00:00:00.000Z", metadata: {} }] : [],
                error: null,
              }).then(resolve),
          };
          return builder;
        },
      }),
    }));

    const { getSharedCachedSearch } = await import("../src/lib/rag/rag-cache");
    const result = await getSharedCachedSearch({
      query: "lithium monitoring",
      ownerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });

    expect(result).toEqual({ kind: "miss", reason: "unknown_filter_miss" });
    expect(sharedCacheReads).toBe(1);
  });

  it("forwards corpus_grounding from the stored payload on a shared-cache hit", async () => {
    vi.resetModules();

    vi.doMock("@/lib/env", () => ({
      env: {
        RAG_SEARCH_CACHE_TTL_MS: 60_000,
        RAG_SEARCH_CACHE_SIZE: 200,
        RAG_PERSIST_RAW_QUERY_TEXT: false,
        RAG_QUERY_HASH_SECRET: "test-query-hash-secret",
      },
      isDemoMode: () => false,
      isLocalNoAuthMode: () => false,
    }));
    vi.doMock("@/lib/deep-memory", () => ({ ragDeepMemoryVersion: "test-rag-version" }));
    vi.doMock("@/lib/clinical-search", () => ({
      buildClinicalTextSearchQuery: (query: string) => query.trim(),
    }));
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        rpc: async () => ({ data: "public-epoch-1", error: null }),
        from: (table: string) => {
          const builder = {
            select: () => builder,
            eq: () => builder,
            is: () => builder,
            in: () => builder,
            or: () => builder,
            gt: () => builder,
            order: () => builder,
            limit: () => builder,
            maybeSingle: async () => {
              if (table !== "rag_response_cache") return { data: null, error: null };
              return {
                data: {
                  payload: {
                    results: [],
                    telemetry: { query_class: "unsupported_or_general", corpus_grounding: "in_corpus_topic" },
                  },
                },
                error: null,
              };
            },
            then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
              Promise.resolve({
                data:
                  table === "documents" ? [{ id: "doc-1", updated_at: "2026-07-14T00:00:00.000Z", metadata: {} }] : [],
                error: null,
              }).then(resolve),
          };
          return builder;
        },
      }),
    }));

    const { getSharedCachedSearch } = await import("../src/lib/rag/rag-cache");
    const result = await getSharedCachedSearch({
      query: "catatonia",
      ownerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });

    expect(result?.kind).toBe("hit");
    expect(result?.kind === "hit" && result.telemetry.corpus_grounding).toBe("in_corpus_topic");
  });

  it("does not serve generation-fallback answers from shared cache and removes them", async () => {
    vi.resetModules();
    const fallback = {
      answer: {
        routingReason: "clinical_fast_grounded_synthesis; generation_fallback",
        degradedMode: { active: true, reason: "generation_fallback" },
      },
    };
    const shared = createSharedCacheBuilder(fallback);

    vi.doMock("@/lib/env", () => ({
      env: {
        RAG_SEARCH_CACHE_TTL_MS: 60_000,
        RAG_SEARCH_CACHE_SIZE: 200,
        RAG_ANSWER_CACHE_TTL_MS: 60_000,
        RAG_ANSWER_CACHE_SIZE: 200,
        RAG_PERSIST_RAW_QUERY_TEXT: false,
        RAG_QUERY_HASH_SECRET: "test-query-hash-secret",
      },
      isDemoMode: () => false,
      isLocalNoAuthMode: () => false,
    }));
    vi.doMock("@/lib/deep-memory", () => ({ ragDeepMemoryVersion: "test-rag-version" }));
    vi.doMock("@/lib/clinical-search", () => ({
      buildClinicalTextSearchQuery: (query: string) => query.trim(),
    }));
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        rpc: async () => ({ data: "public-epoch-1", error: null }),
        from: (table: string) => {
          if (table === "rag_response_cache") return shared.builder;
          const documents = {
            select: () => documents,
            eq: () => documents,
            is: () => documents,
            or: () => documents,
            gt: () => documents,
            order: () => documents,
            limit: () => documents,
            then: (
              resolve: (value: { data: unknown[]; error: null }) => unknown,
              reject?: (reason: unknown) => unknown,
            ) =>
              Promise.resolve({
                data: [{ id: "doc-1", updated_at: "2026-07-14T00:00:00.000Z", metadata: {} }],
                error: null,
              }).then(resolve, reject),
            maybeSingle: async () => ({ data: null, error: null }),
          };
          return documents;
        },
      }),
    }));

    const { getSharedCachedAnswer } = await import("../src/lib/rag/rag-cache");
    const result = await getSharedCachedAnswer(
      {
        query: "clinical deterioration",
        ownerId,
        queryMode: "auto",
        forceEmbedding: false,
      },
      Date.now(),
    );

    expect(result).toBeNull();
    expect(shared.deletionCalls).toBe(1);
  });
});
