import { afterEach, describe, expect, it, vi } from "vitest";
import { mockRagScopeRevision } from "./rag-cache-test-revision";
import type { SearchTelemetry } from "../src/lib/rag/rag-contracts";
import type { RagAnswer } from "../src/lib/types";

const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ragVersion = "test-rag-version";

function indexingVersion(stamp: string) {
  return `${ragVersion}:${mockRagScopeRevision([{ id: "doc-1", metadata: { indexed_at: "unchanged-index", governance: stamp } }])}`;
}

function baseTelemetry(overrides: Partial<SearchTelemetry> = {}): SearchTelemetry {
  return {
    search_cache_hit: false,
    text_fast_path_latency_ms: 0,
    embedding_skipped: true,
    embedding_latency_ms: 0,
    embedding_cache_hit: false,
    supabase_rpc_latency_ms: 0,
    rerank_latency_ms: 0,
    ...overrides,
  };
}

type CacheHarness = ReturnType<typeof createCacheHarness>;

function createCacheHarness() {
  let documentStamp = "request-start";
  let revisionReads = 0;
  let clientCreations = 0;
  let advanceClockOnSecondClient = false;
  let rows: Array<Record<string, unknown>> = [];
  const sharedReadVersions: string[] = [];
  const inserts: Array<Record<string, unknown>> = [];

  function chain(table: string) {
    if (table !== "rag_response_cache") throw new Error(`Unexpected cache table: ${table}`);
    const filters = new Map<string, unknown>();
    let operation = "select";
    let inserted: Record<string, unknown> | undefined;
    const matches = (row: Record<string, unknown>) =>
      [...filters].every(([key, value]) =>
        key === "expires_at"
          ? String(row[key]) > String(value)
          : Array.isArray(value)
            ? value.includes(row[key])
            : row[key] === value,
      );
    const builder = {
      select: () => builder,
      delete: () => {
        operation = "delete";
        return builder;
      },
      insert: (row: Record<string, unknown>) => {
        operation = "insert";
        inserted = structuredClone(row);
        return builder;
      },
      eq: (column: string, value: unknown) => {
        filters.set(column, value);
        return builder;
      },
      is: (column: string, value: unknown) => {
        filters.set(column, value);
        return builder;
      },
      in: (column: string, value: unknown) => {
        filters.set(column, value);
        return builder;
      },
      gt: (column: string, value: unknown) => {
        filters.set(column, value);
        return builder;
      },
      order: () => builder,
      limit: () => builder,
      maybeSingle: async () => {
        sharedReadVersions.push(String(filters.get("indexing_version")));
        const row = rows.find(matches);
        return { data: row ? { payload: structuredClone(row.payload) } : null, error: null };
      },
      then: (resolve: (value: { data: null; error: null }) => unknown, reject?: (reason: unknown) => unknown) => {
        if (operation === "delete") rows = rows.filter((row) => !matches(row));
        if (operation === "insert") {
          rows.push(inserted!);
          inserts.push(inserted!);
        }
        return Promise.resolve({ data: null, error: null }).then(resolve, reject);
      },
    };
    return builder;
  }

  const createAdminClient = vi.fn(() => {
    clientCreations += 1;
    if (advanceClockOnSecondClient && clientCreations === 2) vi.setSystemTime(new Date(Date.now() + 6_000));
    return {
      rpc: vi.fn(async (name: string) => {
        if (name !== "rag_cache_scope_revision_v1") throw new Error(`Unexpected cache RPC: ${name}`);
        revisionReads += 1;
        return { data: indexingVersion(documentStamp).slice(ragVersion.length + 1), error: null };
      }),
      from: chain,
    };
  });

  return {
    createAdminClient,
    get revisionReads() {
      return revisionReads;
    },
    get sharedReadVersions() {
      return sharedReadVersions;
    },
    get inserts() {
      return inserts;
    },
    setDocumentStamp(stamp: string) {
      documentStamp = stamp;
    },
    resetReads() {
      revisionReads = 0;
      sharedReadVersions.length = 0;
    },
    advanceClockBeforeSharedWrite() {
      advanceClockOnSecondClient = true;
    },
  };
}

