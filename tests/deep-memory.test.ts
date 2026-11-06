import { describe, expect, it, vi } from "vitest";
import { rankClinicalResults } from "../src/lib/clinical-search";
import {
  applyMemoryCardBoosts,
  assertLocalDeepMemoryOwnership,
  buildDocumentMemoryCards,
  buildDocumentSections,
  DeepMemoryOwnershipConflictError,
  fetchMemoryCardsForQuery,
  ragDeepMemoryVersion,
  upsertDocumentDeepMemory,
} from "../src/lib/deep-memory";
import type { DocumentMemoryCard, SearchResult } from "../src/lib/types";
import { isCommittedGenerationMetadata } from "../src/lib/reindex-pipeline";

vi.mock("@/lib/openai", () => ({
  embedTexts: vi.fn(async (texts: string[]) => texts.map(() => Array.from({ length: 1536 }, () => 0.01))),
}));

const { generateModelIndexProfileMock } = vi.hoisted(() => ({
  generateModelIndexProfileMock: vi.fn(async () => {
    throw new Error("model profile unavailable");
  }),
}));

vi.mock("@/lib/model-index-extraction", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/model-index-extraction")>()),
  generateModelIndexProfile: generateModelIndexProfileMock,
}));

const document = {
  id: "doc-1",
  owner_id: "user-1",
  title: "Future Uploaded Clinical Protocol",
  file_name: "future-upload.pdf",
  source_path: "uploads/future-upload.pdf",
  metadata: { index_generation_id: "00000000-0000-4000-8000-000000000010" },
  updated_at: "snapshot-A",
};

function chunk(overrides: Partial<SearchResult> & { chunk_index?: number; page_number?: number | null }) {
  return {
    id: overrides.id ?? "chunk-1",
    document_id: overrides.document_id ?? "doc-1",
    page_number: overrides.page_number ?? 1,
    chunk_index: overrides.chunk_index ?? 0,
    section_heading: overrides.section_heading ?? "Clinical Workflow",
    content: overrides.content ?? "Clinical protocol text.",
    image_ids: overrides.image_ids ?? [],
    metadata: overrides.source_metadata ?? {},
  };
}

function result(overrides: Partial<SearchResult>): SearchResult {
  return {
    id: overrides.id ?? "chunk-1",
    document_id: overrides.document_id ?? "doc-1",
    title: overrides.title ?? "Future Uploaded Clinical Protocol",
    file_name: overrides.file_name ?? "future-upload.pdf",
    page_number: 1,
    chunk_index: 0,
    section_heading: "Clinical Workflow",
    content: overrides.content ?? "Clinical protocol text.",
    image_ids: [],
    similarity: overrides.similarity ?? 0.55,
    hybrid_score: overrides.hybrid_score ?? 0.55,
    images: [],
    ...overrides,
  };
}

