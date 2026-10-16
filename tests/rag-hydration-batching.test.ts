import { describe, expect, it, vi } from "vitest";

import {
  createChunkLoadCache,
  loadChunksForMemoryCards,
  loadChunksForSignalMatches,
} from "@/lib/rag/rag-candidate-sources";
import { attachPageVisualEvidence, createPageVisualEvidenceCache } from "@/lib/rag/rag-hydration";
import type { SearchResult } from "@/lib/types";

function makeSearchResult(id: string, documentId: string, pageNumber: number): SearchResult {
  return {
    id,
    document_id: documentId,
    title: `Doc ${documentId}`,
    file_name: `${documentId}.pdf`,
    page_number: pageNumber,
    chunk_index: 0,
    section_heading: "Section",
    content: "Clinical content",
    image_ids: [],
    images: [],
    similarity: 0.9,
  };
}

describe("RAG hydration batching and interactive embedding timeout (#CWWH2E / #FZP7VW)", () => {
  it("attachPageVisualEvidence queries only missing (document_id, page_number) pairs across passes", async () => {
    const queriedPairs: Array<{ docIds: string[]; pages: number[] }> = [];

    const mockSupabase = {
      from: vi.fn((table: string) => {
        const state: { docIds: string[]; pages: number[] } = { docIds: [], pages: [] };
        const builder = {
          select: vi.fn(() => builder),
          in: vi.fn((col: string, values: unknown[]) => {
            if (col === "document_id") state.docIds = values.map(String);
            if (col === "page_number") state.pages = values.map(Number);
            return builder;
          }),
          eq: vi.fn(() => builder),
          neq: vi.fn(() => builder),
          order: vi.fn(() => builder),
          limit: vi.fn(() => builder),
          abortSignal: vi.fn(() => builder),
          then: (resolve: (val: unknown) => void) => {
            if (table === "document_images") {
              queriedPairs.push({ docIds: [...state.docIds], pages: [...state.pages] });
              const rows = state.docIds.flatMap((docId) =>
                state.pages.map((pageNumber) => ({
                  id: `img-${docId}-p${pageNumber}`,
                  document_id: docId,
                  page_number: pageNumber,
                  storage_path: `images/${docId}/p${pageNumber}.png`,
                  caption: `Caption for ${docId} p${pageNumber}`,
                  bbox: null,
                  image_type: "clinical_table",
                  searchable: true,
                  clinical_relevance_score: 0.9,
                  source_kind: "table_crop",
                  width: 400,
                  height: 300,
                  labels: [],
                  metadata: {},
                })),
              );
              resolve({ data: rows, error: null });
              return;
            }
            resolve({ data: [], error: null });
          },
        };
        return builder;
      }),
    };

    const visualCache = createPageVisualEvidenceCache();

    const firstPass = await attachPageVisualEvidence(
      mockSupabase as never,
      [makeSearchResult("c-1", "doc-1", 1)],
      undefined,
      visualCache,
    );
    expect(firstPass[0]?.images?.[0]?.caption).toBe("Caption for doc-1 p1");
    expect(queriedPairs).toEqual([{ docIds: ["doc-1"], pages: [1] }]);

    // Second pass includes already-cached (doc-1, p1) plus new (doc-2, p3).
    // Only (doc-2, p3) should be queried.
    const secondPass = await attachPageVisualEvidence(
      mockSupabase as never,
      [makeSearchResult("c-1", "doc-1", 1), makeSearchResult("c-2", "doc-2", 3)],
      undefined,
      visualCache,
    );
    expect(secondPass[0]?.images?.[0]?.caption).toBe("Caption for doc-1 p1");
    expect(secondPass[1]?.images?.[0]?.caption).toBe("Caption for doc-2 p3");
    expect(queriedPairs).toEqual([
      { docIds: ["doc-1"], pages: [1] },
      { docIds: ["doc-2"], pages: [3] },
    ]);

    // Third pass with only already-cached pairs performs zero DB queries.
    await attachPageVisualEvidence(
      mockSupabase as never,
      [makeSearchResult("c-1", "doc-1", 1), makeSearchResult("c-2", "doc-2", 3)],
      undefined,
      visualCache,
    );
    expect(queriedPairs).toHaveLength(2);
  });

  it("loadChunksForSignalMatches joins documents!inner in a single round-trip and enforces status, owner, and generation scope", async () => {
    const queriedTables: Array<{ table: string; selectCols: string }> = [];
    const mockSupabase = {
      from: vi.fn((table: string) => {
        let selectCols = "";
        const builder = {
          select: vi.fn((cols: string) => {
            selectCols = cols;
            queriedTables.push({ table, selectCols });
            return builder;
          }),
          in: vi.fn(() => builder),
          eq: vi.fn(() => builder),
          or: vi.fn(() => builder),
          is: vi.fn(() => builder),
          limit: vi.fn(() => builder),
          then: (resolve: (val: unknown) => void) => {
            if (table === "document_chunks") {
              resolve({
                data: [
                  {
                    id: "chunk-ok",
                    document_id: "doc-ok",
                    page_number: 2,
                    chunk_index: 0,
                    section_heading: "Dosing",
                    section_path: [],
                    heading_level: 2,
                    parent_heading: null,
                    anchor_id: null,
                    content: "Start at 12.5 mg.",
                    retrieval_synopsis: "12.5 mg",
                    image_ids: [],
                    index_generation_id: "gen-ok",
                    documents: {
                      id: "doc-ok",
                      title: "Clozapine Protocol",
                      file_name: "clozapine.pdf",
                      metadata: { index_generation_id: "gen-ok" },
                      owner_id: "owner-1",
                      status: "indexed",
                      index_generation_id: "gen-ok",
                    },
                  },
                  {
                    id: "chunk-wrong-owner",
                    document_id: "doc-wrong-owner",
                    page_number: 1,
                    chunk_index: 0,
                    section_heading: null,
                    section_path: [],
                    heading_level: null,
                    parent_heading: null,
                    anchor_id: null,
                    content: "Private",
                    retrieval_synopsis: null,
                    image_ids: [],
                    index_generation_id: "gen-2",
                    documents: {
                      id: "doc-wrong-owner",
                      title: "Other Owner Doc",
                      file_name: "other.pdf",
                      metadata: { index_generation_id: "gen-2" },
                      owner_id: "owner-2",
                      status: "indexed",
                      index_generation_id: "gen-2",
                    },
                  },
                  {
                    id: "chunk-stale-gen",
                    document_id: "doc-ok",
                    page_number: 3,
                    chunk_index: 1,
                    section_heading: null,
                    section_path: [],
                    heading_level: null,
                    parent_heading: null,
                    anchor_id: null,
                    content: "Stale generation",
                    retrieval_synopsis: null,
                    image_ids: [],
                    index_generation_id: "gen-old",
                    documents: {
                      id: "doc-ok",
                      title: "Clozapine Protocol",
                      file_name: "clozapine.pdf",
                      metadata: { index_generation_id: "gen-ok" },
                      owner_id: "owner-1",
                      status: "indexed",
                      index_generation_id: "gen-ok",
                    },
                  },
                ],
                error: null,
              });
              return;
            }
            resolve({ data: [], error: null });
          },
        };
        return builder;
      }),
    };

    const cache = createChunkLoadCache();
    const results = await loadChunksForSignalMatches({
      supabase: mockSupabase as never,
      matches: [
        { chunkId: "chunk-ok", similarity: 0.91, textRank: 0.91, hybridScore: 0.91, reason: "table_fact" },
        { chunkId: "chunk-wrong-owner", similarity: 0.85, textRank: 0.85, hybridScore: 0.85, reason: "table_fact" },
        { chunkId: "chunk-stale-gen", similarity: 0.8, textRank: 0.8, hybridScore: 0.8, reason: "table_fact" },
      ],
      ownerId: "owner-1",
      cache,
    });

    expect(queriedTables).toHaveLength(1);
    expect(queriedTables[0]?.table).toBe("document_chunks");
    expect(queriedTables[0]?.selectCols).toContain("documents!inner");
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe("chunk-ok");
    expect(results[0]?.title).toBe("Clozapine Protocol");
    expect(cache.chunks.size).toBeGreaterThan(0);
    expect(cache.documents.size).toBeGreaterThan(0);
    expect(cache.chunkScopes.size).toBeGreaterThan(0);

    // Subsequent loadChunksForMemoryCards reuses the populated ChunkLoadCache without re-querying
    const memoryResults = await loadChunksForMemoryCards(
      mockSupabase as never,
      [
        {
          id: "mc-1",
          document_id: "doc-ok",
          page_number: 2,
          source_chunk_ids: ["chunk-ok"],
          source_image_id: null,
          card_type: "protocol_bullet",
          title: "Initial dose",
          content: "Start at 12.5 mg.",
          conditions: null,
          actions: null,
          contraindications: null,
          keywords: ["clozapine"],
          metadata: {},
        } as never,
      ],
      { ownerId: "owner-1", includePublic: true },
      cache,
    );
    expect(memoryResults).toHaveLength(1);
    expect(memoryResults[0]?.id).toBe("chunk-ok");
    expect(queriedTables).toHaveLength(1);
  });

  it("embedTextWithTelemetry forwards timeoutMs and maxRetries to the OpenAI embeddings call (#FZP7VW)", async () => {
    const prevKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-test-interactive-timeout";
    const createMock = vi.fn().mockResolvedValue({
      data: [{ index: 0, embedding: Array.from({ length: 1536 }, () => 0.01) }],
      usage: { prompt_tokens: 5 },
    });

    try {
      vi.resetModules();
      vi.doMock("openai", () => ({
        default: class MockOpenAI {
          embeddings = { create: createMock };
        },
      }));

      const { embedTextWithTelemetry } = await import("@/lib/openai");
      await embedTextWithTelemetry("clozapine anc threshold", {
        timeoutMs: 4000,
        maxRetries: 0,
      });

      expect(createMock).toHaveBeenCalledTimes(1);
      expect(createMock.mock.calls[0]?.[1]).toMatchObject({
        timeout: 4000,
        maxRetries: 0,
      });
    } finally {
      vi.doUnmock("openai");
      if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prevKey;
    }
  });
});