async function loadCache(harness: CacheHarness) {
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
  vi.doMock("@/lib/deep-memory", () => ({ ragDeepMemoryVersion: ragVersion }));
  vi.doMock("@/lib/clinical-search", () => ({
    buildClinicalTextSearchQuery: (query: string) => query.trim(),
  }));
  vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: harness.createAdminClient }));
  return import("../src/lib/rag/rag-cache");
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetModules();
  vi.unstubAllEnvs();
});

describe("governed corpus latency shape", () => {
  it("uses one primary RPC for one variant instead of one RPC per corpus", async () => {
    const rpc = vi.fn(async () => ({ data: [], error: null }));
    const { searchGovernedCorpora } = await import("../src/lib/rag/rag-candidate-sources");
    await searchGovernedCorpora({
      supabase: { rpc } as never,
      queryVariants: ["clozapine monitoring"],
      matchCount: 12,
      snapshot: {
        version: "rag-context-snapshot-v1",
        resolvedAt: "2026-08-30T00:00:00.000Z",
        documentIndexGeneration: "generation-1",
        sourcePolicyVersion: "source-policy-v1",
        rolloutVersion: "rollout-v1",
        siteContentRegistryVersion: null,
        publicSiteContent: {
          releaseId: null,
          staticManifestDigest: null,
          dynamicStateDigest: null,
          releaseDigest: null,
          changeEpoch: null,
          state: "unavailable",
        },
      },
      components: { siteContent: false, australianAugmentation: true, australianCurrent: true },
      targetSiteDomains: [],
      internationalCoverageGap: false,
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "match_document_chunks_text_v3",
      expect.objectContaining({ corpus_scopes: ["uploaded_local", "australian_public"] }),
    );
  });
});

describe("RAG cache request indexing version", () => {
  it("brackets real shared hits with fresh revisions and refuses a stale request-start hint", async () => {
    const harness = createCacheHarness();
    const cache = await loadCache(harness);
    const requestVersion = indexingVersion("request-start");
    const args = { query: "lithium monitoring", ownerId };
    await cache.setCachedAnswer(
      args,
      { answer: "Current cached evidence", grounded: false, confidence: "unsupported", citations: [], sources: [] },
      { indexingVersionAtRetrievalStart: requestVersion },
    );
    await cache.setCachedSearch(args, [], baseTelemetry({ query_class: "medication_dose_risk" }), [], {
      indexingVersionAtRetrievalStart: requestVersion,
    });
    await vi.waitFor(() => expect(harness.inserts).toHaveLength(2));
    harness.resetReads();

    expect(
      (await cache.getSharedCachedAnswer(args, Date.now(), { indexingVersionAtRequestStart: requestVersion }))?.answer,
    ).toBe("Current cached evidence");
    expect(
      await cache.getSharedCachedSearch(args, "medication_dose_risk", [], {
        indexingVersionAtRequestStart: requestVersion,
      }),
    ).toMatchObject({ kind: "hit" });
    expect(harness.revisionReads).toBe(4);
    expect(harness.sharedReadVersions).toEqual([requestVersion, requestVersion]);

    // Governance changes while indexed_at remains fixed. A caller's old hint may not bypass the read fence.
    harness.setDocumentStamp("reviewed-after-request-start");
    expect(
      await cache.getSharedCachedAnswer(args, Date.now(), { indexingVersionAtRequestStart: requestVersion }),
    ).toBeNull();
    expect(
      await cache.getSharedCachedSearch(args, "medication_dose_risk", [], {
        indexingVersionAtRequestStart: requestVersion,
      }),
    ).toMatchObject({ kind: "miss" });
    expect(harness.revisionReads).toBe(6);
    expect(harness.sharedReadVersions).toEqual([requestVersion, requestVersion]);
  });

  it("refreshes a local search hit and rejects it when governance changes after request start", async () => {
    const harness = createCacheHarness();
    const cache = await loadCache(harness);
    const args = { query: "lithium monitoring", ownerId };
    const requestVersion = indexingVersion("request-start");
    await cache.setCachedSearch(args, [], baseTelemetry({ query_class: "medication_dose_risk" }), [], {
      indexingVersionAtRetrievalStart: requestVersion,
    });
    expect(
      (await cache.getCachedSearch(args, "medication_dose_risk", [], { indexingVersionAtRequestStart: requestVersion }))
        ?.telemetry.search_cache_hit,
    ).toBe(true);
    expect(harness.revisionReads).toBe(2);
    harness.setDocumentStamp("reviewed-after-request-start");
    expect(
      await cache.getCachedSearch(args, "medication_dose_risk", [], { indexingVersionAtRequestStart: requestVersion }),
    ).toBeNull();
    expect(harness.revisionReads).toBe(3);
  });

  it("keeps one authoritative write refresh, rejects changed governance, and persists that exact revision", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T00:00:00.000Z"));
    const harness = createCacheHarness();
    harness.setDocumentStamp("changed");
    const cache = await loadCache(harness);
    const args = { query: "lithium monitoring", ownerId };
    await cache.setCachedSearch(args, [], baseTelemetry({ query_class: "medication_dose_risk" }), [], {
      indexingVersionAtRetrievalStart: indexingVersion("request-start"),
    });
    await Promise.resolve();
    expect(harness.revisionReads).toBe(1);
    expect(harness.inserts).toHaveLength(0);

    vi.resetModules();
    const matchingHarness = createCacheHarness();
    matchingHarness.advanceClockBeforeSharedWrite();
    const matchingCache = await loadCache(matchingHarness);
    await matchingCache.setCachedSearch(args, [], baseTelemetry({ query_class: "medication_dose_risk" }), [], {
      indexingVersionAtRetrievalStart: indexingVersion("request-start"),
    });
    await vi.waitFor(() => expect(matchingHarness.inserts).toHaveLength(1));
    expect(matchingHarness.revisionReads).toBe(1);
    expect(matchingHarness.inserts[0]?.indexing_version).toBe(indexingVersion("request-start"));
  });
});

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class EmptyQuery implements PromiseLike<{ data: unknown[]; error: null }> {
  select() {
    return this;
  }
  in() {
    return this;
  }
  eq() {
    return this;
  }
  is() {
    return this;
  }
  neq() {
    return this;
  }
  or() {
    return this;
  }
  order() {
    return this;
  }
  limit() {
    return Promise.resolve({ data: [], error: null });
  }
  then<TResult1 = { data: unknown[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: [], error: null }).then(onfulfilled, onrejected);
  }
}