describe("deep RAG memory indexing", () => {
  it("builds generic section maps from arbitrary uploaded document headings and page gaps", () => {
    const sections = buildDocumentSections({
      document,
      chunks: [
        chunk({ id: "chunk-a", chunk_index: 0, page_number: 1, section_heading: "Assessment" }),
        chunk({ id: "chunk-b", chunk_index: 1, page_number: 2, section_heading: "Assessment" }),
        chunk({ id: "chunk-c", chunk_index: 2, page_number: 5, section_heading: "Escalation" }),
      ],
    });

    expect(sections).toHaveLength(2);
    expect(sections[0]).toEqual(
      expect.objectContaining({
        heading: "Assessment",
        page_start: 1,
        page_end: 2,
        chunk_ids: ["chunk-a", "chunk-b"],
      }),
    );
    expect(sections[1]).toEqual(expect.objectContaining({ heading: "Escalation", chunk_ids: ["chunk-c"] }));
    expect(sections[0].metadata).toEqual(expect.objectContaining({ rag_indexing_version: ragDeepMemoryVersion }));
  });

  it("extracts high-yield memory cards for tables, thresholds, risks, medications, and workflow steps", () => {
    const cards = buildDocumentMemoryCards({
      document,
      chunks: [
        chunk({
          id: "chunk-table",
          content:
            "| Score | Action |\n| --- | --- |\n| 6 | Immediate senior review and lorazepam 1 mg PO. |\nIf ANC is < 1.5, stop clozapine and urgent specialist review is required.\nThe workflow requires documenting the review within 24 hours.",
        }),
      ],
    });

    expect(cards.map((card) => card.card_type)).toEqual(expect.arrayContaining(["table_row", "threshold", "workflow"]));
    expect(cards.some((card) => card.content.includes("lorazepam 1 mg"))).toBe(true);
    expect(
      cards.every((card) => card.source_chunk_ids.includes("chunk-table") || card.card_type === "section_summary"),
    ).toBe(true);
    expect(cards.every((card) => card.metadata?.rag_indexing_version === ragDeepMemoryVersion)).toBe(true);
  });

  it("adds model-backed askable question cards when source IDs validate", () => {
    const cards = buildDocumentMemoryCards({
      document,
      chunks: [
        chunk({
          id: "chunk-question",
          content: "Depot medications are administered through the long acting injectable medication pathway.",
        }),
      ],
      modelProfile: {
        sections: [],
        clinical_facts: [],
        table_facts: [],
        aliases: [],
        quality_issues: [],
        model: "test-model",
        version: "model-heavy-index-v1",
        askable_questions: [
          {
            title: "How are LAI depot medications managed?",
            content: "How are long acting injectable depot medications managed?",
            source_chunk_ids: ["chunk-question"],
            source_image_ids: [],
            confidence: 0.91,
          },
        ],
      },
    });

    expect(cards.some((card) => card.card_type === "askable_question")).toBe(true);
  });

  it("keeps a source-backed fallback card when no enrichment-style high-yield terms are present", () => {
    const cards = buildDocumentMemoryCards({
      document,
      chunks: [
        chunk({
          id: "chunk-low-signal",
          content: "This future upload describes local service background, scope, and routine contact information.",
        }),
      ],
    });

    expect(cards.length).toBeGreaterThan(0);
    expect(cards.some((card) => card.source_chunk_ids.includes("chunk-low-signal"))).toBe(true);
  });

  it("does not cap persisted memory cards for large high-yield documents", () => {
    const cards = buildDocumentMemoryCards({
      document,
      chunks: Array.from({ length: 140 }, (_, index) =>
        chunk({
          id: `chunk-risk-${index}`,
          chunk_index: index,
          page_number: index + 1,
          content: `Risk workflow ${index}: urgent review is required within ${index + 1} hours and medication monitoring must be documented.`,
        }),
      ),
    });

    expect(cards.length).toBeGreaterThan(120);
    expect(cards.some((card) => card.source_chunk_ids.includes("chunk-risk-139"))).toBe(true);
  });

  it("boosts direct memory evidence above a higher raw-score generic chunk", () => {
    const boosted = applyMemoryCardBoosts(
      "ANC threshold stop clozapine",
      [
        result({
          id: "direct-threshold",
          hybrid_score: 0.5,
          content: "If ANC is < 1.5, stop clozapine and seek urgent specialist review.",
        }),
        result({
          id: "generic-monitoring",
          hybrid_score: 0.64,
          content: "General monitoring should be documented in the clinical record.",
        }),
      ],
      [
        {
          id: "card-1",
          document_id: "doc-1",
          owner_id: "user-1",
          section_id: null,
          card_type: "threshold",
          title: "Threshold: ANC clozapine",
          content: "If ANC is < 1.5, stop clozapine and seek urgent specialist review.",
          normalized_terms: ["anc", "threshold", "stop", "clozapine"],
          page_number: 1,
          source_chunk_ids: ["direct-threshold"],
          source_image_ids: [],
          confidence: 0.95,
          metadata: {},
        } satisfies DocumentMemoryCard,
      ],
    );

    const ranked = rankClinicalResults("ANC threshold stop clozapine", boosted);
    expect(ranked[0].id).toBe("direct-threshold");
    expect(ranked[0].memory_cards?.[0]?.id).toBe("card-1");
  });

  it("uses hybrid memory-card scores when mapping memory evidence back to chunks", () => {
    const boosted = applyMemoryCardBoosts(
      "table threshold monitoring",
      [
        result({
          id: "table-threshold",
          hybrid_score: 0.5,
          content: "Table row: monitoring threshold requires escalation.",
        }),
      ],
      [
        {
          id: "card-hybrid",
          document_id: "doc-1",
          owner_id: "user-1",
          section_id: null,
          card_type: "table_row",
          title: "Monitoring threshold table row",
          content: "Monitoring threshold requires escalation.",
          normalized_terms: ["monitoring", "threshold"],
          page_number: 1,
          source_chunk_ids: ["table-threshold"],
          source_image_ids: [],
          confidence: 0.2,
          metadata: { memory_hybrid_score: 0.9 },
        } satisfies DocumentMemoryCard,
      ],
    );

    expect(boosted[0].memory_score).toBe(0.9);
    expect(boosted[0].hybrid_score).toBeGreaterThan(0.7);
  });

  // L8 (audit 2026-07-01): fail CLOSED. When the documents lookup errors we
  // cannot verify which reindex generation is committed, so the fallback must
  // drop its cards for that query rather than risk injecting content from an
  // abandoned/superseded generation into a clinical answer.
  it("drops fallback memory cards when committed-generation metadata lookup fails", async () => {
    const cards = [
      {
        id: "card-new",
        document_id: "doc-1",
        owner_id: "user-1",
        section_id: null,
        card_type: "threshold",
        title: "Lithium monitoring",
        content: "Lithium monitoring threshold evidence.",
        normalized_terms: ["lithium", "monitoring"],
        page_number: 1,
        source_chunk_ids: ["chunk-1"],
        source_image_ids: [],
        confidence: 0.8,
        metadata: { index_generation_id: "replacement-generation" },
      } satisfies DocumentMemoryCard,
    ];
    class QueryStub implements PromiseLike<{ data: unknown; error: { message: string } | null }> {
      constructor(private readonly table: string) {}
      select() {
        return this;
      }
      textSearch() {
        return this;
      }
      order() {
        return this;
      }
      limit() {
        return this;
      }
      eq() {
        return this;
      }
      in() {
        return this;
      }
      then<TResult1 = { data: unknown; error: { message: string } | null }, TResult2 = never>(
        onfulfilled?:
          ((value: { data: unknown; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ): PromiseLike<TResult1 | TResult2> {
        const value =
          this.table === "document_memory_cards"
            ? { data: cards, error: null }
            : { data: null, error: { message: "metadata unavailable" } };
        return Promise.resolve(value).then(onfulfilled, onrejected);
      }
    }
    const supabase = {
      from: vi.fn((table: string) => new QueryStub(table)),
    };

    const result = await fetchMemoryCardsForQuery({
      supabase: supabase as never,
      query: "lithium monitoring",
      ownerId: "user-1",
      matchCount: 8,
    });

    expect(result).toEqual([]);
  });

  it("scopes anonymous lexical memory-card reads and generation hydration to public rows", async () => {
    const scopeCalls: string[] = [];
    const publicCard = {
      id: "public-card",
      document_id: "public-doc",
      owner_id: null,
      section_id: null,
      card_type: "section_summary",
      title: "Public",
      content: "Public monitoring guidance.",
      normalized_terms: ["monitoring"],
      page_number: 1,
      source_chunk_ids: ["public-chunk"],
      source_image_ids: [],
      confidence: 0.9,
      metadata: { index_generation_id: "g1" },
    } satisfies DocumentMemoryCard;
    const foreignCard = {
      ...publicCard,
      id: "foreign-card",
      document_id: "foreign-doc",
      owner_id: "owner-b",
      source_chunk_ids: ["foreign-chunk"],
    };
    const mismatchedPublicCard = {
      ...publicCard,
      id: "mismatched-public-card",
      document_id: "foreign-doc",
      owner_id: null,
      source_chunk_ids: ["foreign-chunk"],
    };
    const ownerCard = {
      ...publicCard,
      id: "owner-card",
      document_id: "owner-doc",
      owner_id: "owner-a",
      source_chunk_ids: ["owner-chunk"],
    };
    class QueryStub implements PromiseLike<{ data: unknown[]; error: null }> {
      private owner: string | null | undefined;
      private includePublic = false;
      constructor(private readonly table: string) {}
      select() {
        return this;
      }
      textSearch() {
        return this;
      }
      order() {
        return this;
      }
      limit() {
        return this;
      }
      in() {
        return this;
      }
      eq(column: string, value: unknown) {
        if (column === "owner_id") this.owner = String(value);
        return this;
      }
      is(column: string) {
        if (column === "owner_id") {
          this.owner = null;
          scopeCalls.push(`${this.table}:public`);
        }
        return this;
      }
      or(value: string) {
        this.includePublic = value.includes("owner_id.is.null");
        this.owner = value.match(/owner_id\.eq\.([^,]+)/)?.[1];
        scopeCalls.push(`${this.table}:${value}`);
        return this;
      }
      then<TResult1 = { data: unknown[]; error: null }, TResult2 = never>(
        onfulfilled?: ((value: { data: unknown[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) {
        const matchesOwner = (ownerId: string | null) =>
          this.owner === undefined ||
          (this.owner === null ? ownerId === null : ownerId === this.owner || (this.includePublic && ownerId === null));
        const rows =
          this.table === "document_memory_cards"
            ? [publicCard, ownerCard, foreignCard, mismatchedPublicCard].filter((row) => matchesOwner(row.owner_id))
            : [
                { id: "public-doc", owner_id: null, metadata: { index_generation_id: "g1" } },
                { id: "owner-doc", owner_id: "owner-a", metadata: { index_generation_id: "g1" } },
                { id: "foreign-doc", owner_id: "owner-b", metadata: { index_generation_id: "g1" } },
              ].filter((row) => matchesOwner(row.owner_id));
        return Promise.resolve({ data: rows, error: null }).then(onfulfilled, onrejected);
      }
    }
    const result = await fetchMemoryCardsForQuery({
      supabase: { from: vi.fn((table: string) => new QueryStub(table)) } as never,
      query: "monitoring",
      accessScope: { includePublic: true },
    });
    expect(result.map((card) => card.id)).toEqual(["public-card"]);
    expect(scopeCalls).toEqual(expect.arrayContaining(["document_memory_cards:public", "documents:public"]));

    const authenticated = await fetchMemoryCardsForQuery({
      supabase: { from: vi.fn((table: string) => new QueryStub(table)) } as never,
      query: "monitoring",
      ownerId: "owner-a",
      accessScope: { ownerId: "owner-a", includePublic: true },
    });
    expect(authenticated.map((card) => card.id).sort()).toEqual(["owner-card", "public-card"]);
  });

  it.each(["42883", "PGRST202"])(
    "orders and globally limits memory-card %s rollout fallback like the SQL wrapper",
    async (missingCode) => {
      const row = (id: string, hybridScore: number, rrfScore: number) => ({
        id,
        document_id: `${id}-doc`,
        owner_id: id.includes("owner") ? "owner-a" : null,
        section_id: null,
        card_type: "section_summary" as const,
        title: id,
        content: id,
        normalized_terms: [],
        page_number: 1,
        source_chunk_ids: [],
        source_image_ids: [],
        confidence: 0.8,
        metadata: {},
        similarity: 0.8,
        text_rank: 0.7,
        hybrid_score: hybridScore,
        rrf_score: rrfScore,
      });
      const rpc = vi.fn(async (name: string, args: { owner_filter?: string }) => {
        if (name === "match_document_memory_cards_hybrid_v3") {
          return { data: null, error: { code: missingCode, message: "missing" } };
        }
        return args.owner_filter === "owner-a"
          ? { data: [row("z-owner", 0.9, 0.1), row("top-owner", 0.95, 0.01)], error: null }
          : { data: [row("a-public", 0.9, 0.1)], error: null };
      });
      const result = await fetchMemoryCardsForQuery({
        supabase: { rpc } as never,
        query: "monitoring",
        queryEmbedding: [0.1],
        ownerId: "owner-a",
        accessScope: { ownerId: "owner-a", includePublic: true },
        matchCount: 2,
      });
      expect(result.map((card) => card.id)).toEqual(["top-owner", "a-public"]);
    },
  );

  it("persists memory cards without leaking internal section indexes into inserts", async () => {
    const insertedSections: Record<string, unknown>[] = [];
    const insertedMemoryRows: Record<string, unknown>[] = [];
    const insertedIndexUnits: Record<string, unknown>[] = [];
    const updatedRows = new Map<string, Record<string, unknown>[]>();
    const rpc = vi.fn(async () => ({
      data: { committed: true, updated_at: "snapshot-next", metadata: document.metadata },
      error: null,
    }));
    const supabase = {
      from: vi.fn((table: string) => ({
        insert: (payload: Record<string, unknown>[]) => {
          if (table === "document_sections") {
            insertedSections.push(...payload);
            return {
              select: async () => ({
                data: payload.map((section, index) => ({
                  id: `section-${index}`,
                  section_index: section.section_index,
                })),
                error: null,
              }),
            };
          }
          if (table === "document_index_units") {
            insertedIndexUnits.push(...payload);
            return Promise.resolve({ data: null, error: null });
          }
          insertedMemoryRows.push(...payload);
          return Promise.resolve({ data: null, error: null });
        },
        select: (columns: string) => ({
          eq: (column: string, value: unknown) => {
            void columns;
            void column;
            void value;
            if (table === "documents") {
              return {
                single: async () => ({ data: { metadata: {} }, error: null }),
              };
            }
            if (table === "document_chunks") {
              return Promise.resolve({
                data: [{ id: "chunk-upsert", metadata: {} }],
                error: null,
              });
            }
            if (["document_sections", "document_memory_cards", "document_index_units"].includes(table)) {
              return Promise.resolve({ data: [], error: null });
            }
            return {
              single: async () => ({ data: null, error: null }),
            };
          },
        }),
        update: (payload: Record<string, unknown>) => ({
          eq: (column: string, value: unknown) => {
            void column;
            void value;
            updatedRows.set(table, [...(updatedRows.get(table) ?? []), payload]);
            return Promise.resolve({ data: null, error: null });
          },
        }),
      })),
      rpc,
    };

    await upsertDocumentDeepMemory({
      supabase: supabase as never,
      document,
      chunks: [
        chunk({
          id: "chunk-upsert",
          content: "If ANC is < 1.5, stop clozapine and urgent specialist review is required.",
        }),
      ],
    });

    expect(insertedMemoryRows.length).toBeGreaterThan(0);
    expect(insertedIndexUnits.length).toBeGreaterThan(0);
    expect(insertedIndexUnits.some((row) => row.unit_type === "document_profile")).toBe(true);
    expect(insertedMemoryRows.every((row) => !("section_index" in row))).toBe(true);
    expect(insertedMemoryRows.every((row) => typeof row.section_id === "string" || row.section_id === null)).toBe(true);
    const artifactGeneration = insertedSections[0]?.artifact_generation_id;
    expect(artifactGeneration).toEqual(expect.any(String));
    for (const row of [...insertedSections, ...insertedMemoryRows, ...insertedIndexUnits]) {
      expect(row).toEqual(
        expect.objectContaining({
          producer: "local-worker",
          artifact_generation_id: artifactGeneration,
          index_generation_id: artifactGeneration,
        }),
      );
      expect(row.metadata).toEqual(
        expect.objectContaining({
          generated_by: "local-worker",
          artifact_generation_id: artifactGeneration,
          index_generation_id: artifactGeneration,
        }),
      );
      expect(
        isCommittedGenerationMetadata({
          rowMetadata: row.metadata,
          committedGeneration: "00000000-0000-4000-8000-000000000010",
        }),
      ).toBe(false);
    }
    expect(updatedRows.has("documents")).toBe(false);
    expect(updatedRows.has("document_chunks")).toBe(false);
    expect(rpc).toHaveBeenCalledWith("commit_document_maintenance_deep_memory", {
      p_aliases: [],
      p_owner_id: document.owner_id,
      p_expected_updated_at: "snapshot-A",
      p_expected_generation_id: document.metadata.index_generation_id,
      p_chunk_patches: expect.arrayContaining([
        expect.objectContaining({
          id: "chunk-upsert",
          metadata: expect.objectContaining({ rag_memory_version: ragDeepMemoryVersion }),
        }),
      ]),
      p_artifact_generation_id: artifactGeneration,
      p_document_id: document.id,
      p_document_intelligence_version: expect.any(String),
      p_index_unit_counts_by_type: expect.objectContaining({ document_profile: 1 }),
      p_memory_card_count: insertedMemoryRows.length,
      p_producer: "local-worker",
      p_rag_memory_version: ragDeepMemoryVersion,
      p_repaired_anchor_count: expect.any(Number),
      p_section_count: insertedSections.length,
    });
  });

  it("refuses unassigned legacy artifact lineage before provider work or staging", async () => {
    generateModelIndexProfileMock.mockClear();
    const supabase = {
      from: vi.fn((table: string) => ({
        select: () => ({
          eq: async () => ({
            data:
              table === "document_sections"
                ? [
                    {
                      producer: "local-worker",
                      artifact_generation_id: null,
                      index_generation_id: null,
                      metadata: { generated_by: "local-worker" },
                    },
                  ]
                : [],
            error: null,
          }),
        }),
      })),
    };
    await expect(
      upsertDocumentDeepMemory({ supabase: supabase as never, document, chunks: [chunk({})] }),
    ).rejects.toThrow("legacy_generation_lineage_requires_fenced_reindex");
    expect(generateModelIndexProfileMock).not.toHaveBeenCalled();
  });

  it.each([{}, { index_generation_id: "" }, { index_generation_id: "not-a-uuid" }])(
    "refuses a snapshot with no committed generation (%j) before provider work or staging",
    async (metadata) => {
      generateModelIndexProfileMock.mockClear();
      const supabase = { from: vi.fn(() => ({ select: () => ({ eq: async () => ({ data: [], error: null }) }) })) };
      await expect(
        upsertDocumentDeepMemory({
          supabase: supabase as never,
          document: { ...document, metadata },
          chunks: [chunk({})],
        }),
      ).rejects.toThrow("has no committed index generation");
      expect(generateModelIndexProfileMock).not.toHaveBeenCalled();
      expect(supabase.from).not.toHaveBeenCalled();
    },
  );

  it("rejects mixed local and agent artifacts before model generation, embeddings, or deletion", async () => {
    generateModelIndexProfileMock.mockClear();
    const deleteSpy = vi.fn();
    const rowsByTable: Record<string, unknown[]> = {
      document_sections: [{ metadata: { generated_by: "local-worker" } }],
      document_memory_cards: [{ metadata: { generated_by: "indexing-v3-agent" } }],
      document_index_units: [],
    };
    const supabase = {
      from: vi.fn((table: string) => ({
        select: () => ({
          eq: async () => ({ data: rowsByTable[table] ?? [], error: null }),
        }),
        delete: deleteSpy,
      })),
    };

    await expect(
      upsertDocumentDeepMemory({ supabase: supabase as never, document, chunks: [chunk({})] }),
    ).rejects.toBeInstanceOf(DeepMemoryOwnershipConflictError);
    expect(generateModelIndexProfileMock).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it("rejects ambiguous producer metadata", async () => {
    const supabase = {
      from: vi.fn((table: string) => ({
        select: () => ({
          eq: async () => ({
            data: table === "document_sections" ? [{ metadata: { unexpected: true } }] : [],
            error: null,
          }),
        }),
      })),
    };

    await expect(
      upsertDocumentDeepMemory({ supabase: supabase as never, document, chunks: [chunk({})] }),
    ).rejects.toBeInstanceOf(DeepMemoryOwnershipConflictError);
  });

  it("rejects contradictory explicit producer and legacy ownership metadata", async () => {
    const supabase = {
      from: vi.fn((table: string) => ({
        select: () => ({
          eq: async () => ({
            data:
              table === "document_sections"
                ? [{ producer: "indexing-v3-agent", metadata: { generated_by: "local-worker" } }]
                : [],
            error: null,
          }),
        }),
      })),
    };

    await expect(
      upsertDocumentDeepMemory({ supabase: supabase as never, document, chunks: [chunk({})] }),
    ).rejects.toBeInstanceOf(DeepMemoryOwnershipConflictError);
  });

  it("rejects a null ownership query result instead of treating it as an empty table", async () => {
    const supabase = {
      from: vi.fn((table: string) => ({
        select: () => ({
          eq: async () => ({ data: table === "document_memory_cards" ? null : [], error: null }),
        }),
      })),
    };

    await expect(
      upsertDocumentDeepMemory({ supabase: supabase as never, document, chunks: [chunk({})] }),
    ).rejects.toBeInstanceOf(DeepMemoryOwnershipConflictError);
  });

  it("allows fully local artifacts including legacy versioned sections", async () => {
    generateModelIndexProfileMock.mockClear();
    const queriedTables: string[] = [];
    const rowsByTable: Record<string, unknown[]> = {
      document_sections: [{ metadata: { rag_indexing_version: ragDeepMemoryVersion } }],
      document_memory_cards: [{ metadata: { generated_by: "local-worker" } }],
      document_index_units: [{ metadata: { generated_by: "local-worker" } }],
    };
    const supabase = {
      from: vi.fn((table: string) => ({
        select: () => ({
          eq: async () => {
            queriedTables.push(table);
            return { data: rowsByTable[table] ?? [], error: null };
          },
        }),
      })),
    };

    await expect(
      upsertDocumentDeepMemory({ supabase: supabase as never, document, chunks: [chunk({})] }),
    ).rejects.not.toBeInstanceOf(DeepMemoryOwnershipConflictError);
    expect(queriedTables).toEqual(
      expect.arrayContaining(["document_sections", "document_memory_cards", "document_index_units"]),
    );
    expect(generateModelIndexProfileMock).toHaveBeenCalledOnce();
  });

  it("allows legacy local memory cards and index units without producer metadata", async () => {
    const rowsByTable: Record<string, unknown[]> = {
      document_sections: [{ metadata: { rag_indexing_version: "rag-deep-memory-v1" } }],
      document_memory_cards: [{ producer: null, artifact_generation_id: null, metadata: {} }],
      document_index_units: [{ producer: null, artifact_generation_id: null, metadata: {} }],
    };
    const supabase = {
      from: vi.fn((table: string) => ({
        select: () => ({
          eq: async () => ({ data: rowsByTable[table] ?? [], error: null }),
        }),
      })),
    };

    await expect(assertLocalDeepMemoryOwnership(supabase as never, "doc-1")).resolves.toBeUndefined();
  });

  it.each(["document_sections", "document_memory_cards", "document_index_units"])(
    "keeps committed artifacts and document metadata untouched when staging %s fails",
    async (failingTable) => {
      const operations: string[] = [];
      const supabase = {
        from: vi.fn((table: string) => ({
          select: () => ({ eq: async () => ({ data: [], error: null }) }),
          delete: () => {
            operations.push(`delete:${table}:staged`);
            const query = { eq: () => query };
            return query;
          },
          insert: (payload: Record<string, unknown>[]) => {
            operations.push(`insert:${table}`);
            const result = {
              data:
                table === "document_sections"
                  ? payload.map((row, index) => ({ id: `section-${index}`, section_index: row.section_index }))
                  : null,
              error: table === failingTable ? { message: `${table} stage failed` } : null,
            };
            return table === "document_sections" ? { select: async () => result } : Promise.resolve(result);
          },
          update: () => ({
            eq: async () => {
              operations.push(`update:${table}`);
              return { data: null, error: null };
            },
          }),
        })),
        rpc: vi.fn(async () => ({ data: null, error: null })),
      };

      await expect(
        upsertDocumentDeepMemory({
          supabase: supabase as never,
          document,
          chunks: [chunk({ content: "If ANC is below 1.5, stop clozapine and seek urgent specialist review." })],
        }),
      ).rejects.toThrow(`${failingTable} stage failed`);
      expect(operations).not.toContain("update:documents");
      expect(operations.some((operation) => operation.startsWith("delete:") && !operation.includes("staged"))).toBe(
        false,
      );
    },
  );

  it("keeps committed artifacts and document metadata untouched when the commit RPC fails", async () => {
    const operations: string[] = [];
    const supabase = {
      from: vi.fn((table: string) => ({
        select: () => ({ eq: async () => ({ data: [], error: null }) }),
        insert: (payload: Record<string, unknown>[]) => {
          operations.push(`insert:${table}`);
          if (table === "document_sections") {
            return {
              select: async () => ({
                data: payload.map((row, index) => ({ id: `section-${index}`, section_index: row.section_index })),
                error: null,
              }),
            };
          }
          return Promise.resolve({ data: null, error: null });
        },
        delete: () => ({
          eq: () => ({ eq: () => ({ eq: async () => ({ data: null, error: null }) }) }),
        }),
        update: () => ({
          eq: async () => {
            operations.push(`update:${table}`);
            return { data: null, error: null };
          },
        }),
      })),
      rpc: vi.fn(async () => ({ data: null, error: { message: "deep-memory commit failed" } })),
    };

    await expect(
      upsertDocumentDeepMemory({
        supabase: supabase as never,
        document,
        chunks: [chunk({ content: "If ANC is below 1.5, stop clozapine and seek urgent specialist review." })],
      }),
    ).rejects.toThrow("deep-memory commit failed");
    expect(operations).not.toContain("update:documents");
  });

  it("does not hide a staging failure when staged-row cleanup also fails", async () => {
    const failingDeleteBuilder = () => {
      let filterCount = 0;
      const builder = {
        eq: () => {
          filterCount += 1;
          if (filterCount === 7) throw new Error("cleanup failed");
          return builder;
        },
      };
      return builder;
    };
    const supabase = {
      from: vi.fn((table: string) => ({
        select: () => ({ eq: async () => ({ data: [], error: null }) }),
        insert: (payload: Record<string, unknown>[]) =>
          table === "document_sections"
            ? {
                select: async () => ({
                  data: payload.map((row, index) => ({ id: `section-${index}`, section_index: row.section_index })),
                  error: null,
                }),
              }
            : Promise.resolve({
                data: null,
                error: table === "document_index_units" ? { message: "original staging failure" } : null,
              }),
        delete: failingDeleteBuilder,
        update: () => ({ eq: async () => ({ data: null, error: null }) }),
      })),
      rpc: vi.fn(async () => ({ data: null, error: null })),
    };

    await expect(
      upsertDocumentDeepMemory({
        supabase: supabase as never,
        document,
        chunks: [chunk({ content: "If ANC is below 1.5, stop clozapine and seek urgent specialist review." })],
      }),
    ).rejects.toThrow("original staging failure");
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("cleanup targets only rows that still carry every staged-generation marker", async () => {
    const cleanupFilters = new Map<string, Array<[string, unknown]>>();
    const deleteBuilder = (table: string) => {
      const filters: Array<[string, unknown]> = [];
      cleanupFilters.set(table, filters);
      const builder = {
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          return builder;
        },
      };
      return builder;
    };
    const supabase = {
      from: vi.fn((table: string) => ({
        select: () => ({ eq: async () => ({ data: [], error: null }) }),
        insert: (payload: Record<string, unknown>[]) =>
          table === "document_sections"
            ? {
                select: async () => ({
                  data: payload.map((row, index) => ({ id: `section-${index}`, section_index: row.section_index })),
                  error: null,
                }),
              }
            : Promise.resolve({
                data: null,
                error: table === "document_index_units" ? { message: "index stage failed" } : null,
              }),
        delete: () => deleteBuilder(table),
        update: () => ({ eq: async () => ({ data: null, error: null }) }),
      })),
      rpc: vi.fn(async () => ({ data: null, error: null })),
    };

    await expect(
      upsertDocumentDeepMemory({
        supabase: supabase as never,
        document,
        chunks: [chunk({ content: "If ANC is below 1.5, stop clozapine and seek urgent specialist review." })],
      }),
    ).rejects.toThrow("index stage failed");

    for (const filters of cleanupFilters.values()) {
      const artifactGeneration = filters.find(([column]) => column === "artifact_generation_id")?.[1];
      expect(filters).toEqual([
        ["document_id", document.id],
        ["producer", "local-worker"],
        ["artifact_generation_id", artifactGeneration],
        ["index_generation_id", artifactGeneration],
        ["metadata->>generated_by", "local-worker"],
        ["metadata->>artifact_generation_id", artifactGeneration],
        ["metadata->>index_generation_id", artifactGeneration],
      ]);
    }
  });

  it("never cleans up a generation after an ambiguous committed-but-response-lost RPC outcome", async () => {
    const deleteCalls: string[] = [];
    const insertedRows: Record<string, Record<string, unknown>[]> = {};
    const supabase = {
      from: vi.fn((table: string) => ({
        select: () => ({ eq: async () => ({ data: [], error: null }) }),
        insert: (payload: Record<string, unknown>[]) => {
          insertedRows[table] = [...(insertedRows[table] ?? []), ...payload];
          return table === "document_sections"
            ? {
                select: async () => ({
                  data: payload.map((row, index) => ({ id: `section-${index}`, section_index: row.section_index })),
                  error: null,
                }),
              }
            : Promise.resolve({ data: null, error: null });
        },
        delete: () => ({
          eq: () => ({
            eq: () => ({
              eq: async () => {
                deleteCalls.push(table);
                return { data: null, error: null };
              },
            }),
          }),
        }),
        update: () => ({ eq: async () => ({ data: null, error: null }) }),
      })),
      rpc: vi.fn(async () => {
        // Model a transaction which committed before the transport lost the response.
        for (const rows of Object.values(insertedRows)) {
          for (const row of rows) row.index_generation_id = "committed-generation";
        }
        return { data: null, error: { message: "response lost after commit" } };
      }),
    };

    await expect(
      upsertDocumentDeepMemory({
        supabase: supabase as never,
        document,
        chunks: [chunk({ content: "If ANC is below 1.5, stop clozapine and seek urgent specialist review." })],
      }),
    ).rejects.toThrow("response lost after commit");
    expect(deleteCalls).toEqual([]);
    expect(
      Object.values(insertedRows)
        .flat()
        .every((row) => row.index_generation_id === "committed-generation"),
    ).toBe(true);
  });
});
