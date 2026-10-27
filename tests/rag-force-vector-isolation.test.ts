import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentMemoryCard } from "../src/lib/types";

const state = vi.hoisted(() => ({ client: null as unknown }));

vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  return {
    ...actual,
    env: {
      ...actual.env,
      RAG_PROVIDER_MODE: "openai",
      RAG_PROGRAMME_MODE: "legacy",
      RAG_ANSWER_CACHE_TTL_MS: 0,
      RAG_SEARCH_CACHE_TTL_MS: 0,
      RAG_SEMANTIC_RERANK_ENABLED: false,
    },
  };
});
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.client }));
vi.mock("@/lib/openai", () => ({
  embedTextWithTelemetry: vi.fn(async () => ({ embedding: Array(1536).fill(0.01), cacheHit: false })),
}));
vi.mock("@/lib/rag/rag-classifier-fallback", () => ({
  analyzeQueryWithClassifierFallback: async (_query: string, analysis: unknown) => analysis,
}));

const { searchChunksWithTelemetry } = await import("../src/lib/rag/rag");
const { fetchMemoryCardsForQuery } = await import("../src/lib/deep-memory");
const { loadMemoryBoostArtifacts } = await import("../src/lib/rag/rag-candidate-sources");

const query = "post traumatic stress disorder";
const document = {
  id: "synthetic-document",
  owner_id: null,
  status: "indexed",
  title: "Synthetic assessment guideline",
  file_name: "synthetic.pdf",
  metadata: {},
};
const chunks = ["field-chunk", "unit-chunk", "memory-chunk", "vector-chunk"].map((id, chunk_index) => ({
  id,
  document_id: document.id,
  owner_id: null,
  page_number: 1,
  chunk_index,
  section_heading: "Assessment",
  content: "Post traumatic stress disorder assessment and management guidance.",
  image_ids: [],
  index_generation_id: null,
  documents: document,
}));
const memory: DocumentMemoryCard = {
  id: "synthetic-memory",
  document_id: document.id,
  owner_id: null,
  section_id: null,
  card_type: "section_summary",
  title: document.title,
  content: chunks[0].content,
  normalized_terms: ["post", "traumatic", "stress", "disorder"],
  page_number: 1,
  source_chunk_ids: ["memory-chunk"],
  source_image_ids: [],
  confidence: 0.99,
  metadata: {},
};

function fixture(
  options: {
    memoryFailure?: boolean;
    vectorMemory?: boolean;
    vectorFields?: boolean;
    vectorChunks?: boolean;
    hybridFailure?: boolean;
  } = {},
) {
  class Query {
    private ids?: unknown[];
    private titleLookup = false;
    constructor(private table: string) {}
    select() {
      return this;
    }
    eq() {
      return this;
    }
    neq() {
      return this;
    }
    is() {
      return this;
    }
    or(filter: string) {
      if (filter.includes("title.ilike")) this.titleLookup = true;
      return this;
    }
    order() {
      return this;
    }
    limit() {
      return this;
    }
    range() {
      return this;
    }
    textSearch() {
      return this;
    }
    abortSignal() {
      return this;
    }
    in(column: string, values: unknown[]) {
      if (column === "id") this.ids = values;
      return this;
    }
    then(yes: (value: unknown) => unknown, no?: (reason: unknown) => unknown) {
      const rows =
        this.table === "documents"
          ? [document]
          : this.table === "document_chunks"
            ? chunks
            : this.table === "document_memory_cards"
              ? [memory]
              : [];
      return Promise.resolve({
        data: this.titleLookup ? [] : rows.filter((row) => !this.ids || this.ids.includes(row.id)),
        error: null,
      }).then(yes, no);
    }
  }
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    const lexical = Boolean(args.query_text);
    const scores = {
      similarity: options.vectorFields ? 0.8 : 0,
      text_rank: lexical ? 1 : 0,
      hybrid_score: options.vectorFields ? 0.8 : 0.3,
    };
    if (name.includes("embedding_fields_hybrid")) {
      return {
        data:
          lexical || options.vectorFields
            ? [{ source_chunk_id: "field-chunk", field_type: "section_context", ...scores }]
            : [],
        error: null,
      };
    }
    if (name.includes("index_units_hybrid")) {
      return {
        data: lexical
          ? [
              {
                id: "synthetic-unit",
                document_id: document.id,
                source_chunk_id: "unit-chunk",
                source_image_id: null,
                unit_type: "clinical_fact",
                title: document.title,
                content: chunks[0].content,
                page_start: 1,
                page_end: 1,
                quality_score: 0.9,
                extraction_mode: "deterministic",
                metadata: {},
                ...scores,
              },
            ]
          : [],
        error: null,
      };
    }
    if (name.includes("memory_cards_hybrid")) {
      return {
        data: options.memoryFailure
          ? null
          : lexical || options.vectorMemory
            ? [{ ...memory, ...scores, similarity: options.vectorMemory ? 0.8 : 0 }]
            : [],
        error: options.memoryFailure ? { message: "synthetic failure", code: "XX000" } : null,
      };
    }
    if (name.includes("chunks_hybrid") && options.hybridFailure) {
      return { data: null, error: { message: "synthetic failure", code: "XX000" } };
    }
    if (name.includes("chunks_hybrid") && options.vectorChunks) {
      return {
        data: [
          {
            ...chunks[3],
            title: document.title,
            file_name: document.file_name,
            source_metadata: document.metadata,
            images: [],
            similarity: 0.8,
            hybrid_score: 0.8,
            text_rank: 0,
          },
        ],
        error: null,
      };
    }
    if (name === "correct_clinical_query_terms") return { data: null, error: null };
    return { data: [], error: null };
  });
  return { rpc, from: vi.fn((table: string) => new Query(table)) };
}

