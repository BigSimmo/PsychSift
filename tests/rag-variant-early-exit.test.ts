import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveRagContextSnapshot } from "../src/lib/rag/rag-context-snapshot";
import type { RagProgrammeMode, SearchResult } from "../src/lib/types";

// PT-02: a question fans out to up to 3 near-duplicate lexical RPC calls per
// text surface. When the FIRST variant already returns a deep pool anchored by
// a precise hit, the sibling calls must be skipped; weak pools keep the full
// fan-out so recall is unchanged.

function retrievalRpcBaseName(name: string) {
  return name.replace(/_v[23]$/, "");
}

function chunk(id: number, textRank: number): SearchResult {
  return {
    id: `clozapine-chunk-${id}`,
    document_id: "clozapine-doc",
    title: "Clozapine Monitoring Protocol",
    file_name: "clozapine-monitoring.pdf",
    page_number: 1 + id,
    chunk_index: id,
    section_heading: "Monitoring",
    content: `Clozapine monitoring row ${id}: FBC weekly for 18 weeks, then monthly.`,
    image_ids: [],
    similarity: 0,
    hybrid_score: 0.4,
    text_rank: textRank,
    source_metadata: {
      source_title: "Clozapine source",
      publisher: "Local service",
      jurisdiction: "Australia/WA",
      version: "1",
      publication_date: null,
      review_date: null,
      uploaded_at: null,
      indexed_at: null,
      uploaded_by: null,
      document_status: "current",
      clinical_validation_status: "approved",
      extraction_quality: "good",
    },
    images: [],
  };
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

  neq() {
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

// Multi-variant clinical query: alias/threshold expansion produces sibling variants.
const multiVariantQuery = "clozapine anc monitoring";

function contextSnapshot(rolloutVersion: RagProgrammeMode) {
  return resolveRagContextSnapshot({
    expectedSiteStaticManifestDigest: null,
    activePublicSiteRelease: null,
    publicSiteChangeEpoch: null,
    pendingPublicSiteChangeCount: 0,
    pendingPublicSiteLogicalIds: [],
    documentIndexGeneration: "shadow-query-plan-test-generation",
    sourcePolicyVersion: "australian-source-policy-v1",
    rolloutVersion,
    resolvedAt: "2026-08-29T00:00:00.000Z",
  });
}

async function runLexicalSearch(chunkResults: SearchResult[], rolloutModes: RagProgrammeMode[] = ["legacy"]) {
  vi.stubEnv("RAG_SEARCH_CACHE_TTL_MS", "0");
  vi.stubEnv("RAG_ANSWER_CACHE_TTL_MS", "0");

  const rpc = vi.fn(async (name: string) => {
    if (retrievalRpcBaseName(name) === "match_document_chunks_text") return { data: chunkResults, error: null };
    return { data: [], error: null };
  });
  const from = vi.fn(() => new EmptyQuery());
  vi.doMock("@/lib/supabase/admin", () => ({
    createAdminClient: () => ({
      rpc,
      from,
    }),
  }));

  const { searchChunksWithTelemetry } = await import("@/lib/rag/rag");
  const results = [];
  for (const rolloutMode of rolloutModes) {
    results.push(
      await searchChunksWithTelemetry({
        query: multiVariantQuery,
        ownerId: "owner-1",
        topK: 8,
        lexicalOnly: true,
        ragContextSnapshot: contextSnapshot(rolloutMode),
      }),
    );
  }
  const chunkTextCalls = rpc.mock.calls.filter(
    ([name]) => retrievalRpcBaseName(name as string) === "match_document_chunks_text",
  );
  return { chunkTextCalls, from, result: results[0]!, results, telemetry: results[0]!.telemetry };
}

afterEach(() => {
  vi.doUnmock("@/lib/supabase/admin");
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("lexical variant early-exit (PT-02)", () => {
  it("returns byte-identical legacy/shadow IDs and order without candidate retrieval fanout", async () => {
    const pool = Array.from({ length: 48 }, (_, index) => chunk(index, index === 0 ? 0.9 : 0.2));
    const { chunkTextCalls, results } = await runLexicalSearch(pool, ["legacy", "shadow"]);
    const [legacy, shadow] = results;

    expect(shadow!.results.map(({ id }) => id)).toEqual(legacy!.results.map(({ id }) => id));
    expect(shadow!.telemetry.retrieval_query_variant_count).toBe(legacy!.telemetry.retrieval_query_variant_count);
    expect(legacy!.telemetry.candidate_retrieval_query_variant_count).toBeUndefined();
    expect(shadow!.telemetry.candidate_retrieval_query_variant_count).toBeGreaterThan(0);
    expect(chunkTextCalls).toHaveLength(2);
    expect(JSON.stringify(shadow!.telemetry)).not.toContain(multiVariantQuery);
  });

  it("a deep, precisely-anchored first pool issues exactly one chunk-text RPC", async () => {
    // Deep (48-row) pool with a precise top hit: sibling variants are pure duplication.
    const strongPool = Array.from({ length: 48 }, (_, index) => chunk(index, index === 0 ? 0.9 : 0.2));
    const { chunkTextCalls, from, telemetry } = await runLexicalSearch(strongPool);
    // Guard: the fixture query must actually produce sibling variants for the
    // skip to be meaningful.
    expect(telemetry.retrieval_query_variant_count ?? 1).toBeGreaterThan(1);
    expect(chunkTextCalls).toHaveLength(1);
    expect(telemetry.text_variant_early_exit).toBe(true);
    expect(telemetry.text_variant_rpc_calls?.match_document_chunks_text).toBe(1);
    // Cache TTL is disabled for this fixture, so retrieval must not pay the
    // indexing-version `documents` preflight before issuing lexical RPCs.
    expect(from).not.toHaveBeenCalledWith("documents");
    expect(from).not.toHaveBeenCalledWith("document_pages");
  });

  it("a weak first pool keeps the full sibling fan-out", async () => {
    // Sparse middling pool: recall rescue must still fire every variant. The
    // weak-OR augmentation may add one more call on top of the variant set.
    const weakPool = [chunk(0, 0.12), chunk(1, 0.08)];
    const { chunkTextCalls, telemetry } = await runLexicalSearch(weakPool);
    const expectedVariantCalls = Math.min(telemetry.retrieval_query_variant_count ?? 1, 3);
    expect(expectedVariantCalls).toBeGreaterThan(1);
    expect(chunkTextCalls.length).toBeGreaterThanOrEqual(expectedVariantCalls);
    expect(telemetry.text_variant_early_exit).toBeUndefined();
    expect(telemetry.text_variant_rpc_calls?.match_document_chunks_text).toBe(expectedVariantCalls);
  });
});
