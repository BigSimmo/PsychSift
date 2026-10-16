import { afterEach, describe, expect, it, vi } from "vitest";

// Finding #11 follow-up (handover 2026-08-06): the soft-tail unsupported short-circuit can be a
// false negative for genuinely in-corpus bare topics (e.g. "catatonia" is well represented in
// chunk content but no document is *titled* "Catatonia", so corpus grounding returns
// "inconclusive" rather than rescuing it, and the query falls through to the nondeterministic
// LLM classifier). Caching that zero made the false negative sticky for every later caller within
// the cache TTL. searchChunksWithTelemetry (src/lib/rag/rag.ts) must skip the cache write only for
// that specific soft-tail bucket, while still caching the three deterministic exclusion patterns
// (unavailable-document noise, clearly-outside-corpus terms, clearly-non-clinical consumer terms)
// that are stable true negatives.

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

async function loadSearch(
  corpusGroundingVerdict: "inconclusive" | "out_of_corpus" | "in_corpus_topic",
  options: { openAiApiKey?: string; sourceOnly?: boolean; correctionError?: boolean } = {},
) {
  const setCachedSearch = vi.fn(async () => undefined);

  vi.doMock("@/lib/rag/rag-cache", async () => {
    const actual = await vi.importActual<typeof import("../src/lib/rag/rag-cache")>("@/lib/rag/rag-cache");
    return {
      ...actual,
      cacheIndexingVersion: vi.fn(async () => "test-indexing-version"),
      getCachedSearch: vi.fn(async () => null),
      getSharedCachedSearch: vi.fn(async () => null),
      setCachedSearch,
    };
  });
  vi.doMock("@/lib/rag/rag-retrieval-variants", async () => {
    const actual = await vi.importActual<typeof import("../src/lib/rag/rag-retrieval-variants")>(
      "@/lib/rag/rag-retrieval-variants",
    );
    return {
      ...actual,
      fetchEnabledRagAliases: vi.fn(async () => []),
    };
  });
  vi.doMock("@/lib/corpus-grounding", () => ({
    classifyCorpusGrounding: vi.fn(async () => ({ verdict: corpusGroundingVerdict, anchorTerms: [], absentTerms: [] })),
  }));
  // A rejected classifier verdict — only reachable, and only mock-invoked, when the test opts
  // into a non-empty OPENAI_API_KEY below (Devin review: the classifier is unreachable at all
  // without a key, so that case must stay deterministic and cacheable).
  vi.doMock("@/lib/openai", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../src/lib/openai")>();
    return {
      ...actual,
      generateParsedTextResult: vi.fn(async () => ({
        parsed: { queryClass: "unsupported_or_general", confidence: 0.3, reasons: ["test"], expandedTerms: [] },
      })),
    };
  });
  vi.doMock("@/lib/rag/rag-provider", () => ({
    isSourceOnlyMode: () => options.sourceOnly ?? true,
    allowsAutoDegrade: () => true,
    sourceOnlyReason: () => "source_only",
    classifyProviderFailure: () => "provider_failure",
    SOURCE_ONLY_EMBEDDING_SKIP_REASON: "source_only",
  }));
  vi.doMock("@/lib/supabase/admin", () => ({
    createAdminClient: () => ({
      rpc: vi.fn((name: string) => {
        // The query-correction call is awaited after an optional abortSignal(), so it returns a
        // thenable builder. A timeout surfaces as an error with null data.
        const response =
          name === "correct_clinical_query_terms"
            ? options.correctionError
              ? { data: null, error: { message: "AbortError: signal timed out" } }
              : { data: null, error: null }
            : { data: [], error: null };
        const builder = Promise.resolve(response) as Promise<typeof response> & { abortSignal: () => unknown };
        builder.abortSignal = () => builder;
        return builder;
      }),
      from: vi.fn(() => new EmptyQuery()),
    }),
  }));
  vi.stubEnv("OPENAI_API_KEY", options.openAiApiKey ?? "");

  const { searchChunksWithTelemetry } = await import("../src/lib/rag/rag");
  return { searchChunksWithTelemetry, setCachedSearch };
}