async function loadSearchWithCacheOutcome(
  outcome: "cold" | "local" | "shared",
  bootstrap?: {
    version: Deferred<string>;
    classification: Deferred<{ verdict: "out_of_corpus" }>;
    aliases: Deferred<never[]>;
  },
) {
  vi.doUnmock("@/lib/env");
  vi.doUnmock("@/lib/deep-memory");
  vi.doUnmock("@/lib/clinical-search");
  const staleTelemetry = baseTelemetry({
    search_cache_hit: true,
    search_total_latency_ms: 99_999,
    retrieval_phase_latencies_ms: { stale_phase: 99_999 },
    retrieval_strategy: "search_cache",
  });
  const getCachedSearch = vi.fn(async () =>
    outcome === "local" ? { results: [], telemetry: { ...staleTelemetry } } : null,
  );
  const getSharedCachedSearch = vi.fn(async () =>
    outcome === "shared" ? { kind: "hit" as const, results: [], telemetry: { ...staleTelemetry } } : null,
  );
  let versionStarted = false;
  let aliasesStarted = false;
  let classificationStarted = false;
  const fetchEnabledRagAliases = vi.fn(() => {
    aliasesStarted = true;
    return bootstrap?.aliases.promise ?? Promise.resolve([]);
  });

  vi.doMock("@/lib/rag/rag-cache", async () => {
    const actual = await vi.importActual<typeof import("../src/lib/rag/rag-cache")>("@/lib/rag/rag-cache");
    return {
      ...actual,
      cacheIndexingVersion: vi.fn(() => {
        versionStarted = true;
        return bootstrap?.version.promise ?? Promise.resolve(indexingVersion("request-start"));
      }),
      getCachedSearch,
      getSharedCachedSearch,
      isSearchCacheEnabled: () => true,
      setCachedSearch: vi.fn(async () => undefined),
    };
  });
  vi.doMock("@/lib/rag/rag-retrieval-variants", async () => {
    const actual = await vi.importActual<typeof import("../src/lib/rag/rag-retrieval-variants")>(
      "@/lib/rag/rag-retrieval-variants",
    );
    return {
      ...actual,
      fetchEnabledRagAliases,
    };
  });
  vi.doMock("@/lib/corpus-grounding", () => ({
    classifyCorpusGrounding: vi.fn(() => {
      classificationStarted = true;
      return bootstrap?.classification.promise ?? Promise.resolve({ verdict: "out_of_corpus" });
    }),
  }));
  vi.doMock("@/lib/rag/rag-provider", () => ({
    isSourceOnlyMode: () => true,
    allowsAutoDegrade: () => true,
    sourceOnlyReason: () => "source_only",
    classifyProviderFailure: () => "provider_failure",
    SOURCE_ONLY_EMBEDDING_SKIP_REASON: "source_only",
  }));
  vi.doMock("@/lib/supabase/admin", () => ({
    createAdminClient: () => ({
      rpc: vi.fn(async () => ({ data: [], error: null })),
      from: vi.fn(() => new EmptyQuery()),
    }),
  }));
  vi.stubEnv("RAG_SEARCH_CACHE_TTL_MS", "60000");
  vi.stubEnv("RAG_SEARCH_CACHE_SIZE", "200");
  vi.stubEnv("OPENAI_API_KEY", "");

  const { searchChunksWithTelemetry } = await import("../src/lib/rag/rag");
  return {
    searchChunksWithTelemetry,
    get started() {
      return { versionStarted, aliasesStarted, classificationStarted };
    },
    fetchEnabledRagAliases,
  };
}

