import { embedTexts } from "../src/lib/openai";
import { createHash } from "node:crypto";
import { IngestionAttempt } from "../supabase/functions/_shared/ingestion-attempt";
import { runIngestionEnrichmentStage, runIngestionMutation } from "../worker/behavior";
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
import { fallbackModelIndexProfile } from "../src/lib/model-index-extraction";
import { encodeShadowNodeJsonCanonicalPayload, prepareShadowProducerDeclarationV1 } from "../scripts/lib/reindex-eval-session";

vi.mock("@/lib/openai", () => ({
  embedTexts: vi.fn(async (texts: string[]) => texts.map(() => Array.from({ length: 1536 }, () => 0.01))),
}));

const { generateModelIndexProfileMock } = vi.hoisted(() => ({
  generateModelIndexProfileMock: vi.fn(async (): Promise<ReturnType<typeof fallbackModelIndexProfile>> => {
    throw new Error("model profile unavailable");
  }),
}));

vi.mock("@/lib/model-index-extraction", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/model-index-extraction")>()),
  generateModelIndexProfile: generateModelIndexProfileMock,
}));

const FENCE = {
  job_kind: "node" as const,
  job_id: "66666666-6666-4666-8666-666666666666",
  document_id: "11111111-1111-4111-8111-111111111111",
  worker_id: "worker",
  lease_token: "77777777-7777-4777-8777-777777777777",
  expected_generation_id: "22222222-2222-4222-8222-222222222222",
  authority_digest: `sha256:${"a".repeat(64)}`,
};

function pgProjectionEnvelope(payload: unknown, domain: "baseline" | "projection") {
  const canonicalPayload = JSON.stringify(payload);
  const header = `U04-SHADOW/1\n${domain}\npg-jsonb-text-v1\n${Buffer.byteLength(canonicalPayload, "utf8")}\n`;
  return {
    version: 1,
    domain,
    encoding: "pg-jsonb-text-v1",
    canonicalPayload,
    digest: `sha256:${createHash("sha256").update(header, "utf8").update(canonicalPayload, "utf8").digest("hex")}`,
  };
}
function memoryRpcHarness(
  options: { failStage?: string; failCleanup?: boolean; commitError?: string; lostResponse?: boolean } = {},
) {
  const staged: Record<string, Record<string, unknown>[]> = { sections: [], cards: [], units: [] };
  const directWrite = vi.fn(() => {
    throw new Error("unfenced direct write");
  });
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    expect(args.p_fence).toEqual(FENCE);
    if (name === "stage_ingestion_deep_memory") {
      for (const family of ["sections", "cards", "units"]) {
        const rows = args[`p_${family}`] as Record<string, unknown>[];
        if (rows.length && family === options.failStage)
          return { data: null, error: { message: `${family} stage failed` } };
        staged[family].push(...rows);
      }
      return {
        data: {
          ok: true,
          sections: staged.sections.map((row, index) => ({ id: `section-${index}`, section_index: row.section_index })),
        },
        error: null,
      };
    }
    if (name === "cleanup_ingestion_deep_memory_staging") {
      if (options.failCleanup) throw new Error("cleanup failed");
      for (const rows of Object.values(staged)) rows.length = 0;
      return { data: { ok: true }, error: null };
    }
    if (name === "commit_document_deep_memory_generation") {
      if (options.lostResponse)
        for (const rows of Object.values(staged))
          for (const row of rows) row.index_generation_id = FENCE.expected_generation_id;
      return options.commitError
        ? { data: null, error: { message: options.commitError } }
        : { data: { ok: true }, error: null };
    }
    throw new Error(`unexpected RPC ${name}`);
  });
  return {
    staged,
    directWrite,
    rpc,
    from: vi.fn(() => ({
      select: () => ({ eq: async () => ({ data: [], error: null }) }),
      insert: directWrite,
      update: directWrite,
      upsert: directWrite,
      delete: directWrite,
    })),
  };
}

