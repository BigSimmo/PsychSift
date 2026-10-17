import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchTelemetry } from "../src/lib/rag/rag-contracts";

const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

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
  it("P09 shadow answer reads and writes cannot reuse or populate a legacy row", async () => {
    const from = vi.fn(() => {
      throw new Error("shadow must not access answer cache");
    });
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from }) }));
    const cache = await import("../src/lib/rag/rag-cache");
    const args = { query: "What is clozapine?", ownerId, ragQueryPlanMode: "shadow" as const };
    const answer = {
      answer: "candidate poison",
      grounded: false,
      confidence: "unsupported" as const,
      citations: [],
      sources: [],
    };
    expect(cache.answerCoalescingAllowedForRequest(args)).toBe(false);
    expect(cache.answerCacheLookupAllowedForRequest(args, false)).toBe(false);
    expect(await cache.getCachedAnswer(args, Date.now())).toBeNull();
    expect(await cache.getSharedCachedAnswer(args, Date.now())).toBeNull();
    await cache.setCachedAnswer(args, answer);
    expect(from).not.toHaveBeenCalled();
  });
  it("sanitizes query-plan diagnostics before local and shared cache writes", async () => {
    vi.resetModules();
    const insertedRows: Array<{ payload?: unknown }> = [];
    const documentBuilder = {
      select: () => documentBuilder,
      eq: () => documentBuilder,
      is: () => documentBuilder,
      or: () => documentBuilder,
      in: () => documentBuilder,
      order: () => documentBuilder,
      limit: () => documentBuilder,
      abortSignal: () => documentBuilder,
      then: (resolve: (value: { data: unknown[]; error: null }) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve({
          data: [{ id: "document-1", updated_at: "2026-08-30T00:00:00.000Z", metadata: {} }],
          error: null,
        }).then(resolve, reject),
    };
    const responseBuilder = {
      delete: () => responseBuilder,
      insert: (value: { payload?: unknown }) => {
        insertedRows.push(value);
        return Promise.resolve({ data: null, error: null });
      },
      eq: () => responseBuilder,
      is: () => responseBuilder,
      in: () => responseBuilder,
      abortSignal: () => responseBuilder,
      then: (resolve: (value: { data: null; error: null }) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(resolve, reject),
    };
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
    vi.doMock("@/lib/clinical-search", () => ({ buildClinicalTextSearchQuery: (query: string) => query.trim() }));
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from: (table: string) => (table === "documents" ? documentBuilder : responseBuilder),
      }),
    }));

    const { getCachedSearch, setCachedSearch } = await import("../src/lib/rag/rag-cache");
    const args = {
      query: "cache diagnostic boundary",
      ownerId,
      accessScope: { ownerId, includePublic: true as const },
    };
    const unsafeTelemetry = {
      search_cache_hit: false,
      text_fast_path_latency_ms: 0,
      embedding_skipped: true,
      embedding_latency_ms: 0,
      embedding_cache_hit: false,
      supabase_rpc_latency_ms: 0,
      rerank_latency_ms: 0,
      query_plan_kind: "patient-name-canary",
      subquestion_count: -1,
      query_plan_reason_codes: ["patient-name-canary"],
      candidate_retrieval_query_variant_count: 99,
      candidate_match_counts: { matched: 1, partial_match: 0, absent: 3 },
    } as unknown as SearchTelemetry;

    await setCachedSearch(args, [], unsafeTelemetry);
    await vi.waitFor(() => expect(insertedRows).toHaveLength(1));
    const localHit = await getCachedSearch(args);

    expect(localHit).not.toBeNull();
    expect(localHit?.telemetry.query_plan_kind).toBeUndefined();
    expect(localHit?.telemetry.subquestion_count).toBeUndefined();
    expect(localHit?.telemetry.query_plan_reason_codes).toEqual([]);
    expect(localHit?.telemetry.candidate_retrieval_query_variant_count).toBeUndefined();
    expect(localHit?.telemetry.candidate_match_counts).toBeUndefined();
    expect(JSON.stringify(localHit?.telemetry)).not.toContain("patient-name-canary");
    expect(JSON.stringify(insertedRows[0]?.payload)).not.toContain("patient-name-canary");
    expect(insertedRows[0]?.payload).toMatchObject({
      telemetry: { query_plan_reason_codes: [] },
    });
    expect(insertedRows[0]?.payload).not.toHaveProperty("telemetry.candidate_match_counts");
  });

  it("replaces authenticated site-aware search rows under the null owner on every write", async () => {
    vi.resetModules();
    const deleteOwnerSelectors: Array<Array<{ method: "eq" | "is"; value: unknown }>> = [];
    const insertedOwnerIds: unknown[] = [];
    const documentBuilder = {
      select: () => documentBuilder,
      eq: () => documentBuilder,
      is: () => documentBuilder,
      or: () => documentBuilder,
      in: () => documentBuilder,
      order: () => documentBuilder,
      limit: () => documentBuilder,
      then: (resolve: (value: { data: unknown[]; error: null }) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve({
          data: [{ id: "document-1", updated_at: "2026-08-29T00:00:00.000Z", metadata: {} }],
          error: null,
        }).then(resolve, reject),
    };
    const responseBuilder = {
      delete: () => {
        const ownerSelectors: Array<{ method: "eq" | "is"; value: unknown }> = [];
        const deleteBuilder = {
          eq: (column: string, value: unknown) => {
            if (column === "owner_id") ownerSelectors.push({ method: "eq", value });
            return deleteBuilder;
          },
          is: (column: string, value: unknown) => {
            if (column === "owner_id") ownerSelectors.push({ method: "is", value });
            return deleteBuilder;
          },
          then: (resolve: (value: { data: null; error: null }) => unknown, reject?: (reason: unknown) => unknown) => {
            deleteOwnerSelectors.push(ownerSelectors);
            return Promise.resolve({ data: null, error: null }).then(resolve, reject);
          },
        };
        return deleteBuilder;
      },
      insert: (value: { owner_id?: unknown }) => {
        insertedOwnerIds.push(value.owner_id);
        return Promise.resolve({ data: null, error: null });
      },
    };
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
    vi.doMock("@/lib/clinical-search", () => ({ buildClinicalTextSearchQuery: (query: string) => query.trim() }));
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from: (table: string) => (table === "documents" ? documentBuilder : responseBuilder),
      }),
    }));

    const { withRagRequestContext } = await import("../src/lib/rag/rag-context-snapshot");
    const { createRagPublicCacheWriteProof, setCachedSearch } = await import("../src/lib/rag/rag-cache");
    const request = withRagRequestContext({
      query: "public monitoring",
      ownerId,
      accessScope: { includePublic: true as const },
      ragContextSnapshotInput: {
        expectedSiteStaticManifestDigest: "a".repeat(64),
        activePublicSiteRelease: {
          version: "clinical-kb-site-release-v1" as const,
          releaseId: "11111111-1111-5111-8111-111111111111",
          registryVersion: "site-content-registry-v1",
          staticManifestDigest: "a".repeat(64),
          dynamicStateDigest: "b".repeat(64),
          releaseDigest: "c".repeat(64),
          state: "active" as const,
          activatedAt: "2026-08-29T00:00:00.000Z",
        },
        publicSiteChangeEpoch: "1",
        pendingPublicSiteChangeCount: 0,
        documentIndexGeneration: "generation-v1",
        sourcePolicyVersion: "source-policy-v1",
        rolloutVersion: "rollout-v1",
      },
    });
    const result = {
      id: "chunk-1",
      document_id: "document-1",
      title: "Public source",
      file_name: "public-source.pdf",
      page_number: 1,
      chunk_index: 0,
      section_heading: null,
      content: "Bounded public evidence.",
      image_ids: [],
      images: [],
      similarity: 0.9,
    };
    const proof = createRagPublicCacheWriteProof({
      cacheKind: "search",
      requestContext: request.ragRequestContext,
      accessScope: request.accessScope,
      selectedEvidence: [result],
      allSelectedEvidencePublic: true,
      pendingExclusion: "not_required",
    });
    const telemetry = {
      search_cache_hit: false,
      text_fast_path_latency_ms: 0,
      embedding_skipped: true,
      embedding_latency_ms: 0,
      embedding_cache_hit: false,
      supabase_rpc_latency_ms: 0,
      rerank_latency_ms: 0,
      query_class: "table_threshold" as const,
    };

    await setCachedSearch(request, [result], telemetry, [], { publicCacheWriteProof: proof });
    await vi.waitFor(() => expect(insertedOwnerIds).toHaveLength(1));
    await setCachedSearch(request, [result], telemetry, [], { publicCacheWriteProof: proof });
    await vi.waitFor(() => expect(insertedOwnerIds).toHaveLength(2));

    expect(deleteOwnerSelectors).toEqual([[{ method: "is", value: null }], [{ method: "is", value: null }]]);
    expect(insertedOwnerIds).toEqual([null, null]);
  });

  it("shares site-aware search rows by snapshot while retaining exact answer owner selectors", async () => {
    vi.resetModules();
    const selectors: Array<{ method: "eq" | "is"; column: string; value: unknown }> = [];
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        selectors.push({ method: "eq", column, value });
        return builder;
      },
      is: (column: string, value: unknown) => {
        selectors.push({ method: "is", column, value });
        return builder;
      },
      gt: () => builder,
      limit: () => builder,
      maybeSingle: async () => ({ data: null, error: null }),
    };
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
    vi.doMock("@/lib/clinical-search", () => ({ buildClinicalTextSearchQuery: (query: string) => query.trim() }));
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => builder }) }));

    const { withRagRequestContext } = await import("../src/lib/rag/rag-context-snapshot");
    const { getSharedCachedAnswer, getSharedCachedSearch } = await import("../src/lib/rag/rag-cache");
    const snapshotInput = {
      expectedSiteStaticManifestDigest: "a".repeat(64),
      activePublicSiteRelease: {
        version: "clinical-kb-site-release-v1" as const,
        releaseId: "11111111-1111-5111-8111-111111111111",
        registryVersion: "site-content-registry-v1",
        staticManifestDigest: "a".repeat(64),
        dynamicStateDigest: "b".repeat(64),
        releaseDigest: "c".repeat(64),
        state: "active" as const,
        activatedAt: "2026-08-29T00:00:00.000Z",
      },
      publicSiteChangeEpoch: "1",
      pendingPublicSiteChangeCount: 0,
      documentIndexGeneration: "generation-v1",
      sourcePolicyVersion: "source-policy-v1",
      rolloutVersion: "rollout-v1",
    };
    const request = withRagRequestContext({
      query: "public monitoring",
      ownerId,
      accessScope: { includePublic: true as const },
      ragContextSnapshotInput: snapshotInput,
    });

    await getSharedCachedSearch(request, "table_threshold", [], { indexingVersionAtRequestStart: "index-v1" });
    const firstSearchQuery = selectors.find(
      (selector) => selector.method === "eq" && selector.column === "normalized_query",
    )?.value;
    expect(selectors).toContainEqual({ method: "is", column: "owner_id", value: null });
    expect(selectors).not.toContainEqual({ method: "eq", column: "owner_id", value: ownerId });

    selectors.length = 0;
    await getSharedCachedAnswer(request, Date.now(), { indexingVersionAtRequestStart: "index-v1" });
    expect(selectors).toContainEqual({ method: "eq", column: "owner_id", value: ownerId });

    selectors.length = 0;
    const nextRequest = withRagRequestContext({
      query: request.query,
      ownerId: request.ownerId,
      accessScope: request.accessScope,
      ragContextSnapshotInput: { ...snapshotInput, publicSiteChangeEpoch: "2" },
    });
    await getSharedCachedSearch(nextRequest, "table_threshold", [], { indexingVersionAtRequestStart: "index-v1" });
    const nextSearchQuery = selectors.find(
      (selector) => selector.method === "eq" && selector.column === "normalized_query",
    )?.value;
    expect(nextSearchQuery).not.toBe(firstSearchQuery);
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

  it("drops non-canonical query-plan diagnostics from shared-cache hydration", async () => {
    vi.resetModules();
    const builder = {
      select: () => builder,
      eq: () => builder,
      is: () => builder,
      in: () => builder,
      or: () => builder,
      gt: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: async () => ({
        data: {
          payload: {
            results: [],
            telemetry: {
              query_plan_kind: "decomposed",
              subquestion_count: 3,
              query_plan_reason_codes: ["broad_management_decomposition", "patient-name-canary"],
              candidate_retrieval_query_variant_count: 99,
            },
          },
        },
        error: null,
      }),
    };
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
    vi.doMock("@/lib/clinical-search", () => ({ buildClinicalTextSearchQuery: (query: string) => query.trim() }));
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => builder }) }));

    const { getSharedCachedSearch } = await import("../src/lib/rag/rag-cache");
    const result = await getSharedCachedSearch({ query: "lithium monitoring", ownerId }, undefined, [], {
      indexingVersionAtRequestStart: "index-v1",
    });

    expect(result?.kind).toBe("hit");
    if (result?.kind !== "hit") throw new Error("Expected a cache hit.");
    expect(result.telemetry).toMatchObject({
      query_plan_kind: "decomposed",
      subquestion_count: 3,
      query_plan_reason_codes: ["broad_management_decomposition"],
    });
    expect(result.telemetry.candidate_retrieval_query_variant_count).toBeUndefined();
    expect(JSON.stringify(result.telemetry)).not.toContain("patient-name-canary");
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
    const docBuilder = {
      select: () => docBuilder,
      eq: () => docBuilder,
      is: () => docBuilder,
      or: () => docBuilder,
      gt: () => docBuilder,
      order: () => docBuilder,
      limit: () => docBuilder,
      then: (resolve: (value: { data: unknown[]; error: null }) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve({
          data: [{ id: "doc-1", updated_at: "2026-07-14T00:00:00.000Z", metadata: {} }],
          error: null,
        }).then(resolve, reject),
      maybeSingle: async () => ({ data: null, error: null }),
    };
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from: (table: string) => {
          if (table === "rag_response_cache") return shared.builder;
          return docBuilder;
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

  it("fails closed on local and shared cache reads/writes when the indexing stamp is unavailable", async () => {
    vi.resetModules();
    let sharedCacheReads = 0;
    let sharedCacheWrites = 0;

    const failingDocBuilder = {
      select: () => failingDocBuilder,
      eq: () => failingDocBuilder,
      is: () => failingDocBuilder,
      or: () => failingDocBuilder,
      in: () => failingDocBuilder,
      order: () => failingDocBuilder,
      limit: () => failingDocBuilder,
      then: (resolve: (value: { data: unknown; error: { message: string } | null }) => unknown) =>
        Promise.resolve({ data: null, error: { message: "db_unavailable" } }).then(resolve),
    };
    const cacheTableBuilder = {
      select: () => cacheTableBuilder,
      delete: () => cacheTableBuilder,
      insert: () => {
        sharedCacheWrites += 1;
        return Promise.resolve({ data: null, error: null });
      },
      eq: () => cacheTableBuilder,
      is: () => cacheTableBuilder,
      gt: () => cacheTableBuilder,
      limit: () => cacheTableBuilder,
      maybeSingle: async () => {
        sharedCacheReads += 1;
        return {
          data: {
            payload: {
              results: [],
              telemetry: { query_class: "general_clinical_management" },
            },
          },
          error: null,
        };
      },
      then: (resolve: (value: { data: null; error: null }) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(resolve),
    };

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
        from: (table: string) => (table === "documents" ? failingDocBuilder : cacheTableBuilder),
      }),
    }));

    const {
      cacheIndexingVersion,
      getCachedAnswer,
      getCachedSearch,
      getSharedCachedAnswer,
      getSharedCachedSearch,
      setCachedAnswer,
      setCachedSearch,
    } = await import("../src/lib/rag/rag-cache");

    const args = { query: "lithium toxicity", ownerId };
    await setCachedSearch(args, [], {
      search_cache_hit: false,
      text_fast_path_latency_ms: 0,
      embedding_skipped: true,
      embedding_latency_ms: 0,
      embedding_cache_hit: false,
      supabase_rpc_latency_ms: 0,
      rerank_latency_ms: 0,
    });
    await setCachedAnswer(args, {
      answer: "Grounded answer.",
      grounded: true,
      confidence: "high",
      citations: [],
      sources: [],
    });

    expect(await getCachedSearch(args)).toBeNull();
    expect(await getCachedAnswer(args, Date.now())).toBeNull();
    expect(await getSharedCachedSearch(args)).toEqual({ kind: "miss", reason: "cache_lookup_error" });
    expect(await getSharedCachedAnswer(args, Date.now())).toBeNull();
    expect(sharedCacheReads).toBe(0);
    expect(sharedCacheWrites).toBe(0);

    // Now test that a valid local entry is NOT evicted when a transient DB stamp failure occurs,
    // and that cacheIndexingVersion does not cache the :unavailable stamp for 5s.
    let dbUnavailable = false;
    failingDocBuilder.then = (resolve: (value: { data: unknown; error: { message: string } | null }) => unknown) =>
      Promise.resolve(
        dbUnavailable
          ? { data: null, error: { message: "transient_db_error" } }
          : { data: [{ id: "doc-1", updated_at: "2026-08-30T00:00:00.000Z", metadata: {} }], error: null },
      ).then(resolve);

    await setCachedAnswer(args, {
      answer: "Recovered grounded answer.",
      grounded: true,
      confidence: "high",
      citations: [],
      sources: [],
    });
    dbUnavailable = true;
    const unavailableStamp = await cacheIndexingVersion(args, { forceRefresh: true });
    expect(unavailableStamp).toContain(":index-stamp-unavailable");
    expect(await getCachedAnswer(args, Date.now())).toBeNull();
    dbUnavailable = false;
    const hitAfterRecovery = await getCachedAnswer(args, Date.now());
    expect(hitAfterRecovery?.answer).toBe("Recovered grounded answer.");
  });
});