describe("RAG search bootstrap and latency telemetry", () => {
  it("starts indexing-version, query-classification, and alias bootstrap work concurrently", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T00:00:00.000Z"));
    const bootstrap = {
      version: deferred<string>(),
      classification: deferred<{ verdict: "out_of_corpus" }>(),
      aliases: deferred<never[]>(),
    };
    const loaded = await loadSearchWithCacheOutcome("cold", bootstrap);
    const controller = new AbortController();

    const pending = loaded.searchChunksWithTelemetry({
      query: "bipolar disorder",
      ownerId,
      lexicalOnly: true,
      signal: controller.signal,
    });
    await Promise.resolve();

    expect(loaded.started).toEqual({
      versionStarted: true,
      aliasesStarted: true,
      classificationStarted: true,
    });
    expect(loaded.fetchEnabledRagAliases).toHaveBeenCalledWith(
      expect.anything(),
      ownerId,
      expect.objectContaining({ ownerId, includePublic: true }),
      controller.signal,
    );

    vi.setSystemTime(new Date("2026-07-14T00:00:00.100Z"));
    bootstrap.version.resolve(indexingVersion("request-start"));
    bootstrap.classification.resolve({ verdict: "out_of_corpus" });
    bootstrap.aliases.resolve([]);
    const result = await pending;

    expect(result.telemetry.retrieval_phase_latencies_ms).toMatchObject({
      index_version: 100,
      query_classification: 100,
      alias_load: 100,
    });
    expect(result.telemetry.search_total_latency_ms).toBe(100);
    expect(result.telemetry.search_total_latency_ms).toBeLessThan(
      Object.values(result.telemetry.retrieval_phase_latencies_ms ?? {}).reduce((sum, value) => sum + value, 0),
    );
  });

  it.each(["cold", "local", "shared"] as const)(
    "records current phase and total telemetry for the %s path",
    async (outcome) => {
      const loaded = await loadSearchWithCacheOutcome(outcome);
      const result = await loaded.searchChunksWithTelemetry({
        query: outcome === "cold" ? "bipolar disorder" : "clozapine monitoring",
        ownerId,
        lexicalOnly: true,
      });

      expect(result.telemetry.search_total_latency_ms).toEqual(expect.any(Number));
      expect(result.telemetry.search_total_latency_ms).not.toBe(99_999);
      expect(result.telemetry.retrieval_phase_latencies_ms).toEqual(
        expect.objectContaining({
          index_version: expect.any(Number),
          query_classification: expect.any(Number),
          alias_load: expect.any(Number),
          local_cache_lookup: expect.any(Number),
        }),
      );
      expect(result.telemetry.retrieval_phase_latencies_ms).not.toHaveProperty("stale_phase");
      if (outcome !== "local") {
        expect(result.telemetry.retrieval_phase_latencies_ms).toHaveProperty("shared_cache_lookup");
      }
    },
  );
});

