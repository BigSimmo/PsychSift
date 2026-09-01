import { createHash } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import {
  SOURCE_ANCHORED_MAX_CHUNKS,
  SOURCE_ANCHORED_MAX_IMAGES,
  SOURCE_ANCHORED_SOURCE_PAGE_SIZE,
  requireExactSourceAnchoredGeneration,
} from "../supabase/functions/_shared/source-anchored-summary";

loadEnvConfig(process.cwd());

type Args = {
  allOwners: boolean;
  ownerId?: string;
  documentId?: string;
  limit: number;
  write: boolean;
  confirm: boolean;
  metadataOnly: boolean;
};

type SimpleSupabaseReader = { from: (table: string) => any };

/**
 * Parses command-line arguments into document repair options.
 *
 * @param argv - Command-line argument tokens.
 * @returns The validated repair options.
 * @throws Error if a required flag value is missing, no scope selector is provided, or the limit is not a positive integer.
 */
function parseArgs(argv: string[]): Args {
  const args: Args = {
    allOwners: false,
    ownerId: process.env.RAG_EVAL_OWNER_ID ?? process.env.LOCAL_NO_AUTH_OWNER_ID,
    limit: 10,
    write: false,
    confirm: false,
    metadataOnly: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--all-owners") {
      args.allOwners = true;
      args.ownerId = undefined;
      continue;
    }
    if (token === "--write") {
      args.write = true;
      continue;
    }
    if (token === "--confirm") {
      args.confirm = true;
      continue;
    }
    if (token === "--metadata-only") {
      args.metadataOnly = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${token}`);
    index += 1;
    if (token === "--owner-id") args.ownerId = value;
    if (token === "--document-id") args.documentId = value;
    if (token === "--limit") args.limit = Number.parseInt(value, 10);
  }
  if (!args.allOwners && !args.ownerId && !args.documentId) {
    throw new Error("Provide --owner-id, --document-id, --all-owners, or LOCAL_NO_AUTH_OWNER_ID/RAG_EVAL_OWNER_ID.");
  }
  if (!Number.isInteger(args.limit) || args.limit <= 0) throw new Error("--limit must be a positive integer.");
  // A document id is already an exact, service-role scoped selector. Keeping
  // the ambient local owner default here made public corpus repairs match zero
  // rows even when the requested document existed.
  if (args.documentId) args.ownerId = undefined;
  return args;
}

function metadataRecord(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? { ...(metadata as Record<string, unknown>) }
    : {};
}

function hashText(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function hashEmbeddingFieldText(value: string) {
  return createHash("md5").update(value).digest("hex");
}

function compactSearchText(value: unknown, limit = 900) {
  const clean = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length <= limit ? clean : clean.slice(0, limit).trim();
}

async function loadRows<T>(
  supabase: SimpleSupabaseReader,
  table: string,
  select: string,
  documentId: string,
  indexGenerationId: string,
) {
  const rows: T[] = [];
  const limit = table === "document_chunks" ? SOURCE_ANCHORED_MAX_CHUNKS : SOURCE_ANCHORED_MAX_IMAGES;
  for (let start = 0; ; start += SOURCE_ANCHORED_SOURCE_PAGE_SIZE) {
    let query = supabase
      .from(table)
      .select(select)
      .eq("document_id", documentId)
      .eq("index_generation_id", indexGenerationId);
    query =
      table === "document_chunks"
        ? query.order("chunk_index", { ascending: true }).order("id", { ascending: true })
        : query
            .order("clinical_relevance_score", { ascending: false, nullsFirst: false })
            .order("page_number", { ascending: true, nullsFirst: false })
            .order("id", { ascending: true });
    const { data, error } = await query.range(start, start + SOURCE_ANCHORED_SOURCE_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as T[]));
    if (rows.length > limit) throw new Error("source_anchored_summary_source_limit_exceeded");
    if (!data || data.length < SOURCE_ANCHORED_SOURCE_PAGE_SIZE) break;
  }
  return rows;
}

async function loadDocumentSummary(args: { supabase: unknown; documentId: string }) {
  const readable = args.supabase as {
    from: (table: string) => {
      select: (columns: string) => {
        eq: (
          column: string,
          value: unknown,
        ) => {
          maybeSingle: () => PromiseLike<{
            data: { summary?: string | null } | null;
            error: { message: string } | null;
          }>;
        };
      };
    };
  };
  const { data, error } = await readable
    .from("document_summaries")
    .select("summary")
    .eq("document_id", args.documentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.summary ?? null;
}

async function upsertDocumentLevelEmbeddingFields(args: {
  supabase: unknown;
  document: Record<string, unknown>;
  chunks: Record<string, unknown>[];
  summary: string | null;
  embedTexts: (texts: string[]) => Promise<number[][]>;
}) {
  const sourceChunkId = args.chunks[0]?.id;
  if (!sourceChunkId) return 0;
  const writable = args.supabase as {
    from: (table: string) => {
      delete: () => {
        eq: (
          column: string,
          value: unknown,
        ) => {
          in: (column: string, values: unknown[]) => PromiseLike<{ error: { message: string } | null }>;
        };
      };
      insert: (rows: Record<string, unknown>[]) => PromiseLike<{ error: { message: string } | null }>;
    };
  };
  const inputs = [
    {
      field_type: "document_title",
      content: compactSearchText(`${args.document.title ?? ""} ${args.document.file_name ?? ""}`, 600),
    },
    {
      field_type: "document_summary",
      content: compactSearchText(`${args.document.title ?? ""} ${args.summary ?? ""}`, 1200),
    },
  ].filter((input) => input.content);
  if (inputs.length === 0) return 0;

  const { error: deleteError } = await writable
    .from("document_embedding_fields")
    .delete()
    .eq("document_id", args.document.id)
    .in("field_type", ["document_title", "document_summary"]);
  if (deleteError) throw new Error(deleteError.message);

  const embeddings = await args.embedTexts(inputs.map((input) => input.content));
  const rows = inputs.map((input, index) => ({
    owner_id: args.document.owner_id ?? null,
    document_id: args.document.id,
    source_chunk_id: sourceChunkId,
    field_type: input.field_type,
    content: input.content,
    content_hash: hashEmbeddingFieldText(input.content),
    embedding: embeddings[index],
    metadata: { source: "backfill_document_level" },
  }));
  const { error } = await writable.from("document_embedding_fields").insert(rows);
  if (error) throw new Error(error.message);
  return rows.length;
}

async function countRows(args: { supabase: unknown; table: string; documentId: string }) {
  const readable = args.supabase as {
    from: (table: string) => {
      select: (
        columns: string,
        options?: Record<string, unknown>,
      ) => {
        eq: (
          column: string,
          value: unknown,
        ) => PromiseLike<{ count?: number | null; error: { message: string } | null }>;
      };
    };
  };
  const { count, error } = await readable
    .from(args.table)
    .select("id", { count: "exact", head: true })
    .eq("document_id", args.documentId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function upsertIndexQuality(args: {
  supabase: unknown;
  document: Record<string, unknown>;
  chunks: Record<string, unknown>[];
  images: Record<string, unknown>[];
  sectionCount: number;
  memoryCardCount: number;
  generationId: string;
}) {
  const chunkCount = args.chunks.length;
  const headingCount = args.chunks.filter((chunk) => String(chunk.section_heading ?? "").trim()).length;
  const fingerprints = args.chunks.map((chunk) => hashText(String(chunk.content ?? "")));
  const duplicateChunkRatio = chunkCount ? 1 - new Set(fingerprints).size / Math.max(fingerprints.length, 1) : 0;
  const avgChunkLength = chunkCount
    ? args.chunks.reduce((sum, chunk) => sum + String(chunk.content ?? "").length, 0) / chunkCount
    : 0;
  const headingDensity = chunkCount ? headingCount / chunkCount : 0;
  const tableImages = args.images.filter(
    (image) => image.source_kind === "table_crop" || image.image_type === "clinical_table",
  );
  const issues: string[] = [];
  if (chunkCount === 0) issues.push("no indexed chunks");
  if (avgChunkLength < 120 && chunkCount > 0) issues.push("short average chunks");
  if (headingDensity < 0.08 && chunkCount >= 8) issues.push("low heading density");
  if (duplicateChunkRatio > 0.18) issues.push("high duplicate chunk ratio");
  if (args.sectionCount === 0) issues.push("no structured sections");
  if (args.memoryCardCount === 0) issues.push("no memory cards");
  let qualityScore = 1 - issues.length * 0.08 - Math.min(0.2, duplicateChunkRatio * 0.5);
  if (headingDensity < 0.08 && chunkCount >= 8) qualityScore -= 0.08;
  qualityScore = Math.max(0, Math.min(1, qualityScore));
  const extractionQuality = qualityScore >= 0.78 ? "good" : qualityScore >= 0.48 ? "partial" : "poor";
  const metrics = {
    page_count:
      args.document.page_count ||
      Math.max(0, ...args.chunks.map((chunk) => Number(chunk.page_number ?? 0)).filter(Number.isFinite)),
    chunk_count: chunkCount,
    image_count: args.images.length,
    table_image_count: tableImages.length,
    text_character_count: args.chunks.reduce((sum, chunk) => sum + String(chunk.content ?? "").length, 0),
    avg_chunk_length: Number(avgChunkLength.toFixed(1)),
    duplicate_chunk_ratio: Number(duplicateChunkRatio.toFixed(3)),
    heading_density: Number(headingDensity.toFixed(3)),
    section_count: args.sectionCount,
    memory_card_count: args.memoryCardCount,
    index_generation_id: args.generationId,
  };
  const client = args.supabase as {
    rpc: (name: string, params: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }>;
    from: (table: string) => {
      upsert: (
        row: Record<string, unknown>,
        options?: Record<string, unknown>,
      ) => PromiseLike<{ error: { message: string } | null }>;
      update: (row: Record<string, unknown>) => {
        eq: (column: string, value: unknown) => PromiseLike<{ error: { message: string } | null }>;
      };
    };
  };
  const { error } = await client.from("document_index_quality").upsert(
    {
      document_id: args.document.id,
      owner_id: args.document.owner_id ?? null,
      quality_score: Number(qualityScore.toFixed(3)),
      extraction_quality: extractionQuality,
      issues,
      metrics,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "document_id" },
  );
  if (error) throw new Error(error.message);
  const { error: documentError } = await client
    .from("documents")
    .update({
      status: "indexed",
      error_message: null,
      page_count: metrics.page_count,
      chunk_count: chunkCount,
      image_count: args.images.length,
    })
    .eq("id", args.document.id);
  if (documentError) throw new Error(documentError.message);
  const { error: metadataError } = await client.rpc("apply_document_metadata_patch", {
    p_document_id: args.document.id,
    p_metadata_patch: {
      indexed_at: new Date().toISOString(),
      extraction_quality: extractionQuality,
      index_quality_score: Number(qualityScore.toFixed(3)),
      index_quality_issues: issues,
      index_quality_metrics: metrics,
    },
  });
  if (metadataError) throw new Error(metadataError.message);
  return { qualityScore: Number(qualityScore.toFixed(3)), extractionQuality, issues };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [
    { requireOpenAIEnv, requireServerEnv },
    { createAdminClient },
    { assertSourceAnchoredSummaryPreflight, upsertDocumentEnrichment },
    { upsertDocumentDeepMemory, ragDeepMemoryVersion },
    { embedTexts },
  ] = await Promise.all([
    import("@/lib/env"),
    import("@/lib/supabase/admin"),
    import("@/lib/document-enrichment"),
    import("@/lib/deep-memory"),
    import("@/lib/openai"),
  ]);
  requireServerEnv();
  requireOpenAIEnv();
  const supabase = createAdminClient();
  const reader = supabase as unknown as SimpleSupabaseReader;
  let query = supabase
    .from("documents")
    .select("id,owner_id,title,file_name,source_path,status,index_generation_id,metadata")
    .order("created_at", { ascending: true })
    .limit(args.documentId ? 1 : args.limit);
  if (!args.documentId) query = query.eq("status", "indexed");
  if (args.documentId) query = query.eq("id", args.documentId);
  if (args.ownerId) query = query.eq("owner_id", args.ownerId);
  const { data: documents, error } = await query;
  if (error) throw new Error(error.message);

  const writeEnabled = args.write && args.confirm;
  console.log(`Smart index backfill ${writeEnabled ? "WRITE" : "DRY-RUN"} documents=${documents?.length ?? 0}`);
  if (args.write && !args.confirm) console.log("WRITE requested without --confirm; staying in dry-run mode.");
  if (args.metadataOnly)
    console.log("Metadata-only mode: repairing chunk metadata, document-level fields, labels, and quality rows.");

  for (const document of documents ?? []) {
    const generationId = requireExactSourceAnchoredGeneration(document.index_generation_id, document.metadata);
    const indexingDocument = {
      ...document,
      metadata: metadataRecord(document.metadata),
    };
    const [chunks, images] = await Promise.all([
      loadRows<Record<string, unknown>>(
        reader,
        "document_chunks",
        "id,document_id,page_number,chunk_index,section_heading,section_path,heading_level,parent_heading,anchor_id,content_hash,index_generation_id,content,image_ids,metadata",
        document.id,
        generationId,
      ),
      loadRows<Record<string, unknown>>(
        reader,
        "document_images",
        "id,document_id,index_generation_id,page_number,caption,image_type,labels,source_kind,clinical_relevance_score,metadata",
        document.id,
        generationId,
      ),
    ]);
    assertSourceAnchoredSummaryPreflight({
      documentMetadata: indexingDocument.metadata,
      indexGenerationId: generationId,
      chunks: chunks as never,
      images: images as never,
    });

    if (!writeEnabled) {
      console.log(
        `DRY ${document.file_name}: chunks=${chunks.length} images=${images.length}; would refresh enrichment, model-heavy memory cards, index units, aliases, and quality metadata`,
      );
      continue;
    }

    const summary = await loadDocumentSummary({ supabase, documentId: document.id });
    const embeddingFields = await upsertDocumentLevelEmbeddingFields({
      supabase,
      document: indexingDocument,
      chunks: chunks as Record<string, unknown>[],
      summary,
      embedTexts,
    });
    if (args.metadataOnly) {
      const [sectionCount, memoryCardCount] = await Promise.all([
        countRows({ supabase, table: "document_sections", documentId: document.id }),
        countRows({ supabase, table: "document_memory_cards", documentId: document.id }),
      ]);
      const quality = await upsertIndexQuality({
        supabase,
        document: indexingDocument,
        chunks: chunks as Record<string, unknown>[],
        images: images as Record<string, unknown>[],
        sectionCount,
        memoryCardCount,
        generationId,
      });
      console.log(
        `REPAIRED ${document.file_name}: fields=${embeddingFields} quality=${quality.qualityScore} issues=${quality.issues.length}`,
      );
      continue;
    }

    const enrichment = await upsertDocumentEnrichment({
      supabase,
      document: indexingDocument,
      indexGenerationId: generationId,
      chunks: chunks as never,
      images: images as never,
    });
    const memory = await upsertDocumentDeepMemory({
      supabase,
      document: indexingDocument,
      chunks: chunks as never,
      images: images as never,
      summary: enrichment.summary.summary,
    });
    const quality = await upsertIndexQuality({
      supabase,
      document: indexingDocument,
      chunks: chunks as Record<string, unknown>[],
      images: images as Record<string, unknown>[],
      sectionCount: memory.sections.length,
      memoryCardCount: memory.memoryCards.length,
      generationId,
    });
    console.log(
      `WROTE ${document.file_name}: labels=${enrichment.labels.length} sections=${memory.sections.length} memory=${memory.memoryCards.length} indexUnits=${memory.indexUnits.length} fields=${embeddingFields} quality=${quality.qualityScore} modelFacts=${memory.modelProfile?.clinical_facts.length ?? 0} questions=${memory.modelProfile?.askable_questions.length ?? 0}`,
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
