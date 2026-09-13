import { describe, expect, it, vi } from "vitest";
import { loadChunksForMemoryCards, loadChunksForSignalMatches } from "../src/lib/rag/rag";
import { createChunkLoadCache } from "../src/lib/rag/rag-candidate-sources";
import type { DocumentMemoryCard } from "../src/lib/types";

const generation = "11111111-1111-4111-8111-111111111111";

const chunks = [
  {
    id: "public-chunk",
    document_id: "public-doc",
    owner_id: null,
    page_number: 1,
    chunk_index: 0,
    section_heading: "Public",
    section_path: [],
    heading_level: 1,
    parent_heading: null,
    anchor_id: null,
    content: "Public evidence",
    retrieval_synopsis: null,
    image_ids: [],
    index_generation_id: generation,
  },
  {
    id: "owner-chunk",
    document_id: "owner-doc",
    owner_id: "owner-a",
    page_number: 1,
    chunk_index: 0,
    section_heading: "Owner",
    section_path: [],
    heading_level: 1,
    parent_heading: null,
    anchor_id: null,
    content: "Owner evidence",
    retrieval_synopsis: null,
    image_ids: [],
    index_generation_id: generation,
  },
  {
    id: "foreign-chunk",
    document_id: "foreign-doc",
    owner_id: "owner-b",
    page_number: 1,
    chunk_index: 0,
    section_heading: "Foreign",
    section_path: [],
    heading_level: 1,
    parent_heading: null,
    anchor_id: null,
    content: "Foreign evidence",
    retrieval_synopsis: null,
    image_ids: [],
    index_generation_id: generation,
  },
];
const documents = [
  {
    id: "public-doc",
    owner_id: null,
    title: "Public",
    file_name: "public.pdf",
    metadata: { index_generation_id: generation },
    status: "indexed",
  },
  {
    id: "owner-doc",
    owner_id: "owner-a",
    title: "Owner",
    file_name: "owner.pdf",
    metadata: { index_generation_id: generation },
    status: "indexed",
  },
  {
    id: "foreign-doc",
    owner_id: "owner-b",
    title: "Foreign",
    file_name: "foreign.pdf",
    metadata: { index_generation_id: generation },
    status: "indexed",
  },
];

function client() {
  class Query implements PromiseLike<{ data: unknown[]; error: null }> {
    private ids: string[] | null = null;
    private owner: string | null | undefined;
    private includePublic = false;
    constructor(private readonly table: string) {}
    select() {
      return this;
    }
    limit() {
      return this;
    }
    order() {
      return this;
    }
    in(column: string, values: string[]) {
      if (column === "id") this.ids = values;
      return this;
    }
    eq(column: string, value: unknown) {
      if (column === "owner_id") this.owner = String(value);
      return this;
    }
    is(column: string) {
      if (column === "owner_id") this.owner = null;
      return this;
    }
    or(value: string) {
      this.owner = value.match(/owner_id\.eq\.([^,]+)/)?.[1];
      this.includePublic = value.includes("owner_id.is.null");
      return this;
    }
    then<TResult1 = { data: unknown[]; error: null }, TResult2 = never>(
      onfulfilled?: ((value: { data: unknown[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      const source = this.table === "document_chunks" ? chunks : documents;
      const data = source.filter((row) => {
        if (this.ids && !this.ids.includes(row.id)) return false;
        if (this.owner === undefined) return true;
        if (this.owner === null) return row.owner_id === null;
        return row.owner_id === this.owner || (this.includePublic && row.owner_id === null);
      });
      return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
    }
  }
  return { from: vi.fn((table: string) => new Query(table)) } as never;
}

function card(id: string, documentId: string, chunkId: string, ownerId: string | null): DocumentMemoryCard {
  return {
    id,
    document_id: documentId,
    owner_id: ownerId,
    section_id: null,
    card_type: "section_summary",
    title: id,
    content: id,
    normalized_terms: [],
    page_number: 1,
    source_chunk_ids: [chunkId],
    source_image_ids: [],
    confidence: 0.8,
    metadata: { index_generation_id: generation },
  };
}

describe("retrieval hydration tenancy", () => {
  const cards = [
    card("public-card", "public-doc", "public-chunk", null),
    card("owner-card", "owner-doc", "owner-chunk", "owner-a"),
    card("foreign-card", "foreign-doc", "foreign-chunk", "owner-b"),
  ];
  const matches = chunks.map((chunk) => ({
    chunkId: chunk.id,
    similarity: 0.8,
    textRank: 0.7,
    hybridScore: 0.9,
    reason: "section_context",
  }));

  it("hydrates only public chunks anonymously", async () => {
    expect((await loadChunksForMemoryCards(client(), cards, { includePublic: true })).map((row) => row.id)).toEqual([
      "public-chunk",
    ]);
    expect(
      (await loadChunksForSignalMatches({ supabase: client(), matches, accessScope: { includePublic: true } })).map(
        (row) => row.id,
      ),
    ).toEqual(["public-chunk"]);
  });

  it("hydrates exact-owner plus public chunks for authenticated retrieval", async () => {
    const accessScope = { ownerId: "owner-a", includePublic: true } as const;
    expect((await loadChunksForMemoryCards(client(), cards, accessScope)).map((row) => row.id).sort()).toEqual([
      "owner-chunk",
      "public-chunk",
    ]);
    expect(
      (await loadChunksForSignalMatches({ supabase: client(), matches, ownerId: "owner-a", accessScope }))
        .map((row) => row.id)
        .sort(),
    ).toEqual(["owner-chunk", "public-chunk"]);
  });

  it("keeps shared hydration entries isolated by retrieval access scope", async () => {
    const cache = createChunkLoadCache();

    expect(
      (
        await loadChunksForSignalMatches({
          supabase: client(),
          matches,
          accessScope: { includePublic: true },
          cache,
        })
      ).map((row) => row.id),
    ).toEqual(["public-chunk"]);

    expect(
      (
        await loadChunksForSignalMatches({
          supabase: client(),
          matches,
          ownerId: "owner-a",
          accessScope: { ownerId: "owner-a", includePublic: true },
          cache,
        })
      )
        .map((row) => row.id)
        .sort(),
    ).toEqual(["owner-chunk", "public-chunk"]);
  });

  it("deduplicates concurrent hydration queries for the same scope", async () => {
    const cache = createChunkLoadCache();
    const supabase = client() as unknown as { from: ReturnType<typeof vi.fn> };
    const args = {
      supabase: supabase as never,
      matches,
      accessScope: { includePublic: true } as const,
      cache,
    };

    const [first, second] = await Promise.all([loadChunksForSignalMatches(args), loadChunksForSignalMatches(args)]);

    expect(first.map((row) => row.id)).toEqual(["public-chunk"]);
    expect(second.map((row) => row.id)).toEqual(["public-chunk"]);
    expect(supabase.from.mock.calls.map(([table]) => table)).toEqual([
      "document_chunks",
      "documents",
      "document_chunks",
    ]);
  });
});
