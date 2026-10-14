import { parseIngestionFence, runIngestionPersistence, IngestionAttemptError, IngestionPersistenceError, type IngestionFence } from "../../supabase/functions/_shared/ingestion-attempt";
import { ProviderEgressDeniedError } from "@/lib/document-ingress-safety";
import { assertIngestionProviderEgress, type IngestionProviderEgressContext } from "@/lib/ingestion-provider-egress";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildClinicalTextSearchQuery, classifyRagQuery, normalizedClinicalSearchTokens } from "@/lib/clinical-search";
import { logger } from "@/lib/logger";
import {
  PUBLIC_OWNER_FILTER_SENTINEL,
  retrievalAccessScopeForArgs,
  retrievalRpcScopeArgs,
  type RetrievalAccessScope,
} from "@/lib/owner-scope";
import {
  buildDocumentIndexUnitInputs,
  countDocumentIndexUnitsByType,
  documentIntelligenceVersion,
  embeddingTextForDocumentIndexUnit,
} from "@/lib/document-index-units";
import { isClinicalImageEvidence } from "@/lib/image-filtering";
import { isMissingRetrievalRpcError } from "@/lib/retrieval-rpc-rollout";
import {
  fallbackModelIndexProfile,
  generateModelIndexProfile,
  modelIndexExtractionVersion,
  type ModelIndexProfile,
  type ModelIndexProfileItem,
} from "@/lib/model-index-extraction";
import { assertEmbeddingDim } from "@/lib/embedding-dimensions";
import { embedTexts } from "@/lib/openai";
import { committedIndexGeneration, isCommittedGenerationMetadata } from "@/lib/reindex-pipeline";
import { sourceTextForDisplay, sourceTextForModel } from "@/lib/source-text-sanitizer";
import type {
  ClinicalDocument,
  DocumentMemoryCard,
  DocumentMemoryCardType,
  DocumentSectionMemory,
  SearchResult,
} from "@/lib/types";

type AbortableQuery<T> = PromiseLike<T> & { abortSignal?: (signal: AbortSignal) => PromiseLike<T> };

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted.", "AbortError");
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortReason(signal);
}

async function resolveAbortableQuery<T>(query: AbortableQuery<T>, signal?: AbortSignal): Promise<T> {
  throwIfAborted(signal);
  const pending = signal && typeof query.abortSignal === "function" ? query.abortSignal(signal) : query;
  const result = await pending;
  throwIfAborted(signal);
  return result;
}

/**
 * v2: embedding-field predicates match escalation and contraindication word forms,
 * so v1 documents are stale and are picked up by the governed reindex/backfill.
 */
export const ragDeepMemoryVersion = "rag-deep-memory-v2" as const;
/** Earlier versions whose local-worker artifacts stay valid until they are reindexed. */
export const legacyRagDeepMemoryVersions: readonly string[] = ["rag-deep-memory-v1"];

export const localDeepMemoryProducer = "local-worker" as const;

export class DeepMemoryOwnershipConflictError extends Error {
  readonly code = "deep_memory_ownership_conflict";

  constructor(readonly documentId: string) {
    super(
      `Deep-memory artifacts for document ${documentId} are owned by another producer or have ambiguous ownership; refusing to overwrite them.`,
    );
    this.name = "DeepMemoryOwnershipConflictError";
  }
}

