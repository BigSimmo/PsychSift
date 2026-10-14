import { normalizedClinicalSearchTokens } from "@/lib/clinical-search";
import { isClinicalImageEvidence } from "@/lib/image-filtering";
import { sourceTextForDisplay, sourceTextForModel } from "@/lib/source-text-sanitizer";
import { modelIndexExtractionVersion } from "@/lib/model-index-version";
import type { ModelIndexProfile, ModelIndexProfileItem } from "@/lib/model-index-extraction";
import type { ClinicalDocument, DocumentMemoryCard, DocumentMemoryCardType, DocumentSectionMemory } from "@/lib/types";

export const ragDeepMemoryVersion = "rag-deep-memory-v1" as const;
export const localDeepMemoryProducer = "local-worker" as const;
export type MemoryChunk = {
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

export type MemoryImage = {
  id: string;
  page_number: number | null;
  caption: string | null;
  image_type?: string | null;
  labels?: string[] | null;
  source_kind?: string | null;
  clinical_relevance_score?: number | null;
  metadata?: Record<string, unknown> | null;
};

export type MemoryDocument = Pick<ClinicalDocument, "id" | "owner_id" | "title" | "file_name" | "source_path"> & {
  metadata?: ClinicalDocument["metadata"];
};

export type BuiltMemoryCard = Omit<DocumentMemoryCard, "id" | "embedding" | "created_at" | "updated_at"> & {
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

export function metadataRecord(metadata: unknown): Record<string, unknown> {
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

export function normalizeLookup(value: string) {
  return value
    .toLowerCase()
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[^a-z0-9%/.<>≤≥]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizedTerms(value: string) {
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