type OrchestrationEvent =
  | { kind: "index_version"; value: string }
  | { kind: "shared_read"; cacheKind: string; indexingVersion: string }
  | { kind: "shared_write"; cacheKind: string; indexingVersion: string };

function createOrchestrationHarness() {
  let documentStamp = "stale";
  let events: OrchestrationEvent[] = [];

  class Query implements PromiseLike<{ data: unknown[]; error: null }> {
    private readonly filters = new Map<string, unknown>();

    constructor(private readonly table: string) {}

    select() {
      return this;
    }
    delete() {
      return this;
    }
    eq(column: string, value: unknown) {
      this.filters.set(column, value);
      return this;
    }
    is(column: string, value: unknown) {
      this.filters.set(column, value);
      return this;
    }
    in() {
      return this;
    }
    abortSignal() {
      return this;
    }
    or() {
      return this;
    }
    gt() {
      return this;
    }
    neq() {
      return this;
    }
    order() {
      return this;
    }
    limit() {
      return this;
    }
    async maybeSingle() {
      events.push({
        kind: "shared_read",
        cacheKind: String(this.filters.get("cache_kind")),
        indexingVersion: String(this.filters.get("indexing_version")),
      });
      return { data: null, error: null };
    }
    then<TResult1 = { data: unknown[]; error: null }, TResult2 = never>(
      onfulfilled?: ((value: { data: unknown[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): PromiseLike<TResult1 | TResult2> {
      if (this.table === "documents") {
        return Promise.resolve({
          data: [{ id: "doc-1", updated_at: documentStamp, metadata: {} }],
          error: null,
        }).then(onfulfilled, onrejected);
      }
      return Promise.resolve({ data: [], error: null }).then(onfulfilled, onrejected);
    }
  }

  return {
    createAdminClient: () => ({
      rpc: vi.fn((name: string) => {
        let data: string | unknown[] = [];
        if (name === "rag_cache_scope_revision_v1") {
          events.push({ kind: "index_version", value: documentStamp });
          data = mockRagScopeRevision([
            { id: "doc-1", metadata: { indexed_at: "unchanged-index", governance: documentStamp } },
          ]);
        }
        const query = Promise.resolve({ data, error: null });
        return Object.assign(query, { abortSignal: () => query });
      }),
      from: (table: string) =>
        Object.assign(new Query(table), {
          insert: async (row: Record<string, unknown>) => {
            events.push({
              kind: "shared_write",
              cacheKind: String(row.cache_kind),
              indexingVersion: String(row.indexing_version),
            });
            return { data: null, error: null };
          },
        }),
    }),
    get events() {
      return events;
    },
    setDocumentStamp(stamp: string) {
      documentStamp = stamp;
    },
    clearEvents() {
      events = [];
    },
  };
}

describe("answer-to-search cache request context", () => {
  it("shares request-start identity while refreshing every real answer and nested-search read fence", async () => {
    vi.doUnmock("@/lib/env");
    vi.doUnmock("@/lib/deep-memory");
    vi.doUnmock("@/lib/clinical-search");
    vi.doUnmock("@/lib/rag/rag-cache");
    vi.doUnmock("@/lib/rag/rag-retrieval-variants");
    vi.doUnmock("@/lib/corpus-grounding");
    vi.doUnmock("@/lib/rag/rag-provider");
    vi.stubEnv("RAG_PROVIDER_MODE", "offline");
    vi.stubEnv("RAG_SEARCH_CACHE_TTL_MS", "60000");
    vi.stubEnv("RAG_SEARCH_CACHE_SIZE", "200");
    vi.stubEnv("RAG_ANSWER_CACHE_TTL_MS", "60000");
    vi.stubEnv("RAG_ANSWER_CACHE_SIZE", "200");
    vi.stubEnv("OPENAI_API_KEY", "");

    const harness = createOrchestrationHarness();
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: harness.createAdminClient }));

    const rag = await import("../src/lib/rag/rag");
    const cache = await import("../src/lib/rag/rag-cache");
    const { withRagProgrammeRollout } = await import("../src/lib/rag/rag-rollout");
    const { analyzeClinicalQuery } = await import("../src/lib/clinical-search");
    const { buildRetrievalQueryVariants } = await import("../src/lib/rag/rag-retrieval-variants");
    const args = withRagProgrammeRollout({ query: "coffee machine policy", ownerId, logQuery: false });

    // Prime stale process-local answer and search entries. The orchestration request below
    // must reject both local entries and continue through both shared reads. Request-start
    // identity is shared, while each hit/lookup and in-flight admission reads its own fresh fence.
    const searchArgs = { ...args, topK: 12, minSimilarity: 0.12 };
    const prime = await rag.searchChunksWithTelemetry(searchArgs);
    // Empty source-only retrieval does not populate the search cache. Seed its exact
    // production identity explicitly and prove the actual consumer can hit it first.
    const variants = buildRetrievalQueryVariants(args.query, analyzeClinicalQuery(args.query));
    await cache.setCachedSearch(searchArgs, prime.results, prime.telemetry, variants);
    const primed = await rag.searchChunksWithTelemetry(searchArgs);
    expect(primed.telemetry.search_cache_hit).toBe(true);
    await cache.setCachedAnswer(args, {
      answer: "Stale fixture",
      grounded: false,
      confidence: "unsupported",
      citations: [],
      sources: [],
    } satisfies RagAnswer);
    expect((await cache.getCachedAnswer(args, Date.now()))?.answer).toBe("Stale fixture");
    await vi.waitFor(() =>
      expect(harness.events.some((event) => event.kind === "shared_write" && event.cacheKind === "search")).toBe(true),
    );

    harness.setDocumentStamp("request-start");
    harness.clearEvents();

    const answer = await rag.answerQuestionWithScope(args);
    await vi.waitFor(() =>
      expect(harness.events.filter((event) => event.kind === "shared_read").map((event) => event.cacheKind)).toEqual([
        "answer",
        "search",
      ]),
    );

    const sharedReads = harness.events.filter(
      (event): event is Extract<OrchestrationEvent, { kind: "shared_read" }> => event.kind === "shared_read",
    );
    const requestVersion = sharedReads[0]?.indexingVersion;
    const searchReadIndex = harness.events.findIndex(
      (event) => event.kind === "shared_read" && event.cacheKind === "search",
    );
    const versionsResolvedBeforeNestedSearch = harness.events
      .slice(0, searchReadIndex)
      .filter((event) => event.kind === "index_version");

    expect(answer.routingReason).not.toContain("cache_hit");
    expect(sharedReads.map((event) => event.indexingVersion)).toEqual([requestVersion, requestVersion]);
    expect(requestVersion).toMatch(/:rag-cache-scope-v1:[0-9a-f]{32}$/);
    // In-flight admission, request start, local-answer, shared-answer, local-search, shared-search.
    expect(versionsResolvedBeforeNestedSearch).toEqual(
      Array.from({ length: 6 }, () => ({ kind: "index_version", value: "request-start" })),
    );
  });
});