const document = {
  id: "11111111-1111-4111-8111-111111111111",
  owner_id: "user-1",
  title: "Future Uploaded Clinical Protocol",
  file_name: "future-upload.pdf",
  source_path: "uploads/future-upload.pdf",
  metadata: {},
};

function chunk(overrides: Partial<SearchResult> & { chunk_index?: number; page_number?: number | null }) {
  return {
    id: overrides.id ?? "chunk-1",
    document_id: overrides.document_id ?? "11111111-1111-4111-8111-111111111111",
    page_number: overrides.page_number ?? 1,
    chunk_index: overrides.chunk_index ?? 0,
    section_heading: overrides.section_heading ?? "Clinical Workflow",
    content: overrides.content ?? "Clinical protocol text.",
    image_ids: overrides.image_ids ?? [],
    metadata: { index_generation_id: FENCE.expected_generation_id, ...(overrides.source_metadata ?? {}) },
  };
}

function result(overrides: Partial<SearchResult>): SearchResult {
  return {
    id: overrides.id ?? "chunk-1",
    document_id: overrides.document_id ?? "11111111-1111-4111-8111-111111111111",
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
          document_id: "11111111-1111-4111-8111-111111111111",
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
          document_id: "11111111-1111-4111-8111-111111111111",
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
        document_id: "11111111-1111-4111-8111-111111111111",
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
    let committedGeneration = FENCE.expected_generation_id;
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
      metadata: { index_generation_id: FENCE.expected_generation_id },
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
                { id: "public-doc", owner_id: null, metadata: { index_generation_id: committedGeneration } },
                { id: "owner-doc", owner_id: "owner-a", metadata: { index_generation_id: committedGeneration } },
                { id: "foreign-doc", owner_id: "owner-b", metadata: { index_generation_id: committedGeneration } },
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
    // U04 requires an actual UUID for document generation authority. The old
    // placeholder now correctly refuses; it cannot stand in for public G0.
    committedGeneration = "g1";
    await expect(fetchMemoryCardsForQuery({
      supabase: { from: vi.fn((table: string) => new QueryStub(table)) } as never,
      query: "monitoring", accessScope: { includePublic: true },
    })).resolves.toEqual([]);
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

  it("persists memory cards without leaking section indexes and binds all batches to the attempt", async () => {
    const supabase = memoryRpcHarness();
    await upsertDocumentDeepMemory({
      supabase: supabase as never,
      fence: FENCE,
      document,
      chunks: [chunk({ content: "If ANC is below 1.5, stop clozapine and seek urgent review." })],
    });
    expect(supabase.staged.cards.length).toBeGreaterThan(0);
    expect(supabase.staged.units.some((row) => row.unit_type === "document_profile")).toBe(true);
    expect(supabase.staged.cards.every((row) => !("section_index" in row))).toBe(true);
    const generation = supabase.staged.sections[0].artifact_generation_id;
    for (const row of Object.values(supabase.staged).flat()) {
      expect(row).toMatchObject({
        producer: "local-worker",
        artifact_generation_id: generation,
        index_generation_id: generation,
      });
      expect(row.metadata).toMatchObject({ ingestion_lease_token: FENCE.lease_token, generated_by: "local-worker" });
      expect(
        isCommittedGenerationMetadata({ rowMetadata: row.metadata, committedGeneration: FENCE.expected_generation_id }),
      ).toBe(false);
    }
    expect(supabase.rpc).toHaveBeenLastCalledWith(
      "commit_document_deep_memory_generation",
      expect.objectContaining({
        p_fence: FENCE,
        p_artifact_generation: generation,
        p_anchors: [],
        p_aliases: [],
        p_memory_card_count: supabase.staged.cards.length,
        p_section_count: supabase.staged.sections.length,
      }),
    );
    expect(supabase.directWrite).not.toHaveBeenCalled();
  });

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
      upsertDocumentDeepMemory({ supabase: supabase as never, fence: FENCE, document, chunks: [chunk({})] }),
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
      upsertDocumentDeepMemory({ supabase: supabase as never, fence: FENCE, document, chunks: [chunk({})] }),
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
      upsertDocumentDeepMemory({ supabase: supabase as never, fence: FENCE, document, chunks: [chunk({})] }),
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
      upsertDocumentDeepMemory({ supabase: supabase as never, fence: FENCE, document, chunks: [chunk({})] }),
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
      upsertDocumentDeepMemory({ supabase: supabase as never, fence: FENCE, document, chunks: [chunk({})] }),
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

    await expect(
      assertLocalDeepMemoryOwnership(supabase as never, "11111111-1111-4111-8111-111111111111"),
    ).resolves.toBeUndefined();
  });

  it.each(["sections", "cards", "units"])("preserves committed evidence when %s staging fails", async (family) => {
    const supabase = memoryRpcHarness({ failStage: family });
    await expect(
      upsertDocumentDeepMemory({
        supabase: supabase as never,
        fence: FENCE,
        document,
        chunks: [chunk({ content: "Check ANC before review." })],
      }),
    ).rejects.toThrow(`${family} stage failed`);
    expect(supabase.rpc.mock.calls.some(([name]) => name === "commit_document_deep_memory_generation")).toBe(false);
    expect(supabase.directWrite).not.toHaveBeenCalled();
  });
  it("treats fenced cleanup transport failure as fatal after local construction failure", async () => {
    vi.mocked(embedTexts).mockImplementationOnce(async (texts) => texts.map(() => [0.01]));
    const supabase = memoryRpcHarness({ failCleanup: true });
    await expect(
      upsertDocumentDeepMemory({ supabase: supabase as never, fence: FENCE, document, chunks: [chunk({})] }),
    ).rejects.toMatchObject({ code: "ingestion_rpc_invalid", message: "cleanup failed" });
    expect(supabase.rpc.mock.calls.filter(([name]) => name === "cleanup_ingestion_deep_memory_staging")).toHaveLength(
      1,
    );
    expect(supabase.directWrite).not.toHaveBeenCalled();
  });
  it("passes exact attempt and unpublished artifact generation to cleanup", async () => {
    vi.mocked(embedTexts).mockImplementationOnce(async (texts) => texts.map(() => [0.01]));
    const supabase = memoryRpcHarness();
    await expect(
      upsertDocumentDeepMemory({ supabase: supabase as never, fence: FENCE, document, chunks: [chunk({})] }),
    ).rejects.toThrow("document_memory_cards");
    const generation = supabase.rpc.mock.calls[0][1].p_artifact_generation;
    expect(supabase.rpc).toHaveBeenLastCalledWith("cleanup_ingestion_deep_memory_staging", {
      p_fence: FENCE,
      p_artifact_generation: generation,
    });
    expect(supabase.directWrite).not.toHaveBeenCalled();
  });
  it.each([false, true])("never cleans after commit invocation, including lost response=%s", async (lostResponse) => {
    const supabase = memoryRpcHarness({ commitError: "response lost after commit", lostResponse });
    await expect(
      upsertDocumentDeepMemory({ supabase: supabase as never, fence: FENCE, document, chunks: [chunk({})] }),
    ).rejects.toThrow("response lost after commit");
    expect(supabase.rpc.mock.calls.some(([name]) => name === "cleanup_ingestion_deep_memory_staging")).toBe(false);
    expect(supabase.directWrite).not.toHaveBeenCalled();
    if (lostResponse)
      expect(
        Object.values(supabase.staged)
          .flat()
          .every((row) => row.index_generation_id === FENCE.expected_generation_id),
      ).toBe(true);
  });
  it("refuses missing generation evidence before models or mutations", async () => {
    const supabase = memoryRpcHarness();
    generateModelIndexProfileMock.mockClear();
    await expect(
      upsertDocumentDeepMemory({
        supabase: supabase as never,
        fence: FENCE,
        document,
        chunks: [{ ...chunk({}), metadata: {} }],
      }),
    ).rejects.toMatchObject({ code: "ingestion_attempt_required" });
    expect(generateModelIndexProfileMock).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
  it("cancellation during model generation escapes deterministic fallback before embedding or staging", async () => {
    const supabase = memoryRpcHarness();
    const controller = new AbortController();
    generateModelIndexProfileMock.mockImplementationOnce(async () => {
      controller.abort(new Error("claim replaced"));
      throw new Error("model canceled");
    });
    await expect(
      upsertDocumentDeepMemory({
        supabase: supabase as never,
        fence: FENCE,
        signal: controller.signal,
        document,
        chunks: [chunk({})],
      }),
    ).rejects.toThrow("claim replaced");
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});

describe("review correction: actual deep-memory optional orchestration", () => {
  it.each(["sections", "cards", "units", "lost commit response", "rejected stage"])(
    "cancels %s without cleanup or continuation",
    async (failure) => {
      const supabase = memoryRpcHarness(
        failure === "lost commit response"
          ? { commitError: "response lost", lostResponse: true }
          : { failStage: failure },
      );
      if (failure === "rejected stage") supabase.rpc.mockRejectedValueOnce(new Error("stage transport rejected"));
      const attempt = new IngestionAttempt(FENCE);
      const later = vi.fn(async () => ({ data: { ok: true }, error: null }));
      const process = async () => {
        await runIngestionEnrichmentStage(attempt, () =>
          upsertDocumentDeepMemory({
            supabase: supabase as never,
            fence: attempt.fence,
            signal: attempt.signal,
            document,
            chunks: [chunk({ content: "If ANC is low, stop clozapine and obtain urgent review." })],
          }),
        );
        await runIngestionMutation(attempt, later, "persist_ingestion_index_quality");
        await runIngestionMutation(attempt, later, "complete_ingestion_job");
      };
      await expect(process()).rejects.toBeDefined();
      expect(attempt.signal.aborted).toBe(true);
      expect(later).not.toHaveBeenCalled();
      expect(supabase.rpc.mock.calls.some(([name]) => name === "cleanup_ingestion_deep_memory_staging")).toBe(false);
    },
  );
  it("review correction: cleanup uncertainty cancels actual optional orchestration", async () => {
    vi.mocked(embedTexts).mockImplementationOnce(async (texts) => texts.map(() => [0.01]));
    const supabase = memoryRpcHarness({ failCleanup: true });
    const attempt = new IngestionAttempt(FENCE);
    const later = vi.fn(async () => ({ data: { ok: true }, error: null }));
    const process = async () => {
      await runIngestionEnrichmentStage(attempt, () =>
        upsertDocumentDeepMemory({
          supabase: supabase as never,
          fence: attempt.fence,
          signal: attempt.signal,
          document,
          chunks: [chunk({})],
        }),
      );
      await runIngestionMutation(attempt, later, "complete_ingestion_job");
    };
    await expect(process()).rejects.toBeDefined();
    expect(attempt.signal.aborted).toBe(true);
    expect(later).not.toHaveBeenCalled();
  });
  it("keeps an ordinary optional model failure distinct while subsequent fenced RPCs succeed", async () => {
    const attempt = new IngestionAttempt(FENCE);
    const optional = await runIngestionEnrichmentStage(attempt, async () => {
      throw new Error("optional model unavailable");
    });
    expect(optional).toMatchObject({ status: "failed" });
    const rpc = vi.fn(async () => ({ data: { ok: true }, error: null }));
    await runIngestionMutation(attempt, rpc, "update_ingestion_job_progress");
    expect(attempt.signal.aborted).toBe(false);
    expect(rpc).toHaveBeenCalledOnce();
  });
});

describe("actual shadow deep-memory producer", () => {
  type Args = Parameters<typeof upsertDocumentDeepMemory>[0];
  function shadowDeepFixture(
    refuse: boolean,
    mutateDuringDeclaration = false,
    acknowledgement: (valid: Record<string, unknown>) => unknown = valid => valid,
  ) {
    const candidate = "33333333-3333-4333-8333-333333333333";
    const binding: NonNullable<Args["shadow"]>["binding"] = { tag: "candidate", source: { version: 1,
      originDigest: `sha256:${"b".repeat(64)}`, executionProfileDigest: `sha256:${"c".repeat(64)}`,
      documentId: FENCE.document_id, ownerId: null, contentHash: `sha256:${"d".repeat(64)}`,
      authorityDigest: FENCE.authority_digest, sourcePolicyVersion: "synthetic-policy-v1", manualAliasIds: [],
      baselineGenerationId: FENCE.expected_generation_id, source: { tag: "document_owned" } },
      candidateGenerationId: candidate, jobId: FENCE.job_id, firstLeaseToken: FENCE.lease_token, artifactGenerationId: null };
    const outputs: ReturnType<typeof prepareShadowProducerDeclarationV1>[] = [];
    const events: string[] = [];
    const mutationResults: boolean[] = [];
    const failures: unknown[] = [];
    const rpc = vi.fn(async (name: string, payload: Record<string, unknown>) => {
      events.push(name);
      expect(name).toBe("persist_shadow_deep_memory_projection");
      expect(payload.p_fence).toEqual(FENCE);
      expect(payload.p_generation).toBe(candidate);
      expect(payload.p_output_manifest).toEqual(outputs[0]!.outputManifestEnvelope);
      const declared = JSON.parse(outputs[0]!.outputManifestEnvelope.canonicalPayload);
      const sectionOutput = declared.units.find(
        (unit: { family: string; key: string }) => unit.family === "sections" && unit.key === "deep:0",
      ).output;
      expect(payload.p_request).toEqual(sectionOutput.producerContext.request);
      const request = payload.p_request as Record<string, unknown>;
      const sqlCreatedAt = "2026-09-13T01:02:03.000000Z";
      const sqlUpdatedAt = "2026-09-13T01:02:03.000001Z";
      const sqlFinalizedAt = "2026-09-13T01:02:03.000002+00:00";
      const sqlId = (family: number, index: number) =>
        `${family}0000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
      const units = declared.units as Array<{
        family: "sections" | "memory_cards" | "index_units" | "producer_aliases";
        key: string;
        output: { nativeInput: Record<string, unknown>; sectionAssociation?: { tag: string; index?: number } };
      }>;
      const sectionUnits = units.filter(unit => unit.family === "sections");
      const sectionIds = sectionUnits.map((_unit, index) => sqlId(1, index));
      const storedRow = (unit: (typeof units)[number], family: number, index: number) => {
        const native = unit.output.nativeInput;
        const row: Record<string, unknown> = {
          ...native,
          id: sqlId(family, index),
          created_at: sqlCreatedAt,
          updated_at: sqlUpdatedAt,
          metadata: {
            ...(native.metadata as Record<string, unknown>),
            index_generation_id: candidate,
            ingestion_job_kind: "node",
            ingestion_job_id: FENCE.job_id,
            ingestion_lease_token: FENCE.lease_token,
          },
        };
        if (unit.family === "producer_aliases") row.owner_id = null;
        else row.index_generation_id = candidate;
        if (unit.family === "memory_cards") {
          const association = unit.output.sectionAssociation!;
          row.section_id = association.tag === "index" ? sectionIds[association.index!] : null;
          row.embedding = `[${(native.embedding as number[]).join(",")}]`;
          row.search_tsv = "'review':1";
        }
        if (unit.family === "index_units") {
          row.embedding = `[${(native.embedding as number[]).join(",")}]`;
          row.search_tsv = "'review':1";
        }
        return pgProjectionEnvelope(row, "baseline");
      };
      const rows = {
        sections: sectionUnits.map((unit, index) => storedRow(unit, 1, index)),
        cards: units.filter(unit => unit.family === "memory_cards").map((unit, index) => storedRow(unit, 2, index)),
        units: units.filter(unit => unit.family === "index_units").map((unit, index) => storedRow(unit, 3, index)),
        aliases: units.filter(unit => unit.family === "producer_aliases").map((unit, index) => storedRow(unit, 4, index)),
      };
      const receipt = pgProjectionEnvelope({
        kind: "u04-deep-memory-receipt-v1",
        binding: declared.binding,
        producer: "local-worker",
        outputManifestEnvelope: payload.p_output_manifest,
        request,
        rows,
        finalizedAt: sqlFinalizedAt,
      }, "projection");
      return { data: acknowledgement({
        ok: true,
        kind: "deep_memory_projected",
        projection_digest: `sha256:${"e".repeat(64)}`,
        receipt,
      }), error: null };
    });
    const from = vi.fn(() => { throw new Error("ordinary deep-memory mutation or ownership scan forbidden"); });
    const args: Args = { supabase: { rpc, from } as never, fence: FENCE,
      document: { ...document, owner_id: null, metadata: { index_generation_id: FENCE.expected_generation_id } },
      chunks: [{ ...chunk({ id: "88888888-8888-4888-8888-888888888888", content: "Document the review within 24 hours." }),
        anchor_id: null, metadata: { index_generation_id: candidate } }], images: [], summary: "Review documentation.",
      shadow: { binding, declareBatch: async batch => {
        const prepared = prepareShadowProducerDeclarationV1(binding, 8, batch);
        outputs.push(prepared); events.push("declare-full-deep-output");
        if (mutateDuringDeclaration) {
          const sectionOutput = batch.units.find(unit => unit.family === "sections" && unit.key === "deep:0")!.output as {
            producerContext: { request: { aliases: Array<{ metadata: { source_chunk_ids: string[] } }> } };
          };
          mutationResults.push(Reflect.set(
            sectionOutput.producerContext.request.aliases[0]!.metadata.source_chunk_ids,
            0,
            "99999999-9999-4999-8999-999999999999",
          ));
        }
        if (refuse) throw new Error("synthetic deep declaration refused");
        return prepared.outputManifestEnvelope;
      }, recordFailure: async failure => {
        failures.push(failure);
        throw new Error("shadow producer failure retained");
      } } };
    return { args, candidate, outputs, events, mutationResults, failures, rpc, from };
  }
  it("retains full original D output and section associations before private finalization under C and unchanged G0", async () => {
    const profile = fallbackModelIndexProfile();
    generateModelIndexProfileMock.mockResolvedValueOnce(profile);
    const fixture = shadowDeepFixture(false);
    const before = encodeShadowNodeJsonCanonicalPayload({ document: fixture.args.document, chunks: fixture.args.chunks, fence: fixture.args.fence });
    const result = await upsertDocumentDeepMemory(fixture.args);
    expect(fixture.events).toEqual(["declare-full-deep-output", "persist_shadow_deep_memory_projection"]);
    expect(fixture.from).not.toHaveBeenCalled();
    expect(fixture.rpc).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(fixture.outputs[0]!.outputManifestEnvelope.canonicalPayload);
    expect(payload.binding.artifactGenerationId).not.toBe(fixture.candidate);
    expect(payload.binding.artifactGenerationId).not.toBe(FENCE.expected_generation_id);
    expect(payload.units.find((unit: { family: string; key: string }) => unit.family === "sections" && unit.key === "deep:0").output.producerContext.modelProfile).toEqual(profile);
    expect(fixture.outputs[0]!.declarations.groups).toHaveLength(4);
    expect(result.sections.length).toBeGreaterThan(0);
    expect(result.memoryCards.length).toBeGreaterThan(0);
    const cards = payload.units.filter((unit: { family: string }) => unit.family === "memory_cards");
    expect(cards).toHaveLength(result.memoryCards.length);
    for (const card of cards) {
      expect(card.output.nativeInput).not.toHaveProperty("id");
      expect(card.output.nativeInput).not.toHaveProperty("created_at");
      expect(card.output.nativeInput.section_id).toBeNull();
      expect(card.output.nativeInput.index_generation_id).toBe(payload.binding.artifactGenerationId);
      expect(card.output.nativeInput.metadata.index_generation_id).toBe(payload.binding.artifactGenerationId);
      expect(card.output.nativeInput.embedding).toHaveLength(1536);
      expect(["index", "own_undefined", "absent"]).toContain(card.output.sectionAssociation.tag);
    }
    expect(encodeShadowNodeJsonCanonicalPayload({ document: fixture.args.document, chunks: fixture.args.chunks, fence: fixture.args.fence })).toBe(before);
  });

  it.each([
    ["missing receipt", (valid: Record<string, unknown>) => {
      const { receipt: _receipt, ...malformed } = valid; return malformed;
    }],
    ["wrong kind", (valid: Record<string, unknown>) => ({ ...valid, kind: "summary_projected" })],
    ["missing digest", (valid: Record<string, unknown>) => {
      const { projection_digest: _digest, ...malformed } = valid; return malformed;
    }],
    ["extra response key", (valid: Record<string, unknown>) => ({ ...valid, stale: true })],
    ["wrong receipt request", (valid: Record<string, unknown>) => {
      const envelope = valid.receipt as { canonicalPayload: string };
      const receipt = JSON.parse(envelope.canonicalPayload) as Record<string, unknown>;
      return { ...valid, receipt: pgProjectionEnvelope({ ...receipt, request: {
        ...(receipt.request as Record<string, unknown>), section_count: 999,
      } }, "projection") };
    }],
    ["invalid finalized-at timestamp", (valid: Record<string, unknown>) => {
      const envelope = valid.receipt as { canonicalPayload: string };
      const receipt = JSON.parse(envelope.canonicalPayload) as Record<string, unknown>;
      return { ...valid, receipt: pgProjectionEnvelope({ ...receipt, finalizedAt: "2026-09-13T25:02:03+00:00" }, "projection") };
    }],
    ["digest-valid substituted card content", (valid: Record<string, unknown>) => {
      const envelope = valid.receipt as { canonicalPayload: string };
      const receipt = JSON.parse(envelope.canonicalPayload) as Record<string, unknown>;
      const rows = structuredClone(receipt.rows) as Record<string, Array<{ canonicalPayload: string }>>;
      const row = JSON.parse(rows.cards[0]!.canonicalPayload) as Record<string, unknown>;
      rows.cards[0] = pgProjectionEnvelope({ ...row, content: "Substituted clinical content." }, "baseline");
      return { ...valid, receipt: pgProjectionEnvelope({ ...receipt, rows }, "projection") };
    }],
    ["digest-valid incomplete card row", (valid: Record<string, unknown>) => {
      const envelope = valid.receipt as { canonicalPayload: string };
      const receipt = JSON.parse(envelope.canonicalPayload) as Record<string, unknown>;
      const rows = structuredClone(receipt.rows) as Record<string, Array<{ canonicalPayload: string }>>;
      const row = JSON.parse(rows.cards[0]!.canonicalPayload) as Record<string, unknown>;
      const { content: _content, ...incomplete } = row;
      rows.cards[0] = pgProjectionEnvelope(incomplete, "baseline");
      return { ...valid, receipt: pgProjectionEnvelope({ ...receipt, rows }, "projection") };
    }],
  ] as const)("rejects a shadow deep-memory %s acknowledgement before later persistence", async (_fault, acknowledgement) => {
    generateModelIndexProfileMock.mockResolvedValueOnce(fallbackModelIndexProfile());
    const fixture = shadowDeepFixture(false, false, acknowledgement);
    const laterPersistence = vi.fn();
    const process = async () => {
      await upsertDocumentDeepMemory(fixture.args);
      await laterPersistence();
    };
    await expect(process()).rejects.toMatchObject({ code: "ingestion_rpc_invalid" });
    expect(fixture.rpc).toHaveBeenCalledOnce();
    expect(fixture.failures).toEqual([]);
    expect(fixture.from).not.toHaveBeenCalled();
    expect(laterPersistence).not.toHaveBeenCalled();
  });
  it("keeps a refused deep declaration from staging, committing, cleaning up or mutating ordinary memory", async () => {
    generateModelIndexProfileMock.mockResolvedValueOnce(fallbackModelIndexProfile());
    const fixture = shadowDeepFixture(true);
    await expect(upsertDocumentDeepMemory(fixture.args)).rejects.toThrow("synthetic deep declaration refused");
    expect(fixture.events).toEqual(["declare-full-deep-output"]);
    expect(fixture.rpc).not.toHaveBeenCalled();
    expect(fixture.from).not.toHaveBeenCalled();
    expect(fixture.outputs).toHaveLength(1);
    // This is available producer memory, not a false claim of durability after
    // confirmed pre-commit refusal. No secondary retention writer is invoked.
    expect(fixture.outputs[0]!.outputManifestEnvelope.canonicalPayload).toContain("producerContext");
  });

  it("uses one immutable deep-memory snapshot for declaration and private persistence", async () => {
    const profile = { ...fallbackModelIndexProfile(), aliases: [{
      alias: "review", canonical: "clinical review", alias_type: "clinical_term",
      source_chunk_ids: ["88888888-8888-4888-8888-888888888888"], confidence: 0.9,
    }] };
    generateModelIndexProfileMock.mockResolvedValueOnce(profile);
    const fixture = shadowDeepFixture(false, true);
    await upsertDocumentDeepMemory(fixture.args);
    expect(fixture.mutationResults).toEqual([false]);
    expect(fixture.rpc).toHaveBeenCalledOnce();
    const persisted = fixture.rpc.mock.calls[0]![1] as {
      p_request: { aliases: Array<{ metadata: { source_chunk_ids: string[] } }> };
    };
    expect(persisted.p_request.aliases[0]!.metadata.source_chunk_ids)
      .toEqual(["88888888-8888-4888-8888-888888888888"]);
  });

  describe("U04 shadow producer failure retention", () => {
    it("retains the early D and exact sections when the shadow model profile fails instead of using fallback output", async () => {
      generateModelIndexProfileMock.mockRejectedValueOnce(new Error("provider detail must not be retained"));
      const fixture = shadowDeepFixture(false);
      await expect(upsertDocumentDeepMemory(fixture.args)).rejects.toThrow("shadow producer failure retained");
      expect(fixture.failures).toHaveLength(1);
      const failure = fixture.failures[0] as {
        phase: string;
        code: string;
        artifactGenerationId: string;
        input: { document: { id: string } };
        partial: { sections: unknown[] };
      };
      expect(failure).toMatchObject({
        phase: "deep_model_profile",
        code: "producer_failed",
        input: { document: { id: FENCE.document_id } },
      });
      expect(failure.artifactGenerationId).not.toBe(fixture.candidate);
      expect(failure.artifactGenerationId).not.toBe(FENCE.expected_generation_id);
      expect(failure.partial.sections.length).toBeGreaterThan(0);
      expect(JSON.stringify(failure)).not.toContain("provider detail must not be retained");
      expect(fixture.outputs).toEqual([]);
      expect(fixture.rpc).not.toHaveBeenCalled();
    });

    it("retains cards as partial evidence when shadow card embedding fails and never declares survivors", async () => {
      generateModelIndexProfileMock.mockResolvedValueOnce(fallbackModelIndexProfile());
      vi.mocked(embedTexts).mockRejectedValueOnce(new Error("embedding provider detail"));
      const fixture = shadowDeepFixture(false);
      await expect(upsertDocumentDeepMemory(fixture.args)).rejects.toThrow("shadow producer failure retained");
      expect(fixture.failures).toHaveLength(1);
      expect(fixture.failures[0]).toMatchObject({
        phase: "deep_card_embeddings",
        code: "producer_failed",
        partial: {
          sections: expect.any(Array),
          modelProfile: expect.any(Object),
          cards: expect.any(Array),
          embeddings: [],
        },
      });
      expect(JSON.stringify(fixture.failures[0])).not.toContain("embedding provider detail");
      expect(fixture.outputs).toEqual([]);
      expect(fixture.rpc).not.toHaveBeenCalled();
    });
  });
});
