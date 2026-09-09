import {
  assertUnleasedOperatorModeAllowed,
  isDirectScriptInvocation,
  unavailableUnleasedIngestionOperation,
} from "../lib/ingestion-operator-compatibility";
import { createHash } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import type { SupabaseClient } from "@supabase/supabase-js";

type SupabaseAdmin = SupabaseClient;

let createAdminClient: () => SupabaseAdmin;
let assertSupabaseHealthy: (health: unknown, label?: string) => void;
let probeSupabaseHealth: (supabase: SupabaseAdmin) => Promise<unknown>;
let embedTexts: (texts: string[]) => Promise<number[][]>;
let upsertDocumentDeepMemory: typeof import("@/lib/deep-memory").upsertDocumentDeepMemory;
let upsertDocumentEnrichment: typeof import("@/lib/document-enrichment").upsertDocumentEnrichment;
let ragDeepMemoryVersion: string;
let ragEnrichmentVersion: string;
let documentIntelligenceVersion: string;

type BackfillArgs = {
  limit: number;
  documentId?: string;
  ownerId?: string;
  includeCurrent: boolean;
  dryRun: boolean;
  retryAttempts: number;
};

type BackfillDocument = {
  id: string;
  owner_id: string | null;
  title: string;
  file_name: string;
  source_path: string | null;
  metadata: Record<string, unknown> | null;
};

type BackfillChunk = {
  id: string;
  document_id: string;
  page_number: number | null;
  chunk_index: number;
  section_heading: string | null;
  section_path?: string[] | null;
  anchor_id?: string | null;
  content: string;
  image_ids?: string[] | null;
  metadata?: Record<string, unknown> | null;
};

type BackfillImage = {
  id: string;
  page_number: number | null;
  caption: string | null;
  image_type: string | null;
  labels?: string[] | null;
  source_kind?: string | null;
  clinical_relevance_score?: number | null;
  metadata?: Record<string, unknown> | null;
};

const pageSize = 1000;
const stageDelayMs = 1000;