const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("unsupported short-circuit cache write", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("does not cache a zero result for the soft-tail bucket when a classifier could have decided it (OPENAI_API_KEY set)", async () => {
    const { searchChunksWithTelemetry, setCachedSearch } = await loadSearch("inconclusive", {
      openAiApiKey: "test-key",
    });

    const result = await searchChunksWithTelemetry({
      query: "catatonia",
      ownerId,
      lexicalOnly: true,
    });

    expect(result.results).toEqual([]);
    expect(result.telemetry.retrieval_strategy).toBe("unsupported_short_circuit");
    expect(setCachedSearch).not.toHaveBeenCalled();
  }, 60_000);

  it("caches a soft-tail zero when no classifier was ever reachable (no OPENAI_API_KEY — deterministic)", async () => {
    // Devin review on PR #1646: without a key, analyzeQueryWithClassifierFallback returns before
    // any classifier call (rag.ts:1139), so the "inconclusive" corpus-grounding verdict is the
    // whole story — same query, same DB state, same empty result every time. Skipping the cache
    // write here bought nothing but repeat classifyCorpusGrounding + trigram-RPC cost.
    const { searchChunksWithTelemetry, setCachedSearch } = await loadSearch("inconclusive");

    const result = await searchChunksWithTelemetry({
      query: "catatonia",
      ownerId,
      lexicalOnly: true,
    });

    expect(result.results).toEqual([]);
    expect(result.telemetry.retrieval_strategy).toBe("unsupported_short_circuit");
    expect(setCachedSearch).toHaveBeenCalledTimes(1);
  }, 60_000);

  it("still caches the deterministic unavailable-document-noise short circuit", async () => {
    const { searchChunksWithTelemetry, setCachedSearch } = await loadSearch("inconclusive");

    const result = await searchChunksWithTelemetry({
      query: "Show me the airport travel policy",
      ownerId,
      lexicalOnly: true,
    });

    expect(result.results).toEqual([]);
    expect(result.telemetry.retrieval_strategy).toBe("unsupported_short_circuit");
    expect(setCachedSearch).toHaveBeenCalledTimes(1);
  }, 60_000);

  it("still caches a deterministic out-of-corpus zero even though it looks soft-tail-shaped", async () => {
    // Devin review on PR #1646: isUnsupportedSoftTailAnalysis only looks at the query text and
    // deterministic analysis, not queryAnalysis.corpusGrounding, so a real "out_of_corpus" verdict
    // (a deterministic, corpus-derived true negative reached without any LLM call) must be
    // excluded from the soft-tail cache-write skip, or every repeat re-runs classifyCorpusGrounding
    // and the trigram-correction RPC for a query that will always come back empty.
    const { searchChunksWithTelemetry, setCachedSearch } = await loadSearch("out_of_corpus");

    const result = await searchChunksWithTelemetry({
      query: "catatonia",
      ownerId,
      lexicalOnly: true,
    });

    expect(result.results).toEqual([]);
    expect(result.telemetry.retrieval_strategy).toBe("unsupported_short_circuit");
    expect(setCachedSearch).toHaveBeenCalledTimes(1);
  }, 60_000);

  it("does not cache the zero when the query-correction call failed or timed out", async () => {
    // Qodo review on PR #3560: a timed-out correction resolves with an error and null data, which
    // is not evidence that the query has no match, so the empty result must not become sticky.
    const { searchChunksWithTelemetry, setCachedSearch } = await loadSearch("inconclusive", {
      sourceOnly: false,
      correctionError: true,
    });

    const result = await searchChunksWithTelemetry({
      query: "Show me the airport travel policy",
      ownerId,
      lexicalOnly: true,
    });

    expect(result.results).toEqual([]);
    expect(result.telemetry.retrieval_strategy).toBe("unsupported_short_circuit");
    expect(setCachedSearch).not.toHaveBeenCalled();
  }, 60_000);

  it("still caches the deterministic zero when the query-correction call succeeded", async () => {
    const { searchChunksWithTelemetry, setCachedSearch } = await loadSearch("inconclusive", { sourceOnly: false });

    const result = await searchChunksWithTelemetry({
      query: "Show me the airport travel policy",
      ownerId,
      lexicalOnly: true,
    });

    expect(result.results).toEqual([]);
    expect(result.telemetry.retrieval_strategy).toBe("unsupported_short_circuit");
    expect(setCachedSearch).toHaveBeenCalledTimes(1);
  }, 60_000);

  it("rescues an in-corpus bare topic before ever reaching the short circuit", async () => {
    const { searchChunksWithTelemetry } = await loadSearch("in_corpus_topic");

    const result = await searchChunksWithTelemetry({
      query: "catatonia",
      ownerId,
      lexicalOnly: true,
    });

    // Pin the rescue itself. Do not assert on setCachedSearch here: with an empty mocked
    // Supabase client the retrieval path may write nothing for unrelated reasons, so a
    // "not called" expectation would pass for the wrong reason if candidates later appear.
    expect(result.telemetry.retrieval_strategy).not.toBe("unsupported_short_circuit");
  }, 60_000);
});