describe("forced vector retrieval isolation", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("Network is forbidden in this synthetic test.");
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each([false, true])(
    "cannot return perfect lexical field, unit or memory matches with zero semantic hits (fallback=%s)",
    async (hybridFailure) => {
      const client = fixture({ hybridFailure });
      state.client = client;
      const result = await searchChunksWithTelemetry({
        query,
        forceEmbedding: true,
        skipCache: true,
        allowGlobalSearch: true,
      });
      expect(result.results).toEqual([]);
      expect(result.telemetry.retrieval_layer_counts?.embedding_fields).toBe(0);
      expect(result.telemetry.retrieval_layer_counts?.index_units).toBe(0);
      expect(client.rpc.mock.calls.some(([name]) => name.includes("index_units_hybrid"))).toBe(false);
    },
  );

  it("retains lexical field, unit and memory rescue for ordinary hybrid retrieval", async () => {
    const client = fixture();
    state.client = client;
    const result = await searchChunksWithTelemetry({ query, skipCache: true, allowGlobalSearch: true });
    expect(result.results.map((row) => row.id).sort()).toEqual(["field-chunk", "memory-chunk", "unit-chunk"]);
    expect(result.results.find((row) => row.id === "memory-chunk")?.similarity_origin).toBe("synthetic_text");
    expect(client.rpc.mock.calls.some(([name]) => name.includes("index_units_hybrid"))).toBe(true);
  });

  it("retains genuine chunk, field and memory vector matches while excluding the lexical-only index-unit lane", async () => {
    const client = fixture({ vectorChunks: true, vectorFields: true, vectorMemory: true });
    state.client = client;
    const result = await searchChunksWithTelemetry({
      query,
      forceEmbedding: true,
      skipCache: true,
      allowGlobalSearch: true,
    });
    expect(result.results.map((row) => row.id).sort()).toEqual(["field-chunk", "memory-chunk", "vector-chunk"]);
    expect(result.telemetry.retrieval_layer_counts?.embedding_fields).toBe(1);
    expect(result.telemetry.retrieval_layer_counts?.hybrid_vector).toBe(1);
    expect(result.telemetry.retrieval_layer_counts?.index_units).toBe(0);
    expect(client.rpc.mock.calls.some(([name]) => name.includes("index_units_hybrid"))).toBe(false);
    expect(result.results.find((row) => row.id === "memory-chunk")?.similarity_origin).toBe("synthetic_text");
  });

  it.each([false, true])(
    "does not fall back to lexical memory after an empty or failed vector memory RPC (failure=%s)",
    async (memoryFailure) => {
      const client = fixture({ memoryFailure });
      const request = { supabase: client as never, query, queryEmbedding: [0.01], vectorOnly: true };
      expect(await fetchMemoryCardsForQuery(request)).toEqual([]);
      expect(client.from.mock.calls.some(([table]) => table === "document_memory_cards")).toBe(false);
    },
  );

  it("retains genuine vector memory hits", async () => {
    const client = fixture({ vectorMemory: true });
    const request = { supabase: client as never, query, queryEmbedding: [0.01], vectorOnly: true };
    const cards = await fetchMemoryCardsForQuery(request);
    expect(cards.map((card) => card.id)).toEqual([memory.id]);
    expect(cards[0].metadata?.memory_similarity).toBe(0.8);
  });

  it("does not reuse hybrid memory artifacts as vector-only evidence in one request", async () => {
    const client = fixture();
    const cardCache = new Map();
    const request = { supabase: client as never, query, queryEmbedding: [0.01], matchCount: 8, cardCache };
    expect((await loadMemoryBoostArtifacts(request)).memoryChunkResults.map((row) => row.id)).toEqual(["memory-chunk"]);
    expect((await loadMemoryBoostArtifacts({ ...request, vectorOnly: true })).memoryChunkResults).toEqual([]);
  });
});