function parseArgs(argv: string[]): BackfillArgs {
  const args: BackfillArgs = {
    limit: 25,
    ownerId: process.env.RAG_EVAL_OWNER_ID ?? process.env.LOCAL_NO_AUTH_OWNER_ID,
    includeCurrent: false,
    dryRun: false,
    retryAttempts: 6,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    if (token === "--include-current") {
      args.includeCurrent = true;
      continue;
    }
    if (token === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${token}`);
    index += 1;
    if (token === "--limit") args.limit = Number.parseInt(value, 10);
    if (token === "--document-id") args.documentId = value;
    if (token === "--owner-id") args.ownerId = value;
    if (token === "--retry-attempts") args.retryAttempts = Number.parseInt(value, 10);
  }

  if (!Number.isInteger(args.limit) || args.limit <= 0) throw new Error("--limit must be a positive integer.");
  if (!Number.isInteger(args.retryAttempts) || args.retryAttempts <= 0) {
    throw new Error("--retry-attempts must be a positive integer.");
  }
  return args;
}

function metadataRecord(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? { ...(metadata as Record<string, unknown>) }
    : {};
}

function hashContent(content: string) {
  return createHash("md5").update(content).digest("hex");
}

function compactSearchText(value: unknown, limit = 1200) {
  const compact = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!compact) return "";
  return compact.length > limit ? compact.slice(0, limit).trim() : compact;
}

function isRateLimitError(error: unknown) {
  const message = formatError(error);
  return /\b(?:429|rate limit|rate_limit|too many requests)\b/i.test(message);
}

function formatError(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (error instanceof Error && error.stack) return error.stack;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const parts = [record.message, record.details, record.hint, record.code]
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter(Boolean);
    if (parts.length) return parts.join(" | ");
    const serialized = JSON.stringify(record);
    if (serialized && serialized !== "{}") return serialized;
  }
  const fallback = String(error ?? "");
  return fallback.trim() || "Unknown error";
}

function supabaseErrorMessage(error: unknown) {
  return formatError(error);
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function updateDocumentStage(
  supabase: SupabaseAdmin,
  document: BackfillDocument,
  stage: string,
  patch: Record<string, unknown> = {},
) {
  const metadata = {
    ...metadataRecord(document.metadata),
    ...patch,
    enrichment_status: patch.enrichment_status ?? (stage === "completed" ? "completed" : "processing"),
    enrichment_stage: stage,
    document_intelligence_version: documentIntelligenceVersion,
    document_intelligence_updated_at: new Date().toISOString(),
  };
  document.metadata = metadata;
  const { error } = await supabase.from("documents").update({ metadata }).eq("id", document.id);
  if (error) throw new Error(supabaseErrorMessage(error));
}

async function loadDocuments(supabase: SupabaseAdmin, args: BackfillArgs) {
  let query = supabase
    .from("documents")
    .select("id,owner_id,title,file_name,source_path,metadata")
    .eq("status", "indexed")
    .order("created_at", { ascending: true })
    .limit(args.documentId ? 1 : Math.max(args.limit * 8, args.limit));
  if (args.ownerId) query = query.eq("owner_id", args.ownerId);
  if (args.documentId) query = query.eq("id", args.documentId);
  if (!args.includeCurrent)
    query = query.or("metadata->>enrichment_status.eq.pending,metadata->>enrichment_status.is.null");
  const { data, error } = await query;
  if (error) throw new Error(supabaseErrorMessage(error));
  return ((data ?? []) as BackfillDocument[]).slice(0, args.limit);
}

async function selectRowsInPages<T>(
  supabase: SupabaseAdmin,
  table: "document_chunks" | "document_images",
  select: string,
  documentId: string,
  searchableOnly = false,
) {
  const rows: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    let query = supabase.from(table).select(select).eq("document_id", documentId);
    if (searchableOnly) query = query.eq("searchable", true);
    const { data, error } = await query.range(offset, offset + pageSize - 1);
    if (error) throw new Error(supabaseErrorMessage(error));
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function loadEvidence(supabase: SupabaseAdmin, documentId: string) {
  const [chunks, images] = await Promise.all([
    selectRowsInPages<BackfillChunk>(
      supabase,
      "document_chunks",
      "id,document_id,page_number,chunk_index,section_heading,section_path,anchor_id,content,image_ids,metadata",
      documentId,
    ),
    selectRowsInPages<BackfillImage>(
      supabase,
      "document_images",
      "id,page_number,caption,image_type,labels,source_kind,clinical_relevance_score,metadata",
      documentId,
      true,
    ),
  ]);
  chunks.sort((a, b) => Number(a.chunk_index ?? 0) - Number(b.chunk_index ?? 0));
  images.sort((a, b) => Number(b.clinical_relevance_score ?? 0) - Number(a.clinical_relevance_score ?? 0));
  return { chunks, images };
}

async function insertDocumentLevelEmbeddingFields(args: {
  supabase: SupabaseAdmin;
  document: BackfillDocument;
  chunks: BackfillChunk[];
  summary: string | null;
}) {
  const sourceChunkId = args.chunks[0]?.id;
  if (!sourceChunkId) return [];
  const inputs = [
    {
      field_type: "document_title",
      content: compactSearchText(`${args.document.title} ${args.document.file_name}`, 600),
    },
    {
      field_type: "document_summary",
      content: compactSearchText(`${args.document.title} ${args.summary ?? ""}`, 1200),
    },
  ].filter((input) => input.content);
  const existing = await args.supabase
    .from("document_embedding_fields")
    .select("field_type,content_hash")
    .eq("document_id", args.document.id)
    .in(
      "field_type",
      inputs.map((input) => input.field_type),
    );
  if (existing.error) throw new Error(supabaseErrorMessage(existing.error));
  const existingKeys = new Set((existing.data ?? []).map((row) => `${row.field_type}:${row.content_hash}`));
  const missing = inputs.filter((input) => !existingKeys.has(`${input.field_type}:${hashContent(input.content)}`));
  if (missing.length === 0) return inputs.map((input) => input.field_type);

  const embeddings = await embedTexts(missing.map((input) => input.content));
  const rows = missing.map((input, index) => ({
    owner_id: args.document.owner_id,
    document_id: args.document.id,
    source_chunk_id: sourceChunkId,
    field_type: input.field_type,
    content: input.content,
    content_hash: hashContent(input.content),
    embedding: embeddings[index],
    metadata: {
      source: "document_level_backfill",
      rag_indexing_version: ragDeepMemoryVersion,
      document_intelligence_version: documentIntelligenceVersion,
    },
  }));
  const { error } = await args.supabase.from("document_embedding_fields").insert(rows);
  if (error) throw new Error(supabaseErrorMessage(error));
  return inputs.map((input) => input.field_type);
}

async function countRows(supabase: SupabaseAdmin, table: string, documentId: string) {
  const query = supabase
    .from(table)
    .select("document_id", { count: "exact", head: true })
    .eq("document_id", documentId);
  const result = await query;
  if (result.error) throw new Error(supabaseErrorMessage(result.error));
  return result.count ?? 0;
}

type BackfillVerificationCounts = {
  summaries: number;
  labels: number;
  sections: number;
  memoryCards: number;
  indexUnits: number;
  embeddingFields: number;
  qualityRows: number;
};

async function readBackfillCounts(supabase: SupabaseAdmin, documentId: string): Promise<BackfillVerificationCounts> {
  const [summaries, labels, sections, memoryCards, indexUnits, embeddingFields, qualityRows] = await Promise.all([
    countRows(supabase, "document_summaries", documentId),
    countRows(supabase, "document_labels", documentId),
    countRows(supabase, "document_sections", documentId),
    countRows(supabase, "document_memory_cards", documentId),
    countRows(supabase, "document_index_units", documentId),
    countRows(supabase, "document_embedding_fields", documentId),
    countRows(supabase, "document_index_quality", documentId),
  ]);
  return { summaries, labels, sections, memoryCards, indexUnits, embeddingFields, qualityRows };
}

function missingBackfillCounts(counts: BackfillVerificationCounts) {
  return Object.entries(counts)
    .filter(([, count]) => count <= 0)
    .map(([key]) => key);
}

async function verifyBackfill(supabase: SupabaseAdmin, documentId: string) {
  const counts = await readBackfillCounts(supabase, documentId);
  const missing = missingBackfillCounts(counts);
  if (missing.length) throw new Error(`Backfill verification failed; missing ${missing.join(", ")}.`);
  return counts;
}

async function countIndexUnitsByType(supabase: SupabaseAdmin, documentId: string) {
  const rows: { unit_type: string }[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("document_index_units")
      .select("unit_type")
      .eq("document_id", documentId)
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(supabaseErrorMessage(error));
    rows.push(...((data ?? []) as { unit_type: string }[]));
    if (!data || data.length < pageSize) break;
  }
  return rows.reduce<Record<string, number>>((counts, row) => {
    counts[row.unit_type] = (counts[row.unit_type] ?? 0) + 1;
    return counts;
  }, {});
}

async function markBackfillCompleted(args: {
  supabase: SupabaseAdmin;
  document: BackfillDocument;
  counts: BackfillVerificationCounts;
  generatedLabelCount?: number;
  sectionCount?: number;
  memoryCardCount?: number;
  indexUnitCount?: number;
  documentEmbeddingFieldTypes?: string[];
}) {
  const indexUnitCountsByType = await countIndexUnitsByType(args.supabase, args.document.id);
  const patch: Record<string, unknown> = {
    enrichment_status: "completed",
    enrichment_error: null,
    rag_enrichment_version: ragEnrichmentVersion,
    rag_indexing_version: ragDeepMemoryVersion,
    rag_memory_version: ragDeepMemoryVersion,
    rag_enrichment_updated_at: new Date().toISOString(),
    rag_memory_updated_at: new Date().toISOString(),
    generated_label_count: args.generatedLabelCount ?? args.counts.labels,
    section_count: args.sectionCount ?? args.counts.sections,
    memory_card_count: args.memoryCardCount ?? args.counts.memoryCards,
    index_unit_count: args.indexUnitCount ?? args.counts.indexUnits,
    index_unit_counts_by_type: indexUnitCountsByType,
    backfill_verification_counts: args.counts,
  };
  if (args.documentEmbeddingFieldTypes) patch.document_embedding_field_types = args.documentEmbeddingFieldTypes;
  await updateDocumentStage(args.supabase, args.document, "completed", patch);
}

async function tryFinalizeExistingBackfill(supabase: SupabaseAdmin, document: BackfillDocument) {
  const counts = await readBackfillCounts(supabase, document.id);
  const missing = Object.entries(counts)
    .filter(([, count]) => count <= 0)
    .map(([key]) => key);
  if (missing.length) return null;
  await markBackfillCompleted({ supabase, document, counts });
  return counts;
}

async function processDocument(supabase: SupabaseAdmin, document: BackfillDocument) {
  await updateDocumentStage(supabase, document, "loading_evidence");
  const evidence = await loadEvidence(supabase, document.id);
  if (evidence.chunks.length === 0) throw new Error("Document has no indexed chunks to enrich.");

  const finalizedCounts = await tryFinalizeExistingBackfill(supabase, document);
  if (finalizedCounts) {
    return {
      reusedExisting: true,
      labels: finalizedCounts.labels,
      sections: finalizedCounts.sections,
      memoryCards: finalizedCounts.memoryCards,
      indexUnits: finalizedCounts.indexUnits,
      counts: finalizedCounts,
    };
  }

  await updateDocumentStage(supabase, document, "generating_enrichment", {
    enrichment_error: null,
    enrichment_chunk_count: evidence.chunks.length,
    enrichment_image_count: evidence.images.length,
  });
  const enrichment =
    await unavailableUnleasedIngestionOperation<Awaited<ReturnType<typeof upsertDocumentEnrichment>>>();

  await updateDocumentStage(supabase, document, "building_deep_memory");
  const memory = await unavailableUnleasedIngestionOperation<Awaited<ReturnType<typeof upsertDocumentDeepMemory>>>();

  await updateDocumentStage(supabase, document, "embedding_document_profile");
  const documentEmbeddingFieldTypes = await insertDocumentLevelEmbeddingFields({
    supabase,
    document,
    chunks: evidence.chunks,
    summary: enrichment.summary.summary,
  });

  await updateDocumentStage(supabase, document, "verifying_backfill");
  const counts = await verifyBackfill(supabase, document.id);
  await markBackfillCompleted({
    supabase,
    document,
    counts,
    generatedLabelCount: enrichment.labels.length,
    sectionCount: memory.sections.length,
    memoryCardCount: memory.memoryCards.length,
    indexUnitCount: memory.indexUnits.length,
    documentEmbeddingFieldTypes: documentEmbeddingFieldTypes,
  });

  return {
    labels: enrichment.labels.length,
    sections: memory.sections.length,
    memoryCards: memory.memoryCards.length,
    indexUnits: memory.indexUnits.length,
    counts,
  };
}

export async function main(argv: string[]) {
  const args = parseArgs(argv);
  assertUnleasedOperatorModeAllowed({ command: "enrich:backfill", dryRun: args.dryRun });
  const [deepMemoryModule, enrichmentModule, indexUnitModule, envModule, openAiModule, adminModule, healthModule] =
    await Promise.all([
      import("@/lib/deep-memory"),
      import("@/lib/document-enrichment"),
      import("@/lib/document-index-units"),
      import("@/lib/env"),
      import("@/lib/openai"),
      import("@/lib/supabase/admin"),
      import("@/lib/supabase/health"),
    ]);
  upsertDocumentDeepMemory = deepMemoryModule.upsertDocumentDeepMemory;
  ragDeepMemoryVersion = deepMemoryModule.ragDeepMemoryVersion;
  upsertDocumentEnrichment = enrichmentModule.upsertDocumentEnrichment;
  ragEnrichmentVersion = enrichmentModule.ragEnrichmentVersion;
  documentIntelligenceVersion = indexUnitModule.documentIntelligenceVersion;
  embedTexts = openAiModule.embedTexts;
  createAdminClient = adminModule.createAdminClient;
  assertSupabaseHealthy = healthModule.assertSupabaseHealthy as typeof assertSupabaseHealthy;
  probeSupabaseHealth = healthModule.probeSupabaseHealth as typeof probeSupabaseHealth;

  envModule.requireServerEnv();
  envModule.requireOpenAIEnv();

  const supabase = createAdminClient();
  assertSupabaseHealthy(await probeSupabaseHealth(supabase), "Enrichment backfill");
  const documents = await loadDocuments(supabase, args);
  console.log(
    JSON.stringify({
      event: "backfill_start",
      limit: args.limit,
      documentCount: documents.length,
      ownerId: args.ownerId ?? null,
      documentId: args.documentId ?? null,
      dryRun: args.dryRun,
      version: documentIntelligenceVersion,
    }),
  );
  if (args.dryRun) return;

  let completed = 0;
  let failed = 0;
  for (const document of documents) {
    let attempt = 0;
    for (;;) {
      attempt += 1;
      try {
        const result = await processDocument(supabase, document);
        completed += 1;
        console.log(JSON.stringify({ event: "backfill_completed", documentId: document.id, attempt, ...result }));
        await sleep(stageDelayMs);
        break;
      } catch (error) {
        const message = formatError(error);
        if (isRateLimitError(error) && attempt < args.retryAttempts) {
          const delayMs = Math.min(120_000, 8000 * 2 ** (attempt - 1));
          console.warn(
            JSON.stringify({ event: "backfill_rate_limited", documentId: document.id, attempt, retryInMs: delayMs }),
          );
          await sleep(delayMs);
          continue;
        }
        failed += 1;
        await updateDocumentStage(supabase, document, "failed", {
          enrichment_status: "failed",
          enrichment_error: message,
        }).catch(() => undefined);
        console.error(JSON.stringify({ event: "backfill_failed", documentId: document.id, attempt, error: message }));
        break;
      }
    }
  }

  console.log(JSON.stringify({ event: "backfill_done", completed, failed, total: documents.length }));
  if (failed > 0) process.exitCode = 1;
}

if (isDirectScriptInvocation(import.meta.url, process.argv[1])) {
  loadEnvConfig(process.cwd());
  main(process.argv.slice(2)).catch((error) => {
    console.error(formatError(error));
    process.exitCode = 1;
  });
}