type MemoryChunk = {
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

type MemoryImage = {
  id: string;
  page_number: number | null;
  caption: string | null;
  image_type?: string | null;
  labels?: string[] | null;
  source_kind?: string | null;
  clinical_relevance_score?: number | null;
  metadata?: Record<string, unknown> | null;
};

type MemoryDocument = Pick<ClinicalDocument, "id" | "owner_id" | "title" | "file_name" | "source_path"> & {
  metadata?: ClinicalDocument["metadata"];
};

type BuiltMemoryCard = Omit<DocumentMemoryCard, "id" | "embedding" | "created_at" | "updated_at"> & {
  section_index?: number;
};

type SectionInsertRow = Omit<DocumentSectionMemory, "id" | "created_at" | "updated_at">;

const highYieldTerms =
  /\b(?:must|should|required|immediate|urgent|escalat\w*|withhold|cease|stop|discontinue\w*|contraindicat\w*|avoid|monitor\w*|dose|mg|mcg|mmol\/l|anc|fbc|wbc|neutrophil|clozapine|lithium|antipsychotic|benzodiazepine|risk|red flag|baseline|weekly|monthly|hours?|days?|weeks?)\b/i;
const thresholdTerms =
  /\b(?:threshold|level|range|score|rating|criteria|anc|fbc|wbc|neutrophil|cease|withhold|stop|<|>|≤|≥)\b/i;
const medicationTerms =
  /\b(?:clozapine|lithium|antipsychotic|benzodiazepine|olanzapine|lorazepam|diazepam|haloperidol|neuroleptic|dose|mg|mcg|oral|intramuscular|im\b|po\b|route|titrate)\b/i;
const riskTerms =
  /\b(?:risk|urgent|escalat\w*|red flag|toxicity|adverse|side effect|contraindicat\w*|avoid|senior|specialist|crisis|emergency)\b/i;
const workflowTerms =
  /\b(?:workflow|pathway|process|procedure|step|refer|review|document|record|complete|form|responsib\w*|follow up|appointment)\b/i;
const boilerplateTerms =
  /\b(?:uncontrolled when printed|document control|version control|authorisation date|copyright|all rights reserved)\b/i;

function metadataRecord(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? { ...(metadata as Record<string, unknown>) }
    : {};
}

function indexGenerationForChunks(chunks: Array<{ metadata?: Record<string, unknown> | null }>) {
  const generation = chunks
    .map((chunk) => metadataRecord(chunk.metadata).index_generation_id)
    .find((value): value is string => typeof value === "string" && value.trim().length > 0);
  return generation ?? null;
}

function compactText(value: string | null | undefined, limit = 420) {
  const clean = sourceTextForModel(String(value ?? ""));
  if (!clean) return "";
  return clean.length <= limit ? clean : `${clean.slice(0, limit - 3).trim()}...`;
}

function normalizeLookup(value: string) {
  return value
    .toLowerCase()
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[^a-z0-9%/.<>≤≥]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedTerms(value: string) {
  const terms = normalizedClinicalSearchTokens(value);
  const numericTerms = normalizeLookup(value)
    .split(/\s+/)
    .filter((token) => /^\d+(?:\.\d+)?$|^<|^>|^≤|^≥/.test(token));
  return Array.from(new Set([...terms, ...numericTerms])).slice(0, 28);
}

function headingFromContent(content: string) {
  const firstLine = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length >= 4 && line.length <= 100 && !line.includes("[[IMAGE_DATA_START]]"));
  if (!firstLine) return null;
  if (/^\d+\.?\s+[A-Z]/.test(firstLine) || /^[A-Z][A-Za-z0-9\s,;:()[\]/-]+$/.test(firstLine)) {
    return firstLine.replace(/[:.\s]+$/, "");
  }
  return null;
}

function extractionQualityForChunks(chunks: MemoryChunk[]): DocumentSectionMemory["extraction_quality"] {
  const qualities = chunks.map((chunk) => metadataRecord(chunk.metadata).extraction_quality);
  if (qualities.includes("poor")) return "poor";
  if (qualities.includes("partial")) return "partial";
  return "good";
}

function sectionHeadingForChunk(chunk: MemoryChunk) {
  return chunk.section_heading || headingFromContent(chunk.content) || `Page ${chunk.page_number ?? "unknown"}`;
}

export function buildDocumentSections(args: { document: MemoryDocument; chunks: MemoryChunk[] }): SectionInsertRow[] {
  const sorted = [...args.chunks].sort((a, b) => a.chunk_index - b.chunk_index);
  const groups: MemoryChunk[][] = [];
  const indexGenerationId = indexGenerationForChunks(args.chunks);

  for (const chunk of sorted) {
    const previous = groups.at(-1);
    const heading = normalizeLookup(sectionHeadingForChunk(chunk));
    const previousHeading = previous?.length ? normalizeLookup(sectionHeadingForChunk(previous[0])) : "";
    const pageGap =
      previous?.length && chunk.page_number && previous.at(-1)?.page_number
        ? chunk.page_number - (previous.at(-1)?.page_number ?? chunk.page_number)
        : 0;
    if (!previous || (heading && previousHeading && heading !== previousHeading) || pageGap > 1) {
      groups.push([chunk]);
    } else {
      previous.push(chunk);
    }
  }

  return groups.map((group, sectionIndex) => {
    const heading = sectionHeadingForChunk(group[0]);
    const pages = group.map((chunk) => chunk.page_number).filter((page): page is number => Boolean(page));
    const combined = compactText(group.map((chunk) => chunk.content).join(" "), 520);
    const tags = normalizedTerms(`${args.document.title} ${heading} ${combined}`).slice(0, 14);
    return {
      document_id: args.document.id,
      owner_id: args.document.owner_id ?? null,
      section_index: sectionIndex,
      heading,
      heading_path: [heading],
      page_start: pages.length ? Math.min(...pages) : null,
      page_end: pages.length ? Math.max(...pages) : null,
      chunk_ids: group.map((chunk) => chunk.id),
      summary: combined || `${heading}: indexed source section.`,
      tags,
      extraction_quality: extractionQualityForChunks(group),
      metadata: {
        rag_indexing_version: ragDeepMemoryVersion,
        index_generation_id: indexGenerationId,
        generated_by: localDeepMemoryProducer,
        source_path: args.document.source_path ?? null,
      },
    };
  });
}

function imageMetadataString(image: MemoryImage, key: string) {
  const value = metadataRecord(image.metadata)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function imageTextForCards(images: MemoryImage[]) {
  return images
    .filter((image) => isClinicalImageEvidence(image))
    .map((image) =>
      [
        image.caption,
        image.image_type,
        image.source_kind,
        imageMetadataString(image, "table_label"),
        imageMetadataString(image, "table_title"),
        imageMetadataString(image, "table_text"),
        ...(image.labels ?? []),
      ]
        .filter(Boolean)
        .join(" "),
    )
    .join("\n");
}

function splitCandidateStatements(text: string) {
  const withoutImageBlocks = sourceTextForDisplay(text);
  return withoutImageBlocks
    .split(/\r?\n|(?<=[.!?])\s+/)
    .map((line) => compactText(line, 360))
    .filter((line) => line.length >= 24 && line.length <= 360 && !boilerplateTerms.test(line));
}

function tableRowsFromMarkdown(text: string) {
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes("|") && !/^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?$/.test(line));

  if (rows.length < 2) return [];
  const header = rows[0]
    .split("|")
    .map((cell) => cell.trim())
    .filter(Boolean)
    .join(" ");

  return rows.slice(1).map((row) => {
    const cells = row
      .split("|")
      .map((cell) => cell.trim())
      .filter(Boolean);
    return compactText(`${header} ${cells.join(" ")}`, 360);
  });
}

function tableRowsFromImageTags(text: string) {
  const rows: string[] = [];
  for (const match of text.matchAll(/\[\[IMAGE_DATA_START\]\]\s*([\s\S]*?)\s*\[\[IMAGE_DATA_END\]\]/g)) {
    const block = match[1] ?? "";
    const tableText = block.match(/Table text:\s*([\s\S]*?)(?:;\s*Description:|$)/i)?.[1];
    if (tableText) rows.push(...tableRowsFromMarkdown(tableText));
  }
  return rows;
}

function classifyStatement(statement: string): { type: DocumentMemoryCardType; score: number } | null {
  let score = 0;
  let type: DocumentMemoryCardType = "citation_anchor";

  if (thresholdTerms.test(statement)) {
    type = "threshold";
    score += 0.3;
  }
  if (medicationTerms.test(statement)) {
    type = type === "citation_anchor" ? "medication" : type;
    score += 0.24;
  }
  if (riskTerms.test(statement)) {
    type = type === "citation_anchor" ? "risk" : type;
    score += 0.2;
  }
  if (workflowTerms.test(statement)) {
    type = type === "citation_anchor" ? "workflow" : type;
    score += 0.16;
  }
  if (highYieldTerms.test(statement)) score += 0.22;
  if (/\d/.test(statement)) score += 0.08;
  if (boilerplateTerms.test(statement)) score -= 0.25;

  return score >= 0.24 ? { type, score: Math.min(0.96, score) } : null;
}

function titleForCard(type: DocumentMemoryCardType, document: MemoryDocument, context: string) {
  const terms = normalizedTerms(context).slice(0, 5).join(" ");
  const prefix =
    type === "table_row"
      ? "Table evidence"
      : type === "threshold"
        ? "Threshold"
        : type === "medication"
          ? "Medication point"
          : type === "risk"
            ? "Risk/escalation point"
            : type === "workflow"
              ? "Workflow step"
              : type === "section_summary"
                ? "Section summary"
                : "Source fact";
  return compactText(`${prefix}: ${terms || document.title}`, 120);
}

function createCard(args: {
  document: MemoryDocument;
  chunk?: MemoryChunk;
  indexGenerationId?: string | null;
  sectionIndex?: number;
  type: DocumentMemoryCardType;
  content: string;
  confidence: number;
  sourceImageIds?: string[];
  metadata?: Record<string, unknown>;
}): BuiltMemoryCard {
  const title = titleForCard(args.type, args.document, `${args.chunk?.section_heading ?? ""} ${args.content}`);
  return {
    document_id: args.document.id,
    owner_id: args.document.owner_id ?? null,
    section_id: null,
    section_index: args.sectionIndex,
    card_type: args.type,
    title,
    content: compactText(args.content, 640),
    normalized_terms: normalizedTerms(`${title} ${args.content}`),
    page_number: args.chunk?.page_number ?? null,
    source_chunk_ids: args.chunk ? [args.chunk.id] : [],
    source_image_ids: args.sourceImageIds ?? [],
    confidence: Math.max(0.35, Math.min(0.99, args.confidence)),
    metadata: {
      rag_indexing_version: ragDeepMemoryVersion,
      index_generation_id: args.indexGenerationId ?? metadataRecord(args.chunk?.metadata).index_generation_id ?? null,
      generated_by: localDeepMemoryProducer,
      chunk_index: args.chunk?.chunk_index ?? null,
      section_heading: args.chunk?.section_heading ?? null,
      ...args.metadata,
    },
  };
}

function modelItemToCard(args: {
  document: MemoryDocument;
  item: ModelIndexProfileItem;
  type: DocumentMemoryCardType;
  chunkById: Map<string, MemoryChunk>;
  source?: string;
}): BuiltMemoryCard | null {
  const chunk = args.item.source_chunk_ids.map((id) => args.chunkById.get(id)).find(Boolean) ?? undefined;
  if (!chunk && args.item.source_image_ids.length === 0) return null;
  return createCard({
    document: args.document,
    chunk,
    type: args.type,
    content: `${args.item.title}: ${args.item.content}`,
    confidence: args.item.confidence,
    sourceImageIds: args.item.source_image_ids,
    metadata: {
      extraction_source: args.source ?? "model_index_profile",
      model_index_version: modelIndexExtractionVersion,
      source_chunk_ids: args.item.source_chunk_ids,
      source_image_ids: args.item.source_image_ids,
    },
  });
}

function sectionIndexForChunk(sections: SectionInsertRow[], chunkId: string) {
  return sections.find((section) => section.chunk_ids.includes(chunkId))?.section_index;
}

function dedupeCards(cards: BuiltMemoryCard[]) {
  const seen = new Set<string>();
  const deduped: BuiltMemoryCard[] = [];
  for (const card of cards) {
    const key = `${card.card_type}:${normalizeLookup(card.content).slice(0, 260)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(card);
  }
  return deduped;
}

export function buildDocumentMemoryCards(args: {
  document: MemoryDocument;
  chunks: MemoryChunk[];
  images?: MemoryImage[];
  sections?: SectionInsertRow[];
  modelProfile?: ModelIndexProfile | null;
}) {
  const cards: BuiltMemoryCard[] = [];
  const sections = args.sections ?? buildDocumentSections({ document: args.document, chunks: args.chunks });
  const indexGenerationId = indexGenerationForChunks(args.chunks);
  const chunkById = new Map(args.chunks.map((chunk) => [chunk.id, chunk]));
  const imagesByPage = new Map<number | null, MemoryImage[]>();
  for (const image of args.images ?? []) {
    imagesByPage.set(image.page_number ?? null, [...(imagesByPage.get(image.page_number ?? null) ?? []), image]);
  }

  for (const section of sections) {
    cards.push(
      createCard({
        document: args.document,
        sectionIndex: section.section_index,
        type: "section_summary",
        content: `${section.heading}: ${section.summary}`,
        confidence: 0.68,
        indexGenerationId,
        metadata: { chunk_ids: section.chunk_ids, page_start: section.page_start, page_end: section.page_end },
      }),
    );
  }

  for (const chunk of args.chunks) {
    const sectionIndex = sectionIndexForChunk(sections, chunk.id);
    const pageImages = imagesByPage.get(chunk.page_number) ?? [];
    const sourceImageIds = Array.from(new Set([...(chunk.image_ids ?? []), ...pageImages.map((image) => image.id)]));
    const imageContext = imageTextForCards(pageImages);

    for (const row of [...tableRowsFromMarkdown(chunk.content), ...tableRowsFromImageTags(chunk.content)]) {
      cards.push(
        createCard({
          document: args.document,
          chunk,
          sectionIndex,
          type: "table_row",
          content: row,
          confidence: 0.9,
          indexGenerationId,
          sourceImageIds,
          metadata: { extraction_source: "table_row" },
        }),
      );
    }

    for (const statement of splitCandidateStatements(`${chunk.content}\n${imageContext}`)) {
      const classification = classifyStatement(statement);
      if (!classification) continue;
      cards.push(
        createCard({
          document: args.document,
          chunk,
          sectionIndex,
          type: classification.type,
          content: statement,
          confidence: 0.55 + classification.score * 0.42,
          indexGenerationId,
          sourceImageIds,
          metadata: { extraction_source: "chunk_statement" },
        }),
      );
    }
  }

  for (const item of args.modelProfile?.askable_questions ?? []) {
    const card = modelItemToCard({
      document: args.document,
      item,
      type: "askable_question",
      chunkById,
      source: "model_askable_question",
    });
    if (card) cards.push(card);
  }
  for (const item of args.modelProfile?.clinical_facts ?? []) {
    const card = modelItemToCard({
      document: args.document,
      item,
      type: classifyStatement(item.content)?.type ?? "citation_anchor",
      chunkById,
      source: "model_clinical_fact",
    });
    if (card) cards.push(card);
  }
  for (const item of args.modelProfile?.table_facts ?? []) {
    const card = modelItemToCard({
      document: args.document,
      item,
      type: "table_row",
      chunkById,
      source: "model_table_fact",
    });
    if (card) cards.push(card);
  }

  if (!cards.some((card) => card.source_chunk_ids.length > 0) && args.chunks.length > 0) {
    const chunk = args.chunks[0];
    cards.push(
      createCard({
        document: args.document,
        chunk,
        sectionIndex: sectionIndexForChunk(sections, chunk.id),
        type: "citation_anchor",
        content: chunk.content,
        confidence: 0.45,
        sourceImageIds: chunk.image_ids ?? [],
        metadata: { extraction_source: "fallback_anchor" },
      }),
    );
  }

  return dedupeCards(cards).sort((a, b) => b.confidence - a.confidence);
}

function embeddingText(card: BuiltMemoryCard) {
  return `${card.title}\n${card.card_type}\n${card.content}\nTerms: ${card.normalized_terms.join(", ")}`;
}

function slugForAnchor(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 48) || "section"
  );
}

function derivedChunkAnchor(chunk: MemoryChunk) {
  const page = Number.isFinite(chunk.page_number) ? `p${chunk.page_number}` : "pna";
  const heading = slugForAnchor(chunk.section_heading || chunk.section_path?.join(" ") || "chunk");
  return `${page}-c${chunk.chunk_index}-${heading}`.slice(0, 80);
}

async function repairMissingChunkAnchors(supabase: SupabaseClient, chunks: MemoryChunk[]) {
  const missing = chunks.filter((chunk) => chunk.anchor_id === null);
  let repaired = 0;

  for (let start = 0; start < missing.length; start += 10) {
    const batch = missing.slice(start, start + 10);
    await Promise.all(
      batch.map(async (chunk) => {
        const anchor = derivedChunkAnchor(chunk);
        const { error } = await supabase
          .from("document_chunks")
          .update({
            anchor_id: anchor,
            metadata: {
              ...metadataRecord(chunk.metadata),
              anchor_id: anchor,
              anchor_repaired_by: documentIntelligenceVersion,
            },
          })
          .eq("id", chunk.id)
          .is("anchor_id", null);
        if (error) throw new Error(error.message);
        chunk.anchor_id = anchor;
        chunk.metadata = {
          ...metadataRecord(chunk.metadata),
          anchor_id: anchor,
          anchor_repaired_by: documentIntelligenceVersion,
        };
        repaired += 1;
      }),
    );
  }

  return repaired;
}

async function stampDeepMemoryChunks(args: { supabase: SupabaseClient; documentId: string }) {
  const stampedAt = new Date().toISOString();

  const { data: chunks, error: chunksError } = await args.supabase
    .from("document_chunks")
    .select("id,metadata")
    .eq("document_id", args.documentId);
  if (chunksError) throw new Error(chunksError.message);

  const chunksToUpdate = (chunks ?? []).filter((chunk) => {
    const record = metadataRecord(chunk.metadata);
    return record.rag_memory_version !== ragDeepMemoryVersion && record.rag_indexing_version !== ragDeepMemoryVersion;
  });

  if (chunksToUpdate.length > 0) {
    const limit = 5;
    for (let start = 0; start < chunksToUpdate.length; start += limit) {
      const batch = chunksToUpdate.slice(start, start + limit);
      await Promise.all(
        batch.map(async (chunk) => {
          const { error } = await args.supabase
            .from("document_chunks")
            .update({
              metadata: {
                ...metadataRecord(chunk.metadata),
                rag_indexing_version: ragDeepMemoryVersion,
                rag_memory_version: ragDeepMemoryVersion,
                rag_memory_updated_at: stampedAt,
                document_intelligence_version: documentIntelligenceVersion,
              },
            })
            .eq("id", chunk.id);
          if (error) throw new Error(error.message);
        }),
      );
    }
  }
}

type DeepMemoryArtifactTable = "document_sections" | "document_memory_cards" | "document_index_units";

function artifactOwnership(
  table: DeepMemoryArtifactTable,
  artifact: { producer?: unknown; artifact_generation_id?: unknown; metadata?: unknown },
): "local" | "agent" | "ambiguous" {
  const explicitProducer = typeof artifact.producer === "string" ? artifact.producer : null;
  const metadata = artifact.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "ambiguous";
  const record = metadata as Record<string, unknown>;
  if (explicitProducer && record.generated_by !== explicitProducer) return "ambiguous";
  if (record.generated_by === localDeepMemoryProducer) return "local";
  if (record.generated_by === "indexing-v3-agent") return "agent";
  if (Object.hasOwn(record, "generated_by")) return "ambiguous";
  if (
    table === "document_sections" &&
    typeof record.rag_indexing_version === "string" &&
    (record.rag_indexing_version === ragDeepMemoryVersion ||
      legacyRagDeepMemoryVersions.includes(record.rag_indexing_version))
  )
    return "local";
  if (table !== "document_sections" && artifact.artifact_generation_id == null) return "local";
  return "ambiguous";
}

export async function assertLocalDeepMemoryOwnership(supabase: SupabaseClient, documentId: string) {
  const tables: DeepMemoryArtifactTable[] = ["document_sections", "document_memory_cards", "document_index_units"];

  const artifactResults = await Promise.all(
    tables.map(async (table) => ({
      table,
      result: await supabase
        .from(table)
        .select("producer,artifact_generation_id,metadata")
        .eq("document_id", documentId),
    })),
  );

  for (const {
    table,
    result: { data, error },
  } of artifactResults) {
    if (error) throw new Error(error.message);
    if (!Array.isArray(data) || data.some((row) => artifactOwnership(table, row) !== "local")) {
      throw new DeepMemoryOwnershipConflictError(documentId);
    }
  }
}

export async function upsertDocumentDeepMemory(args: {
  fence?: IngestionFence;
  ingestionEgress?: IngestionProviderEgressContext;
  signal?: AbortSignal;
  supabase: SupabaseClient;
  document: MemoryDocument;
  chunks: MemoryChunk[];
  images?: MemoryImage[];
  summary?: string | null;
}) {
  const hasWorkerBinding = ["fence", "ingestionEgress", "signal"].some((key) =>
    Object.prototype.hasOwnProperty.call(args, key),
  );
  if (hasWorkerBinding) {
    if (!args.fence || !args.ingestionEgress) throw new IngestionAttemptError("ingestion_attempt_required");
    return upsertFencedDocumentDeepMemory({ ...args, fence: args.fence, ingestionEgress: args.ingestionEgress });
  }
  return upsertLegacyDocumentDeepMemory(args);
}

async function upsertLegacyDocumentDeepMemory(args: {
  supabase: SupabaseClient;
  document: MemoryDocument;
  chunks: MemoryChunk[];
  images?: MemoryImage[];
  summary?: string | null;
}) {
  if (args.chunks.length === 0) throw new Error("Cannot build deep memory for a document with no chunks.");

  await assertLocalDeepMemoryOwnership(args.supabase, args.document.id);

  const sections = buildDocumentSections(args);
  let modelProfile: ModelIndexProfile | null = null;
  try {
    modelProfile = await generateModelIndexProfile({
      document: args.document,
      chunks: args.chunks,
      images: args.images ?? [],
    });
  } catch (error) {
    // A failed model index profile degrades this document's memory cards to a
    // deterministic fallback. Surface it (mirroring hybrid_rpc_failed below)
    // rather than swallowing the error and silently shipping weaker retrieval.
    logger.warn("deep_memory_model_profile_failed", {
      documentId: args.document.id,
      message: error instanceof Error ? error.message : String(error),
    });
    modelProfile = fallbackModelIndexProfile();
  }
  const cards = buildDocumentMemoryCards({ ...args, sections, modelProfile });
  if (cards.length === 0) throw new Error("Deep memory generated no source-backed memory cards.");

  // Audit M11: compute everything that can fail on the network (memory-card
  // and index-unit embeddings) BEFORE deleting the existing memory rows. The
  // previous order deleted first and rebuilt after, so an OpenAI outage
  // mid-rebuild left the document with ZERO memory rows (silent retrieval
  // degradation) while documents.metadata still advertised the prior
  // rag_memory_version. A failure between the delete and insert below is
  // still possible, but the exposure window no longer spans OpenAI calls.
  const embeddings = await embedTexts(cards.map(embeddingText));
  if (embeddings.length !== cards.length) throw new Error("OpenAI returned an unexpected memory-card embedding count.");

  const indexUnits = buildDocumentIndexUnitInputs({
    document: args.document,
    chunks: args.chunks,
    sections,
    modelProfile,
    summary: args.summary ?? null,
    images: (args.images ?? []).map((image) => {
      const metadata = image.metadata ?? {};
      return {
        id: image.id,
        caption: image.caption,
        pageNumber: image.page_number,
        imageType: image.image_type,
        sourceKind: image.source_kind,
        labels: image.labels,
        tableLabel: typeof metadata.table_label === "string" ? metadata.table_label : null,
        tableTitle: typeof metadata.table_title === "string" ? metadata.table_title : null,
        tableTextSnippet:
          typeof metadata.table_text_snippet === "string"
            ? metadata.table_text_snippet
            : typeof metadata.table_text === "string"
              ? metadata.table_text
              : null,
        tableRole: typeof metadata.table_role === "string" ? metadata.table_role : null,
        accessibleTableMarkdown:
          typeof metadata.accessible_table_markdown === "string" ? metadata.accessible_table_markdown : null,
        tableRows: Array.isArray(metadata.table_rows) ? (metadata.table_rows as string[][]) : null,
        tableColumns: Array.isArray(metadata.table_columns) ? (metadata.table_columns as string[]) : null,
        structuredVisualProfile:
          typeof metadata.structured_visual_profile === "object" && metadata.structured_visual_profile !== null
            ? (metadata.structured_visual_profile as never)
            : null,
        metadata,
      };
    }),
  });
  const indexUnitEmbeddings =
    indexUnits.length > 0 ? await embedTexts(indexUnits.map(embeddingTextForDocumentIndexUnit)) : [];
  if (indexUnits.length > 0 && indexUnitEmbeddings.length !== indexUnits.length) {
    throw new Error("OpenAI returned an unexpected index-unit embedding count.");
  }
  let repairedAnchorCount = 0;
  const indexUnitCountsByType = countDocumentIndexUnitsByType(indexUnits);

  const artifactGenerationId = crypto.randomUUID();
  const stagedMetadata = (metadata: unknown) => ({
    ...metadataRecord(metadata),
    generated_by: localDeepMemoryProducer,
    artifact_generation_id: artifactGenerationId,
    index_generation_id: artifactGenerationId,
  });
  const stagedSections = sections.map((section) => ({
    ...section,
    producer: localDeepMemoryProducer,
    artifact_generation_id: artifactGenerationId,
    index_generation_id: artifactGenerationId,
    metadata: stagedMetadata(section.metadata),
  }));

  const cleanupStagedArtifacts = async () => {
    for (const table of ["document_memory_cards", "document_index_units", "document_sections"] as const) {
      try {
        await args.supabase
          .from(table)
          .delete()
          .eq("document_id", args.document.id)
          .eq("producer", localDeepMemoryProducer)
          .eq("artifact_generation_id", artifactGenerationId)
          .eq("index_generation_id", artifactGenerationId)
          .eq("metadata->>generated_by", localDeepMemoryProducer)
          .eq("metadata->>artifact_generation_id", artifactGenerationId)
          .eq("metadata->>index_generation_id", artifactGenerationId);
      } catch {
        // Best effort only. Never replace the staging/commit error with cleanup.
      }
    }
  };

  const { data: insertedSections, error: sectionError } = await args.supabase
    .from("document_sections")
    .insert(stagedSections)
    .select("id,section_index");
  if (sectionError) throw new Error(sectionError.message);

  const sectionIds = new Map<string | number, string>();
  for (const section of insertedSections ?? []) {
    sectionIds.set(section.section_index, section.id);
  }

  try {
    for (let start = 0; start < cards.length; start += 50) {
      const batch = cards.slice(start, start + 50).map((card, index) => {
        const { section_index: sectionIndex, ...row } = card;
        return {
          ...row,
          producer: localDeepMemoryProducer,
          artifact_generation_id: artifactGenerationId,
          index_generation_id: artifactGenerationId,
          metadata: stagedMetadata(row.metadata),
          section_id: sectionIndex === undefined ? null : (sectionIds.get(sectionIndex) ?? null),
          embedding: assertEmbeddingDim(embeddings[start + index], `document_memory_cards.${start + index}`),
        };
      });
      const { error } = await args.supabase.from("document_memory_cards").insert(batch);
      if (error) throw new Error(error.message);
    }

    if (indexUnits.length > 0) {
      for (let start = 0; start < indexUnits.length; start += 50) {
        const batch = indexUnits.slice(start, start + 50).map((unit, index) => ({
          ...unit,
          producer: localDeepMemoryProducer,
          artifact_generation_id: artifactGenerationId,
          index_generation_id: artifactGenerationId,
          metadata: stagedMetadata(unit.metadata),
          embedding: assertEmbeddingDim(indexUnitEmbeddings[start + index], `document_index_units.${start + index}`),
        }));
        const { error } = await args.supabase.from("document_index_units").insert(batch);
        if (error) throw new Error(error.message);
      }
    }

    repairedAnchorCount = await repairMissingChunkAnchors(args.supabase, args.chunks);
    await stampDeepMemoryChunks({ supabase: args.supabase, documentId: args.document.id });
  } catch (error) {
    await cleanupStagedArtifacts();
    throw error;
  }

  // The RPC may have committed even when its response is lost. Never clean up
  // after invocation: committed rows now share the document generation, while
  // genuinely staged leftovers remain invisible and are superseded later.
  const { error: commitError } = await args.supabase.rpc("commit_document_deep_memory_generation", {
    p_document_id: args.document.id,
    p_producer: localDeepMemoryProducer,
    p_artifact_generation_id: artifactGenerationId,
    p_rag_memory_version: ragDeepMemoryVersion,
    p_document_intelligence_version: documentIntelligenceVersion,
    p_section_count: sections.length,
    p_memory_card_count: cards.length,
    p_index_unit_counts_by_type: indexUnitCountsByType,
    p_repaired_anchor_count: repairedAnchorCount,
  });
  if (commitError) throw new Error(commitError.message);

  if (modelProfile?.aliases.length) {
    const aliases = modelProfile.aliases
      .filter((alias) => alias.confidence >= 0.65)
      .map((alias) => ({
        owner_id: args.document.owner_id ?? null,
        alias: alias.alias,
        canonical: alias.canonical,
        alias_type: alias.alias_type,
        weight: Math.max(0.5, Math.min(1.5, alias.confidence + 0.25)),
        enabled: true,
        metadata: {
          source: "model_index_profile",
          document_id: args.document.id,
          source_chunk_ids: alias.source_chunk_ids,
          model_index_version: modelIndexExtractionVersion,
        },
      }));
    if (aliases.length) {
      await args.supabase
        .from("rag_aliases")
        .insert(aliases)
        .then(undefined, () => undefined);
    }
  }

  return { sections, memoryCards: cards, indexUnits, modelProfile };
}
async function upsertFencedDocumentDeepMemory(args: {
  ingestionEgress: IngestionProviderEgressContext;
  supabase: SupabaseClient;
  fence: IngestionFence;
  signal?: AbortSignal;
  document: MemoryDocument;
  chunks: MemoryChunk[];
  images?: MemoryImage[];
  summary?: string | null;
}) {
  const fence = parseIngestionFence(args.fence);
  args.signal?.throwIfAborted();
  if (fence.document_id !== args.document.id || !fence.expected_generation_id)
    throw new IngestionAttemptError("ingestion_attempt_required");
  if (args.chunks.some((chunk) => chunk.metadata?.index_generation_id !== fence.expected_generation_id))
    throw new IngestionAttemptError("ingestion_attempt_required");
  const mutate = async (
    name:
      | "cleanup_ingestion_deep_memory_staging"
      | "stage_ingestion_deep_memory"
      | "commit_document_deep_memory_generation",
    payload: Record<string, unknown>,
  ) => {
    args.signal?.throwIfAborted();
    const result = await runIngestionPersistence(() => {
      const rpcArgs = { ...payload, p_fence: fence };
      if (name === "cleanup_ingestion_deep_memory_staging") {
        return args.supabase.rpc("cleanup_ingestion_deep_memory_staging", rpcArgs);
      }
      if (name === "stage_ingestion_deep_memory") {
        return args.supabase.rpc("stage_ingestion_deep_memory", rpcArgs);
      }
      return args.supabase.rpc("commit_document_deep_memory_generation", rpcArgs);
    });
    args.signal?.throwIfAborted();
    return result;
  };
  if (args.chunks.length === 0) throw new Error("Cannot build deep memory for a document with no chunks.");

  await assertLocalDeepMemoryOwnership(args.supabase, args.document.id);

  args.signal?.throwIfAborted();
  await assertIngestionProviderEgress(
    args.ingestionEgress,
    "deep_memory",
    JSON.stringify({ document: args.document, chunks: args.chunks, images: args.images ?? [] }),
    args.signal,
  );
  const sections = buildDocumentSections(args);
  let modelProfile: ModelIndexProfile | null = null;
  try {
    modelProfile = await generateModelIndexProfile({
      ingestionEgress: args.ingestionEgress,
      ingestionPurpose: "deep_memory",
      signal: args.signal,
      document: args.document,
      chunks: args.chunks,
      images: args.images ?? [],
    });
  } catch (error) {
    // A failed model index profile degrades this document's memory cards to a
    // deterministic fallback. Surface it (mirroring hybrid_rpc_failed below)
    // rather than swallowing the error and silently shipping weaker retrieval.
    args.signal?.throwIfAborted();
    if (
      error instanceof IngestionAttemptError ||
      error instanceof ProviderEgressDeniedError ||
      (error instanceof Error && error.name === "AbortError")
    )
      throw error;
    logger.warn("deep_memory_model_profile_failed", {
      documentId: args.document.id,
      message: error instanceof Error ? error.message : String(error),
    });
    modelProfile = fallbackModelIndexProfile();
  }
  args.signal?.throwIfAborted();
  const cards = buildDocumentMemoryCards({ ...args, sections, modelProfile });
  if (cards.length === 0) throw new Error("Deep memory generated no source-backed memory cards.");

  // Audit M11: compute everything that can fail on the network (memory-card
  // and index-unit embeddings) BEFORE deleting the existing memory rows. The
  // previous order deleted first and rebuilt after, so an OpenAI outage
  // mid-rebuild left the document with ZERO memory rows (silent retrieval
  // degradation) while documents.metadata still advertised the prior
  // rag_memory_version. A failure between the delete and insert below is
  // still possible, but the exposure window no longer spans OpenAI calls.
  const embeddings = await embedTexts(cards.map(embeddingText), {
    signal: args.signal,
    ingestionEgress: args.ingestionEgress,
    ingestionPurpose: "embedding",
  });
  if (embeddings.length !== cards.length) throw new Error("OpenAI returned an unexpected memory-card embedding count.");

  args.signal?.throwIfAborted();
  const indexUnits = buildDocumentIndexUnitInputs({
    document: args.document,
    chunks: args.chunks,
    sections,
    modelProfile,
    summary: args.summary ?? null,
    images: (args.images ?? []).map((image) => {
      const metadata = image.metadata ?? {};
      return {
        id: image.id,
        caption: image.caption,
        pageNumber: image.page_number,
        imageType: image.image_type,
        sourceKind: image.source_kind,
        labels: image.labels,
        tableLabel: typeof metadata.table_label === "string" ? metadata.table_label : null,
        tableTitle: typeof metadata.table_title === "string" ? metadata.table_title : null,
        tableTextSnippet:
          typeof metadata.table_text_snippet === "string"
            ? metadata.table_text_snippet
            : typeof metadata.table_text === "string"
              ? metadata.table_text
              : null,
        tableRole: typeof metadata.table_role === "string" ? metadata.table_role : null,
        accessibleTableMarkdown:
          typeof metadata.accessible_table_markdown === "string" ? metadata.accessible_table_markdown : null,
        tableRows: Array.isArray(metadata.table_rows) ? (metadata.table_rows as string[][]) : null,
        tableColumns: Array.isArray(metadata.table_columns) ? (metadata.table_columns as string[]) : null,
        structuredVisualProfile:
          typeof metadata.structured_visual_profile === "object" && metadata.structured_visual_profile !== null
            ? (metadata.structured_visual_profile as never)
            : null,
        metadata,
      };
    }),
  });
  const indexUnitEmbeddings =
    indexUnits.length > 0
      ? await embedTexts(indexUnits.map(embeddingTextForDocumentIndexUnit), {
          signal: args.signal,
          ingestionEgress: args.ingestionEgress,
          ingestionPurpose: "embedding",
        })
      : [];
  if (indexUnits.length > 0 && indexUnitEmbeddings.length !== indexUnits.length) {
    throw new Error("OpenAI returned an unexpected index-unit embedding count.");
  }
  args.signal?.throwIfAborted();
  const anchors = args.chunks
    .filter((chunk) => chunk.anchor_id === null)
    .map((chunk) => ({ id: chunk.id, anchor_id: derivedChunkAnchor(chunk) }));
  const indexUnitCountsByType = countDocumentIndexUnitsByType(indexUnits);

  const artifactGenerationId = crypto.randomUUID();
  const stagedMetadata = (metadata: unknown) => ({
    ...metadataRecord(metadata),
    generated_by: localDeepMemoryProducer,
    artifact_generation_id: artifactGenerationId,
    ingestion_lease_token: fence.lease_token,
    index_generation_id: artifactGenerationId,
  });
  const stagedSections = sections.map((section) => ({
    ...section,
    producer: localDeepMemoryProducer,
    artifact_generation_id: artifactGenerationId,
    index_generation_id: artifactGenerationId,
    metadata: stagedMetadata(section.metadata),
  }));

  const cleanupStagedArtifacts = async () => {
    // Only a local pre-commit failure is eligible; cleanup uncertainty is fatal,
    // and inert staging remains for U13. Never fall back to a direct delete.
    await mutate("cleanup_ingestion_deep_memory_staging", { p_artifact_generation: artifactGenerationId });
  };
  const insertedSections: Array<{ id: string; section_index: number }> = [];
  for (let start = 0; start < stagedSections.length; start += 500) {
    const sectionResult = await mutate("stage_ingestion_deep_memory", {
      p_artifact_generation: artifactGenerationId,
      p_sections: stagedSections.slice(start, start + 500),
      p_cards: [],
      p_units: [],
    });
    if (!Array.isArray(sectionResult.sections)) throw new IngestionAttemptError("ingestion_rpc_invalid");
    insertedSections.push(...(sectionResult.sections as Array<{ id: string; section_index: number }>));
  }
  const expectedSectionIndexes = new Set(sections.map((section) => section.section_index));
  if (
    insertedSections.length !== sections.length ||
    new Set(insertedSections.map((section) => section.section_index)).size !== sections.length ||
    insertedSections.some(
      (section) =>
        !section || typeof section.id !== "string" || !section.id || !expectedSectionIndexes.has(section.section_index),
    )
  ) {
    throw new IngestionAttemptError("ingestion_rpc_invalid");
  }

  const sectionIds = new Map<string | number, string>();
  for (const section of insertedSections ?? []) {
    sectionIds.set(section.section_index, section.id);
  }

  try {
    for (let start = 0; start < cards.length; start += 50) {
      const batch = cards.slice(start, start + 50).map((card, index) => {
        const { section_index: sectionIndex, ...row } = card;
        return {
          ...row,
          producer: localDeepMemoryProducer,
          artifact_generation_id: artifactGenerationId,
          index_generation_id: artifactGenerationId,
          metadata: stagedMetadata(row.metadata),
          section_id: sectionIndex === undefined ? null : (sectionIds.get(sectionIndex) ?? null),
          embedding: assertEmbeddingDim(embeddings[start + index], `document_memory_cards.${start + index}`),
        };
      });
      await mutate("stage_ingestion_deep_memory", {
        p_artifact_generation: artifactGenerationId,
        p_sections: [],
        p_cards: batch,
        p_units: [],
      });
    }

    if (indexUnits.length > 0) {
      for (let start = 0; start < indexUnits.length; start += 50) {
        const batch = indexUnits.slice(start, start + 50).map((unit, index) => ({
          ...unit,
          producer: localDeepMemoryProducer,
          artifact_generation_id: artifactGenerationId,
          index_generation_id: artifactGenerationId,
          metadata: stagedMetadata(unit.metadata),
          embedding: assertEmbeddingDim(indexUnitEmbeddings[start + index], `document_index_units.${start + index}`),
        }));
        await mutate("stage_ingestion_deep_memory", {
          p_artifact_generation: artifactGenerationId,
          p_sections: [],
          p_cards: [],
          p_units: batch,
        });
      }
    }
  } catch (error) {
    if (error instanceof IngestionAttemptError) throw error;
    try {
      await cleanupStagedArtifacts();
    } catch (cleanupError) {
      throw new IngestionPersistenceError(
        new AggregateError(
          [error, cleanupError instanceof IngestionPersistenceError ? cleanupError.cause : cleanupError],
          "Deep-memory staging failed and cleanup could not be confirmed.",
        ),
      );
    }
    throw error;
  }

  // The RPC may have committed even when its response is lost. Never clean up
  // after invocation: committed rows now share the document generation, while
  // genuinely staged leftovers remain invisible and are superseded later.
  const aliases = (modelProfile?.aliases ?? [])
    .filter((alias) => alias.confidence >= 0.65)
    .map((alias) => ({
      alias: alias.alias,
      canonical: alias.canonical,
      alias_type: alias.alias_type,
      weight: Math.max(0.5, Math.min(1.5, alias.confidence + 0.25)),
      enabled: true,
      metadata: {
        source: "model_index_profile",
        document_id: args.document.id,
        source_chunk_ids: alias.source_chunk_ids,
        model_index_version: modelIndexExtractionVersion,
        generated_by: localDeepMemoryProducer,
        artifact_generation_id: artifactGenerationId,
      },
    }));
  await mutate("commit_document_deep_memory_generation", {
    p_artifact_generation: artifactGenerationId,
    p_rag_memory_version: ragDeepMemoryVersion,
    p_document_intelligence_version: documentIntelligenceVersion,
    p_section_count: sections.length,
    p_memory_card_count: cards.length,
    p_index_unit_counts_by_type: indexUnitCountsByType,
    p_anchors: anchors,
    p_aliases: aliases,
  });

  return { sections, memoryCards: cards, indexUnits, modelProfile };
}

function scoreMemoryCardForQuery(
  query: string,
  card: Pick<DocumentMemoryCard, "title" | "content" | "normalized_terms" | "card_type" | "confidence">,
) {
  const queryTokens = normalizedTerms(query);
  if (queryTokens.length === 0) return 0;
  const termSet = new Set(card.normalized_terms ?? []);
  const content = normalizeLookup(`${card.title} ${card.content}`);
  const hits = queryTokens.filter((token) => termSet.has(token) || content.includes(token)).length;
  const coverage = hits / queryTokens.length;
  const queryClass = classifyRagQuery(query).queryClass;
  const classBoost =
    queryClass === "table_threshold" && ["table_row", "threshold"].includes(card.card_type)
      ? 0.18
      : queryClass === "medication_dose_risk" && ["medication", "threshold", "risk"].includes(card.card_type)
        ? 0.14
        : queryClass === "document_lookup" && card.card_type === "section_summary"
          ? 0.08
          : queryClass === "broad_summary" && card.card_type === "section_summary"
            ? 0.08
            : 0;
  return Math.min(1, coverage * 0.62 + (card.confidence ?? 0.5) * 0.2 + classBoost);
}

function memoryCardRetrievalScore(card: DocumentMemoryCard) {
  const hybridScore = Number(card.metadata?.memory_hybrid_score);
  if (Number.isFinite(hybridScore) && hybridScore > 0) return Math.min(1, hybridScore);
  return Math.min(1, card.confidence ?? 0.5);
}

export async function fetchMemoryCardsForQuery(args: {
  supabase: SupabaseClient;
  query: string;
  queryEmbedding?: number[];
  ownerId?: string;
  accessScope?: RetrievalAccessScope;
  documentIds?: string[];
  matchCount?: number;
  signal?: AbortSignal;
}) {
  try {
    throwIfAborted(args.signal);
    const accessScope = retrievalAccessScopeForArgs(args);
    if (args.queryEmbedding?.length) {
      const versioned = await resolveAbortableQuery(
        args.supabase.rpc("match_document_memory_cards_hybrid_v3", {
          query_embedding: args.queryEmbedding,
          query_text: buildClinicalTextSearchQuery(args.query),
          match_count: args.matchCount ?? 32,
          min_similarity: 0.1,
          document_filters: args.documentIds?.length ? args.documentIds : null,
          ...retrievalRpcScopeArgs(accessScope),
        }),
        args.signal,
      );
      let data = versioned?.data;
      let error = versioned?.error;
      if (!versioned || isMissingRetrievalRpcError(versioned.error)) {
        const baseArgs = {
          query_embedding: args.queryEmbedding,
          query_text: buildClinicalTextSearchQuery(args.query),
          match_count: args.matchCount ?? 32,
          min_similarity: 0.1,
          document_filters: args.documentIds?.length ? args.documentIds : null,
        };
        const ownerResult = await resolveAbortableQuery(
          args.supabase.rpc("match_document_memory_cards_hybrid_v2", {
            ...baseArgs,
            owner_filter: accessScope.ownerId ?? PUBLIC_OWNER_FILTER_SENTINEL,
          }),
          args.signal,
        );
        const publicResult =
          accessScope.ownerId && accessScope.includePublic
            ? await resolveAbortableQuery(
                args.supabase.rpc("match_document_memory_cards_hybrid_v2", {
                  ...baseArgs,
                  owner_filter: PUBLIC_OWNER_FILTER_SENTINEL,
                }),
                args.signal,
              )
            : { data: [], error: null };
        error = ownerResult.error ?? publicResult.error;
        type MemoryCardHybridRow = { id: string; hybrid_score: number; rrf_score?: number | null } & Record<
          string,
          unknown
        >;
        const compareRows = (left: MemoryCardHybridRow, right: MemoryCardHybridRow) =>
          right.hybrid_score - left.hybrid_score ||
          Number(right.rrf_score ?? 0) - Number(left.rrf_score ?? 0) ||
          left.id.localeCompare(right.id);
        const merged = new Map<string, MemoryCardHybridRow>();
        const fallbackRows = [...(ownerResult.data ?? []), ...(publicResult.data ?? [])] as MemoryCardHybridRow[];
        for (const row of fallbackRows) {
          const current = merged.get(row.id);
          if (!current || compareRows(row, current) < 0) merged.set(row.id, row);
        }
        data = [...merged.values()].sort(compareRows).slice(0, args.matchCount ?? 32) as typeof data;
      }

      if (error) {
        // P0.1: surface the hybrid RPC failure instead of silently dropping to the lexical
        // fallback below — this is the failure mode that hid the live schema drift.
        logger.error("hybrid_rpc_failed", {
          rpc: "match_document_memory_cards_hybrid",
          code: (error as { code?: string }).code ?? "unknown",
          message: error.message,
          hint: (error as { hint?: string }).hint,
        });
      }

      if (!error && data?.length) {
        return (
          (data ?? []) as Array<
            DocumentMemoryCard & {
              similarity?: number;
              text_rank?: number;
              hybrid_score?: number;
              rrf_score?: number;
            }
          >
        )
          .map((card) => ({
            ...card,
            confidence: Number(card.confidence ?? 0.5),
            metadata: {
              ...(card.metadata ?? {}),
              memory_similarity: card.similarity,
              memory_text_rank: card.text_rank,
              memory_hybrid_score: card.hybrid_score,
              memory_rrf_score: card.rrf_score,
            },
          }))
          .slice(0, args.matchCount ?? 32);
      }
    }

    let queryBuilder = args.supabase
      .from("document_memory_cards")
      .select(
        "id,document_id,owner_id,section_id,card_type,title,content,normalized_terms,page_number,source_chunk_ids,source_image_ids,confidence,metadata",
      )
      .textSearch("search_tsv", buildClinicalTextSearchQuery(args.query), { type: "websearch", config: "english" })
      .order("confidence", { ascending: false })
      .limit(args.matchCount ?? 32);

    if (accessScope.ownerId && accessScope.includePublic) {
      queryBuilder = queryBuilder.or(`owner_id.eq.${accessScope.ownerId},owner_id.is.null`);
    } else if (accessScope.ownerId) {
      queryBuilder = queryBuilder.eq("owner_id", accessScope.ownerId);
    } else {
      queryBuilder = queryBuilder.is("owner_id", null);
    }
    if (args.documentIds?.length) queryBuilder = queryBuilder.in("document_id", args.documentIds);

    const { data, error } = await resolveAbortableQuery(queryBuilder, args.signal);
    if (error) return [];

    const cards = (data ?? []) as DocumentMemoryCard[];
    const documentIds = Array.from(new Set(cards.map((card) => card.document_id)));
    let documentsQuery = args.supabase.from("documents").select("id,metadata").in("id", documentIds);
    if (accessScope.ownerId && accessScope.includePublic) {
      documentsQuery = documentsQuery.or(`owner_id.eq.${accessScope.ownerId},owner_id.is.null`);
    } else if (accessScope.ownerId) {
      documentsQuery = documentsQuery.eq("owner_id", accessScope.ownerId);
    } else {
      documentsQuery = documentsQuery.is("owner_id", null);
    }
    const { data: documents, error: documentsError } = documentIds.length
      ? await resolveAbortableQuery(documentsQuery, args.signal)
      : { data: [], error: null };
    const committedGenerationByDocument = new Map(
      (documents ?? []).map((document) => [document.id, committedIndexGeneration(document.metadata)] as const),
    );

    // Audit L8: fail CLOSED. If the documents lookup errors we cannot tell
    // which generation is committed, so returning the cards unfiltered could
    // inject content from an abandoned/superseded reindex generation into a
    // clinical answer. Dropping the fallback cards for one query (retrieval
    // degrades gracefully) is safer than exposing stale memory.
    if (documentsError) return [];

    return cards
      .filter((card) => {
        if (!committedGenerationByDocument.has(card.document_id)) return false;
        return isCommittedGenerationMetadata({
          rowMetadata: card.metadata,
          committedGeneration: committedGenerationByDocument.get(card.document_id),
        });
      })
      .map((card) => ({ ...card, confidence: Number(card.confidence ?? 0.5) }))
      .sort((a, b) => scoreMemoryCardForQuery(args.query, b) - scoreMemoryCardForQuery(args.query, a))
      .slice(0, args.matchCount ?? 32);
  } catch {
    if (args.signal?.aborted) throw abortReason(args.signal);
    return [];
  }
}

export function applyMemoryCardBoosts(query: string, results: SearchResult[], cards: DocumentMemoryCard[]) {
  if (results.length === 0 || cards.length === 0) return results;
  const cardsByChunk = new Map<string, DocumentMemoryCard[]>();
  for (const card of cards) {
    for (const chunkId of card.source_chunk_ids ?? []) {
      cardsByChunk.set(chunkId, [...(cardsByChunk.get(chunkId) ?? []), card]);
    }
  }

  return results.map((result) => {
    const relatedCards = cardsByChunk.get(result.id) ?? [];
    if (relatedCards.length === 0) return result;
    const memoryScore = Math.max(
      ...relatedCards.map((card) => Math.max(scoreMemoryCardForQuery(query, card), memoryCardRetrievalScore(card))),
    );
    const base = result.hybrid_score ?? result.similarity;
    return {
      ...result,
      hybrid_score: Math.min(0.99, base + Math.min(0.24, memoryScore * 0.24)),
      memory_score: Number(memoryScore.toFixed(4)),
      memory_cards: relatedCards
        .sort(
          (a, b) =>
            Math.max(scoreMemoryCardForQuery(query, b), memoryCardRetrievalScore(b)) -
            Math.max(scoreMemoryCardForQuery(query, a), memoryCardRetrievalScore(a)),
        )
        .slice(0, 4),
    };
  });
}
